import type { Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import type {
  CancellationPolicyVersionView,
  CancellationTierInput,
  CommercialAssignmentInput,
  CommercialPolicyView,
  CreateCancellationAssignmentInput,
  CreateCancellationPolicyVersionInput,
  CreateCommercialPolicyInput,
  CreateFeeAssignmentInput,
  CreateFeePolicyVersionInput,
  CreateTaxAssignmentInput,
  CreateTaxPolicyVersionInput,
  FeePolicyVersionView,
  GuestAgePolicyVersionInput,
  GuestAgePolicyVersionView,
  PropertyCommercialSettingsInput,
  PropertyCommercialSettingsVersionView,
  TaxPolicyVersionView
} from "../domain/commercial-rules.js";
import {
  CommercialRuleRepository,
  type CancellationPolicyRecord,
  type FeePolicyRecord,
  type PropertyCommercialContext,
  type TaxPolicyRecord
} from "../infrastructure/commercial-rule-repository.js";

const MAX_MONEY_MINOR = 100_000_000;
const MAX_BASIS_POINTS = 10_000;

function parseDate(value: string, field = "effectiveFrom"): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`${field} must use YYYY-MM-DD format`);
  }
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new ValidationError(`${field} is not a valid calendar date`);
  }
}

function requireForwardTimeline(latest: string | null, next: string, label: string): void {
  parseDate(next);
  if (latest !== null && next <= latest) {
    throw new ConflictError(
      `${label} must move forward without rewriting prior effective history`,
      {
        latestEffectiveFrom: latest,
        requestedEffectiveFrom: next
      }
    );
  }
}

function validateExpectedVersion(expected: number, current: number, label: string): void {
  if (!Number.isInteger(expected) || expected < 0) {
    throw new ValidationError("expectedVersion must be a non-negative integer");
  }
  if (expected !== current) {
    throw new ConflictError(`${label} has changed; refresh before creating another version`, {
      expectedVersion: expected,
      currentVersion: current
    });
  }
}

function validateMoney(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_MONEY_MINOR) {
    throw new ValidationError(`${field} must be an integer between 0 and ${MAX_MONEY_MINOR}`);
  }
}

function normalizePolicy(input: CreateCommercialPolicyInput): {
  code: string;
  name: string;
  description: string | null;
} {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(code)) {
    throw new ValidationError("Policy code must use 2-40 letters, numbers, _ or -");
  }
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) {
    throw new ValidationError("Policy name must contain 2 to 120 characters");
  }
  const description = input.description?.trim() || null;
  if (description && description.length > 2000) {
    throw new ValidationError("Policy description cannot exceed 2000 characters");
  }
  return { code, name, description };
}

function policyView(
  policy: TaxPolicyRecord | FeePolicyRecord | CancellationPolicyRecord
): CommercialPolicyView {
  return {
    id: policy.id,
    code: policy.code,
    name: policy.name,
    description: policy.description,
    status: policy.status as "ACTIVE" | "INACTIVE",
    currentVersion: policy.current_version
  };
}

function settingsView(row: {
  id: string;
  version_number: number;
  effective_from: string;
  tax_mode: string;
  fee_mode: string;
}): PropertyCommercialSettingsVersionView {
  return {
    id: row.id,
    version: row.version_number,
    effectiveFrom: row.effective_from,
    taxMode: row.tax_mode as "NO_TAX" | "POLICIES",
    feeMode: row.fee_mode as "NO_FEES" | "POLICIES"
  };
}

function validateAssignmentShape(input: CommercialAssignmentInput): void {
  if (input.scopeType === "PROPERTY") {
    if (input.ratePlanId !== null || input.rateProductId !== null) {
      throw new ValidationError("PROPERTY assignment cannot include ratePlanId or rateProductId");
    }
    return;
  }
  if (input.scopeType === "RATE_PLAN") {
    if (!input.ratePlanId || input.rateProductId !== null) {
      throw new ValidationError("RATE_PLAN assignment requires ratePlanId and no rateProductId");
    }
    return;
  }
  if (input.scopeType === "RATE_PRODUCT") {
    if (input.ratePlanId !== null || !input.rateProductId) {
      throw new ValidationError("RATE_PRODUCT assignment requires rateProductId and no ratePlanId");
    }
    return;
  }
  throw new ValidationError("Unsupported commercial assignment scope");
}

function validateCancellationTiers(tiers: CancellationTierInput[]): void {
  if (tiers.length < 2 || tiers.length > 30) {
    throw new ValidationError("Cancellation policy must contain 2-30 tiers");
  }

  let noShowCount = 0;
  let hasZeroCancellationTier = false;
  const thresholds = new Set<number>();

  for (const tier of tiers) {
    if (tier.triggerType === "NO_SHOW") {
      noShowCount += 1;
      if (tier.minimumMinutesBeforeArrival !== null) {
        throw new ValidationError("NO_SHOW tier must not define minimumMinutesBeforeArrival");
      }
    } else {
      if (
        tier.minimumMinutesBeforeArrival === null ||
        !Number.isInteger(tier.minimumMinutesBeforeArrival) ||
        tier.minimumMinutesBeforeArrival < 0
      ) {
        throw new ValidationError("CANCELLATION tiers require a non-negative minute threshold");
      }
      if (thresholds.has(tier.minimumMinutesBeforeArrival)) {
        throw new ValidationError("Cancellation tiers cannot repeat a minute threshold");
      }
      thresholds.add(tier.minimumMinutesBeforeArrival);
      if (tier.minimumMinutesBeforeArrival === 0) hasZeroCancellationTier = true;
    }

    if (!Number.isInteger(tier.penaltyValue) || tier.penaltyValue < 0) {
      throw new ValidationError("Cancellation penaltyValue must be a non-negative integer");
    }
    if (tier.penaltyType === "PERCENTAGE_OF_STAY" && tier.penaltyValue > MAX_BASIS_POINTS) {
      throw new ValidationError("Percentage cancellation penalty cannot exceed 10000 basis points");
    }
    if (tier.penaltyType === "FIXED_AMOUNT") validateMoney(tier.penaltyValue, "penaltyValue");
    if (tier.penaltyType === "NIGHTS" && tier.penaltyValue > 365) {
      throw new ValidationError("Night cancellation penalty cannot exceed 365 nights");
    }
  }

  if (!hasZeroCancellationTier) {
    throw new ValidationError("Cancellation policy requires a zero-minute cancellation tier");
  }
  if (noShowCount !== 1) {
    throw new ValidationError("Cancellation policy requires exactly one NO_SHOW tier");
  }
}

export class CommercialRuleService {
  constructor(
    private readonly rules = new CommercialRuleRepository(),
    private readonly authorization = new AuthorizationService()
  ) {}

  private async property(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    permission: typeof Permissions.COMMERCIAL_READ | typeof Permissions.COMMERCIAL_MANAGE
  ): Promise<PropertyCommercialContext> {
    this.authorization.assert(actor, permission, {
      kind: "property",
      organizationId,
      propertyId
    });
    const property = await this.rules.findPropertyContext(trx, organizationId, propertyId);
    if (!property) throw new NotFoundError("Property not found");
    if (property.status === "ARCHIVED") {
      throw new ConflictError("Commercial rules cannot be managed for an archived property");
    }
    return property;
  }

  private async materialChange(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      entityType:
        | "COMMERCIAL_SETTINGS_VERSION"
        | "TAX_POLICY"
        | "TAX_POLICY_VERSION"
        | "TAX_ASSIGNMENT"
        | "FEE_POLICY"
        | "FEE_POLICY_VERSION"
        | "FEE_ASSIGNMENT"
        | "CANCELLATION_POLICY"
        | "CANCELLATION_POLICY_VERSION"
        | "CANCELLATION_ASSIGNMENT"
        | "GUEST_AGE_POLICY_VERSION";
      entityId: string;
      eventType: string;
      action: string;
      aggregateType: string;
      outboxType: string;
      after: JsonObject;
      request: RequestMetadata;
    }
  ): Promise<void> {
    await this.rules.recordEvent(trx, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      entityType: input.entityType,
      entityId: input.entityId,
      eventType: input.eventType,
      details: input.after,
      actorUserId: actor.userId,
      request: input.request
    });
    await new AuditService(trx).record({
      actor,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: input.action,
      entityType: input.aggregateType,
      entityId: input.entityId,
      after: input.after,
      request: input.request
    });
    await new OutboxService(trx).enqueue({
      aggregateType: input.aggregateType,
      aggregateId: input.entityId,
      eventType: input.outboxType,
      payload: input.after
    });
  }

  async setPropertyCommercialSettings(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: PropertyCommercialSettingsInput,
    request: RequestMetadata
  ): Promise<{ settingsVersion: PropertyCommercialSettingsVersionView }> {
    await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.COMMERCIAL_MANAGE
    );
    const header = await this.rules.ensureAndLockPropertyCommercialSettings(
      trx,
      input.organizationId,
      input.propertyId,
      actor.userId
    );
    validateExpectedVersion(input.expectedVersion, header.current_version, "Commercial settings");
    const latest = await this.rules.latestPropertyCommercialSettingsEffectiveFrom(
      trx,
      input.propertyId
    );
    requireForwardTimeline(latest, input.effectiveFrom, "Commercial settings effectiveFrom");

    const row = await this.rules.insertPropertyCommercialSettingsVersion(trx, {
      organization_id: input.organizationId,
      property_id: input.propertyId,
      version_number: header.current_version + 1,
      effective_from: input.effectiveFrom,
      tax_mode: input.taxMode,
      fee_mode: input.feeMode,
      created_by_user_id: actor.userId
    });
    await this.rules.advancePropertyCommercialSettings(
      trx,
      input.propertyId,
      row.version_number,
      actor.userId
    );
    const view = settingsView(row);
    await this.materialChange(trx, actor, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      entityType: "COMMERCIAL_SETTINGS_VERSION",
      entityId: row.id,
      eventType: "COMMERCIAL_SETTINGS_VERSION_CREATED",
      action: "commercial.settings.version.created",
      aggregateType: "commercial_settings_version",
      outboxType: "commercial.settings.version.created.v1",
      after: view,
      request
    });
    return { settingsVersion: view };
  }

  private async createPolicy(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreateCommercialPolicyInput,
    kind: "tax" | "fee" | "cancellation",
    request: RequestMetadata
  ): Promise<{ policy: CommercialPolicyView }> {
    await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.COMMERCIAL_MANAGE
    );
    const normalized = normalizePolicy(input);
    const existing =
      kind === "tax"
        ? await this.rules.findTaxPolicyByCode(trx, input.propertyId, normalized.code)
        : kind === "fee"
          ? await this.rules.findFeePolicyByCode(trx, input.propertyId, normalized.code)
          : await this.rules.findCancellationPolicyByCode(trx, input.propertyId, normalized.code);
    if (existing) {
      throw new ConflictError("A commercial policy with this code already exists for the property");
    }

    const values = {
      organization_id: input.organizationId,
      property_id: input.propertyId,
      code: normalized.code,
      name: normalized.name,
      description: normalized.description,
      created_by_user_id: actor.userId,
      updated_by_user_id: actor.userId
    };
    const row =
      kind === "tax"
        ? await this.rules.createTaxPolicy(trx, values)
        : kind === "fee"
          ? await this.rules.createFeePolicy(trx, values)
          : await this.rules.createCancellationPolicy(trx, values);
    const view = policyView(row);
    const prefix = kind === "cancellation" ? "CANCELLATION" : kind.toUpperCase();
    await this.materialChange(trx, actor, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      entityType: `${prefix}_POLICY` as "TAX_POLICY" | "FEE_POLICY" | "CANCELLATION_POLICY",
      entityId: row.id,
      eventType: `${prefix}_POLICY_CREATED`,
      action: `commercial.${kind}.policy.created`,
      aggregateType: `${kind}_policy`,
      outboxType: `commercial.${kind}.policy.created.v1`,
      after: view,
      request
    });
    return { policy: view };
  }

  createTaxPolicy(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreateCommercialPolicyInput,
    request: RequestMetadata
  ) {
    return this.createPolicy(trx, actor, input, "tax", request);
  }

  createFeePolicy(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreateCommercialPolicyInput,
    request: RequestMetadata
  ) {
    return this.createPolicy(trx, actor, input, "fee", request);
  }

  createCancellationPolicy(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreateCommercialPolicyInput,
    request: RequestMetadata
  ) {
    return this.createPolicy(trx, actor, input, "cancellation", request);
  }

  async createTaxPolicyVersion(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreateTaxPolicyVersionInput,
    request: RequestMetadata
  ): Promise<{ taxPolicyVersion: TaxPolicyVersionView }> {
    await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.COMMERCIAL_MANAGE
    );
    const policy = await this.rules.lockTaxPolicy(
      trx,
      input.organizationId,
      input.propertyId,
      input.taxPolicyId
    );
    if (!policy) throw new NotFoundError("Tax policy not found");
    if (policy.status !== "ACTIVE")
      throw new ConflictError("Inactive tax policies cannot receive new versions");
    validateExpectedVersion(input.expectedCurrentVersion, policy.current_version, "Tax policy");
    const latest = await this.rules.latestTaxVersionEffectiveFrom(trx, policy.id);
    requireForwardTimeline(latest, input.effectiveFrom, "Tax policy effectiveFrom");

    if (!input.appliesToAccommodation && !input.appliesToExtraGuest && !input.appliesToFee) {
      throw new ValidationError("Tax policy version must apply to at least one charge class");
    }
    if (
      input.selectionBasis === "ALWAYS" &&
      (input.minimumBasisMinor !== null || input.maximumBasisMinor !== null)
    ) {
      throw new ValidationError("ALWAYS tax selection cannot define monetary thresholds");
    }
    if (input.minimumBasisMinor !== null)
      validateMoney(input.minimumBasisMinor, "minimumBasisMinor");
    if (input.maximumBasisMinor !== null)
      validateMoney(input.maximumBasisMinor, "maximumBasisMinor");
    if (
      input.minimumBasisMinor !== null &&
      input.maximumBasisMinor !== null &&
      input.maximumBasisMinor <= input.minimumBasisMinor
    ) {
      throw new ValidationError("maximumBasisMinor must be greater than minimumBasisMinor");
    }
    if (input.components.length < 1 || input.components.length > 20) {
      throw new ValidationError("Tax policy version must contain 1-20 components");
    }
    const componentCodes = new Set<string>();
    let totalBasisPoints = 0;
    const components = input.components.map((component) => {
      const code = component.code.trim().toUpperCase();
      const name = component.name.trim();
      if (!/^[A-Z0-9_-]{1,40}$/.test(code)) throw new ValidationError("Invalid tax component code");
      if (!name || name.length > 120)
        throw new ValidationError("Tax component name must contain 1-120 characters");
      if (componentCodes.has(code))
        throw new ValidationError("Tax component codes must be unique within a version");
      componentCodes.add(code);
      if (
        !Number.isInteger(component.rateBasisPoints) ||
        component.rateBasisPoints < 0 ||
        component.rateBasisPoints > MAX_BASIS_POINTS
      ) {
        throw new ValidationError("Tax component rateBasisPoints must be between 0 and 10000");
      }
      if (
        !Number.isInteger(component.sortOrder) ||
        component.sortOrder < 0 ||
        component.sortOrder > 1000
      ) {
        throw new ValidationError("Tax component sortOrder must be between 0 and 1000");
      }
      totalBasisPoints += component.rateBasisPoints;
      return {
        code,
        name,
        rateBasisPoints: component.rateBasisPoints,
        sortOrder: component.sortOrder
      };
    });
    if (totalBasisPoints > MAX_BASIS_POINTS) {
      throw new ValidationError("Combined tax component rates cannot exceed 10000 basis points");
    }

    const version = await this.rules.createTaxVersion(trx, {
      tax_policy_id: policy.id,
      organization_id: input.organizationId,
      property_id: input.propertyId,
      version_number: policy.current_version + 1,
      effective_from: input.effectiveFrom,
      price_mode: input.priceMode,
      selection_basis: input.selectionBasis,
      minimum_basis_minor: input.minimumBasisMinor,
      maximum_basis_minor: input.maximumBasisMinor,
      applies_to_accommodation: input.appliesToAccommodation,
      applies_to_extra_guest: input.appliesToExtraGuest,
      applies_to_fee: input.appliesToFee,
      sealed_at: null,
      created_by_user_id: actor.userId
    });
    const componentRows = await this.rules.createTaxComponents(
      trx,
      components.map((component) => ({
        tax_policy_version_id: version.id,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        component_code: component.code,
        component_name: component.name,
        rate_basis_points: component.rateBasisPoints,
        sort_order: component.sortOrder
      }))
    );
    const sealed = await this.rules.sealTaxVersion(trx, version.id);
    await this.rules.advanceTaxPolicy(trx, policy.id, sealed.version_number, actor.userId);

    const view: TaxPolicyVersionView = {
      id: sealed.id,
      taxPolicyId: sealed.tax_policy_id,
      version: sealed.version_number,
      effectiveFrom: sealed.effective_from,
      priceMode: sealed.price_mode as TaxPolicyVersionView["priceMode"],
      selectionBasis: sealed.selection_basis as TaxPolicyVersionView["selectionBasis"],
      minimumBasisMinor: sealed.minimum_basis_minor,
      maximumBasisMinor: sealed.maximum_basis_minor,
      appliesToAccommodation: sealed.applies_to_accommodation,
      appliesToExtraGuest: sealed.applies_to_extra_guest,
      appliesToFee: sealed.applies_to_fee,
      sealedAt: sealed.sealed_at!.toISOString(),
      components: componentRows.map((row) => ({
        id: row.id,
        code: row.component_code,
        name: row.component_name,
        rateBasisPoints: row.rate_basis_points,
        sortOrder: row.sort_order
      }))
    };
    await this.materialChange(trx, actor, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      entityType: "TAX_POLICY_VERSION",
      entityId: sealed.id,
      eventType: "TAX_POLICY_VERSION_CREATED_AND_SEALED",
      action: "commercial.tax.policy.version.created",
      aggregateType: "tax_policy_version",
      outboxType: "commercial.tax.policy.version.created.v1",
      after: view,
      request
    });
    return { taxPolicyVersion: view };
  }

  private async validateAssignmentTarget(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    input: CommercialAssignmentInput
  ): Promise<void> {
    validateAssignmentShape(input);
    if (input.ratePlanId) {
      const plan = await this.rules.findRatePlan(trx, organizationId, propertyId, input.ratePlanId);
      if (!plan) throw new NotFoundError("Rate plan not found for commercial assignment");
    }
    if (input.rateProductId) {
      const product = await this.rules.findRateProduct(
        trx,
        organizationId,
        propertyId,
        input.rateProductId
      );
      if (!product) throw new NotFoundError("Rate product not found for commercial assignment");
    }
  }

  async createTaxAssignment(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreateTaxAssignmentInput,
    request: RequestMetadata
  ): Promise<{ assignment: JsonObject }> {
    await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.COMMERCIAL_MANAGE
    );
    const policy = await this.rules.lockTaxPolicy(
      trx,
      input.organizationId,
      input.propertyId,
      input.taxPolicyId
    );
    if (!policy) throw new NotFoundError("Tax policy not found");
    if (policy.status !== "ACTIVE" || policy.current_version < 1) {
      throw new ConflictError("Tax policy must be active and versioned before assignment");
    }
    if (
      input.enabled &&
      !(await this.rules.hasEffectiveTaxVersion(trx, policy.id, input.effectiveFrom))
    ) {
      throw new ConflictError(
        "Enabled tax assignment requires a sealed tax version effective on the assignment date"
      );
    }
    await this.validateAssignmentTarget(trx, input.organizationId, input.propertyId, input);
    const latest = await this.rules.latestTaxAssignmentEffectiveFrom(
      trx,
      policy.id,
      input.scopeType,
      input.ratePlanId,
      input.rateProductId
    );
    requireForwardTimeline(latest, input.effectiveFrom, "Tax assignment effectiveFrom");
    const row = await this.rules.createTaxAssignment(trx, {
      organization_id: input.organizationId,
      property_id: input.propertyId,
      tax_policy_id: policy.id,
      scope_type: input.scopeType,
      rate_plan_id: input.ratePlanId,
      rate_product_id: input.rateProductId,
      effective_from: input.effectiveFrom,
      enabled: input.enabled,
      created_by_user_id: actor.userId
    });
    const view: JsonObject = {
      id: row.id,
      taxPolicyId: row.tax_policy_id,
      scopeType: row.scope_type,
      ratePlanId: row.rate_plan_id,
      rateProductId: row.rate_product_id,
      effectiveFrom: row.effective_from,
      enabled: row.enabled
    };
    await this.materialChange(trx, actor, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      entityType: "TAX_ASSIGNMENT",
      entityId: row.id,
      eventType: "TAX_ASSIGNMENT_CREATED",
      action: "commercial.tax.assignment.created",
      aggregateType: "tax_assignment",
      outboxType: "commercial.tax.assignment.created.v1",
      after: view,
      request
    });
    return { assignment: view };
  }

  async createFeePolicyVersion(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreateFeePolicyVersionInput,
    request: RequestMetadata
  ): Promise<{ feePolicyVersion: FeePolicyVersionView }> {
    const property = await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.COMMERCIAL_MANAGE
    );
    const policy = await this.rules.lockFeePolicy(
      trx,
      input.organizationId,
      input.propertyId,
      input.feePolicyId
    );
    if (!policy) throw new NotFoundError("Fee policy not found");
    if (policy.status !== "ACTIVE")
      throw new ConflictError("Inactive fee policies cannot receive new versions");
    validateExpectedVersion(input.expectedCurrentVersion, policy.current_version, "Fee policy");
    const latest = await this.rules.latestFeeVersionEffectiveFrom(trx, policy.id);
    requireForwardTimeline(latest, input.effectiveFrom, "Fee policy effectiveFrom");

    if (input.calculationType === "FIXED") {
      if (
        input.amountMinor === null ||
        input.rateBasisPoints !== null ||
        input.applicationBasis === "STAY_CHARGES"
      ) {
        throw new ValidationError("FIXED fees require amountMinor and a fixed application basis");
      }
      validateMoney(input.amountMinor, "amountMinor");
    } else {
      if (
        input.amountMinor !== null ||
        input.rateBasisPoints === null ||
        input.applicationBasis !== "STAY_CHARGES"
      ) {
        throw new ValidationError(
          "PERCENTAGE fees require rateBasisPoints with STAY_CHARGES basis"
        );
      }
      if (
        !Number.isInteger(input.rateBasisPoints) ||
        input.rateBasisPoints < 0 ||
        input.rateBasisPoints > MAX_BASIS_POINTS
      ) {
        throw new ValidationError("rateBasisPoints must be between 0 and 10000");
      }
    }
    if (input.taxable !== (input.taxPolicyId !== null)) {
      throw new ValidationError(
        "taxable fees require taxPolicyId; non-taxable fees must not define one"
      );
    }
    if (input.taxPolicyId) {
      const taxPolicy = await this.rules.lockTaxPolicy(
        trx,
        input.organizationId,
        input.propertyId,
        input.taxPolicyId
      );
      if (!taxPolicy || taxPolicy.status !== "ACTIVE" || taxPolicy.current_version < 1) {
        throw new ConflictError(
          "Taxable fee requires an active, versioned tax policy from the same property"
        );
      }
      if (!(await this.rules.hasEffectiveTaxVersion(trx, taxPolicy.id, input.effectiveFrom))) {
        throw new ConflictError(
          "Taxable fee requires a sealed tax version effective on the fee version date"
        );
      }
    }

    const row = await this.rules.createFeeVersion(trx, {
      fee_policy_id: policy.id,
      organization_id: input.organizationId,
      property_id: input.propertyId,
      version_number: policy.current_version + 1,
      effective_from: input.effectiveFrom,
      currency_code: property.currency_code,
      calculation_type: input.calculationType,
      application_basis: input.applicationBasis,
      amount_minor: input.amountMinor,
      rate_basis_points: input.rateBasisPoints,
      price_mode: input.priceMode,
      taxable: input.taxable,
      tax_policy_id: input.taxPolicyId,
      created_by_user_id: actor.userId
    });
    await this.rules.advanceFeePolicy(trx, policy.id, row.version_number, actor.userId);
    const view: FeePolicyVersionView = {
      id: row.id,
      feePolicyId: row.fee_policy_id,
      version: row.version_number,
      effectiveFrom: row.effective_from,
      currencyCode: row.currency_code,
      calculationType: row.calculation_type as FeePolicyVersionView["calculationType"],
      applicationBasis: row.application_basis as FeePolicyVersionView["applicationBasis"],
      amountMinor: row.amount_minor,
      rateBasisPoints: row.rate_basis_points,
      priceMode: row.price_mode as FeePolicyVersionView["priceMode"],
      taxable: row.taxable,
      taxPolicyId: row.tax_policy_id
    };
    await this.materialChange(trx, actor, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      entityType: "FEE_POLICY_VERSION",
      entityId: row.id,
      eventType: "FEE_POLICY_VERSION_CREATED",
      action: "commercial.fee.policy.version.created",
      aggregateType: "fee_policy_version",
      outboxType: "commercial.fee.policy.version.created.v1",
      after: view,
      request
    });
    return { feePolicyVersion: view };
  }

  async createFeeAssignment(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreateFeeAssignmentInput,
    request: RequestMetadata
  ): Promise<{ assignment: JsonObject }> {
    await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.COMMERCIAL_MANAGE
    );
    const policy = await this.rules.lockFeePolicy(
      trx,
      input.organizationId,
      input.propertyId,
      input.feePolicyId
    );
    if (!policy) throw new NotFoundError("Fee policy not found");
    if (policy.status !== "ACTIVE" || policy.current_version < 1) {
      throw new ConflictError("Fee policy must be active and versioned before assignment");
    }
    if (
      input.enabled &&
      !(await this.rules.hasEffectiveFeeVersion(trx, policy.id, input.effectiveFrom))
    ) {
      throw new ConflictError(
        "Enabled fee assignment requires a fee version effective on the assignment date"
      );
    }
    await this.validateAssignmentTarget(trx, input.organizationId, input.propertyId, input);
    const latest = await this.rules.latestFeeAssignmentEffectiveFrom(
      trx,
      policy.id,
      input.scopeType,
      input.ratePlanId,
      input.rateProductId
    );
    requireForwardTimeline(latest, input.effectiveFrom, "Fee assignment effectiveFrom");
    const row = await this.rules.createFeeAssignment(trx, {
      organization_id: input.organizationId,
      property_id: input.propertyId,
      fee_policy_id: policy.id,
      scope_type: input.scopeType,
      rate_plan_id: input.ratePlanId,
      rate_product_id: input.rateProductId,
      effective_from: input.effectiveFrom,
      enabled: input.enabled,
      created_by_user_id: actor.userId
    });
    const view: JsonObject = {
      id: row.id,
      feePolicyId: row.fee_policy_id,
      scopeType: row.scope_type,
      ratePlanId: row.rate_plan_id,
      rateProductId: row.rate_product_id,
      effectiveFrom: row.effective_from,
      enabled: row.enabled
    };
    await this.materialChange(trx, actor, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      entityType: "FEE_ASSIGNMENT",
      entityId: row.id,
      eventType: "FEE_ASSIGNMENT_CREATED",
      action: "commercial.fee.assignment.created",
      aggregateType: "fee_assignment",
      outboxType: "commercial.fee.assignment.created.v1",
      after: view,
      request
    });
    return { assignment: view };
  }

  async createCancellationPolicyVersion(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreateCancellationPolicyVersionInput,
    request: RequestMetadata
  ): Promise<{ cancellationPolicyVersion: CancellationPolicyVersionView }> {
    const property = await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.COMMERCIAL_MANAGE
    );
    const policy = await this.rules.lockCancellationPolicy(
      trx,
      input.organizationId,
      input.propertyId,
      input.cancellationPolicyId
    );
    if (!policy) throw new NotFoundError("Cancellation policy not found");
    if (policy.status !== "ACTIVE")
      throw new ConflictError("Inactive cancellation policies cannot receive new versions");
    validateExpectedVersion(
      input.expectedCurrentVersion,
      policy.current_version,
      "Cancellation policy"
    );
    const latest = await this.rules.latestCancellationVersionEffectiveFrom(trx, policy.id);
    requireForwardTimeline(latest, input.effectiveFrom, "Cancellation policy effectiveFrom");
    if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(input.arrivalLocalTime)) {
      throw new ValidationError("arrivalLocalTime must use HH:MM or HH:MM:SS 24-hour format");
    }
    const policyText = input.policyText?.trim() || null;
    if (policyText && policyText.length > 5000) {
      throw new ValidationError("Cancellation policy text cannot exceed 5000 characters");
    }
    validateCancellationTiers(input.tiers);

    const version = await this.rules.createCancellationVersion(trx, {
      cancellation_policy_id: policy.id,
      organization_id: input.organizationId,
      property_id: input.propertyId,
      version_number: policy.current_version + 1,
      effective_from: input.effectiveFrom,
      arrival_local_time: input.arrivalLocalTime,
      currency_code: property.currency_code,
      policy_text: policyText,
      sealed_at: null,
      created_by_user_id: actor.userId
    });
    const tierRows = await this.rules.createCancellationTiers(
      trx,
      input.tiers.map((tier) => ({
        cancellation_policy_version_id: version.id,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        trigger_type: tier.triggerType,
        minimum_minutes_before_arrival: tier.minimumMinutesBeforeArrival,
        penalty_type: tier.penaltyType,
        penalty_value: tier.penaltyValue
      }))
    );
    const sealed = await this.rules.sealCancellationVersion(trx, version.id);
    await this.rules.advanceCancellationPolicy(trx, policy.id, sealed.version_number, actor.userId);
    const view: CancellationPolicyVersionView = {
      id: sealed.id,
      cancellationPolicyId: sealed.cancellation_policy_id,
      version: sealed.version_number,
      effectiveFrom: sealed.effective_from,
      arrivalLocalTime: sealed.arrival_local_time,
      currencyCode: sealed.currency_code,
      policyText: sealed.policy_text,
      sealedAt: sealed.sealed_at!.toISOString(),
      tiers: tierRows.map((tier) => ({
        id: tier.id,
        triggerType: tier.trigger_type,
        minimumMinutesBeforeArrival: tier.minimum_minutes_before_arrival,
        penaltyType: tier.penalty_type,
        penaltyValue: tier.penalty_value
      }))
    };
    await this.materialChange(trx, actor, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      entityType: "CANCELLATION_POLICY_VERSION",
      entityId: sealed.id,
      eventType: "CANCELLATION_POLICY_VERSION_CREATED_AND_SEALED",
      action: "commercial.cancellation.policy.version.created",
      aggregateType: "cancellation_policy_version",
      outboxType: "commercial.cancellation.policy.version.created.v1",
      after: view,
      request
    });
    return { cancellationPolicyVersion: view };
  }

  async createCancellationAssignment(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreateCancellationAssignmentInput,
    request: RequestMetadata
  ): Promise<{ assignment: JsonObject }> {
    await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.COMMERCIAL_MANAGE
    );
    const plan = await this.rules.lockRatePlan(
      trx,
      input.organizationId,
      input.propertyId,
      input.ratePlanId
    );
    if (!plan) throw new NotFoundError("Rate plan not found");
    const policy = await this.rules.lockCancellationPolicy(
      trx,
      input.organizationId,
      input.propertyId,
      input.cancellationPolicyId
    );
    if (!policy) throw new NotFoundError("Cancellation policy not found");
    if (policy.status !== "ACTIVE" || policy.current_version < 1) {
      throw new ConflictError("Cancellation policy must be active and versioned before assignment");
    }
    if (!(await this.rules.hasEffectiveCancellationVersion(trx, policy.id, input.effectiveFrom))) {
      throw new ConflictError(
        "Cancellation assignment requires a sealed policy version effective on the assignment date"
      );
    }
    const latest = await this.rules.latestCancellationAssignmentEffectiveFrom(
      trx,
      input.ratePlanId
    );
    requireForwardTimeline(latest, input.effectiveFrom, "Cancellation assignment effectiveFrom");
    const row = await this.rules.createCancellationAssignment(trx, {
      organization_id: input.organizationId,
      property_id: input.propertyId,
      rate_plan_id: input.ratePlanId,
      cancellation_policy_id: input.cancellationPolicyId,
      effective_from: input.effectiveFrom,
      created_by_user_id: actor.userId
    });
    const view: JsonObject = {
      id: row.id,
      ratePlanId: row.rate_plan_id,
      cancellationPolicyId: row.cancellation_policy_id,
      effectiveFrom: row.effective_from
    };
    await this.materialChange(trx, actor, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      entityType: "CANCELLATION_ASSIGNMENT",
      entityId: row.id,
      eventType: "CANCELLATION_ASSIGNMENT_CREATED",
      action: "commercial.cancellation.assignment.created",
      aggregateType: "cancellation_assignment",
      outboxType: "commercial.cancellation.assignment.created.v1",
      after: view,
      request
    });
    return { assignment: view };
  }

  async setGuestAgePolicy(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: GuestAgePolicyVersionInput,
    request: RequestMetadata
  ): Promise<{ guestAgePolicyVersion: GuestAgePolicyVersionView }> {
    await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.COMMERCIAL_MANAGE
    );
    const header = await this.rules.ensureAndLockGuestAgePolicy(
      trx,
      input.organizationId,
      input.propertyId,
      actor.userId
    );
    validateExpectedVersion(input.expectedVersion, header.current_version, "Guest age policy");
    const latest = await this.rules.latestGuestAgeEffectiveFrom(trx, input.propertyId);
    requireForwardTimeline(latest, input.effectiveFrom, "Guest age policy effectiveFrom");

    if (!Number.isInteger(input.childMaxAge) || input.childMaxAge < 0 || input.childMaxAge > 17) {
      throw new ValidationError("childMaxAge must be an integer between 0 and 17");
    }
    if (
      input.infantMaxAge !== null &&
      (!Number.isInteger(input.infantMaxAge) ||
        input.infantMaxAge < 0 ||
        input.infantMaxAge >= input.childMaxAge)
    ) {
      throw new ValidationError("infantMaxAge must be null or lower than childMaxAge");
    }

    const row = await this.rules.createGuestAgeVersion(trx, {
      organization_id: input.organizationId,
      property_id: input.propertyId,
      version_number: header.current_version + 1,
      effective_from: input.effectiveFrom,
      infant_max_age: input.infantMaxAge,
      child_max_age: input.childMaxAge,
      infants_count_towards_occupancy: input.infantsCountTowardsOccupancy,
      infants_count_towards_child_limit: input.infantsCountTowardsChildLimit,
      infants_charge_as_children: input.infantsChargeAsChildren,
      created_by_user_id: actor.userId
    });
    await this.rules.advanceGuestAgePolicy(trx, input.propertyId, row.version_number, actor.userId);
    const view: GuestAgePolicyVersionView = {
      id: row.id,
      version: row.version_number,
      effectiveFrom: row.effective_from,
      infantMaxAge: row.infant_max_age,
      childMaxAge: row.child_max_age,
      infantsCountTowardsOccupancy: row.infants_count_towards_occupancy,
      infantsCountTowardsChildLimit: row.infants_count_towards_child_limit,
      infantsChargeAsChildren: row.infants_charge_as_children
    };
    await this.materialChange(trx, actor, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      entityType: "GUEST_AGE_POLICY_VERSION",
      entityId: row.id,
      eventType: "GUEST_AGE_POLICY_VERSION_CREATED",
      action: "commercial.guest_age.version.created",
      aggregateType: "guest_age_policy_version",
      outboxType: "commercial.guest_age.version.created.v1",
      after: view,
      request
    });
    return { guestAgePolicyVersion: view };
  }

  async getConfiguration(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string
  ): Promise<JsonObject> {
    await this.property(trx, actor, organizationId, propertyId, Permissions.COMMERCIAL_READ);
    return this.rules.getConfiguration(trx, organizationId, propertyId);
  }
}

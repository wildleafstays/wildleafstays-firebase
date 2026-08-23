import type { Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import type { CommercialScopeType } from "../domain/commercial-rules.js";
import type {
  CreatePromotionAssignmentInput,
  CreatePromotionCampaignInput,
  CreatePromotionCampaignVersionInput,
  PromotionAssignmentView,
  PromotionCampaignVersionView,
  PromotionCampaignView,
  PromotionSettingsInput,
  PromotionSettingsVersionView
} from "../domain/promotion-rules.js";
import {
  PromotionRuleRepository,
  type PromotionCampaignRecord,
  type PromotionPropertyContext
} from "../infrastructure/promotion-rule-repository.js";

const MAX_MONEY_MINOR = 100_000_000;
const MAX_BASIS_POINTS = 10_000;

function parseDate(value: string, field: string): void {
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
  parseDate(next, "effectiveFrom");
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

function normalizeCode(value: string, field: string, minLength: number): string {
  const normalized = value.trim().toUpperCase();
  const pattern = new RegExp(`^[A-Z0-9_-]{${minLength},40}$`);
  if (!pattern.test(normalized)) {
    throw new ValidationError(`${field} must use ${minLength}-40 letters, numbers, _ or -`);
  }
  return normalized;
}

function validateMoney(value: number, field: string, allowZero = true): void {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(value) || value < minimum || value > MAX_MONEY_MINOR) {
    throw new ValidationError(
      `${field} must be an integer between ${minimum} and ${MAX_MONEY_MINOR}`
    );
  }
}

function validateOptionalWindow(
  start: string | null,
  end: string | null,
  label: "booking" | "arrival"
): void {
  if ((start === null) !== (end === null)) {
    throw new ValidationError(`${label} window must provide both start and end or neither`);
  }
  if (start === null || end === null) return;
  parseDate(start, `${label}WindowStart`);
  parseDate(end, `${label}WindowEnd`);
  if (end < start) {
    throw new ValidationError(`${label}WindowEnd cannot be before ${label}WindowStart`);
  }
}

function campaignView(row: PromotionCampaignRecord): PromotionCampaignView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    promotionKind: row.promotion_kind as PromotionCampaignView["promotionKind"],
    publicCode: row.public_code,
    status: row.status as PromotionCampaignView["status"],
    currentVersion: row.current_version
  };
}

function validateAssignmentShape(input: CreatePromotionAssignmentInput): void {
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
  throw new ValidationError("Unsupported promotion assignment scope");
}

export class PromotionRuleService {
  constructor(
    private readonly repository = new PromotionRuleRepository(),
    private readonly authorization = new AuthorizationService()
  ) {}

  private async property(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    permission: typeof Permissions.COMMERCIAL_READ | typeof Permissions.COMMERCIAL_MANAGE
  ): Promise<PromotionPropertyContext> {
    this.authorization.assert(actor, permission, {
      kind: "property",
      organizationId,
      propertyId
    });
    const property = await this.repository.findPropertyContext(trx, organizationId, propertyId);
    if (!property) throw new NotFoundError("Property not found");
    if (property.status === "ARCHIVED") {
      throw new ConflictError("Promotion rules cannot be managed for an archived property");
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
        | "PROMOTION_SETTINGS_VERSION"
        | "PROMOTION_CAMPAIGN"
        | "PROMOTION_CAMPAIGN_VERSION"
        | "PROMOTION_ASSIGNMENT";
      entityId: string;
      eventType: string;
      action: string;
      aggregateType: string;
      outboxType: string;
      after: JsonObject;
      request: RequestMetadata;
    }
  ): Promise<void> {
    await this.repository.recordEvent(trx, {
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

  async setSettings(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: PromotionSettingsInput,
    request: RequestMetadata
  ): Promise<{ settingsVersion: PromotionSettingsVersionView }> {
    await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.COMMERCIAL_MANAGE
    );
    const header = await this.repository.ensureAndLockSettings(
      trx,
      input.organizationId,
      input.propertyId,
      actor.userId
    );
    validateExpectedVersion(input.expectedVersion, header.current_version, "Promotion settings");
    const latest = await this.repository.latestSettingsEffectiveFrom(trx, input.propertyId);
    requireForwardTimeline(latest, input.effectiveFrom, "Promotion settings effectiveFrom");

    const row = await this.repository.insertSettingsVersion(trx, {
      organization_id: input.organizationId,
      property_id: input.propertyId,
      version_number: header.current_version + 1,
      effective_from: input.effectiveFrom,
      promotion_mode: input.promotionMode,
      created_by_user_id: actor.userId
    });
    await this.repository.advanceSettings(trx, input.propertyId, row.version_number, actor.userId);

    const view: PromotionSettingsVersionView = {
      id: row.id,
      version: row.version_number,
      effectiveFrom: row.effective_from,
      promotionMode: row.promotion_mode as PromotionSettingsVersionView["promotionMode"]
    };
    await this.materialChange(trx, actor, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      entityType: "PROMOTION_SETTINGS_VERSION",
      entityId: row.id,
      eventType: "PROMOTION_SETTINGS_VERSION_CREATED",
      action: "commercial.promotion.settings.version.created",
      aggregateType: "promotion_settings_version",
      outboxType: "commercial.promotion.settings.version.created.v1",
      after: view,
      request
    });
    return { settingsVersion: view };
  }

  async createCampaign(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreatePromotionCampaignInput,
    request: RequestMetadata
  ): Promise<{ campaign: PromotionCampaignView }> {
    await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.COMMERCIAL_MANAGE
    );

    const code = normalizeCode(input.code, "Promotion code", 2);
    const name = input.name.trim();
    if (name.length < 2 || name.length > 120) {
      throw new ValidationError("Promotion name must contain 2 to 120 characters");
    }
    const description = input.description?.trim() || null;
    if (description && description.length > 2000) {
      throw new ValidationError("Promotion description cannot exceed 2000 characters");
    }

    let publicCode: string | null = null;
    if (input.promotionKind === "PROMO_CODE") {
      if (!input.publicCode) {
        throw new ValidationError("PROMO_CODE campaigns require publicCode");
      }
      publicCode = normalizeCode(input.publicCode, "publicCode", 3);
    } else if (input.publicCode !== null) {
      throw new ValidationError("AUTOMATIC campaigns cannot define publicCode");
    }

    if (await this.repository.findCampaignByCode(trx, input.propertyId, code)) {
      throw new ConflictError(
        "A promotion campaign with this code already exists for the property"
      );
    }
    if (
      publicCode &&
      (await this.repository.findCampaignByPublicCode(trx, input.propertyId, publicCode))
    ) {
      throw new ConflictError("This public promotion code is already assigned within the property");
    }

    const row = await this.repository.createCampaign(trx, {
      organization_id: input.organizationId,
      property_id: input.propertyId,
      code,
      name,
      description,
      promotion_kind: input.promotionKind,
      public_code: publicCode,
      created_by_user_id: actor.userId,
      updated_by_user_id: actor.userId
    });
    const view = campaignView(row);
    await this.materialChange(trx, actor, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      entityType: "PROMOTION_CAMPAIGN",
      entityId: row.id,
      eventType: "PROMOTION_CAMPAIGN_CREATED",
      action: "commercial.promotion.campaign.created",
      aggregateType: "promotion_campaign",
      outboxType: "commercial.promotion.campaign.created.v1",
      after: view,
      request
    });
    return { campaign: view };
  }

  async createCampaignVersion(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreatePromotionCampaignVersionInput,
    request: RequestMetadata
  ): Promise<{ campaignVersion: PromotionCampaignVersionView }> {
    const property = await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.COMMERCIAL_MANAGE
    );
    const campaign = await this.repository.lockCampaign(
      trx,
      input.organizationId,
      input.propertyId,
      input.promotionCampaignId
    );
    if (!campaign) throw new NotFoundError("Promotion campaign not found");
    if (campaign.status !== "ACTIVE") {
      throw new ConflictError("Inactive promotion campaigns cannot receive new versions");
    }
    validateExpectedVersion(
      input.expectedCurrentVersion,
      campaign.current_version,
      "Promotion campaign"
    );
    const latest = await this.repository.latestCampaignVersionEffectiveFrom(trx, campaign.id);
    requireForwardTimeline(latest, input.effectiveFrom, "Promotion campaign effectiveFrom");

    validateOptionalWindow(input.bookingWindowStart, input.bookingWindowEnd, "booking");
    validateOptionalWindow(input.arrivalWindowStart, input.arrivalWindowEnd, "arrival");
    if (
      !Number.isInteger(input.minimumStayNights) ||
      input.minimumStayNights < 1 ||
      input.minimumStayNights > 365
    ) {
      throw new ValidationError("minimumStayNights must be an integer between 1 and 365");
    }
    if (input.minimumSpendMinor !== null)
      validateMoney(input.minimumSpendMinor, "minimumSpendMinor");
    if (input.discountType === "PERCENTAGE") {
      if (
        !Number.isInteger(input.discountValue) ||
        input.discountValue < 1 ||
        input.discountValue > MAX_BASIS_POINTS
      ) {
        throw new ValidationError(
          "Percentage discountValue must be between 1 and 10000 basis points"
        );
      }
      if (input.maximumDiscountMinor !== null)
        validateMoney(input.maximumDiscountMinor, "maximumDiscountMinor", false);
    } else {
      validateMoney(input.discountValue, "discountValue", false);
      if (input.maximumDiscountMinor !== null) {
        throw new ValidationError("FIXED_AMOUNT promotions must not define maximumDiscountMinor");
      }
    }
    if (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 100_000) {
      throw new ValidationError("priority must be an integer between 0 and 100000");
    }

    const stackGroup = input.stackGroup?.trim().toUpperCase() || null;
    if (stackGroup && !/^[A-Z0-9_-]{2,40}$/.test(stackGroup)) {
      throw new ValidationError("stackGroup must use 2-40 letters, numbers, _ or -");
    }
    if (input.stackingMode === "EXCLUSIVE" && stackGroup !== null) {
      throw new ValidationError("EXCLUSIVE promotions cannot define stackGroup");
    }

    const row = await this.repository.createCampaignVersion(trx, {
      promotion_campaign_id: campaign.id,
      organization_id: input.organizationId,
      property_id: input.propertyId,
      version_number: campaign.current_version + 1,
      effective_from: input.effectiveFrom,
      currency_code: property.currency_code,
      booking_window_start: input.bookingWindowStart,
      booking_window_end: input.bookingWindowEnd,
      arrival_window_start: input.arrivalWindowStart,
      arrival_window_end: input.arrivalWindowEnd,
      minimum_stay_nights: input.minimumStayNights,
      minimum_spend_minor: input.minimumSpendMinor,
      discount_type: input.discountType,
      discount_value: input.discountValue,
      maximum_discount_minor: input.maximumDiscountMinor,
      applies_to: input.appliesTo,
      priority: input.priority,
      stacking_mode: input.stackingMode,
      stack_group: stackGroup,
      created_by_user_id: actor.userId
    });
    await this.repository.advanceCampaign(trx, campaign.id, row.version_number, actor.userId);

    const view: PromotionCampaignVersionView = {
      id: row.id,
      promotionCampaignId: row.promotion_campaign_id,
      version: row.version_number,
      effectiveFrom: row.effective_from,
      currencyCode: row.currency_code,
      bookingWindowStart: row.booking_window_start,
      bookingWindowEnd: row.booking_window_end,
      arrivalWindowStart: row.arrival_window_start,
      arrivalWindowEnd: row.arrival_window_end,
      minimumStayNights: row.minimum_stay_nights,
      minimumSpendMinor: row.minimum_spend_minor,
      discountType: row.discount_type as PromotionCampaignVersionView["discountType"],
      discountValue: row.discount_value,
      maximumDiscountMinor: row.maximum_discount_minor,
      appliesTo: row.applies_to as PromotionCampaignVersionView["appliesTo"],
      priority: row.priority,
      stackingMode: row.stacking_mode as PromotionCampaignVersionView["stackingMode"],
      stackGroup: row.stack_group
    };
    await this.materialChange(trx, actor, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      entityType: "PROMOTION_CAMPAIGN_VERSION",
      entityId: row.id,
      eventType: "PROMOTION_CAMPAIGN_VERSION_CREATED",
      action: "commercial.promotion.campaign.version.created",
      aggregateType: "promotion_campaign_version",
      outboxType: "commercial.promotion.campaign.version.created.v1",
      after: view,
      request
    });
    return { campaignVersion: view };
  }

  private async validateAssignmentTarget(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    input: CreatePromotionAssignmentInput
  ): Promise<void> {
    validateAssignmentShape(input);
    if (input.ratePlanId) {
      const plan = await this.repository.findRatePlan(
        trx,
        organizationId,
        propertyId,
        input.ratePlanId
      );
      if (!plan) throw new NotFoundError("Rate plan not found for promotion assignment");
    }
    if (input.rateProductId) {
      const product = await this.repository.findRateProduct(
        trx,
        organizationId,
        propertyId,
        input.rateProductId
      );
      if (!product) throw new NotFoundError("Rate product not found for promotion assignment");
    }
  }

  async createAssignment(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreatePromotionAssignmentInput,
    request: RequestMetadata
  ): Promise<{ assignment: PromotionAssignmentView }> {
    await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.COMMERCIAL_MANAGE
    );
    const campaign = await this.repository.lockCampaign(
      trx,
      input.organizationId,
      input.propertyId,
      input.promotionCampaignId
    );
    if (!campaign) throw new NotFoundError("Promotion campaign not found");
    if (campaign.status !== "ACTIVE" || campaign.current_version < 1) {
      throw new ConflictError("Promotion campaign must be active and versioned before assignment");
    }
    await this.validateAssignmentTarget(trx, input.organizationId, input.propertyId, input);
    if (
      input.enabled &&
      !(await this.repository.hasEffectiveCampaignVersion(trx, campaign.id, input.effectiveFrom))
    ) {
      throw new ConflictError(
        "Enabled promotion assignment requires a campaign version effective on the assignment date"
      );
    }
    const latest = await this.repository.latestAssignmentEffectiveFrom(
      trx,
      campaign.id,
      input.scopeType,
      input.ratePlanId,
      input.rateProductId
    );
    requireForwardTimeline(latest, input.effectiveFrom, "Promotion assignment effectiveFrom");

    const row = await this.repository.createAssignment(trx, {
      organization_id: input.organizationId,
      property_id: input.propertyId,
      promotion_campaign_id: campaign.id,
      scope_type: input.scopeType,
      rate_plan_id: input.ratePlanId,
      rate_product_id: input.rateProductId,
      effective_from: input.effectiveFrom,
      enabled: input.enabled,
      created_by_user_id: actor.userId
    });
    const view: PromotionAssignmentView = {
      id: row.id,
      promotionCampaignId: row.promotion_campaign_id,
      scopeType: row.scope_type as CommercialScopeType,
      ratePlanId: row.rate_plan_id,
      rateProductId: row.rate_product_id,
      effectiveFrom: row.effective_from,
      enabled: row.enabled
    };
    await this.materialChange(trx, actor, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      entityType: "PROMOTION_ASSIGNMENT",
      entityId: row.id,
      eventType: "PROMOTION_ASSIGNMENT_CREATED",
      action: "commercial.promotion.assignment.created",
      aggregateType: "promotion_assignment",
      outboxType: "commercial.promotion.assignment.created.v1",
      after: view,
      request
    });
    return { assignment: view };
  }

  async getConfiguration(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string
  ): Promise<JsonObject> {
    await this.property(trx, actor, organizationId, propertyId, Permissions.COMMERCIAL_READ);
    return this.repository.getConfiguration(trx, organizationId, propertyId);
  }
}

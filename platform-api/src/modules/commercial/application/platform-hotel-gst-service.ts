import { sql, type Selectable, type Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";

type Trx = Transaction<Database>;
type GstRule = Selectable<Database["platform_hotel_gst_rule_versions"]>;

const LOWER_POLICY_CODE = "INDIA_GST_UPTO_THRESHOLD";
const UPPER_POLICY_CODE = "INDIA_GST_ABOVE_THRESHOLD";
const LEGACY_OWNER_GST_CODE = "GST";

interface CreateGstRuleInput {
  effectiveFrom: string;
  thresholdMinor: number;
  lowerRateBasisPoints: number;
  upperRateBasisPoints: number;
  lowerItcAvailable: boolean;
  upperItcAvailable: boolean;
  sourceUrl: string;
}

function currentDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function validateDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new ValidationError(`${field} must be a valid ISO date`);
  }
}

function validateBasisPoints(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000 || value % 2 !== 0) {
    throw new ValidationError(`${field} must be an even integer between 0 and 10000`);
  }
}

function ruleText(input: CreateGstRuleInput): string {
  const threshold = (input.thresholdMinor / 100).toLocaleString("en-IN");
  const lowerRate = input.lowerRateBasisPoints / 100;
  const upperRate = input.upperRateBasisPoints / 100;
  return `Hotel accommodation up to and including INR ${threshold} per room or accommodation unit per day attracts ${lowerRate}% GST ${input.lowerItcAvailable ? "with" : "without"} input tax credit (CGST ${lowerRate / 2}% and SGST ${lowerRate / 2}%). A value above INR ${threshold} attracts ${upperRate}% GST ${input.upperItcAvailable ? "with" : "without"} input tax credit (CGST ${upperRate / 2}% and SGST ${upperRate / 2}%).`;
}

function ruleView(rule: GstRule): JsonObject {
  return {
    id: rule.id,
    version: rule.version_number,
    effectiveFrom: rule.effective_from,
    thresholdMinor: rule.threshold_minor,
    lower: {
      rateBasisPoints: rule.lower_rate_basis_points,
      cgstBasisPoints: rule.lower_rate_basis_points / 2,
      sgstBasisPoints: rule.lower_rate_basis_points / 2,
      itcAvailable: rule.lower_itc_available
    },
    upper: {
      rateBasisPoints: rule.upper_rate_basis_points,
      cgstBasisPoints: rule.upper_rate_basis_points / 2,
      sgstBasisPoints: rule.upper_rate_basis_points / 2,
      itcAvailable: rule.upper_itc_available
    },
    sourceUrl: rule.source_url,
    ruleText: rule.rule_text,
    createdAt: rule.created_at.toISOString()
  };
}

function consentText(rule: GstRule): string {
  return `I accept Wildleaf's platform-controlled Indian hotel GST schedule, currently version ${rule.version_number} effective ${rule.effective_from}. I authorize Wildleaf to calculate and display statutory GST using this schedule and future effective-dated statutory updates maintained by Wildleaf management. I understand that room rates and inventory remain controlled by the property.`;
}

export class PlatformHotelGstService {
  constructor(private readonly authorization = new AuthorizationService()) {}

  private async property(
    trx: Trx,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    permission: typeof Permissions.COMMERCIAL_READ | typeof Permissions.COMMERCIAL_MANAGE
  ) {
    this.authorization.assert(actor, permission, {
      kind: "property",
      organizationId,
      propertyId
    });
    const property = await trx
      .selectFrom("properties")
      .select(["id", "organization_id", "country_code", "status"])
      .where("id", "=", propertyId)
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();
    if (!property) throw new NotFoundError("Property not found");
    if (property.status === "ARCHIVED") {
      throw new ConflictError("GST consent cannot be managed for an archived property");
    }
    return property;
  }

  private async currentRule(trx: Trx): Promise<GstRule> {
    const rule = await trx
      .selectFrom("platform_hotel_gst_rule_versions")
      .selectAll()
      .where("effective_from", "<=", currentDate())
      .orderBy("effective_from", "desc")
      .executeTakeFirst();
    if (!rule) throw new ConflictError("No effective Indian hotel GST rule is configured");
    return rule;
  }

  async getOwnerConsent(
    trx: Trx,
    actor: ActorContext,
    organizationId: string,
    propertyId: string
  ): Promise<JsonObject> {
    const property = await this.property(
      trx,
      actor,
      organizationId,
      propertyId,
      Permissions.COMMERCIAL_READ
    );
    const current = await this.currentRule(trx);
    const consent = await trx
      .selectFrom("property_hotel_gst_consents")
      .selectAll()
      .where("property_id", "=", propertyId)
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    if (consent) await this.syncAcceptedRules(trx, organizationId, propertyId);

    return {
      applicable: property.country_code === "IN",
      accepted: Boolean(consent),
      currentRule: ruleView(current),
      acceptanceText: consentText(current),
      consent: consent
        ? {
            acceptedRuleVersionId: consent.accepted_rule_version_id,
            acceptedByUserId: consent.accepted_by_user_id,
            acceptedAt: consent.accepted_at.toISOString(),
            acceptanceText: consent.acceptance_text
          }
        : null
    };
  }

  async acceptOwnerConsent(
    trx: Trx,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      ruleVersionId: string;
      accepted: boolean;
    },
    request: RequestMetadata
  ): Promise<JsonObject> {
    const property = await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.COMMERCIAL_MANAGE
    );
    if (property.country_code !== "IN") {
      throw new ConflictError("The Indian hotel GST schedule only applies to properties in India");
    }
    if (!input.accepted) {
      throw new ValidationError("GST consent must be accepted to enable online booking");
    }
    const current = await this.currentRule(trx);
    if (input.ruleVersionId !== current.id) {
      throw new ConflictError("The GST rule changed. Review the current rule and accept again");
    }

    const acceptance = consentText(current);
    const inserted = await trx
      .insertInto("property_hotel_gst_consents")
      .values({
        property_id: input.propertyId,
        organization_id: input.organizationId,
        accepted_rule_version_id: current.id,
        acceptance_text: acceptance,
        accepted_by_user_id: actor.userId,
        ip_address: request.ipAddress,
        user_agent: request.userAgent
      })
      .onConflict((oc) => oc.column("property_id").doNothing())
      .returningAll()
      .executeTakeFirst();

    if (inserted) {
      const after: JsonObject = {
        propertyId: input.propertyId,
        acceptedRuleVersionId: current.id,
        acceptedRuleVersion: current.version_number,
        acceptanceText: acceptance,
        acceptedAt: inserted.accepted_at.toISOString()
      };
      await new AuditService(trx).record({
        actor,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        action: "commercial.hotel_gst.consent.accepted",
        entityType: "property_hotel_gst_consent",
        entityId: input.propertyId,
        after,
        request
      });
      await new OutboxService(trx).enqueue({
        aggregateType: "property_hotel_gst_consent",
        aggregateId: input.propertyId,
        eventType: "commercial.hotel_gst.consent.accepted.v1",
        payload: after
      });
    }

    await this.syncAcceptedRules(trx, input.organizationId, input.propertyId);
    return this.getOwnerConsent(trx, actor, input.organizationId, input.propertyId);
  }

  async listRules(trx: Trx, actor: ActorContext): Promise<JsonObject> {
    this.authorization.assert(actor, Permissions.PLATFORM_MANAGE, { kind: "platform" });
    const rows = await trx
      .selectFrom("platform_hotel_gst_rule_versions")
      .selectAll()
      .orderBy("version_number", "desc")
      .execute();
    return { rules: rows.map(ruleView) };
  }

  async createRule(
    trx: Trx,
    actor: ActorContext,
    input: CreateGstRuleInput,
    request: RequestMetadata
  ): Promise<JsonObject> {
    this.authorization.assert(actor, Permissions.PLATFORM_MANAGE, { kind: "platform" });
    validateDate(input.effectiveFrom, "effectiveFrom");
    if (!Number.isInteger(input.thresholdMinor) || input.thresholdMinor <= 0) {
      throw new ValidationError("thresholdMinor must be a positive integer");
    }
    validateBasisPoints(input.lowerRateBasisPoints, "lowerRateBasisPoints");
    validateBasisPoints(input.upperRateBasisPoints, "upperRateBasisPoints");
    if (input.upperRateBasisPoints <= input.lowerRateBasisPoints) {
      throw new ValidationError("The upper GST rate must be greater than the lower GST rate");
    }
    let source: URL;
    try {
      source = new URL(input.sourceUrl);
    } catch {
      throw new ValidationError("sourceUrl must be a valid HTTPS URL");
    }
    if (source.protocol !== "https:") {
      throw new ValidationError("sourceUrl must be a valid HTTPS URL");
    }

    await sql`select pg_advisory_xact_lock(hashtext('platform-hotel-gst-rules'))`.execute(trx);
    const latest = await trx
      .selectFrom("platform_hotel_gst_rule_versions")
      .select(["version_number", "effective_from"])
      .orderBy("version_number", "desc")
      .executeTakeFirst();
    if (latest && input.effectiveFrom <= latest.effective_from) {
      throw new ConflictError("A new GST rule must start after the latest effective date");
    }

    const created = await trx
      .insertInto("platform_hotel_gst_rule_versions")
      .values({
        version_number: (latest?.version_number ?? 0) + 1,
        effective_from: input.effectiveFrom,
        threshold_minor: input.thresholdMinor,
        lower_rate_basis_points: input.lowerRateBasisPoints,
        upper_rate_basis_points: input.upperRateBasisPoints,
        lower_itc_available: input.lowerItcAvailable,
        upper_itc_available: input.upperItcAvailable,
        source_url: input.sourceUrl,
        rule_text: ruleText(input),
        created_by_user_id: actor.userId
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const after = ruleView(created);
    await new AuditService(trx).record({
      actor,
      action: "platform.hotel_gst.rule.created",
      entityType: "platform_hotel_gst_rule_version",
      entityId: created.id,
      after,
      request
    });
    await new OutboxService(trx).enqueue({
      aggregateType: "platform_hotel_gst_rule_version",
      aggregateId: created.id,
      eventType: "platform.hotel_gst.rule.created.v1",
      payload: after
    });
    return { rule: after };
  }

  private async ensurePolicy(
    trx: Trx,
    organizationId: string,
    propertyId: string,
    code: string,
    name: string,
    createdByUserId: string | null
  ) {
    await trx
      .insertInto("commercial_tax_policies")
      .values({
        organization_id: organizationId,
        property_id: propertyId,
        code,
        name,
        description:
          "Platform-controlled Indian hotel GST. Property owners cannot edit this policy.",
        created_by_user_id: createdByUserId,
        updated_by_user_id: createdByUserId
      })
      .onConflict((oc) => oc.columns(["property_id", "code"]).doNothing())
      .execute();
    return trx
      .selectFrom("commercial_tax_policies")
      .selectAll()
      .where("property_id", "=", propertyId)
      .where("organization_id", "=", organizationId)
      .where("code", "=", code)
      .forUpdate()
      .executeTakeFirstOrThrow();
  }

  private async ensurePolicyVersion(
    trx: Trx,
    rule: GstRule,
    policy: Selectable<Database["commercial_tax_policies"]>,
    input: {
      minimumBasisMinor: number | null;
      maximumBasisMinor: number | null;
      totalRateBasisPoints: number;
    }
  ) {
    const existing = await trx
      .selectFrom("commercial_tax_policy_versions")
      .selectAll()
      .where("tax_policy_id", "=", policy.id)
      .where("effective_from", "=", rule.effective_from)
      .executeTakeFirst();
    if (existing) return existing;

    const version = await trx
      .insertInto("commercial_tax_policy_versions")
      .values({
        tax_policy_id: policy.id,
        organization_id: policy.organization_id,
        property_id: policy.property_id,
        version_number: policy.current_version + 1,
        effective_from: rule.effective_from,
        price_mode: "EXCLUSIVE",
        selection_basis: "NIGHTLY_UNIT_RATE",
        minimum_basis_minor: input.minimumBasisMinor,
        maximum_basis_minor: input.maximumBasisMinor,
        applies_to_accommodation: true,
        applies_to_extra_guest: true,
        applies_to_fee: false,
        sealed_at: null,
        created_by_user_id: rule.created_by_user_id
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("commercial_tax_components")
      .values([
        {
          tax_policy_version_id: version.id,
          organization_id: policy.organization_id,
          property_id: policy.property_id,
          component_code: "CGST",
          component_name: "Central GST",
          rate_basis_points: input.totalRateBasisPoints / 2,
          sort_order: 0
        },
        {
          tax_policy_version_id: version.id,
          organization_id: policy.organization_id,
          property_id: policy.property_id,
          component_code: "SGST",
          component_name: "State GST",
          rate_basis_points: input.totalRateBasisPoints / 2,
          sort_order: 1
        }
      ])
      .execute();
    const sealed = await trx
      .updateTable("commercial_tax_policy_versions")
      .set({ sealed_at: new Date() })
      .where("id", "=", version.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx
      .updateTable("commercial_tax_policies")
      .set({
        current_version: sealed.version_number,
        updated_by_user_id: rule.created_by_user_id,
        updated_at: new Date()
      })
      .where("id", "=", policy.id)
      .execute();
    return sealed;
  }

  private async ensureAssignment(
    trx: Trx,
    organizationId: string,
    propertyId: string,
    policyId: string,
    effectiveFrom: string,
    createdByUserId: string | null
  ): Promise<void> {
    await trx
      .insertInto("commercial_tax_assignments")
      .values({
        organization_id: organizationId,
        property_id: propertyId,
        tax_policy_id: policyId,
        scope_type: "PROPERTY",
        rate_plan_id: null,
        rate_product_id: null,
        effective_from: effectiveFrom,
        enabled: true,
        created_by_user_id: createdByUserId
      })
      .onConflict((oc) =>
        oc
          .columns([
            "tax_policy_id",
            "scope_type",
            "rate_plan_id",
            "rate_product_id",
            "effective_from"
          ])
          .doNothing()
      )
      .execute();
  }

  async syncAcceptedRules(trx: Trx, organizationId: string, propertyId: string): Promise<boolean> {
    const consent = await trx
      .selectFrom("property_hotel_gst_consents as c")
      .innerJoin(
        "platform_hotel_gst_rule_versions as accepted",
        "accepted.id",
        "c.accepted_rule_version_id"
      )
      .select([
        "c.accepted_by_user_id",
        "c.accepted_at",
        "accepted.version_number as accepted_version_number"
      ])
      .where("c.property_id", "=", propertyId)
      .where("c.organization_id", "=", organizationId)
      .executeTakeFirst();
    if (!consent) return false;

    const rules = await trx
      .selectFrom("platform_hotel_gst_rule_versions")
      .selectAll()
      .where("version_number", ">=", consent.accepted_version_number)
      .orderBy("version_number", "asc")
      .execute();

    const synced = new Set(
      (
        await trx
          .selectFrom("property_hotel_gst_rule_syncs")
          .select("rule_version_id")
          .where("property_id", "=", propertyId)
          .execute()
      ).map((row) => row.rule_version_id)
    );
    let pending = rules.filter((rule) => !synced.has(rule.id));
    if (!pending.length) return true;

    // Only the first quote after a platform rule change needs a write lock.
    // Steady-state quote traffic remains read-only and does not serialize per property.
    await sql`select pg_advisory_xact_lock(hashtext(${propertyId}))`.execute(trx);
    const syncedAfterLock = new Set(
      (
        await trx
          .selectFrom("property_hotel_gst_rule_syncs")
          .select("rule_version_id")
          .where("property_id", "=", propertyId)
          .execute()
      ).map((row) => row.rule_version_id)
    );
    pending = rules.filter((rule) => !syncedAfterLock.has(rule.id));
    if (!pending.length) return true;

    const legacyPolicy = await trx
      .selectFrom("commercial_tax_policies")
      .select("id")
      .where("property_id", "=", propertyId)
      .where("organization_id", "=", organizationId)
      .where("code", "=", LEGACY_OWNER_GST_CODE)
      .executeTakeFirst();
    if (legacyPolicy) {
      await trx
        .updateTable("commercial_tax_assignments")
        .set({ enabled: false })
        .where("tax_policy_id", "=", legacyPolicy.id)
        .execute();
    }

    let lowerPolicy = await this.ensurePolicy(
      trx,
      organizationId,
      propertyId,
      LOWER_POLICY_CODE,
      "India hotel GST - lower room-value slab",
      consent.accepted_by_user_id
    );
    let upperPolicy = await this.ensurePolicy(
      trx,
      organizationId,
      propertyId,
      UPPER_POLICY_CODE,
      "India hotel GST - upper room-value slab",
      consent.accepted_by_user_id
    );

    for (const rule of pending) {
      lowerPolicy = await trx
        .selectFrom("commercial_tax_policies")
        .selectAll()
        .where("id", "=", lowerPolicy.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const lowerVersion = await this.ensurePolicyVersion(trx, rule, lowerPolicy, {
        minimumBasisMinor: null,
        maximumBasisMinor: rule.threshold_minor + 1,
        totalRateBasisPoints: rule.lower_rate_basis_points
      });

      upperPolicy = await trx
        .selectFrom("commercial_tax_policies")
        .selectAll()
        .where("id", "=", upperPolicy.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const upperVersion = await this.ensurePolicyVersion(trx, rule, upperPolicy, {
        minimumBasisMinor: rule.threshold_minor + 1,
        maximumBasisMinor: null,
        totalRateBasisPoints: rule.upper_rate_basis_points
      });

      await this.ensureAssignment(
        trx,
        organizationId,
        propertyId,
        lowerPolicy.id,
        rule.effective_from,
        rule.created_by_user_id ?? consent.accepted_by_user_id
      );
      await this.ensureAssignment(
        trx,
        organizationId,
        propertyId,
        upperPolicy.id,
        rule.effective_from,
        rule.created_by_user_id ?? consent.accepted_by_user_id
      );
      await trx
        .insertInto("property_hotel_gst_rule_syncs")
        .values({
          organization_id: organizationId,
          property_id: propertyId,
          rule_version_id: rule.id,
          lower_tax_policy_version_id: lowerVersion.id,
          upper_tax_policy_version_id: upperVersion.id
        })
        .onConflict((oc) => oc.columns(["property_id", "rule_version_id"]).doNothing())
        .execute();
    }
    return true;
  }
}

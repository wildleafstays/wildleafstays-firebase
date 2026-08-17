import type { Insertable, Selectable, Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";

export type PropertyCommercialSettingsRecord = Selectable<Database["property_commercial_settings"]>;
export type PropertyCommercialSettingsVersionRecord = Selectable<
  Database["property_commercial_setting_versions"]
>;
export type TaxPolicyRecord = Selectable<Database["commercial_tax_policies"]>;
export type TaxPolicyVersionRecord = Selectable<Database["commercial_tax_policy_versions"]>;
export type TaxComponentRecord = Selectable<Database["commercial_tax_components"]>;
export type TaxAssignmentRecord = Selectable<Database["commercial_tax_assignments"]>;
export type FeePolicyRecord = Selectable<Database["commercial_fee_policies"]>;
export type FeePolicyVersionRecord = Selectable<Database["commercial_fee_policy_versions"]>;
export type FeeAssignmentRecord = Selectable<Database["commercial_fee_assignments"]>;
export type CancellationPolicyRecord = Selectable<Database["cancellation_policies"]>;
export type CancellationPolicyVersionRecord = Selectable<Database["cancellation_policy_versions"]>;
export type CancellationTierRecord = Selectable<Database["cancellation_policy_tiers"]>;
export type CancellationAssignmentRecord = Selectable<
  Database["rate_plan_cancellation_assignments"]
>;
export type GuestAgePolicyRecord = Selectable<Database["guest_age_policies"]>;
export type GuestAgePolicyVersionRecord = Selectable<Database["guest_age_policy_versions"]>;

type Trx = Transaction<Database>;

export interface PropertyCommercialContext {
  id: string;
  organization_id: string;
  status: string;
  currency_code: string;
}

export class CommercialRuleRepository {
  async findPropertyContext(
    trx: Trx,
    organizationId: string,
    propertyId: string
  ): Promise<PropertyCommercialContext | undefined> {
    return trx
      .selectFrom("properties as p")
      .innerJoin("organizations as o", "o.id", "p.organization_id")
      .select([
        "p.id as id",
        "p.organization_id as organization_id",
        "p.status as status",
        "o.currency_code as currency_code"
      ])
      .where("p.id", "=", propertyId)
      .where("p.organization_id", "=", organizationId)
      .executeTakeFirst();
  }

  async ensureAndLockPropertyCommercialSettings(
    trx: Trx,
    organizationId: string,
    propertyId: string,
    userId: string
  ): Promise<PropertyCommercialSettingsRecord> {
    await trx
      .insertInto("property_commercial_settings")
      .values({
        property_id: propertyId,
        organization_id: organizationId,
        created_by_user_id: userId,
        updated_by_user_id: userId
      })
      .onConflict((oc) => oc.column("property_id").doNothing())
      .execute();

    return trx
      .selectFrom("property_commercial_settings")
      .selectAll()
      .where("property_id", "=", propertyId)
      .where("organization_id", "=", organizationId)
      .forUpdate()
      .executeTakeFirstOrThrow();
  }

  async latestPropertyCommercialSettingsEffectiveFrom(
    trx: Trx,
    propertyId: string
  ): Promise<string | null> {
    const row = await trx
      .selectFrom("property_commercial_setting_versions")
      .select("effective_from")
      .where("property_id", "=", propertyId)
      .orderBy("effective_from", "desc")
      .executeTakeFirst();
    return row?.effective_from ?? null;
  }

  async insertPropertyCommercialSettingsVersion(
    trx: Trx,
    values: Insertable<Database["property_commercial_setting_versions"]>
  ): Promise<PropertyCommercialSettingsVersionRecord> {
    return trx
      .insertInto("property_commercial_setting_versions")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async advancePropertyCommercialSettings(
    trx: Trx,
    propertyId: string,
    version: number,
    userId: string
  ): Promise<void> {
    await trx
      .updateTable("property_commercial_settings")
      .set({ current_version: version, updated_by_user_id: userId, updated_at: new Date() })
      .where("property_id", "=", propertyId)
      .executeTakeFirstOrThrow();
  }

  async findTaxPolicyByCode(
    trx: Trx,
    propertyId: string,
    code: string
  ): Promise<{ id: string } | undefined> {
    return trx
      .selectFrom("commercial_tax_policies")
      .select("id")
      .where("property_id", "=", propertyId)
      .where("code", "=", code)
      .executeTakeFirst();
  }

  async findFeePolicyByCode(
    trx: Trx,
    propertyId: string,
    code: string
  ): Promise<{ id: string } | undefined> {
    return trx
      .selectFrom("commercial_fee_policies")
      .select("id")
      .where("property_id", "=", propertyId)
      .where("code", "=", code)
      .executeTakeFirst();
  }

  async findCancellationPolicyByCode(
    trx: Trx,
    propertyId: string,
    code: string
  ): Promise<{ id: string } | undefined> {
    return trx
      .selectFrom("cancellation_policies")
      .select("id")
      .where("property_id", "=", propertyId)
      .where("code", "=", code)
      .executeTakeFirst();
  }

  async createTaxPolicy(
    trx: Trx,
    values: Insertable<Database["commercial_tax_policies"]>
  ): Promise<TaxPolicyRecord> {
    return trx
      .insertInto("commercial_tax_policies")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async lockTaxPolicy(
    trx: Trx,
    organizationId: string,
    propertyId: string,
    policyId: string
  ): Promise<TaxPolicyRecord | undefined> {
    return trx
      .selectFrom("commercial_tax_policies")
      .selectAll()
      .where("id", "=", policyId)
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .forUpdate()
      .executeTakeFirst();
  }

  async latestTaxVersionEffectiveFrom(trx: Trx, policyId: string): Promise<string | null> {
    const row = await trx
      .selectFrom("commercial_tax_policy_versions")
      .select("effective_from")
      .where("tax_policy_id", "=", policyId)
      .orderBy("effective_from", "desc")
      .executeTakeFirst();
    return row?.effective_from ?? null;
  }

  async hasEffectiveTaxVersion(trx: Trx, policyId: string, effectiveOn: string): Promise<boolean> {
    const row = await trx
      .selectFrom("commercial_tax_policy_versions")
      .select("id")
      .where("tax_policy_id", "=", policyId)
      .where("effective_from", "<=", effectiveOn)
      .where("sealed_at", "is not", null)
      .orderBy("effective_from", "desc")
      .executeTakeFirst();
    return Boolean(row);
  }

  async createTaxVersion(
    trx: Trx,
    values: Insertable<Database["commercial_tax_policy_versions"]>
  ): Promise<TaxPolicyVersionRecord> {
    return trx
      .insertInto("commercial_tax_policy_versions")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async createTaxComponents(
    trx: Trx,
    values: Insertable<Database["commercial_tax_components"]>[]
  ): Promise<TaxComponentRecord[]> {
    return trx.insertInto("commercial_tax_components").values(values).returningAll().execute();
  }

  async sealTaxVersion(trx: Trx, versionId: string): Promise<TaxPolicyVersionRecord> {
    return trx
      .updateTable("commercial_tax_policy_versions")
      .set({ sealed_at: new Date() })
      .where("id", "=", versionId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async advanceTaxPolicy(
    trx: Trx,
    policyId: string,
    version: number,
    userId: string
  ): Promise<void> {
    await trx
      .updateTable("commercial_tax_policies")
      .set({ current_version: version, updated_by_user_id: userId, updated_at: new Date() })
      .where("id", "=", policyId)
      .executeTakeFirstOrThrow();
  }

  async latestTaxAssignmentEffectiveFrom(
    trx: Trx,
    policyId: string,
    scopeType: string,
    ratePlanId: string | null,
    rateProductId: string | null
  ): Promise<string | null> {
    const row = await trx
      .selectFrom("commercial_tax_assignments")
      .select("effective_from")
      .where("tax_policy_id", "=", policyId)
      .where("scope_type", "=", scopeType)
      .where((eb) =>
        eb.and([
          ratePlanId === null
            ? eb("rate_plan_id", "is", null)
            : eb("rate_plan_id", "=", ratePlanId),
          rateProductId === null
            ? eb("rate_product_id", "is", null)
            : eb("rate_product_id", "=", rateProductId)
        ])
      )
      .orderBy("effective_from", "desc")
      .executeTakeFirst();
    return row?.effective_from ?? null;
  }

  async createTaxAssignment(
    trx: Trx,
    values: Insertable<Database["commercial_tax_assignments"]>
  ): Promise<TaxAssignmentRecord> {
    return trx
      .insertInto("commercial_tax_assignments")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async createFeePolicy(
    trx: Trx,
    values: Insertable<Database["commercial_fee_policies"]>
  ): Promise<FeePolicyRecord> {
    return trx
      .insertInto("commercial_fee_policies")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async lockFeePolicy(
    trx: Trx,
    organizationId: string,
    propertyId: string,
    policyId: string
  ): Promise<FeePolicyRecord | undefined> {
    return trx
      .selectFrom("commercial_fee_policies")
      .selectAll()
      .where("id", "=", policyId)
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .forUpdate()
      .executeTakeFirst();
  }

  async latestFeeVersionEffectiveFrom(trx: Trx, policyId: string): Promise<string | null> {
    const row = await trx
      .selectFrom("commercial_fee_policy_versions")
      .select("effective_from")
      .where("fee_policy_id", "=", policyId)
      .orderBy("effective_from", "desc")
      .executeTakeFirst();
    return row?.effective_from ?? null;
  }

  async hasEffectiveFeeVersion(trx: Trx, policyId: string, effectiveOn: string): Promise<boolean> {
    const row = await trx
      .selectFrom("commercial_fee_policy_versions")
      .select("id")
      .where("fee_policy_id", "=", policyId)
      .where("effective_from", "<=", effectiveOn)
      .orderBy("effective_from", "desc")
      .executeTakeFirst();
    return Boolean(row);
  }

  async createFeeVersion(
    trx: Trx,
    values: Insertable<Database["commercial_fee_policy_versions"]>
  ): Promise<FeePolicyVersionRecord> {
    return trx
      .insertInto("commercial_fee_policy_versions")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async advanceFeePolicy(
    trx: Trx,
    policyId: string,
    version: number,
    userId: string
  ): Promise<void> {
    await trx
      .updateTable("commercial_fee_policies")
      .set({ current_version: version, updated_by_user_id: userId, updated_at: new Date() })
      .where("id", "=", policyId)
      .executeTakeFirstOrThrow();
  }

  async latestFeeAssignmentEffectiveFrom(
    trx: Trx,
    policyId: string,
    scopeType: string,
    ratePlanId: string | null,
    rateProductId: string | null
  ): Promise<string | null> {
    const row = await trx
      .selectFrom("commercial_fee_assignments")
      .select("effective_from")
      .where("fee_policy_id", "=", policyId)
      .where("scope_type", "=", scopeType)
      .where((eb) =>
        eb.and([
          ratePlanId === null
            ? eb("rate_plan_id", "is", null)
            : eb("rate_plan_id", "=", ratePlanId),
          rateProductId === null
            ? eb("rate_product_id", "is", null)
            : eb("rate_product_id", "=", rateProductId)
        ])
      )
      .orderBy("effective_from", "desc")
      .executeTakeFirst();
    return row?.effective_from ?? null;
  }

  async createFeeAssignment(
    trx: Trx,
    values: Insertable<Database["commercial_fee_assignments"]>
  ): Promise<FeeAssignmentRecord> {
    return trx
      .insertInto("commercial_fee_assignments")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async createCancellationPolicy(
    trx: Trx,
    values: Insertable<Database["cancellation_policies"]>
  ): Promise<CancellationPolicyRecord> {
    return trx
      .insertInto("cancellation_policies")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async lockCancellationPolicy(
    trx: Trx,
    organizationId: string,
    propertyId: string,
    policyId: string
  ): Promise<CancellationPolicyRecord | undefined> {
    return trx
      .selectFrom("cancellation_policies")
      .selectAll()
      .where("id", "=", policyId)
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .forUpdate()
      .executeTakeFirst();
  }

  async latestCancellationVersionEffectiveFrom(trx: Trx, policyId: string): Promise<string | null> {
    const row = await trx
      .selectFrom("cancellation_policy_versions")
      .select("effective_from")
      .where("cancellation_policy_id", "=", policyId)
      .orderBy("effective_from", "desc")
      .executeTakeFirst();
    return row?.effective_from ?? null;
  }

  async hasEffectiveCancellationVersion(
    trx: Trx,
    policyId: string,
    effectiveOn: string
  ): Promise<boolean> {
    const row = await trx
      .selectFrom("cancellation_policy_versions")
      .select("id")
      .where("cancellation_policy_id", "=", policyId)
      .where("effective_from", "<=", effectiveOn)
      .where("sealed_at", "is not", null)
      .orderBy("effective_from", "desc")
      .executeTakeFirst();
    return Boolean(row);
  }

  async createCancellationVersion(
    trx: Trx,
    values: Insertable<Database["cancellation_policy_versions"]>
  ): Promise<CancellationPolicyVersionRecord> {
    return trx
      .insertInto("cancellation_policy_versions")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async createCancellationTiers(
    trx: Trx,
    values: Insertable<Database["cancellation_policy_tiers"]>[]
  ): Promise<CancellationTierRecord[]> {
    return trx.insertInto("cancellation_policy_tiers").values(values).returningAll().execute();
  }

  async sealCancellationVersion(
    trx: Trx,
    versionId: string
  ): Promise<CancellationPolicyVersionRecord> {
    return trx
      .updateTable("cancellation_policy_versions")
      .set({ sealed_at: new Date() })
      .where("id", "=", versionId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async advanceCancellationPolicy(
    trx: Trx,
    policyId: string,
    version: number,
    userId: string
  ): Promise<void> {
    await trx
      .updateTable("cancellation_policies")
      .set({ current_version: version, updated_by_user_id: userId, updated_at: new Date() })
      .where("id", "=", policyId)
      .executeTakeFirstOrThrow();
  }

  async latestCancellationAssignmentEffectiveFrom(
    trx: Trx,
    ratePlanId: string
  ): Promise<string | null> {
    const row = await trx
      .selectFrom("rate_plan_cancellation_assignments")
      .select("effective_from")
      .where("rate_plan_id", "=", ratePlanId)
      .orderBy("effective_from", "desc")
      .executeTakeFirst();
    return row?.effective_from ?? null;
  }

  async createCancellationAssignment(
    trx: Trx,
    values: Insertable<Database["rate_plan_cancellation_assignments"]>
  ): Promise<CancellationAssignmentRecord> {
    return trx
      .insertInto("rate_plan_cancellation_assignments")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async ensureAndLockGuestAgePolicy(
    trx: Trx,
    organizationId: string,
    propertyId: string,
    userId: string
  ): Promise<GuestAgePolicyRecord> {
    await trx
      .insertInto("guest_age_policies")
      .values({
        property_id: propertyId,
        organization_id: organizationId,
        created_by_user_id: userId,
        updated_by_user_id: userId
      })
      .onConflict((oc) => oc.column("property_id").doNothing())
      .execute();

    return trx
      .selectFrom("guest_age_policies")
      .selectAll()
      .where("property_id", "=", propertyId)
      .where("organization_id", "=", organizationId)
      .forUpdate()
      .executeTakeFirstOrThrow();
  }

  async latestGuestAgeEffectiveFrom(trx: Trx, propertyId: string): Promise<string | null> {
    const row = await trx
      .selectFrom("guest_age_policy_versions")
      .select("effective_from")
      .where("property_id", "=", propertyId)
      .orderBy("effective_from", "desc")
      .executeTakeFirst();
    return row?.effective_from ?? null;
  }

  async createGuestAgeVersion(
    trx: Trx,
    values: Insertable<Database["guest_age_policy_versions"]>
  ): Promise<GuestAgePolicyVersionRecord> {
    return trx
      .insertInto("guest_age_policy_versions")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async advanceGuestAgePolicy(
    trx: Trx,
    propertyId: string,
    version: number,
    userId: string
  ): Promise<void> {
    await trx
      .updateTable("guest_age_policies")
      .set({ current_version: version, updated_by_user_id: userId, updated_at: new Date() })
      .where("property_id", "=", propertyId)
      .executeTakeFirstOrThrow();
  }

  async findRatePlan(
    trx: Trx,
    organizationId: string,
    propertyId: string,
    ratePlanId: string
  ): Promise<{ id: string; status: string } | undefined> {
    return trx
      .selectFrom("rate_plans")
      .select(["id", "status"])
      .where("id", "=", ratePlanId)
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .executeTakeFirst();
  }

  async lockRatePlan(
    trx: Trx,
    organizationId: string,
    propertyId: string,
    ratePlanId: string
  ): Promise<{ id: string; status: string } | undefined> {
    return trx
      .selectFrom("rate_plans")
      .select(["id", "status"])
      .where("id", "=", ratePlanId)
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .forUpdate()
      .executeTakeFirst();
  }

  async findRateProduct(
    trx: Trx,
    organizationId: string,
    propertyId: string,
    rateProductId: string
  ): Promise<{ id: string; status: string } | undefined> {
    return trx
      .selectFrom("rate_plan_products")
      .select(["id", "status"])
      .where("id", "=", rateProductId)
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .executeTakeFirst();
  }

  async recordEvent(
    trx: Trx,
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
      details: JsonObject;
      actorUserId: string;
      request: RequestMetadata;
    }
  ): Promise<void> {
    await trx
      .insertInto("commercial_rule_events")
      .values({
        organization_id: input.organizationId,
        property_id: input.propertyId,
        entity_type: input.entityType,
        entity_id: input.entityId,
        event_type: input.eventType,
        details_json: input.details,
        actor_user_id: input.actorUserId,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .execute();
  }

  async getConfiguration(
    trx: Trx,
    organizationId: string,
    propertyId: string
  ): Promise<JsonObject> {
    const [
      settingsHeader,
      settingsVersions,
      taxPolicies,
      taxVersions,
      taxComponents,
      taxAssignments,
      feePolicies,
      feeVersions,
      feeAssignments,
      cancellationPolicies,
      cancellationVersions,
      cancellationTiers,
      cancellationAssignments,
      guestAgeHeader,
      guestAgeVersions
    ] = await Promise.all([
      trx
        .selectFrom("property_commercial_settings")
        .selectAll()
        .where("property_id", "=", propertyId)
        .executeTakeFirst(),
      trx
        .selectFrom("property_commercial_setting_versions")
        .selectAll()
        .where("property_id", "=", propertyId)
        .orderBy("effective_from")
        .execute(),
      trx
        .selectFrom("commercial_tax_policies")
        .selectAll()
        .where("property_id", "=", propertyId)
        .orderBy("code")
        .execute(),
      trx
        .selectFrom("commercial_tax_policy_versions")
        .selectAll()
        .where("property_id", "=", propertyId)
        .orderBy("effective_from")
        .execute(),
      trx
        .selectFrom("commercial_tax_components")
        .selectAll()
        .where("property_id", "=", propertyId)
        .orderBy("sort_order")
        .execute(),
      trx
        .selectFrom("commercial_tax_assignments")
        .selectAll()
        .where("property_id", "=", propertyId)
        .orderBy("effective_from")
        .execute(),
      trx
        .selectFrom("commercial_fee_policies")
        .selectAll()
        .where("property_id", "=", propertyId)
        .orderBy("code")
        .execute(),
      trx
        .selectFrom("commercial_fee_policy_versions")
        .selectAll()
        .where("property_id", "=", propertyId)
        .orderBy("effective_from")
        .execute(),
      trx
        .selectFrom("commercial_fee_assignments")
        .selectAll()
        .where("property_id", "=", propertyId)
        .orderBy("effective_from")
        .execute(),
      trx
        .selectFrom("cancellation_policies")
        .selectAll()
        .where("property_id", "=", propertyId)
        .orderBy("code")
        .execute(),
      trx
        .selectFrom("cancellation_policy_versions")
        .selectAll()
        .where("property_id", "=", propertyId)
        .orderBy("effective_from")
        .execute(),
      trx
        .selectFrom("cancellation_policy_tiers")
        .selectAll()
        .where("property_id", "=", propertyId)
        .orderBy("minimum_minutes_before_arrival", "desc")
        .execute(),
      trx
        .selectFrom("rate_plan_cancellation_assignments")
        .selectAll()
        .where("property_id", "=", propertyId)
        .orderBy("effective_from")
        .execute(),
      trx
        .selectFrom("guest_age_policies")
        .selectAll()
        .where("property_id", "=", propertyId)
        .executeTakeFirst(),
      trx
        .selectFrom("guest_age_policy_versions")
        .selectAll()
        .where("property_id", "=", propertyId)
        .orderBy("effective_from")
        .execute()
    ]);

    return {
      organizationId,
      propertyId,
      settingsHeader: settingsHeader ?? null,
      settingsVersions,
      taxPolicies,
      taxVersions,
      taxComponents,
      taxAssignments,
      feePolicies,
      feeVersions,
      feeAssignments,
      cancellationPolicies,
      cancellationVersions,
      cancellationTiers,
      cancellationAssignments,
      guestAgeHeader: guestAgeHeader ?? null,
      guestAgeVersions
    };
  }
}

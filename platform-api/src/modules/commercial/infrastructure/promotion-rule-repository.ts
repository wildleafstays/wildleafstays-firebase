import type { Insertable, Selectable, Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";

export type PromotionSettingsRecord = Selectable<Database["property_promotion_settings"]>;
export type PromotionSettingsVersionRecord = Selectable<
  Database["property_promotion_setting_versions"]
>;
export type PromotionCampaignRecord = Selectable<Database["promotion_campaigns"]>;
export type PromotionCampaignVersionRecord = Selectable<Database["promotion_campaign_versions"]>;
export type PromotionAssignmentRecord = Selectable<Database["promotion_assignments"]>;

type Trx = Transaction<Database>;

export interface PromotionPropertyContext {
  id: string;
  organization_id: string;
  status: string;
  currency_code: string;
}

export class PromotionRuleRepository {
  async findPropertyContext(
    trx: Trx,
    organizationId: string,
    propertyId: string
  ): Promise<PromotionPropertyContext | undefined> {
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

  async ensureAndLockSettings(
    trx: Trx,
    organizationId: string,
    propertyId: string,
    userId: string
  ): Promise<PromotionSettingsRecord> {
    await trx
      .insertInto("property_promotion_settings")
      .values({
        property_id: propertyId,
        organization_id: organizationId,
        created_by_user_id: userId,
        updated_by_user_id: userId
      })
      .onConflict((oc) => oc.column("property_id").doNothing())
      .execute();

    return trx
      .selectFrom("property_promotion_settings")
      .selectAll()
      .where("property_id", "=", propertyId)
      .where("organization_id", "=", organizationId)
      .forUpdate()
      .executeTakeFirstOrThrow();
  }

  async latestSettingsEffectiveFrom(trx: Trx, propertyId: string): Promise<string | null> {
    const row = await trx
      .selectFrom("property_promotion_setting_versions")
      .select("effective_from")
      .where("property_id", "=", propertyId)
      .orderBy("effective_from", "desc")
      .executeTakeFirst();
    return row?.effective_from ?? null;
  }

  async insertSettingsVersion(
    trx: Trx,
    values: Insertable<Database["property_promotion_setting_versions"]>
  ): Promise<PromotionSettingsVersionRecord> {
    return trx
      .insertInto("property_promotion_setting_versions")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async advanceSettings(
    trx: Trx,
    propertyId: string,
    version: number,
    userId: string
  ): Promise<void> {
    await trx
      .updateTable("property_promotion_settings")
      .set({ current_version: version, updated_by_user_id: userId, updated_at: new Date() })
      .where("property_id", "=", propertyId)
      .executeTakeFirstOrThrow();
  }

  async findCampaignByCode(
    trx: Trx,
    propertyId: string,
    code: string
  ): Promise<{ id: string } | undefined> {
    return trx
      .selectFrom("promotion_campaigns")
      .select("id")
      .where("property_id", "=", propertyId)
      .where("code", "=", code)
      .executeTakeFirst();
  }

  async findCampaignByPublicCode(
    trx: Trx,
    propertyId: string,
    publicCode: string
  ): Promise<{ id: string } | undefined> {
    return trx
      .selectFrom("promotion_campaigns")
      .select("id")
      .where("property_id", "=", propertyId)
      .where("public_code", "=", publicCode)
      .executeTakeFirst();
  }

  async createCampaign(
    trx: Trx,
    values: Insertable<Database["promotion_campaigns"]>
  ): Promise<PromotionCampaignRecord> {
    return trx
      .insertInto("promotion_campaigns")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async lockCampaign(
    trx: Trx,
    organizationId: string,
    propertyId: string,
    campaignId: string
  ): Promise<PromotionCampaignRecord | undefined> {
    return trx
      .selectFrom("promotion_campaigns")
      .selectAll()
      .where("id", "=", campaignId)
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .forUpdate()
      .executeTakeFirst();
  }

  async latestCampaignVersionEffectiveFrom(trx: Trx, campaignId: string): Promise<string | null> {
    const row = await trx
      .selectFrom("promotion_campaign_versions")
      .select("effective_from")
      .where("promotion_campaign_id", "=", campaignId)
      .orderBy("effective_from", "desc")
      .executeTakeFirst();
    return row?.effective_from ?? null;
  }

  async createCampaignVersion(
    trx: Trx,
    values: Insertable<Database["promotion_campaign_versions"]>
  ): Promise<PromotionCampaignVersionRecord> {
    return trx
      .insertInto("promotion_campaign_versions")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async advanceCampaign(
    trx: Trx,
    campaignId: string,
    version: number,
    userId: string
  ): Promise<void> {
    await trx
      .updateTable("promotion_campaigns")
      .set({ current_version: version, updated_by_user_id: userId, updated_at: new Date() })
      .where("id", "=", campaignId)
      .executeTakeFirstOrThrow();
  }

  async hasEffectiveCampaignVersion(
    trx: Trx,
    campaignId: string,
    effectiveFrom: string
  ): Promise<boolean> {
    const row = await trx
      .selectFrom("promotion_campaign_versions")
      .select("id")
      .where("promotion_campaign_id", "=", campaignId)
      .where("effective_from", "<=", effectiveFrom)
      .orderBy("effective_from", "desc")
      .executeTakeFirst();
    return Boolean(row);
  }

  async findRatePlan(
    trx: Trx,
    organizationId: string,
    propertyId: string,
    ratePlanId: string
  ): Promise<{ id: string } | undefined> {
    return trx
      .selectFrom("rate_plans")
      .select("id")
      .where("id", "=", ratePlanId)
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .executeTakeFirst();
  }

  async findRateProduct(
    trx: Trx,
    organizationId: string,
    propertyId: string,
    rateProductId: string
  ): Promise<{ id: string } | undefined> {
    return trx
      .selectFrom("rate_plan_products")
      .select("id")
      .where("id", "=", rateProductId)
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .executeTakeFirst();
  }

  async latestAssignmentEffectiveFrom(
    trx: Trx,
    campaignId: string,
    scopeType: string,
    ratePlanId: string | null,
    rateProductId: string | null
  ): Promise<string | null> {
    let query = trx
      .selectFrom("promotion_assignments")
      .select("effective_from")
      .where("promotion_campaign_id", "=", campaignId)
      .where("scope_type", "=", scopeType);

    query =
      ratePlanId === null
        ? query.where("rate_plan_id", "is", null)
        : query.where("rate_plan_id", "=", ratePlanId);
    query =
      rateProductId === null
        ? query.where("rate_product_id", "is", null)
        : query.where("rate_product_id", "=", rateProductId);

    const row = await query.orderBy("effective_from", "desc").executeTakeFirst();
    return row?.effective_from ?? null;
  }

  async createAssignment(
    trx: Trx,
    values: Insertable<Database["promotion_assignments"]>
  ): Promise<PromotionAssignmentRecord> {
    return trx
      .insertInto("promotion_assignments")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async recordEvent(
    trx: Trx,
    input: {
      organizationId: string;
      propertyId: string;
      entityType: string;
      entityId: string;
      eventType: string;
      details: JsonObject;
      actorUserId: string | null;
      request: RequestMetadata;
    }
  ): Promise<void> {
    await trx
      .insertInto("promotion_rule_events")
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
    const [settingsHeader, settingsVersions, campaigns, campaignVersions, assignments] =
      await Promise.all([
        trx
          .selectFrom("property_promotion_settings")
          .selectAll()
          .where("organization_id", "=", organizationId)
          .where("property_id", "=", propertyId)
          .executeTakeFirst(),
        trx
          .selectFrom("property_promotion_setting_versions")
          .selectAll()
          .where("organization_id", "=", organizationId)
          .where("property_id", "=", propertyId)
          .orderBy("effective_from")
          .execute(),
        trx
          .selectFrom("promotion_campaigns")
          .selectAll()
          .where("organization_id", "=", organizationId)
          .where("property_id", "=", propertyId)
          .orderBy("code")
          .execute(),
        trx
          .selectFrom("promotion_campaign_versions")
          .selectAll()
          .where("organization_id", "=", organizationId)
          .where("property_id", "=", propertyId)
          .orderBy("effective_from")
          .execute(),
        trx
          .selectFrom("promotion_assignments")
          .selectAll()
          .where("organization_id", "=", organizationId)
          .where("property_id", "=", propertyId)
          .orderBy("effective_from")
          .execute()
      ]);

    return {
      organizationId,
      propertyId,
      settingsHeader: settingsHeader ?? null,
      settingsVersions,
      campaigns,
      campaignVersions,
      assignments
    };
  }
}

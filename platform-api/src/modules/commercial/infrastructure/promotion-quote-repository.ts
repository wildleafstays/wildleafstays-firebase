import type { Selectable, Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";

export type PromotionQuoteSettingsVersionRecord = Selectable<
  Database["property_promotion_setting_versions"]
>;
export type PromotionQuoteCampaignRecord = Selectable<Database["promotion_campaigns"]>;
export type PromotionQuoteCampaignVersionRecord = Selectable<
  Database["promotion_campaign_versions"]
>;
export type PromotionQuoteAssignmentRecord = Selectable<Database["promotion_assignments"]>;

export interface PromotionQuoteResolutionData {
  propertyTimezone: string;
  settingsVersions: PromotionQuoteSettingsVersionRecord[];
  campaigns: PromotionQuoteCampaignRecord[];
  campaignVersions: PromotionQuoteCampaignVersionRecord[];
  assignments: PromotionQuoteAssignmentRecord[];
}

export class PromotionQuoteRepository {
  async loadResolutionData(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string
  ): Promise<PromotionQuoteResolutionData> {
    const [property, settingsVersions, campaigns, campaignVersions, assignments] =
      await Promise.all([
        trx
          .selectFrom("properties")
          .select(["timezone"])
          .where("organization_id", "=", organizationId)
          .where("id", "=", propertyId)
          .executeTakeFirstOrThrow(),
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
      propertyTimezone: property.timezone,
      settingsVersions,
      campaigns,
      campaignVersions,
      assignments
    };
  }
}

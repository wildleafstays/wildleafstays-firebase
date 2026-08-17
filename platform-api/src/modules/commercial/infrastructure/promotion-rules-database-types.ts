import type { ColumnType, Generated } from "kysely";

export interface PropertyPromotionSettingsTable {
  property_id: string;
  organization_id: string;
  current_version: Generated<number>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PropertyPromotionSettingVersionsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  version_number: number;
  effective_from: string;
  promotion_mode: string;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
}

export interface PromotionCampaignsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  code: string;
  name: string;
  description: string | null;
  promotion_kind: string;
  public_code: string | null;
  status: Generated<string>;
  current_version: Generated<number>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PromotionCampaignVersionsTable {
  id: Generated<string>;
  promotion_campaign_id: string;
  organization_id: string;
  property_id: string;
  version_number: number;
  effective_from: string;
  currency_code: string;
  booking_window_start: string | null;
  booking_window_end: string | null;
  arrival_window_start: string | null;
  arrival_window_end: string | null;
  minimum_stay_nights: Generated<number>;
  minimum_spend_minor: number | null;
  discount_type: string;
  discount_value: number;
  maximum_discount_minor: number | null;
  applies_to: string;
  priority: Generated<number>;
  stacking_mode: string;
  stack_group: string | null;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
}

export interface PromotionAssignmentsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  promotion_campaign_id: string;
  scope_type: string;
  rate_plan_id: string | null;
  rate_product_id: string | null;
  effective_from: string;
  enabled: boolean;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
}

export interface PromotionRuleEventsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  entity_type: string;
  entity_id: string;
  event_type: string;
  details_json: ColumnType<
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>
  >;
  actor_user_id: string | null;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

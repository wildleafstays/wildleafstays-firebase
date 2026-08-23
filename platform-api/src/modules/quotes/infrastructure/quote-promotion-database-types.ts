import type { Generated } from "kysely";

export interface QuotePromotionSnapshotsTable {
  id: Generated<string>;
  quote_id: string;
  organization_id: string;
  property_id: string;
  promotion_settings_version_id: string;
  settings_version_number: number;
  settings_effective_from: string;
  promotion_mode: string;
  booking_date: string;
  requested_promotion_code: string | null;
  promotion_status: string;
  currency_code: string;
  gross_accommodation_minor: number;
  gross_extra_guest_minor: number;
  accommodation_discount_minor: number;
  extra_guest_discount_minor: number;
  discount_minor: number;
  discounted_accommodation_minor: number;
  discounted_extra_guest_minor: number;
  inclusive_fee_minor: number;
  exclusive_fee_minor: number;
  fee_minor: number;
  inclusive_tax_minor: number;
  exclusive_tax_minor: number;
  tax_minor: number;
  total_minor: number;
  hold_eligible: boolean;
  created_at: Generated<Date>;
}

export interface QuotePromotionLinesTable {
  id: Generated<string>;
  quote_promotion_snapshot_id: string;
  quote_id: string;
  organization_id: string;
  property_id: string;
  promotion_campaign_id: string;
  promotion_campaign_version_id: string;
  promotion_assignment_id: string;
  campaign_code: string;
  campaign_name: string;
  promotion_kind: string;
  public_code: string | null;
  version_number: number;
  effective_from: string;
  currency_code: string;
  booking_window_start: string | null;
  booking_window_end: string | null;
  arrival_window_start: string | null;
  arrival_window_end: string | null;
  minimum_stay_nights: number;
  minimum_spend_minor: number | null;
  discount_type: string;
  discount_value: number;
  maximum_discount_minor: number | null;
  applies_to: string;
  priority: number;
  stacking_mode: string;
  stack_group: string | null;
  assignment_scope_type: string;
  assignment_rate_plan_id: string | null;
  assignment_rate_product_id: string | null;
  assignment_effective_from: string;
  discount_basis_minor: number;
  accommodation_discount_minor: number;
  extra_guest_discount_minor: number;
  discount_minor: number;
  created_at: Generated<Date>;
}

export interface QuoteFinalFeeLinesTable {
  id: Generated<string>;
  quote_promotion_snapshot_id: string;
  quote_id: string;
  organization_id: string;
  property_id: string;
  line_key: string;
  fee_policy_id: string;
  fee_policy_version_id: string;
  fee_policy_code: string;
  fee_policy_name: string;
  version_number: number;
  effective_from: string;
  stay_date: string | null;
  calculation_type: string;
  application_basis: string;
  amount_minor_snapshot: number | null;
  rate_basis_points_snapshot: number | null;
  price_mode: string;
  taxable: boolean;
  tax_policy_id: string | null;
  multiplier: number;
  fee_minor: number;
  created_at: Generated<Date>;
}

export interface QuoteFinalTaxLinesTable {
  id: Generated<string>;
  quote_promotion_snapshot_id: string;
  quote_id: string;
  organization_id: string;
  property_id: string;
  tax_policy_id: string;
  tax_policy_version_id: string;
  tax_policy_code: string;
  tax_policy_name: string;
  version_number: number;
  effective_from: string;
  component_code: string;
  component_name: string;
  rate_basis_points: number;
  price_mode: string;
  charge_type: string;
  stay_date: string | null;
  final_fee_line_id: string | null;
  taxable_basis_minor: number;
  tax_minor: number;
  created_at: Generated<Date>;
}

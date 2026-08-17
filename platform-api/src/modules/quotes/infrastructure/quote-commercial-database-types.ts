import type { Generated } from "kysely";

export interface QuoteCommercialSnapshotsTable {
  id: Generated<string>;
  quote_id: string;
  organization_id: string;
  property_id: string;
  commercial_status: string;
  promotion_status: string;
  currency_code: string;
  accommodation_minor: number;
  extra_guest_minor: number;
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

export interface QuoteCommercialSettingDaysTable {
  id: Generated<string>;
  quote_id: string;
  organization_id: string;
  property_id: string;
  stay_date: string;
  settings_version_id: string;
  settings_version_number: number;
  settings_effective_from: string;
  tax_mode: string;
  fee_mode: string;
  created_at: Generated<Date>;
}

export interface QuoteGuestAgeSnapshotsTable {
  id: Generated<string>;
  quote_id: string;
  organization_id: string;
  property_id: string;
  guest_age_policy_version_id: string;
  version_number: number;
  effective_from: string;
  infant_max_age: number | null;
  child_max_age: number;
  infants_count_towards_occupancy: boolean;
  infants_count_towards_child_limit: boolean;
  infants_charge_as_children: boolean;
  created_at: Generated<Date>;
}

export interface QuoteUnitAgeBreakdownsTable {
  id: Generated<string>;
  quote_id: string;
  organization_id: string;
  property_id: string;
  unit_index: number;
  children: number;
  infants: number;
  occupancy_count: number;
  child_limit_count: number;
  chargeable_children: number;
  extra_adults: number;
  extra_children: number;
  created_at: Generated<Date>;
}

export interface QuoteFeeLinesTable {
  id: Generated<string>;
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

export interface QuoteTaxLinesTable {
  id: Generated<string>;
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
  fee_line_id: string | null;
  taxable_basis_minor: number;
  tax_minor: number;
  created_at: Generated<Date>;
}

export interface QuoteCancellationSnapshotsTable {
  id: Generated<string>;
  quote_id: string;
  organization_id: string;
  property_id: string;
  cancellation_policy_id: string;
  cancellation_policy_version_id: string;
  policy_code: string;
  policy_name: string;
  version_number: number;
  effective_from: string;
  arrival_local_time: string;
  currency_code: string;
  policy_text: string | null;
  created_at: Generated<Date>;
}

export interface QuoteCancellationTierSnapshotsTable {
  id: Generated<string>;
  quote_cancellation_snapshot_id: string;
  quote_id: string;
  organization_id: string;
  property_id: string;
  trigger_type: string;
  minimum_minutes_before_arrival: number | null;
  penalty_type: string;
  penalty_value: number;
  created_at: Generated<Date>;
}

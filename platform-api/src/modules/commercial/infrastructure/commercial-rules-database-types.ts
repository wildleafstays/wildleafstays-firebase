import type { ColumnType, Generated } from "kysely";

export interface PropertyCommercialSettingsTable {
  property_id: string;
  organization_id: string;
  current_version: Generated<number>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PropertyCommercialSettingVersionsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  version_number: number;
  effective_from: string;
  tax_mode: string;
  fee_mode: string;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
}

export interface CommercialTaxPoliciesTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  code: string;
  name: string;
  description: string | null;
  status: Generated<string>;
  current_version: Generated<number>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CommercialTaxPolicyVersionsTable {
  id: Generated<string>;
  tax_policy_id: string;
  organization_id: string;
  property_id: string;
  version_number: number;
  effective_from: string;
  price_mode: string;
  selection_basis: string;
  minimum_basis_minor: number | null;
  maximum_basis_minor: number | null;
  applies_to_accommodation: Generated<boolean>;
  applies_to_extra_guest: Generated<boolean>;
  applies_to_fee: Generated<boolean>;
  sealed_at: Date | null;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
}

export interface CommercialTaxComponentsTable {
  id: Generated<string>;
  tax_policy_version_id: string;
  organization_id: string;
  property_id: string;
  component_code: string;
  component_name: string;
  rate_basis_points: number;
  sort_order: Generated<number>;
  created_at: Generated<Date>;
}

export interface CommercialTaxAssignmentsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  tax_policy_id: string;
  scope_type: string;
  rate_plan_id: string | null;
  rate_product_id: string | null;
  effective_from: string;
  enabled: boolean;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
}

export interface CommercialFeePoliciesTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  code: string;
  name: string;
  description: string | null;
  status: Generated<string>;
  current_version: Generated<number>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CommercialFeePolicyVersionsTable {
  id: Generated<string>;
  fee_policy_id: string;
  organization_id: string;
  property_id: string;
  version_number: number;
  effective_from: string;
  currency_code: string;
  calculation_type: string;
  application_basis: string;
  amount_minor: number | null;
  rate_basis_points: number | null;
  price_mode: string;
  taxable: Generated<boolean>;
  tax_policy_id: string | null;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
}

export interface CommercialFeeAssignmentsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  fee_policy_id: string;
  scope_type: string;
  rate_plan_id: string | null;
  rate_product_id: string | null;
  effective_from: string;
  enabled: boolean;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
}

export interface CancellationPoliciesTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  code: string;
  name: string;
  description: string | null;
  status: Generated<string>;
  current_version: Generated<number>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CancellationPolicyVersionsTable {
  id: Generated<string>;
  cancellation_policy_id: string;
  organization_id: string;
  property_id: string;
  version_number: number;
  effective_from: string;
  arrival_local_time: string;
  currency_code: string;
  policy_text: string | null;
  sealed_at: Date | null;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
}

export interface CancellationPolicyTiersTable {
  id: Generated<string>;
  cancellation_policy_version_id: string;
  organization_id: string;
  property_id: string;
  trigger_type: string;
  minimum_minutes_before_arrival: number | null;
  penalty_type: string;
  penalty_value: number;
  created_at: Generated<Date>;
}

export interface RatePlanCancellationAssignmentsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  rate_plan_id: string;
  cancellation_policy_id: string;
  effective_from: string;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
}

export interface GuestAgePoliciesTable {
  property_id: string;
  organization_id: string;
  current_version: Generated<number>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface GuestAgePolicyVersionsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  version_number: number;
  effective_from: string;
  infant_max_age: number | null;
  child_max_age: number;
  infants_count_towards_occupancy: Generated<boolean>;
  infants_count_towards_child_limit: Generated<boolean>;
  infants_charge_as_children: Generated<boolean>;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
}

export interface CommercialRuleEventsTable {
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

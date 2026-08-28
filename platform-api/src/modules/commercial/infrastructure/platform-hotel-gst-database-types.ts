import type { Generated } from "kysely";

export interface PlatformHotelGstRuleVersionsTable {
  id: Generated<string>;
  version_number: number;
  effective_from: string;
  threshold_minor: number;
  lower_rate_basis_points: number;
  upper_rate_basis_points: number;
  lower_itc_available: boolean;
  upper_itc_available: boolean;
  source_url: string;
  rule_text: string;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
}

export interface PropertyHotelGstConsentsTable {
  property_id: string;
  organization_id: string;
  accepted_rule_version_id: string;
  acceptance_text: string;
  accepted_by_user_id: string;
  accepted_at: Generated<Date>;
  ip_address: string | null;
  user_agent: string | null;
  version: Generated<number>;
}

export interface PropertyHotelGstRuleSyncsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  rule_version_id: string;
  lower_tax_policy_version_id: string;
  upper_tax_policy_version_id: string;
  synced_at: Generated<Date>;
}

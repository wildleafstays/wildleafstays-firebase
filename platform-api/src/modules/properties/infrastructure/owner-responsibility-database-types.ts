import type { Generated } from "kysely";

export interface PlatformOwnerResponsibilityTermsTable {
  id: Generated<string>;
  version_number: number;
  effective_from: string;
  terms_text: string;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
}

export interface PropertyOwnerResponsibilityAcceptancesTable {
  id: Generated<string>;
  property_id: string;
  organization_id: string;
  accepted_terms_version_id: string;
  acceptance_text: string;
  accepted_by_user_id: string;
  accepted_at: Generated<Date>;
  ip_address: string | null;
  user_agent: string | null;
}

import type { Generated } from "kysely";

export interface QuoteInventoryHoldsTable {
  id: Generated<string>;
  quote_id: string;
  inventory_hold_id: string;
  organization_id: string;
  property_id: string;
  linked_by_user_id: string | null;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

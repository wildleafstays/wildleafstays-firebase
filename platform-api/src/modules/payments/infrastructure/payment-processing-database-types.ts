import type { ColumnType, Generated } from "kysely";
import type { JsonObject } from "../../../infrastructure/database/types.js";

export interface PaymentSuccessesTable {
  id: Generated<string>;
  payment_intent_id: string;
  payment_evidence_id: string;
  organization_id: string;
  property_id: string;
  reservation_id: string;
  outcome: string;
  inventory_allocation_id: string | null;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

export interface PaymentReconciliationCasesTable {
  id: Generated<string>;
  payment_intent_id: string;
  payment_evidence_id: string;
  organization_id: string;
  property_id: string;
  reservation_id: string;
  reason_code: string;
  required_action: string;
  status: Generated<string>;
  details_json: ColumnType<JsonObject, JsonObject, JsonObject>;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
  resolved_at: Date | null;
  resolved_by_user_id: string | null;
  resolution_code: string | null;
  resolution_note: string | null;
}

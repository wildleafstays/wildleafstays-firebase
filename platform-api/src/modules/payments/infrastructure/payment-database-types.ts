import type { ColumnType, Generated } from "kysely";
import type { JsonObject } from "../../../infrastructure/database/types.js";

export interface PaymentIntentsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  reservation_id: string;
  payment_reference: string;
  purpose: Generated<string>;
  amount_minor: number;
  currency_code: string;
  status: Generated<string>;
  expires_at: Date;
  created_by_user_id: string | null;
  source: string;
  request_id: string;
  correlation_id: string;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PaymentEventsTable {
  id: Generated<string>;
  payment_intent_id: string;
  organization_id: string;
  property_id: string;
  reservation_id: string;
  event_type: string;
  details_json: ColumnType<JsonObject, JsonObject, JsonObject>;
  actor_user_id: string | null;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

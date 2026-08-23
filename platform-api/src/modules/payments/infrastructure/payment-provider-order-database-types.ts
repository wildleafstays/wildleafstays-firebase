import type { Generated } from "kysely";

export interface PaymentProviderOrdersTable {
  id: Generated<string>;
  payment_intent_id: string;
  organization_id: string;
  property_id: string;
  reservation_id: string;
  provider: string;
  provider_order_id: string;
  receipt: string;
  amount_minor: number;
  currency_code: string;
  provider_created_at: Date;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

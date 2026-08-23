import type { Generated } from "kysely";

export interface PaymentProviderEvidenceTable {
  id: Generated<string>;
  payment_intent_id: string;
  organization_id: string;
  property_id: string;
  reservation_id: string;
  provider: string;
  provider_event_id: string;
  provider_payment_id: string;
  provider_order_id: string | null;
  amount_minor: number;
  currency_code: string;
  verification_method: string;
  payload_sha256: string;
  source: string;
  request_id: string;
  correlation_id: string;
  received_at: Generated<Date>;
}

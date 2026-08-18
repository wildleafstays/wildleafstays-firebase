import type { Generated } from "kysely";

export interface PaymentRefundSubmissionsTable {
  id: Generated<string>;
  refund_request_id: string;
  attempt_sequence: number;
  payment_intent_id: string;
  payment_evidence_id: string;
  reconciliation_case_id: string;
  organization_id: string;
  property_id: string;
  reservation_id: string;
  provider: string;
  provider_payment_id: string;
  provider_refund_id: string;
  amount_minor: number;
  currency_code: string;
  idempotency_key: string;
  initial_provider_status: string;
  provider_created_at: Date;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

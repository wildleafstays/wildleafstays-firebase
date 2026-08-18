import type { Generated } from "kysely";

export interface PaymentRefundProviderEventsTable {
  id: Generated<string>;
  refund_submission_id: string;
  refund_request_id: string;
  payment_intent_id: string;
  payment_evidence_id: string;
  reconciliation_case_id: string;
  organization_id: string;
  property_id: string;
  reservation_id: string;
  provider: string;
  provider_event_id: string;
  provider_refund_id: string;
  provider_payment_id: string;
  event_type: string;
  provider_status: string;
  amount_minor: number;
  currency_code: string;
  payload_sha256: string;
  provider_refund_created_at: Date;
  provider_event_created_at: Date;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

export interface PaymentRefundFinalizationsTable {
  id: Generated<string>;
  refund_submission_id: string;
  refund_request_id: string;
  finalization_event_id: string;
  payment_intent_id: string;
  payment_evidence_id: string;
  reconciliation_case_id: string;
  organization_id: string;
  property_id: string;
  reservation_id: string;
  provider: string;
  provider_event_id: string;
  provider_refund_id: string;
  status: string;
  amount_minor: number;
  currency_code: string;
  provider_event_created_at: Date;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

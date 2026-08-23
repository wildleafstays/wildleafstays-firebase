import type { ColumnType, Generated } from "kysely";

export interface PaymentRefundRequestsTable {
  id: Generated<string>;
  payment_intent_id: string;
  payment_evidence_id: string;
  refund_source: Generated<string>;
  reconciliation_case_id: string | null;
  cancellation_decision_id: ColumnType<
    string | null,
    string | null | undefined,
    string | null | undefined
  >;
  organization_id: string;
  property_id: string;
  reservation_id: string;
  provider: string;
  provider_payment_id: string;
  amount_minor: number;
  currency_code: string;
  reason_code: string;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

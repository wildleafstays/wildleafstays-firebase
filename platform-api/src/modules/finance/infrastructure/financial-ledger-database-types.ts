import type { Generated } from "kysely";

export interface FinancialLedgerJournalsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  reservation_id: string;
  payment_intent_id: string | null;
  journal_type: string;
  payment_evidence_id: string | null;
  refund_finalization_id: string | null;
  revenue_schedule_line_id: string | null;
  stay_completion_history_id: string | null;
  recognition_date: string | null;
  amount_minor: number;
  currency_code: string;
  occurred_at: Date;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

export interface FinancialLedgerEntriesTable {
  id: Generated<string>;
  journal_id: string;
  organization_id: string;
  property_id: string;
  line_number: number;
  account_code: string;
  direction: string;
  amount_minor: number;
  currency_code: string;
  created_at: Generated<Date>;
}

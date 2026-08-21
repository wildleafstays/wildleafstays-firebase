import type { Generated } from "kysely";

export interface RevenueReversalsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  reservation_id: string;
  operation_id: string;
  reason_code: string;
  note: string;
  currency_code: string;
  amount_minor: number;
  line_count: number;
  actor_user_id: string;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

export interface RevenueReversalLinesTable {
  id: Generated<string>;
  reversal_id: string;
  organization_id: string;
  property_id: string;
  reservation_id: string;
  line_number: number;
  revenue_schedule_line_id: string;
  revenue_recognition_journal_id: string;
  amount_minor: number;
  currency_code: string;
  created_at: Generated<Date>;
}

import type { Generated } from "kysely";

export interface RevenueRecognitionSchedulesTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  reservation_id: string;
  reservation_financial_snapshot_id: string;
  quote_id: string;
  allocation_version: string;
  currency_code: string;
  accepted_total_minor: number;
  consideration_minor: number;
  inclusive_tax_minor: number;
  exclusive_tax_minor: number;
  tax_minor: number;
  revenue_basis_minor: number;
  line_count: number;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

export interface RevenueRecognitionScheduleLinesTable {
  id: Generated<string>;
  schedule_id: string;
  organization_id: string;
  property_id: string;
  reservation_id: string;
  quote_id: string;
  line_number: number;
  line_type: string;
  service_scope: string;
  stay_date: string | null;
  source_quote_night_id: string | null;
  source_final_fee_line_id: string | null;
  source_line_key: string | null;
  consideration_minor: number;
  inclusive_tax_minor: number;
  revenue_minor: number;
  currency_code: string;
  created_at: Generated<Date>;
}

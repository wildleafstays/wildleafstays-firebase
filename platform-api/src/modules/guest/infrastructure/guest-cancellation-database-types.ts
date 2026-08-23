import type { Generated } from "kysely";

export interface ReservationCancellationDecisionsTable {
  id: Generated<string>;
  reservation_id: string;
  organization_id: string;
  property_id: string;
  guest_user_id: string;
  quote_id: string;
  quote_cancellation_snapshot_id: string;
  quote_cancellation_tier_snapshot_id: string;
  payment_intent_id: string;
  payment_evidence_id: string;
  cancelled_at: Date;
  arrival_at: Date;
  minutes_before_arrival: number;
  tier_minimum_minutes_before_arrival: number;
  penalty_type: string;
  penalty_value: number;
  accepted_total_minor: number;
  paid_minor: number;
  penalty_minor: number;
  refund_due_minor: number;
  currency_code: string;
  provider: string;
  provider_payment_id: string;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

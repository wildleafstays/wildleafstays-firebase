import type { Generated } from "kysely";

export interface ReservationsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  reservation_reference: string;
  quote_id: string | null;
  quote_inventory_hold_id: string | null;
  room_mix_quote_id: string | null;
  inventory_hold_id: string;
  status: Generated<string>;
  hold_expires_at: Date;
  arrival_date: string;
  departure_date: string;
  product_type: string;
  room_category_id: string | null;
  quantity: number;
  currency_code: string;
  total_minor: number;
  created_by_user_id: string | null;
  source: string;
  request_id: string;
  correlation_id: string;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ReservationFinancialSnapshotsTable {
  id: Generated<string>;
  reservation_id: string;
  quote_id: string;
  organization_id: string;
  property_id: string;
  quote_reference: string;
  rate_plan_id: string;
  rate_plan_code: string;
  rate_plan_name: string;
  meal_plan_code: string;
  rate_product_id: string;
  rate_product_version: number;
  product_type: string;
  product_label: string;
  room_category_id: string | null;
  arrival_date: string;
  departure_date: string;
  quantity: number;
  commercial_status: string;
  promotion_status: string;
  currency_code: string;
  gross_accommodation_minor: number;
  gross_extra_guest_minor: number;
  accommodation_discount_minor: number;
  extra_guest_discount_minor: number;
  discount_minor: number;
  discounted_accommodation_minor: number;
  discounted_extra_guest_minor: number;
  inclusive_fee_minor: number;
  exclusive_fee_minor: number;
  fee_minor: number;
  inclusive_tax_minor: number;
  exclusive_tax_minor: number;
  tax_minor: number;
  total_minor: number;
  created_at: Generated<Date>;
}

export interface ReservationRoomMixFinancialSnapshotsTable {
  id: Generated<string>;
  reservation_id: string;
  room_mix_quote_id: string;
  organization_id: string;
  property_id: string;
  room_mix_reference: string;
  product_label: string;
  arrival_date: string;
  departure_date: string;
  quantity: number;
  currency_code: string;
  gross_accommodation_minor: number;
  gross_extra_guest_minor: number;
  accommodation_discount_minor: number;
  extra_guest_discount_minor: number;
  discount_minor: number;
  discounted_accommodation_minor: number;
  discounted_extra_guest_minor: number;
  inclusive_fee_minor: number;
  exclusive_fee_minor: number;
  fee_minor: number;
  inclusive_tax_minor: number;
  exclusive_tax_minor: number;
  tax_minor: number;
  total_minor: number;
  created_at: Generated<Date>;
}

export interface ReservationLeadGuestSnapshotsTable {
  id: Generated<string>;
  reservation_id: string;
  organization_id: string;
  property_id: string;
  guest_name: string;
  email: string | null;
  phone_e164: string | null;
  created_at: Generated<Date>;
}

export interface ReservationStatusHistoryTable {
  id: Generated<string>;
  reservation_id: string;
  organization_id: string;
  property_id: string;
  sequence_number: number;
  from_status: string | null;
  to_status: string;
  reason: string;
  actor_user_id: string | null;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

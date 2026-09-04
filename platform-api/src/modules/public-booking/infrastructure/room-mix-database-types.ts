import type { Generated } from "kysely";

export interface RoomMixQuotesTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  room_mix_reference: string;
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
  expires_at: Date;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

export interface RoomMixQuoteItemsTable {
  id: Generated<string>;
  room_mix_quote_id: string;
  organization_id: string;
  property_id: string;
  item_index: number;
  quote_id: string;
  quote_reference: string;
  rate_product_id: string;
  room_category_id: string;
  quantity: number;
  total_minor: number;
  created_at: Generated<Date>;
}

export interface RoomMixInventoryHoldsTable {
  id: Generated<string>;
  room_mix_quote_id: string;
  inventory_hold_id: string;
  organization_id: string;
  property_id: string;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

export interface ReservationRoomMixItemsTable {
  id: Generated<string>;
  reservation_id: string;
  room_mix_quote_id: string;
  room_mix_quote_item_id: string;
  quote_id: string;
  organization_id: string;
  property_id: string;
  item_index: number;
  created_at: Generated<Date>;
}

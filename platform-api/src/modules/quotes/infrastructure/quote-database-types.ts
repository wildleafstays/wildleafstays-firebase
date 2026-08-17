import type { ColumnType, Generated } from "kysely";

export interface QuotesTable {
  id: Generated<string>;
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
  currency_code: string;
  accommodation_minor: number;
  extra_guest_minor: number;
  tax_minor: Generated<number>;
  fee_minor: Generated<number>;
  total_minor: number;
  arrival_closed_to_arrival: boolean;
  departure_closed_to_departure: boolean;
  minimum_stay_snapshot: number;
  maximum_stay_snapshot: number | null;
  commercial_status: string;
  hold_eligible: Generated<boolean>;
  expires_at: Date;
  created_by_user_id: string | null;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

export interface QuoteUnitsTable {
  id: Generated<string>;
  quote_id: string;
  organization_id: string;
  property_id: string;
  unit_index: number;
  adults: number;
  child_ages_json: ColumnType<number[], string, string>;
  included_adults: number;
  included_children: number;
  max_adults: number;
  max_children: number;
  max_occupancy: number;
  extra_adults: number;
  extra_children: number;
  created_at: Generated<Date>;
}

export interface QuoteNightsTable {
  id: Generated<string>;
  quote_id: string;
  organization_id: string;
  property_id: string;
  stay_date: string;
  nightly_unit_rate_minor: number;
  accommodation_minor: number;
  extra_adult_minor: number;
  extra_child_minor: number;
  extra_guest_minor: number;
  night_total_minor: number;
  sellable_quantity_snapshot: number;
  rate_source: string;
  rate_override_version: number | null;
  minimum_stay: number;
  maximum_stay: number | null;
  closed_to_arrival: boolean;
  closed_to_departure: boolean;
  stop_sell: boolean;
  created_at: Generated<Date>;
}

export interface QuoteEventsTable {
  id: Generated<string>;
  quote_id: string;
  organization_id: string;
  property_id: string;
  event_type: string;
  details_json: ColumnType<
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>
  >;
  actor_user_id: string | null;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

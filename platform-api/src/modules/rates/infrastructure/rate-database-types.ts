import type { Generated } from "kysely";

export interface RatePlansTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  code: string;
  name: string;
  description: string | null;
  meal_plan_code: string;
  currency_code: string;
  status: Generated<string>;
  created_by_user_id: string | null;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RatePlanProductsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  rate_plan_id: string;
  product_type: string;
  room_category_id: string | null;
  base_rate_minor: number;
  floor_rate_minor: number | null;
  ceiling_rate_minor: number | null;
  included_adults: number;
  included_children: number;
  max_adults: number;
  max_children: number;
  max_occupancy: number;
  extra_adult_minor: number;
  extra_child_minor: number;
  status: Generated<string>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RateCalendarDaysTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  rate_product_id: string;
  stay_date: string;
  rate_minor: number;
  extra_adult_minor: number | null;
  extra_child_minor: number | null;
  minimum_stay: Generated<number>;
  maximum_stay: number | null;
  closed_to_arrival: Generated<boolean>;
  closed_to_departure: Generated<boolean>;
  stop_sell: Generated<boolean>;
  source: Generated<string>;
  updated_by_user_id: string | null;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RateEventsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  rate_plan_id: string | null;
  rate_product_id: string | null;
  stay_date: string | null;
  event_type: string;
  details_json: Record<string, unknown>;
  actor_user_id: string | null;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

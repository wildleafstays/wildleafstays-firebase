import type { ColumnType, Generated } from "kysely";

export interface InventoryDailyBucketsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  bucket_type: string;
  room_category_id: string | null;
  stay_date: string;
  capacity: number;
  held_quantity: Generated<number>;
  confirmed_quantity: Generated<number>;
  overbooking_limit: Generated<number>;
  stop_sell: Generated<boolean>;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InventoryBlocksTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  scope_type: string;
  room_category_id: string | null;
  physical_unit_id: string | null;
  block_type: string;
  start_date: string;
  end_date: string;
  quantity: Generated<number>;
  reason: string;
  status: Generated<string>;
  created_by_user_id: string | null;
  released_by_user_id: string | null;
  released_at: Date | null;
  release_reason: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InventoryEventsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  room_category_id: string | null;
  physical_unit_id: string | null;
  stay_date: string | null;
  event_type: string;
  quantity_delta: Generated<number>;
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

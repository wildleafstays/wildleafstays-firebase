import type { Generated } from "kysely";

export interface InventoryAllocationsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  hold_id: string;
  confirmation_reference: string;
  start_date: string;
  end_date: string;
  status: Generated<string>;
  confirmed_by_user_id: string | null;
  confirmed_at: Generated<Date>;
  released_by_user_id: string | null;
  released_at: Date | null;
  release_reason: string | null;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InventoryAllocationItemsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  allocation_id: string;
  source_hold_item_id: string;
  bucket_type: string;
  room_category_id: string | null;
  quantity: number;
  created_at: Generated<Date>;
}

export interface InventoryAllocationNightsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  allocation_id: string;
  allocation_item_id: string;
  source_hold_night_id: string;
  bucket_id: string;
  stay_date: string;
  quantity: number;
  created_at: Generated<Date>;
}

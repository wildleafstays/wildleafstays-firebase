import type { Generated } from "kysely";

export interface InventoryHoldsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  status: Generated<string>;
  start_date: string;
  end_date: string;
  expires_at: Date;
  client_reference: string | null;
  created_by_user_id: string | null;
  released_by_user_id: string | null;
  released_at: Date | null;
  release_reason: string | null;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InventoryHoldItemsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  hold_id: string;
  bucket_type: string;
  room_category_id: string | null;
  quantity: number;
  created_at: Generated<Date>;
}

export interface InventoryHoldNightsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  hold_id: string;
  hold_item_id: string;
  bucket_id: string;
  stay_date: string;
  quantity: number;
  created_at: Generated<Date>;
}

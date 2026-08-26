import type { JsonObject } from "../../../infrastructure/database/types.js";

export const InventoryBucketTypes = {
  ROOM_CATEGORY: "ROOM_CATEGORY",
  FULL_PROPERTY: "FULL_PROPERTY"
} as const;

export type InventoryBucketType = (typeof InventoryBucketTypes)[keyof typeof InventoryBucketTypes];

export const InventoryBlockScopes = {
  PROPERTY: "PROPERTY",
  ROOM_CATEGORY: "ROOM_CATEGORY",
  PHYSICAL_UNIT: "PHYSICAL_UNIT"
} as const;

export type InventoryBlockScope = (typeof InventoryBlockScopes)[keyof typeof InventoryBlockScopes];

export const InventoryBlockTypes = {
  MAINTENANCE: "MAINTENANCE",
  RENOVATION: "RENOVATION",
  OWNER_USE: "OWNER_USE",
  STAFF_USE: "STAFF_USE",
  REGULATORY_CLOSURE: "REGULATORY_CLOSURE",
  WILDLEAF_QUALITY: "WILDLEAF_QUALITY",
  MANUAL: "MANUAL"
} as const;

export type InventoryBlockType = (typeof InventoryBlockTypes)[keyof typeof InventoryBlockTypes];

export type SaleMode = "ROOMS_ONLY" | "FULL_PROPERTY_ONLY" | "BOTH";

export interface SetInventoryControlsInput {
  organizationId: string;
  propertyId: string;
  bucketType: InventoryBucketType;
  roomCategoryId: string | null;
  startDate: string;
  endDate: string;
  stopSell: boolean | null;
  overbookingLimit: number | null;
  capacityOverride?: number | null;
}

export interface CreateInventoryBlockInput {
  organizationId: string;
  propertyId: string;
  scopeType: InventoryBlockScope;
  roomCategoryId: string | null;
  physicalUnitId: string | null;
  blockType: InventoryBlockType;
  startDate: string;
  endDate: string;
  quantity: number;
  reason: string;
}

export interface RoomCategoryAvailability extends JsonObject {
  roomCategoryId: string;
  roomCategoryCode: string;
  roomCategoryName: string;
  date: string;
  physicalCapacity: number;
  capacityOverride: number | null;
  inventoryCapacity: number;
  heldQuantity: number;
  confirmedQuantity: number;
  blockedQuantity: number;
  overbookingLimit: number;
  stopSell: boolean;
  sellableQuantity: number;
}

export interface FullPropertyAvailability extends JsonObject {
  date: string;
  capacity: number;
  heldQuantity: number;
  confirmedQuantity: number;
  stopSell: boolean;
  roomInventoryConflict: boolean;
  sellableQuantity: number;
}

export interface DailyAvailability extends JsonObject {
  date: string;
  propertyClosed: boolean;
  roomCategories: RoomCategoryAvailability[];
  fullProperty: FullPropertyAvailability | null;
}

export interface InventoryAvailabilityResult extends JsonObject {
  propertyId: string;
  saleMode: SaleMode;
  startDate: string;
  endDate: string;
  days: DailyAvailability[];
}

export interface InventoryControlResult extends JsonObject {
  propertyId: string;
  bucketType: InventoryBucketType;
  roomCategoryId: string | null;
  startDate: string;
  endDate: string;
  stopSell: boolean | null;
  overbookingLimit: number | null;
  capacityOverride: number | null;
  affectedDays: number;
}

export interface InventoryBlockView extends JsonObject {
  id: string;
  propertyId: string;
  scopeType: InventoryBlockScope;
  roomCategoryId: string | null;
  physicalUnitId: string | null;
  blockType: InventoryBlockType;
  startDate: string;
  endDate: string;
  quantity: number;
  reason: string;
  status: "ACTIVE" | "RELEASED";
  releaseReason: string | null;
  releasedAt: string | null;
}

export interface InventoryBlockResult extends JsonObject {
  block: InventoryBlockView;
}

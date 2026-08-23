import type { JsonObject } from "../../../infrastructure/database/types.js";
import type { InventoryBucketType } from "./inventory.js";

export const InventoryHoldStatuses = {
  ACTIVE: "ACTIVE",
  RELEASED: "RELEASED",
  EXPIRED: "EXPIRED"
} as const;

export type InventoryHoldStatus =
  (typeof InventoryHoldStatuses)[keyof typeof InventoryHoldStatuses];

export interface InventoryHoldItemInput extends JsonObject {
  bucketType: InventoryBucketType;
  roomCategoryId: string | null;
  quantity: number;
}

export interface CreateInventoryHoldInput extends JsonObject {
  organizationId: string;
  propertyId: string;
  startDate: string;
  endDate: string;
  ttlSeconds: number;
  clientReference: string | null;
  items: InventoryHoldItemInput[];
}

export interface InventoryHoldItemView extends JsonObject {
  id: string;
  bucketType: InventoryBucketType;
  roomCategoryId: string | null;
  quantity: number;
}

export interface InventoryHoldView extends JsonObject {
  id: string;
  propertyId: string;
  status: InventoryHoldStatus;
  startDate: string;
  endDate: string;
  expiresAt: string;
  clientReference: string | null;
  items: InventoryHoldItemView[];
  releasedAt: string | null;
  releaseReason: string | null;
  createdAt: string;
}

export interface InventoryHoldResult extends JsonObject {
  hold: InventoryHoldView;
}

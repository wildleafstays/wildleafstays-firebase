import type { JsonObject } from "../../../infrastructure/database/types.js";
import type { InventoryBucketType } from "./inventory.js";

export const InventoryAllocationStatuses = {
  CONFIRMED: "CONFIRMED",
  RELEASED: "RELEASED"
} as const;

export type InventoryAllocationStatus =
  (typeof InventoryAllocationStatuses)[keyof typeof InventoryAllocationStatuses];

export interface InventoryAllocationItemView extends JsonObject {
  id: string;
  bucketType: InventoryBucketType;
  roomCategoryId: string | null;
  quantity: number;
}

export interface InventoryAllocationView extends JsonObject {
  id: string;
  propertyId: string;
  holdId: string;
  confirmationReference: string;
  startDate: string;
  endDate: string;
  status: InventoryAllocationStatus;
  items: InventoryAllocationItemView[];
  confirmedAt: string;
  releasedAt: string | null;
  releaseReason: string | null;
}

export interface InventoryAllocationResult extends JsonObject {
  allocation: InventoryAllocationView;
}

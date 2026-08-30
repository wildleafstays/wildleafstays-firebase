import { ConflictError } from "../../../shared/errors/app-error.js";
import {
  InventoryBlockScopes,
  InventoryBucketTypes,
  type FullPropertyAvailability,
  type InventoryAvailabilityResult,
  type SaleMode
} from "../domain/inventory.js";

export type MissingInventoryBucketMode = "ERROR" | "VIRTUAL";

export interface AvailabilityCategoryInput {
  id: string;
  code: string;
  name: string;
  capacity: number;
}

export interface AvailabilityBucketInput {
  bucketType: "ROOM_CATEGORY" | "FULL_PROPERTY";
  roomCategoryId: string | null;
  stayDate: string;
  heldQuantity: number;
  confirmedQuantity: number;
  capacityOverride?: number | null;
  overbookingLimit: number;
  stopSell: boolean;
}

export interface AvailabilityBlockInput {
  scopeType: "PROPERTY" | "ROOM_CATEGORY" | "PHYSICAL_UNIT";
  roomCategoryId: string | null;
  physicalUnitId: string | null;
  startDate: string;
  endDate: string;
  quantity: number;
}

export interface CalculateInventoryAvailabilityInput {
  propertyId: string;
  saleMode: SaleMode;
  startDate: string;
  endDate: string;
  dates: string[];
  categories: AvailabilityCategoryInput[];
  buckets: AvailabilityBucketInput[];
  blocks: AvailabilityBlockInput[];
  missingBucketMode: MissingInventoryBucketMode;
}

function includesFullProperty(mode: SaleMode): boolean {
  return mode === "FULL_PROPERTY_ONLY" || mode === "BOTH";
}

function bucketKey(
  bucketType: "ROOM_CATEGORY" | "FULL_PROPERTY",
  roomCategoryId: string | null,
  stayDate: string
): string {
  return `${bucketType}:${roomCategoryId ?? "PROPERTY"}:${stayDate}`;
}

function blockAppliesOn(block: AvailabilityBlockInput, stayDate: string): boolean {
  return block.startDate <= stayDate && block.endDate > stayDate;
}

function missingRoomBucket(
  mode: MissingInventoryBucketMode,
  category: AvailabilityCategoryInput,
  stayDate: string
): AvailabilityBucketInput {
  if (mode === "ERROR") {
    throw new ConflictError("Inventory bucket materialization failed", {
      roomCategoryId: category.id,
      date: stayDate
    });
  }

  return {
    bucketType: InventoryBucketTypes.ROOM_CATEGORY,
    roomCategoryId: category.id,
    stayDate,
    heldQuantity: 0,
    confirmedQuantity: 0,
    capacityOverride: null,
    overbookingLimit: 0,
    stopSell: false
  };
}

export function calculateInventoryAvailability(
  input: CalculateInventoryAvailabilityInput
): InventoryAvailabilityResult {
  const bucketMap = new Map(
    input.buckets.map((bucket) => [
      bucketKey(bucket.bucketType, bucket.roomCategoryId, bucket.stayDate),
      bucket
    ])
  );

  const days = input.dates.map((date) => {
    const dayBlocks = input.blocks.filter((block) => blockAppliesOn(block, date));
    const propertyClosed = dayBlocks.some(
      (block) => block.scopeType === InventoryBlockScopes.PROPERTY
    );

    const roomCategories = input.categories.map((category) => {
      const bucket =
        bucketMap.get(bucketKey(InventoryBucketTypes.ROOM_CATEGORY, category.id, date)) ??
        missingRoomBucket(input.missingBucketMode, category, date);

      const categoryBlocks = dayBlocks.filter(
        (block) =>
          block.scopeType === InventoryBlockScopes.ROOM_CATEGORY &&
          block.roomCategoryId === category.id
      );

      const unitBlocks = new Set(
        dayBlocks
          .filter(
            (block) =>
              block.scopeType === InventoryBlockScopes.PHYSICAL_UNIT &&
              block.roomCategoryId === category.id &&
              block.physicalUnitId
          )
          .map((block) => block.physicalUnitId as string)
      );

      const blockedQuantity =
        categoryBlocks.reduce((sum, block) => sum + block.quantity, 0) + unitBlocks.size;

      const unavailable = propertyClosed || bucket.stopSell;
      const inventoryCapacity = bucket.capacityOverride ?? category.capacity;
      const rawSellable =
        inventoryCapacity +
        bucket.overbookingLimit -
        bucket.heldQuantity -
        bucket.confirmedQuantity -
        blockedQuantity;

      return {
        roomCategoryId: category.id,
        roomCategoryCode: category.code,
        roomCategoryName: category.name,
        date,
        physicalCapacity: category.capacity,
        capacityOverride: bucket.capacityOverride ?? null,
        inventoryCapacity,
        heldQuantity: bucket.heldQuantity,
        confirmedQuantity: bucket.confirmedQuantity,
        blockedQuantity,
        overbookingLimit: bucket.overbookingLimit,
        stopSell: bucket.stopSell,
        sellableQuantity: unavailable ? 0 : Math.max(0, rawSellable)
      };
    });

    let fullProperty: FullPropertyAvailability | null = null;
    if (includesFullProperty(input.saleMode)) {
      const activeRoomCategories = roomCategories.filter((room) => room.physicalCapacity > 0);

      const fullPropertyHeld = activeRoomCategories.some((room) => room.heldQuantity > 0);
      const fullPropertyConfirmed = activeRoomCategories.some((room) => room.confirmedQuantity > 0);
      const fullPropertyStopSell = activeRoomCategories.some((room) => room.stopSell);

      const roomInventoryConflict =
        activeRoomCategories.length === 0 ||
        activeRoomCategories.some(
          (room) =>
            room.inventoryCapacity <= 0 ||
            room.sellableQuantity < room.physicalCapacity ||
            room.heldQuantity > 0 ||
            room.confirmedQuantity > 0 ||
            room.blockedQuantity > 0 ||
            room.stopSell
        );

      fullProperty = {
        date,
        capacity: 1,
        heldQuantity: fullPropertyHeld ? 1 : 0,
        confirmedQuantity: fullPropertyConfirmed ? 1 : 0,
        stopSell: fullPropertyStopSell,
        roomInventoryConflict,
        sellableQuantity: propertyClosed || roomInventoryConflict ? 0 : 1
      };
    }

    return {
      date,
      propertyClosed,
      roomCategories,
      fullProperty
    };
  });

  return {
    propertyId: input.propertyId,
    saleMode: input.saleMode,
    startDate: input.startDate,
    endDate: input.endDate,
    days
  };
}

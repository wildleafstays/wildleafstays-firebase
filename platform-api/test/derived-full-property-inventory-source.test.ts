import { describe, expect, it } from "vitest";
import { calculateInventoryAvailability } from "../src/modules/inventory/application/inventory-availability-calculator.js";

const DATE = "2026-09-10";

function category(id: string, capacity: number) {
  return {
    id,
    code: id.toUpperCase(),
    name: id,
    capacity
  };
}

function roomBucket(
  roomCategoryId: string,
  capacityOptions: {
    held?: number;
    confirmed?: number;
    capacityOverride?: number;
    overbooking?: number;
    stopSell?: boolean;
  } = {}
) {
  return {
    bucketType: "ROOM_CATEGORY" as const,
    roomCategoryId,
    stayDate: DATE,
    heldQuantity: capacityOptions.held ?? 0,
    confirmedQuantity: capacityOptions.confirmed ?? 0,
    capacityOverride: capacityOptions.capacityOverride ?? null,
    overbookingLimit: capacityOptions.overbooking ?? 0,
    stopSell: capacityOptions.stopSell ?? false
  };
}

function staleFullPropertyBucket() {
  return {
    bucketType: "FULL_PROPERTY" as const,
    roomCategoryId: null,
    stayDate: DATE,
    heldQuantity: 1,
    confirmedQuantity: 1,
    overbookingLimit: 0,
    stopSell: true
  };
}

function calculate(
  saleMode: "ROOMS_ONLY" | "FULL_PROPERTY_ONLY" | "BOTH",
  categories: ReturnType<typeof category>[],
  buckets: Array<ReturnType<typeof roomBucket> | ReturnType<typeof staleFullPropertyBucket>>
) {
  return calculateInventoryAvailability({
    propertyId: "property-1",
    saleMode,
    startDate: DATE,
    endDate: "2026-09-11",
    dates: [DATE],
    categories,
    buckets,
    blocks: [],
    missingBucketMode: "ERROR"
  });
}

describe("derived full-property universal inventory source", () => {
  it("derives full-property availability from room-category inventory without a full-property bucket", () => {
    const result = calculate(
      "BOTH",
      [category("deluxe", 2), category("suite", 1)],
      [roomBucket("deluxe"), roomBucket("suite")]
    );

    expect(result.days[0]?.fullProperty).toMatchObject({
      capacity: 1,
      heldQuantity: 0,
      confirmedQuantity: 0,
      stopSell: false,
      roomInventoryConflict: false,
      sellableQuantity: 1
    });
  });

  it("closes the full property after any individual room hold while leaving remaining rooms sellable", () => {
    const result = calculate(
      "BOTH",
      [category("deluxe", 2), category("suite", 1)],
      [roomBucket("deluxe", { held: 1 }), roomBucket("suite")]
    );

    expect(result.days[0]?.fullProperty?.sellableQuantity).toBe(0);
    expect(result.days[0]?.fullProperty?.roomInventoryConflict).toBe(true);

    expect(
      result.days[0]?.roomCategories.find((item) => item.roomCategoryId === "deluxe")
        ?.sellableQuantity
    ).toBe(1);

    expect(
      result.days[0]?.roomCategories.find((item) => item.roomCategoryId === "suite")
        ?.sellableQuantity
    ).toBe(1);
  });

  it("represents a full-property hold through canonical room-category inventory only", () => {
    const result = calculate(
      "BOTH",
      [category("deluxe", 2), category("suite", 1)],
      [roomBucket("deluxe", { held: 2 }), roomBucket("suite", { held: 1 })]
    );

    expect(result.days[0]?.fullProperty).toMatchObject({
      heldQuantity: 1,
      roomInventoryConflict: true,
      sellableQuantity: 0
    });

    expect(result.days[0]?.roomCategories.every((item) => item.sellableQuantity === 0)).toBe(true);
  });

  it("inherits room-category inventory stop-sell into full-property availability", () => {
    const result = calculate(
      "BOTH",
      [category("deluxe", 1), category("suite", 1)],
      [roomBucket("deluxe", { stopSell: true }), roomBucket("suite")]
    );

    expect(result.days[0]?.fullProperty).toMatchObject({
      stopSell: true,
      roomInventoryConflict: true,
      sellableQuantity: 0
    });

    expect(
      result.days[0]?.roomCategories.find((item) => item.roomCategoryId === "suite")
        ?.sellableQuantity
    ).toBe(1);
  });

  it("closes the full property when an inventory override leaves fewer rooms than physical capacity", () => {
    const result = calculate(
      "BOTH",
      [category("deluxe", 2)],
      [roomBucket("deluxe", { capacityOverride: 1 })]
    );

    expect(result.days[0]?.fullProperty).toMatchObject({
      roomInventoryConflict: true,
      sellableQuantity: 0
    });
    expect(result.days[0]?.roomCategories[0]?.sellableQuantity).toBe(1);
  });

  it("ignores stale legacy full-property buckets completely", () => {
    const result = calculate(
      "BOTH",
      [category("deluxe", 1), category("suite", 1)],
      [roomBucket("deluxe"), roomBucket("suite"), staleFullPropertyBucket()]
    );

    expect(result.days[0]?.fullProperty).toMatchObject({
      heldQuantity: 0,
      confirmedQuantity: 0,
      stopSell: false,
      roomInventoryConflict: false,
      sellableQuantity: 1
    });
  });

  it("derives FULL_PROPERTY_ONLY availability from physical room-category inventory", () => {
    const result = calculate(
      "FULL_PROPERTY_ONLY",
      [category("deluxe", 2), category("suite", 1)],
      [roomBucket("deluxe"), roomBucket("suite")]
    );

    expect(result.days[0]?.fullProperty).toMatchObject({
      capacity: 1,
      roomInventoryConflict: false,
      sellableQuantity: 1
    });
  });
});

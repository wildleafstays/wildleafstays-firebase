import { describe, expect, it } from "vitest";
import type {
  PublicAvailabilityOptionView,
  PublicAvailabilityView
} from "../src/modules/public-booking/domain/public-availability.js";
import type { PublicPropertyDetailView } from "../src/modules/public-booking/domain/public-catalog.js";
import { PublicRoomRecommendationService } from "../src/modules/public-booking/application/public-room-recommendation-service.js";
import type { PublicRecommendationGuestAgePolicyReader } from "../src/modules/public-booking/application/public-room-recommendation-service.js";
import type { PublicCatalogService } from "../src/modules/public-booking/application/public-catalog-service.js";
import type { PublicAvailabilityService } from "../src/modules/public-booking/application/public-availability-service.js";

const deluxeId = "11111111-1111-4111-8111-111111111111";
const superId = "22222222-2222-4222-8222-222222222222";
const deluxeRateId = "33333333-3333-4333-8333-333333333333";
const superRateId = "44444444-4444-4444-8444-444444444444";

const property: PublicPropertyDetailView = {
  publicSlug: "smart-mix-hotel",
  name: "Smart Mix Hotel",
  propertyType: "HOTEL",
  saleMode: "ROOMS_ONLY",
  shortDescription: null,
  locality: "Chail",
  city: "Chail",
  stateRegion: "Himachal Pradesh",
  countryCode: "IN",
  coverMediaId: null,
  description: null,
  checkInTime: "14:00",
  checkOutTime: "11:00",
  amenities: [],
  policies: null,
  media: [],
  roomCategories: [
    {
      roomCategoryId: deluxeId,
      coverMediaId: null,
      code: "DLX",
      name: "Deluxe Room",
      accommodationType: "ROOM",
      description: null,
      baseOccupancy: 2,
      maxAdults: 2,
      maxChildren: 0,
      maxOccupancy: 2,
      sizeSqm: 24,
      bedConfiguration: "1 King Bed",
      extraBedAllowed: false,
      defaultViewLabel: null
    },
    {
      roomCategoryId: superId,
      coverMediaId: null,
      code: "SDLX",
      name: "Super Deluxe",
      accommodationType: "ROOM",
      description: null,
      baseOccupancy: 2,
      maxAdults: 2,
      maxChildren: 2,
      maxOccupancy: 3,
      sizeSqm: 32,
      bedConfiguration: "1 King Bed",
      extraBedAllowed: true,
      defaultViewLabel: "Valley view"
    }
  ]
};

function option(
  roomCategoryId: string,
  roomCategoryName: string,
  rateProductId: string,
  available: boolean,
  requestedUnits: number,
  estimatedTotalMinor: number
): PublicAvailabilityOptionView {
  return {
    rateProductId,
    productType: "ROOM_CATEGORY" as const,
    roomCategoryId,
    roomCategoryCode: roomCategoryName === "Deluxe Room" ? "DLX" : "SDLX",
    roomCategoryName,
    ratePlanCode: "EP",
    ratePlanName: "Flexible",
    mealPlanCode: "EP",
    currencyCode: "INR",
    requestedUnits,
    available,
    unavailableReasons: available ? [] : ["OCCUPANCY_EXCEEDED"],
    nightlyFromMinor: Math.floor(estimatedTotalMinor / Math.max(1, requestedUnits)),
    accommodationMinor: estimatedTotalMinor,
    extraGuestMinor: 0,
    estimatedTotalMinor,
    minimumStay: 1,
    maximumStay: null
  };
}

function availabilityFor(
  units: Array<{ adults: number; children: number }>
): PublicAvailabilityView {
  const deluxeAvailable = units.every(
    (unit) => unit.adults <= 2 && unit.children === 0 && unit.adults <= 2
  );
  const superAvailable = units.every(
    (unit) => unit.adults <= 2 && unit.children <= 2 && unit.adults + unit.children <= 3
  );

  const deluxePrice = 400_000 * units.length;
  const superPrice =
    550_000 * units.length + units.reduce((sum, unit) => sum + unit.children * 50_000, 0);

  return {
    property: {
      publicSlug: property.publicSlug,
      name: property.name,
      saleMode: "ROOMS_ONLY"
    },
    search: {
      arrivalDate: "2032-04-10",
      departureDate: "2032-04-11",
      nights: 1,
      units
    },
    pricingScope: "BASE_RATE_AND_EXTRA_GUEST_ONLY",
    exactCommercialPriceIncluded: false,
    options: [
      option(deluxeId, "Deluxe Room", deluxeRateId, deluxeAvailable, units.length, deluxePrice),
      option(superId, "Super Deluxe", superRateId, superAvailable, units.length, superPrice)
    ]
  };
}

const agePolicies = {
  resolve: async () => ({
    infantMaxAge: 5,
    childMaxAge: 12,
    infantsCountTowardsOccupancy: false,
    infantsCountTowardsChildLimit: false,
    infantsChargeAsChildren: false
  })
} as unknown as PublicRecommendationGuestAgePolicyReader;

describe("PublicRoomRecommendationService", () => {
  it("recommends a valid mixed room combination for 3 adults and 2 children", async () => {
    const catalog = {
      getProperty: async () => ({ property })
    } as unknown as PublicCatalogService;

    const availability = {
      search: async (
        _db: unknown,
        _slug: string,
        request: { units: Array<{ adults: number; children: number }> }
      ) => availabilityFor(request.units)
    } as unknown as PublicAvailabilityService;

    const service = new PublicRoomRecommendationService(catalog, availability, agePolicies);

    const result = await service.recommend({} as never, property.publicSlug, {
      arrivalDate: "2032-04-10",
      departureDate: "2032-04-11",
      adults: 3,
      childAges: [8, 10],
      maxRooms: 2
    });

    expect(result.singleCheckoutSupported).toBe(true);
    expect(result.recommendations.length).toBeGreaterThan(0);

    const best = result.recommendations[0]!;
    expect(best.reason).toBe("BEST_VALUE");
    expect(best.roomCount).toBe(2);
    expect(best.adults).toBe(3);
    expect(best.children).toBe(2);
    expect(best.estimatedTotalMinor).toBe(1_050_000);

    expect(best.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roomCategoryId: deluxeId,
          roomCategoryName: "Deluxe Room",
          quantity: 1,
          units: [{ adults: 2, children: 0, childAges: [] }]
        }),
        expect.objectContaining({
          roomCategoryId: superId,
          roomCategoryName: "Super Deluxe",
          quantity: 1,
          units: [{ adults: 1, children: 2, childAges: [8, 10] }]
        })
      ])
    );
  });

  it("keeps a free non-occupancy infant's exact age with the recommended room", async () => {
    const catalog = {
      getProperty: async () => ({ property })
    } as unknown as PublicCatalogService;

    const availability = {
      search: async (
        _db: unknown,
        _slug: string,
        request: { units: Array<{ adults: number; children: number }> }
      ) => availabilityFor(request.units)
    } as unknown as PublicAvailabilityService;

    const service = new PublicRoomRecommendationService(catalog, availability, agePolicies);
    const result = await service.recommend({} as never, property.publicSlug, {
      arrivalDate: "2032-04-10",
      departureDate: "2032-04-11",
      adults: 2,
      childAges: [4],
      maxRooms: 1
    });

    const best = result.recommendations[0]!;
    expect(best.roomCount).toBe(1);
    expect(best.items[0]).toMatchObject({
      roomCategoryId: deluxeId,
      units: [{ adults: 2, children: 1, childAges: [4] }]
    });
  });

  it("never recommends a room assignment that breaks category occupancy", async () => {
    const catalog = {
      getProperty: async () => ({ property })
    } as unknown as PublicCatalogService;

    const availability = {
      search: async (
        _db: unknown,
        _slug: string,
        request: { units: Array<{ adults: number; children: number }> }
      ) => availabilityFor(request.units)
    } as unknown as PublicAvailabilityService;

    const service = new PublicRoomRecommendationService(catalog, availability, agePolicies);
    const result = await service.recommend({} as never, property.publicSlug, {
      arrivalDate: "2032-04-10",
      departureDate: "2032-04-11",
      adults: 3,
      childAges: [8, 10],
      maxRooms: 2
    });

    for (const recommendation of result.recommendations) {
      for (const item of recommendation.items) {
        const category = property.roomCategories.find(
          (candidate) => candidate.roomCategoryId === item.roomCategoryId
        )!;
        for (const unit of item.units) {
          expect(unit.adults).toBeLessThanOrEqual(category.maxAdults);
          expect(unit.children).toBeLessThanOrEqual(category.maxChildren);
          expect(unit.adults + unit.children).toBeLessThanOrEqual(category.maxOccupancy);
        }
      }
    }
  });
});

export interface PublicAvailabilityUnitInput {
  adults: number;
  children: number;
}

export interface PublicAvailabilityRequest {
  arrivalDate: string;
  departureDate: string;
  units: PublicAvailabilityUnitInput[];
}

export type PublicAvailabilityReason =
  | "FULL_PROPERTY_SINGLE_UNIT_ONLY"
  | "OCCUPANCY_EXCEEDED"
  | "ARRIVAL_CLOSED"
  | "DEPARTURE_CLOSED"
  | "MINIMUM_STAY"
  | "MAXIMUM_STAY"
  | "RATE_STOP_SELL"
  | "INVENTORY_UNAVAILABLE";

export interface PublicAvailabilityOptionView {
  rateProductId: string;
  productType: "ROOM_CATEGORY" | "FULL_PROPERTY";
  roomCategoryId: string | null;
  roomCategoryCode: string | null;
  roomCategoryName: string | null;
  ratePlanCode: string;
  ratePlanName: string;
  mealPlanCode: string;
  currencyCode: string;
  requestedUnits: number;
  available: boolean;
  unavailableReasons: PublicAvailabilityReason[];
  nightlyFromMinor: number;
  accommodationMinor: number;
  extraGuestMinor: number;
  estimatedTotalMinor: number;
  minimumStay: number;
  maximumStay: number | null;
}

export interface PublicAvailabilityView {
  property: {
    publicSlug: string;
    name: string;
    saleMode: "ROOMS_ONLY" | "FULL_PROPERTY_ONLY" | "BOTH";
  };
  search: {
    arrivalDate: string;
    departureDate: string;
    nights: number;
    units: PublicAvailabilityUnitInput[];
  };
  pricingScope: "BASE_RATE_AND_EXTRA_GUEST_ONLY";
  exactCommercialPriceIncluded: false;
  options: PublicAvailabilityOptionView[];
}

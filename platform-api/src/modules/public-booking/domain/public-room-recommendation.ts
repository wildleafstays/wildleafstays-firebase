export interface PublicRoomRecommendationRequest {
  arrivalDate: string;
  departureDate: string;
  adults: number;
  childAges: number[];
  maxRooms?: number;
}

export interface PublicRecommendedRoomUnit {
  adults: number;
  children: number;
  childAges: number[];
}

export interface PublicRecommendedRoomItem {
  roomCategoryId: string;
  roomCategoryName: string;
  coverMediaId: string | null;
  rateProductId: string;
  ratePlanCode: string;
  ratePlanName: string;
  mealPlanCode: string;
  quantity: number;
  maxOccupancy: number;
  units: PublicRecommendedRoomUnit[];
  estimatedTotalMinor: number;
}

export interface PublicRoomRecommendation {
  recommendationId: string;
  rank: number;
  reason: "BEST_VALUE" | "FEWER_ROOMS" | "MORE_SPACE" | "ALTERNATIVE";
  roomCount: number;
  adults: number;
  children: number;
  currencyCode: string;
  estimatedTotalMinor: number;
  occupancySlack: number;
  items: PublicRecommendedRoomItem[];
}

export interface PublicRoomRecommendationView {
  property: {
    publicSlug: string;
    name: string;
  };
  search: {
    arrivalDate: string;
    departureDate: string;
    adults: number;
    children: number;
    childAges: number[];
    maxRooms: number;
  };
  pricingScope: "BASE_RATE_AND_EXTRA_GUEST_ONLY";
  exactCommercialPriceIncluded: false;
  singleCheckoutSupported: true;
  recommendations: PublicRoomRecommendation[];
}

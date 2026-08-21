import type { JsonObject } from "../../../infrastructure/database/types.js";

export interface PublicQuoteUnitRequest extends JsonObject {
  adults: number;
  childAges: number[];
}

export interface PublicQuoteRequest extends JsonObject {
  rateProductId: string;
  arrivalDate: string;
  departureDate: string;
  promotionCode?: string | null;
  units: PublicQuoteUnitRequest[];
}

export interface PublicQuoteGuestAgePolicyView extends JsonObject {
  infantMaxAge: number | null;
  childMaxAge: number;
  infantsCountTowardsOccupancy: boolean;
  infantsCountTowardsChildLimit: boolean;
  infantsChargeAsChildren: boolean;
}

export interface PublicQuoteUnitView extends JsonObject {
  unitIndex: number;
  adults: number;
  childAges: number[];
  children: number;
  infants: number;
  occupancyCount: number;
  childLimitCount: number;
  chargeableChildren: number;
  extraAdults: number;
  extraChildren: number;
}

export interface PublicCancellationTierView extends JsonObject {
  triggerType: "CANCELLATION" | "NO_SHOW";
  minimumMinutesBeforeArrival: number | null;
  penaltyType: "PERCENTAGE_OF_STAY" | "FIXED_AMOUNT" | "NIGHTS";
  penaltyValue: number;
}

export interface PublicCancellationPolicyView extends JsonObject {
  policyCode: string;
  policyName: string;
  arrivalLocalTime: string;
  currencyCode: string;
  policyText: string | null;
  tiers: PublicCancellationTierView[];
}

export interface PublicPromotionLineView extends JsonObject {
  campaignCode: string;
  campaignName: string;
  promotionKind: "AUTOMATIC" | "PROMO_CODE";
  publicCode: string | null;
  discountType: "PERCENTAGE" | "FIXED_AMOUNT";
  discountValue: number;
  maximumDiscountMinor: number | null;
  appliesTo: "ACCOMMODATION" | "ACCOMMODATION_AND_EXTRA_GUEST";
  discountMinor: number;
}

export interface PublicPromotionView extends JsonObject {
  promotionMode: "NO_PROMOTIONS" | "POLICIES";
  requestedPromotionCode: string | null;
  discountMinor: number;
  lines: PublicPromotionLineView[];
}

export interface PublicQuoteView extends JsonObject {
  id: string;
  quoteReference: string;
  rateProductId: string;
  productType: "ROOM_CATEGORY" | "FULL_PROPERTY";
  productLabel: string;
  roomCategoryId: string | null;
  ratePlanCode: string;
  ratePlanName: string;
  mealPlanCode: string;
  arrivalDate: string;
  departureDate: string;
  quantity: number;
  currencyCode: string;
  pricingScope: "FINAL_COMMERCIAL_PRICE";
  exactCommercialPriceIncluded: true;
  accommodationMinor: number;
  extraGuestMinor: number;
  discountMinor: number;
  discountedAccommodationMinor: number;
  discountedExtraGuestMinor: number;
  inclusiveFeeMinor: number;
  exclusiveFeeMinor: number;
  feeMinor: number;
  inclusiveTaxMinor: number;
  exclusiveTaxMinor: number;
  taxMinor: number;
  totalMinor: number;
  commercialStatus: "COMMERCIAL_RULES_APPLIED";
  promotionStatus: "EVALUATED";
  holdEligible: true;
  expiresAt: string;
  createdAt: string;
  guestAgePolicy: PublicQuoteGuestAgePolicyView;
  units: PublicQuoteUnitView[];
  cancellationPolicy: PublicCancellationPolicyView;
  promotion: PublicPromotionView;
}

export interface PublicQuoteResult extends JsonObject {
  quote: PublicQuoteView;
}

export interface PublicHoldItemView extends JsonObject {
  bucketType: "ROOM_CATEGORY" | "FULL_PROPERTY";
  roomCategoryId: string | null;
  quantity: number;
}

export interface PublicHoldView extends JsonObject {
  id: string;
  status: "ACTIVE";
  startDate: string;
  endDate: string;
  expiresAt: string;
  clientReference: string | null;
  items: PublicHoldItemView[];
  createdAt: string;
}

export interface PublicQuoteHoldResult extends JsonObject {
  created: boolean;
  quoteId: string;
  quoteReference: string;
  hold: PublicHoldView;
}

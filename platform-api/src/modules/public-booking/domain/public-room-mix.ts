import type { JsonObject } from "../../../infrastructure/database/types.js";

export interface PublicRoomMixUnitRequest extends JsonObject {
  adults: number;
  childAges: number[];
}

export interface PublicRoomMixItemRequest extends JsonObject {
  rateProductId: string;
  units: PublicRoomMixUnitRequest[];
}

export interface PublicRoomMixQuoteRequest extends JsonObject {
  arrivalDate: string;
  departureDate: string;
  items: PublicRoomMixItemRequest[];
}

export interface PublicRoomMixQuoteItemView extends JsonObject {
  itemIndex: number;
  quoteId: string;
  quoteReference: string;
  rateProductId: string;
  roomCategoryId: string;
  productLabel: string;
  ratePlanCode: string;
  ratePlanName: string;
  mealPlanCode: string;
  quantity: number;
  accommodationMinor: number;
  extraGuestMinor: number;
  feeMinor: number;
  taxMinor: number;
  totalMinor: number;
  units: PublicRoomMixUnitRequest[];
}

export interface PublicRoomMixQuoteView extends JsonObject {
  id: string;
  roomMixReference: string;
  arrivalDate: string;
  departureDate: string;
  quantity: number;
  currencyCode: string;
  grossAccommodationMinor: number;
  grossExtraGuestMinor: number;
  discountMinor: number;
  feeMinor: number;
  taxMinor: number;
  totalMinor: number;
  expiresAt: string;
  holdEligible: true;
  checkoutSupported: true;
  items: PublicRoomMixQuoteItemView[];
}

export interface PublicRoomMixQuoteResult extends JsonObject {
  roomMixQuote: PublicRoomMixQuoteView;
}

export interface PublicRoomMixHoldView extends JsonObject {
  id: string;
  status: "ACTIVE";
  startDate: string;
  endDate: string;
  expiresAt: string;
  items: Array<{
    bucketType: "ROOM_CATEGORY";
    roomCategoryId: string;
    quantity: number;
  }>;
}

export interface PublicRoomMixHoldResult extends JsonObject {
  created: boolean;
  roomMixQuoteId: string;
  roomMixReference: string;
  hold: PublicRoomMixHoldView;
}

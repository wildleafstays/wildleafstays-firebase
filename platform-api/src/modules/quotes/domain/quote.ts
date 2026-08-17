import type { JsonObject } from "../../../infrastructure/database/types.js";

export interface QuoteUnitRequest extends JsonObject {
  adults: number;
  childAges: number[];
}

export interface CreateQuoteInput {
  organizationId: string;
  propertyId: string;
  rateProductId: string;
  arrivalDate: string;
  departureDate: string;
  ttlSeconds: number;
  units: QuoteUnitRequest[];
}

export interface QuoteUnitSnapshot extends JsonObject {
  unitIndex: number;
  adults: number;
  childAges: number[];
  includedAdults: number;
  includedChildren: number;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  extraAdults: number;
  extraChildren: number;
}

export interface QuoteNightSnapshot extends JsonObject {
  stayDate: string;
  nightlyUnitRateMinor: number;
  accommodationMinor: number;
  extraAdultMinor: number;
  extraChildMinor: number;
  extraGuestMinor: number;
  nightTotalMinor: number;
  sellableQuantitySnapshot: number;
  rateSource: string;
  rateOverrideVersion: number | null;
  minimumStay: number;
  maximumStay: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  stopSell: boolean;
}

export interface QuoteCalculation extends JsonObject {
  ratePlanId: string;
  ratePlanCode: string;
  ratePlanName: string;
  mealPlanCode: string;
  rateProductId: string;
  rateProductVersion: number;
  productType: "ROOM_CATEGORY" | "FULL_PROPERTY";
  productLabel: string;
  roomCategoryId: string | null;
  quantity: number;
  currencyCode: string;
  accommodationMinor: number;
  extraGuestMinor: number;
  taxMinor: number;
  feeMinor: number;
  totalMinor: number;
  arrivalClosedToArrival: boolean;
  departureClosedToDeparture: boolean;
  minimumStaySnapshot: number;
  maximumStaySnapshot: number | null;
  commercialStatus: "PRE_TAX_ONLY";
  holdEligible: false;
  units: QuoteUnitSnapshot[];
  nights: QuoteNightSnapshot[];
}

export interface QuoteView extends JsonObject {
  id: string;
  quoteReference: string;
  organizationId: string;
  propertyId: string;
  ratePlanId: string;
  ratePlanCode: string;
  ratePlanName: string;
  mealPlanCode: string;
  rateProductId: string;
  rateProductVersion: number;
  productType: "ROOM_CATEGORY" | "FULL_PROPERTY";
  productLabel: string;
  roomCategoryId: string | null;
  arrivalDate: string;
  departureDate: string;
  quantity: number;
  currencyCode: string;
  accommodationMinor: number;
  extraGuestMinor: number;
  taxMinor: number;
  feeMinor: number;
  totalMinor: number;
  arrivalClosedToArrival: boolean;
  departureClosedToDeparture: boolean;
  minimumStaySnapshot: number;
  maximumStaySnapshot: number | null;
  commercialStatus: "PRE_TAX_ONLY";
  holdEligible: false;
  expiresAt: string;
  expired: boolean;
  createdAt: string;
  units: QuoteUnitSnapshot[];
  nights: QuoteNightSnapshot[];
}

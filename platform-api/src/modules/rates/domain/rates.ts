import type { JsonObject } from "../../../infrastructure/database/types.js";

export const MealPlanCodes = {
  EP: "EP",
  CP: "CP",
  MAP: "MAP",
  AP: "AP",
  CUSTOM: "CUSTOM"
} as const;

export type MealPlanCode = (typeof MealPlanCodes)[keyof typeof MealPlanCodes];

export const RateProductTypes = {
  ROOM_CATEGORY: "ROOM_CATEGORY",
  FULL_PROPERTY: "FULL_PROPERTY"
} as const;

export type RateProductType = (typeof RateProductTypes)[keyof typeof RateProductTypes];

export interface CreateRatePlanInput {
  organizationId: string;
  propertyId: string;
  code: string;
  name: string;
  description: string | null;
  mealPlanCode: MealPlanCode;
}

export interface ConfigureRateProductInput {
  organizationId: string;
  propertyId: string;
  ratePlanId: string;
  productType: RateProductType;
  roomCategoryId: string | null;
  baseRateMinor: number;
  floorRateMinor: number | null;
  ceilingRateMinor: number | null;
  includedAdults: number;
  includedChildren: number;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  extraAdultMinor: number;
  extraChildMinor: number;
  expectedVersion: number | null;
}

export interface SetRateCalendarDayInput {
  stayDate: string;
  rateMinor: number;
  extraAdultMinor: number | null;
  extraChildMinor: number | null;
  minimumStay: number;
  maximumStay: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  stopSell: boolean;
  source: "MANUAL" | "REVENUE" | "SYSTEM";
  expectedVersion: number | null;
}

export interface RatePlanView extends JsonObject {
  id: string;
  propertyId: string;
  code: string;
  name: string;
  description: string | null;
  mealPlanCode: MealPlanCode;
  currencyCode: string;
  status: "ACTIVE" | "INACTIVE";
  version: number;
}

export interface RateProductView extends JsonObject {
  id: string;
  ratePlanId: string;
  productType: RateProductType;
  roomCategoryId: string | null;
  baseRateMinor: number;
  floorRateMinor: number | null;
  ceilingRateMinor: number | null;
  includedAdults: number;
  includedChildren: number;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  extraAdultMinor: number;
  extraChildMinor: number;
  status: "ACTIVE" | "INACTIVE";
  version: number;
}

export interface FullPropertyCategoryRateView extends JsonObject {
  roomCategoryId: string;
  physicalCapacity: number;
  unitRateMinor: number;
  extraAdultMinor: number;
  extraChildMinor: number;
  includedAdults: number;
  includedChildren: number;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
}

export interface RateCalendarDayView extends JsonObject {
  stayDate: string;
  rateMinor: number;
  extraAdultMinor: number;
  extraChildMinor: number;
  minimumStay: number;
  maximumStay: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  stopSell: boolean;
  source: "BASE" | "MANUAL" | "REVENUE" | "SYSTEM";
  overrideVersion: number | null;
  fullPropertyCategoryRates?: FullPropertyCategoryRateView[] | null;
}

export interface RateCalendarView extends JsonObject {
  ratePlan: RatePlanView;
  rateProduct: RateProductView;
  currencyCode: string;
  startDate: string;
  endDate: string;
  days: RateCalendarDayView[];
}

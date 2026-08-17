import type { JsonObject } from "../../../infrastructure/database/types.js";
import type {
  ResolvedCancellationPolicy,
  ResolvedCommercialQuoteContext,
  ResolvedGuestAgePolicy
} from "../../commercial/domain/commercial-quote-resolution.js";

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
  children: number;
  infants: number;
  occupancyCount: number;
  childLimitCount: number;
  chargeableChildren: number;
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

export interface QuoteFeeLineCalculation extends JsonObject {
  lineKey: string;
  feePolicyId: string;
  feePolicyVersionId: string;
  feePolicyCode: string;
  feePolicyName: string;
  version: number;
  effectiveFrom: string;
  stayDate: string | null;
  calculationType: "FIXED" | "PERCENTAGE";
  applicationBasis:
    "PER_STAY" | "PER_NIGHT" | "PER_UNIT_PER_STAY" | "PER_UNIT_PER_NIGHT" | "STAY_CHARGES";
  amountMinorSnapshot: number | null;
  rateBasisPointsSnapshot: number | null;
  priceMode: "EXCLUSIVE" | "INCLUSIVE";
  taxable: boolean;
  taxPolicyId: string | null;
  multiplier: number;
  feeMinor: number;
}

export interface QuoteTaxLineCalculation extends JsonObject {
  taxPolicyId: string;
  taxPolicyVersionId: string;
  taxPolicyCode: string;
  taxPolicyName: string;
  version: number;
  effectiveFrom: string;
  componentCode: string;
  componentName: string;
  rateBasisPoints: number;
  priceMode: "EXCLUSIVE" | "INCLUSIVE";
  chargeType: "ACCOMMODATION" | "EXTRA_GUEST" | "FEE";
  stayDate: string | null;
  feeLineKey: string | null;
  taxableBasisMinor: number;
  taxMinor: number;
}

export interface QuoteCommercialSettingDayCalculation extends JsonObject {
  stayDate: string;
  settingsVersionId: string;
  settingsVersion: number;
  settingsEffectiveFrom: string;
  taxMode: "NO_TAX" | "POLICIES";
  feeMode: "NO_FEES" | "POLICIES";
}

export interface QuoteUnitAgeBreakdownCalculation extends JsonObject {
  unitIndex: number;
  children: number;
  infants: number;
  occupancyCount: number;
  childLimitCount: number;
  chargeableChildren: number;
  extraAdults: number;
  extraChildren: number;
}

export interface QuoteCommercialCalculation extends JsonObject {
  commercialStatus: "COMMERCIAL_RULES_APPLIED";
  promotionStatus: "NOT_EVALUATED";
  holdEligible: false;
  currencyCode: string;
  accommodationMinor: number;
  extraGuestMinor: number;
  inclusiveFeeMinor: number;
  exclusiveFeeMinor: number;
  feeMinor: number;
  inclusiveTaxMinor: number;
  exclusiveTaxMinor: number;
  taxMinor: number;
  totalMinor: number;
  settingsDays: QuoteCommercialSettingDayCalculation[];
  guestAgePolicy: ResolvedGuestAgePolicy;
  unitAgeBreakdowns: QuoteUnitAgeBreakdownCalculation[];
  feeLines: QuoteFeeLineCalculation[];
  taxLines: QuoteTaxLineCalculation[];
  cancellationPolicy: ResolvedCancellationPolicy;
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
  commercial: QuoteCommercialCalculation | null;
}

export interface QuoteCommercialSnapshotView extends JsonObject {
  promotionStatus: "NOT_EVALUATED";
  inclusiveFeeMinor: number;
  exclusiveFeeMinor: number;
  inclusiveTaxMinor: number;
  exclusiveTaxMinor: number;
  settingsDays: QuoteCommercialSettingDayCalculation[];
  guestAgePolicy: ResolvedGuestAgePolicy;
  unitAgeBreakdowns: QuoteUnitAgeBreakdownCalculation[];
  feeLines: QuoteFeeLineCalculation[];
  taxLines: QuoteTaxLineCalculation[];
  cancellationPolicy: ResolvedCancellationPolicy;
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
  inclusiveTaxMinor: number;
  exclusiveTaxMinor: number;
  inclusiveFeeMinor: number;
  exclusiveFeeMinor: number;
  arrivalClosedToArrival: boolean;
  departureClosedToDeparture: boolean;
  minimumStaySnapshot: number;
  maximumStaySnapshot: number | null;
  commercialStatus: "PRE_TAX_ONLY" | "COMMERCIAL_RULES_APPLIED";
  promotionStatus: "NOT_EVALUATED" | null;
  holdEligible: false;
  expiresAt: string;
  expired: boolean;
  createdAt: string;
  units: QuoteUnitSnapshot[];
  nights: QuoteNightSnapshot[];
  commercial: QuoteCommercialSnapshotView | null;
}

export interface CommercialQuoteResolutionInput {
  context: ResolvedCommercialQuoteContext;
}

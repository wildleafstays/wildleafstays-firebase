import type { CommercialScopeType } from "./commercial-rules.js";
import type {
  PromotionAppliesTo,
  PromotionDiscountType,
  PromotionKind,
  PromotionMode,
  PromotionStackingMode
} from "./promotion-rules.js";

export interface ResolvedPromotionSettings {
  versionId: string;
  version: number;
  effectiveFrom: string;
  promotionMode: PromotionMode;
}

export interface ResolvedPromotionCampaign {
  campaignId: string;
  campaignCode: string;
  campaignName: string;
  promotionKind: PromotionKind;
  publicCode: string | null;
  versionId: string;
  version: number;
  effectiveFrom: string;
  currencyCode: string;
  bookingWindowStart: string | null;
  bookingWindowEnd: string | null;
  arrivalWindowStart: string | null;
  arrivalWindowEnd: string | null;
  minimumStayNights: number;
  minimumSpendMinor: number | null;
  discountType: PromotionDiscountType;
  discountValue: number;
  maximumDiscountMinor: number | null;
  appliesTo: PromotionAppliesTo;
  priority: number;
  stackingMode: PromotionStackingMode;
  stackGroup: string | null;
  assignmentId: string;
  assignmentScopeType: CommercialScopeType;
  assignmentRatePlanId: string | null;
  assignmentRateProductId: string | null;
  assignmentEffectiveFrom: string;
}

export interface ResolvedPromotionQuoteContext {
  bookingDate: string;
  requestedPromotionCode: string | null;
  settings: ResolvedPromotionSettings;
  campaigns: ResolvedPromotionCampaign[];
}

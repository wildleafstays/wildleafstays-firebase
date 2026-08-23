import type { JsonObject } from "../../../infrastructure/database/types.js";
import type { CommercialScopeType } from "./commercial-rules.js";

export type PromotionMode = "NO_PROMOTIONS" | "POLICIES";
export type PromotionKind = "AUTOMATIC" | "PROMO_CODE";
export type PromotionDiscountType = "PERCENTAGE" | "FIXED_AMOUNT";
export type PromotionAppliesTo = "ACCOMMODATION" | "ACCOMMODATION_AND_EXTRA_GUEST";
export type PromotionStackingMode = "EXCLUSIVE" | "STACKABLE";

export interface PromotionSettingsInput {
  organizationId: string;
  propertyId: string;
  effectiveFrom: string;
  promotionMode: PromotionMode;
  expectedVersion: number;
}

export interface CreatePromotionCampaignInput {
  organizationId: string;
  propertyId: string;
  code: string;
  name: string;
  description: string | null;
  promotionKind: PromotionKind;
  publicCode: string | null;
}

export interface CreatePromotionCampaignVersionInput {
  organizationId: string;
  propertyId: string;
  promotionCampaignId: string;
  effectiveFrom: string;
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
  expectedCurrentVersion: number;
}

export interface CreatePromotionAssignmentInput {
  organizationId: string;
  propertyId: string;
  promotionCampaignId: string;
  effectiveFrom: string;
  scopeType: CommercialScopeType;
  ratePlanId: string | null;
  rateProductId: string | null;
  enabled: boolean;
}

export interface PromotionSettingsVersionView extends JsonObject {
  id: string;
  version: number;
  effectiveFrom: string;
  promotionMode: PromotionMode;
}

export interface PromotionCampaignView extends JsonObject {
  id: string;
  code: string;
  name: string;
  description: string | null;
  promotionKind: PromotionKind;
  publicCode: string | null;
  status: "ACTIVE" | "INACTIVE";
  currentVersion: number;
}

export interface PromotionCampaignVersionView extends JsonObject {
  id: string;
  promotionCampaignId: string;
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
}

export interface PromotionAssignmentView extends JsonObject {
  id: string;
  promotionCampaignId: string;
  scopeType: CommercialScopeType;
  ratePlanId: string | null;
  rateProductId: string | null;
  effectiveFrom: string;
  enabled: boolean;
}

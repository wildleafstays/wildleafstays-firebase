import type { JsonObject } from "../../../infrastructure/database/types.js";

export type TaxMode = "NO_TAX" | "POLICIES";
export type FeeMode = "NO_FEES" | "POLICIES";
export type CommercialScopeType = "PROPERTY" | "RATE_PLAN" | "RATE_PRODUCT";
export type PriceMode = "EXCLUSIVE" | "INCLUSIVE";
export type TaxSelectionBasis =
  "ALWAYS" | "NIGHTLY_UNIT_RATE" | "NIGHTLY_TAXABLE_AMOUNT" | "STAY_TAXABLE_AMOUNT";
export type FeeCalculationType = "FIXED" | "PERCENTAGE";
export type FeeApplicationBasis =
  "PER_STAY" | "PER_NIGHT" | "PER_UNIT_PER_STAY" | "PER_UNIT_PER_NIGHT" | "STAY_CHARGES";
export type CancellationTriggerType = "CANCELLATION" | "NO_SHOW";
export type CancellationPenaltyType = "PERCENTAGE_OF_STAY" | "FIXED_AMOUNT" | "NIGHTS";

export interface PropertyCommercialSettingsInput {
  organizationId: string;
  propertyId: string;
  effectiveFrom: string;
  taxMode: TaxMode;
  feeMode: FeeMode;
  expectedVersion: number;
}

export interface CreateCommercialPolicyInput {
  organizationId: string;
  propertyId: string;
  code: string;
  name: string;
  description: string | null;
}

export interface TaxComponentInput {
  code: string;
  name: string;
  rateBasisPoints: number;
  sortOrder: number;
}

export interface CreateTaxPolicyVersionInput {
  organizationId: string;
  propertyId: string;
  taxPolicyId: string;
  effectiveFrom: string;
  priceMode: PriceMode;
  selectionBasis: TaxSelectionBasis;
  minimumBasisMinor: number | null;
  maximumBasisMinor: number | null;
  appliesToAccommodation: boolean;
  appliesToExtraGuest: boolean;
  appliesToFee: boolean;
  components: TaxComponentInput[];
  expectedCurrentVersion: number;
}

export interface CommercialAssignmentInput {
  organizationId: string;
  propertyId: string;
  effectiveFrom: string;
  scopeType: CommercialScopeType;
  ratePlanId: string | null;
  rateProductId: string | null;
  enabled: boolean;
}

export interface CreateTaxAssignmentInput extends CommercialAssignmentInput {
  taxPolicyId: string;
}

export interface CreateFeePolicyVersionInput {
  organizationId: string;
  propertyId: string;
  feePolicyId: string;
  effectiveFrom: string;
  calculationType: FeeCalculationType;
  applicationBasis: FeeApplicationBasis;
  amountMinor: number | null;
  rateBasisPoints: number | null;
  priceMode: PriceMode;
  taxable: boolean;
  taxPolicyId: string | null;
  expectedCurrentVersion: number;
}

export interface CreateFeeAssignmentInput extends CommercialAssignmentInput {
  feePolicyId: string;
}

export interface CancellationTierInput {
  triggerType: CancellationTriggerType;
  minimumMinutesBeforeArrival: number | null;
  penaltyType: CancellationPenaltyType;
  penaltyValue: number;
}

export interface CreateCancellationPolicyVersionInput {
  organizationId: string;
  propertyId: string;
  cancellationPolicyId: string;
  effectiveFrom: string;
  arrivalLocalTime: string;
  policyText: string | null;
  tiers: CancellationTierInput[];
  expectedCurrentVersion: number;
}

export interface CreateCancellationAssignmentInput {
  organizationId: string;
  propertyId: string;
  ratePlanId: string;
  cancellationPolicyId: string;
  effectiveFrom: string;
}

export interface GuestAgePolicyVersionInput {
  organizationId: string;
  propertyId: string;
  effectiveFrom: string;
  infantMaxAge: number | null;
  childMaxAge: number;
  infantsCountTowardsOccupancy: boolean;
  infantsCountTowardsChildLimit: boolean;
  infantsChargeAsChildren: boolean;
  expectedVersion: number;
}

export interface PropertyCommercialSettingsVersionView extends JsonObject {
  id: string;
  version: number;
  effectiveFrom: string;
  taxMode: TaxMode;
  feeMode: FeeMode;
}

export interface CommercialPolicyView extends JsonObject {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "INACTIVE";
  currentVersion: number;
}

export interface TaxPolicyVersionView extends JsonObject {
  id: string;
  taxPolicyId: string;
  version: number;
  effectiveFrom: string;
  priceMode: PriceMode;
  selectionBasis: TaxSelectionBasis;
  minimumBasisMinor: number | null;
  maximumBasisMinor: number | null;
  appliesToAccommodation: boolean;
  appliesToExtraGuest: boolean;
  appliesToFee: boolean;
  sealedAt: string;
  components: JsonObject[];
}

export interface FeePolicyVersionView extends JsonObject {
  id: string;
  feePolicyId: string;
  version: number;
  effectiveFrom: string;
  currencyCode: string;
  calculationType: FeeCalculationType;
  applicationBasis: FeeApplicationBasis;
  amountMinor: number | null;
  rateBasisPoints: number | null;
  priceMode: PriceMode;
  taxable: boolean;
  taxPolicyId: string | null;
}

export interface CancellationPolicyVersionView extends JsonObject {
  id: string;
  cancellationPolicyId: string;
  version: number;
  effectiveFrom: string;
  arrivalLocalTime: string;
  currencyCode: string;
  policyText: string | null;
  sealedAt: string;
  tiers: JsonObject[];
}

export interface GuestAgePolicyVersionView extends JsonObject {
  id: string;
  version: number;
  effectiveFrom: string;
  infantMaxAge: number | null;
  childMaxAge: number;
  infantsCountTowardsOccupancy: boolean;
  infantsCountTowardsChildLimit: boolean;
  infantsChargeAsChildren: boolean;
}

import type {
  FeeApplicationBasis,
  FeeCalculationType,
  FeeMode,
  PriceMode,
  TaxMode,
  TaxSelectionBasis
} from "./commercial-rules.js";

export interface ResolvedTaxComponent {
  code: string;
  name: string;
  rateBasisPoints: number;
  sortOrder: number;
}

export interface ResolvedTaxPolicy {
  policyId: string;
  policyCode: string;
  policyName: string;
  versionId: string;
  version: number;
  effectiveFrom: string;
  priceMode: PriceMode;
  selectionBasis: TaxSelectionBasis;
  minimumBasisMinor: number | null;
  maximumBasisMinor: number | null;
  appliesToAccommodation: boolean;
  appliesToExtraGuest: boolean;
  appliesToFee: boolean;
  components: ResolvedTaxComponent[];
}

export interface ResolvedFeePolicy {
  policyId: string;
  policyCode: string;
  policyName: string;
  versionId: string;
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
  taxPolicy: ResolvedTaxPolicy | null;
}

export interface ResolvedCommercialDay {
  stayDate: string;
  settingsVersionId: string;
  settingsVersion: number;
  settingsEffectiveFrom: string;
  taxMode: TaxMode;
  feeMode: FeeMode;
  taxPolicies: ResolvedTaxPolicy[];
  feePolicies: ResolvedFeePolicy[];
  hasTaxAssignmentState: boolean;
  hasFeeAssignmentState: boolean;
}

export interface ResolvedGuestAgePolicy {
  versionId: string;
  version: number;
  effectiveFrom: string;
  infantMaxAge: number | null;
  childMaxAge: number;
  infantsCountTowardsOccupancy: boolean;
  infantsCountTowardsChildLimit: boolean;
  infantsChargeAsChildren: boolean;
}

export interface ResolvedCancellationTier {
  triggerType: "CANCELLATION" | "NO_SHOW";
  minimumMinutesBeforeArrival: number | null;
  penaltyType: "PERCENTAGE_OF_STAY" | "FIXED_AMOUNT" | "NIGHTS";
  penaltyValue: number;
}

export interface ResolvedCancellationPolicy {
  policyId: string;
  policyCode: string;
  policyName: string;
  versionId: string;
  version: number;
  effectiveFrom: string;
  arrivalLocalTime: string;
  currencyCode: string;
  policyText: string | null;
  tiers: ResolvedCancellationTier[];
}

export interface ResolvedCommercialQuoteContext {
  days: ResolvedCommercialDay[];
  guestAgePolicy: ResolvedGuestAgePolicy;
  cancellationPolicy: ResolvedCancellationPolicy;
}

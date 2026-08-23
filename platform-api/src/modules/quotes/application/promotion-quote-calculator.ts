import { ConflictError } from "../../../shared/errors/app-error.js";
import type { ResolvedCommercialQuoteContext } from "../../commercial/domain/commercial-quote-resolution.js";
import type {
  ResolvedPromotionCampaign,
  ResolvedPromotionQuoteContext
} from "../../commercial/domain/promotion-quote-resolution.js";
import type {
  QuoteCalculation,
  QuotePromotionCalculation,
  QuotePromotionLineCalculation
} from "../domain/quote.js";
import { calculateCommercialQuote } from "./commercial-quote-calculator.js";

function safeNumber(value: bigint, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new ConflictError(`${label} exceeds safe integer money limits`);
  }
  return result;
}

function roundRatio(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  return (numerator * 2n + denominator) / (denominator * 2n);
}

function percentageAmount(baseMinor: number, rateBasisPoints: number): number {
  return safeNumber(
    roundRatio(BigInt(baseMinor) * BigInt(rateBasisPoints), 10_000n),
    "Promotion percentage amount"
  );
}

function allocateTotal(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  if (total === 0) return weights.map(() => 0);
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  if (weightSum <= 0) {
    const result = weights.map(() => 0);
    result[0] = total;
    return result;
  }

  const denominator = BigInt(weightSum);
  const floors: bigint[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let floorTotal = 0n;

  weights.forEach((weight, index) => {
    const numerator = BigInt(total) * BigInt(weight);
    const floor = numerator / denominator;
    floors.push(floor);
    floorTotal += floor;
    remainders.push({ index, remainder: numerator % denominator });
  });

  let remaining = BigInt(total) - floorTotal;
  remainders.sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });

  let cursor = 0;
  while (remaining > 0n) {
    const target = remainders[cursor % remainders.length]!;
    floors[target.index] = floors[target.index]! + 1n;
    remaining -= 1n;
    cursor += 1;
  }

  return floors.map((value) => safeNumber(value, "Allocated promotion amount"));
}

function campaignOrder(a: ResolvedPromotionCampaign, b: ResolvedPromotionCampaign): number {
  return b.priority - a.priority || a.campaignCode.localeCompare(b.campaignCode);
}

function stackableSelection(
  candidates: ResolvedPromotionCampaign[],
  requested: ResolvedPromotionCampaign | null
): ResolvedPromotionCampaign[] {
  const ordered = [...candidates]
    .filter((row) => row.stackingMode === "STACKABLE")
    .sort(campaignOrder);
  const selected: ResolvedPromotionCampaign[] = [];
  const usedGroups = new Set<string>();

  if (requested && requested.stackingMode === "STACKABLE") {
    selected.push(requested);
    if (requested.stackGroup) usedGroups.add(requested.stackGroup);
  }

  for (const campaign of ordered) {
    if (requested && campaign.campaignId === requested.campaignId) continue;
    if (campaign.stackGroup && usedGroups.has(campaign.stackGroup)) continue;
    selected.push(campaign);
    if (campaign.stackGroup) usedGroups.add(campaign.stackGroup);
  }

  return selected.sort(campaignOrder);
}

function selectCampaigns(context: ResolvedPromotionQuoteContext): ResolvedPromotionCampaign[] {
  const ordered = [...context.campaigns].sort(campaignOrder);
  const requested =
    context.requestedPromotionCode === null
      ? null
      : (ordered.find(
          (campaign) =>
            campaign.promotionKind === "PROMO_CODE" &&
            campaign.publicCode === context.requestedPromotionCode
        ) ?? null);

  if (requested) {
    if (requested.stackingMode === "EXCLUSIVE") return [requested];
    return stackableSelection(ordered, requested);
  }

  const top = ordered[0];
  if (!top) return [];
  if (top.stackingMode === "EXCLUSIVE") return [top];
  return stackableSelection(ordered, null);
}

function discountAmount(campaign: ResolvedPromotionCampaign, basisMinor: number): number {
  if (basisMinor <= 0) return 0;
  if (campaign.discountType === "FIXED_AMOUNT") {
    return Math.min(basisMinor, campaign.discountValue);
  }

  let amount = percentageAmount(basisMinor, campaign.discountValue);
  if (campaign.maximumDiscountMinor !== null) {
    amount = Math.min(amount, campaign.maximumDiscountMinor);
  }
  return Math.min(amount, basisMinor);
}

function discountedBase(
  base: QuoteCalculation,
  accommodationDiscountMinor: number,
  extraGuestDiscountMinor: number
): QuoteCalculation {
  const accommodationDiscounts = allocateTotal(
    accommodationDiscountMinor,
    base.nights.map((night) => night.accommodationMinor)
  );
  const extraDiscounts = allocateTotal(
    extraGuestDiscountMinor,
    base.nights.map((night) => night.extraGuestMinor)
  );

  const nights = base.nights.map((night, index) => {
    const accommodationMinor = night.accommodationMinor - (accommodationDiscounts[index] ?? 0);
    const extraGuestMinor = night.extraGuestMinor - (extraDiscounts[index] ?? 0);
    const [extraAdultMinor = 0, extraChildMinor = 0] = allocateTotal(extraGuestMinor, [
      night.extraAdultMinor,
      night.extraChildMinor
    ]);

    return {
      ...night,
      accommodationMinor,
      extraAdultMinor,
      extraChildMinor,
      extraGuestMinor,
      nightTotalMinor: accommodationMinor + extraGuestMinor
    };
  });

  const accommodationMinor = base.accommodationMinor - accommodationDiscountMinor;
  const extraGuestMinor = base.extraGuestMinor - extraGuestDiscountMinor;

  return {
    ...base,
    accommodationMinor,
    extraGuestMinor,
    taxMinor: 0,
    feeMinor: 0,
    totalMinor: accommodationMinor + extraGuestMinor,
    commercialStatus: "PRE_TAX_ONLY",
    holdEligible: false,
    nights,
    commercial: null,
    promotion: null
  };
}

export function calculatePromotionQuote(
  base: QuoteCalculation,
  commercialContext: ResolvedCommercialQuoteContext,
  promotionContext: ResolvedPromotionQuoteContext
): QuotePromotionCalculation {
  const selected = selectCampaigns(promotionContext);
  const lines: QuotePromotionLineCalculation[] = [];

  let remainingAccommodation = base.accommodationMinor;
  let remainingExtra = base.extraGuestMinor;
  let accommodationDiscountMinor = 0;
  let extraGuestDiscountMinor = 0;

  for (const campaign of selected) {
    const basisMinor =
      campaign.appliesTo === "ACCOMMODATION"
        ? remainingAccommodation
        : remainingAccommodation + remainingExtra;
    const discountMinor = discountAmount(campaign, basisMinor);
    if (discountMinor <= 0) continue;

    const [accommodationDiscount = 0, extraGuestDiscount = 0] =
      campaign.appliesTo === "ACCOMMODATION"
        ? [discountMinor, 0]
        : allocateTotal(discountMinor, [remainingAccommodation, remainingExtra]);

    remainingAccommodation -= accommodationDiscount;
    remainingExtra -= extraGuestDiscount;
    accommodationDiscountMinor += accommodationDiscount;
    extraGuestDiscountMinor += extraGuestDiscount;

    lines.push({
      campaignId: campaign.campaignId,
      campaignCode: campaign.campaignCode,
      campaignName: campaign.campaignName,
      promotionKind: campaign.promotionKind,
      publicCode: campaign.publicCode,
      campaignVersionId: campaign.versionId,
      version: campaign.version,
      effectiveFrom: campaign.effectiveFrom,
      currencyCode: campaign.currencyCode,
      bookingWindowStart: campaign.bookingWindowStart,
      bookingWindowEnd: campaign.bookingWindowEnd,
      arrivalWindowStart: campaign.arrivalWindowStart,
      arrivalWindowEnd: campaign.arrivalWindowEnd,
      minimumStayNights: campaign.minimumStayNights,
      minimumSpendMinor: campaign.minimumSpendMinor,
      discountType: campaign.discountType,
      discountValue: campaign.discountValue,
      maximumDiscountMinor: campaign.maximumDiscountMinor,
      appliesTo: campaign.appliesTo,
      priority: campaign.priority,
      stackingMode: campaign.stackingMode,
      stackGroup: campaign.stackGroup,
      assignmentId: campaign.assignmentId,
      assignmentScopeType: campaign.assignmentScopeType,
      assignmentRatePlanId: campaign.assignmentRatePlanId,
      assignmentRateProductId: campaign.assignmentRateProductId,
      assignmentEffectiveFrom: campaign.assignmentEffectiveFrom,
      discountBasisMinor: basisMinor,
      accommodationDiscountMinor: accommodationDiscount,
      extraGuestDiscountMinor: extraGuestDiscount,
      discountMinor
    });
  }

  const discountMinor = accommodationDiscountMinor + extraGuestDiscountMinor;
  const adjustedBase = discountedBase(base, accommodationDiscountMinor, extraGuestDiscountMinor);
  const finalCommercial = calculateCommercialQuote(adjustedBase, commercialContext);

  return {
    promotionStatus: "EVALUATED",
    holdEligible: true,
    bookingDate: promotionContext.bookingDate,
    requestedPromotionCode: promotionContext.requestedPromotionCode,
    settingsVersionId: promotionContext.settings.versionId,
    settingsVersion: promotionContext.settings.version,
    settingsEffectiveFrom: promotionContext.settings.effectiveFrom,
    promotionMode: promotionContext.settings.promotionMode,
    currencyCode: base.currencyCode,
    grossAccommodationMinor: base.accommodationMinor,
    grossExtraGuestMinor: base.extraGuestMinor,
    accommodationDiscountMinor,
    extraGuestDiscountMinor,
    discountMinor,
    discountedAccommodationMinor: remainingAccommodation,
    discountedExtraGuestMinor: remainingExtra,
    inclusiveFeeMinor: finalCommercial.inclusiveFeeMinor,
    exclusiveFeeMinor: finalCommercial.exclusiveFeeMinor,
    feeMinor: finalCommercial.feeMinor,
    inclusiveTaxMinor: finalCommercial.inclusiveTaxMinor,
    exclusiveTaxMinor: finalCommercial.exclusiveTaxMinor,
    taxMinor: finalCommercial.taxMinor,
    totalMinor: finalCommercial.totalMinor,
    lines,
    finalFeeLines: finalCommercial.feeLines,
    finalTaxLines: finalCommercial.taxLines
  };
}

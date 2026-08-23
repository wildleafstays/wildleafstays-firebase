import type { JsonObject } from "../../../infrastructure/database/types.js";
import { ConflictError } from "../../../shared/errors/app-error.js";

export const RevenueRecognitionAllocationVersion = "REVENUE_BASIS_V1" as const;

export type RevenueRecognitionLineType = "ACCOMMODATION" | "EXTRA_GUEST" | "FEE";
export type RevenueRecognitionServiceScope = "NIGHT" | "STAY";

export interface RevenueRecognitionQuoteNightSource {
  id: string;
  stayDate: string;
  accommodationMinor: number;
  extraGuestMinor: number;
}

export interface RevenueRecognitionFeeSource {
  id: string;
  lineKey: string;
  stayDate: string | null;
  priceMode: "INCLUSIVE" | "EXCLUSIVE";
  feeMinor: number;
}

export interface RevenueRecognitionTaxSource {
  id: string;
  priceMode: "INCLUSIVE" | "EXCLUSIVE";
  chargeType: RevenueRecognitionLineType;
  stayDate: string | null;
  finalFeeLineId: string | null;
  taxMinor: number;
}

export interface RevenueRecognitionBuildInput {
  currencyCode: string;
  acceptedTotalMinor: number;
  grossAccommodationMinor: number;
  grossExtraGuestMinor: number;
  accommodationDiscountMinor: number;
  extraGuestDiscountMinor: number;
  inclusiveFeeMinor: number;
  exclusiveFeeMinor: number;
  inclusiveTaxMinor: number;
  exclusiveTaxMinor: number;
  taxMinor: number;
  quoteNights: RevenueRecognitionQuoteNightSource[];
  feeLines: RevenueRecognitionFeeSource[];
  taxLines: RevenueRecognitionTaxSource[];
}

export interface RevenueRecognitionLineDraft {
  lineType: RevenueRecognitionLineType;
  serviceScope: RevenueRecognitionServiceScope;
  stayDate: string | null;
  sourceQuoteNightId: string | null;
  sourceFinalFeeLineId: string | null;
  sourceLineKey: string | null;
  considerationMinor: number;
  inclusiveTaxMinor: number;
  revenueMinor: number;
  currencyCode: string;
}

export interface RevenueRecognitionBuildResult {
  allocationVersion: typeof RevenueRecognitionAllocationVersion;
  currencyCode: string;
  acceptedTotalMinor: number;
  considerationMinor: number;
  inclusiveTaxMinor: number;
  exclusiveTaxMinor: number;
  taxMinor: number;
  revenueBasisMinor: number;
  lines: RevenueRecognitionLineDraft[];
}

export interface RevenueRecognitionScheduleLineView extends JsonObject {
  id: string;
  lineNumber: number;
  lineType: RevenueRecognitionLineType;
  serviceScope: RevenueRecognitionServiceScope;
  stayDate: string | null;
  sourceQuoteNightId: string | null;
  sourceFinalFeeLineId: string | null;
  sourceLineKey: string | null;
  considerationMinor: number;
  inclusiveTaxMinor: number;
  revenueMinor: number;
  currencyCode: string;
  createdAt: string;
}

export interface RevenueRecognitionScheduleView extends JsonObject {
  id: string;
  organizationId: string;
  propertyId: string;
  reservationId: string;
  reservationFinancialSnapshotId: string;
  quoteId: string;
  allocationVersion: typeof RevenueRecognitionAllocationVersion;
  currencyCode: string;
  acceptedTotalMinor: number;
  considerationMinor: number;
  inclusiveTaxMinor: number;
  exclusiveTaxMinor: number;
  taxMinor: number;
  revenueBasisMinor: number;
  lineCount: number;
  createdAt: string;
  lines: RevenueRecognitionScheduleLineView[];
}

export interface RevenueRecognitionScheduleResult extends JsonObject {
  created: boolean;
  schedule: RevenueRecognitionScheduleView;
}

function safeNumber(value: bigint, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new ConflictError(`${label} exceeds safe integer money limits`);
  }
  return result;
}

function requireMoney(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ConflictError(`${label} must be a non-negative safe integer`);
  }
}

function sumMoney(values: number[], label: string): number {
  let total = 0n;
  for (const value of values) {
    requireMoney(value, label);
    total += BigInt(value);
  }
  return safeNumber(total, label);
}

function allocateTotal(total: number, weights: number[]): number[] {
  requireMoney(total, "Allocated total");
  for (const weight of weights) requireMoney(weight, "Allocation weight");
  if (weights.length === 0) return [];
  if (total === 0) return weights.map(() => 0);

  const weightSum = sumMoney(weights, "Allocation weight total");
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

  return floors.map((value) => safeNumber(value, "Allocated amount"));
}

function inclusiveTaxFor(
  taxLines: RevenueRecognitionTaxSource[],
  predicate: (line: RevenueRecognitionTaxSource) => boolean
): number {
  return sumMoney(
    taxLines
      .filter((line) => line.priceMode === "INCLUSIVE" && predicate(line))
      .map((line) => line.taxMinor),
    "Inclusive tax"
  );
}

export function buildRevenueRecognitionBasis(
  input: RevenueRecognitionBuildInput
): RevenueRecognitionBuildResult {
  if (input.currencyCode.length !== 3) {
    throw new ConflictError("Revenue recognition currency must contain exactly three characters");
  }

  for (const [label, value] of Object.entries({
    acceptedTotalMinor: input.acceptedTotalMinor,
    grossAccommodationMinor: input.grossAccommodationMinor,
    grossExtraGuestMinor: input.grossExtraGuestMinor,
    accommodationDiscountMinor: input.accommodationDiscountMinor,
    extraGuestDiscountMinor: input.extraGuestDiscountMinor,
    inclusiveFeeMinor: input.inclusiveFeeMinor,
    exclusiveFeeMinor: input.exclusiveFeeMinor,
    inclusiveTaxMinor: input.inclusiveTaxMinor,
    exclusiveTaxMinor: input.exclusiveTaxMinor,
    taxMinor: input.taxMinor
  })) {
    requireMoney(value, label);
  }

  if (input.accommodationDiscountMinor > input.grossAccommodationMinor) {
    throw new ConflictError("Accommodation discount exceeds accepted accommodation");
  }
  if (input.extraGuestDiscountMinor > input.grossExtraGuestMinor) {
    throw new ConflictError("Extra guest discount exceeds accepted extra guest charges");
  }

  const orderedNights = [...input.quoteNights].sort((a, b) => a.stayDate.localeCompare(b.stayDate));
  if (orderedNights.length === 0) {
    throw new ConflictError("Revenue recognition requires at least one immutable quote night");
  }

  const uniqueNightIds = new Set(orderedNights.map((night) => night.id));
  const uniqueStayDates = new Set(orderedNights.map((night) => night.stayDate));
  if (
    uniqueNightIds.size !== orderedNights.length ||
    uniqueStayDates.size !== orderedNights.length
  ) {
    throw new ConflictError("Revenue recognition quote nights must be unique");
  }

  const observedGrossAccommodation = sumMoney(
    orderedNights.map((night) => night.accommodationMinor),
    "Quote accommodation"
  );
  const observedGrossExtra = sumMoney(
    orderedNights.map((night) => night.extraGuestMinor),
    "Quote extra guest"
  );

  if (
    observedGrossAccommodation !== input.grossAccommodationMinor ||
    observedGrossExtra !== input.grossExtraGuestMinor
  ) {
    throw new ConflictError("Immutable quote nights do not match accepted gross stay economics");
  }

  const feeIds = new Set<string>();
  const feeKeys = new Set<string>();
  for (const fee of input.feeLines) {
    requireMoney(fee.feeMinor, "Final fee");
    if (feeIds.has(fee.id) || feeKeys.has(fee.lineKey)) {
      throw new ConflictError("Final fee source contains duplicate immutable fee lines");
    }
    if (fee.stayDate !== null && !uniqueStayDates.has(fee.stayDate)) {
      throw new ConflictError("Final fee line references a stay date outside the accepted quote");
    }
    feeIds.add(fee.id);
    feeKeys.add(fee.lineKey);
  }

  const observedInclusiveFee = sumMoney(
    input.feeLines.filter((line) => line.priceMode === "INCLUSIVE").map((line) => line.feeMinor),
    "Inclusive fee"
  );
  const observedExclusiveFee = sumMoney(
    input.feeLines.filter((line) => line.priceMode === "EXCLUSIVE").map((line) => line.feeMinor),
    "Exclusive fee"
  );

  if (
    observedInclusiveFee !== input.inclusiveFeeMinor ||
    observedExclusiveFee !== input.exclusiveFeeMinor
  ) {
    throw new ConflictError("Immutable final fee lines do not match accepted fee economics");
  }

  for (const tax of input.taxLines) {
    requireMoney(tax.taxMinor, "Final tax");
    if (tax.chargeType === "FEE") {
      if (tax.finalFeeLineId === null || !feeIds.has(tax.finalFeeLineId)) {
        throw new ConflictError("Fee tax line does not reference an accepted final fee line");
      }
    } else {
      if (
        tax.finalFeeLineId !== null ||
        tax.stayDate === null ||
        !uniqueStayDates.has(tax.stayDate)
      ) {
        throw new ConflictError("Stay tax line does not reference an accepted quote night");
      }
    }
  }

  const observedInclusiveTax = sumMoney(
    input.taxLines.filter((line) => line.priceMode === "INCLUSIVE").map((line) => line.taxMinor),
    "Inclusive tax"
  );
  const observedExclusiveTax = sumMoney(
    input.taxLines.filter((line) => line.priceMode === "EXCLUSIVE").map((line) => line.taxMinor),
    "Exclusive tax"
  );

  if (
    observedInclusiveTax !== input.inclusiveTaxMinor ||
    observedExclusiveTax !== input.exclusiveTaxMinor ||
    input.taxMinor !==
      sumMoney([input.inclusiveTaxMinor, input.exclusiveTaxMinor], "Accepted tax total")
  ) {
    throw new ConflictError("Immutable final tax lines do not match accepted tax economics");
  }

  const discountedAccommodationMinor =
    input.grossAccommodationMinor - input.accommodationDiscountMinor;
  const discountedExtraGuestMinor = input.grossExtraGuestMinor - input.extraGuestDiscountMinor;

  const expectedAcceptedTotal = sumMoney(
    [
      discountedAccommodationMinor,
      discountedExtraGuestMinor,
      input.exclusiveFeeMinor,
      input.exclusiveTaxMinor
    ],
    "Accepted reservation total"
  );

  if (expectedAcceptedTotal !== input.acceptedTotalMinor) {
    throw new ConflictError(
      "Accepted reservation total does not match immutable commercial source"
    );
  }

  const accommodationDiscounts = allocateTotal(
    input.accommodationDiscountMinor,
    orderedNights.map((night) => night.accommodationMinor)
  );
  const extraDiscounts = allocateTotal(
    input.extraGuestDiscountMinor,
    orderedNights.map((night) => night.extraGuestMinor)
  );

  const adjustedNights = orderedNights.map((night, index) => {
    const accommodationMinor = night.accommodationMinor - (accommodationDiscounts[index] ?? 0);
    const extraGuestMinor = night.extraGuestMinor - (extraDiscounts[index] ?? 0);
    return {
      ...night,
      accommodationMinor,
      extraGuestMinor,
      nightTotalMinor: accommodationMinor + extraGuestMinor
    };
  });

  const stayLevelInclusiveFee = sumMoney(
    input.feeLines
      .filter((line) => line.priceMode === "INCLUSIVE" && line.stayDate === null)
      .map((line) => line.feeMinor),
    "Stay-level inclusive fee"
  );
  const allocatedStayInclusiveFee = allocateTotal(
    stayLevelInclusiveFee,
    adjustedNights.map((night) => night.nightTotalMinor)
  );

  const lines: RevenueRecognitionLineDraft[] = [];

  adjustedNights.forEach((night, index) => {
    const nightlyInclusiveFee = sumMoney(
      input.feeLines
        .filter((line) => line.priceMode === "INCLUSIVE" && line.stayDate === night.stayDate)
        .map((line) => line.feeMinor),
      "Nightly inclusive fee"
    );
    const includedFee = nightlyInclusiveFee + (allocatedStayInclusiveFee[index] ?? 0);

    if (includedFee > night.nightTotalMinor) {
      throw new ConflictError("Inclusive fees exceed accepted consideration on a stay night", {
        stayDate: night.stayDate,
        includedFeeMinor: includedFee,
        nightTotalMinor: night.nightTotalMinor
      });
    }

    const netNightTotal = night.nightTotalMinor - includedFee;
    const [accommodationConsideration = 0, extraGuestConsideration = 0] = allocateTotal(
      netNightTotal,
      [night.accommodationMinor, night.extraGuestMinor]
    );

    const accommodationInclusiveTax = inclusiveTaxFor(
      input.taxLines,
      (tax) =>
        tax.chargeType === "ACCOMMODATION" &&
        tax.stayDate === night.stayDate &&
        tax.finalFeeLineId === null
    );
    const extraGuestInclusiveTax = inclusiveTaxFor(
      input.taxLines,
      (tax) =>
        tax.chargeType === "EXTRA_GUEST" &&
        tax.stayDate === night.stayDate &&
        tax.finalFeeLineId === null
    );

    if (
      accommodationInclusiveTax > accommodationConsideration ||
      extraGuestInclusiveTax > extraGuestConsideration
    ) {
      throw new ConflictError("Embedded stay tax exceeds its accepted revenue consideration");
    }

    lines.push({
      lineType: "ACCOMMODATION",
      serviceScope: "NIGHT",
      stayDate: night.stayDate,
      sourceQuoteNightId: night.id,
      sourceFinalFeeLineId: null,
      sourceLineKey: null,
      considerationMinor: accommodationConsideration,
      inclusiveTaxMinor: accommodationInclusiveTax,
      revenueMinor: accommodationConsideration - accommodationInclusiveTax,
      currencyCode: input.currencyCode
    });

    lines.push({
      lineType: "EXTRA_GUEST",
      serviceScope: "NIGHT",
      stayDate: night.stayDate,
      sourceQuoteNightId: night.id,
      sourceFinalFeeLineId: null,
      sourceLineKey: null,
      considerationMinor: extraGuestConsideration,
      inclusiveTaxMinor: extraGuestInclusiveTax,
      revenueMinor: extraGuestConsideration - extraGuestInclusiveTax,
      currencyCode: input.currencyCode
    });
  });

  const orderedFees = [...input.feeLines].sort((a, b) => {
    const dateCompare = (a.stayDate ?? "9999-12-31").localeCompare(b.stayDate ?? "9999-12-31");
    return dateCompare || a.lineKey.localeCompare(b.lineKey);
  });

  for (const fee of orderedFees) {
    const inclusiveTaxMinor = inclusiveTaxFor(
      input.taxLines,
      (tax) => tax.chargeType === "FEE" && tax.finalFeeLineId === fee.id
    );
    if (inclusiveTaxMinor > fee.feeMinor) {
      throw new ConflictError("Embedded fee tax exceeds accepted fee consideration");
    }

    lines.push({
      lineType: "FEE",
      serviceScope: fee.stayDate === null ? "STAY" : "NIGHT",
      stayDate: fee.stayDate,
      sourceQuoteNightId: null,
      sourceFinalFeeLineId: fee.id,
      sourceLineKey: fee.lineKey,
      considerationMinor: fee.feeMinor,
      inclusiveTaxMinor,
      revenueMinor: fee.feeMinor - inclusiveTaxMinor,
      currencyCode: input.currencyCode
    });
  }

  const considerationMinor = sumMoney(
    lines.map((line) => line.considerationMinor),
    "Revenue consideration"
  );
  const lineInclusiveTax = sumMoney(
    lines.map((line) => line.inclusiveTaxMinor),
    "Revenue embedded tax"
  );
  const revenueBasisMinor = sumMoney(
    lines.map((line) => line.revenueMinor),
    "Revenue basis"
  );

  if (considerationMinor !== input.acceptedTotalMinor - input.exclusiveTaxMinor) {
    throw new ConflictError(
      "Revenue consideration does not reconcile to accepted reservation total"
    );
  }
  if (lineInclusiveTax !== input.inclusiveTaxMinor) {
    throw new ConflictError("Revenue lines do not reconcile all embedded inclusive tax");
  }
  if (revenueBasisMinor !== input.acceptedTotalMinor - input.taxMinor) {
    throw new ConflictError("Revenue basis does not reconcile to accepted total less tax");
  }

  return {
    allocationVersion: RevenueRecognitionAllocationVersion,
    currencyCode: input.currencyCode,
    acceptedTotalMinor: input.acceptedTotalMinor,
    considerationMinor,
    inclusiveTaxMinor: input.inclusiveTaxMinor,
    exclusiveTaxMinor: input.exclusiveTaxMinor,
    taxMinor: input.taxMinor,
    revenueBasisMinor,
    lines
  };
}

import { ConflictError } from "../../../shared/errors/app-error.js";
import type {
  ResolvedCommercialDay,
  ResolvedCommercialQuoteContext,
  ResolvedFeePolicy,
  ResolvedTaxPolicy
} from "../../commercial/domain/commercial-quote-resolution.js";
import type {
  QuoteCalculation,
  QuoteCommercialCalculation,
  QuoteFeeLineCalculation,
  QuoteTaxLineCalculation
} from "../domain/quote.js";

interface InternalFeeLine {
  line: QuoteFeeLineCalculation;
  policy: ResolvedFeePolicy;
  day: ResolvedCommercialDay;
}

interface TaxComponentEntry {
  policy: ResolvedTaxPolicy;
  component: ResolvedTaxPolicy["components"][number];
  order: number;
}

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
    "Percentage amount"
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

  return floors.map((value) => safeNumber(value, "Allocated amount"));
}

function policyBasisMatches(
  policy: ResolvedTaxPolicy,
  input: {
    nightlyUnitRateMinor: number;
    nightlyTaxableAmountMinor: number;
    stayTaxableAmountMinor: number;
  }
): boolean {
  if (policy.selectionBasis === "ALWAYS") return true;

  const basis =
    policy.selectionBasis === "NIGHTLY_UNIT_RATE"
      ? input.nightlyUnitRateMinor
      : policy.selectionBasis === "NIGHTLY_TAXABLE_AMOUNT"
        ? input.nightlyTaxableAmountMinor
        : input.stayTaxableAmountMinor;

  if (policy.minimumBasisMinor !== null && basis < policy.minimumBasisMinor) return false;
  if (policy.maximumBasisMinor !== null && basis >= policy.maximumBasisMinor) return false;
  return true;
}

function allocateTaxGroup(
  baseMinor: number,
  policies: ResolvedTaxPolicy[],
  priceMode: "EXCLUSIVE" | "INCLUSIVE",
  metadata: {
    chargeType: "ACCOMMODATION" | "EXTRA_GUEST" | "FEE";
    stayDate: string | null;
    feeLineKey: string | null;
  }
): { lines: QuoteTaxLineCalculation[]; total: number } {
  const entries: TaxComponentEntry[] = [];
  let order = 0;

  for (const policy of policies) {
    for (const component of policy.components) {
      entries.push({ policy, component, order });
      order += 1;
    }
  }

  if (baseMinor <= 0 || entries.length === 0) return { lines: [], total: 0 };

  const totalRate = entries.reduce((sum, entry) => sum + entry.component.rateBasisPoints, 0);
  if (totalRate <= 0) {
    return {
      lines: entries.map((entry) => ({
        taxPolicyId: entry.policy.policyId,
        taxPolicyVersionId: entry.policy.versionId,
        taxPolicyCode: entry.policy.policyCode,
        taxPolicyName: entry.policy.policyName,
        version: entry.policy.version,
        effectiveFrom: entry.policy.effectiveFrom,
        componentCode: entry.component.code,
        componentName: entry.component.name,
        rateBasisPoints: entry.component.rateBasisPoints,
        priceMode,
        chargeType: metadata.chargeType,
        stayDate: metadata.stayDate,
        feeLineKey: metadata.feeLineKey,
        taxableBasisMinor: baseMinor,
        taxMinor: 0
      })),
      total: 0
    };
  }

  const denominator = priceMode === "INCLUSIVE" ? BigInt(10_000 + totalRate) : 10_000n;
  const targetTotal = safeNumber(
    roundRatio(BigInt(baseMinor) * BigInt(totalRate), denominator),
    "Tax amount"
  );

  const floors: bigint[] = [];
  const remainders: { index: number; remainder: bigint; order: number }[] = [];
  let floorTotal = 0n;

  entries.forEach((entry, index) => {
    const numerator = BigInt(baseMinor) * BigInt(entry.component.rateBasisPoints);
    const floor = numerator / denominator;
    floors.push(floor);
    floorTotal += floor;
    remainders.push({ index, remainder: numerator % denominator, order: entry.order });
  });

  let remaining = BigInt(targetTotal) - floorTotal;
  remainders.sort((a, b) => {
    if (a.remainder === b.remainder) return a.order - b.order;
    return a.remainder > b.remainder ? -1 : 1;
  });

  let cursor = 0;
  while (remaining > 0n && remainders.length > 0) {
    const target = remainders[cursor % remainders.length]!;
    floors[target.index] = floors[target.index]! + 1n;
    remaining -= 1n;
    cursor += 1;
  }

  return {
    lines: entries.map((entry, index) => ({
      taxPolicyId: entry.policy.policyId,
      taxPolicyVersionId: entry.policy.versionId,
      taxPolicyCode: entry.policy.policyCode,
      taxPolicyName: entry.policy.policyName,
      version: entry.policy.version,
      effectiveFrom: entry.policy.effectiveFrom,
      componentCode: entry.component.code,
      componentName: entry.component.name,
      rateBasisPoints: entry.component.rateBasisPoints,
      priceMode,
      chargeType: metadata.chargeType,
      stayDate: metadata.stayDate,
      feeLineKey: metadata.feeLineKey,
      taxableBasisMinor: baseMinor,
      taxMinor: safeNumber(floors[index]!, "Tax component amount")
    })),
    total: targetTotal
  };
}

function calculateTaxForCharge(
  grossBaseMinor: number,
  selectedPolicies: ResolvedTaxPolicy[],
  metadata: {
    chargeType: "ACCOMMODATION" | "EXTRA_GUEST" | "FEE";
    stayDate: string | null;
    feeLineKey: string | null;
  }
): {
  lines: QuoteTaxLineCalculation[];
  inclusiveTaxMinor: number;
  exclusiveTaxMinor: number;
} {
  const inclusivePolicies = selectedPolicies.filter((policy) => policy.priceMode === "INCLUSIVE");
  const exclusivePolicies = selectedPolicies.filter((policy) => policy.priceMode === "EXCLUSIVE");

  const inclusive = allocateTaxGroup(grossBaseMinor, inclusivePolicies, "INCLUSIVE", metadata);
  const netTaxableMinor = Math.max(0, grossBaseMinor - inclusive.total);
  const exclusive = allocateTaxGroup(netTaxableMinor, exclusivePolicies, "EXCLUSIVE", metadata);

  return {
    lines: [...inclusive.lines, ...exclusive.lines],
    inclusiveTaxMinor: inclusive.total,
    exclusiveTaxMinor: exclusive.total
  };
}

function buildFeeLines(
  base: QuoteCalculation,
  context: ResolvedCommercialQuoteContext
): InternalFeeLine[] {
  const result: InternalFeeLine[] = [];
  const arrivalDay = context.days[0];
  if (!arrivalDay) return result;

  const stayCharges = base.accommodationMinor + base.extraGuestMinor;

  const createLine = (
    policy: ResolvedFeePolicy,
    day: ResolvedCommercialDay,
    stayDate: string | null,
    multiplier: number,
    feeMinor: number
  ): void => {
    if (policy.currencyCode !== base.currencyCode) {
      throw new ConflictError("Fee policy currency does not match quote currency", {
        feePolicyId: policy.policyId,
        feeCurrency: policy.currencyCode,
        quoteCurrency: base.currencyCode
      });
    }

    const lineKey = [
      policy.policyId,
      policy.versionId,
      stayDate ?? "STAY",
      policy.applicationBasis
    ].join(":");

    result.push({
      policy,
      day,
      line: {
        lineKey,
        feePolicyId: policy.policyId,
        feePolicyVersionId: policy.versionId,
        feePolicyCode: policy.policyCode,
        feePolicyName: policy.policyName,
        version: policy.version,
        effectiveFrom: policy.effectiveFrom,
        stayDate,
        calculationType: policy.calculationType,
        applicationBasis: policy.applicationBasis,
        amountMinorSnapshot: policy.amountMinor,
        rateBasisPointsSnapshot: policy.rateBasisPoints,
        priceMode: policy.priceMode,
        taxable: policy.taxable,
        taxPolicyId: policy.taxPolicyId,
        multiplier,
        feeMinor
      }
    });
  };

  for (const policy of arrivalDay.feePolicies) {
    if (
      policy.applicationBasis === "PER_NIGHT" ||
      policy.applicationBasis === "PER_UNIT_PER_NIGHT"
    ) {
      continue;
    }

    if (policy.calculationType === "PERCENTAGE") {
      if (policy.rateBasisPoints === null) {
        throw new ConflictError("Percentage fee is missing rateBasisPoints", {
          feePolicyId: policy.policyId
        });
      }
      createLine(
        policy,
        arrivalDay,
        null,
        1,
        percentageAmount(stayCharges, policy.rateBasisPoints)
      );
      continue;
    }

    if (policy.amountMinor === null) {
      throw new ConflictError("Fixed fee is missing amountMinor", {
        feePolicyId: policy.policyId
      });
    }

    const multiplier = policy.applicationBasis === "PER_UNIT_PER_STAY" ? base.quantity : 1;
    createLine(policy, arrivalDay, null, multiplier, policy.amountMinor * multiplier);
  }

  for (const day of context.days) {
    for (const policy of day.feePolicies) {
      if (
        policy.applicationBasis !== "PER_NIGHT" &&
        policy.applicationBasis !== "PER_UNIT_PER_NIGHT"
      ) {
        continue;
      }
      if (policy.calculationType !== "FIXED" || policy.amountMinor === null) {
        throw new ConflictError("Nightly fee policy must resolve to a fixed amount", {
          feePolicyId: policy.policyId,
          stayDate: day.stayDate
        });
      }
      const multiplier = policy.applicationBasis === "PER_UNIT_PER_NIGHT" ? base.quantity : 1;
      createLine(policy, day, day.stayDate, multiplier, policy.amountMinor * multiplier);
    }
  }

  const unique = new Set<string>();
  for (const item of result) {
    if (unique.has(item.line.lineKey)) {
      throw new ConflictError("Commercial fee resolution produced a duplicate fee line", {
        lineKey: item.line.lineKey
      });
    }
    unique.add(item.line.lineKey);
  }

  return result;
}

export function calculateCommercialQuote(
  base: QuoteCalculation,
  context: ResolvedCommercialQuoteContext
): QuoteCommercialCalculation {
  if (context.days.length !== base.nights.length) {
    throw new ConflictError("Commercial configuration does not cover every quoted night");
  }
  if (context.cancellationPolicy.currencyCode !== base.currencyCode) {
    throw new ConflictError("Cancellation policy currency does not match quote currency");
  }

  const internalFees = buildFeeLines(base, context);
  const feeLines = internalFees.map((item) => item.line);
  const inclusiveFeeMinor = feeLines
    .filter((line) => line.priceMode === "INCLUSIVE")
    .reduce((sum, line) => sum + line.feeMinor, 0);
  const exclusiveFeeMinor = feeLines
    .filter((line) => line.priceMode === "EXCLUSIVE")
    .reduce((sum, line) => sum + line.feeMinor, 0);
  const feeMinor = inclusiveFeeMinor + exclusiveFeeMinor;
  const stayCharges = base.accommodationMinor + base.extraGuestMinor;

  if (inclusiveFeeMinor > stayCharges) {
    throw new ConflictError("Inclusive fees cannot exceed the quoted stay charges", {
      inclusiveFeeMinor,
      stayCharges
    });
  }

  const stayLevelInclusive = feeLines
    .filter((line) => line.priceMode === "INCLUSIVE" && line.stayDate === null)
    .reduce((sum, line) => sum + line.feeMinor, 0);
  const nightWeights = base.nights.map((night) => night.nightTotalMinor);
  const allocatedStayInclusive = allocateTotal(stayLevelInclusive, nightWeights);

  const adjustedNightBases = base.nights.map((night, index) => {
    const nightlyInclusive = feeLines
      .filter((line) => line.priceMode === "INCLUSIVE" && line.stayDate === night.stayDate)
      .reduce((sum, line) => sum + line.feeMinor, 0);
    const includedFee = nightlyInclusive + (allocatedStayInclusive[index] ?? 0);

    if (includedFee > night.nightTotalMinor) {
      throw new ConflictError("Inclusive fees exceed quoted charges on a stay night", {
        stayDate: night.stayDate,
        includedFeeMinor: includedFee,
        nightTotalMinor: night.nightTotalMinor
      });
    }

    const netNightTotal = night.nightTotalMinor - includedFee;
    const [netAccommodation = 0, netExtra = 0] = allocateTotal(netNightTotal, [
      night.accommodationMinor,
      night.extraGuestMinor
    ]);

    return {
      stayDate: night.stayDate,
      nightlyUnitRateMinor: night.nightlyUnitRateMinor,
      netAccommodationMinor: netAccommodation,
      netExtraGuestMinor: netExtra,
      netTaxableMinor: netAccommodation + netExtra
    };
  });

  const adjustedStayTaxable = adjustedNightBases.reduce((sum, day) => sum + day.netTaxableMinor, 0);

  const taxLines: QuoteTaxLineCalculation[] = [];
  let inclusiveTaxMinor = 0;
  let exclusiveTaxMinor = 0;

  for (const adjusted of adjustedNightBases) {
    const day = context.days.find((item) => item.stayDate === adjusted.stayDate);
    if (!day) {
      throw new ConflictError("Commercial tax context is missing a stay date", {
        stayDate: adjusted.stayDate
      });
    }

    const basisInput = {
      nightlyUnitRateMinor: adjusted.nightlyUnitRateMinor,
      nightlyTaxableAmountMinor: adjusted.netTaxableMinor,
      stayTaxableAmountMinor: adjustedStayTaxable
    };

    if (adjusted.netAccommodationMinor > 0) {
      const selected = day.taxPolicies.filter(
        (policy) => policy.appliesToAccommodation && policyBasisMatches(policy, basisInput)
      );
      const calculated = calculateTaxForCharge(adjusted.netAccommodationMinor, selected, {
        chargeType: "ACCOMMODATION",
        stayDate: adjusted.stayDate,
        feeLineKey: null
      });
      taxLines.push(...calculated.lines);
      inclusiveTaxMinor += calculated.inclusiveTaxMinor;
      exclusiveTaxMinor += calculated.exclusiveTaxMinor;
    }

    if (adjusted.netExtraGuestMinor > 0) {
      const selected = day.taxPolicies.filter(
        (policy) => policy.appliesToExtraGuest && policyBasisMatches(policy, basisInput)
      );
      const calculated = calculateTaxForCharge(adjusted.netExtraGuestMinor, selected, {
        chargeType: "EXTRA_GUEST",
        stayDate: adjusted.stayDate,
        feeLineKey: null
      });
      taxLines.push(...calculated.lines);
      inclusiveTaxMinor += calculated.inclusiveTaxMinor;
      exclusiveTaxMinor += calculated.exclusiveTaxMinor;
    }
  }

  for (const item of internalFees) {
    if (!item.line.taxable || !item.policy.taxPolicy || item.line.feeMinor <= 0) continue;

    const night = base.nights.find((row) => row.stayDate === item.line.stayDate) ?? base.nights[0];
    if (!night) throw new ConflictError("Cannot tax a fee without a quoted night");

    const policy = item.policy.taxPolicy;
    const matches = policyBasisMatches(policy, {
      nightlyUnitRateMinor: night.nightlyUnitRateMinor,
      nightlyTaxableAmountMinor: item.line.feeMinor,
      stayTaxableAmountMinor: item.line.feeMinor
    });
    if (!matches) continue;

    const calculated = calculateTaxForCharge(item.line.feeMinor, [policy], {
      chargeType: "FEE",
      stayDate: item.line.stayDate,
      feeLineKey: item.line.lineKey
    });
    taxLines.push(...calculated.lines);
    inclusiveTaxMinor += calculated.inclusiveTaxMinor;
    exclusiveTaxMinor += calculated.exclusiveTaxMinor;
  }

  const taxMinor = inclusiveTaxMinor + exclusiveTaxMinor;
  const totalMinor =
    base.accommodationMinor + base.extraGuestMinor + exclusiveFeeMinor + exclusiveTaxMinor;

  return {
    commercialStatus: "COMMERCIAL_RULES_APPLIED",
    promotionStatus: "NOT_EVALUATED",
    holdEligible: false,
    currencyCode: base.currencyCode,
    accommodationMinor: base.accommodationMinor,
    extraGuestMinor: base.extraGuestMinor,
    inclusiveFeeMinor,
    exclusiveFeeMinor,
    feeMinor,
    inclusiveTaxMinor,
    exclusiveTaxMinor,
    taxMinor,
    totalMinor,
    settingsDays: context.days.map((day) => ({
      stayDate: day.stayDate,
      settingsVersionId: day.settingsVersionId,
      settingsVersion: day.settingsVersion,
      settingsEffectiveFrom: day.settingsEffectiveFrom,
      taxMode: day.taxMode,
      feeMode: day.feeMode
    })),
    guestAgePolicy: context.guestAgePolicy,
    unitAgeBreakdowns: base.units.map((unit) => ({
      unitIndex: unit.unitIndex,
      children: unit.children,
      infants: unit.infants,
      occupancyCount: unit.occupancyCount,
      childLimitCount: unit.childLimitCount,
      chargeableChildren: unit.chargeableChildren,
      extraAdults: unit.extraAdults,
      extraChildren: unit.extraChildren
    })),
    feeLines,
    taxLines,
    cancellationPolicy: context.cancellationPolicy
  };
}

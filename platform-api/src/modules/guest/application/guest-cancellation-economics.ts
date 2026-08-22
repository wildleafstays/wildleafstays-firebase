import { ValidationError } from "../../../shared/errors/app-error.js";
import {
  GuestCancellationPenaltyTypes,
  type GuestCancellationPenaltyType
} from "../domain/guest-cancellation.js";

export interface GuestCancellationTierSnapshot {
  id: string;
  triggerType: string;
  minimumMinutesBeforeArrival: number | null;
  penaltyType: string;
  penaltyValue: number;
}

export interface GuestCancellationNightSnapshot {
  stayDate: string;
  nightTotalMinor: number;
}

export interface GuestCancellationEconomicsInput {
  acceptedTotalMinor: number;
  minutesBeforeArrival: number;
  tiers: GuestCancellationTierSnapshot[];
  nights: GuestCancellationNightSnapshot[];
}

export interface GuestCancellationEconomicsDecision {
  tierSnapshotId: string;
  tierMinimumMinutesBeforeArrival: number;
  penaltyType: GuestCancellationPenaltyType;
  penaltyValue: number;
  penaltyMinor: number;
}

function requireSafeNonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError(`${field} must be a safe non-negative integer`);
  }

  return value;
}

function requirePenaltyType(value: string): GuestCancellationPenaltyType {
  if (
    value !== GuestCancellationPenaltyTypes.PERCENTAGE_OF_STAY &&
    value !== GuestCancellationPenaltyTypes.FIXED_AMOUNT &&
    value !== GuestCancellationPenaltyTypes.NIGHTS
  ) {
    throw new ValidationError("Unsupported cancellation penalty type");
  }

  return value;
}

function validatePenaltyValue(
  penaltyType: GuestCancellationPenaltyType,
  penaltyValue: number
): number {
  requireSafeNonNegativeInteger(penaltyValue, "penaltyValue");

  if (penaltyType === GuestCancellationPenaltyTypes.PERCENTAGE_OF_STAY && penaltyValue > 10_000) {
    throw new ValidationError("PERCENTAGE_OF_STAY penaltyValue cannot exceed 10000 basis points");
  }

  if (penaltyType === GuestCancellationPenaltyTypes.NIGHTS && penaltyValue > 365) {
    throw new ValidationError("NIGHTS penaltyValue cannot exceed 365");
  }

  return penaltyValue;
}

function validateCancellationTiers(
  tiers: GuestCancellationTierSnapshot[]
): GuestCancellationTierSnapshot[] {
  const cancellationTiers = tiers.filter((tier) => tier.triggerType === "CANCELLATION");

  if (cancellationTiers.length === 0) {
    throw new ValidationError("Cancellation snapshot has no CANCELLATION tiers");
  }

  const thresholds = new Set<number>();

  for (const tier of cancellationTiers) {
    if (
      tier.minimumMinutesBeforeArrival === null ||
      !Number.isSafeInteger(tier.minimumMinutesBeforeArrival) ||
      tier.minimumMinutesBeforeArrival < 0
    ) {
      throw new ValidationError("CANCELLATION tier requires a safe non-negative minute threshold");
    }

    if (thresholds.has(tier.minimumMinutesBeforeArrival)) {
      throw new ValidationError("Cancellation snapshot contains duplicate minute thresholds");
    }

    thresholds.add(tier.minimumMinutesBeforeArrival);

    const penaltyType = requirePenaltyType(tier.penaltyType);
    validatePenaltyValue(penaltyType, tier.penaltyValue);
  }

  return cancellationTiers;
}

function validateNights(
  nights: GuestCancellationNightSnapshot[]
): GuestCancellationNightSnapshot[] {
  const seenStayDates = new Set<string>();

  for (const night of nights) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(night.stayDate)) {
      throw new ValidationError("Cancellation night stayDate must use YYYY-MM-DD");
    }

    if (seenStayDates.has(night.stayDate)) {
      throw new ValidationError("Cancellation snapshot contains duplicate quote-night stay dates");
    }

    seenStayDates.add(night.stayDate);
    requireSafeNonNegativeInteger(night.nightTotalMinor, "nightTotalMinor");
  }

  return [...nights].sort((a, b) => a.stayDate.localeCompare(b.stayDate));
}

function percentagePenaltyMinor(acceptedTotalMinor: number, basisPoints: number): number {
  const result = (BigInt(acceptedTotalMinor) * BigInt(basisPoints)) / 10_000n;

  const asNumber = Number(result);

  if (!Number.isSafeInteger(asNumber)) {
    throw new ValidationError("Calculated percentage penalty is not a safe integer");
  }

  return asNumber;
}

function nightsPenaltyMinor(
  acceptedTotalMinor: number,
  requestedNights: number,
  nights: GuestCancellationNightSnapshot[]
): number {
  if (requestedNights === 0) {
    return 0;
  }

  if (nights.length === 0) {
    throw new ValidationError("NIGHTS cancellation penalty requires immutable quote-night data");
  }

  const selected = nights.slice(0, Math.min(requestedNights, nights.length));

  const total = selected.reduce((sum, night) => sum + BigInt(night.nightTotalMinor), 0n);

  const capped = total > BigInt(acceptedTotalMinor) ? BigInt(acceptedTotalMinor) : total;

  const asNumber = Number(capped);

  if (!Number.isSafeInteger(asNumber)) {
    throw new ValidationError("Calculated nights penalty is not a safe integer");
  }

  return asNumber;
}

export function selectGuestCancellationTier(
  tiers: GuestCancellationTierSnapshot[],
  minutesBeforeArrival: number
): GuestCancellationTierSnapshot {
  requireSafeNonNegativeInteger(minutesBeforeArrival, "minutesBeforeArrival");

  const cancellationTiers = validateCancellationTiers(tiers);

  const applicable = cancellationTiers
    .filter(
      (tier) =>
        tier.minimumMinutesBeforeArrival !== null &&
        tier.minimumMinutesBeforeArrival <= minutesBeforeArrival
    )
    .sort(
      (a, b) => (b.minimumMinutesBeforeArrival ?? -1) - (a.minimumMinutesBeforeArrival ?? -1)
    )[0];

  if (!applicable) {
    throw new ValidationError("Cancellation snapshot has no applicable CANCELLATION tier");
  }

  return applicable;
}

export function calculateGuestCancellationEconomics(
  input: GuestCancellationEconomicsInput
): GuestCancellationEconomicsDecision {
  const acceptedTotalMinor = requireSafeNonNegativeInteger(
    input.acceptedTotalMinor,
    "acceptedTotalMinor"
  );

  const minutesBeforeArrival = requireSafeNonNegativeInteger(
    input.minutesBeforeArrival,
    "minutesBeforeArrival"
  );

  const tier = selectGuestCancellationTier(input.tiers, minutesBeforeArrival);

  const threshold = tier.minimumMinutesBeforeArrival;

  if (threshold === null) {
    throw new ValidationError("Applicable cancellation tier unexpectedly lacks a minute threshold");
  }

  const penaltyType = requirePenaltyType(tier.penaltyType);
  const penaltyValue = validatePenaltyValue(penaltyType, tier.penaltyValue);

  let penaltyMinor: number;

  switch (penaltyType) {
    case GuestCancellationPenaltyTypes.PERCENTAGE_OF_STAY:
      penaltyMinor = percentagePenaltyMinor(acceptedTotalMinor, penaltyValue);
      break;

    case GuestCancellationPenaltyTypes.FIXED_AMOUNT:
      penaltyMinor = Math.min(penaltyValue, acceptedTotalMinor);
      break;

    case GuestCancellationPenaltyTypes.NIGHTS: {
      const nights = validateNights(input.nights);

      penaltyMinor = nightsPenaltyMinor(acceptedTotalMinor, penaltyValue, nights);
      break;
    }
  }

  if (
    !Number.isSafeInteger(penaltyMinor) ||
    penaltyMinor < 0 ||
    penaltyMinor > acceptedTotalMinor
  ) {
    throw new ValidationError(
      "Calculated cancellation penalty is outside accepted reservation economics"
    );
  }

  return {
    tierSnapshotId: tier.id,
    tierMinimumMinutesBeforeArrival: threshold,
    penaltyType,
    penaltyValue,
    penaltyMinor
  };
}

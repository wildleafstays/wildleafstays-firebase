import { describe, expect, it } from "vitest";
import {
  calculateGuestCancellationEconomics,
  selectGuestCancellationTier,
  type GuestCancellationTierSnapshot
} from "../src/modules/guest/application/guest-cancellation-economics.js";

function tier(
  id: string,
  threshold: number | null,
  penaltyType: "PERCENTAGE_OF_STAY" | "FIXED_AMOUNT" | "NIGHTS",
  penaltyValue: number,
  triggerType = "CANCELLATION"
): GuestCancellationTierSnapshot {
  return {
    id,
    triggerType,
    minimumMinutesBeforeArrival: threshold,
    penaltyType,
    penaltyValue
  };
}

describe("Phase 8B guest cancellation economics", () => {
  it("selects the greatest cancellation threshold not exceeding whole minutes remaining", () => {
    const selected = selectGuestCancellationTier(
      [
        tier("zero", 0, "PERCENTAGE_OF_STAY", 10_000),
        tier("day", 1_440, "PERCENTAGE_OF_STAY", 5_000),
        tier("week", 10_080, "PERCENTAGE_OF_STAY", 0),
        tier("no-show", null, "PERCENTAGE_OF_STAY", 10_000, "NO_SHOW")
      ],
      2_000
    );

    expect(selected.id).toBe("day");
  });

  it("uses the zero-minute tier exactly at the boundary", () => {
    const selected = selectGuestCancellationTier(
      [tier("zero", 0, "FIXED_AMOUNT", 1_000), tier("day", 1_440, "FIXED_AMOUNT", 500)],
      0
    );

    expect(selected.id).toBe("zero");
  });

  it("calculates percentage penalties using integer basis-point arithmetic", () => {
    const decision = calculateGuestCancellationEconomics({
      acceptedTotalMinor: 10_001,
      minutesBeforeArrival: 100,
      tiers: [tier("percentage", 0, "PERCENTAGE_OF_STAY", 3_333)],
      nights: []
    });

    expect(decision.penaltyMinor).toBe(3_333);
  });

  it("caps fixed penalties at the reservation accepted total", () => {
    const decision = calculateGuestCancellationEconomics({
      acceptedTotalMinor: 5_000,
      minutesBeforeArrival: 100,
      tiers: [tier("fixed", 0, "FIXED_AMOUNT", 9_000)],
      nights: []
    });

    expect(decision.penaltyMinor).toBe(5_000);
  });

  it("uses earliest immutable quote nights in stay-date order", () => {
    const decision = calculateGuestCancellationEconomics({
      acceptedTotalMinor: 20_000,
      minutesBeforeArrival: 100,
      tiers: [tier("nights", 0, "NIGHTS", 2)],
      nights: [
        {
          stayDate: "2034-02-12",
          nightTotalMinor: 4_000
        },
        {
          stayDate: "2034-02-10",
          nightTotalMinor: 6_000
        },
        {
          stayDate: "2034-02-11",
          nightTotalMinor: 7_000
        }
      ]
    });

    expect(decision.penaltyMinor).toBe(13_000);
  });

  it("caps nights penalties at the reservation accepted total", () => {
    const decision = calculateGuestCancellationEconomics({
      acceptedTotalMinor: 10_000,
      minutesBeforeArrival: 100,
      tiers: [tier("nights", 0, "NIGHTS", 3)],
      nights: [
        {
          stayDate: "2034-02-10",
          nightTotalMinor: 6_000
        },
        {
          stayDate: "2034-02-11",
          nightTotalMinor: 7_000
        }
      ]
    });

    expect(decision.penaltyMinor).toBe(10_000);
  });

  it("rejects a cancellation snapshot without an applicable tier", () => {
    expect(() =>
      calculateGuestCancellationEconomics({
        acceptedTotalMinor: 10_000,
        minutesBeforeArrival: 100,
        tiers: [tier("day", 1_440, "FIXED_AMOUNT", 1_000)],
        nights: []
      })
    ).toThrow(/applicable/i);
  });

  it("rejects duplicate cancellation thresholds", () => {
    expect(() =>
      calculateGuestCancellationEconomics({
        acceptedTotalMinor: 10_000,
        minutesBeforeArrival: 100,
        tiers: [tier("one", 0, "FIXED_AMOUNT", 1_000), tier("two", 0, "FIXED_AMOUNT", 2_000)],
        nights: []
      })
    ).toThrow(/duplicate/i);
  });

  it("rejects malformed percentage basis points", () => {
    expect(() =>
      calculateGuestCancellationEconomics({
        acceptedTotalMinor: 10_000,
        minutesBeforeArrival: 100,
        tiers: [tier("bad", 0, "PERCENTAGE_OF_STAY", 10_001)],
        nights: []
      })
    ).toThrow(/10000/i);
  });

  it("rejects unsafe reservation money", () => {
    expect(() =>
      calculateGuestCancellationEconomics({
        acceptedTotalMinor: Number.MAX_SAFE_INTEGER + 1,
        minutesBeforeArrival: 100,
        tiers: [tier("fixed", 0, "FIXED_AMOUNT", 1_000)],
        nights: []
      })
    ).toThrow(/safe/i);
  });

  it("rejects inconsistent duplicate quote-night dates", () => {
    expect(() =>
      calculateGuestCancellationEconomics({
        acceptedTotalMinor: 10_000,
        minutesBeforeArrival: 100,
        tiers: [tier("nights", 0, "NIGHTS", 2)],
        nights: [
          {
            stayDate: "2034-02-10",
            nightTotalMinor: 4_000
          },
          {
            stayDate: "2034-02-10",
            nightTotalMinor: 4_000
          }
        ]
      })
    ).toThrow(/duplicate/i);
  });

  it("ignores NO_SHOW tiers when selecting guest cancellation economics", () => {
    const decision = calculateGuestCancellationEconomics({
      acceptedTotalMinor: 10_000,
      minutesBeforeArrival: 100,
      tiers: [
        tier("cancel", 0, "FIXED_AMOUNT", 2_000),
        tier("no-show", null, "PERCENTAGE_OF_STAY", 10_000, "NO_SHOW")
      ],
      nights: []
    });

    expect(decision.tierSnapshotId).toBe("cancel");
    expect(decision.penaltyMinor).toBe(2_000);
  });
});

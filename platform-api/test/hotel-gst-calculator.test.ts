import { describe, expect, it } from "vitest";
import type { ResolvedCommercialQuoteContext } from "../src/modules/commercial/domain/commercial-quote-resolution.js";
import type { QuoteCalculation } from "../src/modules/quotes/domain/quote.js";
import { calculateCommercialQuote } from "../src/modules/quotes/application/commercial-quote-calculator.js";

function context(): ResolvedCommercialQuoteContext {
  const policy = (
    code: string,
    minimumBasisMinor: number | null,
    maximumBasisMinor: number | null,
    rateBasisPoints: number
  ) => ({
    policyId: `${code}-policy`,
    policyCode: code,
    policyName: code,
    versionId: `${code}-version`,
    version: 1,
    effectiveFrom: "2025-09-22",
    priceMode: "EXCLUSIVE" as const,
    selectionBasis: "NIGHTLY_UNIT_RATE" as const,
    minimumBasisMinor,
    maximumBasisMinor,
    appliesToAccommodation: true,
    appliesToExtraGuest: true,
    appliesToFee: false,
    components: [
      { code: "CGST", name: "Central GST", rateBasisPoints: rateBasisPoints / 2, sortOrder: 0 },
      { code: "SGST", name: "State GST", rateBasisPoints: rateBasisPoints / 2, sortOrder: 1 }
    ]
  });

  return {
    days: [
      {
        stayDate: "2030-01-01",
        settingsVersionId: "settings-version",
        settingsVersion: 1,
        settingsEffectiveFrom: "2025-09-22",
        taxMode: "POLICIES",
        feeMode: "NO_FEES",
        taxPolicies: [
          policy("INDIA_GST_UPTO_THRESHOLD", null, 750_001, 500),
          policy("INDIA_GST_ABOVE_THRESHOLD", 750_001, null, 1800)
        ],
        feePolicies: [],
        hasTaxAssignmentState: true,
        hasFeeAssignmentState: false
      }
    ],
    guestAgePolicy: {
      versionId: "guest-age-version",
      version: 1,
      effectiveFrom: "2025-09-22",
      infantMaxAge: 2,
      childMaxAge: 12,
      infantsCountTowardsOccupancy: true,
      infantsCountTowardsChildLimit: false,
      infantsChargeAsChildren: false
    },
    cancellationPolicy: {
      policyId: "cancellation-policy",
      policyCode: "STANDARD",
      policyName: "Standard",
      versionId: "cancellation-version",
      version: 1,
      effectiveFrom: "2025-09-22",
      arrivalLocalTime: "14:00",
      currencyCode: "INR",
      policyText: null,
      tiers: []
    }
  };
}

function quote(nightlyUnitRateMinor: number): QuoteCalculation {
  return {
    ratePlanId: "rate-plan",
    ratePlanCode: "EP",
    ratePlanName: "Room only",
    mealPlanCode: "EP",
    rateProductId: "rate-product",
    rateProductVersion: 1,
    productType: "ROOM_CATEGORY",
    productLabel: "Deluxe Room",
    roomCategoryId: "room-category",
    quantity: 1,
    currencyCode: "INR",
    accommodationMinor: nightlyUnitRateMinor,
    extraGuestMinor: 0,
    taxMinor: 0,
    feeMinor: 0,
    totalMinor: nightlyUnitRateMinor,
    arrivalClosedToArrival: false,
    departureClosedToDeparture: false,
    minimumStaySnapshot: 1,
    maximumStaySnapshot: null,
    commercialStatus: "PRE_TAX_ONLY",
    holdEligible: false,
    units: [
      {
        unitIndex: 0,
        adults: 2,
        childAges: [],
        children: 0,
        infants: 0,
        occupancyCount: 2,
        childLimitCount: 0,
        chargeableChildren: 0,
        includedAdults: 2,
        includedChildren: 0,
        maxAdults: 3,
        maxChildren: 1,
        maxOccupancy: 3,
        extraAdults: 0,
        extraChildren: 0
      }
    ],
    nights: [
      {
        stayDate: "2030-01-01",
        nightlyUnitRateMinor,
        accommodationMinor: nightlyUnitRateMinor,
        extraAdultMinor: 0,
        extraChildMinor: 0,
        extraGuestMinor: 0,
        nightTotalMinor: nightlyUnitRateMinor,
        sellableQuantitySnapshot: 1,
        rateSource: "BASE",
        rateOverrideVersion: null,
        minimumStay: 1,
        maximumStay: null,
        closedToArrival: false,
        closedToDeparture: false,
        stopSell: false
      }
    ],
    commercial: null,
    promotion: null
  };
}

describe("Indian hotel GST room-value boundary", () => {
  it("uses 5% at exactly INR 7,500 per room per day", () => {
    const result = calculateCommercialQuote(quote(750_000), context());
    expect(result.taxMinor).toBe(37_500);
    expect(result.taxLines.map((line) => line.rateBasisPoints)).toEqual([250, 250]);
  });

  it("uses 18% immediately above INR 7,500 per room per day", () => {
    const result = calculateCommercialQuote(quote(750_001), context());
    expect(result.taxMinor).toBe(135_000);
    expect(result.taxLines.map((line) => line.rateBasisPoints)).toEqual([900, 900]);
  });
});

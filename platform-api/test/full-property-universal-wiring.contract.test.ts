import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rateService = readFileSync(
  new URL("../src/modules/rates/application/rate-service.ts", import.meta.url),
  "utf8"
);

const quoteService = readFileSync(
  new URL("../src/modules/quotes/application/quote-service.ts", import.meta.url),
  "utf8"
);

const quoteCalculator = readFileSync(
  new URL("../src/modules/quotes/application/quote-calculator.ts", import.meta.url),
  "utf8"
);

const publicAvailability = readFileSync(
  new URL(
    "../src/modules/public-booking/application/public-availability-service.ts",
    import.meta.url
  ),
  "utf8"
);

const publicAvailabilityRepository = readFileSync(
  new URL(
    "../src/modules/public-booking/infrastructure/public-availability-repository.ts",
    import.meta.url
  ),
  "utf8"
);

describe("universal full-property booking wiring", () => {
  it("routes quote creation through the derived booking calendar", () => {
    expect(quoteService).toContain("getQuoteCalendar(");
    expect(quoteService).toContain("getQuoteCalendarSystem(");
  });

  it("derives full-property occupancy and nightly rates from active room categories", () => {
    expect(rateService).toContain("getUniversalFullPropertyCalendarCore");
    expect(rateService).toContain("deriveFullPropertySource(");
    expect(rateService).toContain("listActiveRoomCategoryPricingSources");
    expect(rateService).toContain("fullPropertyCategoryRates:");
  });

  it("automatically provisions the full-property quote identity from owner EP setup", () => {
    expect(rateService).toContain("ensureOwnerFullPropertyShell");
    expect(rateService).toContain('productType: "FULL_PROPERTY"');
    expect(rateService).toContain("derivedBaseRateMinor");
  });

  it("does not load stored full-property calendar rows for public pricing", () => {
    expect(publicAvailability).toContain('offer.product_type === "ROOM_CATEGORY"');
    expect(publicAvailability).toContain("buildPublicFullPropertySource(");
    expect(publicAvailability).toContain("calculateFullPropertyExtraGuestCharge(");
  });

  it("calculates full-property extras from category-rate snapshots rather than the shell product extra values", () => {
    expect(quoteCalculator).toContain("day.fullPropertyCategoryRates");
    expect(quoteCalculator).toContain("calculateFullPropertyExtraGuestCharge(");
  });

  it("uses room-category occupancy and extra defaults for every room meal plan", () => {
    expect(publicAvailabilityRepository).toContain(
      "coalesce(category.max_adults, product.max_adults)"
    );
    expect(publicAvailabilityRepository).toContain(
      "coalesce(category.max_occupancy, product.max_occupancy)"
    );
    expect(publicAvailabilityRepository).toContain(
      "coalesce(category.default_extra_adult_minor, product.extra_adult_minor)"
    );
    expect(rateService).toContain("const canonicalProduct: RateProductRecord = category");
    expect(rateService).toContain("rateProduct: rateProductView(canonicalProduct)");
  });
});

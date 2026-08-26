import { describe, expect, it } from "vitest";
import {
  calculateFullPropertyExtraGuestCharge,
  deriveFullPropertySource
} from "../src/modules/rates/application/derived-full-property-source.js";

describe("derived full-property universal source", () => {
  it("derives full-property rate and occupancy only from category calendars and active physical rooms", () => {
    const result = deriveFullPropertySource(
      ["2032-01-10", "2032-01-11"],
      [
        {
          roomCategoryId: "deluxe",
          physicalCapacity: 2,
          includedAdults: 2,
          includedChildren: 0,
          maxAdults: 3,
          maxChildren: 1,
          maxOccupancy: 3,
          days: [
            {
              stayDate: "2032-01-10",
              rateMinor: 500000,
              extraAdultMinor: 80000,
              extraChildMinor: 50000,
              minimumStay: 1,
              maximumStay: null,
              closedToArrival: false,
              closedToDeparture: false,
              stopSell: false
            },
            {
              stayDate: "2032-01-11",
              rateMinor: 550000,
              extraAdultMinor: 90000,
              extraChildMinor: 50000,
              minimumStay: 1,
              maximumStay: null,
              closedToArrival: false,
              closedToDeparture: false,
              stopSell: false
            }
          ]
        },
        {
          roomCategoryId: "premium",
          physicalCapacity: 1,
          includedAdults: 2,
          includedChildren: 0,
          maxAdults: 4,
          maxChildren: 2,
          maxOccupancy: 4,
          days: [
            {
              stayDate: "2032-01-10",
              rateMinor: 800000,
              extraAdultMinor: 120000,
              extraChildMinor: 70000,
              minimumStay: 1,
              maximumStay: null,
              closedToArrival: false,
              closedToDeparture: false,
              stopSell: false
            },
            {
              stayDate: "2032-01-11",
              rateMinor: 850000,
              extraAdultMinor: 120000,
              extraChildMinor: 70000,
              minimumStay: 1,
              maximumStay: null,
              closedToArrival: false,
              closedToDeparture: false,
              stopSell: false
            }
          ]
        }
      ]
    );

    expect(result).toMatchObject({
      includedAdults: 6,
      includedChildren: 0,
      maxAdults: 10,
      maxChildren: 4,
      maxOccupancy: 10
    });

    expect(result.days[0]).toMatchObject({
      stayDate: "2032-01-10",
      rateMinor: 1800000
    });

    expect(result.days[1]).toMatchObject({
      stayDate: "2032-01-11",
      rateMinor: 1950000
    });
  });

  it("keeps category extra-guest rates as category sources instead of inventing a full-property extra rate", () => {
    const result = deriveFullPropertySource(
      ["2032-02-01"],
      [
        {
          roomCategoryId: "deluxe",
          physicalCapacity: 2,
          includedAdults: 2,
          includedChildren: 0,
          maxAdults: 3,
          maxChildren: 1,
          maxOccupancy: 3,
          days: [
            {
              stayDate: "2032-02-01",
              rateMinor: 500000,
              extraAdultMinor: 80000,
              extraChildMinor: 40000,
              minimumStay: 1,
              maximumStay: null,
              closedToArrival: false,
              closedToDeparture: false,
              stopSell: false
            }
          ]
        },
        {
          roomCategoryId: "premium",
          physicalCapacity: 1,
          includedAdults: 2,
          includedChildren: 0,
          maxAdults: 3,
          maxChildren: 1,
          maxOccupancy: 3,
          days: [
            {
              stayDate: "2032-02-01",
              rateMinor: 700000,
              extraAdultMinor: 120000,
              extraChildMinor: 60000,
              minimumStay: 1,
              maximumStay: null,
              closedToArrival: false,
              closedToDeparture: false,
              stopSell: false
            }
          ]
        }
      ]
    );

    expect(result.days[0]?.categoryRates).toEqual([
      expect.objectContaining({
        roomCategoryId: "deluxe",
        physicalCapacity: 2,
        extraAdultMinor: 80000,
        extraChildMinor: 40000
      }),
      expect.objectContaining({
        roomCategoryId: "premium",
        physicalCapacity: 1,
        extraAdultMinor: 120000,
        extraChildMinor: 60000
      })
    ]);
  });

  it("inherits the strictest dated stay and sale restrictions from category calendars", () => {
    const result = deriveFullPropertySource(
      ["2032-03-01"],
      [
        {
          roomCategoryId: "a",
          physicalCapacity: 1,
          includedAdults: 2,
          includedChildren: 0,
          maxAdults: 3,
          maxChildren: 1,
          maxOccupancy: 3,
          days: [
            {
              stayDate: "2032-03-01",
              rateMinor: 400000,
              extraAdultMinor: 50000,
              extraChildMinor: 30000,
              minimumStay: 2,
              maximumStay: 5,
              closedToArrival: false,
              closedToDeparture: true,
              stopSell: false
            }
          ]
        },
        {
          roomCategoryId: "b",
          physicalCapacity: 1,
          includedAdults: 2,
          includedChildren: 0,
          maxAdults: 4,
          maxChildren: 2,
          maxOccupancy: 4,
          days: [
            {
              stayDate: "2032-03-01",
              rateMinor: 600000,
              extraAdultMinor: 80000,
              extraChildMinor: 50000,
              minimumStay: 3,
              maximumStay: 4,
              closedToArrival: true,
              closedToDeparture: false,
              stopSell: false
            }
          ]
        }
      ]
    );

    expect(result.days[0]).toMatchObject({
      minimumStay: 3,
      maximumStay: 4,
      closedToArrival: true,
      closedToDeparture: true,
      stopSell: false
    });
  });

  it("fails closed when an active physical-room category is missing a requested calendar date", () => {
    expect(() =>
      deriveFullPropertySource(
        ["2032-04-01", "2032-04-02"],
        [
          {
            roomCategoryId: "deluxe",
            physicalCapacity: 1,
            includedAdults: 2,
            includedChildren: 0,
            maxAdults: 3,
            maxChildren: 1,
            maxOccupancy: 3,
            days: [
              {
                stayDate: "2032-04-01",
                rateMinor: 500000,
                extraAdultMinor: 80000,
                extraChildMinor: 40000,
                minimumStay: 1,
                maximumStay: null,
                closedToArrival: false,
                closedToDeparture: false,
                stopSell: false
              }
            ]
          }
        ]
      )
    ).toThrow(/missing the universal rate-calendar date/i);
  });

  it("ignores categories with no active physical rooms", () => {
    const result = deriveFullPropertySource(
      ["2032-05-01"],
      [
        {
          roomCategoryId: "live",
          physicalCapacity: 1,
          includedAdults: 2,
          includedChildren: 0,
          maxAdults: 3,
          maxChildren: 1,
          maxOccupancy: 3,
          days: [
            {
              stayDate: "2032-05-01",
              rateMinor: 500000,
              extraAdultMinor: 80000,
              extraChildMinor: 40000,
              minimumStay: 1,
              maximumStay: null,
              closedToArrival: false,
              closedToDeparture: false,
              stopSell: false
            }
          ]
        },
        {
          roomCategoryId: "empty",
          physicalCapacity: 0,
          includedAdults: 2,
          includedChildren: 0,
          maxAdults: 10,
          maxChildren: 10,
          maxOccupancy: 10,
          days: []
        }
      ]
    );

    expect(result.maxOccupancy).toBe(3);
    expect(result.days[0]?.rateMinor).toBe(500000);
    expect(result.days[0]?.categoryRates).toHaveLength(1);
  });

  it("allocates full-property adult and child extras across categories at the lowest valid combined charge", () => {
    const charge = calculateFullPropertyExtraGuestCharge(
      [
        {
          roomCategoryId: "deluxe",
          physicalCapacity: 1,
          unitRateMinor: 500_000,
          extraAdultMinor: 100_000,
          extraChildMinor: 10_000,
          includedAdults: 2,
          includedChildren: 0,
          maxAdults: 3,
          maxChildren: 1,
          maxOccupancy: 3
        },
        {
          roomCategoryId: "suite",
          physicalCapacity: 1,
          unitRateMinor: 700_000,
          extraAdultMinor: 10_000,
          extraChildMinor: 100_000,
          includedAdults: 2,
          includedChildren: 0,
          maxAdults: 3,
          maxChildren: 1,
          maxOccupancy: 3
        }
      ],
      1,
      1
    );

    expect(charge).toEqual({
      extraAdultMinor: 10_000,
      extraChildMinor: 10_000,
      totalMinor: 20_000
    });
  });

  it("uses the next-lowest category when the cheapest extra capacity is exhausted", () => {
    const charge = calculateFullPropertyExtraGuestCharge(
      [
        {
          roomCategoryId: "standard",
          physicalCapacity: 1,
          unitRateMinor: 300_000,
          extraAdultMinor: 10_000,
          extraChildMinor: 10_000,
          includedAdults: 2,
          includedChildren: 0,
          maxAdults: 3,
          maxChildren: 1,
          maxOccupancy: 3
        },
        {
          roomCategoryId: "premium",
          physicalCapacity: 1,
          unitRateMinor: 600_000,
          extraAdultMinor: 30_000,
          extraChildMinor: 30_000,
          includedAdults: 2,
          includedChildren: 0,
          maxAdults: 3,
          maxChildren: 1,
          maxOccupancy: 3
        }
      ],
      2,
      0
    );

    expect(charge.extraAdultMinor).toBe(40_000);
    expect(charge.extraChildMinor).toBe(0);
    expect(charge.totalMinor).toBe(40_000);
  });

  it("fails closed when requested full-property extras cannot fit into category capacities", () => {
    expect(() =>
      calculateFullPropertyExtraGuestCharge(
        [
          {
            roomCategoryId: "only-room",
            physicalCapacity: 1,
            unitRateMinor: 300_000,
            extraAdultMinor: 20_000,
            extraChildMinor: 20_000,
            includedAdults: 2,
            includedChildren: 0,
            maxAdults: 3,
            maxChildren: 1,
            maxOccupancy: 3
          }
        ],
        2,
        0
      )
    ).toThrow("Full-property extra guests cannot be allocated");
  });
});

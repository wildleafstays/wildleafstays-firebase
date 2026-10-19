import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../src/shared/async/map-with-concurrency.js";

describe("bounded hotel matching", () => {
  it("processes 200 hotels using at most four concurrent workers in stable order", async () => {
    const hotels = Array.from({ length: 200 }, (_, index) => index);
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency(hotels, 4, async (hotel) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      return hotel * 2;
    });
    expect(peak).toBe(4);
    expect(active).toBe(0);
    expect(result).toEqual(hotels.map((hotel) => hotel * 2));
  });

  it("completes 200 uneven property checks without exceeding database-safe parallelism", async () => {
    const hotels = Array.from({ length: 200 }, (_, index) => index);
    let active = 0;
    let peak = 0;
    const visits = Array<number>(hotels.length).fill(0);
    const results = await mapWithConcurrency(hotels, 4, async (hotel, index) => {
      active += 1;
      peak = Math.max(peak, active);
      visits[index] = (visits[index] ?? 0) + 1;
      // Uneven asynchronous completion simulates differing hotel response times.
      for (let tick = 0; tick < (hotel % 5) + 1; tick += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      active -= 1;
      return hotel % 7 === 0 ? null : { propertyId: hotel, available: hotel % 3 === 0 };
    });

    expect(peak).toBe(4);
    expect(active).toBe(0);
    expect(visits.every((count) => count === 1)).toBe(true);
    expect(results).toHaveLength(200);
    expect(results[0]).toBeNull();
    expect(results[1]).toEqual({ propertyId: 1, available: false });
    expect(results[198]).toEqual({ propertyId: 198, available: true });
  });

  it("handles empty pages and rejects invalid concurrency settings", async () => {
    expect(await mapWithConcurrency([], 4, async (value) => value)).toEqual([]);
    await expect(mapWithConcurrency([1], 0, async (value) => value)).rejects.toThrow(RangeError);
  });
});

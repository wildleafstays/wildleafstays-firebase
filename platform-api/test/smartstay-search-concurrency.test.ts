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

  it("handles empty pages and rejects invalid concurrency settings", async () => {
    expect(await mapWithConcurrency([], 4, async (value) => value)).toEqual([]);
    await expect(mapWithConcurrency([1], 0, async (value) => value)).rejects.toThrow(
      RangeError
    );
  });
});

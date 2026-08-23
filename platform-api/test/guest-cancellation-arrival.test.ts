import { describe, expect, it } from "vitest";
import { resolveGuestCancellationArrivalInstant } from "../src/modules/guest/application/guest-cancellation-arrival.js";

describe("Phase 8B guest cancellation arrival instant", () => {
  it("converts immutable local arrival time through the property timezone", () => {
    const arrival = resolveGuestCancellationArrivalInstant({
      arrivalDate: "2034-02-10",
      arrivalLocalTime: "14:00",
      timeZone: "Asia/Kolkata"
    });

    expect(arrival.toISOString()).toBe("2034-02-10T08:30:00.000Z");
  });

  it("accepts PostgreSQL zero-second TIME serialization without changing the instant", () => {
    const arrival = resolveGuestCancellationArrivalInstant({
      arrivalDate: "2034-02-10",
      arrivalLocalTime: "14:00:00",
      timeZone: "Asia/Kolkata"
    });

    expect(arrival.toISOString()).toBe("2034-02-10T08:30:00.000Z");

    const fractional = resolveGuestCancellationArrivalInstant({
      arrivalDate: "2034-02-10",
      arrivalLocalTime: "14:00:00.000000",
      timeZone: "Asia/Kolkata"
    });

    expect(fractional.toISOString()).toBe("2034-02-10T08:30:00.000Z");
  });

  it("rejects non-zero seconds because cancellation arrival time is minute precision", () => {
    expect(() =>
      resolveGuestCancellationArrivalInstant({
        arrivalDate: "2034-02-10",
        arrivalLocalTime: "14:00:01",
        timeZone: "Asia/Kolkata"
      })
    ).toThrow(/arrival-local-time is invalid/i);
  });

  it("rejects an invalid IANA timezone", () => {
    expect(() =>
      resolveGuestCancellationArrivalInstant({
        arrivalDate: "2034-02-10",
        arrivalLocalTime: "14:00",
        timeZone: "Not/A_Real_Timezone"
      })
    ).toThrow(/IANA timezone/i);
  });

  it("rejects a nonexistent DST wall-clock instant", () => {
    expect(() =>
      resolveGuestCancellationArrivalInstant({
        arrivalDate: "2034-03-12",
        arrivalLocalTime: "02:30",
        timeZone: "America/New_York"
      })
    ).toThrow(/does not exist/i);
  });

  it("rejects an ambiguous DST wall-clock instant", () => {
    expect(() =>
      resolveGuestCancellationArrivalInstant({
        arrivalDate: "2034-11-05",
        arrivalLocalTime: "01:30",
        timeZone: "America/New_York"
      })
    ).toThrow(/ambiguous/i);
  });

  it("rejects malformed canonical local date or time", () => {
    expect(() =>
      resolveGuestCancellationArrivalInstant({
        arrivalDate: "2034-02-31",
        arrivalLocalTime: "14:00",
        timeZone: "Asia/Kolkata"
      })
    ).toThrow(/date is invalid/i);

    expect(() =>
      resolveGuestCancellationArrivalInstant({
        arrivalDate: "2034-02-10",
        arrivalLocalTime: "25:00",
        timeZone: "Asia/Kolkata"
      })
    ).toThrow(/arrival-local-time is invalid/i);
  });
});

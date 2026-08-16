import { describe, expect, it } from "vitest";
import { hashRequest } from "../src/shared/idempotency/idempotency-service.js";

describe("hashRequest", () => {
  it("is stable when object key order differs", () => {
    const a = hashRequest({ legalName: "Wildleaf", organizationType: "PRIVATE_LIMITED" });
    const b = hashRequest({ organizationType: "PRIVATE_LIMITED", legalName: "Wildleaf" });
    expect(a).toBe(b);
  });

  it("changes when request semantics change", () => {
    const a = hashRequest({ legalName: "Wildleaf", countryCode: "IN" });
    const b = hashRequest({ legalName: "Wildleaf", countryCode: "NP" });
    expect(a).not.toBe(b);
  });
});

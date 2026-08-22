import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import type { Database } from "../src/infrastructure/database/types.js";
import type {
  IdentityVerifier,
  VerifiedIdentity
} from "../src/infrastructure/identity/identity-verifier.js";

const identityVerifier: IdentityVerifier = {
  async verifyIdToken(): Promise<VerifiedIdentity> {
    return {
      provider: "firebase",
      subject: "owner-operations-contract",
      email: "operations@example.invalid",
      displayName: "Operations Contract",
      emailVerified: true
    };
  }
};

const config = loadConfig({
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgres://unused:unused@localhost:5432/unused",
  FIREBASE_PROJECT_ID: "wildleaf-test"
});
const app = await buildApp({ config, db: {} as Kysely<Database>, identityVerifier });

beforeAll(async () => app.ready());
afterAll(async () => app.close());

describe("owner operations route contract", () => {
  it("publishes reservation operations, reports and rate-product reads", async () => {
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(response.statusCode).toBe(200);
    const document = response.json() as { paths: Record<string, Record<string, unknown>> };
    const property = "/v1/partner/organizations/{organizationId}/properties/{propertyId}";

    expect(document.paths[`${property}/reservations`]?.["get"]).toBeDefined();
    expect(document.paths[`${property}/reservations/operations-summary`]?.["get"]).toBeDefined();
    expect(document.paths[`${property}/reports/occupancy`]?.["get"]).toBeDefined();
    expect(document.paths[`${property}/reports/recognized-revenue`]?.["get"]).toBeDefined();
    expect(
      document.paths["/v1/partner/organizations/{organizationId}/reports/portfolio-performance"]?.[
        "get"
      ]
    ).toBeDefined();
    expect(document.paths[`${property}/rates/products`]?.["get"]).toBeDefined();
    expect(document.paths["/v1/platform/reservations"]?.["get"]).toBeDefined();
    expect(document.paths["/v1/platform/reservations/operations-summary"]?.["get"]).toBeDefined();
  });

  it("requires an explicit business date for the operations summary", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/partner/organizations/607bd187-2fec-4868-8d86-adf763844d31/properties/c0fca11f-2676-40db-9cc8-badf8e880021/reservations/operations-summary",
      headers: { authorization: "Bearer token" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });
});

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
      subject: "route-contract",
      email: "contract@example.invalid",
      displayName: "Contract Test",
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

const db = {} as Kysely<Database>;
const app = await buildApp({ config, db, identityVerifier });
app.post("/_contract/multipart-size", async (request) => {
  const part = await request.file();
  let byteSize = 0;
  if (part) {
    for await (const chunk of part.file) byteSize += Buffer.byteLength(chunk);
  }
  return { byteSize, truncated: part?.file.truncated ?? false };
});

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("managed property upload route contract", () => {
  it("publishes only managed owner upload commands", async () => {
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(response.statusCode).toBe(200);
    const document = response.json() as {
      paths: Record<string, Record<string, unknown>>;
    };
    const imagePath =
      "/v1/partner/organizations/{organizationId}/properties/{propertyId}/onboarding/uploads/images";
    const documentPath =
      "/v1/partner/organizations/{organizationId}/properties/{propertyId}/onboarding/uploads/documents";
    const legacyMediaPath =
      "/v1/partner/organizations/{organizationId}/properties/{propertyId}/onboarding/media";
    const legacyDocumentPath =
      "/v1/partner/organizations/{organizationId}/properties/{propertyId}/onboarding/documents";
    const physicalRoomImagePath =
      "/v1/partner/organizations/{organizationId}/properties/{propertyId}/units/{physicalUnitId}/uploads/images";

    expect(document.paths[imagePath]?.["post"]).toBeDefined();
    expect(document.paths[documentPath]?.["post"]).toBeDefined();
    expect(document.paths[legacyMediaPath]?.["post"]).toBeUndefined();
    expect(document.paths[legacyDocumentPath]?.["post"]).toBeUndefined();
    expect(document.paths[physicalRoomImagePath]?.["post"]).toBeDefined();
  });

  it("requires the file digest and idempotency key before upload handling", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/partner/organizations/607bd187-2fec-4868-8d86-adf763844d31/properties/c0fca11f-2676-40db-9cc8-badf8e880021/onboarding/uploads/images",
      headers: { authorization: "Bearer token" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" }
    });
  });

  it("allows files above the multipart library's 1 MB default", async () => {
    const boundary = "wildleaf-phase7b-boundary";
    const bytes = Buffer.alloc(2 * 1024 * 1024, 0x61);
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const response = await app.inject({
      method: "POST",
      url: "/_contract/multipart-size",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ byteSize: bytes.length, truncated: false });
  });
});

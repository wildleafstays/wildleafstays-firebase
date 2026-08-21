import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

globalThis.crypto ||= webcrypto;
globalThis.WILDLEAF_ADMIN_CONFIG = { apiBaseUrl: "https://api.example.test/" };

const { ApiError, authorizedRequest, newIdempotencyKey } =
  await import("../api-client.js");

test("authorizedRequest sends a fresh bearer token and idempotency key", async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await authorizedRequest("/v1/partner/organizations", {
    method: "POST",
    body: { legalName: "Forest Stays" },
    idempotencyKey: "organization-create-12345678",
    getAccessToken: async () => "firebase-id-token",
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(
    request.url,
    "https://api.example.test/v1/partner/organizations",
  );
  assert.equal(
    request.options.headers.get("Authorization"),
    "Bearer firebase-id-token",
  );
  assert.equal(
    request.options.headers.get("Idempotency-Key"),
    "organization-create-12345678",
  );
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.cache, "no-store");
});

test("authorizedRequest refuses to call the API without an identity token", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
  };

  await assert.rejects(
    authorizedRequest("/v1/session", { getAccessToken: async () => null }),
    (error) =>
      error instanceof ApiError &&
      error.status === 401 &&
      error.code === "AUTHENTICATION_REQUIRED",
  );
  assert.equal(called, false);
});

test("authorizedRequest preserves the canonical API error envelope", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "ACCESS_DENIED",
          message: "Permission denied",
          details: { permission: "property.approve" },
        },
      }),
      { status: 403, headers: { "content-type": "application/json" } },
    );

  await assert.rejects(
    authorizedRequest("/v1/platform/property-reviews", {
      getAccessToken: async () => "firebase-id-token",
    }),
    (error) =>
      error instanceof ApiError &&
      error.status === 403 &&
      error.code === "ACCESS_DENIED" &&
      error.details.permission === "property.approve",
  );
});

test("newIdempotencyKey creates operation-scoped keys", () => {
  assert.match(
    newIdempotencyKey("property-submit"),
    /^property-submit-[A-Za-z0-9-]{16,}$/,
  );
});

import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

const values = new Map();
globalThis.crypto ||= webcrypto;
globalThis.window = {
  WILDLEAF_CONFIG: { apiBaseUrl: "https://api.example.test/" },
  setTimeout,
  clearTimeout,
};
globalThis.sessionStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
};

const {
  ApiError,
  apiRequest,
  clearBookingSession,
  loadBookingSession,
  newIdempotencyKey,
  operationKey,
  saveBookingSession,
} = await import("../api-client.js");

test("apiRequest sends JSON through the configured public API origin", async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await apiRequest("/v1/public/example", {
    method: "POST",
    idempotencyKey: "quote-1234567890123456",
    body: { arrivalDate: "2030-01-01" },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(request.url, "https://api.example.test/v1/public/example");
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.cache, "no-store");
  assert.equal(
    request.options.headers.get("Idempotency-Key"),
    "quote-1234567890123456",
  );
  assert.equal(
    request.options.body,
    JSON.stringify({ arrivalDate: "2030-01-01" }),
  );
});

test("apiRequest preserves the canonical error envelope", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "QUOTE_EXPIRED",
          message: "The quote expired.",
          details: { retry: true },
        },
      }),
      { status: 409, headers: { "content-type": "application/json" } },
    );

  await assert.rejects(
    apiRequest("/v1/public/example"),
    (error) =>
      error instanceof ApiError &&
      error.status === 409 &&
      error.code === "QUOTE_EXPIRED" &&
      error.details.retry === true,
  );
});

test("operation keys are stable for an exact retry and rotate when the request changes", () => {
  const session = {};
  const first = operationKey(session, "quote", "request-a");
  const retry = operationKey(session, "quote", "request-a");
  const changed = operationKey(session, "quote", "request-b");

  assert.equal(first, retry);
  assert.notEqual(first, changed);
  assert.match(newIdempotencyKey("hold"), /^hold-[A-Za-z0-9-]{16,}$/);
});

test("booking session state is property-scoped and can be cleared", () => {
  saveBookingSession("Forest-House", { quoteId: "quote-1" });
  assert.deepEqual(loadBookingSession("forest-house"), { quoteId: "quote-1" });
  assert.deepEqual(loadBookingSession("lake-house"), {});

  clearBookingSession("FOREST-HOUSE");
  assert.deepEqual(loadBookingSession("forest-house"), {});
});

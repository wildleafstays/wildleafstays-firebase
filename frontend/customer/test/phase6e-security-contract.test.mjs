import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const propertySource = await readFile(
  new URL("../property.js", import.meta.url),
  "utf8",
);
const apiSource = await readFile(
  new URL("../api-client.js", import.meta.url),
  "utf8",
);

test("the browser only uses public booking routes and never sends tenant identity", () => {
  assert.match(propertySource, /\/v1\/public\/properties\//);
  assert.doesNotMatch(propertySource, /organizationId|propertyId/);
  assert.doesNotMatch(propertySource, /\/confirm-payment|\/payments\/verify/);
});

test("Razorpay callbacks trigger status polling instead of browser confirmation", () => {
  assert.match(
    propertySource,
    /handler:\s*\(\)\s*=>[\s\S]*startStatusPolling\(\)/,
  );
  assert.doesNotMatch(propertySource, /razorpay_payment_id|razorpay_signature/);
  assert.match(propertySource, /\/checkout-status/);
});

test("the client never embeds server credentials or a Razorpay secret", () => {
  const combined = `${propertySource}\n${apiSource}`;
  assert.doesNotMatch(
    combined,
    /RAZORPAY_KEY_SECRET|DATABASE_URL|FIREBASE_PRIVATE_KEY|WEBHOOK_SECRET/,
  );
});

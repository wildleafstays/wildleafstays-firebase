import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  availableScreens,
  canReviewProperties,
  editableProperty,
  profilePayload,
  reviewQueuePath,
} from "../portal-state.js";

const source = await readFile(new URL("../admin.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("role-aware navigation separates hotel owners from Wildleaf reviewers", () => {
  const owner = { platformRoles: [], organizations: [] };
  const reviewer = { platformRoles: ["SUPER_ADMIN"], organizations: [] };

  assert.deepEqual(availableScreens(owner), ["business"]);
  assert.deepEqual(availableScreens(reviewer), ["reviews"]);
  assert.equal(canReviewProperties(owner), false);
  assert.equal(canReviewProperties(reviewer), true);
  assert.equal(editableProperty("CHANGES_REQUIRED"), true);
  assert.equal(editableProperty("UNDER_REVIEW"), false);
});

test("profilePayload omits empty optional values and keeps optimistic versioning", () => {
  assert.deepEqual(
    profilePayload(
      {
        name: "  Pine House  ",
        timezone: "Asia/Kolkata",
        propertyType: "HOTEL",
        city: "",
        latitude: "30.123",
      },
      4,
    ),
    {
      version: 4,
      name: "Pine House",
      timezone: "Asia/Kolkata",
      propertyType: "HOTEL",
      latitude: 30.123,
    },
  );
});

test("review queue filters and cursors are encoded as query parameters", () => {
  assert.equal(
    reviewQueuePath("SUBMITTED", "cursor_value"),
    "/v1/platform/property-reviews?limit=30&status=SUBMITTED&cursor=cursor_value",
  );
});

test("the portal uses canonical v1 APIs and never restores the legacy admin or storage path", () => {
  const combined = `${source}\n${html}`;
  assert.match(source, /\/v1\/partner\/organizations/);
  assert.match(source, /\/v1\/platform\/properties/);
  assert.doesNotMatch(combined, /\/api\/admin\//);
  assert.doesNotMatch(combined, /firebase\.storage|storageKey\s*:/);
  assert.doesNotMatch(
    combined,
    /DATABASE_URL|FIREBASE_PRIVATE_KEY|RAZORPAY_KEY_SECRET/,
  );
});

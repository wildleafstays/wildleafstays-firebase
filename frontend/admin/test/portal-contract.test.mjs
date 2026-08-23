import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  availableScreens,
  canManagePlatformReservations,
  canUseControlCenter,
  canReviewProperties,
  editableProperty,
  platformReservationListPath,
  profilePayload,
  reservationListPath,
  reviewQueuePath,
} from "../portal-state.js";

const source = await readFile(new URL("../admin.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("role-aware navigation separates hotel owners from Wildleaf reviewers", () => {
  const owner = { platformRoles: [], organizations: [] };
  const establishedOwner = {
    platformRoles: [],
    organizations: [{ organizationId: "org-1", role: "OWNER" }],
  };
  const reviewer = { platformRoles: ["SUPER_ADMIN"], organizations: [] };

  assert.deepEqual(availableScreens(owner), ["business"]);
  assert.deepEqual(availableScreens(establishedOwner), [
    "dashboard",
    "properties",
    "reservations",
    "calendar",
  ]);
  assert.deepEqual(availableScreens(reviewer), ["control", "reviews"]);
  assert.equal(canReviewProperties(owner), false);
  assert.equal(canReviewProperties(reviewer), true);
  assert.equal(canUseControlCenter(reviewer), true);
  assert.equal(canManagePlatformReservations(reviewer), true);
  assert.equal(
    canManagePlatformReservations({ platformRoles: ["ANALYST"] }),
    false,
  );
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

test("reservation filters and cursors use the tenant-scoped owner path", () => {
  assert.equal(
    reservationListPath("org-1", "property-1", {
      status: "CONFIRMED",
      startDate: "2026-08-22",
      endDate: "2026-09-01",
      cursor: "cursor_value",
      limit: 25,
    }),
    "/v1/partner/organizations/org-1/properties/property-1/reservations?limit=25&status=CONFIRMED&startDate=2026-08-22&endDate=2026-09-01&cursor=cursor_value",
  );
});

test("Wildleaf control-center filters use the platform reservation path", () => {
  assert.equal(
    platformReservationListPath({ status: "CHECKED_IN", limit: 20 }),
    "/v1/platform/reservations?limit=20&status=CHECKED_IN",
  );
});

test("the portal uses canonical v1 APIs and never restores the legacy admin or storage path", () => {
  const combined = `${source}\n${html}`;
  assert.match(source, /\/v1\/partner\/organizations/);
  assert.match(source, /\/v1\/platform\/properties/);
  assert.match(source, /onboarding\/uploads\/images/);
  assert.match(source, /onboarding\/uploads\/documents/);
  assert.match(source, /\/room-categories/);
  assert.match(source, /\/units/);
  assert.match(source, /reservations\/operations-summary/);
  assert.match(source, /\/v1\/platform\/reservations/);
  assert.match(source, /rates\/products/);
  assert.match(source, /inventory\/controls/);
  assert.match(html, /id="dashboardScreen"/);
  assert.match(html, /id="reservationsScreen"/);
  assert.match(html, /id="calendarScreen"/);
  assert.match(html, /id="controlScreen"/);
  assert.doesNotMatch(combined, /\/api\/admin\//);
  assert.doesNotMatch(combined, /firebase\.storage|storageKey\s*:/);
  assert.doesNotMatch(
    combined,
    /DATABASE_URL|FIREBASE_PRIVATE_KEY|RAZORPAY_KEY_SECRET/,
  );
});

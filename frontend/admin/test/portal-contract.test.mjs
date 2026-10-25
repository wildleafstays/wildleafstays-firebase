import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  availableScreens,
  canManageHomepageContent,
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
  assert.deepEqual(availableScreens(reviewer), [
    "control",
    "hotels",
    "homepage",
    "reviews",
  ]);
  assert.equal(canReviewProperties(owner), false);
  assert.equal(canReviewProperties(reviewer), true);
  assert.equal(canUseControlCenter(reviewer), true);
  assert.equal(canManagePlatformReservations(reviewer), true);
  assert.equal(canManageHomepageContent(reviewer), true);
  assert.equal(
    canManageHomepageContent({ platformRoles: ["CONTENT_MANAGER"] }),
    true,
  );
  assert.equal(canManageHomepageContent({ platformRoles: ["ANALYST"] }), false);
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
        propertyCategoryId: "category-1",
        propertyTypeId: "type-1",
        city: "",
        latitude: "30.123",
      },
      4,
    ),
    {
      version: 4,
      name: "Pine House",
      timezone: "Asia/Kolkata",
      propertyCategoryId: "category-1",
      propertyTypeId: "type-1",
      latitude: 30.123,
    },
  );
});

test("profilePayload synchronizes guest-facing tab content", () => {
  const payload = profilePayload(
    {
      name: "Pine House",
      timezone: "Asia/Kolkata",
      propertyCategoryId: "category-1",
      propertyTypeId: "type-1",
      servicesDescription: "Daily housekeeping",
      spacesDescription: "Garden and lounge",
      publicAddress: "Upper Mall, Kasauli",
      locationDescription: "A quiet hillside setting",
      mapUrl: "https://maps.example.test/pine-house",
      nearbyAttractions: "Mall Road · 4 km",
    },
    5,
  );

  assert.equal(payload.servicesDescription, "Daily housekeeping");
  assert.equal(payload.spacesDescription, "Garden and lounge");
  assert.equal(payload.publicAddress, "Upper Mall, Kasauli");
  assert.equal(payload.locationDescription, "A quiet hillside setting");
  assert.equal(payload.mapUrl, "https://maps.example.test/pine-house");
  assert.equal(payload.nearbyAttractions, "Mall Road · 4 km");
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
  assert.match(html, /id="homepageScreen"/);
  assert.match(source, /\/v1\/platform\/homepage-content/);
  assert.match(source, /homepage-hero-create/);
  assert.match(source, /homepage-destination-create/);
  assert.doesNotMatch(combined, /\/api\/admin\//);
  assert.doesNotMatch(combined, /firebase\.storage|storageKey\s*:/);
  assert.doesNotMatch(
    combined,
    /DATABASE_URL|FIREBASE_PRIVATE_KEY|RAZORPAY_KEY_SECRET/,
  );
});

test("homepage hero metadata is optional and save actions are acknowledged", () => {
  assert.match(
    html,
    /Headline\s*<span class="optional">optional<\/span>[\s\S]*?<input[\s\S]*?name="headline"[\s\S]*?maxlength="160"[\s\S]*?\/>/,
  );
  assert.match(
    html,
    /Display order\s*<span class="optional">optional<\/span>[\s\S]*?name="sortOrder"[\s\S]*?value="0"[\s\S]*?\/>/,
  );
  assert.match(source, /function homepageNumberOrDefault\(value, fallback\)/);
  assert.match(source, /function showHomepageAcknowledgement\(message\)/);
  assert.match(source, /Homepage hero slide added successfully\./);
  assert.match(source, /Homepage hero slide saved successfully\./);
});

test("Super Admin can manage Entire Property campaigns through the shared hero system", () => {
  assert.match(html, /id="entirePropertyHeroCreateForm"/);
  assert.match(html, /id="entirePropertyHeroList"/);
  assert.match(html, /Entire Property hero campaigns/);
  assert.match(
    html,
    /Offer \/ banner text <span class="optional">optional<\/span>/,
  );
  assert.match(html, /CTA button text <span class="optional">optional<\/span>/);
  assert.match(source, /bindHeroCreateForm\(/);
  assert.match(
    source,
    /"entirePropertyHeroCreateForm",[\s\S]*"ENTIRE_PROPERTY"/,
  );
  assert.match(source, /renderEntirePropertyHeroSlides\(\)/);
  assert.match(source, /slide\.placement === placement/);
  assert.match(source, /placement: slide\.placement \|\| placement/);
});

test("property categories and types come from the taxonomy APIs instead of frontend enums", () => {
  assert.match(
    html,
    /id="createPropertyCategory"[^>]*name="propertyCategoryId"/,
  );
  assert.match(html, /id="createPropertyType"[^>]*name="propertyTypeId"/);
  assert.match(
    html,
    /id="profilePropertyCategory"[^>]*name="propertyCategoryId"/,
  );
  assert.match(html, /id="profilePropertyType"[^>]*name="propertyTypeId"/);
  assert.match(html, /id="propertyCategoryCreateForm"/);
  assert.match(html, /id="propertyTypeCreateForm"/);
  assert.match(source, /\/v1\/public\/property-taxonomy/);
  assert.match(source, /\/v1\/platform\/property-taxonomy/);
  assert.match(source, /function populateTaxonomyTypeSelect\(/);
  assert.match(source, /propertyType\.categoryId === categoryId/);

  const profileStart = html.indexOf('id="profileForm"');
  const profileEnd = html.indexOf("</form>", profileStart);
  const profileMarkup = html.slice(profileStart, profileEnd);
  assert.doesNotMatch(
    profileMarkup,
    /<option[^>]*>\s*(HOTEL|RESORT|VILLA|HOMESTAY|COTTAGE_CLUSTER|APARTMENT|HOSTEL|OTHER)\s*<\/option>/,
  );
});

test("property draft creation preserves exact-retry idempotency across UI failures", () => {
  assert.match(source, /const pendingPropertyCreateKeys = new Map\(\);/);
  assert.match(source, /const form = event\.currentTarget;/);
  assert.match(source, /pendingPropertyCreateKeys\.get\(fingerprint\)/);
  assert.match(source, /idempotencyKey: key/);
  assert.match(source, /pendingPropertyCreateKeys\.delete\(fingerprint\)/);
  assert.match(source, /form\.reset\(\)/);
  const propertyCreateStart = source.indexOf(
    'byId("createPropertyForm").addEventListener("submit"',
  );
  const propertyCreateEnd = source.indexOf(
    "async function fetchOwnerProperties()",
    propertyCreateStart,
  );
  const propertyCreateHandler = source.slice(
    propertyCreateStart,
    propertyCreateEnd,
  );
  assert.doesNotMatch(propertyCreateHandler, /event\.currentTarget\.reset\(\)/);
});

test("property name inputs disable browser autofill", () => {
  assert.match(
    html,
    /id="createPropertyForm"[\s\S]*?Property name<input[\s\S]*?name="name"[\s\S]*?autocomplete="off"/,
  );
  assert.match(
    html,
    /id="profileForm"[\s\S]*?Property name<input[\s\S]*?name="name"[\s\S]*?autocomplete="off"/,
  );
});

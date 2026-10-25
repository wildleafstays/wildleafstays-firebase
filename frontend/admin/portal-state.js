const REVIEW_ROLES = new Set(["SUPER_ADMIN", "OPERATIONS_ADMIN"]);
const CONTROL_CENTER_ROLES = new Set([
  "SUPER_ADMIN",
  "OPERATIONS_ADMIN",
  "REVENUE_MANAGER",
  "FINANCE_MANAGER",
  "CUSTOMER_SUPPORT",
  "ANALYST",
]);
const CONTROL_CENTER_MANAGE_ROLES = new Set([
  "SUPER_ADMIN",
  "OPERATIONS_ADMIN",
  "CUSTOMER_SUPPORT",
]);
const HOMEPAGE_CONTENT_ROLES = new Set(["SUPER_ADMIN", "CONTENT_MANAGER"]);
const EDITABLE_STATUSES = new Set(["DRAFT", "CHANGES_REQUIRED"]);

export function canReviewProperties(session) {
  return (session?.platformRoles || []).some((role) => REVIEW_ROLES.has(role));
}

export function canUseControlCenter(session) {
  return (session?.platformRoles || []).some((role) =>
    CONTROL_CENTER_ROLES.has(role),
  );
}

export function canManagePlatformReservations(session) {
  return (session?.platformRoles || []).some((role) =>
    CONTROL_CENTER_MANAGE_ROLES.has(role),
  );
}

export function canManageHomepageContent(session) {
  return (session?.platformRoles || []).some((role) =>
    HOMEPAGE_CONTENT_ROLES.has(role),
  );
}

export function editableProperty(status) {
  return EDITABLE_STATUSES.has(status);
}

export function availableScreens(session) {
  const screens = [];
  if (canUseControlCenter(session)) screens.push("control");
  if ((session?.platformRoles || []).includes("SUPER_ADMIN")) screens.push("hotels");
  if (canManageHomepageContent(session)) screens.push("homepage");
  if (canReviewProperties(session)) screens.push("reviews");
  if ((session?.organizations || []).length > 0)
    screens.push("dashboard", "properties", "reservations", "calendar");
  else if (!canReviewProperties(session)) screens.push("business");
  return screens;
}

export function platformReservationListPath({
  status = "",
  startDate = "",
  endDate = "",
  cursor = null,
  limit = 50,
} = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (status) query.set("status", status);
  if (startDate) query.set("startDate", startDate);
  if (endDate) query.set("endDate", endDate);
  if (cursor) query.set("cursor", cursor);
  return `/v1/platform/reservations?${query}`;
}

export function profilePayload(form, version) {
  const body = {
    version,
    name: String(form.name || "").trim(),
    timezone: String(form.timezone || "Asia/Kolkata").trim(),
    propertyCategoryId: String(form.propertyCategoryId || "").trim(),
    propertyTypeId: String(form.propertyTypeId || "").trim(),
  };
  for (const key of [
    "saleMode",
    "shortDescription",
    "description",
    "addressLine1",
    "addressLine2",
    "locality",
    "city",
    "stateRegion",
    "postalCode",
    "countryCode",
    "contactPhone",
    "contactEmail",
    "checkInTime",
    "checkOutTime",
    "servicesDescription",
    "spacesDescription",
    "publicAddress",
    "locationDescription",
    "mapUrl",
    "nearbyAttractions",
  ]) {
    const value = String(form[key] || "").trim();
    if (value) body[key] = value;
  }
  for (const key of ["latitude", "longitude"]) {
    if (form[key] !== "" && form[key] !== undefined)
      body[key] = Number(form[key]);
  }
  body.guestContent = guestContentPayload(form);
  return body;
}

export function guestContentPayload(form) {
  const lines = (key) =>
    String(form[key] || "")
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
  const text = (key) => String(form[key] || "").trim() || null;
  const number = (key) => {
    const value = String(form[key] ?? "").trim();
    return value === "" ? null : Number(value);
  };
  const records = (key, fields) =>
    lines(key).map((line) => {
      const values = line.split("|").map((value) => value.trim());
      return Object.fromEntries(
        fields
          .map((field, index) => [field, values[index] || null])
          .filter(([, value]) => value),
      );
    });

  return {
    overview: {
      highlights: lines("guestHighlights"),
      idealFor: lines("guestIdealFor"),
      setting: text("guestPropertySetting"),
    },
    about: {
      buildings: number("guestBuildings"),
      floors: number("guestFloors"),
      bathrooms: number("guestBathrooms"),
      plotArea: text("guestPlotArea"),
      builtUpArea: text("guestBuiltUpArea"),
      constructionYear: number("guestConstructionYear"),
      renovationYear: number("guestRenovationYear"),
      entrance: text("guestEntranceDescription"),
      layout: text("guestLayoutDescription"),
      bathroomsDescription: text("guestBathroomsDescription"),
      privacy: text("guestPrivacyDescription"),
    },
    facilities: records("guestFacilityDetails", [
      "name",
      "description",
      "access",
      "pricing",
      "hours",
      "restrictions",
      "mediaId",
    ]),
    services: records("guestServiceDetails", [
      "name",
      "description",
      "availability",
      "pricing",
      "hours",
      "conditions",
      "mediaId",
    ]),
    location: {
      distances: records("guestLocationDistances", ["name", "distance"]),
      transportation: lines("guestTransportation"),
      accessibility: lines("guestAccessibility"),
      connectivity: lines("guestConnectivity"),
    },
    thingsToKnow: {
      goodToKnow: lines("guestGoodToKnow"),
      accessibility: lines("guestAccessibilityNotes"),
      seasonal: lines("guestSeasonalInformation"),
      limitations: lines("guestLimitations"),
    },
    rules: {
      additional: lines("guestAdditionalRules"),
    },
    reviews: {
      googleReviewsUrl: text("guestGoogleReviewsUrl"),
      googleWriteReviewUrl: text("guestGoogleWriteReviewUrl"),
    },
  };
}

export function reviewQueuePath(status, cursor = null) {
  const query = new URLSearchParams({ limit: "30" });
  if (status) query.set("status", status);
  if (cursor) query.set("cursor", cursor);
  return `/v1/platform/property-reviews?${query}`;
}

export function reservationListPath(
  organizationId,
  propertyId,
  { status = "", startDate = "", endDate = "", cursor = null, limit = 50 } = {},
) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (status) query.set("status", status);
  if (startDate) query.set("startDate", startDate);
  if (endDate) query.set("endDate", endDate);
  if (cursor) query.set("cursor", cursor);
  return `/v1/partner/organizations/${organizationId}/properties/${propertyId}/reservations?${query}`;
}

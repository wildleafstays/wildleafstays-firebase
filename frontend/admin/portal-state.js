const REVIEW_ROLES = new Set(["SUPER_ADMIN", "OPERATIONS_ADMIN"]);
const EDITABLE_STATUSES = new Set(["DRAFT", "CHANGES_REQUIRED"]);

export function canReviewProperties(session) {
  return (session?.platformRoles || []).some((role) => REVIEW_ROLES.has(role));
}

export function editableProperty(status) {
  return EDITABLE_STATUSES.has(status);
}

export function availableScreens(session) {
  const screens = [];
  if (canReviewProperties(session)) screens.push("reviews");
  if ((session?.organizations || []).length > 0) screens.push("properties");
  else if (!canReviewProperties(session)) screens.push("business");
  return screens;
}

export function profilePayload(form, version) {
  const body = {
    version,
    name: String(form.name || "").trim(),
    timezone: String(form.timezone || "Asia/Kolkata").trim(),
  };
  for (const key of [
    "propertyType",
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
  ]) {
    const value = String(form[key] || "").trim();
    if (value) body[key] = value;
  }
  for (const key of ["latitude", "longitude"]) {
    if (form[key] !== "" && form[key] !== undefined)
      body[key] = Number(form[key]);
  }
  return body;
}

export function reviewQueuePath(status, cursor = null) {
  const query = new URLSearchParams({ limit: "30" });
  if (status) query.set("status", status);
  if (cursor) query.set("cursor", cursor);
  return `/v1/platform/property-reviews?${query}`;
}

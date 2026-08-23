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

export function editableProperty(status) {
  return EDITABLE_STATUSES.has(status);
}

export function availableScreens(session) {
  const screens = [];
  if (canUseControlCenter(session)) screens.push("control");
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

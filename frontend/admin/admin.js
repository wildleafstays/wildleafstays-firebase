import {
  authorizedRequest,
  newIdempotencyKey,
  uploadFile,
} from "./api-client.js";
import {
  PROPERTY_AMENITY_GROUPS,
  ROOM_AMENITY_GROUPS,
} from "./amenity-catalog.js";
import {
  availableScreens,
  canManagePlatformReservations,
  canReviewProperties,
  editableProperty,
  platformReservationListPath,
  profilePayload,
  reservationListPath,
  reviewQueuePath,
} from "./portal-state.js";

const auth = firebase.auth();
const pendingUploadKeys = new Map();
const pendingPropertyCreateKeys = new Map();
const pendingRateCalendarSaveKeys = new Map();
const pendingInventoryControlKeys = new Map();
const pendingInventoryCellKeys = new Map();
const pendingOwnerBaseRateKeys = new Map();
const pendingStructureCreateKeys = new Map();
const pendingFloorCreateKeys = new Map();
const pendingPhysicalUnitCreateKeys = new Map();
const state = {
  session: null,
  screen: null,
  organizationId: null,
  properties: [],
  property: null,
  onboarding: null,
  layout: null,
  reservations: [],
  reservationCursor: null,
  operationsPropertyId: null,
  ratePlans: [],
  rateProducts: [],
  rateCalendar: null,
  ownerRateCalendars: {},
  inventoryCalendar: null,
  calendarViewDays: 14,
  operationsLayout: null,
  platformReservations: [],
  platformReservationCursor: null,
  reviewItems: [],
  reviewCursor: null,
  reviewSelection: null,
};

const byId = (id) => document.getElementById(id);
const authView = byId("authView");
const portal = byId("portal");
const portalMessage = byId("portalMessage");

function localDate(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDate(value, days) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

function ownerCalendarRangeDays(startDate, endDate) {
  if (!startDate || !endDate) return null;

  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  const days = Math.round((end - start) / 86400000);

  return Number.isInteger(days) && days > 0 ? days : null;
}

function syncOwnerCalendarViewButtons() {
  const form = byId("calendarFilters");
  if (!form) return;

  const rangeDays = ownerCalendarRangeDays(
    form.elements.startDate.value,
    form.elements.endDate.value,
  );

  if ([7, 14, 30].includes(rangeDays)) {
    state.calendarViewDays = rangeDays;
  }

  document.querySelectorAll("[data-calendar-view-days]").forEach((button) => {
    button.classList.toggle(
      "active",
      Number(button.dataset.calendarViewDays) === rangeDays,
    );
  });
}

function setOwnerCalendarView(days) {
  if (![7, 14, 30].includes(days)) {
    throw new Error("Calendar view must be 7, 14 or 30 days.");
  }

  const form = byId("calendarFilters");
  const startDate = form.elements.startDate.value || localDate();

  form.elements.startDate.value = startDate;
  form.elements.endDate.value = shiftDate(startDate, days);
  state.calendarViewDays = days;

  syncOwnerCalendarViewButtons();
}

function moveOwnerCalendarWindow(direction) {
  if (direction !== -1 && direction !== 1) {
    throw new Error("Calendar direction must be earlier or later.");
  }

  const form = byId("calendarFilters");
  const days =
    ownerCalendarRangeDays(
      form.elements.startDate.value,
      form.elements.endDate.value,
    ) || state.calendarViewDays;

  form.elements.startDate.value = shiftDate(
    form.elements.startDate.value || localDate(),
    direction * days,
  );
  form.elements.endDate.value = shiftDate(form.elements.startDate.value, days);
  state.calendarViewDays = days;
  syncOwnerCalendarViewButtons();
}

function moveOwnerCalendarToToday() {
  const form = byId("calendarFilters");
  form.elements.startDate.value = localDate();
  setOwnerCalendarView(state.calendarViewDays);
}

function money(minor, currencyCode = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 2,
  }).format(Number(minor || 0) / 100);
}

function rupeesToMinor(value) {
  return Math.round(Number(value) * 100);
}

function api(path, options = {}) {
  return authorizedRequest(path, {
    ...options,
    getAccessToken: async () => auth.currentUser?.getIdToken(),
  });
}

function idempotent(path, method, operation, body = {}) {
  return api(path, {
    method,
    body,
    idempotencyKey: newIdempotencyKey(operation),
  });
}

async function managedUpload(path, file, operation) {
  const fingerprint = [
    operation,
    state.property?.id,
    path,
    file.name,
    file.type,
    file.size,
    file.lastModified,
  ].join(":");
  const key =
    pendingUploadKeys.get(fingerprint) || newIdempotencyKey(operation);
  pendingUploadKeys.set(fingerprint, key);
  const result = await uploadFile(path, file, {
    idempotencyKey: key,
    getAccessToken: async () => auth.currentUser?.getIdToken(),
  });
  pendingUploadKeys.delete(fingerprint);
  return result;
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function button(label, onClick, className = "") {
  const element = textElement("button", className, label);
  element.type = "button";
  element.addEventListener("click", () => run(onClick));
  return element;
}

function showMessage(message, error = false) {
  portalMessage.textContent = message;
  portalMessage.classList.remove("hidden");
  portalMessage.classList.toggle("error", error);
}

function clearMessage() {
  portalMessage.textContent = "";
  portalMessage.classList.add("hidden");
  portalMessage.classList.remove("error");
}

function errorMessage(error) {
  return error?.message || "Something went wrong. Please try again.";
}

async function run(action, successMessage = "") {
  clearMessage();
  try {
    await action();
    if (successMessage) showMessage(successMessage);
  } catch (error) {
    showMessage(errorMessage(error), true);
  }
}

function switchAuth(mode) {
  const registering = mode === "register";
  byId("registerForm").classList.toggle("hidden", !registering);
  byId("signInForm").classList.toggle("hidden", registering);
  byId("registerTab").classList.toggle("active", registering);
  byId("signInTab").classList.toggle("active", !registering);
  byId("authHeading").textContent = registering
    ? "Join as a hotel owner"
    : "Welcome back";
  byId("authIntro").textContent = registering
    ? "Create your secure account, then register your business."
    : "Sign in to manage your Wildleaf properties.";
  byId("authMessage").textContent = "";
}

byId("signInTab").addEventListener("click", () => switchAuth("sign-in"));
byId("registerTab").addEventListener("click", () => switchAuth("register"));

byId("signInForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  byId("authMessage").textContent = "Signing in…";
  try {
    await auth.signInWithEmailAndPassword(
      data.get("email"),
      data.get("password"),
    );
  } catch (error) {
    byId("authMessage").textContent = errorMessage(error);
    byId("authMessage").classList.add("error");
  }
});

byId("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  byId("authMessage").textContent = "Creating your account…";
  try {
    const credential = await auth.createUserWithEmailAndPassword(
      data.get("email"),
      data.get("password"),
    );
    await credential.user.updateProfile({
      displayName: data.get("displayName"),
    });
    await credential.user.getIdToken(true);
  } catch (error) {
    byId("authMessage").textContent = errorMessage(error);
    byId("authMessage").classList.add("error");
  }
});

byId("logoutButton").addEventListener("click", () => auth.signOut());

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    state.session = null;
    portal.classList.add("hidden");
    authView.classList.remove("hidden");
    return;
  }
  authView.classList.add("hidden");
  portal.classList.remove("hidden");
  await run(async () => {
    await loadSession();
    await showScreen(availableScreens(state.session)[0]);
  });
});

async function loadSession() {
  state.session = await api("/v1/session");
  state.organizationId =
    state.organizationId ||
    state.session.organizations[0]?.organizationId ||
    null;
  byId("accountEmail").textContent =
    state.session.user.email || "Authenticated user";
  byId("roleLabel").textContent = canReviewProperties(state.session)
    ? "Wildleaf management"
    : state.session.platformRoles.length
      ? "Wildleaf management"
      : state.session.organizations.length
        ? "Hotel partner"
        : "New hotel owner";

  const screens = availableScreens(state.session);
  document.querySelectorAll(".nav").forEach((item) => {
    item.classList.toggle("hidden", !screens.includes(item.dataset.screen));
  });
}

document.querySelectorAll(".nav").forEach((item) => {
  item.addEventListener("click", () =>
    run(() => showScreen(item.dataset.screen)),
  );
});

const screenCopy = {
  dashboard: ["Partner operations", "Today at your hotels"],
  business: ["Owner onboarding", "Set up your business"],
  properties: ["Partner portal", "Your properties"],
  reservations: ["Partner operations", "Reservations"],
  calendar: ["Partner operations", "Rates and inventory"],
  control: ["Wildleaf management", "Operations control center"],
  editor: ["Partner portal", "Hotel registration"],
  reviews: ["Wildleaf management", "Property reviews"],
};

async function showScreen(name) {
  state.screen = name;
  clearMessage();
  document
    .querySelectorAll(".screen")
    .forEach((item) => item.classList.add("hidden"));
  byId(`${name}Screen`).classList.remove("hidden");
  document.querySelectorAll(".nav").forEach((item) => {
    item.classList.toggle("active", item.dataset.screen === name);
  });
  const [eyebrow, title] = screenCopy[name];
  byId("screenEyebrow").textContent = eyebrow;
  byId("screenTitle").textContent = title;

  if (name === "dashboard") await loadDashboard();
  if (name === "properties") await loadProperties();
  if (name === "reservations") await loadReservations(false);
  if (name === "calendar") await loadCalendarWorkspace();
  if (name === "control") await loadControlCenter(false);
  if (name === "reviews") await loadReviews(false);
}

byId("refreshButton").addEventListener("click", () =>
  run(async () => {
    await loadSession();
    if (state.screen === "dashboard") await loadDashboard();
    else if (state.screen === "properties") await loadProperties();
    else if (state.screen === "reservations") await loadReservations(false);
    else if (state.screen === "calendar") await loadCalendarWorkspace();
    else if (state.screen === "control") await loadControlCenter(false);
    else if (state.screen === "editor" && state.property) {
      await openProperty(state.property.organizationId, state.property.id);
    } else if (state.screen === "reviews") await loadReviews(false);
  }, "Workspace refreshed."),
);

byId("businessForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  run(async () => {
    await idempotent(
      "/v1/partner/organizations",
      "POST",
      "organization-create",
      {
        legalName: data.legalName.trim(),
        ...(data.tradingName.trim()
          ? { tradingName: data.tradingName.trim() }
          : {}),
        organizationType: data.organizationType,
        countryCode: data.countryCode.toUpperCase(),
        currencyCode: "INR",
      },
    );
    await loadSession();
    await showScreen("properties");
    showMessage(
      "Business workspace created. You can now register your first hotel.",
    );
  });
});

byId("showPropertyFormButton").addEventListener("click", () => {
  byId("createPropertyForm").classList.toggle("hidden");
});

byId("organizationSelect").addEventListener("change", (event) => {
  state.organizationId = event.target.value;
  run(loadProperties);
});

byId("createPropertyForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const body = {
    name: data.name.trim(),
    timezone: data.timezone.trim(),
  };
  const fingerprint = [state.organizationId, body.name, body.timezone].join(
    ":",
  );
  const key =
    pendingPropertyCreateKeys.get(fingerprint) ||
    newIdempotencyKey("property-create");
  pendingPropertyCreateKeys.set(fingerprint, key);
  run(async () => {
    const result = await api(
      `/v1/partner/organizations/${state.organizationId}/properties`,
      {
        method: "POST",
        body,
        idempotencyKey: key,
      },
    );
    await openProperty(state.organizationId, result.property.id);
    pendingPropertyCreateKeys.delete(fingerprint);
    form.reset();
    form.elements.timezone.value = "Asia/Kolkata";
    form.classList.add("hidden");
    showMessage(
      "Property draft created. Complete the profile and onboarding checklist.",
    );
  });
});

async function fetchOwnerProperties() {
  if (!state.organizationId) {
    state.organizationId =
      state.session?.organizations?.[0]?.organizationId || null;
  }
  if (!state.organizationId) {
    state.properties = [];
    return state.properties;
  }
  const data = await api(
    `/v1/partner/organizations/${state.organizationId}/properties`,
  );
  state.properties = data.properties || [];
  return state.properties;
}

function populatePropertySelect(select, preferredId = "") {
  const selected =
    preferredId &&
    state.properties.some((property) => property.id === preferredId)
      ? preferredId
      : state.properties[0]?.id || "";
  select.replaceChildren();
  if (!state.properties.length) {
    const option = textElement("option", "", "Register a hotel first");
    option.value = "";
    select.append(option);
    select.disabled = true;
    return "";
  }
  select.disabled = false;
  for (const property of state.properties) {
    const option = textElement("option", "", property.name);
    option.value = property.id;
    option.selected = property.id === selected;
    select.append(option);
  }
  return selected;
}

async function loadProperties() {
  const organizations = state.session.organizations || [];
  const select = byId("organizationSelect");
  select.replaceChildren();
  for (const membership of organizations) {
    const option = textElement(
      "option",
      "",
      `Business ${membership.organizationId.slice(0, 8)} · ${membership.role}`,
    );
    option.value = membership.organizationId;
    option.selected = membership.organizationId === state.organizationId;
    select.append(option);
  }
  if (!state.organizationId && organizations[0])
    state.organizationId = organizations[0].organizationId;
  if (!state.organizationId) return;

  await fetchOwnerProperties();
  const list = byId("propertyList");
  list.replaceChildren();
  if (!state.properties.length) {
    list.append(
      textElement("p", "empty-state card", "No hotels registered yet."),
    );
    return;
  }
  for (const property of state.properties) {
    const card = document.createElement("article");
    card.className = "property-card";
    const copy = document.createElement("div");
    copy.append(textElement("h3", "", property.name));
    copy.append(
      textElement(
        "p",
        "",
        [property.city, property.stateRegion].filter(Boolean).join(", ") ||
          "Location not completed",
      ),
    );
    copy.append(
      textElement("span", "status-pill", property.status.replaceAll("_", " ")),
    );
    card.append(
      copy,
      button("Continue registration", () =>
        openProperty(property.organizationId, property.id),
      ),
    );
    list.append(card);
  }
}

byId("backToProperties").addEventListener("click", () =>
  run(() => showScreen("properties")),
);

async function openProperty(organizationId, propertyId) {
  const [profile, onboarding, layout] = await Promise.all([
    api(`/v1/partner/organizations/${organizationId}/properties/${propertyId}`),
    api(
      `/v1/partner/organizations/${organizationId}/properties/${propertyId}/onboarding`,
    ),
    api(
      `/v1/partner/organizations/${organizationId}/properties/${propertyId}/layout`,
    ),
  ]);
  state.property = profile.property;
  state.onboarding = onboarding;
  state.layout = layout;
  renderEditor();
  await showScreen("editor");
}

function fillForm(form, values) {
  for (const [key, value] of Object.entries(values || {})) {
    if (form.elements[key]) form.elements[key].value = value ?? "";
  }
}

function renderPropertyAmenities(amenities, editable) {
  const selected = new Set((amenities || []).map((item) => item.code));
  const container = byId("propertyAmenityOptions");
  container.replaceChildren();

  for (const group of PROPERTY_AMENITY_GROUPS) {
    const section = document.createElement("fieldset");
    section.className = "amenity-group";

    const legend = textElement("legend", "", group.label);
    section.append(legend);

    const options = document.createElement("div");
    options.className = "amenity-options";

    for (const [code, label] of group.amenities) {
      const option = document.createElement("label");
      option.className = "amenity-option";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "amenity";
      input.value = code;
      input.checked = selected.has(code);
      input.disabled = !editable;

      option.append(input, textElement("span", "", label));
      options.append(option);
    }

    section.append(options);
    container.append(section);
  }
}

function renderRoomAmenityChoices(editable) {
  const container = byId("roomCategoryAmenityOptions");
  container.replaceChildren();

  for (const group of ROOM_AMENITY_GROUPS) {
    const section = document.createElement("fieldset");
    section.className = "amenity-group";

    section.append(textElement("legend", "", group.label));

    const options = document.createElement("div");
    options.className = "amenity-options";

    for (const [code, label] of group.amenities) {
      const option = document.createElement("label");
      option.className = "amenity-option";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "roomAmenity";
      input.value = code;
      input.disabled = !editable;

      option.append(input, textElement("span", "", label));
      options.append(option);
    }

    section.append(options);
    container.append(section);
  }
}

function renderEditor() {
  const property = state.property;
  const onboarding = state.onboarding;
  byId("editorPropertyName").textContent = property.name;
  byId("editorStatus").textContent = property.status.replaceAll("_", " ");
  fillForm(byId("profileForm"), property);
  fillForm(byId("policiesForm"), onboarding.policies || {});

  const editable = editableProperty(property.status);
  renderPropertyAmenities(onboarding.amenities || [], editable);
  renderRoomAmenityChoices(editable);
  for (const form of [
    byId("profileForm"),
    byId("policiesForm"),
    byId("amenitiesForm"),
    byId("roomCategoryForm"),
    byId("roomCategoryImageUploadForm"),
    byId("structureForm"),
    byId("floorForm"),
    byId("physicalUnitForm"),
    byId("imageUploadForm"),
    byId("documentUploadForm"),
  ]) {
    Array.from(form.elements).forEach((element) => {
      element.disabled = !editable;
    });
  }

  const checklist = byId("checklist");
  checklist.replaceChildren();
  const checks = [
    ["profileComplete", "Core hotel profile"],
    ["accommodationComplete", "Accommodation setup"],
    ["policiesComplete", "Policies and house rules"],
    ["amenitiesComplete", "Property amenities"],
    ["mediaComplete", "Images and cover image"],
    ["rightToOperateDocumentPresent", "Ownership or lease document"],
  ];
  for (const [key, label] of checks) {
    const row = document.createElement("div");
    row.className = "check-row";
    row.append(
      textElement(
        "span",
        `check-icon ${onboarding.checklist[key] ? "" : "missing"}`,
        onboarding.checklist[key] ? "✓" : "○",
      ),
      textElement("span", "", label),
    );
    checklist.append(row);
  }
  const submit = byId("submitPropertyButton");
  submit.classList.toggle(
    "hidden",
    !(editable && onboarding.checklist.readyToSubmit),
  );
  renderAccommodation(editable);
  renderAssets(editable);
}

function renderRoomCategoryMedia(editable, categories) {
  const list = byId("roomCategoryMediaList");
  list.replaceChildren();

  const media = state.layout?.roomCategoryMedia || [];

  if (!categories.length) {
    list.append(
      textElement(
        "p",
        "empty-state",
        "Add a room category before uploading category photos.",
      ),
    );
    return;
  }

  if (!media.length) {
    list.append(
      textElement("p", "muted", "No room category photos uploaded yet."),
    );
    return;
  }

  for (const item of media) {
    const category = categories.find(
      (candidate) => candidate.id === item.roomCategoryId,
    );

    const row = document.createElement("div");
    row.className = "asset-row";

    const copy = document.createElement("div");

    copy.append(
      textElement(
        "strong",
        "",
        item.altText || `${category?.name || "Room category"} photo`,
      ),
    );

    copy.append(
      textElement(
        "small",
        "muted",
        `${category?.name || "Room category"} | ${item.mimeType || "image"}`,
      ),
    );

    if (item.caption) {
      copy.append(textElement("small", "muted", item.caption));
    }

    row.append(copy);

    if (editable) {
      const actions = document.createElement("div");

      actions.className = "asset-actions";

      actions.append(
        button(
          "Remove",
          () => archiveRoomCategoryMedia(item.roomCategoryId, item.id),
          "danger-button",
        ),
      );

      row.append(actions);
    }

    list.append(row);
  }
}

function renderAccommodation(editable) {
  const categories = state.layout?.roomCategories || [];
  const units = state.layout?.physicalUnits || [];
  const structures = state.layout?.structures || [];
  const floors = state.layout?.floors || [];

  const categorySelect = byId("unitRoomCategory");
  const previousCategory = categorySelect.value;
  categorySelect.replaceChildren();

  if (!categories.length) {
    const option = textElement("option", "", "Add a room category first");
    option.value = "";
    categorySelect.append(option);
  }

  for (const category of categories) {
    const option = textElement("option", "", category.name);
    option.value = category.id;
    categorySelect.append(option);
  }

  categorySelect.disabled = !editable || !categories.length;

  if (
    previousCategory &&
    categories.some((category) => category.id === previousCategory)
  ) {
    categorySelect.value = previousCategory;
  }

  const photoCategorySelect = byId("roomCategoryImageCategory");

  const previousPhotoCategory = photoCategorySelect.value;

  photoCategorySelect.replaceChildren();

  if (!categories.length) {
    const option = textElement("option", "", "Add a room category first");
    option.value = "";
    photoCategorySelect.append(option);
  }

  for (const category of categories) {
    const option = textElement("option", "", category.name);
    option.value = category.id;
    photoCategorySelect.append(option);
  }

  photoCategorySelect.disabled = !editable || !categories.length;

  if (
    previousPhotoCategory &&
    categories.some((category) => category.id === previousPhotoCategory)
  ) {
    photoCategorySelect.value = previousPhotoCategory;
  }

  renderRoomCategoryMedia(editable, categories);

  const floorStructureSelect = byId("floorStructure");
  const previousStructure = floorStructureSelect.value;
  floorStructureSelect.replaceChildren();

  if (!structures.length) {
    const option = textElement("option", "", "Add a building / area first");
    option.value = "";
    floorStructureSelect.append(option);
  }

  for (const structure of structures) {
    const option = textElement("option", "", structure.name);
    option.value = structure.id;
    floorStructureSelect.append(option);
  }

  if (
    previousStructure &&
    structures.some((structure) => structure.id === previousStructure)
  ) {
    floorStructureSelect.value = previousStructure;
  }

  const floorForm = byId("floorForm");
  for (const element of floorForm.elements) {
    element.disabled = !editable || !structures.length;
  }

  const unitFloor = byId("unitFloor");
  const previousFloor = unitFloor.value;
  unitFloor.replaceChildren();

  const noFloorOption = textElement("option", "", "Not applicable / not set");
  noFloorOption.value = "";
  unitFloor.append(noFloorOption);

  for (const floor of floors) {
    const structure = structures.find(
      (candidate) => candidate.id === floor.structureId,
    );

    const structureSuffix =
      structure && structures.length > 1 ? ` - ${structure.name}` : "";

    const option = textElement("option", "", `${floor.name}${structureSuffix}`);

    option.value = floor.id;
    unitFloor.append(option);
  }

  unitFloor.disabled = !editable;

  if (previousFloor && floors.some((floor) => floor.id === previousFloor)) {
    unitFloor.value = previousFloor;
  }

  const list = byId("accommodationList");
  list.replaceChildren();

  if (!categories.length) {
    list.append(
      textElement(
        "p",
        "empty-state",
        "Add a room category before adding actual rooms.",
      ),
    );
    return;
  }

  for (const category of categories) {
    const categoryUnits = units.filter(
      (unit) => unit.roomCategoryId === category.id,
    );

    const row = document.createElement("div");
    row.className = "compact-row";

    const copy = document.createElement("div");
    copy.append(textElement("strong", "", category.name));

    copy.append(
      textElement(
        "span",
        "muted",
        `${category.accommodationType} | up to ${category.maxOccupancy} guests | ${categoryUnits.length} room${categoryUnits.length === 1 ? "" : "s"} | ${(state.layout?.roomCategoryAmenities || []).filter((item) => item.roomCategoryId === category.id).length} amenities | ${(state.layout?.roomCategoryMedia || []).filter((item) => item.roomCategoryId === category.id).length} photos`,
      ),
    );

    if (!categoryUnits.length) {
      copy.append(textElement("small", "muted", "No actual rooms added yet."));
    }

    if (categoryUnits.length) {
      const roomList = document.createElement("div");
      roomList.className = "physical-room-list";

      for (const unit of categoryUnits) {
        const roomRow = document.createElement("div");
        roomRow.className = "physical-room-row";

        roomRow.append(
          textElement("strong", "", unit.displayName || unit.unitCode),
        );

        const details = [];

        const floor = floors.find((candidate) => candidate.id === unit.floorId);

        if (floor) {
          const structure = structures.find(
            (candidate) => candidate.id === floor.structureId,
          );

          details.push(
            structure && structures.length > 1
              ? `${floor.name} - ${structure.name}`
              : floor.name,
          );
        }

        if (unit.viewLabel) {
          details.push(unit.viewLabel);
        }

        if (unit.liftAccessible) {
          details.push("Lift");
        }

        if (unit.wheelchairAccessible) {
          details.push("Wheelchair friendly");
        }

        if (unit.stepFreeAccessible) {
          details.push("Step-free access");
        }

        roomRow.append(
          textElement(
            "small",
            "muted",
            details.length
              ? details.join(" | ")
              : "No additional room-specific details",
          ),
        );

        roomList.append(roomRow);
      }

      copy.append(roomList);
    }

    row.append(copy);
    list.append(row);
  }
}

function renderAssets(editable) {
  const mediaList = byId("mediaList");
  mediaList.replaceChildren();
  const media = state.onboarding?.media || [];
  if (!media.length)
    mediaList.append(textElement("p", "muted", "No images uploaded."));
  for (const item of media) {
    const row = document.createElement("div");
    row.className = "asset-row";
    const copy = document.createElement("div");
    copy.append(
      textElement(
        "strong",
        "",
        item.altText || `Property image ${item.id.slice(0, 8)}`,
      ),
    );
    copy.append(
      textElement(
        "small",
        "muted",
        `${item.mimeType || "image"}${item.isCover ? " · cover image" : ""}`,
      ),
    );
    row.append(copy);
    if (editable) {
      const actions = document.createElement("div");
      actions.className = "asset-actions";
      if (!item.isCover)
        actions.append(
          button(
            "Make cover",
            () => setCoverImage(item.id),
            "button-secondary",
          ),
        );
      actions.append(
        button("Archive", () => archiveMedia(item.id), "danger-button"),
      );
      row.append(actions);
    }
    mediaList.append(row);
  }

  const documentList = byId("documentList");
  documentList.replaceChildren();
  const documents = state.onboarding?.documents || [];
  if (!documents.length)
    documentList.append(
      textElement("p", "muted", "No compliance documents uploaded."),
    );
  for (const item of documents) {
    const row = document.createElement("div");
    row.className = "asset-row";
    const copy = document.createElement("div");
    copy.append(textElement("strong", "", item.originalFilename));
    copy.append(
      textElement(
        "small",
        "muted",
        `${item.documentType} · ${item.verificationStatus}`,
      ),
    );
    row.append(copy);
    if (editable)
      row.append(
        button("Archive", () => archiveDocument(item.id), "danger-button"),
      );
    documentList.append(row);
  }
}

byId("profileForm").addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const path = `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/profile`;
    const result = await idempotent(
      path,
      "PUT",
      "property-profile-save",
      profilePayload(values, state.property.version),
    );
    state.property = result.property;
    await refreshEditorOnboarding();
    showMessage("Property profile saved.");
  });
});

byId("policiesForm").addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const body = {
      childrenPolicy: values.childrenPolicy,
      petsPolicy: values.petsPolicy,
      smokingPolicy: values.smokingPolicy,
      partiesEventsPolicy: values.partiesEventsPolicy,
      ...(values.minimumCheckinAge !== ""
        ? { minimumCheckinAge: Number(values.minimumCheckinAge) }
        : {}),
      ...(values.houseRules.trim()
        ? { houseRules: values.houseRules.trim() }
        : {}),
    };
    await idempotent(
      `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/onboarding/policies`,
      "PUT",
      "property-policies-save",
      body,
    );
    await refreshEditorOnboarding();
    showMessage("Property policies saved.");
  });
});

byId("amenitiesForm").addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    const form = event.currentTarget;
    const codes = Array.from(
      form.querySelectorAll('input[name="amenity"]:checked'),
    ).map((input) => input.value);

    await idempotent(
      `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/onboarding/amenities`,
      "PUT",
      "property-amenities-save",
      { amenities: codes.map((code) => ({ code })) },
    );

    await refreshEditorOnboarding();
    showMessage("Amenities saved.");
  });
});

byId("roomCategoryForm").addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const name = values.name.trim();

    const code =
      name
        .normalize("NFKD")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 50) || "ROOM";

    const baseAdults = Number(values.baseAdults);
    const baseChildren = Number(values.baseChildren);
    const maxAdults = Number(values.maxAdults);
    const maxChildren = Number(values.maxChildren);
    const maxOccupancy = Number(values.maxOccupancy);

    const defaultExtraAdultMinor = rupeesToMinor(values.defaultExtraAdult);
    const defaultExtraChildMinor = rupeesToMinor(values.defaultExtraChild);

    if (
      !Number.isInteger(baseAdults) ||
      baseAdults < 1 ||
      !Number.isInteger(baseChildren) ||
      baseChildren < 0
    ) {
      throw new Error(
        "Base adults and base children must be valid whole numbers.",
      );
    }

    if (
      !Number.isInteger(maxAdults) ||
      maxAdults < 1 ||
      !Number.isInteger(maxChildren) ||
      maxChildren < 0 ||
      !Number.isInteger(maxOccupancy) ||
      maxOccupancy < 1
    ) {
      throw new Error("Maximum guest limits must be valid whole numbers.");
    }

    if (
      baseAdults > maxAdults ||
      baseChildren > maxChildren ||
      baseAdults + baseChildren > maxOccupancy
    ) {
      throw new Error(
        "Included guests cannot exceed this category's maximum occupancy.",
      );
    }

    if (
      !Number.isSafeInteger(defaultExtraAdultMinor) ||
      defaultExtraAdultMinor < 0 ||
      !Number.isSafeInteger(defaultExtraChildMinor) ||
      defaultExtraChildMinor < 0
    ) {
      throw new Error(
        "Extra adult and extra child charges must be valid amounts.",
      );
    }

    const selectedAmenityCodes = Array.from(
      form.querySelectorAll('input[name="roomAmenity"]:checked'),
    ).map((input) => input.value);

    const result = await idempotent(
      `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/room-categories`,
      "POST",
      "room-category-create",
      {
        code,
        name,
        accommodationType: values.accommodationType,
        ...(values.description.trim()
          ? { description: values.description.trim() }
          : {}),
        baseOccupancy: baseAdults + baseChildren,
        baseAdults,
        baseChildren,
        maxAdults,
        maxChildren,
        maxOccupancy,
        defaultExtraAdultMinor,
        defaultExtraChildMinor,
        ...(values.sizeSqm ? { sizeSqm: Number(values.sizeSqm) } : {}),
        ...(values.bedConfiguration.trim()
          ? { bedConfiguration: values.bedConfiguration.trim() }
          : {}),
        extraBedAllowed: values.extraBedAllowed === "on",
        ...(values.defaultViewLabel
          ? { defaultViewLabel: values.defaultViewLabel }
          : {}),
      },
    );

    const roomCategoryId = result?.roomCategory?.id;

    if (!roomCategoryId) {
      throw new Error(
        "Room category was created but its identifier was not returned.",
      );
    }

    if (selectedAmenityCodes.length) {
      await idempotent(
        `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/room-categories/${roomCategoryId}/amenities`,
        "PUT",
        "room-category-amenities-save",
        { amenityCodes: selectedAmenityCodes },
      );
    }

    form.reset();

    await refreshEditorData();

    byId("roomCategoryImageCategory").value = roomCategoryId;

    showMessage(`Room category "${name}" added.`);
  });
});

byId("roomCategoryImageUploadForm").addEventListener("submit", (event) => {
  event.preventDefault();

  run(async () => {
    const form = event.currentTarget;

    const values = Object.fromEntries(new FormData(form));

    const roomCategoryId = values.roomCategoryId;

    const file = form.elements.file.files[0];

    if (!roomCategoryId) {
      throw new Error("Choose a room category first.");
    }

    if (!file) {
      throw new Error("Choose a room category photo.");
    }

    if (file.size > 8 * 1024 * 1024) {
      throw new Error("Room category photos must be 8 MB or smaller.");
    }

    const category = (state.layout?.roomCategories || []).find(
      (item) => item.id === roomCategoryId,
    );

    const query = new URLSearchParams();

    const altText =
      typeof values.altText === "string" ? values.altText.trim() : "";

    const caption =
      typeof values.caption === "string" ? values.caption.trim() : "";

    if (altText) {
      query.set("altText", altText);
    }

    if (caption) {
      query.set("caption", caption);
    }

    const queryString = query.toString();

    await managedUpload(
      `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/room-categories/${roomCategoryId}/uploads/images${queryString ? `?${queryString}` : ""}`,
      file,
      "room-category-image-upload",
    );

    form.reset();

    await refreshEditorData();

    byId("roomCategoryImageCategory").value = roomCategoryId;

    showMessage(`Photo uploaded for "${category?.name || "room category"}".`);
  });
});

async function archiveRoomCategoryMedia(roomCategoryId, mediaId) {
  await api(
    `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/room-categories/${roomCategoryId}/media/${mediaId}`,
    {
      method: "DELETE",
      idempotencyKey: newIdempotencyKey("room-category-media-archive"),
    },
  );

  await refreshEditorData();

  showMessage("Room category photo removed.");
}

byId("structureForm").addEventListener("submit", (event) => {
  event.preventDefault();

  run(async () => {
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const name = values.name.trim();

    const fingerprint = [
      state.property.id,
      name.toUpperCase(),
      values.structureType,
      values.hasLift === "on",
      values.wheelchairAccessible === "on",
    ].join("|");

    const key =
      pendingStructureCreateKeys.get(fingerprint) ||
      newIdempotencyKey("property-structure-create");

    pendingStructureCreateKeys.set(fingerprint, key);

    const result = await api(
      `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/structures`,
      {
        method: "POST",
        idempotencyKey: key,
        body: {
          name,
          structureType: values.structureType,
          hasLift: values.hasLift === "on",
          wheelchairAccessible: values.wheelchairAccessible === "on",
        },
      },
    );

    const structureId = result?.structure?.id;

    await refreshEditorData();

    if (structureId) {
      byId("floorStructure").value = structureId;
    }

    form.reset();
    pendingStructureCreateKeys.delete(fingerprint);

    showMessage(`Building / area "${name}" added.`);
  });
});

byId("floorForm").addEventListener("submit", (event) => {
  event.preventDefault();

  run(async () => {
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const structureId = values.structureId;
    const name = values.name.trim();

    if (!structureId) {
      throw new Error("Choose a building / area first.");
    }

    const floorNumber =
      values.floorNumber === "" ? null : Number(values.floorNumber);

    if (floorNumber !== null && !Number.isInteger(floorNumber)) {
      throw new Error("Floor number must be a whole number.");
    }

    const fingerprint = [
      state.property.id,
      structureId,
      name.toUpperCase(),
      floorNumber ?? "",
      values.liftAccessible === "on",
      values.wheelchairAccessible === "on",
    ].join("|");

    const key =
      pendingFloorCreateKeys.get(fingerprint) ||
      newIdempotencyKey("property-floor-create");

    pendingFloorCreateKeys.set(fingerprint, key);

    const result = await api(
      `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/structures/${structureId}/floors`,
      {
        method: "POST",
        idempotencyKey: key,
        body: {
          name,
          ...(floorNumber !== null ? { floorNumber } : {}),
          liftAccessible: values.liftAccessible === "on",
          wheelchairAccessible: values.wheelchairAccessible === "on",
        },
      },
    );

    const floorId = result?.floor?.id;

    await refreshEditorData();

    if (floorId) {
      byId("unitFloor").value = floorId;
    }

    form.reset();
    pendingFloorCreateKeys.delete(fingerprint);

    showMessage(`Floor "${name}" added.`);
  });
});

byId("physicalUnitForm").addEventListener("submit", (event) => {
  event.preventDefault();

  run(async () => {
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const roomName = values.roomName.trim();
    const viewLabel = values.viewLabel?.trim() || "";
    const floorId = values.floorId || "";

    const floor = floorId
      ? (state.layout?.floors || []).find(
          (candidate) => candidate.id === floorId,
        )
      : null;

    if (floorId && !floor) {
      throw new Error(
        "The selected floor is no longer available. Refresh and try again.",
      );
    }

    const fingerprint = [
      state.property.id,
      values.roomCategoryId,
      roomName.toUpperCase(),
      floorId,
      viewLabel,
      values.liftAccessible === "on",
      values.wheelchairAccessible === "on",
      values.stepFreeAccessible === "on",
    ].join("|");

    const key =
      pendingPhysicalUnitCreateKeys.get(fingerprint) ||
      newIdempotencyKey("physical-unit-create");

    pendingPhysicalUnitCreateKeys.set(fingerprint, key);

    await api(
      `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/units`,
      {
        method: "POST",
        idempotencyKey: key,
        body: {
          roomCategoryId: values.roomCategoryId,
          ...(floor
            ? {
                floorId: floor.id,
                structureId: floor.structureId,
              }
            : {}),
          unitCode: roomName.toUpperCase(),
          displayName: roomName,
          hasView: Boolean(viewLabel),
          ...(viewLabel ? { viewLabel } : {}),
          wheelchairAccessible: values.wheelchairAccessible === "on",
          stepFreeAccessible: values.stepFreeAccessible === "on",
          liftAccessible: values.liftAccessible === "on",
          smokingPolicy: "NON_SMOKING",
        },
      },
    );

    await refreshEditorData();

    form.reset();
    pendingPhysicalUnitCreateKeys.delete(fingerprint);

    showMessage(`Room "${roomName}" added.`);
  });
});

byId("imageUploadForm").addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const file = form.elements.file.files[0];
    if (!file) throw new Error("Choose an image to upload.");
    if (file.size > 8 * 1024 * 1024)
      throw new Error("Property images must be 8 MB or smaller.");
    const query = new URLSearchParams();
    if (values.altText.trim()) query.set("altText", values.altText.trim());
    if (values.caption.trim()) query.set("caption", values.caption.trim());
    query.set("isCover", String(values.isCover === "on"));
    await managedUpload(
      `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/onboarding/uploads/images?${query}`,
      file,
      "property-image-upload",
    );
    form.reset();
    await refreshEditorOnboarding();
    showMessage("Property image uploaded and verified.");
  });
});

byId("documentUploadForm").addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const file = form.elements.file.files[0];
    if (!file) throw new Error("Choose a PDF document to upload.");
    if (file.size > 12 * 1024 * 1024)
      throw new Error("Compliance documents must be 12 MB or smaller.");
    const query = new URLSearchParams({ documentType: values.documentType });
    if (values.issuedOn) query.set("issuedOn", values.issuedOn);
    if (values.expiresOn) query.set("expiresOn", values.expiresOn);
    await managedUpload(
      `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/onboarding/uploads/documents?${query}`,
      file,
      "property-document-upload",
    );
    form.reset();
    await refreshEditorOnboarding();
    showMessage("Compliance PDF uploaded to private storage.");
  });
});

async function setCoverImage(mediaId) {
  await idempotent(
    `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/onboarding/media/${mediaId}/cover`,
    "POST",
    "property-cover-select",
    {},
  );
  await refreshEditorOnboarding();
  showMessage("Cover image updated.");
}

async function archiveMedia(mediaId) {
  await api(
    `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/onboarding/media/${mediaId}`,
    {
      method: "DELETE",
      idempotencyKey: newIdempotencyKey("property-media-archive"),
    },
  );
  await refreshEditorOnboarding();
  showMessage("Image archived.");
}

async function archiveDocument(documentId) {
  await api(
    `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/onboarding/documents/${documentId}`,
    {
      method: "DELETE",
      idempotencyKey: newIdempotencyKey("property-document-archive"),
    },
  );
  await refreshEditorOnboarding();
  showMessage("Document archived.");
}

byId("submitPropertyButton").addEventListener("click", () => {
  run(async () => {
    await idempotent(
      `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/onboarding/submit`,
      "POST",
      "property-submit",
      { version: state.property.version },
    );
    await reloadEditor();
    showMessage("Property submitted to Wildleaf management for review.");
  });
});

async function refreshEditorOnboarding() {
  state.onboarding = await api(
    `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/onboarding`,
  );
  renderEditor();
}

async function refreshEditorData() {
  const [onboarding, layout] = await Promise.all([
    api(
      `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/onboarding`,
    ),
    api(
      `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/layout`,
    ),
  ]);
  state.onboarding = onboarding;
  state.layout = layout;
  renderEditor();
}

async function reloadEditor() {
  await openProperty(state.property.organizationId, state.property.id);
}

function reservationRow(item, allowTransitions = true) {
  const row = document.createElement("article");
  row.className = "reservation-row";
  const primary = document.createElement("div");
  primary.append(textElement("strong", "", item.leadGuest.name));
  primary.append(
    textElement(
      "span",
      "muted",
      `${item.reservationReference} · ${item.productLabel}`,
    ),
  );
  if (item.propertyName) {
    primary.append(
      textElement(
        "span",
        "property-context",
        `${item.propertyName} · ${item.organizationName}`,
      ),
    );
  }
  const stay = document.createElement("div");
  stay.append(
    textElement("strong", "", `${item.arrivalDate} → ${item.departureDate}`),
  );
  stay.append(
    textElement(
      "span",
      "muted",
      `${item.quantity} unit${item.quantity === 1 ? "" : "s"} · ${money(item.totalMinor, item.currencyCode)}`,
    ),
  );
  const contact = document.createElement("div");
  contact.append(
    textElement("span", "status-pill", item.status.replaceAll("_", " ")),
  );
  contact.append(
    textElement(
      "small",
      "muted",
      item.leadGuest.phone ||
        item.leadGuest.email ||
        "No guest contact supplied",
    ),
  );
  row.append(primary, stay, contact);

  if (allowTransitions && ["CONFIRMED", "CHECKED_IN"].includes(item.status)) {
    const action =
      item.status === "CONFIRMED"
        ? button("Check in", () => transitionReservation(item, "check-in"))
        : button("Check out", () => transitionReservation(item, "check-out"));
    action.classList.add("reservation-action");
    row.append(action);
  }
  return row;
}

async function loadDashboard() {
  await fetchOwnerProperties();
  const select = byId("dashboardPropertySelect");
  const propertyId = populatePropertySelect(
    select,
    state.operationsPropertyId || select.value,
  );
  state.operationsPropertyId = propertyId || null;
  const dateInput = byId("dashboardDate");
  if (!dateInput.value) dateInput.value = localDate();
  if (!propertyId) {
    byId("dashboardMetrics").replaceChildren(
      textElement(
        "p",
        "empty-state card",
        "Register a hotel to open its operations dashboard.",
      ),
    );
    byId("dashboardReservationList").replaceChildren();
    return;
  }

  const base = `/v1/partner/organizations/${state.organizationId}/properties/${propertyId}`;
  const [summary, reservations] = await Promise.all([
    api(`${base}/reservations/operations-summary?date=${dateInput.value}`),
    api(
      reservationListPath(state.organizationId, propertyId, {
        startDate: dateInput.value,
        endDate: shiftDate(dateInput.value, 31),
        limit: 8,
      }),
    ),
  ]);
  const metrics = [
    ["Arrivals", summary.arrivals],
    ["Departures", summary.departures],
    ["In house", summary.inHouse],
    ["Upcoming", summary.upcoming],
    ["Awaiting payment", summary.paymentPending],
  ];
  const metricGrid = byId("dashboardMetrics");
  metricGrid.replaceChildren();
  for (const [label, value] of metrics) {
    const card = document.createElement("article");
    card.className = "metric-card";
    card.append(
      textElement("strong", "", value),
      textElement("span", "", label),
    );
    metricGrid.append(card);
  }
  const list = byId("dashboardReservationList");
  list.replaceChildren();
  if (!reservations.reservations.length) {
    list.append(
      textElement(
        "p",
        "empty-state",
        "No reservations overlap the next 30 days.",
      ),
    );
  }
  for (const reservation of reservations.reservations) {
    list.append(reservationRow(reservation, false));
  }
}

byId("dashboardPropertySelect").addEventListener("change", (event) => {
  state.operationsPropertyId = event.target.value || null;
  run(loadDashboard);
});
byId("dashboardDate").addEventListener("change", () => run(loadDashboard));
byId("openReservationsButton").addEventListener("click", () =>
  run(() => showScreen("reservations")),
);

async function loadControlCenter(append) {
  const dateInput = byId("controlCenterDate");
  if (!dateInput.value) dateInput.value = localDate();
  const form = byId("controlCenterFilters");
  const values = Object.fromEntries(new FormData(form));
  if (
    (values.startDate && !values.endDate) ||
    (!values.startDate && values.endDate)
  ) {
    throw new Error("Choose both stay dates or leave both empty.");
  }
  if (!append) {
    state.platformReservations = [];
    state.platformReservationCursor = null;
  }
  const [summary, page] = await Promise.all([
    api(`/v1/platform/reservations/operations-summary?date=${dateInput.value}`),
    api(
      platformReservationListPath({
        status: values.status,
        startDate: values.startDate,
        endDate: values.endDate,
        cursor: append ? state.platformReservationCursor : null,
        limit: 50,
      }),
    ),
  ]);
  state.platformReservations = append
    ? [...state.platformReservations, ...page.reservations]
    : page.reservations;
  state.platformReservationCursor = page.nextCursor;

  const metricGrid = byId("controlCenterMetrics");
  metricGrid.replaceChildren();
  for (const [label, value] of [
    ["Arrivals", summary.arrivals],
    ["Departures", summary.departures],
    ["In house", summary.inHouse],
    ["Upcoming", summary.upcoming],
    ["Awaiting payment", summary.paymentPending],
  ]) {
    const card = document.createElement("article");
    card.className = "metric-card";
    card.append(
      textElement("strong", "", value),
      textElement("span", "", label),
    );
    metricGrid.append(card);
  }
  renderControlCenterReservations();
}

function renderControlCenterReservations() {
  const list = byId("controlCenterReservationList");
  list.replaceChildren();
  if (!state.platformReservations.length) {
    list.append(
      textElement(
        "p",
        "empty-state card",
        "No reservations match these filters.",
      ),
    );
  }
  for (const reservation of state.platformReservations) {
    list.append(
      reservationRow(reservation, canManagePlatformReservations(state.session)),
    );
  }
  byId("loadMoreControlCenterReservations").classList.toggle(
    "hidden",
    !state.platformReservationCursor,
  );
}

byId("controlCenterDate").addEventListener("change", () =>
  run(() => loadControlCenter(false)),
);
byId("controlCenterFilters").addEventListener("submit", (event) => {
  event.preventDefault();
  run(() => loadControlCenter(false));
});
byId("loadMoreControlCenterReservations").addEventListener("click", () =>
  run(() => loadControlCenter(true)),
);

async function loadReservations(append) {
  const form = byId("reservationFilters");
  const propertySelect = byId("reservationPropertySelect");
  if (!append) {
    await fetchOwnerProperties();
    state.operationsPropertyId =
      populatePropertySelect(
        propertySelect,
        state.operationsPropertyId || propertySelect.value,
      ) || null;
    state.reservations = [];
    state.reservationCursor = null;
  }
  const values = Object.fromEntries(new FormData(form));
  state.operationsPropertyId = values.propertyId || null;
  if (!values.propertyId) {
    byId("reservationList").replaceChildren(
      textElement(
        "p",
        "empty-state card",
        "Register a hotel before managing reservations.",
      ),
    );
    return;
  }
  if (
    (values.startDate && !values.endDate) ||
    (!values.startDate && values.endDate)
  ) {
    throw new Error("Choose both stay dates or leave both empty.");
  }
  const result = await api(
    reservationListPath(state.organizationId, values.propertyId, {
      status: values.status,
      startDate: values.startDate,
      endDate: values.endDate,
      cursor: append ? state.reservationCursor : null,
      limit: 50,
    }),
  );
  state.reservations = append
    ? [...state.reservations, ...result.reservations]
    : result.reservations;
  state.reservationCursor = result.nextCursor;
  renderReservations();
}

function renderReservations() {
  const list = byId("reservationList");
  list.replaceChildren();
  if (!state.reservations.length) {
    list.append(
      textElement(
        "p",
        "empty-state card",
        "No reservations match these filters.",
      ),
    );
  }
  for (const reservation of state.reservations)
    list.append(reservationRow(reservation));
  byId("loadMoreReservations").classList.toggle(
    "hidden",
    !state.reservationCursor,
  );
}

byId("reservationFilters").addEventListener("submit", (event) => {
  event.preventDefault();
  run(() => loadReservations(false));
});
byId("loadMoreReservations").addEventListener("click", () =>
  run(() => loadReservations(true)),
);

async function transitionReservation(item, transition) {
  const organizationId = item.organizationId || state.organizationId;
  const propertyId = item.propertyId || byId("reservationPropertySelect").value;
  await api(
    `/v1/partner/organizations/${organizationId}/properties/${propertyId}/reservations/${item.id}/${transition}`,
    {
      method: "POST",
      idempotencyKey: newIdempotencyKey(`reservation-${transition}`),
    },
  );
  if (state.screen === "control") await loadControlCenter(false);
  else await loadReservations(false);
  showMessage(
    transition === "check-in" ? "Guest checked in." : "Guest checked out.",
  );
}

function populateRateWorkspaceSelectors() {
  const categories = state.operationsLayout?.roomCategories || [];
  const select = byId("ownerInventoryCategory");
  const previous = select.value;

  select.replaceChildren();

  for (const category of categories) {
    const option = textElement("option", "", category.name);
    option.value = category.id;
    select.append(option);
  }

  if (previous && categories.some((category) => category.id === previous)) {
    select.value = previous;
  }

  select.disabled = !categories.length;
}
async function loadCalendarWorkspace() {
  await fetchOwnerProperties();
  const propertySelect = byId("calendarPropertySelect");
  state.operationsPropertyId =
    populatePropertySelect(
      propertySelect,
      state.operationsPropertyId || propertySelect.value,
    ) || null;
  const form = byId("calendarFilters");
  if (!form.elements.startDate.value)
    form.elements.startDate.value = localDate();

  if (!form.elements.endDate.value) {
    setOwnerCalendarView(state.calendarViewDays);
  } else {
    syncOwnerCalendarViewButtons();
  }

  await refreshCalendarData();
}

async function refreshCalendarData() {
  const form = byId("calendarFilters");
  const values = Object.fromEntries(new FormData(form));

  state.operationsPropertyId = values.propertyId || null;

  if (!values.propertyId) {
    state.ownerRateCalendars = {};
    renderOperationsCalendar();
    return;
  }

  if (
    !values.startDate ||
    !values.endDate ||
    values.startDate >= values.endDate
  ) {
    throw new Error("Choose a valid calendar date range.");
  }

  syncOwnerCalendarViewButtons();

  const base = `/v1/partner/organizations/${state.organizationId}/properties/${values.propertyId}`;

  const [layout, plans, products, inventory] = await Promise.all([
    api(`${base}/layout`),
    api(`${base}/rates/plans`),
    api(`${base}/rates/products`),
    api(
      `${base}/inventory/availability?startDate=${values.startDate}&endDate=${values.endDate}`,
    ),
  ]);

  state.operationsLayout = layout;
  state.ratePlans = plans.ratePlans || [];
  state.rateProducts = products.rateProducts || [];
  state.inventoryCalendar = inventory;
  state.rateCalendar = null;

  populateRateWorkspaceSelectors();

  const categories = state.operationsLayout?.roomCategories || [];
  const activeEpPlanIds = new Set(
    state.ratePlans
      .filter((plan) => plan.mealPlanCode === "EP" && plan.status === "ACTIVE")
      .map((plan) => plan.id),
  );

  const loaded = await Promise.all(
    categories.map(async (category) => {
      const candidates = state.rateProducts.filter(
        (product) =>
          product.productType === "ROOM_CATEGORY" &&
          product.roomCategoryId === category.id &&
          product.status === "ACTIVE" &&
          activeEpPlanIds.has(product.ratePlanId),
      );

      if (candidates.length > 1) {
        return [
          category.id,
          {
            calendar: null,
            status: "AMBIGUOUS",
          },
        ];
      }

      if (!candidates.length) {
        return [
          category.id,
          {
            calendar: null,
            status: "MISSING",
          },
        ];
      }

      const product = candidates[0];
      const calendar = await api(
        `${base}/rates/products/${product.id}/calendar?startDate=${values.startDate}&endDate=${values.endDate}`,
      );

      return [
        category.id,
        {
          calendar,
          status: "READY",
        },
      ];
    }),
  );

  state.ownerRateCalendars = Object.fromEntries(loaded);
  renderOperationsCalendar();
}

async function configureOwnerCategoryBaseRate(categoryId, explicitRate = null) {
  const category = state.operationsLayout?.roomCategories?.find(
    (item) => item.id === categoryId,
  );

  if (!category) {
    throw new Error("Room category is no longer available.");
  }

  const input = byId("calendarGrid").querySelector(
    `input[data-owner-base-rate="${categoryId}"]`,
  );
  const rateValue = explicitRate ?? input?.value;

  if (rateValue === undefined || rateValue === null) {
    throw new Error(
      "Base rate input is no longer available. Refresh the calendar.",
    );
  }

  if (!String(rateValue).trim()) {
    throw new Error("Enter a base rate.");
  }

  const baseRateMinor = rupeesToMinor(rateValue);

  if (!Number.isSafeInteger(baseRateMinor) || baseRateMinor < 0) {
    throw new Error("Base rate must be a valid non-negative amount.");
  }

  const calendar = state.ownerRateCalendars[categoryId]?.calendar || null;

  const expectedVersion = calendar?.rateProduct?.version ?? null;

  const propertyId = byId("calendarPropertySelect").value;

  const fingerprint = [
    propertyId,
    categoryId,
    baseRateMinor,
    expectedVersion ?? "new",
  ].join(":");

  const key =
    pendingOwnerBaseRateKeys.get(fingerprint) ||
    newIdempotencyKey("owner-base-rate");

  pendingOwnerBaseRateKeys.set(fingerprint, key);

  await api(
    `/v1/partner/organizations/${state.organizationId}/properties/${propertyId}/rates/room-categories/${categoryId}/base-rate`,
    {
      method: "PUT",
      body: {
        baseRateMinor,
        expectedVersion,
      },
      idempotencyKey: key,
    },
  );

  await refreshCalendarData();

  pendingOwnerBaseRateKeys.delete(fingerprint);

  showMessage(`${category.name} base rate setup saved.`);
}

async function saveOwnerCategoryCalendar(categoryId) {
  return persistOwnerCategoryCalendar(categoryId, {
    refreshAfterSave: true,
    announce: true,
  });
}

async function persistOwnerCategoryCalendar(
  categoryId,
  { refreshAfterSave, announce },
) {
  const setup = state.ownerRateCalendars[categoryId];

  if (!setup?.calendar || setup.status !== "READY") {
    throw new Error("This room category is not ready for rate editing yet.");
  }

  const calendar = setup.calendar;
  const category = state.operationsLayout.roomCategories.find(
    (item) => item.id === categoryId,
  );

  if (!category) {
    throw new Error("Room category is no longer available.");
  }

  if (
    category.baseAdults === null ||
    category.baseChildren === null ||
    category.defaultExtraAdultMinor === null ||
    category.defaultExtraChildMinor === null
  ) {
    throw new Error(
      "Complete the room category guest and extra-charge defaults before editing rates.",
    );
  }

  const product = calendar.rateProduct;

  if (
    product.includedAdults !== category.baseAdults ||
    product.includedChildren !== category.baseChildren ||
    product.maxAdults !== category.maxAdults ||
    product.maxChildren !== category.maxChildren ||
    product.maxOccupancy !== category.maxOccupancy ||
    product.extraAdultMinor !== category.defaultExtraAdultMinor ||
    product.extraChildMinor !== category.defaultExtraChildMinor
  ) {
    throw new Error(
      "This category's existing rate setup must be synchronized with its room-category settings before rates can be saved.",
    );
  }

  const entries = calendar.days.map((day) => {
    const selectorBase = `input[data-category-id="${categoryId}"][data-stay-date="${day.stayDate}"]`;

    const baseInput = byId("calendarGrid").querySelector(
      `${selectorBase}[data-rate-field="base"]`,
    );
    const adultInput = byId("calendarGrid").querySelector(
      `${selectorBase}[data-rate-field="adult"]`,
    );
    const childInput = byId("calendarGrid").querySelector(
      `${selectorBase}[data-rate-field="child"]`,
    );

    if (!baseInput || !adultInput || !childInput) {
      throw new Error("The rate grid changed. Refresh before saving.");
    }

    const rateMinor = rupeesToMinor(baseInput.value);
    const extraAdultMinor = rupeesToMinor(adultInput.value);
    const extraChildMinor = rupeesToMinor(childInput.value);

    for (const amount of [rateMinor, extraAdultMinor, extraChildMinor]) {
      if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new Error("Rates must be valid non-negative amounts.");
      }
    }

    const storedExtraAdultMinor =
      extraAdultMinor === category.defaultExtraAdultMinor
        ? null
        : extraAdultMinor;

    const storedExtraChildMinor =
      extraChildMinor === category.defaultExtraChildMinor
        ? null
        : extraChildMinor;

    return {
      stayDate: day.stayDate,
      rateMinor,
      extraAdultMinor: storedExtraAdultMinor,
      extraChildMinor: storedExtraChildMinor,
      minimumStay: day.minimumStay,
      maximumStay: day.maximumStay,
      closedToArrival: day.closedToArrival,
      closedToDeparture: day.closedToDeparture,
      stopSell: day.stopSell,
      source: "MANUAL",
      expectedVersion: day.overrideVersion,
    };
  });

  const propertyId = byId("calendarPropertySelect").value;
  const fingerprint = [
    propertyId,
    categoryId,
    calendar.startDate,
    calendar.endDate,
    JSON.stringify(entries),
  ].join(":");

  const key =
    pendingRateCalendarSaveKeys.get(fingerprint) ||
    newIdempotencyKey("owner-rate-calendar-save");

  pendingRateCalendarSaveKeys.set(fingerprint, key);

  await api(
    `/v1/partner/organizations/${state.organizationId}/properties/${propertyId}/rates/products/${calendar.rateProduct.id}/calendar`,
    {
      method: "PUT",
      body: { entries },
      idempotencyKey: key,
    },
  );

  const scrollLeft = byId("calendarGrid").scrollLeft;

  if (refreshAfterSave) {
    await refreshCalendarData();
    byId("calendarGrid").scrollLeft = scrollLeft;
  }

  pendingRateCalendarSaveKeys.delete(fingerprint);

  if (announce) {
    showMessage(`${category.name} rates saved.`);
  }
}

function syncOwnerRateBulkForm(categories, dates) {
  const form = byId("ownerRateBulkForm");
  if (!form) return;

  const categorySelect = form.elements.roomCategoryId;
  const previousCategory = categorySelect.value || "ALL";

  categorySelect.replaceChildren();

  const allOption = document.createElement("option");
  allOption.value = "ALL";
  allOption.textContent = "All room categories";
  categorySelect.append(allOption);

  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    categorySelect.append(option);
  }

  categorySelect.value = categories.some(
    (category) => category.id === previousCategory,
  )
    ? previousCategory
    : "ALL";

  const orderedDates = [...dates].sort();

  if (!orderedDates.length) return;

  const firstDate = orderedDates[0];
  const lastDate = orderedDates[orderedDates.length - 1];

  const startInput = form.elements.startDate;
  const endInput = form.elements.endDate;

  startInput.min = firstDate;
  startInput.max = lastDate;
  endInput.min = firstDate;
  endInput.max = lastDate;

  if (
    !startInput.value ||
    startInput.value < firstDate ||
    startInput.value > lastDate
  ) {
    startInput.value = firstDate;
  }

  if (
    !endInput.value ||
    endInput.value < firstDate ||
    endInput.value > lastDate
  ) {
    endInput.value = lastDate;
  }
}

async function applyOwnerRateBulkUpdate() {
  const form = byId("ownerRateBulkForm");
  const values = Object.fromEntries(new FormData(form));

  const amountMinor = rupeesToMinor(values.amount);

  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error("Enter a valid non-negative amount.");
  }

  if (!["base", "adult", "child"].includes(values.rateField)) {
    throw new Error("Choose EP, Extra adult or Extra child.");
  }

  if (
    !values.startDate ||
    !values.endDate ||
    values.startDate > values.endDate
  ) {
    throw new Error("Choose a valid bulk-update date range.");
  }

  const loadedDates = (state.inventoryCalendar?.days || [])
    .map((day) => day.date)
    .sort();

  if (!loadedDates.length) {
    throw new Error("Load the rates calendar before using bulk update.");
  }

  const firstLoadedDate = loadedDates[0];
  const lastLoadedDate = loadedDates[loadedDates.length - 1];

  if (values.startDate < firstLoadedDate || values.endDate > lastLoadedDate) {
    throw new Error(
      "Bulk update can only change dates currently loaded in the calendar.",
    );
  }

  const selectedDates = loadedDates.filter(
    (date) => date >= values.startDate && date <= values.endDate,
  );

  if (!selectedDates.length) {
    throw new Error("No loaded calendar dates match this bulk update.");
  }

  const categories = state.operationsLayout?.roomCategories || [];

  const targetCategories =
    values.roomCategoryId === "ALL"
      ? categories
      : categories.filter((category) => category.id === values.roomCategoryId);

  if (!targetCategories.length) {
    throw new Error("Choose at least one room category.");
  }

  const allRateInputs = Array.from(
    byId("calendarGrid").querySelectorAll("input.owner-rate-input"),
  );

  const plans = [];

  // Validate every selected category before any API write.
  for (const category of targetCategories) {
    const setup = state.ownerRateCalendars[category.id];

    if (!setup?.calendar || setup.status !== "READY") {
      throw new Error(`${category.name} is not ready for bulk rate editing.`);
    }

    const inputs = allRateInputs.filter(
      (input) =>
        input.dataset.categoryId === category.id &&
        input.dataset.rateField === values.rateField &&
        selectedDates.includes(input.dataset.stayDate),
    );

    if (inputs.length !== selectedDates.length) {
      throw new Error(
        `${category.name} is not fully editable for the selected dates.`,
      );
    }

    plans.push({
      category,
      inputs,
    });
  }

  const amountValue = (amountMinor / 100).toFixed(2);

  // Update the visible calendar first.
  for (const plan of plans) {
    for (const input of plan.inputs) {
      input.value = amountValue;

      const display = input.closest("td")?.querySelector(".owner-rate-display");

      if (display) {
        display.textContent = amountValue;
      }
    }
  }

  let savedCount = 0;

  try {
    // Reuse the canonical category-calendar save path.
    // Do not refresh between categories because that would discard
    // pending bulk changes for categories not yet saved.
    for (const plan of plans) {
      await persistOwnerCategoryCalendar(plan.category.id, {
        refreshAfterSave: false,
        announce: false,
      });

      savedCount += 1;
    }
  } catch (error) {
    // Reconcile the UI with the server if a multi-category save
    // stops part way through.
    await refreshCalendarData();

    if (savedCount > 0) {
      throw new Error(
        `Bulk update stopped after ${savedCount} room ${
          savedCount === 1 ? "category" : "categories"
        } had already saved. The calendar has been refreshed. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    throw error;
  }

  await refreshCalendarData();

  showMessage(
    `Bulk update saved for ${savedCount} room ${
      savedCount === 1 ? "category" : "categories"
    }.`,
  );
}

async function saveOwnerInventoryCell(categoryId, stayDate, capacityOverride) {
  if (!Number.isSafeInteger(capacityOverride) || capacityOverride < 0) {
    throw new Error("Inventory must be a whole number of zero or more rooms.");
  }

  const propertyId = byId("calendarPropertySelect").value;
  const endDate = shiftDate(stayDate, 1);
  const fingerprint = [propertyId, categoryId, stayDate, capacityOverride].join(
    ":",
  );
  const key =
    pendingInventoryCellKeys.get(fingerprint) ||
    newIdempotencyKey("owner-inventory-cell");

  pendingInventoryCellKeys.set(fingerprint, key);

  const scrollLeft = byId("calendarGrid").scrollLeft;

  await api(
    `/v1/partner/organizations/${state.organizationId}/properties/${propertyId}/inventory/controls`,
    {
      method: "PUT",
      body: {
        bucketType: "ROOM_CATEGORY",
        roomCategoryId: categoryId,
        startDate: stayDate,
        endDate,
        capacityOverride,
        stopSell: false,
      },
      idempotencyKey: key,
    },
  );

  await refreshCalendarData();
  byId("calendarGrid").scrollLeft = scrollLeft;

  pendingInventoryCellKeys.delete(fingerprint);
  showMessage(`Inventory saved for ${stayDate}.`);
}

function renderOperationsCalendar() {
  const container = byId("calendarGrid");
  container.replaceChildren();

  const categories = state.operationsLayout?.roomCategories || [];
  const inventory = state.inventoryCalendar;

  if (!categories.length) {
    byId("calendarContext").textContent =
      "Create at least one room category before managing rates.";

    container.append(
      textElement("p", "empty-state", "No room categories are available."),
    );

    return;
  }

  const dates = inventory?.days?.map((day) => day.date) || [];

  if (!dates.length) {
    container.append(
      textElement("p", "empty-state", "No calendar dates are available."),
    );

    return;
  }

  syncOwnerRateBulkForm(categories, dates);

  byId("calendarContext").textContent =
    "Click any inventory or price cell to edit it. Use Earlier and Later to move through dates without a fixed limit.";

  const table = document.createElement("table");
  table.className = "operations-table owner-rate-grid";

  const head = document.createElement("thead");
  const header = document.createElement("tr");

  header.append(
    textElement("th", "owner-category-column", "Room category"),
    textElement("th", "owner-rate-type-column", "Type"),
  );

  for (const date of dates) {
    header.append(textElement("th", "owner-date-column", date));
  }

  head.append(header);

  const body = document.createElement("tbody");

  for (const category of categories) {
    const setup = state.ownerRateCalendars[category.id];
    const calendar = setup?.calendar || null;

    const defaultsReady =
      category.baseAdults !== null &&
      category.baseChildren !== null &&
      category.defaultExtraAdultMinor !== null &&
      category.defaultExtraChildMinor !== null;

    const productSynced =
      Boolean(calendar) &&
      defaultsReady &&
      calendar.rateProduct.includedAdults === category.baseAdults &&
      calendar.rateProduct.includedChildren === category.baseChildren &&
      calendar.rateProduct.maxAdults === category.maxAdults &&
      calendar.rateProduct.maxChildren === category.maxChildren &&
      calendar.rateProduct.maxOccupancy === category.maxOccupancy &&
      calendar.rateProduct.extraAdultMinor ===
        category.defaultExtraAdultMinor &&
      calendar.rateProduct.extraChildMinor === category.defaultExtraChildMinor;

    const categoryCell = document.createElement("td");
    categoryCell.className = "owner-category-cell";
    categoryCell.rowSpan = 4;

    categoryCell.append(textElement("strong", "", category.name));

    if (calendar && productSynced) {
      const saveButton = textElement(
        "button",
        "button-secondary owner-category-save",
        "Save",
      );

      saveButton.type = "button";
      saveButton.addEventListener("click", () =>
        run(() => saveOwnerCategoryCalendar(category.id)),
      );

      categoryCell.append(saveButton);
    } else if (!defaultsReady) {
      categoryCell.append(
        textElement(
          "small",
          "muted owner-rate-status",
          "Complete category defaults",
        ),
      );
    } else if (setup?.status === "AMBIGUOUS") {
      categoryCell.append(
        textElement(
          "small",
          "muted owner-rate-status",
          "Rate setup needs review",
        ),
      );
    } else {
      categoryCell.append(
        textElement(
          "small",
          "muted owner-rate-status",
          calendar ? "Sync category setup" : "Set base rate",
        ),
      );

      const setupBox = document.createElement("div");
      setupBox.className = "owner-base-rate-setup";

      const rateInput = document.createElement("input");
      rateInput.type = "number";
      rateInput.min = "0";
      rateInput.step = "0.01";
      rateInput.placeholder = "?";
      rateInput.dataset.ownerBaseRate = category.id;

      if (calendar) {
        rateInput.value = (calendar.rateProduct.baseRateMinor / 100).toFixed(2);
      }

      const setupButton = textElement(
        "button",
        "button-secondary owner-base-rate-button",
        calendar ? "Sync setup" : "Set base rate",
      );

      setupButton.type = "button";
      setupButton.addEventListener("click", () =>
        run(() => configureOwnerCategoryBaseRate(category.id)),
      );

      setupBox.append(rateInput, setupButton);

      categoryCell.append(setupBox);
    }

    const inventoryRow = document.createElement("tr");
    inventoryRow.append(categoryCell);
    inventoryRow.append(textElement("td", "owner-rate-type", "Inventory"));

    for (const date of dates) {
      const inventoryDay = inventory.days.find((day) => day.date === date);

      const availability = inventoryDay?.roomCategories.find(
        (item) => item.roomCategoryId === category.id,
      );

      const inventoryCell = document.createElement("td");
      inventoryCell.className = "quantity-cell owner-inventory-state";

      if (!availability) {
        inventoryCell.classList.add("owner-inventory-state-unknown");
        inventoryCell.textContent = "?";
      } else {
        const inventoryCapacity =
          availability.inventoryCapacity ?? availability.physicalCapacity;
        const committedQuantity =
          availability.heldQuantity + availability.confirmedQuantity;

        const input = document.createElement("input");
        input.type = "number";
        input.min = String(committedQuantity);
        input.max = "1000";
        input.step = "1";
        input.value = String(inventoryCapacity);
        input.className =
          "owner-inventory-input owner-inventory-editor-input hidden";
        input.dataset.categoryId = category.id;
        input.dataset.stayDate = date;

        const display = document.createElement("button");
        display.type = "button";
        display.className = "owner-inventory-display";
        display.title = "Click to edit total inventory";

        if (availability.stopSell) {
          inventoryCell.classList.add("owner-inventory-state-closed");
          display.textContent = "Closed";
        } else if (availability.sellableQuantity <= 0) {
          inventoryCell.classList.add("owner-inventory-state-sold-out");
          display.textContent = `0/${inventoryCapacity} Sold out`;
        } else {
          inventoryCell.classList.add("owner-inventory-state-available");
          display.textContent = `${availability.sellableQuantity}/${inventoryCapacity} Available`;
        }

        const beginEditing = () => {
          input.dataset.originalValue = input.value;
          display.classList.add("hidden");
          input.classList.remove("hidden");
          input.focus();
          input.select();
        };

        const finishEditing = () => {
          input.classList.add("hidden");
          display.classList.remove("hidden");
        };

        display.addEventListener("click", beginEditing);

        input.addEventListener("blur", () => {
          finishEditing();

          if (input.dataset.cancelled === "true") {
            delete input.dataset.cancelled;
            return;
          }

          const nextCapacity = Number(input.value);
          if (
            nextCapacity === inventoryCapacity &&
            availability.stopSell === false
          ) {
            return;
          }

          run(async () => {
            try {
              await saveOwnerInventoryCell(category.id, date, nextCapacity);
            } catch (error) {
              const scrollLeft = byId("calendarGrid").scrollLeft;
              await refreshCalendarData();
              byId("calendarGrid").scrollLeft = scrollLeft;
              throw error;
            }
          });
        });

        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            input.blur();
            return;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            input.value = input.dataset.originalValue ?? input.value;
            input.dataset.cancelled = "true";
            input.blur();
          }
        });

        inventoryCell.classList.add("owner-inventory-editable-cell");
        inventoryCell.append(display, input);
      }

      inventoryRow.append(inventoryCell);
    }

    body.append(inventoryRow);

    const rows = [
      ["EP", "base"],
      ["Extra adult", "adult"],
      ["Extra child", "child"],
    ];

    for (const [label, field] of rows) {
      const row = document.createElement("tr");
      row.append(textElement("td", "owner-rate-type", label));

      dates.forEach((date) => {
        const cell = document.createElement("td");
        const day = calendar?.days?.find((item) => item.stayDate === date);

        if (!day || !productSynced) {
          if (
            field === "base" &&
            defaultsReady &&
            setup?.status !== "AMBIGUOUS"
          ) {
            const input = document.createElement("input");
            input.type = "number";
            input.min = "0";
            input.step = "0.01";
            input.placeholder = "Enter rate";
            input.className = "owner-rate-input owner-rate-editor-input hidden";

            const display = document.createElement("button");
            display.type = "button";
            display.className = "owner-rate-display owner-rate-setup-display";
            display.textContent = "Set";
            display.title = "Click to set the starting EP rate";

            display.addEventListener("click", () => {
              display.classList.add("hidden");
              input.classList.remove("hidden");
              input.focus();
              input.select();
            });

            input.addEventListener("blur", () => {
              input.classList.add("hidden");
              display.classList.remove("hidden");

              if (!input.value.trim()) return;

              run(() =>
                configureOwnerCategoryBaseRate(category.id, input.value),
              );
            });

            input.addEventListener("keydown", (event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                input.blur();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                input.value = "";
                input.blur();
              }
            });

            cell.classList.add("owner-rate-editable-cell");
            cell.append(display, input);
          } else {
            cell.append(
              textElement(
                "span",
                "muted",
                defaultsReady ? "Set EP first" : "Complete setup",
              ),
            );
          }
          row.append(cell);
          return;
        }

        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.step = "0.01";
        input.className = "owner-rate-input owner-rate-editor-input hidden";
        input.dataset.categoryId = category.id;
        input.dataset.stayDate = date;
        input.dataset.rateField = field;

        const minor =
          field === "base"
            ? day.rateMinor
            : field === "adult"
              ? day.extraAdultMinor
              : day.extraChildMinor;

        input.value = (minor / 100).toFixed(2);

        const display = document.createElement("button");
        display.type = "button";
        display.className = "owner-rate-display";
        display.textContent = input.value;
        display.title = "Click to edit";

        const beginEditing = () => {
          input.dataset.originalValue = input.value;
          display.classList.add("hidden");
          input.classList.remove("hidden");
          input.focus();
          input.select();
        };

        const finishEditing = () => {
          display.textContent = input.value || "0.00";
          input.classList.add("hidden");
          display.classList.remove("hidden");
        };

        display.addEventListener("click", beginEditing);

        input.addEventListener("blur", () => {
          finishEditing();

          if (input.dataset.cancelled === "true") {
            delete input.dataset.cancelled;
            return;
          }

          if (input.value === input.dataset.originalValue) return;

          run(async () => {
            try {
              await saveOwnerCategoryCalendar(category.id);
            } catch (error) {
              const scrollLeft = byId("calendarGrid").scrollLeft;
              await refreshCalendarData();
              byId("calendarGrid").scrollLeft = scrollLeft;
              throw error;
            }
          });
        });

        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            input.blur();
            return;
          }

          if (event.key === "Escape") {
            event.preventDefault();

            if (input.dataset.originalValue !== undefined) {
              input.value = input.dataset.originalValue;
            }

            input.dataset.cancelled = "true";
            input.blur();
          }
        });

        cell.classList.add("owner-rate-editable-cell");
        cell.append(display, input);
        row.append(cell);
      });

      body.append(row);
    }
  }

  table.append(head, body);
  container.append(table);
}

byId("calendarFilters").addEventListener("submit", (event) => {
  event.preventDefault();
  run(refreshCalendarData);
});

byId("ownerRateBulkForm").addEventListener("submit", (event) => {
  event.preventDefault();
  run(applyOwnerRateBulkUpdate);
});

document.querySelectorAll("[data-calendar-view-days]").forEach((button) => {
  button.addEventListener("click", () =>
    run(async () => {
      setOwnerCalendarView(Number(button.dataset.calendarViewDays));
      await refreshCalendarData();
    }),
  );
});

byId("previousCalendarWindow").addEventListener("click", () =>
  run(async () => {
    moveOwnerCalendarWindow(-1);
    await refreshCalendarData();
    byId("calendarGrid").scrollLeft = byId("calendarGrid").scrollWidth;
  }),
);

byId("nextCalendarWindow").addEventListener("click", () =>
  run(async () => {
    moveOwnerCalendarWindow(1);
    await refreshCalendarData();
    byId("calendarGrid").scrollLeft = 0;
  }),
);

byId("todayCalendarWindow").addEventListener("click", () =>
  run(async () => {
    moveOwnerCalendarToToday();
    await refreshCalendarData();
  }),
);

byId("calendarFilters").elements.startDate.addEventListener("change", () => {
  setOwnerCalendarView(state.calendarViewDays);
});

byId("calendarFilters").elements.endDate.addEventListener(
  "change",
  syncOwnerCalendarViewButtons,
);

byId("calendarPropertySelect").addEventListener("change", (event) => {
  state.operationsPropertyId = event.target.value || null;
  run(refreshCalendarData);
});
byId("ownerInventoryControlForm").addEventListener("submit", (event) => {
  event.preventDefault();

  run(async () => {
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const filters = Object.fromEntries(new FormData(byId("calendarFilters")));

    if (!values.roomCategoryId) {
      throw new Error("Choose a room category.");
    }

    const body = {
      bucketType: "ROOM_CATEGORY",
      roomCategoryId: values.roomCategoryId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      stopSell: values.stopSell === "on",
    };

    const fingerprint = [
      filters.propertyId,
      values.roomCategoryId,
      filters.startDate,
      filters.endDate,
      body.stopSell,
    ].join(":");

    const key =
      pendingInventoryControlKeys.get(fingerprint) ||
      newIdempotencyKey("owner-inventory-control");

    pendingInventoryControlKeys.set(fingerprint, key);

    await api(
      `/v1/partner/organizations/${state.organizationId}/properties/${filters.propertyId}/inventory/controls`,
      {
        method: "PUT",
        body,
        idempotencyKey: key,
      },
    );

    await refreshCalendarData();

    pendingInventoryControlKeys.delete(fingerprint);
    showMessage("Availability updated.");
  });
});

byId("reviewStatus").addEventListener("change", () =>
  run(() => loadReviews(false)),
);
byId("loadMoreReviews").addEventListener("click", () =>
  run(() => loadReviews(true)),
);

async function loadReviews(append) {
  const cursor = append ? state.reviewCursor : null;
  const data = await api(reviewQueuePath(byId("reviewStatus").value, cursor));
  state.reviewItems = append
    ? [...state.reviewItems, ...data.items]
    : data.items;
  state.reviewCursor = data.nextCursor;
  byId("loadMoreReviews").classList.toggle("hidden", !state.reviewCursor);
  renderReviewList();
}

function renderReviewList() {
  const list = byId("reviewList");
  list.replaceChildren();
  if (!state.reviewItems.length) {
    list.append(
      textElement(
        "p",
        "empty-state card",
        "No properties match this review status.",
      ),
    );
    return;
  }
  for (const item of state.reviewItems) {
    const card = document.createElement("article");
    card.className = "review-card";
    const copy = document.createElement("div");
    copy.append(textElement("h3", "", item.propertyName));
    copy.append(
      textElement(
        "p",
        "",
        item.organizationTradingName || item.organizationLegalName,
      ),
    );
    copy.append(
      textElement(
        "p",
        "",
        [item.city, item.stateRegion, item.countryCode]
          .filter(Boolean)
          .join(", "),
      ),
    );
    copy.append(
      textElement("span", "status-pill", item.status.replaceAll("_", " ")),
    );
    card.append(
      copy,
      button("Open review", () => openReview(item)),
    );
    list.append(card);
  }
}

async function openReview(item) {
  state.reviewSelection = item;
  state.onboarding = await api(
    `/v1/partner/organizations/${item.organizationId}/properties/${item.propertyId}/onboarding`,
  );
  renderReviewDetail();
}

function renderReviewDetail() {
  const item = state.reviewSelection;
  const onboarding = state.onboarding;
  const panel = byId("reviewDetail");
  panel.replaceChildren();
  panel.append(textElement("p", "eyebrow", "Review record"));
  panel.append(textElement("h3", "", item.propertyName));
  panel.append(
    textElement(
      "span",
      "status-pill",
      onboarding.property.status.replaceAll("_", " "),
    ),
  );

  const meta = document.createElement("div");
  meta.className = "detail-meta";
  meta.append(
    textElement("span", "", `Business: ${item.organizationLegalName}`),
  );
  meta.append(
    textElement(
      "span",
      "",
      `Submission: ${onboarding.property.submissionSequence}`,
    ),
  );
  meta.append(
    textElement("span", "", `Version: ${onboarding.property.version}`),
  );
  meta.append(
    textElement(
      "span",
      "",
      `Checklist: ${onboarding.checklist.readyToSubmit ? "complete" : "incomplete"}`,
    ),
  );
  panel.append(meta);

  panel.append(textElement("h3", "", "Compliance documents"));
  if (!onboarding.documents.length)
    panel.append(textElement("p", "muted", "No documents registered."));
  for (const documentRecord of onboarding.documents) {
    const row = document.createElement("div");
    row.className = "document-row";
    row.append(textElement("strong", "", documentRecord.originalFilename));
    row.append(
      textElement(
        "p",
        "muted",
        `${documentRecord.documentType} · ${documentRecord.verificationStatus}`,
      ),
    );
    const actions = document.createElement("div");
    actions.className = "document-actions";
    actions.append(
      button(
        "View private PDF",
        () => openReviewDocument(documentRecord.id),
        "button-secondary",
      ),
    );
    if (onboarding.property.status === "UNDER_REVIEW") {
      actions.append(
        button("Verify", () => reviewDocument(documentRecord.id, "VERIFIED")),
        button(
          "Reject",
          () => reviewDocument(documentRecord.id, "REJECTED"),
          "danger-button",
        ),
      );
    }
    row.append(actions);
    panel.append(row);
  }

  const reasonLabel = textElement("label", "", "Decision notes");
  const reason = document.createElement("textarea");
  reason.id = "reviewReason";
  reason.maxLength = 5000;
  reason.placeholder = "Required context for the hotel owner";
  reasonLabel.append(reason);
  panel.append(reasonLabel);

  const actions = document.createElement("div");
  actions.className = "review-actions";
  const status = onboarding.property.status;
  if (status === "SUBMITTED")
    actions.append(button("Start review", startReview));
  if (status === "UNDER_REVIEW") {
    actions.append(
      button("Approve property", () => decideReview("APPROVED")),
      button(
        "Request changes",
        () => decideReview("CHANGES_REQUIRED"),
        "danger-button",
      ),
    );
  }
  if (status === "APPROVED")
    actions.append(button("Activate listing", activateProperty));
  panel.append(actions);
}

async function openReviewDocument(documentId) {
  const viewer = window.open("about:blank", "_blank");
  if (viewer) viewer.opener = null;
  try {
    const result = await api(
      `/v1/platform/properties/${state.reviewSelection.propertyId}/documents/${documentId}/read-url`,
    );
    if (viewer) viewer.location.replace(result.url);
    else window.location.assign(result.url);
  } catch (error) {
    if (viewer) viewer.close();
    throw error;
  }
}

function reviewReason() {
  return byId("reviewReason")?.value.trim() || undefined;
}

async function reviewDocument(documentId, decision) {
  await idempotent(
    `/v1/platform/properties/${state.reviewSelection.propertyId}/documents/${documentId}/review`,
    "POST",
    "document-review",
    { decision, ...(reviewReason() ? { reason: reviewReason() } : {}) },
  );
  await refreshReviewSelection("Document review saved.");
}

async function startReview() {
  await idempotent(
    `/v1/platform/properties/${state.reviewSelection.propertyId}/review/start`,
    "POST",
    "review-start",
    { version: state.onboarding.property.version },
  );
  await refreshReviewSelection("Review started.");
}

async function decideReview(decision) {
  await idempotent(
    `/v1/platform/properties/${state.reviewSelection.propertyId}/review/decision`,
    "POST",
    "review-decision",
    {
      version: state.onboarding.property.version,
      decision,
      ...(reviewReason() ? { reason: reviewReason() } : {}),
    },
  );
  await refreshReviewSelection(
    decision === "APPROVED" ? "Property approved." : "Changes requested.",
  );
}

async function activateProperty() {
  await idempotent(
    `/v1/platform/properties/${state.reviewSelection.propertyId}/activate`,
    "POST",
    "property-activate",
    { version: state.onboarding.property.version },
  );
  await loadReviews(false);
  byId("reviewDetail").replaceChildren(
    textElement(
      "p",
      "empty-state",
      "Property activated and removed from the active review queue.",
    ),
  );
  showMessage("Property is now live.");
}

async function refreshReviewSelection(message) {
  await loadReviews(false);
  const refreshed = state.reviewItems.find(
    (item) => item.propertyId === state.reviewSelection.propertyId,
  );
  if (refreshed) await openReview(refreshed);
  showMessage(message);
}

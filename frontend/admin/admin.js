import {
  authorizedRequest,
  newIdempotencyKey,
  uploadFile,
} from "./api-client.js";
import {
  GUEST_DISPLAY_CATALOG,
  PROPERTY_AMENITY_GROUPS,
  ROOM_AMENITY_GROUPS,
} from "./amenity-catalog.js";
import {
  availableScreens,
  canManageHomepageContent,
  canManagePlatformReservations,
  canReviewProperties,
  editableProperty,
  platformReservationListPath,
  profilePayload,
  reservationListPath,
  reviewQueuePath,
  sessionOrganizationId,
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
  commercial: null,
  hotelGst: null,
  ownerResponsibility: null,
  platformGstRules: [],
  editorRatePlans: [],
  selectedCancellationPolicyId: null,
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
  homepageContent: {
    heroSlides: [],
    destinationImages: [],
    liveDestinations: [],
  },
  propertyTaxonomy: {
    categories: [],
    types: [],
  },
  authGeneration: 0,
  authenticatedUid: null,
  reviewFilterTouched: false,
};

const byId = (id) => document.getElementById(id);
const authView = byId("authView");
const portal = byId("portal");
const portalMessage = byId("portalMessage");
const sessionLoading = byId("sessionLoading");
let portalMessageTimer = null;

class StaleSessionError extends Error {
  constructor() {
    super("A newer authenticated session replaced this request.");
    this.name = "StaleSessionError";
  }
}

function captureAuthContext() {
  const user = auth.currentUser;
  return {
    user,
    uid: user?.uid || null,
    generation: state.authGeneration,
  };
}

function assertCurrentAuthContext(context) {
  if (
    context.generation !== state.authGeneration ||
    context.uid !== state.authenticatedUid ||
    context.uid !== (auth.currentUser?.uid || null)
  ) {
    throw new StaleSessionError();
  }
}

function resetPortalSessionState() {
  Object.assign(state, {
    session: null,
    screen: null,
    organizationId: null,
    properties: [],
    property: null,
    onboarding: null,
    layout: null,
    commercial: null,
    hotelGst: null,
    ownerResponsibility: null,
    editorRatePlans: [],
    reservations: [],
    reservationCursor: null,
    operationsPropertyId: null,
    ratePlans: [],
    rateProducts: [],
    rateCalendar: null,
    ownerRateCalendars: {},
    inventoryCalendar: null,
    operationsLayout: null,
    platformReservations: [],
    platformReservationCursor: null,
    reviewItems: [],
    reviewCursor: null,
    reviewSelection: null,
    reviewFilterTouched: false,
  });
  clearMessage();
  document
    .querySelectorAll(".screen")
    .forEach((screen) => screen.classList.add("hidden"));
  document
    .querySelectorAll(".nav")
    .forEach((item) => item.classList.add("hidden"));
  for (const id of [
    "propertyList",
    "propertyPortfolioSummary",
    "dashboardMetrics",
    "dashboardReservationList",
    "reservationList",
    "calendarGrid",
    "controlCenterMetrics",
    "controlCenterReservationList",
    "hotelDirectoryList",
    "reviewList",
    "reviewDetail",
  ]) {
    byId(id)?.replaceChildren();
  }
  byId("organizationSelect")?.replaceChildren();
  if (byId("reviewStatus")) byId("reviewStatus").value = "";
  if (byId("reviewQueueContext")) byId("reviewQueueContext").textContent = "";
  byId("accountEmail").textContent = "";
  byId("roleLabel").textContent = "";
}

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

async function api(path, options = {}) {
  const context = captureAuthContext();
  try {
    const result = await authorizedRequest(path, {
      ...options,
      getAccessToken: async () => context.user?.getIdToken(),
    });
    assertCurrentAuthContext(context);
    return result;
  } catch (error) {
    assertCurrentAuthContext(context);
    throw error;
  }
}

function idempotent(path, method, operation, body = {}) {
  return api(path, {
    method,
    body,
    idempotencyKey: newIdempotencyKey(operation),
  });
}

function taxonomyCategoryById(categoryId) {
  return (state.propertyTaxonomy.categories || []).find(
    (category) => category.id === categoryId,
  );
}

function taxonomyTypeById(typeId) {
  return (state.propertyTaxonomy.types || []).find(
    (propertyType) => propertyType.id === typeId,
  );
}

function taxonomyTypesForCategory(
  categoryId,
  { includeDisabled = false } = {},
) {
  return (state.propertyTaxonomy.types || [])
    .filter(
      (propertyType) =>
        propertyType.categoryId === categoryId &&
        (includeDisabled || propertyType.enabled),
    )
    .sort(
      (left, right) =>
        Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
        left.name.localeCompare(right.name),
    );
}

function populateTaxonomyCategorySelect(
  select,
  selectedId = "",
  { includeDisabled = false, placeholder = "Select category" } = {},
) {
  const categories = (state.propertyTaxonomy.categories || [])
    .filter((category) => includeDisabled || category.enabled)
    .sort(
      (left, right) =>
        Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
        left.name.localeCompare(right.name),
    );

  select.replaceChildren();
  const placeholderOption = textElement("option", "", placeholder);
  placeholderOption.value = "";
  select.append(placeholderOption);

  for (const category of categories) {
    const option = textElement(
      "option",
      "",
      `${category.name}${category.enabled ? "" : " (disabled)"}`,
    );
    option.value = category.id;
    option.selected = category.id === selectedId;
    select.append(option);
  }

  select.disabled = categories.length === 0;
  if (selectedId && categories.some((category) => category.id === selectedId)) {
    select.value = selectedId;
  }
}

function populateTaxonomyTypeSelect(
  select,
  categoryId,
  selectedId = "",
  { includeDisabled = false } = {},
) {
  const types = categoryId
    ? taxonomyTypesForCategory(categoryId, { includeDisabled })
    : [];

  select.replaceChildren();
  const placeholder = textElement(
    "option",
    "",
    categoryId ? "Select property type" : "Select category first",
  );
  placeholder.value = "";
  select.append(placeholder);

  for (const propertyType of types) {
    const option = textElement(
      "option",
      "",
      `${propertyType.name}${propertyType.enabled ? "" : " (disabled)"}`,
    );
    option.value = propertyType.id;
    option.selected = propertyType.id === selectedId;
    select.append(option);
  }

  select.disabled = !categoryId || types.length === 0;
  if (
    selectedId &&
    types.some((propertyType) => propertyType.id === selectedId)
  ) {
    select.value = selectedId;
  }
}

async function loadPublicPropertyTaxonomy() {
  const data = await api("/v1/public/property-taxonomy");
  state.propertyTaxonomy = {
    categories: data.categories || [],
    types: data.types || [],
  };
  return state.propertyTaxonomy;
}

async function loadAdminPropertyTaxonomy() {
  const data = await api("/v1/platform/property-taxonomy");
  state.propertyTaxonomy = {
    categories: data.categories || [],
    types: data.types || [],
  };
  return state.propertyTaxonomy;
}

function renderCreatePropertyTaxonomyFields() {
  const form = byId("createPropertyForm");
  if (!form) return;
  const categorySelect = form.elements.propertyCategoryId;
  const typeSelect = form.elements.propertyTypeId;
  const selectedCategory = categorySelect.value;
  const selectedType = typeSelect.value;
  populateTaxonomyCategorySelect(categorySelect, selectedCategory);
  populateTaxonomyTypeSelect(typeSelect, categorySelect.value, selectedType);
}

function renderProfilePropertyTaxonomyFields(property) {
  const form = byId("profileForm");
  const categoryId = property.propertyCategoryId || "";
  const typeId = property.propertyTypeId || "";
  populateTaxonomyCategorySelect(form.elements.propertyCategoryId, categoryId);
  populateTaxonomyTypeSelect(form.elements.propertyTypeId, categoryId, typeId);
}

function propertyTaxonomyLabel(property) {
  const category = taxonomyCategoryById(property.propertyCategoryId);
  const propertyType = taxonomyTypeById(property.propertyTypeId);
  return [category?.name, propertyType?.name].filter(Boolean).join(" · ");
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
  const context = captureAuthContext();
  try {
    const result = await uploadFile(path, file, {
      idempotencyKey: key,
      getAccessToken: async () => context.user?.getIdToken(),
    });
    assertCurrentAuthContext(context);
    pendingUploadKeys.delete(fingerprint);
    return result;
  } catch (error) {
    assertCurrentAuthContext(context);
    throw error;
  }
}

async function optimizeRoomPhoto(file) {
  if (
    !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)
  ) {
    throw new Error(`"${file.name}" must be a JPG, PNG, WebP or AVIF image.`);
  }

  const bitmap = await createImageBitmap(file);
  try {
    const maximumDimension = 2048;
    const scale = Math.min(
      1,
      maximumDimension / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("This browser cannot optimize room photos.");
    context.drawImage(bitmap, 0, 0, width, height);
    const optimizedBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("The room photo could not be optimized.")),
        "image/webp",
        0.82,
      );
    });

    if (optimizedBlob.size >= file.size && file.size <= 8 * 1024 * 1024) {
      return file;
    }
    const baseName = file.name.replace(/\.[^.]+$/, "") || "room-photo";
    return new File([optimizedBlob], `${baseName}.webp`, {
      type: "image/webp",
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
}

async function uploadPhysicalUnitPhotos(
  physicalUnitId,
  files,
  { altText = "", caption = "" } = {},
) {
  const query = new URLSearchParams();
  if (altText) query.set("altText", altText);
  if (caption) query.set("caption", caption);
  const queryString = query.toString();

  for (const [index, original] of files.entries()) {
    const file = await optimizeRoomPhoto(original);
    if (file.size > 8 * 1024 * 1024) {
      throw new Error(`"${original.name}" remains larger than 8 MB.`);
    }
    const perPhotoQuery = new URLSearchParams(query);
    perPhotoQuery.set("sortOrder", String(index));
    await managedUpload(
      `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/units/${physicalUnitId}/uploads/images?${perPhotoQuery.toString() || queryString}`,
      file,
      `physical-room-image-${physicalUnitId}-${index}`,
    );
  }
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

function editorAccordionItem(sectionKey, title) {
  const details = document.createElement("details");
  details.className = "editor-accordion-item";
  details.dataset.editorAccordion = sectionKey;

  const summary = document.createElement("summary");
  const heading = textElement("span", "editor-accordion-title", title);
  const status = textElement("span", "editor-section-status", "Not started");
  status.id = `editorSectionStatus-${sectionKey}`;
  summary.append(heading, status);

  const content = document.createElement("div");
  content.className = "editor-accordion-content";
  details.append(summary, content);

  details.addEventListener("toggle", () => {
    if (!details.open) return;

    document
      .querySelectorAll("[data-editor-accordion]")
      .forEach((candidate) => {
        if (candidate !== details) candidate.open = false;
      });
  });

  return { details, content };
}

function editorSubpanel(id, label, contentNode) {
  const details = document.createElement("details");
  details.id = id;
  details.className = "editor-subpanel";
  details.append(textElement("summary", "", label));

  const content = document.createElement("div");
  content.className = "editor-subpanel-content";
  content.append(contentNode);
  details.append(content);
  return details;
}

function setupPropertyEditorWorkspace() {
  const root = document.querySelector("#editorScreen .editor-grid");
  if (!root || root.dataset.workspaceReady === "true") return;

  const profileForm = byId("profileForm");
  const checklistCard = byId("checklist").closest("aside");
  const roomCategoryForm = byId("roomCategoryForm");
  const categoryPhotoForm = byId("roomCategoryImageUploadForm");
  const locationDetails = document.querySelector(".room-location-details");
  const physicalUnitForm = byId("physicalUnitForm");
  const categoryList = byId("accommodationList");
  const policiesForm = byId("policiesForm");
  const commercialRulesForm = byId("commercialRulesForm");
  const amenitiesForm = byId("amenitiesForm");
  const assetSection = byId("imageUploadForm").closest("section");

  if (
    !profileForm ||
    !checklistCard ||
    !roomCategoryForm ||
    !categoryPhotoForm ||
    !locationDetails ||
    !physicalUnitForm ||
    !categoryList ||
    !policiesForm ||
    !commercialRulesForm ||
    !amenitiesForm ||
    !assetSection
  ) {
    return;
  }

  root.dataset.workspaceReady = "true";
  root.className = "editor-workspace";

  for (const panel of [
    profileForm,
    policiesForm,
    commercialRulesForm,
    amenitiesForm,
    assetSection,
    checklistCard,
  ]) {
    panel.classList.remove("card", "span-editor", "checklist-card");
    panel.classList.add("editor-panel-body");
  }

  for (const form of [roomCategoryForm, categoryPhotoForm, physicalUnitForm]) {
    form.classList.add("editor-form-surface");
  }

  const progress = document.createElement("section");
  progress.className = "editor-progress-card";
  const progressCopy = document.createElement("div");
  progressCopy.append(
    textElement("span", "editor-progress-kicker", "Property setup"),
    textElement("strong", "", "Complete one section at a time"),
    textElement(
      "span",
      "muted",
      "Your existing information is preserved as you move between sections.",
    ),
  );
  const progressStatus = document.createElement("div");
  progressStatus.className = "editor-progress-status";
  const progressText = textElement("strong", "", "0 of 7 complete");
  progressText.id = "editorProgressText";
  const progressTrack = document.createElement("div");
  progressTrack.className = "editor-progress-track";
  const progressBar = document.createElement("span");
  progressBar.id = "editorProgressBar";
  progressTrack.append(progressBar);
  progressStatus.append(progressText, progressTrack);
  progress.append(progressCopy, progressStatus);

  const accordion = document.createElement("div");
  accordion.className = "editor-accordion";

  const profile = editorAccordionItem("profile", "Property profile");
  profile.content.append(profileForm);

  const categories = editorAccordionItem("categories", "Room categories");
  const categoryIntro = document.createElement("div");
  categoryIntro.className = "editor-panel-intro";
  categoryIntro.append(
    textElement("h3", "", "Your room categories"),
    textElement(
      "p",
      "muted",
      "Create each sellable category once, set its room count, shared facilities and optional channel identities.",
    ),
  );
  categories.content.append(
    categoryIntro,
    categoryList,
    editorSubpanel(
      "roomCategoryCreatePanel",
      "Add a room category",
      roomCategoryForm,
    ),
    editorSubpanel(
      "roomCategoryPhotosPanel",
      "Manage room category photos",
      categoryPhotoForm,
    ),
  );

  // Category count and optional channel identities are now the owner-facing
  // inventory workflow. Keep the older individual-room controls in the DOM so
  // existing render and migration code can still synchronize their values,
  // but do not expose a second, competing room-creation experience.
  const legacyAccommodationControls = document.createElement("div");
  legacyAccommodationControls.id = "legacyAccommodationControls";
  legacyAccommodationControls.hidden = true;
  legacyAccommodationControls.setAttribute("aria-hidden", "true");
  const physicalRoomHeading = document.createElement("div");
  physicalRoomHeading.className = "editor-list-heading";
  physicalRoomHeading.append(textElement("h3", "", "Existing rooms"));
  const physicalRoomList = document.createElement("div");
  physicalRoomList.id = "physicalRoomList";
  physicalRoomList.className = "physical-room-card-list";
  legacyAccommodationControls.append(
    physicalUnitForm,
    locationDetails,
    physicalRoomHeading,
    physicalRoomList,
  );

  const policies = editorAccordionItem("policies", "Policies and house rules");
  policies.content.append(policiesForm);

  const commercial = editorAccordionItem(
    "commercial",
    "Booking rules and charges",
  );
  commercial.content.append(commercialRulesForm);

  const amenities = editorAccordionItem("amenities", "Property amenities");
  amenities.content.append(amenitiesForm);

  const assets = editorAccordionItem("assets", "Photos and documents");
  assets.content.append(assetSection);

  const review = editorAccordionItem("review", "Review and publishing");
  review.content.append(checklistCard);

  accordion.append(
    profile.details,
    categories.details,
    policies.details,
    commercial.details,
    amenities.details,
    assets.details,
    review.details,
  );

  root.replaceChildren(progress, accordion, legacyAccommodationControls);
}

setupPropertyEditorWorkspace();

// Presentation-only disclosure panels: retain every existing form, ID and listener.
function setupHomepageDisclosurePanels() {
  const root = document.querySelector("#homepageScreen .homepage-manager-grid");
  if (!root || root.dataset.disclosuresReady === "true") return;
  root.dataset.disclosuresReady = "true";

  const cards = [...root.children].filter((item) =>
    item.matches("section.homepage-manager-card"),
  );
  for (const [index, card] of cards.entries()) {
    const title =
      card.querySelector("h3")?.textContent?.trim() ||
      `Content section ${index + 1}`;
    const description =
      card.querySelector(".card-heading .muted")?.textContent?.trim() || "";
    const details = document.createElement("details");
    details.className = "partner-disclosure";
    const summary = document.createElement("summary");
    const heading = document.createElement("span");
    heading.className = "partner-disclosure-heading";
    heading.textContent = title;
    const subheading = document.createElement("span");
    subheading.className = "partner-disclosure-description";
    subheading.textContent = description;
    const label = document.createElement("span");
    label.className = "partner-disclosure-label";
    label.append(heading, subheading);
    summary.append(label);
    details.append(summary);
    card.replaceWith(details);
    details.append(card);
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      root.querySelectorAll("details.partner-disclosure").forEach((other) => {
        if (other !== details) other.open = false;
      });
    });
  }
}

setupHomepageDisclosurePanels();

/* Command Center UI only: move existing nodes, never duplicate forms or permissions. */
function setupCommandCenterWorkspaces() {
  const screen = byId("controlScreen");
  if (!screen || screen.dataset.commandReady === "true") return;
  screen.dataset.commandReady = "true";
  const intro = screen.querySelector(".section-intro");
  if (intro) intro.classList.add("command-intro-compact");
  const title = screen.querySelector(".section-intro h2");
  if (title) title.textContent = "Wildleaf Command Center";
  const metrics = byId("controlCenterMetrics");
  const gst = byId("platformGstRulesCard");
  const filters = byId("controlCenterFilters");
  const list = byId("controlCenterReservationList");
  const more = byId("loadMoreControlCenterReservations");
  if (!metrics || !gst || !filters || !list || !more) return;

  function workspace(label, description, nodes) {
    const details = document.createElement("details");
    details.className = "command-workspace";
    const summary = document.createElement("summary");
    const title = textElement("strong", "", label);
    const caption = textElement("small", "", description);
    const copy = document.createElement("span");
    copy.className = "command-workspace-copy";
    copy.append(title, caption);
    summary.append(copy);
    const body = document.createElement("div");
    body.className = "command-workspace-body";
    nodes[0].before(details);
    body.append(...nodes);
    details.append(summary, body);
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      screen.querySelectorAll(".command-workspace").forEach((other) => {
        if (other !== details) other.open = false;
      });
    });
    return details;
  }

  workspace(
    "All reservations",
    "Search all properties, review booking statuses and manage guest movements",
    [filters, list, more],
  );
  workspace(
    "Platform GST & statutory settings",
    "Super-admin configuration · open only when needed",
    [gst],
  );

  const quick = document.createElement("section");
  quick.className = "command-quick-links";
  quick.setAttribute("aria-label", "Management workspaces");
  const choices = [
    [
      "All Hotels",
      "Every hotel, owner email, hotel contact, rooms and amenities",
      "hotels",
    ],
    [
      "Property approvals & submitted hotels",
      "Inspect property submissions and existing review details",
      "reviews",
    ],
    [
      "Website studio",
      "Manage campaign slides and destination content",
      "homepage",
    ],
  ];
  for (const [label, description, target] of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "command-quick-link";
    button.dataset.commandTarget = target;
    button.append(
      textElement("strong", "", label),
      textElement("small", "", description),
    );
    button.addEventListener("click", () => {
      if (!availableScreens(state.session).includes(target)) return;
      void run(() => showScreen(target));
    });
    quick.append(button);
  }
  metrics.after(quick);
}

setupCommandCenterWorkspaces();
function setupSingleCommandNavigation() {
  if (byId("commandBackButton")) return;
  const button = document.createElement("button");
  button.id = "commandBackButton";
  button.type = "button";
  button.className = "button-secondary command-back";
  button.textContent = "← Back to Command Center";
  button.hidden = true;
  button.addEventListener("click", () => void run(() => showScreen("control")));
  const container = document.querySelector("#portal .workspace");
  container?.prepend(button);
}
setupSingleCommandNavigation();

function setupHomepageCreateSlidePanels() {
  for (const [formId, label] of [
    ["homepageHeroCreateForm", "Add a new homepage campaign slide"],
    [
      "entirePropertyHeroCreateForm",
      "Add a new entire-property campaign slide",
    ],
  ]) {
    const form = byId(formId);
    if (!form || form.closest(".partner-create-slide")) continue;
    const wrap = document.createElement("details");
    wrap.className = "partner-create-slide";
    const summary = document.createElement("summary");
    summary.textContent = label;
    form.replaceWith(wrap);
    wrap.append(summary, form);
    const list = byId(
      formId === "homepageHeroCreateForm"
        ? "homepageHeroList"
        : "entirePropertyHeroList",
    );
    if (list) list.after(wrap);
  }
}

setupHomepageCreateSlidePanels();

function setEditorSectionStatus(sectionKey, label, complete = false) {
  const status = byId(`editorSectionStatus-${sectionKey}`);
  if (!status) return;

  status.textContent = label;
  status.classList.toggle("complete", complete);
}

function commercialConfigurationMissing(configuration = state.commercial) {
  if (!configuration) return ["booking configuration"];
  const settings = configuration.settingsVersions?.at(-1);
  const activePlans = state.editorRatePlans.filter(
    (plan) => plan.status === "ACTIVE",
  );
  const activeCancellationPolicyIds = new Set(
    (configuration.cancellationPolicies || [])
      .filter((policy) => policy.status === "ACTIVE")
      .map((policy) => policy.id),
  );
  const latestCancellationByPlan = new Map();
  for (const assignment of configuration.cancellationAssignments || []) {
    latestCancellationByPlan.set(assignment.rate_plan_id, assignment);
  }
  const assignedPlanIds = new Set(
    Array.from(latestCancellationByPlan.values())
      .filter((assignment) =>
        activeCancellationPolicyIds.has(assignment.cancellation_policy_id),
      )
      .map((assignment) => assignment.rate_plan_id),
  );
  const hasTax =
    settings?.tax_mode === "POLICIES" &&
    configuration.taxVersions?.length > 0 &&
    configuration.taxAssignments?.some((assignment) => assignment.enabled);
  const hasFees =
    settings?.fee_mode === "NO_FEES" ||
    (configuration.feeVersions?.length > 0 &&
      configuration.feeAssignments?.some((assignment) => assignment.enabled));

  const missing = [];
  if (!state.hotelGst?.accepted) missing.push("GST acceptance");
  if (!hasTax) missing.push("active GST schedule");
  if (!hasFees) missing.push("additional-fee setting (none is allowed)");
  if (!configuration.guestAgeVersions?.length) missing.push("guest age rules");
  if (!configuration.cancellationVersions?.length)
    missing.push("cancellation and no-show rules");
  if (!activePlans.length) missing.push("an active room rate plan");
  const unassignedPlans = activePlans.filter(
    (plan) => !assignedPlanIds.has(plan.id),
  );
  if (unassignedPlans.length) {
    missing.push(
      `cancellation rules for ${unassignedPlans.map((plan) => plan.name).join(", ")}`,
    );
  }
  return missing;
}

function commercialConfigurationReady(configuration = state.commercial) {
  return commercialConfigurationMissing(configuration).length === 0;
}

function updateEditorWorkspaceProgress(onboarding) {
  const checklist = onboarding.checklist || {};
  const categories = state.layout?.roomCategories || [];
  const units = state.layout?.physicalUnits || [];
  const media = onboarding.media || [];
  const documents = onboarding.documents || [];
  const completionKeys = [
    "profileComplete",
    "accommodationComplete",
    "policiesComplete",
    "amenitiesComplete",
    "mediaComplete",
    "rightToOperateDocumentPresent",
  ];
  const onboardingCompleted = completionKeys.filter(
    (key) => checklist[key],
  ).length;
  const commercialComplete = commercialConfigurationReady();
  const completed = onboardingCompleted + (commercialComplete ? 1 : 0);

  setEditorSectionStatus(
    "profile",
    checklist.profileComplete ? "Complete" : "Needs attention",
    checklist.profileComplete,
  );
  setEditorSectionStatus(
    "categories",
    `${categories.length} categor${categories.length === 1 ? "y" : "ies"}`,
    categories.length > 0,
  );
  setEditorSectionStatus(
    "rooms",
    `${units.length} room${units.length === 1 ? "" : "s"}`,
    units.length > 0,
  );
  setEditorSectionStatus(
    "policies",
    checklist.policiesComplete ? "Complete" : "Needs attention",
    checklist.policiesComplete,
  );
  setEditorSectionStatus(
    "commercial",
    commercialComplete ? "Online booking ready" : "Setup required",
    commercialComplete,
  );
  setEditorSectionStatus(
    "amenities",
    checklist.amenitiesComplete ? "Complete" : "Needs attention",
    checklist.amenitiesComplete,
  );
  setEditorSectionStatus(
    "assets",
    `${media.length} photo${media.length === 1 ? "" : "s"} · ${documents.length} document${documents.length === 1 ? "" : "s"}`,
    checklist.mediaComplete && checklist.rightToOperateDocumentPresent,
  );
  setEditorSectionStatus(
    "review",
    checklist.readyToSubmit
      ? "Ready to submit"
      : `${onboardingCompleted} of 6 complete`,
    checklist.readyToSubmit,
  );

  const progressText = byId("editorProgressText");
  const progressBar = byId("editorProgressBar");
  if (progressText) {
    progressText.textContent = `${completed} of 7 complete`;
  }
  if (progressBar) {
    progressBar.style.width = `${Math.round((completed / 7) * 100)}%`;
  }
}

function showMessage(message, error = false) {
  if (portalMessageTimer) window.clearTimeout(portalMessageTimer);
  portalMessage.textContent = message;
  portalMessage.classList.remove("hidden");
  portalMessage.classList.toggle("error", error);
  portalMessage.setAttribute("aria-live", error ? "assertive" : "polite");
  if (!error) {
    portalMessageTimer = window.setTimeout(() => clearMessage(), 6000);
  }
}

function clearMessage() {
  if (portalMessageTimer) window.clearTimeout(portalMessageTimer);
  portalMessageTimer = null;
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
    if (error instanceof StaleSessionError) return;
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
  const generation = state.authGeneration + 1;
  state.authGeneration = generation;
  state.authenticatedUid = user?.uid || null;
  resetPortalSessionState();
  portal.classList.add("hidden");
  authView.classList.add("hidden");
  sessionLoading.classList.toggle("hidden", !user);
  if (!user) {
    sessionLoading.classList.add("hidden");
    authView.classList.remove("hidden");
    return;
  }

  try {
    await loadSession();
    assertCurrentAuthContext({ user, uid: user.uid, generation });
    const firstScreen = availableScreens(state.session)[0];
    if (!firstScreen)
      throw new Error("No portal workspace is available for this account.");
    await showScreen(firstScreen);
    assertCurrentAuthContext({ user, uid: user.uid, generation });
    sessionLoading.classList.add("hidden");
    portal.classList.remove("hidden");
  } catch (error) {
    if (error instanceof StaleSessionError) return;
    resetPortalSessionState();
    sessionLoading.classList.add("hidden");
    authView.classList.remove("hidden");
    byId("authMessage").textContent = errorMessage(error);
    byId("authMessage").classList.add("error");
  }
});

async function loadSession() {
  state.session = await api("/v1/session");
  state.organizationId = sessionOrganizationId(
    state.session,
    state.organizationId,
  );
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
  control: ["Wildleaf management", "Wildleaf Command Center"],
  homepage: ["Wildleaf management", "Homepage content"],
  editor: ["Partner portal", "Property registration"],
  reviews: ["Wildleaf management", "Property reviews"],
  hotels: ["Wildleaf management", "All Hotels"],
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
  const isSuperAdmin = (state.session?.platformRoles || []).includes(
    "SUPER_ADMIN",
  );
  portal.classList.toggle("command-center-mode", isSuperAdmin);
  portal.classList.toggle("hotel-partner-mode", !isSuperAdmin);
  const accountControls = byId("portal").querySelector(".sidebar-foot");
  if (accountControls) {
    accountControls.classList.toggle("command-account-controls", isSuperAdmin);
    const target = isSuperAdmin
      ? byId("portal").querySelector(".workspace")
      : byId("portal").querySelector(".sidebar");
    if (target && accountControls.parentElement !== target)
      target.append(accountControls);
  }
  const back = byId("commandBackButton");
  if (back) back.hidden = !isSuperAdmin || name === "control";
  if (isSuperAdmin && name !== "control") {
    // All secondary screens return to the single Wildleaf Command Center.
    back?.setAttribute("aria-label", "Back to Wildleaf Command Center");
  }
  document.querySelectorAll("[data-command-target]").forEach((button) => {
    button.hidden = !availableScreens(state.session).includes(
      button.dataset.commandTarget,
    );
  });

  if (name === "dashboard") await loadDashboard();
  if (name === "properties") await loadProperties();
  if (name === "reservations") await loadReservations(false);
  if (name === "calendar") await loadCalendarWorkspace();
  if (name === "control") await loadControlCenter(false);
  if (name === "hotels") await loadHotelDirectory(false);
  if (name === "homepage") await loadHomepageContent();
  if (name === "reviews") {
    if (!state.reviewFilterTouched) byId("reviewStatus").value = "";
    await loadReviews(false);
  }
}

byId("refreshButton").addEventListener("click", () =>
  run(async () => {
    await loadSession();
    if (state.screen === "dashboard") await loadDashboard();
    else if (state.screen === "properties") await loadProperties();
    else if (state.screen === "reservations") await loadReservations(false);
    else if (state.screen === "calendar") await loadCalendarWorkspace();
    else if (state.screen === "control") await loadControlCenter(false);
    else if (state.screen === "hotels") await loadHotelDirectory(false);
    else if (state.screen === "homepage") await loadHomepageContent();
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
  renderCreatePropertyTaxonomyFields();
});

byId("createPropertyCategory").addEventListener("change", (event) => {
  populateTaxonomyTypeSelect(
    byId("createPropertyType"),
    event.currentTarget.value,
  );
});

byId("profilePropertyCategory").addEventListener("change", (event) => {
  populateTaxonomyTypeSelect(
    byId("profilePropertyType"),
    event.currentTarget.value,
  );
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
    propertyCategoryId: data.propertyCategoryId,
    propertyTypeId: data.propertyTypeId,
  };
  const fingerprint = [
    state.organizationId,
    body.name,
    body.timezone,
    body.propertyCategoryId,
    body.propertyTypeId,
  ].join(":");
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
    renderCreatePropertyTaxonomyFields();
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
    const option = textElement("option", "", "Register a property first");
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

  await Promise.all([fetchOwnerProperties(), loadPublicPropertyTaxonomy()]);
  renderCreatePropertyTaxonomyFields();
  renderPropertyPortfolioSummary();
  const list = byId("propertyList");
  list.replaceChildren();
  if (!state.properties.length) {
    list.append(
      textElement(
        "p",
        "empty-state card owner-property-empty",
        "No properties yet. Register your first hotel to begin the guided setup.",
      ),
    );
    return;
  }
  for (const property of state.properties) {
    const card = document.createElement("article");
    card.className = "property-card";
    card.dataset.status = property.status;
    const mark = textElement(
      "span",
      "property-card-mark",
      property.name.trim().slice(0, 1).toUpperCase() || "W",
    );
    const copy = document.createElement("div");
    copy.className = "property-card-copy";
    copy.append(textElement("h3", "", property.name));
    copy.append(
      textElement(
        "p",
        "",
        [property.city, property.stateRegion].filter(Boolean).join(", ") ||
          "Location not completed",
      ),
    );
    const taxonomyLabel = propertyTaxonomyLabel(property);
    if (taxonomyLabel) {
      copy.append(textElement("small", "muted", taxonomyLabel));
    }
    const status = textElement(
      "span",
      `status-pill status-${property.status.toLowerCase().replaceAll("_", "-")}`,
      property.status.replaceAll("_", " "),
    );
    copy.append(status);
    const actionLabels = {
      DRAFT: "Continue setup",
      SUBMITTED: "View submission",
      UNDER_REVIEW: "View review progress",
      CHANGES_REQUIRED: "Update requested details",
      APPROVED: "View approved property",
      LIVE: "Manage property",
    };
    card.append(
      mark,
      copy,
      button(
        actionLabels[property.status] || "Open property",
        () => openProperty(property.organizationId, property.id),
        "property-card-action",
      ),
    );
    list.append(card);
  }
}

function renderPropertyPortfolioSummary() {
  const summary = byId("propertyPortfolioSummary");
  if (!summary) return;
  const counts = {
    total: state.properties.length,
    setup: state.properties.filter((property) =>
      ["DRAFT", "CHANGES_REQUIRED"].includes(property.status),
    ).length,
    review: state.properties.filter((property) =>
      ["SUBMITTED", "UNDER_REVIEW", "APPROVED"].includes(property.status),
    ).length,
    live: state.properties.filter((property) => property.status === "LIVE")
      .length,
  };
  summary.replaceChildren();
  for (const [key, label] of [
    ["total", "All properties"],
    ["setup", "Needs setup"],
    ["review", "With Wildleaf"],
    ["live", "Live"],
  ]) {
    const item = document.createElement("div");
    item.className = `owner-property-stat tone-${key}`;
    item.append(
      textElement("strong", "", String(counts[key])),
      textElement("span", "", label),
    );
    summary.append(item);
  }
}

byId("backToProperties").addEventListener("click", () =>
  run(() => showScreen("properties")),
);

byId("ownerResponsibilityForm").addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    const form = event.currentTarget;
    if (!form.elements.accepted.checked) {
      throw new Error(
        "Read and accept the owner responsibility terms to enable editing.",
      );
    }
    const base = `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}`;
    state.ownerResponsibility = await idempotent(
      `${base}/owner-responsibility`,
      "PUT",
      "property-owner-responsibility",
      {
        termsVersionId: state.ownerResponsibility.currentTerms.id,
        accepted: true,
      },
    );
    renderEditor();
    showMessage(
      "Responsibility accepted. Property editing is enabled.",
      "success",
    );
  });
});

async function openProperty(organizationId, propertyId) {
  const base = `/v1/partner/organizations/${organizationId}/properties/${propertyId}`;
  // A new draft intentionally has no sale mode until the owner completes the
  // Property profile section. Load that profile first so opening registration
  // never depends on a rates workspace that cannot exist yet.
  const [profile] = await Promise.all([
    api(`/v1/partner/organizations/${organizationId}/properties/${propertyId}`),
    loadPublicPropertyTaxonomy(),
  ]);
  state.property = profile.property;

  // Reading GST consent also materializes Wildleaf's active statutory tax
  // policies for an accepted property. Complete that transaction before the
  // commercial snapshot is loaded so readiness never observes a stale gap.
  const hotelGst = await api(`${base}/commercial/hotel-gst-consent`);
  const [onboarding, layout, commercial, ratePlans, ownerResponsibility] =
    await Promise.all([
      api(
        `/v1/partner/organizations/${organizationId}/properties/${propertyId}/onboarding`,
      ),
      api(
        `/v1/partner/organizations/${organizationId}/properties/${propertyId}/layout`,
      ),
      api(`${base}/commercial`),
      state.property.saleMode
        ? api(`${base}/rates/plans`)
        : Promise.resolve({ ratePlans: [] }),
      api(`${base}/owner-responsibility`),
    ]);
  state.onboarding = onboarding;
  state.layout = layout;
  state.commercial = commercial;
  state.hotelGst = hotelGst;
  state.ownerResponsibility = ownerResponsibility;
  state.editorRatePlans = ratePlans.ratePlans || [];
  renderEditor();
  await showScreen("editor");
}

function fillForm(form, values) {
  for (const [key, value] of Object.entries(values || {})) {
    if (form.elements[key]) form.elements[key].value = value ?? "";
  }
}

function normalizeGuestContent(guestContent) {
  return guestContent &&
    typeof guestContent === "object" &&
    !Array.isArray(guestContent)
    ? guestContent
    : {};
}

function fillGuestContentForm(form, guestContent = {}) {
  const content = normalizeGuestContent(guestContent);
  const overview = content.overview || {};
  const about = content.about || {};
  const location = content.location || {};
  const things = content.thingsToKnow || {};
  const rules = content.rules || {};
  const reviews = content.reviews || {};
  fillForm(form, {
    guestHighlights: formatGuestLines(overview.highlights),
    guestIdealFor: formatGuestLines(overview.idealFor),
    guestPropertySetting: overview.setting,
    guestBuildings: about.buildings,
    guestFloors: about.floors,
    guestBathrooms: about.bathrooms,
    guestPlotArea: about.plotArea,
    guestBuiltUpArea: about.builtUpArea,
    guestConstructionYear: about.constructionYear,
    guestRenovationYear: about.renovationYear,
    guestEntranceDescription: about.entrance,
    guestLayoutDescription: about.layout,
    guestBathroomsDescription: about.bathroomsDescription,
    guestPrivacyDescription: about.privacy,
    guestFacilityDetails: formatGuestRecords(content.facilities, [
      "name",
      "description",
      "access",
      "pricing",
      "hours",
      "restrictions",
      "mediaId",
    ]),
    guestServiceDetails: formatGuestRecords(content.services, [
      "name",
      "description",
      "availability",
      "pricing",
      "hours",
      "conditions",
      "mediaId",
    ]),
    guestLocationDistances: formatGuestRecords(location.distances, [
      "name",
      "distance",
    ]),
    guestTransportation: formatGuestLines(location.transportation),
    guestAccessibility: formatGuestLines(location.accessibility),
    guestConnectivity: formatGuestLines(location.connectivity),
    guestGoodToKnow: formatGuestLines(things.goodToKnow),
    guestAccessibilityNotes: formatGuestLines(things.accessibility),
    guestSeasonalInformation: formatGuestLines(things.seasonal),
    guestLimitations: formatGuestLines(things.limitations),
    guestAdditionalRules: formatGuestLines(rules.additional),
    guestGoogleReviewsUrl: reviews.googleReviewsUrl,
    guestGoogleWriteReviewUrl: reviews.googleWriteReviewUrl,
  });
}

function guestValueKey(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("en-IN");
}

function safeGuestRecordPart(value) {
  return String(value || "")
    .replace(/[|\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function guestCheckbox(label, checked, onChange) {
  const option = document.createElement("label");
  option.className = "guest-choice";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", onChange);
  option.append(input, textElement("span", "", label));
  return { option, input };
}

function renderGuestChoiceOptions(containerId, catalog, selected, targetName) {
  const container = byId(containerId);
  const form = byId("profileForm");
  if (!container || !form?.elements[targetName]) return;
  const selectedItems = Array.isArray(selected) ? selected.filter(Boolean) : [];
  const known = new Map(
    catalog.map(([, label]) => [guestValueKey(label), label]),
  );
  const options = [
    ...catalog.map(([, label]) => label),
    ...selectedItems.filter((value) => !known.has(guestValueKey(value))),
  ];
  const selectedKeys = new Set(selectedItems.map(guestValueKey));
  container.replaceChildren();

  const sync = () => {
    form.elements[targetName].value = [
      ...container.querySelectorAll("input:checked"),
    ]
      .map((input) => input.dataset.label)
      .join("\n");
  };

  options.forEach((label) => {
    const { option, input } = guestCheckbox(
      label,
      selectedKeys.has(guestValueKey(label)),
      sync,
    );
    input.dataset.label = label;
    if (!known.has(guestValueKey(label))) option.classList.add("legacy");
    container.append(option);
  });
  sync();
}

function selectControl(label, values, selectedValue) {
  const wrapper = document.createElement("label");
  wrapper.textContent = label;
  const select = document.createElement("select");
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value || "Select";
    select.append(option);
  });
  select.value = values.includes(selectedValue) ? selectedValue : "";
  wrapper.append(select);
  return { wrapper, select };
}

function renderStructuredGuestOptions({
  containerId,
  catalog,
  records,
  targetName,
  kind,
}) {
  const container = byId(containerId);
  const form = byId("profileForm");
  if (!container || !form?.elements[targetName]) return;
  const savedRecords = Array.isArray(records)
    ? records.filter((item) => item?.name)
    : [];
  const savedByName = new Map(
    savedRecords.map((record) => [guestValueKey(record.name), record]),
  );
  const known = new Map(
    catalog.map(([, label]) => [guestValueKey(label), label]),
  );
  const names = [
    ...catalog.map(([, label]) => label),
    ...savedRecords
      .map((record) => record.name)
      .filter((name) => !known.has(guestValueKey(name))),
  ];
  container.replaceChildren();

  const sync = () => {
    const lines = [...container.querySelectorAll(".guest-structured-option")]
      .filter((card) => card.querySelector("input[type='checkbox']").checked)
      .map((card) => {
        const values = Object.fromEntries(
          [...card.querySelectorAll("[data-record-field]")].map((control) => [
            control.dataset.recordField,
            safeGuestRecordPart(control.value),
          ]),
        );
        if (kind === "facility") {
          return [
            card.dataset.label,
            values.description,
            values.access,
            values.pricing,
            values.hours,
            values.restrictions,
            values.mediaId,
          ].join(" | ");
        }
        return [
          card.dataset.label,
          values.description,
          values.availability,
          values.pricing,
          values.hours,
          values.conditions,
          values.mediaId,
        ].join(" | ");
      });
    form.elements[targetName].value = lines.join("\n");
  };

  names.forEach((label) => {
    const saved = savedByName.get(guestValueKey(label)) || {};
    const card = document.createElement("article");
    card.className = "guest-structured-option";
    card.dataset.label = label;
    if (!known.has(guestValueKey(label))) card.classList.add("legacy");
    const { option, input } = guestCheckbox(label, Boolean(saved.name), () => {
      card.classList.toggle("selected", input.checked);
      details.hidden = !input.checked;
      sync();
    });
    option.classList.add("guest-structured-toggle");
    const details = document.createElement("div");
    details.className = "guest-structured-details";
    details.hidden = !input.checked;

    const description = document.createElement("label");
    description.textContent = "Guest description";
    const descriptionInput = document.createElement("input");
    descriptionInput.maxLength = 500;
    descriptionInput.value = saved.description || "";
    descriptionInput.dataset.recordField = "description";
    description.append(descriptionInput);
    details.append(description);

    if (kind === "facility") {
      const access = selectControl(
        "Access",
        ["", "Private", "Shared", "Exclusive"],
        saved.access || "",
      );
      access.select.dataset.recordField = "access";
      const pricing = selectControl(
        "Pricing",
        ["", "Included", "Chargeable", "On Request"],
        saved.pricing || "",
      );
      pricing.select.dataset.recordField = "pricing";
      details.append(access.wrapper, pricing.wrapper);
    } else {
      const availability = selectControl(
        "Availability",
        ["", "Included", "Chargeable", "On Request"],
        saved.availability || saved.pricing || "",
      );
      availability.select.dataset.recordField = "availability";
      const pricing = document.createElement("input");
      pricing.type = "hidden";
      pricing.dataset.recordField = "pricing";
      pricing.value = saved.pricing || availability.select.value;
      availability.select.addEventListener("change", () => {
        pricing.value = availability.select.value;
      });
      details.append(availability.wrapper, pricing);
    }

    const hours = document.createElement("label");
    hours.textContent = "Hours / timing";
    const hoursInput = document.createElement("input");
    hoursInput.maxLength = 120;
    hoursInput.value = saved.hours || "";
    hoursInput.dataset.recordField = "hours";
    hours.append(hoursInput);
    const notes = document.createElement("label");
    notes.textContent = kind === "facility" ? "Restrictions" : "Conditions";
    const notesInput = document.createElement("input");
    notesInput.maxLength = 300;
    notesInput.value =
      (kind === "facility" ? saved.restrictions : saved.conditions) || "";
    notesInput.dataset.recordField =
      kind === "facility" ? "restrictions" : "conditions";
    notes.append(notesInput);
    const mediaId = document.createElement("input");
    mediaId.type = "hidden";
    mediaId.value = saved.mediaId || "";
    mediaId.dataset.recordField = "mediaId";
    details.append(hours, notes, mediaId);
    details.addEventListener("input", sync);
    details.addEventListener("change", sync);
    card.classList.toggle("selected", input.checked);
    card.append(option, details);
    container.append(card);
  });
  sync();
}

function renderGuestDistanceOptions(records) {
  const container = byId("guestDistanceOptions");
  const form = byId("profileForm");
  if (!container || !form?.elements.guestLocationDistances) return;
  const savedRecords = Array.isArray(records)
    ? records.filter((item) => item?.name)
    : [];
  const savedByName = new Map(
    savedRecords.map((item) => [guestValueKey(item.name), item]),
  );
  const known = new Map(
    GUEST_DISPLAY_CATALOG.distances.map(([, label]) => [
      guestValueKey(label),
      label,
    ]),
  );
  const names = [
    ...GUEST_DISPLAY_CATALOG.distances.map(([, label]) => label),
    ...savedRecords
      .map((item) => item.name)
      .filter((name) => !known.has(guestValueKey(name))),
  ];
  container.replaceChildren();
  const sync = () => {
    form.elements.guestLocationDistances.value = [
      ...container.querySelectorAll("input"),
    ]
      .filter((input) => input.value.trim())
      .map(
        (input) =>
          `${input.dataset.label} | ${safeGuestRecordPart(input.value)}`,
      )
      .join("\n");
  };
  names.forEach((label) => {
    const field = document.createElement("label");
    field.className = "guest-distance-field";
    field.textContent = label;
    if (!known.has(guestValueKey(label))) field.classList.add("legacy");
    const input = document.createElement("input");
    input.maxLength = 80;
    input.placeholder = "e.g. 7 km";
    input.dataset.label = label;
    input.value = savedByName.get(guestValueKey(label))?.distance || "";
    input.addEventListener("input", sync);
    field.append(input);
    container.append(field);
  });
  sync();
}

function setupGuestEditorTabs() {
  const workspace = document.querySelector(".guest-display-workspace");
  if (!workspace || workspace.dataset.ready === "true") return;
  workspace.dataset.ready = "true";
  workspace.querySelectorAll("[data-guest-editor-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.guestEditorTab;
      workspace
        .querySelectorAll("[data-guest-editor-tab]")
        .forEach((item) => item.classList.toggle("active", item === button));
      workspace
        .querySelectorAll("[data-guest-editor-panel]")
        .forEach((panel) =>
          panel.classList.toggle(
            "hidden",
            panel.dataset.guestEditorPanel !== key,
          ),
        );
    });
  });
}

function renderGuestDisplayControls(guestContent = {}) {
  setupGuestEditorTabs();
  const content = normalizeGuestContent(guestContent);
  const overview = content.overview || {};
  const location = content.location || {};
  const things = content.thingsToKnow || {};
  renderGuestChoiceOptions(
    "guestHighlightOptions",
    GUEST_DISPLAY_CATALOG.highlights,
    overview.highlights,
    "guestHighlights",
  );
  renderGuestChoiceOptions(
    "guestIdealForOptions",
    GUEST_DISPLAY_CATALOG.idealFor,
    overview.idealFor,
    "guestIdealFor",
  );
  renderStructuredGuestOptions({
    containerId: "guestFacilityOptions",
    catalog: GUEST_DISPLAY_CATALOG.facilities,
    records: content.facilities,
    targetName: "guestFacilityDetails",
    kind: "facility",
  });
  renderStructuredGuestOptions({
    containerId: "guestServiceOptions",
    catalog: GUEST_DISPLAY_CATALOG.services,
    records: content.services,
    targetName: "guestServiceDetails",
    kind: "service",
  });
  renderGuestDistanceOptions(location.distances);
  renderGuestChoiceOptions(
    "guestTransportationOptions",
    GUEST_DISPLAY_CATALOG.transportation,
    location.transportation,
    "guestTransportation",
  );
  renderGuestChoiceOptions(
    "guestAccessibilityOptions",
    GUEST_DISPLAY_CATALOG.accessibility,
    location.accessibility,
    "guestAccessibility",
  );
  renderGuestChoiceOptions(
    "guestConnectivityOptions",
    GUEST_DISPLAY_CATALOG.connectivity,
    location.connectivity,
    "guestConnectivity",
  );
  renderGuestChoiceOptions(
    "guestGoodToKnowOptions",
    GUEST_DISPLAY_CATALOG.thingsToKnow.goodToKnow,
    things.goodToKnow,
    "guestGoodToKnow",
  );
  renderGuestChoiceOptions(
    "guestAccessibilityNoteOptions",
    GUEST_DISPLAY_CATALOG.thingsToKnow.accessibility,
    things.accessibility,
    "guestAccessibilityNotes",
  );
  renderGuestChoiceOptions(
    "guestSeasonalOptions",
    GUEST_DISPLAY_CATALOG.thingsToKnow.seasonal,
    things.seasonal,
    "guestSeasonalInformation",
  );
  renderGuestChoiceOptions(
    "guestLimitationOptions",
    GUEST_DISPLAY_CATALOG.thingsToKnow.limitations,
    things.limitations,
    "guestLimitations",
  );
}

function formatGuestLines(items) {
  return Array.isArray(items) ? items.filter(Boolean).join("\n") : "";
}

function formatGuestRecords(items, fields) {
  if (!Array.isArray(items)) return "";
  return items
    .map((item) => fields.map((field) => item?.[field] || "").join(" | "))
    .join("\n");
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

function latestCommercialRow(rows, policyKey, policyId) {
  return (rows || [])
    .filter((row) => !policyId || row[policyKey] === policyId)
    .sort(
      (left, right) =>
        Number(left.version_number || 0) - Number(right.version_number || 0),
    )
    .at(-1);
}

function nextCommercialEffectiveDate(rows = []) {
  const today = localDate();
  const latest = rows
    .map((row) => row.effective_from)
    .filter(Boolean)
    .sort()
    .at(-1);

  return latest ? [today, shiftDate(latest, 1)].sort().at(-1) : today;
}

function renderGuestAgeExplanation() {
  const form = byId("commercialRulesForm");
  const container = byId("guestAgeExplanation");
  const infantMaxAge = Number(form.elements.infantMaxAge.value);
  const childMaxAge = Number(form.elements.childMaxAge.value);
  if (!Number.isInteger(infantMaxAge) || !Number.isInteger(childMaxAge)) {
    container.replaceChildren();
    return;
  }
  container.replaceChildren(
    textElement(
      "p",
      "",
      `Infant: age 0 to ${infantMaxAge}. Stays free and does not count towards room occupancy.`,
    ),
    textElement(
      "p",
      "",
      `Child: age ${infantMaxAge + 1} to ${childMaxAge}. Charged at the child rate and counts towards room occupancy.`,
    ),
  );
}

function syncCommercialFeeFields() {
  const form = byId("commercialRulesForm");
  if (!form) return;
  const enabled = form.elements.feeEnabled.checked;
  const readOnly = form.elements.feeEnabled.disabled;
  const percentage = form.elements.feeBasis.value === "PERCENTAGE";
  byId("commercialFeeFields").classList.toggle("hidden", !enabled);
  byId("commercialFeeValueLabel").textContent = percentage
    ? "Fee value (%)"
    : "Fee value (₹)";
  for (const name of ["feeName", "feeBasis", "feeValue"]) {
    form.elements[name].disabled = !enabled || readOnly;
  }
}

function renderHotelGstRule() {
  const summary = byId("hotelGstRuleSummary");
  const consentLabel = byId("hotelGstConsentText");
  const checkbox = byId("commercialRulesForm").elements.gstRulesAccepted;
  summary.replaceChildren();

  const gst = state.hotelGst;
  const rule = gst?.currentRule;
  if (!rule) {
    summary.append(
      textElement(
        "p",
        "notice error",
        "The current GST schedule could not be loaded.",
      ),
    );
    checkbox.checked = false;
    return;
  }

  const threshold = money(rule.thresholdMinor, "INR");
  const lowerRate = Number(rule.lower.rateBasisPoints) / 100;
  const upperRate = Number(rule.upper.rateBasisPoints) / 100;
  const rows = document.createElement("div");
  rows.className = "gst-slab-grid";
  for (const [title, rate, cgst, sgst, itc] of [
    [
      `Room value up to ${threshold} per room/day`,
      lowerRate,
      Number(rule.lower.cgstBasisPoints) / 100,
      Number(rule.lower.sgstBasisPoints) / 100,
      rule.lower.itcAvailable,
    ],
    [
      `Room value above ${threshold} per room/day`,
      upperRate,
      Number(rule.upper.cgstBasisPoints) / 100,
      Number(rule.upper.sgstBasisPoints) / 100,
      rule.upper.itcAvailable,
    ],
  ]) {
    const card = document.createElement("article");
    card.append(
      textElement("strong", "", title),
      textElement("span", "gst-rate", `${rate}% GST`),
      textElement("small", "", `CGST ${cgst}% + SGST ${sgst}%`),
      textElement(
        "small",
        "",
        itc ? "ITC available" : "No input tax credit (ITC)",
      ),
    );
    rows.append(card);
  }
  const source = document.createElement("a");
  source.href = rule.sourceUrl;
  source.target = "_blank";
  source.rel = "noreferrer";
  source.textContent = `Official source · rule v${rule.version} · effective ${rule.effectiveFrom}`;
  summary.append(rows, source);

  consentLabel.textContent = gst.accepted
    ? `Accepted on ${new Date(gst.consent.acceptedAt).toLocaleString("en-IN")}. Wildleaf will apply the current schedule and future statutory updates.`
    : gst.acceptanceText;
  checkbox.checked = Boolean(gst.accepted);
}

function currentCancellationAssignments() {
  const currentByPlan = new Map();
  for (const assignment of state.commercial?.cancellationAssignments || []) {
    currentByPlan.set(assignment.rate_plan_id, assignment);
  }
  return currentByPlan;
}

function renderCancellationPolicyList(policies, selectedPolicy) {
  const list = byId("cancellationPolicyList");
  list.replaceChildren();
  const currentAssignments = currentCancellationAssignments();

  if (!policies.length) {
    list.append(
      textElement(
        "p",
        "muted",
        "No cancellation rule has been saved yet. Complete the fields below and save booking rules.",
      ),
    );
  }

  for (const policy of policies) {
    const appliedPlans = state.editorRatePlans.filter(
      (plan) =>
        currentAssignments.get(plan.id)?.cancellation_policy_id === policy.id,
    );
    const row = document.createElement("div");
    row.className = "cancellation-policy-row";
    row.classList.toggle("selected", policy.id === selectedPolicy?.id);
    const copy = document.createElement("div");
    copy.append(
      textElement("strong", "", policy.name),
      textElement(
        "small",
        "muted",
        appliedPlans.length
          ? `Used by ${appliedPlans.map((plan) => plan.name).join(", ")}`
          : "Saved rule · not currently assigned to a rate plan",
      ),
    );
    row.append(
      copy,
      button(
        policy.id === selectedPolicy?.id ? "Editing" : "Edit",
        () => {
          state.selectedCancellationPolicyId = policy.id;
          renderCommercialRules();
        },
        "button-secondary",
      ),
    );
    list.append(row);
  }

  const deleteButton = byId("deleteCancellationRuleButton");
  const selectedIsAssigned = selectedPolicy
    ? Array.from(currentAssignments.values()).some(
        (assignment) => assignment.cancellation_policy_id === selectedPolicy.id,
      )
    : false;
  deleteButton.classList.toggle("hidden", !selectedPolicy);
  deleteButton.disabled = !selectedPolicy || selectedIsAssigned;
  deleteButton.title = selectedIsAssigned
    ? "Assign a different cancellation rule to the rate plan before deleting this one."
    : "Delete this saved cancellation rule";
}

function startNewCancellationRule() {
  state.selectedCancellationPolicyId = null;
  const form = byId("commercialRulesForm");
  form.elements.cancellationPolicyId.value = "";
  form.elements.cancellationPolicyName.value = "";
  form.elements.freeCancellationDays.value = "7";
  form.elements.lateCancellationPercent.value = "100";
  form.elements.noShowPercent.value = "100";
  form.elements.cancellationPolicyText.value = "";
  renderCancellationPolicyList(
    (state.commercial?.cancellationPolicies || []).filter(
      (policy) => policy.status === "ACTIVE",
    ),
    null,
  );
  byId("deleteCancellationRuleButton").classList.add("hidden");
  form.elements.cancellationPolicyName.focus();
}

async function archiveSelectedCancellationRule() {
  const policyId = state.selectedCancellationPolicyId;
  if (!policyId) return;
  const policy = (state.commercial?.cancellationPolicies || []).find(
    (item) => item.id === policyId,
  );
  if (!policy) return;
  if (!window.confirm(`Delete the cancellation rule "${policy.name}"?`)) return;

  const base = `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/commercial`;
  await api(`${base}/cancellation-policies/${policyId}`, {
    method: "DELETE",
    idempotencyKey: newIdempotencyKey("commercial-cancellation-archive"),
  });
  state.selectedCancellationPolicyId = null;
  await refreshCommercialConfiguration();
  showMessage(`Cancellation rule "${policy.name}" deleted.`);
}

function renderCommercialRules() {
  const form = byId("commercialRulesForm");
  form.reset();
  const configuration = state.commercial || {};
  const settings = configuration.settingsVersions?.at(-1);

  renderHotelGstRule();

  const guestAge = latestCommercialRow(
    configuration.guestAgeVersions,
    "property_id",
    state.property.id,
  );
  if (guestAge) {
    form.elements.infantMaxAge.value = guestAge.infant_max_age ?? "";
    form.elements.childMaxAge.value = guestAge.child_max_age;
  }
  renderGuestAgeExplanation();

  const activeCancellationPolicies = (
    configuration.cancellationPolicies || []
  ).filter((policy) => policy.status === "ACTIVE");
  const cancellationPolicy =
    activeCancellationPolicies.find(
      (policy) => policy.id === state.selectedCancellationPolicyId,
    ) || activeCancellationPolicies[0];
  state.selectedCancellationPolicyId = cancellationPolicy?.id || null;
  form.elements.cancellationPolicyId.value = cancellationPolicy?.id || "";
  const cancellationVersion = latestCommercialRow(
    configuration.cancellationVersions,
    "cancellation_policy_id",
    cancellationPolicy?.id,
  );
  if (cancellationPolicy) {
    form.elements.cancellationPolicyName.value = cancellationPolicy.name;
  }
  if (cancellationVersion) {
    form.elements.cancellationPolicyText.value =
      cancellationVersion.policy_text || "";
    const tiers = (configuration.cancellationTiers || []).filter(
      (tier) => tier.cancellation_policy_version_id === cancellationVersion.id,
    );
    const freeTier = tiers
      .filter(
        (tier) =>
          tier.trigger_type === "CANCELLATION" &&
          Number(tier.penalty_value) === 0 &&
          Number(tier.minimum_minutes_before_arrival) > 0,
      )
      .sort(
        (left, right) =>
          Number(right.minimum_minutes_before_arrival) -
          Number(left.minimum_minutes_before_arrival),
      )[0];
    const lateTier = tiers.find(
      (tier) =>
        tier.trigger_type === "CANCELLATION" &&
        Number(tier.minimum_minutes_before_arrival) === 0,
    );
    const noShowTier = tiers.find((tier) => tier.trigger_type === "NO_SHOW");
    form.elements.freeCancellationDays.value = String(
      Math.round(Number(freeTier?.minimum_minutes_before_arrival || 0) / 1440),
    );
    form.elements.lateCancellationPercent.value = String(
      Number(lateTier?.penalty_value || 0) / 100,
    );
    form.elements.noShowPercent.value = String(
      Number(noShowTier?.penalty_value || 0) / 100,
    );
  }
  renderCancellationPolicyList(activeCancellationPolicies, cancellationPolicy);

  const feeEnabled = settings?.fee_mode === "POLICIES";
  form.elements.feeEnabled.checked = feeEnabled;
  const feePolicy =
    configuration.feePolicies?.find((policy) => policy.code === "OWNER_FEE") ||
    configuration.feePolicies?.[0];
  const feeVersion = latestCommercialRow(
    configuration.feeVersions,
    "fee_policy_id",
    feePolicy?.id,
  );
  if (feePolicy) form.elements.feeName.value = feePolicy.name;
  if (feeVersion) {
    const percentage = feeVersion.calculation_type === "PERCENTAGE";
    form.elements.feeBasis.value = percentage
      ? "PERCENTAGE"
      : feeVersion.application_basis;
    form.elements.feeValue.value = String(
      percentage
        ? Number(feeVersion.rate_basis_points || 0) / 100
        : Number(feeVersion.amount_minor || 0) / 100,
    );
  }

  const ready = commercialConfigurationReady(configuration);
  const readiness = byId("commercialReadiness");
  readiness.textContent = ready ? "Online booking ready" : "Setup required";
  readiness.classList.toggle("ready", ready);
  byId("commercialEffectiveNote").textContent = ready
    ? "All required booking rules are configured."
    : "Complete this once to enable exact guest pricing and online booking.";
  const missingItems = commercialConfigurationMissing(configuration);
  const missing = byId("commercialMissingItems");
  missing.textContent = missingItems.length
    ? `Still needed: ${missingItems.join("; ")}.`
    : "Setup complete. Guests can receive exact prices and book online.";
  missing.classList.toggle("ready", missingItems.length === 0);

  const manageable = state.property.status !== "ARCHIVED";
  for (const control of form.elements) control.disabled = !manageable;
  form.elements.gstRulesAccepted.disabled =
    !manageable || state.hotelGst?.accepted;
  syncCommercialFeeFields();
}

function renderEditor() {
  const property = state.property;
  const onboarding = state.onboarding;
  byId("editorPropertyName").textContent = property.name;
  byId("editorStatus").textContent = property.status.replaceAll("_", " ");
  renderProfilePropertyTaxonomyFields(property);
  fillForm(byId("profileForm"), property);
  fillGuestContentForm(byId("profileForm"), property.guestContent);
  renderGuestDisplayControls(property.guestContent);
  fillForm(byId("policiesForm"), onboarding.policies || {});

  renderOwnerResponsibility();
  const editable =
    editableProperty(property.status) || state.ownerResponsibility?.editable;
  renderPropertyAmenities(onboarding.amenities || [], editable);
  renderRoomAmenityChoices(editable);
  renderCommercialRules();
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
  ].filter(Boolean)) {
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
    !(editableProperty(property.status) && onboarding.checklist.readyToSubmit),
  );
  updateEditorWorkspaceProgress(onboarding);
  renderAccommodation(editable);
  renderAssets(editable);
}

function renderOwnerResponsibility() {
  const card = byId("ownerResponsibilityCard");
  const form = byId("ownerResponsibilityForm");
  const terms = state.ownerResponsibility?.currentTerms;
  const relevant = ["APPROVED", "LIVE"].includes(state.property.status);
  card.classList.toggle("hidden", !relevant || !terms);
  if (!relevant || !terms) return;

  byId("ownerResponsibilityText").textContent = terms.text;
  const accepted = Boolean(state.ownerResponsibility.accepted);
  form.classList.toggle("hidden", accepted);
  form.elements.accepted.checked = false;
  byId("ownerResponsibilityTitle").textContent = accepted
    ? "Editing enabled"
    : "Accept responsibility to manage this live listing";
  byId("ownerResponsibilityStatus").textContent = accepted
    ? `Accepted on ${new Date(
        state.ownerResponsibility.acceptance.acceptedAt,
      ).toLocaleString(
        "en-IN",
      )}. You can update the property, room categories and rooms.`
    : "Editing is temporarily locked until the property owner accepts these terms.";
  card.classList.toggle("accepted", accepted);
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

function physicalUnitPhotoManager(unit, editable) {
  const media = (state.layout?.physicalUnitMedia || []).filter(
    (item) => item.physicalUnitId === unit.id,
  );
  const panel = document.createElement("details");
  panel.className = "physical-room-photo-manager";
  const summary = textElement(
    "summary",
    "",
    `${media.length} room photo${media.length === 1 ? "" : "s"}`,
  );
  panel.append(summary);

  const list = document.createElement("div");
  list.className = "compact-list";
  for (const item of media) {
    const row = document.createElement("div");
    row.className = "asset-row";
    const copy = document.createElement("div");
    copy.append(
      textElement("strong", "", item.altText || "Room photo"),
      textElement("small", "muted", item.caption || item.mimeType || "image"),
    );
    row.append(copy);
    if (editable) {
      row.append(
        button(
          "Remove",
          () => archivePhysicalUnitMedia(unit.id, item.id),
          "danger-button",
        ),
      );
    }
    list.append(row);
  }
  if (!media.length) {
    list.append(textElement("p", "muted", "No photos added to this room."));
  }
  panel.append(list);

  if (editable) {
    const form = document.createElement("form");
    form.className = "physical-room-photo-form";
    form.innerHTML = `
      <label>Add photos
        <input name="photos" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple required />
      </label>
      <label>Description <input name="altText" maxlength="500" placeholder="Optional" /></label>
      <label>Caption <input name="caption" maxlength="1000" placeholder="Optional" /></label>
      <button type="submit">Upload selected photos</button>
      <small>JPG, PNG, WebP and AVIF images are resized and optimized before upload.</small>
    `;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void run(async () => {
        const files = Array.from(form.elements.photos.files || []);
        if (!files.length) throw new Error("Choose one or more room photos.");
        await uploadPhysicalUnitPhotos(unit.id, files, {
          altText: form.elements.altText.value.trim(),
          caption: form.elements.caption.value.trim(),
        });
        await refreshEditorData();
        showMessage(
          `${files.length} photo${files.length === 1 ? "" : "s"} added to ${unit.displayName || unit.unitCode}.`,
        );
      });
    });
    panel.append(form);
  }
  return panel;
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

  const physicalRoomList = byId("physicalRoomList");
  physicalRoomList?.replaceChildren();

  if (!categories.length) {
    list.append(
      textElement(
        "p",
        "empty-state",
        "Add a room category before adding actual rooms.",
      ),
    );
    physicalRoomList?.append(
      textElement(
        "p",
        "empty-state",
        "Rooms will appear here after a room category has been added.",
      ),
    );
    return;
  }

  for (const category of categories) {
    const categoryUnits = units.filter(
      (unit) => unit.roomCategoryId === category.id && unit.status === "ACTIVE",
    );
    const amenityCount = (state.layout?.roomCategoryAmenities || []).filter(
      (item) => item.roomCategoryId === category.id,
    ).length;
    const categoryPhotos = (state.layout?.roomCategoryMedia || []).filter(
      (item) => item.roomCategoryId === category.id,
    );
    const photoCount = categoryPhotos.length;

    const row = document.createElement("div");
    row.className = "category-summary-card";

    const visual = document.createElement("div");
    visual.className = "category-summary-visual";
    visual.append(
      textElement(
        "span",
        "category-summary-initial",
        category.name.slice(0, 1).toUpperCase(),
      ),
      textElement(
        "small",
        "",
        `${photoCount} photo${photoCount === 1 ? "" : "s"}`,
      ),
    );
    if (categoryPhotos[0]) {
      void loadRoomCategoryCardPhoto(visual, category.id, categoryPhotos[0].id);
    }

    const copy = document.createElement("div");
    copy.className = "category-summary-copy";

    const heading = document.createElement("div");
    heading.className = "category-summary-heading";
    heading.append(
      textElement("h4", "", category.name),
      textElement(
        "span",
        "category-type-badge",
        category.accommodationType.replaceAll("_", " "),
      ),
    );

    const metrics = document.createElement("div");
    metrics.className = "category-summary-metrics";
    for (const metric of [
      `Up to ${category.maxOccupancy} guests`,
      `${categoryUnits.length} room${categoryUnits.length === 1 ? "" : "s"}`,
      `${amenityCount} amenit${amenityCount === 1 ? "y" : "ies"}`,
      `${photoCount} photo${photoCount === 1 ? "" : "s"}`,
    ]) {
      metrics.append(textElement("span", "", metric));
    }

    copy.append(heading, metrics);

    const actions = document.createElement("div");
    actions.className = "category-summary-actions";
    if (editable) {
      actions.append(
        button("Edit", () => editRoomCategory(category.id), "button-secondary"),
        button(
          "Manage photos",
          () => {
            byId("roomCategoryImageCategory").value = category.id;
            const photoPanel = byId("roomCategoryPhotosPanel");
            photoPanel.open = true;
            photoPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
          },
          "button-secondary",
        ),
        button(
          "Delete",
          () => archiveRoomCategory(category.id, category.name),
          "danger-button",
        ),
      );
    }

    row.append(visual, copy, actions);
    list.append(row);
  }

  if (!physicalRoomList) return;

  if (!units.length) {
    physicalRoomList.append(
      textElement(
        "p",
        "empty-state",
        "No actual rooms have been added yet. Use the form above to add one.",
      ),
    );
    return;
  }

  for (const unit of units) {
    const category = categories.find(
      (candidate) => candidate.id === unit.roomCategoryId,
    );
    const roomCard = document.createElement("div");
    roomCard.className = "physical-room-card";
    const copy = document.createElement("div");
    copy.append(
      textElement("strong", "", unit.displayName || unit.unitCode),
      textElement("span", "muted", category?.name || "Room category"),
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
    if (unit.viewLabel) details.push(unit.viewLabel);
    if (unit.liftAccessible) details.push("Lift");
    if (unit.wheelchairAccessible) details.push("Wheelchair friendly");
    if (unit.stepFreeAccessible) details.push("Step-free access");

    roomCard.append(
      copy,
      textElement(
        "small",
        "muted",
        details.length ? details.join(" · ") : "No additional details",
      ),
      physicalUnitPhotoManager(unit, editable),
    );
    physicalRoomList.append(roomCard);
  }
}

async function loadRoomCategoryCardPhoto(visual, roomCategoryId, mediaId) {
  try {
    const preview = await api(
      `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/room-categories/${roomCategoryId}/media/${mediaId}/read-url`,
    );
    if (!preview?.url || !visual.isConnected) return;
    visual.classList.add("has-photo");
    visual.style.backgroundImage = `linear-gradient(180deg, rgba(7, 34, 28, 0.02), rgba(7, 34, 28, 0.72)), url(${JSON.stringify(preview.url)})`;
  } catch {
    // The branded placeholder remains if a private preview cannot be loaded.
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

async function refreshCommercialConfiguration() {
  const base = `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}`;
  // This endpoint synchronizes accepted platform GST rules into the
  // property's commercial configuration, so it must finish first.
  const hotelGst = await api(`${base}/commercial/hotel-gst-consent`);
  const [commercial, plans] = await Promise.all([
    api(`${base}/commercial`),
    api(`${base}/rates/plans`),
  ]);
  state.commercial = commercial;
  state.editorRatePlans = plans.ratePlans || [];
  state.hotelGst = hotelGst;
  renderCommercialRules();
  updateEditorWorkspaceProgress(state.onboarding);
}

async function ensureCommercialPolicy({
  collection,
  suffix,
  code,
  name,
  description,
}) {
  const existing = state.commercial?.[collection]?.find(
    (policy) => policy.code === code && policy.status === "ACTIVE",
  );
  if (existing) return existing;

  const base = `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/commercial`;
  const result = await idempotent(
    `${base}/${suffix}`,
    "POST",
    `commercial-${code.toLowerCase()}-create`,
    { code, name, description },
  );
  return result.policy;
}

byId("commercialRulesForm").elements.feeEnabled.addEventListener(
  "change",
  syncCommercialFeeFields,
);
byId("commercialRulesForm").elements.feeBasis.addEventListener(
  "change",
  syncCommercialFeeFields,
);
for (const name of ["infantMaxAge", "childMaxAge"]) {
  byId("commercialRulesForm").elements[name].addEventListener(
    "input",
    renderGuestAgeExplanation,
  );
}
byId("addCancellationRuleButton").addEventListener(
  "click",
  startNewCancellationRule,
);
byId("deleteCancellationRuleButton").addEventListener("click", () => {
  void run(archiveSelectedCancellationRule);
});

byId("commercialRulesForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const saveButton = byId("saveCommercialRulesButton");
  if (saveButton.dataset.saving === "true") return;
  saveButton.dataset.saving = "true";
  saveButton.disabled = true;
  void run(async () => {
    const form = event.currentTarget;
    const infantMaxAge = Number(form.elements.infantMaxAge.value);
    const childMaxAge = Number(form.elements.childMaxAge.value);
    const freeCancellationDays = Number(
      form.elements.freeCancellationDays.value,
    );
    const lateCancellationPercent = Number(
      form.elements.lateCancellationPercent.value,
    );
    const noShowPercent = Number(form.elements.noShowPercent.value);
    const feeEnabled = form.elements.feeEnabled.checked;
    const gstRulesAccepted = form.elements.gstRulesAccepted.checked;
    const cancellationPolicyNameInput =
      form.elements.cancellationPolicyName.value.trim();
    const cancellationPolicyIdInput =
      form.elements.cancellationPolicyId.value.trim();
    const cancellationPolicyTextInput =
      form.elements.cancellationPolicyText.value.trim();
    const feeNameInput = form.elements.feeName.value.trim();
    const feeBasisInput = form.elements.feeBasis.value;
    const feeValueInput = Number(form.elements.feeValue.value);

    if (!gstRulesAccepted) {
      throw new Error(
        "Review and accept the Indian hotel GST rules to continue.",
      );
    }
    if (
      !Number.isInteger(infantMaxAge) ||
      !Number.isInteger(childMaxAge) ||
      infantMaxAge < 0 ||
      infantMaxAge >= childMaxAge ||
      childMaxAge > 17
    ) {
      throw new Error(
        "The infant age must be lower than the child age, and the child age cannot exceed 17.",
      );
    }
    if (
      !Number.isInteger(freeCancellationDays) ||
      freeCancellationDays < 0 ||
      !Number.isInteger(lateCancellationPercent) ||
      lateCancellationPercent < 0 ||
      lateCancellationPercent > 100 ||
      !Number.isInteger(noShowPercent) ||
      noShowPercent < 0 ||
      noShowPercent > 100
    ) {
      throw new Error("Enter valid cancellation and no-show rules.");
    }

    const base = `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/commercial`;

    // GST consent is an independent, one-time acknowledgement. Persist it
    // before refreshing the form or validating later booking prerequisites so
    // a new property without rate plans does not lose the owner's acceptance.
    if (!state.hotelGst?.accepted) {
      state.hotelGst = await idempotent(
        `${base}/hotel-gst-consent`,
        "PUT",
        "commercial-hotel-gst-consent",
        {
          ruleVersionId: state.hotelGst.currentRule.id,
          accepted: true,
        },
      );
    }

    await refreshCommercialConfiguration();

    const activeRatePlans = state.editorRatePlans.filter(
      (plan) => plan.status === "ACTIVE",
    );

    const currentGuestAge = latestCommercialRow(
      state.commercial?.guestAgeVersions,
      "property_id",
      state.property.id,
    );
    const guestAgeChanged =
      !currentGuestAge ||
      Number(currentGuestAge.infant_max_age) !== infantMaxAge ||
      Number(currentGuestAge.child_max_age) !== childMaxAge ||
      currentGuestAge.infants_count_towards_occupancy ||
      currentGuestAge.infants_count_towards_child_limit ||
      currentGuestAge.infants_charge_as_children;
    if (guestAgeChanged) {
      await idempotent(
        `${base}/guest-age-policy`,
        "PUT",
        "commercial-guest-age",
        {
          effectiveFrom: nextCommercialEffectiveDate(
            state.commercial?.guestAgeVersions || [],
          ),
          infantMaxAge,
          childMaxAge,
          infantsCountTowardsOccupancy: false,
          infantsCountTowardsChildLimit: false,
          infantsChargeAsChildren: false,
          expectedVersion: Number(
            state.commercial?.guestAgeHeader?.current_version || 0,
          ),
        },
      );
    }

    const cancellationPolicyName =
      cancellationPolicyNameInput || "Standard cancellation";
    let cancellationPolicy = (
      state.commercial?.cancellationPolicies || []
    ).find(
      (policy) =>
        policy.id === cancellationPolicyIdInput && policy.status === "ACTIVE",
    );
    if (!cancellationPolicy) {
      const code = `CANCEL_${Date.now().toString(36).toUpperCase()}`.slice(
        0,
        40,
      );
      const result = await idempotent(
        `${base}/cancellation-policies`,
        "POST",
        `commercial-${code.toLowerCase()}-create`,
        {
          code,
          name: cancellationPolicyName,
          description: "Owner-managed cancellation and no-show terms.",
        },
      );
      cancellationPolicy = result.policy;
      state.selectedCancellationPolicyId = cancellationPolicy.id;
      form.elements.cancellationPolicyId.value = cancellationPolicy.id;
    }
    const generatedCancellationText = freeCancellationDays
      ? `Free cancellation until ${freeCancellationDays} day${freeCancellationDays === 1 ? "" : "s"} before check-in. Later cancellations are charged at ${lateCancellationPercent}% of the stay. No-shows are charged at ${noShowPercent}%.`
      : `Cancellations are charged at ${lateCancellationPercent}% of the stay. No-shows are charged at ${noShowPercent}%.`;
    const cancellationTiers = [];
    if (freeCancellationDays > 0) {
      cancellationTiers.push({
        triggerType: "CANCELLATION",
        minimumMinutesBeforeArrival: freeCancellationDays * 1440,
        penaltyType: "PERCENTAGE_OF_STAY",
        penaltyValue: 0,
      });
    }
    cancellationTiers.push(
      {
        triggerType: "CANCELLATION",
        minimumMinutesBeforeArrival: 0,
        penaltyType: "PERCENTAGE_OF_STAY",
        penaltyValue: lateCancellationPercent * 100,
      },
      {
        triggerType: "NO_SHOW",
        penaltyType: "PERCENTAGE_OF_STAY",
        penaltyValue: noShowPercent * 100,
      },
    );
    const cancellationEffectiveFrom = nextCommercialEffectiveDate(
      (state.commercial?.cancellationVersions || []).filter(
        (version) => version.cancellation_policy_id === cancellationPolicy.id,
      ),
    );
    await idempotent(
      `${base}/cancellation-policies/${cancellationPolicy.id}/versions`,
      "POST",
      "commercial-cancellation-version",
      {
        effectiveFrom: cancellationEffectiveFrom,
        arrivalLocalTime: state.property.checkInTime || "14:00",
        policyText: cancellationPolicyTextInput || generatedCancellationText,
        expectedCurrentVersion: Number(cancellationPolicy.current_version || 0),
        tiers: cancellationTiers,
      },
    );
    for (const plan of activeRatePlans) {
      const alreadyAssigned = (state.commercial?.cancellationAssignments || [])
        .filter((assignment) => assignment.rate_plan_id === plan.id)
        .sort((left, right) =>
          String(left.effective_from).localeCompare(
            String(right.effective_from),
          ),
        )
        .at(-1);
      if (alreadyAssigned?.cancellation_policy_id === cancellationPolicy.id) {
        continue;
      }
      await idempotent(
        `${base}/cancellation-assignments`,
        "POST",
        `commercial-cancellation-${plan.id}`,
        {
          ratePlanId: plan.id,
          cancellationPolicyId: cancellationPolicy.id,
          effectiveFrom: cancellationEffectiveFrom,
        },
      );
    }

    if (feeEnabled) {
      const feeValue = feeValueInput;
      if (!(feeValue > 0)) {
        throw new Error("Enter a fee greater than zero, or turn the fee off.");
      }
      const feeName = feeNameInput || "Service fee";
      const feeBasis = feeBasisInput;
      const percentage = feeBasis === "PERCENTAGE";
      const feePolicy = await ensureCommercialPolicy({
        collection: "feePolicies",
        suffix: "fee-policies",
        code: "OWNER_FEE",
        name: feeName,
        description:
          "Optional additional charge configured by the property owner.",
      });
      const feeVersionBody = {
        effectiveFrom: nextCommercialEffectiveDate(
          (state.commercial?.feeVersions || []).filter(
            (version) => version.fee_policy_id === feePolicy.id,
          ),
        ),
        calculationType: percentage ? "PERCENTAGE" : "FIXED",
        applicationBasis: percentage ? "STAY_CHARGES" : feeBasis,
        priceMode: "EXCLUSIVE",
        taxable: false,
        expectedCurrentVersion: Number(feePolicy.current_version || 0),
      };
      if (percentage) {
        feeVersionBody.rateBasisPoints = Math.round(feeValue * 100);
      } else {
        feeVersionBody.amountMinor = rupeesToMinor(feeValue);
      }
      await idempotent(
        `${base}/fee-policies/${feePolicy.id}/versions`,
        "POST",
        "commercial-fee-version",
        feeVersionBody,
      );
      await idempotent(
        `${base}/fee-policies/${feePolicy.id}/assignments`,
        "POST",
        "commercial-fee-assignment",
        {
          effectiveFrom: nextCommercialEffectiveDate(
            state.commercial?.feeAssignments || [],
          ),
          scopeType: "PROPERTY",
          ratePlanId: null,
          rateProductId: null,
          enabled: true,
        },
      );
    }

    const desiredFeeMode = feeEnabled ? "POLICIES" : "NO_FEES";
    const currentSettings = state.commercial?.settingsVersions?.at(-1);
    if (
      !currentSettings ||
      currentSettings.tax_mode !== "POLICIES" ||
      currentSettings.fee_mode !== desiredFeeMode
    ) {
      await idempotent(`${base}/settings`, "PUT", "commercial-settings", {
        effectiveFrom: nextCommercialEffectiveDate(
          state.commercial?.settingsVersions || [],
        ),
        taxMode: "POLICIES",
        feeMode: desiredFeeMode,
        expectedVersion: Number(
          state.commercial?.settingsHeader?.current_version || 0,
        ),
      });
    }

    // Exact public quotes must explicitly evaluate promotions. A property
    // without a promotion campaign is a valid, bookable configuration, so
    // initialize it as NO_PROMOTIONS instead of leaving quote creation in an
    // incomplete state.
    const promotionConfiguration = await api(`${base}/promotions`);
    if (!promotionConfiguration.settingsVersions?.length) {
      await idempotent(
        `${base}/promotions/settings`,
        "PUT",
        "commercial-promotion-settings",
        {
          effectiveFrom: nextCommercialEffectiveDate(
            promotionConfiguration.settingsVersions || [],
          ),
          promotionMode: "NO_PROMOTIONS",
          expectedVersion: Number(
            promotionConfiguration.settingsHeader?.current_version || 0,
          ),
        },
      );
    }

    await refreshCommercialConfiguration();
    showMessage(
      activeRatePlans.length
        ? "Booking rules saved. Online-booking readiness has been refreshed."
        : "Booking rules saved. Add a base room rate in Rates & inventory to finish online-booking setup.",
    );
  }).finally(() => {
    delete saveButton.dataset.saving;
    saveButton.disabled = state.property?.status === "ARCHIVED";
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

function renderRoomIdentityRows(units = []) {
  const form = byId("roomCategoryForm");
  const count = Math.max(
    1,
    Math.min(1000, Number(form.elements.roomCount.value) || 1),
  );
  const list = byId("roomIdentityList");
  const current = Array.from(list.querySelectorAll(".room-identity-row")).map(
    (row) => ({
      displayName: row.querySelector('[data-room-field="name"]')?.value || "",
      externalChannel:
        row.querySelector('[data-room-field="channel"]')?.value || "",
      externalReference:
        row.querySelector('[data-room-field="reference"]')?.value || "",
    }),
  );
  const source = units.length ? units : current;
  list.replaceChildren();
  for (let index = 0; index < count; index += 1) {
    const identity = source[index] || {};
    const row = document.createElement("div");
    row.className = "room-identity-row";
    row.innerHTML = `
      <span class="room-identity-number">${index + 1}</span>
      <label>Room name / number<input data-room-field="name" maxlength="150" placeholder="Optional · M ${String(index + 101)}" /></label>
      <label>Channel<select data-room-field="channel"><option value="">Not connected</option><option value="AIRBNB">Airbnb</option><option value="BOOKING_COM">Booking.com</option><option value="OTHER">Other</option></select></label>
      <label>Remote ID / address<input data-room-field="reference" maxlength="500" placeholder="Optional channel identifier" /></label>
    `;
    row.querySelector('[data-room-field="name"]').value =
      identity.displayName || "";
    row.querySelector('[data-room-field="channel"]').value =
      identity.externalChannel || "";
    row.querySelector('[data-room-field="reference"]').value =
      identity.externalReference || "";
    list.append(row);
  }
}

function roomCategoryUnitPayload() {
  return Array.from(
    byId("roomIdentityList").querySelectorAll(".room-identity-row"),
  ).map((row) => {
    const displayName = row
      .querySelector('[data-room-field="name"]')
      .value.trim();
    const externalChannel = row.querySelector(
      '[data-room-field="channel"]',
    ).value;
    const externalReference = row
      .querySelector('[data-room-field="reference"]')
      .value.trim();
    if (Boolean(externalChannel) !== Boolean(externalReference)) {
      throw new Error(
        "Choose both a channel and its remote ID/address, or leave both empty.",
      );
    }
    return {
      ...(displayName ? { displayName } : {}),
      ...(externalChannel ? { externalChannel, externalReference } : {}),
    };
  });
}

function resetRoomCategoryEditor() {
  const form = byId("roomCategoryForm");
  form.reset();
  form.elements.roomCategoryId.value = "";
  form.elements.expectedVersion.value = "";
  form.elements.roomCount.value = "1";
  byId("roomCategorySaveButton").textContent = "Add room category";
  byId("roomCategoryCancelButton").classList.add("hidden");
  form.querySelectorAll('input[name="roomAmenity"]').forEach((input) => {
    input.checked = false;
  });
  renderRoomIdentityRows();
}

function editRoomCategory(categoryId) {
  const category = (state.layout?.roomCategories || []).find(
    (item) => item.id === categoryId,
  );
  if (!category) throw new Error("Room category is no longer available.");
  const form = byId("roomCategoryForm");
  const units = (state.layout?.physicalUnits || []).filter(
    (unit) => unit.roomCategoryId === categoryId && unit.status === "ACTIVE",
  );
  form.elements.roomCategoryId.value = category.id;
  form.elements.expectedVersion.value = String(category.version);
  form.elements.name.value = category.name;
  form.elements.accommodationType.value = category.accommodationType;
  form.elements.roomCount.value = String(Math.max(1, units.length));
  form.elements.sizeSqm.value = category.sizeSqm ?? "";
  form.elements.description.value = category.description || "";
  form.elements.baseAdults.value =
    category.baseAdults ?? category.baseOccupancy;
  form.elements.baseChildren.value = category.baseChildren ?? 0;
  form.elements.defaultExtraAdult.value = (
    (category.defaultExtraAdultMinor ?? 0) / 100
  ).toFixed(2);
  form.elements.defaultExtraChild.value = (
    (category.defaultExtraChildMinor ?? 0) / 100
  ).toFixed(2);
  form.elements.maxAdults.value = category.maxAdults;
  form.elements.maxChildren.value = category.maxChildren;
  form.elements.maxOccupancy.value = category.maxOccupancy;
  form.elements.bedConfiguration.value = category.bedConfiguration || "";
  form.elements.defaultViewLabel.value = category.defaultViewLabel || "";
  form.elements.extraBedAllowed.checked = category.extraBedAllowed;
  const amenityCodes = new Set(
    (state.layout?.roomCategoryAmenities || [])
      .filter((item) => item.roomCategoryId === categoryId)
      .map((item) => item.amenityCode),
  );
  form.querySelectorAll('input[name="roomAmenity"]').forEach((input) => {
    input.checked = amenityCodes.has(input.value);
  });
  renderRoomIdentityRows(units);
  byId("roomCategorySaveButton").textContent = "Save category changes";
  byId("roomCategoryCancelButton").classList.remove("hidden");
  const panel = byId("roomCategoryCreatePanel");
  panel.open = true;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function archiveRoomCategory(categoryId, categoryName) {
  if (
    !window.confirm(
      `Remove "${categoryName}" from future sale? Existing booking history is preserved.`,
    )
  )
    return;
  await api(
    `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/room-categories/${categoryId}`,
    {
      method: "DELETE",
      idempotencyKey: newIdempotencyKey("room-category-archive"),
    },
  );
  await refreshEditorData();
  resetRoomCategoryEditor();
  showMessage(`Room category "${categoryName}" removed from future inventory.`);
}

byId("roomCategoryForm").elements.roomCount.addEventListener("input", () =>
  renderRoomIdentityRows(),
);
byId("roomCategoryCancelButton").addEventListener(
  "click",
  resetRoomCategoryEditor,
);
renderRoomIdentityRows();

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
    const roomCount = Number(values.roomCount);
    const editingId = values.roomCategoryId;

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
      baseAdults + baseChildren > maxOccupancy ||
      maxAdults > maxOccupancy ||
      maxChildren > maxOccupancy ||
      maxOccupancy > maxAdults + maxChildren
    ) {
      throw new Error(
        "Guest limits must be consistent: included guests must fit within each limit, and maximum adults plus maximum kids must cover the total maximum occupancy.",
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
    if (!Number.isInteger(roomCount) || roomCount < 1 || roomCount > 1000) {
      throw new Error(
        "Number of rooms must be a whole number between 1 and 1000.",
      );
    }
    const units = roomCategoryUnitPayload();

    const payload = {
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
      roomCount,
      units,
      ...(editingId ? { expectedVersion: Number(values.expectedVersion) } : {}),
    };

    const result = await idempotent(
      `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/room-categories${editingId ? `/${editingId}` : ""}`,
      editingId ? "PUT" : "POST",
      editingId ? "room-category-update" : "room-category-create",
      payload,
    );

    const roomCategoryId = result?.roomCategory?.id;

    if (!roomCategoryId) {
      throw new Error(
        "Room category was created but its identifier was not returned.",
      );
    }

    await idempotent(
      `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/room-categories/${roomCategoryId}/amenities`,
      "PUT",
      "room-category-amenities-save",
      { amenityCodes: selectedAmenityCodes },
    );

    await refreshEditorData();
    resetRoomCategoryEditor();
    byId("roomCategoryImageCategory").value = roomCategoryId;
    showMessage(
      `Room category "${name}" ${editingId ? "updated" : "added"} with ${roomCount} room${roomCount === 1 ? "" : "s"}.`,
    );
  });
});

byId("roomCategoryImageUploadForm").addEventListener("submit", (event) => {
  event.preventDefault();

  run(async () => {
    const form = event.currentTarget;

    const values = Object.fromEntries(new FormData(form));

    const roomCategoryId = values.roomCategoryId;

    const files = Array.from(form.elements.file.files || []);

    if (!roomCategoryId) {
      throw new Error("Choose a room category first.");
    }

    if (!files.length) {
      throw new Error("Choose one or more room category photos.");
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

    for (const [index, original] of files.entries()) {
      const file = await optimizeRoomPhoto(original);
      if (file.size > 8 * 1024 * 1024) {
        throw new Error(
          `"${original.name}" remains larger than 8 MB after optimization.`,
        );
      }
      const perPhotoQuery = new URLSearchParams(query);
      perPhotoQuery.set("sortOrder", String(index));
      await managedUpload(
        `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/room-categories/${roomCategoryId}/uploads/images?${perPhotoQuery.toString() || queryString}`,
        file,
        `room-category-image-upload-${index}`,
      );
    }

    form.reset();

    await refreshEditorData();

    byId("roomCategoryImageCategory").value = roomCategoryId;

    showMessage(
      `${files.length} optimized photo${files.length === 1 ? "" : "s"} uploaded for "${category?.name || "room category"}".`,
    );
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

async function archivePhysicalUnitMedia(physicalUnitId, mediaId) {
  await api(
    `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/units/${physicalUnitId}/media/${mediaId}`,
    {
      method: "DELETE",
      idempotencyKey: newIdempotencyKey("physical-room-media-archive"),
    },
  );
  await refreshEditorData();
  showMessage("Room photo removed.");
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
    const photos = Array.from(form.elements.photos.files || []);
    const photoAltText = form.elements.photoAltText.value.trim();
    const photoCaption = form.elements.photoCaption.value.trim();
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

    const result = await api(
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

    const physicalUnitId = result?.physicalUnit?.id;
    if (!physicalUnitId) {
      throw new Error(
        "The room was created but its identifier was not returned.",
      );
    }
    if (photos.length) {
      await uploadPhysicalUnitPhotos(physicalUnitId, photos, {
        altText: photoAltText,
        caption: photoCaption,
      });
    }

    await refreshEditorData();

    form.reset();
    pendingPhysicalUnitCreateKeys.delete(fingerprint);

    showMessage(
      `Room "${roomName}" added${photos.length ? ` with ${photos.length} optimized photo${photos.length === 1 ? "" : "s"}` : ""}.`,
    );
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

function canManagePlatformGst() {
  return (state.session?.platformRoles || []).includes("SUPER_ADMIN");
}

function renderPlatformGstRules() {
  const card = byId("platformGstRulesCard");
  card.classList.toggle("hidden", !canManagePlatformGst());
  if (!canManagePlatformGst()) return;

  const list = byId("platformGstRuleHistory");
  list.replaceChildren();
  for (const rule of state.platformGstRules) {
    const row = document.createElement("article");
    row.className = "compact-row";
    const copy = document.createElement("div");
    const threshold = money(rule.thresholdMinor, "INR");
    copy.append(
      textElement(
        "strong",
        "",
        `Version ${rule.version} · effective ${rule.effectiveFrom}`,
      ),
      textElement(
        "span",
        "",
        `${Number(rule.lower.rateBasisPoints) / 100}% through ${threshold}; ${Number(rule.upper.rateBasisPoints) / 100}% above ${threshold}`,
      ),
      textElement(
        "small",
        "muted",
        `Lower slab: ${rule.lower.itcAvailable ? "ITC available" : "no ITC"} · Upper slab: ${rule.upper.itcAvailable ? "ITC available" : "no ITC"}`,
      ),
    );
    const source = document.createElement("a");
    source.href = rule.sourceUrl;
    source.target = "_blank";
    source.rel = "noreferrer";
    source.textContent = "Official source";
    row.append(copy, source);
    list.append(row);
  }

  const latest = state.platformGstRules[0];
  const form = byId("platformGstRuleForm");
  if (!form.elements.effectiveFrom.value) {
    form.elements.effectiveFrom.min = shiftDate(
      latest?.effectiveFrom || localDate(),
      1,
    );
    form.elements.effectiveFrom.value = form.elements.effectiveFrom.min;
  }
}

async function loadPlatformGstRules() {
  if (!canManagePlatformGst()) {
    state.platformGstRules = [];
    renderPlatformGstRules();
    return;
  }
  const result = await api("/v1/platform/commercial/hotel-gst-rules");
  state.platformGstRules = result.rules || [];
  renderPlatformGstRules();
}

let hotelDirectoryItems = [];
let hotelDirectoryCursor = null;
async function loadHotelDirectory(append) {
  if (!append) {
    hotelDirectoryItems = [];
    hotelDirectoryCursor = null;
  }
  const qs = new URLSearchParams({ limit: "30" });
  if (append && hotelDirectoryCursor) qs.set("cursor", hotelDirectoryCursor);
  const page = await api(`/v1/platform/hotels/directory?${qs}`);
  hotelDirectoryItems = [...hotelDirectoryItems, ...(page.items || [])];
  hotelDirectoryCursor = page.nextCursor;
  renderHotelDirectory();
}
function renderHotelDirectory() {
  const list = byId("hotelDirectoryList");
  const query = byId("hotelDirectorySearch").value.trim().toLowerCase();
  list.replaceChildren();
  const hotels = hotelDirectoryItems.filter((item) =>
    [item.name, item.legalBusinessName, item.city, item.tradingName].some(
      (value) =>
        String(value || "")
          .toLowerCase()
          .includes(query),
    ),
  );
  if (!hotels.length)
    list.append(
      textElement(
        "p",
        "empty-state",
        "No matching hotels in the loaded directory.",
      ),
    );
  for (const [index, hotel] of hotels.entries()) {
    const details = document.createElement("details");
    details.className = "command-hotel";
    const summary = document.createElement("summary");
    const name = textElement("strong", "", hotel.name);
    const context = textElement(
      "small",
      "",
      [hotel.city, hotel.stateRegion, hotel.status].filter(Boolean).join(" · "),
    );
    const caption = document.createElement("span");
    caption.className = "command-hotel-caption";
    caption.append(name, context);
    summary.append(
      caption,
      textElement(
        "span",
        "command-hotel-count",
        `${hotel.totalPhysicalUnits} units`,
      ),
    );
    const body = document.createElement("div");
    body.className = "command-hotel-body";
    const fields = [
      ["Business", hotel.legalBusinessName],
      ["Trading name", hotel.tradingName],
      ["Hotel email", hotel.hotelContactEmail],
      ["Hotel phone", hotel.hotelContactPhone],
      [
        "Address",
        [hotel.addressLine1, hotel.city, hotel.stateRegion]
          .filter(Boolean)
          .join(", "),
      ],
      ["Booking mode", hotel.saleMode],
      ["Description", hotel.description],
    ];
    for (const [label, value] of fields) {
      const line = document.createElement("p");
      line.append(
        textElement("strong", "", `${label}: `),
        textElement("span", "", value || "Not provided"),
      );
      body.append(line);
    }
    body.append(textElement("h4", "", "Registered business owners"));
    if (!hotel.ownerContacts?.length)
      body.append(
        textElement("p", "muted", "No active owner contact recorded."),
      );
    for (const owner of hotel.ownerContacts || []) {
      body.append(
        textElement(
          "p",
          "",
          `${owner.name || "Owner"} · ${owner.email || "Email not supplied"}`,
        ),
      );
    }
    body.append(textElement("h4", "", "Room categories"));
    if (!hotel.roomCategories?.length)
      body.append(textElement("p", "muted", "No room categories registered."));
    for (const room of hotel.roomCategories || []) {
      body.append(
        textElement(
          "p",
          "",
          `${room.name} · ${room.physicalUnitCount} physical units · ${room.status}`,
        ),
      );
    }
    body.append(textElement("h4", "", "Property amenities"));
    body.append(
      textElement(
        "p",
        "",
        hotel.amenities?.length
          ? hotel.amenities.map((a) => a.name).join(" · ")
          : "None recorded",
      ),
    );
    details.append(summary, body);
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      list.querySelectorAll("details.command-hotel").forEach((other) => {
        if (other !== details) other.open = false;
      });
    });
    list.append(details);
  }
  byId("loadMoreHotels").classList.toggle("hidden", !hotelDirectoryCursor);
}
byId("hotelDirectorySearch").addEventListener("input", renderHotelDirectory);
byId("loadMoreHotels").addEventListener("click", () =>
  run(() => loadHotelDirectory(true)),
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
  if (!append) await loadPlatformGstRules();
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

byId("platformGstRuleForm").addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    if (!canManagePlatformGst()) {
      throw new Error("Only a Wildleaf super admin can publish GST rules.");
    }
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    await idempotent(
      "/v1/platform/commercial/hotel-gst-rules",
      "POST",
      "platform-hotel-gst-rule-create",
      {
        effectiveFrom: values.effectiveFrom,
        thresholdMinor: rupeesToMinor(values.thresholdRupees),
        lowerRateBasisPoints: Math.round(Number(values.lowerRatePercent) * 100),
        upperRateBasisPoints: Math.round(Number(values.upperRatePercent) * 100),
        lowerItcAvailable: form.elements.lowerItcAvailable.checked,
        upperItcAvailable: form.elements.upperItcAvailable.checked,
        sourceUrl: values.sourceUrl.trim(),
      },
    );
    form.elements.effectiveFrom.value = "";
    await loadPlatformGstRules();
    showMessage("The future hotel GST rule was published.");
  });
});

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
  const extraAdultInput = byId("calendarGrid").querySelector(
    `input[data-owner-extra-adult="${categoryId}"]`,
  );
  const extraChildInput = byId("calendarGrid").querySelector(
    `input[data-owner-extra-child="${categoryId}"]`,
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
  const extraAdultMinor = rupeesToMinor(extraAdultInput?.value ?? "0");
  const extraChildMinor = rupeesToMinor(extraChildInput?.value ?? "0");

  if (
    [baseRateMinor, extraAdultMinor, extraChildMinor].some(
      (amount) => !Number.isSafeInteger(amount) || amount < 0,
    )
  ) {
    throw new Error(
      "Base, extra adult and extra kid rates must be valid non-negative amounts.",
    );
  }

  const calendar = state.ownerRateCalendars[categoryId]?.calendar || null;

  const expectedVersion = calendar?.rateProduct?.version ?? null;

  const propertyId = byId("calendarPropertySelect").value;

  const fingerprint = [
    propertyId,
    categoryId,
    baseRateMinor,
    extraAdultMinor,
    extraChildMinor,
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
        extraAdultMinor,
        extraChildMinor,
        expectedVersion,
      },
      idempotencyKey: key,
    },
  );

  await refreshCalendarData();

  pendingOwnerBaseRateKeys.delete(fingerprint);

  showMessage(`${category.name} base rate setup saved.`);
}

async function saveOwnerCategoryCalendar(categoryId, stayDates = null) {
  return persistOwnerCategoryCalendar(categoryId, {
    refreshAfterSave: true,
    announce: true,
    stayDates,
  });
}

async function persistOwnerCategoryCalendar(
  categoryId,
  { refreshAfterSave, announce, stayDates = null },
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

  const targetDates = stayDates ? new Set(stayDates) : null;
  const targetDays = targetDates
    ? calendar.days.filter((day) => targetDates.has(day.stayDate))
    : calendar.days;

  if (!targetDays.length) {
    throw new Error("Choose at least one loaded date to update.");
  }

  const entries = targetDays.map((day) => {
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
        stayDates: selectedDates,
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

  const missingRateCount = categories.filter(
    (category) => state.ownerRateCalendars[category.id]?.status === "MISSING",
  ).length;
  const calendarContext = byId("calendarContext");

  calendarContext.classList.toggle("owner-rate-warning", missingRateCount > 0);
  calendarContext.textContent = missingRateCount
    ? `Action required: Set a base EP rate for ${missingRateCount} room ${
        missingRateCount === 1 ? "category" : "categories"
      }. Guest search cannot provide a bookable price until rate setup is complete.`
    : "Click any inventory or price cell to edit it. Use Earlier and Later to move through dates without a fixed limit.";

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

    if (!defaultsReady) {
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
          calendar
            ? productSynced
              ? "Base rate"
              : "Sync category setup"
            : "Set base rate",
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

      const extraAdultInput = document.createElement("input");
      extraAdultInput.type = "number";
      extraAdultInput.min = "0";
      extraAdultInput.step = "0.01";
      extraAdultInput.placeholder = "Extra adult";
      extraAdultInput.title = "Default extra adult rate";
      extraAdultInput.dataset.ownerExtraAdult = category.id;
      extraAdultInput.value = (
        (category.defaultExtraAdultMinor ?? 0) / 100
      ).toFixed(2);

      const extraChildInput = document.createElement("input");
      extraChildInput.type = "number";
      extraChildInput.min = "0";
      extraChildInput.step = "0.01";
      extraChildInput.placeholder = "Extra kid";
      extraChildInput.title = "Default extra kid rate";
      extraChildInput.dataset.ownerExtraChild = category.id;
      extraChildInput.value = (
        (category.defaultExtraChildMinor ?? 0) / 100
      ).toFixed(2);

      const rateFields = document.createElement("div");
      rateFields.className = "owner-base-rate-fields";
      for (const [label, control] of [
        ["Room base", rateInput],
        ["Extra adult", extraAdultInput],
        ["Extra kid", extraChildInput],
      ]) {
        const wrapper = document.createElement("label");
        wrapper.append(textElement("span", "", label), control);
        rateFields.append(wrapper);
      }

      const setupButton = textElement(
        "button",
        "button-secondary owner-base-rate-button",
        calendar
          ? productSynced
            ? "Update base rate"
            : "Sync setup"
          : "Set base rate",
      );

      setupButton.type = "button";
      setupButton.addEventListener("click", () =>
        run(() => configureOwnerCategoryBaseRate(category.id)),
      );

      setupBox.append(rateFields, setupButton);

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
        display.classList.toggle("owner-rate-inherited", day.source === "BASE");
        display.title =
          day.source === "BASE"
            ? "Using the base rate. Click to override this date only."
            : "Date-specific override. Click to edit.";

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
              await saveOwnerCategoryCalendar(category.id, [date]);
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

byId("reviewStatus").addEventListener("change", () => {
  state.reviewFilterTouched = true;
  run(() => loadReviews(false));
});
byId("loadMoreReviews").addEventListener("click", () =>
  run(() => loadReviews(true)),
);

async function loadReviews(append) {
  const selectedStatus = byId("reviewStatus").value;
  const cursor = append ? state.reviewCursor : null;
  const data = await api(reviewQueuePath(selectedStatus, cursor));
  state.reviewItems = append
    ? [...state.reviewItems, ...data.items]
    : data.items;
  state.reviewCursor = data.nextCursor;
  byId("loadMoreReviews").classList.toggle("hidden", !state.reviewCursor);
  const contextCopy = {
    "": "All submitted properties and active review stages are shown below.",
    SUBMITTED: "New submissions waiting for a Wildleaf reviewer to begin.",
    UNDER_REVIEW: "Properties currently being checked by Wildleaf management.",
    CHANGES_REQUIRED: "Properties returned to owners for updates.",
    APPROVED: "Approved properties waiting for activation.",
  };
  byId("reviewQueueContext").textContent = contextCopy[selectedStatus] || "";
  renderReviewList();
}

function renderReviewList() {
  const list = byId("reviewList");
  list.replaceChildren();
  if (!state.reviewItems.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state card review-queue-empty";
    empty.append(
      textElement("strong", "", "No properties awaiting this review"),
      textElement(
        "p",
        "",
        byId("reviewStatus").value
          ? "No properties are currently in this selected stage. Choose All active reviews to see every submission."
          : "There are no submitted or active review-stage properties. Draft and live hotels remain available in All Hotels.",
      ),
    );
    if (availableScreens(state.session).includes("hotels")) {
      const openDirectory = button(
        "View all hotels",
        () => void run(() => showScreen("hotels")),
      );
      openDirectory.type = "button";
      empty.append(openDirectory);
    }
    list.append(empty);
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

function homepageMediaUrl(mediaId) {
  return `/v1/public/homepage/media/${encodeURIComponent(mediaId)}`;
}

function homepageDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function homepageUtcDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Campaign date and time is invalid.");
  }
  return date.toISOString();
}

function homepageNumberOrDefault(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized === "" ? fallback : Number(normalized);
}

let homepageAcknowledgementTimer = null;

function showHomepageAcknowledgement(message) {
  let notice = document.getElementById("homepageSaveAcknowledgement");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "homepageSaveAcknowledgement";
    notice.className = "notice hidden";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    notice.style.position = "fixed";
    notice.style.right = "1.5rem";
    notice.style.bottom = "1.5rem";
    notice.style.zIndex = "1200";
    notice.style.maxWidth = "24rem";
    notice.style.boxShadow = "0 10px 30px rgba(20, 45, 34, 0.18)";
    document.body.append(notice);
  }

  notice.textContent = `✓ ${message}`;
  notice.classList.remove("hidden");
  if (homepageAcknowledgementTimer) {
    clearTimeout(homepageAcknowledgementTimer);
  }
  homepageAcknowledgementTimer = setTimeout(() => {
    notice.classList.add("hidden");
  }, 4000);
}

function homepageDestinationKey(destination) {
  return JSON.stringify([
    destination.city,
    destination.stateRegion || null,
    destination.countryCode,
  ]);
}

function parseHomepageDestinationKey(value) {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length !== 3) {
    throw new Error("Choose a valid live destination.");
  }
  return {
    city: String(parsed[0] || ""),
    stateRegion: parsed[1] ? String(parsed[1]) : null,
    countryCode: String(parsed[2] || ""),
  };
}

async function loadHomepageContent() {
  if (!canManageHomepageContent(state.session)) {
    throw new Error("Your Wildleaf role cannot manage homepage content.");
  }
  const [data] = await Promise.all([
    api("/v1/platform/homepage-content"),
    loadAdminPropertyTaxonomy(),
  ]);
  const heroSlides = data.heroSlides || [];
  const destinationImages = data.destinationImages || [];

  await Promise.all(
    [...heroSlides, ...destinationImages].map(async (item) => {
      try {
        const preview = await api(
          `/v1/platform/homepage-content/media/${item.imageId}/read-url`,
        );
        item.previewUrl = preview.url || "";
      } catch {
        item.previewUrl = "";
      }
    }),
  );

  state.homepageContent = {
    heroSlides,
    destinationImages,
    liveDestinations: data.liveDestinations || [],
  };
  renderHomepageContent();
}

function renderHomepageContent() {
  renderHomepageHeroSlides();
  renderEntirePropertyHeroSlides();
  renderHomepageDestinationOptions();
  renderHomepageDestinationImages();
  renderPropertyTaxonomyManager();
}

function homepageEmpty(message) {
  return textElement("p", "empty-state", message);
}

function renderHomepageHeroSlides() {
  renderHeroSlidesForPlacement(
    "HOME",
    "homepageHeroList",
    "No managed homepage hero slides yet. The guest homepage will keep its existing fallback hero.",
  );
}

function renderEntirePropertyHeroSlides() {
  renderHeroSlidesForPlacement(
    "ENTIRE_PROPERTY",
    "entirePropertyHeroList",
    "No Entire Property campaign yet. The page will simply start with search and live stays.",
  );
}

function renderHeroSlidesForPlacement(placement, listId, emptyMessage) {
  const list = byId(listId);
  if (!list) return;
  list.replaceChildren();
  list.classList.add("partner-slide-stack");
  const slides = (state.homepageContent.heroSlides || []).filter(
    (slide) => slide.placement === placement,
  );
  if (!slides.length) {
    list.append(homepageEmpty(emptyMessage));
    return;
  }

  for (const [index, slide] of slides.entries()) {
    const card = document.createElement("article");
    card.className = "homepage-content-item";

    const preview = document.createElement("div");
    preview.className = "homepage-content-preview hero-preview";
    const image = document.createElement("img");
    image.src = slide.previewUrl || homepageMediaUrl(slide.imageId);
    image.alt = slide.altText || slide.headline || "";
    image.loading = "lazy";
    image.style.objectPosition = `${slide.focalXPercent}% ${slide.focalYPercent}%`;
    preview.append(image);

    const overlay = document.createElement("div");
    overlay.className = "homepage-preview-overlay";
    if (slide.offerLabel) {
      overlay.append(
        textElement("span", "homepage-preview-offer", slide.offerLabel),
      );
    }
    if (slide.headline) {
      overlay.append(textElement("strong", "", slide.headline));
    }
    if (slide.subtitle) {
      overlay.append(textElement("small", "", slide.subtitle));
    }
    if (overlay.childElementCount) {
      preview.append(overlay);
    }

    const status = document.createElement("div");
    status.className = "homepage-content-status";
    status.append(
      textElement(
        "span",
        slide.enabled ? "status-pill complete" : "status-pill",
        slide.enabled ? "Enabled" : "Hidden",
      ),
      textElement(
        "small",
        "muted",
        `Order ${slide.sortOrder} · version ${slide.version}`,
      ),
    );

    const form = document.createElement("form");
    form.className = "form-grid two-column homepage-inline-editor";
    form.innerHTML = `
      <label class="span-two">Headline <span class="optional">optional</span><input name="headline" maxlength="160" /></label>
      <label class="span-two">Subtitle <span class="optional">optional</span><input name="subtitle" maxlength="300" /></label>
      <label>Offer / banner <span class="optional">optional</span><input name="offerLabel" maxlength="80" /></label>
      <label>Display order <span class="optional">optional</span><input name="sortOrder" type="number" min="0" max="10000" /></label>
      <label>CTA text <span class="optional">optional</span><input name="ctaLabel" maxlength="60" /></label>
      <label>CTA link <span class="optional">optional</span><input name="ctaHref" maxlength="500" /></label>
      <label>Starts at <span class="optional">optional</span><input name="startsAt" type="datetime-local" /></label>
      <label>Ends at <span class="optional">optional</span><input name="endsAt" type="datetime-local" /></label>
      <label>Horizontal focal point (%) <span class="optional">optional</span><input name="focalXPercent" type="number" min="0" max="100" /></label>
      <label>Vertical focal point (%) <span class="optional">optional</span><input name="focalYPercent" type="number" min="0" max="100" /></label>
      <label class="span-two">Image description <span class="optional">optional</span><input name="altText" maxlength="500" /></label>
      <label class="check-control span-two"><input name="enabled" type="checkbox" /> Publish this slide</label>
      <button class="span-two" type="submit">Save slide settings</button>
    `;
    form.elements.headline.value = slide.headline || "";
    form.elements.subtitle.value = slide.subtitle || "";
    form.elements.offerLabel.value = slide.offerLabel || "";
    form.elements.sortOrder.value = String(slide.sortOrder);
    form.elements.ctaLabel.value = slide.ctaLabel || "";
    form.elements.ctaHref.value = slide.ctaHref || "";
    form.elements.startsAt.value = homepageDateTimeLocal(slide.startsAt);
    form.elements.endsAt.value = homepageDateTimeLocal(slide.endsAt);
    form.elements.focalXPercent.value = String(slide.focalXPercent);
    form.elements.focalYPercent.value = String(slide.focalYPercent);
    form.elements.altText.value = slide.altText || "";
    form.elements.enabled.checked = Boolean(slide.enabled);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void run(async () => {
        const values = Object.fromEntries(new FormData(form));
        await idempotent(
          `/v1/platform/homepage-content/hero-slides/${slide.id}`,
          "PUT",
          "homepage-hero-update",
          {
            placement: slide.placement || placement,
            headline: String(values.headline || "").trim(),
            subtitle: String(values.subtitle || "").trim() || null,
            offerLabel: String(values.offerLabel || "").trim() || null,
            ctaLabel: String(values.ctaLabel || "").trim() || null,
            ctaHref: String(values.ctaHref || "").trim() || null,
            altText: String(values.altText || "").trim() || null,
            focalXPercent: homepageNumberOrDefault(values.focalXPercent, 50),
            focalYPercent: homepageNumberOrDefault(values.focalYPercent, 50),
            sortOrder: homepageNumberOrDefault(values.sortOrder, 0),
            enabled: form.elements.enabled.checked,
            startsAt: homepageUtcDateTime(form.elements.startsAt.value),
            endsAt: homepageUtcDateTime(form.elements.endsAt.value),
            version: slide.version,
          },
        );
        await loadHomepageContent();
        showMessage("✓ Homepage hero slide saved successfully.");
        showHomepageAcknowledgement("Homepage hero slide saved successfully.");
      });
    });

    const imageForm = document.createElement("form");
    imageForm.className = "homepage-image-replace-form";
    imageForm.innerHTML = `
      <label>Replace image
        <input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/avif" required />
      </label>
      <label>Image description
        <input name="altText" maxlength="500" />
      </label>
      <button type="submit">Replace image</button>
    `;
    imageForm.elements.altText.value = slide.altText || "";
    imageForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void run(async () => {
        const file = imageForm.elements.file.files[0];
        if (!file) throw new Error("Choose a hero image.");
        if (file.size > 8 * 1024 * 1024) {
          throw new Error("Hero images must be 8 MB or smaller.");
        }
        const query = new URLSearchParams({
          version: String(slide.version),
        });
        const altText = imageForm.elements.altText.value.trim();
        if (altText) query.set("altText", altText);
        await managedUpload(
          `/v1/platform/homepage-content/hero-slides/${slide.id}/image?${query}`,
          file,
          "homepage-hero-image-replace",
        );
        await loadHomepageContent();
        showMessage("✓ Homepage hero image replaced successfully.");
        showHomepageAcknowledgement(
          "Homepage hero image replaced successfully.",
        );
      });
    });

    const archive = button(
      "Archive slide",
      async () => {
        await api(`/v1/platform/homepage-content/hero-slides/${slide.id}`, {
          method: "DELETE",
          body: { version: slide.version },
          idempotencyKey: newIdempotencyKey("homepage-hero-archive"),
        });
        await loadHomepageContent();
        showMessage("Hero campaign archived.");
      },
      "danger-button",
    );

    const actions = document.createElement("div");
    actions.className = "homepage-content-actions";
    actions.append(imageForm, archive);

    const disclosure = document.createElement("details");
    disclosure.className = "partner-slide";
    disclosure.dataset.slideId = slide.id;
    const summary = document.createElement("summary");
    summary.className = "partner-slide-summary";
    const thumb = document.createElement("img");
    thumb.className = "partner-slide-thumb";
    thumb.src = image.src;
    thumb.alt = "";
    thumb.loading = "lazy";
    const summaryText = document.createElement("span");
    summaryText.className = "partner-slide-titleblock";
    summaryText.append(
      textElement("strong", "", `Campaign slide ${index + 1}`),
      textElement("small", "", slide.headline || "Untitled campaign"),
    );
    const summaryMeta = document.createElement("span");
    summaryMeta.className = slide.enabled
      ? "partner-slide-state enabled"
      : "partner-slide-state";
    summaryMeta.textContent = slide.enabled ? "Published" : "Hidden";
    summary.append(thumb, summaryText, summaryMeta);
    const body = document.createElement("div");
    body.className = "partner-slide-body";
    body.append(preview, status, form, actions);
    disclosure.append(summary, body);
    disclosure.addEventListener("toggle", () => {
      if (!disclosure.open) return;
      list.querySelectorAll("details.partner-slide").forEach((other) => {
        if (other !== disclosure) other.open = false;
      });
    });
    list.append(disclosure);
  }
}

function renderHomepageDestinationOptions() {
  const select = byId("homepageDestinationSelect");
  select.replaceChildren();

  const configuredKeys = new Set(
    (state.homepageContent.destinationImages || []).map((image) =>
      homepageDestinationKey(image),
    ),
  );
  const available = (state.homepageContent.liveDestinations || []).filter(
    (destination) => !configuredKeys.has(homepageDestinationKey(destination)),
  );

  if (!available.length) {
    const option = textElement(
      "option",
      "",
      "All current live destinations already have managed images",
    );
    option.value = "";
    select.append(option);
    select.disabled = true;
    byId("homepageDestinationForm").querySelector(
      'button[type="submit"]',
    ).disabled = true;
    return;
  }

  select.disabled = false;
  byId("homepageDestinationForm").querySelector(
    'button[type="submit"]',
  ).disabled = false;
  const placeholder = textElement("option", "", "Choose a live destination");
  placeholder.value = "";
  placeholder.selected = true;
  placeholder.disabled = true;
  select.append(placeholder);

  for (const destination of available) {
    const option = textElement(
      "option",
      "",
      `${destination.city}${destination.stateRegion ? `, ${destination.stateRegion}` : ""} · ${destination.propertyCount} ${destination.propertyCount === 1 ? "property" : "properties"}`,
    );
    option.value = homepageDestinationKey(destination);
    select.append(option);
  }
}

function renderHomepageDestinationImages() {
  const list = byId("homepageDestinationList");
  list.replaceChildren();
  const images = state.homepageContent.destinationImages || [];
  if (!images.length) {
    list.append(
      homepageEmpty(
        "No destination photography has been assigned yet. Live destinations will keep the simple fallback treatment.",
      ),
    );
    return;
  }

  for (const destination of images) {
    const card = document.createElement("article");
    card.className = "homepage-content-item destination-content-item";

    const preview = document.createElement("div");
    preview.className = "homepage-content-preview destination-preview";
    const image = document.createElement("img");
    image.src = destination.previewUrl || homepageMediaUrl(destination.imageId);
    image.alt =
      destination.altText ||
      `${destination.city}${destination.stateRegion ? `, ${destination.stateRegion}` : ""}`;
    image.loading = "lazy";
    preview.append(image);
    const label = document.createElement("div");
    label.className = "homepage-destination-preview-label";
    label.append(
      textElement("strong", "", destination.city),
      textElement(
        "small",
        "",
        destination.stateRegion || destination.countryCode,
      ),
    );
    preview.append(label);

    const form = document.createElement("form");
    form.className = "form-grid two-column homepage-inline-editor";
    form.innerHTML = `
      <label>Display order<input name="sortOrder" type="number" min="0" max="10000" required /></label>
      <label class="check-control"><input name="enabled" type="checkbox" /> Show this image</label>
      <label class="span-two">Image description<input name="altText" maxlength="500" /></label>
      <button class="span-two" type="submit">Save destination settings</button>
    `;
    form.elements.sortOrder.value = String(destination.sortOrder);
    form.elements.enabled.checked = Boolean(destination.enabled);
    form.elements.altText.value = destination.altText || "";

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void run(async () => {
        await idempotent(
          `/v1/platform/homepage-content/destination-images/${destination.id}`,
          "PUT",
          "homepage-destination-update",
          {
            altText: form.elements.altText.value.trim() || null,
            sortOrder: Number(form.elements.sortOrder.value),
            enabled: form.elements.enabled.checked,
            version: destination.version,
          },
        );
        await loadHomepageContent();
        showMessage("✓ Destination homepage settings saved successfully.");
        showHomepageAcknowledgement(
          "Destination homepage settings saved successfully.",
        );
      });
    });

    const imageForm = document.createElement("form");
    imageForm.className = "homepage-image-replace-form";
    imageForm.innerHTML = `
      <label>Replace image
        <input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/avif" required />
      </label>
      <label>Image description
        <input name="altText" maxlength="500" />
      </label>
      <button type="submit">Replace image</button>
    `;
    imageForm.elements.altText.value = destination.altText || "";
    imageForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void run(async () => {
        const file = imageForm.elements.file.files[0];
        if (!file) throw new Error("Choose a destination image.");
        if (file.size > 8 * 1024 * 1024) {
          throw new Error("Destination images must be 8 MB or smaller.");
        }
        const query = new URLSearchParams({
          version: String(destination.version),
        });
        const altText = imageForm.elements.altText.value.trim();
        if (altText) query.set("altText", altText);
        await managedUpload(
          `/v1/platform/homepage-content/destination-images/${destination.id}/image?${query}`,
          file,
          "homepage-destination-image-replace",
        );
        await loadHomepageContent();
        showMessage("✓ Destination image replaced successfully.");
        showHomepageAcknowledgement("Destination image replaced successfully.");
      });
    });

    const archive = button(
      "Remove image",
      async () => {
        await api(
          `/v1/platform/homepage-content/destination-images/${destination.id}`,
          {
            method: "DELETE",
            body: { version: destination.version },
            idempotencyKey: newIdempotencyKey("homepage-destination-archive"),
          },
        );
        await loadHomepageContent();
        showMessage("Destination image removed from homepage management.");
      },
      "danger-button",
    );

    const actions = document.createElement("div");
    actions.className = "homepage-content-actions";
    actions.append(imageForm, archive);

    card.append(preview, form, actions);
    list.append(card);
  }
}

function taxonomyEditorDisclosure(label, description, card, list) {
  const details = document.createElement("details");
  details.className = "partner-taxonomy-item";
  const summary = document.createElement("summary");
  const title = textElement("strong", "", label);
  const context = textElement("small", "muted", description);
  const titleGroup = document.createElement("span");
  titleGroup.className = "partner-taxonomy-label";
  titleGroup.append(title, context);
  summary.append(titleGroup);
  details.append(summary, card);
  details.addEventListener("toggle", () => {
    if (!details.open) return;
    list.querySelectorAll("details.partner-taxonomy-item").forEach((other) => {
      if (other !== details) other.open = false;
    });
  });
  list.append(details);
}

function setupTaxonomyCreateDisclosures() {
  const grid = document.querySelector("#homepageScreen .taxonomy-admin-grid");
  if (!grid || grid.dataset.disclosuresReady === "true") return;
  grid.dataset.disclosuresReady = "true";
  for (const [id, label] of [
    ["propertyCategoryCreateForm", "Add new property category"],
    ["propertyTypeCreateForm", "Add new property type"],
  ]) {
    const form = byId(id);
    if (!form) continue;
    const details = document.createElement("details");
    details.className = "partner-taxonomy-create";
    details.append(textElement("summary", "", label));
    form.replaceWith(details);
    details.append(form);
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      grid
        .querySelectorAll("details.partner-taxonomy-create")
        .forEach((other) => {
          if (other !== details) other.open = false;
        });
    });
  }
}

setupTaxonomyCreateDisclosures();

function renderPropertyTaxonomyManager() {
  const typeCategorySelect = byId("taxonomyTypeCategory");
  populateTaxonomyCategorySelect(typeCategorySelect, typeCategorySelect.value, {
    includeDisabled: true,
    placeholder: "Choose parent category",
  });

  const categoryList = byId("propertyCategoryAdminList");
  categoryList.replaceChildren();
  for (const [index, category] of (
    state.propertyTaxonomy.categories || []
  ).entries()) {
    const card = document.createElement("article");
    card.className = "homepage-content-item taxonomy-content-item";

    const form = document.createElement("form");
    form.className = "form-grid two-column homepage-inline-editor";
    form.innerHTML = `
      <label class="span-two">Category name<input name="name" maxlength="120" required /></label>
      <label class="span-two">Homepage heading<input name="homepageHeading" maxlength="160" required /></label>
      <label>Display order<input name="sortOrder" type="number" min="0" max="10000" required /></label>
      <label class="check-control"><input name="homepageVisible" type="checkbox" /> Show on homepage when populated</label>
      <label class="check-control span-two"><input name="enabled" type="checkbox" /> Available for setup and search</label>
      <button class="span-two" type="submit">Save category</button>
    `;
    form.elements.name.value = category.name;
    form.elements.homepageHeading.value = category.homepageHeading;
    form.elements.sortOrder.value = String(category.sortOrder);
    form.elements.homepageVisible.checked = Boolean(category.homepageVisible);
    form.elements.enabled.checked = Boolean(category.enabled);

    const status = document.createElement("div");
    status.className = "homepage-content-status";
    status.append(
      textElement(
        "span",
        category.enabled ? "status-pill complete" : "status-pill",
        category.enabled ? "Enabled" : "Disabled",
      ),
      textElement(
        "small",
        "muted",
        `Order ${category.sortOrder} · version ${category.version}`,
      ),
    );

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void run(async () => {
        await idempotent(
          `/v1/platform/property-taxonomy/categories/${category.id}`,
          "PUT",
          "property-category-update",
          {
            name: form.elements.name.value.trim(),
            homepageHeading: form.elements.homepageHeading.value.trim(),
            sortOrder: Number(form.elements.sortOrder.value),
            homepageVisible: form.elements.homepageVisible.checked,
            enabled: form.elements.enabled.checked,
            version: category.version,
          },
        );
        await loadHomepageContent();
        showHomepageAcknowledgement("Property Category saved successfully.");
      });
    });

    card.append(status, form);
    taxonomyEditorDisclosure(
      `Category ${index + 1}: ${category.name}`,
      category.enabled ? "Active" : "Disabled",
      card,
      categoryList,
    );
  }

  const typeList = byId("propertyTypeAdminList");
  typeList.replaceChildren();
  for (const [index, propertyType] of (
    state.propertyTaxonomy.types || []
  ).entries()) {
    const parent = taxonomyCategoryById(propertyType.categoryId);
    const card = document.createElement("article");
    card.className = "homepage-content-item taxonomy-content-item";

    const heading = document.createElement("div");
    heading.className = "homepage-content-status";
    heading.append(
      textElement("strong", "", propertyType.name),
      textElement("small", "muted", parent?.name || "Unknown category"),
    );

    const form = document.createElement("form");
    form.className = "form-grid two-column homepage-inline-editor";
    form.innerHTML = `
      <label class="span-two">Property Type name<input name="name" maxlength="120" required /></label>
      <label>Display order<input name="sortOrder" type="number" min="0" max="10000" required /></label>
      <label class="check-control"><input name="enabled" type="checkbox" /> Available for setup and search</label>
      <button class="span-two" type="submit">Save property type</button>
    `;
    form.elements.name.value = propertyType.name;
    form.elements.sortOrder.value = String(propertyType.sortOrder);
    form.elements.enabled.checked = Boolean(propertyType.enabled);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void run(async () => {
        await idempotent(
          `/v1/platform/property-taxonomy/types/${propertyType.id}`,
          "PUT",
          "property-type-update",
          {
            name: form.elements.name.value.trim(),
            sortOrder: Number(form.elements.sortOrder.value),
            enabled: form.elements.enabled.checked,
            version: propertyType.version,
          },
        );
        await loadHomepageContent();
        showHomepageAcknowledgement("Property Type saved successfully.");
      });
    });

    card.append(heading, form);
    taxonomyEditorDisclosure(
      `Type ${index + 1}: ${propertyType.name}`,
      `Under ${parent?.name || "Unknown category"} · ${propertyType.enabled ? "Active" : "Disabled"}`,
      card,
      typeList,
    );
  }
}

byId("propertyCategoryCreateForm").addEventListener("submit", (event) => {
  event.preventDefault();
  void run(async () => {
    const form = event.currentTarget;
    await idempotent(
      "/v1/platform/property-taxonomy/categories",
      "POST",
      "property-category-create",
      {
        name: form.elements.name.value.trim(),
        homepageHeading: form.elements.homepageHeading.value.trim(),
        sortOrder: Number(form.elements.sortOrder.value),
        homepageVisible: form.elements.homepageVisible.checked,
        enabled: form.elements.enabled.checked,
      },
    );
    form.reset();
    form.elements.sortOrder.value = "0";
    form.elements.homepageVisible.checked = true;
    form.elements.enabled.checked = true;
    await loadHomepageContent();
    showHomepageAcknowledgement("Property Category added successfully.");
  });
});

byId("propertyTypeCreateForm").addEventListener("submit", (event) => {
  event.preventDefault();
  void run(async () => {
    const form = event.currentTarget;
    await idempotent(
      "/v1/platform/property-taxonomy/types",
      "POST",
      "property-type-create",
      {
        categoryId: form.elements.categoryId.value,
        name: form.elements.name.value.trim(),
        sortOrder: Number(form.elements.sortOrder.value),
        enabled: form.elements.enabled.checked,
      },
    );
    form.reset();
    form.elements.sortOrder.value = "0";
    form.elements.enabled.checked = true;
    await loadHomepageContent();
    showHomepageAcknowledgement("Property Type added successfully.");
  });
});

function bindHeroCreateForm(formId, placement, successLabel) {
  const form = byId(formId);
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void run(async () => {
      const values = Object.fromEntries(new FormData(form));
      const file = form.elements.file.files[0];
      if (!file) throw new Error("Choose a hero image.");
      if (file.size > 8 * 1024 * 1024) {
        throw new Error("Hero images must be 8 MB or smaller.");
      }

      const query = new URLSearchParams({
        placement,
        focalXPercent: String(
          homepageNumberOrDefault(values.focalXPercent, 50),
        ),
        focalYPercent: String(
          homepageNumberOrDefault(values.focalYPercent, 50),
        ),
        sortOrder: String(homepageNumberOrDefault(values.sortOrder, 0)),
        enabled: String(form.elements.enabled.checked),
      });
      for (const [key, value] of [
        ["headline", String(values.headline || "").trim()],
        ["subtitle", String(values.subtitle || "").trim()],
        ["offerLabel", String(values.offerLabel || "").trim()],
        ["ctaLabel", String(values.ctaLabel || "").trim()],
        ["ctaHref", String(values.ctaHref || "").trim()],
        ["altText", String(values.altText || "").trim()],
        ["startsAt", homepageUtcDateTime(form.elements.startsAt.value) || ""],
        ["endsAt", homepageUtcDateTime(form.elements.endsAt.value) || ""],
      ]) {
        if (value) query.set(key, value);
      }

      await managedUpload(
        `/v1/platform/homepage-content/hero-slides?${query}`,
        file,
        `homepage-hero-create-${placement.toLowerCase()}`,
      );
      form.reset();
      form.elements.focalXPercent.value = "50";
      form.elements.focalYPercent.value = "50";
      form.elements.sortOrder.value = "0";
      form.elements.enabled.checked = true;
      await loadHomepageContent();
      showMessage(`✓ ${successLabel}`);
      showHomepageAcknowledgement(successLabel);
    });
  });
}

bindHeroCreateForm(
  "homepageHeroCreateForm",
  "HOME",
  "Homepage hero slide added successfully.",
);
bindHeroCreateForm(
  "entirePropertyHeroCreateForm",
  "ENTIRE_PROPERTY",
  "Entire Property campaign added successfully.",
);

byId("homepageDestinationForm").addEventListener("submit", (event) => {
  event.preventDefault();
  void run(async () => {
    const form = event.currentTarget;
    const destination = parseHomepageDestinationKey(
      form.elements.destinationKey.value,
    );
    const file = form.elements.file.files[0];
    if (!file) throw new Error("Choose a destination image.");
    if (file.size > 8 * 1024 * 1024) {
      throw new Error("Destination images must be 8 MB or smaller.");
    }

    const query = new URLSearchParams({
      city: destination.city,
      countryCode: destination.countryCode,
      sortOrder: String(Number(form.elements.sortOrder.value)),
      enabled: String(form.elements.enabled.checked),
    });
    if (destination.stateRegion) {
      query.set("stateRegion", destination.stateRegion);
    }
    const altText = form.elements.altText.value.trim();
    if (altText) query.set("altText", altText);

    await managedUpload(
      `/v1/platform/homepage-content/destination-images?${query}`,
      file,
      "homepage-destination-create",
    );
    form.reset();
    form.elements.sortOrder.value = "0";
    form.elements.enabled.checked = true;
    await loadHomepageContent();
    showMessage("✓ Destination image saved successfully.");
    showHomepageAcknowledgement("Destination image saved successfully.");
  });
});

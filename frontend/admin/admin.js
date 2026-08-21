import {
  authorizedRequest,
  newIdempotencyKey,
  uploadFile,
} from "./api-client.js";
import {
  availableScreens,
  canReviewProperties,
  editableProperty,
  profilePayload,
  reviewQueuePath,
} from "./portal-state.js";

const auth = firebase.auth();
const pendingUploadKeys = new Map();
const state = {
  session: null,
  screen: null,
  organizationId: null,
  properties: [],
  property: null,
  onboarding: null,
  layout: null,
  reviewItems: [],
  reviewCursor: null,
  reviewSelection: null,
};

const byId = (id) => document.getElementById(id);
const authView = byId("authView");
const portal = byId("portal");
const portalMessage = byId("portalMessage");

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
  const key = pendingUploadKeys.get(fingerprint) || newIdempotencyKey(operation);
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
  business: ["Owner onboarding", "Set up your business"],
  properties: ["Partner portal", "Your properties"],
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

  if (name === "properties") await loadProperties();
  if (name === "reviews") await loadReviews(false);
}

byId("refreshButton").addEventListener("click", () =>
  run(async () => {
    await loadSession();
    if (state.screen === "properties") await loadProperties();
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
  const data = Object.fromEntries(new FormData(event.currentTarget));
  run(async () => {
    const result = await idempotent(
      `/v1/partner/organizations/${state.organizationId}/properties`,
      "POST",
      "property-create",
      { name: data.name.trim(), timezone: data.timezone.trim() },
    );
    event.currentTarget.reset();
    event.currentTarget.timezone.value = "Asia/Kolkata";
    event.currentTarget.classList.add("hidden");
    await openProperty(state.organizationId, result.property.id);
    showMessage(
      "Property draft created. Complete the profile and onboarding checklist.",
    );
  });
});

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

  const data = await api(
    `/v1/partner/organizations/${state.organizationId}/properties`,
  );
  state.properties = data.properties || [];
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

function renderEditor() {
  const property = state.property;
  const onboarding = state.onboarding;
  byId("editorPropertyName").textContent = property.name;
  byId("editorStatus").textContent = property.status.replaceAll("_", " ");
  fillForm(byId("profileForm"), property);
  fillForm(byId("policiesForm"), onboarding.policies || {});
  byId("amenitiesForm").elements.codes.value = (onboarding.amenities || [])
    .map((item) => item.code)
    .join(", ");

  const editable = editableProperty(property.status);
  for (const form of [
    byId("profileForm"),
    byId("policiesForm"),
    byId("amenitiesForm"),
    byId("roomCategoryForm"),
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

function renderAccommodation(editable) {
  const categories = state.layout?.roomCategories || [];
  const units = state.layout?.physicalUnits || [];
  const categorySelect = byId("unitRoomCategory");
  categorySelect.replaceChildren();
  if (!categories.length) {
    const option = textElement("option", "", "Add a room category first");
    option.value = "";
    categorySelect.append(option);
  }
  for (const category of categories) {
    const option = textElement(
      "option",
      "",
      `${category.code} · ${category.name}`,
    );
    option.value = category.id;
    categorySelect.append(option);
  }
  categorySelect.disabled = !editable || !categories.length;

  const list = byId("accommodationList");
  list.replaceChildren();
  if (!categories.length) {
    list.append(
      textElement(
        "p",
        "empty-state",
        "No room categories or physical units added yet.",
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
        `${category.accommodationType} · max ${category.maxOccupancy} guests · ${categoryUnits.length} physical unit${categoryUnits.length === 1 ? "" : "s"}`,
      ),
    );
    if (categoryUnits.length) {
      copy.append(
        textElement(
          "small",
          "muted",
          categoryUnits
            .map((unit) => unit.displayName || unit.unitCode)
            .join(", "),
        ),
      );
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
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const codes = [
      ...new Set(
        values.codes
          .split(",")
          .map((code) => code.trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
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
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await idempotent(
      `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/room-categories`,
      "POST",
      "room-category-create",
      {
        code: values.code.trim().toUpperCase(),
        name: values.name.trim(),
        accommodationType: values.accommodationType,
        baseOccupancy: Number(values.baseOccupancy),
        maxAdults: Number(values.maxAdults),
        maxChildren: Number(values.maxChildren),
        maxOccupancy: Number(values.maxOccupancy),
        ...(values.bedConfiguration.trim()
          ? { bedConfiguration: values.bedConfiguration.trim() }
          : {}),
      },
    );
    event.currentTarget.reset();
    await refreshEditorData();
    showMessage("Room category added.");
  });
});

byId("physicalUnitForm").addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await idempotent(
      `/v1/partner/organizations/${state.property.organizationId}/properties/${state.property.id}/units`,
      "POST",
      "physical-unit-create",
      {
        roomCategoryId: values.roomCategoryId,
        unitCode: values.unitCode.trim().toUpperCase(),
        ...(values.displayName.trim()
          ? { displayName: values.displayName.trim() }
          : {}),
        hasView: values.hasView === "on",
        ...(values.hasView === "on" && values.viewLabel.trim()
          ? { viewLabel: values.viewLabel.trim() }
          : {}),
        smokingPolicy: "NON_SMOKING",
      },
    );
    event.currentTarget.reset();
    await refreshEditorData();
    showMessage("Physical unit added.");
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

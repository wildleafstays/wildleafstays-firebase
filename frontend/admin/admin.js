import { authorizedRequest, newIdempotencyKey } from "./api-client.js";
import {
  availableScreens,
  canReviewProperties,
  editableProperty,
  profilePayload,
  reviewQueuePath,
} from "./portal-state.js";

const auth = firebase.auth();
const state = {
  session: null,
  screen: null,
  organizationId: null,
  properties: [],
  property: null,
  onboarding: null,
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
  const [profile, onboarding] = await Promise.all([
    api(`/v1/partner/organizations/${organizationId}/properties/${propertyId}`),
    api(
      `/v1/partner/organizations/${organizationId}/properties/${propertyId}/onboarding`,
    ),
  ]);
  state.property = profile.property;
  state.onboarding = onboarding;
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
    if (onboarding.property.status === "UNDER_REVIEW") {
      const actions = document.createElement("div");
      actions.className = "document-actions";
      actions.append(
        button("Verify", () => reviewDocument(documentRecord.id, "VERIFIED")),
        button(
          "Reject",
          () => reviewDocument(documentRecord.id, "REJECTED"),
          "danger-button",
        ),
      );
      row.append(actions);
    }
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

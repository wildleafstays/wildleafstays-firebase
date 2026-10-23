import { apiRequest } from "./api-client.js";

const params = new URLSearchParams(location.search);
const form = document.querySelector("#destinationSearchForm");
const results = document.querySelector("#destinationResults");
const resultsHeading = document.querySelector("#resultsHeading");
const resultsSummary = document.querySelector("#resultsSummary");
const sortResults = document.querySelector("#sortResults");
const childAgeFields = document.querySelector("#childAgeFields");
const modeTabs = [...document.querySelectorAll("[data-mode]")];

const state = {
  mode:
    params.get("privateStay") === "1" || params.get("stayMode") === "entire"
      ? "entire"
      : params.get("stayMode") === "room"
        ? "rooms"
        : "all",
  properties: [],
  details: new Map(),
  searchVersion: 0,
};

configureSearch();
wireEvents();
void initialize();

function wireEvents() {
  form.children.addEventListener("change", renderChildAgeFields);
  form.arrivalDate.addEventListener("change", () => {
    form.departureDate.min = addDays(form.arrivalDate.value, 1);
    if (form.departureDate.value <= form.arrivalDate.value) {
      form.departureDate.value = form.departureDate.min;
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const childAges = selectedChildAges();
    if (childAges.some((age) => !Number.isInteger(age))) {
      resultsSummary.textContent = "Please select the age of every child.";
      return;
    }
    const nextDestination = form.destination.value.trim();
    const currentDestination = destinationLabel();
    if (slugify(nextDestination) !== slugify(currentDestination)) {
      location.assign(destinationPageUrl(nextDestination));
      return;
    }
    history.pushState(null, "", destinationPageUrl(nextDestination));
    void loadProperties();
  });

  modeTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.mode = tab.dataset.mode;
      syncModeTabs();
      void loadProperties();
    });
  });

  sortResults.addEventListener("change", renderProperties);
}

async function initialize() {
  const destination = destinationLabel();
  document.title = `${destination} stays | Wildleaf Stays`;
  resultsHeading.textContent = destination;
  form.destination.value = destination;
  syncModeTabs();
  await loadProperties();
}

function configureSearch() {
  const today = dateValue(new Date());
  const arrival = validDate(params.get("arrivalDate")) && params.get("arrivalDate") >= today
    ? params.get("arrivalDate")
    : addDays(today, 1);
  const departure = validDate(params.get("departureDate")) && params.get("departureDate") > arrival
    ? params.get("departureDate")
    : addDays(arrival, 2);

  form.arrivalDate.min = today;
  form.arrivalDate.value = arrival;
  form.departureDate.min = addDays(arrival, 1);
  form.departureDate.value = departure;
  form.rooms.value = String(clamp(Number(params.get("rooms") || 1), 1, 20));
  form.adults.value = String(clamp(Number(params.get("adults") || 2), 1, 10));
  form.children.value = String(clamp(Number(params.get("children") || 0), 0, 6));
  renderChildAgeFields();

  const ages = String(params.get("childAges") || "")
    .split(",")
    .filter(Boolean)
    .map(Number);
  [...childAgeFields.querySelectorAll("select")].forEach((select, index) => {
    if (Number.isInteger(ages[index]) && ages[index] >= 0 && ages[index] <= 17) {
      select.value = String(ages[index]);
    }
  });
}

function renderChildAgeFields() {
  const count = clamp(Number(form.children.value || 0), 0, 6);
  const previous = [...childAgeFields.querySelectorAll("select")].map((field) => field.value);
  childAgeFields.replaceChildren();
  for (let index = 0; index < count; index += 1) {
    const label = element("label");
    label.append(element("span", "", `Child ${index + 1} age`));
    const select = document.createElement("select");
    select.required = true;
    select.append(new Option("Select age", ""));
    for (let age = 0; age <= 17; age += 1) {
      select.append(new Option(age === 0 ? "Under 1" : `${age} years`, String(age)));
    }
    select.value = previous[index] ?? "";
    label.append(select);
    childAgeFields.append(label);
  }
}

async function loadProperties() {
  const searchVersion = ++state.searchVersion;
  renderLoading();
  resultsSummary.textContent = "Checking available stays…";
  resultsHeading.textContent = destinationLabel();

  try {
    const childAges = selectedChildAges();
    if (childAges.some((age) => !Number.isInteger(age))) {
      throw new Error("Please select the age of every child before searching.");
    }

    const properties = [];
    let offset = 0;
    for (let page = 0; page < 20; page += 1) {
      const response = await apiRequest("/v1/public/smartstay/search", {
        method: "POST",
        body: {
          destination: form.destination.value.trim(),
          arrivalDate: form.arrivalDate.value,
          departureDate: form.departureDate.value,
          adults: Number(form.adults.value),
          childAges,
          requestedRooms: Number(form.rooms.value),
          exclusive: state.mode === "entire",
          limit: 25,
          offset,
        },
      });
      if (searchVersion !== state.searchVersion) return;
      properties.push(...(response.properties || []));
      if (response.nextOffset === null || response.nextOffset === undefined) break;
      offset = response.nextOffset;
    }

    state.properties = properties.filter((property) => {
      if (state.mode === "rooms") return property.saleMode !== "FULL_PROPERTY_ONLY";
      if (state.mode === "entire") {
        return property.saleMode === "FULL_PROPERTY_ONLY" || property.saleMode === "BOTH";
      }
      return true;
    });
    renderProperties();
    await hydratePropertyDetails(state.properties, searchVersion);
  } catch (error) {
    if (searchVersion !== state.searchVersion) return;
    results.replaceChildren(emptyState("We could not load these stays", error.message));
    resultsSummary.textContent = error.message || "Live availability could not be loaded.";
  }
}

async function hydratePropertyDetails(properties, searchVersion) {
  const queue = properties
    .filter((property) => !state.details.has(property.publicSlug))
    .slice(0, 24);
  for (let index = 0; index < queue.length; index += 4) {
    await Promise.all(queue.slice(index, index + 4).map(async (property) => {
      try {
        const response = await apiRequest(
          `/v1/public/properties/${encodeURIComponent(property.publicSlug)}`,
          { cache: "default" },
        );
        state.details.set(property.publicSlug, response.property || null);
      } catch {
        state.details.set(property.publicSlug, null);
      }
    }));
    if (searchVersion !== state.searchVersion) return;
  }
  if (queue.length && searchVersion === state.searchVersion) renderProperties();
}

function renderProperties() {
  const properties = [...state.properties];
  if (sortResults.value === "price-low") {
    properties.sort((a, b) => priceOf(a) - priceOf(b));
  } else if (sortResults.value === "price-high") {
    properties.sort((a, b) => priceOf(b) - priceOf(a));
  } else if (sortResults.value === "name") {
    properties.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    properties.sort((a, b) => {
      if (Boolean(a.smartstayCheckUnavailable) !== Boolean(b.smartstayCheckUnavailable)) {
        return a.smartstayCheckUnavailable ? 1 : -1;
      }
      return priceOf(a) - priceOf(b);
    });
  }

  if (!properties.length) {
    results.replaceChildren(
      emptyState(
        `No matching stays in ${destinationLabel()}`,
        "Try different dates, fewer rooms or another way to stay.",
      ),
    );
    resultsSummary.textContent = "No properties match the current search.";
    return;
  }

  results.replaceChildren(...properties.map(propertyCard));
  const verified = properties.filter((property) => !property.smartstayCheckUnavailable).length;
  resultsSummary.textContent =
    `${verified} ${verified === 1 ? "stay" : "stays"} available` +
    (properties.length > verified ? ` · ${properties.length - verified} to confirm` : "");
}

function propertyCard(property, index) {
  const card = element("article", "destination-card");
  const url = propertyUrl(property);
  const media = element("a", "destination-card-media");
  media.href = url;
  media.setAttribute("aria-label", `View ${property.name}`);
  if (property.coverMediaId) {
    const image = element("img");
    image.src = `/v1/public/properties/${encodeURIComponent(property.publicSlug)}/media/${encodeURIComponent(property.coverMediaId)}`;
    image.alt = property.name;
    image.loading = index < 3 ? "eager" : "lazy";
    image.decoding = "async";
    media.append(image);
  } else {
    media.append(element("span", "destination-card-placeholder", property.name.charAt(0)));
  }
  media.append(
    element(
      "span",
      "destination-card-badge",
      property.propertyTypeName || property.propertyCategoryName || "Wildleaf stay",
    ),
  );

  const body = element("div", "destination-card-body");
  const detail = state.details.get(property.publicSlug);
  const locationLabel = [property.locality, property.city, property.stateRegion]
    .filter(Boolean)
    .join(", ");
  body.append(
    element("p", "destination-card-location", locationLabel),
    element("h3", "", property.name),
  );

  if (property.shortDescription) {
    body.append(element("p", "destination-card-description", property.shortDescription));
  }

  const summary = element("div", "destination-card-summary");
  const guestCount = Number(form.adults.value || 0) + Number(form.children.value || 0);
  const requestedRooms = Number(form.rooms.value || 1);
  const roomTypeCount = detail?.roomCategories?.length || 0;
  const flexible = property.saleMode === "BOTH";
  const entire = property.smartstaySuggestedMode === "villa" || property.saleMode === "FULL_PROPERTY_ONLY";
  summary.append(
    element("span", "", `${guestCount} ${guestCount === 1 ? "guest" : "guests"} matched`),
    element(
      "span",
      "",
      roomTypeCount
        ? `${roomTypeCount} room ${roomTypeCount === 1 ? "type" : "types"}`
        : `${requestedRooms} ${requestedRooms === 1 ? "room" : "rooms"} requested`,
    ),
    element("span", "", flexible ? "Rooms + entire stay" : entire ? "Entire property" : "Private rooms"),
  );
  body.append(summary);

  const facts = element("div", "destination-card-facts");
  const amenities = (detail?.amenities || []).slice(0, 3);
  if (amenities.length) {
    amenities.forEach((amenity) => facts.append(element("span", "", amenity.name)));
  } else {
    facts.append(
      element("span", "", flexible ? "Flexible booking" : entire ? "Private property" : "Room booking"),
      element("span", "", property.propertyTypeName || property.propertyCategoryName || "Wildleaf stay"),
    );
  }
  body.append(facts);

  const offer = element("aside", "destination-card-offer");
  const status = element(
    "span",
    property.smartstayCheckUnavailable
      ? "destination-card-status is-pending"
      : "destination-card-status",
    property.smartstayCheckUnavailable ? "Availability to confirm" : "Available for your dates",
  );
  offer.append(status, element("span", "destination-card-price-label", "Stay total"));
  if (Number.isSafeInteger(property.smartstayEstimateMinor)) {
    offer.append(
      element("strong", "", money(property.smartstayEstimateMinor, property.smartstayCurrency)),
      element(
        "small",
        "",
        `${tripNights()} ${tripNights() === 1 ? "night" : "nights"} · taxes shown before payment`,
      ),
    );
  } else {
    offer.append(
      element("strong", "", "Check live options"),
      element("small", "", "Final availability confirmed on the property page"),
    );
  }
  const link = element("a", "button button-primary", "View stay");
  link.href = url;
  link.setAttribute("aria-label", `View ${property.name}`);
  link.append(element("span", "destination-card-arrow", "→"));
  offer.append(link);
  card.append(media, body, offer);
  return card;
}

function propertyUrl(property) {
  const search = searchParams();
  return `/stays/${encodeURIComponent(slugify(destinationLabel()))}/${encodeURIComponent(property.publicSlug)}?${search}`;
}

function destinationPageUrl(destination) {
  return `/stays/${encodeURIComponent(slugify(destination))}?${searchParams(destination)}`;
}

function searchParams(destination = form.destination.value.trim()) {
  const search = new URLSearchParams({
    destination,
    arrivalDate: form.arrivalDate.value,
    departureDate: form.departureDate.value,
    rooms: form.rooms.value,
    adults: form.adults.value,
    children: form.children.value,
    childAges: selectedChildAges().filter(Number.isInteger).join(","),
    stayMode: state.mode === "rooms" ? "room" : state.mode,
  });
  if (state.mode === "entire") search.set("privateStay", "1");
  return search;
}

function syncModeTabs() {
  modeTabs.forEach((item) => {
    const active = item.dataset.mode === state.mode;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-pressed", String(active));
  });
}

function destinationLabel() {
  const queryDestination = params.get("destination")?.trim();
  if (queryDestination) return queryDestination;
  const segments = location.pathname.split("/").filter(Boolean);
  const slug = segments[0] === "stays" ? segments[1] : "";
  if (!slug || slug === "all-destinations") return "All destinations";
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function selectedChildAges() {
  return [...childAgeFields.querySelectorAll("select")].map((select) =>
    select.value === "" ? NaN : Number(select.value),
  );
}

function renderLoading() {
  results.replaceChildren(
    ...Array.from({ length: 6 }, () => element("div", "destination-loading")),
  );
}

function emptyState(title, copy) {
  const empty = element("div", "destination-empty");
  empty.append(element("h3", "", title), element("p", "muted", copy));
  return empty;
}

function priceOf(property) {
  return Number.isSafeInteger(property.smartstayEstimateMinor)
    ? property.smartstayEstimateMinor
    : Number.MAX_SAFE_INTEGER;
}

function money(minor, currencyCode) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currencyCode || "INR",
    maximumFractionDigits: 0,
  }).format(Number(minor || 0) / 100);
}

function tripNights() {
  const arrival = new Date(`${form.arrivalDate.value}T12:00:00`);
  const departure = new Date(`${form.departureDate.value}T12:00:00`);
  return Math.max(1, Math.round((departure - arrival) / 86400000));
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "all-destinations";
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}

function dateValue(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateValue(date);
}

function clamp(value, minimum, maximum) {
  const safe = Number.isFinite(value) ? value : minimum;
  return Math.min(maximum, Math.max(minimum, safe));
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

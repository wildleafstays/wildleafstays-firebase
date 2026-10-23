import { ApiError, apiRequest } from "./api-client.js";

const form = document.querySelector("#searchForm");
const results = document.querySelector("#results");
const resultsTitle = document.querySelector("#resultsTitle");
const resultsStatus = document.querySelector("#resultsStatus");
const destinationList = document.querySelector("#destinationList");
const resultsEyebrow = document.querySelector("#resultsEyebrow");
const propertyCategorySelect = document.querySelector("#propertyCategory");
const propertyTypeSelect = document.querySelector("#propertyType");
const stayModeSelect = document.querySelector("#stayMode");
const destinationRail = document.querySelector("#destinationRail");
const mobileSearchLabel = document.querySelector("#mobileSearchLabel");
const mobileSearchMeta = document.querySelector("#mobileSearchMeta");
const hero = document.querySelector(".home-hero");
const heroContent = document.querySelector(".hero-content");
const heroImage = document.querySelector("#heroImage");
const heroOffer = document.querySelector("#heroOffer");
const heroEyebrow = document.querySelector("#heroEyebrow");
const heroHeadline = document.querySelector("#heroHeadline");
const heroSubtitle = document.querySelector("#heroSubtitle");
const heroCta = document.querySelector("#heroCta");
const heroSliderControls = document.querySelector("#heroSliderControls");
const heroPrevious = document.querySelector("#heroPrevious");
const heroNext = document.querySelector("#heroNext");
const heroDots = document.querySelector("#heroDots");

const initialSearch = new URLSearchParams(location.search);
const requestedMode = initialSearch.get("mode");
if (requestedMode === "villa") initialSearch.set("privateStay", "1");
if (requestedMode) {
  initialSearch.delete("mode");
  history.replaceState(null, "", location.pathname +
    (initialSearch.toString() ? `?${initialSearch}` : ""));
}

const state = {
  properties: [],
  heroSlides: [],
  heroIndex: 0,
  heroTimer: null,
  searchVersion: 0,
  propertyTaxonomy: {
    categories: [],
    types: [],
  },
};

setDefaultDates();
restoreSearchFromUrl(initialSearch);
configureChildAgeFields();
form.children.addEventListener("change", configureChildAgeFields);
stayModeSelect?.addEventListener("change", () => {
  form.elements.namedItem("privateStay").checked = stayModeSelect.value === "entire";
  updateMobileSearchSummary();
});

// Stay-style choice belongs to the results experience, not the homepage search.
const discoveryToolbar = document.querySelector("#discoveryToolbar");
const discoveryLocationTitle = document.querySelector("#discoveryLocationTitle");
const resultsSection = document.querySelector("#stays");
const modeTabs = [...document.querySelectorAll("[data-stay-mode]")];
function syncDiscoveryMode() {
  const current = stayModeSelect?.value || "all";
  for (const tab of modeTabs) {
    const active = tab.dataset.stayMode === current;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-pressed", String(active));
  }
}
function showDiscoveryResults() {
  if (resultsSection) resultsSection.hidden = false;
  if (discoveryToolbar) discoveryToolbar.hidden = false;
  if (discoveryLocationTitle) {
    discoveryLocationTitle.textContent = form.destination.value.trim()
      ? `Stays in ${form.destination.value.trim()}`
      : "Explore all stays";
  }
  syncDiscoveryMode();
}
modeTabs.forEach((tab) => tab.addEventListener("click", () => {
  if (!stayModeSelect) return;
  stayModeSelect.value = tab.dataset.stayMode;
  form.elements.namedItem("privateStay").checked = stayModeSelect.value === "entire";
  syncDiscoveryMode();
  void loadProperties();
}));
if (resultsSection) resultsSection.hidden = !initialSearch.has("destination");

void initialize();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const childAges = selectedChildAges();
  const children = Math.max(0, Number(form.children.value) || 0);
  if (
    childAges.length !== children ||
    childAges.some((age) => !Number.isInteger(age))
  ) {
    renderError(new Error("Please select the age of each child before searching."));
    return;
  }
  location.assign(destinationUrl(form.destination.value.trim()));
});

form.addEventListener("input", updateMobileSearchSummary);
form.addEventListener("change", updateMobileSearchSummary);

function isValidSearchDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function restoreSearchFromUrl(params) {
  for (const key of ["destination", "arrivalDate", "departureDate", "rooms", "adults", "children"]) {
    const input = form.elements.namedItem(key);
    if (!input || !params.has(key)) continue;
    const value = params.get(key);
    if (key.includes("Date")) {
      if (!isValidSearchDate(value)) continue;
      if (key === "arrivalDate" && value < input.min) continue;
    } else if (key !== "destination") {
      if (!/^\d{1,2}$/.test(value || "")) continue;
      const number = Number(value);
      if (number < Number(input.min || 0) || number > Number(input.max || 100)) continue;
    }
    input.value = value;
  }
  const privacy = form.elements.namedItem("privateStay");
  if (privacy) privacy.checked = params.get("privateStay") === "1";
  if (stayModeSelect) stayModeSelect.value = privacy?.checked ? "entire" : (params.get("stayMode") === "room" ? "room" : "all");
  form.departureDate.min = addDays(form.arrivalDate.value, 1);
  if (form.departureDate.value <= form.arrivalDate.value) {
    form.departureDate.value = form.departureDate.min;
  }
}

async function initialize() {
  renderLoadingCards();
  const [homepageResult] = await Promise.allSettled([
    loadHomepageContent(),
    loadPropertyTaxonomy(),
  ]);
  if (homepageResult.status === "rejected") {
    await loadDestinations();
  }
  if (initialSearch.has("childAges")) {
    const ages = initialSearch.get("childAges").split(",");
    const fields = document.querySelectorAll("#smartstayChildAgeFields select");
    if (ages.length === fields.length) {
      fields.forEach((field, index) => {
        if (/^\d{1,2}$/.test(ages[index]) && Number(ages[index]) <= 17) {
          field.value = ages[index];
        }
      });
    }
  }
  if (initialSearch.has("destination")) showDiscoveryResults();
  await loadProperties();
}

async function loadPropertyTaxonomy() {
  const data = await apiRequest("/v1/public/property-taxonomy", {
    cache: "default",
  });
  state.propertyTaxonomy = {
    categories: data.categories || [],
    types: data.types || [],
  };
  renderPropertyTaxonomyFilters();
  const savedCategory = initialSearch.get("categoryId");
  const savedType = initialSearch.get("typeId");
  if (savedCategory && [...propertyCategorySelect.options].some(option =>
    option.value === savedCategory)) {
    propertyCategorySelect.value = savedCategory;
    renderPropertyTypeFilter(savedCategory, savedType || "");
  }
}

function renderPropertyTaxonomyFilters() {
  const selectedCategoryId = propertyCategorySelect.value;
  const selectedTypeId = propertyTypeSelect.value;
  const categories = [...(state.propertyTaxonomy.categories || [])].sort(
    (left, right) =>
      Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
      left.name.localeCompare(right.name),
  );

  propertyCategorySelect.replaceChildren();
  const allCategories = element("option", "", "All categories");
  allCategories.value = "";
  propertyCategorySelect.append(allCategories);
  for (const category of categories) {
    const option = element("option", "", category.name);
    option.value = category.id;
    option.selected = category.id === selectedCategoryId;
    propertyCategorySelect.append(option);
  }

  renderPropertyTypeFilter(
    categories.some((category) => category.id === selectedCategoryId)
      ? selectedCategoryId
      : "",
    selectedTypeId,
  );
}

function renderPropertyTypeFilter(categoryId, selectedTypeId = "") {
  const types = (state.propertyTaxonomy.types || [])
    .filter((propertyType) => propertyType.categoryId === categoryId)
    .sort(
      (left, right) =>
        Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
        left.name.localeCompare(right.name),
    );

  propertyTypeSelect.replaceChildren();
  const allTypes = element("option", "", "All property types");
  allTypes.value = "";
  propertyTypeSelect.append(allTypes);

  for (const propertyType of types) {
    const option = element("option", "", propertyType.name);
    option.value = propertyType.id;
    option.selected = propertyType.id === selectedTypeId;
    propertyTypeSelect.append(option);
  }

  propertyTypeSelect.disabled = !categoryId || types.length === 0;
  if (!propertyTypeSelect.disabled && types.some((type) => type.id === selectedTypeId)) {
    propertyTypeSelect.value = selectedTypeId;
  } else {
    propertyTypeSelect.value = "";
  }
}

propertyCategorySelect.addEventListener("change", () => {
  renderPropertyTypeFilter(propertyCategorySelect.value);
  updateMobileSearchSummary();
});

propertyTypeSelect.addEventListener("change", updateMobileSearchSummary);

async function loadHomepageContent() {
  const data = await apiRequest("/v1/public/homepage", {
    cache: "default",
  });
  const destinations = data.destinations || [];
  populateDestinationSuggestions(destinations);
  renderDestinations(destinations);

  state.heroSlides = data.heroSlides || [];
  state.heroIndex = 0;
  if (state.heroSlides.length) {
    renderManagedHero(0);
    renderHeroDots();
    resetHeroTimer();
  } else {
    stopHeroTimer();
    hero?.classList.remove("managed-hero");
    hero?.classList.add("hero-search-only");
    heroContent?.classList.add("hidden");
    heroSliderControls?.classList.add("hidden");
  }
}

function populateDestinationSuggestions(destinations) {
  destinationList.replaceChildren(
    ...destinations.map((destination) => {
      const option = document.createElement("option");
      option.value = destination.city;
      option.label = [destination.city, destination.stateRegion]
        .filter(Boolean)
        .join(", ");
      return option;
    }),
  );
}

async function loadDestinations() {
  try {
    const data = await apiRequest("/v1/public/destinations", {
      cache: "default",
    });
    const destinations = data.destinations || [];
    populateDestinationSuggestions(destinations);
    renderDestinations(destinations);
  } catch {
    destinationRail?.replaceChildren();
    // Property discovery remains usable when destination suggestions are unavailable.
  }
}

function renderDestinations(destinations) {
  if (!destinationRail) return;
  destinationRail.replaceChildren(
    ...destinations.map((destination) => {
      const button = element(
        "button",
        destination.imageId
          ? "destination-card destination-card-image"
          : "destination-card",
      );
      button.type = "button";
      const place = [destination.city, destination.stateRegion]
        .filter(Boolean)
        .join(", ");
      button.setAttribute("aria-label", `Explore stays in ${place}`);

      if (destination.imageId) {
        const image = element("img", "destination-card-photo");
        image.src = homepageMediaUrl(destination.imageId);
        image.alt = destination.altText || place;
        image.loading = "lazy";
        image.decoding = "async";
        button.append(image);
        const shade = element("span", "destination-card-shade");
        button.append(shade);
      } else {
        button.append(
          element(
            "span",
            "destination-mark",
            String(destination.city || "W").trim().charAt(0).toUpperCase(),
          ),
        );
      }

      const copy = element("span", "destination-card-copy");
      copy.append(
        element("strong", "", destination.city),
        element(
          "small",
          "",
          destination.propertyCount
            ? `${destination.propertyCount} ${destination.propertyCount === 1 ? "property" : "properties"}`
            : destination.stateRegion || "",
        ),
      );
      button.append(copy);

      button.addEventListener("click", () => {
        form.destination.value = destination.city;
        updateMobileSearchSummary();
        location.assign(destinationUrl(destination.city));
      });
      return button;
    }),
  );
}

async function loadProperties(destinationOverride = null) {
  if (destinationOverride !== null) {
    form.destination.value = destinationOverride;
  }

  const destination = form.destination.value.trim();
  const categoryId = propertyCategorySelect.value;
  const typeId = propertyTypeSelect.value;

  const searchVersion = ++state.searchVersion;
  resultsStatus.textContent = "Checking stays against your requested dates and guests…";
  renderLoadingCards();
  updateResultsHeading(destination, categoryId, typeId);

  try {
    const adults = Math.max(1, Number(form.adults.value) || 2);
    const childAges = selectedChildAges();
    const children = Math.max(0, Number(form.children.value) || 0);
    if (childAges.length !== children || childAges.some(age => !Number.isInteger(age))) {
      throw new Error("Please select the age of each child before searching.");
    }
    const properties = [];
    let offset = 0;
    for (let page = 0; page < 20; page += 1) {
      if (searchVersion !== state.searchVersion) return;
      const payload = {
        arrivalDate: form.arrivalDate.value,
        departureDate: form.departureDate.value,
        adults,
        childAges,
        requestedRooms: Math.max(1, Number(form.rooms.value) || 1),
        exclusive: Boolean(form.elements.namedItem("privateStay")?.checked),
        ...(destination ? {destination} : {}),
        ...(categoryId ? {categoryId} : {}),
        ...(typeId ? {typeId} : {}),
        limit: 25,
        offset
      };
      const response = await apiRequest("/v1/public/smartstay/search", {
        method: "POST", body: payload
      });
      if (searchVersion !== state.searchVersion) return;
      properties.push(...(response.properties || []));
      if (response.nextOffset === null || response.nextOffset === undefined) break;
      offset = response.nextOffset;
      if (page === 19) throw new Error("Too many search results. Refine your destination.");
    }
    // Sort only verified comparable offers; never rank a failed availability
    // check as cheaper or more suitable than an actual bookable arrangement.
    properties.sort((a, b) => {
      if (Boolean(a.smartstayCheckUnavailable) !== Boolean(b.smartstayCheckUnavailable)) {
        return a.smartstayCheckUnavailable ? 1 : -1;
      }
      if (Boolean(a.smartstayIsAlternative) !== Boolean(b.smartstayIsAlternative)) {
        return a.smartstayIsAlternative ? 1 : -1;
      }
      const aAmount = Number.isSafeInteger(a.smartstayEstimateMinor)
        ? a.smartstayEstimateMinor : Infinity;
      const bAmount = Number.isSafeInteger(b.smartstayEstimateMinor)
        ? b.smartstayEstimateMinor : Infinity;
      return aAmount - bAmount;
    });
    state.properties = properties;
    renderProperties(properties);
  } catch (error) {
    if (searchVersion === state.searchVersion) renderError(error);
  }
}


function configureChildAgeFields() {
  const container = document.querySelector("#smartstayChildAges");
  const fields = document.querySelector("#smartstayChildAgeFields");
  if (!container || !fields) return;
  const count = Math.min(6, Math.max(0, Number(form.children.value) || 0));
  const previous = [...fields.querySelectorAll("select")].map(select => select.value);
  fields.replaceChildren();
  container.style.display = count ? "block" : "none";
  for (let index = 0; index < count; index += 1) {
    const label = document.createElement("label");
    label.style.display = "grid";
    label.style.gap = ".25rem";
    label.textContent = `Child ${index + 1}`;
    const select = document.createElement("select");
    select.className = "smartstay-child-age";
    select.required = true;
    select.setAttribute("aria-label", `Age of child ${index + 1}`);
    const placeholder = new Option("Select age", "");
    select.append(placeholder);
    for (let age = 0; age <= 17; age += 1) {
      select.append(new Option(age === 0 ? "Under 1" : `${age} years`, String(age)));
    }
    select.value = previous[index] ?? "";
    label.append(select);
    fields.append(label);
  }
}

function selectedChildAges() {
  return [...document.querySelectorAll("#smartstayChildAgeFields select")]
    .map(select => select.value === "" ? NaN : Number(select.value));
}

// A preliminary discovery check only: canonical quotes and inventory holds
// still determine the final bookability and all taxes before checkout.
async function matchGuestRequirements(properties) {
  const version = state.searchVersion;
  const arrivalDate = form.arrivalDate.value;
  const departureDate = form.departureDate.value;
  const requestedRooms = Math.max(1, Number(form.rooms.value) || 1);
  const adults = Math.max(1, Number(form.adults.value) || 2);
  const children = Math.max(0, Number(form.children.value) || 0);
  const exclusive = Boolean(form.elements.namedItem("privateStay")?.checked);
  const childAges = selectedChildAges();
  if (childAges.length !== children || childAges.some(age => !Number.isInteger(age))) {
    throw new Error("Please select the age of each child.");
  }
  const validDates = /^\d{4}-\d{2}-\d{2}$/.test(arrivalDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(departureDate) &&
    departureDate > arrivalDate;
  if (!validDates) return [];

  const candidates = properties.filter(p => !exclusive || allowsEntireProperty(p));
  const outcomes = new Array(candidates.length);
  let next = 0;
  // Bound requests. This endpoint is transactional-database backed, not a
  // cached listing feed; do not fire a request storm for a large portfolio.
  await Promise.all(Array.from({length: Math.min(4, candidates.length)}, async () => {
    while (next < candidates.length && version === state.searchVersion) {
      const position = next++;
      const property = candidates[position];
      try {
        const isEntire = exclusive ||
          property.saleMode === "FULL_PROPERTY_ONLY" ||
          (requestedRooms > 6 && allowsEntireProperty(property));
        // Room-mix recommendations currently support at most six rooms.
        // For larger groups, a whole-property offer may still satisfy the trip.
        if (!isEntire && requestedRooms > 6 && !allowsEntireProperty(property)) {
          outcomes[position] = {...property,smartstayCheckUnavailable:true};
          continue;
        }
        let matches = false;
        let estimateMinor = null;
        let currencyCode = "INR";
        let suggestedMode = isEntire ? "villa" : "hotel";
        if (!isEntire && requestedRooms > 1 && requestedRooms <= 6) {
          const response = await apiRequest(
            `/v1/public/properties/${encodeURIComponent(property.publicSlug)}/room-recommendations`,
            {method:"POST",body:{
              arrivalDate,departureDate,adults,
              childAges,requestedRooms
            }}
          );
          // Recommendation payloads vary with available room mixes;
          // never claim availability from a result we cannot substantiate.
          const recommendations = response.recommendations || response.options || [];
          const suitable = Array.isArray(recommendations)
            ? recommendations.filter(item =>
                item.roomCount === requestedRooms &&
                item.adults === adults &&
                item.children === children &&
                Array.isArray(item.items) &&
                item.items.reduce((sum, room) => sum + room.quantity, 0) === requestedRooms
              )
            : [];
          matches = suitable.length > 0;
          if (matches) {
            const offer = [...suitable].sort((a,b) =>
              a.estimatedTotalMinor - b.estimatedTotalMinor)[0];
            if (Number.isSafeInteger(offer.estimatedTotalMinor)) {
              estimateMinor = offer.estimatedTotalMinor;
              currencyCode = offer.currencyCode || "INR";
            }
          }
        } else {
          const units = [{adults,children}];
          const response = await apiRequest(
            `/v1/public/properties/${encodeURIComponent(property.publicSlug)}/availability`,
            {method:"POST",body:{arrivalDate,departureDate,units}}
          );
          const options = (response.options || []).filter(option =>
            option.available &&
            (isEntire ? option.productType === "FULL_PROPERTY" :
              (option.productType === "ROOM_CATEGORY" ||
               option.productType === "FULL_PROPERTY"))
          );
          matches = options.length > 0;
          if (matches) {
            const offer = [...options].sort((a,b) =>
              Number(a.estimatedTotalMinor) - Number(b.estimatedTotalMinor))[0];
            if (Number.isSafeInteger(offer.estimatedTotalMinor)) {
              estimateMinor = offer.estimatedTotalMinor;
              currencyCode = offer.currencyCode || "INR";
            }
            suggestedMode = offer.productType === "FULL_PROPERTY" ? "villa" : "hotel";
          }
        }
        // An entire-property booking can be suitable even when the requested
        // individual-room mix is unavailable. Never silently call it a room match.
        if (!matches && !exclusive && allowsEntireProperty(property)) {
          const response = await apiRequest(
            `/v1/public/properties/${encodeURIComponent(property.publicSlug)}/availability`,
            {method:"POST",body:{
              arrivalDate,departureDate,units:[{adults,children}]
            }}
          );
          const villas = (response.options || []).filter(option =>
            option.productType === "FULL_PROPERTY" && option.available
          ).sort((a,b) => a.estimatedTotalMinor - b.estimatedTotalMinor);
          if (villas.length) {
            matches = true;
            suggestedMode = "villa";
            const villa = villas[0];
            if (Number.isSafeInteger(villa.estimatedTotalMinor)) {
              estimateMinor = villa.estimatedTotalMinor;
              currencyCode = villa.currencyCode || "INR";
            }
          }
        }
        outcomes[position] = matches
          ? {...property,smartstayEstimateMinor:estimateMinor,smartstayCurrency:currencyCode,
            smartstaySuggestedMode:suggestedMode,smartstayIsAlternative:
              suggestedMode === "villa" && !exclusive &&
              property.saleMode !== "FULL_PROPERTY_ONLY"}
          : null;
      } catch {
        // Network/service failures are not evidence that a stay is sold out.
        outcomes[position] = {...property,smartstayCheckUnavailable:true};
      }
    }
  }));
  return outcomes.filter(Boolean);
}

function taxonomyCategory(categoryId) {
  return (state.propertyTaxonomy.categories || []).find(
    (category) => category.id === categoryId,
  );
}

function taxonomyType(typeId) {
  return (state.propertyTaxonomy.types || []).find(
    (propertyType) => propertyType.id === typeId,
  );
}

function updateResultsHeading(destination, categoryId, typeId) {
  if (!resultsEyebrow && !resultsTitle) return;
  const category = taxonomyCategory(categoryId);
  const propertyType = taxonomyType(typeId);
  const label =
    propertyType?.name ||
    category?.homepageHeading ||
    category?.name ||
    "Stay categories";
  const destinationLabel = destination ? ` around ${destination}` : "";
  if (resultsEyebrow) resultsEyebrow.textContent = "";
  if (resultsTitle) resultsTitle.textContent = `${label}${destinationLabel}`;
}

function renderProperties(properties) {
  const exclusiveOnly = Boolean(form.elements.namedItem("privateStay")?.checked);
  const visibleProperties = properties.filter((property) =>
    exclusiveOnly ? allowsEntireProperty(property) :
      stayModeSelect?.value === "room" ? property.saleMode !== "FULL_PROPERTY_ONLY" : true,
  );
  results.replaceChildren();

  if (!visibleProperties.length) {
    resultsStatus.textContent = "No properties match these preferences. Check another destination or remove the exclusive-use requirement.";
    const empty = element("div", "empty-state");
    empty.append(
      element("h3", "", "No stays found"),
      element("p", "", "Try another destination, date or stay mode."),
    );
    results.append(empty);
    return;
  }

  const orderedCategories = [...(state.propertyTaxonomy.categories || [])]
    .filter((category) => category.enabled)
    .sort(
      (left, right) =>
        Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
        left.name.localeCompare(right.name),
    );

  let renderedCount = 0;
  for (const category of orderedCategories) {
    const categoryProperties = visibleProperties.filter(
      (property) => property.propertyCategoryId === category.id,
    );
    if (!categoryProperties.length) continue;

    const section = element("section", "property-category-section");
    section.dataset.categoryId = category.id;

    const heading = element("div", "property-category-heading");
    heading.append(
      element("h2", "", category.homepageHeading || category.name),
      element(
        "span",
        "property-category-count",
        `${categoryProperties.length} ${categoryProperties.length === 1 ? "property" : "properties"}`,
      ),
    );

    const rail = element("div", "property-category-rail");
    categoryProperties.forEach((property, index) => {
      rail.append(propertyCard(property, index));
      renderedCount += 1;
    });

    section.append(heading, rail);
    results.append(section);
  }

  // Published stays must not disappear when taxonomy is missing, inactive,
  // or temporarily unavailable. The search backend already vetted these stays.
  const categorizedIds = new Set(orderedCategories.map((category) => category.id));
  const uncategorized = visibleProperties.filter((property) =>
    !categorizedIds.has(property.propertyCategoryId)
  );
  if (uncategorized.length) {
    const section = element("section", "property-category-section");
    section.dataset.categoryId = "other-stays";
    const heading = element("div", "property-category-heading");
    heading.append(
      element("h2", "", "More Wildleaf stays"),
      element("span", "property-category-count",
        `${uncategorized.length} ${uncategorized.length === 1 ? "property" : "properties"}`)
    );
    const rail = element("div", "property-category-rail");
    uncategorized.forEach((property, index) => {
      rail.append(propertyCard(property, renderedCount + index));
    });
    section.append(heading, rail);
    results.append(section);
    renderedCount += uncategorized.length;
  }

  if (!renderedCount) {
    resultsStatus.textContent = "No visible property categories match these filters.";
    results.append(
      element(
        "div",
        "empty-state",
        "No category section is currently available for these properties.",
      ),
    );
    return;
  }

  const unverified = visibleProperties.filter((property) => property.smartstayCheckUnavailable).length;
  const verified = renderedCount - unverified;
  resultsStatus.textContent =
    `${verified} availability-matched ${verified === 1 ? "stay" : "stays"}` +
    (unverified ? ` · ${unverified} more ${unverified === 1 ? "stay requires" : "stays require"} verification` : "") +
    " · final rates confirmed before booking";
}

function propertyCard(property, index) {
  const article = element("article", "property-card");
  const visual = element("div", `property-visual visual-${(index % 4) + 1}`);
  if (property.coverMediaId) {
    const image = element("img", "property-card-image");
    image.src = propertyMediaUrl(property.publicSlug, property.coverMediaId);
    image.alt = property.name;
    image.loading = index === 0 ? "eager" : "lazy";
    image.decoding = "async";
    visual.classList.add("has-image");
    visual.append(image);
  }

  visual.append(
    element(
      "span",
      "listing-type-badge",
      property.propertyTypeName || property.propertyCategoryName || "Wildleaf stay",
    ),
  );

  const body = element("div", "property-card-body");
  const location = [property.locality, property.city, property.stateRegion]
    .filter(Boolean)
    .join(", ");
  body.append(
    element("p", "property-location", location || property.countryCode),
    element("h3", "", property.name),
  );

  const offerType = property.smartstayCheckUnavailable
    ? "Check availability"
    : property.smartstayIsAlternative
      ? "Exclusive alternative"
      : property.smartstaySuggestedMode === "villa"
        ? "Entire place to yourself"
        : "Rooms available";
  const facts = element("div", "listing-facts");
  const bookingKind = property.smartstaySuggestedMode === "villa"
    ? "⌂ Entire property"
    : property.smartstaySuggestedMode === "hotel"
      ? "▦ Rooms"
      : "⌂ Stay";
  facts.append(
    element("span", "listing-fact", bookingKind),
    element("span", "listing-fact", property.smartstayCheckUnavailable
      ? "◌ Verify availability" : "✓ Dates checked"),
  );
  body.append(facts);
  body.append(element("span", "smartstay-offer-label", offerType));

  if (property.smartstayCheckUnavailable) {
    body.append(element("p", "smartstay-offer-note",
      "Live availability could not be verified. Check the property before booking."));
  } else {
    if (property.smartstaySuggestedMode === "hotel") {
      const rooms = Math.max(1, Number(form.rooms.value) || 1);
      body.append(element("p", "smartstay-offer-note",
        `${rooms} ${rooms === 1 ? "room" : "rooms"} matched for your group and dates`));
    } else {
      body.append(element("p", "smartstay-offer-note",
        property.smartstayIsAlternative
          ? "Your room combination was unavailable. This is an entire-property alternative."
          : "Exclusive use of the whole property on the selected dates."));
    }
    if (Number.isSafeInteger(property.smartstayEstimateMinor)) {
      const price = element("div", "smartstay-price-summary");
      price.append(
        element("strong", "smartstay-price-value",
          formatMinorPrice(property.smartstayEstimateMinor, property.smartstayCurrency)),
        element("span", "smartstay-price-caption", "Estimated accommodation total for selected dates"),
        element("small", "smartstay-price-disclaimer",
          "Excludes GST, fees and discounts · exact total shown before payment")
      );
      body.append(price);
    }
  }
  const link = element("a", "button button-primary property-cta",
    property.smartstaySuggestedMode === "villa" ? "Explore entire property" :
    property.smartstaySuggestedMode === "hotel" ? "Explore available rooms" : "Check this stay");
  link.href = propertyUrl(property);
  link.setAttribute("aria-label", `Explore stay options at ${property.name}`);
  body.append(link);

  article.append(visual, body);
  return article;
}

function homepageMediaUrl(mediaId) {
  return `/v1/public/homepage/media/${encodeURIComponent(mediaId)}`;
}

function renderManagedHero(index) {
  if (!state.heroSlides.length || !hero || !heroImage) return;
  const normalizedIndex =
    ((index % state.heroSlides.length) + state.heroSlides.length) %
    state.heroSlides.length;
  state.heroIndex = normalizedIndex;
  const slide = state.heroSlides[normalizedIndex];

  hero.classList.add("managed-hero");
  hero.classList.remove("hero-search-only");
  hero.classList.remove("has-property-image");
  hero.style.removeProperty("--home-hero-image");
  heroContent?.classList.remove("hidden");

  heroImage.src = homepageMediaUrl(slide.imageId);
  heroImage.alt = slide.altText || "";
  heroImage.style.objectPosition =
    `${slide.focalXPercent}% ${slide.focalYPercent}%`;

  heroEyebrow.textContent = "";
  heroEyebrow.classList.add("hidden");

  heroHeadline.textContent = slide.headline || "";
  heroHeadline.classList.toggle("hidden", !slide.headline);

  heroSubtitle.textContent = slide.subtitle || "";
  heroSubtitle.classList.toggle("hidden", !slide.subtitle);

  heroOffer.textContent = slide.offerLabel || "";
  heroOffer.classList.toggle("hidden", !slide.offerLabel);

  if (slide.ctaLabel && slide.ctaHref) {
    heroCta.textContent = slide.ctaLabel;
    heroCta.href = slide.ctaHref;
    heroCta.classList.remove("hidden");
  } else {
    heroCta.classList.add("hidden");
  }

  heroSliderControls?.classList.toggle("hidden", state.heroSlides.length <= 1);
  updateHeroDotState();
}

function renderHeroDots() {
  if (!heroDots) return;
  heroDots.replaceChildren();
  state.heroSlides.forEach((slide, index) => {
    const dot = element("button", "hero-dot");
    dot.type = "button";
    dot.setAttribute("role", "tab");
    dot.setAttribute(
      "aria-label",
      slide.headline
        ? `Show highlight ${index + 1}: ${slide.headline}`
        : `Show highlight ${index + 1}`,
    );
    dot.addEventListener("click", () => {
      renderManagedHero(index);
      resetHeroTimer();
    });
    heroDots.append(dot);
  });
  updateHeroDotState();
}

function updateHeroDotState() {
  if (!heroDots) return;
  [...heroDots.children].forEach((dot, index) => {
    const active = index === state.heroIndex;
    dot.classList.toggle("active", active);
    dot.setAttribute("aria-selected", String(active));
  });
}

function stepHero(direction) {
  if (state.heroSlides.length <= 1) return;
  renderManagedHero(state.heroIndex + direction);
  resetHeroTimer();
}

function stopHeroTimer() {
  if (state.heroTimer) {
    window.clearInterval(state.heroTimer);
    state.heroTimer = null;
  }
}

function resetHeroTimer() {
  stopHeroTimer();
  if (
    state.heroSlides.length <= 1 ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }
  state.heroTimer = window.setInterval(() => {
    renderManagedHero(state.heroIndex + 1);
  }, 6500);
}

heroPrevious?.addEventListener("click", () => stepHero(-1));
heroNext?.addEventListener("click", () => stepHero(1));
hero?.addEventListener("mouseenter", stopHeroTimer);
hero?.addEventListener("mouseleave", resetHeroTimer);
hero?.addEventListener("focusin", stopHeroTimer);
hero?.addEventListener("focusout", resetHeroTimer);

let heroTouchStartX = null;
hero?.addEventListener(
  "touchstart",
  (event) => {
    heroTouchStartX = event.touches[0]?.clientX ?? null;
  },
  { passive: true },
);
hero?.addEventListener(
  "touchend",
  (event) => {
    if (heroTouchStartX === null) return;
    const endX = event.changedTouches[0]?.clientX ?? heroTouchStartX;
    const delta = endX - heroTouchStartX;
    heroTouchStartX = null;
    if (Math.abs(delta) < 45) return;
    stepHero(delta > 0 ? -1 : 1);
  },
  { passive: true },
);

function propertyMediaUrl(publicSlug, mediaId) {
  return `/v1/public/properties/${encodeURIComponent(publicSlug)}/media/${encodeURIComponent(mediaId)}`;
}

function propertyUrl(property) {
  const params = new URLSearchParams({
    slug: property.publicSlug,
    arrivalDate: form.arrivalDate.value,
    departureDate: form.departureDate.value,
    rooms: form.rooms.value,
    adults: form.adults.value,
    children: form.children.value,
    childAges: selectedChildAges().join(","),
    destination: form.destination.value.trim(),
    ...(propertyCategorySelect.value ? { categoryId: propertyCategorySelect.value } : {}),
    ...(propertyTypeSelect.value ? { typeId: propertyTypeSelect.value } : {}),
  });
  params.delete("slug");
  const destination = slugifyDestination(
    form.destination.value.trim() || property.city || "stays",
  );
  return `/stays/${encodeURIComponent(destination)}/${encodeURIComponent(property.publicSlug)}?${params}`;
}

function destinationUrl(destination) {
  const label = destination || "all-destinations";
  const params = new URLSearchParams({
    destination,
    arrivalDate: form.arrivalDate.value,
    departureDate: form.departureDate.value,
    rooms: form.rooms.value,
    adults: form.adults.value,
    children: form.children.value,
    childAges: selectedChildAges().join(","),
    stayMode: stayModeSelect?.value || "all",
  });
  if (form.elements.namedItem("privateStay")?.checked) {
    params.set("privateStay", "1");
  }
  return `/stays/${encodeURIComponent(slugifyDestination(label))}?${params}`;
}

function slugifyDestination(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "all-destinations";
}

function updateMobileSearchSummary() {
  if (!mobileSearchLabel || !mobileSearchMeta) return;
  const destination = form.destination.value.trim();
  mobileSearchLabel.textContent = destination || "Search destination or stay";

  const adults = Math.max(1, Number(form.adults.value) || 1);
  const children = Math.max(0, Number(form.children.value) || 0);
  const rooms = Math.max(1, Number(form.rooms.value) || 1);
  const guestCount = adults + children;
  const dates =
    form.arrivalDate.value && form.departureDate.value
      ? `${shortDate(form.arrivalDate.value)} – ${shortDate(form.departureDate.value)}`
      : "Add dates";
  const roomLabel = stayModeSelect?.value === "entire"
    ? "entire place"
    : `${rooms} ${rooms === 1 ? "room" : "rooms"}`;
  mobileSearchMeta.textContent =
    `${dates} · ${guestCount} ${guestCount === 1 ? "guest" : "guests"} · ${roomLabel}`;
}

function shortDate(value) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Add dates";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function allowsEntireProperty(property) {
  return property.saleMode === "FULL_PROPERTY_ONLY" || property.saleMode === "BOTH";
}

function formatMinorPrice(minor, currencyCode) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currencyCode || "INR",
    maximumFractionDigits: 0,
  }).format(Number(minor || 0) / 100);
}

function renderLoadingCards() {
  results.replaceChildren(
    ...Array.from({ length: 3 }, () => {
      const card = element("div", "property-card loading-card");
      card.innerHTML =
        "<div></div><div><span></span><span></span><span></span></div>";
      return card;
    }),
  );
}

function renderError(error) {
  const message =
    error instanceof ApiError
      ? error.message
      : "Properties could not be loaded.";
  resultsStatus.textContent = "Live properties are temporarily unavailable.";
  const panel = element("div", "empty-state");
  panel.append(
    element("h3", "", "We couldn’t load the collection"),
    element("p", "", message),
  );
  const retry = element("button", "button button-secondary", "Try again");
  retry.type = "button";
  retry.addEventListener("click", () => void loadProperties());
  panel.append(retry);
  results.replaceChildren(panel);
}

function setDefaultDates() {
  const today = new Date();
  const arrival = new Date(today);
  const departure = new Date(today);
  arrival.setDate(today.getDate() + 1);
  departure.setDate(today.getDate() + 3);
  form.arrivalDate.min = dateValue(today);
  form.departureDate.min = dateValue(arrival);
  form.arrivalDate.value = dateValue(arrival);
  form.departureDate.value = dateValue(departure);

  form.arrivalDate.addEventListener("change", () => {
    const minimumDeparture = addDays(form.arrivalDate.value, 1);
    form.departureDate.min = minimumDeparture;
    if (form.departureDate.value <= form.arrivalDate.value) {
      form.departureDate.value = minimumDeparture;
    }
    updateMobileSearchSummary();
  });
  updateMobileSearchSummary();
}

function dateValue(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function addDays(value, days) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateValue(date);
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

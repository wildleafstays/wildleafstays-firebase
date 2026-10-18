import { ApiError, apiRequest } from "./api-client.js";

const form = document.querySelector("#searchForm");
const results = document.querySelector("#results");
const resultsTitle = document.querySelector("#resultsTitle");
const resultsStatus = document.querySelector("#resultsStatus");
const destinationList = document.querySelector("#destinationList");
const resultsEyebrow = document.querySelector("#resultsEyebrow");
const propertyCategorySelect = document.querySelector("#propertyCategory");
const propertyTypeSelect = document.querySelector("#propertyType");
const destinationRail = document.querySelector("#destinationRail");
const mobileSearchTrigger = document.querySelector("#mobileSearchTrigger");
const mobileSearchClose = document.querySelector("#mobileSearchClose");
const mobileSearchLabel = document.querySelector("#mobileSearchLabel");
const mobileSearchMeta = document.querySelector("#mobileSearchMeta");
const hero = document.querySelector(".home-hero");
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

const requestedMode = new URLSearchParams(location.search).get("mode");
if (requestedMode === "villa") {
  const legacyParams = new URLSearchParams(location.search);
  legacyParams.delete("mode");
  const suffix = legacyParams.toString() ? `?${legacyParams}` : "";
  location.replace(`/customer/entire-properties.html${suffix}`);
} else if (requestedMode) {
  const normalizedParams = new URLSearchParams(location.search);
  normalizedParams.delete("mode");
  history.replaceState(
    null,
    "",
    normalizedParams.toString()
      ? `${location.pathname}?${normalizedParams}`
      : location.pathname,
  );
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
void initialize();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  closeMobileSearch();
  void loadProperties();
  document.querySelector("#stays")?.scrollIntoView({
    block: "start",
    behavior: "smooth",
  });
});

mobileSearchTrigger?.addEventListener("click", openMobileSearch);
mobileSearchClose?.addEventListener("click", closeMobileSearch);
form.addEventListener("input", updateMobileSearchSummary);
form.addEventListener("change", updateMobileSearchSummary);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMobileSearch();
});

async function initialize() {
  renderLoadingCards();
  const [homepageResult] = await Promise.allSettled([
    loadHomepageContent(),
    loadPropertyTaxonomy(),
  ]);
  if (homepageResult.status === "rejected") {
    await loadDestinations();
  }
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
    heroSliderControls?.classList.add("hidden");
    updateHero(state.properties);
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
        void loadProperties(destination.city);
        document.querySelector("#stays")?.scrollIntoView({
          block: "start",
          behavior: "smooth",
        });
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

  const query = new URLSearchParams({ limit: "100" });
  if (destination) query.set("destination", destination);
  if (categoryId) query.set("categoryId", categoryId);
  if (typeId) query.set("typeId", typeId);

  try {
    const properties = [];
    let offset = 0;
    while (true) {
      query.set("offset", String(offset));
      const data = await apiRequest(`/v1/public/properties?${query}`, {
        cache: "default",
      });
      const page = data.properties || [];
      properties.push(...page);
      if (page.length < 100) break;
      offset += page.length;
    }
    const matched = await matchGuestRequirements(properties);
    if (searchVersion !== state.searchVersion) return;
    state.properties = matched;
    renderProperties(state.properties);
  } catch (error) {
    renderError(error);
  }
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
        if (!exclusive && requestedRooms > 6 &&
            property.saleMode !== "FULL_PROPERTY_ONLY") {
          outcomes[position] = {...property,smartstayCheckUnavailable:true};
          continue;
        }
        const isEntire = exclusive || property.saleMode === "FULL_PROPERTY_ONLY";
        let matches = false;
        let estimateMinor = null;
        let currencyCode = "INR";
        if (!isEntire && requestedRooms > 1 && requestedRooms <= 6) {
          const response = await apiRequest(
            `/v1/public/properties/${encodeURIComponent(property.publicSlug)}/room-recommendations`,
            {method:"POST",body:{
              arrivalDate,departureDate,adults,
              childAges:Array.from({length:children},()=>8),requestedRooms
            }}
          );
          // Recommendation payloads vary with available room mixes;
          // never claim availability from a result we cannot substantiate.
          const recommendations = response.recommendations || response.options || [];
          const suitable = Array.isArray(recommendations)
            ? recommendations.filter(item => item.roomCount === requestedRooms)
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
          const units = isEntire
            ? [{adults,children}]
            : [{adults,children}];
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
          }
        }
        outcomes[position] = matches
          ? {...property,smartstayEstimateMinor:estimateMinor,smartstayCurrency:currencyCode}
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
    exclusiveOnly ? allowsEntireProperty(property) : true,
  );
  updateHero(visibleProperties);
  results.replaceChildren();

  if (!visibleProperties.length) {
    resultsStatus.textContent = "No properties match these preferences. Check another destination or remove the exclusive-use requirement.";
    const empty = element("div", "empty-state");
    empty.append(
      element("h3", "", "No stays found"),
      element("p", "", "Try another destination, category or Property Type."),
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

  resultsStatus.textContent =
    `${renderedCount} live ${renderedCount === 1 ? "property" : "properties"} across ${results.children.length} ${results.children.length === 1 ? "category" : "categories"}`;
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

  if (property.saleMode !== "FULL_PROPERTY_ONLY" &&
      property.startingRoomRateMinor !== null && property.startingRoomRateMinor !== undefined) {
    const price = element("p", "property-card-price");
    price.append(
      element("span", "", "From"),
      element(
        "strong",
        "",
        formatMinorPrice(property.startingRoomRateMinor, property.currencyCode || "INR"),
      ),
      element("span", "", "/ night"),
    );
    body.append(price);
  }

  if (allowsEntireProperty(property)) {
    body.append(element("p", "property-location", property.saleMode === "BOTH"
      ? "Rooms or exclusive use — choose your stay"
      : "Exclusive entire-property accommodation"));
  }
  if (property.smartstayCheckUnavailable) {
    body.append(element("p", "property-location",
      "Availability could not be checked — verify on property page"));
  } else if (property.smartstayEstimateMinor !== null &&
             property.smartstayEstimateMinor !== undefined) {
    body.append(element("p", "property-location",
      `Date-specific estimate: ${formatMinorPrice(property.smartstayEstimateMinor,
        property.smartstayCurrency)} · before tax and fees`));
  }
  const link = element("a", "button button-primary property-cta", "Explore this stay");
  link.href = propertyUrl(property);
  link.setAttribute("aria-label", `Explore stay options at ${property.name}`);
  body.append(link);

  article.append(visual, body);
  return article;
}

function updateHero(properties) {
  if (state.heroSlides.length) return;
  const featured = properties.find((property) => property.coverMediaId);
  if (!hero || !featured) {
    hero?.classList.remove("has-property-image");
    hero?.style.removeProperty("--home-hero-image");
    return;
  }

  hero.style.setProperty(
    "--home-hero-image",
    `url("${propertyMediaUrl(featured.publicSlug, featured.coverMediaId)}")`,
  );
  hero.classList.add("has-property-image");
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
  hero.classList.remove("has-property-image");
  hero.style.removeProperty("--home-hero-image");

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
    mode: form.elements.namedItem("privateStay")?.checked ||
      property.saleMode === "FULL_PROPERTY_ONLY" ? "villa" : "hotel",
  });
  return `/customer/property.html?${params}`;
}

function openMobileSearch() {
  document.body.classList.add("home-search-open");
  mobileSearchTrigger?.setAttribute("aria-expanded", "true");
  window.setTimeout(() => form.destination?.focus(), 50);
}

function closeMobileSearch() {
  document.body.classList.remove("home-search-open");
  mobileSearchTrigger?.setAttribute("aria-expanded", "false");
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
  const roomLabel = form.elements.namedItem("privateStay")?.checked
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
  return date.toISOString().slice(0, 10);
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

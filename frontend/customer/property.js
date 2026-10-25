import {
  ApiError,
  apiRequest,
  loadBookingSession,
  operationKey,
  saveBookingSession,
} from "./api-client.js";
import { mountMobileSearch } from "./mobile-search.js";

const query = new URLSearchParams(location.search);
const pathSegments = location.pathname.split("/").filter(Boolean);
const checkoutView = pathSegments[0] === "checkout";
const pathSlug = checkoutView
  ? pathSegments[1]
  : pathSegments[0] === "stays" && pathSegments.length >= 3
    ? pathSegments[2]
    : "";
const publicSlug = String(query.get("slug") || pathSlug || "")
  .trim()
  .toLowerCase();
const propertyContent = document.querySelector("#propertyContent");
const pageError = document.querySelector("#pageError");
const form = document.querySelector("#availabilityForm");
const occupancyUnits = document.querySelector("#occupancyUnits");
const availabilityResults = document.querySelector("#availabilityResults");
const availabilityMessage = document.querySelector("#availabilityMessage");
const quoteSection = document.querySelector("#quoteSection");
const guestSection = document.querySelector("#guestSection");
const statusSection = document.querySelector("#statusSection");
const smartMatchSection = document.querySelector("#smartMatchSection");
const smartMatchIntro = document.querySelector("#smartMatchIntro");
const smartMatchMessage = document.querySelector("#smartMatchMessage");
const smartRecommendations = document.querySelector("#smartRecommendations");
const selectionRibbon = document.querySelector("#selectionRibbon");
const selectionSummary = document.querySelector("#selectionSummary");
const selectionDates = document.querySelector("#selectionDates");
const selectionAllocation = document.querySelector("#selectionAllocation");
const selectionNotice = document.querySelector("#selectionNotice");
const selectionTotal = document.querySelector("#selectionTotal");
const selectionContinue = document.querySelector("#selectionContinue");
const entirePropertyOffer = document.querySelector("#entirePropertyOffer");
const roomChoiceDivider = document.querySelector("#roomChoiceDivider");

const state = {
  property: null,
  units: [],
  availability: null,
  quote: null,
  roomMixQuote: null,
  hold: null,
  session: publicSlug ? loadBookingSession(publicSlug) : {},
  countdownTimer: null,
  pollTimer: null,
  pollAttempts: 0,
  polling: false,
  selectionType: null,
  entireAvailability: null,
  entireSelection: null,
  allowsRooms: true,
  allowsEntire: false,
  requestedRooms: clamp(Number(query.get("rooms") || 1), 1, 20),
  availabilityTimer: null,
  availabilityRequestVersion: 0,
  galleryMedia: [],
  photoMedia: [],
  galleryIndex: 0,
  recommendationRequestVersion: 0,
  roomSelections: new Map(),
  selectionPricingTimer: null,
  selectionPricingVersion: 0,
  entirePricingTimer: null,
  entirePricingVersion: 0,
  categoryAvailabilityCounts: new Map(),
  availabilityProbeCache: new Map(),
};

if (!publicSlug) {
  showPageError(
    "This property link is incomplete. Return to the collection and choose a stay.",
  );
} else {
  configureInitialSearch();
  wireEvents();
  mountMobileSearch({
    form,
    arrivalInput: form.arrivalDate,
    departureInput: form.departureDate,
    adultsInput: form.adults,
    kidsInput: form.children,
    roomsInput: form.unitCount,
    childAgeSelector: "#occupancyUnits select",
    sourceElements: [
      form.querySelector(".date-grid"),
      form.querySelector(".planner-party-grid"),
      occupancyUnits,
      form.querySelector(".planner-update-button"),
    ],
    variant: "property",
  });
  void loadProperty();
}

function wireEvents() {
  form.arrivalDate.addEventListener("change", () => {
    const minimumDeparture = addDays(form.arrivalDate.value, 1);
    form.departureDate.min = minimumDeparture;
    if (form.departureDate.value <= form.arrivalDate.value)
      form.departureDate.value = minimumDeparture;
    updatePlannerNightCount();
    scheduleAvailabilitySearch();
  });
  form.departureDate.addEventListener("change", () => {
    updatePlannerNightCount();
    scheduleAvailabilitySearch();
  });
  form.unitCount.addEventListener("change", () => {
    state.requestedRooms = clamp(Number(form.unitCount.value || 1), 1, 20);
    form.unitCount.value = String(state.requestedRooms);
    scheduleAvailabilitySearch();
  });
  form.adults.addEventListener("change", () => {
    const unit = state.units[0] || { adults: 2, childAges: [] };
    unit.adults = clamp(Number(form.adults.value || 1), 1, 20);
    state.units = [unit];
    renderOccupancyUnits();
    scheduleAvailabilitySearch();
  });
  form.children.addEventListener("change", () => {
    const unit = state.units[0] || { adults: 2, childAges: [] };
    const count = clamp(Number(form.children.value || 0), 0, 20);
    unit.childAges = Array.from(
      { length: count },
      (_, childIndex) => unit.childAges[childIndex] ?? 8,
    );
    state.units = [unit];
    renderOccupancyUnits();
    scheduleAvailabilitySearch();
  });
  form.promotionCode.addEventListener("input", () => {
    // A promo edit invalidates pending exact quotes without discarding room availability.
    state.recommendationRequestVersion += 1;
    clearQuoteAndLater();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void searchAvailability();
  });
  selectionContinue?.addEventListener("click", () => {
    if (state.selectionType === "entire") {
      void continueEntireSelection(selectionContinue);
    } else {
      void continueRoomSelection(selectionContinue);
    }
  });

  const photoDialog = document.querySelector("#propertyPhotoDialog");
  document
    .querySelector("#photoDialogClose")
    ?.addEventListener("click", () => photoDialog?.close());
  document
    .querySelector("#photoDialogPrev")
    ?.addEventListener("click", () => stepPropertyPhoto(-1));
  document
    .querySelector("#photoDialogNext")
    ?.addEventListener("click", () => stepPropertyPhoto(1));
  photoDialog?.addEventListener("click", (event) => {
    if (event.target === photoDialog) photoDialog.close();
  });
  photoDialog?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") stepPropertyPhoto(-1);
    if (event.key === "ArrowRight") stepPropertyPhoto(1);
  });
}

function configureInitialSearch() {
  const today = dateValue(new Date());
  const defaultArrival = today;
  const requestedArrival = validDate(query.get("arrivalDate"))
    ? query.get("arrivalDate")
    : null;
  const arrival =
    requestedArrival && requestedArrival >= today
      ? requestedArrival
      : defaultArrival;
  const departureCandidate = validDate(query.get("departureDate"))
    ? query.get("departureDate")
    : addDays(arrival, 1);
  const departure =
    departureCandidate > arrival ? departureCandidate : addDays(arrival, 1);
  const adults = clamp(Number(query.get("adults") || 2), 1, 10);
  const children = clamp(Number(query.get("children") || 0), 0, 6);
  const parsedChildAges = (query.get("childAges") || "")
    .split(",")
    .filter((entry) => entry !== "")
    .map(Number);
  const childAges =
    parsedChildAges.length === children &&
    parsedChildAges.every(
      (age) => Number.isInteger(age) && age >= 0 && age <= 17,
    )
      ? parsedChildAges
      : Array.from({ length: children }, () => 8);

  form.arrivalDate.min = today;
  form.arrivalDate.value = arrival;
  form.departureDate.min = addDays(arrival, 1);
  form.departureDate.value = departure;
  form.unitCount.value = String(state.requestedRooms);
  state.units = [
    {
      adults,
      childAges,
    },
  ];
  renderOccupancyUnits();
  updatePlannerNightCount();
}

async function loadProperty() {
  try {
    const data = await apiRequest(
      `/v1/public/properties/${encodeURIComponent(publicSlug)}`,
      {
        cache: "default",
      },
    );
    state.property = data.property;
    configureBookingMode(data.property);
    renderProperty(data.property);
    configureBackLink(data.property);
    propertyContent.classList.remove("hidden");
    // Search is independent of an existing payment. Never delay restoring a
    // recoverable booking while rates or recommendations are slow to respond.
    if (!checkoutView) {
      void searchAvailability({ resetBooking: false });
      void searchRoomRecommendations();
    } else {
      document.body.classList.add("checkout-view");
      document.querySelector("#checkoutIntro")?.classList.remove("hidden");
    }

    if (
      state.session.activeCheckout?.reservationId &&
      state.session.activeCheckout?.paymentIntentId
    ) {
      statusSection.classList.remove("hidden");
      statusSection.scrollIntoView({ block: "nearest" });
      const status = await refreshCheckoutStatus(true);
      if (status?.outcome === "PAYMENT_PENDING") {
        startStatusPolling();
      } else if (!status) {
        renderPendingStatus(
          "Wildleaf could not verify this reservation after the page reloaded. Use Check booking status to retry before making another payment.",
          false,
        );
      }
    } else {
      const restored = restorePreCheckoutSession();
      if (checkoutView && !restored) renderCheckoutUnavailable();
    }
  } catch (error) {
    showPageError(
      messageFor(error, "This property is not currently available."),
    );
  }
}

function renderProperty(property) {
  document.title = `${property.name} | Wildleaf Stays`;
  document.querySelector("#propertyName").textContent = property.name;
  document.querySelector("#propertyMobileType").textContent =
    property.propertyTypeName || "Stay";
  document.querySelector("#propertyLocation").textContent = [
    property.locality,
    property.city,
    property.stateRegion,
    property.countryCode,
  ]
    .filter(Boolean)
    .join(" · ");
  document.querySelector("#propertySummary").textContent =
    property.shortDescription || property.description || "";

  document.querySelector("#bookingModeBadge").textContent =
    property.saleMode === "FULL_PROPERTY_ONLY"
      ? "Private entire property"
      : property.saleMode === "ROOMS_ONLY"
        ? "Private rooms"
        : "Rooms or entire property";
  const facts = document.querySelector("#propertyFacts");
  facts.replaceChildren(
    fact(
      "Stay",
      property.saleMode === "FULL_PROPERTY_ONLY"
        ? "Entire property"
        : property.saleMode === "ROOMS_ONLY"
          ? "Book by room"
          : "Rooms or complete property",
    ),
    fact("Category", property.propertyCategoryName || "Wildleaf stay"),
    fact("Type", property.propertyTypeName || "Stay"),
  );

  renderPropertyGallery(property);
  renderPropertyTabs(property);
}

function updatePlannerNightCount() {
  const badge = document.querySelector("#plannerNightCount");
  if (!badge || !form.arrivalDate.value || !form.departureDate.value) return;
  const nights = Math.max(
    1,
    Math.round(
      (new Date(`${form.departureDate.value}T00:00:00`).getTime() -
        new Date(`${form.arrivalDate.value}T00:00:00`).getTime()) /
        86400000,
    ),
  );
  badge.textContent = `${nights} ${nights === 1 ? "night" : "nights"}`;
}

function renderPropertyTabs(property) {
  const tabs = document.querySelector("#propertyTabs");
  const panel = document.querySelector("#propertyTabPanel");
  if (!tabs || !panel) return;

  const definitions = [
    ["overview", "Overview", () => renderOverviewTab(property)],
    ["about", "About Home", () => renderAboutTab(property)],
    ["cancellation", "Cancellation", () => renderCancellationTab(property)],
    ["reviews", "Reviews", () => renderReviewsTab(property)],
    ["amenities", "Amenities", () => renderAmenitiesTab(property)],
    ["services", "Services", () => renderServicesTab(property)],
    ["spaces", "Spaces", () => renderSpacesTab(property)],
    ["location", "Location", () => renderLocationTab(property)],
  ];

  const activate = (key, focus = false, reveal = true) => {
    const selected = definitions.find(([id]) => id === key) || definitions[0];
    tabs.querySelectorAll("[role='tab']").forEach((tab) => {
      const active = tab.dataset.tab === selected[0];
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.classList.toggle("active", active);
      if (active && focus) tab.focus();
    });
    panel.hidden = !reveal;
    panel.setAttribute("aria-labelledby", `property-tab-${selected[0]}`);
    panel.replaceChildren(selected[2]());
  };

  tabs.replaceChildren(
    ...definitions.map(([key, label], index) => {
      const button = element("button", "property-tab", label);
      button.type = "button";
      button.id = `property-tab-${key}`;
      button.dataset.tab = key;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", "propertyTabPanel");
      button.setAttribute("aria-selected", String(index === 0));
      button.tabIndex = index === 0 ? 0 : -1;
      button.addEventListener("click", () => activate(key));
      button.addEventListener("keydown", (event) => {
        if (!new Set(["ArrowLeft", "ArrowRight", "Home", "End"]).has(event.key))
          return;
        event.preventDefault();
        const current = definitions.findIndex(([id]) => id === key);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? definitions.length - 1
              : (current +
                  (event.key === "ArrowRight" ? 1 : -1) +
                  definitions.length) %
                definitions.length;
        activate(definitions[next][0], true);
      });
      return button;
    }),
  );
  activate("overview", false, false);
}

function propertyTabSection(title, copy = null) {
  const section = element("section", "property-tab-content");
  section.append(element("h2", "", title));
  if (copy) section.append(element("p", "property-tab-copy", copy));
  return section;
}

function appendEmptyTabState(section) {
  section.append(
    element(
      "p",
      "property-tab-empty",
      "This information has not been published for this property.",
    ),
  );
}

function renderOverviewTab(property) {
  const section = propertyTabSection(
    "At a glance",
    property.shortDescription || property.description,
  );
  const details = element("div", "tab-detail-grid");
  const rows = [
    ["Check-in", formatTime(property.checkInTime)],
    ["Check-out", formatTime(property.checkOutTime)],
    ["Stay", document.querySelector("#bookingModeBadge")?.textContent],
  ].filter(([, value]) => value);
  rows.forEach(([label, value]) => details.append(fact(label, value)));
  if (rows.length) section.append(details);
  if (!property.shortDescription && !property.description && !rows.length)
    appendEmptyTabState(section);
  return section;
}

function renderAboutTab(property) {
  const section = propertyTabSection("About this home", property.description);
  const categories = (property.roomCategories || []).filter(
    (category) => category.name || category.description,
  );
  if (categories.length) {
    const list = element("div", "tab-card-grid");
    categories.forEach((category) => {
      const card = element("article", "property-info-card");
      if (category.name) card.append(element("h3", "", category.name));
      if (category.description)
        card.append(element("p", "", category.description));
      list.append(card);
    });
    section.append(list);
  }
  const policies = property.policies;
  if (policies) {
    const policyItems = [
      ["Children", humanizeCode(policies.childrenPolicy)],
      ["Pets", humanizeCode(policies.petsPolicy)],
      ["Smoking", humanizeCode(policies.smokingPolicy)],
      ["Events", humanizeCode(policies.partiesEventsPolicy)],
      [
        "Minimum check-in age",
        policies.minimumCheckinAge ? String(policies.minimumCheckinAge) : null,
      ],
      [
        "Quiet hours",
        policies.quietHoursStart && policies.quietHoursEnd
          ? `${formatTime(policies.quietHoursStart)} – ${formatTime(policies.quietHoursEnd)}`
          : null,
      ],
      ["House rules", policies.houseRules],
    ].filter(([, value]) => value);
    if (policyItems.length) {
      section.append(element("h3", "", "House rules and policies"));
      const list = element("div", "tab-card-grid policy-tab-grid");
      policyItems.forEach(([label, value]) => {
        const card = element("article", "property-info-card");
        card.append(element("strong", "", label), element("p", "", value));
        list.append(card);
      });
      section.append(list);
    }
  }
  if (!property.description && !categories.length && !policies)
    appendEmptyTabState(section);
  return section;
}

function humanizeCode(value) {
  if (!value) return null;
  return String(value)
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function renderCancellationTab(property) {
  const cancellation = property.cancellation;
  const section = propertyTabSection(
    cancellation?.name || "Cancellation and refunds",
    cancellation?.policyText,
  );
  if (!cancellation?.policyText) appendEmptyTabState(section);
  return section;
}

function renderReviewsTab(property) {
  const reviews = property.reviews || [];
  const section = propertyTabSection("Verified guest reviews");
  if (!reviews.length) {
    section.append(
      element(
        "p",
        "property-tab-empty",
        "No verified guest reviews have been published for this property yet.",
      ),
    );
    return section;
  }
  const average =
    reviews.reduce((total, review) => total + review.rating, 0) /
    reviews.length;
  section.append(
    element(
      "p",
      "review-summary",
      `${average.toFixed(1)} out of 5 · ${reviews.length} verified ${reviews.length === 1 ? "stay" : "stays"}`,
    ),
  );
  const list = element("div", "review-list");
  reviews.forEach((review) => {
    const card = element("article", "property-info-card review-card");
    card.append(
      element(
        "strong",
        "review-rating",
        `${"★".repeat(review.rating)} ${review.rating}/5`,
      ),
    );
    if (review.title) card.append(element("h3", "", review.title));
    card.append(
      element("p", "", review.reviewText),
      element(
        "small",
        "",
        `${review.reviewerDisplayName} · ${new Date(review.publishedAt).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}`,
      ),
    );
    list.append(card);
  });
  section.append(list);
  return section;
}

function amenityList(items) {
  const list = element("div", "tab-amenity-grid");
  items.forEach((item) => {
    const card = element("article", "property-info-card amenity-detail-card");
    card.append(element("strong", "", item.name));
    if (item.details) card.append(element("small", "", item.details));
    list.append(card);
  });
  return list;
}

function renderAmenitiesTab(property) {
  const items = property.amenities || [];
  const section = propertyTabSection("Amenities and facilities");
  if (items.length) section.append(amenityList(items));
  else appendEmptyTabState(section);
  return section;
}

function renderServicesTab(property) {
  const serviceCategories = new Set([
    "SERVICES",
    "PARKING_TRANSPORT",
    "FOOD_BEVERAGE",
  ]);
  const items = (property.amenities || []).filter((item) =>
    serviceCategories.has(item.category),
  );
  const section = propertyTabSection(
    "Available services",
    property.servicesDescription,
  );
  if (items.length) section.append(amenityList(items));
  if (!property.servicesDescription && !items.length)
    appendEmptyTabState(section);
  return section;
}

function renderSpacesTab(property) {
  const spaceCategories = new Set([
    "LEISURE",
    "FAMILY",
    "BUSINESS",
    "OUTDOOR",
    "OTHER",
  ]);
  const items = (property.amenities || []).filter((item) =>
    spaceCategories.has(item.category),
  );
  const section = propertyTabSection(
    "Spaces and shared areas",
    property.spacesDescription,
  );
  if (items.length) section.append(amenityList(items));
  if (!property.spacesDescription && !items.length)
    appendEmptyTabState(section);
  return section;
}

function safeExternalUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return new Set(["http:", "https:"]).has(parsed.protocol)
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function renderLocationTab(property) {
  const section = propertyTabSection("Location", property.locationDescription);
  if (property.publicAddress)
    section.append(
      element("p", "property-public-address", property.publicAddress),
    );
  const attractions = String(property.nearbyAttractions || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (attractions.length) {
    section.append(element("h3", "", "Nearby attractions"));
    const list = element("ul", "nearby-attraction-list");
    attractions.forEach((item) => list.append(element("li", "", item)));
    section.append(list);
  }
  const mapUrl = safeExternalUrl(property.mapUrl);
  if (mapUrl) {
    const link = element("a", "button button-secondary map-link", "Open map");
    link.href = mapUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    section.append(link);
  }
  if (
    !property.locationDescription &&
    !property.publicAddress &&
    !attractions.length &&
    !mapUrl
  )
    appendEmptyTabState(section);
  return section;
}

function renderPropertyGallery(property) {
  const gallery = document.querySelector("#propertyGallery");
  if (!gallery) return;

  const roomCategoryMedia = (property.roomCategories || []).flatMap(
    (category) => {
      const published = (category.media || []).filter(
        (item) => item.mediaType === "IMAGE" && item.id,
      );
      if (published.length || !category.coverMediaId) return published;
      return [
        {
          id: category.coverMediaId,
          mediaType: "IMAGE",
          altText: `${category.name} at ${property.name}`,
          caption: category.name,
        },
      ];
    },
  );
  const media = [
    ...new Map(
      [...(property.media || []), ...roomCategoryMedia]
        .filter((item) => item.mediaType === "IMAGE" && item.id)
        .map((item) => [item.id, item]),
    ).values(),
  ];
  state.galleryMedia = media;
  state.photoMedia = media;
  state.galleryIndex = 0;
  gallery.replaceChildren();

  if (!media.length) {
    gallery.classList.add("hidden");
    return;
  }

  gallery.classList.remove("hidden");
  const grid = element("div", "property-gallery-grid");
  const visibleMedia = media.slice(0, 5);
  grid.classList.add(`gallery-count-${visibleMedia.length}`);

  visibleMedia.forEach((item, index) => {
    const tile = element("button", "property-gallery-tile");
    tile.type = "button";
    tile.setAttribute(
      "aria-label",
      item.caption
        ? `View photo: ${item.caption}`
        : `View property photo ${index + 1}`,
    );

    const image = element("img");
    image.src = propertyMediaUrl(item.id);
    image.alt =
      item.altText || item.caption || `${property.name} photo ${index + 1}`;
    image.loading = index === 0 ? "eager" : "lazy";
    image.decoding = "async";
    tile.append(image);
    tile.addEventListener("click", () => openPropertyPhoto(index));
    grid.append(tile);
  });

  gallery.append(grid);

  const more = element(
    "button",
    "property-gallery-more",
    media.length === 1 ? "View photo" : `View all ${media.length} photos`,
  );
  more.type = "button";
  more.addEventListener("click", () => openPropertyPhoto(0));
  gallery.append(more);
}

function openPropertyPhoto(index) {
  openPhotoCollection(state.galleryMedia, index);
}

function openPhotoCollection(media, index = 0) {
  const images = (media || []).filter(
    (item) => item?.id && (!item.mediaType || item.mediaType === "IMAGE"),
  );
  if (!images.length) return;

  state.photoMedia = images;
  state.galleryIndex = (index + images.length) % images.length;
  renderPropertyPhotoDialog();

  const dialog = document.querySelector("#propertyPhotoDialog");
  if (dialog && !dialog.open) dialog.showModal();
}

function stepPropertyPhoto(direction) {
  if (!state.photoMedia.length) return;
  state.galleryIndex =
    (state.galleryIndex + direction + state.photoMedia.length) %
    state.photoMedia.length;
  renderPropertyPhotoDialog();
}

function renderPropertyPhotoDialog() {
  const item = state.photoMedia[state.galleryIndex];
  if (!item) return;

  const image = document.querySelector("#photoDialogImage");
  const counter = document.querySelector("#photoDialogCounter");
  const caption = document.querySelector("#photoDialogCaption");
  if (!image || !counter || !caption) return;

  image.src = propertyMediaUrl(item.id);
  image.alt =
    item.altText ||
    item.caption ||
    `${state.property?.name || "Wildleaf property"} photo ${state.galleryIndex + 1}`;
  counter.textContent = `${state.galleryIndex + 1} / ${state.photoMedia.length}`;
  caption.textContent = item.caption || item.altText || "";
}

function propertyMediaUrl(mediaId) {
  return `/v1/public/properties/${encodeURIComponent(publicSlug)}/media/${encodeURIComponent(mediaId)}`;
}

function configureBookingMode(property) {
  state.allowsRooms =
    !property.saleMode ||
    property.saleMode === "ROOMS_ONLY" ||
    property.saleMode === "BOTH";
  state.allowsEntire =
    property.saleMode === "FULL_PROPERTY_ONLY" || property.saleMode === "BOTH";
  smartMatchSection?.classList.toggle("hidden", !state.allowsRooms);
  form.unitCount.value = String(state.requestedRooms);
}

function configureBackLink(property) {
  const link = document.querySelector("#backToResults");
  if (!link) return;
  const search = preservedSearchParams();
  if (checkoutView) {
    link.textContent = "← Back to property";
    link.href = propertyPageUrl(property, search);
    return;
  }
  link.textContent = "← Back to stays";
  const destination =
    query.get("destination") || property.city || "all-destinations";
  link.href = `/stays/${encodeURIComponent(slugify(destination))}?${search}`;
}

function renderOccupancyUnits() {
  const unit = state.units[0] || { adults: 2, childAges: [] };
  state.units = [unit];
  form.adults.value = String(unit.adults);
  form.children.value = String(unit.childAges.length);

  const ages = element("div", "total-party-ages");

  if (unit.childAges.length) {
    ages.append(element("p", "", "Children’s ages"));
    unit.childAges.forEach((age, childIndex) => {
      const label = element("label");
      label.append(element("span", "", `Child ${childIndex + 1}`));
      const select = integerSelect(age, 0, 17, (value) =>
        value === 0 ? "Under 1" : `${value} years`,
      );
      select.setAttribute("aria-label", `Age of child ${childIndex + 1}`);
      select.addEventListener("change", () => {
        unit.childAges[childIndex] = Number(select.value);
        renderOccupancyUnits();
        scheduleAvailabilitySearch();
      });
      label.append(select);
      ages.append(label);
    });
  }

  occupancyUnits.replaceChildren(...(unit.childAges.length ? [ages] : []));
}

function partyTotals() {
  const unit = state.units[0] || { adults: 0, childAges: [] };
  return {
    adults: unit.adults,
    children: unit.childAges.length,
  };
}

async function searchRoomRecommendations() {
  if (!state.allowsRooms || !state.property || checkoutView) {
    smartMatchSection?.classList.add("hidden");
    return;
  }

  const totals = partyTotals();
  const requestedRooms = requestedRoomCount();
  const complexSearch =
    requestedRooms > 1 || totals.children > 0 || totals.adults > 2;
  if (!complexSearch || requestedRooms > 6) {
    state.recommendationRequestVersion += 1;
    smartMatchSection?.classList.add("hidden");
    smartRecommendations?.replaceChildren();
    return;
  }

  smartMatchSection?.classList.remove("hidden");
  smartMatchSection.open = false;

  const requestVersion = ++state.recommendationRequestVersion;
  const nights = Math.max(
    1,
    Math.round(
      (new Date(`${form.departureDate.value}T12:00:00`).getTime() -
        new Date(`${form.arrivalDate.value}T12:00:00`).getTime()) /
        86400000,
    ),
  );

  smartMatchSection?.classList.remove("hidden");
  if (smartMatchIntro) {
    smartMatchIntro.textContent =
      `${totals.adults} ${totals.adults === 1 ? "adult" : "adults"} · ` +
      `${totals.children} ${totals.children === 1 ? "child" : "children"} · ` +
      `${nights} ${nights === 1 ? "night" : "nights"} · open to compare`;
  }
  if (smartMatchMessage) {
    smartMatchMessage.textContent =
      "Finding the most suitable room combinations…";
    smartMatchMessage.className = "inline-message message-info";
  }
  smartRecommendations?.replaceChildren();

  try {
    const data = await apiRequest(
      `/v1/public/properties/${encodeURIComponent(publicSlug)}/room-recommendations`,
      {
        method: "POST",
        body: {
          arrivalDate: form.arrivalDate.value,
          departureDate: form.departureDate.value,
          adults: totals.adults,
          childAges: state.units.flatMap((unit) => [...unit.childAges]),
          requestedRooms,
        },
      },
    );
    if (requestVersion !== state.recommendationRequestVersion) return;
    renderRoomRecommendations(data);
  } catch (error) {
    if (requestVersion !== state.recommendationRequestVersion) return;
    if (smartMatchMessage) {
      smartMatchMessage.textContent = messageFor(
        error,
        "Smart room matching is temporarily unavailable.",
      );
      smartMatchMessage.className = "inline-message message-warning";
    }
  }
}

function renderRoomRecommendations(data) {
  if (!smartRecommendations || !smartMatchMessage) return;

  const recommendations = data.recommendations || [];
  smartRecommendations.replaceChildren();

  if (!recommendations.length) {
    smartMatchMessage.textContent =
      "No mixed room combination currently fits this group and these dates.";
    smartMatchMessage.className = "inline-message message-warning";
    return;
  }

  smartMatchMessage.textContent =
    recommendations.length === 1
      ? "1 suitable room combination found."
      : `${recommendations.length} suitable room combinations found.`;
  smartMatchMessage.className = "inline-message message-success";

  recommendations.forEach((recommendation) => {
    smartRecommendations.append(
      smartRecommendationCard(recommendation, data.singleCheckoutSupported),
    );
  });
}

function smartRecommendationCard(recommendation, singleCheckoutSupported) {
  const card = element(
    "article",
    `smart-recommendation-card${recommendation.rank === 1 ? " recommended" : ""}`,
  );

  const header = element("div", "smart-recommendation-card-head");
  const heading = element("div");
  heading.append(
    element(
      "p",
      "option-kicker",
      recommendationReasonLabel(recommendation.reason),
    ),
    element(
      "h3",
      "",
      `${recommendation.roomCount} ${recommendation.roomCount === 1 ? "room" : "rooms"} for your group`,
    ),
  );
  header.append(
    heading,
    element(
      "strong",
      "smart-recommendation-total",
      money(recommendation.estimatedTotalMinor, recommendation.currencyCode),
    ),
  );

  const rooms = element("div", "smart-room-mix");
  recommendation.items.forEach((item) => {
    const room = element("div", "smart-room-item");
    if (item.coverMediaId) {
      const image = element("img", "smart-room-image");
      image.src = propertyMediaUrl(item.coverMediaId);
      image.alt = item.roomCategoryName;
      image.loading = "lazy";
      image.decoding = "async";
      room.append(image);
    }

    const copy = element("div", "smart-room-copy");
    copy.append(
      element("strong", "", `${item.quantity} × ${item.roomCategoryName}`),
      element(
        "span",
        "smart-room-plan",
        `${mealPlanLabel(item.mealPlanCode)} · ${item.ratePlanName}`,
      ),
    );

    const assignments = element("div", "smart-room-assignments");
    item.units.forEach((unit, index) => {
      const parts = [
        `${unit.adults} ${unit.adults === 1 ? "adult" : "adults"}`,
      ];
      if (unit.children) {
        parts.push(
          `${unit.children} ${unit.children === 1 ? "child" : "children"}`,
        );
      }
      assignments.append(
        element("span", "", `Room ${index + 1}: ${parts.join(" + ")}`),
      );
    });
    copy.append(assignments);
    room.append(copy);
    rooms.append(room);
  });

  const footer = element("div", "smart-recommendation-footer");
  footer.append(
    element(
      "small",
      "tax-note",
      "Estimated room and extra-guest total. Final GST, fees and promotions are calculated in the exact quote.",
    ),
  );

  const action = element(
    "button",
    "button button-primary smart-mix-action",
    singleCheckoutSupported
      ? "Book this recommendation"
      : "Booking unavailable",
  );
  action.type = "button";
  action.disabled = !singleCheckoutSupported;
  if (singleCheckoutSupported) {
    action.addEventListener(
      "click",
      () => void startRecommendedBooking(recommendation, action),
    );
  } else {
    action.setAttribute(
      "title",
      "This recommendation cannot currently be completed in one secure checkout.",
    );
  }
  footer.append(action);

  card.append(header, rooms, footer);
  return card;
}

async function startRecommendedBooking(recommendation, button) {
  if (!recommendation?.items?.length) return;

  clearQuoteAndLater();
  const bookingSearchVersion = state.recommendationRequestVersion;
  setBusy(button, true, "Checking exact price…");

  try {
    if (recommendation.items.length === 1) {
      const item = recommendation.items[0];
      const body = {
        rateProductId: item.rateProductId,
        arrivalDate: form.arrivalDate.value,
        departureDate: form.departureDate.value,
        promotionCode: form.promotionCode.value.trim() || null,
        units: item.units.map((unit) => ({
          adults: unit.adults,
          childAges: [...unit.childAges],
        })),
      };
      const key = operationKey(
        state.session,
        "recommended-quote",
        JSON.stringify(body),
      );
      const data = await apiRequest(
        `/v1/public/properties/${encodeURIComponent(publicSlug)}/quotes`,
        {
          method: "POST",
          idempotencyKey: key,
          body,
        },
      );

      if (bookingSearchVersion !== state.recommendationRequestVersion) return;

      state.roomMixQuote = null;
      state.quote = data.quote;
      state.session.quoteId = data.quote.id;
      state.session.quote = data.quote;
      delete state.session.roomMixQuote;
      delete state.session.holdId;
      delete state.session.hold;
      saveBookingSession(publicSlug, state.session);

      renderQuote(data.quote, { showHoldAction: false });
      await createHold(null, { scrollToGuest: true });
      return;
    }

    if (form.promotionCode.value.trim()) {
      if (smartMatchMessage) {
        smartMatchMessage.textContent =
          "Promo codes are not yet supported for a mixed-category checkout. Clear the promo code to book this recommendation, or choose one room category.";
        smartMatchMessage.className = "inline-message message-warning";
      }
      return;
    }

    const body = {
      arrivalDate: form.arrivalDate.value,
      departureDate: form.departureDate.value,
      items: recommendation.items.map((item) => ({
        rateProductId: item.rateProductId,
        units: item.units.map((unit) => ({
          adults: unit.adults,
          childAges: [...unit.childAges],
        })),
      })),
    };
    const key = operationKey(
      state.session,
      "room-mix-quote",
      JSON.stringify(body),
    );
    const data = await apiRequest(
      `/v1/public/properties/${encodeURIComponent(publicSlug)}/room-mixes/quotes`,
      {
        method: "POST",
        idempotencyKey: key,
        body,
      },
    );

    if (bookingSearchVersion !== state.recommendationRequestVersion) return;

    state.quote = null;
    state.roomMixQuote = data.roomMixQuote;
    state.session.roomMixQuote = data.roomMixQuote;
    delete state.session.quoteId;
    delete state.session.quote;
    delete state.session.holdId;
    delete state.session.hold;
    saveBookingSession(publicSlug, state.session);

    renderRoomMixQuote(data.roomMixQuote);
    await createRoomMixHold({ scrollToGuest: true });
  } catch (error) {
    if (smartMatchMessage) {
      smartMatchMessage.textContent = messageFor(
        error,
        "This recommendation could not be prepared for booking.",
      );
      smartMatchMessage.className = "inline-message message-warning";
    }
  } finally {
    setBusy(button, false, "Book this recommendation");
  }
}

function renderRoomMixQuote(quote) {
  quoteSection.classList.remove("hidden");
  quoteSection.replaceChildren();

  const heading = element("div", "section-heading compact-heading");
  const headingCopy = element("div");
  headingCopy.append(
    element("p", "eyebrow", "Exact Wildleaf quote"),
    element("h2", "", "Your recommended room mix"),
  );
  const expiry = element("span", "expiry-pill");
  heading.append(headingCopy, expiry);

  const priceBox = element("div", "quote-price-box");
  const rows = [
    ["Accommodation", quote.grossAccommodationMinor],
    ["Extra guests", quote.grossExtraGuestMinor],
    ["Discount", -quote.discountMinor],
    ["Fees", quote.feeMinor],
    ["Taxes", quote.taxMinor],
  ];
  const breakdown = element("dl", "price-breakdown");
  rows.forEach(([label, value]) => {
    if (value === 0 && !["Fees", "Taxes"].includes(label)) return;
    breakdown.append(
      element("dt", "", label),
      element(
        "dd",
        value < 0 ? "discount" : "",
        `${value < 0 ? "−" : ""}${money(Math.abs(value), quote.currencyCode)}`,
      ),
    );
  });
  breakdown.append(
    element("dt", "price-total-label", "Total payable"),
    element("dd", "price-total", money(quote.totalMinor, quote.currencyCode)),
  );
  priceBox.append(breakdown);

  const roomSummary = quote.items
    .map((item) => `${item.quantity} × ${item.productLabel}`)
    .join(" · ");
  const rateSummary = [
    ...new Set(
      quote.items.map(
        (item) => `${item.ratePlanName} · ${mealPlanLabel(item.mealPlanCode)}`,
      ),
    ),
  ].join(" · ");

  const details = element("div", "quote-details");
  details.append(
    detailLine(
      "Stay",
      `${formatDate(quote.arrivalDate)} – ${formatDate(quote.departureDate)}`,
    ),
    detailLine("Rooms", roomSummary),
    detailLine("Rates", rateSummary),
  );

  const action = element("div", "quote-action");
  action.append(
    element(
      "p",
      "fine-print",
      "This exact total is built from each room's canonical rate, guest ages, GST and applicable fees. The rooms will be held and confirmed together.",
    ),
  );

  quoteSection.append(heading, priceBox, details, action);
  startCountdown(expiry, quote.expiresAt, null, "Quote");
}

async function createRoomMixHold({ scrollToGuest = true } = {}) {
  if (!state.roomMixQuote) return;

  const fingerprint = state.roomMixQuote.id;
  const requestVersion = state.recommendationRequestVersion;
  const key = operationKey(state.session, "room-mix-hold", fingerprint);
  saveBookingSession(publicSlug, state.session);

  try {
    const data = await apiRequest(
      `/v1/public/properties/${encodeURIComponent(publicSlug)}/room-mixes/${state.roomMixQuote.id}/hold`,
      { method: "POST", idempotencyKey: key },
    );
    if (
      requestVersion !== state.recommendationRequestVersion ||
      state.roomMixQuote?.id !== fingerprint
    )
      return;
    state.hold = data.hold;
    state.session.holdId = data.hold.id;
    state.session.hold = data.hold;
    saveBookingSession(publicSlug, state.session);
    if (!checkoutView) {
      navigateToCheckout();
      return true;
    }
    renderGuestForm();
    if (scrollToGuest) {
      guestSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return true;
  } catch (error) {
    if (
      requestVersion !== state.recommendationRequestVersion ||
      state.roomMixQuote?.id !== fingerprint
    )
      return;
    renderSectionError(
      quoteSection,
      messageFor(
        error,
        "The recommended rooms could not be reserved together.",
      ),
    );
    return false;
  }
}

function recommendationReasonLabel(reason) {
  return (
    {
      BEST_VALUE: "Best value",
      FEWER_ROOMS: "Fewer rooms",
      MORE_SPACE: "More space",
      ALTERNATIVE: "Another good match",
    }[reason] || "Recommended"
  );
}

async function searchAvailability({ resetBooking = true } = {}) {
  if (resetBooking) clearQuoteAndLater();
  const requestVersion = ++state.availabilityRequestVersion;
  state.categoryAvailabilityCounts.clear();
  state.availabilityProbeCache.clear();
  showInlineMessage("Loading live room inventory and rates…", "info");
  availabilityResults.replaceChildren(
    element("div", "availability-loading", "Finding the best available rates…"),
  );

  try {
    const party = state.units[0] || { adults: 1, childAges: [] };
    const request = (units) =>
      apiRequest(
        `/v1/public/properties/${encodeURIComponent(publicSlug)}/availability`,
        {
          method: "POST",
          body: {
            arrivalDate: form.arrivalDate.value,
            departureDate: form.departureDate.value,
            units,
          },
        },
      );
    const [roomData, entireData] = await Promise.all([
      state.allowsRooms ? request([{ adults: 1, children: 0 }]) : null,
      state.allowsEntire
        ? request([
            {
              adults: party.adults,
              children: availabilityChildrenForUnit(party),
            },
          ])
        : null,
    ]);
    if (requestVersion !== state.availabilityRequestVersion) return;
    state.availability = roomData || entireData;
    state.entireAvailability = entireData;
    renderAvailability(state.availability);

    if (state.allowsRooms && roomData) {
      void refreshCategoryAvailabilityCounts(roomData, requestVersion);
    }
  } catch (error) {
    if (requestVersion !== state.availabilityRequestVersion) return;
    showInlineMessage(
      messageFor(error, "Live rooms and rates could not be loaded."),
      "error",
    );
    availabilityResults.replaceChildren();
  }
}

function renderAvailability(data) {
  if (!data) return;
  const roomOptions = (data.options || []).filter(
    (option) => option.productType === "ROOM_CATEGORY",
  );
  const availableRoomOptions = roomOptions.filter((option) => option.available);
  const groups = groupRoomOptions(roomOptions);
  const nights = data.search.nights;
  renderEntirePropertyOffer(nights);
  if (
    availableRoomOptions.length ||
    state.entireSelection ||
    availableEntireOption()
  ) {
    availabilityMessage.classList.add("hidden");
  } else {
    showInlineMessage(
      "No booking option currently satisfies these dates and guests.",
      "warning",
    );
  }

  availabilityResults.classList.add("room-category-rail");
  if (state.allowsRooms) {
    const renderedCategoryIds = new Set(
      groups.map((group) => group.category.roomCategoryId),
    );
    const missingCategories = (state.property.roomCategories || [])
      .filter((category) => !renderedCategoryIds.has(category.roomCategoryId))
      .map((category) => ({ category, options: [] }));
    availabilityResults.replaceChildren(
      ...[...groups, ...missingCategories].map(({ category, options }) =>
        roomCategoryCard(category, options, nights),
      ),
    );
  } else {
    availabilityResults.replaceChildren();
  }
  roomChoiceDivider?.classList.toggle(
    "hidden",
    !state.allowsRooms || !state.allowsEntire,
  );
  renderSelectionRibbon();
}

function availableEntireOption() {
  return (state.entireAvailability?.options || []).find(
    (option) => option.productType === "FULL_PROPERTY" && option.available,
  );
}

function renderEntirePropertyOffer(nights) {
  if (!entirePropertyOffer) return;
  entirePropertyOffer.replaceChildren();
  entirePropertyOffer.classList.toggle("hidden", !state.allowsEntire);
  if (!state.allowsEntire) return;

  const publishedOption = (state.entireAvailability?.options || []).find(
    (candidate) => candidate.productType === "FULL_PROPERTY",
  );
  if (!publishedOption) {
    const unavailable = element("div", "entire-property-unavailable");
    unavailable.append(
      element("strong", "", "Entire property unavailable for these dates"),
      element(
        "p",
        "",
        "Individual rooms may still be available. Change your dates to check exclusive use.",
      ),
    );
    entirePropertyOffer.append(unavailable);
    return;
  }
  const option =
    state.selectionType === "entire" && state.entireSelection?.option
      ? state.entireSelection.option
      : publishedOption;

  const card = element(
    "article",
    `entire-property-card${state.selectionType === "entire" ? " selected" : ""}${option.available ? "" : " unavailable"}`,
  );
  if (state.property.coverMediaId) {
    card.style.setProperty(
      "--property-cover",
      `url("${propertyMediaUrl(state.property.coverMediaId)}")`,
    );
  }
  const content = element("div", "entire-property-card-copy");
  const requested = partyTotals();
  const includedGuests =
    Number(option.includedAdults || 0) + Number(option.includedChildren || 0);
  const categoryNames = (state.property.roomCategories || [])
    .map((category) => category.name)
    .filter(Boolean);
  content.append(
    element("p", "option-kicker", "Exclusive use"),
    element("h3", "", `Make ${state.property.name} entirely yours`),
    element(
      "p",
      "entire-property-promise",
      "Every active bedroom and shared space is reserved together. No unrelated overnight guests.",
    ),
  );
  const facts = element("div", "entire-property-facts");
  facts.append(
    element(
      "span",
      "entire-capacity-primary",
      `Base price includes ${includedOccupancyLabel(option)}`,
    ),
    element("span", "", `Maximum ${option.maxOccupancy} guests`),
    element("span", "", `Up to ${option.maxAdults} adults`),
    element("span", "", `Up to ${option.maxChildren} children`),
    element("span", "", `${nights} ${nights === 1 ? "night" : "nights"}`),
  );
  if (categoryNames.length) {
    facts.append(
      element(
        "span",
        "",
        `${categoryNames.length} room ${categoryNames.length === 1 ? "type" : "types"}`,
      ),
    );
  }
  content.append(
    element(
      "p",
      "entire-search-party",
      `Your group: ${requested.adults} ${requested.adults === 1 ? "adult" : "adults"} · ${requested.children} ${requested.children === 1 ? "child" : "children"}`,
    ),
  );
  content.append(facts);

  const action = element("div", "entire-property-action");
  action.append(
    element(
      "small",
      "",
      `Base price · includes ${includedOccupancyLabel(option)}`,
    ),
    element(
      "strong",
      "",
      `${money(option.nightlyFromMinor, option.currencyCode)} / night`,
    ),
    element(
      "span",
      "",
      `${money(option.estimatedTotalMinor, option.currencyCode)} for ${nights} ${nights === 1 ? "night" : "nights"} · ${option.maxOccupancy > includedGuests ? `maximum ${option.maxOccupancy} guests; additional guests priced after allocation` : "full published capacity included"} · GST and fees confirmed next`,
    ),
  );
  if (Number(state.entireSelection?.extraGuestMinor || 0) > 0) {
    action.append(
      element(
        "span",
        "entire-extra-price",
        `Includes ${money(state.entireSelection.extraGuestMinor, option.currencyCode)} extra-person charges`,
      ),
    );
  }
  const button = element(
    "button",
    `button ${state.selectionType === "entire" ? "button-secondary" : "button-primary"}`,
    state.selectionType === "entire"
      ? "Selected"
      : option.available
        ? "Select entire property"
        : "Unavailable for these dates",
  );
  button.type = "button";
  button.disabled = !option.available || state.selectionType === "entire";
  button.setAttribute("aria-pressed", String(state.selectionType === "entire"));
  button.addEventListener("click", () => selectEntireProperty(option));
  action.append(button);
  card.append(content, action);
  if (state.selectionType === "entire" && state.entireSelection) {
    card.append(renderEntireRoomAllocationControls(option));
  }
  entirePropertyOffer.append(card);
}

function selectEntireProperty(option) {
  clearQuoteAndLater();
  if (state.roomSelections.size) {
    state.roomSelections.clear();
  }
  state.selectionType = "entire";
  state.entireSelection = {
    option,
    estimatedTotalMinor: option.estimatedTotalMinor,
    currencyCode: option.currencyCode,
    roomAllocations: [],
    pricingUnavailable: false,
  };
  reconcileEntireRoomAllocations({ reset: true });
  renderAvailability(state.availability);
  showInlineMessage(
    "The complete property is selected. Allocate guests to rooms, then continue to checkout.",
    "success",
  );
}

function entirePropertyRoomInventory() {
  return (state.property?.roomCategories || []).flatMap((category) => {
    const quantity = Math.max(
      1,
      Number(categoryAvailabilityCount(category.roomCategoryId) || 1),
    );
    return Array.from({ length: quantity }, (_, roomIndex) => ({
      key: `${category.roomCategoryId}:${roomIndex}`,
      category,
      roomIndex,
    }));
  });
}

function reconcileEntireRoomAllocations({ reset = false } = {}) {
  const selection = state.entireSelection;
  if (!selection) return;
  const existing = new Map(
    (selection.roomAllocations || []).map((allocation) => [
      allocation.key,
      allocation,
    ]),
  );
  selection.roomAllocations = entirePropertyRoomInventory().map((room) => {
    const current = reset ? null : existing.get(room.key);
    return {
      ...room,
      adults: Number(current?.adults || 0),
      childAges: [...(current?.childAges || [])],
    };
  });
  if (!reset) return;

  let remainingAdults = Number(state.units[0]?.adults || 1);
  const remainingChildAges = [...(state.units[0]?.childAges || [])];
  const rooms = selection.roomAllocations;

  while (remainingAdults > 0) {
    const room = rooms.find(
      (candidate) =>
        candidate.adults <
        Math.min(
          Number(candidate.category.maxAdults || 20),
          Number(candidate.category.maxOccupancy || 20) -
            occupancyCountingChildren(candidate),
        ),
    );
    if (!room) break;
    room.adults += 1;
    remainingAdults -= 1;
  }

  remainingChildAges.forEach((age) => {
    const room = rooms.find((candidate) => {
      if (candidate.adults < 1) return false;
      const proposed = {
        adults: candidate.adults,
        childAges: [...candidate.childAges, age],
      };
      return roomUnitValid(candidate.category, proposed);
    });
    if (room) room.childAges.push(age);
  });
}

function entireAllocationTotals() {
  return (state.entireSelection?.roomAllocations || []).reduce(
    (totals, room) => {
      totals.adults += Number(room.adults || 0);
      totals.children += room.childAges.length;
      totals.occupancyChildren += occupancyCountingChildren(room);
      if (room.adults || room.childAges.length) totals.occupiedRooms += 1;
      totals.childAges.push(...room.childAges);
      return totals;
    },
    {
      adults: 0,
      children: 0,
      occupancyChildren: 0,
      occupiedRooms: 0,
      childAges: [],
    },
  );
}

function entireAllocationValidation() {
  const selection = state.entireSelection;
  const option = selection?.option;
  const totals = entireAllocationTotals();
  if (!selection || !option || totals.adults < 1) {
    return {
      valid: false,
      warning: false,
      message: "Add at least one adult to a room before continuing.",
    };
  }

  const invalidRoom = selection.roomAllocations.find(
    (room) =>
      (room.childAges.length > 0 && room.adults < 1) ||
      (!(room.adults === 0 && room.childAges.length === 0) &&
        !roomUnitValid(room.category, room)),
  );
  if (invalidRoom) {
    return {
      valid: false,
      warning: false,
      message: `${invalidRoom.category.name} ${invalidRoom.roomIndex + 1} exceeds its room capacity or has children without an adult.`,
    };
  }

  if (
    totals.adults > Number(option.maxAdults || 0) ||
    totals.children > Number(option.maxChildren || 0) ||
    totals.adults + totals.occupancyChildren > Number(option.maxOccupancy || 0)
  ) {
    return {
      valid: false,
      warning: false,
      message: `The allocation exceeds the property's maximum of ${option.maxOccupancy} guests, ${option.maxAdults} adults or ${option.maxChildren} children.`,
    };
  }

  if (selection.pricingUnavailable) {
    return {
      valid: false,
      warning: false,
      message:
        "This guest allocation could not be priced. Adjust the room guests and try again.",
    };
  }

  const requested = partyTotals();
  const requestedAges = [...(state.units[0]?.childAges || [])].sort(
    (left, right) => left - right,
  );
  const selectedAges = [...totals.childAges].sort(
    (left, right) => left - right,
  );
  const matchesSearch =
    totals.adults === requested.adults &&
    totals.children === requested.children &&
    requestedAges.length === selectedAges.length &&
    requestedAges.every((age, index) => age === selectedAges[index]);

  return {
    valid: true,
    warning: !matchesSearch,
    message: matchesSearch
      ? `Your ${totals.adults + totals.children}-guest allocation matches the search.`
      : `Your room allocation has ${guestSummary(totals)}, while your search has ${guestSummary(requested)}. Review the difference before continuing.`,
  };
}

function renderEntireRoomAllocationControls(option) {
  const section = element("section", "entire-room-allocation");
  const heading = element("div", "entire-room-allocation-heading");
  heading.append(
    element("div", "", "Allocate guests to rooms"),
    element(
      "small",
      "",
      "Rooms may be left empty. Every occupied room with children must include an adult.",
    ),
  );
  section.append(heading);

  (state.entireSelection?.roomAllocations || []).forEach((room) => {
    const row = element("div", "entire-room-allocation-row");
    const identity = element("div", "entire-room-identity");
    identity.append(
      element("strong", "", `${room.category.name} ${room.roomIndex + 1}`),
      element("small", "", `Maximum ${room.category.maxOccupancy} guests`),
    );

    const adultsLabel = element("label", "entire-room-guest-field");
    adultsLabel.append(element("span", "", "Adults"));
    const adultMaximum = Math.max(
      0,
      Math.min(
        Number(room.category.maxAdults || 20),
        Number(room.category.maxOccupancy || 20) -
          occupancyCountingChildren(room),
      ),
    );
    const adults = integerSelect(room.adults, 0, adultMaximum);
    adults.setAttribute(
      "aria-label",
      `Adults in ${room.category.name} ${room.roomIndex + 1}`,
    );
    adults.addEventListener("change", () => {
      clearQuoteAndLater();
      room.adults = Number(adults.value);
      renderAvailability(state.availability);
      scheduleEntireSelectionPricing();
    });
    adultsLabel.append(adults);

    const childrenLabel = element("label", "entire-room-guest-field");
    childrenLabel.append(element("span", "", "Children"));
    const childMaximum = roomChildMaximum(room.category, room);
    const children = integerSelect(
      room.childAges.length,
      0,
      Math.max(childMaximum, room.childAges.length),
    );
    children.setAttribute(
      "aria-label",
      `Children in ${room.category.name} ${room.roomIndex + 1}`,
    );
    children.addEventListener("change", () => {
      clearQuoteAndLater();
      const count = Number(children.value);
      room.childAges = Array.from(
        { length: count },
        (_, childIndex) => room.childAges[childIndex] ?? 8,
      );
      renderAvailability(state.availability);
      scheduleEntireSelectionPricing();
    });
    childrenLabel.append(children);
    row.append(identity, adultsLabel, childrenLabel);

    if (room.childAges.length) {
      const ages = element("div", "entire-room-child-ages");
      room.childAges.forEach((age, childIndex) => {
        const label = element("label");
        label.append(element("span", "", `Child ${childIndex + 1} age`));
        const ageSelect = integerSelect(age, 0, 17, (value) =>
          value === 0 ? "Under 1" : `${value} years`,
        );
        ageSelect.addEventListener("change", () => {
          clearQuoteAndLater();
          room.childAges[childIndex] = Number(ageSelect.value);
          renderAvailability(state.availability);
          scheduleEntireSelectionPricing();
        });
        label.append(ageSelect);
        ages.append(label);
      });
      row.append(ages);
    }
    section.append(row);
  });

  const totals = entireAllocationTotals();
  const validation = entireAllocationValidation();
  const summary = element(
    "div",
    `entire-allocation-summary${validation.warning ? " has-warning" : ""}${validation.valid ? "" : " has-error"}`,
  );
  summary.append(
    element(
      "strong",
      "",
      `${guestSummary(totals)} across ${totals.occupiedRooms} ${totals.occupiedRooms === 1 ? "room" : "rooms"}`,
    ),
    element("span", "", validation.message),
  );
  if (Number(state.entireSelection?.extraGuestMinor || 0) > 0) {
    summary.append(
      element(
        "span",
        "entire-extra-total",
        `Extra-person charges: ${money(state.entireSelection.extraGuestMinor, option.currencyCode)}`,
      ),
    );
  }
  section.append(summary);
  return section;
}

async function refreshCategoryAvailabilityCounts(baseData, requestVersion) {
  const baseAvailable = (baseData.options || []).filter(
    (option) =>
      option.productType === "ROOM_CATEGORY" &&
      option.available &&
      option.roomCategoryId,
  );
  const categoryIds = [
    ...new Set(baseAvailable.map((option) => option.roomCategoryId)),
  ];
  if (!categoryIds.length) return;

  state.availabilityProbeCache.set(1, new Set(categoryIds));
  categoryIds.forEach((id) => state.categoryAvailabilityCounts.set(id, 1));
  renderAvailability(baseData);

  const bounds = new Map(categoryIds.map((id) => [id, { low: 1, high: 21 }]));

  while (true) {
    if (requestVersion !== state.availabilityRequestVersion) return;
    const mids = new Set();
    bounds.forEach(({ low, high }) => {
      if (high - low > 1) mids.add(Math.floor((low + high) / 2));
    });
    if (!mids.size) break;

    const results = new Map(
      await Promise.all(
        [...mids].map(async (quantity) => [
          quantity,
          await probeCategoryAvailability(quantity, requestVersion),
        ]),
      ),
    );

    if (requestVersion !== state.availabilityRequestVersion) return;
    bounds.forEach((bound, categoryId) => {
      if (bound.high - bound.low <= 1) return;
      const middle = Math.floor((bound.low + bound.high) / 2);
      if (results.get(middle)?.has(categoryId)) {
        bound.low = middle;
      } else {
        bound.high = middle;
      }
    });
  }

  if (requestVersion !== state.availabilityRequestVersion) return;
  bounds.forEach(({ low }, categoryId) => {
    state.categoryAvailabilityCounts.set(categoryId, low);
  });
  reconcileEntireRoomAllocations();
  renderAvailability(baseData);
}

async function probeCategoryAvailability(quantity, requestVersion) {
  const cached = state.availabilityProbeCache.get(quantity);
  if (cached) return cached;

  const data = await apiRequest(
    `/v1/public/properties/${encodeURIComponent(publicSlug)}/availability`,
    {
      method: "POST",
      body: {
        arrivalDate: form.arrivalDate.value,
        departureDate: form.departureDate.value,
        units: Array.from({ length: quantity }, () => ({
          adults: 1,
          children: 0,
        })),
      },
    },
  );
  if (requestVersion !== state.availabilityRequestVersion) return new Set();

  const available = new Set(
    (data.options || [])
      .filter(
        (option) =>
          option.productType === "ROOM_CATEGORY" &&
          option.available &&
          option.roomCategoryId,
      )
      .map((option) => option.roomCategoryId),
  );
  state.availabilityProbeCache.set(quantity, available);
  return available;
}

function categoryAvailabilityCount(roomCategoryId) {
  return state.categoryAvailabilityCounts.get(roomCategoryId) ?? null;
}

function categoryAvailabilityLabel(roomCategoryId) {
  const count = categoryAvailabilityCount(roomCategoryId);
  if (count === null) return "Checking availability";
  if (count >= 20) return "20+ rooms available";
  if (count === 1) return "Only 1 room available";
  return `${count} rooms available`;
}

function groupRoomOptions(options) {
  const groups = new Map();
  options.forEach((option) => {
    const category = state.property.roomCategories?.find(
      (item) => item.roomCategoryId === option.roomCategoryId,
    );
    if (!category) return;
    const current = groups.get(category.roomCategoryId) || {
      category,
      options: [],
    };
    current.options.push(option);
    groups.set(category.roomCategoryId, current);
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      options: group.options.sort(
        (left, right) =>
          Number(left.estimatedTotalMinor || 0) -
          Number(right.estimatedTotalMinor || 0),
      ),
    }))
    .sort((left, right) => {
      const leftPrice = Number(left.options[0]?.estimatedTotalMinor || 0);
      const rightPrice = Number(right.options[0]?.estimatedTotalMinor || 0);
      return leftPrice - rightPrice;
    });
}

function includedOccupancyLabel(option) {
  const adults = Number(option?.includedAdults || 0);
  const children = Number(option?.includedChildren || 0);
  const parts = [];
  if (adults) parts.push(`${adults} ${adults === 1 ? "adult" : "adults"}`);
  if (children) {
    parts.push(`${children} ${children === 1 ? "child" : "children"}`);
  }
  return parts.join(" + ") || "the standard occupancy";
}

function extraGuestRateLabels(option) {
  const labels = [];
  if (
    Number(option?.maxAdults || 0) > Number(option?.includedAdults || 0) &&
    option?.extraAdultNightlyFromMinor !== null &&
    option?.extraAdultNightlyFromMinor !== undefined
  ) {
    labels.push(
      `Extra adult from +${money(option.extraAdultNightlyFromMinor, option.currencyCode)}/night`,
    );
  }
  if (
    Number(option?.maxChildren || 0) > Number(option?.includedChildren || 0) &&
    option?.extraChildNightlyFromMinor !== null &&
    option?.extraChildNightlyFromMinor !== undefined
  ) {
    labels.push(
      `Child from +${money(option.extraChildNightlyFromMinor, option.currencyCode)}/night`,
    );
  }
  return labels;
}

function occupancyRateLine(option) {
  const maximum = Number(option?.maxOccupancy || 0);
  const extras = extraGuestRateLabels(option);
  return [
    `Includes ${includedOccupancyLabel(option)}`,
    maximum ? `maximum ${maximum} guests` : null,
    ...extras,
  ]
    .filter(Boolean)
    .join(" · ");
}

function roomOccupancySelectionNote(option, category, unit) {
  const occupancy = roomUnitOccupancy(unit);
  const maximum = Number(option?.maxOccupancy || category.maxOccupancy || 20);
  const included =
    Number(option?.includedAdults || 0) + Number(option?.includedChildren || 0);
  const extra = Math.max(0, occupancy - included);
  return extra
    ? `${occupancy} of ${maximum} guests selected · ${extra} extra ${extra === 1 ? "guest" : "guests"}; total updates automatically`
    : `${occupancy} of ${maximum} guests selected · within the base occupancy`;
}

function roomCategoryCard(category, options, nights) {
  const selectableOptions = options.filter((option) => option.available);
  const soldOut = !selectableOptions.length;
  const card = element(
    "article",
    `room-category-card ota-rate-card${soldOut ? " sold-out" : ""}`,
  );
  const selection = state.roomSelections.get(category.roomCategoryId);

  const visual = element("button", "room-category-visual");
  visual.type = "button";
  visual.setAttribute("aria-label", `View photos for ${category.name}`);
  const coverMediaId = category.coverMediaId || state.property.coverMediaId;
  if (coverMediaId) {
    visual.classList.add("has-photo");
    visual.style.backgroundImage = `linear-gradient(180deg, transparent 55%, rgba(8, 31, 24, 0.68)), url("${propertyMediaUrl(coverMediaId)}")`;
  }
  visual.append(
    element("span", "room-photo-label", "Room"),
    element("span", "room-photo-action", "View photos"),
  );
  visual.addEventListener("click", () => openCategoryPhoto(category));

  const content = element("div", "room-category-content");
  const header = element("div", "room-category-head");
  const headerCopy = element("div");
  headerCopy.append(
    element("p", "option-kicker", "Room category"),
    element("h3", "", category.name),
    element(
      "span",
      "room-stock-badge",
      categoryAvailabilityLabel(category.roomCategoryId),
    ),
  );

  const starting = selectableOptions[0];
  const fromPrice = element("div", "room-category-from");
  if (starting) {
    fromPrice.append(
      element(
        "small",
        "",
        `from · ${nights} ${nights === 1 ? "night" : "nights"}`,
      ),
      element(
        "strong",
        "",
        money(starting.estimatedTotalMinor, starting.currencyCode || "INR"),
      ),
    );
  } else {
    fromPrice.append(
      element("strong", "", "Sold out"),
      element("small", "", "for your selected dates"),
    );
  }
  header.append(headerCopy, fromPrice);

  const facts = element("div", "room-category-facts");
  [
    starting
      ? `Base price includes ${includedOccupancyLabel(starting)}`
      : category.baseOccupancy
        ? `Base occupancy ${category.baseOccupancy}`
        : null,
    category.maxOccupancy ? `Maximum ${category.maxOccupancy} guests` : null,
    category.bedConfiguration,
    category.sizeSqm ? `${category.sizeSqm} m²` : null,
    category.defaultViewLabel,
  ]
    .filter(Boolean)
    .forEach((value) => facts.append(element("span", "", value)));

  content.append(header, facts);
  if (category.description) {
    content.append(
      element("p", "room-category-description", category.description),
    );
  }

  const picker = element("div", "room-quantity-picker");
  picker.append(element("span", "", "Rooms"));
  const controls = element("div", "room-quantity-controls");
  const decrease = element("button", "room-quantity-button", "−");
  decrease.type = "button";
  decrease.disabled = !selection?.units.length;
  decrease.setAttribute("aria-label", `Remove one ${category.name} room`);
  decrease.addEventListener("click", () =>
    changeRoomQuantity(category, starting, -1),
  );
  const quantity = element("strong", "", String(selection?.units.length || 0));
  quantity.setAttribute("aria-live", "polite");
  const increase = element("button", "room-quantity-button", "+");
  increase.type = "button";
  const availableCount = categoryAvailabilityCount(category.roomCategoryId);
  increase.disabled =
    soldOut ||
    (availableCount !== null &&
      (selection?.units.length || 0) >= availableCount) ||
    totalSelectedRooms() >= 20;
  increase.setAttribute("aria-label", `Add one ${category.name} room`);
  increase.addEventListener("click", () =>
    changeRoomQuantity(category, starting, 1),
  );
  controls.append(decrease, quantity, increase);
  picker.append(controls);
  content.append(picker);

  const plans = element("div", "rate-plan-list");
  plans.append(
    element(
      "p",
      "rate-plan-list-title",
      soldOut ? "This category is unavailable" : "Choose a meal plan",
    ),
  );
  selectableOptions.forEach((option) => {
    const selected = selection?.option?.rateProductId === option.rateProductId;
    const row = element(
      "button",
      `rate-plan-choice${selected ? " selected" : ""}`,
    );
    row.type = "button";
    row.setAttribute("aria-pressed", String(selected));

    const planCopy = element("span", "rate-plan-choice-copy");
    planCopy.append(
      element("strong", "", mealPlanLabel(option.mealPlanCode)),
      element("small", "", option.ratePlanName),
      element("small", "rate-occupancy-copy", occupancyRateLine(option)),
    );

    const planPrice = element("span", "rate-plan-choice-price");
    planPrice.append(
      element(
        "strong",
        "",
        money(option.accommodationMinor, option.currencyCode),
      ),
      element(
        "small",
        "",
        `${money(option.nightlyFromMinor, option.currencyCode)} nightly base`,
      ),
    );

    row.append(
      element("span", "rate-plan-radio", selected ? "✓" : ""),
      planCopy,
      planPrice,
    );
    row.addEventListener("click", () => selectRoomRate(category, option));
    plans.append(row);
  });
  if (soldOut) {
    plans.append(
      element(
        "p",
        "room-select-hint",
        "Try different dates to check this room type.",
      ),
    );
  }
  content.append(plans);

  if (selection) {
    content.append(renderRoomAllocationControls(category, selection));
  } else {
    content.append(
      element(
        "p",
        "room-select-hint",
        soldOut
          ? "Unavailable for your selected dates."
          : "Use the room picker to add this category to your stay.",
      ),
    );
  }

  card.append(visual, content);
  return card;
}

function openCategoryPhoto(category) {
  const roomMedia = (category.media || []).filter(
    (item) => item?.id && item.mediaType === "IMAGE",
  );
  if (roomMedia.length) {
    openPhotoCollection(roomMedia, 0);
    return;
  }

  if (category.coverMediaId) {
    openPhotoCollection(
      [
        {
          id: category.coverMediaId,
          mediaType: "IMAGE",
          altText: `${category.name} room photo`,
          caption: category.name,
        },
      ],
      0,
    );
    return;
  }

  openPropertyPhoto(0);
}

function selectRoomRate(category, option) {
  clearQuoteAndLater();
  const existing = state.roomSelections.get(category.roomCategoryId);
  const units = existing?.units?.length
    ? existing.units
    : [defaultRoomAllocation(category)];
  switchToRoomSelection();
  state.roomSelections.set(category.roomCategoryId, {
    category,
    option,
    units,
    estimatedTotalMinor: scaledOptionEstimate(option, units.length),
    accommodationMinor: Number(option.accommodationMinor || 0),
    extraGuestMinor: Number(option.extraGuestMinor || 0),
    currencyCode: option.currencyCode,
    pricingUnavailable: false,
  });
  renderAvailability(state.availability);
  scheduleSelectionPricing();
}

function changeRoomQuantity(category, defaultOption, change) {
  if (!defaultOption) return;
  clearQuoteAndLater();
  switchToRoomSelection();
  const existing = state.roomSelections.get(category.roomCategoryId);
  if (change > 0) {
    const availableCount = categoryAvailabilityCount(category.roomCategoryId);
    if (
      totalSelectedRooms() >= 20 ||
      (availableCount !== null &&
        (existing?.units.length || 0) >= availableCount)
    ) {
      return;
    }
    const units = existing?.units || [];
    units.push(defaultRoomAllocation(category));
    state.roomSelections.set(category.roomCategoryId, {
      category,
      option: existing?.option || defaultOption,
      units,
      estimatedTotalMinor: scaledOptionEstimate(
        existing?.option || defaultOption,
        units.length,
      ),
      accommodationMinor: Number(
        (existing?.option || defaultOption).accommodationMinor || 0,
      ),
      extraGuestMinor: Number(
        (existing?.option || defaultOption).extraGuestMinor || 0,
      ),
      currencyCode: (existing?.option || defaultOption).currencyCode,
      pricingUnavailable: false,
    });
  } else if (existing?.units.length) {
    existing.units.pop();
    if (!existing.units.length) {
      state.roomSelections.delete(category.roomCategoryId);
    } else {
      existing.estimatedTotalMinor = scaledOptionEstimate(
        existing.option,
        existing.units.length,
      );
    }
  }
  if (!state.roomSelections.size) state.selectionType = null;
  renderAvailability(state.availability);
  scheduleSelectionPricing();
}

function switchToRoomSelection() {
  if (state.selectionType === "entire") {
    state.entireSelection = null;
    state.entirePricingVersion += 1;
    if (state.entirePricingTimer) {
      window.clearTimeout(state.entirePricingTimer);
      state.entirePricingTimer = null;
    }
  }
  state.selectionType = "rooms";
}

function infantMaxAgeForUi() {
  const published = state.property?.guestAgePolicy?.infantMaxAge;
  if (published === null) return null;
  if (Number.isInteger(published)) return published;
  return 5;
}

function childCountsTowardsOccupancy(age) {
  const policy = state.property?.guestAgePolicy;
  if (policy?.infantsCountTowardsOccupancy === true) return true;
  const infantMaxAge = infantMaxAgeForUi();
  if (infantMaxAge === null) return true;
  return Number(age) > infantMaxAge;
}

function occupancyCountingChildren(unit) {
  return unit.childAges.filter((age) => childCountsTowardsOccupancy(age))
    .length;
}

function availabilityChildrenForUnit(unit) {
  return occupancyCountingChildren(unit);
}

function roomUnitOccupancy(unit) {
  return unit.adults + occupancyCountingChildren(unit);
}

function roomAdultMaximum(category, unit) {
  const categoryAdultMax = category.maxAdults || category.maxOccupancy || 20;
  const occupancyMax = category.maxOccupancy || 20;
  return Math.max(
    1,
    Math.min(categoryAdultMax, occupancyMax - occupancyCountingChildren(unit)),
  );
}

function roomChildMaximum(category, unit) {
  const categoryChildMax = category.maxChildren ?? 20;
  const infantCount = unit.childAges.filter(
    (age) => !childCountsTowardsOccupancy(age),
  ).length;
  const remainingOccupancy = Math.max(
    0,
    (category.maxOccupancy || 20) - unit.adults,
  );
  return Math.max(
    0,
    Math.min(categoryChildMax, infantCount + remainingOccupancy),
  );
}

function roomUnitValid(category, unit) {
  if (!Number.isInteger(unit.adults) || unit.adults < 1) return false;
  if (unit.adults > (category.maxAdults || category.maxOccupancy || 20)) {
    return false;
  }
  if (unit.childAges.length > (category.maxChildren ?? 20)) return false;
  return roomUnitOccupancy(unit) <= (category.maxOccupancy || 20);
}

function defaultRoomAllocation(category) {
  const requested = partyTotals();
  const allocated = selectedPartyTotals();
  const remainingAdults = Math.max(0, requested.adults - allocated.adults);
  const remainingPlannedRooms = Math.max(
    1,
    state.requestedRooms - totalSelectedRooms(),
  );
  const adults = clamp(
    Math.ceil(remainingAdults / remainingPlannedRooms) || 1,
    1,
    Math.min(
      category.maxAdults || category.maxOccupancy || 20,
      category.maxOccupancy || 20,
    ),
  );

  const requestedAges = [...(state.units[0]?.childAges || [])];
  const allocatedAges = [...state.roomSelections.values()].flatMap(
    (selection) => selection.units.flatMap((unit) => unit.childAges),
  );
  allocatedAges.forEach((age) => {
    const index = requestedAges.indexOf(age);
    if (index >= 0) requestedAges.splice(index, 1);
  });

  const unit = { adults, childAges: [] };
  const plannedChildren = Math.ceil(
    requestedAges.length / remainingPlannedRooms,
  );
  for (const age of requestedAges) {
    if (unit.childAges.length >= plannedChildren) break;
    if (unit.childAges.length >= (category.maxChildren ?? 20)) break;
    const candidate = {
      adults: unit.adults,
      childAges: [...unit.childAges, age],
    };
    if (roomUnitValid(category, candidate)) {
      unit.childAges.push(age);
    }
  }
  return unit;
}

function renderRoomAllocationControls(category, selection) {
  const section = element("div", "room-allocation-section");
  const heading = element("div", "room-allocation-heading");
  heading.append(
    element("strong", "", "Who is staying in this room?"),
    element(
      "small",
      "",
      selection.units.length === 1
        ? "1 room selected"
        : `${selection.units.length} rooms selected`,
    ),
  );
  section.append(heading);

  const occupancyDisclosure = element("div", "room-occupancy-disclosure");
  occupancyDisclosure.append(
    element(
      "strong",
      "",
      `Base rate includes ${includedOccupancyLabel(selection.option)}`,
    ),
    element(
      "span",
      "",
      `Maximum ${selection.option.maxOccupancy || category.maxOccupancy || 20} guests per room`,
    ),
  );
  extraGuestRateLabels(selection.option).forEach((label) =>
    occupancyDisclosure.append(element("span", "extra-rate-chip", label)),
  );
  section.append(occupancyDisclosure);

  selection.units.forEach((unit, index) => {
    const row = element("div", "room-allocation-row");
    const title = element(
      "strong",
      "room-allocation-title",
      `Room ${index + 1}`,
    );

    const adultsLabel = element("label", "room-guest-field");
    adultsLabel.append(element("span", "", "Adults"));
    const adultMaximum = roomAdultMaximum(category, unit);
    const adults = integerSelect(unit.adults, 1, adultMaximum);
    adults.setAttribute(
      "aria-label",
      `Adults in ${category.name} room ${index + 1}`,
    );
    adults.disabled = adultMaximum === 1 && unit.adults === 1;
    adults.addEventListener("change", () => {
      clearQuoteAndLater();
      unit.adults = Number(adults.value);
      renderAvailability(state.availability);
      scheduleSelectionPricing();
    });
    adultsLabel.append(adults);

    const childrenLabel = element("label", "room-guest-field");
    childrenLabel.append(element("span", "", "Children"));
    const childMaximum = roomChildMaximum(category, unit);
    const children = integerSelect(unit.childAges.length, 0, childMaximum);
    children.setAttribute(
      "aria-label",
      `Children in ${category.name} room ${index + 1}`,
    );
    children.disabled = childMaximum === 0 && unit.childAges.length === 0;
    children.addEventListener("change", () => {
      clearQuoteAndLater();
      const count = Number(children.value);
      unit.childAges = Array.from(
        { length: count },
        (_, childIndex) => unit.childAges[childIndex] ?? 8,
      );
      renderAvailability(state.availability);
      scheduleSelectionPricing();
    });
    childrenLabel.append(children);

    const remove = element("button", "room-remove-button", "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => {
      clearQuoteAndLater();
      selection.units.splice(index, 1);
      if (!selection.units.length) {
        state.roomSelections.delete(category.roomCategoryId);
      }
      renderAvailability(state.availability);
      scheduleSelectionPricing();
    });

    row.append(title, adultsLabel, childrenLabel, remove);

    if (unit.childAges.length) {
      const ages = element("div", "room-child-ages");
      unit.childAges.forEach((age, childIndex) => {
        const label = element("label");
        label.append(element("span", "", `Child ${childIndex + 1} age`));
        const select = document.createElement("select");
        for (let value = 0; value <= 17; value += 1) {
          const ageOption = document.createElement("option");
          ageOption.value = String(value);
          ageOption.textContent = value === 0 ? "Under 1" : `${value} years`;
          ageOption.selected = value === age;

          const candidateAges = [...unit.childAges];
          candidateAges[childIndex] = value;
          ageOption.disabled = !roomUnitValid(category, {
            adults: unit.adults,
            childAges: candidateAges,
          });
          select.append(ageOption);
        }
        select.addEventListener("change", () => {
          clearQuoteAndLater();
          unit.childAges[childIndex] = Number(select.value);
          renderAvailability(state.availability);
          scheduleSelectionPricing();
        });
        label.append(select);
        ages.append(label);
      });
      row.append(ages);
    }

    row.append(
      element(
        "small",
        "room-occupancy-note",
        roomOccupancySelectionNote(selection.option, category, unit),
      ),
    );
    section.append(row);
  });

  const availableCount = categoryAvailabilityCount(category.roomCategoryId);
  if (availableCount !== null && selection.units.length >= availableCount) {
    section.append(
      element(
        "small",
        "room-stock-limit-note",
        `All ${availableCount} currently available ${category.name} ${availableCount === 1 ? "room is" : "rooms are"} selected.`,
      ),
    );
  }
  return section;
}

function requestedRoomCount() {
  return state.requestedRooms;
}

function totalSelectedRooms() {
  return [...state.roomSelections.values()].reduce(
    (count, selection) => count + selection.units.length,
    0,
  );
}

function selectedPartyTotals() {
  return [...state.roomSelections.values()].reduce(
    (totals, selection) => {
      selection.units.forEach((unit) => {
        totals.adults += unit.adults;
        totals.children += unit.childAges.length;
      });
      return totals;
    },
    { adults: 0, children: 0 },
  );
}

function partyMismatchMessage(
  requested,
  selected,
  requestedRooms,
  selectedRooms,
  agesMatch = true,
) {
  const parts = [];
  const roomDelta = selectedRooms - requestedRooms;
  const adultDelta = selected.adults - requested.adults;
  const childDelta = selected.children - requested.children;

  if (roomDelta < 0) {
    const count = Math.abs(roomDelta);
    parts.push(`${count} fewer ${count === 1 ? "room" : "rooms"}`);
  } else if (roomDelta > 0) {
    parts.push(`${roomDelta} extra ${roomDelta === 1 ? "room" : "rooms"}`);
  }

  if (adultDelta < 0) {
    const count = Math.abs(adultDelta);
    parts.push(`${count} fewer ${count === 1 ? "adult" : "adults"}`);
  } else if (adultDelta > 0) {
    parts.push(
      `${adultDelta} extra ${adultDelta === 1 ? "adult" : "adults"} added`,
    );
  }

  if (childDelta < 0) {
    const count = Math.abs(childDelta);
    parts.push(`${count} fewer ${count === 1 ? "child" : "children"}`);
  } else if (childDelta > 0) {
    parts.push(
      `${childDelta} extra ${childDelta === 1 ? "child" : "children"} added`,
    );
  }

  if (!agesMatch && childDelta === 0) {
    parts.push("the selected child ages do not match your search");
  }

  return parts.length
    ? `Different from your search: ${parts.join(" · ")}. Review before continuing.`
    : "Your selection matches the rooms and guests in your search.";
}

function selectionValidation() {
  const requested = partyTotals();
  const selected = selectedPartyTotals();
  const roomCount = totalSelectedRooms();
  const selections = [...state.roomSelections.values()];
  const pricingUnavailable = selections.some(
    (selection) => selection.pricingUnavailable,
  );

  if (!roomCount) {
    return {
      valid: false,
      warning: false,
      message: "Choose a room and meal plan to continue.",
    };
  }

  for (const selection of selections) {
    const availableCount = categoryAvailabilityCount(
      selection.category.roomCategoryId,
    );
    if (availableCount !== null && selection.units.length > availableCount) {
      return {
        valid: false,
        warning: false,
        message:
          `Only ${availableCount} ${selection.category.name} ` +
          `${availableCount === 1 ? "room is" : "rooms are"} currently available.`,
      };
    }

    if (
      selection.units.some((unit) => !roomUnitValid(selection.category, unit))
    ) {
      return {
        valid: false,
        warning: false,
        message: `One ${selection.category.name} room exceeds its maximum occupancy. Adjust the room guests before continuing.`,
      };
    }
  }

  if (pricingUnavailable) {
    return {
      valid: false,
      warning: false,
      message:
        "One selected room is no longer available. Please adjust your selection.",
    };
  }

  const requestedAges = [...(state.units[0]?.childAges || [])].sort(
    (a, b) => a - b,
  );
  const selectedAges = selections
    .flatMap((selection) => selection.units.flatMap((unit) => unit.childAges))
    .sort((a, b) => a - b);
  const agesMatch =
    requestedAges.length === selectedAges.length &&
    requestedAges.every((age, index) => age === selectedAges[index]);
  const mismatch =
    roomCount !== state.requestedRooms ||
    selected.adults !== requested.adults ||
    selected.children !== requested.children ||
    !agesMatch;

  return {
    valid: true,
    warning: mismatch,
    message: mismatch
      ? partyMismatchMessage(
          requested,
          selected,
          state.requestedRooms,
          roomCount,
          agesMatch,
        )
      : "Your selection matches the rooms and guests in your search.",
  };
}

function selectionDateSummary() {
  const arrival = form.arrivalDate.value;
  const departure = form.departureDate.value;
  const nights = Math.round(
    (new Date(`${departure}T12:00:00`).getTime() -
      new Date(`${arrival}T12:00:00`).getTime()) /
      86400000,
  );
  if (!arrival || !departure || nights < 1) return "";
  return `${formatDate(arrival)} – ${formatDate(departure)} · ${nights} ${nights === 1 ? "night" : "nights"}`;
}

function guestSummary(party) {
  return `${party.adults} ${party.adults === 1 ? "adult" : "adults"}, ${party.children} ${party.children === 1 ? "child" : "children"}`;
}

function scaledOptionEstimate(option, unitCount) {
  const requestedUnits = Math.max(1, Number(option.requestedUnits || 1));
  return Math.round(
    (Number(option.estimatedTotalMinor || 0) / requestedUnits) * unitCount,
  );
}

function scheduleSelectionPricing() {
  renderSelectionRibbon();
  if (state.selectionPricingTimer) {
    window.clearTimeout(state.selectionPricingTimer);
  }
  state.selectionPricingTimer = window.setTimeout(() => {
    state.selectionPricingTimer = null;
    void refreshSelectionPricing();
  }, 300);
}

function scheduleEntireSelectionPricing() {
  renderSelectionRibbon();
  if (state.entirePricingTimer) {
    window.clearTimeout(state.entirePricingTimer);
  }
  state.entirePricingTimer = window.setTimeout(() => {
    state.entirePricingTimer = null;
    void refreshEntireSelectionPricing();
  }, 300);
}

async function refreshEntireSelectionPricing() {
  const selection = state.entireSelection;
  if (!selection || state.selectionType !== "entire") return;
  const totals = entireAllocationTotals();
  if (totals.adults < 1) {
    selection.pricingUnavailable = false;
    renderSelectionRibbon();
    return;
  }
  const version = ++state.entirePricingVersion;

  try {
    const data = await apiRequest(
      `/v1/public/properties/${encodeURIComponent(publicSlug)}/availability`,
      {
        method: "POST",
        body: {
          arrivalDate: form.arrivalDate.value,
          departureDate: form.departureDate.value,
          units: [
            {
              adults: totals.adults,
              children: totals.occupancyChildren,
            },
          ],
        },
      },
    );
    if (version !== state.entirePricingVersion || !state.entireSelection)
      return;
    const priced = (data.options || []).find(
      (candidate) =>
        candidate.productType === "FULL_PROPERTY" &&
        candidate.rateProductId === selection.option.rateProductId &&
        candidate.available,
    );
    selection.pricingUnavailable = !priced;
    if (priced) {
      selection.option = { ...selection.option, ...priced };
      selection.estimatedTotalMinor = priced.estimatedTotalMinor;
      selection.accommodationMinor = priced.accommodationMinor;
      selection.extraGuestMinor = priced.extraGuestMinor;
      selection.currencyCode = priced.currencyCode;
    }
  } catch {
    if (version !== state.entirePricingVersion || !state.entireSelection)
      return;
    selection.pricingUnavailable = true;
  }
  if (version === state.entirePricingVersion) {
    renderAvailability(state.availability);
  }
}

async function refreshSelectionPricing() {
  if (!state.roomSelections.size || state.selectionType !== "rooms") return;
  const version = ++state.selectionPricingVersion;
  const selections = [...state.roomSelections.values()];

  await Promise.all(
    selections.map(async (selection) => {
      try {
        const data = await apiRequest(
          `/v1/public/properties/${encodeURIComponent(publicSlug)}/availability`,
          {
            method: "POST",
            body: {
              arrivalDate: form.arrivalDate.value,
              departureDate: form.departureDate.value,
              units: selection.units.map((unit) => ({
                adults: unit.adults,
                children: availabilityChildrenForUnit(unit),
              })),
            },
          },
        );
        if (version !== state.selectionPricingVersion) return;
        const exactOption = (data.options || []).find(
          (option) =>
            option.available &&
            option.rateProductId === selection.option.rateProductId,
        );
        selection.pricingUnavailable = !exactOption;
        if (exactOption) {
          selection.estimatedTotalMinor = exactOption.estimatedTotalMinor;
          selection.accommodationMinor = exactOption.accommodationMinor;
          selection.extraGuestMinor = exactOption.extraGuestMinor;
          selection.currencyCode = exactOption.currencyCode;
        }
      } catch {
        if (version !== state.selectionPricingVersion) return;
        selection.pricingUnavailable = true;
      }
    }),
  );

  if (version === state.selectionPricingVersion) {
    renderSelectionRibbon();
  }
}

function renderSelectionRibbon() {
  if (!selectionRibbon) return;
  if (
    (!state.roomSelections.size && !state.entireSelection) ||
    state.quote ||
    state.roomMixQuote
  ) {
    selectionRibbon.classList.add("hidden");
    return;
  }

  if (state.selectionType === "entire" && state.entireSelection) {
    const party = entireAllocationTotals();
    const capacity = state.entireSelection.option;
    const validation = entireAllocationValidation();
    const includedGuests =
      Number(capacity.includedAdults || 0) +
      Number(capacity.includedChildren || 0);
    selectionSummary.textContent = `Entire ${state.property.name} selected`;
    selectionDates.textContent = selectionDateSummary();
    selectionAllocation.textContent =
      `${guestSummary(party)} in ${party.occupiedRooms} ${party.occupiedRooms === 1 ? "room" : "rooms"} · ` +
      `base price includes ${includedGuests} · maximum ${capacity.maxOccupancy} guests` +
      (Number(state.entireSelection.extraGuestMinor || 0) > 0
        ? ` · extra-person charges ${money(state.entireSelection.extraGuestMinor, state.entireSelection.currencyCode)}`
        : "");
    selectionNotice.textContent = validation.message;
    selectionRibbon.classList.toggle("has-warning", validation.warning);
    selectionRibbon.classList.toggle("has-error", !validation.valid);
    selectionTotal.textContent = money(
      state.entireSelection.estimatedTotalMinor,
      state.entireSelection.currencyCode,
    );
    selectionContinue.disabled = !validation.valid;
    selectionContinue.textContent = "Continue to checkout";
    selectionRibbon.classList.remove("hidden");
    return;
  }

  const selections = [...state.roomSelections.values()];
  const rooms = totalSelectedRooms();
  const validation = selectionValidation();
  const currencyCode = selections[0]?.currencyCode || "INR";
  const totalMinor = selections.reduce(
    (sum, selection) => sum + Number(selection.estimatedTotalMinor || 0),
    0,
  );
  const extraGuestMinor = selections.reduce(
    (sum, selection) => sum + Number(selection.extraGuestMinor || 0),
    0,
  );

  selectionSummary.textContent =
    `${rooms} ${rooms === 1 ? "room" : "rooms"} selected · ` +
    selections
      .map(
        (selection) =>
          `${selection.units.length} × ${selection.category.name} (${mealPlanLabel(selection.option.mealPlanCode)})`,
      )
      .join(" · ");
  const requested = partyTotals();
  const selected = selectedPartyTotals();
  selectionDates.textContent = selectionDateSummary();
  selectionAllocation.textContent =
    `Selected: ${guestSummary(selected)} · Search: ${state.requestedRooms} ${state.requestedRooms === 1 ? "room" : "rooms"}, ${guestSummary(requested)}` +
    (extraGuestMinor
      ? ` · Extra-person charges ${money(extraGuestMinor, currencyCode)}`
      : " · Within base occupancy pricing");
  selectionNotice.textContent = validation.message;
  selectionRibbon.classList.toggle("has-warning", validation.warning);
  selectionRibbon.classList.toggle(
    "has-error",
    !validation.valid && state.roomSelections.size > 0,
  );
  selectionTotal.textContent = money(totalMinor, currencyCode);
  selectionContinue.disabled = !validation.valid;
  selectionContinue.textContent = "Continue to checkout";
  selectionRibbon.classList.remove("hidden");
}

async function continueEntireSelection(button) {
  const selection = state.entireSelection;
  if (!selection?.option || !availableEntireOption()) {
    showInlineMessage(
      "The entire property is no longer available. Check the room choices or try other dates.",
      "warning",
    );
    state.entireSelection = null;
    state.selectionType = null;
    renderSelectionRibbon();
    return;
  }
  const validation = entireAllocationValidation();
  if (!validation.valid) {
    renderSelectionRibbon();
    return;
  }
  const totals = entireAllocationTotals();
  await startBookingWithUnits(selection.option, button, [
    { adults: totals.adults, childAges: [...totals.childAges] },
  ]);
}

async function continueRoomSelection(button) {
  const validation = selectionValidation();
  if (!validation.valid) {
    renderSelectionRibbon();
    return;
  }

  const selections = [...state.roomSelections.values()];
  clearQuoteAndLater();
  const selectionVersion = state.selectionPricingVersion;
  const bookingSearchVersion = state.recommendationRequestVersion;
  setBusy(button, true, "Checking exact price…");

  try {
    if (selections.length === 1) {
      const selection = selections[0];
      const body = {
        rateProductId: selection.option.rateProductId,
        arrivalDate: form.arrivalDate.value,
        departureDate: form.departureDate.value,
        promotionCode: form.promotionCode.value.trim() || null,
        units: selection.units.map((unit) => ({
          adults: unit.adults,
          childAges: [...unit.childAges],
        })),
      };
      const key = operationKey(
        state.session,
        "manual-room-quote",
        JSON.stringify(body),
      );
      const data = await apiRequest(
        `/v1/public/properties/${encodeURIComponent(publicSlug)}/quotes`,
        {
          method: "POST",
          idempotencyKey: key,
          body,
        },
      );

      if (
        selectionVersion !== state.selectionPricingVersion ||
        bookingSearchVersion !== state.recommendationRequestVersion
      )
        return;

      state.roomMixQuote = null;
      state.quote = data.quote;
      state.session.quoteId = data.quote.id;
      state.session.quote = data.quote;
      delete state.session.roomMixQuote;
      delete state.session.holdId;
      delete state.session.hold;
      saveBookingSession(publicSlug, state.session);
      renderQuote(data.quote, { showHoldAction: false });
      renderSelectionRibbon();
      await createHold(null, { scrollToGuest: true });
      return;
    }

    if (form.promotionCode.value.trim()) {
      showInlineMessage(
        "Promo codes are not yet supported when different room categories are booked together. Clear the promo code or choose one category.",
        "warning",
      );
      return;
    }

    const body = {
      arrivalDate: form.arrivalDate.value,
      departureDate: form.departureDate.value,
      items: selections.map((selection) => ({
        rateProductId: selection.option.rateProductId,
        units: selection.units.map((unit) => ({
          adults: unit.adults,
          childAges: [...unit.childAges],
        })),
      })),
    };
    const key = operationKey(
      state.session,
      "manual-room-mix-quote",
      JSON.stringify(body),
    );
    const data = await apiRequest(
      `/v1/public/properties/${encodeURIComponent(publicSlug)}/room-mixes/quotes`,
      {
        method: "POST",
        idempotencyKey: key,
        body,
      },
    );

    if (
      selectionVersion !== state.selectionPricingVersion ||
      bookingSearchVersion !== state.recommendationRequestVersion
    )
      return;

    state.quote = null;
    state.roomMixQuote = data.roomMixQuote;
    state.session.roomMixQuote = data.roomMixQuote;
    delete state.session.quoteId;
    delete state.session.quote;
    delete state.session.holdId;
    delete state.session.hold;
    saveBookingSession(publicSlug, state.session);
    renderRoomMixQuote(data.roomMixQuote);
    renderSelectionRibbon();
    await createRoomMixHold({ scrollToGuest: true });
  } catch (error) {
    if (
      selectionVersion !== state.selectionPricingVersion ||
      bookingSearchVersion !== state.recommendationRequestVersion
    )
      return;
    showInlineMessage(
      messageFor(
        error,
        "This room selection could not be prepared for booking.",
      ),
      "error",
    );
  } finally {
    setBusy(button, false, "Continue to checkout");
    renderSelectionRibbon();
  }
}

function availabilityCard(option, nights) {
  const card = element("article", "availability-card ota-rate-card");
  const category = state.property.roomCategories?.find(
    (item) => item.roomCategoryId === option.roomCategoryId,
  );
  const visual = element("div", "rate-card-visual");
  const coverMediaId =
    option.productType === "FULL_PROPERTY"
      ? state.property.coverMediaId
      : category?.coverMediaId || state.property.coverMediaId;
  if (coverMediaId) {
    const mediaUrl = propertyMediaUrl(coverMediaId);
    visual.classList.add("has-photo");
    visual.style.backgroundImage = `linear-gradient(180deg, transparent 45%, rgba(8, 31, 24, 0.7)), url("${mediaUrl}")`;
  }
  visual.append(
    element(
      "span",
      "rate-card-visual-label",
      option.productType === "FULL_PROPERTY" ? "Entire villa" : "Room",
    ),
  );

  const main = element("div", "availability-copy");
  main.append(
    element(
      "p",
      "option-kicker",
      option.productType === "FULL_PROPERTY"
        ? "Entire property"
        : "Room category",
    ),
    element("h3", "", option.roomCategoryName || state.property.name),
    element(
      "p",
      "rate-plan-name",
      `${mealPlanLabel(option.mealPlanCode)} · ${option.ratePlanName}`,
    ),
  );

  const price = element("div", "availability-price");
  price.append(
    element(
      "span",
      "",
      `Total for ${nights} ${nights === 1 ? "night" : "nights"}`,
    ),
    element(
      "strong",
      "",
      money(option.estimatedTotalMinor, option.currencyCode),
    ),
    element(
      "small",
      "",
      `from ${money(option.nightlyFromMinor, option.currencyCode)} nightly`,
    ),
    element(
      "small",
      "tax-note",
      "GST and any additional fees shown before payment",
    ),
  );
  const button = element("button", "button button-primary", "Book now");
  button.type = "button";
  button.addEventListener("click", () => void startBooking(option, button));
  price.append(
    button,
    element("small", "secure-booking-note", "Secure payment"),
  );
  card.append(visual, main, price);
  return card;
}

async function startBooking(option, button) {
  return startBookingWithUnits(option, button, state.units);
}

async function startBookingWithUnits(option, button, bookingUnits) {
  const idleLabel = button.textContent;
  clearHoldAndLater();
  state.roomMixQuote = null;
  delete state.session.roomMixQuote;
  setBusy(button, true, "Preparing booking…");
  const body = {
    rateProductId: option.rateProductId,
    arrivalDate: form.arrivalDate.value,
    departureDate: form.departureDate.value,
    promotionCode: form.promotionCode.value.trim() || null,
    units: bookingUnits.map((unit) => ({
      adults: unit.adults,
      childAges: [...unit.childAges],
    })),
  };
  const fingerprint = JSON.stringify(body);
  const key = operationKey(state.session, "quote", fingerprint);
  saveBookingSession(publicSlug, state.session);

  try {
    const data = await apiRequest(
      `/v1/public/properties/${encodeURIComponent(publicSlug)}/quotes`,
      {
        method: "POST",
        idempotencyKey: key,
        body,
      },
    );
    state.quote = data.quote;
    state.session.quoteId = data.quote.id;
    state.session.quote = data.quote;
    delete state.session.holdId;
    delete state.session.hold;
    saveBookingSession(publicSlug, state.session);
    renderQuote(data.quote, { showHoldAction: false });
    await createHold(null, { scrollToGuest: true });
  } catch (error) {
    showInlineMessage(
      messageFor(error, "This room could not be prepared for booking."),
      "error",
    );
  } finally {
    setBusy(button, false, idleLabel || "Continue to checkout");
  }
}

function renderQuote(quote, { showHoldAction = true } = {}) {
  quoteSection.classList.remove("hidden");
  quoteSection.replaceChildren();
  const heading = element("div", "section-heading compact-heading");
  const headingCopy = element("div");
  headingCopy.append(
    element("p", "eyebrow", "Exact Wildleaf quote"),
    element("h2", "", quote.productLabel),
  );
  const expiry = element("span", "expiry-pill");
  heading.append(headingCopy, expiry);

  const priceBox = element("div", "quote-price-box");
  const rows = [
    ["Accommodation", quote.accommodationMinor],
    ["Extra guests", quote.extraGuestMinor],
    ["Promotion discount", -quote.discountMinor],
    ["Fees", quote.feeMinor],
    ["Taxes", quote.taxMinor],
  ];
  const breakdown = element("dl", "price-breakdown");
  rows.forEach(([label, value]) => {
    if (value === 0 && !["Fees", "Taxes"].includes(label)) return;
    breakdown.append(
      element("dt", "", label),
      element(
        "dd",
        value < 0 ? "discount" : "",
        `${value < 0 ? "−" : ""}${money(Math.abs(value), quote.currencyCode)}`,
      ),
    );
  });
  breakdown.append(
    element("dt", "price-total-label", "Total payable"),
    element("dd", "price-total", money(quote.totalMinor, quote.currencyCode)),
  );
  priceBox.append(breakdown);

  const details = element("div", "quote-details");
  details.append(
    detailLine(
      "Stay",
      `${formatDate(quote.arrivalDate)} – ${formatDate(quote.departureDate)}`,
    ),
    detailLine("Rate", `${quote.ratePlanName} · ${quote.mealPlanCode}`),
    detailLine("Cancellation", quote.cancellationPolicy.policyName),
  );
  if (quote.promotion.discountMinor > 0) {
    details.append(
      detailLine(
        "Promotion",
        `${quote.promotion.lines.map((line) => line.campaignName).join(", ")} saved ${money(quote.promotion.discountMinor, quote.currencyCode)}`,
      ),
    );
  }

  const action = element("div", "quote-action");
  action.append(
    element(
      "p",
      "fine-print",
      quote.cancellationPolicy.policyText ||
        "Cancellation terms are snapshotted with this quote.",
    ),
    element(
      "p",
      "fine-print",
      "This is your confirmed quote breakdown, including the calculated taxes and fees. No payment is taken until you review the guest details and complete secure checkout.",
    ),
  );
  let holdButton = null;
  if (showHoldAction) {
    holdButton = element(
      "button",
      "button button-primary",
      "Reserve this price",
    );
    holdButton.type = "button";
    holdButton.addEventListener("click", () => void createHold(holdButton));
    action.append(holdButton);
  }

  quoteSection.append(heading, priceBox, details, action);
  startCountdown(expiry, quote.expiresAt, holdButton, "Quote");
}

async function createHold(button, { scrollToGuest = true } = {}) {
  if (!state.quote) return;
  if (button) setBusy(button, true, "Reserving inventory…");
  const fingerprint = state.quote.id;
  const requestVersion = state.recommendationRequestVersion;
  const key = operationKey(state.session, "hold", fingerprint);
  saveBookingSession(publicSlug, state.session);

  try {
    const data = await apiRequest(
      `/v1/public/properties/${encodeURIComponent(publicSlug)}/quotes/${state.quote.id}/hold`,
      { method: "POST", idempotencyKey: key },
    );
    if (
      requestVersion !== state.recommendationRequestVersion ||
      state.quote?.id !== fingerprint
    )
      return;
    state.hold = data.hold;
    state.session.holdId = data.hold.id;
    state.session.hold = data.hold;
    saveBookingSession(publicSlug, state.session);
    if (!checkoutView) {
      navigateToCheckout();
      return true;
    }
    renderGuestForm();
    if (scrollToGuest) {
      guestSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return true;
  } catch (error) {
    if (
      requestVersion !== state.recommendationRequestVersion ||
      state.quote?.id !== fingerprint
    )
      return;
    renderSectionError(
      quoteSection,
      messageFor(error, "Inventory could not be reserved."),
    );
    return false;
  } finally {
    if (button) setBusy(button, false, "Reserve this price");
  }
}

function navigateToCheckout() {
  state.session.voucher = bookingVoucherSnapshot();
  saveBookingSession(publicSlug, state.session);
  const search = preservedSearchParams();
  location.assign(`/checkout/${encodeURIComponent(publicSlug)}?${search}`);
}

function renderGuestForm() {
  guestSection.classList.remove("hidden");
  guestSection.replaceChildren();
  const heading = element("div", "section-heading compact-heading");
  const copy = element("div");
  copy.append(
    element("p", "eyebrow", "Guest details"),
    element("h2", "", "Who is leading the stay?"),
  );
  const expiry = element("span", "expiry-pill");
  heading.append(copy, expiry);

  const guestForm = element("form", "guest-form");
  guestForm.noValidate = false;
  guestForm.innerHTML = `
    <label><span>Full name</span><input name="name" autocomplete="name" maxlength="160" required></label>
    <label><span>Email</span><input name="email" type="email" autocomplete="email" maxlength="320" placeholder="you@example.com"></label>
    <label><span>Phone</span><input name="phone" type="tel" autocomplete="tel" maxlength="40" placeholder="+919876543210"></label>
    <p class="field-help">Add at least an email or an international-format phone number.</p>
    <button class="button button-primary" type="submit">Continue to secure payment</button>
  `;
  const savedGuest = state.session.leadGuest || {};
  guestForm.elements.namedItem("name").value = savedGuest.name || "";
  guestForm.elements.namedItem("email").value = savedGuest.email || "";
  guestForm.elements.namedItem("phone").value = savedGuest.phone || "";
  guestForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const submit = guestForm.querySelector("button[type='submit']");
    void beginCheckout(guestForm, submit);
  });
  guestSection.append(heading, guestForm);
  startCountdown(
    expiry,
    state.hold.expiresAt,
    guestForm.querySelector("button"),
    "Hold",
  );
}

async function beginCheckout(guestForm, button) {
  // Never start a second charge while the browser still has a recoverable
  // pending payment. Resolve the canonical status before creating another order.
  if (state.session.activeCheckout && !state.session.activeCheckout.outcome) {
    renderPendingStatus(
      "An earlier payment is still pending. Check that booking before starting another payment.",
      Boolean(state.session.activeCheckout.checkout),
    );
    void refreshCheckoutStatus(true);
    return;
  }

  const guestName = guestForm.elements.namedItem("name");
  const guestEmail = guestForm.elements.namedItem("email");
  const guestPhone = guestForm.elements.namedItem("phone");
  const leadGuest = {
    name: guestName.value.trim(),
    email: guestEmail.value.trim() || null,
    phone: guestPhone.value.trim() || null,
  };
  if (!leadGuest.email && !leadGuest.phone) {
    renderSectionError(
      guestSection,
      "Please add an email address or phone number.",
    );
    return;
  }

  const roomMixQuoteId = state.roomMixQuote?.id || null;
  const standardQuoteId = state.quote?.id || null;
  const checkoutSourceId = roomMixQuoteId || standardQuoteId;
  if (!checkoutSourceId) {
    renderSectionError(
      guestSection,
      "The exact quote is no longer available. Please choose your rooms again.",
    );
    return;
  }

  const bookingSearchVersion = state.recommendationRequestVersion;
  const selectionVersion = state.selectionPricingVersion;
  setBusy(button, true, "Preparing secure payment…");
  const body = { leadGuest };
  const sourceLabel = roomMixQuoteId ? "room-mix" : "quote";
  const fingerprint = `${sourceLabel}:${checkoutSourceId}:${JSON.stringify(body)}`;
  const key = operationKey(state.session, "checkout", fingerprint);
  state.session.leadGuest = leadGuest;
  saveBookingSession(publicSlug, state.session);

  try {
    const checkoutPath = roomMixQuoteId
      ? `/v1/public/properties/${encodeURIComponent(publicSlug)}/room-mixes/${roomMixQuoteId}/checkout`
      : `/v1/public/properties/${encodeURIComponent(publicSlug)}/quotes/${standardQuoteId}/checkout`;
    const data = await apiRequest(checkoutPath, {
      method: "POST",
      idempotencyKey: key,
      body,
    });
    state.session.activeCheckout = {
      reservationId: data.reservation.id,
      reservationReference: data.reservation.reservationReference,
      paymentIntentId: data.paymentIntent.id,
      totalMinor: data.paymentIntent.amountMinor,
      currencyCode: data.paymentIntent.currencyCode,
      voucher: state.session.voucher || bookingVoucherSnapshot(),
      leadGuest,
      checkout: data.checkout,
    };
    saveBookingSession(publicSlug, state.session);
    if (
      bookingSearchVersion !== state.recommendationRequestVersion ||
      selectionVersion !== state.selectionPricingVersion ||
      (roomMixQuoteId
        ? state.roomMixQuote?.id !== checkoutSourceId
        : state.quote?.id !== checkoutSourceId)
    ) {
      // Preserve the server-created pending booking for recovery, but never
      // open payment for dates or rooms the guest has since changed.
      renderPendingStatus(
        "An earlier booking was prepared after your search changed. Check its status before making another payment.",
        false,
      );
      return;
    }
    renderPendingStatus(
      "Secure payment is ready. Complete it in the Razorpay window.",
      true,
    );
    openRazorpay();
  } catch (error) {
    renderSectionError(
      guestSection,
      messageFor(error, "Secure payment could not be prepared."),
    );
  } finally {
    setBusy(button, false, "Continue to secure payment");
  }
}

function bookingVoucherSnapshot() {
  const propertyName = state.property?.name || "Wildleaf stay";
  if (state.roomMixQuote) {
    const quote = state.roomMixQuote;
    const capacity = quote.items.reduce(
      (total, item) => {
        const category = state.property?.roomCategories?.find(
          (candidate) => candidate.roomCategoryId === item.roomCategoryId,
        );
        const quantity = Number(item.quantity || item.units?.length || 0);
        total.maxAdults += Number(category?.maxAdults || 0) * quantity;
        total.maxChildren += Number(category?.maxChildren || 0) * quantity;
        total.maxOccupancy += Number(category?.maxOccupancy || 0) * quantity;
        return total;
      },
      { maxAdults: 0, maxChildren: 0, maxOccupancy: 0 },
    );
    const guests = quote.items.reduce(
      (total, item) => {
        (item.units || []).forEach((unit) => {
          total.adults += Number(unit.adults || 0);
          total.children += Array.isArray(unit.childAges)
            ? unit.childAges.length
            : 0;
        });
        return total;
      },
      { adults: 0, children: 0 },
    );
    return {
      propertyName,
      arrivalDate: quote.arrivalDate,
      departureDate: quote.departureDate,
      accommodation: quote.items
        .map((item) => `${item.quantity} × ${item.productLabel}`)
        .join(" · "),
      roomCount: Number(quote.quantity || 0),
      ...guests,
      ...capacity,
      extraGuestMinor: Number(quote.grossExtraGuestMinor || 0),
      totalMinor: Number(quote.totalMinor || 0),
      currencyCode: quote.currencyCode || "INR",
    };
  }

  if (!state.quote) return null;
  const quote = state.quote;
  const guests = (quote.units || []).reduce(
    (total, unit) => {
      total.adults += Number(unit.adults || 0);
      total.children += Array.isArray(unit.childAges)
        ? unit.childAges.length
        : Number(unit.children || 0) + Number(unit.infants || 0);
      return total;
    },
    { adults: 0, children: 0 },
  );
  const option =
    quote.productType === "FULL_PROPERTY"
      ? state.entireSelection?.option ||
        (state.entireAvailability?.options || []).find(
          (candidate) => candidate.rateProductId === quote.rateProductId,
        )
      : (state.availability?.options || []).find(
          (candidate) => candidate.rateProductId === quote.rateProductId,
        );
  const category = state.property?.roomCategories?.find(
    (candidate) => candidate.roomCategoryId === quote.roomCategoryId,
  );
  const quantity = Number(quote.quantity || 1);
  return {
    propertyName,
    arrivalDate: quote.arrivalDate,
    departureDate: quote.departureDate,
    accommodation: quote.productLabel,
    roomCount: quantity,
    ...guests,
    maxAdults:
      quote.productType === "FULL_PROPERTY"
        ? Number(option?.maxAdults || 0)
        : Number(option?.maxAdults || category?.maxAdults || 0) * quantity,
    maxChildren:
      quote.productType === "FULL_PROPERTY"
        ? Number(option?.maxChildren || 0)
        : Number(option?.maxChildren || category?.maxChildren || 0) * quantity,
    maxOccupancy:
      quote.productType === "FULL_PROPERTY"
        ? Number(option?.maxOccupancy || 0)
        : Number(option?.maxOccupancy || category?.maxOccupancy || 0) *
          quantity,
    includedAdults:
      quote.productType === "FULL_PROPERTY"
        ? Number(option?.includedAdults || 0)
        : Number(option?.includedAdults || 0) * quantity,
    includedChildren:
      quote.productType === "FULL_PROPERTY"
        ? Number(option?.includedChildren || 0)
        : Number(option?.includedChildren || 0) * quantity,
    roomAllocations:
      quote.productType === "FULL_PROPERTY"
        ? (state.entireSelection?.roomAllocations || [])
            .filter((room) => room.adults || room.childAges.length)
            .map((room) => ({
              room: `${room.category.name} ${room.roomIndex + 1}`,
              adults: room.adults,
              childAges: [...room.childAges],
            }))
        : [],
    extraGuestMinor: Number(quote.extraGuestMinor || 0),
    totalMinor: Number(quote.totalMinor || 0),
    currencyCode: quote.currencyCode || "INR",
  };
}

function openRazorpay() {
  const active = state.session.activeCheckout;
  if (!active?.checkout) {
    renderPendingStatus(
      "Payment details are no longer available in this tab. Check the booking status below.",
      false,
    );
    return;
  }
  // Public beta is test-only: never open a real-money checkout in this build.
  if (
    typeof active.checkout.keyId !== "string" ||
    !active.checkout.keyId.startsWith("rzp_test_")
  ) {
    renderPendingStatus(
      "Online payment is unavailable during Wildleaf public testing. No payment has been taken. Contact Wildleaf directly for a real reservation.",
      false,
    );
    return;
  }
  if (typeof window.Razorpay !== "function") {
    renderPendingStatus(
      "Razorpay could not be loaded. Check your connection, then try opening payment again.",
      true,
    );
    return;
  }

  const guest = state.session.leadGuest || {};
  const checkout = new window.Razorpay({
    key: active.checkout.keyId,
    amount: active.checkout.amountMinor,
    currency: active.checkout.currencyCode,
    name: "Wildleaf Stays",
    description: state.property?.name || "Wildleaf booking",
    order_id: active.checkout.orderId,
    prefill: {
      name: guest.name || "",
      email: guest.email || "",
      contact: guest.phone || "",
    },
    theme: { color: "#244c3d" },
    handler: () => {
      renderPendingStatus(
        "Payment was submitted. Wildleaf is waiting for verified confirmation from Razorpay.",
        false,
      );
      startStatusPolling();
    },
    modal: {
      ondismiss: () => {
        renderPendingStatus(
          "The payment window closed. We are checking whether Razorpay received a payment.",
          true,
        );
        startStatusPolling();
      },
    },
  });
  checkout.open();
}

function renderPendingStatus(message, allowPayment) {
  statusSection.classList.remove("hidden");
  statusSection.replaceChildren();
  const icon = element("div", "status-icon status-pending", "···");
  const content = element("div", "status-content");
  content.append(
    element("p", "eyebrow", "Payment pending"),
    element("h2", "", "Your inventory is reserved"),
    element("p", "", message),
  );
  const active = state.session.activeCheckout;
  if (active) {
    content.append(
      element(
        "p",
        "booking-reference",
        `Reservation ${active.reservationReference}`,
      ),
    );
  }
  const actions = element("div", "status-actions");
  if (allowPayment && active?.checkout) {
    const pay = element(
      "button",
      "button button-primary",
      "Open secure payment",
    );
    pay.type = "button";
    pay.addEventListener("click", openRazorpay);
    actions.append(pay);
  }
  const check = element(
    "button",
    "button button-secondary",
    "Check booking status",
  );
  check.type = "button";
  check.addEventListener("click", () => void refreshCheckoutStatus(false));
  actions.append(check);
  content.append(actions);
  statusSection.append(icon, content);
  statusSection.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function refreshCheckoutStatus(quiet) {
  const active = state.session.activeCheckout;
  if (!active?.reservationId || !active?.paymentIntentId) return null;
  if (!quiet)
    renderPendingStatus(
      "Checking the canonical Wildleaf booking record…",
      Boolean(active.checkout),
    );

  try {
    const data = await apiRequest(
      `/v1/public/properties/${encodeURIComponent(publicSlug)}/checkout-status`,
      {
        method: "POST",
        body: {
          reservationId: active.reservationId,
          paymentIntentId: active.paymentIntentId,
        },
        timeoutMs: 12000,
      },
    );
    // A response for an earlier reservation must never overwrite the status
    // of a newer checkout opened while this network request was in flight.
    if (
      state.session.activeCheckout?.reservationId !== active.reservationId ||
      state.session.activeCheckout?.paymentIntentId !== active.paymentIntentId
    )
      return null;
    renderCheckoutOutcome(data);
    return data;
  } catch (error) {
    if (
      state.session.activeCheckout?.reservationId !== active.reservationId ||
      state.session.activeCheckout?.paymentIntentId !== active.paymentIntentId
    )
      return null;
    if (!quiet)
      renderPendingStatus(
        messageFor(error, "Booking status could not be checked yet."),
        Boolean(active.checkout),
      );
    return null;
  }
}

function renderCheckoutOutcome(data) {
  if (data.outcome === "CONFIRMED") {
    stopStatusPolling();
    minimizeCheckoutSession(data);
    renderFinalStatus(
      "confirmed",
      "Booking confirmed",
      `Your Wildleaf stay from ${formatDate(data.reservation.arrivalDate)} to ${formatDate(data.reservation.departureDate)} is confirmed.`,
      data.reservation.reservationReference,
    );
    return;
  }

  if (data.outcome === "PAYMENT_FAILED") {
    stopStatusPolling();
    minimizeCheckoutSession(data);
    renderFinalStatus(
      "failed",
      "Payment was not completed",
      "No confirmed booking was created. Return to availability to begin a fresh booking.",
      data.reservation.reservationReference,
    );
    return;
  }

  if (data.outcome === "CLOSED") {
    stopStatusPolling();
    minimizeCheckoutSession(data);
    renderFinalStatus(
      "failed",
      "This booking is closed",
      "The reservation is no longer active. Please begin a new availability search.",
      data.reservation.reservationReference,
    );
    return;
  }

  if (data.outcome === "REQUIRES_ASSISTANCE") {
    stopStatusPolling();
    minimizeCheckoutSession(data);
    renderFinalStatus(
      "attention",
      "Payment needs Wildleaf review",
      "Do not make another payment. Keep this reservation reference and contact Wildleaf support.",
      data.reservation.reservationReference,
    );
    return;
  }

  renderPendingStatus(
    data.paymentIntent.expired
      ? "Payment verification is still pending after the payment window expired. Do not pay again; contact Wildleaf if this does not update shortly."
      : "Razorpay confirmation has not reached Wildleaf yet. This page will continue checking safely.",
    Boolean(state.session.activeCheckout?.checkout) &&
      !data.paymentIntent.expired,
  );
}

function renderFinalStatus(kind, title, message, reference) {
  statusSection.classList.remove("hidden");
  statusSection.replaceChildren();
  const icon = element(
    "div",
    `status-icon status-${kind}`,
    kind === "confirmed" ? "✓" : "!",
  );
  const content = element("div", "status-content");
  content.append(
    element(
      "p",
      "eyebrow",
      kind === "confirmed" ? "Verified by Wildleaf" : "Booking update",
    ),
    element("h2", "", title),
    element("p", "", message),
    element("p", "booking-reference", `Reservation ${reference}`),
  );
  const home = element("a", "button button-secondary", "Explore more stays");
  home.href = "/customer/";
  if (kind === "confirmed") {
    const voucher = renderGuestVoucher(reference);
    if (voucher) content.append(voucher);
  }
  content.append(home);
  statusSection.append(icon, content);
  statusSection.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderGuestVoucher(reference) {
  const active = state.session.activeCheckout;
  const voucher = active?.voucher;
  if (!voucher) return null;

  const panel = element("section", "guest-voucher");
  const heading = element("div", "guest-voucher-heading");
  const headingCopy = element("div");
  headingCopy.append(
    element("p", "eyebrow", "Guest voucher"),
    element(
      "h3",
      "",
      voucher.propertyName || state.property?.name || "Wildleaf stay",
    ),
  );
  const print = element(
    "button",
    "button button-secondary voucher-print",
    "Print voucher",
  );
  print.type = "button";
  print.addEventListener("click", () => window.print());
  heading.append(headingCopy, print);

  const details = element("dl", "guest-voucher-grid");
  const bookedGuests =
    Number(voucher.adults || 0) + Number(voucher.children || 0);
  const includedGuests =
    Number(voucher.includedAdults || 0) + Number(voucher.includedChildren || 0);
  const rows = [
    ["Reservation", reference],
    [
      "Stay",
      `${formatDate(voucher.arrivalDate)} – ${formatDate(voucher.departureDate)}`,
    ],
    ["Accommodation", voucher.accommodation],
    [
      "Booked guests",
      `${voucher.adults} ${voucher.adults === 1 ? "adult" : "adults"} · ${voucher.children} ${voucher.children === 1 ? "child" : "children"}`,
    ],
    [
      "Maximum permitted",
      `${voucher.maxOccupancy} guests · up to ${voucher.maxAdults} adults and ${voucher.maxChildren} children`,
    ],
    ...(includedGuests
      ? [["Base price occupancy", `${includedGuests} guests included`]]
      : []),
    [
      "Occupancy used",
      `${bookedGuests} of ${voucher.maxOccupancy} permitted guests`,
    ],
    [
      "Total paid",
      money(
        voucher.totalMinor,
        voucher.currencyCode || active.currencyCode || "INR",
      ),
    ],
  ];
  if (voucher.extraGuestMinor) {
    rows.splice(rows.length - 1, 0, [
      "Extra-person charges",
      money(voucher.extraGuestMinor, voucher.currencyCode || "INR"),
    ]);
  }
  if (active.leadGuest?.name) {
    rows.splice(1, 0, ["Lead guest", active.leadGuest.name]);
  }
  if (voucher.roomAllocations?.length) {
    rows.splice(rows.length - 1, 0, [
      "Room allocation",
      voucher.roomAllocations
        .map(
          (room) =>
            `${room.room}: ${room.adults} ${room.adults === 1 ? "adult" : "adults"}, ${room.childAges.length} ${room.childAges.length === 1 ? "child" : "children"}`,
        )
        .join(" · "),
    ]);
  }
  rows.forEach(([label, value]) => {
    details.append(element("dt", "", label), element("dd", "", value || "—"));
  });

  panel.append(
    heading,
    details,
    element(
      "p",
      "guest-voucher-note",
      "Occupancy limits come from the owner-published room configuration. The booked guest count must remain within both the adult/child limits and the total maximum occupancy.",
    ),
  );
  return panel;
}

function startStatusPolling() {
  stopStatusPolling();
  const pollingReservationId = state.session.activeCheckout?.reservationId;
  const pollingPaymentIntentId = state.session.activeCheckout?.paymentIntentId;
  if (!pollingReservationId || !pollingPaymentIntentId) return;
  state.polling = true;
  state.pollAttempts = 0;
  const poll = async () => {
    state.pollAttempts += 1;
    const checkedStatus = await refreshCheckoutStatus(true);
    if (
      state.session.activeCheckout?.reservationId !== pollingReservationId ||
      state.session.activeCheckout?.paymentIntentId !== pollingPaymentIntentId
    ) {
      stopStatusPolling();
      return;
    }
    // A confirmed, closed, or assistance-required payment may have stopped
    // polling inside refreshCheckoutStatus; do not replace its final outcome.
    if (!state.polling) return;
    // Do not count transport failures as a definitive payment timeout:
    // keep manual recovery visible instead of asserting an outcome.
    if (!checkedStatus && state.pollAttempts >= 24) {
      stopStatusPolling();
      renderPendingStatus(
        "Wildleaf could not reach payment verification. Please check your connection and use Check booking status; do not make another payment.",
        false,
      );
      return;
    }
    if (state.pollAttempts >= 24) {
      stopStatusPolling();
      renderPendingStatus(
        "Automatic payment checks have paused. Your booking is still unresolved; use Check booking status to retry. Do not make another payment until the result is verified.",
        false,
      );
      return;
    }
    if (
      state.polling &&
      !state.pollTimer &&
      state.session.activeCheckout &&
      state.pollAttempts < 24
    ) {
      const delay = Math.min(15000, 2500 + state.pollAttempts * 750);
      state.pollTimer = window.setTimeout(() => {
        state.pollTimer = null;
        void poll();
      }, delay);
    }
  };
  void poll();
}

function stopStatusPolling() {
  state.polling = false;
  if (state.pollTimer) window.clearTimeout(state.pollTimer);
  state.pollTimer = null;
}

function minimizeCheckoutSession(data) {
  const active = state.session.activeCheckout;
  state.session = {
    activeCheckout: {
      outcome: data.outcome,
      reservationId: active.reservationId,
      reservationReference: data.reservation.reservationReference,
      paymentIntentId: active.paymentIntentId,
      totalMinor: active.totalMinor,
      currencyCode: active.currencyCode,
      voucher: active.voucher || null,
      leadGuest: active.leadGuest || state.session.leadGuest || null,
    },
  };
  saveBookingSession(publicSlug, state.session);
}

function restorePreCheckoutSession() {
  const quote = state.session.quote;
  const roomMixQuote = state.session.roomMixQuote;
  const hold = state.session.hold;
  const holdIsActive =
    hold?.id &&
    hold.status === "ACTIVE" &&
    new Date(hold.expiresAt).getTime() > Date.now();
  const standardQuoteIsActive =
    quote?.id && new Date(quote.expiresAt).getTime() > Date.now();
  const roomMixQuoteIsActive =
    roomMixQuote?.id && new Date(roomMixQuote.expiresAt).getTime() > Date.now();

  if (roomMixQuote?.id && (roomMixQuoteIsActive || holdIsActive)) {
    state.quote = null;
    state.roomMixQuote = roomMixQuote;
    renderRoomMixQuote(roomMixQuote);
    if (holdIsActive) {
      state.hold = hold;
      renderGuestForm();
    }
    return true;
  }

  if (!quote?.id || (!standardQuoteIsActive && !holdIsActive)) return false;

  state.roomMixQuote = null;
  state.quote = quote;
  renderQuote(quote);
  if (holdIsActive) {
    state.hold = hold;
    renderGuestForm();
  }
  return true;
}

function renderCheckoutUnavailable() {
  const panel = element("div", "checkout-unavailable");
  panel.append(
    element("p", "eyebrow", "Checkout link expired"),
    element("h2", "", "Choose your stay again"),
    element(
      "p",
      "muted",
      "For your protection, a secure checkout only opens after a live price and temporary room hold have been created.",
    ),
  );
  const link = element("a", "button button-primary", "Return to this property");
  link.href = propertyPageUrl();
  panel.append(link);
  guestSection.replaceChildren(panel);
  guestSection.classList.remove("hidden");
}

function startCountdown(target, expiresAt, button, label) {
  if (state.countdownTimer) window.clearInterval(state.countdownTimer);
  const update = () => {
    const remaining = new Date(expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      target.textContent = `${label} expired`;
      if (button) button.disabled = true;
      window.clearInterval(state.countdownTimer);
      return;
    }
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    target.textContent = `${label} held ${minutes}:${String(seconds).padStart(2, "0")}`;
  };
  update();
  state.countdownTimer = window.setInterval(update, 1000);
}

function scheduleAvailabilitySearch() {
  clearResultsAfterSearchChange();
  if (state.availabilityTimer) {
    window.clearTimeout(state.availabilityTimer);
  }
  if (!state.property) return;
  state.availabilityTimer = window.setTimeout(() => {
    state.availabilityTimer = null;
    void searchAvailability({ resetBooking: false });
    void searchRoomRecommendations();
  }, 350);
}

function clearResultsAfterSearchChange() {
  // Invalidate in-flight results immediately, before the debounced replacement
  // request. Otherwise a stale recommendation can briefly be booked.
  state.recommendationRequestVersion += 1;
  state.availabilityRequestVersion += 1;
  smartRecommendations?.replaceChildren();
  smartMatchSection?.classList.add("hidden");
  state.availability = null;
  state.entireAvailability = null;
  state.entireSelection = null;
  state.selectionType = null;
  state.roomSelections.clear();
  state.categoryAvailabilityCounts.clear();
  state.availabilityProbeCache.clear();
  state.selectionPricingVersion += 1;
  state.entirePricingVersion += 1;
  if (state.selectionPricingTimer) {
    window.clearTimeout(state.selectionPricingTimer);
    state.selectionPricingTimer = null;
  }
  if (state.entirePricingTimer) {
    window.clearTimeout(state.entirePricingTimer);
    state.entirePricingTimer = null;
  }
  availabilityResults.replaceChildren();
  availabilityMessage.classList.add("hidden");
  clearQuoteAndLater();
  renderSelectionRibbon();
}

function clearQuoteAndLater() {
  state.quote = null;
  state.roomMixQuote = null;
  // Keep recoverable payment records, but never restore an obsolete quote or
  // inventory hold after a date, occupancy, room, or promotion change.
  delete state.session.quote;
  delete state.session.quoteId;
  delete state.session.roomMixQuote;
  delete state.session.voucher;
  quoteSection.classList.add("hidden");
  quoteSection.replaceChildren();
  clearHoldAndLater();
}

function clearHoldAndLater() {
  state.hold = null;
  delete state.session.hold;
  delete state.session.holdId;
  saveBookingSession(publicSlug, state.session);
  guestSection.classList.add("hidden");
  guestSection.replaceChildren();
  if (state.countdownTimer) window.clearInterval(state.countdownTimer);
}

function showInlineMessage(message, kind) {
  availabilityMessage.textContent = message;
  availabilityMessage.className = `inline-message message-${kind}`;
}

function renderSectionError(section, message) {
  section.querySelector(".section-error")?.remove();
  const error = element("div", "section-error", message);
  section.append(error);
}

function showPageError(message) {
  pageError.textContent = message;
  pageError.classList.remove("hidden");
  propertyContent.classList.add("hidden");
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
  button.setAttribute("aria-busy", String(busy));
}

function fact(label, value) {
  const card = element("div", "fact-card");
  card.append(element("span", "", label), element("strong", "", value));
  return card;
}

function detailLine(label, value) {
  const line = element("div", "detail-line");
  line.append(element("span", "", label), element("strong", "", value));
  return line;
}

function integerSelect(
  value,
  min,
  max,
  labelForValue = (entry) => String(entry),
) {
  const select = document.createElement("select");
  for (let entry = min; entry <= max; entry += 1) {
    const option = document.createElement("option");
    option.value = String(entry);
    option.textContent = labelForValue(entry);
    option.selected = entry === Number(value);
    select.append(option);
  }
  return select;
}

function numberInput(value, min, max) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  return input;
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function money(minor, currencyCode) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 2,
  }).format(Number(minor || 0) / 100);
}

function formatDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function validDate(value) {
  const normalized = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
  const date = new Date(`${normalized}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === normalized
  );
}

function dateValue(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateValue(date);
}

function clamp(value, minimum, maximum) {
  const normalized = Number.isFinite(value) ? Math.trunc(value) : minimum;
  return Math.max(minimum, Math.min(maximum, normalized));
}

function titleCase(value) {
  return String(value)
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTime(value) {
  const match = String(value || "").match(/^(\d{2}:\d{2})/);
  return match?.[1] || "";
}

function preservedSearchParams() {
  const search = new URLSearchParams();
  for (const key of [
    "destination",
    "arrivalDate",
    "departureDate",
    "rooms",
    "adults",
    "children",
    "childAges",
    "categoryId",
    "typeId",
  ]) {
    if (query.has(key)) search.set(key, query.get(key));
  }
  search.set("arrivalDate", form.arrivalDate.value);
  search.set("departureDate", form.departureDate.value);
  const party = state.units[0] || { adults: 2, childAges: [] };
  search.set("rooms", String(state.requestedRooms));
  search.set("adults", String(party.adults));
  search.set("children", String(party.childAges.length));
  search.set("childAges", party.childAges.join(","));
  return search;
}

function propertyPageUrl(property, search = preservedSearchParams()) {
  const destination = query.get("destination") || property.city || "stays";
  return `/stays/${encodeURIComponent(slugify(destination))}/${encodeURIComponent(publicSlug)}?${search}`;
}

function slugify(value) {
  return (
    String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "stays"
  );
}

function saleModeLabel(value) {
  return (
    {
      ROOMS_ONLY: "Rooms",
      FULL_PROPERTY_ONLY: "Entire property",
      BOTH: "Rooms or entire property",
    }[value] || "Contact property"
  );
}

function mealPlanLabel(code) {
  const labels = {
    EP: "Room only",
    CP: "Breakfast included",
    MAP: "Breakfast and one main meal",
    AP: "All meals included",
  };
  return labels[code] || titleCase(code || "Rate plan");
}

function reasonLabel(reason) {
  return (
    {
      FULL_PROPERTY_SINGLE_UNIT_ONLY:
        "The entire property can be reserved as one unit only.",
      OCCUPANCY_EXCEEDED: "This option cannot accommodate the selected guests.",
      ARRIVAL_CLOSED: "Check-in is closed on the selected arrival date.",
      DEPARTURE_CLOSED: "Check-out is closed on the selected departure date.",
      MINIMUM_STAY: "The selected dates do not meet the minimum stay.",
      MAXIMUM_STAY: "The selected dates exceed the maximum stay.",
      RATE_STOP_SELL: "This rate is not on sale for one or more nights.",
      INVENTORY_UNAVAILABLE: "Enough inventory is not currently available.",
    }[reason] || titleCase(reason)
  );
}

function messageFor(error, fallback) {
  if (!(error instanceof ApiError)) return fallback;
  if (
    error.status === 409 &&
    /commercial configuration|commercial rules/i.test(error.message)
  ) {
    return "Online booking rules for this property are still being completed. No payment was taken.";
  }
  if (error.status === 409) return error.message;
  if (error.status === 503)
    return "Secure payment is temporarily unavailable. No reservation or payment was created.";
  return error.message || fallback;
}

window.addEventListener("pagehide", () => {
  stopStatusPolling();
  if (state.countdownTimer) window.clearInterval(state.countdownTimer);
  if (state.selectionPricingTimer)
    window.clearTimeout(state.selectionPricingTimer);
  if (state.entirePricingTimer) window.clearTimeout(state.entirePricingTimer);
});

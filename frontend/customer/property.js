import {
  ApiError,
  apiRequest,
  loadBookingSession,
  operationKey,
  saveBookingSession,
} from "./api-client.js";

const query = new URLSearchParams(location.search);
const publicSlug = String(query.get("slug") || "")
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
const selectionAllocation = document.querySelector("#selectionAllocation");
const selectionTotal = document.querySelector("#selectionTotal");
const selectionContinue = document.querySelector("#selectionContinue");
const requestedMode = query.get("mode") === "villa" ? "villa" : "hotel";

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
  bookingMode: requestedMode,
  availabilityTimer: null,
  availabilityRequestVersion: 0,
  galleryMedia: [],
  galleryIndex: 0,
  recommendationRequestVersion: 0,
  roomSelections: new Map(),
  selectionPricingTimer: null,
  selectionPricingVersion: 0,
};

if (!publicSlug) {
  showPageError(
    "This property link is incomplete. Return to the collection and choose a stay.",
  );
} else {
  configureInitialSearch();
  wireEvents();
  void loadProperty();
}

function wireEvents() {
  form.unitCount.addEventListener("change", () => {
    if (state.bookingMode === "villa") {
      setUnitCount(1);
      return;
    }
    setUnitCount(clamp(Number(form.unitCount.value), 1, 20));
  });
  form.arrivalDate.addEventListener("change", () => {
    const minimumDeparture = addDays(form.arrivalDate.value, 1);
    form.departureDate.min = minimumDeparture;
    if (form.departureDate.value <= form.arrivalDate.value)
      form.departureDate.value = minimumDeparture;
    scheduleAvailabilitySearch();
  });
  form.departureDate.addEventListener("change", scheduleAvailabilitySearch);
  form.promotionCode.addEventListener("input", clearQuoteAndLater);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void searchAvailability();
  });
  selectionContinue?.addEventListener("click", () => {
    void continueRoomSelection(selectionContinue);
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
  const unitCount =
    state.bookingMode === "villa"
      ? 1
      : clamp(Number(query.get("rooms") || 1), 1, 20);
  const adults = clamp(Number(query.get("adults") || 2), 1, 10);
  const children = clamp(Number(query.get("children") || 0), 0, 6);

  form.arrivalDate.min = today;
  form.arrivalDate.value = arrival;
  form.departureDate.min = addDays(arrival, 1);
  form.departureDate.value = departure;
  form.unitCount.value = String(unitCount);
  state.units = Array.from({ length: unitCount }, () => ({
    adults,
    childAges: Array.from({ length: children }, () => 8),
  }));
  renderOccupancyUnits();
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
    propertyContent.classList.remove("hidden");
    await Promise.allSettled([
      searchAvailability({ resetBooking: false }),
      searchRoomRecommendations(),
    ]);

    if (
      state.session.activeCheckout?.reservationId &&
      state.session.activeCheckout?.paymentIntentId
    ) {
      statusSection.classList.remove("hidden");
      statusSection.scrollIntoView({ block: "nearest" });
      const status = await refreshCheckoutStatus(true);
      if (status?.outcome === "PAYMENT_PENDING") startStatusPolling();
    } else {
      restorePreCheckoutSession();
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
  document.querySelector("#propertyLocation").textContent = [
    property.locality,
    property.city,
    property.stateRegion,
    property.countryCode,
  ]
    .filter(Boolean)
    .join(" · ");
  document.querySelector("#propertySummary").textContent =
    property.shortDescription ||
    "A thoughtful Wildleaf stay with live availability.";
  document.querySelector("#propertyDescription").textContent =
    property.description ||
    property.shortDescription ||
    "Discover a stay designed for unhurried days and memorable evenings.";

  const villa = state.bookingMode === "villa";
  document.querySelector("#bookingModeBadge").textContent = villa
    ? "Entire villa"
    : "Hotel rooms";
  document.querySelector("#propertyOverviewHeading").textContent = villa
    ? "About this entire villa"
    : "About this hotel";
  const facts = document.querySelector("#propertyFacts");
  facts.replaceChildren(
    fact("Stay", villa ? "Entire property" : "Hotel room"),
    fact("Type", titleCase(property.propertyType || "Wildleaf stay")),
    fact("Check-in", formatTime(property.checkInTime) || "Contact property"),
    fact("Check-out", formatTime(property.checkOutTime) || "Contact property"),
  );

  renderPropertyGallery(property);
  renderStayConfiguration(property.roomCategories || []);

  const amenities = document.querySelector("#amenities");
  amenities.replaceChildren(
    ...(property.amenities || []).map((item) => {
      const chip = element("span", "amenity-chip");
      chip.append(
        element("strong", "", item.name),
        item.details
          ? element("small", "", item.details)
          : document.createTextNode(""),
      );
      return chip;
    }),
  );
  if (!property.amenities?.length)
    amenities.append(
      element(
        "p",
        "muted",
        "Property amenities will appear here as they are published.",
      ),
    );

  renderPolicies(property.policies);
}


function renderPropertyGallery(property) {
  const gallery = document.querySelector("#propertyGallery");
  if (!gallery) return;

  const media = (property.media || []).filter(
    (item) => item.mediaType === "IMAGE" && item.id,
  );
  state.galleryMedia = media;
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
    image.alt = item.altText || item.caption || `${property.name} photo ${index + 1}`;
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
  if (!state.galleryMedia.length) return;
  state.galleryIndex =
    (index + state.galleryMedia.length) % state.galleryMedia.length;
  renderPropertyPhotoDialog();

  const dialog = document.querySelector("#propertyPhotoDialog");
  if (dialog && !dialog.open) dialog.showModal();
}

function stepPropertyPhoto(direction) {
  if (!state.galleryMedia.length) return;
  state.galleryIndex =
    (state.galleryIndex + direction + state.galleryMedia.length) %
    state.galleryMedia.length;
  renderPropertyPhotoDialog();
}

function renderPropertyPhotoDialog() {
  const item = state.galleryMedia[state.galleryIndex];
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
  counter.textContent = `${state.galleryIndex + 1} / ${state.galleryMedia.length}`;
  caption.textContent = item.caption || item.altText || "";
}

function propertyMediaUrl(mediaId) {
  return `/v1/public/properties/${encodeURIComponent(publicSlug)}/media/${encodeURIComponent(mediaId)}`;
}

function configureBookingMode(property) {
  const allowsHotel =
    !property.saleMode ||
    property.saleMode === "ROOMS_ONLY" ||
    property.saleMode === "BOTH";
  const allowsVilla =
    property.saleMode === "FULL_PROPERTY_ONLY" || property.saleMode === "BOTH";

  if (state.bookingMode === "villa" && !allowsVilla)
    state.bookingMode = "hotel";
  if (state.bookingMode === "hotel" && !allowsHotel && allowsVilla)
    state.bookingMode = "villa";

  const villa = state.bookingMode === "villa";
  document.querySelector("#unitCountField").classList.toggle("hidden", villa);
  smartMatchSection?.classList.toggle("hidden", villa);
  document.querySelector("#backToResults").href =
    `/customer/?mode=${state.bookingMode}`;
  if (villa && state.units.length !== 1) setUnitCount(1);
  form.unitCount.value = villa ? "1" : String(state.units.length || 1);
}

function renderStayConfiguration(categories) {
  const container = document.querySelector("#stayConfiguration");
  container.replaceChildren();

  if (state.bookingMode === "villa") {
    const summary = element("div", "villa-source-summary");
    summary.append(
      element("strong", "", "One villa, one shared inventory"),
      element(
        "p",
        "",
        "The villa includes all active rooms. Its price, included guests, maximum occupancy, and date availability are calculated from the room categories below.",
      ),
    );
    const names = categories.map((category) => category.name).filter(Boolean);
    if (names.length)
      summary.append(
        element("p", "villa-includes", `Includes: ${names.join(" · ")}`),
      );
    container.append(summary);
    return;
  }

  // Hotel room categories and occupancy are shown once, in their bookable
  // rate cards. Repeating them in the property summary makes the page noisy.
}

function renderPolicies(policies) {
  const container = document.querySelector("#policies");
  if (!policies) {
    container.replaceChildren(
      element(
        "p",
        "muted",
        "Detailed property policies will be shared before booking.",
      ),
    );
    return;
  }
  const entries = [
    ["Children", policies.childrenPolicy],
    ["Pets", policies.petsPolicy],
    ["Smoking", policies.smokingPolicy],
    ["Events", policies.partiesEventsPolicy],
    ["House rules", policies.houseRules],
  ].filter(([, value]) => value);
  container.replaceChildren(
    ...entries.map(([label, value]) => {
      const card = element("article", "policy-card");
      card.append(element("h3", "", label), element("p", "", value));
      return card;
    }),
  );
}

function setUnitCount(count) {
  if (state.bookingMode === "villa") count = 1;
  const previous = state.units;
  state.units = Array.from(
    { length: count },
    (_, index) => previous[index] || { adults: 2, childAges: [] },
  );
  form.unitCount.value = String(count);
  renderOccupancyUnits();
  scheduleAvailabilitySearch();
}

function renderOccupancyUnits() {
  occupancyUnits.replaceChildren(
    ...state.units.map((unit, index) => {
      const card = element("fieldset", "occupancy-card");
      const legend = element(
        "legend",
        "",
        state.bookingMode === "villa"
          ? "Guests for the entire villa"
          : `Room ${index + 1}`,
      );

      const adultsLabel = element("label");
      adultsLabel.append(element("span", "", "Adults"));
      const adults = numberInput(unit.adults, 1, 100);
      adults.setAttribute("aria-label", `Adults in unit ${index + 1}`);
      adults.addEventListener("change", () => {
        unit.adults = clamp(Number(adults.value), 1, 100);
        adults.value = String(unit.adults);
        scheduleAvailabilitySearch();
      });
      adultsLabel.append(adults);

      const childrenLabel = element("label");
      childrenLabel.append(element("span", "", "Children"));
      const children = numberInput(unit.childAges.length, 0, 100);
      children.setAttribute("aria-label", `Children in unit ${index + 1}`);
      children.addEventListener("change", () => {
        const count = clamp(Number(children.value), 0, 100);
        unit.childAges = Array.from(
          { length: count },
          (_, childIndex) => unit.childAges[childIndex] ?? 8,
        );
        renderOccupancyUnits();
        scheduleAvailabilitySearch();
      });
      childrenLabel.append(children);
      card.append(legend, adultsLabel, childrenLabel);

      if (unit.childAges.length) {
        const ages = element("div", "child-ages");
        ages.append(element("p", "", "Children’s ages"));
        unit.childAges.forEach((age, childIndex) => {
          const ageLabel = element("label");
          ageLabel.append(element("span", "", `Child ${childIndex + 1}`));
          const select = document.createElement("select");
          select.setAttribute(
            "aria-label",
            `Age of child ${childIndex + 1} in unit ${index + 1}`,
          );
          for (let value = 0; value <= 17; value += 1) {
            const option = document.createElement("option");
            option.value = String(value);
            option.textContent = value === 0 ? "Under 1" : `${value} years`;
            option.selected = value === age;
            select.append(option);
          }
          select.addEventListener("change", () => {
            unit.childAges[childIndex] = Number(select.value);
            clearQuoteAndLater();
          });
          ageLabel.append(select);
          ages.append(ageLabel);
        });
        card.append(ages);
      }
      return card;
    }),
  );
}

function partyTotals() {
  return state.units.reduce(
    (totals, unit) => ({
      adults: totals.adults + unit.adults,
      children: totals.children + unit.childAges.length,
    }),
    { adults: 0, children: 0 },
  );
}

async function searchRoomRecommendations() {
  if (state.bookingMode !== "hotel" || !state.property) {
    smartMatchSection?.classList.add("hidden");
    return;
  }

  const totals = partyTotals();
  const complexSearch =
    state.units.length > 1 || totals.adults + totals.children > 2;
  if (!complexSearch) {
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
    smartMatchMessage.textContent = "Finding the most suitable room combinations…";
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
    element("p", "option-kicker", recommendationReasonLabel(recommendation.reason)),
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
      element(
        "strong",
        "",
        `${item.quantity} × ${item.roomCategoryName}`,
      ),
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
        element(
          "span",
          "",
          `Room ${index + 1}: ${parts.join(" + ")}`,
        ),
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
    singleCheckoutSupported ? "Book this recommendation" : "Booking unavailable",
  );
  action.type = "button";
  action.disabled = !singleCheckoutSupported;
  if (singleCheckoutSupported) {
    action.addEventListener("click", () =>
      void startRecommendedBooking(recommendation, action),
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
  const key = operationKey(state.session, "room-mix-hold", fingerprint);
  saveBookingSession(publicSlug, state.session);

  try {
    const data = await apiRequest(
      `/v1/public/properties/${encodeURIComponent(publicSlug)}/room-mixes/${state.roomMixQuote.id}/hold`,
      { method: "POST", idempotencyKey: key },
    );
    state.hold = data.hold;
    state.session.holdId = data.hold.id;
    state.session.hold = data.hold;
    saveBookingSession(publicSlug, state.session);
    renderGuestForm();
    if (scrollToGuest) {
      guestSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (error) {
    renderSectionError(
      quoteSection,
      messageFor(error, "The recommended rooms could not be reserved together."),
    );
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
  showInlineMessage(
    "Loading live room inventory and rates…",
    "info",
  );
  availabilityResults.replaceChildren(
    element("div", "availability-loading", "Finding the best available rates…"),
  );

  try {
    const data = await apiRequest(
      `/v1/public/properties/${encodeURIComponent(publicSlug)}/availability`,
      {
        method: "POST",
        body: {
          arrivalDate: form.arrivalDate.value,
          departureDate: form.departureDate.value,
          units: state.units.map((unit) => ({
            adults: unit.adults,
            children: unit.childAges.length,
          })),
        },
      },
    );
    if (requestVersion !== state.availabilityRequestVersion) return;
    state.availability = data;
    renderAvailability(data);
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
  const expectedProductType =
    state.bookingMode === "villa" ? "FULL_PROPERTY" : "ROOM_CATEGORY";
  const matchingOptions = (data.options || []).filter(
    (option) => option.productType === expectedProductType,
  );
  const available = matchingOptions.filter((option) => option.available);

  if (state.bookingMode === "villa") {
    showInlineMessage(
      available.length
        ? `The entire villa is available for ${data.search.nights} ${data.search.nights === 1 ? "night" : "nights"}.`
        : "The entire villa is not available for these dates and guests.",
      available.length ? "success" : "warning",
    );
    availabilityResults.classList.remove("room-category-rail");
    availabilityResults.replaceChildren(
      ...available.map((option) => availabilityCard(option, data.search.nights)),
    );
    renderSelectionRibbon();
    return;
  }

  const groups = groupRoomOptions(available);
  showInlineMessage(
    groups.length
      ? `${groups.length} room ${groups.length === 1 ? "category" : "categories"} available for ${data.search.nights} ${data.search.nights === 1 ? "night" : "nights"}.`
      : "No room currently satisfies your dates and guests.",
    groups.length ? "success" : "warning",
  );

  availabilityResults.classList.add("room-category-rail");
  availabilityResults.replaceChildren(
    ...groups.map(({ category, options }) =>
      roomCategoryCard(category, options, data.search.nights),
    ),
  );
  renderSelectionRibbon();
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

function roomCategoryCard(category, options, nights) {
  const card = element("article", "room-category-card ota-rate-card");
  const selection = state.roomSelections.get(category.roomCategoryId);

  const visual = element("button", "room-category-visual");
  visual.type = "button";
  visual.setAttribute("aria-label", `View photos for ${category.name}`);
  const coverMediaId = category.coverMediaId || state.property.coverMediaId;
  if (coverMediaId) {
    visual.classList.add("has-photo");
    visual.style.backgroundImage =
      `linear-gradient(180deg, transparent 55%, rgba(8, 31, 24, 0.68)), url("${propertyMediaUrl(coverMediaId)}")`;
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
  );

  const starting = options[0];
  const fromPrice = element("div", "room-category-from");
  fromPrice.append(
    element("small", "", `from · ${nights} ${nights === 1 ? "night" : "nights"}`),
    element(
      "strong",
      "",
      money(starting?.estimatedTotalMinor, starting?.currencyCode || "INR"),
    ),
  );
  header.append(headerCopy, fromPrice);

  const facts = element("div", "room-category-facts");
  [
    category.maxOccupancy ? `Up to ${category.maxOccupancy} guests` : null,
    category.bedConfiguration,
    category.sizeSqm ? `${category.sizeSqm} m²` : null,
    category.defaultViewLabel,
  ]
    .filter(Boolean)
    .forEach((value) => facts.append(element("span", "", value)));

  content.append(header, facts);
  if (category.description) {
    content.append(element("p", "room-category-description", category.description));
  }

  const plans = element("div", "rate-plan-list");
  plans.append(element("p", "rate-plan-list-title", "Choose a meal plan"));
  options.forEach((option) => {
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
    );

    const planPrice = element("span", "rate-plan-choice-price");
    planPrice.append(
      element(
        "strong",
        "",
        money(option.estimatedTotalMinor, option.currencyCode),
      ),
      element(
        "small",
        "",
        `${money(option.nightlyFromMinor, option.currencyCode)} nightly`,
      ),
    );

    row.append(
      element("span", "rate-plan-radio", selected ? "✓" : ""),
      planCopy,
      planPrice,
    );
    row.addEventListener("click", () =>
      selectRoomRate(category, option),
    );
    plans.append(row);
  });
  content.append(plans);

  if (selection) {
    content.append(renderRoomAllocationControls(category, selection));
  } else {
    content.append(
      element(
        "p",
        "room-select-hint",
        "Select a meal plan to add this room to your stay.",
      ),
    );
  }

  card.append(visual, content);
  return card;
}

function openCategoryPhoto(category) {
  const mediaIndex = state.galleryMedia.findIndex(
    (item) => item.id === category.coverMediaId,
  );
  openPropertyPhoto(mediaIndex >= 0 ? mediaIndex : 0);
}

function selectRoomRate(category, option) {
  clearQuoteAndLater();
  const existing = state.roomSelections.get(category.roomCategoryId);
  if (!existing && totalSelectedRooms() >= requestedRoomCount()) {
    showInlineMessage(
      "You have already selected the requested number of rooms. Remove a room or increase the room count first.",
      "warning",
    );
    return;
  }

  const units = existing?.units?.length
    ? existing.units
    : [defaultRoomAllocation(category)];
  state.roomSelections.set(category.roomCategoryId, {
    category,
    option,
    units,
    estimatedTotalMinor: scaledOptionEstimate(option, units.length),
    currencyCode: option.currencyCode,
    pricingUnavailable: false,
  });
  renderAvailability(state.availability);
  scheduleSelectionPricing();
}

function defaultRoomAllocation(category) {
  const requested = partyTotals();
  const allocated = selectedPartyTotals();
  const remainingAdults = Math.max(0, requested.adults - allocated.adults);
  const adults = clamp(
    remainingAdults || 1,
    1,
    category.maxAdults || category.maxOccupancy || 10,
  );
  const remainingAges = state.units
    .flatMap((unit) => [...unit.childAges])
    .slice(allocated.children);
  const occupancySpace = Math.max(
    0,
    (category.maxOccupancy || 20) - adults,
  );
  const childCount = Math.min(
    remainingAges.length,
    category.maxChildren ?? remainingAges.length,
    occupancySpace,
  );
  return {
    adults,
    childAges: remainingAges.slice(0, childCount),
  };
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

  selection.units.forEach((unit, index) => {
    const row = element("div", "room-allocation-row");
    const title = element("strong", "room-allocation-title", `Room ${index + 1}`);

    const adultsLabel = element("label", "room-guest-field");
    adultsLabel.append(element("span", "", "Adults"));
    const adults = numberInput(
      unit.adults,
      1,
      category.maxAdults || category.maxOccupancy || 10,
    );
    adults.addEventListener("change", () => {
      clearQuoteAndLater();
      unit.adults = clamp(
        Number(adults.value),
        1,
        category.maxAdults || category.maxOccupancy || 10,
      );
      const maxChildrenByOccupancy = Math.max(
        0,
        (category.maxOccupancy || 20) - unit.adults,
      );
      if (unit.childAges.length > maxChildrenByOccupancy) {
        unit.childAges = unit.childAges.slice(0, maxChildrenByOccupancy);
        renderAvailability(state.availability);
      }
      scheduleSelectionPricing();
      renderSelectionRibbon();
    });
    adultsLabel.append(adults);

    const childrenLabel = element("label", "room-guest-field");
    childrenLabel.append(element("span", "", "Children"));
    const childMaximum = Math.min(
      category.maxChildren ?? 10,
      Math.max(0, (category.maxOccupancy || 20) - unit.adults),
    );
    const children = numberInput(unit.childAges.length, 0, childMaximum);
    children.addEventListener("change", () => {
      clearQuoteAndLater();
      const count = clamp(Number(children.value), 0, childMaximum);
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
          select.append(ageOption);
        }
        select.addEventListener("change", () => {
          clearQuoteAndLater();
          unit.childAges[childIndex] = Number(select.value);
          scheduleSelectionPricing();
          renderSelectionRibbon();
        });
        label.append(select);
        ages.append(label);
      });
      row.append(ages);
    }
    section.append(row);
  });

  if (totalSelectedRooms() < requestedRoomCount()) {
    const add = element("button", "room-add-button", "+ Add another room");
    add.type = "button";
    add.addEventListener("click", () => {
      clearQuoteAndLater();
      selection.units.push(defaultRoomAllocation(category));
      renderAvailability(state.availability);
      scheduleSelectionPricing();
    });
    section.append(add);
  }
  return section;
}

function requestedRoomCount() {
  return state.bookingMode === "villa"
    ? 1
    : clamp(Number(form.unitCount.value), 1, 20);
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

function selectionValidation() {
  const requested = partyTotals();
  const selected = selectedPartyTotals();
  const roomCount = totalSelectedRooms();
  const requestedRooms = requestedRoomCount();
  const pricingUnavailable = [...state.roomSelections.values()].some(
    (selection) => selection.pricingUnavailable,
  );

  if (!roomCount) {
    return { valid: false, message: "Choose a room and meal plan to continue." };
  }
  if (roomCount !== requestedRooms) {
    return {
      valid: false,
      message: `Select ${requestedRooms} ${requestedRooms === 1 ? "room" : "rooms"}. ${roomCount} selected.`,
    };
  }
  if (selected.adults !== requested.adults || selected.children !== requested.children) {
    return {
      valid: false,
      message:
        `Allocate all guests: ${requested.adults} adults · ${requested.children} children requested; ` +
        `${selected.adults} adults · ${selected.children} children allocated.`,
    };
  }
  if (pricingUnavailable) {
    return {
      valid: false,
      message: "One selected room is no longer available. Please adjust your selection.",
    };
  }
  return { valid: true, message: "All guests allocated." };
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

async function refreshSelectionPricing() {
  if (!state.roomSelections.size || state.bookingMode !== "hotel") return;
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
                children: unit.childAges.length,
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
    state.bookingMode !== "hotel" ||
    !state.roomSelections.size ||
    state.quote ||
    state.roomMixQuote
  ) {
    selectionRibbon.classList.add("hidden");
    return;
  }

  const selections = [...state.roomSelections.values()];
  const rooms = totalSelectedRooms();
  const allocation = selectedPartyTotals();
  const validation = selectionValidation();
  const currencyCode = selections[0]?.currencyCode || "INR";
  const totalMinor = selections.reduce(
    (sum, selection) => sum + Number(selection.estimatedTotalMinor || 0),
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
  selectionAllocation.textContent =
    validation.valid
      ? `${allocation.adults} adults · ${allocation.children} children · ready to continue`
      : validation.message;
  selectionTotal.textContent = money(totalMinor, currencyCode);
  selectionContinue.disabled = !validation.valid;
  selectionRibbon.classList.remove("hidden");
}

async function continueRoomSelection(button) {
  const validation = selectionValidation();
  if (!validation.valid) {
    renderSelectionRibbon();
    return;
  }

  const selections = [...state.roomSelections.values()];
  clearQuoteAndLater();
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
    showInlineMessage(
      messageFor(error, "This room selection could not be prepared for booking."),
      "error",
    );
  } finally {
    setBusy(button, false, "Continue");
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
    visual.style.backgroundImage =
      `linear-gradient(180deg, transparent 45%, rgba(8, 31, 24, 0.7)), url("${mediaUrl}")`;
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
      option.productType === "FULL_PROPERTY" ? "Entire property" : "Room category",
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
    element("span", "", `Total for ${nights} ${nights === 1 ? "night" : "nights"}`),
    element("strong", "", money(option.estimatedTotalMinor, option.currencyCode)),
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
  price.append(button, element("small", "secure-booking-note", "Secure payment"));
  card.append(visual, main, price);
  return card;
}

async function startBooking(option, button) {
  clearHoldAndLater();
  state.roomMixQuote = null;
  delete state.session.roomMixQuote;
  setBusy(button, true, "Preparing booking…");
  const body = {
    rateProductId: option.rateProductId,
    arrivalDate: form.arrivalDate.value,
    departureDate: form.departureDate.value,
    promotionCode: form.promotionCode.value.trim() || null,
    units: state.units.map((unit) => ({
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
    setBusy(button, false, "Book now");
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
  const key = operationKey(state.session, "hold", fingerprint);
  saveBookingSession(publicSlug, state.session);

  try {
    const data = await apiRequest(
      `/v1/public/properties/${encodeURIComponent(publicSlug)}/quotes/${state.quote.id}/hold`,
      { method: "POST", idempotencyKey: key },
    );
    state.hold = data.hold;
    state.session.holdId = data.hold.id;
    state.session.hold = data.hold;
    saveBookingSession(publicSlug, state.session);
    renderGuestForm();
    if (scrollToGuest) {
      guestSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (error) {
    renderSectionError(
      quoteSection,
      messageFor(error, "Inventory could not be reserved."),
    );
  } finally {
    if (button) setBusy(button, false, "Reserve this price");
  }
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
      checkout: data.checkout,
    };
    saveBookingSession(publicSlug, state.session);
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

function openRazorpay() {
  const active = state.session.activeCheckout;
  if (!active?.checkout) {
    renderPendingStatus(
      "Payment details are no longer available in this tab. Check the booking status below.",
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
    renderCheckoutOutcome(data);
    return data;
  } catch (error) {
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
  content.append(home);
  statusSection.append(icon, content);
  statusSection.scrollIntoView({ behavior: "smooth", block: "center" });
}

function startStatusPolling() {
  stopStatusPolling();
  state.polling = true;
  state.pollAttempts = 0;
  const poll = async () => {
    state.pollAttempts += 1;
    await refreshCheckoutStatus(true);
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
      reservationId: active.reservationId,
      reservationReference: data.reservation.reservationReference,
      paymentIntentId: active.paymentIntentId,
      totalMinor: active.totalMinor,
      currencyCode: active.currencyCode,
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
    return;
  }

  if (!quote?.id || (!standardQuoteIsActive && !holdIsActive)) return;

  state.roomMixQuote = null;
  state.quote = quote;
  renderQuote(quote);
  if (holdIsActive) {
    state.hold = hold;
    renderGuestForm();
  }
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
  state.availability = null;
  state.roomSelections.clear();
  state.selectionPricingVersion += 1;
  if (state.selectionPricingTimer) {
    window.clearTimeout(state.selectionPricingTimer);
    state.selectionPricingTimer = null;
  }
  availabilityResults.replaceChildren();
  availabilityMessage.classList.add("hidden");
  clearQuoteAndLater();
  renderSelectionRibbon();
}

function clearQuoteAndLater() {
  state.quote = null;
  state.roomMixQuote = null;
  quoteSection.classList.add("hidden");
  quoteSection.replaceChildren();
  clearHoldAndLater();
}

function clearHoldAndLater() {
  state.hold = null;
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
  if (state.selectionPricingTimer) window.clearTimeout(state.selectionPricingTimer);
});

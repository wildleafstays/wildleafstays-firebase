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
const requestedMode = query.get("mode") === "villa" ? "villa" : "hotel";

const state = {
  property: null,
  units: [],
  availability: null,
  quote: null,
  hold: null,
  session: publicSlug ? loadBookingSession(publicSlug) : {},
  countdownTimer: null,
  pollTimer: null,
  pollAttempts: 0,
  polling: false,
  bookingMode: requestedMode,
  availabilityTimer: null,
  availabilityRequestVersion: 0,
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
    await searchAvailability({ resetBooking: false });

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
  document.querySelector("#assuranceHeading").textContent = villa
    ? "Entire property"
    : "Hotel room";
  document.querySelector("#assuranceNote").textContent = villa
    ? "One reservation includes every active room in the property."
    : "Choose only the room category and number of rooms you need.";

  const facts = document.querySelector("#propertyFacts");
  facts.replaceChildren(
    fact("You are booking", villa ? "Entire property" : "Hotel room"),
    fact("Property type", titleCase(property.propertyType || "Wildleaf stay")),
    fact("Check-in", formatTime(property.checkInTime) || "Contact property"),
    fact("Check-out", formatTime(property.checkOutTime) || "Contact property"),
  );

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
  showInlineMessage(
    available.length
      ? `${available.length} bookable ${available.length === 1 ? "option" : "options"} for ${data.search.nights} ${data.search.nights === 1 ? "night" : "nights"}.`
      : state.bookingMode === "villa"
        ? "The entire villa is not available for these dates and guests."
        : "No room currently satisfies your dates and guests.",
    available.length ? "success" : "warning",
  );

  availabilityResults.replaceChildren(
    ...available.map((option) => availabilityCard(option, data.search.nights)),
  );
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
    const mediaUrl = `/v1/public/properties/${encodeURIComponent(publicSlug)}/media/${encodeURIComponent(coverMediaId)}`;
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
  const facts = element("div", "rate-card-facts");
  for (const value of [
    category?.maxOccupancy
      ? `Up to ${category.maxOccupancy} guests`
      : null,
    category?.bedConfiguration,
    category?.sizeSqm ? `${category.sizeSqm} m²` : null,
    `${option.requestedUnits} ${option.requestedUnits === 1 ? "room" : "rooms"}`,
  ].filter(Boolean)) {
    facts.append(element("span", "", `✓ ${value}`));
  }
  main.append(facts);
  if (category?.description) {
    main.append(element("p", "rate-card-description", category.description));
  }

  const price = element("div", "availability-price");
  price.append(
    element("span", "", `Total for ${nights} ${nights === 1 ? "night" : "nights"}`),
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
    element("small", "tax-note", "GST and mandatory fees shown before payment"),
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

  setBusy(button, true, "Preparing secure payment…");
  const body = { leadGuest };
  const fingerprint = `${state.quote.id}:${JSON.stringify(body)}`;
  const key = operationKey(state.session, "checkout", fingerprint);
  state.session.leadGuest = leadGuest;
  saveBookingSession(publicSlug, state.session);

  try {
    const data = await apiRequest(
      `/v1/public/properties/${encodeURIComponent(publicSlug)}/quotes/${state.quote.id}/checkout`,
      { method: "POST", idempotencyKey: key, body },
    );
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
  const hold = state.session.hold;
  const holdIsActive =
    hold?.id &&
    hold.status === "ACTIVE" &&
    new Date(hold.expiresAt).getTime() > Date.now();
  const quoteIsActive =
    quote?.id && new Date(quote.expiresAt).getTime() > Date.now();
  if (!quote?.id || (!quoteIsActive && !holdIsActive)) return;

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
  }, 350);
}

function clearResultsAfterSearchChange() {
  state.availability = null;
  availabilityResults.replaceChildren();
  availabilityMessage.classList.add("hidden");
  clearQuoteAndLater();
}

function clearQuoteAndLater() {
  state.quote = null;
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
});

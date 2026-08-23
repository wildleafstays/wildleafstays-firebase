import { ApiError, apiRequest } from "./api-client.js";

const form = document.querySelector("#searchForm");
const results = document.querySelector("#results");
const resultsTitle = document.querySelector("#resultsTitle");
const resultsStatus = document.querySelector("#resultsStatus");
const destinationList = document.querySelector("#destinationList");

setDefaultDates();
void initialize();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void loadProperties(form.destination.value.trim());
});

async function initialize() {
  renderLoadingCards();
  await Promise.allSettled([loadDestinations(), loadProperties("")]);
}

async function loadDestinations() {
  try {
    const data = await apiRequest("/v1/public/destinations", {
      cache: "default",
    });
    destinationList.replaceChildren(
      ...(data.destinations || []).map((destination) => {
        const option = document.createElement("option");
        option.value = destination.city;
        option.label = [destination.city, destination.stateRegion]
          .filter(Boolean)
          .join(", ");
        return option;
      }),
    );
  } catch {
    // Property discovery remains usable when destination suggestions are unavailable.
  }
}

async function loadProperties(destination) {
  resultsTitle.textContent = destination
    ? `Stays around ${destination}`
    : "Places worth travelling for";
  resultsStatus.textContent = "Finding live Wildleaf properties…";
  renderLoadingCards();

  const query = new URLSearchParams({ limit: "100" });
  if (destination) query.set("destination", destination);

  try {
    const data = await apiRequest(`/v1/public/properties?${query}`, {
      cache: "default",
    });
    renderProperties(data.properties || []);
  } catch (error) {
    renderError(error);
  }
}

function renderProperties(properties) {
  results.replaceChildren();
  if (!properties.length) {
    resultsStatus.textContent =
      "No Wildleaf properties match this destination yet.";
    const empty = element("div", "empty-state");
    empty.append(
      element("h3", "", "No stays found"),
      element(
        "p",
        "",
        "Try a nearby city or clear the destination to explore every live property.",
      ),
    );
    results.append(empty);
    return;
  }

  resultsStatus.textContent = `${properties.length} ${properties.length === 1 ? "property" : "properties"}`;
  properties.forEach((property, index) =>
    results.append(propertyCard(property, index)),
  );
}

function propertyCard(property, index) {
  const article = element("article", "property-card");
  const visual = element("div", `property-visual visual-${(index % 4) + 1}`);
  visual.append(
    element("span", "property-index", String(index + 1).padStart(2, "0")),
    element("span", "property-initial", property.name?.slice(0, 1) || "W"),
  );

  const body = element("div", "property-card-body");
  const location = [property.locality, property.city, property.stateRegion]
    .filter(Boolean)
    .join(", ");
  body.append(
    element("p", "property-location", location || property.countryCode),
    element("h3", "", property.name),
    element(
      "p",
      "property-description",
      property.shortDescription ||
        "A distinctive Wildleaf stay with live availability and secure booking.",
    ),
  );

  const tags = element("div", "property-tags");
  if (property.propertyType)
    tags.append(element("span", "tag", titleCase(property.propertyType)));
  if (property.saleMode)
    tags.append(element("span", "tag", saleModeLabel(property.saleMode)));
  body.append(tags);

  const link = element("a", "text-link", "Explore this stay");
  link.href = propertyUrl(property.publicSlug);
  link.setAttribute("aria-label", `Explore ${property.name}`);
  body.append(link);

  article.append(visual, body);
  return article;
}

function propertyUrl(publicSlug) {
  const params = new URLSearchParams({
    slug: publicSlug,
    arrivalDate: form.arrivalDate.value,
    departureDate: form.departureDate.value,
    rooms: form.rooms.value,
    adults: form.adults.value,
    children: form.children.value,
  });
  return `/customer/property.html?${params}`;
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
  retry.addEventListener(
    "click",
    () => void loadProperties(form.destination.value.trim()),
  );
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
  });
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

function titleCase(value) {
  return String(value)
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function saleModeLabel(value) {
  return (
    {
      ROOMS_ONLY: "Rooms",
      FULL_PROPERTY_ONLY: "Entire property",
      BOTH: "Rooms or entire property",
    }[value] || titleCase(value)
  );
}

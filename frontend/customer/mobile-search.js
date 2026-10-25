export function mountMobileSearch({
  form,
  locationInput = null,
  arrivalInput,
  departureInput,
  adultsInput,
  kidsInput,
  roomsInput = null,
  childAgeSelector = "",
  sourceElements = [],
  variant = "search",
}) {
  if (!form || !arrivalInput || !departureInput || !adultsInput || !kidsInput) {
    return { refresh() {} };
  }

  sourceElements.filter(Boolean).forEach((element) =>
    element.classList.add("mobile-search-source"),
  );
  form.classList.add("mobile-search-enhanced");

  const bar = document.createElement("div");
  bar.className = `mobile-compact-search mobile-compact-search-${variant}`;
  bar.setAttribute("aria-label", "Search stay details");

  const locationButton = locationInput
    ? segment("location", "Choose location", "pin")
    : null;
  const datesButton = segment("dates", "Choose stay dates", "calendar");
  const adultsButton = segment("guests", "Choose adults", "adult");
  const kidsButton = segment("guests", "Choose kids", "kid");
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "mobile-compact-submit";
  submit.setAttribute(
    "aria-label",
    variant === "property" ? "Update stay details" : "Search available stays",
  );
  submit.append(icon(variant === "property" ? "arrow" : "search"));

  bar.append(...[locationButton, datesButton, adultsButton, kidsButton, submit].filter(Boolean));

  const popover = document.createElement("section");
  popover.className = "mobile-search-popover";
  popover.hidden = true;
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-modal", "false");
  form.prepend(bar, popover);

  locationButton?.addEventListener("click", () => openLocationPanel());
  datesButton.addEventListener("click", () => openDatePanel());
  adultsButton.addEventListener("click", () => openGuestPanel());
  kidsButton.addEventListener("click", () => openGuestPanel());
  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);
  form.addEventListener("submit", closePopover);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePopover();
  });
  document.addEventListener("click", (event) => {
    if (!popover.hidden && !form.contains(event.target)) closePopover();
  });

  refresh();
  return { refresh, close: closePopover };

  function refresh() {
    if (locationButton) {
      locationButton.querySelector(".mobile-segment-value").textContent =
        locationInput.value.trim() || "Location";
    }
    datesButton.querySelector(".mobile-segment-value").textContent = dateRangeLabel(
      arrivalInput.value,
      departureInput.value,
    );
    adultsButton.querySelector(".mobile-segment-value").textContent = String(
      Math.max(1, Number(adultsInput.value) || 1),
    );
    kidsButton.querySelector(".mobile-segment-value").textContent = String(
      Math.max(0, Number(kidsInput.value) || 0),
    );
  }

  function openLocationPanel() {
    const input = document.createElement("input");
    input.type = "text";
    input.value = locationInput.value;
    input.placeholder = "Location";
    input.autocomplete = "off";
    const list = locationInput.getAttribute("list");
    if (list) input.setAttribute("list", list);
    openPanel("Where would you like to stay?", input, () => {
      locationInput.value = input.value.trim();
      signal(locationInput, "input");
      signal(locationInput, "change");
    });
    input.focus();
  }

  function openDatePanel() {
    const fields = document.createElement("div");
    fields.className = "mobile-range-fields";
    const start = labelledInput("Check-in", "date", arrivalInput.value);
    const end = labelledInput("Check-out", "date", departureInput.value);
    start.input.min = arrivalInput.min;
    end.input.min = departureInput.min || nextDate(start.input.value);
    start.input.addEventListener("change", () => {
      end.input.min = nextDate(start.input.value);
      if (!end.input.value || end.input.value <= start.input.value) {
        end.input.value = end.input.min;
      }
    });
    fields.append(start.label, end.label);
    openPanel("Choose your date range", fields, () => {
      if (!start.input.value || !end.input.value || end.input.value <= start.input.value) {
        end.input.setCustomValidity("Check-out must be after check-in.");
        end.input.reportValidity();
        return false;
      }
      arrivalInput.value = start.input.value;
      signal(arrivalInput, "change");
      departureInput.value = end.input.value;
      signal(departureInput, "change");
      return true;
    });
  }

  function openGuestPanel() {
    const fields = document.createElement("div");
    fields.className = "mobile-guest-fields";
    const adults = labelledInput("Adults", "number", adultsInput.value);
    const kids = labelledInput("Kids", "number", kidsInput.value);
    adults.input.min = adultsInput.min || "1";
    adults.input.max = adultsInput.max || "20";
    kids.input.min = kidsInput.min || "0";
    kids.input.max = kidsInput.max || "20";
    fields.append(adults.label, kids.label);

    let rooms = null;
    if (roomsInput) {
      rooms = labelledInput("Rooms", "number", roomsInput.value);
      rooms.input.min = roomsInput.min || "1";
      rooms.input.max = roomsInput.max || "20";
      fields.append(rooms.label);
    }

    const ages = document.createElement("div");
    ages.className = "mobile-child-age-fields";
    fields.append(ages);
    const existingAges = () =>
      childAgeSelector
        ? [...form.querySelectorAll(childAgeSelector)].map((field) => field.value)
        : [];
    renderMobileAges(ages, Number(kids.input.value), existingAges());
    kids.input.addEventListener("input", () => {
      const previous = [...ages.querySelectorAll("select")].map((field) => field.value);
      renderMobileAges(ages, Number(kids.input.value), previous);
    });

    openPanel("Guests and rooms", fields, () => {
      adultsInput.value = String(clampInput(adults.input));
      kidsInput.value = String(clampInput(kids.input));
      if (rooms && roomsInput) roomsInput.value = String(clampInput(rooms.input));
      signal(adultsInput, "change");
      signal(kidsInput, "change");
      if (rooms && roomsInput) signal(roomsInput, "change");

      const ageValues = [...ages.querySelectorAll("select")].map((field) => field.value);
      const originalAgeFields = childAgeSelector
        ? [...form.querySelectorAll(childAgeSelector)]
        : [];
      originalAgeFields.forEach((field, index) => {
        field.value = ageValues[index] ?? field.value;
        signal(field, "change");
      });
      return true;
    });
  }

  function openPanel(title, content, apply) {
    popover.replaceChildren();
    const header = document.createElement("div");
    header.className = "mobile-popover-head";
    const heading = document.createElement("h3");
    heading.textContent = title;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "mobile-popover-close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    close.addEventListener("click", closePopover);
    header.append(heading, close);

    const applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.className = "mobile-popover-apply";
    applyButton.textContent = "Apply";
    applyButton.addEventListener("click", () => {
      if (apply() === false) return;
      refresh();
      closePopover();
    });
    popover.append(header, content, applyButton);
    popover.hidden = false;
  }

  function closePopover() {
    popover.hidden = true;
  }
}

function segment(kind, label, iconName) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `mobile-search-segment mobile-search-${kind}`;
  button.setAttribute("aria-label", label);
  button.append(icon(iconName));
  const value = document.createElement("span");
  value.className = "mobile-segment-value";
  button.append(value);
  return button;
}

function labelledInput(text, type, value) {
  const label = document.createElement("label");
  const span = document.createElement("span");
  span.textContent = text;
  const input = document.createElement("input");
  input.type = type;
  input.value = value;
  label.append(span, input);
  return { label, input };
}

function renderMobileAges(container, count, previous) {
  container.replaceChildren();
  const safeCount = Math.max(0, Math.min(20, Number(count) || 0));
  if (!safeCount) return;
  const title = document.createElement("p");
  title.textContent = "Kids’ ages at check-in";
  container.append(title);
  for (let index = 0; index < safeCount; index += 1) {
    const label = document.createElement("label");
    const span = document.createElement("span");
    span.textContent = `Kid ${index + 1}`;
    const select = document.createElement("select");
    select.setAttribute("data-mobile-child-age", "");
    select.append(new Option("Select age", ""));
    for (let age = 0; age <= 17; age += 1) {
      select.append(new Option(age === 0 ? "Under 1" : `${age} years`, String(age)));
    }
    select.value = previous[index] ?? "";
    label.append(span, select);
    container.append(label);
  }
}

function dateRangeLabel(arrival, departure) {
  if (!arrival || !departure) return "Add dates";
  return `${shortDate(arrival)}–${shortDate(departure)}`;
}

function shortDate(value) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Add date";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date);
}

function nextDate(value) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function clampInput(input) {
  return Math.min(
    Number(input.max || 20),
    Math.max(Number(input.min || 0), Number(input.value) || Number(input.min || 0)),
  );
}

function signal(input, type) {
  input.dispatchEvent(new Event(type, { bubbles: true }));
}

function icon(name) {
  const wrapper = document.createElement("span");
  wrapper.className = "mobile-search-icon";
  wrapper.setAttribute("aria-hidden", "true");
  const paths = {
    pin: '<path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 9h16"/>',
    adult: '<circle cx="12" cy="7" r="3"/><path d="M6 21v-2a6 6 0 0 1 12 0v2"/>',
    kid: '<circle cx="12" cy="12" r="7"/><path d="M9 11h.01M15 11h.01M9.5 15c1.5 1.2 3.5 1.2 5 0M12 5V3"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4 4"/>',
    arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
  };
  wrapper.innerHTML = `<svg viewBox="0 0 24 24" focusable="false">${paths[name]}</svg>`;
  return wrapper;
}

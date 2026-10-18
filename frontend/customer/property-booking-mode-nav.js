import { apiRequest } from "./api-client.js";

const params = new URLSearchParams(location.search);
const publicSlug = String(params.get("slug") || "").trim().toLowerCase();
const requestedMode = params.get("mode") === "villa" ? "villa" : "hotel";
const switchLink = document.querySelector("#entirePropertySwitch");
const roomsLink = document.querySelector("#smartstayRoomOption");
const optionPanel = document.querySelector("#smartstayStayOptions");
const partySummary = document.querySelector("#smartstayPartySummary");
const privacyNotice = document.querySelector("#smartstayPrivacyNotice");
const backLink = document.querySelector("#backToResults");

if (backLink) {
  const returnParams = new URLSearchParams();
  for (const key of ["destination", "categoryId", "typeId", "arrivalDate", "departureDate", "rooms", "adults", "children", "childAges"]) {
    if (params.has(key)) returnParams.set(key, params.get(key));
  }
  if (requestedMode === "villa") returnParams.set("privateStay", "1");
  backLink.href = `/customer/?${returnParams}`;
}

if (publicSlug && optionPanel) void configureStayOptions();

async function configureStayOptions() {
  try {
    const data = await apiRequest(
      `/v1/public/properties/${encodeURIComponent(publicSlug)}`,
      { cache: "default" },
    );
    const saleMode = data.property?.saleMode;
    const allowsRooms = !saleMode || saleMode === "ROOMS_ONLY" || saleMode === "BOTH";
    const allowsEntire = saleMode === "FULL_PROPERTY_ONLY" || saleMode === "BOTH";
    if (!allowsRooms && !allowsEntire) return;

    const rooms = Math.max(1, Number(params.get("rooms")) || 1);
    const adults = Math.max(1, Number(params.get("adults")) || 2);
    const children = Math.max(0, Number(params.get("children")) || 0);
    if (partySummary) {
      partySummary.textContent =
        `${adults} adult${adults === 1 ? "" : "s"} · ${children} child${children === 1 ? "" : "ren"} · ${rooms} requested room${rooms === 1 ? "" : "s"}`;
    }
    const exclusive = requestedMode === "villa";
    if (privacyNotice) {
      privacyNotice.textContent = exclusive
        ? "Exclusive use means no unrelated overnight guests share this property. Room count is a search preference, not a restriction on the number of rooms reserved with an entire-property stay."
        : "Individual rooms may share common spaces with other guests. You can also explore reserving the entire property, if offered.";
    }

    if (allowsEntire && switchLink) {
      const villaParams = new URLSearchParams(location.search);
      villaParams.set("slug", publicSlug);
      villaParams.set("mode", "villa");
      // Preserve requested room count so guests can return to their original group search.
      switchLink.href = `/customer/property.html?${villaParams}`;
      switchLink.classList.toggle("hidden", exclusive);
      if (!exclusive) {
        switchLink.textContent = "Checking exclusive-use availability…";
        const arrivalDate = params.get("arrivalDate");
        const departureDate = params.get("departureDate");
        if (arrivalDate && departureDate && departureDate > arrivalDate) {
          try {
            const availability = await apiRequest(
              `/v1/public/properties/${encodeURIComponent(publicSlug)}/availability`,
              { method: "POST", body: {
                arrivalDate, departureDate, units: [{ adults, children }]
              } }
            );
            const offers = (availability.options || [])
              .filter((offer) => offer.available && offer.productType === "FULL_PROPERTY")
              .sort((left, right) => left.estimatedTotalMinor - right.estimatedTotalMinor);
            if (offers.length) {
              const offer = offers[0];
              const estimate = new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency: offer.currencyCode || "INR",
                maximumFractionDigits: 0
              }).format(offer.estimatedTotalMinor / 100);
              switchLink.textContent =
                `Explore exclusive use · from ${estimate} before taxes & fees →`;
            } else {
              switchLink.classList.add("hidden");
              if (privacyNotice) privacyNotice.textContent +=
                " Exclusive use is unavailable for the selected dates and guests.";
            }
          } catch {
            switchLink.textContent = "Explore exclusive use · check live price →";
          }
        } else {
          switchLink.textContent = "Explore exclusive use · check live price →";
        }
      }
    }

    if (allowsRooms && roomsLink) {
      const roomParams = new URLSearchParams(location.search);
      roomParams.set("slug", publicSlug);
      roomParams.set("mode", "hotel");
      roomParams.set("rooms", String(rooms));
      roomsLink.href = `/customer/property.html?${roomParams}`;
      roomsLink.classList.toggle("hidden", !exclusive);
    }
    optionPanel.classList.remove("hidden");
  } catch {
    // Optional offer explanation must never interrupt real booking.
  }
}

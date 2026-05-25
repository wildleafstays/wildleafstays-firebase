const form = document.querySelector("#searchForm");
const resultsEl = document.querySelector("#results");
const statusEl = document.querySelector("#statusText");

let latestResults = [];

setDefaultDates();
loadHomepage();

form.addEventListener("submit", async event => {
  event.preventDefault();
  const params = new URLSearchParams(new FormData(form));
  statusEl.textContent = "Checking live availability...";
  resultsEl.innerHTML = "";

  try {
    const response = await fetch(`/api/availability/search?${params.toString()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Search failed");

    latestResults = data.results || [];
    statusEl.textContent = latestResults.length
      ? `${latestResults.length} available propert${latestResults.length === 1 ? "y" : "ies"}`
      : "No available stays found for these dates.";

    resultsEl.innerHTML = latestResults.map(renderResult).join("");
  } catch (err) {
    statusEl.textContent = err.message;
  }
});

function renderResult(result) {
  const property = result.property;
  const photo = property.photos?.[0] || "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80";
  const facilities = [...(property.facilities || []), ...(property.amenities || [])].slice(0, 8);
  const minRoomPrice = Math.min(...(result.roomOptions || []).map(room => Number(room.basePrice || 0)));
  const optionCount = (result.roomOptions || []).length + (result.villaOption?.available ? 1 : 0);

  return `
    <article class="property-card search-card">
      <img class="property-photo" src="${photo}" alt="${escapeHtml(property.name)}">
      <div class="search-card-body">
        <h3>${escapeHtml(property.name)}</h3>
        <div class="muted">${escapeHtml(property.destination || "")}</div>
        <p>${escapeHtml(property.description || "Comfortable stay with live booking availability.")}</p>
        <div class="chips">${facilities.map(item => `<span>${escapeHtml(item)}</span>`).join("")}</div>
      </div>
      <div class="search-card-side">
        <div class="muted">${optionCount} available option${optionCount === 1 ? "" : "s"}</div>
        <strong>${Number.isFinite(minRoomPrice) ? `From Rs ${formatMoney(minRoomPrice)} / night` : "View availability"}</strong>
        ${result.villaOption?.available ? `<span class="villa-badge">Full villa available</span>` : ""}
        <a class="primary-link" href="${propertyUrl(property.id)}">View rooms</a>
      </div>
    </article>
  `;
}

async function loadHomepage() {
  try {
    const response = await fetch("/api/availability/homepage");
    const data = await response.json();
    if (!response.ok) return;

    const hero = (data.sections || []).find(section => section.id === "hero") || (data.sections || [])[0];
    if (!hero) return;

    if (hero.title) document.querySelector("#heroTitle").textContent = hero.title;
    if (hero.subtitle) document.querySelector("#heroSubtitle").textContent = hero.subtitle;
    if (hero.imageUrl) {
      document.querySelector(".hero").style.backgroundImage =
        `linear-gradient(rgba(20, 32, 51, 0.28), rgba(20, 32, 51, 0.46)), url("${hero.imageUrl}")`;
    }
    if (hero.logoUrl) {
      const logo = document.querySelector("#siteLogo");
      logo.src = hero.logoUrl;
      logo.classList.remove("hidden");
      document.querySelector("#brandMark").classList.add("hidden");
    }
  } catch {
    // The website should still open if homepage settings are not configured yet.
  }
}

function propertyUrl(propertyId) {
  const params = new URLSearchParams(new FormData(form));
  params.set("id", propertyId);
  return `/customer/property.html?${params.toString()}`;
}

function setDefaultDates() {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  form.checkIn.value = dateValue(today);
  form.checkOut.value = dateValue(tomorrow);
}

function dateValue(date) {
  return date.toISOString().slice(0, 10);
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

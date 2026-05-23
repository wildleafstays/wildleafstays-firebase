import { secureFetch } from "../auth.js";
import { setHotelContext, getHotelContext } from "../hotelContext.js";
import { logout } from "../auth.js";

// ===============================
// DASHBOARD STATE KEYS
// ===============================
const DASHBOARD_PAGE_KEY = "dashboard.activePage";
const DASHBOARD_MODE_KEY = "dashboard.mode";

const API = "/api";

// ===============================
// GLOBAL STATE (SINGLE SOURCE OF TRUTH)
// ===============================
let currentMode = "hotel"; // "hotel" | "homepage"

// ===============================
// DOM ELEMENTS (DECLARE ONCE)
// ===============================
const hotelSelect = document.getElementById("hotelSelect");
const hotelNav = document.querySelector(".hotel-nav");
const frame = document.getElementById("dashboardFrame");
const settingsBtn = document.getElementById("btnGlobalSettings");
const logoutBtn = document.getElementById("btnLogout");
const addHotelBtn = document.getElementById("btnAddHotel");


logoutBtn.addEventListener("click", () => {
  const ok = confirm("Are you sure you want to logout?");
  if (!ok) return;

  localStorage.removeItem(DASHBOARD_PAGE_KEY);
  localStorage.removeItem(DASHBOARD_MODE_KEY);

  logout();
});

// ===============================
// ADD HOTEL (NAME ONLY)
// ===============================
addHotelBtn.addEventListener("click", async () => {
  const name = prompt("Enter hotel name");
  if (!name) return;

  const res = await secureFetch(`${API}/hotels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });

  const hotel = await res.json();

  // Set newly created hotel as active
  setHotelContext({ id: hotel.id, name: hotel.name });

  // Reload dashboard so dropdown refreshes cleanly
  window.location.reload();
});



// ===============================
// LOAD HOTELS
// ===============================
async function loadHotelDropdown() {
  const res = await secureFetch(`${API}/hotels`);
  const hotels = await res.json();

  const ctx = getHotelContext();
  hotelSelect.innerHTML = "";

  hotels.forEach(h => {
    const opt = document.createElement("option");
    opt.value = String(h.id);
    opt.textContent = h.name;

    if (ctx && String(ctx.id) === String(h.id)) opt.selected = true;

    hotelSelect.appendChild(opt);

  });
  
 }


// ===============================
// SWITCH HOTEL (SAFE)
// ===============================
hotelSelect.addEventListener("change", () => {
  const id = hotelSelect.value;
  const name = hotelSelect.options[hotelSelect.selectedIndex].text;

  setHotelContext({ id, name });

  if (currentMode === "hotel") {
    showHotelUI();

    const savedPage = localStorage.getItem(DASHBOARD_PAGE_KEY);
    frame.src = savedPage || "calendar/calendar.html";
  }
});


// ===============================
// HOTEL NAVIGATION
// ===============================
document.querySelectorAll(".hotel-nav a").forEach(link => {
  link.addEventListener("click", e => {
    e.preventDefault();

    const page = link.dataset.page;

    currentMode = "hotel";
    showHotelUI();

    localStorage.setItem(DASHBOARD_PAGE_KEY, page);
    localStorage.setItem(DASHBOARD_MODE_KEY, "hotel");

    frame.src = page;
  });


});
// ===============================
// ⚙️ HOMEPAGE SETTINGS
// ===============================
settingsBtn.addEventListener("click", () => {
  currentMode = "homepage";
  hideHotelUI();

  const page = "../homepage/homepage.html";

  localStorage.setItem(DASHBOARD_PAGE_KEY, page);
  localStorage.setItem(DASHBOARD_MODE_KEY, "homepage");

  frame.src = page;
});

// ===============================
// UI VISIBILITY CONTROL
// ===============================
function hideHotelUI() {
  if (hotelSelect) hotelSelect.style.display = "none";
  if (hotelNav) hotelNav.style.display = "none";
}

function showHotelUI() {
  if (hotelSelect) hotelSelect.style.display = "";
  if (hotelNav) hotelNav.style.display = "";
}

// ===============================
// POSTMESSAGE FROM IFRAME
// ===============================
window.addEventListener("message", e => {
  if (e.data === "HIDE_HOTEL_UI") {
    currentMode = "homepage";
    hideHotelUI();
    localStorage.setItem(DASHBOARD_MODE_KEY, "homepage");
  }

  if (e.data === "SHOW_HOTEL_UI") {
    currentMode = "hotel";
    showHotelUI();
    localStorage.setItem(DASHBOARD_MODE_KEY, "hotel");
  }
});





// ===============================
// INIT
// ===============================
document.addEventListener("DOMContentLoaded", async () => {
  await loadHotelDropdown(); // now also enforces hotelContext

  const savedPage = localStorage.getItem(DASHBOARD_PAGE_KEY);
  const savedMode = localStorage.getItem(DASHBOARD_MODE_KEY) || "hotel";

  currentMode = savedMode;

  if (savedMode === "homepage") {
    hideHotelUI();
    frame.src = savedPage || "../homepage/homepage.html";
  } else {
    showHotelUI();
    frame.src = savedPage || "calendar/calendar.html";
  }
});



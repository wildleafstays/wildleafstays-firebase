import { authHeaders } from "../../auth.js";
import { getHotelContext } from "../../hotelContext.js";

authHeaders();

// ===============================
// GLOBALS & HELPERS
// ===============================
const API_BASE = "";

let currentStartDate = null;
let currentEndDate = null;

function fmt(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}


function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/* ✅ ADD THIS RIGHT HERE */
function normalizeDate(d) {
  if (!d) return d;
  if (d.includes("/")) {
    const [mm, dd, yyyy] = d.split("/");
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return d;
}

// ===============================
// Remember Selected Hotel
// ===============================

function getActiveHotelId() {
  const ctx = getHotelContext();

  // ✅ Preferred: hotel selected from admin
  if (ctx && ctx.id) {
    return ctx.id;
  }

  // 🔁 Fallback: manual dropdown (old behavior)
  const select = document.getElementById("hotelSelect");
  return select ? select.value : null;
}

// ===============================
// LOAD HOTELS
// ===============================
async function loadHotels() {
  const res = await fetch(`${API_BASE}/api/hotels`);
  const hotels = await res.json();

  const hotelSelect = document.getElementById("hotelSelect");
  hotelSelect.innerHTML = "";

  hotels.forEach((h) => {
    const op = document.createElement("option");
    op.value = h.id;
    op.textContent = h.name;
    hotelSelect.appendChild(op);
  });
}

// ===============================
// LOAD INVENTORY
// ===============================
async function loadInventory() {
  const hotelId = getActiveHotelId();

  let start = document.getElementById("startDate").value;
  let end = document.getElementById("endDate").value;

  if (!hotelId || !start || !end) return;

  // Validate date range
  if (new Date(start) > new Date(end)) {
    end = start;
    document.getElementById("endDate").value = end;
  }

  currentStartDate = new Date(start);
  currentEndDate = new Date(end);

  const res = await fetch(
    `${API_BASE}/api/inventory?hotelId=${encodeURIComponent(
      hotelId
    )}&start=${start}&end=${end}`
  );

  const data = await res.json();
renderCalendar(data.inventory, start, end);

}

// ===============================
// RENDER CALENDAR TABLE
// ===============================
function renderCalendar(rows, start, end) {
  const tbody = document.getElementById("inventoryTable");
  tbody.innerHTML = "";

  const startDate = new Date(start);
  const endDate = new Date(end);

  // Group data by room_category_id
  const categories = {};

  rows.forEach((row) => {
    const catId = row.room_category_id;
    if (!categories[catId]) {
      categories[catId] = {
  name: row.category,
  max: row.max_rooms,
  dates: {},
  villa: {},  // ✅ REQUIRED
  rates: {}   // ✅ ADD THIS
};

    }

    if (row.date) {
      const dateStr = String(row.date).slice(0, 10);

      // FIX: Always convert DB value to number
      let stored = row.available_rooms;
      let numeric = stored !== null && stored !== undefined ? Number(stored) : NaN;

      categories[catId].dates[dateStr] = !isNaN(numeric)
  ? numeric
  : null;
//✅added for dynamic pricing
categories[catId].rates[dateStr] =
  row.rate !== null && row.rate !== undefined
    ? Number(row.rate)
    : null;

// 👇 STORE VILLA FLAG
categories[catId].villa[dateStr] = Number(row.villa_booked) === 1;

    }
  });

  // HEADER ROW
  let html = "<tr><th>Room Category</th>";
  for (let d = new Date(startDate); d <= endDate; d = addDays(d, 1)) {
    html += `<th>${fmt(d)}</th>`;
  }
  html += "</tr>";

  // ROWS
  Object.keys(categories).map(Number).forEach((catId) => {

    const cat = categories[catId];
    html += `<tr><td class="room-name"><b>${cat.name}</b></td>`;

    for (let d = new Date(startDate); d <= endDate; d = addDays(d, 1)) {
      const dayStr = fmt(d);

      let storedVal = cat.dates[dayStr];

      // FINAL FIX:
      // If DB has a value → use it (even if it's "2")
      // If no DB record → use max_rooms
      
const isVillaBooked = cat.villa[dayStr] === true;

let val;

if (isVillaBooked) {
  val = 0;
} else {
  val =
    storedVal !== null && storedVal !== undefined
      ? Number(storedVal)
      : Number(cat.max || 0);
}

const safeDisplay = isNaN(val) ? 0 : val;

const disabled = isVillaBooked ? "disabled" : "";
const soldClass = isVillaBooked ? "sold" : "";

html += `
  <td>
    <div class="inv-box ${soldClass}"
         data-cat="${catId}"
         data-date="${dayStr}"
         data-max="${cat.max}">
      <button class="minus-btn" ${disabled} onclick="handleInvClick(this, 'minus')">-</button>

     
<span class="inv-value">${safeDisplay}</span>
<input 
  type="number"
  class="rate-input"
  placeholder="₹"
  value="${cat.rates[dayStr] ?? ""}"
  onchange="handleRateChange(this)"
/>

      <button class="plus-btn" ${disabled} onclick="handleInvClick(this, 'plus')">+</button>
      ${isVillaBooked ? `<div class="villa-lock">Villa Booked</div>` : ``}
    </div>
  </td>`;

    }

    html += "</tr>";
  });

  tbody.innerHTML = html;
}

// ===============================
// UPDATE INVENTORY (Manual +/-)
// ===============================
async function updateInv(roomCategoryId, date, newValue, maxRooms) {
  const hotelId = getActiveHotelId();

  if (!hotelId) return;

  const safe = Math.min(Math.max(Number(newValue), 0), Number(maxRooms));

  const res = await fetch(`${API_BASE}/api/inventory/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hotelId,
      roomCategoryId,
      date,
      availableRooms: safe
    })
  });

  await res.json();
  await loadInventory(); // reload updated values
}

// ===============================
// BUTTON HANDLER
// ===============================
async function handleInvClick(btn, action) {
  const box = btn.closest(".inv-box");

  const catId = Number(box.dataset.cat);
  const date = normalizeDate(box.dataset.date);

  const maxRooms = Number(box.dataset.max);

  const valueSpan = box.querySelector(".inv-value");
  const current = Number(valueSpan.textContent);

  let updated = current;
  if (action === "minus") updated--;
  if (action === "plus") updated++;

  updated = Math.min(Math.max(updated, 0), maxRooms);

  await updateInv(catId, date, updated, maxRooms);
}

window.handleInvClick = handleInvClick;

// ===============================
// 🔴Added for dynamic pricing
// ===============================
async function handleRateChange(input) {
  const box = input.closest(".inv-box");

  const hotelId = getActiveHotelId();

  const roomCategoryId = Number(box.dataset.cat);
  const date = normalizeDate(box.dataset.date);


  // ---------- RATE ONLY ----------
  const rateRaw = input.value.trim();
  const rate = rateRaw === "" ? null : Number(rateRaw);

  if (rate !== null && isNaN(rate)) {
    alert("Invalid rate");
    return;
  }

  // 🚫 DO NOT SEND availableRooms HERE
  await fetch(`${API_BASE}/api/inventory/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hotelId,
      roomCategoryId,
      date,
      rate
    })
  });

  await loadInventory();
}

window.handleRateChange = handleRateChange;


// ===============================
// DATE RANGE CONTROLS
// ===============================
function setDefaultRange() {
  const today = new Date();
  currentStartDate = today;
  currentEndDate = addDays(today, 7);

  document.getElementById("startDate").value = fmt(currentStartDate);
  document.getElementById("endDate").value = fmt(currentEndDate);
}

function initNavButtons() {
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const todayBtn = document.getElementById("todayBtn");
  const loadBtn = document.getElementById("loadBtn");

  prevBtn.addEventListener("click", async () => {
    currentStartDate = addDays(currentStartDate, -8);
    currentEndDate = addDays(currentEndDate, -8);
    document.getElementById("startDate").value = fmt(currentStartDate);
    document.getElementById("endDate").value = fmt(currentEndDate);
    await loadInventory();
  });

  nextBtn.addEventListener("click", async () => {
    currentStartDate = addDays(currentStartDate, 8);
    currentEndDate = addDays(currentEndDate, 8);
    document.getElementById("startDate").value = fmt(currentStartDate);
    document.getElementById("endDate").value = fmt(currentEndDate);
    await loadInventory();
  });

  todayBtn.addEventListener("click", async () => {
    setDefaultRange();
    await loadInventory();
  });

  loadBtn.addEventListener("click", async () => {
    await loadInventory();
  });
}

// ===============================
// INIT
// ===============================
document.addEventListener("DOMContentLoaded", async () => {
  await loadHotels();

  const ctx = getHotelContext();
  const hotelSelect = document.getElementById("hotelSelect");
  const note = document.getElementById("hotelLockedNote");

  if (ctx && ctx.id && hotelSelect) {
    hotelSelect.value = ctx.id;
    hotelSelect.disabled = true; // 🔒 lock hotel

    // ✅ SHOW NOTE ONLY WHEN HOTEL IS LOCKED
    if (note) {
      note.style.display = "block";
    }
  }

  setDefaultRange();
  initNavButtons();
  await loadInventory();
});


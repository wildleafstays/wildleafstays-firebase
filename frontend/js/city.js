/* =====================================================
   URL PARAMS (SINGLE SOURCE OF TRUTH)
===================================================== */
const urlParams = new URLSearchParams(window.location.search);

const city = urlParams.get("city");

// 🔒 normalize param names (EXACTLY like hotel.js)
let checkIn =
  urlParams.get("checkIn") ||
  urlParams.get("checkin");

let checkOut =
  urlParams.get("checkOut") ||
  urlParams.get("checkout");

let adults = Number(urlParams.get("adults") || 1);
let kids   = Number(urlParams.get("kids") || 0);


if (!city) {
  document.body.innerHTML = "<h2>No city provided</h2>";
  throw new Error("Missing ?city parameter");
}

document.getElementById("cityTitle").innerText = city;

// ================================
// BUILD ADULTS & KIDS DROPDOWNS
// ================================
const adultsSelect = document.getElementById("adults");
const kidsSelect = document.getElementById("kids");

// Adults: 1–20
if (adultsSelect) {
  adultsSelect.innerHTML = "";
  for (let i = 1; i <= 20; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${i} Adult${i > 1 ? "s" : ""}`;
    adultsSelect.appendChild(opt);
  }
}

// Kids: 0–10
if (kidsSelect) {
  kidsSelect.innerHTML = "";
  for (let i = 0; i <= 10; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${i} Kid${i !== 1 ? "s" : ""}`;
    kidsSelect.appendChild(opt);
  }
}

// ================================
// PREFILL FROM URL PARAMS
// ================================
if (adultsSelect) adultsSelect.value = adults;
if (kidsSelect) kidsSelect.value = kids;



/* =====================================================
   LOAD HOTELS
===================================================== */
fetch(`/api/hotels?city=${encodeURIComponent(city)}`)
  .then(res => res.json())
  .then(hotels => {
    const list = document.getElementById("hotelList");
    list.innerHTML = "";

    hotels.forEach(hotel => {
      list.insertAdjacentHTML("beforeend", `
        <div class="hotel-card">

          <div class="hotel-card-image">
            <img src="${hotel.main_image}" alt="${hotel.name}">
          </div>

          <div class="hotel-card-summary">
            <h2>${hotel.name}</h2>
            <p>${city}</p>
            <div class="hotel-highlights">
              <span>Couple Friendly</span>
              <span>Free Cancellation</span>
            </div>
          </div>

          <div class="hotel-card-availability" id="avail-${hotel.id}">
            <div class="availability-loading">Checking availability…</div>
          </div>

        </div>
      `);

      loadHotelAvailabilityPreview(hotel.id);
    });
  });


/* =====================================================
   AVAILABILITY PREVIEW (PER HOTEL)
===================================================== */
async function loadHotelAvailabilityPreview(hotelId) {
  const box = document.getElementById(`avail-${hotelId}`);

  try {
    const res = await fetch(
      `/api/inventory` +
      `?hotelId=${hotelId}&start=${checkIn}&end=${checkOut}`
    );

    const data = await res.json();

    console.log("Inventory for hotel", hotelId, data.inventory);

    if (!data.inventory || !data.inventory.length) {
      box.innerHTML = soldOutHTML(hotelId);
      return;
    }

    const map = buildAvailabilityMap(data.inventory);
    const rows = Object.values(map);

    box.innerHTML = `
      <div class="avail-box">
        ${rows.slice(0,3).map(r => `
          <div class="avail-row ${r.minAvailable === 0 ? "sold" : ""}">
            <span>${r.category}</span>
            <strong>${r.minAvailable > 0 ? `${r.minAvailable} rooms` : "Sold Out"}</strong>
          </div>
        `).join("")}
        <button class="check-btn" onclick="openHotel(${hotelId})">
          Check Property
        </button>
      </div>
    `;

  } catch (err) {
    console.error("Availability failed for hotel", hotelId, err);
    box.innerHTML = `<div class="avail-error">Unavailable</div>`;
  }
}

// ================================
// CITY DATE PICKER (SAME AS INDEX)
// ================================
const cityLabel = document.getElementById("cityLabel");
cityLabel.textContent = city;

if (adultsSelect) adultsSelect.value = adults;
if (kidsSelect) kidsSelect.value = kids;

let selectedCheckIn = checkIn;
let selectedCheckOut = checkOut;

// 🔒 Auto-fill dates if missing (same logic as hotel.js)
function formatDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

if (!selectedCheckIn || !selectedCheckOut) {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  selectedCheckIn = formatDateInput(today);
  selectedCheckOut = formatDateInput(tomorrow);
}

flatpickr("#dateRange", {
  mode: "range",
  dateFormat: "d/m/Y",
  minDate: "today",
  allowInput: false,

  onClose(selectedDates) {
    if (selectedDates.length === 2) {
      const [start, end] = selectedDates;

      selectedCheckIn = toYMD(start);
      selectedCheckOut = toYMD(end);
    }
  }
});

// Restore selected dates
const fp = document.querySelector("#dateRange")._flatpickr;
if (fp && selectedCheckIn && selectedCheckOut) {
  const [y1, m1, d1] = selectedCheckIn.split("-");
  const [y2, m2, d2] = selectedCheckOut.split("-");

  fp.setDate(
    [
      new Date(y1, m1 - 1, d1),
      new Date(y2, m2 - 1, d2)
    ],
    true
  );
}

function toYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

document.getElementById("searchButton").addEventListener("click", () => {
  if (!selectedCheckIn || !selectedCheckOut) {
    alert("Please select check-in and check-out dates");
    return;
  }

  const adultsVal = Number(adultsSelect.value);
  const kidsVal   = Number(kidsSelect.value);

  const params = new URLSearchParams();
  params.set("city", city);
  params.set("checkIn", selectedCheckIn);
  params.set("checkOut", selectedCheckOut);
  params.set("adults", adultsVal);
  params.set("kids", kidsVal);

  window.location.href = "city.html?" + params.toString();
});



/* =====================================================
   HELPERS
===================================================== */
function buildAvailabilityMap(data) {
  const map = {};
  let villaBlocked = false;

  data.forEach(row => {
    // 🔴 CRITICAL: detect villa booking
    if (row.villa_booked === 1) {
      villaBlocked = true;
    }

    const id = row.room_category_id;

    if (!map[id]) {
      map[id] = {
        category:
          row.category ||
          row.room_category ||
          row.category_name ||
          "Room",
        minAvailable: row.max_rooms
      };
    }

    if (row.available_rooms != null) {
      map[id].minAvailable = Math.min(
        map[id].minAvailable,
        Number(row.available_rooms)
      );
    }
  });

  // 🔴 If villa is booked → everything is SOLD OUT
  if (villaBlocked) {
    Object.values(map).forEach(v => {
      v.minAvailable = 0;
    });
  }

  return map;
}



function soldOutHTML(hotelId) {
  return `
    <div class="avail-box sold">
      <div class="sold-text">Sold out for selected dates</div>
      <button class="check-btn" onclick="openHotel(${hotelId})">
        Check Property
      </button>
    </div>
  `;
}


function openHotel(hotelId) {
  const adultsVal = Number(adultsSelect.value);
  const kidsVal   = Number(kidsSelect.value);

  window.location.href =
    `hotel.html?id=${hotelId}` +
    `&checkIn=${selectedCheckIn}` +
    `&checkOut=${selectedCheckOut}` +
    `&adults=${adultsVal}` +
    `&kids=${kidsVal}`;
}


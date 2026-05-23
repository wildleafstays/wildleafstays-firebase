/* ============================================================
   GLOBAL CONFIG
============================================================ */
const API_BASE = "/api";
const IMAGE_BASE = "";

const params = new URLSearchParams(window.location.search);

// Clean hotelId
let rawHotelId = params.get("id") || "";
rawHotelId = rawHotelId.split("&")[0].trim();
const hotelId = Number(rawHotelId);

// Extract params
let checkIn = params.get("checkIn");
let checkOut = params.get("checkOut");
let adults = params.get("adults") || 1;
let kids = params.get("kids") || 0;
// ✅ GLOBAL inventory + pricing map
let availabilityMap = {};




/* ============================================================
   AUTO-PREFILL DATES IF NOT PROVIDED
============================================================ */
function formatDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

if (!checkIn || !checkOut) {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  checkIn = formatDateInput(today);
  checkOut = formatDateInput(tomorrow);
}



/* ============================================================
   ON PAGE LOAD
============================================================ */
document.addEventListener("DOMContentLoaded", () => {

  if (!hotelId) {
    document.body.innerHTML = "<h2>Invalid hotel selection.</h2>";
    return;
  }

// ============================
// HOTEL PAGE ADULTS & KIDS DROPDOWN
// ============================
const hAdults = document.getElementById("hAdults");
const hKids = document.getElementById("hKids");

if (hAdults && hKids) {

  // Adults: up to 20
  for (let i = 1; i <= 20; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${i} Adult${i > 1 ? "s" : ""}`;
    hAdults.appendChild(opt);
  }

  // Kids: up to 10
  for (let i = 0; i <= 10; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${i} Kid${i !== 1 ? "s" : ""}`;
    hKids.appendChild(opt);
  }
}

  prefillInputs();
  initDateRangePicker();
  
  loadHotelDetails();
});

function prefillInputs() {
  
  const hAdults = document.getElementById("hAdults");
  const hKids = document.getElementById("hKids");

  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  const checkInParam = params.get("checkIn");
  const checkOutParam = params.get("checkOut");
  const adultsParam = params.get("adults");
  const kidsParam = params.get("kids");

  if (checkInParam && checkOutParam) {
    

    checkIn = checkInParam;
    checkOut = checkOutParam;
  } else {
    const defIn = formatDateInput(today);
    const defOut = formatDateInput(tomorrow);

    

    checkIn = defIn;
    checkOut = defOut;
  }

  if (adultsParam) {
    adults = adultsParam;
    hAdults.value = adultsParam;
  }

  if (kidsParam) {
    kids = kidsParam;
    hKids.value = kidsParam;
  }
}

/* ============================================================
   🟢DateRangePicker
============================================================ */
function initDateRangePicker() {
  flatpickr("#dateRange", {
    mode: "range",
    dateFormat: "d/m/Y",
    minDate: "today",
    allowInput: false,

    onClose(selectedDates) {
      if (selectedDates.length === 2) {
        const [start, end] = selectedDates;
        checkIn = toYMD(start);
        checkOut = toYMD(end);
      }
    }
  });

  // 🔁 Restore dates on Modify Selection
  if (checkIn && checkOut) {
    const [y1, m1, d1] = checkIn.split("-");
    const [y2, m2, d2] = checkOut.split("-");

    const fp = document.querySelector("#dateRange")._flatpickr;
    if (fp) {
      fp.setDate(
        [new Date(y1, m1 - 1, d1), new Date(y2, m2 - 1, d2)],
        true

      );

    }
  }
}

function toYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}



/* ============================================================
   LOAD HOTEL DETAILS
============================================================ */
async function loadHotelDetails() {
  try {
    const url = `${API_BASE}/hotels/${hotelId}`;
    const res = await fetch(url);
    const text = await res.text();

    if (text.startsWith("<!DOCTYPE")) {
      alert("Could not load hotel data.");
      return;
    }

    const hotel = JSON.parse(text);
    console.log("HOTEL DATA:", hotel);

    // Render top gallery
    renderHeroGallery(hotel.images || []);
    setupViewPhotos();

    // If FULL VILLA → switch to villa mode
    if (hotel.is_full_villa === 1 || hotel.is_full_villa === true) {
      activateVillaMode(hotel);
      return;
    }

    // Otherwise → Normal hotel page
    renderTabsContent(hotel);
    loadInventoryAndRooms(hotel.rooms || []);
    
  } catch (err) {
    console.error("Hotel load failed:", err);
    alert("Error loading hotel details.");
  }



}

/* ============================================================
   NEW — Validate whether guests can stay in this room
============================================================ */
function canRoomFit(room, adults, kids) {

  const maxGuests = Number(room.max_guests);
  const baseAdults = Number(room.base_included_adults || 2);
  const maxAdults = Number(room.max_adults);
  const maxKids = Number(room.max_kids);
  const chargeableAge = Number(room.kid_chargeable_age || 5);

  const numKidsChargeable = kids; // You are not collecting ages, so ALL kids are chargeable
  const totalGuests = adults + numKidsChargeable;

  // Check total guest limit
  if (totalGuests > maxGuests) {
    return { ok: false, reason: `Guests exceed max capacity (${maxGuests})` };
  }

  // Check adult limit
  if (adults > maxAdults) {
    return { ok: false, reason: `Too many adults — max allowed is ${maxAdults}` };
  }

  // Check kids limit
  if (kids > maxKids) {
    return { ok: false, reason: `Too many kids — max allowed is ${maxKids}` };
  }

  return { ok: true };
}

/* ============================================================
   NEW — Calculate final price including extra persons
============================================================ */
// ✅ changed to implement dynamic pricing
  function calculateRoomPrice(
  room,
  nights,
  qty,
  adults,
  kids,
  rateOverride = null) {

  const effectiveBase =
  rateOverride !== null ? rateOverride : room.price;

const basePrice = calculatePriceWithGST(effectiveBase, room.gst);


  const baseOccupancy = Number(room.base_included_adults || 2);
  const extraAdultPrice = Number(room.extra_adult_price || 0);
  const extraKidPrice = Number(room.extra_kid_price || 0);

  const totalGuests = adults + kids;

  // ✅ Guests exceeding base occupancy
  const extraGuests = Math.max(0, totalGuests - baseOccupancy);

  // ✅ Allocate extra guests: adults first, then kids
  const extraAdults = Math.min(extraGuests, Math.max(0, adults - baseOccupancy));
  const remainingExtraGuests = extraGuests - extraAdults;
  const extraKids = Math.max(0, remainingExtraGuests);

  const extraCost =
    (extraAdults * extraAdultPrice +
     extraKids * extraKidPrice) * nights * qty;

  const roomCost = basePrice * nights * qty;

  return roomCost + extraCost;
}


/* ============================================================
   HERO GALLERY
============================================================ */
function renderHeroGallery(images) {
  const grid = document.getElementById("masonryGrid");
  grid.innerHTML = "";

  if (!images || images.length === 0) {
    grid.innerHTML = "<p>No images available</p>";
    return;
  }

  images.slice(0, 5).forEach(img => {
    const tag = document.createElement("img");
    tag.src = `${IMAGE_BASE}${img.image_url}`;
    tag.onclick = openHotelGallery;
    grid.appendChild(tag);
  });
}

function setupViewPhotos() {
  document.getElementById("viewPhotosBtn").onclick = openHotelGallery;
}

function openHotelGallery() {
  window.location.href = `gallery.html?hotelId=${hotelId}`;
}



/* ============================================================
   NORMAL HOTEL MODE — TAB CONTENT
============================================================ */
function renderTabsContent(hotel) {

    // Overview
    document.getElementById("hotelName").textContent = hotel.name;
    document.getElementById("hotelDescription").textContent = hotel.description;
    document.getElementById("hotelCheckIn").textContent = hotel.check_in_time || "—";
    document.getElementById("hotelCheckOut").textContent = hotel.check_out_time || "—";
    document.getElementById("hotelAddress").textContent = hotel.address;
    document.getElementById("refundPolicy").textContent = hotel.refund_policy || "";

    // Nearby Attractions (JSON array)
    const att = document.getElementById("attractionsList");
    att.innerHTML = "";
    if (Array.isArray(hotel.nearby_attractions)) {
        hotel.nearby_attractions.forEach(a => {
            const li = document.createElement("li");
            li.textContent = a;
            att.appendChild(li);
        });
    }

    // ICON GRID RENDERING
    renderIconGrid("amenitiesGrid", hotel, [
      "kitchen_available", "restaurant_available", "room_service",
      "inhouse_chef", "cafe_available", "outdoor_dining", "bbq_available",
      "breakfast_included"
    ]);

    renderIconGrid("viewsGrid", hotel, [
      "lawn_garden", "terrace", "private_villa_mode",
      "mountain_view", "valley_view", "forest_view",
      "outdoor_seating", "bonfire_area", "swimming_pool", "kids_play_area"
    ]);

    renderIconGrid("parkingGrid", hotel, [
      "parking_available", "covered_parking", "valet_service",
      "ev_charging", "taxi_on_call"
    ]);

    renderIconGrid("powerGrid", hotel, [
      "power_backup", "hot_water", "solar_water_heating",
      "heating_available", "water_purifier"
    ]);

    renderIconGrid("foodGrid", hotel, [
      "kitchen_available", "restaurant_available",
      "room_service", "breakfast_included"
    ]);

    renderIconGrid("safetyGrid", hotel, [
      "cctv", "fire_extinguishers", "first_aid",
      "security_guard", "emergency_exit"
    ]);

    renderIconGrid("rulesGrid", hotel, [
      "rule_smoking", "rule_pets", "rule_parties", "loud_music_allowed"
    ]);

    renderIconGrid("accessGrid", hotel, [
      "wheelchair_room", "wheelchair_entrance", "elevator"
    ]);
}


function renderFacilities(fac) {
  const list = document.getElementById("facilitiesList");
  list.innerHTML = "";

  let items = [];

  if (Array.isArray(fac)) items = fac;
  else if (typeof fac === "string" && fac.trim()) items = fac.split(",");

  items.forEach(f => {
    const li = document.createElement("li");
    li.textContent = f.trim();
    list.appendChild(li);
  });
}



/* ============================================================
   ***** VILLA MODE LOGIC *****
============================================================ */
function activateVillaMode(hotel) {

  // Hide hotel-only sections
  document.querySelector(".tabs-section").classList.add("hidden");
  document.querySelector(".rooms-section").classList.add("hidden");
  document.getElementById("grandTotalBar").classList.add("hidden");

  // Show Villa Section
  const villaSec = document.getElementById("villaModeSection");
  villaSec.classList.remove("hidden");

  // Fill villa content
  document.getElementById("villaName").textContent = hotel.name;
  document.getElementById("villaTagline").textContent = hotel.villa_tagline || "Entire Villa";


  let totalRooms = 0;
let villaBaseGuests = 0;
let villaMaxGuests = 0;
let villaBasePrice = 0;

let extraAdultPrice = 0;
let extraKidPrice = 0;

hotel.rooms.forEach(cat => {
  const roomsCount = Number(cat.max_rooms || 1);

  totalRooms += roomsCount;

  villaBaseGuests += (Number(cat.base_included_adults || 2) * roomsCount);
  villaMaxGuests += (Number(cat.max_guests || 2) * roomsCount);

  villaBasePrice += (Number(cat.price || 0) * roomsCount);

  // keep last non-zero (simple & safe)
  if (cat.extra_adult_price) extraAdultPrice = Number(cat.extra_adult_price);
  if (cat.extra_kid_price) extraKidPrice = Number(cat.extra_kid_price);
});



  // Full Villa Summary
  document.getElementById("villaTotalRooms").textContent = totalRooms;
  document.getElementById("villaTotalGuests").textContent =
  `${villaBaseGuests} Guests (Max ${villaMaxGuests})`;

  document.getElementById("villaArchitecture").textContent = hotel.architecture || "-";
  document.getElementById("villaView").textContent = hotel.view_type || "-";

  document.getElementById("villaPrice").textContent =
  `₹${villaBasePrice.toLocaleString()} for ${villaBaseGuests} Guests`;

  document.getElementById("villaDescription").textContent = hotel.description;

  // Amenities
  const amenList = document.getElementById("villaAmenitiesList");
  amenList.innerHTML = "";
  let amenities = [];

  if (Array.isArray(hotel.facilities)) amenities = hotel.facilities;
  else if (hotel.facilities) amenities = hotel.facilities.split(",");

  amenities.forEach(a => {
    const div = document.createElement("div");
    div.textContent = a.trim();
    amenList.appendChild(div);
  });

  // Policies
  document.getElementById("villaRefundPolicy").textContent = hotel.refund_policy || "";
  document.getElementById("villaAttractions").textContent = hotel.highlights || "";
  document.getElementById("villaFood").textContent = hotel.food || "";

 
}

/* ============================================================
   HOTEL MODE — INVENTORY
============================================================ */
async function loadInventoryAndRooms(roomList) {

  if (checkIn && checkOut) {
    const url =
      `${API_BASE}/inventory?hotelId=${hotelId}` +
      `&start=${checkIn}&end=${checkOut}`;

    const res = await fetch(url);
    const data = await res.json();
availabilityMap = buildAvailabilityMap(data.inventory);

  }

  renderRoomCards(roomList, availabilityMap);
}


//✅ This part is updated for dynamic rates update
function buildAvailabilityMap(data) {
  const map = {};
  let villaBlocked = false;

  data.forEach(row => {
    if (row.villa_booked === 1) {
      villaBlocked = true;
    }

    const id = row.room_category_id;

    if (!map[id]) {
      map[id] = {
        max: row.max_rooms,
        minAvailable: row.max_rooms,
        rates: []
      };
    }

    // availability
    if (row.available_rooms != null) {
      const avail = Number(row.available_rooms);
      map[id].minAvailable = Math.min(map[id].minAvailable, avail);
    }

    // ✅ dynamic rate (per day)
    const effectiveRate =
      row.rate !== null && row.rate !== undefined
        ? Number(row.rate)
        : Number(row.base_price);

    if (!isNaN(effectiveRate)) {
      map[id].rates.push(effectiveRate);
    }
  });

  if (villaBlocked) {
    Object.values(map).forEach(v => v.minAvailable = 0);
  }

  return map;
}






/* ============================================================
   HOTEL MODE — ROOM CARDS
============================================================ */
function renderRoomCards(rooms, availabilityMap) {
  window.allRooms = rooms;
  const container = document.getElementById("roomCategories");
  container.innerHTML = "";

  if (!rooms || rooms.length === 0) {
    container.innerHTML = "<p>No room categories found.</p>";
    return;
  }

  rooms.forEach(room => {
    const avail = availabilityMap[room.id]
      ? availabilityMap[room.id].minAvailable
      : room.max_rooms;

    const rates =
  availabilityMap?.[room.id]?.rates?.length
    ? availabilityMap[room.id].rates
    : [room.price];

const avgRate = Math.round(
  rates.reduce((a, b) => a + b, 0) / rates.length
);

const finalPrice = avgRate;




    const mainImage = room.main_image
      ? IMAGE_BASE + room.main_image
      : "https://via.placeholder.com/550x350?text=No+Image";

    const card = document.createElement("div");
    card.className = "room-card compact";
// ✅ ADD THIS LINE (THIS IS THE ONLY PLACE)
card.dataset.roomId = room.id;


    card.innerHTML = `
      <div class="room-card-img" onclick="openRoomGallery(${room.id})">
        <img src="${mainImage}" alt="${room.category}">
      </div>

      <div class="room-card-body">
        <h3>${room.category}</h3>

        <div class="occupancy-highlight">
  <span class="occupancy-icon">👥</span>
  <div class="occupancy-text">
    <strong>Max Occupancy: ${room.max_guests}</strong>
    <small>(Includes adults + kids above 5 years)</small>
  </div>
</div>


        <div class="room-price">
          From ₹${finalPrice}
        </div>

        <div class="availability">
          ${
            avail > 0
              ? `${avail} Rooms Left`
              : "<span class='sold-out'>Sold Out</span>"
          }
        </div>

        <div class="room-picker">
          <span class="picker-label">Add Rooms</span>
          <button class="qty-btn minus">−</button>
          <span class="room-qty">0</span>
          <button class="qty-btn plus">+</button>
        </div>

        <div class="inline-room-selector"></div>
      </div>
    `;

    const plusBtn = card.querySelector(".plus");
    const minusBtn = card.querySelector(".minus");
    const qtyEl = card.querySelector(".room-qty");
    const selectorBox = card.querySelector(".inline-room-selector");

    let roomCount = 0;
    const baseAdults = Number(room.base_included_adults || 2);

    plusBtn.onclick = () => {
      if (roomCount >= avail) return;

      roomCount++;
      qtyEl.textContent = roomCount;

      const row = createRoomOccupancyRow(room, roomCount);

      row.dataset.roomId = room.id;   // ✅ ADD THIS LINE

      // ✅ Prefill
      row.querySelector(".adults").value = baseAdults;
      row.querySelector(".kids").value = 0;

      selectorBox.appendChild(row);

      updateCustomTotal();
      updateRemainingGuests();
      updatePlanSummary();
    };

    minusBtn.onclick = () => {
      if (roomCount <= 0) return;

      roomCount--;
      qtyEl.textContent = roomCount;

      selectorBox.lastElementChild?.remove();

      updateCustomTotal();
      updateRemainingGuests();
      updatePlanSummary();
    };

    container.appendChild(card);
  });

// ✅ Restore selection AFTER cards are rendered
if (params.get("restore") === "1") {
  const waitForCards = setInterval(() => {
    if (document.querySelector(".room-card")) {
      clearInterval(waitForCards);
      restorePreviousSelection();
    }
  }, 50);
}


}

/* ============================================================
   RESTORE PREVIOUS SELECTION (Modify Booking)
============================================================ */
function restorePreviousSelection() {
  const raw = sessionStorage.getItem("pendingBooking");
  if (!raw) return;

  const booking = JSON.parse(raw);
  if (!booking.rooms || !booking.rooms.length) return;

  console.log("♻️ Restoring previous selection", booking.rooms);

  booking.rooms.forEach(sel => {
    const card = document.querySelector(
      `.room-card[data-room-id="${sel.roomId}"]`
    );

    if (!card) return;

    const plusBtn = card.querySelector(".plus");
    const selectorBox = card.querySelector(".inline-room-selector");

    // Add room rows
    plusBtn.click();

    const rows = selectorBox.querySelectorAll(".room-occupancy-row");
    const row = rows[rows.length - 1];

    if (!row) return;

    // Restore adults & kids
    row.querySelector(".adults").value = sel.adults;
    row.querySelector(".kids").value = sel.kids;
  });

  // Final recalculation
  updateCustomTotal();
  updateRemainingGuests();
  updatePlanSummary();
}


/* ============================================================
   Open Custom Stay
============================================================ */
function openCustomStay() {
  const modal = document.getElementById("customStayModal");

  if (!modal) {
    console.error("Custom stay modal not found");
    return;
  }

  //  CRITICAL GUARD
  if (!window.allRooms || !Array.isArray(window.allRooms)) {
    alert("Room data is still loading. Please try again in a moment.");
    return;
  }

  const csCheckIn = document.getElementById("csCheckIn");
  const csCheckOut = document.getElementById("csCheckOut");
  const csAdults = document.getElementById("csAdults");
  const csKids = document.getElementById("csKids");

  if (csCheckIn) csCheckIn.value = checkIn;
  if (csCheckOut) csCheckOut.value = checkOut;
  if (csAdults) csAdults.value = adults;
  if (csKids) csKids.value = kids;

  window.customSelection = [];

  buildCustomStayUI();
  updateRemainingGuests();

  modal.classList.remove("hidden");
}


/* ============================================================
   Close Custom Stay
============================================================ */

function closeCustomStay() {
  document.getElementById("customStayModal").classList.add("hidden");
}



/* ============================================================
   Enforce Occupancy
============================================================ */

function enforceOccupancy(row) {
  const maxGuests = Number(row.dataset.maxGuests);

  const adultsSel = row.querySelector('[data-type="adults"]');
  const kidsSel = row.querySelector('[data-type="kids"]');

  let adults = Number(adultsSel.value);
  let kids = Number(kidsSel.value);

  // If total exceeds max, auto-fix
  if (adults + kids > maxGuests) {
    if (adults > kids) {
      kids = Math.max(0, maxGuests - adults);
      kidsSel.value = kids;
    } else {
      adults = Math.max(0, maxGuests - kids);
      adultsSel.value = adults;
    }
  }

  // Disable invalid options dynamically
  [...kidsSel.options].forEach(opt => {
    opt.disabled = Number(opt.value) + adults > maxGuests;
  });

  [...adultsSel.options].forEach(opt => {
    opt.disabled = Number(opt.value) + kids > maxGuests;
  });
}

function updateRemainingGuests() {
  let usedAdults = 0;
  let usedKids = 0;

  window.customSelection.forEach(s => {
    usedAdults += s.adults;
    usedKids += s.kids;
  });

  const remAdults = adults - usedAdults;
  const remKids = kids - usedKids;

  const el = document.getElementById("remainingGuests");

  if (remAdults === 0 && remKids === 0) {
    el.innerHTML = "🟢 All guests accommodated";
  } else {
    el.innerHTML = `
  ⏳ Remaining:
  <strong>${Math.max(0, remAdults)}</strong> Adults,
  <strong>${Math.max(0, remKids)}</strong> Kids
`;
  }
}

function applyCustomSearch() {
  window.location.href =
    `hotel.html?id=${hotelId}` +
    `&checkIn=${checkIn}` +
    `&checkOut=${checkOut}` +
    `&adults=${adults}` +
    `&kids=${kids}`;
}



/* ============================================================
   Update Custom Total — SINGLE SOURCE OF TRUTH
============================================================ */
function updateCustomTotal() {
  let totalBase = 0;
  let totalGST = 0;
  let grandTotal = 0;

  window.customSelection = [];

  const nights = calcNights(checkIn, checkOut);

  document
    .querySelectorAll(".inline-room-selector .room-occupancy-row")
    .forEach(row => {
      const roomId = Number(row.dataset.roomId);
      const room = window.allRooms.find(r => r.id === roomId);
      if (!room) return;

      const adults = Number(row.querySelector(".adults").value);
      const kids = Number(row.querySelector(".kids").value);
      if (adults + kids === 0) return;

      /* ----------------------------------------
         1️⃣ Decide BASE PRICE (dynamic → fallback)
      ---------------------------------------- */
      const rates =
        availabilityMap?.[room.id]?.rates?.length
          ? availabilityMap[room.id].rates
          : [room.price];

      const baseRatePerNight = Math.round(
        rates.reduce((a, b) => a + b, 0) / rates.length
      );

      const baseRoomCost = baseRatePerNight * nights;

      /* ----------------------------------------
         2️⃣ Extra guest calculation
      ---------------------------------------- */
      const baseOccupancy = Number(room.base_included_adults || 2);
      const totalGuests = adults + kids;
      const extraGuests = Math.max(0, totalGuests - baseOccupancy);

      const extraAdults = Math.min(
        extraGuests,
        Math.max(0, adults - baseOccupancy)
      );

      const extraKids = Math.max(0, extraGuests - extraAdults);

      const extraAdultCost =
        extraAdults * (room.extra_adult_price || 0) * nights;

      const extraKidCost =
        extraKids * (room.extra_kid_price || 0) * nights;

      const subTotal =
        baseRoomCost + extraAdultCost + extraKidCost;

      /* ----------------------------------------
         3️⃣ GST — ALWAYS ON FINAL BASE
      ---------------------------------------- */
      const gstRate = Number(room.gst || 0);
      const gstAmount = Math.round(subTotal * gstRate / 100);

      const finalTotal = subTotal + gstAmount;

      /* ----------------------------------------
         4️⃣ Accumulate totals
      ---------------------------------------- */
      totalBase += subTotal;
      totalGST += gstAmount;
      grandTotal += finalTotal;

      /* ----------------------------------------
         5️⃣ Store FINAL values (NO RECALC LATER)
      ---------------------------------------- */
      window.customSelection.push({
        roomId: room.id,
        category: room.category,
        nights,
        adults,
        kids,

        basePrice: subTotal,
        gstAmount,
        price: finalTotal
      });
    });

  /* ----------------------------------------
     6️⃣ Update UI (display only)
  ---------------------------------------- */
  document.getElementById("customTotalPrice").textContent =
    `Total: ₹${grandTotal.toLocaleString()}`;

  document.getElementById("summaryGST").textContent =
    `₹${totalGST.toLocaleString()}`;

  document.getElementById("summaryPayable").textContent =
    `₹${grandTotal.toLocaleString()}`;

  updateRemainingGuests();
  updatePlanSummary();
  renderDetailedSummaryTable();
}
/* ============================================================
   Update Plan Summary
============================================================ */

function updatePlanSummary() {
  const bar = document.getElementById("planSummaryBar");
  const priceEl = document.getElementById("summaryPrice");
  const summaryLineEl = document.getElementById("summaryLine");
const grandBar = document.getElementById("grandTotalBar");

  if (!window.customSelection || window.customSelection.length === 0) {
  bar.classList.add("hidden");
  if (grandBar) grandBar.classList.add("hidden");
  return;
}

  bar.classList.remove("hidden");
if (grandBar) grandBar.classList.remove("hidden");

  let totalAdults = 0;
  let totalKids = 0;
  let totalRooms = window.customSelection.length;
  const nights = calcNights(checkIn, checkOut);

  window.customSelection.forEach(s => {
    totalAdults += s.adults;
    totalKids += s.kids;
  });

  // ✅ STATE-1 HUMAN SUMMARY
  summaryLineEl.textContent =
    `${totalRooms} Room${totalRooms > 1 ? "s" : ""} · ` +
    `${totalAdults} Adult${totalAdults > 1 ? "s" : ""}` +
    `${totalKids > 0 ? ` · ${totalKids} Kid${totalKids > 1 ? "s" : ""}` : ""} · ` +
    `${nights} Night${nights > 1 ? "s" : ""}`;

  // ✅ TOTAL PRICE
  // ✅ TOTAL PRICE — SINGLE SOURCE OF TRUTH
const total = window.customSelection.reduce(
  (sum, item) => sum + Number(item.price || 0),
  0
);

priceEl.textContent = `₹${total.toLocaleString()}`;


}


/* ============================================================
   Render Detailed Summary Table
============================================================ */
function renderDetailedSummaryTable() {
  const tbody = document.getElementById("summaryTableBody");
  if (!tbody || !window.customSelection?.length) return;

  tbody.innerHTML = "";

  let totalGST = 0;
  let grandTotal = 0;

  window.customSelection.forEach(item => {
    const room = window.allRooms.find(r => r.id == item.roomId);
    if (!room) return;

    const nights = calcNights(checkIn, checkOut);

    // ✅ Dynamic per-night rate (from inventory)
    const rates = availabilityMap?.[room.id]?.rates || [room.price];
    const avgRate = Math.round(
      rates.reduce((a, b) => a + b, 0) / rates.length
    );

    // ✅ BASE PRICE — NO GST
const baseRoomCost = avgRate * nights;

// Extra guest calculation
const baseOccupancy = Number(room.base_included_adults || 2);
const totalGuests = item.adults + item.kids;

const extraGuests = Math.max(0, totalGuests - baseOccupancy);
const extraAdultsCount = Math.min(
  extraGuests,
  Math.max(0, item.adults - baseOccupancy)
);
const extraKidsCount = Math.max(0, extraGuests - extraAdultsCount);

const extraAdults =
  extraAdultsCount * (room.extra_adult_price || 0) * nights;
const extraKids =
  extraKidsCount * (room.extra_kid_price || 0) * nights;

// ✅ SUBTOTAL (NO GST)
const subTotal = baseRoomCost + extraAdults + extraKids;

// ✅ GST (CALCULATED, NOT BACK-CALCULATED)
const gstAmount = Math.round(subTotal * (room.gst || 0) / 100);

// ✅ FINAL TOTAL
const total = subTotal + gstAmount;

totalGST += gstAmount;
grandTotal += total;


    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.category}</td>
      <td>${nights}</td>
      <td>₹${baseRoomCost.toLocaleString()}</td>
      <td>₹${extraAdults.toLocaleString()}</td>
      <td>₹${extraKids.toLocaleString()}</td>
      <td>₹${subTotal.toLocaleString()}</td>
      <td>₹${gstAmount.toLocaleString()}</td>
      <td>₹${total.toLocaleString()}</td>
    `;

    tbody.appendChild(tr);
  });

  document.getElementById("summaryGST").textContent =
    `₹${totalGST.toLocaleString()}`;
  document.getElementById("summaryPayable").textContent =
    `₹${grandTotal.toLocaleString()}`;
}



/* ======================================================
   Toggle Summary Drawer (Bottom Bar)
======================================================= */
function toggleSummaryDrawer() {
  const bar = document.getElementById("planSummaryBar");
  const icon = document.getElementById("summaryToggleIcon");
  const content = document.getElementById("pageContent");

  if (!bar || !icon || !content) return;

  const expanded = bar.classList.toggle("expanded");

  icon.textContent = expanded ? "▲" : "▼";

  // ✅ Smart space management
  content.style.paddingBottom = expanded ? "60vh" : "90px";
}


/* ============================================================
   Send Custom Stay To WhatsApp
============================================================ */

function sendCustomStayToWhatsApp() {

  if (!window.customSelection || window.customSelection.length === 0) {
    alert("Please select rooms and occupancy first.");
    return;
  }

  const lines = window.customSelection.map(p =>
    `• ${p.category}: ${p.adults} Adults${p.kids > 0 ? `, ${p.kids} Kids` : ""} – ₹${p.price.toLocaleString()}`
  ).join("\n");

  const total = window.customSelection.reduce((sum, p) => sum + p.price, 0);

  const msg = `
Hello,

Enquiry from wildleafstays.com

Hotel: ${document.getElementById("hotelName").textContent}
Check-in: ${checkIn}
Check-out: ${checkOut}

Custom Stay Details:
${lines}

Estimated Total: ₹${total.toLocaleString()}

Please confirm availability & final price.
`.trim();

const remAdults = adults - window.customSelection.reduce((s, r) => s + r.adults, 0);
const remKids = kids - window.customSelection.reduce((s, r) => s + r.kids, 0);

if (remAdults !== 0 || remKids !== 0) {
  alert("Please allocate rooms for all guests.");
  return;
}


  window.open(
    "https://wa.me/917018310331?text=" + encodeURIComponent(msg),
    "_blank"
  );
}

/* ============================================================
   Build Custom StayUI
============================================================ */
function buildCustomStayUI() {
  const container = document.getElementById("customRoomsContainer");
  container.innerHTML = "";

  window.customSelection = [];

  window.allRooms.forEach(room => {
    const block = document.createElement("div");
    block.className = "custom-category-block";
    block.dataset.roomId = room.id;
    block.dataset.maxGuests = room.max_guests;

    block.innerHTML = `
      <h4>${room.category}</h4>

      <div class="custom-controls">
        <label>Rooms</label>
        <select class="room-count">
          ${Array.from({ length: room.max_rooms + 1 }, (_, i) =>
            `<option value="${i}">${i}</option>`
          ).join("")}
        </select>
      </div>

      <div class="room-occupancies"></div>
    `;

    const roomCountSelect = block.querySelector(".room-count");
    const occupanciesDiv = block.querySelector(".room-occupancies");

    roomCountSelect.addEventListener("change", () => {
      occupanciesDiv.innerHTML = "";
      const count = Number(roomCountSelect.value);

      for (let i = 1; i <= count; i++) {
        occupanciesDiv.appendChild(createRoomOccupancyRow(room, i));
      }

      updateCustomTotal();
    });

    container.appendChild(block);
  });
}

/* ============================================================
   Create Room Occupancy Row
============================================================ */

function createRoomOccupancyRow(room, index) {
  const row = document.createElement("div");
  row.className = "room-occupancy-row";
  row.dataset.roomId = room.id;   // ✅ THIS IS THE MISSING LINK
  row.dataset.maxGuests = room.max_guests;

  row.innerHTML = `
    <strong>Room ${index}</strong>

    <div class="custom-controls">
      <label>Adults</label>
      <select class="adults">
        ${Array.from({ length: room.max_guests + 1 }, (_, i) =>
          `<option value="${i}">${i}</option>`
        ).join("")}
      </select>

      <label>Kids</label>
      <select class="kids">
        ${Array.from({ length: room.max_guests + 1 }, (_, i) =>
          `<option value="${i}">${i}</option>`
        ).join("")}
      </select>
    </div>
  `;

  const adultsSel = row.querySelector(".adults");
  const kidsSel = row.querySelector(".kids");

  adultsSel.addEventListener("change", () => {
    enforceOccupancyRow(row);
    updateCustomTotal();
  });

  kidsSel.addEventListener("change", () => {
    enforceOccupancyRow(row);
    updateCustomTotal();
  });

  return row;
}

/* ============================================================
   Enforce Occupancy Row
============================================================ */

function enforceOccupancyRow(row) {
  const maxGuests = Number(row.dataset.maxGuests);

  const adultsSel = row.querySelector(".adults");
  const kidsSel = row.querySelector(".kids");

  let adults = Number(adultsSel.value);
  let kids = Number(kidsSel.value);

  if (adults + kids > maxGuests) {
    if (adults > kids) {
      kids = maxGuests - adults;
      kidsSel.value = kids;
    } else {
      adults = maxGuests - kids;
      adultsSel.value = adults;
    }
  }

  [...adultsSel.options].forEach(opt => {
    opt.disabled = Number(opt.value) + kids > maxGuests;
  });

  [...kidsSel.options].forEach(opt => {
    opt.disabled = Number(opt.value) + adults > maxGuests;
  });
}



/* ============================================================
   Send Option To WhatsApp
============================================================ */
function sendOptionToWhatsApp(option) {
  const lines = option.plan.map(p =>
    `• ${p.category}: ${p.adults} Adults${p.kids > 0 ? `, ${p.kids} Kids` : ""} – ₹${p.price}`
  ).join("\n");

  const msg = `
Hello,

Enquiry from wildleafstays.com

Hotel: ${document.getElementById("hotelName").textContent}
Check-in: ${checkIn}
Check-out: ${checkOut}

Guest Summary:
Adults: ${adults}
Kids: ${kids}

Room-wise Price:
${lines}

Estimated Total: ₹${option.totalPrice.toLocaleString()}

Please confirm availability & final price.
`.trim();

  window.open(
    "https://wa.me/917018310331?text=" + encodeURIComponent(msg),
    "_blank"
  );
}



/*🛡️ ============================================================
   PRICE & TOTALS
============================================================ */
function calculatePriceWithGST(price, gst) {
  return Math.round(Number(price) + (Number(price) * Number(gst)) / 100);
}

function calcNights(start, end) {
  const [y1, m1, d1] = start.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);

  const date1 = new Date(y1, m1 - 1, d1);
  const date2 = new Date(y2, m2 - 1, d2);

  return Math.max(1, (date2 - date1) / (1000 * 60 * 60 * 24));
}




/* ============================================================
   ROOM GALLERY
============================================================ */
function openRoomGallery(roomId) {
  window.location.href = `room-gallery.html?roomId=${roomId}`;
}





/* ============================================================
   Final Booking Button when reinstating the booking engine
============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("finalBookBtn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    console.log("BOOK NOW CLICKED");
    console.log(window.customSelection);

    if (!window.customSelection || window.customSelection.length === 0) {
      alert("Please select at least one room");
      return;
    }

//📍added to correct the date format
function normalizeDate(input) {
  // dd/mm/yyyy → yyyy-mm-dd
  if (input.includes("/")) {
    const [dd, mm, yyyy] = input.split("/");
    return `${yyyy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`;
  }
  return input; // already yyyy-mm-dd
}

    // ✅ Build booking object (NO inventory touch)
const bookingData = {
  hotelId: hotelId,
  hotelName: document.getElementById("hotelName").textContent,
  checkIn: normalizeDate(checkIn),
  checkOut: normalizeDate(checkOut),
  adults: Number(adults),
  kids: Number(kids),
  rooms: window.customSelection,
  totalAmount: window.customSelection.reduce((s, r) => s + r.price, 0)
};


// ✅ Save temporarily for confirmation page
sessionStorage.setItem(
  "pendingBooking",
  JSON.stringify(bookingData)
);

// ✅ Go to confirmation page
window.location.href = "booking-summary.html";
  });
});


/* ============================================================
   APPLY NEW SEARCH
============================================================ */
function applyHotelSearch() {
  if (!checkIn || !checkOut) {
    alert("Please select check-in and check-out dates");
    return;
  }

  adults = Number(document.getElementById("hAdults").value);
  kids = Number(document.getElementById("hKids").value);

  window.location.href =
    `hotel.html?id=${hotelId}&checkIn=${checkIn}&checkOut=${checkOut}&adults=${adults}&kids=${kids}`;
}



/* ============================================================
   PREMIUM ICON MAP (C)
============================================================ */
const ICONS = {
  kitchen_available: "🥘",
  restaurant_available: "🍴",
  room_service: "🛎️",
  inhouse_chef: "👨‍🍳",
  cafe_available: "☕",
  outdoor_dining: "🌤️",
  bbq_available: "🔥",
  breakfast_included: "🍳",

  cctv: "📹",
  fire_extinguishers: "🧯",
  first_aid: "⛑️",
  security_guard: "🛡️",
  emergency_exit: "🚪",

  power_backup: "⚡",
  hot_water: "💧",
  solar_water_heating: "☀️",
  heating_available: "🔥",
  water_purifier: "🚰",

  parking_available: "🅿️",
  covered_parking: "🏠",
  valet_service: "🤵",
  ev_charging: "🔌",
  taxi_on_call: "🚕",

  lawn_garden: "🌿",
  terrace: "🛋️",
  private_villa_mode: "🏡",
  mountain_view: "⛰️",
  valley_view: "🏞️",
  forest_view: "🌲",
  outdoor_seating: "🪑",
  bonfire_area: "🔥",
  swimming_pool: "🏊",
  kids_play_area: "🧸",

  rule_smoking: "🚬",
  rule_pets: "🐾",
  rule_parties: "🎉",
  loud_music_allowed: "🎵",

  wheelchair_room: "♿",
  wheelchair_entrance: "🚪♿",
  elevator: "🛗",
};

/* ============================================================
   Render Icon Grid Section
============================================================ */
function renderIconGrid(targetId, hotel, fields) {
  const container = document.getElementById(targetId);
  container.innerHTML = "";

  fields.forEach(field => {
    if (hotel[field] === 1 || hotel[field] === true || (hotel[field] && hotel[field] !== "no")) {
      const div = document.createElement("div");
      div.className = "icon-item";

      div.innerHTML = `
        <span class="icon">${ICONS[field] || "✓"}</span>
        <span class="label">${toLabel(field)}</span>
      `;

      container.appendChild(div);
    }
  });

  if (!container.innerHTML.trim()) {
    container.innerHTML = "<p class='muted'>No data available</p>";
  }
}

/* Convert field names to readable labels */
function toLabel(key) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function enquireRoomOnWhatsApp(roomName, price) {
  const msg = `
Hello,

I am enquiring from wildleafstays.com

Hotel: ${document.getElementById("hotelName").textContent}
Room: ${roomName}
Check-in: ${checkIn}
Check-out: ${checkOut}
Adults: ${adults}
Kids: ${kids}
Displayed Rate: ₹${price}

Please confirm availability & final price.
`.trim();

  window.open(
    "https://wa.me/917018310331?text=" + encodeURIComponent(msg),
    "_blank"
  );
}



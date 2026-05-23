let VILLA_PRICE = 0;
let VILLA_GST_PERCENT = 0;
let VILLA_TOTAL_AMOUNT = 0;
let checkIn = null;
let checkOut = null;





// =============================================================
//   GET VILLA ID
// =============================================================
const urlParams = new URLSearchParams(window.location.search);
const villaId = urlParams.get("id");

if (!villaId) {
    alert("Invalid villa!");
}

function minusOneDay(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}


// =============================================================
//   GLOBAL VARIABLES FOR GALLERY
// =============================================================
let GALLERY_IMAGES = [];
let currentIndex = 0;


// =============================================================
//  HELPERS
// =============================================================
function set(id, value) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn("Missing element ID:", id);
    return;
  }
  el.textContent = value || "-";
}

function yesNo(v) {
  if (v === 1 || v === true) return "Yes";
  if (v === 0 || v === false) return "No";
  return "-";
}

/* ✅ ADD THIS RIGHT AFTER HELPERS */
function updateVillaPriceUI() {

  // LEFT SUMMARY (Total Price Per Night)
  const summaryPrice = document.getElementById("villaPrice");
  if (summaryPrice) {
    summaryPrice.textContent = `₹${VILLA_PRICE.toLocaleString()}`;
  }

  // RIGHT PRICE BREAKDOWN
  const nightPrice = document.getElementById("vNightPrice");
  if (nightPrice) {
    nightPrice.textContent = VILLA_PRICE;
  }

  
} 

// =============================================================
//   LOAD VILLA DETAILS
// =============================================================
async function loadVilla() {

    const res = await fetch(`/api/hotels/${villaId}`);
    const hotel = await res.json();

    console.log("VILLA DATA:", hotel);
window.villaRooms = hotel.rooms || [];
// ✅ Base Guests = sum(max_rooms × base_included_adults)
let villaBaseGuests = 0;

if (Array.isArray(hotel.rooms)) {
  hotel.rooms.forEach(cat => {
    const roomsCount = Number(cat.max_rooms || 0);
    const baseAdults = Number(cat.base_included_adults || 2); // fallback 2
    villaBaseGuests += roomsCount * baseAdults;
  });
}

set("villaBaseGuests", villaBaseGuests);

// ✅ Display-only: tonight’s rate
loadTonightStatus(villaId);

// =============================================================
//   Guest Selector
// =============================================================
function populateGuestSelectors(maxGuests) {
  const adultsSelect = document.getElementById("vAdults");
  const kidsSelect = document.getElementById("vKids");

  if (!adultsSelect || !kidsSelect) return;

  adultsSelect.innerHTML = "";
  kidsSelect.innerHTML = "";

  // Adults: 1 → maxGuests
  for (let i = 1; i <= maxGuests; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${i} Adult${i > 1 ? "s" : ""}`;
    adultsSelect.appendChild(opt);
  }

  // Kids: 0 → maxGuests
  for (let i = 0; i <= maxGuests; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${i} Kid${i !== 1 ? "s" : ""}`;
    kidsSelect.appendChild(opt);
  }

  const baseGuests =
  Number(document.getElementById("villaBaseGuests")?.textContent) || 2;

adultsSelect.value = Math.min(baseGuests, maxGuests);
 // default
  kidsSelect.value = 0;

const infantsSelect = document.getElementById("vInfants");
if (infantsSelect) {
  infantsSelect.innerHTML = "";
  for (let i = 0; i <= 5; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${i} Infant${i !== 1 ? "s" : ""}`;
    infantsSelect.appendChild(opt);
  }
  infantsSelect.value = 0;
}

}

//================Guest Limit Logic===================
//====================================================
function setupGuestLimitLogic() {
  const adultsEl = document.getElementById("vAdults");
  const kidsEl = document.getElementById("vKids");
  const infantsEl = document.getElementById("vInfants");
  const msgEl = document.getElementById("vAvailabilityMsg");

  if (!adultsEl || !kidsEl) return;

  function updateLimits(changedBy) {
    const { baseGuests, maxGuests } = getGuestLimits();

    let adults = Number(adultsEl.value || 0);
    let kids = Number(kidsEl.value || 0);

    let totalCounted = adults + kids;

    // 🔒 Hard limit enforcement
    if (totalCounted > maxGuests) {
      if (changedBy === "adults") {
        kids = Math.max(0, maxGuests - adults);
        kidsEl.value = kids;
      } else {
        adults = Math.max(1, maxGuests - kids);
        adultsEl.value = adults;
      }
      totalCounted = adults + kids;
    }

    // 🔢 Rebuild dropdown ranges dynamically
    const remainingForKids = maxGuests - adults;
    const remainingForAdults = maxGuests - kids;

    rebuildSelect(kidsEl, 0, remainingForKids, kids);
    rebuildSelect(adultsEl, 1, remainingForAdults, adults);

    // 💬 Friendly messages
    if (totalCounted === maxGuests) {
      msgEl.textContent = "You have selected the maximum allowed guests for this villa.";
      msgEl.style.color = "#b3261e";
    } else if (totalCounted > baseGuests) {
      msgEl.textContent = "Extra charges will apply for additional guests.";
      msgEl.style.color = "#ff385c";
    } else {
      msgEl.textContent = "";
    }
  }

  adultsEl.addEventListener("change", () => updateLimits("adults"));
  kidsEl.addEventListener("change", () => updateLimits("kids"));

  // Initial sync
  updateLimits("adults");
}



    /* ---------------------------------------------------------
       BASIC INFO
    --------------------------------------------------------- */
    set("villaName", hotel.name);
    set("villaTagline", hotel.villa_tagline);
    set("villaDescription", hotel.description);
    set("villaRefund", hotel.refund_policy);
    set("villaCity", hotel.city);



 /* ---------------------------------------------------------
   HERO IMAGE GALLERY (AIRBNB SAFE)
--------------------------------------------------------- */
const heroMain = document.querySelector(".hero-main");
const heroSides = document.querySelectorAll(".hero-side div");

if (heroMain && heroSides.length && hotel.images?.length) {

  // Build absolute URLs
  const images = hotel.images.map(
    img => `${img.image_url}`
  );

  // Main image
  heroMain.style.backgroundImage = `url(${images[0]})`;

  // Side images
  heroSides.forEach((el, i) => {
    if (images[i + 1]) {
      el.style.backgroundImage = `url(${images[i + 1]})`;
    } else {
      el.style.backgroundImage = `url(${images[0]})`;
    }
  });

  // Save for fullscreen gallery
  GALLERY_IMAGES = images;
addViewGalleryButton();

}


/* ---------------------------------------------------------
   PROPERTY SUMMARY (FIXED)
--------------------------------------------------------- */

// Max Guests
// ✅ MAX GUESTS = sum(max_rooms × max_guests)
let villaMaxGuests = 0;

if (Array.isArray(hotel.rooms)) {
  hotel.rooms.forEach(cat => {
    const roomsCount = Number(cat.max_rooms || 0);
    const maxGuestsPerRoom = Number(cat.max_guests || 0);

    villaMaxGuests += roomsCount * maxGuestsPerRoom;
  });
}

set("villaMaxGuests", villaMaxGuests);

populateGuestSelectors(villaMaxGuests);
setupGuestLimitLogic();


// Bathrooms
set(
  "villaBathrooms",
  hotel.bathrooms || hotel.bathroom_count || "-"
);

// Architecture
set("villaArchitecture", hotel.architecture);

// View
set("villaView", hotel.view_type || hotel.view || "-");

// Check-in / Check-out
set("villaCheckIn", hotel.check_in_time || "-");
set("villaCheckOut", hotel.check_out_time || "-");

// Total rooms (top meta)
let totalRooms = 0;

if (Array.isArray(hotel.rooms)) {
  hotel.rooms.forEach(cat => {
    totalRooms += Number(cat.max_rooms || 0);
  });
}

set("villaRooms", totalRooms);





    /* ---------------------------------------------------------
       AMENITIES
    --------------------------------------------------------- */
    const amenBox = document.getElementById("villaAmenities");
    amenBox.innerHTML = "";

    if (hotel.facilities) {
        hotel.facilities.split(",").forEach(a => {
            const div = document.createElement("div");
            div.textContent = a.trim();
            amenBox.appendChild(div);
        });
    }



    /* ---------------------------------------------------------
       HOUSE RULES
    --------------------------------------------------------- */
    set("ruleSmoking", yesNo(hotel.rule_smoking));
    set("rulePets", yesNo(hotel.rule_pets));
    set("ruleParties", yesNo(hotel.rule_parties));
    set("ruleLoudMusic", yesNo(hotel.loud_music_allowed));



    /* ---------------------------------------------------------
       FOOD & KITCHEN
    --------------------------------------------------------- */
    set("villaKitchen", yesNo(hotel.kitchen_available));
    set("villaRestaurant", yesNo(hotel.restaurant_available));
    set("villaRoomService", yesNo(hotel.room_service));
    set("villaBreakfast", hotel.breakfast_included || "No");

    set("villaChef", yesNo(hotel.inhouse_chef));
    set("villaCafe", yesNo(hotel.cafe_available));
    set("villaOutdoorDining", yesNo(hotel.outdoor_dining));
    set("villaBBQ", yesNo(hotel.bbq_available));

    set("villaFoodOptions", hotel.food);



    /* ---------------------------------------------------------
       SAFETY
    --------------------------------------------------------- */
    set("villaCCTV", yesNo(hotel.cctv));
    set("villaFire", yesNo(hotel.fire_extinguishers));
    set("villaFirstAid", yesNo(hotel.first_aid));
    set("villaGuard", yesNo(hotel.security_guard));
    set("villaEmergencyExit", yesNo(hotel.emergency_exit));



    /* ---------------------------------------------------------
       POWER
    --------------------------------------------------------- */
    set("villaPowerBackup", yesNo(hotel.power_backup));
    set("villaHotWater", yesNo(hotel.hot_water));
    set("villaSolar", yesNo(hotel.solar_water_heating));
    set("villaHeating", yesNo(hotel.heating_available));
    set("villaWaterPurifier", hotel.water_purifier || "-");


    /* ---------------------------------------------------------
       PARKING / TRANSPORT
    --------------------------------------------------------- */
    
set("villaCoveredParking", yesNo(hotel.covered_parking));
set("villaValet", yesNo(hotel.valet_service));
set("villaEV", yesNo(hotel.ev_charging));
set("villaTaxi", yesNo(hotel.taxi_on_call));



    /* ---------------------------------------------------------
       PROPERTY FEATURES
    --------------------------------------------------------- */
    set("villaLawn", yesNo(hotel.lawn_garden));
set("villaTerrace", yesNo(hotel.terrace));
set("villaPrivateMode", yesNo(hotel.private_villa_mode));

set("villaMountainView", yesNo(hotel.mountain_view));
set("villaValleyView", yesNo(hotel.valley_view));
set("villaForestView", yesNo(hotel.forest_view));

set("villaOutdoorSeating", yesNo(hotel.outdoor_seating));
set("villaBonfire", yesNo(hotel.bonfire_area));
set("villaPool", yesNo(hotel.swimming_pool));
set("villaKidsPlay", yesNo(hotel.kids_play_area));


    /* ---------------------------------------------------------
       NEARBY ATTRACTIONS
    --------------------------------------------------------- */
    const attList = document.getElementById("villaAttractionsList");
    attList.innerHTML = "";

    let atts = [];

    if (Array.isArray(hotel.nearby_attractions)) atts = hotel.nearby_attractions;
    else if (typeof hotel.nearby_attractions === "string")
        atts = hotel.nearby_attractions.split(",");

    atts.forEach(a => {
        const li = document.createElement("li");
        li.textContent = a.trim();
        attList.appendChild(li);
    });
}

loadVilla();



// =============================================================
//   VIEW GALLERY BUTTON
// =============================================================
function addViewGalleryButton() {
    const gallerySection = document.querySelector(".villa-gallery-grid");

    if (!gallerySection) return;

    const btn = document.createElement("button");
    btn.className = "view-gallery-btn";
    btn.textContent = "View All Photos";
    btn.onclick = () => openGalleryModal(0);

    gallerySection.insertAdjacentElement("afterend", btn);
}


// =============================================================
//   FULLSCREEN GALLERY MODAL LOGIC (Next/Prev/Swipe)
// =============================================================
function openGalleryModal(index) {
    currentIndex = index;

    if (!document.getElementById("fullGalleryModal")) {
        createGalleryModal();
    }

    updateGalleryImage();

    document.getElementById("fullGalleryModal").style.display = "block";
}

function closeGalleryModal() {
    document.getElementById("fullGalleryModal").style.display = "none";
}


// Create modal structure ONCE
function createGalleryModal() {
    const modal = document.createElement("div");
    modal.id = "fullGalleryModal";
    modal.className = "full-gallery-modal";

    modal.innerHTML = `
        <span class="close-gallery" onclick="closeGalleryModal()">&times;</span>

        <img id="modalImage" src="" />

        <div class="gallery-arrow left" id="prevImg">&#10094;</div>
        <div class="gallery-arrow right" id="nextImg">&#10095;</div>
    `;

    document.body.appendChild(modal);

    // Buttons
    document.getElementById("prevImg").onclick = () => changeImage(-1);
    document.getElementById("nextImg").onclick = () => changeImage(1);

    // Keyboard navigation
    document.addEventListener("keydown", e => {
        if (modal.style.display !== "block") return;

        if (e.key === "ArrowLeft") changeImage(-1);
        if (e.key === "ArrowRight") changeImage(1);
        if (e.key === "Escape") closeGalleryModal();
    });

    // Mobile swipe
    let startX = 0;
    modal.addEventListener("touchstart", e => {
        startX = e.touches[0].clientX;
    });

    modal.addEventListener("touchend", e => {
        const endX = e.changedTouches[0].clientX;
        if (startX - endX > 40) changeImage(1);      // swipe left
        if (endX - startX > 40) changeImage(-1);    // swipe right
    });
}

function updateGalleryImage() {
    const img = document.getElementById("modalImage");
    img.src = GALLERY_IMAGES[currentIndex];
}

function changeImage(dir) {
    currentIndex += dir;

    if (currentIndex < 0) currentIndex = GALLERY_IMAGES.length - 1;
    if (currentIndex >= GALLERY_IMAGES.length) currentIndex = 0;

    updateGalleryImage();
}


function toLocalYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}



// =============================================================
//  PREFILL DATES Flatpicker Dates
// =============================================================


flatpickr("#villaDateRange", {
  mode: "range",
  dateFormat: "Y-m-d",
  minDate: "today",
  defaultDate: [
    new Date(),
    new Date(Date.now() + 86400000)
  ],
  onClose(dates) {
    if (dates.length === 2) {
      checkIn = toLocalYMD(dates[0]);
checkOut = toLocalYMD(dates[1]);

    }
  }
});


// =============================================================
//  PRICE & INVENTORY LOGIC
// =============================================================

async function checkVillaAvailability(hotelId) {
  if (!checkIn || !checkOut) {
  
  return false;
}


  const res = await fetch(
    `/api/inventory?hotelId=${hotelId}&start=${checkIn}&end=${checkOut}`
  );

  const data = await res.json();

  VILLA_PRICE = Number(data.villa_price || 0);
  VILLA_GST_PERCENT = Number(data.gst_percent || 0);

  updateVillaPriceUI();

  return data.villa_available === true;
}

// =============================================================
//  DERIVE VILLA EXTRA GUEST PRICING FROM CATEGORIES
// =============================================================
function getVillaExtraGuestPricing() {
  let extraAdultPrice = 0;
  let extraKidPrice = 0;

  if (!Array.isArray(window.villaRooms)) {
    return { extraAdultPrice, extraKidPrice };
  }

  window.villaRooms.forEach(cat => {
    const adultPrice = Number(cat.extra_adult_price || 0);
    const kidPrice = Number(cat.extra_kid_price || 0);

    if (adultPrice > extraAdultPrice) extraAdultPrice = adultPrice;
    if (kidPrice > extraKidPrice) extraKidPrice = kidPrice;
  });

  return { extraAdultPrice, extraKidPrice };
}



function calculateVillaTotal() {
  const checkInDate = new Date(checkIn);
const checkOutDate = new Date(checkOut);


const nights = Math.max(
  1,
  Math.round((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24))
);

  const adults = Number(document.getElementById("vAdults").value || 0);
  const kids = Number(document.getElementById("vKids").value || 0);

  const { baseGuests } = getGuestLimits();
  const totalGuests = adults + kids;
  const extraGuests = Math.max(0, totalGuests - baseGuests);

  const { extraAdultPrice, extraKidPrice } = getVillaExtraGuestPricing();

  const extraAdults = Math.max(0, adults - baseGuests);
  const remainingExtra = Math.max(0, extraGuests - extraAdults);
  const extraKids = Math.min(kids, remainingExtra);

  const extraAdultsCost = extraAdults * extraAdultPrice;
  const extraKidsCost = extraKids * extraKidPrice;

  const extraGuestTotal = extraAdultsCost + extraKidsCost;

  const gstAmount = Math.round(
    (VILLA_PRICE * VILLA_GST_PERCENT) / 100
  );

VILLA_TOTAL_AMOUNT = nights * (VILLA_PRICE + extraGuestTotal + gstAmount);


  document.getElementById("vNights").textContent = nights;
  document.getElementById("vNightPrice").textContent = VILLA_PRICE;
  document.getElementById("vGst").textContent = gstAmount;
  document.getElementById("vTotal").textContent = VILLA_TOTAL_AMOUNT;

  return VILLA_TOTAL_AMOUNT;
}

  

// ================= Guest Price Summary =================
const breakdownEl = document.getElementById("villaGuestBreakdown");

if (breakdownEl) {
  let html = `
    <div class="line">
      <span class="muted">
        Base price (${baseGuests} guests)
      </span>
      <span>₹${VILLA_PRICE}</span>
    </div>
  `;

  if (extraAdults > 0) {
    html += `
      <div class="line">
        <span>
          Adults (above 12 yrs): ${extraAdults} × ₹${extraAdultPrice}
        </span>
        <span>₹${extraAdultsCost}</span>
      </div>
    `;
  }

  if (extraKids > 0) {
    html += `
      <div class="line">
        <span>
          Kids (above 5 yrs): ${extraKids} × ₹${extraKidPrice}
        </span>
        <span>₹${extraKidsCost}</span>
      </div>
    `;
  }

  html += `
    <div class="line total">
      <span>Grand Total</span>
      <span>₹${VILLA_TOTAL_AMOUNT}</span>
    </div>
  `;

  breakdownEl.innerHTML = html;
}


// BUTTON → CHECK AVAILABILITY
document.getElementById("vCheckBtn").addEventListener("click", async () => {
  const hotelId = villaId;


  const available = await checkVillaAvailability(hotelId);
  const msg = document.getElementById("vAvailabilityMsg");

  if (!available) {
    msg.textContent = "❌ Full Villa is SOLD OUT for selected dates";
    msg.style.color = "red";
    document.getElementById("villaPriceBox").style.display = "none";
    document.getElementById("vBookBtn").disabled = true;
    return;
  }

  msg.textContent = "✔ Full Villa is AVAILABLE";
  msg.style.color = "green";

 
window.VILLA_TOTAL_AMOUNT = calculateVillaTotal();


  document.getElementById("villaPriceBox").style.display = "block";
  document.getElementById("vBookBtn").disabled = false;
});



// BOOK VILLA
document.getElementById("vBookBtn").addEventListener("click", () => {
const adults = Number(document.getElementById("vAdults").value);
const kids = Number(document.getElementById("vKids").value);
const totalGuests = adults + kids;

const maxGuests = Number(document.getElementById("villaMaxGuests").textContent);

if (totalGuests > maxGuests) {
  alert(`Maximum ${maxGuests} guests allowed for this villa`);
  return;
}

  const bookingData = {
  hotelId: villaId,
  hotelName: document.getElementById("villaName").textContent,
  checkIn: checkIn,
checkOut: checkOut,

  adults: Number(document.getElementById("vAdults").value),
  kids: Number(document.getElementById("vKids").value),
infants: Number(document.getElementById("vInfants").value), // ✅ NEW
  rooms: [],
  isFullVilla: true,
  villaPerNightPrice: VILLA_PRICE,
  totalAmount: VILLA_TOTAL_AMOUNT,
  gstPercent: VILLA_GST_PERCENT
};


  sessionStorage.setItem(
    "pendingBooking",
    JSON.stringify(bookingData)
  );

  window.location.href = "booking-summary.html";
});


// =============================================================
//  Tonight Status + Price (Merged Line)
// =============================================================
async function loadTonightStatus(hotelId) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000)
      .toISOString()
      .slice(0, 10);

    const res = await fetch(
      `/api/inventory?hotelId=${hotelId}&start=${today}&end=${tomorrow}`
    );

    const data = await res.json();

    const lineEl = document.getElementById("villaTonightLine");
    if (!lineEl) return;

    // ❌ Not available tonight
    if (data.villa_available !== true) {
      lineEl.className = "villa-tonight-line unavailable";
      lineEl.textContent = "Not available tonight";
      return;
    }

    // ✅ Available tonight (with price)
    if (data.villa_price) {
      VILLA_PRICE = Number(data.villa_price);

      lineEl.className = "villa-tonight-line available";
      lineEl.innerHTML = `
        Available tonight ·
        <span class="price">₹${VILLA_PRICE.toLocaleString()}</span>
        <span class="per-night"> / night</span>
      `;
      return;
    }

    // ⚠️ Available but price missing
    lineEl.className = "villa-tonight-line";
    lineEl.textContent = "Available · Check dates for pricing";

  } catch (err) {
    console.warn("Tonight availability check failed", err);
  }
}

// =============================================================
//  Guests Limit Seter
// =============================================================

function getGuestLimits() {
  const baseGuests =
    Number(document.getElementById("villaBaseGuests")?.textContent) || 0;

  const maxGuests =
    Number(document.getElementById("villaMaxGuests")?.textContent) || 0;

  return { baseGuests, maxGuests };
}


//========================Rebuild Select============================

function rebuildSelect(selectEl, min, max, current) {
  const value = Math.min(Math.max(current, min), max);
  selectEl.innerHTML = "";

  for (let i = min; i <= max; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent =
      selectEl.id === "vAdults"
        ? `${i} Adult${i > 1 ? "s" : ""}`
        : `${i} Kid${i !== 1 ? "s" : ""}`;

    if (i === value) opt.selected = true;
    selectEl.appendChild(opt);
  }

  selectEl.value = value;
}

// =============================================================
//  TABS HANDLER
// =============================================================
document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {

        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

        btn.classList.add("active");
        document.getElementById(btn.dataset.tab).classList.add("active");
    });
});

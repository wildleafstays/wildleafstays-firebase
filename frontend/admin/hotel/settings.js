// ============================================================================
//  AUTH & CONTEXT
// ============================================================================
import { authHeaders, secureFetch, logout } from "../auth.js";
import { requireHotelContext } from "../hotelContext.js";

const { id: currentHotelId } = requireHotelContext();


// 🚫 Block if not logged in
authHeaders();

// ============================================================================
//  DOM REFERENCES
// ============================================================================

const hotelName = document.getElementById("hotelName");
const hotelCity = document.getElementById("hotelCity");
const hotelAddress = document.getElementById("hotelAddress");
const hotelDescription = document.getElementById("hotelDescription");
const hotelArchitecture = document.getElementById("hotelArchitecture");
const hotelTagline = document.getElementById("hotelTagline");
const hotelVillaTagline = document.getElementById("hotelVillaTagline");
const hotelFullVilla = document.getElementById("hotelFullVilla");


const saveHotelBtn = document.getElementById("saveHotelBtn");
const deleteHotelBtn = document.getElementById("deleteHotelBtn");

const uploadHotelImageBtn = document.getElementById("uploadHotelImageBtn");
const hotelImageInput = document.getElementById("hotelImageInput");
const hotelImagesGrid = document.getElementById("hotelImagesGrid");

const hotelInfoSection = document.getElementById("hotelInfoSection");
const hotelImagesSection = document.getElementById("hotelImagesSection");
const roomCategoriesSection = document.getElementById("roomCategoriesSection");

const roomCategoryCards = document.getElementById("roomCategoryCards");
const addRoomCard = document.getElementById("addRoomCard");

const roomModal = document.getElementById("roomModal");
const roomModalOverlay = document.getElementById("roomModalOverlay");
const closeRoomModal = document.getElementById("closeRoomModal");
const cancelRoomBtn = document.getElementById("cancelRoomBtn");
const saveRoomBtn = document.getElementById("saveRoomBtn");
const modalTitle = document.getElementById("modalTitle");
const roomForm = document.getElementById("roomForm");

const addRoomImagesBtn = document.getElementById("addRoomImagesBtn");
const roomImageInput = document.getElementById("roomImageInput");
const roomImagePreview = document.getElementById("roomImagePreview");

const deleteHotelModal = document.getElementById("deleteHotelModal");
const deleteHotelOverlay = document.getElementById("deleteHotelOverlay");
const confirmDeleteHotel = document.getElementById("confirmDeleteHotel");
const cancelDeleteHotel = document.getElementById("cancelDeleteHotel");
const closeDeleteModal = document.getElementById("closeDeleteModal");

const roomCategoryName = document.getElementById("roomCategoryName");
const roomDescription = document.getElementById("roomDescription");
const roomPrice = document.getElementById("roomPrice");
const roomGST = document.getElementById("roomGST");
const roomMaxRooms = document.getElementById("roomMaxRooms");


// === HOTEL FORM FIELDS ===
const hotelCheckInTime = document.getElementById("hotelCheckInTime");
const hotelCheckOutTime = document.getElementById("hotelCheckOutTime");
const hotelMaxGuests = document.getElementById("hotelMaxGuests");
const hotelBathrooms = document.getElementById("hotelBathrooms");

// === RULES / FEATURES (sample – you can expand later)
const ruleSmoking = document.getElementById("ruleSmoking");
const rulePets = document.getElementById("rulePets");
const ruleParties = document.getElementById("ruleParties");
const loudMusicAllowed = document.getElementById("loudMusicAllowed");

// === FOOD / KITCHEN ===
const kitchenAvailable = document.getElementById("kitchenAvailable");
const restaurantAvailable = document.getElementById("restaurantAvailable");
const roomService = document.getElementById("roomService");
const inhouseChef = document.getElementById("inhouseChef");
const cafeAvailable = document.getElementById("cafeAvailable");
const outdoorDining = document.getElementById("outdoorDining");
const bbqAvailable = document.getElementById("bbqAvailable");
const breakfastIncluded = document.getElementById("breakfastIncluded");

// === SAFETY ===
const cctv = document.getElementById("cctv");
const fireExtinguishers = document.getElementById("fireExtinguishers");
const firstAid = document.getElementById("firstAid");
const securityGuard = document.getElementById("securityGuard");
const emergencyExit = document.getElementById("emergencyExit");

// === POWER ===
const powerBackup = document.getElementById("powerBackup");
const hotWater = document.getElementById("hotWater");
const solarWaterHeating = document.getElementById("solarWaterHeating");
const heatingAvailable = document.getElementById("heatingAvailable");
const waterPurifier = document.getElementById("waterPurifier");

// === PARKING ===
const parkingAvailable = document.getElementById("parkingAvailable");
const coveredParking = document.getElementById("coveredParking");
const valetService = document.getElementById("valetService");
const evCharging = document.getElementById("evCharging");
const taxiOnCall = document.getElementById("taxiOnCall");

// === VIEWS & FEATURES ===
const lawnGarden = document.getElementById("lawnGarden");
const terrace = document.getElementById("terrace");
const privateVillaMode = document.getElementById("privateVillaMode");
const mountainView = document.getElementById("mountainView");
const valleyView = document.getElementById("valleyView");
const forestView = document.getElementById("forestView");
const outdoorSeating = document.getElementById("outdoorSeating");
const bonfireArea = document.getElementById("bonfireArea");
const swimmingPool = document.getElementById("swimmingPool");
const kidsPlayArea = document.getElementById("kidsPlayArea");

// === NEARBY ===
const hotelNearbyAttractions = document.getElementById("hotelNearbyAttractions");

// ============================================================================
//  CONFIG
// ============================================================================
const API = "/api";

let editingRoomId = null;
let roomImagesTemp = [];
let existingRoomImages = [];


document.addEventListener("DOMContentLoaded", () => {
 // HOTEL BUTTONS
  saveHotelBtn.addEventListener("click", saveHotel);
  deleteHotelBtn.addEventListener("click", openDeleteHotelModal);

  // HOTEL IMAGES
  uploadHotelImageBtn.addEventListener("click", () => hotelImageInput.click());
  hotelImageInput.addEventListener("change", uploadHotelImages);

  // ROOMS
  addRoomCard.addEventListener("click", openNewRoomModal);
  closeRoomModal.addEventListener("click", closeRoomModalFn);
  cancelRoomBtn.addEventListener("click", closeRoomModalFn);
  saveRoomBtn.addEventListener("click", saveRoomCategory);

  addRoomImagesBtn.addEventListener("click", () => roomImageInput.click());
  roomImageInput.addEventListener("change", previewRoomImages);

  // DELETE HOTEL MODAL
  confirmDeleteHotel.addEventListener("click", deleteHotel);
  cancelDeleteHotel.addEventListener("click", closeDeleteHotelModal);
  closeDeleteModal.addEventListener("click", closeDeleteHotelModal);

 // ============================
  // COLLAPSIBLE CARD LOGIC
  // ============================
  document.querySelectorAll(".collapse-header").forEach(header => {
  header.addEventListener("click", () => {
    const targetId = header.dataset.target;
    const body = document.querySelector(targetId);
    const arrow = header.querySelector(".arrow");

    if (!body) return;

    body.classList.toggle("open");
    arrow?.classList.toggle("rotated");
  });
});

  // ============================
  // INITIAL LOAD
  // ============================
  loadHotelDetails(currentHotelId);

 // ✅ VILLA MODE TOGGLE — EXACT PLACE
  hotelFullVilla.addEventListener("change", toggleVillaModeFields);
  toggleVillaModeFields();
});


// ============================================================================
//  LOAD HOTEL DETAILS
// ============================================================================
function loadHotelDetails(id) {
 secureFetch(`${API}/hotels/${id}`)
    .then(res => res.json())
    .then(h => {
      fillHotelForm(h);
      loadHotelImages(h.images || []);
      loadRoomCategoryCards(h.rooms || []);

      hotelInfoSection.classList.remove("hidden");
      hotelImagesSection.classList.remove("hidden");
      roomCategoriesSection.classList.remove("hidden");

    });
}

function fillHotelForm(h) {
  // BASIC
  hotelName.value = h.name || "";
  hotelCity.value = h.city || "";
  hotelAddress.value = h.address || "";
  hotelDescription.value = h.description || "";
  hotelArchitecture.value = h.architecture || "";
  hotelTagline.value = h.tagline || "";
  hotelVillaTagline.value = h.villa_tagline || "";
  hotelFullVilla.checked = h.full_villa == 1;

  hotelCheckInTime.value = h.check_in_time || "";
  hotelCheckOutTime.value = h.check_out_time || "";
  hotelMaxGuests.value = h.max_guests || "";
  hotelBathrooms.value = h.bathrooms || "";

  // HOUSE RULES
  ruleSmoking.checked = h.rule_smoking == 1;
  rulePets.checked = h.rule_pets == 1;
  ruleParties.checked = h.rule_parties == 1;
  loudMusicAllowed.checked = h.loud_music_allowed == 1;

  // FOOD / KITCHEN
  kitchenAvailable.checked = h.kitchen_available == 1;
  restaurantAvailable.checked = h.restaurant_available == 1;
  roomService.checked = h.room_service == 1;
  inhouseChef.checked = h.inhouse_chef == 1;
  cafeAvailable.checked = h.cafe_available == 1;
  outdoorDining.checked = h.outdoor_dining == 1;
  bbqAvailable.checked = h.bbq_available == 1;
  breakfastIncluded.value = h.breakfast_included || "no";

  // SAFETY
  cctv.checked = h.cctv == 1;
  fireExtinguishers.checked = h.fire_extinguishers == 1;
  firstAid.checked = h.first_aid == 1;
  securityGuard.checked = h.security_guard == 1;
  emergencyExit.checked = h.emergency_exit == 1;

  // POWER
  powerBackup.checked = h.power_backup == 1;
  hotWater.checked = h.hot_water == 1;
  solarWaterHeating.checked = h.solar_water_heating == 1;
  heatingAvailable.checked = h.heating_available == 1;
  waterPurifier.value = h.water_purifier || "none";

  // PARKING
  parkingAvailable.checked = h.parking_available == 1;
  coveredParking.checked = h.covered_parking == 1;
  valetService.checked = h.valet_service == 1;
  evCharging.checked = h.ev_charging == 1;
  taxiOnCall.checked = h.taxi_on_call == 1;

  // VIEWS
  lawnGarden.checked = h.lawn_garden == 1;
  terrace.checked = h.terrace == 1;
  privateVillaMode.checked = h.private_villa_mode == 1;
  mountainView.checked = h.mountain_view == 1;
  valleyView.checked = h.valley_view == 1;
  forestView.checked = h.forest_view == 1;
  outdoorSeating.checked = h.outdoor_seating == 1;
  bonfireArea.checked = h.bonfire_area == 1;
  swimmingPool.checked = h.swimming_pool == 1;
  kidsPlayArea.checked = h.kids_play_area == 1;

  // NEARBY
  hotelNearbyAttractions.value = Array.isArray(h.nearby_attractions)
    ? h.nearby_attractions.join(", ")
    : (h.nearby_attractions || "");
}


function toggleVillaModeFields() {
  const box = document.getElementById("villaModeFields");
  if (!box) return;

  box.classList.toggle("hidden", !hotelFullVilla.checked);
}


// ============================================================================
//  SAVE HOTEL (CREATE + UPDATE)
// ============================================================================
function saveHotel() {

  const payload = {
    name: hotelName.value,
    city: hotelCity.value,
    address: hotelAddress.value,
    description: hotelDescription.value,
    
    

    architecture: hotelArchitecture.value,
    tagline: hotelTagline.value,
    villa_tagline: hotelVillaTagline.value,
    full_villa: hotelFullVilla.checked ? 1 : 0,

    check_in_time: hotelCheckInTime.value,
    check_out_time: hotelCheckOutTime.value,
    max_guests: Number(hotelMaxGuests.value),
    bathrooms: Number(hotelBathrooms.value),

    // HOUSE RULES
    rule_smoking: ruleSmoking.checked ? 1 : 0,
    rule_pets: rulePets.checked ? 1 : 0,
    rule_parties: ruleParties.checked ? 1 : 0,
    loud_music_allowed: loudMusicAllowed.checked ? 1 : 0,

    // FOOD
    kitchen_available: kitchenAvailable.checked ? 1 : 0,
    restaurant_available: restaurantAvailable.checked ? 1 : 0,
    room_service: roomService.checked ? 1 : 0,
    inhouse_chef: inhouseChef.checked ? 1 : 0,
    cafe_available: cafeAvailable.checked ? 1 : 0,
    outdoor_dining: outdoorDining.checked ? 1 : 0,
    bbq_available: bbqAvailable.checked ? 1 : 0,
    breakfast_included: breakfastIncluded.value,

    // SAFETY
    cctv: cctv.checked ? 1 : 0,
    fire_extinguishers: fireExtinguishers.checked ? 1 : 0,
    first_aid: firstAid.checked ? 1 : 0,
    security_guard: securityGuard.checked ? 1 : 0,
    emergency_exit: emergencyExit.checked ? 1 : 0,

    // POWER
    power_backup: powerBackup.checked ? 1 : 0,
    hot_water: hotWater.checked ? 1 : 0,
    solar_water_heating: solarWaterHeating.checked ? 1 : 0,
    heating_available: heatingAvailable.checked ? 1 : 0,
    water_purifier: waterPurifier.value,

    // PARKING
    parking_available: parkingAvailable.checked ? 1 : 0,
    covered_parking: coveredParking.checked ? 1 : 0,
    valet_service: valetService.checked ? 1 : 0,
    ev_charging: evCharging.checked ? 1 : 0,
    taxi_on_call: taxiOnCall.checked ? 1 : 0,

    // VIEWS
    lawn_garden: lawnGarden.checked ? 1 : 0,
    terrace: terrace.checked ? 1 : 0,
    private_villa_mode: privateVillaMode.checked ? 1 : 0,
    mountain_view: mountainView.checked ? 1 : 0,
    valley_view: valleyView.checked ? 1 : 0,
    forest_view: forestView.checked ? 1 : 0,
    outdoor_seating: outdoorSeating.checked ? 1 : 0,
    bonfire_area: bonfireArea.checked ? 1 : 0,
    swimming_pool: swimmingPool.checked ? 1 : 0,
    kids_play_area: kidsPlayArea.checked ? 1 : 0,

    // ATTRACTIONS (JSON ARRAY)
    nearby_attractions:
      hotelNearbyAttractions.value
        .split(",")
        .map(a => a.trim())
        .filter(a => a.length > 0)
  };

 secureFetch(`${API}/hotels/${currentHotelId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
.then(() => {
  alert("Hotel Updated");
  loadHotelDetails(currentHotelId);
});
}

// ============================================================================
//  DELETE HOTEL
// ============================================================================
function openDeleteHotelModal() {
  deleteHotelModal.classList.remove("hidden");
  deleteHotelOverlay.classList.remove("hidden");
}

function closeDeleteHotelModal() {
  deleteHotelModal.classList.add("hidden");
  deleteHotelOverlay.classList.add("hidden");
}

function deleteHotel() {
  secureFetch(`${API}/hotels/${currentHotelId}`, { method: "DELETE" })
    .then(() => {
      alert("Hotel Deleted");
      closeDeleteHotelModal();
      window.location.href = "/admin/admin.html";
    });
}




// ============================================================================
//  HOTEL IMAGES
// ============================================================================
function loadHotelImages(images) {
  hotelImagesGrid.innerHTML = "";

  images.forEach(img => {
    const div = document.createElement("div");
    div.className = "preview-img-container";

    div.innerHTML = `
      <img src="${img.image_url}">
      <span class="preview-delete" onclick="deleteHotelImage(${img.id})">×</span>
    `;

    hotelImagesGrid.appendChild(div);
  });
}

function uploadHotelImages(e) {
  [...e.target.files].forEach(file => {
    const fd = new FormData();
    fd.append("image", file);

    secureFetch(`${API}/hotels/${currentHotelId}/images`, {
      method: "POST",
      body: fd
    })
    .then(() => loadHotelDetails(currentHotelId));
  });
}

function deleteHotelImage(id) {
  if (!confirm("Are you sure you want to permanently delete this hotel image?")) {
    return;
  }

  secureFetch(`${API}/hotels/images/${id}`, { method: "DELETE" })
    .then(() => {
      // Reload hotel data to refresh images cleanly
      loadHotelDetails(currentHotelId);
    });
}

// 🔥 REQUIRED for inline onclick usage
window.deleteHotelImage = deleteHotelImage;





// ============================================================================
//  ROOM CATEGORIES
// ============================================================================
function loadRoomCategoryCards(rooms) {
  roomCategoryCards.innerHTML = "";

  rooms.forEach(r => {
    const img = r.main_image
      ? `${r.main_image}`
      : "https://via.placeholder.com/400x250?text=No+Image";

    const card = document.createElement("div");
    card.className = "room-card";

    card.innerHTML = `
      <img src="${img}">
      <div class="room-card-details">
        <h3>${r.category}</h3>
        
        <p><b>Rooms:</b> ${r.max_rooms}</p>

<p><b>Chargeable Kid Age:</b> ${r.kid_chargeable_age}+</p>
<p><b>Extra Adult:</b> ₹${r.extra_adult_price}</p>
<p><b>Extra Kid:</b> ₹${r.extra_kid_price}</p>


        <div class="button-row">
          <button class="btn-primary" onclick="editRoom(${r.id})">Edit</button>
          <button class="btn-danger" onclick="deleteRoom(${r.id})">Delete</button>
        </div>
      </div>
    `;

    roomCategoryCards.appendChild(card);
  });
}



// ============================================================================
//  ROOM MODAL
// ============================================================================
function openNewRoomModal() {
  editingRoomId = null;
  roomImagesTemp = [];
  existingRoomImages = [];

  modalTitle.textContent = "Add New Room Category";
  roomForm.reset();
  roomImagePreview.innerHTML = "";
document.getElementById("roomNames").value = "";

  openRoomModal();
}

function editRoom(id) {
  editingRoomId = id;
  roomImagesTemp = [];

  secureFetch(`${API}/hotels/${currentHotelId}`)
    .then(res => res.json())
    .then(h => {
      const r = h.rooms.find(x => x.id === id);

      modalTitle.textContent = "Edit Room Category";

      roomCategoryName.value = r.category;
      roomDescription.value = r.description || "";
      roomPrice.value = r.price;
      roomGST.value = r.gst;
      roomMaxRooms.value = r.max_rooms;
      



roomKidChargeableAge.value = r.kid_chargeable_age || 5;

roomExtraAdultPrice.value = r.extra_adult_price || 0;
roomExtraKidPrice.value = r.extra_kid_price || 0;

roomMaxGuests.value = r.max_guests || 3;
roomBaseAdults.value = r.base_included_adults || 2;

roomBeds.value = r.beds || 1;
roomBathrooms.value = r.bathrooms || 1;
roomSize.value = r.room_size || "";


      roomBedSize.value = r.bed_size || "";
      roomViewType.value = r.view_type || "";

      secureFetch(`${API}/rooms/${id}/images`)
        .then(res => res.json())
        .then(imgs => {
          existingRoomImages = imgs;
          renderExistingRoomImages();
        });


// ==========================================
// LOAD EXISTING PHYSICAL ROOM NAMES
// ==========================================
secureFetch(`${API}/rooms/by-category/${id}`)
  .then(res => res.json())
  .then(names => {
    document.getElementById("roomNames").value = names.join("\n");
  })
  .catch(() => {
    document.getElementById("roomNames").value = "";
  });

      openRoomModal();
    });
}

function openRoomModal() {
  roomModal.classList.remove("hidden");
  roomModalOverlay.classList.remove("hidden");
}

function closeRoomModalFn() {
  roomModal.classList.add("hidden");
  roomModalOverlay.classList.add("hidden");
}



// ============================================================================
//  ROOM IMAGES MANAGEMENT
// ============================================================================

function renderExistingRoomImages() {
  roomImagePreview.innerHTML = "";

  existingRoomImages.forEach(img => {
    const div = document.createElement("div");
    div.className = "preview-img-container";

    div.innerHTML = `
      <img src="${img.image_url}">
      
      <span class="preview-delete"
            onclick="deleteExistingRoomImage(${img.id})">×</span>

      ${
        img.is_main
          ? `<span class="main-badge">Main</span>`
          : `<button class="make-main-btn"
                    onclick="makeRoomImageMain('${img.image_url}')">
               Make Main
             </button>`
      }
    `;

    roomImagePreview.appendChild(div);
  });
}

function deleteExistingRoomImage(id) {
  const img = existingRoomImages.find(i => i.id === id);

  if (!img) return;

  // 🛑 Optional but STRONGLY recommended safety
  if (img.is_main) {
    alert("You cannot delete the main image. Please set another image as main first.");
    return;
  }

  if (!confirm("Are you sure you want to permanently delete this image?")) {
    return;
  }

  secureFetch(`${API}/rooms/images/${id}`, { method: "DELETE" })
    .then(() => {
      // reload images cleanly
      secureFetch(`${API}/rooms/${editingRoomId}/images`)
        .then(res => res.json())
        .then(imgs => {
          existingRoomImages = imgs;
          renderExistingRoomImages();
        });
    });
}

// 🔥 REQUIRED for inline onclick
window.deleteExistingRoomImage = deleteExistingRoomImage;


function previewRoomImages(e) {
  [...e.target.files].forEach(f => roomImagesTemp.push(f));
  renderTempImages();
}

function renderTempImages() {
  roomImagePreview.innerHTML = "";
  renderExistingRoomImages();

  roomImagesTemp.forEach((file, index) => {
    const reader = new FileReader();
    reader.onload = e => {
      const div = document.createElement("div");
      div.className = "preview-img-container";

      div.innerHTML = `
        <img src="${e.target.result}">
        <span class="preview-delete" onclick="removeTempImage(${index})">×</span>
      `;

      roomImagePreview.appendChild(div);
    };
    reader.readAsDataURL(file);
  });
}

function removeTempImage(i) {
  roomImagesTemp.splice(i, 1);
  renderTempImages();
}

function makeRoomImageMain(imageUrl) {
  if (!confirm("Set this image as the main image?")) return;

  secureFetch(`${API}/rooms/set-main-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: editingRoomId,
      imageUrl
    })
  })
    .then(() => secureFetch(`${API}/rooms/${editingRoomId}/images`))
    .then(res => res.json())
    .then(imgs => {
      existingRoomImages = imgs;
      renderExistingRoomImages();
    })
    .catch(() => alert("Failed to set main image"));
}


// 🔥 REQUIRED because onclick is inline
window.makeRoomImageMain = makeRoomImageMain;



// ============================================================================
//  SAVE ROOM CATEGORY
// ============================================================================
function saveRoomCategory() {
const roomNames = document.getElementById("roomNames")
  ?.value
  ?.split("\n")
  .map(r => r.trim())
  .filter(r => r.length > 0) || [];

  // 🚫  GUARD: do not exceed max_rooms
  const maxRooms = Number(roomMaxRooms.value);

  if (roomNames.length > maxRooms) {
    alert(`You can define maximum ${maxRooms} rooms`);
    return;
  }

 const payload = {
  category: roomCategoryName.value,
  description: roomDescription.value,
  price: Number(roomPrice.value),
  gst: Number(roomGST.value),
  max_rooms: Number(roomMaxRooms.value),
  max_guests: Number(roomMaxGuests.value),
  base_included_adults: Number(roomBaseAdults.value),
  kid_chargeable_age: Number(roomKidChargeableAge.value),
  extra_adult_price: Number(roomExtraAdultPrice.value),
  extra_kid_price: Number(roomExtraKidPrice.value),
  beds: Number(roomBeds.value),
  bathrooms: Number(roomBathrooms.value),
  room_size: roomSize.value,
  bed_size: roomBedSize.value,
  view_type: roomViewType.value,
  roomNames: roomNames

};

  // CREATE
  if (!editingRoomId) {
    secureFetch(`${API}/hotels/${currentHotelId}/rooms`, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
     .then(data => {

  const roomCategoryId = data.roomCategoryId || data.id;

  
  uploadRoomImages(roomCategoryId);
});

  }

  // UPDATE
  else {
    secureFetch(`${API}/rooms/${editingRoomId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
    .then(() => uploadRoomImages(editingRoomId));
  }
}   // ← ← ← THIS WAS MISSING


function uploadRoomImages(roomId) {
  if (roomImagesTemp.length === 0) {
    alert("Saved");
    closeRoomModalFn();
    loadHotelDetails(currentHotelId);

    return;
  }

  roomImagesTemp.forEach(file => {
    const fd = new FormData();
    fd.append("image", file);

    secureFetch(`${API}/rooms/${roomId}/images`, {
      method:"POST",
      body: fd
    });
  });

  setTimeout(() => {
    alert("Room saved");
    closeRoomModalFn();
    loadHotelDetails(currentHotelId);

  }, 400);
}



// ============================================================================
//  DELETE ROOM CATEGORY
// ============================================================================
function deleteRoom(id) {
  if (!confirm("Delete room category?")) return;

  secureFetch(`${API}/rooms/${id}`, { method:"DELETE" })
    .then(() => loadHotelDetails(currentHotelId));
}

// ============================================================
//  EXPOSE FUNCTIONS FOR INLINE HTML (REQUIRED FOR MODULES)
// ============================================================

window.editRoom = editRoom;
window.deleteRoom = deleteRoom;
window.deleteHotelImage = deleteHotelImage;
window.deleteExistingRoomImage = deleteExistingRoomImage;

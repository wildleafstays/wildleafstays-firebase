const auth = firebase.auth();
const storage = firebase.storage();

const FACILITIES = ["Pool", "Kitchen", "Restaurant", "Spa", "Parking", "Power backup", "WiFi", "Pet friendly", "Bonfire", "Garden", "Room service", "Caretaker", "Mountain view", "Lake view"];
const AMENITIES = ["Air conditioning", "Heater", "TV", "Mini fridge", "Tea/Coffee maker", "Hot water", "Wardrobe", "Balcony", "Work desk", "Safe", "Hair dryer"];

const loginView = document.querySelector("#loginView");
const adminApp = document.querySelector("#adminApp");
const loginForm = document.querySelector("#loginForm");
const loginMessage = document.querySelector("#loginMessage");
const messageEl = document.querySelector("#message");
const propertyForm = document.querySelector("#propertyForm");
const roomForm = document.querySelector("#roomForm");
const inventoryForm = document.querySelector("#inventoryForm");
const homepageForm = document.querySelector("#homepageForm");
const propertySelect = document.querySelector("#propertySelect");
const inventoryProperty = document.querySelector("#inventoryProperty");
const inventoryRoom = document.querySelector("#inventoryRoom");

let idToken = "";
let properties = [];
let roomCategories = {};

renderCheckList("propertyFacilities", FACILITIES, "facilities");
renderCheckList("propertyAmenities", AMENITIES, "amenities");
renderCheckList("roomAmenities", AMENITIES, "amenities");
wireTabs();
wireUploads();

auth.onAuthStateChanged(async user => {
  if (!user) {
    loginView.classList.remove("hidden");
    adminApp.classList.add("hidden");
    return;
  }
  idToken = await user.getIdToken();
  loginView.classList.add("hidden");
  adminApp.classList.remove("hidden");
  await refreshAll();
});

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(loginForm);
  try {
    await auth.signInWithEmailAndPassword(data.get("email"), data.get("password"));
  } catch (err) {
    loginMessage.textContent = err.message;
  }
});

document.querySelector("#logoutBtn").addEventListener("click", () => auth.signOut());
document.querySelector("#refreshBtn").addEventListener("click", refreshAll);

propertyForm.addEventListener("submit", async event => {
  event.preventDefault();
  const formData = new FormData(propertyForm);
  const id = formData.get("id");
  const body = formBody(formData);
  body.sellAsFullVilla = formData.has("sellAsFullVilla");
  body.facilities = checkedValues("propertyFacilities");
  body.amenities = checkedValues("propertyAmenities");
  body.photos = csvArray(body.photos);
  body.gstPercent = Number(body.gstPercent || 0);
  body.infantMaxAge = Number(body.infantMaxAge || 2);

  await adminFetch(id ? `/api/admin/properties/${id}` : "/api/admin/properties", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(body)
  });
  propertyForm.reset();
  clearChecks("propertyFacilities");
  clearChecks("propertyAmenities");
  document.querySelector("#propertyPhotoPreview").innerHTML = "";
  await refreshAll();
});

roomForm.addEventListener("submit", async event => {
  event.preventDefault();
  const formData = new FormData(roomForm);
  const propertyId = formData.get("propertyId");
  const id = formData.get("id");
  const body = formBody(formData);
  delete body.propertyId;
  body.photos = csvArray(body.photos);
  body.amenities = checkedValues("roomAmenities");
  ["totalRooms", "basePrice", "gstPercent", "maxGuests", "includedGuests", "extraAdultRate", "extraKidRate"].forEach(key => {
    body[key] = Number(body[key] || 0);
  });

  await adminFetch(id
    ? `/api/admin/properties/${propertyId}/roomCategories/${id}`
    : `/api/admin/properties/${propertyId}/roomCategories`, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(body)
    });
  roomForm.reset();
  clearChecks("roomAmenities");
  document.querySelector("#roomPhotoPreview").innerHTML = "";
  await refreshAll();
});

inventoryForm.addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(inventoryForm);
  const propertyId = data.get("propertyId");
  const body = formBody(data);
  body.manuallyClosed = data.has("manuallyClosed");
  body.price = body.price === "" ? "" : Number(body.price);
  body.availableRooms = body.availableRooms === "" ? "" : Number(body.availableRooms);
  await adminFetch(`/api/admin/properties/${propertyId}/inventory`, {
    method: "PUT",
    body: JSON.stringify(body)
  });
  await loadInventory();
});

homepageForm.addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(homepageForm);
  const sectionId = data.get("sectionId");
  const body = formBody(data);
  delete body.sectionId;
  body.active = data.has("active");
  body.order = Number(body.order || 0);
  await adminFetch(`/api/admin/homepage/${sectionId}`, {
    method: "PUT",
    body: JSON.stringify(body)
  });
  homepageForm.reset();
  await loadHomepage();
});

inventoryProperty.addEventListener("change", async () => {
  await populateInventoryRooms();
  await loadInventory();
});

async function refreshAll() {
  await loadProperties();
  await loadRooms();
  await loadInventory();
  await loadBookings();
  await loadHomepage();
  messageEl.textContent = "Loaded.";
}

async function loadProperties() {
  const data = await adminFetch("/api/admin/properties");
  properties = (data.properties || []).filter(property => property.status !== "deleted");
  const options = properties.map(property => `<option value="${property.id}">${escapeHtml(property.name)}</option>`).join("");
  propertySelect.innerHTML = options;
  inventoryProperty.innerHTML = options;
  document.querySelector("#properties").innerHTML = properties.map(property => `
    <div class="item-row">
      <div>
        <strong>${escapeHtml(property.name)}</strong>
        <span>${escapeHtml(property.destination || "")}</span>
        <small>${property.sellAsFullVilla ? "Villa enabled" : "Rooms only"} · GST ${Number(property.gstPercent || 0)}%</small>
      </div>
      <div class="row-actions">
        <button type="button" class="secondary" onclick="editProperty('${property.id}')">Edit</button>
        <button type="button" class="danger" onclick="deleteProperty('${property.id}')">Delete</button>
      </div>
    </div>
  `).join("") || "<p class=\"muted\">No properties yet.</p>";
}

async function loadRooms() {
  roomCategories = {};
  for (const property of properties) {
    const data = await adminFetch(`/api/admin/properties/${property.id}/roomCategories`);
    roomCategories[property.id] = data.roomCategories || [];
  }
  await populateInventoryRooms();
  renderRooms();
}

function renderRooms() {
  document.querySelector("#roomsList").innerHTML = properties.map(property => `
    <h3>${escapeHtml(property.name)}</h3>
    ${(roomCategories[property.id] || []).map(room => `
      <div class="item-row">
        <div>
          <strong>${escapeHtml(room.name)}</strong>
          <span>${room.totalRooms} rooms · Rs ${formatMoney(room.basePrice)} · Max ${room.maxGuests} guests</span>
          <small>GST ${Number(room.gstPercent || 0)}%</small>
        </div>
        <div class="row-actions">
          <button type="button" class="secondary" onclick="editRoom('${property.id}', '${room.id}')">Edit</button>
          <button type="button" class="danger" onclick="deleteRoom('${property.id}', '${room.id}')">Delete</button>
        </div>
      </div>
    `).join("") || "<p class=\"muted\">No room categories.</p>"}
  `).join("");
}

async function populateInventoryRooms() {
  const propertyId = inventoryProperty.value || properties[0]?.id;
  const rooms = roomCategories[propertyId] || [];
  inventoryRoom.innerHTML = rooms.map(room => `<option value="${room.id}">${escapeHtml(room.name)}</option>`).join("");
}

async function loadInventory() {
  const propertyId = inventoryProperty.value;
  if (!propertyId) return;
  const start = inventoryForm.start.value || dateValue(new Date());
  const endDate = new Date(`${start}T00:00:00`);
  endDate.setDate(endDate.getDate() + 7);
  const end = inventoryForm.end.value || dateValue(endDate);
  inventoryForm.start.value = start;
  inventoryForm.end.value = end;

  const data = await adminFetch(`/api/admin/properties/${propertyId}/inventory?start=${start}&end=${end}`);
  document.querySelector("#inventoryTable").innerHTML = `
    <h2>Next Dates</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th>${data.roomCategories.map(room => `<th>${escapeHtml(room.name)}</th>`).join("")}</tr></thead>
        <tbody>
          ${data.days.map(day => `
            <tr>
              <td>${day.date}</td>
              ${data.roomCategories.map(room => {
                const item = day.roomCategories?.[room.id] || {};
                return `<td>Rs ${formatMoney(item.price || room.basePrice)}<br>${item.availableRooms ?? room.totalRooms} available</td>`;
              }).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function loadBookings() {
  const data = await adminFetch("/api/admin/bookings?limit=100");
  document.querySelector("#bookingsList").innerHTML = `
    <h2>Bookings</h2>
    ${(data.bookings || []).map(booking => `
      <div class="item-row">
        <div>
          <strong>${escapeHtml(booking.propertyName || booking.propertyId)}</strong>
          <span>${booking.checkIn} to ${booking.checkOut} · ${booking.bookingType}</span>
          <small>${escapeHtml(booking.guest?.name || "")} · ${booking.bookingStatus} · Rs ${formatMoney(booking.totalAmount)}</small>
        </div>
      </div>
    `).join("") || "<p class=\"muted\">No bookings yet.</p>"}
  `;
}

async function loadHomepage() {
  const data = await adminFetch("/api/admin/homepage");
  document.querySelector("#homepageList").innerHTML = `
    <h2>Home Sections</h2>
    ${(data.sections || []).map(section => `
      <div class="item-row">
        <div>
          <strong>${escapeHtml(section.title || section.id)}</strong>
          <span>${escapeHtml(section.subtitle || "")}</span>
          <small>${section.active ? "Active" : "Hidden"} · order ${section.order || 0}</small>
        </div>
      </div>
    `).join("") || "<p class=\"muted\">No homepage sections yet.</p>"}
  `;
}

async function editProperty(id) {
  const property = properties.find(item => item.id === id);
  fillForm(propertyForm, property);
  propertyForm.photos.value = (property.photos || []).join(",");
  renderPreview("propertyPhotoPreview", property.photos || []);
  setChecks("propertyFacilities", property.facilities || []);
  setChecks("propertyAmenities", property.amenities || []);
  showTab("properties");
}

async function deleteProperty(id) {
  if (!confirm("Delete this property from customer search?")) return;
  await adminFetch(`/api/admin/properties/${id}`, { method: "DELETE" });
  await refreshAll();
}

function editRoom(propertyId, roomId) {
  const room = (roomCategories[propertyId] || []).find(item => item.id === roomId);
  fillForm(roomForm, { ...room, propertyId });
  roomForm.photos.value = (room.photos || []).join(",");
  renderPreview("roomPhotoPreview", room.photos || []);
  setChecks("roomAmenities", room.amenities || []);
  showTab("rooms");
}

async function deleteRoom(propertyId, roomId) {
  if (!confirm("Delete this room category?")) return;
  await adminFetch(`/api/admin/properties/${propertyId}/roomCategories/${roomId}`, { method: "DELETE" });
  await refreshAll();
}

function wireTabs() {
  document.querySelectorAll(".nav").forEach(button => {
    button.addEventListener("click", () => showTab(button.dataset.tab));
  });
}

function showTab(name) {
  document.querySelectorAll(".nav").forEach(button => button.classList.toggle("active", button.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.add("hidden"));
  document.querySelector(`#${name}Tab`).classList.remove("hidden");
  document.querySelector("#screenTitle").textContent = {
    properties: "Properties",
    rooms: "Rooms",
    inventory: "Inventory & Rates",
    bookings: "Bookings",
    homepage: "Home Page"
  }[name];
}

function wireUploads() {
  document.querySelector("#propertyImages").addEventListener("change", event => uploadFiles(event.target.files, "properties", propertyForm.photos, "propertyPhotoPreview"));
  document.querySelector("#roomImages").addEventListener("change", event => uploadFiles(event.target.files, "rooms", roomForm.photos, "roomPhotoPreview"));
}

async function uploadFiles(files, folder, hiddenInput, previewId) {
  const urls = csvArray(hiddenInput.value);
  for (const file of files) {
    const path = `${folder}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, "-")}`;
    const snap = await storage.ref(path).put(file);
    urls.push(await snap.ref.getDownloadURL());
  }
  hiddenInput.value = urls.join(",");
  renderPreview(previewId, urls);
}

function renderCheckList(elementId, items, name) {
  document.querySelector(`#${elementId}`).innerHTML = items.map(item => `
    <label class="mini-check">
      <input type="checkbox" name="${name}" value="${escapeHtml(item)}">
      ${escapeHtml(item)}
    </label>
  `).join("");
}

function checkedValues(elementId) {
  return Array.from(document.querySelectorAll(`#${elementId} input:checked`)).map(input => input.value);
}

function setChecks(elementId, values) {
  document.querySelectorAll(`#${elementId} input`).forEach(input => {
    input.checked = values.includes(input.value);
  });
}

function clearChecks(elementId) {
  setChecks(elementId, []);
}

function renderPreview(elementId, urls) {
  document.querySelector(`#${elementId}`).innerHTML = urls.map(url => `<img src="${url}" alt="">`).join("");
}

function formBody(formData) {
  return Object.fromEntries(Array.from(formData.entries()).filter(([key]) => key !== "facilities" && key !== "amenities"));
}

function fillForm(form, data) {
  Object.entries(data || {}).forEach(([key, value]) => {
    const field = form.elements[key];
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = Array.isArray(value) ? value.join(",") : value ?? "";
  });
}

async function adminFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function csvArray(value) {
  return String(value || "").split(",").map(item => item.trim()).filter(Boolean);
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

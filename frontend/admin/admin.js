const auth = firebase.auth();

const propertyForm = document.querySelector("#propertyForm");
const roomForm = document.querySelector("#roomForm");
const propertySelect = document.querySelector("#propertySelect");
const propertiesEl = document.querySelector("#properties");
const messageEl = document.querySelector("#message");

let idToken = "";

start();

propertyForm.addEventListener("submit", async event => {
  event.preventDefault();
  const formData = new FormData(propertyForm);
  const body = Object.fromEntries(formData.entries());
  body.sellAsFullVilla = formData.has("sellAsFullVilla");
  body.fullVillaPrice = Number(body.fullVillaPrice || 0);

  await adminFetch("/api/admin/properties", {
    method: "POST",
    body: JSON.stringify(body)
  });

  propertyForm.reset();
  await loadProperties();
});

roomForm.addEventListener("submit", async event => {
  event.preventDefault();
  const formData = new FormData(roomForm);
  const propertyId = formData.get("propertyId");
  const body = Object.fromEntries(formData.entries());
  delete body.propertyId;
  body.totalRooms = Number(body.totalRooms || 0);
  body.basePrice = Number(body.basePrice || 0);
  body.maxGuests = Number(body.maxGuests || 0);

  await adminFetch(`/api/admin/properties/${propertyId}/roomCategories`, {
    method: "POST",
    body: JSON.stringify(body)
  });

  roomForm.reset();
  await loadProperties();
});

async function start() {
  messageEl.innerHTML = `Login as admin to manage properties. <button type="button" onclick="loginWithEmail()">Login</button>`;
  await loadPropertiesPublicFallback();
}

async function loginWithEmail() {
  const email = prompt("Admin email");
  const password = prompt("Admin password");
  const user = await auth.signInWithEmailAndPassword(email, password);
  idToken = await user.user.getIdToken();
  await loadProperties();
}

async function loadProperties() {
  try {
    const data = await adminFetch("/api/admin/properties");
    renderProperties(data.properties || []);
  } catch (err) {
    messageEl.innerHTML = `Admin login required. <button type="button" onclick="loginWithEmail()">Login</button>`;
  }
}

async function loadPropertiesPublicFallback() {
  try {
    await loadProperties();
  } catch {
    renderProperties([]);
  }
}

async function adminFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function renderProperties(properties) {
  propertySelect.innerHTML = properties.map(property => (
    `<option value="${property.id}">${escapeHtml(property.name)}</option>`
  )).join("");

  propertiesEl.innerHTML = properties.length ? properties.map(property => `
    <div class="property-row">
      <strong>${escapeHtml(property.name)}</strong>
      <div class="muted">${escapeHtml(property.destination || "")}</div>
      <div>${property.sellAsFullVilla ? "Full villa enabled" : "Rooms only"}</div>
    </div>
  `).join("") : "<p class=\"muted\">No properties loaded yet.</p>";

  messageEl.textContent = properties.length ? "Loaded from Firebase." : "Create your first property after admin login is connected.";
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

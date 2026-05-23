// tell dashboard this is a global (non-hotel) page
window.parent.postMessage("HIDE_HOTEL_UI", "*");

import { secureFetch } from "../auth.js";

// ====================================================
// CONFIG
// ====================================================
const API = "/api";

// ====================================================
// BRANDING
// ====================================================
async function loadBranding() {
  const res = await secureFetch(`${API}/branding`);
  const d = await res.json();

  brandTitleInput.value = d.site_title || "";

  if (d.logo_url) {
    brandLogoPreview.innerHTML =
      `<img src="${d.logo_url}">`;
  }
}

saveBrandTitleBtn.onclick = async () => {
  await secureFetch(`${API}/branding/title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site_title: brandTitleInput.value.trim() })
  });
  alert("Title updated");
};

uploadLogoBtn.onclick = async () => {
  const f = brandLogoInput.files[0];
  if (!f) return alert("Select file");

  const fd = new FormData();
  fd.append("logo", f);

  const res = await secureFetch(`${API}/branding/logo`, {
    method: "POST",
    body: fd
  });

  const data = await res.json();
  brandLogoPreview.innerHTML =
    `<img src="${data.logo_url}">`;

  alert("Logo updated");
};

// ====================================================
// HERO CONTENT
// ====================================================
async function loadHeroSettings() {
  const res = await secureFetch(`${API}/homepage/settings`);
  const data = await res.json();

  heroGreetingInput.value = data.hero_message || "";
  heroOffersInput.value = Array.isArray(data.hero_offers)
    ? data.hero_offers.join("\n")
    : "";
}

saveHeroSettingsBtn.onclick = async () => {
  const payload = {
    hero_message: heroGreetingInput.value.trim(),
    hero_offers: heroOffersInput.value
      .split("\n")
      .map(o => o.trim())
      .filter(Boolean)
  };

  await secureFetch(`${API}/homepage/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  alert("Hero content updated");
};

// ====================================================
// HOMEPAGE COLLAGE
// ====================================================
async function loadCollage() {
  const res = await secureFetch(`${API}/collage`);
  const list = await res.json();

  collageGrid.innerHTML = "";

  list.forEach(img => {
    const div = document.createElement("div");
    div.innerHTML = `
      <img src="${img.image_url}">
      <button onclick="deleteCollage(${img.id})">Delete</button>
    `;
    collageGrid.appendChild(div);
  });
}

uploadCollageBtn.onclick = async () => {
  const f = collageUploadInput.files[0];
  if (!f) return alert("Select an image");

  const fd = new FormData();
  fd.append("image", f);

  await secureFetch(`${API}/collage/upload`, {
    method: "POST",
    body: fd
  });

  alert("Image uploaded");
  loadCollage();
};

window.deleteCollage = async id => {
  await secureFetch(`${API}/collage/${id}`, { method: "DELETE" });
  loadCollage();
};

// ============================================================================
//  HOMEPAGE SECTIONS (GLOBAL)
// ============================================================================
let allSections = [];

async function loadHomepageSections() {
  const res = await secureFetch(`${API}/homepage/sections`);
  allSections = await res.json();

  homepageSectionsList.innerHTML = "";

  if (!allSections.length) {
    homepageSectionsList.innerHTML =
      `<p class="muted">No homepage sections added yet.</p>`;
    return;
  }

  allSections.forEach(sec => {
    const card = document.createElement("div");
    card.className = "section-item-card";

    card.innerHTML = `
      <h3>${sec.title}</h3>
      <p>Filter: <b>${sec.filter_type}</b></p>
      <div class="section-actions">
        <button onclick="editHomepageSection(${sec.id})">Edit</button>
        <button onclick="deleteHomepageSection(${sec.id})">Delete</button>
      </div>
    `;

    homepageSectionsList.appendChild(card);
  });
}

async function saveHomepageSection() {
  const id = sectionId.value;

  const payload = {
    title: sectionTitle.value.trim(),
    filter_type: sectionFilterType.value,
    card_style: document.querySelector("input[name='cardStyle']:checked").value,
    show_price: showPrice.checked ? 1 : 0,
    show_occupancy: showOccupancy.checked ? 1 : 0,
    show_amenities: showAmenities.checked ? 1 : 0
  };

  if (!payload.title) return alert("Enter section title");

  if (id) {
    await secureFetch(`${API}/homepage/sections/${id}`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
});

  } else {
    await secureFetch(`${API}/homepage/sections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  resetSectionForm();
  loadHomepageSections();
}

window.editHomepageSection = id => {
  const sec = allSections.find(s => s.id == id);
  if (!sec) return;

  sectionId.value = sec.id;
  sectionTitle.value = sec.title;
  sectionFilterType.value = sec.filter_type;
  sectionFilterType.disabled = true;

  // ✅ restore card style
  document
    .querySelectorAll("input[name='cardStyle']")
    .forEach(r => {
      r.checked = r.value === sec.card_style;
    });

  // ✅ restore display options
  showPrice.checked = !!sec.show_price;
  showOccupancy.checked = !!sec.show_occupancy;
  showAmenities.checked = !!sec.show_amenities;
};

window.deleteHomepageSection = async id => {
  if (!confirm("Delete this section?")) return;

  await secureFetch(`${API}/homepage/sections/${id}`, { method: "DELETE" });
  loadHomepageSections();
};

function resetSectionForm() {
  sectionId.value = "";
  sectionTitle.value = "";
  sectionFilterType.disabled = false;
  sectionFilterType.value = "city";
}

// ============================================================================
//  HEADER MENU (GLOBAL)
// ============================================================================
async function loadHeaderMenuAdmin() {
  const res = await secureFetch("/api/header-menu");
  const items = await res.json();

  const tbody = document.getElementById("menuTableBody");
  tbody.innerHTML = "";

  items.forEach(item => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.label}</td>
      <td>${item.url}</td>
      <td>${item.sort_order ?? 0}</td>
      <td>${item.is_active ? "Yes" : "No"}</td>
      <td>
        <button onclick="toggleMenu(${item.id}, ${item.is_active})">
          ${item.is_active ? "Disable" : "Enable"}
        </button>
        <button onclick="deleteMenuItem(${item.id})">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.toggleMenu = async (id, active) => {
  await secureFetch(`/api/admin/header-menu/${id}`, {
    method: "PUT",
    body: JSON.stringify({ is_active: active ? 0 : 1 })
  });
  loadHeaderMenuAdmin();
};

window.deleteMenuItem = async id => {
  if (!confirm("Delete menu item?")) return;

  await secureFetch(`/api/admin/header-menu/${id}`, { method: "DELETE" });
  loadHeaderMenuAdmin();
};

// ====================================================
// INIT
// ====================================================
document.addEventListener("DOMContentLoaded", () => {
  loadBranding();
  loadHeroSettings();
  loadCollage();
  loadHomepageSections();
  loadHeaderMenuAdmin();
// ✅ REQUIRED: wire Save/Add button
  document
    .getElementById("addHomepageSectionBtn")
    .addEventListener("click", saveHomepageSection);
});
// when leaving homepage, restore hotel UI
window.addEventListener("beforeunload", () => {
  window.parent.postMessage("SHOW_HOTEL_UI", "*");
});

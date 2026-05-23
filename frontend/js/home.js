// ============================
// UNIVERSAL DATE HELPERS
// ============================
function toYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ============================
// HOMEPAGE DATE RANGE PICKER (SINGLE SOURCE)
// ============================
let checkIn = null;
let checkOut = null;

function initHomepageDatePicker() {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  flatpickr("#dateRange", {
    mode: "range",
    dateFormat: "d/m/Y",
    minDate: "today",
    allowInput: false,
    defaultDate: [today, tomorrow],

    onClose(selectedDates) {
      if (selectedDates.length === 2) {
        checkIn = toYMD(selectedDates[0]);
        checkOut = toYMD(selectedDates[1]);
      }
    }
  });

  // fallback on first load
  checkIn = toYMD(today);
  checkOut = toYMD(tomorrow);
}



// ============================
// LOAD HERO COLLAGE (MASONRY)
// ============================
async function loadHeroImages() {
  try {
    const res = await fetch("/api/collage");
    const images = await res.json();

    const slider = document.getElementById("heroSlider");
    if (!slider) return; // 🔐 safety guard

    slider.innerHTML = "";

    if (!images.length) return;

    images.forEach((img, index) => {
      const slide = document.createElement("div");
      slide.className = "hero-slide";
      if (index === 0) slide.classList.add("active");

      slide.innerHTML = `
        <img src="${img.image_url}" alt="Hero Image">
      `;

      slider.appendChild(slide);
    });

    // 🔁 Auto slide
    let current = 0;
    const slides = slider.querySelectorAll(".hero-slide");

    setInterval(() => {
      slides[current].classList.remove("active");
      current = (current + 1) % slides.length;
      slides[current].classList.add("active");
    }, 4500);

  } catch (err) {
    console.error("Error loading hero slider:", err);
  }
}


async function loadHeroMessaging() {
  try {
   
    const res = await fetch("/api/branding");
    const data = await res.json();

    /* =========================
       GREETING MESSAGE
    ========================= */
    const msgBox = document.getElementById("heroMessage");
    if (data.hero_message && msgBox) {
      msgBox.textContent = data.hero_message;
      msgBox.style.display = "block";
    } else if (msgBox) {
      msgBox.style.display = "none";
    }

    /* =========================
       FULL SCREEN OFFER SCROLLER
    ========================= */
    if (Array.isArray(data.hero_offers) && data.hero_offers.length) {
      const bar = document.getElementById("heroOfferBar");
      const track = document.getElementById("heroOfferTrack");

      if (!bar || !track) return;

      track.innerHTML = data.hero_offers
        .map(o => `<div class="hero-offer-slide">${o}</div>`)
        .join("");

      bar.style.display = "block";

      let index = 0;
      setInterval(() => {
        index = (index + 1) % data.hero_offers.length;
        track.style.transform = `translateX(-${index * 100}vw)`;
      }, 3500);
    }

  } catch (e) {
    console.warn("Hero messaging not available yet");
  }
}



// ============================
// DOMContentLoaded
// ============================
document.addEventListener("DOMContentLoaded", () => {
  initHomepageDatePicker();
  
  loadHeroImages();
loadHeroMessaging();
  
// ============================
// ADULTS & KIDS DROPDOWN (HOMEPAGE)
// ============================
const adultsSelect = document.getElementById("adults");
const kidsSelect = document.getElementById("kids");

if (adultsSelect && kidsSelect) {

  // Adults: up to 20
  for (let i = 1; i <= 20; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${i} Adult${i > 1 ? "s" : ""}`;
    if (i === 2) opt.selected = true;
    adultsSelect.appendChild(opt);
  }

  // Kids: up to 10
  for (let i = 0; i <= 10; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${i} Kid${i !== 1 ? "s" : ""}`;
    kidsSelect.appendChild(opt);
  }
}

// Load City Dropdown (instead of hotels)
fetch("/api/hotels")
  .then(res => res.json())
  .then(hotels => {
    const select = document.getElementById("citySelect");
    select.innerHTML = '<option value="">Select Location</option>';

    const cities = [...new Set(hotels.map(h => h.city).filter(Boolean))];

    cities.forEach(city => {
      const op = document.createElement("option");
      op.value = city;
      op.textContent = city;
      select.appendChild(op);
    });
  });

  // Search handler
  document.getElementById("searchButton").addEventListener("click", () => {

  const city = document.getElementById("citySelect").value;
  if (!city) return alert("Please select a location first!");

  if (!checkIn || !checkOut) {
    return alert("Please select check-in and check-out dates");
  }

  const adults = document.getElementById("adults").value;
  const kids = document.getElementById("kids").value;

  window.location.href =
    `city.html?city=${encodeURIComponent(city)}&checkIn=${checkIn}&checkOut=${checkOut}&adults=${adults}&kids=${kids}`;
});



  // Load homepage sections
  fetch(`${API}/homepage/render`)
    .then(res => res.json())
    .then(renderHomepageSections)
    .catch(err => console.error("Homepage sections load error:", err));

});


// ==============================
// RENDER HOMEPAGE SECTIONS
// ==============================


function renderHomepageSections(sections) {
  const container = document.getElementById("dynamicSections");
  container.innerHTML = "";

  sections.forEach(section => {

  // 🔍 DEBUG: see what sections are coming from backend
  console.log("SECTION:", section.title, section.filter_type, section.card_style);
    // ⭐ NEW: If style4, use premium slider and SKIP normal card UI
    if (section.card_style === "style4") {
      renderStyle4Slider(section, container);
      return; // VERY IMPORTANT → do not execute normal slider code
    }

    // ⭐ Normal section rendering continues for styles 1, 2, 3
    const sec = document.createElement("div");
    sec.className = "homepage-section";

    // Title
    const headerRow = document.createElement("div");
headerRow.className = "section-header";

const h2 = document.createElement("h2");
h2.textContent = section.title;

headerRow.appendChild(h2);

// View More (only for villas)
if (section.filter_type === "full_villa") {
  const viewMore = document.createElement("a");
  viewMore.href = "full-villa.html";
  viewMore.className = "view-more-btn";
  viewMore.textContent = "All Villas →";
  headerRow.appendChild(viewMore);
}

sec.appendChild(headerRow);




    // Slider
    sec.innerHTML += `
      <div class="slider-container">
        <button class="slide-btn left">‹</button>
        <div class="slider-row"></div>
        <button class="slide-btn right">›</button>
      </div>
    `;

    const row = sec.querySelector(".slider-row");
row.classList.add(section.card_style);


    if (!section.items || !Array.isArray(section.items)) {
      console.warn("Section has no items:", section.title);
      container.appendChild(sec);
      return;
    }

    // Auto-expand cards for 1–3 items
    const itemsCount = section.items.length;
    if (itemsCount <= 3) {
      row.classList.add(`items-${itemsCount}`);
    }

    section.items.forEach(item => {
  row.innerHTML += `
    <div class="slider-card ${section.card_style}"
         onclick="openCard('${section.filter_type}', '${item.filter_value}')">

      <img src="${item.image}" class="slider-img" />

      <div class="card-body">
        <h3>${item.title}</h3>

        ${section.show_price ? `<p class="card-price">₹${item.price}</p>` : ""}

        ${section.show_occupancy ? `<p class="card-occupancy">👤 ${item.max_guests} Guests</p>` : ""}

        ${section.show_amenities && item.amenities
          ? `<p class="card-amenities">${item.amenities.slice(0,3).join(" • ")}</p>`
          : ""
        }
      </div>
    </div>
  `;
});



    // Slider navigation
    const btnLeft = sec.querySelector(".left");
    const btnRight = sec.querySelector(".right");

    btnRight.onclick = () => row.scrollBy({ left: 300, behavior: "smooth" });
    btnLeft.onclick = () => row.scrollBy({ left: -300, behavior: "smooth" });

    container.appendChild(sec);
  });
}

function renderStyle4Slider(section, container) {

  // Section wrapper
  const sec = document.createElement("div");
  sec.className = "homepage-section";

  // Section title (from backend)
  if (section.title) {
    const h2 = document.createElement("h2");
    h2.textContent = section.title;
    sec.appendChild(h2);
  }

  // Slider row (reuse existing system)
  const sliderContainer = document.createElement("div");
  sliderContainer.className = "slider-container";

  const row = document.createElement("div");
  row.className = "slider-row style4";

  sliderContainer.appendChild(row);
  sec.appendChild(sliderContainer);

  // Safety: no items
  if (!Array.isArray(section.items)) {
    container.appendChild(sec);
    return;
  }

  section.items.forEach(item => {

    const card = document.createElement("div");
    card.className = "slider-card style4-card";

    // Navigation (NO hardcoding)
    card.onclick = () => {
      openCard(section.filter_type, item.filter_value);
    };

    /* ==========================
       IMAGE BLOCK
    ========================== */
    const imageWrap = document.createElement("div");
    imageWrap.className = "style4-image-wrap";

    const img = document.createElement("img");
    img.src = `${item.image}`;
    img.alt = item.title || "";

    imageWrap.appendChild(img);

    // Optional badge (from backend only)
    if (item.badge) {
      const badge = document.createElement("span");
      badge.className = "style4-badge";
      badge.textContent = item.badge;
      imageWrap.appendChild(badge);
    }

    card.appendChild(imageWrap);

    /* ==========================
       CONTENT BLOCK
    ========================== */
    const body = document.createElement("div");
    body.className = "card-body";

    if (item.title) {
      const title = document.createElement("h3");
      title.textContent = item.title;
      body.appendChild(title);
    }

    if (item.city) {
      const city = document.createElement("div");
      city.className = "card-location";
      city.textContent = item.city;
      body.appendChild(city);
    }

    // Rating (ONLY if backend sends it)
    if (item.rating) {
      const meta = document.createElement("div");
      meta.className = "card-meta";
      meta.textContent = `⭐ ${item.rating}`;
      body.appendChild(meta);
    }

    // Price (ONLY if backend allows)
    if (section.show_price && item.price) {
      const price = document.createElement("div");
      price.className = "card-price";
      price.textContent = item.price;
      body.appendChild(price);
    }

    card.appendChild(body);
    row.appendChild(card);
  });

  container.appendChild(sec);
}

// ==============================
// UNIVERSAL FILTER HANDLER
// ==============================
function openCard(filterType, value) {

  if (filterType === "architecture") {
    window.location.href = `architecture.html?type=${encodeURIComponent(value)}`;
    return;
  }

  if (filterType === "city") {
    window.location.href = `city.html?city=${encodeURIComponent(value)}`;
    return;
  }

 
// ✅ Single villa page
if (filterType === "full_villa") {
  // value = villa ID
  window.location.href = `villa.html?id=${encodeURIComponent(value)}`;
  return;
}


}


// Make available globally
window.openCard = openCard;

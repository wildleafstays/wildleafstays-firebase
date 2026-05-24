const page = document.querySelector("#propertyPage");
const params = new URLSearchParams(location.search);
const state = {
  propertyId: params.get("id"),
  checkIn: params.get("checkIn"),
  checkOut: params.get("checkOut"),
  adults: Number(params.get("adults") || 2),
  kids: Number(params.get("kids") || 0),
  data: null
};

loadProperty();

async function loadProperty() {
  try {
    const query = new URLSearchParams({
      checkIn: state.checkIn,
      checkOut: state.checkOut
    });
    const response = await fetch(`/api/availability/property/${state.propertyId}?${query.toString()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load property");
    state.data = data;
    renderProperty(data);
  } catch (err) {
    page.innerHTML = `<section class="loading-state">${escapeHtml(err.message)}</section>`;
  }
}

function renderProperty(data) {
  const property = data.property;
  const photos = property.photos?.length ? property.photos : [
    "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1800&q=80",
    "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=900&q=80"
  ];
  const facilities = [...(property.facilities || []), ...(property.amenities || [])];

  page.innerHTML = `
    <section class="property-hero" style="background-image: linear-gradient(rgba(13, 25, 37, .18), rgba(13, 25, 37, .62)), url('${photos[0]}')">
      <div class="property-hero-content">
        <a class="back-link" href="/customer/">Back to search</a>
        <h1>${escapeHtml(property.name)}</h1>
        <p>${escapeHtml(property.destination || "")}</p>
      </div>
    </section>

    <section class="property-shell">
      <div class="gallery-strip">
        ${photos.slice(0, 6).map(photo => `<img src="${photo}" alt="${escapeHtml(property.name)}">`).join("")}
      </div>

      <section class="property-intro">
        <div>
          <h2>Choose your stay</h2>
          <p>${escapeHtml(property.description || "Select room categories below and allocate guests room-wise before payment.")}</p>
        </div>
        <div class="stay-summary">
          <strong>${formatDisplayDate(state.checkIn)} to ${formatDisplayDate(state.checkOut)}</strong>
          <span>${state.adults} adult(s), ${state.kids} kid(s)</span>
        </div>
      </section>

      <div class="chips feature-row">${facilities.slice(0, 14).map(item => `<span>${escapeHtml(item)}</span>`).join("")}</div>

      <section class="room-stack">
        ${(data.roomOptions || []).filter(room => room.availableRooms > 0).map(renderRoomCard).join("")}
        ${renderVillaCard(data.villaOption)}
      </section>
    </section>
  `;
}

function renderRoomCard(room) {
  const photo = room.photos?.[0] || "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=80";
  const amenities = room.amenities || [];
  return `
    <article class="detail-room-card" id="room-${room.roomCategoryId}">
      <div class="detail-room-media">
        <img src="${photo}" alt="${escapeHtml(room.name)}">
        <button type="button" onclick="openPhoto('${photo}')">View photo</button>
      </div>
      <div class="detail-room-copy">
        <div class="room-heading">
          <div>
            <h3>${escapeHtml(room.name)}</h3>
            <p class="muted">${room.availableRooms} available · Max ${room.maxGuests} guests per room</p>
          </div>
          <strong>Rs ${formatMoney(room.basePrice)} / night</strong>
        </div>
        <p>${escapeHtml(room.description || "A well-appointed room category with flexible guest allocation.")}</p>
        <div class="chips">
          ${room.viewType ? `<span>${escapeHtml(room.viewType)}</span>` : ""}
          ${room.bedType ? `<span>${escapeHtml(room.bedType)}</span>` : ""}
          ${room.sizeText ? `<span>${escapeHtml(room.sizeText)}</span>` : ""}
          ${amenities.slice(0, 8).map(item => `<span>${escapeHtml(item)}</span>`).join("")}
        </div>
      </div>
      <div class="detail-room-book">
        ${stepper("Rooms", room.roomCategoryId, "qty", 0, room.availableRooms, 0)}
        ${stepper("Adults", room.roomCategoryId, "adults", 0, 0, 0)}
        ${stepper("Kids", room.roomCategoryId, "kids", 0, 0, 0)}
        ${stepper("Infants", room.roomCategoryId, "infants", 0, 10, 0)}
      </div>
    </article>
  `;
}

function renderVillaCard(villaOption) {
  if (!villaOption?.enabled) return "";
  if (!villaOption.available) {
    return `<article class="villa-card unavailable">Full villa is unavailable because at least one room is already booked for these dates.</article>`;
  }
  return `
    <article class="villa-card">
      <div>
        <span class="villa-badge">Full villa</span>
        <h3>Reserve the entire property</h3>
        <p>No separate villa price is entered. This total is calculated from all room category rates and room counts.</p>
      </div>
      <div>
        <strong>Rs ${formatMoney(villaOption.totalAmount)}</strong>
        <button type="button" onclick="bookFullVilla()">Book full villa</button>
      </div>
    </article>
  `;
}

function stepper(label, roomCategoryId, field, min, max, value) {
  return `
    <div class="stepper" data-min="${min}" data-max="${max}" data-room="${roomCategoryId}" data-field="${field}">
      <span>${label}</span>
      <button type="button" onclick="changeValue('${roomCategoryId}', '${field}', -1)">-</button>
      <strong id="${roomCategoryId}-${field}">${value}</strong>
      <button type="button" onclick="changeValue('${roomCategoryId}', '${field}', 1)">+</button>
    </div>
  `;
}

function changeValue(roomCategoryId, field, delta) {
  const valueEl = document.getElementById(`${roomCategoryId}-${field}`);
  const wrapper = valueEl.closest(".stepper");
  const min = Number(wrapper.dataset.min || 0);
  const max = Number(wrapper.dataset.max || 99);
  valueEl.textContent = Math.max(min, Math.min(max, Number(valueEl.textContent || 0) + delta));
  syncRoom(roomCategoryId);
}

function syncRoom(roomCategoryId) {
  const room = state.data.roomOptions.find(item => item.roomCategoryId === roomCategoryId);
  const quantity = getValue(roomCategoryId, "qty");
  const maxGuests = room.maxGuests * quantity;
  setMax(roomCategoryId, "adults", maxGuests);
  setMax(roomCategoryId, "kids", maxGuests);

  if (quantity === 0) {
    setValue(roomCategoryId, "adults", 0);
    setValue(roomCategoryId, "kids", 0);
    setValue(roomCategoryId, "infants", 0);
  }

  let adults = getValue(roomCategoryId, "adults");
  let kids = getValue(roomCategoryId, "kids");
  if (adults + kids > maxGuests) {
    const over = adults + kids - maxGuests;
    if (kids >= over) kids -= over;
    else adults = Math.max(adults - (over - kids), 0);
    setValue(roomCategoryId, "adults", adults);
    setValue(roomCategoryId, "kids", kids);
  }

  renderStickySummary();
}

async function renderStickySummary() {
  document.querySelector(".sticky-booking")?.remove();
  const rooms = selectedRooms();
  if (!rooms.length) return;

  const response = await fetch("/api/availability/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      propertyId: state.propertyId,
      bookingType: "rooms",
      checkIn: state.checkIn,
      checkOut: state.checkOut,
      rooms
    })
  });
  const data = await response.json();

  const summary = document.createElement("section");
  summary.className = "sticky-booking";
  summary.innerHTML = `
    <div>
      <strong>Rs ${formatMoney(data.quote?.totalAmount || 0)}</strong>
      <span>${rooms.reduce((sum, room) => sum + room.quantity, 0)} room(s) selected</span>
    </div>
    <button type="button" onclick="bookRooms()">Pay and book</button>
  `;
  document.body.appendChild(summary);
}

function selectedRooms() {
  return state.data.roomOptions.map(room => ({
    roomCategoryId: room.roomCategoryId,
    quantity: getValue(room.roomCategoryId, "qty"),
    adults: getValue(room.roomCategoryId, "adults"),
    kids: getValue(room.roomCategoryId, "kids"),
    infants: getValue(room.roomCategoryId, "infants")
  })).filter(room => room.quantity > 0);
}

function bookRooms() {
  const rooms = selectedRooms();
  if (!rooms.length) return alert("Please select rooms first.");
  collectGuestAndBook({ propertyId: state.propertyId, bookingType: "rooms", rooms });
}

function bookFullVilla() {
  collectGuestAndBook({ propertyId: state.propertyId, bookingType: "fullVilla", rooms: [] });
}

async function collectGuestAndBook(selection) {
  const guestName = prompt("Guest name");
  if (!guestName) return;
  const guestPhone = prompt("Guest phone");
  if (!guestPhone) return;

  const payload = {
    ...selection,
    checkIn: state.checkIn,
    checkOut: state.checkOut,
    adults: selection.rooms.length ? selection.rooms.reduce((sum, room) => sum + room.adults, 0) : state.adults,
    kids: selection.rooms.length ? selection.rooms.reduce((sum, room) => sum + room.kids, 0) : state.kids,
    guest: {
      name: guestName,
      phone: guestPhone,
      email: prompt("Guest email, optional") || ""
    }
  };

  const response = await fetch("/api/bookings/hold", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) return alert(data.error || "Could not create booking");
  await startPayment(data.bookingId, payload.guest);
}

async function startPayment(bookingId, guest) {
  const orderResponse = await fetch("/api/payments/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId })
  });
  const order = await orderResponse.json();
  if (!orderResponse.ok) return alert(order.error || "Could not start payment");

  const checkout = new Razorpay({
    key: order.keyId,
    amount: order.amount,
    currency: order.currency,
    name: "Wildleaf Stays",
    description: `Booking ${bookingId}`,
    order_id: order.orderId,
    prefill: {
      name: guest.name,
      email: guest.email,
      contact: guest.phone
    },
    handler: async paymentResult => {
      const verifyResponse = await fetch("/api/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, ...paymentResult })
      });
      const verified = await verifyResponse.json();
      if (!verifyResponse.ok) return alert(verified.error || "Payment was received but booking confirmation failed");
      alert(`Booking confirmed. Booking ID: ${bookingId}`);
      location.reload();
    }
  });

  checkout.open();
}

function getValue(roomCategoryId, field) {
  return Number(document.getElementById(`${roomCategoryId}-${field}`)?.textContent || 0);
}

function setValue(roomCategoryId, field, value) {
  document.getElementById(`${roomCategoryId}-${field}`).textContent = String(value);
}

function setMax(roomCategoryId, field, max) {
  const wrapper = document.querySelector(`[data-room="${roomCategoryId}"][data-field="${field}"]`);
  wrapper.dataset.max = max;
  if (getValue(roomCategoryId, field) > max) setValue(roomCategoryId, field, max);
}

function openPhoto(photo) {
  window.open(photo, "_blank", "noopener,noreferrer");
}

function formatDisplayDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
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

const form = document.querySelector("#searchForm");
const resultsEl = document.querySelector("#results");
const statusEl = document.querySelector("#statusText");

let latestResults = [];
let activeSelection = null;

setDefaultDates();

form.addEventListener("submit", async event => {
  event.preventDefault();
  const params = new URLSearchParams(new FormData(form));
  statusEl.textContent = "Checking live availability...";
  resultsEl.innerHTML = "";

  try {
    const response = await fetch(`/api/availability/search?${params.toString()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Search failed");

    latestResults = data.results || [];
    statusEl.textContent = latestResults.length
      ? `${latestResults.length} stay option${latestResults.length === 1 ? "" : "s"} found`
      : "No available stays found for these dates.";

    resultsEl.innerHTML = latestResults.map((result, index) => renderResult(result, index)).join("");
  } catch (err) {
    statusEl.textContent = err.message;
  }
});

function renderResult(result, index) {
  const property = result.property;
  const photo = property.photos?.[0] || "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80";
  const facilities = [...(property.facilities || []), ...(property.amenities || [])].slice(0, 8);
  const villaRow = result.villaOption?.available ? `
    <button class="villa-cta" type="button" onclick="bookFullVilla(${index})">
      Book full villa for Rs ${formatMoney(result.villaOption.totalAmount)}
    </button>
  ` : `<div class="muted">Full villa not available for these dates if any room is already booked.</div>`;

  return `
    <article class="property-card">
      <img class="property-photo" src="${photo}" alt="${escapeHtml(property.name)}">
      <div>
        <h3>${escapeHtml(property.name)}</h3>
        <div class="muted">${escapeHtml(property.destination || "")}</div>
        <p>${escapeHtml(property.description || "Comfortable stay with live booking availability.")}</p>
        <div class="chips">${facilities.map(item => `<span>${escapeHtml(item)}</span>`).join("")}</div>
        <div class="options">
          ${(result.roomOptions || []).map(room => renderRoomCard(room, index)).join("")}
          ${villaRow}
        </div>
      </div>
    </article>
  `;
}

function renderRoomCard(room, resultIndex) {
  const photo = room.photos?.[0] || "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=80";
  const amenities = room.amenities || [];

  return `
    <section class="room-card" id="room-${resultIndex}-${room.roomCategoryId}">
      <img class="room-photo" src="${photo}" alt="${escapeHtml(room.name)}">
      <div class="room-main">
        <button class="room-title" type="button" onclick="toggleRoomDetails('${resultIndex}-${room.roomCategoryId}')">
          ${escapeHtml(room.name)}
        </button>
        <div class="muted">${room.availableRooms} available · Max ${room.maxGuests} guests per room · Rs ${formatMoney(room.basePrice)} / night</div>
        <div class="chips">
          ${room.viewType ? `<span>${escapeHtml(room.viewType)}</span>` : ""}
          ${room.bedType ? `<span>${escapeHtml(room.bedType)}</span>` : ""}
          ${room.sizeText ? `<span>${escapeHtml(room.sizeText)}</span>` : ""}
          ${amenities.slice(0, 5).map(item => `<span>${escapeHtml(item)}</span>`).join("")}
        </div>
        <p class="room-detail" data-detail="${resultIndex}-${room.roomCategoryId}">
          ${escapeHtml(room.description || "Room details can include size, view, bed type, amenities, and policies.")}
        </p>
      </div>
      <div class="room-selectors">
        ${stepper("Rooms", `room-${resultIndex}-${room.roomCategoryId}-qty`, 0, room.availableRooms, 0, `updateRoomGuests(${resultIndex}, '${room.roomCategoryId}')`)}
        ${stepper("Adults", `room-${resultIndex}-${room.roomCategoryId}-adults`, 0, room.maxGuests, 0, `syncGuestLimit(${resultIndex}, '${room.roomCategoryId}')`)}
        ${stepper("Kids", `room-${resultIndex}-${room.roomCategoryId}-kids`, 0, room.maxGuests, 0, `syncGuestLimit(${resultIndex}, '${room.roomCategoryId}')`)}
        ${stepper("Infants", `room-${resultIndex}-${room.roomCategoryId}-infants`, 0, 10, 0, `updateSummary(${resultIndex})`)}
      </div>
    </section>
  `;
}

function stepper(label, id, min, max, value, onChange) {
  return `
    <div class="stepper" data-min="${min}" data-max="${max}">
      <span>${label}</span>
      <button type="button" onclick="changeStepper('${id}', -1); ${onChange}">-</button>
      <strong id="${id}">${value}</strong>
      <button type="button" onclick="changeStepper('${id}', 1); ${onChange}">+</button>
    </div>
  `;
}

function toggleRoomDetails(id) {
  document.querySelector(`[data-detail="${id}"]`)?.classList.toggle("show");
}

function changeStepper(id, delta) {
  const el = document.getElementById(id);
  const wrapper = el.closest(".stepper");
  const min = Number(wrapper.dataset.min || 0);
  const max = Number(wrapper.dataset.max || 99);
  el.textContent = Math.max(min, Math.min(max, Number(el.textContent || 0) + delta));
}

function updateRoomGuests(resultIndex, roomCategoryId) {
  const room = findRoom(resultIndex, roomCategoryId);
  const qty = valueOf(`room-${resultIndex}-${roomCategoryId}-qty`);
  const maxGuests = room.maxGuests * qty;
  setStepperMax(`room-${resultIndex}-${roomCategoryId}-adults`, maxGuests);
  setStepperMax(`room-${resultIndex}-${roomCategoryId}-kids`, maxGuests);
  if (qty === 0) {
    setValue(`room-${resultIndex}-${roomCategoryId}-adults`, 0);
    setValue(`room-${resultIndex}-${roomCategoryId}-kids`, 0);
    setValue(`room-${resultIndex}-${roomCategoryId}-infants`, 0);
  }
  syncGuestLimit(resultIndex, roomCategoryId);
}

function syncGuestLimit(resultIndex, roomCategoryId) {
  const room = findRoom(resultIndex, roomCategoryId);
  const qty = valueOf(`room-${resultIndex}-${roomCategoryId}-qty`);
  const maxGuests = room.maxGuests * qty;
  let adults = valueOf(`room-${resultIndex}-${roomCategoryId}-adults`);
  let kids = valueOf(`room-${resultIndex}-${roomCategoryId}-kids`);

  if (adults + kids > maxGuests) {
    const over = adults + kids - maxGuests;
    if (kids >= over) kids -= over;
    else adults = Math.max(adults - (over - kids), 0);
  }

  setValue(`room-${resultIndex}-${roomCategoryId}-adults`, adults);
  setValue(`room-${resultIndex}-${roomCategoryId}-kids`, kids);
  updateSummary(resultIndex);
}

async function updateSummary(resultIndex) {
  const result = latestResults[resultIndex];
  const rooms = selectedRooms(resultIndex);
  removeSummary(resultIndex);
  if (!rooms.length) return;

  const response = await fetch("/api/availability/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      propertyId: result.property.id,
      bookingType: "rooms",
      checkIn: form.checkIn.value,
      checkOut: form.checkOut.value,
      rooms
    })
  });
  const data = await response.json();
  const card = document.createElement("div");
  card.className = "booking-summary";
  card.dataset.summary = resultIndex;
  card.innerHTML = `
    <div>
      <strong>Total: Rs ${formatMoney(data.quote?.totalAmount || 0)}</strong>
      <div class="muted">${rooms.reduce((sum, item) => sum + item.quantity, 0)} room(s), ${rooms.reduce((sum, item) => sum + item.adults, 0)} adult(s), ${rooms.reduce((sum, item) => sum + item.kids, 0)} kid(s)</div>
    </div>
    <button type="button" onclick="openGuestDetails(${resultIndex})">Pay and Book</button>
  `;
  document.querySelectorAll(".property-card")[resultIndex].appendChild(card);
}

function removeSummary(resultIndex) {
  document.querySelector(`[data-summary="${resultIndex}"]`)?.remove();
}

function selectedRooms(resultIndex) {
  const result = latestResults[resultIndex];
  return (result.roomOptions || []).map(room => {
    const quantity = valueOf(`room-${resultIndex}-${room.roomCategoryId}-qty`);
    return {
      roomCategoryId: room.roomCategoryId,
      quantity,
      adults: valueOf(`room-${resultIndex}-${room.roomCategoryId}-adults`),
      kids: valueOf(`room-${resultIndex}-${room.roomCategoryId}-kids`),
      infants: valueOf(`room-${resultIndex}-${room.roomCategoryId}-infants`)
    };
  }).filter(room => room.quantity > 0);
}

function openGuestDetails(resultIndex) {
  const result = latestResults[resultIndex];
  const rooms = selectedRooms(resultIndex);
  if (!rooms.length) return alert("Please select rooms first.");
  activeSelection = {
    propertyId: result.property.id,
    bookingType: "rooms",
    rooms
  };
  collectGuestAndBook();
}

function bookFullVilla(resultIndex) {
  const result = latestResults[resultIndex];
  activeSelection = {
    propertyId: result.property.id,
    bookingType: "fullVilla",
    rooms: []
  };
  collectGuestAndBook();
}

async function collectGuestAndBook() {
  const guestName = prompt("Guest name");
  if (!guestName) return;
  const guestPhone = prompt("Guest phone");
  if (!guestPhone) return;

  const payload = {
    ...activeSelection,
    checkIn: form.checkIn.value,
    checkOut: form.checkOut.value,
    adults: activeSelection.rooms.length
      ? activeSelection.rooms.reduce((sum, room) => sum + room.adults, 0)
      : Number(form.adults.value || 1),
    kids: activeSelection.rooms.length
      ? activeSelection.rooms.reduce((sum, room) => sum + room.kids, 0)
      : Number(form.kids.value || 0),
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
      form.dispatchEvent(new Event("submit"));
    }
  });

  checkout.open();
}

function findRoom(resultIndex, roomCategoryId) {
  return latestResults[resultIndex].roomOptions.find(room => room.roomCategoryId === roomCategoryId);
}

function setStepperMax(id, max) {
  const wrapper = document.getElementById(id).closest(".stepper");
  wrapper.dataset.max = max;
  if (valueOf(id) > max) setValue(id, max);
}

function valueOf(id) {
  return Number(document.getElementById(id)?.textContent || 0);
}

function setValue(id, value) {
  document.getElementById(id).textContent = String(value);
}

function setDefaultDates() {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  form.checkIn.value = dateValue(today);
  form.checkOut.value = dateValue(tomorrow);
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

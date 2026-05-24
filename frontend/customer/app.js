const form = document.querySelector("#searchForm");
const resultsEl = document.querySelector("#results");
const statusEl = document.querySelector("#statusText");

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

    statusEl.textContent = data.results.length
      ? `${data.results.length} stay option${data.results.length === 1 ? "" : "s"} found`
      : "No available stays found for these dates.";

    resultsEl.innerHTML = data.results.map(renderResult).join("");
  } catch (err) {
    statusEl.textContent = err.message;
  }
});

function renderResult(result) {
  const property = result.property;
  const photo = property.photos?.[0] || "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80";
  const roomRows = (result.roomOptions || []).map(option => `
    <div class="option-row">
      <div>
        <strong>${escapeHtml(option.name)}</strong>
        <div class="muted">${option.availableRooms} room(s) available</div>
      </div>
      <strong>Rs ${formatMoney(option.totalAmount)}</strong>
      <button type="button" onclick='bookNow(${JSON.stringify({
        propertyId: property.id,
        bookingType: "rooms",
        rooms: [{ roomCategoryId: option.roomCategoryId, quantity: 1 }]
      })})'>Book Room</button>
    </div>
  `).join("");

  const villaRow = result.villaOption?.available ? `
    <div class="option-row">
      <div>
        <strong>Full villa / full property</strong>
        <div class="villa-badge">Blocks all rooms for your family or group</div>
      </div>
      <strong>Rs ${formatMoney(result.villaOption.totalAmount)}</strong>
      <button type="button" onclick='bookNow(${JSON.stringify({
        propertyId: property.id,
        bookingType: "fullVilla",
        rooms: []
      })})'>Book Villa</button>
    </div>
  ` : "";

  return `
    <article class="property-card">
      <img class="property-photo" src="${photo}" alt="${escapeHtml(property.name)}">
      <div>
        <h3>${escapeHtml(property.name)}</h3>
        <div class="muted">${escapeHtml(property.destination || "")}</div>
        <p>${escapeHtml(property.description || "Comfortable stay with live booking availability.")}</p>
        <div class="options">${roomRows}${villaRow}</div>
      </div>
    </article>
  `;
}

async function bookNow(selection) {
  const guestName = prompt("Guest name");
  if (!guestName) return;
  const guestPhone = prompt("Guest phone");
  if (!guestPhone) return;

  const payload = {
    ...selection,
    checkIn: form.checkIn.value,
    checkOut: form.checkOut.value,
    adults: Number(form.adults.value || 1),
    kids: Number(form.kids.value || 0),
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
    }
  });

  checkout.open();
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

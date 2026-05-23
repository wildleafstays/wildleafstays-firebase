if (typeof Razorpay === "undefined") {
  alert("Razorpay SDK not loaded");
}

console.log("🔥 BOOKING-SUMMARY.JS LOADED — FINAL SAFE VERSION");

document.addEventListener("DOMContentLoaded", () => {

  /* ===============================
     LOAD PENDING BOOKING
  =============================== */
  const raw = sessionStorage.getItem("pendingBooking");
  if (!raw) {
    alert("No booking data found");
    window.location.href = "index.html";
    return;
  }

  const booking = JSON.parse(raw);

  // 🔑 SINGLE SOURCE OF TRUTH
  const isVillaBooking = booking.isFullVilla === true;

  /* ===============================
     RENDER HEADER
  =============================== */
  document.getElementById("hotelName").textContent = booking.hotelName;
  document.getElementById("checkIn").textContent = booking.checkIn;
  document.getElementById("checkOut").textContent = booking.checkOut;

 /* ===============================
   RENDER SUMMARY TABLE
=============================== */
const tbody = document.getElementById("summaryBody");
tbody.innerHTML = "";

let finalTotalAmount = 0;

if (isVillaBooking) {
  // 🏡 FULL VILLA
  const villaPrice = Number(booking.villaPerNightPrice);

  if (!villaPrice || isNaN(villaPrice)) {
    alert("Villa price not found. Please go back and reselect dates.");
    return;
  }

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>Full Villa</td>
    <td>${booking.adults}</td>
    <td>${booking.kids}</td>
    <td>₹${villaPrice.toLocaleString()}</td>
  `;
  tbody.appendChild(tr);

  finalTotalAmount = Number(booking.totalAmount);


} else {
  // 🏨 HOTEL MODE (UNCHANGED)
  booking.rooms.forEach(r => {
    const price = Number(r.price) || 0;
    finalTotalAmount += price;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.category}</td>
      <td>${r.adults}</td>
      <td>${r.kids}</td>
      <td>₹${price.toLocaleString()}</td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById("totalAmount").textContent =
  finalTotalAmount.toLocaleString();


  /* ===============================
     FINAL BOOK NOW
  =============================== */
  const btn = document.getElementById("finalConfirmBtn");

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Booking...";

    const guestName = document.getElementById("guestName").value.trim();
    const guestPhone = document.getElementById("guestPhone").value.trim();
    const guestEmail = document.getElementById("guestEmail").value.trim();

    if (!guestName || !guestPhone) {
      alert("Please enter guest name and mobile number");
      btn.disabled = false;
      btn.textContent = "Final Book Now";
      return;
    }

    try {

      /* ===============================
         BUILD ROOMS PAYLOAD
      =============================== */
      let roomsPayload = [];

      if (!isVillaBooking) {
        const groupedRooms = {};

        booking.rooms.forEach(r => {
          if (!groupedRooms[r.roomId]) {
            groupedRooms[r.roomId] = 0;
          }
          groupedRooms[r.roomId] += Number(r.rooms || 1);
        });

        roomsPayload = Object.entries(groupedRooms).map(
          ([roomId, count]) => ({
            roomId: Number(roomId),
            rooms: count
          })
        );
      }

      /* ===============================
         FINAL PAYLOAD
      =============================== */
      const payload = {
        hotelId: booking.hotelId,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        adults: Number(booking.adults),
        kids: Number(booking.kids),
        rooms: roomsPayload,            // [] for villa
        isFullVilla: isVillaBooking,    // 🔑 FLAG
        totalAmount: finalTotalAmount,
        gstPercent: booking.gstPercent || 0,
        guest_name: guestName,
        guest_phone: guestPhone,
        guest_email: guestEmail || null
      };

      console.log("FINAL BOOKING PAYLOAD:", payload);

      const res = await fetch(
        "/api/bookings/create-pending",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );

      const result = await res.json();
      if (!result.success) {
        throw new Error("Booking creation failed");
      }

      await startRazorpay(result);

    } catch (err) {
      console.error("FINAL BOOKING ERROR:", err);
      alert("Booking failed. Please try again.");
      btn.disabled = false;
      btn.textContent = "Final Book Now";
    }
  });
});

/* ===============================
   RAZORPAY
=============================== */
async function startRazorpay(pending) {
  const res = await fetch(
    "/api/payments/create-order",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId: pending.bookingId })
    }
  );

  const order = await res.json();
  if (!order.success) {
    alert("Unable to initiate payment");
    return;
  }

  const options = {
    key: order.razorpayKey,
    amount: order.amount * 100,
    currency: "INR",
    name: "Wildleaf Stays",
    description: "Hotel Booking",
    order_id: order.orderId,

    handler: function (response) {
      verifyPayment(response, pending.bookingId);
    },

    prefill: {
      name: document.getElementById("guestName").value,
      email: document.getElementById("guestEmail").value,
      contact: document.getElementById("guestPhone").value
    },

    theme: { color: "#0a7cff" }
  };

  new Razorpay(options).open();
}

async function verifyPayment(payment, bookingId) {
  const res = await fetch(
    "/api/payments/verify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookingId,
        razorpay_payment_id: payment.razorpay_payment_id,
        razorpay_order_id: payment.razorpay_order_id,
        razorpay_signature: payment.razorpay_signature
      })
    }
  );

  const data = await res.json();

  if (data.success) {
    sessionStorage.removeItem("pendingBooking");
    window.location.href =
      "booking-success.html?ref=" + data.bookingReference;
  } else {
    alert("Payment verification failed");
  }
}

/* ===============================
   GO BACK
=============================== */
function modifySelection() {
  history.back();
}

import { authHeaders } from "../../auth.js";
import { getHotelContext } from "../../hotelContext.js";

authHeaders();


function mysqlToUiDate(dateStr) {
  if (!dateStr) return "";

  // ✅ FORCE STRING HANDLING — NO JS Date, NO TIMEZONE
  if (typeof dateStr === "string") {
    const clean = dateStr.substring(0, 10); // yyyy-mm-dd ONLY
    const [yyyy, mm, dd] = clean.split("-");
    return `${dd}/${mm}/${yyyy}`;
  }

  return "";
}



const API_BASE = "";
// ===============================
// Load hotels into dropdown
// ===============================
async function loadHotels() {
  const res = await fetch("/api/hotels");
  const hotels = await res.json();

  const select = document.getElementById("hotelFilter");
  hotels.forEach(h => {
    const opt = document.createElement("option");
    opt.value = h.id;
    opt.textContent = h.name;
    select.appendChild(opt);
  });
}


// ===============================
// LOAD BOOKINGS (RECEPTION VIEW)
// ===============================
async function loadBookings() {
  const hotelId = document.getElementById("hotelFilter").value;
  const status = document.getElementById("statusFilter").value;

  let url = "/api/bookings";
  const params = [];

  if (hotelId) params.push(`hotelId=${hotelId}`);
  if (status) params.push(`status=${status}`);

  if (params.length) url += "?" + params.join("&");

  const res = await fetch(url);
  const bookings = await res.json();

  const tbody = document.getElementById("bookingsTable");
  tbody.innerHTML = "";

  if (!Array.isArray(bookings) || bookings.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="15" style="text-align:center;">No bookings found</td>
      </tr>
    `;
    return;
  }

  bookings.forEach(b => {

    // 🏡 Booking type
    const bookingType = b.booking_type || "Rooms";

    // 🛏️ Room display
    const roomDisplay =
      bookingType === "Full Villa"
        ? "Full Villa"
        : (b.room_names || "Rooms not assigned yet");

    // 🔢 Rooms count
    const roomsCount =
      bookingType === "Full Villa"
        ? "-"
        : (b.rooms_booked ?? 0);

    // 💰 Payment values
    const total = Number(b.total_amount || 0);
    const advance = Number(b.advance_amount || 0);
    const balance = Number(b.balance_amount || 0);
    const paymentStatus = b.hotel_payment_status || "-";

    tbody.innerHTML += `
<tr>
  <td>${b.id}</td>

  <td>${b.hotel_name}</td>

  <td><strong>${bookingType}</strong></td>

  <td style="max-width:220px;">
    ${roomDisplay}
  </td>

  <td>${roomsCount}</td>

  <td>
    ${b.guest_name || "-"}
    <br>
    <small>${b.guest_phone || "-"}</small>
  </td>

  <td>${mysqlToUiDate(b.check_in)}</td>
  <td>${mysqlToUiDate(b.check_out)}</td>

  <td>₹ ${total.toFixed(2)}</td>
  <td>₹ ${advance.toFixed(2)}</td>
  <td>₹ ${balance.toFixed(2)}</td>

  <td>
    <span class="pay-${paymentStatus}">
      ${paymentStatus}
    </span>
  </td>

  <td class="status-${b.status}">
    ${b.status}
  </td>

  <td>${b.source || "-"}</td>

  <td>
    ${
      b.status === "confirmed"
        ? `<button onclick="cancelBooking(${b.id})">Cancel</button>`
        : "-"
    }
  </td>
</tr>
`;
  });
}


// ===============================
// CANCEL BOOKING
// ===============================
async function cancelBooking(id) {
  if (!confirm("Are you sure you want to cancel this booking?")) return;

  try {
    const res = await fetch(
      `${API_BASE}/api/bookings/${id}/cancel`,
      { method: "POST" }
    );

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Cancellation failed");
      return;
    }

    alert("Booking cancelled & inventory restored");
    loadBookings();

  } catch (err) {
    alert("Server error");
  }
}

// ===============================
// INIT
// ===============================
document.addEventListener("DOMContentLoaded", async () => {
  await loadHotels();

  const ctx = getHotelContext();
  const hotelFilter = document.getElementById("hotelFilter");

  if (ctx && ctx.id && hotelFilter) {
    hotelFilter.value = ctx.id; // ✅ preselect, NOT lock
  }

  await loadBookings();
});

// 🔓 expose functions for inline HTML handlers
window.loadBookings = loadBookings;
window.cancelBooking = cancelBooking;


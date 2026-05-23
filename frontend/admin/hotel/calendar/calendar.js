import { authHeaders } from "../../auth.js";
import { getHotelContext } from "../../hotelContext.js";

authHeaders();


let selectedHotelId = null;
let selectedRooms = []; // [{ room_id, room_name, room_category_id }]
let isEditMode = false;
let editingBookingId = null;
let isSyncingEditDates = false;
let currentDate = new Date();
// ================================
// 📅 Timeline State
// ================================
let anchorDate = new Date();   // left-most visible date
const WINDOW_DAYS = 14;        // you can change to 21 / 30 later


const API = "/api/calendar";
const fromDate = new Date().toISOString().slice(0, 10);

//==========================================================
//====================Remember Selcted Hotel================
//==========================================================
function getActiveHotelId() {
  const ctx = getHotelContext();

  if (ctx && ctx.id) {
    return ctx.id;
  }

  // 🔁 Fallback: manual dropdown selection
  const select = document.getElementById("calendarHotelSelect");
  return select ? select.value : null;
}


function buildCalendar(rows) {

  // 1️⃣ Extract unique dates
  const dates = [...new Set(rows.map(r => r.cal_date))];

  // 2️⃣ Extract rooms
  const rooms = {};
  rows.forEach(r => {
    if (!rooms[r.room_id]) {
      rooms[r.room_id] = {
        name: r.room_name,
        cells: {}
      };
    }
    rooms[r.room_id].cells[r.cal_date] = r;
  });

  renderHeader(dates);
  renderBody(rooms, dates);
}

function renderHeader(dates) {
  const head = document.getElementById("calendarHead");
let html = "<tr><th class='room-header'>Room</th>";


  dates.forEach(d => {
    const day = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][
  new Date(d + "T12:00:00").getDay()
];

    html += `<th>${d}<br>${day}</th>`;
  });

  html += "</tr>";
  head.innerHTML = html;
}


function renderBody(rooms, dates) {
  const body = document.getElementById("calendarBody");
  body.innerHTML = "";

  Object.values(rooms).forEach(room => {
    let tr = `<tr><td class="room-name">${room.name}</td>`;

    dates.forEach(d => {
      const cell = room.cells[d];

      if (cell && cell.booking_id) {
        const status =
          cell.status === "pending"
            ? "pending-booking"
            : cell.hotel_payment_status || "unpaid";

        tr += `
          <td class="cell-booked ${status}"
    data-booking-id="${cell.booking_id}"
    title="Already booked">


            ${cell.guest_name || ""}
          </td>
        `;
      } else {
        tr += `
          <td class="cell-empty"
    data-room="${room.name}"
    data-date="${d}">
</td>

        `;
      }
    });

    tr += "</tr>";
    body.innerHTML += tr;
  });
}

document.addEventListener("click", e => {
  const bookedCell = e.target.closest(".cell-booked");
  if (bookedCell) {
    const bookingId = bookedCell.dataset.bookingId;
    openEditBooking(bookingId);
    return;
  }

  const cell = e.target.closest(".cell-empty");
  if (!cell) return;

  if (!selectedHotelId) {
    alert("Please select a hotel first");
    return;
  }

  const roomName = cell.dataset.room;
  const date = cell.dataset.date;

  openAddBooking(roomName, date);
});


//=======================Edit Booking===================
//======================================================
function openEditBooking(bookingId) {
  isEditMode = true;
  editingBookingId = bookingId;

  fetch(`/api/bookings/${bookingId}`)
    .then(res => res.json())
    .then(b => {

      // BASIC DETAILS
abGuestName.value = b.guest_name || "";
abGuestPhone.value = b.guest_phone || "";

abCheckIn.value = b.check_in.slice(0, 10);
abCheckOut.value = b.check_out.slice(0, 10);

// ✅ SAFE EDIT DATE SYNC (NO SHIFT)
if (window._abRangePicker) {
  isSyncingEditDates = true;

  const toLocalDate = d => {
  const [y, m, day] = d.split("-");
  return new Date(y, m - 1, day, 12); // local noon
};

window._abRangePicker.setDate(
  [
    toLocalDate(abCheckIn.value),
    toLocalDate(abCheckOut.value)
  ],
  false
);


  isSyncingEditDates = false;
}

      // PAYMENT
      totalAmount.value = b.total_amount || 0;
      advanceAmount.value = b.advance_amount || 0;
      balanceAmount.value = b.balance_amount || 0;

      abPaymentStatus.value = b.hotel_payment_status || "unpaid";
      abNotes.value = b.notes || "";

      // 🔒 Lock website bookings
      const lock = b.source === "website";
      totalAmount.disabled = lock;
      advanceAmount.disabled = lock;

      // ✅ THIS NOW WORKS (rooms come from API)
      selectedRooms = (b.rooms || []).map(r => ({
        room_id: r.room_id,
        room_name: r.room_name,
        room_category_id: r.room_category_id
      }));

      // Reload availability AFTER rooms exist
      loadAvailableRooms();

      document
        .getElementById("addBookingModal")
        .classList.remove("hidden");
    })
    .catch(err => {
      console.error(err);
      alert("Failed to load booking");
    });
}




let selectedRoom = null;
let selectedDate = null;

function openAddBooking(roomName, date) {
  isEditMode = false;
  editingBookingId = null;

  selectedRoom = roomName;
  selectedDate = date;

  // =========================
  // RESET GUEST DETAILS
  // =========================
  abGuestName.value = "";
  abGuestPhone.value = "";
  abNotes.value = "";

  // =========================
  // RESET DATES
  // =========================
  abCheckIn.value = date;

  const parts = date.split("-");
  const d = new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2])
  );
  d.setDate(d.getDate() + 1);

  abCheckOut.value =
    d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");

  // =========================
  // 🔥 RESET PAYMENT (CRITICAL FIX)
  // =========================
  totalAmount.value = "";
  advanceAmount.value = "";
  balanceAmount.value = "";

  totalAmount.disabled = false;
  advanceAmount.disabled = false;

  abPaymentStatus.value = "unpaid";

  // =========================
  // RESET ROOMS
  // =========================
  selectedRooms = [];

  document
    .getElementById("addBookingModal")
    .classList.remove("hidden");

// =========================
// ✅ SYNC FLATPICKR (CRITICAL)
// =========================
if (window._abRangePicker) {
  window._abRangePicker.setDate(
    [abCheckIn.value, abCheckOut.value],
    true
  );
}


  loadAvailableRooms(roomName);
}


function closeModal() {
  selectedRooms = [];
  document.getElementById("availableRooms").innerHTML = "";
  document.getElementById("addBookingModal")
    .classList.add("hidden");
}
// 👇 expose to HTML
window.closeModal = closeModal;

function saveBooking() {

  const checkIn = document.getElementById("abCheckIn").value;
  const checkOut = document.getElementById("abCheckOut").value;

  if (checkIn >= checkOut) {
    alert("Check-out must be after check-in");
    return;
  }

  if (selectedRooms.length === 0) {
    alert("Please select at least one room");
    return;
  }

  // rest of code stays same


  const payload = {
    hotelId: selectedHotelId,
    checkIn: document.getElementById("abCheckIn").value,
    checkOut: document.getElementById("abCheckOut").value,
    guestName: document.getElementById("abGuestName").value,
    phone: document.getElementById("abGuestPhone").value,
    paymentStatus: document.getElementById("abPaymentStatus").value,
    notes: document.getElementById("abNotes").value,
 // ✅ PAYMENT (THIS FIXES NULL VALUES)
  total_amount: Number(document.getElementById("totalAmount").value || 0),
  advance_amount: Number(document.getElementById("advanceAmount").value || 0),
  hotel_payment_status: document.getElementById("abPaymentStatus").value,
    // ✅ NEW
    rooms: selectedRooms
  };

  fetch("/api/calendar/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then(res => res.json())
    .then(resp => {
      if (!resp.success) {
        alert("Failed to save booking");
        return;
      }

      closeModal();

// ✅ Refresh calendar without losing session
loadCalendar(selectedHotelId);

    })
    .catch(err => {
      console.error(err);
      alert("Error saving booking");
    });
}


function loadCalendarHotels() {
  fetch("/api/hotels")
    .then(res => res.json())
    .then(hotels => {
      const select = document.getElementById("calendarHotelSelect");
      select.innerHTML = `<option value="">Select Hotel</option>`;

      hotels.forEach(h => {
        select.innerHTML += `<option value="${h.id}">${h.name}</option>`;
      });
    })
    .catch(err => console.error(err));
}
// ✅===============Admin Aware Logic================== 

document
  .getElementById("calendarHotelSelect")
  .addEventListener("change", e => {
    selectedHotelId = e.target.value;

    if (!selectedHotelId) return;
 
    loadCalendar(selectedHotelId);
  });


//==========Must Stay Initial Calendar load DOM==============
//=====================================
document.addEventListener("DOMContentLoaded", () => {
  const ctx = getHotelContext();
  const select = document.getElementById("calendarHotelSelect");

  // ✅ 1. Anchor always starts from TODAY
  anchorDate = new Date();

  // ✅ 2. Build month/year dropdowns
  populateMonthYearSelectors();

  // ✅ 3. Sync dropdowns with anchorDate (CRITICAL)
  syncMonthYearDropdownWithAnchor();

  if (ctx && ctx.id && select) {
    selectedHotelId = ctx.id;
    select.value = ctx.id;
    select.disabled = true; // 🔒 hotel locked

    // ✅ 4. Load calendar from anchorDate
    loadCalendar(selectedHotelId);
  } else {
    loadCalendarHotels();
  }
});


  // ================================
  // EVENT LISTENERS
  // ================================
  document
    .getElementById("abCheckIn")
    .addEventListener("change", loadAvailableRooms);

  document
    .getElementById("abCheckOut")
    .addEventListener("change", loadAvailableRooms);

  document
    .getElementById("savePaymentBtn")
    .addEventListener("click", () => {
      if (isEditMode) {
        updateCalendarBooking();
      } else {
        saveBooking();
      }
    });

  



function loadAvailableRooms(preselectRoomName = null) {
  const bookingId = isEditMode ? editingBookingId : null;

  const checkIn = document.getElementById("abCheckIn").value;
  const checkOut = document.getElementById("abCheckOut").value;

  if (!checkIn || !checkOut || !selectedHotelId) return;

  fetch(
  `/api/rooms/available?hotelId=${selectedHotelId}&checkIn=${checkIn}&checkOut=${checkOut}&excludeBookingId=${bookingId || ""}`
)

    .then(res => res.json())
    .then(rooms => renderAvailableRooms(rooms, preselectRoomName))

    .catch(err => {
      console.error("Available rooms fetch error", err);
    });
}

//====================================================
//=====================Render Available Rooms=========
//====================================================
function renderAvailableRooms(rooms, preselectRoomName) {

  const container = document.getElementById("availableRooms");
  container.innerHTML = "";

  if (!isEditMode && !preselectRoomName) {
  selectedRooms = [];
}


  if (!rooms.length) {
    container.innerHTML = "<i>No rooms available</i>";
    return;
  }

  const grouped = {};
  rooms.forEach(r => {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push(r);
  });

  for (const category in grouped) {
    const section = document.createElement("div");
    section.className = "room-category";
    section.innerHTML = `<b>${category}</b>`;

    grouped[category].forEach(room => {
      const label = document.createElement("label");
      label.className = "room-option";

      label.innerHTML = `
        <input type="checkbox"
          data-room-id="${room.room_id}"
          data-room-name="${room.room_name}"
          data-room-category="${room.room_category_id}"
        />
        ${room.room_name}
      `;

      const checkbox = label.querySelector("input");

// ✅ Auto-check rooms already selected in EDIT mode
if (
  isEditMode &&
  selectedRooms.some(r => r.room_id === room.room_id)
) {
  checkbox.checked = true;
}


      // ✅ Auto-check clicked room (SAFE, no data mutation)
if (room.room_name === preselectRoomName) {
  checkbox.checked = true;

  // ✅ FORCE SYNC selectedRooms
  if (!selectedRooms.some(r => r.room_id === room.room_id)) {
    selectedRooms.push({
      room_id: room.room_id,
      room_name: room.room_name,
      room_category_id: room.room_category_id
    });
  }
}



      checkbox.addEventListener("change", e => {
        if (e.target.checked) {
          if (!selectedRooms.some(r => r.room_id === room.room_id)) {
            selectedRooms.push({
              room_id: room.room_id,
              room_name: room.room_name,
              room_category_id: room.room_category_id
            });
          }
        } else {
          selectedRooms = selectedRooms.filter(
            r => r.room_id !== room.room_id
          );
        }
      });

      section.appendChild(label);
    });

    container.appendChild(section);
  }
} // ✅ FUNCTION ENDS HERE


function recalcBalance() {
  const total = Number(totalAmount.value || 0);
  const advance = Number(advanceAmount.value || 0);
  balanceAmount.value = Math.max(total - advance, 0);
}

async function updateCalendarBooking() {
  if (!editingBookingId) return;

  const payload = {
    guest_name: abGuestName.value,
    guest_phone: abGuestPhone.value,
    check_in: abCheckIn.value,
    check_out: abCheckOut.value,
    notes: abNotes.value,
    total_amount: Number(totalAmount.value || 0),
    advance_amount: Number(advanceAmount.value || 0),
    hotel_payment_status:
      advanceAmount.value >= totalAmount.value
        ? "paid"
        : advanceAmount.value > 0
        ? "partial"
        : "unpaid",
    rooms: selectedRooms.map(r => ({
  room_id: r.room_id,
  room_category_id: r.room_category_id
}))

  };

  const res = await fetch(
    `/api/calendar/bookings/${editingBookingId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Update failed");
    return;
  }

  closeModal();

// ✅ Refresh calendar without losing session
loadCalendar(selectedHotelId);

}

function savePayment(bookingId) {
  fetch(`/api/bookings/${bookingId}/payment`, {

    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      total_amount: totalAmount.value,
      advance_amount: advanceAmount.value
    })
  })
    .then(res => res.json())
    .then(() => {
  alert("Payment updated");
  loadCalendar(selectedHotelId);
});

}

// ===========================================================
// Must stay DOMContentLoaded DATE RANGE PICKER (FINAL & SAFE)
// ===========================================================
document.addEventListener("DOMContentLoaded", () => {

  const rangePicker = flatpickr("#abDateRange", {
    mode: "range",
    dateFormat: "Y-m-d",
    minDate: null, // allow past dates (needed for edit)


    onChange(selectedDates) {
  if (isSyncingEditDates) return;

  if (selectedDates.length === 2) {

        const formatLocal = d =>
  d.getFullYear() + "-" +
  String(d.getMonth() + 1).padStart(2, "0") + "-" +
  String(d.getDate()).padStart(2, "0");

const checkIn = formatLocal(selectedDates[0]);
const checkOut = formatLocal(selectedDates[1]);


        document.getElementById("abCheckIn").value = checkIn;
        document.getElementById("abCheckOut").value = checkOut;

        loadAvailableRooms();
      }
    }
  });

  // expose globally for edit prefill
  window._abRangePicker = rangePicker;
});

// ======================================================
// 📅 CALENDAR LOADER (SINGLE SOURCE OF TRUTH)
// ======================================================
async function loadCalendar(hotelId, fromDate = null) {
  if (!hotelId) return;

  const start = (fromDate || anchorDate)
    .toISOString()
    .slice(0, 10);

  try {
    const res = await fetch(
  `${API}?hotelId=${hotelId}&from=${start}&days=${WINDOW_DAYS}`,
  {
    credentials: "include", // 🔑 THIS IS CRITICAL
    headers: {
      "Content-Type": "application/json"
    }
  }
);

    const data = await res.json();

    buildCalendar(data);

    // 🔄 Sync dropdowns AFTER render
    syncMonthYearDropdownWithAnchor();


  } catch (err) {
    console.error("Calendar load failed:", err);
  }
}


// ======================================================
// 📅 MONTH / YEAR SELECTORS
// ======================================================
function populateMonthYearSelectors() {
  const monthSel = document.getElementById("monthSelect");
  const yearSel = document.getElementById("yearSelect");

  if (!monthSel || !yearSel) return;

  monthSel.innerHTML = "";
  yearSel.innerHTML = "";

  const months = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec"
  ];

  months.forEach((m, i) => {
    monthSel.innerHTML += `<option value="${i}">${m}</option>`;
  });

  const currentYear = new Date().getFullYear();
  for (let y = currentYear - 1; y <= currentYear + 10; y++) {
    yearSel.innerHTML += `<option value="${y}">${y}</option>`;
  }

  monthSel.value = currentDate.getMonth();
  yearSel.value = currentDate.getFullYear();
}

// ======================================================
// 🔁 RELOAD CALENDAR BY MONTH/YEAR
// ======================================================
function reloadCalendarByMonth() {
  if (!selectedHotelId) {
    alert("Please select a hotel first");
    return;
  }

  const y = Number(document.getElementById("yearSelect").value);
  const m = Number(document.getElementById("monthSelect").value);

  // 🧠 Reposition anchorDate, not limit calendar
  anchorDate = new Date(y, m, 1);

  loadCalendar(selectedHotelId);
}


// ======================================================
// 📅 Cleaned MONTH / YEAR NAVIGATION (SAFE DOM BINDING)
// ======================================================
document.addEventListener("DOMContentLoaded", () => {
  const prevBtn = document.getElementById("prevMonth");
  const nextBtn = document.getElementById("nextMonth");
  const monthSel = document.getElementById("monthSelect");
  const yearSel = document.getElementById("yearSelect");

if (prevBtn) {
  prevBtn.onclick = () => {
    anchorDate.setDate(anchorDate.getDate() - WINDOW_DAYS);
    syncMonthYearDropdownWithAnchor(); // ✅ ADD THIS
    loadCalendar(selectedHotelId);
  };
}

if (nextBtn) {
  nextBtn.onclick = () => {
    anchorDate.setDate(anchorDate.getDate() + WINDOW_DAYS);
    syncMonthYearDropdownWithAnchor(); // ✅ ADD THIS
    loadCalendar(selectedHotelId);
  };
}


  if (monthSel) monthSel.onchange = reloadCalendarByMonth;
  if (yearSel) yearSel.onchange = reloadCalendarByMonth;
});


function syncMonthYearDropdownWithAnchor() {
  const monthSel = document.getElementById("monthSelect");
  const yearSel = document.getElementById("yearSelect");

  if (!monthSel || !yearSel) return;

  monthSel.value = anchorDate.getMonth();
  yearSel.value = anchorDate.getFullYear();
}

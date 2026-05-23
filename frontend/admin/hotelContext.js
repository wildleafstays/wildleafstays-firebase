// admin/hotelContext.js

const STORAGE_KEY = "admin_selected_hotel";

export function setHotelContext(hotel) {
  if (!hotel || !hotel.id) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(hotel));
}

export function getHotelContext() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearHotelContext() {
  localStorage.removeItem(STORAGE_KEY);
}

export function requireHotelContext() {
  const hotel = getHotelContext();
  if (!hotel) {
    alert("Please select a hotel first");
    window.location.href = "/admin/admin.html";
  }
  return hotel;
}

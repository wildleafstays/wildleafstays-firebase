const API_BASE = "/api";
const IMAGE_BASE = "";

const params = new URLSearchParams(window.location.search);
const roomId = params.get("roomId");

let images = [];
let currentIndex = 0;

document.addEventListener("DOMContentLoaded", () => {
  if (!roomId) {
    alert("Room not found");
    return;
  }

  loadRoomImages();
});

async function loadRoomImages() {
  try {
    const res = await fetch(`${API_BASE}/rooms/${roomId}/images`);
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      alert("No images found for this room.");
      return;
    }

    images = data.map(img => IMAGE_BASE + img.image_url);

    showImage(0);
    setupNavigation();

  } catch (err) {
    console.error("Error loading images:", err);
  }
}

function showImage(index) {
  currentIndex = index;
  document.getElementById("galleryImage").src = images[currentIndex];
}

function setupNavigation() {
  document.getElementById("prevBtn").onclick = () => {
    currentIndex = (currentIndex - 1 + images.length) % images.length;
    showImage(currentIndex);
  };

  document.getElementById("nextBtn").onclick = () => {
    currentIndex = (currentIndex + 1) % images.length;
    showImage(currentIndex);
  };
}

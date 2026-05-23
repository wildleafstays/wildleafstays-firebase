import { saveToken } from "./auth.js";

const API_BASE = "";

const form = document.getElementById("loginForm");
const errorMsg = document.getElementById("errorMsg");

form.addEventListener("submit", async e => {
  e.preventDefault();
  errorMsg.innerText = "";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!email || !password) {
    errorMsg.innerText = "Email and password are required";
    return;
  }

  try {
   const res = await fetch(
  `${API_BASE}/api/admin/login`,
  {

      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      errorMsg.innerText = data.error || "Invalid credentials";
      return;
    }

    saveToken(data.token);
    window.location.href = "/admin/hotel/dashboard.html";

  } catch (err) {
    console.error(err);
    errorMsg.innerText = "Server error. Try again.";
  }
});

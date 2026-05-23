const API_BASE = "";

const TOKEN_KEY = "adminToken";
const EXPIRY_KEY = "adminTokenExpiry";

/**
 * 💾 Save admin JWT token with expiry
 */
export function saveToken(token, expiresInSeconds = 60 * 60 * 6) {
  const expiryTime = Date.now() + expiresInSeconds * 1000;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EXPIRY_KEY, expiryTime.toString());
}

/**
 * 🔐 Get token (auto-expire)
 */
export function getToken() {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiry = localStorage.getItem(EXPIRY_KEY);

  if (!token || !expiry) return null;

  if (Date.now() > Number(expiry)) {
    logout();
    return null;
  }

  return token;
}

/**
 * 🚫 PAGE GUARD
 * Call once on protected pages
 */
export function authHeaders() {
  const token = getToken();
  if (!token) {
    window.location.href = "/admin/login.html";

    return null;
  }

  return {
    Authorization: "Bearer " + token
  };
}

/**
 * 🔁 Secure fetch (JSON + FormData safe)
 */
export async function secureFetch(url, options = {}) {
  const token = getToken();
  if (!token) return;

  const headers = {
    ...(options.headers || {}),
    Authorization: "Bearer " + token
  };

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const finalUrl = url.startsWith("http")
    ? url
    : API_BASE + url;

  const res = await fetch(finalUrl, {
    ...options,
    headers
  });

  if (res.status === 401 || res.status === 403) {
    logout();
    return;
  }

  return res;
}

/**
 * 🚪 Logout
 */
export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXPIRY_KEY);
  window.location.href = "/admin/login.html";

}

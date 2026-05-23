async function loadHeader() {
  try {
    // 1️⃣ Load header HTML
    const res = await fetch("/partials/header.html");
    const html = await res.text();
    document.getElementById("headerContainer").innerHTML = html;

    // 2️⃣ Load branding
    const brandingRes = await fetch("/api/branding");
    const data = await brandingRes.json();

    const logo = document.getElementById("siteLogo");
    const title = document.getElementById("siteTitle");

    if (logo && data.logo_url) {
      logo.src = `${data.logo_url}`;
    }

    if (title) {
      title.textContent = data.site_title || "The Lalitas Hospitality";
      title.style.cursor = "pointer";
    }

    // 3️⃣ Click → Home
    logo?.addEventListener("click", () => {
      window.location.href = "/index.html";
    });

    title?.addEventListener("click", () => {
      window.location.href = "/index.html";
    });

    // ✅ 4️⃣ Load header menu (MOVED HERE)
    await loadHeaderMenu();

  } catch (err) {
    console.error("Header load failed:", err);
  }
}

async function loadHeaderMenu() {
  try {
    const res = await fetch("/api/header-menu");
    const items = await res.json();

    const ul = document.getElementById("headerMenu");
    if (!ul) return;

    ul.innerHTML = "";

items
  .filter(item => item.is_active && item.label && item.url)
  .forEach(item => {
    const li = document.createElement("li");

    const a = document.createElement("a");
    a.href = item.url;
    a.textContent = item.label;

    // ✅ Active link detection
    if (window.location.pathname === new URL(item.url, location.origin).pathname) {
      a.classList.add("active");
    }

    li.appendChild(a);
    ul.appendChild(li);
  });



  } catch (err) {
    console.warn("Header menu not available");
  }
}

window.addEventListener("scroll", () => {
  const header = document.querySelector(".site-header");
  if (!header) return;

  if (window.scrollY > 8) {
    header.classList.add("scrolled");
  } else {
    header.classList.remove("scrolled");
  }
});

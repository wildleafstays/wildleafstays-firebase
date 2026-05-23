(function () {
  const token = localStorage.getItem("adminToken");

  if (!token) {
    window.location.href = "../login.html";
  }
})();

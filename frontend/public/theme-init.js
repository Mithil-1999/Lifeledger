// Apply the saved theme before first paint to avoid a light/dark flash.
// (A separate file, not inline, so the production Content-Security-Policy can forbid inline scripts.)
(function () {
  try {
    var t = localStorage.getItem("lifevault-theme") || "system";
    var dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();

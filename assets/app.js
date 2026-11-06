// Installable app: registers the service worker and shows "Install app" buttons
// (elements with data-install-app) when the phone offers installation.
// On iPhone (no install prompt), elements with data-install-ios show the Share → Add to Home Screen tip.
(() => {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (standalone) return;
  let deferred = null;
  const buttons = () => document.querySelectorAll("[data-install-app]");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); deferred = e;
    buttons().forEach((b) => b.classList.remove("hidden"));
  });
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-install-app]");
    if (!b || !deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch {}
    deferred = null; buttons().forEach((x) => x.classList.add("hidden"));
  });
  window.addEventListener("appinstalled", () => buttons().forEach((x) => x.classList.add("hidden")));
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  if (ios) document.addEventListener("DOMContentLoaded", () => document.querySelectorAll("[data-install-ios]").forEach((el) => el.classList.remove("hidden")));
})();

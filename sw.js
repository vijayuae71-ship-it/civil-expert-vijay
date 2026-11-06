/* Service worker: makes the site installable and lets the pages and calculators open offline.
 * Pages: network first (always fresh when online), cached copy when offline.
 * Styles/scripts/images: cached copy at once, refreshed in the background.
 * The AI chat itself needs the internet and is never cached. */
const VERSION = "cae-v1";
const CORE = [
  "/", "/index.html", "/expert.html", "/calculators.html", "/construction-faq.html", "/privacy.html", "/disclaimer.html",
  "/assets/site.css", "/assets/calc.js", "/assets/app.js", "/assets/site-config.js", "/assets/logo.svg",
  "/assets/icon-192.png", "/assets/apple-touch-icon.png", "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function offlinePage(request) {
  const url = new URL(request.url);
  const cache = await caches.open(VERSION);
  return (await cache.match(request, { ignoreSearch: true }))
    || (await cache.match(url.pathname.replace(/\/$/, "/index") + ".html"))
    || (await cache.match(url.pathname + ".html"))
    || (await cache.match("/calculators.html"));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/.netlify/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) { const copy = response.clone(); caches.open(VERSION).then((c) => c.put(url.pathname, copy)); }
      return response;
    }).catch(() => offlinePage(request)));
    return;
  }

  event.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(request, { ignoreSearch: true });
    const fresh = fetch(request).then((response) => { if (response.ok) cache.put(request, response.clone()); return response; }).catch(() => cached);
    return cached || fresh;
  }));
});

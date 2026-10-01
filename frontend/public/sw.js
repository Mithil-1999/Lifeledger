/*
 * LifeVault service worker: makes the app installable and quick to open.
 *
 * Privacy rule: only the app SHELL (HTML, JS, CSS, icons) is ever cached. Requests to
 * /api/ are never intercepted or stored, so financial data, vault entries, notes and
 * documents always come fresh from the server and are never left on the device.
 */
const SHELL_CACHE = "lifevault-shell-v1";
const SHELL_FILES = ["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/icon-512.png", "/theme-init.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Only same-origin GETs, and never the API (personal data must not be cached).
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Pages: network first (always the latest release), cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(() => caches.match("/").then((cached) => cached || new Response("LifeVault is offline.", { status: 503 }))),
    );
    return;
  }

  // Build assets have content hashes in their names, so a cached copy is always correct.
  if (url.pathname.startsWith("/assets/") || SHELL_FILES.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok && url.pathname.startsWith("/assets/")) {
              const copy = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

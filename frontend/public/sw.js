// Service worker: makes the site installable and keeps the app shell (HTML, JS, CSS) available.
// It never touches the API or the receipt photos: those live on other origins (API Gateway, S3)
// and are private, so only requests to our own site are handled here.
const CACHE = "receipt-scanner-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/", "/icon-192.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Try the network, remember the answer, fall back to the remembered one when offline.
async function networkFirst(request, key = request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(CACHE)).put(key, response.clone());
    return response;
  } catch {
    const cached = await caches.match(key);
    if (cached) return cached;
    throw new Error("offline");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/"));
  } else if (url.pathname === "/config.json") {
    event.respondWith(networkFirst(request));
  } else if (url.pathname.startsWith("/assets/")) {
    // Hashed file names never change their content: cache first.
    event.respondWith(caches.match(request).then((hit) => hit || networkFirst(request)));
  }
});

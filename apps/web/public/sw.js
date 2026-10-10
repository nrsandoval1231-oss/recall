/* Recall app shell. Private API and enrollment responses are never cached. */
const SHELL = "recall-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) =>
        cache.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"]),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;
  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await cache.match("/");
      if (shell) return shell;
    }
    return new Response(
      "Recall is offline. This installed app cannot answer from memory until the connection returns.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
}

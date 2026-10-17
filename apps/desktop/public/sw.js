/* global self, caches, URL, fetch, importScripts */
/* Cache only public app assets. Authenticated APIs, source bytes and sessions are
   always network-only; private offline data belongs in the explicit outbox. */
importScripts("/shell-assets.js");
const CACHE = "megraph-shell-" + self.MEGRAPH_SHELL.join("|");
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(self.MEGRAPH_SHELL)));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("megraph-shell-") && key !== CACHE).map(key => caches.delete(key)))));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET" || url.pathname.startsWith("/v1/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
  } else if (/^\/(assets|fonts|brand)\//.test(url.pathname)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) { const copy = response.clone(); void caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
      return response;
    })));
  }
});

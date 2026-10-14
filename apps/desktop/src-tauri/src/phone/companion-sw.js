/* Cache only the public shell. Never cache library identities, Ask, receipts or sources. */
const SHELL = 'recall-companion-shell-v1';
const ASSETS = ['/', '/companion.js', '/manifest.webmanifest', '/icon.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('recall-companion-shell-') && key !== SHELL).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search || !ASSETS.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then(async response => {
    if (response.ok) { const cache = await caches.open(SHELL); await cache.put(event.request, response.clone()); }
    return response;
  }).catch(() => caches.match(event.request)));
});

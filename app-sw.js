// Service Worker — Estima Food PWA
const CACHE = 'ef-pwa-v1';
const PRECACHE = ['/app.html', '/api-client.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // API e SSE: sempre da rede
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/sse')) return;
  // HTML e JS: sempre da rede
  const ext = url.pathname.split('.').pop();
  if (['html','js'].includes(ext)) { e.respondWith(fetch(e.request).catch(() => caches.match(e.request))); return; }
  // Resto: cache-first
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});

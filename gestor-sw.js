// gestor-sw.js — Service Worker sem cache
// Atualizado para sempre buscar arquivos frescos do servidor (sem cache de JS/HTML)

self.addEventListener('install', (event) => {
  // Ativa imediatamente sem esperar páginas antigas fecharem
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Toma controle de todas as páginas imediatamente
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => {
        console.log('[SW] Removendo cache antigo:', key);
        return caches.delete(key);
      }))
    ).then(() => self.clients.claim())
  );
});

// Pass-through: todos os requests vão direto para a rede
// Arquivos .js e .html NUNCA são cacheados para garantir versões atualizadas
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const ext = url.pathname.split('.').pop().toLowerCase();

  // APIs e metodos de escrita sempre passam direto pela rede.
  // Evita que POST/PATCH/DELETE fiquem presos em fallback de cache.
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/rest/v1/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // JS, HTML e CSS sempre da rede — nunca do cache
  if (['js', 'html', 'css'].includes(ext)) {
    event.respondWith(fetch(event.request));
    return;
  }
  // Outros recursos (imagens, etc): tenta rede, fallback cache
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

// ══ CARDÁPIO SERVICE WORKER ══════════════════════════════════
// Único propósito: satisfazer o requisito do Chrome/Android pra permitir
// "Adicionar à tela inicial" como app instalável. De propósito NÃO faz
// cache agressivo de nada — cardápio precisa sempre mostrar preço e
// disponibilidade atualizados, nunca uma versão antiga guardada.
// Sempre busca da rede; só usa o cache como último recurso se a rede
// cair de verdade (ex: sem internet no momento).

const SW_VERSION = 'cardapio-sw-v2';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', e => {
  // Nunca intercepta o carregamento da própria página (navegação) — deixa
  // o navegador cuidar disso diretamente, sem passar pelo service worker.
  // Interceptar isso é uma causa clássica de tela de carregamento que
  // trava pra sempre em alguns navegadores/apps instalados: se o
  // "re-fetch" aqui dentro falhar por qualquer motivo, a página inteira
  // nunca termina de abrir.
  if (e.request.mode === 'navigate') return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

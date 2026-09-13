// ══ CARDÁPIO SERVICE WORKER ══════════════════════════════════
// Dois propósitos agora:
// 1) Satisfazer o requisito do Chrome/Android pra permitir "Adicionar à
//    tela inicial" como app instalável.
// 2) Guardar em cache só os ARQUIVOS DE CÓDIGO do cardápio (os .js da
//    pasta /cardapio/ e imagens/ícones estáticos) — pra abrir muito mais
//    rápido numa segunda visita. Isso NUNCA inclui chamadas de API nem
//    dados do cardápio (preço, produto, disponibilidade) — essas
//    continuam sempre buscando na rede, na hora, sem cache nenhum. Preço
//    e item pausado do gestor não são afetados por isto de jeito nenhum.

const SW_VERSION = 'cardapio-sw-v3';
const CACHE_NAME = SW_VERSION;

// Só entra em cache o que bate com um desses padrões — de propósito uma
// lista pequena e específica, pra nunca guardar algo que devia vir
// sempre fresco (API, HTML da página, etc.)
function _ehAssetEstatico(url) {
  if (url.pathname.startsWith('/cardapio/') && url.pathname.endsWith('.js')) return true;
  if (/\.(png|jpg|jpeg|webp|svg|ico|woff2?|ttf)$/i.test(url.pathname)) return true;
  return false;
}

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Limpa caches de versões antigas — sem isso, cada atualização deixa
    // lixo acumulado guardado no aparelho do cliente pra sempre.
    const nomes = await caches.keys();
    await Promise.all(nomes.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
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

  const url = new URL(e.request.url);

  if (_ehAssetEstatico(url)) {
    // Cache-first: se já tem guardado, usa na hora (nem espera a rede) —
    // é isso que faz a segunda visita abrir bem mais rápido. Se não tem
    // ainda, busca da rede e guarda uma cópia pra próxima vez.
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(e.request);
      if (cached) return cached;
      try {
        const resp = await fetch(e.request);
        if (resp.ok) cache.put(e.request, resp.clone());
        return resp;
      } catch (err) {
        return cached || Response.error();
      }
    })());
    return;
  }

  // Tudo o mais (API, dados do cardápio, etc.) — sempre busca da rede,
  // exatamente como antes. Só cai pro cache (se existir) se a rede cair
  // de verdade, como um último recurso.
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

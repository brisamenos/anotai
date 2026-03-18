// ══ GESTOR SERVICE WORKER ══════════════════
const SUPA_URL = '' /* usa URL relativa ao servidor */;
const SUPA_ANON = '' /* não usado mais */;
const POLL_MS   = 15000; // polling a cada 15s em background

let pollTimer      = null;
let lastOrderIds   = new Set();
let lastMesaOrders = new Set(); // IDs de pedidos de mesa conhecidos

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ── Mensagens da página ──────────────────
self.addEventListener('message', e => {
  const { type, orderIds, mesaOrderIds } = e.data || {};

  if (type === 'INIT') {
    if (orderIds)     lastOrderIds   = new Set(orderIds);
    if (mesaOrderIds) lastMesaOrders = new Set(mesaOrderIds);
    startPolling();
  }
  if (type === 'SYNC') {
    if (orderIds)     lastOrderIds   = new Set(orderIds);
    if (mesaOrderIds) lastMesaOrders = new Set(mesaOrderIds);
  }
  if (type === 'STOP') {
    stopPolling();
  }
});

function startPolling() {
  stopPolling();
  pollTimer = setInterval(doPoll, POLL_MS);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function doPoll() {
  try {
    const headers = { "Content-Type": "application/json" };

    // 1. Pedidos delivery/balcão novos em análise
    const ordRes = await fetch(
      `${SUPA_URL}/rest/v1/orders?status=in.(analise)&select=id,client,items,addr&order=id.desc&limit=20`,
      { headers }
    );
    if (ordRes.ok) {
      const orders = await ordRes.json();
      for (const o of orders) {
        if (!lastOrderIds.has(o.id)) {
          const items = Array.isArray(o.items) ? o.items.map(i=>`${i.qty}x ${i.name}`).join(', ') : '';
          notify(`🛎️ Novo pedido #${o.id}`, `${o.client} — ${items}`);
          lastOrderIds.add(o.id);
        }
      }
    }

    // 2. Pedidos de mesa novos (analise ou producao)
    const mesaRes = await fetch(
      `${SUPA_URL}/rest/v1/orders?mesa_num=not.is.null&status=in.(analise,producao)&select=id,client,mesa_num,items&order=id.desc&limit=20`,
      { headers }
    );
    if (mesaRes.ok) {
      const orders = await mesaRes.json();
      for (const o of orders) {
        if (!lastMesaOrders.has(o.id)) {
          const items = Array.isArray(o.items) ? o.items.map(i=>`${i.qty}x ${i.name}`).join(', ') : '';
          notify(`🍽️ Pedido Mesa ${o.mesa_num} #${o.id}`, items || 'Novo pedido de mesa');
          lastMesaOrders.add(o.id);
        }
      }
    }

    // Avisa a página para sincronizar se estiver aberta
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.postMessage({ type: 'SW_POLL_DONE' }));

  } catch(e) {}
}

function notify(title, body) {
  if (self.Notification?.permission === 'granted') {
    self.registration.showNotification(title, {
      body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      vibrate: [200, 100, 200],
      tag: 'gestor-' + Date.now(),
      requireInteraction: true, // gestor precisa ver — fica até clicar
    });
  }
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const c of clients) {
        if (c.url.includes('gestor') && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./gestor.html');
    })
  );
});

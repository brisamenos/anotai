// ══ GARCOM SERVICE WORKER ══════════════════
// Mantém polling em background e envia notificações
// mesmo com a aba fechada ou minimizada.

const SW_VERSION  = 'garcom-sw-v3';
const POLL_MS     = 20000; // polling a cada 20s quando em background

let pollTimer     = null;
let garcomId      = null;
let tenantId      = null; // ← novo: filtra por restaurante
let lastOrderIds  = new Set();
let lastMesaState = {}; // num → status

// ── Instalação ───────────────────────────
self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

// ── Mensagens da página ──────────────────
self.addEventListener('message', e => {
  const { type, garcom_id, tenant_id, orderIds, mesaState } = e.data || {};

  if (type === 'INIT') {
    garcomId = garcom_id;
    tenantId = tenant_id || null;
    // Inicializa o estado conhecido (não notifica no boot)
    if (orderIds)   lastOrderIds  = new Set(orderIds);
    if (mesaState)  lastMesaState = mesaState;
    startPolling();
  }

  if (type === 'LOGOUT') {
    garcomId = null;
    tenantId = null;
    stopPolling();
  }

  if (type === 'SYNC') {
    // Página ativa enviou estado atualizado — sincroniza sem notificar
    if (orderIds)  lastOrderIds  = new Set(orderIds);
    if (mesaState) lastMesaState = mesaState;
  }
});

// ── Polling ──────────────────────────────
function startPolling() {
  stopPolling();
  pollTimer = setInterval(doPoll, POLL_MS);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function doPoll() {
  if (!garcomId) return;

  const headers = { "Content-Type": "application/json" };
  if (tenantId) headers['x-tenant-id'] = tenantId;

  try {
    // 1. Verifica mesas (mudança de status)
    const mesaRes = await fetch(
      `/api/mesas?select=num,status&order=num`,
      { headers }
    );
    if (mesaRes.ok) {
      const mesas = await mesaRes.json();
      for (const m of mesas) {
        const prev = lastMesaState[m.num];
        if (prev && prev !== m.status) {
          if (m.status === 'free') {
            notify('✅ Mesa liberada', `Mesa ${m.num} foi liberada pelo caixa`);
          } else if (m.status === 'waiting') {
            notify('⏳ Aguardando pagamento', `Mesa ${m.num} aguardando pagamento`);
          }
        }
        lastMesaState[m.num] = m.status;
      }
    }

    // 2. Verifica pedidos novos (status mudou para producao ou pronto)
    const ordRes = await fetch(
      `/api/orders?garcom_id=eq.${garcomId}&status=in.(producao,pronto,analise)&select=id,status,items,mesa_num&order=id.desc&limit=20`,
      { headers }
    );
    if (ordRes.ok) {
      const orders = await ordRes.json();
      for (const o of orders) {
        if (!lastOrderIds.has(o.id)) {
          const items = Array.isArray(o.items)
            ? o.items.map(i => `${i.qty}x ${i.name}`).join(', ')
            : '';
          notify(`🛎️ Pedido #${o.id} — Mesa ${o.mesa_num}`, items || 'Novo pedido recebido');
          lastOrderIds.add(o.id);
        }
      }
      // Limpa IDs que não estão mais ativos
      const activeIds = new Set(orders.map(o => o.id));
      for (const id of lastOrderIds) {
        if (!activeIds.has(id)) lastOrderIds.delete(id);
      }
    }

    // Notifica a página (se aberta) para sincronizar
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.postMessage({ type: 'SW_POLL_DONE' }));

  } catch (err) {
    // Falha silenciosa — vai tentar na próxima rodada
  }
}

// ── Notificações ─────────────────────────
function notify(title, body) {
  if (self.Notification && self.Notification.permission === 'granted') {
    self.registration.showNotification(title, {
      body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      vibrate: [200, 100, 200],
      tag: 'garcom-' + Date.now(),
      requireInteraction: false,
    });
  }
}

// Clique na notificação → abre/foca a aba do garçom
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const c of clients) {
        if (c.url.includes('garcom') && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./garcom.html');
    })
  );
});

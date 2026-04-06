// ══════════════════════════════════════════
//  TRACKING — Acompanhamento de pedido, cancelamento
//  Estima Food — Cardápio
// ══════════════════════════════════════════
// ══════════════════════════════════════════
//  TRACKER
// ══════════════════════════════════════════
const STEPS = [
  {
    key:   ['aguardando_pix'],
    icon:  '💠',
    title: 'Aguardando pagamento',
    desc:  'Faça o PIX para a chave enviada no WhatsApp. Assim que confirmarmos, seu pedido entra na fila!'
  },
  {
    key:   ['aguardando_cartao'],
    icon:  '💳',
    title: 'Aguardando pagamento',
    desc:  'Conclua o pagamento com cartão para seu pedido entrar na fila!'
  },
  {
    key:   ['analise'],
    icon:  '✓',
    title: 'Pedido recebido!',
    desc:  'Seu pedido foi recebido e está aguardando confirmação'
  },
  {
    key:   ['producao','pronto'],
    icon:  '~',
    title: 'Preparando!',
    desc:  'A cozinha está preparando seu pedido com carinho'
  },
  {
    key:   ['saiu','entregue','finalizado'],
    icon:  '→',
    title: 'Saindo para entrega!',
    desc:  'Seu pedido está a caminho. Logo chegará!'
  },
];
const STATUS_ORDER = ['aguardando_pix','aguardando_cartao','analise','producao','pronto','saiu','entregue','finalizado'];

function stepIndexFor(status) {
  return STEPS.findIndex(s => s.key.includes(status));
}

function startTracking(orderId, items, client, addr, initialStatus) {
  _trackOrderId = orderId;
  _initialOrderStatus = initialStatus || 'analise';
  const fab = document.getElementById('track-fab');
  fab.classList.add('show');
  document.getElementById('track-num').textContent = '#' + String(_orderNum(orderId)).padStart(3,'0');
  if (_trackChannel) { try { sb.removeChannel(_trackChannel); } catch(e){} }
  _trackChannel = sb.channel('orders-rt')
    .on('postgres_changes',{event:'UPDATE',table:'orders'}, p => {
      if (Number(p.new.id) === orderId) {
        updateTracker(p.new.status);
        const dot = document.getElementById('track-dot');
        if (dot) dot.classList.toggle('done', ['entregue','finalizado'].includes(p.new.status));
      }
    })
    .subscribe();
  updateTracker(_initialOrderStatus || 'analise', addr);
  renderTrackItems(items, client);
  document.getElementById('track-order-num').textContent = 'Pedido #' + String(_orderNum(orderId)).padStart(3,'0');
}

function updateTracker(status, addr) {
  const curIdx = stepIndexFor(status);
  const tl     = document.getElementById('track-timeline');
  if (!tl) return;
  const _addr = (addr || '').toLowerCase();
  const isRetirada = _addr.startsWith('retirada') || _addr.startsWith('mesa');
  const steps = STEPS.map((s, i) => {
    if (i === STEPS.length - 1 && isRetirada) return { ...s, title: 'Seu pedido está pronto!', desc: 'Pode vir buscar — seu pedido está pronto para retirada!' };
    return s;
  });
  if (status === 'cancelado') {
    tl.innerHTML = `<div class="tstep"><div class="tstep-left"><div class="tstep-icon" style="background:rgba(239,68,68,.12);border-color:var(--red)">✕</div></div><div class="tstep-content"><div class="tstep-title" style="color:var(--red)">Pedido cancelado</div><div class="tstep-desc">Este pedido foi cancelado.</div></div></div>`;
    const cw = document.getElementById('track-cancel-wrap'); if (cw) cw.style.display = 'none';
    document.getElementById('track-fab')?.classList.remove('show');
    try { localStorage.removeItem('ef_order_' + (_tenantId||'')); } catch(e) {}
    return;
  }
  tl.innerHTML = steps.map((s, i) => {
    const isDone   = i < curIdx;
    const isActive = i === curIdx;
    const isLast   = i === steps.length - 1;
    return `
    <div class="tstep">
      <div class="tstep-left">
        <div class="tstep-icon ${isDone ? 'done' : isActive ? 'active' : ''}">${isDone ? '✓' : s.icon}</div>
        ${!isLast ? `<div class="tstep-line ${isDone ? 'done' : ''}"></div>` : ''}
      </div>
      <div class="tstep-content">
        <div class="tstep-title ${isDone ? 'done' : isActive ? 'active' : ''}">${s.title}</div>
        <div class="tstep-desc">${s.desc}</div>
      </div>
    </div>`;
  }).join('');
  const cancelWrap = document.getElementById('track-cancel-wrap');
  if (cancelWrap) cancelWrap.style.display = ['analise','aguardando_pix','aguardando_cartao'].includes(status) ? '' : 'none';
}

function renderTrackItems(items, client) {
  const el = document.getElementById('track-items-list');
  if (!el) return;
  el.innerHTML = items.map(i => `
    <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;color:var(--muted2)">
      <span>${i.qty}× ${i.name}${i.obs?` <span style="color:var(--muted);font-size:11px">(${i.obs})</span>`:''}</span>
      <span>R$ ${fmt(i.price*i.qty)}</span>
    </div>`).join('');
}

function openTracker()  { document.getElementById('track-drawer-bg').classList.add('on'); }
function closeTracker() { document.getElementById('track-drawer-bg').classList.remove('on'); }

async function solicitarCancelamento() {
  if (!_trackOrderId) return;
  if (!confirm('Tem certeza que deseja cancelar este pedido?')) return;
  const btn = document.getElementById('track-cancel-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Cancelando…'; }
  try {
    const res = await fetch(`/api/orders?id=eq.${_trackOrderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': _tenantId },
      body: JSON.stringify({ status: 'cancelado' })
    });
    if (!res.ok) throw new Error('Erro ao cancelar');
    toast('✅', 'Pedido cancelado.');
    updateTracker('cancelado');
    closeTracker();
    try { localStorage.removeItem('ef_order_' + (_tenantId||'')); } catch(e) {}
    try { const u=new URL(window.location.href); u.searchParams.delete('acompanhar'); window.history.replaceState({},'',u.toString()); } catch(e) {}
  } catch(e) {
    toast('❌', 'Não foi possível cancelar.');
    if (btn) { btn.disabled = false; btn.textContent = '✕ Cancelar pedido'; }
  }
}

// ── Restaura tracker ao recarregar ──
// Prioridade: URL ?acompanhar → localStorage
window.addEventListener('load', () => {
  setTimeout(async () => {
    try {
      const tid = _tenantId;
      if (!tid) return;

      // Tenta URL primeiro
      let orderId = parseInt(new URLSearchParams(window.location.search).get('acompanhar')) || null;

      // Fallback: localStorage
      if (!orderId) {
        const raw = localStorage.getItem('ef_order_' + tid);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.orderId && Date.now() - saved.ts < 4 * 60 * 60 * 1000) {
            orderId = saved.orderId;
          } else {
            localStorage.removeItem('ef_order_' + tid);
          }
        }
      }

      if (!orderId) return;

      // Busca pedido no servidor
      const r = await fetch('/api/orders?id=eq.' + orderId + '&select=id,client,items,status,addr', {
        headers: { 'x-tenant-id': tid }
      });
      if (!r.ok) return;
      const rows = await r.json();
      const o = Array.isArray(rows) ? rows[0] : rows;
      if (!o) return;

      // Só mostra se pedido ainda está em andamento
      if (['entregue','finalizado','cancelado'].includes(o.status)) {
        localStorage.removeItem('ef_order_' + tid);
        return;
      }

      const items = Array.isArray(o.items) ? o.items
        : (typeof o.items === 'string' ? JSON.parse(o.items||'[]') : []);

      startTracking(o.id, items, o.client || '', o.addr || '', o.status);

      // Sincroniza URL
      try {
        const u = new URL(window.location.href);
        if (!u.searchParams.get('acompanhar')) {
          u.searchParams.set('acompanhar', o.id);
          window.history.replaceState({}, '', u.toString());
        }
      } catch(e) {}

    } catch(e) {}
  }, 1500);
});

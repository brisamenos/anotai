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

function startTracking(orderId, items, client, addr, initialStatus, orderNum, details) {
  _trackOrderId = orderId;
  _initialOrderStatus = initialStatus || 'analise';
  const fab = document.getElementById('track-fab');
  fab.classList.add('show');
  const numLabel = orderNum ? '#' + String(orderNum).padStart(3,'0') : 'Pagamento pendente';
  document.getElementById('track-num').textContent = numLabel;
  if (_trackChannel) { try { sb.removeChannel(_trackChannel); } catch(e){} }
  _trackChannel = sb.channel('orders-rt')
    .on('postgres_changes',{event:'UPDATE',table:'orders'}, p => {
      if (Number(p.new.id) === orderId) {
        updateTracker(p.new.status);
        if (p.new.order_num) {
          const novoNum = '#' + String(p.new.order_num).padStart(3,'0');
          document.getElementById('track-num').textContent = novoNum;
          document.getElementById('track-order-num').textContent = 'Pedido ' + novoNum;
        }
        const dot = document.getElementById('track-dot');
        if (dot) dot.classList.toggle('done', ['entregue','finalizado'].includes(p.new.status));
      }
    })
    .subscribe();
  updateTracker(_initialOrderStatus || 'analise', addr);
  renderTrackItems(items, client, { ...(details || {}), addr });
  document.getElementById('track-order-num').textContent = orderNum ? 'Pedido ' + numLabel : 'Pedido aguardando pagamento';
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

function _trackEsc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function _trackItemPrice(i) {
  const n = Number(i?.price ?? i?.preco ?? i?.valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function _trackItemQty(i) {
  const n = Number(i?.qty ?? i?.quantidade ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function _trackPayLabel(pag) {
  return ({
    dinheiro: 'Dinheiro',
    credito: 'Cartao de credito',
    debito: 'Cartao de debito',
    pix: 'PIX',
    pix_manual: 'PIX',
    cartao_mp: 'Cartao online'
  })[pag] || pag || '';
}

function _trackDeliveryKind(addr) {
  const text = String(addr || '').trim();
  const lower = text.toLowerCase();
  if (/^mesa\b/i.test(text)) return { label: 'Mesa', detail: text };
  if (/^retirada\b/i.test(text) || lower.includes('balc')) return { label: 'Retirada', detail: text || 'Retirada no balcao' };
  if (text) return { label: 'Entrega', detail: text };
  return { label: 'Retirada', detail: 'Retirada no balcao' };
}

function renderTrackItems(items, client, details) {
  const el = document.getElementById('track-items-list');
  if (!el) return;
  const list = Array.isArray(items) ? items : [];
  const subtotal = list.reduce((s, i) => s + _trackItemPrice(i) * _trackItemQty(i), 0);
  const hasTotal = details && details.total !== undefined && details.total !== null;
  const totalItens = hasTotal ? Number(details.total || 0) : subtotal;
  const taxa = Number(details?.taxa || 0);
  const desconto = Math.max(0, subtotal - totalItens);
  const totalFinal = Math.max(0, totalItens + taxa);
  const entrega = _trackDeliveryKind(details?.addr || '');
  const pag = _trackPayLabel(details?.pag || '');
  const rows = list.map(i => `
    <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;color:var(--muted2)">
      <span>${_trackItemQty(i)}× ${_trackEsc(i.name || i.nome || 'Item')}${i.obs?` <span style="color:var(--muted);font-size:11px">(${_trackEsc(i.obs)})</span>`:''}</span>
      <span>R$ ${fmt(_trackItemPrice(i)*_trackItemQty(i))}</span>
    </div>`).join('');
  el.innerHTML = (rows || '<div style="font-size:12px;color:var(--muted)">Itens do pedido</div>') + `
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--muted2)">
      ${subtotal > 0 ? `<div style="display:flex;justify-content:space-between"><span>Subtotal dos itens</span><strong style="color:var(--text)">R$ ${fmt(subtotal)}</strong></div>` : ''}
      ${desconto > 0.009 ? `<div style="display:flex;justify-content:space-between;color:var(--green)"><span>Descontos/Cashback</span><strong>-R$ ${fmt(desconto)}</strong></div>` : ''}
      ${entrega.label === 'Entrega' ? `<div style="display:flex;justify-content:space-between"><span>Taxa de entrega</span><strong style="color:var(--text)">R$ ${fmt(taxa)}</strong></div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:14px;padding-top:4px;border-top:1px solid var(--border)"><span style="font-weight:700;color:var(--text)">Total</span><strong style="color:var(--accent)">R$ ${fmt(totalFinal)}</strong></div>
      <div style="margin-top:6px;line-height:1.45"><strong style="color:var(--text)">${_trackEsc(entrega.label)}:</strong> ${_trackEsc(entrega.detail)}</div>
      ${pag ? `<div><strong style="color:var(--text)">Pagamento:</strong> ${_trackEsc(pag)}</div>` : ''}
    </div>`;
}

function openTracker()  { document.getElementById('track-drawer-bg').classList.add('on'); }
function closeTracker() { document.getElementById('track-drawer-bg').classList.remove('on'); }

async function solicitarCancelamento() {
  if (!_trackOrderId) return;
  if (!confirm('Tem certeza que deseja cancelar este pedido?')) return;
  const btn = document.getElementById('track-cancel-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Cancelando…'; }
  try {
    // Usa endpoint dedicado e seguro (valida ownership e status permitido)
    const headers = { 'Content-Type': 'application/json', 'x-tenant-id': _tenantId };
    try {
      const tk = localStorage.getItem('ef_customer_token_' + (_tenantId||''));
      if (tk) headers['Authorization'] = 'Bearer ' + tk;
    } catch(_) {}
    // Pega o phone do customer logado (fallback pro acesso anônimo via phone do pedido)
    let phoneFallback = '';
    try {
      const rawCustomer = _customer || (typeof _loadCustomerSessionForTenant === 'function' ? _loadCustomerSessionForTenant() : null);
      phoneFallback = (rawCustomer?.phone || '').replace(/\D/g,'');
    } catch(_) {}
    const res = await fetch('/api/customer-cancel-order', {
      method: 'POST',
      headers,
      body: JSON.stringify({ order_id: _trackOrderId, phone: phoneFallback })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro ao cancelar');
    toast('✅', 'Pedido cancelado.');
    updateTracker('cancelado');
    closeTracker();
    try { localStorage.removeItem('ef_order_' + (_tenantId||'')); } catch(e) {}
    try { const u=new URL(window.location.href); u.searchParams.delete('acompanhar'); window.history.replaceState({},'',u.toString()); } catch(e) {}
  } catch(e) {
    toast('❌', e.message || 'Não foi possível cancelar.');
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
      const r = await fetch('/api/orders?id=eq.' + orderId + '&select=id,order_num,client,items,status,addr,total,taxa,pag,troco', {
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

      startTracking(o.id, items, o.client || '', o.addr || '', o.status, o.order_num, {
        total: o.total,
        taxa: o.taxa,
        pag: o.pag,
        troco: o.troco
      });

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

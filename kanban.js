// ─────────────────────────────────────────
// KANBAN
// ─────────────────────────────────────────
function renderKanban(){
  const statuses=['analise','producao','pronto'];
  statuses.forEach(st=>{
    const col=document.getElementById('col-'+st);
    const cnt=document.getElementById('cnt-'+st);
    let filtered=ordersKanban.filter(o=>o.status===st);
    if(_kanbanFilter==='delivery') filtered=filtered.filter(o=>o.addr&&!o.addr.includes('Mesa')&&!o.addr.toLowerCase().includes('retirada')&&!o.addr.toLowerCase().includes('balcão')&&!o.addr.toLowerCase().includes('balcao'));
    if(_kanbanFilter==='balcao')   filtered=filtered.filter(o=>!o.addr||o.addr.toLowerCase().includes('retirada')||o.addr.toLowerCase().includes('balcão')||o.addr.toLowerCase().includes('balcao'));
    if(_kanbanFilter==='mesa')     filtered=filtered.filter(o=>o.mesa_num||(o.addr&&o.addr.includes('Mesa')));
    if(cnt) cnt.textContent=filtered.length;
    if(!col) return;
    if(filtered.length===0){
      col.innerHTML='<div class="kol-empty">Nenhum pedido no momento.<br>Receba pedidos e visualize aqui.</div>';
    } else {
      col.innerHTML=filtered.map(o=>{
        const itemStr=o.items.map(i=>i.qty+'x '+i.name).join(', ');
        const total='R$ '+(o.total+o.taxa).toFixed(2).replace('.',',');

        // ── Tipo de entrega ──────────────────────────────
        const isMesa     = !!(o.mesa_num||(o.addr&&o.addr.includes('Mesa')));
        const isRetirada = !isMesa && !!(o.addr&&(o.addr.toLowerCase().includes('retirada')||o.addr.toLowerCase().includes('balcão')||o.addr.toLowerCase().includes('balcao')));
        const isDelivery = !isMesa && !isRetirada;
        const _tipoBadge = isMesa
          ? `<span class="oc-tipo-badge oc-tipo-mesa">🍽️ Mesa ${o.mesa_num||''}</span>`
          : isRetirada
          ? `<span class="oc-tipo-badge oc-tipo-retirada">🏪 Retirada</span>`
          : `<span class="oc-tipo-badge oc-tipo-delivery">🛵 Delivery</span>`;

        // ── Botões de ação por tipo ──────────────────────
        let actionBtn='';
        if(st==='analise'){
          const _pixManualBtn = o.pag === 'pix_manual' ? '<button class="oc-btn oc-btn-pix-confirmar" onclick="event.stopPropagation();confirmarPagamentoPix('+o.id+')">&#9989; Confirmar Pago PIX</button>' : '';
          actionBtn= _pixManualBtn+
            '<button class="oc-btn oc-btn-ok" onclick="event.stopPropagation();advanceOrderById('+o.id+')">✔ Confirmar</button>'+
            '<button class="oc-btn oc-btn-no" onclick="event.stopPropagation();cancelOrderById('+o.id+')">✕ Cancelar</button>'+
            (_printMode==='manual'?'<button class="oc-btn" style="background:rgba(59,130,246,.15);color:#93c5fd;border:1px solid rgba(59,130,246,.25)" onclick="event.stopPropagation();printOrderById('+o.id+')">🖨️</button>':'');
        } else if(st==='producao'){
          const prontoLabel = isMesa ? '🍽️ Pronto p/ servir!' : isRetirada ? '✅ Pronto no balcão!' : '🚀 Pronto!';
          actionBtn='<button class="oc-btn oc-btn-ok" onclick="event.stopPropagation();advanceOrderById('+o.id+')">'+prontoLabel+'</button>'+(_printMode==='manual'?'<button class="oc-btn" style="background:rgba(59,130,246,.15);color:#93c5fd;border:1px solid rgba(59,130,246,.25)" onclick="event.stopPropagation();printOrderById('+o.id+')">🖨️</button>':'');
        } else {
          const finLabel = isMesa ? '✔ Servido!' : isRetirada ? '✔ Retirado!' : '✔ Finalizar';
          actionBtn='<button class="oc-btn oc-btn-fin" onclick="event.stopPropagation();finishOrderById('+o.id+')">'+finLabel+'</button>';
        }

        // Badge de pagamento
        const _pagBadge = (() => {
          const p = o.pag || '';
          if (p === 'pix_mp' || p === 'pix') return '<div class="oc-pag-badge oc-pag-pix">&#9889; PAGO PIX</div>';
          if (p === 'pix_manual') return '<div class="oc-pag-badge oc-pag-pix-pendente">&#9203; PIX PENDENTE</div>';
          if (p === 'cartao' || p === 'credito')   return '<div class="oc-pag-badge oc-pag-cartao">💳 CRÉDITO</div>';
          if (p === 'debito')                        return '<div class="oc-pag-badge oc-pag-cartao">🏧 DÉBITO</div>';
          if (p === 'cartao_mp')                     return '<div class="oc-pag-badge oc-pag-cartao" style="background:rgba(34,197,94,.12);color:var(--success)">💳 CRÉD. ONLINE</div>';
          if (p === 'dinheiro') {
            var tr = '';
            if (o.troco > 0) tr = ' &middot; Troco p/ R$' + parseFloat(o.troco).toFixed(2).replace('.',',');
            else if (o.troco === -1) tr = ' &middot; Precisa troco';
            return '<div class="oc-pag-badge oc-pag-dinheiro">&#128181; DINHEIRO' + tr + '</div>';
          }
          return '';
        })();

        return '<div class="order-card" onclick="openOrderDetail('+o.id+')">'+
          '<div class="oc-top"><span class="oc-id">#'+o.num+'</span>'+_tipoBadge+'<span class="oc-time">⏱ '+o.time+'</span></div>'+
          '<div class="oc-client">👤 '+o.client+(o.phone?' · '+o.phone:'')+'</div>'+
          '<div class="oc-items">'+itemStr+'</div>'+
          '<div class="oc-bot"><span class="oc-total">'+total+'</span>'+
            (o.addr&&!isMesa?'<span class="oc-addr">📍 '+o.addr+'</span>':'')+
          '</div>'+
          _pagBadge+
          '<div class="oc-actions">'+actionBtn+'</div>'+
        '</div>';
      }).join('');
    }
    col.addEventListener('dragover',e=>e.preventDefault());
    col.addEventListener('drop',e=>{
      e.preventDefault();
      const id=parseInt(e.dataTransfer.getData('orderId'));
      const o=ordersKanban.find(x=>x.id===id);
      if(o) o.status=st;
      renderKanban();
    });
  });
  document.getElementById('pedidos-badge').textContent=ordersKanban.filter(o=>o.status==='analise').length||'';
}

function openOrderDetail(id) {
  const o = ordersKanban.find(x => x.id === id);
  if (!o) return;
  window._currentDetailId = id;

  // Número e status
  document.getElementById('od-id').textContent = 'Pedido #' + o.num;
  const statusMap = {
    analise:   ['badge-analise',   'Em análise'],
    producao:  ['badge-producao',  'Em produção'],
    pronto:    ['badge-pronto',    'Pronto para entrega'],
    saiu:      ['badge-pronto',    'Saiu para entrega'],
    entregue:  ['badge-pronto',    'Entregue'],
    finalizado:['badge-pronto',    'Finalizado'],
    cancelado: ['badge-analise',   'Cancelado'],
  };
  const [cls, lbl] = statusMap[o.status] || ['badge-analise', o.status];
  const badgeEl = document.getElementById('od-status-badge');
  badgeEl.className = 'od-status-badge ' + cls;
  badgeEl.textContent = lbl;

  // Horário
  document.getElementById('od-timer').textContent = o.time || '';

  // Itens
  document.getElementById('od-items-list').innerHTML = (o.items || []).map(item => `
    <div class="od-item-row">
      <div class="od-item-qty">${item.qty}x</div>
      <div style="flex:1">
        <div class="od-item-name">${item.name}</div>
        ${item.obs ? `<div class="od-item-obs">Obs: ${item.obs}</div>` : ''}
        ${Array.isArray(item.extras) && item.extras.length ? `<div class="od-item-obs">+ ${item.extras.join(', ')}</div>` : ''}
      </div>
      <div class="od-item-price">R$&nbsp;${(item.price).toFixed(2).replace('.', ',')}</div>
    </div>`).join('');

  // Totais
  const fmt = v => 'R$ ' + parseFloat(v || 0).toFixed(2).replace('.', ',');
  document.getElementById('od-subtotal').textContent = fmt(o.total);
  document.getElementById('od-total').textContent    = fmt(o.total + o.taxa);

  const taxaRow = document.getElementById('od-taxa-row');
  if (taxaRow) {
    taxaRow.style.display = o.taxa > 0 ? '' : 'none';
    const taxaEl = document.getElementById('od-taxa-val');
    if (taxaEl) taxaEl.textContent = fmt(o.taxa);
  }

  // Troco
  const trocoRow = document.getElementById('od-troco-row');
  if (trocoRow) {
    if (o.pag === 'dinheiro' || o.pag === 'Dinheiro') {
      trocoRow.style.display = '';
      trocoRow.innerHTML = o.troco > 0
        ? `<span>Troco para</span><span style="color:var(--accent3);font-weight:600">${fmt(o.troco)}</span>`
        : o.troco === -1
        ? `<span>Troco solicitado</span><span style="color:var(--muted)">Valor não informado</span>`
        : `<span>Sem troco</span><span style="color:var(--muted)">Valor exato</span>`;
    } else {
      trocoRow.style.display = 'none';
    }
  }

  // Dados do cliente
  const setEl = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v || ''; };
  setEl('od-client-name',  o.client || 'Não informado');
  setEl('od-client-phone', o.phone  || '');

  // Tipo de entrega
  const isMesa     = !!(o.mesa_num || (o.addr || '').startsWith('Mesa'));
  const isBalcao   = !isMesa && (o.addr || '').toLowerCase().includes('balc');
  const tipoLabel  = isMesa ? '🪑 Mesa ' + (o.mesa_num || '') : isBalcao ? '🏪 Balcão / Retirada' : '🛵 Delivery';
  setEl('od-tipo',  tipoLabel);
  setEl('od-addr',  !isMesa && !isBalcao ? (o.addr || '') : o.garcom_nome ? 'Garçom: ' + o.garcom_nome : '');

  // Pagamento
  const pagLabel = {
    dinheiro:'💵 Dinheiro', pix:'💠 PIX Online', pix_manual:'💠 PIX', pix_mp:'💠 PIX Online',
    cartao:'💳 Cartão', credito:'💳 Crédito', debito:'💳 Débito',
    cartao_mp:'💳 Crédito Online', mesa:'🪑 Fechamento Mesa'
  }[(o.pag||'').toLowerCase()] || o.pag || '—';
  // Adiciona indicador de quando foi/será pago
  const momento = o.pag_momento || (
    (o.pag||'').includes('mp') || (o.pag||'').includes('pix') ? 'online' : 'entrega'
  );
  if (momento === 'online') pagLabel += ' <span style="font-size:10px;background:rgba(34,197,94,.15);color:#16a34a;padding:1px 6px;border-radius:99px;font-weight:700">✓ PAGO</span>';
  else if (o.pag !== 'dinheiro' && o.pag !== 'mesa') pagLabel += ' <span style="font-size:10px;background:rgba(245,158,11,.15);color:#b45309;padding:1px 6px;border-radius:99px;font-weight:700">NA ENTREGA</span>';
  setEl('od-pag', pagLabel);
  setEl('od-pag-sub', o.pag === 'dinheiro' || o.pag === 'Dinheiro'
    ? (o.troco > 0 ? 'Troco: ' + fmt(o.troco) : 'Valor exato') : '');

  // Origem
  const origemEl = document.getElementById('od-origem-row');
  if (origemEl) {
    origemEl.innerHTML = o.garcom_nome
      ? `<span style="color:var(--purple)">👨‍💼 Pedido via Garçom — ${o.garcom_nome}</span>`
      : `<span>🌐 Pedido via Cardápio Digital</span>`;
  }

  openModal('modal-order-detail');
}

function advanceOrder() {
  const id = window._currentDetailId;
  advanceOrderById(id);
  closeModal('modal-order-detail');
}

function cancelarPedidoDetalhe() {
  const id = window._currentDetailId;
  if (!id) return;
  const o = ordersKanban.find(x => x.id === id);
  if (!o) return;
  if (!confirm('Cancelar o Pedido #' + o.num + '? Esta ação não pode ser desfeita.')) return;
  cancelOrderById(id);
  closeModal('modal-order-detail');
}

// ─────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────
// ── Novo Pedido Manual — estado do modal ──────────────
let _noCart        = [];   // [{id, name, qty, price, emoji}]
let _noDelivery    = 'delivery';

function noSetDelivery(tipo) {
  _noDelivery = tipo;
  ['delivery','retirada','mesa'].forEach(t => {
    const btn = document.getElementById('no-dtab-' + t);
    if (!btn) return;
    btn.className = t === tipo ? 'btn bp' : 'btn bg';
    btn.style.flex = '1';
    btn.style.justifyContent = 'center';
    btn.style.fontSize = '12px';
  });
  document.getElementById('no-addr-block').style.display = tipo === 'delivery' ? '' : 'none';
  document.getElementById('no-mesa-block').style.display = tipo === 'mesa'     ? '' : 'none';
}

function noFilterItems(q) {
  const list = document.getElementById('no-items-list');
  if (!list) return;
  const search = (q || '').toLowerCase();
  const filtered = items.filter(i =>
    i.status !== 'pausado' &&
    (!search || i.name.toLowerCase().includes(search) || (i.desc||'').toLowerCase().includes(search))
  ).slice(0, 50);
  if (!filtered.length) {
    list.innerHTML = '<div style="padding:12px;text-align:center;color:var(--muted);font-size:12.5px">Nenhum produto encontrado</div>';
    return;
  }
  list.innerHTML = filtered.map(item => {
    const priceStr = 'R$ ' + parseFloat(item.price||0).toFixed(2).replace('.',',');
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''" onclick="noAddItem(${item.id})">
      <span style="font-size:20px;flex-shrink:0">${item.emoji||'🍽️'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.name}</div>
        ${item.desc ? `<div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.desc}</div>` : ''}
      </div>
      <span style="font-size:12.5px;font-weight:700;color:var(--success);flex-shrink:0">${priceStr}</span>
      <button style="background:var(--accent);color:#fff;border:none;border-radius:7px;width:26px;height:26px;font-size:16px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center">+</button>
    </div>`;
  }).join('');
}

function noAddItem(itemId) {
  const item = items.find(i => i.id === itemId);
  if (!item) return;
  const existing = _noCart.find(c => c.id === itemId);
  if (existing) {
    existing.qty++;
  } else {
    _noCart.push({ id: item.id, name: item.name, qty: 1, price: parseFloat(item.price||0), emoji: item.emoji||'🍽️' });
  }
  noRenderCart();
}

function noChangeQty(itemId, delta) {
  const idx = _noCart.findIndex(c => c.id === itemId);
  if (idx === -1) return;
  _noCart[idx].qty += delta;
  if (_noCart[idx].qty <= 0) _noCart.splice(idx, 1);
  noRenderCart();
}

function noRenderCart() {
  const el = document.getElementById('no-cart');
  const empty = document.getElementById('no-cart-empty');
  const totalEl = document.getElementById('no-total-display');
  if (!el) return;
  if (!_noCart.length) {
    if (empty) empty.style.display = '';
    el.querySelectorAll('.no-cart-row').forEach(r => r.remove());
    if (totalEl) totalEl.textContent = 'R$ 0,00';
    return;
  }
  if (empty) empty.style.display = 'none';
  el.querySelectorAll('.no-cart-row').forEach(r => r.remove());
  const frag = document.createDocumentFragment();
  _noCart.forEach(c => {
    const div = document.createElement('div');
    div.className = 'no-cart-row';
    div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid var(--border)';
    div.innerHTML = `
      <span style="font-size:18px">${c.emoji}</span>
      <span style="flex:1;font-size:13px;font-weight:500">${c.name}</span>
      <div style="display:flex;align-items:center;gap:6px">
        <button onclick="noChangeQty(${c.id},-1)" style="width:24px;height:24px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">−</button>
        <span style="font-size:13px;font-weight:700;min-width:20px;text-align:center">${c.qty}</span>
        <button onclick="noChangeQty(${c.id},1)"  style="width:24px;height:24px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">+</button>
      </div>
      <span style="font-size:12.5px;font-weight:700;color:var(--success);min-width:60px;text-align:right">R$ ${(c.price * c.qty).toFixed(2).replace('.',',')}</span>`;
    frag.appendChild(div);
  });
  el.appendChild(frag);
  const total = _noCart.reduce((s,c) => s + c.price * c.qty, 0);
  if (totalEl) totalEl.textContent = 'R$ ' + total.toFixed(2).replace('.',',');
}

function noOpenModal() {
  _noCart = [];
  _noDelivery = 'delivery';
  ['order-client','order-phone','order-addr','order-obs','order-mesa'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('no-search').value = '';
  noSetDelivery('delivery');
  noFilterItems('');
  noRenderCart();
  openModal('modal-new-order');
}

async function createOrder() {
  const client = document.getElementById('order-client').value.trim() || 'Cliente';
  const phone  = document.getElementById('order-phone').value.trim()  || '';
  const obs    = document.getElementById('order-obs').value.trim()    || '';
  const pag    = document.getElementById('order-pag').value           || 'PIX';
  const time   = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});

  let addr = '';
  let mesaNum = null;
  if (_noDelivery === 'delivery') {
    addr = document.getElementById('order-addr').value.trim();
  } else if (_noDelivery === 'mesa') {
    mesaNum = parseInt(document.getElementById('order-mesa').value) || null;
    addr = mesaNum ? 'Mesa ' + mesaNum : 'Mesa';
  } else {
    addr = 'Retirada no balcão';
  }

  if (!_noCart.length) { sbToast('err','Adicione pelo menos um produto'); return; }

  const itemsArr = _noCart.map(c => ({ qty: c.qty, name: c.name, price: c.price, obs: '' }));
  if (obs) itemsArr[itemsArr.length - 1].obs = obs;
  const tot = _noCart.reduce((s,c) => s + c.price * c.qty, 0);

  sbLoading(true);
  const { data: orderData, error: oErr } = await sb.from('orders').insert({
    client, phone, addr,
    items: itemsArr,
    total: tot,
    taxa: _noDelivery === 'delivery' ? 5 : 0,
    mesa_num: mesaNum,
    status: 'analise',
    time, pag
  }).select().single();

  if (oErr) { sbLoading(false); sbToast('err','Erro ao criar pedido'); console.error(oErr); return; }

  await sb.from('movimentos').insert({
    description: `Pedido #${_orderNum(orderData.id)} – ${client}`,
    tipo: 'entrada', val: tot, pag, time
  }).catch(() => {});

  sbLoading(false);
  ordersKanban.unshift(mapOrder(orderData));
  movimentos.push({ id: Date.now(), desc: `Pedido #${orderData.id} – ${client}`, tipo:'entrada', val:tot, pag, time });

  playOrderSound();
  const nc = document.getElementById('notif-count');
  if (nc) { nc.style.display='flex'; nc.textContent = parseInt(nc.textContent||0)+1; }
  closeModal('modal-new-order');
  nav('pedidos');
  sbToast('ok', `Pedido #${_orderNum(orderData.id)} criado`);
}

function printOrderDetail() {
  const id = window._currentDetailId;
  const o  = ordersKanban.find(x => x.id === id);
  if (!o) return;
  printOrder(o);
  sbToast('ok', 'Imprimindo comanda do Pedido #' + o.num);
}


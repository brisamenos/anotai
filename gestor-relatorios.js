function renderKDS() {
  const g = document.getElementById('kds-grid');
  if (!g) return;

  // Para/reinicia timer de atualização
  if (_kdsInterval) clearInterval(_kdsInterval);
  _kdsInterval = setInterval(() => _kdsUpdateTimers(), 1000);

  // Filtra pedidos
  let orders = ordersKanban.filter(o => o.status === 'producao' || o.status === 'analise');
  if (kdsFilter === 'mesa')     orders = orders.filter(o => _kdsOrderType(o) === 'mesa');
  if (kdsFilter === 'delivery') orders = orders.filter(o => _kdsOrderType(o) === 'delivery');
  if (kdsFilter === 'balcao')   orders = orders.filter(o => _kdsOrderType(o) === 'balcao');

  // Ordena: analise primeiro, depois por tempo (mais antigos primeiro)
  orders.sort((a, b) => {
    if (a.status === 'analise' && b.status !== 'analise') return -1;
    if (b.status === 'analise' && a.status !== 'analise') return  1;
    return _kdsElapsed(b) - _kdsElapsed(a);
  });

  // Inicializa timers para novos pedidos
  orders.forEach(o => {
    if (!kdsTimers[o.id]) kdsTimers[o.id] = { startTs: Date.now(), extra: 0 };
  });

  // Atualiza stats
  const late = orders.filter(o => _kdsElapsed(o) > 900).length; // >15min
  const newOrders = orders.filter(o => o.status === 'analise').length;
  const sEl = id => { const e = document.getElementById(id); return e; };
  const se = (id, v) => { const e = sEl(id); if (e && e.textContent !== String(v)) e.textContent = v; };
  se('kds-cnt-total', orders.length);
  se('kds-cnt-new',   newOrders);
  se('kds-cnt-late',  late);

  if (!orders.length) {
    g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:80px 20px;color:var(--muted)"><div style="display:none">x</div><div style="font-size:16px;font-weight:600">Cozinha vazia</div><div style="font-size:13px;margin-top:6px">Nenhum pedido em preparo no momento</div></div>';
    return;
  }

  g.innerHTML = orders.map(o => {
    const type    = _kdsOrderType(o);
    const elapsed = _kdsElapsed(o);
    const isNew   = o.status === 'analise';
    const isLate  = elapsed > 900;
    const isWarn  = elapsed > 480 && !isLate;
    const cardCls = isNew ? 'st-new' : isLate ? 'st-late' : isWarn ? 'st-ok' : '';
    const timerCls= isLate ? 't-late' : isWarn ? 't-warn' : 't-ok';
    const typeLabel = type === 'mesa' ? `\${o.addr||('Mesa '+(o.mesa_num||''))}` : type === 'balcao' ? '🏠 Balcão' : 'Delivery';
    const typeCls   = 'kds-type-'+type;
    const items = Array.isArray(o.items) ? o.items : [];

    const itemsHtml = items.map(i => {
      const isDrink = !!i.drink;
      return `<div class="kds-item2">
        <span class="kds-item2-qty">${i.qty}×</span>
        <div>
          <div class="kds-item2-name ${isDrink ? 'kds-item2-drink' : ''}">${isDrink ? '' : ''}${i.name.toUpperCase()}</div>
          ${i.obs ? `<div class="kds-item2-obs">${i.obs}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    const actionBtns = isNew
      ? `<button class="kds-btn-pronto" style="background:var(--orange)" onclick="kdsConfirm(${o.id})">✔ Confirmar</button>
         <button class="kds-btn-mais" onclick="kdsCancelOrder(${o.id})" style="color:var(--danger)">✕</button>`
      : `<button class="kds-btn-pronto" onclick="kdsMarkPronto(${o.id})">✅ Pronto</button>
         <button class="kds-btn-mais" onclick="kdsAddTime(${o.id})" title="+5 min">+5min</button>`;

    return `<div class="kds-card2 ${cardCls}" id="kds-card-${o.id}">
      <div class="kds-card2-head">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="kds-card2-id">#${o.num}</div>
          <span class="kds-card2-type ${typeCls}">${typeLabel}</span>
          ${isNew ? '<span style="font-size:9px;background:rgba(249,115,22,.2);color:#fed7aa;padding:1px 5px;border-radius:99px;font-weight:700;animation:blink .6s step-end infinite">NOVO</span>' : ''}
        </div>
        <div class="kds-timer ${timerCls}" id="kds-timer-${o.id}">${_kdsFormatTime(elapsed)}</div>
      </div>
      <div class="kds-card2-body">
        <div class="kds-card2-client">${o.client || ''}${o.phone ? ' · ' + o.phone : ''}</div>
        ${itemsHtml}
      </div>
      <div class="kds-card2-foot">${actionBtns}</div>
    </div>`;
  }).join('');

  // Tempo médio
  if (orders.length > 0) {
    const avg = Math.round(orders.reduce((s,o) => s + _kdsElapsed(o), 0) / orders.length);
    se('kds-avg-time', _kdsFormatTime(avg));
  }
}

function _kdsUpdateTimers() {
  // Atualiza só os timers sem re-renderizar tudo (evita piscar)
  ordersKanban
    .filter(o => o.status === 'producao' || o.status === 'analise')
    .forEach(o => {
      const el = document.getElementById('kds-timer-' + o.id);
      if (!el) return;
      const elapsed = _kdsElapsed(o);
      const isLate = elapsed > 900;
      const isWarn = elapsed > 480 && !isLate;
      el.textContent = _kdsFormatTime(elapsed);
      el.className = 'kds-timer ' + (isLate ? 't-late' : isWarn ? 't-warn' : 't-ok');
    });
}

async function kdsConfirm(id) {
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'producao', tenant_id: _sessao?.tenant_id })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Erro');
    const o = ordersKanban.find(x => x.id === id);
    if (o) o.status = 'producao';
    const card = document.getElementById('kds-card-' + id);
    if (card) card.classList.remove('st-new');
    renderKDS();
    sbToast('ok', `Pedido #${_orderNum(id)} em preparo`);
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
}

async function kdsMarkPronto(id) {
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'pronto', tenant_id: _sessao?.tenant_id })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Erro');
    const o = ordersKanban.find(x => x.id === id);
    if (o) o.status = 'pronto';
    delete kdsTimers[id];
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [[660,0],[880,.1],[1100,.2]].forEach(([f,t]) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = f; gain.gain.setValueAtTime(.3, ctx.currentTime+t);
        gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime+t+.15);
        osc.start(ctx.currentTime+t); osc.stop(ctx.currentTime+t+.2);
      });
    } catch(e){}
    renderKDS(); renderKanban();
    sbToast('ok', `Pedido #${_orderNum(id)} confirmado`);
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
}

async function kdsCancelOrder(id) {
  if (!confirm('Cancelar pedido #' + _orderNum(id) + '?')) return;
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'cancelado', tenant_id: _sessao?.tenant_id })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Erro');
    ordersKanban = ordersKanban.filter(x => x.id !== id);
    delete kdsTimers[id];
    renderKDS(); renderKanban();
    sbToast('ok', `Pedido #${id} cancelado`);
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
}

// ─────────────────────────────────────────
// ESTOQUE
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// ESTOQUE — REAL
// ─────────────────────────────────────────
function renderEstoque() {
  const search = (document.getElementById('est-search')?.value || '').toLowerCase();
  const filtered = estoqueItems.filter(e => e.name.toLowerCase().includes(search));

  // Stats
  const baixo    = estoqueItems.filter(e => e.qty <= e.min_qty).length;
  const valor    = estoqueItems.reduce((s,e) => s + (e.qty * (e.custo||0)), 0);
  const hoje     = estoqueItems.filter(e => {
    if (!e.updated_at) return false;
    return new Date(e.updated_at).toDateString() === new Date().toDateString();
  }).length;
  const elv = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  elv('est-stat-total',    estoqueItems.length);
  elv('est-stat-baixo',    baixo);
  elv('est-stat-valor',    'R$ '+valor.toFixed(2).replace('.',','));
  elv('est-stat-entradas', hoje);

  // Popular select do modal de entrada
  const sel = document.getElementById('est-sel-ingrediente');
  if (sel) {
    sel.innerHTML = '<option value="">Selecione...</option>' +
      estoqueItems.map(e => `<option value="${e.id}">${e.name} (${e.qty} ${e.unit})</option>`).join('');
  }

  const list = document.getElementById('estoque-list');
  if (!list) return;

  if (!filtered.length) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px">Nenhum ingrediente cadastrado.<br>Clique em <strong>Novo ingrediente</strong> para começar.</div>';
    return;
  }

  list.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:var(--surface2)">
            <th style="padding:10px 14px;text-align:left;font-size:10.5px;font-weight:600;color:var(--muted);letter-spacing:.5px;text-transform:uppercase">Ingrediente</th>
            <th style="padding:10px 14px;text-align:center;font-size:10.5px;font-weight:600;color:var(--muted);letter-spacing:.5px;text-transform:uppercase">Qty / Mín</th>
            <th style="padding:10px 14px;text-align:center;font-size:10.5px;font-weight:600;color:var(--muted);letter-spacing:.5px;text-transform:uppercase">Estoque</th>
            <th style="padding:10px 14px;text-align:right;font-size:10.5px;font-weight:600;color:var(--muted);letter-spacing:.5px;text-transform:uppercase">Custo unit.</th>
            <th style="padding:10px 14px;text-align:right;font-size:10.5px;font-weight:600;color:var(--muted);letter-spacing:.5px;text-transform:uppercase">Valor total</th>
            <th style="padding:10px 6px"></th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(e => {
            const pct = e.min_qty > 0 ? Math.min(100, (e.qty / (e.min_qty * 3)) * 100) : (e.qty > 0 ? 100 : 0);
            const isBaixo = e.qty <= e.min_qty;
            const isZero  = e.qty === 0;
            const barColor = isZero ? 'var(--danger)' : isBaixo ? 'var(--accent3)' : 'var(--success)';
            const valorTotal = (e.qty * (e.custo||0)).toFixed(2).replace('.',',');
            return `<tr style="border-top:1px solid var(--border);transition:background .13s" onmouseenter="this.style.background='rgba(255,255,255,.02)'" onmouseleave="this.style.background=''">
              <td style="padding:12px 14px">
                <div style="font-weight:600;font-size:13px">${e.name}</div>
                <div style="font-size:11px;color:var(--muted)">${e.unit}${e.updated_at ? ' · atualizado ' + new Date(e.updated_at).toLocaleDateString('pt-BR') : ''}</div>
              </td>
              <td style="padding:12px 14px;text-align:center">
                <div style="font-family:'Playfair Display',sans-serif;font-size:15px;font-weight:700;color:${isZero?'var(--danger)':isBaixo?'var(--accent3)':'var(--text)'}">${e.qty}</div>
                <div style="font-size:11px;color:var(--muted)">mín: ${e.min_qty}</div>
              </td>
              <td style="padding:12px 14px;min-width:120px">
                ${isBaixo ? `<span style="font-size:9.5px;background:${isZero?'rgba(239,68,68,.15)':'rgba(245,158,11,.15)'};color:${isZero?'var(--danger)':'var(--accent3)'};padding:1px 6px;border-radius:99px;font-weight:700;display:block;margin-bottom:4px">${isZero?'⚠️ ZERADO':'⚠️ BAIXO'}</span>` : ''}
                <div style="background:var(--surface2);border-radius:99px;height:5px;overflow:hidden">
                  <div style="width:${pct}%;height:100%;background:${barColor};border-radius:99px"></div>
                </div>
              </td>
              <td style="padding:12px 14px;text-align:right;font-size:12.5px;color:var(--muted)">
                ${e.custo ? 'R$ '+e.custo.toFixed(2).replace('.',',') : '—'}
              </td>
              <td style="padding:12px 14px;text-align:right;font-size:12.5px;font-weight:600;color:var(--success)">
                ${e.custo ? 'R$ '+valorTotal : '—'}
              </td>
              <td style="padding:12px 6px;text-align:right">
                <button class="btn bg" style="font-size:11px;padding:3px 8px" onclick="openEditIngrediente(${e.id})"></button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

async function saveIngrediente() {
  const nome  = document.getElementById('ing-nome').value.trim();
  const unit  = document.getElementById('ing-unit').value;
  const qty   = parseFloat(document.getElementById('ing-qty').value) || 0;
  const min   = parseFloat(document.getElementById('ing-min').value) || 0;
  const custo = parseFloat(document.getElementById('ing-custo').value) || 0;
  if (!nome) { sbToast('err','Informe o nome do ingrediente'); return; }
  sbLoading(true);
  const { data, error } = await sb.from('estoque').insert({
    name: nome, unit, qty, min_qty: min, cost: custo, updated_at: new Date().toISOString()
  }).select().single();
  sbLoading(false);
  if (error) { sbToast('err','Erro ao cadastrar: '+error.message); return; }
  estoqueItems.push({ id:data.id, name:data.name, unit:data.unit, qty:data.qty,
    min_qty:data.min_qty, custo:parseFloat(data.cost)||0, updated_at:data.updated_at });
  closeModal('modal-add-ingrediente');
  ['ing-nome','ing-qty','ing-min','ing-custo'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value='';
  });
  renderEstoque();
  sbToast('ok', `${nome} cadastrado!`);
}

async function registrarEntrada() {
  const id    = parseInt(document.getElementById('est-sel-ingrediente').value);
  const qty   = parseFloat(document.getElementById('est-qty-entrada').value) || 0;
  const custo = parseFloat(document.getElementById('est-custo-entrada').value) || 0;
  const obs   = document.getElementById('est-obs-entrada').value;
  if (!id)  { sbToast('err','Selecione o ingrediente'); return; }
  if (!qty) { sbToast('err','Informe a quantidade'); return; }
  const item = estoqueItems.find(e => e.id === id);
  if (!item) return;
  const newQty = item.qty + qty;
  const custUnit = qty > 0 && custo > 0 ? custo/qty : item.custo;
  sbLoading(true);
  const { error } = await sb.from('estoque').update({
    qty: newQty, cost: custUnit, updated_at: new Date().toISOString()
  }).eq('id', id);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao registrar'); return; }
  item.qty = newQty; item.custo = custUnit; item.updated_at = new Date().toISOString();
  closeModal('modal-estoque');
  ['est-qty-entrada','est-custo-entrada','est-obs-entrada'].forEach(i => {
    const el=document.getElementById(i); if(el) el.value='';
  });
  renderEstoque();
  sbToast('ok', `+${qty} ${item.unit} de ${item.name} registrado!`);
}

function openEditIngrediente(id) {
  const e = estoqueItems.find(x => x.id === id);
  if (!e) return;
  document.getElementById('edit-ing-id').value    = id;
  document.getElementById('edit-ing-nome').value  = e.name;
  document.getElementById('edit-ing-qty').value   = e.qty;
  document.getElementById('edit-ing-min').value   = e.min_qty;
  document.getElementById('edit-ing-custo').value = e.custo||0;
  openModal('modal-edit-ingrediente');
}

async function saveEditIngrediente() {
  const id    = parseInt(document.getElementById('edit-ing-id').value);
  const nome  = document.getElementById('edit-ing-nome').value.trim();
  const qty   = parseFloat(document.getElementById('edit-ing-qty').value) || 0;
  const min   = parseFloat(document.getElementById('edit-ing-min').value) || 0;
  const custo = parseFloat(document.getElementById('edit-ing-custo').value) || 0;
  if (!nome) { sbToast('err','Informe o nome'); return; }
  sbLoading(true);
  const { error } = await sb.from('estoque').update({
    name: nome, qty, min_qty: min, cost: custo, updated_at: new Date().toISOString()
  }).eq('id', id);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao salvar'); return; }
  const item = estoqueItems.find(e => e.id === id);
  if (item) { item.name=nome; item.qty=qty; item.min_qty=min; item.custo=custo; item.updated_at=new Date().toISOString(); }
  closeModal('modal-edit-ingrediente');
  renderEstoque();
  sbToast('ok', `${nome} atualizado!`);
}

async function deleteIngrediente() {
  const id   = parseInt(document.getElementById('edit-ing-id').value);
  const item = estoqueItems.find(e => e.id === id);
  if (!confirm(`Excluir ${item?.name}?`)) return;
  sbLoading(true);
  const { error } = await sb.from('estoque').delete().eq('id', id);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao excluir'); return; }
  estoqueItems = estoqueItems.filter(e => e.id !== id);
  closeModal('modal-edit-ingrediente');
  renderEstoque();
  sbToast('ok', `${item?.name} removido!`);
}

// ─────────────────────────────────────────
// DESEMPENHO
// ─────────────────────────────────────────
let _desempPrd = 'mensal';
let _desempCustomStart = null;
let _desempCustomEnd = null;

function setDesempPrd(prd) {
  _desempPrd = prd;
  _desempCustomStart = null;
  _desempCustomEnd = null;
  // Hide custom range panel
  const panel = document.getElementById('desemp-custom-range');
  if (panel) panel.style.display = 'none';
  _updateDesempButtons();
  renderDesempenho();
}

function _updateDesempButtons() {
  ['diario','semanal','mensal','anual','custom'].forEach(id => {
    const btn = document.getElementById('dpb-' + id);
    if (!btn) return;
    const active = id === _desempPrd || (id === 'custom' && _desempPrd === 'custom');
    btn.classList.remove('bp', 'bg');
    btn.classList.add(active ? 'bp' : 'bg');
  });
}

function toggleDesempCustom() {
  const panel = document.getElementById('desemp-custom-range');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    // Pre-fill with current month if empty
    const startEl = document.getElementById('desemp-date-start');
    const endEl   = document.getElementById('desemp-date-end');
    if (startEl && !startEl.value) {
      const now = new Date();
      startEl.value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      endEl.value   = now.toISOString().split('T')[0];
    }
  }
}

function applyDesempCustomRange() {
  const startEl = document.getElementById('desemp-date-start');
  const endEl   = document.getElementById('desemp-date-end');
  if (!startEl?.value || !endEl?.value) {
    if (typeof sbToast === 'function') sbToast('err', 'Selecione as datas de início e fim');
    return;
  }
  _desempCustomStart = new Date(startEl.value + 'T00:00:00');
  _desempCustomEnd   = new Date(endEl.value + 'T23:59:59.999');
  if (_desempCustomEnd < _desempCustomStart) {
    if (typeof sbToast === 'function') sbToast('err', 'A data final deve ser maior que a inicial');
    return;
  }
  _desempPrd = 'custom';
  _updateDesempButtons();
  renderDesempenho();
}

function _desempGetRange() {
  if (_desempPrd === 'custom' && _desempCustomStart && _desempCustomEnd) {
    const inicio = _desempCustomStart;
    const fim    = new Date(_desempCustomEnd.getTime() + 1);
    const label  = inicio.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' })
                 + ' – ' + _desempCustomEnd.toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' });
    return { inicio, fim, label };
  }
  // Reutiliza a mesma logica de _relGetRange mas com _desempPrd
  const saved = _relPeriodo;
  _relPeriodo = _desempPrd;
  const range = _relGetRange();
  _relPeriodo = saved;
  return range;
}

async function renderDesempenho() {
  const dg  = document.getElementById('desemp-grid');
  const bar = document.getElementById('desemp-bar');
  const top = document.getElementById('desemp-top');

  // Loading state
  if (dg)  dg.innerHTML  = Array(6).fill('<div class="desemp-card"><div class="desemp-label">Carregando...</div><div class="desemp-val" style="font-size:18px;color:var(--muted)">—</div></div>').join('');
  if (bar) bar.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:20px;text-align:center">Carregando...</div>';
  if (top) top.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:12px">Carregando...</div>';

  try {
    const range = _desempGetRange();
    const since = range.inicio.toISOString();
    const ate   = range.fim.toISOString();

    // Atualiza label do periodo
    const lblEl = document.getElementById('desemp-periodo-label');
    if (lblEl) lblEl.textContent = range.label;

    // Busca pedidos reais do período
    const { data: allOrders } = await sb.from('orders')
      .select('id,status,total,items,mesa_num,pag,created_at,garcom_nome')
      .gte('created_at', since)
      .lt('created_at', ate)
      .order('created_at', { ascending: true });

    const orders = allOrders || [];
    console.log('[DESEMPENHO]', _desempPrd, '| desde:', since, '| ate:', ate, '| pedidos:', orders.length);
    const entregues = orders.filter(o => !['cancelado'].includes(o.status));

    // ── KPIs ─────────────────────────────
    const totalPedidos   = orders.length;
    const faturamento    = entregues.reduce((s,o) => s + parseFloat(o.total||0), 0);
    const ticketMedio    = totalPedidos > 0 ? faturamento / totalPedidos : 0;
    const cancelados     = orders.filter(o => o.status === 'cancelado').length;
    const taxaCancelamento = totalPedidos > 0 ? (cancelados / totalPedidos * 100) : 0;
    const mesasSet       = new Set(orders.map(o => o.mesa_num).filter(Boolean));
    const itensQtd       = entregues.reduce((s,o) => {
      if (!Array.isArray(o.items)) return s;
      return s + o.items.reduce((si,i) => si + (i.qty||1), 0);
    }, 0);

    const _svgIcons = {
      faturamento: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 4v8M5.5 6.5A2 1.5 0 0 1 8 5a2 1.5 0 0 1 0 3 2 1.5 0 0 0 0 3 2 1.5 0 0 0 2.5-1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
      pedidos: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M5 2h6v6a3 3 0 0 1-6 0V2z" stroke="currentColor" stroke-width="1.4"/><path d="M2 2h3M11 2h3M2 5H5M11 5h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8 8v4M5.5 14h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
      ticket: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M8 2v3M8 11v3M2 8h3M11 8h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M4.5 4.5l2 2M9.5 9.5l2 2M4.5 11.5l2-2M9.5 6.5l2-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
      mesas: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="2" y="5" width="12" height="2" rx="1" fill="currentColor"/><line x1="4" y1="7" x2="4" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
      itens: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M2 5l6-3 6 3v6l-6 3-6-3V5z" stroke="currentColor" stroke-width="1.4"/><path d="M8 2v12M2 5l6 3 6-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
      cancelamentos: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`
    };

    const _gradients = {
      faturamento: 'linear-gradient(135deg,rgba(245,158,11,.18),rgba(245,158,11,.06))',
      pedidos: 'linear-gradient(135deg,rgba(59,130,246,.18),rgba(59,130,246,.06))',
      ticket: 'linear-gradient(135deg,rgba(139,92,246,.18),rgba(139,92,246,.06))',
      mesas: 'linear-gradient(135deg,rgba(34,197,94,.18),rgba(34,197,94,.06))',
      itens: 'linear-gradient(135deg,rgba(249,115,22,.18),rgba(249,115,22,.06))',
      cancelamentos: 'linear-gradient(135deg,rgba(239,68,68,.18),rgba(239,68,68,.06))'
    };

    const _iconBgs = {
      faturamento: 'rgba(245,158,11,.2)',
      pedidos: 'rgba(59,130,246,.2)',
      ticket: 'rgba(139,92,246,.2)',
      mesas: 'rgba(34,197,94,.2)',
      itens: 'rgba(249,115,22,.2)',
      cancelamentos: 'rgba(239,68,68,.2)'
    };

    const _borders = {
      faturamento: 'rgba(245,158,11,.25)',
      pedidos: 'rgba(59,130,246,.25)',
      ticket: 'rgba(139,92,246,.25)',
      mesas: 'rgba(34,197,94,.25)',
      itens: 'rgba(249,115,22,.25)',
      cancelamentos: 'rgba(239,68,68,.25)'
    };

    const metrics = [
      { key:'faturamento', label:'Faturamento', val: 'R$ ' + faturamento.toFixed(2).replace('.',','), color:'var(--accent3)' },
      { key:'pedidos', label:'Total de pedidos', val: totalPedidos, color:'var(--accent)' },
      { key:'ticket', label:'Ticket médio', val: 'R$ ' + ticketMedio.toFixed(2).replace('.',','), color:'var(--purple)' },
      { key:'mesas', label:'Mesas atendidas', val: mesasSet.size, color:'var(--success)' },
      { key:'itens', label:'Itens vendidos', val: itensQtd, color:'var(--accent2,var(--accent))' },
      { key:'cancelamentos', label:'Cancelamentos', val: cancelados + (taxaCancelamento > 0 ? ` (${taxaCancelamento.toFixed(1)}%)` : ''), color: cancelados > 0 ? 'var(--danger)' : 'var(--muted)' },
    ];

    if (dg) dg.innerHTML = metrics.map(m => `
      <div class="desemp-card" style="background:${_gradients[m.key]};border-color:${_borders[m.key]};--dc:${m.color}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px">
          <div class="desemp-label">${m.label}</div>
          <div style="width:36px;height:36px;border-radius:10px;background:${_iconBgs[m.key]};display:flex;align-items:center;justify-content:center;color:${m.color};flex-shrink:0">${_svgIcons[m.key]}</div>
        </div>
        <div class="desemp-val" style="font-size:24px;color:${m.color}">${m.val}</div>
      </div>`).join('');

    // ── Grafico dinamico por periodo ────────
    const barCard = bar?.closest('.card')?.querySelector('.card-title');
    if (bar) {
      let barData = [], barLabels = [];
      if (_desempPrd === 'anual') {
        if (barCard) barCard.innerHTML = barCard.innerHTML.replace(/Pedidos.*/, 'Pedidos por mês');
        const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        barData = new Array(12).fill(0); barLabels = months;
        orders.forEach(o => { barData[new Date(o.created_at).getMonth()]++; });
      } else if (_desempPrd === 'mensal') {
        if (barCard) barCard.innerHTML = barCard.innerHTML.replace(/Pedidos.*/, 'Pedidos por semana');
        barData = [0,0,0,0,0]; barLabels = ['Sem 1','Sem 2','Sem 3','Sem 4','Sem 5'];
        orders.forEach(o => {
          const w = Math.min(Math.floor((new Date(o.created_at).getDate()-1)/7), 4);
          barData[w]++;
        });
      } else if (_desempPrd === 'semanal') {
        if (barCard) barCard.innerHTML = barCard.innerHTML.replace(/Pedidos.*/, 'Pedidos por dia da semana');
        barData = [0,0,0,0,0,0,0]; barLabels = DAYS_FULL;
        orders.forEach(o => { barData[new Date(o.created_at).getDay()]++; });
      } else if (_desempPrd === 'custom') {
        if (barCard) barCard.innerHTML = barCard.innerHTML.replace(/Pedidos.*/, 'Pedidos por dia da semana');
        barData = [0,0,0,0,0,0,0]; barLabels = DAYS_FULL;
        orders.forEach(o => { barData[new Date(o.created_at).getDay()]++; });
      } else { // diario
        if (barCard) barCard.innerHTML = barCard.innerHTML.replace(/Pedidos.*/, 'Pedidos por hora');
        barData = new Array(24).fill(0);
        barLabels = Array.from({length:24}, (_,i) => i % 4 === 0 ? i + 'h' : '');
        orders.forEach(o => { barData[new Date(o.created_at).getHours()]++; });
      }
      const maxD = Math.max(...barData, 1);
      bar.innerHTML = barLabels.map((lbl, i) => [
        '<div class="bar-col">',
        '<div class="bar-val">' + (barData[i] || '') + '</div>',
        '<div class="bar-fill" style="height:' + Math.max(Math.round(barData[i]/maxD*100), barData[i]>0?3:2) + '%;background:var(--accent)' + (barData[i]===0?';opacity:.2':'') + '"></div>',
        '<div class="bar-label">' + lbl + '</div>',
        '</div>'
      ].join('')).join('');
    }

    // ── Top itens mais vendidos ──────────
    const itemMap = {};
    entregues.forEach(o => {
      if (!Array.isArray(o.items)) return;
      o.items.forEach(i => {
        const k = i.name;
        if (!itemMap[k]) itemMap[k] = { qty: 0, rev: 0 };
        itemMap[k].qty += (i.qty||1);
        itemMap[k].rev += (parseFloat(i.price||0) * (i.qty||1));
      });
    });
    const sorted = Object.entries(itemMap).sort((a,b) => b[1].qty - a[1].qty).slice(0,8);

    if (top) {
      if (!sorted.length) {
        top.innerHTML = '<div style="color:var(--muted);font-size:12.5px;padding:12px;text-align:center">Nenhum item no período</div>';
      } else {
        // Find emoji from items list if available
        top.innerHTML = sorted.map(([name, {qty, rev}], idx) => {
          const menuItem = items.find(i => i.name === name);
          const emoji = menuItem?.emoji || '';
          return `<div style="display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:12px;font-weight:700;color:var(--accent);width:18px">${idx+1}</span>
            <span style="font-size:18px">${emoji}</span>
            <span style="flex:1;font-size:12.5px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</span>
            <span style="font-size:11px;color:var(--muted);margin-right:6px">${qty}x</span>
            <span style="font-size:12px;font-weight:700;color:var(--success);flex-shrink:0">R$ ${rev.toFixed(2).replace('.',',')}</span>
          </div>`;
        }).join('');
      }
    }

  } catch(e) {
    console.error('renderDesempenho error:', e);
    if (dg) dg.innerHTML = '<div style="color:var(--danger);font-size:13px;padding:12px;grid-column:span 3">Erro ao carregar dados de desempenho</div>';
  }
}

// ─────────────────────────────────────────
// RELATÓRIOS
// ─────────────────────────────────────────
let _relPeriodo = 'mensal';
let _relCustomMonth = '';

function setRelPeriodo(p, val = '') {
  _relPeriodo = p;
  if (p === 'custom-month') {
    _relCustomMonth = val; // formato 'YYYY-MM'
  }
  
  ['diario','semanal','mensal','anual'].forEach(id => {
    const btn = document.getElementById('rpb-' + id);
    if (!btn) return;
    const active = id === p;
    btn.style.background  = active ? 'var(--accent)' : '';
    btn.style.color       = active ? '#fff' : '';
    btn.style.borderColor = active ? 'var(--accent)' : '';
  });

  const cmBtn = document.getElementById('rel-custom-month');
  if (cmBtn) {
    if (p === 'custom-month') {
      cmBtn.style.color = 'var(--text)';
      cmBtn.style.borderColor = 'var(--accent)';
      cmBtn.style.background = 'rgba(59,130,246,.1)';
    } else {
      cmBtn.style.color = 'var(--muted)';
      cmBtn.style.borderColor = 'var(--border)';
      cmBtn.style.background = 'transparent';
      cmBtn.value = ''; // limpa se clicar em outro
    }
  }

  renderRelatorios();
}

function _relGetRange() {
  const now = new Date();
  let inicio, fim, label;
  if (_relPeriodo === 'diario') {
    inicio = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    fim    = new Date(inicio.getTime() + 86400000);
    label  = 'Hoje, ' + inicio.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
  } else if (_relPeriodo === 'semanal') {
    const day = now.getDay();
    inicio = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
    fim    = new Date(inicio.getTime() + 7 * 86400000);
    label  = inicio.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' })
             + ' – ' + new Date(fim - 1).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
  } else if (_relPeriodo === 'custom-month' && _relCustomMonth) {
    const [y, m] = _relCustomMonth.split('-');
    inicio = new Date(parseInt(y), parseInt(m) - 1, 1);
    fim    = new Date(parseInt(y), parseInt(m), 1);
    label  = inicio.toLocaleDateString('pt-BR', { month:'long', year:'numeric' });
  } else if (_relPeriodo === 'mensal') {
    inicio = new Date(now.getFullYear(), now.getMonth(), 1);
    fim    = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    label  = inicio.toLocaleDateString('pt-BR', { month:'long', year:'numeric' });
  } else {
    inicio = new Date(now.getFullYear(), 0, 1);
    fim    = new Date(now.getFullYear() + 1, 0, 1);
    label  = String(now.getFullYear());
  }
  return { inicio, fim, label };
}

async function renderRelatorios() {
  const money  = v => 'R$\u00a0' + parseFloat(v||0).toFixed(2).replace('.', ',');
  const moneyK = v => { const n=parseFloat(v||0); return n>=1000 ? 'R$\u00a0'+Math.round(n/1000)+'k' : money(n); };
  const pct    = (a,b) => b>0 ? Math.round(a/b*100)+'%' : '0%';
  const elv    = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  const loading = id  => { const e=document.getElementById(id); if(e) e.innerHTML='<div style="color:var(--muted);font-size:12px;padding:16px;text-align:center">Carregando...</div>'; };

  ['rel-line-chart','rel-hour-bar','rel-day-bar','rel-gauges','rel-platforms','rel-tipo-venda',
   'rel-areas','rel-heatmap','rel-month-bar','rel-produtos-list','rel-produtos-fat',
   'rel-cats-bar','rel-top-clients','rel-top-gastos','rel-novos-clientes',
   'rel-entradas-list','rel-fat-pag','rel-sat-list','rel-sat-resumo'].forEach(loading);

  const now      = new Date();
  const range    = _relGetRange();
  const iniISO   = range.inicio.toISOString();
  const fimISO   = range.fim.toISOString();
  const anoIn    = new Date(now.getFullYear(), 0, 1).toISOString();
  const lbl30ago = new Date(now - 30*86400000).toISOString();

  const periLabel = { diario:'hoje', semanal:'na semana', mensal:'no mês', anual:'no ano' }[_relPeriodo] || 'no período';
  const lblEl = document.getElementById('rel-periodo-label');
  if (lblEl) lblEl.textContent = range.label;

  // Atualiza botões de período
  ['diario','semanal','mensal','anual'].forEach(id => {
    const btn = document.getElementById('rpb-'+id);
    if (!btn) return;
    const on = id === _relPeriodo;
    btn.style.background  = on ? 'var(--accent)' : 'none';
    btn.style.color       = on ? '#fff'           : 'var(--muted)';
  });

  try {
    const [
      { data: periodOrdersRaw },
      { data: anoOrdersRaw },
      { data: movsFromDB },
      { data: ratings },
      { data: allCustomers }
    ] = await Promise.all([
      sb.from('orders').select('id,status,total,taxa,items,mesa_num,addr,pag,phone,customer_id,created_at')
        .gte('created_at', iniISO).lt('created_at', fimISO).order('created_at', { ascending: true }),
      sb.from('orders').select('id,status,total,created_at')
        .gte('created_at', anoIn).order('created_at', { ascending: true }),
      sb.from('movimentos').select('*').order('id', { ascending: false }).limit(200),
      sb.from('ratings').select('*').order('created_at', { ascending: false }),
      fetch('/api/clientes-gestor', { headers: { 'Content-Type':'application/json', 'x-tenant-id': (() => { try { return JSON.parse(sessionStorage.getItem('sys_session')||'{}').tenant_id||'' } catch{return''} })() } }).then(r=>r.ok?r.json():[]).then(d=>({data:d})).catch(()=>({data:[]}))
    ]);

    const mesPedidos = periodOrdersRaw || [];
    const mesValidos = mesPedidos.filter(o => o.status !== 'cancelado' && o.status !== 'aguardando_pix' && o.status !== 'aguardando_cartao');
    const allYear    = anoOrdersRaw || [];

    // ─── KPIs ───────────────────────────────────────────
    const fatMes    = mesValidos.reduce((s,o) => s + parseFloat(o.total||0) + parseFloat(o.taxa||0), 0);
    const qtdMes    = mesPedidos.length;
    const ticket    = mesValidos.length > 0 ? fatMes / mesValidos.length : 0;
    const cancelMes = mesPedidos.filter(o => o.status === 'cancelado').length;
    const pctCancel = qtdMes > 0 ? (cancelMes/qtdMes*100).toFixed(1) : '0';

    elv('rel-kpi-fat',        moneyK(fatMes));
    elv('rel-kpi-fat-sub',    mesValidos.length + ' pedidos confirmados ' + periLabel);
    elv('rel-kpi-ped',        qtdMes);
    elv('rel-kpi-ped-sub',    mesValidos.length + ' confirmados · ' + cancelMes + ' cancelados');
    elv('rel-kpi-ticket',     money(ticket));
    elv('rel-kpi-cancel',     cancelMes);
    elv('rel-kpi-cancel-sub', pctCancel + '% do total de pedidos');

    // Trends (compara com período anterior simples — positivo/negativo por ticket)
    const trendFat  = document.getElementById('rel-kpi-fat-trend');
    const trendPed  = document.getElementById('rel-kpi-ped-trend');
    if (trendFat) trendFat.innerHTML = fatMes>0
      ? `<span style="color:var(--success)">↑ ${pct(mesValidos.length,qtdMes||1)} confirmação</span>`
      : '<span style="color:var(--muted)">Sem dados</span>';
    if (trendPed) trendPed.innerHTML = mesValidos.length > 0
      ? `<span style="color:var(--success)">✓ ${mesValidos.length} pedidos válidos</span>`
      : '<span style="color:var(--muted)">Sem pedidos confirmados</span>';

    // ─── Gráfico de linha (SVG) ─────────────────────────
    const lineEl = document.getElementById('rel-line-chart');
    if (lineEl) {
      const titleEl = document.getElementById('rel-chart-title');
      let points = [], labels = [], granLabel = '';
      if (_relPeriodo === 'anual') {
        granLabel = 'Faturamento mensal';
        points = new Array(12).fill(0);
        labels = ['J','F','M','A','M','J','J','A','S','O','N','D'];
        allYear.filter(o=>o.status!=='cancelado').forEach(o=>{
          points[new Date(o.created_at).getMonth()] += parseFloat(o.total||0);
        });
      } else if (_relPeriodo === 'mensal') {
        granLabel = 'Faturamento por semana';
        const semanas = Math.ceil(new Date(now.getFullYear(),now.getMonth()+1,0).getDate()/7);
        points = new Array(semanas).fill(0);
        labels = points.map((_,i)=>'S'+(i+1));
        mesValidos.forEach(o=>{
          const w = Math.min(Math.floor((new Date(o.created_at).getDate()-1)/7), semanas-1);
          points[w] += parseFloat(o.total||0) + parseFloat(o.taxa||0);
        });
      } else if (_relPeriodo === 'semanal') {
        granLabel = 'Faturamento por dia';
        labels = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        points = new Array(7).fill(0);
        mesValidos.forEach(o=>{ points[new Date(o.created_at).getDay()] += parseFloat(o.total||0)+parseFloat(o.taxa||0); });
      } else {
        granLabel = 'Faturamento por hora';
        points = new Array(24).fill(0);
        labels = Array.from({length:24},(_,i)=>i%6===0?i+'h':'');
        mesValidos.forEach(o=>{ points[new Date(o.created_at).getHours()] += parseFloat(o.total||0)+parseFloat(o.taxa||0); });
      }
      if (titleEl) titleEl.textContent = granLabel;

      const maxP = Math.max(...points, 1);
      const W=580, H=140, pad=10, botPad=24, topPad=10;
      const n = points.length;
      const xStep = (W-pad*2)/(n-1||1);
      const toX = i => pad + i*xStep;
      const toY = v => topPad + (H-botPad-topPad)*(1-v/maxP);
      const pathD = points.map((v,i) => (i===0?'M':'L')+toX(i).toFixed(1)+','+toY(v).toFixed(1)).join(' ');
      const areaD = pathD + ` L${toX(n-1).toFixed(1)},${H-botPad} L${pad},${H-botPad} Z`;

      lineEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="lg1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#3b82f6" stop-opacity=".4"/>
            <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${points.map((_,i) => i%Math.max(1,Math.floor(n/5))===0 ? `<line x1="${toX(i).toFixed(1)}" y1="${topPad}" x2="${toX(i).toFixed(1)}" y2="${H-botPad}" stroke="rgba(255,255,255,.04)" stroke-width="1"/>` : '').join('')}
        <path d="${areaD}" fill="url(#lg1)"/>
        <path d="${pathD}" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${points.map((v,i)=> v>0 ? `<circle cx="${toX(i).toFixed(1)}" cy="${toY(v).toFixed(1)}" r="3" fill="#3b82f6"/>
          <text x="${toX(i).toFixed(1)}" y="${(toY(v)-6).toFixed(1)}" font-size="8" text-anchor="middle" fill="#94a3b8">${v>=1000?Math.round(v/1000)+'k':'R$'+Math.round(v)}</text>` : '').join('')}
        ${labels.map((l,i)=> l ? `<text x="${toX(i).toFixed(1)}" y="${H-4}" font-size="9" text-anchor="middle" fill="#64748b">${l}</text>` : '').join('')}
      </svg>`;
    }

    // ─── Pedidos por hora ───────────────────────────────
    const hourCounts = new Array(24).fill(0);
    mesPedidos.forEach(o => { hourCounts[new Date(o.created_at).getHours()]++; });
    const maxH = Math.max(...hourCounts, 1);
    const hourEl = document.getElementById('rel-hour-bar');
    if (hourEl) hourEl.innerHTML = hourCounts.map((v,i)=>`
      <div class="bar-col">
        <div class="bar-val" style="font-size:8px">${v>0?v:''}</div>
        <div class="bar-fill" style="height:${Math.max(Math.round(v/maxH*100),v>0?4:1)}%;background:${v===Math.max(...hourCounts)?'var(--orange)':'var(--accent2)'};${v===0?'opacity:.15':''}"></div>
        <div class="bar-label" style="font-size:8px">${i%4===0?i+'h':''}</div>
      </div>`).join('');

    // ─── Dias da semana ─────────────────────────────────
    const dayC = [0,0,0,0,0,0,0];
    mesPedidos.forEach(o=>{ dayC[new Date(o.created_at).getDay()]++; });
    const maxDy = Math.max(...dayC, 1);
    const dayEl = document.getElementById('rel-day-bar');
    if (dayEl) dayEl.innerHTML = DAYS_FULL.map((d,i)=>`
      <div class="bar-col">
        <div class="bar-val">${dayC[i]}</div>
        <div class="bar-fill" style="height:${Math.max(Math.round(dayC[i]/maxDy*100),2)}%;background:${dayC[i]===Math.max(...dayC)?'var(--success)':'var(--accent3)'}"></div>
        <div class="bar-label">${d}</div>
      </div>`).join('');

    // ─── Heatmap hora × dia ─────────────────────────────
    const hmEl = document.getElementById('rel-heatmap');
    if (hmEl) {
      const hm = Array.from({length:7},()=>new Array(24).fill(0));
      mesPedidos.forEach(o=>{
        const d=new Date(o.created_at);
        hm[d.getDay()][d.getHours()]++;
      });
      const maxHM = Math.max(...hm.flat(), 1);
      const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
      hmEl.innerHTML = `<table style="border-collapse:collapse;font-size:9px;width:100%">
        <tr><td style="color:var(--muted);padding:2px 6px"></td>${Array.from({length:24},(_,h)=>`<td style="text-align:center;color:var(--muted);padding:1px 1px;width:3.8%">${h%4===0?h+'h':''}</td>`).join('')}</tr>
        ${dias.map((dia,d)=>`<tr>
          <td style="color:var(--muted2);padding:2px 6px;white-space:nowrap;font-size:9.5px;font-weight:600">${dia}</td>
          ${hm[d].map(v=>{
            const ratio = v/maxHM;
            const bg = ratio===0 ? 'rgba(255,255,255,.04)' :
              ratio<.25 ? 'rgba(59,130,246,.25)' :
              ratio<.5  ? 'rgba(59,130,246,.55)' :
              ratio<.75 ? 'rgba(249,115,22,.6)'  : 'rgba(239,68,68,.8)';
            return `<td title="${v} pedidos" style="background:${bg};border:1px solid rgba(0,0,0,.2);border-radius:2px;height:16px"></td>`;
          }).join('')}
        </tr>`).join('')}
        <tr><td></td><td colspan="24"><div style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:9px;color:var(--muted)">
          <span>Baixo</span>
          <div style="width:12px;height:10px;background:rgba(59,130,246,.25);border-radius:2px"></div>
          <div style="width:12px;height:10px;background:rgba(59,130,246,.55);border-radius:2px"></div>
          <div style="width:12px;height:10px;background:rgba(249,115,22,.6);border-radius:2px"></div>
          <div style="width:12px;height:10px;background:rgba(239,68,68,.8);border-radius:2px"></div>
          <span>Alto</span>
        </div></td></tr>
      </table>`;
    }

    // ─── Gráfico de barras anual ────────────────────────
    const mbEl = document.getElementById('rel-month-bar');
    const mTitle = document.getElementById('rel-month-title');
    if (mbEl) {
      const monthData = new Array(12).fill(0);
      allYear.filter(o=>o.status!=='cancelado').forEach(o=>{
        monthData[new Date(o.created_at).getMonth()] += parseFloat(o.total||0);
      });
      const maxMB = Math.max(...monthData, 1);
      const mNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      mbEl.innerHTML = monthData.map((v,i)=>`
        <div class="bar-col">
          <div class="bar-val" style="font-size:9px">${v>0?'R$'+Math.round(v/1000)+'k':''}</div>
          <div class="bar-fill" style="height:${Math.max(Math.round(v/maxMB*100),v>0?3:1)}%;${v===0?'opacity:.15':''}"></div>
          <div class="bar-label">${mNames[i]}</div>
        </div>`).join('');
      if (mTitle) mTitle.textContent = 'Faturamento mensal '+now.getFullYear();
    }

    // ─── Pagamentos ─────────────────────────────────────
    const pagMap = {};
    mesValidos.forEach(o=>{
      const k = (o.pag||'outro').toLowerCase().includes('pix')   ? 'PIX'
              : (o.pag||'').toLowerCase().includes('cart')        ? 'Cartão'
              : (o.pag||'').toLowerCase().includes('dinheiro')    ? 'Dinheiro'
              : (o.pag||'').toLowerCase().includes('mesa')        ? 'Mesa'
              : (o.pag||'outro');
      if (!pagMap[k]) pagMap[k] = {count:0, fat:0};
      pagMap[k].count++; pagMap[k].fat += parseFloat(o.total||0)+parseFloat(o.taxa||0);
    });
    const pagCols = { PIX:'var(--purple)', Cartão:'var(--accent)', Dinheiro:'var(--success)', Mesa:'var(--accent3)' };
    const pagEmojis = { PIX:'PIX', Cartão:'Cartão', Dinheiro:'Dinheiro', Mesa:'Mesa' };
    const pagEl = document.getElementById('rel-gauges');
    if (pagEl) {
      const ents = Object.entries(pagMap).sort((a,b)=>b[1].count-a[1].count);
      const totPag = ents.reduce((s,[,v])=>s+v.count,0)||1;
      pagEl.innerHTML = ents.length ? ents.map(([k,v])=>`
        <div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <div style="display:flex;align-items:center;gap:7px">
              <span style="font-size:16px">${''}</span>
              <span style="font-size:13px;font-weight:600">${k}</span>
            </div>
            <div style="text-align:right">
              <span style="font-size:13px;font-weight:700;color:${pagCols[k]||'var(--accent)'}">${v.count} pedidos</span>
              <span style="font-size:11px;color:var(--muted);margin-left:6px">${money(v.fat)}</span>
            </div>
          </div>
          <div style="height:7px;background:var(--border);border-radius:99px;overflow:hidden">
            <div style="height:100%;width:${pct(v.count,totPag)};background:${pagCols[k]||'var(--accent)'};border-radius:99px;transition:width .5s"></div>
          </div>
          <div style="font-size:10px;color:var(--muted);margin-top:3px">${pct(v.count,totPag)} dos pedidos</div>
        </div>`).join('')
        : '<div style="color:var(--muted);font-size:12px;padding:12px">Sem dados no período</div>';
    }

    // ─── Receita por pagamento (financeiro) ─────────────
    const fatPagEl = document.getElementById('rel-fat-pag');
    if (fatPagEl) {
      const ents = Object.entries(pagMap).sort((a,b)=>b[1].fat-a[1].fat);
      const maxFP = Math.max(...ents.map(([,v])=>v.fat), 1);
      fatPagEl.innerHTML = ents.length ? ents.map(([k,v])=>`
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;margin-bottom:5px">
            <span style="font-size:12.5px;font-weight:600">${''} ${k}</span>
            <span style="font-size:13px;font-weight:700;color:${pagCols[k]||'var(--accent)'}">${money(v.fat)}</span>
          </div>
          <div style="height:8px;background:var(--border);border-radius:99px;overflow:hidden">
            <div style="height:100%;width:${Math.round(v.fat/maxFP*100)}%;background:${pagCols[k]||'var(--accent)'};border-radius:99px"></div>
          </div>
        </div>`).join('')
        : '<div style="color:var(--muted);font-size:12px;padding:12px">Sem dados</div>';
    }

    // ─── Origem (plataforma) ─────────────────────────────
    const originMap = {};
    mesValidos.forEach(o=>{
      const ori = o.mesa_num || (o.addr||'').startsWith('Mesa') ? 'Mesa (Garçom)'
                : (o.addr||'').toLowerCase().includes('balc')   ? 'Balcão / Retirada'
                :                                                  'Delivery';
      if(!originMap[ori]) originMap[ori]={count:0,fat:0};
      originMap[ori].count++; originMap[ori].fat+=parseFloat(o.total||0)+parseFloat(o.taxa||0);
    });
    const _oriColors = { 'Mesa (Garçom)':'#22c55e', 'Delivery':'#3b82f6', 'Balcão / Retirada':'#f59e0b' };
    const _oriIcons = {
      'Mesa (Garçom)': `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="5" width="12" height="2" rx="1" fill="currentColor"/><line x1="4" y1="7" x2="4" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
      'Delivery': `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1 9V5h9v8H1v-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10 6h3l2 3v3h-5V6z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="4" cy="13" r="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="13" r="1.5" stroke="currentColor" stroke-width="1.4"/></svg>`,
      'Balcão / Retirada': `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 7l6-5 6 5v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7z" stroke="currentColor" stroke-width="1.4"/><path d="M6 14V9h4v5" stroke="currentColor" stroke-width="1.4"/></svg>`
    };
    const peEl = document.getElementById('rel-platforms');
    if (peEl) {
      const ents = Object.entries(originMap).sort((a,b)=>b[1].fat-a[1].fat);
      const maxOF = Math.max(...ents.map(([,v])=>v.fat),1);
      peEl.innerHTML = ents.length ? ents.map(([k,v])=>{
        const col = _oriColors[k] || 'var(--accent)';
        return `
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:26px;height:26px;border-radius:7px;background:${col}18;display:flex;align-items:center;justify-content:center;color:${col}">${_oriIcons[k]||''}</div>
              <span style="font-size:13px;font-weight:600">${k}</span>
            </div>
            <div style="text-align:right">
              <span style="font-size:13px;font-weight:700;color:${col}">${money(v.fat)}</span>
              <span style="font-size:11px;color:var(--muted);margin-left:5px">${v.count} ped.</span>
            </div>
          </div>
          <div style="height:8px;background:var(--border);border-radius:99px;overflow:hidden">
            <div style="height:100%;width:${Math.round(v.fat/maxOF*100)}%;background:${col};border-radius:99px;transition:width .6s ease"></div>
          </div>
        </div>`;
      }).join('')
        : '<div style="color:var(--muted);font-size:12px;padding:8px">Sem pedidos no período</div>';
    }

    // ─── Tipo de Venda — Donut Chart Premium ────────────────
    const tipoVendaMap = {};
    mesValidos.forEach(o => {
      let tipo;
      if (o.mesa_num || (o.addr||'').startsWith('Mesa')) tipo = 'Mesa';
      else if ((o.addr||'').toLowerCase().includes('balc'))  tipo = 'Balcão';
      else tipo = 'Delivery';
      if (!tipoVendaMap[tipo]) tipoVendaMap[tipo] = { count: 0, fat: 0 };
      tipoVendaMap[tipo].count++;
      tipoVendaMap[tipo].fat += parseFloat(o.total||0) + parseFloat(o.taxa||0);
    });
    const tvEl = document.getElementById('rel-tipo-venda');
    if (tvEl) {
      const isAcougue = window._segmento === 'acougue';
      // Filter out Mesa for açougue
      const tvEntries = Object.entries(tipoVendaMap)
        .filter(([k]) => !(isAcougue && k === 'Mesa'))
        .sort((a,b) => b[1].count - a[1].count);
      const totalTV = tvEntries.reduce((s,[,v]) => s + v.count, 0) || 1;

      if (!tvEntries.length) {
        tvEl.innerHTML = '<div style="color:var(--muted);font-size:12.5px;padding:20px;text-align:center;width:100%">Sem vendas no período</div>';
      } else {
        const tvColors = { Mesa:'#22c55e', Delivery:'#3b82f6', 'Balcão':'#f59e0b' };
        const tvIcons  = {
          Mesa: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="5" width="12" height="2" rx="1" fill="currentColor"/><line x1="4" y1="7" x2="4" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
          Delivery: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 9V5h9v8H1v-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10 6h3l2 3v3h-5V6z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="4" cy="13" r="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="13" r="1.5" stroke="currentColor" stroke-width="1.4"/></svg>`,
          'Balcão': `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 7l6-5 6 5v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7z" stroke="currentColor" stroke-width="1.4"/><path d="M6 14V9h4v5" stroke="currentColor" stroke-width="1.4"/></svg>`
        };

        // SVG Donut chart
        const R = 60, strokeW = 14, C = 2 * Math.PI * R;
        let offset = 0;
        const arcs = tvEntries.map(([k,v]) => {
          const pct = v.count / totalTV;
          const dash = pct * C;
          const gap  = C - dash;
          const arc = `<circle cx="80" cy="80" r="${R}" fill="none" stroke="${tvColors[k]||'#888'}" stroke-width="${strokeW}" stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" stroke-linecap="round" style="transition:stroke-dasharray .6s ease,stroke-dashoffset .6s ease;filter:drop-shadow(0 0 4px ${tvColors[k]||'#888'}40)"/>`;
          offset += dash;
          return arc;
        }).join('');

        const donutSVG = `<svg viewBox="0 0 160 160" width="160" height="160" style="flex-shrink:0;transform:rotate(-90deg)">
          <circle cx="80" cy="80" r="${R}" fill="none" stroke="rgba(255,255,255,.04)" stroke-width="${strokeW}"/>
          ${arcs}
        </svg>`;

        // Center label
        const centerLabel = `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center">
          <div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:800;color:var(--text)">${totalTV}</div>
          <div style="font-size:9.5px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px">pedidos</div>
        </div>`;

        // Legend
        const legend = tvEntries.map(([k,v]) => {
          const pctVal = ((v.count/totalTV)*100).toFixed(1);
          const col = tvColors[k]||'#888';
          return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:${col}0d;border:1px solid ${col}25;border-radius:10px;transition:all .2s" onmouseenter="this.style.borderColor='${col}55';this.style.transform='translateX(4px)'" onmouseleave="this.style.borderColor='${col}25';this.style.transform='none'">
            <div style="width:30px;height:30px;border-radius:8px;background:${col}20;display:flex;align-items:center;justify-content:center;color:${col}">${tvIcons[k]||''}</div>
            <div style="flex:1">
              <div style="font-size:12.5px;font-weight:700;color:var(--text)">${k}</div>
              <div style="font-size:11px;color:var(--muted)">${v.count} pedido${v.count!==1?'s':''} · ${money(v.fat)}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:18px;font-weight:800;color:${col};font-family:'Playfair Display',serif">${pctVal}%</div>
            </div>
          </div>`;
        }).join('');

        tvEl.innerHTML = `
          <div style="position:relative;flex-shrink:0">
            ${donutSVG}
            ${centerLabel}
          </div>
          <div style="flex:1;display:flex;flex-direction:column;gap:8px">
            ${legend}
          </div>`;
      }
    }

    // ─── Top bairros ─────────────────────────────────────
    const areaMap = {};
    mesValidos.filter(o=>!o.mesa_num&&o.addr&&!o.addr.startsWith('Mesa')).forEach(o=>{
      const parts = (o.addr||'').split(',');
      const bairro = (parts[1]||parts[0]||'').trim().split(' ').slice(0,3).join(' ') || 'Não informado';
      if(!areaMap[bairro]) areaMap[bairro]={fat:0,ped:0};
      areaMap[bairro].fat+=parseFloat(o.total||0); areaMap[bairro].ped++;
    });
    const aeEl = document.getElementById('rel-areas');
    if (aeEl) {
      const ents = Object.entries(areaMap).sort((a,b)=>b[1].ped-a[1].ped).slice(0,6);
      aeEl.innerHTML = ents.length ? ents.map(([k,v],i)=>`
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:13px;font-weight:800;color:var(--accent);width:20px">#${i+1}</span>
          <div style="flex:1">
            <div style="font-weight:600;font-size:12.5px">${k}</div>
            <div style="font-size:11px;color:var(--muted)">${v.ped} pedido${v.ped!==1?'s':''}</div>
          </div>
          <div style="font-size:12.5px;font-weight:700;color:var(--success)">${money(v.fat)}</div>
        </div>`).join('')
        : '<div style="color:var(--muted);font-size:12px;padding:8px">Apenas pedidos de mesa</div>';
    }

    // ─── Produtos mais vendidos ─────────────────────────
    const itemMap = {};
    mesValidos.forEach(o=>{
      (Array.isArray(o.items)?o.items:[]).forEach(i=>{
        const k=i.name||'?';
        if(!itemMap[k]) itemMap[k]={qty:0,fat:0,cat:i.cat||''};
        itemMap[k].qty+=(i.qty||1);
        itemMap[k].fat+=parseFloat(i.price||0)*(i.qty||1);
      });
    });
    const sortedQty = Object.entries(itemMap).sort((a,b)=>b[1].qty-a[1].qty).slice(0,12);
    const sortedFat = Object.entries(itemMap).sort((a,b)=>b[1].fat-a[1].fat).slice(0,12);
    const totalQty  = sortedQty.reduce((s,[,v])=>s+v.qty,0)||1;
    const totalFat  = sortedFat.reduce((s,[,v])=>s+v.fat,0)||1;

    const renderProdList = (sorted, field, total, color) => sorted.map(([name,v],idx)=>{
      const mi = items.find(i=>i.name===name);
      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <span style="width:18px;font-size:11.5px;font-weight:700;color:var(--muted)">${idx+1}</span>
        <span style="font-size:17px">${mi?.emoji||''}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
          <div style="height:4px;background:var(--border);border-radius:99px;margin-top:4px;overflow:hidden">
            <div style="height:100%;width:${Math.round(v[field]/total*100)}%;background:${color};border-radius:99px"></div>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          ${field==='qty'
            ? `<div style="font-size:13px;font-weight:700;color:${color}">${v.qty}x</div><div style="font-size:11px;color:var(--muted)">${money(v.fat)}</div>`
            : `<div style="font-size:13px;font-weight:700;color:${color}">${money(v.fat)}</div><div style="font-size:11px;color:var(--muted)">${v.qty}x vendidos</div>`}
        </div>
      </div>`;
    }).join('');

    const rpl = document.getElementById('rel-produtos-list');
    if (rpl) rpl.innerHTML = sortedQty.length ? renderProdList(sortedQty,'qty',totalQty,'var(--accent)')
      : '<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center">Sem vendas no período</div>';

    const rpf = document.getElementById('rel-produtos-fat');
    if (rpf) rpf.innerHTML = sortedFat.length ? renderProdList(sortedFat,'fat',totalFat,'var(--success)')
      : '<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center">Sem vendas no período</div>';

    // ─── Faturamento por categoria ───────────────────────
    const catMap = {};
    mesValidos.forEach(o=>{
      (Array.isArray(o.items)?o.items:[]).forEach(i=>{
        const k = i.cat || i.cat_key || 'Outros';
        if(!catMap[k]) catMap[k]={fat:0,qty:0};
        catMap[k].fat+=parseFloat(i.price||0)*(i.qty||1);
        catMap[k].qty+=(i.qty||1);
      });
    });
    const catEnt = Object.entries(catMap).sort((a,b)=>b[1].fat-a[1].fat);
    const maxCF  = Math.max(...catEnt.map(([,v])=>v.fat),1);
    const catColors = ['var(--accent)','var(--success)','var(--purple)','var(--accent3)','var(--accent2)','var(--orange)'];
    const catEl  = document.getElementById('rel-cats-bar');
    if (catEl) catEl.innerHTML = catEnt.length ? catEnt.map(([k,v],i)=>`
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
          <span style="font-size:12.5px;font-weight:600">${k}</span>
          <div>
            <span style="font-size:13px;font-weight:700;color:${catColors[i%catColors.length]}">${money(v.fat)}</span>
            <span style="font-size:11px;color:var(--muted);margin-left:6px">${v.qty} itens</span>
          </div>
        </div>
        <div style="height:9px;background:var(--border);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${Math.round(v.fat/maxCF*100)}%;background:${catColors[i%catColors.length]};border-radius:99px;transition:width .6s"></div>
        </div>
      </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center">Sem vendas no período</div>';

    // ─── Clientes ────────────────────────────────────────
    const cliAll  = allCustomers || [];
    const limite30 = new Date(now - 30*86400000).toISOString();
    const cliTotal   = cliAll.length;
    const cliComPed  = cliAll.filter(c=>(c.orders_count||0)>0).length;
    const cliFid     = fidClients.length;
    const cliInativos= cliAll.filter(c=>c.last_order_at && c.last_order_at<limite30 && (c.orders_count||0)>0).length;
    elv('rel-cli-total',    cliTotal);
    elv('rel-cli-com-pedido', cliComPed);
    elv('rel-cli-fid',      cliFid);
    elv('rel-cli-inativos', cliInativos);

    // Top frequentes
    const topFreq = [...cliAll].sort((a,b)=>(b.orders_count||0)-(a.orders_count||0)).slice(0,8);
    const rtcEl = document.getElementById('rel-top-clients');
    if (rtcEl) rtcEl.innerHTML = topFreq.length ? topFreq.map((c,i)=>`
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:13px;font-weight:800;color:var(--accent);width:20px">#${i+1}</span>
        <div class="fid-av" style="width:30px;height:30px;min-width:30px;font-size:12px">${(c.name||'?')[0].toUpperCase()}</div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:12.5px">${c.name||'—'}</div>
          <div style="font-size:11px;color:var(--muted)">${c.phone||''}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:13px;font-weight:700;color:var(--accent)">${c.orders_count||0} pedidos</div>
          <div style="font-size:11px;color:var(--success)">${money(c.total_spent||0)}</div>
        </div>
      </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:12px">Nenhum cliente com pedidos</div>';

    // Top gastadores
    const topGasto = [...cliAll].sort((a,b)=>(b.total_spent||0)-(a.total_spent||0)).slice(0,8);
    const tgEl = document.getElementById('rel-top-gastos');
    if (tgEl) tgEl.innerHTML = topGasto.length ? topGasto.map((c,i)=>`
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:13px;font-weight:800;color:var(--success);width:20px">#${i+1}</span>
        <div class="fid-av" style="width:30px;height:30px;min-width:30px;font-size:12px">${(c.name||'?')[0].toUpperCase()}</div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:12.5px">${c.name||'—'}</div>
          <div style="font-size:11px;color:var(--muted)">${c.orders_count||0} pedidos</div>
        </div>
        <div style="font-size:14px;font-weight:800;color:var(--success)">${money(c.total_spent||0)}</div>
      </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:12px">Nenhum cliente com gastos</div>';

    // Novos clientes no período
    const novos = cliAll.filter(c=>c.created_at>=iniISO&&c.created_at<fimISO);
    const ncEl = document.getElementById('rel-novos-clientes');
    if (ncEl) ncEl.innerHTML = novos.length
      ? `<div style="margin-bottom:12px;font-size:13px;color:var(--success);font-weight:700">✨ ${novos.length} novo${novos.length!==1?'s':''} cliente${novos.length!==1?'s':''} cadastrado${novos.length!==1?'s':''} ${periLabel}</div>`
        + novos.slice(0,10).map(c=>`<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
          <div class="fid-av" style="width:28px;height:28px;min-width:28px;font-size:11px">${(c.name||'?')[0].toUpperCase()}</div>
          <div style="flex:1"><div style="font-size:12.5px;font-weight:600">${c.name||'—'}</div><div style="font-size:11px;color:var(--muted)">${c.phone||''}</div></div>
          <div style="font-size:11px;color:var(--muted)">${new Date(c.created_at).toLocaleDateString('pt-BR')}</div>
        </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center">Nenhum cliente cadastrado '+periLabel+'</div>';

    // ─── Financeiro: movimentos ───────────────────────────
    // movimentos.time usa formato SQLite 'YYYY-MM-DD HH:MM:SS' — normaliza para ISO
    const normDate = s => s ? new Date(s.replace(' ', 'T')) : null;
    const movsFiltrados = (movsFromDB||[]).filter(m=>{
      const t = normDate(m.created_at||m.time);
      return t && t >= range.inicio && t < range.fim;
    });
    const totEnt = movsFiltrados.filter(m=>m.tipo==='entrada').reduce((s,m)=>s+parseFloat(m.val||0),0);
    const totSai = movsFiltrados.filter(m=>m.tipo==='saida').reduce((s,m)=>s+parseFloat(m.val||0),0);
    const saldo  = totEnt - totSai;

    elv('rel-fin-entradas', money(totEnt));
    elv('rel-fin-saidas',   money(totSai));
    const saldoEl = document.getElementById('rel-fin-saldo');
    if (saldoEl) { saldoEl.textContent = money(saldo); saldoEl.style.color = saldo>=0?'var(--success)':'var(--danger)'; }

    const movEl = document.getElementById('rel-entradas-list');
    if (movEl) movEl.innerHTML = movsFiltrados.length
      ? movsFiltrados.slice(0,30).map(m=>`
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:13px;
            background:${m.tipo==='entrada'?'rgba(34,197,94,.12)':'rgba(239,68,68,.12)'}">
            ${m.tipo==='entrada'?'↑':'↓'}
          </div>
          <div style="flex:1">
            <div style="font-size:12.5px;font-weight:500">${m.description||'—'}</div>
            <div style="font-size:11px;color:var(--muted)">${m.pag||''} ${m.time||m.created_at?'· '+new Date(m.created_at||m.time).toLocaleDateString('pt-BR'):''}</div>
          </div>
          <div style="font-weight:700;font-size:13px;color:${m.tipo==='entrada'?'var(--success)':'var(--danger)'}">
            ${m.tipo==='entrada'?'+':'-'}${money(m.val)}
          </div>
        </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:16px;text-align:center">Nenhuma movimentação no período</div>';

    // ─── Satisfação ───────────────────────────────────────
    const ratList = ratings || [];
    const ratPeriodo = ratList.filter(r=>r.created_at>=iniISO);
    const satResumoEl = document.getElementById('rel-sat-resumo');
    if (satResumoEl) {
      if (!ratList.length) {
        satResumoEl.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center">Nenhuma avaliação recebida</div>';
      } else {
        const media = ratList.reduce((s,r)=>s+(r.nota||5),0) / ratList.length;
        const dist  = [5,4,3,2,1].map(n=>({ nota:n, count:ratList.filter(r=>(r.nota||5)===n).length }));
        satResumoEl.innerHTML = `
          <div style="text-align:center;margin-bottom:16px">
            <div style="font-size:42px;font-weight:900;color:var(--accent3)">${media.toFixed(1)}</div>
            <div style="margin-bottom:6px">${''}</div>
            <div style="font-size:12px;color:var(--muted)">${ratList.length} avaliações</div>
          </div>
          ${dist.map(({nota,count})=>`
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:var(--muted);width:12px">${nota}</span>
              <div style="flex:1;height:7px;background:var(--border);border-radius:99px;overflow:hidden">
                <div style="height:100%;width:${ratList.length?Math.round(count/ratList.length*100):0}%;background:var(--accent3);border-radius:99px"></div>
              </div>
              <span style="font-size:11px;color:var(--muted);width:24px">${count}</span>
            </div>`).join('')}`;
      }
    }
    const satListEl = document.getElementById('rel-sat-list');
    if (satListEl) satListEl.innerHTML = ratList.length
      ? ratList.slice(0,20).map(r=>`
        <div style="padding:12px;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <div style="font-weight:600;font-size:12.5px">${r.client||'Anônimo'}</div>
            <div>
              <span style="font-size:13px">${''}</span>
              <span style="font-size:11px;color:var(--muted);margin-left:6px">${r.created_at?new Date(r.created_at).toLocaleDateString('pt-BR'):''}</span>
            </div>
          </div>
          ${r.comentario?`<div style="font-size:12px;color:var(--muted2);font-style:italic">"${r.comentario}"</div>`:''}
        </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:16px;text-align:center">Nenhuma avaliação com comentário</div>';

  } catch(e) {
    console.error('renderRelatorios error:', e);
    sbToast('err', 'Erro ao carregar relatórios: ' + e.message);
  }
}

function relExportar() {
  const range = _relGetRange();
  const rows  = [['Período', range.label], ['Gerado em', new Date().toLocaleString('pt-BR')]];
  const csv   = rows.map(r=>r.join(';')).join('\n');
  const a     = document.createElement('a');
  a.href      = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download  = 'relatorio-' + _relPeriodo + '.csv';
  a.click();
  sbToast('ok', 'CSV exportado!');
}


// ─────────────────────────────────────────
// SATISFAÇÃO
// ─────────────────────────────────────────
async function renderSatisfacao(){
  const elBars    = document.getElementById('sat-bars');
  const elReviews = document.getElementById('sat-reviews');

  if (elBars)    elBars.innerHTML    = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px">Carregando…</div>';
  if (elReviews) elReviews.innerHTML = '';

  try {
    const { data: ratings, error } = await sb.from('ratings').select('*').order('created_at', { ascending: false });
    if (error) throw error;

    const list  = ratings || [];
    const total = list.length;
    const statEls   = document.querySelectorAll('#page-satisfacao .sg .sv');
    const statTrend = document.querySelector('#page-satisfacao .sg .str');

    if (total === 0) {
      const vazio = `<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:13px">
        <div style="margin-bottom:12px;color:var(--accent3)"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M8 2l1.5 3.5L13 6l-2.5 2.5.6 3.5L8 10.5 4.9 12l.6-3.5L3 6l3.5-.5L8 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></div>
        Nenhuma avaliação ainda.<br>
        <small style="font-size:11.5px">Quando clientes responderem ao link de avaliação, os dados aparecerão aqui.</small>
      </div>`;
      if (elBars)    elBars.innerHTML    = vazio;
      if (elReviews) elReviews.innerHTML = '';
      if (statEls[0]) statEls[0].textContent = '—';
      if (statEls[1]) statEls[1].textContent = '0';
      if (statEls[2]) statEls[2].textContent = '—';
      if (statEls[3]) statEls[3].textContent = '—';
      return;
    }

    const soma          = list.reduce((s, r) => s + (r.nota || 0), 0);
    const media         = soma / total;
    const satisfeitos   = list.filter(r => r.nota >= 4).length;
    const insatisfeitos = list.filter(r => r.nota <= 2).length;

    if (statEls[0]) statEls[0].textContent = media.toFixed(1);
    if (statEls[1]) statEls[1].textContent = total;
    if (statEls[2]) statEls[2].textContent = Math.round((satisfeitos / total) * 100) + '%';
    if (statEls[3]) statEls[3].textContent = Math.round((insatisfeitos / total) * 100) + '%';
    if (statTrend)  statTrend.textContent  = media >= 4.5 ? '↑ Excelente' : media >= 3.5 ? '→ Bom' : '↓ Atenção';

    // Distribuição de notas
    const dist = [5,4,3,2,1].map(nota => {
      const count = list.filter(r => r.nota === nota).length;
      const pct   = Math.round((count / total) * 100);
      const clr   = nota >= 4 ? 'var(--success)' : nota === 3 ? '#f59e0b' : 'var(--danger)';
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:12px;font-weight:700;min-width:14px;text-align:right">${nota}</span>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M8 2l1.5 3.5L13 6l-2.5 2.5.6 3.5L8 10.5 4.9 12l.6-3.5L3 6l3.5-.5L8 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        <div style="flex:1;height:9px;background:var(--surface2);border-radius:99px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${clr};border-radius:99px"></div>
        </div>
        <span style="font-size:11.5px;color:var(--muted);min-width:32px;text-align:right">${count}x</span>
      </div>`;
    }).join('');
    if (elBars) elBars.innerHTML = dist;

    // Últimas avaliações
    const EMOJI = { 5:'😍', 4:'😊', 3:'😐', 2:'😕', 1:'😠' };
    const revs = list.slice(0, 30).map(r => {
      const stars = '⭐'.repeat(r.nota || 0);
      const dt    = r.created_at
        ? new Date(r.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
        : '';
      return `<div style="padding:12px 0;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:flex-start">
        <div style="font-size:26px;flex-shrink:0;line-height:1">${EMOJI[r.nota] || '⭐'}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px">
            <span style="font-weight:700;font-size:13px">${r.client || 'Cliente'}</span>
            <span style="font-size:11px;color:var(--muted);white-space:nowrap">${dt}</span>
          </div>
          <div style="font-size:13px;margin-bottom:${r.comentario ? '5px' : '0'}">${stars}</div>
          ${r.comentario ? `<div style="font-size:12.5px;color:var(--muted2);line-height:1.5">${r.comentario}</div>` : ''}
          ${r.order_id   ? `<div style="font-size:11px;color:var(--muted);margin-top:3px">Pedido #${String(r.order_id).padStart(3,'0')}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    if (elReviews) elReviews.innerHTML = revs || '<div style="color:var(--muted);font-size:12px;padding:12px">Nenhuma avaliação.</div>';

  } catch(e) {
    console.error('renderSatisfacao:', e);
    const err = '<div style="color:var(--muted);font-size:12.5px;padding:20px;text-align:center">Erro ao carregar avaliações.</div>';
    if (elBars)    elBars.innerHTML    = err;
    if (elReviews) elReviews.innerHTML = '';
  }
}

// ─────────────────────────────────────────
// MEU PLANO
// ─────────────────────────────────────────
async function renderMeuPlano() {
  const elNome   = document.getElementById('plano-nome-display');
  const elExpira = document.getElementById('plano-expira-display');
  const elDias   = document.getElementById('plano-dias-display');
  const elTenant = document.getElementById('plano-tenant-display');
  const elBadge  = document.getElementById('plano-badge-wrap');
  const elStatus = document.getElementById('plano-status-wrap');
  const elRecursos = document.getElementById('plano-recursos-grid');
  const elBgDeco = document.getElementById('plano-bg-deco');

  if (elNome) elNome.textContent = 'Carregando...';
  
  // Carregar precos dos planos
  carregarPrecosPlanos();

  try {
    const tid = _sessao?.tenant_id;
    if (!tid) throw new Error('Sessão inválida');

    const res = await fetch('/api/tenant-info-gestor', {
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid }
    });
    if (!res.ok) throw new Error('Erro HTTP ' + res.status);
    const data = await res.json();
    if (!data) throw new Error('Tenant não encontrado');

    const plano     = (data.plano || 'pro').toLowerCase();
    const isPremium = plano === 'premium';
    const expira    = data.expires_at ? new Date(data.expires_at) : null;
    const hoje      = new Date();
    hoje.setHours(0,0,0,0);
    const diasRestantes = expira
      ? Math.ceil((expira - hoje) / (1000 * 60 * 60 * 24))
      : null;

    // ── Nome e badge ──
    const planoLabel = isPremium ? 'Premium' : 'Pro';
    const planoColor = isPremium ? '#7c3aed' : 'var(--accent)';
    if (elNome)   { elNome.textContent = planoLabel; elNome.style.color = planoColor; }
    if (elBgDeco) elBgDeco.style.background = planoColor;
    if (elBadge)  elBadge.innerHTML = `
      <div style="padding:4px 12px;border-radius:99px;font-size:11px;font-weight:800;letter-spacing:.4px;
        background:${isPremium ? 'rgba(124,58,237,.15)' : 'rgba(59,130,246,.12)'};
        color:${planoColor};border:1px solid ${isPremium ? 'rgba(124,58,237,.35)' : 'rgba(59,130,246,.3)'}">
        ${planoLabel.toUpperCase()}
      </div>`;

    // ── Vencimento ──
    const expiraStr = expira
      ? expira.toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' })
      : 'Sem data definida';
    if (elExpira) elExpira.textContent = expiraStr;

    // ── Dias restantes ──
    let diasStr = 'Sem data definida';
    let diasColor = 'var(--text)';
    if (diasRestantes !== null) {
      if (diasRestantes > 30)       { diasStr = `${diasRestantes} dias`; diasColor = 'var(--success)'; }
      else if (diasRestantes > 7)   { diasStr = `${diasRestantes} dias`; diasColor = 'var(--warning,#f59e0b)'; }
      else if (diasRestantes > 0)   { diasStr = `${diasRestantes} dias — vence em breve`; diasColor = 'var(--danger)'; }
      else if (diasRestantes === 0) { diasStr = 'Vence hoje'; diasColor = 'var(--danger)'; }
      else                          { diasStr = 'Vencido'; diasColor = 'var(--danger)'; }
    }
    if (elDias) { elDias.textContent = diasStr; elDias.style.color = diasColor; }

    // ── Nome do tenant ──
    if (elTenant) elTenant.textContent = data.nome || _sessao?.nome || '—';

    // ── Status ──
    if (elStatus) {
      const ativo = data.ativo !== 0 && data.ativo !== false;
      const vencido = diasRestantes !== null && diasRestantes < 0;
      const alertaBarra = diasRestantes !== null && diasRestantes <= 30 && diasRestantes >= 0;
      const pct = alertaBarra ? Math.max(0, Math.min(100, Math.round((diasRestantes / 30) * 100))) : null;

      let statusHtml = '';
      if (!ativo || vencido) {
        statusHtml += `
          <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;
            background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:10px">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="color:var(--danger);flex-shrink:0">
              <path d="M8 2L14 13H2L8 2z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M8 6v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              <circle cx="8" cy="11" r=".6" fill="currentColor"/>
            </svg>
            <div>
              <div style="font-weight:700;font-size:13px;color:var(--danger)">${vencido ? 'Plano vencido' : 'Conta inativa'}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:1px">Entre em contato com o suporte para reativar.</div>
            </div>
          </div>`;
      } else {
        statusHtml += `
          <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;
            background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:10px">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="color:var(--success);flex-shrink:0">
              <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/>
              <path d="M5.5 8l2 2 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
            <div>
              <div style="font-weight:700;font-size:13px;color:var(--success)">Assinatura ativa</div>
              <div style="font-size:12px;color:var(--muted);margin-top:1px">Todos os recursos disponíveis.</div>
            </div>
          </div>`;
      }
      if (alertaBarra && pct !== null) {
        const barColor = diasRestantes <= 7 ? 'var(--danger)' : '#f59e0b';
        statusHtml += `
          <div style="margin-top:4px">
            <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-bottom:5px">
              <span>Tempo restante do plano</span>
              <span style="font-weight:700;color:${barColor}">${diasRestantes}d de 30d</span>
            </div>
            <div style="height:7px;background:var(--surface2);border-radius:99px;overflow:hidden">
              <div style="width:${pct}%;height:100%;background:${barColor};border-radius:99px;transition:width .5s"></div>
            </div>
          </div>`;
      }
      elStatus.innerHTML = statusHtml;
    }

    // ── Recursos ──
    const recursosPro = [
      { svg:'<path d="M2 2h12v12H2z" stroke="currentColor" stroke-width="1.4" fill="none" rx="2"/><path d="M5 6h6M5 9h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Gestão de pedidos (Kanban)' },
      { svg:'<rect x="1" y="4" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8.5" r="2" stroke="currentColor" stroke-width="1.4"/>', label:'PDV / Pedidos no balcão' },
      { svg:'<rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5 8h6M8 5v6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Gestor de cardápio' },
      { svg:'<path d="M3 12V5l5-3 5 3v7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><rect x="6" y="8" width="4" height="4" rx=".5" stroke="currentColor" stroke-width="1.4"/>', label:'Mesas e garçons' },
      { svg:'<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 2c-1.5 2-2.5 3.8-2.5 6s1 4 2.5 6M2 8h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Cardápio público online' },
      { svg:'<path d="M2 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V4z" stroke="currentColor" stroke-width="1.4" fill="none"/>', label:'Automações de WhatsApp' },
      { svg:'<path d="M8 2l1.5 3.5L13 6l-2.5 2.5.6 3.5L8 10.5 4.9 12l.6-3.5L3 6l3.5-.5z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>', label:'Satisfação e avaliações' },
      { svg:'<rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/>', label:'QR Code da mesa' },
      { svg:'<path d="M2 12L6 4l3 5 2-2.5L14 12H2z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>', label:'Relatórios e desempenho' },
      { svg:'<rect x="1" y="4" width="14" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="2" width="10" height="4" rx="1" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="9" r="1.5" stroke="currentColor" stroke-width="1.4"/>', label:'Caixa e movimentos' },
      { svg:'<path d="M8 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM2 13c0-2.76 2.24-5 5-5h2c2.76 0 5 2.24 5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Programa de fidelidade' },
      { svg:'<rect x="3" y="2" width="10" height="4" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="10" width="10" height="4" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M3 6H2a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1M13 6h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1" stroke="currentColor" stroke-width="1.4"/>', label:'Impressão térmica' },
    ];
    const extraPremium = [
      { svg:'<rect x="3" y="5" width="10" height="8" rx="2" stroke="currentColor" stroke-width="1.4"/><circle cx="6" cy="9" r="1" fill="currentColor"/><circle cx="10" cy="9" r="1" fill="currentColor"/><path d="M6 5V3.5M10 5V3.5M6 3.5H10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Agente IA no WhatsApp', destaque: true },
      { svg:'<path d="M2 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V4z" stroke="currentColor" stroke-width="1.4"/><path d="M5 7h6M5 9.5h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Simulador do robô', destaque: true },
    ];
    const recursos = isPremium ? [...recursosPro, ...extraPremium] : recursosPro;
    if (elRecursos) {
      elRecursos.innerHTML = recursos.map(r => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
          background:var(--surface2);border:1px solid ${r.destaque ? 'rgba(124,58,237,.3)' : 'var(--border)'};border-radius:10px;
          ${r.destaque ? 'background:rgba(124,58,237,.07);' : ''}">
          <div style="width:28px;height:28px;border-radius:7px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
            background:${r.destaque ? 'rgba(124,58,237,.15)' : 'var(--surface)'};
            border:1px solid ${r.destaque ? 'rgba(124,58,237,.25)' : 'var(--border)'};
            color:${r.destaque ? '#a78bfa' : 'var(--muted)'}">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">${r.svg}</svg>
          </div>
          <span style="font-size:12.5px;font-weight:500;color:${r.destaque ? 'var(--text)' : 'var(--muted2)'};flex:1">${r.label}</span>
          <svg viewBox="0 0 16 16" fill="none" width="12" height="12" style="flex-shrink:0;color:${r.destaque ? '#a78bfa' : 'var(--success)'}">
            ${r.destaque
              ? '<path d="M8 2l1.5 3.5L13 6l-2.5 2.5.6 3.5L8 10.5 4.9 12l.6-3.5L3 6l3.5-.5z" stroke="currentColor" stroke-width="1.3" fill="none"/>'
              : '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 8l2 2 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'}
          </svg>
        </div>`).join('');
    }

  } catch(e) {
    console.error('renderMeuPlano:', e);
    if (elNome) elNome.textContent = '—';
    if (elStatus) elStatus.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:12px;text-align:center">Não foi possível carregar as informações do plano.</div>`;
  }
}

// ─────────────────────────────────────────
// RENOVACAO DE PLANOS
// ─────────────────────────────────────────
let _planoSelecionado = 'premium';
let _formaPagPlano = 'pix';
let _precosPlanos = { essencial: 79.99, premium: 99.90 };
let _pixPlanoInterval = null;

async function carregarPrecosPlanos() {
  try {
    const res = await fetch('/api/planos/precos');
    if (res.ok) {
      const data = await res.json();
      _precosPlanos = { essencial: data.essencial || 79.99, premium: data.premium || 99.90 };
      const elEss = document.getElementById('preco-essencial');
      const elPre = document.getElementById('preco-premium');
      if (elEss) elEss.textContent = _precosPlanos.essencial.toFixed(2).replace('.', ',');
      if (elPre) elPre.textContent = _precosPlanos.premium.toFixed(2).replace('.', ',');
    }
  } catch(e) { console.error('carregarPrecosPlanos:', e); }
}

function selecionarPlano(plano) {
  _planoSelecionado = plano;
  const cardEss = document.getElementById('plano-card-essencial');
  const cardPre = document.getElementById('plano-card-premium');
  const dotEss = document.getElementById('plano-dot-essencial');
  const dotPre = document.getElementById('plano-dot-premium');
  const checkEss = document.getElementById('plano-check-essencial');
  const checkPre = document.getElementById('plano-check-premium');

  if (plano === 'essencial') {
    if (cardEss) { cardEss.style.borderColor = 'var(--accent)'; cardEss.style.background = 'rgba(59,130,246,.05)'; }
    if (cardPre) { cardPre.style.borderColor = 'rgba(139,92,246,.3)'; cardPre.style.background = 'linear-gradient(135deg,rgba(139,92,246,.08),rgba(236,72,153,.05))'; }
    if (dotEss) dotEss.style.background = 'var(--accent)';
    if (dotPre) dotPre.style.background = 'transparent';
    if (checkEss) checkEss.style.borderColor = 'var(--accent)';
    if (checkPre) checkPre.style.borderColor = 'rgba(139,92,246,.5)';
  } else {
    if (cardEss) { cardEss.style.borderColor = 'var(--border)'; cardEss.style.background = 'var(--surface2)'; }
    if (cardPre) { cardPre.style.borderColor = 'var(--purple)'; cardPre.style.background = 'linear-gradient(135deg,rgba(139,92,246,.12),rgba(236,72,153,.08))'; }
    if (dotEss) dotEss.style.background = 'transparent';
    if (dotPre) dotPre.style.background = 'var(--purple)';
    if (checkEss) checkEss.style.borderColor = 'var(--border)';
    if (checkPre) checkPre.style.borderColor = 'var(--purple)';
  }
}

function selecionarFormaPagPlano(forma) {
  _formaPagPlano = forma;
  const optPix = document.getElementById('pag-opt-pix');
  const optCartao = document.getElementById('pag-opt-cartao');
  if (forma === 'pix') {
    if (optPix) { optPix.style.background = 'rgba(59,130,246,.08)'; optPix.style.borderColor = 'var(--accent)'; }
    if (optCartao) { optCartao.style.background = 'var(--surface)'; optCartao.style.borderColor = 'var(--border)'; }
  } else {
    if (optPix) { optPix.style.background = 'var(--surface)'; optPix.style.borderColor = 'var(--border)'; }
    if (optCartao) { optCartao.style.background = 'rgba(59,130,246,.08)'; optCartao.style.borderColor = 'var(--accent)'; }
  }
}

async function iniciarPagamentoPlano() {
  const btn = document.getElementById('btn-pagar-plano');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Processando...'; }
  
  const planoNome = _planoSelecionado === 'essencial' ? 'Plano Essencial' : 'Plano Premium';
  const valor = _precosPlanos[_planoSelecionado];
  
  if (_formaPagPlano === 'pix') {
    try {
      const tid = _sessao?.tenant_id;
      const res = await fetch('/api/planos/pagar-pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
        body: JSON.stringify({ plano: _planoSelecionado, valor })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao criar PIX');
      
      // Mostrar modal com QR Code
      document.getElementById('pix-plano-titulo').textContent = planoNome;
      document.getElementById('pix-plano-valor').textContent = 'R$ ' + valor.toFixed(2).replace('.', ',');
      document.getElementById('pix-plano-code').value = data.qr_code || '';
      document.getElementById('pix-plano-mp-id').value = data.mp_payment_id || '';
      
      if (data.qr_code_base64) {
        document.getElementById('pix-qr-img').innerHTML = `<img src="data:image/png;base64,${data.qr_code_base64}" style="width:200px;height:200px">`;
      } else {
        document.getElementById('pix-qr-img').innerHTML = '<div style="color:var(--muted);font-size:12px">QR Code nao disponivel.<br>Use o codigo PIX abaixo.</div>';
      }
      
      document.getElementById('modal-pag-pix-plano').classList.add('on');
      iniciarPollingPixPlano(data.mp_payment_id);
      
    } catch(e) {
      sbToast('err', e.message);
    }
  } else {
    // Cartao
    document.getElementById('cartao-plano-titulo').textContent = planoNome;
    document.getElementById('cartao-plano-valor').textContent = 'R$ ' + valor.toFixed(2).replace('.', ',');
    document.getElementById('modal-pag-cartao-plano').classList.add('on');
  }
  
  if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M8 2v12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Renovar Plano'; }
}

function iniciarPollingPixPlano(mpId) {
  if (_pixPlanoInterval) clearInterval(_pixPlanoInterval);
  let checks = 0;
  _pixPlanoInterval = setInterval(async () => {
    checks++;
    if (checks > 120) { // 10 minutos
      clearInterval(_pixPlanoInterval);
      document.getElementById('pix-status-text').textContent = 'Tempo esgotado. Tente novamente.';
      return;
    }
    try {
      const res = await fetch('/api/planos/status-pix?mp_payment_id=' + mpId);
      const data = await res.json();
      if (data.status === 'aprovado') {
        clearInterval(_pixPlanoInterval);
        document.getElementById('pix-status-text').textContent = 'Pagamento confirmado!';
        document.getElementById('pix-status-text').parentElement.style.background = 'rgba(34,197,94,.1)';
        document.getElementById('pix-status-text').parentElement.style.borderColor = 'rgba(34,197,94,.3)';
        sbToast('ok', 'Pagamento confirmado! Seu plano foi renovado.');
        setTimeout(() => {
          fecharModalPagPlano();
          renderMeuPlano();
        }, 2000);
      }
    } catch(e) {}
  }, 5000);
}

function copiarPixPlano() {
  const code = document.getElementById('pix-plano-code').value;
  if (!code) { sbToast('err', 'Codigo PIX nao disponivel'); return; }
  navigator.clipboard.writeText(code).then(() => {
    sbToast('ok', 'Codigo PIX copiado!');
    const btn = document.getElementById('btn-copiar-pix-plano');
    if (btn) { btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Copiado!'; }
  });
}

function fecharModalPagPlano() {
  document.getElementById('modal-pag-pix-plano')?.classList.remove('on');
  document.getElementById('modal-pag-cartao-plano')?.classList.remove('on');
  if (_pixPlanoInterval) { clearInterval(_pixPlanoInterval); _pixPlanoInterval = null; }
}

function formatarCartao(el) {
  let v = el.value.replace(/\D/g, '');
  v = v.replace(/(\d{4})(?=\d)/g, '$1 ');
  el.value = v.substring(0, 19);
}

function formatarValidade(el) {
  let v = el.value.replace(/\D/g, '');
  if (v.length >= 2) v = v.substring(0,2) + '/' + v.substring(2);
  el.value = v.substring(0, 5);
}

function formatarCPF(el) {
  let v = el.value.replace(/\D/g, '');
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  el.value = v.substring(0, 14);
}

let _mpPlanoInstance = null;

async function carregarMPSDKPlano() {
  if (_mpPlanoInstance) return _mpPlanoInstance;
  // Carrega SDK se ainda nao carregado
  if (!window.MercadoPago) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://sdk.mercadopago.com/js/v2';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  // Busca public key
  const res = await fetch('/api/planos/mp-public-key');
  const data = await res.json();
  if (!data.public_key) throw new Error('Public Key do Mercado Pago nao configurada no Admin');
  _mpPlanoInstance = new MercadoPago(data.public_key);
  return _mpPlanoInstance;
}

async function processarPagamentoCartao() {
  const btn = document.getElementById('btn-pagar-cartao-plano');
  const numero = document.getElementById('cartao-numero').value.replace(/\s/g, '');
  const validade = document.getElementById('cartao-validade').value;
  const cvv = document.getElementById('cartao-cvv').value;
  const nome = document.getElementById('cartao-nome').value;
  const cpf = document.getElementById('cartao-cpf').value.replace(/\D/g, '');
  const email = document.getElementById('cartao-email')?.value || 'cliente@email.com';
  
  if (!numero || numero.length < 13) { sbToast('err', 'Numero do cartao invalido'); return; }
  if (!validade || validade.length < 5) { sbToast('err', 'Validade invalida'); return; }
  if (!cvv || cvv.length < 3) { sbToast('err', 'CVV invalido'); return; }
  if (!nome) { sbToast('err', 'Nome no cartao obrigatorio'); return; }
  if (!cpf || cpf.length < 11) { sbToast('err', 'CPF invalido'); return; }
  
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Processando...'; }
  
  try {
    // Carrega SDK do Mercado Pago
    const mp = await carregarMPSDKPlano();
    
    const [mes, ano] = validade.split('/');
    
    // Cria card token usando SDK
    const cardToken = await mp.createCardToken({
      cardNumber: numero,
      cardholderName: nome,
      cardExpirationMonth: mes,
      cardExpirationYear: '20' + ano,
      securityCode: cvv,
      identificationType: 'CPF',
      identificationNumber: cpf
    });
    
    if (!cardToken?.id) throw new Error('Erro ao gerar token do cartao');
    
    // Detecta bandeira do cartao
    let paymentMethodId = 'visa';
    try {
      const bin = numero.substring(0, 6);
      const pmRes = await fetch(`https://api.mercadopago.com/v1/payment_methods/search?bin=${bin}&site_id=MLB`);
      const pmData = await pmRes.json();
      if (pmData.results?.[0]?.id) paymentMethodId = pmData.results[0].id;
    } catch {}
    
    const tid = _sessao?.tenant_id;
    const res = await fetch('/api/planos/pagar-cartao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({
        plano: _planoSelecionado,
        valor: _precosPlanos[_planoSelecionado],
        card_token: cardToken.id,
        payment_method_id: paymentMethodId,
        payer_email: email,
        payer_cpf: cpf
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao processar pagamento');
    
    if (data.status === 'aprovado') {
      sbToast('ok', 'Pagamento aprovado! Seu plano foi renovado.');
      fecharModalPagPlano();
      renderMeuPlano();
    } else if (data.status === 'pendente') {
      sbToast('ok', 'Pagamento em analise. Aguarde confirmacao.');
    } else {
      throw new Error(data.status_detail || 'Pagamento recusado');
    }
  } catch(e) {
    sbToast('err', e.message);
  }
  
  if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Pagar agora'; }
}

// Inicializar selecao padrao
setTimeout(() => {
  selecionarPlano('premium');
  carregarPrecosPlanos();
}, 100);

// ─────────────────────────────────────────
// IMPRESSÃO SILENCIOSA (server-side)
// ─────────────────────────────────────────
window._printMode  = localStorage.getItem('printMode')     || 'auto';
let _printMode     = window._printMode;
let _printFontSize = parseInt(localStorage.getItem('printFontSize') || '12');
let _printTarget   = localStorage.getItem('printTarget')   || 'server';
let _printPrinter  = localStorage.getItem('printPrinter')  || '';
let _printFormat   = localStorage.getItem('printFormat')   || '80mm';  // padrão 80mm

// ── Salva config de impressão no servidor (sincroniza entre dispositivos) ──
async function savePrintConfigServer(cfg) {
  try {
    const tid = window._tenantId || window.AppAPI?._tenantId || null
    if (!tid) return
    await window.AppAPI.from('store_config').update({ print_config: JSON.stringify(cfg) }).eq('tenant_id', tid)
  } catch {}
}

// ── Carrega config de impressão do servidor ──
async function loadPrintConfigServer() {
  try {
    const tid = window._tenantId || null
    if (!tid) return
    const { data } = await window.AppAPI.from('store_config').select('print_config').eq('tenant_id', tid).single()
    if (!data?.print_config) return
    const cfg = JSON.parse(data.print_config)
    if (cfg.printMode)    { _printMode = cfg.printMode;   localStorage.setItem('printMode', cfg.printMode) }
    if (cfg.printFormat)  { _printFormat = cfg.printFormat; localStorage.setItem('printFormat', cfg.printFormat) }
    if (cfg.printFontSize){ _printFontSize = cfg.printFontSize; localStorage.setItem('printFontSize', cfg.printFontSize) }
    if (cfg.printNome)    { const el = document.getElementById('print-nome');    if (el) el.value = cfg.printNome }
    if (cfg.printSub)     { const el = document.getElementById('print-sub');     if (el) el.value = cfg.printSub }
    if (cfg.printRodape)  { const el = document.getElementById('print-rodape');  if (el) el.value = cfg.printRodape }
  } catch {}
}

function setPrintMode(mode) {
  _printMode = mode;
  window._printMode = mode;
  localStorage.setItem('printMode', mode);
  const isAuto = mode === 'auto';
  const la = document.getElementById('lbl-print-auto');
  const lm = document.getElementById('lbl-print-manual');
  const da = document.getElementById('dot-auto');
  const dm = document.getElementById('dot-manual');
  if (la) { la.style.background = isAuto ? 'rgba(59,130,246,.1)' : 'var(--surface2)'; la.style.borderColor = isAuto ? 'var(--accent)' : 'var(--border)'; }
  if (lm) { lm.style.background = !isAuto ? 'rgba(59,130,246,.1)' : 'var(--surface2)'; lm.style.borderColor = !isAuto ? 'var(--accent)' : 'var(--border)'; }
  if (da) da.style.background = isAuto ? '#fff' : 'transparent';
  if (dm) dm.style.background = !isAuto ? '#fff' : 'transparent';
  sbToast('ok', isAuto ? 'Impressão automática ativada' : 'Impressão manual ativada');
}

function _getPrintConfig() {
  const fs = parseInt(document.getElementById('print-font-size')?.value || _printFontSize);
  if (!isNaN(fs)) { _printFontSize = fs; localStorage.setItem('printFontSize', fs); }
  return {
    nome:     ((document.getElementById('print-nome')?.value)   || 'ESTIMA FOOD').toUpperCase(),
    sub:       (document.getElementById('print-sub')?.value)    || '',
    rodape:    (document.getElementById('print-rodape')?.value) || 'Obrigado!',
    addr:      document.getElementById('toggle-print-addr')?.classList.contains('on') ?? true,
    pag:       document.getElementById('toggle-print-pag')?.classList.contains('on')  ?? true,
    fontSize:  fs || 12,
  };
}

function _buildTicketHtml(order, cfg) {
  const items = Array.isArray(order.items) ? order.items : [];
  const now = new Date().toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const money = v => 'R$ ' + parseFloat(v||0).toFixed(2).replace('.',',');
  const itemLines = items.map(i => {
    const name = (i.qty + 'x ' + i.name).toUpperCase();
    const price = money((i.price||0) * (i.qty||1));
    return `<div style="display:flex;justify-content:space-between"><span>${name}</span><span style="white-space:nowrap;margin-left:8px">${price}</span></div>`;
  }).join('');
  const subtotal = items.reduce((s,i) => s + (parseFloat(i.price||0) * (i.qty||1)), 0);
  const taxa = parseFloat(order.taxa || 0);
  const total = subtotal + taxa;
  const orderNum = order.num || order.id;
  return `<div class="print-ticket" style="font-size:${cfg.fontSize}px">
    <div class="pt-center pt-large">${cfg.nome}</div>
    ${cfg.sub ? `<div class="pt-center" style="font-size:0.85em">${cfg.sub}</div>` : ''}
    <hr class="pt-hr">
    <div>Pedido: <b>#${orderNum}</b></div>
    <div>Data: ${now}</div>
    <div>Cliente: ${order.client || '—'}</div>
    ${cfg.addr && order.addr ? `<div>Local: ${order.addr}</div>` : ''}
    <hr class="pt-hr">
    ${itemLines}
    <hr class="pt-hr">
    ${taxa > 0 ? `<div style="display:flex;justify-content:space-between"><span>Subtotal</span><span>${money(subtotal)}</span></div><div style="display:flex;justify-content:space-between"><span>Taxa entrega</span><span>${money(taxa)}</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;font-weight:bold"><span>TOTAL</span><span>${money(total)}</span></div>
    ${cfg.pag && order.pag ? `<div>Pagamento: ${order.pag}</div>` : ''}
    <hr class="pt-hr">
    <div class="pt-center" style="font-size:0.85em">${cfg.rodape}</div>
  </div>`;
}

// ── Carrega lista de impressoras do servidor ──────────
async function loadPrinters() {
  const sel = document.getElementById('print-printer-select');
  if (!sel) return;
  try {
    let printers = [];
    let defaultPrinter = '';

    // Electron: busca impressoras do Windows diretamente
    if (window.ElectronPrint) {
      const cfg = await window.ElectronPrint.getPrintConfig();
      printers      = cfg.printers || [];
      defaultPrinter = cfg.printer || '';
      _printPrinter  = cfg.printer || _printPrinter;
    } else {
      // Web: busca do servidor
      const r = await fetch('/api/printers');
      const d = await r.json();
      printers       = d.printers || [];
      defaultPrinter = d.default  || '';
    }

    sel.innerHTML = '<option value="">Impressora padrão do sistema</option>' +
      printers.map(p =>
        `<option value="${p}" ${p === _printPrinter ? 'selected' : ''}>${p}${p === defaultPrinter ? ' ★' : ''}</option>`
      ).join('');
    if (_printPrinter) sel.value = _printPrinter;
  } catch { sel.innerHTML = '<option value="">Impressora padrão do sistema</option>'; }
}

// ── Impressão via agente local (computador da loja) ──
async function _printViaAgent(html) {
  const printer = document.getElementById('print-printer-select')?.value || _printPrinter || '';
  const format  = document.getElementById('print-format-select')?.value  || _printFormat  || 'A4';
  const res = await fetch('/api/print-queue/job', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ html, format, printer: printer || undefined }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro ao criar job');
  return data;
}

// ── Impressão via servidor (silenciosa, Puppeteer) ───
async function _printViaServer(html) {
  const printer = document.getElementById('print-printer-select')?.value || _printPrinter || '';
  const format  = document.getElementById('print-format-select')?.value  || _printFormat  || '80mm';
  _printPrinter = printer; localStorage.setItem('printPrinter', printer);
  _printFormat  = format;  localStorage.setItem('printFormat',  format);
  const tid = (() => { try { return JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || ''; } catch { return ''; } })();
  const res = await fetch('/api/print', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
    body:    JSON.stringify({ html, printer: printer || undefined, format }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro no servidor');

  // Servidor gerou o PDF — abre nova aba e imprime
  // (Chrome não suporta print() em PDF dentro de iframe)
  if (data.pdf) {
    const bytes = Uint8Array.from(atob(data.pdf), c => c.charCodeAt(0));
    const blob  = new Blob([bytes], { type: 'application/pdf' });
    const url   = URL.createObjectURL(blob);
    const win   = window.open(url, '_blank');
    if (win) {
      win.onload = () => {
        win.print();
        setTimeout(() => { win.close(); URL.revokeObjectURL(url); }, 2000);
      };
      // fallback: onload nem sempre dispara em PDFs
      setTimeout(() => {
        try { win.print(); } catch(_) {}
        setTimeout(() => { try { win.close(); } catch(_){} URL.revokeObjectURL(url); }, 2000);
      }, 1500);
    } else {
      sbToast('warn', '⚠️ Popup bloqueado — abra o Chrome com --kiosk-printing');
      URL.revokeObjectURL(url);
    }
  }
  return data;
}

// ── Impressão via navegador (fallback final) ─────────
function _printViaBrowser(html) {
  const frame = document.getElementById('print-frame');
  if (!frame) return;

  // Monta HTML completo dentro do iframe
  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box }
  body { font-family:'Courier New',monospace; font-size:12px; color:#000; background:#fff }
  hr { border:none; border-top:1px dashed #000; margin:4px 0 }
  .pt-center { text-align:center } .pt-large { font-size:15px; font-weight:bold }
  .pt-hr { border:none; border-top:1px dashed #000; margin:4px 0 }
  .print-ticket { padding:4px; width:100% }
  @media print { @page { margin:2mm } body { margin:0 } }
</style></head><body>${html}
<script>
  window.onload = function() {
    window.print();
    // Avisa o pai para esconder o frame após imprimir
    setTimeout(function() {
      try { window.parent.document.getElementById('print-frame').style.display='none'; } catch(_) {}
    }, 1500);
  };
<\/script></body></html>`;

  frame.style.display = 'block';
  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(fullHtml);
    doc.close();
  } else {
    // Fallback absoluto: blob URL
    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    frame.src  = url;
    frame.onload = () => {
      try { frame.contentWindow.print(); } catch (_) {}
      setTimeout(() => { frame.style.display = 'none'; URL.revokeObjectURL(url); }, 2000);
    };
  }
}

// ── Aviso quando nenhum método silencioso está disponível ────────
function _showPrintAgentToast() {
  const msg =
    '🖨️ Nenhum agente ativo. Para imprimir sem confirmação, ' +
    'inicie o print-agent.js no computador da loja.';
  if (typeof sbToast === 'function') sbToast('warn', msg);
  else console.warn(msg);
}

// ══════════════════════════════════════════════════════════════
// ESC/POS via WebUSB — imprime direto na térmica sem diálogo
// ══════════════════════════════════════════════════════════════
let _usbDevice = null; // guarda o device pareado entre impressões

// Converte o pedido em bytes ESC/POS puros
function _buildEscPos(order, cfg, cols = 32) {
  const enc  = new TextEncoder();
  const buf  = [];
  const push = (str) => enc.encode(str).forEach(b => buf.push(b));
  const bytes= (...b) => b.forEach(b => buf.push(b));

  const money = v => 'R$ ' + parseFloat(v || 0).toFixed(2).replace('.', ',');
  const center = (str) => {
    const pad = Math.max(0, Math.floor((cols - str.length) / 2));
    return ' '.repeat(pad) + str;
  };
  const cols2 = (left, right) => {
    const space = cols - left.length - right.length;
    return left + (space > 0 ? ' '.repeat(space) : ' ') + right;
  };

  // Init
  const sep = '-'.repeat(cols) + '\n';
  bytes(0x1B, 0x40);                         // ESC @ — reset
  bytes(0x1B, 0x61, 0x01);                   // centralizar
  bytes(0x1D, 0x21, 0x10);                   // fonte dupla altura
  push(cfg.nome + '\n');
  bytes(0x1D, 0x21, 0x00);                   // fonte normal
  if (cfg.sub) push(cfg.sub + '\n');
  bytes(0x1B, 0x61, 0x00);                   // alinhar esquerda
  push(sep);

  const now = new Date().toLocaleString('pt-BR', {
    day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  });
  push('Pedido: #' + (order.num || order.id) + '\n');
  push('Data: ' + now + '\n');
  push('Cliente: ' + (order.client || '—') + '\n');
  if (cfg.addr && order.addr) push('Local: ' + order.addr + '\n');
  if (order.pag) push('Pagto: ' + order.pag + '\n');
  push(sep);

  const items = Array.isArray(order.items) ? order.items : [];
  const maxNameLen = cols - 14; // reserva espaço para preço "R$ 9.999,99"
  items.forEach(i => {
    const name  = (i.qty + 'x ' + i.name).toUpperCase().substring(0, maxNameLen);
    const price = money((i.price || 0) * (i.qty || 1));
    push(cols2(name, price) + '\n');
    if (i.obs) push('  * ' + i.obs + '\n');
  });

  const subtotal = items.reduce((s, i) => s + (parseFloat(i.price || 0) * (i.qty || 1)), 0);
  const taxa  = parseFloat(order.taxa || 0);
  const total = subtotal + taxa;

  push(sep);
  if (taxa > 0) {
    push(cols2('Subtotal', money(subtotal)) + '\n');
    push(cols2('Taxa entrega', money(taxa)) + '\n');
  }
  bytes(0x1B, 0x45, 0x01);                   // negrito
  push(cols2('TOTAL', money(total)) + '\n');
  bytes(0x1B, 0x45, 0x00);
  push(sep);

  bytes(0x1B, 0x61, 0x01);                   // centralizar
  push((cfg.rodape || 'Obrigado!') + '\n');
  bytes(0x1B, 0x61, 0x00);

  // Avança papel e corta
  bytes(0x0A, 0x0A, 0x0A);                   // 3 linhas
  bytes(0x1D, 0x56, 0x42, 0x00);             // GS V — corte parcial

  return new Uint8Array(buf);
}

// Conecta (ou reutiliza) o dispositivo USB pareado
async function _usbConnect() {
  if (_usbDevice && _usbDevice.opened) return _usbDevice;

  // Tenta reutilizar dispositivo já autorizado
  const devices = await navigator.usb.getDevices();
  const saved   = localStorage.getItem('escpos_usb_name');
  let dev = devices.find(d =>
    saved ? (d.productName + d.manufacturerName).includes(saved) : true
  ) || devices[0];

  if (!dev) {
    // Pede permissão ao usuário (só na primeira vez)
    dev = await navigator.usb.requestDevice({ filters: [] });
    localStorage.setItem('escpos_usb_name', (dev.productName || '') + (dev.manufacturerName || ''));
  }

  await dev.open();
  if (dev.configuration === null) await dev.selectConfiguration(1);
  // Acha a interface com endpoint bulk-out
  for (const iface of dev.configuration.interfaces) {
    try {
      await dev.claimInterface(iface.interfaceNumber);
      _usbDevice = dev;
      _usbDevice._epOut = iface.alternates[0]?.endpoints
        .find(e => e.direction === 'out')?.endpointNumber;
      if (_usbDevice._epOut !== undefined) break;
      await dev.releaseInterface(iface.interfaceNumber);
    } catch {}
  }

  if (!_usbDevice) throw new Error('Nenhuma interface de saída encontrada na impressora');
  return _usbDevice;
}

async function _printViaUsb(order, cfg) {
  if (!navigator.usb) throw new Error('WebUSB não suportado neste navegador');
  console.log('[USB] Conectando dispositivo...');
  const dev  = await _usbConnect();
  console.log('[USB] Dispositivo conectado | endpoint:', _usbDevice._epOut);
  const fmt  = localStorage.getItem('printFormat') || _printFormat || '80mm';
  const cols = fmt === '58mm' ? 32 : 48;
  const data = _buildEscPos(order, cfg, cols);
  console.log('[USB] Dados ESC/POS gerados | bytes:', data.length, '| colunas:', cols);
  // Envia em chunks de 64 bytes para evitar overflow em impressoras lentas
  const CHUNK = 64;
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, Math.min(i + CHUNK, data.length));
    await dev.transferOut(_usbDevice._epOut, chunk);
  }
  console.log('[USB] Impressão concluída!');
}

// Pareia a impressora USB (chamado pelo botão na tela de configuração)
async function pairUsbPrinter() {
  if (!navigator.usb) {
    sbToast('err', 'WebUSB não suportado. Use Chrome ou Edge.');
    return;
  }
  try {
    const dev = await navigator.usb.requestDevice({ filters: [] });
    localStorage.setItem('escpos_usb_name', (dev.productName || '') + (dev.manufacturerName || ''));
    _usbDevice = null; // força reconexão na próxima impressão
    sbToast('ok', '✅ Impressora "' + (dev.productName || 'USB') + '" pareada! Impressão será 100% silenciosa.');
  } catch (e) {
    if (e.name === 'NotFoundError') sbToast('warn', 'Nenhuma impressora selecionada.');
    else sbToast('err', 'Erro ao parear: ' + e.message);
  }
}

// Desconecta e remove pareamento
async function unpairUsbPrinter() {
  if (_usbDevice) {
    try { await _usbDevice.close(); } catch {}
    _usbDevice = null;
  }
  localStorage.removeItem('escpos_usb_name');
  sbToast('ok', 'Impressora USB removida.');
}

async function printOrder(order) {
  const cfg  = _getPrintConfig();
  const html = _buildTicketHtml(order, cfg);
  const fmt  = localStorage.getItem('printFormat') || _printFormat || '80mm';

  // ═══ CASCATA DE IMPRESSÃO SILENCIOSA ═══
  // Tenta cada método na ordem — só vai ao próximo se falhar

  // 1️⃣ Electron (app desktop)
  if (window.ElectronPrint) {
    try {
      const r = await window.ElectronPrint.printOrder(order);
      if (r.ok) { sbToast('ok', '🖨️ Impresso (Electron)!'); return; }
    } catch (e) { console.warn('[PRINT] Electron falhou:', e.message); }
  }

  // 2️⃣ WebUSB ESC/POS — impressão DIRETA na térmica, 100% silenciosa
  if (navigator.usb && _usbDevice) {
    try {
      await _printViaUsb(order, cfg);
      sbToast('ok', '🖨️ Impresso (USB direto)!');
      return;
    } catch (e) { console.warn('[PRINT] USB falhou:', e.message); }
  }

  // 3️⃣ Print Agent — verifica se o agente local está ativo e envia pra fila
  try {
    const tid = (() => { try { return JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || ''; } catch { return ''; } })();
    if (tid) {
      const statusRes = await fetch('/api/print-queue/status', {
        headers: { 'x-tenant-id': tid }
      });
      const statusData = await statusRes.json();
      if (statusData.active) {
        await fetch('/api/print-queue/job', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
          body: JSON.stringify({ html, format: fmt, printer: _printPrinter || undefined }),
        });
        sbToast('ok', '🖨️ Enviado ao agente de impressão!');
        return;
      }
    }
  } catch (e) { console.warn('[PRINT] Agent falhou:', e.message); }

  // 4️⃣ WebUSB ESC/POS — se ainda não pareou, tenta conectar (pede permissão 1x)
  if (navigator.usb && !_usbDevice) {
    try {
      // Verifica se já tem device autorizado sem pedir permissão
      const devices = await navigator.usb.getDevices();
      if (devices.length > 0) {
        await _printViaUsb(order, cfg);
        sbToast('ok', '🖨️ Impresso (USB direto)!');
        return;
      }
    } catch (e) { console.warn('[PRINT] USB auto-connect falhou:', e.message); }
  }

  // 5️⃣ Servidor PDF + impressão via iframe oculto (semi-silencioso)
  //    Usa @media print CSS para tentar acionar kiosk-printing do Chrome
  try {
    const tid = (() => { try { return JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || ''; } catch { return ''; } })();
    if (tid) {
      const r = await fetch('/api/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
        body: JSON.stringify({ html, format: fmt, printer: _printPrinter || undefined }),
      });
      const data = await r.json();
      if (data.pdf) {
        const bytes = Uint8Array.from(atob(data.pdf), c => c.charCodeAt(0));
        const blob  = new Blob([bytes], { type: 'application/pdf' });
        const url   = URL.createObjectURL(blob);

        // Tenta imprimir via iframe oculto (silencioso com --kiosk-printing)
        let frame = document.getElementById('print-frame-pdf');
        if (!frame) {
          frame = document.createElement('iframe');
          frame.id = 'print-frame-pdf';
          frame.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;visibility:hidden';
          document.body.appendChild(frame);
        }
        frame.src = url;
        await new Promise((resolve) => {
          frame.onload = () => {
            try { frame.contentWindow.print(); } catch(_) {}
            resolve();
          };
          setTimeout(resolve, 3000);
        });
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        sbToast('ok', '🖨️ Imprimindo...');
        return;
      }
    }
  } catch (e) { console.warn('[PRINT] Server PDF falhou:', e.message); }

  // 6️⃣ FALLBACK FINAL — window.print() com área de impressão dedicada
  console.warn('[PRINT] Usando fallback window.print() — diálogo será exibido');
  let area = document.getElementById('_print_area');
  if (!area) { area = document.createElement('div'); area.id = '_print_area'; document.body.appendChild(area); }
  area.innerHTML = html;

  let st = document.getElementById('_print_style');
  if (!st) { st = document.createElement('style'); st.id = '_print_style'; document.head.appendChild(st); }
  st.innerHTML = `@media print {
    @page { margin: 2mm; size: ${fmt} auto; }
    body > *:not(#_print_area):not(#_print_style) { display: none !important; }
    #_print_area { display: block !important; position: static !important; }
  }`;

  window.print();
  setTimeout(() => { area.innerHTML = ''; }, 2000);
  sbToast('warn', '🖨️ Imprimindo (com diálogo)... Use o Agente ou USB para silenciar.');
}

function printOrderById(id) {
  const o = ordersKanban.find(x => x.id === id);
  if (o) printOrder(o); else sbToast('err', 'Pedido não encontrado');
}

let _renderImpressaoLoaded = false;
function renderImpressao(skipServerLoad) {
  const p = document.getElementById('print-preview');
  if (!p) return;
  const slider = document.getElementById('print-font-size');
  const valEl  = document.getElementById('print-font-size-val');

  if (!skipServerLoad && !_renderImpressaoLoaded) {
    // Primeira abertura: restaura selects e carrega do servidor
    const tgtSel = document.getElementById('print-target-select');
    if (tgtSel) tgtSel.value = _printTarget;
    const fmtSel = document.getElementById('print-format-select');
    if (fmtSel) fmtSel.value = _printFormat || '80mm';
    setPrintMode(_printMode);
    loadPrinters();
    _updateUsbStatus();
    loadPrintConfigServer().then(() => {
      _renderImpressaoLoaded = true;
      if (slider) { slider.value = _printFontSize; }
      if (valEl)  { valEl.textContent = _printFontSize; }
      const fmtSel2 = document.getElementById('print-format-select');
      if (fmtSel2) fmtSel2.value = _printFormat || '80mm';
      const cfg = _getPrintConfig();
      const ex = { id:99, client:'João Silva', addr:'Mesa 3', mesa_num:3, pag:'PIX', taxa:0,
        items:[{qty:1,name:'Pizza Calabreza',price:50},{qty:2,name:'Coca Cola 2L',price:14}] };
      p.innerHTML = _buildTicketHtml(ex, cfg);
    });
    return;
  }

  // Chamado via oninput do slider: apenas atualiza preview sem sobrescrever o slider
  const cfg = _getPrintConfig();
  const ex = { id:99, client:'João Silva', addr:'Mesa 3', mesa_num:3, pag:'PIX', taxa:0,
    items:[{qty:1,name:'Pizza Calabreza',price:50},{qty:2,name:'Coca Cola 2L',price:14}] };
  p.innerHTML = _buildTicketHtml(ex, cfg);
}

// Atualiza indicador visual do status USB na tela de config
function _updateUsbStatus() {
  const statusEl = document.getElementById('usb-status');
  const pairedEl = document.getElementById('usb-paired-info');
  const savedUsb = localStorage.getItem('escpos_usb_name');
  if (statusEl) {
    if (!navigator.usb) {
      statusEl.textContent = '⚠️ WebUSB não suportado — use Chrome ou Edge';
      statusEl.style.color = '#f87171';
    } else if (savedUsb) {
      statusEl.textContent = '🖨️ ' + savedUsb;
      statusEl.style.color = '#10b981';
    } else {
      statusEl.textContent = 'Nenhuma impressora pareada';
      statusEl.style.color = 'var(--muted)';
    }
  }
  if (pairedEl) {
    pairedEl.style.display = savedUsb ? 'block' : 'none';
  }
}

// ── Salva config no servidor (sincroniza entre dispositivos) ──
async function salvarConfigImpressao() {
  const cfg = _getPrintConfig()
  const fmt = document.getElementById('print-format-select')?.value || _printFormat || '80mm'
  const payload = {
    printMode:     _printMode,
    printFormat:   fmt,
    printFontSize: cfg.fontSize,
    printNome:     cfg.nome,
    printSub:      cfg.sub,
    printRodape:   cfg.rodape,
  }
  // Salva localmente
  localStorage.setItem('printFormat', fmt)
  _printFormat = fmt

  // Salva no Electron se disponível
  if (window.ElectronPrint) {
    await window.ElectronPrint.savePrintConfig({
      nome:       cfg.nome,
      sub:        cfg.sub,
      rodape:     cfg.rodape,
      fontSize:   cfg.fontSize,
      paperWidth: fmt === '58mm' ? 58 : 80,
    }).catch(() => {})
  }

  // Salva no servidor para sincronizar com outros dispositivos
  try {
    const tid = window._tenantId || null
    if (tid) {
      await window.AppAPI.from('store_config')
        .update({ print_config: JSON.stringify(payload) })
        .eq('tenant_id', tid)
      sbToast('ok', '✅ Configurações salvas e sincronizadas!')
    } else {
      sbToast('ok', '✅ Configurações salvas localmente!')
    }
  } catch {
    sbToast('ok', '✅ Configurações salvas localmente!')
  }
}

async function testPrint() {
  const ex = { id:99, client:'TESTE IMPRESSÃO', addr:'Balcão', mesa_num:null, pag:'PIX', taxa:5,
    items:[{qty:1,name:'X-Salada',price:18},{qty:1,name:'Batata Frita',price:10}] };
  await printOrder(ex);
  sbToast('ok', 'Enviando para impressora...');
}

// ─────────────────────────────────────────

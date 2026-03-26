// FIDELIDADE
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// FIDELIDADE — REAL
// ─────────────────────────────────────────
let _fidConfig = { pts_por_real: 10, meta_pts: 500, recompensa_reais: 10 };

async function loadFidConfig() {
  try {
    const { data } = await sb.from('store_config').select('fid_config').single();
    if (data?.fid_config) _fidConfig = { ..._fidConfig, ...data.fid_config };
  } catch(e) {}
}

async function saveFidConfig() {
  const pts  = parseInt(document.getElementById('fid-cfg-pts')?.value) || 10;
  const meta = parseInt(document.getElementById('fid-cfg-meta')?.value) || 500;
  const rec  = parseFloat(document.getElementById('fid-cfg-rec')?.value) || 10;
  _fidConfig = { pts_por_real: pts, meta_pts: meta, recompensa_reais: rec };
  await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, fid_config: _fidConfig });
  // BUG 3 fix: filtra pelo tenant_id correto para não afetar outros tenants
  await sb.from('fidelidade').update({ max_pts: meta }).eq('tenant_id', _sessao?.tenant_id);
  fidClients.forEach(c => c.max = meta);
  closeModal('modal-fid-config');
  renderFidelidade();
  sbToast('ok', 'Configurações salvas!');
}

function renderFidelidade() {
  const search = (document.getElementById('fid-search')?.value || '').toLowerCase();
  const filtered = fidClients.filter(c => c.name.toLowerCase().includes(search) || (c.phone||'').includes(search));

  // Stats
  const elv = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  const totalPts = fidClients.reduce((s,c)=>s+c.pts,0);
  const resgatados = fidClients.filter(c=>c.resgates>0).length;
  const perto = fidClients.filter(c=>c.pts >= c.max * 0.8 && c.pts < c.max).length;
  elv('fid-stat-total', fidClients.length);
  elv('fid-stat-pts', totalPts.toLocaleString('pt-BR'));
  elv('fid-stat-resgatados', resgatados);
  elv('fid-stat-perto', perto);

  const c = document.getElementById('fid-clients');
  if (!c) return;

  if (!filtered.length) {
    c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px">Nenhum cliente encontrado</div>';
    return;
  }

  c.innerHTML = filtered
    .sort((a,b) => b.pts - a.pts)
    .map(cl => {
      const pct = Math.min(100, (cl.pts / cl.max) * 100);
      const canResgatar = cl.pts >= cl.max;
      const barColor = canResgatar ? 'var(--success)' : pct >= 80 ? 'var(--accent3)' : 'var(--accent)';
      const initials = cl.name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
      return `<div style="background:var(--surface);border:1px solid ${canResgatar?'rgba(34,197,94,.3)':'var(--border)'};border-radius:12px;padding:14px;margin-bottom:10px;display:flex;align-items:center;gap:14px">
        <div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,var(--accent),var(--purple));display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0">${initials}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
            <div style="font-weight:700;font-size:13.5px">${cl.name}</div>
            ${canResgatar ? '<span style="font-size:10px;background:rgba(34,197,94,.15);color:var(--success);padding:1px 6px;border-radius:99px;font-weight:700">🎁 PODE RESGATAR</span>' : ''}
          </div>
          <div style="font-size:11.5px;color:var(--muted);margin-bottom:6px">${cl.phone||'Sem telefone'} · ${cl.orders} pedidos · ${cl.resgates||0} resgates</div>
          <div style="background:var(--surface2);border-radius:99px;height:6px;overflow:hidden;margin-bottom:3px">
            <div style="width:${pct}%;height:100%;background:${barColor};border-radius:99px;transition:width .4s"></div>
          </div>
          <div style="font-size:10.5px;color:var(--muted)">${cl.pts} / ${cl.max} pontos (${pct.toFixed(0)}%) • recompensa: R$ ${_fidConfig.recompensa_reais.toFixed(2).replace('.',',')}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
          <button class="btn bg" style="font-size:11px;padding:4px 10px" onclick="openAddPts(${cl.id},'${cl.name.replace(/'/g,"\'")}',${cl.pts})">+ Pontos</button>
          ${canResgatar ? `<button class="btn bs" style="font-size:11px;padding:4px 10px" onclick="openResgatar(${cl.id},'${cl.name.replace(/'/g,"\'")}',${cl.pts},${cl.max})">🎁 Resgatar</button>` : ''}
          <button class="btn bd" style="font-size:11px;padding:4px 10px" onclick="deleteFidClient(${cl.id},'${cl.name.replace(/'/g,"\'")}')">✕</button>
        </div>
      </div>`;
    }).join('');

  // Preenche config modal com valores atuais
  const cp = document.getElementById('fid-cfg-pts');
  const cm = document.getElementById('fid-cfg-meta');
  const cr = document.getElementById('fid-cfg-rec');
  if (cp) cp.value = _fidConfig.pts_por_real;
  if (cm) cm.value = _fidConfig.meta_pts;
  if (cr) cr.value = _fidConfig.recompensa_reais;
}

function openAddPts(id, name, currentPts) {
  document.getElementById('modal-pts-client-id').value = id;
  document.getElementById('modal-pts-client-name').textContent = name;
  document.getElementById('modal-pts-current').textContent = currentPts + ' pontos atuais';
  document.getElementById('modal-pts-qty').value = '';
  document.getElementById('modal-pts-motivo').value = '';
  openModal('modal-add-pts');
}

async function confirmAddPts() {
  const id    = parseInt(document.getElementById('modal-pts-client-id').value);
  const qty   = parseInt(document.getElementById('modal-pts-qty').value) || 0;
  const motivo= document.getElementById('modal-pts-motivo').value;
  if (!qty || qty < 1) { sbToast('err','Informe os pontos'); return; }
  const cl = fidClients.find(c => c.id === id);
  if (!cl) return;
  const newPts = cl.pts + qty;
  const { error } = await sb.from('fidelidade').update({ pts: newPts }).eq('id', id);
  if (error) { sbToast('err','Erro ao adicionar pontos'); return; }
  cl.pts = newPts;
  closeModal('modal-add-pts');
  renderFidelidade();
  sbToast('ok', `+${qty} pontos para ${cl.name}!`);
  if (newPts >= cl.max) sbToast('ok', `${cl.name} pode resgatar a recompensa!`);
}

function openResgatar(id, name, pts, max) {
  document.getElementById('modal-resg-id').value = id;
  document.getElementById('modal-resg-name').textContent = name;
  document.getElementById('modal-resg-valor').textContent = 'R$ ' + _fidConfig.recompensa_reais.toFixed(2).replace('.',',') + ' de desconto';
  document.getElementById('modal-resg-pts').textContent = pts + ' pontos serão zerados';
  openModal('modal-resgatar');
}

async function confirmResgatar() {
  const id = parseInt(document.getElementById('modal-resg-id').value);
  const cl = fidClients.find(c => c.id === id);
  if (!cl) return;
  const { error } = await sb.from('fidelidade').update({ pts: 0, resgates: (cl.resgates||0)+1 }).eq('id', id);
  if (error) { sbToast('err','Erro ao resgatar'); return; }
  cl.pts = 0;
  cl.resgates = (cl.resgates||0)+1;
  closeModal('modal-resgatar');
  renderFidelidade();
  sbToast('ok', `Recompensa resgatada para ${cl.name}!`);
}

async function addFidClient() {
  const name  = document.getElementById('fid-add-name').value.trim();
  const phone = document.getElementById('fid-add-phone').value.trim();
  if (!name) { sbToast('err','Informe o nome'); return; }
  const { data, error } = await sb.from('fidelidade').insert({
    name, phone, pts: 0, max_pts: _fidConfig.meta_pts, orders_count: 0, resgates: 0
  }).select().single();
  if (error) { sbToast('err','Erro ao cadastrar'); return; }
  fidClients.unshift({ id:data.id, name:data.name, phone:data.phone, pts:0, max:_fidConfig.meta_pts, orders:0, resgates:0 });
  closeModal('modal-add-fid-client');
  document.getElementById('fid-add-name').value = '';
  document.getElementById('fid-add-phone').value = '';
  renderFidelidade();
  sbToast('ok', `${name} cadastrado no programa!`);
}

async function deleteFidClient(id, name) {
  if (!confirm(`Remover ${name} do programa de fidelidade?`)) return;
  const { error } = await sb.from('fidelidade').delete().eq('id', id);
  if (error) { sbToast('err','Erro ao remover'); return; }
  fidClients = fidClients.filter(c => c.id !== id);
  renderFidelidade();
  sbToast('ok', `${name} removido do programa`);
}

// Chamado ao confirmar pagamento — adiciona pontos automaticamente se cliente estiver no programa
async function _autoAddFidPoints(clientPhone, totalVal) {
  if (!clientPhone || !totalVal) return;
  const cl = fidClients.find(c => c.phone && c.phone.replace(/\D/g,'') === clientPhone.replace(/\D/g,''));
  if (!cl) return;
  const pts = Math.floor(totalVal * _fidConfig.pts_por_real);
  if (pts < 1) return;
  const newPts = cl.pts + pts;
  await sb.from('fidelidade').update({ pts: newPts, orders_count: cl.orders+1 }).eq('id', cl.id);
  cl.pts = newPts; cl.orders++;
  sbToast('ok', `+${pts} pontos fidelidade para ${cl.name}`);
  if (newPts >= cl.max) sbToast('ok', `${cl.name} atingiu a recompensa!`);
}


// ─────────────────────────────────────────
// GARÇOM
// ─────────────────────────────────────────
function renderGarcom(){
  const g=document.getElementById('garcom-grid');
  if(!g) return;
  g.innerHTML=tables.map(t=>{
    const sc=t.status==='free'?'qr-free':'qr-busy';
    const bg=t.status==='free'?'rgba(34,197,94,.08)':'rgba(239,68,68,.08)';
    return`<div class="garcom-mesa" style="background:${bg}" onclick="openGarcomMesa(${t.num})">
      <div class="gm-num">Mesa ${t.num}</div>
      <div class="gm-guests">${t.guests?t.guests+' pessoas':''}</div>
      <div class="gm-status ${sc}">${t.status==='free'?'Livre':'Ocupada'}</div>
      ${t.total&&t.status==='busy'?`<div style="font-size:12px;font-weight:700;color:var(--success);margin-top:5px">${t.total}</div>`:''}
      <button class="btn bp" style="width:100%;justify-content:center;font-size:11.5px;margin-top:9px;padding:5px">➕ Lançar pedido</button>
    </div>`;
  }).join('');
}

function openGarcomMesa(num){
  garcomMesa=num;garcomCart=[];
  document.getElementById('garcom-mesa-num').textContent=num;
  const gg=document.getElementById('garcom-item-grid');
  gg.innerHTML=items.filter(i=>i.status==='active').map(i=>`
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:9px;text-align:center;cursor:pointer;transition:all .15s" onclick="garcomAddItem(${i.id},this)" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="if(!this.dataset.sel)this.style.borderColor='var(--border)'">
      <div style="font-size:22px">${i.emoji}</div>
      <div style="font-size:11px;font-weight:600;margin-top:3px">${i.name}</div>
      <div style="font-size:10.5px;color:var(--accent)">R$ ${i.price.toFixed(2).replace('.',',')}</div>
    </div>`).join('');
  document.getElementById('garcom-cart-preview').textContent='Nenhum item selecionado';
  openModal('modal-garcom-mesa');
}

function garcomAddItem(id,el){
  const it=items.find(i=>i.id===id);
  const ci=garcomCart.find(c=>c.id===id);
  if(ci) ci.qty++;else garcomCart.push({...it,qty:1});
  el.style.borderColor='var(--accent)';el.dataset.sel='1';el.style.background='rgba(59,130,246,.1)';
  const prev=document.getElementById('garcom-cart-preview');
  prev.innerHTML=garcomCart.map(c=>`${c.qty}x ${c.name}`).join(' • ')
    +`<br><strong style="color:var(--success)">Total: R$ ${garcomCart.reduce((s,c)=>s+c.price*c.qty,0).toFixed(2).replace('.',',')}</strong>`;
}

async function submitGarcomOrder(){
  if(garcomCart.length===0){sbToast('err','Selecione itens');return;}
  const tot=garcomCart.reduce((s,c)=>s+c.price*c.qty,0);
  const t=tables.find(x=>x.num===garcomMesa);
  const itemsArr=garcomCart.map(c=>({qty:c.qty,name:c.name,price:c.price,obs:''}));
  const time=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  sbLoading(true);
  try {
    // Verifica e grava opened_at ANTES de inserir o pedido
    const _mesaBeforeInsert = tables.find(t => t.num === garcomMesa);
    if (_mesaBeforeInsert && _mesaBeforeInsert.status !== 'busy') {
      const _ot = new Date().toISOString();
      await sb.from('mesas').update({ status:'busy', opened_at: _ot, updated_at: _ot }).eq('num', garcomMesa);
      _mesaBeforeInsert.status = 'busy'; _mesaBeforeInsert.opened_at = _ot; _mesaBeforeInsert.updated_at = _ot;
    }
    const { data: orderData, error: oErr } = await sb.from('orders').insert({
      client:`Mesa ${garcomMesa}`, phone:'', addr:`Mesa ${garcomMesa}`,
      mesa_num: garcomMesa, items:itemsArr, total:tot, taxa:0,
      status: mesaAutoAccept ? 'producao' : 'analise', time, pag:'Mesa'
    }).select().single();
    if(oErr) throw oErr;
    // opened_at já tratado antes do insert
    if(t){t.status='busy'; t.guests=t.guests||2;}
    ordersKanban.push(mapOrder(orderData));
    closeModal('modal-garcom-mesa');
    renderGarcom();
    renderMesasPage();
    playOrderSound();
    sbToast('ok',`Pedido Mesa ${garcomMesa} enviado para cozinha!`);
  } catch(e){
    sbToast('err','Erro ao enviar pedido');
    console.error(e);
  } finally { sbLoading(false); }
}

// ─────────────────────────────────────────
// KDS
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// KDS COMPLETO
// ─────────────────────────────────────────
let kdsFilter  = 'todos';
let kdsTimers  = {}; // id → { startTs, extra }
let _kdsInterval = null;
let _kdsFullscreen = false;

function kdsSetFilter(f) {
  kdsFilter = f;
  ['todos','mesa','delivery','balcao'].forEach(k => {
    const el = document.getElementById('kds-f-'+k);
    if (el) el.classList.toggle('on', k === f);
  });
  renderKDS();
}

function kdsToggleFullscreen() {
  const inner = document.getElementById('kds-inner');
  if (!inner) return;
  _kdsFullscreen = !_kdsFullscreen;
  if (_kdsFullscreen) {
    inner.classList.add('kds-fullscreen');
    document.body.style.overflow = 'hidden';
  } else {
    inner.classList.remove('kds-fullscreen');
    document.body.style.overflow = '';
  }
}

function _kdsOrderType(o) {
  const addr = (o.addr || '').toLowerCase();
  if (o.mesa_num || addr.includes('mesa')) return 'mesa';
  if (addr.includes('balcão') || addr.includes('balcao') || addr.includes('pdv')) return 'balcao';
  return 'delivery';
}

function _kdsElapsed(o) {
  const t = kdsTimers[o.id];
  const extra = t?.extra || 0;
  const startMs = t?.startTs || Date.now();
  return Math.floor((Date.now() - startMs) / 1000) + extra;
}

function _kdsFormatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function kdsAddTime(id, extra = 300) {
  if (!kdsTimers[id]) kdsTimers[id] = { startTs: Date.now(), extra: 0 };
  kdsTimers[id].extra -= extra; // subtrai para "ganhar" mais tempo
  renderKDS();
}

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
    const typeLabel = type === 'mesa' ? `🍽️ ${o.addr||('Mesa '+(o.mesa_num||''))}` : type === 'balcao' ? '🏠 Balcão' : '🛵 Delivery';
    const typeCls   = 'kds-type-'+type;
    const items = Array.isArray(o.items) ? o.items : [];

    const itemsHtml = items.map(i => {
      const isDrink = !!i.drink;
      return `<div class="kds-item2">
        <span class="kds-item2-qty">${i.qty}×</span>
        <div>
          <div class="kds-item2-name ${isDrink ? 'kds-item2-drink' : ''}">${isDrink ? '🥤 ' : ''}${i.name.toUpperCase()}</div>
          ${i.obs ? `<div class="kds-item2-obs">⚠️ ${i.obs}</div>` : ''}
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

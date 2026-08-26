// CAIXA
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// CAIXA — abrir / fechar
// ─────────────────────────────────────────
let _caixaAberto = true;

function setCaixaState(aberto) {
  _caixaAberto = aberto;
  const btn = document.getElementById('caixa-btn');
  const txt = document.getElementById('caixa-btn-txt');
  if (!btn || !txt) return;
  if (aberto) {
    btn.classList.remove('fechado');
    txt.textContent = 'Caixa aberto';
  } else {
    btn.classList.add('fechado');
    txt.textContent = 'Caixa fechado';
  }
}

async function toggleCaixa() {
  if (typeof financeIsUnlocked === 'function' && !financeIsUnlocked()) {
    if (typeof financeOpenUnlockModal === 'function') financeOpenUnlockModal(() => toggleCaixa());
    return;
  }
  if (_caixaAberto) await fecharCaixa();
  else await abrirCaixa();
}

function abrirCaixa() {
  // Exibe modal para informar fundo de caixa
  let modal = document.getElementById('modal-abrir-caixa');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-abrir-caixa';
    modal.innerHTML = `
      <div class="modal-bg" onclick="document.getElementById('modal-abrir-caixa').style.display='none'" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center">
        <div class="modal" onclick="event.stopPropagation()" style="width:100%;max-width:360px;padding:28px 24px;border-radius:16px;background:var(--surface);border:1px solid var(--border);box-shadow:0 16px 48px rgba(0,0,0,.2)">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
            <div style="width:36px;height:36px;border-radius:10px;background:rgba(34,197,94,.12);display:flex;align-items:center;justify-content:center;font-size:18px">💵</div>
            <div>
              <div style="font-size:15px;font-weight:700">Abrir Caixa</div>
              <div style="font-size:12px;color:var(--muted)">Informe o fundo inicial em dinheiro</div>
            </div>
          </div>
          <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:6px">Valor em dinheiro (R$)</label>
          <input id="cx-fundo-inicial" type="number" min="0" step="0.01" placeholder="0,00"
            style="width:100%;padding:10px 14px;border-radius:9px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:16px;font-weight:600;box-sizing:border-box;outline:none"
            onkeydown="if(event.key==='Enter') _confirmarAbrirCaixa()"
            onfocus="this.select()" />
          <div style="display:flex;gap:10px;margin-top:18px">
            <button class="btn bg" onclick="document.getElementById('modal-abrir-caixa').style.display='none'"
              style="flex:1;padding:10px">Cancelar</button>
            <button class="btn bp" onclick="_confirmarAbrirCaixa()"
              style="flex:2;padding:10px;font-weight:700">Abrir Caixa</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  const input = document.getElementById('cx-fundo-inicial');
  if (input) { input.value = ''; }
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('cx-fundo-inicial')?.focus(), 80);
}

async function _confirmarAbrirCaixa() {
  const fundo = parseFloat(document.getElementById('cx-fundo-inicial')?.value) || 0;
  document.getElementById('modal-abrir-caixa').style.display = 'none';
  setCaixaState(true);
  const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  // Registra fundo inicial como entrada se valor > 0
  if (fundo > 0) {
    try {
      const { data, error } = await sb.from('movimentos').insert({
        description: 'Fundo de caixa', tipo: 'entrada', val: fundo, pag: 'Dinheiro', time
      }).select().single();
      if (!error && data) movimentos.push({ id: data.id, desc: 'Fundo de caixa', tipo: 'entrada', val: fundo, pag: 'Dinheiro', time });
    } catch(e) { console.warn('fundo caixa:', e); }
  }
  sbToast('ok', fundo > 0 ? `Caixa aberto com R$ ${fundo.toFixed(2).replace('.', ',')}` : 'Caixa aberto!');
  try { await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, caixa_open: true }); }
  catch(e) { console.warn('caixa sync:', e); }
  _renderCaixaTela();
}

async function fecharCaixa() {
  if (!confirm('Fechar o caixa agora?\n\nIsso registrará o fechamento mas não apaga os movimentos do dia.')) return;
  setCaixaState(false);
  const time = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  sbToast('ok', 'Caixa fechado às ' + time);
  try { await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, caixa_open: false }); }
  catch(e) { console.warn('caixa sync:', e); }
  _renderCaixaTela();
}

function _renderCaixaTela() {
  const tFechado = document.getElementById('cx-tela-fechado');
  const tAberto  = document.getElementById('cx-tela-aberto');
  if (!tFechado || !tAberto) return;
  tFechado.style.display = _caixaAberto ? 'none' : 'flex';
  tAberto.style.display  = _caixaAberto ? ''     : 'none';
  if (_caixaAberto) renderCaixa();
}



function renderCaixa() {
  const entradas=movimentos.filter(m=>m.tipo==='entrada').reduce((s,m)=>s+m.val,0);
  const saidas=movimentos.filter(m=>m.tipo==='saida').reduce((s,m)=>s+m.val,0);
  const saldo=entradas-saidas;
  document.getElementById('cx-saldo').textContent='R$'+saldo.toFixed(2).replace('.',',');
  document.getElementById('cx-entradas').textContent='R$'+entradas.toFixed(2).replace('.',',');
  document.getElementById('cx-saidas').textContent='R$'+saidas.toFixed(2).replace('.',',');
  document.getElementById('cx-movs').textContent=movimentos.length;
  document.getElementById('cx-list').innerHTML=movimentos.slice().reverse().map(m=>`
    <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:9px">
      <div style="width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;background:${m.tipo==='entrada'?'rgba(34,197,94,.12)':'rgba(239,68,68,.12)'}">
        ${m.tipo==='entrada'?'<svg width=&quot;14&quot; height=&quot;14&quot; viewBox=&quot;0 0 16 16&quot; fill=&quot;none&quot; style=&quot;display:inline-block;vertical-align:middle;flex-shrink:0&quot; xmlns=&quot;http://www.w3.org/2000/svg&quot;><path d=&quot;M8 13V3M3 8l5-5 5 5&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;1.4&quot; fill=&quot;none&quot; stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot;/></svg>':'<svg width=&quot;14&quot; height=&quot;14&quot; viewBox=&quot;0 0 16 16&quot; fill=&quot;none&quot; style=&quot;display:inline-block;vertical-align:middle;flex-shrink:0&quot; xmlns=&quot;http://www.w3.org/2000/svg&quot;><path d=&quot;M8 3v10M3 8l5 5 5-5&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;1.4&quot; fill=&quot;none&quot; stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot;/></svg>'}
      </div>
      <div style="flex:1"><div style="font-size:12.5px;font-weight:600">${m.desc}</div><div style="font-size:11px;color:var(--muted)">${m.pag} • ${m.time}</div></div>
      <div style="font-size:13.5px;font-weight:700;color:${m.tipo==='entrada'?'var(--success)':'var(--danger)'}">${m.tipo==='entrada'?'+':'-'}R$${m.val.toFixed(2).replace('.',',')}</div>
    </div>`).join('');
  const pags={};
  movimentos.filter(m=>m.tipo==='entrada').forEach(m=>{pags[m.pag]=(pags[m.pag]||0)+m.val;});
  document.getElementById('cx-pagamentos').innerHTML=Object.entries(pags).map(([p,v])=>`<div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)"><span style="color:var(--muted)">${p}</span><span style="font-weight:600">R$${v.toFixed(2).replace('.',',')}</span></div>`).join('');
}

async function addMovimento() {
  const desc = document.getElementById('cx-quick-desc').value || 'Movimento';
  const val  = parseFloat(document.getElementById('cx-quick-val').value) || 0;
  const tipo = document.querySelector('input[name="cx-tipo"]:checked').value;
  const time = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  const { data, error } = await sb.from('movimentos').insert({
    description: desc, tipo, val, pag: 'Dinheiro', time
  }).select().single();
  if (error) { sbToast('err','Erro ao registrar'); return; }
  movimentos.push({ id:data.id, desc, tipo, val, pag:'Dinheiro', time });
  document.getElementById('cx-quick-desc').value = '';
  document.getElementById('cx-quick-val').value  = '';
  renderCaixa();
  sbToast('ok','Movimento registrado!');
}

async function addMovimentoModal() {
  const desc = document.getElementById('mov-desc').value || 'Movimento';
  const val  = parseFloat(document.getElementById('mov-val').value) || 0;
  const tipo = document.getElementById('mov-tipo').value;
  const pag  = document.getElementById('mov-pag').value;
  const time = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  const { data, error } = await sb.from('movimentos').insert({
    description: desc, tipo, val, pag, time
  }).select().single();
  if (error) { sbToast('err','Erro ao registrar'); return; }
  movimentos.push({ id:data.id, desc, tipo, val, pag, time });
  closeModal('modal-mov');
  renderCaixa();
  sbToast('ok','Movimento registrado!');
}

function updateCxLabel(){
  const tipo=document.querySelector('input[name="cx-tipo"]:checked').value;
  document.getElementById('lbl-entrada').style.borderColor=tipo==='entrada'?'var(--success)':'var(--border)';
  document.getElementById('lbl-saida').style.borderColor=tipo==='saida'?'var(--danger)':'var(--border)';
}

// ─────────────────────────────────────────
// PIZZA SELECTOR — PDV (slot-based, sem bugs)
// ─────────────────────────────────────────
let pdvPz = { item: null, slices: 1, selected: [], activeSlot: -1 };

function openPDVPizza(itemId) {
  const it = items.find(i => i.id === itemId);
  if (!it) return;
  if (!window._pdvPizzaSource) window._pdvPizzaSource = 'pdv';
  pdvPz = { item: it, slices: 1, selected: [null], activeSlot: -1 };
  document.getElementById('pdv-pz-name').textContent = it.name;
  document.querySelectorAll('#pdv-pz-size-tabs .pz-size-tab').forEach((b,i) => b.classList.toggle('on', i===0));
  document.getElementById('pdv-pz-picker-wrap').style.display = 'none';
  document.getElementById('pdv-pizza-modal-bg').classList.add('on');
  pdvRenderSlots();
  pdvUpdateConfirm();
}

function closePDVPizza() {
  document.getElementById('pdv-pizza-modal-bg').classList.remove('on');
}

function pdvSetSlices(n, el) {
  document.querySelectorAll('#pdv-pz-size-tabs .pz-size-tab').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  pdvPz.slices = n;
  while (pdvPz.selected.length < n) pdvPz.selected.push(null);
  pdvPz.selected = pdvPz.selected.slice(0, n);
  pdvPz.activeSlot = -1;
  document.getElementById('pdv-pz-picker-wrap').style.display = 'none';
  pdvRenderSlots();
  pdvUpdateConfirm();
}

function pdvRenderSlots() {
  const labels = ['Inteira','½ do sabor','⅓ do sabor','¼ do sabor'];
  const label  = labels[pdvPz.slices - 1] || '¼ do sabor';
  const container = document.getElementById('pdv-pz-slots');
  container.innerHTML = pdvPz.selected.map((fl, i) => {
    const isActive = pdvPz.activeSlot === i;
    const isFilled = fl !== null;
    const imgHtml = fl && fl.imageUrl
      ? `<div class="pz-slot-img"><img src="${fl.imageUrl}" alt="${fl.name}"></div>`
      : `<div class="pz-slot-img" style="font-size:22px">${isFilled ? '🍕' : '＋'}</div>`;
    return `<div class="pz-slot${isActive?' active':''}${isFilled?' filled':''}" onclick="pdvOpenSlot(${i})">
      <div class="pz-slot-num">${i+1}</div>
      ${imgHtml}
      <div class="pz-slot-info">
        <div class="pz-slot-name">${fl ? fl.name : 'Toque para escolher o sabor'}</div>
        <div class="pz-slot-hint">${isFilled ? (label+' · R$ '+fl.price.toFixed(2).replace('.',',')) : 'Slot '+(i+1)+' vazio'}</div>
      </div>
      ${isFilled ? `<button class="pz-slot-remove" onclick="event.stopPropagation();pdvRemoveSlot(${i})">✕</button>` : ''}
    </div>`;
  }).join('');
}

function pdvOpenSlot(idx) {
  pdvPz.activeSlot = idx;
  pdvRenderSlots();
  const pizzas = items.filter(i => i.itemType === 'pizza' && i.status !== 'esgotado');
  const names = ['1º sabor','2º sabor','3º sabor','4º sabor'];
  document.getElementById('pdv-pz-picker-title').textContent = 'ESCOLHA O ' + (names[idx]||'SABOR').toUpperCase();
  document.getElementById('pdv-pz-picker-wrap').style.display = '';
  document.getElementById('pdv-pz-flavor-list').innerHTML = pizzas.length
    ? pizzas.map(f => {
        const isOn = pdvPz.selected[idx]?.id === f.id;
        const thumb = f.imageUrl
          ? `<img src="${f.imageUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:7px">`
          : `<span style="font-size:18px">${f.emoji||'🍕'}</span>`;
        const check = isOn
          ? `<div style="width:20px;height:20px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;flex-shrink:0">✓</div>`
          : `<div style="width:20px;height:20px;border-radius:50%;border:2px solid var(--border);flex-shrink:0"></div>`;
        return `<button onclick="pdvSelectFlavor(${f.id})" style="display:flex;align-items:center;gap:11px;padding:10px 13px;background:${isOn?'rgba(249,115,22,.12)':'none'};border:none;border-bottom:1px solid var(--border);cursor:pointer;width:100%;text-align:left;transition:background .15s;" onmouseover="if(!${isOn})this.style.background='rgba(255,255,255,.04)'" onmouseout="if(!${isOn})this.style.background='none'">
          <div style="width:42px;height:42px;border-radius:8px;background:var(--surface2);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">${thumb}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)">${f.name}</div>
            <div style="font-size:12px;color:var(--amber);margin-top:1px">R$ ${f.price.toFixed(2).replace('.',',')}</div>
          </div>
          ${check}
        </button>`;
      }).join('')
    : '<div style="color:var(--muted);font-size:12px;padding:14px;text-align:center">Nenhum item do tipo Pizza cadastrado.<br>Gestor de Cardápio → edite um item → Tipo = Pizza.</div>';
}

function pdvSelectFlavor(fid) {
  const fl = items.find(i => i.id === fid);
  if (!fl || pdvPz.activeSlot < 0) return;
  pdvPz.selected[pdvPz.activeSlot] = fl;
  const nextEmpty = pdvPz.selected.findIndex((s, i) => i > pdvPz.activeSlot && s === null);
  pdvRenderSlots();
  pdvUpdateConfirm();
  if (nextEmpty !== -1) setTimeout(() => pdvOpenSlot(nextEmpty), 220);
  else pdvOpenSlot(pdvPz.activeSlot);
}

function pdvRemoveSlot(idx) {
  pdvPz.selected[idx] = null;
  pdvPz.activeSlot = idx;
  pdvRenderSlots();
  pdvUpdateConfirm();
  pdvOpenSlot(idx);
}

function pdvUpdateConfirm() {
  const filled    = pdvPz.selected.filter(Boolean);
  const allFilled = pdvPz.selected.every(Boolean) && pdvPz.selected.length > 0;
  document.getElementById('pdv-pz-confirm').disabled = !allFilled;
  const maxP = filled.length ? Math.max(...filled.map(f => f.price)) : 0;
  document.getElementById('pdv-pz-total').textContent = 'R$ ' + maxP.toFixed(2).replace('.',',');
}

function pdvConfirmPizza() {
  if (!pdvPz.selected.every(Boolean)) return;
  const maxP  = Math.max(...pdvPz.selected.map(f => f.price));
  const names = pdvPz.selected.map(f => f.name).join(' + ');
  const pizzaItem = { id: Date.now(), name: '🍕 '+names, price: maxP, qty: 1, emoji: '🍕', _isPizza: true, obs: '' };
  if (window._pdvPizzaSource === 'balcao') {
    pdvbCart.push(pizzaItem);
    pdvbRenderOrder();
  } else if (window._pdvPizzaSource === 'garcom') {
    garcomCart.push(pizzaItem);
    if (typeof _garcomUpdatePreview === 'function') _garcomUpdatePreview();
  } else {
    cartItems.push(pizzaItem);
    renderCart();
  }
  window._pdvPizzaSource = null;
  showToast('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M3 8l3.5 3.5L13 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>', 'Pizza adicionada!');
  closePDVPizza();
}

function filterPDV(){renderPDV();}

// ─────────────────────────────────────────
// EMOJI GRID
// ─────────────────────────────────────────
function buildEmojiGrid(){
  const g=document.getElementById('emoji-grid');
  if(!g) return;
  g.innerHTML=EMOJIS_PLAIN.map(e=>`<div class="emo-btn" onclick="selEmoji(this,'add')">${e}</div>`).join('');
}

function selEmoji(el, ctx){
  // Only deselect emojis in the same grid context
  const grid = el.closest('.emoji-grid');
  if (grid) grid.querySelectorAll('.emo-btn').forEach(b=>b.classList.remove('on'));
  el.classList.add('on');
}

// Open add-item modal and populate category select
function openAddItemModal(catKeyDefault) {
  console.log('[ADD-ITEM-MODAL] abrindo | catKeyDefault:', catKeyDefault, '| categorias disponíveis:', categories.length);
  populateCatSelects();
  if (catKeyDefault) {
    const sel = document.getElementById('new-cat');
    if (sel) sel.value = catKeyDefault;
  }
  // Reset form fields
  ['new-name','new-desc','new-ingredients','new-price','new-price-old'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  const nt = document.getElementById('new-item-type'); if(nt) nt.value='normal';
  const ns = document.getElementById('new-status'); if(ns) ns.value='active';
  // Reset image preview
  const t = document.getElementById('new-img-thumb'); if(t){ t.src=''; t.style.display='none'; }
  const p2 = document.getElementById('new-img-placeholder'); if(p2) p2.style.display='flex';
  const c2 = document.getElementById('new-img-change'); if(c2) c2.style.display='none';
  const pr = document.getElementById('new-img-preview'); if(pr) pr.style.border='2px dashed var(--border)';
  // Reset destaque and grupos
  const nd = document.getElementById('new-destaque'); if(nd) nd.classList.remove('on');
  const ngl = document.getElementById('new-grupos-list'); if(ngl) ngl.innerHTML='';
  // Reset emoji grid (guarded)
  try { document.querySelectorAll('#emoji-grid .emo-btn').forEach(b=>b.classList.remove('on')); } catch(e){}
  togglePizzaOptions('new');
  _newItemImageFile = null;
  _newItemImageUrl  = null;
  openModal('modal-add-item');
  loadImgGallery('new');
}

// ─────────────────────────────────────────
// NOTIFICAÇÕES
// ─────────────────────────────────────────
function toggleNotif(){document.getElementById('notif-panel').classList.toggle('on');}
function closeNotif(){document.getElementById('notif-panel').classList.remove('on');}
function clearNotifs(){
  document.getElementById('notif-panel').querySelectorAll('.notif-item').forEach(n=>n.remove());
  const nc=document.getElementById('notif-count');
  nc.textContent='0';nc.style.display='none';
  closeNotif();showToast('<svg width=\'14\' height=\'14\' viewBox=\'0 0 16 16\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'><circle cx=&quot;8&quot; cy=&quot;8&quot; r=&quot;6&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;1.4&quot; fill=&quot;none&quot; stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot;/><path d=&quot;M5.5 8l2 2 3-3&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;1.4&quot; fill=&quot;none&quot; stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot;/></svg>','Notificações limpas');
}

// ─────────────────────────────────────────
// MODAL
// ─────────────────────────────────────────
function openModal(id){
  const el = document.getElementById(id);
  if (!el) { console.error('[MODAL] elemento não encontrado:', id); return; }
  // Teleporta para o body para evitar que overflow:hidden do .main quebre position:fixed
  if (el.parentElement !== document.body) {
    el._originalParent = el.parentElement;
    el._originalNextSibling = el.nextSibling;
    document.body.appendChild(el);
  }
  el.classList.add('on');
  console.log('[MODAL] aberto:', id, '| rect:', JSON.stringify(el.getBoundingClientRect()));
  closeNotif();
}
function closeModal(id){
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('on');
  // Devolve ao lugar original no DOM
  if (el._originalParent) {
    if (el._originalNextSibling) {
      el._originalParent.insertBefore(el, el._originalNextSibling);
    } else {
      el._originalParent.appendChild(el);
    }
    el._originalParent = null;
    el._originalNextSibling = null;
  }
}
document.querySelectorAll('.modal-bg').forEach(m=>{
  m.addEventListener('click',e=>{if(e.target===m) closeModal(m.id);});
});

// Verifica CSS do modal no carregamento
(function _checkModalCSS() {
  const dummy = document.createElement('div');
  dummy.className = 'modal-bg on';
  dummy.style.cssText = 'position:absolute;left:-9999px;top:-9999px';
  document.body.appendChild(dummy);
  const cs = window.getComputedStyle(dummy);
  console.log('[CSS-CHECK] .modal-bg.on → display:', cs.display, '| z-index:', cs.zIndex, '| position:', cs.position);
  if (cs.display === 'none') {
    console.error('[CSS-CHECK] ⚠️ CSS do modal NÃO carregado corretamente!');
  } else {
    console.log('[CSS-CHECK] ✅ CSS do modal OK');
  }
  document.body.removeChild(dummy);
})();

// ─────────────────────────────────────────
// STATUS & SOUND
// ─────────────────────────────────────────
// sidebar state saved in store_config.sidebar_state (jsonb)
let _sidebarState = {};

async function loadSidebarState() {
  try {
    const { data } = await sb.from('store_config').select('sidebar_state').single();
    _sidebarState = (data && data.sidebar_state) ? data.sidebar_state : {};
  } catch(e) { _sidebarState = {}; }
  ['sg-dia','sg-cardapio','sg-venda','sg-gestao'].forEach(id => {
    if (_sidebarState[id]) {
      const group = document.getElementById(id);
      const headId = 'sh-' + id.replace('sg-','');
      const head   = document.getElementById(headId);
      if (group) group.classList.add('collapsed');
      if (head)  head.classList.add('collapsed');
    }
  });
}

async function saveSidebarState() {
  try {
    await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, sidebar_state: _sidebarState });
  } catch(e) { console.warn('sidebar state save:', e); }
}

function toggleSideGroup(id) {
  const group  = document.getElementById(id);
  const headId = 'sh-' + id.replace('sg-','');
  const head   = document.getElementById(headId);
  if (!group) return;
  const collapsed = group.classList.toggle('collapsed');
  if (head) head.classList.toggle('collapsed', collapsed);
  _sidebarState[id] = collapsed;
  saveSidebarState();
}

// ═══════════════════════════════════════
// PDV BALCÃO COMPLETO
// ═══════════════════════════════════════
let pdvbCart=[],pdvbActiveCat='__todos__',pdvbActiveTab='d',pdvbFilter='todos';
let pdvbEntregaTipo='balcao',pdvbEntregaTaxa=0,pdvbEntregaAddr='',pdvbMesaNum=null;
let pdvbPagamento='Dinheiro',pdvbDesconto=0,pdvbFocusIdx=-1,pdvbObsIdx=-1;
let pdvbMesaSubtab='mesas',pdvbMesaSelecionada=null;

function renderPDVBalcao(){
  pdvbRenderCats();pdvbRenderGrid();pdvbRenderOrder();pdvbSetupKeyboard();
  // Inicializa autocomplete de clientes no PDV Balcão
  initClienteAutocomplete('pdvb-client', {
    nameId: 'pdvb-client',
    phoneId: 'pdvb-phone'
  });
  initClienteAutocomplete('pdvb-phone', {
    nameId: 'pdvb-client',
    phoneId: 'pdvb-phone'
  });
}

function pdvbRenderCats(){
  const el=document.getElementById('pdvb-cats');if(!el)return;
  const cats=['Todos',...new Set(items.filter(i=>i.status==='active').map(i=>i.cat).filter(Boolean))];
  el.innerHTML=cats.map(c=>{const k=c==='Todos'?'__todos__':c;return`<div class="pdvb-cat${pdvbActiveCat===k?' on':''}" onclick="pdvbSelectCat('${k}')">${c}</div>`;}).join('<span style="color:var(--border);font-size:14px;align-self:center">|</span>');
}
function pdvbSelectCat(k){pdvbActiveCat=k;pdvbFocusIdx=-1;pdvbRenderGrid();}
function pdvbGetFilteredItems(){
  const q=(document.getElementById('pdvb-search')||{}).value||'';
  return items.filter(i=>{
    if(i.status!=='active')return false;
    if(pdvbActiveCat!=='__todos__'&&i.cat!==pdvbActiveCat)return false;
    if(pdvbFilter==='promo'&&!i.promo)return false;
    if(pdvbFilter==='pizza'&&i.itemType!=='pizza')return false;
    if(q&&!i.name.toLowerCase().includes(q.toLowerCase()))return false;
    return true;
  });
}
function pdvbRenderGrid(){
  const g=document.getElementById('pdvb-grid');if(!g)return;
  const fil=pdvbGetFilteredItems();
  if(!fil.length){g.innerHTML='<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px;font-size:13px;opacity:.7">Nenhum item encontrado</div>';return;}
  g.innerHTML=fil.map((i,idx)=>`
    <div class="pdvb-item${pdvbFocusIdx===idx?' focused':''}" onclick="pdvbAddItem(${i.id})" id="pdvbi-${idx}">
      <div class="pdvb-item-img">${i.imageUrl?`<img src="${i.imageUrl}" style="width:100%;height:100%;object-fit:cover">`:(i.emoji||'🍽️')}</div>
      <div class="pdvb-item-info">
        <div class="pdvb-item-name">${i.name}</div>
        <div class="pdvb-item-price">R$ ${i.price.toFixed(2).replace('.',',')}${i.promo?'<span style="font-size:9px;background:rgba(34,197,94,.12);color:var(--success);border-radius:3px;padding:1px 4px;margin-left:4px;font-weight:700">PROMO</span>':''}</div>
      </div>
    </div>`).join('');
  pdvbRenderCats();
}
function pdvbAddItem(id){
  const it=items.find(i=>i.id===id);if(!it)return;
  if(it.itemType==='pizza'){window._pdvPizzaSource='balcao';openPDVPizza(id);return;}

  // Verifica grupos de adicionais (açougue, açaí, etc.)
  const grupos = (()=>{ try{ return Array.isArray(it.customGroups)?it.customGroups:JSON.parse(it.customGroups||'[]') }catch{ return [] } })()
    .filter(g => !['porcao_ref','kit_itens'].includes(g.tipo));
  const isKg = it.itemType === 'kg' || it.item_type === 'kg';

  if (grupos.length > 0 || isKg) {
    _pdvbAbrirModalItem(it, grupos, isKg);
    return;
  }
  const ci=pdvbCart.find(c=>c.id===id&&!c.obs);
  if(ci)ci.qty++;else pdvbCart.push({...it,qty:1,obs:''});
  pdvbRenderOrder();sbToast('ok',`${it.name} adicionado!`);
}

// ── Modal de adicionais para PDV Balcão ──────────────
function _pdvbAbrirModalItem(it, grupos, isKg) {
  document.getElementById('pdvb-modal-item-bg')?.remove();
  const priceStr = parseFloat(it.price||0).toFixed(2).replace('.',',');

  const _TIPO_LABEL = {
    cortes:'Corte', preparos:'Preparo', ocasiao:'Ocasião',
    armazenamento:'Armazenamento', pesos:'Porção / Peso',
    checklist:'Complementos', radio:'Escolha', checkbox:'Adicional',
    opcional:'Adicional', adicionais:'Adicional',
    obrigatorio:'Escolha obrigatória', sabor:'Sabor',
  };

  const gruposHtml = grupos.map((g, gi) => {
    const opcoes = g.opcoes || g.valores || [];
    if (!opcoes.length) return '';
    const tipo      = g.tipo || 'opcional';
    const isSingle  = ['radio','cortes','preparos','ocasiao','armazenamento','pesos','obrigatorio','sabor'].includes(tipo);
    const isRequired= ['obrigatorio','sabor','cortes'].includes(tipo);
    const inputType = isSingle ? 'radio' : 'checkbox';
    const label     = g.nome || g.name || _TIPO_LABEL[tipo] || 'Adicional';

    // Helper: ícone — URL vira <img>, emoji/texto vira <span>
    const _iconEl = (src, size) => {
      if (!src) return '';
      const s = size || 28;
      return (String(src).startsWith('http') || String(src).startsWith('/'))
        ? `<img src="${src}" style="width:${s}px;height:${s}px;object-fit:contain;border-radius:5px;flex-shrink:0" onerror="this.style.display='none'">`
        : `<span style="font-size:${Math.round(s*.7)}px;flex-shrink:0">${src}</span>`;
    };

    // Helper: nome seguro (cobre pesos numéricos → "Xg")
    const _nomeSafe = op =>
      op === null || op === undefined ? '' :
      (op.nome || op.name || (typeof op === 'string' ? op : '') ||
       (typeof op === 'number' ? (op >= 1000 ? (op/1000).toFixed(1).replace('.',',')+'kg' : op+'g') : ''));

    // ── Cortes: grid de cards com imagem ─────────────────────────────
    if (tipo === 'cortes') {
      const cards = opcoes.map((op, oi) => {
        const nome   = _nomeSafe(op);
        const imgUrl = op.icon || op.image || op.img || op.image_url || '';
        const imgEl  = (String(imgUrl).startsWith('http') || String(imgUrl).startsWith('/'))
          ? `<img src="${imgUrl}" style="width:56px;height:48px;object-fit:contain;display:block" onerror="this.style.display='none'">`
          : `<div style="width:56px;height:48px;display:flex;align-items:center;justify-content:center;font-size:26px">🥩</div>`;
        return `<label style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 8px;background:var(--surface2);border:1.5px solid var(--border);border-radius:10px;cursor:pointer;text-align:center;min-width:80px;max-width:100px;transition:all .15s" onclick="pdvbToggleOpc(this)">
          <input type="radio" name="pdvb-grp-${gi}" data-grp="${gi}" data-idx="${oi}" data-nome="${nome.replace(/"/g,'&quot;')}" data-preco="0" style="position:absolute;opacity:0;pointer-events:none">
          ${imgEl}
          <span style="font-size:11px;font-weight:600;line-height:1.2;color:var(--text)">${nome}</span>
        </label>`;
      }).join('');
      return `<div style="margin-bottom:16px">
        <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px">
          ${label}${isRequired?' <span style="color:var(--danger);font-size:10px">*obrigatório</span>':''}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">${cards}</div>
      </div>`;
    }

    // ── Preparos / Ocasião / Armazenamento: chips com ícone ──────────
    if (['preparos','ocasiao','armazenamento'].includes(tipo)) {
      const chips = opcoes.map((op, oi) => {
        const nome = _nomeSafe(op);
        const icon = _iconEl(op.icon || op.image || '', 28);
        return `<label style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 10px;background:var(--surface2);border:1.5px solid var(--border);border-radius:10px;cursor:pointer;text-align:center;min-width:64px;max-width:80px;transition:all .15s" onclick="pdvbToggleOpc(this)">
          <input type="radio" name="pdvb-grp-${gi}" data-grp="${gi}" data-idx="${oi}" data-nome="${nome.replace(/"/g,'&quot;')}" data-preco="0" style="position:absolute;opacity:0;pointer-events:none">
          <div style="width:36px;height:36px;border-radius:8px;background:rgba(255,255,255,.05);display:flex;align-items:center;justify-content:center">${icon}</div>
          <span style="font-size:10.5px;font-weight:600;line-height:1.2;color:var(--text)">${nome}</span>
        </label>`;
      }).join('');
      return `<div style="margin-bottom:16px">
        <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px">${label}</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">${chips}</div>
      </div>`;
    }

    // ── Pesos: botões de seleção rápida ──────────────────────────────
    if (tipo === 'pesos') {
      const btns = opcoes.map((op, oi) => {
        const nome  = _nomeSafe(op);
        const preco = parseFloat(op.preco || op.price || 0);
        return `<label style="padding:8px 14px;background:var(--surface2);border:1.5px solid var(--border);border-radius:9px;cursor:pointer;font-size:13px;font-weight:700;text-align:center;transition:all .15s;white-space:nowrap" onclick="pdvbToggleOpc(this)">
          <input type="radio" name="pdvb-grp-${gi}" data-grp="${gi}" data-idx="${oi}" data-nome="${nome.replace(/"/g,'&quot;')}" data-preco="${preco}" style="position:absolute;opacity:0;pointer-events:none">
          ${nome}${preco>0?`<span style="color:var(--success);font-size:10px;margin-left:4px">+R$ ${preco.toFixed(2).replace('.',',')}</span>`:''}
        </label>`;
      }).join('');
      return `<div style="margin-bottom:16px">
        <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px">${label}</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">${btns}</div>
      </div>`;
    }

    // ── Outros grupos (radio / checkbox padrão) ──────────────────────
    return `<div style="margin-bottom:16px">
      <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px">
        ${label}${isRequired?' <span style="color:var(--danger);font-size:10px">*obrigatório</span>':''}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${opcoes.map((op,oi)=>{
          const nome   = _nomeSafe(op);
          const preco  = parseFloat(op.preco||op.price||0);
          const icon   = _iconEl(op.icon || op.image || '', 22);
          const pLabel = preco>0?` <span style="color:var(--success);font-size:11px">+R$ ${preco.toFixed(2).replace('.',',')}</span>`:'';
          return `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface2);border:1.5px solid var(--border);border-radius:9px;cursor:pointer;transition:all .15s" onclick="pdvbToggleOpc(this)">
            <input type="${inputType}" name="pdvb-grp-${gi}" data-grp="${gi}" data-idx="${oi}" data-nome="${(nome+'').replace(/"/g,'&quot;')}" data-preco="${preco}" style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0">
            ${icon}<span style="font-size:13px;font-weight:500;flex:1">${nome}${pLabel}</span>
          </label>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');

  const kgHtml = isKg ? `<div style="margin-bottom:16px">
    <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px">Quantidade (kg)</div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      ${[0.25,0.5,1,1.5,2,2.5,3].map(v=>`<button onclick="pdvbSetKg(${v})" style="padding:7px 12px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer;font-size:13px;font-weight:700;font-family:inherit">${v>=1?(v+'kg'):(v*1000+'g')}</button>`).join('')}
      <input type="number" id="pdvb-kg-input" min="0.1" step="0.1" value="1"
        style="width:90px;padding:8px;border:1.5px solid var(--accent);border-radius:8px;background:var(--surface2);color:var(--text);font-size:16px;font-weight:700;text-align:center;outline:none;font-family:inherit"
        oninput="pdvbAtualizarTotal()">
      <span style="font-size:13px;color:var(--muted)">kg</span>
    </div>
  </div>` : '';

  const modal = document.createElement('div');
  modal.id = 'pdvb-modal-item-bg';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:flex-end;justify-content:center';
  modal.onclick = e => { if(e.target===modal) modal.remove(); };
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:20px 20px 0 0;width:100%;max-width:520px;max-height:88vh;overflow-y:auto;padding:20px 20px 32px;box-shadow:0 -8px 40px rgba(0,0,0,.3)">
      <div style="width:40px;height:4px;background:var(--border);border-radius:99px;margin:0 auto 18px"></div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        ${it.imageUrl
          ? `<img src="${it.imageUrl}" style="width:60px;height:60px;border-radius:12px;object-fit:cover;flex-shrink:0">`
          : `<div style="width:60px;height:60px;border-radius:12px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0">${it.emoji||'🍽️'}</div>`}
        <div>
          <div style="font-size:16px;font-weight:800">${it.name}</div>
          <div style="font-size:13px;color:var(--success);font-weight:700;margin-top:2px">R$ ${priceStr}${isKg?' /kg':''}</div>
        </div>
      </div>
      ${kgHtml}
      ${gruposHtml}
      <div style="margin-bottom:14px">
        <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:6px">Observação</div>
        <textarea id="pdvb-obs-input" placeholder="Ex: sem cebola, bem passado..." rows="2"
          style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:9px;background:var(--surface2);color:var(--text);font-size:13px;outline:none;resize:none;font-family:inherit;box-sizing:border-box"></textarea>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <button onclick="pdvbModalQty(-1)" style="width:36px;height:36px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface2);cursor:pointer;font-size:18px;font-weight:700">−</button>
        <span id="pdvb-modal-qty" style="font-size:18px;font-weight:800;min-width:32px;text-align:center">1</span>
        <button onclick="pdvbModalQty(1)"  style="width:36px;height:36px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface2);cursor:pointer;font-size:18px;font-weight:700">+</button>
        <span id="pdvb-modal-total" style="font-size:15px;font-weight:800;color:var(--success);margin-left:auto"></span>
      </div>
      <button onclick="_pdvbConfirmar(${it.id})"
        style="width:100%;padding:14px;border-radius:14px;border:none;background:var(--accent);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">
        Adicionar ao pedido
      </button>
    </div>`;
  document.body.appendChild(modal);
  modal._item   = it;
  modal._isKg   = isKg;
  modal._grupos = grupos;
  window._pdvbQty = 1;
  pdvbAtualizarTotal();
}

function pdvbToggleOpc(label) {
  const inp = label.querySelector('input');
  if (!inp) return;
  if (inp.type === 'radio') {
    // Desmarca todos do grupo
    document.querySelectorAll(`input[name="${inp.name}"]`).forEach(r => {
      r.checked = false;
      r.closest('label').style.borderColor = 'var(--border)';
      r.closest('label').style.background  = 'var(--surface2)';
    });
    // Marca este
    inp.checked = true;
    label.style.borderColor = 'var(--accent)';
    label.style.background  = 'rgba(var(--accent-rgb,249,115,22),.08)';
  } else {
    inp.checked = !inp.checked;
    if (inp.checked) {
      label.style.borderColor = 'var(--accent)';
      label.style.background  = 'rgba(var(--accent-rgb,249,115,22),.08)';
    } else {
      label.style.borderColor = 'var(--border)';
      label.style.background  = 'var(--surface2)';
    }
  }
  pdvbAtualizarTotal();
}

function pdvbSetKg(v) {
  const el = document.getElementById('pdvb-kg-input');
  if (el) el.value = v;
  pdvbAtualizarTotal();
}

function pdvbModalQty(d) {
  window._pdvbQty = Math.max(1, (window._pdvbQty||1) + d);
  const el = document.getElementById('pdvb-modal-qty');
  if (el) el.textContent = window._pdvbQty;
  pdvbAtualizarTotal();
}

function pdvbAtualizarTotal() {
  const modal = document.getElementById('pdvb-modal-item-bg');
  if (!modal?._item) return;
  const it = modal._item;
  const isKg = modal._isKg;
  const qty = window._pdvbQty || 1;
  let extra = 0;
  document.querySelectorAll('#pdvb-modal-item-bg input:checked').forEach(inp => {
    extra += parseFloat(inp.dataset.preco || 0);
  });
  let basePrice = parseFloat(it.price||0) + extra;
  if (isKg) {
    const kg = parseFloat(document.getElementById('pdvb-kg-input')?.value || 1);
    basePrice = basePrice * kg;
  }
  const total = basePrice * qty;
  const el = document.getElementById('pdvb-modal-total');
  if (el) el.textContent = 'R$ ' + total.toFixed(2).replace('.',',');
}

function _pdvbConfirmar(itemId) {
  const modal = document.getElementById('pdvb-modal-item-bg');
  if (!modal) return;
  const it     = modal._item;
  const isKg   = modal._isKg;
  const grupos = Array.isArray(modal._grupos) ? modal._grupos : [];
  const qty    = window._pdvbQty || 1;

  // ── Agrupa opções selecionadas POR GRUPO ──
  // O parser de impressão (_parseObs em gestor-relatorios.js) espera o formato:
  //   "NomeGrupo: opcao1, opcao2 (+R$ 3,00) · OutroGrupo: x · observação livre"
  // Sem isso a comanda imprime sem os adicionais.
  let extra = 0;
  const porGrupo = new Map(); // gi → { nome, opcoes:[] }
  document.querySelectorAll('#pdvb-modal-item-bg input:checked').forEach(inp => {
    const preco = parseFloat(inp.dataset.preco || 0);
    extra += preco;
    const gi = parseInt(inp.dataset.grp);
    if (isNaN(gi)) return;
    const g = grupos[gi];
    if (!g) return;
    const grpNome = g.nome || g.name || (
      g.tipo === 'cortes'        ? 'Corte' :
      g.tipo === 'preparos'      ? 'Preparo' :
      g.tipo === 'ocasiao'       ? 'Ocasião' :
      g.tipo === 'armazenamento' ? 'Armazenamento' :
      g.tipo === 'pesos'         ? 'Porção' :
      g.tipo === 'sabor'         ? 'Sabor' : 'Adicional'
    );
    const opcNome = inp.dataset.nome || '';
    if (!opcNome) return;
    const opcLabel = preco > 0
      ? `${opcNome} (+R$ ${preco.toFixed(2).replace('.',',')})`
      : opcNome;
    if (!porGrupo.has(gi)) porGrupo.set(gi, { nome: grpNome, opcoes: [] });
    porGrupo.get(gi).opcoes.push(opcLabel);
  });

  let price = parseFloat(it.price||0) + extra;
  let name  = it.name;
  const obsLivre = document.getElementById('pdvb-obs-input')?.value.trim() || '';

  // Monta string final no formato esperado pelo parser
  const partesObs = [];
  for (const { nome: grpNome, opcoes } of porGrupo.values()) {
    if (opcoes.length) partesObs.push(`${grpNome}: ${opcoes.join(', ')}`);
  }
  if (obsLivre) partesObs.push(obsLivre);
  const obs = partesObs.join(' · ');

  if (isKg) {
    const kg = parseFloat(document.getElementById('pdvb-kg-input')?.value || 1);
    price = price * kg;
    name  = it.name + ' ' + kg.toFixed(3).replace('.',',') + 'kg';
    pdvbCart.push({...it, name, qty:1, price, obs});
  } else {
    const existing = pdvbCart.find(c => c.id === it.id && c.obs === obs && c.name === it.name);
    if (existing) existing.qty += qty;
    else pdvbCart.push({...it, name, qty, price, obs});
  }

  pdvbRenderOrder();
  modal.remove();
  sbToast('ok', name + ' adicionado!');
}
// ── Fim modal adicionais PDV Balcão ──────────────
function pdvbRenderOrder(){
  const el=document.getElementById('pdvb-order-items');if(!el)return;
  if(pdvbCart.length===0){
    el.innerHTML=`<div class="pdvb-empty-order"><svg width="32" height="32" viewBox="0 0 16 16" fill="none" style="opacity:.3"><path d="M2 2h2l1.5 7.5A1 1 0 0 0 6.5 11h5a1 1 0 0 0 1-.8L14 6H4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="7" cy="13.5" r="1" fill="currentColor"/><circle cx="12" cy="13.5" r="1" fill="currentColor"/></svg>Finalize o item ao lado,<br>ele vai aparecer aqui</div>`;
  }else{
    el.innerHTML=pdvbCart.map((ci,idx)=>`
      <div class="pdvb-oi">
        <div class="pdvb-oi-emoji">${ci.emoji||'🍽️'}</div>
        <div class="pdvb-oi-info">
          <div class="pdvb-oi-name">${ci.name}</div>
          <div class="pdvb-oi-price">R$ ${(ci.price*ci.qty).toFixed(2).replace('.',',')}</div>
          ${ci.obs?`<div class="pdvb-oi-obs">💬 ${ci.obs}</div>`:''}
        </div>
        <div class="pdvb-oi-ctrl">
          <div class="pdvb-qb" onclick="pdvbChangeQty(${idx},-1)">−</div>
          <div class="pdvb-qn">${ci.qty}</div>
          <div class="pdvb-qb" onclick="pdvbChangeQty(${idx},1)">+</div>
        </div>
      </div>`).join('');
  }
  const sub=pdvbCart.reduce((s,ci)=>s+ci.price*ci.qty,0);
  const total=Math.max(0,sub+pdvbEntregaTaxa-pdvbDesconto);
  document.getElementById('pdvb-subtotal').textContent='R$ '+sub.toFixed(2).replace('.',',');
  document.getElementById('pdvb-total').textContent='R$ '+total.toFixed(2).replace('.',',');
  document.getElementById('pdvb-entrega').textContent=pdvbEntregaTaxa>0?'R$ '+pdvbEntregaTaxa.toFixed(2).replace('.',','):'Grátis';
  document.getElementById('pdvb-entrega').style.color=pdvbEntregaTaxa>0?'var(--text)':'var(--success)';
  const dr=document.getElementById('pdvb-desconto-row');
  if(pdvbDesconto>0){dr.style.display='flex';document.getElementById('pdvb-desconto').textContent='-R$ '+pdvbDesconto.toFixed(2).replace('.',',');}else{dr.style.display='none';}
  const btn=document.getElementById('pdvb-gerar');if(btn)btn.disabled=pdvbCart.length===0;
  const cl=document.getElementById('pdvb-client');if(cl&&pdvbMesaNum&&!cl.value)cl.value=`Mesa ${pdvbMesaNum}`;
}
function pdvbChangeQty(idx,delta){pdvbCart[idx].qty+=delta;if(pdvbCart[idx].qty<=0)pdvbCart.splice(idx,1);pdvbRenderOrder();}
function pdvbClearCart(){
  pdvbCart=[];pdvbDesconto=0;pdvbEntregaTaxa=0;pdvbEntregaTipo='balcao';pdvbEntregaAddr='';pdvbPagamento='Dinheiro';pdvbMesaNum=null;pdvbMesaSelecionada=null;
  const ph=document.getElementById('pdvb-phone'),cl=document.getElementById('pdvb-client');
  if(ph)ph.value='';if(cl)cl.value='';pdvbRenderOrder();sbToast('ok','Pedido limpo');
}
function pdvbSwitchTab(tab){
  pdvbActiveTab=tab;
  ['d','m'].forEach(t=>document.getElementById('pdvb-tab-'+t)?.classList.toggle('on',t===tab));
  if(tab==='m'){pdvbOpenMesaModal();setTimeout(()=>{document.getElementById('pdvb-tab-d')?.classList.add('on');document.getElementById('pdvb-tab-m')?.classList.remove('on');pdvbActiveTab='d';},200);}
}
function pdvbToggleFilter(){const p=document.getElementById('pdvb-filter-panel');if(p)p.style.display=p.style.display==='none'?'block':'none';}
function pdvbSetFilter(f){
  pdvbFilter=f;
  ['todos','promo','pizza'].forEach(k=>{const b=document.getElementById('pdvb-f-'+k);if(b){b.classList.toggle('on',k===f);b.style.color=k===f?'var(--accent)':'';b.style.borderColor=k===f?'var(--accent)':'';}});
  pdvbRenderGrid();
}
function pdvbBackCat(){pdvbSelectCat('__todos__');}
function pdvbOpenObs(){
  if(pdvbCart.length===0){sbToast('err','Adicione itens primeiro');return;}
  pdvbObsIdx=pdvbCart.length-1;
  const it=pdvbCart[pdvbObsIdx];
  const ne=document.getElementById('pdvb-obs-item-name'),te=document.getElementById('pdvb-obs-text');
  if(ne)ne.textContent=it.name;if(te)te.value=it.obs||'';
  openModal('modal-pdvb-obs');
}
function pdvbSaveObs(){
  const text=(document.getElementById('pdvb-obs-text')||{}).value||'';
  if(pdvbObsIdx>=0&&pdvbObsIdx<pdvbCart.length){pdvbCart[pdvbObsIdx].obs=text;pdvbRenderOrder();}
  closeModal('modal-pdvb-obs');sbToast('ok','Observação salva!');
}
function pdvbEntrega(){openModal('modal-pdvb-entrega');}
function pdvbSelectEntrega(label,val){
  document.querySelectorAll('#modal-pdvb-entrega label').forEach(l=>l.style.borderColor=l===label?'var(--accent)':'var(--border)');
  const w=document.getElementById('pdvb-addr-wrap');if(w)w.style.display=val==='delivery'?'block':'none';
}
function pdvbUpdateTaxa(){pdvbEntregaTaxa=parseFloat(document.getElementById('pdvb-taxa-val')?.value)||0;pdvbRenderOrder();}
function pdvbConfirmEntrega(){
  const tipo=document.querySelector('input[name="pdvb-entrega"]:checked')?.value||'balcao';
  pdvbEntregaTipo=tipo;
  if(tipo==='delivery'){
    const rua   =(document.getElementById('pdvb-rua')?.value||'').trim();
    const num   =(document.getElementById('pdvb-num')?.value||'').trim();
    const bairro=(document.getElementById('pdvb-bairro')?.value||'').trim();
    const compl =(document.getElementById('pdvb-compl')?.value||'').trim();
    const ref   =(document.getElementById('pdvb-ref')?.value||'').trim();
    const partes=[rua,num,bairro,compl,ref].filter(Boolean);
    if(!rua){sbToast('err','Informe a rua/avenida');return;}
    pdvbEntregaAddr=partes.join(', ');
    pdvbEntregaTaxa=parseFloat(document.getElementById('pdvb-taxa-val')?.value)||0;
  } else {
    pdvbEntregaTaxa=0;
    pdvbEntregaAddr='';
  }
  pdvbRenderOrder();closeModal('modal-pdvb-entrega');
  sbToast('ok',tipo==='delivery'?`Delivery — R$ ${pdvbEntregaTaxa.toFixed(2).replace('.',',')}`:'Balcão / Retirada');
}
function pdvbPagamentos(){openModal('modal-pdvb-pag');}
function pdvbSelectPag(label,val){
  pdvbPagamento=val;
  document.querySelectorAll('#pdvb-pag-grid label').forEach(l=>l.style.borderColor=l===label?'var(--accent)':'var(--border)');
  const tw=document.getElementById('pdvb-troco-wrap');if(tw)tw.style.display=val==='Dinheiro'?'block':'none';
}
function pdvbConfirmPag(){closeModal('modal-pdvb-pag');sbToast('ok',`Pagamento: ${pdvbPagamento}`);}
function pdvbCPF(){const v=prompt('CPF/CNPJ do cliente (opcional):');if(v!==null)sbToast('ok',v?`CPF/CNPJ: ${v}`:'CPF/CNPJ removido');}
function pdvbAjustar(){
  document.getElementById('pdvb-desc-pct').value='';document.getElementById('pdvb-desc-val').value='';document.getElementById('pdvb-desc-preview').style.display='none';
  openModal('modal-pdvb-ajustar');
}
function pdvbPreviewDesc(){
  const sub=pdvbCart.reduce((s,ci)=>s+ci.price*ci.qty,0);
  const pct=parseFloat(document.getElementById('pdvb-desc-pct')?.value)||0;
  const val=parseFloat(document.getElementById('pdvb-desc-val')?.value)||0;
  const desc=pct>0?sub*(pct/100):val;
  const p=document.getElementById('pdvb-desc-preview');
  if(p&&desc>0){p.style.display='block';p.innerHTML=`<div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Desconto</span><span style="color:var(--success);font-weight:700">-R$ ${desc.toFixed(2).replace('.',',')}</span></div><div style="display:flex;justify-content:space-between;font-weight:700;margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><span>Total</span><span style="color:var(--accent)">R$ ${Math.max(0,sub+pdvbEntregaTaxa-desc).toFixed(2).replace('.',',')}</span></div>`;}
}
function pdvbConfirmAjuste(){
  const sub=pdvbCart.reduce((s,ci)=>s+ci.price*ci.qty,0);
  const pct=parseFloat(document.getElementById('pdvb-desc-pct')?.value)||0;
  const val=parseFloat(document.getElementById('pdvb-desc-val')?.value)||0;
  pdvbDesconto=pct>0?sub*(pct/100):val;pdvbRenderOrder();closeModal('modal-pdvb-ajustar');
  sbToast('ok',`Desconto de R$ ${pdvbDesconto.toFixed(2).replace('.',',')} aplicado!`);
}
async function pdvbGerarPedido(){
  if(pdvbCart.length===0){sbToast('err','Carrinho vazio!');return;}
  const client=document.getElementById('pdvb-client')?.value||(pdvbMesaNum?`Mesa ${pdvbMesaNum}`:'Balcão');
  const phone=document.getElementById('pdvb-phone')?.value||'';
  const sub=pdvbCart.reduce((s,ci)=>s+ci.price*ci.qty,0);
  const total=Math.max(0,sub+pdvbEntregaTaxa-pdvbDesconto);
  const addr=pdvbEntregaTipo==='mesa'?`Mesa ${pdvbMesaNum}`:pdvbEntregaTipo==='delivery'?(pdvbEntregaAddr||'Entrega'):'balcão';
  const time=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  const itemsData=pdvbCart.map(ci=>({id:ci.id,name:ci.name,qty:ci.qty,price:ci.price,obs:ci.obs||'',emoji:ci.emoji||''}));
  sbLoading(true);
  try{
    if(!_sessao?.tenant_id){sbLoading(false);sbToast('err','Sessão sem tenant — recarregue');return;}
    const payload={tenant_id:_sessao.tenant_id,client:client||'Balcão',phone,items:itemsData,total,taxa:pdvbEntregaTaxa,status:'analise',addr,pag:pdvbPagamento,time};
    if(pdvbMesaNum)payload.mesa_num=pdvbMesaNum;
    const{data:ord,error:ordErr}=await sb.from('orders').insert(payload).select().single();
    if(ordErr)throw ordErr;
    if(pdvbMesaNum){
      const t=tables.find(x=>x.num===pdvbMesaNum);
      const now=new Date().toISOString();
      const mesaPayload=t?.opened_at?{status:'busy',updated_at:now}:{status:'busy',opened_at:now,updated_at:now};
      await sb.from('mesas').update(mesaPayload).eq('num',pdvbMesaNum);
      if(t){t.status='busy';t.updated_at=now;if(!t.opened_at)t.opened_at=now;}
    }
    await sb.from('movimentos').insert({description:`PDV — ${client}`,tipo:'entrada',val:total,pag:pdvbPagamento,time});
    if(ord)ordersKanban.unshift({id:ord.id,client:ord.client,phone:ord.phone,items:itemsData,total,taxa:pdvbEntregaTaxa,status:'analise',time,addr,pag:pdvbPagamento});
    playOrderSound();sbToast('ok',`Pedido #${ord?.id||'?'} gerado — R$ ${total.toFixed(2).replace('.',',')}`);pdvbClearCart();
  }catch(e){console.error(e);sbToast('err','Erro: '+(e?.message||JSON.stringify(e)));}
  finally{sbLoading(false);}
}
function pdvbFormatPhone(input){
  let v=input.value.replace(/\D/g,'').slice(0,11);
  if(v.length>10)v=v.replace(/(\d{2})(\d{5})(\d{4})/,'($1) $2-$3');
  else if(v.length>6)v=v.replace(/(\d{2})(\d{4})(\d*)/,'($1) $2-$3');
  else if(v.length>2)v=v.replace(/(\d{2})(\d*)/,'($1) $2');
  input.value=v;
}
// Mesa modal
function pdvbOpenMesaModal(){pdvbMesaSelecionada=null;pdvbMesaSubtab='mesas';pdvbRenderMesaModal();openModal('modal-pdvb-mesa');}
function pdvbMesaSubSwitch(tab){
  pdvbMesaSubtab=tab;
  document.getElementById('pdvb-mesa-sub-mesas')?.style&&(document.getElementById('pdvb-mesa-sub-mesas').style.color=tab==='mesas'?'var(--accent)':'var(--muted)');
  document.getElementById('pdvb-mesa-sub-mesas').style.borderBottomColor=tab==='mesas'?'var(--accent)':'transparent';
  document.getElementById('pdvb-mesa-sub-comandas').style.color=tab==='comandas'?'var(--accent)':'var(--muted)';
  document.getElementById('pdvb-mesa-sub-comandas').style.borderBottomColor=tab==='comandas'?'var(--accent)':'transparent';
  pdvbRenderMesaModal();
}
function pdvbRenderMesaModal(){
  const grid=document.getElementById('pdvb-mesa-grid');if(!grid)return;
  const q=(document.getElementById('pdvb-mesa-search')||{}).value?.toLowerCase()||'';
  const fil=tables.filter(t=>!q||`mesa ${t.num}`.includes(q)||(pdvbMesaSubtab==='comandas'&&t.status!=='free')||true);
  const list=pdvbMesaSubtab==='mesas'?fil:fil.filter(t=>t.status!=='free');
  if(!list.length){grid.innerHTML='<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:30px;font-size:13px">Nenhuma mesa encontrada</div>';return;}
  grid.innerHTML=list.filter(t=>!q||`mesa ${t.num}`.includes(q)).map(t=>{
    const isFree=t.status==='free',isWait=t.status==='waiting';
    const sel=pdvbMesaSelecionada?.num===t.num;
    const statusLabel=isFree?'Livre':isWait?'Aguard. pag.':'Ocupada';
    const statusColor=isFree?'var(--success)':isWait?'var(--accent3)':'var(--danger)';
    const border=sel?'var(--accent)':isFree?'rgba(34,197,94,.35)':isWait?'rgba(245,158,11,.35)':'rgba(239,68,68,.35)';
    const bg=sel?'rgba(59,130,246,.1)':isFree?'rgba(34,197,94,.07)':isWait?'rgba(245,158,11,.07)':'rgba(239,68,68,.07)';
    return`<div onclick="pdvbSelectMesa(${t.num},'${t.status}')" style="border:2px solid ${border};background:${bg};border-radius:12px;padding:18px 14px;cursor:pointer;transition:all .15s;text-align:center">
      <div style="font-size:15px;font-weight:700;margin-bottom:6px;color:${sel?'var(--accent)':'var(--text)'}">Mesa ${t.num}</div>
      ${t.guests?`<div style="font-size:11px;color:var(--muted);margin-bottom:4px">👥 ${t.guests} pessoas</div>`:''}
      <div style="font-size:11.5px;font-weight:700;color:${statusColor}">${statusLabel}</div>
      ${t.total?`<div style="font-size:11px;color:var(--muted);margin-top:4px">R$ ${parseFloat(t.total).toFixed(2).replace('.',',')}</div>`:''}
    </div>`;
  }).join('');
}
function pdvbSelectMesa(num,status){
  pdvbMesaSelecionada={num,status};pdvbRenderMesaModal();
  const btn=document.getElementById('pdvb-mesa-confirm-btn');if(btn){btn.disabled=false;btn.textContent=`Confirmar Mesa ${num}`;}
}
function pdvbConfirmMesa(){
  if(!pdvbMesaSelecionada){sbToast('err','Selecione uma mesa');return;}
  const{num}=pdvbMesaSelecionada;closeModal('modal-pdvb-mesa');
  const cl=document.getElementById('pdvb-client');if(cl)cl.value=`Mesa ${num}`;
  pdvbMesaNum=num;pdvbEntregaTipo='mesa';pdvbEntregaTaxa=0;pdvbEntregaAddr=`Mesa ${num}`;
  sbToast('ok',`Mesa ${num} selecionada!`);pdvbRenderOrder();
}
function pdvbCancelMesaModal(){closeModal('modal-pdvb-mesa');}
// Teclado
function pdvbSetupKeyboard(){document.removeEventListener('keydown',_pdvbKeyHandler);document.addEventListener('keydown',_pdvbKeyHandler);}
function _pdvbKeyHandler(e){
  const page=document.getElementById('page-pdv-balcao');if(!page||!page.classList.contains('on'))return;
  const tag=document.activeElement?.tagName;if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
  const fil=pdvbGetFilteredItems();
  switch(e.key.toUpperCase()){
    case 'D':pdvbSwitchTab('d');break;case 'M':pdvbSwitchTab('m');break;
    case 'F':pdvbToggleFilter();break;case 'P':document.getElementById('pdvb-search')?.focus();e.preventDefault();break;
    case 'O':pdvbOpenObs();break;case 'A':pdvbGerarPedido();break;
    case 'E':pdvbEntrega();break;case 'R':pdvbPagamentos();break;
    case 'T':pdvbCPF();break;case 'Y':pdvbAjustar();break;case 'V':pdvbBackCat();break;
    case 'ARROWRIGHT':case 'ARROWDOWN':pdvbFocusIdx=Math.min(pdvbFocusIdx+1,fil.length-1);pdvbRenderGrid();document.getElementById('pdvbi-'+pdvbFocusIdx)?.scrollIntoView({block:'nearest',behavior:'smooth'});e.preventDefault();break;
    case 'ARROWLEFT':case 'ARROWUP':pdvbFocusIdx=Math.max(pdvbFocusIdx-1,0);pdvbRenderGrid();document.getElementById('pdvbi-'+pdvbFocusIdx)?.scrollIntoView({block:'nearest',behavior:'smooth'});e.preventDefault();break;
    case 'ENTER':if(pdvbFocusIdx>=0&&pdvbFocusIdx<fil.length){pdvbAddItem(fil[pdvbFocusIdx].id);e.preventDefault();}break;
  }
}

let _autoAcceptOn = false;

function toggleAutoAccept(el) {
  el.classList.toggle('on');
  _autoAcceptOn = el.classList.contains('on');
  // Persiste localmente
  try { localStorage.setItem('gestor_auto_accept', _autoAcceptOn ? '1' : '0'); } catch(e) {}
  showToast('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M13 8A5 5 0 1 1 8 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8 1v4h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>', 'Aceitar automaticamente: ' + (_autoAcceptOn ? 'Ativado' : 'Desativado'));
}

// Restaura estado do auto-accept ao carregar
(function() {
  try {
    if (localStorage.getItem('gestor_auto_accept') === '1') {
      _autoAcceptOn = true;
      const el = document.getElementById('auto-accept');
      if (el) el.classList.add('on');
    }
  } catch(e) {}
})();

async function toggleStatus(){
  const st  = document.getElementById('status-txt');
  const dot = document.getElementById('status-dot');
  const pill = document.getElementById('pill-status');
  const on  = st.textContent === 'Online';
  const newOpen = !on;
  const _aplicarVisual = (open) => {
    st.textContent = open ? 'Online' : 'Offline';
    if (dot)  dot.style.background  = open ? 'var(--success)' : 'var(--danger)';
    if (pill) { pill.style.background = open ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)'; pill.style.borderColor = open ? 'rgba(34,197,94,.25)' : 'rgba(239,68,68,.25)'; pill.style.color = open ? 'var(--success)' : 'var(--danger)'; }
  };
  _aplicarVisual(newOpen);
  try {
    const { error } = await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, store_open: newOpen });
    if (error) throw error;
    sbToast('ok', newOpen?'Loja aberta para pedidos!':'Loja pausada');
  } catch(e) {
    // Reverte o visual — a mudança não foi salva de verdade, então não pode
    // ficar mostrando um status diferente do que está no banco.
    _aplicarVisual(on);
    if (typeof _isSessaoExpiradaError === 'function' && _isSessaoExpiradaError(e)) {
      _avisarSessaoExpirada();
    } else {
      sbToast('err', 'Erro ao salvar status da loja: ' + (e?.message || 'tente novamente'));
    }
  }
}

// ── Histórico de mesas do dia ─────────────────────────────────────────────────
async function carregarHistoricoMesas() {
  const el = document.getElementById('cx-historico-mesas');
  const elGarcom = document.getElementById('cx-relatorio-garcom');
  if (!el) return;

  el.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:8px">Carregando...</div>';

  try {
    const hoje = new Date();
    hoje.setHours(hoje.getHours() - 3); // UTC-3 BR
    const dataHoje = hoje.toISOString().split('T')[0];

    // Busca movimentos de mesa do dia
    const { data: movs } = await sb.from('movimentos')
      .select('*')
      .like('description', 'Mesa %— Pagamento%')
      .gte('created_at', dataHoje)
      .order('created_at', { ascending: false });

    if (!movs?.length) {
      el.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:8px">Nenhuma mesa fechada hoje</div>';
      if (elGarcom) elGarcom.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:8px">Sem dados</div>';
      return;
    }

    // Renderiza histórico de mesas
    el.innerHTML = movs.map(m => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--surface2);border-radius:8px;border:1px solid var(--border)">
        <div>
          <div style="font-size:12.5px;font-weight:600">${m.description}</div>
          <div style="font-size:11px;color:var(--muted)">${m.pag} · ${m.time}</div>
        </div>
        <div style="font-size:13px;font-weight:700;color:var(--success)">R$ ${parseFloat(m.val||0).toFixed(2).replace('.',',')}</div>
      </div>`).join('');

    // Relatório por garçom
    if (elGarcom) {
      // Busca pedidos de mesa do dia para agrupar por garçom
      const { data: orders } = await sb.from('orders')
        .select('garcom_nome, items, total, status, created_at')
        .not('mesa_num', 'is', null)
        .eq('status', 'entregue')
        .gte('created_at', dataHoje);

      const garcomMap = {};
      (orders || []).forEach(o => {
        const nome = o.garcom_nome || 'Sem garçom';
        if (!garcomMap[nome]) garcomMap[nome] = { total: 0, mesas: 0 };
        garcomMap[nome].total += parseFloat(o.total || 0);
        garcomMap[nome].mesas += 1;
      });

      const garcons = Object.entries(garcomMap).sort((a, b) => b[1].total - a[1].total);

      if (!garcons.length) {
        elGarcom.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:8px">Sem dados</div>';
      } else {
        elGarcom.innerHTML = garcons.map(([nome, d]) => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--surface2);border-radius:8px;border:1px solid var(--border)">
            <div>
              <div style="font-size:12.5px;font-weight:600">👨‍💼 ${nome}</div>
              <div style="font-size:11px;color:var(--muted)">${d.mesas} pedido(s)</div>
            </div>
            <div style="font-size:13px;font-weight:700;color:var(--accent3)">R$ ${d.total.toFixed(2).replace('.',',')}</div>
          </div>`).join('');
      }
    }
  } catch(e) {
    el.innerHTML = '<div style="font-size:12px;color:var(--red);text-align:center;padding:8px">Erro ao carregar</div>';
  }
}

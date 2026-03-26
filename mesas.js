// ─────────────────────────────────────────
// TABLE — EDIÇÃO EM MASSA
// ─────────────────────────────────────────
function scLabel(s){return s==='active'?'Disponível':s==='esgotado'?'Esgotado':'Pausado'}
function scClass(s){return s==='active'?'sta':s==='esgotado'?'ste':'stp'}

function getFiltered(){
  return items.filter(i=>{
    const q=filters.search.toLowerCase();
    if(q&&!i.name.toLowerCase().includes(q)&&!i.cat.toLowerCase().includes(q)) return false;
    if(filters.cat&&i.catKey!==filters.cat) return false;
    if(filters.status&&i.status!==filters.status) return false;
    return true;
  });
}

function renderTable(){
  const data=getFiltered();
  const rc=document.getElementById('row-count');
  if(rc) rc.textContent=data.length+' registro'+(data.length!==1?'s':'');
  const tb=document.getElementById('table-body');
  if(!tb) return;
  tb.innerHTML=data.map(item=>`
    <tr>
      <td><input type="checkbox" class="cb row-cb" onchange="onRowCheck()"></td>
      <td><div class="icell"><div class="ithumb">${item.emoji}</div><div><div class="iname">${item.name}${item.promo?'<span class="ptag"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 2v4h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 9h6M5 12h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg> Promo</span>':''}</div><div class="icat">${item.cat}</div></div></div></td>
      <td><div>${item.priceOld?`<div style="font-size:10.5px;color:var(--muted);text-decoration:line-through">R$ ${item.priceOld.toFixed(2).replace('.',',')}</div>`:''}<input class="pinput" value="R$ ${item.price.toFixed(2).replace('.',',')}" onchange="updatePrice(${item.id},this.value)"></div></td>
      <td style="color:var(--muted);font-size:12px">${item.cat}</td>
      <td><div class="dps">${item.days.map((on,i)=>`<div class="dp${on?' on':''}" onclick="toggleDay(${item.id},${i},this)">${DAYS[i]}</div>`).join('')}</div></td>
      <td><div class="stbadge ${scClass(item.status)}" onclick="cycleStatus(${item.id},this)"><div class="stdot"></div>&nbsp;${scLabel(item.status)}</div></td>
      <td><button class="btn bg" style="font-size:10.5px;padding:3px 8px" onclick="openEditItem(${item.id})">Editar</button></td>
    </tr>`).join('');
}

function onRowCheck(){
  const checked=document.querySelectorAll('.row-cb:checked').length;
  const btn=document.getElementById('bulk-btn');
  if(btn) btn.style.display=checked>0?'inline-flex':'none';
}

function toggleAll(cb){
  document.querySelectorAll('.row-cb').forEach(c=>c.checked=cb.checked);
  onRowCheck();
}

function filterCat(v){filters.cat=v;renderTable();}
function filterSt(v){filters.status=v;renderTable();}
function filterSearch(v){filters.search=v;renderTable();}
async function saveAll() {
  sbLoading(true);
  const updates = items.map(it =>
    sb.from('menu_items').update({
      price: it.price, status: it.status, days: it.days
    }).eq('id', it.id)
  );
  await Promise.all(updates);
  sbLoading(false);
  showToast(_ICON_SAV,'Alterações salvas no banco!');
}

function updatePrice(id, val) {
  const n = parseFloat(val.replace('R$','').replace(',','.').trim());
  const it = items.find(i => i.id === id);
  if (it && !isNaN(n)) { it.price = n; sb.from('menu_items').update({price:n}).eq('id',id); }
}

function toggleDay(id,dayIdx,el){
  el.classList.toggle('on');
  const it=items.find(i=>i.id===id);
  if(it) it.days[dayIdx]=el.classList.contains('on')?1:0;
}

function cycleStatus(id,el){
  const it=items.find(i=>i.id===id);
  if(!it) return;
  const cur=STATUS_CYCLE.findIndex(s=>s[0]===scClass(it.status));
  const next=STATUS_CYCLE[(cur+1)%STATUS_CYCLE.length];
  it.status=next[0]==='sta'?'active':next[0]==='ste'?'esgotado':'pausado';
  STATUS_CYCLE.forEach(s=>el.classList.remove(s[0]));
  el.classList.add(next[0]);
  el.innerHTML=`<div class="stdot"></div>&nbsp;${next[1]}`;
}

function setPizzaMax(ctx, val, el) {
  document.querySelectorAll(`#${ctx}-pizza-options .pz-max-btn`).forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  document.getElementById(`${ctx}-max-flavors`).value = val;
  // Auto-sync meio-a-meio: if max >= 2, suggest enabling it
}

function togglePizzaOptions(ctx) {
  const typeEl = document.getElementById(ctx+'-item-type');
  const box    = document.getElementById(ctx+'-pizza-options');
  if (!typeEl || !box) return;
  box.style.display = typeEl.value === 'pizza' ? '' : 'none';
}
function populateCatSelects() {
  const opts = categories.length
    ? categories.map(c => `<option value="${c.name}">${c.label}</option>`).join('')
    : '<option value="">Nenhuma categoria — crie uma primeiro</option>';
  ['new-cat','edit-cat'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { const prev = el.value; el.innerHTML = opts; el.value = prev; }
  });
}

async function addItem() {
  const name = document.getElementById('new-name').value.trim();
  console.log('[ADD-ITEM] chamado | nome:', name);
  if (!name) { sbToast('err', 'Informe o nome do item'); return; }

  const price    = parseFloat(document.getElementById('new-price').value) || 0;
  const priceOld = parseFloat(document.getElementById('new-price-old').value) || null;
  const catEl    = document.getElementById('new-cat');
  const catKey   = catEl ? catEl.value : '';
  const catLabel = catEl ? (catEl.options[catEl.selectedIndex]?.text || catKey) : catKey;
  const selEmo   = document.querySelector('#emoji-grid .emo-btn.on');
  const emoji    = (selEmo ? selEmo.textContent.trim() : '') || '🍽️';
  const desc     = document.getElementById('new-desc').value.trim();
  const ingrRaw  = document.getElementById('new-ingredients').value.trim();
  const ingredients  = ingrRaw ? ingrRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const itemType     = document.getElementById('new-item-type').value || 'normal';
  const allowHalf    = itemType === 'pizza' && document.getElementById('new-meio-meio')?.classList.contains('on');
  const maxFlavors   = itemType === 'pizza' ? (parseInt(document.getElementById('new-max-flavors')?.value) || 1) : 1;
  const status       = document.getElementById('new-status').value || 'active';
  const destaque     = document.getElementById('new-destaque')?.classList.contains('on') || false;
  const customGroups = readGrupos('new');

  console.log('[ADD-ITEM] campos | catKey:', catKey, '| catLabel:', catLabel, '| price:', price, '| emoji:', emoji, '| status:', status);

  if (!catKey) { sbToast('err', 'Selecione uma categoria'); return; }
  if (price < 0) { sbToast('err', 'Preço inválido'); return; }

  const payload = {
    emoji, name,
    cat:          catLabel,
    cat_key:      catKey,
    price,
    price_old:    priceOld,
    description:  desc,
    ingredients,
    item_type:    itemType,
    allow_half:   allowHalf,
    max_flavors:  maxFlavors,
    promo:        destaque,
    destaque,
    custom_groups: customGroups,
    status,
    days: [1,1,1,1,1,1,1]
  };
  console.log('[ADD-ITEM] payload enviado:', payload);

  sbLoading(true);
  const { data, error } = await sb.from('menu_items').insert(payload).select().single();
  sbLoading(false);

  console.log('[ADD-ITEM] resposta | data:', data, '| error:', error);

  if (error || !data) {
    sbToast('err', 'Erro ao salvar item: ' + (error?.message || 'resposta inválida do servidor'));
    console.error('[ADD-ITEM] ❌', error);
    return;
  }

  console.log('[ADD-ITEM] ✅ item criado id:', data.id);

  if (_newItemImageFile) {
    try {
      const url = await uploadItemImage(_newItemImageFile, data.id);
      await sb.from('menu_items').update({ image_url: url }).eq('id', data.id);
      data.image_url = url;
    } catch(e) { sbToast('err', 'Item criado, mas erro ao enviar foto'); }
    _newItemImageFile = null;
  }

  items.push(mapItem(data));

  ['new-name','new-desc','new-ingredients','new-price','new-price-old'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const t  = document.getElementById('new-img-thumb');        if(t)  { t.src = ''; t.style.display = 'none'; }
  const p2 = document.getElementById('new-img-placeholder');  if(p2) p2.style.display = 'flex';
  const c2 = document.getElementById('new-img-change');        if(c2) c2.style.display = 'none';
  const pr = document.getElementById('new-img-preview');       if(pr) pr.style.border  = '2px dashed var(--border)';
  const ni = document.getElementById('new-item-type');         if(ni) ni.value = 'normal';
  const ns = document.getElementById('new-status');            if(ns) ns.value = 'active';
  const nd = document.getElementById('new-destaque');          if(nd) nd.classList.remove('on');
  const ng = document.getElementById('new-grupos-list');       if(ng) ng.innerHTML = '';
  togglePizzaOptions('new');

  closeModal('modal-add-item');
  renderTable(); renderGestor(); renderPDV();
  sbToast('ok', `"${name}" adicionado ao cardápio!`);
}

function openEditItem(id) {
  editingId = +id;  // garante número para comparar com i.id
  const it = items.find(i => i.id === editingId);
  if (!it) return;

  populateCatSelects();

  document.getElementById('edit-name').value        = it.name;
  document.getElementById('edit-desc').value        = it.desc || '';
  document.getElementById('edit-ingredients').value = (it.ingredients || []).join(', ');
  document.getElementById('edit-price').value       = it.price;
  document.getElementById('edit-price-old').value   = it.priceOld || '';
  document.getElementById('edit-cat').value         = it.catKey;
  document.getElementById('edit-status').value      = it.status;
  document.getElementById('edit-item-type').value   = it.itemType || 'normal';
  togglePizzaOptions('edit');
  const meioel = document.getElementById('edit-meio-meio');
  if (meioel) meioel.classList.toggle('on', !!it.allowHalf);
  // Set max flavors buttons
  const mf = it.maxFlavors || 1;
  document.getElementById('edit-max-flavors').value = mf;
  document.querySelectorAll('#edit-pizza-options .pz-max-btn').forEach(b => {
    b.classList.toggle('on', parseInt(b.dataset.val) === mf);
  });

  // Reset image file state and show existing image
  _editItemImageFile = null;
  const thumb = document.getElementById('edit-img-thumb');
  const placeholder = document.getElementById('edit-img-placeholder');
  const change = document.getElementById('edit-img-change');
  const preview = document.getElementById('edit-img-preview');
  if (it.imageUrl) {
    thumb.src = it.imageUrl; thumb.style.display = 'block';
    placeholder.style.display = 'none';
    change.style.display = 'block';
    preview.style.border = '2px solid var(--accent)';
  } else {
    thumb.src = ''; thumb.style.display = 'none';
    placeholder.style.display = 'flex';
    change.style.display = 'none';
    preview.style.border = '2px dashed var(--border)';
  }

  const _desel = document.getElementById('edit-destaque');
  if (_desel) _desel.classList.toggle('on', !!it.destaque);
  renderGrupos('edit', it.customGroups || []);

  openModal('modal-edit-item');
}

function selectEditEmoji(el, emoji) {
  document.querySelectorAll('#edit-emoji-grid .emo-btn').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  const prev = document.getElementById('edit-emoji-current');
  if (prev) prev.textContent = emoji;
}

async function saveEditItem() {
  console.log('[EDIT-ITEM] saveEditItem chamado | editingId:', editingId);
  const it = items.find(i => i.id === editingId);
  if (!it) { sbToast('err', 'Item não encontrado'); return; }

  const novoNome = document.getElementById('edit-name').value.trim();
  if (!novoNome) { sbToast('err', 'Informe o nome do item'); return; }

  it.name        = novoNome;
  it.desc        = document.getElementById('edit-desc').value.trim();
  it.price       = parseFloat(document.getElementById('edit-price').value) || it.price;
  it.priceOld    = parseFloat(document.getElementById('edit-price-old').value) || null;
  const catEl    = document.getElementById('edit-cat');
  it.catKey      = catEl ? catEl.value : it.catKey;
  it.cat         = catEl ? (catEl.options[catEl.selectedIndex]?.text || it.catKey) : it.catKey;
  it.status      = document.getElementById('edit-status')?.value || it.status;
  const ingrRaw  = document.getElementById('edit-ingredients').value;
  it.ingredients = ingrRaw ? ingrRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  it.itemType    = document.getElementById('edit-item-type')?.value || 'normal';
  const meioEl   = document.getElementById('edit-meio-meio');
  it.allowHalf   = it.itemType === 'pizza' && meioEl && meioEl.classList.contains('on');
  it.maxFlavors  = it.itemType === 'pizza' ? (parseInt(document.getElementById('edit-max-flavors')?.value) || 1) : 1;
  it.destaque    = document.getElementById('edit-destaque')?.classList.contains('on') || false;
  it.customGroups = readGrupos('edit');

  const selEmo = document.querySelector('#edit-emoji-grid .emo-btn.on');
  if (selEmo && selEmo.textContent.trim()) it.emoji = selEmo.textContent.trim();

  sbLoading(true);
  const updatePayload = {
    name:         it.name,
    description:  it.desc,
    price:        it.price,
    price_old:    it.priceOld || null,
    cat:          it.cat,
    cat_key:      it.catKey,
    status:       it.status,
    emoji:        it.emoji,
    ingredients:  it.ingredients,
    item_type:    it.itemType,
    allow_half:   it.allowHalf,
    max_flavors:  it.maxFlavors,
    destaque:     it.destaque,
    promo:        it.destaque,
    custom_groups: it.customGroups
  };
  console.log('[EDIT-ITEM] payload:', updatePayload);
  const { error } = await sb.from('menu_items').update(updatePayload).eq('id', editingId);
  sbLoading(false);
  console.log('[EDIT-ITEM] resposta error:', error);

  if (error) {
    sbToast('err', 'Erro ao atualizar item: ' + (error.message || 'servidor indisponível'));
    console.error('[saveEditItem]', error);
    return;
  }

  // Upload de nova imagem se selecionada
  if (_editItemImageFile) {
    try {
      const url = await uploadItemImage(_editItemImageFile, editingId);
      await sb.from('menu_items').update({ image_url: url }).eq('id', editingId);
      it.imageUrl = url;
    } catch(e) { sbToast('err', 'Item salvo, mas erro ao enviar foto'); }
    _editItemImageFile = null;
  }

  closeModal('modal-edit-item');
  renderTable(); renderGestor(); renderPDV();
  sbToast('ok', `"${it.name}" atualizado!`);
}

async function deleteItem() {
  const it = items.find(i => i.id === editingId);
  if (!it) { sbToast('err', 'Item não encontrado'); return; }
  const name = it.name;
  if (!await showConfirmDialog(`Excluir "${name}"?`, 'Esta ação não pode ser desfeita.')) return;
  sbLoading(true);
  const { error } = await sb.from('menu_items').delete().eq('id', editingId);
  sbLoading(false);
  if (error) {
    sbToast('err', 'Erro ao excluir item: ' + (error.message || 'servidor indisponível'));
    console.error('[deleteItem]', error);
    return;
  }
  items = items.filter(i => i.id !== editingId);
  closeModal('modal-edit-item');
  renderTable(); renderGestor(); renderPDV();
  sbToast('ok', `"${name}" removido do cardápio!`);
}

function showConfirmDialog(title, msg) {
  return new Promise(resolve => {
    let el = document.getElementById('confirm-dialog');
    if (!el) {
      el = document.createElement('div');
      el.id = 'confirm-dialog';
      el.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:9998;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
      el.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px 24px;max-width:360px;width:90%;text-align:center">
        <div id="cd-title" style="font-family:'Playfair Display',sans-serif;font-size:16px;font-weight:800;margin-bottom:8px"></div>
        <div id="cd-msg" style="font-size:12.5px;color:var(--muted);margin-bottom:22px;line-height:1.5"></div>
        <div style="display:flex;gap:10px">
          <button id="cd-cancel" style="flex:1;padding:10px;border-radius:8px;background:var(--surface2);border:1px solid var(--border);color:var(--text);font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer">Cancelar</button>
          <button id="cd-ok" style="flex:1;padding:10px;border-radius:8px;background:var(--danger);border:none;color:#fff;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer">🗑 Excluir</button>
        </div>
      </div>`;
      document.body.appendChild(el);
    }
    document.getElementById('cd-title').textContent = title;
    document.getElementById('cd-msg').textContent   = msg;
    el.style.display = 'flex';
    const close = (val) => { el.style.display = 'none'; resolve(val); };
    document.getElementById('cd-ok').onclick     = () => close(true);
    document.getElementById('cd-cancel').onclick  = () => close(false);
    el.onclick = (e) => { if (e.target === el) close(false); };
  });
}

function applyBulk(){
  const checked=[...document.querySelectorAll('.row-cb:checked')];
  const rows=document.querySelectorAll('#table-body tr');
  const data=getFiltered();
  const st=document.getElementById('bulk-status').value;
  const pct=parseFloat(document.getElementById('bulk-pct').value)||0;
  checked.forEach(cb=>{
    const row=cb.closest('tr');
    const idx=[...rows].indexOf(row);
    if(idx>=0&&data[idx]){
      if(st) data[idx].status=st;
      if(pct) data[idx].price=Math.max(0,data[idx].price*(1+pct/100));
    }
  });
  closeModal('modal-bulk');
  renderTable();
  showToast('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M3 8l3.5 3.5L13 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',`Ação aplicada em ${checked.length} item(s)!`);
}

// ─────────────────────────────────────────
// IMAGENS
// ─────────────────────────────────────────
function renderImagens() {
  const g = document.getElementById('img-grid');
  if (!g) return;
  g.innerHTML = items.map(i => `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:all .2s"
         onmouseenter="this.style.borderColor='var(--accent)'"
         onmouseleave="this.style.borderColor='var(--border)'">
      <div style="height:110px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:48px;border-bottom:1px solid var(--border);position:relative;overflow:hidden">
        ${i.imageUrl
          ? `<img src="${i.imageUrl}" style="width:100%;height:100%;object-fit:cover">`
          : `<div>${i.emoji}</div>`}
      </div>
      <div style="padding:10px">
        <div style="font-weight:600;font-size:12.5px">${i.name}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:1px">${i.cat}</div>
        <button class="btn bg" style="width:100%;justify-content:center;font-size:11px;margin-top:7px;padding:4px"
          onclick="event.stopPropagation();triggerImageUpload(${i.id},'${i.name.replace(/'/g,'')}')">
          ${_ICON_IMG} ${i.imageUrl ? 'Alterar foto' : 'Adicionar foto'}
        </button>
      </div>
    </div>`).join('');
}

// ─────────────────────────────────────────
// POTENCIALIZADOR
// ─────────────────────────────────────────
function renderPotencializador(){
  const el=document.getElementById('pot-items');
  if(!el) return;
  el.innerHTML=items.filter(i=>i.status==='active').slice(0,5).map((i,idx)=>`
    <div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--surface2);border:1px solid var(--border);border-radius:9px">
      <div style="font-size:26px">${i.emoji}</div>
      <div style="flex:1"><div style="font-weight:600;font-size:13px">${i.name}</div><div style="font-size:11.5px;color:var(--muted);margin-top:2px">R$ ${i.price.toFixed(2).replace('.',',')} • ${i.cat}</div></div>
      <div style="font-size:12px;color:var(--accent3)">★ ${(4.2+idx*0.1).toFixed(1)}</div>
      <button class="btn bp" style="font-size:11px;padding:4px 9px" data-n="${i.name.replace(/"/g,'&quot;')}" onclick="sbToast('ok',this.dataset.n+' em destaque!')">Destacar</button>
    </div>`).join('');
}

// ─────────────────────────────────────────
// PDV
// ─────────────────────────────────────────
function renderPDV(){
  const g=document.getElementById('pdv-grid');
  if(!g) return;
  const q=(document.getElementById('pdv-search-input')||{}).value||'';
  const fil=items.filter(i=>i.status==='active'&&i.name.toLowerCase().includes(q.toLowerCase()));
  g.innerHTML=fil.map(i=>`
    <div class="pdv-item${i.itemType==='pizza'?' pdv-item-pizza':''}" onclick="${i.itemType==='pizza'?'openPDVPizza('+i.id+')':'addToCart('+i.id+')'}">
      <div class="pdv-emoji">${i.emoji||'🍽️'}</div>
      <div class="pdv-name">${i.name}${i.itemType==='pizza'?' <span style="font-size:9px;background:rgba(245,158,11,.15);color:var(--accent3);border-radius:4px;padding:1px 4px;font-weight:700">PIZZA</span>':''}</div>
      <div class="pdv-price">R$ ${i.price.toFixed(2).replace('.',',')}</div>
    </div>`).join('');
}

function addToCart(id){
  const it=items.find(i=>i.id===id);
  if(!it) return;
  if(it.itemType==='pizza'){ openPDVPizza(id); return; }
  const ci=cartItems.find(c=>c.id===id);
  if(ci) ci.qty++;
  else cartItems.push({...it,qty:1});
  renderCart();
  showToast('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M8 2a5 5 0 0 1 5 5v3l1 2H2l1-2V7a5 5 0 0 1 5-5z" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1.4"/></svg>',`${it.name} adicionado!`);
}

function renderCart(){
  const c=document.getElementById('cart-items');
  const tot=cartItems.reduce((s,i)=>s+i.price*i.qty,0);
  document.getElementById('cart-total').textContent='R$ '+tot.toFixed(2).replace('.',',');
  document.getElementById('cart-qty').textContent=`(${cartItems.reduce((s,i)=>s+i.qty,0)} itens)`;
  if(!c) return;
  if(cartItems.length===0){c.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:12.5px">Carrinho vazio<br>Clique nos itens para adicionar</div>';return;}
  c.innerHTML=cartItems.map((i,idx)=>`
    <div class="cart-item">
      <div class="ci-emoji">${i.emoji}</div>
      <div class="ci-info"><div class="ci-name">${i.name}</div><div class="ci-price">R$ ${(i.price*i.qty).toFixed(2).replace('.',',')}</div></div>
      <div class="qty-ctrl">
        <div class="qb" onclick="changeQty(${idx},-1)">−</div>
        <div class="qn">${i.qty}</div>
        <div class="qb" onclick="changeQty(${idx},1)">+</div>
      </div>
    </div>`).join('');
}

function changeQty(idx,delta){
  cartItems[idx].qty+=delta;
  if(cartItems[idx].qty<=0) cartItems.splice(idx,1);
  renderCart();
}

function clearCart(){cartItems=[];renderCart();}

async function finalizeSale() {
  const _ICON_WRN = _ICON_ERR;
  if (cartItems.length === 0) { sbToast('err','Carrinho vazio!'); return; }
  const tot  = cartItems.reduce((s,i) => s+i.price*i.qty, 0);
  const pay  = document.getElementById('pay-method').value;
  const time = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  const { data, error } = await sb.from('movimentos').insert({
    description: 'PDV – Balcão', tipo:'entrada', val:tot, pag:pay, time
  }).select().single();
  if (!error && data) movimentos.push({
    id:data.id, desc:'PDV – Balcão', tipo:'entrada', val:tot, pag:pay, time
  });
  playOrderSound();
  sbToast('ok',`Venda R$${tot.toFixed(2).replace('.',',')} finalizada!`);
  cartItems = []; renderCart();
}

// ─────────────────────────────────────────
// CHATBOT
// ─────────────────────────────────────────
function initChat(){
  if(chatInitialized) return;
  chatInitialized=true;
  addMsg('bot','Olá! Bem-vindo ao Estima Food!\n\nDigite: *cardapio*, *taxa*, *horario*, *pix*, *pedido*');
}

function addMsg(type,text){
  const msgs=document.getElementById('chat-msgs');
  if(!msgs) return;
  const div=document.createElement('div');
  div.className='msg '+type;
  div.style.whiteSpace='pre-wrap';
  div.textContent=text;
  msgs.appendChild(div);
  msgs.scrollTop=msgs.scrollHeight;
}

function sendChat(){
  const inp=document.getElementById('chat-in');
  const val=inp.value.trim();
  if(!val) return;
  addMsg('user',val);
  inp.value='';
  const msgs=document.getElementById('chat-msgs');
  const typing=document.createElement('div');
  typing.className='msg typing';
  typing.innerHTML='<div class="dots"><span></span><span></span><span></span></div>';
  msgs.appendChild(typing);
  msgs.scrollTop=msgs.scrollHeight;
  setTimeout(()=>{
    typing.remove();
    const lower=val.toLowerCase();
    let resp=null;
    for(const k of Object.keys(BOT_ANSWERS)){if(lower.includes(k)){resp=BOT_ANSWERS[k];break;}}
    if(!resp){
      const taxa=document.getElementById('taxa-input');
      resp=`Entendi! Recebemos: "${val}"\nTaxa de entrega: R$ ${taxa?taxa.value:'5,00'}. Como posso ajudar?`;
    }
    addMsg('bot',resp);
  },800+Math.random()*600);
}

function clearChat(){
  const m=document.getElementById('chat-msgs');
  if(m) m.innerHTML='';
  chatInitialized=false;
  initChat();
}

// ─────────────────────────────────────────
// QR CODE
// ─────────────────────────────────────────
function renderQR(){
  const g=document.getElementById('qr-grid');
  if(!g) return;
  document.getElementById('qr-free-cnt').textContent=tables.filter(t=>t.status==='free').length;
  document.getElementById('qr-busy-cnt').textContent=tables.filter(t=>t.status==='busy').length;
  document.getElementById('qr-wait-cnt').textContent=tables.filter(t=>t.status==='waiting').length;
  document.getElementById('qr-total-cnt').textContent=tables.length;
  g.innerHTML=tables.map(t=>{
    const sc=t.status==='free'?'qr-free':t.status==='busy'?'qr-busy':'qr-waiting';
    const sl=t.status==='free'?'Livre':t.status==='busy'?'Ocupada':'Aguardando';
    return`<div class="qr-table" onclick="openMesa(${t.num})">
      <div class="qr-num">Mesa ${t.num}</div>
      <div class="qr-status ${sc}">${sl}</div>
      <div class="qr-code"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="1" width="8" height="14" rx="1.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="12" r=".8" fill="currentColor"/></svg></div>
      ${t.guests?`<div style="font-size:11px;color:var(--muted)">${t.guests} pessoas • ${t.total}</div>`:'<div style="font-size:11px;color:var(--muted)">Escanear para pedir</div>'}
      <button class="btn bg" style="width:100%;justify-content:center;font-size:10.5px;margin-top:7px;padding:4px" onclick="event.stopPropagation();toggleMesaStatus(${t.num})">${t.status==='free'?'<svg width="10" height="10" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="5" fill="var(--danger)" opacity=".9"/></svg> Ocupar':'<svg width="10" height="10" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="5" fill="var(--accent3)" opacity=".9"/></svg> Liberar'}</button>
      <div style="display:flex;gap:5px;margin-top:5px">
        <button class="btn bg" style="flex:1;justify-content:center;font-size:10.5px;padding:4px;gap:4px" onclick="event.stopPropagation();openEditMesa(${t.num})">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-9 9H2v-3L11 2z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Editar
        </button>
        <button class="btn bd" style="flex:1;justify-content:center;font-size:10.5px;padding:4px;gap:4px" onclick="event.stopPropagation();qrDeleteMesa(${t.num})">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2.5A.5.5 0 0 1 6.5 2h3a.5.5 0 0 1 .5.5V4M5 4l.7 9.5a.5.5 0 0 0 .5.5h3.6a.5.5 0 0 0 .5-.5L11 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          Excluir
        </button>
      </div>
    </div>`;
  }).join('');
}

function openMesa(num){
  document.getElementById('modal-mesa-num').textContent=num;
  document.getElementById('modal-mesa-link').textContent=num;
  openModal('modal-mesa');
}

async function toggleMesaStatus(num) {
  const t = tables.find(x => x.num === num);
  if (!t) return;
  const newStatus = t.status === 'free' ? 'busy' : 'free';
  const newGuests = newStatus === 'busy' ? 2 : null;
  const { error } = await sb.from('mesas')
    .update({ status: newStatus, guests: newGuests, total: null, updated_at: new Date().toISOString() })
    .eq('num', num);
  if (!error) { t.status = newStatus; t.guests = newGuests; t.total = null; }
  renderQR();
}

async function addTable() {
  const num = tables.length ? Math.max(...tables.map(t=>t.num)) + 1 : 1;
  sbLoading(true);
  const { data, error } = await sb.from('mesas').insert({
    num, status: 'free'
  }).select().single();
  sbLoading(false);
  if (error) { sbToast('err','Erro ao criar mesa'); return; }
  tables.push({ num, status:'free', guests:null, total:null });
  renderQR();
  sbToast('ok',`Mesa ${num} criada!`);
}

function openModalNovaMesa() {
  const next = tables.length ? Math.max(...tables.map(t=>t.num)) + 1 : 1;
  document.getElementById('nova-mesa-num').value = next;
  document.getElementById('nova-mesa-guests').value = '';
  openModal('modal-nova-mesa');
}

async function saveNovaMesa() {
  const num    = parseInt(document.getElementById('nova-mesa-num').value);
  const guests = parseInt(document.getElementById('nova-mesa-guests').value) || null;
  if (!num || num < 1) { sbToast('err','Informe o número da mesa'); return; }
  if (tables.find(t => t.num === num)) { sbToast('err',`Mesa ${num} já existe`); return; }
  sbLoading(true);
  const { data, error } = await sb.from('mesas').insert({ num, status:'free', guests }).select().single();
  sbLoading(false);
  if (error) { sbToast('err','Erro ao criar mesa'); return; }
  tables.push({ num, status:'free', guests, total:null });
  tables.sort((a,b)=>a.num-b.num);
  closeModal('modal-nova-mesa');
  renderMesasPage();
  renderQR();
  sbToast('ok',`Mesa ${num} criada!`);
}

function openEditMesa(num) {
  const t = tables.find(x => x.num === num);
  if (!t) return;
  document.getElementById('edit-mesa-old-num').value  = num;
  document.getElementById('edit-mesa-num').value      = num;
  document.getElementById('edit-mesa-guests').value   = t.guests || '';
  document.getElementById('modal-edit-mesa-title').textContent = `Mesa ${num}`;
  openModal('modal-edit-mesa');
}

async function saveMesaEdit() {
  const oldNum  = parseInt(document.getElementById('edit-mesa-old-num').value);
  const newNum  = parseInt(document.getElementById('edit-mesa-num').value);
  const guests  = parseInt(document.getElementById('edit-mesa-guests').value) || null;
  if (!newNum || newNum < 1) { sbToast('err','Informe o número da mesa'); return; }
  if (newNum !== oldNum && tables.find(t => t.num === newNum)) { sbToast('err',`Mesa ${newNum} já existe`); return; }
  sbLoading(true);
  const { error } = await sb.from('mesas').update({ num: newNum, guests }).eq('num', oldNum);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao salvar'); return; }
  const t = tables.find(x => x.num === oldNum);
  if (t) { t.num = newNum; t.guests = guests; }
  tables.sort((a,b)=>a.num-b.num);
  closeModal('modal-edit-mesa');
  renderMesasPage();
  renderQR();
  sbToast('ok',`Mesa atualizada!`);
}

async function confirmDeleteMesa() {
  const num = parseInt(document.getElementById('edit-mesa-old-num').value);
  if (!confirm(`Excluir Mesa ${num}? Esta ação não pode ser desfeita.`)) return;
  sbLoading(true);
  const { error } = await sb.from('mesas').delete().eq('num', num);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao excluir'); return; }
  tables = tables.filter(t => t.num !== num);
  closeModal('modal-edit-mesa');
  renderMesasPage();
  renderQR();
  sbToast('ok',`Mesa ${num} excluída!`);
}

async function qrDeleteMesa(num) {
  if (!confirm(`Excluir Mesa ${num}? Esta ação não pode ser desfeita.`)) return;
  sbLoading(true);
  const { error } = await sb.from('mesas').delete().eq('num', num);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao excluir'); return; }
  tables = tables.filter(t => t.num !== num);
  renderMesasPage();
  renderQR();
  sbToast('ok', `Mesa ${num} excluída!`);
}

// MESAS PAGE — pedidos agrupados por mesa
let mesaAutoAccept = false;

function toggleMesaAutoAccept(el) {
  el.classList.toggle('on');
  mesaAutoAccept = el.classList.contains('on');
  sbToast('ok', mesaAutoAccept ? 'Pedidos aceitos automaticamente' : 'Aceite automático desativado');
}

async function renderMesasPage() {
  // Stats
  const livres     = tables.filter(t => t.status === 'free').length;
  const ocupadas   = tables.filter(t => t.status === 'busy').length;
  const aguardando = tables.filter(t => t.status === 'waiting').length;
  const elv = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  elv('pm-stat-livres', livres);
  elv('pm-stat-ocupadas', ocupadas);
  elv('pm-stat-aguardando', aguardando);

  const grid = document.getElementById('pm-mesas-grid');
  if (!grid) return;

  const activeTables = tables.filter(t => t.status !== 'free');
  if (!activeTables.length) {
    grid.innerHTML = '<div style="text-align:center;padding:60px;color:var(--muted);font-size:13px"><div><div style="margin:0 auto 10px;text-align:center"><svg width="40" height="40" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;opacity:.25"><path d="M5 2h6v6a3 3 0 0 1-6 0V2z" stroke="currentColor" stroke-width="1.2"/><path d="M2 2h3M11 2h3M2 5H5M11 5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M8 8v4M5.5 14h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></div><div style="display:none"></div>Nenhuma mesa ocupada no momento</div>';
    return;
  }

  // Busca pedidos ativos de todas as mesas ocupadas
  const { data: orders } = await sb.from('orders')
    .select('*')
    .not('mesa_num', 'is', null)
    .in('status', ['analise', 'producao', 'pronto'])
    .order('id', { ascending: true });

  const allOrders = orders || [];

  // Filtra por sessão usando opened_at (campo dedicado — nunca muda durante a sessão)
  const sessionOrders = allOrders.filter(o => {
    const mesa = activeTables.find(t => t.num === parseInt(o.mesa_num));
    if (!mesa || !mesa.opened_at) return true;
    return new Date(o.created_at || 0).getTime() >= new Date(mesa.opened_at).getTime() - 5000;
  });

  // Popula o cache local com os dados da sessão atual (já filtrados)
  mesaOrdersCache = sessionOrders;

  // Usa renderização inteligente (sem piscar)
  _renderMesaPageFromCache();
}

function renderMesaCard(t, orders) {
  const isWaiting = t.status === 'waiting';
  const total = orders.reduce((s, o) => s + parseFloat(o.total || 0), 0);

  const bordColor = isWaiting ? 'rgba(245,158,11,.4)' : 'rgba(59,130,246,.25)';
  const statusLabel = isWaiting
    ? '<span style="font-size:11px;font-weight:700;color:var(--accent3)">⏳ Aguardando pagamento</span>'
    : '<span style="font-size:11px;font-weight:700;color:var(--accent)">🔵 Ocupada</span>';

  const ordersHtml = orders.length
    ? orders.map(o => {
        const items = Array.isArray(o.items) ? o.items : [];
        const itemStr = items.map(i => `${i.drink ? '🥤' : '🍴'} ${i.qty}× ${i.name}`).join('  ');
        const isNew  = o.status === 'analise';
        const isProd = o.status === 'producao';
        const isRdy  = o.status === 'pronto';
        const stColor = isNew ? 'var(--orange)' : isProd ? 'var(--accent)' : 'var(--success)';
        const stLabel = isNew ? '🆕 Novo' : isProd ? '🍳 Preparando' : '✅ Pronto';

        let btns = '';
        if (isNew) {
          btns = `<div style="display:flex;gap:5px;margin-top:7px">
            <button class="oc-btn oc-btn-ok" onclick="mesaAdvanceOrder(${o.id})">✔ Confirmar</button>
            <button class="oc-btn oc-btn-no" onclick="mesaCancelOrder(${o.id})">✕ Cancelar</button>
          </div>`;
        } else if (isProd || isRdy) {
          btns = `<div style="margin-top:7px">
            <button class="oc-btn oc-btn-ok" style="width:100%" onclick="mesaServOrder(${o.id})">✓ Entregue</button>
          </div>`;
        }

        return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:10px 12px;margin-bottom:7px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <span style="font-size:10.5px;font-weight:700;color:${stColor};background:${stColor}1a;padding:2px 8px;border-radius:99px">${stLabel}</span>
            <span style="font-size:10.5px;color:var(--muted)">#${o.num} · ${o.time || ''}</span>
          </div>
          <div style="font-size:12.5px;color:var(--text);line-height:1.6">${itemStr}</div>
          <div style="font-size:12px;font-weight:700;color:var(--accent3);text-align:right;margin-top:4px">R$ ${(parseFloat(o.total) || 0).toFixed(2).replace('.', ',')}</div>
          ${btns}
        </div>`;
      }).join('')
    : isWaiting
      // Mesa aguardando pagamento: busca resumo do consumo do cache ou banco
      ? (function() {
          // Tenta montar resumo dos pedidos entregues desta sessão
          const sessionStart = t.opened_at ? new Date(t.opened_at).getTime() - 5000 : 0;
          const allSessionOrders = mesaOrdersCache.filter(o =>
            parseInt(o.mesa_num) === parseInt(t.num) &&
            new Date(o.created_at || 0).getTime() >= sessionStart
          );
          if (!allSessionOrders.length) {
            return `<div style="color:var(--muted);font-size:12.5px;text-align:center;padding:10px 0">Consumo registrado — clique em registrar para detalhes</div>`;
          }
          // Monta lista consolidada de todos os itens
          const itemMap = {};
          allSessionOrders.forEach(o => {
            (Array.isArray(o.items) ? o.items : []).forEach(i => {
              const key = i.name;
              if (!itemMap[key]) itemMap[key] = { name:i.name, qty:0, total:0, drink:!!i.drink };
              itemMap[key].qty += (i.qty||1);
              itemMap[key].total += (i.price||0) * (i.qty||1);
            });
          });
          const rows = Object.values(itemMap).map(i =>
            `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04)">
              <span>${i.drink?'🥤':'🍴'} ${i.qty}× ${i.name}</span>
              <span style="color:var(--accent3);font-weight:600">R$ ${i.total.toFixed(2).replace('.',',')}</span>
            </div>`
          ).join('');
          return `<div style="background:var(--surface2);border:1px solid rgba(245,158,11,.2);border-radius:9px;padding:10px 12px;margin-bottom:4px">
            <div style="font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px">📋 Resumo do consumo</div>
            ${rows}
          </div>`;
        })()
      : `<div style="color:var(--muted);font-size:12.5px;text-align:center;padding:14px 0">Nenhum pedido ativo</div>`;

  // Se mesa está waiting, usa t.total gravado pelo garçom/fecharMesa
  // Se mesa está busy, usa total do cache atual
  let displayTotal = total; // padrão: soma do cache
  if (isWaiting && t.total) {
    // total pode vir como número (novo) ou string 'R$ 99,90' (legado)
    const raw = typeof t.total === 'string'
      ? parseFloat(t.total.replace('R$','').replace(',','.').trim())
      : parseFloat(t.total);
    if (!isNaN(raw) && raw > 0) displayTotal = raw;
  }

  const actionBtn = isWaiting
    ? `<button onclick="openRegistrarPagamento(${t.num}, ${displayTotal.toFixed(2)})" style="width:100%;margin-top:4px;padding:11px;border-radius:9px;border:none;background:linear-gradient(135deg,var(--accent3),#d97706);color:#000;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;cursor:pointer">
        💰 Registrar pagamento — R$ ${displayTotal.toFixed(2).replace('.', ',')}
      </button>`
    : `<div style="display:flex;gap:8px;margin-top:8px">
        <button onclick="openGarcomMesa(${t.num})" class="btn bp" style="flex:1;justify-content:center;font-size:12px">➕ Lançar pedido</button>
        <button onclick="fecharMesa(${t.num})" style="flex:1;padding:7px;border-radius:8px;border:none;background:linear-gradient(135deg,var(--accent3),#d97706);color:#000;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer">💰 Fechar mesa</button>
      </div>`;

  return `<div style="background:var(--surface);border:1.5px solid ${bordColor};border-radius:14px;padding:16px;margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="font-family:'Playfair Display',sans-serif;font-size:20px;font-weight:900">Mesa ${t.num}</div>
        ${t.guests ? `<span style="font-size:11.5px;color:var(--muted)">${t.guests} pessoas</span>` : ''}
        ${statusLabel}
        <button onclick="event.stopPropagation();openEditMesa(${t.num})" style="margin-left:4px;background:none;border:1px solid var(--border);border-radius:6px;padding:2px 7px;color:var(--muted);cursor:pointer;font-size:11px;font-family:'DM Sans',sans-serif" title="Editar mesa"></button>
      </div>
      <div style="font-family:'Playfair Display',sans-serif;font-size:20px;font-weight:900;color:var(--accent3)">R$ ${displayTotal.toFixed(2).replace('.', ',')}</div>
    </div>
    ${ordersHtml}
    ${actionBtn}
  </div>`;
}

async function mesaAdvanceOrder(id) {
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'producao', tenant_id: _sessao?.tenant_id })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Erro');
    const o  = ordersKanban.find(x => x.id === id);
    const co = mesaOrdersCache.find(x => x.id === id);
    if (o)  o.status  = 'producao';
    if (co) co.status = 'producao';
    _renderMesaPageFromCache();
  } catch(e) { sbToast('err', 'Erro ao atualizar pedido: ' + e.message); }
}

async function mesaServOrder(id) {
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'entregue', tenant_id: _sessao?.tenant_id })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Erro');
    // BUG 1 fix: adiciona pontos de fidelidade ao entregar mesa
    const o = ordersKanban.find(x => x.id === id) || mesaOrdersCache.find(x => x.id === id);
    if (o?.phone) _autoAddFidPoints(o.phone, o.total + (o.taxa || 0));
    ordersKanban      = ordersKanban.filter(x => x.id !== id);
    mesaOrdersCache   = mesaOrdersCache.filter(x => x.id !== id);
    renderKanban();
    _renderMesaPageFromCache();
    sbToast('ok', 'Pedido entregue');
  } catch(e) { sbToast('err', 'Erro ao atualizar pedido: ' + e.message); }
}

async function mesaCancelOrder(id) {
  if (!confirm('Cancelar este pedido?')) return;
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'cancelado', tenant_id: _sessao?.tenant_id })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Erro');
    ordersKanban    = ordersKanban.filter(x => x.id !== id);
    mesaOrdersCache = mesaOrdersCache.filter(x => x.id !== id);
    _renderMesaPageFromCache();
    sbToast('ok', 'Pedido cancelado');
  } catch(e) { sbToast('err', 'Erro ao cancelar: ' + e.message); }
}

// ─────────────────────────────────────────
// ─────────────────────────────────────────



// ─────────────────────────────────────────

function renderGestor(){
  try {
    const cl=document.getElementById('cat-list');
    if(!cl) return;
    if(!categories.length){
      cl.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:13px">Nenhuma categoria ainda.<br>Clique em <strong style="color:var(--accent)">Nova categoria</strong> para começar.</div>';
      return;
    }
    cl.innerHTML=categories.map((cat,idx)=>{
      const catItems=items.filter(i=>i.catKey===cat.name||i.cat===cat.name);
      return `
      ${cat.promo?'<div class="cat-promo-banner">promo</div>':''}
      <div class="cat-row" draggable="true" data-cat-id="${cat.id}"
           ondragstart="catDragStart(event,${cat.id})"
           ondragover="catDragOver(event)"
           ondrop="catDrop(event,${cat.id})"
           ondragend="catDragEnd(event)">
        <div class="cat-head" onclick="toggleCat(${cat.id})">
          <span class="cat-drag" onmousedown="event.stopPropagation()" title="Arrastar para reordenar">⠿</span>
          <div>
            <div class="cat-name">${cat.label}</div>
            <span class="cat-badge">${catItems.length} ite${catItems.length===1?'m':'ns'}</span>
          </div>
          <div class="cat-actions">
            <div class="sw"><select onclick="event.stopPropagation()" style="font-size:11.5px;padding:4px 22px 4px 9px" onchange="handleCatAction(${cat.id},this.value)"><option value="">Ações ▾</option><option value="edit">Editar</option><option value="duplicate">Duplicar</option><option value="pause">Pausar</option><option value="delete">Excluir</option></select></div>
            <div class="cat-toggle${cat.open?' open':''}"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          </div>
        </div>
        ${cat.open?`<div class="cat-items">
          ${catItems.map(item=>`
            <div class="cat-item-row" data-id="${item.id}" draggable="true" ondragstart="itemDragStart(event,${item.id})" ondragover="itemDragOver(event)" ondrop="itemDrop(event,${item.id})" ondragend="itemDragEnd(event)" onclick="openEditItem(+this.dataset.id)">
              <span class="cat-drag" style="cursor:grab;padding:0 6px 0 2px;opacity:.35;flex-shrink:0;font-size:16px;align-self:center" onmousedown="event.stopPropagation()" title="Arrastar para reordenar">⠿</span>
              <div class="cat-item-thumb">${item.imageUrl
                ? `<img src="${item.imageUrl}" style="width:36px;height:36px;object-fit:cover;border-radius:6px;display:block">`
                : `<svg viewBox="0 0 24 24" fill="none" width="18" height="18" style="opacity:.35"><path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" stroke="currentColor" stroke-width="1.5"/><path d="M3 16l5-5 3 3 3-4 4 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" opacity=".5"/></svg>`
              }</div>
              <div style="flex:1;min-width:0">
                <div class="cat-item-name">${item.name}${item.promo?' <span class="ptag">promo</span>':''}${item.itemType==='pizza'?' <span style="font-size:9px;background:rgba(245,158,11,.15);color:var(--accent3);border-radius:4px;padding:1px 4px;font-weight:700;margin-left:2px">🍕</span>':''}${item.itemType==='kg'?' <span style="font-size:9px;background:rgba(34,197,94,.15);color:#16a34a;border-radius:4px;padding:1px 4px;font-weight:700;margin-left:2px">KG</span>':''}</div>
                <div class="cat-item-price">R$ ${item.price.toFixed(2).replace('.',',')}${item.itemType==='kg'?'<span style="font-size:10px;color:var(--muted)">/kg</span>':''} · ${item.status==='active'?'<span style="color:var(--success)">Disponível</span>':item.status==='esgotado'?'<span style="color:var(--danger)">Esgotado</span>':'<span style="color:var(--accent3)">Pausado</span>'}</div>
              </div>
              <div style="display:flex;gap:4px;flex-shrink:0">
                <button class="btn bg" style="font-size:10.5px;padding:3px 8px" data-id="${item.id}" onclick="event.stopPropagation();duplicateItem(+this.dataset.id)" title="Duplicar item">⎘</button>
                <button class="btn bg" style="font-size:10.5px;padding:3px 8px" data-id="${item.id}" onclick="event.stopPropagation();openEditItem(+this.dataset.id)">Editar</button>
              </div>
            </div>
          `).join('')}
          <div class="cat-add" data-cat="${cat.name.replace(/"/g,'&quot;')}" onclick="openAddItemModal(this.dataset.cat)">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
            Adicionar Item
          </div>
        </div>`:''}
      </div>`;
    }).join('');
  } catch(e) { console.error('renderGestor error:', e); }
}

function toggleCat(id){
  const cat=categories.find(c=>c.id===id);
  if(cat) cat.open=!cat.open;
  renderGestor();
}

function handleCatAction(id, action) {
  if (!action) return;
  if (action === 'edit') {
    const cat = categories.find(c => c.id === id);
    if (!cat) return;
    document.getElementById('edit-cat-id').value   = id;
    document.getElementById('edit-cat-name').value = cat.label;
    openModal('modal-edit-cat');
  } else if (action === 'duplicate') {
    duplicateCategory(id);
  } else if (action === 'delete') {
    deleteCatById(id);
  } else if (action === 'pause') {
    sbToast('ok', 'Categoria pausada!');
  }
}

// ── Duplicar categoria (cria cópia com todos os itens) ────
async function duplicateCategory(id) {
  const cat = categories.find(c => c.id === id);
  if (!cat) return;
  const novoLabel = cat.label + ' (cópia)';
  const novoName  = cat.name + '_copia_' + Date.now().toString().slice(-4);
  sbLoading(true);
  try {
    // 1. Cria nova categoria
    const { data: newCat, error: catErr } = await sb.from('categories').insert({
      name:       novoName,
      label:      novoLabel,
      type:       cat.type  || 'Itens principais',
      promo:      false,
      sort_order: categories.length + 1
    }).select().single();
    if (catErr || !newCat) throw new Error(catErr?.message || 'Erro ao criar categoria');

    categories.push({ id: newCat.id, name: newCat.name, label: newCat.label, type: newCat.type, promo: false, open: false });

    // 2. Duplica todos os itens desta categoria
    const catItems = items.filter(i => i.catKey === cat.name || i.cat === cat.name);
    let itensCriados = 0;
    for (const it of catItems) {
      const { data: newItem, error: itemErr } = await sb.from('menu_items').insert({
        emoji:        it.emoji        || '🍽️',
        name:         it.name,
        description:  it.desc         || '',
        price:        it.price        || 0,
        price_old:    it.priceOld     || null,
        cat:          newCat.label,
        cat_key:      newCat.name,
        item_type:    it.itemType     || 'normal',
        allow_half:   it.allowHalf    || false,
        max_flavors:  it.maxFlavors   || 1,
        promo:        it.promo        || false,
        destaque:     it.destaque     || false,
        status:       it.status       || 'active',
        days:         it.days         || [1,1,1,1,1,1,1],
        ingredients:  it.ingredients  || [],
        custom_groups: it.customGroups || [],
        image_url:    it.imageUrl     || null
      }).select().single();
      if (!itemErr && newItem) { items.push(mapItem(newItem)); itensCriados++; }
    }

    renderGestor(); renderTable(); populateCatSelects();
    sbToast('ok', `"${novoLabel}" criada com ${itensCriados} item(s) duplicado(s)!`);
  } catch(e) {
    sbToast('err', 'Erro ao duplicar categoria: ' + e.message);
  } finally {
    sbLoading(false);
  }
}

// ── Duplicar item ─────────────────────────────────────────
async function duplicateItem(id) {
  const it = items.find(i => i.id === id);
  if (!it) return;
  sbLoading(true);
  try {
    const { data: newItem, error } = await sb.from('menu_items').insert({
      emoji:        it.emoji        || '🍽️',
      name:         it.name + ' (cópia)',
      description:  it.desc         || '',
      price:        it.price        || 0,
      price_old:    it.priceOld     || null,
      cat:          it.cat,
      cat_key:      it.catKey,
      item_type:    it.itemType     || 'normal',
      allow_half:   it.allowHalf    || false,
      max_flavors:  it.maxFlavors   || 1,
      promo:        false,
      destaque:     false,
      status:       'active',
      days:         it.days         || [1,1,1,1,1,1,1],
      ingredients:  it.ingredients  || [],
      custom_groups: it.customGroups || [],
      image_url:    it.imageUrl     || null
    }).select().single();
    if (error || !newItem) throw new Error(error?.message || 'Resposta inválida');
    items.push(mapItem(newItem));
    renderGestor(); renderTable();
    sbToast('ok', `"${it.name}" duplicado!`);
  } catch(e) {
    sbToast('err', 'Erro ao duplicar item: ' + e.message);
  } finally {
    sbLoading(false);
  }
}

async function saveEditCategory() {
  const id   = parseInt(document.getElementById('edit-cat-id').value);
  const name = document.getElementById('edit-cat-name').value.trim();
  const type = document.getElementById('edit-cat-type').value;
  if (!name) { sbToast('err','Informe o nome'); return; }
  sbLoading(true);
  // Só atualiza 'label' e 'type' — nunca muda 'name' (chave interna usada pelo catKey dos itens)
  const { error } = await sb.from('categories').update({
    label: name, type
  }).eq('id', id);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao salvar'); return; }
  const cat = categories.find(c => c.id === id);
  if (cat) { cat.label = name; cat.type = type; }
  closeModal('modal-edit-cat');
  renderGestor();
  populateCatSelects();
  sbToast('ok', 'Categoria atualizada!');
}

async function deleteCatById(id) {
  const catId = id || parseInt(document.getElementById('edit-cat-id').value);
  if (!await showConfirmDialog('Excluir categoria?', 'Os itens desta categoria não serão apagados.')) return;
  sbLoading(true);
  const { error } = await sb.from('categories').delete().eq('id', catId);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao excluir'); return; }
  categories = categories.filter(c => c.id !== catId);
  closeModal('modal-edit-cat');
  renderGestor();
  populateCatSelects();
  sbToast('ok', 'Categoria excluída!');
}

async function addCategory() {
  const nameEl = document.getElementById('cat-name-input');
  const typeEl = document.getElementById('cat-type-input');
  const name   = nameEl ? nameEl.value.trim() : '';
  const type   = typeEl ? typeEl.value : 'Itens principais';

  console.log('[ADD-CAT] chamado | nome:', name, '| tipo:', type);

  if (!name) { sbToast('err', 'Informe o nome da categoria'); return; }

  const duplicada = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (duplicada) { sbToast('err', `Já existe uma categoria chamada "${name}"`); return; }

  const payload = {
    name:       name.toLowerCase().replace(/\s+/g, '_'),
    label:      name,
    type:       type || 'Itens principais',
    promo:      false,
    sort_order: categories.length + 1
  };
  console.log('[ADD-CAT] payload:', payload);

  sbLoading(true);
  const { data, error } = await sb.from('categories').insert(payload).select().single();
  sbLoading(false);

  console.log('[ADD-CAT] resposta | data:', data, '| error:', error);

  if (error || !data) {
    sbToast('err', 'Erro ao criar categoria: ' + (error?.message || 'resposta inválida'));
    console.error('[ADD-CAT] ❌', error);
    return;
  }

  console.log('[ADD-CAT] ✅ categoria criada id:', data.id);
  categories.push({
    id:    data.id,
    name:  data.name,
    label: data.label || name,
    type:  data.type  || type,
    promo: false,
    open:  false
  });

  closeModal('modal-add-cat');
  if (nameEl) nameEl.value = '';
  renderGestor();
  populateCatSelects();
  sbToast('ok', `Categoria "${name}" criada!`);
}

function handleGestorAction(val){
  document.getElementById('gestor-actions').value='';
  if(val==='pdv') nav('pdv');
  else if(val==='edicao') nav('edicao');
  else if(val==='imagens') nav('imagens');
}

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
  // Mostra opções de pizza APENAS quando tipo = pizza; oculta para normal e kg
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

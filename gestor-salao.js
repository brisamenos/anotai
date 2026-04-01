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
// BUSCA DE CLIENTES CADASTRADOS (compartilhada por PDV, PDV Balcão, Novo Pedido)
// ─────────────────────────────────────────
let _clientesCache = [];
let _clientesCacheTs = 0;

async function _carregarClientesCache() {
  // Recarrega no máximo a cada 60s
  if (_clientesCache.length && Date.now() - _clientesCacheTs < 60000) return _clientesCache;
  try {
    const { data, error } = await sb.from('customers')
      .select('id,name,phone,email,addr')
      .order('name');
    if (!error && data) {
      _clientesCache = data;
      _clientesCacheTs = Date.now();
    }
  } catch(e) { console.error('[clientes-cache]', e); }
  return _clientesCache;
}

// Cria/atualiza dropdown de sugestões de clientes
function _criarDropdownClientes(inputEl, onSelect) {
  let dropdown = inputEl._cliDropdown;
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'cli-autocomplete-dropdown';
    dropdown.style.cssText = 'position:absolute;left:0;right:0;top:100%;background:var(--surface);border:1.5px solid var(--accent);border-radius:10px;max-height:220px;overflow-y:auto;z-index:99999;box-shadow:0 8px 32px rgba(0,0,0,.25);display:none';
    // Posiciona relativo ao input
    const wrap = inputEl.parentElement;
    if (wrap && getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    (wrap || inputEl.parentElement).appendChild(dropdown);
    inputEl._cliDropdown = dropdown;

    // Fecha ao clicar fora
    document.addEventListener('click', e => {
      if (!dropdown.contains(e.target) && e.target !== inputEl) dropdown.style.display = 'none';
    });
  }
  dropdown._onSelect = onSelect;
  return dropdown;
}

async function _filtrarClientes(inputEl, dropdown, query) {
  if (!query || query.length < 2) { dropdown.style.display = 'none'; return; }
  const clientes = await _carregarClientesCache();
  const q = query.toLowerCase();
  const filtrados = clientes.filter(c =>
    (c.name && c.name.toLowerCase().includes(q)) ||
    (c.phone && c.phone.replace(/\D/g,'').includes(q.replace(/\D/g,'')))
  ).slice(0, 8);

  if (!filtrados.length) { dropdown.style.display = 'none'; return; }

  dropdown.innerHTML = filtrados.map(c => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .12s"
         onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''"
         data-id="${c.id}" data-name="${(c.name||'').replace(/"/g,'&quot;')}" data-phone="${(c.phone||'').replace(/"/g,'&quot;')}" data-addr="${(c.addr||'').replace(/"/g,'&quot;')}"
         onclick="(function(el){
           var dd=el.closest('.cli-autocomplete-dropdown');
           if(dd._onSelect) dd._onSelect({id:el.dataset.id,name:el.dataset.name,phone:el.dataset.phone,addr:el.dataset.addr});
           dd.style.display='none';
         })(this)">
      <div style="width:34px;height:34px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0">${(c.name||'?').charAt(0).toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name||'Sem nome'}</div>
        <div style="font-size:11px;color:var(--muted)">${c.phone||''}${c.addr?' · '+c.addr.substring(0,40):''}</div>
      </div>
    </div>`).join('');
  dropdown.style.display = 'block';
}

// Inicializa autocomplete num input. Passa os IDs dos campos a preencher.
function initClienteAutocomplete(inputId, opts) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const dropdown = _criarDropdownClientes(inp, (cliente) => {
    if (opts.nameId)  { const el = document.getElementById(opts.nameId);  if (el) el.value = cliente.name || ''; }
    if (opts.phoneId) { const el = document.getElementById(opts.phoneId); if (el) el.value = cliente.phone || ''; }
    if (opts.addrId && cliente.addr) { const el = document.getElementById(opts.addrId); if (el) el.value = cliente.addr || ''; }
    // Callback extra
    if (opts.onSelect) opts.onSelect(cliente);
  });
  let _debounce;
  inp.addEventListener('input', () => {
    clearTimeout(_debounce);
    _debounce = setTimeout(() => _filtrarClientes(inp, dropdown, inp.value.trim()), 250);
  });
  inp.addEventListener('focus', () => {
    if (inp.value.trim().length >= 2) _filtrarClientes(inp, dropdown, inp.value.trim());
  });
}

// ─────────────────────────────────────────
// PDV
// ─────────────────────────────────────────
function renderPDV(){
  const g=document.getElementById('pdv-grid');
  if(!g) return;
  // Inicializa autocomplete de clientes no PDV
  initClienteAutocomplete('pdv-client', {
    nameId: 'pdv-client',
    phoneId: 'pdv-phone'
  });
  initClienteAutocomplete('pdv-phone', {
    nameId: 'pdv-client',
    phoneId: 'pdv-phone'
  });
  const q=(document.getElementById('pdv-search-input')||{}).value||'';
  const fil=items.filter(i=>i.status==='active'&&i.name.toLowerCase().includes(q.toLowerCase()));
  g.innerHTML=fil.map(i=>{
    const isKg=i.itemType==='kg', isPizza=i.itemType==='pizza';
    const badge=isPizza?'<span style="font-size:9px;background:rgba(245,158,11,.15);color:var(--accent3);border-radius:4px;padding:1px 4px;font-weight:700">PIZZA</span>':isKg?'<span style="font-size:9px;background:rgba(34,197,94,.15);color:#16a34a;border-radius:4px;padding:1px 4px;font-weight:700">KG</span>':'';
    const priceLabel=isKg?`R$ ${i.price.toFixed(2).replace('.',',')} <span style="font-size:9px;opacity:.7">/kg</span>`:`R$ ${i.price.toFixed(2).replace('.',',')}`;
    const click=isPizza?`openPDVPizza(${i.id})`:`addToCart(${i.id})`;
    return `<div class="pdv-item${isPizza?' pdv-item-pizza':''}" onclick="${click}">
      <div class="pdv-emoji">${i.emoji||'🥩'}</div>
      <div class="pdv-name">${i.name} ${badge}</div>
      <div class="pdv-price">${priceLabel}</div>
    </div>`;
  }).join('');
}

function addToCart(id){
  const it = items.find(i => i.id === id);
  if (!it) return;
  if (it.itemType === 'pizza') { window._pdvPizzaSource = 'pdv'; openPDVPizza(id); return; }

  // Verifica grupos de adicionais (igual ao cardápio público)
  const grupos = (()=>{ try{ return Array.isArray(it.custom_groups)?it.custom_groups:JSON.parse(it.custom_groups||'[]') }catch{ return [] } })()
    .filter(g => !['porcao_ref','kit_itens'].includes(g.tipo));
  const isKg = it.itemType === 'kg' || it.item_type === 'kg';

  if (grupos.length > 0 || isKg) {
    _pdvAbrirModalItem(it, grupos, isKg);
    return;
  }
  // Sem adicionais — adiciona direto
  const ci = cartItems.find(c => c.id === id && !c.obs);
  if (ci) ci.qty++;
  else cartItems.push({...it, qty:1, obs:'', _grupos:[]});
  renderCart();
  showToast('🛒', `${it.name} adicionado!`);
}

function _pdvAbrirModalItem(it, grupos, isKg) {
  document.getElementById('pdv-modal-item-bg')?.remove();
  const priceStr = parseFloat(it.price||0).toFixed(2).replace('.',',');

  const gruposHtml = grupos.map((g, gi) => {
    const opcoes = g.opcoes || g.valores || [];
    if (!opcoes.length) return '';
    const tipo = g.tipo || 'opcional';
    const isSingle = ['radio','cortes','preparos','ocasiao','armazenamento','pesos','obrigatorio','sabor'].includes(tipo);
    const isMulti  = !isSingle; // checkbox, opcional, adicionais, checklist
    const isReq   = ['obrigatorio','sabor','cortes'].includes(tipo);

    const _TIPO_LABEL = {
      cortes:'Corte', preparos:'Preparo', ocasiao:'Ocasião',
      armazenamento:'Armazenamento', pesos:'Porção / Peso',
      checklist:'Complementos', radio:'Escolha', checkbox:'Adicional',
      opcional:'Adicional', adicionais:'Adicional',
      obrigatorio:'Escolha obrigatória', sabor:'Sabor',
    };
    const label = g.nome || g.name || _TIPO_LABEL[tipo] || 'Adicional';

    return `<div style="margin-bottom:16px">
      <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px">
        ${label}${isReq?' <span style="color:var(--danger);font-size:10px">*obrigatório</span>':''}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${opcoes.map((op,oi)=>{
          const nome  = op.nome||op.name||(typeof op==='string'?op:'');
          const preco = parseFloat(op.preco||op.price||0);
          const icon  = op.icon?`<span style="font-size:16px">${op.icon}</span>`:'';
          const pLabel = preco>0?` <span style="color:var(--success);font-size:11px">+R$ ${preco.toFixed(2).replace('.',',')}</span>`:'';
          return `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface2);border:1.5px solid var(--border);border-radius:9px;cursor:pointer" onclick="pdvToggleOpc(this)">
            <input type="${isMulti?'checkbox':'radio'}" name="pdv-grp-${gi}" data-grp="${gi}" data-nome="${(nome+'').replace(/"/g,'&quot;')}" data-preco="${preco}" style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0">
            ${icon}<span style="font-size:13px;font-weight:500;flex:1">${nome}${pLabel}</span>
          </label>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');

  const kgHtml = isKg ? `<div style="margin-bottom:16px">
    <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px">Quantidade</div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      ${[0.25,0.5,1,1.5,2,2.5,3].map(v=>`<button onclick="pdvSetKg(${v})" style="padding:7px 12px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer;font-size:13px;font-weight:700;font-family:inherit">${v>=1?(v+'kg'):(v*1000+'g')}</button>`).join('')}
      <input type="number" id="pdv-kg-input" min="0.1" step="0.1" value="1"
        style="width:90px;padding:8px;border:1.5px solid var(--accent);border-radius:8px;background:var(--surface2);color:var(--text);font-size:16px;font-weight:700;text-align:center;outline:none;font-family:inherit"
        oninput="pdvAtualizarTotal()">
      <span style="font-size:13px;color:var(--muted)">kg</span>
    </div>
  </div>` : '';

  const modal = document.createElement('div');
  modal.id = 'pdv-modal-item-bg';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
  modal.onclick = e => { if(e.target===modal) modal.remove(); };
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:20px 20px 0 0;width:100%;max-width:520px;max-height:88vh;overflow-y:auto;padding:20px 20px 32px;box-shadow:0 -8px 40px rgba(0,0,0,.3)">
      <div style="width:40px;height:4px;background:var(--border);border-radius:99px;margin:0 auto 18px"></div>
      <!-- Header do produto -->
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        ${it.image_url
          ? `<img src="${it.image_url}" style="width:60px;height:60px;border-radius:12px;object-fit:cover;flex-shrink:0">`
          : `<div style="width:60px;height:60px;border-radius:12px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0">${it.emoji||'🍽️'}</div>`}
        <div>
          <div style="font-size:16px;font-weight:800">${it.name}</div>
          <div style="font-size:13px;color:var(--success);font-weight:700;margin-top:2px">R$ ${priceStr}${isKg?' /kg':''}</div>
          ${it.desc||it.description?`<div style="font-size:11.5px;color:var(--muted);margin-top:2px">${it.desc||it.description}</div>`:''}
        </div>
      </div>
      ${kgHtml}
      ${gruposHtml}
      <!-- Observação -->
      <div style="margin-bottom:14px">
        <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:6px">Observação</div>
        <textarea id="pdv-obs-input" placeholder="Ex: sem cebola, bem passado..." rows="2"
          style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:9px;background:var(--surface2);color:var(--text);font-size:13px;outline:none;resize:none;font-family:inherit;box-sizing:border-box"></textarea>
      </div>
      <!-- Qtd + total -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <button onclick="pdvModalQty(-1)" style="width:36px;height:36px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface2);cursor:pointer;font-size:18px;font-weight:700">−</button>
        <span id="pdv-modal-qty" style="font-size:18px;font-weight:800;min-width:32px;text-align:center">1</span>
        <button onclick="pdvModalQty(1)"  style="width:36px;height:36px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface2);cursor:pointer;font-size:18px;font-weight:700">+</button>
        <span id="pdv-modal-total" style="font-size:15px;font-weight:800;color:var(--success);margin-left:auto"></span>
      </div>
      <button onclick="_pdvConfirmar(${it.id})"
        style="width:100%;padding:14px;border-radius:14px;border:none;background:var(--accent);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">
        Adicionar ao carrinho
      </button>
    </div>`;
  document.body.appendChild(modal);
  modal._item   = it;
  modal._isKg   = isKg;
  modal._grupos = grupos;
  window._pdvQty = 1;
  pdvAtualizarTotal();
}

function pdvToggleOpc(label) {
  const inp = label.querySelector('input');
  if (!inp) return;
  if (inp.type === 'radio') {
    document.querySelectorAll(`input[name="${inp.name}"]`).forEach(r => {
      r.closest('label').style.borderColor = 'var(--border)';
      r.closest('label').style.background  = 'var(--surface2)';
    });
    label.style.borderColor = 'var(--accent)';
    label.style.background  = 'rgba(var(--accent-rgb,249,115,22),.08)';
  } else {
    label.style.borderColor = inp.checked ? 'var(--accent)' : 'var(--border)';
    label.style.background  = inp.checked ? 'rgba(var(--accent-rgb,249,115,22),.08)' : 'var(--surface2)';
  }
  pdvAtualizarTotal();
}

function pdvSetKg(v) {
  const inp = document.getElementById('pdv-kg-input');
  if (inp) { inp.value = v; pdvAtualizarTotal(); }
}

function pdvModalQty(d) {
  window._pdvQty = Math.max(1, (window._pdvQty||1) + d);
  const el = document.getElementById('pdv-modal-qty');
  if (el) el.textContent = window._pdvQty;
  pdvAtualizarTotal();
}

function pdvAtualizarTotal() {
  const modal = document.getElementById('pdv-modal-item-bg');
  if (!modal?._item) return;
  const it    = modal._item;
  const isKg  = modal._isKg;
  const qty   = window._pdvQty || 1;
  let extra   = 0;
  document.querySelectorAll('#pdv-modal-item-bg input:checked').forEach(inp => {
    extra += parseFloat(inp.dataset.preco||0);
  });
  let price = parseFloat(it.price||0) + extra;
  if (isKg) {
    const kg = parseFloat(document.getElementById('pdv-kg-input')?.value||1);
    price    = price * kg;
  }
  const total = price * qty;
  const el = document.getElementById('pdv-modal-total');
  if (el) el.textContent = 'R$ ' + total.toFixed(2).replace('.',',');
}

function _pdvConfirmar(itemId) {
  const modal = document.getElementById('pdv-modal-item-bg');
  if (!modal) return;
  const it    = modal._item;
  const isKg  = modal._isKg;
  const qty   = window._pdvQty || 1;
  let extra   = 0;
  const opcs  = [];
  document.querySelectorAll('#pdv-modal-item-bg input:checked').forEach(inp => {
    extra += parseFloat(inp.dataset.preco||0);
    opcs.push(inp.dataset.nome);
  });
  const obs  = [opcs.join(', '), document.getElementById('pdv-obs-input')?.value.trim()].filter(Boolean).join(' | ');
  let price  = parseFloat(it.price||0) + extra;
  let name   = it.name;
  if (isKg) {
    const kg  = parseFloat(document.getElementById('pdv-kg-input')?.value||1);
    price     = price * kg;
    const lbl = kg >= 1 ? kg.toFixed(1).replace('.',',')+'kg' : (kg*1000).toFixed(0)+'g';
    name      = `${it.name} (${lbl})`;
    cartItems.push({...it, name, qty:1, price, obs, isKg:true, _pesoLabel:lbl, _grupos:opcs});
  } else {
    const ci = cartItems.find(c => c.id === it.id && c.obs === obs);
    if (ci) ci.qty += qty;
    else cartItems.push({...it, name, qty, price, obs, _grupos:opcs});
  }
  renderCart();
  modal.remove();
  showToast('🛒', `${name} adicionado!`);
}

function renderCart(){
  const c=document.getElementById('cart-items');
  const tot=cartItems.reduce((s,i)=>s+parseFloat((i.price*i.qty).toFixed(2)),0);
  document.getElementById('cart-total').textContent='R$ '+tot.toFixed(2).replace('.',',');
  document.getElementById('cart-qty').textContent=`(${cartItems.reduce((s,i)=>s+(i.isKg?1:i.qty),0)} itens)`;
  if(!c) return;
  if(cartItems.length===0){c.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:12.5px">Carrinho vazio<br>Clique nos itens para adicionar</div>';return;}
  c.innerHTML=cartItems.map((i,idx)=>`
    <div class="cart-item">
      <div class="ci-emoji">${i.emoji||'🍽️'}</div>
      <div class="ci-info">
        <div class="ci-name">${i.name}</div>
        ${i.obs ? `<div style="font-size:10.5px;color:var(--muted);margin-top:1px">${i.obs}</div>` : ''}
        <div class="ci-price">R$ ${(i.price*i.qty).toFixed(2).replace('.',',')}</div>
      </div>
      <div class="qty-ctrl">
        ${i.isKg
          ?`<div class="qb" onclick="changeQty(${idx},-1)" title="Remover">🗑</div>`
          :`<div class="qb" onclick="changeQty(${idx},-1)">−</div><div class="qn">${i.qty}</div><div class="qb" onclick="changeQty(${idx},1)">+</div>`}
      </div>
    </div>`).join('');
}

function _editarPesoCart(idx){
  const ci=cartItems[idx]; if(!ci||!ci.isKg) return;
  const novo=parseFloat(prompt(`Novo peso para "${ci.name}" (kg):`,ci.qty.toFixed(3)));
  if(isNaN(novo)||novo<=0){ sbToast('err','Peso inválido'); return; }
  ci.qty=novo; ci._pesoLabel=novo.toFixed(3).replace('.',',')+'kg';
  renderCart();
}

function changeQty(idx,delta){
  if(cartItems[idx]?.isKg){ cartItems.splice(idx,1); renderCart(); return; }
  cartItems[idx].qty+=delta;
  if(cartItems[idx].qty<=0) cartItems.splice(idx,1);
  renderCart();
}

function clearCart(){cartItems=[];renderCart();const c=document.getElementById('pdv-client'),p=document.getElementById('pdv-phone');if(c)c.value='';if(p)p.value='';}

async function finalizeSale() {
  if (window._pdvFinalizando) return;
  window._pdvFinalizando = true;
  const _ICON_WRN = _ICON_ERR;
  if (cartItems.length === 0) { window._pdvFinalizando = false; sbToast('err','Carrinho vazio!'); return; }
  const tot  = cartItems.reduce((s,i) => s+parseFloat((i.price*i.qty).toFixed(2)), 0);
  const pay  = document.getElementById('pay-method').value;
  const time = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  const pdvClient = (document.getElementById('pdv-client')?.value||'').trim();
  const pdvPhone  = (document.getElementById('pdv-phone')?.value||'').trim();
  let descricao = pdvClient ? `PDV – ${pdvClient}` : 'PDV – Balcão';
  if (window._segmento === 'acougue') {
    const resumo = cartItems.map(i=>i.isKg?`${i._pesoLabel} ${i.name}`:`${i.qty}x ${i.name}`).join(', ');
    descricao = `Atendimento – ${resumo.slice(0,80)}${resumo.length>80?'…':''}`;
  }
  try {
    const { data, error } = await sb.from('movimentos').insert({
      description: descricao, tipo:'entrada', val:parseFloat(tot.toFixed(2)), pag:pay, time
    }).select().single();
    if (!error && data) movimentos.push({
      id:data.id, desc:descricao, tipo:'entrada', val:parseFloat(tot.toFixed(2)), pag:pay, time
    });
    playOrderSound();
    sbToast('ok',`Venda R$${tot.toFixed(2).replace('.',',')} finalizada!`);
    cartItems = []; renderCart();
  } finally {
    window._pdvFinalizando = false;
  }
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
// CUPONS
// ─────────────────────────────────────────
function renderCupons(){
  const el=document.getElementById('cupom-list');
  if(!el) return;
  document.getElementById('cupom-count').textContent=cupons.filter(c=>c.ativo).length;
  el.innerHTML=cupons.map((c,i)=>`
    <div class="coupon-card">
      <div class="coupon-icon" style="background:${c.ativo?'rgba(34,197,94,.12)':'rgba(100,116,139,.1)'}"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><path d="M2 6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1a2 2 0 0 0 0 4v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-1a2 2 0 0 0 0-4V6z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 4v2M10 10v2" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div style="flex:1">
        <div class="coupon-code">${c.code}</div>
        <div class="coupon-desc">${c.tipo==='%'?c.val+'% de desconto':c.tipo==='frete'?'Frete grátis':'Desconto R$'+c.val}</div>
        <div class="coupon-use">Usado ${c.usos}x • ${c.minimo>0?'Pedido mín. R$'+c.minimo:'Sem pedido mínimo'}</div>
      </div>
      <span class="chip ${c.ativo?'chip-green':'chip-red'}">${c.ativo?'● Ativo':'● Inativo'}</span>
      <button class="btn bg" style="font-size:11px;padding:3px 8px" onclick="toggleCupom(${i})">${c.ativo?'Pausar':'Ativar'}</button>
      <button class="btn bd" style="font-size:11px;padding:3px 8px" onclick="deleteCupom(${i})"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><path d="M3 4h10M6 4V2.5A.5.5 0 0 1 6.5 2h3a.5.5 0 0 1 .5.5V4M5 4l.7 9.5a.5.5 0 0 0 .5.5h3.6a.5.5 0 0 0 .5-.5L11 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div>`).join('');
}

function toggleCupom(i){cupons[i].ativo=!cupons[i].ativo;renderCupons();sbToast('ok',`Cupom ${cupons[i].code} ${cupons[i].ativo?'ativado':'pausado'}!`);}
async function deleteCupom(idx) {
  const c = cupons[idx];
  if (!c) return;
  const { error } = await sb.from('cupons').delete().eq('id', c.id);
  if (!error) cupons.splice(idx, 1);
  renderCupons();
  showToast(_ICON_TRS,'Cupom removido');
}
async function addCupom() {
  const code = (document.getElementById('cupom-code').value||'').toUpperCase().trim();
  const val  = parseFloat(document.getElementById('cupom-val').value) || 0;
  const tipo = document.getElementById('cupom-tipo').value.includes('%') ? '%' : 'frete';
  if (!code) { sbToast('err','Informe o código'); return; }
  sbLoading(true);
  const { data, error } = await sb.from('cupons').insert({
    code, type: tipo === '%' ? 'percent' : 'fixed', value: val, min_order: 0, uses_left: -1, ativo: true
  }).select().single();
  sbLoading(false);
  if (error) { sbToast('err', error.code==='23505'?'Código já existe':'Erro ao criar cupom'); return; }
  cupons.push({id:data.id,code,tipo,val,minimo:0,usos:0,ativo:true});
  closeModal('modal-add-cupom');
  document.getElementById('cupom-code').value = '';
  renderCupons();
  sbToast('ok','Cupom criado!');
}

// ─────────────────────────────────────────
// CASHBACK
// ─────────────────────────────────────────
let _cbClienteAtual = null; // { id, name, phone, cashback_saldo }
let _cbTodosClientes = [];  // cache de todos os clientes com saldo > 0

async function loadCashbackConfig() {
  try {
    const tid = _sessao?.tenant_id || '';
    const res = await fetch('/api/cashback/config', {
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid }
    });
    if (!res.ok) return;
    const cfg = await res.json();
    const toggle = document.getElementById('cb-toggle-ativo');
    if (toggle) toggle.classList.toggle('on', !!cfg.ativo);
    const pct = document.getElementById('cb-pct');
    const min = document.getElementById('cb-min-pedido');
    const val = document.getElementById('cb-validade');
    if (pct) pct.value = cfg.pct || '';
    if (min) min.value = cfg.min_pedido || '';
    if (val) val.value = cfg.validade_dias || '';
  } catch(e) {
    console.error('[Cashback] loadCashbackConfig:', e);
  }
  // Carrega lista de clientes com saldo sempre que abre a aba
  await cbCarregarLista();
}

async function cbCarregarLista() {
  const tbody = document.getElementById('cb-lista-tbody');
  const empty = document.getElementById('cb-lista-vazio');
  const stat  = document.getElementById('cb-lista-stat');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--muted)"><div class="spinner" style="margin:0 auto 8px"></div>Carregando...</td></tr>`;

  try {
    const { data, error } = await sb.from('customers')
      .select('id,name,phone,cashback_saldo')
      .gt('cashback_saldo', 0)
      .order('cashback_saldo', { ascending: false });

    if (error) throw new Error(error.message);

    _cbTodosClientes = data || [];
    cbRenderLista();

    const total = _cbTodosClientes.reduce((s, c) => s + parseFloat(c.cashback_saldo || 0), 0);
    if (stat) stat.textContent = `${_cbTodosClientes.length} cliente${_cbTodosClientes.length !== 1 ? 's' : ''} • Total em carteira: R$ ${total.toFixed(2).replace('.', ',')}`;
  } catch(e) {
    console.error('[Cashback] cbCarregarLista:', e);
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--danger)">Erro ao carregar clientes</td></tr>`;
  }
}

function cbRenderLista() {
  const tbody  = document.getElementById('cb-lista-tbody');
  const empty  = document.getElementById('cb-lista-vazio');
  const search = (document.getElementById('cb-lista-search')?.value || '').toLowerCase();

  const lista = _cbTodosClientes.filter(c =>
    !search ||
    (c.name  || '').toLowerCase().includes(search) ||
    (c.phone || '').includes(search)
  );

  if (!lista.length) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = lista.map(c => {
    const saldo = parseFloat(c.cashback_saldo || 0);
    return `<tr>
      <td>
        <div style="font-weight:600;font-size:13px">${c.name || '—'}</div>
      </td>
      <td style="font-size:12.5px;color:var(--muted)">${c.phone || '—'}</td>
      <td>
        <span style="background:rgba(34,197,94,.15);color:#22c55e;padding:3px 10px;border-radius:99px;font-size:12.5px;font-weight:700">
          R$ ${saldo.toFixed(2).replace('.', ',')}
        </span>
      </td>
      <td>
        <button class="btn bg" style="font-size:11px;padding:3px 10px" onclick="cbSelecionarDaLista(${c.id})">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M13.5 7.75a5.75 5.75 0 1 1-9.6-4.28L2.5 1.5l1.97 1.17A5.72 5.72 0 0 1 13.5 7.75Z" stroke="currentColor" stroke-width="1.3"/></svg>
          Enviar WA
        </button>
      </td>
      <td>
        <button class="btn bd" style="font-size:11px;padding:3px 10px" onclick="cbSelecionarAjuste(${c.id})">Ajustar</button>
      </td>
    </tr>`;
  }).join('');
}

function cbSelecionarDaLista(id) {
  const c = _cbTodosClientes.find(x => x.id === id);
  if (!c) return;
  _cbClienteAtual = { ...c };
  // Preenche o painel de busca/ação
  const phone = (c.phone || '').replace(/\D/g, '');
  const saldo = parseFloat(c.cashback_saldo || 0);
  const el = key => document.getElementById(key);
  if (el('cb-phone-busca'))  el('cb-phone-busca').value = c.phone || '';
  if (el('cb-res-nome'))     el('cb-res-nome').textContent  = c.name || '—';
  if (el('cb-res-phone'))    el('cb-res-phone').textContent = c.phone || '—';
  if (el('cb-res-saldo'))    el('cb-res-saldo').textContent = 'R$ ' + saldo.toFixed(2).replace('.', ',');
  if (el('cb-msg-wa'))       el('cb-msg-wa').value = `💰 ${c.name || 'Cliente'}, você tem R$ ${saldo.toFixed(2).replace('.', ',')} de cashback disponível!\nUse no seu próximo pedido 🛍️`;
  if (el('cb-resultado'))    el('cb-resultado').style.display   = '';
  if (el('cb-busca-vazio'))  el('cb-busca-vazio').style.display = 'none';
  // Scrolla até o painel
  el('cb-resultado')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cbSelecionarAjuste(id) {
  cbSelecionarDaLista(id);
  setTimeout(() => document.getElementById('cb-ajuste-val')?.focus(), 300);
}

async function saveCashbackConfig() {
  const ativo       = document.getElementById('cb-toggle-ativo')?.classList.contains('on') || false;
  const pct         = parseFloat(document.getElementById('cb-pct')?.value) || 0;
  const min_pedido  = parseFloat(document.getElementById('cb-min-pedido')?.value) || 0;
  const validade_dias = parseInt(document.getElementById('cb-validade')?.value) || 0;

  if (pct < 0 || pct > 100) { sbToast('err', 'Percentual deve ser entre 0 e 100'); return; }

  sbLoading(true);
  try {
    const tid = _sessao?.tenant_id || '';
    const res = await fetch('/api/cashback/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ ativo, pct, min_pedido, validade_dias })
    });
    if (res.ok) {
      sbToast('ok', `Cashback ${ativo ? 'ativado' : 'desativado'} — ${pct}% por pedido`);
    } else {
      const err = await res.json().catch(() => ({}));
      sbToast('err', err.error || 'Erro ao salvar configuração');
    }
  } catch(e) {
    sbToast('err', 'Erro de conexão');
  }
  sbLoading(false);
}

async function cbBuscarCliente() {
  const phone = (document.getElementById('cb-phone-busca')?.value || '').replace(/\D/g, '');
  if (!phone || phone.length < 8) { sbToast('err', 'Informe um telefone válido'); return; }

  sbLoading(true);
  try {
    const tid = _sessao?.tenant_id || '';

    // Busca saldo direto pelo endpoint dedicado
    const resSaldo = await fetch(`/api/cashback/saldo?phone=${encodeURIComponent(phone)}`, {
      headers: { 'x-tenant-id': tid }
    });
    const saldoData = await resSaldo.json().catch(() => ({}));

    // Tenta achar o cliente no cache ou no banco
    let cliente = _cbTodosClientes.find(c => (c.phone || '').replace(/\D/g,'').slice(-8) === phone.slice(-8));
    if (!cliente) {
      const { data } = await sb.from('customers').select('id,name,phone,cashback_saldo').eq('phone', phone).maybeSingle();
      cliente = data || null;
    }

    const saldo = parseFloat(saldoData.saldo ?? 0);
    const nome  = cliente?.name || 'Cliente';
    const tel   = cliente?.phone || phone;

    _cbClienteAtual = cliente ? { ...cliente, cashback_saldo: saldo } : { id: null, name: nome, phone: tel, cashback_saldo: saldo };

    const el = key => document.getElementById(key);
    if (el('cb-res-nome'))   el('cb-res-nome').textContent  = nome;
    if (el('cb-res-phone'))  el('cb-res-phone').textContent = tel;
    if (el('cb-res-saldo'))  el('cb-res-saldo').textContent = 'R$ ' + saldo.toFixed(2).replace('.', ',');
    if (el('cb-msg-wa'))     el('cb-msg-wa').value = `💰 ${nome}, você tem R$ ${saldo.toFixed(2).replace('.', ',')} de cashback disponível!\nUse no seu próximo pedido 🛍️`;
    if (el('cb-resultado'))  el('cb-resultado').style.display   = '';
    if (el('cb-busca-vazio'))el('cb-busca-vazio').style.display = 'none';

  } catch(e) {
    console.error('[Cashback] cbBuscarCliente:', e);
    sbToast('err', 'Erro ao buscar cliente');
  }
  sbLoading(false);
}

function cbLimparResultado() {
  const el = key => document.getElementById(key);
  if (el('cb-resultado'))   el('cb-resultado').style.display   = 'none';
  if (el('cb-busca-vazio')) el('cb-busca-vazio').style.display = '';
  _cbClienteAtual = null;
}

async function cbEnviarWA() {
  const phone = (document.getElementById('cb-phone-busca')?.value || '').replace(/\D/g, '');
  if (!phone) { sbToast('err', 'Nenhum cliente selecionado'); return; }

  const msg = document.getElementById('cb-msg-wa')?.value?.trim();
  if (!msg) { sbToast('err', 'Digite a mensagem'); return; }

  sbLoading(true);
  try {
    const r = await EVO.sendText(phone, msg);
    if (r.ok || r.status === 201) {
      sbToast('ok', 'Mensagem enviada via WhatsApp ✓');
    } else {
      sbToast('err', 'Erro ao enviar — verifique se o WhatsApp está conectado no Robô');
    }
  } catch(e) {
    sbToast('err', 'Erro ao enviar mensagem');
  }
  sbLoading(false);
}

async function cbAjustarSaldo() {
  if (!_cbClienteAtual?.id) { sbToast('err', 'Busque um cliente primeiro'); return; }
  const valor = parseFloat(document.getElementById('cb-ajuste-val')?.value);
  if (isNaN(valor) || valor === 0) { sbToast('err', 'Informe um valor diferente de zero'); return; }

  sbLoading(true);
  try {
    const tid = _sessao?.tenant_id || '';
    const res = await fetch('/api/cashback/ajustar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ customer_id: _cbClienteAtual.id, valor })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const novoSaldo = data.saldo ?? 0;
      const saldoEl = document.getElementById('cb-res-saldo');
      if (saldoEl) saldoEl.textContent = 'R$ ' + novoSaldo.toFixed(2).replace('.', ',');
      // Atualiza msg WA com novo saldo
      const msgEl = document.getElementById('cb-msg-wa');
      if (msgEl && _cbClienteAtual) {
        msgEl.value = `💰 ${_cbClienteAtual.name || 'Cliente'}, você tem R$ ${novoSaldo.toFixed(2).replace('.', ',')} de cashback disponível!\nUse no seu próximo pedido 🛍️`;
      }
      _cbClienteAtual.cashback_saldo = novoSaldo;
      document.getElementById('cb-ajuste-val').value = '';
      sbToast('ok', `Saldo ${valor > 0 ? 'creditado' : 'debitado'}: R$ ${Math.abs(valor).toFixed(2).replace('.', ',')}`);
    } else {
      sbToast('err', data.error || 'Erro ao ajustar saldo');
    }
  } catch(e) {
    sbToast('err', 'Erro de conexão');
  }
  sbLoading(false);
}

// ─────────────────────────────────────────
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

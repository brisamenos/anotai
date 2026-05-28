// POTENCIALIZADOR
// ─────────────────────────────────────────
function _salaoEscape(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function _salaoResumoClientesMesa(orders) {
  const grupos = new Map();
  (orders || []).forEach(o => {
    (_parseItems(o.items)).forEach(i => {
      if ((i?.item_status || 'active') === 'cancelado') return;
      const label = String(i.cliente_nome || '').trim() || 'Mesa toda';
      const key = String(i.cliente_ref || label || '__mesa');
      if (!grupos.has(key)) grupos.set(key, { key, label, total: 0, items: [] });
      const qty = parseInt(i.qty) || 1;
      const price = parseFloat(i.price) || 0;
      const g = grupos.get(key);
      g.total += price * qty;
      g.items.push({ ...i, qty, price });
    });
  });
  return [...grupos.values()];
}

function _salaoPrintClientesHtml(orders) {
  const grupos = _salaoResumoClientesMesa(orders);
  if (!grupos.some(g => g.label !== 'Mesa toda')) return '';
  return grupos.map(g => {
    const itemMap = {};
    g.items.forEach(i => {
      const key = `${i.name}|${i.obs || ''}|${i.price || 0}`;
      if (!itemMap[key]) itemMap[key] = { name: i.name, qty: 0, price: i.price || 0, obs: i.obs || '' };
      itemMap[key].qty += (i.qty || 1);
    });
    const rows = Object.values(itemMap).map(i => {
      const obs = i.obs ? `<div style="padding-left:12px;font-size:0.88em">↳ ${_salaoEscape(i.obs)}</div>` : '';
      return `<div style="margin-bottom:4px"><div style="font-weight:bold;word-break:break-word">${i.qty}x ${_salaoEscape((i.name || '').toUpperCase())}<span style="float:right">R$ ${(i.price * i.qty).toFixed(2).replace('.',',')}</span></div>${obs}</div>`;
    }).join('');
    return `<div style="font-weight:900;border-top:1px dashed #000;margin:6px 0 3px;padding-top:4px">${_salaoEscape(g.label).toUpperCase()}</div>
      ${rows}
      <div style="display:flex;justify-content:space-between;font-weight:bold;margin:2px 0 5px"><span>Subtotal ${_salaoEscape(g.label)}</span><span>R$ ${g.total.toFixed(2).replace('.',',')}</span></div>`;
  }).join('');
}

function renderPotencializador() {
  const el = document.getElementById('pot-items');
  if (!el) return;
  el.innerHTML = items.filter(i => i.status === 'active').slice(0, 5).map((i, idx) => `
    <div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--surface2);border:1px solid var(--border);border-radius:9px">
      <div style="font-size:26px">${i.emoji}</div>
      <div style="flex:1"><div style="font-weight:600;font-size:13px">${i.name}</div><div style="font-size:11.5px;color:var(--muted);margin-top:2px">R$ ${i.price.toFixed(2).replace('.', ',')} • ${i.cat}</div></div>
      <div style="font-size:12px;color:var(--accent3)">★ ${(4.2 + idx * 0.1).toFixed(1)}</div>
      <button class="btn bp" style="font-size:11px;padding:4px 9px" data-n="${i.name.replace(/"/g, '&quot;')}" onclick="sbToast('ok',this.dataset.n+' em destaque!')">Destacar</button>
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
  } catch (e) { console.error('[clientes-cache]', e); }
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
    (c.phone && c.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '')))
  ).slice(0, 8);

  if (!filtrados.length) { dropdown.style.display = 'none'; return; }

  dropdown.innerHTML = filtrados.map(c => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .12s"
         onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''"
         data-id="${c.id}" data-name="${(c.name || '').replace(/"/g, '&quot;')}" data-phone="${(c.phone || '').replace(/"/g, '&quot;')}" data-addr="${(c.addr || '').replace(/"/g, '&quot;')}"
         onclick="(function(el){
           var dd=el.closest('.cli-autocomplete-dropdown');
           if(dd._onSelect) dd._onSelect({id:el.dataset.id,name:el.dataset.name,phone:el.dataset.phone,addr:el.dataset.addr});
           dd.style.display='none';
         })(this)">
      <div style="width:34px;height:34px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0">${(c.name || '?').charAt(0).toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name || 'Sem nome'}</div>
        <div style="font-size:11px;color:var(--muted)">${c.phone || ''}${c.addr ? ' · ' + c.addr.substring(0, 40) : ''}</div>
      </div>
    </div>`).join('');
  dropdown.style.display = 'block';
}

// Inicializa autocomplete num input. Passa os IDs dos campos a preencher.
function initClienteAutocomplete(inputId, opts) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const dropdown = _criarDropdownClientes(inp, (cliente) => {
    if (opts.nameId) { const el = document.getElementById(opts.nameId); if (el) el.value = cliente.name || ''; }
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
function renderPDV() {
  const g = document.getElementById('pdv-grid');
  if (!g) return;
  // Inicializa autocomplete de clientes no PDV
  initClienteAutocomplete('pdv-client', {
    nameId: 'pdv-client',
    phoneId: 'pdv-phone'
  });
  initClienteAutocomplete('pdv-phone', {
    nameId: 'pdv-client',
    phoneId: 'pdv-phone'
  });
  const q = (document.getElementById('pdv-search-input') || {}).value || '';
  const fil = items.filter(i => i.status === 'active' && i.name.toLowerCase().includes(q.toLowerCase()));
  g.innerHTML = fil.map(i => {
    const isKg = i.itemType === 'kg', isPizza = i.itemType === 'pizza';
    const badge = isPizza ? '<span style="font-size:9px;background:rgba(245,158,11,.15);color:var(--accent3);border-radius:4px;padding:1px 4px;font-weight:700">PIZZA</span>' : isKg ? '<span style="font-size:9px;background:rgba(34,197,94,.15);color:#16a34a;border-radius:4px;padding:1px 4px;font-weight:700">KG</span>' : '';
    const priceLabel = isKg ? `R$ ${i.price.toFixed(2).replace('.', ',')} <span style="font-size:9px;opacity:.7">/kg</span>` : `R$ ${i.price.toFixed(2).replace('.', ',')}`;
    const click = isPizza ? `openPDVPizza(${i.id})` : `addToCart(${i.id})`;
    return `<div class="pdv-item${isPizza ? ' pdv-item-pizza' : ''}" onclick="${click}">
      <div class="pdv-emoji">${i.emoji || '🥩'}</div>
      <div class="pdv-name">${i.name} ${badge}</div>
      <div class="pdv-price">${priceLabel}</div>
    </div>`;
  }).join('');
}

function addToCart(id) {
  const it = items.find(i => i.id === id);
  if (!it) return;
  if (it.itemType === 'pizza') { window._pdvPizzaSource = 'pdv'; openPDVPizza(id); return; }

  // Verifica grupos de adicionais (igual ao cardápio público)
  const grupos = (() => { try { return Array.isArray(it.customGroups) ? it.customGroups : JSON.parse(it.customGroups || '[]') } catch { return [] } })()
    .filter(g => !['porcao_ref', 'kit_itens'].includes(g.tipo));
  const isKg = it.itemType === 'kg' || it.item_type === 'kg';

  if (grupos.length > 0 || isKg) {
    _pdvAbrirModalItem(it, grupos, isKg);
    return;
  }
  // Sem adicionais — adiciona direto
  const obsKit = (typeof _pedidoObsComKit === 'function') ? _pedidoObsComKit(it, '') : '';
  const ci = cartItems.find(c => c.id === id && (c.obs || '') === obsKit);
  if (ci) ci.qty++;
  else cartItems.push({ ...it, qty: 1, obs: obsKit, _grupos: [] });
  renderCart();
  showToast('🛒', `${it.name} adicionado!`);
}

function _pdvAbrirModalItem(it, grupos, isKg) {
  document.getElementById('pdv-modal-item-bg')?.remove();
  const priceStr = parseFloat(it.price || 0).toFixed(2).replace('.', ',');

  const gruposHtml = grupos.map((g, gi) => {
    const opcoes = g.opcoes || g.valores || [];
    if (!opcoes.length) return '';
    const tipo = g.tipo || 'opcional';
    const isSingle = ['radio', 'cortes', 'preparos', 'ocasiao', 'armazenamento', 'pesos', 'obrigatorio', 'sabor'].includes(tipo);
    const isMulti = !isSingle; // checkbox, opcional, adicionais, checklist
    const isReq = ['obrigatorio', 'sabor', 'cortes'].includes(tipo);

    const _TIPO_LABEL = {
      cortes: 'Corte', preparos: 'Preparo', ocasiao: 'Ocasião',
      armazenamento: 'Armazenamento', pesos: 'Porção / Peso',
      checklist: 'Complementos', radio: 'Escolha', checkbox: 'Adicional',
      opcional: 'Adicional', adicionais: 'Adicional',
      obrigatorio: 'Escolha obrigatória', sabor: 'Sabor',
    };
    const label = g.nome || g.name || _TIPO_LABEL[tipo] || 'Adicional';

    return `<div style="margin-bottom:16px">
      <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px">
        ${label}${isReq ? ' <span style="color:var(--danger);font-size:10px">*obrigatório</span>' : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${opcoes.map((op, oi) => {
      const nome = op.nome || op.name || (typeof op === 'string' ? op : '');
      const preco = parseFloat(op.preco || op.price || 0);
      const icon = op.icon ? `<span style="font-size:16px">${op.icon}</span>` : '';
      const pLabel = preco > 0 ? ` <span style="color:var(--success);font-size:11px">+R$ ${preco.toFixed(2).replace('.', ',')}</span>` : '';
      return `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface2);border:1.5px solid var(--border);border-radius:9px;cursor:pointer" onclick="pdvToggleOpc(this)">
            <input type="${isMulti ? 'checkbox' : 'radio'}" name="pdv-grp-${gi}" data-grp="${gi}" data-nome="${(nome + '').replace(/"/g, '&quot;')}" data-preco="${preco}" style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0">
            ${icon}<span style="font-size:13px;font-weight:500;flex:1">${nome}${pLabel}</span>
          </label>`;
    }).join('')}
      </div>
    </div>`;
  }).join('');

  const kgHtml = isKg ? `<div style="margin-bottom:16px">
    <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px">Quantidade</div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      ${[0.25, 0.5, 1, 1.5, 2, 2.5, 3].map(v => `<button onclick="pdvSetKg(${v})" style="padding:7px 12px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer;font-size:13px;font-weight:700;font-family:inherit">${v >= 1 ? (v + 'kg') : (v * 1000 + 'g')}</button>`).join('')}
      <input type="number" id="pdv-kg-input" min="0.1" step="0.1" value="1"
        style="width:90px;padding:8px;border:1.5px solid var(--accent);border-radius:8px;background:var(--surface2);color:var(--text);font-size:16px;font-weight:700;text-align:center;outline:none;font-family:inherit"
        oninput="pdvAtualizarTotal()">
      <span style="font-size:13px;color:var(--muted)">kg</span>
    </div>
  </div>` : '';

  const modal = document.createElement('div');
  modal.id = 'pdv-modal-item-bg';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:20px 20px 0 0;width:100%;max-width:520px;max-height:88vh;overflow-y:auto;padding:20px 20px 32px;box-shadow:0 -8px 40px rgba(0,0,0,.3)">
      <div style="width:40px;height:4px;background:var(--border);border-radius:99px;margin:0 auto 18px"></div>
      <!-- Header do produto -->
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        ${it.imageUrl
      ? `<img src="${it.imageUrl}" style="width:60px;height:60px;border-radius:12px;object-fit:cover;flex-shrink:0">`
      : `<div style="width:60px;height:60px;border-radius:12px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0">${it.emoji || '🍽️'}</div>`}
        <div>
          <div style="font-size:16px;font-weight:800">${it.name}</div>
          <div style="font-size:13px;color:var(--success);font-weight:700;margin-top:2px">R$ ${priceStr}${isKg ? ' /kg' : ''}</div>
          ${it.desc || it.description ? `<div style="font-size:11.5px;color:var(--muted);margin-top:2px">${it.desc || it.description}</div>` : ''}
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
  modal._item = it;
  modal._isKg = isKg;
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
      r.closest('label').style.background = 'var(--surface2)';
    });
    label.style.borderColor = 'var(--accent)';
    label.style.background = 'rgba(var(--accent-rgb,249,115,22),.08)';
  } else {
    label.style.borderColor = inp.checked ? 'var(--accent)' : 'var(--border)';
    label.style.background = inp.checked ? 'rgba(var(--accent-rgb,249,115,22),.08)' : 'var(--surface2)';
  }
  pdvAtualizarTotal();
}

function pdvSetKg(v) {
  const inp = document.getElementById('pdv-kg-input');
  if (inp) { inp.value = v; pdvAtualizarTotal(); }
}

function pdvModalQty(d) {
  window._pdvQty = Math.max(1, (window._pdvQty || 1) + d);
  const el = document.getElementById('pdv-modal-qty');
  if (el) el.textContent = window._pdvQty;
  pdvAtualizarTotal();
}

function pdvAtualizarTotal() {
  const modal = document.getElementById('pdv-modal-item-bg');
  if (!modal?._item) return;
  const it = modal._item;
  const isKg = modal._isKg;
  const qty = window._pdvQty || 1;
  let extra = 0;
  document.querySelectorAll('#pdv-modal-item-bg input:checked').forEach(inp => {
    extra += parseFloat(inp.dataset.preco || 0);
  });
  let price = parseFloat(it.price || 0) + extra;
  if (isKg) {
    const kg = parseFloat(document.getElementById('pdv-kg-input')?.value || 1);
    price = price * kg;
  }
  const total = price * qty;
  const el = document.getElementById('pdv-modal-total');
  if (el) el.textContent = 'R$ ' + total.toFixed(2).replace('.', ',');
}

function _pdvConfirmar(itemId) {
  const modal = document.getElementById('pdv-modal-item-bg');
  if (!modal) return;
  const it = modal._item;
  const isKg = modal._isKg;
  const qty = window._pdvQty || 1;
  let extra = 0;
  const opcs = [];
  document.querySelectorAll('#pdv-modal-item-bg input:checked').forEach(inp => {
    extra += parseFloat(inp.dataset.preco || 0);
    opcs.push(inp.dataset.nome);
  });
  let obs = [opcs.join(', '), document.getElementById('pdv-obs-input')?.value.trim()].filter(Boolean).join(' | ');
  if (typeof _pedidoObsComKit === 'function') obs = _pedidoObsComKit(it, obs);
  let price = parseFloat(it.price || 0) + extra;
  let name = it.name;

  // Detecta se veio do modo garçom
  const isGarcom = window._pdvAddItemSource === 'garcom';
  const targetCart = isGarcom ? garcomCart : cartItems;

  if (isKg) {
    const kg = parseFloat(document.getElementById('pdv-kg-input')?.value || 1);
    price = price * kg;
    const lbl = kg >= 1 ? kg.toFixed(1).replace('.', ',') + 'kg' : (kg * 1000).toFixed(0) + 'g';
    name = `${it.name} (${lbl})`;
    targetCart.push({ ...it, name, qty: 1, price, obs, isKg: true, _pesoLabel: lbl, _grupos: opcs });
  } else {
    const ci = targetCart.find(c => c.id === it.id && c.obs === obs);
    if (ci) ci.qty += qty;
    else targetCart.push({ ...it, name, qty, price, obs, _grupos: opcs });
  }

  if (isGarcom) {
    _garcomUpdatePreview();
    window._pdvAddItemSource = null;
  } else {
    renderCart();
  }
  modal.remove();
  showToast('🛒', `${name} adicionado!`);
}

function renderCart() {
  const c = document.getElementById('cart-items');
  const tot = cartItems.reduce((s, i) => s + parseFloat((i.price * i.qty).toFixed(2)), 0);
  document.getElementById('cart-total').textContent = 'R$ ' + tot.toFixed(2).replace('.', ',');
  document.getElementById('cart-qty').textContent = `(${cartItems.reduce((s, i) => s + (i.isKg ? 1 : i.qty), 0)} itens)`;
  if (!c) return;
  if (cartItems.length === 0) { c.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:12.5px">Carrinho vazio<br>Clique nos itens para adicionar</div>'; return; }
  c.innerHTML = cartItems.map((i, idx) => `
    <div class="cart-item">
      <div class="ci-emoji">${i.emoji || '🍽️'}</div>
      <div class="ci-info">
        <div class="ci-name">${i.name}</div>
        ${i.obs ? `<div style="font-size:10.5px;color:var(--muted);margin-top:1px">${i.obs}</div>` : ''}
        <div class="ci-price">R$ ${(i.price * i.qty).toFixed(2).replace('.', ',')}</div>
      </div>
      <div class="qty-ctrl">
        ${i.isKg
      ? `<div class="qb" onclick="changeQty(${idx},-1)" title="Remover">🗑</div>`
      : `<div class="qb" onclick="changeQty(${idx},-1)">−</div><div class="qn">${i.qty}</div><div class="qb" onclick="changeQty(${idx},1)">+</div>`}
      </div>
    </div>`).join('');
}

function _editarPesoCart(idx) {
  const ci = cartItems[idx]; if (!ci || !ci.isKg) return;
  const novo = parseFloat(prompt(`Novo peso para "${ci.name}" (kg):`, ci.qty.toFixed(3)));
  if (isNaN(novo) || novo <= 0) { sbToast('err', 'Peso inválido'); return; }
  ci.qty = novo; ci._pesoLabel = novo.toFixed(3).replace('.', ',') + 'kg';
  renderCart();
}

function changeQty(idx, delta) {
  if (cartItems[idx]?.isKg) { cartItems.splice(idx, 1); renderCart(); return; }
  cartItems[idx].qty += delta;
  if (cartItems[idx].qty <= 0) cartItems.splice(idx, 1);
  renderCart();
}

function clearCart() { cartItems = []; renderCart(); const c = document.getElementById('pdv-client'), p = document.getElementById('pdv-phone'); if (c) c.value = ''; if (p) p.value = ''; }

async function finalizeSale() {
  if (window._pdvFinalizando) return;
  window._pdvFinalizando = true;
  const _ICON_WRN = _ICON_ERR;
  if (cartItems.length === 0) { window._pdvFinalizando = false; sbToast('err', 'Carrinho vazio!'); return; }
  const tot = cartItems.reduce((s, i) => s + parseFloat((i.price * i.qty).toFixed(2)), 0);
  const pay = document.getElementById('pay-method').value;
  const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const pdvClient = (document.getElementById('pdv-client')?.value || '').trim();
  const pdvPhone = (document.getElementById('pdv-phone')?.value || '').trim();
  let descricao = pdvClient ? `PDV – ${pdvClient}` : 'PDV – Balcão';
  if (window._segmento === 'acougue') {
    const resumo = cartItems.map(i => i.isKg ? `${i._pesoLabel} ${i.name}` : `${i.qty}x ${i.name}`).join(', ');
    descricao = `Atendimento – ${resumo.slice(0, 80)}${resumo.length > 80 ? '…' : ''}`;
  }
  try {
    if (!_sessao?.tenant_id) { sbToast('err', 'Sessão sem tenant'); return; }
    const { data, error } = await sb.from('movimentos').insert({
      tenant_id: _sessao.tenant_id,
      description: descricao, tipo: 'entrada', val: parseFloat(tot.toFixed(2)), pag: pay, time
    }).select().single();
    if (!error && data) movimentos.push({
      id: data.id, desc: descricao, tipo: 'entrada', val: parseFloat(tot.toFixed(2)), pag: pay, time
    });
    playOrderSound();
    sbToast('ok', `Venda R$${tot.toFixed(2).replace('.', ',')} finalizada!`);
    cartItems = []; renderCart();
  } finally {
    window._pdvFinalizando = false;
  }
}

// ─────────────────────────────────────────
// CHATBOT
// ─────────────────────────────────────────
function initChat() {
  if (chatInitialized) return;
  chatInitialized = true;
  addMsg('bot', 'Olá! Bem-vindo ao Estima Food!\n\nDigite: *cardapio*, *taxa*, *horario*, *pix*, *pedido*');
}

function addMsg(type, text) {
  const msgs = document.getElementById('chat-msgs');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'msg ' + type;
  div.style.whiteSpace = 'pre-wrap';
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function sendChat() {
  const inp = document.getElementById('chat-in');
  const val = inp.value.trim();
  if (!val) return;
  addMsg('user', val);
  inp.value = '';
  const msgs = document.getElementById('chat-msgs');
  const typing = document.createElement('div');
  typing.className = 'msg typing';
  typing.innerHTML = '<div class="dots"><span></span><span></span><span></span></div>';
  msgs.appendChild(typing);
  msgs.scrollTop = msgs.scrollHeight;
  setTimeout(() => {
    typing.remove();
    const lower = val.toLowerCase();
    let resp = null;
    for (const k of Object.keys(BOT_ANSWERS)) { if (lower.includes(k)) { resp = BOT_ANSWERS[k]; break; } }
    if (!resp) {
      const taxa = document.getElementById('taxa-input');
      resp = `Entendi! Recebemos: "${val}"\nTaxa de entrega: R$ ${taxa ? taxa.value : '5,00'}. Como posso ajudar?`;
    }
    addMsg('bot', resp);
  }, 800 + Math.random() * 600);
}

function clearChat() {
  const m = document.getElementById('chat-msgs');
  if (m) m.innerHTML = '';
  chatInitialized = false;
  initChat();
}

// ─────────────────────────────────────────
// QR CODE
// ─────────────────────────────────────────
function renderQR() {
  const g = document.getElementById('qr-grid');
  if (!g) return;
  document.getElementById('qr-free-cnt').textContent = tables.filter(t => t.status === 'free').length;
  document.getElementById('qr-busy-cnt').textContent = tables.filter(t => t.status === 'busy').length;
  document.getElementById('qr-wait-cnt').textContent = tables.filter(t => t.status === 'waiting').length;
  document.getElementById('qr-total-cnt').textContent = tables.length;
  g.innerHTML = tables.map(t => {
    const sc = t.status === 'free' ? 'qr-free' : t.status === 'busy' ? 'qr-busy' : 'qr-waiting';
    const sl = t.status === 'free' ? 'Livre' : t.status === 'busy' ? 'Ocupada' : 'Aguardando';
    return `<div class="qr-table" onclick="openMesa(${t.num})">
      <div class="qr-num">Mesa ${t.num}</div>
      <div class="qr-status ${sc}">${sl}</div>
      <div class="qr-code"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="1" width="8" height="14" rx="1.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="12" r=".8" fill="currentColor"/></svg></div>
      ${t.guests ? `<div style="font-size:11px;color:var(--muted)">${t.guests} pessoas • ${t.total}</div>` : '<div style="font-size:11px;color:var(--muted)">Escanear para pedir</div>'}
      <button class="btn bg" style="width:100%;justify-content:center;font-size:10.5px;margin-top:7px;padding:4px" onclick="event.stopPropagation();toggleMesaStatus(${t.num})">${t.status === 'free' ? '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="5" fill="var(--danger)" opacity=".9"/></svg> Ocupar' : '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="5" fill="var(--accent3)" opacity=".9"/></svg> Liberar'}</button>
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

function openMesa(num) {
  document.getElementById('modal-mesa-num').textContent = num;
  document.getElementById('modal-mesa-link').textContent = num;
  openModal('modal-mesa');
}

async function toggleMesaStatus(num) {
  const t = tables.find(x => x.num === num);
  if (!t) return;
  const newStatus = t.status === 'free' ? 'busy' : 'free';
  const newGuests = newStatus === 'busy' ? 2 : null;
  const payload = newStatus === 'free'
    ? { status: newStatus, guests: newGuests, total: null, clientes_json: [], pagamentos_json: [], updated_at: new Date().toISOString() }
    : { status: newStatus, guests: newGuests, total: null, clientes_json: [], pagamentos_json: [], updated_at: new Date().toISOString() };
  const { error } = await sb.from('mesas')
    .update(payload)
    .eq('num', num);
  if (!error) { t.status = newStatus; t.guests = newGuests; t.total = null; t.clientes_json = []; t.pagamentos_json = []; }
  renderQR();
}

async function addTable() {
  const num = tables.length ? Math.max(...tables.map(t => t.num)) + 1 : 1;
  sbLoading(true);
  if (!_sessao?.tenant_id) { sbLoading(false); sbToast('err', 'Sessão sem tenant'); return; }
  const { data, error } = await sb.from('mesas').insert({
    tenant_id: _sessao.tenant_id, num, status: 'free'
  }).select().single();
  sbLoading(false);
  if (error) { sbToast('err', 'Erro ao criar mesa'); return; }
  tables.push({ num, status: 'free', guests: null, total: null, clientes_json: [], pagamentos_json: [] });
  renderQR();
  sbToast('ok', `Mesa ${num} criada!`);
}

function openModalNovaMesa() {
  const next = tables.length ? Math.max(...tables.map(t => t.num)) + 1 : 1;
  document.getElementById('nova-mesa-num').value = next;
  document.getElementById('nova-mesa-guests').value = '';
  openModal('modal-nova-mesa');
}

async function saveNovaMesa() {
  const num = parseInt(document.getElementById('nova-mesa-num').value);
  const guests = parseInt(document.getElementById('nova-mesa-guests').value) || null;
  if (!num || num < 1) { sbToast('err', 'Informe o número da mesa'); return; }
  if (tables.find(t => t.num === num)) { sbToast('err', `Mesa ${num} já existe`); return; }
  sbLoading(true);
  if (!_sessao?.tenant_id) { sbLoading(false); sbToast('err', 'Sessão sem tenant'); return; }
  const { data, error } = await sb.from('mesas').insert({ tenant_id: _sessao.tenant_id, num, status: 'free', guests }).select().single();
  sbLoading(false);
  if (error) { sbToast('err', 'Erro ao criar mesa'); return; }
  tables.push({ num, status: 'free', guests, total: null, clientes_json: [], pagamentos_json: [] });
  tables.sort((a, b) => a.num - b.num);
  closeModal('modal-nova-mesa');
  renderMesasPage();
  renderQR();
  sbToast('ok', `Mesa ${num} criada!`);
}

function openEditMesa(num) {
  const t = tables.find(x => x.num === num);
  if (!t) return;
  document.getElementById('edit-mesa-old-num').value = num;
  document.getElementById('edit-mesa-num').value = num;
  document.getElementById('edit-mesa-guests').value = t.guests || '';
  document.getElementById('modal-edit-mesa-title').textContent = `Mesa ${num}`;
  openModal('modal-edit-mesa');
}

async function saveMesaEdit() {
  const oldNum = parseInt(document.getElementById('edit-mesa-old-num').value);
  const newNum = parseInt(document.getElementById('edit-mesa-num').value);
  const guests = parseInt(document.getElementById('edit-mesa-guests').value) || null;
  if (!newNum || newNum < 1) { sbToast('err', 'Informe o número da mesa'); return; }
  if (newNum !== oldNum && tables.find(t => t.num === newNum)) { sbToast('err', `Mesa ${newNum} já existe`); return; }
  sbLoading(true);
  const { error } = await sb.from('mesas').update({ num: newNum, guests }).eq('num', oldNum);
  sbLoading(false);
  if (error) { sbToast('err', 'Erro ao salvar'); return; }
  const t = tables.find(x => x.num === oldNum);
  if (t) { t.num = newNum; t.guests = guests; }
  tables.sort((a, b) => a.num - b.num);
  closeModal('modal-edit-mesa');
  renderMesasPage();
  renderQR();
  sbToast('ok', `Mesa atualizada!`);
}

async function confirmDeleteMesa() {
  const num = parseInt(document.getElementById('edit-mesa-old-num').value);
  if (!confirm(`Excluir Mesa ${num}? Esta ação não pode ser desfeita.`)) return;
  sbLoading(true);
  const { error } = await sb.from('mesas').delete().eq('num', num);
  sbLoading(false);
  if (error) { sbToast('err', 'Erro ao excluir'); return; }
  tables = tables.filter(t => t.num !== num);
  closeModal('modal-edit-mesa');
  renderMesasPage();
  renderQR();
  sbToast('ok', `Mesa ${num} excluída!`);
}

async function qrDeleteMesa(num) {
  if (!confirm(`Excluir Mesa ${num}? Esta ação não pode ser desfeita.`)) return;
  sbLoading(true);
  const { error } = await sb.from('mesas').delete().eq('num', num);
  sbLoading(false);
  if (error) { sbToast('err', 'Erro ao excluir'); return; }
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
  // refreshMesasState() (mesa-state.js) faz todas as queries necessárias
  // e actualiza tables + mesaOrdersCache atomicamente.
  await refreshMesasState();
  _renderMesaPageFromCache();
}

function _elapsedLabel(openedAt) {
  if (!openedAt) return '';
  const mins = Math.floor((Date.now() - new Date(openedAt).getTime()) / 60000);
  if (mins < 1) return '< 1 min';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function _elapsedColor(openedAt, isWaiting) {
  if (isWaiting || !openedAt) return 'var(--muted)';
  const mins = Math.floor((Date.now() - new Date(openedAt).getTime()) / 60000);
  if (mins > 90) return 'var(--red)';
  if (mins > 45) return 'var(--amber)';
  return 'var(--green)';
}

// ── Alerta de mesa ociosa ─────────────────────────────────────────────────────
let _mesasAlertadas = new Set();
function _verificarMesasOciosas() {
  const LIMITE_ALERTA = 90; // minutos
  tables.filter(t => t.status === 'busy' && t.opened_at).forEach(t => {
    const mins = Math.floor((Date.now() - new Date(t.opened_at).getTime()) / 60000);
    const key  = `mesa-${t.num}-${Math.floor(mins / 30)}`; // alerta a cada 30min após limite
    if (mins >= LIMITE_ALERTA && !_mesasAlertadas.has(key)) {
      _mesasAlertadas.add(key);
      sbToast('warn', `⏰ Mesa ${t.num} está ocupada há ${mins >= 60 ? Math.floor(mins/60)+'h '+( mins%60)+'min' : mins+'min'} sem fechar!`);
      if (typeof sendBrowserNotif === 'function') {
        sendBrowserNotif(`⏰ Mesa ${t.num} ociosa`, `Ocupada há ${mins} minutos`);
      }
    }
  });
}
// Verifica a cada 5 minutos
setInterval(_verificarMesasOciosas, 5 * 60 * 1000);

function renderMesaCard(t, orders) {
  const isWaiting = t.status === 'waiting';
  const bordColor = isWaiting ? 'var(--accent3)' : t.status === 'busy' ? 'var(--accent)' : 'var(--border)';

  // Com o novo modelo, o total vem da comanda única (mesa_aberta) no cache
  const comanda = mesaOrdersCache.find(o =>
    o.status === 'mesa_aberta' && parseInt(o.mesa_num) === parseInt(t.num)
  );

  const otherSessionOrders = orders.filter(o => !comanda || o.id !== comanda.id);
  const totalOutrosPedidos = otherSessionOrders.reduce((s, o) => s + parseFloat(o.total || 0), 0);

  // Total da sessão atual sem duplicar comanda nem pedidos entregues
  const total = (comanda ? parseFloat(comanda.total || 0) : 0) + totalOutrosPedidos;
  const statusLabel = isWaiting
    ? '<span style="font-size:11px;font-weight:700;color:var(--accent3)">⏳ Aguardando pagamento</span>'
    : '<span style="font-size:11px;font-weight:700;color:var(--accent)">🔵 Ocupada</span>';

  const ordersHtml = comanda
    ? (() => {
        const allItens = _parseItems(comanda.items);
        const grupos = {
          producao: allItens.filter(i => i.item_status === 'producao'),
          pronto:   allItens.filter(i => i.item_status === 'pronto'),
          entregue: allItens.filter(i => i.item_status === 'entregue'),
        };
        const renderGrupoSalao = (key, itens) => {
          if (!itens.length) return '';
          const icon = { producao:'🍳', pronto:'✅', entregue:'🟢' }[key];
          const lbl  = { producao:'Em preparo', pronto:'Pronto', entregue:'Entregue' }[key];
          const rows = itens.map(i =>
            `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0">
              <span>${i.drink?'🥤':'🍴'} ${i.qty}× ${i.name}${i.cliente_nome ? ` <span style="font-size:9px;background:rgba(34,197,94,.12);color:var(--green);padding:1px 5px;border-radius:4px;font-weight:700">${_salaoEscape(i.cliente_nome)}</span>` : ''}</span>
              <span style="color:var(--accent3)">R$ ${((i.price||0)*(i.qty||1)).toFixed(2).replace('.',',')}</span>
            </div>`
          ).join('');
          return `<div style="margin-bottom:6px">
            <div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:3px">${icon} ${lbl.toUpperCase()}</div>
            ${rows}
          </div>`;
        };
        const html = renderGrupoSalao('producao', grupos.producao)
          + renderGrupoSalao('pronto', grupos.pronto)
          + renderGrupoSalao('entregue', grupos.entregue);
        return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:10px 12px;margin-bottom:7px">
          <div style="font-size:10.5px;color:var(--muted);margin-bottom:6px">📋 Comanda #${_orderNum(comanda.id, comanda.order_num)}</div>
          ${html || '<div style="font-size:12px;color:var(--muted)">Sem itens ativos</div>'}
        </div>`;
      })()
    : isWaiting
      // Mesa aguardando pagamento: sempre mostra resumo consolidado,
      // nunca os cards individuais de pedidos anteriores
      ? (function () {
        const sessionStart = t.opened_at ? new Date(t.opened_at).getTime() - 5000 : 0;
        const allSessionOrders = mesaOrdersCache.filter(o =>
          parseInt(o.mesa_num) === parseInt(t.num) &&
          new Date(o.created_at || 0).getTime() >= sessionStart
        );
        if (!allSessionOrders.length) {
          return `<div style="color:var(--muted);font-size:12.5px;text-align:center;padding:10px 0">Consumo registrado</div>`;
        }
        const itemMap = {};
        allSessionOrders.forEach(o => {
          (_parseItems(o.items)).forEach(i => {
            if (i.item_status === 'cancelado') return;
            const key = i.name;
            if (!itemMap[key]) itemMap[key] = { name: i.name, qty: 0, total: 0, drink: !!i.drink };
            itemMap[key].qty += (i.qty || 1);
            itemMap[key].total += (i.price || 0) * (i.qty || 1);
          });
        });
        const rows = Object.values(itemMap).map(i =>
          `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04)">
              <span>${i.drink ? '🥤' : '🍴'} ${i.qty}× ${i.name}</span>
              <span style="color:var(--accent3);font-weight:600">R$ ${i.total.toFixed(2).replace('.', ',')}</span>
            </div>`
        ).join('');
        // Se pedidos existem mas nenhum item foi encontrado (dados incompletos no cache),
        // dispara refresh em background e mostra mensagem temporária
        if (!rows) {
          if (typeof refreshMesa === 'function') setTimeout(() => refreshMesa(t.num).then(() => _renderMesaPageFromCache()), 100);
          return `<div style="color:var(--muted);font-size:12.5px;text-align:center;padding:10px 0">Consumo registrado</div>`;
        }
        return `<div style="background:var(--surface2);border:1px solid rgba(245,158,11,.2);border-radius:9px;padding:10px 12px;margin-bottom:4px">
            <div style="font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px">🧾 Resumo do consumo</div>
            ${rows}
          </div>`;
      })()
    : orders.length
    ? orders.map(o => {
      const items = _parseItems(o.items);
      const itemStr = items.filter(i => i.item_status !== 'cancelado').map(i => `${i.drink ? '🥤' : '🍴'} ${i.qty}× ${i.name}`).join('  ');
      const isNew = o.status === 'analise';
      const isProd = o.status === 'producao';
      const isRdy = o.status === 'pronto';
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
    : `<div style="color:var(--muted);font-size:12.5px;text-align:center;padding:14px 0">Nenhum pedido ativo</div>`;

  // Se mesa está waiting, usa t.total gravado pelo garçom/fecharMesa
  // Se mesa está busy, usa total do cache atual
  let displayTotal = total; // padrão: soma do cache
  if (isWaiting && t.total) {
    // total pode vir como número (novo) ou string 'R$ 99,90' (legado)
    const raw = typeof t.total === 'string'
      ? parseFloat(t.total.replace('R$', '').replace(',', '.').trim())
      : parseFloat(t.total);
    if (!isNaN(raw) && raw > 0) displayTotal = raw;
  }
  const displayTotalOriginal = displayTotal;
  const pagoMesa = (typeof mesaPagoTotal === 'function') ? mesaPagoTotal(t) : 0;
  if (isWaiting && pagoMesa > 0) {
    displayTotal = Math.max(0, Math.round((displayTotalOriginal - pagoMesa) * 100) / 100);
  }

  const actionBtn = isWaiting
    ? `<div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="gestorAbrirDetalheMesa(${t.num})" style="flex:1;padding:11px;border-radius:9px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-family:'DM Sans',sans-serif;font-size:12.5px;font-weight:700;cursor:pointer">📋 Detalhes</button>
        <button onclick="openRegistrarPagamento(${t.num})" style="flex:2;padding:11px;border-radius:9px;border:none;background:linear-gradient(135deg,var(--accent3),#d97706);color:#000;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;cursor:pointer">
        💰 Receber — R$ ${displayTotal.toFixed(2).replace('.', ',')}
      </button>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button onclick="reabrirMesa(${t.num})" style="flex:1;padding:7px;border-radius:8px;border:1.5px solid rgba(59,130,246,.4);background:rgba(59,130,246,.08);color:#93c5fd;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer">↩️ Reabrir mesa</button>
        <button onclick="cancelarMesaCompleta(${t.num})" style="flex:1;padding:7px;border-radius:8px;border:1.5px solid rgba(239,68,68,.3);background:rgba(239,68,68,.08);color:#f87171;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer">🗑️ Cancelar mesa</button>
      </div>`
    : `<div style="display:flex;gap:8px;margin-top:8px">
        <button onclick="openGarcomMesa(${t.num})" class="btn bp" style="flex:1;justify-content:center;font-size:12px">➕ Lançar pedido</button>
        <button onclick="gestorAbrirDetalheMesa(${t.num})" style="flex:1;padding:7px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer">📋 Detalhes</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button onclick="cobrarMesaDireta(${t.num})" style="flex:1;padding:7px;border-radius:8px;border:none;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer">💳 Cobrar agora</button>
        <button onclick="fecharMesa(${t.num})" style="flex:1;padding:7px;border-radius:8px;border:none;background:linear-gradient(135deg,var(--accent3),#d97706);color:#000;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer">💰 Fechar mesa</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button onclick="cancelarMesaCompleta(${t.num})" style="flex:1;padding:7px;border-radius:8px;border:1.5px solid rgba(239,68,68,.3);background:rgba(239,68,68,.08);color:#f87171;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer">🗑️ Cancelar mesa</button>
      </div>`;

  const clientesResumo = _salaoResumoClientesMesa(orders);
  const clientesResumoHtml = clientesResumo.some(g => g.label !== 'Mesa toda')
    ? `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:9px 11px;margin:8px 0">
        <div style="font-size:10.5px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Consumo por cliente</div>
        ${clientesResumo.map(g => {
          const pagoCli = (typeof mesaPagoPorCliente === 'function') ? mesaPagoPorCliente(t, g.key) : 0;
          const faltaCli = Math.max(0, Math.round((g.total - pagoCli) * 100) / 100);
          const meta = pagoCli > 0.005
            ? `<div style="font-size:10.5px;color:var(--muted)">Pago R$ ${pagoCli.toFixed(2).replace('.', ',')} · Falta R$ ${faltaCli.toFixed(2).replace('.', ',')}</div>`
            : '';
          return `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:2px 0">
            <span>${_salaoEscape(g.label)}${meta}</span>
            <strong style="color:var(--accent3)">R$ ${g.total.toFixed(2).replace('.', ',')}</strong>
          </div>`;
        }).join('')}
        ${pagoMesa > 0.005 ? `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:5px 0 0;margin-top:4px;border-top:1px solid var(--border)">
          <span style="color:var(--success);font-weight:700">Recebido</span>
          <strong style="color:var(--success)">R$ ${pagoMesa.toFixed(2).replace('.', ',')}</strong>
        </div>` : ''}
      </div>` : (pagoMesa > 0.005 ? `<div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:9px;padding:9px 11px;margin:8px 0">
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px">
          <span style="color:var(--success);font-weight:700">Recebido</span>
          <strong style="color:var(--success)">R$ ${pagoMesa.toFixed(2).replace('.', ',')}</strong>
        </div>
      </div>` : '');

  return `<div style="background:var(--surface);border:1.5px solid ${bordColor};border-radius:14px;padding:16px;margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="font-family:'Playfair Display',sans-serif;font-size:20px;font-weight:900">Mesa ${t.num}</div>
        ${t.guests ? `<span style="font-size:11.5px;color:var(--muted)">${t.guests} pessoas</span>` : ''}
        ${statusLabel}
        ${t.opened_at && t.status !== 'free' ? `<span style="font-size:11px;font-weight:700;color:${_elapsedColor(t.opened_at, isWaiting)};background:${_elapsedColor(t.opened_at, isWaiting)}1a;padding:2px 8px;border-radius:99px">⏱ ${_elapsedLabel(t.opened_at)}</span>` : ''}
        <button onclick="event.stopPropagation();openEditMesa(${t.num})" style="margin-left:4px;background:none;border:1px solid var(--border);border-radius:6px;padding:2px 7px;color:var(--muted);cursor:pointer;font-size:11px;font-family:'DM Sans',sans-serif" title="Editar mesa"></button>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="font-family:'Playfair Display',sans-serif;font-size:20px;font-weight:900;color:var(--accent3)">R$ ${displayTotal.toFixed(2).replace('.', ',')}</div>
      </div>
    </div>
    ${ordersHtml}
    ${clientesResumoHtml}
    ${actionBtn}
  </div>`;
}


async function mesaAdvanceOrder(id) {
  // UI otimista: atualiza imediatamente
  const o = ordersKanban.find(x => x.id === id);
  const co = mesaOrdersCache.find(x => x.id === id);
  const oldStatus = o?.status || co?.status;
  if (o) o.status = 'producao';
  if (co) co.status = 'producao';
  _renderMesaPageFromCache();
  renderKanban();
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'producao', tenant_id: _sessao?.tenant_id })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Erro');
  } catch (e) {
    // Reverte
    if (o) o.status = oldStatus;
    if (co) co.status = oldStatus;
    _renderMesaPageFromCache();
    renderKanban();
    sbToast('err', 'Erro ao atualizar pedido: ' + e.message);
  }
}

async function mesaServOrder(id) {
  // UI otimista: remove dos caches e renderiza imediatamente
  const o = ordersKanban.find(x => x.id === id) || mesaOrdersCache.find(x => x.id === id);
  const savedOrder = o ? { ...o } : null;
  if (o?.phone) _autoAddFidPoints(o.phone, o.total + (o.taxa || 0));
  ordersKanban = ordersKanban.filter(x => x.id !== id);
  mesaOrdersCache = mesaOrdersCache.filter(x => x.id !== id);
  renderKanban();
  _renderMesaPageFromCache();
  sbToast('ok', 'Pedido entregue');
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'entregue', tenant_id: _sessao?.tenant_id })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Erro');
  } catch (e) {
    // Reverte
    if (savedOrder) {
      ordersKanban.unshift(savedOrder);
      mesaOrdersCache.unshift(savedOrder);
      renderKanban();
      _renderMesaPageFromCache();
    }
    sbToast('err', 'Erro ao atualizar pedido: ' + e.message);
  }
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
    ordersKanban = ordersKanban.filter(x => x.id !== id);
    mesaOrdersCache = mesaOrdersCache.filter(x => x.id !== id);
    _renderMesaPageFromCache();
    sbToast('ok', 'Pedido cancelado');
  } catch (e) { sbToast('err', 'Erro ao cancelar: ' + e.message); }
}

// ─────────────────────────────────────────
// ─────────────────────────────────────────



// ─────────────────────────────────────────
// CUPONS
// ─────────────────────────────────────────
function renderCupons() {
  const el = document.getElementById('cupom-list');
  if (!el) return;
  document.getElementById('cupom-count').textContent = cupons.filter(c => c.ativo).length;
  el.innerHTML = cupons.map((c, i) => `
    <div class="coupon-card">
      <div class="coupon-icon" style="background:${c.ativo ? 'rgba(34,197,94,.12)' : 'rgba(100,116,139,.1)'}"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><path d="M2 6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1a2 2 0 0 0 0 4v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-1a2 2 0 0 0 0-4V6z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 4v2M10 10v2" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div style="flex:1">
        <div class="coupon-code">${c.code}</div>
        <div class="coupon-desc">${c.tipo === '%' ? c.val + '% de desconto' : c.tipo === 'frete' ? 'Frete grátis' : 'Desconto R$' + c.val}</div>
        <div class="coupon-use">Usado ${c.usos}x • ${c.minimo > 0 ? 'Pedido mín. R$' + c.minimo : 'Sem pedido mínimo'}</div>
      </div>
      <span class="chip ${c.ativo ? 'chip-green' : 'chip-red'}">${c.ativo ? '● Ativo' : '● Inativo'}</span>
      <button class="btn bg" style="font-size:11px;padding:3px 8px" onclick="toggleCupom(${i})">${c.ativo ? 'Pausar' : 'Ativar'}</button>
      <button class="btn bd" style="font-size:11px;padding:3px 8px" onclick="deleteCupom(${i})"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><path d="M3 4h10M6 4V2.5A.5.5 0 0 1 6.5 2h3a.5.5 0 0 1 .5.5V4M5 4l.7 9.5a.5.5 0 0 0 .5.5h3.6a.5.5 0 0 0 .5-.5L11 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div>`).join('');
}

function toggleCupom(i) { cupons[i].ativo = !cupons[i].ativo; renderCupons(); sbToast('ok', `Cupom ${cupons[i].code} ${cupons[i].ativo ? 'ativado' : 'pausado'}!`); }
async function deleteCupom(idx) {
  const c = cupons[idx];
  if (!c) return;
  const { error } = await sb.from('cupons').delete().eq('id', c.id);
  if (!error) cupons.splice(idx, 1);
  renderCupons();
  showToast(_ICON_TRS, 'Cupom removido');
}
async function addCupom() {
  const code = (document.getElementById('cupom-code').value || '').toUpperCase().trim();
  const val = parseFloat(document.getElementById('cupom-val').value) || 0;
  const tipo = document.getElementById('cupom-tipo').value.includes('%') ? '%' : 'frete';
  if (!code) { sbToast('err', 'Informe o código'); return; }
  sbLoading(true);
  if (!_sessao?.tenant_id) { sbLoading(false); sbToast('err', 'Sessão sem tenant'); return; }
  const { data, error } = await sb.from('cupons').insert({
    tenant_id: _sessao.tenant_id, code, type: tipo === '%' ? 'percent' : 'fixed', value: val, min_order: 0, uses_left: -1, ativo: true
  }).select().single();
  sbLoading(false);
  if (error) { sbToast('err', error.code === '23505' ? 'Código já existe' : 'Erro ao criar cupom'); return; }
  cupons.push({ id: data.id, code, tipo, val, minimo: 0, usos: 0, ativo: true });
  closeModal('modal-add-cupom');
  document.getElementById('cupom-code').value = '';
  renderCupons();
  sbToast('ok', 'Cupom criado!');
}

// ─────────────────────────────────────────
// CASHBACK
// ─────────────────────────────────────────
let _cbClienteAtual = null; // { id, name, phone, cashback_saldo }
let _cbTodosClientes = [];  // cache de todos os clientes com saldo > 0

function _cbPhoneKey(v) {
  const clean = String(v || '').replace(/\D/g, '');
  return clean.startsWith('55') && clean.length > 11 ? clean.slice(2) : clean;
}

function _cbPhoneMatch(a, b) {
  const pa = _cbPhoneKey(a);
  const pb = _cbPhoneKey(b);
  return !!pa && !!pb && (pa === pb || pa.slice(-11) === pb.slice(-11));
}

// ─────────────────────────────────────────
// CARTÃO FIDELIDADE (CARIMBINHO)
// ─────────────────────────────────────────
async function loadStampConfig() {
  try {
    const tid = _sessao?.tenant_id || '';
    const res = await fetch('/api/stamp/config', { headers: { 'x-tenant-id': tid } });
    if (!res.ok) return;
    const cfg = await res.json();
    const tog = document.getElementById('stamp-toggle-ativo');
    if (tog) tog.classList.toggle('on', !!cfg.ativo);
    const meta = document.getElementById('stamp-meta-compras');
    const tipo = document.getElementById('stamp-recompensa-tipo');
    const val  = document.getElementById('stamp-recompensa-valor');
    if (meta) meta.value = cfg.meta_compras || 10;
    if (tipo) tipo.value = cfg.recompensa_tipo || 'pedido_gratis';
    if (val)  val.value  = cfg.recompensa_valor || '';
    _stampTipoChange();
    await stampCarregarProgresso();
  } catch(e) { console.error('[Stamp] loadStampConfig:', e); }
}

async function saveStampConfig(silent) {
  const tid  = _sessao?.tenant_id || '';
  const ativo = document.getElementById('stamp-toggle-ativo')?.classList.contains('on') || false;
  const meta  = parseInt(document.getElementById('stamp-meta-compras')?.value) || 10;
  const tipo  = document.getElementById('stamp-recompensa-tipo')?.value || 'pedido_gratis';
  const valor = parseFloat(document.getElementById('stamp-recompensa-valor')?.value) || 0;
  // Quando salva pelo botão, valida meta. Quando vem do toggle (silent),
  // pula a validação pra não bloquear ativar/desativar com meta vazia.
  if (!silent && (meta < 2 || meta > 100)) { sbToast('err','Meta deve ser entre 2 e 100 compras'); return; }
  if (!silent) sbLoading(true);
  try {
    const r = await fetch('/api/stamp/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ ativo, meta_compras: meta, recompensa_tipo: tipo, recompensa_valor: valor })
    });
    if (!r.ok) throw new Error('Erro');
    if (silent) sbToast('ok', ativo ? 'Cartão fidelidade ativado' : 'Cartão fidelidade desativado');
    else        sbToast('ok', 'Cartão fidelidade salvo!');
  } catch(e) {
    sbToast('err', 'Erro ao salvar');
    // Se falhou, reverte o toggle pra refletir o estado real do banco
    if (silent) {
      const tog = document.getElementById('stamp-toggle-ativo');
      if (tog) tog.classList.toggle('on');
    }
  }
  if (!silent) sbLoading(false);
}

function _stampTipoChange() {
  const tipo = document.getElementById('stamp-recompensa-tipo')?.value;
  const valRow = document.getElementById('stamp-val-row');
  if (valRow) valRow.style.display = (tipo === 'pedido_gratis' || tipo === 'frete_gratis') ? 'none' : '';
}

async function stampCarregarProgresso() {
  const tbody = document.getElementById('stamp-lista-tbody');
  const vazio = document.getElementById('stamp-lista-vazio');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--muted)"><div class="spinner" style="margin:0 auto 8px"></div>Carregando...</td></tr>`;
  try {
    const tid = _sessao?.tenant_id || '';
    const { data, error } = await sb.from('stamp_progress')
      .select('phone,compras,ultimo_resgate')
      .eq('tenant_id', tid)
      .order('compras', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const rows = (data || []);
    if (!rows.length) {
      tbody.innerHTML = '';
      if (vazio) vazio.style.display = '';
      return;
    }
    if (vazio) vazio.style.display = 'none';
    const meta = parseInt(document.getElementById('stamp-meta-compras')?.value) || 10;
    tbody.innerHTML = rows.map(r => {
      const prog = r.compras - (r.ultimo_resgate||0);
      const elegivel = prog >= meta;
      const pct = Math.min(100, Math.round((prog / meta) * 100));
      return `<tr>
        <td style="padding:8px 12px;font-size:13px">${r.phone}</td>
        <td style="padding:8px 12px">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
              <div style="width:${pct}%;height:100%;background:${elegivel?'var(--success)':'var(--accent)'};border-radius:3px"></div>
            </div>
            <span style="font-size:12px;color:${elegivel?'var(--success)':'var(--muted)'};white-space:nowrap">${prog}/${meta}</span>
          </div>
        </td>
        <td style="padding:8px 12px">
          ${elegivel ? '<span class="chip chip-green">🎁 Elegível</span>' : `<span style="font-size:12px;color:var(--muted)">faltam ${meta-prog}</span>`}
        </td>
      </tr>`;
    }).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:16px;color:var(--muted);font-size:13px">Erro ao carregar</td></tr>`;
  }
}

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
  } catch (e) {
    console.error('[Cashback] loadCashbackConfig:', e);
  }
  // Carrega lista de clientes com saldo sempre que abre a aba
  await cbCarregarLista();
}

async function cbCarregarLista() {
  const tbody = document.getElementById('cb-lista-tbody');
  const empty = document.getElementById('cb-lista-vazio');
  const stat = document.getElementById('cb-lista-stat');
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
  } catch (e) {
    console.error('[Cashback] cbCarregarLista:', e);
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--danger)">Erro ao carregar clientes</td></tr>`;
  }
}

function cbRenderLista() {
  const tbody = document.getElementById('cb-lista-tbody');
  const empty = document.getElementById('cb-lista-vazio');
  const search = (document.getElementById('cb-lista-search')?.value || '').toLowerCase();

  const lista = _cbTodosClientes.filter(c =>
    !search ||
    (c.name || '').toLowerCase().includes(search) ||
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
  if (el('cb-phone-busca')) el('cb-phone-busca').value = c.phone || '';
  if (el('cb-res-nome')) el('cb-res-nome').textContent = c.name || '—';
  if (el('cb-res-phone')) el('cb-res-phone').textContent = c.phone || '—';
  if (el('cb-res-saldo')) el('cb-res-saldo').textContent = 'R$ ' + saldo.toFixed(2).replace('.', ',');
  if (el('cb-msg-wa')) el('cb-msg-wa').value = `💰 ${c.name || 'Cliente'}, você tem R$ ${saldo.toFixed(2).replace('.', ',')} de cashback disponível!\nUse no seu próximo pedido 🛍️`;
  if (el('cb-resultado')) el('cb-resultado').style.display = '';
  if (el('cb-busca-vazio')) el('cb-busca-vazio').style.display = 'none';
  // Scrolla até o painel
  el('cb-resultado')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cbSelecionarAjuste(id) {
  cbSelecionarDaLista(id);
  setTimeout(() => document.getElementById('cb-ajuste-val')?.focus(), 300);
}

async function saveCashbackConfig(silent) {
  const ativo = document.getElementById('cb-toggle-ativo')?.classList.contains('on') || false;
  const pct = parseFloat(document.getElementById('cb-pct')?.value) || 0;
  const min_pedido = parseFloat(document.getElementById('cb-min-pedido')?.value) || 0;
  const validade_dias = parseInt(document.getElementById('cb-validade')?.value) || 0;

  // Quando vem do toggle (silent), pula validação de percentual pra permitir
  // desativar mesmo com pct vazio.
  if (!silent && (pct < 0 || pct > 100)) { sbToast('err', 'Percentual deve ser entre 0 e 100'); return; }

  if (!silent) sbLoading(true);
  try {
    const tid = _sessao?.tenant_id || '';
    const res = await fetch('/api/cashback/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ ativo, pct, min_pedido, validade_dias })
    });
    if (res.ok) {
      if (silent) sbToast('ok', ativo ? 'Cashback ativado' : 'Cashback desativado');
      else        sbToast('ok', `Cashback ${ativo ? 'ativado' : 'desativado'} — ${pct}% por pedido`);
    } else {
      const err = await res.json().catch(() => ({}));
      sbToast('err', err.error || 'Erro ao salvar configuração');
      // Reverte o toggle se foi acionado em silent e falhou
      if (silent) {
        const tog = document.getElementById('cb-toggle-ativo');
        if (tog) tog.classList.toggle('on');
      }
    }
  } catch (e) {
    sbToast('err', 'Erro de conexão');
    if (silent) {
      const tog = document.getElementById('cb-toggle-ativo');
      if (tog) tog.classList.toggle('on');
    }
  }
  if (!silent) sbLoading(false);
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
    let cliente = _cbTodosClientes.find(c => _cbPhoneMatch(c.phone, phone));
    if (!cliente) {
      const { data } = await sb.from('customers').select('id,name,phone,cashback_saldo').eq('phone', phone).maybeSingle();
      cliente = data || null;
    }

    const saldo = parseFloat(saldoData.saldo ?? 0);
    const nome = cliente?.name || 'Cliente';
    const tel = cliente?.phone || phone;

    _cbClienteAtual = cliente ? { ...cliente, cashback_saldo: saldo } : { id: null, name: nome, phone: tel, cashback_saldo: saldo };

    const el = key => document.getElementById(key);
    if (el('cb-res-nome')) el('cb-res-nome').textContent = nome;
    if (el('cb-res-phone')) el('cb-res-phone').textContent = tel;
    if (el('cb-res-saldo')) el('cb-res-saldo').textContent = 'R$ ' + saldo.toFixed(2).replace('.', ',');
    if (el('cb-msg-wa')) el('cb-msg-wa').value = `💰 ${nome}, você tem R$ ${saldo.toFixed(2).replace('.', ',')} de cashback disponível!\nUse no seu próximo pedido 🛍️`;
    if (el('cb-resultado')) el('cb-resultado').style.display = '';
    if (el('cb-busca-vazio')) el('cb-busca-vazio').style.display = 'none';

  } catch (e) {
    console.error('[Cashback] cbBuscarCliente:', e);
    sbToast('err', 'Erro ao buscar cliente');
  }
  sbLoading(false);
}

function cbLimparResultado() {
  const el = key => document.getElementById(key);
  if (el('cb-resultado')) el('cb-resultado').style.display = 'none';
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
  } catch (e) {
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
  } catch (e) {
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
let _fidConfig = { pts_por_real: 10, meta_pts: 500, recompensa_reais: 10, ativo: false };

async function loadFidConfig() {
  try {
    const { data } = await sb.from('store_config').select('fid_config').single();
    if (data?.fid_config) _fidConfig = { ..._fidConfig, ...data.fid_config };
  } catch (e) { }
  // Sincroniza UI do toggle quando o modal abre.
  // Importante: backend agora exige ativo === true explícito. Se a config
  // não tem o campo (config antiga), tratamos como desligado pra o gestor
  // saber que precisa reativar conscientemente.
  const tog = document.getElementById('fid-toggle-ativo');
  if (tog) {
    if (_fidConfig.ativo === true) tog.classList.add('on');
    else tog.classList.remove('on');
  }
}

async function saveFidConfig() {
  const pts  = parseInt(document.getElementById('fid-cfg-pts')?.value) || 10;
  const meta = parseInt(document.getElementById('fid-cfg-meta')?.value) || 500;
  const rec  = parseFloat(document.getElementById('fid-cfg-rec')?.value) || 10;
  // Lê estado do toggle "ativo" — quando desligado, backend não envia mais
  // mensagem WA de pontos e a IA não menciona o programa.
  const ativo = !!document.getElementById('fid-toggle-ativo')?.classList.contains('on');
  _fidConfig = { pts_por_real: pts, meta_pts: meta, recompensa_reais: rec, ativo };
  await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, fid_config: _fidConfig });
  // BUG 3 fix: filtra pelo tenant_id correto para não afetar outros tenants
  await sb.from('fidelidade').update({ max_pts: meta }).eq('tenant_id', _sessao?.tenant_id);
  fidClients.forEach(c => c.max = meta);
  closeModal('modal-fid-config');
  renderFidelidade();
  sbToast('ok', 'Configurações salvas!');
}

// Abre o modal de fidelidade já preenchendo os inputs e o toggle com a config
// salva. Se loadFidConfig roda antes de o modal existir no DOM, o toggle não
// fica sincronizado — esse helper garante o estado correto a cada abertura.
async function openFidConfigModal() {
  await loadFidConfig();
  const cp = document.getElementById('fid-cfg-pts');
  const cm = document.getElementById('fid-cfg-meta');
  const cr = document.getElementById('fid-cfg-rec');
  if (cp) cp.value = _fidConfig.pts_por_real ?? 10;
  if (cm) cm.value = _fidConfig.meta_pts ?? 500;
  if (cr) cr.value = _fidConfig.recompensa_reais ?? 10;
  const tog = document.getElementById('fid-toggle-ativo');
  if (tog) {
    if (_fidConfig.ativo === true) tog.classList.add('on');
    else tog.classList.remove('on');
  }
  openModal('modal-fid-config');
}

function renderFidelidade() {
  const search = (document.getElementById('fid-search')?.value || '').toLowerCase();
  const filtered = fidClients.filter(c => c.name.toLowerCase().includes(search) || (c.phone || '').includes(search));

  // Stats
  const elv = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  const totalPts = fidClients.reduce((s, c) => s + c.pts, 0);
  const resgatados = fidClients.filter(c => c.resgates > 0).length;
  const perto = fidClients.filter(c => c.pts >= c.max * 0.8 && c.pts < c.max).length;
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
    .sort((a, b) => b.pts - a.pts)
    .map(cl => {
      const pct = Math.min(100, (cl.pts / cl.max) * 100);
      const canResgatar = cl.pts >= cl.max;
      const barColor = canResgatar ? 'var(--success)' : pct >= 80 ? 'var(--accent3)' : 'var(--accent)';
      const initials = cl.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
      return `<div style="background:var(--surface);border:1px solid ${canResgatar ? 'rgba(34,197,94,.3)' : 'var(--border)'};border-radius:12px;padding:14px;margin-bottom:10px;display:flex;align-items:center;gap:14px">
        <div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,var(--accent),var(--purple));display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0">${initials}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
            <div style="font-weight:700;font-size:13.5px">${cl.name}</div>
            ${canResgatar ? '<span style="font-size:10px;background:rgba(34,197,94,.15);color:var(--success);padding:1px 6px;border-radius:99px;font-weight:700">🎁 PODE RESGATAR</span>' : ''}
          </div>
          <div style="font-size:11.5px;color:var(--muted);margin-bottom:6px">${cl.phone || 'Sem telefone'} · ${cl.orders} pedidos · ${cl.resgates || 0} resgates</div>
          <div style="background:var(--surface2);border-radius:99px;height:6px;overflow:hidden;margin-bottom:3px">
            <div style="width:${pct}%;height:100%;background:${barColor};border-radius:99px;transition:width .4s"></div>
          </div>
          <div style="font-size:10.5px;color:var(--muted)">${cl.pts} / ${cl.max} pontos (${pct.toFixed(0)}%) • recompensa: R$ ${_fidConfig.recompensa_reais.toFixed(2).replace('.', ',')}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
          <button class="btn bg" style="font-size:11px;padding:4px 10px" onclick="openAddPts(${cl.id},'${cl.name.replace(/'/g, "\'")}',${cl.pts})">+ Pontos</button>
          ${canResgatar ? `<button class="btn bs" style="font-size:11px;padding:4px 10px" onclick="openResgatar(${cl.id},'${cl.name.replace(/'/g, "\'")}',${cl.pts},${cl.max})">🎁 Resgatar</button>` : ''}
          <button class="btn bd" style="font-size:11px;padding:4px 10px" onclick="deleteFidClient(${cl.id},'${cl.name.replace(/'/g, "\'")}')">✕</button>
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
  const id = parseInt(document.getElementById('modal-pts-client-id').value);
  const qty = parseInt(document.getElementById('modal-pts-qty').value) || 0;
  const motivo = document.getElementById('modal-pts-motivo').value;
  if (!qty || qty < 1) { sbToast('err', 'Informe os pontos'); return; }
  const cl = fidClients.find(c => c.id === id);
  if (!cl) return;
  const newPts = cl.pts + qty;
  const { error } = await sb.from('fidelidade').update({ pts: newPts }).eq('id', id);
  if (error) { sbToast('err', 'Erro ao adicionar pontos'); return; }
  cl.pts = newPts;
  closeModal('modal-add-pts');
  renderFidelidade();
  sbToast('ok', `+${qty} pontos para ${cl.name}!`);
  if (newPts >= cl.max) sbToast('ok', `${cl.name} pode resgatar a recompensa!`);
}

function openResgatar(id, name, pts, max) {
  document.getElementById('modal-resg-id').value = id;
  document.getElementById('modal-resg-name').textContent = name;
  document.getElementById('modal-resg-valor').textContent = 'R$ ' + _fidConfig.recompensa_reais.toFixed(2).replace('.', ',') + ' de desconto';
  document.getElementById('modal-resg-pts').textContent = pts + ' pontos serão zerados';
  openModal('modal-resgatar');
}

async function confirmResgatar() {
  const id = parseInt(document.getElementById('modal-resg-id').value);
  const cl = fidClients.find(c => c.id === id);
  if (!cl) return;
  const { error } = await sb.from('fidelidade').update({ pts: 0, resgates: (cl.resgates || 0) + 1 }).eq('id', id);
  if (error) { sbToast('err', 'Erro ao resgatar'); return; }
  cl.pts = 0;
  cl.resgates = (cl.resgates || 0) + 1;
  closeModal('modal-resgatar');
  renderFidelidade();
  sbToast('ok', `Recompensa resgatada para ${cl.name}!`);
}

async function addFidClient() {
  const name = document.getElementById('fid-add-name').value.trim();
  const phone = document.getElementById('fid-add-phone').value.trim();
  if (!name) { sbToast('err', 'Informe o nome'); return; }
  if (!_sessao?.tenant_id) { sbToast('err', 'Sessão sem tenant'); return; }
  const { data, error } = await sb.from('fidelidade').insert({
    tenant_id: _sessao.tenant_id,
    name, phone, pts: 0, max_pts: _fidConfig.meta_pts, orders_count: 0, resgates: 0
  }).select().single();
  if (error) { sbToast('err', 'Erro ao cadastrar'); return; }
  fidClients.unshift({ id: data.id, name: data.name, phone: data.phone, pts: 0, max: _fidConfig.meta_pts, orders: 0, resgates: 0 });
  closeModal('modal-add-fid-client');
  document.getElementById('fid-add-name').value = '';
  document.getElementById('fid-add-phone').value = '';
  renderFidelidade();
  sbToast('ok', `${name} cadastrado no programa!`);
}

async function deleteFidClient(id, name) {
  if (!confirm(`Remover ${name} do programa de fidelidade?`)) return;
  const { error } = await sb.from('fidelidade').delete().eq('id', id);
  if (error) { sbToast('err', 'Erro ao remover'); return; }
  fidClients = fidClients.filter(c => c.id !== id);
  renderFidelidade();
  sbToast('ok', `${name} removido do programa`);
}

// Chamado ao confirmar pagamento — adiciona pontos automaticamente se cliente estiver no programa
async function _autoAddFidPoints(clientPhone, totalVal) {
  if (!clientPhone || !totalVal) return;
  const cl = fidClients.find(c => c.phone && c.phone.replace(/\D/g, '') === clientPhone.replace(/\D/g, ''));
  if (!cl) return;
  const pts = Math.floor(totalVal * _fidConfig.pts_por_real);
  if (pts < 1) return;
  const newPts = cl.pts + pts;
  await sb.from('fidelidade').update({ pts: newPts, orders_count: cl.orders + 1 }).eq('id', cl.id);
  cl.pts = newPts; cl.orders++;
  sbToast('ok', `+${pts} pontos fidelidade para ${cl.name}`);
  if (newPts >= cl.max) sbToast('ok', `${cl.name} atingiu a recompensa!`);
}


// ─────────────────────────────────────────
// GARÇOM
// ─────────────────────────────────────────
function renderGarcom() {
  const g = document.getElementById('garcom-grid');
  if (!g) return;
  g.innerHTML = tables.map(t => {
    const sc = t.status === 'free' ? 'qr-free' : 'qr-busy';
    const bg = t.status === 'free' ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)';
    return `<div class="garcom-mesa" style="background:${bg}" onclick="openGarcomMesa(${t.num})">
      <div class="gm-num">Mesa ${t.num}</div>
      <div class="gm-guests">${t.guests ? t.guests + ' pessoas' : ''}</div>
      <div class="gm-status ${sc}">${t.status === 'free' ? 'Livre' : 'Ocupada'}</div>
      ${t.total && t.status === 'busy' ? `<div style="font-size:12px;font-weight:700;color:var(--success);margin-top:5px">${t.total}</div>` : ''}
      <button class="btn bp" style="width:100%;justify-content:center;font-size:11.5px;margin-top:9px;padding:5px">➕ Lançar pedido</button>
    </div>`;
  }).join('');
}

function openGarcomMesa(num) {
  garcomMesa = num; garcomCart = [];
  document.getElementById('garcom-mesa-num').textContent = num;
  const gg = document.getElementById('garcom-item-grid');

  // ── Renderiza um cartão de item (mesmo HTML de antes, extraído pra reuso) ──
  const _renderCard = (i) => {
    const isPizza = i.itemType === 'pizza';
    const isKg    = i.itemType === 'kg';
    const hasAdd  = Array.isArray(i.customGroups) && i.customGroups.length > 0;
    const imgHtml = i.imageUrl
      ? `<img src="${i.imageUrl}" style="width:100%;height:48px;object-fit:cover;border-radius:7px">`
      : `<span style="font-size:22px">${i.emoji || '🍽️'}</span>`;
    const badge   = isPizza ? '<div style="font-size:8px;background:rgba(245,158,11,.15);color:var(--accent3);border-radius:3px;padding:1px 4px;font-weight:700;margin-top:2px;display:inline-block">PIZZA</div>'
                  : isKg    ? '<div style="font-size:8px;background:rgba(34,197,94,.15);color:#16a34a;border-radius:3px;padding:1px 4px;font-weight:700;margin-top:2px;display:inline-block">KG</div>'
                  : hasAdd  ? '<div style="font-size:8px;background:rgba(59,130,246,.15);color:var(--accent);border-radius:3px;padding:1px 4px;font-weight:700;margin-top:2px;display:inline-block">ADICIONAIS</div>'
                  : '';
    return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:9px;text-align:center;cursor:pointer;transition:all .15s;position:relative" onclick="garcomAddItem(${i.id},this)" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="if(!this.dataset.sel)this.style.borderColor='var(--border)'">
      <div style="height:48px;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:7px">${imgHtml}</div>
      <div style="font-size:11px;font-weight:600;margin-top:3px">${i.name}</div>
      <div style="font-size:10.5px;color:var(--accent)">R$ ${i.price.toFixed(2).replace('.', ',')}</div>
      ${badge}
    </div>`;
  };

  const ativos = items.filter(i => i.status === 'active');

  // ── Agrupa itens por categoria respeitando a ordem do gestor (sort_order) ──
  // Antes: tudo aparecia num grid único, sem separação. Agora cada categoria
  // vira uma seção com cabeçalho, na ordem definida em /Cardápio/Categorias.
  // O CSS do grid (#garcom-item-grid) provavelmente é display:grid, então
  // pra ter cabeçalho ocupando linha inteira usamos grid-column: 1/-1.
  const cats = Array.isArray(categories) ? categories : [];
  const semCat = [];
  const usados = new Set();
  const blocos = [];

  for (const c of cats) {
    const itensCat = ativos.filter(i =>
      i.cat === c.name || i.catKey === c.name ||
      i.cat === c.label || i.catKey === c.label
    );
    if (!itensCat.length) continue;
    itensCat.forEach(i => usados.add(i.id));
    const titulo = c.label || c.name;
    blocos.push(
      `<div style="grid-column:1/-1;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;padding:8px 2px 4px;border-bottom:1px dashed var(--border);margin-top:6px">${titulo}</div>` +
      itensCat.map(_renderCard).join('')
    );
  }

  // Itens sem categoria (ou com cat que não bateu com nenhuma categoria conhecida)
  // vão pra um bloco "Outros" no fim, pra não desaparecer da tela.
  ativos.forEach(i => {
    if (!usados.has(i.id)) semCat.push(i);
  });
  if (semCat.length) {
    blocos.push(
      `<div style="grid-column:1/-1;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;padding:8px 2px 4px;border-bottom:1px dashed var(--border);margin-top:6px">Outros</div>` +
      semCat.map(_renderCard).join('')
    );
  }

  // Se não houver categorias cadastradas (config antiga), cai no comportamento
  // antigo de mostrar tudo num grid único — sem cabeçalho mas funcional.
  gg.innerHTML = blocos.length ? blocos.join('') : ativos.map(_renderCard).join('');
  document.getElementById('garcom-cart-preview').textContent = 'Nenhum item selecionado';
  openModal('modal-garcom-mesa');
}

function garcomAddItem(id, el) {
  const it = items.find(i => i.id === id);
  if (!it) return;

  // Se tem adicionais, é pizza ou kg → abre modal completo
  if (it.itemType === 'pizza') { window._pdvPizzaSource = 'garcom'; openPDVPizza(id); return; }

  const grupos = (() => { try { return Array.isArray(it.customGroups) ? it.customGroups : JSON.parse(it.customGroups || '[]') } catch { return [] } })()
    .filter(g => !['porcao_ref', 'kit_itens'].includes(g.tipo));
  const isKg = it.itemType === 'kg';

  if (grupos.length > 0 || isKg) {
    // Reutiliza o modal de adicionais do PDV, marcando fonte como garçom
    window._pdvAddItemSource = 'garcom';
    _pdvAbrirModalItem(it, grupos, isKg);
    return;
  }

  // Sem customização → adiciona direto
  const obsKit = (typeof _pedidoObsComKit === 'function') ? _pedidoObsComKit(it, '') : '';
  const ci = garcomCart.find(c => c.id === id && (c.obs || '') === obsKit);
  if (ci) ci.qty++; else garcomCart.push({ ...it, qty: 1, obs: obsKit });
  el.style.borderColor = 'var(--accent)'; el.dataset.sel = '1'; el.style.background = 'rgba(59,130,246,.1)';
  _garcomUpdatePreview();
  sbToast('ok', `${it.name} adicionado!`);
}

function _garcomUpdatePreview() {
  const prev = document.getElementById('garcom-cart-preview');
  if (!prev) return;
  if (garcomCart.length === 0) { prev.textContent = 'Nenhum item selecionado'; return; }
  prev.innerHTML = garcomCart.map(c => {
    const desc = c.obs ? ` <span style="font-size:10px;color:var(--muted)">(${c.obs})</span>` : '';
    return `${c.qty}x ${c.name}${desc}`;
  }).join(' • ')
    + `<br><strong style="color:var(--success)">Total: R$ ${garcomCart.reduce((s, c) => s + c.price * c.qty, 0).toFixed(2).replace('.', ',')}</strong>`;
}

async function submitGarcomOrder() {
  if (garcomCart.length === 0) { sbToast('err', 'Selecione itens'); return; }

  // Separa itens: cozinha (vão ao kanban) vs imediatos (bebidas, etc — só billing)
  // Só pula kanban para bebidas industrializadas prontas.
  // Sucos, vitaminas, smoothies e tudo preparado manualmente vai ao kanban.
  const _skipKanban = (c) => {
    const txt = (c.name + ' ' + (c.cat || c.catKey || c.cat_key || '')).toLowerCase();
    // Itens preparados manualmente — sempre kanban
    const preparados = /suco|vitamina|smoothie|milkshake|limonada|caipir|caldo|açaí|acai|tigela|bowl|pizza|hamburguer|hambúrguer|burger|lanche|sanduiche|sanduíche|wrap|tapioca|crepe|waffle|panqueca|prato|marmita|salada|massa|macarrão|fettuc|risoto|sushi|temaki|espeto|grelhado|assado|frito|porção|porcao|frango|carne|peixe|camarão|bife|churrasco/;
    if (preparados.test(txt)) return false;
    // Bebidas industrializadas prontas — pula kanban
    const industrial = /refrigerante|coca|pepsi|guarana|guaraná|fanta|sprite|soda|tônica|tonica|agua\s|água\s|^agua|^água|agua com|água com|agua sem|mineral|cerveja|chopp|brahma|skol|heineken|budweiser|corona|stella|amstel|itaipava|vinho|espumante|champagne|dose|tanque|long.neck|long neck|energetico|energético|red.bull|monster|gatorade|powerade|isot/;
    return industrial.test(txt);
  };

  const itensCozinha   = garcomCart.filter(c => !_skipKanban(c));
  const itensImediatos = garcomCart.filter(c =>  _skipKanban(c));
  const totCozinha     = itensCozinha.reduce((s, c) => s + c.price * c.qty, 0);
  const totImediato    = itensImediatos.reduce((s, c) => s + c.price * c.qty, 0);
  const totTotal       = totCozinha + totImediato;

  const t    = tables.find(x => x.num === garcomMesa);
  const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  sbLoading(true);
  try {
    // Garante opened_at na mesa
    const _mesa = tables.find(t => t.num === garcomMesa);
    if (_mesa && (_mesa.status !== 'busy' || !_mesa.opened_at)) {
      const _ot = new Date().toISOString();
      const _payload = { status: 'busy', updated_at: _ot };
      if (!_mesa.opened_at || _mesa.status === 'free') _payload.opened_at = _ot;
      await sb.from('mesas').update(_payload).eq('num', garcomMesa);
      _mesa.status = 'busy'; if (_payload.opened_at) _mesa.opened_at = _ot; _mesa.updated_at = _ot;
    }

    // 1. Itens de cozinha → kanban (analise/producao)
    if (itensCozinha.length > 0) {
      if (!_sessao?.tenant_id) throw new Error('Sessão sem tenant');
      const itemsArr = itensCozinha.map(c => ({
        id: c.id || null,
        qty: c.qty,
        name: c.name,
        price: c.price,
        cat: c.cat || '',
        cat_key: c.cat_key || c.catKey || c.cat || '',
        obs: c.obs || ''
      }));
      const { data: orderData, error: oErr } = await sb.from('orders').insert({
        tenant_id: _sessao.tenant_id,
        client: `Mesa ${garcomMesa}`, phone: '', addr: `Mesa ${garcomMesa}`,
        mesa_num: garcomMesa, items: itemsArr, total: totCozinha, taxa: 0,
        status: mesaAutoAccept ? 'producao' : 'analise', time, pag: 'Mesa'
      }).select().single();
      if (oErr) throw oErr;
      if (!mesaOrdersCache.find(o => o.id === orderData.id)) mesaOrdersCache.unshift(orderData);
      ordersKanban.push(mapOrder(orderData));
    }

    // 2. Itens imediatos (bebidas, etc) → direto como entregue (só billing, não vão ao kanban)
    if (itensImediatos.length > 0) {
      if (!_sessao?.tenant_id) throw new Error('Sessão sem tenant');
      const itemsArrImediato = itensImediatos.map(c => ({
        id: c.id || null,
        qty: c.qty,
        name: c.name,
        price: c.price,
        cat: c.cat || '',
        cat_key: c.cat_key || c.catKey || c.cat || '',
        obs: c.obs || ''
      }));
      const { data: billingData, error: bErr } = await sb.from('orders').insert({
        tenant_id: _sessao.tenant_id,
        client: `Mesa ${garcomMesa}`, phone: '', addr: `Mesa ${garcomMesa}`,
        mesa_num: garcomMesa, items: itemsArrImediato, total: totImediato, taxa: 0,
        status: 'entregue', time, pag: 'Mesa'
      }).select().single();
      if (bErr) throw bErr;
      // Adiciona ao cache para billing mas não ao kanban
      if (billingData && !mesaOrdersCache.find(o => o.id === billingData.id)) {
        mesaOrdersCache.unshift(billingData);
      }
    }

    if (t) { t.status = 'busy'; t.guests = t.guests || 2; }
    closeModal('modal-garcom-mesa');
    renderGarcom();
    _renderMesaPageFromCache();
    playOrderSound();

    // ── Impressão automática do pedido recém-adicionado ─────────────
    // Antes esse fluxo NÃO imprimia nada — pedido só ia pro banco. Bebidas
    // industrializadas (água/refri) com status='entregue' não passavam pelo
    // kanban e não disparavam impressão. Agora imprimimos aqui mesmo.
    try {
      const _autoPrintOn = (window._printMode || _printMode || 'auto') === 'auto';
      const _printerCaixa   = (typeof _printPrinter !== 'undefined' && _printPrinter) || localStorage.getItem('printPrinter') || '';
      const _printerCozinha = (typeof _printPrinterCozinha !== 'undefined' && _printPrinterCozinha) || localStorage.getItem('printPrinterCozinha') || '';
      const _viaMode = (typeof _printViaMode !== 'undefined' && _printViaMode) || localStorage.getItem('printViaMode') || 'combinado';
      const _temSetoresCategoria = (() => {
        try {
          const routes = JSON.parse(localStorage.getItem('printSetoresCategoria') || '{}');
          return routes && typeof routes === 'object' && Object.values(routes).some(Boolean);
        } catch (_) {
          return false;
        }
      })();
      const _doisImpressoras = _viaMode === 'separado' && (_printerCozinha || _temSetoresCategoria);
      const _fmt = localStorage.getItem('printFormat') || '80mm';
      const _pw  = _fmt === '58mm' ? 58 : 80;
      const _nomeLoja = (_sessao?.nome || 'RESTAURANTE').toUpperCase();
      const _now = new Date().toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const _fontSize = (typeof _printFontSize !== 'undefined' ? _printFontSize : null) || 13;

      const _renderViaHtml = (titulo, lista) => {
        if (!lista.length) return '';
        const linhas = lista.map(c => {
          const obs = c.obs ? `<div style="padding-left:12px;font-size:0.88em">↳ ${c.obs}</div>` : '';
          return `<div style="margin-bottom:4px"><div style="font-weight:bold;word-break:break-word">${c.qty}x ${(c.name||'').toUpperCase()}</div>${obs}</div>`;
        }).join('');
        return `<div class="print-ticket" style="font-size:${_fontSize}px">
          <div style="text-align:center;font-size:1.1em;font-weight:900">${_nomeLoja}</div>
          <div style="text-align:center;font-weight:bold;margin:4px 0">*** ${titulo} ***</div>
          <hr style="border:none;border-top:1px dashed #000;margin:4px 0">
          <div>Mesa: <b>${garcomMesa}</b></div>
          <div>Data: ${_now}</div>
          <hr style="border:none;border-top:1px dashed #000;margin:4px 0">
          ${linhas}
          <hr style="border:none;border-top:1px dashed #000;margin:4px 0">
          <div style="text-align:center;font-size:0.85em">Bom apetite!</div>
        </div>`;
      };

      const _htmlCozinha = _renderViaHtml('VIA DA COZINHA', itensCozinha);
      const _htmlBar     = _renderViaHtml('VIA DO BAR',     itensImediatos);
      const _setorJobs = (typeof _buildSetorPrintJobsForItems === 'function')
        ? _buildSetorPrintJobsForItems(
            { client: `Mesa ${garcomMesa}`, addr: `Mesa ${garcomMesa}`, mesa_num: garcomMesa, pag: 'Mesa' },
            { fontSize: _fontSize, rodape: 'Bom apetite!' },
            itensCozinha,
            { defaultPrinter: _printerCozinha, defaultTitle: 'Cozinha' }
          )
        : [];

      // Toggle "Imprimir bebida industrializada sozinha" — se desligado e o
      // pedido é só industrializada, pula a impressão. Caso contrário imprime.
      const _printBebidaSolo = localStorage.getItem('printBebidaSolo') !== '0';
      const _soBebida = !_htmlCozinha && _htmlBar;
      console.log('[GESTOR MESA PRINT] auto:', _autoPrintOn, '| modo vias:', _viaMode, '| toggle bebida:', _printBebidaSolo, '| só bebida:', !!_soBebida, '| 2 impressoras:', _doisImpressoras, '| caixa:', _printerCaixa || '(padrão)', '| cozinha:', _printerCozinha || '(nenhuma)');
      if (_soBebida && !_printBebidaSolo) {
        console.log('[GESTOR MESA PRINT] Pedido só de bebida e toggle desligado — não imprime.');
      }
      if (_autoPrintOn && !(_soBebida && !_printBebidaSolo) && (_htmlCozinha || _htmlBar)) {
        if (_doisImpressoras) {
          // Com cozinha separada, producao nao vai para o caixa.
          // Caixa fica para fechamento/conta ou impressao solicitada pelo cliente.
          if (window.ElectronPrint?.printHtml) {
            const cozinhaJobs = _setorJobs.length ? _setorJobs : (_htmlCozinha ? [{ html: _htmlCozinha, printer: _printerCozinha }] : []);
            for (const job of cozinhaJobs) {
              await window.ElectronPrint.printHtml(job.html, { printer: job.printer || _printerCozinha, paperWidth: _pw }).catch(()=>{});
            }
          } else {
            // Print Agent fallback
            const _tid = _sessao?.tenant_id;
            if (_tid) {
              const jobs = [];
              if (_setorJobs.length) {
                _setorJobs.forEach(job => jobs.push(fetch('/api/print-queue/job', { method:'POST', headers:{'Content-Type':'application/json','x-tenant-id':_tid}, body: JSON.stringify({ html: job.html, format: _fmt, printer: job.printer || undefined, tipo: job.tipo || 'cozinha' }) })));
              } else if (_htmlCozinha) {
                jobs.push(fetch('/api/print-queue/job', { method:'POST', headers:{'Content-Type':'application/json','x-tenant-id':_tid}, body: JSON.stringify({ html: _htmlCozinha, format: _fmt, printer: _printerCozinha, tipo: 'cozinha' }) }));
              }
              await Promise.all(jobs).catch(()=>{});
            }
          }
        } else {
          // Uma impressora só — junta tudo numa folha
          const _htmlTudo = [_htmlCozinha, _htmlBar].filter(Boolean).join('<div style="page-break-before:always"></div>');
          if (window.ElectronPrint?.printHtml) {
            await window.ElectronPrint.printHtml(_htmlTudo, { printer: _printerCaixa, paperWidth: _pw }).catch(()=>{});
          } else {
            const _tid = _sessao?.tenant_id;
            if (_tid) {
              await fetch('/api/print-queue/job', { method:'POST', headers:{'Content-Type':'application/json','x-tenant-id':_tid}, body: JSON.stringify({ html: _htmlTudo, format: _fmt, printer: _printerCaixa || undefined, tipo: 'caixa' }) }).catch(()=>{});
            }
          }
        }
      }
    } catch (printErr) {
      console.warn('[GESTOR MESA] Erro na impressão:', printErr.message);
    }

    const partes = [];
    if (itensCozinha.length)   partes.push(`${itensCozinha.length} item(s) → cozinha`);
    if (itensImediatos.length) partes.push(`${itensImediatos.length} item(s) → direto`);
    sbToast('ok', `Mesa ${garcomMesa} — ${partes.join(' | ')} — Total R$ ${totTotal.toFixed(2).replace('.', ',')}`);
  } catch (e) {
    sbToast('err', 'Erro ao enviar pedido');
    console.error(e);
  } finally { sbLoading(false); }
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL DETALHE DA MESA — Ver itens, cancelar, adicionar, imprimir conta
// ══════════════════════════════════════════════════════════════════════════════

let _detalheMesaNum = null;
let _detalheMesaOrders = [];
let _detalheMesaSubtotal = 0;

// ── Cancelar mesa completa ────────────────────────────────────────────────────
async function cancelarMesaCompleta(num) {
  const numInt = parseInt(num);
  if (!confirm(`Cancelar TODOS os pedidos da Mesa ${numInt} e liberar a mesa?\nEsta ação não pode ser desfeita.`)) return;

  sbLoading(true);
  try {
    // Cancela todos os pedidos ativos
    await sb.from('orders')
      .update({ status: 'cancelado', updated_at: new Date().toISOString() })
      .eq('mesa_num', numInt)
      .in('status', ['mesa_aberta', 'analise', 'producao', 'pronto', 'waiting']);

    // Libera a mesa
    await sb.from('mesas').update({
      status: 'free', total: null, pag_forma: null,
      guests: null, opened_at: null, taxa_servico: null, clientes_json: [], pagamentos_json: [],
      updated_at: new Date().toISOString()
    }).eq('num', numInt);

    // Limpa cache local
    mesaOrdersCache = mesaOrdersCache.filter(o => parseInt(o.mesa_num) !== numInt);
    ordersKanban = ordersKanban.filter(o => parseInt(o.mesa_num) !== numInt);
    const t = tables.find(x => parseInt(x.num) === numInt);
    if (t) { t.status = 'free'; t.total = null; t.opened_at = null; t.taxa_servico = 0; t.clientes_json = []; t.pagamentos_json = []; }

    renderKanban();
    _renderMesaPageFromCache();
    renderQR();
    sbToast('ok', `Mesa ${numInt} cancelada e liberada`);
  } catch(e) {
    sbToast('err', 'Erro ao cancelar mesa: ' + (e?.message || e));
  } finally {
    sbLoading(false);
  }
}

// ── Reabrir mesa (desfaz fechar/cobrar antes do pagamento) ────────────────────
async function reabrirMesa(num) {
  const numInt = parseInt(num);
  if (!confirm(`Reabrir Mesa ${numInt}?\nA mesa voltará para o estado ocupada, aguardando novos lançamentos.`)) return;

  sbLoading(true);
  try {
    // Volta mesa para busy
    await sb.from('mesas').update({
      status: 'busy', total: null, pag_forma: null,
      updated_at: new Date().toISOString()
    }).eq('num', numInt);

    const t = tables.find(x => parseInt(x.num) === numInt);
    if (t) { t.status = 'busy'; t.total = null; t.pag_forma = null; }

    await refreshMesa(numInt);
    _renderMesaPageFromCache();
    renderQR();
    sbToast('ok', `Mesa ${numInt} reaberta`);
  } catch(e) {
    sbToast('err', 'Erro ao reabrir mesa: ' + (e?.message || e));
  } finally {
    sbLoading(false);
  }
}

async function gestorAbrirDetalheMesa(num) {
  _detalheMesaNum = parseInt(num);
  document.getElementById('mesa-detalhe-title').textContent = `Mesa ${num} — Detalhes`;
  document.getElementById('mesa-detalhe-num').value = num;
  document.getElementById('mesa-detalhe-itens-list').innerHTML =
    '<div style="font-size:12px;color:var(--muted);text-align:center;padding:8px">Carregando...</div>';
  openModal('modal-mesa-detalhe');

  try {
    // Pedidos ficam como mesa_aberta até o gestor confirmar pagamento
    // Query simples e direta — sem filtro de sessão necessário
    const { data } = await sb.from('orders')
      .select('*')
      .eq('mesa_num', _detalheMesaNum)
      .in('status', ['mesa_aberta', 'analise', 'producao', 'pronto'])
      .order('id', { ascending: true });

    _detalheMesaOrders = (data || []).map(o => ({ ...o, items: _parseItems(o.items) }));
  } catch(e) {
    document.getElementById('mesa-detalhe-itens-list').innerHTML =
      '<div style="font-size:12px;color:var(--red);text-align:center;padding:8px">Erro ao carregar</div>';
    return;
  }

  const comanda = _detalheMesaOrders.find(o => o.status === 'mesa_aberta');
  document.getElementById('mesa-detalhe-order-id').value = comanda ? comanda.id : '';
  _renderDetalheMesaItens();
}

function _renderDetalheMesaItens() {
  const listEl = document.getElementById('mesa-detalhe-itens-list');
  const itemMap = [];

  _detalheMesaOrders.forEach(o => {
    (_parseItems(o.items)).forEach(i => {
      itemMap.push({
        orderId: o.id,
        orderStatus: o.status,
        itemId: i.item_id || null,
        name: i.name,
        qty: i.qty || 1,
        price: i.price || 0,
        obs: i.obs || '',
        clienteNome: i.cliente_nome || '',
        clienteRef: i.cliente_ref || '',
        status: i.item_status || 'active',
        drink: !!i.drink,
        garcomNome: i.garcom_nome || '',
        isTaxa: i.item_type === 'taxa'
      });
    });
  });

  if (!itemMap.length) {
    listEl.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:8px">Nenhum item na mesa</div>';
    _detalheMesaSubtotal = 0;
    document.getElementById('mesa-detalhe-subtotal').textContent = 'R$ 0,00';
    _toggleTaxaDetalhe();
    return;
  }

  let subtotal = 0;
  const clientesResumo = _salaoResumoClientesMesa(_detalheMesaOrders);
  const clientesHtml = clientesResumo.some(g => g.label !== 'Mesa toda')
    ? `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:9px 11px;margin-top:10px">
        <div style="font-size:10.5px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Consumo por cliente</div>
        ${clientesResumo.map(g => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:2px 0">
          <span>${_salaoEscape(g.label)}</span>
          <strong style="color:var(--accent3)">R$ ${g.total.toFixed(2).replace('.', ',')}</strong>
        </div>`).join('')}
      </div>` : '';

  listEl.innerHTML = itemMap.map((i, idx) => {
    const isCanceled = i.status === 'cancelado';
    const lineTotal = i.price * i.qty;
    if (!isCanceled) subtotal += lineTotal;
    const cancelStyle = isCanceled ? 'opacity:.4;text-decoration:line-through;' : '';
    const garcomTag = i.garcomNome ? ` <span style="font-size:9px;background:rgba(129,140,248,.15);color:#818cf8;padding:1px 5px;border-radius:4px">${i.garcomNome}</span>` : '';
    const clienteTag = i.clienteNome ? ` <span style="font-size:9px;background:rgba(34,197,94,.12);color:var(--green);padding:1px 5px;border-radius:4px;font-weight:700">${_salaoEscape(i.clienteNome)}</span>` : '';
    const taxaBadge = i.isTaxa ? ` <span style="font-size:9px;background:rgba(196,149,106,.15);color:var(--amber);padding:1px 6px;border-radius:99px;font-weight:700">%</span>` : '';
    const statusIcon = i.isTaxa ? '💰' : ({ producao:'🍳', pronto:'✅', entregue:'🟢', cancelado:'❌' }[i.status] || '🔵');
    const btns = isCanceled
      ? ''
      : `<div style="display:flex;gap:4px;margin-top:4px">
          <button onclick="gestorCancelarItem(${idx})" style="padding:3px 8px;border-radius:6px;border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.08);color:#f87171;font-size:10px;font-weight:600;cursor:pointer">✕ ${i.isTaxa ? 'Remover taxa' : 'Cancelar'}</button>
          ${!i.isTaxa ? `<button onclick="gestorTransferirItem(${idx})" style="padding:3px 8px;border-radius:6px;border:1px solid rgba(129,140,248,.3);background:rgba(129,140,248,.08);color:#818cf8;font-size:10px;font-weight:600;cursor:pointer">↗ Transferir</button>` : ''}
        </div>`;
    return `<div style="padding:8px 0;border-bottom:1px solid var(--border);${cancelStyle}">
      <div style="display:flex;justify-content:space-between;align-items:start">
        <div>
          <span style="font-size:10px">${statusIcon}</span>
          <span style="font-size:13px;font-weight:600">${i.qty}× ${i.name}</span>
          ${taxaBadge}${clienteTag}${garcomTag}
          ${i.obs ? `<div style="font-size:11px;color:var(--muted);padding-left:16px">↳ ${i.obs}</div>` : ''}
        </div>
        <span style="font-size:13px;font-weight:700;color:var(--accent3);white-space:nowrap">R$ ${lineTotal.toFixed(2).replace('.',',')}</span>
      </div>
      ${btns}
    </div>`;
  }).join('') + clientesHtml;

  _detalheMesaSubtotal = subtotal;
  document.getElementById('mesa-detalhe-subtotal').textContent = 'R$ ' + subtotal.toFixed(2).replace('.',',');

  // Taxa agora é item da comanda — sem necessidade de checkbox separado
  const taxaRow = document.getElementById('mesa-detalhe-taxa-row');
  if (taxaRow) taxaRow.style.display = 'none';
  _toggleTaxaDetalhe();
}

function _toggleTaxaDetalhe() {
  const check = document.getElementById('mesa-detalhe-taxa-check');
  const sub = _detalheMesaSubtotal;
  const pct = _taxaServicoPct || 0;
  // Se taxa já foi aplicada pelo garçom, usa o valor gravado em mesas.taxa_servico
  const mesaTd = tables.find(x => parseInt(x.num) === _detalheMesaNum);
  const taxaPreAplic = parseFloat(mesaTd?.taxa_servico || 0);
  const taxa = check?.checked ? (taxaPreAplic > 0 ? taxaPreAplic : sub * pct / 100) : 0;
  const total = sub + taxa;
  const info = document.getElementById('mesa-detalhe-taxa-info');
  if (info) info.style.display = check?.checked ? 'block' : 'none';
  document.getElementById('mesa-detalhe-taxa-val').textContent = 'R$ ' + taxa.toFixed(2).replace('.',',');
  document.getElementById('mesa-detalhe-total-com-taxa').textContent = 'R$ ' + total.toFixed(2).replace('.',',');
}

// ── Transferir item para outra mesa ──────────────────────────────────────────
async function gestorTransferirItem(itemIdx) {
  const mesasDisp = tables.filter(t => t.status === 'busy' && parseInt(t.num) !== _detalheMesaNum);
  if (!mesasDisp.length) { sbToast('warn', 'Nenhuma outra mesa ocupada disponível'); return; }

  // Picker de mesa destino
  const opcoes = mesasDisp.map(t => `<button onclick="_confirmarTransferirItem(${itemIdx}, ${t.num}); document.getElementById('modal-transferir-item').remove()"
    style="padding:10px 18px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:14px;font-weight:700;cursor:pointer">
    Mesa ${t.num}</button>`).join('');

  const modal = document.createElement('div');
  modal.id = 'modal-transferir-item';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:16px;padding:24px;width:90%;max-width:360px;border:1px solid var(--border)">
      <div style="font-size:15px;font-weight:700;margin-bottom:16px">Transferir item para qual mesa?</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">${opcoes}</div>
      <button onclick="document.getElementById('modal-transferir-item').remove()"
        style="width:100%;padding:10px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface2);color:var(--muted);font-size:13px;font-weight:700;cursor:pointer">Cancelar</button>
    </div>`;
  document.body.appendChild(modal);
}

async function _confirmarTransferirItem(itemIdx, mesaDestino) {
  const orderId = _detalheMesaOrders[0]?.id;
  if (!orderId) return;

  // Pega o item da comanda origem
  const item = _detalheMesaOrders.flatMap(o => _parseItems(o.items))[itemIdx];
  if (!item) return;

  try {
    // Remove da comanda origem
    const ordemOrigem = _detalheMesaOrders.find(o =>
      _parseItems(o.items).some(i => i.name === item.name && i.item_status !== 'cancelado')
    );
    if (ordemOrigem) {
      const itensAtualizados = _parseItems(ordemOrigem.items).map((i, idx) => {
        if (idx === itemIdx) return { ...i, item_status: 'cancelado' };
        return i;
      });
      const novoTotal = itensAtualizados
        .filter(i => i.item_status !== 'cancelado')
        .reduce((s, i) => s + (parseFloat(i.price)||0) * (parseInt(i.qty)||1), 0);
      await sb.from('orders').update({ items: itensAtualizados, total: novoTotal }).eq('id', ordemOrigem.id);
    }

    // Adiciona na comanda destino
    const { data: comandaDestino } = await sb.from('orders')
      .select('*').eq('mesa_num', mesaDestino).eq('status', 'mesa_aberta').single();

    if (comandaDestino) {
      const itensDestino = [..._parseItems(comandaDestino.items), { ...item, item_status: 'pronto' }];
      const totalDestino = itensDestino
        .filter(i => i.item_status !== 'cancelado')
        .reduce((s, i) => s + (parseFloat(i.price)||0) * (parseInt(i.qty)||1), 0);
      await sb.from('orders').update({ items: itensDestino, total: totalDestino }).eq('id', comandaDestino.id);
    } else {
      // Cria nova comanda na mesa destino
      await sb.from('orders').insert({
        tenant_id: _sessao?.tenant_id,
        client: `Mesa ${mesaDestino}`, addr: `Mesa ${mesaDestino}`,
        mesa_num: mesaDestino, items: [{ ...item, item_status: 'pronto' }],
        total: (parseFloat(item.price)||0) * (parseInt(item.qty)||1),
        status: 'mesa_aberta', pag: 'Mesa',
        time: new Date().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})
      });
    }

    closeModal('modal-mesa-detalhe');
    await refreshMesa(_detalheMesaNum);
    await refreshMesa(mesaDestino);
    _renderMesaPageFromCache();
    sbToast('ok', `Item transferido para Mesa ${mesaDestino}!`);
  } catch(e) {
    sbToast('err', 'Erro ao transferir: ' + (e?.message || e));
  }
}

// ── Cancelar item individual ──────────────────────────────────────────────
async function gestorCancelarItem(itemIdx) {
  if (!confirm('Cancelar este item?')) return;

  // Encontra o item na lista flat
  let count = 0;
  let targetOrder = null;
  let targetItemIdx = -1;
  for (const o of _detalheMesaOrders) {
    const items = _parseItems(o.items);
    for (let ii = 0; ii < items.length; ii++) {
      if (count === itemIdx) {
        targetOrder = o;
        targetItemIdx = ii;
        break;
      }
      count++;
    }
    if (targetOrder) break;
  }

  if (!targetOrder || targetItemIdx < 0) { sbToast('err', 'Item não encontrado'); return; }

  sbLoading(true);
  try {
    const updatedItems = [...targetOrder.items];
    updatedItems[targetItemIdx] = { ...updatedItems[targetItemIdx], item_status: 'cancelado' };
    const newTotal = updatedItems
      .filter(i => (i.item_status || 'active') !== 'cancelado')
      .reduce((s, i) => s + (parseFloat(i.price)||0) * (parseInt(i.qty)||1), 0);

    await sb.from('orders')
      .update({ items: updatedItems, total: newTotal, updated_at: new Date().toISOString() })
      .eq('id', targetOrder.id);

    // Atualiza local
    targetOrder.items = updatedItems;
    targetOrder.total = newTotal;
    _renderDetalheMesaItens();
    // Atualiza cache do salão
    _patchOrderInCache(targetOrder);
    _renderMesaPageFromCache();
    sbToast('ok', 'Item cancelado');
  } catch(e) {
    sbToast('err', 'Erro: ' + (e.message||e));
  } finally {
    sbLoading(false);
  }
}

// ── Adicionar item (abre o PDV do garçom no gestor) ──────────────────────
function gestorAddItemMesa() {
  closeModal('modal-mesa-detalhe');
  openGarcomMesa(_detalheMesaNum);
}

// ── Imprimir conta da mesa (gestor) ──────────────────────────────────────
async function gestorImprimirContaMesa() {
  const num = _detalheMesaNum;
  if (!num) return;

  const taxaCheck = document.getElementById('mesa-detalhe-taxa-check');
  const sub = _detalheMesaSubtotal;
  const pct = _taxaServicoPct || 0;
  const taxa = taxaCheck?.checked ? sub * pct / 100 : 0;
  const total = sub + taxa;

  // Monta itens consolidados
  const itemMap = {};
  _detalheMesaOrders.forEach(o => {
    (_parseItems(o.items)).forEach(i => {
      if (i.item_status === 'cancelado') return;
      const k = i.name;
      if (!itemMap[k]) itemMap[k] = { name: i.name, qty: 0, total: 0 };
      itemMap[k].qty += (i.qty || 1);
      itemMap[k].total += (i.price || 0) * (i.qty || 1);
    });
  });
  const itens = Object.values(itemMap);
  if (!itens.length) { sbToast('err', 'Sem itens para imprimir'); return; }
  const itensPorClienteHtml = _salaoPrintClientesHtml(_detalheMesaOrders);

  const nome = _sessao?.nome || 'RESTAURANTE';
  const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  const renderItem = i =>
    `<div style="margin-bottom:4px"><div style="font-weight:bold;word-break:break-word">${i.qty}x ${_salaoEscape((i.name || '').toUpperCase())}<span style="float:right">R$ ${i.total.toFixed(2).replace('.',',')}</span></div></div>`;

  const taxaLinha = taxa > 0
    ? `<div style="display:flex;justify-content:space-between;font-size:0.9em"><span>Subtotal</span><span>R$ ${sub.toFixed(2).replace('.',',')}</span></div>
       <div style="display:flex;justify-content:space-between;font-size:0.9em"><span>Taxa serviço (${pct}%)</span><span>R$ ${taxa.toFixed(2).replace('.',',')}</span></div>`
    : '';

  const html = `
    <div class="print-ticket" style="font-size:12px">
      <div style="text-align:center;font-size:1.1em;font-weight:900">${nome.toUpperCase()}</div>
      <div style="text-align:center;font-weight:bold;margin:4px 0">*** CONTA ***</div>
      <hr style="border:none;border-top:1px dashed #000;margin:4px 0">
      <div>Mesa: <b>${num}</b></div>
      <div>Data: ${dataHora}</div>
      <hr style="border:none;border-top:1px dashed #000;margin:4px 0">
      ${itensPorClienteHtml || itens.map(renderItem).join('')}
      <hr style="border:none;border-top:1px dashed #000;margin:4px 0">
      ${taxaLinha}
      <div style="display:flex;justify-content:space-between;font-weight:900;font-size:1.05em">
        <span>TOTAL</span><span>R$ ${total.toFixed(2).replace('.',',')}</span>
      </div>
      <hr style="border:none;border-top:1px dashed #000;margin:4px 0">
      <div style="text-align:center;font-size:0.85em">Obrigado pela preferência!</div>
    </div>`;

  const tid = (() => { try { return JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || ''; } catch { return ''; } })();
  const fmt = localStorage.getItem('printFormat') || '80mm';

  // 1. Tenta Print Agent com tipo 'caixa'
  try {
    if (tid) {
      const st = await fetch('/api/print-queue/status', { headers: { 'x-tenant-id': tid } }).then(r=>r.json());
      if (st.active) {
        await fetch('/api/print-queue/job', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
          body: JSON.stringify({ html, format: fmt, tipo: 'caixa' }),
        });
        sbToast('ok', '🖨️ Conta enviada para impressora!');
        return;
      }
    }
  } catch(e) { console.warn('[GESTOR PRINT CONTA] Agent falhou:', e.message); }

  // 2. Electron
  if (window.ElectronPrint && window.ElectronPrint.printHtml) {
    try {
      await window.ElectronPrint.printHtml(html, { printer: localStorage.getItem('printPrinter') || '', paperWidth: 80 });
      sbToast('ok', '🖨️ Conta impressa!');
      return;
    } catch(e) { console.warn('[GESTOR PRINT CONTA] Electron falhou:', e.message); }
  }

  // 3. Fallback: popup
  const w = window.open('', '_blank', 'width=400,height=600');
  if (!w) { sbToast('err', 'Permita popups para imprimir'); return; }
  w.document.write(`<!DOCTYPE html><html><head><title>Conta Mesa ${num}</title>
    <style>body{margin:0;padding:16px;font-family:monospace;background:#fff;color:#000} @media print{@page{margin:2mm;size:${fmt} auto} body{margin:0}}</style>
    </head><body>${html}<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script></body></html>`);
  w.document.close();
  sbToast('ok', '🖨️ Conta gerada!');
}

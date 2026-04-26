// ══════════════════════════════════════════
//  CARRINHO — addToCart, totais, taxas, cupom, cashback
//  Estima Food — Cardápio
// ══════════════════════════════════════════
// ══════════════════════════════════════════
//  CARRINHO
// ══════════════════════════════════════════
function addToCart(id) {
  const i = allItems.find(x => x.id === id);
  if (!i) return;
  const ex = cart.find(c => c.id === id && !c.obs);
  if (ex) ex.qty++;
  else cart.push({...i, qty:1, obs:''});
  updateCartFloat();
  toast('🛒', `${i.name} adicionado!`);
}

function removeFromCart(id, obs) {
  cart = cart.filter(c => !(c.id===id && (c.obs||'')===(obs||'')));
  appliedCupom = null;
  document.getElementById('cupom-input').value = '';
  document.getElementById('cupom-msg').innerHTML = '';
  updateCartFloat();
  renderCartDrawer();
}

function changeQty(id, obs, d) {
  const it = cart.find(c => c.id===id && (c.obs||'')===(obs||''));
  if (!it) return;
  it.qty += d;
  if (it.qty <= 0) removeFromCart(id, obs);
  else { updateCartFloat(); renderCartDrawer(); }
}

function cartSubtotal() { return cart.reduce((s,i) => s + i.price * i.qty, 0); }

function getDiscount() {
  if (!appliedCupom) return 0;
  const sub  = cartSubtotal();
  const tipo = appliedCupom.type || appliedCupom.tipo || '';
  const val  = parseFloat(appliedCupom.value ?? appliedCupom.val ?? 0);
  if (tipo === 'percent' || tipo === '%') return sub * val / 100;
  // Cupom de frete: zera a taxa (via lógica em getTaxa). Aqui retorna 0 pra evitar dupla contagem.
  if (tipo === 'frete') return 0;
  return Math.min(val, sub);
}

function getTaxa() {
  if (deliveryType !== 'delivery') return 0;
  if (appliedCupom?.tipo === 'frete' || appliedCupom?.type === 'frete') return 0;
  if (feeConfig.tipo === 'por_km') {
    const faixas = feeConfig.faixas || [];
    return parseFloat(faixas[Math.min(selectedFaixa, faixas.length-1)]?.taxa) || 0;
  }
  if (feeConfig.tipo === 'por_bairro') {
    const bairros = feeConfig.bairros || [];
    if (!bairros.length) return 0;
    const digitado = (document.getElementById('f-bairro')?.value || '').trim().toLowerCase();
    if (!digitado) return 0;
    const match = bairros.find(b => b.bairro.trim().toLowerCase() === digitado);
    return match ? parseFloat(match.taxa) || 0 : 0;
  }
  return parseFloat(feeConfig.valor ?? feeConfig.value ?? 0);
}

// Retorna { ok, motivo } — valida se o pedido delivery pode ser submetido.
// - bairros_bloqueados: bloqueia em qualquer modo, antes de tudo
// - por_bairro: exige bairro digitado que exista na lista
// - por_km:     exige distância calculada dentro da maior faixa
function validarDelivery() {
  if (deliveryType !== 'delivery') return { ok: true };

  // Normaliza para comparação case-insensitive e sem acentos
  const _norm = s => (s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Bairros bloqueados — vale para QUALQUER tipo de cobrança
  const bloqueados = Array.isArray(feeConfig?.bairros_bloqueados) ? feeConfig.bairros_bloqueados : [];
  if (bloqueados.length) {
    const digitadoRaw = (document.getElementById('f-bairro')?.value || '').trim();
    if (!digitadoRaw) {
      return { ok: false, motivo: 'Informe o bairro para verificarmos a área de entrega.' };
    }
    const digitadoNorm = _norm(digitadoRaw);
    const hit = bloqueados.find(b => _norm(b) === digitadoNorm);
    if (hit) {
      return { ok: false, motivo: `Infelizmente não atendemos no bairro ${hit}. Confira nossa área de cobertura.` };
    }
  }

  // por_bairro: bairro precisa existir na lista
  if (feeConfig?.tipo === 'por_bairro') {
    const bairros = Array.isArray(feeConfig.bairros) ? feeConfig.bairros : [];
    if (!bairros.length) return { ok: true }; // sem lista — sem cobrança, permite
    const digitado = (document.getElementById('f-bairro')?.value || '').trim().toLowerCase();
    if (!digitado) return { ok: false, motivo: 'Informe o bairro para calcular a taxa de entrega' };
    const match = bairros.find(b => b.bairro.trim().toLowerCase() === digitado);
    if (!match) return { ok: false, motivo: 'Bairro fora da área de entrega. Fale com o restaurante.' };
  }
  // por_km: se tem GPS calculado e estourou a maior faixa, bloqueia
  if (feeConfig?.tipo === 'por_km') {
    const faixas = Array.isArray(feeConfig.faixas) ? feeConfig.faixas : [];
    if (faixas.length && typeof _geoDistKm === 'number' && _geoDistKm > 0) {
      const maiorFaixa = parseFloat(faixas[faixas.length - 1]?.ate_km || 0);
      if (_geoDistKm > maiorFaixa + 0.001) {
        return { ok: false, motivo: `Você está a ${_geoDistKm.toFixed(1).replace('.', ',')} km — fora da área de entrega (até ${maiorFaixa} km)` };
      }
    }
  }
  return { ok: true };
}

// Cálculo do desconto efetivo de cashback (single source of truth).
// Cashback pode consumir o pedido inteiro INCLUINDO a taxa de entrega.
function getCashbackDesconto() {
  if (!_cbUsar || !(_cbSaldo > 0)) return 0;
  const sub  = cartSubtotal();
  const disc = getDiscount();
  const taxa = getTaxa();
  const maxDescontavel = Math.max(0, sub - disc + taxa);
  return Math.min(_cbSaldo, maxDescontavel);
}

function grandTotal() {
  // Total "do pedido" = subtotal - desconto - parte do cashback que não foi pra taxa.
  // A taxa é salva separadamente no campo 'taxa' do pedido, nunca misturada aqui.
  // O cashback é debitado pelo endpoint /api/cashback/usar com o valor de getCashbackDesconto().
  const sub  = cartSubtotal();
  const disc = getDiscount();
  const taxa = getTaxa();
  const cbDesc = getCashbackDesconto();
  // Desconto de cashback aplica primeiro na taxa, depois no subtotal — assim o total do pedido
  // reflete o que o restaurante efetivamente recebe pelos itens.
  const cbSobraProTotal = Math.max(0, cbDesc - taxa);
  const net = Math.max(0, sub - disc - cbSobraProTotal);
  return net;
}

// Total para exibição ao cliente (subtotal + taxa - desconto - cashback, nunca negativo)
function displayTotal() {
  const sub   = cartSubtotal();
  const disc  = getDiscount();
  const taxa  = getTaxa();
  const cb    = getCashbackDesconto();
  return Math.max(0, sub - disc + taxa - cb);
}

function updateCartFloat() {
  const qty = cart.reduce((s,i) => s+i.qty, 0);
  document.getElementById('cart-float').classList.toggle('show', cart.length > 0);
  document.getElementById('cart-badge').textContent = qty;
  document.getElementById('cart-total-float').textContent = fmt(displayTotal());
  const btn = document.getElementById('confirm-btn');
  if (btn) btn.disabled = cart.length === 0 || !_lojaAberta;
}

function openCart() {
  document.getElementById('drawer-bg').classList.add('on');
  document.getElementById('success-screen').classList.remove('on');
  document.getElementById('cart-content').style.display = '';
  renderCartDrawer();
  fillCartForm();
  // Se não está logado, ainda tenta restaurar endereço do localStorage
  if (!_customer) loadSavedAddr();
  renderFaixas();
}
function closeCart() {
  document.getElementById('drawer-bg').classList.remove('on');
}

// ── Tipos de entrega ─────────────────────────────────
function applyTiposEntrega() {
  ['delivery','retirada','mesa'].forEach(t => {
    const el = document.getElementById('dtab-' + t);
    if (el) el.style.display = _tiposEntrega.includes(t) ? '' : 'none';
  });
  // Se o tipo ativo foi removido das opções, muda para o primeiro disponível
  if (!_tiposEntrega.includes(deliveryType)) {
    setDelivery(_tiposEntrega[0] || 'delivery');
  }
}

// ── Bloco de geo do cliente (delivery por km) ─────────
let _geoDistKm = null; // distância calculada pelo GPS

function renderGeoBlock() {
  const wrap = document.getElementById('geo-block');
  if (!wrap) return;
  const show = deliveryType === 'delivery' && feeConfig?.tipo === 'por_km' && _storeLat && _storeLng;
  wrap.style.display = show ? '' : 'none';
  // Pede GPS automaticamente ao entrar em delivery + por_km
  if (show && _geoDistKm === null) {
    _autoGetGeo();
  }
}

function _autoGetGeo() {
  if (!navigator.geolocation) return;
  const res = document.getElementById('geo-result');
  if (res) res.innerHTML = '<span style="color:var(--accent)">📡 Obtendo sua localização...</span>';
  navigator.geolocation.getCurrentPosition(
    pos => {
      const dist = calcDist(_storeLat, _storeLng, pos.coords.latitude, pos.coords.longitude);
      _geoDistKm = dist;
      const faixas = feeConfig?.faixas || [];
      let idx = faixas.findIndex(f => f.ate_km >= dist);
      if (idx === -1) idx = faixas.length - 1;
      if (idx >= 0) selectedFaixa = idx;
      const faixaSel = faixas[selectedFaixa];
      const distStr = dist.toFixed(1).replace('.', ',');
      if (faixaSel) {
        if (res) res.innerHTML = `<span style="color:var(--green)">📍 Você está a <strong>${distStr} km</strong> — Taxa: <strong>R$ ${fmt(faixaSel.taxa)}</strong></span>`;
      } else {
        if (res) res.innerHTML = `<span style="color:var(--red)">📍 Você está a ${distStr} km — fora da área de entrega</span>`;
      }
      renderTotals();
    },
    err => {
      // GPS negado/falhou — mostra faixas para seleção manual como fallback
      if (res) res.innerHTML = '<span style="color:var(--muted)">Não foi possível obter localização. Selecione sua faixa:</span>';
      _showFaixasFallback();
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function clientGetGeo() {
  _geoDistKm = null;
  _autoGetGeo();
}

function _showFaixasFallback() {
  const wrap = document.getElementById('faixas-wrap');
  const list = document.getElementById('faixas-list');
  const faixas = feeConfig?.faixas || [];
  if (!faixas.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  list.innerHTML = faixas.map((f,i) => `
    <div class="faixa-item ${i===selectedFaixa?'on':''}" onclick="selectFaixa(${i})">
      <span class="faixa-label"><svg width="14" height="12" viewBox="0 0 16 14" fill="none"><circle cx="3" cy="11" r="2" stroke="currentColor" stroke-width="1.3"/><circle cx="13" cy="11" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M5 11H3M11 11h2M6 11L7.5 5.5h3L12 8.5H6z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Até ${f.ate_km} km</span>
      <span class="faixa-val">R$ ${fmt(f.taxa)}</span>
    </div>`).join('');
}

function calcDist(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return 0;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function setDelivery(type) {
  deliveryType = type;
  ['delivery','retirada','mesa'].forEach(t => {
    document.getElementById('dtab-'+t).classList.toggle('on', t===type);
  });
  document.getElementById('addr-block').style.display       = type==='delivery' ? '' : 'none';
  document.getElementById('mesa-block').style.display       = type==='mesa'     ? '' : 'none';
  // Endereço de retirada
  const retBlock = document.getElementById('retirada-addr-block');
  const retText  = document.getElementById('retirada-addr-text');
  if (retBlock && retText) {
    retBlock.style.display = (type === 'retirada' && _storeAddress) ? '' : 'none';
    retText.textContent    = _storeAddress;
  }
  // Pedido mínimo delivery — mostra só na aba delivery
  const minimoBar = document.getElementById('cart-minimo-bar');
  const minimoVal = document.getElementById('cart-minimo-val');
  if (minimoBar) {
    if (type === 'delivery' && _pedidoMinimo > 0) {
      minimoBar.style.display = 'flex';
      if (minimoVal) minimoVal.textContent = 'R$ ' + fmt(_pedidoMinimo);
    } else {
      minimoBar.style.display = 'none';
    }
  }
  renderFaixas();
  renderGeoBlock();
  renderTotals();
  updateCartFloat();
  // Carrega endereços salvos quando entrar na aba delivery (cliente logado)
  if (type === 'delivery' && typeof carregarEnderecosSalvos === 'function') {
    carregarEnderecosSalvos();
  }
}

function setPay(el) {
  document.querySelectorAll('.pay-opt').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  selectedPay = el.dataset.pay;
  // Se selecionou crédito ou débito → pergunta se paga agora (online) ou na entrega
  if (selectedPay === 'credito' || selectedPay === 'debito') {
    openPagModal(selectedPay);
  }
}

function renderFaixas() {
  const wrap   = document.getElementById('faixas-wrap');
  const faixas = feeConfig?.faixas || [];
  // Faixas ficam ocultas por padrão — só aparecem se GPS falhar (via _showFaixasFallback)
  if (deliveryType !== 'delivery' || feeConfig?.tipo !== 'por_km' || !faixas.length) {
    wrap.style.display = 'none';
  }
  renderGeoBlock();
}

function selectFaixa(i) {
  selectedFaixa = i;
  renderFaixas();
  renderTotals();
}

function renderCartDrawer() {
  const list = document.getElementById('cart-items');
  if (!cart.length) {
    list.innerHTML = '<div class="empty-state" style="padding:20px 0 8px"><div class="empty-state-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2h1.5l1.8 7.5h6.5l1.2-5H5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="13" r="1" fill="currentColor"/><circle cx="12" cy="13" r="1" fill="currentColor"/></svg></div><div class="empty-state-text">Nada aqui ainda</div></div>';
  } else {
    list.innerHTML = cart.map(i => `
      <div class="ci">
        <div class="ci-thumb">
          ${i.image_url ? `<img src="${i.image_url}" alt="${i.name}">` : i.emoji||'🍽️'}
        </div>
        <div class="ci-info">
          <div class="ci-name">${i.name}</div>
          <div class="ci-price">R$ ${fmt(i.price * i.qty)}</div>
          ${i.obs ? `<div class="ci-obs">📝 ${i.obs}</div>` : ''}
        </div>
        <div class="ci-qty-row">
          <button class="cqb" onclick="changeQty(${i.id},'${(i.obs||'').replace(/'/g,"\\'")}', -1)">−</button>
          <span class="cqn">${i.qty}</span>
          <button class="cqb" onclick="changeQty(${i.id},'${(i.obs||'').replace(/'/g,"\\'")}', 1)">+</button>
        </div>
        <button class="ci-del" onclick="removeFromCart(${i.id},'${(i.obs||'').replace(/'/g,"\\'")}')">🗑</button>
      </div>`).join('');
  }
  renderTotals();
}

function renderTotals() {
  const sub    = cartSubtotal();
  const disc   = getDiscount();
  const taxa   = getTaxa();
  const cbDesc = getCashbackDesconto();
  const tot    = displayTotal();
  const isCupomFrete = appliedCupom && (appliedCupom.tipo === 'frete' || appliedCupom.type === 'frete');
  let taxaLabel = 'Taxa de entrega';
  if (deliveryType === 'delivery' && feeConfig?.tipo === 'por_km') {
    const f = (feeConfig.faixas||[])[selectedFaixa];
    if (f) taxaLabel = `Entrega até ${f.ate_km} km`;
  } else if (deliveryType === 'delivery' && feeConfig?.tipo === 'por_bairro') {
    const digitado = (document.getElementById('f-bairro')?.value || '').trim().toLowerCase();
    const match = (feeConfig.bairros||[]).find(b => b.bairro.trim().toLowerCase() === digitado);
    if (match) taxaLabel = `Entrega — ${match.bairro}`;
    else if (digitado) taxaLabel = 'Bairro não encontrado';
  }
  // Aviso de pedido mínimo
  const minimoFalta = _pedidoMinimo > 0 && deliveryType === 'delivery' && sub < _pedidoMinimo ? _pedidoMinimo - sub : 0;
  // Label da taxa: se cupom de frete aplicado, mostra "Grátis (cupom)" para feedback ao cliente
  const taxaTxt = isCupomFrete ? 'Grátis (cupom)' : (taxa > 0 ? 'R$ ' + fmt(taxa) : 'Grátis');
  document.getElementById('totals-wrap').innerHTML = `
    ${minimoFalta > 0 ? `<div style="padding:8px 12px;margin-bottom:8px;background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.3);border-radius:8px;font-size:12px;color:#92400e;display:flex;align-items:center;gap:7px">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 5v3M8 10v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      Faltam <strong>R$ ${fmt(minimoFalta)}</strong> para o pedido mínimo delivery (R$ ${fmt(_pedidoMinimo)})
    </div>` : ''}
    <div class="total-row"><span>Subtotal</span><span>R$ ${fmt(sub)}</span></div>
    ${deliveryType === 'delivery' ? `<div class="total-row ${isCupomFrete?'total-disc':''}"><span>${taxaLabel}</span><span>${taxaTxt}</span></div>` : ''}
    ${disc > 0 ? `<div class="total-row total-disc"><span>Desconto (${appliedCupom.code})</span><span>− R$ ${fmt(disc)}</span></div>` : ''}
    ${cbDesc > 0 ? `<div class="total-row total-disc"><span>Cashback usado</span><span>− R$ ${fmt(cbDesc)}</span></div>` : ''}
    <div class="total-row big"><span>Total</span><span>R$ ${fmt(tot)}</span></div>`;
}

function applyCupom() {
  const code = document.getElementById('cupom-input').value.trim().toUpperCase();
  const msg  = document.getElementById('cupom-msg');
  if (!code) return;
  const found = allCupons.find(c => (c.code||'').toUpperCase() === code && c.ativo);
  if (!found) {
    msg.innerHTML = '<div class="cupom-err">❌ Cupom inválido ou expirado</div>';
    appliedCupom = null;
  } else {
    const minOrder = parseFloat(found.min_order || found.minimo || 0);
    if (minOrder > 0 && cartSubtotal() < minOrder) {
      msg.innerHTML = `<div class="cupom-err">❌ Pedido mínimo de R$ ${fmt(minOrder)}</div>`;
      appliedCupom = null;
    } else {
      appliedCupom = found;
      msg.innerHTML = `<div class="cupom-ok">✅ Cupom "${found.code}" aplicado!</div>`;
    }
  }
  renderTotals();
}

// ── Cashback no checkout ─────────────────────────────
let _cbLookupTimer = null;
async function onPhoneCashback(raw) {
  const phone = raw.replace(/\D/g,'');
  if (phone.length < 8) { _resetCashbackUI(); return; }
  clearTimeout(_cbLookupTimer);
  _cbLookupTimer = setTimeout(async () => {
    try {
      const tid = _tenantId || '';
      const r = await fetch(`/api/cashback/saldo?phone=${phone}&tenant_id=${encodeURIComponent(tid)}`);
      if (!r.ok) { _resetCashbackUI(); return; }
      const d = await r.json();
      _cbSaldo = parseFloat(d.saldo || 0);
      const block = document.getElementById('cashback-block');
      const disp  = document.getElementById('cb-saldo-display');
      if (_cbSaldo > 0 && block) {
        block.style.display = '';
        if (disp) disp.textContent = 'R$ ' + _cbSaldo.toFixed(2).replace('.', ',');
      } else {
        _resetCashbackUI();
      }
    } catch(e) { _resetCashbackUI(); }
  }, 600);
}

function _resetCashbackUI() {
  _cbSaldo = 0; _cbUsar = false;
  const block = document.getElementById('cashback-block');
  const check = document.getElementById('cb-usar-check');
  const msg   = document.getElementById('cb-usar-msg');
  if (block) block.style.display = 'none';
  if (check) check.checked = false;
  if (msg)   msg.textContent = '';
  renderTotals();
}

function toggleUsarCashback() {
  const check = document.getElementById('cb-usar-check');
  _cbUsar = check?.checked || false;
  const msg = document.getElementById('cb-usar-msg');
  if (_cbUsar) {
    const sub  = cartSubtotal();
    const disc = getDiscount();
    const net  = sub - disc;
    const usar = Math.min(_cbSaldo, net);
    if (msg) msg.textContent = `✅ R$ ${usar.toFixed(2).replace('.', ',')} de cashback será descontado do total.`;
  } else {
    if (msg) msg.textContent = '';
  }
  renderTotals();
}

// ══════════════════════════════════════════════════════════════════════
// Geolocalização — usa GPS + reverse geocoding (Nominatim/OSM, gratuito)
// para preencher rua/bairro automaticamente. Também atualiza _geoDistKm
// quando taxa por_km. Disponível em qualquer tipo de taxa.
// ══════════════════════════════════════════════════════════════════════
async function usarMinhaLocalizacao() {
  const status = document.getElementById('gps-status');
  const btn    = document.getElementById('gps-btn');
  if (!navigator.geolocation) {
    if (status) { status.textContent = '⚠️ Seu navegador não suporta geolocalização.'; status.style.color = 'var(--danger,#ef4444)'; }
    return;
  }
  if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
  if (status) { status.textContent = '📡 Obtendo sua localização...'; status.style.color = 'var(--accent)'; }

  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude: lat, longitude: lng } = pos.coords;

      // 1. Calcula distância pra loja (se loja tem GPS configurado)
      if (typeof _storeLat === 'number' && typeof _storeLng === 'number' && _storeLat && _storeLng) {
        _geoDistKm = calcDist(_storeLat, _storeLng, lat, lng);
        // Se taxa por_km, ajusta selectedFaixa
        if (feeConfig?.tipo === 'por_km' && Array.isArray(feeConfig.faixas)) {
          let idx = feeConfig.faixas.findIndex(f => f.ate_km >= _geoDistKm);
          if (idx === -1) idx = feeConfig.faixas.length - 1;
          if (idx >= 0) selectedFaixa = idx;
        }
      }

      // 2. Reverse geocoding via Nominatim (OSM) — preenche os campos
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=pt-BR`, {
          headers: { 'Accept': 'application/json' }
        });
        const data = await r.json();
        const a = data?.address || {};
        // Mapeia campos do Nominatim para nossos inputs
        const rua    = a.road || a.pedestrian || a.footway || a.path || '';
        const bairro = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.village || '';
        const set = (id, val) => { const el = document.getElementById(id); if (el && val && !el.value) el.value = val; };
        if (rua)    set('f-rua', rua);
        if (bairro) set('f-bairro', bairro);
        // Foca no número (sempre digitado manualmente)
        const numEl = document.getElementById('f-num');
        if (numEl) numEl.focus();

        if (status) {
          const distStr = _geoDistKm != null ? ` (a ${_geoDistKm.toFixed(1).replace('.',',')} km daqui)` : '';
          const desc = [rua, bairro].filter(Boolean).join(', ') || 'Localização capturada';
          status.innerHTML = `✅ <strong>${desc}</strong>${distStr}`;
          status.style.color = 'var(--success,#16a34a)';
        }
      } catch(e) {
        // Geocoding falhou mas a distância pode ter sido calculada
        if (status) {
          if (_geoDistKm != null) {
            status.innerHTML = `✅ Localização capturada (${_geoDistKm.toFixed(1).replace('.',',')} km da loja). Preencha o endereço manualmente.`;
            status.style.color = 'var(--success,#16a34a)';
          } else {
            status.textContent = '✅ Localização capturada. Preencha o endereço manualmente.';
            status.style.color = 'var(--muted)';
          }
        }
      }

      // Recalcula taxa
      if (typeof renderTotals === 'function') renderTotals();
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    },
    err => {
      const motivos = {
        1: 'Permissão negada. Habilite a localização no navegador.',
        2: 'Posição indisponível. Tente em outro local com melhor sinal.',
        3: 'Tempo esgotado. Tente novamente.'
      };
      if (status) { status.textContent = '❌ ' + (motivos[err.code] || 'Não foi possível obter sua localização.'); status.style.color = 'var(--danger,#ef4444)'; }
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

// ══════════════════════════════════════════════════════════════════════
// Autocomplete de bairros no checkout do cardápio cliente.
// Mostra dropdown com bairros cadastrados em feeConfig.bairros (quando
// taxa por_bairro). Filtra conforme o cliente digita.
// ══════════════════════════════════════════════════════════════════════
function _normBairroCard(s) {
  return String(s || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function onBairroInputCardapio(input) {
  // Recalcula totais (mantém comportamento antigo)
  if (feeConfig?.tipo === 'por_bairro' && typeof renderTotals === 'function') renderTotals();
  _renderBairrosDropdownCardapio(input);
}

function onBairroFocusCardapio(input) {
  _renderBairrosDropdownCardapio(input);
}

function _renderBairrosDropdownCardapio(input) {
  const dd = document.getElementById('bairros-dropdown-cardapio');
  if (!dd) return;
  if (feeConfig?.tipo !== 'por_bairro') { dd.style.display = 'none'; return; }
  const bairros = Array.isArray(feeConfig.bairros) ? feeConfig.bairros : [];
  if (!bairros.length) { dd.style.display = 'none'; return; }

  const q = _normBairroCard(input.value);
  const lista = q
    ? bairros.filter(b => _normBairroCard(b.bairro).includes(q)).slice(0, 8)
    : bairros.slice(0, 8);
  if (!lista.length) { dd.style.display = 'none'; return; }

  dd.innerHTML = lista.map(b => `<div class="bairro-opt-card" data-nome="${(b.bairro || '').replace(/"/g, '&quot;')}" style="padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:8px;align-items:center;color:var(--text)" onmouseover="this.style.background='var(--s2,rgba(0,0,0,.04))'" onmouseout="this.style.background=''">
    <span>${b.bairro}</span>
    <span style="color:var(--muted);font-size:11.5px;font-weight:600">R$ ${parseFloat(b.taxa).toFixed(2).replace('.',',')}</span>
  </div>`).join('');

  dd.querySelectorAll('.bairro-opt-card').forEach(opt => {
    opt.addEventListener('mousedown', (e) => {
      e.preventDefault();
      input.value = opt.dataset.nome;
      dd.style.display = 'none';
      if (typeof renderTotals === 'function') renderTotals();
      // Foca no próximo campo (compl)
      const next = document.getElementById('f-compl');
      if (next) next.focus();
    });
  });
  dd.style.display = 'block';
}

// Fecha dropdown ao clicar fora
document.addEventListener('click', (e) => {
  const dd = document.getElementById('bairros-dropdown-cardapio');
  const inp = document.getElementById('f-bairro');
  if (dd && inp && e.target !== inp && !dd.contains(e.target)) dd.style.display = 'none';
});

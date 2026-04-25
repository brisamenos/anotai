// ══════════════════════════════════════════
//  CHECKOUT — submitOrder, PIX, cartão MP, troco, WhatsApp
//  Estima Food — Cardápio
// ══════════════════════════════════════════
// ══════════════════════════════════════════
//  WHATSAPP — gera link com mensagem pré-pronta
// ══════════════════════════════════════════
function buildWaLink(orderId, orderNum) {
  const num = String(_orderNum(orderId, orderNum)).padStart(3, '0');
  const msg = `Olá! Quero acompanhar meu pedido *#${num}* 🍽️`;
  const numero = _waNumero || '';
  if (!numero) return null;
  return `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
}

function showWaToast(orderId, orderNum) {
  if (!_waNumero) return;
  const link = buildWaLink(orderId, orderNum);
  if (!link) return;
  const num  = String(_orderNum(orderId, orderNum)).padStart(3,'0');

  // Remove toast anterior se existir
  const prev = document.getElementById('wa-track-toast');
  if (prev) prev.remove();

  const el = document.createElement('div');
  el.id = 'wa-track-toast';
  el.style.cssText = `
    position: fixed;
    bottom: 24px; left: 50%; transform: translateX(-50%) translateY(120px);
    z-index: 9999;
    width: calc(100% - 32px); max-width: 400px;
    background: linear-gradient(135deg, #075e54, #128c7e);
    border: 1px solid rgba(255,255,255,.15);
    border-radius: 20px;
    padding: 18px 18px 18px 16px;
    display: flex; align-items: center; gap: 14px;
    box-shadow: 0 16px 48px rgba(0,0,0,.5), 0 0 0 1px rgba(37,211,102,.2);
    cursor: pointer;
    transition: transform .45s cubic-bezier(.34,1.56,.64,1), opacity .35s ease;
    opacity: 0;
  `;
  el.innerHTML = `
    <div style="
      width:52px;height:52px;border-radius:14px;flex-shrink:0;
      background:rgba(255,255,255,.12);
      display:flex;align-items:center;justify-content:center;
    ">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="#25d366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
    </div>
    <div style="flex:1;min-width:0">
      <div style="font-size:15px;font-weight:800;color:#fff;margin-bottom:3px;letter-spacing:-.2px;">
        Acompanhar pelo WhatsApp
      </div>
      <div style="font-size:12.5px;color:rgba(255,255,255,.75);line-height:1.4;">
        Pedido <strong style="color:#fff">#${num}</strong> confirmado! Toque para receber atualizações em tempo real.
      </div>
    </div>
    <div style="
      flex-shrink:0;width:36px;height:36px;border-radius:10px;
      background:rgba(255,255,255,.15);
      display:flex;align-items:center;justify-content:center;
      font-size:18px;
    ">→</div>
    <button onclick="event.stopPropagation();document.getElementById('wa-track-toast').remove()" style="
      position:absolute;top:8px;right:10px;
      background:none;border:none;color:rgba(255,255,255,.45);
      font-size:16px;cursor:pointer;line-height:1;padding:2px;
    ">✕</button>
  `;

  el.onclick = () => {
    window.open(link, '_blank');
    el.remove();
  };

  document.body.appendChild(el);

  // Anima entrada
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.transform = 'translateX(-50%) translateY(0)';
      el.style.opacity   = '1';
    });
  });

  // Pulsa levemente para chamar atenção
  setTimeout(() => {
    if (!el.parentNode) return;
    el.style.transition = 'transform .18s ease';
    el.style.transform  = 'translateX(-50%) scale(1.03)';
    setTimeout(() => {
      if (!el.parentNode) return;
      el.style.transform = 'translateX(-50%) scale(1)';
    }, 180);
  }, 800);

  // Remove após 18s se não clicar
  setTimeout(() => {
    if (!el.parentNode) return;
    el.style.opacity   = '0';
    el.style.transform = 'translateX(-50%) translateY(120px)';
    setTimeout(() => el.remove(), 400);
  }, 18000);
}

// ══════════════════════════════════════════
//  SUBMIT
// ══════════════════════════════════════════
async function submitOrder() {
  const name  = document.getElementById('f-name').value.trim();
  const phone = document.getElementById('f-phone').value.trim();
  if (!name)  { toast('⚠️','Informe seu nome');      return; }
  if (!phone) { toast('⚠️','Informe seu WhatsApp');  return; }
  if (!cart.length) { toast('⚠️','Carrinho vazio');  return; }
  if (!_lojaAberta) { toast('🔴','Loja fechada');     return; }

  // Valida pedido mínimo para delivery
  if (deliveryType === 'delivery' && _pedidoMinimo > 0) {
    const sub = cart.reduce((s, i) => s + (i.price * (i.qty||1)), 0);
    if (sub < _pedidoMinimo) {
      toast('⚠️', `Pedido mínimo delivery: R$ ${fmt(_pedidoMinimo)}`);
      return;
    }
  }

  let addr = '';
  if (deliveryType === 'delivery') {
    const rua = document.getElementById('f-rua').value.trim();
    const num = document.getElementById('f-num').value.trim();
    if (!rua) { toast('⚠️','Informe a rua');   return; }
    if (!num) { toast('⚠️','Informe o número'); return; }
    const bairro = document.getElementById('f-bairro').value.trim();
    const compl  = document.getElementById('f-compl').value.trim();
    const refEl  = document.getElementById('f-referencia');
    const referencia = refEl ? refEl.value.trim() : '';
    if (!referencia) { toast('⚠️','Informe um ponto de referência'); if (refEl) refEl.focus(); return; }
    // Valida bairro / distância antes de montar o endereço
    if (typeof validarDelivery === 'function') {
      const v = validarDelivery();
      if (!v.ok) { toast('⚠️', v.motivo); return; }
    }
    addr = [rua, num, bairro, compl, 'Ref: ' + referencia].filter(Boolean).join(', ');
    saveDeliveryAddr();
  } else if (deliveryType === 'mesa') {
    const m = document.getElementById('f-mesa').value.trim();
    if (!m) { toast('⚠️','Informe o número da mesa'); return; }
    addr = 'Mesa ' + m;
  } else {
    addr = 'Retirada no balcão';
  }

  // Crédito ou débito → abre modal "Pagar agora / Pagar na entrega"
  if (selectedPay === 'credito' || selectedPay === 'debito') {
    _pendingOrderAddr = addr;
    openPagModal(selectedPay);
    return;
  }

  // Dinheiro → modal de troco
  if (selectedPay === 'dinheiro') {
    _pendingOrderAddr = addr;
    openTrocoModal();
    return;
  }

  await _doSubmitOrder(addr, null);
}

// ─── Troco ───────────────────────────────────────────
let _pendingOrderAddr = '';
let _trocoEscolha    = 'nao'; // 'nao' | 'sim'

function openTrocoModal() {
  _trocoEscolha = 'nao';
  document.getElementById('troco-opt-nao').classList.add('on');
  document.getElementById('troco-opt-sim').classList.remove('on');
  document.getElementById('troco-radio-nao').classList.add('on');
  document.getElementById('troco-radio-sim').classList.remove('on');
  document.getElementById('troco-valor-wrap').classList.remove('show');
  document.getElementById('troco-valor-input').value = '';
  document.getElementById('troco-overlay').classList.add('on');
}

function closeTrocoModal() {
  document.getElementById('troco-overlay').classList.remove('on');
}

function trocoModalCancelar() {
  closeTrocoModal();
  selectedPay = '';
  document.querySelectorAll('.pay-opt').forEach(b => b.classList.remove('on'));
}

function trocoEscolha(el, tipo) {
  _trocoEscolha = tipo;
  document.getElementById('troco-opt-nao').classList.toggle('on', tipo === 'nao');
  document.getElementById('troco-opt-sim').classList.toggle('on', tipo === 'sim');
  document.getElementById('troco-radio-nao').classList.toggle('on', tipo === 'nao');
  document.getElementById('troco-radio-sim').classList.toggle('on', tipo === 'sim');
  document.getElementById('troco-valor-wrap').classList.toggle('show', tipo === 'sim');
  if (tipo === 'sim') setTimeout(() => document.getElementById('troco-valor-input').focus(), 100);
}

async function trocoConfirmar() {
  let troco = null;
  if (_trocoEscolha === 'sim') {
    const v = parseFloat(document.getElementById('troco-valor-input').value || '0');
    // Salva o valor se informado, ou -1 para indicar "precisa de troco, valor não informado"
    troco = (v > 0) ? v : -1;
  }
  closeTrocoModal();
  await _doSubmitOrder(_pendingOrderAddr, troco);
}

async function _doSubmitOrder(addr, troco) {
  const name  = document.getElementById('f-name').value.trim();
  const phone = document.getElementById('f-phone').value.trim();

  if (!_customer) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ name, phone })); } catch(e) {}
  }

  // Guarda tenant em memória (fallback se sessionStorage se perder)
  if (_tenantId) {
    try { window._tenantId = _tenantId; } catch(_) {}
  }

  // Validação dura: sem tenant_id não adianta tentar
  if (!_tenantId) {
    toast('❌', 'Erro de conexão com o restaurante. Recarregue a página e tente novamente.');
    return;
  }
  if (!cart.length) {
    toast('⚠️', 'Seu carrinho está vazio.');
    return;
  }

  const btn = document.getElementById('confirm-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spin"></div> Enviando…';

  const items = cart.map(i => ({ qty: i.qty, name: i.name, price: i.price, obs: i.obs||'' }));
  const time  = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  // Total bruto (o que o cliente efetivamente paga — já considera cashback e cupom)
  const _grossTotal = displayTotal();
  const _cbDesconto = getCashbackDesconto();

  try {
    let customerId = _customer?.id || null;
    try {
      if (_customer) {
        await sb.from('customers').update({
          name, addr,
          orders_count: (_customer.orders_count||0)+1,
          total_spent:  (parseFloat(_customer.total_spent)||0)+_grossTotal,
          last_order_at: new Date().toISOString()
        }).eq('id', _customer.id);
        _customer.orders_count = (_customer.orders_count||0)+1;
        _customer.total_spent  = (parseFloat(_customer.total_spent)||0)+_grossTotal;
        localStorage.setItem(AUTH_KEY, JSON.stringify(_customer));
        updateProfileFab();
      } else {
        const { data: cl } = await sb.from('customers').select('id,orders_count,total_spent').eq('phone', phone).maybeSingle();
        if (cl) {
          customerId = cl.id;
          await sb.from('customers').update({
            name, addr,
            orders_count: (cl.orders_count||0)+1,
            total_spent:  (parseFloat(cl.total_spent)||0)+_grossTotal,
            last_order_at: new Date().toISOString()
          }).eq('id', cl.id);
        } else {
          const { data: ins } = await sb.from('customers').insert({
            tenant_id: _tenantId,
            name, phone, addr,
            orders_count: 1, total_spent: _grossTotal,
            last_order_at: new Date().toISOString()
          }).select().single();
          customerId = ins?.id || null;
        }
      }
    } catch(e) {}

    // CRÍTICO: tenant_id DEVE ser passado explicitamente. Sem ele, o pedido
    // pode cair no tenant errado (no tenant da sessão Supabase ativa no momento)
    // e aparecer no gestor de outro cliente.
    if (!_tenantId) {
      throw new Error('tenant_id ausente — pedido bloqueado para evitar vazamento entre tenants');
    }

    const { data: order, error } = await sb.from('orders').insert({
      tenant_id: _tenantId,
      client: name, phone, addr,
      items, total: grandTotal(), taxa: getTaxa(),
      status: selectedPay === 'pix' ? 'aguardando_pix'
            : selectedPay === 'cartao_mp' ? 'aguardando_cartao'
            : 'analise',
      time,
      pag: selectedPay === 'pix' && !_pixAtivoGestor ? 'pix_manual' : selectedPay,
      pag_momento: (selectedPay === 'cartao_mp') ? 'online'
                 : (selectedPay === 'pix')       ? 'online'
                 : (selectedPay === 'credito' || selectedPay === 'debito') ? 'entrega'
                 : 'entrega',
      troco: troco || null,
      customer_id: customerId
    }).select().single();

    if (error) throw error;

    // ── Debitar cashback se cliente usou ──────────────
    if (_cbUsar && _cbSaldo > 0 && _cbDesconto > 0) {
      try {
        const tid = _tenantId || '';
        await fetch('/api/cashback/usar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
          body: JSON.stringify({ phone: phone.replace(/\D/g,''), valor: _cbDesconto })
        });
      } catch(e) {
        toast('⚠️','Cashback não pôde ser debitado. Fale com o restaurante.');
      }
      _resetCashbackUI();
    }

    cart = [];
    appliedCupom = null;
    _pendingOrderAddr = '';
    updateCartFloat();
    document.getElementById('cupom-input').value = '';
    document.getElementById('cupom-msg').innerHTML = '';

    // ── Tela de sucesso ──
    document.getElementById('cart-content').style.display = 'none';
    document.getElementById('success-screen').classList.add('on');
    const numFormatado = '#' + String(_orderNum(order.id, order.order_num)).padStart(3,'0');
    window._lastOrderNum = order.order_num; // para o modal de avaliação
    document.getElementById('success-num').textContent = numFormatado;

    // Botão WhatsApp — aparece sempre que houver número configurado
    const waLink   = buildWaLink(order.id, order.order_num);
    const waBtnEl  = document.getElementById('success-wa-btn');
    const waLblEl  = document.getElementById('success-wa-label');
    if (waBtnEl) {
      waBtnEl.classList.remove('success-wa-btn-hidden');
      if (waLink) {
        waBtnEl.classList.add('show');
        waBtnEl.href = waLink;
        if (waLblEl) waLblEl.textContent = `Acompanhar pedido ${numFormatado} pelo WhatsApp`;
      } else {
        waBtnEl.classList.remove('show');
      }
    }

    // Convite de cadastro para não-logados
    const inv = document.getElementById('invite-signup');
    if (inv && !_customer) inv.style.display = 'flex';

    startTracking(order.id, items, name, addr, order.status, order.order_num);

    // ── PIX: gera QR Code MP ou exibe chave manual ──
    if (selectedPay === 'pix') {
      await _iniciarFluxoPix(order);
    }

    // ── Cartão de Crédito MP ──
    if (selectedPay === 'cartao_mp') {
      await _iniciarFluxoCartao(order);
    }

    // 1. Salva no localStorage (celular próprio)
    try {
      localStorage.setItem('ef_order_' + (_tenantId||''), JSON.stringify({
        orderId: order.id, orderNum: order.order_num, items, client: name, ts: Date.now()
      }));
    } catch(e) {}
    // 2. Coloca ?acompanhar=ID na URL (compartilhável)
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('acompanhar', order.id);
      window.history.replaceState({}, '', u.toString());
    } catch(e) {}

    // Toast WhatsApp (apenas premium) — aparece 1.5s após confirmação
    if (_tenantPlano === 'premium') {
      setTimeout(() => showWaToast(order.id, order.order_num), 1500);
    }

  } catch(e) {
    console.error('[submitOrder] falhou:', e);
    // Mensagem específica baseada no tipo de erro
    let msg = 'Erro ao enviar pedido. Tente novamente.';
    if (e?.network || /Failed to fetch|Network|rede|esgotado/i.test(e?.message || '')) {
      msg = 'Sem conexão. Verifique sua internet e tente novamente.';
    } else if (/tenant/i.test(e?.message || '')) {
      msg = 'Erro de configuração. Recarregue a página.';
    } else if (e?.message && e.message.length < 80 && !/TypeError/i.test(e.message)) {
      // Mostra a mensagem do servidor se for curta e legível
      msg = 'Erro: ' + e.message;
    }
    toast('❌', msg);
    btn.disabled = false;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg> Confirmar Pedido';
  }
}

// ══════════════════════════════════════════
//  PIX — QR Code / Chave Manual
// ══════════════════════════════════════════
function _pixCopiar() {
  const v = document.getElementById('pix-copy-code')?.value;
  if (!v) return;
  navigator.clipboard.writeText(v)
    .then(() => toast('✓','Código PIX copiado!'))
    .catch(() => {});
}
function _pixCopiarManual() {
  const v = document.getElementById('pix-manual-key-show')?.value;
  if (!v) return;
  navigator.clipboard.writeText(v)
    .then(() => toast('✓','Chave PIX copiada!'))
    .catch(() => {});
}
function _stopPixPoll() {
  if (_pixPollTimer) { clearInterval(_pixPollTimer); _pixPollTimer = null; }
  _pixMpId = null;
}
function _startPixPoll(mpId, orderId) {
  _stopPixPoll();
  _pixMpId = mpId;
  _pixPollTimer = setInterval(async () => {
    try {
      const r = await fetch(`/api/pix/status?mp_payment_id=${mpId}`, {
        headers: { 'x-tenant-id': _tenantId }
      });
      const d = await r.json();
      const lbl = document.getElementById('pix-status-label');
      const ap  = document.getElementById('pix-aprovado-msg');
      if (d.status === 'aprovado') {
        if (lbl) lbl.style.display = 'none';
        if (ap)  ap.style.display = '';
        _stopPixPoll();
        try {
          await fetch('/api/pix/vincular', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-tenant-id': _tenantId },
            body: JSON.stringify({ mp_payment_id: mpId, order_id: orderId })
          });
        } catch(e) {}
      } else if (d.status === 'rejeitado' || d.status === 'cancelado') {
        if (lbl) lbl.textContent = '❌ Pagamento não realizado. Tente outra forma.';
        _stopPixPoll();
      }
    } catch(e) {}
  }, 4000);
}
async function _iniciarFluxoPix(order) {
  const sec = document.getElementById('pix-section');
  if (!sec) return;
  sec.style.display = '';
  document.getElementById('pix-qr-wrap').style.display            = 'none';
  document.getElementById('pix-manual-success-wrap').style.display = 'none';
  const errWrap = document.getElementById('pix-error-wrap');
  if (errWrap) errWrap.style.display = 'none';

  // Mostra fallback: se tem chave manual configurada, usa ela; senão, mostra bloco de erro com retry
  const _showFallback = (msg) => {
    if (_pixKeyManual) {
      document.getElementById('pix-manual-success-wrap').style.display = '';
      document.getElementById('pix-manual-key-show').value             = _pixKeyManual;
      document.getElementById('pix-manual-banco-lbl').textContent      = _pixKeyManualBanco ? `🏦 ${_pixKeyManualBanco}` : '';
      document.getElementById('pix-manual-valor-show').textContent     = 'R$ ' + fmt(parseFloat(order.total) + parseFloat(order.taxa || 0));
      return;
    }
    if (errWrap) {
      errWrap.style.display = '';
      const msgEl = document.getElementById('pix-error-msg');
      if (msgEl) msgEl.textContent = msg || 'Verifique sua conexão e tente novamente.';
      const btn = document.getElementById('pix-retry-btn');
      if (btn) btn.onclick = () => _iniciarFluxoPix(order);
    } else {
      sec.style.display = 'none';
      toast('❌', msg || 'Erro ao gerar PIX. Entre em contato com o restaurante.');
    }
  };

  try {
    if (!_pixAtivoGestor) {
      // PIX MP não está ativo — usa só chave manual (se configurada)
      if (_pixKeyManual) {
        document.getElementById('pix-manual-success-wrap').style.display = '';
        document.getElementById('pix-manual-key-show').value             = _pixKeyManual;
        document.getElementById('pix-manual-banco-lbl').textContent      = _pixKeyManualBanco ? `🏦 ${_pixKeyManualBanco}` : '';
        document.getElementById('pix-manual-valor-show').textContent     = 'R$ ' + fmt(parseFloat(order.total) + parseFloat(order.taxa || 0));
      } else { sec.style.display = 'none'; }
      return;
    }
    const pr = await fetch('/api/pix/criar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': _tenantId },
      body: JSON.stringify({ valor: parseFloat(order.total) + parseFloat(order.taxa || 0), order_id: order.id, client: order.client, phone: order.phone })
    });
    const pd = await pr.json().catch(() => null);
    if (!pr.ok) {
      const msg = pd?.error ? `Erro: ${pd.error}` : `Erro do servidor (${pr.status}).`;
      console.error('[pix/criar]', pr.status, pd);
      _showFallback(msg);
      return;
    }
    if (pd?.qr_code) {
      const qrEl = document.getElementById('pix-qr-img');
      qrEl.innerHTML = '';
      new QRCode(qrEl, { text: pd.qr_code, width: 180, height: 180, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
      document.getElementById('pix-qr-wrap').style.display = '';
      document.getElementById('pix-copy-code').value = pd.qr_code;
      document.getElementById('pix-status-label').textContent = '⏳ Aguardando pagamento...';
      document.getElementById('pix-aprovado-msg').style.display = 'none';
      _startPixPoll(pd.mp_payment_id, order.id);
      return;
    }
    // Resposta OK mas sem qr_code (caso raro)
    _showFallback('Resposta inesperada do servidor. Tente novamente.');
  } catch(e) {
    console.error('_iniciarFluxoPix:', e);
    _showFallback('Sem conexão com o servidor. Verifique sua internet.');
  }
}

// ══════════════════════════════════════════
//  CARTÃO DE CRÉDITO — Mercado Pago SDK
// ══════════════════════════════════════════

// Máscara CPF
// ══════════════════════════════════════════
//  MODAL: PAGAR AGORA / PAGAR NA ENTREGA
// ══════════════════════════════════════════
let _pagEscolha    = 'entrega'; // 'entrega' | 'agora'
let _pagTipoAtual  = '';        // 'credito' | 'debito'

function openPagModal(tipo) {
  _pagEscolha   = 'entrega';
  _pagTipoAtual = tipo;

  const title = document.getElementById('pag-modal-title');
  const sub   = document.getElementById('pag-modal-sub');
  const badge = document.getElementById('pag-taxa-badge');
  const desc  = document.getElementById('pag-opt-agora-desc');
  const ico   = document.getElementById('pag-opt-agora-ico');

  if (title) title.textContent = tipo === 'credito' ? 'Pagar com crédito' : 'Pagar com débito';
  const _isRet = deliveryType === 'retirada' || deliveryType === 'mesa';
  if (sub) sub.textContent = _isRet ? 'Escolha se vai pagar agora (online) ou no balcão' : 'Escolha se vai pagar agora (online) ou na entrega';
  const lblE = document.getElementById('pag-lbl-entrega');
  const descE = document.getElementById('pag-desc-entrega');
  if (lblE)  lblE.textContent  = _isRet ? 'Pagar no balcão' : 'Pagar na entrega';
  if (descE) descE.textContent = _isRet ? 'Você paga quando vier retirar o pedido.' : 'Você paga quando o pedido chegar. Tenha o cartão em mãos.';

  // Mostra opção "Pagar agora" só se o cartão online estiver disponível
  const optAgora = document.getElementById('pag-opt-agora');
  if (optAgora) optAgora.style.display = _cartaoAtivo ? '' : 'none';

  // taxa não exibida para o cliente
  if (desc)  desc.textContent  = 'Pagamento online seguro. O pedido é confirmado na hora.';
  if (ico) ico.textContent = tipo === 'credito' ? '💳' : '🏧';

  // Reset seleção para "entrega"
  pagEscolha('entrega');
  document.getElementById('pag-overlay').classList.add('on');
}

function closePagModal() {
  document.getElementById('pag-overlay').classList.remove('on');
}

function pagModalCancelar() {
  closePagModal();
  selectedPay = '';
  document.querySelectorAll('.pay-opt').forEach(b => b.classList.remove('on'));
}

function pagEscolha(tipo) {
  _pagEscolha = tipo;
  document.getElementById('pag-opt-entrega').classList.toggle('on', tipo === 'entrega');
  document.getElementById('pag-opt-agora').classList.toggle('on',   tipo === 'agora');
  document.getElementById('pag-radio-entrega').classList.toggle('on', tipo === 'entrega');
  document.getElementById('pag-radio-agora').classList.toggle('on',   tipo === 'agora');
}

async function pagConfirmar() {
  closePagModal();
  if (_pagEscolha === 'agora') {
    // Troca para cartao_mp e segue o fluxo online
    selectedPay = 'cartao_mp';
    document.querySelectorAll('.pay-opt').forEach(b => b.classList.remove('on'));
    const mpBtn = document.getElementById('pay-opt-cartao-mp');
    if (mpBtn) mpBtn.classList.add('on');
  } else {
    // Mantém credito/debito — paga na entrega, segue para submit normal
    // selectedPay já tem 'credito' ou 'debito' — não muda
  }
  // Se havia addr pendente (vem de dinheiro/troco flow), usa ele; senão inicia submit normal
  // Verifica se há pendingOrderAddr (só tem se veio pelo modal de troco)
  if (_pendingOrderAddr) {
    await _doSubmitOrder(_pendingOrderAddr, null);
  } else {
    await _iniciarSubmit();
  }
}

// Wrapper para não duplicar código de validação no submitOrder
async function _iniciarSubmit() {
  const name  = document.getElementById('f-name').value.trim();
  const phone = document.getElementById('f-phone').value.trim();
  if (!name)  { toast('⚠️','Informe seu nome');      return; }
  if (!phone) { toast('⚠️','Informe seu WhatsApp');  return; }
  if (!cart.length) { toast('⚠️','Carrinho vazio');  return; }
  if (!_lojaAberta) { toast('🔴','Loja fechada');     return; }

  if (deliveryType === 'delivery' && _pedidoMinimo > 0) {
    const sub = cart.reduce((s, i) => s + (i.price * (i.qty||1)), 0);
    if (sub < _pedidoMinimo) {
      toast('⚠️', `Pedido mínimo delivery: R$ ${fmt(_pedidoMinimo)}`);
      return;
    }
  }

  let addr = '';
  if (deliveryType === 'delivery') {
    const rua = document.getElementById('f-rua').value.trim();
    const num = document.getElementById('f-num').value.trim();
    if (!rua) { toast('⚠️','Informe a rua');   return; }
    if (!num) { toast('⚠️','Informe o número'); return; }
    const bairro = document.getElementById('f-bairro').value.trim();
    const compl  = document.getElementById('f-compl').value.trim();
    const refEl  = document.getElementById('f-referencia');
    const referencia = refEl ? refEl.value.trim() : '';
    if (!referencia) { toast('⚠️','Informe um ponto de referência'); if (refEl) refEl.focus(); return; }
    // Valida bairro / distância antes de montar o endereço
    if (typeof validarDelivery === 'function') {
      const v = validarDelivery();
      if (!v.ok) { toast('⚠️', v.motivo); return; }
    }
    addr = [rua, num, bairro, compl, 'Ref: ' + referencia].filter(Boolean).join(', ');
    saveDeliveryAddr();
  } else if (deliveryType === 'mesa') {
    const m = document.getElementById('f-mesa').value.trim();
    if (!m) { toast('⚠️','Informe o número da mesa'); return; }
    addr = 'Mesa ' + m;
  } else {
    addr = 'Retirada no balcão';
  }
  await _doSubmitOrder(addr, null);
}

function maskCpf(el) {
  let v = el.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, '$1.$2.$3-$4');
  else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{0,3})/, '$1.$2.$3');
  else if (v.length > 3) v = v.replace(/(\d{3})(\d{0,3})/, '$1.$2');
  el.value = v;
}

// ══════════════════════════════════════════
//  CARTÃO DE CRÉDITO — Mercado Pago SDK v2
//  Usa cardForm com callback onSubmit (padrão correto)
// ══════════════════════════════════════════

let _cartaoPendingOrder = null;

async function _initMpCardForm(valor) {
  if (!_mpPublicKey) return;

  // Destrói instância anterior
  if (_mpCardForm) {
    try { _mpCardForm.unmount(); } catch(e) {}
    _mpCardForm = null;
  }
  // Limpa containers dos iframes
  ['mp-cardNumber-container','mp-expiration-container','mp-securityCode-container'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });

  if (!_mpInstance) {
    _mpInstance = new MercadoPago(_mpPublicKey, { locale: 'pt-BR' });
  }

  // Preenche e-mail oculto (MP exige payer.email para tokenização)
  const phoneRaw = document.getElementById('f-phone')?.value.replace(/\D/g,'') || 'cliente';
  const emailHidden = document.getElementById('mp-cardholderEmail');
  if (emailHidden) emailHidden.value = phoneRaw + '@estima.app';

  const _btn  = document.getElementById('cartao-pagar-btn');
  const _erro = document.getElementById('cartao-erro');

  _mpCardForm = _mpInstance.cardForm({
    amount: String(parseFloat(valor).toFixed(2)),
    iframe: true,
    form: {
      id:                  'mp-card-form',
      cardholderName:      { id: 'mp-cardholderName',       placeholder: 'Como está no cartão' },
      cardholderEmail:     { id: 'mp-cardholderEmail' },
      cardNumber:          { id: 'mp-cardNumber-container',   placeholder: '•••• •••• •••• ••••' },
      expirationDate:      { id: 'mp-expiration-container',   placeholder: 'MM/AA' },
      securityCode:        { id: 'mp-securityCode-container', placeholder: '•••' },
      identificationType:  { id: 'mp-identificationType' },
      identificationNumber:{ id: 'mp-docNumber',              placeholder: '000.000.000-00' },
      installments:        { id: 'mp-installments' },
    },
    callbacks: {
      onFormMounted: (err) => {
        if (err) { console.warn('[MP] CardForm mount error:', err); }
      },
      onPaymentMethodsReceived: (err, data) => {
        if (err || !data?.length) return;
        const pm = data[0];
        const icons = { visa:'💳', master:'🟠', elo:'🔵', amex:'🔶', hipercard:'🔴', diners:'🟤' };
        const bandeira = document.getElementById('cartao-bandeira');
        const bIcon    = document.getElementById('cartao-bandeira-icon');
        const bNome    = document.getElementById('cartao-bandeira-nome');
        if (bIcon) bIcon.textContent = icons[pm.id] || '💳';
        if (bNome) bNome.textContent = pm.name || pm.id;
        if (bandeira) bandeira.style.display = 'flex';
      },
      onSubmit: async (event) => {
        event.preventDefault();
        if (_btn) { _btn.disabled = true; _btn.textContent = 'Processando...'; }
        if (_erro) { _erro.style.display = 'none'; _erro.textContent = ''; }

        try {
          // Valida CPF antes de tokenizar
          const cpf = document.getElementById('mp-docNumber')?.value.replace(/\D/g,'');
          if (!cpf || cpf.length !== 11) throw new Error('Informe um CPF válido');

          // SDK v2: getCardFormData() é método direto do event (não de event.data)
          const formData = typeof event.getCardFormData === 'function'
            ? event.getCardFormData()
            : (typeof event.data?.getCardFormData === 'function' ? event.data.getCardFormData() : null);

          if (!formData) throw new Error('Não foi possível obter os dados do cartão. Verifique os campos.');

          const { token, installments, paymentMethodId, issuerId, identificationNumber, cardholderName } = formData;

          if (!token) throw new Error('Não foi possível processar o cartão. Verifique os dados.');

          const order = _cartaoPendingOrder;
          if (!order) throw new Error('Pedido não encontrado. Feche e tente novamente.');

          const res = await fetch('/api/cartao/criar', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-tenant-id': _tenantId },
            body: JSON.stringify({
              card_token:        token,
              payment_method_id: paymentMethodId,
              issuer_id:         issuerId,
              valor:             order.total,
              order_id:          order.id,
              client:            order.client,
              email:             document.getElementById('mp-cardholderEmail')?.value || 'cliente@estima.app',
            })
          });
          const d = await res.json();

          if (d.ok) {
            _cartaoMostrarResultado('aprovado', d);
          } else if (d.status === 'em_processo') {
            _cartaoMostrarResultado('em_processo', d);
          } else {
            _cartaoMostrarResultado('rejeitado', d);
          }
        } catch(e) {
          if (_erro) {
            _erro.textContent  = e.message || 'Erro ao processar. Verifique os dados.';
            _erro.style.display = '';
          }
          if (_btn) { _btn.disabled = false; _btn.textContent = 'Pagar com cartão'; }
        }
      },
      onError: (err) => {
        console.warn('[MP] CardForm error:', err);
      }
    }
  });
}

function _cartaoMostrarResultado(tipo, d) {
  const wrap = document.getElementById('mp-card-form');
  const res  = document.getElementById('cartao-result-wrap');
  const icon = document.getElementById('cartao-result-icon');
  const tit  = document.getElementById('cartao-result-title');
  const msg  = document.getElementById('cartao-result-msg');
  const btn  = document.getElementById('cartao-pagar-btn');

  if (wrap) wrap.style.display = 'none';
  if (res)  res.style.display  = '';

  const detalhes = {
    cc_rejected_insufficient_amount:   'Saldo insuficiente no cartão.',
    cc_rejected_bad_filled_security_code: 'CVV incorreto.',
    cc_rejected_bad_filled_date:       'Data de validade incorreta.',
    cc_rejected_bad_filled_card_number:'Número do cartão inválido.',
    cc_rejected_call_for_authorize:    'Ligue para o banco para autorizar.',
    cc_rejected_card_disabled:         'Cartão desabilitado. Contate o banco.',
    cc_rejected_duplicated_payment:    'Pagamento duplicado detectado.',
    cc_rejected_high_risk:             'Pagamento recusado por segurança.',
  };
  const detalhe = detalhes[d?.status_detail] || '';

  if (tipo === 'aprovado') {
    if (icon) icon.textContent = '✅';
    if (tit)  { tit.textContent = 'Pagamento aprovado!'; tit.style.color = '#22c55e'; }
    if (msg)  msg.textContent  = `${d.last_four ? 'Final ••••' + d.last_four + ' — ' : ''}Pedido confirmado e enviado para preparo.`;
  } else if (tipo === 'em_processo') {
    if (icon) icon.textContent = '⏳';
    if (tit)  { tit.textContent = 'Pagamento em análise'; tit.style.color = '#f59e0b'; }
    if (msg)  msg.textContent  = 'O banco está analisando. Você receberá confirmação em breve.';
  } else {
    if (icon) icon.textContent = '❌';
    if (tit)  { tit.textContent = 'Pagamento recusado'; tit.style.color = '#ef4444'; }
    if (msg)  msg.textContent  = detalhe || 'Não foi possível processar. Tente outro cartão ou forma de pagamento.';
    // Botão tentar novamente
    if (res) {
      const old = res.querySelector('.cartao-retry-btn');
      if (old) old.remove();
      const tryBtn = document.createElement('button');
      tryBtn.className  = 'cartao-retry-btn';
      tryBtn.textContent = 'Tentar novamente';
      tryBtn.style.cssText = 'margin-top:12px;padding:9px 20px;background:var(--accent-g,linear-gradient(135deg,#f97316,#ea580c));color:#fff;border:none;border-radius:9px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit';
      tryBtn.onclick = () => {
        res.style.display = 'none';
        if (wrap) wrap.style.display = '';
        if (btn)  { btn.disabled = false; btn.textContent = 'Pagar com cartão'; }
      };
      msg.after(tryBtn);
    }
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Pagar com cartão'; }
}

async function _iniciarFluxoCartao(order) {
  _cartaoPendingOrder = order;
  const sec  = document.getElementById('cartao-section');
  const form = document.getElementById('mp-card-form');
  const res  = document.getElementById('cartao-result-wrap');
  const erro = document.getElementById('cartao-erro');
  if (sec)  sec.style.display  = '';
  if (form) form.style.display = '';
  if (res)  res.style.display  = 'none';
  if (erro) { erro.style.display = 'none'; erro.textContent = ''; }
  await _initMpCardForm(parseFloat(order.total) + parseFloat(order.taxa || 0));
}

function resetCart() {
  _stopPixPoll();
  _resetCashbackUI();
  const ps = document.getElementById('pix-section');
  if (ps) ps.style.display = 'none';
  // Reset cartão
  const cs = document.getElementById('cartao-section');
  if (cs) cs.style.display = 'none';
  _cartaoPendingOrder = null;
  if (_mpCardForm) { try { _mpCardForm.unmount(); } catch(e) {} _mpCardForm = null; }
  try { localStorage.removeItem('ef_order_' + (_tenantId||'')); } catch(e) {}
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete('acompanhar');
    window.history.replaceState({}, '', u.toString());
  } catch(e) {}
  document.getElementById('success-screen').classList.remove('on');
  document.getElementById('cart-content').style.display = '';
  document.getElementById('cart-items').innerHTML = '';
  const inv = document.getElementById('invite-signup');
  if (inv) inv.style.display = 'none';
  // Reseta botão WA para próximo pedido
  const waBtn = document.getElementById('success-wa-btn');
  if (waBtn) { waBtn.classList.remove('show'); waBtn.href = '#'; }
  renderTotals();
  closeCart();
}

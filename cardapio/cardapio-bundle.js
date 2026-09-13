// ══════════════════════════════════════════════════════════════
// CARDÁPIO — ARQUIVO ÚNICO (gerado a partir dos 12 módulos)
// ══════════════════════════════════════════════════════════════
// Isto é a JUNÇÃO dos 12 arquivos-fonte, na mesma ordem que sempre
// carregaram: state, utils, auth, cart, menu, modal, checkout,
// tracking, chat, acougue, burger, core.
//
// IMPORTANTE PRO CLAUDE (ou qualquer um mexendo nisso depois):
// Os arquivos-fonte (cardapio-state.js, cardapio-menu.js, etc.)
// continuam existindo separados nesta mesma pasta — SÃO ELES que
// devem ser editados quando algo precisar mudar, nunca este
// arquivo diretamente (qualquer edição feita só aqui se perde na
// próxima vez que esse arquivo for regenerado). Depois de editar
// um dos 12 arquivos-fonte, regenere este juntando eles de novo,
// NA MESMA ORDEM listada acima, e suba esse resultado.

// ── cardapio-state.js ──────────────────────────────────────────
// ══════════════════════════════════════════
//  ESTADO GLOBAL — Cardápio
// ══════════════════════════════════════════
const sb = window.AppAPI;

// ── Tenant / plano ──
let _tenantId    = null;
let _tenantPlano = 'pro';  // 'pro' | 'premium'
let _waNumero    = null;   // WhatsApp do restaurante
let _storeName   = '';     // Nome publico da loja

// ── Dados do menu ──
let allItems     = [];
let allCats      = [];
let allCupons    = [];

// ── Carrinho ──
let cart         = [];
let activeCat    = '';
let searchQ      = '';
let deliveryType = 'delivery';
let selectedPay  = 'dinheiro';
let appliedCupom = null;

// ── Cashback ──
let _cbSaldo       = 0;    // saldo cashback disponível
let _cbUsar        = false; // cliente optou por usar cashback

// ── Taxas / entrega ──
let feeConfig     = {};
let selectedFaixa = 0;
let _pedidoMinimo = 0;
let _storeAddress = '';
let _storeLat     = null;
let _storeLng     = null;
let _tiposEntrega = ['delivery','retirada','mesa'];
let _pickupAddresses    = [];  // lista de { nome, endereco } — endereços adicionais de retirada
let _selectedPickupIdx  = 0;   // índice do endereço de retirada selecionado pelo cliente
// Seção "Não sabe qual carne escolher?" (robozinho + modal de preparo) —
// liga/desliga pelo gestor em Configurações. true até a config carregar.
let _mostrarIndicacaoPreparo = true;
// Agendamento de pedido quando a loja está fechada — idem, true por padrão.
let _permitirAgendamento = true;
let _agendamentoModalMostrado = false; // mostra o modal 1x por carregamento de página
let _pedidoAgendadoPara = null; // Date escolhida, preenchido ao confirmar no modal

// ── Segmento ──
let _segmento      = 'restaurante'; // 'restaurante' | 'acougue'
let _catsCarrossel = false;           // carrossel de categorias (gestor pode ativar)
let _filterPreparo = '';            // preparo selecionado para filtrar itens

// ── Estado da loja ──
let _lojaAberta  = true;

// ── Tracking ──
let _trackOrderId= null;
let _trackChannel= null;
let _initialOrderStatus = 'analise';
let _trackCurrentStatus = '';
let _waOptIn     = false;  // reservado para uso futuro

// ── Numeração de pedidos ──
let _orderNumOffset = 0;  // lido de store_config.order_num_offset (fallback)
function _orderNum(id, orderNum) {
  // Prefere order_num do servidor (sequencial por tenant)
  if (orderNum) return Number(orderNum);
  return Math.max(1, id - _orderNumOffset);
}

// ── Adicionais globalmente esgotados (Set de nomes normalizados) ──
let _addonsEsgotadosSet = new Set();
// Normalização — case-insensitive, sem acento, trim
function _normAddon(s) {
  return String(s||'').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function _isAddonEsgotado(nome) {
  return _addonsEsgotadosSet.has(_normAddon(nome));
}
// ── Adicional indisponível pelo dia da semana configurado (dom=0..sáb=6) ──
function _addonIndisponivelHoje(dias) {
  if (!Array.isArray(dias) || dias.length !== 7) return false; // sem config = disponível todos os dias
  const idxHoje = new Date().getDay();
  return !dias[idxHoje];
}

// ── PIX ──
let _pixPollTimer    = null;
let _pixMpId         = null;
let _pixAtivoGestor  = false;
let _pixKeyManual    = '';
let _pixKeyManualTipo  = 'aleatoria';
let _pixKeyManualBanco = '';

// ── Cartão de Crédito MP ──
let _mpPublicKey     = '';
let _cartaoAtivo     = false;
let _mpInstance      = null;  // instância do SDK MercadoPago
let _mpCardForm      = null;  // instância do CardForm

// ── Auth ──
let _customer    = null;
const AUTH_KEY   = 'estima_customer';
const PROFILE_KEY= 'estima_profile';
const ADDR_KEY   = 'ef_addr';

// ── Pizza meio a meio ──
let _halfItem       = null;   // item da 2ª metade selecionado
let _halfPickerOpen = false;

// ── cardapio-utils.js ──────────────────────────────────────────
// ══════════════════════════════════════════
//  UTILS — toast, fmt, rating
//  Estima Food — Cardápio
// ══════════════════════════════════════════
// ══════════════════════════════════════════
//  FIX AUTOPLAY DE VÍDEO NO iOS/SAFARI
// ══════════════════════════════════════════
// O iOS tem um limite de vídeos autoplay tocando ao mesmo tempo (mesmo
// mudos/inline). Numa grade de produtos, tentar tocar todos de uma vez
// estoura esse limite e a maioria não inicia — sem erro nenhum.
// Solução: só toca o vídeo quando o card entra na tela, pausa quando sai.
let _iosVideoObserver = null;
function _getIosVideoObserver() {
  if (_iosVideoObserver) return _iosVideoObserver;
  if (typeof IntersectionObserver === 'undefined') return null;
  _iosVideoObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const v = entry.target;
      if (entry.isIntersecting) {
        try {
          v.muted = true;
          v.defaultMuted = true;
          v.playsInline = true;
          const p = v.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (e) {}
      } else {
        try { v.pause(); } catch (e) {}
      }
    });
  }, { threshold: 0.25 });
  return _iosVideoObserver;
}

// Chamar isso logo após qualquer innerHTML que possa conter <video autoplay>.
function fixIosVideoAutoplay(container) {
  const root = container || document;
  const vids = root.querySelectorAll ? root.querySelectorAll('video[autoplay]') : [];
  const observer = _getIosVideoObserver();
  vids.forEach(v => {
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    if (observer) {
      observer.observe(v);
    } else {
      // fallback sem IntersectionObserver (navegador muito antigo)
      try {
        const p = v.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) {}
    }
  });
}

// ══════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════

// Ícones SVG para toasts — sem emojis
const _TOAST_ICONS = {
  ok:   `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" fill="rgba(34,197,94,.18)"/><path d="M4.5 8l2.5 2.5L11.5 5" stroke="#22c55e" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  err:  `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" fill="rgba(239,68,68,.18)"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#ef4444" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  warn: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2L14.5 13.5H1.5L8 2z" stroke="#f59e0b" stroke-width="1.3" fill="rgba(245,158,11,.15)" stroke-linejoin="round"/><path d="M8 6v3.5M8 11v.5" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  info: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" fill="rgba(99,102,241,.15)"/><path d="M8 7v4.5M8 5v.5" stroke="#6366f1" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  cart: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 2h1.5l1.8 7.5h6.5l1.2-5H5" stroke="#f97316" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="13" r="1" fill="#f97316"/><circle cx="12" cy="13" r="1" fill="#f97316"/></svg>`,
  meat: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 12c-1.5-1-2-3-1-5 1-2 3-3 5-2.5" stroke="#16a34a" stroke-width="1.4" stroke-linecap="round"/><path d="M10 4c2 .5 3 2.5 2 4.5S9 11 7 10" stroke="#16a34a" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="8" r="2" stroke="#16a34a" stroke-width="1.3"/></svg>`,
};

// Mapa de emoji → categoria de ícone (retrocompatibilidade)
const _EMOJI_TO_ICON = {
  '✅':'ok','🎉':'ok','✔':'ok','☑':'ok',
  '❌':'err','⛔':'err','🚫':'err',
  '⚠️':'warn','⚠':'warn',
  '🛒':'cart','🛍':'cart',
  '🥩':'meat','🍖':'meat','🥩':'meat',
  '💠':'info','💳':'info','💰':'info','📦':'info',
  '🔴':'err','🟢':'ok',
};

function toast(iconOrEmoji, msg) {
  const area = document.getElementById('toast-area');
  const el   = document.createElement('div');
  el.className = 'toast';

  // Detecta categoria pelo emoji ou string de tipo
  let cls  = 'info';
  let iconHtml = '';
  const mapped = _EMOJI_TO_ICON[iconOrEmoji];
  if (mapped) {
    cls = mapped;
  } else if (['ok','err','warn','info','cart','meat'].includes(iconOrEmoji)) {
    cls = iconOrEmoji;
  } else {
    // Emoji desconhecido → tenta detectar pelo conteúdo
    cls = 'info';
  }
  iconHtml = _TOAST_ICONS[cls] || _TOAST_ICONS.info;

  el.innerHTML = `<span class="toast-icon ${cls}">${iconHtml}</span><span>${msg}</span>`;
  area.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  }, 2800);
}

function fmt(n) {
  return Number(n||0).toFixed(2).replace('.',',');
}

// Som compartilhado do cardapio: toque curto e suave para chat/acompanhamento.
(function(){
  let notifyCtx = null;
  function getNotifyCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!notifyCtx) notifyCtx = new AC();
    return notifyCtx;
  }
  function note(ctx, freq, start, dur, vol) {
    const t0 = ctx.currentTime + start;
    const out = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3600, t0);
    out.connect(filter);
    filter.connect(ctx.destination);
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(vol, t0 + 0.018);
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    const main = ctx.createOscillator();
    main.type = 'sine';
    main.frequency.setValueAtTime(freq, t0);
    main.connect(out);
    main.start(t0);
    main.stop(t0 + dur + 0.02);

    const shine = ctx.createOscillator();
    const shineGain = ctx.createGain();
    shine.type = 'triangle';
    shine.frequency.setValueAtTime(freq * 2, t0);
    shineGain.gain.setValueAtTime(0.18, t0);
    shine.connect(shineGain);
    shineGain.connect(out);
    shine.start(t0);
    shine.stop(t0 + dur * 0.72);
  }
  function unlockNotifySound() {
    try {
      const ctx = getNotifyCtx();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch(e) {}
  }
  function playNotifySound(kind) {
    try {
      const ctx = getNotifyCtx();
      if (!ctx) return false;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
        return false;
      }
      const base = kind === 'status' ? [659.25, 880] : [587.33, 783.99];
      note(ctx, base[0], 0.01, 0.44, 0.12);
      note(ctx, base[1], 0.13, 0.54, 0.105);
      return true;
    } catch(e) {
      return false;
    }
  }
  window.efUnlockNotifySound = unlockNotifySound;
  window.efPlayNotifySound = playNotifySound;
  ['pointerdown','keydown','touchstart','click'].forEach(evt => {
    window.addEventListener(evt, unlockNotifySound, { once: true, passive: true });
  });
})();

// ══════════════════════════════════════════
//  MODAL DE AVALIAÇÃO (link ?rate=ID)
// ══════════════════════════════════════════
let _ratingOrderId = null;
let _ratingNota    = 0;
const RATING_LABELS = { 1:'Muito ruim 😠', 2:'Ruim 😕', 3:'Regular 😐', 4:'Bom 😊', 5:'Excelente 😍' };

function ratingPickStar(n) {
  _ratingNota = n;
  document.querySelectorAll('.rating-star').forEach(s => {
    s.classList.toggle('on', Number(s.dataset.v) <= n);
  });
  const lbl = document.getElementById('rating-label');
  if (lbl) lbl.textContent = RATING_LABELS[n] || '';
  const btn = document.getElementById('rating-send-btn');
  if (btn) btn.disabled = false;
}

function openRatingModal(orderId) {
  _ratingOrderId = orderId;
  _ratingNota    = 0;
  document.querySelectorAll('.rating-star').forEach(s => s.classList.remove('on'));
  const lbl = document.getElementById('rating-label');
  if (lbl) lbl.textContent = 'Toque em uma estrela para avaliar';
  const obs = document.getElementById('rating-obs');
  if (obs) obs.value = '';
  const btn = document.getElementById('rating-send-btn');
  if (btn) btn.disabled = true;
  const fw = document.getElementById('rating-form-wrap');
  const sw = document.getElementById('rating-success-wrap');
  if (fw) fw.style.display = '';
  if (sw) sw.style.display = 'none';
  const sub = document.getElementById('rating-sub');
  if (sub && orderId) {
    const numTxt = window._lastOrderNum ? `Pedido #${String(window._lastOrderNum).padStart(3,'0')}` : 'Seu pedido';
    sub.textContent = `${numTxt} — sua opinião é muito importante!`;
  }
  document.getElementById('rating-overlay')?.classList.add('on');
}

function closeRatingModal() {
  document.getElementById('rating-overlay')?.classList.remove('on');
  const url = new URL(window.location.href);
  url.searchParams.delete('rate');
  window.history.replaceState({}, '', url.toString());
}

async function submitRating() {
  if (!_ratingNota) return;
  const btn = document.getElementById('rating-send-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
  const comentario = document.getElementById('rating-obs')?.value.trim() || '';
  let client = '', phone = '';
  try {
    const sess = JSON.parse(localStorage.getItem('_customer') || sessionStorage.getItem('_customer') || '{}');
    client = sess.name  || sess.nome  || '';
    phone  = sess.phone || sess.fone  || '';
  } catch(e) {}
  try {
    const _tid = (typeof _tenantId !== 'undefined' && _tenantId) || window._tenantId || null;
    if (!_tid) throw new Error('tenant_id ausente — avaliação bloqueada');
    const { error } = await sb.from('ratings').insert({
      tenant_id:  _tid,
      order_id:   _ratingOrderId || null,
      client:     client || null,
      phone:      phone  || null,
      nota:       _ratingNota,
      comentario: comentario || null,
    });
    if (error) throw error;
    const fw = document.getElementById('rating-form-wrap');
    const sw = document.getElementById('rating-success-wrap');
    if (fw) fw.style.display = 'none';
    if (sw) sw.style.display = 'flex';
  } catch(e) {
    console.error('submitRating:', e);
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar avaliação'; }
    toast('❌', 'Erro ao enviar avaliação. Tente novamente.');
  }
}

// Detecta ?rate=ID na URL e abre modal automaticamente
(function checkRateParam() {
  const rateId = new URLSearchParams(window.location.search).get('rate');
  if (rateId) {
    window.addEventListener('load', () => {
      setTimeout(() => openRatingModal(parseInt(rateId, 10) || rateId), 800);
    });
  }
})();

// ── cardapio-auth.js ──────────────────────────────────────────
// ══════════════════════════════════════════
//  AUTH — Login, registro, logout, endereço salvo
//  Estima Food — Cardápio
// ══════════════════════════════════════════
function loadCustomerSession() {
  try {
    const saved = _loadCustomerSessionForTenant();
    _customer = saved || null;
  } catch(e) {}
  updateProfileFab();
}

function _customerAuthKey(tid) {
  return AUTH_KEY + '_' + (tid || _tenantId || 'default');
}

function _customerTenantFromToken(customer) {
  try {
    if (!customer?.token) return '';
    return atob(customer.token).split(':')[1] || '';
  } catch(e) { return ''; }
}

function _isCustomerFromCurrentTenant(customer) {
  if (!customer || !customer.id || !customer.token || !_tenantId) return false;
  return String(customer.tenant_id || _customerTenantFromToken(customer)) === String(_tenantId);
}

function _loadCustomerSessionForTenant() {
  const key = _customerAuthKey();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch(e) {}
  if (_isCustomerFromCurrentTenant(saved)) return saved;

  // Migra sessao antiga global apenas quando o token pertence ao tenant atual.
  try {
    const legacy = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    if (_isCustomerFromCurrentTenant(legacy)) {
      legacy.tenant_id = _tenantId;
      localStorage.setItem(key, JSON.stringify(legacy));
      return legacy;
    }
  } catch(e) {}
  return null;
}

function _saveCustomerSession(customer) {
  if (!customer || !_tenantId) return;
  customer.tenant_id = customer.tenant_id || _tenantId;
  localStorage.setItem(_customerAuthKey(), JSON.stringify(customer));
}

function updateProfileFab() {
  const fab  = document.getElementById('profile-fab');
  const av   = document.getElementById('profile-fab-av');
  const name = document.getElementById('profile-fab-name');
  if (!fab) return;
  if (_customer) {
    // Logado: avatar com inicial + nome
    if (av) {
      av.className = 'profile-fab-av';
      av.textContent = (_customer.name||'?').charAt(0).toUpperCase();
    }
    if (name) name.textContent = (_customer.name||'Eu').split(' ')[0];
  } else {
    // Deslogado: icone de pessoa preenchido + "Entrar"
    if (av) {
      av.className = 'profile-fab-av icon';
      av.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12.5c2.76 0 5-2.35 5-5.25S14.76 2 12 2 7 4.35 7 7.25s2.24 5.25 5 5.25Zm0 2.25c-3.6 0-8 1.83-8 5.1V22h16v-2.15c0-3.27-4.4-5.1-8-5.1Z"/></svg>';
    }
    if (name) name.textContent = 'Entrar';
  }
}

function onProfileFabClick() {
  if (typeof setBnavActive === 'function') setBnavActive('profile-fab');
  if (_customer) openAccount();
  else openAuth();
}

function openAuth(tab) {
  document.getElementById('auth-overlay').classList.add('on');
  if (tab) switchAuthTab(tab);
  document.getElementById('auth-err').classList.remove('on');
}
function closeAuth() {
  document.getElementById('auth-overlay').classList.remove('on');
  if (typeof setBnavActive === 'function') setBnavActive('bnav-cardapio');
}
function switchAuthTab(tab) {
  document.getElementById('tab-login').classList.toggle('on',    tab==='login');
  document.getElementById('tab-register').classList.toggle('on', tab==='register');
  document.getElementById('auth-form-login').style.display    = tab==='login'    ? '' : 'none';
  document.getElementById('auth-form-register').style.display = tab==='register' ? '' : 'none';
  document.getElementById('auth-err').classList.remove('on');
}

// ── Busca CEP via ViaCEP ────────────────────────────
function formatCEP(el) {
  let v = el.value.replace(/\D/g, '').slice(0, 8);
  if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
  el.value = v;
}

async function buscarCEP() {
  const cepRaw = (document.getElementById('f-cep')?.value || '').replace(/\D/g, '');
  const status = document.getElementById('cep-status');
  const btn    = document.getElementById('cep-btn');
  if (cepRaw.length !== 8) {
    if (status) { status.textContent = '⚠️ CEP deve ter 8 dígitos'; status.style.color = 'var(--danger,#ef4444)'; }
    return;
  }
  if (status) { status.textContent = '🔍 Buscando...'; status.style.color = 'var(--muted)'; }
  if (btn) { btn.disabled = true; btn.style.opacity = '.5'; }
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cepRaw}/json/`);
    const data = await res.json();
    if (data.erro) {
      if (status) { status.textContent = '❌ CEP não encontrado'; status.style.color = 'var(--danger,#ef4444)'; }
      return;
    }
    const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    set('f-rua',    data.logradouro);
    set('f-bairro', data.bairro);
    set('f-compl',  data.complemento);
    // Foca no campo número
    const numEl = document.getElementById('f-num');
    if (numEl) { numEl.value = ''; numEl.focus(); }
    if (status) {
      status.innerHTML = '✅ <strong>' + [data.logradouro, data.bairro, data.localidade + '-' + data.uf].filter(Boolean).join(', ') + '</strong>';
      status.style.color = 'var(--success,#22c55e)';
    }
    // Recalcula taxa por bairro se aplicável
    if (typeof feeConfig !== 'undefined' && feeConfig?.tipo === 'por_bairro' && typeof renderTotals === 'function') renderTotals();
  } catch(e) {
    if (status) { status.textContent = '❌ Erro na busca. Tente novamente.'; status.style.color = 'var(--danger,#ef4444)'; }
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

async function buscarCEPRegistro() {
  const cepRaw = (document.getElementById('reg-cep')?.value || '').replace(/\D/g, '');
  const status = document.getElementById('reg-cep-status');
  const addrEl = document.getElementById('reg-addr');
  if (cepRaw.length !== 8) {
    if (status) { status.textContent = '⚠️ CEP deve ter 8 dígitos'; status.style.color = 'var(--danger,#ef4444)'; }
    return;
  }
  if (status) { status.textContent = '🔍 Buscando...'; status.style.color = 'var(--muted)'; }
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cepRaw}/json/`);
    const data = await res.json();
    if (data.erro) {
      if (status) { status.textContent = '❌ CEP não encontrado'; status.style.color = 'var(--danger,#ef4444)'; }
      if (addrEl) addrEl.value = '';
      return;
    }
    const addrStr = [data.logradouro, data.bairro, data.localidade + '-' + data.uf].filter(Boolean).join(', ');
    if (addrEl) { addrEl.value = addrStr; addrEl.readOnly = false; }
    if (status) { status.textContent = '✅ Endereço encontrado!'; status.style.color = 'var(--success,#22c55e)'; }
  } catch(e) {
    if (status) { status.textContent = '❌ Erro na busca'; status.style.color = 'var(--danger,#ef4444)'; }
  }
}

async function doLogin() {
  const phone = document.getElementById('login-phone').value.trim();
  const senha = document.getElementById('login-senha').value;
  if (!phone||!senha) { showAuthErr('Preencha telefone e senha'); return; }
  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spin"></div> Entrando…';
  try {
    const res = await fetch('/api/customer-login', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-tenant-id':_tenantId},
      body: JSON.stringify({ phone, senha })
    });
    const data = await res.json();
    if (!res.ok) { showAuthErr(data.error||'Erro ao entrar'); return; }
    _customer = data;
    _saveCustomerSession(_customer);
    updateProfileFab();
    closeAuth();
    toast('👋', `Olá, ${data.name.split(' ')[0]}!`);
    fillCartForm();
    if (typeof loadRepeatOrderBanner === 'function') loadRepeatOrderBanner();
    if (typeof loadFavoritos === 'function') loadFavoritos();
    // Sincroniza com programa de fidelidade (caso ainda não esteja cadastrado)
    fetch('/api/fidelidade/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': _tenantId },
      body: JSON.stringify({ phone: data.phone, name: data.name })
    }).catch(() => {});
  } catch(e) {
    showAuthErr('Erro de conexão. Tente novamente.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Entrar na minha conta';
  }
}

async function doRegister() {
  const name     = document.getElementById('reg-name').value.trim();
  const phone    = document.getElementById('reg-phone').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const senha    = document.getElementById('reg-senha').value;
  const senha2   = document.getElementById('reg-senha2').value;
  const birthday = document.getElementById('reg-birthday').value;
  const addr     = (document.getElementById('reg-addr')?.value || '').trim();
  const btn      = document.getElementById('register-btn');
  document.getElementById('auth-err').classList.remove('on');
  if (!name)           { showAuthErr('Informe seu nome'); return; }
  if (!phone)          { showAuthErr('Informe seu WhatsApp'); return; }
  if (!senha)          { showAuthErr('Crie uma senha'); return; }
  if (senha.length < 6){ showAuthErr('Senha mínimo 6 caracteres'); return; }
  if (senha !== senha2){ showAuthErr('As senhas não coincidem'); return; }
  btn.disabled = true;
  btn.innerHTML = '<div class="spin"></div> Criando conta…';
  try {
    const res = await fetch('/api/customer-register', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-tenant-id':_tenantId},
      body: JSON.stringify({ name, phone, email, senha, birthday, addr })
    });
    const data = await res.json();
    if (!res.ok) { showAuthErr(data.error||'Erro ao criar conta'); return; }
    _customer = data;
    _saveCustomerSession(_customer);
    updateProfileFab();
    closeAuth();
    toast('🎉', `Bem-vindo, ${data.name.split(' ')[0]}!`);
    fillCartForm();
    if (typeof loadFavoritos === 'function') loadFavoritos();
    // Sincroniza com programa de fidelidade
    fetch('/api/fidelidade/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': _tenantId },
      body: JSON.stringify({ phone: data.phone, name: data.name })
    }).catch(() => {});
  } catch(e) {
    showAuthErr('Erro de conexão. Tente novamente.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Criar minha conta';
  }
}

function doLogout() {
  _customer = null;
  try {
    localStorage.removeItem(_customerAuthKey());
    localStorage.removeItem(AUTH_KEY);
  } catch(e) {}
  updateProfileFab();
  closeAccount();
  const banner = document.getElementById('repeat-order-banner');
  if (banner) { banner.style.display = 'none'; banner.innerHTML = ''; }
  if (typeof _favoritosCache !== 'undefined') _favoritosCache = [];
  if (typeof _atualizarCoracoesNaTela === 'function') _atualizarCoracoesNaTela();
  if (typeof renderFavoritosPage === 'function' && document.getElementById('favoritos-overlay')?.classList.contains('on')) renderFavoritosPage();
  toast('👋','Você saiu da conta');
}

function showAuthErr(msg) {
  const el = document.getElementById('auth-err');
  el.textContent = msg;
  el.classList.add('on');
}

function fillCartForm() {
  if (!_customer) return;
  const v = (id,val) => { const el=document.getElementById(id); if(el&&val) el.value=val; };
  v('f-name',  _customer.name);
  v('f-phone', _customer.phone);
  // Dispara consulta de cashback para cliente logado (oninput não é acionado por .value=)
  if (_customer.phone) onPhoneCashback(_customer.phone);
  loadSavedAddr();
  // Carrega endereços salvos do cliente
  if (typeof carregarEnderecosSalvos === 'function') carregarEnderecosSalvos();
}

// ── Endereço salvo ─────────────────────────────────────
// Chave por cliente logado (ID) ou por tenant (anônimo)
function _addrStorageKey() {
  const tid = _tenantId || 'default';
  return _customer?.id ? `${ADDR_KEY}_${tid}_c${_customer.id}` : `${ADDR_KEY}_${tid}`;
}

// Tenta parsear string "Rua, Num, Bairro, Compl, Ref: xxx" de volta para campos
function _parseAddrString(addrStr) {
  if (!addrStr || typeof addrStr !== 'string') return null;
  const parts = addrStr.split(', ');
  if (parts.length < 2) return null;
  // Extrai ponto de referência (parte que começa com "Ref:")
  let referencia = '';
  const refIdx = parts.findIndex(p => /^Ref:\s*/i.test(p));
  if (refIdx >= 0) {
    referencia = parts[refIdx].replace(/^Ref:\s*/i, '').trim();
    parts.splice(refIdx, 1);
  }
  return {
    rua: parts[0] || '',
    num: parts[1] || '',
    bairro: parts[2] || '',
    compl: parts.slice(3).join(', ') || '',
    referencia
  };
}

function _showAddrBanner(a) {
  const banner = document.getElementById('saved-addr-banner');
  const txt    = document.getElementById('saved-addr-text');
  if (!banner || !txt) return;
  const parts = [a.rua, a.num, a.bairro, a.compl, a.referencia ? 'Ref: ' + a.referencia : ''].filter(Boolean);
  if (!parts.length) return;
  txt.textContent = '📍 ' + parts.join(', ');
  banner.style.display = 'flex';
}

function loadSavedAddr() {
  if (deliveryType !== 'delivery') return;
  const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };

  // 1ª prioridade: localStorage estruturado (mesmo dispositivo ou cliente logado)
  try {
    const raw = localStorage.getItem(_addrStorageKey());
    if (raw) {
      const a = JSON.parse(raw);
      set('f-cep',    a.cep);
      set('f-rua',    a.rua);
      set('f-num',    a.num);
      set('f-bairro', a.bairro);
      set('f-compl',  a.compl);
      set('f-referencia', a.referencia);
      _showAddrBanner(a);
      if (feeConfig?.tipo === 'por_bairro') renderTotals();
      return;
    }
  } catch(e) {}

  // 2ª prioridade: addr do banco (cliente logado em outro dispositivo)
  if (_customer?.addr) {
    const a = _parseAddrString(_customer.addr);
    if (a && a.rua && a.num) {
      set('f-rua',    a.rua);
      set('f-num',    a.num);
      set('f-bairro', a.bairro);
      set('f-compl',  a.compl);
      set('f-referencia', a.referencia);
      _showAddrBanner(a);
      // Salva estruturado para próximas vezes neste dispositivo
      try { localStorage.setItem(_addrStorageKey(), JSON.stringify(a)); } catch(e) {}
      if (feeConfig?.tipo === 'por_bairro') renderTotals();
    }
  }
}

function saveDeliveryAddr() {
  if (deliveryType !== 'delivery') return;
  try {
    const g = id => (document.getElementById(id)?.value || '').trim();
    const rua = g('f-rua'); const num = g('f-num');
    if (!rua || !num) return;
    const a = { rua, num, bairro: g('f-bairro'), compl: g('f-compl'), referencia: g('f-referencia'), cep: g('f-cep') };
    // Salva estruturado no localStorage (chave por cliente se logado)
    localStorage.setItem(_addrStorageKey(), JSON.stringify(a));
    // Atualiza cache do cliente logado para cross-device via banco
    if (_customer) {
      _customer.addr = [rua, num, a.bairro, a.compl, a.referencia ? 'Ref: ' + a.referencia : ''].filter(Boolean).join(', ');
      try { _saveCustomerSession(_customer); } catch(e) {}
    }
  } catch(e) {}
}

function clearSavedAddr() {
  try { localStorage.removeItem(_addrStorageKey()); } catch(e) {}
  // Limpa do cache do cliente logado também
  if (_customer) {
    _customer.addr = '';
    try { _saveCustomerSession(_customer); } catch(e) {}
  }
  ['f-rua','f-num','f-bairro','f-compl','f-referencia'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const banner = document.getElementById('saved-addr-banner');
  if (banner) banner.style.display = 'none';
  if (typeof renderTotals === 'function') renderTotals();
}

// ══════════════════════════════════════════
//  MINHA CONTA
// ══════════════════════════════════════════
async function openAccount() {
  if (!_customer) { openAuth(); return; }
  const av = _customer.name.charAt(0).toUpperCase();
  document.getElementById('acc-avatar').textContent  = av;
  document.getElementById('acc-name').textContent    = _customer.name;
  document.getElementById('acc-meta').textContent    = [_customer.phone, _customer.email].filter(Boolean).join(' · ');
  document.getElementById('acc-pedidos').textContent = _customer.orders_count || 0;
  document.getElementById('account-overlay').classList.add('on');
  loadMyOrders();
}
function closeAccount() {
  document.getElementById('account-overlay').classList.remove('on');
  if (typeof setBnavActive === 'function') setBnavActive('bnav-cardapio');
}

async function loadMyOrders() {
  const list = document.getElementById('acc-orders-list');
  list.innerHTML = '<div style="padding:20px;text-align:center"><div style="font-size:28px">⏳</div></div>';
  try {
    const headers = {'x-tenant-id':_tenantId};
    if (_customer?.token) headers.Authorization = 'Bearer ' + _customer.token;
    const res    = await fetch(`/api/customer-orders?customer_id=${_customer.id}`, {
      headers
    });
    const orders = await res.json();
    if (!orders.length) {
      list.innerHTML = '<div class="empty-state" style="padding:28px 20px"><div class="empty-state-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2h1.5l1.8 7.5h6.5l1.2-5H5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="13" r="1" fill="currentColor"/><circle cx="12" cy="13" r="1" fill="currentColor"/></svg></div><div class="empty-state-text">Nenhum pedido ainda</div></div>';
      return;
    }
    const SL = {analise:'Aguardando',producao:'Preparando',pronto:'Pronto',saiu:'A caminho',entregue:'Entregue',cancelado:'Cancelado'};
    list.innerHTML = orders.map(o => {
      const itemsTxt = Array.isArray(o.items) ? o.items.map(i=>`${parseInt(i.qty)||1}× ${i.name || i.nome || 'Item'}`).join(', ') : '';
      const d = new Date(o.created_at);
      const dateStr = isNaN(d) ? '' : d.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
      const isActive = ['analise','producao','pronto','saiu'].includes(o.status);
      const waitingOnlinePayment = o.status === 'aguardando_cartao' || (o.status === 'aguardando_pix' && o.pag !== 'pix_manual');
      const numLabel = o.order_num ? '#' + String(o.order_num).padStart(3,'0') : (waitingOnlinePayment ? 'Aguardando pagamento' : 'Sem numero');
      // "Repetir pedido" disponível para pedidos finalizados (entregue/cancelado) com itens válidos
      const podeRepetir = !isActive && Array.isArray(o.items) && o.items.length > 0;
      return `
      <div class="order-card">
        <div class="order-card-clickarea" ${isActive?`onclick="openOrderTracker(${o.id},${o.order_num||0})"`:''} style="${isActive?'cursor:pointer':''}">
          <div class="order-card-head">
            <span class="order-card-num">${numLabel}</span>
            <span class="order-card-status ${o.status}">${SL[o.status]||o.status}</span>
          </div>
          <div class="order-card-items">${itemsTxt}</div>
          <div class="order-card-foot">
            <span class="order-card-total">R$ ${fmt(o.total)}</span>
            <span class="order-card-date">${dateStr}</span>
          </div>
          ${isActive?'<div style="font-size:11px;color:var(--accent);margin-top:6px;font-weight:600"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M1 13c1-3 2.5-5 7-5s6 2 7 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M3.5 11c.8-2 2-3 4.5-3s3.7 1 4.5 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="10" r="1.2" fill="currentColor"/></svg> Toque para acompanhar</div>':''}
        </div>
        ${podeRepetir ? `<button onclick="event.stopPropagation();repetirPedido(${o.id})" style="margin-top:8px;width:100%;padding:8px 12px;background:rgba(var(--accent-rgb,249,115,22),.08);border:1.5px solid var(--accent);color:var(--accent);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2.5 8a5.5 5.5 0 0 1 9.5-3.8M13.5 8a5.5 5.5 0 0 1-9.5 3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 1.5v3h-3M4 14.5v-3h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Repetir pedido
        </button>` : ''}
      </div>`;
    }).join('');
  } catch(e) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">Erro ao carregar pedidos</div>';
  }
}

function openOrderTracker(orderId, orderNum) {
  closeAccount();
  _trackOrderId = orderId;
  const initialNum = orderNum ? '#' + String(orderNum).padStart(3,'0') : 'Pagamento pendente';
  document.getElementById('track-order-num').textContent = orderNum ? 'Pedido ' + initialNum : 'Pedido aguardando pagamento';
  sb.from('orders').select('id,order_num,status,items,client,addr,total,taxa,pag,troco').eq('id', orderId).single().then(({data})=>{
    if (data) {
      updateTracker(data.status, data.addr);
      renderTrackItems(Array.isArray(data.items)?data.items:[], data.client, {
        addr: data.addr,
        total: data.total,
        taxa: data.taxa,
        pag: data.pag,
        troco: data.troco
      });
      // Atualiza número com order_num do banco
      const dataNum = data.order_num ? '#' + String(data.order_num).padStart(3,'0') : 'Pagamento pendente';
      document.getElementById('track-order-num').textContent = data.order_num ? 'Pedido ' + dataNum : 'Pedido aguardando pagamento';
      document.getElementById('track-num').textContent = dataNum;
    }
  });
  if (_trackChannel) try{ sb.removeChannel(_trackChannel); }catch(e){}
  _trackChannel = sb.channel('orders-rt')
    .on('postgres_changes',{event:'UPDATE',table:'orders'}, p => {
      if (Number(p.new.id) === orderId) {
        updateTracker(p.new.status, p.new.addr);
        if (p.new.order_num) {
          const novoNum = '#' + String(p.new.order_num).padStart(3,'0');
          document.getElementById('track-order-num').textContent = 'Pedido ' + novoNum;
          document.getElementById('track-num').textContent = novoNum;
        }
      }
    }).subscribe();
  document.getElementById('track-fab').classList.add('show');
  document.getElementById('track-num').textContent = initialNum;
  openTracker();
}

// ══════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════
// Múltiplos endereços salvos por cliente (apenas para logados)
// CRUD via tabela customer_enderecos. Cliente vê dropdown no checkout.
// ══════════════════════════════════════════════════════════════════════

async function carregarEnderecosSalvos() {
  const wrap = document.getElementById('end-salvos-wrap');
  const list = document.getElementById('end-salvos-list');
  if (!wrap || !list) return;
  if (!_customer || !_customer.id) { wrap.style.display = 'none'; return; }
  try {
    // fetch manual (não sb.from) — precisa mandar o token do cliente no
    // Authorization, senão o servidor não consegue confirmar que quem
    // está pedindo os endereços é o dono deles, e passa a bloquear.
    const headers = {'x-tenant-id': _tenantId};
    if (_customer?.token) headers.Authorization = 'Bearer ' + _customer.token;
    const res = await fetch(`/api/customer_enderecos?customer_id=eq.${_customer.id}&order=is_default.desc,id.desc`, { headers });
    const data = res.ok ? await res.json() : [];
    const eds = data || [];
    if (!eds.length) {
      wrap.style.display = '';
      list.innerHTML = '<div style="font-size:11.5px;color:var(--muted);padding:6px 2px;text-align:center">Nenhum endereço salvo. Preencha abaixo e salve para usar nos próximos pedidos.</div>';
      return;
    }
    wrap.style.display = '';
    list.innerHTML = eds.map(e => {
      const titulo = e.label || (e.rua ? `${e.rua}, ${e.numero || 's/n'}` : 'Endereço');
      const sub    = [e.bairro, e.complemento, e.referencia ? 'Ref: ' + e.referencia : ''].filter(Boolean).join(' • ');
      return `<div class="end-item" data-id="${e.id}" style="padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;cursor:pointer;display:flex;justify-content:space-between;gap:8px;align-items:center">
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;font-weight:700;color:var(--text)">${e.is_default ? '★ ' : ''}${titulo}</div>
          ${sub ? `<div style="font-size:11px;color:var(--muted);margin-top:1px;text-overflow:ellipsis;overflow:hidden;white-space:nowrap">${sub}</div>` : ''}
        </div>
        <button onclick="event.stopPropagation();excluirEnderecoSalvo(${e.id})" style="background:transparent;border:none;color:var(--danger,#ef4444);cursor:pointer;font-size:14px;padding:4px 8px" title="Excluir">✕</button>
      </div>`;
    }).join('');
    list.querySelectorAll('.end-item').forEach(div => {
      div.addEventListener('click', () => usarEnderecoSalvo(parseInt(div.dataset.id)));
    });
  } catch (e) {
    console.error('carregarEnderecosSalvos:', e);
    wrap.style.display = 'none';
  }
}

async function usarEnderecoSalvo(id) {
  try {
    const headers = {'x-tenant-id': _tenantId};
    if (_customer?.token) headers.Authorization = 'Bearer ' + _customer.token;
    const res = await fetch(`/api/customer_enderecos?id=eq.${id}`, { headers });
    const rows = res.ok ? await res.json() : [];
    const data = Array.isArray(rows) ? rows[0] : rows;
    if (!data) return;
    const set = (inputId, v) => { const el = document.getElementById(inputId); if (el) el.value = v || ''; };
    set('f-cep',        data.cep);
    set('f-rua',        data.rua);
    set('f-num',        data.numero);
    set('f-bairro',     data.bairro);
    set('f-compl',      data.complemento);
    set('f-referencia', data.referencia);
    document.querySelectorAll('.end-item').forEach(d => {
      d.style.borderColor = parseInt(d.dataset.id) === id ? 'var(--accent)' : 'var(--border)';
      d.style.background  = parseInt(d.dataset.id) === id ? 'rgba(var(--accent-rgb,249,115,22),.06)' : '';
    });
    if (typeof renderTotals === 'function') renderTotals();
    if (typeof toast === 'function') toast('info', 'Endereço carregado');
  } catch (e) { console.error('usarEnderecoSalvo:', e); }
}

async function abrirCadastrarEndereco() {
  if (!_customer || !_customer.id) {
    if (typeof toast === 'function') toast('warn', 'Faça login para salvar endereços');
    return;
  }
  const cep = (document.getElementById('f-cep')?.value || '').trim();
  const rua = (document.getElementById('f-rua')?.value || '').trim();
  const num = (document.getElementById('f-num')?.value || '').trim();
  const bairro = (document.getElementById('f-bairro')?.value || '').trim();
  const compl  = (document.getElementById('f-compl')?.value || '').trim();
  const ref    = (document.getElementById('f-referencia')?.value || '').trim();
  if (!rua || !num) {
    if (typeof toast === 'function') toast('warn', 'Preencha rua e número antes de salvar');
    return;
  }
  const label = prompt('Dê um nome a este endereço (ex: Casa, Trabalho):', '') || '';
  try {
    const { error } = await sb.from('customer_enderecos').insert({
      customer_id: _customer.id,
      label: label.trim() || null,
      cep, rua, numero: num, bairro, complemento: compl, referencia: ref,
      is_default: 0
    });
    if (error) throw error;
    if (typeof toast === 'function') toast('ok', 'Endereço salvo!');
    await carregarEnderecosSalvos();
  } catch (e) {
    if (typeof toast === 'function') toast('err', 'Erro ao salvar: ' + (e.message || ''));
  }
}

async function excluirEnderecoSalvo(id) {
  if (!confirm('Excluir este endereço?')) return;
  try {
    const { error } = await sb.from('customer_enderecos').delete().eq('id', id);
    if (error) throw error;
    if (typeof toast === 'function') toast('ok', 'Removido');
    await carregarEnderecosSalvos();
  } catch (e) {
    if (typeof toast === 'function') toast('err', 'Erro: ' + (e.message || ''));
  }
}

// ══════════════════════════════════════════════════════════════════════
// Repetir pedido — recria o carrinho com os mesmos itens de um pedido
// finalizado. Cruza com allItems pra pegar preço e disponibilidade atuais.
// Itens pausados/removidos são pulados com aviso.
// ══════════════════════════════════════════════════════════════════════
function _repeatNormName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _findMenuItemForRepeat(savedItem) {
  const menu = Array.isArray(allItems) ? allItems : [];
  if (!menu.length || !savedItem) return null;

  const savedId = Number(savedItem.id || savedItem.item_id || savedItem.menu_item_id || 0);
  if (savedId) {
    const byId = menu.find(x => Number(x.id) === savedId);
    if (byId) return byId;
  }

  const savedName = _repeatNormName(savedItem.name || savedItem.nome);
  if (!savedName) return null;

  const savedPrice = Number(savedItem.price || savedItem.preco || savedItem.valor || 0);
  const exact = menu.filter(x => _repeatNormName(x.name) === savedName);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1 && savedPrice > 0) {
    return exact.find(x => Math.abs(Number(x.price || 0) - savedPrice) < 0.01) || exact[0];
  }

  const partial = menu
    .map(x => ({ item: x, name: _repeatNormName(x.name) }))
    .filter(x => x.name && (savedName.includes(x.name) || x.name.includes(savedName)))
    .sort((a, b) => b.name.length - a.name.length);
  if (!partial.length) return null;
  if (savedPrice > 0) {
    const byPrice = partial.find(x => Math.abs(Number(x.item.price || 0) - savedPrice) < 0.01);
    if (byPrice) return byPrice.item;
  }
  return partial[0].item;
}

// "Peça de novo" — banner na tela principal do cardápio (não escondido dentro
// de Meus Pedidos) pra cliente repetir com 1 toque o último pedido entregue.
// Funciona pra cliente logado (via conta) E pra quem só fez checkout como
// convidado (via telefone salvo no navegador de um pedido anterior).
async function loadRepeatOrderBanner() {
  const wrap = document.getElementById('repeat-order-banner');
  if (!wrap) return;

  let url = '';
  const headers = { 'x-tenant-id': _tenantId };
  if (_customer && _customer.id) {
    url = `/api/customer-orders?customer_id=${_customer.id}`;
    if (_customer.token) headers.Authorization = 'Bearer ' + _customer.token;
  } else {
    // Sem conta — usa o telefone salvo de um checkout anterior (convidado)
    let telefoneSalvo = '';
    try {
      const perfil = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
      telefoneSalvo = (perfil.phone || '').replace(/\D/g, '');
    } catch (e) {}
    if (!telefoneSalvo) return; // nunca fez pedido nesse navegador — não mostra nada
    url = `/api/customer-orders?phone=${encodeURIComponent(telefoneSalvo)}`;
  }

  try {
    const res = await fetch(url, { headers });
    const orders = await res.json();
    if (!Array.isArray(orders) || !orders.length) return;
    const ultimo = orders.find(o => o.status === 'entregue' && Array.isArray(o.items) && o.items.length);
    if (!ultimo) return;

    const itensTxt = ultimo.items.map(i => `${parseInt(i.qty) || 1}× ${i.name || i.nome || 'Item'}`).join(', ');
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;background:rgba(var(--accent-rgb,249,115,22),.07);border:1.5px solid rgba(var(--accent-rgb,249,115,22),.25);border-radius:12px;padding:10px 12px">
        <div style="font-size:20px;line-height:1">🔁</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;font-weight:700;color:var(--accent)">Peça de novo</div>
          <div style="font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${itensTxt}</div>
        </div>
        <button onclick="repetirPedido(${ultimo.id})" style="flex-shrink:0;padding:7px 12px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">Repetir</button>
      </div>`;
    wrap.style.display = '';
  } catch (e) {
    console.warn('[repeat-order-banner] erro:', e);
  }
}

async function repetirPedido(orderId) {
  let query = sb.from('orders').select('items,addr,total,phone').eq('id', orderId);
  if (_customer && _customer.id) {
    query = query.eq('customer_id', _customer.id);
  } else {
    // Convidado (sem conta) — confirma que o pedido é do mesmo telefone salvo
    // no navegador, em vez de exigir customer_id (que convidado não tem).
    let telefoneSalvo = '';
    try {
      const perfil = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
      telefoneSalvo = (perfil.phone || '').replace(/\D/g, '');
    } catch (e) {}
    if (!telefoneSalvo) {
      if (typeof toast === 'function') toast('warn', 'Não foi possível confirmar seu telefone.');
      return;
    }
  }
  try {
    const { data, error } = await query.single();
    if (error || !data) {
      if (typeof toast === 'function') toast('err', 'Pedido não encontrado');
      return;
    }
    // Confirmação extra pro caso de convidado: telefone do pedido tem que bater
    // com o telefone salvo no navegador (evita repetir pedido de outra pessoa
    // que usou o mesmo aparelho).
    if (!(_customer && _customer.id)) {
      let telefoneSalvo = '';
      try {
        const perfil = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
        telefoneSalvo = (perfil.phone || '').replace(/\D/g, '');
      } catch (e) {}
      const telefonePedido = (data.phone || '').replace(/\D/g, '');
      if (!telefonePedido || telefonePedido !== telefoneSalvo) {
        if (typeof toast === 'function') toast('err', 'Pedido não encontrado');
        return;
      }
    }
    const itensSalvos = Array.isArray(data.items) ? data.items : (() => { try { return JSON.parse(data.items || '[]'); } catch { return []; } })();
    if (!itensSalvos.length) {
      if (typeof toast === 'function') toast('warn', 'Pedido sem itens válidos');
      return;
    }

    // Reseta cart e cupons
    if (typeof cart !== 'undefined') cart.length = 0;
    if (typeof appliedCupom !== 'undefined') appliedCupom = null;

    let pulados = 0;
    let adicionados = 0;
    for (const it of itensSalvos) {
      // Resolve item atual pelo id (preço pode ter mudado, item pode estar pausado/removido)
      // Pedidos antigos podem nao ter id do produto; tenta nome/preco tambem.
      const atual = _findMenuItemForRepeat(it);
      if (!atual) {
        // Item não disponível (pausado, removido ou de outra loja) — pula
        pulados++;
        continue;
      }
      // Cria item de carrinho usando preço atual do menu (não o histórico)
      // Mantém obs/customizações do pedido original quando possível
      const cartItem = {
        ...atual,
        // Preserva obs e customizações do pedido anterior (ex: "Sem cebola")
        obs: it.obs || '',
        qty: parseInt(it.qty) || 1
      };
      // Se item tinha customizações específicas (preço calculado, addons), preserva
      // mas marca o `name` original (que pode ter "+ Bacon" etc)
      if (it.name && it.name !== atual.name) cartItem.name = it.name;
      if (it.price && Math.abs(parseFloat(it.price) - parseFloat(atual.price)) > 0.01) {
        // Preço difere significativamente — usa o preço atual mas avisa
        cartItem.price = parseFloat(atual.price);
      }
      cart.push(cartItem);
      adicionados++;
    }

    if (!adicionados) {
      if (typeof toast === 'function') toast('err', 'Nenhum item desse pedido está disponível agora');
      return;
    }

    // Limpa cupom anterior se ficou no DOM
    const cupomInp = document.getElementById('cupom-input');
    if (cupomInp) cupomInp.value = '';
    const cupomMsg = document.getElementById('cupom-msg');
    if (cupomMsg) cupomMsg.innerHTML = '';

    // Fecha modal de conta e abre o carrinho
    if (typeof closeAccount === 'function') closeAccount();
    if (typeof updateCartFloat === 'function') updateCartFloat();
    if (typeof openCart === 'function') openCart();

    if (typeof toast === 'function') {
      const itemTxt = adicionados > 1 ? 'itens adicionados' : 'item adicionado';
      const msg = pulados > 0
        ? `🔁 ${adicionados} ${itemTxt} (${pulados} indisponíve${pulados>1?'is':'l'} pulado${pulados>1?'s':''})`
        : `🔁 ${adicionados} ${itemTxt} ao carrinho`;
      toast('cart', msg);
    }
  } catch (e) {
    console.error('repetirPedido:', e);
    if (typeof toast === 'function') toast('err', 'Erro ao repetir pedido');
  }
}

// ── cardapio-cart.js ──────────────────────────────────────────
// ══════════════════════════════════════════
//  CARRINHO — addToCart, totais, taxas, cupom, cashback
//  Estima Food — Cardápio
// ══════════════════════════════════════════

const CART_DRAFT_TTL_MS = 72 * 60 * 60 * 1000;

function _cartDraftKey() {
  return 'ef_cart_draft_' + (_tenantId || '');
}

function _cartDraftItem(i) {
  return {
    id: Number(i.id) || null,
    qty: Math.max(1, parseInt(i.qty || 1, 10)),
    name: String(i.name || ''),
    price: parseFloat(i.price || 0),
    obs: String(i.obs || ''),
    emoji: i.emoji || '',
    image_url: i.image_url || '',
    _grupos: i._grupos || null
  };
}

function saveCartDraft() {
  if (!_tenantId) return;
  try {
    const key = _cartDraftKey();
    if (!cart.length) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify({
      tenant_id: _tenantId,
      ts: Date.now(),
      items: cart.map(_cartDraftItem)
    }));
  } catch(e) {}
}

function clearCartDraft() {
  try { if (_tenantId) localStorage.removeItem(_cartDraftKey()); } catch(e) {}
}

function restoreCartDraft() {
  if (!_tenantId || !Array.isArray(allItems) || !allItems.length || cart.length) return;
  try {
    const raw = localStorage.getItem(_cartDraftKey());
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || data.tenant_id !== _tenantId || !Array.isArray(data.items)) {
      clearCartDraft();
      return;
    }
    if (Date.now() - parseInt(data.ts || 0, 10) > CART_DRAFT_TTL_MS) {
      clearCartDraft();
      return;
    }

    const restored = [];
    data.items.forEach(saved => {
      const live = allItems.find(i => Number(i.id) === Number(saved.id));
      if (!live || live.status === 'pausado' || live.status === 'esgotado') return;
      restored.push({
        ...live,
        qty: Math.max(1, parseInt(saved.qty || 1, 10)),
        name: saved.name || live.name,
        price: Number.isFinite(parseFloat(saved.price)) ? parseFloat(saved.price) : parseFloat(live.price || 0),
        obs: saved.obs || '',
        emoji: saved.emoji || live.emoji || '',
        image_url: saved.image_url || live.image_url || '',
        _grupos: saved._grupos || null
      });
    });

    if (!restored.length) {
      clearCartDraft();
      return;
    }
    cart = restored;
    updateCartFloat();
  } catch(e) {
    clearCartDraft();
  }
}

// Normaliza string pra comparação: remove acentos, espaços extras, caso.
// Antes o match exigia digitação exata — qualquer diferença (acento, maiúscula,
// espaço duplo) dava "fora da área". Agora bate mesmo com pequenas variações.
function _normBairro(s) {
  return (s || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acentos
    .replace(/\s+/g, ' '); // normaliza espaços
}

// Distância de Levenshtein: quantas letras precisa mudar pra uma string virar outra.
// Útil pra detectar erros de digitação tipo "Aldoeta" → "Aldeota" (1 letra).
function _levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

// Match flexível de bairro contra a lista cadastrada.
// Retorna o objeto do bairro encontrado (ou null) usando 3 estratégias em ordem:
//   1) Match exato após normalização (acento/espaço/caso)
//   2) Match por prefixo ou substring (cliente digitou parte do nome)
//   3) Fuzzy match com Levenshtein (até 2 letras de diferença em bairros >=5 chars)
// Se múltiplos baterem na fuzzy, devolve o mais próximo. Se houver empate ou
// distância grande, retorna null pra evitar match errado.
function _matchBairro(digitadoRaw, bairrosLista) {
  if (!digitadoRaw || !Array.isArray(bairrosLista) || !bairrosLista.length) return null;
  const digitado = _normBairro(digitadoRaw);
  if (!digitado) return null;

  // 1) Exato (com acento/espaço/caso normalizados)
  const exato = bairrosLista.find(b => _normBairro(b.bairro || b) === digitado);
  if (exato) return exato;

  // 2) Substring — cliente digitou "centro" e cadastro tem "Centro Histórico"
  // ou cliente digitou "Aldeota Sul" e cadastro tem "Aldeota". Aceita só se for
  // único pra evitar ambiguidade (ex: "Vila" bater em 5 vilas diferentes).
  const subset = bairrosLista.filter(b => {
    const cad = _normBairro(b.bairro || b);
    return cad.includes(digitado) || digitado.includes(cad);
  });
  if (subset.length === 1) return subset[0];

  // 3) Fuzzy — até 2 letras de diferença em strings com >=5 chars,
  // ou 1 letra em strings menores. Retorna o mais próximo se for único.
  const distancias = bairrosLista
    .map(b => ({ b, d: _levenshtein(digitado, _normBairro(b.bairro || b)) }))
    .sort((a, b) => a.d - b.d);
  const melhor = distancias[0];
  const segundoMelhor = distancias[1];
  if (melhor) {
    const tamanhoMin = Math.min(digitado.length, _normBairro(melhor.b.bairro || melhor.b).length);
    const tolerancia = tamanhoMin >= 5 ? 2 : 1;
    // Só aceita se for claramente o mais próximo (distância pra 2º maior que +1)
    if (melhor.d <= tolerancia && (!segundoMelhor || segundoMelhor.d > melhor.d)) {
      return melhor.b;
    }
  }

  return null;
}

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
  // Pedido mínimo do cupom: revalida a cada cálculo, pois o carrinho pode
  // mudar (itens removidos) depois que o cupom foi aplicado. Sem isso, o
  // desconto continuava valendo mesmo com o subtotal abaixo do mínimo exigido.
  const minOrder = parseFloat(appliedCupom.min_order ?? appliedCupom.minimo ?? 0);
  if (minOrder > 0 && sub < minOrder) return 0;
  const tipo = appliedCupom.type || appliedCupom.tipo || '';
  const val  = parseFloat(appliedCupom.value ?? appliedCupom.val ?? 0);
  if (tipo === 'percent' || tipo === '%') return sub * val / 100;
  // Cupom de frete: zera a taxa (via lógica em getTaxa). Aqui retorna 0 pra evitar dupla contagem.
  if (tipo === 'frete') return 0;
  return Math.min(val, sub);
}

function getTaxa() {
  if (deliveryType !== 'delivery') return 0;
  if (appliedCupom?.tipo === 'frete' || appliedCupom?.type === 'frete') {
    const minOrderFrete = parseFloat(appliedCupom.min_order ?? appliedCupom.minimo ?? 0);
    if (!(minOrderFrete > 0 && cartSubtotal() < minOrderFrete)) return 0;
  }
  if (feeConfig.tipo === 'por_km') {
    const faixas = feeConfig.faixas || [];
    return parseFloat(faixas[Math.min(selectedFaixa, faixas.length-1)]?.taxa) || 0;
  }
  if (feeConfig.tipo === 'por_bairro') {
    const bairros = feeConfig.bairros || [];
    if (!bairros.length) return 0;
    const digitadoRaw = (document.getElementById('f-bairro')?.value || '');
    const match = _matchBairro(digitadoRaw, bairros);
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

  // Config nunca foi salva de verdade pra essa loja (delivery_fee_config
  // vazio no banco) — o painel do gestor MOSTRA "Fixo, R$5" por padrão
  // mesmo nesse caso (_taxaConfig.tipo || 'fixo'), então o dono pode achar
  // que está configurado quando na real não está. Sem essa checagem, o
  // getTaxa() cai no fallback final e cobra R$0 silenciosamente.
  const _tiposValidos = ['fixo', 'por_km', 'por_bairro'];
  if (!_tiposValidos.includes(feeConfig?.tipo)) {
    return { ok: false, motivo: 'A taxa de entrega ainda não foi configurada pela loja. Avise o restaurante antes de finalizar o pedido.' };
  }

  // por_bairro: bairro precisa existir na lista
  if (feeConfig?.tipo === 'por_bairro') {
    const bairros = Array.isArray(feeConfig.bairros) ? feeConfig.bairros : [];
    if (!bairros.length) {
      // ANTES: return { ok: true } aqui liberava o pedido de graça sempre
      // que a loja escolhia "por_bairro" mas ainda não tinha cadastrado
      // nenhum bairro — a taxa saía R$0 sem ninguém perceber. Bloqueia até
      // a loja configurar ao menos um bairro.
      return { ok: false, motivo: 'A área de entrega ainda não foi configurada pela loja. Entre em contato para confirmar se atendemos seu endereço.' };
    }
    const digitadoRaw = (document.getElementById('f-bairro')?.value || '').trim();
    if (!digitadoRaw) return { ok: false, motivo: 'Informe o bairro para calcular a taxa de entrega' };
    const match = _matchBairro(digitadoRaw, bairros);
    if (!match) {
      // Se não bateu, mostra os 3 bairros mais próximos pra cliente conferir.
      // Ajuda quando ele digita errado mas o bairro existe (ex: "Aldoeta" → "Aldeota").
      const sugestoes = bairros
        .map(b => ({ nome: b.bairro, d: _levenshtein(_normBairro(digitadoRaw), _normBairro(b.bairro)) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 3)
        .map(s => s.nome)
        .join(', ');
      return {
        ok: false,
        motivo: sugestoes
          ? `Bairro "${digitadoRaw}" não encontrado. Você quis dizer: ${sugestoes}? Verifique a grafia ou fale com a loja.`
          : 'Bairro fora da área de entrega. Fale com o restaurante.'
      };
    }
  }
  // por_km: exige GPS confirmado e dentro da maior faixa
  if (feeConfig?.tipo === 'por_km') {
    const faixas = Array.isArray(feeConfig.faixas) ? feeConfig.faixas : [];
    if (!faixas.length) {
      // ANTES: lista vazia caía direto no "return {ok:true}" final e
      // liberava o pedido com taxa R$0 — mesma falha do caso por_bairro.
      return { ok: false, motivo: 'A área de entrega ainda não foi configurada pela loja. Entre em contato para confirmar se atendemos seu endereço.' };
    }
    // GPS ainda não respondeu ou foi negado — bloqueia até confirmar localização
    if (typeof _geoDistKm !== 'number' || _geoDistKm <= 0) {
      return { ok: false, motivo: '📍 Precisamos confirmar sua localização. Permita o acesso ao GPS e aguarde.' };
    }
    const maiorFaixa = parseFloat(faixas[faixas.length - 1]?.ate_km || 0);
    if (_geoDistKm > maiorFaixa + 0.001) {
      return { ok: false, motivo: `🚫 Você está a ${_geoDistKm.toFixed(1).replace('.', ',')} km — fora da área de entrega (até ${maiorFaixa} km).` };
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
  saveCartDraft();
  const qty = cart.reduce((s,i) => s+i.qty, 0);
  document.getElementById('cart-float').classList.toggle('show', cart.length > 0);
  document.getElementById('cart-badge').textContent = qty;
  document.getElementById('cart-total-float').textContent = fmt(displayTotal());
  const btn = document.getElementById('confirm-btn');
  if (btn) {
    // Mesma checagem de agendamento do applyStatus() — sem isso, essa função
    // (que roda toda vez que o carrinho muda) sobrescrevia o botão de volta
    // pro estado "desabilitado", desfazendo a liberação do pedido agendado.
    const _pedidoAgendadoSeguro = (typeof _pedidoAgendadoPara !== 'undefined') ? _pedidoAgendadoPara : null;
    const podeAgendado = !_lojaAberta && _pedidoAgendadoSeguro;
    btn.disabled = cart.length === 0 || (!_lojaAberta && !podeAgendado);
  }
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
  const res = document.getElementById('geo-result');
  if (!navigator.geolocation) {
    if (res) res.innerHTML = '<span style="color:var(--red)">⚠️ GPS não disponível neste dispositivo. Não é possível confirmar a área de entrega.</span>';
    return;
  }
  if (res) res.innerHTML = '<span style="color:var(--accent)">📡 Obtendo sua localização... aguarde para finalizar o pedido.</span>';
  navigator.geolocation.getCurrentPosition(
    pos => {
      const dist = calcDist(_storeLat, _storeLng, pos.coords.latitude, pos.coords.longitude);
      _geoDistKm = dist;
      const faixas = feeConfig?.faixas || [];
      const maiorFaixa = parseFloat(faixas[faixas.length - 1]?.ate_km || 0);
      const distStr = dist.toFixed(1).replace('.', ',');
      // Fora da área: avisa claramente e não permite prosseguir
      if (!faixas.length || dist > maiorFaixa + 0.001) {
        if (res) res.innerHTML = `<span style="color:var(--red)">🚫 Você está a <strong>${distStr} km</strong> — fora da área de entrega (máx. ${maiorFaixa} km). Não é possível finalizar o pedido.</span>`;
        renderTotals();
        return;
      }
      const idx = faixas.findIndex(f => f.ate_km >= dist);
      if (idx >= 0) selectedFaixa = idx;
      const faixaSel = faixas[selectedFaixa];
      if (res) res.innerHTML = `<span style="color:var(--green)">📍 Você está a <strong>${distStr} km</strong> — Taxa: <strong>R$ ${fmt(faixaSel.taxa)}</strong></span>`;
      renderTotals();
    },
    err => {
      // GPS negado/falhou — bloqueia pedido, não permite seleção manual
      if (res) res.innerHTML = '<span style="color:var(--red)">⚠️ Localização negada. Permita o acesso ao GPS para finalizar o pedido por km.</span>';
      _geoDistKm = null;
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
  if (type === 'mesa') _montarGradeMesas();
  // O card "Entrega" (título + moldura) só existe pra dar contexto ao
  // endereço/mesa — sem isso, escolher "Retirada" deixava um card vazio
  // sobrando na tela, sem nenhum campo dentro.
  const entregaSection = document.getElementById('checkout-entrega-section');
  if (entregaSection) entregaSection.style.display = (type==='delivery' || type==='mesa') ? '' : 'none';

  // Endereço de retirada — simples (sem filiais extras) ou seletor de filial
  const retBlock    = document.getElementById('retirada-addr-block');
  const retText     = document.getElementById('retirada-addr-text');
  const pickupBlock = document.getElementById('pickup-selector-block');

  // Monta lista completa: endereço principal + filiais adicionais
  const allPickup = [];
  if (_storeAddress) allPickup.push({ nome: 'Principal', endereco: _storeAddress });
  if (_pickupAddresses && _pickupAddresses.length) {
    _pickupAddresses.forEach(p => allPickup.push({ nome: p.nome || 'Filial', endereco: p.endereco || '' }));
  }

  if (type === 'retirada' && allPickup.length > 0) {
    // Sempre mostra o bloco de retirada
    if (retBlock) retBlock.style.display = '';

    if (allPickup.length === 1) {
      // Apenas 1 endereço: mostra texto simples, oculta seletor
      if (retText)     { retText.style.display = ''; retText.textContent = allPickup[0].endereco; }
      if (pickupBlock) pickupBlock.style.display = 'none';
      _selectedPickupIdx = 0;
    } else {
      // Múltiplas filiais: oculta texto simples, exibe seletor
      if (retText)     retText.style.display = 'none';
      if (pickupBlock) {
        pickupBlock.style.display = '';
        _renderPickupSelector(allPickup);
      }
    }
  } else {
    if (retBlock)    retBlock.style.display = 'none';
    if (pickupBlock) pickupBlock.style.display = 'none';
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

// Grade de números de mesa — visual tocável em vez de digitar (pensado pro
// tablet fixo na mesa, mas funciona igual no cardápio normal também). Só
// monta uma vez por sessão de checkout; reaproveita se já montada.
let _mesaGradeMontada = false;
function _montarGradeMesas(qtdPadrao) {
  const grid = document.getElementById('mesa-grid');
  if (!grid || _mesaGradeMontada) return;
  _mesaGradeMontada = true;
  const total = qtdPadrao || 24; // cobre a maioria dos salões; "Outro número" resolve o resto
  let html = '';
  for (let n = 1; n <= total; n++) {
    html += `<button type="button" class="mesa-num-btn" data-mesa="${n}" onclick="_selecionarMesaGrade(${n},this)">${n}</button>`;
  }
  html += `<button type="button" class="mesa-num-btn mesa-num-outro" onclick="_abrirMesaOutro(this)">Outro</button>`;
  grid.innerHTML = html;
}

function _selecionarMesaGrade(numero, btn) {
  document.getElementById('f-mesa').value = numero;
  document.getElementById('mesa-outro-wrap').style.display = 'none';
  document.querySelectorAll('.mesa-num-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
}

function _abrirMesaOutro(btn) {
  document.querySelectorAll('.mesa-num-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  const wrap = document.getElementById('mesa-outro-wrap');
  wrap.style.display = '';
  const inp = document.getElementById('f-mesa');
  inp.value = '';
  inp.focus();
}

// Chamado pelo próprio campo de texto (quando o cliente digita em "Outro"),
// só pra garantir que nenhum botão da grade fique marcado por engano.
function _marcarMesaSelecionada(valor) {
  document.querySelectorAll('.mesa-num-btn:not(.mesa-num-outro)').forEach(b => {
    b.classList.toggle('on', b.dataset.mesa === String(valor));
  });
}

function _renderPickupSelector(allPickup) {
  const wrap = document.getElementById('pickup-selector-block');
  if (!wrap) return;
  // Clamp selected index to valid range
  if (_selectedPickupIdx >= allPickup.length) _selectedPickupIdx = 0;

  wrap.innerHTML = `
    <div style="font-size:11.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">
      📍 Escolha o ponto de retirada
    </div>
    <div style="display:flex;flex-direction:column;gap:6px" id="pickup-options-list">
      ${allPickup.map((p, i) => `
        <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;border:1.5px solid ${i === _selectedPickupIdx ? 'var(--accent)' : 'var(--border)'};background:${i === _selectedPickupIdx ? 'rgba(var(--accent-rgb),.06)' : 'var(--s2)'};cursor:pointer;transition:border-color .15s,background .15s" onclick="_selectPickup(${i})">
          <span style="width:16px;height:16px;border-radius:50%;border:2px solid ${i === _selectedPickupIdx ? 'var(--accent)' : 'var(--border)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;background:${i === _selectedPickupIdx ? 'var(--accent)' : 'transparent'};transition:all .15s">
            ${i === _selectedPickupIdx ? '<span style="width:6px;height:6px;border-radius:50%;background:#fff;display:block"></span>' : ''}
          </span>
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;font-weight:700;color:${i === _selectedPickupIdx ? 'var(--accent)' : 'var(--text)'};margin-bottom:2px">${p.nome || 'Filial'}</div>
            <div style="font-size:11.5px;color:var(--muted);line-height:1.4">${p.endereco || ''}</div>
          </div>
        </label>
      `).join('')}
    </div>
  `;
}

function _selectPickup(idx) {
  const allPickup = [];
  if (_storeAddress) allPickup.push({ nome: 'Principal', endereco: _storeAddress });
  if (_pickupAddresses && _pickupAddresses.length) {
    _pickupAddresses.forEach(p => allPickup.push({ nome: p.nome || 'Filial', endereco: p.endereco || '' }));
  }
  _selectedPickupIdx = idx;
  _renderPickupSelector(allPickup);
}

// Retorna o endereço de retirada atualmente selecionado
// IMPORTANTE: sempre inicia com "Retirada" para que _detectOrderType classifique corretamente
// (sem esse prefixo, endereços de filial caíam no default "delivery" no kanban)
function _getSelectedPickupAddr() {
  const allPickup = [];
  if (_storeAddress) allPickup.push({ nome: 'Principal', endereco: _storeAddress });
  if (_pickupAddresses && _pickupAddresses.length) {
    _pickupAddresses.forEach(p => allPickup.push({ nome: p.nome || 'Filial', endereco: p.endereco || '' }));
  }
  if (!allPickup.length) return 'Retirada no balcão';
  const sel = allPickup[_selectedPickupIdx] || allPickup[0];
  const parts = ['Retirada'];
  if (allPickup.length > 1 && sel.nome) parts.push(`[${sel.nome}]`);
  if (sel.endereco) parts.push(sel.endereco);
  return parts.join(' — ');
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
          ${i.image_url ? `<img src="${i.image_url}" alt="${i.name}" loading="lazy" decoding="async">` : i.emoji||'🍽️'}
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
  const stDesc = getStampDesconto();
  const tot    = displayTotal();
  const isCupomFrete = appliedCupom && (appliedCupom.tipo === 'frete' || appliedCupom.type === 'frete');
  let taxaLabel = 'Taxa de entrega';
  if (deliveryType === 'delivery' && feeConfig?.tipo === 'por_km') {
    const f = (feeConfig.faixas||[])[selectedFaixa];
    if (f) taxaLabel = `Entrega até ${f.ate_km} km`;
  } else if (deliveryType === 'delivery' && feeConfig?.tipo === 'por_bairro') {
    const digitadoRaw = (document.getElementById('f-bairro')?.value || '').trim();
    const match = _matchBairro(digitadoRaw, feeConfig.bairros || []);
    if (match) taxaLabel = `Entrega — ${match.bairro}`;
    else if (digitadoRaw) taxaLabel = 'Bairro não encontrado';
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

async function applyCupom() {
  const code = document.getElementById('cupom-input').value.trim().toUpperCase();
  const msg  = document.getElementById('cupom-msg');
  if (!code) return;
  msg.innerHTML = '<div class="cupom-msg">⏳ Validando...</div>';

  // Valida no servidor (anti-fraude). consume=false: só checa, não decrementa
  // o uses_left. O decremento real acontece no /api/cupom/validar com consume=true
  // chamado pelo cardapio-checkout.js ao criar o pedido.
  try {
    const r = await fetch('/api/cupom/validar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': window._tenantId || '' },
      body: JSON.stringify({ code, subtotal: cartSubtotal(), consume: false })
    });
    const d = await r.json();
    if (!d.ok) {
      msg.innerHTML = `<div class="cupom-err">❌ ${d.error || 'Cupom inválido'}</div>`;
      appliedCupom = null;
    } else {
      // Usa os dados oficiais retornados pelo servidor (não os do client)
      appliedCupom = {
        code: d.code,
        type: d.type,
        value: d.value,
        min_order: d.min_order,
      };
      msg.innerHTML = `<div class="cupom-ok">✅ Cupom "${d.code}" aplicado!</div>`;
    }
  } catch (e) {
    // Fallback offline: valida só com os dados do client (cupons já carregados)
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
  }
  renderTotals();
}

// ── Cashback no checkout ─────────────────────────────
// ── Cartão Fidelidade (Carimbinho) ─────────────────
let _stampElegivel      = false;
let _stampCompras       = 0;
let _stampMeta          = 10;
let _stampRecompensaTipo  = 'pedido_gratis';
let _stampRecompensaValor = 0;
let _stampUsado         = false;  // true quando a recompensa já foi aplicada nesta sessão

function getStampDesconto() {
  if (!_stampElegivel || !_stampUsado) return 0;
  const sub = cartSubtotal();
  if (_stampRecompensaTipo === 'pedido_gratis') return sub;
  if (_stampRecompensaTipo === 'frete_gratis')  return 0; // taxa zerada separado
  if (_stampRecompensaTipo === 'percent')        return Math.min(sub, parseFloat((sub * _stampRecompensaValor / 100).toFixed(2)));
  if (_stampRecompensaTipo === 'fixo')           return Math.min(sub, _stampRecompensaValor);
  return 0;
}

function _resetStampUI() {
  _stampElegivel = false; _stampCompras = 0; _stampUsado = false;
  const bl = document.getElementById('stamp-block');
  if (bl) bl.style.display = 'none';
  renderTotals();
}

let _cbLookupTimer = null;
async function onPhoneCashback(raw) {
  const phone = raw.replace(/\D/g,'');
  if (phone.length < 8) { _resetCashbackUI(); _resetStampUI(); _resetFidelidadeUI(); return; }
  clearTimeout(_cbLookupTimer);
  _cbLookupTimer = setTimeout(async () => {
    const tid = _tenantId || '';

    // ── Cashback ──
    try {
      const r = await fetch(`/api/cashback/saldo?phone=${phone}&tenant_id=${encodeURIComponent(tid)}`);
      if (!r.ok) { _resetCashbackUI(); }
      else {
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
      }
    } catch(e) { _resetCashbackUI(); }

    // ── Cartão Fidelidade (carimbinho) ──
    try {
      const rs = await fetch(`/api/stamp/check?phone=${phone}`, { headers: { 'x-tenant-id': tid } });
      if (!rs.ok) { _resetStampUI(); }
      else {
        const ds = await rs.json();
        if (!ds.ativo) { _resetStampUI(); }
        else {
          _stampMeta          = ds.meta || 10;
          _stampCompras       = ds.compras || 0;
          _stampElegivel      = !!ds.elegivel;
          _stampRecompensaTipo  = ds.recompensa_tipo || 'pedido_gratis';
          _stampRecompensaValor = parseFloat(ds.recompensa_valor || 0);
          const bl = document.getElementById('stamp-block');
          const prog = document.getElementById('stamp-progress-txt');
          const pbar = document.getElementById('stamp-progress-bar');
          const act  = document.getElementById('stamp-action');
          if (bl) {
            bl.style.display = '';
            const pct = Math.min(100, Math.round((_stampCompras / _stampMeta) * 100));
            if (pbar) pbar.style.width = pct + '%';
            if (prog) prog.textContent = _stampElegivel
              ? '🎁 Recompensa disponível! Aplicar no pedido?'
              : `🃏 ${_stampCompras}/${_stampMeta} pedidos — faltam ${_stampMeta - _stampCompras}`;
            if (act) act.style.display = _stampElegivel ? '' : 'none';
          }
          renderTotals();
        }
      }
    } catch(e) { _resetStampUI(); }

    // ── Pontos de fidelidade ──
    try {
      const rf = await fetch(`/api/fidelidade/saldo?phone=${phone}`, { headers: { 'x-tenant-id': tid } });
      if (!rf.ok) { _resetFidelidadeUI(); }
      else {
        const df = await rf.json();
        if (!df.ativo) { _resetFidelidadeUI(); }
        else {
          const bl   = document.getElementById('fid-block');
          const prog = document.getElementById('fid-progress-txt');
          const pbar = document.getElementById('fid-progress-bar');
          if (bl && (df.pts > 0 || df.meta > 0)) {
            bl.style.display = '';
            const pct = Math.min(100, Math.round((df.pts / df.meta) * 100));
            if (pbar) pbar.style.width = pct + '%';
            if (prog) prog.textContent = df.elegivel
              ? `🎁 Você tem ${df.pts} pontos — resgate ${df.recompensa_reais > 0 ? 'R$ ' + df.recompensa_reais.toFixed(2).replace('.', ',') + ' de desconto' : 'sua recompensa'}!`
              : `⭐ ${df.pts}/${df.meta} pontos — faltam ${df.faltam} para a recompensa`;
          } else {
            _resetFidelidadeUI();
          }
        }
      }
    } catch(e) { _resetFidelidadeUI(); }
  }, 600);
}

function _resetFidelidadeUI() {
  const bl = document.getElementById('fid-block');
  if (bl) bl.style.display = 'none';
}

function toggleStampUso() {
  if (!_stampElegivel) return;
  _stampUsado = !_stampUsado;
  const btn = document.getElementById('stamp-usar-btn');
  if (btn) btn.textContent = _stampUsado ? '✅ Aplicado — remover' : '🎁 Usar recompensa';
  renderTotals();
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
    const usar = getCashbackDesconto();
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

  dd.innerHTML = lista.map(b => `<div class="bairro-opt-card" data-nome="${(b.bairro || '').replace(/"/g, '&quot;')}" style="padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);color:var(--text)" onmouseover="this.style.background='var(--s2,rgba(0,0,0,.04))'" onmouseout="this.style.background=''">
    <span>${b.bairro}</span>
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

// ── cardapio-menu.js ──────────────────────────────────────────
// ══════════════════════════════════════════
//  MENU — Categorias, busca, renderMenu, itemCard, checklist
//  Estima Food — Cardápio
// ══════════════════════════════════════════
function buildCats() {
  const scroll = document.getElementById('cats-scroll');
  const isAcougue = _segmento === 'acougue';
  const isModerno = document.documentElement.getAttribute('data-tema') === 'moderno';
  const useCarrossel = isAcougue || _catsCarrossel || isModerno;

  scroll.classList.toggle('carousel', useCarrossel);
  scroll.innerHTML = '';

  const _catSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.4"/><rect x="13" y="3" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="13" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.4"/><rect x="13" y="13" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.4"/></svg>`;
  const _allSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.4"/><path d="M8 12h8M12 8v8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;

  // Fallback inteligente: quando a categoria não tem emoji/imagem configurada,
  // tenta adivinhar um emoji pelo nome em vez de mostrar o ícone genérico de
  // quadradinhos (bem feio). Só usa o quadradinho se nada bater.
  const _emojiPorNome = (nome) => {
    const n = (nome || '').toLowerCase();
    const mapa = [
      [/pizza/, '🍕'], [/a[çc]a[íi]/, '🍧'], [/hamb[uú]rguer|burger|lanche/, '🍔'],
      [/bebida|refri|suco|drink/, '🥤'], [/sobremesa|doce|sorvete/, '🍰'],
      [/salada|natural|saud[aá]vel/, '🥗'], [/massa|macarr[ãa]o|lasanha/, '🍝'],
      [/sushi|japon[eê]s|temaki/, '🍣'], [/carne|churrasco|espeto|grelhado/, '🥩'],
      [/frango/, '🍗'], [/pastel|salgado/, '🥟'], [/caf[eé]|padaria|p[ãa]o/, '☕'],
      [/pipoca/, '🍿'], [/vinho|cerveja|bebida.?alco[oó]lica/, '🍷'],
      [/porç[ãa]o|petisco|entrada/, '🍟'], [/marmita|prato.?feito/, '🍱'],
    ];
    const achou = mapa.find(([re]) => re.test(n));
    return achou ? achou[1] : null;
  };

  if (useCarrossel) {
    const all = document.createElement('button');
    all.className = 'cat-btn on';
    all.dataset.key = '';
    all.onclick = () => filterCat(all, '');
    all.innerHTML = `<div class="cat-btn-icon">${_allSvg}</div>Tudo`;
    scroll.appendChild(all);
    allCats.forEach(c => {
      const b = document.createElement('button');
      b.className = 'cat-btn';
      b.dataset.key = c.name;
      b.onclick = () => filterCat(b, c.name);
      const emojiFallback = isModerno ? _emojiPorNome(c.label || c.name) : null;
      const iconHtml = c.image_url
        ? `<img src="${c.image_url}" alt="${c.label||c.name}" loading="lazy" decoding="async">`
        : (c.emoji
            ? `<span style="font-size:16px;line-height:1">${c.emoji}</span>`
            : (emojiFallback
                ? `<span style="font-size:20px;line-height:1">${emojiFallback}</span>`
                : _catSvg));
      b.innerHTML = `<div class="cat-btn-icon">${iconHtml}</div>${c.label || c.name}`;
      scroll.appendChild(b);
    });
  } else {
    const all = document.createElement('button');
    all.className = 'cat-btn on';
    all.dataset.key = '';
    all.onclick = () => filterCat(all, '');
    all.textContent = 'Tudo';
    scroll.appendChild(all);
    allCats.forEach(c => {
      const b = document.createElement('button');
      b.className = 'cat-btn';
      b.dataset.key = c.name;
      b.onclick = () => filterCat(b, c.name);
      if (c.image_url) {
        b.innerHTML = `<span class="cat-btn-pill-icon"><img src="${c.image_url}" alt="" loading="lazy" decoding="async"></span>${c.label || c.name}`;
      } else {
        b.textContent = (c.emoji ? c.emoji + ' ' : '') + (c.label || c.name);
      }
      scroll.appendChild(b);
    });
  }
}

function filterCat(el, key) {
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  activeCat = key;
  _filterPreparo = '';
  renderPreparoFilterSection();
  renderMenu();
}

function verMaisCat(key) {
  const btn = document.querySelector('.cats-scroll .cat-btn[data-key="' + CSS.escape(key) + '"]');
  if (btn) {
    filterCat(btn, key);
    btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
  const bar = document.querySelector('.sticky-bar');
  if (bar) bar.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Vitrine "Compre por categoria" — cards grandes com foto ──
// Só aparece no visual do açougue (CSS controla isso), reaproveita as
// mesmas categorias e o mesmo filtro dos chips de sempre.
function buildCategoriaShowcase() {
  const wrap = document.getElementById('cats-showcase');
  if (!wrap) return;
  const cats = (allCats || []).filter(c => c.type !== 'checklist' && c.image_url);
  if (!cats.length || _segmento !== 'acougue') { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `
    <div class="cats-showcase-title">Compre por categoria</div>
    <div class="cats-showcase-scroll">
      ${cats.map(c => `
        <div class="cats-showcase-card" onclick="verMaisCat('${c.name.replace(/'/g,"\\'")}')">
          <img src="${c.image_url}" alt="${c.label || c.name}" loading="lazy" decoding="async">
          <div class="cats-showcase-name">${c.label || c.name}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function onSearch(val) {
  searchQ = val.trim().toLowerCase();
  renderMenu();
}

// ══════════════════════════════════════════
//  SEÇÃO "NÃO SABE QUAL CARNE?" — Açougue
// ══════════════════════════════════════════
function _getPreparoFilterNome(id) {
  const map = {
    grelha: 'Grelha', espeto: 'Espeto', frigideira: 'Frigideira',
    airfryer: 'Airfryer', churrasco: 'Churrasco', forno: 'Forno',
    panela: 'Panela', ensopado: 'Ensopado', grelhado: 'Grelhado',
    defumado: 'Defumado', dia_a_dia: 'Dia a dia',
  };
  return map[id] || (id.charAt(0).toUpperCase() + id.slice(1));
}

// Coleta todos os preparos disponíveis nos itens do cardápio: id -> nome
function _collectAllPreparos() {
  const allPreparos = new Map();
  allItems.forEach(i => {
    const cgs = i.custom_groups || [];
    const grp = cgs.find(g => g.tipo === 'preparos');
    if (grp?.opcoes) {
      grp.opcoes.forEach(o => {
        const id = (o.id || o.nome || o).toLowerCase().replace(/\s+/g,'_');
        if (!allPreparos.has(id)) allPreparos.set(id, o.nome || _getPreparoFilterNome(id));
      });
    }
  });
  return allPreparos;
}

// Ícone (ou vídeo) de um preparo, com cache-busting. Usado tanto no card do
// modal "Não sabe qual carne escolher?" quanto no banner de filtro ativo.
// Se o admin subiu vídeo pra esse preparo (_preparoVideoTags, definido em
// cardapio-acougue.js), mostra o vídeo em loop mudo em vez da imagem —
// nesse caso o CSS não força mais pra branco (ver regras ".preparo-filter-
// card-icon video" / ".preparo-filter-active-banner-icon video" no index.html).
function _preparoCardIconHtml(id, nome) {
  const _prepV = (typeof _iconesVer !== 'undefined' && _iconesVer) ? ('?v=' + _iconesVer) : '';
  if (typeof _preparoVideoTags !== 'undefined' && _preparoVideoTags.has(id)) {
    return `<video src="${_IMG_TAGS}/${id}.mp4${_prepV}" autoplay muted loop playsinline disablepictureinpicture aria-label="${nome}" data-preparo-id="${id}"></video>`;
  }
  const _isFoto = typeof _preparoPhotoTags !== 'undefined' && _preparoPhotoTags.has(id);
  return _preparoImgMap[id]
    ? `<img class="${_isFoto ? 'preparo-foto' : ''}" data-preparo-id="${id}" src="${_preparoImgMap[id]}${_prepV}" alt="${nome}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${_preparoImgMap[id]}'">`
    : `<svg width="28" height="28" viewBox="0 0 32 32" fill="none"><path d="M10 22c-2-2-3-5-1.5-8s5-4.5 8-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M22 10c2 1 3 4 1.5 7S19 21 16 20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="16" cy="16" r="3" stroke="currentColor" stroke-width="1.4"/></svg>`;
}

// Seção do início agora é só o robozinho com a placa — toque abre o modal
// com os ícones de preparo (openPreparoIconsModal).
function renderPreparoFilterSection() {
  const el = document.getElementById('preparo-filter-section');
  if (!el) return;
  if (_segmento !== 'acougue') { el.style.display = 'none'; return; }
  if (!_mostrarIndicacaoPreparo) { el.style.display = 'none'; return; }

  const allPreparos = _collectAllPreparos();
  if (allPreparos.size === 0) { el.style.display = 'none'; return; }

  el.style.display = '';
  el.innerHTML = `
    <div class="preparo-robot-wrap" onclick="openPreparoIconsModal()">
      <div class="preparo-robot-scene">
        <div class="preparo-robot">
          <div class="preparo-robot-antenna"></div>
          <div class="preparo-robot-head">
            <div class="preparo-robot-eye"></div>
            <div class="preparo-robot-eye"></div>
          </div>
          <div class="preparo-robot-body">
            <div class="preparo-robot-arm preparo-robot-arm-l"></div>
            <div class="preparo-robot-arm preparo-robot-arm-r"></div>
          </div>
        </div>
        <div class="preparo-robot-sign">
          <div class="preparo-robot-sign-pole"></div>
          <div class="preparo-robot-sign-board">Indicação</div>
        </div>
      </div>
      <div class="preparo-robot-caption">Não sabe qual carne escolher? Toque aqui</div>
    </div>
  `;
}

// Modal com os ícones de preparo (o que antes ficava direto no início).
function openPreparoIconsModal() {
  document.getElementById('preparo-icons-overlay')?.remove();
  const allPreparos = _collectAllPreparos();
  if (!allPreparos.size) return;

  let cards = '';
  let _pfIdx = 0;
  allPreparos.forEach((nome, id) => {
    const isOn = _filterPreparo === id;
    cards += `<div class="preparo-filter-card${isOn ? ' on' : ''}" style="--pf-i:${_pfIdx++}" onclick="setFilterPreparo('${id}');closePreparoIconsModal();">
      <div class="preparo-filter-card-icon">${_preparoCardIconHtml(id, nome)}</div>
      <div class="preparo-filter-card-label">${nome}</div>
    </div>`;
  });
  if (_filterPreparo) {
    cards += `<div class="preparo-filter-clear" style="align-self:center;--pf-i:${_pfIdx++}" onclick="setFilterPreparo('');closePreparoIconsModal();" title="Limpar filtro">
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>
    </div>`;
  }

  const overlay = document.createElement('div');
  overlay.id = 'preparo-icons-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:8500;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(3px)';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--s1);border-radius:20px 20px 0 0;width:100%;max-width:540px;max-height:82vh;display:flex;flex-direction:column;overflow:hidden">
    <div style="padding:12px 20px 0;flex-shrink:0">
      <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto"></div>
    </div>
    <div class="preparo-modal-header">
      <div class="preparo-modal-title-row">
        <div class="preparo-modal-badge">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 3c-3 3.5-4.5 6-4.5 8.5a4.5 4.5 0 1 0 9 0c0-1-.3-2-1-3-.2 1.2-.8 2-1.5 2.2.4-2-.2-4-2-5.7z" fill="#fff"/></svg>
        </div>
        <div>
          <div class="preparo-modal-title">Qual é o preparo de hoje?</div>
          <div class="preparo-modal-sub">Toque numa opção e a gente indica as melhores carnes pra ela.</div>
        </div>
      </div>
    </div>
    <div style="overflow-y:auto;flex:1;padding:14px 20px 6px;display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px;justify-items:center">
      ${cards}
    </div>
    <div style="padding:14px 20px;flex-shrink:0;border-top:1px solid var(--border)">
      <button onclick="closePreparoIconsModal()" style="width:100%;padding:12px;background:var(--s2);border:1px solid var(--border);border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;color:var(--text);font-family:inherit">Fechar</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);
  // iOS Safari não dá autoplay em <video> injetado via innerHTML sem isso —
  // era por isso que nenhum vídeo tocava nesse modal no iPhone.
  fixIosVideoAutoplay(overlay);
}

function closePreparoIconsModal() {
  document.getElementById('preparo-icons-overlay')?.remove();
}

function setFilterPreparo(id) {
  _filterPreparo = (_filterPreparo === id) ? '' : id;
  renderPreparoFilterSection();
  renderMenu();
  // Rola suavemente até os resultados quando ativa o filtro
  if (_filterPreparo) {
    setTimeout(() => {
      const banner = document.getElementById('preparo-active-banner');
      if (banner) banner.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }
}

// ══════════════════════════════════════════
//  RENDER MENU
// ══════════════════════════════════════════
function getFiltered() {
  return allItems.filter(i => {
    if (activeCat && i.cat_key !== activeCat && i.cat !== activeCat) return false;
    if (searchQ && !i.name.toLowerCase().includes(searchQ) && !(i.description||'').toLowerCase().includes(searchQ)) return false;
    if (_filterPreparo) {
      const cgs = i.custom_groups || [];
      const preparosGrp = cgs.find(g => g.tipo === 'preparos');
      if (!preparosGrp) return false;
      const opcoes = (preparosGrp.opcoes || []).map(o => (o.id || o.nome || o).toLowerCase());
      if (!opcoes.includes(_filterPreparo.toLowerCase())) return false;
    }
    return true;
  });
}

function renderMenu() {
  const filtered = getFiltered();

  // Separa categorias checklist das normais
  const checklistCats = allCats.filter(c => c.type === 'checklist');
  const checklistKeys = new Set(checklistCats.map(c => c.name));

  const normalItems = filtered.filter(i => !checklistKeys.has(i.cat_key) && !checklistKeys.has(i.cat));

  if (!normalItems.length && !checklistCats.length) {
    document.getElementById('menu-wrap').innerHTML =
      '<div class="empty-state"><div class="empty-state-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="14" cy="14" r="8" stroke="currentColor" stroke-width="1.8"/><path d="M20 20l6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></div><div class="empty-state-text">' + (_filterPreparo ? `Nenhuma carne cadastrada para preparo "${_getPreparoFilterNome(_filterPreparo)}".` : 'Nenhum item encontrado.') + '</div></div>';
    return;
  }

  let html = '<div>';

  // ── Seção Destaques — açougue: acima das indicações; restaurante: posição normal ──
  // Um item entra em Destaques se: foi marcado individualmente (i.destaque)
  // OU pertence a uma categoria marcada inteira como destaque (cat.promo).
  const _catsPromo = new Set(allCats.filter(c => c.promo).map(c => c.name));
  const _ehDestaque = (i) => i.destaque || _catsPromo.has(i.cat_key) || _catsPromo.has(i.cat);
  if (_segmento === 'acougue' && !searchQ && !activeCat && !_filterPreparo) {
    const destItems = normalItems.filter(_ehDestaque);
    if (destItems.length) {
      html += `<div class="destaques-wrap"><div class="section-label">Mais Pedidos</div>`;
      html += `<div class="destaques-scroll">`;
      destItems.forEach(i => {
        const esg = i.status === 'esgotado';
        html += `
        <div class="dest-card" ${esg?'':'onclick="openItemModal('+i.id+')"'}>
          <div class="dest-img${i.image_url ? ' has-photo' : ''}">
            ${i.image_url ? `<img src="${i.image_url}" alt="${i.name}" loading="lazy" decoding="async">` : `<span>${''}</span>`}
            ${i.hide_price ? '' : `<span class="dest-promo-badge">${i.price_old?'OFERTA':'PROMO'}</span>`}
          </div>
          <div class="dest-body">
            <div class="dest-name">${i.name}</div>
            <div class="dest-prices">
              ${i.hide_price ? `<span class="dest-price" style="color:var(--muted)">Ver opções</span>` : `
              ${i.price_old?`<span class="dest-price-old">R$ ${fmt(i.price_old)}</span>`:''}
              <span class="dest-price">R$ ${fmt(i.price)}</span>`}
            </div>
          </div>
        </div>`;
      });
      html += `</div></div>`;
    }
  }

  // ── Banner de filtro de preparo ativo ──
  if (_filterPreparo) {
    const nomePrep = _getPreparoFilterNome(_filterPreparo);
    const iconPrep = _preparoImgMap[_filterPreparo];
    const iconHtml = iconPrep
      ? `<div class="preparo-filter-active-banner-icon">${_preparoCardIconHtml(_filterPreparo, nomePrep)}</div>`
      : '';
    const totalFiltrado = normalItems.length;
    html += `<div class="preparo-filter-active-banner" id="preparo-active-banner">
      <div class="preparo-filter-active-banner-left">
        ${iconHtml}
        <span>Carnes para <strong>${nomePrep}</strong></span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="preparo-filter-active-count">${totalFiltrado} item${totalFiltrado !== 1 ? 's' : ''}</span>
        <div class="preparo-filter-clear-btn" onclick="setFilterPreparo('')">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          Limpar
        </div>
      </div>
    </div>`;
  }

  if (searchQ || activeCat) {
    // Em busca/filtro, mostra só cards normais
    if (normalItems.length) {
      const gridClass = (_segmento === 'acougue' || _catsCarrossel) ? 'item-grid carousel' : 'item-grid';
      html += `<div class="${gridClass}">${normalItems.map(itemCard).join('')}</div>`;
    }
    // Se o filtro for de uma categoria checklist, mostra ela expandida —
    // no açougue, em cards (igual a visão geral já fazia); nos outros
    // segmentos, mantém a lista com checkbox de sempre. Antes, esse "Ver
    // mais" sempre caía na lista com checkbox pra qualquer segmento — só a
    // tela inicial tinha o tratamento certo pro açougue.
    const filteredChecklistCat = checklistCats.find(c => c.name === activeCat || c.label === activeCat);
    if (filteredChecklistCat) {
      const catItems = allItems.filter(i => (i.cat_key === filteredChecklistCat.name || i.cat === filteredChecklistCat.label) && i.status !== 'pausado');
      if (_segmento === 'acougue') {
        if (catItems.length) {
          const gridClassCl = _catsCarrossel ? 'item-grid carousel' : 'item-grid';
          html += `<div class="section"><div class="section-label-row"><div class="section-label">${filteredChecklistCat.label || filteredChecklistCat.name}</div></div><div class="${gridClassCl}">${catItems.map(itemCard).join('')}</div></div>`;
        }
      } else {
        html += renderChecklistSection(filteredChecklistCat, catItems, true);
      }
    }
    html += '</div>';
    const _menuWrapEl2 = document.getElementById('menu-wrap');
    _menuWrapEl2.innerHTML = html;
    fixIosVideoAutoplay(_menuWrapEl2);
    return;
  }

  // Renderiza grupos normais
  // ── Destaques para restaurante (posição original, entre filtro e grupos) ──
  if (_segmento !== 'acougue' && !searchQ && !activeCat) {
    const destItems = normalItems.filter(_ehDestaque);
    if (destItems.length) {
      html += `<div class="destaques-wrap"><div class="section-label">Mais Pedidos</div><div class="destaques-scroll">`;
      destItems.forEach(i => {
        const esg = i.status === 'esgotado';
        const destMedia = i.video_url
          ? `<video src="${i.video_url}" autoplay muted loop playsinline preload="metadata" onerror="itemCardVideoFallback(this,'${(i.image_url||'').replace(/'/g,'%27')}','${(i.name||'').replace(/'/g,'%27')}')"></video>`
          : (i.image_url ? `<img src="${i.image_url}" alt="${i.name}" loading="lazy" decoding="async">` : '');
        html += `<div class="dest-card" ${esg?'':'onclick="openItemModal('+i.id+')"'}><div class="dest-img${(i.image_url||i.video_url)?' has-photo':''}">${destMedia}${i.hide_price?'':`<span class="dest-promo-badge">${i.price_old?'OFERTA':'PROMO'}</span>`}</div><div class="dest-body"><div class="dest-name">${i.name}</div><div class="dest-prices">${i.hide_price?`<span class="dest-price" style="color:var(--muted)">Ver opções</span>`:`${i.price_old?`<span class="dest-price-old">R$ ${fmt(i.price_old)}</span>`:''}<span class="dest-price">R$ ${fmt(i.price)}</span>`}</div></div></div>`;
      });
      html += `</div></div>`;
    }
  }
  // Agrupa itens por categoria, respeitando a ordem de allCats (sort_order do banco)
  const grouped = new Map();
  normalItems.forEach(i => {
    const key = i.cat_key || i.cat || '__outros';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(i);
  });

  // Itera TODAS as categorias na ordem do sort_order, respeitando posicao de checklist
  allCats.forEach(cat => {
    const isChecklist = cat.type === 'checklist';
    if (isChecklist) {
      const catItems = allItems.filter(i => (i.cat_key === cat.name || i.cat === cat.label) && i.status !== 'pausado');
      if (!catItems.length) return;
      if (_segmento === 'acougue') {
        const label = cat.label || cat.name;
        const seeMore = catItems.length > 4 ? `<span class="section-see-more" onclick="verMaisCat('${String(cat.name).replace(/'/g,"\\'")}')">Ver mais<svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : '';
        html += `<div class="section" data-cat="${cat.name}"><div class="section-label-row"><div class="section-label">${label}</div>${seeMore}</div><div class="item-grid carousel">${catItems.map(itemCard).join('')}</div></div>`;
      } else {
        html += renderChecklistSection(cat, catItems, false);
      }
    } else {
      const its = grouped.get(cat.name) || [];
      if (!its.length) return;
      const label = cat.label || cat.name;
      const gridClass = (_segmento === 'acougue' || _catsCarrossel) ? 'item-grid carousel' : 'item-grid';
      const seeMore = its.length > 4 ? `<span class="section-see-more" onclick="verMaisCat('${String(cat.name).replace(/'/g,"\\'")}')">Ver mais<svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : '';
      html += `<div class="section" data-cat="${cat.name}"><div class="section-label-row"><div class="section-label">${label}</div>${seeMore}</div><div class="${gridClass}">${its.map(itemCard).join('')}</div></div>`;
    }
  });

  // Itens sem categoria conhecida
  const unknownItems = grouped.get('__outros') || [];
  if (unknownItems.length) {
    const gridClass = (_segmento === 'acougue' || _catsCarrossel) ? 'item-grid carousel' : 'item-grid';
    html += `<div class="section" data-cat="__outros"><div class="section-label">Outros</div><div class="${gridClass}">${unknownItems.map(itemCard).join('')}</div></div>`;
  }

  html += '</div>';
  const _menuWrapEl = document.getElementById('menu-wrap');
  _menuWrapEl.innerHTML = html;
  fixIosVideoAutoplay(_menuWrapEl);
  initScrollSpy();
}

function renderChecklistSection(cat, catItems, startOpen) {
  const id = 'cl-' + cat.name;
  const totalItens = catItems.length;
  return `
  <div class="checklist-section">
    <div class="checklist-header" onclick="toggleChecklistSection('${id}')">
      <div class="checklist-header-left">
        <div class="checklist-header-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="color:var(--accent)">
            <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
        </div>
        <div>
          <div class="checklist-title">${cat.label || cat.name}</div>
          <div class="checklist-subtitle">${totalItens} opção${totalItens !== 1 ? 'ões' : ''} disponível${totalItens !== 1 ? 'is' : ''}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="checklist-badge" id="${id}-badge" style="display:none">0</span>
        <svg class="checklist-arrow ${startOpen ? 'open' : ''}" id="${id}-arrow" width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
      </div>
    </div>
    <div class="checklist-body ${startOpen ? 'open' : ''}" id="${id}-body">
      ${catItems.map(item => {
        const priceStr = item.price > 0 ? 'R$ ' + fmt(item.price) : 'Grátis';
        return `
        <div class="checklist-item" id="${id}-item-${item.id}">
          <div class="checklist-check" id="${id}-check-${item.id}" onclick="toggleChecklistItem('${id}',${item.id},${item.price})"></div>
          <div class="checklist-item-name">${item.name}</div>
          <div class="checklist-item-price">${priceStr}</div>
          <div class="checklist-qty" id="${id}-qty-${item.id}">
            <div class="checklist-qty-btn" onclick="checklistQty('${id}',${item.id},-1,${item.price})">−</div>
            <div class="checklist-qty-num" id="${id}-qnum-${item.id}">1</div>
            <div class="checklist-qty-btn" onclick="checklistQty('${id}',${item.id},1,${item.price})">+</div>
          </div>
        </div>`;
      }).join('')}
      <button class="checklist-add-btn" id="${id}-add-btn" onclick="addChecklistToCart('${id}')" disabled>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        Adicionar selecionados ao pedido
      </button>
    </div>
  </div>`;
}

// Estado dos checklists
const _clState = {}; // { [clId]: { [itemId]: qty } }

function toggleChecklistSection(id) {
  const body  = document.getElementById(id + '-body');
  const arrow = document.getElementById(id + '-arrow');
  if (!body) return;
  body.classList.toggle('open');
  arrow.classList.toggle('open');
}

function toggleChecklistItem(clId, itemId, price) {
  if (!_clState[clId]) _clState[clId] = {};
  const check = document.getElementById(`${clId}-check-${itemId}`);
  const qty   = document.getElementById(`${clId}-qty-${itemId}`);
  const row   = document.getElementById(`${clId}-item-${itemId}`);

  if (_clState[clId][itemId]) {
    // Desmarca
    delete _clState[clId][itemId];
    check.classList.remove('on');
    check.innerHTML = '';
    if (qty) qty.classList.remove('show');
    if (row) row.classList.remove('selected');
  } else {
    // Marca com qty=1
    _clState[clId][itemId] = 1;
    check.classList.add('on');
    check.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const qnum = document.getElementById(`${clId}-qnum-${itemId}`);
    if (qnum) qnum.textContent = '1';
    if (qty) qty.classList.add('show');
    if (row) row.classList.add('selected');
  }
  _updateChecklistBadge(clId);
}

function checklistQty(clId, itemId, delta, price) {
  if (!_clState[clId] || !_clState[clId][itemId]) return;
  const newQty = (_clState[clId][itemId] || 1) + delta;
  if (newQty <= 0) {
    toggleChecklistItem(clId, itemId, price);
    return;
  }
  _clState[clId][itemId] = newQty;
  const qnum = document.getElementById(`${clId}-qnum-${itemId}`);
  if (qnum) qnum.textContent = newQty;
  _updateChecklistBadge(clId);
}

function _updateChecklistBadge(clId) {
  const state   = _clState[clId] || {};
  const total   = Object.values(state).reduce((s, q) => s + q, 0);
  const badge   = document.getElementById(clId + '-badge');
  const addBtn  = document.getElementById(clId + '-add-btn');
  if (badge) { badge.textContent = total; badge.style.display = total > 0 ? '' : 'none'; }
  if (addBtn) addBtn.disabled = total === 0;
}

function addChecklistToCart(clId) {
  const _pedidoAgendadoSeguro = (typeof _pedidoAgendadoPara !== 'undefined') ? _pedidoAgendadoPara : null;
  if (!_lojaAberta && !_pedidoAgendadoSeguro) { toast('err','Loja fechada'); return; }
  const state = _clState[clId] || {};
  if (!Object.keys(state).length) return;

  Object.entries(state).forEach(([itemId, qty]) => {
    const item = allItems.find(i => i.id === Number(itemId));
    if (!item) return;
    const existing = cart.find(c => c.id === item.id && !c.obs);
    if (existing) { existing.qty += qty; }
    else { cart.push({ ...item, qty, obs: '' }); }
  });

  // Limpa estado e visual
  _clState[clId] = {};
  const body = document.getElementById(clId + '-body');
  if (body) {
    body.querySelectorAll('.checklist-check.on').forEach(el => {
      el.classList.remove('on'); el.innerHTML = '';
    });
    body.querySelectorAll('.checklist-qty.show').forEach(el => el.classList.remove('show'));
    body.querySelectorAll('.checklist-item.selected').forEach(el => el.classList.remove('selected'));
    body.querySelectorAll('.checklist-qty-num').forEach(el => el.textContent = '1');
  }
  _updateChecklistBadge(clId);

  updateCartFloat();
  toast('ok', 'Itens adicionados ao carrinho!');
}

// ══════════════════════════════════════════
//  FAVORITOS — exige conta (salvo no servidor, por cliente)
// ══════════════════════════════════════════
let _favoritosCache = [];   // ids favoritados do cliente logado, carregado do servidor
let _favoritosCarregados = false;
let _pendingFavoritoId = null; // item que o cliente tentou favoritar antes de logar

function isFavorito(id) {
  return _favoritosCache.includes(id);
}

// Carrega os favoritos do cliente logado a partir do servidor. Chamado ao
// abrir o cardápio (se já tinha sessão salva) e logo após login/registro.
async function loadFavoritos() {
  if (!_customer?.id) { _favoritosCache = []; _favoritosCarregados = false; return; }
  try {
    const res = await fetch(`/api/favoritos?customer_id=${_customer.id}`, {
      headers: { 'x-tenant-id': _tenantId, 'Authorization': 'Bearer ' + (_customer.token||'') }
    });
    if (res.ok) _favoritosCache = await res.json();
  } catch(e) {}
  _favoritosCarregados = true;
  _atualizarCoracoesNaTela();
  if (document.getElementById('favoritos-overlay')?.classList.contains('on')) renderFavoritosPage();
  // Se o cliente tentou favoritar antes de logar, aplica agora
  if (_pendingFavoritoId != null) {
    const id = _pendingFavoritoId;
    _pendingFavoritoId = null;
    if (!isFavorito(id)) toggleFavorito(id);
  }
}

function _atualizarCoracoesNaTela() {
  document.querySelectorAll('.item-fav-btn').forEach(btn => {
    const m = btn.getAttribute('onclick')?.match(/toggleFavorito\((\d+)\)/);
    if (!m) return;
    const on = isFavorito(parseInt(m[1]));
    btn.classList.toggle('on', on);
    btn.querySelector('svg')?.setAttribute('fill', on ? 'currentColor' : 'none');
  });
}

async function toggleFavorito(id) {
  // Sem conta: pede pra criar/entrar antes de favoritar, e guarda a intenção
  // pra aplicar automaticamente assim que o login concluir.
  if (!_customer?.id) {
    _pendingFavoritoId = id;
    if (typeof toast === 'function') toast('info', 'Crie uma conta para favoritar');
    if (typeof openAuth === 'function') openAuth('register');
    return;
  }
  const jaTem = isFavorito(id);
  // Atualização otimista da tela
  _favoritosCache = jaTem ? _favoritosCache.filter(x => x !== id) : [..._favoritosCache, id];
  _atualizarCoracoesNaTela();
  try {
    const res = await fetch('/api/favoritos/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': _tenantId, 'Authorization': 'Bearer ' + (_customer.token||'') },
      body: JSON.stringify({ customer_id: _customer.id, item_id: id })
    });
    if (!res.ok) throw new Error('falhou');
    if (typeof toast === 'function') toast(jaTem ? 'info' : 'ok', jaTem ? 'Removido dos favoritos' : 'Adicionado aos favoritos!');
  } catch(e) {
    // Reverte a atualização otimista se a chamada falhou
    _favoritosCache = jaTem ? [..._favoritosCache, id] : _favoritosCache.filter(x => x !== id);
    _atualizarCoracoesNaTela();
    if (typeof toast === 'function') toast('err', 'Não foi possível salvar o favorito. Tente novamente.');
    return;
  }
  // Se a tela de favoritos estiver aberta, atualiza a lista na hora
  if (document.getElementById('favoritos-overlay')?.classList.contains('on')) renderFavoritosPage();
}

function renderFavoritosPage() {
  const wrap = document.getElementById('favoritos-list');
  if (!wrap) return;
  if (!_customer?.id) {
    wrap.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none"><path d="M12 20.5s-7.5-4.6-10-9.3C.5 7.8 2.3 4 6 4c2.1 0 3.7 1.2 6 3.5C14.3 5.2 15.9 4 18 4c3.7 0 5.5 3.8 4 7.2-2.5 4.7-10 9.3-10 9.3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
      <div class="empty-state-text">Crie uma conta ou entre na sua pra favoritar itens e ver sua lista aqui.</div>
      <button onclick="closeFavoritos();openAuth('register')" style="margin-top:14px;padding:11px 22px;background:var(--accent);color:#fff;border:none;border-radius:10px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit">Criar conta / Entrar</button>
    </div>`;
    return;
  }
  const favItems = (allItems || []).filter(i => _favoritosCache.includes(i.id));
  if (!favItems.length) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none"><path d="M12 20.5s-7.5-4.6-10-9.3C.5 7.8 2.3 4 6 4c2.1 0 3.7 1.2 6 3.5C14.3 5.2 15.9 4 18 4c3.7 0 5.5 3.8 4 7.2-2.5 4.7-10 9.3-10 9.3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></div><div class="empty-state-text">Nenhum favorito ainda.<br>Toque no coração de um item pra guardar aqui.</div></div>';
    return;
  }
  const gridClass = (_segmento === 'acougue' || _catsCarrossel) ? 'item-grid carousel' : 'item-grid';
  wrap.innerHTML = `<div class="${gridClass}">${favItems.map(itemCard).join('')}</div>`;
}

function itemCard(i) {
  const esg  = i.status === 'esgotado';
  const click= esg ? '' : `onclick="openItemModal(${i.id})"`;
  const hasImg = i.image_url || i.emoji;

  // Porção de referência calculada
  const cgs = i.custom_groups || [];
  const porcaoGrp = cgs.find(g => g.tipo === 'porcao_ref');
  const porcaoRef = porcaoGrp?.gramas || 0;
  // hide_price: preço "de vitrine" é 0/irrelevante — quem cobra de verdade são os
  // adicionais (ex: categoria "Refrigerante" com as marcas precificadas dentro).
  // Mostrar R$ 0,00 aqui confundiria o cliente achando que é grátis.
  const hidePrice = !!i.hide_price;
  const porcaoBadge = (!hidePrice && porcaoRef > 0 && i.price > 0)
    ? `<div class="item-porcao-ref">${porcaoRef}g · R$ ${fmt(i.price * porcaoRef / 1000)}</div>`
    : '';
  const hasPizzaSizes = typeof _pizzaHasSizePricing === 'function' && _pizzaHasSizePricing(i);
  const isKg = i.item_type === 'kg';
  const priceText = hidePrice
    ? 'Ver opções'
    : (hasPizzaSizes
      ? `A partir de R$ ${fmt(_pizzaMinPrice(i))}`
      : `R$ ${fmt(i.price)}${isKg ? '<span style="font-size:10px;font-weight:400;color:var(--muted)">/kg</span>' : ''}`);

  return `
  <div class="item-card${isKg && _segmento==='acougue' ? ' item-card-kg' : ''}" ${click} style="${esg?'opacity:.55;cursor:not-allowed':''}">
    <div class="item-body">
      <div class="item-name">${i.name}</div>
      ${i.description ? `<div class="item-desc">${i.description}</div>` : ''}
      <div class="item-foot">
        ${!hidePrice && i.price_old ? `<span class="item-price-old">R$ ${fmt(i.price_old)}</span>` : ''}
        <span class="item-price${!hidePrice&&(i.promo||i.price_old)?' item-price-promo':''}"${hidePrice?' style="color:var(--muted);font-weight:600"':''}>${priceText}</span>
        <button class="item-add-btn" ${esg?'disabled':''} onclick="event.stopPropagation();openItemModal(${i.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></button>
      </div>
      ${porcaoBadge}
    </div>
    <div class="item-img${(i.image_url||i.video_url) ? ' has-photo' : ''}">
      ${i.video_url
        ? `<video src="${i.video_url}" autoplay muted loop playsinline preload="metadata" onerror="itemCardVideoFallback(this,'${(i.image_url||'').replace(/'/g,'%27')}','${(i.name||'').replace(/'/g,'%27')}')"></video>`
        : (i.image_url ? `<img src="${i.image_url}" alt="${i.name}" loading="lazy" decoding="async">` : `<span>${''}</span>`)}
      ${i.video_url ? `<span class="item-video-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></span>` : ''}
      ${i.promo||i.price_old ? '<span class="item-promo-badge">PROMO</span>' : ''}
      ${esg ? '<div class="item-esgotado-overlay">Esgotado</div>' : ''}
      <button class="item-fav-btn${isFavorito(i.id)?' on':''}" onclick="event.stopPropagation();toggleFavorito(${i.id})" aria-label="Favoritar">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="${isFavorito(i.id)?'currentColor':'none'}"><path d="M12 20.5s-7.5-4.6-10-9.3C.5 7.8 2.3 4 6 4c2.1 0 3.7 1.2 6 3.5C14.3 5.2 15.9 4 18 4c3.7 0 5.5 3.8 4 7.2-2.5 4.7-10 9.3-10 9.3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
      </button>
    </div>
  </div>`;
}

// Fallback quando o vídeo do card falha ao carregar — volta pra imagem (ou nada)
function itemCardVideoFallback(videoEl, imgUrl, name) {
  const unesc = (s) => String(s || '').replace(/%27/g, "'");
  if (imgUrl) {
    const img = document.createElement('img');
    img.src = unesc(imgUrl); img.alt = unesc(name);
    img.loading = 'lazy'; img.decoding = 'async';
    videoEl.replaceWith(img);
  } else {
    videoEl.remove();
  }
}

// ── cardapio-modal.js ──────────────────────────────────────────
// ══════════════════════════════════════════
//  MODAL — Modal do item, animações, pizza meio a meio
//  Estima Food — Cardápio
// ══════════════════════════════════════════
// ══════════════════════════════════════════
//  MODAL DO ITEM
// ══════════════════════════════════════════
// Fallback quando o vídeo do item falha ao carregar — volta pra imagem (ou ícone padrão)
function imVideoFallback(videoEl, imgUrl, name) {
  const wrap = videoEl.parentElement;
  if (!wrap) return;
  const unesc = (s) => String(s || '').replace(/%27/g, "'");
  if (imgUrl) {
    wrap.innerHTML = `<img src="${unesc(imgUrl)}" alt="${unesc(name)}" style="width:100%;height:100%;object-fit:cover">`;
  } else {
    wrap.innerHTML = `<div style="opacity:.25"><svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="16" stroke="currentColor" stroke-width="1.5" opacity=".3"/><path d="M16 24h16M24 16v16" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".3"/></svg></div>`;
  }
}

let _imItemId = null;
let _imQty    = 1;
let _pizzaSizeKey = null;

function openItemModal(id) {
  const i = allItems.find(x => x.id === id);
  if (!i) return;
  _imItemId = id;
  _imQty    = 1;
  _halfItem = null;
  _halfPickerOpen = false;
  _pizzaSizeKey = null;

  const imgEl = document.getElementById('im-img');
  if (i.video_url) {
    const fallbackImg = (i.image_url || '').replace(/'/g, '%27');
    imgEl.innerHTML = `<video src="${i.video_url}" autoplay muted loop playsinline controls style="width:100%;height:100%;object-fit:cover" onerror="imVideoFallback(this,'${fallbackImg}','${(i.name||'').replace(/'/g,'%27')}')"></video>`;
    fixIosVideoAutoplay(imgEl);
  } else if (i.image_url) {
    imgEl.innerHTML = `<img src="${i.image_url}" alt="${i.name}" style="width:100%;height:100%;object-fit:cover">`;
  } else {
    imgEl.innerHTML = `<div style="opacity:.25"><svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="16" stroke="currentColor" stroke-width="1.5" opacity=".3"/><path d="M16 24h16M24 16v16" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".3"/></svg></div>`;
  }
  document.getElementById('im-name').textContent = i.name;
  document.getElementById('im-desc').textContent = i.description || '';
  const hasPizzaSizesAtOpen = _pizzaHasSizePricing(i);
  const openPrice = hasPizzaSizesAtOpen ? _pizzaMinPrice(i) : (parseFloat(i.price) || 0);
  // hide_price: preço-base é só de vitrine (0 ou irrelevante) — quem cobra de
  // verdade são os adicionais. Mostrar aqui confundiria o cliente.
  if (i.hide_price) {
    document.getElementById('im-price').textContent = 'Escolha as opções abaixo';
  } else {
    document.getElementById('im-price').textContent = (hasPizzaSizesAtOpen ? 'A partir de R$ ' : 'R$ ') + fmt(openPrice) + (i.item_type === 'kg' ? '/kg' : '');
  }
  const old = document.getElementById('im-price-old');
  if (!i.hide_price && i.price_old) { old.textContent = 'R$ ' + fmt(i.price_old); old.style.display = ''; }
  else old.style.display = 'none';

  // Porção de referência no modal
  let porcaoEl = document.getElementById('im-porcao-ref');
  if (!porcaoEl) {
    porcaoEl = document.createElement('div');
    porcaoEl.id = 'im-porcao-ref';
    porcaoEl.className = 'im-porcao-ref';
    document.getElementById('im-price').parentNode.appendChild(porcaoEl);
  }
  const porcaoGrpM = (i.custom_groups || []).find(g => g.tipo === 'porcao_ref');
  const porcaoRefM = porcaoGrpM?.gramas || 0;
  const pesosGrpM  = (i.custom_groups || []).find(g => g.tipo === 'pesos');
  if (!i.hide_price && porcaoRefM > 0 && i.price > 0) {
    porcaoEl.textContent = `${porcaoRefM}g · R$ ${fmt(i.price * porcaoRefM / 1000)}`;
    porcaoEl.style.display = 'inline-flex';
    // Se tem pesos disponíveis, torna clicável para selecionar gramas
    if (pesosGrpM?.valores?.length) {
      porcaoEl.style.cursor = 'pointer';
      porcaoEl.title = 'Toque para escolher a quantidade';
      porcaoEl.onclick = () => _openPorcaoQuickPicker(i, porcaoRefM);
    } else {
      porcaoEl.style.cursor = '';
      porcaoEl.onclick = null;
    }
  } else {
    porcaoEl.style.display = 'none';
    porcaoEl.onclick = null;
  }
  document.getElementById('im-qty').textContent = _imQty;
  document.getElementById('im-obs').value = '';
  {
    const _pedidoAgendadoSeguroInit = (typeof _pedidoAgendadoPara !== 'undefined') ? _pedidoAgendadoPara : null;
    document.getElementById('im-add-btn').disabled = !_lojaAberta && !_pedidoAgendadoSeguroInit;
  }

  // Açougue: oculta botões - 1 + (peso é selecionado pelo seletor de gramas)
  const qtyRow = document.getElementById('im-qty-row');
  if (qtyRow) {
    const isAcougue = document.body.dataset.segmento === 'acougue' || (typeof _segmento !== 'undefined' && _segmento === 'acougue');
    const isKg = i.item_type === 'kg' || (i.custom_groups||[]).some(g => g.tipo === 'pesos' || g.tipo === 'cortes');
    qtyRow.style.display = (isAcougue && isKg) ? 'none' : '';
  }

  // ── Grupos de customização ──
  // Blindado com try/catch: qualquer erro nos dados de um item específico
  // (ex.: grupo de customização com formato inesperado) não pode impedir
  // o modal de abrir — antes, um erro aqui travava a função inteira e o
  // clique parecia "não fazer nada".
  try {
    _imGruposState = {};
    _acougueCortes = {};
    _acougueAtual  = null;
    _pesoConfirmadoPeloUsuario = false;
    renderImGrupos(i);
    // Açougue: pré-seleciona peso somente se NÃO tem cortes (cliente escolhe o corte)
    if (_isAcougueItem(i) && !_isKitItem(i)) {
      const cortesGrp = (i.custom_groups || []).find(g => g.tipo === 'cortes');
      const temCortes  = !!cortesGrp?.opcoes?.length;
      if (!temCortes) {
        // Sem cortes: mostra peso padrão na pill de porção mas não pré-confirma
        const pesosGrp   = (i.custom_groups || []).find(g => g.tipo === 'pesos');
        const pesoPadrao = pesosGrp?.valores?.[0] || 0;
        if (pesoPadrao > 0) _autoSelecionarPorcaoRef('Inteiro', pesoPadrao, false);
      }
      // Com cortes: nada é pré-selecionado — cliente escolhe corte e peso
    }
    // Pré-carrega imagens dos cortes para evitar delay no modal (só kg)
    if (_isAcougueItem(i) && !_isKitItem(i)) {
      const grupos = i.custom_groups || [];
      const cortesGrp = grupos.find(g => g.tipo === 'cortes');
      if (cortesGrp?.opcoes) {
        cortesGrp.opcoes.forEach(o => {
          const n = (o.nome||o.id||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
          let key = 'default';
          if      (n.includes('strogon'))  key = 'strogonoff';
          else if (n.includes('posta'))    key = 'postas';
          else if (n.includes('tirinha'))  key = 'tirinha';
          else if (n.includes('tira'))     key = 'tiras';
          else if (n.includes('moido') && n.includes('2')) key = 'moido2x';
          else if (n.includes('moido') || n.includes('moida')) key = 'moido';
          else if (n.includes('cubo'))     key = 'cubos';
          else if (n.includes('picado'))   key = 'picado';
          else if (n.includes('grelha'))   key = 'grelha';
          else if (n.includes('peca'))     key = 'peca';
          else if (n.includes('fino'))     key = 'bifefino';
          else if (n.includes('grosso'))   key = 'bifegrosso';
          else if (n.includes('bife'))     key = 'bife';
          else if (n.includes('espeto'))   key = 'espeto';
          else if (n.includes('inteiro') || n.includes('inteira')) key = 'inteiro';
          const url = (o.icon || o.image || o.img || o.image_url) || (_corteImgMap[key] || _corteImgMap.default);
          const preload = new Image(); preload.src = url;
        });
      }
    }
    renderImXsell(i);

    // ── Abas "Informações do Produto" (exclusivo açougue) ──
    const imGruposWrap = document.getElementById('im-grupos-wrap');
    const existingTabs = document.getElementById('im-info-tabs-wrap');
    if (existingTabs) existingTabs.remove();

    if (_isAcougueItem(i) && !_isKitItem(i)) {
      const cgs            = i.custom_groups || [];
      const ocasiaoGrp     = cgs.find(g => g.tipo === 'ocasiao');
      const armazenGrp     = cgs.find(g => g.tipo === 'armazenamento');
      const preparosGrp    = cgs.find(g => g.tipo === 'preparos');
      const hasInfoTab = ocasiaoGrp?.opcoes?.length || armazenGrp?.opcoes?.length || preparosGrp?.opcoes?.length;

      if (hasInfoTab) {
        const _chipHtml = (lista, titulo, resolverIcone) => {
          if (!lista?.length) return '';
          const chips = lista.map(o => {
            const nome = o.nome || o.id || '';
            let icon;
            if (o.icon) {
              icon = `<img src="${o.icon}" style="width:32px;height:32px;object-fit:contain;display:block" onerror="this.outerHTML=${JSON.stringify(resolverIcone ? resolverIcone(nome) : '<svg width=\'18\' height=\'18\' viewBox=\'0 0 16 16\' fill=\'none\'><circle cx=\'8\' cy=\'8\' r=\'5\' stroke=\'currentColor\' stroke-width=\'1.4\' opacity=\'.5\'/></svg>')}">`;
            } else if (resolverIcone) {
              icon = resolverIcone(nome);
            } else {
              icon = `<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="1.4" opacity=".5"/></svg>`;
            }
            return `<div style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 12px;background:var(--s2,#1a1a1a);border:1.5px solid var(--border,#2a2a2a);border-radius:12px;min-width:70px;max-width:90px;text-align:center;flex-shrink:0">
              <div style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.04);border-radius:10px">${icon}</div>
              <span style="font-size:11px;font-weight:600;color:var(--text);line-height:1.2">${nome}</span>
            </div>`;
          }).join('');
          return `<div style="margin-bottom:14px">
            <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.4px;text-transform:uppercase;margin-bottom:8px">${titulo}</div>
            <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;-webkit-overflow-scrolling:touch;scrollbar-width:none">${chips}</div>
          </div>`;
        };

        const preparoContent = [
          _chipHtml(ocasiaoGrp?.opcoes,     'Tipo de ocasião'),
          _chipHtml(armazenGrp?.opcoes,     'Armazenamento'),
          _chipHtml(preparosGrp?.opcoes,    'Forma de preparo', typeof _getPreparoIcon === 'function' ? _getPreparoIcon : null),
        ].join('');

        const tabsWrap = document.createElement('div');
        tabsWrap.id = 'im-info-tabs-wrap';
        tabsWrap.style.cssText = 'margin-bottom:16px';
        tabsWrap.innerHTML = `
          <div style="font-size:13px;font-weight:700;margin-bottom:10px">Informações do produto</div>
          <div style="display:flex;gap:6px;margin-bottom:14px" id="im-tab-btns">
            <button onclick="imSwitchTab('detalhes')" id="im-tab-btn-detalhes" style="flex:1;padding:8px 12px;border-radius:10px;border:1.5px solid var(--accent,#f97316);background:var(--accent,#f97316);color:#000;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s">Detalhes</button>
            <button onclick="imSwitchTab('preparo')"  id="im-tab-btn-preparo"  style="flex:1;padding:8px 12px;border-radius:10px;border:1.5px solid var(--border,#2a2a2a);background:transparent;color:var(--muted);font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s">Preparo</button>
          </div>
          <div id="im-tab-panel-detalhes" style="display:block">
            <div style="font-size:13px;color:var(--muted2);line-height:1.6">${i.description || 'Sem descrição adicional.'}</div>
          </div>
          <div id="im-tab-panel-preparo" style="display:none">${preparoContent}</div>
        `;
        imGruposWrap.parentNode.insertBefore(tabsWrap, imGruposWrap);

        // Oculta a descrição duplicada acima (já está na aba Detalhes)
        const descEl = document.getElementById('im-desc');
        if (descEl) descEl.style.display = 'none';
      } else {
        // Sem dados de preparo — mantém descrição normal
        const descEl = document.getElementById('im-desc');
        if (descEl) descEl.style.display = '';
      }
    } else {
      const descEl = document.getElementById('im-desc');
      if (descEl) descEl.style.display = '';
    }

    // ── Ingredientes selecionáveis ──
    const ingrSection = document.getElementById('im-ingr-section');
    const ingrGrid    = document.getElementById('im-ingr-grid');
    const ingrs = Array.isArray(i.ingredients) ? i.ingredients.filter(Boolean) : [];
    if (ingrs.length > 0) {
      ingrGrid.innerHTML = ingrs.map(ingr => `
        <div class="im-ingr-chip" onclick="toggleIngr(this)">
          <div class="chip-dot"></div>
          <span>${ingr}</span>
        </div>`).join('');
      document.getElementById('im-ingr-count').textContent = '0';
      document.getElementById('im-ingr-count').classList.remove('show');
      ingrSection.style.display = '';
      document.getElementById('im-obs').placeholder = 'Observação adicional (opcional)';
    } else {
      ingrSection.style.display = 'none';
      ingrGrid.innerHTML = '';
      document.getElementById('im-obs').placeholder = 'Observação';
    }
  } catch (e) {
    console.error('openItemModal: erro ao montar detalhes do item, abrindo mesmo assim', e);
  }

  document.getElementById('item-modal-bg').classList.add('on');
  const closeFab = document.getElementById('im-close-fab');
  if (closeFab) closeFab.style.display = 'flex';

  // ── Camada de animação (açaí / marmita) ──
  _animFillLevel = 0;
  _initAnimLayer(i);

  // ── Pizza meio a meio ──
  const isPizza = isPizzaItem(i);
  const halfSec = document.getElementById('half-section');
  halfSec.style.display = isPizza ? '' : 'none';
  if (isPizza) {
    renderPizzaSizePicker(i);
    updateHalfUI();
    renderHalfPicker(i);
    // Inicia visual da pizza com a metade esquerda preenchida
    _initPizzaCanvas();
    setTimeout(() => _updatePizzaVisual(), 80);
  } else {
    const sizeWrap = document.getElementById('pizza-size-wrap');
    if (sizeWrap) sizeWrap.style.display = 'none';
  }
  updateImAddBtn();
}

function isPizzaItem(i) {
  // Detecta pizza por: tipo, meio_a_meio flag, ou categoria
  if (i.meio_a_meio || i.tipo === 'pizza' || i.item_type === 'pizza' || i.is_pizza) return true;
  const cat = allCats.find(c => c.name === (i.cat_key || i.cat));
  if (cat && (cat.meio_a_meio || (cat.name||'').toLowerCase().includes('pizza') || (cat.label||'').toLowerCase().includes('pizza'))) return true;
  return false;
}

function _pizzaSizesGroup(item) {
  const groups = item?.custom_groups || [];
  return groups.find(g => g && (g.tipo === 'pizza_sizes' || g.tipo === 'tamanhos_pizza') && Array.isArray(g.tamanhos)) || null;
}

function _pizzaSizeOptions(item) {
  const group = _pizzaSizesGroup(item);
  return (group?.tamanhos || [])
    .map(s => ({
      key: String(s.key || '').toUpperCase(),
      nome: s.nome || s.label || s.key || '',
      preco: parseFloat(s.preco ?? s.price ?? s.valor)
    }))
    .filter(s => s.key && s.preco > 0);
}

function _pizzaHasSizePricing(item) {
  return _pizzaSizeOptions(item).length > 0;
}

function _pizzaMinPrice(item) {
  const prices = _pizzaSizeOptions(item).map(s => s.preco).filter(p => p > 0);
  return prices.length ? Math.min(...prices) : (parseFloat(item?.price) || 0);
}

function _pizzaPriceForSize(item, key) {
  const k = String(key || '').toUpperCase();
  const found = _pizzaSizeOptions(item).find(s => s.key === k);
  return found ? found.preco : (parseFloat(item?.price) || 0);
}

function _pizzaHalfRule(item) {
  const rule = (_pizzaSizesGroup(item)?.regra_meio || _pizzaSizesGroup(item)?.regra || '').toLowerCase();
  return rule === 'media' ? 'media' : 'maior';
}

function _pizzaCurrentBasePrice(item, halfItem) {
  const hasSizes = _pizzaHasSizePricing(item);
  const sizeKey = hasSizes ? (_pizzaSizeKey || _pizzaSizeOptions(item)[0]?.key) : '';
  const base = hasSizes ? _pizzaPriceForSize(item, sizeKey) : (parseFloat(item?.price) || 0);
  if (!isPizzaItem(item) || !halfItem) return base;
  if (_isWholeFlavorSelected()) return base;

  const half = hasSizes ? _pizzaPriceForSize(halfItem, sizeKey) : (parseFloat(halfItem?.price) || 0);
  if (hasSizes && _pizzaHalfRule(item) === 'maior') return Math.max(base, half);
  return (base + half) / 2;
}

function _pizzaSizeLabel(item) {
  const opt = _pizzaSizeOptions(item).find(s => s.key === _pizzaSizeKey);
  return opt ? `${opt.nome} (${opt.key})` : '';
}

function _pizzaAttr(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function renderPizzaSizePicker(item) {
  const wrap = document.getElementById('pizza-size-wrap');
  const grid = document.getElementById('pizza-size-grid');
  const hint = document.getElementById('pizza-size-hint');
  if (!wrap || !grid) return;

  const sizes = _pizzaSizeOptions(item);
  if (!sizes.length) {
    wrap.style.display = 'none';
    grid.innerHTML = '';
    if (hint) hint.textContent = '';
    return;
  }

  wrap.style.display = '';
  grid.innerHTML = sizes.map(size => {
    const on = _pizzaSizeKey === size.key ? ' on' : '';
    return `<button type="button" class="pizza-size-btn${on}" onclick="selectPizzaSize('${_pizzaAttr(size.key)}')">
      <span class="pizza-size-name">${size.nome}</span>
      <span class="pizza-size-price">R$ ${fmt(size.preco)}</span>
    </button>`;
  }).join('');
  if (hint) hint.textContent = _pizzaSizeKey
    ? 'As bordas aparecem conforme o tamanho escolhido.'
    : 'Escolha Pequena, Media ou Grande para liberar as bordas certas.';
}

function selectPizzaSize(key) {
  const baseItem = allItems.find(x => x.id === _imItemId);
  if (!baseItem) return;
  _pizzaSizeKey = String(key || '').toUpperCase();
  renderPizzaSizePicker(baseItem);
  _applyPizzaSizeToBordas(_pizzaSizeKey);
  renderHalfPicker(baseItem);
  updateHalfUI();
  updateImAddBtn();
  if (typeof _updateImPrice === 'function') _updateImPrice();
}

function _applyPizzaSizeToBordas(sizeKey) {
  const key = String(sizeKey || '').toUpperCase();
  document.querySelectorAll('.grp-section[data-borda-tamanho]').forEach(sec => {
    const bordaTam = String(sec.dataset.bordaTamanho || '').toUpperCase();
    if (bordaTam === key) {
      sec.style.display = '';
    } else {
      sec.style.display = 'none';
      const nomeGrp = sec.dataset.bordaGrupo;
      if (nomeGrp && typeof _imGruposState !== 'undefined' && _imGruposState[nomeGrp]) {
        delete _imGruposState[nomeGrp];
        sec.querySelectorAll('.grp-opt-item.on').forEach(e => e.classList.remove('on'));
      }
    }
  });
}

function _pizzaSelectedSizeKeyFromState() {
  if (_pizzaSizeKey) return _pizzaSizeKey;
  const tamanhoKey = Object.keys(_imGruposState || {}).find(k => (k || '').toLowerCase().trim() === 'tamanho');
  const optName = tamanhoKey ? (_imGruposState[tamanhoKey]?.[0]?.nome || '') : '';
  return (optName.match(/\(([PMG])\)/i)?.[1] || '').toUpperCase();
}

function _pizzaSizedGroupKey(groupName) {
  return (String(groupName || '').match(/\((P|M|G)\)\s*$/i)?.[1] || '').toUpperCase();
}

function _pizzaShouldSkipSizedGroup(g) {
  const groupSize = _pizzaSizedGroupKey(g?.nome);
  if (!groupSize) return false;
  const selectedSize = _pizzaSelectedSizeKeyFromState();
  return !selectedSize || groupSize !== selectedSize;
}

function getPizzaSiblings(item) {
  // Retorna todas as pizzas da mesma categoria, exceto o item atual
  const catKey = item.cat_key || item.cat;
  return allItems.filter(x =>
    x.id !== item.id &&
    (x.cat_key === catKey || x.cat === catKey) &&
    x.status !== 'esgotado'
  );
}

function _isWholeFlavorSelected() {
  const base = allItems.find(x => x.id === _imItemId);
  return !!(base && _halfItem && _halfItem.id === base.id);
}

function selectHalfWhole() {
  const base = allItems.find(x => x.id === _imItemId);
  if (!base) return;
  _halfItem = { ...base };
  _halfPickerOpen = false;
  document.getElementById('half-picker-list').style.display = 'none';
  renderHalfPicker(base);
  updateHalfUI();
  updateImAddBtn();
  if (typeof _updateImPrice === 'function') _updateImPrice();
  _updatePizzaVisual();
}

function renderHalfPicker(baseItem) {
  const siblings = getPizzaSiblings(baseItem);
  const list = document.getElementById('half-picker-list');
  // Opção "Inteira com mesmo sabor"
  const wholeOn = _isWholeFlavorSelected() ? ' on' : '';
  const wholeCheck = _isWholeFlavorSelected() ? '✓' : '';
  const wholeOpt = `
    <div class="half-opt${wholeOn}" onclick="selectHalfWhole()" style="border-left:3px solid var(--green)">
      <div class="half-opt-emoji"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2l9 18H3L12 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 14h8M10 10h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></div>
      <span class="half-opt-name">Inteira — mesmo sabor</span>
      <span class="half-opt-price" style="color:var(--green)">Sem acréscimo</span>
      <div class="half-opt-check">${wholeCheck}</div>
    </div>`;
  if (!siblings.length) {
    list.innerHTML = wholeOpt;
    return;
  }
  list.innerHTML = wholeOpt + siblings.map(s => {
    const on = (_halfItem && _halfItem.id === s.id && !_isWholeFlavorSelected()) ? ' on' : '';
    const thumbInner = s.image_url
      ? `<img src="${s.image_url}" alt="${s.name}" style="width:100%;height:100%;object-fit:cover;border-radius:7px">`
      : `<span>$<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2l9 18H3L12 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 14h8M10 10h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></span>`;
    const check = (_halfItem && _halfItem.id === s.id && !_isWholeFlavorSelected()) ? '✓' : '';
    const hasSizes = _pizzaHasSizePricing(baseItem);
    const price = hasSizes
      ? (_pizzaSizeKey ? _pizzaPriceForSize(s, _pizzaSizeKey) : _pizzaMinPrice(s))
      : (parseFloat(s.price) || 0);
    const pricePrefix = hasSizes && !_pizzaSizeKey ? 'A partir de ' : '';
    return `
    <div class="half-opt${on}" onclick="selectHalf(${s.id})">
      <div class="half-opt-emoji">${thumbInner}</div>
      <span class="half-opt-name">${s.name}</span>
      <span class="half-opt-price">${pricePrefix}R$ ${fmt(price)}</span>
      <div class="half-opt-check">${check}</div>
    </div>`;
  }).join('');
}

function selectHalf(id) {
  _halfItem = allItems.find(x => x.id === id) || null;
  _halfPickerOpen = false;
  document.getElementById('half-picker-list').style.display = 'none';
  const baseItem = allItems.find(x => x.id === _imItemId);
  if (baseItem) renderHalfPicker(baseItem);
  updateHalfUI();
  updateImAddBtn();
  if (typeof _updateImPrice === 'function') _updateImPrice();
  // Atualiza visual animado da pizza
  _updatePizzaVisual();
}

function updateHalfUI() {
  const prompt   = document.getElementById('half-pick-prompt');
  const selected = document.getElementById('half-selected-row');
  if (!_halfItem) {
    prompt.style.display   = '';
    selected.style.display = 'none';
    document.getElementById('half-price-note').textContent = '';
    return;
  }
  prompt.style.display   = 'none';
  selected.style.display = '';
  const base = allItems.find(x => x.id === _imItemId);

  if (_isWholeFlavorSelected()) {
    // Pizza inteira — mesmo sabor
    const emoEl = document.getElementById('half-sel-emoji');
    if (base && base.image_url) {
      emoEl.innerHTML = `<img src="${base.image_url}" alt="${base.name}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
    } else {
      emoEl.innerHTML = (base && base.image_url ? '' : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2l9 18H3L12 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 14h8M10 10h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`);
    }
    document.getElementById('half-sel-name').textContent = 'Inteira — mesmo sabor';
    document.getElementById('half-sel-hint').textContent  = 'Pizza inteira com um único sabor';
    document.getElementById('half-price-note').textContent = '';
    return;
  }

  const halfPrice = base ? _pizzaCurrentBasePrice(base, _halfItem) : (parseFloat(_halfItem.price) || 0);
  // Emoji/img da 2ª metade
  const emoEl = document.getElementById('half-sel-emoji');
  if (_halfItem.image_url) {
    emoEl.innerHTML = `<img src="${_halfItem.image_url}" alt="${_halfItem.name}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
  } else {
    emoEl.innerHTML = (_halfItem.image_url ? '' : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2l9 18H3L12 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 14h8M10 10h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`);
  }
  document.getElementById('half-sel-name').textContent = _halfItem.name;
  document.getElementById('half-sel-hint').textContent = 'Toque para trocar';
  const note = base && _pizzaHasSizePricing(base) && _pizzaHalfRule(base) === 'maior'
    ? 'Meio a meio cobra o maior valor: '
    : 'Preco medio das metades: ';
  document.getElementById('half-price-note').textContent = note + `R$ ${fmt(halfPrice)}`;
}

function toggleHalfPicker() {
  _halfPickerOpen = !_halfPickerOpen;
  document.getElementById('half-picker-list').style.display = _halfPickerOpen ? '' : 'none';
}

function updateImAddBtn() {
  const i = allItems.find(x => x.id === _imItemId);
  if (!i) return;
  const isPizza = isPizzaItem(i);
  const base = parseFloat(i.price);
  let price = base;
  if (isPizza && _halfItem) {
    if (_isWholeFlavorSelected()) {
      price = base; // inteira — preço normal
    } else {
      price = (base + parseFloat(_halfItem.price)) / 2;
    }
  }
  const needsSize = isPizza && _pizzaHasSizePricing(i) && !_pizzaSizeKey;
  const extra = (typeof _calcGruposExtra === 'function') ? _calcGruposExtra(i) : 0;
  price = (isPizza ? _pizzaCurrentBasePrice(i, _halfItem) : (parseFloat(i.price) || 0)) + extra;

  // Kit montável (açougue) — preço não é o do item "kit" (que é só um
  // agrupador, geralmente 0), e sim a soma de cada corte escolhido pelo
  // peso selecionado. Sem isso, o botão sempre mostrava R$ 0,00 mesmo com
  // cortes e pesos já escolhidos no resumo acima.
  let kitMontavelAtivo = false;
  if (_isKitItem(i)) {
    const kitCatsGrp = (i.custom_groups || []).find(g => g.tipo === 'kit_categorias');
    if (kitCatsGrp?.categorias?.length) {
      kitMontavelAtivo = true;
      const fonte = (typeof allItems !== 'undefined' && Array.isArray(allItems)) ? allItems : [];
      price = Object.entries(_kitMontavelSel || {}).reduce((s, [idStr, valor]) => {
        const it = fonte.find(x => x.id === parseInt(idStr));
        if (!it) return s;
        const isUnidade = (typeof _kitMontavelEhUnidade === 'function') ? _kitMontavelEhUnidade(it) : (it.item_type !== 'kg');
        return s + (isUnidade ? (valor * (parseFloat(it.price) || 0)) : ((valor / 1000) * (parseFloat(it.price) || 0)));
      }, 0);
    }
  }
  const kitMontavelVazio = kitMontavelAtivo && !Object.values(_kitMontavelSel || {}).some(p => p > 0);

  // Mesmo raciocínio do botão de finalizar pedido: se a loja está fechada
  // mas o cliente já confirmou que quer agendar, o "Adicionar" (de dentro
  // do produto) também precisa liberar — senão o cliente confirma o
  // agendamento mas trava logo no primeiro item que tenta montar.
  const _pedidoAgendadoSeguro = (typeof _pedidoAgendadoPara !== 'undefined') ? _pedidoAgendadoPara : null;
  const podeAgendadoModal = !_lojaAberta && _pedidoAgendadoSeguro;

  const disabled = (!_lojaAberta && !podeAgendadoModal) || needsSize || (isPizza && !_halfItem) || kitMontavelVazio;
  document.getElementById('im-add-btn').disabled = disabled;
  const label = (!_lojaAberta && !podeAgendadoModal) ? 'Loja fechada' : needsSize ? 'Escolha o tamanho da pizza' : (isPizza && !_halfItem
    ? 'Escolha como quer sua pizza acima'
    : (kitMontavelVazio
      ? 'Escolha ao menos um corte acima'
      : `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2h1.5l1.8 7.5h6.5l1.2-5H5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="13" r="1" fill="currentColor"/><circle cx="12" cy="13" r="1" fill="currentColor"/></svg> Adicionar · R$ ${fmt(price * _imQty)}`));
  document.getElementById('im-add-btn').innerHTML = label;
}


// ══════════════════════════════════════════════════════
//  ANIMAÇÕES VISUAIS AVANÇADAS — Canvas 2D
// ══════════════════════════════════════════════════════

// ── Particle canvas global ────────────────────────────
const _pCanvas = (() => {
  let c = document.getElementById('anim-particle-canvas');
  if (!c) { c = document.createElement('canvas'); c.id='anim-particle-canvas'; c.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:9998;'; document.body.appendChild(c); }
  c.width  = window.innerWidth;
  c.height = window.innerHeight;
  window.addEventListener('resize', () => { c.width=window.innerWidth; c.height=window.innerHeight; });
  return c;
})();
const _pCtx = _pCanvas.getContext('2d');
let _particles = [];
let _pRafId = null;

function _pLoop() {
  _pCtx.clearRect(0, 0, _pCanvas.width, _pCanvas.height);
  _particles = _particles.filter(p => p.life > 0);
  for (const p of _particles) {
    p.x  += p.vx;
    p.y  += p.vy;
    p.vy += p.gravity;
    p.vx *= 0.98;
    p.rot += p.rotV;
    p.life -= p.decay;
    _pCtx.save();
    _pCtx.globalAlpha = Math.max(0, p.life);
    _pCtx.translate(p.x, p.y);
    _pCtx.rotate(p.rot);
    p.draw(_pCtx);
    _pCtx.restore();
  }
  if (_particles.length > 0) _pRafId = requestAnimationFrame(_pLoop);
  else { _pCtx.clearRect(0, 0, _pCanvas.width, _pCanvas.height); _pRafId = null; }
}

function _spawnParticles(list) {
  _particles.push(...list);
  if (!_pRafId) _pRafId = requestAnimationFrame(_pLoop);
}

// ── SVG ingredient shapes (no emoji) ─────────────────
const _ingShapes = {
  morango(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(0, -s*.8);
    ctx.bezierCurveTo(s*.6,-s*.8, s*.9,-s*.2, 0, s*.9);
    ctx.bezierCurveTo(-s*.9,-s*.2, -s*.6,-s*.8, 0, -s*.8);
    ctx.fillStyle = '#e53e3e'; ctx.fill();
    // seeds
    ctx.fillStyle='#c53030';
    for(let i=0;i<4;i++){ctx.beginPath();ctx.arc((Math.random()-.5)*s*.5,(Math.random()-.5)*s*.5,s*.08,0,Math.PI*2);ctx.fill();}
    // leaf
    ctx.beginPath(); ctx.moveTo(0,-s*.8); ctx.bezierCurveTo(-s*.3,-s*1.3,s*.3,-s*1.3,0,-s*.8);
    ctx.fillStyle='#38a169'; ctx.fill();
  },
  banana(ctx, s) {
    ctx.beginPath();
    ctx.ellipse(0, 0, s*.9, s*.35, -0.4, 0, Math.PI*2);
    ctx.fillStyle='#f6e05e'; ctx.fill();
    ctx.strokeStyle='#d69e2e'; ctx.lineWidth=s*.06; ctx.stroke();
  },
  granola(ctx, s) {
    const cols=['#c05621','#9c4221','#b7791f'];
    for(let i=0;i<5;i++){
      ctx.beginPath();
      ctx.arc((Math.random()-.5)*s*.8,(Math.random()-.5)*s*.8,s*.2,0,Math.PI*2);
      ctx.fillStyle=cols[i%3]; ctx.fill();
    }
  },
  mel(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(0,-s);ctx.bezierCurveTo(s*.5,-s*.5,s*.5,s*.2,0,s);ctx.bezierCurveTo(-s*.5,s*.2,-s*.5,-s*.5,0,-s);
    ctx.fillStyle='#d69e2e'; ctx.fill();
  },
  chocolate(ctx, s) {
    ctx.beginPath();
    ctx.roundRect(-s*.6,-s*.4,s*1.2,s*.8,s*.12);
    ctx.fillStyle='#6b3a2a'; ctx.fill();
    ctx.strokeStyle='#8b5e4a'; ctx.lineWidth=s*.06;
    ctx.beginPath(); ctx.moveTo(0,-s*.4); ctx.lineTo(0,s*.4); ctx.stroke();
  },
  coco(ctx, s) {
    ctx.beginPath();
    ctx.ellipse(0,0,s*.9,s*.3,-0.3,0,Math.PI*2);
    ctx.fillStyle='#fff'; ctx.fill();
    ctx.strokeStyle='#d4a76a'; ctx.lineWidth=s*.05; ctx.stroke();
  },
  aveia(ctx, s) {
    ctx.beginPath();
    ctx.ellipse(0,0,s*.8,s*.4,0.2,0,Math.PI*2);
    ctx.fillStyle='#c9a96e'; ctx.fill();
    // fibras
    ctx.strokeStyle='#a07840'; ctx.lineWidth=s*.07;
    for(let i=-1;i<=1;i++){ctx.beginPath();ctx.moveTo(i*s*.3,-s*.3);ctx.lineTo(i*s*.3+s*.1,s*.3);ctx.stroke();}
  },
  fruta(ctx, s) {
    ctx.beginPath();
    ctx.arc(0,0,s*.7,0,Math.PI*2);
    ctx.fillStyle='#805ad5'; ctx.fill();
    ctx.beginPath();
    for(let i=0;i<5;i++){ctx.arc((Math.random()-.5)*s*.5,(Math.random()-.5)*s*.5,s*.1,0,Math.PI*2);}
    ctx.fillStyle='rgba(255,255,255,.3)'; ctx.fill();
  },
  default(ctx, s) {
    ctx.beginPath();
    ctx.arc(0,0,s*.6,0,Math.PI*2);
    const g=ctx.createRadialGradient(0,0,0,0,0,s*.6);
    g.addColorStop(0,'#f97316'); g.addColorStop(1,'#ea580c');
    ctx.fillStyle=g; ctx.fill();
  }
};

function _getIngShape(name) {
  const n = (name||'').toLowerCase();
  if(n.includes('morango')||n.includes('strawb')) return _ingShapes.morango;
  if(n.includes('banana'))                         return _ingShapes.banana;
  if(n.includes('granola')||n.includes('aveia'))   return _ingShapes.aveia;
  if(n.includes('mel')||n.includes('honey'))       return _ingShapes.mel;
  if(n.includes('chocolate')||n.includes('choc'))  return _ingShapes.chocolate;
  if(n.includes('coco')||n.includes('coconut'))    return _ingShapes.coco;
  if(n.includes('granola'))                        return _ingShapes.granola;
  if(n.includes('açaí')||n.includes('acai')||n.includes('mirtilo')||n.includes('uva')) return _ingShapes.fruta;
  return _ingShapes.default;
}

// ── Detecta tipo visual do item ───────────────────────
function _itemVisualType(item) {
  if (!item) return 'normal';
  const cat = allCats.find(c => c.name === (item.cat_key || item.cat));
  const all = ((item.cat_key||'') + ' ' + (item.cat||'') + ' ' + (cat?.label||'') + ' ' + (item.name||'')).toLowerCase();
  if (all.includes('pizza'))                                           return 'pizza';
  if (all.includes('açaí')||all.includes('acai')||all.includes('tigela')||all.includes('bowl')) return 'acai';
  if (all.includes('marmita')||all.includes('quentinha')||all.includes('prato feito')||all.includes('p.f.')) return 'marmita';
  if (all.includes('hamburguer')||all.includes('hamburger')||all.includes('hambúrguer')||all.includes('burger')||all.includes('smash')||all.includes('lanche')||all.includes('sanduíche')||all.includes('sanduiche')) return 'burger';
  return 'normal';
}

// ── Cup wave simulation ───────────────────────────────
let _cupCanvas = null, _cupCtx = null, _cupRaf = null;
let _cupFill = 0, _cupTargetFill = 0, _cupType = 'acai';
const _wavePoints = Array.from({length: 20}, (_,i) => ({ x: i/19, y: 0, vy: 0 }));

function _cupLoop() {
  if (!_cupCanvas) return;
  const W = _cupCanvas.width, H = _cupCanvas.height;
  _cupCtx.clearRect(0, 0, W, H);

  // smooth fill towards target
  _cupFill += (_cupTargetFill - _cupFill) * 0.08;

  // wave physics
  const K=0.15, DAMP=0.88, SPREAD=0.3;
  for (const p of _wavePoints) {
    p.vy += -K * p.y;
    p.vy *= DAMP;
    p.y  += p.vy;
  }
  // neighbour spread
  for (let i=1; i<_wavePoints.length-1; i++) {
    _wavePoints[i].vy += SPREAD * (_wavePoints[i-1].y + _wavePoints[i+1].y - 2*_wavePoints[i].y);
  }

  const fillY = H * (1 - _cupFill);

  // draw liquid
  if (_cupFill > 0.01) {
    _cupCtx.save();
    _cupCtx.beginPath();
    _cupCtx.moveTo(0, H);
    _cupCtx.lineTo(0, fillY + (_wavePoints[0]?.y || 0));
    for (let i=1; i<_wavePoints.length; i++) {
      const px = _wavePoints[i-1].x * W, py = fillY + _wavePoints[i-1].y;
      const cx = _wavePoints[i].x   * W, cy = fillY + _wavePoints[i].y;
      _cupCtx.quadraticCurveTo(px, py, (px+cx)/2, (py+cy)/2);
    }
    _cupCtx.lineTo(W, H);
    _cupCtx.closePath();
    const g = _cupCtx.createLinearGradient(0, fillY, 0, H);
    if (_cupType === 'acai') {
      g.addColorStop(0, 'rgba(107,33,168,.75)');
      g.addColorStop(1, 'rgba(59,7,100,.92)');
    } else {
      g.addColorStop(0, 'rgba(161,94,34,.75)');
      g.addColorStop(1, 'rgba(92,47,14,.92)');
    }
    _cupCtx.fillStyle = g;
    _cupCtx.fill();
    _cupCtx.restore();
  }

  _cupRaf = requestAnimationFrame(_cupLoop);
}

function _startCupAnim(type) {
  _cupType = type;
  _cupFill = 0; _cupTargetFill = 0;
  for (const p of _wavePoints) { p.y = 0; p.vy = 0; }
  if (_cupRaf) { cancelAnimationFrame(_cupRaf); _cupRaf = null; }
  _cupLoop();
}

function _stopCupAnim() {
  if (_cupRaf) { cancelAnimationFrame(_cupRaf); _cupRaf = null; }
}

// ── Init anim layer ───────────────────────────────────
function _initAnimLayer(item) {
  const layer = document.getElementById('im-anim-layer');
  if (!layer) return;
  const vtype = _itemVisualType(item);
  if (vtype !== 'acai' && vtype !== 'marmita' && vtype !== 'burger') {
    layer.style.display = 'none'; layer.innerHTML = ''; _stopCupAnim(); _stopBurgerAnim(); return;
  }
  layer.style.display = 'flex';
  _animFillLevel = 0;

  if (vtype === 'burger') {
    layer.style.alignItems = 'center';
    layer.innerHTML = `<canvas id="burger-canvas" width="160" height="200" style="display:block;filter:drop-shadow(0 6px 16px rgba(0,0,0,.22))"></canvas>`;
    _initBurgerCanvas();
    return;
  }

  if (vtype === 'acai') {
    layer.innerHTML = `
    <div class="anim-cup-container" style="position:relative;width:110px;height:164px">
      <canvas id="cup-wave-canvas" width="74" height="110" style="position:absolute;bottom:22px;left:18px;border-radius:0 0 12px 12px;clip-path:polygon(0 0,100% 0,94% 100%,6% 100%)"></canvas>
      <svg viewBox="0 0 110 164" width="110" height="164" style="position:absolute;top:0;left:0" xmlns="http://www.w3.org/2000/svg">
        <!-- corpo do copo transparente -->
        <path d="M19 32 L28 142 Q28 155 55 155 Q82 155 82 142 L91 32 Z" fill="rgba(255,255,255,.55)" stroke="#c8a882" stroke-width="2"/>
        <!-- borda superior -->
        <rect x="13" y="22" width="84" height="13" rx="5" fill="#e8d5bc" stroke="#c8a882" stroke-width="1.8"/>
        <!-- reflexo lateral -->
        <path d="M26 38 L33 132 Q33 138 38 140 L35 142 Q28 140 27 132 L19 36 Z" fill="rgba(255,255,255,.22)"/>
        <!-- base -->
        <ellipse cx="55" cy="150" rx="27" ry="7" fill="#d4b896" stroke="#c8a882" stroke-width="1.5"/>
        <!-- canudo -->
        <rect x="62" y="0" width="7" height="52" rx="3.5" fill="#f97316"/>
        <rect x="63" y="0" width="2.5" height="52" rx="1.25" fill="rgba(255,255,255,.35)"/>
      </svg>
    </div>`;
  } else {
    layer.innerHTML = `
    <div class="anim-cup-container" style="position:relative;width:120px;height:150px">
      <canvas id="cup-wave-canvas" width="78" height="72" style="position:absolute;bottom:12px;left:21px;border-radius:0 0 4px 4px;clip-path:polygon(0 0,100% 0,100% 100%,0 100%)"></canvas>
      <svg viewBox="0 0 120 150" width="120" height="150" style="position:absolute;top:0;left:0" xmlns="http://www.w3.org/2000/svg">
        <!-- corpo marmita -->
        <rect x="11" y="55" width="98" height="84" rx="7" fill="rgba(232,224,212,.85)" stroke="#b0a090" stroke-width="2.2"/>
        <!-- tampa -->
        <rect x="8"  y="44" width="104" height="18" rx="7" fill="#ddd0bc" stroke="#b0a090" stroke-width="2"/>
        <!-- alça esq -->
        <path d="M22 55 Q17 41 26 37 Q35 33 35 55" fill="none" stroke="#b0a090" stroke-width="2.5" stroke-linecap="round"/>
        <!-- alça dir -->
        <path d="M98 55 Q103 41 94 37 Q85 33 85 55" fill="none" stroke="#b0a090" stroke-width="2.5" stroke-linecap="round"/>
        <!-- divisórias -->
        <line x1="60" y1="73" x2="60" y2="139" stroke="#c8b8a8" stroke-width="1.2" stroke-dasharray="3 2" opacity=".6"/>
        <line x1="11" y1="110" x2="109" y2="110" stroke="#c8b8a8" stroke-width="1.2" stroke-dasharray="3 2" opacity=".6"/>
        <!-- reflexo tampa -->
        <path d="M18 46 Q60 42 102 46" stroke="rgba(255,255,255,.5)" stroke-width="2" fill="none" stroke-linecap="round"/>
      </svg>
    </div>`;
  }

  _cupCanvas = document.getElementById('cup-wave-canvas');
  _cupCtx    = _cupCanvas ? _cupCanvas.getContext('2d') : null;
  _startCupAnim(vtype);
}

let _animFillLevel = 0;

// ── Shoot ingredient particle toward cup ─────────────
function _dropIngredient(name, fromEl) {
  const cup = document.getElementById('cup-wave-canvas');
  if (!cup) return;
  const cupR   = cup.getBoundingClientRect();
  const targetX = cupR.left + cupR.width  * .5;
  const targetY = cupR.top  + cupR.height * .35;

  let startX = targetX, startY = targetY - 130;
  if (fromEl) {
    const r = fromEl.getBoundingClientRect();
    startX = r.left + r.width  / 2;
    startY = r.top  + r.height / 2;
  }

  const drawFn = _getIngShape(name);
  const s = 12 + Math.random() * 6;
  const dx = targetX - startX, dy = targetY - startY;
  const dur = 420 + Math.random() * 80; // ms
  const frames = Math.round(dur / 16);
  let frame = 0;
  const rot0 = (Math.random() - .5) * Math.PI;
  const rotV = (Math.random() - .5) * 0.22;

  function tick() {
    const t    = frame / frames;
    const ease = t < .5 ? 2*t*t : -1+(4-2*t)*t;
    const x    = startX + dx * ease;
    const y    = startY + dy * ease + Math.sin(t * Math.PI) * (-40);
    const life = frame < frames * .85 ? 1 : 1 - (t - .85) / .15;
    _particles.push({
      x, y, vx:0, vy:0, gravity:0, rot: rot0 + rotV*frame, rotV:0,
      life, decay:999,
      draw(ctx) { drawFn(ctx, s); }
    });
    frame++;
    if (frame <= frames) {
      requestAnimationFrame(tick);
    } else {
      _particles.push({x:targetX,y:targetY,vx:0,vy:0,gravity:0,rot:0,rotV:0,life:1,decay:999,draw(){}});
      _landSplash(targetX, targetY);
      _raiseFillLevel();
    }
    if (!_pRafId) _pRafId = requestAnimationFrame(_pLoop);
  }
  tick();
}

function _landSplash(x, y) {
  const n = 10;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    const spd   = 2 + Math.random() * 3;
    _particles.push({
      x, y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd - 2,
      gravity: 0.18, rot:0, rotV:0,
      life:1, decay: 0.06 + Math.random()*.04,
      draw(ctx) {
        ctx.beginPath(); ctx.arc(0,0,3,0,Math.PI*2);
        ctx.fillStyle='rgba(90,30,120,.7)'; ctx.fill();
      }
    });
  }
  // wave disturbance at hit point
  const wIdx = Math.round(_wavePoints.length * .5 + (Math.random()-.5)*4);
  if (_wavePoints[wIdx]) _wavePoints[wIdx].vy = -8;
}

function _raiseFillLevel() {
  _animFillLevel = Math.min(_animFillLevel + 1, 10);
  _cupTargetFill = _animFillLevel / 10 * 0.72;
}

function _lowerFillLevel() {
  _animFillLevel = Math.max(_animFillLevel - 1, 0);
  _cupTargetFill = _animFillLevel / 10 * 0.72;
}

// ══════════════════════════════════════════════════════
//  PIZZA — Canvas 2D avançado
// ══════════════════════════════════════════════════════
let _pizzaCanvas = null, _pizzaCtx = null, _pizzaRaf = null;
let _pizzaState  = { leftFill:0, rightFill:0, leftColor:'#e89a5a', rightColor:'#e89a5a', leftToppings:[], rightToppings:[], rotate:0 };

const _pizzaColors = ['#c0392b','#27ae60','#2980b9','#8e44ad','#e67e22','#16a085','#c0392b','#f39c12'];
const _toppingShapes = [
  (ctx,x,y,s) => { ctx.beginPath(); ctx.arc(x,y,s*.9,0,Math.PI*2); ctx.fillStyle='#e74c3c'; ctx.fill(); ctx.fillStyle='#c0392b'; ctx.beginPath(); ctx.arc(x-s*.2,y-s*.2,s*.25,0,Math.PI*2); ctx.fill(); },
  (ctx,x,y,s) => { ctx.beginPath(); ctx.ellipse(x,y,s*1.1,s*.5,0.3,0,Math.PI*2); ctx.fillStyle='#e67e22'; ctx.fill(); },
  (ctx,x,y,s) => { ctx.beginPath(); ctx.arc(x,y,s*.8,0,Math.PI*2); ctx.fillStyle='#2ecc71'; ctx.fill(); ctx.strokeStyle='#27ae60'; ctx.lineWidth=.5; ctx.stroke(); },
  (ctx,x,y,s) => { ctx.beginPath(); ctx.moveTo(x,y-s); for(let i=1;i<5;i++){const a=i*Math.PI*2/5-Math.PI/2;ctx.lineTo(x+Math.cos(a)*s*.5,y+Math.sin(a)*s*.5); const a2=a+Math.PI/5; ctx.lineTo(x+Math.cos(a2)*s,y+Math.sin(a2)*s);} ctx.closePath(); ctx.fillStyle='#f1c40f'; ctx.fill(); },
];

function _genToppings(colorIdx) {
  const t = []; const r = 26;
  for (let i=0; i<7; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = 10 + Math.random() * r;
    t.push({ x: Math.cos(angle)*dist, y: Math.sin(angle)*dist, s: 3+Math.random()*2.5, shape: Math.floor(Math.random()*_toppingShapes.length), opacity: 0 });
  }
  return t;
}

function _pizzaLoop() {
  if (!_pizzaCanvas) return;
  const W = _pizzaCanvas.width, H = _pizzaCanvas.height;
  const cx = W/2, cy = H/2, R = W*.44;
  _pizzaCtx.clearRect(0, 0, W, H);

  const ps = _pizzaState;
  ps.leftFill  += (1 - ps.leftFill)  * 0.06;
  ps.rightFill += (ps.rightTarget  - ps.rightFill)  * 0.06;
  ps.rotate    += (0 - ps.rotate) * 0.05;

  _pizzaCtx.save();
  _pizzaCtx.translate(cx, cy);
  _pizzaCtx.rotate(ps.rotate);

  // crust (borda)
  _pizzaCtx.beginPath(); _pizzaCtx.arc(0,0,R+8,0,Math.PI*2);
  const crustG = _pizzaCtx.createRadialGradient(0,0,R,0,0,R+8);
  crustG.addColorStop(0,'#d4a76a'); crustG.addColorStop(1,'#c8935a');
  _pizzaCtx.fillStyle=crustG; _pizzaCtx.fill();

  // base molho
  _pizzaCtx.beginPath(); _pizzaCtx.arc(0,0,R,0,Math.PI*2);
  _pizzaCtx.fillStyle='#d4614e'; _pizzaCtx.fill();

  // queijo base
  _pizzaCtx.beginPath(); _pizzaCtx.arc(0,0,R*.93,0,Math.PI*2);
  const cheeseG = _pizzaCtx.createRadialGradient(-R*.1,-R*.1,0,0,0,R*.93);
  cheeseG.addColorStop(0,'#fef08a'); cheeseG.addColorStop(.6,'#fde047'); cheeseG.addColorStop(1,'#facc15');
  _pizzaCtx.fillStyle=cheeseG; _pizzaCtx.fill();

  // bolhas de queijo
  for(let i=0;i<12;i++){
    const a=i/12*Math.PI*2, d=R*(0.3+i%3*.2);
    _pizzaCtx.beginPath(); _pizzaCtx.arc(Math.cos(a)*d,Math.sin(a)*d,R*.055,0,Math.PI*2);
    _pizzaCtx.fillStyle='rgba(234,179,8,.55)'; _pizzaCtx.fill();
  }

  // metade esquerda highlight
  if (ps.leftFill > 0.02) {
    _pizzaCtx.save();
    _pizzaCtx.beginPath(); _pizzaCtx.moveTo(0,0); _pizzaCtx.arc(0,0,R*.93,-Math.PI/2,Math.PI/2,true); _pizzaCtx.closePath();
    _pizzaCtx.fillStyle = ps.leftColor + '44';
    _pizzaCtx.globalAlpha = ps.leftFill;
    _pizzaCtx.fill();
    _pizzaCtx.restore();
    // toppings esquerda
    _pizzaCtx.save();
    _pizzaCtx.beginPath(); _pizzaCtx.moveTo(0,0); _pizzaCtx.arc(0,0,R*.93,-Math.PI/2,Math.PI/2,true); _pizzaCtx.closePath(); _pizzaCtx.clip();
    for (const t of ps.leftToppings) {
      t.opacity = Math.min(1, t.opacity + 0.05);
      _pizzaCtx.globalAlpha = t.opacity * ps.leftFill;
      _toppingShapes[t.shape](_pizzaCtx, t.x-10, t.y, t.s);
    }
    _pizzaCtx.restore();
  }

  // metade direita highlight
  if (ps.rightFill > 0.02) {
    _pizzaCtx.save();
    _pizzaCtx.beginPath(); _pizzaCtx.moveTo(0,0); _pizzaCtx.arc(0,0,R*.93,-Math.PI/2,Math.PI/2); _pizzaCtx.closePath();
    _pizzaCtx.fillStyle = ps.rightColor + '44';
    _pizzaCtx.globalAlpha = ps.rightFill;
    _pizzaCtx.fill();
    _pizzaCtx.restore();
    // toppings direita
    _pizzaCtx.save();
    _pizzaCtx.beginPath(); _pizzaCtx.moveTo(0,0); _pizzaCtx.arc(0,0,R*.93,-Math.PI/2,Math.PI/2); _pizzaCtx.closePath(); _pizzaCtx.clip();
    for (const t of ps.rightToppings) {
      t.opacity = Math.min(1, t.opacity + 0.05);
      _pizzaCtx.globalAlpha = t.opacity * ps.rightFill;
      _toppingShapes[t.shape](_pizzaCtx, t.x+10, t.y, t.s);
    }
    _pizzaCtx.restore();
  }

  // divisória
  _pizzaCtx.save();
  _pizzaCtx.beginPath(); _pizzaCtx.moveTo(0,-R-8); _pizzaCtx.lineTo(0,R+8);
  _pizzaCtx.strokeStyle='rgba(255,255,255,.7)'; _pizzaCtx.lineWidth=2.5;
  _pizzaCtx.setLineDash([6,4]); _pizzaCtx.stroke();
  _pizzaCtx.restore();

  // pontos de interrogação se vazio
  _pizzaCtx.font = 'bold 22px sans-serif';
  _pizzaCtx.textAlign = 'center'; _pizzaCtx.textBaseline = 'middle';
  if (ps.leftFill < 0.1) { _pizzaCtx.fillStyle='rgba(180,120,60,.5)'; _pizzaCtx.fillText('?', -R*.45, 0); }
  if (ps.rightFill < 0.1) { _pizzaCtx.fillStyle='rgba(180,120,60,.5)'; _pizzaCtx.fillText('?', R*.45, 0); }

  _pizzaCtx.restore();
  _pizzaRaf = requestAnimationFrame(_pizzaLoop);
}

function _updatePizzaVisual() {
  const base = allItems.find(x => x.id === _imItemId);
  if (!base) return;
  const colIdx = Math.abs((base.id||0) % _pizzaColors.length);
  _pizzaState.leftColor    = _pizzaColors[colIdx];
  _pizzaState.leftFill     = 0;
  _pizzaState.leftToppings = _genToppings(colIdx);

  if (_halfItem) {
    if (_isWholeFlavorSelected()) {
      // Inteira — mesma cor dos dois lados
      _pizzaState.rightColor    = _pizzaColors[colIdx];
      _pizzaState.rightTarget   = 1;
      _pizzaState.rightToppings = _genToppings(colIdx);
      _pizzaState.rotate        = 0;
    } else {
      const rIdx = Math.abs((_halfItem.id||0) % _pizzaColors.length);
      _pizzaState.rightColor    = _pizzaColors[rIdx];
      _pizzaState.rightTarget   = 1;
      _pizzaState.rightToppings = _genToppings(rIdx);
      _pizzaState.rotate        = 0.12;
    }
  } else {
    _pizzaState.rightTarget = 0;
  }

  const tag1 = document.getElementById('pizza-tag-left');
  const tag2 = document.getElementById('pizza-tag-right');
  if (tag1) { tag1.textContent = base.name.length > 15 ? base.name.slice(0,14)+'…' : base.name; tag1.classList.add('filled'); }
  if (tag2 && _halfItem) {
    if (_isWholeFlavorSelected()) {
      tag2.textContent = base.name.length > 15 ? base.name.slice(0,14)+'…' : base.name;
    } else {
      tag2.textContent = _halfItem.name.length > 15 ? _halfItem.name.slice(0,14)+'…' : _halfItem.name;
    }
    tag2.classList.add('filled');
  }
  else if (tag2) { tag2.textContent = '2ª metade'; tag2.classList.remove('filled'); }
}

function _initPizzaCanvas() {
  _pizzaCanvas = document.getElementById('pizza-anim-canvas');
  if (!_pizzaCanvas) return;
  _pizzaCtx  = _pizzaCanvas.getContext('2d');
  _pizzaState = { leftFill:0, leftColor:'#e89a5a', leftToppings:[], rightFill:0, rightTarget:0, rightColor:'#e89a5a', rightToppings:[], rotate:0 };
  if (_pizzaRaf) { cancelAnimationFrame(_pizzaRaf); _pizzaRaf=null; }
  _pizzaLoop();
}


function closeItemModal() {
  document.getElementById('item-modal-bg').classList.remove('on');
  const closeFab = document.getElementById('im-close-fab');
  if (closeFab) closeFab.style.display = 'none';
  // Pausa o vídeo do produto ao fechar, se houver
  const imVideo = document.querySelector('#im-img video');
  if (imVideo) { try { imVideo.pause(); } catch(e) {} }
  _halfItem = null;
  _halfPickerOpen = false;
  const pl = document.getElementById('half-picker-list');
  if (pl) pl.style.display = 'none';
  _stopCupAnim();
  _stopBurgerAnim();
  if (_pizzaRaf) { cancelAnimationFrame(_pizzaRaf); _pizzaRaf = null; }
  _particles = [];
  // Restaura descrição ao fechar
  const descEl = document.getElementById('im-desc');
  if (descEl) descEl.style.display = '';
  document.getElementById('im-info-tabs-wrap')?.remove();
}

// ── Troca de aba no painel "Informações do produto" ──
function imSwitchTab(tab) {
  ['detalhes','preparo'].forEach(t => {
    const btn   = document.getElementById(`im-tab-btn-${t}`);
    const panel = document.getElementById(`im-tab-panel-${t}`);
    const isOn  = t === tab;
    if (btn) {
      btn.style.background   = isOn ? 'var(--accent,#f97316)' : 'transparent';
      btn.style.color        = isOn ? '#000' : 'var(--muted)';
      btn.style.borderColor  = isOn ? 'var(--accent,#f97316)' : 'var(--border,#2a2a2a)';
    }
    if (panel) panel.style.display = isOn ? 'block' : 'none';
  });
}

function imQty(d) {
  _imQty = Math.max(1, _imQty + d);
  document.getElementById('im-qty').textContent = _imQty;
  updateImAddBtn();
}

function toggleIngr(chip) {
  const wasOn = chip.classList.contains('on');
  chip.classList.toggle('on');
  // Atualiza contador
  const total = document.querySelectorAll('#im-ingr-grid .im-ingr-chip.on').length;
  const cnt = document.getElementById('im-ingr-count');
  if (cnt) {
    cnt.textContent = total;
    total > 0 ? cnt.classList.add('show') : cnt.classList.remove('show');
  }
  // Animação ingrediente
  const vtype = _itemVisualType(allItems.find(x => x.id === _imItemId));
  if (vtype === 'acai' || vtype === 'marmita') {
    const isNowOn = chip.classList.contains('on');
    if (isNowOn) {
      const label = chip.querySelector('span')?.textContent?.trim() || '';
      _dropIngredient(label, chip);
    } else {
      _lowerFillLevel();
    }
  }
  if (vtype === 'burger') {
    const isNowOn = chip.classList.contains('on');
    const label = chip.querySelector('span')?.textContent?.trim() || '';
    if (isNowOn) _addBurgerLayer(label);
    else         _removeBurgerLayer(label);
  }
}

// Efeito "voando até o carrinho" — mede se o carrinho realmente cresceu
// (imConfirm tem várias saídas antecipadas de validação: grupo obrigatório
// faltando, peso do açougue não selecionado, etc.) em vez de assumir que
// todo clique adicionou algo. Não toca em nenhuma lógica de imConfirm().
function imConfirmWithFly(btnEl) {
  const beforeQty = cart.reduce((s, c) => s + c.qty, 0);
  const rect = btnEl?.getBoundingClientRect ? btnEl.getBoundingClientRect() : null;
  const imgEl = document.getElementById('im-img')?.querySelector('img');
  const imgSrc = imgEl ? imgEl.src : null;
  imConfirm();
  const afterQty = cart.reduce((s, c) => s + c.qty, 0);
  if (afterQty > beforeQty && rect) {
    _flyToCartFromRect(rect, imgSrc);
  }
}

function _flyToCartFromRect(startRect, imgSrc) {
  const cartFloat = document.getElementById('cart-float');
  const cartBadge = document.getElementById('cart-badge');
  if (!cartFloat) return;
  const endRect = cartFloat.getBoundingClientRect();
  const size = 46;
  const el = document.createElement('div');
  el.className = 'fly-to-cart';
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.left = (startRect.left + startRect.width/2 - size/2) + 'px';
  el.style.top  = (startRect.top  + startRect.height/2 - size/2) + 'px';
  if (imgSrc) {
    el.style.backgroundImage = `url("${imgSrc}")`;
  } else {
    el.style.background = 'var(--accent-g, var(--accent))';
  }
  document.body.appendChild(el);
  // força um reflow antes de animar, senão o navegador agrupa os estilos
  // inicial+final numa única atualização e não anima nada
  void el.offsetWidth;
  const dx = (endRect.left + endRect.width/2)  - (startRect.left + startRect.width/2);
  const dy = (endRect.top  + endRect.height/2) - (startRect.top  + startRect.height/2);
  el.style.transform = `translate(${dx}px, ${dy}px) scale(.15)`;
  el.style.opacity = '0.15';
  el.style.width = '14px';
  el.style.height = '14px';
  setTimeout(() => {
    el.remove();
    cartBadge?.classList.add('bump');
    cartFloat.classList.add('bump');
    setTimeout(() => {
      cartBadge?.classList.remove('bump');
      cartFloat.classList.remove('bump');
    }, 400);
  }, 560);
}

function imConfirm() {
  const i   = allItems.find(x => x.id === _imItemId);
  if (!i) return;
  const isPizza = isPizzaItem(i);

  // Validate required grupos
  const grupos = (i.custom_groups || []).filter(g =>
    g?.tipo !== 'pizza_sizes' &&
    !(_pizzaHasSizePricing(i) && (g.nome||'').toLowerCase().trim() === 'tamanho') &&
    !(isPizza && _pizzaShouldSkipSizedGroup(g))
  );
  for (const g of grupos) {
    if (g.required === true) {
      const sel = _imGruposState[g.nome] || [];
      if (!sel.length) { toast('warn', `Escolha: ${g.nome}`); return; }
    }
    // complementos adicionais (checkbox) são opcionais
  }

  const obs = document.getElementById('im-obs').value.trim();

  const selectedIngrs = [...document.querySelectorAll('#im-ingr-grid .im-ingr-chip.on')]
    .map(c => c.querySelector('span')?.textContent?.trim())
    .filter(Boolean);

  // Monta obs final: ingredientes + obs livre
  let obsComIngr = '';
  if (selectedIngrs.length > 0) {
    obsComIngr = selectedIngrs.join(', ');
    if (obs) obsComIngr += ' · ' + obs;
  } else {
    obsComIngr = obs;
  }

  // Pizza meio a meio — precisa de 2ª metade
  if (isPizza && _pizzaHasSizePricing(i) && !_pizzaSizeKey) {
    toast('warn', 'Escolha o tamanho da pizza!');
    document.getElementById('pizza-size-wrap')?.scrollIntoView({behavior:'smooth',block:'center'});
    return;
  }

  if (isPizza && !_halfItem) {
    toast('warn', 'Escolha como quer sua pizza!');
    document.getElementById('half-section').scrollIntoView({behavior:'smooth',block:'center'});
    return;
  }

  let cartName  = i.name;
  let cartPrice = isPizza ? _pizzaCurrentBasePrice(i, _halfItem) : parseFloat(i.price);
  let cartObs   = obsComIngr;
  let cartEmoji = i.emoji;
  let cartImg   = i.image_url;

  if (isPizza && _halfItem) {
    if (_isWholeFlavorSelected()) {
      // Inteira com mesmo sabor — preço normal
      cartName  = i.name;
      cartPrice = _pizzaCurrentBasePrice(i, _halfItem);
      cartObs   = obsComIngr ? `Pizza inteira · ${obsComIngr}` : 'Pizza inteira';
      cartImg   = i.image_url || null;
    } else {
      cartName  = `${i.name} / ${_halfItem.name}`;
      cartPrice = _pizzaCurrentBasePrice(i, _halfItem);
      cartObs   = obsComIngr ? `Meio a meio · ${obsComIngr}` : 'Meio a meio';
      cartImg   = i.image_url || null;
    }
  }

  if (isPizza && _pizzaSizeKey) {
    const sizeLabel = _pizzaSizeLabel(i);
    if (sizeLabel) cartObs = [`Tamanho: ${sizeLabel}`, cartObs].filter(Boolean).join(' · ');
  }

  // ── Açougue: valida e monta descrição (só para kg, não kit) ──
  if (_isAcougueItem(i) && !_isKitItem(i)) {
    // Se o cliente não escolheu o peso explicitamente, abre o sheet em quilos
    if (!_pesoConfirmadoPeloUsuario) {
      const cgs = i.custom_groups || [];
      _acouguePesos = (cgs.find(g => g.tipo === 'pesos')?.valores) || [];
      const cortesGrp = cgs.find(g => g.tipo === 'cortes');
      const corteParaSheet = cortesGrp?.opcoes?.[0]?.nome || cortesGrp?.opcoes?.[0]?.id || 'Inteiro';
      openPesoSheet(corteParaSheet);
      return;
    }
    const totalPesoSel = Object.values(_acougueCortes).reduce((s, v) => s + (v.peso || 0), 0);
    if (!totalPesoSel) {
      toast('warn', 'Selecione ao menos um corte e o peso!');
      return;
    }
    // Valida grupos genéricos obrigatórios (radio)
    const _ACOUGUE_TIPOS = ['cortes','preparos','ocasiao','armazenamento','pesos','porcao_ref','kit_itens'];
    for (const g of (i.custom_groups || [])) {
      if (_ACOUGUE_TIPOS.includes(g.tipo)) continue;
      if (g.required === true) {
        const sel = _imGruposState[g.nome] || [];
        if (!sel.length) { toast('warn', `Escolha: ${g.nome}`); return; }
      }
    }
    const acDesc = _buildAcougueDesc();
    const gruposDesc  = _buildGruposDesc(i);
    const gruposExtra = _calcGruposExtra(i);
    const fullDesc = [acDesc, gruposDesc, obsComIngr].filter(Boolean).join(' · ');
    if (fullDesc) cartObs = fullDesc;
    cartPrice = (cartPrice + gruposExtra) * (totalPesoSel / 1000) * _imQty;
    const existing2 = cart.find(c => c.name === cartName && (c.obs||'') === (cartObs||''));
    if (existing2) existing2.qty += 1;
    else cart.push({ ...i, name: cartName, price: cartPrice, obs: cartObs, emoji: cartEmoji, image_url: cartImg, qty: 1 });
    _xsellSelected.clear();
    closeItemModal();
    updateCartFloat();
    const totalKg = totalPesoSel >= 1000
      ? (totalPesoSel/1000).toFixed(1).replace('.',',') + ' kg'
      : totalPesoSel + 'g';
    toast('meat', `${i.name} — ${totalKg} adicionado!`);
    return;
  }

  // ── Kit: monta descrição com todos os itens do kit ──
  // Guarda a seleção estruturada (não só o texto) — é isso que permite o
  // gestor reabrir a tela de seleção depois pra editar/cancelar um corte
  // específico, em vez de só ver um texto solto no pedido.
  let _kitSelecaoParaPedido = null;
  if (_isKitItem(i)) {
    const groups = i.custom_groups || [];
    const _kitCatsGrp = groups.find(g => g.tipo === 'kit_categorias');
    if (_kitCatsGrp?.categorias?.length) {
      // Kit montável: cliente escolheu os cortes na tela — preço real, somado
      // por peso (kg) ou por unidade, dependendo do tipo de cada item.
      const escolhidos = Object.entries(_kitMontavelSel || {}).filter(([, valor]) => valor > 0);
      if (!escolhidos.length) {
        toast('warn', 'Escolha ao menos um corte para montar o kit!');
        return;
      }
      let precoTotal = 0;
      const partesDesc = escolhidos.map(([idStr, valor]) => {
        const itCorte = (typeof allItems !== 'undefined' ? allItems : []).find(x => x.id === parseInt(idStr));
        if (!itCorte) return null;
        const isUnidade = (typeof _kitMontavelEhUnidade === 'function') ? _kitMontavelEhUnidade(itCorte) : (itCorte.item_type !== 'kg');
        precoTotal += isUnidade ? (valor * parseFloat(itCorte.price || 0)) : ((valor / 1000) * parseFloat(itCorte.price || 0));
        const label = isUnidade ? `${valor} un` : (valor >= 1000 ? (valor / 1000).toFixed(1).replace('.', ',') + 'kg' : valor + 'g');
        // Corte/preparo escolhidos pra ESSA carne específica (ex: "Bife fino",
        // "Grelhar") — só existe quando o item tem esses grupos cadastrados.
        const extras = (typeof _kitMontavelExtras !== 'undefined' && (_kitMontavelExtras[idStr] || _kitMontavelExtras[parseInt(idStr)])) || null;
        const extrasTxt = extras && Object.values(extras).length ? ` (${Object.values(extras).join(', ')})` : '';
        return `${label} ${itCorte.name}${extrasTxt}`;
      }).filter(Boolean);
      cartObs = ['Kit: ' + partesDesc.join(' · '), cartObs].filter(Boolean).join(' | ');
      cartPrice = precoTotal;
      _kitSelecaoParaPedido = {
        categorias: _kitCatsGrp.categorias,
        itens: escolhidos.map(([idStr, valor]) => ({
          itemId: parseInt(idStr),
          valor,
          extras: (_kitMontavelExtras[idStr] || _kitMontavelExtras[parseInt(idStr)]) || {}
        }))
      };
    } else {
      const _kitGrp = groups.find(g => g.tipo === 'kit_itens');
      if (_kitGrp?.itens?.length) {
        const _kitDesc = 'Kit: ' + _kitGrp.itens.join(' · ');
        cartObs = [_kitDesc, cartObs].filter(Boolean).join(' | ');
      }
    }
    // Chips informativos do kit (preparo/ocasião/armazenamento) — antes
    // ficavam só na tela como visualização e não chegavam na comanda.
    // Agora vão pro obs como seções nomeadas pra o açougueiro saber.
    const _infoChips = [
      { tipo: 'preparos',     label: 'Forma de preparo' },
      { tipo: 'ocasiao',      label: 'Tipo de ocasião' },
      { tipo: 'armazenamento',label: 'Armazenamento' },
    ];
    for (const info of _infoChips) {
      const grp = groups.find(g => g.tipo === info.tipo);
      const opcoes = grp?.opcoes || [];
      if (!opcoes.length) continue;
      const valores = opcoes.map(o => o.nome || o.id).filter(Boolean).join(', ');
      if (valores) {
        cartObs = [`${info.label}: ${valores}`, cartObs].filter(Boolean).join(' | ');
      }
    }
  }

  // Grupos: add description and extra price
  const gruposDesc  = _buildGruposDesc(i);
  const gruposExtra = _calcGruposExtra(i);
  if (gruposDesc) cartObs = [gruposDesc, cartObs].filter(Boolean).join(' | ');
  cartPrice = cartPrice + gruposExtra;

  const cartItem = {
    ...i,
    name:      cartName,
    price:     cartPrice,
    obs:       cartObs,
    emoji:     cartEmoji,
    image_url: cartImg,
    _grupos:   JSON.parse(JSON.stringify(_imGruposState)),
    ...(_kitSelecaoParaPedido ? { _kitSelecao: _kitSelecaoParaPedido } : {}),
  };

  const existing = cart.find(c => c.name === cartName && (c.obs||'') === (cartObs||''));
  if (existing) existing.qty += _imQty;
  else cart.push({ ...cartItem, qty: _imQty });

  // Add cross-sell items
  for (const xid of _xsellSelected) {
    const xi = allItems.find(x => x.id === xid);
    if (!xi) continue;
    const xexist = cart.find(c => c.id === xi.id && !c.obs);
    if (xexist) xexist.qty += 1;
    else cart.push({ ...xi, qty: 1, obs: '' });
  }
  _xsellSelected.clear();

  closeItemModal();
  updateCartFloat();
  toast('cart', `${isPizza && _halfItem && !_isWholeFlavorSelected() ? 'Pizza meio a meio' : i.name} adicionado!`);
}

// ── cardapio-checkout.js ──────────────────────────────────────────
// ══════════════════════════════════════════
//  CHECKOUT — submitOrder, PIX, cartão MP, troco, WhatsApp
//  Estima Food — Cardápio
// ══════════════════════════════════════════

const _checkoutScriptLoads = {};

function _loadCheckoutScript(src, globalName) {
  if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
  if (_checkoutScriptLoads[src]) return _checkoutScriptLoads[src];

  _checkoutScriptLoads[src] = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    const done = () => resolve(globalName ? window[globalName] : true);
    const fail = () => {
      delete _checkoutScriptLoads[src];
      reject(new Error('Falha ao carregar recurso de pagamento.'));
    };

    if (existing) {
      if (!globalName || window[globalName]) return done();
      existing.addEventListener('load', done, { once: true });
      existing.addEventListener('error', fail, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = done;
    script.onerror = fail;
    document.head.appendChild(script);
  });

  return _checkoutScriptLoads[src];
}

async function _ensureQRCodeLib() {
  await _loadCheckoutScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js', 'QRCode');
  if (!window.QRCode) throw new Error('QR Code indisponivel.');
  return window.QRCode;
}

async function _ensureMercadoPagoLib() {
  await _loadCheckoutScript('https://sdk.mercadopago.com/js/v2', 'MercadoPago');
  if (!window.MercadoPago) throw new Error('Mercado Pago indisponivel.');
  return window.MercadoPago;
}
// ══════════════════════════════════════════
//  WHATSAPP — gera link com mensagem pré-pronta
// ══════════════════════════════════════════
function normalizeWaNumero(numero) {
  let n = String(numero || '').replace(/\D/g, '');
  if (!n) return '';
  if (n.length <= 11) n = '55' + n;
  return n;
}

async function ensureWaNumero() {
  const current = normalizeWaNumero(_waNumero);
  if (current) {
    _waNumero = current;
    return current;
  }
  if (!_tenantId || !sb?.from) return '';
  try {
    const { data } = await sb.from('store_config').select('store_whatsapp').single();
    const cfg = Array.isArray(data) ? data[0] : data;
    const found = normalizeWaNumero(cfg?.store_whatsapp);
    if (found) _waNumero = found;
    return found;
  } catch(e) {
    return '';
  }
}

function buildWaLink(orderId, orderNum, numeroOverride) {
  const num = orderNum ? String(orderNum).padStart(3, '0') : '';
  const msg = num ? `Acompanhar pedido *#${num}*` : 'Quero acompanhar meu pedido';
  const numero = normalizeWaNumero(numeroOverride || _waNumero);
  if (!numero) return null;
  _waNumero = numero;
  return `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
}

function buildWaProofLink(orderId, orderNum, numeroOverride) {
  const num = orderNum ? String(orderNum).padStart(3, '0') : '';
  const msg = num
    ? `Ola, segue o comprovante do PIX manual do pedido *#${num}*.`
    : 'Ola, segue o comprovante do PIX manual do meu pedido.';
  const numero = normalizeWaNumero(numeroOverride || _waNumero);
  if (!numero) return null;
  _waNumero = numero;
  return `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
}

async function resolveOrderWaLinks(order) {
  let numero = normalizeWaNumero(_waNumero);
  if (!numero) numero = await ensureWaNumero();
  return {
    waLink: buildWaLink(order.id, order.order_num, numero),
    proofWaLink: buildWaProofLink(order.id, order.order_num, numero)
  };
}

function configureSuccessWaButton(order, waLink) {
  const waBtnEl  = document.getElementById('success-wa-btn');
  const waLblEl  = document.getElementById('success-wa-label');
  const waHintEl = document.getElementById('success-wa-hint');
  const numFormatado = order.order_num ? '#' + String(order.order_num).padStart(3,'0') : '';
  if (!waBtnEl) return;

  if (waLink) {
    waBtnEl.classList.remove('success-wa-btn-hidden');
    waBtnEl.classList.add('show');
    waBtnEl.href = waLink;
    if (waLblEl)  waLblEl.textContent = numFormatado ? `Acompanhar pedido ${numFormatado} pelo WhatsApp` : 'Acompanhar pelo WhatsApp';
    if (waHintEl) waHintEl.style.display = 'block';
    return;
  }

  waBtnEl.classList.add('success-wa-btn-hidden');
  waBtnEl.classList.remove('show');
  waBtnEl.href = '#';
  if (waHintEl) waHintEl.style.display = 'none';
}

async function renderSuccessWaButton(order) {
  let waLink = buildWaLink(order.id, order.order_num);
  configureSuccessWaButton(order, waLink);
  if (!waLink) {
    const numero = await ensureWaNumero();
    waLink = buildWaLink(order.id, order.order_num, numero);
    configureSuccessWaButton(order, waLink);
  }
  return waLink;
}

function showWaToast(orderId, orderNum) {
  if (!_waNumero) return;
  const link = buildWaLink(orderId, orderNum);
  if (!link) return;
  const num  = orderNum ? String(orderNum).padStart(3,'0') : '';
  const pedidoTxt = num ? `Pedido <strong style="color:#fff">#${num}</strong> confirmado!` : 'Seu pedido esta aguardando pagamento.';

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
        ${pedidoTxt} Toque para receber atualizações em tempo real.
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
function _orderRequestStorageKey() {
  return 'ef_pending_order_req_' + (_tenantId || 'global');
}

function _newOrderRequestId() {
  try {
    if (window.crypto?.randomUUID) return 'ord_' + window.crypto.randomUUID();
  } catch(e) {}
  return 'ord_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
}

function _getOrderRequestId(signature) {
  const key = _orderRequestStorageKey();
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (saved?.id && saved?.signature === signature) return saved.id;
    const id = _newOrderRequestId();
    sessionStorage.setItem(key, JSON.stringify({ id, signature, ts: Date.now() }));
    return id;
  } catch(e) {
    return _newOrderRequestId();
  }
}

function _clearOrderRequestId() {
  try { sessionStorage.removeItem(_orderRequestStorageKey()); } catch(e) {}
}

function _buildOrderRequestSignature(data) {
  try {
    return JSON.stringify(data);
  } catch(e) {
    return String(Date.now());
  }
}

function _restoreConfirmButton() {
  const btn = document.getElementById('confirm-btn');
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg> Confirmar Pedido';
}

// Celebração de tela cheia pra pedidos confirmados na hora (dinheiro,
// cartão/pix na entrega) — PIX online e cartão MP já têm a própria
// celebração ligada à confirmação real do pagamento, essa aqui não mexe
// nelas. Autocontida: não depende do carrinho estar aberto ou fechado.
function _celebrarPedidoConfirmado() {
  const el = document.getElementById('order-celebrate');
  if (!el) return;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1700);
}

function _orderPayAmount(order) {
  return (parseFloat(order?.total || 0) || 0) + (parseFloat(order?.taxa || 0) || 0);
}

function _openPostOrderChat(order, payload, openChat = true) {
  payload = payload || {};
  if (typeof efChatShowOrderCreated === 'function') {
    efChatShowOrderCreated({
      orderId: order.id,
      orderNum: order.order_num,
      phone: order.phone || document.getElementById('f-phone')?.value || '',
      client: order.client || document.getElementById('f-name')?.value || '',
      storeName: _storeName,
      waLink: payload.waLink || ''
    }, { open: openChat });
  } else if (typeof efChatStart === 'function') {
    efChatStart({
      orderId: order.id,
      orderNum: order.order_num,
      phone: order.phone || document.getElementById('f-phone')?.value || '',
      client: order.client || document.getElementById('f-name')?.value || '',
      storeName: _storeName
    }, { open: openChat });
  }
}

function _emitPixPaymentToChat(order, extra) {
  if (typeof efChatShowPayment !== 'function') return;
  extra = extra || {};
  const amount = _orderPayAmount(order);
  efChatShowPayment(Object.assign({
    orderId: order.id,
    orderNum: order.order_num,
    phone: order.phone || document.getElementById('f-phone')?.value || '',
    client: order.client || document.getElementById('f-name')?.value || '',
    storeName: _storeName,
    amount,
    amountText: 'R$ ' + fmt(amount),
    pix_key: _pixKeyManual || '',
    pix_key_tipo: _pixKeyManualTipo || '',
    bank: _pixKeyManualBanco || '',
    waLink: buildWaLink(order.id, order.order_num),
    proofWaLink: buildWaProofLink(order.id, order.order_num)
  }, extra));
}

async function submitOrder() {
  const name  = document.getElementById('f-name').value.trim();
  const phone = document.getElementById('f-phone').value.trim();
  if (!name)  { toast('⚠️','Informe seu nome');      return; }
  if (!phone) { toast('⚠️','Informe seu WhatsApp');  return; }
  if (!cart.length) { toast('⚠️','Carrinho vazio');  return; }
  // Loja fechada bloqueia normalmente — mas libera se o cliente confirmou
  // um pedido agendado no modal de loja fechada (_pedidoAgendadoPara setado).
  { const _pedidoAgendadoSeguro = (typeof _pedidoAgendadoPara !== 'undefined') ? _pedidoAgendadoPara : null;
    if (!_lojaAberta && !_pedidoAgendadoSeguro) { toast('🔴','Loja fechada');     return; } }
  // Sem isso, cancelar a modal de troco (dinheiro) ou a modal "pagar agora/
  // na entrega" (crédito/débito) zera selectedPay, e o pedido seguia sem
  // forma de pagamento nenhuma — imprimia "Forma de Pagamento: -" na comanda.
  if (!selectedPay) { toast('⚠️','Escolha uma forma de pagamento'); return; }

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
    let bairro = document.getElementById('f-bairro').value.trim();
    const compl  = document.getElementById('f-compl').value.trim();
    const refEl  = document.getElementById('f-referencia');
    const referencia = refEl ? refEl.value.trim() : '';
    if (!referencia) { toast('⚠️','Informe um ponto de referência'); if (refEl) refEl.focus(); return; }
    // Valida bairro / distância antes de montar o endereço
    if (typeof validarDelivery === 'function') {
      const v = validarDelivery();
      if (!v.ok) { toast('⚠️', v.motivo); return; }
    }
    // Se o bairro digitado bateu com a lista por fuzzy match, salva o nome
    // canônico (correto) no pedido em vez do que o cliente digitou. Assim o
    // gestor sempre vê "Aldeota" no pedido, mesmo se o cliente digitou "Aldoeta".
    if (typeof feeConfig !== 'undefined' && feeConfig?.tipo === 'por_bairro' && typeof _matchBairro === 'function') {
      const matchCanon = _matchBairro(bairro, feeConfig.bairros || []);
      if (matchCanon?.bairro && matchCanon.bairro.trim()) bairro = matchCanon.bairro.trim();
    }
    addr = [rua, num, bairro, compl, 'Ref: ' + referencia].filter(Boolean).join(', ');
    saveDeliveryAddr();
  } else if (deliveryType === 'mesa') {
    const m = document.getElementById('f-mesa').value.trim();
    if (!m) { toast('⚠️','Informe o número da mesa'); return; }
    addr = 'Mesa ' + m;
  } else {
    addr = (typeof _getSelectedPickupAddr === 'function') ? _getSelectedPickupAddr() : 'Retirada no balcão';
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

  const items = cart.map(i => ({
    id: i.id || null,
    qty: i.qty,
    name: i.name,
    price: i.price,
    cat: i.cat || '',
    cat_key: i.cat_key || i.catKey || i.cat || '',
    obs: i.obs||''
  }));
  const time  = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  // Total bruto (o que o cliente efetivamente paga — já considera cashback e cupom)
  const _grossTotal = displayTotal();
  const _cbDesconto = getCashbackDesconto();
  const _totalSemCashback = Math.max(0, cartSubtotal() - getDiscount());
  const _clientRequestId = _getOrderRequestId(_buildOrderRequestSignature({
    tenant_id: _tenantId,
    client: name,
    phone,
    addr,
    deliveryType,
    selectedPay,
    pag: selectedPay === 'pix' && !_pixAtivoGestor ? 'pix_manual' : selectedPay,
    items,
    total: grandTotal(),
    taxa: getTaxa(),
    troco: troco || null,
    cupom: appliedCupom?.code || '',
    cashback: _cbUsar ? _cbDesconto : 0
  }));

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
        if (typeof _saveCustomerSession === 'function') _saveCustomerSession(_customer);
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

    // ── Consume do cupom (decrementa uses_left atomicamente no servidor) ──
    // Anti-fraude: revalida o cupom no servidor e consome 1 uso antes de criar
    // o pedido. Se o cupom expirou ou esgotou no meio do checkout, rejeita.
    if (typeof appliedCupom !== 'undefined' && appliedCupom && appliedCupom.code) {
      try {
        const r = await fetch('/api/cupom/validar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': _tenantId },
          body: JSON.stringify({ code: appliedCupom.code, subtotal: cartSubtotal(), consume: true })
        });
        const d = await r.json();
        if (!d.ok) {
          alert('❌ Cupom inválido: ' + (d.error || 'Cupom não pode mais ser usado.') + '\n\nRemova o cupom e tente novamente.');
          throw new Error('Cupom inválido: ' + (d.error || ''));
        }
      } catch(e) {
        if (String(e.message).startsWith('Cupom inválido')) throw e;
        // Erro de rede: prossegue sem bloquear (cupom já foi validado quando aplicou)
        console.warn('[cupom] consume falhou na rede, prossegue:', e.message);
      }
    }

    const { data: order, error } = await sb.from('orders').insert({
      tenant_id: _tenantId,
      client_request_id: _clientRequestId,
      // Marca a origem como cardápio público — backend usa isso pra recusar
      // o pedido se a loja estiver fechada (validação server-side; não é
      // coluna real, é descartada antes do INSERT). Ver server.js.
      origem_pedido: 'cardapio_publico',
      // Canal do pedido — diferente de origem_pedido (que só serve pra
      // validação no servidor e nunca é salvo). Esse aqui é salvo de
      // verdade, pra o gestor ver de onde veio o pedido no Kanban (ex:
      // veio do tablet fixo na mesa, não do cardápio normal do celular).
      ...(typeof window._canalPedido !== 'undefined' && window._canalPedido ? { canal: window._canalPedido } : {}),
      // Pedido agendado (loja fechada, cliente confirmou no modal de
      // agendamento) — servidor só aceita pedido com loja fechada quando
      // esse campo vem preenchido. Ver isLojaAbertaServer() em server.js.
      ...(_pedidoAgendadoPara ? { scheduled_for: _pedidoAgendadoPara.toISOString() } : {}),
      client: name, phone, addr,
      items, total: grandTotal(), taxa: getTaxa(),
      status: selectedPay === 'pix' ? 'aguardando_pix'
            : selectedPay === 'cartao_mp' ? 'aguardando_cartao'
            : 'analise',
      time,
      // Fallback de segurança: mesmo com as validações acima, nunca grava
      // pag vazio — se por algum motivo selectedPay chegar aqui sem valor,
      // assume dinheiro em vez de deixar a comanda sem forma de pagamento.
      pag: selectedPay === 'pix' && !_pixAtivoGestor ? 'pix_manual' : (selectedPay || 'dinheiro'),
      pag_momento: (selectedPay === 'cartao_mp') ? 'online'
                 : (selectedPay === 'pix')       ? 'online'
                 : (selectedPay === 'credito' || selectedPay === 'debito') ? 'entrega'
                 : 'entrega',
      troco: troco || null,
      customer_id: customerId
    }).select().single();

    if (error) throw error;

    // Celebração imediata só pra formas de pagamento já confirmadas na hora
    // (dinheiro/crédito/débito na entrega). PIX e cartão online têm sua
    // própria celebração, disparada quando o pagamento é confirmado de
    // verdade — não quando o pedido é só criado.
    if (selectedPay !== 'pix' && selectedPay !== 'cartao_mp') {
      _celebrarPedidoConfirmado();
    }

    // ── Debitar cashback se cliente usou ──────────────
    if (_cbUsar && _cbSaldo > 0 && _cbDesconto > 0) {
      try {
        const tid = _tenantId || '';
        const cbResp = await fetch('/api/cashback/usar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
          body: JSON.stringify({ phone: phone.replace(/\D/g,''), valor: _cbDesconto })
        });
        const cbData = await cbResp.json().catch(() => ({}));
        if (!cbResp.ok || !cbData.ok) throw new Error(cbData.error || 'Cashback nao aplicado');
      } catch(e) {
        try {
          await sb.from('orders').update({ total: _totalSemCashback }).eq('id', order.id);
          order.total = _totalSemCashback;
        } catch(_) {}
        toast('⚠️','Cashback não pôde ser debitado. O pedido seguirá sem esse desconto.');
      }
      _resetCashbackUI();
    }

    // ── Registrar uso do carimbinho se aplicado ──────
    if (_stampElegivel && _stampUsado) {
      try {
        const tid = _tenantId || '';
        await fetch('/api/stamp/usar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
          body: JSON.stringify({ phone: phone.replace(/\D/g,'') })
        });
      } catch(e) {}
      _stampElegivel = false; _stampUsado = false;
    }

    cart = [];
    appliedCupom = null;
    _pendingOrderAddr = '';
    _pedidoAgendadoPara = null; // reseta pra não marcar um próximo pedido como agendado por engano
    updateCartFloat();
    if (typeof applyStatus === 'function') applyStatus(); // atualiza texto/estado do botão de confirmar
    document.getElementById('cupom-input').value = '';
    document.getElementById('cupom-msg').innerHTML = '';

    // ── Tela de sucesso ──
    const waLinks = await resolveOrderWaLinks(order);
    const waLink = waLinks.waLink;
    const usarTelaPagamento = selectedPay === 'cartao_mp';
    document.getElementById('cart-content').style.display = usarTelaPagamento ? 'none' : '';
    document.getElementById('success-screen').classList.toggle('on', usarTelaPagamento);
    const numFormatado = order.order_num ? '#' + String(order.order_num).padStart(3,'0') : 'Aguardando pagamento';
    window._lastOrderNum = order.order_num; // para o modal de avaliação
    document.getElementById('success-num').textContent = numFormatado;
    if (!usarTelaPagamento) {
      closeCart();
      _restoreConfirmButton();
    }
    // ── Cartão de Crédito MP ──
    // Mostra o formulário de pagamento ANTES do chat de acompanhamento, pra
    // não competir pela atenção do cliente enquanto ele ainda não pagou.
    if (selectedPay === 'cartao_mp') {
      await _iniciarFluxoCartao(order);
    }

    _openPostOrderChat(order, waLinks, selectedPay !== 'cartao_mp');

    // PIX manual precisa aparecer imediatamente; WhatsApp/rastreio podem esperar.
    let pixFlowPromise = null;
    if (selectedPay === 'pix') {
      pixFlowPromise = _iniciarFluxoPix(order).catch(e => console.error('_iniciarFluxoPix:', e));
    }

    // Botão WhatsApp — aparece sempre que houver número configurado
    if (usarTelaPagamento) configureSuccessWaButton(order, waLink);

    // Convite de cadastro para não-logados
    const inv = document.getElementById('invite-signup');
    if (inv && !_customer) inv.style.display = usarTelaPagamento ? 'flex' : 'none';

    startTracking(order.id, items, name, addr, order.status, order.order_num, {
      total: order.total,
      taxa: order.taxa,
      pag: order.pag,
      troco: order.troco,
      scheduled_for: order.scheduled_for || null
    });
    // ── PIX: gera QR Code MP ou exibe chave manual ──
    if (pixFlowPromise) await pixFlowPromise;

    // 1. Salva no localStorage (celular próprio)
    try {
      localStorage.setItem('ef_order_' + (_tenantId||''), JSON.stringify({
        orderId: order.id, orderNum: order.order_num, items, client: name, phone, total: order.total, taxa: order.taxa, pag: order.pag, troco: order.troco, ts: Date.now()
      }));
    } catch(e) {}
    // 2. Coloca ?acompanhar=ID na URL (compartilhável)
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('acompanhar', order.id);
      window.history.replaceState({}, '', u.toString());
    } catch(e) {}
    _clearOrderRequestId();

    if (!usarTelaPagamento && !window.efChatShowOrderCreated && _tenantPlano === 'premium') {
      showWaToast(order.id, order.order_num);
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
function _setPixPagoConfirmado(confirmado) {
  const wrap    = document.getElementById('pix-qr-wrap');
  const waiting = document.getElementById('pix-waiting-wrap');
  const paid    = document.getElementById('pix-paid-wrap');
  const lbl     = document.getElementById('pix-status-label');

  if (wrap) wrap.classList.toggle('pix-paid', !!confirmado);
  if (waiting) waiting.style.display = confirmado ? 'none' : '';
  if (paid) paid.style.display = confirmado ? 'flex' : 'none';
  if (lbl) {
    lbl.style.display = confirmado ? 'none' : '';
    if (!confirmado) lbl.textContent = '⏳ Aguardando pagamento...';
  }
}
function _mostrarPixGerandoQRCode() {
  const wrap = document.getElementById('pix-qr-wrap');
  const qrEl = document.getElementById('pix-qr-img');
  const codeActions = document.getElementById('pix-code-actions');
  const codeInput = document.getElementById('pix-copy-code');
  const lbl = document.getElementById('pix-status-label');

  if (wrap) wrap.style.display = '';
  _setPixPagoConfirmado(false);
  if (qrEl) {
    qrEl.innerHTML = '<div class="pix-qr-loading"><div class="spin"></div><span>Gerando QR Code PIX...</span></div>';
  }
  if (codeActions) codeActions.style.display = 'none';
  if (codeInput) codeInput.value = '';
  if (lbl) lbl.textContent = 'Gerando QR Code PIX...';
}
async function _renderPixQRCode(pd) {
  const qrEl = document.getElementById('pix-qr-img');
  if (!qrEl) return;
  qrEl.innerHTML = '';

  if (pd?.qr_code_base64) {
    const qrB64 = String(pd.qr_code_base64 || '').replace(/[\r\n\s"]/g, '');
    const qrSrc = qrB64.startsWith('data:image/') ? qrB64 : `data:image/png;base64,${qrB64}`;
    qrEl.innerHTML = `<img src="${qrSrc}" alt="QR Code PIX">`;
  } else {
    const QRCodeLib = await _ensureQRCodeLib();
    new QRCodeLib(qrEl, { text: pd.qr_code, width: 180, height: 180, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCodeLib.CorrectLevel.M });
  }

  const codeInput = document.getElementById('pix-copy-code');
  const codeActions = document.getElementById('pix-code-actions');
  const lbl = document.getElementById('pix-status-label');
  if (codeInput) codeInput.value = pd.qr_code || '';
  if (codeActions) codeActions.style.display = 'flex';
  if (lbl) lbl.textContent = '⏳ Aguardando pagamento...';
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
      if (d.status === 'aprovado') {
        _setPixPagoConfirmado(true);
        if (typeof efChatUpdatePayment === 'function') {
          efChatUpdatePayment({ orderId, status: 'paid' });
        }
        _stopPixPoll();
        try {
          await fetch('/api/pix/vincular', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-tenant-id': _tenantId },
            body: JSON.stringify({ mp_payment_id: mpId, order_id: orderId })
          });
        } catch(e) {}
      } else if (d.status === 'rejeitado' || d.status === 'cancelado') {
        _setPixPagoConfirmado(false);
        if (lbl) lbl.textContent = '❌ Pagamento não realizado. Tente outra forma.';
        if (typeof efChatUpdatePayment === 'function') {
          efChatUpdatePayment({ orderId, status: d.status === 'cancelado' ? 'cancelado' : 'failed' });
        }
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
  _setPixPagoConfirmado(false);
  const errWrap = document.getElementById('pix-error-wrap');
  if (errWrap) errWrap.style.display = 'none';

  const _showPixManual = () => {
    document.getElementById('pix-qr-wrap').style.display = 'none';
    const errWrap = document.getElementById('pix-error-wrap');
    if (errWrap) errWrap.style.display = 'none';
    document.getElementById('pix-manual-success-wrap').style.display = '';
    document.getElementById('pix-manual-key-show').value             = _pixKeyManual;
    document.getElementById('pix-manual-banco-lbl').textContent      = _pixKeyManualBanco ? `🏦 ${_pixKeyManualBanco}` : '';
    document.getElementById('pix-manual-valor-show').textContent     = 'R$ ' + fmt(parseFloat(order.total) + parseFloat(order.taxa || 0));
    _emitPixPaymentToChat(order, { mode: 'manual', status: 'waiting' });
  };

  // Mostra fallback: se tem chave manual configurada, usa ela; senão, mostra bloco de erro com retry
  const _marcarPixManualFallback = async () => {
    if (!order?.id || order.pag === 'pix_manual') return;
    try {
      const { error } = await sb.from('orders').update({ pag: 'pix_manual' }).eq('id', order.id);
      if (!error) order.pag = 'pix_manual';
      else console.warn('[pix] fallback manual nao sincronizado:', error.message || error);
    } catch(e) {
      console.warn('[pix] fallback manual nao sincronizado:', e.message || e);
    }
  };

  const _showFallback = async (msg) => {
    if (_pixKeyManual) {
      _showPixManual();
      _marcarPixManualFallback();
      return;
      document.getElementById('pix-manual-banco-lbl').textContent      = _pixKeyManualBanco ? `🏦 ${_pixKeyManualBanco}` : '';
    }
    if (errWrap) {
      document.getElementById('pix-qr-wrap').style.display = 'none';
      errWrap.style.display = '';
      const msgEl = document.getElementById('pix-error-msg');
      if (msgEl) msgEl.textContent = msg || 'Verifique sua conexão e tente novamente.';
      const btn = document.getElementById('pix-retry-btn');
      if (btn) btn.onclick = () => _iniciarFluxoPix(order);
      _emitPixPaymentToChat(order, { mode: 'online', status: 'failed', pix_key: '' });
    } else {
      sec.style.display = 'none';
      _emitPixPaymentToChat(order, { mode: 'online', status: 'failed', pix_key: '' });
      toast('❌', msg || 'Erro ao gerar PIX. Entre em contato com o restaurante.');
    }
  };

  try {
    if (!_pixAtivoGestor) {
      // PIX MP não está ativo — usa só chave manual (se configurada)
      if (_pixKeyManual) {
        _showPixManual();
        return;
        document.getElementById('pix-manual-success-wrap').style.display = '';
        document.getElementById('pix-manual-key-show').value             = _pixKeyManual;
        document.getElementById('pix-manual-banco-lbl').textContent      = _pixKeyManualBanco ? `🏦 ${_pixKeyManualBanco}` : '';
        document.getElementById('pix-manual-valor-show').textContent     = 'R$ ' + fmt(parseFloat(order.total) + parseFloat(order.taxa || 0));
      } else { sec.style.display = 'none'; }
      return;
    }
    _emitPixPaymentToChat(order, { mode: 'online', status: 'loading', pix_key: '' });
    _mostrarPixGerandoQRCode();
    const pr = await fetch('/api/pix/criar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': _tenantId },
      body: JSON.stringify({ valor: parseFloat(order.total) + parseFloat(order.taxa || 0), order_id: order.id, client: order.client, phone: order.phone })
    });
    const pd = await pr.json().catch(() => null);
    if (!pr.ok) {
      const msg = pd?.error ? `Erro: ${pd.error}` : `Erro do servidor (${pr.status}).`;
      console.error('[pix/criar]', pr.status, pd);
      await _showFallback(msg);
      return;
    }
    if (pd?.qr_code) {
      document.getElementById('pix-qr-wrap').style.display = '';
      _setPixPagoConfirmado(false);
      await _renderPixQRCode(pd);
      _emitPixPaymentToChat(order, {
        mode: 'online',
        status: 'waiting',
        pix_key: '',
        qr_code: pd.qr_code || '',
        qr_code_base64: pd.qr_code_base64 || '',
        mp_payment_id: pd.mp_payment_id || ''
      });
      _startPixPoll(pd.mp_payment_id, order.id);
      return;
    }
    // Resposta OK mas sem qr_code (caso raro)
    await _showFallback('Resposta inesperada do servidor. Tente novamente.');
  } catch(e) {
    console.error('_iniciarFluxoPix:', e);
    await _showFallback('Sem conexão com o servidor. Verifique sua internet.');
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
  // Loja fechada bloqueia normalmente — mas libera se o cliente confirmou
  // um pedido agendado no modal de loja fechada (_pedidoAgendadoPara setado).
  { const _pedidoAgendadoSeguro = (typeof _pedidoAgendadoPara !== 'undefined') ? _pedidoAgendadoPara : null;
    if (!_lojaAberta && !_pedidoAgendadoSeguro) { toast('🔴','Loja fechada');     return; } }
  if (!selectedPay) { toast('⚠️','Escolha uma forma de pagamento'); return; }

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
    let bairro = document.getElementById('f-bairro').value.trim();
    const compl  = document.getElementById('f-compl').value.trim();
    const refEl  = document.getElementById('f-referencia');
    const referencia = refEl ? refEl.value.trim() : '';
    if (!referencia) { toast('⚠️','Informe um ponto de referência'); if (refEl) refEl.focus(); return; }
    // Valida bairro / distância antes de montar o endereço
    if (typeof validarDelivery === 'function') {
      const v = validarDelivery();
      if (!v.ok) { toast('⚠️', v.motivo); return; }
    }
    // Se o bairro digitado bateu com a lista por fuzzy match, salva o nome
    // canônico (correto) no pedido em vez do que o cliente digitou. Assim o
    // gestor sempre vê "Aldeota" no pedido, mesmo se o cliente digitou "Aldoeta".
    if (typeof feeConfig !== 'undefined' && feeConfig?.tipo === 'por_bairro' && typeof _matchBairro === 'function') {
      const matchCanon = _matchBairro(bairro, feeConfig.bairros || []);
      if (matchCanon?.bairro && matchCanon.bairro.trim()) bairro = matchCanon.bairro.trim();
    }
    addr = [rua, num, bairro, compl, 'Ref: ' + referencia].filter(Boolean).join(', ');
    saveDeliveryAddr();
  } else if (deliveryType === 'mesa') {
    const m = document.getElementById('f-mesa').value.trim();
    if (!m) { toast('⚠️','Informe o número da mesa'); return; }
    addr = 'Mesa ' + m;
  } else {
    addr = (typeof _getSelectedPickupAddr === 'function') ? _getSelectedPickupAddr() : 'Retirada no balcão';
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
    const MercadoPagoLib = await _ensureMercadoPagoLib();
    _mpInstance = new MercadoPagoLib(_mpPublicKey, { locale: 'pt-BR' });
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
      issuer:              { id: 'mp-issuer' },
    },
    callbacks: {
      onFormMounted: (err) => {
        if (err) {
          console.warn('[MP] CardForm mount error:', err);
          if (_erro) {
            _erro.textContent = 'Não foi possível carregar o formulário de pagamento. Tente novamente em instantes.';
            _erro.style.display = '';
          }
        }
      },
      // O MP exige o campo "issuer" (banco emissor) preenchido pra tokenizar.
      // Na maioria dos cartões só existe 1 opção — seleciona automaticamente
      // assim que o SDK identifica a bandeira, sem precisar o cliente escolher.
      onIssuersReceived: (err, issuers) => {
        if (err || !issuers?.length) {
          console.warn('[MP] onIssuersReceived erro/vazio:', err, issuers);
          return;
        }
        const sel = document.getElementById('mp-issuer');
        if (!sel) return;
        sel.innerHTML = issuers.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
        sel.value = issuers[0].id;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
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

          const { token, installments, paymentMethodId, issuerId, identificationType, identificationNumber, cardholderName } = formData;

          if (!token) throw new Error('Não foi possível processar o cartão. Verifique os dados.');

          const order = _cartaoPendingOrder;
          if (!order) throw new Error('Pedido não encontrado. Feche e tente novamente.');

          const res = await fetch('/api/cartao/criar', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-tenant-id': _tenantId },
            body: JSON.stringify({
              card_token:            token,
              payment_method_id:     paymentMethodId,
              issuer_id:             issuerId,
              valor:                 parseFloat(order.total) + parseFloat(order.taxa || 0),
              order_id:              order.id,
              client:                order.client,
              email:                 document.getElementById('mp-cardholderEmail')?.value || 'cliente@estima.app',
              identification_type:   identificationType || 'CPF',
              identification_number: cpf,
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
  try {
    await _initMpCardForm(parseFloat(order.total) + parseFloat(order.taxa || 0));
  } catch(e) {
    console.warn('[cartao] init falhou:', e);
    if (erro) {
      let detalheTxto = '';
      try {
        if (e && e.message) detalheTxto = e.message;
        else if (e && e.name) detalheTxto = e.name;
        else if (e && Array.isArray(e.cause) && e.cause.length) detalheTxto = e.cause.map(c => c.description || c.message || JSON.stringify(c)).join('; ');
        else if (e && typeof e === 'object') detalheTxto = JSON.stringify(e).slice(0, 200);
        else if (e) detalheTxto = String(e);
      } catch(_) {}
      const detalhe = detalheTxto ? ` [${detalheTxto}]` : ' [erro sem detalhe — verifique console]';
      erro.textContent = 'Nao foi possivel carregar o pagamento online. Verifique a internet e tente novamente.' + detalhe;
      erro.style.display = '';
    }
  }
}

function resetCart() {
  _stopPixPoll();
  _resetCashbackUI();
  const ps = document.getElementById('pix-section');
  if (ps) ps.style.display = 'none';
  _setPixPagoConfirmado(false);
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
  if (waBtn) { waBtn.classList.add('success-wa-btn-hidden'); waBtn.classList.remove('show'); waBtn.href = '#'; }
  const waHint = document.getElementById('success-wa-hint');
  if (waHint) waHint.style.display = 'none';
  renderTotals();
  closeCart();
}

// ── cardapio-tracking.js ──────────────────────────────────────────
// ══════════════════════════════════════════
//  TRACKING — Acompanhamento de pedido, cancelamento
//  Estima Food — Cardápio
// ══════════════════════════════════════════
// ══════════════════════════════════════════
//  TRACKER
// ══════════════════════════════════════════
const STEPS = [
  {
    key:   ['aguardando_pix'],
    icon:  '💠',
    title: 'Aguardando pagamento',
    desc:  'Faça o PIX para a chave enviada no WhatsApp. Assim que confirmarmos, seu pedido entra na fila!'
  },
  {
    key:   ['aguardando_cartao'],
    icon:  '💳',
    title: 'Aguardando pagamento',
    desc:  'Conclua o pagamento com cartão para seu pedido entrar na fila!'
  },
  {
    key:   ['analise'],
    icon:  '✓',
    title: 'Pedido recebido!',
    desc:  'Seu pedido foi recebido e está aguardando confirmação'
  },
  {
    key:   ['producao','pronto'],
    icon:  '~',
    title: 'Preparando!',
    desc:  'A cozinha está preparando seu pedido com carinho'
  },
  {
    key:   ['saiu','entregue','finalizado'],
    icon:  '→',
    title: 'Saindo para entrega!',
    desc:  'Seu pedido está a caminho. Logo chegará!'
  },
];
const STATUS_ORDER = ['aguardando_pix','aguardando_cartao','analise','producao','pronto','saiu','entregue','finalizado'];

function stepIndexFor(status) {
  return STEPS.findIndex(s => s.key.includes(status));
}

function notifyTrackUpdate(status, previousStatus) {
  if (!status || status === previousStatus) return;
  try {
    if (typeof window.efPlayNotifySound === 'function') window.efPlayNotifySound('status');
    if (navigator.vibrate) navigator.vibrate(70);
  } catch(e) {}
}

function startTracking(orderId, items, client, addr, initialStatus, orderNum, details) {
  _trackOrderId = orderId;
  _initialOrderStatus = initialStatus || 'analise';
  _trackCurrentStatus = _initialOrderStatus;
  const fab = document.getElementById('track-fab');
  fab.classList.add('show');
  const numLabel = orderNum ? '#' + String(orderNum).padStart(3,'0') : 'Pagamento pendente';
  document.getElementById('track-num').textContent = numLabel;
  if (_trackChannel) { try { sb.removeChannel(_trackChannel); } catch(e){} }
  _trackChannel = sb.channel('orders-rt')
    .on('postgres_changes',{event:'UPDATE',table:'orders'}, p => {
      if (Number(p.new.id) === orderId) {
        const nextStatus = p.new.status || _trackCurrentStatus || _initialOrderStatus;
        const previousStatus = _trackCurrentStatus || _initialOrderStatus;
        updateTracker(nextStatus);
        notifyTrackUpdate(nextStatus, previousStatus);
        _trackCurrentStatus = nextStatus;
        if (p.new.order_num) {
          const novoNum = '#' + String(p.new.order_num).padStart(3,'0');
          document.getElementById('track-num').textContent = novoNum;
          document.getElementById('track-order-num').textContent = 'Pedido ' + novoNum;
        }
        const dot = document.getElementById('track-dot');
        if (dot) dot.classList.toggle('done', ['entregue','finalizado'].includes(p.new.status));
      }
    })
    .subscribe();
  updateTracker(_initialOrderStatus || 'analise', addr);
  renderTrackItems(items, client, { ...(details || {}), addr });
  document.getElementById('track-order-num').textContent = orderNum ? 'Pedido ' + numLabel : 'Pedido aguardando pagamento';
}

function updateTracker(status, addr) {
  const curIdx = stepIndexFor(status);
  const tl     = document.getElementById('track-timeline');
  if (!tl) return;
  const _addr = (addr || '').toLowerCase();
  const isRetirada = _addr.startsWith('retirada') || _addr.startsWith('mesa');
  const steps = STEPS.map((s, i) => {
    if (i === STEPS.length - 1 && isRetirada) return { ...s, title: 'Seu pedido está pronto!', desc: 'Pode vir buscar — seu pedido está pronto para retirada!' };
    return s;
  });
  if (status === 'cancelado') {
    tl.innerHTML = `<div class="tstep"><div class="tstep-left"><div class="tstep-icon" style="background:rgba(239,68,68,.12);border-color:var(--red)">✕</div></div><div class="tstep-content"><div class="tstep-title" style="color:var(--red)">Pedido cancelado</div><div class="tstep-desc">Este pedido foi cancelado.</div></div></div>`;
    const cw = document.getElementById('track-cancel-wrap'); if (cw) cw.style.display = 'none';
    document.getElementById('track-fab')?.classList.remove('show');
    try { localStorage.removeItem('ef_order_' + (_tenantId||'')); } catch(e) {}
    return;
  }
  if (status === 'finalizado') {
    try { localStorage.removeItem('ef_order_' + (_tenantId||'')); } catch(e) {}
    try { const u = new URL(window.location.href); u.searchParams.delete('acompanhar'); window.history.replaceState({}, '', u.toString()); } catch(e) {}
  }
  tl.innerHTML = steps.map((s, i) => {
    const isDone   = i < curIdx;
    const isActive = i === curIdx;
    const isLast   = i === steps.length - 1;
    return `
    <div class="tstep">
      <div class="tstep-left">
        <div class="tstep-icon ${isDone ? 'done' : isActive ? 'active' : ''}">${isDone ? '✓' : s.icon}</div>
        ${!isLast ? `<div class="tstep-line ${isDone ? 'done' : ''}"></div>` : ''}
      </div>
      <div class="tstep-content">
        <div class="tstep-title ${isDone ? 'done' : isActive ? 'active' : ''}">${s.title}</div>
        <div class="tstep-desc">${s.desc}</div>
      </div>
    </div>`;
  }).join('');
  const cancelWrap = document.getElementById('track-cancel-wrap');
  if (cancelWrap) cancelWrap.style.display = ['analise','aguardando_pix','aguardando_cartao'].includes(status) ? '' : 'none';
}

function _trackEsc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function _trackItemPrice(i) {
  const n = Number(i?.price ?? i?.preco ?? i?.valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function _trackItemQty(i) {
  const n = Number(i?.qty ?? i?.quantidade ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function _trackPayLabel(pag) {
  return ({
    dinheiro: 'Dinheiro',
    credito: 'Cartao de credito',
    debito: 'Cartao de debito',
    pix: 'PIX',
    pix_manual: 'PIX',
    cartao_mp: 'Cartao online'
  })[pag] || pag || '';
}

function _trackDeliveryKind(addr) {
  const text = String(addr || '').trim();
  const lower = text.toLowerCase();
  if (/^mesa\b/i.test(text)) return { label: 'No local', detail: text };
  if (/^retirada\b/i.test(text) || lower.includes('balc')) return { label: 'Retirada', detail: text || 'Retirada no balcao' };
  if (text) return { label: 'Entrega', detail: text };
  return { label: 'Retirada', detail: 'Retirada no balcao' };
}

function renderTrackItems(items, client, details) {
  const el = document.getElementById('track-items-list');
  if (!el) return;
  const list = Array.isArray(items) ? items : [];
  const subtotal = list.reduce((s, i) => s + _trackItemPrice(i) * _trackItemQty(i), 0);
  const hasTotal = details && details.total !== undefined && details.total !== null;
  const totalItens = hasTotal ? Number(details.total || 0) : subtotal;
  const taxa = Number(details?.taxa || 0);
  const desconto = Math.max(0, subtotal - totalItens);
  const totalFinal = Math.max(0, totalItens + taxa);
  const entrega = _trackDeliveryKind(details?.addr || '');
  const pag = _trackPayLabel(details?.pag || '');
  const rows = list.map(i => `
    <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;color:var(--muted2)">
      <span>${_trackItemQty(i)}× ${_trackEsc(i.name || i.nome || 'Item')}${i.obs?` <span style="color:var(--muted);font-size:11px">(${_trackEsc(i.obs)})</span>`:''}</span>
      <span>R$ ${fmt(_trackItemPrice(i)*_trackItemQty(i))}</span>
    </div>`).join('');
  el.innerHTML = (rows || '<div style="font-size:12px;color:var(--muted)">Itens do pedido</div>') + `
    ${details?.scheduled_for ? `<div style="margin-top:10px;padding:10px 12px;background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.3);border-radius:10px;font-size:12.5px;color:var(--text);display:flex;align-items:center;gap:6px">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="flex-shrink:0;color:#a78bfa"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 5v3l2 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      <span><strong>Pedido agendado</strong> — vamos preparar assim que abrirmos, por volta de ${new Date(details.scheduled_for).toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}.</span>
    </div>` : ''}
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--muted2)">
      ${subtotal > 0 ? `<div style="display:flex;justify-content:space-between"><span>Subtotal dos itens</span><strong style="color:var(--text)">R$ ${fmt(subtotal)}</strong></div>` : ''}
      ${desconto > 0.009 ? `<div style="display:flex;justify-content:space-between;color:var(--green)"><span>Descontos/Cashback</span><strong>-R$ ${fmt(desconto)}</strong></div>` : ''}
      ${entrega.label === 'Entrega' ? `<div style="display:flex;justify-content:space-between"><span>Taxa de entrega</span><strong style="color:var(--text)">R$ ${fmt(taxa)}</strong></div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:14px;padding-top:4px;border-top:1px solid var(--border)"><span style="font-weight:700;color:var(--text)">Total</span><strong style="color:var(--accent)">R$ ${fmt(totalFinal)}</strong></div>
      <div style="margin-top:6px;line-height:1.45"><strong style="color:var(--text)">${_trackEsc(entrega.label)}:</strong> ${_trackEsc(entrega.detail)}</div>
      ${pag ? `<div><strong style="color:var(--text)">Pagamento:</strong> ${_trackEsc(pag)}</div>` : ''}
    </div>`;
}

function openTracker()  { document.getElementById('track-drawer-bg').classList.add('on'); }
function closeTracker() { document.getElementById('track-drawer-bg').classList.remove('on'); }

async function solicitarCancelamento() {
  if (!_trackOrderId) return;
  if (!confirm('Tem certeza que deseja cancelar este pedido?')) return;
  const btn = document.getElementById('track-cancel-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Cancelando…'; }
  try {
    // Usa endpoint dedicado e seguro (valida ownership e status permitido)
    const headers = { 'Content-Type': 'application/json', 'x-tenant-id': _tenantId };
    try {
      const tk = localStorage.getItem('ef_customer_token_' + (_tenantId||''));
      if (tk) headers['Authorization'] = 'Bearer ' + tk;
    } catch(_) {}
    // Pega o phone do customer logado (fallback pro acesso anônimo via phone do pedido)
    let phoneFallback = '';
    try {
      const rawCustomer = _customer || (typeof _loadCustomerSessionForTenant === 'function' ? _loadCustomerSessionForTenant() : null);
      phoneFallback = (rawCustomer?.phone || '').replace(/\D/g,'');
    } catch(_) {}
    const res = await fetch('/api/customer-cancel-order', {
      method: 'POST',
      headers,
      body: JSON.stringify({ order_id: _trackOrderId, phone: phoneFallback })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro ao cancelar');
    toast('✅', 'Pedido cancelado.');
    updateTracker('cancelado');
    closeTracker();
    try { localStorage.removeItem('ef_order_' + (_tenantId||'')); } catch(e) {}
    try { const u=new URL(window.location.href); u.searchParams.delete('acompanhar'); window.history.replaceState({},'',u.toString()); } catch(e) {}
  } catch(e) {
    toast('❌', e.message || 'Não foi possível cancelar.');
    if (btn) { btn.disabled = false; btn.textContent = '✕ Cancelar pedido'; }
  }
}

// ── Restaura tracker ao recarregar ──
// Prioridade: URL ?acompanhar → localStorage
window.addEventListener('load', () => {
  setTimeout(async () => {
    try {
      const tid = _tenantId;
      if (!tid) return;

      // Tenta URL primeiro
      let orderId = parseInt(new URLSearchParams(window.location.search).get('acompanhar')) || null;

      // Fallback: localStorage
      if (!orderId) {
        const raw = localStorage.getItem('ef_order_' + tid);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.orderId && Date.now() - saved.ts < 4 * 60 * 60 * 1000) {
            orderId = saved.orderId;
          } else {
            localStorage.removeItem('ef_order_' + tid);
          }
        }
      }

      if (!orderId) return;

      // Busca pedido no servidor
      const r = await fetch('/api/orders?id=eq.' + orderId + '&select=id,order_num,client,items,status,addr,total,taxa,pag,troco,scheduled_for', {
        headers: { 'x-tenant-id': tid }
      });
      if (!r.ok) return;
      const rows = await r.json();
      const o = Array.isArray(rows) ? rows[0] : rows;
      if (!o) return;

      // Só mostra se pedido ainda está em andamento
      if (['finalizado','cancelado'].includes(o.status)) {
        localStorage.removeItem('ef_order_' + tid);
        return;
      }

      const items = Array.isArray(o.items) ? o.items
        : (typeof o.items === 'string' ? JSON.parse(o.items||'[]') : []);

      startTracking(o.id, items, o.client || '', o.addr || '', o.status, o.order_num, {
        total: o.total,
        taxa: o.taxa,
        pag: o.pag,
        troco: o.troco,
        scheduled_for: o.scheduled_for || null
      });

      // Sincroniza URL
      try {
        const u = new URL(window.location.href);
        if (!u.searchParams.get('acompanhar')) {
          u.searchParams.set('acompanhar', o.id);
          window.history.replaceState({}, '', u.toString());
        }
      } catch(e) {}

    } catch(e) {}
  }, 1500);
});

// ── cardapio-chat.js ──────────────────────────────────────────
(function(){
  'use strict';

  const CHAT_TTL_MS = 72 * 60 * 60 * 1000;
  const state = {
    tid: '',
    threadId: null,
    orderId: null,
    orderNum: null,
    phone: '',
    client: '',
    thread: null,
    order: null,
    messages: [],
    open: false,
    unread: 0,
    sse: null,
    booting: false,
    ready: false,
    storeName: '',
    quickSelections: {},
    pendingSuggestion: '',
    payment: null,
    follow: null
  };

  let audioCtx = null;
  let soundUnlockInstalled = false;
  let viewportHandlingInstalled = false;
  let nudgeTimer = null;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function digits(v) { return String(v || '').replace(/\D/g, ''); }
  function tid() {
    try { if (window._tenantId) return String(window._tenantId); } catch(e) {}
    try { if (typeof _tenantId !== 'undefined' && _tenantId) return String(_tenantId); } catch(e) {}
    try {
      const s = JSON.parse(sessionStorage.getItem('cardapio_session') || 'null');
      if (s?.tenant_id) return String(s.tenant_id);
    } catch(e) {}
    return '';
  }
  function storageKey() { return 'ef_chat_' + (state.tid || tid() || ''); }
  function orderStorageKey() { return 'ef_order_' + (state.tid || tid() || ''); }

  function storeName() {
    return String(
      state.storeName ||
      window._storeName ||
      document.getElementById('hero-name')?.textContent ||
      'Loja'
    ).trim() || 'Loja';
  }

  function setStoreName(name) {
    const value = String(name || '').trim();
    if (!value) return;
    state.storeName = value;
    renderTitle();
  }

  function renderTitle() {
    const name = storeName();
    const title = document.getElementById('ef-chat-title');
    const bubble = document.getElementById('ef-chat-bubble');
    if (title) title.textContent = name;
    if (bubble) {
      bubble.title = 'Acompanhar pedido - ' + name;
      bubble.setAttribute('aria-label', 'Acompanhar pedido - ' + name);
    }
  }

  function setTenantId(id) {
    const value = String(id || '').trim();
    if (!value) return;
    state.tid = value;
    try { window._tenantId = value; } catch(e) {}
    ensureDom();
    render();
  }

  function getAudioCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    return audioCtx;
  }

  function unlockSound() {
    try {
      if (typeof window.efUnlockNotifySound === 'function') window.efUnlockNotifySound();
      const ctx = getAudioCtx();
      if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
      ensureNotificationPermission();
    } catch(e) {}
  }

  function ensureNotificationPermission() {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    } catch(e) {}
  }

  function installSoundUnlock() {
    if (soundUnlockInstalled) return;
    soundUnlockInstalled = true;
    ['pointerdown','keydown','touchstart'].forEach(evt => {
      window.addEventListener(evt, unlockSound, { once: true, passive: true });
    });
  }

  function playChatSound() {
    if (typeof window.efPlayNotifySound === 'function' && window.efPlayNotifySound('chat')) return;
    try {
      const ctx = audioCtx;
      if (!ctx || ctx.state === 'suspended') return;
      const now = ctx.currentTime + 0.01;
      [587.33, 783.99].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + idx * 0.12;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.12, start + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.45);
      });
    } catch(e) {}
  }

  function showBrowserNotification(title, body) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const n = new Notification(title || storeName(), {
        body: String(body || '').slice(0, 180),
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: 'ef-chat-' + (state.thread?.id || state.orderId || Date.now()),
        renotify: true
      });
      n.onclick = () => {
        try { window.focus(); openPanel(); } catch(e) {}
        try { n.close(); } catch(e) {}
      };
    } catch(e) {}
  }

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  }

  function normText(v) {
    return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function statusKey(v) {
    return normText(v).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function isFinalOrderStatus(status) {
    const key = statusKey(status);
    return key === 'finalizado' || key === 'cancelado';
  }

  function isFinalOrder(order) {
    return !!order && isFinalOrderStatus(order.status);
  }

  function activeOrderFromState() {
    const order = state.order || state.thread?.order || null;
    return isFinalOrder(order) ? null : order;
  }

  function trackingOrderId() {
    return Number(state.orderId || state.order?.id || state.thread?.order_id || 0) || 0;
  }

  function hasTrackingContext() {
    return !!(state.phone && trackingOrderId() > 0);
  }

  function stripThreadOrder(thread) {
    if (!thread) return thread;
    const clean = Object.assign({}, thread);
    clean.order_id = 0;
    clean.order_num = null;
    clean.order = null;
    return clean;
  }

  function clearOrderTrackingStorage() {
    try { localStorage.removeItem(orderStorageKey()); } catch(e) {}
    try { localStorage.removeItem(storageKey()); } catch(e) {}
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('acompanhar');
      window.history.replaceState({}, '', u.toString());
    } catch(e) {}
  }

  function resetOrderContextForNextOrder() {
    state.order = null;
    state.orderId = 0;
    state.orderNum = null;
    state.payment = null;
    state.follow = null;
    if (state.thread) state.thread = stripThreadOrder(state.thread);
    clearOrderTrackingStorage();
  }

  function applyFinalOrderReset(order) {
    if (!isFinalOrder(order)) return false;
    resetOrderContextForNextOrder();
    return true;
  }

  function cachedMessages() {
    return (state.messages || []).slice(-80).map(m => ({
      id: m.id,
      sender: m.sender,
      body: m.body,
      created_at: m.created_at,
      author_name: m.author_name,
      kind: m.kind
    })).filter(m => m.body);
  }

  function restoreCachedState(data) {
    if (!data) return;
    if (data.storeName) state.storeName = data.storeName;
    if (Array.isArray(data.messages) && data.messages.length) {
      state.messages = [];
      mergeMessages(data.messages);
    }
    if (data.payment) state.payment = data.payment;
    if (data.follow) state.follow = data.follow;
    if (typeof data.open === 'boolean') state.open = data.open;
  }

  function saveSession() {
    if (!state.tid || !hasTrackingContext()) return;
    try {
      localStorage.setItem(storageKey(), JSON.stringify({
        orderId: state.orderId,
        threadId: state.thread?.id || state.threadId || null,
        orderNum: state.orderNum,
        orderStatus: activeOrderFromState()?.status || '',
        phone: state.phone,
        client: state.client,
        storeName: state.storeName || storeName(),
        open: !!state.open,
        messages: cachedMessages(),
        payment: state.payment || null,
        follow: state.follow || null,
        ts: Date.now()
      }));
    } catch(e) {}
  }

  function loadSession() {
    const k = storageKey();
    let data = readJson(k);
    if (!data) data = readJson(orderStorageKey());
    if (!data || !data.orderId || !data.phone) return null;
    if (data.ts && Date.now() - data.ts > CHAT_TTL_MS) {
      try { localStorage.removeItem(k); } catch(e) {}
      return null;
    }
    return data;
  }

  function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const currentTid = state.tid || tid();
    if (currentTid) headers['x-tenant-id'] = currentTid;
    return fetch(path, Object.assign({}, opts, { headers }));
  }

  function injectStyle() {
    if (document.getElementById('ef-chat-style')) return;
    const style = document.createElement('style');
    style.id = 'ef-chat-style';
    style.textContent = `
      #ef-chat-root{position:fixed;right:16px;bottom:calc(22px + env(safe-area-inset-bottom,0px));z-index:370;font-family:'DM Sans',system-ui,sans-serif}
      #ef-chat-root.efc-open{inset:0;right:0;bottom:0;z-index:2147483000;pointer-events:none}
      #ef-chat-root.efc-open .efc-panel{pointer-events:auto;z-index:2147483001}
      #ef-chat-root.efc-open .efc-bubble,#ef-chat-root.efc-open .efc-nudges{display:none!important}
      body.ef-chat-open #track-fab,body.ef-chat-open .track-fab,body.ef-chat-open #track-drawer-bg{display:none!important;pointer-events:none!important;visibility:hidden!important}
      body.ef-chat-open #cart-float{pointer-events:none}
      #ef-chat-root.efc-cart-on{bottom:calc(86px + env(safe-area-inset-bottom,0px))}
      .efc-bubble{width:54px;height:54px;border:none;border-radius:50%;background:var(--accent,#f97316);color:#fff;display:none;align-items:center;justify-content:center;box-shadow:0 12px 30px rgba(0,0,0,.28);cursor:pointer;position:relative;transition:transform .18s,box-shadow .18s}
      .efc-bubble.on{display:flex}
      .efc-bubble:hover{transform:translateY(-2px);box-shadow:0 16px 36px rgba(0,0,0,.32)}
      .efc-badge{position:absolute;right:-3px;top:-4px;min-width:19px;height:19px;border-radius:99px;background:#ef4444;color:#fff;font-size:11px;font-weight:800;display:none;align-items:center;justify-content:center;border:2px solid #fff;padding:0 5px}
      .efc-badge.on{display:flex}
      .efc-nudges{position:absolute;right:64px;bottom:0;width:min(268px,calc(100vw - 92px));display:none;flex-direction:column;align-items:flex-end;gap:7px;pointer-events:none}
      .efc-nudge{position:relative;width:100%;border:none;border-radius:15px;background:#fff;color:#111827;text-align:left;padding:10px 12px 10px 13px;box-shadow:0 14px 40px rgba(15,23,42,.22);border:1px solid rgba(15,23,42,.1);cursor:pointer;pointer-events:auto;overflow:visible}
      .efc-nudge:after{content:"";display:none;position:absolute;right:-7px;bottom:18px;width:14px;height:14px;background:#fff;border-right:1px solid rgba(15,23,42,.1);border-bottom:1px solid rgba(15,23,42,.1);transform:rotate(-45deg)}
      .efc-nudge:last-child:after{display:block}
      .efc-nudge strong{display:block;font-size:12.5px;font-weight:900;line-height:1.15;margin-bottom:2px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .efc-nudge span{display:block;font-size:11.2px;font-weight:650;line-height:1.28;color:#64748b;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .efc-nudge.promo{border-color:rgba(var(--accent-rgb,249,115,22),.24);background:linear-gradient(135deg,#fff,#fff7ed)}
      .efc-nudge.promo strong{color:var(--accent,#f97316)}
      .efc-nudge.item{background:linear-gradient(135deg,#fff,#eff6ff);border-color:rgba(14,165,233,.22)}
      .efc-nudge.ai{background:linear-gradient(135deg,#fff,#ecfeff);border-color:rgba(6,182,212,.2)}
      #ef-chat-root.efc-show-nudge .efc-nudges{display:flex;animation:efNudgeIn .34s cubic-bezier(.2,.9,.22,1)}
      .efc-panel{position:absolute;right:0;bottom:66px;width:min(360px,calc(100vw - 24px));height:min(520px,calc(var(--efc-vh,100vh) - 126px));background:#fff;color:#111827;border:1px solid rgba(15,23,42,.12);border-radius:18px;box-shadow:0 22px 70px rgba(15,23,42,.28);display:none;overflow:hidden;flex-direction:column;z-index:2}
      .efc-panel.on{display:flex}
      .efc-head{height:58px;background:#111827;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 14px 0 16px;gap:10px}
      .efc-head>div{min-width:0;flex:1}
      .efc-title{font-size:14px;font-weight:850;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .efc-sub{display:block;font-size:11.5px;color:rgba(255,255,255,.72);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
      .efc-close{width:32px;height:32px;border:none;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 32px;position:relative;z-index:20}
      .efc-order{padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e5e7eb;font-size:12px;color:#475569;line-height:1.35}
      .efc-order strong{color:#111827}
      .efc-start{display:none;padding:14px;background:#fff;border-bottom:1px solid #e5e7eb}
      .efc-start.on{display:block}
      .efc-start-title{font-size:13px;font-weight:900;color:#111827;margin-bottom:4px}
      .efc-start-text{font-size:12px;color:#64748b;line-height:1.35;margin-bottom:10px}
      .efc-start-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
      .efc-start input{height:38px;border:1px solid #d1d5db;border-radius:11px;padding:0 11px;font:500 12.5px 'DM Sans',system-ui,sans-serif;outline:none;color:#111827;background:#fff;min-width:0}
      .efc-start input:focus{border-color:var(--accent,#f97316);box-shadow:0 0 0 3px rgba(var(--accent-rgb,249,115,22),.12)}
      .efc-start button{height:38px;border:none;border-radius:11px;background:var(--accent,#f97316);color:#fff;font:850 12.5px 'DM Sans',system-ui,sans-serif;cursor:pointer;width:100%}
      .efc-msgs{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:14px 12px;background:#f3f4f6;display:flex;flex-direction:column;gap:8px}
      .efc-empty{margin:auto;text-align:center;color:#64748b;font-size:12.5px;line-height:1.35;max-width:230px}
      .efc-msg{max-width:86%;padding:9px 11px;border-radius:14px;font-size:13px;line-height:1.35;word-break:break-word;overflow-wrap:anywhere;box-shadow:0 1px 1px rgba(15,23,42,.06)}
      .efc-msg-body{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
      .efc-msg.client{align-self:flex-end;background:var(--accent,#f97316);color:#fff;border-bottom-right-radius:5px}
      .efc-msg.store{align-self:flex-start;background:#fff;color:#111827;border-bottom-left-radius:5px}
      .efc-msg.system{align-self:center;background:#e0f2fe;color:#075985;border:1px solid #bae6fd;box-shadow:none;font-size:12px;text-align:center;border-radius:10px}
      .efc-time{font-size:10px;opacity:.7;margin-top:4px;text-align:right}
      .efc-quick{align-self:flex-start;max-width:94%;display:flex;flex-wrap:wrap;gap:7px;margin:-2px 0 4px 2px}
      .efc-chip{min-height:32px;border:1px solid rgba(14,165,233,.28);border-radius:999px;background:#fff;color:#0f172a;padding:7px 11px;font:800 12px 'DM Sans',system-ui,sans-serif;cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,.06);transition:transform .15s,border-color .15s,background .15s}
      .efc-chip:hover{transform:translateY(-1px);border-color:var(--accent,#f97316)}
      .efc-chip.on{background:rgba(var(--accent-rgb,249,115,22),.12);border-color:var(--accent,#f97316);color:#111827}
      .efc-chip.primary{background:var(--accent,#f97316);border-color:var(--accent,#f97316);color:#fff}
      .efc-chip.ghost{background:#f8fafc;color:#475569}
      .efc-chip:disabled{opacity:.45;cursor:not-allowed;transform:none}
      .efc-card{align-self:stretch;background:#fff;border:1px solid rgba(15,23,42,.1);border-radius:14px;padding:12px;box-shadow:0 1px 2px rgba(15,23,42,.06);color:#111827}
      .efc-card-kicker{font-size:10.5px;font-weight:900;color:var(--accent,#f97316);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px}
      .efc-card-title{font-size:14px;font-weight:900;line-height:1.2;margin-bottom:5px}
      .efc-card-text{font-size:12.2px;color:#64748b;line-height:1.4;margin-bottom:10px}
      .efc-card-actions{display:flex;gap:7px;flex-wrap:wrap}
      .efc-pay-qr{width:154px;height:154px;margin:8px auto 10px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden}
      .efc-pay-qr img{width:100%;height:100%;display:block;object-fit:contain}
      .efc-pay-code{display:flex;gap:7px;align-items:stretch;margin:8px 0 10px}
      .efc-pay-code input{flex:1;min-width:0;height:36px;border:1px solid #d1d5db;border-radius:10px;background:#f8fafc;color:#111827;padding:0 10px;font:700 11px ui-monospace,SFMono-Regular,Consolas,monospace;overflow:hidden;text-overflow:ellipsis}
      .efc-pay-btn{min-height:36px;border:none;border-radius:10px;background:var(--accent,#f97316);color:#fff;padding:0 12px;font:850 12px 'DM Sans',system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none}
      .efc-pay-btn.wa{background:#128c7e}
      .efc-pay-btn.ghost{background:#f1f5f9;color:#334155}
      .efc-pay-status{font-size:12px;font-weight:800;color:#64748b;margin-top:2px}
      .efc-pay-status.ok{color:#16a34a}
      .efc-pay-status.err{color:#dc2626}
      .efc-form{display:flex;align-items:flex-end;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff;flex-shrink:0}
      .efc-input{flex:1;min-width:0;min-height:40px;height:40px;max-height:112px;border:1px solid #d1d5db;border-radius:12px;padding:10px 12px;font:500 13px/1.35 'DM Sans',system-ui,sans-serif;outline:none;color:#111827;background:#fff;resize:none;overflow-y:auto;white-space:pre-wrap}
      .efc-input:focus{border-color:var(--accent,#f97316);box-shadow:0 0 0 3px rgba(var(--accent-rgb,249,115,22),.12)}
      .efc-send{width:42px;height:40px;border:none;border-radius:12px;background:var(--accent,#f97316);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
      .efc-send:disabled{opacity:.45;cursor:not-allowed}
      .ef-follow-layer{position:fixed;inset:0;z-index:3900;display:flex;align-items:flex-end;justify-content:center;padding:18px;pointer-events:none}
      .ef-follow-card{width:min(430px,calc(100vw - 28px));background:#fff;color:#111827;border:1px solid rgba(15,23,42,.12);border-radius:20px;box-shadow:0 24px 80px rgba(15,23,42,.28);display:grid;grid-template-columns:74px minmax(0,1fr);gap:14px;padding:16px;position:relative;pointer-events:auto;animation:efFollowIn .42s cubic-bezier(.2,.9,.22,1)}
      .ef-follow-close{position:absolute;right:10px;top:10px;width:28px;height:28px;border:none;border-radius:50%;background:#f1f5f9;color:#475569;display:flex;align-items:center;justify-content:center;cursor:pointer}
      .ef-follow-bot{width:64px;height:64px;border-radius:20px;background:linear-gradient(145deg,#e0f2fe,#ecfeff);border:1px solid #bae6fd;box-shadow:inset 0 -8px 18px rgba(14,165,233,.12);position:relative;align-self:center;animation:efBotFloat 2.4s ease-in-out infinite}
      .ef-follow-bot:before{content:"";position:absolute;left:29px;top:-12px;width:6px;height:14px;border-radius:99px;background:#0ea5e9}
      .ef-follow-bot:after{content:"";position:absolute;left:24px;top:-18px;width:16px;height:8px;border-radius:99px;background:#22c55e;box-shadow:0 0 14px rgba(34,197,94,.45)}
      .ef-follow-eye{position:absolute;top:25px;width:9px;height:9px;border-radius:50%;background:#0f172a;animation:efBotBlink 4s infinite}
      .ef-follow-eye.left{left:18px}
      .ef-follow-eye.right{right:18px}
      .ef-follow-mouth{position:absolute;left:22px;right:22px;bottom:18px;height:4px;border-radius:99px;background:#38bdf8}
      .ef-follow-kicker{font-size:11px;font-weight:900;color:var(--accent,#f97316);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px}
      .ef-follow-title{font-size:16px;font-weight:900;line-height:1.2;padding-right:22px}
      .ef-follow-text{font-size:12.5px;color:#64748b;line-height:1.42;margin-top:5px}
      .ef-follow-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
      .ef-follow-btn{height:38px;border:none;border-radius:12px;padding:0 13px;font:800 12.5px 'DM Sans',system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:7px}
      .ef-follow-btn.primary{background:var(--accent,#f97316);color:#fff}
      .ef-follow-btn.wa{background:#128c7e;color:#fff}
      @keyframes efNudgeIn{from{opacity:0;transform:translateX(14px) scale(.97)}to{opacity:1;transform:translateX(0) scale(1)}}
      @keyframes efFollowIn{from{opacity:0;transform:translateY(42px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
      @keyframes efBotFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
      @keyframes efBotBlink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.18)}}
      @media(max-width:520px){
        #ef-chat-root{right:10px;bottom:calc(14px + env(safe-area-inset-bottom,0px))}
        #ef-chat-root.efc-cart-on{bottom:calc(76px + env(safe-area-inset-bottom,0px))}
        .efc-bubble{width:52px;height:52px}
        .efc-nudges{right:60px;bottom:2px;width:min(244px,calc(100vw - 88px))}
        .efc-nudge{padding:9px 10px}
        .efc-nudge:nth-child(n+2){display:none}
        .efc-nudge:after{display:block}
        .efc-nudge strong{font-size:12px}
        .efc-nudge span{font-size:10.8px}
        .efc-panel{position:fixed;left:0;right:0;bottom:calc(var(--efc-kb,0px) + env(safe-area-inset-bottom,0px));width:100vw;height:calc(var(--efc-vh,100vh) - 8px - env(safe-area-inset-bottom,0px));max-height:none;border-left:none;border-right:none;border-bottom:none;border-radius:18px 18px 0 0}
        #ef-chat-root.efc-open .efc-panel{top:0!important;left:0!important;right:0!important;bottom:calc(var(--efc-kb,0px) + env(safe-area-inset-bottom,0px))!important;width:100vw!important;height:auto!important;border-radius:0!important}
        .efc-head{height:54px;padding-left:14px;padding-right:12px;position:relative;z-index:4}
        #ef-chat-root.efc-open .efc-head{height:calc(56px + env(safe-area-inset-top,0px));padding-top:env(safe-area-inset-top,0px)}
        .efc-close{width:38px;height:38px;flex-basis:38px}
        .efc-sub{max-width:100%}
        .efc-order{padding:9px 12px;font-size:11.8px}
        .efc-start{padding:12px}
        .efc-start-row{grid-template-columns:1fr}
        .efc-start input{height:42px;font-size:16px}
        .efc-start button{height:42px;font-size:14px}
        .efc-msgs{padding:12px 10px;gap:7px}
        .efc-msg{max-width:88%;font-size:13px}
        .efc-quick{max-width:100%;gap:6px;margin-left:0}
        .efc-chip{min-height:34px;padding:7px 10px;font-size:12px}
        .efc-card{border-radius:12px;padding:11px}
        .efc-card-actions .efc-pay-btn{flex:1;min-width:132px}
        .efc-pay-code input{font-size:12px}
        .efc-form{padding:8px 8px calc(8px + env(safe-area-inset-bottom,0px));gap:7px}
        .efc-input{min-height:46px;height:46px;max-height:118px;border-radius:12px;font-size:16px;padding:11px 12px}
        .efc-send{width:44px;height:44px;border-radius:12px}
        .ef-follow-layer{align-items:flex-end;padding:12px}
        .ef-follow-card{grid-template-columns:58px minmax(0,1fr);gap:10px;padding:14px}
        .ef-follow-bot{width:54px;height:54px;border-radius:18px}
        .ef-follow-eye{top:22px}
        .ef-follow-eye.left{left:15px}
        .ef-follow-eye.right{right:15px}
      }
      @media(max-width:360px){
        .efc-card-actions .efc-pay-btn{flex-basis:100%;width:100%}
        .efc-pay-code{flex-direction:column}
        .efc-pay-code .efc-pay-btn{width:100%}
      }`;
    document.head.appendChild(style);
  }

  function updateViewportVars() {
    try {
      const vv = window.visualViewport;
      const h = Math.max(320, Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight || 0));
      const w = Math.max(280, Math.round(vv?.width || window.innerWidth || document.documentElement.clientWidth || 0));
      const layoutH = Math.max(h, Math.round(window.innerHeight || document.documentElement.clientHeight || h));
      const offsetTop = Math.max(0, Math.round(vv?.offsetTop || 0));
      const keyboard = Math.max(0, layoutH - h - offsetTop);
      document.documentElement.style.setProperty('--efc-vh', h + 'px');
      document.documentElement.style.setProperty('--efc-vw', w + 'px');
      document.documentElement.style.setProperty('--efc-kb', keyboard + 'px');
      document.documentElement.style.setProperty('--efc-vv-top', offsetTop + 'px');
    } catch(e) {}
  }

  function scrollMessagesToBottom(delay) {
    const run = () => {
      const msgs = document.getElementById('ef-chat-msgs');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    };
    if (delay) setTimeout(run, delay);
    else requestAnimationFrame(run);
  }

  function setTrackingSuppressed(on) {
    try {
      const fab = document.getElementById('track-fab');
      if (fab) {
        if (on) {
          fab.dataset.efChatSuppressed = '1';
          fab.style.setProperty('display', 'none', 'important');
          fab.style.setProperty('visibility', 'hidden', 'important');
          fab.style.setProperty('pointer-events', 'none', 'important');
        } else if (fab.dataset.efChatSuppressed === '1') {
          delete fab.dataset.efChatSuppressed;
          fab.style.removeProperty('display');
          fab.style.removeProperty('visibility');
          fab.style.removeProperty('pointer-events');
        }
      }
      const drawer = document.getElementById('track-drawer-bg');
      if (drawer) {
        if (on) drawer.classList.remove('on');
        drawer.style.pointerEvents = on ? 'none' : '';
        drawer.style.visibility = on ? 'hidden' : '';
      }
    } catch(e) {}
  }

  function guardTrackingOverlay(ev) {
    if (!state.open) return;
    const target = ev?.target;
    if (!target?.closest) return;
    if (target.closest('#track-fab,.track-fab,#track-drawer-bg')) {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      closePanel();
    }
  }

  function installViewportHandling() {
    if (viewportHandlingInstalled) {
      updateViewportVars();
      return;
    }
    viewportHandlingInstalled = true;
    updateViewportVars();
    const refresh = () => {
      updateViewportVars();
      if (state.open) scrollMessagesToBottom(60);
    };
    window.addEventListener('resize', refresh, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(refresh, 250), { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', refresh, { passive: true });
      window.visualViewport.addEventListener('scroll', refresh, { passive: true });
    }
    document.addEventListener('focusin', ev => {
      const el = ev.target;
      if (el && (el.id === 'ef-chat-input' || el.id === 'ef-chat-start-name' || el.id === 'ef-chat-start-phone')) {
        refresh();
        scrollMessagesToBottom(220);
      }
    });
  }

  function autoSizeChatInput() {
    const input = document.getElementById('ef-chat-input');
    if (!input) return;
    const min = window.matchMedia && window.matchMedia('(max-width:520px)').matches ? 46 : 40;
    const max = window.matchMedia && window.matchMedia('(max-width:520px)').matches ? 118 : 112;
    input.style.height = min + 'px';
    const next = Math.max(min, Math.min(input.scrollHeight || min, max));
    input.style.height = next + 'px';
    input.style.overflowY = (input.scrollHeight || 0) > max ? 'auto' : 'hidden';
    if (state.open) scrollMessagesToBottom(40);
  }

  function handleInputKeydown(ev) {
    if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return;
    ev.preventDefault();
    const form = document.getElementById('ef-chat-form');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }

  function compactName(name, max) {
    const text = String(name || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length <= max) return text;
    return text.slice(0, max - 1).trim() + '...';
  }

  function readMenuItems() {
    try {
      if (typeof allItems !== 'undefined' && Array.isArray(allItems)) return allItems;
    } catch(e) {}
    return Array.isArray(window._cardapioItems) ? window._cardapioItems : [];
  }

  function readCoupons() {
    try {
      if (typeof allCupons !== 'undefined' && Array.isArray(allCupons)) return allCupons;
    } catch(e) {}
    return Array.isArray(window._cardapioCupons) ? window._cardapioCupons : [];
  }

  function readCats() {
    try {
      if (typeof allCats !== 'undefined' && Array.isArray(allCats)) return allCats;
    } catch(e) {}
    return Array.isArray(window._cardapioCats) ? window._cardapioCats : [];
  }

  function nudgePriceText(item) {
    const price = parseFloat(item?.price || 0) || 0;
    return price > 0 ? ' por R$ ' + fmtMoney(price) : '';
  }

  function buildSmartNudges() {
    return [];
  }

  function renderNudges() {
    const wrap = document.getElementById('ef-chat-nudges');
    if (!wrap) return 0;
    const nudges = buildSmartNudges();
    const total = nudges.length;
    if (!total) {
      wrap.innerHTML = '';
      return 0;
    }
    const start = total ? (state.nudgeIndex % total) : 0;
    const ordered = nudges.slice(start).concat(nudges.slice(0, start));
    const visible = ordered.slice(0, Math.min(3, ordered.length));
    wrap.innerHTML = visible.map(n => `
      <button class="efc-nudge ${esc(n.kind || 'ai')}" type="button" data-nudge-prompt="${esc(n.prompt || '')}">
        <strong>${esc(n.title)}</strong>
        <span>${esc(n.text)}</span>
      </button>`).join('');
    return total;
  }

  function installNudgeRotation() {
    if (nudgeTimer) return;
    nudgeTimer = setInterval(() => {
      if (!document.getElementById('ef-chat-root')) return;
      if (state.open || state.phone) return;
      state.nudgeIndex = (state.nudgeIndex + 1) % 20;
      renderNudges();
    }, 6500);
  }

  function updateStartText() {
    const el = document.getElementById('ef-chat-start-text');
    if (!el) return;
    el.textContent = 'O chat fica disponivel para acompanhar um pedido ja realizado.';
  }

  function handleNudgeClick(ev) {
    ev.preventDefault();
  }

  function ensureDom() {
    if (document.getElementById('ef-chat-root')) {
      installViewportHandling();
      return;
    }
    injectStyle();
    installViewportHandling();
    const root = document.createElement('div');
    root.id = 'ef-chat-root';
    root.innerHTML = `
      <div class="efc-nudges" id="ef-chat-nudges"></div>
      <button class="efc-bubble" id="ef-chat-bubble" type="button" title="Acompanhar pedido" aria-label="Acompanhar pedido">
        <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3v2.2M8.2 5.4l-.9-1.5M15.8 5.4l.9-1.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          <rect x="4.2" y="6" width="15.6" height="13" rx="5" stroke="currentColor" stroke-width="1.7"/>
          <circle cx="9.2" cy="12.2" r="1.15" fill="currentColor"/>
          <circle cx="14.8" cy="12.2" r="1.15" fill="currentColor"/>
          <path d="M9.2 16h5.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          <path d="M19.8 11h1.4M2.8 11h1.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
        </svg>
        <span class="efc-badge" id="ef-chat-badge"></span>
      </button>
      <div class="efc-panel" id="ef-chat-panel">
        <div class="efc-head">
          <div>
            <div class="efc-title" id="ef-chat-title">Chat da loja</div>
            <div class="efc-sub" id="ef-chat-sub">Pedido</div>
          </div>
          <button class="efc-close" id="ef-chat-close" type="button" title="Fechar" aria-label="Fechar">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="efc-order" id="ef-chat-order"></div>
        <form class="efc-start" id="ef-chat-start">
          <div class="efc-start-title">Chat de acompanhamento</div>
          <div class="efc-start-text" id="ef-chat-start-text">O chat fica disponivel para acompanhar um pedido ja realizado.</div>
          <div class="efc-start-row">
            <input id="ef-chat-start-name" autocomplete="name" enterkeyhint="next" placeholder="Seu nome">
            <input id="ef-chat-start-phone" autocomplete="tel" inputmode="tel" enterkeyhint="done" placeholder="WhatsApp">
          </div>
          <button type="submit">Acompanhar pedido</button>
        </form>
        <div class="efc-msgs" id="ef-chat-msgs"></div>
        <form class="efc-form" id="ef-chat-form">
          <textarea class="efc-input" id="ef-chat-input" maxlength="1000" autocomplete="off" enterkeyhint="send" rows="1" placeholder="Mensagem para a loja"></textarea>
          <button class="efc-send" id="ef-chat-send" type="submit" title="Enviar" aria-label="Enviar">
            <svg width="17" height="17" viewBox="0 0 18 18" fill="none"><path d="M2 9l13-6-3.4 12-2.5-5.1L2 9Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          </button>
        </form>
      </div>`;
    document.body.appendChild(root);
    document.getElementById('ef-chat-nudges').addEventListener('click', handleNudgeClick);
    document.getElementById('ef-chat-bubble').addEventListener('click', openPanel);
    document.getElementById('ef-chat-close').addEventListener('click', closePanel);
    document.addEventListener('pointerdown', guardTrackingOverlay, true);
    document.addEventListener('click', guardTrackingOverlay, true);
    document.getElementById('ef-chat-form').addEventListener('submit', sendMessage);
    document.getElementById('ef-chat-input').addEventListener('input', autoSizeChatInput);
    document.getElementById('ef-chat-input').addEventListener('keydown', handleInputKeydown);
    document.getElementById('ef-chat-start').addEventListener('submit', startChat);
    document.getElementById('ef-chat-msgs').addEventListener('click', handleQuickReplyClick);
    state.ready = true;
    installNudgeRotation();
    renderTitle();
  }

  function messageTime(m) {
    try {
      if (!m.created_at) return '';
      const iso = String(m.created_at).replace(' ', 'T');
      const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    } catch { return ''; }
  }

  function mergeMessages(rows) {
    const byId = new Map(state.messages.map((m, idx) => [Number(m.id), idx]));
    (rows || []).forEach(m => {
      if (!m) return;
      const id = Number(m.id);
      if (byId.has(id)) {
        state.messages[byId.get(id)] = Object.assign({}, state.messages[byId.get(id)], m);
        return;
      }
      state.messages.push(m);
      byId.set(id, state.messages.length - 1);
    });
    state.messages.sort((a,b) => Number(a.id || 0) - Number(b.id || 0));
  }

  function isAssistantMessage(m) {
    if (!m || m.sender === 'client') return false;
    const author = normText(m.author_name || '');
    const kind = normText(m.kind || '');
    return author.includes('estimaia') || kind === 'assistant' || kind === 'status';
  }

  function cleanQuickValue(label) {
    return String(label || '')
      .replace(/\s+(gratis|grátis)$/i, '')
      .replace(/\s*\+\s*R\$\s*[\d.,]+.*$/i, '')
      .replace(/\s*-\s*R\$\s*[\d.,]+.*$/i, '')
      .trim();
  }

  function parseNumberedOptions(body) {
    const rows = [];
    String(body || '').split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*(\d{1,2})\.\s+(.+?)\s*$/);
      if (!m) return;
      const label = m[2].trim();
      const value = cleanQuickValue(label);
      if (value) rows.push({ label, value });
    });
    return rows.slice(0, 12);
  }

  function quickRepliesFor(m) {
    if (!isAssistantMessage(m)) return null;
    const body = String(m.body || '');
    const n = normText(body);
    if (/pedido guiado|adicionad[ao]|adicional|qual tamanho da pizza|forma de pagamento|confirmar pedido|finalizar pedido|ver cardapio|mande "?cardapio"?|escreva o nome do item|entrega ou retirada|retirada ou mesa/i.test(n)) {
      return null;
    }
    const buttons = [];

    if (/localizacao|gps|distancia|distancia|enviar localizacao/i.test(n)) {
      return {
        type: 'single',
        buttons: [
          { label: 'Enviar localizacao', value: 'localizacao', action: 'location', primary: true },
          { label: 'Digitar endereco', value: 'vou digitar o endereco', ghost: true }
        ]
      };
    }

    const bairroSug = body.match(/Voce quis dizer:\s*([^?]+)\?/i) || body.match(/Você quis dizer:\s*([^?]+)\?/i);
    if (bairroSug) {
      const opts = bairroSug[1].split(',').map(x => x.trim()).filter(Boolean).slice(0, 3);
      if (opts.length) {
        return { type: 'single', buttons: opts.map(x => ({ label: x, value: x })) };
      }
    }

    const sizeAsk = body.match(/Qual tamanho da pizza\s+(.+?)\?/i);
    if (sizeAsk) {
      const pizza = sizeAsk[1].trim();
      return {
        type: 'single',
        buttons: [
          { label: 'Pequena', value: 'pizza pequena ' + pizza },
          { label: 'Media', value: 'pizza media ' + pizza },
          { label: 'Grande', value: 'pizza grande ' + pizza }
        ]
      };
    }

    const numbered = parseNumberedOptions(body);
    if (numbered.length) {
      const multi = /\bescolha ate\b|\bescolha até\b|\bminimo\b|\bmínimo\b/i.test(body);
      const opts = numbered.map(o => ({ label: o.label, value: o.value }));
      if (/responda\s+"sem"|responda\s+'sem'|sem esse adicional/i.test(body)) {
        opts.push({ label: 'Sem adicional', value: 'sem', ghost: true });
      }
      return { type: multi ? 'multi' : 'single', buttons: opts };
    }

    if (/vai ser entrega ou retirada|entrega ou retirada|entrega, retirada ou mesa|retirada ou mesa/i.test(n)) {
      return { type: 'single', buttons: [
        { label: 'Entrega', value: 'entrega' },
        { label: 'Retirada', value: 'retirada' },
        { label: 'No local', value: 'mesa' }
      ] };
    }

    if (/forma de pagamento|qual sera a forma de pagamento/i.test(n)) {
      return { type: 'single', buttons: [
        { label: 'Pix', value: 'pix' },
        { label: 'Dinheiro', value: 'dinheiro' },
        { label: 'Credito', value: 'credito' },
        { label: 'Debito', value: 'debito' }
      ] };
    }

    if (/confirmar pedido|enviar para a loja|deseja adicionar mais algum item ou finalizar|adicionar mais algum item ou finalizar/i.test(n)) {
      buttons.push({ label: 'Ver cardapio', value: 'cardapio', ghost: true });
      buttons.push({ label: 'Finalizar pedido', value: 'confirmar pedido', primary: true });
      return { type: 'single', buttons };
    }

    if (/escreva o nome do item|mande \"cardapio\"|mande "cardapio"|ver algumas opcoes/i.test(n)) {
      return { type: 'single', buttons: [
        { label: 'Ver cardapio', value: 'cardapio' },
        { label: 'Falar com atendente', value: 'falar com atendente', ghost: true }
      ] };
    }

    return null;
  }

  function latestQuickMessageId() {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const m = state.messages[i];
      if (quickRepliesFor(m)) return Number(m.id);
      if (m?.sender === 'client') return null;
    }
    return null;
  }

  function quickRepliesHtml(m, lastQuickId) {
    if (Number(m.id) !== Number(lastQuickId)) return '';
    const cfg = quickRepliesFor(m);
    if (!cfg?.buttons?.length) return '';
    const mid = String(m.id);
    const selected = state.quickSelections[mid] || [];
    const chips = cfg.buttons.map((b, idx) => {
      const on = selected.includes(b.value) ? ' on' : '';
      const cls = 'efc-chip' + on + (b.primary ? ' primary' : '') + (b.ghost ? ' ghost' : '');
      return `<button type="button" class="${cls}" data-quick-mid="${esc(mid)}" data-quick-type="${esc(cfg.type)}" data-quick-value="${esc(b.value)}" ${b.action ? `data-quick-action="${esc(b.action)}"` : ''}>${esc(b.label)}</button>`;
    }).join('');
    const send = cfg.type === 'multi'
      ? `<button type="button" class="efc-chip primary" data-quick-send="${esc(mid)}" ${selected.length ? '' : 'disabled'}>Enviar escolhas</button>`
      : '';
    return `<div class="efc-quick" data-quick-wrap="${esc(mid)}">${chips}${send}</div>`;
  }

  function fmtMoney(v) {
    const n = parseFloat(v || 0) || 0;
    try { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    catch { return n.toFixed(2).replace('.', ','); }
  }

  function currentOrderId() {
    return Number(state.orderId || state.thread?.order_id || state.order?.id || 0);
  }

  function isPendingOnlinePayment(order) {
    const status = String(order?.status || '').toLowerCase();
    const pag = String(order?.pag || '').toLowerCase();
    return status === 'aguardando_cartao' || (status === 'aguardando_pix' && pag !== 'pix_manual');
  }

  function normalizePaymentPayload(payload) {
    payload = payload || {};
    const orderId = Number(payload.orderId || payload.order_id || payload.id || state.orderId || 0);
    const orderNum = payload.orderNum || payload.order_num || state.orderNum || '';
    const amount = parseFloat(payload.amount || payload.valor || payload.total || 0) || 0;
    const qrB64 = String(payload.qr_code_base64 || payload.qrCodeBase64 || '').replace(/[\r\n\s"]/g, '');
    return {
      orderId,
      orderNum,
      mode: payload.mode || payload.type || (payload.pix_key ? 'manual' : 'online'),
      status: payload.status || 'waiting',
      amount,
      amountText: payload.amountText || (amount ? 'R$ ' + fmtMoney(amount) : ''),
      qr_code: payload.qr_code || payload.qrCode || '',
      qr_code_base64: qrB64,
      pix_key: payload.pix_key || payload.pixKey || '',
      pix_key_tipo: payload.pix_key_tipo || payload.pixKeyTipo || '',
      bank: payload.bank || payload.banco || '',
      mp_payment_id: payload.mp_payment_id || payload.mpPaymentId || '',
      waLink: payload.waLink || payload.whatsappLink || '',
      proofWaLink: payload.proofWaLink || payload.comprovanteWaLink || ''
    };
  }

  function paymentMatches(card) {
    if (!card) return false;
    const oid = currentOrderId();
    return !card.orderId || !oid || Number(card.orderId) === Number(oid);
  }

  function paymentQrSrc(card) {
    const raw = String(card?.qr_code_base64 || '').trim();
    if (!raw) return '';
    return raw.startsWith('data:image/') ? raw : `data:image/png;base64,${raw}`;
  }

  function paymentCode(card) {
    return card?.qr_code || card?.pix_key || '';
  }

  function paymentCardHtml() {
    const card = state.payment;
    if (!paymentMatches(card)) return '';
    const mode = card.mode === 'manual' ? 'manual' : 'online';
    const code = paymentCode(card);
    const qrSrc = paymentQrSrc(card);
    const isPaid = card.status === 'paid' || card.status === 'aprovado';
    const isFailed = card.status === 'failed' || card.status === 'rejeitado' || card.status === 'cancelado';
    const isLoading = card.status === 'loading';
    const title = mode === 'manual' ? 'Pagamento via Pix manual' : 'Pagamento via Pix';
    const codeLabel = mode === 'manual' ? 'Chave Pix' : 'Pix copia e cola';
    const statusClass = isPaid ? ' ok' : (isFailed ? ' err' : '');
    const statusText = isPaid
      ? 'Pagamento confirmado. Seu pedido sera preparado pela loja.'
      : isFailed
        ? 'Pagamento nao confirmado. Fale com a loja ou tente outra forma.'
        : isLoading
          ? 'Gerando o Pix para pagamento...'
          : (mode === 'manual' ? 'Apos pagar, envie o comprovante para a loja.' : 'Aguardando confirmacao do pagamento.');
    return `<div class="efc-card efc-pay-card">
      <div class="efc-card-kicker">Pagamento</div>
      <div class="efc-card-title">${esc(title)}${card.amountText ? ' - ' + esc(card.amountText) : ''}</div>
      <div class="efc-card-text">${mode === 'manual'
        ? 'Transfira para a chave abaixo. O pedido entra em preparo apos a conferencia da loja.'
        : 'Escaneie o QR Code no app do seu banco ou copie o codigo Pix.'}</div>
      ${qrSrc ? `<div class="efc-pay-qr"><img src="${esc(qrSrc)}" alt="QR Code Pix"></div>` : (card.qr_code ? '<div class="efc-pay-qr" data-chat-qrcode="1"></div>' : '')}
      ${code ? `<div style="font-size:11px;font-weight:800;color:#64748b;margin-bottom:5px">${esc(codeLabel)}</div>
        <div class="efc-pay-code">
          <input readonly value="${esc(code)}" aria-label="${esc(codeLabel)}">
          <button type="button" class="efc-pay-btn" data-chat-copy="pix">Copiar</button>
        </div>` : ''}
      <div class="efc-card-actions">
        ${mode === 'manual' && card.proofWaLink ? `<button type="button" class="efc-pay-btn wa" data-chat-wa="${esc(card.proofWaLink)}">Enviar comprovante</button>` : ''}
        ${card.waLink ? `<button type="button" class="efc-pay-btn ghost" data-chat-wa="${esc(card.waLink)}">Acompanhar no WhatsApp</button>` : ''}
      </div>
      <div class="efc-pay-status${statusClass}">${esc(statusText)}</div>
    </div>`;
  }

  function followCardHtml() {
    const f = state.follow;
    if (!f || f.chosen || !paymentMatches(f)) return '';
    const num = f.orderNum ? '#' + String(f.orderNum).padStart(3, '0') : '';
    return `<div class="efc-card">
      <div class="efc-card-kicker">Acompanhe seu pedido</div>
      <div class="efc-card-title">${num ? 'Pedido ' + esc(num) + ' recebido' : 'Pedido recebido'}</div>
      <div class="efc-card-text">Voce pode acompanhar as atualizacoes em tempo real por aqui na EstimaIA ou ativar o acompanhamento pelo WhatsApp.</div>
      <div class="efc-card-actions">
        <button type="button" class="efc-pay-btn" data-follow-choice="chat">Acompanhar pela EstimaIA</button>
        ${f.waLink ? `<button type="button" class="efc-pay-btn wa" data-follow-choice="wa">Acompanhar pelo WhatsApp</button>` : ''}
      </div>
    </div>`;
  }

  function extraCardsHtml() {
    return [paymentCardHtml(), followCardHtml()].filter(Boolean).join('');
  }

  async function copyText(text) {
    text = String(text || '');
    if (!text) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      if (typeof toast === 'function') toast('OK', 'Copiado.');
      return true;
    } catch(e) {
      if (typeof toast === 'function') toast('Erro', 'Nao foi possivel copiar.');
      return false;
    }
  }

  async function renderPaymentQrFallback() {
    const el = document.querySelector('[data-chat-qrcode="1"]');
    if (!el || el.dataset.done === '1' || !state.payment?.qr_code) return;
    el.dataset.done = '1';
    try {
      const QRCodeLib = window.QRCode || (typeof _ensureQRCodeLib === 'function' ? await _ensureQRCodeLib() : null);
      if (!QRCodeLib) throw new Error('QRCode indisponivel');
      el.innerHTML = '';
      new QRCodeLib(el, { text: state.payment.qr_code, width: 154, height: 154, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCodeLib.CorrectLevel?.M });
    } catch(e) {
      el.innerHTML = '<span style="font-size:12px;color:#64748b;text-align:center;padding:12px">Use o codigo copia e cola abaixo.</span>';
    }
  }

  async function handleQuickReplyClick(ev) {
    const copyBtn = ev.target.closest('[data-chat-copy]');
    if (copyBtn) {
      await copyText(paymentCode(state.payment));
      return;
    }

    const waBtn = ev.target.closest('[data-chat-wa]');
    if (waBtn) {
      const link = waBtn.getAttribute('data-chat-wa') || '';
      if (link) window.open(link, '_blank', 'noopener');
      return;
    }

    const followBtn = ev.target.closest('[data-follow-choice]');
    if (followBtn) {
      const choice = followBtn.getAttribute('data-follow-choice');
      if (choice === 'wa') {
        const link = state.follow?.waLink || '';
        if (link) window.open(link, '_blank', 'noopener');
        if (state.follow) state.follow.chosen = 'wa';
        saveSession();
        render();
        return;
      }
      if (choice === 'chat') {
        if (state.follow) state.follow.chosen = 'chat';
        saveSession();
        render();
        await sendChatText('Acompanhar pela EstimaIA');
        return;
      }
    }

    const sendBtn = ev.target.closest('[data-quick-send]');
    if (sendBtn) {
      const mid = sendBtn.getAttribute('data-quick-send');
      const selected = state.quickSelections[mid] || [];
      if (!selected.length) return;
      const body = selected.includes('sem') ? 'sem' : selected.join(' e ');
      const ok = await sendQuickReply(body, sendBtn);
      if (ok) delete state.quickSelections[mid];
      return;
    }

    const btn = ev.target.closest('[data-quick-value]');
    if (!btn) return;
    const mid = btn.getAttribute('data-quick-mid');
    const type = btn.getAttribute('data-quick-type') || 'single';
    const value = String(btn.getAttribute('data-quick-value') || '').trim();
    const action = String(btn.getAttribute('data-quick-action') || '').trim();
    if (!mid || !value) return;

    if (action === 'location') {
      await sendCurrentLocation(btn);
      return;
    }

    if (type === 'multi') {
      const current = state.quickSelections[mid] || [];
      if (value === 'sem') {
        state.quickSelections[mid] = current.includes(value) ? [] : ['sem'];
      } else {
        const withoutSkip = current.filter(v => v !== 'sem');
        state.quickSelections[mid] = withoutSkip.includes(value)
          ? withoutSkip.filter(v => v !== value)
          : withoutSkip.concat(value);
      }
      render();
      return;
    }

    sendQuickReply(value, btn);
  }

  function render() {
    ensureDom();
    updateViewportVars();
    renderTitle();
    const root = document.getElementById('ef-chat-root');
    const bubble = document.getElementById('ef-chat-bubble');
    const panel = document.getElementById('ef-chat-panel');
    const badge = document.getElementById('ef-chat-badge');
    const msgs = document.getElementById('ef-chat-msgs');
    const orderBox = document.getElementById('ef-chat-order');
    const sub = document.getElementById('ef-chat-sub');
    const startBox = document.getElementById('ef-chat-start');
    const form = document.getElementById('ef-chat-form');
    const hasTenant = !!(state.tid || tid());
    const hasSession = hasTrackingContext();
    const nudgeCount = renderNudges();
    if (!hasSession && state.open) state.open = false;
    const panelOpen = state.open && hasSession;
    updateStartText();
    bubble.classList.toggle('on', hasSession);
    panel.classList.toggle('on', panelOpen);
    root.classList.toggle('efc-open', panelOpen);
    document.body.classList.toggle('ef-chat-open', panelOpen);
    setTrackingSuppressed(panelOpen);
    root.classList.toggle('efc-cart-on', !!document.getElementById('cart-float')?.classList.contains('show'));

    const unread = Math.max(0, Number(state.unread || state.thread?.unread_client || 0));
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.classList.toggle('on', unread > 0);
    root.classList.toggle('efc-show-nudge', false);

    const order = activeOrderFromState() || {};
    const num = state.orderNum || order.order_num || order.num || '';
    const label = order.status_label || '';
    const pendingOnline = isPendingOnlinePayment(order);
    sub.textContent = num ? ('Pedido #' + num) : (hasSession ? (pendingOnline ? 'Aguardando pagamento' : 'Pedido em acompanhamento') : 'EstimaIA');
    if (hasSession) {
      orderBox.innerHTML = num
        ? `<strong>Pedido #${esc(num || '')}</strong>${label ? ' - ' + esc(label) : ''}${order.items_text ? '<br>' + esc(order.items_text) : ''}`
        : (pendingOnline
          ? '<strong>Pedido aguardando pagamento</strong><br>O numero publico sera exibido depois da confirmacao.'
          : '<strong>Pedido em acompanhamento</strong><br>O numero publico sera exibido assim que estiver disponivel.');
    } else {
      orderBox.innerHTML = '<strong>Chat de acompanhamento</strong><br>O chat fica disponivel depois que o pedido e realizado.';
    }
    if (startBox) startBox.classList.toggle('on', false);
    if (form) form.style.display = hasSession ? 'flex' : 'none';
    if (!hasSession) {
      msgs.innerHTML = '<div class="efc-empty">Depois que houver um pedido, as mensagens aparecem aqui.</div>';
      return;
    }

    const extras = extraCardsHtml();
    if (!state.messages.length && !extras) {
      msgs.innerHTML = '<div class="efc-empty">As mensagens do pedido aparecem aqui.</div>';
      return;
    }
    const lastQuickId = latestQuickMessageId();
    const messageHtml = state.messages.map(m => {
      const cls = m.sender === 'client' ? 'client' : (m.sender === 'system' ? 'system' : 'store');
      return `<div class="efc-msg ${cls}">
        <div class="efc-msg-body">${esc(m.body)}</div>
        ${m.sender !== 'system' ? `<div class="efc-time">${esc(messageTime(m))}</div>` : ''}
      </div>${quickRepliesHtml(m, lastQuickId)}`;
    }).join('');
    msgs.innerHTML = messageHtml + extras;
    renderPaymentQrFallback();
    autoSizeChatInput();
    scrollMessagesToBottom();
  }

  async function markRead() {
    if (!state.thread?.id || !state.phone) return;
    state.unread = 0;
    render();
    try {
      await api('/api/chat/read', {
        method: 'POST',
        body: JSON.stringify({ thread_id: state.thread.id, order_id: state.orderId, phone: state.phone, viewer: 'client' })
      });
    } catch(e) {}
  }

  function openPanel() {
    if (!hasTrackingContext()) {
      state.open = false;
      if (typeof toast === 'function') toast('Chat', 'O chat fica disponivel apos realizar um pedido.');
      render();
      return;
    }
    state.open = true;
    try { document.getElementById('track-drawer-bg')?.classList.remove('on'); } catch(e) {}
    setTrackingSuppressed(true);
    ensureNotificationPermission();
    updateViewportVars();
    saveSession();
    render();
    fillStartFromProfile();
    markRead();
    const focusInput = () => {
      const input = document.getElementById('ef-chat-input');
      if (!input) return;
      input.focus({ preventScroll: true });
      scrollMessagesToBottom(180);
    };
    setTimeout(focusInput, 80);
  }

  function closePanel() {
    state.open = false;
    try { document.body.classList.remove('ef-chat-open'); } catch(e) {}
    try { document.getElementById('ef-chat-root')?.classList.remove('efc-open'); } catch(e) {}
    setTrackingSuppressed(false);
    saveSession();
    render();
  }

  function fillStartFromProfile() {
    try {
      const profile = JSON.parse(localStorage.getItem('ef_profile_' + (state.tid || tid() || '')) || 'null') || {};
      const oldOrder = readJson(orderStorageKey()) || {};
      const name = profile.name || oldOrder.client || state.client || '';
      const phone = profile.phone || oldOrder.phone || state.phone || '';
      const nEl = document.getElementById('ef-chat-start-name');
      const pEl = document.getElementById('ef-chat-start-phone');
      if (nEl && !nEl.value) nEl.value = name;
      if (pEl && !pEl.value) pEl.value = phone;
    } catch(e) {}
  }

  async function startChat(ev) {
    ev.preventDefault();
    if (typeof toast === 'function') toast('Chat', 'O chat fica disponivel apos realizar um pedido.');
    return;
  }

  async function sendChatText(body, btn) {
    body = String(body || '').trim();
    if (!body || !hasTrackingContext()) return false;
    const oldOrderId = state.orderId || 0;
    if (btn) btn.disabled = true;
    try {
      const r = await api('/api/chat/send', {
        method: 'POST',
        body: JSON.stringify({ thread_id: state.thread?.id || state.threadId || null, order_id: state.orderId || 0, phone: state.phone, sender: 'client', body, client: state.client })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || 'Falha ao enviar');
      if (data.thread) state.thread = data.thread;
      state.threadId = state.thread?.id || state.threadId;
      if (data.thread?.order_id != null) state.orderId = data.thread.order_id;
      if (data.thread?.order_num) state.orderNum = data.thread.order_num;
      if (data.order) state.order = data.order;
      if (data.order?.id) state.orderId = data.order.id;
      if (data.message) mergeMessages([data.message]);
      const finalReset = applyFinalOrderReset(data.order || data.thread?.order || null);
      saveSession();
      if (finalReset || Number(state.orderId || 0) !== Number(oldOrderId || 0)) connectSSE();
      render();
      return true;
    } catch(e) {
      if (typeof toast === 'function') toast('Erro', e?.message || 'Nao foi possivel enviar a mensagem.');
      return false;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function sendMessage(ev) {
    ev.preventDefault();
    const input = document.getElementById('ef-chat-input');
    const btn = document.getElementById('ef-chat-send');
    const ok = await sendChatText(input?.value || '', btn);
    if (ok && input) {
      input.value = '';
      autoSizeChatInput();
    }
  }

  function sendQuickReply(value, btn) {
    return sendChatText(value, btn);
  }

  function chatReadGlobal(name) {
    try {
      if (name === '_storeLat' && typeof _storeLat !== 'undefined') return _storeLat;
      if (name === '_storeLng' && typeof _storeLng !== 'undefined') return _storeLng;
    } catch(e) {}
    return window[name];
  }

  function chatDistKm(lat1, lon1, lat2, lon2) {
    const toRad = v => Number(v) * Math.PI / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function reverseGeoForChat(lat, lng) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1&accept-language=pt-BR`, {
        headers: { 'Accept': 'application/json' }
      });
      const data = await r.json().catch(() => ({}));
      const a = data?.address || {};
      const rua = a.road || a.pedestrian || a.footway || a.path || '';
      const bairro = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.village || '';
      const cidade = a.city || a.town || a.municipality || '';
      return [rua, bairro, cidade].filter(Boolean).join(', ');
    } catch(e) {
      return '';
    }
  }

  async function sendCurrentLocation(btn) {
    if (!navigator.geolocation) {
      if (typeof toast === 'function') toast('Erro', 'Este aparelho nao permite enviar localizacao.');
      return false;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Obtendo...';
    }
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
      });
      const lat = Number(pos.coords.latitude);
      const lng = Number(pos.coords.longitude);
      const storeLat = Number(chatReadGlobal('_storeLat') || 0);
      const storeLng = Number(chatReadGlobal('_storeLng') || 0);
      const dist = storeLat && storeLng ? chatDistKm(storeLat, storeLng, lat, lng) : null;
      const approx = await reverseGeoForChat(lat, lng);
      const linhas = [
        'Localizacao confirmada pelo cliente.',
        'Latitude: ' + lat.toFixed(6),
        'Longitude: ' + lng.toFixed(6),
        dist != null ? 'Distancia da loja: ' + dist.toFixed(2) + ' km' : '',
        approx ? 'Endereco aproximado: ' + approx : ''
      ].filter(Boolean);
      return sendChatText(linhas.join('\n'), btn);
    } catch(e) {
      const msg = e?.code === 1 ? 'Permissao de localizacao negada.' : 'Nao foi possivel obter a localizacao.';
      if (typeof toast === 'function') toast('Localizacao', msg);
      return false;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Enviar localizacao';
      }
    }
  }

  function connectSSE() {
    if (state.sse) {
      try { state.sse.close(); } catch(e) {}
      state.sse = null;
    }
    if (!state.tid || !state.phone || typeof EventSource === 'undefined') return;
    const channelOrder = state.orderId || 0;
    const channel = `chat-client:${state.tid}:${channelOrder}:${digits(state.phone)}`;
    const es = new EventSource('/sse/' + encodeURIComponent(channel));
    es.addEventListener('chat:message', ev => {
      try {
        const data = JSON.parse(ev.data || '{}');
        if (state.thread?.id && data?.thread?.id && Number(data.thread.id) !== Number(state.thread.id)) return;
        if (data.thread) state.thread = data.thread;
        if (data.order) state.order = data.order;
        if (data.order?.id) state.orderId = data.order.id;
        if (data.message) {
          const alreadyHad = state.messages.some(m => Number(m.id) === Number(data.message.id));
          mergeMessages([data.message]);
          if (!alreadyHad && data.message.sender !== 'client') {
            playChatSound();
            if (document.hidden || !state.open) showBrowserNotification(storeName(), data.message.body || 'Seu pedido foi atualizado.');
          }
          if (!state.open && data.message.sender !== 'client') state.unread = Math.max(state.unread || 0, Number(state.thread?.unread_client || 0));
        }
        const finalReset = applyFinalOrderReset(data.order || data.thread?.order || null);
        saveSession();
        if (finalReset) connectSSE();
        render();
      } catch(e) {}
    });
    es.addEventListener('chat:read', ev => {
      try {
        const data = JSON.parse(ev.data || '{}');
        if (state.thread?.id && data?.thread?.id && Number(data.thread.id) !== Number(state.thread.id)) return;
        if (data.thread) state.thread = data.thread;
        state.unread = Number(state.thread?.unread_client || 0);
        const finalReset = applyFinalOrderReset(data.thread?.order || null);
        if (finalReset) saveSession();
        if (finalReset) connectSSE();
        render();
      } catch(e) {}
    });
    es.onerror = () => {};
    state.sse = es;
  }

  async function bootstrap(openAfter) {
    if (state.booting || !state.tid || !state.phone || trackingOrderId() <= 0) return;
    state.booting = true;
    ensureDom();
    render();
    try {
      let r;
      if (state.orderId) {
        const qs = new URLSearchParams({ order_id: state.orderId, phone: state.phone });
        r = await api('/api/chat/bootstrap?' + qs.toString());
      } else if (state.threadId) {
        const qs = new URLSearchParams({ thread_id: state.threadId, phone: state.phone });
        r = await api('/api/chat/messages?' + qs.toString());
      } else {
        const qs = new URLSearchParams({ phone: state.phone, client: state.client || '' });
        r = await api('/api/chat/bootstrap?' + qs.toString());
      }
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || 'Chat indisponivel');
      const serverOrder = data.order || data.thread?.order || null;
      state.thread = data.thread || null;
      state.threadId = state.thread?.id || state.threadId || null;
      state.order = serverOrder;
      state.orderId = data.order?.id || data.thread?.order_id || state.orderId || 0;
      state.orderNum = data.order?.order_num || data.thread?.order_num || state.orderNum;
      state.unread = Number(state.thread?.unread_client || 0);
      const incoming = Array.isArray(data.messages) ? data.messages : [];
      if (incoming.length || !state.messages.length) {
        state.messages = [];
        mergeMessages(incoming);
      }
      applyFinalOrderReset(serverOrder);
      saveSession();
      connectSSE();
      if (openAfter) state.open = true;
      render();
      if (openAfter) markRead();
    } catch(e) {
      render();
    } finally {
      state.booting = false;
    }
  }

  function closeFollowPrompt() {
    const el = document.getElementById('ef-follow-prompt');
    if (el) el.remove();
  }

  function whatsappLinkFromPayload(payload) {
    payload = payload || {};
    if (payload.waLink) return payload.waLink;
    const btn = document.getElementById('success-wa-btn');
    if (btn?.href && !btn.href.endsWith('#')) return btn.href;
    try {
      if (typeof buildWaLink === 'function') {
        return buildWaLink(payload.orderId || payload.id || state.orderId, payload.orderNum || payload.order_num || state.orderNum);
      }
    } catch(e) {}
    return '';
  }

  function normalizeFollowPayload(payload) {
    payload = payload || {};
    return {
      orderId: payload.orderId || payload.id || state.orderId,
      orderNum: payload.orderNum || payload.order_num || state.orderNum,
      phone: digits(payload.phone || state.phone),
      client: payload.client || state.client || '',
      storeName: payload.storeName || payload.store_name || storeName()
    };
  }

  function showFollowPrompt(payload) {
    payload = payload || {};
    showOrderCreated(payload, { open: true });
    return;
    ensureDom();
    const data = normalizeFollowPayload(payload);
    if (data.storeName) setStoreName(data.storeName);
    if (data.orderId && data.phone) {
      state.tid = tid();
      state.orderId = data.orderId;
      state.orderNum = data.orderNum;
      state.phone = data.phone;
      state.client = data.client;
      saveSession();
      bootstrap(false);
    }

    closeFollowPrompt();
    const link = whatsappLinkFromPayload(payload);
    const showWa = !!link && payload.whatsappEnabled !== false;
    const loja = storeName();
    const layer = document.createElement('div');
    layer.id = 'ef-follow-prompt';
    layer.className = 'ef-follow-layer';
    layer.innerHTML = `
      <div class="ef-follow-card" role="dialog" aria-live="polite" aria-label="Acompanhar pedido">
        <button class="ef-follow-close" type="button" data-ef-follow-close title="Fechar" aria-label="Fechar">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
        <div class="ef-follow-bot" aria-hidden="true">
          <span class="ef-follow-eye left"></span>
          <span class="ef-follow-eye right"></span>
          <span class="ef-follow-mouth"></span>
        </div>
        <div>
          <div class="ef-follow-kicker">Acompanhe seu pedido</div>
          <div class="ef-follow-title">Pedido recebido</div>
          <div class="ef-follow-text">Escolha por onde deseja acompanhar as atualizações em tempo real da ${esc(loja)}.</div>
          <div class="ef-follow-actions">
            ${showWa ? '<button class="ef-follow-btn wa" type="button" data-ef-follow-wa>WhatsApp</button>' : ''}
            <button class="ef-follow-btn primary" type="button" data-ef-follow-chat>EstimaIA</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(layer);
    layer.addEventListener('click', ev => {
      if (ev.target === layer || ev.target.closest('[data-ef-follow-close]')) closeFollowPrompt();
    });
    layer.querySelector('[data-ef-follow-chat]')?.addEventListener('click', () => {
      closeFollowPrompt();
      if (typeof window.efChatStart === 'function') window.efChatStart(data, { open: true });
      else openPanel();
    });
    layer.querySelector('[data-ef-follow-wa]')?.addEventListener('click', () => {
      closeFollowPrompt();
      if (link) window.open(link, '_blank', 'noopener');
    });
    window.setTimeout(() => {
      const cur = document.getElementById('ef-follow-prompt');
      if (cur === layer) closeFollowPrompt();
    }, 35000);
  }

  window.efChatStart = function(payload, opts) {
    payload = payload || {};
    state.tid = tid();
    state.orderId = payload.orderId || payload.id || state.orderId;
    state.orderNum = payload.orderNum || payload.order_num || state.orderNum;
    state.phone = digits(payload.phone || state.phone);
    state.client = payload.client || state.client || '';
    setStoreName(payload.storeName || payload.store_name || window._storeName || state.storeName);
    state.open = !!(opts && opts.open);
    saveSession();
    bootstrap(state.open);
  };

  function showOrderCreated(payload, opts) {
    payload = payload || {};
    opts = opts || {};
    ensureDom();
    state.tid = tid();
    state.orderId = payload.orderId || payload.id || state.orderId;
    state.orderNum = payload.orderNum || payload.order_num || state.orderNum;
    state.phone = digits(payload.phone || state.phone);
    state.client = payload.client || state.client || '';
    if (payload.storeName || payload.store_name) setStoreName(payload.storeName || payload.store_name);
    state.follow = {
      orderId: Number(state.orderId || 0),
      orderNum: state.orderNum || '',
      waLink: whatsappLinkFromPayload(payload),
      chosen: ''
    };
    state.open = opts.open !== false;
    saveSession();
    bootstrap(state.open);
    render();
    if (state.open) setTimeout(markRead, 250);
  }

  window.efChatShowOrderCreated = showOrderCreated;
  window.efChatShowPayment = function(payload) {
    ensureDom();
    const card = normalizePaymentPayload(payload);
    if (card.orderId) state.orderId = card.orderId;
    if (card.orderNum) state.orderNum = card.orderNum;
    if (payload?.phone) state.phone = digits(payload.phone);
    if (payload?.client) state.client = payload.client;
    if (payload?.storeName || payload?.store_name) setStoreName(payload.storeName || payload.store_name);
    state.payment = card;
    state.open = true;
    saveSession();
    render();
  };
  window.efChatUpdatePayment = function(payload) {
    payload = payload || {};
    if (!state.payment) return;
    const orderId = Number(payload.orderId || payload.order_id || 0);
    if (orderId && state.payment.orderId && Number(state.payment.orderId) !== orderId) return;
    state.payment = Object.assign({}, state.payment, normalizePaymentPayload(Object.assign({}, state.payment, payload)));
    saveSession();
    render();
  };
  window.efChatOpen = openPanel;
  window.efChatSetTenant = setTenantId;
  window.efChatSetStoreName = setStoreName;
  window.efChatShowFollowPrompt = showFollowPrompt;
  window.efChatRefreshNudges = function() {
    ensureDom();
    renderNudges();
    render();
  };

  function bootFromStorage() {
    state.tid = tid();
    if (!state.tid) return false;
    const data = loadSession();
    if (!data) return false;
    state.orderId = data.orderId || 0;
    state.threadId = data.threadId || null;
    state.orderNum = data.orderNum || null;
    state.phone = digits(data.phone);
    state.client = data.client || '';
    restoreCachedState(data);
    render();
    bootstrap(state.open);
    return true;
  }

  installSoundUnlock();

  document.addEventListener('DOMContentLoaded', () => {
    ensureDom();
    installSoundUnlock();
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (bootFromStorage() || tries > 40) clearInterval(timer);
      render();
    }, 500);
  });
})();

// ── cardapio-acougue.js ──────────────────────────────────────────
// ══════════════════════════════════════════
//  AÇOUGUE — Cortes, peso, preparo, grupos/complementos
//  Estima Food — Cardápio
// ══════════════════════════════════════════
// ══════════════════════════════════════════
//  GRUPOS DE CUSTOMIZAÇÃO — CARDÁPIO
// ══════════════════════════════════════════
let _imGruposState = {}; // { [grupoNome]: [{nome,preco,qty}] }

// ══════════════════════════════════════════
//  AÇOUGUE — Estado e helpers
// ══════════════════════════════════════════
let _acougueCortes  = {}; // { [corteNome]: { peso: 0, separar: '', extra: '' } }
let _acougueAtual   = null;
let _acouguePesos   = [];
let _pesoConfirmadoPeloUsuario = false;

// Ilustrações dos cortes e ícones de preparo — servidos localmente pelo
// próprio servidor (sem depender de link externo por questão de direitos autorais).
// Arquivos ficam em:
//   cardapio/img/cortes/<nome>.png   (ilustração de cada corte)
//   cardapio/img/tags/<nome>.png     (ícone de cada modo de preparo)
const _IMG_CORTES = '/cardapio/img/cortes';
const _IMG_TAGS   = '/cardapio/img/tags';

const _corteImgMap = {
  moido:      `${_IMG_CORTES}/moida-2x.png`,
  moido2x:    `${_IMG_CORTES}/moida-2x.png`,
  tiras:      `${_IMG_CORTES}/tiras.png`,
  tirinha:    `${_IMG_CORTES}/tirinhas.png`,
  tirinhas:   `${_IMG_CORTES}/tirinhas.png`,
  strogonoff: `${_IMG_CORTES}/strogonoff.png`,
  inteiro:    `${_IMG_CORTES}/inteira.png`,
  inteira:    `${_IMG_CORTES}/inteira.png`,
  espeto:     `${_IMG_CORTES}/espeto.png`,
  cubos:      `${_IMG_CORTES}/cubos.png`,
  picado:     `${_IMG_CORTES}/picado.png`,
  grelha:     `${_IMG_CORTES}/grelha.png`,
  peca:       `${_IMG_CORTES}/peca.png`,
  bife:       `${_IMG_CORTES}/bifemedio.png`,
  bifefino:   `${_IMG_CORTES}/bifefino.png`,
  bifemedio:  `${_IMG_CORTES}/bifemedio.png`,
  bifegrosso: `${_IMG_CORTES}/bifegrosso.png`,
  postas:     `${_IMG_CORTES}/postas.png`,
  default:    `${_IMG_CORTES}/bifemedio.png`,
};

const _preparoImgMap = {
  dia_a_dia:  `${_IMG_TAGS}/dia_a_dia.png`,
  churrasco:  `${_IMG_TAGS}/churrasco.png`,
  resfriado:  `${_IMG_TAGS}/wind.png`,
  grelhar:    `${_IMG_TAGS}/grellhar.png`,
  grelhado:   `${_IMG_TAGS}/grellhar.png`,
  grelha:     `${_IMG_TAGS}/grellhar.png`,
  defumado:   `${_IMG_TAGS}/smoker.png`,
  frigideira: `${_IMG_TAGS}/frigideira.png`,
  forno:      `${_IMG_TAGS}/forno.png`,
  airfryer:   `${_IMG_TAGS}/airfryer.png`,
  panela:     `${_IMG_TAGS}/panela.png`,
  ensopado:   `${_IMG_TAGS}/ensopado.png`,
  espeto:     `${_IMG_TAGS}/espeto.png`,
};

// Cada ícone tem 2 arquivos: "nome.png" (tinta escura, pra tema claro)
// Antes existiam duas versões de cada ícone (uma pro tema claro, outra pro
// escuro) — dava confusão de qual botão do admin trocava qual, e às vezes
// a foto certa acabava indo pro lugar errado. Agora é uma imagem só, igual
// pros dois temas — mais simples e sem esse risco.
function _acIconUrl(baseUrl) {
  return baseUrl;
}

// alt = texto alternativo (acessibilidade); size = px
// A classe "ac-ico" cuida da animação de entrada + hover (CSS, em index.html).
let _iconesVer = null;
// Alguns preparos têm o nome do ARQUIVO (histórico, com erro de digitação)
// diferente do ID usado nos itens do cardápio — hoje só "grellhar"
// (arquivo em /api/icones-version) vs "grelhar" (id real usado em
// _preparoImgMap e nos itens). Sem isso, o vídeo/foto sobe certinho no
// admin mas o cardápio do cliente nunca reconhece porque procura por
// "grelhar" — o preparo cai sempre no <img> de fallback (fica branco).
const _ICONE_TAG_KEY_TO_PREPARO_ID = { grellhar: 'grelhar' };
// Chaves de "forma de preparo" que têm vídeo customizado no lugar do ícone
// estático (só existe pra tags, nunca pra cortes) — vem de /api/icones-version.
let _preparoVideoTags = new Set();
// Chaves de "forma de preparo" que têm FOTO customizada (PNG real, não o
// ícone de linha padrão) — usadas pra pular o filtro brightness(0)+invert(1)
// que deixaria a foto toda branca. Vem de /api/icones-version.
let _preparoPhotoTags = new Set();
(function _carregarIconesVersion(){
  fetch('/api/icones-version').then(r => r.ok ? r.json() : null).then(d => {
    if (d?.version) {
      _iconesVer = d.version;
      // Inclui tanto a chave de arquivo quanto o id real do preparo (quando
      // diferentes), pra bater com o id usado nos itens do cardápio.
      const _comAlias = (lista) => {
        const s = new Set(lista || []);
        (lista || []).forEach(k => { if (_ICONE_TAG_KEY_TO_PREPARO_ID[k]) s.add(_ICONE_TAG_KEY_TO_PREPARO_ID[k]); });
        return s;
      };
      _preparoVideoTags = _comAlias(d.videoTags);
      _preparoPhotoTags = _comAlias(d.photoTags);
      // Se os ícones já apareceram na tela antes da versão chegar, atualiza
      // a src deles agora pra garantir que não ficou uma versão em cache.
      document.querySelectorAll('img.ac-ico').forEach(img => {
        if (!img.src.includes('?v=')) img.src += '?v=' + _iconesVer;
      });
      // Mesma correção pros ícones de "forma de preparo" do robozinho e do
      // banner de filtro ativo (_preparoCardIconHtml, em cardapio-menu.js) —
      // eles usam outro caminho de renderização, sem a classe "ac-ico", e
      // por isso não eram pegos pela correção acima. Sem isso, se a tela já
      // tivesse desenhado o ícone antes dessa versão chegar, uma foto real
      // subida pelo admin continuava aparecendo com o filtro preto-e-branco
      // (pensado só pro ícone de linha padrão) até a página ser recarregada.
      document.querySelectorAll('[data-preparo-id]').forEach(el => {
        const id = el.dataset.preparoId;
        if (!id) return;
        if (el.tagName === 'IMG') {
          if (_preparoPhotoTags.has(id)) el.classList.add('preparo-foto');
          else el.classList.remove('preparo-foto');
          if (!el.src.includes('?v=')) el.src += '?v=' + _iconesVer;
        } else if (el.tagName === 'VIDEO' && !el.src.includes('?v=')) {
          el.src += '?v=' + _iconesVer;
        }
      });
    }
  }).catch(() => {});
})();
function _imgTag(baseUrl, alt, size) {
  const s = size || 60;
  const src = _acIconUrl(baseUrl) + (_iconesVer ? ('?v=' + _iconesVer) : '');
  return `<img class="ac-ico" src="${src}" alt="${alt}" width="${s}" height="${s}" style="object-fit:contain;display:block" onerror="this.onerror=null;this.src='${baseUrl}'">`;
}
// Ícone (ou vídeo) de uma forma de preparo. Se o admin subiu um vídeo pra
// esse preparo, mostra <video> em loop mudo em vez da imagem estática —
// recurso exclusivo de "Formas de preparo" (tags), cortes nunca têm vídeo.
function _preparoMediaHtml(key, baseUrl, alt, size) {
  if (key && _preparoVideoTags.has(key)) {
    const v = _iconesVer ? ('?v=' + _iconesVer) : '';
    return `<video class="ac-ico" src="${_IMG_TAGS}/${key}.mp4${v}" autoplay muted loop playsinline disablepictureinpicture aria-label="${alt}"></video>`;
  }
  return baseUrl ? _imgTag(baseUrl, alt, size) : null;
}

// Acha a foto de um produto real do cardápio comparando pelo nome — usado
// pela lista de texto do kit ("500g Bife de Patinho"), que é só texto
// digitado pelo gestor e não referencia o item de verdade diretamente.
function _normalizarNome(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').trim();
}
function _buscarFotoPorNome(nome) {
  const fonte = (typeof allItems !== 'undefined' && Array.isArray(allItems)) ? allItems : [];
  if (!fonte.length) return null;
  const alvo = _normalizarNome(nome);
  if (!alvo) return null;
  // 1) match exato do nome normalizado
  let achado = fonte.find(i => i.image_url && _normalizarNome(i.name) === alvo);
  // 2) um nome contém o outro (ex: "bife de patinho" dentro de "bife de patinho grelha")
  // — só aceita se o menor dos dois tiver pelo menos 5 caracteres, senão nomes
  // curtos tipo "carne" combinariam com qualquer coisa e pegaria foto errada.
  if (!achado) achado = fonte.find(i => {
    if (!i.image_url) return false;
    const n = _normalizarNome(i.name);
    const menor = Math.min(n.length, alvo.length);
    if (menor < 5) return false;
    return alvo.includes(n) || n.includes(alvo);
  });
  return achado ? achado.image_url : null;
}

function _getCorteIlus(nome) {
  const n = (nome||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  let key = 'default';
  if      (n.includes('strogon'))                           key = 'strogonoff';
  else if (n.includes('posta'))                             key = 'postas';
  else if (n.includes('tirinha') || n.includes('tirinhas')) key = 'tirinha';
  else if (n.includes('tira'))                              key = 'tiras';
  else if (n.includes('moido') && n.includes('2'))          key = 'moido2x';
  else if (n.includes('moido') || n.includes('moer') || n.includes('moida')) key = 'moido';
  else if (n.includes('cubo'))                              key = 'cubos';
  else if (n.includes('picado'))                            key = 'picado';
  else if (n.includes('grelha'))                            key = 'grelha';
  else if (n.includes('peca') || n.includes('peca'))        key = 'peca';
  else if (n.includes('bifefino') || (n.includes('bife') && n.includes('fino'))) key = 'bifefino';
  else if (n.includes('bifegrosso') || (n.includes('bife') && n.includes('grosso'))) key = 'bifegrosso';
  else if (n.includes('bifemedio') || (n.includes('bife') && n.includes('medio'))) key = 'bifemedio';
  else if (n.includes('bife'))                              key = 'bife';
  else if (n.includes('espeto'))                            key = 'espeto';
  else if (n.includes('inteiro') || n.includes('inteira'))  key = 'inteiro';
  const url = _corteImgMap[key] || _corteImgMap.default;
  return _imgTag(url, nome, 60);
}

function _getPreparoIcon(nome) {
  const n = (nome||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  let key = null;
  if      (n.includes('dia'))        key = 'dia_a_dia';
  else if (n.includes('churrasco'))  key = 'churrasco';
  else if (n.includes('resfriado') || n.includes('frio') || n.includes('wind')) key = 'resfriado';
  else if (n.includes('grelh'))      key = 'grelhar';
  else if (n.includes('defum') || n.includes('smok')) key = 'defumado';
  else if (n.includes('frigideira') || n.includes('frigid')) key = 'frigideira';
  else if (n.includes('forno'))      key = 'forno';
  else if (n.includes('airfryer') || n.includes('air fryer')) key = 'airfryer';
  else if (n.includes('panela'))     key = 'panela';
  else if (n.includes('ensopado'))   key = 'ensopado';
  else if (n.includes('espeto'))     key = 'espeto';
  if (key && _preparoImgMap[key]) {
    const html = _preparoMediaHtml(key, _preparoImgMap[key], nome, 20);
    if (html) return html;
  }
  // fallback SVG genérico
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.4"/></svg>`;
}

function _isAcougueItem(item) {
  const cgs = item.custom_groups || [];
  return (item.item_type === 'kg' || item.itemType === 'kg' || item.tipo === 'kg') ||
         cgs.some(g => g.tipo === 'cortes' || g.tipo === 'pesos');
}

function _isKitItem(item) {
  if (item.item_type === 'kit' || item.itemType === 'kit' || item.tipo === 'kit') return true;
  // Fallback: mesma robustez do lado do gestor (_pedidoIsKitItem em
  // gestor-pedidos.js) — se o item tem um grupo kit_itens/kit_categorias
  // configurado mas o campo item_type ficou como "normal" (item antigo,
  // editado antes do seletor "Kit / Combo" existir, etc.), ainda assim
  // trata como kit. Sem isso a seção "Itens inclusos no kit" nunca
  // aparecia pro cliente e o conteúdo do kit não ia pro obs — a comanda
  // saía sem os itens inclusos.
  const cgs = item.custom_groups || item.customGroups || [];
  return Array.isArray(cgs) && cgs.some(g => g?.tipo === 'kit_itens' || g?.tipo === 'kit_categorias');
}

function renderImGrupos(item) {
  const wrap = document.getElementById('im-grupos-wrap');
  if (!wrap) return;
  const grupos = item.custom_groups || [];
  if (!grupos.length) { wrap.innerHTML = ''; return; }

  // ── Garante lista de esgotados atualizada antes de renderizar ──
  // O Supabase Realtime PODE não estar publicando addons_esgotados (depende da
  // configuração do projeto). Em vez de confiar só nele, fazemos um fetch fresco
  // a cada abertura de modal — leva ~150ms e garante que o cliente vê o estado
  // real do servidor, mesmo se ficou minutos com o cardápio aberto.
  if (typeof loadAddonsEsgotados === 'function') {
    loadAddonsEsgotados().then(() => _renderImGruposNow(item)).catch(() => _renderImGruposNow(item));
    return;
  }
  _renderImGruposNow(item);
}

function _renderImGruposNow(item) {
  const wrap = document.getElementById('im-grupos-wrap');
  if (!wrap) return;
  const grupos = item.custom_groups || [];
  if (!grupos.length) { wrap.innerHTML = ''; return; }

  // ── Modo açougue ────────────────────────────────────────
  if (_isAcougueItem(item)) {
    _acougueCortes = {};
    _acouguePesos  = (grupos.find(g => g.tipo === 'pesos')?.valores) || [];
    _renderAcougueGrupos(item, wrap, grupos);
    // Renderiza grupos genéricos (radio/checkbox) após os grupos de açougue
    const _ACOUGUE_TIPOS = ['cortes','preparos','ocasiao','armazenamento','pesos','porcao_ref','kit_itens','pizza_sizes'];
    const genericGrupos  = grupos.filter(g => !_ACOUGUE_TIPOS.includes(g.tipo));
    if (genericGrupos.length) {
      wrap.innerHTML += genericGrupos.map(g => {
        const isRequired = g.required === true;
        const badge = isRequired
          ? `<span class="grp-required-badge">Obrigatório</span>`
          : `<span class="grp-optional-badge">Opcional</span>`;
        const optsHtml = (g.opcoes || []).map(o => {
          const esgotado = _isAddonEsgotado(o.nome);
          const indisponivelHoje = !esgotado && _addonIndisponivelHoje(o.dias);
          const bloqueado = esgotado || indisponivelHoje;
          const priceLabel = bloqueado
            ? `<span class="grp-opt-price" style="color:var(--muted);text-decoration:line-through">+ R$ ${fmt(o.preco||0)}</span>`
            : (o.preco > 0
              ? `<span class="grp-opt-price">+ R$ ${fmt(o.preco)}</span>`
              : `<span class="grp-opt-price free">Grátis</span>`);
          const indicator = g.tipo === 'checkbox'
            ? `<div class="grp-opt-indicator multi"></div>`
            : `<div class="grp-opt-indicator"></div>`;
          const qtyEl = g.tipo === 'checkbox' && !bloqueado
            ? `<div class="grp-opt-qty" id="gqty_${_slug(g.nome)}_${_slug(o.nome)}">
                 <button class="grp-qty-btn" onclick="event.stopPropagation();grpQty('${_escape(g.nome)}','${_escape(o.nome)}',${o.preco||0},-1)">−</button>
                 <span class="grp-qty-num" id="gqnum_${_slug(g.nome)}_${_slug(o.nome)}">1</span>
                 <button class="grp-qty-btn" onclick="event.stopPropagation();grpQty('${_escape(g.nome)}','${_escape(o.nome)}',${o.preco||0},1)">+</button>
               </div>` : '';
          const esgBadge = esgotado
            ? `<span class="grp-esg-badge" style="background:var(--s2);color:var(--muted);padding:3px 8px;border-radius:6px;font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;border:1px solid var(--border)">Esgotado</span>`
            : (indisponivelHoje
              ? `<span class="grp-esg-badge" style="background:var(--s2);color:var(--muted);padding:3px 8px;border-radius:6px;font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;border:1px solid var(--border)">Indisponível hoje</span>`
              : '');
          const clickAttr = bloqueado ? '' : `onclick="grpToggle(this,'${_escape(g.nome)}','${_escape(o.nome)}',${o.preco||0},'${g.tipo}',${g.max||1})"`;
          const styleAttr = bloqueado ? 'opacity:.5;cursor:not-allowed;pointer-events:none' : '';
          return `<div class="grp-opt-item${bloqueado?' esgotado':''}" data-grupo="${_escape(g.nome)}" data-nome="${_escape(o.nome)}" data-preco="${o.preco||0}" data-tipo="${g.tipo}" ${clickAttr} style="${styleAttr}">
            <div class="grp-opt-left">${indicator}<span class="grp-opt-name">${o.nome}</span></div>
            <div style="display:flex;align-items:center;gap:8px">${esgBadge || priceLabel}${qtyEl}</div>
          </div>`;
        }).join('');
        return `<div class="grp-section">
          <div class="grp-section-title">${g.nome} ${badge}</div>
          <div class="grp-opts">${optsHtml}</div>
        </div>`;
      }).join('');
    }
    return;
  }

  // ── Modo kit ─────────────────────────────────────────────
  if (_isKitItem(item)) {
    _renderKitGrupos(item, wrap, grupos);
    // Após os chips informativos do kit, anexa também os grupos de customização
    // (ex: "TEMPERADO", "ACOMPANHAMENTOS") que o gestor cadastrou. Antes ficavam
    // invisíveis no kit — cliente não conseguia selecionar e a comanda saía
    // sem os adicionais escolhidos.
    const _KIT_INFO_TIPOS = ['cortes','preparos','ocasiao','armazenamento','pesos','porcao_ref','kit_itens','pizza_sizes'];
    const genericGruposKit = grupos.filter(g => !_KIT_INFO_TIPOS.includes(g.tipo));
    if (genericGruposKit.length) {
      // Reaproveita o mesmo HTML do modo normal abaixo — em vez de duplicar,
      // chamamos uma função interna que renderiza os grupos no formato padrão
      // e acrescenta no DOM existente do wrap.
      const extraHtml = _renderGenericGruposHtml(genericGruposKit);
      if (extraHtml) {
        const sep = document.createElement('div');
        sep.innerHTML = extraHtml;
        // Anexa no fim do wrap sem apagar os chips informativos já renderizados
        while (sep.firstChild) wrap.appendChild(sep.firstChild);
      }
    }
    return;
  }

  // ── Modo normal (pizza/restaurante) ─────────────────────
  // Filtra grupos açougue/kit para não aparecerem no modo normal
  const _ACOUGUE_TIPOS = ['cortes','preparos','ocasiao','armazenamento','pesos','porcao_ref','kit_itens','pizza_sizes'];
  const hasPizzaSizes = typeof _pizzaHasSizePricing === 'function' && _pizzaHasSizePricing(item);
  const genericGrupos  = grupos.filter(g => !_ACOUGUE_TIPOS.includes(g.tipo) && !(hasPizzaSizes && (g.nome||'').toLowerCase().trim() === 'tamanho'));
  if (!genericGrupos.length) { wrap.innerHTML = ''; return; }

  // ── Detecta padrão de borda por tamanho ──
  // Se existem grupos com nome tipo "Borda Recheada (P)", "Borda Recheada (M)", "Borda Recheada (G)"
  // eles ficam ocultos até o tamanho ser selecionado
  const _bordaTamRegex = /^(.+)\s*\((P|M|G)\)\s*$/i;

  wrap.innerHTML = _renderGenericGruposHtml(genericGrupos);
  if (hasPizzaSizes && typeof _applyPizzaSizeToBordas === 'function' && typeof _pizzaSizeKey !== 'undefined' && _pizzaSizeKey) {
    _applyPizzaSizeToBordas(_pizzaSizeKey);
  }
}

// Gera o HTML dos grupos de customização genéricos (Adicionais, Temperos,
// Acompanhamentos, Borda etc). Extraído pra ser reaproveitado tanto no fluxo
// normal quanto no modo kit (onde antes esses grupos nem apareciam).
function _renderGenericGruposHtml(genericGrupos) {
  if (!genericGrupos || !genericGrupos.length) return '';
  const _bordaTamRegex = /^(.+)\s*\((P|M|G)\)\s*$/i;

  return genericGrupos.map(g => {
    const isRequired = g.required === true;
    const badge = isRequired
      ? `<span class="grp-required-badge">Obrigatório</span>`
      : `<span class="grp-optional-badge">Opcional</span>`;
    const optsHtml = (g.opcoes || []).map(o => {
      const esgotado = _isAddonEsgotado(o.nome);
      const indisponivelHoje = !esgotado && _addonIndisponivelHoje(o.dias);
      const bloqueado = esgotado || indisponivelHoje;
      const priceLabel = bloqueado
        ? `<span class="grp-opt-price" style="color:var(--muted);text-decoration:line-through">+ R$ ${fmt(o.preco||0)}</span>`
        : (o.preco > 0
          ? `<span class="grp-opt-price">+ R$ ${fmt(o.preco)}</span>`
          : `<span class="grp-opt-price free">Grátis</span>`);
      const indicator = g.tipo === 'checkbox'
        ? `<div class="grp-opt-indicator multi"></div>`
        : `<div class="grp-opt-indicator"></div>`;
      const qtyEl = g.tipo === 'checkbox' && !bloqueado
        ? `<div class="grp-opt-qty" id="gqty_${_slug(g.nome)}_${_slug(o.nome)}">
             <button class="grp-qty-btn" onclick="event.stopPropagation();grpQty('${_escape(g.nome)}','${_escape(o.nome)}',${o.preco||0},-1)">−</button>
             <span class="grp-qty-num" id="gqnum_${_slug(g.nome)}_${_slug(o.nome)}">1</span>
             <button class="grp-qty-btn" onclick="event.stopPropagation();grpQty('${_escape(g.nome)}','${_escape(o.nome)}',${o.preco||0},1)">+</button>
           </div>` : '';
      const esgBadge = esgotado
        ? `<span class="grp-esg-badge" style="background:var(--s2);color:var(--muted);padding:3px 8px;border-radius:6px;font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;border:1px solid var(--border)">Esgotado</span>`
        : (indisponivelHoje
          ? `<span class="grp-esg-badge" style="background:var(--s2);color:var(--muted);padding:3px 8px;border-radius:6px;font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;border:1px solid var(--border)">Indisponível hoje</span>`
          : '');
      const clickAttr = bloqueado ? '' : `onclick="grpToggle(this,'${_escape(g.nome)}','${_escape(o.nome)}',${o.preco||0},'${g.tipo}',${g.max||1})"`;
      const styleAttr = bloqueado ? 'opacity:.5;cursor:not-allowed;pointer-events:none' : '';
      return `<div class="grp-opt-item${bloqueado?' esgotado':''}" data-grupo="${_escape(g.nome)}" data-nome="${_escape(o.nome)}" data-preco="${o.preco||0}" data-tipo="${g.tipo}" ${clickAttr} style="${styleAttr}">
        <div class="grp-opt-left">${indicator}<span class="grp-opt-name">${o.nome}</span></div>
        <div style="display:flex;align-items:center;gap:8px">${esgBadge || priceLabel}${qtyEl}</div>
      </div>`;
    }).join('');

    // Detecta se é grupo de borda por tamanho
    const bordaMatch = g.nome.match(_bordaTamRegex);
    if (bordaMatch) {
      const bordaNomeBase = bordaMatch[1].trim();
      const bordaTam = bordaMatch[2].toUpperCase();
      return `<div class="grp-section" data-borda-tamanho="${bordaTam}" data-borda-grupo="${_escape(g.nome)}" style="display:none">
        <div class="grp-section-title">${bordaNomeBase} ${badge}</div>
        <div class="grp-opts">${optsHtml}</div>
      </div>`;
    }

    return `<div class="grp-section">
      <div class="grp-section-title">${g.nome} ${badge}</div>
      <div class="grp-opts">${optsHtml}</div>
    </div>`;
  }).join('');
}

// ── Kit montável: cliente escolhe cortes das categorias liberadas ──
// Cada corte escolhido soma ao total do seu jeito: por peso (kg) se o item
// for vendido por peso, ou por quantidade de unidades se for vendido por
// unidade (ex: linguiça, frango inteiro, ovos — qualquer item_type != 'kg').
let _kitMontavelSel = {}; // { itemId: gramas (kg) OU quantidade de unidades }
// Corte/preparo escolhidos por item dentro do kit — só existe quando o
// próprio item selecionado (ex: "Acém Bovino") tem esses grupos cadastrados,
// igual já acontece quando ele é vendido avulso no cardápio normal.
let _kitMontavelExtras = {}; // { itemId: { cortes: 'nome', preparos: 'nome' } }

function _kitMontavelEhUnidade(it) {
  return (it?.item_type || it?.itemType) !== 'kg';
}

function _kitMontavelExtraGrupos(it) {
  return (it?.custom_groups || []).filter(g => (g.tipo === 'cortes' || g.tipo === 'preparos') && g.opcoes?.length);
}

function _buildKitMontavelHtml(kitItem, categoriasPermitidas) {
  _kitMontavelSel = {};
  _kitMontavelExtras = {};
  const catsSet = new Set(categoriasPermitidas);
  const fonte = (typeof allItems !== 'undefined' && Array.isArray(allItems)) ? allItems : [];
  const elegiveis = fonte.filter(i =>
    i.id !== kitItem.id &&
    i.status !== 'pausado' && i.status !== 'esgotado' &&
    !_isKitItem(i) &&
    (catsSet.has(i.cat_key) || catsSet.has(i.cat))
  );
  if (!elegiveis.length) {
    return `<div class="ac-section"><div style="font-size:12.5px;color:var(--muted);text-align:center;padding:12px">Nenhum corte disponível nas categorias configuradas.</div></div>`;
  }
  const cards = elegiveis.map(i => {
    const isUnidade = _kitMontavelEhUnidade(i);
    const precoLabel = 'R$ ' + parseFloat(i.price || 0).toFixed(2).replace('.', ',') + (isUnidade ? '/un' : '/kg');
    const ilustracao = i.image_url
      ? `<img src="${i.image_url}" alt="${i.name}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`
      : `<span style="font-size:28px">${i.emoji || '🥩'}</span>`;
    // Card fica compacto na grade — peso, tipo de corte e preparo são
    // escolhidos num modal próprio (_kitMontavelAbrirConfig), não expandindo
    // aqui dentro (isso quebrava o alinhamento da grade).
    return `<div class="corte-card" id="kitmv-card-${i.id}" onclick="_kitMontavelAbrirConfig(${i.id})">
      <div class="corte-card-illus">${ilustracao}</div>
      <div class="corte-card-name">${i.name}</div>
      <div class="corte-card-hint" id="kitmv-hint-${i.id}">${precoLabel}</div>
      <div id="kitmv-resumo-card-${i.id}" style="display:none;margin-top:5px;font-size:10.5px;font-weight:700;color:var(--accent);line-height:1.3"></div>
    </div>`;
  }).join('');

  return `<div class="ac-section">
    <div class="ac-section-title">Monte seu kit — toque nos cortes que quiser</div>
    <div class="corte-grid">${cards}</div>
    <div id="kitmv-resumo" style="margin-top:12px;padding:11px 13px;background:var(--s2);border:1px solid var(--border);border-radius:12px;font-size:12.5px;color:var(--muted)">
      Nenhum corte selecionado ainda
    </div>
  </div>
  <div id="kitmv-modal-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9200;align-items:flex-end;justify-content:center" onclick="if(event.target===this)_kitMontavelFecharConfig()">
    <div style="background:var(--s1);width:100%;max-width:480px;border-radius:20px 20px 0 0;max-height:85vh;overflow-y:auto;padding:18px 20px calc(18px + env(safe-area-inset-bottom,0px))">
      <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 14px"></div>
      <div id="kitmv-modal-body"></div>
    </div>
  </div>`;
}

// Abre o modal de configuração de UM corte específico do kit — peso/quantidade
// e, se existirem, os grupos de corte/preparo daquele item.
function _kitMontavelAbrirConfig(itemId) {
  const fonte = (typeof allItems !== 'undefined' && Array.isArray(allItems)) ? allItems : [];
  const it = fonte.find(x => x.id === itemId);
  if (!it) return;
  const overlay = document.getElementById('kitmv-modal-overlay');
  const body = document.getElementById('kitmv-modal-body');
  if (!overlay || !body) return;

  const isUnidade = _kitMontavelEhUnidade(it);
  const jaSelecionado = !!_kitMontavelSel[itemId];
  const valorAtual = _kitMontavelSel[itemId] || (isUnidade ? 1 : 500);
  const extraGrupos = _kitMontavelExtraGrupos(it);
  const escolhasAtuais = _kitMontavelExtras[itemId] || {};

  const extrasHtml = extraGrupos.map(g => {
    const chips = g.opcoes.map((o) => {
      const nome = o.nome || o.id || '';
      const marcado = (escolhasAtuais[g.tipo] || g.opcoes[0]?.nome || g.opcoes[0]?.id) === nome;
      return `<button type="button" class="kitmv-chip${marcado ? ' on' : ''}" data-grupo="${g.tipo}" onclick="_kitMontavelEscolherExtra('${g.tipo}','${nome.replace(/'/g, "\\'")}',this)">${nome}</button>`;
    }).join('');
    return `<div style="margin-top:14px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px">${g.nome || (g.tipo === 'cortes' ? 'Tipo de corte' : 'Forma de preparo')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${chips}</div>
    </div>`;
  }).join('');

  body.dataset.itemId = itemId;
  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
      <div style="width:52px;height:52px;border-radius:12px;overflow:hidden;flex-shrink:0;background:var(--s2);display:flex;align-items:center;justify-content:center">
        ${it.image_url ? `<img src="${it.image_url}" style="width:100%;height:100%;object-fit:cover">` : `<span style="font-size:26px">${it.emoji || '🥩'}</span>`}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:15.5px">${it.name}</div>
        <div style="font-size:12.5px;color:var(--muted)">R$ ${parseFloat(it.price || 0).toFixed(2).replace('.', ',')}${isUnidade ? '/un' : '/kg'}</div>
      </div>
    </div>
    <div style="margin-top:16px;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px">${isUnidade ? 'Quantidade' : 'Peso'}</div>
    <div style="display:flex;align-items:center;justify-content:center;gap:16px;background:var(--s2);border-radius:14px;padding:12px">
      <button type="button" onclick="_kitMontavelAjustarPesoModal(${isUnidade ? -1 : -100})" style="width:38px;height:38px;border-radius:10px;border:1px solid var(--border);background:var(--s1);color:var(--text);font-size:18px;cursor:pointer">−</button>
      <span id="kitmv-modal-peso" style="font-size:17px;font-weight:800;min-width:80px;text-align:center">${isUnidade ? valorAtual + ' un' : (valorAtual >= 1000 ? (valorAtual / 1000).toFixed(1).replace('.', ',') + 'kg' : valorAtual + 'g')}</span>
      <button type="button" onclick="_kitMontavelAjustarPesoModal(${isUnidade ? 1 : 100})" style="width:38px;height:38px;border-radius:10px;border:1px solid var(--border);background:var(--s1);color:var(--text);font-size:18px;cursor:pointer">+</button>
    </div>
    ${extrasHtml}
    <div style="display:flex;gap:8px;margin-top:20px">
      ${jaSelecionado ? `<button type="button" onclick="_kitMontavelRemoverDoKit(${itemId})" style="flex:1;padding:13px;border-radius:12px;border:1px solid var(--border);background:var(--s2);color:var(--danger,#e5484d);font-weight:700;font-size:13.5px;cursor:pointer">Remover do kit</button>` : ''}
      <button type="button" onclick="_kitMontavelConfirmarConfig()" style="flex:2;padding:13px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-weight:800;font-size:13.5px;cursor:pointer">${jaSelecionado ? 'Salvar' : 'Adicionar ao kit'}</button>
    </div>
  `;
  body._valorTemp = valorAtual;
  body._extrasTemp = { ...escolhasAtuais };
  extraGrupos.forEach(g => { if (!body._extrasTemp[g.tipo]) body._extrasTemp[g.tipo] = g.opcoes[0]?.nome || g.opcoes[0]?.id || ''; });

  overlay.style.display = 'flex';
}

function _kitMontavelFecharConfig() {
  const overlay = document.getElementById('kitmv-modal-overlay');
  if (overlay) overlay.style.display = 'none';
}

function _kitMontavelAjustarPesoModal(delta) {
  const body = document.getElementById('kitmv-modal-body');
  const itemId = parseInt(body.dataset.itemId);
  const fonte = (typeof allItems !== 'undefined' && Array.isArray(allItems)) ? allItems : [];
  const it = fonte.find(x => x.id === itemId);
  const isUnidade = _kitMontavelEhUnidade(it);
  const min = isUnidade ? 1 : 100;
  const novo = Math.max(min, (body._valorTemp || min) + delta);
  body._valorTemp = novo;
  const pesoEl = document.getElementById('kitmv-modal-peso');
  if (pesoEl) pesoEl.textContent = isUnidade ? `${novo} un` : (novo >= 1000 ? (novo / 1000).toFixed(1).replace('.', ',') + 'kg' : novo + 'g');
}

function _kitMontavelEscolherExtra(tipo, nome, btn) {
  const body = document.getElementById('kitmv-modal-body');
  if (!body._extrasTemp) body._extrasTemp = {};
  body._extrasTemp[tipo] = nome;
  btn.parentElement.querySelectorAll('.kitmv-chip').forEach(c => c.classList.remove('on'));
  btn.classList.add('on');
}

function _kitMontavelConfirmarConfig() {
  const body = document.getElementById('kitmv-modal-body');
  const itemId = parseInt(body.dataset.itemId);
  _kitMontavelSel[itemId] = body._valorTemp;
  _kitMontavelExtras[itemId] = { ...(body._extrasTemp || {}) };
  _kitMontavelAtualizarCard(itemId);
  _kitMontavelAtualizarResumo();
  if (typeof updateImAddBtn === 'function') updateImAddBtn();
  _kitMontavelFecharConfig();
}

function _kitMontavelRemoverDoKit(itemId) {
  delete _kitMontavelSel[itemId];
  delete _kitMontavelExtras[itemId];
  _kitMontavelAtualizarCard(itemId);
  _kitMontavelAtualizarResumo();
  if (typeof updateImAddBtn === 'function') updateImAddBtn();
  _kitMontavelFecharConfig();
}

// Atualiza só a aparência do card na grade (compacto — sem expandir)
function _kitMontavelAtualizarCard(itemId) {
  const card = document.getElementById(`kitmv-card-${itemId}`);
  const hint = document.getElementById(`kitmv-hint-${itemId}`);
  const resumoCard = document.getElementById(`kitmv-resumo-card-${itemId}`);
  if (!card) return;
  const valor = _kitMontavelSel[itemId];
  if (!valor) {
    card.classList.remove('on');
    if (hint) hint.style.display = '';
    if (resumoCard) { resumoCard.style.display = 'none'; resumoCard.textContent = ''; }
    return;
  }
  const fonte = (typeof allItems !== 'undefined' && Array.isArray(allItems)) ? allItems : [];
  const it = fonte.find(x => x.id === itemId);
  const isUnidade = _kitMontavelEhUnidade(it);
  const label = isUnidade ? `${valor} un` : (valor >= 1000 ? (valor / 1000).toFixed(1).replace('.', ',') + 'kg' : valor + 'g');
  const extras = _kitMontavelExtras[itemId] || {};
  const extrasTxt = Object.values(extras).filter(Boolean).join(', ');
  card.classList.add('on');
  if (hint) hint.style.display = 'none';
  if (resumoCard) {
    resumoCard.style.display = 'block';
    resumoCard.textContent = extrasTxt ? `${label} · ${extrasTxt}` : label;
  }
}

function _kitMontavelAtualizarResumo() {
  const el = document.getElementById('kitmv-resumo');
  if (!el) return;
  const fonte = (typeof allItems !== 'undefined' && Array.isArray(allItems)) ? allItems : [];
  const entradas = Object.entries(_kitMontavelSel);
  if (!entradas.length) { el.style.color = 'var(--muted)'; el.textContent = 'Nenhum corte selecionado ainda'; return; }
  let total = 0;
  const linhas = entradas.map(([idStr, valor]) => {
    const it = fonte.find(x => x.id === parseInt(idStr));
    if (!it) return null;
    const isUnidade = _kitMontavelEhUnidade(it);
    total += isUnidade ? (valor * parseFloat(it.price || 0)) : ((valor/1000) * parseFloat(it.price || 0));
    const label = isUnidade ? `${valor} un` : (valor >= 1000 ? (valor/1000).toFixed(1).replace('.',',')+'kg' : valor+'g');
    const extras = _kitMontavelExtras[idStr] || _kitMontavelExtras[parseInt(idStr)];
    const extrasTxt = extras && Object.values(extras).length ? ` (${Object.values(extras).join(', ')})` : '';
    return `${label} ${it.name}${extrasTxt}`;
  }).filter(Boolean);
  el.style.color = 'var(--text)';
  el.innerHTML = linhas.join(', ') + `<div style="margin-top:4px;font-weight:800;color:var(--accent);font-size:14px">Total: R$ ${total.toFixed(2).replace('.', ',')}</div>`;
}

// ── Renderiza modal de kit com ícones e lista de itens ──
function _renderKitGrupos(item, wrap, grupos) {
  const kitGrp        = grupos.find(g => g.tipo === 'kit_itens');
  const kitCatsGrp     = grupos.find(g => g.tipo === 'kit_categorias');
  const preparosGrp   = grupos.find(g => g.tipo === 'preparos');
  const ocasiaoGrp    = grupos.find(g => g.tipo === 'ocasiao');
  const armazenGrp    = grupos.find(g => g.tipo === 'armazenamento');
  let html = '';

  // ── Kit montável: cliente escolhe os cortes das categorias liberadas ──
  // Tem prioridade sobre a lista fixa (kit_itens) — se o gestor configurou
  // categorias, o cliente monta o próprio kit; senão, cai na lista fixa de
  // sempre (compatível com kits já cadastrados antes dessa função existir).
  if (kitCatsGrp?.categorias?.length) {
    html += _buildKitMontavelHtml(item, kitCatsGrp.categorias);
  } else if (kitGrp?.itens?.length) {
    const rows = kitGrp.itens.map(item => {
      // Tenta extrair quantidade e nome: "500g Bife de Patinho" → qty="500g", nome="Bife de Patinho"
      const match = item.match(/^(\d+\s*(?:g|kg|un|pç|pc|L|ml|x)?\s*)/i);
      const qty   = match ? match[1].trim() : '';
      const nome  = match ? item.slice(match[1].length).trim() : item;
      // Tenta achar a foto real do produto casando pelo nome (a lista do kit
      // é só texto digitado pelo gestor, sem link direto pro item do cardápio,
      // então o jeito é comparar os nomes).
      const fotoUrl = _buscarFotoPorNome(nome);
      const ilustracao = fotoUrl
        ? `<img src="${fotoUrl}" alt="${nome}" style="width:36px;height:36px;object-fit:cover;border-radius:9px" onerror="this.parentElement.innerHTML=this.parentElement.dataset.fallback">`
        : `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M7 17c-2-2-3-5-1.5-8.5S11 3.5 15 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M17 7c2 1.5 3.5 5 2 8s-5 5-8 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.4"/></svg>`;
      const fallbackSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M7 17c-2-2-3-5-1.5-8.5S11 3.5 15 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M17 7c2 1.5 3.5 5 2 8s-5 5-8 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.4"/></svg>`;
      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <div style="width:36px;height:36px;border-radius:9px;background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.2);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;overflow:hidden" data-fallback='${fallbackSvg.replace(/'/g,"&#39;")}'>${ilustracao}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--text)">${nome}</div>
          ${qty ? `<div style="font-size:11.5px;color:var(--accent);font-weight:700;margin-top:1px">${qty}</div>` : ''}
        </div>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>`;
    }).join('');

    html += `<div class="ac-section">
      <div class="ac-section-title" style="margin-bottom:6px">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-right:5px"><rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5 3V2M11 3V2M2 7h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        Itens inclusos no kit
      </div>
      <div style="border:1px solid var(--border);border-radius:10px;padding:0 12px;overflow:hidden">${rows}</div>
    </div>`;
  }

  // ── Informações com ícones (preparos, ocasião, armazenamento) ──
  const _chipRow = (lista, titulo, iconeDefault, resolverIcone) => {
    if (!lista?.opcoes?.length) return '';
    const chips = lista.opcoes.map(o => {
      const nome = o.nome || o.id;
      // Prioridade: 1) foto específica dessa opção, se alguém colocou uma
      // (o.icon); 2) ícone padrão do admin pra esse tipo de preparo (só
      // existe pra "Forma de preparo" — ocasião/armazenamento não têm
      // catálogo próprio no admin, aí usam o ícone genérico mesmo);
      // 3) o SVG genérico repetido, como sempre foi o fallback final.
      let icon;
      if (o.icon) {
        icon = `<img src="${o.icon}" style="width:28px;height:28px;object-fit:contain" onerror="this.style.display='none'">`;
      } else if (resolverIcone) {
        icon = `<span style="font-size:20px;display:inline-flex">${resolverIcone(nome)}</span>`;
      } else {
        icon = `<span style="font-size:20px">${iconeDefault}</span>`;
      }
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 10px;background:var(--s2,#1a1a1a);border:1.5px solid var(--border);border-radius:10px;min-width:60px;text-align:center;flex-shrink:0">
        <div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.04);border-radius:8px">${icon}</div>
        <span style="font-size:10.5px;font-weight:600;color:var(--text);line-height:1.2">${nome}</span>
      </div>`;
    }).join('');
    return `<div style="margin-top:14px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.4px;text-transform:uppercase;margin-bottom:8px">${titulo}</div>
      <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;-webkit-overflow-scrolling:touch;scrollbar-width:none">${chips}</div>
    </div>`;
  };

  const infoHtml = [
    _chipRow(preparosGrp,  'Forma de preparo', '<svg width=\'20\' height=\'20\' viewBox=\'0 0 24 24\' fill=\'none\'><path d=\'M3 17h14a2 2 0 0 0 0-4H3\' stroke=\'currentColor\' stroke-width=\'1.5\' stroke-linecap=\'round\'/></svg>', _getPreparoIcon),
    _chipRow(ocasiaoGrp,   'Tipo de ocasião',  '<svg width=\'20\' height=\'20\' viewBox=\'0 0 24 24\' fill=\'none\'><circle cx=\'12\' cy=\'12\' r=\'9\' stroke=\'currentColor\' stroke-width=\'1.5\'/><circle cx=\'12\' cy=\'12\' r=\'5\' stroke=\'currentColor\' stroke-width=\'1.4\'/><circle cx=\'12\' cy=\'12\' r=\'1.5\' fill=\'currentColor\'/></svg>'),
    _chipRow(armazenGrp,   'Armazenamento',    '<svg width=\'20\' height=\'20\' viewBox=\'0 0 24 24\' fill=\'none\'><path d=\'M12 3v18M3 12h18M5.5 5.5l13 13M18.5 5.5l-13 13\' stroke=\'currentColor\' stroke-width=\'1.4\' stroke-linecap=\'round\'/></svg>'),
  ].join('');

  if (infoHtml) {
    html += `<div class="ac-section" style="margin-top:6px">${infoHtml}</div>`;
  }

  wrap.innerHTML = html || '';
}

function _renderAcougueGrupos(item, wrap, grupos) {
  const cortesGrp  = grupos.find(g => g.tipo === 'cortes');
  const preparosGrp= grupos.find(g => g.tipo === 'preparos');
  let html = '';

  // ── Seção de cortes ──────────────────────────────────────
  if (cortesGrp?.opcoes?.length) {
    const cards = cortesGrp.opcoes.map(o => {
      const slug = _slug(o.nome || o.id);
      const imgUrl = [o.icon, o.image, o.img, o.image_url].find(v => v && (v.startsWith('http') || v.startsWith('/'))) || null;
      const ilustracao = imgUrl
        ? `<img src="${imgUrl}" alt="${o.nome||o.id}" style="width:68px;height:60px;object-fit:contain;display:block" >`
        : _getCorteIlus(o.nome||o.id);
      return `<div class="corte-card" id="corte-card-${slug}" onclick="openPesoSheet('${_escape(o.nome||o.id)}')">
        <div class="corte-card-illus">${ilustracao}</div>
        <div class="corte-card-name">${o.nome||o.id}</div>
        <div class="corte-card-hint" id="corte-hint-${slug}">Clique para adicionar</div>
      </div>`;
    }).join('');
    html += `<div class="ac-section">
      <div class="ac-section-title">Selecione o corte desejado</div>
      <div id="ac-encarte-banner" style="display:none;margin-bottom:10px;padding:10px 13px;background:rgba(34,197,94,.08);border:1.5px solid rgba(34,197,94,.25);border-radius:12px;font-size:12.5px;color:#4ade80;align-items:center;gap:8px">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span id="ac-encarte-txt">Peso do encarte já selecionado</span>
        <span style="margin-left:auto;font-size:11px;opacity:.7">Toque no corte para alterar</span>
      </div>
      <div class="corte-grid">${cards}</div>
      <div style="margin-top:10px;display:flex;flex-wrap:wrap;align-items:center;gap:4px">
        <span class="ac-peso-var">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Peso variável
        </span>
        <span class="ac-peso-total" id="ac-peso-total" style="display:none">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span id="ac-peso-total-txt">0g selecionados</span>
        </span>
      </div>
    </div>`;
  }

  // ── Seção de preparos ────────────────────────────────────
  if (preparosGrp?.opcoes?.length) {
    const chips = preparosGrp.opcoes.map(o => {
      const slug = _slug(o.nome || o.id);
      // Prioridade: 1) imagem própria salva nessa opção (o.icon — é o que o
      // admin edita em "Ícones do Açougue" e o corte já usava assim);
      // 2) tenta adivinhar pelo nome como fallback pra dados antigos que
      // não tinham esse campo preenchido.
      const iconHtml = (o.icon && (o.icon.startsWith('http') || o.icon.startsWith('/')))
        ? `<img src="${o.icon}" style="width:20px;height:20px;object-fit:contain" onerror="this.outerHTML=${JSON.stringify(_getPreparoIcon(o.nome || o.id))}">`
        : _getPreparoIcon(o.nome || o.id);
      return `<div class="preparo-chip" id="preparo-chip-${slug}" onclick="togglePreparo('${_escape(o.nome||o.id)}',this)">
        <div class="preparo-chip-icon">${iconHtml}</div>
        <span>${o.nome||o.id}</span>
      </div>`;
    }).join('');
    html += `<div class="ac-section">
      <div class="ac-section-title">Forma de preparo</div>
      <div class="preparo-chips">${chips}</div>
    </div>`;
  }

  wrap.innerHTML = html;
}

// ── Input manual de gramas ───────────────────────────
function _manualGramasInput(val) {
  const g = parseInt(val);
  const wrap = document.getElementById('ac-manual-g-wrap');
  if (g > 0) {
    if (wrap) wrap.style.borderColor = 'var(--accent)';
    _drumUpdateBtn(g);
    // Deseleciona o drum visualmente
    document.querySelectorAll('#ac-peso-list .peso-picker-item').forEach(el => el.classList.remove('selected'));
  } else {
    if (wrap) wrap.style.borderColor = 'var(--border)';
    _drumUpdateBtn(0);
  }
}

function _manualKgInput(val) {
  const kg = parseFloat(val.replace(',', '.'));
  const g  = Math.round(kg * 1000);
  const wrap = document.getElementById('ac-manual-kg-wrap');
  if (g > 0) {
    if (wrap) wrap.style.borderColor = 'var(--accent)';
    _drumUpdateBtn(g);
    // Deseleciona os botões de kg visualmente
    document.querySelectorAll('#ac-kg-grid button').forEach(el => {
      el.style.borderColor = 'var(--border)';
      el.style.background  = 'var(--s2)';
      el.style.color       = 'var(--text)';
    });
  } else {
    if (wrap) wrap.style.borderColor = 'var(--border)';
    _drumUpdateBtn(0);
  }
}

// ── Abre o bottom sheet de peso para um corte ──
const _PICKER_ITEM_H = 42; // altura de cada item em px

function openPesoSheet(corteNome) {
  _acougueAtual = corteNome;
  document.getElementById('ac-peso-corte-nome').textContent = corteNome;

  const track    = document.getElementById('ac-peso-list');
  const pesoAtual = _acougueCortes[corteNome]?.peso || _acouguePesos[0] || 0;
  const idx0      = Math.max(0, _acouguePesos.indexOf(pesoAtual));

  // Monta itens do drum
  track.innerHTML =
    `<div class="peso-picker-spacer"></div>` +
    _acouguePesos.map((p, i) =>
      `<div class="peso-picker-item${i === idx0 ? ' selected' : ''}" data-peso="${p}" data-idx="${i}" onclick="_drumClick(${i})">${p}</div>`
    ).join('') +
    `<div class="peso-picker-spacer"></div>`;

  // Scrolla para o item correto sem animação
  track.scrollTo({ top: idx0 * _PICKER_ITEM_H, behavior: 'instant' });

  // Listener de scroll: atualiza seleção enquanto o usuário rola
  track._drumScrollHandler && track.removeEventListener('scroll', track._drumScrollHandler);
  track._drumScrollHandler = _drumOnScroll.bind(null, track);
  track.addEventListener('scroll', track._drumScrollHandler, { passive: true });

  // Restaura campos extras
  const estado = _acougueCortes[corteNome] || {};
  document.getElementById('ac-peso-sep').value = estado.separar || '';
  document.getElementById('ac-extra-textarea').value = estado.extra || '';
  const extraBody   = document.getElementById('ac-extra-body');
  const extraToggle = document.getElementById('ac-extra-toggle');
  if (estado.extra) { extraBody.classList.add('on'); extraToggle.classList.add('on'); }
  else              { extraBody.classList.remove('on'); extraToggle.classList.remove('on'); }

  // Botão confirmar já parte com o peso atual
  _drumUpdateBtn(pesoAtual);

  // Limpa inputs manuais
  const inpG  = document.getElementById('ac-manual-g');
  const inpKg = document.getElementById('ac-manual-kg');
  const wrapG  = document.getElementById('ac-manual-g-wrap');
  const wrapKg = document.getElementById('ac-manual-kg-wrap');
  if (inpG)  inpG.value  = '';
  if (inpKg) inpKg.value = '';
  if (wrapG)  wrapG.style.borderColor  = 'var(--border)';
  if (wrapKg) wrapKg.style.borderColor = 'var(--border)';

  document.getElementById('ac-peso-overlay').classList.add('on');
  document.body.style.overflow = 'hidden';
  // Aba padrão: quilos — item vendido por kg; gramas é opção de ajuste do cliente
  switchPesoTab('quilos');
}

function _drumOnScroll(track) {
  // Debounce: só age após parar de rolar
  clearTimeout(track._drumTimer);
  track._drumTimer = setTimeout(() => {
    const idx = Math.round(track.scrollTop / _PICKER_ITEM_H);
    const clipped = Math.max(0, Math.min(idx, _acouguePesos.length - 1));
    // Snap suave para o item mais próximo
    track.scrollTo({ top: clipped * _PICKER_ITEM_H, behavior: 'smooth' });
    // Atualiza classe selected
    track.querySelectorAll('.peso-picker-item').forEach((el, i) =>
      el.classList.toggle('selected', i === clipped)
    );
    _drumUpdateBtn(_acouguePesos[clipped]);
  }, 80);
}

function _drumClick(idx) {
  const track = document.getElementById('ac-peso-list');
  track.scrollTo({ top: idx * _PICKER_ITEM_H, behavior: 'smooth' });
  track.querySelectorAll('.peso-picker-item').forEach((el, i) =>
    el.classList.toggle('selected', i === idx)
  );
  _drumUpdateBtn(_acouguePesos[idx]);
  // Limpa input manual de gramas
  const inpG = document.getElementById('ac-manual-g');
  const wrapG = document.getElementById('ac-manual-g-wrap');
  if (inpG)  inpG.value = '';
  if (wrapG) wrapG.style.borderColor = 'var(--border)';
}

function _drumUpdateBtn(peso) {
  const btn = document.getElementById('ac-peso-confirm');
  btn.disabled = !peso;
  btn.textContent = peso ? `Confirmar ${peso}g` : 'Selecionar peso';
  btn.dataset.peso = peso || 0;
}

function closePesoSheet() {
  document.getElementById('ac-peso-overlay').classList.remove('on');
  document.body.style.overflow = '';
}

// ── Abas Gramas / Quilos ─────────────────────────────
function switchPesoTab(tab) {
  const tabG  = document.getElementById('ac-peso-tab-gramas');
  const tabQ  = document.getElementById('ac-peso-tab-quilos');
  const btnG  = document.getElementById('tab-gramas');
  const btnQ  = document.getElementById('tab-quilos');
  const isG   = tab === 'gramas';

  if (tabG) tabG.style.display = isG ? '' : 'none';
  if (tabQ) tabQ.style.display = isG ? 'none' : '';

  if (btnG) { btnG.style.background = isG ? 'var(--accent)' : 'transparent'; btnG.style.color = isG ? '#fff' : 'var(--muted)'; }
  if (btnQ) { btnQ.style.background = isG ? 'transparent' : 'var(--accent)'; btnQ.style.color = isG ? 'var(--muted)' : '#fff'; }

  if (!isG) _renderKgGrid();
}

function _renderKgGrid() {
  const grid = document.getElementById('ac-kg-grid');
  if (!grid) return;

  // Opções de kg: 0.5, 1, 1.5, 2, 2.5, 3, 4, 5 — filtra até o máximo dos pesos em g
  const maxGramas = Math.max(...(_acouguePesos || [0]));
  const kgOpts = [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000]
    .filter(g => !maxGramas || g <= maxGramas * 2); // permite até 2x o max de gramas

  // Pega o peso atual selecionado para destacar
  const btn       = document.getElementById('ac-peso-confirm');
  const pesoAtual = parseInt(btn?.dataset?.peso) || 0;

  grid.innerHTML = kgOpts.map(g => {
    const label = g >= 1000 ? (g / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' kg' : g + 'g';
    const ativo = g === pesoAtual;
    return `<button onclick="_selectKg(${g})" style="
      padding:14px 8px;border-radius:12px;border:2px solid ${ativo ? 'var(--accent)' : 'var(--border)'};
      background:${ativo ? 'rgba(var(--accent-rgb,249,115,22),.1)' : 'var(--s2)'};
      color:${ativo ? 'var(--accent)' : 'var(--text)'};
      font-size:14px;font-weight:700;cursor:pointer;transition:all .15s;font-family:inherit
    ">${label}</button>`;
  }).join('');
}

function _selectKg(gramas) {
  const corte = _acougueAtual;
  if (!corte) return;
  // Limpa input manual de kg
  const inpKg  = document.getElementById('ac-manual-kg');
  const wrapKg = document.getElementById('ac-manual-kg-wrap');
  if (inpKg)  inpKg.value = '';
  if (wrapKg) wrapKg.style.borderColor = 'var(--border)';

  const separar = document.getElementById('ac-peso-sep')?.value || '';
  const extra   = document.getElementById('ac-extra-textarea')?.value.trim() || '';

  _acougueCortes[corte] = { peso: gramas, separar, extra };

  // Atualiza o card visual do corte
  const slug = _slug(corte);
  const card = document.getElementById(`corte-card-${slug}`);
  const hint = document.getElementById(`corte-hint-${slug}`);
  if (card && hint) {
    card.classList.add('on');
    const label = gramas >= 1000
      ? (gramas / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'kg'
      : gramas + 'g';
    hint.innerHTML = `<span class="corte-card-badge">
      <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      ${label} ${corte}
      <span onclick="event.stopPropagation();cancelCorte('${_escape(corte)}')" title="Cancelar seleção"
        style="margin-left:5px;opacity:.7;font-size:11px;font-weight:900;line-height:1;cursor:pointer;padding:1px 3px;border-radius:3px"
        onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='.7'">✕</span>
    </span>`;
  }

  // Recalcula preço total
  _atualizaTotalPeso();
  _pesoConfirmadoPeloUsuario = true;
  closePesoSheet();
}

function selectPesoOpt(peso) {
  // mantido por compatibilidade — redireciona para drum
  const idx = _acouguePesos.indexOf(peso);
  if (idx >= 0) _drumClick(idx);
}

function confirmPesoSheet() {
  const corte = _acougueAtual;
  if (!corte) return;
  const btn = document.getElementById('ac-peso-confirm');
  const peso = parseInt(btn.dataset.peso) || _acougueCortes[corte]?.peso || 0;
  if (!peso) return;

  const separar = document.getElementById('ac-peso-sep').value;
  const extra   = document.getElementById('ac-extra-textarea').value.trim();

  _acougueCortes[corte] = { peso, separar, extra };

  // Atualiza card visual
  const slug = _slug(corte);
  const card = document.getElementById(`corte-card-${slug}`);
  const hint = document.getElementById(`corte-hint-${slug}`);
  if (card && hint) {
    card.classList.add('on');
    hint.innerHTML = `<span class="corte-card-badge">
      <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      ${peso}g ${corte}
      <span onclick="event.stopPropagation();cancelCorte('${_escape(corte)}')" title="Cancelar seleção"
        style="margin-left:5px;opacity:.7;font-size:11px;font-weight:900;line-height:1;cursor:pointer;padding:1px 3px;border-radius:3px"
        onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='.7'">✕</span>
    </span>`;
  }

  // Atualiza total
  _atualizaTotalPeso();
  _pesoConfirmadoPeloUsuario = true;
  closePesoSheet();
}

// ── Cancela seleção de um corte ───────────────────────
function cancelCorte(corteNome) {
  delete _acougueCortes[corteNome];
  const slug = _slug(corteNome);
  const card = document.getElementById(`corte-card-${slug}`);
  const hint = document.getElementById(`corte-hint-${slug}`);
  if (card) card.classList.remove('on');
  if (hint) hint.innerHTML = 'Clique para adicionar';
  _atualizaTotalPeso();
}

// ── Abre seletor de gramas direto pelo badge de porção ──
// Usado quando cliente toca em "Porção de Xg" na área do preço
function _openPorcaoQuickPicker(item, porcaoRef) {
  const cgs      = item.custom_groups || [];
  const pesosGrp = cgs.find(g => g.tipo === 'pesos');

  // Define os pesos disponíveis globalmente para o picker
  _acouguePesos = pesosGrp?.valores || [];
  if (!_acouguePesos.length) return;

  // Sempre abre com "Inteiro" — sem pré-selecionar corte existente
  openPesoSheet('Inteiro');
}

// ── Pré-seleciona corte/peso do encarte ao abrir o modal ──
function _autoSelecionarPorcaoRef(corteNome, pesoGramas, temCortes) {
  _acougueCortes[corteNome] = { peso: pesoGramas, separar: '', extra: '' };

  const label = pesoGramas >= 1000
    ? (pesoGramas / 1000).toFixed(1).replace('.', ',') + ' kg'
    : pesoGramas + 'g';

  if (temCortes) {
    // Atualiza visual do card de corte
    const slug = _slug(corteNome);
    const card = document.getElementById(`corte-card-${slug}`);
    const hint = document.getElementById(`corte-hint-${slug}`);
    if (card) card.classList.add('on');
    if (hint) hint.innerHTML = `<span class="corte-card-badge">${label}</span>`;
  } else {
    // Sem cortes: atualiza a pill de porção de referência para indicar seleção
    const porcaoEl = document.getElementById('im-porcao-ref');
    if (porcaoEl) {
      porcaoEl.style.background = 'rgba(34,197,94,.12)';
      porcaoEl.style.borderColor = 'rgba(34,197,94,.35)';
      porcaoEl.style.color = '#4ade80';
    }
  }

  // Banner informativo (só para items com cortes, para não poluir modal simples)
  if (temCortes) {
    const banner = document.getElementById('ac-encarte-banner');
    const bannerTxt = document.getElementById('ac-encarte-txt');
    if (banner) {
      banner.style.display = 'flex';
      if (bannerTxt) bannerTxt.textContent = `Peso do encarte (${label}) já selecionado ✓`;
    }
  }

  _atualizaTotalPeso();
}

function _atualizaTotalPeso() {
  const total = Object.values(_acougueCortes).reduce((s, v) => s + (v.peso || 0), 0);
  const el  = document.getElementById('ac-peso-total');
  const txt = document.getElementById('ac-peso-total-txt');
  if (!el || !txt) return;
  if (total > 0) {
    el.style.display = '';
    txt.textContent = total >= 1000
      ? (total / 1000).toFixed(1).replace('.', ',') + ' kg selecionados'
      : total + 'g selecionados';
  } else {
    el.style.display = 'none';
  }
  _updateImPrice();
}

function toggleAcExtra() {
  const toggle = document.getElementById('ac-extra-toggle');
  const body   = document.getElementById('ac-extra-body');
  toggle.classList.toggle('on');
  body.classList.toggle('on');
  if (body.classList.contains('on')) {
    document.getElementById('ac-extra-textarea').focus();
  }
}

function togglePreparo(nome, el) {
  el.classList.toggle('on');
  if (!_imGruposState['preparos']) _imGruposState['preparos'] = [];
  const state = _imGruposState['preparos'];
  const idx = state.findIndex(o => o.nome === nome);
  if (idx !== -1) state.splice(idx, 1);
  else state.push({ nome, preco: 0, qty: 1 });
}

// ── Açougue: monta descrição para o carrinho ──
function _buildAcougueDesc() {
  const partes = [];
  for (const [corte, v] of Object.entries(_acougueCortes)) {
    if (!v.peso) continue;
    let txt = `${v.peso}g ${corte}`;
    if (v.separar) txt += ` (${v.separar})`;
    if (v.extra)   txt += ` [${v.extra}]`;
    partes.push(txt);
  }
  const preparos = (_imGruposState['preparos'] || []).map(o => o.nome).join(', ');
  if (preparos) partes.push('Preparo: ' + preparos);
  return partes.join(' · ');
}

function _slug(s) { return (s||'').replace(/[^a-z0-9]/gi,'_').toLowerCase(); }
function _escape(s) { return (s||'').replace(/'/g,"\'").replace(/"/g,'&quot;'); }

// ══════════════════════════════════════════
//  INDICAÇÕES DE PREPARO — Bottom sheet público
// ══════════════════════════════════════════
function openPreparoDetail(preparoId) {
  // Coleta itens que têm este preparo
  const itensComPreparo = allItems.filter(i => {
    if (i.status === 'pausado' || i.status === 'esgotado') return false;
    const cgs = i.custom_groups || [];
    const grp = cgs.find(g => g.tipo === 'preparos');
    if (!grp?.opcoes) return false;
    return grp.opcoes.some(o => (o.id || o.nome || o).toLowerCase().replace(/\s+/g,'_') === preparoId.toLowerCase());
  });

  const nomePreparo = typeof _getPreparoFilterNome === 'function'
    ? _getPreparoFilterNome(preparoId)
    : (preparoId.charAt(0).toUpperCase() + preparoId.slice(1));
  const iconPreparo = _preparoImgMap[preparoId] || null;
  const temVideoPreparo = _preparoVideoTags.has(preparoId);
  const _vv = _iconesVer ? ('?v=' + _iconesVer) : '';

  document.getElementById('preparo-detail-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'preparo-detail-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:8500;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(3px)';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const itensHTML = !itensComPreparo.length
    ? `<div style="text-align:center;padding:32px 0;color:var(--muted);font-size:13px">
        <div style="margin-bottom:10px;opacity:.4"><svg width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="14" cy="14" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M20 20l6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></div>
        Nenhuma carne indicada para este preparo.
       </div>`
    : itensComPreparo.map(i => {
        const cgs       = i.custom_groups || [];
        const cortesGrp = cgs.find(g => g.tipo === 'cortes');
        const pesosGrp  = cgs.find(g => g.tipo === 'pesos');
        const porcaoGrp = cgs.find(g => g.tipo === 'porcao_ref');
        const cortes = (cortesGrp?.opcoes || []).map(o => o.nome || o.id).join(' · ');
        const porcao = porcaoGrp?.gramas || null;
        const pesos  = (pesosGrp?.valores || []).map(p => `${p}g`).join(' / ');

        const imgEl = i.image_url
          ? `<img src="${i.image_url}" style="width:100%;height:100%;object-fit:cover;border-radius:10px">`
          : `<span style="font-size:30px"><svg width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='M7 17c-2-2-3-5-1.5-8.5S11 3.5 15 5' stroke='currentColor' stroke-width='1.5' stroke-linecap='round'/><circle cx='12' cy='12' r='3' stroke='currentColor' stroke-width='1.4'/></svg></span>`;

        return `<div onclick="closePreparoDetail();openItemModal(${i.id})" style="display:flex;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid var(--border);cursor:pointer;-webkit-tap-highlight-color:transparent" onmouseenter="this.style.opacity='.8'" onmouseleave="this.style.opacity='1'">
          <div style="width:56px;height:56px;border-radius:10px;overflow:hidden;flex-shrink:0;background:var(--surface2);display:flex;align-items:center;justify-content:center">${imgEl}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.name}</div>
            ${cortes ? `<div style="font-size:11.5px;color:var(--muted);margin-top:3px">Cortes: ${cortes}</div>` : ''}
            ${porcao ? `<div style="font-size:11.5px;color:var(--accent);font-weight:700;margin-top:2px">Ref: ${porcao}g</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-weight:800;font-size:14px">R$ ${fmt(i.price)}<span style="font-size:10px;font-weight:400;color:var(--muted)">/kg</span></div>
            ${pesos ? `<div style="font-size:10.5px;color:var(--muted);margin-top:2px">${pesos}</div>` : ''}
            <div style="font-size:10px;color:var(--accent);margin-top:3px;font-weight:600">Ver detalhes →</div>
          </div>
        </div>`;
      }).join('');

  overlay.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--surface);border-radius:20px 20px 0 0;width:100%;max-width:540px;max-height:86vh;display:flex;flex-direction:column">
    <!-- Handle -->
    <div style="padding:12px 20px 0;flex-shrink:0">
      <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto"></div>
    </div>
    <!-- Header -->
    <div style="padding:14px 20px 12px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;gap:14px">
      <div style="width:48px;height:48px;border-radius:12px;background:var(--surface2);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">
        ${temVideoPreparo
          ? `<video src="${_IMG_TAGS}/${preparoId}.mp4${_vv}" style="width:36px;height:36px;object-fit:cover;border-radius:8px" autoplay muted loop playsinline disablepictureinpicture></video>`
          : (iconPreparo
              ? `<img src="${iconPreparo}${_vv}" style="width:36px;height:36px;object-fit:contain" onerror="this.parentElement.innerHTML='<svg width=\'24\' height=\'24\' viewBox=\'0 0 24 24\' fill=\'none\'><path d=\'M7 17c-2-2-3-5-1.5-8.5S11 3.5 15 5\' stroke=\'currentColor\' stroke-width=\'1.5\' stroke-linecap=\'round\'/><circle cx=\'12\' cy=\'12\' r=\'3\' stroke=\'currentColor\' stroke-width=\'1.4\'/></svg>'">`
              : '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M7 17c-2-2-3-5-1.5-8.5S11 3.5 15 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.4"/></svg>')}
      </div>
      <div style="flex:1">
        <div style="font-weight:800;font-size:16px">${nomePreparo}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">
          ${itensComPreparo.length} carne${itensComPreparo.length !== 1 ? 's' : ''} indicada${itensComPreparo.length !== 1 ? 's' : ''} · toque para ver e pedir
        </div>
      </div>
      <button onclick="closePreparoDetail()" style="border:none;background:var(--surface2);border-radius:50%;width:34px;height:34px;cursor:pointer;color:var(--muted);font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
    </div>
    <!-- Lista de itens -->
    <div style="overflow-y:auto;flex:1;padding:0 20px">
      ${itensHTML}
    </div>
    <!-- Rodapé -->
    <div style="padding:14px 20px;flex-shrink:0;border-top:1px solid var(--border)">
      <button onclick="closePreparoDetail()" style="width:100%;padding:12px;background:var(--surface2);border:1px solid var(--border);border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;color:var(--text);font-family:inherit">Fechar</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);
}

function closePreparoDetail() {
  document.getElementById('preparo-detail-overlay')?.remove();
}

function grpToggle(el, grupoNome, optNome, preco, tipo, maxSel) {
  // Defesa: se o adicional foi marcado como esgotado, ignora o clique
  if (typeof _isAddonEsgotado === 'function' && _isAddonEsgotado(optNome)) {
    if (typeof toast === 'function') toast('warn', `${optNome} está esgotado`);
    return;
  }
  // Defesa: se o adicional está indisponível hoje (dia da semana), ignora o clique
  if (el.classList.contains('esgotado')) {
    if (typeof toast === 'function') toast('warn', `${optNome} indisponível hoje`);
    return;
  }
  if (!_imGruposState[grupoNome]) _imGruposState[grupoNome] = [];
  const state = _imGruposState[grupoNome];

  if (tipo === 'radio') {
    // Deselect all in group, select this one
    el.closest('.grp-opts').querySelectorAll('.grp-opt-item').forEach(e => e.classList.remove('on'));
    _imGruposState[grupoNome] = [{ nome: optNome, preco, qty: 1 }];
    el.classList.add('on');
  } else {
    // checkbox
    const idx = state.findIndex(o => o.nome === optNome);
    if (idx !== -1) {
      state.splice(idx, 1);
      el.classList.remove('on');
      // hide qty stepper
      const qtyEl = document.getElementById(`gqty_${_slug(grupoNome)}_${_slug(optNome)}`);
      if (qtyEl) qtyEl.classList.remove('show');
    } else {
      const totalSel = state.reduce((s,o) => s + (o.qty||1), 0);
      if (maxSel > 1 && totalSel >= maxSel) {
        toast('warn', `Máximo ${maxSel} opções para ${grupoNome}`);
        return;
      }
      state.push({ nome: optNome, preco, qty: 1 });
      el.classList.add('on');
      // show qty stepper for checkbox
      const qtyEl = document.getElementById(`gqty_${_slug(grupoNome)}_${_slug(optNome)}`);
      if (qtyEl) qtyEl.classList.add('show');
    }
  }

  // ── Borda condicional por tamanho ──
  // Quando seleciona tamanho, mostra apenas o grupo de borda correspondente
  if (grupoNome.toLowerCase() === 'tamanho' && tipo === 'radio') {
    const tamanhoKey = optNome.match(/\(([PMG])\)/i)?.[1]?.toUpperCase() || '';
    document.querySelectorAll('.grp-section[data-borda-tamanho]').forEach(sec => {
      const bordaTam = sec.dataset.bordaTamanho;
      if (bordaTam === tamanhoKey) {
        sec.style.display = '';
      } else {
        sec.style.display = 'none';
        // Limpa seleção da borda oculta
        const nomeGrp = sec.dataset.bordaGrupo;
        if (nomeGrp && _imGruposState[nomeGrp]) {
          delete _imGruposState[nomeGrp];
          sec.querySelectorAll('.grp-opt-item.on').forEach(e => e.classList.remove('on'));
        }
      }
    });
  }

  // Animação ingrediente voando
  const vtype = _itemVisualType(allItems.find(x => x.id === _imItemId));
  if (vtype === 'acai' || vtype === 'marmita') {
    const wasAdded = el.classList.contains('on');
    if (wasAdded) {
      _dropIngredient(optNome, el);
    } else {
      _lowerFillLevel();
    }
  }
  if (vtype === 'burger') {
    const wasAdded = el.classList.contains('on');
    if (wasAdded) _addBurgerLayer(optNome);
    else          _removeBurgerLayer(optNome);
  }
  _updateImPrice();
}

function grpQty(grupoNome, optNome, preco, delta) {
  if (!_imGruposState[grupoNome]) return;
  const opt = _imGruposState[grupoNome].find(o => o.nome === optNome);
  if (!opt) return;
  opt.qty = Math.max(1, (opt.qty||1) + delta);
  const el = document.getElementById(`gqnum_${_slug(grupoNome)}_${_slug(optNome)}`);
  if (el) el.textContent = opt.qty;
  _updateImPrice();
}

function _calcGruposExtra(item) {
  let extra = 0;
  const grupos = item.custom_groups || [];
  const hasPizzaSizes = typeof _pizzaHasSizePricing === 'function' && _pizzaHasSizePricing(item);
  const isPizza = typeof isPizzaItem === 'function' && isPizzaItem(item);
  for (const g of grupos) {
    if (g?.tipo === 'pizza_sizes') continue;
    if (hasPizzaSizes && (g.nome||'').toLowerCase().trim() === 'tamanho') continue;
    if (isPizza && typeof _pizzaShouldSkipSizedGroup === 'function' && _pizzaShouldSkipSizedGroup(g)) continue;
    const sel = _imGruposState[g.nome] || [];
    for (const o of sel) extra += (o.preco||0) * (o.qty||1);
  }
  return extra;
}

function _buildGruposDesc(item) {
  const grupos = item.custom_groups || [];
  const parts = [];
  const hasPizzaSizes = typeof _pizzaHasSizePricing === 'function' && _pizzaHasSizePricing(item);
  const isPizza = typeof isPizzaItem === 'function' && isPizzaItem(item);
  for (const g of grupos) {
    if (g?.tipo === 'pizza_sizes') continue;
    if (hasPizzaSizes && (g.nome||'').toLowerCase().trim() === 'tamanho') continue;
    if (isPizza && typeof _pizzaShouldSkipSizedGroup === 'function' && _pizzaShouldSkipSizedGroup(g)) continue;
    const sel = _imGruposState[g.nome] || [];
    if (sel.length) {
      const names = sel.map(o => {
        const qtyPrefix = o.qty > 1 ? `${o.qty}x ` : '';
        const preco = o.preco > 0
          ? ` (+R$ ${parseFloat(o.preco).toFixed(2).replace('.', ',')})`
          : '';
        return `${qtyPrefix}${o.nome}${preco}`;
      }).join(', ');
      parts.push(`${g.nome}: ${names}`);
    }
  }
  return parts.join(' · ');
}

function _updateImPrice() {
  const i = allItems.find(x => x.id === _imItemId);
  if (!i) return;
  const extra = _calcGruposExtra(i);
  const isPizza = typeof isPizzaItem === 'function' && isPizzaItem(i);

  // Para açougue: preço proporcional ao peso selecionado
  let basePrice = (isPizza && typeof _pizzaCurrentBasePrice === 'function')
    ? _pizzaCurrentBasePrice(i, (typeof _halfItem !== 'undefined' ? _halfItem : null)) + extra
    : i.price + extra;
  if (_isAcougueItem(i)) {
    const totalPeso = Object.values(_acougueCortes).reduce((s, v) => s + (v.peso || 0), 0);
    if (totalPeso > 0) {
      basePrice = (i.price + extra) * (totalPeso / 1000);
    }
  }

  const total = basePrice * _imQty;
  const btn = document.getElementById('im-add-btn');
  const priceEl = document.getElementById('im-price');
  if (priceEl) {
    const awaitingPizzaSize = isPizza && typeof _pizzaHasSizePricing === 'function' && _pizzaHasSizePricing(i) && (typeof _pizzaSizeKey === 'undefined' || !_pizzaSizeKey);
    priceEl.textContent = (awaitingPizzaSize ? 'A partir de R$ ' : 'R$ ') + fmt(awaitingPizzaSize && typeof _pizzaMinPrice === 'function' ? _pizzaMinPrice(i) : basePrice);
  }
  if (isPizza && typeof updateImAddBtn === 'function') {
    updateImAddBtn();
    return;
  }
  if (btn && _lojaAberta) btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2h1.5l1.8 7.5h6.5l1.2-5H5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="13" r="1" fill="currentColor"/><circle cx="12" cy="13" r="1" fill="currentColor"/></svg> Adicionar · R$ ${fmt(total)}`;
}

// Cross-sell: suggest items from other categories
function renderImXsell(item) {
  const wrap = document.getElementById('im-xsell-wrap');
  if (!wrap) return;
  const itemCat = item.cat_key || item.cat || '';
  // Get up to 8 items from different categories
  const others = allItems.filter(x =>
    x.id !== item.id &&
    x.status !== 'pausado' && x.status !== 'esgotado' &&
    (x.cat_key || x.cat) !== itemCat
  ).slice(0, 8);
  if (!others.length) { wrap.innerHTML = ''; return; }

  const cards = others.map(o => `
    <div class="xsell-card" id="xsell_${o.id}" onclick="xsellToggle(${o.id})" style="position:relative">
      <div class="xsell-img">${o.image_url ? `<img src="${o.image_url}" >` : (o.emoji||'')}</div>
      <div class="xsell-body">
        <div class="xsell-name">${o.name}</div>
        <div class="xsell-price">R$ ${fmt(o.price)}</div>
      </div>
      <div class="xsell-check">✓</div>
    </div>`).join('');

  wrap.innerHTML = `<div class="xsell-section">
    <div class="xsell-title">Adicionar ao pedido</div>
    <div class="xsell-scroll">${cards}</div>
  </div>`;
}

// Cross-sell state
const _xsellSelected = new Set();

function xsellToggle(itemId) {
  const card = document.getElementById(`xsell_${itemId}`);
  if (!card) return;
  if (_xsellSelected.has(itemId)) {
    _xsellSelected.delete(itemId);
    card.classList.remove('on');
  } else {
    _xsellSelected.add(itemId);
    card.classList.add('on');
  }
}

// ── cardapio-burger.js ──────────────────────────────────────────
// ══════════════════════════════════════════
//  BURGER — Animação canvas do hambúrguer
//  Estima Food — Cardápio
// ══════════════════════════════════════════
// ══════════════════════════════════════════════════════
//  HAMBÚRGUER — Canvas 2D animação avançada de montagem
// ══════════════════════════════════════════════════════
let _burgerCanvas = null, _burgerCtx = null, _burgerRaf = null;
let _burgerLayers = []; // {name, drawFn, y, targetY, vy, alpha, removing}
let _topBunY = 60;

const _BG_CX  = 80;   // center X
const _BG_W   = 136;  // ingredient width
const _BB_CY  = 176;  // bottom bun center Y
const _SLOT_H = 15;   // vertical slot per layer

/* ── Bun draw helpers ─────────────────────────────── */
function _drawBurgerBottomBun(ctx, cx, cy, w) {
  const h = 22, hw = w * .52;
  ctx.save();
  // shadow
  ctx.shadowColor = 'rgba(0,0,0,.22)';
  ctx.shadowBlur  = 8;
  ctx.shadowOffsetY = 4;
  // bun body
  const g = ctx.createLinearGradient(cx, cy - h*.5, cx, cy + h*.5);
  g.addColorStop(0, '#f0c070');
  g.addColorStop(0.5, '#e8a840');
  g.addColorStop(1, '#c87820');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, hw, h*.52, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  // cut face (lighter)
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.ellipse(cx, cy - h*.1, hw * .92, h*.28, 0, 0, Math.PI * 2);
  ctx.fill();
  // highlight
  ctx.fillStyle = 'rgba(255,255,220,.35)';
  ctx.beginPath();
  ctx.ellipse(cx - hw*.18, cy - h*.25, hw*.42, h*.15, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function _drawBurgerTopBun(ctx, cx, cy, w) {
  const hw = w * .52;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.18)';
  ctx.shadowBlur  = 10;
  ctx.shadowOffsetY = 5;
  // bun dome
  const g = ctx.createLinearGradient(cx, cy - 28, cx, cy + 10);
  g.addColorStop(0, '#f59e0b');
  g.addColorStop(0.4, '#d97706');
  g.addColorStop(1, '#b45309');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - hw, cy + 8);
  ctx.quadraticCurveTo(cx - hw * 1.04, cy - 4, cx - hw * .5, cy - 20);
  ctx.quadraticCurveTo(cx, cy - 34, cx + hw * .5, cy - 20);
  ctx.quadraticCurveTo(cx + hw * 1.04, cy - 4, cx + hw, cy + 8);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  // bottom flat part
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 6, hw * .98, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  // highlight dome
  ctx.fillStyle = 'rgba(255,255,220,.28)';
  ctx.beginPath();
  ctx.ellipse(cx - hw*.15, cy - 16, hw*.42, 10, -0.3, 0, Math.PI * 2);
  ctx.fill();
  // sesame seeds
  ctx.fillStyle = '#fff8e1';
  const seeds = [[-18,-10],[0,-18],[18,-10],[-10,-4],[10,-6],[26,-2],[-26,-2]];
  seeds.forEach(([dx,dy]) => {
    ctx.save();
    ctx.translate(cx + dx, cy + dy);
    ctx.rotate(dx * 0.06);
    ctx.beginPath();
    ctx.ellipse(0, 0, 4.5, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f0dea0';
    ctx.beginPath();
    ctx.ellipse(0.5, -0.5, 3.5, 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
  ctx.restore();
}

/* ── Per-ingredient Canvas 2D draw functions ──────── */
const _burgerIngShapes = {

  alface(ctx, cx, y, w) {
    const h = 14;
    ctx.save();
    const g = ctx.createLinearGradient(cx, y, cx, y + h);
    g.addColorStop(0, '#4ade80'); g.addColorStop(1, '#16a34a');
    ctx.fillStyle = g;
    ctx.beginPath();
    const S = 14, hw = w * .54;
    ctx.moveTo(cx - hw, y + h * .75);
    for (let i = 0; i <= S; i++) {
      const tx = cx - hw + (hw * 2) * i / S;
      const ty = y + h * .2 + Math.sin(i * 1.9 + .4) * h * .42;
      i === 0 ? ctx.moveTo(tx, ty) : ctx.lineTo(tx, ty);
    }
    ctx.lineTo(cx + hw, y + h * .95); ctx.lineTo(cx - hw, y + h * .95); ctx.closePath(); ctx.fill();
    // vein
    ctx.strokeStyle = 'rgba(21,128,61,.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - hw * .4, y + h * .55); ctx.lineTo(cx + hw * .3, y + h * .8); ctx.stroke();
    // highlight frills
    ctx.fillStyle = 'rgba(187,247,208,.4)';
    for (let i = 0; i < S; i++) {
      const tx = cx - hw + (hw * 2) * i / S;
      const ty = y + h * .2 + Math.sin(i * 1.9 + .4) * h * .42;
      ctx.beginPath(); ctx.arc(tx, ty, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  },

  tomate(ctx, cx, y, w) {
    const h = 13, r = w * .47;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(cx, y + h * .52, r, h * .46, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444'; ctx.fill();
    // segments
    ctx.save(); ctx.clip();
    ctx.strokeStyle = '#fca5a5'; ctx.lineWidth = .7; ctx.globalAlpha = .65;
    for (let a = 0; a < 6; a++) {
      const angle = a / 6 * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, y + h * .52);
      ctx.lineTo(cx + Math.cos(angle) * r, y + h * .52 + Math.sin(angle) * h * .44); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // seeds
    ctx.fillStyle = '#fef08a';
    for (let i = 0; i < 8; i++) {
      const a2 = i / 8 * Math.PI * 2, d = r * .52;
      ctx.beginPath(); ctx.ellipse(cx + Math.cos(a2) * d, y + h * .52 + Math.sin(a2) * h * .42, 2.4, 1.4, a2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // skin sheen
    ctx.globalAlpha = .15; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(cx - r * .3, y + h * .28, r * .35, h * .18, -.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },

  queijo(ctx, cx, y, w) {
    const h = 10, hw = w * .54;
    ctx.save();
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.moveTo(cx - hw, y + 3);
    ctx.lineTo(cx - hw * .35, y); ctx.lineTo(cx + hw * .1, y + 1.5); ctx.lineTo(cx + hw * .45, y);
    ctx.lineTo(cx + hw, y + 2);
    ctx.lineTo(cx + hw + 2, y + h * .55);
    ctx.quadraticCurveTo(cx + hw + 1, y + h + 5, cx + hw - 8, y + h + 8);
    ctx.lineTo(cx + hw - 12, y + h);
    ctx.lineTo(cx - hw, y + h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fef9c3'; ctx.globalAlpha = .55;
    ctx.fillRect(cx - hw + 2, y + 1, hw * .9, 3.5);
    // left drip
    ctx.globalAlpha = 1; ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.moveTo(cx - hw * .6, y + h);
    ctx.quadraticCurveTo(cx - hw * .55, y + h + 6, cx - hw * .52, y + h + 9);
    ctx.quadraticCurveTo(cx - hw * .48, y + h + 6, cx - hw * .44, y + h);
    ctx.fill();
    ctx.restore();
  },

  bacon(ctx, cx, y, w) {
    const h = 12, hw = w * .52;
    ctx.save();
    const STRIPS = 3;
    for (let s = 0; s < STRIPS; s++) {
      const sy = y + s * (h / STRIPS);
      const meat = s % 2 === 0;
      ctx.fillStyle = meat ? '#b91c1c' : '#fca5a5';
      ctx.beginPath();
      const pts = 10;
      for (let i = 0; i <= pts; i++) {
        const tx = cx - hw + (hw * 2) * i / pts;
        const ty = sy + Math.sin(i * 1.4 + s * 2.1) * 2;
        i === 0 ? ctx.moveTo(tx, ty) : ctx.lineTo(tx, ty);
      }
      ctx.lineTo(cx + hw, sy + h / STRIPS + 1);
      ctx.lineTo(cx - hw, sy + h / STRIPS + 1); ctx.closePath(); ctx.fill();
    }
    // fat streaks
    ctx.strokeStyle = 'rgba(255,240,220,.6)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) {
      const sx = cx - hw * .8 + i * hw * .38;
      ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx + hw * .05, y + h); ctx.stroke();
    }
    ctx.restore();
  },

  cebola(ctx, cx, y, w) {
    const h = 11, r0 = w * .46;
    ctx.save();
    for (let r = 4; r >= 0; r--) {
      const rx = r0 - r * r0 * .14, ry = h * .42 - r * h * .07;
      ctx.beginPath(); ctx.ellipse(cx, y + h * .52, rx, ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = r % 2 === 0 ? 'rgba(167,139,250,.85)' : 'rgba(196,181,253,.6)';
      ctx.lineWidth = 1.6; ctx.stroke();
    }
    ctx.fillStyle = 'rgba(237,233,254,.2)';
    ctx.beginPath(); ctx.ellipse(cx, y + h * .52, r0 * .92, h * .4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },

  ovo(ctx, cx, y, w) {
    const h = 15, hw = w * .5;
    ctx.save();
    // white
    ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.12)'; ctx.shadowBlur = 4;
    ctx.beginPath(); ctx.ellipse(cx, y + h * .56, hw, h * .42, 0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#f3f4f6'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(cx, y + h * .56, hw, h * .42, 0, 0, Math.PI * 2); ctx.stroke();
    // yolk
    const yg = ctx.createRadialGradient(cx - hw * .1, y + h * .44, 0, cx, y + h * .5, hw * .26);
    yg.addColorStop(0, '#fef08a'); yg.addColorStop(.6, '#fbbf24'); yg.addColorStop(1, '#d97706');
    ctx.fillStyle = yg;
    ctx.beginPath(); ctx.arc(cx, y + h * .5, hw * .26, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },

  pepino(ctx, cx, y, w) {
    const h = 11, hw = w * .44;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(cx, y + h * .5, hw, h * .44, 0, 0, Math.PI * 2);
    const g = ctx.createLinearGradient(cx, y, cx, y + h);
    g.addColorStop(0, '#86efac'); g.addColorStop(1, '#22c55e');
    ctx.fillStyle = g; ctx.fill();
    // skin lines
    ctx.save(); ctx.clip();
    ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 1;
    for (let i = -4; i <= 4; i++) {
      ctx.globalAlpha = .35;
      ctx.beginPath(); ctx.moveTo(cx + i * hw * .24, y); ctx.lineTo(cx + i * hw * .2, y + h); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fef9c3';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath(); ctx.ellipse(cx - hw * .72 + i * hw * .28, y + h * .5, 2.2, 1.2, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore(); ctx.restore();
  },

  cogumelo(ctx, cx, y, w) {
    const h = 16, hw = w * .4;
    ctx.save();
    // stalk
    ctx.fillStyle = '#e7e5e4';
    ctx.beginPath(); ctx.roundRect(cx - hw * .22, y + h * .52, hw * .44, h * .5, 3); ctx.fill();
    // cap
    ctx.beginPath(); ctx.arc(cx, y + h * .42, hw, Math.PI, 0);
    ctx.lineTo(cx + hw, y + h * .56); ctx.lineTo(cx - hw, y + h * .56); ctx.closePath();
    const mg = ctx.createRadialGradient(cx - hw * .2, y + h * .2, 0, cx, y + h * .42, hw);
    mg.addColorStop(0, '#a16207'); mg.addColorStop(.5, '#78350f'); mg.addColorStop(1, '#3c1a00');
    ctx.fillStyle = mg; ctx.fill();
    // gills underside
    ctx.fillStyle = '#d6b896'; ctx.globalAlpha = .5;
    ctx.beginPath(); ctx.ellipse(cx, y + h * .56, hw, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // spots
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    [[-hw*.5, h*.22],[hw*.15, h*.15],[hw*.5, h*.3]].forEach(([dx,dy]) => {
      ctx.beginPath(); ctx.arc(cx + dx, y + dy, 4, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  },

  maionese(ctx, cx, y, w) {
    const h = 8, hw = w * .52;
    ctx.save();
    ctx.fillStyle = '#fffbeb';
    ctx.beginPath();
    const pts = 14;
    ctx.moveTo(cx - hw, y + h * .5);
    for (let i = 0; i <= pts; i++) {
      const tx = cx - hw + hw * 2 * i / pts;
      const ty = y + Math.sin(i * 2.6) * 2.8 + 1.5;
      ctx.lineTo(tx, ty);
    }
    ctx.lineTo(cx + hw, y + h); ctx.lineTo(cx - hw, y + h); ctx.closePath(); ctx.fill();
    // drips
    ctx.fillStyle = '#fef9c3';
    [-hw*.38, 0, hw*.38].forEach(dx => {
      ctx.beginPath();
      ctx.moveTo(cx + dx - 4, y + h);
      ctx.quadraticCurveTo(cx + dx, y + h + 6, cx + dx + 2, y + h + 9);
      ctx.quadraticCurveTo(cx + dx + 5, y + h + 6, cx + dx + 8, y + h);
      ctx.fill();
    });
    ctx.restore();
  },

  molho(ctx, cx, y, w) {
    const h = 8, hw = w * .52;
    ctx.save();
    ctx.fillStyle = 'rgba(220,38,38,.88)';
    ctx.beginPath();
    const pts = 14;
    for (let i = 0; i <= pts; i++) {
      const tx = cx - hw + hw * 2 * i / pts;
      const ty = y + Math.sin(i * 2.9 + 1.1) * 2.8 + 1.5;
      i === 0 ? ctx.moveTo(tx, ty) : ctx.lineTo(tx, ty);
    }
    ctx.lineTo(cx + hw, y + h); ctx.lineTo(cx - hw, y + h); ctx.closePath(); ctx.fill();
    // drips
    [-hw * .45, hw * .2].forEach(dx => {
      ctx.beginPath();
      ctx.moveTo(cx + dx - 4, y + h);
      ctx.quadraticCurveTo(cx + dx, y + h + 7, cx + dx + 2, y + h + 11);
      ctx.quadraticCurveTo(cx + dx + 5, y + h + 7, cx + dx + 9, y + h);
      ctx.fill();
    });
    ctx.restore();
  },

  carne(ctx, cx, y, w) {
    const h = 18, hw = w * .52;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    const g = ctx.createLinearGradient(cx, y, cx, y + h);
    g.addColorStop(0, '#7c2d12'); g.addColorStop(.45, '#6b2113'); g.addColorStop(1, '#3c0f00');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx, y + h * .52, hw, h * .47, 0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    // texture cracks
    ctx.strokeStyle = 'rgba(60,15,0,.6)'; ctx.lineWidth = 1;
    for (let t = 0; t < 4; t++) {
      ctx.beginPath(); ctx.moveTo(cx - hw * .65 + t * hw * .38, y + h * .42);
      ctx.lineTo(cx - hw * .5 + t * hw * .38, y + h * .62); ctx.stroke();
    }
    // sear grill marks
    ctx.strokeStyle = '#1c0a00'; ctx.lineWidth = 2.5; ctx.globalAlpha = .55;
    [[-.28,.3],[-.28,.55]].forEach(([x1, y1]) => {
      ctx.beginPath(); ctx.moveTo(cx + x1 * hw * 2, y + y1 * h);
      ctx.lineTo(cx + (x1 + .45) * hw * 2, y + (y1 + .04) * h); ctx.stroke();
    });
    ctx.globalAlpha = 1;
    // edge highlight
    ctx.strokeStyle = 'rgba(200,80,20,.4)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(cx, y + h * .52, hw, h * .47, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  },

  frango(ctx, cx, y, w) {
    const h = 17, hw = w * .52;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.2)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
    const g = ctx.createLinearGradient(cx, y, cx, y + h);
    g.addColorStop(0, '#fde68a'); g.addColorStop(.5, '#f59e0b'); g.addColorStop(1, '#b45309');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - hw, y + h * .45);
    ctx.quadraticCurveTo(cx - hw * 1.04, y + h * .1, cx - hw * .28, y + 2);
    ctx.quadraticCurveTo(cx, y, cx + hw * .28, y + 2);
    ctx.quadraticCurveTo(cx + hw * 1.04, y + h * .1, cx + hw, y + h * .45);
    ctx.quadraticCurveTo(cx + hw * 1.04, y + h * .9, cx + hw * .28, y + h - 2);
    ctx.quadraticCurveTo(cx, y + h, cx - hw * .28, y + h - 2);
    ctx.quadraticCurveTo(cx - hw * 1.04, y + h * .9, cx - hw, y + h * .45);
    ctx.fill(); ctx.shadowBlur = 0;
    // breading crumbs
    ctx.fillStyle = 'rgba(180,83,9,.45)';
    for (let i = 0; i < 12; i++) {
      const bx = cx - hw * .7 + (i % 5) * hw * .35;
      const by = y + 4 + Math.floor(i / 5) * (h * .38);
      ctx.beginPath(); ctx.ellipse(bx, by, 3.2, 2, (i * .5), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  },

  default(ctx, cx, y, w) {
    const h = 11, hw = w * .5;
    ctx.save();
    const g = ctx.createLinearGradient(cx, y, cx, y + h);
    g.addColorStop(0, '#fb923c'); g.addColorStop(1, '#c2410c');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx, y + h * .5, hw, h * .46, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
};

function _getBurgerIngShape(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('alface')||n.includes('lettuce')||n.includes('rúcula')||n.includes('rucula')||n.includes('espinafre')||n.includes('folha')) return _burgerIngShapes.alface;
  if (n.includes('tomat'))                                   return _burgerIngShapes.tomate;
  if (n.includes('queijo')||n.includes('cheese')||n.includes('cheddar')||n.includes('mussarela')||n.includes('gruyere')||n.includes('prato')||n.includes('brie')) return _burgerIngShapes.queijo;
  if (n.includes('bacon')||n.includes('panceta'))            return _burgerIngShapes.bacon;
  if (n.includes('cebola')||n.includes('onion'))             return _burgerIngShapes.cebola;
  if (n.includes('ovo')||n.includes('egg'))                  return _burgerIngShapes.ovo;
  if (n.includes('pepino')||n.includes('gherkin')||n.includes('cucumber')) return _burgerIngShapes.pepino;
  if (n.includes('cogumelo')||n.includes('mushroom')||n.includes('shiitake')||n.includes('portobello')) return _burgerIngShapes.cogumelo;
  if (n.includes('maionese')||n.includes('mayo')||n.includes('aioli')||n.includes('mostarda')) return _burgerIngShapes.maionese;
  if (n.includes('ketchup')||n.includes('molho')||n.includes('barbecue')||n.includes('bbq')||n.includes('sauce')||n.includes('pimenta')) return _burgerIngShapes.molho;
  if (n.includes('carne')||n.includes('bife')||n.includes('smash')||n.includes('angus')||n.includes('picanha')||n.includes('blend')||n.includes('patty')) return _burgerIngShapes.carne;
  if (n.includes('frango')||n.includes('chicken')||n.includes('crispy')||n.includes('empanado')||n.includes('grelhado')) return _burgerIngShapes.frango;
  return _burgerIngShapes.default;
}

function _recalcBurgerTargets() {
  const active = _burgerLayers.filter(l => !l.removing);
  active.forEach((l, i) => {
    l.targetY = _BB_CY - 13 - (i + 1) * _SLOT_H;
  });
  _burgerLayers.filter(l => l.removing).forEach(l => {
    l.targetY = l.y - 50;
  });
}

function _addBurgerLayer(name) {
  if (_burgerLayers.find(l => l.name === name && !l.removing)) return;
  const drawFn = _getBurgerIngShape(name);
  const layer = { name, drawFn, y: -25, targetY: 0, vy: -3, alpha: 0, removing: false };
  _burgerLayers.push(layer);
  _recalcBurgerTargets();
  if (!_burgerRaf) _burgerRaf = requestAnimationFrame(_burgerLoop);
}

function _removeBurgerLayer(name) {
  const l = _burgerLayers.find(x => x.name === name && !x.removing);
  if (!l) return;
  l.removing = true;
  _recalcBurgerTargets();
  setTimeout(() => {
    _burgerLayers = _burgerLayers.filter(x => !(x.name === name && x.removing));
    _recalcBurgerTargets();
  }, 450);
}

function _burgerLoop() {
  if (!_burgerCanvas) return;
  const ctx = _burgerCtx;
  const W = _burgerCanvas.width, H = _burgerCanvas.height;
  ctx.clearRect(0, 0, W, H);

  // bottom bun
  _drawBurgerBottomBun(ctx, _BG_CX, _BB_CY, _BG_W);

  // layers — draw bottom-first (lower index = lower in burger)
  for (const l of _burgerLayers) {
    const spring = 0.17, damp = 0.62;
    l.vy += (l.targetY - l.y) * spring;
    l.vy *= damp;
    l.y  += l.vy;
    l.alpha = l.removing ? Math.max(0, l.alpha - 0.07) : Math.min(1, l.alpha + 0.12);
    ctx.save(); ctx.globalAlpha = l.alpha;
    l.drawFn(ctx, _BG_CX, l.y, _BG_W);
    ctx.restore();
  }

  // top bun — floats above highest active layer
  const active = _burgerLayers.filter(l => !l.removing);
  const topmost = active.length > 0 ? Math.min(...active.map(l => l.y)) : _BB_CY - 14;
  _topBunY += (topmost - 30 - _topBunY) * 0.10;
  _drawBurgerTopBun(ctx, _BG_CX, _topBunY, _BG_W);

  // idle sway when no ingredients
  if (_burgerLayers.length === 0) {
    const t = Date.now() / 1800;
    _topBunY += Math.sin(t) * 0.3;
  }

  _burgerRaf = requestAnimationFrame(_burgerLoop);
}

function _initBurgerCanvas() {
  _burgerLayers = [];
  _burgerCanvas = document.getElementById('burger-canvas');
  if (!_burgerCanvas) return;
  _burgerCtx = _burgerCanvas.getContext('2d');
  _topBunY = _BB_CY - 42;
  if (_burgerRaf) { cancelAnimationFrame(_burgerRaf); _burgerRaf = null; }
  _burgerRaf = requestAnimationFrame(_burgerLoop);
}

function _stopBurgerAnim() {
  if (_burgerRaf) { cancelAnimationFrame(_burgerRaf); _burgerRaf = null; }
  _burgerCanvas = null; _burgerCtx = null; _burgerLayers = [];
}

// ── cardapio-core.js ──────────────────────────────────────────
// ══════════════════════════════════════════
//  CORE — Tenant, branding, init, realtime, status da loja
//  Estima Food — Cardápio
// ══════════════════════════════════════════

// ── Favicon dinâmico (usa logo da loja) ─────────────────
// Aceita URL absoluta, caminho relativo ou data URL.
// Em caso de falha de carregamento, mantém o favicon padrão.
function setFavicon(url) {
  if (!url) return;
  // Pré-carrega pra garantir que a imagem é válida antes de trocar
  const test = new Image();
  test.onload = () => {
    // Remove favicons existentes
    document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach(el => el.remove());
    // Favicon padrão (navegador)
    const link = document.createElement('link');
    link.rel  = 'icon';
    link.href = url;
    // Deixa o navegador auto-detectar o type (png/jpg/webp/svg)
    document.head.appendChild(link);
    // Apple touch icon (iOS, PWA "add to home screen")
    const apple = document.createElement('link');
    apple.rel  = 'apple-touch-icon';
    apple.href = url;
    document.head.appendChild(apple);
  };
  test.onerror = () => {}; // mantém favicon atual em caso de falha
  test.src = url;
}

function upsertMeta(selectorAttr, selectorValue, content) {
  if (!content) return;
  let el = document.querySelector(`meta[${selectorAttr}="${selectorValue}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(selectorAttr, selectorValue);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function applyShareMeta(branding, nome) {
  const title = branding?.store_name || nome || 'Cardapio';
  const desc = branding?.store_descricao || 'Faca seu pedido online.';
  const img = branding?.store_logo_url || branding?.store_banner_url || '';
  upsertMeta('property', 'og:type', 'website');
  upsertMeta('property', 'og:title', title);
  upsertMeta('property', 'og:description', desc);
  upsertMeta('property', 'og:url', location.href);
  upsertMeta('name', 'description', desc);
  upsertMeta('name', 'twitter:card', img ? 'summary_large_image' : 'summary');
  upsertMeta('name', 'twitter:title', title);
  upsertMeta('name', 'twitter:description', desc);
  if (img) {
    const url = (img.startsWith('http') || img.startsWith('data:')) ? img : location.origin + img;
    upsertMeta('property', 'og:image', url);
    upsertMeta('name', 'twitter:image', url);
  }
}

function parseHexColor(cor) {
  const raw = String(cor || '').trim();
  const short = raw.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) {
    return {
      hex: '#' + short.slice(1).map(x => x + x).join('').toLowerCase(),
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16)
    };
  }
  const full = raw.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!full) return null;
  return {
    hex: raw.toLowerCase(),
    r: parseInt(full[1], 16),
    g: parseInt(full[2], 16),
    b: parseInt(full[3], 16)
  };
}

function rgbToHex(r, g, b) {
  const toHex = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

function setAccentColor(cor) {
  const root = document.documentElement;
  const base = String(cor || '#f97316').trim() || '#f97316';
  root.style.setProperty('--accent', base);

  const parsed = parseHexColor(base);
  if (!parsed) {
    root.style.setProperty('--accent-g', `linear-gradient(135deg, ${base}, ${base})`);
    return;
  }

  const darker = rgbToHex(parsed.r * 0.82, parsed.g * 0.82, parsed.b * 0.82);
  root.style.setProperty('--accent', parsed.hex);
  root.style.setProperty('--accent-d', darker);
  root.style.setProperty('--accent-g', `linear-gradient(135deg, ${parsed.hex}, ${darker})`);
  root.style.setProperty('--accent-rgb', `${parsed.r},${parsed.g},${parsed.b}`);
}

async function resolveTenant() {
  const p    = new URLSearchParams(location.search);
  let slug = p.get('slug') || p.get('t');
  const tid  = p.get('tenant');
  // Também aceita o slug vindo do CAMINHO da URL (/l/<slug>) — usado no
  // link "instalável" como app. O scope de um PWA é baseado no caminho,
  // não no parâmetro depois do "?", então precisávamos de um caminho de
  // verdade diferente por loja pra o Android não confundir uma loja
  // instalada com outra ao clicar num link de loja diferente.
  if (!slug && !tid) {
    const m = location.pathname.match(/^\/l\/([^/]+)\/?$/);
    if (m) slug = decodeURIComponent(m[1]);
  }
  const fetchInfo = async (qs) => {
    const r = await fetch('/api/tenant-info' + qs);
    const d = await r.json();
    return d.id ? d : null;
  };
  let info = null;
  if (tid)         info = await fetchInfo(`?id=${encodeURIComponent(tid)}`).catch(()=>null);
  if (!info && slug) {
    info = await fetchInfo(`?slug=${encodeURIComponent(slug)}`).catch(()=>null);
    if (!info) return null;
  }
  if (!info) info = await fetchInfo('?default=1').catch(()=>null);
  return info;
}

function applyTema(tema, accentCor) {
  const root = document.documentElement;
  const t = tema || 'classico';
  // Remove tema anterior
  root.removeAttribute('data-tema');
  root.setAttribute('data-tema', t);

  // Paletas de cada tema (variáveis CSS sobrescritas)
  const paletas = {
    classico: {
      '--bg':'#f8f9fb','--s1':'#ffffff','--s2':'#f1f3f7','--s3':'#e4e8ef',
      '--border':'rgba(0,0,0,.09)','--border2':'rgba(0,0,0,.14)',
      '--text':'#0f1117','--muted':'#6b7280','--muted2':'#9ca3af','--white':'#fff',
      '--hero-bg':'','--hero-text':'#fff','--hero-desc-color':'rgba(255,255,255,.85)',
      '--hero-overlay':'rgba(0,0,0,.55)','--sticky-bg':'#f8f9fb'
    },
    dark: {
      '--bg':'#0f1117','--s1':'#181b24','--s2':'#1e2130','--s3':'#242840',
      '--border':'rgba(255,255,255,.07)','--border2':'rgba(255,255,255,.13)',
      '--text':'#e5e7eb','--muted':'#9ca3af','--muted2':'#6b7280','--white':'#fff',
      '--hero-bg':'#0a0c13','--hero-text':'#fff','--hero-desc-color':'rgba(255,255,255,.7)',
      '--hero-overlay':'rgba(0,0,0,.65)','--sticky-bg':'#0f1117'
    },
    tropical: {
      '--bg':'#fef9f0','--s1':'#fff7ed','--s2':'#ffedd5','--s3':'#fed7aa',
      '--border':'rgba(234,88,12,.14)','--border2':'rgba(234,88,12,.22)',
      '--text':'#431407','--muted':'#92400e','--muted2':'#b45309','--white':'#fff',
      '--hero-bg':'#431407','--hero-text':'#fff','--hero-desc-color':'rgba(255,220,180,.9)',
      '--hero-overlay':'rgba(67,20,7,.65)','--sticky-bg':'#fef9f0'
    },
    minimalista: {
      '--bg':'#ffffff','--s1':'#fafafa','--s2':'#f5f5f5','--s3':'#e5e5e5',
      '--border':'rgba(0,0,0,.06)','--border2':'rgba(0,0,0,.10)',
      '--text':'#111111','--muted':'#737373','--muted2':'#a3a3a3','--white':'#fff',
      '--hero-bg':'#111111','--hero-text':'#fff','--hero-desc-color':'rgba(255,255,255,.75)',
      '--hero-overlay':'rgba(0,0,0,.7)','--sticky-bg':'#ffffff'
    },
    acougue: {
      '--bg':'#1a0a05','--s1':'#2a100a','--s2':'#3a1810','--s3':'#4a2018',
      '--border':'rgba(220,80,30,.2)','--border2':'rgba(220,80,30,.35)',
      '--text':'#f5e6e0','--muted':'#c9a090','--muted2':'#a07060','--white':'#fff',
      '--hero-bg':'#0f0503','--hero-text':'#fff','--hero-desc-color':'rgba(255,210,190,.9)',
      '--hero-overlay':'rgba(15,5,3,.7)','--sticky-bg':'#1a0a05'
    },
    verde: {
      '--bg':'#f0faf2','--s1':'#ffffff','--s2':'#e8f5eb','--s3':'#d1ecda',
      '--border':'rgba(34,120,60,.12)','--border2':'rgba(34,120,60,.2)',
      '--text':'#0d2b18','--muted':'#3a7a52','--muted2':'#5a9a72','--white':'#fff',
      '--hero-bg':'#0d3320','--hero-text':'#fff','--hero-desc-color':'rgba(210,255,225,.9)',
      '--hero-overlay':'rgba(13,50,32,.65)','--sticky-bg':'#f0faf2'
    },
    noturno: {
      '--bg':'#080810','--s1':'#0f0f1c','--s2':'#161625','--s3':'#1e1e30',
      '--border':'rgba(255,255,255,.06)','--border2':'rgba(255,255,255,.10)',
      '--text':'#eeedf6','--muted':'#7878a0','--muted2':'#50506a','--white':'#fff',
      '--hero-bg':'#04040c','--hero-text':'#fff','--hero-desc-color':'rgba(230,228,248,.80)',
      '--hero-overlay':'rgba(4,4,12,.72)','--sticky-bg':'#080810'
    },
    rose: {
      '--bg':'#fff5f7','--s1':'#ffffff','--s2':'#ffe4ea','--s3':'#ffc9d5',
      '--border':'rgba(220,60,90,.12)','--border2':'rgba(220,60,90,.2)',
      '--text':'#3d0a14','--muted':'#a03050','--muted2':'#c06070','--white':'#fff',
      '--hero-bg':'#5c0a1e','--hero-text':'#fff','--hero-desc-color':'rgba(255,210,220,.9)',
      '--hero-overlay':'rgba(92,10,30,.65)','--sticky-bg':'#fff5f7'
    },
    oceano: {
      '--bg':'#0a1628','--s1':'#0f1f38','--s2':'#152a48','--s3':'#1c3558',
      '--border':'rgba(56,189,248,.1)','--border2':'rgba(56,189,248,.18)',
      '--text':'#e0ecf8','--muted':'#6890b0','--muted2':'#4a7090','--white':'#fff',
      '--hero-bg':'#040c18','--hero-text':'#fff','--hero-desc-color':'rgba(200,230,255,.85)',
      '--hero-overlay':'rgba(4,12,24,.7)','--sticky-bg':'#0a1628'
    },
    dourado: {
      '--bg':'#0f0d08','--s1':'#1a1610','--s2':'#242018','--s3':'#2e2820',
      '--border':'rgba(212,165,116,.12)','--border2':'rgba(212,165,116,.2)',
      '--text':'#f0e8d8','--muted':'#a09070','--muted2':'#807060','--white':'#fff',
      '--hero-bg':'#0a0806','--hero-text':'#fff','--hero-desc-color':'rgba(240,232,216,.85)',
      '--hero-overlay':'rgba(10,8,6,.7)','--sticky-bg':'#0f0d08'
    },
    delivery_pro: {
      '--bg':'#f6f7fb','--s1':'#ffffff','--s2':'#edf2f7','--s3':'#d8e0ec',
      '--border':'rgba(15,23,42,.08)','--border2':'rgba(15,23,42,.14)',
      '--text':'#132032','--muted':'#617089','--muted2':'#94a3b8','--white':'#fff',
      '--hero-bg':'#101827','--hero-text':'#fff','--hero-desc-color':'rgba(226,232,240,.86)',
      '--hero-overlay':'rgba(16,24,39,.62)','--sticky-bg':'#f6f7fb'
    },
    fresh_verde: {
      '--bg':'#f4fbf6','--s1':'#ffffff','--s2':'#e8f6ee','--s3':'#cfeade',
      '--border':'rgba(22,101,52,.10)','--border2':'rgba(22,101,52,.18)',
      '--text':'#10291d','--muted':'#3f7459','--muted2':'#6b9a80','--white':'#fff',
      '--hero-bg':'#10351f','--hero-text':'#fff','--hero-desc-color':'rgba(220,252,231,.88)',
      '--hero-overlay':'rgba(16,53,31,.66)','--sticky-bg':'#f4fbf6'
    },
    burger_red: {
      '--bg':'#fff6ed','--s1':'#fffaf5','--s2':'#fee8cc','--s3':'#fbc891',
      '--border':'rgba(194,65,12,.14)','--border2':'rgba(194,65,12,.24)',
      '--text':'#3b1606','--muted':'#9a3412','--muted2':'#c25b19','--white':'#fff',
      '--hero-bg':'#3f0f08','--hero-text':'#fff','--hero-desc-color':'rgba(255,237,213,.9)',
      '--hero-overlay':'rgba(63,15,8,.68)','--sticky-bg':'#fff6ed'
    },
    acai_berry: {
      '--bg':'#fff7fb','--s1':'#ffffff','--s2':'#f7e6f0','--s3':'#edc4dc',
      '--border':'rgba(134,25,80,.12)','--border2':'rgba(134,25,80,.22)',
      '--text':'#351123','--muted':'#8a3a63','--muted2':'#ad5a82','--white':'#fff',
      '--hero-bg':'#3d1028','--hero-text':'#fff','--hero-desc-color':'rgba(252,231,243,.88)',
      '--hero-overlay':'rgba(61,16,40,.68)','--sticky-bg':'#fff7fb'
    },
    sushi_black: {
      '--bg':'#070b0c','--s1':'#101719','--s2':'#172426','--s3':'#203437',
      '--border':'rgba(125,211,252,.10)','--border2':'rgba(125,211,252,.18)',
      '--text':'#edfafa','--muted':'#93b5b8','--muted2':'#6b8f93','--white':'#fff',
      '--hero-bg':'#020607','--hero-text':'#fff','--hero-desc-color':'rgba(224,242,254,.84)',
      '--hero-overlay':'rgba(2,6,7,.74)','--sticky-bg':'#070b0c'
    },
    pizzaria_italia: {
      '--bg':'#fbf7ef','--s1':'#ffffff','--s2':'#fff0df','--s3':'#f8d8b3',
      '--border':'rgba(127,29,29,.12)','--border2':'rgba(21,128,61,.18)',
      '--text':'#332014','--muted':'#7d5a3a','--muted2':'#9b7652','--white':'#fff',
      '--hero-bg':'#12351f','--hero-text':'#fff','--hero-desc-color':'rgba(240,253,244,.86)',
      '--hero-overlay':'rgba(18,53,31,.66)','--sticky-bg':'#fbf7ef'
    },
    padaria_gold: {
      '--bg':'#fff8ee','--s1':'#fffdf8','--s2':'#ffeccf','--s3':'#f5d29a',
      '--border':'rgba(180,83,9,.12)','--border2':'rgba(180,83,9,.22)',
      '--text':'#352411','--muted':'#815c2b','--muted2':'#a3773d','--white':'#fff',
      '--hero-bg':'#4a2a08','--hero-text':'#fff','--hero-desc-color':'rgba(254,243,199,.88)',
      '--hero-overlay':'rgba(74,42,8,.66)','--sticky-bg':'#fff8ee'
    },
    mercado_azul: {
      '--bg':'#f3f8ff','--s1':'#ffffff','--s2':'#e4f0ff','--s3':'#c8defa',
      '--border':'rgba(37,99,235,.10)','--border2':'rgba(37,99,235,.18)',
      '--text':'#10243c','--muted':'#46637f','--muted2':'#6c86a3','--white':'#fff',
      '--hero-bg':'#0b2340','--hero-text':'#fff','--hero-desc-color':'rgba(219,234,254,.88)',
      '--hero-overlay':'rgba(11,35,64,.66)','--sticky-bg':'#f3f8ff'
    },
    premium_clean: {
      '--bg':'#f7f7f5','--s1':'#ffffff','--s2':'#ededeb','--s3':'#deded8',
      '--border':'rgba(24,24,27,.07)','--border2':'rgba(24,24,27,.12)',
      '--text':'#18181b','--muted':'#71717a','--muted2':'#a1a1aa','--white':'#fff',
      '--hero-bg':'#111827','--hero-text':'#fff','--hero-desc-color':'rgba(244,244,245,.82)',
      '--hero-overlay':'rgba(17,24,39,.64)','--sticky-bg':'#f7f7f5'
    },
    noite_delivery: {
      '--bg':'#0e1118','--s1':'#161b24','--s2':'#202635','--s3':'#293244',
      '--border':'rgba(255,255,255,.07)','--border2':'rgba(255,255,255,.12)',
      '--text':'#f8fafc','--muted':'#9aa4b2','--muted2':'#778295','--white':'#fff',
      '--hero-bg':'#070a10','--hero-text':'#fff','--hero-desc-color':'rgba(226,232,240,.82)',
      '--hero-overlay':'rgba(7,10,16,.72)','--sticky-bg':'#0e1118'
    },
    moderno: {
      '--bg':'#f7f7f8','--s1':'#ffffff','--s2':'#f1f1f3','--s3':'#e4e4e8',
      '--border':'rgba(0,0,0,.08)','--border2':'rgba(0,0,0,.14)',
      '--text':'#1a1a1a','--muted':'#767676','--muted2':'#a3a3a3','--white':'#fff',
      '--hero-bg':'','--hero-text':'#1a1a1a','--hero-desc-color':'rgba(26,26,26,.65)',
      '--hero-overlay':'rgba(255,255,255,0)','--sticky-bg':'#ffffff'
    }
  };

  const p = paletas[t] || paletas.classico;
  Object.entries(p).forEach(([k,v]) => { if(v !== '') root.style.setProperty(k, v); else root.style.removeProperty(k); });

  // Força meta theme-color
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  const bgMap = {
    classico:'#f8f9fb', dark:'#0f1117', tropical:'#fef9f0', minimalista:'#ffffff',
    acougue:'#1a0a05', verde:'#f0faf2', noturno:'#080810', rose:'#fff5f7',
    oceano:'#0a1628', dourado:'#0f0d08', delivery_pro:'#f6f7fb',
    fresh_verde:'#f4fbf6', burger_red:'#fff6ed', acai_berry:'#fff7fb',
    sushi_black:'#070b0c', pizzaria_italia:'#fbf7ef', padaria_gold:'#fff8ee',
    mercado_azul:'#f3f8ff', premium_clean:'#f7f7f5', noite_delivery:'#0e1118',
    moderno:'#f7f7f8'
  };
  if (metaTheme) metaTheme.content = bgMap[t] || '#f8f9fb';
}

// ══════════════════════════════════════════
//  BANNER DO CARDÁPIO — imagem ou vídeo, até 5 em slide
// ══════════════════════════════════════════
let _heroBannerTimer = null;

// Lê a lista de banners configurada no gestor (store_banners, novo)
// com fallback pro campo antigo (store_banner_url, single) pra tenants que
// ainda não mexeram na tela nova.
function getBannerList(b) {
  if (!b) return [];
  try {
    const raw = b.store_banners;
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(arr) && arr.length) {
      return arr.filter(x => x && x.url).slice(0, 5);
    }
  } catch(e) {}
  if (b.store_banner_url) return [{ type: 'image', url: b.store_banner_url }];
  return [];
}

function applyHeroBanners(list) {
  const heroBanner = document.getElementById('hero-banner');
  if (!heroBanner) return;
  if (_heroBannerTimer) { clearInterval(_heroBannerTimer); _heroBannerTimer = null; }

  const items = Array.isArray(list) ? list.slice(0, 5) : [];
  if (!items.length) {
    heroBanner.classList.remove('show');
    heroBanner.innerHTML = '';
    return;
  }

  const resolveUrl = (u) => (u.startsWith('http') || u.startsWith('data:')) ? u : location.origin + u;
  const slidesHtml = items.map((b, i) => {
    const url = resolveUrl(b.url);
    if (b.type === 'video') {
      return `<div class="hero-banner-slide${i===0?' active':''}" data-i="${i}"><video src="${url}" autoplay muted loop playsinline onerror="this.closest('.hero-banner-slide').style.display='none'"></video></div>`;
    }
    return `<div class="hero-banner-slide${i===0?' active':''}" data-i="${i}"><img src="${url}" alt="banner" loading="lazy" decoding="async" onerror="this.closest('.hero-banner-slide').style.display='none'"></div>`;
  }).join('');
  const dotsHtml = items.length > 1
    ? `<div class="hero-banner-dots">${items.map((_,i)=>`<span class="hero-banner-dot${i===0?' on':''}" data-i="${i}"></span>`).join('')}</div>`
    : '';

  heroBanner.innerHTML = `<div class="hero-banner-slides">${slidesHtml}</div>${dotsHtml}`;
  heroBanner.classList.add('show');
  fixIosVideoAutoplay(heroBanner);

  if (items.length > 1) {
    let idx = 0;
    _heroBannerTimer = setInterval(() => {
      idx = (idx + 1) % items.length;
      heroBanner.querySelectorAll('.hero-banner-slide').forEach(el => el.classList.toggle('active', Number(el.dataset.i) === idx));
      heroBanner.querySelectorAll('.hero-banner-dot').forEach(el => el.classList.toggle('on', Number(el.dataset.i) === idx));
    }, 5000);
  }
}

function applyBranding(b, nome) {
  const n = b?.store_name || nome || 'Cardápio';
  _storeName = n;
  window._storeName = n;
  document.title = n;
  applyShareMeta(b, n);
  document.getElementById('hero-name').textContent = n;
  try { if (typeof efChatSetStoreName === 'function') efChatSetStoreName(n); } catch(e) {}
  if (b?.store_descricao) document.getElementById('hero-desc').textContent = b.store_descricao;
  const cor = b?.store_cor || '#f97316';

  // Aplica tema ANTES da cor de accent, para a paleta correta já estar ativa
  applyTema(b?.store_tema, cor);

  setAccentColor(cor);

  // Cor dos textos personalizada
  if (b?.store_cor_texto) {
    document.documentElement.style.setProperty('--text', b.store_cor_texto);
  }

  // Carrossel de categorias (restaurante pode ativar igual açougue)
  if (b?.cats_carrossel && _segmento !== 'acougue') {
    _catsCarrossel = true;
  }

  // Logo circular
  const logoWrap = document.getElementById('hero-logo-wrap');
  if (b?.store_logo_url && logoWrap) {
    const img = document.createElement('img');
    img.src = b.store_logo_url;
    img.alt = n;
    img.decoding = 'async';
    img.className = 'hero-logo-img';
    img.onerror = () => { logoWrap.innerHTML = '<span id="hero-emoji">🍽️</span>'; };
    logoWrap.innerHTML = '';
    logoWrap.appendChild(img);
  }

  // Logo no splash de carregamento
  if (b?.store_logo_url) {
    const splashImg   = document.getElementById('splash-logo-img');
    const splashEmoji = document.getElementById('splash-logo-emoji');
    if (splashImg) {
      splashImg.src = b.store_logo_url;
      splashImg.style.display = 'block';
      if (splashEmoji) splashEmoji.style.display = 'none';
      splashImg.onerror = () => { splashImg.style.display = 'none'; if (splashEmoji) splashEmoji.style.display = ''; };
    }
  }

  // Favicon dinâmico — usa o logo da loja
  if (b?.store_logo_url) setFavicon(b.store_logo_url);

  // Portal de boas-vindas do cardápio de mesa/tablet (mesa-tablet.html) —
  // só existe nesse arquivo; em index.html esse elemento não existe, então
  // isso não faz nada (seguro reaproveitar a mesma função pros dois).
  const gateLogoWrap = document.getElementById('mesa-gate-logo-wrap');
  if (gateLogoWrap) {
    const gateImg = document.getElementById('mesa-gate-logo-img');
    const gateEmoji = document.getElementById('mesa-gate-emoji');
    if (b?.store_logo_url && gateImg) {
      gateImg.src = b.store_logo_url;
      gateImg.style.display = 'block';
      if (gateEmoji) gateEmoji.style.display = 'none';
    }
    const gateName = document.getElementById('mesa-gate-storename');
    if (gateName) gateName.textContent = n;
    const gateBg = document.getElementById('mesa-gate-bg');
    if (gateBg && b?.tablet_splash_bg_url) {
      gateBg.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,.05), rgba(0,0,0,.25)), url('${b.tablet_splash_bg_url}')`;
    } else if (gateBg && b?.store_banner_url) {
      // Sem fundo específico configurado pro tablet — usa o banner da loja
      // (já existe, fica bonito, e assim não obriga a configurar de novo).
      gateBg.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,.05), rgba(0,0,0,.25)), url('${b.store_banner_url}')`;
    }
  }

  // Cabeçalho da marca na faixa direita (layout de totem) — mesma logo e
  // nome do portal de boas-vindas, só que fica sempre visível ali depois
  // que o cliente já entrou no cardápio.
  const sideLogoWrap = document.getElementById('totem-sidebar-logo');
  if (sideLogoWrap) {
    const sideImg = document.getElementById('totem-sidebar-logo-img');
    const sideEmoji = document.getElementById('totem-sidebar-emoji');
    if (b?.store_logo_url && sideImg) {
      sideImg.src = b.store_logo_url;
      sideImg.style.display = 'block';
      if (sideEmoji) sideEmoji.style.display = 'none';
    }
    const sideName = document.getElementById('totem-sidebar-name');
    if (sideName) sideName.textContent = n;
  }

  // Banner — aparece apenas no topo (atrás do cartão). Suporta até 5 banners em slide (imagem ou vídeo).
  applyHeroBanners(getBannerList(b));

  // Tempo de entrega
  if (b?.store_tempo_entrega) {
    const el = document.getElementById('hero-tempo');
    if (el) el.textContent = b.store_tempo_entrega;
    const badge = document.getElementById('badge-tempo');
    if (badge) { badge.style.display = ''; }
    const sep = document.getElementById('sep-tempo');
    if (sep) sep.style.display = '';
    const trustEl = document.getElementById('trust-tempo');
    if (trustEl) trustEl.textContent = b.store_tempo_entrega;
  }

  // Avaliação
  if (b?.store_avaliacao) {
    const el = document.getElementById('hero-aval');
    if (el) el.textContent = b.store_avaliacao;
    const badge = document.getElementById('badge-aval');
    if (badge) badge.style.display = '';
    const sep = document.getElementById('sep-aval');
    if (sep) sep.style.display = '';
    const trustEl = document.getElementById('trust-aval');
    if (trustEl) trustEl.textContent = b.store_avaliacao;
  }

  // WhatsApp
  if (b?.store_whatsapp) {
    _waNumero = b.store_whatsapp.replace(/\D/g, '');
    if (_waNumero.length <= 11) _waNumero = '55' + _waNumero;
  }

  _applyPromoBanner(b);
}

// ── Banner(s) promocional(is) configurável(is) (tipo "Kit Churrasco") ──
// Já funciona em qualquer segmento (era só açougue antes; CSS liberou).
// Suporta até 5 banners em rotação automática a cada 4s (mesmo espírito do
// carrossel de fotos do topo — dots + troca automática).
let _promoBannerTimer = null;
function _applyPromoBanner(cfg) {
  const wrap = document.getElementById('promo-banner');
  if (!wrap) return;
  clearInterval(_promoBannerTimer);
  _promoBannerTimer = null;

  // Formato novo: array em promo_banners. Formato antigo (1 banner só nos
  // campos promo_banner_*) continua funcionando pra quem salvou antes da
  // atualização — só não dá pra editar mais ele na tela nova.
  let lista = [];
  try {
    const raw = cfg?.promo_banners;
    lista = Array.isArray(raw) ? raw : (raw ? JSON.parse(raw) : []);
  } catch(e) { lista = []; }
  if (!lista.length && cfg?.promo_banner_titulo) {
    lista = [{
      titulo: cfg.promo_banner_titulo, destaque: cfg.promo_banner_destaque,
      subtitulo: cfg.promo_banner_subtitulo, cta_texto: cfg.promo_banner_cta_texto,
      image_url: cfg.promo_banner_image_url, selo: cfg.promo_banner_selo,
      categoria: cfg.promo_banner_categoria,
    }];
  }
  lista = lista.filter(b => b && b.titulo).slice(0, 5);

  const ativo = cfg?.promo_banner_ativo && lista.length;
  if (!ativo) { wrap.classList.remove('show'); wrap.innerHTML = ''; return; }

  const _esc = (s) => String(s || '').replace(/</g, '&lt;');
  const slidesHtml = lista.map((b, i) => {
    const titulo    = _esc(b.titulo);
    const destaque  = _esc(b.destaque);
    const subtitulo = _esc(b.subtitulo);
    const ctaTexto  = _esc(b.cta_texto || 'Comprar agora');
    const selo      = _esc(b.selo);
    const categoria = b.categoria || '';
    const bg = b.image_url ? `background-image:url('${b.image_url}')` : '';
    return `<div class="promo-banner-slide${i===0?' active':''}" style="${bg}" data-i="${i}">
      <div class="promo-banner-overlay"></div>
      <div class="promo-banner-content">
        <div class="promo-banner-title">${titulo}${destaque ? ` <span class="promo-banner-destaque">${destaque}</span>` : ''}</div>
        ${subtitulo ? `<div class="promo-banner-sub">${subtitulo}</div>` : ''}
        <button type="button" class="promo-banner-btn" onclick="${categoria ? `verMaisCat('${categoria.replace(/'/g,"\\'")}')` : ''}">${ctaTexto}</button>
      </div>
      ${selo ? `<div class="promo-banner-selo">${selo}</div>` : ''}
    </div>`;
  }).join('');
  const dotsHtml = lista.length > 1
    ? `<div class="promo-banner-dots">${lista.map((_,i)=>`<span class="promo-banner-dot${i===0?' on':''}" data-i="${i}"></span>`).join('')}</div>`
    : '';
  wrap.innerHTML = slidesHtml + dotsHtml;
  wrap.classList.add('show');

  if (lista.length > 1) {
    let idx = 0;
    _promoBannerTimer = setInterval(() => {
      idx = (idx + 1) % lista.length;
      wrap.querySelectorAll('.promo-banner-slide').forEach(el => el.classList.toggle('active', Number(el.dataset.i) === idx));
      wrap.querySelectorAll('.promo-banner-dot').forEach(el => el.classList.toggle('on', Number(el.dataset.i) === idx));
    }, 4000);
  }
}

// Mostra pedido mínimo e endereço no hero após carregar store_config
function applyDeliveryInfo() {
  // Pedido mínimo — badge no hero
  if (_pedidoMinimo > 0) {
    const el = document.getElementById('hero-minimo');
    const badge = document.getElementById('badge-minimo');
    const sep = document.getElementById('sep-aval');
    if (el) el.textContent = fmt(_pedidoMinimo);
    if (badge) badge.style.display = '';
    if (sep) sep.style.display = '';
  }

  // Pedido mínimo — barra no carrinho (aba delivery é o padrão)
  const minimoBar = document.getElementById('cart-minimo-bar');
  const minimoVal = document.getElementById('cart-minimo-val');
  if (minimoBar && _pedidoMinimo > 0 && deliveryType === 'delivery') {
    minimoBar.style.display = 'flex';
    if (minimoVal) minimoVal.textContent = 'R$ ' + fmt(_pedidoMinimo);
  }

  // Endereço do estabelecimento — inline elegante
  if (_storeAddress) {
    const bar = document.getElementById('hero-address-bar');
    const txt = document.getElementById('hero-address-txt');
    if (bar) bar.classList.add('show');
    if (txt) txt.textContent = _storeAddress;
  }
}

// ══════════════════════════════════════════
//  STATUS
// ══════════════════════════════════════════
function _storeOpenAtivo(store_open) {
  if (store_open === false || store_open === 0) return false;
  if (typeof store_open === 'string') {
    const v = store_open.trim().toLowerCase();
    if (v === 'false' || v === '0' || v === 'fechado') return false;
  }
  return true;
}

function _parseHorariosConfig(horarios) {
  if (!horarios) return null;
  if (typeof horarios === 'object') return horarios;
  try {
    const parsed = JSON.parse(horarios);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch(e) {
    return null;
  }
}

function _horarioAtivo(cfg) {
  if (!cfg) return false;
  if (cfg.ativo === true || cfg.ativo === 1) return true;
  if (typeof cfg.ativo === 'string') {
    const v = cfg.ativo.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'sim';
  }
  return false;
}

function _horaParaMinutos(valor) {
  const raw = String(valor || '').trim().toLowerCase().replace(/\s+/g, '');
  const match = raw.match(/^(\d{1,2})(?:(?::|h)(\d{1,2}))?h?$/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = match[2] === undefined ? 0 : parseInt(match[2], 10);
  if (h === 24 && m === 0) return 1440;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

// Normaliza o cfg de um dia para uma lista de janelas [{abertura,fechamento}].
// Suporta o formato novo (cfg.janelas = [...]) e o formato antigo, de
// compatibilidade (cfg.abertura/cfg.fechamento direto no dia — 1 janela só).
function _cpJanelasDia(cfg) {
  if (!cfg) return [];
  if (Array.isArray(cfg.janelas) && cfg.janelas.length) return cfg.janelas;
  if (cfg.abertura || cfg.fechamento) return [{ abertura: cfg.abertura, fechamento: cfg.fechamento }];
  return [];
}

function _horarioAbertoNoMinuto(cfg, minutoAtual, usandoDiaAnterior) {
  if (!_horarioAtivo(cfg)) return false;
  const janelas = _cpJanelasDia(cfg);
  if (!janelas.length) return false;
  return janelas.some(j => {
    const abertura = _horaParaMinutos(j.abertura) ?? 0;
    const fechamento = _horaParaMinutos(j.fechamento) ?? 1439;
    if (abertura === fechamento) return true;
    if (fechamento > abertura) {
      return !usandoDiaAnterior && minutoAtual >= abertura && minutoAtual < fechamento;
    }
    return usandoDiaAnterior ? minutoAtual < fechamento : minutoAtual >= abertura;
  });
}

function isLojaAberta(horarios, store_open) {
  if (!_storeOpenAtivo(store_open)) return false;
  const h = _parseHorariosConfig(horarios);
  if (!h || !Object.keys(h).length) return true;

  const agora = new Date();
  const dias = ['dom','seg','ter','qua','qui','sex','sab'];
  const idxHoje = agora.getDay();
  const minutoAtual = agora.getHours() * 60 + agora.getMinutes();

  return _horarioAbertoNoMinuto(h[dias[idxHoje]], minutoAtual, false)
      || _horarioAbertoNoMinuto(h[dias[(idxHoje + 6) % 7]], minutoAtual, true);
}

let _cachedHorarios = null;
let _cachedStoreOpen = undefined;

// ── Próximo horário de abertura (usado no modal de loja fechada) ──
// Varre hoje + próximos 7 dias procurando a primeira janela que ainda vai
// abrir. Retorna { data: Date, label: 'hoje às 18:00' | 'amanhã às 08:00' |
// 'segunda às 08:00' } ou null se não achar nada configurado (nesse caso o
// modal só fala "fechada no momento", sem prometer um horário).
function _calcularProximaAbertura() {
  const h = _cachedHorarios;
  if (!h || !Object.keys(h).length) return null;
  const dias = ['dom','seg','ter','qua','qui','sex','sab'];
  const nomesDia = { dom:'domingo', seg:'segunda', ter:'terça', qua:'quarta', qui:'quinta', sex:'sexta', sab:'sábado' };
  const agora = new Date();
  const minutoAtual = agora.getHours() * 60 + agora.getMinutes();

  for (let offset = 0; offset <= 7; offset++) {
    const idxDia = (agora.getDay() + offset) % 7;
    const cfgDia = h[dias[idxDia]];
    if (!_horarioAtivo(cfgDia)) continue;
    const janelas = _cpJanelasDia(cfgDia).slice().sort((a, b) => (_horaParaMinutos(a.abertura) ?? 0) - (_horaParaMinutos(b.abertura) ?? 0));
    for (const j of janelas) {
      const aberturaMin = _horaParaMinutos(j.abertura);
      if (aberturaMin === null) continue;
      // No dia de hoje (offset 0), só conta se a abertura ainda não passou
      if (offset === 0 && aberturaMin <= minutoAtual) continue;
      const data = new Date(agora);
      data.setDate(data.getDate() + offset);
      data.setHours(Math.floor(aberturaMin / 60), aberturaMin % 60, 0, 0);
      const horaTxt = String(Math.floor(aberturaMin / 60)).padStart(2, '0') + ':' + String(aberturaMin % 60).padStart(2, '0');
      let label;
      if (offset === 0) label = `hoje às ${horaTxt}`;
      else if (offset === 1) label = `amanhã às ${horaTxt}`;
      else label = `${nomesDia[dias[idxDia]]} às ${horaTxt}`;
      return { data, label };
    }
  }
  return null;
}

// ── Modal "loja fechada / agendar pedido" ──────────────────────────────
function abrirModalAgendamento() {
  const ov = document.getElementById('agendamento-overlay');
  if (!ov) return;
  const proxima = _calcularProximaAbertura();
  const txtEl = document.getElementById('agnd-proxima-abertura');
  if (txtEl) {
    txtEl.textContent = proxima
      ? `Abrimos ${proxima.label}.`
      : 'Ainda não temos um horário certo pra reabrir — mas você já pode deixar seu pedido garantido.';
  }
  ov.style.display = 'flex';
}

function fecharModalAgendamento() {
  const ov = document.getElementById('agendamento-overlay');
  if (ov) ov.style.display = 'none';
}

function confirmarAgendamento() {
  const proxima = _calcularProximaAbertura();
  _pedidoAgendadoPara = proxima ? proxima.data : new Date();
  fecharModalAgendamento();
  applyStatus(); // recalcula o botão de confirmar com _pedidoAgendadoPara já setado
  try {
    const proxTxt = proxima ? proxima.label : 'assim que abrirmos';
    if (typeof toast === 'function') toast('ok', `Combinado! Monte seu pedido — vamos prepará-lo para ${proxTxt}.`);
  } catch(e) {}
}

// ── Modal info da loja ────────────────────────────────
function openStoreInfoModal() {
  const ov = document.getElementById('store-info-overlay');
  if (!ov) return;

  // Nome e descrição
  document.getElementById('sinfo-name').textContent = document.getElementById('hero-name')?.textContent || '';
  document.getElementById('sinfo-desc').textContent = document.getElementById('hero-desc')?.textContent || '';

  // Endereço
  const addrRow = document.getElementById('sinfo-addr-row');
  if (_storeAddress) {
    document.getElementById('sinfo-addr').textContent = _storeAddress;
    addrRow.style.display = 'flex';
  } else {
    addrRow.style.display = 'none';
  }

  // Tempo de entrega
  const tempoTxt = document.getElementById('hero-tempo')?.textContent || '';
  const tempoRow = document.getElementById('sinfo-tempo-row');
  if (tempoTxt) {
    document.getElementById('sinfo-tempo').textContent = tempoTxt;
    tempoRow.style.display = 'flex';
  } else {
    tempoRow.style.display = 'none';
  }

  // Horários
  const diasNome = { dom:'Domingo', seg:'Segunda-feira', ter:'Terça-feira', qua:'Quarta-feira', qui:'Quinta-feira', sex:'Sexta-feira', sab:'Sábado' };
  const ordem    = ['seg','ter','qua','qui','sex','sab','dom'];
  const hoje     = ['dom','seg','ter','qua','qui','sex','sab'][new Date().getDay()];
  const h        = _cachedHorarios || {};

  const rows = ordem.map(d => {
    const cfg    = h[d] || {};
    const isHoje = d === hoje;
    const aberto = _horarioAtivo(cfg);
    const janelas = _cpJanelasDia(cfg);
    const horarioTxt = janelas.length
      ? janelas.map(j => `${j.abertura||'?'} – ${j.fechamento||'?'}`).join(', ')
      : '?';
    const badge  = isHoje ? `<span style="font-size:10px;background:#f97316;color:#fff;border-radius:4px;padding:1px 6px;margin-left:6px;font-weight:800">hoje</span>` : '';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-radius:10px;background:${isHoje?'rgba(var(--accent-rgb,249,115,22),.07)':'#f8f9fb'};border:1.5px solid ${isHoje?'rgba(var(--accent-rgb,249,115,22),.2)':'transparent'}">
      <span style="font-size:13px;font-weight:${isHoje?'700':'500'};color:${isHoje?'#f97316':'#374151'};display:flex;align-items:center">${diasNome[d]}${badge}</span>
      <span style="font-size:13px;font-weight:600;color:${aberto?'#374151':'#9ca3af'}">${aberto ? horarioTxt : 'Fechado'}</span>
    </div>`;
  }).join('');

  document.getElementById('sinfo-horarios').innerHTML = rows || '<div style="font-size:13px;color:#9ca3af;padding:8px 0">Horários não cadastrados</div>';
  ov.style.display = 'flex';
}

function closeStoreInfoModal() {
  const ov = document.getElementById('store-info-overlay');
  if (ov) ov.style.display = 'none';
}

// ── Scroll spy: sincroniza aba ativa ao rolar ─────────
let _scrollSpyActive = false;
function initScrollSpy() {
  if (_scrollSpyActive) return; // só registra uma vez
  _scrollSpyActive = true;

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const stickyH = (document.querySelector('.sticky-bar')?.offsetHeight || 56) + 8;
      const sections = document.querySelectorAll('#menu-wrap .section[data-cat]');
      let current = '';
      sections.forEach(s => {
        if (s.getBoundingClientRect().top <= stickyH) current = s.dataset.cat;
      });
      document.querySelectorAll('.cat-btn').forEach(b => {
        const isOn = b.dataset.key === current;
        if (isOn !== b.classList.contains('on')) {
          b.classList.toggle('on', isOn);
          if (isOn) b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        }
      });
      ticking = false;
    });
  }, { passive: true });
}

function applyStatus(store_open, horarios) {
  if (horarios !== undefined) _cachedHorarios = _parseHorariosConfig(horarios);
  if (store_open !== undefined) _cachedStoreOpen = store_open;
  _lojaAberta = isLojaAberta(_cachedHorarios, _cachedStoreOpen);
  const dot  = document.getElementById('status-dot');
  const txt  = document.getElementById('status-txt');
  const badge= document.getElementById('status-badge');
  const ban  = document.getElementById('closed-banner');
  const btn  = document.getElementById('confirm-btn');
  if (dot)  dot.style.background = _lojaAberta ? 'var(--green)' : 'var(--red)';
  if (badge) badge.classList.toggle('closed', !_lojaAberta);
  if (txt) {
    txt.textContent = _lojaAberta ? 'Aberto' : 'Fechado';
    txt.className = 'hero-meta-status ' + (_lojaAberta ? 'open' : 'closed');
  }
  if (ban) ban.style.display = (_lojaAberta || _segmento === 'acougue') ? 'none' : 'flex';
  // Versão maior do banner de fechada (só aparece no visual do açougue,
  // controlado via CSS — aqui só liga/desliga a classe).
  const banLg = document.getElementById('closed-banner-lg');
  if (banLg) banLg.classList.toggle('show', !_lojaAberta);
  // Atualiza botão de status do novo layout
  const statusBtn = document.getElementById('hero-status-btn');
  const statusBtnTxt = document.getElementById('hero-status-btn-txt');
  if (statusBtn && statusBtnTxt) {
    if (_lojaAberta) {
      statusBtn.className = 'hero-status-btn';
      statusBtnTxt.textContent = 'Loja aberta — faça seu pedido!';
    } else {
      statusBtn.className = 'hero-status-btn closed-btn';
      statusBtnTxt.textContent = 'Loja fechada, deixe seu pedido agendado';
    }
  }
  if (btn) {
    // typeof-guard: se por acaso o cardapio-state.js estiver desatualizado
    // (arquivo antigo, sem essa variável ainda), acessar direto quebraria
    // TODO o carregamento do cardápio bem aqui — só quando a loja está
    // fechada (loja aberta nem chega a avaliar isso, por causa do &&).
    const _pedidoAgendadoSeguro = (typeof _pedidoAgendadoPara !== 'undefined') ? _pedidoAgendadoPara : null;
    const podeAgendado = !_lojaAberta && _pedidoAgendadoSeguro;
    btn.disabled = (!_lojaAberta && !podeAgendado) || cart.length === 0;
    if (!_lojaAberta && !podeAgendado) btn.innerHTML = '<span style="color:var(--red);font-size:10px">●</span> Loja fechada';
    else if (cart.length === 0) btn.innerHTML = podeAgendado ? 'Adicione itens para agendar' : 'Adicione itens ao carrinho';
    else if (podeAgendado) btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 4v4l2.5 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.6"/></svg> Confirmar Pedido Agendado';
    else btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg> Confirmar Pedido';
  }
  // Modal "loja fechada, quer agendar?" — mostra 1x por sessão quando a
  // loja está fechada e o gestor não desligou o recurso de agendamento.
  // Mesma blindagem: se _permitirAgendamento/_agendamentoModalMostrado não
  // existirem (arquivo desatualizado), trata como recurso desligado em vez
  // de travar o carregamento inteiro do cardápio.
  const _permitirAgendamentoSeguro = (typeof _permitirAgendamento !== 'undefined') ? _permitirAgendamento : false;
  const _modalJaMostradoSeguro = (typeof _agendamentoModalMostrado !== 'undefined') ? _agendamentoModalMostrado : true;
  if (!_lojaAberta && _permitirAgendamentoSeguro && !_modalJaMostradoSeguro) {
    try { _agendamentoModalMostrado = true; } catch(e) {}
    setTimeout(() => { if (typeof abrirModalAgendamento === 'function') abrirModalAgendamento(); }, 600);
  }
}

// ══════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════
async function init() {
  clearSearchInput(); // Limpa antes de qualquer coisa
  document.getElementById('menu-wrap').innerHTML =
    '<div style="padding:60px 0;text-align:center"><div style="font-size:32px">⏳</div></div>';
  try {
    const info = await resolveTenant();
    if (!info) {
      document.getElementById('hero-name').textContent = 'Restaurante não encontrado';
      document.getElementById('menu-wrap').innerHTML =
        '<div class="empty-state"><div class="empty-state-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="1.8"/><path d="M10 16c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M10 19h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></div><div class="empty-state-text">Verifique o link e tente novamente.</div></div>';
      hideSplash(); return;
    }
    _tenantId = info.id;
    try {
      window._tenantId = _tenantId;
      if (typeof efChatSetTenant === 'function') efChatSetTenant(_tenantId);
    } catch(e) {}
    _tenantPlano = (info.plano || 'pro').toLowerCase();
    // Sempre grava cardapio_session (chave dedicada, não conflita com gestor)
    sessionStorage.setItem('cardapio_session', JSON.stringify({ tenant_id: _tenantId, ts: Date.now() }));
    // Grava sys_session SOMENTE se não houver sessão de gestor/admin válida
    // (garante compatibilidade com versões antigas do api-client.js) — e
    // NUNCA quando este cardápio está rodando dentro do preview ao vivo
    // embutido no painel do gestor (iframe #cp-iframe em gestor.html).
    // Nesse iframe, sessionStorage é COMPARTILHADO com a aba do gestor
    // (mesma origem) — escrever aqui arriscava sobrescrever a sessão de
    // login do próprio gestor (perdendo token/nome/role) toda vez que o
    // preview recarregava, por exemplo depois de qualquer edição no
    // cardápio público. Isso derrubava o gestor silenciosamente (401 nas
    // chamadas seguintes) até ele sair e entrar de novo.
    const _dentroDeIframe = (function () {
      try { return window.self !== window.top; } catch (e) { return true; } // acesso bloqueado = trata como iframe, por segurança
    })();
    if (!_dentroDeIframe) {
      try {
        const _ex = JSON.parse(sessionStorage.getItem('sys_session') || 'null');
        if (!_ex || !(_ex.nome || _ex.role)) {
          sessionStorage.setItem('sys_session', JSON.stringify({ tenant_id: _tenantId, ts: Date.now() }));
        }
      } catch(e) {
        sessionStorage.setItem('sys_session', JSON.stringify({ tenant_id: _tenantId, ts: Date.now() }));
      }
    }
    applyBranding(info.branding, info.nome);

    const [itemsR, catsR, cuponsR, cfgR, pixCfgR] = await Promise.all([
      sb.from('menu_items').select('*').not('status','eq','pausado').order('sort_order', { nullsFirst: false }).order('id'),
      sb.from('categories').select('*').eq('ativo', true).order('sort_order'),
      sb.from('cupons').select('*').eq('ativo', true),
      sb.from('store_config').select('store_open,horarios_config,delivery_fee_config,store_whatsapp,order_num_offset,pedido_minimo,store_address,store_lat,store_lng,tipos_entrega,pickup_addresses,store_tempo_entrega,store_tempo_retirada,mostrar_indicacao_preparo,permitir_agendamento').single(),
      fetch('/api/pix/config', { headers: { 'x-tenant-id': _tenantId } }).then(r => r.ok ? r.json() : {}).catch(() => ({}))
    ]);

    allItems  = (itemsR.data  || []).map(x => ({
      ...x,
      id: Number(x.id),
      ingredients: (() => { try { return Array.isArray(x.ingredients) ? x.ingredients : JSON.parse(x.ingredients||'[]'); } catch(e){ return []; } })(),
      custom_groups: (() => { try { return Array.isArray(x.custom_groups) ? x.custom_groups : JSON.parse(x.custom_groups||'[]'); } catch(e){ return []; } })(),
      destaque: !!x.destaque
    }));
    allCats   = (catsR.data   || []);
    // Cupom: filtra os expirados e sem usos disponíveis no client
    // (server-side há também rechecagem no /api/cupom/validar antes de fechar pedido)
    const _agoraISO = new Date().toISOString().slice(0, 19).replace('T', ' ');
    allCupons = (cuponsR.data || []).filter(c => {
      if (!c || c.ativo === false) return false;
      // expires_at: se vazio = sem validade; se preenchido, deve ser futuro
      if (c.expires_at && String(c.expires_at).trim() && String(c.expires_at) <= _agoraISO) return false;
      // uses_left: -1 = ilimitado; 0 ou menor = esgotado; >0 = ainda disponível
      if (c.uses_left !== undefined && c.uses_left !== null && c.uses_left !== -1 && parseInt(c.uses_left) <= 0) return false;
      return true;
    });

    try {
      window._cardapioItems = allItems;
      window._cardapioCats = allCats;
      window._cardapioCupons = allCupons;
      if (typeof window.efChatRefreshNudges === 'function') window.efChatRefreshNudges();
    } catch(e) {}

    if (cfgR.data) {
      const c = cfgR.data;
      feeConfig     = c.delivery_fee_config || {};
      _pedidoMinimo = parseFloat(c.pedido_minimo) || 0;
      _storeAddress = c.store_address || '';
      _storeLat     = parseFloat(c.store_lat) || null;
      _storeLng     = parseFloat(c.store_lng) || null;
      // Seção "Não sabe qual carne escolher?" — liga/desliga pelo gestor.
      // Sem essa coluna configurada ainda (null/undefined), mantém ligada
      // por padrão pra não sumir de quem nunca mexeu nessa opção.
      _mostrarIndicacaoPreparo = c.mostrar_indicacao_preparo !== 0 && c.mostrar_indicacao_preparo !== false;
      _permitirAgendamento = c.permitir_agendamento !== 0 && c.permitir_agendamento !== false;
      // Só agora, com _permitirAgendamento já certo, aplica o status —
      // é ele quem decide se mostra o modal de loja fechada + agendamento.
      applyStatus(c.store_open, c.horarios_config);
      _tiposEntrega = Array.isArray(c.tipos_entrega) ? c.tipos_entrega : ['delivery','retirada','mesa'];
      // Múltiplos endereços de retirada
      try {
        const pa = c.pickup_addresses;
        _pickupAddresses = pa ? (Array.isArray(pa) ? pa : JSON.parse(pa)) : [];
      } catch(e) { _pickupAddresses = []; }
      // Pausa rápida de delivery/retirada — remove a(s) modalidade(s)
      // pausada(s) dos tipos disponíveis. Considera prazo (se definido) e
      // quais modalidades o gestor escolheu pausar.
      const _pausaAtiva = (modalidade) => {
        if (!feeConfig?.delivery_pausado) return false;
        const modalidades = Array.isArray(feeConfig.delivery_pausado_modalidades) && feeConfig.delivery_pausado_modalidades.length
          ? feeConfig.delivery_pausado_modalidades : ['delivery'];
        if (!modalidades.includes(modalidade)) return false;
        if (feeConfig.delivery_pausado_ate) {
          const expira = new Date(feeConfig.delivery_pausado_ate);
          if (!isNaN(expira) && expira <= new Date()) return false;
        }
        return true;
      };
      const _pausaDelivery = _pausaAtiva('delivery');
      const _pausaRetirada = _pausaAtiva('retirada');
      if (_pausaDelivery) _tiposEntrega = _tiposEntrega.filter(t => t !== 'delivery');
      if (_pausaRetirada) _tiposEntrega = _tiposEntrega.filter(t => t !== 'retirada');

      if (_pausaDelivery || _pausaRetirada) {
        const nomesPausados = [_pausaDelivery ? 'delivery' : null, _pausaRetirada ? 'retirada' : null].filter(Boolean).join(' e ');
        const mensagemPausa = `⏸ ${nomesPausados.charAt(0).toUpperCase() + nomesPausados.slice(1)} temporariamente pausado${_pausaDelivery && _pausaRetirada ? 's' : ''} no momento.`;

        // Aviso fixo no topo (sempre visível enquanto navega o cardápio)
        try {
          const banner = document.getElementById('delivery-pausado-banner');
          if (!banner) {
            const div = document.createElement('div');
            div.id = 'delivery-pausado-banner';
            div.style.cssText = 'position:sticky;top:0;z-index:90;background:rgba(245,158,11,.95);color:#fff;text-align:center;padding:8px 12px;font-size:12.5px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.15)';
            div.textContent = mensagemPausa;
            document.body.insertBefore(div, document.body.firstChild);
          } else {
            banner.textContent = mensagemPausa;
            banner.style.display = '';
          }
        } catch (e) {}

        // Popup uma vez por visita — reforça o aviso pra quem abre o
        // cardápio direto num item (link compartilhado), sem passar pela
        // tela inicial onde o banner já chama atenção.
        try {
          const _chaveSessao = 'pausaPopupMostrado_' + (feeConfig.delivery_pausado_ate || 'indef');
          if (!sessionStorage.getItem(_chaveSessao) && !document.getElementById('delivery-pausado-popup')) {
            const overlay = document.createElement('div');
            overlay.id = 'delivery-pausado-popup';
            overlay.style.cssText = 'position:fixed;inset:0;z-index:9990;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.55);backdrop-filter:blur(3px)';
            overlay.innerHTML = `
              <div style="max-width:340px;width:100%;background:#fff;border-radius:18px;padding:26px 22px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.3)">
                <div style="font-size:38px;margin-bottom:10px">⏸️</div>
                <div style="font-size:16px;font-weight:800;color:#1f2937;margin-bottom:8px">Atenção</div>
                <div style="font-size:13.5px;color:#4b5563;line-height:1.5;margin-bottom:20px">${mensagemPausa}</div>
                <button onclick="document.getElementById('delivery-pausado-popup')?.remove()" style="width:100%;padding:12px;border:none;border-radius:12px;background:#111827;color:#fff;font-weight:700;font-size:14px;cursor:pointer">Entendi</button>
              </div>`;
            document.body.appendChild(overlay);
            overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
            sessionStorage.setItem(_chaveSessao, '1');
          }
        } catch (e) {}
      } else {
        const banner = document.getElementById('delivery-pausado-banner');
        if (banner) banner.style.display = 'none';
      }
      try {
        const segR = await fetch('/api/tenant-segmento', { headers: { 'x-tenant-id': _tenantId } });
        if (segR.ok) {
          const segD = await segR.json();
          if (segD.segmento === 'acougue') {
            _segmento = 'acougue';
            _tiposEntrega = _tiposEntrega.filter(t => t !== 'mesa');
            document.body.setAttribute('data-segmento','acougue');
            // applyStatus já rodou antes do segmento ser conhecido (linha acima),
            // então o banner "Esta loja está fechada..." pode ter ficado visível
            // por engano no açougue (que já mostra o status no cartão da loja).
            // Reaplica agora que _segmento está definido, sem refazer a request.
            applyStatus();
          }
        }
      } catch(e) {}
      // Sincroniza offset de numeração com o gestor
      _orderNumOffset = parseInt(c.order_num_offset) || 0;
      // Fallback: se não veio pelo branding, pega do store_config direto
      if (!_waNumero && c.store_whatsapp) {
        _waNumero = c.store_whatsapp.replace(/\D/g, '');
        if (_waNumero.length <= 11) _waNumero = '55' + _waNumero;
      }
    }

    // _pixAtivoGestor decide se o fluxo tenta gerar QR online (vs cair pro PIX
    // manual). Cai pro "MP configurado" (tenant OU global) SÓ quando o gestor
    // nunca mexeu no toggle (pix_ativo_definido === false) — ou seja, nunca
    // escolheu explicitamente "Manual". Se ele escolheu Manual de propósito
    // (pix_ativo === false, salvo por togglePixOnline), isso é respeitado
    // sempre, mesmo com uma conta MP global disponível na plataforma.
    _aplicarPixCfg(pixCfgR);

    // Cartão online (cartao_mp) bloqueado no cardápio — fica só cartão na entrega.
    // (bloco de ativação do cartão online desabilitado propositalmente)

    buildCats();
    buildCategoriaShowcase();
    renderPreparoFilterSection();
    renderMenu();
    subscribeRealtime();
    loadCustomerSession();
    if (typeof loadFavoritos === 'function') loadFavoritos();
    if (typeof loadRepeatOrderBanner === 'function') loadRepeatOrderBanner();
    setupPlanFeatures();
    applyTiposEntrega();
    applyDeliveryInfo();
    if (typeof restoreCartDraft === 'function') restoreCartDraft();
    setInterval(() => applyStatus(undefined, undefined), 60000);
    // ── Polling de adicionais esgotados (defesa contra realtime indisponível) ──
    // A cada 30s recarrega a lista. Se mudou e o modal está aberto, re-renderiza.
    setInterval(async () => {
      try {
        const before = JSON.stringify([..._addonsEsgotadosSet].sort());
        await loadAddonsEsgotados();
        const after = JSON.stringify([..._addonsEsgotadosSet].sort());
        if (before === after) return; // sem mudança, nada a fazer
        const modal = document.getElementById('item-modal-bg');
        if (modal && modal.classList.contains('on') && _imItemId != null) {
          const item = allItems.find(x => x.id === _imItemId);
          if (item && typeof _renderImGruposNow === 'function') _renderImGruposNow(item);
        }
      } catch(e) {}
    }, 30000);
  } catch(e) {
    console.error(e);
    document.getElementById('menu-wrap').innerHTML =
      '<div class="empty-state"><div class="empty-state-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M16 4L2 28h28L16 4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 14v6M16 23v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div><div class="empty-state-text">Erro ao carregar o cardápio.</div></div>';
  }
  hideSplash();
}

function hideSplash() {
  setTimeout(() => document.getElementById('splash').classList.add('out'), 300);
}

// Limpa campo de busca — o Chrome ignora autocomplete="off" e preenche com dados salvos
// Esta função garante que o campo sempre inicie vazio
function clearSearchInput() {
  const el = document.getElementById('search-input');
  if (!el) return;
  el.value = '';
  el.setAttribute('readonly', '');
  // Remove readonly após um tick para permitir digitação normal
  requestAnimationFrame(() => {
    setTimeout(() => el.removeAttribute('readonly'), 200);
  });
}

// ══════════════════════════════════════════
//  PLAN FEATURES
// ══════════════════════════════════════════
function setupPlanFeatures() {
  // Botão rastrear em tempo real — sempre visível
  const tBtn = document.getElementById('success-tracker-btn');
  if (tBtn) tBtn.style.display = '';
}

// ══════════════════════════════════════════
//  REALTIME
// ══════════════════════════════════════════
// ── Aplica a config de PIX (chamada no load inicial e no resync em tempo real) ──
function _aplicarPixCfg(pixCfgR) {
  // Se já existe chave PIX manual salva e o gestor nunca ligou o online
  // de propósito (pix_ativo_gestor !== true), respeita a chave manual —
  // mesmo com MP configurado (conta global/tenant). Sem essa checagem,
  // tenant que configurou a chave manual mas nunca clicou no toggle
  // "Online"/"Manual" caía no fallback abaixo e gerava QR online mesmo assim.
  const _temChaveManual = !!(pixCfgR.pix_key_manual && String(pixCfgR.pix_key_manual).trim());
  _pixAtivoGestor    = pixCfgR.pix_ativo_gestor === true
                     || (pixCfgR.pix_ativo_definido !== true && pixCfgR.mp_configurado === true && !_temChaveManual);
  _pixKeyManual      = pixCfgR.pix_key_manual      || '';
  _pixKeyManualTipo  = pixCfgR.pix_key_manual_tipo  || 'aleatoria';
  _pixKeyManualBanco = pixCfgR.pix_key_manual_banco || '';

  // Mostra PIX se: pix_ativo OU chave manual OU conta MP configurada (tenant/global).
  // A última condição é defesa contra estado inconsistente: se MP está configurado
  // tecnicamente o PIX online deveria funcionar, mesmo que o toggle pix_ativo
  // esteja false por algum motivo.
  const podeMostrarPix = pixCfgR.pix_ativo === true
                      || !!_pixKeyManual
                      || pixCfgR.mp_configurado === true;
  const pixBtn = document.querySelector('[data-pay="pix"]');
  if (pixBtn) pixBtn.style.display = podeMostrarPix ? '' : 'none';
}

// ── Rebusca /api/pix/config e reaplica ─────────────────────────────────
// Sem isso, um cliente com o cardápio já aberto numa aba ficava com o
// estado antigo de _pixAtivoGestor em memória: se o gestor mudasse pra
// Manual DEPOIS que o cliente abriu a página, o pedido dele ainda tentava
// gerar QR Code online da conta global, porque o front nunca recarregava
// essa config sozinho. Chamada pelo listener de realtime do store_config.
let _pixResyncEmAndamento = false;
async function _resyncPixConfig() {
  if (_pixResyncEmAndamento || !_tenantId) return;
  _pixResyncEmAndamento = true;
  try {
    const r = await fetch('/api/pix/config', { headers: { 'x-tenant-id': _tenantId } });
    if (r.ok) _aplicarPixCfg(await r.json());
  } catch (e) { console.warn('[pix] resync falhou:', e.message); }
  finally { _pixResyncEmAndamento = false; }
}

function subscribeRealtime() {
  sb.channel('menu-rt')
    .on('postgres_changes',{event:'*',table:'menu_items'},()=>reloadMenu())
    .on('postgres_changes',{event:'*',table:'categories'},()=>reloadMenu())
    .on('postgres_changes',{event:'*',table:'addons_esgotados'}, ()=>onAddonsEsgotadosChanged())
    .subscribe();
  sb.channel('store-config-rt')
    .on('postgres_changes',{event:'UPDATE',table:'store_config'}, p => {
      const cfg = p.new;
      // Status aberto/fechado
      if (cfg.permitir_agendamento !== undefined) _permitirAgendamento = cfg.permitir_agendamento !== 0 && cfg.permitir_agendamento !== false;
      applyStatus(cfg.store_open, cfg.horarios_config || _cachedHorarios);
      // Offset de numeração — atualiza imediatamente quando gestor zera a contagem
      if (cfg.order_num_offset !== undefined) {
        _orderNumOffset = parseInt(cfg.order_num_offset) || 0;
      }
      // Branding completo — atualiza logo, banner, cor, nome, etc. em tempo real
      applyBrandingLive(cfg);
      // PIX manual/online — reflete na hora qualquer mudança feita pelo gestor,
      // mesmo que o cliente já esteja com o cardápio aberto.
      _resyncPixConfig();
    })
    .subscribe();
}

// ── Reforço contra conexão SSE "morta" em segundo plano ──
// Em celular, o navegador pode suspender/matar a conexão em tempo real
// quando a tela bloqueia ou o app vai pra segundo plano, sem disparar
// nenhum erro perceptível — a aba fica "viva" mas para de receber
// atualizações (por isso mudanças no gestor às vezes não aparecem pro
// cliente que já estava com o cardápio aberto). Ao voltar a ficar visível,
// busca os dados direto do servidor, independente do estado da conexão.
let _lastFocusRefetch = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const now = Date.now();
  if (now - _lastFocusRefetch < 4000) return; // evita refetch duplicado se disparar 2x seguidas
  _lastFocusRefetch = now;
  try { if (typeof reloadMenu === 'function') reloadMenu(); } catch(e) {}
  sb.from('store_config').select('*').single().then(({ data, error }) => {
    if (!error && data) applyBrandingLive(data);
  }).catch(() => {});
});

// ── Recarrega lista de adicionais esgotados e atualiza UI em tempo real ──
// Cliente pode estar com modal aberto vendo o produto — re-renderiza grupos pra
// mostrar os adicionais como esgotados (ou disponíveis) na hora que o gestor pausa/libera.
async function onAddonsEsgotadosChanged() {
  await loadAddonsEsgotados();
  // Se o modal de produto está aberto, re-renderiza os grupos com o estado novo
  const modal = document.getElementById('item-modal-bg');
  if (modal && modal.classList.contains('on') && typeof _imItemId !== 'undefined' && _imItemId != null) {
    const item = (typeof allItems !== 'undefined' && Array.isArray(allItems))
      ? allItems.find(x => x.id === _imItemId) : null;
    // Usa _renderImGruposNow direto pra evitar refetch (acabamos de carregar)
    if (item && typeof _renderImGruposNow === 'function') {
      try { _renderImGruposNow(item); } catch(e) { console.warn('[realtime] re-render falhou:', e); }
    }
  }
}

// Aplica mudanças de branding vindas do SSE (store_config row completo)
// Diferente de applyBranding(): não recria elementos, atualiza os existentes
function applyBrandingLive(cfg) {
  if (!cfg) return;
  applyShareMeta(cfg, cfg.store_name || document.getElementById('hero-name')?.textContent || 'Cardapio');

  // Nome e descrição
  if (cfg.store_name) {
    _storeName = cfg.store_name;
    window._storeName = cfg.store_name;
    document.title = cfg.store_name;
    const el = document.getElementById('hero-name');
    if (el) el.textContent = cfg.store_name;
    try { if (typeof efChatSetStoreName === 'function') efChatSetStoreName(cfg.store_name); } catch(e) {}
  }
  if (cfg.store_descricao) {
    const el = document.getElementById('hero-desc');
    if (el) el.textContent = cfg.store_descricao;
  }

  // Tema visual — aplica paleta antes da cor de accent
  if (cfg.store_tema) {
    applyTema(cfg.store_tema, cfg.store_cor || '#f97316');
  }

  // Cor principal — atualiza CSS variable instantaneamente
  if (cfg.store_cor) {
    setAccentColor(cfg.store_cor);
  }

  // Logo circular
  if (cfg.store_logo_url) {
    const logoWrap = document.getElementById('hero-logo-wrap');
    if (logoWrap) {
      const existing = logoWrap.querySelector('img');
      if (existing) { existing.src = cfg.store_logo_url; }
      else {
        const img = document.createElement('img');
        img.src = cfg.store_logo_url;
        img.className = 'hero-logo-img';
        img.onerror = () => { logoWrap.innerHTML = '<span id="hero-emoji">🍽️</span>'; };
        logoWrap.innerHTML = '';
        logoWrap.appendChild(img);
      }
    }
    // Atualiza favicon ao mudar o logo em tempo real
    setFavicon(cfg.store_logo_url);
  }

  // Banner — aceita atualização ao vivo tanto do array novo (store_banners) quanto do legado (store_banner_url)
  if (cfg.store_banners !== undefined || cfg.store_banner_url) {
    applyHeroBanners(getBannerList(cfg));
  }

  // Tempo e avaliação
  if (cfg.store_tempo_entrega) {
    const el = document.getElementById('hero-tempo');
    if (el) { el.textContent = cfg.store_tempo_entrega; }
    const badge = document.getElementById('badge-tempo');
    if (badge) { badge.style.display = ''; }
    const sep = document.getElementById('sep-tempo');
    if (sep) sep.style.display = '';
    const trustEl = document.getElementById('trust-tempo');
    if (trustEl) trustEl.textContent = cfg.store_tempo_entrega;
  }
  if (cfg.store_avaliacao) {
    const el = document.getElementById('hero-aval');
    if (el) { el.textContent = cfg.store_avaliacao; }
    const badge = document.getElementById('badge-aval');
    if (badge) badge.style.display = '';
    const trustEl = document.getElementById('trust-aval');
    if (trustEl) trustEl.textContent = cfg.store_avaliacao;
  }

  // WhatsApp
  if (cfg.store_whatsapp) {
    _waNumero = cfg.store_whatsapp.replace(/\D/g, '');
    if (_waNumero.length <= 11) _waNumero = '55' + _waNumero;
  }

  if (cfg.promo_banner_ativo !== undefined || cfg.promo_banners !== undefined) {
    _applyPromoBanner(cfg);
  }

  // Estimativa dinâmica de tempo (ajusta conforme backlog atual)
  // Não bloqueia render — atualiza quando chegar
  fetch('/api/tempo-estimado', { headers: { 'x-tenant-id': _tenantId } })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d || !d.tempo_estimado) return;
      const el = document.getElementById('hero-tempo');
      if (el) {
        el.textContent = d.tempo_estimado;
        if (d.alta_demanda) el.title = '⚠ Alta demanda agora';
      }
      const trustEl = document.getElementById('trust-tempo');
      if (trustEl) trustEl.textContent = d.tempo_estimado;
      const badge = document.getElementById('badge-tempo');
      if (badge) badge.textContent = d.tempo_estimado;
      // Banner discreto de alta demanda
      if (d.alta_demanda) {
        let warn = document.getElementById('alta-demanda-warn');
        if (!warn) {
          warn = document.createElement('div');
          warn.id = 'alta-demanda-warn';
          warn.style.cssText = 'background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);color:#92400e;padding:6px 12px;font-size:11.5px;text-align:center;font-weight:600;border-radius:8px;margin:8px 12px';
          warn.textContent = `⚠ Alta demanda — tempo de entrega: ${d.tempo_estimado}`;
          const target = document.getElementById('hero-banner') || document.body;
          target.parentElement?.insertBefore(warn, target.nextSibling);
        }
      }
    })
    .catch(()=>{});
}

async function reloadMenu() {
  const [itemsR, catsR] = await Promise.all([
    sb.from('menu_items').select('*').not('status','eq','pausado').order('sort_order', { nullsFirst: false }).order('id'),
    sb.from('categories').select('*').eq('ativo',true).order('sort_order')
  ]);
  allItems = (itemsR.data || []).map(x => ({
    ...x,
    id: Number(x.id),
    ingredients: (() => { try { return Array.isArray(x.ingredients) ? x.ingredients : JSON.parse(x.ingredients||'[]'); } catch(e){ return []; } })(),
    custom_groups: (() => { try { return Array.isArray(x.custom_groups) ? x.custom_groups : JSON.parse(x.custom_groups||'[]'); } catch(e){ return []; } })(),
    destaque: !!x.destaque
  }));
  allCats  = (catsR.data  || []);
  try {
    window._cardapioItems = allItems;
    window._cardapioCats = allCats;
    if (typeof window.efChatRefreshNudges === 'function') window.efChatRefreshNudges();
  } catch(e) {}
  await loadAddonsEsgotados();
  buildCats();
  buildCategoriaShowcase();
  renderPreparoFilterSection();
  renderMenu();
}

// ── Adicionais globalmente esgotados ──
// Carrega a lista do tenant. Usado pra desabilitar opções no modal de produto.
async function loadAddonsEsgotados() {
  if (!_tenantId) return;
  try {
    const r = await fetch('/api/addons-esgotados', {
      headers: { 'x-tenant-id': _tenantId }
    });
    if (!r.ok) return;
    const data = await r.json();
    _addonsEsgotadosSet = new Set(data.esgotados || []);
  } catch(e) {
    console.warn('[addons-esgotados] falha ao carregar:', e?.message);
  }
}


// ══════════════════════════════════════════
//  BARRA DE NAVEGAÇÃO INFERIOR (Cardápio / Busca / Pedidos)
// ══════════════════════════════════════════
function setBnavActive(id) {
  document.querySelectorAll('.bnav-item').forEach(b => b.classList.remove('on'));
  const btn = document.getElementById(id);
  if (btn) btn.classList.add('on');
}

function toggleSearchPanel(forceOpen) {
  const panel = document.getElementById('search-panel');
  const input = document.getElementById('search-input');
  if (!panel) return;
  const willOpen = (typeof forceOpen === 'boolean') ? forceOpen : !panel.classList.contains('on');
  panel.classList.toggle('on', willOpen);
  if (willOpen) {
    setTimeout(() => input && input.focus(), 260);
  } else if (input) {
    input.value = '';
    input.blur();
    if (typeof onSearch === 'function') onSearch('');
  }
}

function bnavGoCardapio() {
  setBnavActive('bnav-cardapio');
  toggleSearchPanel(false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bnavGoBusca() {
  setBnavActive('bnav-busca');
  const sticky = document.getElementById('sticky-bar');
  toggleSearchPanel(true);
  if (sticky) sticky.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Botão "Pedidos" — mostra os pedidos/compras do cliente (Minha Conta).
// Sem conta/pedido nenhum ainda registrado neste navegador -> direciona pro cadastro.
function bnavGoPedidos() {
  setBnavActive('bnav-pedidos');
  if (typeof _customer !== 'undefined' && _customer) {
    openAccount();
  } else {
    openAuth('register');
  }
}

// Botão "Favoritos" — agora exige conta; sem login, mostra convite pra criar.
function bnavGoFavoritos() {
  setBnavActive('bnav-favoritos');
  openFavoritos();
}
function openFavoritos() {
  if (typeof renderFavoritosPage === 'function') renderFavoritosPage();
  document.getElementById('favoritos-overlay')?.classList.add('on');
}
function closeFavoritos() {
  document.getElementById('favoritos-overlay')?.classList.remove('on');
  setBnavActive('bnav-cardapio');
}

// ── Bootstrap ──
init();

// ── Garante limpeza do campo de busca (Chrome autofill) ──
document.addEventListener('DOMContentLoaded', clearSearchInput);
window.addEventListener('load', clearSearchInput);
setTimeout(clearSearchInput, 100);
setTimeout(clearSearchInput, 400);


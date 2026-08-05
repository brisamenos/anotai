// ══════════════════════════════════════════
//  UTILS — toast, fmt, rating
//  Estima Food — Cardápio
// ══════════════════════════════════════════
// ══════════════════════════════════════════
//  FIX AUTOPLAY DE VÍDEO NO iOS/SAFARI
// ══════════════════════════════════════════
// No iOS, <video autoplay> inserido via innerHTML frequentemente NÃO
// começa a tocar sozinho (mesmo com muted+playsinline), sem disparar erro.
// Chamar isso logo após qualquer innerHTML que possa conter <video>.
function fixIosVideoAutoplay(container) {
  const root = container || document;
  const vids = root.querySelectorAll ? root.querySelectorAll('video[autoplay]') : [];
  vids.forEach(v => {
    try {
      v.muted = true;
      v.defaultMuted = true;
      v.playsInline = true;
      if (v.readyState === 0) { try { v.load(); } catch(e) {} }
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {}
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

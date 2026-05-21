// ══════════════════════════════════════════
//  UTILS — toast, fmt, rating
//  Estima Food — Cardápio
// ══════════════════════════════════════════
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


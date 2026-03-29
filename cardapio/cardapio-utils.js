// ══════════════════════════════════════════
//  UTILS — toast, fmt, rating
//  Estima Food — Cardápio
// ══════════════════════════════════════════
// ══════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════
function toast(icon, msg) {
  const area = document.getElementById('toast-area');
  const el   = document.createElement('div');
  el.className = 'toast';
  // Icon type from emoji → class
  const cls = icon === '✅' || icon === '🎉' ? 'ok'
            : icon === '❌' || icon === '⛔' ? 'err'
            : 'info';
  el.innerHTML = `<span class="toast-icon ${cls}">${icon}</span><span>${msg}</span>`;
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
  if (sub && orderId) sub.textContent = `Pedido #${String(_orderNum(orderId)).padStart(3,'0')} — sua opinião é muito importante!`;
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
    const { error } = await sb.from('ratings').insert({
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



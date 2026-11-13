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

// Foto reduzida do servidor (?w=): foto de celular de 4000px no tamanho
// original deixava o cardápio pesado no 4G e travava celulares mais simples.
function _fotoMini(url, w) {
  if (!url || typeof url !== 'string' || url.startsWith('data:') || url.includes('?')) return url;
  const rel = url.startsWith(location.origin + '/uploads/') ? url.slice(location.origin.length) : url;
  return rel.startsWith('/uploads/') ? rel + '?w=' + w : url;
}

// Rede de segurança: se uma foto reduzida (?w=) falhar, carrega a original.
document.addEventListener('error', function (e) {
  const t = e.target;
  if (t && t.tagName === 'IMG' && !t.dataset.o && /[?&]w=\d+$/.test(t.src)) { t.dataset.o = '1'; t.src = t.src.replace(/[?&]w=\d+$/, ''); }
}, true);

// ══════════════════════════════════════════
//  PRODUTO SEM FOTO — ícone que combina com o produto
// ══════════════════════════════════════════
// Escolhe um desenho pelo nome do produto (se não achar, pela categoria e
// depois pela descrição)
// e pinta na cor da loja. Ex.: "Coca lata" → copo, "X-Bacon" → hambúrguer,
// "Açaí 500ml" → tigela, "Quentinha G" → marmita.
const _PH_ICONES = {
  burger:  '<path d="M4 10.5C4 7 7.6 4.5 12 4.5S20 7 20 10.5Z"/><path d="M3.5 13.5c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 2.5.8 3.5.3"/><path d="M4.5 16.5h15V18a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2Z"/>',
  pizza:   '<path d="M12 21 3.5 6.5c5.1-3 11.9-3 17 0Z"/><path d="M5.2 9.4c4.3-2.2 9.3-2.2 13.6 0"/><circle cx="10" cy="11" r="1.1"/><circle cx="13.6" cy="14.6" r="1.1"/><circle cx="14.2" cy="10.4" r="1"/>',
  bebida:  '<path d="M6.5 8h11l-1.4 12a1.5 1.5 0 0 1-1.5 1.3H9.4A1.5 1.5 0 0 1 7.9 20Z"/><path d="M5.5 8h13"/><path d="m13 8 1.6-5.5 3 .6"/>',
  cerveja: '<path d="M10 2.5h4v4l1.5 3V20a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 8.5 20V9.5l1.5-3Z"/><path d="M8.5 12.5h7M8.5 17h7"/>',
  cafe:    '<path d="M4.5 9h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5Z"/><path d="M16.5 11H18a2.5 2.5 0 0 1 0 5h-1.8"/><path d="M9 3.5c-.8 1 .8 2 0 3M13 3.5c-.8 1 .8 2 0 3"/>',
  acai:    '<path d="M3.5 11h17a8.5 7.5 0 0 1-17 0Z"/><path d="M6.5 11c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M12 6c0-1.2.6-2.2 1.6-2.8"/>',
  doce:    '<path d="m8 11 4 10.5L16 11"/><path d="M7 11a5 5 0 1 1 10 0Z"/>',
  carne:   '<path d="M13.6 4.6a5.2 5.2 0 0 1 5.8 7.6c-1.5 2.3-4.6 3-6.8 2.4l-3.3 3.3a1.9 1.9 0 1 1-2.7 2.7 1.9 1.9 0 1 1-2.7-2.7 1.9 1.9 0 0 1 2.7 0l3.3-3.3c-.6-2.2.1-5.3 2.4-6.8a5.2 5.2 0 0 1 1.3-.6Z"/>',
  peixe:   '<path d="M6 12c2.5-3.5 6-5.5 9.5-5.5S21 9 22 12c-1 3-3 5.5-6.5 5.5S8.5 15.5 6 12Z"/><path d="M6 12 2.5 8.5v7Z"/><circle cx="17.5" cy="11" r=".9"/>',
  porcao:  '<path d="M6 10h12l-1.5 10.5h-9Z"/><path d="M8 10V4.5M10.5 10V3.5M13.5 10V4M16 10V5"/>',
  massa:   '<path d="M3.5 12h17a8.5 7 0 0 1-17 0Z"/><path d="M7.5 12c0-2 1-3 2-3s1.5 1.5 2.5 1.5S13.5 8 15.5 8"/><path d="m17.5 3.5-2.5 6"/>',
  sushi:   '<ellipse cx="12" cy="9" rx="7" ry="3"/><path d="M5 9v6c0 1.7 3.1 3 7 3s7-1.3 7-3V9"/><ellipse cx="12" cy="9" rx="3" ry="1.2"/>',
  salada:  '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14Z"/><path d="m5 19 8-8"/>',
  marmita: '<path d="M3.5 10h17v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/><path d="M2.5 10h19"/><path d="M5 10l1.2-3.5h11.6L19 10"/><path d="M12 13v7"/>',
  padrao:  '<path d="M3 17.5h18"/><path d="M4.5 17.5a7.5 7.5 0 0 1 15 0"/><path d="M12 8.5v-2M10.5 6.5h3"/>'
};
const _PH_REGRAS = [
  ['cerveja', /\b(cerveja|chopp?|long ?neck|heineken|skol|brahma|budweiser|stella|corona|amstel|original|itaipava)\b/],
  ['cafe',    /\b(cafe|cappuc?cino|capuccino|expresso|espresso|latte|mocha)\b/],
  ['acai',    /\b(acai|cupuacu|tigela)\b/],
  ['bebida',  /\b(refri|refrigerante|suco|agua|bebida|coca|guarana|fanta|sprite|pepsi|drink|refresco|lata|soda|cha|limonada|vitamina|energetico|h2oh?)\b/],
  ['doce',    /\b(sorvete|doce|sobremesa|bolo|torta|pudim|brigadeiro|milk ?shake|shake|picole|mousse|brownie|churros|petit|sundae|casquinha|trufa|cookie)\b/],
  ['pizza',   /\b(pizza|calzone|esfirra|esfiha|broto)\b/],
  ['burger',  /((^|[\s,(])x-[a-z]|^x [a-z]|\b(hamburg\w*|burg(er)?|smash|lanche|sanduiche|cheese|bauru|misto|hot ?dog|cachorro)\b)/],
  ['sushi',   /\b(sushi|temaki|sashimi|uramaki|hot ?roll|niguiri|japon\w*|poke|yakisoba)\b/],
  ['massa',   /\b(macarr\w*|massa|lasanha|espaguete|talharim|nhoque|penne|parafuso|fettuccine)\b/],
  ['marmita', /\b(quentinha|marmita|marmitex|prato feito|pf|refeic\w*|executivo|almoco|jantar|self.?service|buffet|kg)\b/],
  ['peixe',   /\b(peixe|tilapia|salmao|bacalhau|camarao|frutos do mar|pescada|merluza|atum|moqueca|caranguejo|siri|lula|polvo)\b/],
  ['carne',   /\b(carne|churrasco|picanha|costela|frango|espet\w*|assad\w*|linguica|alcatra|file|maminha|cupim|fraldinha|bife|galeto|asinha|coxa|pernil|lombo|bisteca)\b/],
  ['porcao',  /\b(batata|porc\w*|fritas|petisco|mandioca|aipim|onion|nuggets|pastel|coxinha|salgad\w*|tira.?gosto|calabresa)\b/],
  ['salada',  /\b(salada|fit|veg\w*|verde|natural|wrap)\b/]
];
function _phNorm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function _iconeProdutoTipo(item) {
  const nome = _phNorm(item && item.name);
  const cat  = _phNorm(item && (item.cat || item.cat_key));
  const desc = _phNorm(item && item.description);
  for (const fonte of [nome, cat, desc]) {
    if (!fonte) continue;
    // Vale a palavra que aparece primeiro no texto ("X-Salada, batata e
    // refrigerante" → hambúrguer, não bebida)
    let melhor = null, pos = Infinity;
    for (const [tipo, re] of _PH_REGRAS) {
      const m = fonte.match(re);
      if (m && m.index < pos) { melhor = tipo; pos = m.index; }
    }
    if (melhor) return melhor;
  }
  return 'padrao';
}
// HTML do "selo" que entra no lugar da foto
function _placeholderProduto(item) {
  const tipo = _iconeProdutoTipo(item);
  return `<span class="prod-ph" data-tipo="${tipo}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${_PH_ICONES[tipo]}</svg></span>`;
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

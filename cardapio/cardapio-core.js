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
  const slug = p.get('slug') || p.get('t');
  const tid  = p.get('tenant');
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
    mercado_azul:'#f3f8ff', premium_clean:'#f7f7f5', noite_delivery:'#0e1118'
  };
  if (metaTheme) metaTheme.content = bgMap[t] || '#f8f9fb';
}

function applyBranding(b, nome) {
  const n = b?.store_name || nome || 'Cardápio';
  document.title = n;
  applyShareMeta(b, n);
  document.getElementById('hero-name').textContent = n;
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

  // Banner — aparece abaixo das categorias com animação de boneco puxando
  if (b?.store_banner_url) {
    const url = (b.store_banner_url.startsWith('http') || b.store_banner_url.startsWith('data:')) ? b.store_banner_url : location.origin + b.store_banner_url;
    const bannerBelow = document.getElementById('store-banner-below');
    const bannerImg   = document.getElementById('store-banner-img');
    if (bannerBelow && bannerImg) {
      bannerImg.src = url;
      bannerImg.loading = 'lazy';
      bannerImg.decoding = 'async';
      bannerImg.onerror = () => { bannerBelow.classList.remove('show'); };
      bannerBelow.classList.add('show');
      // Após 5.5s (animação completa), remove máscara e boneco
      setTimeout(() => {
        const mask = document.getElementById('banner-reveal-mask');
        const dude = document.getElementById('banner-dude');
        if (mask) mask.style.display = 'none';
        if (dude) dude.style.display = 'none';
      }, 5500);
    }
  }

  // Tempo de entrega
  if (b?.store_tempo_entrega) {
    const el = document.getElementById('hero-tempo');
    if (el) el.textContent = b.store_tempo_entrega;
    const badge = document.getElementById('badge-tempo');
    if (badge) { badge.style.display = ''; }
    const sep = document.getElementById('sep-tempo');
    if (sep) sep.style.display = '';
  }

  // Avaliação
  if (b?.store_avaliacao) {
    const el = document.getElementById('hero-aval');
    if (el) el.textContent = b.store_avaliacao;
    const badge = document.getElementById('badge-aval');
    if (badge) badge.style.display = '';
    const sep = document.getElementById('sep-aval');
    if (sep) sep.style.display = '';
  }

  // WhatsApp
  if (b?.store_whatsapp) {
    _waNumero = b.store_whatsapp.replace(/\D/g, '');
    if (_waNumero.length <= 11) _waNumero = '55' + _waNumero;
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

function _horarioAbertoNoMinuto(cfg, minutoAtual, usandoDiaAnterior) {
  if (!_horarioAtivo(cfg)) return false;
  const abertura = _horaParaMinutos(cfg.abertura) ?? 0;
  const fechamento = _horaParaMinutos(cfg.fechamento) ?? 1439;
  if (abertura === fechamento) return true;

  if (fechamento > abertura) {
    return !usandoDiaAnterior && minutoAtual >= abertura && minutoAtual < fechamento;
  }

  return usandoDiaAnterior ? minutoAtual < fechamento : minutoAtual >= abertura;
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
    const badge  = isHoje ? `<span style="font-size:10px;background:#f97316;color:#fff;border-radius:4px;padding:1px 6px;margin-left:6px;font-weight:800">hoje</span>` : '';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-radius:10px;background:${isHoje?'rgba(var(--accent-rgb,249,115,22),.07)':'#f8f9fb'};border:1.5px solid ${isHoje?'rgba(var(--accent-rgb,249,115,22),.2)':'transparent'}">
      <span style="font-size:13px;font-weight:${isHoje?'700':'500'};color:${isHoje?'#f97316':'#374151'};display:flex;align-items:center">${diasNome[d]}${badge}</span>
      <span style="font-size:13px;font-weight:600;color:${aberto?'#374151':'#9ca3af'}">${aberto ? `${cfg.abertura||'?'} – ${cfg.fechamento||'?'}` : 'Fechado'}</span>
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
  if (ban) ban.style.display = _lojaAberta ? 'none' : 'flex';
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
    btn.disabled = !_lojaAberta || cart.length === 0;
    if (!_lojaAberta) btn.innerHTML = '<span style="color:var(--red);font-size:10px">●</span> Loja fechada';
    else if (cart.length > 0) btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg> Confirmar Pedido';
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
    _tenantPlano = (info.plano || 'pro').toLowerCase();
    // Sempre grava cardapio_session (chave dedicada, não conflita com gestor)
    sessionStorage.setItem('cardapio_session', JSON.stringify({ tenant_id: _tenantId, ts: Date.now() }));
    // Grava sys_session SOMENTE se não houver sessão de gestor/admin válida
    // (garante compatibilidade com versões antigas do api-client.js)
    try {
      const _ex = JSON.parse(sessionStorage.getItem('sys_session') || 'null');
      if (!_ex || !(_ex.nome || _ex.role)) {
        sessionStorage.setItem('sys_session', JSON.stringify({ tenant_id: _tenantId, ts: Date.now() }));
      }
    } catch(e) {
      sessionStorage.setItem('sys_session', JSON.stringify({ tenant_id: _tenantId, ts: Date.now() }));
    }
    applyBranding(info.branding, info.nome);

    const [itemsR, catsR, cuponsR, cfgR, pixCfgR] = await Promise.all([
      sb.from('menu_items').select('*').not('status','eq','pausado').order('sort_order', { nullsFirst: false }).order('id'),
      sb.from('categories').select('*').eq('ativo', true).order('sort_order'),
      sb.from('cupons').select('*').eq('ativo', true),
      sb.from('store_config').select('store_open,horarios_config,delivery_fee_config,store_whatsapp,order_num_offset,pedido_minimo,store_address,store_lat,store_lng,tipos_entrega,pickup_addresses,store_tempo_entrega,store_tempo_retirada').single(),
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

    if (cfgR.data) {
      const c = cfgR.data;
      applyStatus(c.store_open, c.horarios_config);
      feeConfig     = c.delivery_fee_config || {};
      _pedidoMinimo = parseFloat(c.pedido_minimo) || 0;
      _storeAddress = c.store_address || '';
      _storeLat     = parseFloat(c.store_lat) || null;
      _storeLng     = parseFloat(c.store_lng) || null;
      _tiposEntrega = Array.isArray(c.tipos_entrega) ? c.tipos_entrega : ['delivery','retirada','mesa'];
      // Múltiplos endereços de retirada
      try {
        const pa = c.pickup_addresses;
        _pickupAddresses = pa ? (Array.isArray(pa) ? pa : JSON.parse(pa)) : [];
      } catch(e) { _pickupAddresses = []; }
      // Pausa rápida de delivery — remove delivery dos tipos disponíveis
      if (feeConfig?.delivery_pausado) {
        _tiposEntrega = _tiposEntrega.filter(t => t !== 'delivery');
        // Mostra aviso visível no topo do cardápio
        try {
          const banner = document.getElementById('delivery-pausado-banner');
          if (!banner) {
            const div = document.createElement('div');
            div.id = 'delivery-pausado-banner';
            div.style.cssText = 'position:sticky;top:0;z-index:90;background:rgba(245,158,11,.95);color:#fff;text-align:center;padding:8px 12px;font-size:12.5px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.15)';
            div.innerHTML = '⏸ Delivery temporariamente pausado — apenas retirada/mesa disponíveis';
            document.body.insertBefore(div, document.body.firstChild);
          } else {
            banner.style.display = '';
          }
        } catch (e) {}
      } else {
        const banner = document.getElementById('delivery-pausado-banner');
        if (banner) banner.style.display = 'none';
      }
      try {
        const segR = await fetch('/api/tenant-segmento', { headers: { 'x-tenant-id': _tenantId } });
        if (segR.ok) { const segD = await segR.json(); if (segD.segmento === 'acougue') { _segmento = 'acougue'; _tiposEntrega = _tiposEntrega.filter(t => t !== 'mesa'); document.body.setAttribute('data-segmento','acougue'); } }
      } catch(e) {}
      // Sincroniza offset de numeração com o gestor
      _orderNumOffset = parseInt(c.order_num_offset) || 0;
      // Fallback: se não veio pelo branding, pega do store_config direto
      if (!_waNumero && c.store_whatsapp) {
        _waNumero = c.store_whatsapp.replace(/\D/g, '');
        if (_waNumero.length <= 11) _waNumero = '55' + _waNumero;
      }
    }

    _pixAtivoGestor    = pixCfgR.pix_ativo_gestor === true;
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
    if (!podeMostrarPix) {
      const pixBtn = document.querySelector('[data-pay="pix"]');
      if (pixBtn) pixBtn.style.display = 'none';
    }

    // Carrega public key e mostra Cartão MP só se disponível E ativo
    if (pixCfgR.cartao_disponivel && pixCfgR.cartao_online_ativo) {
      fetch('/api/cartao/public-key', { headers: { 'x-tenant-id': _tenantId } })
        .then(r => r.ok ? r.json() : {})
        .then(d => {
          if (d?.cartao_ativo && d?.public_key) {
            _mpPublicKey = d.public_key;
            _cartaoAtivo = true;
            const btn = document.getElementById('pay-opt-cartao-mp');
            if (btn) btn.style.display = '';
          }
        }).catch(() => {});
    }

    buildCats();
    renderPreparoFilterSection();
    renderMenu();
    subscribeRealtime();
    loadCustomerSession();
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
      applyStatus(cfg.store_open, cfg.horarios_config || _cachedHorarios);
      // Offset de numeração — atualiza imediatamente quando gestor zera a contagem
      if (cfg.order_num_offset !== undefined) {
        _orderNumOffset = parseInt(cfg.order_num_offset) || 0;
      }
      // Branding completo — atualiza logo, banner, cor, nome, etc. em tempo real
      applyBrandingLive(cfg);
    })
    .subscribe();
}

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
    document.title = cfg.store_name;
    const el = document.getElementById('hero-name');
    if (el) el.textContent = cfg.store_name;
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

  // Banner
  if (cfg.store_banner_url) {
    const bannerEl = document.getElementById('hero-banner');
    if (bannerEl) {
      const url = (cfg.store_banner_url.startsWith('http') || cfg.store_banner_url.startsWith('data:'))
        ? cfg.store_banner_url
        : location.origin + cfg.store_banner_url;
      bannerEl.innerHTML = `<img src="${url}" alt="banner" loading="lazy" decoding="async" onerror="this.parentElement.classList.remove('show');this.parentElement.style.display='none'">`;
      bannerEl.classList.add('show');
      bannerEl.style.display = 'block';
    }
  }

  // Tempo e avaliação
  if (cfg.store_tempo_entrega) {
    const el = document.getElementById('hero-tempo');
    if (el) { el.textContent = cfg.store_tempo_entrega; }
    const badge = document.getElementById('badge-tempo');
    if (badge) { badge.style.display = ''; }
    const sep = document.getElementById('sep-tempo');
    if (sep) sep.style.display = '';
  }
  if (cfg.store_avaliacao) {
    const el = document.getElementById('hero-aval');
    if (el) { el.textContent = cfg.store_avaliacao; }
    const badge = document.getElementById('badge-aval');
    if (badge) badge.style.display = '';
  }

  // WhatsApp
  if (cfg.store_whatsapp) {
    _waNumero = cfg.store_whatsapp.replace(/\D/g, '');
    if (_waNumero.length <= 11) _waNumero = '55' + _waNumero;
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
  await loadAddonsEsgotados();
  buildCats();
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


// ── Bootstrap ──
init();

// ── Garante limpeza do campo de busca (Chrome autofill) ──
document.addEventListener('DOMContentLoaded', clearSearchInput);
window.addEventListener('load', clearSearchInput);
setTimeout(clearSearchInput, 100);
setTimeout(clearSearchInput, 400);

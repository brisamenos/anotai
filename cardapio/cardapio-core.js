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
    }
  };

  const p = paletas[t] || paletas.classico;
  Object.entries(p).forEach(([k,v]) => { if(v !== '') root.style.setProperty(k, v); else root.style.removeProperty(k); });

  // Força meta theme-color
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  const bgMap = { classico:'#f8f9fb', dark:'#0f1117', tropical:'#fef9f0', minimalista:'#ffffff', acougue:'#1a0a05', verde:'#f0faf2', noturno:'#080810', rose:'#fff5f7', oceano:'#0a1628', dourado:'#0f0d08' };
  if (metaTheme) metaTheme.content = bgMap[t] || '#f8f9fb';
}

function applyBranding(b, nome) {
  const n = b?.store_name || nome || 'Cardápio';
  document.title = n;
  document.getElementById('hero-name').textContent = n;
  if (b?.store_descricao) document.getElementById('hero-desc').textContent = b.store_descricao;
  const cor = b?.store_cor || '#f97316';

  // Aplica tema ANTES da cor de accent, para a paleta correta já estar ativa
  applyTema(b?.store_tema, cor);

  document.documentElement.style.setProperty('--accent', cor);
  // Define --accent-rgb para uso em rgba()
  const _rgb = cor.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (_rgb) document.documentElement.style.setProperty('--accent-rgb', `${parseInt(_rgb[1],16)},${parseInt(_rgb[2],16)},${parseInt(_rgb[3],16)}`);

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
function isLojaAberta(horarios, store_open) {
  if (store_open === false) return false;
  if (!horarios) return store_open !== false;
  try {
    const h = typeof horarios === 'string' ? JSON.parse(horarios) : horarios;
    const dias = ['dom','seg','ter','qua','qui','sex','sab'];
    const hoje = h[dias[new Date().getDay()]];
    if (!hoje || !hoje.ativo) return false;

    const parseHora = (str) => {
      const match = (str || '').trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!match) return null;
      const h = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      if (h < 0 || h > 23 || m < 0 || m > 59) return null;
      return h * 60 + m;
    };

    const aberturaMinutos = parseHora(hoje.abertura) ?? 0;
    const fechamentoMinutos = parseHora(hoje.fechamento) ?? 1439;
    const now = new Date().getHours() * 60 + new Date().getMinutes();

    return now >= aberturaMinutos && now < fechamentoMinutos;
  } catch(e) {
    return false;
  }
}

let _cachedHorarios = null;

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
    const aberto = cfg.ativo;
    const badge  = isHoje ? `<span style="font-size:10px;background:#f97316;color:#fff;border-radius:4px;padding:1px 6px;margin-left:6px;font-weight:800">hoje</span>` : '';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-radius:10px;background:${isHoje?'rgba(249,115,22,.07)':'#f8f9fb'};border:1.5px solid ${isHoje?'rgba(249,115,22,.2)':'transparent'}">
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
  if (horarios !== undefined) _cachedHorarios = horarios;
  _lojaAberta = isLojaAberta(_cachedHorarios, store_open);
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
      sb.from('store_config').select('store_open,horarios_config,delivery_fee_config,store_whatsapp,order_num_offset,pedido_minimo,store_address,store_lat,store_lng,tipos_entrega,pickup_addresses').single(),
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
    allCupons = (cuponsR.data || []);

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
    document.documentElement.style.setProperty('--accent', cfg.store_cor);
    const _rgb2 = cfg.store_cor.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (_rgb2) document.documentElement.style.setProperty('--accent-rgb', `${parseInt(_rgb2[1],16)},${parseInt(_rgb2[2],16)},${parseInt(_rgb2[3],16)}`);
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
      bannerEl.innerHTML = `<img src="${url}" alt="banner" onerror="this.parentElement.classList.remove('show');this.parentElement.style.display='none'">`;
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

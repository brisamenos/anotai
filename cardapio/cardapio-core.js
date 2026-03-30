// ══════════════════════════════════════════
//  CORE — Tenant, branding, init, realtime, status da loja
//  Estima Food — Cardápio
// ══════════════════════════════════════════
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
      '--hero-bg':'','--hero-text':'#fff','--hero-overlay':'rgba(0,0,0,.55)',
      '--sticky-bg':'#f8f9fb'
    },
    dark: {
      '--bg':'#0f1117','--s1':'#181b24','--s2':'#1e2130','--s3':'#242840',
      '--border':'rgba(255,255,255,.07)','--border2':'rgba(255,255,255,.13)',
      '--text':'#e5e7eb','--muted':'#9ca3af','--muted2':'#6b7280','--white':'#fff',
      '--hero-bg':'#0a0c13','--hero-text':'#fff','--hero-overlay':'rgba(0,0,0,.65)',
      '--sticky-bg':'#0f1117'
    },
    tropical: {
      '--bg':'#fef9f0','--s1':'#fff7ed','--s2':'#ffedd5','--s3':'#fed7aa',
      '--border':'rgba(234,88,12,.14)','--border2':'rgba(234,88,12,.22)',
      '--text':'#431407','--muted':'#92400e','--muted2':'#b45309','--white':'#fff',
      '--hero-bg':'#431407','--hero-text':'#fff','--hero-overlay':'rgba(67,20,7,.6)',
      '--sticky-bg':'#fef9f0'
    },
    minimalista: {
      '--bg':'#ffffff','--s1':'#fafafa','--s2':'#f5f5f5','--s3':'#e5e5e5',
      '--border':'rgba(0,0,0,.06)','--border2':'rgba(0,0,0,.10)',
      '--text':'#111111','--muted':'#737373','--muted2':'#a3a3a3','--white':'#fff',
      '--hero-bg':'#111111','--hero-text':'#fff','--hero-overlay':'rgba(0,0,0,.7)',
      '--sticky-bg':'#ffffff'
    }
  };

  const p = paletas[t] || paletas.classico;
  Object.entries(p).forEach(([k,v]) => { if(v !== '') root.style.setProperty(k, v); else root.style.removeProperty(k); });

  // Força meta theme-color
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  const bgMap = { classico:'#f8f9fb', dark:'#0f1117', tropical:'#fef9f0', minimalista:'#ffffff' };
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

  // Banner
  if (b?.store_banner_url) {
    const bannerEl = document.getElementById('hero-banner');
    if (bannerEl) {
      const url = b.store_banner_url.startsWith('http') ? b.store_banner_url : location.origin + b.store_banner_url;
      bannerEl.innerHTML = `<img src="${url}" alt="banner" onerror="this.parentElement.classList.remove('show')">`;
      bannerEl.classList.add('show');
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

  // Endereço do estabelecimento — barra no hero
  if (_storeAddress) {
    const bar = document.getElementById('hero-address-bar');
    const txt = document.getElementById('hero-address-txt');
    if (bar) bar.style.display = 'flex';
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
    const now = new Date().getHours()*60 + new Date().getMinutes();
    const [ah,am] = (hoje.abertura||'00:00').split(':').map(Number);
    const [fh,fm] = (hoje.fechamento||'23:59').split(':').map(Number);
    return now >= ah*60+am && now <= fh*60+fm;
  } catch(e) { return store_open !== false; }
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
  if (ban)  ban.classList.toggle('on', !_lojaAberta);
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
      sb.from('store_config').select('store_open,horarios_config,delivery_fee_config,store_whatsapp,order_num_offset,pedido_minimo,store_address,store_lat,store_lng,tipos_entrega').single(),
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
      try {
        const segR = await fetch('/api/tenant-segmento', { headers: { 'x-tenant-id': _tenantId } });
        if (segR.ok) { const segD = await segR.json(); if (segD.segmento === 'acougue') { _segmento = 'acougue'; _tiposEntrega = _tiposEntrega.filter(t => t !== 'mesa'); } }
      } catch(e) {}
      // Sincroniza offset de numeração com o gestor
      _orderNumOffset = parseInt(c.order_num_offset) || 0;
      // Fallback: se não veio pelo branding, pega do store_config direto
      if (!_waNumero && c.store_whatsapp) {
        _waNumero = c.store_whatsapp.replace(/\D/g, '');
        if (_waNumero.length <= 11) _waNumero = '55' + _waNumero;
      }
    }

    _pixAtivoGestor    = pixCfgR.pix_ativo_gestor !== false;
    _pixKeyManual      = pixCfgR.pix_key_manual      || '';
    _pixKeyManualBanco = pixCfgR.pix_key_manual_banco || '';

    // Oculta PIX se gestor desativou pagamentos online ou PIX especificamente
    if (!pixCfgR.pix_ativo) {
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
  }

  // Banner
  if (cfg.store_banner_url) {
    const bannerEl = document.getElementById('hero-banner');
    if (bannerEl) {
      const url = cfg.store_banner_url.startsWith('http')
        ? cfg.store_banner_url
        : location.origin + cfg.store_banner_url;
      bannerEl.innerHTML = `<img src="${url}" alt="banner" onerror="this.parentElement.classList.remove('show')">`;
      bannerEl.classList.add('show');
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
  buildCats();
  renderPreparoFilterSection();
  renderMenu();
}


// ── Bootstrap ──
init();

// ── Garante limpeza do campo de busca (Chrome autofill) ──
document.addEventListener('DOMContentLoaded', clearSearchInput);
window.addEventListener('load', clearSearchInput);
setTimeout(clearSearchInput, 100);
setTimeout(clearSearchInput, 400);

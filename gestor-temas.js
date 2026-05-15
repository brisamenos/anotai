// ════════════════════════════════════════════════════════
// GESTOR TEMAS — Claro & Escuro (Anotai Design System)
// Azul #0ea5e9 como accent em ambos os modos
// ════════════════════════════════════════════════════════

const GESTOR_TEMAS = [
  {
    key: 'escuro',
    nome: 'Modo Escuro',
    desc: 'Navy premium com acentos cyan',
    emoji: '🌙',
    tipo: 'dark',
    preview: {
      bg:'#0b0e14', sidebar:'#080b11', accent:'#0ea5e9',
      card:'#12161e', cardBorder:'rgba(255,255,255,.07)',
      text:'#e2e8f0', muted:'#64748b',
      kol1:'rgba(251,191,36,.08)', kol2:'rgba(14,165,233,.08)', kol3:'rgba(52,211,153,.08)',
      kolT1:'#fbbf24', kolT2:'#7dd3fc', kolT3:'#6ee7b7'
    },
    vars: {
      '--bg':'#0b0e14',
      '--surface':'#12161e',
      '--surface2':'#1a1f2a',
      '--surface3':'#222834',
      '--border':'rgba(255,255,255,.07)',
      '--border2':'rgba(255,255,255,.14)',
      '--accent':'#0ea5e9',
      '--accent2':'#67e8f9',
      '--accent3':'#fbbf24',
      '--accent-dim':'rgba(14,165,233,.10)',
      '--accent-glow':'rgba(14,165,233,.20)',
      '--success':'#34d399',
      '--danger':'#fb7185',
      '--purple':'#a78bfa',
      '--pink':'#f0abfc',
      '--orange':'#f0a060',
      '--text':'#e2e8f0',
      '--muted':'#64748b',
      '--muted2':'#94a3b8',
      '--sidebar-bg':'#080b11',
      '--topnav-bg':'#060910',
      '--sfoot-bg':'rgba(6,9,16,.8)'
    }
  },
  {
    key: 'claro',
    nome: 'Padrão Profissional',
    desc: 'Gestor claro com azul Anotai e kanban colorido',
    emoji: '☀️',
    tipo: 'light',
    preview: {
      bg:'#eef4fa', sidebar:'#06496f', accent:'#1397e8',
      card:'#ffffff', cardBorder:'rgba(15,48,80,.12)',
      text:'#173047', muted:'#6e7f91',
      kol1:'#ff6f61', kol2:'#ffa600', kol3:'#49ad70',
      kolT1:'#ffffff', kolT2:'#ffffff', kolT3:'#ffffff'
    },
    vars: {
      '--bg':'#eef4fa',
      '--surface':'#ffffff',
      '--surface2':'#f5f9fc',
      '--surface3':'#dbe8f3',
      '--s1':'#ffffff',
      '--s2':'#f5f9fc',
      '--s3':'#eef4fa',
      '--border':'rgba(15,48,80,.12)',
      '--border2':'rgba(15,48,80,.22)',
      '--accent':'#1397e8',
      '--accent2':'#4fb8ff',
      '--accent3':'#ffc44d',
      '--accent-dim':'rgba(19,151,232,.10)',
      '--accent-glow':'rgba(19,151,232,.22)',
      '--success':'#25a85a',
      '--danger':'#f0441f',
      '--purple':'#667eea',
      '--pink':'#e65aa0',
      '--orange':'#f5a400',
      '--text':'#173047',
      '--muted':'#6e7f91',
      '--muted2':'#465b6d',
      '--sidebar-bg':'#06496f',
      '--topnav-bg':'#09588c',
      '--sfoot-bg':'rgba(3,59,91,.96)',
      '--kanban-analise':'#ff6f61',
      '--kanban-producao':'#ffa600',
      '--kanban-pronto':'#49ad70',
      '--kanban-saiu':'#2f8fb8',
      '--kanban-entregue':'#6875d9'
    }
  },
  {
    key: 'noturno',
    nome: 'Modo Noturno',
    desc: 'Charcoal elegante com bordas sutis',
    emoji: '🌙',
    tipo: 'dark',
    preview: {
      bg:'#080810', sidebar:'#04040c', accent:'#0ea5e9',
      card:'#0f0f1c', cardBorder:'rgba(255,255,255,.06)',
      text:'#eeedf6', muted:'#7878a0',
      kol1:'rgba(251,191,36,.06)', kol2:'rgba(14,165,233,.06)', kol3:'rgba(52,211,153,.06)',
      kolT1:'#fbbf24', kolT2:'#7dd3fc', kolT3:'#6ee7b7'
    },
    vars: {
      '--bg':'#080810',
      '--surface':'#0f0f1c',
      '--surface2':'#161625',
      '--surface3':'#1e1e30',
      '--border':'rgba(255,255,255,.06)',
      '--border2':'rgba(255,255,255,.10)',
      '--accent':'#0ea5e9',
      '--accent2':'#67e8f9',
      '--accent3':'#fbbf24',
      '--accent-dim':'rgba(14,165,233,.10)',
      '--accent-glow':'rgba(14,165,233,.20)',
      '--success':'#34d399',
      '--danger':'#fb7185',
      '--purple':'#a78bfa',
      '--pink':'#f0abfc',
      '--orange':'#f0a060',
      '--text':'#eeedf6',
      '--muted':'#7878a0',
      '--muted2':'#50506a',
      '--sidebar-bg':'#04040c',
      '--topnav-bg':'#020205',
      '--sfoot-bg':'rgba(2,2,5,.9)'
    }
  }
];

const GESTOR_TEMA_STORAGE_KEY = 'gestor_tema_atual';
let _gestorTemaAtual = 'claro';

function temaNormalizarKey(key) {
  const mapa = {
    'escuro':'escuro', 'dark':'escuro', 'oceano':'escuro', 'cobre':'escuro',
    'cafe':'escuro', 'lavanda':'escuro', 'cereja':'escuro', 'crepusculo':'escuro', 'esmeralda':'escuro',
    'claro':'claro', 'light':'claro', 'artico':'claro', 'classico':'claro', 'minimalista':'claro',
    'noturno':'noturno'
  };
  return mapa[key] || 'claro';
}

function temaEncontrar(key) {
  const resolved = temaNormalizarKey(key);
  return GESTOR_TEMAS.find(t => t.key === resolved) || GESTOR_TEMAS[1];
}

function temaLerCache() {
  try { return localStorage.getItem(GESTOR_TEMA_STORAGE_KEY) || ''; }
  catch(e) { return ''; }
}

function temaSalvarCache(key) {
  try { localStorage.setItem(GESTOR_TEMA_STORAGE_KEY, key); }
  catch(e) {}
}

function temaGetAtivoKey() {
  return _gestorTemaAtual
    || document.documentElement.dataset.gestorTheme
    || temaLerCache()
    || 'claro';
}

function temaSetBusy(busy) {
  document.querySelectorAll('.gt-card,.tema-mode-btn').forEach(el => {
    el.style.pointerEvents = busy ? 'none' : '';
    el.style.opacity = busy ? '.68' : '';
  });
}

function temaUpdateTopButton() {
  const btn = document.getElementById('tema-topbtn');
  if (!btn) return;
  const tema = temaEncontrar(temaGetAtivoKey());
  const isDark = tema.tipo === 'dark';
  btn.setAttribute('aria-label', isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro');
  btn.title = isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro';
  btn.innerHTML = isDark
    ? '<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3.2" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M13.2 10.3A5.5 5.5 0 0 1 5.7 2.8a5.8 5.8 0 1 0 7.5 7.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
}

function temaRenderStatusPanel() {
  const panel = document.getElementById('tema-status-panel');
  if (!panel) return;
  const ativo = temaEncontrar(temaGetAtivoKey());
  panel.innerHTML = `
    <div class="tema-status-main">
      <div>
        <div class="tema-status-kicker">Tema atual</div>
        <div class="tema-status-title">${ativo.nome}</div>
        <div class="tema-status-desc">${ativo.desc}</div>
      </div>
      <div class="tema-mode-actions" role="group" aria-label="Alternar tema do gestor">
        ${GESTOR_TEMAS.map(t => `
          <button type="button" class="tema-mode-btn ${t.key === ativo.key ? 'on' : ''}" onclick="temaAplicarModo('${t.key}')" aria-pressed="${t.key === ativo.key}">
            <span>${t.emoji}</span>
            <span>${t.tipo === 'light' ? 'Claro' : (t.key === 'noturno' ? 'Noturno' : 'Escuro')}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

// ── Aplica variáveis CSS ──
function _aplicarVars(vars) {
  const r = document.documentElement;
  Object.entries(vars).forEach(([k,v]) => r.style.setProperty(k, v));
}

// ── Override completo para tema claro ──
// Sidebar/topnav permanecem escuros, área principal fica clara
function _aplicarOverrideClaro(vars) {
  let el = document.getElementById('tema-light-override');
  if (el) el.remove();

  const text  = vars['--text'];
  const muted = vars['--muted'];
  const muted2= vars['--muted2'];
  const sur   = vars['--surface'];
  const sur2  = vars['--surface2'];
  const sur3  = vars['--surface3'];
  const bord  = vars['--border'];
  const bord2 = vars['--border2'];
  const acc   = vars['--accent'];
  const accDim= vars['--accent-dim'];
  const accGlow=vars['--accent-glow'];
  const succ  = vars['--success'];
  const dang  = vars['--danger'];

  const s = document.createElement('style');
  s.id = 'tema-light-override';
  s.textContent = `
    /* ── Base ── */
    body,.app{background:var(--bg)!important;color:${text}!important}
    .main,.page{background:var(--bg)!important;color:${text}!important}
    ::selection{background:${accDim}!important;color:${text}!important}

    /* ── Top nav — permanece escuro ── */
    .topnav{background:var(--topnav-bg)!important;border-bottom:1px solid rgba(255,255,255,.06)!important;box-shadow:0 2px 16px rgba(0,0,0,.35)!important}
    .topnav *{color:#d4d4d8!important}
    .logo,.logo *{color:#fff!important}
    .tnav-pill{color:#94a3b8!important;border-color:rgba(255,255,255,.12)!important;background:rgba(255,255,255,.05)!important}
    .tnav-pill:hover{color:#fff!important;background:rgba(255,255,255,.10)!important}
    .tnav-pill.on{background:${accDim}!important;border-color:rgba(14,165,233,.3)!important;color:#7dd3fc!important}
    .ibtn{background:rgba(255,255,255,.06)!important;border-color:rgba(255,255,255,.12)!important;color:#94a3b8!important}
    .ibtn:hover{color:#fff!important;background:rgba(255,255,255,.12)!important}
    .tbadge{background:rgba(255,255,255,.06)!important;border-color:rgba(255,255,255,.12)!important;color:#94a3b8!important}
    .nbadge{background:${acc}!important;color:#fff!important}
    .caixa-btn.fechado{background:rgba(255,255,255,.08)!important;border-color:rgba(255,255,255,.15)!important;color:#d4d4d8!important}
    .mobile-menu-btn{background:rgba(255,255,255,.08)!important;border-color:rgba(255,255,255,.15)!important;color:#d4d4d8!important}

    /* ── Sidebar — permanece escura ── */
    .sidebar{background:var(--sidebar-bg)!important;border-right:1px solid rgba(255,255,255,.05)!important;box-shadow:4px 0 24px rgba(0,0,0,.4)!important}
    .sfoot{background:var(--sfoot-bg)!important;border-top-color:rgba(255,255,255,.06)!important}
    .si{color:#71717a!important;font-weight:500!important}
    .si svg{opacity:.7!important;color:#71717a!important}
    .si:hover{background:rgba(255,255,255,.06)!important;color:#d4d4d8!important}
    .si:hover svg{opacity:1!important;color:#d4d4d8!important}
    .si.on{background:rgba(14,165,233,.15)!important;color:#7dd3fc!important;font-weight:600!important}
    .si.on svg{opacity:1!important;color:#7dd3fc!important}
    .si.on::before{background:${acc}!important;box-shadow:0 0 8px ${accGlow}!important}
    .shead{color:rgba(255,255,255,.28)!important;border-color:rgba(255,255,255,.06)!important}
    .shead:hover{background:rgba(255,255,255,.04)!important}
    .sbc{background:${acc}!important;color:#fff!important}
    .ssub{color:rgba(255,255,255,.4)!important}
    .ssub:hover{color:#d4d4d8!important}
    .urow *{color:#71717a!important}
    .urow:hover *{color:#d4d4d8!important}
    .sb-pin{background:rgba(255,255,255,.06)!important;border-color:rgba(255,255,255,.12)!important;color:#71717a!important}
    .sidebar-search > div{background:rgba(255,255,255,.05)!important;border-color:rgba(255,255,255,.1)!important}
    .sidebar-search input{color:#d4d4d8!important}
    .sidebar-search input::placeholder{color:rgba(255,255,255,.24)!important}

    /* ── Títulos & textos ── */
    .pt,.ph .pt,.ph h1,.ph h2,.card-title,.iname{color:${text}!important;font-weight:700!important}
    .ps,.ph .ps,.icat,.sl,.str{color:${muted}!important}
    .sv{color:${text}!important;font-weight:700!important}

    /* ── Cards & containers ── */
    .card,.sc,.sbox,.tw,.pm-tabs{background:${sur}!important;border-color:${bord}!important;box-shadow:0 1px 3px rgba(0,0,0,.04)!important}
    .card *,.sc *{color:${text}!important}

    /* ── Kanban — análise, produção, pronto ── */
    .kol{border-color:${bord}!important}
    .kol-analise{background:rgba(245,158,11,.04)!important;border-color:rgba(245,158,11,.12)!important}
    .kol-producao{background:rgba(14,165,233,.04)!important;border-color:rgba(14,165,233,.12)!important}
    .kol-pronto{background:rgba(16,185,129,.04)!important;border-color:rgba(16,185,129,.12)!important}
    .kol-head{background:transparent!important;border-bottom:1px solid ${bord}!important}
    .kol-analise .kol-title{color:#b45309!important}
    .kol-producao .kol-title{color:#0284c7!important}
    .kol-pronto .kol-title{color:#047857!important}
    .kol-cnt{background:rgba(0,0,0,.05)!important;color:${text}!important}
    .kol-empty,.kol-empty *{color:${muted}!important;opacity:.7!important}
    .kol-config{background:rgba(0,0,0,.02)!important;border-color:${bord}!important;color:${muted}!important}
    .kol-config strong{color:${text}!important}

    /* ── Order cards ── */
    .order-card{background:${sur}!important;border:1px solid ${bord}!important;color:${text}!important;box-shadow:0 1px 4px rgba(0,0,0,.05)!important}
    .order-card:hover{border-color:rgba(14,165,233,.3)!important;transform:translateY(-2px)!important;box-shadow:0 6px 20px rgba(14,165,233,.08),0 0 0 3px rgba(14,165,233,.05)!important}
    .order-card *{color:${text}!important}
    .oc-id{color:${acc}!important;font-weight:700!important}
    .oc-client{color:${text}!important;font-weight:600!important}
    .oc-items{color:${muted}!important}
    .oc-total{color:#047857!important;font-weight:700!important}
    .oc-time,.oc-addr{color:${muted}!important}
    .oc-btn-ok{background:rgba(16,185,129,.08)!important;color:#047857!important;border-color:rgba(16,185,129,.2)!important;font-weight:600!important}
    .oc-btn-ok:hover{background:rgba(16,185,129,.16)!important}
    .oc-btn-no{background:rgba(239,68,68,.06)!important;color:#dc2626!important;border-color:rgba(239,68,68,.18)!important;font-weight:600!important}
    .oc-btn-no:hover{background:rgba(239,68,68,.12)!important}
    .oc-btn-fin{background:rgba(14,165,233,.08)!important;color:#0284c7!important;border-color:rgba(14,165,233,.18)!important;font-weight:600!important}
    .oc-btn-fin:hover{background:rgba(14,165,233,.15)!important}

    /* ── Filtros ── */
    .kf-btn,.filter-btn{background:${sur2}!important;color:${muted}!important;border-color:${bord}!important}
    .kf-btn.on,.filter-btn.on{background:${acc}!important;color:#fff!important;border-color:${acc}!important}
    .pm-tab{color:${muted}!important}
    .pm-tab.on{background:${sur2}!important;color:${text}!important}

    /* ── Inputs, search, selects ── */
    .sbox{background:${sur}!important;border-color:${bord}!important}
    .sbox input{color:${text}!important}
    .sbox input::placeholder{color:${muted}!important}
    .sbox:focus-within{border-color:${acc}!important;box-shadow:0 0 0 3px ${accDim}!important}
    input,textarea,select,.form-input,.pinput{background:${sur}!important;color:${text}!important;border-color:${bord}!important}
    input::placeholder,textarea::placeholder{color:${muted}!important}
    .form-label{color:${muted}!important}
    .sw select{background:${sur}!important;color:${text}!important;border-color:${bord}!important}

    /* ── Buttons ── */
    .btn.bg,.bg{background:${sur2}!important;color:${text}!important;border-color:${bord}!important}
    .btn.bg:hover{background:${sur3}!important}
    .bp{background:${acc}!important;color:#fff!important;box-shadow:0 2px 10px ${accGlow}!important}
    .bp:hover{filter:brightness(1.1)!important}
    .bo{background:${accDim}!important;border-color:rgba(14,165,233,.2)!important;color:${acc}!important}
    .bo:hover{background:rgba(14,165,233,.15)!important}

    /* ── Tables ── */
    .tw table thead th{background:${sur2}!important;color:${muted}!important;border-color:${bord}!important}
    .tw table tbody tr:hover td{background:${sur2}!important}
    .tw table td{border-color:${bord}!important;color:${text}!important}
    .tmeta *{color:${text}!important}

    /* ── Modals ── */
    .modal{background:${sur}!important;color:${text}!important;border-color:${bord}!important;box-shadow:0 16px 48px rgba(0,0,0,.12)!important}
    .modal *{color:${text}!important}
    .modal-close{color:${muted}!important;background:${sur2}!important}
    .modal-bg{background:rgba(0,0,0,.25)!important}
    .modal input,.modal textarea,.modal select{background:${sur2}!important;color:${text}!important;border-color:${bord}!important}
    .modal input::placeholder,.modal textarea::placeholder{color:${muted}!important}
    .pizza-modal{background:${sur}!important;border-color:${bord}!important}
    .pizza-modal *{color:${text}!important}
    .pizza-modal input,.pizza-modal textarea,.pizza-modal select{background:${sur2}!important;color:${text}!important;border-color:${bord}!important}
    #modal-ajuste-peso-bg > div{background:${sur}!important;color:${text}!important}
    #modal-ajuste-peso-bg > div *{color:${text}!important}
    #modal-ajuste-peso-bg > div input{background:${sur2}!important;color:${text}!important}

    /* ── Toggle ── */
    .toggle{background:${sur3}!important;border-color:${bord}!important}
    .toggle.on{background:${succ}!important;border-color:${succ}!important}

    /* ── Status badges ── */
    .stbadge.sta{background:rgba(16,185,129,.08)!important;color:#047857!important}
    .stbadge.ste{background:rgba(239,68,68,.08)!important;color:#dc2626!important}
    .stbadge.stp{background:rgba(14,165,233,.08)!important;color:#0284c7!important}
    .stbadge-mini.stp{color:${acc}!important;border-color:rgba(14,165,233,.3)!important;background:rgba(14,165,233,.06)!important}

    /* ── Chips, cats, pills ── */
    .chip{background:${sur2}!important;color:${text}!important;border-color:${bord}!important}
    .cat-row{background:${sur}!important;border-color:${bord}!important}
    .cat-head *,.cat-name,.cat-item-name{color:${text}!important}
    .qpill{background:${sur2}!important;border-color:${bord}!important}
    .qpill-label{color:${muted}!important}
    .qpill-val{color:${text}!important}
    .ptag{background:${accDim}!important}
    .dp{border-color:${bord}!important;color:${muted}!important}
    .dp:hover{border-color:${acc}!important;color:${acc}!important}
    .dp.on{background:${acc}!important;border-color:${acc}!important;color:#fff!important}

    /* ── PDV ── */
    .pdv-item{background:${sur}!important;border-color:${bord}!important;color:${text}!important}
    .pdv-item *{color:${text}!important}
    .pdv-item:hover{border-color:${acc}!important;background:rgba(14,165,233,.04)!important}
    .pdv-price{color:${acc}!important}
    .qb{background:${sur2}!important;border-color:${bord}!important;color:${text}!important}
    .qb:hover{border-color:${acc}!important;color:${acc}!important}
    .cart-total-row span:last-child{color:${acc}!important}
    .pdvb-wrap,.pdvb-left{background:var(--bg)!important}
    .pdvb-right{border-left-color:${bord}!important;background:${sur}!important}
    .pdvb-toolbar,.pdvb-cats{border-bottom-color:${bord}!important;background:${sur}!important}
    .pdvb-grid-item{background:${sur}!important;border-color:${bord}!important;color:${text}!important}
    .pdvb-grid-item *{color:${text}!important}
    .pdvb-grid-item:hover,.pdvb-grid-item.focused{border-color:${acc}!important;background:rgba(14,165,233,.04)!important;box-shadow:0 6px 20px ${accGlow}!important}
    .pdvb-item-price,.pdvb-price{color:${acc}!important}
    .pdvb-cat-btn{color:${muted}!important}
    .pdvb-cat-btn.on{color:${acc}!important;border-bottom-color:${acc}!important}
    .pdvb-order-item{border-bottom-color:${bord}!important;color:${text}!important}
    .pdvb-order-item *{color:${text}!important}
    .pdvb-bar-btn{background:${sur2}!important;color:${text}!important;border-color:${bord}!important}
    .pdvb-bar-btn.primary{background:${acc}!important;border-color:transparent!important;color:#fff!important;box-shadow:0 2px 10px ${accGlow}!important}
    .pdvb-topbar{background:${sur}!important;border-bottom-color:${bord}!important;color:${text}!important}
    .pdvb-tab{color:${muted}!important}
    .pdvb-tab.on{color:${acc}!important;border-bottom-color:${acc}!important}
    .pdvb-bottom-bar{background:${sur}!important;border-top-color:${bord}!important}
    .pdvb-empty-order,.pdvb-empty-order *{color:${muted}!important}
    .pdvb-order-head{color:${muted}!important;background:${sur2}!important}
    .pdvb-tot-row{color:${text}!important}
    .pdvb-tot-row.total span:last-child{color:${acc}!important}
    .pdvb-gerar-btn{background:${acc}!important;color:#fff!important}
    .pdvb-search-wrap input{color:${text}!important}
    .pdvb-search-wrap input::placeholder{color:${muted}!important}
    .pdvb-filter-btn{color:${muted}!important;border-color:${bord}!important}
    .pdvb-filter-btn:hover{border-color:${acc}!important;color:${acc}!important}
    .pdvb-cat.on{color:${acc}!important;border-bottom-color:${acc}!important}
    .pdvb-cat:hover{color:${text}!important}
    .pdvb-input{background:${sur}!important;border-color:${bord}!important;color:${text}!important}
    .pdvb-qb{background:${sur2}!important;border-color:${bord}!important;color:${text}!important}
    .pdvb-qb:hover{border-color:${acc}!important;color:${acc}!important}
    .pdvb-oi-obs{color:${muted2}!important}

    /* ── Checkboxes ── */
    .cb{border-color:${bord2}!important;background:${sur}!important}
    .cb:checked{background:${acc}!important;border-color:${acc}!important}

    /* ── Toast & Notificações ── */
    #toast{background:${sur}!important;border-color:${bord}!important;color:${text}!important;box-shadow:0 8px 32px rgba(0,0,0,.12)!important;backdrop-filter:blur(20px)!important}
    #toast *{color:${text}!important}
    .notif-panel{background:${sur}!important;border-color:${bord}!important;box-shadow:0 8px 40px rgba(0,0,0,.12)!important;backdrop-filter:blur(20px)!important}
    .notif-panel *{color:${text}!important}
    .np-head{border-bottom-color:${bord}!important;color:${text}!important}

    /* ── Rádio / WhatsApp panel ── */
    #radio-panel-gestor{background:${sur}!important;border-color:${bord}!important;box-shadow:0 8px 40px rgba(0,0,0,.12)!important}
    #radio-panel-gestor *{color:${text}!important}

    /* ── Upgrade modal overlay ── */
    #upgrade-modal-overlay > div{background:${sur}!important;border-color:${bord}!important;box-shadow:0 16px 48px rgba(0,0,0,.12)!important}
    #upgrade-modal-overlay > div *{color:${text}!important}
    #upgrade-modal-overlay > div button{color:${text}!important}

    /* ── Auto modelos overlay ── */
    #auto-modelos-overlay > div{background:${sur}!important;border-color:${bord}!important;color:${text}!important}
    #auto-modelos-overlay > div *{color:${text}!important}
    #auto-modelos-overlay input,#auto-modelos-overlay textarea{background:${sur2}!important;color:${text}!important;border-color:${bord}!important}
    #auto-modelos-lista > div{background:${sur2}!important;border-color:${bord}!important;color:${text}!important}
    #auto-modelos-lista > div:hover{border-color:${acc}!important}

    /* ── Mobile menu (m-mais) ── */
    #m-mais{background:${sur}!important;border-color:${bord}!important}
    #m-mais *{color:${text}!important}
    #m-nav{background:${sur}!important;border-top-color:${bord}!important}
    #m-nav *{color:${muted}!important}

    /* ── Dropdowns & context menus genéricos ── */
    [style*="background:var(--surface)"][style*="z-index"]{box-shadow:0 8px 32px rgba(0,0,0,.1)!important}

    /* ── Garantia: qualquer div com bg escuro hardcoded em z alto ── */
    .modal .btn.bp,.modal button.bp{color:#fff!important}
    .modal .bp{background:${acc}!important;color:#fff!important}

    /* ── Padrão profissional: topo, sidebar e kanban ── */
    .topnav{
      background:var(--topnav-bg)!important;
      border-bottom:0!important;
      box-shadow:0 2px 12px rgba(6,58,92,.18)!important;
      color:#fff!important;
    }
    .topnav *{color:inherit!important}
    .logo,.logo *{color:#fff!important}
    .tnr .ibtn,.tbadge,.tnav-pill{
      background:#fff!important;
      border-color:rgba(255,255,255,.65)!important;
      color:#496477!important;
      box-shadow:0 1px 6px rgba(2,44,70,.12)!important;
    }
    .tnav-pill.on,
    .ibtn:hover,
    .tnr .ibtn:hover{
      background:#eef8ff!important;
      color:var(--accent)!important;
      border-color:rgba(255,255,255,.9)!important;
    }
    .caixa-btn{
      background:var(--accent)!important;
      color:#fff!important;
      border-color:transparent!important;
      box-shadow:0 6px 14px rgba(19,151,232,.22)!important;
    }
    .sidebar{
      background:linear-gradient(180deg,#075985 0%,#06496f 48%,#043b5b 100%)!important;
      border-right:0!important;
      box-shadow:6px 0 24px rgba(3,35,56,.14)!important;
    }
    .si{color:#d7edf8!important}
    .si svg{color:currentColor!important;opacity:1!important}
    .si:hover{background:rgba(255,255,255,.10)!important;color:#fff!important}
    .si.on{
      background:#0d75b1!important;
      color:#fff!important;
      box-shadow:inset 3px 0 0 #30c6ff,0 8px 18px rgba(3,41,64,.16)!important;
    }
    .shead{color:rgba(214,235,248,.72)!important}
    .sfoot{background:var(--sfoot-bg)!important;border-color:rgba(255,255,255,.12)!important}
    .main,.page,.app,body{background:var(--bg)!important;color:var(--text)!important}
    .ph{
      background:#fff!important;
      border:1px solid #d8e3ee!important;
      box-shadow:0 4px 14px rgba(15,48,80,.06)!important;
      border-radius:10px!important;
    }
    .kanban{
      gap:0!important;
      background:#fff!important;
      border:1px solid #d8e3ee!important;
      border-radius:10px!important;
      overflow:hidden!important;
      box-shadow:0 8px 24px rgba(15,48,80,.08)!important;
    }
    .kanban.kanban-4cols{grid-template-columns:repeat(4,minmax(220px,1fr))!important}
    .kol{
      border:0!important;
      border-right:1px solid rgba(255,255,255,.22)!important;
      border-radius:0!important;
      box-shadow:none!important;
    }
    .kol-analise{background:var(--kanban-analise,#ff6f61)!important}
    .kol-producao,.kol-preparando{background:var(--kanban-producao,#ffa600)!important}
    .kol-pronto,.kol-servido{background:var(--kanban-pronto,#49ad70)!important}
    .kol-saiu{background:var(--kanban-saiu,#2f8fb8)!important}
    .kol-entregue{background:var(--kanban-entregue,#6875d9)!important}
    .kol-head{
      min-height:42px!important;
      padding:0 14px!important;
      background:rgba(0,0,0,.08)!important;
      border-bottom:0!important;
      color:#fff!important;
    }
    .kol-title,
    .kol-analise .kol-title,
    .kol-producao .kol-title,
    .kol-pronto .kol-title,
    .kol-saiu .kol-title,
    .kol-entregue .kol-title{
      color:#fff!important;
      font-size:13px!important;
      font-weight:800!important;
      letter-spacing:0!important;
      text-transform:none!important;
    }
    .kol-cnt{
      background:rgba(255,255,255,.20)!important;
      color:#fff!important;
      border-radius:7px!important;
      min-width:24px!important;
      width:auto!important;
      height:22px!important;
      padding:0 7px!important;
    }
    .kol-empty,
    .kol-empty *{
      color:#fff!important;
      opacity:.92!important;
      font-weight:800!important;
      text-shadow:0 1px 2px rgba(0,0,0,.16)!important;
    }

    /* ── Scrollbar ── */
    ::-webkit-scrollbar-thumb{background:rgba(0,0,0,.12)!important;border-radius:99px!important}
    ::-webkit-scrollbar-track{background:transparent!important}
  `;
  document.head.appendChild(s);
}

// ── Override modal para temas escuros ──
function _aplicarOverrideModal(vars) {
  let el = document.getElementById('tema-modal-override');
  if (el) el.remove();
  const sur  = vars['--surface'];
  const sur2 = vars['--surface2'];
  const text = vars['--text'];
  const muted= vars['--muted'];
  const bord = vars['--border2'];
  const acc  = vars['--accent'];
  const s = document.createElement('style');
  s.id = 'tema-modal-override';
  s.textContent = `
    .modal{background:${sur}!important;border-color:${bord}!important}
    .modal *{color:${text}!important}
    .modal .modal-close{color:${muted}!important;background:${sur2}!important}
    .modal input,.modal textarea,.modal select{background:${sur2}!important;color:${text}!important;border-color:${bord}!important}
    .modal input::placeholder,.modal textarea::placeholder{color:${muted}!important}
    .modal .btn,.modal button{color:${text}!important}
    .modal a{color:${acc}!important}
    .pizza-modal{background:${sur}!important;border-color:${bord}!important}
    .pizza-modal *{color:${text}!important}
    .pizza-modal input,.pizza-modal textarea,.pizza-modal select{background:${sur2}!important;color:${text}!important;border-color:${bord}!important}
    #modal-ajuste-peso-bg > div{background:${sur}!important;color:${text}!important}
    #modal-ajuste-peso-bg > div *{color:${text}!important}
    #modal-ajuste-peso-bg > div input{background:${sur2}!important;color:${text}!important}
  `;
  document.head.appendChild(s);
}

// ── Aplica tema completo (chamado pelo gestor-core ao carregar dados) ──
function temaAplicarCompleto(key) {
  const tema = temaEncontrar(key);
  const resolved = tema.key;
  const root = document.documentElement;

  _aplicarVars(tema.vars);
  _gestorTemaAtual = resolved;
  window._gestorTemaAtual = resolved;
  root.dataset.gestorTheme = resolved;
  root.dataset.gestorThemeType = tema.tipo;
  root.style.colorScheme = tema.tipo === 'light' ? 'light' : 'dark';
  temaSalvarCache(resolved);

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = tema.vars['--topnav-bg'] || tema.vars['--bg'] || '#0b0e14';

  // Remove overrides antigos
  ['tema-light-override','tema-modal-override'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  if (tema.tipo === 'light') {
    _aplicarOverrideClaro(tema.vars);
  } else {
    _aplicarOverrideModal(tema.vars);
  }
  temaUpdateCardSelection();
  temaRenderStatusPanel();
  temaUpdateTopButton();
  return tema;
}

// ── Aplica tema + salva no banco ──
async function temaAplicarModo(key) {
  const tema = temaAplicarCompleto(key);
  temaSetBusy(true);
  try {
    if (typeof sb === 'undefined') throw new Error('API indisponivel');
    const tenantId = (typeof _sessao !== 'undefined' && _sessao?.tenant_id) ? _sessao.tenant_id : '';
    const payload = { gestor_tema: tema.key };
    if (tenantId) payload.tenant_id = tenantId;
    const res = await sb.from('store_config').upsert(payload);
    if (res?.error) throw new Error(res.error.message || 'Falha ao salvar');
    sbToast('ok', `${tema.nome} ativado e salvo!`);
  } catch(e) {
    sbToast('err', `${tema.nome} aplicado neste dispositivo, mas nao foi salvo no banco.`);
  } finally {
    temaSetBusy(false);
    temaUpdateCardSelection();
    temaRenderStatusPanel();
  }
}

function temaToggleRapido() {
  const atual = temaEncontrar(temaGetAtivoKey());
  temaAplicarModo(atual.tipo === 'dark' ? 'claro' : 'escuro');
}

// ── Atualiza seleção visual dos cards ──
function temaUpdateCardSelection() {
  const ativo = temaEncontrar(temaGetAtivoKey()).key;
  document.querySelectorAll('.gt-card').forEach(card => {
    const isOn = card.dataset.tema === ativo;
    card.style.borderColor = isOn ? 'var(--accent)' : 'var(--border)';
    card.style.boxShadow   = isOn ? '0 0 0 3px var(--accent-glow)' : 'none';
    card.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    const check = card.querySelector('.gt-check');
    if (check) check.style.display = isOn ? 'flex' : 'none';
  });
  document.querySelectorAll('.tema-mode-btn').forEach(btn => {
    const isOn = btn.getAttribute('onclick')?.includes(`'${ativo}'`);
    btn.classList.toggle('on', !!isOn);
    btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
  });
}

// ── Mini-preview HTML para cada card ──
function _temaPreviewHTML(p) {
  return `
    <div style="background:${p.bg};border-radius:8px;padding:10px;margin-bottom:10px;border:1px solid ${p.cardBorder}">
      <div style="display:flex;border-radius:6px;overflow:hidden;height:68px">
        <div style="width:44px;background:${p.sidebar};padding:5px 4px;display:flex;flex-direction:column;gap:3px">
          <div style="border-radius:3px;padding:2px 4px;font-size:6px;background:rgba(14,165,233,.15);color:${p.accent};font-weight:700">Ped</div>
          <div style="border-radius:3px;padding:2px 4px;font-size:6px;color:${p.muted}">Card</div>
          <div style="border-radius:3px;padding:2px 4px;font-size:6px;color:${p.muted}">Fin</div>
        </div>
        <div style="flex:1;background:${p.bg};padding:5px;display:flex;gap:3px">
          <div style="flex:1;background:${p.kol1};border:1px solid ${p.cardBorder};border-radius:4px;padding:3px">
            <div style="font-size:5px;font-weight:800;color:${p.kolT1};margin-bottom:3px;letter-spacing:.3px">ANÁLISE</div>
            <div style="background:${p.card};border:1px solid ${p.cardBorder};border-radius:3px;padding:2px 3px">
              <div style="font-size:5px;color:${p.accent};font-weight:700">#001</div>
              <div style="font-size:5px;color:${p.text};opacity:.7">João</div>
            </div>
          </div>
          <div style="flex:1;background:${p.kol2};border:1px solid ${p.cardBorder};border-radius:4px;padding:3px">
            <div style="font-size:5px;font-weight:800;color:${p.kolT2};letter-spacing:.3px">PRODUÇÃO</div>
          </div>
          <div style="flex:1;background:${p.kol3};border:1px solid ${p.cardBorder};border-radius:4px;padding:3px">
            <div style="font-size:5px;font-weight:800;color:${p.kolT3};letter-spacing:.3px">PRONTO</div>
          </div>
        </div>
      </div>
    </div>`;
}

// ── Constrói grid de temas na page-tema ──
function initTemaPage() {
  temaRenderStatusPanel();
  const grid = document.getElementById('temas-grid');
  if (!grid) return;
  grid.innerHTML = GESTOR_TEMAS.map(t => `
    <div class="gt-card" data-tema="${t.key}" role="button" tabindex="0" onclick="temaAplicarModo('${t.key}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();temaAplicarModo('${t.key}')}"
         style="cursor:pointer;border-radius:14px;border:2px solid var(--border);padding:18px;transition:all .2s;background:var(--surface);position:relative;max-width:320px">
      ${_temaPreviewHTML(t.preview)}
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:22px">${t.emoji}</span>
        <div>
          <div style="font-size:14px;font-weight:700">${t.nome}</div>
          <div style="font-size:11px;color:var(--muted)">${t.desc}</div>
        </div>
      </div>
      <div class="gt-check" style="display:none;position:absolute;top:12px;right:12px;width:24px;height:24px;background:var(--accent);border-radius:50%;align-items:center;justify-content:center;box-shadow:0 2px 8px var(--accent-glow)">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
    </div>
  `).join('');
  temaUpdateCardSelection();
}

// ── Stubs de compatibilidade ──
function temaGetCurrent() { return {}; }
function temaGetCurrentKey() { return temaGetAtivoKey(); }
function temaSalvarStorage() {}
function temaCarregarStorage() {}
function temaReset() { temaAplicarModo('claro'); }
async function temaSalvar() { sbToast('ok','Tema aplicado!'); }
function temaBuildPresets() {}
function temaBuildFields() {}
function temaUpdatePreview() {}
function temaUpdateInputs() {}
function temaBuildPreview() {}

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
    nome: 'Modo Claro',
    desc: 'Branco limpo com azul Anotai',
    emoji: '☀️',
    tipo: 'light',
    preview: {
      bg:'#f4f6f9', sidebar:'#0c1322', accent:'#0ea5e9',
      card:'#ffffff', cardBorder:'rgba(0,0,0,.08)',
      text:'#1e293b', muted:'#64748b',
      kol1:'rgba(245,158,11,.06)', kol2:'rgba(14,165,233,.06)', kol3:'rgba(16,185,129,.06)',
      kolT1:'#b45309', kolT2:'#0284c7', kolT3:'#047857'
    },
    vars: {
      '--bg':'#f4f6f9',
      '--surface':'#ffffff',
      '--surface2':'#edf0f5',
      '--surface3':'#e2e6ed',
      '--border':'rgba(0,0,0,.08)',
      '--border2':'rgba(0,0,0,.14)',
      '--accent':'#0ea5e9',
      '--accent2':'#06b6d4',
      '--accent3':'#f59e0b',
      '--accent-dim':'rgba(14,165,233,.10)',
      '--accent-glow':'rgba(14,165,233,.18)',
      '--success':'#10b981',
      '--danger':'#ef4444',
      '--purple':'#8b5cf6',
      '--pink':'#ec4899',
      '--orange':'#f97316',
      '--text':'#1e293b',
      '--muted':'#64748b',
      '--muted2':'#475569',
      '--sidebar-bg':'#0c1322',
      '--topnav-bg':'#070d1a',
      '--sfoot-bg':'rgba(7,13,26,.85)'
    }
  }
];

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
  // Normaliza chaves antigas para os dois modos
  const mapa = {
    'escuro':'escuro', 'dark':'escuro', 'oceano':'escuro', 'cobre':'escuro',
    'cafe':'escuro', 'lavanda':'escuro', 'cereja':'escuro', 'crepusculo':'escuro', 'esmeralda':'escuro',
    'claro':'claro', 'light':'claro', 'artico':'claro', 'classico':'claro', 'minimalista':'claro'
  };
  const resolved = mapa[key] || 'escuro';
  const tema = GESTOR_TEMAS.find(t => t.key === resolved) || GESTOR_TEMAS[0];

  _aplicarVars(tema.vars);

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
}

// ── Aplica tema + salva no banco ──
function temaAplicarModo(key) {
  temaAplicarCompleto(key);
  if (typeof sb !== 'undefined' && typeof _sessao !== 'undefined') {
    sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, gestor_tema: key }).then(()=>{}).catch(()=>{});
  }
  temaUpdateCardSelection();
  const tema = GESTOR_TEMAS.find(t => t.key === key);
  sbToast('ok', tema ? `${tema.nome} ativado!` : 'Tema aplicado!');
}

// ── Atualiza seleção visual dos cards ──
function temaUpdateCardSelection() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  let ativo = 'escuro';
  for (const t of GESTOR_TEMAS) {
    if (t.vars['--bg'] === bg) { ativo = t.key; break; }
  }
  document.querySelectorAll('.gt-card').forEach(card => {
    const isOn = card.dataset.tema === ativo;
    card.style.borderColor = isOn ? 'var(--accent)' : 'var(--border)';
    card.style.boxShadow   = isOn ? '0 0 0 3px var(--accent-glow)' : 'none';
    const check = card.querySelector('.gt-check');
    if (check) check.style.display = isOn ? 'flex' : 'none';
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
  const grid = document.getElementById('temas-grid');
  if (!grid) return;
  grid.innerHTML = GESTOR_TEMAS.map(t => `
    <div class="gt-card" data-tema="${t.key}" onclick="temaAplicarModo('${t.key}')"
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
function temaSalvarStorage() {}
function temaCarregarStorage() {}
function temaReset() { temaAplicarModo('escuro'); }
async function temaSalvar() { sbToast('ok','Tema aplicado!'); }
function temaBuildPresets() {}
function temaBuildFields() {}
function temaUpdatePreview() {}
function temaUpdateInputs() {}
function temaBuildPreview() {}

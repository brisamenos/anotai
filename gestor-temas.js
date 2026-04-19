// ════════════════════════════════════════════════════════
// GESTOR TEMAS — 10 Temas Premium
// Arquivo isolado: não modifica nenhuma função existente
// ════════════════════════════════════════════════════════

const GESTOR_TEMAS = [
  {
    key: 'escuro',
    nome: 'Oceano Profundo',
    desc: 'Navy elegante com acentos cyan',
    emoji: '🌊',
    tipo: 'dark',
    preview: { bg:'#0a1220', sidebar:'#06101e', accent:'#0ea5e9', card:'#0f1a2e', cardBorder:'rgba(56,189,248,.07)', text:'#dce8f4', muted:'#5e7e9e', kol1:'rgba(251,191,36,.08)', kol2:'rgba(14,165,233,.08)', kol3:'rgba(52,211,153,.08)', kolT1:'#fbbf24', kolT2:'#7dd3fc', kolT3:'#6ee7b7' },
    vars: null // usa variáveis do :root / inline
  },
  {
    key: 'claro',
    nome: 'Claro',
    desc: 'Fundo claro, sidebar navy premium',
    emoji: '☀️',
    tipo: 'light',
    preview: { bg:'#f7f8fa', sidebar:'#16161a', accent:'#6366f1', card:'#ffffff', cardBorder:'rgba(0,0,0,.07)', text:'#1a1a2e', muted:'rgba(26,26,46,.4)', kol1:'rgba(160,122,80,.06)', kol2:'rgba(99,102,241,.05)', kol3:'rgba(5,150,105,.05)', kolT1:'#92400e', kolT2:'#4338ca', kolT3:'#047857' },
    vars: null // usa MODO_CLARO
  },
  {
    key: 'oceano',
    nome: 'Oceano Clássico',
    desc: 'Azul profundo com sky blue',
    emoji: '🐋',
    tipo: 'dark',
    preview: { bg:'#0a1628', sidebar:'#06101e', accent:'#38bdf8', card:'#0f1f38', cardBorder:'rgba(56,189,248,.1)', text:'#e0ecf8', muted:'#6890b0', kol1:'rgba(251,191,36,.08)', kol2:'rgba(56,189,248,.08)', kol3:'rgba(52,211,153,.08)', kolT1:'#fbbf24', kolT2:'#7dd3fc', kolT3:'#6ee7b7' },
    vars: {
      '--bg':'#0a1628','--surface':'#0f1f38','--surface2':'#152a48','--surface3':'#1c3558',
      '--border':'rgba(56,189,248,.08)','--border2':'rgba(56,189,248,.16)',
      '--accent':'#38bdf8','--accent2':'#818cf8','--accent3':'#f0a060',
      '--accent-dim':'rgba(56,189,248,.14)','--accent-glow':'rgba(56,189,248,.25)',
      '--success':'#34d399','--danger':'#fb7185','--purple':'#a78bfa',
      '--pink':'#f0abfc','--orange':'#f0a060',
      '--text':'#e0ecf8','--muted':'#6890b0','--muted2':'#90b0cc',
      '--sidebar-bg':'#06101e','--topnav-bg':'#040c18','--sfoot-bg':'rgba(4,12,24,.8)'
    }
  },
  {
    key: 'esmeralda',
    nome: 'Esmeralda',
    desc: 'Verde escuro sofisticado',
    emoji: '💎',
    tipo: 'dark',
    preview: { bg:'#081410', sidebar:'#061010', accent:'#34d399', card:'#0e1e18', cardBorder:'rgba(52,211,153,.1)', text:'#d8f0e4', muted:'#608878', kol1:'rgba(251,191,36,.08)', kol2:'rgba(52,211,153,.08)', kol3:'rgba(96,165,250,.08)', kolT1:'#fbbf24', kolT2:'#6ee7b7', kolT3:'#93c5fd' },
    vars: {
      '--bg':'#081410','--surface':'#0e1e18','--surface2':'#142820','--surface3':'#1c3228',
      '--border':'rgba(52,211,153,.08)','--border2':'rgba(52,211,153,.16)',
      '--accent':'#34d399','--accent2':'#38bdf8','--accent3':'#fbbf24',
      '--accent-dim':'rgba(52,211,153,.14)','--accent-glow':'rgba(52,211,153,.25)',
      '--success':'#4ade80','--danger':'#fb7185','--purple':'#a78bfa',
      '--pink':'#f0abfc','--orange':'#f0a060',
      '--text':'#d8f0e4','--muted':'#608878','--muted2':'#88b0a0',
      '--sidebar-bg':'#061010','--topnav-bg':'#040c0a','--sfoot-bg':'rgba(4,12,10,.8)'
    }
  },
  {
    key: 'crepusculo',
    nome: 'Crepúsculo',
    desc: 'Tons quentes de pôr do sol',
    emoji: '🌅',
    tipo: 'dark',
    preview: { bg:'#161010', sidebar:'#120d0d', accent:'#f59e0b', card:'#201818', cardBorder:'rgba(245,158,11,.1)', text:'#f0e4d8', muted:'#907868', kol1:'rgba(245,158,11,.08)', kol2:'rgba(251,113,133,.08)', kol3:'rgba(52,211,153,.08)', kolT1:'#fbbf24', kolT2:'#fda4af', kolT3:'#6ee7b7' },
    vars: {
      '--bg':'#161010','--surface':'#201818','--surface2':'#2a2020','--surface3':'#342828',
      '--border':'rgba(245,158,11,.08)','--border2':'rgba(245,158,11,.16)',
      '--accent':'#f59e0b','--accent2':'#fb7185','--accent3':'#818cf8',
      '--accent-dim':'rgba(245,158,11,.14)','--accent-glow':'rgba(245,158,11,.25)',
      '--success':'#34d399','--danger':'#fb7185','--purple':'#a78bfa',
      '--pink':'#f0abfc','--orange':'#f59e0b',
      '--text':'#f0e4d8','--muted':'#907868','--muted2':'#b09888',
      '--sidebar-bg':'#120d0d','--topnav-bg':'#0e0a0a','--sfoot-bg':'rgba(14,10,10,.8)'
    }
  },
  {
    key: 'lavanda',
    nome: 'Lavanda',
    desc: 'Roxo elegante e sofisticado',
    emoji: '💜',
    tipo: 'dark',
    preview: { bg:'#110f18', sidebar:'#0d0b14', accent:'#a78bfa', card:'#1a1726', cardBorder:'rgba(167,139,250,.1)', text:'#e8e0f8', muted:'#7868a0', kol1:'rgba(251,191,36,.08)', kol2:'rgba(167,139,250,.08)', kol3:'rgba(52,211,153,.08)', kolT1:'#fbbf24', kolT2:'#c4b5fd', kolT3:'#6ee7b7' },
    vars: {
      '--bg':'#110f18','--surface':'#1a1726','--surface2':'#231f32','--surface3':'#2c2740',
      '--border':'rgba(167,139,250,.08)','--border2':'rgba(167,139,250,.16)',
      '--accent':'#a78bfa','--accent2':'#f472b6','--accent3':'#fbbf24',
      '--accent-dim':'rgba(167,139,250,.14)','--accent-glow':'rgba(167,139,250,.25)',
      '--success':'#34d399','--danger':'#fb7185','--purple':'#c4b5fd',
      '--pink':'#f0abfc','--orange':'#f0a060',
      '--text':'#e8e0f8','--muted':'#7868a0','--muted2':'#9888c0',
      '--sidebar-bg':'#0d0b14','--topnav-bg':'#09080f','--sfoot-bg':'rgba(9,8,15,.8)'
    }
  },
  {
    key: 'cereja',
    nome: 'Cereja',
    desc: 'Vermelho intenso e marcante',
    emoji: '🍒',
    tipo: 'dark',
    preview: { bg:'#140a0c', sidebar:'#100810', accent:'#fb7185', card:'#1e1214', cardBorder:'rgba(251,113,133,.1)', text:'#f0e0e4', muted:'#a06878', kol1:'rgba(251,113,133,.08)', kol2:'rgba(167,139,250,.08)', kol3:'rgba(52,211,153,.08)', kolT1:'#fda4af', kolT2:'#c4b5fd', kolT3:'#6ee7b7' },
    vars: {
      '--bg':'#140a0c','--surface':'#1e1214','--surface2':'#281a1e','--surface3':'#342228',
      '--border':'rgba(251,113,133,.08)','--border2':'rgba(251,113,133,.16)',
      '--accent':'#fb7185','--accent2':'#a78bfa','--accent3':'#fbbf24',
      '--accent-dim':'rgba(251,113,133,.14)','--accent-glow':'rgba(251,113,133,.25)',
      '--success':'#34d399','--danger':'#f87171','--purple':'#a78bfa',
      '--pink':'#f0abfc','--orange':'#f0a060',
      '--text':'#f0e0e4','--muted':'#a06878','--muted2':'#c08898',
      '--sidebar-bg':'#100810','--topnav-bg':'#0c0608','--sfoot-bg':'rgba(12,6,8,.8)'
    }
  },
  {
    key: 'cobre',
    nome: 'Cobre',
    desc: 'Bronze premium e acolhedor',
    emoji: '🔶',
    tipo: 'dark',
    preview: { bg:'#13100c', sidebar:'#100d09', accent:'#c4956a', card:'#1d1812', cardBorder:'rgba(196,149,106,.1)', text:'#f0e8dc', muted:'#907860', kol1:'rgba(196,149,106,.08)', kol2:'rgba(103,232,249,.08)', kol3:'rgba(52,211,153,.08)', kolT1:'#d4a574', kolT2:'#67e8f9', kolT3:'#6ee7b7' },
    vars: {
      '--bg':'#13100c','--surface':'#1d1812','--surface2':'#272018','--surface3':'#31281e',
      '--border':'rgba(196,149,106,.08)','--border2':'rgba(196,149,106,.16)',
      '--accent':'#c4956a','--accent2':'#67e8f9','--accent3':'#a78bfa',
      '--accent-dim':'rgba(196,149,106,.14)','--accent-glow':'rgba(196,149,106,.25)',
      '--success':'#34d399','--danger':'#fb7185','--purple':'#a78bfa',
      '--pink':'#f0abfc','--orange':'#d4956a',
      '--text':'#f0e8dc','--muted':'#907860','--muted2':'#b09880',
      '--sidebar-bg':'#100d09','--topnav-bg':'#0c0a06','--sfoot-bg':'rgba(12,10,6,.8)'
    }
  },
  {
    key: 'artico',
    nome: 'Ártico',
    desc: 'Azul glacial claro e moderno',
    emoji: '❄️',
    tipo: 'light',
    preview: { bg:'#f0f4f8', sidebar:'#12182a', accent:'#3b82f6', card:'#ffffff', cardBorder:'rgba(0,0,0,.07)', text:'#1a2030', muted:'rgba(26,32,48,.45)', kol1:'rgba(160,122,80,.06)', kol2:'rgba(59,130,246,.05)', kol3:'rgba(5,150,105,.05)', kolT1:'#92400e', kolT2:'#1d4ed8', kolT3:'#047857' },
    vars: {
      '--bg':'#f0f4f8','--surface':'#ffffff','--surface2':'#e4eaf2','--surface3':'#d4dce8',
      '--border':'rgba(0,0,0,.07)','--border2':'rgba(0,0,0,.13)',
      '--accent':'#3b82f6','--accent2':'#0891b2','--accent3':'#c2410c',
      '--accent-dim':'rgba(59,130,246,.1)','--accent-glow':'rgba(59,130,246,.2)',
      '--success':'#059669','--danger':'#e11d48','--purple':'#7c3aed',
      '--pink':'#db2777','--orange':'#c2410c',
      '--text':'#1a2030','--muted':'rgba(26,32,48,.45)','--muted2':'rgba(26,32,48,.6)',
      '--sidebar-bg':'#12182a','--topnav-bg':'#0c1018','--sfoot-bg':'rgba(12,16,24,.85)'
    }
  },
  {
    key: 'cafe',
    nome: 'Café',
    desc: 'Marrom café aconchegante',
    emoji: '☕',
    tipo: 'dark',
    preview: { bg:'#12100e', sidebar:'#0f0d0b', accent:'#d4a574', card:'#1c1916', cardBorder:'rgba(212,165,116,.1)', text:'#e8e0d4', muted:'#887868', kol1:'rgba(212,165,116,.08)', kol2:'rgba(103,232,249,.08)', kol3:'rgba(52,211,153,.08)', kolT1:'#d4a574', kolT2:'#67e8f9', kolT3:'#6ee7b7' },
    vars: {
      '--bg':'#12100e','--surface':'#1c1916','--surface2':'#26221e','--surface3':'#302c26',
      '--border':'rgba(212,165,116,.08)','--border2':'rgba(212,165,116,.16)',
      '--accent':'#d4a574','--accent2':'#67e8f9','--accent3':'#a78bfa',
      '--accent-dim':'rgba(212,165,116,.14)','--accent-glow':'rgba(212,165,116,.25)',
      '--success':'#34d399','--danger':'#fb7185','--purple':'#a78bfa',
      '--pink':'#f0abfc','--orange':'#d4a574',
      '--text':'#e8e0d4','--muted':'#887868','--muted2':'#a89888',
      '--sidebar-bg':'#0f0d0b','--topnav-bg':'#0b0908','--sfoot-bg':'rgba(11,9,8,.8)'
    }
  }
];

// ── Aplica tema completo (chamado pelo gestor-core ao carregar dados) ──
function temaAplicarCompleto(key) {
  const tema = GESTOR_TEMAS.find(t => t.key === key);
  if (!tema) {
    // Fallback para escuro se tema desconhecido
    _aplicarVars(MODO_ESCURO);
    const el = document.getElementById('tema-light-override');
    if (el) el.remove();
    return;
  }
  const vars = tema.vars || (tema.key === 'claro' || tema.key === 'artico' ? MODO_CLARO : MODO_ESCURO);
  _aplicarVars(vars);

  if (tema.tipo === 'light') {
    _aplicarOverrideClaro(vars);
  } else {
    const el = document.getElementById('tema-light-override');
    if (el) el.remove();
    // Corrige modais para temas escuros — garante legibilidade
    _aplicarOverrideModal(vars);
  }
}

// ── Override modal para garantir legibilidade em todos os temas escuros ──
function _aplicarOverrideModal(vars) {
  let el = document.getElementById('tema-modal-override');
  if (el) el.remove();
  const sur  = vars['--surface']  || '#19191d';
  const sur2 = vars['--surface2'] || '#222226';
  const text = vars['--text']     || '#e4e4e7';
  const muted= vars['--muted']    || '#71717a';
  const bord = vars['--border2']  || 'rgba(255,255,255,.12)';
  const acc  = vars['--accent']   || '#818cf8';
  const style = document.createElement('style');
  style.id = 'tema-modal-override';
  style.textContent = `
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
  document.head.appendChild(style);
}

// ── Aplica tema + salva no banco (chamado pelo click do usuário) ──
function temaAplicarModo(key) {
  temaAplicarCompleto(key);
  // Salva no banco
  if (typeof sb !== 'undefined' && typeof _sessao !== 'undefined') {
    sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, gestor_tema: key }).then(()=>{}).catch(()=>{});
  }
  temaUpdateCardSelection();
  const tema = GESTOR_TEMAS.find(t => t.key === key);
  sbToast('ok', tema ? `Tema "${tema.nome}" aplicado!` : 'Tema aplicado!');
}

// ── Atualiza seleção visual dos cards de tema ──
function temaUpdateCardSelection() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  // Descobre qual tema está ativo comparando --bg
  let ativo = 'escuro';
  for (const t of GESTOR_TEMAS) {
    const v = t.vars || (t.key === 'claro' ? MODO_CLARO : (t.key === 'escuro' ? MODO_ESCURO : null));
    if (v && v['--bg'] === bg) { ativo = t.key; break; }
  }
  document.querySelectorAll('.gt-card').forEach(card => {
    const isOn = card.dataset.tema === ativo;
    card.style.borderColor = isOn ? 'var(--accent)' : 'var(--border)';
    card.style.boxShadow   = isOn ? '0 0 0 3px var(--accent-glow)' : 'none';
    const check = card.querySelector('.gt-check');
    if (check) check.style.display = isOn ? 'flex' : 'none';
  });
}

// ── Gera mini-preview SVG para o card de tema ──
function _temaPreviewHTML(p) {
  return `
    <div style="background:${p.bg};border-radius:8px;padding:10px;margin-bottom:10px;border:1px solid ${p.cardBorder}">
      <div style="display:flex;border-radius:6px;overflow:hidden;height:64px">
        <div style="width:44px;background:${p.sidebar};padding:5px 4px;display:flex;flex-direction:column;gap:2px">
          <div style="border-radius:3px;padding:2px 4px;font-size:6px;background:${p.accent}22;color:${p.accent};font-weight:700">Ped</div>
          <div style="border-radius:3px;padding:2px 4px;font-size:6px;color:${p.muted}">Card</div>
          <div style="border-radius:3px;padding:2px 4px;font-size:6px;color:${p.muted}">Rel</div>
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
         style="cursor:pointer;border-radius:14px;border:2px solid var(--border);padding:16px;transition:all .2s;background:var(--surface);position:relative">
      ${_temaPreviewHTML(t.preview)}
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:18px">${t.emoji}</span>
        <div>
          <div style="font-size:13px;font-weight:700">${t.nome}</div>
          <div style="font-size:10.5px;color:var(--muted)">${t.desc}</div>
        </div>
      </div>
      <div class="gt-check" style="display:none;position:absolute;top:10px;right:10px;width:22px;height:22px;background:var(--accent);border-radius:50%;align-items:center;justify-content:center;box-shadow:0 2px 8px var(--accent-glow)">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
    </div>
  `).join('');
  temaUpdateCardSelection();
}

// ── Stubs de compatibilidade (sobrescrevem os do gestor-robo.js) ──
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

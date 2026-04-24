// ── Adiciona valor de kg ao campo de pesos ─────────────
function addKgPeso(ctx, gramas) {
  const el = document.getElementById(`${ctx}-pesos`);
  if (!el) return;
  const atual = el.value.trim();
  const valores = atual ? atual.split(',').map(s => parseInt(s.trim())).filter(n => n > 0) : [];
  if (!valores.includes(gramas)) {
    valores.push(gramas);
    valores.sort((a, b) => a - b);
    el.value = valores.join(', ');
  }
}

// ══════════════════════════════════════════
//  AÇOUGUE — Editor dinâmico de cortes e preparos
// ══════════════════════════════════════════

// Estado das listas por contexto (new / edit) e tipo (cortes / preparos / ocasiao / armazenamento)
const _acListState = {
  'new-cortes':          [],
  'new-preparos':        [],
  'new-ocasiao':         [],
  'new-armazenamento':   [],
  'edit-cortes':         [],
  'edit-preparos':       [],
  'edit-ocasiao':        [],
  'edit-armazenamento':  []
};

// Catálogo de cortes disponíveis para seleção
const _AC_CORTES_CATALOG = [
  { id:'tirinha',    nome:'Tirinha',     icon:null },
  { id:'tiras',      nome:'Tiras',       icon:null },
  { id:'inteiro',    nome:'Inteiro',     icon:null },
  { id:'grelha',     nome:'Grelha',      icon:null },
  { id:'espeto',     nome:'Espeto',      icon:null },
  { id:'peca',       nome:'Peça',        icon:null },
  { id:'moido',      nome:'Moído',       icon:null },
  { id:'moido2x',    nome:'Moído 2x',    icon:null },
  { id:'cubos',      nome:'Cubos',       icon:null },
  { id:'picado',     nome:'Picado',      icon:null },
  { id:'strogonoff', nome:'Strogonoff',  icon:null },
  { id:'bife',       nome:'Bife',        icon:null },
  { id:'bifefino',   nome:'Bife Fino',   icon:null },
  { id:'bifemedio',  nome:'Bife Médio',  icon:null },
  { id:'bifegrosso', nome:'Bife Grosso', icon:null },
  { id:'postas',     nome:'Postas',      icon:null },
];

// Catálogo de preparos com ícones do S3
const _AC_PREPAROS_CATALOG = [
  { id:'churrasco',  nome:'Churrasco',  icon:'https://onbeef.s3.amazonaws.com/tags/icons/churrasco.png' },
  { id:'grelhar',    nome:'Grelhar',    icon:'https://onbeef.s3.amazonaws.com/tags/icons/grellhar.png' },
  { id:'frigideira', nome:'Frigideira', icon:'https://onbeef.s3.amazonaws.com/tags/icons/frigideira.png' },
  { id:'forno',      nome:'Forno',      icon:'https://onbeef.s3.amazonaws.com/tags/icons/forno.png' },
  { id:'airfryer',   nome:'Airfryer',   icon:'https://onbeef.s3.amazonaws.com/tags/icons/airfryer.png' },
  { id:'panela',     nome:'Panela',     icon:'https://onbeef.s3.amazonaws.com/tags/icons/panela.png' },
  { id:'ensopado',   nome:'Ensopado',   icon:'https://onbeef.s3.amazonaws.com/tags/icons/ensopado.png' },
  { id:'espeto',     nome:'Espeto',     icon:'https://onbeef.s3.amazonaws.com/tags/icons/espeto.png' },
  { id:'defumado',   nome:'Defumado',   icon:'https://onbeef.s3.amazonaws.com/tags/icons/smoker.png' },
  { id:'dia_a_dia',  nome:'Dia a dia',  icon:'https://onbeef.s3.amazonaws.com/tags/icons/dia_a_dia.png' },
  { id:'resfriado',  nome:'Resfriado',  icon:'https://onbeef.s3.amazonaws.com/tags/icons/wind.png' },
];

// Catálogo de tipo de ocasião
const _AC_OCASIAO_CATALOG = [
  { id:'churrasco',       nome:'Churrasco',        icon:'https://onbeef.s3.amazonaws.com/tags/icons/churrasco.png' },
  { id:'dia_a_dia',       nome:'Dia a dia',         icon:'https://onbeef.s3.amazonaws.com/tags/icons/dia_a_dia.png' },
  { id:'final_semana',    nome:'Final de semana',   icon:null },
  { id:'festas',          nome:'Festas',            icon:null },
  { id:'especial',        nome:'Ocasião especial',  icon:null },
  { id:'semana',          nome:'Semana',            icon:null },
];

// Catálogo de armazenamento
const _AC_ARMAZENAMENTO_CATALOG = [
  { id:'resfriado',        nome:'Resfriado',          icon:'https://onbeef.s3.amazonaws.com/tags/icons/wind.png' },
  { id:'congelado',        nome:'Congelado',           icon:null },
  { id:'refrigerado',      nome:'Refrigerado',         icon:null },
  { id:'temp_ambiente',    nome:'Temperatura ambiente', icon:null },
];

// ── Renderiza lista dinâmica ──────────────────────────
function renderAcList(ctx, tipo) {
  const key  = `${ctx}-${tipo}`;
  const list = _acListState[key] || [];
  const el   = document.getElementById(`${ctx}-${tipo}-list`);
  if (!el) return;

  const emojis = { cortes:'_meat', preparos:'_pan', ocasiao:'_target', armazenamento:'_snow' };
  const emojiSvg = { _meat:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M7 17c-2-2-3-5-1.5-8.5S11 3.5 15 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.4"/></svg>`, _pan:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 15h12a2 2 0 0 0 0-4H3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M15 11V8M19 10h-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`, _target:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>`, _snow:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3v18M3 12h18M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>` };

  if (!list.length) {
    el.innerHTML = `<div style="font-size:11.5px;color:var(--muted);padding:6px 2px;font-style:italic">Nenhum item. Clique em "+ Adicionar" para começar.</div>`;
    return;
  }

  el.innerHTML = list.map((item, idx) => {
    const emoji  = emojis[tipo] || '📌';
    const iconEl = item.icon
      ? `<img src="${item.icon}" style="width:32px;height:32px;object-fit:contain;border-radius:6px;flex-shrink:0;display:block" onerror="this.style.opacity='.2'">`
      : `<div style="width:32px;height:32px;border-radius:6px;background:var(--surface);border:1.5px dashed var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;cursor:pointer" onclick="acIconEdit('${ctx}','${tipo}',${idx})" title="Adicionar ícone">${emojiSvg[emojis[tipo]] || emojiSvg._meat}</div>`;

    // Campo de porções — exclusivo para cortes
    const porcaoEl = tipo === 'cortes'
      ? `<div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
           <label style="font-size:10px;color:var(--muted);white-space:nowrap">Porções:</label>
           <input type="number" min="1" max="99" step="1" placeholder="—"
             value="${item.porcoes || ''}"
             onchange="acPorcaoUpdate('${ctx}',${idx},this.value)"
             onclick="event.stopPropagation()"
             title="Nº de porções para este corte"
             style="width:46px;padding:3px 6px;border:1.5px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font-size:12px;font-family:inherit;text-align:center;outline:none"
             onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">
         </div>`
      : '';

    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:8px">
      <div onclick="acIconEdit('${ctx}','${tipo}',${idx})" title="Editar ícone" style="cursor:pointer;flex-shrink:0;position:relative" onmouseenter="this.querySelector('.icon-edit-hint')&&(this.querySelector('.icon-edit-hint').style.opacity='1')" onmouseleave="this.querySelector('.icon-edit-hint')&&(this.querySelector('.icon-edit-hint').style.opacity='0')">
        ${iconEl}
        <div class="icon-edit-hint" style="position:absolute;inset:0;background:rgba(0,0,0,.55);border-radius:6px;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .15s;pointer-events:none">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3L5 14H2v-3L11 2z" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </div>
      <span style="flex:1;font-size:12.5px;font-weight:600">${item.nome}</span>
      ${porcaoEl}
      <div style="display:flex;gap:1px;flex-shrink:0">
        <button type="button" onclick="acIconEdit('${ctx}','${tipo}',${idx})" title="Editar ícone" style="width:28px;height:28px;border:none;background:transparent;cursor:pointer;color:var(--muted);font-size:13px;border-radius:4px;display:flex;align-items:center;justify-content:center">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3L5 14H2v-3L11 2z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" onclick="acListMove('${ctx}','${tipo}',${idx},-1)" title="Mover para cima" ${idx===0?'disabled':''} style="width:28px;height:28px;border:none;background:transparent;cursor:pointer;color:var(--muted);font-size:13px;border-radius:4px;display:flex;align-items:center;justify-content:center;opacity:${idx===0?.3:1}">↑</button>
        <button type="button" onclick="acListMove('${ctx}','${tipo}',${idx},1)" title="Mover para baixo" ${idx===list.length-1?'disabled':''} style="width:28px;height:28px;border:none;background:transparent;cursor:pointer;color:var(--muted);font-size:13px;border-radius:4px;display:flex;align-items:center;justify-content:center;opacity:${idx===list.length-1?.3:1}">↓</button>
        <button type="button" onclick="acListRemove('${ctx}','${tipo}',${idx})" title="Remover item" style="width:28px;height:28px;border:none;background:transparent;cursor:pointer;color:#ef4444;font-size:14px;border-radius:4px;display:flex;align-items:center;justify-content:center">✕</button>
      </div>
    </div>`;
  }).join('');
}

// ── Remove item da lista ──────────────────────────────
function acListRemove(ctx, tipo, idx) {
  const key = `${ctx}-${tipo}`;
  if (_acListState[key]) { _acListState[key].splice(idx, 1); renderAcList(ctx, tipo); }
}

// ── Move item para cima/baixo ─────────────────────────
function acListMove(ctx, tipo, idx, dir) {
  const key  = `${ctx}-${tipo}`;
  const list = _acListState[key];
  if (!list) return;
  const ni = idx + dir;
  if (ni < 0 || ni >= list.length) return;
  [list[idx], list[ni]] = [list[ni], list[idx]];
  renderAcList(ctx, tipo);
}

// ── Atualiza porções de um corte ─────────────────────
function acPorcaoUpdate(ctx, idx, val) {
  const list = _acListState[`${ctx}-cortes`];
  if (!list || !list[idx]) return;
  const n = parseInt(val);
  list[idx].porcoes = (n > 0) ? n : null;
}

// ── Adiciona item à lista ─────────────────────────────
function acListAdd(ctx, tipo, id, nome, icon) {
  const key = `${ctx}-${tipo}`;
  if (!_acListState[key]) _acListState[key] = [];
  if (_acListState[key].find(i => i.id === id)) {
    document.getElementById('ac-list-picker-modal')?.remove(); return;
  }
  _acListState[key].push({ id, nome, icon: icon || null });
  renderAcList(ctx, tipo);
  document.getElementById('ac-list-picker-modal')?.remove();
}

// ── Adiciona item personalizado ───────────────────────
function acListAddCustom(ctx, tipo) {
  const nameEl = document.getElementById('ac-picker-custom-name');
  const nome = (nameEl?.value || '').trim();
  if (!nome) { sbToast('err', 'Informe o nome'); return; }
  const id = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_');
  acListAdd(ctx, tipo, id, nome, null);
  if (nameEl) nameEl.value = '';
}

// ── Editor de ícone de item ───────────────────────────
let _acIconCtx = null, _acIconTipo = null, _acIconIdx = null;

function acIconEdit(ctx, tipo, idx) {
  _acIconCtx  = ctx;
  _acIconTipo = tipo;
  _acIconIdx  = idx;

  const item     = (_acListState[`${ctx}-${tipo}`] || [])[idx];
  if (!item) return;

  const nomes = { cortes:'Corte', preparos:'Preparo', ocasiao:'Ocasião', armazenamento:'Armazenamento' };
  const titulo = `Ícone — ${item.nome}`;

  document.getElementById('ac-icon-editor-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'ac-icon-editor-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:10000;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px)';
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  const currentIcon = item.icon || '';
  const previewHtml = currentIcon
    ? `<img id="ac-icon-preview-img" src="${currentIcon}" style="width:80px;height:80px;object-fit:contain;border-radius:14px;border:2px solid var(--accent)" onerror="this.src='';this.style.display='none';document.getElementById('ac-icon-preview-empty').style.display='flex'">`
    : '';
  const emptyStyle  = currentIcon ? 'display:none' : 'display:flex';

  modal.innerHTML = `
  <div onclick="event.stopPropagation()" style="background:var(--surface);border-radius:20px 20px 0 0;padding:24px 20px 32px;width:100%;max-width:480px">
    <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 18px"></div>

    <!-- Título -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <div style="font-size:15px;font-weight:800">${titulo}</div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:2px">Editar ícone do item</div>
      </div>
      <button onclick="document.getElementById('ac-icon-editor-modal').remove()" style="border:none;background:var(--surface2);border-radius:50%;width:32px;height:32px;cursor:pointer;color:var(--text);font-size:16px;display:flex;align-items:center;justify-content:center">✕</button>
    </div>

    <!-- Preview atual -->
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px;margin-bottom:22px">
      <div style="font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;align-self:flex-start">Ícone atual</div>
      <div style="position:relative;width:80px;height:80px">
        ${previewHtml}
        <div id="ac-icon-preview-empty" style="${emptyStyle};width:80px;height:80px;border-radius:14px;border:2px dashed var(--border);align-items:center;justify-content:center;font-size:32px;color:var(--muted)">📌</div>
      </div>
      ${currentIcon ? `<button onclick="acIconRemove()" style="padding:5px 14px;border:1px solid #ef4444;background:rgba(239,68,68,.08);color:#ef4444;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-right:4px"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        Remover ícone
      </button>` : ''}
    </div>

    <!-- Upload de arquivo -->
    <div style="margin-bottom:16px">
      <div style="font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-right:4px"><path d="M8 11V3M4 7l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 13h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        Upload de imagem
      </div>
      <label style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--surface2);border:1.5px dashed var(--border);border-radius:10px;cursor:pointer;transition:border-color .15s" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M8 11V3M4 7l4-4 4 4" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 13h12" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"/></svg>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text)">Clique para selecionar</div>
          <div style="font-size:11px;color:var(--muted);margin-top:1px">PNG, JPG, SVG, WEBP — recomendado fundo transparente</div>
        </div>
        <input type="file" accept="image/*" style="display:none" onchange="acIconUpload(this)">
      </label>
    </div>

    <!-- Link externo -->
    <div style="margin-bottom:22px">
      <div style="font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-right:4px"><path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5L7 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M9.5 6.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5L9 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        Ou cole um link de imagem
      </div>
      <div style="display:flex;gap:8px">
        <input id="ac-icon-url-input" type="url" placeholder="https://..." value="${currentIcon}" style="flex:1;padding:10px 12px;background:var(--surface2);border:1.5px solid var(--border);border-radius:10px;color:var(--text);font-size:13px;outline:none;font-family:inherit" oninput="acIconPreviewUrl(this.value)" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">
        <button onclick="acIconApplyUrl()" style="padding:10px 16px;background:var(--accent);border:none;border-radius:10px;color:#000;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">Aplicar</button>
      </div>
    </div>

    <!-- Botão confirmar -->
    <button onclick="acIconSave()" style="width:100%;padding:13px;background:var(--accent);border:none;border-radius:12px;color:#000;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit">
      ✓ Salvar ícone
    </button>
  </div>`;

  document.body.appendChild(modal);
}

// Preview ao vivo ao colar URL
function acIconPreviewUrl(url) {
  const img   = document.getElementById('ac-icon-preview-img');
  const empty = document.getElementById('ac-icon-preview-empty');
  if (!url) {
    if (img)   { img.src=''; img.style.display='none'; }
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (!img) {
    // Cria elemento de preview se não existia
    const wrap  = document.querySelector('#ac-icon-editor-modal [style*="position:relative"]');
    if (!wrap) return;
    const newImg = document.createElement('img');
    newImg.id = 'ac-icon-preview-img';
    newImg.style.cssText = 'width:80px;height:80px;object-fit:contain;border-radius:14px;border:2px solid var(--accent)';
    newImg.onerror = () => { newImg.style.display='none'; if(empty) empty.style.display='flex'; };
    wrap.insertBefore(newImg, wrap.firstChild);
  }
  const previewImg = document.getElementById('ac-icon-preview-img');
  if (previewImg) {
    previewImg.src = url;
    previewImg.style.display = 'block';
    if (empty) empty.style.display = 'none';
  }
}

// Aplica URL digitada como preview sem salvar
function acIconApplyUrl() {
  const val = (document.getElementById('ac-icon-url-input')?.value || '').trim();
  if (!val) { sbToast('err', 'Cole um link de imagem válido'); return; }
  acIconPreviewUrl(val);
}

// Upload de arquivo → converte para base64 ou URL objeto e faz preview
function acIconUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  const maxMB = 2;
  if (file.size > maxMB * 1024 * 1024) { sbToast('err', `Imagem muito grande (máx ${maxMB}MB)`); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const url = e.target.result;
    // Preenche o campo URL com base64 para poder salvar
    const inp = document.getElementById('ac-icon-url-input');
    if (inp) inp.value = url;
    acIconPreviewUrl(url);
  };
  reader.readAsDataURL(file);
}

// Remove ícone atual
function acIconRemove() {
  const key  = `${_acIconCtx}-${_acIconTipo}`;
  const item = (_acListState[key] || [])[_acIconIdx];
  if (!item) return;
  item.icon = null;
  renderAcList(_acIconCtx, _acIconTipo);
  document.getElementById('ac-icon-editor-modal')?.remove();
  sbToast('ok', 'Ícone removido');
}

// Salva o ícone (URL do input ou preview gerado por upload)
async function acIconSave() {
  const url  = (document.getElementById('ac-icon-url-input')?.value || '').trim();
  const key  = `${_acIconCtx}-${_acIconTipo}`;
  const item = (_acListState[key] || [])[_acIconIdx];
  if (!item) return;
  item.icon = url || null;
  renderAcList(_acIconCtx, _acIconTipo);
  document.getElementById('ac-icon-editor-modal')?.remove();
  sbToast('ok', url ? 'Ícone atualizado!' : 'Ícone removido');
}

// ── Abre picker de seleção ────────────────────────────
function acListPick(ctx, tipo) {
  const catalogs = {
    cortes:        _AC_CORTES_CATALOG,
    preparos:      _AC_PREPAROS_CATALOG,
    ocasiao:       _AC_OCASIAO_CATALOG,
    armazenamento: _AC_ARMAZENAMENTO_CATALOG,
  };
  const titulos = {
    cortes:        'Adicionar Corte',
    preparos:      'Adicionar Forma de Preparo',
    ocasiao:       'Adicionar Tipo de Ocasião',
    armazenamento: 'Adicionar Armazenamento',
  };
  const emojis = { cortes:'_meat', preparos:'_pan', ocasiao:'_target', armazenamento:'_snow' };
  const emojiSvg = { _meat:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M7 17c-2-2-3-5-1.5-8.5S11 3.5 15 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.4"/></svg>`, _pan:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 15h12a2 2 0 0 0 0-4H3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M15 11V8M19 10h-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`, _target:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>`, _snow:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3v18M3 12h18M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>` };
  const catalog  = catalogs[tipo] || [];
  const key      = `${ctx}-${tipo}`;
  const existing = (_acListState[key] || []).map(i => i.id);
  const available= catalog.filter(c => !existing.includes(c.id));

  document.getElementById('ac-list-picker-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'ac-list-picker-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:9999;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(3px)';
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  const titulo = titulos[tipo] || '+ Adicionar';
  const emoji  = emojis[tipo] || '📌';
  const listaHTML = available.length
    ? available.map(item => {
        const iconEl = item.icon
          ? `<img src="${item.icon}" style="width:30px;height:30px;object-fit:contain;flex-shrink:0">`
          : `<span style="font-size:20px;width:30px;text-align:center;flex-shrink:0">${emojiSvg[emojis[tipo]] || emojiSvg._meat}</span>`;
        return `<button type="button" onclick="acListAdd('${ctx}','${tipo}','${item.id}','${item.nome.replace(/'/g,"\\'")}'${item.icon?`,'${item.icon}'`:''})" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:9px;cursor:pointer;color:var(--text);text-align:left;font-family:inherit;font-size:13px;font-weight:500;transition:all .15s" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'">${iconEl}<span>${item.nome}</span></button>`;
      }).join('')
    : `<div style="text-align:center;padding:16px;color:var(--muted);font-size:13px">Todos os itens do catálogo já foram adicionados.</div>`;

  modal.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--surface);border-radius:20px 20px 0 0;padding:20px;width:100%;max-width:520px;max-height:72vh;display:flex;flex-direction:column">
    <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 14px"></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-size:14px;font-weight:700">${titulo}</div>
      <button type="button" onclick="document.getElementById('ac-list-picker-modal').remove()" style="border:none;background:var(--surface2);border-radius:50%;width:30px;height:30px;cursor:pointer;color:var(--text);font-size:16px;display:flex;align-items:center;justify-content:center">✕</button>
    </div>
    <div style="overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:6px">${listaHTML}</div>
    <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px;flex-shrink:0">
      <div style="font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px">Personalizado</div>
      <div style="display:flex;gap:8px">
        <input id="ac-picker-custom-name" class="form-input" placeholder="Nome personalizado..." style="flex:1;font-size:13px">
        <button type="button" onclick="acListAddCustom('${ctx}','${tipo}')" style="padding:8px 14px;background:var(--accent);border:none;border-radius:8px;color:#000;font-weight:700;cursor:pointer;font-family:inherit;font-size:12.5px;white-space:nowrap">+ Adicionar</button>
      </div>
    </div>
  </div>`;

  document.body.appendChild(modal);
}

// ══════════════════════════════════════════
//  CATÁLOGOS GLOBAIS — Atalhos do gestor
//  Permite adicionar, renomear, editar ícone e excluir
//  itens dos catálogos sem abrir nenhum produto
// ══════════════════════════════════════════

// Referência dinâmica aos catálogos (permite edição em tempo real)
const _AC_CATALOGS = {
  cortes:        _AC_CORTES_CATALOG,
  preparos:      _AC_PREPAROS_CATALOG,
  ocasiao:       _AC_OCASIAO_CATALOG,
  armazenamento: _AC_ARMAZENAMENTO_CATALOG,
};

const _AC_CATALOG_META = {
  cortes:        { label: 'Cortes',            svgIcon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M7 17c-2-2-3-5-1.5-8.5S11 3.5 15 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.4"/></svg>`, color: 'rgba(34,197,94,.12)',  border: 'rgba(34,197,94,.3)',  text: '#16a34a' },
  preparos:      { label: 'Formas de Preparo', svgIcon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 15h12a2 2 0 0 0 0-4H3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M15 11V8M19 10h-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,  color: 'rgba(249,115,22,.10)', border: 'rgba(249,115,22,.3)', text: 'var(--accent)' },
  ocasiao:       { label: 'Tipo de Ocasião',   svgIcon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>`,  color: 'rgba(139,92,246,.10)', border: 'rgba(139,92,246,.3)', text: '#7c3aed' },
  armazenamento: { label: 'Armazenamento',     svgIcon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3v18M3 12h18M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`, color: 'rgba(14,165,233,.10)', border: 'rgba(14,165,233,.3)', text: '#0284c7' },
};

// ── Carrega catálogos do banco via API ───────────────
async function _acCatalogsLoad() {
  try {
    const tid = window._tenantId || '';
    if (!tid) return;
    const r = await fetch('/api/acougue-catalogs', { headers: { 'x-tenant-id': tid } });
    if (!r.ok) return;
    const d = await r.json();
    if (!d.catalogs || typeof d.catalogs !== 'object') return;
    for (const [tipo, items] of Object.entries(d.catalogs)) {
      if (Array.isArray(items) && _AC_CATALOGS[tipo]) {
        _AC_CATALOGS[tipo].length = 0;
        items.forEach(i => _AC_CATALOGS[tipo].push(i));
      }
    }
  } catch(e) {}
}

// ── Salva catálogos no banco via API ─────────────────
async function _acCatalogsSave() {
  try {
    const tid = window._tenantId || '';
    if (!tid) return;
    const data = {};
    for (const [tipo, arr] of Object.entries(_AC_CATALOGS)) data[tipo] = arr;
    await fetch('/api/acougue-catalogs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify(data)
    });
  } catch(e) {}
}

// ── Renderiza os 4 cards de atalho ──────────────────
function renderAcCatalogCards() {
  const wrap = document.getElementById('acougue-catalog-cards');
  if (!wrap) return;
  wrap.innerHTML = Object.entries(_AC_CATALOG_META).map(([tipo, meta]) => {
    const list   = _AC_CATALOGS[tipo] || [];
    const count  = list.length;
    const thumbs = list.slice(0, 4).map(item => {
      if (item.icon) return `<img src="${item.icon}" style="width:24px;height:24px;object-fit:contain;border-radius:5px;flex-shrink:0" onerror="this.style.opacity='.2'">`;
      return `<span style="font-size:16px;width:24px;text-align:center;flex-shrink:0">${meta.svgIcon||''}</span>`;
    }).join('');
    const moreLabel = count > 4 ? `<span style="font-size:10px;color:var(--muted);margin-left:2px">+${count-4}</span>` : '';

    return `<div style="background:${meta.color};border:1.5px solid ${meta.border};border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
      <!-- Cabeçalho -->
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:20px">${meta.svgIcon||''}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;font-weight:800;color:${meta.text}">${meta.label}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:1px">${count} item${count!==1?'s':''} no catálogo</div>
        </div>
      </div>
      <!-- Thumbs dos itens -->
      <div style="display:flex;align-items:center;gap:4px;min-height:24px">
        ${thumbs || `<span style="font-size:11px;color:var(--muted);font-style:italic">Nenhum item ainda</span>`}
        ${moreLabel}
      </div>
      <!-- Ações -->
      <div style="display:flex;gap:6px">
        <button onclick="openAcCatalogManager('${tipo}')" style="flex:1;display:flex;align-items:center;justify-content:center;gap:5px;padding:7px 10px;background:${meta.color};border:1.5px solid ${meta.border};border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;color:${meta.text};font-family:inherit;transition:all .15s" onmouseenter="this.style.opacity='.75'" onmouseleave="this.style.opacity='1'">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3L5 14H2v-3L11 2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Gerenciar
        </button>
        <button onclick="openAcCatalogAddItem('${tipo}')" style="display:flex;align-items:center;justify-content:center;gap:4px;padding:7px 10px;background:var(--surface);border:1.5px solid ${meta.border};border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;color:${meta.text};font-family:inherit;transition:all .15s" title="Adicionar item ao catálogo" onmouseenter="this.style.opacity='.75'" onmouseleave="this.style.opacity='1'">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

// ── Abre o gerenciador completo de um catálogo ──────
function openAcCatalogManager(tipo) {
  const meta = _AC_CATALOG_META[tipo];
  const list = _AC_CATALOGS[tipo] || [];
  document.getElementById('ac-catalog-manager-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'ac-catalog-manager-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:9990;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px)';
  modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); renderAcCatalogCards(); } });

  modal.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--surface);border-radius:20px 20px 0 0;width:100%;max-width:560px;max-height:88vh;display:flex;flex-direction:column">
    <!-- Handle -->
    <div style="padding:12px 20px 0;flex-shrink:0"><div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto"></div></div>
    <!-- Header -->
    <div style="padding:16px 20px 14px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;gap:12px">
      <div style="width:40px;height:40px;border-radius:12px;background:${meta.color};border:1.5px solid ${meta.border};display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">${meta.svgIcon||''}</div>
      <div style="flex:1">
        <div style="font-size:15px;font-weight:800">${meta.label}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">Gerencie os itens que aparecem no seletor dos produtos</div>
      </div>
      <button onclick="document.getElementById('ac-catalog-manager-modal').remove();renderAcCatalogCards()" style="border:none;background:var(--surface2);border-radius:50%;width:32px;height:32px;cursor:pointer;color:var(--text);font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
    </div>
    <!-- Lista de itens -->
    <div id="ac-catalog-manager-list" style="overflow-y:auto;flex:1;padding:12px 20px;display:flex;flex-direction:column;gap:6px"></div>
    <!-- Footer: adicionar -->
    <div style="padding:14px 20px;border-top:1px solid var(--border);flex-shrink:0">
      <button onclick="openAcCatalogAddItem('${tipo}')" style="width:100%;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;background:${meta.color};border:1.5px solid ${meta.border};border-radius:12px;cursor:pointer;font-size:13.5px;font-weight:700;color:${meta.text};font-family:inherit">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Adicionar novo item ao catálogo
      </button>
    </div>
  </div>`;

  document.body.appendChild(modal);
  _renderAcCatalogManagerList(tipo);
}

function _renderAcCatalogManagerList(tipo) {
  const meta = _AC_CATALOG_META[tipo];
  const list = _AC_CATALOGS[tipo] || [];
  const wrap = document.getElementById('ac-catalog-manager-list');
  if (!wrap) return;

  if (!list.length) {
    wrap.innerHTML = `<div style="text-align:center;padding:32px 0;color:var(--muted)">
      <div style="font-size:36px;margin-bottom:10px">${meta.svgIcon||''}</div>
      <div style="font-size:13px">Nenhum item ainda.<br>Adicione o primeiro item abaixo.</div>
    </div>`;
    return;
  }

  wrap.innerHTML = list.map((item, idx) => {
    const iconEl = item.icon
      ? `<img src="${item.icon}" style="width:36px;height:36px;object-fit:contain;border-radius:8px;display:block" onerror="this.style.opacity='.2'">`
      : `<div style="width:36px;height:36px;border-radius:8px;background:var(--surface2);border:1.5px dashed var(--border);display:flex;align-items:center;justify-content:center;font-size:20px">${meta.svgIcon||''}</div>`;

    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:10px">
      <!-- Ícone clicável -->
      <div onclick="openAcCatalogIconEdit('${tipo}',${idx})" title="Editar ícone" style="cursor:pointer;flex-shrink:0;position:relative;border-radius:8px;overflow:hidden">
        ${iconEl}
        <div style="position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .15s;border-radius:8px" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0'">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3L5 14H2v-3L11 2z" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </div>
      <!-- Nome editável inline -->
      <input value="${item.nome}" style="flex:1;background:transparent;border:none;outline:none;font-size:13px;font-weight:600;color:var(--text);font-family:inherit;padding:0;min-width:0"
        onblur="acCatalogRename('${tipo}',${idx},this.value)"
        onkeydown="if(event.key==='Enter')this.blur()"
        title="Clique para renomear">
      <!-- Ações -->
      <div style="display:flex;gap:2px;flex-shrink:0">
        <button onclick="openAcCatalogIconEdit('${tipo}',${idx})" title="Editar ícone" style="width:30px;height:30px;border:none;background:transparent;cursor:pointer;color:var(--muted);border-radius:6px;display:flex;align-items:center;justify-content:center" onmouseenter="this.style.background='var(--surface)'" onmouseleave="this.style.background='transparent'">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3L5 14H2v-3L11 2z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button onclick="acCatalogMoveItem('${tipo}',${idx},-1)" title="Mover para cima" ${idx===0?'disabled style="opacity:.25"':''} style="width:30px;height:30px;border:none;background:transparent;cursor:pointer;color:var(--muted);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:13px" onmouseenter="this.style.background='var(--surface)'" onmouseleave="this.style.background='transparent'">↑</button>
        <button onclick="acCatalogMoveItem('${tipo}',${idx},1)" title="Mover para baixo" ${idx===list.length-1?'disabled style="opacity:.25"':''} style="width:30px;height:30px;border:none;background:transparent;cursor:pointer;color:var(--muted);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:13px" onmouseenter="this.style.background='var(--surface)'" onmouseleave="this.style.background='transparent'">↓</button>
        <button onclick="acCatalogDeleteItem('${tipo}',${idx})" title="Excluir" style="width:30px;height:30px;border:none;background:transparent;cursor:pointer;color:#ef4444;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:15px" onmouseenter="this.style.background='rgba(239,68,68,.08)'" onmouseleave="this.style.background='transparent'">✕</button>
      </div>
    </div>`;
  }).join('');
}

// ── Renomeia item do catálogo ────────────────────────
function acCatalogRename(tipo, idx, novoNome) {
  const nome = (novoNome || '').trim();
  if (!nome) return;
  const item = (_AC_CATALOGS[tipo] || [])[idx];
  if (!item) return;
  item.nome = nome;
  _acCatalogsSave();
}

// ── Move item no catálogo ────────────────────────────
function acCatalogMoveItem(tipo, idx, dir) {
  const list = _AC_CATALOGS[tipo];
  if (!list) return;
  const ni = idx + dir;
  if (ni < 0 || ni >= list.length) return;
  [list[idx], list[ni]] = [list[ni], list[idx]];
  _acCatalogsSave();
  _renderAcCatalogManagerList(tipo);
}

// ── Exclui item do catálogo ──────────────────────────
function acCatalogDeleteItem(tipo, idx) {
  const list = _AC_CATALOGS[tipo];
  if (!list) return;
  const nome = list[idx]?.nome || 'item';
  if (!confirm(`Excluir "${nome}" do catálogo de ${_AC_CATALOG_META[tipo]?.label}?`)) return;
  list.splice(idx, 1);
  _acCatalogsSave().then(() => sbToast('ok', `"${nome}" excluído do catálogo`));
  _renderAcCatalogManagerList(tipo);
  renderAcCatalogCards();
}

// ── Abre formulário para adicionar item ao catálogo ──
function openAcCatalogAddItem(tipo) {
  const meta = _AC_CATALOG_META[tipo];
  document.getElementById('ac-catalog-add-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'ac-catalog-add-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:9995;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)';
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  modal.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--surface);border-radius:16px;padding:24px;width:100%;max-width:400px;box-shadow:0 20px 60px rgba(0,0,0,.5)">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
      <span style="font-size:22px">${meta.svgIcon||''}</span>
      <div>
        <div style="font-size:14px;font-weight:800">Novo item — ${meta.label}</div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:2px">Será adicionado ao catálogo global</div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:14px">
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">Nome</label>
        <input id="ac-cat-add-nome" class="form-input" placeholder="Ex: Espetinho, Defumado, Piquenique..." style="width:100%" autofocus>
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">Link do ícone <span style="font-weight:400;text-transform:none">(opcional)</span></label>
        <input id="ac-cat-add-icon" class="form-input" type="url" placeholder="https://..." style="width:100%" oninput="acCatAddIconPreview(this.value)">
        <div style="margin-top:8px;display:flex;align-items:center;gap:10px">
          <div id="ac-cat-add-preview" style="width:40px;height:40px;border-radius:8px;border:1.5px dashed var(--border);background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">${meta.svgIcon||''}</div>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:6px 12px">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 11V3M4 7l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 13h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            Upload
            <input type="file" accept="image/*" style="display:none" onchange="acCatAddIconUpload(this)">
          </label>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:22px">
      <button onclick="document.getElementById('ac-catalog-add-modal').remove()" style="flex:1;padding:11px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Cancelar</button>
      <button onclick="acCatalogConfirmAdd('${tipo}')" style="flex:1;padding:11px;background:var(--accent);border:none;border-radius:10px;color:#000;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-right:5px"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Adicionar
      </button>
    </div>
  </div>`;

  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('ac-cat-add-nome')?.focus(), 80);
}

// Preview live do ícone no formulário de adição
function acCatAddIconPreview(url) {
  const prev = document.getElementById('ac-cat-add-preview');
  if (!prev) return;
  if (url) {
    prev.innerHTML = `<img src="${url}" style="width:36px;height:36px;object-fit:contain;border-radius:6px" onerror="this.parentElement.textContent='❌'">`;
  } else {
    const tipo = document.getElementById('ac-catalog-add-modal')?.querySelector('button[onclick*="acCatalogConfirmAdd"]')?.getAttribute('onclick')?.match(/'(\w+)'/)?.[1] || '';
    prev.innerHTML = (_AC_CATALOG_META[tipo]?.emoji) || '📌';
    prev.style.fontSize = '22px';
  }
}

// Upload no formulário de adição
function acCatAddIconUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { sbToast('err', 'Máximo 2MB'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const inp = document.getElementById('ac-cat-add-icon');
    if (inp) inp.value = e.target.result;
    acCatAddIconPreview(e.target.result);
  };
  reader.readAsDataURL(file);
}

// Confirma adição de item ao catálogo
async function acCatalogConfirmAdd(tipo) {
  const nome = (document.getElementById('ac-cat-add-nome')?.value || '').trim();
  if (!nome) { sbToast('err', 'Informe o nome do item'); return; }
  const icon = (document.getElementById('ac-cat-add-icon')?.value || '').trim() || null;
  const id   = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_');

  const list = _AC_CATALOGS[tipo];
  if (!list) return;
  if (list.find(i => i.id === id)) { sbToast('err', `"${nome}" já existe no catálogo`); return; }
  list.push({ id, nome, icon });

  sbLoading(true);
  await _acCatalogsSave();
  sbLoading(false);

  document.getElementById('ac-catalog-add-modal')?.remove();
  _renderAcCatalogManagerList(tipo);
  renderAcCatalogCards();
  sbToast('ok', `"${nome}" adicionado ao catálogo!`);
}

// ── Editor de ícone direto pelo gerenciador de catálogo ──
let _acCatalogIconTipo = null, _acCatalogIconIdx = null;

function openAcCatalogIconEdit(tipo, idx) {
  _acCatalogIconTipo = tipo;
  _acCatalogIconIdx  = idx;
  const item = (_AC_CATALOGS[tipo] || [])[idx];
  if (!item) return;
  const meta = _AC_CATALOG_META[tipo];

  document.getElementById('ac-catalog-icon-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'ac-catalog-icon-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9998;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(5px)';
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  const currentIcon = item.icon || '';
  const previewSrc  = currentIcon ? `<img id="ac-cat-icon-prev-img" src="${currentIcon}" style="width:80px;height:80px;object-fit:contain;border-radius:14px;border:2px solid var(--accent)" onerror="this.style.opacity='.2'">` : '';
  const emptyStyle  = currentIcon ? 'display:none' : 'display:flex';

  modal.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--surface);border-radius:20px 20px 0 0;padding:24px 20px 32px;width:100%;max-width:480px">
    <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 18px"></div>
    <!-- Header -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <div style="font-size:15px;font-weight:800">${meta.svgIcon||''} Editar ícone</div>
        <div style="font-size:12px;color:var(--muted);margin-top:3px">
          <span style="font-weight:600;color:${meta.text}">${item.nome}</span> — ${meta.label}
        </div>
      </div>
      <button onclick="document.getElementById('ac-catalog-icon-modal').remove()" style="border:none;background:var(--surface2);border-radius:50%;width:32px;height:32px;cursor:pointer;color:var(--text);font-size:16px;display:flex;align-items:center;justify-content:center">✕</button>
    </div>
    <!-- Preview atual -->
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px;margin-bottom:20px">
      <div style="font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;align-self:flex-start">Ícone atual</div>
      <div style="position:relative;width:80px;height:80px">
        ${previewSrc}
        <div id="ac-cat-icon-prev-empty" style="${emptyStyle};width:80px;height:80px;border-radius:14px;border:2px dashed var(--border);align-items:center;justify-content:center;font-size:34px">${meta.svgIcon||''}</div>
      </div>
      ${currentIcon ? `<button onclick="acCatalogIconRemove()" style="padding:5px 16px;border:1px solid #ef4444;background:rgba(239,68,68,.08);color:#ef4444;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit">✕ Remover ícone</button>` : ''}
    </div>
    <!-- Upload -->
    <div style="margin-bottom:14px">
      <div style="font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Upload de imagem</div>
      <label style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--surface2);border:1.5px dashed var(--border);border-radius:10px;cursor:pointer" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M8 11V3M4 7l4-4 4 4" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 13h12" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"/></svg>
        <div>
          <div style="font-size:13px;font-weight:600">Clique para selecionar</div>
          <div style="font-size:11px;color:var(--muted)">PNG, JPG, SVG, WEBP (máx 2MB)</div>
        </div>
        <input type="file" accept="image/*" style="display:none" onchange="acCatalogIconUpload(this)">
      </label>
    </div>
    <!-- Link -->
    <div style="margin-bottom:20px">
      <div style="font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Ou cole um link de imagem</div>
      <div style="display:flex;gap:8px">
        <input id="ac-catalog-icon-url" type="url" placeholder="https://..." value="${currentIcon}" style="flex:1;padding:10px 12px;background:var(--surface2);border:1.5px solid var(--border);border-radius:10px;color:var(--text);font-size:13px;outline:none;font-family:inherit" oninput="acCatalogIconPreviewUrl(this.value)" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">
        <button onclick="acCatalogIconApplyUrl()" style="padding:10px 14px;background:var(--surface2);border:1.5px solid var(--border);border-radius:10px;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Ver</button>
      </div>
    </div>
    <!-- Salvar -->
    <button onclick="acCatalogIconSave()" style="width:100%;padding:13px;background:var(--accent);border:none;border-radius:12px;color:#000;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit">✓ Salvar ícone</button>
  </div>`;

  document.body.appendChild(modal);
}

function acCatalogIconPreviewUrl(url) {
  const img   = document.getElementById('ac-cat-icon-prev-img');
  const empty = document.getElementById('ac-cat-icon-prev-empty');
  if (!url) {
    if (img) img.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (!img) {
    const wrap = document.querySelector('#ac-catalog-icon-modal [style*="position:relative"]');
    if (!wrap) return;
    const newImg = document.createElement('img');
    newImg.id = 'ac-cat-icon-prev-img';
    newImg.style.cssText = 'width:80px;height:80px;object-fit:contain;border-radius:14px;border:2px solid var(--accent)';
    newImg.onerror = () => { newImg.style.display='none'; if(empty) empty.style.display='flex'; };
    wrap.insertBefore(newImg, wrap.firstChild);
  }
  const previewImg = document.getElementById('ac-cat-icon-prev-img');
  if (previewImg) { previewImg.src = url; previewImg.style.display='block'; if(empty) empty.style.display='none'; }
}

function acCatalogIconApplyUrl() {
  const val = (document.getElementById('ac-catalog-icon-url')?.value || '').trim();
  if (!val) { sbToast('err', 'Cole um link válido'); return; }
  acCatalogIconPreviewUrl(val);
}

function acCatalogIconUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { sbToast('err', 'Máximo 2MB'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const inp = document.getElementById('ac-catalog-icon-url');
    if (inp) inp.value = e.target.result;
    acCatalogIconPreviewUrl(e.target.result);
  };
  reader.readAsDataURL(file);
}

async function acCatalogIconRemove() {
  const list = _AC_CATALOGS[_acCatalogIconTipo];
  const item = list?.[_acCatalogIconIdx];
  if (!item) return;
  item.icon = null;
  sbLoading(true);
  await _acCatalogsSave();
  sbLoading(false);
  _renderAcCatalogManagerList(_acCatalogIconTipo);
  renderAcCatalogCards();
  document.getElementById('ac-catalog-icon-modal')?.remove();
  sbToast('ok', 'Ícone removido');
}

async function acCatalogIconSave() {
  const url  = (document.getElementById('ac-catalog-icon-url')?.value || '').trim();
  const list = _AC_CATALOGS[_acCatalogIconTipo];
  const item = list?.[_acCatalogIconIdx];
  if (!item) return;
  item.icon = url || null;
  sbLoading(true);
  await _acCatalogsSave();
  sbLoading(false);
  _renderAcCatalogManagerList(_acCatalogIconTipo);
  renderAcCatalogCards();
  document.getElementById('ac-catalog-icon-modal')?.remove();
  sbToast('ok', url ? 'Ícone atualizado!' : 'Ícone removido');
}

// ── Detecta segmento do tenant e mostra campos açougue ──
let _gestorSegmento = 'restaurante';
// ── Aplica opções de tipo corretas em ambos os selects ──
function _applySegmentoOptions(segmento) {
  const isAcougue = segmento === 'acougue';

  // Opções por segmento
  const opts = isAcougue
    ? [
        { value: 'normal', label: 'Normal' },
        { value: 'kg',     label: 'Por Kg 🥩' },
        { value: 'kit',    label: 'Kit / Combo 📦' },
      ]
    : [
        { value: 'normal', label: 'Normal' },
        { value: 'pizza',  label: 'Pizza (sabor)' },
      ];

  ['new-item-type', 'edit-item-type'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value; // preserva seleção atual
    sel.innerHTML = opts.map(o =>
      `<option value="${o.value}"${cur === o.value ? ' selected' : ''}>${o.label}</option>`
    ).join('');
    // Se a seleção atual não existe mais, vai para 'normal'
    if (!opts.find(o => o.value === cur)) {
      sel.value = 'normal';
      togglePizzaOptions(id === 'new-item-type' ? 'new' : 'edit');
    }
  });
}

async function detectSegmento() {
  // 1. Aplica imediatamente usando cache do sessionStorage (evita flash)
  const cached = sessionStorage.getItem('_ef_segmento');
  if (cached) {
    _gestorSegmento = cached;
    _applySegmentoOptions(cached);
  }

  // 2. Busca da API e atualiza
  try {
    const r = await fetch('/api/tenant-segmento', { headers: { 'x-tenant-id': window._tenantId || '' } });
    if (r.ok) {
      const d = await r.json();
      _gestorSegmento = d.segmento || 'restaurante';
      sessionStorage.setItem('_ef_segmento', _gestorSegmento);
      _applySegmentoOptions(_gestorSegmento);
    }
  } catch {}

  // 3. Painel de catálogos açougue
  const panel = document.getElementById('acougue-catalog-panel');
  if (panel && _gestorSegmento === 'acougue') {
    panel.style.display = '';
    await _acCatalogsLoad();
    renderAcCatalogCards();
  } else if (panel) {
    panel.style.display = 'none';
  }
}

function renderGestor(){
  // Chama detectSegmento uma vez
  if (!renderGestor._segChecked) { renderGestor._segChecked = true; detectSegmento(); }
  try {
    const cl=document.getElementById('cat-list');
    if(!cl) return;
    if(!categories.length){
      cl.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:13px">Nenhuma categoria ainda.<br>Clique em <strong style="color:var(--accent)">Nova categoria</strong> para começar.</div>';
      return;
    }
    cl.innerHTML=categories.map((cat,idx)=>{
      const catItems=items.filter(i=>i.catKey===cat.name||i.cat===cat.name);
      return `
      ${cat.promo?'<div class="cat-promo-banner">promo</div>':''}
      <div class="cat-row" draggable="true" data-cat-id="${cat.id}"
           ondragstart="catDragStart(event,${cat.id})"
           ondragover="catDragOver(event)"
           ondrop="catDrop(event,${cat.id})"
           ondragend="catDragEnd(event)">
        <div class="cat-head" onclick="toggleCat(${cat.id})">
          <span class="cat-drag" onmousedown="event.stopPropagation()" title="Arrastar para reordenar">⠿</span>
          <div>
            <div class="cat-name">${cat.label}</div>
            <span class="cat-badge">${catItems.length} ite${catItems.length===1?'m':'ns'}</span>
          </div>
          <div class="cat-actions">
            <div class="sw"><select onclick="event.stopPropagation()" style="font-size:11.5px;padding:4px 22px 4px 9px" onchange="handleCatAction(${cat.id},this.value)"><option value="">Ações ▾</option><option value="edit">Editar</option><option value="duplicate">Duplicar</option><option value="pause">Pausar</option><option value="delete">Excluir</option></select></div>
            <div class="cat-toggle${cat.open?' open':''}"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          </div>
        </div>
        ${cat.open?`<div class="cat-items">
          ${catItems.map(item=>`
            <div class="cat-item-row" data-id="${item.id}" draggable="true" ondragstart="itemDragStart(event,${item.id})" ondragover="itemDragOver(event)" ondrop="itemDrop(event,${item.id})" ondragend="itemDragEnd(event)" onclick="openEditItem(+this.dataset.id)">
              <span class="cat-drag" style="cursor:grab;padding:0 6px 0 2px;opacity:.35;flex-shrink:0;font-size:16px;align-self:center" onmousedown="event.stopPropagation()" title="Arrastar para reordenar">⠿</span>
              <div class="cat-item-thumb">${item.imageUrl
                ? `<img src="${item.imageUrl}" style="width:36px;height:36px;object-fit:cover;border-radius:6px;display:block">`
                : `<svg viewBox="0 0 24 24" fill="none" width="18" height="18" style="opacity:.35"><path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" stroke="currentColor" stroke-width="1.5"/><path d="M3 16l5-5 3 3 3-4 4 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" opacity=".5"/></svg>`
              }</div>
              <div style="flex:1;min-width:0">
                <div class="cat-item-name">${item.name}${item.promo?' <span class="ptag">promo</span>':''}${item.itemType==='pizza'?' <span style="font-size:9px;background:rgba(245,158,11,.15);color:var(--accent3);border-radius:4px;padding:1px 4px;font-weight:700;margin-left:2px">🍕</span>':''}${item.itemType==='kg'?' <span style="font-size:9px;background:rgba(34,197,94,.15);color:#16a34a;border-radius:4px;padding:1px 4px;font-weight:700;margin-left:2px">KG</span>':''}</div>
                <div class="cat-item-price">R$ ${item.price.toFixed(2).replace('.',',')}${item.itemType==='kg'?'<span style="font-size:10px;color:var(--muted)">/kg</span>':''} · ${item.status==='active'?'<span style="color:var(--success)">Disponível</span>':item.status==='esgotado'?'<span style="color:var(--danger)">Esgotado</span>':'<span style="color:var(--accent3)">Pausado</span>'}</div>
              </div>
              <div style="display:flex;gap:4px;flex-shrink:0;align-items:center">
                <button class="btn bg" style="font-size:10.5px;padding:3px 8px" data-id="${item.id}" onclick="event.stopPropagation();duplicateItem(+this.dataset.id)" title="Duplicar item">⎘</button>
                <button class="stbadge-mini ${scClass(item.status)}" data-id="${item.id}" onclick="event.stopPropagation();quickToggleStatus(+this.dataset.id,this)" title="Alterar disponibilidade">${_statusIcon(item.status)}</button>
                <button class="btn bg" style="font-size:10.5px;padding:3px 8px" data-id="${item.id}" onclick="event.stopPropagation();openEditItem(+this.dataset.id)">Editar</button>
              </div>
            </div>
          `).join('')}
          <div class="cat-add" data-cat="${cat.name.replace(/"/g,'&quot;')}" onclick="openAddItemModal(this.dataset.cat)">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
            Adicionar Item
          </div>
        </div>`:''}
      </div>`;
    }).join('');
  } catch(e) { console.error('renderGestor error:', e); }
}

function toggleCat(id){
  const cat=categories.find(c=>c.id===id);
  if(cat) cat.open=!cat.open;
  renderGestor();
}

function handleCatAction(id, action) {
  if (!action) return;
  if (action === 'edit') {
    const cat = categories.find(c => c.id === id);
    if (!cat) return;
    document.getElementById('edit-cat-id').value   = id;
    document.getElementById('edit-cat-name').value = cat.label;
    document.getElementById('edit-cat-type').value = cat.type || 'Itens principais';
    openModal('modal-edit-cat');
  } else if (action === 'duplicate') {
    duplicateCategory(id);
  } else if (action === 'delete') {
    deleteCatById(id);
  } else if (action === 'pause') {
    sbToast('ok', 'Categoria pausada!');
  }
}

// ── Duplicar categoria (cria cópia com todos os itens) ────
async function duplicateCategory(id) {
  const cat = categories.find(c => c.id === id);
  if (!cat) return;
  const novoLabel = cat.label + ' (cópia)';
  const novoName  = cat.name + '_copia_' + Date.now().toString().slice(-4);
  sbLoading(true);
  try {
    // 1. Cria nova categoria
    const { data: newCat, error: catErr } = await sb.from('categories').insert({
      name:       novoName,
      label:      novoLabel,
      type:       cat.type  || 'Itens principais',
      promo:      false,
      sort_order: categories.length + 1
    }).select().single();
    if (catErr || !newCat) throw new Error(catErr?.message || 'Erro ao criar categoria');

    categories.push({ id: newCat.id, name: newCat.name, label: newCat.label, type: newCat.type, promo: false, open: false });

    // 2. Duplica todos os itens desta categoria
    const catItems = items.filter(i => i.catKey === cat.name || i.cat === cat.name);
    let itensCriados = 0;
    for (const it of catItems) {
      const { data: newItem, error: itemErr } = await sb.from('menu_items').insert({
        emoji:        it.emoji        || '🍽️',
        name:         it.name,
        description:  it.desc         || '',
        price:        it.price        || 0,
        price_old:    it.priceOld     || null,
        cat:          newCat.label,
        cat_key:      newCat.name,
        item_type:    it.itemType     || 'normal',
        allow_half:   it.allowHalf    || false,
        max_flavors:  it.maxFlavors   || 1,
        promo:        it.promo        || false,
        destaque:     it.destaque     || false,
        status:       it.status       || 'active',
        days:         it.days         || [1,1,1,1,1,1,1],
        ingredients:  it.ingredients  || [],
        custom_groups: it.customGroups || [],
        image_url:    it.imageUrl     || null
      }).select().single();
      if (!itemErr && newItem) { items.push(mapItem(newItem)); itensCriados++; }
    }

    renderGestor(); renderTable(); populateCatSelects();
    sbToast('ok', `"${novoLabel}" criada com ${itensCriados} item(s) duplicado(s)!`);
  } catch(e) {
    sbToast('err', 'Erro ao duplicar categoria: ' + e.message);
  } finally {
    sbLoading(false);
  }
}

// ── Duplicar item ─────────────────────────────────────────
async function duplicateItem(id) {
  const it = items.find(i => i.id === id);
  if (!it) return;
  sbLoading(true);
  try {
    const { data: newItem, error } = await sb.from('menu_items').insert({
      emoji:        it.emoji        || '🍽️',
      name:         it.name + ' (cópia)',
      description:  it.desc         || '',
      price:        it.price        || 0,
      price_old:    it.priceOld     || null,
      cat:          it.cat,
      cat_key:      it.catKey,
      item_type:    it.itemType     || 'normal',
      allow_half:   it.allowHalf    || false,
      max_flavors:  it.maxFlavors   || 1,
      promo:        false,
      destaque:     false,
      status:       'active',
      days:         it.days         || [1,1,1,1,1,1,1],
      ingredients:  it.ingredients  || [],
      custom_groups: it.customGroups || [],
      image_url:    it.imageUrl     || null
    }).select().single();
    if (error || !newItem) throw new Error(error?.message || 'Resposta inválida');
    items.push(mapItem(newItem));
    renderGestor(); renderTable();
    sbToast('ok', `"${it.name}" duplicado!`);
  } catch(e) {
    sbToast('err', 'Erro ao duplicar item: ' + e.message);
  } finally {
    sbLoading(false);
  }
}

async function saveEditCategory() {
  const id   = parseInt(document.getElementById('edit-cat-id').value);
  const name = document.getElementById('edit-cat-name').value.trim();
  const type = document.getElementById('edit-cat-type').value;
  if (!name) { sbToast('err','Informe o nome'); return; }
  sbLoading(true);
  // Só atualiza 'label' e 'type' — nunca muda 'name' (chave interna usada pelo catKey dos itens)
  const { error } = await sb.from('categories').update({
    label: name, type
  }).eq('id', id);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao salvar'); return; }
  const cat = categories.find(c => c.id === id);
  if (cat) { cat.label = name; cat.type = type; }
  closeModal('modal-edit-cat');
  renderGestor();
  populateCatSelects();
  sbToast('ok', 'Categoria atualizada!');
}

async function deleteCatById(id) {
  const catId = id || parseInt(document.getElementById('edit-cat-id').value);
  if (!await showConfirmDialog('Excluir categoria?', 'Os itens desta categoria não serão apagados.')) return;
  sbLoading(true);
  const { error } = await sb.from('categories').delete().eq('id', catId);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao excluir'); return; }
  categories = categories.filter(c => c.id !== catId);
  closeModal('modal-edit-cat');
  renderGestor();
  populateCatSelects();
  sbToast('ok', 'Categoria excluída!');
}

async function addCategory() {
  const nameEl = document.getElementById('cat-name-input');
  const typeEl = document.getElementById('cat-type-input');
  const name   = nameEl ? nameEl.value.trim() : '';
  const type   = typeEl ? typeEl.value : 'Itens principais';

  console.log('[ADD-CAT] chamado | nome:', name, '| tipo:', type);

  if (!name) { sbToast('err', 'Informe o nome da categoria'); return; }

  const duplicada = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (duplicada) { sbToast('err', `Já existe uma categoria chamada "${name}"`); return; }

  const payload = {
    name:       name.toLowerCase().replace(/\s+/g, '_'),
    label:      name,
    type:       type || 'Itens principais',
    promo:      false,
    sort_order: categories.length + 1
  };
  console.log('[ADD-CAT] payload:', payload);

  sbLoading(true);
  const { data, error } = await sb.from('categories').insert(payload).select().single();
  sbLoading(false);

  console.log('[ADD-CAT] resposta | data:', data, '| error:', error);

  if (error || !data) {
    sbToast('err', 'Erro ao criar categoria: ' + (error?.message || 'resposta inválida'));
    console.error('[ADD-CAT] ❌', error);
    return;
  }

  console.log('[ADD-CAT] ✅ categoria criada id:', data.id);
  categories.push({
    id:    data.id,
    name:  data.name,
    label: data.label || name,
    type:  data.type  || type,
    promo: false,
    open:  false
  });

  closeModal('modal-add-cat');
  if (nameEl) nameEl.value = '';
  renderGestor();
  populateCatSelects();
  sbToast('ok', `Categoria "${name}" criada!`);
}

function handleGestorAction(val){
  document.getElementById('gestor-actions').value='';
  if(val==='pdv') nav('pdv');
  else if(val==='edicao') nav('edicao');
  else if(val==='imagens') nav('imagens');
}

// ─────────────────────────────────────────
// TABLE — EDIÇÃO EM MASSA
// ─────────────────────────────────────────
function scLabel(s){return s==='active'?'Disponível':s==='esgotado'?'Esgotado':'Pausado'}
function scClass(s){return s==='active'?'sta':s==='esgotado'?'ste':'stp'}

function getFiltered(){
  return items.filter(i=>{
    const q=filters.search.toLowerCase();
    if(q&&!i.name.toLowerCase().includes(q)&&!i.cat.toLowerCase().includes(q)) return false;
    if(filters.cat&&i.catKey!==filters.cat) return false;
    if(filters.status&&i.status!==filters.status) return false;
    return true;
  });
}

function renderTable(){
  const data=getFiltered();
  const rc=document.getElementById('row-count');
  if(rc) rc.textContent=data.length+' registro'+(data.length!==1?'s':'');
  const tb=document.getElementById('table-body');
  if(!tb) return;
  tb.innerHTML=data.map(item=>`
    <tr>
      <td><input type="checkbox" class="cb row-cb" onchange="onRowCheck()"></td>
      <td><div class="icell"><div class="ithumb">${item.emoji}</div><div><div class="iname">${item.name}${item.promo?'<span class="ptag"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 2v4h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 9h6M5 12h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg> Promo</span>':''}</div><div class="icat">${item.cat}</div></div></div></td>
      <td><div>${item.priceOld?`<div style="font-size:10.5px;color:var(--muted);text-decoration:line-through">R$ ${item.priceOld.toFixed(2).replace('.',',')}</div>`:''}<input class="pinput" value="R$ ${item.price.toFixed(2).replace('.',',')}" onchange="updatePrice(${item.id},this.value)"></div></td>
      <td style="color:var(--muted);font-size:12px">${item.cat}</td>
      <td><div class="dps">${item.days.map((on,i)=>`<div class="dp${on?' on':''}" onclick="toggleDay(${item.id},${i},this)">${DAYS[i]}</div>`).join('')}</div></td>
      <td><div class="stbadge ${scClass(item.status)}" onclick="cycleStatus(${item.id},this)"><div class="stdot"></div>&nbsp;${scLabel(item.status)}</div></td>
      <td><button class="btn bg" style="font-size:10.5px;padding:3px 8px" onclick="openEditItem(${item.id})">Editar</button></td>
    </tr>`).join('');
}

function onRowCheck(){
  const checked=document.querySelectorAll('.row-cb:checked').length;
  const btn=document.getElementById('bulk-btn');
  if(btn) btn.style.display=checked>0?'inline-flex':'none';
}

function toggleAll(cb){
  document.querySelectorAll('.row-cb').forEach(c=>c.checked=cb.checked);
  onRowCheck();
}

function filterCat(v){filters.cat=v;renderTable();}
function filterSt(v){filters.status=v;renderTable();}
function filterSearch(v){filters.search=v;renderTable();}
async function saveAll() {
  sbLoading(true);
  const updates = items.map(it =>
    sb.from('menu_items').update({
      price: it.price, status: it.status, days: it.days
    }).eq('id', it.id)
  );
  await Promise.all(updates);
  sbLoading(false);
  showToast(_ICON_SAV,'Alterações salvas no banco!');
}

function updatePrice(id, val) {
  const n = parseFloat(val.replace('R$','').replace(',','.').trim());
  const it = items.find(i => i.id === id);
  if (it && !isNaN(n)) { it.price = n; sb.from('menu_items').update({price:n}).eq('id',id); }
}

function toggleDay(id,dayIdx,el){
  el.classList.toggle('on');
  const it=items.find(i=>i.id===id);
  if(it) it.days[dayIdx]=el.classList.contains('on')?1:0;
}

const _SC = [
  { key:'active',   cls:'sta', label:'Disponível' },
  { key:'esgotado', cls:'ste', label:'Esgotado'   },
  { key:'pausado',  cls:'stp', label:'Pausado'    },
];
function _statusIcon(status) {
  if (status === 'active')   return '<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M6 5.5l5 2.5-5 2.5V5.5z" fill="currentColor"/></svg>';
  if (status === 'esgotado') return '<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  return '<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M6 5h1.5v6H6zM8.5 5H10v6H8.5z" fill="currentColor"/></svg>';
}
async function quickToggleStatus(id, el) {
  const it = items.find(i => i.id === id);
  if (!it) return;
  const cur  = _SC.findIndex(s => s.key === it.status);
  const next = _SC[(cur + 1) % _SC.length];
  it.status  = next.key;
  _SC.forEach(s => el.classList.remove(s.cls));
  el.classList.add(next.cls);
  el.innerHTML = _statusIcon(next.key);
  el.title = next.label;
  const row = el.closest('.cat-item-row');
  if (row) {
    const priceEl = row.querySelector('.cat-item-price');
    if (priceEl) priceEl.innerHTML = priceEl.innerHTML.replace(
      /<span style="color:var\(--(?:success|danger|accent3)\)">[^<]+<\/span>/,
      next.key==='active'   ? '<span style="color:var(--success)">Disponível</span>'  :
      next.key==='esgotado' ? '<span style="color:var(--danger)">Esgotado</span>'     :
                              '<span style="color:var(--accent3)">Pausado</span>'
    );
  }
  try {
    await sb.from('menu_items').update({ status: next.key }).eq('id', id);
    sbToast('ok', `"${it.name}" → ${next.label}`);
  } catch(e) {
    sbToast('err', 'Erro ao salvar status');
    it.status = _SC[cur].key;
  }
  renderTable();
}
function cycleStatus(id, el) {
  const it = items.find(i => i.id === id);
  if (!it) return;
  const cur  = _SC.findIndex(s => s.key === it.status);
  const next = _SC[(cur + 1) % _SC.length];
  it.status  = next.key;
  _SC.forEach(s => el.classList.remove(s.cls));
  el.classList.add(next.cls);
  el.innerHTML = `<div class="stdot"></div>&nbsp;${next.label}`;
  sb.from('menu_items').update({ status: next.key }).eq('id', id);
}

function setPizzaMax(ctx, val, el) {
  document.querySelectorAll(`#${ctx}-pizza-options .pz-max-btn`).forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  document.getElementById(`${ctx}-max-flavors`).value = val;
  // Auto-sync meio-a-meio: if max >= 2, suggest enabling it
}

function togglePizzaOptions(ctx) {
  const typeEl    = document.getElementById(ctx+'-item-type');
  const pizzaBox  = document.getElementById(ctx+'-pizza-options');
  const acougueBox= document.getElementById(ctx+'-acougue-options');
  const kitBox    = document.getElementById(ctx+'-kit-options');
  if (!typeEl) return;
  const val = typeEl.value;

  if (pizzaBox)   pizzaBox.style.display = val === 'pizza' ? '' : 'none';
  if (kitBox)     kitBox.style.display   = val === 'kit'   ? '' : 'none';

  // Abre o painel açougue para kg E kit
  const isAcougue = val === 'kg' || val === 'kit';
  if (acougueBox) acougueBox.style.display = isAcougue ? '' : 'none';

  // Campos exclusivos de kg (cortes, pesos, porção)
  const kgOnly = document.getElementById(ctx+'-kg-only-fields');
  if (kgOnly) kgOnly.style.display = val === 'kg' ? '' : 'none';

  // Header contextual
  const header = document.getElementById(ctx+'-acougue-header');
  if (header) {
    header.textContent = val === 'kit'
      ? '📦 Informações do Kit'
      : '🥩 Opções do Açougue';
  }
}

// ── Lê cortes/preparos selecionados ──────────────────
// ── Preview ao vivo do preço da porção ───────────────
function updatePorcaoPreview(ctx) {
  const gramas  = parseInt(document.getElementById(`${ctx}-porcao-ref`)?.value) || 0;
  const priceEl = document.getElementById(`${ctx}-price`);
  const preview = document.getElementById(`${ctx}-porcao-preview`);
  if (!preview) return;
  const priceKg = parseFloat(priceEl?.value) || 0;
  if (gramas > 0 && priceKg > 0) {
    const val = (priceKg * gramas / 1000).toFixed(2).replace('.', ',');
    preview.textContent = `≈ R$ ${val} / ${gramas}g`;
    preview.style.display = 'inline-block';
  } else {
    preview.style.display = 'none';
  }
}

function readAcougueOptions(ctx) {
  const cortesList        = _acListState[`${ctx}-cortes`]        || [];
  const preparosList      = _acListState[`${ctx}-preparos`]      || [];
  const ocasiaoList       = _acListState[`${ctx}-ocasiao`]       || [];
  const armazenamentoList = _acListState[`${ctx}-armazenamento`] || [];
  const pesosRaw          = document.getElementById(`${ctx}-pesos`)?.value || '';
  const pesos             = pesosRaw.split(',').map(s => parseInt(s.trim())).filter(n => n > 0);
  const porcaoRef         = parseInt(document.getElementById(`${ctx}-porcao-ref`)?.value) || 0;
  return {
    cortes:              cortesList.map(i => i.id),
    preparos:            preparosList.map(i => i.id),
    _cortesList:         cortesList,
    _preparosList:       preparosList,
    _ocasiaoList:        ocasiaoList,
    _armazenamentoList:  armazenamentoList,
    pesos,
    porcaoRef
  };
}

// ── Preenche cortes/preparos no edit ─────────────────
function fillAcougueOptions(ctx, customGroups) {
  // Limpa todas as listas
  _acListState[`${ctx}-cortes`]          = [];
  _acListState[`${ctx}-preparos`]        = [];
  _acListState[`${ctx}-ocasiao`]         = [];
  _acListState[`${ctx}-armazenamento`]   = [];

  if (!Array.isArray(customGroups)) {
    ['cortes','preparos','ocasiao','armazenamento'].forEach(t => renderAcList(ctx, t));
    return;
  }
  const cg = typeof customGroups[0] === 'string' ? [] : customGroups;
  const cortesGroup        = cg.find(g => g.tipo === 'cortes');
  const preparosGroup      = cg.find(g => g.tipo === 'preparos');
  const pesosGroup         = cg.find(g => g.tipo === 'pesos');
  const porcaoGroup        = cg.find(g => g.tipo === 'porcao_ref');
  const ocasiaoGroup       = cg.find(g => g.tipo === 'ocasiao');
  const armazenamentoGroup = cg.find(g => g.tipo === 'armazenamento');

  const _resolveList = (group, catalog, isCortes) => {
    if (!group?.opcoes) return [];
    return group.opcoes.map(o => {
      const id = o.id || (o.nome||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_');
      const catalogItem = catalog.find(c => c.id === id);
      const entry = {
        id,
        nome: o.nome || catalogItem?.nome || (id.charAt(0).toUpperCase()+id.slice(1)),
        icon: o.icon || catalogItem?.icon || null
      };
      if (isCortes && o.porcoes) entry.porcoes = o.porcoes;
      return entry;
    });
  };

  _acListState[`${ctx}-cortes`]         = _resolveList(cortesGroup,        _AC_CORTES_CATALOG,   true);
  _acListState[`${ctx}-preparos`]       = _resolveList(preparosGroup,      _AC_PREPAROS_CATALOG, false);
  _acListState[`${ctx}-ocasiao`]        = _resolveList(ocasiaoGroup,       _AC_OCASIAO_CATALOG,  false);
  _acListState[`${ctx}-armazenamento`]  = _resolveList(armazenamentoGroup, _AC_ARMAZENAMENTO_CATALOG, false);

  ['cortes','preparos','ocasiao','armazenamento'].forEach(t => renderAcList(ctx, t));

  if (pesosGroup?.valores) {
    const el = document.getElementById(`${ctx}-pesos`);
    if (el) el.value = pesosGroup.valores.join(', ');
  }
  const refEl = document.getElementById(`${ctx}-porcao-ref`);
  if (refEl) {
    refEl.value = porcaoGroup?.gramas || '';
    updatePorcaoPreview(ctx);
  }
}

// ── Lê itens do kit ───────────────────────────────────
function readKitItens(ctx) {
  const raw = document.getElementById(`${ctx}-kit-itens`)?.value || '';
  return raw.split('\n').map(s => s.trim()).filter(Boolean);
}
function populateCatSelects() {
  const opts = categories.length
    ? categories.map(c => `<option value="${c.name}">${c.label}</option>`).join('')
    : '<option value="">Nenhuma categoria — crie uma primeiro</option>';
  ['new-cat','edit-cat'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { const prev = el.value; el.innerHTML = opts; el.value = prev; }
  });
}

async function addItem() {
  const name = document.getElementById('new-name').value.trim();
  console.log('[ADD-ITEM] chamado | nome:', name);
  if (!name) { sbToast('err', 'Informe o nome do item'); return; }

  const price    = parseFloat(document.getElementById('new-price').value) || 0;
  const priceOld = parseFloat(document.getElementById('new-price-old').value) || null;
  const catEl    = document.getElementById('new-cat');
  const catKey   = catEl ? catEl.value : '';
  const catLabel = catEl ? (catEl.options[catEl.selectedIndex]?.text || catKey) : catKey;
  const selEmo   = document.querySelector('#emoji-grid .emo-btn.on');
  const emoji    = (selEmo ? selEmo.textContent.trim() : '') || '🍽️';
  const desc     = document.getElementById('new-desc').value.trim();
  const ingrRaw  = document.getElementById('new-ingredients').value.trim();
  const ingredients  = ingrRaw ? ingrRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const itemType     = document.getElementById('new-item-type').value || 'normal';
  const allowHalf    = itemType === 'pizza' && document.getElementById('new-meio-meio')?.classList.contains('on');
  const maxFlavors   = itemType === 'pizza' ? (parseInt(document.getElementById('new-max-flavors')?.value) || 1) : 1;
  const status       = document.getElementById('new-status').value || 'active';
  const destaque     = document.getElementById('new-destaque')?.classList.contains('on') || false;
  const _AC_TIPOS_F  = ['cortes','preparos','ocasiao','armazenamento','pesos','porcao_ref','kit_itens'];
  const customGroups = readGrupos('new').filter(g => !_AC_TIPOS_F.includes(g.tipo));

  // Açougue: adiciona cortes/preparos/pesos ao custom_groups (kg = tudo; kit = só info)
  const itemTypeNew = document.getElementById('new-item-type').value || 'normal';
  if (itemTypeNew === 'kg' || itemTypeNew === 'kit') {
    const ac = readAcougueOptions('new');
    if (itemTypeNew === 'kg') {
      if (ac._cortesList.length) customGroups.push({ tipo: 'cortes',    opcoes: ac._cortesList.map(i => ({ id: i.id, nome: i.nome, icon: i.icon || null, ...(i.porcoes ? { porcoes: i.porcoes } : {}) })) });
      if (ac.pesos.length)       customGroups.push({ tipo: 'pesos',     valores: ac.pesos });
      if (ac.porcaoRef > 0)      customGroups.push({ tipo: 'porcao_ref', gramas: ac.porcaoRef });
    }
    if (ac._preparosList.length)      customGroups.push({ tipo: 'preparos',      opcoes: ac._preparosList.map(i => ({ id: i.id, nome: i.nome, icon: i.icon || null })) });
    if (ac._ocasiaoList.length)       customGroups.push({ tipo: 'ocasiao',       opcoes: ac._ocasiaoList.map(i => ({ id: i.id, nome: i.nome, icon: i.icon || null })) });
    if (ac._armazenamentoList.length) customGroups.push({ tipo: 'armazenamento', opcoes: ac._armazenamentoList.map(i => ({ id: i.id, nome: i.nome, icon: i.icon || null })) });
  }
  // Kit: salva itens no custom_groups
  if (itemTypeNew === 'kit') {
    const kitItens = readKitItens('new');
    if (kitItens.length) customGroups.push({ tipo: 'kit_itens', itens: kitItens });
  }

  console.log('[ADD-ITEM] campos | catKey:', catKey, '| catLabel:', catLabel, '| price:', price, '| emoji:', emoji, '| status:', status);

  if (!catKey) { sbToast('err', 'Selecione uma categoria'); return; }
  if (price < 0) { sbToast('err', 'Preço inválido'); return; }

  const payload = {
    emoji, name,
    cat:          catLabel,
    cat_key:      catKey,
    price,
    price_old:    priceOld,
    description:  desc,
    ingredients,
    item_type:    itemType,
    allow_half:   allowHalf,
    max_flavors:  maxFlavors,
    promo:        destaque,
    destaque,
    custom_groups: customGroups,
    status,
    days: [1,1,1,1,1,1,1]
  };
  console.log('[ADD-ITEM] payload enviado:', payload);

  sbLoading(true);
  const { data, error } = await sb.from('menu_items').insert(payload).select().single();
  sbLoading(false);

  console.log('[ADD-ITEM] resposta | data:', data, '| error:', error);

  if (error || !data) {
    sbToast('err', 'Erro ao salvar item: ' + (error?.message || 'resposta inválida do servidor'));
    console.error('[ADD-ITEM] ❌', error);
    return;
  }

  console.log('[ADD-ITEM] ✅ item criado id:', data.id);

  if (_newItemImageUrl) {
    try {
      await sb.from('menu_items').update({ image_url: _newItemImageUrl }).eq('id', data.id);
      data.image_url = _newItemImageUrl;
    } catch(e) { sbToast('err', 'Item criado, mas erro ao salvar foto'); }
    _newItemImageUrl = null;
  } else if (_newItemImageFile) {
    try {
      const url = await uploadItemImage(_newItemImageFile, data.id);
      await sb.from('menu_items').update({ image_url: url }).eq('id', data.id);
      data.image_url = url;
    } catch(e) { sbToast('err', 'Item criado, mas erro ao enviar foto'); }
    _newItemImageFile = null;
  }

  items.push(mapItem(data));

  ['new-name','new-desc','new-ingredients','new-price','new-price-old'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const t  = document.getElementById('new-img-thumb');        if(t)  { t.src = ''; t.style.display = 'none'; }
  _newItemImageUrl = null;
  const p2 = document.getElementById('new-img-placeholder');  if(p2) p2.style.display = 'flex';
  const c2 = document.getElementById('new-img-change');        if(c2) c2.style.display = 'none';
  const pr = document.getElementById('new-img-preview');       if(pr) pr.style.border  = '2px dashed var(--border)';
  const ni = document.getElementById('new-item-type');         if(ni) ni.value = 'normal';
  const ns = document.getElementById('new-status');            if(ns) ns.value = 'active';
  const nd = document.getElementById('new-destaque');          if(nd) nd.classList.remove('on');
  const ng = document.getElementById('new-grupos-list');       if(ng) ng.innerHTML = '';
  // Limpa listas dinâmicas de açougue
  ['cortes','preparos','ocasiao','armazenamento'].forEach(t => {
    _acListState[`new-${t}`] = [];
    renderAcList('new', t);
  });
  togglePizzaOptions('new');

  closeModal('modal-add-item');
  renderTable(); renderGestor(); renderPDV();
  sbToast('ok', `"${name}" adicionado ao cardápio!`);
}

function openEditItem(id) {
  editingId = +id;  // garante número para comparar com i.id
  const it = items.find(i => i.id === editingId);
  if (!it) return;

  populateCatSelects();

  document.getElementById('edit-name').value        = it.name;
  document.getElementById('edit-desc').value        = it.desc || '';
  document.getElementById('edit-ingredients').value = (it.ingredients || []).join(', ');
  document.getElementById('edit-price').value       = it.price;
  document.getElementById('edit-price-old').value   = it.priceOld || '';
  document.getElementById('edit-cat').value         = it.catKey;
  document.getElementById('edit-status').value      = it.status;
  document.getElementById('edit-item-type').value   = it.itemType || 'normal';
  togglePizzaOptions('edit');
  const meioel = document.getElementById('edit-meio-meio');
  if (meioel) meioel.classList.toggle('on', !!it.allowHalf);
  // Set max flavors buttons
  const mf = it.maxFlavors || 1;
  document.getElementById('edit-max-flavors').value = mf;
  document.querySelectorAll('#edit-pizza-options .pz-max-btn').forEach(b => {
    b.classList.toggle('on', parseInt(b.dataset.val) === mf);
  });

  // Reset image file state and show existing image
  _editItemImageFile = null;
  _editItemImageUrl  = null;
  const thumb = document.getElementById('edit-img-thumb');
  const placeholder = document.getElementById('edit-img-placeholder');
  const change = document.getElementById('edit-img-change');
  const preview = document.getElementById('edit-img-preview');
  if (it.imageUrl) {
    thumb.src = it.imageUrl; thumb.style.display = 'block';
    placeholder.style.display = 'none';
    change.style.display = 'block';
    preview.style.border = '2px solid var(--accent)';
  } else {
    thumb.src = ''; thumb.style.display = 'none';
    placeholder.style.display = 'flex';
    change.style.display = 'none';
    preview.style.border = '2px dashed var(--border)';
  }

  const _desel = document.getElementById('edit-destaque');
  if (_desel) _desel.classList.toggle('on', !!it.destaque);

  // Tipos exclusivos do açougue — não devem aparecer como grupos genéricos
  const _ACOUGUE_TIPOS = ['cortes','preparos','ocasiao','armazenamento','pesos','porcao_ref'];
  const genericGroups = (it.customGroups || []).filter(g => !_ACOUGUE_TIPOS.includes(g.tipo));
  renderGrupos('edit', genericGroups);

  // Açougue: preenche cortes/preparos/pesos (também para kit)
  if (it.itemType === 'kg' || it.itemType === 'kit') {
    fillAcougueOptions('edit', it.customGroups || []);
  } else {
    // Limpa listas dinâmicas
    ['cortes','preparos','ocasiao','armazenamento'].forEach(t => {
      _acListState[`edit-${t}`] = [];
      renderAcList('edit', t);
    });
    const ep = document.getElementById('edit-pesos'); if (ep) ep.value = '';
  }

  // Kit: preenche itens
  if (it.itemType === 'kit') {
    const cg = Array.isArray(it.customGroups) ? it.customGroups : [];
    const kitGroup = cg.find(g => g.tipo === 'kit_itens');
    const el = document.getElementById('edit-kit-itens');
    if (el) el.value = kitGroup?.itens?.join('\n') || '';
  } else {
    const el = document.getElementById('edit-kit-itens'); if (el) el.value = '';
  }

  openModal('modal-edit-item');
  loadImgGallery('edit');
}

function selectEditEmoji(el, emoji) {
  document.querySelectorAll('#edit-emoji-grid .emo-btn').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  const prev = document.getElementById('edit-emoji-current');
  if (prev) prev.textContent = emoji;
}

async function saveEditItem() {
  console.log('[EDIT-ITEM] saveEditItem chamado | editingId:', editingId);
  const it = items.find(i => i.id === editingId);
  if (!it) { sbToast('err', 'Item não encontrado'); return; }

  const novoNome = document.getElementById('edit-name').value.trim();
  if (!novoNome) { sbToast('err', 'Informe o nome do item'); return; }

  it.name        = novoNome;
  it.desc        = document.getElementById('edit-desc').value.trim();
  it.price       = parseFloat(document.getElementById('edit-price').value) || it.price;
  it.priceOld    = parseFloat(document.getElementById('edit-price-old').value) || null;
  const catEl    = document.getElementById('edit-cat');
  it.catKey      = catEl ? catEl.value : it.catKey;
  it.cat         = catEl ? (catEl.options[catEl.selectedIndex]?.text || it.catKey) : it.catKey;
  it.status      = document.getElementById('edit-status')?.value || it.status;
  const ingrRaw  = document.getElementById('edit-ingredients').value;
  it.ingredients = ingrRaw ? ingrRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  it.itemType    = document.getElementById('edit-item-type')?.value || 'normal';
  const meioEl   = document.getElementById('edit-meio-meio');
  it.allowHalf   = it.itemType === 'pizza' && meioEl && meioEl.classList.contains('on');
  it.maxFlavors  = it.itemType === 'pizza' ? (parseInt(document.getElementById('edit-max-flavors')?.value) || 1) : 1;
  it.destaque    = document.getElementById('edit-destaque')?.classList.contains('on') || false;
  // readGrupos retorna só grupos genéricos (radio/checkbox) — filtra resíduos de tipos açougue
  const _AC_TIPOS_FILTER = ['cortes','preparos','ocasiao','armazenamento','pesos','porcao_ref','kit_itens'];
  it.customGroups = readGrupos('edit').filter(g => !_AC_TIPOS_FILTER.includes(g.tipo));

  // Açougue: adiciona cortes/preparos/pesos (kg = tudo; kit = só info)
  if (it.itemType === 'kg' || it.itemType === 'kit') {
    const ac = readAcougueOptions('edit');
    if (it.itemType === 'kg') {
      if (ac._cortesList.length)   it.customGroups.push({ tipo: 'cortes',   opcoes: ac._cortesList.map(i => ({ id: i.id, nome: i.nome, icon: i.icon || null, ...(i.porcoes ? { porcoes: i.porcoes } : {}) })) });
      if (ac.pesos.length)         it.customGroups.push({ tipo: 'pesos',    valores: ac.pesos });
      if (ac.porcaoRef > 0)        it.customGroups.push({ tipo: 'porcao_ref', gramas: ac.porcaoRef });
    }
    if (ac._preparosList.length)      it.customGroups.push({ tipo: 'preparos',      opcoes: ac._preparosList.map(i => ({ id: i.id, nome: i.nome, icon: i.icon || null })) });
    if (ac._ocasiaoList.length)       it.customGroups.push({ tipo: 'ocasiao',       opcoes: ac._ocasiaoList.map(i => ({ id: i.id, nome: i.nome, icon: i.icon || null })) });
    if (ac._armazenamentoList.length) it.customGroups.push({ tipo: 'armazenamento', opcoes: ac._armazenamentoList.map(i => ({ id: i.id, nome: i.nome, icon: i.icon || null })) });
  }
  // Kit: salva itens
  if (it.itemType === 'kit') {
    const kitItens = readKitItens('edit');
    if (kitItens.length) it.customGroups.push({ tipo: 'kit_itens', itens: kitItens });
  }

  const selEmo = document.querySelector('#edit-emoji-grid .emo-btn.on');
  if (selEmo && selEmo.textContent.trim()) it.emoji = selEmo.textContent.trim();

  sbLoading(true);
  const updatePayload = {
    name:         it.name,
    description:  it.desc,
    price:        it.price,
    price_old:    it.priceOld || null,
    cat:          it.cat,
    cat_key:      it.catKey,
    status:       it.status,
    emoji:        it.emoji,
    ingredients:  it.ingredients,
    item_type:    it.itemType,
    allow_half:   it.allowHalf,
    max_flavors:  it.maxFlavors,
    destaque:     it.destaque,
    promo:        it.destaque,
    custom_groups: it.customGroups
  };
  console.log('[EDIT-ITEM] payload:', updatePayload);
  const { error } = await sb.from('menu_items').update(updatePayload).eq('id', editingId);
  sbLoading(false);
  console.log('[EDIT-ITEM] resposta error:', error);

  if (error) {
    sbToast('err', 'Erro ao atualizar item: ' + (error.message || 'servidor indisponível'));
    console.error('[saveEditItem]', error);
    return;
  }

  // Upload / reutilização de imagem
  if (_editItemImageUrl) {
    try {
      await sb.from('menu_items').update({ image_url: _editItemImageUrl }).eq('id', editingId);
      it.imageUrl = _editItemImageUrl;
    } catch(e) { sbToast('err', 'Item salvo, mas erro ao salvar foto'); }
    _editItemImageUrl = null;
  } else if (_editItemImageFile) {
    try {
      const url = await uploadItemImage(_editItemImageFile, editingId);
      await sb.from('menu_items').update({ image_url: url }).eq('id', editingId);
      it.imageUrl = url;
    } catch(e) { sbToast('err', 'Item salvo, mas erro ao enviar foto'); }
    _editItemImageFile = null;
  }

  closeModal('modal-edit-item');
  renderTable(); renderGestor(); renderPDV();
  sbToast('ok', `"${it.name}" atualizado!`);
}

async function deleteItem() {
  const it = items.find(i => i.id === editingId);
  if (!it) { sbToast('err', 'Item não encontrado'); return; }
  const name = it.name;
  if (!await showConfirmDialog(`Excluir "${name}"?`, 'Esta ação não pode ser desfeita.')) return;
  sbLoading(true);
  const { error } = await sb.from('menu_items').delete().eq('id', editingId);
  sbLoading(false);
  if (error) {
    sbToast('err', 'Erro ao excluir item: ' + (error.message || 'servidor indisponível'));
    console.error('[deleteItem]', error);
    return;
  }
  items = items.filter(i => i.id !== editingId);
  closeModal('modal-edit-item');
  renderTable(); renderGestor(); renderPDV();
  sbToast('ok', `"${name}" removido do cardápio!`);
}

function showConfirmDialog(title, msg) {
  return new Promise(resolve => {
    let el = document.getElementById('confirm-dialog');
    if (!el) {
      el = document.createElement('div');
      el.id = 'confirm-dialog';
      el.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:9998;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
      el.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px 24px;max-width:360px;width:90%;text-align:center">
        <div id="cd-title" style="font-family:'Playfair Display',sans-serif;font-size:16px;font-weight:800;margin-bottom:8px"></div>
        <div id="cd-msg" style="font-size:12.5px;color:var(--muted);margin-bottom:22px;line-height:1.5"></div>
        <div style="display:flex;gap:10px">
          <button id="cd-cancel" style="flex:1;padding:10px;border-radius:8px;background:var(--surface2);border:1px solid var(--border);color:var(--text);font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer">Cancelar</button>
          <button id="cd-ok" style="flex:1;padding:10px;border-radius:8px;background:var(--danger);border:none;color:#fff;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer">🗑 Excluir</button>
        </div>
      </div>`;
      document.body.appendChild(el);
    }
    document.getElementById('cd-title').textContent = title;
    document.getElementById('cd-msg').textContent   = msg;
    el.style.display = 'flex';
    const close = (val) => { el.style.display = 'none'; resolve(val); };
    document.getElementById('cd-ok').onclick     = () => close(true);
    document.getElementById('cd-cancel').onclick  = () => close(false);
    el.onclick = (e) => { if (e.target === el) close(false); };
  });
}

function applyBulk(){
  const checked=[...document.querySelectorAll('.row-cb:checked')];
  const rows=document.querySelectorAll('#table-body tr');
  const data=getFiltered();
  const st=document.getElementById('bulk-status').value;
  const pct=parseFloat(document.getElementById('bulk-pct').value)||0;
  checked.forEach(cb=>{
    const row=cb.closest('tr');
    const idx=[...rows].indexOf(row);
    if(idx>=0&&data[idx]){
      if(st) data[idx].status=st;
      if(pct) data[idx].price=Math.max(0,data[idx].price*(1+pct/100));
    }
  });
  closeModal('modal-bulk');
  renderTable();
  showToast('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M3 8l3.5 3.5L13 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',`Ação aplicada em ${checked.length} item(s)!`);
}

// ─────────────────────────────────────────
// IMAGENS
// ─────────────────────────────────────────
function renderImagens() {
  const g = document.getElementById('img-grid');
  if (!g) return;
  g.innerHTML = items.map(i => `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:all .2s"
         onmouseenter="this.style.borderColor='var(--accent)'"
         onmouseleave="this.style.borderColor='var(--border)'">
      <div style="height:110px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:48px;border-bottom:1px solid var(--border);position:relative;overflow:hidden">
        ${i.imageUrl
          ? `<img src="${i.imageUrl}" style="width:100%;height:100%;object-fit:cover">`
          : `<div>${i.emoji}</div>`}
      </div>
      <div style="padding:10px">
        <div style="font-weight:600;font-size:12.5px">${i.name}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:1px">${i.cat}</div>
        <button class="btn bg" style="width:100%;justify-content:center;font-size:11px;margin-top:7px;padding:4px"
          onclick="event.stopPropagation();triggerImageUpload(${i.id},'${i.name.replace(/'/g,'')}')">
          ${_ICON_IMG} ${i.imageUrl ? 'Alterar foto' : 'Adicionar foto'}
        </button>
      </div>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════════
// APLICAR GRUPOS EM LOTE — copia grupos do item em edição
// para outros itens do cardápio (mesma categoria ou outras).
// ═══════════════════════════════════════════════════════════
let _agGruposSelecionados = [];   // grupos do item atual, com flag selecionado
let _agItensSelecionados  = new Set(); // ids dos itens destino
let _agModo               = 'mesclar'; // 'mesclar' | 'substituir'

function openAplicarGruposModal() {
  // Lê os grupos atualmente no formulário de edição (não precisa ter salvo ainda)
  const gruposAtuais = (typeof readGrupos === 'function') ? readGrupos('edit') : [];
  if (!gruposAtuais.length) {
    sbToast('err', 'Adicione pelo menos um grupo antes de aplicar em outros itens.');
    return;
  }
  _agGruposSelecionados = gruposAtuais.map((g, i) => ({ ...g, _idx: i, _sel: true }));
  _agItensSelecionados  = new Set();
  _agModo               = 'mesclar';
  agSetModo('mesclar');
  agRenderGrupos();
  agRenderItens('');
  agAtualizarContagem();
  const el = document.getElementById('ag-busca-item');
  if (el) el.value = '';
  openModal('modal-aplicar-grupos');
}

function agSetModo(modo) {
  _agModo = modo;
  const wM = document.getElementById('ag-modo-mesclar-wrap');
  const wS = document.getElementById('ag-modo-substituir-wrap');
  if (wM) wM.style.borderColor = modo === 'mesclar'    ? 'var(--accent)' : 'var(--border)';
  if (wS) wS.style.borderColor = modo === 'substituir' ? 'var(--accent)' : 'var(--border)';
}

function agRenderGrupos() {
  const list = document.getElementById('ag-grupos-list');
  if (!list) return;
  if (!_agGruposSelecionados.length) {
    list.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:8px">Nenhum grupo configurado.</div>';
    return;
  }
  list.innerHTML = _agGruposSelecionados.map((g, i) => {
    const nOpcoes = (g.opcoes || []).length;
    const tipoLbl = g.tipo === 'checkbox' ? `Múltipla (${g.min||0}–${g.max||1})` : 'Escolha 1';
    return `
    <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:7px;cursor:pointer">
      <input type="checkbox" ${g._sel ? 'checked' : ''} onchange="agToggleGrupo(${i})" style="width:15px;height:15px;accent-color:var(--accent);cursor:pointer">
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:600;color:var(--text)">${(g.nome||'(sem nome)').replace(/</g,'&lt;')}</div>
        <div style="font-size:10.5px;color:var(--muted);margin-top:1px">${tipoLbl} · ${nOpcoes} ${nOpcoes === 1 ? 'opção' : 'opções'}${g.required ? ' · obrigatório' : ''}</div>
      </div>
    </label>`;
  }).join('');
}

function agToggleGrupo(i) {
  if (_agGruposSelecionados[i]) {
    _agGruposSelecionados[i]._sel = !_agGruposSelecionados[i]._sel;
  }
}

function agSelecionarTodosGrupos(marcar) {
  _agGruposSelecionados.forEach(g => { g._sel = !!marcar; });
  agRenderGrupos();
}

function agRenderItens(filtro) {
  const list = document.getElementById('ag-itens-list');
  if (!list) return;
  const f = (filtro || '').trim().toLowerCase();
  // Agrupa por categoria (mantém a ordem das categories globais)
  const cats = (typeof categories !== 'undefined' && Array.isArray(categories)) ? categories : [];
  const todosItens = (typeof items !== 'undefined' && Array.isArray(items)) ? items : [];
  // Exclui o próprio item sendo editado da lista de destinos
  const itensDisponiveis = todosItens.filter(i => i.id !== editingId);
  // Ordena por cat + nome
  const porCat = new Map();
  for (const cat of cats) porCat.set(cat.name, { cat, items: [] });
  // Bucket fallback pra itens sem categoria reconhecida
  porCat.set('__sem_cat__', { cat: { name: '__sem_cat__', label: 'Sem categoria' }, items: [] });
  for (const it of itensDisponiveis) {
    if (f && !(it.name||'').toLowerCase().includes(f)) continue;
    const key = porCat.has(it.catKey) ? it.catKey : '__sem_cat__';
    porCat.get(key).items.push(it);
  }
  const html = [];
  for (const { cat, items: its } of porCat.values()) {
    if (!its.length) continue;
    const catSelId = `ag-cat-${(cat.name||'').replace(/[^a-zA-Z0-9]/g,'_')}`;
    const allSel   = its.every(i => _agItensSelecionados.has(i.id));
    const someSel  = its.some(i => _agItensSelecionados.has(i.id));
    html.push(`
      <div style="margin-top:6px">
        <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--surface);border-radius:6px;cursor:pointer;font-weight:700;font-size:11.5px;color:var(--muted)">
          <input type="checkbox" id="${catSelId}" ${allSel ? 'checked' : ''} ${(someSel && !allSel) ? 'data-indeterminate="1"' : ''} onchange="agToggleCategoria('${(cat.name||'').replace(/'/g,"\\'")}', this.checked)" style="width:14px;height:14px;accent-color:var(--accent);cursor:pointer">
          <span style="text-transform:uppercase;letter-spacing:.5px">${(cat.label||cat.name||'Categoria').replace(/</g,'&lt;')}</span>
          <span style="margin-left:auto;font-size:10px;color:var(--muted)">${its.length} ${its.length === 1 ? 'item' : 'itens'}</span>
        </label>`);
    for (const it of its) {
      const sel = _agItensSelecionados.has(it.id);
      const temGrupos = Array.isArray(it.customGroups) && it.customGroups.length > 0;
      html.push(`
        <label style="display:flex;align-items:center;gap:10px;padding:6px 10px 6px 24px;border-radius:6px;cursor:pointer;font-size:12.5px">
          <input type="checkbox" ${sel ? 'checked' : ''} onchange="agToggleItem(${it.id}, this.checked)" style="width:14px;height:14px;accent-color:var(--accent);cursor:pointer">
          <span style="flex:1;color:var(--text)">${(it.name||'').replace(/</g,'&lt;')}</span>
          ${temGrupos ? '<span title="Já tem grupos configurados" style="font-size:10px;color:#fbbf24;background:rgba(245,158,11,.12);padding:1px 5px;border-radius:99px">tem grupos</span>' : ''}
        </label>`);
    }
    html.push('</div>');
  }
  if (!html.length) {
    list.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:12px">Nenhum item encontrado.</div>';
  } else {
    list.innerHTML = html.join('');
  }
  // Ajusta indeterminate (não pode ser setado via atributo HTML)
  list.querySelectorAll('input[data-indeterminate="1"]').forEach(el => { el.indeterminate = true; });
}

function agToggleItem(id, marcar) {
  if (marcar) _agItensSelecionados.add(id);
  else _agItensSelecionados.delete(id);
  agAtualizarContagem();
  // Re-renderiza só pra atualizar o checkbox da categoria (all/some/none)
  const busca = document.getElementById('ag-busca-item');
  agRenderItens(busca ? busca.value : '');
}

function agToggleCategoria(catName, marcar) {
  const todosItens = (typeof items !== 'undefined' && Array.isArray(items)) ? items : [];
  const busca = document.getElementById('ag-busca-item');
  const f = busca ? (busca.value||'').trim().toLowerCase() : '';
  for (const it of todosItens) {
    if (it.id === editingId) continue;
    const key = it.catKey || '__sem_cat__';
    if (key !== catName) continue;
    if (f && !(it.name||'').toLowerCase().includes(f)) continue;
    if (marcar) _agItensSelecionados.add(it.id);
    else _agItensSelecionados.delete(it.id);
  }
  agAtualizarContagem();
  agRenderItens(f);
}

function agSelecionarTodosItens(marcar) {
  const todosItens = (typeof items !== 'undefined' && Array.isArray(items)) ? items : [];
  const busca = document.getElementById('ag-busca-item');
  const f = busca ? (busca.value||'').trim().toLowerCase() : '';
  for (const it of todosItens) {
    if (it.id === editingId) continue;
    if (f && !(it.name||'').toLowerCase().includes(f)) continue;
    if (marcar) _agItensSelecionados.add(it.id);
    else _agItensSelecionados.delete(it.id);
  }
  agAtualizarContagem();
  agRenderItens(f);
}

function agMesmaCategoria() {
  // Marca todos os itens da mesma categoria do item em edição
  const itAtual = (typeof items !== 'undefined' ? items : []).find(i => i.id === editingId);
  if (!itAtual) return;
  const catAtual = itAtual.catKey;
  _agItensSelecionados = new Set();
  for (const it of items) {
    if (it.id === editingId) continue;
    if ((it.catKey || '__sem_cat__') === (catAtual || '__sem_cat__')) {
      _agItensSelecionados.add(it.id);
    }
  }
  agAtualizarContagem();
  const busca = document.getElementById('ag-busca-item');
  agRenderItens(busca ? busca.value : '');
}

function agFiltrarItens(valor) {
  agRenderItens(valor || '');
}

function agAtualizarContagem() {
  const n = _agItensSelecionados.size;
  const el = document.getElementById('ag-contagem');
  if (el) el.textContent = `${n} ${n === 1 ? 'item selecionado' : 'itens selecionados'}`;
  const btn = document.getElementById('ag-btn-aplicar');
  if (btn) {
    const grpsSel = _agGruposSelecionados.filter(g => g._sel).length;
    btn.disabled = (n === 0 || grpsSel === 0);
    btn.style.opacity = btn.disabled ? '0.5' : '1';
    btn.style.pointerEvents = btn.disabled ? 'none' : '';
  }
}

async function aplicarGruposEmLote() {
  const grupos = _agGruposSelecionados.filter(g => g._sel).map(g => {
    const { _idx, _sel, ...clean } = g;
    return clean;
  });
  if (!grupos.length) { sbToast('err','Selecione ao menos um grupo.'); return; }
  const alvos = Array.from(_agItensSelecionados);
  if (!alvos.length) { sbToast('err','Selecione ao menos um item de destino.'); return; }

  const modo = _agModo;
  const msg = modo === 'substituir'
    ? `Tem certeza? Isso vai APAGAR todos os grupos atuais de ${alvos.length} ${alvos.length===1?'item':'itens'} e colocar apenas os ${grupos.length} grupo(s) selecionados.`
    : `Confirmar: adicionar ${grupos.length} grupo(s) em ${alvos.length} ${alvos.length===1?'item':'itens'} (mantendo os existentes)?`;
  if (!confirm(msg)) return;

  // Tipos exclusivos do açougue — nunca copiamos esses grupos em lote
  const _AC_TIPOS = ['cortes','preparos','ocasiao','armazenamento','pesos','porcao_ref','kit_itens'];
  const gruposCopiaveis = grupos.filter(g => !_AC_TIPOS.includes(g.tipo));
  if (!gruposCopiaveis.length) {
    sbToast('err','Os grupos selecionados são exclusivos do açougue e não podem ser copiados em lote.');
    return;
  }

  sbLoading(true);
  let sucesso = 0, falhas = 0;
  try {
    for (const id of alvos) {
      const itDest = items.find(i => i.id === id);
      if (!itDest) { falhas++; continue; }
      // Preserva grupos exclusivos do açougue já existentes no destino
      const gruposDestAtuais = Array.isArray(itDest.customGroups) ? itDest.customGroups : [];
      const preservados = gruposDestAtuais.filter(g => _AC_TIPOS.includes(g.tipo));
      let finalGrupos;
      if (modo === 'substituir') {
        finalGrupos = [...preservados, ...gruposCopiaveis];
      } else {
        // Mesclar: mantém todos os atuais + adiciona novos (ignorando duplicatas por nome case-insensitive)
        const nomesExistentes = new Set(gruposDestAtuais.map(g => (g.nome||'').toLowerCase().trim()).filter(Boolean));
        const novosSemDup = gruposCopiaveis.filter(g => !nomesExistentes.has((g.nome||'').toLowerCase().trim()));
        finalGrupos = [...gruposDestAtuais, ...novosSemDup];
      }
      try {
        const { error } = await sb.from('menu_items').update({ custom_groups: finalGrupos }).eq('id', id);
        if (error) { falhas++; console.warn('[aplicarGrupos] falhou id=', id, error); continue; }
        // Atualiza cache local
        itDest.customGroups = finalGrupos;
        sucesso++;
      } catch(e) {
        falhas++;
        console.warn('[aplicarGrupos] exceção id=', id, e);
      }
    }
  } finally {
    sbLoading(false);
  }
  closeModal('modal-aplicar-grupos');
  if (sucesso && !falhas) {
    sbToast('ok', `✅ Grupos aplicados em ${sucesso} ${sucesso===1?'item':'itens'}!`);
  } else if (sucesso && falhas) {
    sbToast('ok', `Aplicado em ${sucesso} ${sucesso===1?'item':'itens'}. ${falhas} ${falhas===1?'falhou':'falharam'}.`);
  } else {
    sbToast('err', `Nenhum item foi atualizado. Tente novamente.`);
  }
}

// ─────────────────────────────────────────

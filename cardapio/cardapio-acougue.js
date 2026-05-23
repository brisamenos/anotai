// ══════════════════════════════════════════
//  AÇOUGUE — Cortes, peso, preparo, grupos/complementos
//  Estima Food — Cardápio
// ══════════════════════════════════════════
// ══════════════════════════════════════════
//  GRUPOS DE CUSTOMIZAÇÃO — CARDÁPIO
// ══════════════════════════════════════════
let _imGruposState = {}; // { [grupoNome]: [{nome,preco,qty}] }

// ══════════════════════════════════════════
//  AÇOUGUE — Estado e helpers
// ══════════════════════════════════════════
let _acougueCortes  = {}; // { [corteNome]: { peso: 0, separar: '', extra: '' } }
let _acougueAtual   = null;
let _acouguePesos   = [];
let _pesoConfirmadoPeloUsuario = false;

// Ilustrações SVG estilo sketch para cada tipo de corte
// ── Imagens de cortes servidas localmente (/uploads/cortes/) ──
const _C = 'https://onbeef.s3.amazonaws.com/imagens-cortes';

const _corteImgMap = {
  moido:      'https://onbeef.s3.amazonaws.com/imagens-cortes/moida-2x.png',
  moido2x:    'https://onbeef.s3.amazonaws.com/imagens-cortes/moida-2x.png',
  tiras:      'https://onbeef.s3.amazonaws.com/imagens-cortes/tiras.png',
  tirinha:    'https://onbeef.s3.amazonaws.com/imagens-cortes/tirinhas.png',
  tirinhas:   'https://onbeef.s3.amazonaws.com/imagens-cortes/tirinhas.png',
  strogonoff: 'https://onbeef.s3.amazonaws.com/imagens-cortes/strogonoff.png',
  inteiro:    'https://onbeef.s3.amazonaws.com/imagens-cortes/inteira.png',
  inteira:    'https://onbeef.s3.amazonaws.com/imagens-cortes/inteira.png',
  espeto:     'https://onbeef.s3.amazonaws.com/imagens-cortes/espeto.png',
  cubos:      'https://onbeef.s3.amazonaws.com/imagens-cortes/cubos.png',
  picado:     'https://onbeef.s3.amazonaws.com/imagens-cortes/picado.png',
  grelha:     'https://onbeef.s3.amazonaws.com/imagens-cortes/grelha.png',
  peca:       'https://onbeef.s3.amazonaws.com/imagens-cortes/peca.png',
  bife:       'https://onbeef.s3.amazonaws.com/imagens-cortes/bifemedio.png',
  bifefino:   'https://onbeef.s3.amazonaws.com/imagens-cortes/bifefino.png',
  bifemedio:  'https://onbeef.s3.amazonaws.com/imagens-cortes/bifemedio.png',
  bifegrosso: 'https://onbeef.s3.amazonaws.com/imagens-cortes/bifegrosso.png',
  postas:     'https://onbeef.s3.amazonaws.com/imagens-cortes/postas.png',
  default:    'https://onbeef.s3.amazonaws.com/imagens-cortes/bifemedio.png',
};

const _preparoImgMap = {
  dia_a_dia:  'https://onbeef.s3.amazonaws.com/tags/icons/dia_a_dia.png',
  churrasco:  'https://onbeef.s3.amazonaws.com/tags/icons/churrasco.png',
  resfriado:  'https://onbeef.s3.amazonaws.com/tags/icons/wind.png',
  grelhar:    'https://onbeef.s3.amazonaws.com/tags/icons/grellhar.png',
  grelhado:   'https://onbeef.s3.amazonaws.com/tags/icons/grellhar.png',
  grelha:     'https://onbeef.s3.amazonaws.com/tags/icons/grellhar.png',
  defumado:   'https://onbeef.s3.amazonaws.com/tags/icons/smoker.png',
  frigideira: 'https://onbeef.s3.amazonaws.com/tags/icons/frigideira.png',
  forno:      'https://onbeef.s3.amazonaws.com/tags/icons/forno.png',
  airfryer:   'https://onbeef.s3.amazonaws.com/tags/icons/airfryer.png',
  panela:     'https://onbeef.s3.amazonaws.com/tags/icons/panela.png',
  ensopado:   'https://onbeef.s3.amazonaws.com/tags/icons/ensopado.png',
  espeto:     'https://onbeef.s3.amazonaws.com/tags/icons/espeto.png',
};

// Mapa de fallback direto pro S3 original
const _S3fallback = {
  'moida-2x': 'https://onbeef.s3.amazonaws.com/imagens-cortes/moida-2x.png',
  moida:      'https://onbeef.s3.amazonaws.com/imagens-cortes/moida-2x.png',
  tiras:      'https://onbeef.s3.amazonaws.com/imagens-cortes/tiras.png',
  tirinhas:   'https://onbeef.s3.amazonaws.com/imagens-cortes/tirinhas.png',
  inteira:    'https://onbeef.s3.amazonaws.com/imagens-cortes/inteira.png',
  espeto:     'https://onbeef.s3.amazonaws.com/imagens-cortes/espeto.png',
  cubos:      'https://onbeef.s3.amazonaws.com/imagens-cortes/cubos.png',
  grelha:     'https://onbeef.s3.amazonaws.com/imagens-cortes/grelha.png',
  peca:       'https://onbeef.s3.amazonaws.com/imagens-cortes/peca.png',
  bifefino:   'https://onbeef.s3.amazonaws.com/imagens-cortes/bifefino.png',
  bifemedio:  'https://onbeef.s3.amazonaws.com/imagens-cortes/bifemedio.png',
  bifegrosso: 'https://onbeef.s3.amazonaws.com/imagens-cortes/bifegrosso.png',
  strogonoff: 'https://onbeef.s3.amazonaws.com/imagens-cortes/strogonoff.png',
  postas:     'https://onbeef.s3.amazonaws.com/imagens-cortes/postas.png',
  picado:     'https://onbeef.s3.amazonaws.com/imagens-cortes/picado.png',
  dia_a_dia:  'https://onbeef.s3.amazonaws.com/tags/icons/dia_a_dia.png',
  churrasco:  'https://onbeef.s3.amazonaws.com/tags/icons/churrasco.png',
  resfriado:  'https://onbeef.s3.amazonaws.com/tags/icons/wind.png',
  grellhar:   'https://onbeef.s3.amazonaws.com/tags/icons/grellhar.png',
  defumado:   'https://onbeef.s3.amazonaws.com/tags/icons/smoker.png',
  frigideira: 'https://onbeef.s3.amazonaws.com/tags/icons/frigideira.png',
  forno:      'https://onbeef.s3.amazonaws.com/tags/icons/forno.png',
  airfryer:   'https://onbeef.s3.amazonaws.com/tags/icons/airfryer.png',
};

function _imgTag(url, alt, size) {
  const s = size || 60;
  // Pega a chave do nome do arquivo sem extensão para o fallback
  const key = url.split('/').pop().replace('.png','');
  const fb = _S3fallback[key] || '';
  const onerror = fb ? `onerror="if(this.src!=='${fb}')this.src='${fb}'"` : '';
  return `<img src="${url}" alt="${alt}" width="${s}" height="${s}" style="object-fit:contain;display:block" ${onerror}>`;
}

function _getCorteIlus(nome) {
  const n = (nome||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  let key = 'default';
  if      (n.includes('strogon'))                           key = 'strogonoff';
  else if (n.includes('posta'))                             key = 'postas';
  else if (n.includes('tirinha') || n.includes('tirinhas')) key = 'tirinha';
  else if (n.includes('tira'))                              key = 'tiras';
  else if (n.includes('moido') && n.includes('2'))          key = 'moido2x';
  else if (n.includes('moido') || n.includes('moer') || n.includes('moida')) key = 'moido';
  else if (n.includes('cubo'))                              key = 'cubos';
  else if (n.includes('picado'))                            key = 'picado';
  else if (n.includes('grelha'))                            key = 'grelha';
  else if (n.includes('peca') || n.includes('peca'))        key = 'peca';
  else if (n.includes('bifefino') || (n.includes('bife') && n.includes('fino'))) key = 'bifefino';
  else if (n.includes('bifegrosso') || (n.includes('bife') && n.includes('grosso'))) key = 'bifegrosso';
  else if (n.includes('bifemedio') || (n.includes('bife') && n.includes('medio'))) key = 'bifemedio';
  else if (n.includes('bife'))                              key = 'bife';
  else if (n.includes('espeto'))                            key = 'espeto';
  else if (n.includes('inteiro') || n.includes('inteira'))  key = 'inteiro';
  const url = _corteImgMap[key] || _corteImgMap.default;
  return _imgTag(url, nome, 60);
}

function _getPreparoIcon(nome) {
  const n = (nome||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  let key = null;
  if      (n.includes('dia'))        key = 'dia_a_dia';
  else if (n.includes('churrasco'))  key = 'churrasco';
  else if (n.includes('resfriado') || n.includes('frio') || n.includes('wind')) key = 'resfriado';
  else if (n.includes('grelh'))      key = 'grelhar';
  else if (n.includes('defum') || n.includes('smok')) key = 'defumado';
  else if (n.includes('frigideira') || n.includes('frigid')) key = 'frigideira';
  else if (n.includes('forno'))      key = 'forno';
  else if (n.includes('airfryer') || n.includes('air fryer')) key = 'airfryer';
  if (key && _preparoImgMap[key]) {
    return _imgTag(_preparoImgMap[key], nome, 20);
  }
  // fallback SVG genérico
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.4"/></svg>`;
}

function _isAcougueItem(item) {
  const cgs = item.custom_groups || [];
  return (item.item_type === 'kg' || item.itemType === 'kg' || item.tipo === 'kg') ||
         cgs.some(g => g.tipo === 'cortes' || g.tipo === 'pesos');
}

function _isKitItem(item) {
  return (item.item_type === 'kit' || item.itemType === 'kit' || item.tipo === 'kit');
}

function renderImGrupos(item) {
  const wrap = document.getElementById('im-grupos-wrap');
  if (!wrap) return;
  const grupos = item.custom_groups || [];
  if (!grupos.length) { wrap.innerHTML = ''; return; }

  // ── Garante lista de esgotados atualizada antes de renderizar ──
  // O Supabase Realtime PODE não estar publicando addons_esgotados (depende da
  // configuração do projeto). Em vez de confiar só nele, fazemos um fetch fresco
  // a cada abertura de modal — leva ~150ms e garante que o cliente vê o estado
  // real do servidor, mesmo se ficou minutos com o cardápio aberto.
  if (typeof loadAddonsEsgotados === 'function') {
    loadAddonsEsgotados().then(() => _renderImGruposNow(item)).catch(() => _renderImGruposNow(item));
    return;
  }
  _renderImGruposNow(item);
}

function _renderImGruposNow(item) {
  const wrap = document.getElementById('im-grupos-wrap');
  if (!wrap) return;
  const grupos = item.custom_groups || [];
  if (!grupos.length) { wrap.innerHTML = ''; return; }

  // ── Modo açougue ────────────────────────────────────────
  if (_isAcougueItem(item)) {
    _acougueCortes = {};
    _acouguePesos  = (grupos.find(g => g.tipo === 'pesos')?.valores) || [];
    _renderAcougueGrupos(item, wrap, grupos);
    // Renderiza grupos genéricos (radio/checkbox) após os grupos de açougue
    const _ACOUGUE_TIPOS = ['cortes','preparos','ocasiao','armazenamento','pesos','porcao_ref','kit_itens','pizza_sizes'];
    const genericGrupos  = grupos.filter(g => !_ACOUGUE_TIPOS.includes(g.tipo));
    if (genericGrupos.length) {
      wrap.innerHTML += genericGrupos.map(g => {
        const isRequired = g.required === true;
        const badge = isRequired
          ? `<span class="grp-required-badge">Obrigatório</span>`
          : `<span class="grp-optional-badge">Opcional</span>`;
        const optsHtml = (g.opcoes || []).map(o => {
          const esgotado = _isAddonEsgotado(o.nome);
          const priceLabel = esgotado
            ? `<span class="grp-opt-price" style="color:var(--muted);text-decoration:line-through">+ R$ ${fmt(o.preco||0)}</span>`
            : (o.preco > 0
              ? `<span class="grp-opt-price">+ R$ ${fmt(o.preco)}</span>`
              : `<span class="grp-opt-price free">Grátis</span>`);
          const indicator = g.tipo === 'checkbox'
            ? `<div class="grp-opt-indicator multi"></div>`
            : `<div class="grp-opt-indicator"></div>`;
          const qtyEl = g.tipo === 'checkbox' && !esgotado
            ? `<div class="grp-opt-qty" id="gqty_${_slug(g.nome)}_${_slug(o.nome)}">
                 <button class="grp-qty-btn" onclick="event.stopPropagation();grpQty('${_escape(g.nome)}','${_escape(o.nome)}',${o.preco||0},-1)">−</button>
                 <span class="grp-qty-num" id="gqnum_${_slug(g.nome)}_${_slug(o.nome)}">1</span>
                 <button class="grp-qty-btn" onclick="event.stopPropagation();grpQty('${_escape(g.nome)}','${_escape(o.nome)}',${o.preco||0},1)">+</button>
               </div>` : '';
          const esgBadge = esgotado
            ? `<span class="grp-esg-badge" style="background:var(--s2);color:var(--muted);padding:3px 8px;border-radius:6px;font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;border:1px solid var(--border)">Esgotado</span>`
            : '';
          const clickAttr = esgotado ? '' : `onclick="grpToggle(this,'${_escape(g.nome)}','${_escape(o.nome)}',${o.preco||0},'${g.tipo}',${g.max||1})"`;
          const styleAttr = esgotado ? 'opacity:.5;cursor:not-allowed;pointer-events:none' : '';
          return `<div class="grp-opt-item${esgotado?' esgotado':''}" data-grupo="${_escape(g.nome)}" data-nome="${_escape(o.nome)}" data-preco="${o.preco||0}" data-tipo="${g.tipo}" ${clickAttr} style="${styleAttr}">
            <div class="grp-opt-left">${indicator}<span class="grp-opt-name">${o.nome}</span></div>
            <div style="display:flex;align-items:center;gap:8px">${esgBadge || priceLabel}${qtyEl}</div>
          </div>`;
        }).join('');
        return `<div class="grp-section">
          <div class="grp-section-title">${g.nome} ${badge}</div>
          <div class="grp-opts">${optsHtml}</div>
        </div>`;
      }).join('');
    }
    return;
  }

  // ── Modo kit ─────────────────────────────────────────────
  if (_isKitItem(item)) {
    _renderKitGrupos(item, wrap, grupos);
    // Após os chips informativos do kit, anexa também os grupos de customização
    // (ex: "TEMPERADO", "ACOMPANHAMENTOS") que o gestor cadastrou. Antes ficavam
    // invisíveis no kit — cliente não conseguia selecionar e a comanda saía
    // sem os adicionais escolhidos.
    const _KIT_INFO_TIPOS = ['cortes','preparos','ocasiao','armazenamento','pesos','porcao_ref','kit_itens','pizza_sizes'];
    const genericGruposKit = grupos.filter(g => !_KIT_INFO_TIPOS.includes(g.tipo));
    if (genericGruposKit.length) {
      // Reaproveita o mesmo HTML do modo normal abaixo — em vez de duplicar,
      // chamamos uma função interna que renderiza os grupos no formato padrão
      // e acrescenta no DOM existente do wrap.
      const extraHtml = _renderGenericGruposHtml(genericGruposKit);
      if (extraHtml) {
        const sep = document.createElement('div');
        sep.innerHTML = extraHtml;
        // Anexa no fim do wrap sem apagar os chips informativos já renderizados
        while (sep.firstChild) wrap.appendChild(sep.firstChild);
      }
    }
    return;
  }

  // ── Modo normal (pizza/restaurante) ─────────────────────
  // Filtra grupos açougue/kit para não aparecerem no modo normal
  const _ACOUGUE_TIPOS = ['cortes','preparos','ocasiao','armazenamento','pesos','porcao_ref','kit_itens','pizza_sizes'];
  const hasPizzaSizes = typeof _pizzaHasSizePricing === 'function' && _pizzaHasSizePricing(item);
  const genericGrupos  = grupos.filter(g => !_ACOUGUE_TIPOS.includes(g.tipo) && !(hasPizzaSizes && (g.nome||'').toLowerCase().trim() === 'tamanho'));
  if (!genericGrupos.length) { wrap.innerHTML = ''; return; }

  // ── Detecta padrão de borda por tamanho ──
  // Se existem grupos com nome tipo "Borda Recheada (P)", "Borda Recheada (M)", "Borda Recheada (G)"
  // eles ficam ocultos até o tamanho ser selecionado
  const _bordaTamRegex = /^(.+)\s*\((P|M|G)\)\s*$/i;

  wrap.innerHTML = _renderGenericGruposHtml(genericGrupos);
  if (hasPizzaSizes && typeof _applyPizzaSizeToBordas === 'function' && typeof _pizzaSizeKey !== 'undefined' && _pizzaSizeKey) {
    _applyPizzaSizeToBordas(_pizzaSizeKey);
  }
}

// Gera o HTML dos grupos de customização genéricos (Adicionais, Temperos,
// Acompanhamentos, Borda etc). Extraído pra ser reaproveitado tanto no fluxo
// normal quanto no modo kit (onde antes esses grupos nem apareciam).
function _renderGenericGruposHtml(genericGrupos) {
  if (!genericGrupos || !genericGrupos.length) return '';
  const _bordaTamRegex = /^(.+)\s*\((P|M|G)\)\s*$/i;

  return genericGrupos.map(g => {
    const isRequired = g.required === true;
    const badge = isRequired
      ? `<span class="grp-required-badge">Obrigatório</span>`
      : `<span class="grp-optional-badge">Opcional</span>`;
    const optsHtml = (g.opcoes || []).map(o => {
      const esgotado = _isAddonEsgotado(o.nome);
      const priceLabel = esgotado
        ? `<span class="grp-opt-price" style="color:var(--muted);text-decoration:line-through">+ R$ ${fmt(o.preco||0)}</span>`
        : (o.preco > 0
          ? `<span class="grp-opt-price">+ R$ ${fmt(o.preco)}</span>`
          : `<span class="grp-opt-price free">Grátis</span>`);
      const indicator = g.tipo === 'checkbox'
        ? `<div class="grp-opt-indicator multi"></div>`
        : `<div class="grp-opt-indicator"></div>`;
      const qtyEl = g.tipo === 'checkbox' && !esgotado
        ? `<div class="grp-opt-qty" id="gqty_${_slug(g.nome)}_${_slug(o.nome)}">
             <button class="grp-qty-btn" onclick="event.stopPropagation();grpQty('${_escape(g.nome)}','${_escape(o.nome)}',${o.preco||0},-1)">−</button>
             <span class="grp-qty-num" id="gqnum_${_slug(g.nome)}_${_slug(o.nome)}">1</span>
             <button class="grp-qty-btn" onclick="event.stopPropagation();grpQty('${_escape(g.nome)}','${_escape(o.nome)}',${o.preco||0},1)">+</button>
           </div>` : '';
      const esgBadge = esgotado
        ? `<span class="grp-esg-badge" style="background:var(--s2);color:var(--muted);padding:3px 8px;border-radius:6px;font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;border:1px solid var(--border)">Esgotado</span>`
        : '';
      const clickAttr = esgotado ? '' : `onclick="grpToggle(this,'${_escape(g.nome)}','${_escape(o.nome)}',${o.preco||0},'${g.tipo}',${g.max||1})"`;
      const styleAttr = esgotado ? 'opacity:.5;cursor:not-allowed;pointer-events:none' : '';
      return `<div class="grp-opt-item${esgotado?' esgotado':''}" data-grupo="${_escape(g.nome)}" data-nome="${_escape(o.nome)}" data-preco="${o.preco||0}" data-tipo="${g.tipo}" ${clickAttr} style="${styleAttr}">
        <div class="grp-opt-left">${indicator}<span class="grp-opt-name">${o.nome}</span></div>
        <div style="display:flex;align-items:center;gap:8px">${esgBadge || priceLabel}${qtyEl}</div>
      </div>`;
    }).join('');

    // Detecta se é grupo de borda por tamanho
    const bordaMatch = g.nome.match(_bordaTamRegex);
    if (bordaMatch) {
      const bordaNomeBase = bordaMatch[1].trim();
      const bordaTam = bordaMatch[2].toUpperCase();
      return `<div class="grp-section" data-borda-tamanho="${bordaTam}" data-borda-grupo="${_escape(g.nome)}" style="display:none">
        <div class="grp-section-title">${bordaNomeBase} ${badge}</div>
        <div class="grp-opts">${optsHtml}</div>
      </div>`;
    }

    return `<div class="grp-section">
      <div class="grp-section-title">${g.nome} ${badge}</div>
      <div class="grp-opts">${optsHtml}</div>
    </div>`;
  }).join('');
}

// ── Renderiza modal de kit com ícones e lista de itens ──
function _renderKitGrupos(item, wrap, grupos) {
  const kitGrp        = grupos.find(g => g.tipo === 'kit_itens');
  const preparosGrp   = grupos.find(g => g.tipo === 'preparos');
  const ocasiaoGrp    = grupos.find(g => g.tipo === 'ocasiao');
  const armazenGrp    = grupos.find(g => g.tipo === 'armazenamento');
  let html = '';

  // ── Conteúdo do kit ──────────────────────────────────────
  if (kitGrp?.itens?.length) {
    const rows = kitGrp.itens.map(item => {
      // Tenta extrair quantidade e nome: "500g Bife de Patinho" → qty="500g", nome="Bife de Patinho"
      const match = item.match(/^(\d+\s*(?:g|kg|un|pç|pc|L|ml|x)?\s*)/i);
      const qty   = match ? match[1].trim() : '';
      const nome  = match ? item.slice(match[1].length).trim() : item;
      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <div style="width:36px;height:36px;border-radius:9px;background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.2);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M7 17c-2-2-3-5-1.5-8.5S11 3.5 15 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M17 7c2 1.5 3.5 5 2 8s-5 5-8 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.4"/></svg></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--text)">${nome}</div>
          ${qty ? `<div style="font-size:11.5px;color:var(--accent);font-weight:700;margin-top:1px">${qty}</div>` : ''}
        </div>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>`;
    }).join('');

    html += `<div class="ac-section">
      <div class="ac-section-title" style="margin-bottom:6px">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-right:5px"><rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5 3V2M11 3V2M2 7h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        Itens inclusos no kit
      </div>
      <div style="border:1px solid var(--border);border-radius:10px;padding:0 12px;overflow:hidden">${rows}</div>
    </div>`;
  }

  // ── Informações com ícones (preparos, ocasião, armazenamento) ──
  const _chipRow = (lista, titulo, iconeDefault) => {
    if (!lista?.opcoes?.length) return '';
    const chips = lista.opcoes.map(o => {
      const icon = o.icon
        ? `<img src="${o.icon}" style="width:28px;height:28px;object-fit:contain" onerror="this.style.display='none'">`
        : `<span style="font-size:20px">${iconeDefault}</span>`;
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 10px;background:var(--s2,#1a1a1a);border:1.5px solid var(--border);border-radius:10px;min-width:60px;text-align:center;flex-shrink:0">
        <div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.04);border-radius:8px">${icon}</div>
        <span style="font-size:10.5px;font-weight:600;color:var(--text);line-height:1.2">${o.nome || o.id}</span>
      </div>`;
    }).join('');
    return `<div style="margin-top:14px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.4px;text-transform:uppercase;margin-bottom:8px">${titulo}</div>
      <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;-webkit-overflow-scrolling:touch;scrollbar-width:none">${chips}</div>
    </div>`;
  };

  const infoHtml = [
    _chipRow(preparosGrp,  'Forma de preparo', '<svg width=\'20\' height=\'20\' viewBox=\'0 0 24 24\' fill=\'none\'><path d=\'M3 17h14a2 2 0 0 0 0-4H3\' stroke=\'currentColor\' stroke-width=\'1.5\' stroke-linecap=\'round\'/></svg>'),
    _chipRow(ocasiaoGrp,   'Tipo de ocasião',  '<svg width=\'20\' height=\'20\' viewBox=\'0 0 24 24\' fill=\'none\'><circle cx=\'12\' cy=\'12\' r=\'9\' stroke=\'currentColor\' stroke-width=\'1.5\'/><circle cx=\'12\' cy=\'12\' r=\'5\' stroke=\'currentColor\' stroke-width=\'1.4\'/><circle cx=\'12\' cy=\'12\' r=\'1.5\' fill=\'currentColor\'/></svg>'),
    _chipRow(armazenGrp,   'Armazenamento',    '<svg width=\'20\' height=\'20\' viewBox=\'0 0 24 24\' fill=\'none\'><path d=\'M12 3v18M3 12h18M5.5 5.5l13 13M18.5 5.5l-13 13\' stroke=\'currentColor\' stroke-width=\'1.4\' stroke-linecap=\'round\'/></svg>'),
  ].join('');

  if (infoHtml) {
    html += `<div class="ac-section" style="margin-top:6px">${infoHtml}</div>`;
  }

  wrap.innerHTML = html || '';
}

function _renderAcougueGrupos(item, wrap, grupos) {
  const cortesGrp  = grupos.find(g => g.tipo === 'cortes');
  const preparosGrp= grupos.find(g => g.tipo === 'preparos');
  let html = '';

  // ── Seção de cortes ──────────────────────────────────────
  if (cortesGrp?.opcoes?.length) {
    const cards = cortesGrp.opcoes.map(o => {
      const slug = _slug(o.nome || o.id);
      const imgUrl = [o.icon, o.image, o.img, o.image_url].find(v => v && (v.startsWith('http') || v.startsWith('/'))) || null;
      const ilustracao = imgUrl
        ? `<img src="${imgUrl}" alt="${o.nome||o.id}" style="width:68px;height:60px;object-fit:contain;display:block" >`
        : _getCorteIlus(o.nome||o.id);
      return `<div class="corte-card" id="corte-card-${slug}" onclick="openPesoSheet('${_escape(o.nome||o.id)}')">
        <div class="corte-card-illus">${ilustracao}</div>
        <div class="corte-card-name">${o.nome||o.id}</div>
        <div class="corte-card-hint" id="corte-hint-${slug}">Clique para adicionar</div>
      </div>`;
    }).join('');
    html += `<div class="ac-section">
      <div class="ac-section-title">Selecione o corte desejado</div>
      <div id="ac-encarte-banner" style="display:none;margin-bottom:10px;padding:10px 13px;background:rgba(34,197,94,.08);border:1.5px solid rgba(34,197,94,.25);border-radius:12px;font-size:12.5px;color:#4ade80;align-items:center;gap:8px">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span id="ac-encarte-txt">Peso do encarte já selecionado</span>
        <span style="margin-left:auto;font-size:11px;opacity:.7">Toque no corte para alterar</span>
      </div>
      <div class="corte-grid">${cards}</div>
      <div style="margin-top:10px;display:flex;flex-wrap:wrap;align-items:center;gap:4px">
        <span class="ac-peso-var">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Peso variável
        </span>
        <span class="ac-peso-total" id="ac-peso-total" style="display:none">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span id="ac-peso-total-txt">0g selecionados</span>
        </span>
      </div>
    </div>`;
  }

  // ── Seção de preparos ────────────────────────────────────
  if (preparosGrp?.opcoes?.length) {
    const chips = preparosGrp.opcoes.map(o => {
      const slug = _slug(o.nome || o.id);
      return `<div class="preparo-chip" id="preparo-chip-${slug}" onclick="togglePreparo('${_escape(o.nome||o.id)}',this)">
        <div class="preparo-chip-icon">${_getPreparoIcon(o.nome||o.id)}</div>
        <span>${o.nome||o.id}</span>
      </div>`;
    }).join('');
    html += `<div class="ac-section">
      <div class="ac-section-title">Forma de preparo</div>
      <div class="preparo-chips">${chips}</div>
    </div>`;
  }

  wrap.innerHTML = html;
}

// ── Input manual de gramas ───────────────────────────
function _manualGramasInput(val) {
  const g = parseInt(val);
  const wrap = document.getElementById('ac-manual-g-wrap');
  if (g > 0) {
    if (wrap) wrap.style.borderColor = 'var(--accent)';
    _drumUpdateBtn(g);
    // Deseleciona o drum visualmente
    document.querySelectorAll('#ac-peso-list .peso-picker-item').forEach(el => el.classList.remove('selected'));
  } else {
    if (wrap) wrap.style.borderColor = 'var(--border)';
    _drumUpdateBtn(0);
  }
}

function _manualKgInput(val) {
  const kg = parseFloat(val.replace(',', '.'));
  const g  = Math.round(kg * 1000);
  const wrap = document.getElementById('ac-manual-kg-wrap');
  if (g > 0) {
    if (wrap) wrap.style.borderColor = 'var(--accent)';
    _drumUpdateBtn(g);
    // Deseleciona os botões de kg visualmente
    document.querySelectorAll('#ac-kg-grid button').forEach(el => {
      el.style.borderColor = 'var(--border)';
      el.style.background  = 'var(--s2)';
      el.style.color       = 'var(--text)';
    });
  } else {
    if (wrap) wrap.style.borderColor = 'var(--border)';
    _drumUpdateBtn(0);
  }
}

// ── Abre o bottom sheet de peso para um corte ──
const _PICKER_ITEM_H = 42; // altura de cada item em px

function openPesoSheet(corteNome) {
  _acougueAtual = corteNome;
  document.getElementById('ac-peso-corte-nome').textContent = corteNome;

  const track    = document.getElementById('ac-peso-list');
  const pesoAtual = _acougueCortes[corteNome]?.peso || _acouguePesos[0] || 0;
  const idx0      = Math.max(0, _acouguePesos.indexOf(pesoAtual));

  // Monta itens do drum
  track.innerHTML =
    `<div class="peso-picker-spacer"></div>` +
    _acouguePesos.map((p, i) =>
      `<div class="peso-picker-item${i === idx0 ? ' selected' : ''}" data-peso="${p}" data-idx="${i}" onclick="_drumClick(${i})">${p}</div>`
    ).join('') +
    `<div class="peso-picker-spacer"></div>`;

  // Scrolla para o item correto sem animação
  track.scrollTo({ top: idx0 * _PICKER_ITEM_H, behavior: 'instant' });

  // Listener de scroll: atualiza seleção enquanto o usuário rola
  track._drumScrollHandler && track.removeEventListener('scroll', track._drumScrollHandler);
  track._drumScrollHandler = _drumOnScroll.bind(null, track);
  track.addEventListener('scroll', track._drumScrollHandler, { passive: true });

  // Restaura campos extras
  const estado = _acougueCortes[corteNome] || {};
  document.getElementById('ac-peso-sep').value = estado.separar || '';
  document.getElementById('ac-extra-textarea').value = estado.extra || '';
  const extraBody   = document.getElementById('ac-extra-body');
  const extraToggle = document.getElementById('ac-extra-toggle');
  if (estado.extra) { extraBody.classList.add('on'); extraToggle.classList.add('on'); }
  else              { extraBody.classList.remove('on'); extraToggle.classList.remove('on'); }

  // Botão confirmar já parte com o peso atual
  _drumUpdateBtn(pesoAtual);

  // Limpa inputs manuais
  const inpG  = document.getElementById('ac-manual-g');
  const inpKg = document.getElementById('ac-manual-kg');
  const wrapG  = document.getElementById('ac-manual-g-wrap');
  const wrapKg = document.getElementById('ac-manual-kg-wrap');
  if (inpG)  inpG.value  = '';
  if (inpKg) inpKg.value = '';
  if (wrapG)  wrapG.style.borderColor  = 'var(--border)';
  if (wrapKg) wrapKg.style.borderColor = 'var(--border)';

  document.getElementById('ac-peso-overlay').classList.add('on');
  document.body.style.overflow = 'hidden';
  // Aba padrão: quilos — item vendido por kg; gramas é opção de ajuste do cliente
  switchPesoTab('quilos');
}

function _drumOnScroll(track) {
  // Debounce: só age após parar de rolar
  clearTimeout(track._drumTimer);
  track._drumTimer = setTimeout(() => {
    const idx = Math.round(track.scrollTop / _PICKER_ITEM_H);
    const clipped = Math.max(0, Math.min(idx, _acouguePesos.length - 1));
    // Snap suave para o item mais próximo
    track.scrollTo({ top: clipped * _PICKER_ITEM_H, behavior: 'smooth' });
    // Atualiza classe selected
    track.querySelectorAll('.peso-picker-item').forEach((el, i) =>
      el.classList.toggle('selected', i === clipped)
    );
    _drumUpdateBtn(_acouguePesos[clipped]);
  }, 80);
}

function _drumClick(idx) {
  const track = document.getElementById('ac-peso-list');
  track.scrollTo({ top: idx * _PICKER_ITEM_H, behavior: 'smooth' });
  track.querySelectorAll('.peso-picker-item').forEach((el, i) =>
    el.classList.toggle('selected', i === idx)
  );
  _drumUpdateBtn(_acouguePesos[idx]);
  // Limpa input manual de gramas
  const inpG = document.getElementById('ac-manual-g');
  const wrapG = document.getElementById('ac-manual-g-wrap');
  if (inpG)  inpG.value = '';
  if (wrapG) wrapG.style.borderColor = 'var(--border)';
}

function _drumUpdateBtn(peso) {
  const btn = document.getElementById('ac-peso-confirm');
  btn.disabled = !peso;
  btn.textContent = peso ? `Confirmar ${peso}g` : 'Selecionar peso';
  btn.dataset.peso = peso || 0;
}

function closePesoSheet() {
  document.getElementById('ac-peso-overlay').classList.remove('on');
  document.body.style.overflow = '';
}

// ── Abas Gramas / Quilos ─────────────────────────────
function switchPesoTab(tab) {
  const tabG  = document.getElementById('ac-peso-tab-gramas');
  const tabQ  = document.getElementById('ac-peso-tab-quilos');
  const btnG  = document.getElementById('tab-gramas');
  const btnQ  = document.getElementById('tab-quilos');
  const isG   = tab === 'gramas';

  if (tabG) tabG.style.display = isG ? '' : 'none';
  if (tabQ) tabQ.style.display = isG ? 'none' : '';

  if (btnG) { btnG.style.background = isG ? 'var(--accent)' : 'transparent'; btnG.style.color = isG ? '#fff' : 'var(--muted)'; }
  if (btnQ) { btnQ.style.background = isG ? 'transparent' : 'var(--accent)'; btnQ.style.color = isG ? 'var(--muted)' : '#fff'; }

  if (!isG) _renderKgGrid();
}

function _renderKgGrid() {
  const grid = document.getElementById('ac-kg-grid');
  if (!grid) return;

  // Opções de kg: 0.5, 1, 1.5, 2, 2.5, 3, 4, 5 — filtra até o máximo dos pesos em g
  const maxGramas = Math.max(...(_acouguePesos || [0]));
  const kgOpts = [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000]
    .filter(g => !maxGramas || g <= maxGramas * 2); // permite até 2x o max de gramas

  // Pega o peso atual selecionado para destacar
  const btn       = document.getElementById('ac-peso-confirm');
  const pesoAtual = parseInt(btn?.dataset?.peso) || 0;

  grid.innerHTML = kgOpts.map(g => {
    const label = g >= 1000 ? (g / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' kg' : g + 'g';
    const ativo = g === pesoAtual;
    return `<button onclick="_selectKg(${g})" style="
      padding:14px 8px;border-radius:12px;border:2px solid ${ativo ? 'var(--accent)' : 'var(--border)'};
      background:${ativo ? 'rgba(var(--accent-rgb,249,115,22),.1)' : 'var(--s2)'};
      color:${ativo ? 'var(--accent)' : 'var(--text)'};
      font-size:14px;font-weight:700;cursor:pointer;transition:all .15s;font-family:inherit
    ">${label}</button>`;
  }).join('');
}

function _selectKg(gramas) {
  const corte = _acougueAtual;
  if (!corte) return;
  // Limpa input manual de kg
  const inpKg  = document.getElementById('ac-manual-kg');
  const wrapKg = document.getElementById('ac-manual-kg-wrap');
  if (inpKg)  inpKg.value = '';
  if (wrapKg) wrapKg.style.borderColor = 'var(--border)';

  const separar = document.getElementById('ac-peso-sep')?.value || '';
  const extra   = document.getElementById('ac-extra-textarea')?.value.trim() || '';

  _acougueCortes[corte] = { peso: gramas, separar, extra };

  // Atualiza o card visual do corte
  const slug = _slug(corte);
  const card = document.getElementById(`corte-card-${slug}`);
  const hint = document.getElementById(`corte-hint-${slug}`);
  if (card && hint) {
    card.classList.add('on');
    const label = gramas >= 1000
      ? (gramas / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'kg'
      : gramas + 'g';
    hint.innerHTML = `<span class="corte-card-badge">
      <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      ${label} ${corte}
      <span onclick="event.stopPropagation();cancelCorte('${_escape(corte)}')" title="Cancelar seleção"
        style="margin-left:5px;opacity:.7;font-size:11px;font-weight:900;line-height:1;cursor:pointer;padding:1px 3px;border-radius:3px"
        onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='.7'">✕</span>
    </span>`;
  }

  // Recalcula preço total
  _atualizaTotalPeso();
  _pesoConfirmadoPeloUsuario = true;
  closePesoSheet();
}

function selectPesoOpt(peso) {
  // mantido por compatibilidade — redireciona para drum
  const idx = _acouguePesos.indexOf(peso);
  if (idx >= 0) _drumClick(idx);
}

function confirmPesoSheet() {
  const corte = _acougueAtual;
  if (!corte) return;
  const btn = document.getElementById('ac-peso-confirm');
  const peso = parseInt(btn.dataset.peso) || _acougueCortes[corte]?.peso || 0;
  if (!peso) return;

  const separar = document.getElementById('ac-peso-sep').value;
  const extra   = document.getElementById('ac-extra-textarea').value.trim();

  _acougueCortes[corte] = { peso, separar, extra };

  // Atualiza card visual
  const slug = _slug(corte);
  const card = document.getElementById(`corte-card-${slug}`);
  const hint = document.getElementById(`corte-hint-${slug}`);
  if (card && hint) {
    card.classList.add('on');
    hint.innerHTML = `<span class="corte-card-badge">
      <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      ${peso}g ${corte}
      <span onclick="event.stopPropagation();cancelCorte('${_escape(corte)}')" title="Cancelar seleção"
        style="margin-left:5px;opacity:.7;font-size:11px;font-weight:900;line-height:1;cursor:pointer;padding:1px 3px;border-radius:3px"
        onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='.7'">✕</span>
    </span>`;
  }

  // Atualiza total
  _atualizaTotalPeso();
  _pesoConfirmadoPeloUsuario = true;
  closePesoSheet();
}

// ── Cancela seleção de um corte ───────────────────────
function cancelCorte(corteNome) {
  delete _acougueCortes[corteNome];
  const slug = _slug(corteNome);
  const card = document.getElementById(`corte-card-${slug}`);
  const hint = document.getElementById(`corte-hint-${slug}`);
  if (card) card.classList.remove('on');
  if (hint) hint.innerHTML = 'Clique para adicionar';
  _atualizaTotalPeso();
}

// ── Abre seletor de gramas direto pelo badge de porção ──
// Usado quando cliente toca em "Porção de Xg" na área do preço
function _openPorcaoQuickPicker(item, porcaoRef) {
  const cgs      = item.custom_groups || [];
  const pesosGrp = cgs.find(g => g.tipo === 'pesos');

  // Define os pesos disponíveis globalmente para o picker
  _acouguePesos = pesosGrp?.valores || [];
  if (!_acouguePesos.length) return;

  // Sempre abre com "Inteiro" — sem pré-selecionar corte existente
  openPesoSheet('Inteiro');
}

// ── Pré-seleciona corte/peso do encarte ao abrir o modal ──
function _autoSelecionarPorcaoRef(corteNome, pesoGramas, temCortes) {
  _acougueCortes[corteNome] = { peso: pesoGramas, separar: '', extra: '' };

  const label = pesoGramas >= 1000
    ? (pesoGramas / 1000).toFixed(1).replace('.', ',') + ' kg'
    : pesoGramas + 'g';

  if (temCortes) {
    // Atualiza visual do card de corte
    const slug = _slug(corteNome);
    const card = document.getElementById(`corte-card-${slug}`);
    const hint = document.getElementById(`corte-hint-${slug}`);
    if (card) card.classList.add('on');
    if (hint) hint.innerHTML = `<span class="corte-card-badge">${label}</span>`;
  } else {
    // Sem cortes: atualiza a pill de porção de referência para indicar seleção
    const porcaoEl = document.getElementById('im-porcao-ref');
    if (porcaoEl) {
      porcaoEl.style.background = 'rgba(34,197,94,.12)';
      porcaoEl.style.borderColor = 'rgba(34,197,94,.35)';
      porcaoEl.style.color = '#4ade80';
    }
  }

  // Banner informativo (só para items com cortes, para não poluir modal simples)
  if (temCortes) {
    const banner = document.getElementById('ac-encarte-banner');
    const bannerTxt = document.getElementById('ac-encarte-txt');
    if (banner) {
      banner.style.display = 'flex';
      if (bannerTxt) bannerTxt.textContent = `Peso do encarte (${label}) já selecionado ✓`;
    }
  }

  _atualizaTotalPeso();
}

function _atualizaTotalPeso() {
  const total = Object.values(_acougueCortes).reduce((s, v) => s + (v.peso || 0), 0);
  const el  = document.getElementById('ac-peso-total');
  const txt = document.getElementById('ac-peso-total-txt');
  if (!el || !txt) return;
  if (total > 0) {
    el.style.display = '';
    txt.textContent = total >= 1000
      ? (total / 1000).toFixed(1).replace('.', ',') + ' kg selecionados'
      : total + 'g selecionados';
  } else {
    el.style.display = 'none';
  }
  _updateImPrice();
}

function toggleAcExtra() {
  const toggle = document.getElementById('ac-extra-toggle');
  const body   = document.getElementById('ac-extra-body');
  toggle.classList.toggle('on');
  body.classList.toggle('on');
  if (body.classList.contains('on')) {
    document.getElementById('ac-extra-textarea').focus();
  }
}

function togglePreparo(nome, el) {
  el.classList.toggle('on');
  if (!_imGruposState['preparos']) _imGruposState['preparos'] = [];
  const state = _imGruposState['preparos'];
  const idx = state.findIndex(o => o.nome === nome);
  if (idx !== -1) state.splice(idx, 1);
  else state.push({ nome, preco: 0, qty: 1 });
}

// ── Açougue: monta descrição para o carrinho ──
function _buildAcougueDesc() {
  const partes = [];
  for (const [corte, v] of Object.entries(_acougueCortes)) {
    if (!v.peso) continue;
    let txt = `${v.peso}g ${corte}`;
    if (v.separar) txt += ` (${v.separar})`;
    if (v.extra)   txt += ` [${v.extra}]`;
    partes.push(txt);
  }
  const preparos = (_imGruposState['preparos'] || []).map(o => o.nome).join(', ');
  if (preparos) partes.push('Preparo: ' + preparos);
  return partes.join(' · ');
}

function _slug(s) { return (s||'').replace(/[^a-z0-9]/gi,'_').toLowerCase(); }
function _escape(s) { return (s||'').replace(/'/g,"\'").replace(/"/g,'&quot;'); }

// ══════════════════════════════════════════
//  INDICAÇÕES DE PREPARO — Bottom sheet público
// ══════════════════════════════════════════
function openPreparoDetail(preparoId) {
  // Coleta itens que têm este preparo
  const itensComPreparo = allItems.filter(i => {
    if (i.status === 'pausado' || i.status === 'esgotado') return false;
    const cgs = i.custom_groups || [];
    const grp = cgs.find(g => g.tipo === 'preparos');
    if (!grp?.opcoes) return false;
    return grp.opcoes.some(o => (o.id || o.nome || o).toLowerCase().replace(/\s+/g,'_') === preparoId.toLowerCase());
  });

  const nomePreparo = typeof _getPreparoFilterNome === 'function'
    ? _getPreparoFilterNome(preparoId)
    : (preparoId.charAt(0).toUpperCase() + preparoId.slice(1));
  const iconPreparo = _preparoImgMap[preparoId] || null;

  document.getElementById('preparo-detail-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'preparo-detail-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:8500;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(3px)';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const itensHTML = !itensComPreparo.length
    ? `<div style="text-align:center;padding:32px 0;color:var(--muted);font-size:13px">
        <div style="margin-bottom:10px;opacity:.4"><svg width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="14" cy="14" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M20 20l6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></div>
        Nenhuma carne indicada para este preparo.
       </div>`
    : itensComPreparo.map(i => {
        const cgs       = i.custom_groups || [];
        const cortesGrp = cgs.find(g => g.tipo === 'cortes');
        const pesosGrp  = cgs.find(g => g.tipo === 'pesos');
        const porcaoGrp = cgs.find(g => g.tipo === 'porcao_ref');
        const cortes = (cortesGrp?.opcoes || []).map(o => o.nome || o.id).join(' · ');
        const porcao = porcaoGrp?.gramas || null;
        const pesos  = (pesosGrp?.valores || []).map(p => `${p}g`).join(' / ');

        const imgEl = i.image_url
          ? `<img src="${i.image_url}" style="width:100%;height:100%;object-fit:cover;border-radius:10px">`
          : `<span style="font-size:30px"><svg width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='M7 17c-2-2-3-5-1.5-8.5S11 3.5 15 5' stroke='currentColor' stroke-width='1.5' stroke-linecap='round'/><circle cx='12' cy='12' r='3' stroke='currentColor' stroke-width='1.4'/></svg></span>`;

        return `<div onclick="closePreparoDetail();openItemModal(${i.id})" style="display:flex;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid var(--border);cursor:pointer;-webkit-tap-highlight-color:transparent" onmouseenter="this.style.opacity='.8'" onmouseleave="this.style.opacity='1'">
          <div style="width:56px;height:56px;border-radius:10px;overflow:hidden;flex-shrink:0;background:var(--surface2);display:flex;align-items:center;justify-content:center">${imgEl}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.name}</div>
            ${cortes ? `<div style="font-size:11.5px;color:var(--muted);margin-top:3px">Cortes: ${cortes}</div>` : ''}
            ${porcao ? `<div style="font-size:11.5px;color:var(--accent);font-weight:700;margin-top:2px">Ref: ${porcao}g</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-weight:800;font-size:14px">R$ ${fmt(i.price)}<span style="font-size:10px;font-weight:400;color:var(--muted)">/kg</span></div>
            ${pesos ? `<div style="font-size:10.5px;color:var(--muted);margin-top:2px">${pesos}</div>` : ''}
            <div style="font-size:10px;color:var(--accent);margin-top:3px;font-weight:600">Ver detalhes →</div>
          </div>
        </div>`;
      }).join('');

  overlay.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--surface);border-radius:20px 20px 0 0;width:100%;max-width:540px;max-height:86vh;display:flex;flex-direction:column">
    <!-- Handle -->
    <div style="padding:12px 20px 0;flex-shrink:0">
      <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto"></div>
    </div>
    <!-- Header -->
    <div style="padding:14px 20px 12px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;gap:14px">
      <div style="width:48px;height:48px;border-radius:12px;background:var(--surface2);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">
        ${iconPreparo ? `<img src="${iconPreparo}" style="width:36px;height:36px;object-fit:contain" onerror="this.parentElement.innerHTML='<svg width=\'24\' height=\'24\' viewBox=\'0 0 24 24\' fill=\'none\'><path d=\'M7 17c-2-2-3-5-1.5-8.5S11 3.5 15 5\' stroke=\'currentColor\' stroke-width=\'1.5\' stroke-linecap=\'round\'/><circle cx=\'12\' cy=\'12\' r=\'3\' stroke=\'currentColor\' stroke-width=\'1.4\'/></svg>'">` : '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M7 17c-2-2-3-5-1.5-8.5S11 3.5 15 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.4"/></svg>'}
      </div>
      <div style="flex:1">
        <div style="font-weight:800;font-size:16px">${nomePreparo}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">
          ${itensComPreparo.length} carne${itensComPreparo.length !== 1 ? 's' : ''} indicada${itensComPreparo.length !== 1 ? 's' : ''} · toque para ver e pedir
        </div>
      </div>
      <button onclick="closePreparoDetail()" style="border:none;background:var(--surface2);border-radius:50%;width:34px;height:34px;cursor:pointer;color:var(--muted);font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
    </div>
    <!-- Lista de itens -->
    <div style="overflow-y:auto;flex:1;padding:0 20px">
      ${itensHTML}
    </div>
    <!-- Rodapé -->
    <div style="padding:14px 20px;flex-shrink:0;border-top:1px solid var(--border)">
      <button onclick="closePreparoDetail()" style="width:100%;padding:12px;background:var(--surface2);border:1px solid var(--border);border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;color:var(--text);font-family:inherit">Fechar</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);
}

function closePreparoDetail() {
  document.getElementById('preparo-detail-overlay')?.remove();
}

function grpToggle(el, grupoNome, optNome, preco, tipo, maxSel) {
  // Defesa: se o adicional foi marcado como esgotado, ignora o clique
  if (typeof _isAddonEsgotado === 'function' && _isAddonEsgotado(optNome)) {
    if (typeof toast === 'function') toast('warn', `${optNome} está esgotado`);
    return;
  }
  if (!_imGruposState[grupoNome]) _imGruposState[grupoNome] = [];
  const state = _imGruposState[grupoNome];

  if (tipo === 'radio') {
    // Deselect all in group, select this one
    el.closest('.grp-opts').querySelectorAll('.grp-opt-item').forEach(e => e.classList.remove('on'));
    _imGruposState[grupoNome] = [{ nome: optNome, preco, qty: 1 }];
    el.classList.add('on');
  } else {
    // checkbox
    const idx = state.findIndex(o => o.nome === optNome);
    if (idx !== -1) {
      state.splice(idx, 1);
      el.classList.remove('on');
      // hide qty stepper
      const qtyEl = document.getElementById(`gqty_${_slug(grupoNome)}_${_slug(optNome)}`);
      if (qtyEl) qtyEl.classList.remove('show');
    } else {
      const totalSel = state.reduce((s,o) => s + (o.qty||1), 0);
      if (maxSel > 1 && totalSel >= maxSel) {
        toast('warn', `Máximo ${maxSel} opções para ${grupoNome}`);
        return;
      }
      state.push({ nome: optNome, preco, qty: 1 });
      el.classList.add('on');
      // show qty stepper for checkbox
      const qtyEl = document.getElementById(`gqty_${_slug(grupoNome)}_${_slug(optNome)}`);
      if (qtyEl) qtyEl.classList.add('show');
    }
  }

  // ── Borda condicional por tamanho ──
  // Quando seleciona tamanho, mostra apenas o grupo de borda correspondente
  if (grupoNome.toLowerCase() === 'tamanho' && tipo === 'radio') {
    const tamanhoKey = optNome.match(/\(([PMG])\)/i)?.[1]?.toUpperCase() || '';
    document.querySelectorAll('.grp-section[data-borda-tamanho]').forEach(sec => {
      const bordaTam = sec.dataset.bordaTamanho;
      if (bordaTam === tamanhoKey) {
        sec.style.display = '';
      } else {
        sec.style.display = 'none';
        // Limpa seleção da borda oculta
        const nomeGrp = sec.dataset.bordaGrupo;
        if (nomeGrp && _imGruposState[nomeGrp]) {
          delete _imGruposState[nomeGrp];
          sec.querySelectorAll('.grp-opt-item.on').forEach(e => e.classList.remove('on'));
        }
      }
    });
  }

  // Animação ingrediente voando
  const vtype = _itemVisualType(allItems.find(x => x.id === _imItemId));
  if (vtype === 'acai' || vtype === 'marmita') {
    const wasAdded = el.classList.contains('on');
    if (wasAdded) {
      _dropIngredient(optNome, el);
    } else {
      _lowerFillLevel();
    }
  }
  if (vtype === 'burger') {
    const wasAdded = el.classList.contains('on');
    if (wasAdded) _addBurgerLayer(optNome);
    else          _removeBurgerLayer(optNome);
  }
  _updateImPrice();
}

function grpQty(grupoNome, optNome, preco, delta) {
  if (!_imGruposState[grupoNome]) return;
  const opt = _imGruposState[grupoNome].find(o => o.nome === optNome);
  if (!opt) return;
  opt.qty = Math.max(1, (opt.qty||1) + delta);
  const el = document.getElementById(`gqnum_${_slug(grupoNome)}_${_slug(optNome)}`);
  if (el) el.textContent = opt.qty;
  _updateImPrice();
}

function _calcGruposExtra(item) {
  let extra = 0;
  const grupos = item.custom_groups || [];
  const hasPizzaSizes = typeof _pizzaHasSizePricing === 'function' && _pizzaHasSizePricing(item);
  const isPizza = typeof isPizzaItem === 'function' && isPizzaItem(item);
  for (const g of grupos) {
    if (g?.tipo === 'pizza_sizes') continue;
    if (hasPizzaSizes && (g.nome||'').toLowerCase().trim() === 'tamanho') continue;
    if (isPizza && typeof _pizzaShouldSkipSizedGroup === 'function' && _pizzaShouldSkipSizedGroup(g)) continue;
    const sel = _imGruposState[g.nome] || [];
    for (const o of sel) extra += (o.preco||0) * (o.qty||1);
  }
  return extra;
}

function _buildGruposDesc(item) {
  const grupos = item.custom_groups || [];
  const parts = [];
  const hasPizzaSizes = typeof _pizzaHasSizePricing === 'function' && _pizzaHasSizePricing(item);
  const isPizza = typeof isPizzaItem === 'function' && isPizzaItem(item);
  for (const g of grupos) {
    if (g?.tipo === 'pizza_sizes') continue;
    if (hasPizzaSizes && (g.nome||'').toLowerCase().trim() === 'tamanho') continue;
    if (isPizza && typeof _pizzaShouldSkipSizedGroup === 'function' && _pizzaShouldSkipSizedGroup(g)) continue;
    const sel = _imGruposState[g.nome] || [];
    if (sel.length) {
      const names = sel.map(o => {
        const qtyPrefix = o.qty > 1 ? `${o.qty}x ` : '';
        const preco = o.preco > 0
          ? ` (+R$ ${parseFloat(o.preco).toFixed(2).replace('.', ',')})`
          : '';
        return `${qtyPrefix}${o.nome}${preco}`;
      }).join(', ');
      parts.push(`${g.nome}: ${names}`);
    }
  }
  return parts.join(' · ');
}

function _updateImPrice() {
  const i = allItems.find(x => x.id === _imItemId);
  if (!i) return;
  const extra = _calcGruposExtra(i);
  const isPizza = typeof isPizzaItem === 'function' && isPizzaItem(i);

  // Para açougue: preço proporcional ao peso selecionado
  let basePrice = (isPizza && typeof _pizzaCurrentBasePrice === 'function')
    ? _pizzaCurrentBasePrice(i, (typeof _halfItem !== 'undefined' ? _halfItem : null)) + extra
    : i.price + extra;
  if (_isAcougueItem(i)) {
    const totalPeso = Object.values(_acougueCortes).reduce((s, v) => s + (v.peso || 0), 0);
    if (totalPeso > 0) {
      basePrice = (i.price + extra) * (totalPeso / 1000);
    }
  }

  const total = basePrice * _imQty;
  const btn = document.getElementById('im-add-btn');
  const priceEl = document.getElementById('im-price');
  if (priceEl) {
    const awaitingPizzaSize = isPizza && typeof _pizzaHasSizePricing === 'function' && _pizzaHasSizePricing(i) && (typeof _pizzaSizeKey === 'undefined' || !_pizzaSizeKey);
    priceEl.textContent = (awaitingPizzaSize ? 'A partir de R$ ' : 'R$ ') + fmt(awaitingPizzaSize && typeof _pizzaMinPrice === 'function' ? _pizzaMinPrice(i) : basePrice);
  }
  if (isPizza && typeof updateImAddBtn === 'function') {
    updateImAddBtn();
    return;
  }
  if (btn && _lojaAberta) btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2h1.5l1.8 7.5h6.5l1.2-5H5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="13" r="1" fill="currentColor"/><circle cx="12" cy="13" r="1" fill="currentColor"/></svg> Adicionar · R$ ${fmt(total)}`;
}

// Cross-sell: suggest items from other categories
function renderImXsell(item) {
  const wrap = document.getElementById('im-xsell-wrap');
  if (!wrap) return;
  const itemCat = item.cat_key || item.cat || '';
  // Get up to 8 items from different categories
  const others = allItems.filter(x =>
    x.id !== item.id &&
    x.status !== 'pausado' && x.status !== 'esgotado' &&
    (x.cat_key || x.cat) !== itemCat
  ).slice(0, 8);
  if (!others.length) { wrap.innerHTML = ''; return; }

  const cards = others.map(o => `
    <div class="xsell-card" id="xsell_${o.id}" onclick="xsellToggle(${o.id})" style="position:relative">
      <div class="xsell-img">${o.image_url ? `<img src="${o.image_url}" >` : (o.emoji||'')}</div>
      <div class="xsell-body">
        <div class="xsell-name">${o.name}</div>
        <div class="xsell-price">R$ ${fmt(o.price)}</div>
      </div>
      <div class="xsell-check">✓</div>
    </div>`).join('');

  wrap.innerHTML = `<div class="xsell-section">
    <div class="xsell-title">Adicionar ao pedido</div>
    <div class="xsell-scroll">${cards}</div>
  </div>`;
}

// Cross-sell state
const _xsellSelected = new Set();

function xsellToggle(itemId) {
  const card = document.getElementById(`xsell_${itemId}`);
  if (!card) return;
  if (_xsellSelected.has(itemId)) {
    _xsellSelected.delete(itemId);
    card.classList.remove('on');
  } else {
    _xsellSelected.add(itemId);
    card.classList.add('on');
  }
}

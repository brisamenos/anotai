// ══════════════════════════════════════════
//  MENU — Categorias, busca, renderMenu, itemCard, checklist
//  Estima Food — Cardápio
// ══════════════════════════════════════════
function buildCats() {
  const scroll = document.getElementById('cats-scroll');
  const isAcougue = _segmento === 'acougue';
  const isModerno = document.documentElement.getAttribute('data-tema') === 'moderno';
  const useCarrossel = isAcougue || _catsCarrossel || isModerno;

  scroll.classList.toggle('carousel', useCarrossel);
  scroll.innerHTML = '';

  const _catSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.4"/><rect x="13" y="3" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="13" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.4"/><rect x="13" y="13" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.4"/></svg>`;
  const _allSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.4"/><path d="M8 12h8M12 8v8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;

  // Fallback inteligente: quando a categoria não tem emoji/imagem configurada,
  // tenta adivinhar um emoji pelo nome em vez de mostrar o ícone genérico de
  // quadradinhos (bem feio). Só usa o quadradinho se nada bater.
  const _emojiPorNome = (nome) => {
    const n = (nome || '').toLowerCase();
    const mapa = [
      [/pizza/, '🍕'], [/a[çc]a[íi]/, '🍧'], [/hamb[uú]rguer|burger|lanche/, '🍔'],
      [/bebida|refri|suco|drink/, '🥤'], [/sobremesa|doce|sorvete/, '🍰'],
      [/salada|natural|saud[aá]vel/, '🥗'], [/massa|macarr[ãa]o|lasanha/, '🍝'],
      [/sushi|japon[eê]s|temaki/, '🍣'], [/carne|churrasco|espeto|grelhado/, '🥩'],
      [/frango/, '🍗'], [/pastel|salgado/, '🥟'], [/caf[eé]|padaria|p[ãa]o/, '☕'],
      [/pipoca/, '🍿'], [/vinho|cerveja|bebida.?alco[oó]lica/, '🍷'],
      [/porç[ãa]o|petisco|entrada/, '🍟'], [/marmita|prato.?feito/, '🍱'],
    ];
    const achou = mapa.find(([re]) => re.test(n));
    return achou ? achou[1] : null;
  };

  if (useCarrossel) {
    const all = document.createElement('button');
    all.className = 'cat-btn on';
    all.dataset.key = '';
    all.onclick = () => filterCat(all, '');
    all.innerHTML = `<div class="cat-btn-icon">${_allSvg}</div>Tudo`;
    scroll.appendChild(all);
    allCats.forEach(c => {
      const b = document.createElement('button');
      b.className = 'cat-btn';
      b.dataset.key = c.name;
      b.onclick = () => filterCat(b, c.name);
      const emojiFallback = isModerno ? _emojiPorNome(c.label || c.name) : null;
      const iconHtml = c.image_url
        ? `<img src="${c.image_url}" alt="${c.label||c.name}" loading="lazy" decoding="async">`
        : (c.emoji
            ? `<span style="font-size:16px;line-height:1">${c.emoji}</span>`
            : (emojiFallback
                ? `<span style="font-size:20px;line-height:1">${emojiFallback}</span>`
                : _catSvg));
      b.innerHTML = `<div class="cat-btn-icon">${iconHtml}</div>${c.label || c.name}`;
      scroll.appendChild(b);
    });
  } else {
    const all = document.createElement('button');
    all.className = 'cat-btn on';
    all.dataset.key = '';
    all.onclick = () => filterCat(all, '');
    all.textContent = 'Tudo';
    scroll.appendChild(all);
    allCats.forEach(c => {
      const b = document.createElement('button');
      b.className = 'cat-btn';
      b.dataset.key = c.name;
      b.onclick = () => filterCat(b, c.name);
      if (c.image_url) {
        b.innerHTML = `<span class="cat-btn-pill-icon"><img src="${c.image_url}" alt="" loading="lazy" decoding="async"></span>${c.label || c.name}`;
      } else {
        b.textContent = (c.emoji ? c.emoji + ' ' : '') + (c.label || c.name);
      }
      scroll.appendChild(b);
    });
  }
}

function filterCat(el, key) {
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  activeCat = key;
  _filterPreparo = '';
  renderPreparoFilterSection();
  renderMenu();
}

function verMaisCat(key) {
  const btn = document.querySelector('.cats-scroll .cat-btn[data-key="' + CSS.escape(key) + '"]');
  if (btn) {
    filterCat(btn, key);
    btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
  const bar = document.querySelector('.sticky-bar');
  if (bar) bar.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Vitrine "Compre por categoria" — cards grandes com foto ──
// Só aparece no visual do açougue (CSS controla isso), reaproveita as
// mesmas categorias e o mesmo filtro dos chips de sempre.
function buildCategoriaShowcase() {
  const wrap = document.getElementById('cats-showcase');
  if (!wrap) return;
  const cats = (allCats || []).filter(c => c.type !== 'checklist' && c.image_url);
  if (!cats.length || _segmento !== 'acougue') { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `
    <div class="cats-showcase-title">Compre por categoria</div>
    <div class="cats-showcase-scroll">
      ${cats.map(c => `
        <div class="cats-showcase-card" onclick="verMaisCat('${c.name.replace(/'/g,"\\'")}')">
          <img src="${c.image_url}" alt="${c.label || c.name}" loading="lazy" decoding="async">
          <div class="cats-showcase-name">${c.label || c.name}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function onSearch(val) {
  searchQ = val.trim().toLowerCase();
  renderMenu();
}

// ══════════════════════════════════════════
//  SEÇÃO "NÃO SABE QUAL CARNE?" — Açougue
// ══════════════════════════════════════════
function _getPreparoFilterNome(id) {
  const map = {
    grelha: 'Grelha', espeto: 'Espeto', frigideira: 'Frigideira',
    airfryer: 'Airfryer', churrasco: 'Churrasco', forno: 'Forno',
    panela: 'Panela', ensopado: 'Ensopado', grelhado: 'Grelhado',
    defumado: 'Defumado', dia_a_dia: 'Dia a dia',
  };
  return map[id] || (id.charAt(0).toUpperCase() + id.slice(1));
}

// Coleta todos os preparos disponíveis nos itens do cardápio: id -> nome
function _collectAllPreparos() {
  const allPreparos = new Map();
  allItems.forEach(i => {
    const cgs = i.custom_groups || [];
    const grp = cgs.find(g => g.tipo === 'preparos');
    if (grp?.opcoes) {
      grp.opcoes.forEach(o => {
        const id = (o.id || o.nome || o).toLowerCase().replace(/\s+/g,'_');
        if (!allPreparos.has(id)) allPreparos.set(id, o.nome || _getPreparoFilterNome(id));
      });
    }
  });
  return allPreparos;
}

// Ícone (ou vídeo) de um preparo, com cache-busting. Usado tanto no card do
// modal "Não sabe qual carne escolher?" quanto no banner de filtro ativo.
// Se o admin subiu vídeo pra esse preparo (_preparoVideoTags, definido em
// cardapio-acougue.js), mostra o vídeo em loop mudo em vez da imagem —
// nesse caso o CSS não força mais pra branco (ver regras ".preparo-filter-
// card-icon video" / ".preparo-filter-active-banner-icon video" no index.html).
function _preparoCardIconHtml(id, nome) {
  const _prepV = (typeof _iconesVer !== 'undefined' && _iconesVer) ? ('?v=' + _iconesVer) : '';
  if (typeof _preparoVideoTags !== 'undefined' && _preparoVideoTags.has(id)) {
    return `<video src="${_IMG_TAGS}/${id}.mp4${_prepV}" autoplay muted loop playsinline disablepictureinpicture aria-label="${nome}"></video>`;
  }
  return _preparoImgMap[id]
    ? `<img src="${_preparoImgMap[id]}${_prepV}" alt="${nome}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${_preparoImgMap[id]}'">`
    : `<svg width="28" height="28" viewBox="0 0 32 32" fill="none"><path d="M10 22c-2-2-3-5-1.5-8s5-4.5 8-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M22 10c2 1 3 4 1.5 7S19 21 16 20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="16" cy="16" r="3" stroke="currentColor" stroke-width="1.4"/></svg>`;
}

// Seção do início agora é só o robozinho com a placa — toque abre o modal
// com os ícones de preparo (openPreparoIconsModal).
function renderPreparoFilterSection() {
  const el = document.getElementById('preparo-filter-section');
  if (!el) return;
  if (_segmento !== 'acougue') { el.style.display = 'none'; return; }

  const allPreparos = _collectAllPreparos();
  if (allPreparos.size === 0) { el.style.display = 'none'; return; }

  el.style.display = '';
  el.innerHTML = `
    <div class="preparo-robot-wrap" onclick="openPreparoIconsModal()">
      <div class="preparo-robot-scene">
        <div class="preparo-robot">
          <div class="preparo-robot-antenna"></div>
          <div class="preparo-robot-head">
            <div class="preparo-robot-eye"></div>
            <div class="preparo-robot-eye"></div>
          </div>
          <div class="preparo-robot-body">
            <div class="preparo-robot-arm preparo-robot-arm-l"></div>
            <div class="preparo-robot-arm preparo-robot-arm-r"></div>
          </div>
        </div>
        <div class="preparo-robot-sign">
          <div class="preparo-robot-sign-pole"></div>
          <div class="preparo-robot-sign-board">Indicação</div>
        </div>
      </div>
      <div class="preparo-robot-caption">Não sabe qual carne escolher? Toque aqui</div>
    </div>
  `;
}

// Modal com os ícones de preparo (o que antes ficava direto no início).
function openPreparoIconsModal() {
  document.getElementById('preparo-icons-overlay')?.remove();
  const allPreparos = _collectAllPreparos();
  if (!allPreparos.size) return;

  let cards = '';
  allPreparos.forEach((nome, id) => {
    const isOn = _filterPreparo === id;
    cards += `<div class="preparo-filter-card${isOn ? ' on' : ''}" onclick="setFilterPreparo('${id}');closePreparoIconsModal();">
      <div class="preparo-filter-card-icon">${_preparoCardIconHtml(id, nome)}</div>
      <div class="preparo-filter-card-label">${nome}</div>
    </div>`;
  });
  if (_filterPreparo) {
    cards += `<div class="preparo-filter-clear" onclick="setFilterPreparo('');closePreparoIconsModal();" title="Limpar filtro" style="align-self:center">
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>
    </div>`;
  }

  const overlay = document.createElement('div');
  overlay.id = 'preparo-icons-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:8500;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(3px)';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--surface);border-radius:20px 20px 0 0;width:100%;max-width:540px;max-height:82vh;display:flex;flex-direction:column">
    <div style="padding:12px 20px 0;flex-shrink:0">
      <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto"></div>
    </div>
    <div style="padding:16px 20px 4px;flex-shrink:0">
      <div class="section-label" style="padding:0">Não sabe qual carne escolher?</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">Selecione como quer preparar e veja nossas indicações.</div>
    </div>
    <div style="overflow-y:auto;flex:1;padding:14px 20px 6px;display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px;justify-items:center">
      ${cards}
    </div>
    <div style="padding:14px 20px;flex-shrink:0;border-top:1px solid var(--border)">
      <button onclick="closePreparoIconsModal()" style="width:100%;padding:12px;background:var(--surface2);border:1px solid var(--border);border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;color:var(--text);font-family:inherit">Fechar</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);
}

function closePreparoIconsModal() {
  document.getElementById('preparo-icons-overlay')?.remove();
}

function setFilterPreparo(id) {
  _filterPreparo = (_filterPreparo === id) ? '' : id;
  renderPreparoFilterSection();
  renderMenu();
  // Rola suavemente até os resultados quando ativa o filtro
  if (_filterPreparo) {
    setTimeout(() => {
      const banner = document.getElementById('preparo-active-banner');
      if (banner) banner.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }
}

// ══════════════════════════════════════════
//  RENDER MENU
// ══════════════════════════════════════════
function getFiltered() {
  return allItems.filter(i => {
    if (activeCat && i.cat_key !== activeCat && i.cat !== activeCat) return false;
    if (searchQ && !i.name.toLowerCase().includes(searchQ) && !(i.description||'').toLowerCase().includes(searchQ)) return false;
    if (_filterPreparo) {
      const cgs = i.custom_groups || [];
      const preparosGrp = cgs.find(g => g.tipo === 'preparos');
      if (!preparosGrp) return false;
      const opcoes = (preparosGrp.opcoes || []).map(o => (o.id || o.nome || o).toLowerCase());
      if (!opcoes.includes(_filterPreparo.toLowerCase())) return false;
    }
    return true;
  });
}

function renderMenu() {
  const filtered = getFiltered();

  // Separa categorias checklist das normais
  const checklistCats = allCats.filter(c => c.type === 'checklist');
  const checklistKeys = new Set(checklistCats.map(c => c.name));

  const normalItems = filtered.filter(i => !checklistKeys.has(i.cat_key) && !checklistKeys.has(i.cat));

  if (!normalItems.length && !checklistCats.length) {
    document.getElementById('menu-wrap').innerHTML =
      '<div class="empty-state"><div class="empty-state-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="14" cy="14" r="8" stroke="currentColor" stroke-width="1.8"/><path d="M20 20l6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></div><div class="empty-state-text">' + (_filterPreparo ? `Nenhuma carne cadastrada para preparo "${_getPreparoFilterNome(_filterPreparo)}".` : 'Nenhum item encontrado.') + '</div></div>';
    return;
  }

  let html = '<div>';

  // ── Seção Destaques — açougue: acima das indicações; restaurante: posição normal ──
  // Um item entra em Destaques se: foi marcado individualmente (i.destaque)
  // OU pertence a uma categoria marcada inteira como destaque (cat.promo).
  const _catsPromo = new Set(allCats.filter(c => c.promo).map(c => c.name));
  const _ehDestaque = (i) => i.destaque || _catsPromo.has(i.cat_key) || _catsPromo.has(i.cat);
  if (_segmento === 'acougue' && !searchQ && !activeCat && !_filterPreparo) {
    const destItems = normalItems.filter(_ehDestaque);
    if (destItems.length) {
      html += `<div class="destaques-wrap"><div class="section-label">Destaques</div>`;
      html += `<div class="destaques-scroll">`;
      destItems.forEach(i => {
        const esg = i.status === 'esgotado';
        html += `
        <div class="dest-card" ${esg?'':'onclick="openItemModal('+i.id+')"'}>
          <div class="dest-img${i.image_url ? ' has-photo' : ''}">
            ${i.image_url ? `<img src="${i.image_url}" alt="${i.name}" loading="lazy" decoding="async">` : `<span>${''}</span>`}
            <span class="dest-promo-badge">${i.price_old?'OFERTA':'PROMO'}</span>
          </div>
          <div class="dest-body">
            <div class="dest-name">${i.name}</div>
            <div class="dest-prices">
              ${i.price_old?`<span class="dest-price-old">R$ ${fmt(i.price_old)}</span>`:''}
              <span class="dest-price">R$ ${fmt(i.price)}</span>
            </div>
          </div>
        </div>`;
      });
      html += `</div></div>`;
    }
  }

  // ── Banner de filtro de preparo ativo ──
  if (_filterPreparo) {
    const nomePrep = _getPreparoFilterNome(_filterPreparo);
    const iconPrep = _preparoImgMap[_filterPreparo];
    const iconHtml = iconPrep
      ? `<div class="preparo-filter-active-banner-icon">${_preparoCardIconHtml(_filterPreparo, nomePrep)}</div>`
      : '';
    const totalFiltrado = normalItems.length;
    html += `<div class="preparo-filter-active-banner" id="preparo-active-banner">
      <div class="preparo-filter-active-banner-left">
        ${iconHtml}
        <span>Carnes para <strong>${nomePrep}</strong></span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="preparo-filter-active-count">${totalFiltrado} item${totalFiltrado !== 1 ? 's' : ''}</span>
        <div class="preparo-filter-clear-btn" onclick="setFilterPreparo('')">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          Limpar
        </div>
      </div>
    </div>`;
  }

  if (searchQ || activeCat) {
    // Em busca/filtro, mostra só cards normais
    if (normalItems.length) {
      const gridClass = (_segmento === 'acougue' || _catsCarrossel) ? 'item-grid carousel' : 'item-grid';
      html += `<div class="${gridClass}">${normalItems.map(itemCard).join('')}</div>`;
    }
    // Se o filtro for de uma categoria checklist, mostra ela expandida
    const filteredChecklistCat = checklistCats.find(c => c.name === activeCat || c.label === activeCat);
    if (filteredChecklistCat) {
      const catItems = allItems.filter(i => i.cat_key === filteredChecklistCat.name || i.cat === filteredChecklistCat.label);
      html += renderChecklistSection(filteredChecklistCat, catItems, true);
    }
    html += '</div>';
    const _menuWrapEl2 = document.getElementById('menu-wrap');
    _menuWrapEl2.innerHTML = html;
    fixIosVideoAutoplay(_menuWrapEl2);
    return;
  }

  // Renderiza grupos normais
  // ── Destaques para restaurante (posição original, entre filtro e grupos) ──
  if (_segmento !== 'acougue' && !searchQ && !activeCat) {
    const destItems = normalItems.filter(_ehDestaque);
    if (destItems.length) {
      html += `<div class="destaques-wrap"><div class="section-label">Mais Pedidos</div><div class="destaques-scroll">`;
      destItems.forEach(i => {
        const esg = i.status === 'esgotado';
        const destMedia = i.video_url
          ? `<video src="${i.video_url}" autoplay muted loop playsinline preload="metadata" onerror="itemCardVideoFallback(this,'${(i.image_url||'').replace(/'/g,'%27')}','${(i.name||'').replace(/'/g,'%27')}')"></video>`
          : (i.image_url ? `<img src="${i.image_url}" alt="${i.name}" loading="lazy" decoding="async">` : '');
        html += `<div class="dest-card" ${esg?'':'onclick="openItemModal('+i.id+')"'}><div class="dest-img${(i.image_url||i.video_url)?' has-photo':''}">${destMedia}<span class="dest-promo-badge">${i.price_old?'OFERTA':'PROMO'}</span></div><div class="dest-body"><div class="dest-name">${i.name}</div><div class="dest-prices">${i.price_old?`<span class="dest-price-old">R$ ${fmt(i.price_old)}</span>`:''}<span class="dest-price">R$ ${fmt(i.price)}</span></div></div></div>`;
      });
      html += `</div></div>`;
    }
  }
  // Agrupa itens por categoria, respeitando a ordem de allCats (sort_order do banco)
  const grouped = new Map();
  normalItems.forEach(i => {
    const key = i.cat_key || i.cat || '__outros';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(i);
  });

  // Itera TODAS as categorias na ordem do sort_order, respeitando posicao de checklist
  allCats.forEach(cat => {
    const isChecklist = cat.type === 'checklist';
    if (isChecklist) {
      const catItems = allItems.filter(i => (i.cat_key === cat.name || i.cat === cat.label) && i.status !== 'pausado');
      if (!catItems.length) return;
      if (_segmento === 'acougue') {
        const label = cat.label || cat.name;
        const seeMore = catItems.length > 4 ? `<span class="section-see-more" onclick="verMaisCat('${String(cat.name).replace(/'/g,"\\'")}')">Ver mais<svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : '';
        html += `<div class="section" data-cat="${cat.name}"><div class="section-label-row"><div class="section-label">${label}</div>${seeMore}</div><div class="item-grid carousel">${catItems.map(itemCard).join('')}</div></div>`;
      } else {
        html += renderChecklistSection(cat, catItems, false);
      }
    } else {
      const its = grouped.get(cat.name) || [];
      if (!its.length) return;
      const label = cat.label || cat.name;
      const gridClass = (_segmento === 'acougue' || _catsCarrossel) ? 'item-grid carousel' : 'item-grid';
      const seeMore = its.length > 4 ? `<span class="section-see-more" onclick="verMaisCat('${String(cat.name).replace(/'/g,"\\'")}')">Ver mais<svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : '';
      html += `<div class="section" data-cat="${cat.name}"><div class="section-label-row"><div class="section-label">${label}</div>${seeMore}</div><div class="${gridClass}">${its.map(itemCard).join('')}</div></div>`;
    }
  });

  // Itens sem categoria conhecida
  const unknownItems = grouped.get('__outros') || [];
  if (unknownItems.length) {
    const gridClass = (_segmento === 'acougue' || _catsCarrossel) ? 'item-grid carousel' : 'item-grid';
    html += `<div class="section" data-cat="__outros"><div class="section-label">Outros</div><div class="${gridClass}">${unknownItems.map(itemCard).join('')}</div></div>`;
  }

  html += '</div>';
  const _menuWrapEl = document.getElementById('menu-wrap');
  _menuWrapEl.innerHTML = html;
  fixIosVideoAutoplay(_menuWrapEl);
  initScrollSpy();
}

function renderChecklistSection(cat, catItems, startOpen) {
  const id = 'cl-' + cat.name;
  const totalItens = catItems.length;
  return `
  <div class="checklist-section">
    <div class="checklist-header" onclick="toggleChecklistSection('${id}')">
      <div class="checklist-header-left">
        <div class="checklist-header-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="color:var(--accent)">
            <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
        </div>
        <div>
          <div class="checklist-title">${cat.label || cat.name}</div>
          <div class="checklist-subtitle">${totalItens} opção${totalItens !== 1 ? 'ões' : ''} disponível${totalItens !== 1 ? 'is' : ''}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="checklist-badge" id="${id}-badge" style="display:none">0</span>
        <svg class="checklist-arrow ${startOpen ? 'open' : ''}" id="${id}-arrow" width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
      </div>
    </div>
    <div class="checklist-body ${startOpen ? 'open' : ''}" id="${id}-body">
      ${catItems.map(item => {
        const priceStr = item.price > 0 ? 'R$ ' + fmt(item.price) : 'Grátis';
        return `
        <div class="checklist-item" id="${id}-item-${item.id}">
          <div class="checklist-check" id="${id}-check-${item.id}" onclick="toggleChecklistItem('${id}',${item.id},${item.price})"></div>
          <div class="checklist-item-name">${item.name}</div>
          <div class="checklist-item-price">${priceStr}</div>
          <div class="checklist-qty" id="${id}-qty-${item.id}">
            <div class="checklist-qty-btn" onclick="checklistQty('${id}',${item.id},-1,${item.price})">−</div>
            <div class="checklist-qty-num" id="${id}-qnum-${item.id}">1</div>
            <div class="checklist-qty-btn" onclick="checklistQty('${id}',${item.id},1,${item.price})">+</div>
          </div>
        </div>`;
      }).join('')}
      <button class="checklist-add-btn" id="${id}-add-btn" onclick="addChecklistToCart('${id}')" disabled>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        Adicionar selecionados ao pedido
      </button>
    </div>
  </div>`;
}

// Estado dos checklists
const _clState = {}; // { [clId]: { [itemId]: qty } }

function toggleChecklistSection(id) {
  const body  = document.getElementById(id + '-body');
  const arrow = document.getElementById(id + '-arrow');
  if (!body) return;
  body.classList.toggle('open');
  arrow.classList.toggle('open');
}

function toggleChecklistItem(clId, itemId, price) {
  if (!_clState[clId]) _clState[clId] = {};
  const check = document.getElementById(`${clId}-check-${itemId}`);
  const qty   = document.getElementById(`${clId}-qty-${itemId}`);
  const row   = document.getElementById(`${clId}-item-${itemId}`);

  if (_clState[clId][itemId]) {
    // Desmarca
    delete _clState[clId][itemId];
    check.classList.remove('on');
    check.innerHTML = '';
    if (qty) qty.classList.remove('show');
    if (row) row.classList.remove('selected');
  } else {
    // Marca com qty=1
    _clState[clId][itemId] = 1;
    check.classList.add('on');
    check.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const qnum = document.getElementById(`${clId}-qnum-${itemId}`);
    if (qnum) qnum.textContent = '1';
    if (qty) qty.classList.add('show');
    if (row) row.classList.add('selected');
  }
  _updateChecklistBadge(clId);
}

function checklistQty(clId, itemId, delta, price) {
  if (!_clState[clId] || !_clState[clId][itemId]) return;
  const newQty = (_clState[clId][itemId] || 1) + delta;
  if (newQty <= 0) {
    toggleChecklistItem(clId, itemId, price);
    return;
  }
  _clState[clId][itemId] = newQty;
  const qnum = document.getElementById(`${clId}-qnum-${itemId}`);
  if (qnum) qnum.textContent = newQty;
  _updateChecklistBadge(clId);
}

function _updateChecklistBadge(clId) {
  const state   = _clState[clId] || {};
  const total   = Object.values(state).reduce((s, q) => s + q, 0);
  const badge   = document.getElementById(clId + '-badge');
  const addBtn  = document.getElementById(clId + '-add-btn');
  if (badge) { badge.textContent = total; badge.style.display = total > 0 ? '' : 'none'; }
  if (addBtn) addBtn.disabled = total === 0;
}

function addChecklistToCart(clId) {
  if (!_lojaAberta) { toast('err','Loja fechada'); return; }
  const state = _clState[clId] || {};
  if (!Object.keys(state).length) return;

  Object.entries(state).forEach(([itemId, qty]) => {
    const item = allItems.find(i => i.id === Number(itemId));
    if (!item) return;
    const existing = cart.find(c => c.id === item.id && !c.obs);
    if (existing) { existing.qty += qty; }
    else { cart.push({ ...item, qty, obs: '' }); }
  });

  // Limpa estado e visual
  _clState[clId] = {};
  const body = document.getElementById(clId + '-body');
  if (body) {
    body.querySelectorAll('.checklist-check.on').forEach(el => {
      el.classList.remove('on'); el.innerHTML = '';
    });
    body.querySelectorAll('.checklist-qty.show').forEach(el => el.classList.remove('show'));
    body.querySelectorAll('.checklist-item.selected').forEach(el => el.classList.remove('selected'));
    body.querySelectorAll('.checklist-qty-num').forEach(el => el.textContent = '1');
  }
  _updateChecklistBadge(clId);

  updateCartFloat();
  toast('ok', 'Itens adicionados ao carrinho!');
}

// ══════════════════════════════════════════
//  FAVORITOS — exige conta (salvo no servidor, por cliente)
// ══════════════════════════════════════════
let _favoritosCache = [];   // ids favoritados do cliente logado, carregado do servidor
let _favoritosCarregados = false;
let _pendingFavoritoId = null; // item que o cliente tentou favoritar antes de logar

function isFavorito(id) {
  return _favoritosCache.includes(id);
}

// Carrega os favoritos do cliente logado a partir do servidor. Chamado ao
// abrir o cardápio (se já tinha sessão salva) e logo após login/registro.
async function loadFavoritos() {
  if (!_customer?.id) { _favoritosCache = []; _favoritosCarregados = false; return; }
  try {
    const res = await fetch(`/api/favoritos?customer_id=${_customer.id}`, {
      headers: { 'x-tenant-id': _tenantId, 'Authorization': 'Bearer ' + (_customer.token||'') }
    });
    if (res.ok) _favoritosCache = await res.json();
  } catch(e) {}
  _favoritosCarregados = true;
  _atualizarCoracoesNaTela();
  if (document.getElementById('favoritos-overlay')?.classList.contains('on')) renderFavoritosPage();
  // Se o cliente tentou favoritar antes de logar, aplica agora
  if (_pendingFavoritoId != null) {
    const id = _pendingFavoritoId;
    _pendingFavoritoId = null;
    if (!isFavorito(id)) toggleFavorito(id);
  }
}

function _atualizarCoracoesNaTela() {
  document.querySelectorAll('.item-fav-btn').forEach(btn => {
    const m = btn.getAttribute('onclick')?.match(/toggleFavorito\((\d+)\)/);
    if (!m) return;
    const on = isFavorito(parseInt(m[1]));
    btn.classList.toggle('on', on);
    btn.querySelector('svg')?.setAttribute('fill', on ? 'currentColor' : 'none');
  });
}

async function toggleFavorito(id) {
  // Sem conta: pede pra criar/entrar antes de favoritar, e guarda a intenção
  // pra aplicar automaticamente assim que o login concluir.
  if (!_customer?.id) {
    _pendingFavoritoId = id;
    if (typeof toast === 'function') toast('info', 'Crie uma conta para favoritar');
    if (typeof openAuth === 'function') openAuth('register');
    return;
  }
  const jaTem = isFavorito(id);
  // Atualização otimista da tela
  _favoritosCache = jaTem ? _favoritosCache.filter(x => x !== id) : [..._favoritosCache, id];
  _atualizarCoracoesNaTela();
  try {
    const res = await fetch('/api/favoritos/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': _tenantId, 'Authorization': 'Bearer ' + (_customer.token||'') },
      body: JSON.stringify({ customer_id: _customer.id, item_id: id })
    });
    if (!res.ok) throw new Error('falhou');
    if (typeof toast === 'function') toast(jaTem ? 'info' : 'ok', jaTem ? 'Removido dos favoritos' : 'Adicionado aos favoritos!');
  } catch(e) {
    // Reverte a atualização otimista se a chamada falhou
    _favoritosCache = jaTem ? [..._favoritosCache, id] : _favoritosCache.filter(x => x !== id);
    _atualizarCoracoesNaTela();
    if (typeof toast === 'function') toast('err', 'Não foi possível salvar o favorito. Tente novamente.');
    return;
  }
  // Se a tela de favoritos estiver aberta, atualiza a lista na hora
  if (document.getElementById('favoritos-overlay')?.classList.contains('on')) renderFavoritosPage();
}

function renderFavoritosPage() {
  const wrap = document.getElementById('favoritos-list');
  if (!wrap) return;
  if (!_customer?.id) {
    wrap.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none"><path d="M12 20.5s-7.5-4.6-10-9.3C.5 7.8 2.3 4 6 4c2.1 0 3.7 1.2 6 3.5C14.3 5.2 15.9 4 18 4c3.7 0 5.5 3.8 4 7.2-2.5 4.7-10 9.3-10 9.3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
      <div class="empty-state-text">Crie uma conta ou entre na sua pra favoritar itens e ver sua lista aqui.</div>
      <button onclick="closeFavoritos();openAuth('register')" style="margin-top:14px;padding:11px 22px;background:var(--accent);color:#fff;border:none;border-radius:10px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit">Criar conta / Entrar</button>
    </div>`;
    return;
  }
  const favItems = (allItems || []).filter(i => _favoritosCache.includes(i.id));
  if (!favItems.length) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none"><path d="M12 20.5s-7.5-4.6-10-9.3C.5 7.8 2.3 4 6 4c2.1 0 3.7 1.2 6 3.5C14.3 5.2 15.9 4 18 4c3.7 0 5.5 3.8 4 7.2-2.5 4.7-10 9.3-10 9.3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></div><div class="empty-state-text">Nenhum favorito ainda.<br>Toque no coração de um item pra guardar aqui.</div></div>';
    return;
  }
  const gridClass = (_segmento === 'acougue' || _catsCarrossel) ? 'item-grid carousel' : 'item-grid';
  wrap.innerHTML = `<div class="${gridClass}">${favItems.map(itemCard).join('')}</div>`;
}

function itemCard(i) {
  const esg  = i.status === 'esgotado';
  const click= esg ? '' : `onclick="openItemModal(${i.id})"`;
  const hasImg = i.image_url || i.emoji;

  // Porção de referência calculada
  const cgs = i.custom_groups || [];
  const porcaoGrp = cgs.find(g => g.tipo === 'porcao_ref');
  const porcaoRef = porcaoGrp?.gramas || 0;
  const porcaoBadge = (porcaoRef > 0 && i.price > 0)
    ? `<div class="item-porcao-ref">${porcaoRef}g · R$ ${fmt(i.price * porcaoRef / 1000)}</div>`
    : '';
  const hasPizzaSizes = typeof _pizzaHasSizePricing === 'function' && _pizzaHasSizePricing(i);
  const isKg = i.item_type === 'kg';
  const priceText = hasPizzaSizes
    ? `A partir de R$ ${fmt(_pizzaMinPrice(i))}`
    : `R$ ${fmt(i.price)}${isKg ? '<span style="font-size:10px;font-weight:400;color:var(--muted)">/kg</span>' : ''}`;

  return `
  <div class="item-card${isKg && _segmento==='acougue' ? ' item-card-kg' : ''}" ${click} style="${esg?'opacity:.55;cursor:not-allowed':''}">
    <div class="item-body">
      <div class="item-name">${i.name}</div>
      ${i.description ? `<div class="item-desc">${i.description}</div>` : ''}
      <div class="item-foot">
        ${i.price_old ? `<span class="item-price-old">R$ ${fmt(i.price_old)}</span>` : ''}
        <span class="item-price${i.promo||i.price_old?' item-price-promo':''}">${priceText}</span>
        <button class="item-add-btn" ${esg?'disabled':''} onclick="event.stopPropagation();openItemModal(${i.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></button>
      </div>
      ${porcaoBadge}
    </div>
    <div class="item-img${(i.image_url||i.video_url) ? ' has-photo' : ''}">
      ${i.video_url
        ? `<video src="${i.video_url}" autoplay muted loop playsinline preload="metadata" onerror="itemCardVideoFallback(this,'${(i.image_url||'').replace(/'/g,'%27')}','${(i.name||'').replace(/'/g,'%27')}')"></video>`
        : (i.image_url ? `<img src="${i.image_url}" alt="${i.name}" loading="lazy" decoding="async">` : `<span>${''}</span>`)}
      ${i.video_url ? `<span class="item-video-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></span>` : ''}
      ${i.promo||i.price_old ? '<span class="item-promo-badge">PROMO</span>' : ''}
      ${esg ? '<div class="item-esgotado-overlay">Esgotado</div>' : ''}
      <button class="item-fav-btn${isFavorito(i.id)?' on':''}" onclick="event.stopPropagation();toggleFavorito(${i.id})" aria-label="Favoritar">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="${isFavorito(i.id)?'currentColor':'none'}"><path d="M12 20.5s-7.5-4.6-10-9.3C.5 7.8 2.3 4 6 4c2.1 0 3.7 1.2 6 3.5C14.3 5.2 15.9 4 18 4c3.7 0 5.5 3.8 4 7.2-2.5 4.7-10 9.3-10 9.3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
      </button>
    </div>
  </div>`;
}

// Fallback quando o vídeo do card falha ao carregar — volta pra imagem (ou nada)
function itemCardVideoFallback(videoEl, imgUrl, name) {
  const unesc = (s) => String(s || '').replace(/%27/g, "'");
  if (imgUrl) {
    const img = document.createElement('img');
    img.src = unesc(imgUrl); img.alt = unesc(name);
    img.loading = 'lazy'; img.decoding = 'async';
    videoEl.replaceWith(img);
  } else {
    videoEl.remove();
  }
}

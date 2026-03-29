// ══════════════════════════════════════════
//  MODAL — Modal do item, animações, pizza meio a meio
//  Estima Food — Cardápio
// ══════════════════════════════════════════
// ══════════════════════════════════════════
//  MODAL DO ITEM
// ══════════════════════════════════════════
let _imItemId = null;
let _imQty    = 1;

function openItemModal(id) {
  const i = allItems.find(x => x.id === id);
  if (!i) return;
  _imItemId = id;
  _imQty    = 1;
  _halfItem = null;
  _halfPickerOpen = false;

  const imgEl = document.getElementById('im-img');
  if (i.image_url) {
    imgEl.innerHTML = `<button class="im-close" onclick="closeItemModal()">✕</button><img src="${i.image_url}" alt="${i.name}" style="width:100%;height:100%;object-fit:cover">`;
  } else {
    imgEl.innerHTML = `<button class="im-close" onclick="closeItemModal()">✕</button><span style="font-size:72px">${i.emoji||'🍽️'}</span>`;
  }
  document.getElementById('im-name').textContent = i.name;
  document.getElementById('im-desc').textContent = i.description || '';
  document.getElementById('im-price').textContent = 'R$ ' + fmt(i.price) + (i.item_type === 'kg' ? '/kg' : '');
  const old = document.getElementById('im-price-old');
  if (i.price_old) { old.textContent = 'R$ ' + fmt(i.price_old); old.style.display = ''; }
  else old.style.display = 'none';

  // Porção de referência no modal
  let porcaoEl = document.getElementById('im-porcao-ref');
  if (!porcaoEl) {
    porcaoEl = document.createElement('div');
    porcaoEl.id = 'im-porcao-ref';
    porcaoEl.className = 'im-porcao-ref';
    document.getElementById('im-price').parentNode.appendChild(porcaoEl);
  }
  const porcaoGrpM = (i.custom_groups || []).find(g => g.tipo === 'porcao_ref');
  const porcaoRefM = porcaoGrpM?.gramas || 0;
  if (porcaoRefM > 0 && i.price > 0) {
    porcaoEl.textContent = `🥩 Porção de ${porcaoRefM}g · R$ ${fmt(i.price * porcaoRefM / 1000)}`;
    porcaoEl.style.display = 'inline-flex';
  } else {
    porcaoEl.style.display = 'none';
  }
  document.getElementById('im-qty').textContent = _imQty;
  document.getElementById('im-obs').value = '';
  document.getElementById('im-add-btn').disabled = !_lojaAberta;

  // ── Grupos de customização ──
  _imGruposState = {};
  _acougueCortes = {};
  _acougueAtual  = null;
  renderImGrupos(i);
  // Pré-carrega imagens dos cortes para evitar delay no modal
  if (_isAcougueItem(i)) {
    const grupos = i.custom_groups || [];
    const cortesGrp = grupos.find(g => g.tipo === 'cortes');
    if (cortesGrp?.opcoes) {
      cortesGrp.opcoes.forEach(o => {
        const n = (o.nome||o.id||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
        let key = 'default';
        if      (n.includes('strogon'))  key = 'strogonoff';
        else if (n.includes('posta'))    key = 'postas';
        else if (n.includes('tirinha'))  key = 'tirinha';
        else if (n.includes('tira'))     key = 'tiras';
        else if (n.includes('moido') && n.includes('2')) key = 'moido2x';
        else if (n.includes('moido') || n.includes('moida')) key = 'moido';
        else if (n.includes('cubo'))     key = 'cubos';
        else if (n.includes('picado'))   key = 'picado';
        else if (n.includes('grelha'))   key = 'grelha';
        else if (n.includes('peca'))     key = 'peca';
        else if (n.includes('fino'))     key = 'bifefino';
        else if (n.includes('grosso'))   key = 'bifegrosso';
        else if (n.includes('bife'))     key = 'bife';
        else if (n.includes('espeto'))   key = 'espeto';
        else if (n.includes('inteiro') || n.includes('inteira')) key = 'inteiro';
        const url = (o.icon || o.image || o.img || o.image_url) || (_corteImgMap[key] || _corteImgMap.default);
        const preload = new Image(); preload.src = url;
      });
    }
  }
  renderImXsell(i);

  // ── Abas "Informações do Produto" (exclusivo açougue) ──
  const imGruposWrap = document.getElementById('im-grupos-wrap');
  const existingTabs = document.getElementById('im-info-tabs-wrap');
  if (existingTabs) existingTabs.remove();

  if (_isAcougueItem(i)) {
    const cgs            = i.custom_groups || [];
    const ocasiaoGrp     = cgs.find(g => g.tipo === 'ocasiao');
    const armazenGrp     = cgs.find(g => g.tipo === 'armazenamento');
    const preparosGrp    = cgs.find(g => g.tipo === 'preparos');
    const hasInfoTab = ocasiaoGrp?.opcoes?.length || armazenGrp?.opcoes?.length || preparosGrp?.opcoes?.length;

    if (hasInfoTab) {
      const _chipHtml = (lista, titulo) => {
        if (!lista?.length) return '';
        const chips = lista.map(o => {
          const nome = o.nome || o.id || '';
          const icon = o.icon
            ? `<img src="${o.icon}" style="width:32px;height:32px;object-fit:contain;display:block" onerror="this.style.display='none'">`
            : `<span style="font-size:22px;display:block;line-height:1">🔹</span>`;
          return `<div style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 12px;background:var(--s2,#1a1a1a);border:1.5px solid var(--border,#2a2a2a);border-radius:12px;min-width:70px;max-width:90px;text-align:center;flex-shrink:0">
            <div style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.04);border-radius:10px">${icon}</div>
            <span style="font-size:11px;font-weight:600;color:var(--text);line-height:1.2">${nome}</span>
          </div>`;
        }).join('');
        return `<div style="margin-bottom:14px">
          <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.4px;text-transform:uppercase;margin-bottom:8px">${titulo}</div>
          <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;-webkit-overflow-scrolling:touch;scrollbar-width:none">${chips}</div>
        </div>`;
      };

      const preparoContent = [
        _chipHtml(ocasiaoGrp?.opcoes,     'Tipo de ocasião'),
        _chipHtml(armazenGrp?.opcoes,     'Armazenamento'),
        _chipHtml(preparosGrp?.opcoes,    'Forma de preparo'),
      ].join('');

      const tabsWrap = document.createElement('div');
      tabsWrap.id = 'im-info-tabs-wrap';
      tabsWrap.style.cssText = 'margin-bottom:16px';
      tabsWrap.innerHTML = `
        <div style="font-size:13px;font-weight:700;margin-bottom:10px">Informações do produto</div>
        <div style="display:flex;gap:6px;margin-bottom:14px" id="im-tab-btns">
          <button onclick="imSwitchTab('detalhes')" id="im-tab-btn-detalhes" style="flex:1;padding:8px 12px;border-radius:10px;border:1.5px solid var(--accent,#f97316);background:var(--accent,#f97316);color:#000;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s">Detalhes</button>
          <button onclick="imSwitchTab('preparo')"  id="im-tab-btn-preparo"  style="flex:1;padding:8px 12px;border-radius:10px;border:1.5px solid var(--border,#2a2a2a);background:transparent;color:var(--muted);font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s">Preparo</button>
        </div>
        <div id="im-tab-panel-detalhes" style="display:block">
          <div style="font-size:13px;color:var(--muted2);line-height:1.6">${i.description || 'Sem descrição adicional.'}</div>
        </div>
        <div id="im-tab-panel-preparo" style="display:none">${preparoContent}</div>
      `;
      imGruposWrap.parentNode.insertBefore(tabsWrap, imGruposWrap);

      // Oculta a descrição duplicada acima (já está na aba Detalhes)
      const descEl = document.getElementById('im-desc');
      if (descEl) descEl.style.display = 'none';
    } else {
      // Sem dados de preparo — mantém descrição normal
      const descEl = document.getElementById('im-desc');
      if (descEl) descEl.style.display = '';
    }
  } else {
    const descEl = document.getElementById('im-desc');
    if (descEl) descEl.style.display = '';
  }

  // ── Ingredientes selecionáveis ──
  const ingrSection = document.getElementById('im-ingr-section');
  const ingrGrid    = document.getElementById('im-ingr-grid');
  const ingrs = Array.isArray(i.ingredients) ? i.ingredients.filter(Boolean) : [];
  if (ingrs.length > 0) {
    ingrGrid.innerHTML = ingrs.map(ingr => `
      <div class="im-ingr-chip" onclick="toggleIngr(this)">
        <div class="chip-dot"></div>
        <span>${ingr}</span>
      </div>`).join('');
    document.getElementById('im-ingr-count').textContent = '0';
    document.getElementById('im-ingr-count').classList.remove('show');
    ingrSection.style.display = '';
    document.getElementById('im-obs').placeholder = 'Observação adicional (opcional)';
  } else {
    ingrSection.style.display = 'none';
    ingrGrid.innerHTML = '';
    document.getElementById('im-obs').placeholder = 'Observação';
  }

  document.getElementById('item-modal-bg').classList.add('on');

  // ── Camada de animação (açaí / marmita) ──
  _animFillLevel = 0;
  _initAnimLayer(i);

  // ── Pizza meio a meio ──
  const isPizza = isPizzaItem(i);
  const halfSec = document.getElementById('half-section');
  halfSec.style.display = isPizza ? '' : 'none';
  if (isPizza) {
    updateHalfUI();
    renderHalfPicker(i);
    // Inicia visual da pizza com a metade esquerda preenchida
    _initPizzaCanvas();
    setTimeout(() => _updatePizzaVisual(), 80);
  }
  updateImAddBtn();
}

function isPizzaItem(i) {
  // Detecta pizza por: tipo, meio_a_meio flag, ou categoria
  if (i.meio_a_meio || i.tipo === 'pizza' || i.is_pizza) return true;
  const cat = allCats.find(c => c.name === (i.cat_key || i.cat));
  if (cat && (cat.meio_a_meio || (cat.name||'').toLowerCase().includes('pizza') || (cat.label||'').toLowerCase().includes('pizza'))) return true;
  return false;
}

function getPizzaSiblings(item) {
  // Retorna todas as pizzas da mesma categoria, exceto o item atual
  const catKey = item.cat_key || item.cat;
  return allItems.filter(x =>
    x.id !== item.id &&
    (x.cat_key === catKey || x.cat === catKey) &&
    x.status !== 'esgotado'
  );
}

function _isWholeFlavorSelected() {
  const base = allItems.find(x => x.id === _imItemId);
  return !!(base && _halfItem && _halfItem.id === base.id);
}

function selectHalfWhole() {
  const base = allItems.find(x => x.id === _imItemId);
  if (!base) return;
  _halfItem = { ...base };
  _halfPickerOpen = false;
  document.getElementById('half-picker-list').style.display = 'none';
  renderHalfPicker(base);
  updateHalfUI();
  updateImAddBtn();
  _updatePizzaVisual();
}

function renderHalfPicker(baseItem) {
  const siblings = getPizzaSiblings(baseItem);
  const list = document.getElementById('half-picker-list');
  // Opção "Inteira com mesmo sabor"
  const wholeOn = _isWholeFlavorSelected() ? ' on' : '';
  const wholeCheck = _isWholeFlavorSelected() ? '✓' : '';
  const wholeOpt = `
    <div class="half-opt${wholeOn}" onclick="selectHalfWhole()" style="border-left:3px solid var(--green)">
      <div class="half-opt-emoji">🍕</div>
      <span class="half-opt-name">Inteira — mesmo sabor</span>
      <span class="half-opt-price" style="color:var(--green)">Sem acréscimo</span>
      <div class="half-opt-check">${wholeCheck}</div>
    </div>`;
  if (!siblings.length) {
    list.innerHTML = wholeOpt;
    return;
  }
  list.innerHTML = wholeOpt + siblings.map(s => {
    const on = (_halfItem && _halfItem.id === s.id && !_isWholeFlavorSelected()) ? ' on' : '';
    const thumbInner = s.image_url
      ? `<img src="${s.image_url}" alt="${s.name}" style="width:100%;height:100%;object-fit:cover;border-radius:7px">`
      : `<span>${s.emoji || '🍕'}</span>`;
    const check = (_halfItem && _halfItem.id === s.id && !_isWholeFlavorSelected()) ? '✓' : '';
    return `
    <div class="half-opt${on}" onclick="selectHalf(${s.id})">
      <div class="half-opt-emoji">${thumbInner}</div>
      <span class="half-opt-name">${s.name}</span>
      <span class="half-opt-price">R$ ${fmt(s.price)}</span>
      <div class="half-opt-check">${check}</div>
    </div>`;
  }).join('');
}

function selectHalf(id) {
  _halfItem = allItems.find(x => x.id === id) || null;
  _halfPickerOpen = false;
  document.getElementById('half-picker-list').style.display = 'none';
  const baseItem = allItems.find(x => x.id === _imItemId);
  if (baseItem) renderHalfPicker(baseItem);
  updateHalfUI();
  updateImAddBtn();
  // Atualiza visual animado da pizza
  _updatePizzaVisual();
}

function updateHalfUI() {
  const prompt   = document.getElementById('half-pick-prompt');
  const selected = document.getElementById('half-selected-row');
  if (!_halfItem) {
    prompt.style.display   = '';
    selected.style.display = 'none';
    document.getElementById('half-price-note').textContent = '';
    return;
  }
  prompt.style.display   = 'none';
  selected.style.display = '';
  const base = allItems.find(x => x.id === _imItemId);

  if (_isWholeFlavorSelected()) {
    // Pizza inteira — mesmo sabor
    const emoEl = document.getElementById('half-sel-emoji');
    if (base && base.image_url) {
      emoEl.innerHTML = `<img src="${base.image_url}" alt="${base.name}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
    } else {
      emoEl.textContent = (base && base.emoji) || '🍕';
    }
    document.getElementById('half-sel-name').textContent = 'Inteira — mesmo sabor';
    document.getElementById('half-sel-hint').textContent  = 'Pizza inteira com um único sabor';
    document.getElementById('half-price-note').textContent = '';
    return;
  }

  const avgPrice = base ? (parseFloat(base.price) + parseFloat(_halfItem.price)) / 2 : parseFloat(_halfItem.price);
  // Emoji/img da 2ª metade
  const emoEl = document.getElementById('half-sel-emoji');
  if (_halfItem.image_url) {
    emoEl.innerHTML = `<img src="${_halfItem.image_url}" alt="${_halfItem.name}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
  } else {
    emoEl.textContent = _halfItem.emoji || '🍕';
  }
  document.getElementById('half-sel-name').textContent = _halfItem.name;
  document.getElementById('half-sel-hint').textContent = 'Toque para trocar';
  document.getElementById('half-price-note').textContent = `Preço médio das metades: R$ ${fmt(avgPrice)}`;
}

function toggleHalfPicker() {
  _halfPickerOpen = !_halfPickerOpen;
  document.getElementById('half-picker-list').style.display = _halfPickerOpen ? '' : 'none';
}

function updateImAddBtn() {
  const i = allItems.find(x => x.id === _imItemId);
  if (!i) return;
  const isPizza = isPizzaItem(i);
  const base = parseFloat(i.price);
  let price = base;
  if (isPizza && _halfItem) {
    if (_isWholeFlavorSelected()) {
      price = base; // inteira — preço normal
    } else {
      price = (base + parseFloat(_halfItem.price)) / 2;
    }
  }
  const disabled = !_lojaAberta || (isPizza && !_halfItem);
  document.getElementById('im-add-btn').disabled = disabled;
  const label = isPizza && !_halfItem
    ? '🍕 Escolha como quer sua pizza acima'
    : `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2h1.5l1.8 7.5h6.5l1.2-5H5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="13" r="1" fill="currentColor"/><circle cx="12" cy="13" r="1" fill="currentColor"/></svg> Adicionar · R$ ${fmt(price * _imQty)}`;
  document.getElementById('im-add-btn').innerHTML = label;
}


// ══════════════════════════════════════════════════════
//  ANIMAÇÕES VISUAIS AVANÇADAS — Canvas 2D
// ══════════════════════════════════════════════════════

// ── Particle canvas global ────────────────────────────
const _pCanvas = (() => {
  let c = document.getElementById('anim-particle-canvas');
  if (!c) { c = document.createElement('canvas'); c.id='anim-particle-canvas'; c.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:9998;'; document.body.appendChild(c); }
  c.width  = window.innerWidth;
  c.height = window.innerHeight;
  window.addEventListener('resize', () => { c.width=window.innerWidth; c.height=window.innerHeight; });
  return c;
})();
const _pCtx = _pCanvas.getContext('2d');
let _particles = [];
let _pRafId = null;

function _pLoop() {
  _pCtx.clearRect(0, 0, _pCanvas.width, _pCanvas.height);
  _particles = _particles.filter(p => p.life > 0);
  for (const p of _particles) {
    p.x  += p.vx;
    p.y  += p.vy;
    p.vy += p.gravity;
    p.vx *= 0.98;
    p.rot += p.rotV;
    p.life -= p.decay;
    _pCtx.save();
    _pCtx.globalAlpha = Math.max(0, p.life);
    _pCtx.translate(p.x, p.y);
    _pCtx.rotate(p.rot);
    p.draw(_pCtx);
    _pCtx.restore();
  }
  if (_particles.length > 0) _pRafId = requestAnimationFrame(_pLoop);
  else { _pCtx.clearRect(0, 0, _pCanvas.width, _pCanvas.height); _pRafId = null; }
}

function _spawnParticles(list) {
  _particles.push(...list);
  if (!_pRafId) _pRafId = requestAnimationFrame(_pLoop);
}

// ── SVG ingredient shapes (no emoji) ─────────────────
const _ingShapes = {
  morango(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(0, -s*.8);
    ctx.bezierCurveTo(s*.6,-s*.8, s*.9,-s*.2, 0, s*.9);
    ctx.bezierCurveTo(-s*.9,-s*.2, -s*.6,-s*.8, 0, -s*.8);
    ctx.fillStyle = '#e53e3e'; ctx.fill();
    // seeds
    ctx.fillStyle='#c53030';
    for(let i=0;i<4;i++){ctx.beginPath();ctx.arc((Math.random()-.5)*s*.5,(Math.random()-.5)*s*.5,s*.08,0,Math.PI*2);ctx.fill();}
    // leaf
    ctx.beginPath(); ctx.moveTo(0,-s*.8); ctx.bezierCurveTo(-s*.3,-s*1.3,s*.3,-s*1.3,0,-s*.8);
    ctx.fillStyle='#38a169'; ctx.fill();
  },
  banana(ctx, s) {
    ctx.beginPath();
    ctx.ellipse(0, 0, s*.9, s*.35, -0.4, 0, Math.PI*2);
    ctx.fillStyle='#f6e05e'; ctx.fill();
    ctx.strokeStyle='#d69e2e'; ctx.lineWidth=s*.06; ctx.stroke();
  },
  granola(ctx, s) {
    const cols=['#c05621','#9c4221','#b7791f'];
    for(let i=0;i<5;i++){
      ctx.beginPath();
      ctx.arc((Math.random()-.5)*s*.8,(Math.random()-.5)*s*.8,s*.2,0,Math.PI*2);
      ctx.fillStyle=cols[i%3]; ctx.fill();
    }
  },
  mel(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(0,-s);ctx.bezierCurveTo(s*.5,-s*.5,s*.5,s*.2,0,s);ctx.bezierCurveTo(-s*.5,s*.2,-s*.5,-s*.5,0,-s);
    ctx.fillStyle='#d69e2e'; ctx.fill();
  },
  chocolate(ctx, s) {
    ctx.beginPath();
    ctx.roundRect(-s*.6,-s*.4,s*1.2,s*.8,s*.12);
    ctx.fillStyle='#6b3a2a'; ctx.fill();
    ctx.strokeStyle='#8b5e4a'; ctx.lineWidth=s*.06;
    ctx.beginPath(); ctx.moveTo(0,-s*.4); ctx.lineTo(0,s*.4); ctx.stroke();
  },
  coco(ctx, s) {
    ctx.beginPath();
    ctx.ellipse(0,0,s*.9,s*.3,-0.3,0,Math.PI*2);
    ctx.fillStyle='#fff'; ctx.fill();
    ctx.strokeStyle='#d4a76a'; ctx.lineWidth=s*.05; ctx.stroke();
  },
  aveia(ctx, s) {
    ctx.beginPath();
    ctx.ellipse(0,0,s*.8,s*.4,0.2,0,Math.PI*2);
    ctx.fillStyle='#c9a96e'; ctx.fill();
    // fibras
    ctx.strokeStyle='#a07840'; ctx.lineWidth=s*.07;
    for(let i=-1;i<=1;i++){ctx.beginPath();ctx.moveTo(i*s*.3,-s*.3);ctx.lineTo(i*s*.3+s*.1,s*.3);ctx.stroke();}
  },
  fruta(ctx, s) {
    ctx.beginPath();
    ctx.arc(0,0,s*.7,0,Math.PI*2);
    ctx.fillStyle='#805ad5'; ctx.fill();
    ctx.beginPath();
    for(let i=0;i<5;i++){ctx.arc((Math.random()-.5)*s*.5,(Math.random()-.5)*s*.5,s*.1,0,Math.PI*2);}
    ctx.fillStyle='rgba(255,255,255,.3)'; ctx.fill();
  },
  default(ctx, s) {
    ctx.beginPath();
    ctx.arc(0,0,s*.6,0,Math.PI*2);
    const g=ctx.createRadialGradient(0,0,0,0,0,s*.6);
    g.addColorStop(0,'#f97316'); g.addColorStop(1,'#ea580c');
    ctx.fillStyle=g; ctx.fill();
  }
};

function _getIngShape(name) {
  const n = (name||'').toLowerCase();
  if(n.includes('morango')||n.includes('strawb')) return _ingShapes.morango;
  if(n.includes('banana'))                         return _ingShapes.banana;
  if(n.includes('granola')||n.includes('aveia'))   return _ingShapes.aveia;
  if(n.includes('mel')||n.includes('honey'))       return _ingShapes.mel;
  if(n.includes('chocolate')||n.includes('choc'))  return _ingShapes.chocolate;
  if(n.includes('coco')||n.includes('coconut'))    return _ingShapes.coco;
  if(n.includes('granola'))                        return _ingShapes.granola;
  if(n.includes('açaí')||n.includes('acai')||n.includes('mirtilo')||n.includes('uva')) return _ingShapes.fruta;
  return _ingShapes.default;
}

// ── Detecta tipo visual do item ───────────────────────
function _itemVisualType(item) {
  if (!item) return 'normal';
  const cat = allCats.find(c => c.name === (item.cat_key || item.cat));
  const all = ((item.cat_key||'') + ' ' + (item.cat||'') + ' ' + (cat?.label||'') + ' ' + (item.name||'')).toLowerCase();
  if (all.includes('pizza'))                                           return 'pizza';
  if (all.includes('açaí')||all.includes('acai')||all.includes('tigela')||all.includes('bowl')) return 'acai';
  if (all.includes('marmita')||all.includes('quentinha')||all.includes('prato feito')||all.includes('p.f.')) return 'marmita';
  if (all.includes('hamburguer')||all.includes('hamburger')||all.includes('hambúrguer')||all.includes('burger')||all.includes('smash')||all.includes('lanche')||all.includes('sanduíche')||all.includes('sanduiche')) return 'burger';
  return 'normal';
}

// ── Cup wave simulation ───────────────────────────────
let _cupCanvas = null, _cupCtx = null, _cupRaf = null;
let _cupFill = 0, _cupTargetFill = 0, _cupType = 'acai';
const _wavePoints = Array.from({length: 20}, (_,i) => ({ x: i/19, y: 0, vy: 0 }));

function _cupLoop() {
  if (!_cupCanvas) return;
  const W = _cupCanvas.width, H = _cupCanvas.height;
  _cupCtx.clearRect(0, 0, W, H);

  // smooth fill towards target
  _cupFill += (_cupTargetFill - _cupFill) * 0.08;

  // wave physics
  const K=0.15, DAMP=0.88, SPREAD=0.3;
  for (const p of _wavePoints) {
    p.vy += -K * p.y;
    p.vy *= DAMP;
    p.y  += p.vy;
  }
  // neighbour spread
  for (let i=1; i<_wavePoints.length-1; i++) {
    _wavePoints[i].vy += SPREAD * (_wavePoints[i-1].y + _wavePoints[i+1].y - 2*_wavePoints[i].y);
  }

  const fillY = H * (1 - _cupFill);

  // draw liquid
  if (_cupFill > 0.01) {
    _cupCtx.save();
    _cupCtx.beginPath();
    _cupCtx.moveTo(0, H);
    _cupCtx.lineTo(0, fillY + (_wavePoints[0]?.y || 0));
    for (let i=1; i<_wavePoints.length; i++) {
      const px = _wavePoints[i-1].x * W, py = fillY + _wavePoints[i-1].y;
      const cx = _wavePoints[i].x   * W, cy = fillY + _wavePoints[i].y;
      _cupCtx.quadraticCurveTo(px, py, (px+cx)/2, (py+cy)/2);
    }
    _cupCtx.lineTo(W, H);
    _cupCtx.closePath();
    const g = _cupCtx.createLinearGradient(0, fillY, 0, H);
    if (_cupType === 'acai') {
      g.addColorStop(0, 'rgba(107,33,168,.75)');
      g.addColorStop(1, 'rgba(59,7,100,.92)');
    } else {
      g.addColorStop(0, 'rgba(161,94,34,.75)');
      g.addColorStop(1, 'rgba(92,47,14,.92)');
    }
    _cupCtx.fillStyle = g;
    _cupCtx.fill();
    _cupCtx.restore();
  }

  _cupRaf = requestAnimationFrame(_cupLoop);
}

function _startCupAnim(type) {
  _cupType = type;
  _cupFill = 0; _cupTargetFill = 0;
  for (const p of _wavePoints) { p.y = 0; p.vy = 0; }
  if (_cupRaf) { cancelAnimationFrame(_cupRaf); _cupRaf = null; }
  _cupLoop();
}

function _stopCupAnim() {
  if (_cupRaf) { cancelAnimationFrame(_cupRaf); _cupRaf = null; }
}

// ── Init anim layer ───────────────────────────────────
function _initAnimLayer(item) {
  const layer = document.getElementById('im-anim-layer');
  if (!layer) return;
  const vtype = _itemVisualType(item);
  if (vtype !== 'acai' && vtype !== 'marmita' && vtype !== 'burger') {
    layer.style.display = 'none'; layer.innerHTML = ''; _stopCupAnim(); _stopBurgerAnim(); return;
  }
  layer.style.display = 'flex';
  _animFillLevel = 0;

  if (vtype === 'burger') {
    layer.style.alignItems = 'center';
    layer.innerHTML = `<canvas id="burger-canvas" width="160" height="200" style="display:block;filter:drop-shadow(0 6px 16px rgba(0,0,0,.22))"></canvas>`;
    _initBurgerCanvas();
    return;
  }

  if (vtype === 'acai') {
    layer.innerHTML = `
    <div class="anim-cup-container" style="position:relative;width:110px;height:164px">
      <canvas id="cup-wave-canvas" width="74" height="110" style="position:absolute;bottom:22px;left:18px;border-radius:0 0 12px 12px;clip-path:polygon(0 0,100% 0,94% 100%,6% 100%)"></canvas>
      <svg viewBox="0 0 110 164" width="110" height="164" style="position:absolute;top:0;left:0" xmlns="http://www.w3.org/2000/svg">
        <!-- corpo do copo transparente -->
        <path d="M19 32 L28 142 Q28 155 55 155 Q82 155 82 142 L91 32 Z" fill="rgba(255,255,255,.55)" stroke="#c8a882" stroke-width="2"/>
        <!-- borda superior -->
        <rect x="13" y="22" width="84" height="13" rx="5" fill="#e8d5bc" stroke="#c8a882" stroke-width="1.8"/>
        <!-- reflexo lateral -->
        <path d="M26 38 L33 132 Q33 138 38 140 L35 142 Q28 140 27 132 L19 36 Z" fill="rgba(255,255,255,.22)"/>
        <!-- base -->
        <ellipse cx="55" cy="150" rx="27" ry="7" fill="#d4b896" stroke="#c8a882" stroke-width="1.5"/>
        <!-- canudo -->
        <rect x="62" y="0" width="7" height="52" rx="3.5" fill="#f97316"/>
        <rect x="63" y="0" width="2.5" height="52" rx="1.25" fill="rgba(255,255,255,.35)"/>
      </svg>
    </div>`;
  } else {
    layer.innerHTML = `
    <div class="anim-cup-container" style="position:relative;width:120px;height:150px">
      <canvas id="cup-wave-canvas" width="78" height="72" style="position:absolute;bottom:12px;left:21px;border-radius:0 0 4px 4px;clip-path:polygon(0 0,100% 0,100% 100%,0 100%)"></canvas>
      <svg viewBox="0 0 120 150" width="120" height="150" style="position:absolute;top:0;left:0" xmlns="http://www.w3.org/2000/svg">
        <!-- corpo marmita -->
        <rect x="11" y="55" width="98" height="84" rx="7" fill="rgba(232,224,212,.85)" stroke="#b0a090" stroke-width="2.2"/>
        <!-- tampa -->
        <rect x="8"  y="44" width="104" height="18" rx="7" fill="#ddd0bc" stroke="#b0a090" stroke-width="2"/>
        <!-- alça esq -->
        <path d="M22 55 Q17 41 26 37 Q35 33 35 55" fill="none" stroke="#b0a090" stroke-width="2.5" stroke-linecap="round"/>
        <!-- alça dir -->
        <path d="M98 55 Q103 41 94 37 Q85 33 85 55" fill="none" stroke="#b0a090" stroke-width="2.5" stroke-linecap="round"/>
        <!-- divisórias -->
        <line x1="60" y1="73" x2="60" y2="139" stroke="#c8b8a8" stroke-width="1.2" stroke-dasharray="3 2" opacity=".6"/>
        <line x1="11" y1="110" x2="109" y2="110" stroke="#c8b8a8" stroke-width="1.2" stroke-dasharray="3 2" opacity=".6"/>
        <!-- reflexo tampa -->
        <path d="M18 46 Q60 42 102 46" stroke="rgba(255,255,255,.5)" stroke-width="2" fill="none" stroke-linecap="round"/>
      </svg>
    </div>`;
  }

  _cupCanvas = document.getElementById('cup-wave-canvas');
  _cupCtx    = _cupCanvas ? _cupCanvas.getContext('2d') : null;
  _startCupAnim(vtype);
}

let _animFillLevel = 0;

// ── Shoot ingredient particle toward cup ─────────────
function _dropIngredient(name, fromEl) {
  const cup = document.getElementById('cup-wave-canvas');
  if (!cup) return;
  const cupR   = cup.getBoundingClientRect();
  const targetX = cupR.left + cupR.width  * .5;
  const targetY = cupR.top  + cupR.height * .35;

  let startX = targetX, startY = targetY - 130;
  if (fromEl) {
    const r = fromEl.getBoundingClientRect();
    startX = r.left + r.width  / 2;
    startY = r.top  + r.height / 2;
  }

  const drawFn = _getIngShape(name);
  const s = 12 + Math.random() * 6;
  const dx = targetX - startX, dy = targetY - startY;
  const dur = 420 + Math.random() * 80; // ms
  const frames = Math.round(dur / 16);
  let frame = 0;
  const rot0 = (Math.random() - .5) * Math.PI;
  const rotV = (Math.random() - .5) * 0.22;

  function tick() {
    const t    = frame / frames;
    const ease = t < .5 ? 2*t*t : -1+(4-2*t)*t;
    const x    = startX + dx * ease;
    const y    = startY + dy * ease + Math.sin(t * Math.PI) * (-40);
    const life = frame < frames * .85 ? 1 : 1 - (t - .85) / .15;
    _particles.push({
      x, y, vx:0, vy:0, gravity:0, rot: rot0 + rotV*frame, rotV:0,
      life, decay:999,
      draw(ctx) { drawFn(ctx, s); }
    });
    frame++;
    if (frame <= frames) {
      requestAnimationFrame(tick);
    } else {
      _particles.push({x:targetX,y:targetY,vx:0,vy:0,gravity:0,rot:0,rotV:0,life:1,decay:999,draw(){}});
      _landSplash(targetX, targetY);
      _raiseFillLevel();
    }
    if (!_pRafId) _pRafId = requestAnimationFrame(_pLoop);
  }
  tick();
}

function _landSplash(x, y) {
  const n = 10;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    const spd   = 2 + Math.random() * 3;
    _particles.push({
      x, y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd - 2,
      gravity: 0.18, rot:0, rotV:0,
      life:1, decay: 0.06 + Math.random()*.04,
      draw(ctx) {
        ctx.beginPath(); ctx.arc(0,0,3,0,Math.PI*2);
        ctx.fillStyle='rgba(90,30,120,.7)'; ctx.fill();
      }
    });
  }
  // wave disturbance at hit point
  const wIdx = Math.round(_wavePoints.length * .5 + (Math.random()-.5)*4);
  if (_wavePoints[wIdx]) _wavePoints[wIdx].vy = -8;
}

function _raiseFillLevel() {
  _animFillLevel = Math.min(_animFillLevel + 1, 10);
  _cupTargetFill = _animFillLevel / 10 * 0.72;
}

function _lowerFillLevel() {
  _animFillLevel = Math.max(_animFillLevel - 1, 0);
  _cupTargetFill = _animFillLevel / 10 * 0.72;
}

// ══════════════════════════════════════════════════════
//  PIZZA — Canvas 2D avançado
// ══════════════════════════════════════════════════════
let _pizzaCanvas = null, _pizzaCtx = null, _pizzaRaf = null;
let _pizzaState  = { leftFill:0, rightFill:0, leftColor:'#e89a5a', rightColor:'#e89a5a', leftToppings:[], rightToppings:[], rotate:0 };

const _pizzaColors = ['#c0392b','#27ae60','#2980b9','#8e44ad','#e67e22','#16a085','#c0392b','#f39c12'];
const _toppingShapes = [
  (ctx,x,y,s) => { ctx.beginPath(); ctx.arc(x,y,s*.9,0,Math.PI*2); ctx.fillStyle='#e74c3c'; ctx.fill(); ctx.fillStyle='#c0392b'; ctx.beginPath(); ctx.arc(x-s*.2,y-s*.2,s*.25,0,Math.PI*2); ctx.fill(); },
  (ctx,x,y,s) => { ctx.beginPath(); ctx.ellipse(x,y,s*1.1,s*.5,0.3,0,Math.PI*2); ctx.fillStyle='#e67e22'; ctx.fill(); },
  (ctx,x,y,s) => { ctx.beginPath(); ctx.arc(x,y,s*.8,0,Math.PI*2); ctx.fillStyle='#2ecc71'; ctx.fill(); ctx.strokeStyle='#27ae60'; ctx.lineWidth=.5; ctx.stroke(); },
  (ctx,x,y,s) => { ctx.beginPath(); ctx.moveTo(x,y-s); for(let i=1;i<5;i++){const a=i*Math.PI*2/5-Math.PI/2;ctx.lineTo(x+Math.cos(a)*s*.5,y+Math.sin(a)*s*.5); const a2=a+Math.PI/5; ctx.lineTo(x+Math.cos(a2)*s,y+Math.sin(a2)*s);} ctx.closePath(); ctx.fillStyle='#f1c40f'; ctx.fill(); },
];

function _genToppings(colorIdx) {
  const t = []; const r = 26;
  for (let i=0; i<7; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = 10 + Math.random() * r;
    t.push({ x: Math.cos(angle)*dist, y: Math.sin(angle)*dist, s: 3+Math.random()*2.5, shape: Math.floor(Math.random()*_toppingShapes.length), opacity: 0 });
  }
  return t;
}

function _pizzaLoop() {
  if (!_pizzaCanvas) return;
  const W = _pizzaCanvas.width, H = _pizzaCanvas.height;
  const cx = W/2, cy = H/2, R = W*.44;
  _pizzaCtx.clearRect(0, 0, W, H);

  const ps = _pizzaState;
  ps.leftFill  += (1 - ps.leftFill)  * 0.06;
  ps.rightFill += (ps.rightTarget  - ps.rightFill)  * 0.06;
  ps.rotate    += (0 - ps.rotate) * 0.05;

  _pizzaCtx.save();
  _pizzaCtx.translate(cx, cy);
  _pizzaCtx.rotate(ps.rotate);

  // crust (borda)
  _pizzaCtx.beginPath(); _pizzaCtx.arc(0,0,R+8,0,Math.PI*2);
  const crustG = _pizzaCtx.createRadialGradient(0,0,R,0,0,R+8);
  crustG.addColorStop(0,'#d4a76a'); crustG.addColorStop(1,'#c8935a');
  _pizzaCtx.fillStyle=crustG; _pizzaCtx.fill();

  // base molho
  _pizzaCtx.beginPath(); _pizzaCtx.arc(0,0,R,0,Math.PI*2);
  _pizzaCtx.fillStyle='#d4614e'; _pizzaCtx.fill();

  // queijo base
  _pizzaCtx.beginPath(); _pizzaCtx.arc(0,0,R*.93,0,Math.PI*2);
  const cheeseG = _pizzaCtx.createRadialGradient(-R*.1,-R*.1,0,0,0,R*.93);
  cheeseG.addColorStop(0,'#fef08a'); cheeseG.addColorStop(.6,'#fde047'); cheeseG.addColorStop(1,'#facc15');
  _pizzaCtx.fillStyle=cheeseG; _pizzaCtx.fill();

  // bolhas de queijo
  for(let i=0;i<12;i++){
    const a=i/12*Math.PI*2, d=R*(0.3+i%3*.2);
    _pizzaCtx.beginPath(); _pizzaCtx.arc(Math.cos(a)*d,Math.sin(a)*d,R*.055,0,Math.PI*2);
    _pizzaCtx.fillStyle='rgba(234,179,8,.55)'; _pizzaCtx.fill();
  }

  // metade esquerda highlight
  if (ps.leftFill > 0.02) {
    _pizzaCtx.save();
    _pizzaCtx.beginPath(); _pizzaCtx.moveTo(0,0); _pizzaCtx.arc(0,0,R*.93,-Math.PI/2,Math.PI/2,true); _pizzaCtx.closePath();
    _pizzaCtx.fillStyle = ps.leftColor + '44';
    _pizzaCtx.globalAlpha = ps.leftFill;
    _pizzaCtx.fill();
    _pizzaCtx.restore();
    // toppings esquerda
    _pizzaCtx.save();
    _pizzaCtx.beginPath(); _pizzaCtx.moveTo(0,0); _pizzaCtx.arc(0,0,R*.93,-Math.PI/2,Math.PI/2,true); _pizzaCtx.closePath(); _pizzaCtx.clip();
    for (const t of ps.leftToppings) {
      t.opacity = Math.min(1, t.opacity + 0.05);
      _pizzaCtx.globalAlpha = t.opacity * ps.leftFill;
      _toppingShapes[t.shape](_pizzaCtx, t.x-10, t.y, t.s);
    }
    _pizzaCtx.restore();
  }

  // metade direita highlight
  if (ps.rightFill > 0.02) {
    _pizzaCtx.save();
    _pizzaCtx.beginPath(); _pizzaCtx.moveTo(0,0); _pizzaCtx.arc(0,0,R*.93,-Math.PI/2,Math.PI/2); _pizzaCtx.closePath();
    _pizzaCtx.fillStyle = ps.rightColor + '44';
    _pizzaCtx.globalAlpha = ps.rightFill;
    _pizzaCtx.fill();
    _pizzaCtx.restore();
    // toppings direita
    _pizzaCtx.save();
    _pizzaCtx.beginPath(); _pizzaCtx.moveTo(0,0); _pizzaCtx.arc(0,0,R*.93,-Math.PI/2,Math.PI/2); _pizzaCtx.closePath(); _pizzaCtx.clip();
    for (const t of ps.rightToppings) {
      t.opacity = Math.min(1, t.opacity + 0.05);
      _pizzaCtx.globalAlpha = t.opacity * ps.rightFill;
      _toppingShapes[t.shape](_pizzaCtx, t.x+10, t.y, t.s);
    }
    _pizzaCtx.restore();
  }

  // divisória
  _pizzaCtx.save();
  _pizzaCtx.beginPath(); _pizzaCtx.moveTo(0,-R-8); _pizzaCtx.lineTo(0,R+8);
  _pizzaCtx.strokeStyle='rgba(255,255,255,.7)'; _pizzaCtx.lineWidth=2.5;
  _pizzaCtx.setLineDash([6,4]); _pizzaCtx.stroke();
  _pizzaCtx.restore();

  // pontos de interrogação se vazio
  _pizzaCtx.font = 'bold 22px sans-serif';
  _pizzaCtx.textAlign = 'center'; _pizzaCtx.textBaseline = 'middle';
  if (ps.leftFill < 0.1) { _pizzaCtx.fillStyle='rgba(180,120,60,.5)'; _pizzaCtx.fillText('?', -R*.45, 0); }
  if (ps.rightFill < 0.1) { _pizzaCtx.fillStyle='rgba(180,120,60,.5)'; _pizzaCtx.fillText('?', R*.45, 0); }

  _pizzaCtx.restore();
  _pizzaRaf = requestAnimationFrame(_pizzaLoop);
}

function _updatePizzaVisual() {
  const base = allItems.find(x => x.id === _imItemId);
  if (!base) return;
  const colIdx = Math.abs((base.id||0) % _pizzaColors.length);
  _pizzaState.leftColor    = _pizzaColors[colIdx];
  _pizzaState.leftFill     = 0;
  _pizzaState.leftToppings = _genToppings(colIdx);

  if (_halfItem) {
    if (_isWholeFlavorSelected()) {
      // Inteira — mesma cor dos dois lados
      _pizzaState.rightColor    = _pizzaColors[colIdx];
      _pizzaState.rightTarget   = 1;
      _pizzaState.rightToppings = _genToppings(colIdx);
      _pizzaState.rotate        = 0;
    } else {
      const rIdx = Math.abs((_halfItem.id||0) % _pizzaColors.length);
      _pizzaState.rightColor    = _pizzaColors[rIdx];
      _pizzaState.rightTarget   = 1;
      _pizzaState.rightToppings = _genToppings(rIdx);
      _pizzaState.rotate        = 0.12;
    }
  } else {
    _pizzaState.rightTarget = 0;
  }

  const tag1 = document.getElementById('pizza-tag-left');
  const tag2 = document.getElementById('pizza-tag-right');
  if (tag1) { tag1.textContent = base.name.length > 15 ? base.name.slice(0,14)+'…' : base.name; tag1.classList.add('filled'); }
  if (tag2 && _halfItem) {
    if (_isWholeFlavorSelected()) {
      tag2.textContent = base.name.length > 15 ? base.name.slice(0,14)+'…' : base.name;
    } else {
      tag2.textContent = _halfItem.name.length > 15 ? _halfItem.name.slice(0,14)+'…' : _halfItem.name;
    }
    tag2.classList.add('filled');
  }
  else if (tag2) { tag2.textContent = '2ª metade'; tag2.classList.remove('filled'); }
}

function _initPizzaCanvas() {
  _pizzaCanvas = document.getElementById('pizza-anim-canvas');
  if (!_pizzaCanvas) return;
  _pizzaCtx  = _pizzaCanvas.getContext('2d');
  _pizzaState = { leftFill:0, leftColor:'#e89a5a', leftToppings:[], rightFill:0, rightTarget:0, rightColor:'#e89a5a', rightToppings:[], rotate:0 };
  if (_pizzaRaf) { cancelAnimationFrame(_pizzaRaf); _pizzaRaf=null; }
  _pizzaLoop();
}


function closeItemModal() {
  document.getElementById('item-modal-bg').classList.remove('on');
  _halfItem = null;
  _halfPickerOpen = false;
  const pl = document.getElementById('half-picker-list');
  if (pl) pl.style.display = 'none';
  _stopCupAnim();
  _stopBurgerAnim();
  if (_pizzaRaf) { cancelAnimationFrame(_pizzaRaf); _pizzaRaf = null; }
  _particles = [];
  // Restaura descrição ao fechar
  const descEl = document.getElementById('im-desc');
  if (descEl) descEl.style.display = '';
  document.getElementById('im-info-tabs-wrap')?.remove();
}

// ── Troca de aba no painel "Informações do produto" ──
function imSwitchTab(tab) {
  ['detalhes','preparo'].forEach(t => {
    const btn   = document.getElementById(`im-tab-btn-${t}`);
    const panel = document.getElementById(`im-tab-panel-${t}`);
    const isOn  = t === tab;
    if (btn) {
      btn.style.background   = isOn ? 'var(--accent,#f97316)' : 'transparent';
      btn.style.color        = isOn ? '#000' : 'var(--muted)';
      btn.style.borderColor  = isOn ? 'var(--accent,#f97316)' : 'var(--border,#2a2a2a)';
    }
    if (panel) panel.style.display = isOn ? 'block' : 'none';
  });
}

function imQty(d) {
  _imQty = Math.max(1, _imQty + d);
  document.getElementById('im-qty').textContent = _imQty;
  updateImAddBtn();
}

function toggleIngr(chip) {
  const wasOn = chip.classList.contains('on');
  chip.classList.toggle('on');
  // Atualiza contador
  const total = document.querySelectorAll('#im-ingr-grid .im-ingr-chip.on').length;
  const cnt = document.getElementById('im-ingr-count');
  if (cnt) {
    cnt.textContent = total;
    total > 0 ? cnt.classList.add('show') : cnt.classList.remove('show');
  }
  // Animação ingrediente
  const vtype = _itemVisualType(allItems.find(x => x.id === _imItemId));
  if (vtype === 'acai' || vtype === 'marmita') {
    const isNowOn = chip.classList.contains('on');
    if (isNowOn) {
      const label = chip.querySelector('span')?.textContent?.trim() || '';
      _dropIngredient(label, chip);
    } else {
      _lowerFillLevel();
    }
  }
  if (vtype === 'burger') {
    const isNowOn = chip.classList.contains('on');
    const label = chip.querySelector('span')?.textContent?.trim() || '';
    if (isNowOn) _addBurgerLayer(label);
    else         _removeBurgerLayer(label);
  }
}

function imConfirm() {
  const i   = allItems.find(x => x.id === _imItemId);
  if (!i) return;

  // Validate required grupos
  const grupos = i.custom_groups || [];
  for (const g of grupos) {
    if (g.tipo === 'radio' && g.min !== 0) {
      const sel = _imGruposState[g.nome] || [];
      if (!sel.length) { toast('⚠️', `Escolha: ${g.nome}`); return; }
    }
    // complementos adicionais (checkbox) são opcionais
  }

  const obs = document.getElementById('im-obs').value.trim();
  const isPizza = isPizzaItem(i);

  const selectedIngrs = [...document.querySelectorAll('#im-ingr-grid .im-ingr-chip.on')]
    .map(c => c.querySelector('span')?.textContent?.trim())
    .filter(Boolean);

  // Monta obs final: ingredientes + obs livre
  let obsComIngr = '';
  if (selectedIngrs.length > 0) {
    obsComIngr = selectedIngrs.join(', ');
    if (obs) obsComIngr += ' · ' + obs;
  } else {
    obsComIngr = obs;
  }

  // Pizza meio a meio — precisa de 2ª metade
  if (isPizza && !_halfItem) {
    toast('🍕', 'Escolha como quer sua pizza!');
    document.getElementById('half-section').scrollIntoView({behavior:'smooth',block:'center'});
    return;
  }

  let cartName  = i.name;
  let cartPrice = parseFloat(i.price);
  let cartObs   = obsComIngr;
  let cartEmoji = i.emoji;
  let cartImg   = i.image_url;

  if (isPizza && _halfItem) {
    if (_isWholeFlavorSelected()) {
      // Inteira com mesmo sabor — preço normal
      cartName  = i.name;
      cartPrice = parseFloat(i.price);
      cartObs   = obsComIngr ? `Pizza inteira · ${obsComIngr}` : 'Pizza inteira';
      cartImg   = i.image_url || null;
    } else {
      const avgPrice = (parseFloat(i.price) + parseFloat(_halfItem.price)) / 2;
      cartName  = `${i.name} / ${_halfItem.name}`;
      cartPrice = avgPrice;
      cartObs   = obsComIngr ? `Meio a meio · ${obsComIngr}` : 'Meio a meio';
      cartImg   = i.image_url || null;
    }
  }

  // ── Açougue: valida e monta descrição ──
  if (_isAcougueItem(i)) {
    const totalPesoSel = Object.values(_acougueCortes).reduce((s, v) => s + (v.peso || 0), 0);
    if (!totalPesoSel) {
      toast('🥩', 'Selecione ao menos um corte e o peso!');
      return;
    }
    const acDesc = _buildAcougueDesc();
    if (acDesc) cartObs = [acDesc, obsComIngr].filter(Boolean).join(' · ');
    // Preço proporcional ao peso total (em kg)
    cartPrice = cartPrice * (totalPesoSel / 1000) * _imQty;
    const existing2 = cart.find(c => c.name === cartName && (c.obs||'') === (cartObs||''));
    if (existing2) existing2.qty += 1;
    else cart.push({ ...i, name: cartName, price: cartPrice, obs: cartObs, emoji: cartEmoji, image_url: cartImg, qty: 1 });
    _xsellSelected.clear();
    closeItemModal();
    updateCartFloat();
    const totalKg = totalPesoSel >= 1000
      ? (totalPesoSel/1000).toFixed(1).replace('.',',') + ' kg'
      : totalPesoSel + 'g';
    toast('🥩', `${i.name} — ${totalKg} adicionado!`);
    return;
  }

  // Grupos: add description and extra price
  const gruposDesc  = _buildGruposDesc(i);
  const gruposExtra = _calcGruposExtra(i);
  if (gruposDesc) cartObs = [gruposDesc, cartObs].filter(Boolean).join(' | ');
  cartPrice = cartPrice + gruposExtra;

  const cartItem = {
    ...i,
    name:      cartName,
    price:     cartPrice,
    obs:       cartObs,
    emoji:     cartEmoji,
    image_url: cartImg,
    _grupos:   JSON.parse(JSON.stringify(_imGruposState)),
  };

  const existing = cart.find(c => c.name === cartName && (c.obs||'') === (cartObs||''));
  if (existing) existing.qty += _imQty;
  else cart.push({ ...cartItem, qty: _imQty });

  // Add cross-sell items
  for (const xid of _xsellSelected) {
    const xi = allItems.find(x => x.id === xid);
    if (!xi) continue;
    const xexist = cart.find(c => c.id === xi.id && !c.obs);
    if (xexist) xexist.qty += 1;
    else cart.push({ ...xi, qty: 1, obs: '' });
  }
  _xsellSelected.clear();

  closeItemModal();
  updateCartFloat();
  toast('🛒', `${isPizza && _halfItem && !_isWholeFlavorSelected() ? 'Pizza meio a meio' : i.name} adicionado!`);
}

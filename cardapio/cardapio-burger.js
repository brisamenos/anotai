// ══════════════════════════════════════════
//  BURGER — Animação canvas do hambúrguer
//  Estima Food — Cardápio
// ══════════════════════════════════════════
// ══════════════════════════════════════════════════════
//  HAMBÚRGUER — Canvas 2D animação avançada de montagem
// ══════════════════════════════════════════════════════
let _burgerCanvas = null, _burgerCtx = null, _burgerRaf = null;
let _burgerLayers = []; // {name, drawFn, y, targetY, vy, alpha, removing}
let _topBunY = 60;

const _BG_CX  = 80;   // center X
const _BG_W   = 136;  // ingredient width
const _BB_CY  = 176;  // bottom bun center Y
const _SLOT_H = 15;   // vertical slot per layer

/* ── Bun draw helpers ─────────────────────────────── */
function _drawBurgerBottomBun(ctx, cx, cy, w) {
  const h = 22, hw = w * .52;
  ctx.save();
  // shadow
  ctx.shadowColor = 'rgba(0,0,0,.22)';
  ctx.shadowBlur  = 8;
  ctx.shadowOffsetY = 4;
  // bun body
  const g = ctx.createLinearGradient(cx, cy - h*.5, cx, cy + h*.5);
  g.addColorStop(0, '#f0c070');
  g.addColorStop(0.5, '#e8a840');
  g.addColorStop(1, '#c87820');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, hw, h*.52, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  // cut face (lighter)
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.ellipse(cx, cy - h*.1, hw * .92, h*.28, 0, 0, Math.PI * 2);
  ctx.fill();
  // highlight
  ctx.fillStyle = 'rgba(255,255,220,.35)';
  ctx.beginPath();
  ctx.ellipse(cx - hw*.18, cy - h*.25, hw*.42, h*.15, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function _drawBurgerTopBun(ctx, cx, cy, w) {
  const hw = w * .52;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.18)';
  ctx.shadowBlur  = 10;
  ctx.shadowOffsetY = 5;
  // bun dome
  const g = ctx.createLinearGradient(cx, cy - 28, cx, cy + 10);
  g.addColorStop(0, '#f59e0b');
  g.addColorStop(0.4, '#d97706');
  g.addColorStop(1, '#b45309');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - hw, cy + 8);
  ctx.quadraticCurveTo(cx - hw * 1.04, cy - 4, cx - hw * .5, cy - 20);
  ctx.quadraticCurveTo(cx, cy - 34, cx + hw * .5, cy - 20);
  ctx.quadraticCurveTo(cx + hw * 1.04, cy - 4, cx + hw, cy + 8);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  // bottom flat part
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 6, hw * .98, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  // highlight dome
  ctx.fillStyle = 'rgba(255,255,220,.28)';
  ctx.beginPath();
  ctx.ellipse(cx - hw*.15, cy - 16, hw*.42, 10, -0.3, 0, Math.PI * 2);
  ctx.fill();
  // sesame seeds
  ctx.fillStyle = '#fff8e1';
  const seeds = [[-18,-10],[0,-18],[18,-10],[-10,-4],[10,-6],[26,-2],[-26,-2]];
  seeds.forEach(([dx,dy]) => {
    ctx.save();
    ctx.translate(cx + dx, cy + dy);
    ctx.rotate(dx * 0.06);
    ctx.beginPath();
    ctx.ellipse(0, 0, 4.5, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f0dea0';
    ctx.beginPath();
    ctx.ellipse(0.5, -0.5, 3.5, 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
  ctx.restore();
}

/* ── Per-ingredient Canvas 2D draw functions ──────── */
const _burgerIngShapes = {

  alface(ctx, cx, y, w) {
    const h = 14;
    ctx.save();
    const g = ctx.createLinearGradient(cx, y, cx, y + h);
    g.addColorStop(0, '#4ade80'); g.addColorStop(1, '#16a34a');
    ctx.fillStyle = g;
    ctx.beginPath();
    const S = 14, hw = w * .54;
    ctx.moveTo(cx - hw, y + h * .75);
    for (let i = 0; i <= S; i++) {
      const tx = cx - hw + (hw * 2) * i / S;
      const ty = y + h * .2 + Math.sin(i * 1.9 + .4) * h * .42;
      i === 0 ? ctx.moveTo(tx, ty) : ctx.lineTo(tx, ty);
    }
    ctx.lineTo(cx + hw, y + h * .95); ctx.lineTo(cx - hw, y + h * .95); ctx.closePath(); ctx.fill();
    // vein
    ctx.strokeStyle = 'rgba(21,128,61,.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - hw * .4, y + h * .55); ctx.lineTo(cx + hw * .3, y + h * .8); ctx.stroke();
    // highlight frills
    ctx.fillStyle = 'rgba(187,247,208,.4)';
    for (let i = 0; i < S; i++) {
      const tx = cx - hw + (hw * 2) * i / S;
      const ty = y + h * .2 + Math.sin(i * 1.9 + .4) * h * .42;
      ctx.beginPath(); ctx.arc(tx, ty, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  },

  tomate(ctx, cx, y, w) {
    const h = 13, r = w * .47;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(cx, y + h * .52, r, h * .46, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444'; ctx.fill();
    // segments
    ctx.save(); ctx.clip();
    ctx.strokeStyle = '#fca5a5'; ctx.lineWidth = .7; ctx.globalAlpha = .65;
    for (let a = 0; a < 6; a++) {
      const angle = a / 6 * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, y + h * .52);
      ctx.lineTo(cx + Math.cos(angle) * r, y + h * .52 + Math.sin(angle) * h * .44); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // seeds
    ctx.fillStyle = '#fef08a';
    for (let i = 0; i < 8; i++) {
      const a2 = i / 8 * Math.PI * 2, d = r * .52;
      ctx.beginPath(); ctx.ellipse(cx + Math.cos(a2) * d, y + h * .52 + Math.sin(a2) * h * .42, 2.4, 1.4, a2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // skin sheen
    ctx.globalAlpha = .15; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(cx - r * .3, y + h * .28, r * .35, h * .18, -.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },

  queijo(ctx, cx, y, w) {
    const h = 10, hw = w * .54;
    ctx.save();
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.moveTo(cx - hw, y + 3);
    ctx.lineTo(cx - hw * .35, y); ctx.lineTo(cx + hw * .1, y + 1.5); ctx.lineTo(cx + hw * .45, y);
    ctx.lineTo(cx + hw, y + 2);
    ctx.lineTo(cx + hw + 2, y + h * .55);
    ctx.quadraticCurveTo(cx + hw + 1, y + h + 5, cx + hw - 8, y + h + 8);
    ctx.lineTo(cx + hw - 12, y + h);
    ctx.lineTo(cx - hw, y + h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fef9c3'; ctx.globalAlpha = .55;
    ctx.fillRect(cx - hw + 2, y + 1, hw * .9, 3.5);
    // left drip
    ctx.globalAlpha = 1; ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.moveTo(cx - hw * .6, y + h);
    ctx.quadraticCurveTo(cx - hw * .55, y + h + 6, cx - hw * .52, y + h + 9);
    ctx.quadraticCurveTo(cx - hw * .48, y + h + 6, cx - hw * .44, y + h);
    ctx.fill();
    ctx.restore();
  },

  bacon(ctx, cx, y, w) {
    const h = 12, hw = w * .52;
    ctx.save();
    const STRIPS = 3;
    for (let s = 0; s < STRIPS; s++) {
      const sy = y + s * (h / STRIPS);
      const meat = s % 2 === 0;
      ctx.fillStyle = meat ? '#b91c1c' : '#fca5a5';
      ctx.beginPath();
      const pts = 10;
      for (let i = 0; i <= pts; i++) {
        const tx = cx - hw + (hw * 2) * i / pts;
        const ty = sy + Math.sin(i * 1.4 + s * 2.1) * 2;
        i === 0 ? ctx.moveTo(tx, ty) : ctx.lineTo(tx, ty);
      }
      ctx.lineTo(cx + hw, sy + h / STRIPS + 1);
      ctx.lineTo(cx - hw, sy + h / STRIPS + 1); ctx.closePath(); ctx.fill();
    }
    // fat streaks
    ctx.strokeStyle = 'rgba(255,240,220,.6)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) {
      const sx = cx - hw * .8 + i * hw * .38;
      ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx + hw * .05, y + h); ctx.stroke();
    }
    ctx.restore();
  },

  cebola(ctx, cx, y, w) {
    const h = 11, r0 = w * .46;
    ctx.save();
    for (let r = 4; r >= 0; r--) {
      const rx = r0 - r * r0 * .14, ry = h * .42 - r * h * .07;
      ctx.beginPath(); ctx.ellipse(cx, y + h * .52, rx, ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = r % 2 === 0 ? 'rgba(167,139,250,.85)' : 'rgba(196,181,253,.6)';
      ctx.lineWidth = 1.6; ctx.stroke();
    }
    ctx.fillStyle = 'rgba(237,233,254,.2)';
    ctx.beginPath(); ctx.ellipse(cx, y + h * .52, r0 * .92, h * .4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },

  ovo(ctx, cx, y, w) {
    const h = 15, hw = w * .5;
    ctx.save();
    // white
    ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.12)'; ctx.shadowBlur = 4;
    ctx.beginPath(); ctx.ellipse(cx, y + h * .56, hw, h * .42, 0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#f3f4f6'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(cx, y + h * .56, hw, h * .42, 0, 0, Math.PI * 2); ctx.stroke();
    // yolk
    const yg = ctx.createRadialGradient(cx - hw * .1, y + h * .44, 0, cx, y + h * .5, hw * .26);
    yg.addColorStop(0, '#fef08a'); yg.addColorStop(.6, '#fbbf24'); yg.addColorStop(1, '#d97706');
    ctx.fillStyle = yg;
    ctx.beginPath(); ctx.arc(cx, y + h * .5, hw * .26, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },

  pepino(ctx, cx, y, w) {
    const h = 11, hw = w * .44;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(cx, y + h * .5, hw, h * .44, 0, 0, Math.PI * 2);
    const g = ctx.createLinearGradient(cx, y, cx, y + h);
    g.addColorStop(0, '#86efac'); g.addColorStop(1, '#22c55e');
    ctx.fillStyle = g; ctx.fill();
    // skin lines
    ctx.save(); ctx.clip();
    ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 1;
    for (let i = -4; i <= 4; i++) {
      ctx.globalAlpha = .35;
      ctx.beginPath(); ctx.moveTo(cx + i * hw * .24, y); ctx.lineTo(cx + i * hw * .2, y + h); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fef9c3';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath(); ctx.ellipse(cx - hw * .72 + i * hw * .28, y + h * .5, 2.2, 1.2, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore(); ctx.restore();
  },

  cogumelo(ctx, cx, y, w) {
    const h = 16, hw = w * .4;
    ctx.save();
    // stalk
    ctx.fillStyle = '#e7e5e4';
    ctx.beginPath(); ctx.roundRect(cx - hw * .22, y + h * .52, hw * .44, h * .5, 3); ctx.fill();
    // cap
    ctx.beginPath(); ctx.arc(cx, y + h * .42, hw, Math.PI, 0);
    ctx.lineTo(cx + hw, y + h * .56); ctx.lineTo(cx - hw, y + h * .56); ctx.closePath();
    const mg = ctx.createRadialGradient(cx - hw * .2, y + h * .2, 0, cx, y + h * .42, hw);
    mg.addColorStop(0, '#a16207'); mg.addColorStop(.5, '#78350f'); mg.addColorStop(1, '#3c1a00');
    ctx.fillStyle = mg; ctx.fill();
    // gills underside
    ctx.fillStyle = '#d6b896'; ctx.globalAlpha = .5;
    ctx.beginPath(); ctx.ellipse(cx, y + h * .56, hw, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // spots
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    [[-hw*.5, h*.22],[hw*.15, h*.15],[hw*.5, h*.3]].forEach(([dx,dy]) => {
      ctx.beginPath(); ctx.arc(cx + dx, y + dy, 4, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  },

  maionese(ctx, cx, y, w) {
    const h = 8, hw = w * .52;
    ctx.save();
    ctx.fillStyle = '#fffbeb';
    ctx.beginPath();
    const pts = 14;
    ctx.moveTo(cx - hw, y + h * .5);
    for (let i = 0; i <= pts; i++) {
      const tx = cx - hw + hw * 2 * i / pts;
      const ty = y + Math.sin(i * 2.6) * 2.8 + 1.5;
      ctx.lineTo(tx, ty);
    }
    ctx.lineTo(cx + hw, y + h); ctx.lineTo(cx - hw, y + h); ctx.closePath(); ctx.fill();
    // drips
    ctx.fillStyle = '#fef9c3';
    [-hw*.38, 0, hw*.38].forEach(dx => {
      ctx.beginPath();
      ctx.moveTo(cx + dx - 4, y + h);
      ctx.quadraticCurveTo(cx + dx, y + h + 6, cx + dx + 2, y + h + 9);
      ctx.quadraticCurveTo(cx + dx + 5, y + h + 6, cx + dx + 8, y + h);
      ctx.fill();
    });
    ctx.restore();
  },

  molho(ctx, cx, y, w) {
    const h = 8, hw = w * .52;
    ctx.save();
    ctx.fillStyle = 'rgba(220,38,38,.88)';
    ctx.beginPath();
    const pts = 14;
    for (let i = 0; i <= pts; i++) {
      const tx = cx - hw + hw * 2 * i / pts;
      const ty = y + Math.sin(i * 2.9 + 1.1) * 2.8 + 1.5;
      i === 0 ? ctx.moveTo(tx, ty) : ctx.lineTo(tx, ty);
    }
    ctx.lineTo(cx + hw, y + h); ctx.lineTo(cx - hw, y + h); ctx.closePath(); ctx.fill();
    // drips
    [-hw * .45, hw * .2].forEach(dx => {
      ctx.beginPath();
      ctx.moveTo(cx + dx - 4, y + h);
      ctx.quadraticCurveTo(cx + dx, y + h + 7, cx + dx + 2, y + h + 11);
      ctx.quadraticCurveTo(cx + dx + 5, y + h + 7, cx + dx + 9, y + h);
      ctx.fill();
    });
    ctx.restore();
  },

  carne(ctx, cx, y, w) {
    const h = 18, hw = w * .52;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    const g = ctx.createLinearGradient(cx, y, cx, y + h);
    g.addColorStop(0, '#7c2d12'); g.addColorStop(.45, '#6b2113'); g.addColorStop(1, '#3c0f00');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx, y + h * .52, hw, h * .47, 0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    // texture cracks
    ctx.strokeStyle = 'rgba(60,15,0,.6)'; ctx.lineWidth = 1;
    for (let t = 0; t < 4; t++) {
      ctx.beginPath(); ctx.moveTo(cx - hw * .65 + t * hw * .38, y + h * .42);
      ctx.lineTo(cx - hw * .5 + t * hw * .38, y + h * .62); ctx.stroke();
    }
    // sear grill marks
    ctx.strokeStyle = '#1c0a00'; ctx.lineWidth = 2.5; ctx.globalAlpha = .55;
    [[-.28,.3],[-.28,.55]].forEach(([x1, y1]) => {
      ctx.beginPath(); ctx.moveTo(cx + x1 * hw * 2, y + y1 * h);
      ctx.lineTo(cx + (x1 + .45) * hw * 2, y + (y1 + .04) * h); ctx.stroke();
    });
    ctx.globalAlpha = 1;
    // edge highlight
    ctx.strokeStyle = 'rgba(200,80,20,.4)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(cx, y + h * .52, hw, h * .47, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  },

  frango(ctx, cx, y, w) {
    const h = 17, hw = w * .52;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.2)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
    const g = ctx.createLinearGradient(cx, y, cx, y + h);
    g.addColorStop(0, '#fde68a'); g.addColorStop(.5, '#f59e0b'); g.addColorStop(1, '#b45309');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - hw, y + h * .45);
    ctx.quadraticCurveTo(cx - hw * 1.04, y + h * .1, cx - hw * .28, y + 2);
    ctx.quadraticCurveTo(cx, y, cx + hw * .28, y + 2);
    ctx.quadraticCurveTo(cx + hw * 1.04, y + h * .1, cx + hw, y + h * .45);
    ctx.quadraticCurveTo(cx + hw * 1.04, y + h * .9, cx + hw * .28, y + h - 2);
    ctx.quadraticCurveTo(cx, y + h, cx - hw * .28, y + h - 2);
    ctx.quadraticCurveTo(cx - hw * 1.04, y + h * .9, cx - hw, y + h * .45);
    ctx.fill(); ctx.shadowBlur = 0;
    // breading crumbs
    ctx.fillStyle = 'rgba(180,83,9,.45)';
    for (let i = 0; i < 12; i++) {
      const bx = cx - hw * .7 + (i % 5) * hw * .35;
      const by = y + 4 + Math.floor(i / 5) * (h * .38);
      ctx.beginPath(); ctx.ellipse(bx, by, 3.2, 2, (i * .5), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  },

  default(ctx, cx, y, w) {
    const h = 11, hw = w * .5;
    ctx.save();
    const g = ctx.createLinearGradient(cx, y, cx, y + h);
    g.addColorStop(0, '#fb923c'); g.addColorStop(1, '#c2410c');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx, y + h * .5, hw, h * .46, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
};

function _getBurgerIngShape(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('alface')||n.includes('lettuce')||n.includes('rúcula')||n.includes('rucula')||n.includes('espinafre')||n.includes('folha')) return _burgerIngShapes.alface;
  if (n.includes('tomat'))                                   return _burgerIngShapes.tomate;
  if (n.includes('queijo')||n.includes('cheese')||n.includes('cheddar')||n.includes('mussarela')||n.includes('gruyere')||n.includes('prato')||n.includes('brie')) return _burgerIngShapes.queijo;
  if (n.includes('bacon')||n.includes('panceta'))            return _burgerIngShapes.bacon;
  if (n.includes('cebola')||n.includes('onion'))             return _burgerIngShapes.cebola;
  if (n.includes('ovo')||n.includes('egg'))                  return _burgerIngShapes.ovo;
  if (n.includes('pepino')||n.includes('gherkin')||n.includes('cucumber')) return _burgerIngShapes.pepino;
  if (n.includes('cogumelo')||n.includes('mushroom')||n.includes('shiitake')||n.includes('portobello')) return _burgerIngShapes.cogumelo;
  if (n.includes('maionese')||n.includes('mayo')||n.includes('aioli')||n.includes('mostarda')) return _burgerIngShapes.maionese;
  if (n.includes('ketchup')||n.includes('molho')||n.includes('barbecue')||n.includes('bbq')||n.includes('sauce')||n.includes('pimenta')) return _burgerIngShapes.molho;
  if (n.includes('carne')||n.includes('bife')||n.includes('smash')||n.includes('angus')||n.includes('picanha')||n.includes('blend')||n.includes('patty')) return _burgerIngShapes.carne;
  if (n.includes('frango')||n.includes('chicken')||n.includes('crispy')||n.includes('empanado')||n.includes('grelhado')) return _burgerIngShapes.frango;
  return _burgerIngShapes.default;
}

function _recalcBurgerTargets() {
  const active = _burgerLayers.filter(l => !l.removing);
  active.forEach((l, i) => {
    l.targetY = _BB_CY - 13 - (i + 1) * _SLOT_H;
  });
  _burgerLayers.filter(l => l.removing).forEach(l => {
    l.targetY = l.y - 50;
  });
}

function _addBurgerLayer(name) {
  if (_burgerLayers.find(l => l.name === name && !l.removing)) return;
  const drawFn = _getBurgerIngShape(name);
  const layer = { name, drawFn, y: -25, targetY: 0, vy: -3, alpha: 0, removing: false };
  _burgerLayers.push(layer);
  _recalcBurgerTargets();
  if (!_burgerRaf) _burgerRaf = requestAnimationFrame(_burgerLoop);
}

function _removeBurgerLayer(name) {
  const l = _burgerLayers.find(x => x.name === name && !x.removing);
  if (!l) return;
  l.removing = true;
  _recalcBurgerTargets();
  setTimeout(() => {
    _burgerLayers = _burgerLayers.filter(x => !(x.name === name && x.removing));
    _recalcBurgerTargets();
  }, 450);
}

function _burgerLoop() {
  if (!_burgerCanvas) return;
  const ctx = _burgerCtx;
  const W = _burgerCanvas.width, H = _burgerCanvas.height;
  ctx.clearRect(0, 0, W, H);

  // bottom bun
  _drawBurgerBottomBun(ctx, _BG_CX, _BB_CY, _BG_W);

  // layers — draw bottom-first (lower index = lower in burger)
  for (const l of _burgerLayers) {
    const spring = 0.17, damp = 0.62;
    l.vy += (l.targetY - l.y) * spring;
    l.vy *= damp;
    l.y  += l.vy;
    l.alpha = l.removing ? Math.max(0, l.alpha - 0.07) : Math.min(1, l.alpha + 0.12);
    ctx.save(); ctx.globalAlpha = l.alpha;
    l.drawFn(ctx, _BG_CX, l.y, _BG_W);
    ctx.restore();
  }

  // top bun — floats above highest active layer
  const active = _burgerLayers.filter(l => !l.removing);
  const topmost = active.length > 0 ? Math.min(...active.map(l => l.y)) : _BB_CY - 14;
  _topBunY += (topmost - 30 - _topBunY) * 0.10;
  _drawBurgerTopBun(ctx, _BG_CX, _topBunY, _BG_W);

  // idle sway when no ingredients
  if (_burgerLayers.length === 0) {
    const t = Date.now() / 1800;
    _topBunY += Math.sin(t) * 0.3;
  }

  _burgerRaf = requestAnimationFrame(_burgerLoop);
}

function _initBurgerCanvas() {
  _burgerLayers = [];
  _burgerCanvas = document.getElementById('burger-canvas');
  if (!_burgerCanvas) return;
  _burgerCtx = _burgerCanvas.getContext('2d');
  _topBunY = _BB_CY - 42;
  if (_burgerRaf) { cancelAnimationFrame(_burgerRaf); _burgerRaf = null; }
  _burgerRaf = requestAnimationFrame(_burgerLoop);
}

function _stopBurgerAnim() {
  if (_burgerRaf) { cancelAnimationFrame(_burgerRaf); _burgerRaf = null; }
  _burgerCanvas = null; _burgerCtx = null; _burgerLayers = [];
}

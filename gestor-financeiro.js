// ═══════════════════════════════════════════════════════
// SONS DE NOTIFICAÇÃO
// ═══════════════════════════════════════════════════════

const SOUND_OPTIONS = [
  { id: 'ifood',     label: 'iFood',        desc: 'Toque clássico de delivery'  },
  { id: 'ifood_duplo', label: 'iFood insistente', desc: 'Toque iFood repetido 2x'  },
  { id: 'ifood_suave', label: 'iFood suave',  desc: 'Versão mais discreta'        },
  { id: 'sino',      label: 'Sino',         desc: 'Três bipes suaves'         },
  { id: 'duplo',     label: 'Duplo alerta',  desc: 'Dois bipes rápidos'        },
  { id: 'caixa',     label: 'Caixa',        desc: 'Estilo caixa registradora'  },
  { id: 'urgente',   label: 'Urgente',      desc: 'Alerta rápido e forte'      },
  { id: 'suave',     label: 'Suave',        desc: 'Toque discreto'             },
  { id: 'desligado', label: 'Desligado',    desc: 'Sem som'                    },
];

let _soundPref = (() => {
  try { return localStorage.getItem('ef_sound') || 'ifood'; } catch { return 'ifood'; }
})();

function _getAudioCtx() {
  return new (window.AudioContext || window.webkitAudioContext)();
}

// Toca um único oscilador
function _tone(ctx, type, freq, startAt, dur, vol, endVol = 0.001) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.connect(g); g.connect(ctx.destination);
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, ctx.currentTime + startAt);
  g.gain.exponentialRampToValueAtTime(endVol, ctx.currentTime + startAt + dur);
  o.start(ctx.currentTime + startAt);
  o.stop(ctx.currentTime + startAt + dur + 0.01);
}

// Nota estilo "glockenspiel" (xilofone/sino metálico) — usada no som iFood.
// Mistura sine (fundamental) + triangle (harmônico) + sine aguda (brilho) com ADSR curto.
function _bell(ctx, freq, startAt, vol = 0.35) {
  const t0 = ctx.currentTime + startAt;
  // Attack muito rápido (ataque "ding"), decay exponencial longo (~0.6s)
  const decay = 0.65;
  // Fundamental (sine)
  const o1 = ctx.createOscillator();
  const g1 = ctx.createGain();
  o1.type = 'sine'; o1.frequency.value = freq;
  o1.connect(g1); g1.connect(ctx.destination);
  g1.gain.setValueAtTime(0.0001, t0);
  g1.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
  g1.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
  o1.start(t0); o1.stop(t0 + decay + 0.02);
  // Harmônico (triangle — dá o timbre metálico)
  const o2 = ctx.createOscillator();
  const g2 = ctx.createGain();
  o2.type = 'triangle'; o2.frequency.value = freq * 2;
  o2.connect(g2); g2.connect(ctx.destination);
  g2.gain.setValueAtTime(0.0001, t0);
  g2.gain.exponentialRampToValueAtTime(vol * 0.25, t0 + 0.004);
  g2.gain.exponentialRampToValueAtTime(0.0001, t0 + decay * 0.7);
  o2.start(t0); o2.stop(t0 + decay + 0.02);
  // Brilho (sine 3ª harmônica)
  const o3 = ctx.createOscillator();
  const g3 = ctx.createGain();
  o3.type = 'sine'; o3.frequency.value = freq * 3.01;  // leve detune pra não ficar plastificado
  o3.connect(g3); g3.connect(ctx.destination);
  g3.gain.setValueAtTime(0.0001, t0);
  g3.gain.exponentialRampToValueAtTime(vol * 0.12, t0 + 0.003);
  g3.gain.exponentialRampToValueAtTime(0.0001, t0 + decay * 0.4);
  o3.start(t0); o3.stop(t0 + decay + 0.02);
}

// Melodia iFood — 4 notas em escala pentatônica ascendente.
// Estilo: "tlim-tlim-tlim-tlim" subindo — reconhecível, urgente mas não agressivo.
// Notas: Sol5 (784) → Lá5 (880) → Dó6 (1047) → Mi6 (1319)
function _ifoodJingle(ctx, startOffset = 0, vol = 0.35) {
  const notas = [784, 880, 1047, 1319];
  const gap   = 0.14;  // 140ms entre notas
  notas.forEach((f, i) => _bell(ctx, f, startOffset + i * gap, vol));
}

const SOUNDS = {
  // Toque estilo iFood — pentatônica ascendente, uma vez
  ifood: (ctx) => {
    _ifoodJingle(ctx, 0, 0.38);
  },
  // Toque iFood insistente — repete 2x com pausa curta (estilo quando pedido é urgente)
  ifood_duplo: (ctx) => {
    _ifoodJingle(ctx, 0,    0.38);
    _ifoodJingle(ctx, 0.75, 0.32);
  },
  // Toque iFood suave — mesma melodia com volume reduzido e tempo mais lento
  ifood_suave: (ctx) => {
    const notas = [784, 880, 1047, 1319];
    const gap   = 0.20;
    notas.forEach((f, i) => _bell(ctx, f, i * gap, 0.18));
  },
  // Três dings de sino — suave e claro
  sino: (ctx) => {
    [[1046, 0, 0.22, 0.28], [1318, 0.28, 0.22, 0.28], [1568, 0.56, 0.3, 0.36]].forEach(([f, t, d, vol]) => {
      _tone(ctx, 'sine', f, t, d, vol);
      _tone(ctx, 'sine', f * 2, t, d * 0.6, vol * 0.15); // harmônico
    });
  },
  // Dois bipes rápidos — urgente mas não agressivo
  duplo: (ctx) => {
    [[880, 0, 0.12, 0.3], [880, 0.18, 0.12, 0.3]].forEach(([f, t, d, vol]) =>
      _tone(ctx, 'square', f, t, d, vol)
    );
  },
  // Caixa registradora — ding + ruído
  caixa: (ctx) => {
    _tone(ctx, 'triangle', 1200, 0,    0.08, 0.4);
    _tone(ctx, 'triangle', 900,  0.08, 0.06, 0.3);
    _tone(ctx, 'sine',     1600, 0.14, 0.18, 0.25);
    // Clique inicial
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.02, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    const gn  = ctx.createGain();
    src.buffer = buf; src.connect(gn); gn.connect(ctx.destination);
    gn.gain.setValueAtTime(0.5, ctx.currentTime);
    src.start(ctx.currentTime);
  },
  // Alerta urgente — beep agressivo triplo
  urgente: (ctx) => {
    [[1000, 0, 0.07, 0.45], [1000, 0.1, 0.07, 0.45], [1000, 0.2, 0.1, 0.45]].forEach(([f, t, d, vol]) => {
      _tone(ctx, 'sawtooth', f, t, d, vol);
    });
  },
  // Toque suave — sino único longo
  suave: (ctx) => {
    _tone(ctx, 'sine', 880,  0,    0.4, 0.2);
    _tone(ctx, 'sine', 1100, 0.05, 0.35, 0.12);
  },
  desligado: () => {},
};

function playOrderSound() {
  if (_soundPref === 'desligado') return;
  try {
    const ctx = _getAudioCtx();
    (SOUNDS[_soundPref] || SOUNDS.ifood)(ctx);
  } catch(e) {}
}

// ── Alerta persistente — insiste até aceitar (estilo iFood) ──────────
let _alertInterval  = null;
let _alertCount     = 0;   // quantas vezes já tocou neste ciclo
const _ALERT_GAP    = 10000; // ms entre repetições (10s — próximo do iFood)
const _ALERT_MAX    = 60;   // para após 60 repetições (~10 min) como failsafe

function _startPersistentAlert() {
  if (_soundPref === 'desligado') return;
  if (_alertInterval) return; // já rodando
  _alertCount = 0;
  _alertInterval = setInterval(() => {
    // Para se não houver mais pedidos em analise ou atingiu o limite
    const hasAnalise = ordersKanban.some(o => o.status === 'analise');
    if (!hasAnalise || _alertCount >= _ALERT_MAX) {
      _stopPersistentAlert();
      return;
    }
    _alertCount++;
    // Alterna: som normal + vibração visual do badge de notificação
    playOrderSound();
    const nc = document.getElementById('notif-count');
    if (nc) {
      nc.style.transform = 'scale(1.4)';
      setTimeout(() => { if (nc) nc.style.transform = ''; }, 300);
    }
  }, _ALERT_GAP);
}

function _stopPersistentAlert() {
  if (_alertInterval) { clearInterval(_alertInterval); _alertInterval = null; }
  _alertCount = 0;
}

// Para o alerta quando não há mais pedidos em analise
function _checkStopAlert() {
  if (_alertInterval && !ordersKanban.some(o => o.status === 'analise')) {
    _stopPersistentAlert();
  }
}

function previewSound(id) {
  if (id === 'desligado') return;
  try {
    const ctx = _getAudioCtx();
    (SOUNDS[id] || SOUNDS.sino)(ctx);
  } catch(e) {}
}

function setSoundPref(id) {
  _soundPref = id;
  try { localStorage.setItem('ef_sound', id); } catch {}
  // Atualiza UI
  document.querySelectorAll('.sound-opt').forEach(el => {
    const active = el.dataset.sound === id;
    el.style.borderColor    = active ? 'var(--accent)'     : 'var(--border)';
    el.style.background     = active ? 'var(--accent-dim)' : 'var(--surface2)';
    el.querySelector('.sound-check').style.opacity = active ? '1' : '0';
  });
  previewSound(id);
}

function renderSoundConfig() {
  const el = document.getElementById('cfg-sound-list');
  if (!el) return;
  el.innerHTML = SOUND_OPTIONS.map(s => `
    <div class="sound-opt" data-sound="${s.id}"
      onclick="setSoundPref('${s.id}')"
      style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:10px;border:1.5px solid ${_soundPref===s.id?'var(--accent)':'var(--border)'};background:${_soundPref===s.id?'var(--accent-dim)':'var(--surface2)'};cursor:pointer;transition:all .15s;margin-bottom:8px">
      <div style="width:34px;height:34px;border-radius:9px;background:var(--surface3);display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">${s.id==='desligado'
          ? '<line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M6 4.5V3L4 6H2v4h2l2 3V9M12 4a6 6 0 0 1 0 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'
          : '<path d="M3 6H1v4h2l4 3V3L3 6z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 5a4 4 0 0 1 0 6M13.5 3a7 7 0 0 1 0 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
        }</svg>
      </div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600">${s.label}</div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:1px">${s.desc}</div>
      </div>
      <button onclick="event.stopPropagation();previewSound('${s.id}')"
        style="background:var(--surface3);border:1px solid var(--border);border-radius:7px;padding:4px 10px;color:var(--muted2);font-size:11.5px;cursor:pointer;white-space:nowrap"
        ${s.id==='desligado'?'disabled style="opacity:.3;pointer-events:none"':''}>
        Ouvir
      </button>
      <div class="sound-check" style="opacity:${_soundPref===s.id?'1':'0'};color:var(--accent);transition:opacity .15s">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/>
          <path d="M5 8l2.5 2.5L11 5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>`
  ).join('');
}


// ─────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────
let tTimer;
function showToast(icon,msg){
  const t=document.getElementById('toast');
  document.getElementById('ti').innerHTML=icon;
  document.getElementById('tm').textContent=msg;
  t.style.display='flex';
  clearTimeout(tTimer);
  tTimer=setTimeout(()=>t.style.display='none',2800);
}

// ─────────────────────────────────────────
// TAXA DE ENTREGA
// ─────────────────────────────────────────
let _taxaConfig = { tipo: 'fixo', valor: 5, faixas: [] };

async function renderTaxaPage() {
  try {
    const { data } = await sb.from('store_config').select('delivery_fee_config,store_lat,store_lng').single();
    if (data?.delivery_fee_config) _taxaConfig = data.delivery_fee_config;
    // Atualiza aviso de localização
    const locStatus = document.getElementById('taxa-loc-status');
    if (locStatus) {
      const hasLoc = data?.store_lat && data?.store_lng;
      locStatus.textContent = hasLoc
        ? `✅ Localização configurada (${parseFloat(data.store_lat).toFixed(4)}, ${parseFloat(data.store_lng).toFixed(4)})`
        : '⚠️ Localização ainda não configurada — os clientes verão as faixas mas sem cálculo automático.';
      locStatus.style.color = hasLoc ? '#16a34a' : '#b45309';
    }
  } catch(e) {}

  const tipo = _taxaConfig.tipo || 'fixo';
  document.getElementById('taxa-tipo-fixo').checked   = tipo === 'fixo';
  document.getElementById('taxa-tipo-km').checked     = tipo === 'por_km';
  document.getElementById('taxa-tipo-bairro').checked = tipo === 'por_bairro';
  document.getElementById('taxa-fixo-val').value      = _taxaConfig.valor ?? 5;

  // Faixas de km
  const faixas = _taxaConfig.faixas || [];
  const list = document.getElementById('taxa-faixas-list');
  list.innerHTML = '';
  if (!faixas.length && tipo === 'por_km') {
    [[1, 3], [3, 5], [7, 8]].forEach(([km, tx]) => _addFaixaRow(km, tx));
  } else {
    faixas.forEach(f => _addFaixaRow(f.ate_km, f.taxa));
  }

  // Bairros
  const bairros = _taxaConfig.bairros || [];
  const listB = document.getElementById('taxa-bairros-list');
  listB.innerHTML = '';
  if (!bairros.length && tipo === 'por_bairro') {
    _addBairroRow('', '');
  } else {
    bairros.forEach(b => _addBairroRow(b.bairro, b.taxa));
  }

  // Bairros bloqueados (sempre carrega, vale para qualquer tipo)
  const bloqueados = _taxaConfig.bairros_bloqueados || [];
  const listBlock = document.getElementById('taxa-bairros-bloqueados-list');
  if (listBlock) {
    listBlock.innerHTML = '';
    bloqueados.forEach(b => _addBairroBloqueadoRow(b));
  }

  onTaxaTipoChange();
}

function onTaxaTipoChange() {
  const tipo = document.querySelector('input[name="taxa-tipo"]:checked').value;
  document.getElementById('taxa-fixo-block').style.display   = tipo === 'fixo'       ? '' : 'none';
  document.getElementById('taxa-km-block').style.display     = tipo === 'por_km'     ? '' : 'none';
  document.getElementById('taxa-bairro-block').style.display = tipo === 'por_bairro' ? '' : 'none';
  // Update label borders
  document.getElementById('taxa-label-fixo').style.borderColor   = tipo === 'fixo'       ? 'var(--accent)' : 'var(--border)';
  document.getElementById('taxa-label-km').style.borderColor     = tipo === 'por_km'     ? 'var(--accent)' : 'var(--border)';
  document.getElementById('taxa-label-bairro').style.borderColor = tipo === 'por_bairro' ? 'var(--accent)' : 'var(--border)';
  updateTaxaPreview();
}

function _addFaixaRow(km, taxa) {
  const list = document.getElementById('taxa-faixas-list');
  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:center';
  row.innerHTML = `
    <input class="form-input" type="number" min="0" step="0.5" placeholder="Ex: 3" value="${km||''}" oninput="updateTaxaPreview()" style="margin-bottom:0">
    <input class="form-input" type="number" min="0" step="0.50" placeholder="Ex: 5.00" value="${taxa||''}" oninput="updateTaxaPreview()" style="margin-bottom:0">
    <button onclick="this.closest('div').remove();updateTaxaPreview()" style="width:28px;height:28px;border-radius:7px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.2);color:var(--danger);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">✕</button>
  `;
  list.appendChild(row);
  updateTaxaPreview();
}

function addTaxaFaixa() { _addFaixaRow('', ''); }

function _addBairroRow(bairro, taxa) {
  const list = document.getElementById('taxa-bairros-list');
  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:center';
  row.innerHTML = `
    <input class="form-input" type="text" placeholder="Ex: Centro" value="${(bairro||'').replace(/"/g,'&quot;')}" oninput="updateTaxaPreview()" style="margin-bottom:0">
    <input class="form-input" type="number" min="0" step="0.50" placeholder="Ex: 5.00" value="${taxa||''}" oninput="updateTaxaPreview()" style="margin-bottom:0">
    <button onclick="this.closest('div').remove();updateTaxaPreview()" style="width:28px;height:28px;border-radius:7px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.2);color:var(--danger);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">✕</button>
  `;
  list.appendChild(row);
  updateTaxaPreview();
}

function addTaxaBairroRow() { _addBairroRow('', ''); }

function _addBairroBloqueadoRow(bairro) {
  const list = document.getElementById('taxa-bairros-bloqueados-list');
  if (!list) return;
  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center';
  row.innerHTML = `
    <input class="form-input" type="text" placeholder="Ex: Centro" value="${(bairro||'').replace(/"/g,'&quot;')}" style="margin-bottom:0">
    <button onclick="this.closest('div').remove()" style="width:28px;height:28px;border-radius:7px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.2);color:var(--danger);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">✕</button>
  `;
  list.appendChild(row);
}

function addTaxaBairroBloqueado() { _addBairroBloqueadoRow(''); }

function getTaxaBairrosBloqueadosFromDOM() {
  const rows = document.querySelectorAll('#taxa-bairros-bloqueados-list > div');
  return Array.from(rows).map(r => {
    const input = r.querySelector('input');
    return (input?.value || '').trim();
  }).filter(Boolean);
}

function getTaxaBairrosFromDOM() {
  const rows = document.querySelectorAll('#taxa-bairros-list > div');
  return Array.from(rows).map(r => {
    const inputs = r.querySelectorAll('input');
    return { bairro: (inputs[0].value || '').trim(), taxa: parseFloat(inputs[1].value) || 0 };
  }).filter(f => f.bairro);
}

function getTaxaFaixasFromDOM() {
  const rows = document.querySelectorAll('#taxa-faixas-list > div');
  return Array.from(rows).map(r => {
    const inputs = r.querySelectorAll('input');
    return { ate_km: parseFloat(inputs[0].value)||0, taxa: parseFloat(inputs[1].value)||0 };
  }).filter(f => f.ate_km > 0).sort((a,b) => a.ate_km - b.ate_km);
}

function updateTaxaPreview() {
  const tipo = document.querySelector('input[name="taxa-tipo"]:checked')?.value || 'fixo';
  const el = document.getElementById('taxa-preview-content');
  if (tipo === 'fixo') {
    const val = parseFloat(document.getElementById('taxa-fixo-val').value) || 0;
    el.innerHTML = `<div style="display:flex;align-items:center;gap:10px;background:var(--surface2);border-radius:10px;padding:12px 16px">
      <span style="font-size:0">
      <div>
        <div style="font-weight:600;font-size:13px">Taxa de entrega</div>
        <div style="font-size:18px;font-weight:700;color:var(--accent3);font-family:'Playfair Display',sans-serif">R$ ${val.toFixed(2).replace('.',',')}</div>
      </div>
    </div>`;
  } else if (tipo === 'por_km') {
    const faixas = getTaxaFaixasFromDOM();
    if (!faixas.length) { el.innerHTML = '<span style="color:var(--muted)">Adicione pelo menos uma faixa acima.</span>'; return; }
    el.innerHTML = `<div style="font-size:12px;color:var(--muted);margin-bottom:8px">O cliente verá um seletor como este:</div>
      <div style="background:var(--surface2);border-radius:10px;overflow:hidden">
        ${faixas.map((f,i) => `<div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center${i===0?';background:rgba(59,130,246,.08)':''}">
          <span style="font-size:13px">Até ${f.ate_km} km${i===0?' <span style="font-size:10px;background:rgba(59,130,246,.15);color:var(--accent);padding:1px 6px;border-radius:99px;margin-left:6px">selecionado</span>':''}</span>
          <span style="font-family:'Playfair Display',sans-serif;font-weight:700;color:var(--accent3)">R$ ${f.taxa.toFixed(2).replace('.',',')}</span>
        </div>`).join('')}
      </div>`;
  } else if (tipo === 'por_bairro') {
    const bairros = getTaxaBairrosFromDOM();
    if (!bairros.length) { el.innerHTML = '<span style="color:var(--muted)">Adicione pelo menos um bairro acima.</span>'; return; }
    el.innerHTML = `<div style="font-size:12px;color:var(--muted);margin-bottom:8px">O cliente digita o bairro e o sistema identifica a taxa automaticamente:</div>
      <div style="background:var(--surface2);border-radius:10px;overflow:hidden">
        ${bairros.map(b => `<div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:13px">📍 ${b.bairro}</span>
          <span style="font-family:'Playfair Display',sans-serif;font-weight:700;color:var(--accent3)">R$ ${b.taxa.toFixed(2).replace('.',',')}</span>
        </div>`).join('')}
      </div>`;
  }
}

async function saveTaxaConfig() {
  const tipo = document.querySelector('input[name="taxa-tipo"]:checked').value;
  const config = { tipo };
  if (tipo === 'fixo') {
    config.valor  = parseFloat(document.getElementById('taxa-fixo-val').value) || 0;
    config.faixas = [];
    config.bairros = [];
  } else if (tipo === 'por_km') {
    config.faixas  = getTaxaFaixasFromDOM();
    config.bairros = [];
    config.valor   = 0;
  } else if (tipo === 'por_bairro') {
    config.bairros = getTaxaBairrosFromDOM();
    config.faixas  = [];
    config.valor   = 0;
  }
  // Bairros bloqueados — vale para qualquer tipo
  config.bairros_bloqueados = getTaxaBairrosBloqueadosFromDOM();
  try {
    await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, delivery_fee_config: config });
    _taxaConfig = config;
    sbToast('ok', 'Taxa de entrega salva!');
  } catch(e) {
    sbToast('err', 'Erro ao salvar taxa');
  }
}

// calcularTotalMesa() está definida em mesa-state.js (carregado antes deste arquivo).

async function cobrarMesaDireta(num) {
  const numInt = parseInt(num);
  const t = tables.find(x => parseInt(x.num) === numInt);
  if (!t) return;
  sbLoading(true);
  try {
    const { data: activeOrders } = await sb.from('orders')
      .select('total,taxa,items,status,created_at,session_ref')
      .eq('mesa_num', numInt)
      .in('status', ['analise', 'producao', 'pronto', 'mesa_aberta']);

    const sessionActiveOrders = (activeOrders || []).filter(o =>
      typeof mesaOrderBelongsToSession === 'function' ? mesaOrderBelongsToSession(o, t) : true
    );
    const hasComanda = sessionActiveOrders.some(o => o.status === 'mesa_aberta');
    let immediateEntregues = [];
    if (!hasComanda && t?.opened_at) {
      const { data: entregueData } = await sb.from('orders')
        .select('total,taxa,items,status,created_at,session_ref')
        .eq('mesa_num', numInt).eq('status', 'entregue');
      immediateEntregues = (entregueData || []).filter(o =>
        typeof mesaOrderBelongsToSession === 'function' ? mesaOrderBelongsToSession(o, t) : true
      );
    }
    const sessionTotal = calcularTotalMesa([...sessionActiveOrders, ...immediateEntregues]);

    // Apenas marca mesa como waiting — pedidos ficam ativos até confirmar pagamento
    await sb.from('mesas').update({ status: 'waiting', total: sessionTotal, updated_at: new Date().toISOString() }).eq('num', numInt);

    t.status = 'waiting';
    t.total = sessionTotal;
    renderKanban();
    _renderMesaPageFromCache();

    // Abre modal de pagamento direto
    openRegistrarPagamento(numInt, sessionTotal);
  } catch(e) {
    sbToast('err', 'Erro: ' + (e?.message || e));
  } finally {
    sbLoading(false);
  }
}

async function fecharMesa(num) {
  const numInt = parseInt(num);
  const t = tables.find(x => parseInt(x.num) === numInt);
  if (!t) return;
  sbLoading(true);
  try {
    // PASSO 1: Busca apenas pedidos com status ATIVOS da mesa.
    // Pedidos ativos (analise/producao/pronto/mesa_aberta) são SEMPRE da sessão corrente —
    // históricos de sessões anteriores são sempre 'entregue' ou 'cancelado', nunca ativos.
    // Isso garante que NENHUM histórico de sessões anteriores seja cobrado,
    // independente do valor de opened_at.
    // Pedidos ficam como mesa_aberta até aqui — query simples e direta
    const { data: activeOrders } = await sb.from('orders')
      .select('total,taxa,items,status,created_at,session_ref')
      .eq('mesa_num', numInt)
      .in('status', ['analise', 'producao', 'pronto', 'mesa_aberta']);

    const sessionOrders = (activeOrders || []).filter(o =>
      typeof mesaOrderBelongsToSession === 'function' ? mesaOrderBelongsToSession(o, t) : true
    );
    const sessionTotal = calcularTotalMesa(sessionOrders);

    // Apenas marca a mesa como waiting — pedidos ficam mesa_aberta
    // igual ao fluxo do garçom. Pedidos só viram entregue ao confirmar pagamento.
    const { error: mesaErr } = await sb.from('mesas').update({
      status: 'waiting',
      total: sessionTotal,
      updated_at: new Date().toISOString()
    }).eq('num', numInt);
    if (mesaErr) throw mesaErr;

    // Atualiza estado local
    t.status = 'waiting';
    t.total = sessionTotal;
    renderKanban();
    _renderMesaPageFromCache();
    refreshMesa(numInt).then(() => _renderMesaPageFromCache());
    sbToast('ok', `Mesa ${numInt} aguardando pagamento — R$ ${sessionTotal.toFixed(2).replace('.', ',')} `);
  } catch(e) {
    console.error('fecharMesa error:', e);
    sbToast('err', 'Erro ao fechar mesa: ' + (e?.message || e));
  } finally {
    sbLoading(false);
  }
}

// ── Pagamento misto — múltiplas formas ──────────────────────
let _pagFormasList = []; // [{forma, valor, recebido?, troco?}]
let _pagMesaContext = null;

function _mesaMoney(v) {
  const n = Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0;
  return 'R$ ' + n.toFixed(2).replace('.', ',');
}

function _mesaMoneyInputToNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v || '').trim().replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  if (s.includes(',')) return parseFloat(s.replace(',', '.')) || 0;
  return parseFloat(s) || 0;
}

function _mesaRound2(v) {
  return Math.round((parseFloat(v) || 0) * 100) / 100;
}

function _mesaPagamentosSafe(mesa) {
  if (typeof mesaPagamentos === 'function') return mesaPagamentos(mesa);
  if (Array.isArray(mesa?.pagamentos_json)) return mesa.pagamentos_json;
  try { return JSON.parse(mesa?.pagamentos_json || '[]') || []; } catch { return []; }
}

function _mesaPagoTotalSafe(mesa) {
  if (typeof mesaPagoTotal === 'function') return mesaPagoTotal(mesa);
  return _mesaPagamentosSafe(mesa).reduce((s, p) => s + (parseFloat(p?.valor) || 0), 0);
}

function _mesaPagoClienteSafe(mesa, clienteRef) {
  if (typeof mesaPagoPorCliente === 'function') return mesaPagoPorCliente(mesa, clienteRef);
  const key = String(clienteRef || '__mesa');
  return _mesaPagamentosSafe(mesa)
    .filter(p => String(p?.cliente_ref || '__mesa') === key)
    .reduce((s, p) => s + (parseFloat(p?.valor) || 0), 0);
}

function _mesaClienteKeyPagamento(item) {
  const ref = String(item?.cliente_ref || '').trim();
  if (ref) return ref;
  const nome = String(item?.cliente_nome || '').trim();
  return nome ? `nome:${nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}` : '__mesa';
}

function _mesaClienteLabelPagamento(item) {
  return String(item?.cliente_nome || '').trim() || 'Mesa toda';
}

function _mesaOrdersSessaoPagamento(num, mesa) {
  const numInt = parseInt(num);
  const openedAt = mesa?.opened_at || null;
  const sessionStart = openedAt ? new Date(openedAt).getTime() - 5000 : 0;
  return (mesaOrdersCache || []).filter(o => {
    if (parseInt(o.mesa_num) !== numInt || o.status === 'cancelado') return false;
    if (typeof mesaOrderBelongsToSession === 'function') return mesaOrderBelongsToSession(o, mesa);
    if (o.session_ref !== undefined && o.session_ref !== null) return o.session_ref === openedAt;
    if (!sessionStart) return o.status !== 'entregue';
    return new Date(o.created_at || 0).getTime() >= sessionStart;
  });
}

function _mesaResumoClientesPagamento(orders) {
  const grupos = new Map();
  (orders || []).forEach(o => {
    _parseItems(o.items).forEach(i => {
      if ((i.item_status || 'active') === 'cancelado') return;
      const key = _mesaClienteKeyPagamento(i);
      const label = _mesaClienteLabelPagamento(i);
      if (!grupos.has(key)) grupos.set(key, { key, label, total: 0, items: [] });
      const qty = parseInt(i.qty) || 1;
      const price = parseFloat(i.price) || 0;
      const g = grupos.get(key);
      g.total += price * qty;
      g.items.push({ ...i, qty, price });
    });
  });
  return [...grupos.values()].map(g => ({ ...g, total: _mesaRound2(g.total) }));
}

function _mesaMontarContextoPagamento(num, orders, totalFallback) {
  const numInt = parseInt(num);
  const mesa = tables.find(x => parseInt(x.num) === numInt);
  if (!mesa) return null;

  let totalMesa = calcularTotalMesa(orders || []);
  if (!totalMesa && totalFallback) totalMesa = _mesaMoneyInputToNumber(totalFallback);
  if (!totalMesa && mesa.total) totalMesa = _mesaMoneyInputToNumber(mesa.total);
  totalMesa = _mesaRound2(totalMesa);

  const pagamentos = _mesaPagamentosSafe(mesa);
  const pagoMesa = _mesaRound2(_mesaPagoTotalSafe(mesa));
  const restanteMesa = Math.max(0, _mesaRound2(totalMesa - pagoMesa));
  let grupos = _mesaResumoClientesPagamento(orders || []);
  if (!grupos.length && totalMesa > 0) {
    grupos = [{ key: '__mesa', label: 'Mesa toda', total: totalMesa, items: [] }];
  }

  const temClienteNomeado = grupos.some(g => g.label !== 'Mesa toda');
  const opcoesCliente = grupos.map(g => {
    const pago = _mesaRound2(_mesaPagoClienteSafe(mesa, g.key));
    return {
      key: g.key,
      label: g.label,
      total: _mesaRound2(g.total),
      pago,
      restante: Math.max(0, _mesaRound2(g.total - pago)),
      isMesaInteira: false
    };
  });
  const opcoes = temClienteNomeado
    ? [
        ...opcoesCliente,
        { key: '__mesa_total', label: 'Mesa inteira', total: totalMesa, pago: pagoMesa, restante: restanteMesa, isMesaInteira: true }
      ]
    : [
        { key: '__mesa_total', label: 'Mesa inteira', total: totalMesa, pago: pagoMesa, restante: restanteMesa, isMesaInteira: true }
      ];

  const atual = document.getElementById('modal-pag-cliente')?.value || '';
  const selecionada = opcoes.find(o => o.key === atual && o.restante > 0.005)
    || opcoes.find(o => !o.isMesaInteira && o.restante > 0.005)
    || opcoes.find(o => o.restante > 0.005)
    || opcoes[0];

  _pagMesaContext = { num: numInt, mesa, totalMesa, pagamentos, pagoMesa, restanteMesa, grupos, opcoes, selecionadaKey: selecionada?.key || '__mesa_total', temClienteNomeado };
  return _pagMesaContext;
}

function _renderPagClienteBloco() {
  const bloco = document.getElementById('modal-pag-cliente-bloco');
  const sel = document.getElementById('modal-pag-cliente');
  const info = document.getElementById('modal-pag-cliente-info');
  const rec = document.getElementById('modal-pag-recebimentos');
  if (!bloco || !sel || !_pagMesaContext) return;

  const ctx = _pagMesaContext;
  const deveMostrar = ctx.temClienteNomeado || ctx.pagamentos.length > 0;
  bloco.style.display = deveMostrar ? 'block' : 'none';
  if (!deveMostrar) {
    sel.innerHTML = '';
    return;
  }

  sel.innerHTML = ctx.opcoes.map(o => {
    const rest = _mesaMoney(o.restante);
    const nome = o.isMesaInteira ? `${o.label} - restante geral` : o.label;
    return `<option value="${String(o.key).replace(/"/g, '&quot;')}">${nome} (${rest})</option>`;
  }).join('');
  sel.value = ctx.selecionadaKey;

  if (rec) {
    if (ctx.pagamentos.length) {
      rec.style.display = 'block';
      rec.innerHTML = `
        <div style="font-size:10.5px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Recebido até agora</div>
        ${ctx.pagamentos.slice(-5).reverse().map(p => `
          <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:3px 0;border-top:1px solid rgba(255,255,255,.05)">
            <span>${p.cliente_nome || 'Mesa inteira'} · ${p.forma || 'Pagamento'}</span>
            <strong style="color:var(--success)">${_mesaMoney(p.valor)}</strong>
          </div>
        `).join('')}`;
    } else {
      rec.style.display = 'none';
      rec.innerHTML = '';
    }
  }

  _pagClienteChanged();
}

function _pagClienteChanged() {
  if (!_pagMesaContext) return;
  const sel = document.getElementById('modal-pag-cliente');
  const selectedKey = sel?.value || _pagMesaContext.selecionadaKey || '__mesa_total';
  const alvo = _pagMesaContext.opcoes.find(o => o.key === selectedKey) || _pagMesaContext.opcoes[0];
  if (!alvo) return;
  _pagMesaContext.selecionadaKey = alvo.key;

  const totalEl = document.getElementById('modal-pag-total');
  const subEl = document.getElementById('modal-pag-subtotal');
  const valorAddInput = document.getElementById('modal-pag-valor-add');
  const info = document.getElementById('modal-pag-cliente-info');
  const restante = Math.max(0, _mesaRound2(alvo.restante));

  if (totalEl) totalEl.textContent = _mesaMoney(restante);
  if (subEl) subEl.value = restante.toFixed(2);
  if (valorAddInput) valorAddInput.value = restante > 0.005 ? restante.toFixed(2) : '';
  if (info) {
    info.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">
        <div><div style="font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase">Consumo</div><strong style="color:var(--text)">${_mesaMoney(alvo.total)}</strong></div>
        <div><div style="font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase">Pago</div><strong style="color:var(--success)">${_mesaMoney(alvo.pago)}</strong></div>
        <div><div style="font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase">Falta</div><strong style="color:var(--accent3)">${_mesaMoney(restante)}</strong></div>
      </div>
      <div style="margin-top:7px;color:var(--muted)">Restante da mesa inteira: <strong style="color:var(--accent3)">${_mesaMoney(_pagMesaContext.restanteMesa)}</strong></div>`;
  }

  const taxaBloco = document.getElementById('modal-taxa-bloco');
  if (taxaBloco && _pagMesaContext.temClienteNomeado && !alvo.isMesaInteira) {
    taxaBloco.style.display = 'none';
    const taxaCheck = document.getElementById('modal-taxa-check');
    if (taxaCheck) taxaCheck.checked = false;
  }

  _initFormasList(restante, '');
}

function _mesaTotalPagamentoAtual() {
  return _mesaMoneyInputToNumber(document.getElementById('modal-pag-total')?.textContent || '0');
}

function _mesaRestantePagamento(totalVal) {
  const total = totalVal === undefined || totalVal === null || totalVal === ''
    ? _mesaTotalPagamentoAtual()
    : _mesaMoneyInputToNumber(totalVal);
  const pago = _pagFormasList.reduce((s, f) => s + (parseFloat(f.valor) || 0), 0);
  return Math.max(0, Math.round((total - pago) * 100) / 100);
}

function _mesaFormaPagamentoLabel(f, incluirValor) {
  if (!f) return '';
  let label = f.forma || '';
  if (incluirValor) label += ` ${_mesaMoney(f.valor)}`;
  if (f.forma === 'Dinheiro' && (parseFloat(f.recebido) || 0) > 0) {
    const recebido = parseFloat(f.recebido) || 0;
    const troco = Math.max(0, parseFloat(f.troco) || 0);
    label += ` (recebido ${_mesaMoney(recebido)}, troco ${_mesaMoney(troco)})`;
  }
  return label;
}

function _toggleDinheiroRecebidoMesa() {
  const sel = document.getElementById('modal-pag-forma-add');
  const wrap = document.getElementById('modal-pag-dinheiro-wrap');
  const valorInp = document.getElementById('modal-pag-valor-add');
  if (!sel || !wrap) return;

  const isDinheiro = sel.value === 'Dinheiro';
  wrap.style.display = isDinheiro ? 'block' : 'none';
  if (isDinheiro && valorInp && !valorInp.value) {
    const restante = _mesaRestantePagamento();
    if (restante > 0.005) valorInp.value = restante.toFixed(2);
  }
  _atualizarTrocoMesa();
}

function _atualizarTrocoMesa() {
  const sel = document.getElementById('modal-pag-forma-add');
  const trocoEl = document.getElementById('modal-pag-dinheiro-troco');
  const alertaEl = document.getElementById('modal-pag-dinheiro-alerta');
  if (!sel || !trocoEl) return;

  if (sel.value !== 'Dinheiro') {
    trocoEl.textContent = _mesaMoney(0);
    if (alertaEl) alertaEl.style.display = 'none';
    return;
  }

  const valorInput = document.getElementById('modal-pag-valor-add');
  const recebidoInput = document.getElementById('modal-pag-dinheiro-recebido');
  let valor = _mesaMoneyInputToNumber(valorInput?.value);
  if (!valor || valor <= 0) valor = _mesaRestantePagamento();
  const recebido = _mesaMoneyInputToNumber(recebidoInput?.value);
  const troco = Math.max(0, Math.round((recebido - valor) * 100) / 100);

  trocoEl.textContent = _mesaMoney(troco);
  if (alertaEl) {
    if (recebido > 0 && recebido + 0.005 < valor) {
      alertaEl.textContent = 'Valor recebido menor que o valor em dinheiro.';
      alertaEl.style.display = 'block';
    } else {
      alertaEl.style.display = 'none';
    }
  }
}

function _renderFormasList(totalVal) {
  const list = document.getElementById('modal-pag-formas-list');
  if (!list) return;
  totalVal = totalVal === undefined || totalVal === null || totalVal === ''
    ? _mesaTotalPagamentoAtual()
    : _mesaMoneyInputToNumber(totalVal);
  const pago = _pagFormasList.reduce((s, f) => s + f.valor, 0);
  const restante = Math.max(0, totalVal - pago);
  list.innerHTML = _pagFormasList.map((f, i) => {
    const dinheiroMeta = f.forma === 'Dinheiro' && (parseFloat(f.recebido) || 0) > 0
      ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">Recebido ${_mesaMoney(f.recebido)} - Troco ${_mesaMoney(f.troco || 0)}</div>`
      : '';
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--surface2);border-radius:8px;border:1px solid var(--border)">
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:600">${f.forma}</div>
        ${dinheiroMeta}
      </div>
      <span style="font-size:13px;color:var(--accent3);font-weight:700">R$ ${f.valor.toFixed(2).replace('.',',')}</span>
      <button onclick="_removeFormaPag(${i})" style="padding:2px 8px;border-radius:6px;border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.08);color:#f87171;font-size:11px;cursor:pointer">✕</button>
    </div>`;
  }).join('');

  // Hint de troco ou restante
  const hint = document.getElementById('modal-pag-troco-hint');
  if (hint) {
    const trocoDinheiro = _pagFormasList.reduce((s, f) => s + (parseFloat(f.troco) || 0), 0);
    if (trocoDinheiro > 0.005) {
      hint.textContent = `Troco em dinheiro: ${_mesaMoney(trocoDinheiro)}`;
      hint.style.color = 'var(--success)';
    } else if (pago > totalVal + 0.005) {
      const troco = pago - totalVal;
      hint.textContent = `💵 Troco: R$ ${troco.toFixed(2).replace('.',',')}`;
      hint.style.color = 'var(--success)';
    } else if (restante > 0.005 && _pagFormasList.length > 0) {
      hint.textContent = `⚠️ Falta: R$ ${restante.toFixed(2).replace('.',',')}`;
      hint.style.color = 'var(--danger)';
    } else {
      hint.textContent = '';
    }
  }

  // Preenche hidden para compatibilidade
  const formaHidden = document.getElementById('modal-pag-forma');
  if (formaHidden) formaHidden.value = _pagFormasList.map(f => _mesaFormaPagamentoLabel(f, _pagFormasList.length > 1)).join(' + ') || '';
  _atualizarTrocoMesa();
}

function _addFormaPag() {
  const totalVal = _mesaTotalPagamentoAtual();
  const sel = document.getElementById('modal-pag-forma-add');
  const inp = document.getElementById('modal-pag-valor-add');
  const forma = sel?.value || 'PIX';

  const pago = _pagFormasList.reduce((s, f) => s + f.valor, 0);
  const restante = Math.max(0, totalVal - pago);

  let valor = _mesaMoneyInputToNumber(inp?.value);
  if (!valor || valor <= 0) valor = Math.round(restante * 100) / 100; // preenche com restante
  if (valor <= 0) return;

  const novaForma = { forma, valor };
  if (forma === 'Dinheiro') {
    const recebidoInp = document.getElementById('modal-pag-dinheiro-recebido');
    const recebido = _mesaMoneyInputToNumber(recebidoInp?.value);
    if (recebido > 0 && recebido + 0.005 < valor) {
      sbToast('err', 'Valor recebido menor que o valor em dinheiro');
      recebidoInp?.focus();
      _atualizarTrocoMesa();
      return;
    }
    if (recebido > 0) {
      novaForma.recebido = Math.round(recebido * 100) / 100;
      novaForma.troco = Math.max(0, Math.round((recebido - valor) * 100) / 100);
    }
    if (recebidoInp) recebidoInp.value = '';
  }

  _pagFormasList.push(novaForma);
  if (inp) inp.value = '';
  _renderFormasList(totalVal);
  _toggleDinheiroRecebidoMesa();
}

function _removeFormaPag(idx) {
  const totalVal = _mesaTotalPagamentoAtual();
  _pagFormasList.splice(idx, 1);
  _renderFormasList(totalVal);
  _toggleDinheiroRecebidoMesa();
}

function _initFormasList(totalVal, pagForma) {
  _pagFormasList = [];
  // Se veio forma do garçom, pré-preenche com total
  if (pagForma && pagForma !== '') {
    _pagFormasList = [{ forma: pagForma, valor: totalVal }];
  }
  _renderFormasList(totalVal);
  _toggleDinheiroRecebidoMesa();
}

async function openRegistrarPagamento(num, totalJaCalculado) {
  const t = tables.find(x => parseInt(x.num) === parseInt(num));
  if (!t) return;

  const cacheOrdersPagamento = _mesaOrdersSessaoPagamento(num, t);
  let totalOriginal = parseFloat(totalJaCalculado) || 0;
  if (!totalOriginal) totalOriginal = calcularTotalMesa(cacheOrdersPagamento);
  if (!totalOriginal && t.total) totalOriginal = _mesaMoneyInputToNumber(t.total);
  const ctxInicial = _mesaMontarContextoPagamento(num, cacheOrdersPagamento, totalOriginal);
  let totalVal = ctxInicial
    ? (ctxInicial.opcoes.find(o => o.key === ctxInicial.selecionadaKey)?.restante ?? ctxInicial.restanteMesa)
    : Math.max(0, _mesaRound2(totalOriginal - _mesaPagoTotalSafe(t)));

  document.getElementById('modal-pag-mesa-title').textContent = `Registrar Pagamento — Mesa ${num}`;
  document.getElementById('modal-pag-mesa-num').value = num;
  document.getElementById('modal-pag-total').textContent = 'R$ ' + totalVal.toFixed(2).replace('.',',');
  document.getElementById('modal-pag-subtotal').value = totalVal.toFixed(2);
  const valorAddInput = document.getElementById('modal-pag-valor-add');
  const dinheiroRecebidoInput = document.getElementById('modal-pag-dinheiro-recebido');
  if (valorAddInput) valorAddInput.value = '';
  if (dinheiroRecebidoInput) dinheiroRecebidoInput.value = '';
  _renderPagClienteBloco();

  // Taxa — verifica se já está como item na comanda (filtra por sessão)
  const taxaBloco = document.getElementById('modal-taxa-bloco');
  const taxaCheck = document.getElementById('modal-taxa-check');
  const _sessStart = t?.opened_at ? new Date(t.opened_at).getTime() - 5000 : 0;
  const _cacheOrdersTaxa = mesaOrdersCache.filter(o => {
    if (parseInt(o.mesa_num) !== parseInt(num) || o.status === 'cancelado') return false;
    if (typeof mesaOrderBelongsToSession === 'function') return mesaOrderBelongsToSession(o, t);
    if (o.session_ref !== undefined && o.session_ref !== null) return o.session_ref === t?.opened_at;
    if (!_sessStart) return o.status !== 'entregue';
    return new Date(o.created_at || 0).getTime() >= _sessStart;
  });
  const _taxaJaItem = _taxaServicoPct > 0 && _cacheOrdersTaxa.some(o =>
    _parseItems(o.items).some(i => i.item_type === 'taxa' && i.item_status !== 'cancelado')
  );

  // Bloco de aviso de taxa já incluída pelo garçom
  let _taxaAvisoBloco = document.getElementById('modal-taxa-aviso-garcom');
  if (!_taxaAvisoBloco) {
    _taxaAvisoBloco = document.createElement('div');
    _taxaAvisoBloco.id = 'modal-taxa-aviso-garcom';
    if (taxaBloco) taxaBloco.parentNode.insertBefore(_taxaAvisoBloco, taxaBloco);
  }
  _taxaAvisoBloco.style.display = 'none';

  if (taxaBloco && taxaCheck) {
    if (_taxaJaItem) {
      // Taxa já está nos itens adicionada pelo garçom — mostra aviso com botão de remoção
      taxaBloco.style.display = 'none';
      taxaCheck.checked = false;
      // Calcula valor da taxa a partir do cache
      const _taxaItemObj = _cacheOrdersTaxa.flatMap(o => _parseItems(o.items))
        .find(i => i.item_type === 'taxa' && i.item_status !== 'cancelado');
      const _taxaItemVal = _taxaItemObj ? parseFloat(_taxaItemObj.price) * (parseInt(_taxaItemObj.qty)||1) : 0;
      const _taxaItemName = _taxaItemObj?.name || `Taxa de Serviço (${_taxaServicoPct}%)`;
      _taxaAvisoBloco.style.display = 'block';
      _taxaAvisoBloco.innerHTML = `
        <div style="background:rgba(245,158,11,.08);border:1.5px solid rgba(245,158,11,.3);border-radius:12px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div>
            <div style="font-size:12px;font-weight:700;color:var(--accent3);margin-bottom:2px">⚠️ Taxa do garçom incluída</div>
            <div style="font-size:13px;color:var(--text);font-weight:600">${_taxaItemName}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:1px">R$ ${_taxaItemVal.toFixed(2).replace('.',',')}</div>
          </div>
          <button onclick="_removerTaxaGarcom('${_taxaItemName.replace(/'/g,"\\'")}', ${num})"
            style="flex-shrink:0;padding:7px 13px;border-radius:9px;border:1.5px solid rgba(239,68,68,.35);background:rgba(239,68,68,.08);color:#f87171;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">
            ✕ Remover taxa
          </button>
        </div>`;
    } else if (_taxaServicoPct > 0) {
      // Taxa não incluída — gestor pode adicionar
      taxaBloco.style.display = 'block';
      taxaCheck.checked = false;
      taxaCheck.disabled = false;
      document.getElementById('modal-taxa-label').textContent = `Taxa de serviço (${_taxaServicoPct}%)`;
      document.getElementById('modal-taxa-linha').textContent = `Taxa (${_taxaServicoPct}%)`;
      document.getElementById('modal-taxa-breakdown').style.display = 'none';
    } else {
      taxaBloco.style.display = 'none';
    }
  }
  // ── Modo split (divisão de conta) ──────────────────────────────────────────
  const pagForma = t.pag_forma || '';
  const _isSplit = pagForma.startsWith('split:');
  const _splitInfo = _isSplit ? pagForma.split(':') : null;
  const _splitTotal_n  = _splitInfo ? parseInt(_splitInfo[1]) : 0;
  const _splitCada     = _splitInfo ? parseFloat(_splitInfo[2]) : 0;
  const _splitPago_key = `split_pago_mesa_${num}`;
  const _splitJaPago   = _isSplit ? (parseInt(localStorage.getItem(_splitPago_key) || '0')) : 0;
  const _splitRestante = _isSplit ? (_splitTotal_n - _splitJaPago) : 0;

  // Bloco de split — mostra ou oculta
  let splitBloco = document.getElementById('modal-split-bloco');
  if (!splitBloco) {
    splitBloco = document.createElement('div');
    splitBloco.id = 'modal-split-bloco';
    const taxaBlocoEl = document.getElementById('modal-taxa-bloco');
    if (taxaBlocoEl) taxaBlocoEl.parentNode.insertBefore(splitBloco, taxaBlocoEl);
  }
  if (_isSplit && _splitRestante > 0) {
    splitBloco.style.display = 'block';
    splitBloco.innerHTML = `
      <div style="background:rgba(129,140,248,.08);border:1.5px solid rgba(129,140,248,.2);border-radius:10px;padding:12px 14px;margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;color:#818cf8;margin-bottom:6px">🧮 Conta dividida</div>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
          <span style="color:var(--muted)">Total dividido por</span>
          <span style="font-weight:700">${_splitTotal_n} pessoas</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
          <span style="color:var(--muted)">Valor por pessoa</span>
          <span style="font-weight:700;color:var(--accent3)">R$ ${_splitCada.toFixed(2).replace('.',',')}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
          <span style="color:var(--muted)">Já pagaram</span>
          <span style="font-weight:700;color:var(--success)">${_splitJaPago} de ${_splitTotal_n}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px">
          <span style="color:var(--muted)">Faltam pagar</span>
          <span style="font-weight:700;color:var(--amber)">${_splitRestante} pessoa(s)</span>
        </div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(129,140,248,.2);font-size:11px;color:#818cf8">
          ℹ️ Registre o pagamento de <b>1 pessoa por vez</b> (R$ ${_splitCada.toFixed(2).replace('.',',')}). A mesa fecha automaticamente quando todos pagarem.
        </div>
      </div>`;

    // Pré-preencher forma de pagamento com o valor desta pessoa
    document.getElementById('modal-pag-total').textContent = 'R$ ' + _splitCada.toFixed(2).replace('.',',');
    document.getElementById('modal-pag-subtotal').value = _splitCada.toFixed(2);
    _initFormasList(_splitCada, '');
  } else {
    if (splitBloco) splitBloco.style.display = 'none';
    if (!_isSplit && pagForma) {
      const sel = document.getElementById('modal-pag-forma');
      if (sel) for (let i=0;i<sel.options.length;i++) {
        if (sel.options[i].value === pagForma) { sel.selectedIndex=i; break; }
      }
    }
  }

  // Carrega itens — query direta usando opened_at como cutoff preciso da sessão
  const itensEl = document.getElementById('modal-pag-itens');
  const listEl  = document.getElementById('modal-pag-itens-list');
  if (itensEl && listEl) {
    itensEl.style.display = 'block';
    listEl.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:6px">Carregando...</div>';
    try {
      // Pedidos ficam como mesa_aberta até o gestor confirmar pagamento
      const { data: sessionOrders } = await sb.from('orders')
        .select('id,total,taxa,items,status,created_at,session_ref')
        .eq('mesa_num', parseInt(num))
        .in('status', ['mesa_aberta', 'analise', 'producao', 'pronto'])
        .order('id', { ascending: true });
      const sessionOrdersFiltrados = (sessionOrders || []).filter(o =>
        typeof mesaOrderBelongsToSession === 'function' ? mesaOrderBelongsToSession(o, t) : true
      );

      if (!_isSplit) {
        const ordersPagamento = sessionOrdersFiltrados.length ? sessionOrdersFiltrados : cacheOrdersPagamento;
        const ctxAtualizado = _mesaMontarContextoPagamento(num, ordersPagamento || [], totalOriginal);
        if (ctxAtualizado) {
          totalVal = ctxAtualizado.opcoes.find(o => o.key === ctxAtualizado.selecionadaKey)?.restante ?? ctxAtualizado.restanteMesa;
          _renderPagClienteBloco();
        }
      }

      // Taxa agora é um item da comanda — aparece naturalmente na lista
      const itemMap = {};
      sessionOrdersFiltrados.forEach(o => {
        _parseItems(o.items).forEach(i => {
          if (i.item_status === 'cancelado') return;
          const key = i.item_id || i.name;
          if (!itemMap[key]) itemMap[key] = {
            key,
            name: i.name, qty: 0, subtotal: 0,
            isTaxa: i.item_type === 'taxa'
          };
          itemMap[key].qty     += (i.qty || 1);
          itemMap[key].subtotal += (i.price || 0) * (i.qty || 1);
        });
      });
      const itens = Object.values(itemMap);
      if (itens.length) {
        listEl.innerHTML = itens.map((i, idx) => {
          const badge = i.isTaxa
            ? `<span style="font-size:10px;background:rgba(196,149,106,.15);color:var(--amber);padding:1px 6px;border-radius:99px;font-weight:700;margin-right:4px">%</span>`
            : '';
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px">
            <span>${badge}${i.qty}× ${i.name}</span>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="color:var(--accent3);font-weight:600">R$ ${i.subtotal.toFixed(2).replace('.',',')}</span>
              <button onclick="_cancelarItemPagamento('${(i.key||i.name).replace(/'/g,'\'')}', ${num})"
                style="padding:2px 7px;border-radius:6px;border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.08);color:#f87171;font-size:10px;cursor:pointer">✕</button>
            </div>
          </div>`;
        }).join('');
        itensEl.dataset.ordersJson = JSON.stringify(itens);
      } else {
        listEl.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:6px">Nenhum item encontrado</div>';
      }
    } catch(e) {
      listEl.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:6px">Erro ao carregar itens</div>';
    }
  }

  // Inicializa lista de formas de pagamento
  // Se modo split, já foi inicializado com valor por pessoa acima
  const _pagFormaParaInit = (t.pag_forma || '').startsWith('split:') ? '' : (t.pag_forma || '');
  if (!_isSplit) _initFormasList(totalVal, _pagFormaParaInit);

  openModal('modal-pag-mesa');
}

function _toggleTaxaServico() {
  const check    = document.getElementById('modal-taxa-check');
  const subtotal = parseFloat(document.getElementById('modal-pag-subtotal').value) || 0;
  const pct      = _taxaServicoPct || 0;
  const taxa     = subtotal * pct / 100;
  const total    = check.checked ? subtotal + taxa : subtotal;
  document.getElementById('modal-pag-total').textContent = 'R$ ' + total.toFixed(2).replace('.',',');
  // Sincroniza linha de taxa no consumo
  const taxaItemRow = document.getElementById('modal-taxa-item-row');
  if (taxaItemRow) taxaItemRow.style.display = check.checked ? 'flex' : 'none';
  const breakdown = document.getElementById('modal-taxa-breakdown');
  if (check.checked) {
    breakdown.style.display = 'block';
    document.getElementById('modal-taxa-sub').textContent = 'R$ ' + subtotal.toFixed(2).replace('.',',');
    document.getElementById('modal-taxa-val').textContent = 'R$ ' + taxa.toFixed(2).replace('.',',');
  } else {
    breakdown.style.display = 'none';
  }
  _renderFormasList(total);
  _toggleDinheiroRecebidoMesa();
}

function imprimirViaCliente() {
  const num      = parseInt(document.getElementById('modal-pag-mesa-num').value);
  const totalStr = document.getElementById('modal-pag-total').textContent || 'R$ 0,00';
  const forma    = document.getElementById('modal-pag-forma')?.value || '';
  const itensEl  = document.getElementById('modal-pag-itens');
  const itens    = itensEl?.dataset.ordersJson ? JSON.parse(itensEl.dataset.ordersJson) : [];
  const nome     = _sessao?.nome || 'Estabelecimento';
  const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const _formaAddSel = document.getElementById('modal-pag-forma-add')?.value || '';
  const formaLabel = ((_pagFormasList||[]).length > 0)
    ? _pagFormasList.map(f => _mesaFormaPagamentoLabel(f, _pagFormasList.length > 1)).join(' + ')
    : ({ PIX: 'PIX', Cartão: 'Cartão', Dinheiro: 'Dinheiro', Crédito: 'Crédito', Débito: 'Débito' }[forma || _formaAddSel] || forma || _formaAddSel || '—');

  // Separa itens normais da taxa de serviço
  const itensSemTaxa = itens.filter(i => !i.isTaxa);
  const taxaItemJson = itens.find(i => i.isTaxa);
  const subtotal     = itensSemTaxa.reduce((s, i) => s + (i.subtotal || 0), 0);

  // Taxa pode vir: (1) como item do garçom no JSON, (2) via checkbox do gestor
  const taxaCheckGestor = document.getElementById('modal-taxa-check');
  const taxaGestorAtiva = taxaCheckGestor?.checked && (_taxaServicoPct > 0);
  const taxaVal = taxaItemJson
    ? (taxaItemJson.subtotal || 0)
    : (taxaGestorAtiva ? Math.round(subtotal * (_taxaServicoPct / 100) * 100) / 100 : 0);
  const taxaPct = _taxaServicoPct || 10;

  const totalVal = parseFloat(totalStr.replace('R$','').replace(/\s/g,'').replace(',','.')) || (subtotal + taxaVal);

  // Busca garçom do cache da mesa
  const mesaTd    = tables ? tables.find(x => parseInt(x.num) === num) : null;
  const clienteAtual = _pagMesaContext?.opcoes?.find(o => o.key === _pagMesaContext.selecionadaKey);
  const garcomNome = (() => {
    const ordens = (mesaOrdersCache || []).filter(o => parseInt(o.mesa_num) === num);
    for (const o of ordens) {
      if (o.garcom_nome) return o.garcom_nome;
    }
    return '';
  })();

  const itensHtml = itensSemTaxa.length
    ? itensSemTaxa.map(i => {
        const unitario = i.qty > 0 ? (i.subtotal / i.qty) : i.subtotal;
        return `<div style="padding:5px 0;border-bottom:1px dashed #ddd;font-size:12px">
          <div style="display:flex;justify-content:space-between;font-weight:700">
            <span>${i.qty}× ${i.name}</span>
            <span>R$ ${i.subtotal.toFixed(2).replace('.',',')}</span>
          </div>
          ${i.qty > 1 ? `<div style="font-size:10px;color:#888;margin-top:1px">Unitário: R$ ${unitario.toFixed(2).replace('.',',')}</div>` : ''}
        </div>`;
      }).join('')
    : '<div style="font-size:11px;color:#999;text-align:center;padding:8px">Sem itens</div>';

  const taxaHtml = taxaVal > 0
    ? `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px dashed #ddd">
        <span>Subtotal</span><span>R$ ${subtotal.toFixed(2).replace('.',',')}</span>
       </div>
       <div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px dashed #ddd">
        <span>Taxa de serviço (${taxaPct}%)</span><span>R$ ${taxaVal.toFixed(2).replace('.',',')}</span>
       </div>`
    : '';

  const html = `
    <div style="font-family:monospace;background:#fff;color:#111;padding:16px 12px;max-width:280px;margin:0 auto">
      <div style="text-align:center;margin-bottom:10px">
        <div style="font-size:16px;font-weight:900">${nome.toUpperCase()}</div>
        <div style="font-size:10px;color:#666">${dataHora}</div>
        <div style="font-size:13px;font-weight:700;margin-top:3px">Mesa ${num}</div>
        ${clienteAtual && !clienteAtual.isMesaInteira ? `<div style="font-size:11px;color:#555;margin-top:2px">Cliente: ${clienteAtual.label}</div>` : ''}
        ${garcomNome ? `<div style="font-size:11px;color:#555;margin-top:2px">Garçom: ${garcomNome}</div>` : ''}
        <hr style="border:none;border-top:1px dashed #aaa;margin:7px 0">
      </div>
      <div style="margin-bottom:8px">${itensHtml}</div>
      <hr style="border:none;border-top:1px dashed #aaa;margin:7px 0">
      ${taxaHtml}
      <div style="display:flex;justify-content:space-between;font-weight:900;font-size:14px;padding:6px 0;margin-top:2px">
        <span>TOTAL</span><span>R$ ${totalVal.toFixed(2).replace('.',',')}</span>
      </div>
      <hr style="border:none;border-top:1px dashed #aaa;margin:7px 0">
      <div style="text-align:center;font-size:11px;color:#555;margin-top:4px">Pagamento: ${formaLabel}</div>
      <div style="text-align:center;font-size:11px;color:#aaa;margin-top:8px">Obrigado pela preferência!</div>
    </div>`;

  // Tenta Electron primeiro, senão abre janela de impressão do browser
  const _caixaPrinter = localStorage.getItem('printPrinter') || '';
  if (window.ElectronPrint) {
    if (window.ElectronPrint.printHtml) {
      window.ElectronPrint.printHtml(html, { printer: _caixaPrinter, paperWidth: 80, landscape: false, scaleFactor: 100 }).catch(() => _printViaWindow(html));
    } else {
      const fakeOrder = { id: num, client: `Mesa ${num}`, items: itens, total: parseFloat(totalStr.replace('R$ ','').replace(',','.')), pag: forma, mesa_num: num, _html: html };
      window.ElectronPrint.printOrder(fakeOrder).catch(() => _printViaWindow(html));
    }
  } else {
    _printViaWindow(html);
  }
}

function _printViaWindow(html) {
  const w = window.open('', '_blank', 'width=400,height=600');
  if (!w) { sbToast('err', 'Permita popups para imprimir'); return; }
  w.document.write(`<!DOCTYPE html><html><head><title>Via do cliente</title>
    <style>body{margin:0;background:#fff}@media print{body{margin:0}}</style></head>
    <body>${html}<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script></body></html>`);
  w.document.close();
}

// ── Cancelar item direto no modal de pagamento ───────────────────────────────
async function _cancelarItemPagamento(itemName, mesaNum) {
  if (!confirm(`Remover "${itemName}" da comanda?`)) return;

  try {
    const { data: orders } = await sb.from('orders')
      .select('id, items, total')
      .eq('mesa_num', parseInt(mesaNum))
      .in('status', ['mesa_aberta','analise','producao','pronto']);

    for (const o of orders || []) {
      const items = _parseItems(o.items);
      const idx = items.findIndex(i => i.name === itemName && i.item_status !== 'cancelado');
      if (idx === -1) continue;

      items[idx] = { ...items[idx], item_status: 'cancelado' };
      const novoTotal = items
        .filter(i => i.item_status !== 'cancelado')
        .reduce((s, i) => s + (parseFloat(i.price)||0) * (parseInt(i.qty)||1), 0);

      await sb.from('orders').update({ items, total: novoTotal }).eq('id', o.id);
      break;
    }

    // Recalcula total e reabre o modal com dados atualizados
    await refreshMesa(mesaNum);
    openRegistrarPagamento(mesaNum, null);
    sbToast('ok', `"${itemName}" removido da comanda`);
  } catch(e) {
    sbToast('err', 'Erro ao remover item: ' + (e?.message || e));
  }
}

// ── Remover taxa do garçom no modal de pagamento ────────────────────────────
async function _removerTaxaGarcom(taxaName, mesaNum) {
  if (!confirm(`Remover a "${taxaName}" da comanda?`)) return;
  sbLoading(true);
  try {
    const { data: orders } = await sb.from('orders')
      .select('id, items, total')
      .eq('mesa_num', parseInt(mesaNum))
      .in('status', ['mesa_aberta','analise','producao','pronto']);

    for (const o of orders || []) {
      const items = _parseItems(o.items);
      const idx = items.findIndex(i => i.item_type === 'taxa' && i.item_status !== 'cancelado');
      if (idx === -1) continue;

      items[idx] = { ...items[idx], item_status: 'cancelado' };
      const novoTotal = items
        .filter(i => i.item_status !== 'cancelado')
        .reduce((s, i) => s + (parseFloat(i.price)||0) * (parseInt(i.qty)||1), 0);

      await sb.from('orders').update({ items, total: novoTotal }).eq('id', o.id);

      // Zera taxa_servico na mesa também
      await sb.from('mesas').update({ taxa_servico: 0 }).eq('num', parseInt(mesaNum));
      break;
    }

    await refreshMesa(mesaNum);
    openRegistrarPagamento(mesaNum, null);
    sbToast('ok', 'Taxa de serviço removida!');
  } catch(e) {
    sbToast('err', 'Erro ao remover taxa: ' + (e?.message || e));
  } finally {
    sbLoading(false);
  }
}

async function confirmarPagamentoMesa() {
  const num   = parseInt(document.getElementById('modal-pag-mesa-num').value);
  // Usa a lista de formas mistas ou fallback para o select
  const forma = _pagFormasList.length
    ? _pagFormasList.map(f => _mesaFormaPagamentoLabel(f, _pagFormasList.length > 1)).join(' + ')
    : (document.getElementById('modal-pag-forma').value || 'PIX');
  // parseInt nos dois lados para evitar falha de comparação string vs number
  const t = tables.find(x => parseInt(x.num) === num);
  if (!t) { sbToast('err', 'Mesa não encontrada'); return; }

  const totalStr = document.getElementById('modal-pag-total').textContent || 'R$ 0,00';
  const totalVal = parseFloat(totalStr.replace('R$ ','').replace(',','.')) || 0;
  const _taxaCheck = document.getElementById('modal-taxa-check');
  const _subtotalVal = parseFloat(document.getElementById('modal-pag-subtotal')?.value) || 0;
  const _taxaVal = (_taxaCheck?.checked && _subtotalVal > 0) ? (totalVal - _subtotalVal) : 0;
  const time     = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});

  // ── Modo split: pagamento parcial ────────────────────────────────────────
  const _pagFormaAtual = t.pag_forma || '';
  const _isSplitPag = _pagFormaAtual.startsWith('split:');
  if (_isSplitPag) {
    const _splitParts  = _pagFormaAtual.split(':');
    const _splitN_pag  = parseInt(_splitParts[1]);
    const _splitCada_p = parseFloat(_splitParts[2]);
    const _splitKey    = `split_pago_mesa_${num}`;
    const _jaPagei     = parseInt(localStorage.getItem(_splitKey) || '0');
    const _novoCount   = _jaPagei + 1;

    // Registra movimento parcial
    try {
      if (!_sessao?.tenant_id) throw new Error('Sessão sem tenant');
      await sb.from('movimentos').insert({
        tenant_id: _sessao.tenant_id,
        description: `Mesa ${num} — Pagamento ${_novoCount}/${_splitN_pag}`,
        tipo: 'entrada', val: _splitCada_p, pag: forma, time
      });
    } catch(e) { console.warn('[SPLIT] movimentos insert:', e?.message); }

    sbLoading(true);
    if (_novoCount >= _splitN_pag) {
      // Último pagamento — fecha a mesa
      localStorage.removeItem(_splitKey);
      await sb.from('orders').update({ status: 'entregue' })
        .eq('mesa_num', num).in('status', ['analise','producao','pronto','mesa_aberta']);
      await sb.from('mesas').update({
        status: 'free', total: null, pag_forma: null, taxa_servico: null,
        guests: null, opened_at: null, updated_at: new Date().toISOString()
      }).eq('num', num);
      t.status = 'free'; t.total = null; t.guests = null; t.opened_at = null; t.pag_forma = null;
      mesaOrdersCache = mesaOrdersCache.filter(o => parseInt(o.mesa_num) !== num);
      ordersKanban = ordersKanban.filter(o => parseInt(o.mesa_num) !== num);
      closeModal('modal-pag-mesa');
      renderKanban(); _renderMesaPageFromCache(); renderQR();
      sbToast('ok', `✅ Mesa ${num} — Todos pagaram! Mesa liberada.`);
    } else {
      // Pagamento parcial — mantém mesa aberta
      localStorage.setItem(_splitKey, String(_novoCount));
      closeModal('modal-pag-mesa');
      renderKanban(); _renderMesaPageFromCache();
      sbToast('ok', `✅ Mesa ${num} — ${_novoCount}/${_splitN_pag} pagou! Faltam ${_splitN_pag - _novoCount}.`);
      // Reabre modal para próxima pessoa
      setTimeout(() => openRegistrarPagamento(num, null), 500);
    }
    sbLoading(false);
    return; // sai — não executa fluxo normal
  }

  const ctxPagamento = (_pagMesaContext && _pagMesaContext.num === num)
    ? _pagMesaContext
    : _mesaMontarContextoPagamento(num, _mesaOrdersSessaoPagamento(num, t), totalVal);
  const alvoPagamento = ctxPagamento?.opcoes?.find(o => o.key === ctxPagamento.selecionadaKey)
    || ctxPagamento?.opcoes?.[0]
    || { key: '__mesa_total', label: 'Mesa inteira', total: totalVal, pago: 0, restante: totalVal, isMesaInteira: true };
  const valorRecebido = _pagFormasList.length
    ? _mesaRound2(_pagFormasList.reduce((s, f) => s + (parseFloat(f.valor) || 0), 0))
    : _mesaRound2(totalVal);
  if (valorRecebido <= 0.005) {
    sbToast('err', 'Informe o valor recebido');
    return;
  }
  if (!alvoPagamento.isMesaInteira && valorRecebido > (alvoPagamento.restante + 0.005)) {
    sbToast('err', `${alvoPagamento.label} tem apenas ${_mesaMoney(alvoPagamento.restante)} em aberto`);
    return;
  }

  const totalMesaOriginal = _mesaRound2(ctxPagamento?.totalMesa || totalVal);
  const pagamentosAtuais = _mesaPagamentosSafe(t);
  const clienteRef = alvoPagamento.isMesaInteira ? '__mesa_total' : (alvoPagamento.key || '__mesa');
  const clienteNome = alvoPagamento.isMesaInteira ? 'Mesa inteira' : (alvoPagamento.label || 'Mesa toda');
  const pagamentoMesa = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    mesa_num: num,
    cliente_ref: clienteRef,
    cliente_nome: clienteNome,
    valor: valorRecebido,
    forma,
    formas: (_pagFormasList || []).map(f => ({ ...f })),
    saldo_mesa_antes: _mesaRound2(ctxPagamento?.restanteMesa ?? (totalMesaOriginal - _mesaPagoTotalSafe(t))),
    saldo_mesa_depois: 0
  };
  const pagamentosNovos = [...pagamentosAtuais, pagamentoMesa];
  const pagoMesaDepois = _mesaRound2(pagamentosNovos.reduce((s, p) => s + (parseFloat(p?.valor) || 0), 0));
  const restanteMesaDepois = Math.max(0, _mesaRound2(totalMesaOriginal - pagoMesaDepois));
  pagamentoMesa.saldo_mesa_depois = restanteMesaDepois;
  const deveLiberarMesa = restanteMesaDepois <= 0.005;
  const descMovimento = clienteNome && clienteNome !== 'Mesa inteira'
    ? `Mesa ${num} — Pagamento ${clienteNome}`
    : `Mesa ${num} — Pagamento`;

  if (!deveLiberarMesa) {
    sbLoading(true);
    let movErr = null;
    try {
      const { error: mesaPagErr } = await sb.from('mesas').update({
        status: 'waiting',
        total: totalMesaOriginal,
        pagamentos_json: pagamentosNovos,
        updated_at: new Date().toISOString()
      }).eq('num', num);
      if (mesaPagErr) throw mesaPagErr;

      const { error: movParcialErr } = await sb.from('movimentos').insert({
        tenant_id: _sessao?.tenant_id,
        description: descMovimento,
        tipo: 'entrada',
        val: valorRecebido,
        pag: forma,
        time
      });
      movErr = movParcialErr || null;

      t.status = 'waiting';
      t.total = totalMesaOriginal;
      t.pagamentos_json = pagamentosNovos;
      closeModal('modal-pag-mesa');
      await refreshMesa(num);
      _renderMesaPageFromCache();
      renderKanban();
      renderQR();
      const caixaMsg = movErr ? ' (caixa não registrado)' : '';
      sbToast('ok', `${clienteNome}: recebido ${_mesaMoney(valorRecebido)}. Falta ${_mesaMoney(restanteMesaDepois)}${caixaMsg}`);
      setTimeout(() => openRegistrarPagamento(num, null), 450);
    } catch(e) {
      console.error('pagamento parcial mesa error:', e);
      sbToast('err', 'Erro ao registrar recebimento: ' + (e?.message || e));
    } finally {
      sbLoading(false);
    }
    return;
  }

  // ── IMPORTANTE: captura opened_at ANTES de qualquer await ──────────────
  // O SSE da atualização da mesa (step 2) pode disparar refreshMesa()
  // durante os awaits seguintes, nullificando t.opened_at via race condition.
  const _savedOpenedAt = t.opened_at || null;

  // ── Captura itens do modal de pagamento como fallback ──────────────────
  // openRegistrarPagamento já carregou os itens do banco e guardou aqui.
  // Se a query do comprovante falhar ou vier vazia, usamos esses itens.
  let _fallbackItens = [];
  try {
    const _modalItensJson = document.getElementById('modal-pag-itens')?.dataset?.ordersJson;
    if (_modalItensJson) _fallbackItens = JSON.parse(_modalItensJson);
  } catch(e) { console.warn('[confirmarPag] fallback itens parse:', e.message); }

  sbLoading(true);
  try {
    // 1. Finaliza todos os pedidos ativos da mesa
    const { error: ordErr } = await sb.from('orders')
      .update({ status: 'entregue' })
      .eq('mesa_num', num)
      .in('status', ['analise', 'producao', 'pronto', 'mesa_aberta']);
    if (ordErr) { console.error('orders update error:', ordErr); throw ordErr; }

    // 2. Liberar mesa
    const { error: mesaErr } = await sb.from('mesas').update({
      status: 'free', total: null, pag_forma: null, taxa_servico: null,
      guests: null, opened_at: null, clientes_json: [], pagamentos_json: [],
      updated_at: new Date().toISOString()
    }).eq('num', num);
    if (mesaErr) { console.error('mesas update error:', mesaErr); throw mesaErr; }

    // 3. Registrar entrada no caixa (não-fatal — mesa libera mesmo se falhar)
    const { error: movErr } = await sb.from('movimentos').insert({
      tenant_id: _sessao?.tenant_id,
      description: descMovimento,
      tipo: 'entrada', val: valorRecebido, pag: forma, time
    });
    if (movErr) console.warn('movimentos insert warning (não-fatal):', movErr);

    // Usa cache local para o comprovante — já tem os dados corretos antes do update
    // O cache é limpo logo abaixo, então capturamos aqui
    // Filtra apenas pedidos da sessão atual (mesmo filtro de _renderMesaPageFromCache)
    const _cacheComp = mesaOrdersCache
      .filter(o => {
        if (parseInt(o.mesa_num) !== num || o.status === 'cancelado') return false;
        if (typeof mesaOrderBelongsToSession === 'function') return mesaOrderBelongsToSession(o, { opened_at: _savedOpenedAt });
        if (o.session_ref !== undefined && o.session_ref !== null) {
          return o.session_ref === _savedOpenedAt;
        }
        if (!_savedOpenedAt) return o.status !== 'entregue';
        return new Date(o.created_at || 0).getTime() >= new Date(_savedOpenedAt).getTime() - 5000;
      })
      .map(o => ({ ...o, items: _parseItems(o.items) }));

    let _ordensComprovante = _cacheComp.length ? _cacheComp : (_fallbackItens.length
      ? [{ items: _fallbackItens.map(i => ({ name: i.name, qty: i.qty, price: i.subtotal / (i.qty || 1) })), status: 'entregue' }]
      : []);

    // Atualizar estado local e cache — zera tudo desta mesa
    t.status = 'free'; t.total = null; t.guests = null; t.opened_at = null; t.pag_forma = null; t.taxa_servico = 0; t.clientes_json = []; t.pagamentos_json = [];
    ordersKanban = ordersKanban.filter(o => parseInt(o.mesa_num) !== num);
    mesaOrdersCache = mesaOrdersCache.filter(o => parseInt(o.mesa_num) !== num);
    tables.sort((a,b) => parseInt(a.num) - parseInt(b.num));
    closeModal('modal-pag-mesa');
    _renderMesaPageFromCache();
    renderKanban();
    renderQR();
    closeModal('modal-pag-mesa');

    // Monta e exibe comprovante
    const caixaMsg = movErr ? ' (caixa não registrado)' : '';
    abrirComprovantesMesa(num, totalMesaOriginal, forma, time, _ordensComprovante, _taxaVal);
    sbToast('ok', `Mesa ${num} liberada — R$ ${totalMesaOriginal.toFixed(2).replace('.',',')}${caixaMsg}`);
  } catch(e) {
    console.error('confirmarPagamentoMesa error:', e);
    const msg = e?.message || e?.details || e?.hint || JSON.stringify(e);
    sbToast('err', 'Erro: ' + msg);
  } finally {
    sbLoading(false);
  }
}

function abrirComprovantesMesa(num, totalVal, forma, time, ordensPreSalvas, taxaServicoVal) {
  const modal = document.getElementById('modal-comprovante-mesa');
  if (!modal) return;

  // Usa os pedidos pré-salvos (passados antes de limpar o cache) ou fallback no cache
  // Fallback: filtra pela sessão via opened_at se disponível
  let sessionOrders;
  if (ordensPreSalvas && ordensPreSalvas.length > 0) {
    sessionOrders = ordensPreSalvas;
  } else {
    const _mesa = tables.find(t => t.num === parseInt(num));
    const _oa = _mesa?.opened_at;
    sessionOrders = mesaOrdersCache.filter(o => {
      if (parseInt(o.mesa_num) !== parseInt(num) || o.status === 'cancelado') return false;
      if (typeof mesaOrderBelongsToSession === 'function') return mesaOrderBelongsToSession(o, _mesa);
      if (o.session_ref !== undefined && o.session_ref !== null) return o.session_ref === _oa;
      if (!_oa) return o.status !== 'entregue';
      return new Date(o.created_at || 0).getTime() >= new Date(_oa).getTime() - 5000;
    });
  }

  // Consolida itens
  const itemMap = {};
  sessionOrders.forEach(o => {
    // Garante que items é um array — pode vir como string JSON do servidor
    let rawItems = o.items;
    if (typeof rawItems === 'string') { try { rawItems = JSON.parse(rawItems); } catch { rawItems = []; } }
    if (!Array.isArray(rawItems)) rawItems = [];
    rawItems.forEach(i => {
      if (i.item_status === 'cancelado') return; // ignora cancelados
      const key = i.name;
      if (!itemMap[key]) itemMap[key] = { name:i.name, qty:0, total:0, drink:!!i.drink };
      itemMap[key].qty += (i.qty||1);
      itemMap[key].total += (i.price||0) * (i.qty||1);
    });
  });
  const itens = Object.values(itemMap);

  const nome  = _sessao?.nome || 'Estima Food';
  const dataHora = new Date().toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'});
  const formaLabel = {dinheiro:'💵 Dinheiro', pix:'💠 PIX', credito:'💳 Crédito', debito:'💳 Débito', voucher:'🎫 Voucher'}[forma] || forma;

  const itensHtml = itens.map(i =>
    `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px dashed #ddd">
      <span>${i.qty}× ${i.name}</span>
      <span>R$ ${i.total.toFixed(2).replace('.',',')}</span>
    </div>`
  ).join('') || '<div style="font-size:13px;color:#999;text-align:center;padding:8px">Sem itens registrados</div>';

  document.getElementById('comp-mesa-content').innerHTML = `
    <div style="font-family:monospace;background:#fff;color:#111;padding:20px;border-radius:10px;max-width:300px;margin:0 auto">
      <div style="text-align:center;margin-bottom:12px">
        <div style="font-size:18px;font-weight:900">${nome}</div>
        <div style="font-size:11px;color:#666">${dataHora}</div>
        <div style="font-size:13px;font-weight:700;margin-top:4px">Mesa ${num}</div>
        <hr style="border:none;border-top:1px dashed #ccc;margin:8px 0">
      </div>
      <div style="margin-bottom:10px">${itensHtml}</div>
      <hr style="border:none;border-top:1px dashed #ccc;margin:8px 0">
      ${taxaServicoVal > 0 ? `
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px">
        <span>Subtotal</span><span>R$ ${(totalVal - taxaServicoVal).toFixed(2).replace('.',',')}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
        <span>Taxa de serviço (${_taxaServicoPct}%)</span><span>R$ ${taxaServicoVal.toFixed(2).replace('.',',')}</span>
      </div>` : ''}
      <div style="display:flex;justify-content:space-between;font-weight:700;font-size:15px;margin-bottom:4px">
        <span>TOTAL</span><span>R$ ${totalVal.toFixed(2).replace('.',',')}</span>
      </div>
      <div style="font-size:12px;color:#555;margin-bottom:10px">${formaLabel}</div>
      <hr style="border:none;border-top:1px dashed #ccc;margin:8px 0">
      <div style="text-align:center;font-size:11px;color:#999">Obrigado pela preferência!</div>
    </div>`;

  openModal('modal-comprovante-mesa');
}

function imprimirComprovanteMesa() {
  const conteudo = document.getElementById('comp-mesa-content')?.innerHTML;
  if (!conteudo) return;
  const fmt  = localStorage.getItem('printFormat') || _printFormat || '80mm';
  const printer = (() => { try { const c = JSON.parse(localStorage.getItem('printConfig')||'{}'); return c.printer_caixa || c.printer || ''; } catch { return ''; } })() || localStorage.getItem('printPrinter') || '';

  (async () => {
    // 1. Electron (silencioso via app desktop)
    if (window.ElectronPrint) {
      try {
        const pw = fmt === '58mm' ? 58 : 80;
        if (window.ElectronPrint.printHtml) {
          const r = await window.ElectronPrint.printHtml(conteudo, { printer, paperWidth: pw, landscape: false, scaleFactor: 100 });
          if (r && r.ok) { sbToast('ok', '🖨️ Comprovante impresso!'); return; }
        }
      } catch(e) { console.warn('[PRINT COMPROVANTE] Electron falhou:', e.message); }
    }

    // 2. Print Agent (agente silencioso via servidor)
    try {
      const tid = (() => { try { return JSON.parse(localStorage.getItem('sys_session') || '{}').tenant_id || ''; } catch { return ''; } })();
      if (tid) {
        const statusRes = await fetch('/api/print-queue/status', { headers: { 'x-tenant-id': tid } });
        const statusData = await statusRes.json();
        if (statusData.active) {
          await fetch('/api/print-queue/job', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
            body: JSON.stringify({ html: conteudo, format: fmt, printer: printer || undefined, tipo: 'caixa' }),
          });
          sbToast('ok', '🖨️ Comprovante enviado ao agente!');
          return;
        }
      }
    } catch {}

    // 3. Fallback: popup com window.print()
    const w = window.open('', '_blank', 'width=400,height=600');
    if (!w) { sbToast('err', 'Permita popups para imprimir'); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Comprovante</title>
      <style>body{margin:0;padding:16px;font-family:monospace;background:#fff;color:#000} @media print{@page{margin:2mm;size:${fmt} auto} body{margin:0}}</style>
      </head><body>${conteudo}<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script></body></html>`);
    w.document.close();
  })();
}

// ─────────────────────────────────────────
// GARÇONS
// ─────────────────────────────────────────
let garcons = [];

async function loadGarcons() {
  const el = document.getElementById('garcons-list');
  if (!el) return;
  try {
    const { data } = await sb.from('garcons').select('*').order('id');
    garcons = data || [];
    renderGarconsList();
  } catch(e) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:12px">Erro ao carregar garçons.</div>';
  }
}

function renderGarconsList() {
  const el = document.getElementById('garcons-list');
  if (!el) return;
  if (!garcons.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:12px;text-align:center">Nenhum garçom cadastrado. Clique em <strong>Novo garçom</strong> para adicionar.</div>';
    return;
  }
  el.innerHTML = garcons.map(g => `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--accent),#1d4ed8);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0">
        ${g.nome.charAt(0).toUpperCase()}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13.5px">${g.nome}</div>
        <div style="font-size:11.5px;color:var(--muted)">@${g.usuario}</div>
      </div>
      <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;${g.ativo?'background:rgba(34,197,94,.12);color:var(--success)':'background:rgba(100,116,139,.1);color:var(--muted)'}">
        ${g.ativo ? '● Ativo' : '● Inativo'}
      </span>
      <button class="btn bg" style="font-size:11px;padding:3px 8px" onclick="toggleGarcom(${g.id},${g.ativo})">${g.ativo?'Pausar':'Ativar'}</button>
      <button class="btn bd" style="font-size:11px;padding:3px 8px" onclick="deleteGarcom(${g.id})">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M3 4h10M6 4V2.5A.5.5 0 0 1 6.5 2h3a.5.5 0 0 1 .5.5V4M5 4l.7 9.5a.5.5 0 0 0 .5.5h3.6a.5.5 0 0 0 .5-.5L11 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      </button>
    </div>`).join('');
}

async function addGarcom() {
  const nome    = document.getElementById('add-garcom-nome').value.trim();
  const usuario = document.getElementById('add-garcom-usuario').value.trim().toLowerCase();
  const senha   = document.getElementById('add-garcom-senha').value.trim();
  if (!nome)    { sbToast('err','Informe o nome'); return; }
  if (!usuario) { sbToast('err','Informe o usuário'); return; }
  if (!senha)   { sbToast('err','Informe a senha'); return; }
  sbLoading(true);
  // Hash SHA256 da senha antes de salvar (backend aceita hash hex 64 chars)
  let senhaHash = senha;
  try {
    const enc = new TextEncoder().encode(senha);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    senhaHash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    // fallback se subtle indisponível (HTTP): mantém plain text; backend fará migração no 1º login
    console.warn('[addGarcom] crypto.subtle indisponível, usando fallback:', e?.message);
  }
  const { data, error } = await sb.from('garcons').insert({ nome, usuario, senha: senhaHash, ativo:true }).select().single();
  sbLoading(false);
  if (error) { sbToast('err', error.code==='23505'?'Usuário já existe':'Erro ao cadastrar'); return; }
  garcons.push(data);
  renderGarconsList();
  closeModal('modal-add-garcom');
  document.getElementById('add-garcom-nome').value = '';
  document.getElementById('add-garcom-usuario').value = '';
  document.getElementById('add-garcom-senha').value = '';
  sbToast('ok', `Garçom ${nome} cadastrado!`);
}

async function toggleGarcom(id, ativo) {
  const { error } = await sb.from('garcons').update({ ativo: !ativo }).eq('id', id);
  if (!error) {
    const g = garcons.find(x=>x.id===id);
    if (g) g.ativo = !ativo;
    renderGarconsList();
    sbToast('ok', !ativo ? 'Garçom ativado!' : 'Garçom pausado');
  }
}

async function deleteGarcom(id) {
  const g = garcons.find(x=>x.id===id);
  if (!confirm(`Excluir garçom ${g?.nome}?`)) return;
  const { error } = await sb.from('garcons').delete().eq('id', id);
  if (!error) {
    garcons = garcons.filter(x=>x.id!==id);
    renderGarconsList();
    sbToast('ok', 'Garçom removido');
  }
}

// ─────────────────────────────────────────
// INIT
// ─────────────────────────────────────────
function initSidebarState() {
  loadSidebarState();
  evoCarregarAutomacoesSalvas();
  carregarWaServerUrl();
  // Carrega instância salva e verifica conexão já no boot da página
  // (não espera o usuário clicar na aba Robô)
  evoCarregarInstancia().then(() => {
    if (EVO.instance) evoCheckStatus();
  });
}

// Polling de reconexão — mantém o badge do topnav atualizado a cada 30s
setInterval(() => {
  if (EVO.instance) evoCheckStatus();
}, 30000);

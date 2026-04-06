// ═══════════════════════════════════════════════════════
// SONS DE NOTIFICAÇÃO
// ═══════════════════════════════════════════════════════

const SOUND_OPTIONS = [
  { id: 'sino',      label: 'Sino',         desc: 'Três bipes suaves'         },
  { id: 'duplo',     label: 'Duplo alerta',  desc: 'Dois bipes rápidos'        },
  { id: 'caixa',     label: 'Caixa',        desc: 'Estilo caixa registradora'  },
  { id: 'urgente',   label: 'Urgente',      desc: 'Alerta rápido e forte'      },
  { id: 'suave',     label: 'Suave',        desc: 'Toque discreto'             },
  { id: 'desligado', label: 'Desligado',    desc: 'Sem som'                    },
];

let _soundPref = (() => {
  try { return localStorage.getItem('ef_sound') || 'sino'; } catch { return 'sino'; }
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

const SOUNDS = {
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
    (SOUNDS[_soundPref] || SOUNDS.sino)(ctx);
  } catch(e) {}
}

// ── Alerta persistente — insiste até aceitar ──────────
let _alertInterval  = null;
let _alertCount     = 0;   // quantas vezes já tocou neste ciclo
const _ALERT_GAP    = 8000; // ms entre repetições (8s)
const _ALERT_MAX    = 60;   // para após 60 repetições (~8 min) como failsafe

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
    </div>`).join('');
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
  try {
    await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, delivery_fee_config: config });
    _taxaConfig = config;
    sbToast('ok', 'Taxa de entrega salva!');
  } catch(e) {
    sbToast('err', 'Erro ao salvar taxa');
  }
}

async function fecharMesa(num) {
  const numInt = parseInt(num);
  const t = tables.find(x => parseInt(x.num) === numInt);
  if (!t) return;
  sbLoading(true);
  try {
    // Busca TODOS os pedidos da sessão (incluindo entregue = bebidas/imediatos) para calcular total correto
    const sessionStart = t?.opened_at ? new Date(t.opened_at).getTime() - 5000 : 0;
    const { data: allSessionOrders } = await sb.from('orders')
      .select('total,taxa')
      .eq('mesa_num', numInt)
      .gte('created_at', sessionStart ? new Date(sessionStart).toISOString() : '2000-01-01')
      .not('status', 'eq', 'cancelado');

    const sessionTotal = (allSessionOrders || []).reduce((s, o) => s + parseFloat(o.total || 0) + parseFloat(o.taxa || 0), 0);

    // 1. Finaliza todos os pedidos ativos da mesa
    const { error: ordErr } = await sb.from('orders')
      .update({ status: 'entregue' })
      .eq('mesa_num', numInt)
      .in('status', ['analise', 'producao', 'pronto']);
    if (ordErr) throw ordErr;

    // 2. Marca a mesa como aguardando pagamento, gravando o total da sessão
    const { error: mesaErr } = await sb.from('mesas').update({
      status: 'waiting',
      total: sessionTotal,
      updated_at: new Date().toISOString()
    }).eq('num', numInt);
    if (mesaErr) throw mesaErr;

    // Atualiza estado local
    t.status = 'waiting';
    t.total = sessionTotal;
    ordersKanban = ordersKanban.filter(o => parseInt(o.mesa_num) !== numInt);
    mesaOrdersCache = mesaOrdersCache.filter(o => parseInt(o.mesa_num) !== numInt);
    renderKanban();
    _renderMesaPageFromCache();
    sbToast('ok', `Mesa ${numInt} aguardando pagamento — R$ ${sessionTotal.toFixed(2).replace('.', ',')} `);
  } catch(e) {
    console.error('fecharMesa error:', e);
    sbToast('err', 'Erro ao fechar mesa: ' + (e?.message || e));
  } finally {
    sbLoading(false);
  }
}

async function openRegistrarPagamento(num, totalJaCalculado) {
  const t = tables.find(x => parseInt(x.num) === parseInt(num));
  if (!t) return;

  let totalVal = parseFloat(totalJaCalculado) || 0;
  if (!totalJaCalculado) {
    const sessionStart = t?.opened_at ? new Date(t.opened_at).getTime() - 5000 : 0;
    totalVal = mesaOrdersCache
      .filter(o => parseInt(o.mesa_num) === parseInt(num))
      .filter(o => new Date(o.created_at || 0).getTime() >= sessionStart)
      .reduce((s, o) => s + parseFloat(o.total || 0), 0);
  }

  document.getElementById('modal-pag-mesa-title').textContent = `Registrar Pagamento — Mesa ${num}`;
  document.getElementById('modal-pag-total').textContent = 'R$ ' + totalVal.toFixed(2).replace('.',',');
  document.getElementById('modal-pag-mesa-num').value = num;
  const pagForma = t.pag_forma;
  if (pagForma) {
    const sel = document.getElementById('modal-pag-forma');
    if (sel) for (let i=0;i<sel.options.length;i++) {
      if (sel.options[i].value === pagForma) { sel.selectedIndex=i; break; }
    }
  }

  // Carrega resumo de itens — busca do banco para garantir dados completos
  const itensEl  = document.getElementById('modal-pag-itens');
  const listEl   = document.getElementById('modal-pag-itens-list');
  if (itensEl && listEl) {
    itensEl.style.display = 'none';
    listEl.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:6px">Carregando...</div>';
    itensEl.style.display = 'block';
    try {
      const sessionStart = t?.opened_at
        ? new Date(new Date(t.opened_at).getTime() - 5000).toISOString()
        : '2000-01-01';
      const { data: sessionOrders } = await sb.from('orders')
        .select('items,total,taxa,status')
        .eq('mesa_num', parseInt(num))
        .gte('created_at', sessionStart)
        .not('status', 'eq', 'cancelado');

      const itemMap = {};
      (sessionOrders || []).forEach(o => {
        (Array.isArray(o.items) ? o.items : []).forEach(i => {
          const key = i.name;
          if (!itemMap[key]) itemMap[key] = { name: i.name, qty: 0, subtotal: 0 };
          itemMap[key].qty      += (i.qty || 1);
          itemMap[key].subtotal += (i.price || 0) * (i.qty || 1);
        });
      });
      const itens = Object.values(itemMap);
      if (itens.length) {
        listEl.innerHTML = itens.map(i =>
          `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px">
            <span>${i.qty}× ${i.name}</span>
            <span style="color:var(--accent3);font-weight:600">R$ ${i.subtotal.toFixed(2).replace('.',',')}</span>
          </div>`
        ).join('');
        // Guarda os itens no modal para usar na impressão
        itensEl.dataset.ordersJson = JSON.stringify(itens);
      } else {
        listEl.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:6px">Nenhum item encontrado</div>';
      }
    } catch(e) {
      listEl.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:6px">Erro ao carregar itens</div>';
    }
  }

  openModal('modal-pag-mesa');
}

function imprimirViaCliente() {
  const num      = parseInt(document.getElementById('modal-pag-mesa-num').value);
  const totalStr = document.getElementById('modal-pag-total').textContent || 'R$ 0,00';
  const forma    = document.getElementById('modal-pag-forma')?.value || '';
  const itensEl  = document.getElementById('modal-pag-itens');
  const itens    = itensEl?.dataset.ordersJson ? JSON.parse(itensEl.dataset.ordersJson) : [];
  const nome     = _sessao?.nome || 'Estabelecimento';
  const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
  const formaLabel = { PIX: '💠 PIX', Cartão: '💳 Cartão', Dinheiro: '💵 Dinheiro' }[forma] || forma;

  const itensHtml = itens.length
    ? itens.map(i =>
        `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px dashed #ddd">
          <span>${i.qty}× ${i.name}</span>
          <span>R$ ${i.subtotal.toFixed(2).replace('.',',')}</span>
        </div>`
      ).join('')
    : '<div style="font-size:12px;color:#999;text-align:center;padding:8px">Sem itens</div>';

  const html = `
    <div style="font-family:monospace;background:#fff;color:#111;padding:20px;max-width:300px;margin:0 auto">
      <div style="text-align:center;margin-bottom:12px">
        <div style="font-size:18px;font-weight:900">${nome}</div>
        <div style="font-size:11px;color:#666">${dataHora}</div>
        <div style="font-size:13px;font-weight:700;margin-top:4px">Mesa ${num}</div>
        <hr style="border:none;border-top:1px dashed #ccc;margin:8px 0">
      </div>
      <div style="margin-bottom:10px">${itensHtml}</div>
      <hr style="border:none;border-top:1px dashed #ccc;margin:8px 0">
      <div style="display:flex;justify-content:space-between;font-weight:700;font-size:15px;margin-bottom:4px">
        <span>TOTAL</span><span>${totalStr}</span>
      </div>
      <div style="text-align:center;font-size:12px;color:#555;margin-top:6px">${formaLabel}</div>
      <div style="text-align:center;font-size:11px;color:#aaa;margin-top:10px">Obrigado pela preferência!</div>
    </div>`;

  // Tenta Electron primeiro, senão abre janela de impressão do browser
  if (window.ElectronPrint) {
    const fakeOrder = { id: num, client: `Mesa ${num}`, items: itens, total: parseFloat(totalStr.replace('R$ ','').replace(',','.')), pag: forma, mesa_num: num };
    window.ElectronPrint.printOrder(fakeOrder).catch(() => _printViaWindow(html));
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

async function confirmarPagamentoMesa() {
  const num   = parseInt(document.getElementById('modal-pag-mesa-num').value);
  const forma = document.getElementById('modal-pag-forma').value;
  // parseInt nos dois lados para evitar falha de comparação string vs number
  const t = tables.find(x => parseInt(x.num) === num);
  if (!t) { sbToast('err', 'Mesa não encontrada'); return; }

  const totalStr = document.getElementById('modal-pag-total').textContent || 'R$ 0,00';
  const totalVal = parseFloat(totalStr.replace('R$ ','').replace(',','.')) || 0;
  const time     = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});

  sbLoading(true);
  try {
    // 1. Finaliza todos os pedidos ativos da mesa
    const { error: ordErr } = await sb.from('orders')
      .update({ status: 'entregue' })
      .eq('mesa_num', num)
      .in('status', ['analise', 'producao', 'pronto']);
    if (ordErr) { console.error('orders update error:', ordErr); throw ordErr; }

    // 2. Liberar mesa
    const { error: mesaErr } = await sb.from('mesas').update({
      status: 'free', total: null, pag_forma: null,
      guests: null, opened_at: null, updated_at: new Date().toISOString()
    }).eq('num', num);
    if (mesaErr) { console.error('mesas update error:', mesaErr); throw mesaErr; }

    // 3. Registrar entrada no caixa (não-fatal — mesa libera mesmo se falhar)
    const { error: movErr } = await sb.from('movimentos').insert({
      description: `Mesa ${num} — Pagamento`,
      tipo: 'entrada', val: totalVal, pag: forma, time
    });
    if (movErr) console.warn('movimentos insert warning (não-fatal):', movErr);

    // Atualizar estado local e cache
    t.status = 'free'; t.total = null; t.guests = null;
    ordersKanban = ordersKanban.filter(o => parseInt(o.mesa_num) !== num);
    // Salva os pedidos da mesa ANTES de limpar o cache (comprovante precisa deles)
    const _ordensComprovante = mesaOrdersCache.filter(o => parseInt(o.mesa_num) === num);
    mesaOrdersCache = mesaOrdersCache.filter(o => parseInt(o.mesa_num) !== num);
    tables.sort((a,b) => parseInt(a.num) - parseInt(b.num));
    closeModal('modal-pag-mesa');
    _renderMesaPageFromCache();
    renderKanban();
    renderQR();
    closeModal('modal-pag-mesa');

    // Monta e exibe comprovante
    const caixaMsg = movErr ? ' (caixa não registrado)' : '';
    abrirComprovantesMesa(num, totalVal, forma, time, _ordensComprovante);
    sbToast('ok', `Mesa ${num} liberada — R$ ${totalVal.toFixed(2).replace('.',',')}${caixaMsg}`);
  } catch(e) {
    console.error('confirmarPagamentoMesa error:', e);
    const msg = e?.message || e?.details || e?.hint || JSON.stringify(e);
    sbToast('err', 'Erro: ' + msg);
  } finally {
    sbLoading(false);
  }
}

function abrirComprovantesMesa(num, totalVal, forma, time, ordensPreSalvas) {
  const modal = document.getElementById('modal-comprovante-mesa');
  if (!modal) return;

  // Usa os pedidos pré-salvos (passados antes de limpar o cache) ou fallback no cache
  const sessionOrders = ordensPreSalvas && ordensPreSalvas.length > 0
    ? ordensPreSalvas
    : mesaOrdersCache.filter(o => parseInt(o.mesa_num) === parseInt(num));

  // Consolida itens
  const itemMap = {};
  sessionOrders.forEach(o => {
    (Array.isArray(o.items) ? o.items : []).forEach(i => {
      const key = i.name;
      if (!itemMap[key]) itemMap[key] = { name:i.name, qty:0, total:0, drink:!!i.drink };
      itemMap[key].qty += (i.qty||1);
      itemMap[key].total += (i.price||0) * (i.qty||1);
    });
  });
  const itens = Object.values(itemMap);

  const nome  = _sessao?.nome || 'Estima Food';
  const dataHora = new Date().toLocaleString('pt-BR', {timeZone:'America/Fortaleza'});
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
  const html = conteudo;
  const fmt  = localStorage.getItem('printFormat') || _printFormat || '80mm';

  // Tenta via agente (silencioso)
  (async () => {
    try {
      const tid = (() => { try { return JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || ''; } catch { return ''; } })();
      if (tid) {
        const statusRes = await fetch('/api/print-queue/status', { headers: { 'x-tenant-id': tid } });
        const statusData = await statusRes.json();
        if (statusData.active) {
          await fetch('/api/print-queue/job', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
            body: JSON.stringify({ html, format: fmt }),
          });
          if (typeof sbToast === 'function') sbToast('ok', '🖨️ Comprovante enviado ao agente!');
          return;
        }
      }
    } catch {}
    // Fallback: popup com window.print()
    const w = window.open('', '_blank', 'width=400,height=600');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Comprovante</title>
      <style>body{margin:0;padding:16px;font-family:monospace} @media print{@page{margin:2mm;size:${fmt} auto} body{margin:0}}</style>
      </head><body>${conteudo}<script>window.onload=()=>{window.print();window.close()}<\/script></body></html>`);
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
  const { data, error } = await sb.from('garcons').insert({ nome, usuario, senha, ativo:true }).select().single();
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

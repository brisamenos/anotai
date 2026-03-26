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
    // Calcula total da sessão do cache ANTES de limpar (cache já está filtrado por sessão)
    const sessionTotal = mesaOrdersCache
      .filter(o => parseInt(o.mesa_num) === numInt)
      .reduce((s, o) => s + parseFloat(o.total || 0), 0);

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

function openRegistrarPagamento(num, totalJaCalculado) {
  const t = tables.find(x => parseInt(x.num) === parseInt(num));
  if (!t) return;

  // Usa o total passado pelo card (já calculado do mesaOrdersCache filtrado por sessão).
  // Evita re-query ao banco que puxaria histórico de sessões anteriores.
  let totalVal = parseFloat(totalJaCalculado) || 0;

  // Fallback: se não foi passado, calcula do cache local
  if (!totalJaCalculado) {
    const mesa = tables.find(x => parseInt(x.num) === parseInt(num));
    const sessionStart = mesa?.opened_at ? new Date(mesa.opened_at).getTime() - 5000 : 0;
    totalVal = mesaOrdersCache
      .filter(o => parseInt(o.mesa_num) === parseInt(num))
      .filter(o => new Date(o.created_at || 0).getTime() >= sessionStart)
      .reduce((s, o) => s + parseFloat(o.total || 0), 0);
  }

  document.getElementById('modal-pag-mesa-title').textContent = `Registrar Pagamento — Mesa ${num}`;
  document.getElementById('modal-pag-total').textContent = 'R$ ' + totalVal.toFixed(2).replace('.',',');
  document.getElementById('modal-pag-mesa-num').value = num;
  // Pré-seleciona forma de pagamento se garçom já informou
  const pagForma = t.pag_forma || t.pag_forma;
  if (pagForma) {
    const sel = document.getElementById('modal-pag-forma');
    if (sel) for (let i=0;i<sel.options.length;i++) {
      if (sel.options[i].value === pagForma) { sel.selectedIndex=i; break; }
    }
  }
  openModal('modal-pag-mesa');
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
    mesaOrdersCache = mesaOrdersCache.filter(o => parseInt(o.mesa_num) !== num);
    tables.sort((a,b) => parseInt(a.num) - parseInt(b.num));
    closeModal('modal-pag-mesa');
    _renderMesaPageFromCache();
    renderKanban();
    renderQR();
    closeModal('modal-pag-mesa');

    // Monta e exibe comprovante
    const caixaMsg = movErr ? ' (caixa não registrado)' : '';
    abrirComprovantesMesa(num, totalVal, forma, time);
    sbToast('ok', `Mesa ${num} liberada — R$ ${totalVal.toFixed(2).replace('.',',')}${caixaMsg}`);
  } catch(e) {
    console.error('confirmarPagamentoMesa error:', e);
    const msg = e?.message || e?.details || e?.hint || JSON.stringify(e);
    sbToast('err', 'Erro: ' + msg);
  } finally {
    sbLoading(false);
  }
}

function abrirComprovantesMesa(num, totalVal, forma, time) {
  const modal = document.getElementById('modal-comprovante-mesa');
  if (!modal) return;

  // Busca itens do consumo do cache
  const t = tables.find(x => parseInt(x.num) === parseInt(num));
  const sessionStart = t?.opened_at ? new Date(t.opened_at).getTime() - 5000 : 0;
  const sessionOrders = mesaOrdersCache.filter(o =>
    parseInt(o.mesa_num) === parseInt(num)
  );

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
  const w = window.open('', '_blank', 'width=400,height=600');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Comprovante</title>
    <style>body{margin:0;padding:16px;font-family:monospace} @media print{body{margin:0}}</style>
    </head><body>${conteudo}<script>window.onload=()=>{window.print();window.close()}<\/script></body></html>`);
  w.document.close();
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

// ═══════════════════════════════════════
// SERVIDOR DE AUTOMAÇÕES 24/7
// ═══════════════════════════════════════
async function salvarWaServerUrl() {
  const url = (document.getElementById('wa-server-url')?.value || '').replace(/\/$/,'');
  WA_SERVER = url;
  try { await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, wa_server_url: url }); } catch(e){}
}

async function testarServidorWA() {
  const url = (document.getElementById('wa-server-url')?.value || '').replace(/\/$/,'');
  if (!url) { sbToast('err','Informe a URL do servidor'); return; }
  WA_SERVER = url;
  const dot = document.getElementById('wa-sdot');
  const txt = document.getElementById('wa-stxt');
  const box = document.getElementById('wa-server-status');
  if (dot) dot.style.background = 'var(--accent3)';
  if (txt) txt.textContent = 'Testando...';
  try {
    const r = await fetch(`${url}/status`, { signal: AbortSignal.timeout(5000) });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.ok) {
      if (dot) dot.style.background = 'var(--success)';
      if (txt) txt.textContent = 'Online';
      if (box) { box.style.borderColor = 'rgba(34,197,94,.3)'; box.style.color = 'var(--success)'; }
      sbToast('ok', 'Servidor online! Automações 24/7 ativas.');
      await salvarWaServerUrl();
    } else {
      if (dot) dot.style.background = 'var(--danger)';
      if (txt) txt.textContent = 'Erro';
      sbToast('err', 'Servidor respondeu com erro');
    }
  } catch(e) {
    if (dot) dot.style.background = 'var(--danger)';
    if (txt) txt.textContent = 'Offline';
    if (box) box.style.borderColor = 'rgba(239,68,68,.3)';
    sbToast('err', 'Servidor não alcançado: ' + e.message);
  }
}

async function carregarWaServerUrl() {
  try {
    const { data } = await sb.from('store_config').select('wa_server_url').single();
    if (data?.wa_server_url) {
      WA_SERVER = data.wa_server_url;
      const el = document.getElementById('wa-server-url');
      if (el) el.value = data.wa_server_url;
      try {
        const r = await fetch(`${WA_SERVER}/status`, { signal: AbortSignal.timeout(3000) });
        const d = await r.json().catch(() => ({}));
        const dot = document.getElementById('wa-sdot');
        const txt = document.getElementById('wa-stxt');
        const box = document.getElementById('wa-server-status');
        if (r.ok && d.ok) {
          if (dot) dot.style.background = 'var(--success)';
          if (txt) txt.textContent = 'Online';
          if (box) { box.style.borderColor = 'rgba(34,197,94,.3)'; box.style.color = 'var(--success)'; }
        } else {
          if (dot) dot.style.background = 'var(--danger)';
          if (txt) txt.textContent = 'Offline';
        }
      } catch(e) {
        const dot = document.getElementById('wa-sdot');
        const txt = document.getElementById('wa-stxt');
        if (dot) dot.style.background = 'var(--danger)';
        if (txt) txt.textContent = 'Offline';
      }
    }
  } catch(e){}
}

// ═══════════════════════════════════════
// EVOLUTION API — proxy via servidor
// (API key nunca fica exposta no browser)
// ═══════════════════════════════════════
const EVO = {
  get instance(){ return (document.getElementById('evo-instance')?.value||'').trim(); },

  // Chama o proxy do servidor em /api/evo/*
  async req(method, path, body) {
    try {
      const tid = _sessao?.tenant_id || '';
      const r = await fetch(`/api/evo${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await r.json().catch(() => ({}));
      console.log(`[EVO proxy] ${method} ${path}`, r.status, data);
      return { ok: r.ok, status: r.status, data };
    } catch(e) {
      console.error('[EVO proxy] fetch error:', e);
      return { ok: false, error: e.message };
    }
  },

  async sendText(number, text) {
    const phone = number.replace(/\D/g,'');
    const num   = phone.startsWith('55') ? phone : `55${phone}`;
    const r = await this.req('POST', '/message/sendText/' + this.instance, { number: num, text });
    return r;
  }
};

let evoMsgHistory = [];
let evoConnected  = false;
let evoQrInterval = null;

function roboTab(tab) {
  ['wp','auto','msgs','ia','chat'].forEach(t => {
    document.getElementById('robo-tab-'+t)?.classList.toggle('on', t===tab);
    const s = document.getElementById('robo-section-'+t);
    if (s) s.style.display = t===tab ? '' : 'none';
  });
  if (tab==='msgs') evoCarregarHistorico();
  if (tab==='wp')   evoCheckStatus();
  if (tab==='ia')   iaCarregarConfig();
}

// Carrega instância salva do store_config ao abrir o Robô
async function evoCarregarInstancia() {
  try {
    const { data } = await sb.from('store_config').select('evo_instance').single();
    if (data?.evo_instance) {
      const el = document.getElementById('evo-instance');
      if (el) el.value = data.evo_instance;
    }
  } catch(e) {}
}

async function evoCriarInstancia() {
  const instName = EVO.instance;
  if (!instName) { sbToast('err', 'Informe o nome da instância antes de criar.'); return; }
  sbLoading(true);
  const r = await EVO.req('POST', '/instance/create', {
    instanceName: instName,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS'
  });
  sbLoading(false);
  if (r.ok) {
    // Salva evo_instance no store_config do tenant
    await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, evo_instance: instName });
    sbToast('ok', `Instância "${instName}" criada!`);
    evoCheckStatus();
  } else {
    const m = r.data?.message||r.data?.error||`Erro ${r.status}`;
    sbToast('err','Erro: '+(typeof m==='string'?m:JSON.stringify(m)));
  }
}

async function evoCheckStatus() {
  if (!EVO.instance) return;
  _evoSetStatus('loading','Verificando...');
  const r = await EVO.req('GET', `/instance/connectionState/${EVO.instance}`);
  if (!r.ok) { _evoSetStatus('disconnected','Desconectado'); return; }
  const state = r.data?.instance?.state || r.data?.state || 'close';
  const naAbaRobo = document.getElementById('page-robo')?.classList.contains('on');
  if (state==='open') {
    evoConnected=true;
    _evoSetStatus('connected','Conectado');
    if (naAbaRobo) _evoShowConnected(r.data?.instance?.profileName||r.data?.me?.pushName||'WhatsApp');
  } else {
    evoConnected=false;
    _evoSetStatus('disconnected','Desconectado');
    if (naAbaRobo) _evoShowQRPrompt();
  }
}

async function evoConectar() {
  const qrArea = document.getElementById('evo-qr-area');
  if (qrArea) qrArea.innerHTML='<div style="margin-bottom:10px"><div style="font-size:13px;color:var(--muted)">Gerando QR Code...</div>';
  const r = await EVO.req('GET', `/instance/connect/${EVO.instance}`);
  if (!r.ok || !r.data?.code) {
    if (qrArea) qrArea.innerHTML=`<div style="font-size:13px;color:var(--danger);margin-bottom:12px">${r.data?.message||'Erro ao gerar QR. Crie a instância primeiro.'}</div><button class="btn bp" onclick="evoCriarInstancia()">Criar instância</button>`;
    return;
  }
  if (qrArea) {
    if (r.data.base64) {
      qrArea.innerHTML=`<div style="font-size:13px;font-weight:600;margin-bottom:12px">Escaneie com seu WhatsApp</div><img src="${r.data.base64}" style="width:220px;height:220px;border-radius:12px;border:3px solid var(--accent);margin-bottom:12px"><div style="font-size:11px;color:var(--muted);margin-bottom:12px">QR Code expira em 60 segundos</div><button class="btn bg" style="font-size:11.5px" onclick="evoConectar()">Gerar novo QR Code</button>`;
    } else {
      qrArea.innerHTML=`<div style="font-size:12px;word-break:break-all;padding:10px;background:var(--surface2);border-radius:8px;margin-bottom:12px;color:var(--muted)">${(r.data.code||'').slice(0,80)}...</div><button class="btn bg" onclick="evoConectar()">Gerar novo QR</button>`;
    }
  }
  if (evoQrInterval) clearInterval(evoQrInterval);
  let tries=0;
  evoQrInterval = setInterval(async()=>{
    tries++;
    const s = await EVO.req('GET', `/instance/connectionState/${EVO.instance}`);
    const state = s.data?.instance?.state||s.data?.state||'close';
    if (state==='open') { clearInterval(evoQrInterval); evoConnected=true; _evoSetStatus('connected','Conectado'); _evoShowConnected(s.data?.instance?.profileName||'WhatsApp'); sbToast('ok',' WhatsApp conectado!'); }
    if (tries>30) clearInterval(evoQrInterval);
  }, 4000);
}

async function evoDesconectar() {
  if (!confirm('Desconectar WhatsApp?')) return;
  await EVO.req('DELETE', `/instance/logout/${EVO.instance}`);
  evoConnected=false; _evoSetStatus('disconnected','Desconectado'); _evoShowQRPrompt(); sbToast('ok','WhatsApp desconectado');
}

async function evoTestarEnvio() {
  const phone = document.getElementById('evo-test-phone')?.value?.replace(/\D/g,'');
  const msg   = document.getElementById('evo-test-msg')?.value;
  const res   = document.getElementById('evo-test-result');
  if (!phone || phone.length < 10) { sbToast('err','Número inválido. Ex: 85912345678'); return; }
  if (!msg)  { sbToast('err','Informe a mensagem'); return; }
  if (res) { res.style.display='block'; res.innerHTML='<span style="color:var(--muted)">Enviando...</span>'; }

  const r = await EVO.sendText(phone, msg);
  console.log('[EVO TEST]', r);

  if (r.ok) {
    if (res) res.innerHTML='<span style="color:var(--success)">Mensagem enviada!</span>';
    sbToast('ok','Mensagem enviada!');
    evoMsgHistory.unshift({ to:phone, tipo:'Teste', msg:(msg||'').slice(0,60), status:'enviado', time: new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) });
  } else {
    // Extrai erro real da resposta da API
    const d = r.data || {};
    const errMsg = d.message || d.error || d.response?.message || d.response || r.error || `HTTP ${r.status}`;
    const errStr = typeof errMsg === 'object' ? JSON.stringify(errMsg) : String(errMsg);
    if (res) res.innerHTML=`
      <span style="color:var(--danger)">❌ Erro: ${errStr}</span>
      <details style="margin-top:6px;font-size:11px;color:var(--muted)">
        <summary style="cursor:pointer">Ver resposta completa da API</summary>
        <pre style="margin-top:4px;background:var(--surface2);padding:8px;border-radius:6px;overflow:auto;font-size:10px">${JSON.stringify(d,null,2)}</pre>
      </details>`;
    sbToast('err', 'Erro: ' + errStr.slice(0,80));
  }
}

async function evoEnviarMensagem(phone, tipo, vars={}) {
  // Verifica se o toggle da automação está ativo
  const toggle = document.getElementById(`auto-toggle-${tipo}`);
  if (toggle && !toggle.classList.contains('on')) return false;
  const msgEl = document.getElementById(`auto-msg-${tipo}`);
  if (!msgEl) return false;
  let text = msgEl.value;
  Object.entries(vars).forEach(([k,v])=>{ text=text.replaceAll(`{${k}}`,v||''); });
  const r = await EVO.sendText(phone, text);
  console.log(`[EVO AUTO] tipo=${tipo} para=${phone}`, r.ok ? '✅' : '❌', r);
  evoMsgHistory.unshift({
    to: phone,
    tipo: tipo.charAt(0).toUpperCase()+tipo.slice(1),
    msg: text.slice(0,60)+'...',
    status: r.ok ? 'enviado' : 'falhou',
    time: new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
  });
  return r.ok;
}

async function evoEnviarAniversariantesManual() {
  try {
    const r = await fetch(`${WA_SERVER}/aniversario`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const d = await r.json().catch(() => ({}))
    sbToast(r.ok ? 'ok' : 'err', r.ok ? 'Verificação de aniversários iniciada!' : 'Erro: servidor offline?')
  } catch(e) {
    // Fallback: roda no browser se servidor offline
    evoEnviarAniversariantesHoje(false)
  }
}

async function evoEnviarAniversariantesHoje(silencioso = false) {
  const toggle = document.getElementById('auto-toggle-aniversario');
  if (toggle && !toggle.classList.contains('on')) {
    if (!silencioso) sbToast('err', 'Automação de aniversário está desativada');
    return;
  }
  const today  = new Date();
  const todayMD = `${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const anivs  = fidClients.filter(c => c.birthday && c.birthday.slice(5) === todayMD && c.phone);
  if (!anivs.length) {
    if (!silencioso) sbToast('ok', 'Nenhum aniversariante com telefone hoje');
    return;
  }
  if (!silencioso) sbLoading(true);
  let ok=0, fail=0;
  for (const c of anivs) {
    const sent = await evoEnviarMensagem(c.phone, 'aniversario', { nome: c.name });
    sent ? ok++ : fail++;
    await new Promise(r => setTimeout(r, 1200));
  }
  if (!silencioso) sbLoading(false);
  // Salva que já enviou hoje no Supabase
  try { await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, evo_aniv_last: todayMD }); } catch(e){}
  // Atualiza label na tela
  const lastEl = document.getElementById('aniv-last-send');
  if (lastEl) lastEl.textContent = 'Último envio: ' + todayMD + ' às ' + new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  if (!silencioso) sbToast('ok', 'Enviado para ' + ok + ' aniversariante(s)' + (fail ? ' | ' + fail + ' falhou' : '') + '!');
  else if (ok > 0) sbToast('ok', 'Felicitações enviadas para ' + ok + ' aniversariante(s)!');
}

// ── Scheduler automático de aniversário ──────────────────
let _anivSchedulerTimer = null;
let _anivLastSent = null; // cache em memória para não bater no banco a cada minuto

async function _checarAniversario() {
  const toggle = document.getElementById('auto-toggle-aniversario');
  if (!toggle || !toggle.classList.contains('on')) return;

  const horaEl  = document.getElementById('auto-aniv-hora');
  const horaCfg = horaEl?.value || '09:00';
  const [hCfg, mCfg] = horaCfg.split(':').map(Number);
  const now     = new Date();
  const todayMD = `${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  // Usa cache em memória primeiro
  if (_anivLastSent === todayMD) return;

  // Só consulta o banco uma vez por dia (quando cache está vazio ou é outro dia)
  if (!_anivLastSent) {
    try {
      const { data } = await sb.from('store_config').select('evo_aniv_last').single();
      _anivLastSent = data?.evo_aniv_last || null;
    } catch(e) {}
  }

  if (_anivLastSent === todayMD) return;

  const minutosAgora = now.getHours() * 60 + now.getMinutes();
  const minutosCfg   = hCfg * 60 + mCfg;

  if (minutosAgora >= minutosCfg) {
    console.log('[EVO SCHEDULER] ✅ Disparando aniversários automáticos:', todayMD, horaCfg);
    _anivLastSent = todayMD; // marca na memória imediatamente para não duplicar
    evoEnviarAniversariantesHoje(true);
  }
}

function _iniciarSchedulerAniversario() {
  if (_anivSchedulerTimer) clearInterval(_anivSchedulerTimer);
  // Roda logo ao iniciar (caso já tenha passado da hora hoje)
  setTimeout(_checarAniversario, 5000);
  // Verifica a cada 60s
  _anivSchedulerTimer = setInterval(_checarAniversario, 60000);
  console.log('[EVO SCHEDULER] Scheduler de aniversário iniciado ✅');
}

async function evoSalvarAutomacoes() {
  const tipos = ['recebido','confirmado','pronto','entrega','cancelado','aniversario','boasvindas','avaliacao','retorno','promocao','pontos','cashback','conta'];
  const data = {};
  tipos.forEach(tipo => {
    data[tipo] = {
      on:  document.getElementById(`auto-toggle-${tipo}`)?.classList.contains('on'),
      msg: document.getElementById(`auto-msg-${tipo}`)?.value
    };
  });
  data._aniv_hora = document.getElementById('auto-aniv-hora')?.value || '09:00';
  try {
    const { error } = await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, evo_automacoes: data });
    if (error) throw error;
    sbToast('ok', 'Automações salvas!');
  } catch(e) {
    sbToast('err', 'Erro ao salvar: ' + (e.message || JSON.stringify(e)));
  }
}

async function evoCarregarAutomacoesSalvas() {
  try {
    const { data } = await sb.from('store_config').select('evo_automacoes').single();
    const cfg = data?.evo_automacoes || {};
    Object.entries(cfg).forEach(([tipo, val]) => {
      if (tipo.startsWith('_')) return;
      const t = document.getElementById(`auto-toggle-${tipo}`);
      const m = document.getElementById(`auto-msg-${tipo}`);
      if (t) { val.on ? t.classList.add('on') : t.classList.remove('on'); }
      if (m && val.msg) m.value = val.msg;
    });
    if (cfg._aniv_hora) {
      const h = document.getElementById('auto-aniv-hora');
      if (h) h.value = cfg._aniv_hora;
    }
  } catch(e) {
    console.warn('evoCarregarAutomacoesSalvas:', e);
  }
}


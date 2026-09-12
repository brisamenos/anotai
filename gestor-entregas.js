var entregasState = {
  entregadores: [],
  fila: [],
  ativas: [],
  sem_entregador: [],
  rotas: [],
  concluidas_hoje: [],
  resumo: {},
  selected: new Set(),
  sse: null,
  sseTid: null,
  refreshTimer: null
};

function entTenantId() {
  return _sessao?.tenant_id || (() => {
    try { return JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || ''; }
    catch { return ''; }
  })();
}

function entEsc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function entMoney(v) {
  return 'R$ ' + (parseFloat(v || 0) || 0).toFixed(2).replace('.', ',');
}

function entOrderNum(o) {
  return o?.order_num || o?.num || o?.id || o?.order_id || '-';
}

function entOrderTotal(o) {
  if (o?.total_pedido !== undefined) return parseFloat(o.total_pedido || 0) || 0;
  return (parseFloat(o?.total || 0) || 0) + (parseFloat(o?.taxa || 0) || 0);
}

function entSetText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function entEmpty(text) {
  return `<div style="padding:18px;border:1px dashed var(--border);border-radius:10px;color:var(--muted);font-size:13px;text-align:center">${entEsc(text)}</div>`;
}

function entWhen(value) {
  if (!value) return '';
  try {
    // Mesma correção de fuso aplicada em odDateTime/_parseCreatedAt: valor vem em UTC
    // sem "Z" do SQLite, então forçamos interpretação UTC antes de converter pra Brasília.
    const s = String(value).trim();
    let d;
    if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
      d = new Date(s);
    } else {
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
      d = m ? new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6])) : new Date(s);
    }
    if (isNaN(d.getTime())) return String(value).slice(11, 16);
    return d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  } catch {
    return String(value).slice(11, 16);
  }
}

function entStatusLabel(status) {
  return ({
    pendente: 'Pendente',
    atribuida: 'Atribuida',
    em_rota: 'Em rota',
    entregue: 'Entregue',
    problema: 'Problema',
    retornada: 'Retornada',
    cancelada: 'Cancelada',
    aberta: 'Aberta',
    finalizada: 'Finalizada'
  })[status] || status || '-';
}

function entMapUrl(addr) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr || '');
}

function entDriverLocationUrl(o) {
  if (!o || o.entregador_lat == null || o.entregador_lng == null) return '';
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.entregador_lat + ',' + o.entregador_lng);
}

function entAppUrl() {
  const tid = entTenantId();
  return `${location.origin}/entregador.html?tenant=${encodeURIComponent(tid || '')}`;
}

async function entAbrirAppEntregador() {
  const url = entAppUrl();
  if (!entTenantId()) { if (typeof sbToast === 'function') sbToast('err', 'Sessao sem tenant'); return; }
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(url);
    if (typeof sbToast === 'function') sbToast('ok', 'Link do app copiado. Abrindo em nova aba.');
  } catch {}
  window.open(url, '_blank', 'noopener');
}

async function entApi(path, opts = {}) {
  const tid = entTenantId();
  if (!tid) throw new Error('Sessao sem tenant. Recarregue o gestor.');
  const headers = Object.assign({ 'Content-Type': 'application/json', 'x-tenant-id': tid }, opts.headers || {});
  const req = Object.assign({}, opts, { headers });
  if (req.body && typeof req.body !== 'string') req.body = JSON.stringify(req.body);
  const res = await fetch(path, req);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || 'Erro na requisicao');
  return data;
}

function entDriverOptions(selected, emptyLabel) {
  const active = entregasState.entregadores.filter(d => Number(d.ativo) !== 0);
  const first = `<option value="">${entEsc(emptyLabel || 'Selecione')}</option>`;
  return first + active.map(d => {
    const sel = String(d.id) === String(selected || '') ? ' selected' : '';
    return `<option value="${d.id}"${sel}>${entEsc(d.nome)}</option>`;
  }).join('');
}

function entSyncSelection() {
  const ids = new Set([].concat(entregasState.fila, entregasState.sem_entregador).map(o => Number(o.id)));
  entregasState.selected = new Set([...entregasState.selected].filter(id => ids.has(Number(id))));
}

async function renderEntregas(silent = false) {
  const page = document.getElementById('page-entregas');
  if (!page) return;
  if (!silent) {
    const list = document.getElementById('ent-fila-list');
    if (list && !entregasState.fila.length) list.innerHTML = entEmpty('Carregando entregas...');
  }
  try {
    const data = await entApi('/api/entregas/dashboard');
    entregasState.entregadores = data.entregadores || [];
    entregasState.fila = data.fila || [];
    entregasState.ativas = data.ativas || [];
    entregasState.sem_entregador = data.sem_entregador || [];
    entregasState.rotas = data.rotas || [];
    entregasState.concluidas_hoje = data.concluidas_hoje || [];
    entregasState.resumo = data.resumo || {};
    entSyncSelection();
    entRenderStats();
    entRenderFila();
    entRenderDrivers();
    entRenderAtivas();
    entRenderRotas();
    entRenderConcluidas();
    entSubscribeSSE();
  } catch(e) {
    console.error('[ENTREGAS]', e);
    if (typeof sbToast === 'function') sbToast('err', 'Erro ao carregar entregas: ' + e.message);
  }
}

function entRenderStats() {
  const r = entregasState.resumo || {};
  entSetText('ent-stat-prontos', String(r.prontos || 0));
  entSetText('ent-stat-rota', String(r.em_rota || 0));
  entSetText('ent-stat-atribuidas', String(r.atribuidas || 0));
  entSetText('ent-stat-hoje', String(r.entregues_hoje || 0));
  entSetText('ent-stat-dinheiro', entMoney(r.dinheiro_rua || 0));
}

function entRenderFila() {
  const wrap = document.getElementById('ent-fila-list');
  const rotaSelect = document.getElementById('ent-rota-entregador');
  if (rotaSelect) rotaSelect.innerHTML = entDriverOptions('', 'Entregador da rota');
  if (!wrap) return;
  const map = new Map();
  [].concat(entregasState.fila, entregasState.sem_entregador).forEach(o => map.set(Number(o.id), o));
  const rows = [...map.values()];
  if (!rows.length) {
    wrap.innerHTML = entEmpty('Nenhum pedido pronto para entrega agora.');
    return;
  }
  wrap.innerHTML = rows.map(o => {
    const id = Number(o.id);
    const checked = entregasState.selected.has(id) ? ' checked' : '';
    const driverSelect = `ent-driver-${id}`;
    const address = o.addr || '';
    return `
      <div class="ent-card" style="display:flex;gap:12px;align-items:flex-start">
        <input type="checkbox" ${checked} onchange="entSelecionarPedido(${id}, this.checked)" style="width:17px;height:17px;accent-color:var(--accent);cursor:pointer;margin-top:2px;flex-shrink:0">
        <div style="flex:1;min-width:0">
          <div class="ent-title">#${entEsc(entOrderNum(o))} <span style="font-weight:600;color:var(--muted);font-size:12.5px">${entEsc(o.client || 'Cliente')}</span></div>
          <div class="ent-sub">${entEsc(address)}${o.bairro ? ` · <span style="color:var(--accent3);font-weight:600">${entEsc(o.bairro)}</span>` : ''}</div>
          <div class="ent-chips">
            <span class="ent-chip">${entMoney(entOrderTotal(o))}</span>
            ${o.valor_receber_calc || o.valor_receber ? `<span class="ent-chip green">Receber ${entMoney(o.valor_receber_calc || o.valor_receber)}</span>` : ''}
          </div>
          <div class="ent-actions">
            <select class="form-input" id="${driverSelect}" style="width:200px;max-width:100%;font-size:12.5px;padding:7px 10px">${entDriverOptions(o.entregador_id, 'Entregador')}</select>
            <button class="btn bg" onclick="entAtribuir(${id}, false)">Atribuir</button>
            <button class="btn bp" onclick="entAtribuir(${id}, true)">Sair p/ entrega</button>
            <a class="btn bg" style="text-decoration:none" href="${entMapUrl(address)}" target="_blank" rel="noopener">📍 Mapa</a>
          </div>
        </div>
      </div>`;
  }).join('');
}

function entRenderDrivers() {
  const wrap = document.getElementById('ent-entregadores-list');
  if (!wrap) return;
  if (!entregasState.entregadores.length) {
    wrap.innerHTML = entEmpty('Cadastre um entregador para montar rotas.');
    return;
  }
  wrap.innerHTML = entregasState.entregadores.map(d => {
    const ativo = Number(d.ativo) !== 0;
    const comissao = String(d.comissao_tipo || 'fixa') === 'percent'
      ? `${parseFloat(d.comissao_valor || 0)}%`
      : entMoney(d.comissao_valor || 0);
    const inicial = (d.nome || '?').trim().charAt(0).toUpperCase();
    return `
      <div class="ent-card">
        <div class="ent-row-top">
          <div style="display:flex;gap:10px;align-items:center;min-width:0">
            <div class="ent-avatar">${entEsc(inicial)}</div>
            <div style="min-width:0">
              <div class="ent-title" style="font-size:13.5px">${entEsc(d.nome)}</div>
              <div class="ent-sub" style="margin-top:2px">${entEsc(d.telefone || 'Sem telefone')} · Comissão ${entEsc(comissao)}</div>
            </div>
          </div>
          <span class="ent-chip ${ativo ? 'green' : ''}" style="flex-shrink:0">${ativo ? 'Ativo' : 'Pausado'}</span>
        </div>
        <div class="ent-driver-stats">
          <div>
            <div class="ent-driver-stat-val" style="color:var(--accent)">${d.entregas_hoje || 0}</div>
            <div class="ent-driver-stat-lbl">Hoje</div>
          </div>
          <div>
            <div class="ent-driver-stat-val">${d.total_entregas || 0}</div>
            <div class="ent-driver-stat-lbl">Entregas (total)</div>
          </div>
          <div>
            <div class="ent-driver-stat-val" style="color:#16a34a">${entMoney(d.total_valor || 0)}</div>
            <div class="ent-driver-stat-lbl">Movimentado</div>
          </div>
          <div>
            <div class="ent-driver-stat-val" style="color:var(--accent3)">${entMoney(d.total_comissao || 0)}</div>
            <div class="ent-driver-stat-lbl">Comissão total</div>
          </div>
        </div>
        <div class="ent-actions">
          <button class="btn bg" onclick="openEntregadorModal(${d.id})">Editar</button>
          <button class="btn bg" onclick="entAbrirAppEntregador()">App</button>
          <button class="btn ${ativo ? 'bd' : 'bp'}" onclick="toggleEntregador(${d.id}, ${ativo ? 0 : 1})">${ativo ? 'Pausar' : 'Ativar'}</button>
        </div>
      </div>`;
  }).join('');
}

function entRenderAtivas() {
  const wrap = document.getElementById('ent-ativas-list');
  if (!wrap) return;
  if (!entregasState.ativas.length) {
    wrap.innerHTML = entEmpty('Nenhuma entrega atribuida ou em rota.');
    return;
  }
  wrap.innerHTML = entregasState.ativas.map(o => {
    const entregaId = Number(o.entrega_id);
    const orderId = Number(o.id);
    const status = o.entrega_status || 'atribuida';
    return `
      <div class="ent-card">
        <div class="ent-row-top">
          <div>
            <div class="ent-title">#${entEsc(entOrderNum(o))} <span style="font-weight:600;color:var(--muted);font-size:12.5px">${entEsc(o.client || 'Cliente')}</span></div>
            <div class="ent-sub">${entEsc(o.entregador_nome || 'Sem entregador')}</div>
          </div>
          <span class="ent-chip ${status === 'em_rota' ? 'green' : 'blue'}">${entStatusLabel(status)}</span>
        </div>
        <div class="ent-sub">${entEsc(o.addr || '')}</div>
        <div class="ent-chips">
          <span class="ent-chip">${entMoney(entOrderTotal(o))}</span>
          <span class="ent-chip green">Receber ${entMoney(o.valor_receber || 0)}</span>
          <span class="ent-chip">Comissão ${entMoney(o.comissao || 0)}</span>
          ${o.saiu_at ? `<span class="ent-chip">Saiu ${entWhen(o.saiu_at)}</span>` : ''}
        </div>
        ${o.problema ? `<div style="font-size:12px;color:var(--danger);font-weight:700;margin-top:8px">⚠ ${entEsc(o.problema)}</div>` : ''}
        <div class="ent-actions">
          ${status !== 'em_rota' ? `<button class="btn bp" onclick="entAtualizarStatus(${entregaId}, 'em_rota')">Iniciar</button>` : ''}
          <button class="btn bg" onclick="entConcluirEntrega(${entregaId}, ${orderId}, ${parseFloat(o.valor_receber || 0) || 0})">✓ Entregue</button>
          <button class="btn bd" onclick="entMarcarProblema(${entregaId})">Problema</button>
          <a class="btn bg" style="text-decoration:none" href="${entMapUrl(o.addr)}" target="_blank" rel="noopener">📍 Mapa</a>
          ${entDriverLocationUrl(o) ? `<a class="btn bg" style="text-decoration:none" href="${entDriverLocationUrl(o)}" target="_blank" rel="noopener">GPS</a>` : ''}
        </div>
      </div>`;
  }).join('');
}

function entRenderRotas() {
  const wrap = document.getElementById('ent-rotas-list');
  if (!wrap) return;
  if (!entregasState.rotas.length) {
    wrap.innerHTML = entEmpty('Nenhuma rota aberta.');
    return;
  }
  wrap.innerHTML = entregasState.rotas.map(r => `
    <div class="ent-card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div class="ent-title">Rota #${r.id} <span style="font-weight:600;color:var(--muted);font-size:12.5px">${entEsc(r.entregador_nome || 'Entregador')}</span></div>
        <div class="ent-sub">${r.pedidos_count || 0} pedidos · ${entMoney(r.total_pedidos || 0)} · receber ${entMoney(r.dinheiro_previsto || 0)}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <span class="ent-chip ${r.status === 'em_rota' ? 'green' : ''}">${entStatusLabel(r.status)}</span>
        ${r.status === 'aberta' ? `<button class="btn bp" style="font-size:12px;padding:7px 10px" onclick="entAtualizarRota(${r.id}, 'em_rota')">Iniciar rota</button>` : ''}
        <button class="btn bg" style="font-size:12px;padding:7px 10px" onclick="entAtualizarRota(${r.id}, 'finalizada')">Finalizar</button>
        ${r.status === 'aberta' ? `<button class="btn bd" style="font-size:12px;padding:7px 10px" onclick="entAtualizarRota(${r.id}, 'cancelada')">Cancelar</button>` : ''}
      </div>
    </div>
  `).join('');
}

function entRenderConcluidas() {
  const wrap = document.getElementById('ent-concluidas-list');
  if (!wrap) return;
  if (!entregasState.concluidas_hoje.length) {
    wrap.innerHTML = entEmpty('Nenhuma entrega concluida hoje.');
    return;
  }
  wrap.innerHTML = entregasState.concluidas_hoje.map(e => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--border);padding:8px 0">
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:800">#${entEsc(entOrderNum(e))} - ${entEsc(e.client || 'Cliente')}</div>
        <div style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${entEsc(e.entregador_nome || 'Entregador')} - ${entEsc(e.addr || '')}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:12px;font-weight:800;color:var(--success)">${entMoney(e.valor_pedido || entOrderTotal(e))}</div>
        <div style="font-size:11px;color:var(--muted)">${entWhen(e.entregue_at)}</div>
      </div>
    </div>
  `).join('');
}

function entSelecionarPedido(id, checked) {
  id = Number(id);
  if (checked) entregasState.selected.add(id);
  else entregasState.selected.delete(id);
}

async function entAtribuir(orderId, iniciar) {
  const select = document.getElementById(`ent-driver-${orderId}`);
  const entregadorId = parseInt(select?.value || '0');
  if (!entregadorId) { sbToast('err', 'Selecione um entregador'); return; }
  try {
    if (typeof sbLoading === 'function') sbLoading(true);
    await entApi('/api/entregas/atribuir', {
      method: 'POST',
      body: { order_id: orderId, entregador_id: entregadorId, iniciar_rota: !!iniciar }
    });
    if (typeof loadAllData === 'function') await loadAllData(true);
    await renderEntregas(true);
    if (typeof renderKanban === 'function') renderKanban();
    sbToast('ok', iniciar ? 'Entrega saiu para rota' : 'Entrega atribuida');
  } catch(e) {
    sbToast('err', e.message);
  } finally {
    if (typeof sbLoading === 'function') sbLoading(false);
  }
}

async function entCriarRotaSelecionados(iniciar) {
  const ids = [...entregasState.selected];
  const entregadorId = parseInt(document.getElementById('ent-rota-entregador')?.value || '0');
  if (!ids.length) { sbToast('err', 'Selecione pelo menos um pedido'); return; }
  if (!entregadorId) { sbToast('err', 'Selecione o entregador da rota'); return; }
  try {
    if (typeof sbLoading === 'function') sbLoading(true);
    await entApi('/api/rotas-entrega/criar', {
      method: 'POST',
      body: { entregador_id: entregadorId, order_ids: ids, iniciar_rota: !!iniciar }
    });
    entregasState.selected.clear();
    if (typeof loadAllData === 'function') await loadAllData(true);
    await renderEntregas(true);
    if (typeof renderKanban === 'function') renderKanban();
    sbToast('ok', iniciar ? 'Rota criada e iniciada' : 'Rota criada');
  } catch(e) {
    sbToast('err', e.message);
  } finally {
    if (typeof sbLoading === 'function') sbLoading(false);
  }
}

async function entAtualizarStatus(entregaId, status, extra = {}) {
  try {
    if (typeof sbLoading === 'function') sbLoading(true);
    await entApi('/api/entregas/status', {
      method: 'POST',
      body: Object.assign({ entrega_id: entregaId, status }, extra)
    });
    if (typeof loadAllData === 'function') await loadAllData(true);
    await renderEntregas(true);
    if (typeof renderKanban === 'function') renderKanban();
    sbToast('ok', 'Entrega atualizada');
  } catch(e) {
    sbToast('err', e.message);
  } finally {
    if (typeof sbLoading === 'function') sbLoading(false);
  }
}

// Modal simples de "digite um valor", no lugar de prompt() — o app roda
// também dentro do Electron, que não implementa window.prompt() (só
// confirm()). Isso fazia o fluxo de concluir entrega parar silenciosamente
// no meio (raw === null sempre), sem nenhum erro aparecer: parecia que
// "não conclui", mas na verdade nunca passava dessa etapa.
function entPromptModal({ titulo, label, valorInicial = '', tipo = 'text', placeholder = '' }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10098;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(15,23,42,.6);backdrop-filter:blur(4px)';
    overlay.innerHTML = `
      <div style="width:min(360px,94vw);background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:0 24px 70px rgba(2,6,23,.4);padding:20px">
        <div style="font-size:15px;font-weight:800;margin-bottom:14px">${entEsc(titulo)}</div>
        <label class="form-label">${entEsc(label)}</label>
        <input type="${tipo}" id="ent-prompt-input" class="form-input" value="${entEsc(valorInicial)}" placeholder="${entEsc(placeholder)}" step="0.01" style="margin-bottom:16px">
        <div style="display:flex;gap:8px">
          <button type="button" id="ent-prompt-cancel" style="flex:1;padding:11px;border:1px solid var(--border);border-radius:10px;background:none;color:var(--text);font-weight:700;font-size:13px;cursor:pointer">Cancelar</button>
          <button type="button" id="ent-prompt-ok" style="flex:1;padding:11px;border:none;border-radius:10px;background:var(--accent);color:#fff;font-weight:700;font-size:13px;cursor:pointer">Confirmar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#ent-prompt-input');
    const finalizar = (valor) => { overlay.remove(); resolve(valor); };
    overlay.querySelector('#ent-prompt-ok').onclick = () => finalizar(input.value);
    overlay.querySelector('#ent-prompt-cancel').onclick = () => finalizar(null);
    overlay.addEventListener('click', e => { if (e.target === overlay) finalizar(null); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') finalizar(input.value); });
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

async function entConcluirEntrega(entregaId, orderId, valorReceber) {
  if (!confirm('Marcar esta entrega como concluida?')) return;
  let recebido = parseFloat(valorReceber || 0) || 0;
  if (recebido > 0) {
    const raw = await entPromptModal({ titulo: 'Valor recebido', label: 'Valor recebido pelo entregador (R$)', valorInicial: recebido.toFixed(2).replace('.', ','), tipo: 'number' });
    if (raw === null) return;
    recebido = parseFloat(String(raw).replace(',', '.')) || 0;
  }
  try {
    if (typeof sbLoading === 'function') sbLoading(true);
    await entFinalizarPedidoFallback(orderId);
    await entApi('/api/entregas/status', {
      method: 'POST',
      body: { entrega_id: entregaId, status: 'entregue', recebido }
    });
    if (typeof loadAllData === 'function') await loadAllData(true);
    await renderEntregas(true);
    if (typeof renderKanban === 'function') renderKanban();
    sbToast('ok', 'Entrega concluida');
  } catch(e) {
    sbToast('err', 'Erro ao concluir entrega: ' + e.message);
  } finally {
    if (typeof sbLoading === 'function') sbLoading(false);
  }
}

// Finaliza o PEDIDO usando a mesma função que o kanban normal usa
// (finishOrderById) — antes essa tela tinha sua própria cópia dessa
// lógica, que foi ficando pra trás e não dava pontos de fidelidade nem
// as outras coisas que finishOrderById ganhou com o tempo. Uma função só,
// usada nos dois lugares, evita esse tipo de divergência silenciosa.
async function entFinalizarPedidoFallback(orderId) {
  if (typeof finishOrderById === 'function') {
    await finishOrderById(orderId);
    return;
  }
  // Fallback só pro caso (não deveria acontecer) de finishOrderById não
  // estar carregada ainda nesse contexto.
  const res = await fetch('/api/order-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': entTenantId() },
    body: JSON.stringify({ order_id: orderId, new_status: 'finalizado', tenant_id: entTenantId() })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro ao finalizar pedido');
  if (Array.isArray(ordersKanban)) ordersKanban = ordersKanban.filter(o => Number(o.id) !== Number(orderId));
}

async function entMarcarProblema(entregaId) {
  const problema = await entPromptModal({ titulo: 'Reportar problema', label: 'Descreva o problema da entrega', placeholder: 'Ex: Cliente não atendeu' });
  if (problema === null) return;
  if (!String(problema).trim()) { sbToast('err', 'Informe o problema'); return; }
  await entAtualizarStatus(entregaId, 'problema', { problema });
}

async function entAtualizarRota(rotaId, status) {
  if (['finalizada','cancelada'].includes(status) && !confirm(`${entStatusLabel(status)} esta rota?`)) return;
  try {
    if (typeof sbLoading === 'function') sbLoading(true);
    await entApi('/api/rotas-entrega/status', {
      method: 'POST',
      body: { rota_id: rotaId, status }
    });
    if (typeof loadAllData === 'function') await loadAllData(true);
    await renderEntregas(true);
    if (typeof renderKanban === 'function') renderKanban();
    sbToast('ok', 'Rota atualizada');
  } catch(e) {
    sbToast('err', e.message);
  } finally {
    if (typeof sbLoading === 'function') sbLoading(false);
  }
}

function openEntregadorModal(id) {
  const d = id ? entregasState.entregadores.find(x => Number(x.id) === Number(id)) : null;
  entSetText('entregador-modal-title', d ? 'Editar entregador' : 'Novo entregador');
  const idEl = document.getElementById('entregador-edit-id');
  const nome = document.getElementById('entregador-nome');
  const tel = document.getElementById('entregador-telefone');
  const tipo = document.getElementById('entregador-comissao-tipo');
  const valor = document.getElementById('entregador-comissao-valor');
  const ativo = document.getElementById('entregador-ativo');
  if (idEl) idEl.value = d?.id || '';
  if (nome) nome.value = d?.nome || '';
  if (tel) tel.value = d?.telefone || '';
  if (tipo) tipo.value = d?.comissao_tipo || 'fixa';
  if (valor) valor.value = d?.comissao_valor || '';
  if (ativo) ativo.checked = d ? Number(d.ativo) !== 0 : true;
  openModal('modal-entregador');
}

async function saveEntregador() {
  const id = parseInt(document.getElementById('entregador-edit-id')?.value || '0');
  const nome = String(document.getElementById('entregador-nome')?.value || '').trim();
  if (!nome) { sbToast('err', 'Informe o nome do entregador'); return; }
  const data = {
    nome,
    telefone: String(document.getElementById('entregador-telefone')?.value || '').trim(),
    comissao_tipo: document.getElementById('entregador-comissao-tipo')?.value || 'fixa',
    comissao_valor: parseFloat(document.getElementById('entregador-comissao-valor')?.value || '0') || 0,
    ativo: document.getElementById('entregador-ativo')?.checked ? 1 : 0
  };
  try {
    if (typeof sbLoading === 'function') sbLoading(true);
    await entApi('/api/entregadores/salvar', {
      method: 'POST',
      body: Object.assign({ id: id || undefined }, data)
    });
    closeModal('modal-entregador');
    await renderEntregas(true);
    sbToast('ok', id ? 'Entregador atualizado' : 'Entregador cadastrado');
  } catch(e) {
    sbToast('err', e.message);
  } finally {
    if (typeof sbLoading === 'function') sbLoading(false);
  }
}

async function toggleEntregador(id, ativo) {
  try {
    await entApi('/api/entregadores/salvar', {
      method: 'POST',
      body: { id, ativo: ativo ? 1 : 0 }
    });
    await renderEntregas(true);
  } catch(e) {
    sbToast('err', e.message);
  }
}

function entSubscribeSSE() {
  const tid = entTenantId();
  if (!tid || typeof EventSource === 'undefined') return;
  if (entregasState.sse && entregasState.sseTid === tid) return;
  if (entregasState.sse) {
    try { entregasState.sse.close(); } catch {}
    entregasState.sse = null;
  }
  entregasState.sseTid = tid;
  const sse = new EventSource(`/sse/entregas-rt:${tid}`);
  const refresh = () => entScheduleRefresh();
  ['entregadores:INSERT','entregadores:UPDATE','entregadores:DELETE','entregas:INSERT','entregas:UPDATE','entregas:DELETE','rotas_entrega:INSERT','rotas_entrega:UPDATE','rotas_entrega:DELETE'].forEach(ev => {
    sse.addEventListener(ev, refresh);
  });
  sse.onerror = () => {
    try { sse.close(); } catch {}
    if (entregasState.sse === sse) entregasState.sse = null;
    setTimeout(() => {
      const pg = document.getElementById('page-entregas');
      if (pg?.classList.contains('on')) entSubscribeSSE();
    }, 5000);
  };
  entregasState.sse = sse;
}

function entScheduleRefresh() {
  if (entregasState.refreshTimer) return;
  entregasState.refreshTimer = setTimeout(() => {
    entregasState.refreshTimer = null;
    const pg = document.getElementById('page-entregas');
    if (pg?.classList.contains('on')) renderEntregas(true);
  }, 250);
}

window.renderEntregas = renderEntregas;
window.entAppUrl = entAppUrl;
window.entAbrirAppEntregador = entAbrirAppEntregador;
window.openEntregadorModal = openEntregadorModal;
window.saveEntregador = saveEntregador;
window.toggleEntregador = toggleEntregador;
window.entAtribuir = entAtribuir;
window.entSelecionarPedido = entSelecionarPedido;
window.entCriarRotaSelecionados = entCriarRotaSelecionados;
window.entAtualizarStatus = entAtualizarStatus;
window.entConcluirEntrega = entConcluirEntrega;
window.entMarcarProblema = entMarcarProblema;
window.entAtualizarRota = entAtualizarRota;

// ═══════════════════════════════════════════════════════
// CLIENTE REST — ESTIMA FOOD
// ═══════════════════════════════════════════════════════
// URL do servidor de automações — carregada do banco
let WA_SERVER = '';
const sb = window.AppAPI;

// ── Autenticação ──────────────────────────────────────
let _sessao = null;
let _planoAtual = 'pro'; // padrão conservador; atualizado via servidor em _carregarPlano()

// Busca o plano real do tenant no servidor (não depende da sessão salva)
async function _carregarPlano() {
  try {
    const tid = _sessao?.tenant_id;
    if (!tid) return;
    const res = await fetch('/api/tenant-info-gestor', {
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid }
    });
    if (!res.ok) return;
    const data = await res.json();
    const plano = (data?.plano || 'pro').toLowerCase();
    _planoAtual = plano;

    // Atualiza a sessão com o plano correto para futuras verificações
    try {
      const sess = JSON.parse(sessionStorage.getItem('sys_session') || '{}');
      sess.plano = _planoAtual;
      sessionStorage.setItem('sys_session', JSON.stringify(sess));
    } catch(e) {}

    // Atualiza badge do botão Robô na sidebar
    const roboBadge = document.getElementById('sn-robo-badge');
    if (roboBadge) {
      roboBadge.style.display = _planoAtual !== 'premium' ? 'inline-block' : 'none';
    }
  } catch(e) {}
}

function _verificarSessao() {
  try {
    const raw = sessionStorage.getItem('sys_session');
    if (!raw) { window.location.href = 'login.html'; return false; }
    _sessao = JSON.parse(raw);
    if (Date.now() - _sessao.ts > 8 * 60 * 60 * 1000) {
      sessionStorage.removeItem('sys_session');
      window.location.href = 'login.html';
      return false;
    }
    const nome = _sessao.nome || 'Usuário';
    const role = _sessao.role || 'gestor';
    const el_av   = document.getElementById('sidebar-av');
    const el_nome = document.getElementById('sidebar-nome');
    const el_role = document.getElementById('sidebar-role');
    if (el_av)   el_av.textContent   = nome.charAt(0).toUpperCase();
    if (el_nome) el_nome.textContent = nome.split(' ')[0];
    if (el_role) el_role.textContent = role === 'superadmin' ? 'Super Admin' : role === 'admin' ? 'Administrador' : 'Gestor';
    // ── Badge de bloqueio no botão do Robô — atualizado após fetch do plano ──
    return true;
  } catch(e) {
    window.location.href = 'login.html';
    return false;
  }
}

function confirmarLogout() {
  if (confirm('Sair do sistema?')) {
    sessionStorage.removeItem('sys_session');
    window.location.href = 'login.html';
  }
}

if (!_verificarSessao()) { /* redireciona */ }
else { _carregarPlano(); _carregarSegmento(); } // Busca plano e segmento do servidor

// ── Tenant injetado automaticamente pelo api-client.js ────
// O shim lê tenant_id da sessionStorage e envia x-tenant-id em cada request.
// Não precisa mais do proxy manual — sb já funciona com multi-tenant.

// ── Segmento do tenant (restaurante | acougue) ───────────────────────────
let _segmento = 'restaurante';
window._segmento = _segmento;

async function _carregarSegmento() {
  try {
    const tid = _sessao?.tenant_id;
    if (!tid) return;
    const r = await fetch('/api/tenant-segmento', { headers: { 'x-tenant-id': tid } });
    if (!r.ok) return;
    const d = await r.json();
    _segmento = d.segmento || 'restaurante';
    window._segmento = _segmento;
    _adaptarParaSegmento();
  } catch(e) {}
}

function _adaptarParaSegmento() {
  if (_segmento !== 'acougue') return;
  // Adiciona classe no body — CSS oculta tudo com data-hide-acougue
  document.body.classList.add('modo-acougue');
  // Troca labels marcados com data-label-acougue
  document.querySelectorAll('[data-label-acougue]').forEach(el => {
    el.textContent = el.getAttribute('data-label-acougue');
  });
  // Dispara evento para outros módulos
  document.dispatchEvent(new CustomEvent('segmento:acougue'));
}

// ── Loading overlay ──────────────────────────────────
let _sbLoadingTimer = null;
function sbLoading(show) {
  let el = document.getElementById('sb-loading');
  if (!el && show) {
    el = document.createElement('div');
    el.id = 'sb-loading';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(15,17,23,.88);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;font-family:"DM Sans",sans-serif';
    el.innerHTML = `
      <div style="width:38px;height:38px;border:3px solid rgba(59,130,246,.25);border-top-color:var(--accent);border-radius:50%;animation:sb-spin .7s linear infinite"></div>
      <div style="font-size:12.5px;color:var(--muted)">Conectando ao banco de dados...</div>`;
    document.body.appendChild(el);
  }
  if (el) el.style.display = show ? 'flex' : 'none';
  // Timeout de segurança — força fechar após 8s para nunca ficar preso
  if (_sbLoadingTimer) { clearTimeout(_sbLoadingTimer); _sbLoadingTimer = null; }
  if (show) {
    _sbLoadingTimer = setTimeout(() => {
      const e = document.getElementById('sb-loading');
      if (e) e.style.display = 'none';
      _sbLoadingTimer = null;
    }, 8000);
  }
}

// ── Mapper helpers ───────────────────────────────────
function mapItem(i) {
  return {
    id: i.id,
    emoji: i.emoji || '',
    name: i.name,
    cat: i.cat || '',
    catKey: i.cat_key || i.cat || '',
    price: parseFloat(i.price) || 0,
    priceOld: i.price_old ? parseFloat(i.price_old) : undefined,
    promo: !!i.promo,
    status: i.status || 'active',
    days: i.days || [1,1,1,1,1,1,1],
    desc: i.description || '',
    imageUrl: i.image_url || null,
    ingredients: Array.isArray(i.ingredients) ? i.ingredients : [],
    itemType: i.item_type || 'normal',
    allowHalf: !!i.allow_half,
    maxFlavors: i.max_flavors || 1,
    customGroups: Array.isArray(i.custom_groups) ? i.custom_groups : [],
    destaque: !!i.destaque
  };
}

function mapOrder(o) {
  const pixPendente = o.status === 'aguardando_pix' && o.pag === 'pix_manual';
  return {
    id: o.id,
    num: _orderNum(o.id),
    client: o.client || '',
    phone: o.phone || '',
    items: Array.isArray(o.items) ? o.items : [],
    total: parseFloat(o.total) || 0,
    taxa: parseFloat(o.taxa) || 0,
    status: pixPendente ? 'analise' : (o.status || 'analise'),
    _pixPendente: pixPendente,
    _statusReal: o.status || 'analise',
    time: o.created_at || o.time || '',
    created_at: o.created_at || '',
    addr: o.addr || '',
    pag: o.pag || '',
    troco: o.troco != null ? parseFloat(o.troco) : null,
    pag_momento: o.pag_momento || null,
    mesa_num: o.mesa_num || null,
    garcom_id: o.garcom_id || null,
    garcom_nome: o.garcom_nome || ''
  };
}

// ── Load all data ────────────────────────────────────
async function loadAllData(silent = false) {
  console.log('[LOAD] loadAllData chamado | silent:', silent, '| tenant:', _sessao?.tenant_id);
  if (!silent) sbLoading(true);
  try {
    // Run all queries independently so one failure doesn't block others
    const safe = q => q.then(r => r).catch(e => ({ data: null, error: e }));

    const [
      itemsRes, catsRes, ordersRes, movsRes,
      cuponsRes, mesasRes, estoqueRes, fidRes, cfgRes
    ] = await Promise.all([
      safe(sb.from('menu_items').select('*').order('sort_order').order('id')),
      safe(sb.from('categories').select('*').order('sort_order')),
      safe(sb.from('orders').select('*').in('status',['aguardando_pix','analise','producao','pronto']).order('id',{ascending:false})),
      safe(sb.from('movimentos').select('*').gte('created_at', (() => {
        // Usa data local BR (UTC-3) para não perder movimentos do início do dia
        const d = new Date(); d.setHours(d.getHours() - 3);
        return d.toISOString().split('T')[0];
      })()).order('created_at')),
      safe(sb.from('cupons').select('*').order('id')),
      safe(sb.from('mesas').select('*').order('num')),
      safe(sb.from('estoque').select('*').order('id')),
      safe(sb.from('fidelidade').select('*').order('pts',{ascending:false})),
      safe(sb.from('store_config').select('caixa_open,store_open,gestor_tema,order_num_offset').single())
    ]);

    if (itemsRes.data?.length)    items         = itemsRes.data.map(mapItem);
    if (catsRes.data?.length)     categories    = catsRes.data.map(c => ({
      id: c.id, name: c.name, label: c.label || c.name,
      type: c.type||'Itens principais', promo:!!c.promo, open:false
    }));
    if (ordersRes.data?.length)   ordersKanban  = ordersRes.data.map(mapOrder);
    if (movsRes.data?.length)     movimentos    = movsRes.data.map(m => ({
      id: m.id, desc: m.description||'', tipo: m.tipo,
      val: parseFloat(m.val)||0, pag: m.pag||'', time: m.time||''
    }));
    if (cuponsRes.data?.length)   cupons        = cuponsRes.data.map(c => ({
      id:c.id, code:c.code, tipo:c.type||'percent', val:parseFloat(c.value)||0,
      minimo:parseFloat(c.min_order)||0, usos:c.uses_left||-1, ativo:!!c.ativo
    }));
    if (mesasRes.data?.length)    tables        = mesasRes.data.map(t => ({
      id: t.id, num: t.num, status: t.status, guests: t.guests||0,
      total: parseFloat(t.total)||0, pag_forma: t.pag_forma||null,
      opened_at: t.opened_at||null, updated_at: t.updated_at||null
    }));
    if (estoqueRes.data?.length)  estoqueItems  = estoqueRes.data.map(e => ({
      id:e.id, name:e.name, unit:e.unit||'un', qty:parseFloat(e.qty)||0,
      min_qty:parseFloat(e.min_qty)||0, custo:parseFloat(e.cost)||0,
      updated_at:e.updated_at||null
    }));
    if (fidRes.data?.length)      fidClients    = fidRes.data.map(f => ({
      id:f.id, name:f.name, phone:f.phone||'', pts:f.pts||0,
      max:f.max_pts||_fidConfig.meta_pts||500,
      orders:f.orders_count||0, resgates:f.resgates||0
    }));


    // Set orderIdSeq above DB max and init polling tracker
    if (ordersKanban.length) {
      const maxId = Math.max(...ordersKanban.map(o=>o.id));
      orderIdSeq = maxId + 1;
      _maxKnownOrderId = maxId;
    } else {
      // Kanban vazio — inicializa _maxKnownOrderId com o último ID do banco
      // para o polling detectar novos pedidos do cardápio corretamente
      try {
        const { data: lastOrder } = await sb.from('orders').select('id').order('id', {ascending:false}).limit(1);
        if (lastOrder?.[0]?.id) _maxKnownOrderId = Number(lastOrder[0].id);
      } catch(e) {}
    }

    // Aplica estado do caixa e loja
    if (cfgRes.data) {
      _orderNumOffset = parseInt(cfgRes.data.order_num_offset) || 0;

      // ── Auto-corrige offset para tenants novos ──────────────
      // Se offset = 0 e este tenant ainda não tem pedido nenhum,
      // define offset = MAX(id) global para que o 1º pedido seja #1
      if (_orderNumOffset === 0 && ordersKanban.length === 0) {
        try {
          const { data: lastAny } = await sb.from('orders').select('id').order('id', {ascending:false}).limit(1);
          const globalMax = lastAny?.[0]?.id ? Number(lastAny[0].id) : 0;
          // Verifica se este tenant tem algum pedido histórico
          const { data: tenantHist } = await sb.from('orders').select('id').limit(1);
          const temHistorico = tenantHist && tenantHist.length > 0;
          if (!temHistorico && globalMax > 0) {
            await sb.from('store_config').update({ order_num_offset: globalMax }).eq('tenant_id', _sessao.tenant_id);
            _orderNumOffset = globalMax;
          }
        } catch(e) {}
      }
      // ────────────────────────────────────────────────────────

      // Re-mapeia pedidos já carregados com o offset correto
      ordersKanban = ordersKanban.map(o => ({ ...o, num: _orderNum(o.id) }));
      setCaixaState(cfgRes.data.caixa_open !== false);
      const stOpen = cfgRes.data.store_open !== false;
      const st   = document.getElementById('status-txt');
      const dot  = document.getElementById('status-dot');
      const pill = document.getElementById('pill-status');
      if (st)   st.textContent = stOpen ? 'Online' : 'Offline';
      if (dot)  dot.style.background  = stOpen ? 'var(--success)' : 'var(--danger)';
      if (pill) { pill.style.background = stOpen ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)'; pill.style.borderColor = stOpen ? 'rgba(34,197,94,.25)' : 'rgba(239,68,68,.25)'; pill.style.color = stOpen ? 'var(--success)' : 'var(--danger)'; }
      // Aplica tema salvo no banco
      const modoSalvo = cfgRes.data.gestor_tema || 'escuro';
      _aplicarVars(modoSalvo === 'claro' ? MODO_CLARO : MODO_ESCURO);
      if (modoSalvo === 'claro') {
        _aplicarOverrideClaro(MODO_CLARO);
      } else {
        const el = document.getElementById('tema-light-override');
        if (el) el.remove();
      }
    }

    await loadFidConfig();
    if (!_rtConnected) subscribeOrders();
    renderKanban();
    renderCaixa();
    // Sincroniza SW com os dados carregados
    setTimeout(() => _initSwState(), 500);
  } catch(e) {
    console.error('Supabase load error:', e);
    if (!silent) sbToast('err', 'Erro ao conectar ao banco de dados');
  } finally {
    if (!silent) sbLoading(false);
  }
}

function _refreshMesaPageIfActive() {
  const pg = document.getElementById('page-pedidos-mesa');
  if (pg && pg.classList.contains('on')) renderMesasPage();
}

// ── Realtime orders ──────────────────────────────────
function sendBrowserNotif(title, body) {
  // App desktop: usa notificação nativa do Windows (mais profissional)
  if (window.ElectronPrint) {
    window.ElectronPrint.notify(title, body);
    return;
  }
  // Web: notificação do navegador
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '' });
  }
}

let _rtChannels = [];
let _rtConnected = false;
let _swReg       = null;
let _heartbeat   = null;

// ── Service Worker ────────────────────────
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    _swReg = await navigator.serviceWorker.register('./gestor-sw.js', { scope: './' });
    console.log('[SW] gestor registered');

    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'SW_POLL_DONE') {
        // Recarga silenciosa quando SW detectou algo em background
        loadAllData(true);
        if (!_rtConnected) subscribeOrders();
      }
    });

    // Inicia SW assim que o worker estiver pronto
    if (_swReg.active) {
      _initSwState();
    } else {
      _swReg.addEventListener('updatefound', () => {
        const w = _swReg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'activated') _initSwState();
        });
      });
    }
  } catch(e) { console.warn('[SW] register failed', e); }
}

function _initSwState() {
  if (!_swReg?.active) return;
  _swReg.active.postMessage({
    type:         'INIT',
    tenant_id:    _sessao?.tenant_id || null,
    orderIds:     ordersKanban.map(o => o.id),
    mesaOrderIds: mesaOrdersCache.map(o => o.id)
  });
}

function _syncSwState() {
  if (!_swReg?.active) return;
  _swReg.active.postMessage({
    type:         'SYNC',
    tenant_id:    _sessao?.tenant_id || null,
    orderIds:     ordersKanban.map(o => o.id),
    mesaOrderIds: mesaOrdersCache.map(o => o.id)
  });
}

async function requestNotifPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') await Notification.requestPermission();
}

function setRtStatus(ok) {
  _rtConnected = ok;
  const dot = document.getElementById('rt-dot');
  const txt = document.getElementById('rt-txt');
  if (dot) dot.style.background = ok ? 'var(--success)' : 'var(--danger)';
  if (txt) txt.textContent = ok ? 'Ao vivo' : 'Reconectando...';
}

function unsubscribeAll() {
  _rtChannels.forEach(ch => { try { sb.removeChannel(ch); } catch(e){} });
  _rtChannels = [];
  if (_heartbeat) { clearInterval(_heartbeat); _heartbeat = null; }
}

// Cache local dos pedidos de mesa (separado do ordersKanban principal)
let mesaOrdersCache = [];

function _updateMesaOrdersCache(newOrder) {
  const idx = mesaOrdersCache.findIndex(o => o.id === newOrder.id);
  if (idx !== -1) {
    if (['entregue','cancelado'].includes(newOrder.status)) {
      mesaOrdersCache.splice(idx, 1);
    } else {
      mesaOrdersCache[idx] = newOrder;
    }
  } else if (!['entregue','cancelado'].includes(newOrder.status) && newOrder.mesa_num) {
    // Só adiciona ao cache se pertence à sessão atual (opened_at filter)
    const mesa = tables.find(t => t.num === parseInt(newOrder.mesa_num));
    const sessionStart = mesa?.opened_at ? new Date(mesa.opened_at).getTime() - 5000 : 0;
    const orderTime = new Date(newOrder.created_at || Date.now()).getTime();
    if (orderTime >= sessionStart) {
      mesaOrdersCache.unshift(newOrder);
    }
  }
}

function _renderMesaPageFromCache() {
  const pg = document.getElementById('page-pedidos-mesa');
  if (!pg || !pg.classList.contains('on')) return;

  const grid = document.getElementById('pm-mesas-grid');
  if (!grid) return;

  const activeTables = tables.filter(t => t.status !== 'free');

  // Atualiza stats sem piscar
  const elv = (id, v) => { const e = document.getElementById(id); if (e && e.textContent !== String(v)) e.textContent = v; };
  elv('pm-stat-livres',    tables.filter(t => t.status === 'free').length);
  elv('pm-stat-ocupadas',  tables.filter(t => t.status === 'busy').length);
  elv('pm-stat-aguardando',tables.filter(t => t.status === 'waiting').length);

  if (!activeTables.length) {
    grid.innerHTML = '<div style="text-align:center;padding:60px;color:var(--muted);font-size:13px"><div><div style="margin:0 auto 10px;text-align:center"><svg width="40" height="40" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;opacity:.25"><path d="M5 2h6v6a3 3 0 0 1-6 0V2z" stroke="currentColor" stroke-width="1.2"/><path d="M2 2h3M11 2h3M2 5H5M11 5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M8 8v4M5.5 14h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></div><div style="display:none"></div>Nenhuma mesa ocupada no momento</div>';
    return;
  }

  const sessionOrders = mesaOrdersCache.filter(o => {
    const mesa = activeTables.find(t => t.num === parseInt(o.mesa_num));
    if (!mesa || !mesa.opened_at) return true;
    return new Date(o.created_at || 0).getTime() >= new Date(mesa.opened_at).getTime() - 5000;
  });

  // Atualização inteligente: só substitui o card da mesa que mudou
  const sorted = activeTables.sort((a, b) => a.num - b.num);
  const existing = grid.querySelectorAll('[data-mesa-card]');
  const existingNums = new Set([...existing].map(el => parseInt(el.dataset.mesaCard)));
  const activeNums   = new Set(sorted.map(t => t.num));

  // Remove cards de mesas que ficaram livres
  existing.forEach(el => {
    if (!activeNums.has(parseInt(el.dataset.mesaCard))) el.remove();
  });

  sorted.forEach((t, i) => {
    const orders  = sessionOrders.filter(o => parseInt(o.mesa_num) === t.num);
    const newHtml = renderMesaCard(t, orders);
    const cardId  = 'mesa-card-' + t.num;
    let el = document.getElementById(cardId);

    if (!el) {
      // Nova mesa — cria wrapper e insere na posição certa
      el = document.createElement('div');
      el.id = cardId;
      el.dataset.mesaCard = t.num;
      el.style.cssText = 'margin-bottom:0';
      el.innerHTML = newHtml;
      const ref = grid.children[i];
      if (ref) grid.insertBefore(el, ref); else grid.appendChild(el);
    } else {
      // Mesa existente — só atualiza se conteúdo mudou (evita piscar)
      if (el.innerHTML !== newHtml) {
        el.innerHTML = newHtml;
      }
    }
  });
}

function subscribeOrders() {
  unsubscribeAll();

  const chOrders = sb.channel('orders-rt')
    .on('postgres_changes', {event:'INSERT', schema:'public', table:'orders'}, p => {
      // Pedido aguardando cartão não entra no kanban — só após pagamento online confirmado
      // PIX manual entra no kanban na coluna "analise" para o gestor confirmar o recebimento
      if (p.new.status === 'aguardando_cartao') return;
      if (p.new.status === 'aguardando_pix' && p.new.pag !== 'pix_manual') return;
      if (!ordersKanban.find(x => x.id === p.new.id)) {
        // PIX manual aparece na coluna analise com badge próprio
        const _mapped = mapOrder(p.new);
        if (_mapped.status === 'aguardando_pix') _mapped._pixPendente = true;
        ordersKanban.unshift(_mapped);
        if (p.new.id > _maxKnownOrderId) _maxKnownOrderId = p.new.id;
        renderKanban();
        playOrderSound();
        const nc = document.getElementById('notif-count');
        if (nc) { nc.style.display='flex'; nc.textContent = parseInt(nc.textContent||0)+1; }
        const items = Array.isArray(p.new.items) ? p.new.items.map(i=>`${i.qty}x ${i.name}`).join(', ') : '';
        showToast('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M8 2a5 5 0 0 1 5 5v3l1 2H2l1-2V7a5 5 0 0 1 5-5z" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1.4"/></svg>', `Novo pedido #${_orderNum(p.new.id)} — ${p.new.client}`);
        sendBrowserNotif(`Novo pedido #${_orderNum(p.new.id)}`, `${p.new.client} — ${items}`);
        // Automação: mensagem de pedido recebido
        // Auto-aceitar se ativado e pedido em análise
        if (_autoAcceptOn && p.new.status === 'analise') {
          setTimeout(() => advanceOrderById(p.new.id), 800);
        }
        // Auto-impressão se modo automático estiver ativo
        if ((window._printMode || _printMode) === 'auto') printOrder(mapOrder(p.new));
        // Atualiza KDS se estiver aberto
        const kpg = document.getElementById('page-kds');
        if (kpg && kpg.classList.contains('on')) renderKDS();
      }
      // Atualiza cache de mesa e rerenderiza SEM nova query ao banco
      if (p.new.mesa_num) {
        _updateMesaOrdersCache(p.new);
        _renderMesaPageFromCache();
      }
      _syncSwState();
    })
    .on('postgres_changes', {event:'UPDATE', schema:'public', table:'orders'}, p => {
      const idx = ordersKanban.findIndex(x => x.id === p.new.id);
      // Pedido PIX confirmado — entra no kanban agora (online pix_mp/pix ou manual pix_manual)
      if (idx === -1 && p.new.status === 'analise' && (p.new.pag === 'pix_mp' || p.new.pag === 'pix_manual' || p.new.pag === 'pix')) {
        ordersKanban.unshift(mapOrder(p.new));
        renderKanban();
        playOrderSound();
        const nc = document.getElementById('notif-count');
        if (nc) { nc.style.display='flex'; nc.textContent = parseInt(nc.textContent||0)+1; }
        const items = Array.isArray(p.new.items) ? p.new.items.map(i=>`${i.qty}x ${i.name}`).join(', ') : '';
        showToast('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><rect x="1" y="4" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M1 7h14" stroke="currentColor" stroke-width="1.4"/></svg>', `PIX confirmado! Pedido #${_orderNum(p.new.id)} — ${p.new.client}`);
        sendBrowserNotif(`PIX confirmado! #${_orderNum(p.new.id)}`, `${p.new.client} — ${items}`);
        if (_autoAcceptOn) setTimeout(() => advanceOrderById(p.new.id), 800);
        if ((window._printMode || _printMode) === 'auto') printOrder(mapOrder(p.new));
        return;
      }
      if (idx !== -1) {
        if (['entregue','cancelado'].includes(p.new.status)) {
          if (p.new.status === 'cancelado') {
            showToast('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>', `Pedido #${_orderNum(p.new.id)} cancelado pelo cliente — ${p.new.client}`);
            sendBrowserNotif(`Pedido cancelado pelo cliente`, `#${_orderNum(p.new.id)} — ${p.new.client}`);
          }
          ordersKanban.splice(idx, 1);
        } else {
          ordersKanban[idx] = mapOrder(p.new);
        }
        renderKanban();
      }
      if (p.new.mesa_num) {
        _updateMesaOrdersCache(p.new);
        _renderMesaPageFromCache();
      }
      _syncSwState();
      // Atualiza KDS se aberto
      { const kpg = document.getElementById('page-kds'); if (kpg && kpg.classList.contains('on')) renderKDS(); }
    })
    .on('postgres_changes', {event:'DELETE', schema:'public', table:'orders'}, p => {
      ordersKanban = ordersKanban.filter(o => o.id !== p.old.id);
      mesaOrdersCache = mesaOrdersCache.filter(o => o.id !== p.old.id);
      renderKanban();
      _renderMesaPageFromCache();
    })
    .subscribe(status => {
      setRtStatus(status === 'SUBSCRIBED');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setTimeout(() => subscribeOrders(), 3000);
      }
    });

  const chMesas = sb.channel('mesas-rt')
    .on('postgres_changes', {event:'*', schema:'public', table:'mesas'}, () => {
      sb.from('mesas').select('*').order('num').then(({ data }) => {
        if (data) {
          tables = data.map(t => ({
            id: t.id, num: t.num, status: t.status, guests: t.guests||0,
            total: parseFloat(t.total)||0, pag_forma: t.pag_forma||null,
            opened_at: t.opened_at||null, updated_at: t.updated_at||null
          }));
          _renderMesaPageFromCache(); renderQR();
        }
      });
    }).subscribe();

  const chConfig = sb.channel('store-config-rt')
    .on('postgres_changes', {event:'UPDATE', schema:'public', table:'store_config'}, p => {
      const st = document.getElementById('status-txt');
      if (!st) return;
      const open = p.new.store_open;
      st.style.color = open ? 'var(--success)' : 'var(--danger)';
      st.textContent = open ? 'Online' : 'Offline';
    })
    .subscribe();

  // Heartbeat: mantém WS vivo em background (a cada 25s)
  _heartbeat = setInterval(() => {
    try { sb.channel('orders-rt').send({ type:'broadcast', event:'ping', payload:{} }); }
    catch(e){}
  }, 25000);

  _rtChannels = [chOrders, chMesas, chConfig];
}

// Sync ao voltar para a aba
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadAllData(true);
    if (!_rtConnected) subscribeOrders();
  }
});

// Polling de 12s — só re-renderiza se houver mudança real no banco
let _lastPollHash = '';
let _maxKnownOrderId = 0; // rastreia o maior ID visto — para detectar novos pedidos

// ── Polling principal do kanban — roda a cada 5s ───────
// Garante que pedidos do garçom e do cardápio cheguem
// mesmo que o SSE falhe ou tenha problemas de canal
setInterval(async () => {
  if (document.visibilityState !== 'visible') return;

  try {
    // 1. Busca pedidos novos (ID maior que o último conhecido)
    // Roda sempre — incluindo quando _maxKnownOrderId = 0 (ex: gestor abre com kanban vazio
    // e um pedido do cardápio chega antes do SSE estabilizar ou antes do próximo loadAllData)
    {
      const q = sb.from('orders')
        .select('*')
        .in('status', ['aguardando_pix','analise','producao','pronto'])
        .order('id', {ascending:false});
      // Quando _maxKnownOrderId > 0 usa filtro eficiente; quando 0 varre todos os ativos
      if (_maxKnownOrderId > 0) q.gt('id', _maxKnownOrderId);
      const { data: novos } = await q;

      if (novos?.length) {
        let houveMudanca = false;
        for (const o of novos) {
          if (!ordersKanban.find(x => x.id === o.id)) {
            ordersKanban.unshift(mapOrder(o));
            houveMudanca = true;
            // Notifica como novo pedido
            playOrderSound();
            const nc = document.getElementById('notif-count');
            if (nc) { nc.style.display='flex'; nc.textContent = parseInt(nc.textContent||0)+1; }
            const items = Array.isArray(o.items) ? o.items.map(i=>`${i.qty}x ${i.name}`).join(', ') : '';
            showToast('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M8 2a5 5 0 0 1 5 5v3l1 2H2l1-2V7a5 5 0 0 1 5-5z" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1.4"/></svg>', `Novo pedido #${o.num} — ${o.client}`);
            sendBrowserNotif(`Novo pedido #${o.num}`, `${o.client} — ${items}`);
            if (_autoAcceptOn && o.status === 'analise') setTimeout(() => advanceOrderById(o.id), 800);
            if ((window._printMode || _printMode) === 'auto') printOrder(mapOrder(o));
            // Atualiza cache mesa se for pedido de mesa
            if (o.mesa_num) { _updateMesaOrdersCache(o); _renderMesaPageFromCache(); }
          }
          if (o.id > _maxKnownOrderId) _maxKnownOrderId = o.id;
        }
        if (houveMudanca) renderKanban();
      }
    }

    // 2. Verifica mudanças de status nos pedidos já no kanban
    if (ordersKanban.length) {
      const ids = ordersKanban.map(o => o.id);
      const { data: atuais } = await sb.from('orders')
        .select('id,status')
        .in('id', ids.slice(0, 50)); // limita para não sobrecarregar

      if (atuais?.length) {
        let houveMudanca = false;
        for (const a of atuais) {
          const idx = ordersKanban.findIndex(x => x.id === a.id);
          if (idx !== -1) {
            // Usa _statusReal para comparar — pedidos pix_manual têm status='analise' no kanban
            // mas 'aguardando_pix' no banco, então não devem ser removidos por isso
            const statusNoCanban = ordersKanban[idx]._statusReal || ordersKanban[idx].status;
            if (statusNoCanban !== a.status) {
              if (['entregue','cancelado'].includes(a.status)) {
                ordersKanban.splice(idx, 1);
              } else if (a.status === 'aguardando_pix') {
                // continua como analise no kanban — é pix_manual pendente
              } else {
                ordersKanban[idx].status   = a.status;
                ordersKanban[idx]._statusReal = a.status;
                ordersKanban[idx]._pixPendente = false;
              }
              houveMudanca = true;
            }
          }
        }
        if (houveMudanca) renderKanban();
      }
    }

    // 3. Polling de mesas (página de mesas aberta)
    const pg = document.getElementById('page-pedidos-mesa');
    if (pg?.classList.contains('on')) {
      const { data } = await sb.from('orders')
        .select('id,status,mesa_num')
        .not('mesa_num', 'is', null)
        .in('status', ['analise','producao','pronto'])
        .order('id');
      const hash = JSON.stringify((data||[]).map(o => o.id + o.status));
      if (hash !== _lastPollHash) {
        _lastPollHash = hash;
        renderMesasPage();
      }
    }

    // 4. Reconecta SSE se perdeu conexão
    if (!_rtConnected) subscribeOrders();

  } catch(e) { /* polling silencioso */ }
}, 5000);

// Registra SW e pede permissão de notificação ao carregar
requestNotifPermission();
registerSW();

// ── Generic toast for Supabase ops ───────────────────
const _ICON_OK  = `<svg width='13' height='13' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'><circle cx='8' cy='8' r='6' stroke='currentColor' stroke-width='1.4'/><path d='M5.5 8l2 2 3-3' stroke='currentColor' stroke-width='1.4' stroke-linecap='round'/></svg>`;
const _ICON_ERR = `<svg width='13' height='13' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'><path d='M8 2L14 13H2L8 2z' stroke='currentColor' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/><path d='M8 6v3' stroke='currentColor' stroke-width='1.4' stroke-linecap='round'/><circle cx='8' cy='11' r='.6' fill='currentColor'/></svg>`;
const _ICON_SAV = `<svg width='13' height='13' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'><path d='M3 2h8l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z' stroke='currentColor' stroke-width='1.4'/><path d='M5 2v5h6V2' stroke='currentColor' stroke-width='1.4' stroke-linecap='round'/></svg>`;
const _ICON_TRS = `<svg width='13' height='13' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'><path d='M3 4h10M6 4V2.5A.5 0 0 1 6.5 2h3a.5 0 0 1 .5.5V4M5 4l.7 9.5a.5 0 0 0 .5.5h3.6a.5 0 0 0 .5-.5L11 4' stroke='currentColor' stroke-width='1.4' stroke-linecap='round'/></svg>`;
const _ICON_IMG = `<svg width='13' height='13' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'><rect x='2' y='3' width='12' height='10' rx='1.5' stroke='currentColor' stroke-width='1.4'/><circle cx='6' cy='7' r='1.5' stroke='currentColor' stroke-width='1.4'/><path d='M2 11l3.5-3.5 2 2 3-4 3.5 5.5' stroke='currentColor' stroke-width='1.4' stroke-linecap='round'/></svg>`;

function sbToast(type, msg) {
  showToast(type === 'ok' ? _ICON_OK : _ICON_ERR, msg);
}

// ── Bloqueio de recurso por plano ─────────────────────
function _toastUpgradePlano() {
  // Remove modal anterior se existir
  const existing = document.getElementById('upgrade-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'upgrade-modal-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    background:rgba(0,0,0,.65);
    backdrop-filter:blur(6px);
    display:flex;align-items:center;justify-content:center;
    animation:fadeInBg .2s ease;
  `;

  overlay.innerHTML = `
    <div style="
      background:linear-gradient(145deg,#1a1d2b,#1e2235);
      border:1px solid rgba(139,92,246,.35);
      border-radius:20px;
      padding:36px 32px;
      width:380px;max-width:92vw;
      box-shadow:0 32px 80px rgba(0,0,0,.7),0 0 0 1px rgba(139,92,246,.15),inset 0 1px 0 rgba(255,255,255,.06);
      animation:slideUpModal .28s cubic-bezier(.34,1.56,.64,1);
      text-align:center;
      position:relative;
    ">
      <!-- Ícone glow -->
      <div style="
        width:72px;height:72px;border-radius:20px;
        background:linear-gradient(135deg,#7c3aed,#4f46e5);
        display:flex;align-items:center;justify-content:center;
        font-size:34px;margin:0 auto 20px;
        box-shadow:0 8px 28px rgba(124,58,237,.45);
      "><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l2 5h5l-4 3 1.5 5L8 11l-4.5 3L5 9 1 6h5z"/></svg></div>

      <!-- Título -->
      <div style="font-family:'Playfair Display',sans-serif;font-size:20px;font-weight:800;margin-bottom:8px;letter-spacing:-.3px;">
        Recurso exclusivo Premium
      </div>
      <div style="font-size:13px;color:rgba(255,255,255,.55);margin-bottom:24px;line-height:1.6;">
        O <strong style="color:rgba(255,255,255,.85)">Robô IA</strong> está disponível apenas no plano<br>
        <strong style="color:#a78bfa">Premium</strong>. Faça upgrade para automatizar<br>
        seus atendimentos via WhatsApp.
      </div>

      <!-- Comparativo -->
      <div style="
        display:grid;grid-template-columns:1fr 1fr;gap:10px;
        margin-bottom:24px;
      ">
        <div style="
          background:rgba(255,255,255,.04);
          border:1px solid rgba(255,255,255,.08);
          border-radius:12px;padding:14px 12px;
        ">
          <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.35);letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px;">Plano Pro</div>
          <div style="font-size:12px;color:rgba(255,255,255,.5);line-height:1.8;">
            Pedidos<br>
            Cardápio<br>
            Mesas & PDV<br>
            <span style="opacity:.4">Robô WhatsApp</span>
          </div>
        </div>
        <div style="
          background:linear-gradient(135deg,rgba(124,58,237,.12),rgba(79,70,229,.08));
          border:1px solid rgba(139,92,246,.3);
          border-radius:12px;padding:14px 12px;
          position:relative;overflow:hidden;
        ">
          <div style="
            position:absolute;top:8px;right:8px;
            background:linear-gradient(135deg,#7c3aed,#4f46e5);
            font-size:9px;font-weight:800;color:#fff;
            padding:2px 7px;border-radius:99px;letter-spacing:.4px;
          ">ATUAL</div>
          <div style="font-size:11px;font-weight:700;color:#a78bfa;letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px;">⭐ Premium</div>
          <div style="font-size:12px;color:rgba(255,255,255,.7);line-height:1.8;">
            Pedidos<br>
            Cardápio<br>
            Mesas & PDV<br>
            <strong style="color:#a78bfa">Robô WhatsApp</strong>
          </div>
        </div>
      </div>

      <!-- Botões -->
      <button onclick="
        document.getElementById('upgrade-modal-overlay').remove();
        window.open('https://wa.me/5585989042222?text=Quero+fazer+upgrade+para+o+plano+Premium','_blank');
      " style="
        width:100%;padding:13px;border-radius:11px;border:none;cursor:pointer;
        background:linear-gradient(135deg,#7c3aed,#4f46e5);
        color:#fff;font-family:'Playfair Display',sans-serif;font-size:14px;font-weight:800;
        box-shadow:0 6px 20px rgba(124,58,237,.45);
        transition:transform .15s,box-shadow .15s;
        margin-bottom:10px;
        letter-spacing:-.2px;
      "
      onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 10px 28px rgba(124,58,237,.6)'"
      onmouseout="this.style.transform='';this.style.boxShadow='0 6px 20px rgba(124,58,237,.45)'"
      >
        Fazer Upgrade para Premium
      </button>
      <button onclick="document.getElementById('upgrade-modal-overlay').remove()" style="
        width:100%;padding:10px;border-radius:11px;border:1px solid rgba(255,255,255,.1);
        background:transparent;color:rgba(255,255,255,.45);
        font-family:'DM Sans',sans-serif;font-size:13px;cursor:pointer;
        transition:all .15s;
      "
      onmouseover="this.style.color='rgba(255,255,255,.7)';this.style.borderColor='rgba(255,255,255,.2)'"
      onmouseout="this.style.color='rgba(255,255,255,.45)';this.style.borderColor='rgba(255,255,255,.1)'"
      >
        Agora não
      </button>
    </div>
  `;

  // Fechar ao clicar fora
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Adiciona animações CSS se ainda não existirem
  if (!document.getElementById('upgrade-modal-styles')) {
    const style = document.createElement('style');
    style.id = 'upgrade-modal-styles';
    style.textContent = `
      @keyframes fadeInBg { from{opacity:0} to{opacity:1} }
      @keyframes slideUpModal { from{opacity:0;transform:translateY(24px) scale(.95)} to{opacity:1;transform:none} }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(overlay);
}


// ── Image upload (Supabase Storage) ──────────────────
// ── New item image preview ────────────────────
let _newItemImageFile = null;
function triggerNewItemImage() {
  document.getElementById('new-img-input').click();
}
function previewNewItemImage(inp) {
  const file = inp.files[0];
  if (!file) return;
  _newItemImageFile = file;
  const url = URL.createObjectURL(file);
  const thumb = document.getElementById('new-img-thumb');
  thumb.src = url; thumb.style.display = 'block';
  document.getElementById('new-img-placeholder').style.display = 'none';
  document.getElementById('new-img-change').style.display = 'block';
  document.getElementById('new-img-preview').style.border = '2px solid var(--accent)';
}

// ── Edit item image preview ────────────────────
let _editItemImageFile = null;
function triggerEditItemImage() {
  document.getElementById('edit-img-input').click();
}
function previewEditItemImage(inp) {
  const file = inp.files[0];
  if (!file) return;
  _editItemImageFile = file;
  const url = URL.createObjectURL(file);
  const thumb = document.getElementById('edit-img-thumb');
  thumb.src = url; thumb.style.display = 'block';
  document.getElementById('edit-img-placeholder').style.display = 'none';
  document.getElementById('edit-img-change').style.display = 'block';
  document.getElementById('edit-img-preview').style.border = '2px solid var(--accent)';
}

// ── Upload image to Supabase Storage ─────────
async function uploadItemImage(file, itemId) {
  const ext  = file.name.split('.').pop();
  const path = `item-${itemId || Date.now()}-${Date.now()}.${ext}`;
  const { error } = await sb.storage.from('menu-images').upload(path, file, { upsert: true });
  if (error) throw error;
  const { data: { publicUrl } } = sb.storage.from('menu-images').getPublicUrl(path);
  return publicUrl;
}

function triggerImageUpload(itemId, itemName) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/jpeg,image/jpg,image/png,image/webp';
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.click();
  inp.onchange = async () => {
    const file = inp.files[0];
    if (!file) return;
    document.body.removeChild(inp);
    sbLoading(true);
    try {
      const publicUrl = await uploadItemImage(file, itemId);
      if (itemId) {
        await sb.from('menu_items').update({image_url: publicUrl}).eq('id', itemId);
        const it = items.find(i => i.id === itemId);
        if (it) it.imageUrl = publicUrl;
        renderImagens(); renderGestor();
      }
      sbToast('ok', `Foto de ${itemName} atualizada!`);
    } catch(e) {
      sbToast('err', 'Erro ao enviar imagem');
    } finally { sbLoading(false); }
  };
}

// ═══════════════════════════════════════════════════════
// SUPABASE — CRUD OVERRIDES
// ═══════════════════════════════════════════════════════

// ── addItem ──────────────────────────────────────────

// ── saveEditItem ─────────────────────────────────────

// ── deleteItem ───────────────────────────────────────

// ── addCategory ──────────────────────────────────────

// ── createOrder ──────────────────────────────────────

// ── advanceOrderById ─────────────────────────────────
async function advanceOrderById(id) {
  const o = ordersKanban.find(x => x.id === id);
  if (!o) return;
  if (o.status === 'aguardando_pix') {
    sbToast('err', 'Use o botão "Confirmar Pago PIX" para este pedido.');
    return;
  }
  const newStatus = o.status === 'analise' ? 'producao' : 'pronto';
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: newStatus, tenant_id: _sessao?.tenant_id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');
    o.status = newStatus;
  } catch(e) {
    sbToast('err', 'Erro ao avançar pedido: ' + e.message); return;
  }
  playOrderSound();
  renderKanban();
  sbToast('ok', `Pedido #${_orderNum(id)} avançado!`);
}

// ── cancelOrderById ──────────────────────────────────
async function cancelOrderById(id) {
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'cancelado', tenant_id: _sessao?.tenant_id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');
    ordersKanban = ordersKanban.filter(x => x.id !== id);
  } catch(e) {
    sbToast('err', 'Erro ao cancelar pedido: ' + e.message); return;
  }
  renderKanban();
  showToast(_ICON_TRS, `Pedido #${_orderNum(id)} cancelado`);
}

// ── finishOrderById ──────────────────────────────────
async function finishOrderById(id) {
  const o = ordersKanban.find(x => x.id === id);
  const time = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  sbLoading(true);
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'finalizado', tenant_id: _sessao?.tenant_id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');
    // Registra movimento financeiro
    if (o) {
      await sb.from('movimentos').insert({
        description: `Pedido #${o.num} – ${o.client}`,
        tipo: 'entrada', val: o.total + o.taxa, pag: o.pag || 'PIX', time
      });
      movimentos.push({ desc:`Pedido #${o.num} – ${o.client}`, tipo:'entrada', val:o.total+o.taxa, pag:o.pag||'PIX', time });
    }
    ordersKanban = ordersKanban.filter(x => x.id !== id);
    // BUG 1 fix: adiciona pontos de fidelidade ao finalizar
    if (o?.phone) _autoAddFidPoints(o.phone, o.total + o.taxa);
  } catch(e) {
    sbLoading(false);
    sbToast('err', 'Erro ao finalizar pedido: ' + e.message); return;
  }
  sbLoading(false);
  renderKanban();
  sbToast('ok', `Pedido #${_orderNum(id)} finalizado!`);
}

// ── confirmarPagamentoPix (PIX manual) ──────────────
async function confirmarPagamentoPix(id) {
  const o = ordersKanban.find(x => x.id === id);
  if (!o) return;
  if (!confirm(`Confirmar que o pagamento PIX do pedido #${o.num} foi recebido?`)) return;
  sbLoading(true);
  try {
    // Usa /api/order-status para mover para analise — isso dispara WA de confirmação ao cliente
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'analise', tenant_id: _sessao?.tenant_id })
    });
    if (!res.ok) throw new Error('Erro');
    if (o) {
      o.status      = 'analise';
      o._statusReal = 'analise';
      o._pixPendente = false;
      o.pag         = 'pix_mp'; // marca como pago para o badge mudar para PAGO PIX
    }
    renderKanban();
    sbToast('ok', `Pagamento PIX do pedido #${o.num} confirmado! Cliente será notificado.`);
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
  sbLoading(false);
}

// ══════════════════════════════════════════════════════════
// AÇOUGUE — Ajuste de peso disponível
// ══════════════════════════════════════════════════════════

let _ajustePesoOrderId = null;
let _ajustePesoItens   = []; // [{idx, name, obs, pesoOriginal, precoKg}]

function _parsePesoObs(obs) {
  // Extrai peso do obs. Formato: "500g Contra-filé · ..."
  const m = (obs || '').match(/(\d+)\s*g/i);
  return m ? parseInt(m[1]) : 0;
}

function _calcPrecoKg(price, pesoGramas) {
  // price já é o valor total (preço/kg * peso/1000)
  // então precoKg = price / (pesoGramas/1000)
  if (!pesoGramas) return 0;
  return price / (pesoGramas / 1000);
}

function abrirModalAjustePeso(orderId) {
  const o = ordersKanban.find(x => x.id === orderId);
  if (!o) return;
  _ajustePesoOrderId = orderId;

  // Filtra itens de kg (obs tem formato "NNNg NomeCorte")
  const itensKg = (o.items || []).filter(i =>
    i.item_type === 'kg' || (i.obs && /\d+g\s/.test(i.obs))
  );

  if (!itensKg.length) { sbToast('err', 'Nenhum item de peso neste pedido.'); return; }

  _ajustePesoItens = itensKg.map((i, idx) => {
    const pesoOriginal = _parsePesoObs(i.obs);
    const precoKg      = pesoOriginal > 0 ? _calcPrecoKg(parseFloat(i.price), pesoOriginal) : parseFloat(i.price);
    return { idx, name: i.name, obs: i.obs || '', pesoOriginal, precoKg, price: parseFloat(i.price) };
  });

  const wrap = document.getElementById('ajuste-peso-itens');
  if (!wrap) return;

  wrap.innerHTML = _ajustePesoItens.map((it, i) => `
    <div style="background:var(--surface2);border-radius:12px;padding:14px;border:1px solid var(--border)">
      <div style="font-weight:700;font-size:13.5px;margin-bottom:4px">${it.name}</div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px">${it.obs}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end">
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Peso solicitado</div>
          <div style="font-size:15px;font-weight:700;color:var(--accent)">${it.pesoOriginal}g</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Peso disponível (g)</div>
          <input type="number" id="ajuste-peso-${i}" min="1" max="${it.pesoOriginal}"
            value="${it.pesoOriginal}"
            oninput="atualizarPreviewAjuste(${i})"
            style="width:100%;padding:8px 10px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);font-size:14px;font-weight:700;font-family:inherit">
        </div>
      </div>
      <div id="ajuste-preview-${i}" style="font-size:12px;color:var(--muted);margin-top:8px">
        Valor: <strong>R$ ${it.price.toFixed(2).replace('.',',')}</strong>
      </div>
    </div>
  `).join('');

  const modal = document.getElementById('modal-ajuste-peso-bg');
  if (modal) modal.style.display = 'flex';
}

function atualizarPreviewAjuste(i) {
  const it  = _ajustePesoItens[i];
  if (!it) return;
  const el  = document.getElementById(`ajuste-peso-${i}`);
  const prev = document.getElementById(`ajuste-preview-${i}`);
  if (!el || !prev) return;
  const novoPeso = parseInt(el.value) || 0;
  const novoVal  = it.precoKg * (novoPeso / 1000);
  prev.innerHTML = `Novo valor: <strong style="color:var(--success)">R$ ${novoVal.toFixed(2).replace('.',',')}</strong>`;
}

function fecharModalAjustePeso() {
  const modal = document.getElementById('modal-ajuste-peso-bg');
  if (modal) modal.style.display = 'none';
  _ajustePesoOrderId = null;
  _ajustePesoItens   = [];
}

async function enviarAjustePeso() {
  if (!_ajustePesoOrderId) return;
  const o = ordersKanban.find(x => x.id === _ajustePesoOrderId);
  if (!o?.phone) { sbToast('err', 'Pedido sem telefone cadastrado.'); return; }

  // Monta proposta com novos pesos/valores
  const propostas = _ajustePesoItens.map((it, i) => {
    const el       = document.getElementById(`ajuste-peso-${i}`);
    const novoPeso = parseInt(el?.value) || it.pesoOriginal;
    const novoVal  = it.precoKg * (novoPeso / 1000);
    return { ...it, novoPeso, novoVal };
  }).filter(p => p.novoPeso !== p.pesoOriginal); // só os que mudaram

  if (!propostas.length) { sbToast('err', 'Nenhum peso foi alterado.'); return; }

  // Monta mensagem WA com nome da loja
  const idStr = String(_orderNum(_ajustePesoOrderId)).padStart(3,'0');
  let nomeLoja = 'Açougue';
  try {
    const cfgR = await fetch('/api/tenant-info-gestor', { headers: { 'Content-Type':'application/json', 'x-tenant-id': _sessao?.tenant_id } });
    if (cfgR.ok) { const d = await cfgR.json(); nomeLoja = d.nome || nomeLoja; }
  } catch(e) {}
  let msg = `🏪 *${nomeLoja}*\n${'─'.repeat(20)}\n\n⚖️ *Ajuste de peso — Pedido #${idStr}*\n\nOlá, *${o.client}*!\n\nAo separar seu pedido, verificamos que não temos a quantidade solicitada:\n\n`;
  propostas.forEach(p => {
    msg += `🥩 *${p.name}*\n`;
    msg += `   • Solicitado: ${p.pesoOriginal}g — R$ ${p.price.toFixed(2).replace('.',',')}\n`;
    msg += `   • Disponível: *${p.novoPeso}g — R$ ${p.novoVal.toFixed(2).replace('.',',')}*\n\n`;
  });
  msg += `Você aceita o ajuste?\n\n✅ Responda *SIM* para confirmar\n❌ Responda *NÃO* para cancelar o pedido\n\n_Dúvidas? É só responder esta mensagem!_ 😊`;

  sbLoading(true);
  try {
    // Usa o proxy EVO para enviar (mesmo mecanismo do robô)
    const phone  = (o.phone || '').replace(/\D/g,'');
    const number = phone.startsWith('55') ? phone : '55' + phone;
    const r = await EVO.sendText(number, msg);
    if (!r.ok) throw new Error('Erro ao enviar mensagem WA');

    // Salva proposta pendente no estado do pedido
    const idx = ordersKanban.findIndex(x => x.id === _ajustePesoOrderId);
    if (idx !== -1) {
      ordersKanban[idx]._ajustePendente = propostas;
      ordersKanban[idx]._ajustePesoOrderId = _ajustePesoOrderId;
    }

    sbToast('ok', 'Proposta enviada ao cliente via WhatsApp!');
    fecharModalAjustePeso();
    renderKanban();
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
  sbLoading(false);
}

// ── Modal de resposta WA ──────────────────────────────────
let _respostaWAOrderId = null;

function abrirRespostaWA(orderId) {
  const o = ordersKanban.find(x => x.id === orderId);
  if (!o) return;
  _respostaWAOrderId = orderId;

  const prev = document.getElementById('modal-wa-msg-preview');
  if (prev) prev.textContent = o._waRespostaTxt || '(mensagem não disponível)';

  const modal = document.getElementById('modal-resposta-wa-bg');
  if (modal) modal.style.display = 'flex';
}

function fecharRespostaWA() {
  const modal = document.getElementById('modal-resposta-wa-bg');
  if (modal) modal.style.display = 'none';
  _respostaWAOrderId = null;
}

async function clienteAceitouAjuste() {
  if (!_respostaWAOrderId) return;
  const o   = ordersKanban.find(x => x.id === _respostaWAOrderId);
  const idx = ordersKanban.findIndex(x => x.id === _respostaWAOrderId);
  if (!o || idx === -1) return;

  const propostas = o._ajustePendente || [];
  if (!propostas.length) {
    // Sem proposta de peso — só limpa a notificação e avança
    if (o) { o._waResposta = false; o._waRespostaTxt = null; }
    fecharRespostaWA(); renderKanban(); return;
  }

  sbLoading(true);
  try {
    // Atualiza itens do pedido com novos pesos/valores
    // Usa name + obs para encontrar o item correto (idx era do array filtrado, não do completo)
    const novosItens = (o.items || []).map(item => {
      const proposta = propostas.find(p =>
        p.name === item.name &&
        (item.obs || '').includes(String(p.pesoOriginal) + 'g')
      );
      if (!proposta) return item;
      const novaObs = (item.obs || '').replace(/\d+g/, `${proposta.novoPeso}g`);
      return { ...item, price: proposta.novoVal, obs: novaObs };
    });

    // Recalcula total corretamente (price já é o valor total do item, qty geralmente 1 para kg)
    const novoTotal = novosItens.reduce((s, i) => s + parseFloat(i.price || 0) * (i.qty || 1), 0);

    const r = await fetch(`/api/orders?id=eq.${_respostaWAOrderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': _sessao?.tenant_id },
      body: JSON.stringify({ items: novosItens, total: novoTotal })
    });
    if (!r.ok) throw new Error('Erro ao atualizar pedido');

    ordersKanban[idx] = { ...o, items: novosItens, total: novoTotal, _waResposta: false, _waRespostaTxt: null, _ajustePendente: null };
    sbToast('ok', `Pedido #${_orderNum(_respostaWAOrderId)} atualizado! Novo total: R$ ${novoTotal.toFixed(2).replace('.',',')}`);
    fecharRespostaWA(); renderKanban();
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
  sbLoading(false);
}

async function clienteRecusouAjuste() {
  if (!_respostaWAOrderId) return;
  if (!confirm('Cancelar o pedido?')) return;
  await cancelOrderById(_respostaWAOrderId);
  fecharRespostaWA();
}

function waOpenFromOrder() {
  if (!_respostaWAOrderId) return;
  const o = ordersKanban.find(x => x.id === _respostaWAOrderId);
  if (!o?.phone) return;
  fecharRespostaWA();
  // Abre o WA Chat direto na conversa do cliente
  const phone = o.phone.replace(/\D/g,'');
  const jid   = (phone.startsWith('55') ? phone : '55' + phone) + '@s.whatsapp.net';
  // Navega para aba WA e abre a conversa
  if (typeof nav === 'function') nav('robo');
  setTimeout(() => {
    if (typeof waOpenConv === 'function') waOpenConv(jid, o.client);
    if (typeof WA !== 'undefined') WA.open = true;
  }, 300);
}

// ── Hook: detecta resposta WA do cliente em pedidos pendentes ──────────
function _verificarRespostaWACliente(msg) {
  if (!msg?.key || msg.key.fromMe === true || msg.key.fromMe === 'true') return;
  const jid   = msg.key.remoteJid || '';
  const phone = jid.replace('@s.whatsapp.net','').replace(/\D/g,'');
  if (!phone) return;

  // Procura pedido no kanban com esse telefone que tem ajuste pendente
  ordersKanban.forEach((o, idx) => {
    const orderPhone = (o.phone || '').replace(/\D/g,'');
    const match = phone.endsWith(orderPhone) || orderPhone.endsWith(phone);
    if (!match) return;

    // Só notifica se há ajuste pendente OU se é açougue (qualquer resposta é relevante)
    if (!o._ajustePendente && window._segmento !== 'acougue') return;

    const texto = _waExtractText(msg);
    if (!texto) return;

    ordersKanban[idx]._waResposta    = true;
    ordersKanban[idx]._waRespostaTxt = texto;
    renderKanban();
    sbToast('ok', `💬 #${_orderNum(o.id)} — ${o.client} respondeu no WhatsApp!`);
  });
}

function _waExtractText(msg) {
  const m = msg?.message;
  if (!m) return '';
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || '';
}

// ── addMovimento (quick register) ────────────────────

// ── addMovimentoModal ────────────────────────────────

// ── addCupom ─────────────────────────────────────────

// ── deleteCupom ──────────────────────────────────────

// ── addTable ─────────────────────────────────────────

// ── toggleMesaStatus ─────────────────────────────────

// ── saveAll (edição em massa) ─────────────────────────

// ── updatePrice + cycleStatus sync ───────────────────

// ── finalizeSale with Supabase ────────────────────────

// ── renderImagens with real photos ────────────────────

// ─────────────────────────────────────────
// DATA
// ─────────────────────────────────────────
const DAYS=['D','S','T','Q','Q','S','S'];
const DAYS_FULL=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const STATUS_CYCLE=[['sta','Disponível'],['ste','Esgotado'],['stp','Pausado']];
const EMOJIS_PLAIN = [
  '🍔','🌭','🍟','🍕','🥪','🌮','🌯','🥙','🧆','🍿',
  '🍗','🍖','🥩','🥚','🍳','🥓','🍝','🍜','🍲','🍛',
  '🥗','🥘','🫕','🥫','🧇','🥞','🧈','🍞','🥐','🥖',
  '🧀','🥨','🍰','🎂','🍮','🍯','🍩','🍪','🍫','🍬',
  '🍭','🍦','🍧','🍨','🍱','🍣','🍤','🦐','🦑','🥤',
  '🧃','🍵','☕','🧋','🥛','🍺','🍷','🧉','🍹','🍸',
  '🍉','🍓','🍇','🍒','🍑','🥭','🍍','🥝','🍋','🍌'
];
const EMOJIS = EMOJIS_PLAIN;
const BOT_ANSWERS={
  'cardapio':'Aqui está nosso cardápio! Cachorrão R$8, X-Burguer R$12, Batata Frita R$9, Coca lata R$5, Suco R$6. O que deseja pedir?',
  'taxa':'A taxa de entrega é R$5,00 para toda a área. ',
  'horario':'Atendemos das 08:00 às 22:00 de segunda a sábado. ',
  'horário':'Atendemos das 08:00 às 22:00 de segunda a sábado. ',
  'pix':'Nossa chave PIX: estima@food.com.br ',
  'oi':'Olá! Bem-vindo ao Estima Food! Como posso ajudar? Digite *cardapio*, *taxa*, *horario* ou *pedido*.',
  'olá':'Olá! Bem-vindo ao Estima Food! ',
  'ola':'Olá! Posso ajudar?',
  'pedido':'Que ótimo! Por favor, informe o endereço e os itens desejados.',
  'obrigado':'De nada! Volte sempre! ',
  'tchau':'Até logo! Obrigado pela preferência! ',
};

let editingId=null, garcomCart=[], garcomMesa='';

// ── Todos os dados vêm exclusivamente do Supabase ──────────
let items        = [];
let categories   = [];
let ordersKanban = [];
let _orderNumOffset = 0;   // offset salvo em store_config; #exibido = id - offset
function _orderNum(id) { return Math.max(1, id - _orderNumOffset); }
let orderIdSeq   = 1;
let tables       = [];
let fidClients   = [];
let cliData      = [];  // customers carregados
let _cliTab      = 'todos';
let estoqueItems = [];
let cartItems    = [];
let filters      = {search:'', cat:'', status:''};
let chatInitialized = false;
let cupons       = [];
let movimentos   = [];

// ─────────────────────────────────────────

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
else { _carregarPlano(); } // Busca plano real do servidor (ignora cache da sessão)

// ── Tenant injetado automaticamente pelo api-client.js ────
// O shim lê tenant_id da sessionStorage e envia x-tenant-id em cada request.
// Não precisa mais do proxy manual — sb já funciona com multi-tenant.

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
    maxFlavors: i.max_flavors || 1
  };
}

function mapOrder(o) {
  return {
    id: o.id,
    num: _orderNum(o.id),
    client: o.client || '',
    phone: o.phone || '',
    items: Array.isArray(o.items) ? o.items : [],
    total: parseFloat(o.total) || 0,
    taxa: parseFloat(o.taxa) || 0,
    status: o.status || 'analise',
    time: o.created_at || o.time || '',
    created_at: o.created_at || '',
    addr: o.addr || '',
    pag: o.pag || '',
    mesa_num: o.mesa_num || null,
    garcom_id: o.garcom_id || null,
    garcom_nome: o.garcom_nome || ''
  };
}

// ── Load all data ────────────────────────────────────
async function loadAllData(silent = false) {
  if (!silent) sbLoading(true);
  try {
    // Run all queries independently so one failure doesn't block others
    const safe = q => q.then(r => r).catch(e => ({ data: null, error: e }));

    const [
      itemsRes, catsRes, ordersRes, movsRes,
      cuponsRes, mesasRes, estoqueRes, fidRes, cfgRes, customersRes
    ] = await Promise.all([
      safe(sb.from('menu_items').select('*').order('id')),
      safe(sb.from('categories').select('*').order('sort_order')),
      safe(sb.from('orders').select('*').in('status',['analise','producao','pronto']).order('id',{ascending:false})),
      safe(sb.from('movimentos').select('*').gte('created_at', new Date().toISOString().split('T')[0]).order('created_at')),
      safe(sb.from('cupons').select('*').order('id')),
      safe(sb.from('mesas').select('*').order('num')),
      safe(sb.from('estoque').select('*').order('id')),
      safe(sb.from('fidelidade').select('*').order('pts',{ascending:false})),
      safe(sb.from('store_config').select('caixa_open,store_open,gestor_tema,order_num_offset').single()),
      safe(sb.from('customers').select('*').order('id',{ascending:false}))
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
    if (customersRes.data?.length) customersData = customersRes.data;


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
    grid.innerHTML = '<div style="text-align:center;padding:60px;color:var(--muted);font-size:13px"><div style="font-size:40px;margin-bottom:12px">🍽️</div>Nenhuma mesa ocupada no momento</div>';
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
      if (!ordersKanban.find(x => x.id === p.new.id)) {
        ordersKanban.unshift(mapOrder(p.new));
        if (p.new.id > _maxKnownOrderId) _maxKnownOrderId = p.new.id;
        renderKanban();
        playOrderSound();
        const nc = document.getElementById('notif-count');
        if (nc) { nc.style.display='flex'; nc.textContent = parseInt(nc.textContent||0)+1; }
        const items = Array.isArray(p.new.items) ? p.new.items.map(i=>`${i.qty}x ${i.name}`).join(', ') : '';
        showToast('🛎️', `Novo pedido #${_orderNum(p.new.id)} — ${p.new.client}`);
        sendBrowserNotif(`🛎️ Novo pedido #${_orderNum(p.new.id)}`, `${p.new.client} — ${items}`);
        // Auto-aceitar se ativado e pedido em análise
        if (_autoAcceptOn && p.new.status === 'analise') {
          setTimeout(() => advanceOrderById(p.new.id), 800);
        }
        // Auto-impressão se modo automático estiver ativo
        if (_printMode === 'auto') printOrder(mapOrder(p.new));
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
      if (idx !== -1) {
        if (['entregue','cancelado'].includes(p.new.status)) {
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
        .in('status', ['analise','producao','pronto'])
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
            showToast('🛎️', `Novo pedido #${o.num} — ${o.client}`);
            sendBrowserNotif(`🛎️ Novo pedido #${o.num}`, `${o.client} — ${items}`);
            if (_autoAcceptOn && o.status === 'analise') setTimeout(() => advanceOrderById(o.id), 800);
            if (_printMode === 'auto') printOrder(mapOrder(o));
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
          if (idx !== -1 && ordersKanban[idx].status !== a.status) {
            if (['entregue','cancelado'].includes(a.status)) {
              ordersKanban.splice(idx, 1);
            } else {
              ordersKanban[idx].status = a.status;
            }
            houveMudanca = true;
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
      ">⭐</div>

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
            ✅ Pedidos<br>
            ✅ Cardápio<br>
            ✅ Mesas & PDV<br>
            ❌ Robô WhatsApp
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
            ✅ Pedidos<br>
            ✅ Cardápio<br>
            ✅ Mesas & PDV<br>
            ✅ <strong style="color:#a78bfa">Robô WhatsApp</strong>
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
        🚀 Fazer Upgrade para Premium
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
  } catch(e) {
    sbLoading(false);
    sbToast('err', 'Erro ao finalizar pedido: ' + e.message); return;
  }
  sbLoading(false);
  renderKanban();
  sbToast('ok', `Pedido #${_orderNum(id)} finalizado!`);
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
let customersData = [];
let estoqueItems = [];
let cartItems    = [];
let filters      = {search:'', cat:'', status:''};
let chatInitialized = false;
let cupons       = [];
let movimentos   = [];

// ─────────────────────────────────────────
// NAV
// ─────────────────────────────────────────
function nav(id){
  // ── Bloqueio do Robô para plano Pro ──────────────────
  if (id === 'robo') {
    if (_planoAtual !== 'premium') {
      _toastUpgradePlano();
      return; // Não navega
    }
  }
  document.querySelectorAll('.page').forEach(p=>{p.classList.remove('on');p.style.display='';});
  document.querySelectorAll('.si').forEach(s=>s.classList.remove('on'));
  // Fecha sidebar no mobile ao navegar
  document.querySelector('.sidebar')?.classList.remove('mobile-open');
  const pg=document.getElementById('page-'+id);
  if(pg) pg.classList.add('on');
  const sn=document.getElementById('sn-'+id);
  if(sn) sn.classList.add('on');
  closeNotif();
  if(id==='pedidos') renderKanban();
  if(id==='pedidos-mesa') renderMesasPage();
  if(id==='gestor'||id==='gestor-main') renderGestor();
  if(id==='edicao') renderTable();
  if(id==='imagens') renderImagens();
  if(id==='potencializador') renderPotencializador();
  if(id==='pdv') renderPDV();
  if(id==='pdv-balcao') renderPDVBalcao();
  if(id==='robo') {
    evoCarregarInstancia().then(() => {
      evoCheckStatus();   // vai atualizar QR/conectado porque naAbaRobo=true agora
    });
    initChat();
  }
  if(id==='qrcode') renderQR();
  if(id==='cupom') renderCupons();
  if(id==='fidelidade') renderFidelidade();
  if(id==='garcom') { renderGarcom(); loadGarcons(); }
  if(id==='kds') renderKDS();
  if(id==='estoque') renderEstoque();
  if(id==='desempenho') { setDesempPrd(_desempPrd); }
  if(id==='relatorios') { setRelPeriodo(_relPeriodo); }
  if(id==='satisfacao') renderSatisfacao();
  if(id==='impressao') renderImpressao();
  if(id==='caixa') _renderCaixaTela();
  if(id==='configuracoes') _renderConfiguracoes();
  if(id==='saques') { carregarCarteira(); conectarSaquesSSE(); carregarConfigPixGestor(); }
  if(id==='taxa') renderTaxaPage();
  if(id==='clientes') renderClientesPage();
  if(id==='meu-plano') renderMeuPlano();
  if(id==='cardapio-publico') {
    const cpPg = document.getElementById('page-cardapio-publico');
    if(cpPg) cpPg.style.display = 'flex';
    loadCardapioPublico();
  }
  if(id==='tema') {
    const tPg = document.getElementById('page-tema');
    if(tPg) tPg.style.display = 'flex';
    initTemaPage();
  }
}

function switchTab(btn,id){
  const parent=btn.closest('.page')||document.body;
  parent.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  btn.classList.add('on');
  parent.querySelectorAll('.ts').forEach(t=>t.classList.remove('on'));
  const sec=parent.querySelector('#'+id);
  if(sec) sec.classList.add('on');
}

let _kanbanFilter = '';
function filterKanban(type) {
  _kanbanFilter = type;
  // Update button active state
  document.querySelectorAll('#page-pedidos .btn[onclick^="filterKanban"]').forEach(b => {
    const t = b.getAttribute('onclick').match(/'([^']*)'/)?.[1] || '';
    b.style.background = t === type ? 'var(--accent)' : '';
    b.style.color = t === type ? '#fff' : '';
  });
  renderKanban();
}

// ─────────────────────────────────────────
// KANBAN
// ─────────────────────────────────────────
function renderKanban(){
  const statuses=['analise','producao','pronto'];
  statuses.forEach(st=>{
    const col=document.getElementById('col-'+st);
    const cnt=document.getElementById('cnt-'+st);
    let filtered=ordersKanban.filter(o=>o.status===st);
    if(_kanbanFilter==='delivery') filtered=filtered.filter(o=>o.addr&&!o.addr.includes('Mesa')&&!o.addr.includes('balcão'));
    if(_kanbanFilter==='balcao')   filtered=filtered.filter(o=>!o.addr||o.addr.includes('balcão'));
    if(_kanbanFilter==='mesa')     filtered=filtered.filter(o=>o.addr&&o.addr.includes('Mesa'));
    if(cnt) cnt.textContent=filtered.length;
    if(!col) return;
    if(filtered.length===0){
      col.innerHTML='<div class="kol-empty">Nenhum pedido no momento.<br>Receba pedidos e visualize aqui.</div>';
    } else {
      col.innerHTML=filtered.map(o=>{
        const itemStr=o.items.map(i=>i.qty+'x '+i.name).join(', ');
        const total='R$ '+(o.total+o.taxa).toFixed(2).replace('.',',');
        let actionBtn='';
        if(st==='analise'){
          actionBtn=
            '<button class="oc-btn oc-btn-ok" onclick="event.stopPropagation();advanceOrderById('+o.id+')">✔ Confirmar</button>'+
            '<button class="oc-btn oc-btn-no" onclick="event.stopPropagation();cancelOrderById('+o.id+')">✕ Cancelar</button>'+
            (_printMode==='manual'?'<button class="oc-btn" style="background:rgba(59,130,246,.15);color:#93c5fd;border:1px solid rgba(59,130,246,.25)" onclick="event.stopPropagation();printOrderById('+o.id+')">🖨️</button>':'');
        } else if(st==='producao'){
          actionBtn='<button class="oc-btn oc-btn-ok" onclick="event.stopPropagation();advanceOrderById('+o.id+')">🚀 Pronto!</button>'+(_printMode==='manual'?'<button class="oc-btn" style="background:rgba(59,130,246,.15);color:#93c5fd;border:1px solid rgba(59,130,246,.25)" onclick="event.stopPropagation();printOrderById('+o.id+')">🖨️</button>':'');
        } else {
          actionBtn='<button class="oc-btn oc-btn-fin" onclick="event.stopPropagation();finishOrderById('+o.id+')">✔ Finalizar</button>';
        }
        return '<div class="order-card" onclick="openOrderDetail('+o.id+')">'+
          '<div class="oc-top"><span class="oc-id">#'+o.num+'</span><span class="oc-time">⏱ '+o.time+'</span></div>'+
          '<div class="oc-client">👤 '+o.client+(o.phone?' · '+o.phone:'')+'</div>'+
          '<div class="oc-items">'+itemStr+'</div>'+
          '<div class="oc-bot"><span class="oc-total">'+total+'</span>'+
            (o.addr?'<span class="oc-addr">📍 '+o.addr+'</span>':'')+
          '</div>'+
          (o.pag==='dinheiro'?'<div style="font-size:11px;color:var(--amber);margin:4px 0 0;padding:0 2px">💵 Dinheiro · '+(o.troco>0?'Troco p/ R$'+parseFloat(o.troco).toFixed(2).replace('.',','):o.troco===-1?'Precisa de troco':'Sem troco')+'</div>':'')+
          '<div class="oc-actions">'+actionBtn+'</div>'+
        '</div>';
      }).join('');
    }
    col.addEventListener('dragover',e=>e.preventDefault());
    col.addEventListener('drop',e=>{
      e.preventDefault();
      const id=parseInt(e.dataTransfer.getData('orderId'));
      const o=ordersKanban.find(x=>x.id===id);
      if(o) o.status=st;
      renderKanban();
    });
  });
  document.getElementById('pedidos-badge').textContent=ordersKanban.filter(o=>o.status==='analise').length||'';
}

function openOrderDetail(id){
  const o=ordersKanban.find(x=>x.id===id);
  if(!o) return;
  document.getElementById('od-id').textContent='Pedido #'+o.num;
  const bdg=o.status==='analise'?['badge-analise','Em análise']:o.status==='producao'?['badge-producao','Em produção']:['badge-pronto','Pronto para entrega'];
  const el=document.getElementById('od-status-badge');
  el.className='od-status-badge '+bdg[0];el.textContent=bdg[1];
  document.getElementById('od-timer').innerHTML='<svg width=\"13\" height=\"13\" viewBox=\"0 0 16 16\" fill=\"none\" style=\"display:inline-block;vertical-align:middle\" xmlns=\"http://www.w3.org/2000/svg\"><circle cx=\"8\" cy=\"9\" r=\"5\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M8 6.5V9l1.5 1.5\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M6 2h4M8 2v2\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg> '+o.time;
  document.getElementById('od-client-name').textContent=o.client;
  document.getElementById('od-client-phone').textContent=o.phone||o.addr||'';
  document.getElementById('od-items-list').innerHTML=o.items.map(item=>`
    <div class="od-item-row">
      <div class="od-item-qty">${item.qty}x</div>
      <div><div class="od-item-name">${item.name}</div>${item.obs?`<div class="od-item-obs">Observação: ${item.obs}</div>`:''}</div>
      <div class="od-item-price">R$ ${(item.price).toFixed(2).replace('.',',')}</div>
    </div>
    <div class="od-subtotal-row" style="padding:4px 0 8px"><span style="padding-left:32px">Subtotal</span><span>R$ ${(item.qty*item.price).toFixed(2).replace('.',',')}</span></div>
  `).join('');
  document.getElementById('od-subtotal').textContent='R$ '+o.total.toFixed(2).replace('.',',');
  document.getElementById('od-total').textContent='R$ '+(o.total+o.taxa).toFixed(2).replace('.',',');
  // Troco
  const trocoRow = document.getElementById('od-troco-row');
  if (trocoRow) {
    if (o.pag === 'dinheiro') {
      trocoRow.style.display = '';
      trocoRow.innerHTML = o.troco > 0
        ? `<span>💵 Troco para</span><span style="color:var(--amber);font-weight:700">R$ ${parseFloat(o.troco).toFixed(2).replace('.',',')}</span>`
        : o.troco === -1
        ? `<span>💵 Precisa de troco</span><span style="color:var(--amber)">Valor não informado</span>`
        : `<span>💵 Sem troco</span><span style="color:var(--muted)">Valor exato</span>`;
    } else {
      trocoRow.style.display = 'none';
    }
  }
  openModal('modal-order-detail');
  window._currentDetailId=id;
}

function advanceOrder(){
  const id=window._currentDetailId;
  advanceOrderById(id);
  closeModal('modal-order-detail');
}

// ─────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────
// ── Novo Pedido Manual — estado do modal ──────────────
let _noCart        = [];   // [{id, name, qty, price, emoji}]
let _noDelivery    = 'delivery';

function noSetDelivery(tipo) {
  _noDelivery = tipo;
  ['delivery','retirada','mesa'].forEach(t => {
    const btn = document.getElementById('no-dtab-' + t);
    if (!btn) return;
    btn.className = t === tipo ? 'btn bp' : 'btn bg';
    btn.style.flex = '1';
    btn.style.justifyContent = 'center';
    btn.style.fontSize = '12px';
  });
  document.getElementById('no-addr-block').style.display = tipo === 'delivery' ? '' : 'none';
  document.getElementById('no-mesa-block').style.display = tipo === 'mesa'     ? '' : 'none';
}

function noFilterItems(q) {
  const list = document.getElementById('no-items-list');
  if (!list) return;
  const search = (q || '').toLowerCase();
  const filtered = items.filter(i =>
    i.status !== 'pausado' &&
    (!search || i.name.toLowerCase().includes(search) || (i.desc||'').toLowerCase().includes(search))
  ).slice(0, 50);
  if (!filtered.length) {
    list.innerHTML = '<div style="padding:12px;text-align:center;color:var(--muted);font-size:12.5px">Nenhum produto encontrado</div>';
    return;
  }
  list.innerHTML = filtered.map(item => {
    const priceStr = 'R$ ' + parseFloat(item.price||0).toFixed(2).replace('.',',');
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''" onclick="noAddItem(${item.id})">
      <span style="font-size:20px;flex-shrink:0">${item.emoji||'🍽️'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.name}</div>
        ${item.desc ? `<div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.desc}</div>` : ''}
      </div>
      <span style="font-size:12.5px;font-weight:700;color:var(--success);flex-shrink:0">${priceStr}</span>
      <button style="background:var(--accent);color:#fff;border:none;border-radius:7px;width:26px;height:26px;font-size:16px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center">+</button>
    </div>`;
  }).join('');
}

function noAddItem(itemId) {
  const item = items.find(i => i.id === itemId);
  if (!item) return;
  const existing = _noCart.find(c => c.id === itemId);
  if (existing) {
    existing.qty++;
  } else {
    _noCart.push({ id: item.id, name: item.name, qty: 1, price: parseFloat(item.price||0), emoji: item.emoji||'🍽️' });
  }
  noRenderCart();
}

function noChangeQty(itemId, delta) {
  const idx = _noCart.findIndex(c => c.id === itemId);
  if (idx === -1) return;
  _noCart[idx].qty += delta;
  if (_noCart[idx].qty <= 0) _noCart.splice(idx, 1);
  noRenderCart();
}

function noRenderCart() {
  const el = document.getElementById('no-cart');
  const empty = document.getElementById('no-cart-empty');
  const totalEl = document.getElementById('no-total-display');
  if (!el) return;
  if (!_noCart.length) {
    if (empty) empty.style.display = '';
    el.querySelectorAll('.no-cart-row').forEach(r => r.remove());
    if (totalEl) totalEl.textContent = 'R$ 0,00';
    return;
  }
  if (empty) empty.style.display = 'none';
  el.querySelectorAll('.no-cart-row').forEach(r => r.remove());
  const frag = document.createDocumentFragment();
  _noCart.forEach(c => {
    const div = document.createElement('div');
    div.className = 'no-cart-row';
    div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid var(--border)';
    div.innerHTML = `
      <span style="font-size:18px">${c.emoji}</span>
      <span style="flex:1;font-size:13px;font-weight:500">${c.name}</span>
      <div style="display:flex;align-items:center;gap:6px">
        <button onclick="noChangeQty(${c.id},-1)" style="width:24px;height:24px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">−</button>
        <span style="font-size:13px;font-weight:700;min-width:20px;text-align:center">${c.qty}</span>
        <button onclick="noChangeQty(${c.id},1)"  style="width:24px;height:24px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">+</button>
      </div>
      <span style="font-size:12.5px;font-weight:700;color:var(--success);min-width:60px;text-align:right">R$ ${(c.price * c.qty).toFixed(2).replace('.',',')}</span>`;
    frag.appendChild(div);
  });
  el.appendChild(frag);
  const total = _noCart.reduce((s,c) => s + c.price * c.qty, 0);
  if (totalEl) totalEl.textContent = 'R$ ' + total.toFixed(2).replace('.',',');
}

function noOpenModal() {
  _noCart = [];
  _noDelivery = 'delivery';
  ['order-client','order-phone','order-addr','order-obs','order-mesa'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('no-search').value = '';
  noSetDelivery('delivery');
  noFilterItems('');
  noRenderCart();
  openModal('modal-new-order');
}

async function createOrder() {
  const client = document.getElementById('order-client').value.trim() || 'Cliente';
  const phone  = document.getElementById('order-phone').value.trim()  || '';
  const obs    = document.getElementById('order-obs').value.trim()    || '';
  const pag    = document.getElementById('order-pag').value           || 'PIX';
  const time   = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});

  let addr = '';
  let mesaNum = null;
  if (_noDelivery === 'delivery') {
    addr = document.getElementById('order-addr').value.trim();
  } else if (_noDelivery === 'mesa') {
    mesaNum = parseInt(document.getElementById('order-mesa').value) || null;
    addr = mesaNum ? 'Mesa ' + mesaNum : 'Mesa';
  } else {
    addr = 'Retirada no balcão';
  }

  if (!_noCart.length) { sbToast('err','Adicione pelo menos um produto'); return; }

  const itemsArr = _noCart.map(c => ({ qty: c.qty, name: c.name, price: c.price, obs: '' }));
  if (obs) itemsArr[itemsArr.length - 1].obs = obs;
  const tot = _noCart.reduce((s,c) => s + c.price * c.qty, 0);

  sbLoading(true);
  const { data: orderData, error: oErr } = await sb.from('orders').insert({
    client, phone, addr,
    items: itemsArr,
    total: tot,
    taxa: _noDelivery === 'delivery' ? 5 : 0,
    mesa_num: mesaNum,
    status: 'analise',
    time, pag
  }).select().single();

  if (oErr) { sbLoading(false); sbToast('err','Erro ao criar pedido'); console.error(oErr); return; }

  await sb.from('movimentos').insert({
    description: `Pedido #${_orderNum(orderData.id)} – ${client}`,
    tipo: 'entrada', val: tot, pag, time
  }).catch(() => {});

  sbLoading(false);
  ordersKanban.unshift(mapOrder(orderData));
  movimentos.push({ id: Date.now(), desc: `Pedido #${orderData.id} – ${client}`, tipo:'entrada', val:tot, pag, time });

  playOrderSound();
  const nc = document.getElementById('notif-count');
  if (nc) { nc.style.display='flex'; nc.textContent = parseInt(nc.textContent||0)+1; }
  closeModal('modal-new-order');
  nav('pedidos');
  sbToast('ok', `Pedido #${_orderNum(orderData.id)} criado! ✅`);
}

function printOrderDetail(){
  const id=window._currentDetailId;
  const o=ordersKanban.find(x=>x.id===id);
  if(!o) return;
  showToast('<svg width=\'14\' height=\'14\' viewBox=\'0 0 16 16\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'><rect x=&quot;3&quot; y=&quot;2&quot; width=&quot;10&quot; height=&quot;4&quot; rx=&quot;1&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;1.4&quot; fill=&quot;none&quot; stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot;/><rect x=&quot;3&quot; y=&quot;10&quot; width=&quot;10&quot; height=&quot;4&quot; rx=&quot;1&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;1.4&quot; fill=&quot;none&quot; stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot;/><path d=&quot;M3 6H2a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1M13 6h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;1.4&quot; fill=&quot;none&quot; stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot;/><circle cx=&quot;12&quot; cy=&quot;8&quot; r=&quot;.6&quot; fill=&quot;currentColor&quot;/></svg>','Imprimindo comanda do pedido #'+_orderNum(id));
}

// ─────────────────────────────────────────
// GESTOR — DRAG & DROP CATEGORIAS
// ─────────────────────────────────────────
let _dragCatId = null;

function catDragStart(e, id) {
  _dragCatId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  // Mark dragging element
  setTimeout(() => e.target.closest('.cat-row')?.classList.add('dragging'), 0);
}

function catDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  // Highlight drop target
  const row = e.target.closest('.cat-row');
  document.querySelectorAll('.cat-row.drag-over').forEach(r => r.classList.remove('drag-over'));
  if (row && parseInt(row.dataset.catId) !== _dragCatId) {
    row.classList.add('drag-over');
  }
}

function catDragEnd(e) {
  document.querySelectorAll('.cat-row').forEach(r => {
    r.classList.remove('dragging');
    r.classList.remove('drag-over');
  });
  _dragCatId = null;
}

async function catDrop(e, targetId) {
  e.preventDefault();
  if (!_dragCatId || _dragCatId === targetId) return;

  // Reorder categories array
  const fromIdx = categories.findIndex(c => c.id === _dragCatId);
  const toIdx   = categories.findIndex(c => c.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;

  const moved = categories.splice(fromIdx, 1)[0];
  categories.splice(toIdx, 0, moved);

  renderGestor();

  // Persist new order to Supabase
  try {
    await Promise.all(categories.map((cat, i) =>
      sb.from('categories').update({ sort_order: i + 1 }).eq('id', cat.id)
    ));
    sbToast('ok', 'Ordem das categorias salva!');
  } catch(err) {
    sbToast('err', 'Erro ao salvar ordem');
  }
}

// ─────────────────────────────────────────
// GESTOR DE CARDÁPIO
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// MODELOS PRONTOS DE CARDÁPIO
// ─────────────────────────────────────────
const MODELOS_CARDAPIO = {
  acaiteria: {
    label: 'Açaiteria',
    categorias: [
      {
        label: 'Tamanhos',
        name: 'tamanhos',
        type: 'Itens principais',
        itens: [
          { name: 'Açaí 300ml',   emoji: '', price: 12.00, description: 'Açaí 300ml — base pura, monte do seu jeito' },
          { name: 'Açaí 400ml',   emoji: '', price: 15.00, description: 'Açaí 400ml — tamanho ideal para um lanche' },
          { name: 'Açaí 500ml',   emoji: '', price: 18.00, description: 'Açaí 500ml — generoso e bem servido' },
          { name: 'Açaí 700ml',   emoji: '', price: 23.00, description: 'Açaí 700ml — o favorito da galera' },
          { name: 'Açaí 1 Litro', emoji: '', price: 30.00, description: 'Açaí 1 litro — para compartilhar' },
          { name: 'Tigela P',     emoji: '', price: 14.00, description: 'Tigela pequena de açaí' },
          { name: 'Tigela M',     emoji: '', price: 20.00, description: 'Tigela média de açaí' },
          { name: 'Tigela G',     emoji: '', price: 27.00, description: 'Tigela grande de açaí' },
        ]
      },
      {
        label: 'Complementos',
        name: 'complementos',
        type: 'checklist',
        itens: [
          { name: 'Granola',          emoji: '', price: 0.00, description: 'Granola crocante' },
          { name: 'Leite em Pó',      emoji: '', price: 0.00, description: 'Leite em pó' },
          { name: 'Paçoca',           emoji: '', price: 0.00, description: 'Paçoca triturada' },
          { name: 'Amendoim',         emoji: '', price: 0.00, description: 'Amendoim torrado' },
          { name: 'Aveia',            emoji: '', price: 0.00, description: 'Aveia em flocos' },
          { name: 'Sucrilhos',        emoji: '', price: 0.00, description: 'Sucrilhos crocantes' },
          { name: 'Coco Ralado',      emoji: '', price: 0.00, description: 'Coco ralado' },
          { name: 'Confeito',         emoji: '', price: 0.00, description: 'Confeito colorido' },
          { name: 'Granulado',        emoji: '', price: 0.00, description: 'Granulado de chocolate' },
        ]
      },
      {
        label: 'Coberturas',
        name: 'coberturas',
        type: 'checklist',
        itens: [
          { name: 'Mel',              emoji: '', price: 0.00, description: 'Mel puro' },
          { name: 'Leite Condensado', emoji: '', price: 0.00, description: 'Leite condensado' },
          { name: 'Calda de Morango', emoji: '', price: 0.00, description: 'Calda de morango' },
          { name: 'Calda de Chocolate', emoji: '', price: 0.00, description: 'Calda de chocolate' },
          { name: 'Nutella',          emoji: '', price: 3.00, description: 'Nutella — adicional' },
        ]
      },
      {
        label: 'Frutas',
        name: 'frutas',
        type: 'checklist',
        itens: [
          { name: 'Morango',  emoji: '', price: 0.00, description: 'Morango fresco' },
          { name: 'Banana',   emoji: '', price: 0.00, description: 'Banana fatiada' },
          { name: 'Kiwi',     emoji: '', price: 0.00, description: 'Kiwi fatiado' },
          { name: 'Uva',      emoji: '', price: 0.00, description: 'Uva sem semente' },
        ]
      },
      {
        label: 'Adicionais',
        name: 'adicionais_acai',
        type: 'checklist',
        itens: [
          { name: 'Chantilly',       emoji: '', price: 2.00, description: 'Chantilly' },
          { name: 'Sorvete extra',   emoji: '', price: 4.00, description: 'Bola de sorvete extra' },
          { name: 'Proteína em pó',  emoji: '', price: 5.00, description: 'Scoop de proteína' },
        ]
      },
    ]
  },
  restaurante: {
    label: 'Restaurante',
    categorias: [
      { label: 'Entradas', name: 'entradas', itens: [
        { name: 'Caldo de Feijão',   emoji: '', price: 12.00, description: 'Caldo de feijão temperado' },
        { name: 'Isca de Frango',    emoji: '', price: 22.00, description: 'Isca de frango empanada' },
        { name: 'Camarão ao Alho',   emoji: '', price: 35.00, description: 'Camarão ao alho e óleo' },
      ]},
      { label: 'Pratos Principais', name: 'pratos_principais', itens: [
        { name: 'Frango Grelhado',   emoji: '', price: 35.00, description: 'Frango grelhado com acompanhamentos' },
        { name: 'Picanha na Brasa',  emoji: '', price: 65.00, description: 'Picanha na brasa 300g' },
        { name: 'Filé de Peixe',     emoji: '', price: 42.00, description: 'Filé de peixe grelhado' },
        { name: 'Marmita P',         emoji: '', price: 18.00, description: 'Marmita pequena completa' },
        { name: 'Marmita G',         emoji: '', price: 25.00, description: 'Marmita grande completa' },
      ]},
      { label: 'Sobremesas', name: 'sobremesas', itens: [
        { name: 'Pudim',             emoji: '', price: 10.00, description: 'Pudim de leite condensado' },
        { name: 'Mousse de Maracujá',emoji: '', price: 10.00, description: 'Mousse de maracujá' },
        { name: 'Sorvete',           emoji: '', price: 8.00, description: '2 bolas de sorvete' },
      ]},
      { label: 'Bebidas', name: 'bebidas', itens: [
        { name: 'Suco Natural',   emoji: '', price: 8.00, description: 'Suco da fruta natural 400ml' },
        { name: 'Refrigerante',   emoji: '', price: 6.00, description: 'Lata 350ml' },
        { name: 'Água',           emoji: '', price: 3.00, description: 'Água mineral 500ml' },
        { name: 'Cerveja',        emoji: '', price: 9.00, description: 'Garrafa 600ml' },
      ]},
    ]
  },
  pizzaria: {
    label: 'Pizzaria',
    categorias: [
      { label: 'Pizzas Salgadas', name: 'pizzas_salgadas', itens: [
        { name: 'Margherita',         emoji: '', price: 48.00, description: 'Molho de tomate, mussarela e manjericão' },
        { name: 'Calabresa',          emoji: '', price: 52.00, description: 'Molho, mussarela e calabresa' },
        { name: 'Frango com Catupiry',emoji: '', price: 58.00, description: 'Molho, mussarela, frango e catupiry' },
        { name: 'Portuguesa',         emoji: '', price: 60.00, description: 'Molho, mussarela, presunto, ovo e pimentão' },
        { name: 'Quatro Queijos',     emoji: '', price: 65.00, description: 'Molho, mussarela, provolone, parmesão e gorgonzola' },
      ]},
      { label: 'Pizzas Doces', name: 'pizzas_doces', itens: [
        { name: 'Chocolate com Morango', emoji: '', price: 55.00, description: 'Chocolate ao leite e morangos frescos' },
        { name: 'Romeu e Julieta',    emoji: '', price: 50.00, description: 'Mussarela e goiabada' },
        { name: 'Banana com Canela',  emoji: '', price: 48.00, description: 'Banana, canela e leite condensado' },
      ]},
      { label: 'Bordas', name: 'bordas', itens: [
        { name: 'Borda Recheada Catupiry', emoji: '', price: 8.00, description: 'Borda recheada com catupiry' },
        { name: 'Borda Recheada Cheddar',  emoji: '', price: 8.00, description: 'Borda recheada com cheddar' },
        { name: 'Borda Simples',           emoji: '', price: 0.00, description: 'Borda tradicional' },
      ]},
      { label: 'Bebidas', name: 'bebidas_pizza', itens: [
        { name: 'Refrigerante 2L',    emoji: '', price: 12.00, description: 'Refrigerante 2 litros' },
        { name: 'Cerveja Long Neck',  emoji: '', price: 10.00, description: 'Cerveja long neck 355ml' },
        { name: 'Suco de Uva',        emoji: '', price: 12.00, description: 'Suco de uva integral' },
      ]},
    ]
  },
  hamburgueria: {
    label: 'Hamburgueria',
    categorias: [
      { label: 'Hambúrgueres', name: 'hamburgueres', itens: [
        { name: 'Classic Burger',    emoji: '', price: 28.00, description: 'Pão, carne 150g, queijo, alface e tomate' },
        { name: 'Double Smash',      emoji: '', price: 38.00, description: 'Pão brioche, 2 smash patties, queijo american' },
        { name: 'Chicken Crispy',    emoji: '', price: 32.00, description: 'Pão, frango crocante, cheddar e bacon' },
        { name: 'Veggie Burger',     emoji: '', price: 30.00, description: 'Pão, hambúrguer de grão-de-bico, rúcula' },
      ]},
      { label: 'Combos', name: 'combos', itens: [
        { name: 'Combo Clássico',    emoji: '', price: 42.00, description: 'Hambúrguer + Batata M + Refrigerante' },
        { name: 'Combo Duplo',       emoji: '', price: 55.00, description: 'Hambúrguer Duplo + Batata G + Refrigerante' },
      ]},
      { label: 'Acompanhamentos', name: 'acompanhamentos', itens: [
        { name: 'Batata Frita P',    emoji: '', price: 12.00, description: 'Porção pequena de batata frita' },
        { name: 'Batata Frita G',    emoji: '', price: 18.00, description: 'Porção grande de batata frita' },
        { name: 'Onion Rings',       emoji: '', price: 16.00, description: 'Anéis de cebola empanados' },
        { name: 'Fritas com Cheddar',emoji: '', price: 22.00, description: 'Batata frita com cheddar e bacon' },
      ]},
      { label: 'Bebidas', name: 'bebidas_burger', itens: [
        { name: 'Milkshake',         emoji: '', price: 20.00, description: 'Milkshake 400ml — vários sabores' },
        { name: 'Refrigerante Lata', emoji: '', price: 6.00, description: 'Lata 350ml' },
        { name: 'Água',              emoji: '', price: 4.00, description: 'Água mineral 500ml' },
      ]},
    ]
  },
  cafeteria: {
    label: 'Cafeteria',
    categorias: [
      { label: 'Cafés', name: 'cafes', itens: [
        { name: 'Espresso',      emoji: '', price: 6.00, description: 'Espresso tradicional' },
        { name: 'Cappuccino',    emoji: '', price: 10.00, description: 'Cappuccino 300ml' },
        { name: 'Latte',         emoji: '', price: 12.00, description: 'Café latte com leite vaporizado' },
        { name: 'Café Gelado',   emoji: '', price: 14.00, description: 'Cold brew 400ml' },
      ]},
      { label: 'Sucos e Vitaminas', name: 'sucos', itens: [
        { name: 'Suco Verde',    emoji: '', price: 12.00, description: 'Couve, maçã e gengibre' },
        { name: 'Vitamina',      emoji: '', price: 14.00, description: 'Vitamina de banana com aveia' },
        { name: 'Água de Coco',  emoji: '', price: 8.00, description: 'Água de coco natural' },
      ]},
      { label: 'Salgados', name: 'salgados', itens: [
        { name: 'Croissant',     emoji: '', price: 12.00, description: 'Croissant de presunto e queijo' },
        { name: 'Coxinha',       emoji: '', price: 7.00, description: 'Coxinha de frango' },
        { name: 'Wrap',          emoji: '', price: 18.00, description: 'Wrap de frango grelhado' },
      ]},
      { label: 'Doces', name: 'doces_cafe', itens: [
        { name: 'Brownie',       emoji: '', price: 10.00, description: 'Brownie de chocolate' },
        { name: 'Muffin',        emoji: '', price: 9.00, description: 'Muffin de blueberry' },
        { name: 'Cheesecake',    emoji: '', price: 15.00, description: 'Fatia de cheesecake com calda de frutas' },
      ]},
    ]
  },
  padaria: {
    label: 'Padaria',
    categorias: [
      { label: 'Pães', name: 'paes', itens: [
        { name: 'Pão Francês',   emoji: '', price: 0.70, description: 'Pão francês fresquinho — unidade' },
        { name: 'Pão de Queijo', emoji: '', price: 3.50, description: 'Pão de queijo mineiro — unidade' },
        { name: 'Pão de Forma',  emoji: '', price: 9.00, description: 'Pão de forma fatiado — pacote' },
        { name: 'Baguete',       emoji: '', price: 8.00, description: 'Baguete tradicional' },
      ]},
      { label: 'Salgados', name: 'salgados_padaria', itens: [
        { name: 'Esfiha',        emoji: '', price: 5.00, description: 'Esfiha de carne' },
        { name: 'Enroladinho',   emoji: '', price: 4.50, description: 'Enroladinho de presunto e queijo' },
        { name: 'Pastel',        emoji: '', price: 6.00, description: 'Pastel de carne' },
        { name: 'Pizza Pão',     emoji: '', price: 7.00, description: 'Pizza pão individual' },
      ]},
      { label: 'Doces', name: 'doces_padaria', itens: [
        { name: 'Sonho',         emoji: '', price: 5.00, description: 'Sonho com recheio de creme' },
        { name: 'Brigadeirão',   emoji: '', price: 4.50, description: 'Fatia de brigadeirão' },
        { name: 'Bolo de Cenoura', emoji: '', price: 6.00, description: 'Fatia de bolo de cenoura com cobertura' },
      ]},
      { label: 'Bolos', name: 'bolos', itens: [
        { name: 'Bolo Festa 1kg',  emoji: '', price: 65.00, description: 'Bolo de festa confeitado 1kg' },
        { name: 'Bolo de Pote',    emoji: '', price: 15.00, description: 'Bolo de pote individual' },
      ]},
      { label: 'Bebidas', name: 'bebidas_padaria', itens: [
        { name: 'Café Coado',    emoji: '', price: 4.00, description: 'Café coado — copo' },
        { name: 'Achocolatado',  emoji: '', price: 6.00, description: 'Achocolatado quente ou frio 300ml' },
        { name: 'Suco de Laranja', emoji: '', price: 7.00, description: 'Suco de laranja natural' },
      ]},
    ]
  },
};

let _modeloSelecionado = null;

function selecionarModelo(tipo) {
  _modeloSelecionado = tipo;
  const modelo = MODELOS_CARDAPIO[tipo];
  if (!modelo) return;

  // Atualiza visual dos cards
  document.querySelectorAll('.modelo-card').forEach(c => {
    c.style.borderColor = 'var(--border)';
    c.style.background  = 'var(--surface2)';
  });
  const card = document.getElementById('modelo-' + tipo);
  if (card) {
    card.style.borderColor = 'var(--accent)';
    card.style.background  = 'rgba(59,130,246,.08)';
  }

  // Mostra aviso e preview
  document.getElementById('modelos-aviso').style.display = 'block';
  document.getElementById('modelo-preview').style.display = 'block';
  document.getElementById('btn-aplicar-modelo').style.display = 'flex';

  const prev = document.getElementById('modelo-preview-content');
  prev.innerHTML = modelo.categorias.map(cat => `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
      <div style="font-weight:700;font-size:12.5px;margin-bottom:8px;display:flex;align-items:center;gap:6px">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5 8h6M5 5h3M5 11h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        ${cat.label}
        <span style="font-size:10px;color:var(--muted);font-weight:400">(${cat.itens.length} itens)</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">
        ${cat.itens.map(it => `
          <span style="font-size:11px;padding:3px 8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--muted2)">
            ${it.emoji} ${it.name} ${it.price > 0 ? '· R$' + it.price.toFixed(2).replace('.',',') : ''}
          </span>`).join('')}
      </div>
    </div>`).join('');
}

// ── Limpa todo o cardápio do tenant ──────────────────
async function limparCardapioAtual() {
  if (items.length > 0)      await sb.from('menu_items').delete().neq('id', 0);
  if (categories.length > 0) await sb.from('categories').delete().neq('id', 0);
  items.length = 0;
  categories.length = 0;
}

// ── Excluir tudo com confirmação dupla ───────────────
async function excluirTodoCardapio() {
  if (!categories.length && !items.length) {
    sbToast('err', 'O cardápio já está vazio.');
    return;
  }

  const primeira = confirm(`Tem certeza que deseja EXCLUIR TODO O CARDÁPIO?\n\n${categories.length} categoria(s) · ${items.length} item(s) serão deletados permanentemente.`);
  if (!primeira) return;

  const segunda = confirm('⚠️ Esta ação não pode ser desfeita.\n\nConfirme novamente para excluir tudo.');
  if (!segunda) return;

  closeModal('modal-modelos');
  sbLoading(true);
  try {
    await limparCardapioAtual();
    renderGestor();
    renderTable();
    sbToast('ok', '🗑️ Cardápio excluído com sucesso.');
  } catch(e) {
    sbToast('err', 'Erro ao excluir: ' + e.message);
    console.error(e);
  } finally {
    sbLoading(false);
  }
}

async function aplicarModelo() {
  if (!_modeloSelecionado) return;
  const modelo = MODELOS_CARDAPIO[_modeloSelecionado];
  if (!modelo) return;

  const substituir = document.getElementById('toggle-limpar-cardapio')?.classList.contains('on');

  if (substituir) {
    const ok = confirm(`Tem certeza? Isso vai APAGAR todo o cardápio atual (${categories.length} categoria(s) · ${items.length} item(s)) e substituir pelo modelo "${modelo.label}".`);
    if (!ok) return;
  }

  const btn = document.getElementById('btn-aplicar-modelo');
  btn.disabled = true;
  btn.innerHTML = '<div class="spin"></div> Aplicando...';
  sbLoading(true);

  try {
    if (substituir) {
      await limparCardapioAtual();
    }

    let catSortOrder = categories.length;

    for (const catDef of modelo.categorias) {
      const { data: catData, error: catErr } = await sb.from('categories').insert({
        name: catDef.name,
        label: catDef.label,
        type: catDef.type || 'Itens principais',
        promo: false,
        sort_order: ++catSortOrder
      }).select().single();

      if (catErr) { console.error('Erro ao criar cat:', catErr); continue; }

      categories.push({
        id: catData.id, name: catData.name, label: catData.label,
        type: catData.type, promo: false, open: false
      });

      for (const itemDef of catDef.itens) {
        const { data: itemData, error: itemErr } = await sb.from('menu_items').insert({
          emoji:       itemDef.emoji,
          name:        itemDef.name,
          description: itemDef.description,
          price:       itemDef.price,
          price_old:   null,
          cat:         catData.label,
          cat_key:     catData.name,
          item_type:   'normal',
          allow_half:  false,
          max_flavors: 1,
          promo:       false,
          status:      'active',
          days:        [1,1,1,1,1,1,1],
          ingredients: []
        }).select().single();

        if (itemErr) { console.error('Erro ao criar item:', itemErr); continue; }
        items.push(mapItem(itemData));
      }
    }

    closeModal('modal-modelos');
    // Reset toggle
    document.getElementById('toggle-limpar-cardapio')?.classList.remove('on');
    renderGestor();
    renderTable();
    sbToast('ok', `✅ Modelo "${modelo.label}" aplicado com ${modelo.categorias.length} categorias!`);

  } catch(e) {
    sbToast('err', 'Erro ao aplicar modelo: ' + e.message);
    console.error(e);
  } finally {
    sbLoading(false);
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 2h8l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.4"/><path d="M9 2v4h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg> Aplicar modelo`;
    _modeloSelecionado = null;
  }
}

// ── Exportar cardápio atual ───────────────────────────
function exportarCardapio() {
  try {
    // Monta estrutura exportável
    const exportData = {
      _versao:    1,
      _exportado: new Date().toISOString(),
      _nome:      document.getElementById('sidebar-nome')?.textContent || 'cardapio',
      categorias: categories.map(cat => ({
        name:  cat.name,
        label: cat.label,
        type:  cat.type  || 'Itens principais',
        promo: cat.promo || false,
        itens: items
          .filter(i => i.catKey === cat.name)
          .map(i => ({
            name:        i.name,
            emoji:       i.emoji       || '🍽️',
            description: i.description || '',
            price:       i.price       || 0,
            price_old:   i.priceOld    || null,
            status:      i.status      || 'active',
            item_type:   i.itemType    || 'normal',
            allow_half:  i.allowHalf   || false,
            max_flavors: i.maxFlavors  || 1,
            ingredients: i.ingredients || [],
            days:        i.days        || [1,1,1,1,1,1,1],
          }))
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const data = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    a.href     = url;
    a.download = `cardapio-${exportData._nome.toLowerCase().replace(/\s+/g,'-')}-${data}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    sbToast('ok', `📥 Cardápio exportado com ${categories.length} categoria(s)!`);
  } catch(e) {
    sbToast('err', 'Erro ao exportar: ' + e.message);
    console.error(e);
  }
}

// ── Importar cardápio de arquivo .json ───────────────
async function importarCardapio(inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;
  inputEl.value = ''; // reset para permitir re-importar mesmo arquivo

  let parsed;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch(e) {
    sbToast('err', 'Arquivo inválido — não é um JSON válido');
    return;
  }

  // Valida estrutura mínima
  if (!parsed?.categorias || !Array.isArray(parsed.categorias)) {
    sbToast('err', 'Arquivo não reconhecido — estrutura inválida');
    return;
  }

  const total = parsed.categorias.reduce((s, c) => s + (c.itens?.length || 0), 0);

  const substituir = categories.length > 0 && confirm(
    `Deseja SUBSTITUIR o cardápio atual?\n\nAtual: ${categories.length} categoria(s) · ${items.length} item(s)\nImportando: ${parsed.categorias.length} categoria(s) · ${total} item(s)\n\nClique OK para substituir ou Cancelar para adicionar ao existente.`
  );

  closeModal('modal-modelos');
  sbLoading(true);

  let catsCriadas = 0, itensCriados = 0, erros = 0;

  try {
    if (substituir) {
      await limparCardapioAtual();
    }

    let catSortOrder = categories.length;

    for (const catDef of parsed.categorias) {
      if (!catDef.name || !catDef.label) continue;

      const { data: catData, error: catErr } = await sb.from('categories').insert({
        name:       catDef.name,
        label:      catDef.label,
        type:       catDef.type  || 'Itens principais',
        promo:      catDef.promo || false,
        sort_order: ++catSortOrder
      }).select().single();

      if (catErr) { console.error('Erro ao criar cat:', catErr); erros++; continue; }
      catsCriadas++;

      categories.push({
        id: catData.id, name: catData.name, label: catData.label,
        type: catData.type, promo: catData.promo || false, open: false
      });

      const itens = catDef.itens || [];
      for (const itemDef of itens) {
        if (!itemDef.name) continue;

        const { data: itemData, error: itemErr } = await sb.from('menu_items').insert({
          emoji:       itemDef.emoji       || '🍽️',
          name:        itemDef.name,
          description: itemDef.description || '',
          price:       parseFloat(itemDef.price) || 0,
          price_old:   itemDef.price_old   || null,
          cat:         catData.label,
          cat_key:     catData.name,
          item_type:   itemDef.item_type   || 'normal',
          allow_half:  itemDef.allow_half  || false,
          max_flavors: itemDef.max_flavors || 1,
          promo:       false,
          status:      itemDef.status      || 'active',
          days:        itemDef.days        || [1,1,1,1,1,1,1],
          ingredients: itemDef.ingredients || []
        }).select().single();

        if (itemErr) { console.error('Erro ao criar item:', itemErr); erros++; continue; }
        itensCriados++;
        items.push(mapItem(itemData));
      }
    }

    renderGestor();
    renderTable();
    const msg = `✅ Importado: ${catsCriadas} categoria(s) · ${itensCriados} item(s)` + (erros ? ` · ${erros} erro(s)` : '');
    sbToast('ok', msg);

  } catch(e) {
    sbToast('err', 'Erro ao importar: ' + e.message);
    console.error(e);
  } finally {
    sbLoading(false);
  }
}

// ─────────────────────────────────────────
function renderGestor(){
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
            <div class="sw"><select onclick="event.stopPropagation()" style="font-size:11.5px;padding:4px 22px 4px 9px" onchange="handleCatAction(${cat.id},this.value)"><option value="">Ações ▾</option><option value="edit">Editar</option><option value="pause">Pausar</option><option value="delete">Excluir</option></select></div>
            <div class="cat-toggle${cat.open?' open':''}"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          </div>
        </div>
        ${cat.open?`<div class="cat-items">
          ${catItems.map(item=>`
            <div class="cat-item-row" onclick="openEditItem(${item.id})">
              <div class="cat-item-thumb">${item.imageUrl?`<img src="${item.imageUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:6px">`:(item.emoji||'🍽️')}</div>
              <div style="flex:1;min-width:0">
                <div class="cat-item-name">${item.name}${item.promo?' <span class="ptag">promo</span>':''}${item.itemType==='pizza'?' <span style="font-size:9px;background:rgba(245,158,11,.15);color:var(--accent3);border-radius:4px;padding:1px 4px;font-weight:700;margin-left:2px">🍕</span>':''}</div>
                <div class="cat-item-price">R$ ${item.price.toFixed(2).replace('.',',')} · ${item.status==='active'?'<span style="color:var(--success)">Disponível</span>':item.status==='esgotado'?'<span style="color:var(--danger)">Esgotado</span>':'<span style="color:var(--accent3)">Pausado</span>'}</div>
              </div>
              <button class="btn bg" style="font-size:10.5px;padding:3px 8px;flex-shrink:0" onclick="event.stopPropagation();openEditItem(${item.id})">✏️ Editar</button>
            </div>
          `).join('')}
          <div class="cat-add" onclick="openAddItemModal('${cat.name}')">
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
    openModal('modal-edit-cat');
  } else if (action === 'delete') {
    deleteCatById(id);
  } else if (action === 'pause') {
    sbToast('ok', 'Categoria pausada!');
  }
}

async function saveEditCategory() {
  const id   = parseInt(document.getElementById('edit-cat-id').value);
  const name = document.getElementById('edit-cat-name').value.trim();
  const type = document.getElementById('edit-cat-type').value;
  if (!name) { sbToast('err','Informe o nome'); return; }
  sbLoading(true);
  const { error } = await sb.from('categories').update({
    label: name, name: name.toLowerCase(), type
  }).eq('id', id);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao salvar'); return; }
  const cat = categories.find(c => c.id === id);
  if (cat) { cat.label = name; cat.name = name.toLowerCase(); cat.type = type; }
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
  const name = document.getElementById('cat-name-input').value.trim();
  if (!name) { sbToast('err','Informe o nome da categoria'); return; }
  sbLoading(true);
  const { data, error } = await sb.from('categories').insert({
    name: name.toLowerCase(), label: name,
    type: 'Itens principais', promo: false,
    sort_order: categories.length + 1
  }).select().single();
  sbLoading(false);
  if (error) { sbToast('err','Erro ao criar categoria'); console.error(error); return; }
  categories.push({
    id: data.id, name: data.name, label: data.label || data.name,
    type: data.type || 'Itens principais', promo: false, open: false
  });
  closeModal('modal-add-cat');
  document.getElementById('cat-name-input').value = '';
  renderGestor();
  sbToast('ok','Categoria criada!');
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
      <td><button class="btn bg" style="font-size:10.5px;padding:3px 8px" onclick="openEditItem(${item.id})">✏️ Editar</button></td>
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

function cycleStatus(id,el){
  const it=items.find(i=>i.id===id);
  if(!it) return;
  const cur=STATUS_CYCLE.findIndex(s=>s[0]===scClass(it.status));
  const next=STATUS_CYCLE[(cur+1)%STATUS_CYCLE.length];
  it.status=next[0]==='sta'?'active':next[0]==='ste'?'esgotado':'pausado';
  STATUS_CYCLE.forEach(s=>el.classList.remove(s[0]));
  el.classList.add(next[0]);
  el.innerHTML=`<div class="stdot"></div>&nbsp;${next[1]}`;
}

function setPizzaMax(ctx, val, el) {
  document.querySelectorAll(`#${ctx}-pizza-options .pz-max-btn`).forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  document.getElementById(`${ctx}-max-flavors`).value = val;
  // Auto-sync meio-a-meio: if max >= 2, suggest enabling it
}

function togglePizzaOptions(ctx) {
  const typeEl = document.getElementById(ctx+'-item-type');
  const box    = document.getElementById(ctx+'-pizza-options');
  if (!typeEl || !box) return;
  box.style.display = typeEl.value === 'pizza' ? '' : 'none';
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
  if (!name) { sbToast('err','Informe o nome do item'); return; }
  const price    = parseFloat(document.getElementById('new-price').value) || 0;
  const priceOld = parseFloat(document.getElementById('new-price-old').value) || null;
  const catEl    = document.getElementById('new-cat');
  const catKey   = catEl ? catEl.value : '';
  const catLabel = catEl ? (catEl.options[catEl.selectedIndex]?.text || catKey) : catKey;
  const selEmo   = document.querySelector('#emoji-grid .emo-btn.on');
  const emoji    = selEmo ? selEmo.textContent.trim() : '🍽️';
  const desc     = document.getElementById('new-desc').value.trim();
  const ingrRaw  = document.getElementById('new-ingredients').value.trim();
  const ingredients = ingrRaw ? ingrRaw.split(',').map(s=>s.trim()).filter(Boolean) : [];
  const itemType  = document.getElementById('new-item-type').value;
  const allowHalf = itemType === 'pizza' && document.getElementById('new-meio-meio').classList.contains('on');
  const maxFlavors= itemType === 'pizza' ? (parseInt(document.getElementById('new-max-flavors').value) || 1) : 1;
  const status    = document.getElementById('new-status').value;

  if (!catKey) { sbToast('err','Selecione uma categoria'); return; }

  sbLoading(true);
  const { data, error } = await sb.from('menu_items').insert({
    emoji, name,
    cat: catLabel, cat_key: catKey,
    price, price_old: priceOld,
    description: desc, ingredients, item_type: itemType,
    allow_half: allowHalf, max_flavors: maxFlavors,
    promo: false, status,
    days: [1,1,1,1,1,1,1]
  }).select().single();
  sbLoading(false);

  if (error) { sbToast('err','Erro ao salvar item'); console.error(error); return; }

  // Upload image if selected
  if (_newItemImageFile) {
    try {
      const url = await uploadItemImage(_newItemImageFile, data.id);
      await sb.from('menu_items').update({ image_url: url }).eq('id', data.id);
      data.image_url = url;
    } catch(e) { sbToast('err','Item criado mas erro ao enviar foto'); }
    _newItemImageFile = null;
  }

  items.push(mapItem(data));

  // Reset form
  ['new-name','new-desc','new-ingredients','new-price','new-price-old'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  // Reset image preview
  const t = document.getElementById('new-img-thumb'); if(t){ t.src=''; t.style.display='none'; }
  const p = document.getElementById('new-img-placeholder'); if(p) p.style.display='flex';
  const c = document.getElementById('new-img-change'); if(c) c.style.display='none';
  const pr = document.getElementById('new-img-preview'); if(pr) pr.style.border='2px dashed var(--border)';
  document.getElementById('new-item-type').value = 'normal';
  document.getElementById('new-status').value = 'active';
  togglePizzaOptions('new');

  closeModal('modal-add-item');
  renderTable(); renderGestor(); renderPDV();
  sbToast('ok', `"${name}" adicionado ao cardápio!`);
}

function openEditItem(id) {
  editingId = id;
  const it = items.find(i => i.id === id);
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

  openModal('modal-edit-item');
}

function selectEditEmoji(el, emoji) {
  document.querySelectorAll('#edit-emoji-grid .emo-btn').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  const prev = document.getElementById('edit-emoji-current');
  if (prev) prev.textContent = emoji;
}

async function saveEditItem() {
  const it = items.find(i => i.id === editingId);
  if (!it) return;

  it.name        = document.getElementById('edit-name').value.trim();
  it.desc        = document.getElementById('edit-desc').value.trim();
  it.price       = parseFloat(document.getElementById('edit-price').value) || it.price;
  it.priceOld    = parseFloat(document.getElementById('edit-price-old').value) || null;
  it.catKey      = document.getElementById('edit-cat').value;
  const catEl    = document.getElementById('edit-cat');
  it.cat         = catEl ? (catEl.options[catEl.selectedIndex]?.text || it.catKey) : it.catKey;
  it.status      = document.getElementById('edit-status').value;
  const ingrRaw  = document.getElementById('edit-ingredients').value;
  it.ingredients = ingrRaw ? ingrRaw.split(',').map(s=>s.trim()).filter(Boolean) : [];
  it.itemType   = document.getElementById('edit-item-type').value;
  const meioEl  = document.getElementById('edit-meio-meio');
  it.allowHalf  = it.itemType === 'pizza' && meioEl && meioEl.classList.contains('on');
  it.maxFlavors = it.itemType === 'pizza' ? (parseInt(document.getElementById('edit-max-flavors').value) || 1) : 1;

  const selEmo   = document.querySelector('#edit-emoji-grid .emo-btn.on');
  if (selEmo) it.emoji = selEmo.textContent.trim();

  if (!it.name) { sbToast('err','Informe o nome do item'); return; }

  sbLoading(true);
  const { error } = await sb.from('menu_items').update({
    name: it.name, description: it.desc,
    price: it.price, price_old: it.priceOld || null,
    cat: it.cat, cat_key: it.catKey, status: it.status,
    ingredients: it.ingredients, item_type: it.itemType, allow_half: it.allowHalf, max_flavors: it.maxFlavors,
    emoji: it.emoji
  }).eq('id', editingId);
  sbLoading(false);

  if (error) { sbToast('err','Erro ao atualizar item'); console.error(error); return; }

  // Upload new image if selected
  if (_editItemImageFile) {
    try {
      const url = await uploadItemImage(_editItemImageFile, editingId);
      await sb.from('menu_items').update({ image_url: url }).eq('id', editingId);
      it.imageUrl = url;
    } catch(e) { sbToast('err','Item salvo mas erro ao enviar foto'); }
    _editItemImageFile = null;
  }

  closeModal('modal-edit-item');
  renderTable(); renderGestor(); renderPDV();
  sbToast('ok', `"${it.name}" atualizado!`);
}

async function deleteItem() {
  // Use inline confirm since native confirm() may be blocked in iframes
  const it = items.find(i => i.id === editingId);
  const name = it ? it.name : 'este item';
  if (!await showConfirmDialog(`Excluir "${name}"?`, 'Esta ação não pode ser desfeita.')) return;
  sbLoading(true);
  const { error } = await sb.from('menu_items').delete().eq('id', editingId);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao excluir item'); console.error(error); return; }
  items = items.filter(i => i.id !== editingId);
  closeModal('modal-edit-item');
  renderTable(); renderGestor(); renderPDV();
  sbToast('ok','Item excluído do cardápio!');
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
  showToast('⚡',`Ação aplicada em ${checked.length} item(s)!`);
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

// ─────────────────────────────────────────
// POTENCIALIZADOR
// ─────────────────────────────────────────
function renderPotencializador(){
  const el=document.getElementById('pot-items');
  if(!el) return;
  el.innerHTML=items.filter(i=>i.status==='active').slice(0,5).map((i,idx)=>`
    <div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--surface2);border:1px solid var(--border);border-radius:9px">
      <div style="font-size:26px">${i.emoji}</div>
      <div style="flex:1"><div style="font-weight:600;font-size:13px">${i.name}</div><div style="font-size:11.5px;color:var(--muted);margin-top:2px">R$ ${i.price.toFixed(2).replace('.',',')} • ${i.cat}</div></div>
      <div style="font-size:12px;color:var(--accent3)">★ ${(4.2+idx*0.1).toFixed(1)}</div>
      <button class="btn bp" style="font-size:11px;padding:4px 9px" onclick="showToast('<svg width=\'14\' height=\'14\' viewBox=\'0 0 16 16\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'><path d=&quot;M2 12l3-3 2.5 2.5L12 5&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;1.4&quot; fill=&quot;none&quot; stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot;/><path d=&quot;M9 5h3v3&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;1.4&quot; fill=&quot;none&quot; stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot;/></svg>','${i.name} em destaque!')">Destacar</button>
    </div>`).join('');
}

// ─────────────────────────────────────────
// PDV
// ─────────────────────────────────────────
function renderPDV(){
  const g=document.getElementById('pdv-grid');
  if(!g) return;
  const q=(document.getElementById('pdv-search-input')||{}).value||'';
  const fil=items.filter(i=>i.status==='active'&&i.name.toLowerCase().includes(q.toLowerCase()));
  g.innerHTML=fil.map(i=>`
    <div class="pdv-item${i.itemType==='pizza'?' pdv-item-pizza':''}" onclick="${i.itemType==='pizza'?'openPDVPizza('+i.id+')':'addToCart('+i.id+')'}">
      <div class="pdv-emoji">${i.emoji||'🍽️'}</div>
      <div class="pdv-name">${i.name}${i.itemType==='pizza'?' <span style="font-size:9px;background:rgba(245,158,11,.15);color:var(--accent3);border-radius:4px;padding:1px 4px;font-weight:700">PIZZA</span>':''}</div>
      <div class="pdv-price">R$ ${i.price.toFixed(2).replace('.',',')}</div>
    </div>`).join('');
}

function addToCart(id){
  const it=items.find(i=>i.id===id);
  if(!it) return;
  if(it.itemType==='pizza'){ openPDVPizza(id); return; }
  const ci=cartItems.find(c=>c.id===id);
  if(ci) ci.qty++;
  else cartItems.push({...it,qty:1});
  renderCart();
  showToast('🛒',`${it.name} adicionado!`);
}

function renderCart(){
  const c=document.getElementById('cart-items');
  const tot=cartItems.reduce((s,i)=>s+i.price*i.qty,0);
  document.getElementById('cart-total').textContent='R$ '+tot.toFixed(2).replace('.',',');
  document.getElementById('cart-qty').textContent=`(${cartItems.reduce((s,i)=>s+i.qty,0)} itens)`;
  if(!c) return;
  if(cartItems.length===0){c.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:12.5px">Carrinho vazio<br>Clique nos itens para adicionar</div>';return;}
  c.innerHTML=cartItems.map((i,idx)=>`
    <div class="cart-item">
      <div class="ci-emoji">${i.emoji}</div>
      <div class="ci-info"><div class="ci-name">${i.name}</div><div class="ci-price">R$ ${(i.price*i.qty).toFixed(2).replace('.',',')}</div></div>
      <div class="qty-ctrl">
        <div class="qb" onclick="changeQty(${idx},-1)">−</div>
        <div class="qn">${i.qty}</div>
        <div class="qb" onclick="changeQty(${idx},1)">+</div>
      </div>
    </div>`).join('');
}

function changeQty(idx,delta){
  cartItems[idx].qty+=delta;
  if(cartItems[idx].qty<=0) cartItems.splice(idx,1);
  renderCart();
}

function clearCart(){cartItems=[];renderCart();}

async function finalizeSale() {
  const _ICON_WRN = _ICON_ERR;
  if (cartItems.length === 0) { sbToast('err','Carrinho vazio!'); return; }
  const tot  = cartItems.reduce((s,i) => s+i.price*i.qty, 0);
  const pay  = document.getElementById('pay-method').value;
  const time = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  const { data, error } = await sb.from('movimentos').insert({
    description: 'PDV – Balcão', tipo:'entrada', val:tot, pag:pay, time
  }).select().single();
  if (!error && data) movimentos.push({
    id:data.id, desc:'PDV – Balcão', tipo:'entrada', val:tot, pag:pay, time
  });
  playOrderSound();
  sbToast('ok',`Venda R$${tot.toFixed(2).replace('.',',')} finalizada!`);
  cartItems = []; renderCart();
}

// ─────────────────────────────────────────
// CHATBOT
// ─────────────────────────────────────────
function initChat(){
  if(chatInitialized) return;
  chatInitialized=true;
  addMsg('bot','Olá! Bem-vindo ao Estima Food!\n\nDigite: *cardapio*, *taxa*, *horario*, *pix*, *pedido*');
}

function addMsg(type,text){
  const msgs=document.getElementById('chat-msgs');
  if(!msgs) return;
  const div=document.createElement('div');
  div.className='msg '+type;
  div.style.whiteSpace='pre-wrap';
  div.textContent=text;
  msgs.appendChild(div);
  msgs.scrollTop=msgs.scrollHeight;
}

function sendChat(){
  const inp=document.getElementById('chat-in');
  const val=inp.value.trim();
  if(!val) return;
  addMsg('user',val);
  inp.value='';
  const msgs=document.getElementById('chat-msgs');
  const typing=document.createElement('div');
  typing.className='msg typing';
  typing.innerHTML='<div class="dots"><span></span><span></span><span></span></div>';
  msgs.appendChild(typing);
  msgs.scrollTop=msgs.scrollHeight;
  setTimeout(()=>{
    typing.remove();
    const lower=val.toLowerCase();
    let resp=null;
    for(const k of Object.keys(BOT_ANSWERS)){if(lower.includes(k)){resp=BOT_ANSWERS[k];break;}}
    if(!resp){
      const taxa=document.getElementById('taxa-input');
      resp=`Entendi! Recebemos: "${val}"\nTaxa de entrega: R$ ${taxa?taxa.value:'5,00'}. Como posso ajudar?`;
    }
    addMsg('bot',resp);
  },800+Math.random()*600);
}

function clearChat(){
  const m=document.getElementById('chat-msgs');
  if(m) m.innerHTML='';
  chatInitialized=false;
  initChat();
}

// ─────────────────────────────────────────
// QR CODE
// ─────────────────────────────────────────
function renderQR(){
  const g=document.getElementById('qr-grid');
  if(!g) return;
  document.getElementById('qr-free-cnt').textContent=tables.filter(t=>t.status==='free').length;
  document.getElementById('qr-busy-cnt').textContent=tables.filter(t=>t.status==='busy').length;
  document.getElementById('qr-wait-cnt').textContent=tables.filter(t=>t.status==='waiting').length;
  document.getElementById('qr-total-cnt').textContent=tables.length;
  g.innerHTML=tables.map(t=>{
    const sc=t.status==='free'?'qr-free':t.status==='busy'?'qr-busy':'qr-waiting';
    const sl=t.status==='free'?'Livre':t.status==='busy'?'Ocupada':'Aguardando';
    return`<div class="qr-table" onclick="openMesa(${t.num})">
      <div class="qr-num">Mesa ${t.num}</div>
      <div class="qr-status ${sc}">${sl}</div>
      <div class="qr-code"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="1" width="8" height="14" rx="1.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="12" r=".8" fill="currentColor"/></svg></div>
      ${t.guests?`<div style="font-size:11px;color:var(--muted)">${t.guests} pessoas • ${t.total}</div>`:'<div style="font-size:11px;color:var(--muted)">Escanear para pedir</div>'}
      <button class="btn bg" style="width:100%;justify-content:center;font-size:10.5px;margin-top:7px;padding:4px" onclick="event.stopPropagation();toggleMesaStatus(${t.num})">${t.status==='free'?'<svg width="10" height="10" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="5" fill="var(--danger)" opacity=".9"/></svg> Ocupar':'<svg width="10" height="10" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="5" fill="var(--accent3)" opacity=".9"/></svg> Liberar'}</button>
      <div style="display:flex;gap:5px;margin-top:5px">
        <button class="btn bg" style="flex:1;justify-content:center;font-size:10.5px;padding:4px;gap:4px" onclick="event.stopPropagation();openEditMesa(${t.num})">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-9 9H2v-3L11 2z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Editar
        </button>
        <button class="btn bd" style="flex:1;justify-content:center;font-size:10.5px;padding:4px;gap:4px" onclick="event.stopPropagation();qrDeleteMesa(${t.num})">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2.5A.5.5 0 0 1 6.5 2h3a.5.5 0 0 1 .5.5V4M5 4l.7 9.5a.5.5 0 0 0 .5.5h3.6a.5.5 0 0 0 .5-.5L11 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          Excluir
        </button>
      </div>
    </div>`;
  }).join('');
}

function openMesa(num){
  document.getElementById('modal-mesa-num').textContent=num;
  document.getElementById('modal-mesa-link').textContent=num;
  openModal('modal-mesa');
}

async function toggleMesaStatus(num) {
  const t = tables.find(x => x.num === num);
  if (!t) return;
  const newStatus = t.status === 'free' ? 'busy' : 'free';
  const newGuests = newStatus === 'busy' ? 2 : null;
  const { error } = await sb.from('mesas')
    .update({ status: newStatus, guests: newGuests, total: null, updated_at: new Date().toISOString() })
    .eq('num', num);
  if (!error) { t.status = newStatus; t.guests = newGuests; t.total = null; }
  renderQR();
}

async function addTable() {
  const num = tables.length ? Math.max(...tables.map(t=>t.num)) + 1 : 1;
  sbLoading(true);
  const { data, error } = await sb.from('mesas').insert({
    num, status: 'free'
  }).select().single();
  sbLoading(false);
  if (error) { sbToast('err','Erro ao criar mesa'); return; }
  tables.push({ num, status:'free', guests:null, total:null });
  renderQR();
  sbToast('ok',`Mesa ${num} criada!`);
}

function openModalNovaMesa() {
  const next = tables.length ? Math.max(...tables.map(t=>t.num)) + 1 : 1;
  document.getElementById('nova-mesa-num').value = next;
  document.getElementById('nova-mesa-guests').value = '';
  openModal('modal-nova-mesa');
}

async function saveNovaMesa() {
  const num    = parseInt(document.getElementById('nova-mesa-num').value);
  const guests = parseInt(document.getElementById('nova-mesa-guests').value) || null;
  if (!num || num < 1) { sbToast('err','Informe o número da mesa'); return; }
  if (tables.find(t => t.num === num)) { sbToast('err',`Mesa ${num} já existe`); return; }
  sbLoading(true);
  const { data, error } = await sb.from('mesas').insert({ num, status:'free', guests }).select().single();
  sbLoading(false);
  if (error) { sbToast('err','Erro ao criar mesa'); return; }
  tables.push({ num, status:'free', guests, total:null });
  tables.sort((a,b)=>a.num-b.num);
  closeModal('modal-nova-mesa');
  renderMesasPage();
  renderQR();
  sbToast('ok',`Mesa ${num} criada!`);
}

function openEditMesa(num) {
  const t = tables.find(x => x.num === num);
  if (!t) return;
  document.getElementById('edit-mesa-old-num').value  = num;
  document.getElementById('edit-mesa-num').value      = num;
  document.getElementById('edit-mesa-guests').value   = t.guests || '';
  document.getElementById('modal-edit-mesa-title').textContent = `✏️ Editar Mesa ${num}`;
  openModal('modal-edit-mesa');
}

async function saveMesaEdit() {
  const oldNum  = parseInt(document.getElementById('edit-mesa-old-num').value);
  const newNum  = parseInt(document.getElementById('edit-mesa-num').value);
  const guests  = parseInt(document.getElementById('edit-mesa-guests').value) || null;
  if (!newNum || newNum < 1) { sbToast('err','Informe o número da mesa'); return; }
  if (newNum !== oldNum && tables.find(t => t.num === newNum)) { sbToast('err',`Mesa ${newNum} já existe`); return; }
  sbLoading(true);
  const { error } = await sb.from('mesas').update({ num: newNum, guests }).eq('num', oldNum);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao salvar'); return; }
  const t = tables.find(x => x.num === oldNum);
  if (t) { t.num = newNum; t.guests = guests; }
  tables.sort((a,b)=>a.num-b.num);
  closeModal('modal-edit-mesa');
  renderMesasPage();
  renderQR();
  sbToast('ok',`Mesa atualizada!`);
}

async function confirmDeleteMesa() {
  const num = parseInt(document.getElementById('edit-mesa-old-num').value);
  if (!confirm(`Excluir Mesa ${num}? Esta ação não pode ser desfeita.`)) return;
  sbLoading(true);
  const { error } = await sb.from('mesas').delete().eq('num', num);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao excluir'); return; }
  tables = tables.filter(t => t.num !== num);
  closeModal('modal-edit-mesa');
  renderMesasPage();
  renderQR();
  sbToast('ok',`Mesa ${num} excluída!`);
}

async function qrDeleteMesa(num) {
  if (!confirm(`Excluir Mesa ${num}? Esta ação não pode ser desfeita.`)) return;
  sbLoading(true);
  const { error } = await sb.from('mesas').delete().eq('num', num);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao excluir'); return; }
  tables = tables.filter(t => t.num !== num);
  renderMesasPage();
  renderQR();
  sbToast('ok', `Mesa ${num} excluída!`);
}

// MESAS PAGE — pedidos agrupados por mesa
let mesaAutoAccept = false;

function toggleMesaAutoAccept(el) {
  el.classList.toggle('on');
  mesaAutoAccept = el.classList.contains('on');
  sbToast('ok', mesaAutoAccept ? 'Pedidos aceitos automaticamente' : 'Aceite automático desativado');
}

async function renderMesasPage() {
  // Stats
  const livres     = tables.filter(t => t.status === 'free').length;
  const ocupadas   = tables.filter(t => t.status === 'busy').length;
  const aguardando = tables.filter(t => t.status === 'waiting').length;
  const elv = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  elv('pm-stat-livres', livres);
  elv('pm-stat-ocupadas', ocupadas);
  elv('pm-stat-aguardando', aguardando);

  const grid = document.getElementById('pm-mesas-grid');
  if (!grid) return;

  const activeTables = tables.filter(t => t.status !== 'free');
  if (!activeTables.length) {
    grid.innerHTML = '<div style="text-align:center;padding:60px;color:var(--muted);font-size:13px"><div style="font-size:40px;margin-bottom:12px">🍽️</div>Nenhuma mesa ocupada no momento</div>';
    return;
  }

  // Busca pedidos ativos de todas as mesas ocupadas
  const { data: orders } = await sb.from('orders')
    .select('*')
    .not('mesa_num', 'is', null)
    .in('status', ['analise', 'producao', 'pronto'])
    .order('id', { ascending: true });

  const allOrders = orders || [];

  // Filtra por sessão usando opened_at (campo dedicado — nunca muda durante a sessão)
  const sessionOrders = allOrders.filter(o => {
    const mesa = activeTables.find(t => t.num === parseInt(o.mesa_num));
    if (!mesa || !mesa.opened_at) return true;
    return new Date(o.created_at || 0).getTime() >= new Date(mesa.opened_at).getTime() - 5000;
  });

  // Popula o cache local com os dados da sessão atual (já filtrados)
  mesaOrdersCache = sessionOrders;

  // Usa renderização inteligente (sem piscar)
  _renderMesaPageFromCache();
}

function renderMesaCard(t, orders) {
  const isWaiting = t.status === 'waiting';
  const total = orders.reduce((s, o) => s + parseFloat(o.total || 0), 0);

  const bordColor = isWaiting ? 'rgba(245,158,11,.4)' : 'rgba(59,130,246,.25)';
  const statusLabel = isWaiting
    ? '<span style="font-size:11px;font-weight:700;color:var(--accent3)">⏳ Aguardando pagamento</span>'
    : '<span style="font-size:11px;font-weight:700;color:var(--accent)">🔵 Ocupada</span>';

  const ordersHtml = orders.length
    ? orders.map(o => {
        const items = Array.isArray(o.items) ? o.items : [];
        const itemStr = items.map(i => `${i.drink ? '🥤' : '🍴'} ${i.qty}× ${i.name}`).join('  ');
        const isNew  = o.status === 'analise';
        const isProd = o.status === 'producao';
        const isRdy  = o.status === 'pronto';
        const stColor = isNew ? 'var(--orange)' : isProd ? 'var(--accent)' : 'var(--success)';
        const stLabel = isNew ? '🆕 Novo' : isProd ? '🍳 Preparando' : '✅ Pronto';

        let btns = '';
        if (isNew) {
          btns = `<div style="display:flex;gap:5px;margin-top:7px">
            <button class="oc-btn oc-btn-ok" onclick="mesaAdvanceOrder(${o.id})">✔ Confirmar</button>
            <button class="oc-btn oc-btn-no" onclick="mesaCancelOrder(${o.id})">✕ Cancelar</button>
          </div>`;
        } else if (isProd || isRdy) {
          btns = `<div style="margin-top:7px">
            <button class="oc-btn oc-btn-ok" style="width:100%" onclick="mesaServOrder(${o.id})">✓ Entregue</button>
          </div>`;
        }

        return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:10px 12px;margin-bottom:7px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <span style="font-size:10.5px;font-weight:700;color:${stColor};background:${stColor}1a;padding:2px 8px;border-radius:99px">${stLabel}</span>
            <span style="font-size:10.5px;color:var(--muted)">#${o.num} · ${o.time || ''}</span>
          </div>
          <div style="font-size:12.5px;color:var(--text);line-height:1.6">${itemStr}</div>
          <div style="font-size:12px;font-weight:700;color:var(--accent3);text-align:right;margin-top:4px">R$ ${(parseFloat(o.total) || 0).toFixed(2).replace('.', ',')}</div>
          ${btns}
        </div>`;
      }).join('')
    : isWaiting
      // Mesa aguardando pagamento: busca resumo do consumo do cache ou banco
      ? (function() {
          // Tenta montar resumo dos pedidos entregues desta sessão
          const sessionStart = t.opened_at ? new Date(t.opened_at).getTime() - 5000 : 0;
          const allSessionOrders = mesaOrdersCache.filter(o =>
            parseInt(o.mesa_num) === parseInt(t.num) &&
            new Date(o.created_at || 0).getTime() >= sessionStart
          );
          if (!allSessionOrders.length) {
            return `<div style="color:var(--muted);font-size:12.5px;text-align:center;padding:10px 0">Consumo registrado — clique em registrar para detalhes</div>`;
          }
          // Monta lista consolidada de todos os itens
          const itemMap = {};
          allSessionOrders.forEach(o => {
            (Array.isArray(o.items) ? o.items : []).forEach(i => {
              const key = i.name;
              if (!itemMap[key]) itemMap[key] = { name:i.name, qty:0, total:0, drink:!!i.drink };
              itemMap[key].qty += (i.qty||1);
              itemMap[key].total += (i.price||0) * (i.qty||1);
            });
          });
          const rows = Object.values(itemMap).map(i =>
            `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04)">
              <span>${i.drink?'🥤':'🍴'} ${i.qty}× ${i.name}</span>
              <span style="color:var(--accent3);font-weight:600">R$ ${i.total.toFixed(2).replace('.',',')}</span>
            </div>`
          ).join('');
          return `<div style="background:var(--surface2);border:1px solid rgba(245,158,11,.2);border-radius:9px;padding:10px 12px;margin-bottom:4px">
            <div style="font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px">📋 Resumo do consumo</div>
            ${rows}
          </div>`;
        })()
      : `<div style="color:var(--muted);font-size:12.5px;text-align:center;padding:14px 0">Nenhum pedido ativo</div>`;

  // Se mesa está waiting, usa t.total gravado pelo garçom/fecharMesa
  // Se mesa está busy, usa total do cache atual
  let displayTotal = total; // padrão: soma do cache
  if (isWaiting && t.total) {
    // total pode vir como número (novo) ou string 'R$ 99,90' (legado)
    const raw = typeof t.total === 'string'
      ? parseFloat(t.total.replace('R$','').replace(',','.').trim())
      : parseFloat(t.total);
    if (!isNaN(raw) && raw > 0) displayTotal = raw;
  }

  const actionBtn = isWaiting
    ? `<button onclick="openRegistrarPagamento(${t.num}, ${displayTotal.toFixed(2)})" style="width:100%;margin-top:4px;padding:11px;border-radius:9px;border:none;background:linear-gradient(135deg,var(--accent3),#d97706);color:#000;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;cursor:pointer">
        💰 Registrar pagamento — R$ ${displayTotal.toFixed(2).replace('.', ',')}
      </button>`
    : `<div style="display:flex;gap:8px;margin-top:8px">
        <button onclick="openGarcomMesa(${t.num})" class="btn bp" style="flex:1;justify-content:center;font-size:12px">➕ Lançar pedido</button>
        <button onclick="fecharMesa(${t.num})" style="flex:1;padding:7px;border-radius:8px;border:none;background:linear-gradient(135deg,var(--accent3),#d97706);color:#000;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer">💰 Fechar mesa</button>
      </div>`;

  return `<div style="background:var(--surface);border:1.5px solid ${bordColor};border-radius:14px;padding:16px;margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="font-family:'Playfair Display',sans-serif;font-size:20px;font-weight:900">Mesa ${t.num}</div>
        ${t.guests ? `<span style="font-size:11.5px;color:var(--muted)">${t.guests} pessoas</span>` : ''}
        ${statusLabel}
        <button onclick="event.stopPropagation();openEditMesa(${t.num})" style="margin-left:4px;background:none;border:1px solid var(--border);border-radius:6px;padding:2px 7px;color:var(--muted);cursor:pointer;font-size:11px;font-family:'DM Sans',sans-serif" title="Editar mesa">✏️</button>
      </div>
      <div style="font-family:'Playfair Display',sans-serif;font-size:20px;font-weight:900;color:var(--accent3)">R$ ${displayTotal.toFixed(2).replace('.', ',')}</div>
    </div>
    ${ordersHtml}
    ${actionBtn}
  </div>`;
}

async function mesaAdvanceOrder(id) {
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'producao', tenant_id: _sessao?.tenant_id })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Erro');
    const o  = ordersKanban.find(x => x.id === id);
    const co = mesaOrdersCache.find(x => x.id === id);
    if (o)  o.status  = 'producao';
    if (co) co.status = 'producao';
    _renderMesaPageFromCache();
  } catch(e) { sbToast('err', 'Erro ao atualizar pedido: ' + e.message); }
}

async function mesaServOrder(id) {
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'entregue', tenant_id: _sessao?.tenant_id })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Erro');
    ordersKanban      = ordersKanban.filter(x => x.id !== id);
    mesaOrdersCache   = mesaOrdersCache.filter(x => x.id !== id);
    renderKanban();
    _renderMesaPageFromCache();
    sbToast('ok', 'Pedido entregue ✓');
  } catch(e) { sbToast('err', 'Erro ao atualizar pedido: ' + e.message); }
}

async function mesaCancelOrder(id) {
  if (!confirm('Cancelar este pedido?')) return;
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'cancelado', tenant_id: _sessao?.tenant_id })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Erro');
    ordersKanban    = ordersKanban.filter(x => x.id !== id);
    mesaOrdersCache = mesaOrdersCache.filter(x => x.id !== id);
    _renderMesaPageFromCache();
    sbToast('ok', 'Pedido cancelado');
  } catch(e) { sbToast('err', 'Erro ao cancelar: ' + e.message); }
}

// ─────────────────────────────────────────
// ─────────────────────────────────────────



// ─────────────────────────────────────────
// CUPONS
// ─────────────────────────────────────────
function renderCupons(){
  const el=document.getElementById('cupom-list');
  if(!el) return;
  document.getElementById('cupom-count').textContent=cupons.filter(c=>c.ativo).length;
  el.innerHTML=cupons.map((c,i)=>`
    <div class="coupon-card">
      <div class="coupon-icon" style="background:${c.ativo?'rgba(34,197,94,.12)':'rgba(100,116,139,.1)'}"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><path d="M2 6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1a2 2 0 0 0 0 4v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-1a2 2 0 0 0 0-4V6z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 4v2M10 10v2" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div style="flex:1">
        <div class="coupon-code">${c.code}</div>
        <div class="coupon-desc">${c.tipo==='%'?c.val+'% de desconto':c.tipo==='frete'?'Frete grátis':'Desconto R$'+c.val}</div>
        <div class="coupon-use">Usado ${c.usos}x • ${c.minimo>0?'Pedido mín. R$'+c.minimo:'Sem pedido mínimo'}</div>
      </div>
      <span class="chip ${c.ativo?'chip-green':'chip-red'}">${c.ativo?'● Ativo':'● Inativo'}</span>
      <button class="btn bg" style="font-size:11px;padding:3px 8px" onclick="toggleCupom(${i})">${c.ativo?'Pausar':'Ativar'}</button>
      <button class="btn bd" style="font-size:11px;padding:3px 8px" onclick="deleteCupom(${i})"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><path d="M3 4h10M6 4V2.5A.5.5 0 0 1 6.5 2h3a.5.5 0 0 1 .5.5V4M5 4l.7 9.5a.5.5 0 0 0 .5.5h3.6a.5.5 0 0 0 .5-.5L11 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div>`).join('');
}

function toggleCupom(i){cupons[i].ativo=!cupons[i].ativo;renderCupons();showToast(cupons[i].ativo?'✅':'⏸️',`Cupom ${cupons[i].code} ${cupons[i].ativo?'ativado':'pausado'}!`);}
async function deleteCupom(idx) {
  const c = cupons[idx];
  if (!c) return;
  const { error } = await sb.from('cupons').delete().eq('id', c.id);
  if (!error) cupons.splice(idx, 1);
  renderCupons();
  showToast(_ICON_TRS,'Cupom removido');
}
async function addCupom() {
  const code = (document.getElementById('cupom-code').value||'').toUpperCase().trim();
  const val  = parseFloat(document.getElementById('cupom-val').value) || 0;
  const tipo = document.getElementById('cupom-tipo').value.includes('%') ? '%' : 'frete';
  if (!code) { sbToast('err','Informe o código'); return; }
  sbLoading(true);
  const { data, error } = await sb.from('cupons').insert({
    code, type: tipo === '%' ? 'percent' : 'fixed', value: val, min_order: 0, uses_left: -1, ativo: true
  }).select().single();
  sbLoading(false);
  if (error) { sbToast('err', error.code==='23505'?'Código já existe':'Erro ao criar cupom'); return; }
  cupons.push({id:data.id,code,tipo,val,minimo:0,usos:0,ativo:true});
  closeModal('modal-add-cupom');
  document.getElementById('cupom-code').value = '';
  renderCupons();
  sbToast('ok','Cupom criado!');
}

// ─────────────────────────────────────────
// FIDELIDADE
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// FIDELIDADE — REAL
// ─────────────────────────────────────────
let _fidConfig = { pts_por_real: 10, meta_pts: 500, recompensa_reais: 10 };

async function loadFidConfig() {
  try {
    const { data } = await sb.from('store_config').select('fid_config').single();
    if (data?.fid_config) _fidConfig = { ..._fidConfig, ...data.fid_config };
  } catch(e) {}
}

async function saveFidConfig() {
  const pts  = parseInt(document.getElementById('fid-cfg-pts')?.value) || 10;
  const meta = parseInt(document.getElementById('fid-cfg-meta')?.value) || 500;
  const rec  = parseFloat(document.getElementById('fid-cfg-rec')?.value) || 10;
  _fidConfig = { pts_por_real: pts, meta_pts: meta, recompensa_reais: rec };
  await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, fid_config: _fidConfig });
  // Atualiza max_pts de todos os clientes
  await sb.from('fidelidade').update({ max_pts: meta }).gte('id', 0);
  fidClients.forEach(c => c.max = meta);
  closeModal('modal-fid-config');
  renderFidelidade();
  sbToast('ok', 'Configurações salvas!');
}

function renderFidelidade() {
  const search = (document.getElementById('fid-search')?.value || '').toLowerCase();
  const filtered = fidClients.filter(c => c.name.toLowerCase().includes(search) || (c.phone||'').includes(search));

  // Stats
  const elv = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  const totalPts = fidClients.reduce((s,c)=>s+c.pts,0);
  const resgatados = fidClients.filter(c=>c.resgates>0).length;
  const perto = fidClients.filter(c=>c.pts >= c.max * 0.8 && c.pts < c.max).length;
  elv('fid-stat-total', fidClients.length);
  elv('fid-stat-pts', totalPts.toLocaleString('pt-BR'));
  elv('fid-stat-resgatados', resgatados);
  elv('fid-stat-perto', perto);

  const c = document.getElementById('fid-clients');
  if (!c) return;

  if (!filtered.length) {
    c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px">Nenhum cliente encontrado</div>';
    return;
  }

  c.innerHTML = filtered
    .sort((a,b) => b.pts - a.pts)
    .map(cl => {
      const pct = Math.min(100, (cl.pts / cl.max) * 100);
      const canResgatar = cl.pts >= cl.max;
      const barColor = canResgatar ? 'var(--success)' : pct >= 80 ? 'var(--accent3)' : 'var(--accent)';
      const initials = cl.name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
      return `<div style="background:var(--surface);border:1px solid ${canResgatar?'rgba(34,197,94,.3)':'var(--border)'};border-radius:12px;padding:14px;margin-bottom:10px;display:flex;align-items:center;gap:14px">
        <div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,var(--accent),var(--purple));display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0">${initials}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
            <div style="font-weight:700;font-size:13.5px">${cl.name}</div>
            ${canResgatar ? '<span style="font-size:10px;background:rgba(34,197,94,.15);color:var(--success);padding:1px 6px;border-radius:99px;font-weight:700">🎁 PODE RESGATAR</span>' : ''}
          </div>
          <div style="font-size:11.5px;color:var(--muted);margin-bottom:6px">${cl.phone||'Sem telefone'} · ${cl.orders} pedidos · ${cl.resgates||0} resgates</div>
          <div style="background:var(--surface2);border-radius:99px;height:6px;overflow:hidden;margin-bottom:3px">
            <div style="width:${pct}%;height:100%;background:${barColor};border-radius:99px;transition:width .4s"></div>
          </div>
          <div style="font-size:10.5px;color:var(--muted)">${cl.pts} / ${cl.max} pontos (${pct.toFixed(0)}%) • recompensa: R$ ${_fidConfig.recompensa_reais.toFixed(2).replace('.',',')}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
          <button class="btn bg" style="font-size:11px;padding:4px 10px" onclick="openAddPts(${cl.id},'${cl.name.replace(/'/g,"\'")}',${cl.pts})">+ Pontos</button>
          ${canResgatar ? `<button class="btn bs" style="font-size:11px;padding:4px 10px" onclick="openResgatar(${cl.id},'${cl.name.replace(/'/g,"\'")}',${cl.pts},${cl.max})">🎁 Resgatar</button>` : ''}
          <button class="btn bd" style="font-size:11px;padding:4px 10px" onclick="deleteFidClient(${cl.id},'${cl.name.replace(/'/g,"\'")}')">✕</button>
        </div>
      </div>`;
    }).join('');

  // Preenche config modal com valores atuais
  const cp = document.getElementById('fid-cfg-pts');
  const cm = document.getElementById('fid-cfg-meta');
  const cr = document.getElementById('fid-cfg-rec');
  if (cp) cp.value = _fidConfig.pts_por_real;
  if (cm) cm.value = _fidConfig.meta_pts;
  if (cr) cr.value = _fidConfig.recompensa_reais;
}

function openAddPts(id, name, currentPts) {
  document.getElementById('modal-pts-client-id').value = id;
  document.getElementById('modal-pts-client-name').textContent = name;
  document.getElementById('modal-pts-current').textContent = currentPts + ' pontos atuais';
  document.getElementById('modal-pts-qty').value = '';
  document.getElementById('modal-pts-motivo').value = '';
  openModal('modal-add-pts');
}

async function confirmAddPts() {
  const id    = parseInt(document.getElementById('modal-pts-client-id').value);
  const qty   = parseInt(document.getElementById('modal-pts-qty').value) || 0;
  const motivo= document.getElementById('modal-pts-motivo').value;
  if (!qty || qty < 1) { sbToast('err','Informe os pontos'); return; }
  const cl = fidClients.find(c => c.id === id);
  if (!cl) return;
  const newPts = cl.pts + qty;
  const { error } = await sb.from('fidelidade').update({ pts: newPts }).eq('id', id);
  if (error) { sbToast('err','Erro ao adicionar pontos'); return; }
  cl.pts = newPts;
  closeModal('modal-add-pts');
  renderFidelidade();
  sbToast('ok', `+${qty} pontos para ${cl.name}!`);
  if (newPts >= cl.max) sbToast('ok', `🎁 ${cl.name} pode resgatar a recompensa!`);
}

function openResgatar(id, name, pts, max) {
  document.getElementById('modal-resg-id').value = id;
  document.getElementById('modal-resg-name').textContent = name;
  document.getElementById('modal-resg-valor').textContent = 'R$ ' + _fidConfig.recompensa_reais.toFixed(2).replace('.',',') + ' de desconto';
  document.getElementById('modal-resg-pts').textContent = pts + ' pontos serão zerados';
  openModal('modal-resgatar');
}

async function confirmResgatar() {
  const id = parseInt(document.getElementById('modal-resg-id').value);
  const cl = fidClients.find(c => c.id === id);
  if (!cl) return;
  const { error } = await sb.from('fidelidade').update({ pts: 0, resgates: (cl.resgates||0)+1 }).eq('id', id);
  if (error) { sbToast('err','Erro ao resgatar'); return; }
  cl.pts = 0;
  cl.resgates = (cl.resgates||0)+1;
  closeModal('modal-resgatar');
  renderFidelidade();
  sbToast('ok', `🎁 Recompensa resgatada para ${cl.name}!`);
}

async function addFidClient() {
  const name  = document.getElementById('fid-add-name').value.trim();
  const phone = document.getElementById('fid-add-phone').value.trim();
  if (!name) { sbToast('err','Informe o nome'); return; }
  const { data, error } = await sb.from('fidelidade').insert({
    name, phone, pts: 0, max_pts: _fidConfig.meta_pts, orders_count: 0, resgates: 0
  }).select().single();
  if (error) { sbToast('err','Erro ao cadastrar'); return; }
  fidClients.unshift({ id:data.id, name:data.name, phone:data.phone, pts:0, max:_fidConfig.meta_pts, orders:0, resgates:0 });
  closeModal('modal-add-fid-client');
  document.getElementById('fid-add-name').value = '';
  document.getElementById('fid-add-phone').value = '';
  renderFidelidade();
  sbToast('ok', `${name} cadastrado no programa!`);
}

async function deleteFidClient(id, name) {
  if (!confirm(`Remover ${name} do programa de fidelidade?`)) return;
  const { error } = await sb.from('fidelidade').delete().eq('id', id);
  if (error) { sbToast('err','Erro ao remover'); return; }
  fidClients = fidClients.filter(c => c.id !== id);
  renderFidelidade();
  sbToast('ok', `${name} removido do programa`);
}

// Chamado ao confirmar pagamento — adiciona pontos automaticamente se cliente estiver no programa
async function _autoAddFidPoints(clientPhone, totalVal) {
  if (!clientPhone || !totalVal) return;
  const cl = fidClients.find(c => c.phone && c.phone.replace(/\D/g,'') === clientPhone.replace(/\D/g,''));
  if (!cl) return;
  const pts = Math.floor(totalVal * _fidConfig.pts_por_real);
  if (pts < 1) return;
  const newPts = cl.pts + pts;
  await sb.from('fidelidade').update({ pts: newPts, orders_count: cl.orders+1 }).eq('id', cl.id);
  cl.pts = newPts; cl.orders++;
  sbToast('ok', `⭐ +${pts} pontos fidelidade para ${cl.name}`);
  if (newPts >= cl.max) sbToast('ok', `🎁 ${cl.name} atingiu a recompensa!`);
}


// ─────────────────────────────────────────
// GARÇOM
// ─────────────────────────────────────────
function renderGarcom(){
  const g=document.getElementById('garcom-grid');
  if(!g) return;
  g.innerHTML=tables.map(t=>{
    const sc=t.status==='free'?'qr-free':'qr-busy';
    const bg=t.status==='free'?'rgba(34,197,94,.08)':'rgba(239,68,68,.08)';
    return`<div class="garcom-mesa" style="background:${bg}" onclick="openGarcomMesa(${t.num})">
      <div class="gm-num">Mesa ${t.num}</div>
      <div class="gm-guests">${t.guests?t.guests+' pessoas':''}</div>
      <div class="gm-status ${sc}">${t.status==='free'?'Livre':'Ocupada'}</div>
      ${t.total&&t.status==='busy'?`<div style="font-size:12px;font-weight:700;color:var(--success);margin-top:5px">${t.total}</div>`:''}
      <button class="btn bp" style="width:100%;justify-content:center;font-size:11.5px;margin-top:9px;padding:5px">➕ Lançar pedido</button>
    </div>`;
  }).join('');
}

function openGarcomMesa(num){
  garcomMesa=num;garcomCart=[];
  document.getElementById('garcom-mesa-num').textContent=num;
  const gg=document.getElementById('garcom-item-grid');
  gg.innerHTML=items.filter(i=>i.status==='active').map(i=>`
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:9px;text-align:center;cursor:pointer;transition:all .15s" onclick="garcomAddItem(${i.id},this)" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="if(!this.dataset.sel)this.style.borderColor='var(--border)'">
      <div style="font-size:22px">${i.emoji}</div>
      <div style="font-size:11px;font-weight:600;margin-top:3px">${i.name}</div>
      <div style="font-size:10.5px;color:var(--accent)">R$ ${i.price.toFixed(2).replace('.',',')}</div>
    </div>`).join('');
  document.getElementById('garcom-cart-preview').textContent='Nenhum item selecionado';
  openModal('modal-garcom-mesa');
}

function garcomAddItem(id,el){
  const it=items.find(i=>i.id===id);
  const ci=garcomCart.find(c=>c.id===id);
  if(ci) ci.qty++;else garcomCart.push({...it,qty:1});
  el.style.borderColor='var(--accent)';el.dataset.sel='1';el.style.background='rgba(59,130,246,.1)';
  const prev=document.getElementById('garcom-cart-preview');
  prev.innerHTML=garcomCart.map(c=>`${c.qty}x ${c.name}`).join(' • ')
    +`<br><strong style="color:var(--success)">Total: R$ ${garcomCart.reduce((s,c)=>s+c.price*c.qty,0).toFixed(2).replace('.',',')}</strong>`;
}

async function submitGarcomOrder(){
  if(garcomCart.length===0){sbToast('err','Selecione itens');return;}
  const tot=garcomCart.reduce((s,c)=>s+c.price*c.qty,0);
  const t=tables.find(x=>x.num===garcomMesa);
  const itemsArr=garcomCart.map(c=>({qty:c.qty,name:c.name,price:c.price,obs:''}));
  const time=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  sbLoading(true);
  try {
    // Verifica e grava opened_at ANTES de inserir o pedido
    const _mesaBeforeInsert = tables.find(t => t.num === garcomMesa);
    if (_mesaBeforeInsert && _mesaBeforeInsert.status !== 'busy') {
      const _ot = new Date().toISOString();
      await sb.from('mesas').update({ status:'busy', opened_at: _ot, updated_at: _ot }).eq('num', garcomMesa);
      _mesaBeforeInsert.status = 'busy'; _mesaBeforeInsert.opened_at = _ot; _mesaBeforeInsert.updated_at = _ot;
    }
    const { data: orderData, error: oErr } = await sb.from('orders').insert({
      client:`Mesa ${garcomMesa}`, phone:'', addr:`Mesa ${garcomMesa}`,
      mesa_num: garcomMesa, items:itemsArr, total:tot, taxa:0,
      status: mesaAutoAccept ? 'producao' : 'analise', time, pag:'Mesa'
    }).select().single();
    if(oErr) throw oErr;
    // opened_at já tratado antes do insert
    if(t){t.status='busy'; t.guests=t.guests||2;}
    ordersKanban.push(mapOrder(orderData));
    closeModal('modal-garcom-mesa');
    renderGarcom();
    renderMesasPage();
    playOrderSound();
    sbToast('ok',`Pedido Mesa ${garcomMesa} enviado para cozinha!`);
  } catch(e){
    sbToast('err','Erro ao enviar pedido');
    console.error(e);
  } finally { sbLoading(false); }
}

// ─────────────────────────────────────────
// KDS
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// KDS COMPLETO
// ─────────────────────────────────────────
let kdsFilter  = 'todos';
let kdsTimers  = {}; // id → { startTs, extra }
let _kdsInterval = null;
let _kdsFullscreen = false;

function kdsSetFilter(f) {
  kdsFilter = f;
  ['todos','mesa','delivery','balcao'].forEach(k => {
    const el = document.getElementById('kds-f-'+k);
    if (el) el.classList.toggle('on', k === f);
  });
  renderKDS();
}

function kdsToggleFullscreen() {
  const inner = document.getElementById('kds-inner');
  if (!inner) return;
  _kdsFullscreen = !_kdsFullscreen;
  if (_kdsFullscreen) {
    inner.classList.add('kds-fullscreen');
    document.body.style.overflow = 'hidden';
  } else {
    inner.classList.remove('kds-fullscreen');
    document.body.style.overflow = '';
  }
}

function _kdsOrderType(o) {
  const addr = (o.addr || '').toLowerCase();
  if (o.mesa_num || addr.includes('mesa')) return 'mesa';
  if (addr.includes('balcão') || addr.includes('balcao') || addr.includes('pdv')) return 'balcao';
  return 'delivery';
}

function _kdsElapsed(o) {
  const t = kdsTimers[o.id];
  const extra = t?.extra || 0;
  const startMs = t?.startTs || Date.now();
  return Math.floor((Date.now() - startMs) / 1000) + extra;
}

function _kdsFormatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function kdsAddTime(id, extra = 300) {
  if (!kdsTimers[id]) kdsTimers[id] = { startTs: Date.now(), extra: 0 };
  kdsTimers[id].extra -= extra; // subtrai para "ganhar" mais tempo
  renderKDS();
}

function renderKDS() {
  const g = document.getElementById('kds-grid');
  if (!g) return;

  // Para/reinicia timer de atualização
  if (_kdsInterval) clearInterval(_kdsInterval);
  _kdsInterval = setInterval(() => _kdsUpdateTimers(), 1000);

  // Filtra pedidos
  let orders = ordersKanban.filter(o => o.status === 'producao' || o.status === 'analise');
  if (kdsFilter === 'mesa')     orders = orders.filter(o => _kdsOrderType(o) === 'mesa');
  if (kdsFilter === 'delivery') orders = orders.filter(o => _kdsOrderType(o) === 'delivery');
  if (kdsFilter === 'balcao')   orders = orders.filter(o => _kdsOrderType(o) === 'balcao');

  // Ordena: analise primeiro, depois por tempo (mais antigos primeiro)
  orders.sort((a, b) => {
    if (a.status === 'analise' && b.status !== 'analise') return -1;
    if (b.status === 'analise' && a.status !== 'analise') return  1;
    return _kdsElapsed(b) - _kdsElapsed(a);
  });

  // Inicializa timers para novos pedidos
  orders.forEach(o => {
    if (!kdsTimers[o.id]) kdsTimers[o.id] = { startTs: Date.now(), extra: 0 };
  });

  // Atualiza stats
  const late = orders.filter(o => _kdsElapsed(o) > 900).length; // >15min
  const newOrders = orders.filter(o => o.status === 'analise').length;
  const sEl = id => { const e = document.getElementById(id); return e; };
  const se = (id, v) => { const e = sEl(id); if (e && e.textContent !== String(v)) e.textContent = v; };
  se('kds-cnt-total', orders.length);
  se('kds-cnt-new',   newOrders);
  se('kds-cnt-late',  late);

  if (!orders.length) {
    g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:80px 20px;color:var(--muted)"><div style="font-size:52px;margin-bottom:16px">✅</div><div style="font-size:16px;font-weight:600">Cozinha vazia</div><div style="font-size:13px;margin-top:6px">Nenhum pedido em preparo no momento</div></div>';
    return;
  }

  g.innerHTML = orders.map(o => {
    const type    = _kdsOrderType(o);
    const elapsed = _kdsElapsed(o);
    const isNew   = o.status === 'analise';
    const isLate  = elapsed > 900;
    const isWarn  = elapsed > 480 && !isLate;
    const cardCls = isNew ? 'st-new' : isLate ? 'st-late' : isWarn ? 'st-ok' : '';
    const timerCls= isLate ? 't-late' : isWarn ? 't-warn' : 't-ok';
    const typeLabel = type === 'mesa' ? `🍽️ ${o.addr||('Mesa '+(o.mesa_num||''))}` : type === 'balcao' ? '🏠 Balcão' : '🛵 Delivery';
    const typeCls   = 'kds-type-'+type;
    const items = Array.isArray(o.items) ? o.items : [];

    const itemsHtml = items.map(i => {
      const isDrink = !!i.drink;
      return `<div class="kds-item2">
        <span class="kds-item2-qty">${i.qty}×</span>
        <div>
          <div class="kds-item2-name ${isDrink ? 'kds-item2-drink' : ''}">${isDrink ? '🥤 ' : ''}${i.name.toUpperCase()}</div>
          ${i.obs ? `<div class="kds-item2-obs">⚠️ ${i.obs}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    const actionBtns = isNew
      ? `<button class="kds-btn-pronto" style="background:var(--orange)" onclick="kdsConfirm(${o.id})">✔ Confirmar</button>
         <button class="kds-btn-mais" onclick="kdsCancelOrder(${o.id})" style="color:var(--danger)">✕</button>`
      : `<button class="kds-btn-pronto" onclick="kdsMarkPronto(${o.id})">✅ Pronto</button>
         <button class="kds-btn-mais" onclick="kdsAddTime(${o.id})" title="+5 min">+5min</button>`;

    return `<div class="kds-card2 ${cardCls}" id="kds-card-${o.id}">
      <div class="kds-card2-head">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="kds-card2-id">#${o.num}</div>
          <span class="kds-card2-type ${typeCls}">${typeLabel}</span>
          ${isNew ? '<span style="font-size:9px;background:rgba(249,115,22,.2);color:#fed7aa;padding:1px 5px;border-radius:99px;font-weight:700;animation:blink .6s step-end infinite">NOVO</span>' : ''}
        </div>
        <div class="kds-timer ${timerCls}" id="kds-timer-${o.id}">${_kdsFormatTime(elapsed)}</div>
      </div>
      <div class="kds-card2-body">
        <div class="kds-card2-client">${o.client || ''}${o.phone ? ' · ' + o.phone : ''}</div>
        ${itemsHtml}
      </div>
      <div class="kds-card2-foot">${actionBtns}</div>
    </div>`;
  }).join('');

  // Tempo médio
  if (orders.length > 0) {
    const avg = Math.round(orders.reduce((s,o) => s + _kdsElapsed(o), 0) / orders.length);
    se('kds-avg-time', _kdsFormatTime(avg));
  }
}

function _kdsUpdateTimers() {
  // Atualiza só os timers sem re-renderizar tudo (evita piscar)
  ordersKanban
    .filter(o => o.status === 'producao' || o.status === 'analise')
    .forEach(o => {
      const el = document.getElementById('kds-timer-' + o.id);
      if (!el) return;
      const elapsed = _kdsElapsed(o);
      const isLate = elapsed > 900;
      const isWarn = elapsed > 480 && !isLate;
      el.textContent = _kdsFormatTime(elapsed);
      el.className = 'kds-timer ' + (isLate ? 't-late' : isWarn ? 't-warn' : 't-ok');
    });
}

async function kdsConfirm(id) {
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'producao', tenant_id: _sessao?.tenant_id })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Erro');
    const o = ordersKanban.find(x => x.id === id);
    if (o) o.status = 'producao';
    const card = document.getElementById('kds-card-' + id);
    if (card) card.classList.remove('st-new');
    renderKDS();
    sbToast('ok', `Pedido #${_orderNum(id)} em preparo`);
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
}

async function kdsMarkPronto(id) {
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'pronto', tenant_id: _sessao?.tenant_id })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Erro');
    const o = ordersKanban.find(x => x.id === id);
    if (o) o.status = 'pronto';
    delete kdsTimers[id];
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [[660,0],[880,.1],[1100,.2]].forEach(([f,t]) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = f; gain.gain.setValueAtTime(.3, ctx.currentTime+t);
        gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime+t+.15);
        osc.start(ctx.currentTime+t); osc.stop(ctx.currentTime+t+.2);
      });
    } catch(e){}
    renderKDS(); renderKanban();
    sbToast('ok', `Pedido #${_orderNum(id)} pronto! ✅`);
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
}

async function kdsCancelOrder(id) {
  if (!confirm('Cancelar pedido #' + _orderNum(id) + '?')) return;
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'cancelado', tenant_id: _sessao?.tenant_id })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Erro');
    ordersKanban = ordersKanban.filter(x => x.id !== id);
    delete kdsTimers[id];
    renderKDS(); renderKanban();
    sbToast('ok', `Pedido #${id} cancelado`);
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
}

// ─────────────────────────────────────────
// ESTOQUE
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// ESTOQUE — REAL
// ─────────────────────────────────────────
function renderEstoque() {
  const search = (document.getElementById('est-search')?.value || '').toLowerCase();
  const filtered = estoqueItems.filter(e => e.name.toLowerCase().includes(search));

  // Stats
  const baixo    = estoqueItems.filter(e => e.qty <= e.min_qty).length;
  const valor    = estoqueItems.reduce((s,e) => s + (e.qty * (e.custo||0)), 0);
  const hoje     = estoqueItems.filter(e => {
    if (!e.updated_at) return false;
    return new Date(e.updated_at).toDateString() === new Date().toDateString();
  }).length;
  const elv = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  elv('est-stat-total',    estoqueItems.length);
  elv('est-stat-baixo',    baixo);
  elv('est-stat-valor',    'R$ '+valor.toFixed(2).replace('.',','));
  elv('est-stat-entradas', hoje);

  // Popular select do modal de entrada
  const sel = document.getElementById('est-sel-ingrediente');
  if (sel) {
    sel.innerHTML = '<option value="">Selecione...</option>' +
      estoqueItems.map(e => `<option value="${e.id}">${e.name} (${e.qty} ${e.unit})</option>`).join('');
  }

  const list = document.getElementById('estoque-list');
  if (!list) return;

  if (!filtered.length) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px">Nenhum ingrediente cadastrado.<br>Clique em <strong>Novo ingrediente</strong> para começar.</div>';
    return;
  }

  list.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:var(--surface2)">
            <th style="padding:10px 14px;text-align:left;font-size:10.5px;font-weight:600;color:var(--muted);letter-spacing:.5px;text-transform:uppercase">Ingrediente</th>
            <th style="padding:10px 14px;text-align:center;font-size:10.5px;font-weight:600;color:var(--muted);letter-spacing:.5px;text-transform:uppercase">Qty / Mín</th>
            <th style="padding:10px 14px;text-align:center;font-size:10.5px;font-weight:600;color:var(--muted);letter-spacing:.5px;text-transform:uppercase">Estoque</th>
            <th style="padding:10px 14px;text-align:right;font-size:10.5px;font-weight:600;color:var(--muted);letter-spacing:.5px;text-transform:uppercase">Custo unit.</th>
            <th style="padding:10px 14px;text-align:right;font-size:10.5px;font-weight:600;color:var(--muted);letter-spacing:.5px;text-transform:uppercase">Valor total</th>
            <th style="padding:10px 6px"></th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(e => {
            const pct = e.min_qty > 0 ? Math.min(100, (e.qty / (e.min_qty * 3)) * 100) : (e.qty > 0 ? 100 : 0);
            const isBaixo = e.qty <= e.min_qty;
            const isZero  = e.qty === 0;
            const barColor = isZero ? 'var(--danger)' : isBaixo ? 'var(--accent3)' : 'var(--success)';
            const valorTotal = (e.qty * (e.custo||0)).toFixed(2).replace('.',',');
            return `<tr style="border-top:1px solid var(--border);transition:background .13s" onmouseenter="this.style.background='rgba(255,255,255,.02)'" onmouseleave="this.style.background=''">
              <td style="padding:12px 14px">
                <div style="font-weight:600;font-size:13px">${e.name}</div>
                <div style="font-size:11px;color:var(--muted)">${e.unit}${e.updated_at ? ' · atualizado ' + new Date(e.updated_at).toLocaleDateString('pt-BR') : ''}</div>
              </td>
              <td style="padding:12px 14px;text-align:center">
                <div style="font-family:'Playfair Display',sans-serif;font-size:15px;font-weight:700;color:${isZero?'var(--danger)':isBaixo?'var(--accent3)':'var(--text)'}">${e.qty}</div>
                <div style="font-size:11px;color:var(--muted)">mín: ${e.min_qty}</div>
              </td>
              <td style="padding:12px 14px;min-width:120px">
                ${isBaixo ? `<span style="font-size:9.5px;background:${isZero?'rgba(239,68,68,.15)':'rgba(245,158,11,.15)'};color:${isZero?'var(--danger)':'var(--accent3)'};padding:1px 6px;border-radius:99px;font-weight:700;display:block;margin-bottom:4px">${isZero?'⚠️ ZERADO':'⚠️ BAIXO'}</span>` : ''}
                <div style="background:var(--surface2);border-radius:99px;height:5px;overflow:hidden">
                  <div style="width:${pct}%;height:100%;background:${barColor};border-radius:99px"></div>
                </div>
              </td>
              <td style="padding:12px 14px;text-align:right;font-size:12.5px;color:var(--muted)">
                ${e.custo ? 'R$ '+e.custo.toFixed(2).replace('.',',') : '—'}
              </td>
              <td style="padding:12px 14px;text-align:right;font-size:12.5px;font-weight:600;color:var(--success)">
                ${e.custo ? 'R$ '+valorTotal : '—'}
              </td>
              <td style="padding:12px 6px;text-align:right">
                <button class="btn bg" style="font-size:11px;padding:3px 8px" onclick="openEditIngrediente(${e.id})">✏️</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

async function saveIngrediente() {
  const nome  = document.getElementById('ing-nome').value.trim();
  const unit  = document.getElementById('ing-unit').value;
  const qty   = parseFloat(document.getElementById('ing-qty').value) || 0;
  const min   = parseFloat(document.getElementById('ing-min').value) || 0;
  const custo = parseFloat(document.getElementById('ing-custo').value) || 0;
  if (!nome) { sbToast('err','Informe o nome do ingrediente'); return; }
  sbLoading(true);
  const { data, error } = await sb.from('estoque').insert({
    name: nome, unit, qty, min_qty: min, cost: custo, updated_at: new Date().toISOString()
  }).select().single();
  sbLoading(false);
  if (error) { sbToast('err','Erro ao cadastrar: '+error.message); return; }
  estoqueItems.push({ id:data.id, name:data.name, unit:data.unit, qty:data.qty,
    min_qty:data.min_qty, custo:parseFloat(data.cost)||0, updated_at:data.updated_at });
  closeModal('modal-add-ingrediente');
  ['ing-nome','ing-qty','ing-min','ing-custo'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value='';
  });
  renderEstoque();
  sbToast('ok', `${nome} cadastrado!`);
}

async function registrarEntrada() {
  const id    = parseInt(document.getElementById('est-sel-ingrediente').value);
  const qty   = parseFloat(document.getElementById('est-qty-entrada').value) || 0;
  const custo = parseFloat(document.getElementById('est-custo-entrada').value) || 0;
  const obs   = document.getElementById('est-obs-entrada').value;
  if (!id)  { sbToast('err','Selecione o ingrediente'); return; }
  if (!qty) { sbToast('err','Informe a quantidade'); return; }
  const item = estoqueItems.find(e => e.id === id);
  if (!item) return;
  const newQty = item.qty + qty;
  const custUnit = qty > 0 && custo > 0 ? custo/qty : item.custo;
  sbLoading(true);
  const { error } = await sb.from('estoque').update({
    qty: newQty, cost: custUnit, updated_at: new Date().toISOString()
  }).eq('id', id);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao registrar'); return; }
  item.qty = newQty; item.custo = custUnit; item.updated_at = new Date().toISOString();
  closeModal('modal-estoque');
  ['est-qty-entrada','est-custo-entrada','est-obs-entrada'].forEach(i => {
    const el=document.getElementById(i); if(el) el.value='';
  });
  renderEstoque();
  sbToast('ok', `+${qty} ${item.unit} de ${item.name} registrado!`);
}

function openEditIngrediente(id) {
  const e = estoqueItems.find(x => x.id === id);
  if (!e) return;
  document.getElementById('edit-ing-id').value    = id;
  document.getElementById('edit-ing-nome').value  = e.name;
  document.getElementById('edit-ing-qty').value   = e.qty;
  document.getElementById('edit-ing-min').value   = e.min_qty;
  document.getElementById('edit-ing-custo').value = e.custo||0;
  openModal('modal-edit-ingrediente');
}

async function saveEditIngrediente() {
  const id    = parseInt(document.getElementById('edit-ing-id').value);
  const nome  = document.getElementById('edit-ing-nome').value.trim();
  const qty   = parseFloat(document.getElementById('edit-ing-qty').value) || 0;
  const min   = parseFloat(document.getElementById('edit-ing-min').value) || 0;
  const custo = parseFloat(document.getElementById('edit-ing-custo').value) || 0;
  if (!nome) { sbToast('err','Informe o nome'); return; }
  sbLoading(true);
  const { error } = await sb.from('estoque').update({
    name: nome, qty, min_qty: min, cost: custo, updated_at: new Date().toISOString()
  }).eq('id', id);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao salvar'); return; }
  const item = estoqueItems.find(e => e.id === id);
  if (item) { item.name=nome; item.qty=qty; item.min_qty=min; item.custo=custo; item.updated_at=new Date().toISOString(); }
  closeModal('modal-edit-ingrediente');
  renderEstoque();
  sbToast('ok', `${nome} atualizado!`);
}

async function deleteIngrediente() {
  const id   = parseInt(document.getElementById('edit-ing-id').value);
  const item = estoqueItems.find(e => e.id === id);
  if (!confirm(`Excluir ${item?.name}?`)) return;
  sbLoading(true);
  const { error } = await sb.from('estoque').delete().eq('id', id);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao excluir'); return; }
  estoqueItems = estoqueItems.filter(e => e.id !== id);
  closeModal('modal-edit-ingrediente');
  renderEstoque();
  sbToast('ok', `${item?.name} removido!`);
}

// ─────────────────────────────────────────
// DESEMPENHO
// ─────────────────────────────────────────
let _desempPrd = 'mensal';

function setDesempPrd(prd) {
  _desempPrd = prd;
  ['diario','semanal','mensal','anual'].forEach(id => {
    const btn = document.getElementById('dpb-' + id);
    if (!btn) return;
    const active = id === prd;
    btn.style.background  = active ? 'var(--accent)' : '';
    btn.style.color       = active ? '#fff' : '';
    btn.style.borderColor = active ? 'var(--accent)' : '';
  });
  renderDesempenho();
}

function _desempGetRange() {
  // Reutiliza a mesma logica de _relGetRange mas com _desempPrd
  const saved = _relPeriodo;
  _relPeriodo = _desempPrd;
  const range = _relGetRange();
  _relPeriodo = saved;
  return range;
}

async function renderDesempenho() {
  const dg  = document.getElementById('desemp-grid');
  const bar = document.getElementById('desemp-bar');
  const top = document.getElementById('desemp-top');

  // Loading state
  if (dg)  dg.innerHTML  = Array(6).fill('<div class="desemp-card"><div class="desemp-label">Carregando...</div><div class="desemp-val" style="font-size:18px;color:var(--muted)">—</div></div>').join('');
  if (bar) bar.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:20px;text-align:center">Carregando...</div>';
  if (top) top.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:12px">Carregando...</div>';

  try {
    const range = _desempGetRange();
    const since = range.inicio.toISOString();
    const ate   = range.fim.toISOString();

    // Atualiza label do periodo
    const lblEl = document.getElementById('desemp-periodo-label');
    if (lblEl) lblEl.textContent = range.label;

    // Busca pedidos reais do período
    const { data: allOrders } = await sb.from('orders')
      .select('id,status,total,items,mesa_num,pag,created_at,garcom_nome')
      .gte('created_at', since)
      .lt('created_at', ate)
      .order('created_at', { ascending: true });

    const orders = allOrders || [];
    const entregues = orders.filter(o => !['cancelado'].includes(o.status));

    // ── KPIs ─────────────────────────────
    const totalPedidos   = orders.length;
    const faturamento    = entregues.reduce((s,o) => s + parseFloat(o.total||0), 0);
    const ticketMedio    = totalPedidos > 0 ? faturamento / totalPedidos : 0;
    const cancelados     = orders.filter(o => o.status === 'cancelado').length;
    const taxaCancelamento = totalPedidos > 0 ? (cancelados / totalPedidos * 100) : 0;
    const mesasSet       = new Set(orders.map(o => o.mesa_num).filter(Boolean));
    const itensQtd       = entregues.reduce((s,o) => {
      if (!Array.isArray(o.items)) return s;
      return s + o.items.reduce((si,i) => si + (i.qty||1), 0);
    }, 0);

    const metrics = [
      { label:'Faturamento', val: 'R$ ' + faturamento.toFixed(2).replace('.',','), icon:'💰', color:'var(--accent3)' },
      { label:'Total de pedidos', val: totalPedidos, icon:'🛎️', color:'var(--accent)' },
      { label:'Ticket médio', val: 'R$ ' + ticketMedio.toFixed(2).replace('.',','), icon:'🎯', color:'var(--purple)' },
      { label:'Mesas atendidas', val: mesasSet.size, icon:'🍽️', color:'var(--success)' },
      { label:'Itens vendidos', val: itensQtd, icon:'📦', color:'var(--accent2)' },
      { label:'Cancelamentos', val: cancelados + (taxaCancelamento > 0 ? ` (${taxaCancelamento.toFixed(1)}%)` : ''), icon:'❌', color: cancelados > 0 ? 'var(--danger)' : 'var(--muted)' },
    ];

    if (dg) dg.innerHTML = metrics.map(m => `
      <div class="desemp-card">
        <div style="font-size:24px;margin-bottom:4px">${m.icon}</div>
        <div class="desemp-label">${m.label}</div>
        <div class="desemp-val" style="font-size:22px;color:${m.color}">${m.val}</div>
      </div>`).join('');

    // ── Grafico dinamico por periodo ────────
    const barCard = bar?.closest('.card')?.querySelector('.card-title');
    if (bar) {
      let barData = [], barLabels = [];
      if (_desempPrd === 'anual') {
        if (barCard) barCard.innerHTML = barCard.innerHTML.replace(/Pedidos.*/, 'Pedidos por mês');
        const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        barData = new Array(12).fill(0); barLabels = months;
        orders.forEach(o => { barData[new Date(o.created_at).getMonth()]++; });
      } else if (_desempPrd === 'mensal') {
        if (barCard) barCard.innerHTML = barCard.innerHTML.replace(/Pedidos.*/, 'Pedidos por semana');
        barData = [0,0,0,0,0]; barLabels = ['Sem 1','Sem 2','Sem 3','Sem 4','Sem 5'];
        orders.forEach(o => {
          const w = Math.min(Math.floor((new Date(o.created_at).getDate()-1)/7), 4);
          barData[w]++;
        });
      } else if (_desempPrd === 'semanal') {
        if (barCard) barCard.innerHTML = barCard.innerHTML.replace(/Pedidos.*/, 'Pedidos por dia da semana');
        barData = [0,0,0,0,0,0,0]; barLabels = DAYS_FULL;
        orders.forEach(o => { barData[new Date(o.created_at).getDay()]++; });
      } else { // diario
        if (barCard) barCard.innerHTML = barCard.innerHTML.replace(/Pedidos.*/, 'Pedidos por hora');
        barData = new Array(24).fill(0);
        barLabels = Array.from({length:24}, (_,i) => i % 4 === 0 ? i + 'h' : '');
        orders.forEach(o => { barData[new Date(o.created_at).getHours()]++; });
      }
      const maxD = Math.max(...barData, 1);
      bar.innerHTML = barLabels.map((lbl, i) => [
        '<div class="bar-col">',
        '<div class="bar-val">' + (barData[i] || '') + '</div>',
        '<div class="bar-fill" style="height:' + Math.max(Math.round(barData[i]/maxD*100), barData[i]>0?3:2) + '%;background:var(--accent)' + (barData[i]===0?';opacity:.2':'') + '"></div>',
        '<div class="bar-label">' + lbl + '</div>',
        '</div>'
      ].join('')).join('');
    }

    // ── Top itens mais vendidos ──────────
    const itemMap = {};
    entregues.forEach(o => {
      if (!Array.isArray(o.items)) return;
      o.items.forEach(i => {
        const k = i.name;
        if (!itemMap[k]) itemMap[k] = { qty: 0, rev: 0 };
        itemMap[k].qty += (i.qty||1);
        itemMap[k].rev += (parseFloat(i.price||0) * (i.qty||1));
      });
    });
    const sorted = Object.entries(itemMap).sort((a,b) => b[1].qty - a[1].qty).slice(0,8);

    if (top) {
      if (!sorted.length) {
        top.innerHTML = '<div style="color:var(--muted);font-size:12.5px;padding:12px;text-align:center">Nenhum item no período</div>';
      } else {
        // Find emoji from items list if available
        top.innerHTML = sorted.map(([name, {qty, rev}], idx) => {
          const menuItem = items.find(i => i.name === name);
          const emoji = menuItem?.emoji || '🍽️';
          return `<div style="display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:12px;font-weight:700;color:var(--accent);width:18px">${idx+1}</span>
            <span style="font-size:18px">${emoji}</span>
            <span style="flex:1;font-size:12.5px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</span>
            <span style="font-size:11px;color:var(--muted);margin-right:6px">${qty}x</span>
            <span style="font-size:12px;font-weight:700;color:var(--success);flex-shrink:0">R$ ${rev.toFixed(2).replace('.',',')}</span>
          </div>`;
        }).join('');
      }
    }

  } catch(e) {
    console.error('renderDesempenho error:', e);
    if (dg) dg.innerHTML = '<div style="color:var(--danger);font-size:13px;padding:12px;grid-column:span 3">Erro ao carregar dados de desempenho</div>';
  }
}

// ─────────────────────────────────────────
// RELATÓRIOS
// ─────────────────────────────────────────
let _relPeriodo = 'mensal';

function setRelPeriodo(p) {
  _relPeriodo = p;
  ['diario','semanal','mensal','anual'].forEach(id => {
    const btn = document.getElementById('rpb-' + id);
    if (!btn) return;
    const active = id === p;
    btn.style.background  = active ? 'var(--accent)' : '';
    btn.style.color       = active ? '#fff' : '';
    btn.style.borderColor = active ? 'var(--accent)' : '';
  });
  renderRelatorios();
}

function _relGetRange() {
  const now = new Date();
  let inicio, fim, label;
  if (_relPeriodo === 'diario') {
    inicio = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    fim    = new Date(inicio.getTime() + 86400000);
    label  = 'Hoje, ' + inicio.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
  } else if (_relPeriodo === 'semanal') {
    const day = now.getDay();
    inicio = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
    fim    = new Date(inicio.getTime() + 7 * 86400000);
    label  = inicio.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' })
             + ' – ' + new Date(fim - 1).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
  } else if (_relPeriodo === 'mensal') {
    inicio = new Date(now.getFullYear(), now.getMonth(), 1);
    fim    = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    label  = inicio.toLocaleDateString('pt-BR', { month:'long', year:'numeric' });
  } else {
    inicio = new Date(now.getFullYear(), 0, 1);
    fim    = new Date(now.getFullYear() + 1, 0, 1);
    label  = String(now.getFullYear());
  }
  return { inicio, fim, label };
}

async function renderRelatorios() {
  const money = v => 'R$ ' + parseFloat(v||0).toFixed(2).replace('.',',');
  const loading = id => { const el=document.getElementById(id); if(el) el.innerHTML='<div style="color:var(--muted);font-size:12px;padding:16px;text-align:center">Carregando...</div>'; };

  ['rel-month-bar','rel-day-bar','rel-gauges','rel-platforms','rel-areas',
   'rel-top-clients','rel-entradas-list','rel-produtos-list','rel-sat-list'].forEach(loading);

  const now    = new Date();
  const range  = _relGetRange();
  const inicioISO = range.inicio.toISOString();
  const fimISO    = range.fim.toISOString();
  // Para o grafico de barras: ano inteiro em modo anual, senao so o periodo
  const anoIn  = new Date(now.getFullYear(), 0, 1).toISOString();

  // Atualiza label do periodo na tela
  const lblEl = document.getElementById('rel-periodo-label');
  if (lblEl) lblEl.textContent = range.label;

  try {
    const [{ data: periodOrders }, { data: anoOrdersRaw }, { data: movimentos }] = await Promise.all([
      sb.from('orders').select('id,status,total,items,mesa_num,addr,pag,garcom_nome,created_at')
        .gte('created_at', inicioISO).lt('created_at', fimISO).order('created_at', { ascending: true }),
      sb.from('orders').select('id,status,total,created_at')
        .gte('created_at', anoIn).order('created_at', { ascending: true }),
      sb.from('movimentos').select('*').gte('time', range.inicio.toLocaleDateString('pt-BR')).order('id', { ascending: false })
    ]);

    const allYear    = anoOrdersRaw || [];
    const mesPedidos = periodOrders || [];
    const mesValidos = mesPedidos.filter(o => o.status !== 'cancelado');

    // ── KPIs do mês ──
    const fatMes    = mesValidos.reduce((s,o) => s + parseFloat(o.total||0), 0);
    const qtdMes    = mesPedidos.length;
    const ticket    = qtdMes > 0 ? fatMes / qtdMes : 0;
    const cancelMes = mesPedidos.filter(o => o.status === 'cancelado').length;
    const pctCancel = qtdMes > 0 ? (cancelMes / qtdMes * 100).toFixed(1) : '0';

    const elv = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    const periodoLabel = { diario:'hoje', semanal:'na semana', mensal:'no mês', anual:'no ano' }[_relPeriodo] || 'no período';
    elv('rel-kpi-fat',    money(fatMes));
    elv('rel-kpi-fat-sub', qtdMes + ' pedidos ' + periodoLabel);
    elv('rel-kpi-ped',    qtdMes);
    elv('rel-kpi-ped-sub', mesValidos.length + ' confirmados');
    elv('rel-kpi-ticket', money(ticket));
    elv('rel-kpi-cancel', cancelMes);
    elv('rel-kpi-cancel-sub', pctCancel + '% do total');

    // ── Grafico de barras (dinamico por periodo) ──
    const mb = document.getElementById('rel-month-bar');
    const chartTitle = mb?.closest('.card')?.querySelector('.card-title');
    if (mb) {
      const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      let barData = [], barLabels = [];
      if (_relPeriodo === 'anual') {
        if (chartTitle) chartTitle.innerHTML = chartTitle.innerHTML.replace(/Faturamento.*/, 'Faturamento mensal (' + range.label + ')');
        barData   = new Array(12).fill(0);
        barLabels = months;
        allYear.filter(o => o.status !== 'cancelado').forEach(o => {
          barData[new Date(o.created_at).getMonth()] += parseFloat(o.total||0);
        });
      } else if (_relPeriodo === 'mensal') {
        if (chartTitle) chartTitle.innerHTML = chartTitle.innerHTML.replace(/Faturamento.*/, 'Faturamento por semana');
        barData = [0,0,0,0,0]; barLabels = ['Sem 1','Sem 2','Sem 3','Sem 4','Sem 5'];
        mesValidos.forEach(o => {
          const d = new Date(o.created_at).getDate();
          const w = Math.min(Math.floor((d-1)/7), 4);
          barData[w] += parseFloat(o.total||0);
        });
      } else if (_relPeriodo === 'semanal') {
        if (chartTitle) chartTitle.innerHTML = chartTitle.innerHTML.replace(/Faturamento.*/, 'Faturamento por dia');
        const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        barData = [0,0,0,0,0,0,0]; barLabels = dias;
        mesValidos.forEach(o => {
          barData[new Date(o.created_at).getDay()] += parseFloat(o.total||0);
        });
      } else { // diario — por hora
        if (chartTitle) chartTitle.innerHTML = chartTitle.innerHTML.replace(/Faturamento.*/, 'Faturamento por hora');
        barData = new Array(24).fill(0);
        barLabels = Array.from({length:24}, (_,i) => i % 4 === 0 ? i + 'h' : '');
        mesValidos.forEach(o => {
          barData[new Date(o.created_at).getHours()] += parseFloat(o.total||0);
        });
      }
      const maxM = Math.max(...barData, 1);
      mb.innerHTML = barLabels.map((lbl, i) => [
        '<div class="bar-col">',
        '<div class="bar-val" style="font-size:9px">' + (barData[i]>0 ? 'R$'+Math.round(barData[i]) : '') + '</div>',
        '<div class="bar-fill" style="height:' + Math.max(Math.round(barData[i]/maxM*100), barData[i]>0?3:1) + '%;' + (barData[i]===0?'opacity:.2':'') + '"></div>',
        '<div class="bar-label">' + lbl + '</div>',
        '</div>'
      ].join('')).join('');
    }

    // ── Pedidos por dia da semana (mês atual) ──
    const dayC = [0,0,0,0,0,0,0];
    mesPedidos.forEach(o => { dayC[new Date(o.created_at).getDay()]++; });
    const maxDy = Math.max(...dayC, 1);
    const db = document.getElementById('rel-day-bar');
    if (db) db.innerHTML = DAYS_FULL.map((d,i) => `
      <div class="bar-col">
        <div class="bar-val">${dayC[i]}</div>
        <div class="bar-fill" style="height:${Math.max(Math.round(dayC[i]/maxDy*100),2)}%;background:var(--accent3)"></div>
        <div class="bar-label">${d}</div>
      </div>`).join('');

    // ── Métodos de pagamento (mês) ──
    const pagMap = {};
    mesValidos.forEach(o => {
      const k = (o.pag||'Outro').trim();
      if (!pagMap[k]) pagMap[k] = 0;
      pagMap[k]++;
    });
    const pagColors = { PIX:'var(--purple)', Cartão:'var(--accent)', Dinheiro:'var(--success)', Mesa:'var(--accent3)' };
    const pagEl = document.getElementById('rel-gauges');
    if (pagEl) {
      const pagEntries = Object.entries(pagMap).sort((a,b)=>b[1]-a[1]);
      pagEl.innerHTML = pagEntries.length
        ? pagEntries.map(([k,v]) => `<div class="gauge"><div class="gauge-val" style="color:${pagColors[k]||'var(--muted)'}">${v}</div><div class="gauge-label" style="color:${pagColors[k]||'var(--muted)'}">${k}</div></div>`).join('')
        : '<div style="color:var(--muted);font-size:12px;padding:12px">Sem dados no mês</div>';
    }

    // ── Faturamento por origem (mesa vs delivery) ──
    const originMap = {};
    mesValidos.forEach(o => {
      let origem = 'Outros';
      if (o.mesa_num)                            origem = 'Mesa (Garçom)';
      else if ((o.addr||'').startsWith('Mesa'))  origem = 'Mesa (Garçom)';
      else if (o.pag === 'Mesa')                 origem = 'Mesa (Garçom)';
      else                                        origem = 'Delivery / Balcão';
      if (!originMap[origem]) originMap[origem] = 0;
      originMap[origem] += parseFloat(o.total||0);
    });
    const originColors = { 'Mesa (Garçom)':'var(--purple)', 'Delivery / Balcão':'var(--accent3)', 'Outros':'var(--muted)' };
    const pe = document.getElementById('rel-platforms');
    if (pe) {
      const entries = Object.entries(originMap).sort((a,b)=>b[1]-a[1]);
      const maxO = Math.max(...entries.map(e=>e[1]), 1);
      pe.innerHTML = entries.length
        ? entries.map(([k,v]) => `<div class="platform-row"><div class="platform-name">${k}</div><div class="platform-bar"><div class="platform-fill" style="width:${Math.round(v/maxO*100)}%;background:${originColors[k]||'var(--accent)'}"></div></div><div class="platform-val">${money(v)}</div></div>`).join('')
        : '<div style="color:var(--muted);font-size:12px;padding:12px">Sem dados no mês</div>';
    }

    // ── Áreas de entrega (top endereços) ──
    const areaMap = {};
    mesValidos.filter(o => !o.mesa_num && o.addr && !o.addr.startsWith('Mesa')).forEach(o => {
      const parts = (o.addr||'').split(',');
      const bairro = (parts[1]||parts[0]||'').trim().split(' ').slice(0,3).join(' ') || 'Sem endereço';
      if (!areaMap[bairro]) areaMap[bairro] = { fat:0, ped:0 };
      areaMap[bairro].fat += parseFloat(o.total||0);
      areaMap[bairro].ped++;
    });
    const ae = document.getElementById('rel-areas');
    if (ae) {
      const areaEntries = Object.entries(areaMap).sort((a,b)=>b[1].ped-a[1].ped).slice(0,6);
      ae.innerHTML = areaEntries.length
        ? areaEntries.map(([k,v]) => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><div style="font-weight:600;font-size:13px">${k}</div><div style="font-size:12px;color:var(--accent)">${money(v.fat)}</div><div style="font-size:11.5px;color:var(--muted)">${v.ped} pedido${v.ped!==1?'s':''}</div></div>`).join('')
        : '<div style="color:var(--muted);font-size:12px;padding:8px">Apenas pedidos de mesa no mês</div>';
    }

    // ── Clientes mais frequentes (via fidClients já carregado) ──
    const rtc = document.getElementById('rel-top-clients');
    if (rtc) {
      const sorted = [...fidClients].sort((a,b)=>b.orders-a.orders).slice(0,10);
      rtc.innerHTML = sorted.length
        ? sorted.map((c,i) => `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:14px;font-weight:700;color:var(--accent);width:22px">#${i+1}</span>
            <div class="fid-av">${c.name?.[0]||'?'}</div>
            <div style="flex:1"><div style="font-weight:600;font-size:13px">${c.name}</div><div style="font-size:11.5px;color:var(--muted)">${c.orders} pedido${c.orders!==1?'s':''} · ${c.pts} pts</div></div>
            <div style="font-family:'Playfair Display',sans-serif;font-weight:700;font-size:15px;color:var(--success)">${money(c.orders * ticket)}</div>
          </div>`).join('')
        : '<div style="color:var(--muted);font-size:12.5px;padding:12px">Nenhum cliente cadastrado</div>';
    }

    // ── Entradas do mês (movimentos) ──
    const el = document.getElementById('rel-entradas-list');
    if (el) {
      const movs = (movimentos||[]);
      const entradas = movs.filter(m=>m.tipo==='entrada');
      const saidas   = movs.filter(m=>m.tipo==='saida');
      const totEnt   = entradas.reduce((s,m)=>s+parseFloat(m.val||0),0);
      const totSai   = saidas.reduce((s,m)=>s+parseFloat(m.val||0),0);
      el.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
          <div style="background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.15);border-radius:10px;padding:12px;text-align:center">
            <div style="font-size:10.5px;color:var(--muted);margin-bottom:4px">Entradas</div>
            <div style="font-family:'Playfair Display',sans-serif;font-size:18px;font-weight:800;color:var(--success)">${money(totEnt)}</div>
          </div>
          <div style="background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.15);border-radius:10px;padding:12px;text-align:center">
            <div style="font-size:10.5px;color:var(--muted);margin-bottom:4px">Saídas</div>
            <div style="font-family:'Playfair Display',sans-serif;font-size:18px;font-weight:800;color:var(--danger)">${money(totSai)}</div>
          </div>
          <div style="background:rgba(59,130,246,.07);border:1px solid rgba(59,130,246,.15);border-radius:10px;padding:12px;text-align:center">
            <div style="font-size:10.5px;color:var(--muted);margin-bottom:4px">Saldo</div>
            <div style="font-family:'Playfair Display',sans-serif;font-size:18px;font-weight:800;color:${totEnt-totSai>=0?'var(--success)':'var(--danger)'}">${money(totEnt-totSai)}</div>
          </div>
        </div>
        ${movs.length ? movs.map(m => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:16px">${m.tipo==='entrada'?'↑':'↓'}</span>
            <div style="flex:1"><div style="font-size:13px;font-weight:500">${m.description||'—'}</div><div style="font-size:11.5px;color:var(--muted)">${m.time||''} · ${m.pag||''}</div></div>
            <div style="font-weight:700;font-size:13.5px;color:${m.tipo==='entrada'?'var(--success)':'var(--danger)'}">${m.tipo==='entrada'?'+':'-'}${money(m.val)}</div>
          </div>`).join('') : '<div style="color:var(--muted);font-size:12.5px;padding:12px;text-align:center">Nenhuma movimentação no mês</div>'}`;
    }

    // ── Produtos mais vendidos (mês) ──
    const itemMapR = {};
    mesValidos.forEach(o => {
      if (!Array.isArray(o.items)) return;
      o.items.forEach(i => {
        const k = i.name;
        if (!itemMapR[k]) itemMapR[k] = { qty:0, rev:0 };
        itemMapR[k].qty += (i.qty||1);
        itemMapR[k].rev += parseFloat(i.price||0) * (i.qty||1);
      });
    });
    const sortedP = Object.entries(itemMapR).sort((a,b)=>b[1].qty-a[1].qty).slice(0,15);
    const rpl = document.getElementById('rel-produtos-list');
    if (rpl) rpl.innerHTML = sortedP.length
      ? sortedP.map(([name,{qty,rev}],idx) => {
          const mi = items.find(i=>i.name===name);
          return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
            <span style="width:20px;font-size:12px;font-weight:700;color:var(--accent)">${idx+1}</span>
            <span style="font-size:18px">${mi?.emoji||'🍽️'}</span>
            <span style="flex:1;font-size:13px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</span>
            <span style="font-size:12px;color:var(--muted);margin-right:8px">${qty}x</span>
            <span style="font-size:12.5px;font-weight:700;color:var(--success);flex-shrink:0">${money(rev)}</span>
          </div>`;
        }).join('')
      : '<div style="color:var(--muted);font-size:12.5px;padding:12px;text-align:center">Nenhum produto vendido no mês</div>';

    // ── Satisfação (aba dentro de relatorios) ──
    const relSat = document.getElementById('rel-sat-list');
    if (relSat) relSat.innerHTML = '<div style="color:var(--muted);font-size:12.5px;padding:12px;text-align:center">Módulo de avaliações não configurado</div>';

  } catch(e) {
    console.error('renderRelatorios error:', e);
    sbToast('err', 'Erro ao carregar relatórios');
  }
}

// ─────────────────────────────────────────
// SATISFAÇÃO
// ─────────────────────────────────────────
async function renderSatisfacao(){
  const elBars    = document.getElementById('sat-bars');
  const elReviews = document.getElementById('sat-reviews');

  if (elBars)    elBars.innerHTML    = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px">Carregando…</div>';
  if (elReviews) elReviews.innerHTML = '';

  try {
    const { data: ratings, error } = await sb.from('ratings').select('*').order('created_at', { ascending: false });
    if (error) throw error;

    const list  = ratings || [];
    const total = list.length;
    const statEls   = document.querySelectorAll('#page-satisfacao .sg .sv');
    const statTrend = document.querySelector('#page-satisfacao .sg .str');

    if (total === 0) {
      const vazio = `<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:13px">
        <div style="font-size:44px;margin-bottom:12px">⭐</div>
        Nenhuma avaliação ainda.<br>
        <small style="font-size:11.5px">Quando clientes responderem ao link de avaliação, os dados aparecerão aqui.</small>
      </div>`;
      if (elBars)    elBars.innerHTML    = vazio;
      if (elReviews) elReviews.innerHTML = '';
      if (statEls[0]) statEls[0].textContent = '—';
      if (statEls[1]) statEls[1].textContent = '0';
      if (statEls[2]) statEls[2].textContent = '—';
      if (statEls[3]) statEls[3].textContent = '—';
      return;
    }

    const soma          = list.reduce((s, r) => s + (r.nota || 0), 0);
    const media         = soma / total;
    const satisfeitos   = list.filter(r => r.nota >= 4).length;
    const insatisfeitos = list.filter(r => r.nota <= 2).length;

    if (statEls[0]) statEls[0].textContent = media.toFixed(1);
    if (statEls[1]) statEls[1].textContent = total;
    if (statEls[2]) statEls[2].textContent = Math.round((satisfeitos / total) * 100) + '%';
    if (statEls[3]) statEls[3].textContent = Math.round((insatisfeitos / total) * 100) + '%';
    if (statTrend)  statTrend.textContent  = media >= 4.5 ? '↑ Excelente' : media >= 3.5 ? '→ Bom' : '↓ Atenção';

    // Distribuição de notas
    const dist = [5,4,3,2,1].map(nota => {
      const count = list.filter(r => r.nota === nota).length;
      const pct   = Math.round((count / total) * 100);
      const clr   = nota >= 4 ? 'var(--success)' : nota === 3 ? '#f59e0b' : 'var(--danger)';
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:12px;font-weight:700;min-width:14px;text-align:right">${nota}</span>
        <span style="font-size:12px">⭐</span>
        <div style="flex:1;height:9px;background:var(--surface2);border-radius:99px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${clr};border-radius:99px"></div>
        </div>
        <span style="font-size:11.5px;color:var(--muted);min-width:32px;text-align:right">${count}x</span>
      </div>`;
    }).join('');
    if (elBars) elBars.innerHTML = dist;

    // Últimas avaliações
    const EMOJI = { 5:'😍', 4:'😊', 3:'😐', 2:'😕', 1:'😠' };
    const revs = list.slice(0, 30).map(r => {
      const stars = '⭐'.repeat(r.nota || 0);
      const dt    = r.created_at
        ? new Date(r.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
        : '';
      return `<div style="padding:12px 0;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:flex-start">
        <div style="font-size:26px;flex-shrink:0;line-height:1">${EMOJI[r.nota] || '⭐'}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px">
            <span style="font-weight:700;font-size:13px">${r.client || 'Cliente'}</span>
            <span style="font-size:11px;color:var(--muted);white-space:nowrap">${dt}</span>
          </div>
          <div style="font-size:13px;margin-bottom:${r.comentario ? '5px' : '0'}">${stars}</div>
          ${r.comentario ? `<div style="font-size:12.5px;color:var(--muted2);line-height:1.5">${r.comentario}</div>` : ''}
          ${r.order_id   ? `<div style="font-size:11px;color:var(--muted);margin-top:3px">Pedido #${String(r.order_id).padStart(3,'0')}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    if (elReviews) elReviews.innerHTML = revs || '<div style="color:var(--muted);font-size:12px;padding:12px">Nenhuma avaliação.</div>';

  } catch(e) {
    console.error('renderSatisfacao:', e);
    const err = '<div style="color:var(--muted);font-size:12.5px;padding:20px;text-align:center">Erro ao carregar avaliações.</div>';
    if (elBars)    elBars.innerHTML    = err;
    if (elReviews) elReviews.innerHTML = '';
  }
}

// ─────────────────────────────────────────
// MEU PLANO
// ─────────────────────────────────────────
async function renderMeuPlano() {
  const elNome   = document.getElementById('plano-nome-display');
  const elExpira = document.getElementById('plano-expira-display');
  const elDias   = document.getElementById('plano-dias-display');
  const elTenant = document.getElementById('plano-tenant-display');
  const elBadge  = document.getElementById('plano-badge-wrap');
  const elStatus = document.getElementById('plano-status-wrap');
  const elRecursos = document.getElementById('plano-recursos-grid');
  const elBgDeco = document.getElementById('plano-bg-deco');

  if (elNome) elNome.textContent = 'Carregando...';

  try {
    const tid = _sessao?.tenant_id;
    if (!tid) throw new Error('Sessão inválida');

    const res = await fetch('/api/tenant-info-gestor', {
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid }
    });
    if (!res.ok) throw new Error('Erro HTTP ' + res.status);
    const data = await res.json();
    if (!data) throw new Error('Tenant não encontrado');

    const plano     = (data.plano || 'pro').toLowerCase();
    const isPremium = plano === 'premium';
    const expira    = data.expires_at ? new Date(data.expires_at) : null;
    const hoje      = new Date();
    hoje.setHours(0,0,0,0);
    const diasRestantes = expira
      ? Math.ceil((expira - hoje) / (1000 * 60 * 60 * 24))
      : null;

    // ── Nome e badge ──
    const planoLabel = isPremium ? 'Premium' : 'Pro';
    const planoColor = isPremium ? '#7c3aed' : 'var(--accent)';
    if (elNome)   { elNome.textContent = planoLabel; elNome.style.color = planoColor; }
    if (elBgDeco) elBgDeco.style.background = planoColor;
    if (elBadge)  elBadge.innerHTML = `
      <div style="padding:4px 12px;border-radius:99px;font-size:11px;font-weight:800;letter-spacing:.4px;
        background:${isPremium ? 'rgba(124,58,237,.15)' : 'rgba(59,130,246,.12)'};
        color:${planoColor};border:1px solid ${isPremium ? 'rgba(124,58,237,.35)' : 'rgba(59,130,246,.3)'}">
        ${planoLabel.toUpperCase()}
      </div>`;

    // ── Vencimento ──
    const expiraStr = expira
      ? expira.toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' })
      : 'Sem data definida';
    if (elExpira) elExpira.textContent = expiraStr;

    // ── Dias restantes ──
    let diasStr = 'Sem data definida';
    let diasColor = 'var(--text)';
    if (diasRestantes !== null) {
      if (diasRestantes > 30)       { diasStr = `${diasRestantes} dias`; diasColor = 'var(--success)'; }
      else if (diasRestantes > 7)   { diasStr = `${diasRestantes} dias`; diasColor = 'var(--warning,#f59e0b)'; }
      else if (diasRestantes > 0)   { diasStr = `${diasRestantes} dias — vence em breve`; diasColor = 'var(--danger)'; }
      else if (diasRestantes === 0) { diasStr = 'Vence hoje'; diasColor = 'var(--danger)'; }
      else                          { diasStr = 'Vencido'; diasColor = 'var(--danger)'; }
    }
    if (elDias) { elDias.textContent = diasStr; elDias.style.color = diasColor; }

    // ── Nome do tenant ──
    if (elTenant) elTenant.textContent = data.nome || _sessao?.nome || '—';

    // ── Status ──
    if (elStatus) {
      const ativo = data.ativo !== 0 && data.ativo !== false;
      const vencido = diasRestantes !== null && diasRestantes < 0;
      const alertaBarra = diasRestantes !== null && diasRestantes <= 30 && diasRestantes >= 0;
      const pct = alertaBarra ? Math.max(0, Math.min(100, Math.round((diasRestantes / 30) * 100))) : null;

      let statusHtml = '';
      if (!ativo || vencido) {
        statusHtml += `
          <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;
            background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:10px">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="color:var(--danger);flex-shrink:0">
              <path d="M8 2L14 13H2L8 2z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M8 6v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              <circle cx="8" cy="11" r=".6" fill="currentColor"/>
            </svg>
            <div>
              <div style="font-weight:700;font-size:13px;color:var(--danger)">${vencido ? 'Plano vencido' : 'Conta inativa'}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:1px">Entre em contato com o suporte para reativar.</div>
            </div>
          </div>`;
      } else {
        statusHtml += `
          <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;
            background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:10px">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="color:var(--success);flex-shrink:0">
              <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/>
              <path d="M5.5 8l2 2 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
            <div>
              <div style="font-weight:700;font-size:13px;color:var(--success)">Assinatura ativa</div>
              <div style="font-size:12px;color:var(--muted);margin-top:1px">Todos os recursos disponíveis.</div>
            </div>
          </div>`;
      }
      if (alertaBarra && pct !== null) {
        const barColor = diasRestantes <= 7 ? 'var(--danger)' : '#f59e0b';
        statusHtml += `
          <div style="margin-top:4px">
            <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-bottom:5px">
              <span>Tempo restante do plano</span>
              <span style="font-weight:700;color:${barColor}">${diasRestantes}d de 30d</span>
            </div>
            <div style="height:7px;background:var(--surface2);border-radius:99px;overflow:hidden">
              <div style="width:${pct}%;height:100%;background:${barColor};border-radius:99px;transition:width .5s"></div>
            </div>
          </div>`;
      }
      elStatus.innerHTML = statusHtml;
    }

    // ── Recursos ──
    const recursosPro = [
      { svg:'<path d="M2 2h12v12H2z" stroke="currentColor" stroke-width="1.4" fill="none" rx="2"/><path d="M5 6h6M5 9h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Gestão de pedidos (Kanban)' },
      { svg:'<rect x="1" y="4" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8.5" r="2" stroke="currentColor" stroke-width="1.4"/>', label:'PDV / Pedidos no balcão' },
      { svg:'<rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5 8h6M8 5v6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Gestor de cardápio' },
      { svg:'<path d="M3 12V5l5-3 5 3v7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><rect x="6" y="8" width="4" height="4" rx=".5" stroke="currentColor" stroke-width="1.4"/>', label:'Mesas e garçons' },
      { svg:'<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 2c-1.5 2-2.5 3.8-2.5 6s1 4 2.5 6M2 8h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Cardápio público online' },
      { svg:'<path d="M2 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V4z" stroke="currentColor" stroke-width="1.4" fill="none"/>', label:'Automações de WhatsApp' },
      { svg:'<path d="M8 2l1.5 3.5L13 6l-2.5 2.5.6 3.5L8 10.5 4.9 12l.6-3.5L3 6l3.5-.5z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>', label:'Satisfação e avaliações' },
      { svg:'<rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/>', label:'QR Code da mesa' },
      { svg:'<path d="M2 12L6 4l3 5 2-2.5L14 12H2z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>', label:'Relatórios e desempenho' },
      { svg:'<rect x="1" y="4" width="14" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="2" width="10" height="4" rx="1" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="9" r="1.5" stroke="currentColor" stroke-width="1.4"/>', label:'Caixa e movimentos' },
      { svg:'<path d="M8 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM2 13c0-2.76 2.24-5 5-5h2c2.76 0 5 2.24 5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Programa de fidelidade' },
      { svg:'<rect x="3" y="2" width="10" height="4" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="10" width="10" height="4" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M3 6H2a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1M13 6h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1" stroke="currentColor" stroke-width="1.4"/>', label:'Impressão térmica' },
    ];
    const extraPremium = [
      { svg:'<rect x="3" y="5" width="10" height="8" rx="2" stroke="currentColor" stroke-width="1.4"/><circle cx="6" cy="9" r="1" fill="currentColor"/><circle cx="10" cy="9" r="1" fill="currentColor"/><path d="M6 5V3.5M10 5V3.5M6 3.5H10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Agente IA no WhatsApp', destaque: true },
      { svg:'<path d="M2 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V4z" stroke="currentColor" stroke-width="1.4"/><path d="M5 7h6M5 9.5h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Simulador do robô', destaque: true },
    ];
    const recursos = isPremium ? [...recursosPro, ...extraPremium] : recursosPro;
    if (elRecursos) {
      elRecursos.innerHTML = recursos.map(r => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
          background:var(--surface2);border:1px solid ${r.destaque ? 'rgba(124,58,237,.3)' : 'var(--border)'};border-radius:10px;
          ${r.destaque ? 'background:rgba(124,58,237,.07);' : ''}">
          <div style="width:28px;height:28px;border-radius:7px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
            background:${r.destaque ? 'rgba(124,58,237,.15)' : 'var(--surface)'};
            border:1px solid ${r.destaque ? 'rgba(124,58,237,.25)' : 'var(--border)'};
            color:${r.destaque ? '#a78bfa' : 'var(--muted)'}">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">${r.svg}</svg>
          </div>
          <span style="font-size:12.5px;font-weight:500;color:${r.destaque ? 'var(--text)' : 'var(--muted2)'};flex:1">${r.label}</span>
          <svg viewBox="0 0 16 16" fill="none" width="12" height="12" style="flex-shrink:0;color:${r.destaque ? '#a78bfa' : 'var(--success)'}">
            ${r.destaque
              ? '<path d="M8 2l1.5 3.5L13 6l-2.5 2.5.6 3.5L8 10.5 4.9 12l.6-3.5L3 6l3.5-.5z" stroke="currentColor" stroke-width="1.3" fill="none"/>'
              : '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 8l2 2 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'}
          </svg>
        </div>`).join('');
    }

  } catch(e) {
    console.error('renderMeuPlano:', e);
    if (elNome) elNome.textContent = '—';
    if (elStatus) elStatus.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:12px;text-align:center">Não foi possível carregar as informações do plano.</div>`;
  }
}
// ─────────────────────────────────────────
// IMPRESSÃO TÉRMICA
// ─────────────────────────────────────────
let _printMode = localStorage.getItem('printMode') || 'auto';

function setPrintMode(mode) {
  _printMode = mode;
  localStorage.setItem('printMode', mode);
  const isAuto = mode === 'auto';
  const la = document.getElementById('lbl-print-auto');
  const lm = document.getElementById('lbl-print-manual');
  const da = document.getElementById('dot-auto');
  const dm = document.getElementById('dot-manual');
  if (la) { la.style.background = isAuto ? 'rgba(59,130,246,.1)' : 'var(--surface2)'; la.style.borderColor = isAuto ? 'var(--accent)' : 'var(--border)'; }
  if (lm) { lm.style.background = !isAuto ? 'rgba(59,130,246,.1)' : 'var(--surface2)'; lm.style.borderColor = !isAuto ? 'var(--accent)' : 'var(--border)'; }
  if (da) da.style.background = isAuto ? '#fff' : 'transparent';
  if (dm) dm.style.background = !isAuto ? '#fff' : 'transparent';
  sbToast('ok', isAuto ? '🖨️ Impressão automática ativada' : '👆 Impressão manual ativada');
}

function _getPrintConfig() {
  return {
    nome:   ((document.getElementById('print-nome')?.value)   || 'ESTIMA FOOD').toUpperCase(),
    sub:     (document.getElementById('print-sub')?.value)    || '',
    rodape:  (document.getElementById('print-rodape')?.value) || 'Obrigado!',
    addr:    document.getElementById('toggle-print-addr')?.classList.contains('on') ?? true,
    pag:     document.getElementById('toggle-print-pag')?.classList.contains('on')  ?? true,
  };
}

function _buildTicketHtml(order, cfg) {
  const items = Array.isArray(order.items) ? order.items : [];
  const now = new Date().toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const money = v => 'R$ ' + parseFloat(v||0).toFixed(2).replace('.',',');
  const itemLines = items.map(i => {
    const name = (i.qty + 'x ' + i.name).toUpperCase();
    const price = money((i.price||0) * (i.qty||1));
    return `<div style="display:flex;justify-content:space-between"><span>${name}</span><span style="white-space:nowrap;margin-left:8px">${price}</span></div>`;
  }).join('');
  const subtotal = items.reduce((s,i) => s + (parseFloat(i.price||0) * (i.qty||1)), 0);
  const taxa = parseFloat(order.taxa || 0);
  const total = subtotal + taxa;
  return `<div class="print-ticket">
    <div class="pt-center pt-large">${cfg.nome}</div>
    ${cfg.sub ? `<div class="pt-center" style="font-size:11px">${cfg.sub}</div>` : ''}
    <hr class="pt-hr">
    <div>Pedido: <b>#${order.id}</b></div>
    <div>Data: ${now}</div>
    <div>Cliente: ${order.client || '—'}</div>
    ${cfg.addr && order.addr ? `<div>Local: ${order.addr}</div>` : ''}
    <hr class="pt-hr">
    ${itemLines}
    <hr class="pt-hr">
    ${taxa > 0 ? `<div style="display:flex;justify-content:space-between"><span>Subtotal</span><span>${money(subtotal)}</span></div><div style="display:flex;justify-content:space-between"><span>Taxa entrega</span><span>${money(taxa)}</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;font-weight:bold"><span>TOTAL</span><span>${money(total)}</span></div>
    ${cfg.pag && order.pag ? `<div>Pagamento: ${order.pag}</div>` : ''}
    <hr class="pt-hr">
    <div class="pt-center" style="font-size:11px">${cfg.rodape}</div>
  </div>`;
}

function printOrder(order) {
  const cfg = _getPrintConfig();
  const html = _buildTicketHtml(order, cfg);
  const frame = document.getElementById('print-frame');
  if (!frame) return;
  frame.innerHTML = html;
  frame.style.display = 'block';
  setTimeout(() => {
    window.print();
    setTimeout(() => { frame.style.display = 'none'; }, 1500);
  }, 150);
}

function printOrderById(id) {
  const o = ordersKanban.find(x => x.id === id);
  if (o) printOrder(o); else sbToast('err', 'Pedido não encontrado');
}

function renderImpressao() {
  const p = document.getElementById('print-preview');
  if (!p) return;
  setPrintMode(_printMode);
  const cfg = _getPrintConfig();
  const ex = { id:99, client:'João Silva', addr:'Mesa 3', mesa_num:3, pag:'PIX', taxa:0,
    items:[{qty:1,name:'Pizza Calabreza',price:50},{qty:2,name:'Coca Cola 2L',price:14}] };
  p.innerHTML = _buildTicketHtml(ex, cfg);
}

function testPrint() {
  const ex = { id:99, client:'TESTE IMPRESSÃO', addr:'Balcão', mesa_num:null, pag:'PIX', taxa:5,
    items:[{qty:1,name:'X-Salada',price:18},{qty:1,name:'Batata Frita',price:10}] };
  printOrder(ex);
  sbToast('ok', '🖨️ Enviando para impressora...');
}

// ─────────────────────────────────────────
// CAIXA
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// CAIXA — abrir / fechar
// ─────────────────────────────────────────
let _caixaAberto = true;

function setCaixaState(aberto) {
  _caixaAberto = aberto;
  const btn = document.getElementById('caixa-btn');
  const txt = document.getElementById('caixa-btn-txt');
  if (!btn || !txt) return;
  if (aberto) {
    btn.classList.remove('fechado');
    txt.textContent = 'Caixa aberto';
  } else {
    btn.classList.add('fechado');
    txt.textContent = 'Caixa fechado';
  }
}

async function toggleCaixa() {
  if (_caixaAberto) await fecharCaixa();
  else await abrirCaixa();
}

async function abrirCaixa() {
  setCaixaState(true);
  sbToast('ok', '🟢 Caixa aberto!');
  try { await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, caixa_open: true }); }
  catch(e) { console.warn('caixa sync:', e); }
  _renderCaixaTela();
}

async function fecharCaixa() {
  if (!confirm('Fechar o caixa agora?\n\nIsso registrará o fechamento mas não apaga os movimentos do dia.')) return;
  setCaixaState(false);
  const time = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  sbToast('ok', '🔒 Caixa fechado às ' + time);
  try { await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, caixa_open: false }); }
  catch(e) { console.warn('caixa sync:', e); }
  _renderCaixaTela();
}

function _renderCaixaTela() {
  const tFechado = document.getElementById('cx-tela-fechado');
  const tAberto  = document.getElementById('cx-tela-aberto');
  if (!tFechado || !tAberto) return;
  tFechado.style.display = _caixaAberto ? 'none' : 'flex';
  tAberto.style.display  = _caixaAberto ? ''     : 'none';
  if (_caixaAberto) renderCaixa();
}



function renderCaixa() {
  const entradas=movimentos.filter(m=>m.tipo==='entrada').reduce((s,m)=>s+m.val,0);
  const saidas=movimentos.filter(m=>m.tipo==='saida').reduce((s,m)=>s+m.val,0);
  const saldo=entradas-saidas;
  document.getElementById('cx-saldo').textContent='R$'+saldo.toFixed(2).replace('.',',');
  document.getElementById('cx-entradas').textContent='R$'+entradas.toFixed(2).replace('.',',');
  document.getElementById('cx-saidas').textContent='R$'+saidas.toFixed(2).replace('.',',');
  document.getElementById('cx-movs').textContent=movimentos.length;
  document.getElementById('cx-list').innerHTML=movimentos.slice().reverse().map(m=>`
    <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:9px">
      <div style="width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;background:${m.tipo==='entrada'?'rgba(34,197,94,.12)':'rgba(239,68,68,.12)'}">
        ${m.tipo==='entrada'?'<svg width=&quot;14&quot; height=&quot;14&quot; viewBox=&quot;0 0 16 16&quot; fill=&quot;none&quot; style=&quot;display:inline-block;vertical-align:middle;flex-shrink:0&quot; xmlns=&quot;http://www.w3.org/2000/svg&quot;><path d=&quot;M8 13V3M3 8l5-5 5 5&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;1.4&quot; fill=&quot;none&quot; stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot;/></svg>':'<svg width=&quot;14&quot; height=&quot;14&quot; viewBox=&quot;0 0 16 16&quot; fill=&quot;none&quot; style=&quot;display:inline-block;vertical-align:middle;flex-shrink:0&quot; xmlns=&quot;http://www.w3.org/2000/svg&quot;><path d=&quot;M8 3v10M3 8l5 5 5-5&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;1.4&quot; fill=&quot;none&quot; stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot;/></svg>'}
      </div>
      <div style="flex:1"><div style="font-size:12.5px;font-weight:600">${m.desc}</div><div style="font-size:11px;color:var(--muted)">${m.pag} • ${m.time}</div></div>
      <div style="font-size:13.5px;font-weight:700;color:${m.tipo==='entrada'?'var(--success)':'var(--danger)'}">${m.tipo==='entrada'?'+':'-'}R$${m.val.toFixed(2).replace('.',',')}</div>
    </div>`).join('');
  const pags={};
  movimentos.filter(m=>m.tipo==='entrada').forEach(m=>{pags[m.pag]=(pags[m.pag]||0)+m.val;});
  document.getElementById('cx-pagamentos').innerHTML=Object.entries(pags).map(([p,v])=>`<div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)"><span style="color:var(--muted)">${p}</span><span style="font-weight:600">R$${v.toFixed(2).replace('.',',')}</span></div>`).join('');
}

async function addMovimento() {
  const desc = document.getElementById('cx-quick-desc').value || 'Movimento';
  const val  = parseFloat(document.getElementById('cx-quick-val').value) || 0;
  const tipo = document.querySelector('input[name="cx-tipo"]:checked').value;
  const time = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  const { data, error } = await sb.from('movimentos').insert({
    description: desc, tipo, val, pag: 'Dinheiro', time
  }).select().single();
  if (error) { sbToast('err','Erro ao registrar'); return; }
  movimentos.push({ id:data.id, desc, tipo, val, pag:'Dinheiro', time });
  document.getElementById('cx-quick-desc').value = '';
  document.getElementById('cx-quick-val').value  = '';
  renderCaixa();
  sbToast('ok','Movimento registrado!');
}

async function addMovimentoModal() {
  const desc = document.getElementById('mov-desc').value || 'Movimento';
  const val  = parseFloat(document.getElementById('mov-val').value) || 0;
  const tipo = document.getElementById('mov-tipo').value;
  const pag  = document.getElementById('mov-pag').value;
  const time = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  const { data, error } = await sb.from('movimentos').insert({
    description: desc, tipo, val, pag, time
  }).select().single();
  if (error) { sbToast('err','Erro ao registrar'); return; }
  movimentos.push({ id:data.id, desc, tipo, val, pag, time });
  closeModal('modal-mov');
  renderCaixa();
  sbToast('ok','Movimento registrado!');
}

function updateCxLabel(){
  const tipo=document.querySelector('input[name="cx-tipo"]:checked').value;
  document.getElementById('lbl-entrada').style.borderColor=tipo==='entrada'?'var(--success)':'var(--border)';
  document.getElementById('lbl-saida').style.borderColor=tipo==='saida'?'var(--danger)':'var(--border)';
}

// ─────────────────────────────────────────
// PIZZA SELECTOR — PDV (slot-based, sem bugs)
// ─────────────────────────────────────────
let pdvPz = { item: null, slices: 1, selected: [], activeSlot: -1 };

function openPDVPizza(itemId) {
  const it = items.find(i => i.id === itemId);
  if (!it) return;
  pdvPz = { item: it, slices: 1, selected: [null], activeSlot: -1 };
  document.getElementById('pdv-pz-name').textContent = it.name;
  document.querySelectorAll('#pdv-pz-size-tabs .pz-size-tab').forEach((b,i) => b.classList.toggle('on', i===0));
  document.getElementById('pdv-pz-picker-wrap').style.display = 'none';
  document.getElementById('pdv-pizza-modal-bg').classList.add('on');
  pdvRenderSlots();
  pdvUpdateConfirm();
}

function closePDVPizza() {
  document.getElementById('pdv-pizza-modal-bg').classList.remove('on');
}

function pdvSetSlices(n, el) {
  document.querySelectorAll('#pdv-pz-size-tabs .pz-size-tab').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  pdvPz.slices = n;
  while (pdvPz.selected.length < n) pdvPz.selected.push(null);
  pdvPz.selected = pdvPz.selected.slice(0, n);
  pdvPz.activeSlot = -1;
  document.getElementById('pdv-pz-picker-wrap').style.display = 'none';
  pdvRenderSlots();
  pdvUpdateConfirm();
}

function pdvRenderSlots() {
  const labels = ['Inteira','½ do sabor','⅓ do sabor','¼ do sabor'];
  const label  = labels[pdvPz.slices - 1] || '¼ do sabor';
  const container = document.getElementById('pdv-pz-slots');
  container.innerHTML = pdvPz.selected.map((fl, i) => {
    const isActive = pdvPz.activeSlot === i;
    const isFilled = fl !== null;
    const imgHtml = fl && fl.imageUrl
      ? `<div class="pz-slot-img"><img src="${fl.imageUrl}" alt="${fl.name}"></div>`
      : `<div class="pz-slot-img" style="font-size:22px">${isFilled ? '🍕' : '＋'}</div>`;
    return `<div class="pz-slot${isActive?' active':''}${isFilled?' filled':''}" onclick="pdvOpenSlot(${i})">
      <div class="pz-slot-num">${i+1}</div>
      ${imgHtml}
      <div class="pz-slot-info">
        <div class="pz-slot-name">${fl ? fl.name : 'Toque para escolher o sabor'}</div>
        <div class="pz-slot-hint">${isFilled ? (label+' · R$ '+fl.price.toFixed(2).replace('.',',')) : 'Slot '+(i+1)+' vazio'}</div>
      </div>
      ${isFilled ? `<button class="pz-slot-remove" onclick="event.stopPropagation();pdvRemoveSlot(${i})">✕</button>` : ''}
    </div>`;
  }).join('');
}

function pdvOpenSlot(idx) {
  pdvPz.activeSlot = idx;
  pdvRenderSlots();
  const pizzas = items.filter(i => i.itemType === 'pizza' && i.status !== 'esgotado');
  const names = ['1º sabor','2º sabor','3º sabor','4º sabor'];
  document.getElementById('pdv-pz-picker-title').textContent = 'ESCOLHA O ' + (names[idx]||'SABOR').toUpperCase();
  document.getElementById('pdv-pz-picker-wrap').style.display = '';
  document.getElementById('pdv-pz-flavor-list').innerHTML = pizzas.length
    ? pizzas.map(f => {
        const isOn = pdvPz.selected[idx]?.id === f.id;
        const thumb = f.imageUrl
          ? `<img src="${f.imageUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:7px">`
          : `<span style="font-size:18px">${f.emoji||'🍕'}</span>`;
        const check = isOn
          ? `<div style="width:20px;height:20px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;flex-shrink:0">✓</div>`
          : `<div style="width:20px;height:20px;border-radius:50%;border:2px solid var(--border);flex-shrink:0"></div>`;
        return `<button onclick="pdvSelectFlavor(${f.id})" style="display:flex;align-items:center;gap:11px;padding:10px 13px;background:${isOn?'rgba(249,115,22,.12)':'none'};border:none;border-bottom:1px solid var(--border);cursor:pointer;width:100%;text-align:left;transition:background .15s;" onmouseover="if(!${isOn})this.style.background='rgba(255,255,255,.04)'" onmouseout="if(!${isOn})this.style.background='none'">
          <div style="width:42px;height:42px;border-radius:8px;background:var(--surface2);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">${thumb}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)">${f.name}</div>
            <div style="font-size:12px;color:var(--amber);margin-top:1px">R$ ${f.price.toFixed(2).replace('.',',')}</div>
          </div>
          ${check}
        </button>`;
      }).join('')
    : '<div style="color:var(--muted);font-size:12px;padding:14px;text-align:center">Nenhum item do tipo Pizza cadastrado.<br>Gestor de Cardápio → edite um item → Tipo = Pizza.</div>';
}

function pdvSelectFlavor(fid) {
  const fl = items.find(i => i.id === fid);
  if (!fl || pdvPz.activeSlot < 0) return;
  pdvPz.selected[pdvPz.activeSlot] = fl;
  const nextEmpty = pdvPz.selected.findIndex((s, i) => i > pdvPz.activeSlot && s === null);
  pdvRenderSlots();
  pdvUpdateConfirm();
  if (nextEmpty !== -1) setTimeout(() => pdvOpenSlot(nextEmpty), 220);
  else pdvOpenSlot(pdvPz.activeSlot);
}

function pdvRemoveSlot(idx) {
  pdvPz.selected[idx] = null;
  pdvPz.activeSlot = idx;
  pdvRenderSlots();
  pdvUpdateConfirm();
  pdvOpenSlot(idx);
}

function pdvUpdateConfirm() {
  const filled    = pdvPz.selected.filter(Boolean);
  const allFilled = pdvPz.selected.every(Boolean) && pdvPz.selected.length > 0;
  document.getElementById('pdv-pz-confirm').disabled = !allFilled;
  const maxP = filled.length ? Math.max(...filled.map(f => f.price)) : 0;
  document.getElementById('pdv-pz-total').textContent = 'R$ ' + maxP.toFixed(2).replace('.',',');
}

function pdvConfirmPizza() {
  if (!pdvPz.selected.every(Boolean)) return;
  const maxP  = Math.max(...pdvPz.selected.map(f => f.price));
  const names = pdvPz.selected.map(f => f.name).join(' + ');
  cartItems.push({ id: Date.now(), name: '🍕 '+names, price: maxP, qty: 1, emoji: '🍕', _isPizza: true });
  renderCart();
  showToast('🍕', 'Pizza adicionada!');
  closePDVPizza();
}

function filterPDV(){renderPDV();}

// ─────────────────────────────────────────
// EMOJI GRID
// ─────────────────────────────────────────
function buildEmojiGrid(){
  const g=document.getElementById('emoji-grid');
  if(!g) return;
  g.innerHTML=EMOJIS_PLAIN.map(e=>`<div class="emo-btn" onclick="selEmoji(this,'add')">${e}</div>`).join('');
}

function selEmoji(el, ctx){
  // Only deselect emojis in the same grid context
  const grid = el.closest('.emoji-grid');
  if (grid) grid.querySelectorAll('.emo-btn').forEach(b=>b.classList.remove('on'));
  el.classList.add('on');
}

// Open add-item modal and populate category select
function openAddItemModal(catKeyDefault) {
  populateCatSelects();
  if (catKeyDefault) {
    const sel = document.getElementById('new-cat');
    if (sel) sel.value = catKeyDefault;
  }
  // Reset form
  ['new-name','new-desc','new-ingredients','new-price','new-price-old'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  const nt = document.getElementById('new-item-type'); if(nt) nt.value='normal';
  const ns = document.getElementById('new-status'); if(ns) ns.value='active';
  document.querySelectorAll('#emoji-grid .emo-btn').forEach(b=>b.classList.remove('on'));
  openModal('modal-add-item');
}

// ─────────────────────────────────────────
// NOTIFICAÇÕES
// ─────────────────────────────────────────
function toggleNotif(){document.getElementById('notif-panel').classList.toggle('on');}
function closeNotif(){document.getElementById('notif-panel').classList.remove('on');}
function clearNotifs(){
  document.getElementById('notif-panel').querySelectorAll('.notif-item').forEach(n=>n.remove());
  const nc=document.getElementById('notif-count');
  nc.textContent='0';nc.style.display='none';
  closeNotif();showToast('<svg width=\'14\' height=\'14\' viewBox=\'0 0 16 16\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'><circle cx=&quot;8&quot; cy=&quot;8&quot; r=&quot;6&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;1.4&quot; fill=&quot;none&quot; stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot;/><path d=&quot;M5.5 8l2 2 3-3&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;1.4&quot; fill=&quot;none&quot; stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot;/></svg>','Notificações limpas');
}

// ─────────────────────────────────────────
// MODAL
// ─────────────────────────────────────────
function openModal(id){document.getElementById(id).classList.add('on');closeNotif();}
function closeModal(id){document.getElementById(id).classList.remove('on');}
document.querySelectorAll('.modal-bg').forEach(m=>{
  m.addEventListener('click',e=>{if(e.target===m) m.classList.remove('on');});
});

// ─────────────────────────────────────────
// STATUS & SOUND
// ─────────────────────────────────────────
// sidebar state saved in store_config.sidebar_state (jsonb)
let _sidebarState = {};

async function loadSidebarState() {
  try {
    const { data } = await sb.from('store_config').select('sidebar_state').single();
    _sidebarState = (data && data.sidebar_state) ? data.sidebar_state : {};
  } catch(e) { _sidebarState = {}; }
  ['sg-dia','sg-cardapio','sg-venda','sg-gestao'].forEach(id => {
    if (_sidebarState[id]) {
      const group = document.getElementById(id);
      const headId = 'sh-' + id.replace('sg-','');
      const head   = document.getElementById(headId);
      if (group) group.classList.add('collapsed');
      if (head)  head.classList.add('collapsed');
    }
  });
}

async function saveSidebarState() {
  try {
    await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, sidebar_state: _sidebarState });
  } catch(e) { console.warn('sidebar state save:', e); }
}

function toggleSideGroup(id) {
  const group  = document.getElementById(id);
  const headId = 'sh-' + id.replace('sg-','');
  const head   = document.getElementById(headId);
  if (!group) return;
  const collapsed = group.classList.toggle('collapsed');
  if (head) head.classList.toggle('collapsed', collapsed);
  _sidebarState[id] = collapsed;
  saveSidebarState();
}

// ═══════════════════════════════════════
// PDV BALCÃO COMPLETO
// ═══════════════════════════════════════
let pdvbCart=[],pdvbActiveCat='__todos__',pdvbActiveTab='d',pdvbFilter='todos';
let pdvbEntregaTipo='balcao',pdvbEntregaTaxa=0,pdvbEntregaAddr='',pdvbMesaNum=null;
let pdvbPagamento='Dinheiro',pdvbDesconto=0,pdvbFocusIdx=-1,pdvbObsIdx=-1;
let pdvbMesaSubtab='mesas',pdvbMesaSelecionada=null;

function renderPDVBalcao(){pdvbRenderCats();pdvbRenderGrid();pdvbRenderOrder();pdvbSetupKeyboard();}

function pdvbRenderCats(){
  const el=document.getElementById('pdvb-cats');if(!el)return;
  const cats=['Todos',...new Set(items.filter(i=>i.status==='active').map(i=>i.cat).filter(Boolean))];
  el.innerHTML=cats.map(c=>{const k=c==='Todos'?'__todos__':c;return`<div class="pdvb-cat${pdvbActiveCat===k?' on':''}" onclick="pdvbSelectCat('${k}')">${c}</div>`;}).join('<span style="color:var(--border);font-size:14px;align-self:center">|</span>');
}
function pdvbSelectCat(k){pdvbActiveCat=k;pdvbFocusIdx=-1;pdvbRenderGrid();}
function pdvbGetFilteredItems(){
  const q=(document.getElementById('pdvb-search')||{}).value||'';
  return items.filter(i=>{
    if(i.status!=='active')return false;
    if(pdvbActiveCat!=='__todos__'&&i.cat!==pdvbActiveCat)return false;
    if(pdvbFilter==='promo'&&!i.promo)return false;
    if(pdvbFilter==='pizza'&&i.itemType!=='pizza')return false;
    if(q&&!i.name.toLowerCase().includes(q.toLowerCase()))return false;
    return true;
  });
}
function pdvbRenderGrid(){
  const g=document.getElementById('pdvb-grid');if(!g)return;
  const fil=pdvbGetFilteredItems();
  if(!fil.length){g.innerHTML='<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px;font-size:13px;opacity:.7">Nenhum item encontrado</div>';return;}
  g.innerHTML=fil.map((i,idx)=>`
    <div class="pdvb-item${pdvbFocusIdx===idx?' focused':''}" onclick="pdvbAddItem(${i.id})" id="pdvbi-${idx}">
      <div class="pdvb-item-img">${i.imageUrl?`<img src="${i.imageUrl}" style="width:100%;height:100%;object-fit:cover">`:(i.emoji||'🍽️')}</div>
      <div class="pdvb-item-info">
        <div class="pdvb-item-name">${i.name}</div>
        <div class="pdvb-item-price">R$ ${i.price.toFixed(2).replace('.',',')}${i.promo?'<span style="font-size:9px;background:rgba(34,197,94,.12);color:var(--success);border-radius:3px;padding:1px 4px;margin-left:4px;font-weight:700">PROMO</span>':''}</div>
      </div>
    </div>`).join('');
  pdvbRenderCats();
}
function pdvbAddItem(id){
  const it=items.find(i=>i.id===id);if(!it)return;
  if(it.itemType==='pizza'){openPDVPizza(id);return;}
  const ci=pdvbCart.find(c=>c.id===id&&!c.obs);
  if(ci)ci.qty++;else pdvbCart.push({...it,qty:1,obs:''});
  pdvbRenderOrder();sbToast('ok',`${it.name} adicionado!`);
}
function pdvbRenderOrder(){
  const el=document.getElementById('pdvb-order-items');if(!el)return;
  if(pdvbCart.length===0){
    el.innerHTML=`<div class="pdvb-empty-order"><svg width="32" height="32" viewBox="0 0 16 16" fill="none" style="opacity:.3"><path d="M2 2h2l1.5 7.5A1 1 0 0 0 6.5 11h5a1 1 0 0 0 1-.8L14 6H4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="7" cy="13.5" r="1" fill="currentColor"/><circle cx="12" cy="13.5" r="1" fill="currentColor"/></svg>Finalize o item ao lado,<br>ele vai aparecer aqui</div>`;
  }else{
    el.innerHTML=pdvbCart.map((ci,idx)=>`
      <div class="pdvb-oi">
        <div class="pdvb-oi-emoji">${ci.emoji||'🍽️'}</div>
        <div class="pdvb-oi-info">
          <div class="pdvb-oi-name">${ci.name}</div>
          <div class="pdvb-oi-price">R$ ${(ci.price*ci.qty).toFixed(2).replace('.',',')}</div>
          ${ci.obs?`<div class="pdvb-oi-obs">💬 ${ci.obs}</div>`:''}
        </div>
        <div class="pdvb-oi-ctrl">
          <div class="pdvb-qb" onclick="pdvbChangeQty(${idx},-1)">−</div>
          <div class="pdvb-qn">${ci.qty}</div>
          <div class="pdvb-qb" onclick="pdvbChangeQty(${idx},1)">+</div>
        </div>
      </div>`).join('');
  }
  const sub=pdvbCart.reduce((s,ci)=>s+ci.price*ci.qty,0);
  const total=Math.max(0,sub+pdvbEntregaTaxa-pdvbDesconto);
  document.getElementById('pdvb-subtotal').textContent='R$ '+sub.toFixed(2).replace('.',',');
  document.getElementById('pdvb-total').textContent='R$ '+total.toFixed(2).replace('.',',');
  document.getElementById('pdvb-entrega').textContent=pdvbEntregaTaxa>0?'R$ '+pdvbEntregaTaxa.toFixed(2).replace('.',','):'Grátis';
  document.getElementById('pdvb-entrega').style.color=pdvbEntregaTaxa>0?'var(--text)':'var(--success)';
  const dr=document.getElementById('pdvb-desconto-row');
  if(pdvbDesconto>0){dr.style.display='flex';document.getElementById('pdvb-desconto').textContent='-R$ '+pdvbDesconto.toFixed(2).replace('.',',');}else{dr.style.display='none';}
  const btn=document.getElementById('pdvb-gerar');if(btn)btn.disabled=pdvbCart.length===0;
  const cl=document.getElementById('pdvb-client');if(cl&&pdvbMesaNum&&!cl.value)cl.value=`Mesa ${pdvbMesaNum}`;
}
function pdvbChangeQty(idx,delta){pdvbCart[idx].qty+=delta;if(pdvbCart[idx].qty<=0)pdvbCart.splice(idx,1);pdvbRenderOrder();}
function pdvbClearCart(){
  pdvbCart=[];pdvbDesconto=0;pdvbEntregaTaxa=0;pdvbEntregaTipo='balcao';pdvbEntregaAddr='';pdvbPagamento='Dinheiro';pdvbMesaNum=null;pdvbMesaSelecionada=null;
  const ph=document.getElementById('pdvb-phone'),cl=document.getElementById('pdvb-client');
  if(ph)ph.value='';if(cl)cl.value='';pdvbRenderOrder();sbToast('ok','Pedido limpo');
}
function pdvbSwitchTab(tab){
  pdvbActiveTab=tab;
  ['d','m'].forEach(t=>document.getElementById('pdvb-tab-'+t)?.classList.toggle('on',t===tab));
  if(tab==='m'){pdvbOpenMesaModal();setTimeout(()=>{document.getElementById('pdvb-tab-d')?.classList.add('on');document.getElementById('pdvb-tab-m')?.classList.remove('on');pdvbActiveTab='d';},200);}
}
function pdvbToggleFilter(){const p=document.getElementById('pdvb-filter-panel');if(p)p.style.display=p.style.display==='none'?'block':'none';}
function pdvbSetFilter(f){
  pdvbFilter=f;
  ['todos','promo','pizza'].forEach(k=>{const b=document.getElementById('pdvb-f-'+k);if(b){b.classList.toggle('on',k===f);b.style.color=k===f?'var(--accent)':'';b.style.borderColor=k===f?'var(--accent)':'';}});
  pdvbRenderGrid();
}
function pdvbBackCat(){pdvbSelectCat('__todos__');}
function pdvbOpenObs(){
  if(pdvbCart.length===0){sbToast('err','Adicione itens primeiro');return;}
  pdvbObsIdx=pdvbCart.length-1;
  const it=pdvbCart[pdvbObsIdx];
  const ne=document.getElementById('pdvb-obs-item-name'),te=document.getElementById('pdvb-obs-text');
  if(ne)ne.textContent=it.name;if(te)te.value=it.obs||'';
  openModal('modal-pdvb-obs');
}
function pdvbSaveObs(){
  const text=(document.getElementById('pdvb-obs-text')||{}).value||'';
  if(pdvbObsIdx>=0&&pdvbObsIdx<pdvbCart.length){pdvbCart[pdvbObsIdx].obs=text;pdvbRenderOrder();}
  closeModal('modal-pdvb-obs');sbToast('ok','Observação salva!');
}
function pdvbEntrega(){openModal('modal-pdvb-entrega');}
function pdvbSelectEntrega(label,val){
  document.querySelectorAll('#modal-pdvb-entrega label').forEach(l=>l.style.borderColor=l===label?'var(--accent)':'var(--border)');
  const w=document.getElementById('pdvb-addr-wrap');if(w)w.style.display=val==='delivery'?'block':'none';
}
function pdvbUpdateTaxa(){pdvbEntregaTaxa=parseFloat(document.getElementById('pdvb-taxa-val')?.value)||0;pdvbRenderOrder();}
function pdvbConfirmEntrega(){
  const tipo=document.querySelector('input[name="pdvb-entrega"]:checked')?.value||'balcao';
  pdvbEntregaTipo=tipo;
  if(tipo==='delivery'){
    const rua   =(document.getElementById('pdvb-rua')?.value||'').trim();
    const num   =(document.getElementById('pdvb-num')?.value||'').trim();
    const bairro=(document.getElementById('pdvb-bairro')?.value||'').trim();
    const compl =(document.getElementById('pdvb-compl')?.value||'').trim();
    const ref   =(document.getElementById('pdvb-ref')?.value||'').trim();
    const partes=[rua,num,bairro,compl,ref].filter(Boolean);
    if(!rua){sbToast('err','Informe a rua/avenida');return;}
    pdvbEntregaAddr=partes.join(', ');
    pdvbEntregaTaxa=parseFloat(document.getElementById('pdvb-taxa-val')?.value)||0;
  } else {
    pdvbEntregaTaxa=0;
    pdvbEntregaAddr='';
  }
  pdvbRenderOrder();closeModal('modal-pdvb-entrega');
  sbToast('ok',tipo==='delivery'?`🛵 Delivery — R$ ${pdvbEntregaTaxa.toFixed(2).replace('.',',')}`:'🏪 Balcão / Retirada');
}
function pdvbPagamentos(){openModal('modal-pdvb-pag');}
function pdvbSelectPag(label,val){
  pdvbPagamento=val;
  document.querySelectorAll('#pdvb-pag-grid label').forEach(l=>l.style.borderColor=l===label?'var(--accent)':'var(--border)');
  const tw=document.getElementById('pdvb-troco-wrap');if(tw)tw.style.display=val==='Dinheiro'?'block':'none';
}
function pdvbConfirmPag(){closeModal('modal-pdvb-pag');sbToast('ok',`Pagamento: ${pdvbPagamento}`);}
function pdvbCPF(){const v=prompt('CPF/CNPJ do cliente (opcional):');if(v!==null)sbToast('ok',v?`CPF/CNPJ: ${v}`:'CPF/CNPJ removido');}
function pdvbAjustar(){
  document.getElementById('pdvb-desc-pct').value='';document.getElementById('pdvb-desc-val').value='';document.getElementById('pdvb-desc-preview').style.display='none';
  openModal('modal-pdvb-ajustar');
}
function pdvbPreviewDesc(){
  const sub=pdvbCart.reduce((s,ci)=>s+ci.price*ci.qty,0);
  const pct=parseFloat(document.getElementById('pdvb-desc-pct')?.value)||0;
  const val=parseFloat(document.getElementById('pdvb-desc-val')?.value)||0;
  const desc=pct>0?sub*(pct/100):val;
  const p=document.getElementById('pdvb-desc-preview');
  if(p&&desc>0){p.style.display='block';p.innerHTML=`<div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Desconto</span><span style="color:var(--success);font-weight:700">-R$ ${desc.toFixed(2).replace('.',',')}</span></div><div style="display:flex;justify-content:space-between;font-weight:700;margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><span>Total</span><span style="color:var(--accent)">R$ ${Math.max(0,sub+pdvbEntregaTaxa-desc).toFixed(2).replace('.',',')}</span></div>`;}
}
function pdvbConfirmAjuste(){
  const sub=pdvbCart.reduce((s,ci)=>s+ci.price*ci.qty,0);
  const pct=parseFloat(document.getElementById('pdvb-desc-pct')?.value)||0;
  const val=parseFloat(document.getElementById('pdvb-desc-val')?.value)||0;
  pdvbDesconto=pct>0?sub*(pct/100):val;pdvbRenderOrder();closeModal('modal-pdvb-ajustar');
  sbToast('ok',`Desconto de R$ ${pdvbDesconto.toFixed(2).replace('.',',')} aplicado!`);
}
async function pdvbGerarPedido(){
  if(pdvbCart.length===0){sbToast('err','Carrinho vazio!');return;}
  const client=document.getElementById('pdvb-client')?.value||(pdvbMesaNum?`Mesa ${pdvbMesaNum}`:'Balcão');
  const phone=document.getElementById('pdvb-phone')?.value||'';
  const sub=pdvbCart.reduce((s,ci)=>s+ci.price*ci.qty,0);
  const total=Math.max(0,sub+pdvbEntregaTaxa-pdvbDesconto);
  const addr=pdvbEntregaTipo==='mesa'?`Mesa ${pdvbMesaNum}`:pdvbEntregaTipo==='delivery'?(pdvbEntregaAddr||'Entrega'):'balcão';
  const time=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  const itemsData=pdvbCart.map(ci=>({id:ci.id,name:ci.name,qty:ci.qty,price:ci.price,obs:ci.obs||'',emoji:ci.emoji||''}));
  sbLoading(true);
  try{
    const payload={client:client||'Balcão',phone,items:itemsData,total,taxa:pdvbEntregaTaxa,status:'analise',addr,pag:pdvbPagamento,time};
    if(pdvbMesaNum)payload.mesa_num=pdvbMesaNum;
    const{data:ord,error:ordErr}=await sb.from('orders').insert(payload).select().single();
    if(ordErr)throw ordErr;
    if(pdvbMesaNum){await sb.from('mesas').update({status:'busy'}).eq('num',pdvbMesaNum);const t=tables.find(x=>x.num===pdvbMesaNum);if(t)t.status='busy';}
    await sb.from('movimentos').insert({description:`PDV — ${client}`,tipo:'entrada',val:total,pag:pdvbPagamento,time});
    if(ord)ordersKanban.unshift({id:ord.id,client:ord.client,phone:ord.phone,items:itemsData,total,taxa:pdvbEntregaTaxa,status:'analise',time,addr,pag:pdvbPagamento});
    playOrderSound();sbToast('ok',`✅ Pedido #${ord?.id||'?'} gerado — R$ ${total.toFixed(2).replace('.',',')}`);pdvbClearCart();
  }catch(e){console.error(e);sbToast('err','Erro: '+(e?.message||JSON.stringify(e)));}
  finally{sbLoading(false);}
}
function pdvbFormatPhone(input){
  let v=input.value.replace(/\D/g,'').slice(0,11);
  if(v.length>10)v=v.replace(/(\d{2})(\d{5})(\d{4})/,'($1) $2-$3');
  else if(v.length>6)v=v.replace(/(\d{2})(\d{4})(\d*)/,'($1) $2-$3');
  else if(v.length>2)v=v.replace(/(\d{2})(\d*)/,'($1) $2');
  input.value=v;
}
// Mesa modal
function pdvbOpenMesaModal(){pdvbMesaSelecionada=null;pdvbMesaSubtab='mesas';pdvbRenderMesaModal();openModal('modal-pdvb-mesa');}
function pdvbMesaSubSwitch(tab){
  pdvbMesaSubtab=tab;
  document.getElementById('pdvb-mesa-sub-mesas')?.style&&(document.getElementById('pdvb-mesa-sub-mesas').style.color=tab==='mesas'?'var(--accent)':'var(--muted)');
  document.getElementById('pdvb-mesa-sub-mesas').style.borderBottomColor=tab==='mesas'?'var(--accent)':'transparent';
  document.getElementById('pdvb-mesa-sub-comandas').style.color=tab==='comandas'?'var(--accent)':'var(--muted)';
  document.getElementById('pdvb-mesa-sub-comandas').style.borderBottomColor=tab==='comandas'?'var(--accent)':'transparent';
  pdvbRenderMesaModal();
}
function pdvbRenderMesaModal(){
  const grid=document.getElementById('pdvb-mesa-grid');if(!grid)return;
  const q=(document.getElementById('pdvb-mesa-search')||{}).value?.toLowerCase()||'';
  const fil=tables.filter(t=>!q||`mesa ${t.num}`.includes(q)||(pdvbMesaSubtab==='comandas'&&t.status!=='free')||true);
  const list=pdvbMesaSubtab==='mesas'?fil:fil.filter(t=>t.status!=='free');
  if(!list.length){grid.innerHTML='<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:30px;font-size:13px">Nenhuma mesa encontrada</div>';return;}
  grid.innerHTML=list.filter(t=>!q||`mesa ${t.num}`.includes(q)).map(t=>{
    const isFree=t.status==='free',isWait=t.status==='waiting';
    const sel=pdvbMesaSelecionada?.num===t.num;
    const statusLabel=isFree?'Livre':isWait?'Aguard. pag.':'Ocupada';
    const statusColor=isFree?'var(--success)':isWait?'var(--accent3)':'var(--danger)';
    const border=sel?'var(--accent)':isFree?'rgba(34,197,94,.35)':isWait?'rgba(245,158,11,.35)':'rgba(239,68,68,.35)';
    const bg=sel?'rgba(59,130,246,.1)':isFree?'rgba(34,197,94,.07)':isWait?'rgba(245,158,11,.07)':'rgba(239,68,68,.07)';
    return`<div onclick="pdvbSelectMesa(${t.num},'${t.status}')" style="border:2px solid ${border};background:${bg};border-radius:12px;padding:18px 14px;cursor:pointer;transition:all .15s;text-align:center">
      <div style="font-size:15px;font-weight:700;margin-bottom:6px;color:${sel?'var(--accent)':'var(--text)'}">Mesa ${t.num}</div>
      ${t.guests?`<div style="font-size:11px;color:var(--muted);margin-bottom:4px">👥 ${t.guests} pessoas</div>`:''}
      <div style="font-size:11.5px;font-weight:700;color:${statusColor}">${statusLabel}</div>
      ${t.total?`<div style="font-size:11px;color:var(--muted);margin-top:4px">R$ ${parseFloat(t.total).toFixed(2).replace('.',',')}</div>`:''}
    </div>`;
  }).join('');
}
function pdvbSelectMesa(num,status){
  pdvbMesaSelecionada={num,status};pdvbRenderMesaModal();
  const btn=document.getElementById('pdvb-mesa-confirm-btn');if(btn){btn.disabled=false;btn.textContent=`Confirmar Mesa ${num}`;}
}
function pdvbConfirmMesa(){
  if(!pdvbMesaSelecionada){sbToast('err','Selecione uma mesa');return;}
  const{num}=pdvbMesaSelecionada;closeModal('modal-pdvb-mesa');
  const cl=document.getElementById('pdvb-client');if(cl)cl.value=`Mesa ${num}`;
  pdvbMesaNum=num;pdvbEntregaTipo='mesa';pdvbEntregaTaxa=0;pdvbEntregaAddr=`Mesa ${num}`;
  sbToast('ok',`Mesa ${num} selecionada!`);pdvbRenderOrder();
}
function pdvbCancelMesaModal(){closeModal('modal-pdvb-mesa');}
// Teclado
function pdvbSetupKeyboard(){document.removeEventListener('keydown',_pdvbKeyHandler);document.addEventListener('keydown',_pdvbKeyHandler);}
function _pdvbKeyHandler(e){
  const page=document.getElementById('page-pdv-balcao');if(!page||!page.classList.contains('on'))return;
  const tag=document.activeElement?.tagName;if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
  const fil=pdvbGetFilteredItems();
  switch(e.key.toUpperCase()){
    case 'D':pdvbSwitchTab('d');break;case 'M':pdvbSwitchTab('m');break;
    case 'F':pdvbToggleFilter();break;case 'P':document.getElementById('pdvb-search')?.focus();e.preventDefault();break;
    case 'O':pdvbOpenObs();break;case 'A':pdvbGerarPedido();break;
    case 'E':pdvbEntrega();break;case 'R':pdvbPagamentos();break;
    case 'T':pdvbCPF();break;case 'Y':pdvbAjustar();break;case 'V':pdvbBackCat();break;
    case 'ARROWRIGHT':case 'ARROWDOWN':pdvbFocusIdx=Math.min(pdvbFocusIdx+1,fil.length-1);pdvbRenderGrid();document.getElementById('pdvbi-'+pdvbFocusIdx)?.scrollIntoView({block:'nearest',behavior:'smooth'});e.preventDefault();break;
    case 'ARROWLEFT':case 'ARROWUP':pdvbFocusIdx=Math.max(pdvbFocusIdx-1,0);pdvbRenderGrid();document.getElementById('pdvbi-'+pdvbFocusIdx)?.scrollIntoView({block:'nearest',behavior:'smooth'});e.preventDefault();break;
    case 'ENTER':if(pdvbFocusIdx>=0&&pdvbFocusIdx<fil.length){pdvbAddItem(fil[pdvbFocusIdx].id);e.preventDefault();}break;
  }
}

// ═══════════════════════════════════════
// CLIENTES & ANIVERSARIANTES
// ═══════════════════════════════════════
let _clientesTab = 'todos';

function clientesTab(tab) {
  _clientesTab = tab;
  const btnTodos = document.getElementById('btn-tab-todos');
  const btnAniv  = document.getElementById('btn-tab-aniversario');
  const btnCad   = document.getElementById('btn-tab-cadastrados');
  if (btnTodos) { btnTodos.style.background = tab==='todos'?'var(--accent)':''; btnTodos.style.color = tab==='todos'?'#fff':''; btnTodos.style.borderColor = tab==='todos'?'var(--accent)':'var(--border)'; }
  if (btnAniv)  { btnAniv.style.background  = tab==='aniversario'?'var(--purple)':''; btnAniv.style.color = tab==='aniversario'?'#fff':''; btnAniv.style.borderColor = tab==='aniversario'?'var(--purple)':'var(--border)'; }
  if (btnCad)   { btnCad.style.background   = tab==='cadastrados'?'var(--accent3)':''; btnCad.style.color = tab==='cadastrados'?'#fff':''; btnCad.style.borderColor = tab==='cadastrados'?'var(--accent3)':'var(--border)'; }
  renderClientes();
}

function renderClientesPage() {
  _clientesTab = 'todos';
  clientesTab('todos');
  renderClientes();
}

// Mescla fidelidade + customers numa lista unificada
function _mergeClientes() {
  const today   = new Date();
  const todayMD = String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
  const mesMes  = today.getMonth() + 1;

  // Base: fidelidade
  const byPhone = {};
  fidClients.forEach(c => {
    const key = (c.phone||'').replace(/\D/g,'');
    byPhone[key] = {
      _fidId: c.id, _custId: null,
      name: c.name, phone: c.phone||'', birthday: c.birthday||null,
      pts: c.pts||0, max: c.max||500,
      orders: c.orders||0, resgates: c.resgates||0,
      email: null, addr: null, total_spent: 0, created_at: null,
      fromCardapio: false
    };
  });

  // Mescla customers (cadastros do cardápio)
  customersData.forEach(c => {
    const key = (c.phone||'').replace(/\D/g,'');
    if (byPhone[key]) {
      // Enriquece registro existente
      byPhone[key]._custId     = c.id;
      byPhone[key].email       = c.email || byPhone[key].email;
      byPhone[key].birthday    = byPhone[key].birthday || c.birthday;
      byPhone[key].addr        = c.addr || null;
      byPhone[key].total_spent = parseFloat(c.total_spent)||0;
      byPhone[key].orders      = Math.max(byPhone[key].orders, c.orders_count||0);
      byPhone[key].created_at  = c.created_at;
      byPhone[key].fromCardapio = true;
    } else {
      byPhone[key] = {
        _fidId: null, _custId: c.id,
        name: c.name, phone: c.phone||'', birthday: c.birthday||null,
        pts: 0, max: 500,
        orders: c.orders_count||0, resgates: 0,
        email: c.email||null, addr: c.addr||null,
        total_spent: parseFloat(c.total_spent)||0,
        created_at: c.created_at, fromCardapio: true
      };
    }
  });

  return Object.values(byPhone).map(c => ({
    ...c,
    isAnivHoje: c.birthday ? c.birthday.slice(5) === todayMD : false,
    isAnivMes:  c.birthday ? parseInt(c.birthday.slice(5,7)) === mesMes : false,
    diasAteAniv: c.birthday ? _diasAteAniversario(c.birthday) : 999
  }));
}

function renderClientes() {
  const search  = (document.getElementById('cli-search')?.value || '').toLowerCase();
  const order   = document.getElementById('cli-order')?.value || 'nome';

  let clientes = _mergeClientes();

  // Stats
  document.getElementById('cli-total').textContent      = clientes.length;
  document.getElementById('cli-aniv-hoje').textContent  = clientes.filter(c=>c.isAnivHoje).length;
  document.getElementById('cli-aniv-mes').textContent   = clientes.filter(c=>c.isAnivMes).length;
  document.getElementById('cli-com-pts').textContent    = clientes.filter(c=>c.pts>0).length;

  // Banner aniversariantes hoje
  const hoje = clientes.filter(c => c.isAnivHoje);
  const banner     = document.getElementById('cli-aniv-banner');
  const hojeBadge  = document.getElementById('cli-aniv-hoje-badge');
  const hojeList   = document.getElementById('cli-aniv-hoje-list');
  if (banner) banner.style.display = hoje.length ? 'block' : 'none';
  if (hojeBadge) hojeBadge.textContent = hoje.length;
  if (hojeList) hojeList.innerHTML = hoje.map(c=>`
    <div style="display:flex;align-items:center;gap:7px;background:rgba(139,92,246,.15);border:1px solid rgba(139,92,246,.25);border-radius:8px;padding:6px 10px">
      <span style="font-size:18px">🎂</span>
      <div><div style="font-size:12.5px;font-weight:600">${c.name}</div><div style="font-size:11px;color:var(--muted)">${c.phone||'—'}</div></div>
    </div>`).join('');

  // Filtrar por tab
  if (_clientesTab === 'aniversario') {
    clientes = clientes.filter(c => c.birthday);
    clientes.sort((a,b) => a.diasAteAniv - b.diasAteAniv);
  } else if (_clientesTab === 'cadastrados') {
    clientes = clientes.filter(c => c.fromCardapio);
    if (order === 'nome')    clientes.sort((a,b) => a.name.localeCompare(b.name));
    else if (order === 'pedidos') clientes.sort((a,b) => (b.orders||0) - (a.orders||0));
    else if (order === 'gasto')   clientes.sort((a,b) => (b.total_spent||0) - (a.total_spent||0));
  } else {
    if (order === 'nome')         clientes.sort((a,b) => a.name.localeCompare(b.name));
    else if (order === 'pts')     clientes.sort((a,b) => b.pts - a.pts);
    else if (order === 'pedidos') clientes.sort((a,b) => (b.orders||0) - (a.orders||0));
    else if (order === 'gasto')   clientes.sort((a,b) => (b.total_spent||0) - (a.total_spent||0));
    else if (order === 'aniversario') clientes.sort((a,b) => a.diasAteAniv - b.diasAteAniv);
  }

  if (search) clientes = clientes.filter(c =>
    c.name.toLowerCase().includes(search) || (c.phone||'').includes(search) || (c.email||'').toLowerCase().includes(search)
  );

  document.getElementById('cli-count').textContent = `${clientes.length} cliente${clientes.length!==1?'s':''}`;

  const tbody = document.getElementById('cli-tbody');
  if (!tbody) return;
  if (!clientes.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--muted);font-size:13px">${search?'Nenhum cliente encontrado':'Nenhum cliente cadastrado ainda.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = clientes.map(c => {
    const anivLabel   = c.birthday ? _formatAniversario(c.birthday, c.isAnivHoje, c.isAnivMes) : '<span style="color:var(--muted)">—</span>';
    const ptsBar      = c.max ? Math.min(100, Math.round((c.pts/c.max)*100)) : 0;
    const gastoLabel  = c.total_spent > 0 ? `<span style="font-size:12px;font-weight:600;color:var(--success)">R$ ${c.total_spent.toFixed(2).replace('.',',')}</span>` : '<span style="color:var(--muted)">—</span>';
    const badge       = c.fromCardapio ? '<span style="font-size:9px;background:rgba(59,130,246,.15);color:var(--accent);padding:1px 6px;border-radius:99px;margin-left:5px;font-weight:600">APP</span>' : '';
    const emailLabel  = c.email ? `<div style="font-size:10.5px;color:var(--muted)">${c.email}</div>` : '';
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--accent),var(--purple));display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;color:#fff">${c.name.charAt(0).toUpperCase()}</div>
          <div>
            <div style="font-weight:600;font-size:13px">${c.name}${badge}</div>
            ${emailLabel}
            ${c.isAnivHoje?'<div style="font-size:10px;color:var(--purple);font-weight:600">🎂 Aniversário hoje!</div>':''}
          </div>
        </div>
      </td>
      <td style="color:var(--muted);font-size:12.5px">${c.phone||'—'}</td>
      <td>${anivLabel}</td>
      <td style="font-size:12.5px;font-weight:600">${c.orders||0}</td>
      <td>${gastoLabel}</td>
      <td>
        <div style="display:flex;align-items:center;gap:7px">
          <div style="flex:1;height:5px;background:var(--surface2);border-radius:99px;overflow:hidden;min-width:50px"><div style="height:100%;width:${ptsBar}%;background:var(--accent);border-radius:99px"></div></div>
          <span style="font-size:12px;font-weight:600;color:var(--accent);min-width:30px">${c.pts}</span>
        </div>
      </td>
      <td>
        <div style="display:flex;gap:5px">
          <button class="btn bg" style="font-size:11px;padding:3px 9px" onclick="openEditCliente('${(c.phone||'').replace(/\D/g,'')}')">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-9 9H2v-3L11 2z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Editar
          </button>
          ${c._fidId ? `<button class="btn bd" style="font-size:11px;padding:3px 9px" onclick="deleteCliente(${c._fidId})">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2.5A.5.5 0 0 1 6.5 2h3a.5.5 0 0 1 .5.5V4M5 4l.7 9.5a.5.5 0 0 0 .5.5h3.6a.5.5 0 0 0 .5-.5L11 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          </button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

function _diasAteAniversario(birthday) {
  if (!birthday) return 999;
  const today = new Date();
  const aniv = new Date(today.getFullYear(), parseInt(birthday.slice(5,7))-1, parseInt(birthday.slice(8,10)));
  if (aniv < today) aniv.setFullYear(today.getFullYear() + 1);
  return Math.round((aniv - today) / (1000*60*60*24));
}

function _formatAniversario(birthday, isHoje, isMes) {
  if (!birthday) return '<span style="color:var(--muted)">—</span>';
  const [,m,d] = birthday.split('-');
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const label = `${d}/${meses[parseInt(m)-1]}`;
  if (isHoje) return `<span style="color:var(--purple);font-weight:700">🎂 ${label} — Hoje!</span>`;
  if (isMes)  return `<span style="color:var(--accent3);font-weight:600">📅 ${label} — Este mês</span>`;
  return `<span style="color:var(--muted)">${label}</span>`;
}

function openEditCliente(phone) {
  // Busca pelo telefone nos dois arrays
  const phoneSan = (phone||'').replace(/\D/g,'');
  const fid  = fidClients.find(c => (c.phone||'').replace(/\D/g,'') === phoneSan);
  const cust = customersData.find(c => (c.phone||'').replace(/\D/g,'') === phoneSan);
  if (!fid && !cust) return;
  document.getElementById('edit-cli-id').value          = fid ? fid.id : '';
  document.getElementById('edit-cli-cust-id').value     = cust ? cust.id : '';
  document.getElementById('edit-cli-nome').value        = (fid||cust).name || '';
  document.getElementById('edit-cli-phone').value       = (fid||cust).phone || '';
  document.getElementById('edit-cli-aniversario').value = (fid?.birthday || cust?.birthday) || '';
  document.getElementById('edit-cli-email').value       = cust?.email || '';
  openModal('modal-edit-cliente');
}

async function saveCliente() {
  const fidId   = parseInt(document.getElementById('edit-cli-id').value) || null;
  const custId  = parseInt(document.getElementById('edit-cli-cust-id').value) || null;
  const name    = document.getElementById('edit-cli-nome').value.trim();
  const phone   = document.getElementById('edit-cli-phone').value.trim();
  const birthday = document.getElementById('edit-cli-aniversario').value || null;
  const email    = document.getElementById('edit-cli-email').value.trim() || null;
  if (!name) { sbToast('err','Informe o nome'); return; }
  sbLoading(true);
  let ok = true;
  if (fidId) {
    const { error } = await sb.from('fidelidade').update({ name, phone, birthday }).eq('id', fidId);
    if (error) ok = false;
    else { const c = fidClients.find(x => x.id === fidId); if (c) { c.name=name; c.phone=phone; c.birthday=birthday; } }
  }
  if (custId) {
    const { error } = await sb.from('customers').update({ name, phone, birthday, email }).eq('id', custId);
    if (error) ok = false;
    else { const c = customersData.find(x => x.id === custId); if (c) { c.name=name; c.phone=phone; c.birthday=birthday; c.email=email; } }
  }
  sbLoading(false);
  if (!ok) { sbToast('err','Erro ao salvar'); return; }
  closeModal('modal-edit-cliente');
  renderClientes();
  sbToast('ok', `${name} atualizado!`);
}

async function deleteCliente(fidId) {
  const c = fidClients.find(x => x.id === fidId);
  const name = c?.name || 'este cliente';
  if (!confirm(`Remover "${name}" do programa de fidelidade?`)) return;
  sbLoading(true);
  const { error } = await sb.from('fidelidade').delete().eq('id', fidId);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao remover'); return; }
  fidClients = fidClients.filter(x => x.id !== fidId);
  renderClientes();
  sbToast('ok', `${name} removido da fidelidade`);
}

let _autoAcceptOn = false;

function toggleAutoAccept(el) {
  el.classList.toggle('on');
  _autoAcceptOn = el.classList.contains('on');
  // Persiste localmente
  try { localStorage.setItem('gestor_auto_accept', _autoAcceptOn ? '1' : '0'); } catch(e) {}
  showToast('🔄', 'Aceitar automaticamente: ' + (_autoAcceptOn ? 'Ativado' : 'Desativado'));
}

// Restaura estado do auto-accept ao carregar
(function() {
  try {
    if (localStorage.getItem('gestor_auto_accept') === '1') {
      _autoAcceptOn = true;
      const el = document.getElementById('auto-accept');
      if (el) el.classList.add('on');
    }
  } catch(e) {}
})();

async function toggleStatus(){
  const st  = document.getElementById('status-txt');
  const dot = document.getElementById('status-dot');
  const pill = document.getElementById('pill-status');
  const on  = st.textContent === 'Online';
  const newOpen = !on;
  st.textContent = newOpen ? 'Online' : 'Offline';
  if (dot)  dot.style.background  = newOpen ? 'var(--success)' : 'var(--danger)';
  if (pill) { pill.style.background = newOpen ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)'; pill.style.borderColor = newOpen ? 'rgba(34,197,94,.25)' : 'rgba(239,68,68,.25)'; pill.style.color = newOpen ? 'var(--success)' : 'var(--danger)'; }
  showToast(newOpen?'⚡':'⏸️', newOpen?'Loja aberta para pedidos!':'Loja pausada');
  try {
    await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, store_open: newOpen });
  } catch(e) { console.warn('store_config sync:', e); }
}

function playOrderSound(){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    [[880,0],[660,0.12],[880,0.24]].forEach(([f,t])=>{
      const o=ctx.createOscillator(),g=ctx.createGain();
      o.connect(g);g.connect(ctx.destination);
      o.type='sine';o.frequency.value=f;
      g.gain.setValueAtTime(0.25,ctx.currentTime+t);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+t+0.18);
      o.start(ctx.currentTime+t);o.stop(ctx.currentTime+t+0.2);
    });
  }catch(e){}
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
    const { data } = await sb.from('store_config').select('delivery_fee_config').single();
    if (data?.delivery_fee_config) _taxaConfig = data.delivery_fee_config;
  } catch(e) {}

  const tipo = _taxaConfig.tipo || 'fixo';
  document.getElementById('taxa-tipo-fixo').checked = tipo === 'fixo';
  document.getElementById('taxa-tipo-km').checked   = tipo === 'por_km';
  document.getElementById('taxa-fixo-val').value    = _taxaConfig.valor ?? 5;

  // Faixas
  const faixas = _taxaConfig.faixas || [];
  const list = document.getElementById('taxa-faixas-list');
  list.innerHTML = '';
  if (!faixas.length && tipo === 'por_km') {
    // Default example rows
    [[1, 3], [3, 5], [7, 8]].forEach(([km, tx]) => _addFaixaRow(km, tx));
  } else {
    faixas.forEach(f => _addFaixaRow(f.ate_km, f.taxa));
  }

  onTaxaTipoChange();
}

function onTaxaTipoChange() {
  const tipo = document.querySelector('input[name="taxa-tipo"]:checked').value;
  document.getElementById('taxa-fixo-block').style.display = tipo === 'fixo'  ? '' : 'none';
  document.getElementById('taxa-km-block').style.display   = tipo === 'por_km' ? '' : 'none';
  // Update label borders
  document.getElementById('taxa-label-fixo').style.borderColor = tipo === 'fixo'   ? 'var(--accent)' : 'var(--border)';
  document.getElementById('taxa-label-km').style.borderColor   = tipo === 'por_km' ? 'var(--accent)' : 'var(--border)';
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
      <span style="font-size:24px">🛵</span>
      <div>
        <div style="font-weight:600;font-size:13px">Taxa de entrega</div>
        <div style="font-size:18px;font-weight:700;color:var(--accent3);font-family:'Playfair Display',sans-serif">R$ ${val.toFixed(2).replace('.',',')}</div>
      </div>
    </div>`;
  } else {
    const faixas = getTaxaFaixasFromDOM();
    if (!faixas.length) { el.innerHTML = '<span style="color:var(--muted)">Adicione pelo menos uma faixa acima.</span>'; return; }
    el.innerHTML = `<div style="font-size:12px;color:var(--muted);margin-bottom:8px">O cliente verá um seletor como este:</div>
      <div style="background:var(--surface2);border-radius:10px;overflow:hidden">
        ${faixas.map((f,i) => `<div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center${i===0?';background:rgba(59,130,246,.08)':''}">
          <span style="font-size:13px">Até ${f.ate_km} km${i===0?' <span style="font-size:10px;background:rgba(59,130,246,.15);color:var(--accent);padding:1px 6px;border-radius:99px;margin-left:6px">selecionado</span>':''}</span>
          <span style="font-family:'Playfair Display',sans-serif;font-weight:700;color:var(--accent3)">R$ ${f.taxa.toFixed(2).replace('.',',')}</span>
        </div>`).join('')}
      </div>`;
  }
}

async function saveTaxaConfig() {
  const tipo = document.querySelector('input[name="taxa-tipo"]:checked').value;
  const config = { tipo };
  if (tipo === 'fixo') {
    config.valor = parseFloat(document.getElementById('taxa-fixo-val').value) || 0;
    config.faixas = [];
  } else {
    config.faixas = getTaxaFaixasFromDOM();
    config.valor = 0;
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

  document.getElementById('modal-pag-mesa-title').textContent = `💰 Registrar Pagamento — Mesa ${num}`;
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
    sbToast('ok', `✅ Mesa ${num} liberada — R$ ${totalVal.toFixed(2).replace('.',',')}${caixaMsg}`);
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
      if (txt) txt.textContent = '🟢 Online';
      if (box) { box.style.borderColor = 'rgba(34,197,94,.3)'; box.style.color = 'var(--success)'; }
      sbToast('ok', '✅ Servidor online! Automações 24/7 ativas.');
      await salvarWaServerUrl();
    } else {
      if (dot) dot.style.background = 'var(--danger)';
      if (txt) txt.textContent = '❌ Erro';
      sbToast('err', 'Servidor respondeu com erro');
    }
  } catch(e) {
    if (dot) dot.style.background = 'var(--danger)';
    if (txt) txt.textContent = '❌ Offline';
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
          if (txt) txt.textContent = '🟢 Online';
          if (box) { box.style.borderColor = 'rgba(34,197,94,.3)'; box.style.color = 'var(--success)'; }
        } else {
          if (dot) dot.style.background = 'var(--danger)';
          if (txt) txt.textContent = '❌ Offline';
        }
      } catch(e) {
        const dot = document.getElementById('wa-sdot');
        const txt = document.getElementById('wa-stxt');
        if (dot) dot.style.background = 'var(--danger)';
        if (txt) txt.textContent = '❌ Offline';
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
  if (qrArea) qrArea.innerHTML='<div style="font-size:32px;margin-bottom:10px">⏳</div><div style="font-size:13px;color:var(--muted)">Gerando QR Code...</div>';
  const r = await EVO.req('GET', `/instance/connect/${EVO.instance}`);
  if (!r.ok || !r.data?.code) {
    if (qrArea) qrArea.innerHTML=`<div style="font-size:13px;color:var(--danger);margin-bottom:12px">❌ ${r.data?.message||'Erro ao gerar QR. Crie a instância primeiro.'}</div><button class="btn bp" onclick="evoCriarInstancia()">➕ Criar instância</button>`;
    return;
  }
  if (qrArea) {
    if (r.data.base64) {
      qrArea.innerHTML=`<div style="font-size:13px;font-weight:600;margin-bottom:12px">📲 Escaneie com seu WhatsApp</div><img src="${r.data.base64}" style="width:220px;height:220px;border-radius:12px;border:3px solid var(--accent);margin-bottom:12px"><div style="font-size:11px;color:var(--muted);margin-bottom:12px">QR Code expira em 60 segundos</div><button class="btn bg" style="font-size:11.5px" onclick="evoConectar()">🔄 Novo QR Code</button>`;
    } else {
      qrArea.innerHTML=`<div style="font-size:12px;word-break:break-all;padding:10px;background:var(--surface2);border-radius:8px;margin-bottom:12px;color:var(--muted)">${(r.data.code||'').slice(0,80)}...</div><button class="btn bg" onclick="evoConectar()">🔄 Novo QR</button>`;
    }
  }
  if (evoQrInterval) clearInterval(evoQrInterval);
  let tries=0;
  evoQrInterval = setInterval(async()=>{
    tries++;
    const s = await EVO.req('GET', `/instance/connectionState/${EVO.instance}`);
    const state = s.data?.instance?.state||s.data?.state||'close';
    if (state==='open') { clearInterval(evoQrInterval); evoConnected=true; _evoSetStatus('connected','Conectado'); _evoShowConnected(s.data?.instance?.profileName||'WhatsApp'); sbToast('ok','✅ WhatsApp conectado!'); }
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
  if (res) { res.style.display='block'; res.innerHTML='<span style="color:var(--muted)">⏳ Enviando...</span>'; }

  const r = await EVO.sendText(phone, msg);
  console.log('[EVO TEST]', r);

  if (r.ok) {
    if (res) res.innerHTML='<span style="color:var(--success)">✅ Mensagem enviada com sucesso!</span>';
    sbToast('ok','✅ Mensagem enviada!');
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
    sbToast(r.ok ? 'ok' : 'err', r.ok ? '🎂 Verificação de aniversários iniciada no servidor!' : 'Erro: servidor offline?')
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
  if (!silencioso) sbToast('ok', '🎂 Enviado para ' + ok + ' aniversariante(s)' + (fail ? ' | ' + fail + ' falhou' : '') + '!');
  else if (ok > 0) sbToast('ok', '🎂 Felicitações automáticas enviadas para ' + ok + ' aniversariante(s)!');
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
  const tipos = ['recebido','confirmado','pronto','entrega','cancelado','aniversario','boasvindas','avaliacao','retorno','promocao','pontos','conta'];
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
    sbToast('ok', '✅ Automações salvas!');
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

// ════════════════════════════════════════════════════════
// AGENTE IA
// ════════════════════════════════════════════════════════

async function iaCarregarConfig() {
  // URL do webhook — usa o slug do tenant (mesma URL já configurada nas automações)
  const urlEl = document.getElementById('ia-webhook-url');
  try {
    const _slugRes1 = await fetch('/api/tenant-slug', { headers: { 'Content-Type': 'application/json', 'x-tenant-id': _sessao?.tenant_id || '' } }).catch(()=>null);
    const slug = (_slugRes1?.ok ? (await _slugRes1.json().catch(()=>({}))).slug : '') || _sessao?.tenant_id || '';
    const webhookUrl = `${window.location.origin}/webhook/${slug}`;
    if (urlEl) urlEl.textContent = webhookUrl;
    // Registra webhook automaticamente na Evolution API ao carregar
    iaRegistrarWebhook(webhookUrl);
  } catch(e) {
    if (urlEl) urlEl.textContent = `${window.location.origin}/webhook/${_sessao?.tenant_id||''}`;
  }

  try {
    const { data } = await sb.from('store_config').select('ia_config').single();
    const ia = data?.ia_config ? JSON.parse(data.ia_config) : {};
    const tog = document.getElementById('ia-toggle-ativo');
    if (tog) { ia.ativo ? tog.classList.add('on') : tog.classList.remove('on'); }
    iaAtualizarStatus();
    ['cardapio','pedido','horario','entrega','promo'].forEach(c => {
      const el = document.getElementById(`ia-resp-${c}`);
      if (el) { ia[`resp_${c}`] ? el.classList.add('on') : el.classList.remove('on'); }
    });
    if (ia.horario_txt) { const el = document.getElementById('ia-horario-txt'); if(el) el.value = ia.horario_txt; }
    if (ia.entrega_txt) { const el = document.getElementById('ia-entrega-txt'); if(el) el.value = ia.entrega_txt; }
  } catch(e) { console.warn('iaCarregarConfig:', e); }
}

function iaAtualizarStatus() {
  const on  = document.getElementById('ia-toggle-ativo')?.classList.contains('on');
  const lbl = document.getElementById('ia-status-lbl');
  if (lbl) {
    lbl.textContent = on ? '🟢 Ativo — respondendo 24/7' : 'Inativo';
    lbl.style.color = on ? 'var(--success)' : 'var(--muted)';
  }
}

async function iaSalvarConfig() {
  // Gestor só salva os tópicos e textos — preserva key/modelo do admin
  let iaAtual = {};
  try {
    const { data } = await sb.from('store_config').select('ia_config').single();
    iaAtual = data?.ia_config ? JSON.parse(data.ia_config) : {};
  } catch(e) {}

  const ia = {
    ...iaAtual, // preserva openai_key, modelo, prompt_base, quebra_linha, buffer_seg, pausa_min
    ativo:        document.getElementById('ia-toggle-ativo')?.classList.contains('on'),
    resp_cardapio:document.getElementById('ia-resp-cardapio')?.classList.contains('on'),
    resp_pedido:  document.getElementById('ia-resp-pedido')?.classList.contains('on'),
    resp_horario: document.getElementById('ia-resp-horario')?.classList.contains('on'),
    resp_entrega: document.getElementById('ia-resp-entrega')?.classList.contains('on'),
    resp_promo:   document.getElementById('ia-resp-promo')?.classList.contains('on'),
    horario_txt:  document.getElementById('ia-horario-txt')?.value || '',
    entrega_txt:  document.getElementById('ia-entrega-txt')?.value || '',
  };

  try {
    const { error } = await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, ia_config: JSON.stringify(ia) });
    if (error) throw error;
    sbToast('ok', '✅ Configurações da IA salvas!');
    iaAtualizarStatus();
  } catch(e) {
    sbToast('err', 'Erro ao salvar: ' + (e.message||JSON.stringify(e)));
  }
}

// ── Busca cliente para retorno manual ──
function retornoBuscar() {
  const q = (document.getElementById('retorno-search')?.value||'').toLowerCase();
  const res = document.getElementById('retorno-resultado');
  if (!q || q.length < 2) { if(res) res.innerHTML=''; return; }
  const found = fidClients.filter(c => c.name.toLowerCase().includes(q) && c.phone);
  if (!found.length) { if(res) res.innerHTML='<span style="color:var(--muted)">Nenhum cliente encontrado com telefone</span>'; return; }
  if (res) res.innerHTML = found.slice(0,3).map(c=>`
    <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:7px;margin-top:4px">
      <span style="font-size:13px;font-weight:600">${c.name}</span>
      <span style="font-size:11px;color:var(--muted)">${c.phone}</span>
      <button class="btn bp" style="font-size:10.5px;padding:2px 8px;margin-left:auto" onclick="evoEnviarRetornoCliente(${c.id})">📤 Enviar</button>
    </div>`).join('');
}

async function evoEnviarRetornoCliente(id) {
  const c = fidClients.find(x => x.id === id);
  if (!c?.phone) { sbToast('err','Cliente sem telefone'); return; }
  const sent = await evoEnviarMensagem(c.phone, 'retorno', { nome: c.name });
  sbToast(sent?'ok':'err', sent?`Mensagem enviada para ${c.name}!`:'Erro ao enviar');
}

async function evoEnviarRetornoManual() {
  const q = (document.getElementById('retorno-search')?.value||'').toLowerCase();
  const c = fidClients.find(x => x.name.toLowerCase().includes(q) && x.phone);
  if (!c) { sbToast('err','Nenhum cliente encontrado com esse nome'); return; }
  const sent = await evoEnviarMensagem(c.phone, 'retorno', { nome: c.name });
  sbToast(sent?'ok':'err', sent?`Mensagem enviada para ${c.name}!`:'Erro ao enviar');
}

// ── Promoção em massa via Edge Function ──────────────
async function evoEnviarPromocao() {
  const destino = document.getElementById('promo-destino')?.value || 'todos';
  const msg     = document.getElementById('auto-msg-promocao')?.value;
  const res     = document.getElementById('promo-resultado');
  if (!msg) { sbToast('err','Escreva a mensagem antes de enviar'); return; }
  // Conta clientes para confirmação
  const total = fidClients.filter(c => c.phone && (destino === 'todos' || (destino === 'com_pedido' && c.orders > 0))).length;
  if (!total) { sbToast('err','Nenhum cliente com telefone encontrado'); return; }
  if (!confirm(`Enviar promoção para ${total} cliente(s)? Este processo roda no servidor e pode demorar alguns minutos.`)) return;
  if (res) { res.style.display='block'; res.innerHTML='<span style="color:var(--muted)">⏳ Iniciando envio no servidor...</span>'; }
  sbLoading(true);
  try {
    // Chama a Edge Function — roda no servidor Supabase, não no browser
    const r = await fetch(`${WA_SERVER}/promocao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destino, msg })
    });
    const data = await r.json().catch(() => ({}));
    sbLoading(false);
    if (r.ok && data.ok) {
      if (res) res.innerHTML = `<span style="color:var(--success)">✅ ${data.enviados} enviados${data.falhou ? ` | ❌ ${data.falhou} falhou` : ''}</span>`;
      sbToast('ok', `Promoção enviada para ${data.enviados} clientes!`);
    } else {
      const err = data.error || `HTTP ${r.status}`;
      if (res) res.innerHTML = `<span style="color:var(--danger)">❌ Erro: ${err}</span>`;
      sbToast('err', 'Erro: ' + err);
    }
  } catch(e) {
    sbLoading(false);
    if (res) res.innerHTML = `<span style="color:var(--danger)">❌ ${e.message}</span>`;
    sbToast('err', 'Erro de conexão');
  }
}


function evoCarregarHistorico() {
  const tbody=document.getElementById('msgs-tbody'), count=document.getElementById('msgs-count');
  if (!tbody) return;
  if (!evoMsgHistory.length) { tbody.innerHTML='<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--muted);font-size:13px">Nenhuma mensagem enviada ainda</td></tr>'; if(count)count.textContent='0 mensagens'; return; }
  if (count) count.textContent=`${evoMsgHistory.length} mensagem(s)`;
  tbody.innerHTML=evoMsgHistory.map(m=>`<tr>
    <td style="font-size:12.5px">${m.to}</td>
    <td><span style="font-size:11px;background:rgba(59,130,246,.1);color:var(--accent);padding:2px 7px;border-radius:99px;font-weight:600">${m.tipo}</span></td>
    <td style="font-size:12px;color:var(--muted);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.msg}</td>
    <td><span style="font-size:11px;font-weight:600;color:${m.status==='enviado'?'var(--success)':'var(--danger)'}">${m.status==='enviado'?'✅ Enviado':'❌ Falhou'}</span></td>
    <td style="font-size:12px;color:var(--muted)">${m.time}</td>
  </tr>`).join('');
}

function _evoSetStatus(type,txt) {
  const dot=document.getElementById('evo-status-dot'), span=document.getElementById('evo-status-txt'), badge=document.getElementById('evo-status-badge');
  const colors={connected:'var(--success)',disconnected:'var(--danger)',loading:'var(--accent3)'};
  if(dot) dot.style.background=colors[type]||'var(--muted)';
  if(span) span.textContent=txt;
  if(badge){ badge.style.borderColor=type==='connected'?'rgba(34,197,94,.3)':'var(--border)'; badge.style.color=type==='connected'?'var(--success)':'var(--muted)'; }
  // Sincroniza bolinha no topnav
  const topDot=document.getElementById('evo-status-dot-top');
  if(topDot) topDot.style.background=colors[type]||'var(--muted)';
}

async function topnavCopiarCardapio(btn) {
  try {
    const tid = _sessao?.tenant_id || '';
    let slug = '';
    try {
      const _slugRes2 = await fetch('/api/tenant-slug', { headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid } }).catch(()=>null);
      slug = (_slugRes2?.ok ? (await _slugRes2.json().catch(()=>({}))).slug : '') || '';
    } catch(e) {}
    const url = slug
      ? `${window.location.origin}/index.html?slug=${encodeURIComponent(slug)}`
      : `${window.location.origin}/index.html?tenant=${encodeURIComponent(tid)}`;
    await navigator.clipboard.writeText(url);
    // Feedback visual temporário no botão
    const svg = btn.querySelector('svg');
    if (svg) {
      const orig = svg.innerHTML;
      svg.innerHTML = '<path d="M3 8l3.5 3.5L13 4" stroke="var(--success)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
      setTimeout(() => svg.innerHTML = orig, 1800);
    }
    sbToast('ok', '🔗 Link do cardápio copiado!');
  } catch(e) {
    sbToast('err', 'Erro ao copiar link');
  }
}
function _evoShowConnected(name) {
  const qr=document.getElementById('evo-qr-area'), cn=document.getElementById('evo-connected-area'), ph=document.getElementById('evo-phone-display');
  if(qr) qr.style.display='none'; if(cn) cn.style.display='block'; if(ph) ph.textContent=name;
}
function _evoShowQRPrompt() {
  const qr=document.getElementById('evo-qr-area'), cn=document.getElementById('evo-connected-area');
  if(qr){ qr.style.display='block'; qr.innerHTML='<div style="font-size:48px;margin-bottom:12px">📱</div><div style="font-size:14px;font-weight:600;margin-bottom:6px">WhatsApp desconectado</div><div style="font-size:12px;color:var(--muted);margin-bottom:16px">Clique para gerar o QR Code</div><button class="btn bp" onclick="evoConectar()">📲 Conectar WhatsApp</button>'; }
  if(cn) cn.style.display='none';
}
// ══ HORÁRIOS DE FUNCIONAMENTO ════════════════════════
const _CP_DIAS = [
  { key:'dom', label:'Domingo' },
  { key:'seg', label:'Segunda' },
  { key:'ter', label:'Terça'   },
  { key:'qua', label:'Quarta'  },
  { key:'qui', label:'Quinta'  },
  { key:'sex', label:'Sexta'   },
  { key:'sab', label:'Sábado'  },
];

function cpRenderHorarios(horarios) {
  const container = document.getElementById('cp-horarios-list');
  if (!container) return;
  container.innerHTML = '';
  for (const d of _CP_DIAS) {
    const h = horarios[d.key] || { ativo: d.key !== 'dom', abertura: '11:00', fechamento: '22:00' };
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:9px;transition:opacity .15s';
    row.id = `cp-hr-row-${d.key}`;
    row.innerHTML = `
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;min-width:80px">
        <div class="toggle-wrap" onclick="cpToggleDia('${d.key}',this)" data-ativo="${h.ativo}" style="width:34px;height:18px;border-radius:9px;background:${h.ativo?'var(--success)':'var(--surface)'};border:1px solid ${h.ativo?'var(--success)':'var(--border)'};position:relative;cursor:pointer;transition:all .2s;flex-shrink:0">
          <div style="position:absolute;top:2px;left:${h.ativo?'16px':'2px'};width:12px;height:12px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>
        </div>
        <span style="font-size:12px;font-weight:600;color:${h.ativo?'var(--text)':'var(--muted)'}" id="cp-hr-label-${d.key}">${d.label}</span>
      </label>
      <div id="cp-hr-times-${d.key}" style="display:${h.ativo?'flex':'none'};align-items:center;gap:6px;flex:1">
        <input type="time" value="${h.abertura||'11:00'}" id="cp-hr-ab-${d.key}"
          style="background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:5px 8px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:12px;outline:none;width:90px"
          oninput="cpHorarioChanged()">
        <span style="font-size:11px;color:var(--muted)">até</span>
        <input type="time" value="${h.fechamento||'22:00'}" id="cp-hr-fch-${d.key}"
          style="background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:5px 8px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:12px;outline:none;width:90px"
          oninput="cpHorarioChanged()">
      </div>
      <span id="cp-hr-fechado-${d.key}" style="display:${h.ativo?'none':'flex'};font-size:11px;color:var(--muted);font-weight:600;flex:1">Fechado</span>
    `;
    container.appendChild(row);
  }
}

function cpToggleDia(key, toggleEl) {
  const timesEl  = document.getElementById(`cp-hr-times-${key}`);
  const fechEl   = document.getElementById(`cp-hr-fechado-${key}`);
  const labelEl  = document.getElementById(`cp-hr-label-${key}`);
  const knob     = toggleEl.querySelector('div');
  const isOn     = toggleEl.dataset.ativo === 'true';
  const nowOn    = !isOn;
  toggleEl.dataset.ativo = String(nowOn);
  toggleEl.style.background = nowOn ? 'var(--success)' : 'var(--surface)';
  toggleEl.style.borderColor = nowOn ? 'var(--success)' : 'var(--border)';
  if (knob) knob.style.left = nowOn ? '16px' : '2px';
  if (timesEl)  timesEl.style.display  = nowOn ? 'flex' : 'none';
  if (fechEl)   fechEl.style.display   = nowOn ? 'none' : 'flex';
  if (labelEl)  labelEl.style.color    = nowOn ? 'var(--text)' : 'var(--muted)';
}

function cpGetHorarios() {
  const out = {};
  for (const d of _CP_DIAS) {
    const toggleEl = document.querySelector(`#cp-hr-row-${d.key} .toggle-wrap`);
    const ativo    = toggleEl ? toggleEl.dataset.ativo === 'true' : false;
    out[d.key] = {
      ativo,
      abertura:    document.getElementById(`cp-hr-ab-${d.key}`)?.value  || '11:00',
      fechamento:  document.getElementById(`cp-hr-fch-${d.key}`)?.value || '22:00',
    };
  }
  return out;
}

function cpHorarioChanged() { /* placeholder para futuros listeners */ }


let _cpLogoUrl   = '';
let _cpBannerUrl = '';

async function loadCardapioPublico() {
  const { data } = await sb.from('store_config').select(
    'store_name,store_descricao,store_logo_url,store_banner_url,store_cor,store_tempo_entrega,store_avaliacao,store_whatsapp,horarios_config'
  ).single();
  if (!data) return;

  const v = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  v('cp-nome',      data.store_name);
  v('cp-descricao', data.store_descricao);
  v('cp-whatsapp',  data.store_whatsapp);
  v('cp-tempo',     data.store_tempo_entrega);
  v('cp-avaliacao', data.store_avaliacao);

  // Horários de funcionamento
  let horarios = {};
  try {
    const hc = data.horarios_config;
    horarios = hc ? (typeof hc === 'string' ? JSON.parse(hc) : hc) : {};
  } catch(e) { horarios = {}; }
  cpRenderHorarios(horarios);

  const cor = data.store_cor || '#3b82f6';
  const corEl = document.getElementById('cp-cor');
  if (corEl) corEl.value = cor;

  if (data.store_logo_url) {
    _cpLogoUrl = data.store_logo_url;
    const prev = document.getElementById('cp-logo-preview');
    if (prev) { prev.innerHTML = ''; prev.style.backgroundImage = `url(${_cpLogoUrl})`; prev.style.backgroundSize = 'cover'; prev.style.backgroundPosition = 'center'; }
    const pp = document.getElementById('cp-prev-logo');
    if (pp) { pp.innerHTML = ''; pp.style.backgroundImage = `url(${_cpLogoUrl})`; pp.style.backgroundSize = 'cover'; pp.style.backgroundPosition = 'center'; }
  }
  if (data.store_banner_url) {
    _cpBannerUrl = data.store_banner_url;
    const prev = document.getElementById('cp-banner-preview');
    if (prev) { prev.innerHTML = ''; prev.style.backgroundImage = `url(${_cpBannerUrl})`; }
    const hero = document.getElementById('cp-preview-hero');
    if (hero) hero.style.backgroundImage = `url(${_cpBannerUrl})`;
  }

  cpMontarLink();
}

async function cpMontarLink() {
  const tid  = _sessao?.tenant_id || '';
  const base = window.location.origin;

  let slug = '';
  try {
    const _slugRes3 = await fetch('/api/tenant-slug', { headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid } }).catch(()=>null);
    if (_slugRes3?.ok) { slug = (await _slugRes3.json().catch(()=>({}))).slug || ''; }
  } catch(e) {}

  const urlCardapio = slug
    ? `${base}/index.html?slug=${encodeURIComponent(slug)}`
    : `${base}/index.html?tenant=${encodeURIComponent(tid)}`;

  const urlGarcom = slug
    ? `${base}/garcom.html?slug=${encodeURIComponent(slug)}`
    : `${base}/garcom.html?tenant=${encodeURIComponent(tid)}`;

  const el = document.getElementById('cp-link-url');
  if (el) el.textContent = urlCardapio;

  const elG = document.getElementById('cp-link-garcom');
  if (elG) elG.textContent = urlGarcom;

  // Carrega iframe do cardápio real pela primeira vez
  cpCarregarIframe(urlCardapio);
}

// ── Iframe do cardápio ────────────────────────────────
function cpCarregarIframe(url) {
  const iframe = document.getElementById('cp-iframe');
  if (!iframe || iframe.src === url) return;
  iframe.src = url || 'about:blank';
}

function cpRecarregarIframe() {
  const iframe = document.getElementById('cp-iframe');
  if (!iframe) return;
  const src = iframe.src;
  iframe.src = 'about:blank';
  setTimeout(() => { iframe.src = src; }, 80);
  sbToast('ok', 'Preview atualizado!');
}

function cpCopiarLink() {
  const el = document.getElementById('cp-link-url');
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => sbToast('ok','Link copiado!'));
}

function cpAbrirLink() {
  const el = document.getElementById('cp-link-url');
  if (el) window.open(el.textContent, '_blank');
}

function cpSetCor(hex) {
  const el = document.getElementById('cp-cor');
  if (el) el.value = hex;
}

// Preview agora é o iframe real — cpPreviewCor e cpAtualizarPreview não são mais necessários

async function cpUploadImagem(input, tipo) {
  const file = input.files[0];
  if (!file) return;
  sbLoading(true);
  try {
    const ext      = file.name.split('.').pop().toLowerCase();
    const filename = `${_sessao?.tenant_id || 'default'}-${tipo}.${ext}`;
    const filepath = `branding/${filename}`;
    await sb.storage.from('menu-images').upload(filepath, file, { upsert: true });
    const { data: { publicUrl } } = sb.storage.from('menu-images').getPublicUrl(filepath);

    if (tipo === 'logo') {
      _cpLogoUrl = publicUrl;
      const prev = document.getElementById('cp-logo-preview');
      if (prev) { prev.innerHTML = ''; prev.style.backgroundImage = `url(${publicUrl})`; prev.style.backgroundSize = 'cover'; prev.style.backgroundPosition = 'center'; }
      const pp = document.getElementById('cp-prev-logo');
      if (pp) { pp.innerHTML = ''; pp.style.backgroundImage = `url(${publicUrl})`; pp.style.backgroundSize = 'cover'; pp.style.backgroundPosition = 'center'; }
    } else {
      _cpBannerUrl = publicUrl;
      const prev = document.getElementById('cp-banner-preview');
      if (prev) { prev.innerHTML = ''; prev.style.backgroundImage = `url(${publicUrl})`; }
      const hero = document.getElementById('cp-preview-hero');
      if (hero) hero.style.backgroundImage = `url(${publicUrl})`;
    }

    // Salva URL no banco imediatamente, sem precisar clicar em "Salvar"
    const field = tipo === 'logo' ? 'store_logo_url' : 'store_banner_url';
    await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, [field]: publicUrl });

    sbToast('ok', `${tipo === 'logo' ? 'Logo' : 'Banner'} enviado e salvo!`);
    // Recarrega iframe para refletir a nova imagem no cardápio
    setTimeout(() => cpRecarregarIframe(), 600);
  } catch(e) {
    console.error('cpUploadImagem:', e);
    sbToast('err', 'Erro ao enviar imagem: ' + (e.message || ''));
  } finally {
    sbLoading(false);
  }
}

async function salvarCardapioPublico() {
  sbLoading(true);
  try {
    const payload = {
      tenant_id:           _sessao?.tenant_id,
      store_name:          document.getElementById('cp-nome')?.value.trim()      || null,
      store_descricao:     document.getElementById('cp-descricao')?.value.trim() || null,
      store_whatsapp:      document.getElementById('cp-whatsapp')?.value.trim()  || null,
      store_tempo_entrega: document.getElementById('cp-tempo')?.value.trim()     || '30-45 min',
      store_avaliacao:     document.getElementById('cp-avaliacao')?.value.trim() || '5.0',
      store_cor:           document.getElementById('cp-cor')?.value              || '#3b82f6',
      horarios_config:     JSON.stringify(cpGetHorarios()),
    };
    if (_cpLogoUrl)   payload.store_logo_url   = _cpLogoUrl;
    if (_cpBannerUrl) payload.store_banner_url = _cpBannerUrl;

    const { error } = await sb.from('store_config').upsert(payload);
    if (error) throw error;
    sbToast('ok', '✅ Cardápio público salvo!');
    // Recarrega dados e atualiza iframe (sincroniza com o cardápio real)
    await loadCardapioPublico();
    // Pequeno delay para o banco propagar via SSE antes de recarregar o iframe
    setTimeout(() => cpRecarregarIframe(), 600);
  } catch(e) {
    sbToast('err', 'Erro ao salvar: ' + (e.message || JSON.stringify(e)));
    console.error('salvarCardapioPublico:', e);
  } finally {
    sbLoading(false);
  }
}
buildEmojiGrid();
initSidebarState();
requestNotifPermission();
loadAllData();
// Inicia scheduler automático de aniversário
setTimeout(_iniciarSchedulerAniversario, 3000);

// ════════════════════════════════════════════════════════
// TEMA — Modo Escuro (navy) e Modo Claro (sidebar navy)
// ════════════════════════════════════════════════════════

const MODO_ESCURO = {
  '--bg':'#0f1117','--surface':'#181b24','--surface2':'#1e2130','--surface3':'#242840',
  '--border':'rgba(255,255,255,.07)','--border2':'rgba(255,255,255,.13)',
  '--accent':'#3b82f6','--accent2':'#06b6d4','--accent3':'#f59e0b',
  '--accent-dim':'rgba(59,130,246,.18)','--accent-glow':'rgba(59,130,246,.35)',
  '--success':'#22c55e','--danger':'#ef4444','--purple':'#8b5cf6',
  '--pink':'#ec4899','--orange':'#f97316',
  '--text':'#f1f5f9','--muted':'#64748b','--muted2':'#94a3b8',
  '--sidebar-bg':'#131929','--topnav-bg':'#0d1117','--sfoot-bg':'rgba(8,10,18,.6)'
};

const MODO_CLARO = {
  '--bg':'#f4f8ff','--surface':'#ffffff','--surface2':'#e8f0fe','--surface3':'#d6e4ff',
  '--border':'rgba(30,100,220,.13)','--border2':'rgba(30,100,220,.22)',
  '--accent':'#1a6fd4','--accent2':'#2196f3','--accent3':'#f59e0b',
  '--accent-dim':'rgba(26,111,212,.12)','--accent-glow':'rgba(26,111,212,.3)',
  '--success':'#16a34a','--danger':'#dc2626','--purple':'#7c3aed',
  '--pink':'#db2777','--orange':'#ea580c',
  '--text':'#0a1929','--muted':'rgba(10,25,41,.45)','--muted2':'rgba(10,25,41,.65)',
  '--sidebar-bg':'#1a2744','--topnav-bg':'rgba(10,10,10,.92)','--sfoot-bg':'rgba(16,22,40,.8)'
};

// Compatibilidade com código legado
const TEMAS_PRONTOS = [
  { nome:'🌑 Modo Escuro', vars: MODO_ESCURO },
  { nome:'☀️ Modo Claro',  vars: MODO_CLARO  },
];

function _aplicarVars(vars) {
  const r = document.documentElement;
  Object.entries(vars).forEach(([k,v]) => r.style.setProperty(k, v));
}

function _aplicarOverrideClaro(vars) {
  const el = document.getElementById('tema-light-override');
  if (el) el.remove();
  const text = vars['--text'] || '#0a1929';
  const muted= vars['--muted']|| 'rgba(10,25,41,.45)';
  const sur  = vars['--surface']  || '#fff';
  const sur2 = vars['--surface2'] || '#e8f0fe';
  const sur3 = vars['--surface3'] || '#d6e4ff';
  const bord = vars['--border']   || 'rgba(30,100,220,.13)';
  const acc  = vars['--accent']   || '#1a6fd4';
  const style = document.createElement('style');
  style.id = 'tema-light-override';
  style.textContent = `
    body,.app{background:var(--bg)!important;color:${text}!important}
    .main,.page{background:var(--bg)!important;color:${text}!important}
    .topnav{background:var(--topnav-bg)!important;border-bottom:1px solid rgba(255,255,255,.06)!important;box-shadow:0 2px 16px rgba(0,0,0,.45)!important}
    .topnav *{color:#e2e8f0!important}
    .logo,.logo *{color:#fff!important}
    .tnav-pill{color:#cbd5e1!important;border-color:rgba(255,255,255,.18)!important;background:rgba(255,255,255,.08)!important}
    .tnav-pill:hover{color:#fff!important;background:rgba(255,255,255,.14)!important}
    .tnav-pill.on{background:rgba(34,197,94,.2)!important;border-color:rgba(34,197,94,.4)!important;color:#86efac!important}
    .ibtn{background:rgba(255,255,255,.08)!important;border-color:rgba(255,255,255,.15)!important;color:#cbd5e1!important}
    .ibtn:hover{color:#fff!important;background:rgba(255,255,255,.15)!important}
    .tbadge{background:rgba(255,255,255,.08)!important;border-color:rgba(255,255,255,.15)!important;color:#cbd5e1!important}
    .nbadge{background:var(--accent)!important;color:#fff!important}
    .caixa-btn.fechado{background:rgba(255,255,255,.1)!important;border-color:rgba(255,255,255,.2)!important;color:#e2e8f0!important}
    .mobile-menu-btn{background:rgba(255,255,255,.1)!important;border-color:rgba(255,255,255,.2)!important;color:#e2e8f0!important}
    .sidebar{background:var(--sidebar-bg)!important;border-right:1px solid rgba(255,255,255,.06)!important;box-shadow:4px 0 24px rgba(0,0,0,.5)!important}
    .sfoot{background:var(--sfoot-bg)!important;border-top-color:rgba(255,255,255,.08)!important}
    .si{color:#94a3b8!important;font-weight:500!important}
    .si svg{opacity:.75!important;color:#94a3b8!important}
    .si:hover{background:rgba(255,255,255,.08)!important;color:#e2e8f0!important}
    .si:hover svg{opacity:1!important;color:#e2e8f0!important}
    .si.on{background:rgba(59,130,246,.22)!important;color:#93c5fd!important;font-weight:600!important}
    .si.on svg{opacity:1!important;color:#93c5fd!important}
    .si.on::before{background:#3b82f6!important;box-shadow:0 0 8px rgba(59,130,246,.6)!important}
    .shead{color:rgba(255,255,255,.32)!important;border-color:rgba(255,255,255,.07)!important}
    .shead:hover{background:rgba(255,255,255,.05)!important}
    .sbc{background:#3b82f6!important;color:#fff!important}
    .ssub{color:rgba(255,255,255,.45)!important}
    .ssub:hover{color:#e2e8f0!important}
    .urow *{color:#94a3b8!important}
    .urow:hover *{color:#e2e8f0!important}
    .sb-pin{background:rgba(255,255,255,.08)!important;border-color:rgba(255,255,255,.15)!important;color:#94a3b8!important}
    .sidebar-search > div{background:rgba(255,255,255,.07)!important;border-color:rgba(255,255,255,.12)!important}
    .sidebar-search input{color:#e2e8f0!important}
    .sidebar-search input::placeholder{color:rgba(255,255,255,.28)!important}
    .pt,.ph .pt,.ph h1,.ph h2,.card-title,.iname{color:${text}!important;font-weight:700!important}
    .ps,.ph .ps,.icat,.sl,.str{color:${muted}!important}
    .sv{color:${text}!important;font-weight:700!important}
    .card,.sc,.sbox,.tw,.pm-tabs{background:${sur}!important;border-color:${bord}!important}
    .card *,.sc *{color:${text}!important}
    .kol{border-color:${bord}!important}
    .kol-analise{background:rgba(234,88,12,.07)!important;border-color:rgba(234,88,12,.22)!important}
    .kol-producao{background:rgba(245,158,11,.07)!important;border-color:rgba(245,158,11,.2)!important}
    .kol-pronto{background:rgba(34,197,94,.07)!important;border-color:rgba(34,197,94,.2)!important}
    .kol-head{background:transparent!important;border-bottom:1px solid ${bord}!important}
    .kol-analise .kol-title{color:#c2410c!important}
    .kol-producao .kol-title{color:#b45309!important}
    .kol-pronto .kol-title{color:#15803d!important}
    .kol-cnt{background:rgba(0,0,0,.1)!important;color:${text}!important}
    .kol-empty,.kol-empty *{color:${muted}!important;opacity:.7!important}
    .kol-config{background:rgba(0,0,0,.05)!important;border-color:${bord}!important;color:${muted}!important}
    .kol-config strong{color:${text}!important}
    .order-card{background:${sur}!important;border:1px solid ${bord}!important;color:${text}!important;box-shadow:0 2px 8px rgba(0,0,0,.08)!important;transition:all .2s ease!important}
    .order-card:hover{border-color:${acc}!important;transform:translateY(-2px)!important;box-shadow:0 6px 20px rgba(26,111,212,.15),0 0 0 3px rgba(26,111,212,.08)!important}
    .order-card *{color:${text}!important}
    .oc-id{color:${acc}!important;font-weight:700!important;font-size:13px!important}
    .oc-client{color:${text}!important;font-weight:600!important}
    .oc-items{color:${muted}!important}
    .oc-total{color:#15803d!important;font-weight:700!important}
    .oc-time,.oc-addr{color:${muted}!important}
    .oc-btn-ok{background:rgba(22,163,74,.12)!important;color:#15803d!important;border-color:rgba(22,163,74,.3)!important;font-weight:600!important}
    .oc-btn-ok:hover{background:rgba(22,163,74,.22)!important}
    .oc-btn-no{background:rgba(220,38,38,.08)!important;color:#b91c1c!important;border-color:rgba(220,38,38,.25)!important;font-weight:600!important}
    .oc-btn-no:hover{background:rgba(220,38,38,.16)!important}
    .oc-btn-fin{background:rgba(26,111,212,.1)!important;color:#1d4ed8!important;border-color:rgba(26,111,212,.25)!important;font-weight:600!important}
    .oc-btn-fin:hover{background:rgba(26,111,212,.18)!important}
    .kf-btn,.filter-btn{background:${sur2}!important;color:${muted}!important;border-color:${bord}!important}
    .kf-btn.on,.filter-btn.on{background:${acc}!important;color:#fff!important;border-color:${acc}!important}
    .pm-tab{color:${muted}!important}
    .pm-tab.on{background:${sur2}!important;color:${text}!important}
    .sbox{background:${sur}!important;border-color:${bord}!important}
    .sbox input{color:${text}!important}
    .sbox input::placeholder{color:${muted}!important}
    .sbox:focus-within{border-color:${acc}!important;box-shadow:0 0 0 3px rgba(26,111,212,.1)!important}
    input,textarea,select,.form-input{background:${sur}!important;color:${text}!important;border-color:${bord}!important}
    input::placeholder,textarea::placeholder{color:${muted}!important}
    .form-label{color:${muted}!important}
    .sw select{background:${sur}!important;color:${text}!important;border-color:${bord}!important}
    .btn.bg,.bg{background:${sur2}!important;color:${text}!important;border-color:${bord}!important}
    .btn.bg:hover{background:${sur3}!important}
    .tw table thead th{background:${sur2}!important;color:${muted}!important;border-color:${bord}!important}
    .tw table tbody tr:hover td{background:${sur2}!important}
    .tw table td{border-color:${bord}!important;color:${text}!important}
    .tmeta *{color:${text}!important}
    .modal{background:${sur}!important;color:${text}!important;border-color:${bord}!important;box-shadow:0 16px 48px rgba(0,0,0,.2)!important}
    .modal *{color:${text}!important}
    .modal-close{color:${muted}!important;background:${sur2}!important}
    .modal-bg{background:rgba(0,0,0,.4)!important}
    .toggle{background:${sur3}!important;border-color:${bord}!important}
    .toggle.on{background:var(--success)!important;border-color:var(--success)!important}
    .stbadge.sta{background:rgba(22,163,74,.1)!important;color:#15803d!important}
    .stbadge.ste{background:rgba(220,38,38,.1)!important;color:#b91c1c!important}
    .stbadge.stp{background:rgba(180,83,9,.1)!important;color:#92400e!important}
    .chip{background:${sur2}!important;color:${text}!important;border-color:${bord}!important}
    .cat-row{background:${sur}!important;border-color:${bord}!important}
    .cat-head *,.cat-name{color:${text}!important}
    .qpill{background:${sur2}!important;border-color:${bord}!important}
    .qpill-label{color:${muted}!important}
    .qpill-val{color:${text}!important}
    .pdvb-wrap,.pdvb-left{background:var(--bg)!important}
    .pdvb-right{border-left-color:${bord}!important;background:${sur}!important}
    .pdvb-toolbar,.pdvb-cats{border-bottom-color:${bord}!important;background:${sur}!important}
    .pdvb-grid-item{background:${sur}!important;border-color:${bord}!important;color:${text}!important}
    .pdvb-grid-item *{color:${text}!important}
    .pdvb-cat-btn{color:${muted}!important}
    .pdvb-cat-btn.on{color:${acc}!important;border-bottom-color:${acc}!important}
    .pdvb-order-item{border-bottom-color:${bord}!important;color:${text}!important}
    .pdvb-order-item *{color:${text}!important}
    .pdvb-bar-btn{background:${sur2}!important;color:${text}!important;border-color:${bord}!important}
    .pdvb-topbar{background:${sur}!important;border-bottom-color:${bord}!important;color:${text}!important}
    .pdvb-tab{color:${muted}!important}
    .pdvb-tab.on{color:${acc}!important;border-bottom-color:${acc}!important}
    .pdvb-bottom-bar{background:${sur}!important;border-top-color:${bord}!important}
    .pdvb-empty-order,.pdvb-empty-order *{color:${muted}!important}
    .pdvb-order-head{color:${muted}!important;background:${sur2}!important}
    .pdvb-tot-row{color:${text}!important}
    .pdvb-gerar-btn{background:${acc}!important;color:#fff!important}
    ::-webkit-scrollbar-thumb{background:${bord}!important}
  `;
  document.head.appendChild(style);
}

function temaAplicarModo(modo) {
  const vars = modo === 'claro' ? MODO_CLARO : MODO_ESCURO;
  _aplicarVars(vars);
  if (modo === 'claro') {
    _aplicarOverrideClaro(vars);
  } else {
    const el = document.getElementById('tema-light-override');
    if (el) el.remove();
  }
  sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, gestor_tema: modo }).then(()=>{}).catch(()=>{});
  temaUpdateCardSelection();
  sbToast('ok', modo === 'claro' ? '☀️ Modo claro ativado!' : '🌑 Modo escuro ativado!');
}

function temaUpdateCardSelection() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const modo = bg.startsWith('#f') ? 'claro' : 'escuro';
  const cardClaro  = document.getElementById('tema-card-claro');
  const cardEscuro = document.getElementById('tema-card-escuro');
  if (cardClaro)  { cardClaro.style.borderColor  = modo==='claro'  ? 'var(--accent)':'var(--border)'; cardClaro.style.boxShadow  = modo==='claro'  ? '0 0 0 3px var(--accent-glow)':'none'; }
  if (cardEscuro) { cardEscuro.style.borderColor = modo==='escuro' ? 'var(--accent)':'var(--border)'; cardEscuro.style.boxShadow = modo==='escuro' ? '0 0 0 3px var(--accent-glow)':'none'; }
}

function initTemaPage() { temaUpdateCardSelection(); }

// Stubs para não quebrar chamadas legadas
function temaApply(vars, save) { _aplicarVars(vars); }
function temaGetCurrent() { return {}; }
function temaSalvarStorage() {}
function temaCarregarStorage() {}
function temaReset() { temaAplicarModo('escuro'); }
async function temaSalvar() { sbToast('ok','🎨 Tema aplicado!'); }
function temaBuildPresets() {}
function temaBuildFields() {}
function temaUpdatePreview() {}
function temaUpdateInputs() {}
function temaBuildPreview() {}

// Aplica tema escuro imediatamente (antes do banco carregar)
(function(){
  try { ['ef_tema_modo','ef_tema_v2','tema','theme'].forEach(k=>localStorage.removeItem(k)); } catch(e){}
  _aplicarVars(MODO_ESCURO);
})();

// ── Registra webhook na Evolution API automaticamente ──
async function iaRegistrarWebhook(webhookUrl) {
  try {
    const { data: cfg } = await sb.from('store_config').select('evo_instance').single();
    const inst = cfg?.evo_instance;
    if (!inst) return; // instância ainda não criada, nada a fazer
    if (!webhookUrl) {
      const _slugRes4 = await fetch('/api/tenant-slug', { headers: { 'Content-Type': 'application/json', 'x-tenant-id': _sessao?.tenant_id || '' } }).catch(()=>null);
      const slug = (_slugRes4?.ok ? (await _slugRes4.json().catch(()=>({}))).slug : '') || _sessao?.tenant_id || '';
      webhookUrl = `${window.location.origin}/webhook/${slug}`;
    }
    // Chama o proxy /api/evo para setar o webhook na instância
    await EVO.req('POST', `/webhook/set/${inst}`, {
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        webhookBase64: false,
        events: ['MESSAGES_UPSERT']
      }
    });
  } catch(e) {
    console.warn('iaRegistrarWebhook:', e);
  }
}

// ════════════════════════════════════════════════════════
// ZERAR CONTAGEM DE PEDIDOS
// ════════════════════════════════════════════════════════
async function abrirModalZerarPedidos() {
  const input = document.getElementById('zerar-confirmar');
  if (input) input.value = '';
  const btn = document.getElementById('btn-confirmar-zerar');
  if (btn) { btn.disabled = true; btn.style.opacity = '.5'; btn.style.cursor = 'not-allowed'; }

  // Busca o último ID para mostrar ao gestor
  const contEl = document.getElementById('zerar-contagem');
  if (contEl) contEl.textContent = 'Verificando...';
  try {
    const { data } = await sb.from('orders').select('id').order('id', { ascending: false }).limit(1);
    const maxId = data?.[0]?.id || 0;
    const proxNum = maxId - _orderNumOffset + 1;
    if (contEl) contEl.innerHTML = maxId
      ? `O próximo pedido é <strong>#${proxNum}</strong>. Após zerar, passará a ser <strong>#1</strong>.`
      : '<span style="color:var(--muted)">Nenhum pedido registrado ainda.</span>';
  } catch(e) {
    if (contEl) contEl.textContent = 'Não foi possível verificar.';
  }

  openModal('modal-zerar-pedidos');
}

function _zerarValidar(input) {
  const ok = input.value.trim().toUpperCase() === 'ZERAR';
  const btn = document.getElementById('btn-confirmar-zerar');
  btn.disabled      = !ok;
  btn.style.opacity = ok ? '1' : '.5';
  btn.style.cursor  = ok ? 'pointer' : 'not-allowed';
}

async function confirmarZerarPedidos() {
  const input = document.getElementById('zerar-confirmar');
  if (input.value.trim().toUpperCase() !== 'ZERAR') return;
  const btn = document.getElementById('btn-confirmar-zerar');
  btn.disabled = true;
  btn.textContent = '⏳ Zerando...';

  try {
    // Pega o ID máximo atual do banco para usar como novo offset
    const { data } = await sb.from('orders').select('id').order('id', { ascending: false }).limit(1);
    const novoOffset = data?.[0]?.id || 0;

    // Salva o offset no store_config do tenant
    const { error } = await sb.from('store_config').update({ order_num_offset: novoOffset }).eq('tenant_id', _sessao.tenant_id);
    if (error) throw new Error(error.message);

    // Atualiza localmente
    _orderNumOffset = novoOffset;
    ordersKanban = ordersKanban.map(o => ({ ...o, num: _orderNum(o.id) }));
    renderKanban();

    closeModal('modal-zerar-pedidos');
    _renderConfiguracoes(); // atualiza o painel de config imediatamente
    sbToast('ok', '✅ Contagem de pedidos zerada! Próximo pedido será #1.');
  } catch(e) {
    sbToast('err', 'Erro ao zerar contagem: ' + (e.message || 'Tente novamente'));
    btn.disabled = false;
    btn.textContent = '🔄 Confirmar reset';
  }
}

// ── Configurações ─────────────────────────────────────
async function _renderConfiguracoes() {
  const el = document.getElementById('cfg-prox-pedido');
  if (!el) return;
  try {
    const { data } = await sb.from('orders').select('id').order('id', { ascending: false }).limit(1);
    const maxId  = data?.[0]?.id || 0;
    const proxNum = maxId - _orderNumOffset + 1;
    el.innerHTML = maxId
      ? `Próximo pedido: <strong>#${proxNum}</strong> &nbsp;·&nbsp; Offset atual: ${_orderNumOffset}`
      : 'Nenhum pedido registrado ainda.';
  } catch(e) { el.textContent = '—'; }
}

// ── Backup completo (dados + imagens) ────────────────
async function baixarBackupCompleto() {
  const btn  = document.getElementById('btn-backup-completo');
  const info = document.getElementById('cfg-backup-info');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Gerando backup...'; }
  if (info) info.textContent = 'Coletando dados e imagens...';

  try {
    const tid = _sessao?.tenant_id;
    if (!tid) throw new Error('Sessão inválida — faça login novamente.');

    const res = await fetch('/api/backup-completo-gestor', {
      headers: { 'x-tenant-id': tid }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Erro ${res.status}`);
    }

    // Determina nome do arquivo pelo header Content-Disposition
    const cd       = res.headers.get('Content-Disposition') || '';
    const match    = cd.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `backup-completo-${new Date().toISOString().slice(0,10)}.json.gz`;

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const kb = Math.round(blob.size / 1024);
    if (info) info.textContent = `✅ Backup gerado com sucesso! (${kb} KB)`;
    sbToast('ok', `💾 Backup completo baixado! (${kb} KB)`);
  } catch(e) {
    if (info) info.textContent = '❌ Erro: ' + e.message;
    sbToast('err', 'Erro ao gerar backup: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇️ Baixar backup completo'; }
  }
}

// ════════════════════════════════════════════════════════
// CARTEIRA & SAQUES
// ════════════════════════════════════════════════════════
const _fmtR = v => 'R$ ' + parseFloat(v||0).toFixed(2).replace('.',',');

let _saquesSSE = null;
let _pixAtivoGestor = true;

function conectarSaquesSSE() {
  if (_saquesSSE) return;
  const tid = _sessao?.tenant_id;
  if (!tid) return;
  _saquesSSE = new EventSource('/sse/saques-rt:'+tid);
  _saquesSSE.addEventListener('saques:INSERT', () => carregarCarteira());
  _saquesSSE.addEventListener('saques:UPDATE', (e) => {
    try {
      const d = JSON.parse(e.data);
      carregarCarteira();
      if (d.status === 'pago')      sbToast('ok', '✅ Seu saque foi pago! Verifique seu PIX.');
      else if (d.status === 'aprovado')  sbToast('ok', '✅ Saque aprovado! Pagamento em processamento.');
      else if (d.status === 'cancelado') sbToast('err', '❌ Saque cancelado. Entre em contato com o suporte.');
    } catch(ex) { carregarCarteira(); }
  });
  _saquesSSE.onerror = () => { _saquesSSE.close(); _saquesSSE = null; setTimeout(conectarSaquesSSE, 5000); };
}

async function carregarConfigPixGestor() {
  const tid = _sessao?.tenant_id;
  if (!tid) return;
  try {
    const r = await fetch('/api/pix/config', { headers: { 'x-tenant-id': tid } });
    if (!r.ok) return;
    const d = await r.json();
    _pixAtivoGestor = d.pix_ativo_gestor !== false;
    const btn = document.getElementById('btn-pix-toggle');
    const statusEl = document.getElementById('pix-config-status');
    const manualWrap = document.getElementById('pix-manual-wrap');
    if (btn) {
      btn.textContent = _pixAtivoGestor ? '✅ Ativado' : '❌ Desativado';
      btn.className = 'btn ' + (_pixAtivoGestor ? 'bp' : 'bd');
    }
    if (statusEl) {
      const taxaStr = 'Taxa por pagamento: <strong>R$ ' + parseFloat(d.taxa_pix||0).toFixed(2).replace('.',',') + '</strong>';
      if (!d.mp_configurado) statusEl.innerHTML = '<span style="color:var(--danger)">⚠️ Token MP não configurado pelo administrador</span>';
      else statusEl.innerHTML = (_pixAtivoGestor
        ? '<span style="color:var(--success)">✅ QR Code via Mercado Pago ativo</span>'
        : '<span style="color:var(--orange)">⚡ QR Code desativado — usando chave PIX manual</span>')
        + ' &nbsp;·&nbsp; <span style="color:var(--muted)">' + taxaStr + '</span>';
    }
    if (manualWrap) manualWrap.style.display = _pixAtivoGestor ? 'none' : '';
    // Preenche campos da chave manual
    if (!_pixAtivoGestor) {
      const keyEl = document.getElementById('pix-manual-key');
      const tipoEl = document.getElementById('pix-manual-tipo');
      const bancoEl = document.getElementById('pix-manual-banco');
      if (keyEl)  keyEl.value  = d.pix_key_manual || '';
      if (tipoEl && d.pix_key_manual_tipo) tipoEl.value = d.pix_key_manual_tipo;
      if (bancoEl) bancoEl.value = d.pix_key_manual_banco || '';
    }
  } catch(e) {}
}

async function togglePixGestor() {
  const tid = _sessao?.tenant_id;
  if (!tid) return;
  const btn = document.getElementById('btn-pix-toggle');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/pix/gestor-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ pix_ativo: !_pixAtivoGestor })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    _pixAtivoGestor = d.pix_ativo;
    sbToast('ok', _pixAtivoGestor ? '⚡ PIX QR Code ativado!' : '⚡ PIX QR Code desativado!');
    await carregarConfigPixGestor();
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
  finally { if (btn) btn.disabled = false; }
}

async function salvarPixManual() {
  const tid = _sessao?.tenant_id;
  if (!tid) return;
  const key   = document.getElementById('pix-manual-key')?.value.trim() || '';
  const tipo  = document.getElementById('pix-manual-tipo')?.value || 'telefone';
  const banco = document.getElementById('pix-manual-banco')?.value.trim() || '';
  if (!key) { sbToast('err', 'Informe a chave PIX'); return; }
  try {
    const r = await fetch('/api/pix/gestor-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ pix_key_manual: key, pix_key_manual_tipo: tipo, pix_key_manual_banco: banco })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    sbToast('ok', '✅ Chave PIX manual salva!');
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
}

async function carregarCarteira() {
  try {
    const tid = _sessao?.tenant_id;
    if (!tid) return;
    const [cartRes, saqRes] = await Promise.all([
      fetch('/api/carteira', { headers: { 'x-tenant-id': tid } }),
      fetch('/api/saques/meus', { headers: { 'x-tenant-id': tid } })
    ]);
    const cart = cartRes.ok ? await cartRes.json() : {};
    const saques = saqRes.ok ? await saqRes.json() : [];

    // Cards de saldo
    const se = id => document.getElementById(id);
    if(se('crt-saldo'))  se('crt-saldo').textContent  = _fmtR(cart.saldo_disponivel);
    if(se('crt-total'))  se('crt-total').textContent  = _fmtR(cart.total_recebido);
    if(se('crt-sacado')) se('crt-sacado').textContent = _fmtR(cart.total_sacado);
    if(se('crt-npag'))   se('crt-npag').textContent   = cart.total_pagamentos || 0;
    if(se('crt-taxas'))  se('crt-taxas').textContent  = _fmtR(cart.total_taxas);

    // Preview do valor de saque
    const saldo = parseFloat(cart.saldo_disponivel || 0);
    if(se('saque-valor-preview')) se('saque-valor-preview').textContent = _fmtR(saldo);

    // Verifica se tem saque pendente
    const temPendente = saques.some(s => s.status === 'pendente');
    if(se('saque-form-wrap'))       se('saque-form-wrap').style.display       = temPendente ? 'none' : '';
    if(se('saque-pendente-aviso'))  se('saque-pendente-aviso').style.display  = temPendente ? '' : 'none';
    if(se('btn-solicitar-saque'))   se('btn-solicitar-saque').disabled        = saldo < 1;

    // Histórico de saques
    _renderSaqueHistorico(saques);

    // Últimos pagamentos PIX
    _renderPixHistorico(cart.ultimos_pagamentos || []);
  } catch(e) {
    sbToast('err', 'Erro ao carregar carteira: ' + e.message);
  }
}

function _renderSaqueHistorico(saques) {
  const el = document.getElementById('saque-historico');
  if (!el) return;
  if (!saques.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px">Nenhum saque solicitado ainda.</div>'; return; }
  const badge = { pendente:'background:rgba(249,115,22,.15);color:var(--orange)', aprovado:'background:rgba(59,130,246,.15);color:var(--accent)', pago:'background:rgba(34,197,94,.15);color:var(--success)', cancelado:'background:rgba(239,68,68,.15);color:var(--danger)' };
  const label = { pendente:'⏳ Pendente', aprovado:'✅ Aprovado', pago:'✅ Pago', cancelado:'❌ Cancelado' };
  el.innerHTML = saques.map(s => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-weight:600;font-size:13px">${_fmtR(s.valor_liquido)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${s.pix_key_tipo?.toUpperCase()}: ${s.pix_key} · ${new Date(s.created_at).toLocaleDateString('pt-BR')}</div>
        ${s.obs_admin ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">📝 ${s.obs_admin}</div>` : ''}
      </div>
      <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;${badge[s.status]||badge.pendente}">${label[s.status]||s.status}</span>
    </div>`).join('');
}

function _renderPixHistorico(pagamentos) {
  const el = document.getElementById('pix-historico');
  if (!el) return;
  if (!pagamentos.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px">Nenhum pagamento PIX ainda.</div>'; return; }
  const badge = { aprovado:'background:rgba(34,197,94,.15);color:var(--success)', pendente:'background:rgba(249,115,22,.15);color:var(--orange)', rejeitado:'background:rgba(239,68,68,.15);color:var(--danger)', cancelado:'background:rgba(239,68,68,.15);color:var(--danger)' };
  el.innerHTML = pagamentos.map(p => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-weight:600;font-size:13px">${_fmtR(p.valor)} <span style="font-weight:400;color:var(--muted);font-size:12px">→ líquido ${_fmtR(p.valor_liquido)}</span></div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${p.payer_name||'—'} · Pedido #${_orderNum(p.order_id||0)} · ${new Date(p.created_at).toLocaleDateString('pt-BR')}</div>
      </div>
      <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;${badge[p.status]||badge.pendente}">${p.status}</span>
    </div>`).join('');
}

async function solicitarSaque() {
  const pixKey  = document.getElementById('saque-pix-key')?.value.trim();
  const pixTipo = document.getElementById('saque-pix-tipo')?.value || 'aleatoria';
  if (!pixKey) { sbToast('err', 'Informe a chave PIX'); return; }

  const btn = document.getElementById('btn-solicitar-saque');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Solicitando...'; }
  try {
    const tid = _sessao?.tenant_id;
    const res = await fetch('/api/saques/solicitar', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ pix_key: pixKey, pix_key_tipo: pixTipo })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');
    sbToast('ok', `✅ Saque de ${_fmtR(data.valor)} solicitado! Pagamento em até 24 horas úteis.`);
    await carregarCarteira();
  } catch(e) {
    sbToast('err', 'Erro: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '💸 Solicitar saque'; }
  }
}

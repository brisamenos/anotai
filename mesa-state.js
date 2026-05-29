// ══════════════════════════════════════════════════════════════════════════════
// mesa-state.js — Estado central das mesas (gestor)
//
// Fonte única de verdade para `tables` e `mesaOrdersCache`.
// Carregado ANTES de gestor-core.js para que os demais módulos já encontrem
// as funções disponíveis.
//
// API pública:
//   calcularTotalMesa(orders)   → number
//   refreshMesa(num)            → Promise<void>   (atualiza 1 mesa + seus pedidos)
//   refreshMesasState()         → Promise<void>   (atualiza todas as mesas + pedidos)
//   _patchOrderInCache(order)   → void            (atualização in-place sem re-fetch)
// ══════════════════════════════════════════════════════════════════════════════

// ── Estado global ────────────────────────────────────────────────────────────
// Declarados aqui e usados por todos os módulos gestor-*.js via acesso global.
// NÃO redeclare com `let` em outros arquivos.
var tables          = [];
var mesaOrdersCache = [];

const MESA_ORDER_STATUSES_ENCERRADOS = new Set(['cancelado', 'finalizado']);

// ── Helper local — parse seguro de items ─────────────────────────────────────
// Definido aqui (e não em gestor-core.js) porque mesa-state.js carrega primeiro.
function _pi(items) {
  if (Array.isArray(items)) return items;
  if (typeof items === 'string') { try { return JSON.parse(items); } catch { return []; } }
  return [];
}

function _mesaJsonArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function _mesaTimeMs(raw) {
  if (!raw) return 0;
  if (raw instanceof Date) return raw.getTime();
  let s = String(raw).trim();
  if (!s) return 0;
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : 0;
}

function _mesaSqlUtcDate(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function mesaOrderBelongsToSession(order, mesa) {
  if (!order || !mesa) return false;
  const status = String(order.status || '').toLowerCase();
  if (MESA_ORDER_STATUSES_ENCERRADOS.has(status)) return false;

  const sessionRef = String(order.session_ref ?? '').trim();
  if (sessionRef) {
    return !mesa.opened_at || sessionRef === String(mesa.opened_at);
  }

  if (!mesa.opened_at) return status !== 'entregue';
  const sessionStart = _mesaTimeMs(mesa.opened_at) - 5000;
  return _mesaTimeMs(order.created_at) >= sessionStart;
}

function mesaPagamentos(mesa) {
  return _mesaJsonArray(mesa?.pagamentos_json);
}

function mesaPagoTotal(mesa) {
  return mesaPagamentos(mesa).reduce((s, p) => s + (parseFloat(p?.valor) || 0), 0);
}

function mesaPagoPorCliente(mesa, clienteRef) {
  const key = String(clienteRef || '__mesa');
  return mesaPagamentos(mesa)
    .filter(p => String(p?.cliente_ref || '__mesa') === key)
    .reduce((s, p) => s + (parseFloat(p?.valor) || 0), 0);
}

function mesaRestante(total, mesa) {
  const bruto = parseFloat(total || 0) || 0;
  return Math.max(0, Math.round((bruto - mesaPagoTotal(mesa)) * 100) / 100);
}


// ── Cálculo de total ─────────────────────────────────────────────────────────
// Fonte canônica. gestor-financeiro.js e garcom.html delegam para cá.
// Regras:
//   • Pedido mesa_aberta com itens → recalcula item a item, excluindo cancelados
//   • Demais pedidos               → usa o.total gravado
//   • Taxa de entrega              → sempre somada via o.taxa
function calcularTotalMesa(orders) {
  let total = 0;
  (orders || []).forEach(o => {
    const items = _pi(o.items);
    // Para qualquer pedido de mesa ativo com itens, recalcula item a item
    if (['mesa_aberta','analise','producao','pronto'].includes(o.status) && items.length) {
      total += items
        .filter(i => (i.item_status || 'active') !== 'cancelado')
        .reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseInt(i.qty) || 1), 0);
    } else {
      total += parseFloat(o.total || 0);
    }
    total += parseFloat(o.taxa || 0);
  });
  return total;
}

// ── Atualização cirúrgica do cache (sem re-fetch) ────────────────────────────
// Substitui _updateMesaOrdersCache de gestor-core.js.
// Chamado pelos handlers Realtime para eventos de orders quando a mesa já está
// carregada e só precisamos reflectir o novo estado de UM pedido.
function _patchOrderInCache(order) {
  const idx = mesaOrdersCache.findIndex(o => o.id === order.id);

  if (MESA_ORDER_STATUSES_ENCERRADOS.has(String(order.status || '').toLowerCase())) {
    if (idx !== -1) mesaOrdersCache.splice(idx, 1);
    return;
  }

  const enriched = { ...order, items: _pi(order.items), num: _orderNum(order.id, order.order_num) };

  if (idx !== -1) {
    const existing = mesaOrdersCache[idx];
    mesaOrdersCache[idx] = { ...existing, ...enriched };
    // Garante que items nunca seja perdido: se o payload não trouxe items (array vazio),
    // preserva os do cache anterior.
    if (!mesaOrdersCache[idx].items?.length && existing.items?.length) {
      mesaOrdersCache[idx].items = existing.items;
    }
    return;
  }

  // Pedido novo: só adiciona se pertence à sessão corrente
  if (!order.mesa_num) return;
  const mesa = tables.find(t => t.num === parseInt(order.mesa_num));
  if (!mesa) return;

  if (mesa.opened_at) {
    const sessionStart = _mesaTimeMs(mesa.opened_at) - 5000;
    const orderTime = _mesaTimeMs(order.created_at || Date.now());
    if (orderTime >= sessionStart) mesaOrdersCache.unshift(enriched);
  } else if (order.status !== 'entregue') {
    mesaOrdersCache.unshift(enriched);
  }
}

// ── Helpers internos ─────────────────────────────────────────────────────────
function _normalizeMesa(t) {
  return {
    id: t.id, num: t.num, status: t.status,
    guests: t.guests || 0,
    total: parseFloat(t.total) || 0,
    taxa_servico: parseFloat(t.taxa_servico) || 0,
    pag_forma: t.pag_forma || null,
    clientes_json: _mesaJsonArray(t.clientes_json),
    pagamentos_json: _mesaJsonArray(t.pagamentos_json),
    opened_at: t.opened_at || null,
    updated_at: t.updated_at || null
  };
}

// Filtra os pedidos que pertencem à sessão actual de uma mesa
function _sessionFilter(orders, mesa) {
  if (!mesa) return [];
  return (orders || []).filter(o => mesaOrderBelongsToSession(o, mesa));
}

// ── refreshMesa(num) — atualiza UMA mesa e seus pedidos ──────────────────────
// Uso: handlers Realtime de UPDATE em `mesas`, ou após qualquer write numa mesa
// específica (fecharMesa, confirmarPagamento, etc.).
async function refreshMesa(num) {
  const numInt = parseInt(num);

  // 1. Busca o estado actualizado desta mesa
  const { data: mesaData } = await sb.from('mesas')
    .select('*')
    .eq('num', numInt)
    .single();

  if (mesaData) {
    const normalized = _normalizeMesa(mesaData);
    const idx = tables.findIndex(t => t.num === numInt);
    if (idx !== -1) tables[idx] = normalized;
    else tables.push(normalized);
  }

  const mesa = tables.find(t => t.num === numInt);
  if (!mesa) return; // mesa removida — sai sem tocar o cache
  if (mesa.status === 'free') {
    mesaOrdersCache = mesaOrdersCache.filter(o => parseInt(o.mesa_num) !== numInt);
    return;
  }

  // 2. Busca pedidos da mesa e filtra a sessão no cliente. O banco grava
  // created_at em UTC sem "Z"; comparar direto no SQL com ISO pode misturar sessões.
  const baseQuery = sb.from('orders')
    .select('*')
    .eq('mesa_num', numInt)
    .in('status', ['analise', 'producao', 'pronto', 'mesa_aberta', 'entregue'])
    .order('id', { ascending: true });

  const { data: orders } = await baseQuery;

  // 3. Substitui apenas as entradas desta mesa no cache
  mesaOrdersCache = [
    ...mesaOrdersCache.filter(o => parseInt(o.mesa_num) !== numInt),
    ...(orders || [])
      .filter(o => mesaOrderBelongsToSession(o, mesa))
      .map(o => ({ ...o, items: _pi(o.items), num: _orderNum(o.id, o.order_num) }))
  ];
}

// ── refreshMesasState() — atualiza TODAS as mesas e pedidos ─────────────────
// Uso: carga inicial, visibility change, reconnect Realtime, INSERT/DELETE em
// `mesas` (alta raridade), polling de segurança.
async function refreshMesasState() {
  // 1. Todas as mesas
  const { data: mesasData } = await sb.from('mesas').select('*').order('num');
  if (mesasData) {
    tables = mesasData.map(_normalizeMesa);
  }

  const activeTables = tables.filter(t => t.status !== 'free');
  if (!activeTables.length) {
    mesaOrdersCache = [];
    return;
  }

  // 2. Pedidos ativos de todas as mesas
  const { data: activeOrders } = await sb.from('orders')
    .select('*')
    .not('mesa_num', 'is', null)
    .in('status', ['analise', 'producao', 'pronto', 'mesa_aberta'])
    .order('id', { ascending: true });

  // 3. Pedidos entregues recentes (3h) — billing da sessão actual.
  // Janela reduzida para minimizar risco de pedidos de sessões anteriores vazarem.
  const { data: entregueOrders } = await sb.from('orders')
    .select('*')
    .not('mesa_num', 'is', null)
    .eq('status', 'entregue')
    .gte('created_at', _mesaSqlUtcDate(Date.now() - 3 * 60 * 60 * 1000))
    .order('id', { ascending: true });

  // 4. Monta cache: todos os pedidos ativos + entregues recentes de mesas não-livres.
  // Regra simples: se a mesa existe e não está free, o pedido entra no cache.
  // opened_at é usado apenas como filtro de sessão quando disponível.
  const allOrders = [...(activeOrders || []), ...(entregueOrders || [])];
  const seen = new Set();
  mesaOrdersCache = allOrders
    .filter(o => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      const mesa = activeTables.find(t => t.num === parseInt(o.mesa_num));
      if (!mesa) return false;
      return mesaOrderBelongsToSession(o, mesa);
    })
    .map(o => ({ ...o, items: _pi(o.items), num: _orderNum(o.id, o.order_num) }));
}

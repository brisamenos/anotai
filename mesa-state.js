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

// ── Cálculo de total ─────────────────────────────────────────────────────────
// Fonte canônica. gestor-financeiro.js e garcom.html delegam para cá.
// Regras:
//   • Pedido mesa_aberta com itens → recalcula item a item, excluindo cancelados
//   • Demais pedidos               → usa o.total gravado
//   • Taxa de entrega              → sempre somada via o.taxa
function calcularTotalMesa(orders) {
  let total = 0;
  (orders || []).forEach(o => {
    const items = Array.isArray(o.items) ? o.items : [];
    if (o.status === 'mesa_aberta' && items.length) {
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

  if (order.status === 'cancelado') {
    if (idx !== -1) mesaOrdersCache.splice(idx, 1);
    return;
  }

  const enriched = { ...order, num: _orderNum(order.id, order.order_num) };

  if (idx !== -1) {
    // Mantém no cache mesmo após entregue — necessário para resumo de consumo
    // e cálculo do total quando a mesa passa a waiting.
    // MERGE: o payload SSE pode não conter todas as colunas (ex: items).
    // Preserva os campos existentes no cache e só sobrescreve o que veio no SSE.
    const existing = mesaOrdersCache[idx];
    mesaOrdersCache[idx] = { ...existing, ...enriched };
    // Garante que items nunca seja perdido: se o SSE não enviou items,
    // mantém o array do cache anterior.
    if (!Array.isArray(mesaOrdersCache[idx].items) && Array.isArray(existing.items)) {
      mesaOrdersCache[idx].items = existing.items;
    }
    return;
  }

  // Pedido novo: só adiciona se pertence à sessão corrente
  if (!order.mesa_num) return;
  const mesa = tables.find(t => t.num === parseInt(order.mesa_num));
  if (!mesa) return;

  const orderTime = new Date(order.created_at || Date.now()).getTime();
  if (mesa.opened_at) {
    const sessionStart = new Date(mesa.opened_at).getTime() - 5000;
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
    pag_forma: t.pag_forma || null,
    opened_at: t.opened_at || null,
    updated_at: t.updated_at || null
  };
}

// Filtra os pedidos que pertencem à sessão actual de uma mesa
function _sessionFilter(orders, mesa) {
  if (!mesa) return [];
  if (!mesa.opened_at) return orders.filter(o => o.status !== 'entregue');
  const sessionStart = new Date(mesa.opened_at).getTime() - 5000;
  return orders.filter(o => new Date(o.created_at || 0).getTime() >= sessionStart);
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

  // 2. Busca pedidos desta sessão (ativos + entregues recentes)
  const sessionStart = mesa.opened_at
    ? new Date(new Date(mesa.opened_at).getTime() - 5000).toISOString()
    : null;

  const baseQuery = sb.from('orders')
    .select('*')
    .eq('mesa_num', numInt)
    .neq('status', 'cancelado')
    .order('id', { ascending: true });

  const { data: orders } = await (sessionStart
    ? baseQuery.gte('created_at', sessionStart)
    : baseQuery.not('status', 'eq', 'entregue'));

  // 3. Substitui apenas as entradas desta mesa no cache
  mesaOrdersCache = [
    ...mesaOrdersCache.filter(o => parseInt(o.mesa_num) !== numInt),
    ...(orders || []).map(o => ({ ...o, num: _orderNum(o.id, o.order_num) }))
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
    .gte('created_at', new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())
    .order('id', { ascending: true });

  // 4. Filtra por sessão — só inclui pedidos da sessão ACTUAL (opened_at).
  // Impede que histórico de sessões anteriores apareça numa nova abertura.
  const allOrders = [...(activeOrders || []), ...(entregueOrders || [])];
  mesaOrdersCache = allOrders
    .filter(o => {
      const mesa = activeTables.find(t => t.num === parseInt(o.mesa_num));
      if (!mesa) return false;
      if (!mesa.opened_at) return o.status !== 'entregue';
      const sessionStart = new Date(mesa.opened_at).getTime() - 5000;
      return new Date(o.created_at || 0).getTime() >= sessionStart;
    })
    .map(o => ({ ...o, num: _orderNum(o.id, o.order_num) }));
}

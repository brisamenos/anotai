// ═══════════════════════════════════════════════════════
// lib/sse.js — Server-Sent Events com emit inteligente
// Só envia para os canais que realmente ouvem cada tabela
// ═══════════════════════════════════════════════════════
'use strict'

// Mapa: channel → Set<Response>
const sseClients = new Map()

// ── Registra cliente SSE ──────────────────────────────
function sseSubscribe(channel, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',            // desliga buffer do nginx/Easypanel
    'Access-Control-Allow-Origin': '*',
  })
  res.write(': connected\n\n')

  if (!sseClients.has(channel)) sseClients.set(channel, new Set())
  const set = sseClients.get(channel)
  set.add(res)

  // Keepalive a cada 25s para manter conexão viva em proxies
  const ka = setInterval(() => {
    try { res.write(': ping\n\n') }
    catch { clearInterval(ka) }
  }, 25000)

  res.on('close', () => {
    clearInterval(ka)
    set.delete(res)
    if (set.size === 0) sseClients.delete(channel)
  })
}

// ── Broadcast para um canal ───────────────────────────
function sseBroadcast(channel, event, data) {
  const clients = sseClients.get(channel)
  if (!clients?.size) return
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const r of clients) {
    try { r.write(msg) } catch { clients.delete(r) }
  }
}

// ── Mapeamento tabela → canais interessados ───────────
// Evita percorrer TODOS os canais em cada escrita
const TABLE_CHANNELS = {
  orders:       (tid) => [`orders-rt:${tid}`],
  mesas:        (tid) => [`mesas-rt:${tid}`],
  store_config: (tid) => [`store-config-rt:${tid}`],
  menu_items:   (tid) => [`menu-rt:${tid}`],
  categories:   (tid) => [`cats-rt:${tid}`, `menu-rt:${tid}`],
  garcons:      (tid) => [`garcom-mesas-${tid}`, `orders-rt:${tid}`],
}

// Canais dinâmicos do garçom (têm prefixo, não nome exato)
const GARCOM_PREFIXES = ['garcom-mesas-', 'garcom-orders-']

function emit(tenantId, table, record, type) {
  const tid = tenantId || record?.tenant_id
  if (!tid || tid === 'global') return

  const event = `${table}:${type}`

  // Canais estáticos do tenant
  const staticChannels = TABLE_CHANNELS[table]?.(tid) || []
  for (const ch of staticChannels) sseBroadcast(ch, event, record)

  // Canais dinâmicos do garçom (só para orders e mesas)
  if (table === 'orders' || table === 'mesas') {
    for (const [ch] of sseClients) {
      if (ch.endsWith(`:${tid}`)) {
        for (const prefix of GARCOM_PREFIXES) {
          if (ch.startsWith(prefix)) { sseBroadcast(ch, event, record); break }
        }
      }
    }
  }
}

module.exports = { sseSubscribe, sseBroadcast, emit, sseClients }

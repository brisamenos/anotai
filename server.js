// ═══════════════════════════════════════════════════════
// ESTIMA FOOD — WhatsApp Automation Server
// Node.js 18+ | Roda no Easypanel
// ═══════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js')

// ── Configurações ────────────────────────────────────────
const SUPA_URL    = process.env.SUPABASE_URL    || 'https://lhrzwccbvdintqgebisq.supabase.co'
const SUPA_KEY    = process.env.SUPABASE_KEY    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxocnp3Y2NidmRpbnRxZ2ViaXNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1ODY0NzEsImV4cCI6MjA4OTE2MjQ3MX0.gbljgt0rzOf9eBoTcXxxfl0e_0Y-6XYxve-HGY7meJo'
const EVO_URL     = process.env.EVOLUTION_URL   || 'https://projeto-evolution-api.xtknqq.easypanel.host'
const EVO_KEY     = process.env.EVOLUTION_KEY   || '429683C4C977415CAAFCCE10F7D57E11'
const EVO_INST    = process.env.EVOLUTION_INST  || 'estima-food'
const PORT        = process.env.PORT            || 3001

const sb = createClient(SUPA_URL, SUPA_KEY)

// ── Log colorido ─────────────────────────────────────────
const log = (emoji, msg, data = '') => {
  const time = new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })
  console.log(`[${time}] ${emoji}  ${msg}`, data ? JSON.stringify(data) : '')
}

// ── Envio via Evolution API ──────────────────────────────
async function sendWhatsApp(phone, text) {
  const num = phone.replace(/\D/g, '')
  const number = num.startsWith('55') ? num : `55${num}`
  try {
    const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INST}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVO_KEY },
      body: JSON.stringify({ number, text })
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      log('📤', `Enviado para ${number}`)
      return { ok: true, data }
    } else {
      log('❌', `Falhou para ${number}:`, data)
      return { ok: false, data }
    }
  } catch (e) {
    log('❌', `Erro ao enviar para ${number}:`, { error: e.message })
    return { ok: false, error: e.message }
  }
}

// ── Substituição de variáveis ────────────────────────────
function preencherVars(template, vars) {
  let txt = template
  Object.entries(vars).forEach(([k, v]) => {
    txt = txt.replaceAll(`{${k}}`, v ?? '')
  })
  return txt
}

// ── Busca config de automações do Supabase ───────────────
async function getAutomacoes() {
  const { data } = await sb
    .from('store_config')
    .select('evo_automacoes, evo_aniv_last')
    .eq('id', 1)
    .single()
  return data || {}
}

// ═══════════════════════════════════════════════════════
// 1. SCHEDULER DE ANIVERSÁRIOS (verifica a cada minuto)
// ═══════════════════════════════════════════════════════
let _anivLastChecked = null // cache para não bater no banco a cada minuto

async function checarAniversarios() {
  try {
    const cfg = await getAutomacoes()
    const auto = cfg.evo_automacoes || {}
    const config_aniv = auto['aniversario'] || {}

    if (!config_aniv.on) return

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Fortaleza' }))
    const todayMD = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const horaAgora = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const horaCfg = auto._aniv_hora || '09:00'

    // Já enviou hoje? (verifica cache e banco)
    if (_anivLastChecked === todayMD) return
    if (cfg.evo_aniv_last === todayMD) { _anivLastChecked = todayMD; return }

    // Ainda não chegou na hora
    if (horaAgora < horaCfg) return

    log('🎂', `Hora de enviar aniversários! (${todayMD} às ${horaAgora})`)
    _anivLastChecked = todayMD // marca logo para não duplicar

    // Busca aniversariantes do dia
    const { data: clientes } = await sb
      .from('fidelidade')
      .select('id, name, phone, birthday')
      .not('birthday', 'is', null)
      .not('phone', 'is', null)

    const anivs = (clientes || []).filter(c =>
      c.birthday && c.phone && c.birthday.slice(5) === todayMD
    )

    if (!anivs.length) {
      log('🎂', `Nenhum aniversariante hoje (${todayMD})`)
      await sb.from('store_config').upsert({ id: 1, evo_aniv_last: todayMD })
      return
    }

    log('🎂', `${anivs.length} aniversariante(s) hoje:`, anivs.map(c => c.name))

    let ok = 0, fail = 0
    for (const c of anivs) {
      const texto = preencherVars(config_aniv.msg, { nome: c.name })
      const r = await sendWhatsApp(c.phone, texto)
      r.ok ? ok++ : fail++
      await sleep(1500)
    }

    await sb.from('store_config').upsert({ id: 1, evo_aniv_last: todayMD })
    log('🎂', `Aniversários: ${ok} enviados, ${fail} falhou`)

  } catch (e) {
    log('❌', 'Erro no scheduler de aniversários:', { error: e.message })
  }
}

// ═══════════════════════════════════════════════════════
// 2. POLLING DE PEDIDOS (verifica mudanças de status)
// ═══════════════════════════════════════════════════════
const pedidosProcessados = new Set() // guarda {id}_{status} já enviados

async function checarPedidos() {
  try {
    const cfg = await getAutomacoes()
    const auto = cfg.evo_automacoes || {}

    // Busca pedidos recentes com telefone (últimas 24h)
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: pedidos } = await sb
      .from('orders')
      .select('id, client, phone, items, total, taxa, addr, status, mesa_num, created_at')
      .not('phone', 'is', null)
      .gte('created_at', desde)
      .in('status', ['producao', 'pronto', 'cancelado', 'finalizado'])
      .order('id', { ascending: false })

    if (!pedidos?.length) return

    for (const o of pedidos) {
      const chave = `${o.id}_${o.status}`
      if (pedidosProcessados.has(chave)) continue
      pedidosProcessados.add(chave)

      const tipo = {
        producao:   'confirmado',
        pronto:     'pronto',
        cancelado:  'cancelado',
        finalizado: 'avaliacao'
      }[o.status]

      if (!tipo) continue

      const config_tipo = auto[tipo] || {}
      if (!config_tipo.on) continue

      const itens = Array.isArray(o.items) ? o.items.map(i => `${i.qty}x ${i.name}`).join(', ') : ''
      const addr  = o.addr || ''
      const vars  = {
        nome:         o.client   || 'Cliente',
        id:           String(o.id),
        itens,
        total:        (parseFloat(o.total) || 0).toFixed(2).replace('.', ','),
        endereco:     addr,
        tipo_entrega: addr.includes('Mesa')   ? '🪑 Será servido na mesa'
                    : addr.includes('alcão')  ? '🏪 Pronto para retirada no balcão'
                    :                           '🛵 Saindo para entrega',
        mesa:         String(o.mesa_num || ''),
      }

      const texto = preencherVars(config_tipo.msg, vars)
      log('📦', `Pedido #${o.id} → ${o.status} → ${tipo} → ${o.phone}`)
      await sendWhatsApp(o.phone, texto)
      await sleep(800)

      // Se finalizado, envia pontos de fidelidade
      if (o.status === 'finalizado') {
        const config_pontos = auto['pontos'] || {}
        if (config_pontos.on && o.phone) {
          await sleep(5000)
          const { data: fid } = await sb
            .from('fidelidade')
            .select('pts, max_pts, name')
            .or(`phone.eq.${o.phone},name.eq.${o.client}`)
            .single()

          if (fid) {
            const pontos_ganhos = Math.floor((parseFloat(o.total) || 0) * 10)
            const pontos_total  = (fid.pts || 0) + pontos_ganhos
            const pontos_faltam = Math.max(0, (fid.max_pts || 500) - pontos_total)
            const txtPontos = preencherVars(config_pontos.msg, {
              nome: fid.name || o.client,
              pontos_ganhos: String(pontos_ganhos),
              pontos_total:  String(pontos_total),
              pontos_faltam: String(pontos_faltam),
            })
            log('🏆', `Enviando pontos para ${o.phone}`)
            await sendWhatsApp(o.phone, txtPontos)
          }
        }
      }
    }

    // Limpa cache antigo (mantém só últimos 1000)
    if (pedidosProcessados.size > 1000) {
      const arr = [...pedidosProcessados]
      arr.slice(0, 500).forEach(k => pedidosProcessados.delete(k))
    }

  } catch (e) {
    log('❌', 'Erro no checker de pedidos:', { error: e.message })
  }
}

// ═══════════════════════════════════════════════════════
// 3. HTTP SERVER (recebe chamadas do gestor)
// ═══════════════════════════════════════════════════════
const http = require('http')

const server = http.createServer(async (req, res) => {
  // CORS para o gestor
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return }

  const url = new URL(req.url, `http://localhost:${PORT}`)

  // GET /status — verifica se servidor está rodando
  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200)
    res.end(JSON.stringify({ ok: true, uptime: process.uptime(), version: '1.0.0' }))
    return
  }

  // POST /enviar — envia mensagem avulsa
  if (req.method === 'POST' && url.pathname === '/enviar') {
    const body = await readBody(req)
    const { phone, text } = JSON.parse(body)
    if (!phone || !text) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'phone e text obrigatórios' })); return }
    const r = await sendWhatsApp(phone, text)
    res.writeHead(r.ok ? 200 : 500)
    res.end(JSON.stringify(r))
    return
  }

  // POST /promocao — envio em massa
  if (req.method === 'POST' && url.pathname === '/promocao') {
    const body = await readBody(req)
    const { destino = 'todos', msg } = JSON.parse(body)
    if (!msg) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'msg obrigatório' })); return }

    let query = sb.from('fidelidade').select('id, name, phone, orders_count').not('phone', 'is', null)
    if (destino === 'com_pedido') query = query.gt('orders_count', 0)
    const { data: clientes } = await query

    if (!clientes?.length) { res.writeHead(200); res.end(JSON.stringify({ ok: true, enviados: 0, msg: 'Nenhum cliente' })); return }

    // Responde imediatamente e processa em background
    res.writeHead(200)
    res.end(JSON.stringify({ ok: true, total: clientes.length, msg: 'Envio iniciado em background' }))

    // Envia em background
    ;(async () => {
      log('📢', `Enviando promoção para ${clientes.length} clientes...`)
      let ok = 0, fail = 0
      for (const c of clientes) {
        const texto = preencherVars(msg, { nome: c.name })
        const r = await sendWhatsApp(c.phone, texto)
        r.ok ? ok++ : fail++
        await sleep(1500)
      }
      log('📢', `Promoção: ${ok} enviados, ${fail} falhou`)
    })()

    return
  }

  // POST /aniversario — disparo manual de aniversários
  if (req.method === 'POST' && url.pathname === '/aniversario') {
    _anivLastChecked = null // force recheck
    checarAniversarios()
    res.writeHead(200)
    res.end(JSON.stringify({ ok: true, msg: 'Verificação de aniversários iniciada' }))
    return
  }

  res.writeHead(404)
  res.end(JSON.stringify({ ok: false, error: 'Rota não encontrada' }))
})

// ── Helpers ──────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

// ═══════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════
server.listen(PORT, () => {
  log('🚀', `Servidor rodando na porta ${PORT}`)
  log('🔗', `Supabase: ${SUPA_URL}`)
  log('📱', `Evolution API: ${EVO_URL} | Instância: ${EVO_INST}`)
})

// Verifica aniversários a cada 60 segundos
setInterval(checarAniversarios, 60 * 1000)
log('🎂', 'Scheduler de aniversários ativo (verifica a cada 60s)')

// Verifica mudanças de pedidos a cada 15 segundos
setInterval(checarPedidos, 15 * 1000)
log('📦', 'Checker de pedidos ativo (verifica a cada 15s)')

// Roda imediatamente ao iniciar
setTimeout(checarAniversarios, 3000)
setTimeout(checarPedidos, 5000)

// Graceful shutdown
process.on('SIGTERM', () => { log('🛑', 'Servidor encerrado'); server.close(); process.exit(0) })
process.on('SIGINT',  () => { log('🛑', 'Servidor encerrado'); server.close(); process.exit(0) })

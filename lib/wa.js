// ═══════════════════════════════════════════════════════
// lib/wa.js — WhatsApp (Evolution API) + Automações
// ═══════════════════════════════════════════════════════
'use strict'

const { db, log, jsonParse } = require('./db')
const { emit }               = require('./sse')
const { parseRow }           = require('./rest')

const EVO_URL  = process.env.EVOLUTION_URL  || 'https://projeto-evolution-api.xtknqq.easypanel.host'
const EVO_KEY  = process.env.EVOLUTION_KEY  || '429683C4C977415CAAFCCE10F7D57E11'
const EVO_INST = process.env.EVOLUTION_INST || 'estima-food'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function fillVars(tpl, vars) {
  let t = tpl
  for (const [k, v] of Object.entries(vars)) t = t.replaceAll(`{${k}}`, v ?? '')
  return t
}

// ── Enviar WA ─────────────────────────────────────────
async function sendWA(phone, text, inst) {
  const instance = inst || EVO_INST
  const num      = phone.replace(/\D/g, '')
  const number   = num.startsWith('55') ? num : `55${num}`
  const headers  = { 'Content-Type': 'application/json', apikey: EVO_KEY }
  const body     = { number, text, options: { delay: 1000, presence: 'composing' } }

  try {
    const r = await fetch(`${EVO_URL}/message/sendText/${instance}`, {
      method: 'POST', headers, body: JSON.stringify(body)
    })
    const data = await r.json().catch(() => ({}))
    log('📬', `sendWA [${r.status}]:`, JSON.stringify(data).slice(0, 200))
    if (r.ok) { log('📤', `Enviado para ${number}`); return { ok: true, data } }

    // Retry sem options
    const r2   = await fetch(`${EVO_URL}/message/sendText/${instance}`, {
      method: 'POST', headers, body: JSON.stringify({ number, text })
    })
    const data2 = await r2.json().catch(() => ({}))
    if (r2.ok) { log('📤', `Enviado para ${number} (retry)`); return { ok: true, data: data2 } }
    return { ok: false, data: data2 }
  } catch(e) {
    log('❌', 'Erro WA:', { error: e.message })
    return { ok: false, error: e.message }
  }
}

// ── Aniversariantes ───────────────────────────────────
const _anivLast = new Map()

async function checarAniv() {
  const tenants = db.prepare("SELECT id FROM tenants WHERE ativo=1").all()
  for (const t of tenants) {
    try {
      const cfg  = db.prepare("SELECT evo_automacoes,evo_aniv_last,evo_instance FROM store_config WHERE tenant_id=?").get(t.id)
      if (!cfg) continue
      const auto = jsonParse(cfg.evo_automacoes) || {}
      const ca   = auto['aniversario'] || {}
      if (ca.on === false) continue
      const now   = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Fortaleza' }))
      const today = `${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
      const hora  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
      if (_anivLast.get(t.id) === today || cfg.evo_aniv_last === today) continue
      if (hora < (auto._aniv_hora || '09:00')) continue
      _anivLast.set(t.id, today)

      const deF = db.prepare("SELECT name,phone FROM fidelidade WHERE tenant_id=? AND birthday IS NOT NULL AND phone IS NOT NULL").all(t.id).filter(c => c.birthday?.slice(5) === today)
      const deC = db.prepare("SELECT name,phone FROM customers WHERE tenant_id=? AND birthday IS NOT NULL AND phone IS NOT NULL").all(t.id).filter(c => c.birthday?.slice(5) === today)
      const seen = new Set(deF.map(c => c.phone))
      const anivs = [...deF, ...deC.filter(c => !seen.has(c.phone))]

      if (!anivs.length) { db.prepare("UPDATE store_config SET evo_aniv_last=? WHERE tenant_id=?").run(today, t.id); continue }
      const inst = cfg.evo_instance || EVO_INST
      for (const c of anivs) { await sendWA(c.phone, fillVars(ca.msg, { nome: c.name }), inst); await sleep(1500) }
      db.prepare("UPDATE store_config SET evo_aniv_last=? WHERE tenant_id=?").run(today, t.id)
      log('🎂', `Aniversários tenant ${t.id}: ${anivs.length} enviados`)
    } catch(e) { log('❌', `Erro aniv ${t.id}:`, { error: e.message }) }
  }
}

// ── order-status: atualiza + emite SSE + envia WA ─────
const processed = new Set()

async function handleOrderStatus(req, res, sendFn) {
  const body = await readBody(req)
  const { order_id, new_status } = body
  const tid = body.tenant_id || req.headers['x-tenant-id']
  if (!order_id || !new_status || !tid) return sendFn(res, 400, { ok: false, error: 'order_id, new_status e tenant_id obrigatórios' })

  try {
    const order = db.prepare("SELECT * FROM orders WHERE id=? AND tenant_id=?").get(order_id, tid)
    if (!order) return sendFn(res, 404, { ok: false, error: 'Pedido não encontrado' })
    const oldStatus = order.status
    db.prepare("UPDATE orders SET status=? WHERE id=?").run(new_status, order_id)
    const updated = db.prepare("SELECT * FROM orders WHERE id=?").get(order_id)
    emit(tid, 'orders', parseRow('orders', updated), 'UPDATE')
    sendFn(res, 200, { ok: true, order: parseRow('orders', updated) })

    // WA assíncrono — não bloqueia a resposta
    if (order.phone && oldStatus !== new_status) {
      setImmediate(async () => {
        try {
          const cfg  = db.prepare("SELECT evo_instance,evo_automacoes,store_name FROM store_config WHERE tenant_id=?").get(tid)
          const inst = cfg?.evo_instance || EVO_INST
          const auto = jsonParse(cfg?.evo_automacoes) || {}
          const nome  = order.client || 'Cliente'
          const idStr = String(order.id).padStart(3, '0')
          const items = (() => { try { return (JSON.parse(order.items)||[]).map(i=>`${i.qty}x ${i.name}`).join(', ') } catch { return '' } })()
          const isDelivery = (order.addr||'').includes('Mesa') ? '🪑 Mesa' : (order.addr||'').toLowerCase().includes('balc') ? '🏪 Balcão' : '🛵 Entrega'
          const total = (parseFloat(order.total||0) + parseFloat(order.taxa||0)).toFixed(2).replace('.', ',')
          const vars  = { nome, id: idStr, itens: items, total, endereco: order.addr||'', mesa: String(order.mesa_num||''), tipo_entrega: isDelivery }

          const tipoAuto = { analise:'recebido', producao:'confirmado', pronto:'pronto', saiu:'entrega', entregue:'entrega', cancelado:'cancelado', finalizado:'avaliacao' }[new_status]
          const ct = tipoAuto ? (auto[tipoAuto] || {}) : {}

          const msgPadrao = {
            analise:   `📥 Olá, *${nome}*! Recebemos seu pedido *#${idStr}* com sucesso! 🎉\n\n🛒 ${items}\n💰 Total: R$${total}\n\nEm breve confirmaremos. Aguarde! ⏱️`,
            producao:  `👨‍🍳 *#${idStr}* confirmado!\n\nOlá *${nome}*, seu pedido está sendo preparado agora. Aguarde! 😊`,
            pronto:    `✅ *#${idStr}* pronto!\n\n*${nome}*, seu pedido está pronto! ${isDelivery==='🛵 Entrega'?'Em instantes sairá para entrega.':isDelivery==='🪑 Mesa'?'Já pode chamar o garçom.':'Pode retirar no balcão.'}`,
            saiu:      `🛵 *#${idStr}* a caminho!\n\n*${nome}*, seu pedido saiu para entrega! Chegará em breve. 🎉`,
            entregue:  `🎉 Entregue!\n\n*${nome}*, seu pedido *#${idStr}* foi entregue. Bom apetite! ⭐`,
            cancelado: `😔 *#${idStr}* cancelado.\n\n*${nome}*, seu pedido foi cancelado. Entre em contato para mais informações.`,
            finalizado:`🎉 *${nome}*, obrigado pelo pedido *#${idStr}*! Bom apetite! ⭐`,
          }

          let msgFinal = null
          if (ct.on === false) {
            log('⏭️', `Automação "${tipoAuto}" desligada para #${idStr}`)
          } else if (ct.on && ct.msg) {
            msgFinal = fillVars(ct.msg, vars)
          } else {
            msgFinal = msgPadrao[new_status] || null
          }

          if (msgFinal) {
            if (new_status === 'finalizado') {
              const minutos = Math.max(1, parseInt(auto._aval_minutos || 1, 10) || 1)
              log('⏳', `Avaliação agendada em ${minutos}min para #${idStr}`)
              setTimeout(async () => {
                const cfgNow  = db.prepare("SELECT evo_automacoes FROM store_config WHERE tenant_id=?").get(tid)
                const autoNow = jsonParse(cfgNow?.evo_automacoes) || {}
                if (autoNow['avaliacao']?.on === false) return
                const r = await sendWA(order.phone, msgFinal, inst)
                log(r.ok ? '📲' : '❌', `Avaliação +${minutos}min → #${idStr}`)
                if (r.ok) processed.add(`${order.id}_${new_status}`)
              }, minutos * 60 * 1000)
            } else {
              const r = await sendWA(order.phone, msgFinal, inst)
              log(r.ok ? '📲' : '❌', `Auto "${tipoAuto}" → #${idStr}`)
              if (r.ok) processed.add(`${order.id}_${new_status}`)
            }
          }
        } catch(e) { log('❌', `Erro WA order-status #${order_id}:`, { error: e.message }) }
      })
    }
  } catch(e) {
    log('❌', 'Erro order-status:', { error: e.message })
    sendFn(res, 500, { ok: false, error: e.message })
  }
}

function readBody(req) {
  return new Promise((ok, err) => {
    let b = ''
    req.on('data', c => b += c)
    req.on('end', () => { try { ok(b ? JSON.parse(b) : {}) } catch { ok({}) } })
    req.on('error', err)
  })
}

module.exports = { sendWA, fillVars, sleep, checarAniv, handleOrderStatus, processed, EVO_URL, EVO_KEY, EVO_INST }

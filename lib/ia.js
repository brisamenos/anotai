// ═══════════════════════════════════════════════════════
// lib/ia.js — Agente IA via OpenAI + WhatsApp webhook
// ═══════════════════════════════════════════════════════
'use strict'

const { db, log, jsonParse } = require('./db')
const { sendWA, sleep }      = require('./wa')

// Buffer de mensagens por cliente e pausa-humano
const _msgBuffer   = new Map()  // bufKey → { msgs, timer }
const _pausaHumano = new Map()  // pausaKey → timestamp

function readBody(req) {
  return new Promise((ok, err) => {
    let b = ''
    req.on('data', c => b += c)
    req.on('end', () => { try { ok(b ? JSON.parse(b) : {}) } catch { ok({}) } })
    req.on('error', err)
  })
}

// ── Resolve tenantId a partir da URL ─────────────────
function resolveTenantId(req) {
  const upath = new URL(req.url, 'http://x').pathname
  let tenantId = null
  if (upath.startsWith('/webhook/whatsapp')) {
    tenantId = upath.split('/')[3] || null
  } else {
    const slug = upath.split('/')[2] || null
    if (slug) {
      const row = db.prepare("SELECT id FROM tenants WHERE slug=? OR id=?").get(slug, slug)
      tenantId = row?.id || null
    }
  }
  return tenantId || req.headers['x-tenant-id'] || null
}

// ── Handler principal ─────────────────────────────────
async function handleIAWebhook(req, res, sendFn) {
  const body     = await readBody(req)
  const tenantId = resolveTenantId(req)

  try {
    const msg    = body?.data?.message?.conversation || body?.data?.message?.extendedTextMessage?.text || ''
    const from   = body?.data?.key?.remoteJid || ''
    const fromMe = body?.data?.key?.fromMe || false
    if (!msg || !from || fromMe) { sendFn(res, 200, { ok: true }); return }
    const phone = from.replace('@s.whatsapp.net', '').replace('@c.us', '')
    if (!tenantId) { sendFn(res, 200, { ok: true }); return }

    const cfg = db.prepare("SELECT ia_config,evo_instance,store_name,store_descricao,store_whatsapp,store_tempo_entrega,delivery_fee_config,horarios_config,store_open FROM store_config WHERE tenant_id=?").get(tenantId)
    if (!cfg) { sendFn(res, 200, { ok: true }); return }
    const ia = jsonParse(cfg.ia_config) || {}
    if (!ia.ativo) { sendFn(res, 200, { ok: true }); return }

    const cfgGlobal = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
    const iaG = jsonParse(cfgGlobal?.ia_config) || {}
    const openaiKey  = iaG.openai_key || ''
    if (!openaiKey) { log('⚠️', 'OpenAI key não configurada'); sendFn(res, 200, { ok: true }); return }

    const modelo    = iaG.modelo    || 'gpt-4o-mini'
    const maxTokens = iaG.max_tokens || 800
    const bufferSeg = iaG.buffer_seg || 3
    const quebraLen = iaG.quebra_linha || 0
    const pausaMin  = iaG.pausa_min || 30

    // Pausa humano
    const pausaKey = `pausa:${tenantId}:${phone}`
    const pausaAt  = _pausaHumano.get(pausaKey)
    if (pausaAt && (Date.now() - pausaAt) < pausaMin * 60 * 1000) {
      log('⏸️', `IA pausada para ${phone}`); sendFn(res, 200, { ok: true }); return
    }

    // Histórico de conversa
    const histKey = `conv:${tenantId}:${phone}:hist`
    if (!_msgBuffer.has(histKey)) _msgBuffer.set(histKey, [])
    const convHist = _msgBuffer.get(histKey)

    // Buffer de mensagens (acumula por bufferSeg segundos)
    const bufKey = `buf:${tenantId}:${phone}`
    if (_msgBuffer.has(bufKey)) clearTimeout(_msgBuffer.get(bufKey).timer)
    const msgs = _msgBuffer.has(bufKey) ? _msgBuffer.get(bufKey).msgs : []
    msgs.push(msg)

    const timer = setTimeout(async () => {
      _msgBuffer.delete(bufKey)
      const msgFull = msgs.join('\n')
      const inst    = cfg.evo_instance || require('./wa').EVO_INST
      const nomeLoja = cfg.store_name || 'Restaurante'

      // ── Contexto para a IA ──────────────────────────
      const contexto = []

      // Link do cardápio
      const tenantRow    = db.prepare("SELECT slug FROM tenants WHERE id=?").get(tenantId)
      const proto        = req.headers['x-forwarded-proto'] || 'https'
      const host         = req.headers['host'] || ''
      const linkCardapio = `${proto}://${host}/index.html?slug=${tenantRow?.slug || tenantId}`

      // Status da loja
      const agora      = new Date()
      const diasSemana = ['dom','seg','ter','qua','qui','sex','sab']
      const diaHoje    = diasSemana[agora.getDay()]
      const horaMin    = agora.getHours() * 60 + agora.getMinutes()
      let lojaAbertaAgora = cfg.store_open !== false
      const horariosCfg   = jsonParse(cfg.horarios_config) || {}
      const diaConfig     = horariosCfg[diaHoje]
      if (diaConfig) {
        if (!diaConfig.ativo) { lojaAbertaAgora = false }
        else {
          const [ah, am] = (diaConfig.abertura  || '00:00').split(':').map(Number)
          const [fh, fm] = (diaConfig.fechamento || '23:59').split(':').map(Number)
          lojaAbertaAgora = horaMin >= ah*60+am && horaMin <= fh*60+fm
        }
      }

      // 1. Info da loja
      const taxaCfg  = jsonParse(cfg.delivery_fee_config) || {}
      const infoLoja = [
        `Nome: ${nomeLoja}`,
        `Status agora: ${lojaAbertaAgora ? '🟢 ABERTO' : '🔴 FECHADO'}`,
        cfg.store_whatsapp     ? `WhatsApp: ${cfg.store_whatsapp}` : null,
        cfg.store_descricao    ? `Descrição: ${cfg.store_descricao}` : null,
        cfg.store_tempo_entrega? `Tempo de entrega: ${cfg.store_tempo_entrega}` : null,
        taxaCfg.tipo === 'fixo'
          ? `Taxa de entrega: ${parseFloat(taxaCfg.valor||0) > 0 ? 'R$ '+parseFloat(taxaCfg.valor).toFixed(2).replace('.',',') : 'Grátis'}`
          : taxaCfg.tipo === 'por_km' && taxaCfg.faixas?.length
            ? `Taxa por km: ${taxaCfg.faixas.map(f=>`até ${f.ate_km}km: R$${parseFloat(f.taxa).toFixed(2).replace('.',',')}`).join(' | ')}`
            : null,
        `Cardápio: ${linkCardapio}`,
      ].filter(Boolean)
      contexto.push(`INFORMAÇÕES DA LOJA:\n${infoLoja.join('\n')}`)

      // 2. Horários
      const diasNome = {dom:'Domingo',seg:'Segunda',ter:'Terça',qua:'Quarta',qui:'Quinta',sex:'Sexta',sab:'Sábado'}
      if (Object.keys(horariosCfg).length) {
        contexto.push('HORÁRIO DE FUNCIONAMENTO:\n' + Object.entries(horariosCfg).map(([d,h]) =>
          h.ativo ? `${diasNome[d]}: ${h.abertura} às ${h.fechamento}${d===diaHoje?' ← hoje':''}` : `${diasNome[d]}: Fechado`
        ).join('\n'))
      }

      // 3. Cardápio
      const categorias = db.prepare("SELECT name,label FROM categories WHERE tenant_id=? AND ativo=1 ORDER BY sort_order").all(tenantId)
      const itensTodos = db.prepare("SELECT name,description,price,price_old,status,cat_key,cat,emoji,promo FROM menu_items WHERE tenant_id=? AND status!='pausado' ORDER BY id").all(tenantId)
      if (itensTodos.length) {
        const catMap = new Map()
        for (const item of itensTodos) {
          const ck = item.cat_key || item.cat || 'outros'
          if (!catMap.has(ck)) catMap.set(ck, [])
          catMap.get(ck).push(item)
        }
        let cardapioTxt = ''
        for (const [catKey, items] of catMap) {
          const ci  = categorias.find(c => c.name === catKey)
          const lbl = ci?.label || ci?.name || catKey
          const txt = items.map(i => {
            const preco = `R$${parseFloat(i.price).toFixed(2).replace('.',',')}`
            const ant   = i.price_old ? ` (era R$${parseFloat(i.price_old).toFixed(2).replace('.',',')})` : ''
            const esg   = i.status === 'esgotado' ? ' [ESGOTADO]' : ''
            const prm   = i.promo ? ' 🔥PROMOÇÃO' : ''
            const desc  = i.description ? ` — ${i.description.slice(0,60)}${i.description.length>60?'…':''}` : ''
            return `  • ${i.name}: ${preco}${ant}${prm}${esg}${desc}`
          }).join('\n')
          cardapioTxt += `\n${lbl.toUpperCase()}:\n${txt}\n`
        }
        contexto.push(`CARDÁPIO COMPLETO:${cardapioTxt}\nPara ver fotos e pedir: ${linkCardapio}`)

        // 4. Promoções
        const promo = itensTodos.filter(i => i.promo && i.status !== 'esgotado')
        if (promo.length) {
          contexto.push('PROMOÇÕES DO DIA:\n' + promo.map(i => {
            const p = `R$${parseFloat(i.price).toFixed(2).replace('.',',')}`
            const a = i.price_old ? ` (antes R$${parseFloat(i.price_old).toFixed(2).replace('.',',')})` : ''
            return `  🔥 ${i.name}: ${p}${a}`
          }).join('\n'))
        }
      }

      // 5. Cupons
      const cupons = db.prepare("SELECT code,type,value,min_order FROM cupons WHERE tenant_id=? AND ativo=1 AND (expires_at IS NULL OR expires_at > datetime('now')) LIMIT 5").all(tenantId)
      if (cupons.length) {
        contexto.push('CUPONS DISPONÍVEIS:\n' + cupons.map(cp => {
          const desc = cp.type==='percent' ? `${cp.value}% de desconto` : `R$${parseFloat(cp.value).toFixed(2).replace('.',',')} de desconto`
          const min  = parseFloat(cp.min_order||0) > 0 ? ` (mínimo R$${parseFloat(cp.min_order).toFixed(2).replace('.',',')})` : ''
          return `  • Código *${cp.code}*: ${desc}${min}`
        }).join('\n'))
      }

      // 6. Pedidos do cliente
      const pedidosCliente = db.prepare("SELECT id,status,total,items,created_at FROM orders WHERE tenant_id=? AND phone LIKE ? ORDER BY id DESC LIMIT 3").all(tenantId, `%${phone.slice(-8)}%`)
      if (pedidosCliente.length) {
        const sl = {analise:'⏳ aguardando',producao:'👨‍🍳 em preparo',pronto:'✅ pronto',saiu:'🛵 saiu',entregue:'🎉 entregue',cancelado:'❌ cancelado',finalizado:'✅ finalizado'}
        contexto.push('PEDIDOS RECENTES DESTE CLIENTE:\n' + pedidosCliente.map(p => {
          const its = (() => { try { return (JSON.parse(p.items)||[]).map(i=>`${i.qty}x ${i.name}`).join(', ') } catch { return '' } })()
          return `  Pedido #${p.id}: ${sl[p.status]||p.status} — R$${parseFloat(p.total).toFixed(2).replace('.',',')}${its?' — '+its:''}`
        }).join('\n'))
      }

      // 7. Pedido específico mencionado
      const numMatch = msgFull.match(/#\*?(\d{1,6})\*?/) || msgFull.match(/pedido\s*[*#]?\s*(\d{1,6})/i) || msgFull.match(/n[uú]mero\s*[*#]?\s*(\d{1,6})/i)
      if (numMatch) {
        const numPedido = parseInt(numMatch[1])
        let ped = db.prepare("SELECT id,status,total,items,client,phone,addr,pag,created_at FROM orders WHERE tenant_id=? AND id=?").get(tenantId, numPedido)
        if (!ped) ped = db.prepare("SELECT id,status,total,items,client,phone,addr,pag,created_at FROM orders WHERE id=? AND phone LIKE ?").get(numPedido, `%${phone.slice(-8)}%`)
        if (!ped) ped = db.prepare("SELECT id,status,total,items,client,phone,addr,pag,created_at FROM orders WHERE id=?").get(numPedido)
        const sl = {analise:'⏳ aguardando confirmação',producao:'👨‍🍳 em preparo',pronto:'✅ pronto',saiu:'🛵 saiu para entrega',entregue:'🎉 entregue',cancelado:'❌ cancelado',finalizado:'✅ finalizado'}
        if (ped) {
          const its = (() => { try { return (JSON.parse(ped.items)||[]).map(i=>`${i.qty}x ${i.name}`).join(', ') } catch { return '' } })()
          contexto.push([`PEDIDO CONSULTADO (#${ped.id}):`,`  Status: ${sl[ped.status]||ped.status}`,`  Total: R$${parseFloat(ped.total).toFixed(2).replace('.',',')}`,its?`  Itens: ${its}`:'',ped.addr?`  Endereço: ${ped.addr}`:''].filter(Boolean).join('\n'))
        } else {
          contexto.push(`PEDIDO #${numPedido}: não encontrado.`)
        }
      }

      // ── System prompt ───────────────────────────────
      const promptBase = iaG.prompt_base || `Você é o assistente virtual do ${nomeLoja}. Seja simpático, objetivo e use emojis com moderação. Responda sempre em português.`
      const systemPrompt = `${promptBase}\n\n${contexto.join('\n\n')}\n\nREGRAS:\n- Nunca liste todos os itens. Sempre envie o link: ${linkCardapio}\n- Se o cliente perguntar sobre pedido sem número, pergunte pelo número.\n- Informe status da loja e horários quando perguntado.\n- Para novos pedidos, direcione para: ${linkCardapio}`

      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: modelo, max_tokens: maxTokens, messages: [
            { role: 'system', content: systemPrompt },
            ...convHist.slice(-10),
            { role: 'user', content: msgFull }
          ]})
        })
        const d = await r.json().catch(() => ({}))
        let resposta = d?.choices?.[0]?.message?.content || ''

        if (quebraLen > 0 && resposta.length > quebraLen) {
          const words = resposta.split(' ')
          let linha = '', result = []
          for (const w of words) {
            if ((linha + ' ' + w).trim().length > quebraLen) { result.push(linha.trim()); linha = w }
            else linha = (linha + ' ' + w).trim()
          }
          if (linha) result.push(linha)
          resposta = result.join('\n')
        }

        if (resposta) {
          await sendWA(phone, resposta, inst)
          log('🤖', `IA → ${phone}: ${resposta.slice(0, 60)}`)
          convHist.push({ role: 'user', content: msgFull }, { role: 'assistant', content: resposta })
          if (convHist.length > 20) convHist.splice(0, convHist.length - 20)
          _msgBuffer.set(histKey, convHist)
        }
      } catch(e) { log('❌', 'IA OpenAI error:', e.message) }
    }, bufferSeg * 1000)

    _msgBuffer.set(bufKey, { msgs, timer })
  } catch(e) { log('❌', 'Webhook error:', e.message) }

  sendFn(res, 200, { ok: true })
}

// ── Humano assumiu — pausa IA ─────────────────────────
async function handleHumanoAssumiu(req, res, sendFn) {
  const body = await readBody(req)
  const { phone, tenant_id } = body
  if (phone && tenant_id) {
    _pausaHumano.set(`pausa:${tenant_id}:${phone}`, Date.now())
    log('👤', `Humano assumiu conversa com ${phone}`)
  }
  sendFn(res, 200, { ok: true })
}

module.exports = { handleIAWebhook, handleHumanoAssumiu }

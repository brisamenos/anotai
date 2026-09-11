// ═══════════════════════════════════════════════════════
// ROUTES.JS — Todas as rotas especiais do Estima Food
// PIX · Carteira · Saques · WhatsApp · IA · Auth · Admin
// ═══════════════════════════════════════════════════════
// Para atualizar qualquer funcionalidade:
//   - edite APENAS este arquivo e reinicie o servidor
//   - o server.js não precisa ser tocado
// ═══════════════════════════════════════════════════════
'use strict'

const fs     = require('fs')
const path   = require('path')
const zlib   = require('zlib')
const crypto = require('crypto')
const { buildOrderTrackingMessage } = require('./order-message')
const { phoneLookupArgs, phoneLookupSql, phonesMatch } = require('./phone-utils')

// ── Helper: notifica cliente quando PIX é confirmado (online ou manual) ──────
function _notificarPixConfirmado(tid, order, sendWA, fillVars, EVO_INST, db) {
  if (!order?.phone) return
  if (parseInt(order.wa_track || 0) !== 1) return
  setImmediate(async () => {
    try {
      const cfg    = db.prepare('SELECT evo_instance, evo_automacoes, order_num_offset, store_name FROM store_config WHERE tenant_id=?').get(tid)
      const inst   = cfg?.evo_instance || EVO_INST
      const loja   = cfg?.store_name || 'Restaurante'
      const auto   = (() => { try { return JSON.parse(cfg?.evo_automacoes||'{}') } catch { return {} } })()
      const pixConf = auto['pix_confirmado'] || {}
      if (pixConf.on === false) return
      const offset = parseInt(cfg?.order_num_offset) || 0
      const idStr  = _numeroPedidoPad(order, offset)
      const nome   = order.client || 'Cliente'
      const items  = (()=>{ try{ return (JSON.parse(order.items)||[]).map(i=>`• ${i.qty}x ${i.name}`).join('\n') }catch{ return '' } })()
      const total  = (parseFloat(order.total||0)+parseFloat(order.taxa||0)).toFixed(2).replace('.',',')
      const msgPad = `🏪 *${loja}*\n${'─'.repeat(20)}\n\n✅ *Pagamento confirmado*\n\nOlá, *${nome}*! Recebemos o PIX do pedido *#${idStr}*.\n\n*Itens*\n${items}\n\n*Total:* R$ ${total}\n\nSeu pedido já entrou em preparo.`
      const msgFin = pixConf.msg ? fillVars(pixConf.msg, { nome, id: idStr, itens: items, total, loja }) : msgPad
      await sendWA(order.phone, msgFin, inst)
    } catch(e) { /* silencia erros de notificação */ }
  })
}

// ── Job de recuperação de pagamentos PIX aprovados ────────────────────────────
// Roda a cada 60 segundos e verifica pagamentos que foram aprovados no Mercado
// Pago mas que o pedido ainda está preso em 'aguardando_pix' (cliente fechou a
// página antes do poll frontend confirmar ou webhook não chegou).
let _pixJobIniciado = false

function _brasiliaDateString(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  return `${parts.year}-${parts.month}-${parts.day}`
}

// Normaliza valor pra MP — aceita string ("15,90", "15.90"), número, retorna
// number com 2 casas decimais. Se inválido (NaN, <= 0), retorna null.
// MP rejeita com erro 4037 ("Invalid transaction_amount") se vier:
// - NaN, undefined, null
// - <= 0
// - mais de 2 casas decimais (ex: 15.999)
// - string com vírgula sem conversão
function _numeroPedidoComOffset(order, offset = 0) {
  if (order?.order_num) return Number(order.order_num)
  const id = Number(order?.id || 0)
  const off = Number(offset || 0)
  return id > off ? Math.max(1, id - off) : id
}

function _numeroPedidoPad(order, offset = 0) {
  const num = _numeroPedidoComOffset(order, offset)
  return num ? String(num).padStart(3, '0') : ''
}

function _mpValor(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  // Aceita "15,90" → "15.90"
  const s = String(raw).replace(',', '.').trim()
  const n = parseFloat(s)
  if (!isFinite(n) || isNaN(n) || n <= 0) return null
  // Arredonda pra 2 casas SEM erros de ponto flutuante (15.595 → 15.60)
  return Math.round(n * 100) / 100
}

function _emitOrderUpdate(db, sseBroadcast, tenantId, order, extra = {}) {
  if (!order) return
  const items = typeof order.items === 'string'
    ? (() => { try { return JSON.parse(order.items) } catch { return [] } })()
    : (order.items || [])
  sseBroadcast(`orders-rt:${tenantId}`, 'orders:UPDATE', { ...order, items, ...extra })
}

function _atribuirOrderNumSeNecessario(db, tenantId, orderId) {
  if (!tenantId || !orderId) return null
  const txFn = db.transaction((tid, id) => {
    const atual = db.prepare('SELECT id, order_num FROM orders WHERE id=? AND tenant_id=?').get(id, tid)
    if (!atual) return null
    if (atual.order_num) {
      db.prepare('UPDATE order_chat_threads SET order_num=?, updated_at=datetime(\'now\') WHERE order_id=? AND tenant_id=?')
        .run(atual.order_num, id, tid)
      return Number(atual.order_num)
    }
    const cfg = db.prepare('SELECT order_num_offset FROM store_config WHERE tenant_id=?').get(tid)
    const offset = parseInt(cfg?.order_num_offset) || 0
    const row = db.prepare(`
      SELECT COALESCE(MAX(order_num),0) as mx
      FROM orders
      WHERE tenant_id=? AND id>? AND order_num IS NOT NULL
    `).get(tid, offset)
    const next = (row?.mx || 0) + 1
    db.prepare('UPDATE orders SET order_num=? WHERE id=? AND tenant_id=? AND order_num IS NULL').run(next, id, tid)
    db.prepare('UPDATE order_chat_threads SET order_num=?, updated_at=datetime(\'now\') WHERE order_id=? AND tenant_id=?')
      .run(next, id, tid)
    return next
  })
  return txFn(tenantId, orderId)
}

function _sincronizarPedidoPixAprovado(db, log, sseBroadcast, aplicarBaixaEstoquePedido, orderId, tenantId, origem = 'pix-sync') {
  if (!orderId || !tenantId) return null
  const pix = db.prepare(`
    SELECT 1
    FROM pagamentos_pix
    WHERE tenant_id=? AND order_id=? AND status='aprovado'
    LIMIT 1
  `).get(tenantId, orderId)
  if (!pix) return null

  const antes = db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(orderId, tenantId)
  if (!antes) return null

  const jaOnline = antes.pag === 'pix_mp'
  const precisaLiberar = ['aguardando_pix', 'analise'].includes(antes.status)
    || (antes.status === 'cancelado' && antes.pag !== 'pix_mp' && antes.pag !== 'cartao_mp')
  const novoStatus = precisaLiberar ? 'producao' : antes.status
  const mudou = !jaOnline || antes.status !== novoStatus
  if (!mudou) {
    if (!antes.order_num) {
      _atribuirOrderNumSeNecessario(db, tenantId, orderId)
      return db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(orderId, tenantId) || antes
    }
    return antes
  }

  db.prepare("UPDATE orders SET pag='pix_mp', status=? WHERE id=? AND tenant_id=?").run(novoStatus, orderId, tenantId)
  _atribuirOrderNumSeNecessario(db, tenantId, orderId)
  const depois = db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(orderId, tenantId)

  if (precisaLiberar && typeof aplicarBaixaEstoquePedido === 'function' && depois) {
    aplicarBaixaEstoquePedido(tenantId, depois, origem)
  }
  if (depois) {
    log('✅', `[PIX SYNC] Pedido #${orderId} normalizado como pix_mp/status=${novoStatus} (${origem})`)
    _emitOrderUpdate(db, sseBroadcast, tenantId, depois, { status: novoStatus, pag: 'pix_mp', _pixOnlineConfirmado: true })
  }
  return depois
}

function _iniciarPixRecoveryJob(db, log, sseBroadcast, MP_TOKEN_ENV, aplicarBaixaEstoquePedido) {
  if (_pixJobIniciado) return
  _pixJobIniciado = true
  log('🔄', 'PIX recovery job iniciado (intervalo: 60s)')

  setInterval(async () => {
    try {
      // Busca pagamentos pendentes criados nas últimas 24h que ainda têm pedido aguardando
      const pendentes = db.prepare(`
        SELECT p.mp_payment_id, p.order_id, p.tenant_id, p.valor, p.mp_source, p.status
        FROM pagamentos_pix p
        LEFT JOIN orders o ON o.id = p.order_id
        WHERE p.status IN ('pendente','aprovado')
          AND p.order_id IS NOT NULL
          AND (o.status = 'aguardando_pix' OR o.status IS NULL OR COALESCE(o.pag,'') != 'pix_mp')
          AND p.created_at > datetime('now', '-24 hours')
      `).all()

      if (!pendentes.length) return

      // Agrupa por tenant para log mais claro
      const porTenant = pendentes.reduce((acc, r) => {
        acc[r.tenant_id] = acc[r.tenant_id] || []
        acc[r.tenant_id].push(r)
        return acc
      }, {})

      for (const [tenantId, pagamentos] of Object.entries(porTenant)) {
        log('🔍', `PIX recovery: tenant=${tenantId} — verificando ${pagamentos.length} pagamento(s) pendente(s)`)
        let liberados = 0, rejeitados = 0

        for (const row of pagamentos) {
          if (row.status === 'aprovado') {
            const synced = _sincronizarPedidoPixAprovado(db, log, sseBroadcast, aplicarBaixaEstoquePedido, row.order_id, tenantId, 'pix-recovery-aprovado')
            if (synced) liberados++
            continue
          }
          // Resolve token POR PAGAMENTO usando mp_source gravado.
          // Pagamentos diferentes do mesmo tenant podem ter usado contas
          // diferentes se o gestor mudou a config entre eles.
          const _pCfg = _resolveMpForExistingPayment(db, row.mp_payment_id, MP_TOKEN_ENV)
          const mpToken = _pCfg.mp_token
          if (!mpToken) continue
          try {
            const r = await fetch(`https://api.mercadopago.com/v1/payments/${row.mp_payment_id}`, {
              headers: { 'Authorization': `Bearer ${mpToken}` }
            })
            if (!r.ok) continue
            const pd = await r.json()

            if (pd.status === 'approved') {
              db.prepare("UPDATE pagamentos_pix SET status='aprovado', paid_at=? WHERE mp_payment_id=?")
                .run(pd.date_approved || new Date().toISOString(), String(row.mp_payment_id))

              const pedAtual = db.prepare("SELECT status, pag FROM orders WHERE id=? AND tenant_id=?").get(row.order_id, tenantId)
              const eraAguardando = pedAtual?.status === 'aguardando_pix'
              // Ressurreição: pedido cancelado por timeout (cleanup) que recebeu pagamento depois.
              // Critério: status='cancelado' AND pag ainda não é 'pix_mp'/'cartao_mp' (não confirmado antes).
              const podeRessurreicao = pedAtual?.status === 'cancelado'
                && pedAtual?.pag !== 'pix_mp' && pedAtual?.pag !== 'cartao_mp'

              if (eraAguardando || podeRessurreicao) {
                // PIX online confirmado pelo MP → entra direto em produção (pula análise)
                // O pagamento já foi validado, não precisa de aceite manual.
                db.prepare("UPDATE orders SET status='producao', pag='pix_mp' WHERE id=? AND tenant_id=?").run(row.order_id, tenantId)
                _atribuirOrderNumSeNecessario(db, tenantId, row.order_id)
                if (podeRessurreicao) log('🔄', `PEDIDO RESSUSCITADO (recovery): pagamento PIX chegou após cancelamento — id=${row.order_id} tenant=${tenantId}`)
                const pedFull = db.prepare("SELECT * FROM orders WHERE id=? AND tenant_id=?").get(row.order_id, tenantId)
                if (typeof aplicarBaixaEstoquePedido === 'function' && pedFull) {
                  aplicarBaixaEstoquePedido(tenantId, pedFull, 'pix-recovery')
                }
                const items   = pedFull && typeof pedFull.items === 'string'
                  ? (() => { try { return JSON.parse(pedFull.items) } catch { return [] } })()
                  : (pedFull?.items || [])
                sseBroadcast(`orders-rt:${tenantId}`, 'orders:UPDATE',
                  pedFull ? { ...pedFull, items, status: 'producao', pag: 'pix_mp', _pixOnlineConfirmado: true }
                          : { id: row.order_id, status: 'producao', pag: 'pix_mp', _pixOnlineConfirmado: true })
                liberados++
              }
            } else if (pd.status === 'rejected' || pd.status === 'cancelled') {
              db.prepare("UPDATE pagamentos_pix SET status=? WHERE mp_payment_id=?")
                .run(pd.status === 'rejected' ? 'rejeitado' : 'cancelado', String(row.mp_payment_id))
              rejeitados++
            }
          } catch (e) {
            log('⚠️', `PIX recovery: erro mp_id=${row.mp_payment_id} tenant=${tenantId}:`, e.message)
          }
        }

        if (liberados)  log('✅', `PIX recovery: tenant=${tenantId} — ${liberados} pedido(s) liberado(s)`)
        if (rejeitados) log('⚠️', `PIX recovery: tenant=${tenantId} — ${rejeitados} pagamento(s) rejeitado(s)/cancelado(s)`)
      }
    } catch (e) {
      log('⚠️', 'PIX recovery job erro geral:', e.message)
    }
  }, 60_000)
}

// ═══════════════════════════════════════════════════════
// Helper compartilhado: lê instância de WhatsApp para cobranças
// (configurada em /admin → Saques PIX → "WhatsApp para cobranças")
// Fallback: instância padrão (mesma usada pelos pedidos)
// ═══════════════════════════════════════════════════════
function _getInstanciaCobranca(db, fallbackInst) {
  try {
    const c = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
    const g = c?.ia_config ? JSON.parse(c.ia_config) : {}
    if (g.cobranca_wa_instance && typeof g.cobranca_wa_instance === 'string') {
      const inst = g.cobranca_wa_instance.trim()
      if (inst) return inst
    }
  } catch {}
  return fallbackInst
}

// ═══════════════════════════════════════════════════════
// CHATBOT DE COBRANÇA — instância admin (Saques PIX)
// Menu simples: Financeiro / Suporte / Falar com atendente.
// Estado em memória por telefone (perde-se em restart — aceitável,
// o cliente só recebe o menu de novo).
// ═══════════════════════════════════════════════════════
const _cobrancaBotState = new Map() // phone -> { step, tentativas }

function _cobrancaConfigGlobal(db) {
  try {
    const c = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
    return c?.ia_config ? JSON.parse(c.ia_config) : {}
  } catch { return {} }
}

const _MENU_COBRANCA = [
  `👋 Olá! Bem-vindo ao atendimento do *Estima Food*.`,
  ``,
  `Escolha uma opção digitando o número:`,
  `1️⃣ *Assinar plano*`,
  `2️⃣ *Falar com atendente*`,
  `3️⃣ *Suporte*`,
  `4️⃣ *Financeiro* (pagar fatura / 2ª via)`
].join('\n')

function _precosPlanosBot(db) {
  const g = _cobrancaConfigGlobal(db)
  const essencial = g.preco_essencial !== undefined ? parseFloat(g.preco_essencial) : 79.99
  const premium   = g.preco_premium   !== undefined ? parseFloat(g.preco_premium)   : 99.90
  return { essencial, premium }
}

// Calcula um delay (em ms) proporcional ao tamanho da mensagem, pra simular
// o tempo real de digitação. Repassado como parâmetro "delay" pro Evolution
// API, que mostra "digitando..." no WhatsApp do cliente antes de entregar.
function _delayDigitando(text) {
  const len = String(text || '').length
  const ms = 500 + len * 25
  return Math.max(900, Math.min(ms, 4000))
}

// Envia mensagem pro cliente já calculando o delay de "digitando..." automaticamente.
async function _sendWaBot(sendWA, phone, text, inst) {
  return sendWA(phone, text, inst, _delayDigitando(text))
}

// Gera cobrança PIX simples (sem opção de cartão) pra uso pelo chatbot.
// Espelha _gerarCobrancaMP (routes.js dentro de handleRoutes), mas fica
// no escopo do módulo pra poder ser chamada de dentro de _handleCobrancaBot.
async function _gerarCobrancaBotPix(ctx, tenant, opts) {
  const { db, MP_TOKEN, marcarDirty } = ctx
  const { plano, valor, meses } = opts
  const _valorMpBot = _mpValor(valor)
  if (_valorMpBot === null) throw new Error('Valor da cobrança inválido')

  const mpToken = _resolveMpGlobal(db, MP_TOKEN)
  if (!mpToken) throw new Error('Token Mercado Pago não configurado em /admin → Saques PIX')

  const extRef = `assinatura-bot-${tenant.id.slice(0, 8)}-${plano}-${Date.now()}`
  const pixExpiraEm = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString() // validade técnica do Pix (3d)
  // vence_em salvo na fatura = vencimento real do plano, não a validade do
  // Pix acima (mesmo ajuste feito em _gerarCobrancaMP).
  const venceEm = tenant.expires_at || pixExpiraEm.slice(0, 10)
  const descricao = `Plano ${_planoSaasLabel(plano)} — ${meses} ${meses === 1 ? 'mês' : 'meses'} — ${tenant.nome}`

  const mpResp = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${mpToken}`, 'X-Idempotency-Key': extRef },
    body: JSON.stringify({
      transaction_amount: _valorMpBot,
      description: descricao,
      payment_method_id: 'pix',
      external_reference: extRef,
      date_of_expiration: pixExpiraEm.replace('Z', '-03:00'),
      payer: { email: 'cobranca@estimafood.com', first_name: tenant.nome.split(' ')[0] || 'Cliente' }
    })
  })
  const mpData = await mpResp.json()
  if (!mpResp.ok) throw new Error(mpData.message || 'Falha ao criar PIX no Mercado Pago')

  const qrCode       = mpData.point_of_interaction?.transaction_data?.qr_code || null
  const qrCodeBase64 = mpData.point_of_interaction?.transaction_data?.qr_code_base64 || null
  const linkPagamento = mpData.point_of_interaction?.transaction_data?.ticket_url || null

  const info = db.prepare(`INSERT INTO faturas
    (tenant_id, plano, valor, meses, metodo, status, link_pagamento, mp_payment_id, mp_external_ref, qr_code, qr_code_base64, vence_em, obs)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      tenant.id, plano, parseFloat(valor), parseInt(meses) || 1, 'pix', 'pendente',
      linkPagamento, mpData.id ? String(mpData.id) : null, extRef,
      qrCode, qrCodeBase64, venceEm, 'Assinatura via chatbot WhatsApp'
    )
  marcarDirty()
  const fatura = db.prepare('SELECT * FROM faturas WHERE id=?').get(info.lastInsertRowid)
  return { fatura, link: linkPagamento, qr_code: qrCode, qr_code_base64: qrCodeBase64 }
}

async function _handleCobrancaBot(ctx, body) {
  const { EVO_INST, db, _pausaHumano } = ctx
  const event = body?.event || ''
  if (event !== 'messages.upsert' && event !== 'message.upsert') return

  const msgs = Array.isArray(body?.data?.messages) ? body.data.messages : (body?.data ? [body.data] : [])

  for (const m of msgs) {
    const fromMe = m?.key?.fromMe === true || m?.key?.fromMe === 'true'
    const jid    = m?.key?.remoteJid || ''
    if (!jid || jid.startsWith('status@') || jid.endsWith('@lid') || jid.includes('@g.us')) continue
    const phone = jid.replace('@s.whatsapp.net', '').replace('@c.us', '')
    if (!phone) continue

    const pausaKey = `pausa:_cobranca:${phone}`

    // Admin/Igor respondeu manualmente pelo próprio WhatsApp → pausa o bot pra esse contato
    if (fromMe) {
      _pausaHumano.set(pausaKey, Date.now())
      continue
    }

    // Bot pausado (conversa sendo levada por humano) — não interfere por 30min
    const pausaAt = _pausaHumano.get(pausaKey)
    if (pausaAt && (Date.now() - pausaAt) < 30 * 60 * 1000) continue

    const texto = String(
      m?.message?.conversation ||
      m?.message?.extendedTextMessage?.text ||
      ''
    ).trim()
    const temImagem = !!(m?.message?.imageMessage)
    if (!texto && !temImagem) continue

    // Junta mensagens rápidas do mesmo cliente numa só resposta — sem isso, um
    // "Oi" seguido de "Boa tarde" (comum quando a pessoa digita em partes) fazia
    // o bot responder cada mensagem separadamente. Espera 10s de silêncio antes
    // de processar; cada mensagem nova reinicia a contagem.
    _bufferizarMensagemCobrancaBot(ctx, phone, texto, temImagem)
  }
}

// Buffer por telefone: { textos: string[], temImagem: boolean, timer } — junta
// tudo que o cliente mandar dentro da janela de silêncio de 10s antes de chamar
// o processamento de fato, uma única vez.
const _cobrancaBotBuffer = new Map()
const COBRANCA_BOT_DEBOUNCE_MS = 10_000

function _bufferizarMensagemCobrancaBot(ctx, phone, texto, temImagem) {
  let buf = _cobrancaBotBuffer.get(phone)
  if (!buf) {
    buf = { textos: [], temImagem: false, timer: null }
    _cobrancaBotBuffer.set(phone, buf)
  }
  if (texto) buf.textos.push(texto)
  if (temImagem) buf.temImagem = true
  if (buf.timer) clearTimeout(buf.timer)
  buf.timer = setTimeout(() => {
    _cobrancaBotBuffer.delete(phone)
    const textoFinal = buf.textos.join('\n')
    _processarCobrancaBotMsg(ctx, phone, textoFinal, buf.temImagem)
      .catch(e => ctx.log?.('⚠️', `Bot cobrança (buffer) erro tenant=${phone}:`, e.message))
  }, COBRANCA_BOT_DEBOUNCE_MS)
}

async function _processarCobrancaBotMsg(ctx, phone, texto, temImagem) {
  const { db, log, EVO_INST, sendWA, sendWAImage, _pausaHumano } = ctx
  const inst = _getInstanciaCobranca(db, EVO_INST)
  const pausaKey = `pausa:_cobranca:${phone}`

    const gConfig = _cobrancaConfigGlobal(db)
    const atendenteWa = (gConfig.cobranca_atendente_whatsapp || '').replace(/\D/g, '') || null

    let state = _cobrancaBotState.get(phone) || { step: 'menu', tentativas: 0 }

    // Cliente está no fluxo de suporte aguardando detalhes → repassa texto/imagem pro atendente
    if (state.step === 'suporte_aguardando_info' && (texto || temImagem)) {
      await _sendWaBot(sendWA, phone, 'Recebido! ✅ Repassei pro nosso suporte, já te retornam por aqui. 🙏', inst)
      _cobrancaBotState.delete(phone)
      _pausaHumano.set(pausaKey, Date.now())
      if (atendenteWa) {
        try {
          const partes = [`🆘 *Novo chamado de suporte*`, ``, `De: ${phone}`]
          if (texto) partes.push(``, `Mensagem: ${texto}`)
          if (temImagem) partes.push(``, `📎 Cliente enviou uma imagem — confira o WhatsApp de cobranças.`)
          await sendWA(atendenteWa, partes.join('\n'), inst)
        } catch {}
      }
      return
    }

    // Comprovante enviado a qualquer momento (fora do fluxo de suporte) → avisa o atendente e pausa o bot
    if (temImagem) {
      await _sendWaBot(sendWA, phone, '📎 Recebi seu comprovante! Vou repassar pro financeiro conferir e te aviso por aqui assim que confirmarmos. 🙏', inst)
      _pausaHumano.set(pausaKey, Date.now())
      if (atendenteWa) {
        try {
          const tCli = db.prepare(`
            SELECT id, nome FROM tenants
            WHERE telefone_cobranca IS NOT NULL AND telefone_cobranca != ''
          `).all().find(t => phonesMatch(t.telefone_cobranca, phone))
          await sendWA(atendenteWa, `📎 *Novo comprovante recebido*\n\nDe: ${phone}${tCli ? `\nCliente: ${tCli.nome}` : ''}\n\nConfira o WhatsApp de cobranças.`, inst)
        } catch {}
      }
      return
    }

    if (!texto) return

    const txt = texto.toLowerCase()
    const isGreeting = /^(oi+|ol[aá]+|bom dia|boa tarde|boa noite|menu|in[ií]cio|come[cç]ar)\b/.test(txt)

    // Saudação a qualquer momento reseta pro menu
    if (isGreeting || state.step === 'novo') {
      state = { step: 'menu', tentativas: 0 }
      _cobrancaBotState.set(phone, state)
      await _sendWaBot(sendWA, phone, _MENU_COBRANCA, inst)
      return
    }

    if (state.step === 'menu') {
      if (/^1|assinar|plano|contratar/.test(txt)) {
        state = { step: 'assinar_segmento', tentativas: 0 }
        _cobrancaBotState.set(phone, state)
        await _sendWaBot(sendWA, phone, '🍽️ O *Estima Food* é um sistema completo de delivery e gestão pro seu restaurante: cardápio digital, PDV, gestão de mesas e app de garçom, tudo em um só lugar.', inst)
        await new Promise(r => setTimeout(r, 1200))
        await _sendWaBot(sendWA, phone, [
          `🚀 *Alguns benefícios:*`,
          ``,
          `✅ Cardápio online personalizado, sem taxa por pedido`,
          `✅ Pedidos recebidos direto pelo WhatsApp`,
          `✅ PIX integrado com confirmação automática`,
          `🤖 Inteligência Artificial no atendimento — responde clientes, tira dúvidas e ajuda a fechar pedidos sozinha`,
          `✅ Painel completo de gestão (financeiro, estoque, relatórios)`,
          `✅ App de garçom pra mesas e comandas`
        ].join('\n'), inst)
        await new Promise(r => setTimeout(r, 1200))
        await _sendWaBot(sendWA, phone, '💡 Você configura em poucos minutos e já começa a vender — com suporte sempre que precisar.', inst)
        await new Promise(r => setTimeout(r, 1200))
        await _sendWaBot(sendWA, phone, 'Pra eu te indicar o melhor plano, me conta: *qual o seu segmento?* (ex: pizzaria, hamburgueria, doceria, marmitaria, açaiteria...)', inst)
      } else if (/^2|atendente|igor|humano/.test(txt)) {
        _cobrancaBotState.delete(phone)
        _pausaHumano.set(pausaKey, Date.now())
        await _sendWaBot(sendWA, phone, 'Vou te transferir para a atendente, já já ela te retorna por aqui. Aguarde só um instante! 👤', inst)
        if (atendenteWa) await sendWA(atendenteWa, `👤 *Cliente pediu atendimento* — ${phone}`, inst)
      } else if (/^3|suporte/.test(txt)) {
        state = { step: 'suporte_aguardando_info', tentativas: 0 }
        _cobrancaBotState.set(phone, state)
        await _sendWaBot(sendWA, phone, 'Beleza! 🙂 Pra te ajudar mais rápido, me conta o que está acontecendo (pode mandar prints ou fotos também, se ajudar a explicar).', inst)
      } else if (/^4|financeiro|fatura|pagar/.test(txt)) {
        state = { step: 'aguardando_telefone', tentativas: 0 }
        _cobrancaBotState.set(phone, state)
        await _sendWaBot(sendWA, phone, 'Certo! ✅ Pra localizar sua fatura, me informa o número de telefone cadastrado no sistema (com DDD).\n\nEx: 85991234567', inst)
      } else {
        await _sendWaBot(sendWA, phone, 'Não entendi 🤔\n\n' + _MENU_COBRANCA, inst)
      }
      return
    }

    // ── Assinar plano: cliente respondeu o segmento → agora pede o telefone ──
    if (state.step === 'assinar_segmento') {
      const segmento = texto.trim().slice(0, 80)
      if (!segmento) {
        await _sendWaBot(sendWA, phone, 'Não entendi 🤔 Me conta rapidinho qual o seu segmento (ex: pizzaria, hamburgueria, doceria...).', inst)
        return
      }
      state = { step: 'assinar_telefone', segmento, tentativas: 0 }
      _cobrancaBotState.set(phone, state)
      await _sendWaBot(sendWA, phone, 'Anotado! ✅ Agora me informa um telefone com DDD — o mesmo cadastrado no sistema, se você já for cliente, ou qualquer telefone de contato caso ainda não seja.\n\nEx: 85991234567', inst)
      return
    }

    if (state.step === 'aguardando_telefone') {
      const digitado = texto.replace(/\D/g, '')
      if (digitado.length < 8) {
        await _sendWaBot(sendWA, phone, 'Não consegui identificar um número válido. Manda só os números, com DDD (ex: 85991234567).', inst)
        return
      }
      const tenant = db.prepare(`
        SELECT t.*, sc.store_whatsapp FROM tenants t
        LEFT JOIN store_config sc ON sc.tenant_id = t.id
        WHERE (t.telefone_cobranca IS NOT NULL AND t.telefone_cobranca != '')
           OR (sc.store_whatsapp IS NOT NULL AND sc.store_whatsapp != '')
      `).all().find(t => phonesMatch(t.telefone_cobranca || t.store_whatsapp, digitado))

      if (!tenant) {
        state.tentativas = (state.tentativas || 0) + 1
        if (state.tentativas >= 3) {
          _cobrancaBotState.delete(phone)
          _pausaHumano.set(pausaKey, Date.now())
          await _sendWaBot(sendWA, phone, 'Não encontrei esse número no sistema. Vou te encaminhar pro atendente pra te ajudar. 👤', inst)
          if (atendenteWa) await sendWA(atendenteWa, `⚠️ *Telefone não reconhecido no bot de cobrança* — cliente: ${phone}, informou: ${digitado}`, inst)
        } else {
          _cobrancaBotState.set(phone, state)
          await _sendWaBot(sendWA, phone, 'Não encontrei esse número no sistema. Confere se digitou certo, com DDD (ex: 85991234567).', inst)
        }
        return
      }

      const fatura = db.prepare(`SELECT * FROM faturas WHERE tenant_id=? AND status='pendente' ORDER BY created_at DESC LIMIT 1`).get(tenant.id)
      if (!fatura) {
        _cobrancaBotState.delete(phone)
        await _sendWaBot(sendWA, phone, `Verifiquei aqui e não há nenhuma fatura em aberto pra *${tenant.nome}* no momento. Você está em dia! ✅`, inst)
        return
      }

      const valorTxt = parseFloat(fatura.valor).toFixed(2).replace('.', ',')
      // T00:00:00 evita que a data volte um dia por causa do fuso horário
      // do servidor (fatura.vence_em é só "YYYY-MM-DD", sem hora).
      const venceTxt = fatura.vence_em ? new Date(fatura.vence_em + 'T00:00:00').toLocaleDateString('pt-BR') : '-'
      const msg = [
        `🧾 *Fatura em aberto — ${tenant.nome}*`,
        ``,
        `💰 *Valor:* R$ ${valorTxt}`,
        `⏰ *Vencimento:* ${venceTxt}`,
        ``,
        `💸 Pague via PIX com o código Copia e Cola abaixo, ou pelo QR Code que vou te enviar:`
      ].join('\n')
      await _sendWaBot(sendWA, phone, msg, inst)
      if (fatura.qr_code) {
        await new Promise(r => setTimeout(r, 1000))
        await _sendWaBot(sendWA, phone, fatura.qr_code, inst)
      }
      if (fatura.qr_code_base64) {
        await sendWAImage(phone, fatura.qr_code_base64, `📱 QR Code PIX — R$ ${valorTxt}`, inst)
      }
      _cobrancaBotState.delete(phone)
      return
    }

    // ── Assinar plano: primeiro identifica se é tenant existente ou lead novo ──
    if (state.step === 'assinar_telefone') {
      const digitado = texto.replace(/\D/g, '')
      if (digitado.length < 8) {
        await _sendWaBot(sendWA, phone, 'Não consegui identificar um número válido. Manda só os números, com DDD (ex: 85991234567).', inst)
        return
      }
      const precos = _precosPlanosBot(db)
      const essTxt = precos.essencial.toFixed(2).replace('.', ',')
      const preTxt = precos.premium.toFixed(2).replace('.', ',')
      const tenant = db.prepare(`
        SELECT t.*, sc.store_whatsapp FROM tenants t
        LEFT JOIN store_config sc ON sc.tenant_id = t.id
        WHERE (t.telefone_cobranca IS NOT NULL AND t.telefone_cobranca != '')
           OR (sc.store_whatsapp IS NOT NULL AND sc.store_whatsapp != '')
      `).all().find(t => phonesMatch(t.telefone_cobranca || t.store_whatsapp, digitado))

      if (tenant) {
        state = { step: 'assinar_escolha_plano', tenantId: tenant.id, segmento: state.segmento, tentativas: 0 }
        _cobrancaBotState.set(phone, state)
        await _sendWaBot(sendWA, phone, `Encontrei seu cadastro, *${tenant.nome}*! Seu plano atual é *${_planoSaasLabel(tenant.plano)}*.\n\nQual plano você quer assinar?\n1️⃣ *Essencial* — R$ ${essTxt}/mês\n2️⃣ *Premium* — R$ ${preTxt}/mês`, inst)
      } else {
        state = { step: 'lead_escolha_plano', telefoneLead: digitado, segmento: state.segmento, tentativas: 0 }
        _cobrancaBotState.set(phone, state)
        await _sendWaBot(sendWA, phone, `Ainda não encontrei seu cadastro — sem problema, vamos começar! 🙌\n\nQual plano você tem interesse em assinar?\n1️⃣ *Essencial* — R$ ${essTxt}/mês\n2️⃣ *Premium* — R$ ${preTxt}/mês`, inst)
      }
      return
    }

    // ── Tenant existente escolheu o plano → gera PIX na hora e envia ──
    if (state.step === 'assinar_escolha_plano') {
      let planoEsc = null
      if (/^1|essencial/.test(txt)) planoEsc = 'essencial'
      else if (/^2|premium/.test(txt)) planoEsc = 'premium'
      if (!planoEsc) {
        await _sendWaBot(sendWA, phone, 'Não entendi 🤔 Responde só com *1* (Essencial) ou *2* (Premium).', inst)
        return
      }
      const tenant = db.prepare('SELECT * FROM tenants WHERE id=?').get(state.tenantId)
      if (!tenant) {
        _cobrancaBotState.delete(phone)
        _pausaHumano.set(pausaKey, Date.now())
        await _sendWaBot(sendWA, phone, 'Ops, tive um problema pra localizar seu cadastro. Vou te encaminhar pro atendente. 👤', inst)
        if (atendenteWa) await sendWA(atendenteWa, `⚠️ *Erro assinar plano* — tenant não encontrado (id=${state.tenantId}), cliente: ${phone}`, inst)
        return
      }
      const precos = _precosPlanosBot(db)
      const valorEsc = planoEsc === 'premium' ? precos.premium : precos.essencial
      try {
        const result = await _gerarCobrancaBotPix(ctx, tenant, { plano: planoEsc, valor: valorEsc, meses: 1 })
        const valorTxt = valorEsc.toFixed(2).replace('.', ',')
        const msg = [
          `🧾 *Assinatura Plano ${_planoSaasLabel(planoEsc)}*`,
          ``,
          `💰 *Valor:* R$ ${valorTxt}/mês`,
          ``,
          `💸 Pague via PIX com o código Copia e Cola abaixo, ou pelo QR Code que vou te enviar:`
        ].join('\n')
        await _sendWaBot(sendWA, phone, msg, inst)
        if (result.qr_code) {
          await new Promise(r => setTimeout(r, 1000))
          await _sendWaBot(sendWA, phone, result.qr_code, inst)
        }
        if (result.qr_code_base64) {
          await sendWAImage(phone, result.qr_code_base64, `📱 QR Code PIX — R$ ${valorTxt}`, inst)
        }
        if (atendenteWa) await sendWA(atendenteWa, `💳 *Assinatura solicitada via bot* — ${tenant.nome} escolheu o plano ${_planoSaasLabel(planoEsc)}${state.segmento ? ` (segmento informado: ${state.segmento})` : ''}`, inst)
      } catch (eBot) {
        log('⚠️', 'Assinar plano (bot) erro:', eBot.message)
        _pausaHumano.set(pausaKey, Date.now())
        await _sendWaBot(sendWA, phone, 'Tive um problema pra gerar o PIX agora. Vou te encaminhar pro atendente pra finalizar. 👤', inst)
        if (atendenteWa) await sendWA(atendenteWa, `⚠️ *Falha ao gerar PIX de assinatura* — tenant: ${tenant.nome}, plano: ${planoEsc}, erro: ${eBot.message}`, inst)
      }
      _cobrancaBotState.delete(phone)
      return
    }

    // ── Lead novo escolheu o plano → pede nome do estabelecimento ──
    if (state.step === 'lead_escolha_plano') {
      let planoEsc = null
      if (/^1|essencial/.test(txt)) planoEsc = 'essencial'
      else if (/^2|premium/.test(txt)) planoEsc = 'premium'
      if (!planoEsc) {
        await _sendWaBot(sendWA, phone, 'Não entendi 🤔 Responde só com *1* (Essencial) ou *2* (Premium).', inst)
        return
      }
      state = { step: 'lead_nome', telefoneLead: state.telefoneLead, segmento: state.segmento, planoEsc, tentativas: 0 }
      _cobrancaBotState.set(phone, state)
      await _sendWaBot(sendWA, phone, 'Perfeito! Só mais uma coisa — qual o nome do seu restaurante/estabelecimento?', inst)
      return
    }

    // ── Lead novo informou o nome → encaminha pro time comercial ──
    if (state.step === 'lead_nome') {
      const nomeRestaurante = texto.trim().slice(0, 120)
      _cobrancaBotState.delete(phone)
      _pausaHumano.set(pausaKey, Date.now())
      await _sendWaBot(sendWA, phone, `Perfeito, *${nomeRestaurante}*! 🎉 Um consultor do Estima Food vai te chamar por aqui em breve pra finalizar seu cadastro e liberar seu acesso. Obrigado pelo interesse! 🙌`, inst)
      if (atendenteWa) {
        await sendWA(atendenteWa, [
          `🆕 *Novo lead via bot*`,
          ``,
          `Telefone: ${phone}`,
          `Estabelecimento: ${nomeRestaurante}`,
          `Segmento: ${state.segmento || '-'}`,
          `Plano de interesse: ${_planoSaasLabel(state.planoEsc)}`,
          ``,
          `Entre em contato pra finalizar o cadastro.`
        ].join('\n'), inst)
      }
      return
    }
}

// ═══════════════════════════════════════════════════════
// HELPER: Resolve token/public_key Mercado Pago por tenant
// ═══════════════════════════════════════════════════════
// Decide qual conta MP usar seguindo a regra:
//   1. Se tenant tem mp_token próprio → usa o do tenant
//   2. Senão → usa o global (admin)
//   3. Senão → usa o do .env (MP_TOKEN)
//
// IMPORTANTE: NUNCA usar para cobranças SaaS (mensalidades,
// faturas da plataforma cobrando dos tenants). Essas DEVEM
// usar SEMPRE o global, senão o tenant pagaria a si mesmo.
// Use apenas para: PIX/cartão de pedidos do restaurante.
// ═══════════════════════════════════════════════════════
function _resolveMpForTenant(db, tenantId, MP_TOKEN_ENV) {
  const result = { mp_token: '', mp_public_key: '', source: 'none' }
  // Sanitizador defensivo: tokens podem ter sido salvos com aspas/espaços/quebras
  // de linha invisíveis em versões anteriores. Limpa SEMPRE antes de usar.
  const _clean = (s) => String(s || '')
    .replace(/^["'\s\u200B-\u200D\uFEFF]+|["'\s\u200B-\u200D\uFEFF]+$/g, '')
    .replace(/[\r\n\t]/g, '')

  // 1) Tenta tenant próprio (se tenant_id válido e não for o global)
  if (tenantId && tenantId !== '_global' && tenantId !== '_admin') {
    try {
      const row = db.prepare('SELECT ia_config FROM store_config WHERE tenant_id=?').get(tenantId)
      const ia  = row?.ia_config ? JSON.parse(row.ia_config) : {}
      const tk = _clean(ia.mp_token)
      if (tk) {
        result.mp_token      = tk
        result.mp_public_key = _clean(ia.mp_public_key)
        result.source        = 'tenant'
        return result
      }
    } catch {}
  }

  // 2) Fallback: global (admin)
  try {
    const row = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
    const g   = row?.ia_config ? JSON.parse(row.ia_config) : {}
    const tk = _clean(g.mp_token)
    if (tk) {
      result.mp_token      = tk
      result.mp_public_key = _clean(g.mp_public_key)
      result.source        = 'global'
      return result
    }
  } catch {}

  // 3) Último fallback: env
  if (MP_TOKEN_ENV) {
    result.mp_token = _clean(MP_TOKEN_ENV)
    result.source   = 'env'
  }
  return result
}

// Helper: descobre tenant_id a partir de um mp_payment_id (PIX ou cartão)
function _tenantFromPayment(db, mpPaymentId) {
  try {
    const r1 = db.prepare('SELECT tenant_id FROM pagamentos_pix WHERE mp_payment_id=?').get(String(mpPaymentId))
    if (r1?.tenant_id) return r1.tenant_id
    const r2 = db.prepare('SELECT tenant_id FROM pagamentos_cartao WHERE mp_payment_id=?').get(String(mpPaymentId))
    if (r2?.tenant_id) return r2.tenant_id
  } catch {}
  return null
}

// Helper: resolve token MP usado para CONSULTAR um pagamento existente.
// Crítico para evitar race condition: usa o mp_source GRAVADO no momento da
// criação do pagamento — não o estado ATUAL do tenant. Assim, se o gestor
// mudar a config entre a criação e a aprovação, o token continua certo.
// Retorna: { mp_token, source } | { mp_token: '', source: 'unknown' }
function _resolveMpForExistingPayment(db, mpPaymentId, MP_TOKEN_ENV) {
  try {
    let row = db.prepare('SELECT tenant_id, mp_source FROM pagamentos_pix WHERE mp_payment_id=?').get(String(mpPaymentId))
    if (!row) row = db.prepare('SELECT tenant_id, mp_source FROM pagamentos_cartao WHERE mp_payment_id=?').get(String(mpPaymentId))
    if (!row) return { mp_token: '', source: 'unknown' }

    if (row.mp_source === 'tenant' && row.tenant_id) {
      // Lê token atual do tenant — se ele removeu, fallback para global
      // (mas isso significa que o pagamento "ficou órfão". É raro e o fallback
      // pra global vai falhar 404 no MP de qualquer jeito — apenas para não
      // quebrar a chamada e o sistema mostrar status 'pendente' em vez de erro)
      const tCfg = db.prepare('SELECT ia_config FROM store_config WHERE tenant_id=?').get(row.tenant_id)
      const tIa  = tCfg?.ia_config ? JSON.parse(tCfg.ia_config) : {}
      if (tIa.mp_token) return { mp_token: tIa.mp_token, source: 'tenant' }
    }

    // mp_source = 'global' OU tenant removeu o token: usa global
    const gRow = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
    const gIa  = gRow?.ia_config ? JSON.parse(gRow.ia_config) : {}
    return { mp_token: gIa.mp_token || MP_TOKEN_ENV || '', source: 'global' }
  } catch {
    return { mp_token: MP_TOKEN_ENV || '', source: 'global' }
  }
}

// Helper exclusivo para cobranças SaaS (mensalidades) — sempre global
function _resolveMpGlobal(db, MP_TOKEN_ENV) {
  try {
    const row = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
    const g   = row?.ia_config ? JSON.parse(row.ia_config) : {}
    if (g.mp_token) return g.mp_token
  } catch {}
  return MP_TOKEN_ENV || ''
}

function _ensurePlanoAssinaturas(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plano_assinaturas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      plano TEXT NOT NULL,
      valor REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      mp_preapproval_id TEXT UNIQUE,
      mp_external_ref TEXT UNIQUE,
      payer_email TEXT,
      payment_method_id TEXT,
      last_authorized_payment_id TEXT,
      last_payment_id TEXT,
      last_payment_status TEXT,
      next_payment_at TEXT,
      started_at TEXT,
      canceled_at TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_plano_ass_tenant ON plano_assinaturas(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_plano_ass_status ON plano_assinaturas(status);
    CREATE INDEX IF NOT EXISTS idx_plano_ass_extref ON plano_assinaturas(mp_external_ref);
    CREATE INDEX IF NOT EXISTS idx_plano_ass_preapproval ON plano_assinaturas(mp_preapproval_id);
  `)
}

function _planoSaasLabel(plano) {
  if (plano === 'premium') return 'Premium'
  if (plano === 'fiscal') return 'Fiscal NFC-e'
  if (plano === 'pro') return 'Pro'
  return 'Essencial'
}

// Nome da marca exibido pro tenant conforme o segmento — açougue usa a marca
// nova (ButcherBox), os demais segmentos continuam com "Estima Food". Só usar
// isso onde o segmento do tenant já é conhecido (ex: mensagens de cobrança
// pra tenant já cadastrado) — no primeiro contato de um prospect novo, antes
// dele escolher o segmento, não dá pra saber ainda, então fica "Estima Food".
function _brandNome(segmento) {
  return segmento === 'acougue' ? 'ButcherBox' : 'Estima Food'
}

const ADMIN_FISCAL_LIMITE_PADRAO = 500
const ADMIN_FISCAL_VALOR_EXCEDENTE_PADRAO = 0.10
const ADMIN_FISCAL_PLANO_VALOR_PADRAO = 159.90

function _adminFiscalMesAtual() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function _adminFiscalMesInfo(rawMes) {
  const now = new Date()
  let mes = String(rawMes || '').trim()
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    mes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }
  const [ano, mesNum] = mes.split('-').map(Number)
  const start = `${ano}-${String(mesNum).padStart(2, '0')}-01`
  const endDate = new Date(Date.UTC(ano, mesNum, 1))
  const end = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, '0')}-01`
  return { mes, start, end }
}

function _adminFiscalNum(value, fallback) {
  const n = parseFloat(String(value ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : fallback
}

function _adminFiscalMoney(value) {
  return Math.round((parseFloat(value) || 0) * 100) / 100
}

function _adminFiscalUsoDb(db, opts = {}) {
  const mesInfo = _adminFiscalMesInfo(opts.mes)
  const limite = Math.max(0, parseInt(opts.limite ?? ADMIN_FISCAL_LIMITE_PADRAO, 10) || ADMIN_FISCAL_LIMITE_PADRAO)
  const valorExcedente = Math.max(0, _adminFiscalNum(opts.valor_excedente, ADMIN_FISCAL_VALOR_EXCEDENTE_PADRAO))
  const planoValor = Math.max(0, _adminFiscalNum(opts.plano_valor, ADMIN_FISCAL_PLANO_VALOR_PADRAO))
  const rawRows = db.prepare(`
    SELECT
      t.id, t.nome, t.slug, t.plano, t.ativo, t.expires_at,
      COALESCE(fc.enabled, 0) AS fiscal_enabled,
      COUNT(n.id) AS notas_usadas,
      COALESCE(SUM(n.total), 0) AS valor_notas
    FROM tenants t
    LEFT JOIN fiscal_config fc ON fc.tenant_id = t.id
    LEFT JOIN fiscal_nfce n ON n.tenant_id = t.id
      AND lower(COALESCE(n.status, '')) IN ('autorizado','autorizada','cancelado','cancelada')
      AND date(COALESCE(n.emitted_at, n.created_at)) >= date(?)
      AND date(COALESCE(n.emitted_at, n.created_at)) < date(?)
    WHERE COALESCE(t.slug, '') NOT IN ('_admin','_global','admin','system')
      AND COALESCE(t.id, '') NOT IN ('_admin','_global','admin','system')
    GROUP BY t.id
    ORDER BY notas_usadas DESC, t.nome COLLATE NOCASE ASC
  `).all(mesInfo.start, mesInfo.end)
  const faturas = db.prepare(`
    SELECT id, tenant_id, valor, status, link_pagamento, vence_em, created_at, obs
    FROM faturas
    WHERE plano='fiscal'
      AND COALESCE(status, '') <> 'cancelado'
      AND COALESCE(obs, '') LIKE ?
    ORDER BY id DESC
  `).all(`%NFC-e ${mesInfo.mes}%`)
  const faturaPorTenant = new Map()
  for (const f of faturas) {
    if (!faturaPorTenant.has(f.tenant_id)) faturaPorTenant.set(f.tenant_id, f)
  }
  let rows = rawRows.map(t => {
    const notasUsadas = parseInt(t.notas_usadas || 0, 10) || 0
    const excedente = Math.max(0, notasUsadas - limite)
    const valorExtra = _adminFiscalMoney(excedente * valorExcedente)
    const fiscalAtivo = t.plano === 'fiscal' || !!t.fiscal_enabled || notasUsadas > 0
    const valorTotal = fiscalAtivo ? _adminFiscalMoney(planoValor + valorExtra) : valorExtra
    const fatura = faturaPorTenant.get(t.id) || null
    return {
      tenant_id: t.id,
      nome: t.nome,
      slug: t.slug,
      plano: t.plano,
      ativo: !!t.ativo,
      fiscal_enabled: !!t.fiscal_enabled,
      fiscal_ativo: fiscalAtivo,
      notas_usadas: notasUsadas,
      valor_notas: _adminFiscalMoney(t.valor_notas),
      limite,
      excedente,
      valor_excedente: valorExcedente,
      valor_extra: valorExtra,
      plano_valor: fiscalAtivo ? planoValor : 0,
      valor_total: valorTotal,
      fatura_id: fatura?.id || null,
      fatura_status: fatura?.status || null,
      fatura_valor: fatura ? _adminFiscalMoney(fatura.valor) : null,
      fatura_link: fatura?.link_pagamento || null,
      fatura_vence_em: fatura?.vence_em || null
    }
  }).filter(r => r.fiscal_ativo || opts.incluir_todos)
  if (opts.tenant_id) rows = rows.filter(r => r.tenant_id === opts.tenant_id)
  const sum = (key) => rows.reduce((s, r) => s + (parseFloat(r[key]) || 0), 0)
  return {
    mes: mesInfo.mes,
    inicio: mesInfo.start,
    fim: mesInfo.end,
    limite,
    valor_excedente: valorExcedente,
    plano_valor: planoValor,
    total_clientes: rows.length,
    total_notas: sum('notas_usadas'),
    total_excedente: sum('excedente'),
    total_extra: _adminFiscalMoney(sum('valor_extra')),
    total_cobrar: _adminFiscalMoney(sum('valor_total')),
    rows
  }
}

function _adminFiscalObs(uso, row, prefix = '') {
  const partes = []
  if (prefix) partes.push(prefix)
  partes.push(
    `NFC-e ${uso.mes}`,
    `usadas=${row.notas_usadas}`,
    `limite=${row.limite}`,
    `excedente=${row.excedente}`,
    `extra=${row.valor_extra.toFixed(2)}`,
    `plano=${row.plano_valor.toFixed(2)}`,
    `total=${row.valor_total.toFixed(2)}`
  )
  return partes.join(' | ')
}

function _adminFiscalCobrancaAtual(db, tenantId, opts = {}) {
  const uso = _adminFiscalUsoDb(db, {
    tenant_id: tenantId,
    mes: opts.mes || _adminFiscalMesAtual(),
    limite: opts.limite,
    valor_excedente: opts.valor_excedente,
    plano_valor: opts.plano_valor,
    incluir_todos: true
  })
  const row = uso.rows[0] || null
  return { uso, row, valor: row ? _adminFiscalMoney(row.valor_total) : 0, obs: row ? _adminFiscalObs(uso, row, opts.prefix || '') : '' }
}

function _baseUrlFromReq(req) {
  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()
  if (!rawHost) return ''
  const rawProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  const proto = rawProto || (/^(localhost|127\.0\.0\.1)(:|$)/i.test(rawHost) ? 'http' : 'https')
  return `${proto}://${rawHost}`
}

function _assinaturaAtiva(status) {
  const s = String(status || '').toLowerCase()
  return ['authorized', 'pending', 'paused'].includes(s)
}

function _parseDateOnlyLocal(value) {
  if (!value) return null
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function _dateOnlyISO(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function _addCalendarMonths(date, months) {
  const base = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date()
  const day = base.getDate()
  const target = new Date(base.getFullYear(), base.getMonth() + months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(day, lastDay))
  return target
}

function _renovarPlanoSaas(db, tenantId, plano, meses = 1) {
  const tenant = db.prepare('SELECT * FROM tenants WHERE id=?').get(tenantId)
  if (!tenant) return null
  const hoje = new Date()
  hoje.setHours(0,0,0,0)
  const atual = _parseDateOnlyLocal(tenant.expires_at)
  const base = atual && !Number.isNaN(atual.getTime()) && atual > hoje ? atual : hoje
  const novaExpISO = _dateOnlyISO(_addCalendarMonths(base, parseInt(meses) || 1))
  const planoNovo = ['premium','essencial','pro','fiscal'].includes(plano) ? plano : (tenant.plano || 'essencial')
  db.prepare("UPDATE tenants SET plano=?, expires_at=?, ativo=1, updated_at=datetime('now') WHERE id=?")
    .run(planoNovo, novaExpISO, tenantId)
  return { tenant, plano: planoNovo, expires_at: novaExpISO }
}

function _upsertAssinaturaPreapproval(db, tenantId, plano, valor, pre, extRef, email, paymentMethodId) {
  _ensurePlanoAssinaturas(db)
  const preId = pre?.id ? String(pre.id) : ''
  const status = pre?.status || 'pending'
  const nextPayment = pre?.next_payment_date || pre?.auto_recurring?.start_date || null
  const metodo = pre?.payment_method_id || paymentMethodId || ''
  const existente = preId
    ? db.prepare('SELECT id FROM plano_assinaturas WHERE mp_preapproval_id=?').get(preId)
    : null
  if (existente) {
    db.prepare(`UPDATE plano_assinaturas
      SET plano=?, valor=?, status=?, mp_external_ref=?, payer_email=?, payment_method_id=?,
          next_payment_at=?, started_at=COALESCE(started_at, ?), updated_at=datetime('now')
      WHERE id=?`)
      .run(plano, valor, status, extRef || pre?.external_reference || '', email || pre?.payer_email || '',
        metodo, nextPayment, pre?.date_created || new Date().toISOString(), existente.id)
    return db.prepare('SELECT * FROM plano_assinaturas WHERE id=?').get(existente.id)
  }
  const info = db.prepare(`INSERT INTO plano_assinaturas
    (tenant_id, plano, valor, status, mp_preapproval_id, mp_external_ref, payer_email,
     payment_method_id, next_payment_at, started_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(tenantId, plano, valor, status, preId, extRef || pre?.external_reference || '', email || pre?.payer_email || '',
      metodo, nextPayment, pre?.date_created || new Date().toISOString())
  return db.prepare('SELECT * FROM plano_assinaturas WHERE id=?').get(info.lastInsertRowid)
}

function _localizarAssinaturaMp(db, { preapprovalId = '', externalRef = '' } = {}) {
  _ensurePlanoAssinaturas(db)
  let row = null
  if (preapprovalId) {
    row = db.prepare('SELECT * FROM plano_assinaturas WHERE mp_preapproval_id=?').get(String(preapprovalId))
  }
  if (!row && externalRef) {
    row = db.prepare('SELECT * FROM plano_assinaturas WHERE mp_external_ref=?').get(String(externalRef))
  }
  return row
}

function _processarCobrancaAssinatura(db, log, marcarDirty, ass, paymentId, paymentStatus, paymentDate, authorizedPaymentId = '') {
  if (!ass) return null
  const statusRaw = String(paymentStatus || '').toLowerCase()
  const aprovado = statusRaw === 'approved' || statusRaw === 'aprovado'
  const idPagamento = paymentId ? String(paymentId) : ''

  if (!aprovado || !idPagamento) {
    db.prepare(`UPDATE plano_assinaturas
      SET last_authorized_payment_id=COALESCE(?, last_authorized_payment_id),
          last_payment_id=COALESCE(?, last_payment_id),
          last_payment_status=?,
          updated_at=datetime('now')
      WHERE id=?`)
      .run(authorizedPaymentId || null, idPagamento || null, statusRaw || '', ass.id)
    marcarDirty()
    return { renewed: false, status: statusRaw }
  }
  if (ass.last_payment_id && String(ass.last_payment_id) === idPagamento) {
    return { renewed: false, status: statusRaw, duplicate: true }
  }

  db.prepare(`UPDATE plano_assinaturas
    SET last_authorized_payment_id=COALESCE(?, last_authorized_payment_id),
        last_payment_status=?,
        updated_at=datetime('now')
    WHERE id=?`)
    .run(authorizedPaymentId || null, statusRaw || '', ass.id)

  const renovado = _renovarPlanoSaas(db, ass.tenant_id, ass.plano, 1)
  if (!renovado) return { renewed: false, status: statusRaw }
  db.prepare(`UPDATE plano_assinaturas
    SET status=CASE WHEN status='pending' THEN 'authorized' ELSE status END,
        last_payment_id=?, last_payment_status='approved', updated_at=datetime('now')
    WHERE id=?`)
    .run(idPagamento, ass.id)
  marcarDirty()
  log('OK', `ASSINATURA PLANO PAGA: tenant=${ass.tenant_id} plano=${renovado.plano} vencimento=${renovado.expires_at} mp_payment=${idPagamento}`)
  return { renewed: true, status: statusRaw, expires_at: renovado.expires_at, plano: renovado.plano }
}

// ═══════════════════════════════════════════════════════
// CRON DIÁRIO: auto-cobrança 3 dias antes de vencer
// ═══════════════════════════════════════════════════════
// Preço promocional/personalizado (valor_mensalidade) com validade: quando
// valor_mensalidade_expira_em vence, o tenant volta a pagar o valor geral do
// plano automaticamente (silencioso, sem notificar ninguém).
function _expirarPromocoesVencidas(db, log) {
  try {
    const info = db.prepare(`
      UPDATE tenants SET valor_mensalidade=NULL, valor_mensalidade_expira_em=NULL
      WHERE valor_mensalidade IS NOT NULL
        AND valor_mensalidade_expira_em IS NOT NULL
        AND date(valor_mensalidade_expira_em) < date('now')
    `).run()
    if (info.changes > 0) log('💰', `${info.changes} preço(s) promocional(is) vencido(s) revertido(s) para o valor geral`)
    return info.changes
  } catch (e) { log?.('⚠️', 'Falha ao expirar promoções vencidas:', e.message); return 0 }
}

let _autoCobrancaJobIniciado = false
// Cria (ou substitui) o aviso do "robô" na lateral do gestor avisando que a
// fatura dele está vencendo. Usa tipo='robo_fatura' como marcador interno
// (não aparece no seletor manual do admin) pra sempre existir só UM desse
// tipo por tenant — se já tiver um de uma cobrança anterior, apaga antes de
// criar o novo, em vez de empilhar avisos repetidos.
function _upsertRoboFaturaAlert(db, sseBroadcast, tenantId, { planoNome, valorTxt, venceEmTxt }) {
  try {
    db.prepare("DELETE FROM admin_alerts WHERE tipo='robo_fatura' AND target_tenants LIKE ?").run(`%"${tenantId}"%`)
    const cfgG = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
    const iaG = cfgG?.ia_config ? JSON.parse(cfgG.ia_config) : {}
    const ctaWhatsapp = String(iaG.whatsapp_robo || '').replace(/\D/g, '')
    const titulo = 'Fatura chegando! 🧾'
    const mensagem = `Sua mensalidade do plano ${planoNome} vence em ${venceEmTxt} — valor R$ ${valorTxt}. Já mandei o PIX aqui no WhatsApp, mas se preferir resolver por aqui também dá!`
    const info = db.prepare(`
      INSERT INTO admin_alerts (tipo,titulo,mensagem,display_mode,bg_color,text_color,font_family,cta_label,cta_whatsapp,target_all,target_tenants,ativo,created_by,expires_at,created_at,updated_at)
      VALUES ('robo_fatura',?,?,'robo','#f59e0b','#ffffff','outfit',?,?,0,?,1,'sistema',NULL,datetime('now'),datetime('now'))
    `).run(titulo, mensagem, ctaWhatsapp ? 'Falar sobre o pagamento' : '', ctaWhatsapp, JSON.stringify([String(tenantId)]))
    const row = db.prepare('SELECT * FROM admin_alerts WHERE id=?').get(info.lastInsertRowid)
    if (sseBroadcast) sseBroadcast(`admin-alerts:${tenantId}`, 'admin_alerts:REFRESH', { id: row.id, action: 'insert', ts: Date.now() })
  } catch(e) { /* aviso do robô é cosmético — nunca deve travar a cobrança de verdade por causa disso */ }
}

// Remove o robô de "fatura vencendo" desse tenant assim que o pagamento é
// confirmado — não faz sentido continuar avisando depois que já foi pago.
function _limparRoboFaturaAlert(db, sseBroadcast, tenantId) {
  try {
    const changed = db.prepare("DELETE FROM admin_alerts WHERE tipo='robo_fatura' AND target_tenants LIKE ?").run(`%"${tenantId}"%`)
    if (changed.changes > 0 && sseBroadcast) sseBroadcast(`admin-alerts:${tenantId}`, 'admin_alerts:REFRESH', { action: 'delete', ts: Date.now() })
  } catch(e) {}
}

function _iniciarAutoCobrancaJob(ctx) {
  if (_autoCobrancaJobIniciado) return
  _autoCobrancaJobIniciado = true
  const { db, log, MP_TOKEN, EVO_URL, EVO_KEY, EVO_INST, sendWA, sendWAImage, marcarDirty, sseBroadcast } = ctx
  log('🔄', 'Auto-cobrança job iniciado (intervalo: 6h)')

  async function tick() {
    try {
      // Só dispara em horário comercial, às 9h de Brasília — antes o job
      // rodava a cada 6h desde o boot do servidor, sem horário fixo, e
      // podia mandar a cobrança de madrugada. O intervalo ficou mais curto
      // (30min) só pra não perder a janela das 9h; a checagem de fatura já
      // pendente (mais abaixo) evita mandar a mensagem mais de uma vez no
      // mesmo dia mesmo rodando várias vezes dentro da mesma hora.
      const horaBrasilia = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getHours()
      if (horaBrasilia !== 9) return

      // Reverte preços promocionais/personalizados vencidos para o valor geral
      _expirarPromocoesVencidas(db, log)

      // Lê preços globais
      let precoEss = 79.99, precoPre = 99.90, precoFiscal = 159.90, precoAddonVoz = 89.90
      try {
        const c = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
        const g = c?.ia_config ? JSON.parse(c.ia_config) : {}
        if (g.preco_essencial !== undefined) precoEss = parseFloat(g.preco_essencial)
        if (g.preco_premium   !== undefined) precoPre = parseFloat(g.preco_premium)
        if (g.preco_addon_voz !== undefined) precoAddonVoz = parseFloat(g.preco_addon_voz)
      } catch {}

      // Token MP — SEMPRE GLOBAL (cobrança SaaS da plataforma)
      // NÃO usar _resolveMpForTenant: é a plataforma cobrando do tenant,
      // dinheiro tem que cair na conta da plataforma, não na do tenant.
      const mpToken = _resolveMpGlobal(db, MP_TOKEN)
      if (!mpToken) return // sem token, pula silenciosamente

      // Tenants ativos vencendo em 2 dias (janela: hoje+1 a hoje+2 para evitar perder por timing do job)
      const tenants = db.prepare(`
        SELECT * FROM tenants
        WHERE ativo=1
          AND slug NOT IN ('_admin','_global','admin')
          AND expires_at IS NOT NULL
          AND date(expires_at) BETWEEN date('now','+1 days') AND date('now','+2 days')
      `).all()
      if (!tenants.length) return

      let geradas = 0
      for (const t of tenants) {
        // Já existe fatura pendente recente para este tenant? (evita duplicar)
        const ja = db.prepare(`
          SELECT id, plano, valor FROM faturas
          WHERE tenant_id=? AND status='pendente'
            AND created_at > datetime('now','-7 days')
          LIMIT 1
        `).get(t.id)
        let faturaSubstituidaAuto = null
        if (ja) {
          if (t.plano === 'fiscal' && ja.plano === 'fiscal') {
            const fiscalAtual = _adminFiscalCobrancaAtual(db, t.id, {
              mes: _adminFiscalMesAtual(),
              plano_valor: precoFiscal
            })
            const valorAtual = fiscalAtual.row ? fiscalAtual.valor : precoFiscal
            if (Math.abs((parseFloat(ja.valor) || 0) - valorAtual) >= 0.01) {
              faturaSubstituidaAuto = ja
            } else {
              continue
            }
          } else {
            continue
          }
        }

        try {
          const plano = (t.plano === 'premium') ? 'premium' : (t.plano === 'fiscal' ? 'fiscal' : 'essencial')
          let valor = (plano === 'premium') ? precoPre : (plano === 'fiscal' ? precoFiscal : precoEss)
          // Preço individual do tenant (promoção/desconto) tem prioridade sobre o preço do plano
          if (plano !== 'fiscal' && t.valor_mensalidade !== null && t.valor_mensalidade !== undefined) {
            valor = parseFloat(t.valor_mensalidade)
          }
          // Add-on de pedido por voz (WhatsApp) — soma ao valor do plano quando
          // ativado pelo admin pra este tenant, independente do plano/promoção.
          if (t.voz_ativo) valor += precoAddonVoz
          let obsFatura = 'Gerada automaticamente (2 dias antes do vencimento)'
          if (plano === 'fiscal') {
            const fiscal = _adminFiscalCobrancaAtual(db, t.id, {
              mes: _adminFiscalMesAtual(),
              plano_valor: precoFiscal,
              prefix: obsFatura
            })
            if (fiscal.row) {
              valor = fiscal.valor
              obsFatura = fiscal.obs
            }
          }
          const _valorMp1 = _mpValor(valor)
          if (_valorMp1 === null) { log('⚠️', `Auto-cobrança ${t.id}: valor inválido (${valor})`); continue }
          const extRef = `auto-${t.id.slice(0,8)}-${plano}-${Date.now()}`
          const descricao = `Renovação Plano ${_planoSaasLabel(plano)} — ${t.nome}`

          const mpResp = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${mpToken}`, 'X-Idempotency-Key': extRef },
            body: JSON.stringify({
              transaction_amount: _valorMp1,
              description: descricao,
              payment_method_id: 'pix',
              external_reference: extRef,
              date_of_expiration: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().replace('Z', '-03:00'),
              payer: { email: 'cobranca@estimafood.com', first_name: t.nome.split(' ')[0] || 'Cliente' }
            })
          })
          const mpData = await mpResp.json()
          if (!mpResp.ok) { log('⚠️', `Auto-cobrança falhou tenant=${t.nome}: ${mpData.message || 'erro MP'}`); continue }

          const venceEm = t.expires_at // vencimento real do plano — não a validade técnica do Pix acima
          const link = mpData.point_of_interaction?.transaction_data?.ticket_url || null
          const qr   = mpData.point_of_interaction?.transaction_data?.qr_code || null
          const qrB64= mpData.point_of_interaction?.transaction_data?.qr_code_base64 || null

          const info = db.prepare(`INSERT INTO faturas
            (tenant_id, plano, valor, meses, metodo, status, link_pagamento, mp_payment_id, mp_external_ref, qr_code, qr_code_base64, vence_em, obs)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
              t.id, plano, parseFloat(valor), 1, 'pix', 'pendente',
              link, String(mpData.id), extRef, qr, qrB64, venceEm,
              obsFatura
            )
          const fatura = db.prepare('SELECT * FROM faturas WHERE id=?').get(info.lastInsertRowid)
          if (faturaSubstituidaAuto) {
            db.prepare(`UPDATE faturas
              SET status='cancelado',
                  cancelado_em=datetime('now'),
                  obs=TRIM(COALESCE(obs, '') || ' | substituida_por=' || ?)
              WHERE id=? AND status<>'pago'`).run(String(fatura.id), faturaSubstituidaAuto.id)
          }
          marcarDirty()

          // Robô na lateral do gestor avisando da fatura — independente de
          // ter telefone de cobrança configurado ou não (o WA abaixo é outro
          // canal, este aqui é o aviso dentro do próprio painel).
          _upsertRoboFaturaAlert(db, sseBroadcast, t.id, {
            planoNome: _planoSaasLabel(plano),
            valorTxt: parseFloat(valor).toFixed(2).replace('.', ','),
            venceEmTxt: new Date(venceEm + 'T00:00:00').toLocaleDateString('pt-BR')
          })

          // Manda WA — prioriza o telefone de cobrança cadastrado no super admin;
          // se não houver, cai pro WhatsApp da loja (store_config)
          try {
            let telefone = t.telefone_cobranca ? String(t.telefone_cobranca).replace(/\D/g, '') : null
            if (!telefone) {
              const cfg = db.prepare('SELECT store_whatsapp FROM store_config WHERE tenant_id=?').get(t.id)
              if (cfg?.store_whatsapp) telefone = String(cfg.store_whatsapp).replace(/\D/g, '')
            }
            if (telefone && (telefone.length === 11 || telefone.length === 10)) telefone = '55' + telefone
            if (telefone) {
              const valorTxt = parseFloat(valor).toFixed(2).replace('.', ',')
              const planoNome = _planoSaasLabel(plano)
              // venceEm (linha acima) já é o vencimento real do plano — usa
              // direto, com o mesmo truque de T00:00:00 pra não deslocar
              // o dia por causa do fuso horário do servidor.
              const venceEmTxt = new Date(venceEm + 'T00:00:00').toLocaleDateString('pt-BR')
              const msg = [
                `🧾 *Lembrete: sua mensalidade vence em breve*`,
                ``,
                `Olá, *${t.nome}*! Seu plano *${planoNome}* do ${_brandNome(t.segmento)} vence em *2 dias*.`,
                ``,
                `💰 *Valor:* R$ ${valorTxt}`,
                `⏰ *Pague até:* ${venceEmTxt}`,
                ``,
                `💸 *Pague agora via PIX* — escaneie o QR Code que vou te enviar ou use o código Copia e Cola abaixo:`,
                ``,
                `_O pagamento renova seu acesso automaticamente._ ✅`,
                ``,
                `⚠️ *Atenção:* se o pagamento não for feito até ${venceEmTxt}, o acesso ao sistema será suspenso.`
              ].join('\n')
              const instCob = _getInstanciaCobranca(db, EVO_INST)
              await sendWA(telefone, msg, instCob)
              if (qr) {
                await new Promise(r => setTimeout(r, 1000))
                await sendWA(telefone, qr, instCob) // mensagem separada — facilita copiar o código
              }
              if (qrB64) {
                await sendWAImage(telefone, qrB64, `📱 QR Code PIX — R$ ${valorTxt}`, instCob)
              }
            }
          } catch (eWa) { log('⚠️', `Auto-cobrança WA falhou tenant=${t.nome}: ${eWa.message}`) }

          geradas++
        } catch (e) {
          log('⚠️', `Auto-cobrança erro tenant=${t.nome}:`, e.message)
        }
      }
      if (geradas) log('✅', `Auto-cobrança: ${geradas} fatura(s) gerada(s) automaticamente`)
    } catch (e) { log('⚠️', 'Auto-cobrança job erro geral:', e.message) }
  }

  // Roda 1x ao iniciar (após 5min para não atrasar startup) e depois a cada
  // 30min — o próprio tick() decide não fazer nada fora das 9h de Brasília.
  setTimeout(tick, 5 * 60_000)
  setInterval(tick, 30 * 60_000)
}

module.exports = async function handleRoutes(req, res, ctx) {
  const { upath, params, db, send, readBody, log, sseBroadcast, marcarDirty,
          validarSessaoAdmin, criarSessaoAdmin, validarSessaoGestor, criarSessaoGestor, criarSessaoGarcom,
          hashPassword, verifyPassword, precisaMigrarHash, checkRateLimit, clientIp,
          loginRateLimited, registrarLoginFalho,
          validarFinanceAccess, fazerBackup, restaurarBackup, enviarBackupTelegram, TABELAS_BACKUP, getTenantId,
          MP_TOKEN, TAXA_PIX, BACKUP_PATH, UPLOADS_DIR,
          EVO_URL, EVO_KEY, EVO_INST, sendWA, sendWAImage, fillVars, sleep, checarAniv, handleIAWebhook, _pausaHumano,
          aplicarBaixaEstoquePedido,
          chatNormalizePhone, chatPhoneMatches, chatStatusLabel, chatOrderPublic, chatThreadPublic, chatMessagePublic,
          chatEnsureThreadFromOrder, chatEnsureThreadFromLead, chatAddMessageFromOrder, chatAddMessageToThread,
          deliveryPausaAtiva,
          emit } = ctx

  const INDICADOR_SESSION_TTL = 8 * 60 * 60 * 1000
  const criarSessaoIndicador = (ind) => {
    const token = crypto.randomBytes(32).toString('hex')
    const ts = Date.now()
    db.prepare('DELETE FROM indicador_sessions WHERE ts < ?').run(ts - INDICADOR_SESSION_TTL)
    db.prepare(`INSERT OR REPLACE INTO indicador_sessions
      (token, indicador_id, nome, email, codigo, ts) VALUES (?,?,?,?,?,?)`)
      .run(token, ind.id, ind.nome, ind.email, ind.codigo, ts)
    return token
  }
  const validarSessaoIndicador = (req) => {
    const auth = req.headers['authorization'] || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (!token) return null
    const s = db.prepare('SELECT * FROM indicador_sessions WHERE token=?').get(token)
    if (!s) return null
    if (Date.now() - s.ts > INDICADOR_SESSION_TTL) {
      db.prepare('DELETE FROM indicador_sessions WHERE token=?').run(token)
      return null
    }
    return s
  }
  const requireFinanceAccess = (tid) => {
    if (typeof validarFinanceAccess === 'function' && validarFinanceAccess(req, tid)) return true
    send(res, 403, { error: 'FINANCE_LOCKED', message: 'Area financeira bloqueada. Informe a senha do gestor.' })
    return false
  }
  const _safeJson = (v, fallback) => {
    try {
      if (Array.isArray(v) || (v && typeof v === 'object')) return v
      return v ? JSON.parse(v) : fallback
    } catch { return fallback }
  }
  const _parseAdminAlert = (row) => {
    if (!row) return row
    return {
      ...row,
      display_mode: ['banner','popup','both','robo'].includes(String(row.display_mode || '').toLowerCase()) ? String(row.display_mode).toLowerCase() : 'banner',
      bg_color: String(row.bg_color || '').trim(),
      text_color: String(row.text_color || '').trim(),
      font_family: String(row.font_family || '').trim() || 'outfit',
      cta_label: String(row.cta_label || '').trim(),
      cta_whatsapp: String(row.cta_whatsapp || '').trim(),
      target_all: row.target_all === 1 || row.target_all === true,
      ativo: row.ativo === 1 || row.ativo === true,
      target_tenants: _safeJson(row.target_tenants, [])
    }
  }
  const _alertTargetIds = (row) => {
    const ids = _safeJson(row?.target_tenants, [])
    return Array.isArray(ids) ? ids.map(String).filter(Boolean) : []
  }
  const _brNowWallClockMs = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getTime()
  const _brWallClockMs = (value) => {
    const t = new Date(String(value || '').replace(' ', 'T')).getTime()
    return Number.isFinite(t) ? t : null
  }
  const _broadcastAdminAlerts = (row, action = 'refresh', previous = null) => {
    const payload = { id: row?.id || previous?.id || null, action, ts: Date.now() }
    if (row?.target_all || previous?.target_all) sseBroadcast('admin-alerts:all', 'admin_alerts:REFRESH', payload)
    const ids = new Set([..._alertTargetIds(row), ..._alertTargetIds(previous)])
    ids.forEach(tid => sseBroadcast(`admin-alerts:${tid}`, 'admin_alerts:REFRESH', payload))
  }

  const _fiscalTenantId = () => req.headers['x-tenant-id'] || params.get('tenant_id') || params.get('_tenant') || ''
  const _fiscalJson = (v, fallback) => {
    try {
      if (Array.isArray(v) || (v && typeof v === 'object')) return v
      return v ? JSON.parse(v) : fallback
    } catch { return fallback }
  }
  const _fiscalDigits = (v) => String(v || '').replace(/\D/g, '')
  const _fiscalText = (v, max = 120) => String(v || '').trim().slice(0, max)
  const _fiscalNorm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const _fiscalMoney = (v) => Math.round((parseFloat(v) || 0) * 100) / 100
  const _fiscalMoneyStr = (v) => _fiscalMoney(v).toFixed(2)
  const _fiscalIsoNowBR = () => {
    const d = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}-03:00`
  }
  const _fiscalDateRange = (body = {}) => {
    const today = _brasiliaDateString ? _brasiliaDateString() : new Date().toISOString().slice(0, 10)
    const de = String(body.de || params.get('de') || today).slice(0, 10)
    const ate = String(body.ate || params.get('ate') || de).slice(0, 10)
    return { de, ate, start: `${de} 00:00:00`, end: `${ate} 23:59:59` }
  }
  const _fiscalPagamentoFiltro = (value) => {
    const n = _fiscalNorm(value).replace(/[^a-z0-9_ -]/g, '').trim()
    if (!n || n === 'todos' || n === 'all') return ''
    if (n.includes('credito') || n === 'cartao' || n === 'cartao_credito') return 'credito'
    if (n.includes('debito') || n === 'cartao_debito') return 'debito'
    if (n.includes('pix')) return 'pix'
    if (n.includes('dinheiro')) return 'dinheiro'
    return n
  }
  const _fiscalPagamentoLabel = (filtro) => ({
    credito: 'Cartao de credito',
    debito: 'Cartao de debito',
    pix: 'PIX',
    dinheiro: 'Dinheiro'
  }[filtro] || '')
  const _fiscalOrderMatchesPagamento = (order, filtro) => {
    if (!filtro) return true
    const p = _fiscalNorm(order?.pag || order?.forma_pagamento || order?.payment_method || '')
    if (filtro === 'credito') return p.includes('credito') || p.includes('cartao') || p.includes('card')
    if (filtro === 'debito') return p.includes('debito')
    if (filtro === 'pix') return p.includes('pix')
    if (filtro === 'dinheiro') return p.includes('dinheiro')
    return p === filtro
  }
  const _fiscalMask = (v) => {
    const s = String(v || '')
    if (!s) return ''
    return s.length <= 6 ? '******' : `${'*'.repeat(Math.max(4, s.length - 4))}${s.slice(-4)}`
  }
  const _fiscalConfigOut = (row) => {
    const out = { ...(row || {}) }
    out.enabled = out.enabled === 1 || out.enabled === true
    out.token_homologacao_set = !!out.token_homologacao
    out.token_producao_set = !!out.token_producao
    out.csc_token_set = !!out.csc_token
    out.token_homologacao_mask = _fiscalMask(out.token_homologacao)
    out.token_producao_mask = _fiscalMask(out.token_producao)
    out.csc_token_mask = _fiscalMask(out.csc_token)
    delete out.token_homologacao
    delete out.token_producao
    delete out.csc_token
    return out
  }
  const _fiscalEnsureConfig = (tid) => {
    db.prepare('INSERT OR IGNORE INTO fiscal_config (tenant_id, ambiente, emit_mode, uf_emitente, cfop_padrao, icms_origem_padrao, icms_situacao_padrao, unidade_padrao, natureza_operacao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(tid, 'homologacao', 'fechamento', 'CE', '5102', '0', '102', 'UN', 'VENDA AO CONSUMIDOR')
    return db.prepare('SELECT * FROM fiscal_config WHERE tenant_id=?').get(tid)
  }
  const _fiscalNoteOut = (row) => {
    if (!row) return row
    const out = { ...row }
    out.total = _fiscalMoney(out.total)
    out.payload_json = _fiscalJson(out.payload_json, {})
    out.response_json = _fiscalJson(out.response_json, {})
    return out
  }
  const _fiscalFormaCodigo = (forma) => {
    const n = _fiscalNorm(forma)
    if (n.includes('dinheiro')) return '01'
    if (n.includes('debito')) return '04'
    if (n.includes('credito') || n.includes('cartao') || n.includes('card')) return '03'
    if (n.includes('pix')) return '17'
    if (n.includes('cheque')) return '02'
    if (n.includes('alimentacao')) return '10'
    if (n.includes('refeicao')) return '11'
    if (n.includes('presente')) return '12'
    if (n.includes('combustivel')) return '13'
    return '99'
  }
  const _fiscalPagamentoItem = (forma, valor) => {
    const codigo = _fiscalFormaCodigo(forma)
    const item = {
      forma_pagamento: codigo,
      valor_pagamento: _fiscalMoneyStr(valor)
    }
    if (codigo === '03' || codigo === '04') item.tipo_integracao = '2'
    return item
  }
  const _fiscalBuildPagamentos = (forma, total, formas) => {
    if (Array.isArray(formas) && formas.length) {
      const rows = formas
        .map(f => _fiscalPagamentoItem(f.forma || f.label || forma || 'PIX', f.valor))
        .filter(f => _fiscalMoney(f.valor_pagamento) > 0)
      if (rows.length) return rows
    }
    return [_fiscalPagamentoItem(forma || 'PIX', total)]
  }
  const _fiscalOrderItems = (orders) => {
    const out = []
    for (const order of orders || []) {
      const itens = _fiscalJson(order.items, [])
      for (const item of itens) {
        const status = String(item?.item_status || '').toLowerCase()
        if (status === 'cancelado') continue
        if (String(item?.item_type || '').toLowerCase() === 'taxa' || item?.isTaxa) continue
        const qty = parseFloat(item?.qty || item?.quantidade || 1) || 1
        const price = parseFloat(item?.price ?? item?.valor ?? item?.unit_price ?? 0) || 0
        if (qty <= 0 || price <= 0) continue
        out.push({
          order_id: order.id,
          id: item.id || item.item_id || null,
          name: item.name || item.nome || 'Item',
          qty,
          price,
          obs: item.obs || ''
        })
      }
    }
    return out
  }
  const _fiscalRef = (tid, tipo, origemId) => {
    const raw = `${tipo}-${tid}-${origemId}`
    const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 10)
    return `ef-${tipo}-${String(origemId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 18)}-${hash}`.slice(0, 60)
  }
  const _fiscalBuildPayload = (tid, orders, cfg, opts = {}) => {
    const cnpj = _fiscalDigits(cfg.cnpj_emitente)
    if (!cnpj) throw new Error('Configure o CNPJ emitente no Fiscal.')
    const itensBase = _fiscalOrderItems(orders)
    if (!itensBase.length) throw new Error('Venda sem itens fiscais para emitir NFC-e.')

    const ids = [...new Set(itensBase.map(i => parseInt(i.id)).filter(Boolean))]
    const fiscalRows = ids.length
      ? db.prepare(`SELECT id,fiscal_ncm,fiscal_cfop,fiscal_icms_origem,fiscal_icms_situacao,fiscal_cest,fiscal_unidade,fiscal_codigo_produto,fiscal_pis_situacao,fiscal_cofins_situacao FROM menu_items WHERE tenant_id=? AND id IN (${ids.map(()=>'?').join(',')})`).all(tid, ...ids)
      : []
    const fiscalMap = new Map(fiscalRows.map(r => [Number(r.id), r]))
    const gross = itensBase.reduce((s, i) => s + i.qty * i.price, 0)
    const orderTotal = _fiscalMoney(opts.total || (orders || []).reduce((s, o) => s + (parseFloat(o.total) || 0), 0) || gross)
    const target = orderTotal > 0 && orderTotal <= gross + 0.02 ? orderTotal : _fiscalMoney(gross)
    const discountTotal = Math.max(0, _fiscalMoney(gross - target))
    const discountRate = gross > 0 ? discountTotal / gross : 0

    let itemSeq = 0
    let itemDiscountAcc = 0
    const items = itensBase.map((it, idx) => {
      const row = fiscalMap.get(Number(it.id)) || {}
      const ncm = _fiscalDigits(row.fiscal_ncm || cfg.ncm_padrao)
      if (!/^\d{8}$/.test(ncm)) {
        throw new Error(`Produto "${it.name}" sem NCM fiscal valido. Preencha o NCM no cadastro ou o NCM padrao.`)
      }
      const bruto = _fiscalMoney(it.qty * it.price)
      let desconto = _fiscalMoney(bruto * discountRate)
      if (idx === itensBase.length - 1) desconto = _fiscalMoney(discountTotal - itemDiscountAcc)
      itemDiscountAcc = _fiscalMoney(itemDiscountAcc + desconto)
      const unidade = _fiscalText(row.fiscal_unidade || cfg.unidade_padrao || 'UN', 6).toUpperCase()
      itemSeq += 1
      const out = {
        numero_item: String(itemSeq),
        codigo_produto: _fiscalText(row.fiscal_codigo_produto || it.id || `EF${itemSeq}`, 60),
        descricao: _fiscalText(it.name, 120),
        codigo_ncm: ncm,
        cfop: _fiscalText(row.fiscal_cfop || cfg.cfop_padrao || '5102', 4),
        unidade_comercial: unidade,
        unidade_tributavel: unidade,
        quantidade_comercial: _fiscalMoneyStr(it.qty),
        quantidade_tributavel: _fiscalMoneyStr(it.qty),
        valor_unitario_comercial: _fiscalMoneyStr(it.price),
        valor_unitario_tributavel: _fiscalMoneyStr(it.price),
        valor_desconto: _fiscalMoneyStr(desconto),
        icms_origem: _fiscalText(row.fiscal_icms_origem || cfg.icms_origem_padrao || '0', 1),
        icms_situacao_tributaria: _fiscalText(row.fiscal_icms_situacao || cfg.icms_situacao_padrao || '102', 3),
        valor_total_tributos: '0.00'
      }
      if (row.fiscal_cest) out.cest = _fiscalDigits(row.fiscal_cest)
      if (row.fiscal_pis_situacao) out.pis_situacao_tributaria = _fiscalText(row.fiscal_pis_situacao, 2)
      if (row.fiscal_cofins_situacao) out.cofins_situacao_tributaria = _fiscalText(row.fiscal_cofins_situacao, 2)
      return out
    })

    const payload = {
      cnpj_emitente: cnpj,
      data_emissao: _fiscalIsoNowBR(),
      indicador_inscricao_estadual_destinatario: '9',
      modalidade_frete: '9',
      local_destino: '1',
      presenca_comprador: opts.presenca_comprador || (/delivery|entrega/i.test(String(orders?.[0]?.addr || '')) ? '4' : '1'),
      natureza_operacao: _fiscalText(cfg.natureza_operacao || 'VENDA AO CONSUMIDOR', 60),
      tipo_documento: '1',
      finalidade_emissao: '1',
      valor_produtos: _fiscalMoneyStr(gross),
      valor_total: _fiscalMoneyStr(target),
      items,
      formas_pagamento: _fiscalBuildPagamentos(opts.forma || orders?.[0]?.pag || 'PIX', target, opts.formas)
    }
    const emitenteFields = [
      'nome_emitente','nome_fantasia_emitente','telefone_emitente','logradouro_emitente','numero_emitente',
      'bairro_emitente','municipio_emitente','uf_emitente','cep_emitente','inscricao_estadual_emitente',
      'regime_tributario_emitente'
    ]
    for (const f of emitenteFields) {
      const v = cfg[f]
      if (!v && f !== 'uf_emitente') continue
      payload[f] = f === 'cep_emitente' || f === 'telefone_emitente' ? _fiscalDigits(v) : _fiscalText(v, 120)
    }
    return { payload, total: target }
  }
  const _fiscalCreatePending = (tid, origemTipo, origemId, orders, opts = {}) => {
    const existing = db.prepare('SELECT * FROM fiscal_nfce WHERE tenant_id=? AND origem_tipo=? AND origem_id=? LIMIT 1').get(tid, origemTipo, String(origemId))
    if (existing) return { row: existing, created: false }
    const cfg = _fiscalEnsureConfig(tid)
    const built = _fiscalBuildPayload(tid, orders, cfg, opts)
    const referencia = opts.referencia || _fiscalRef(tid, origemTipo, origemId)
    db.prepare(`INSERT INTO fiscal_nfce
      (tenant_id, origem_tipo, origem_id, order_id, mesa_num, session_ref, referencia, ambiente, status, total, forma_pagamento, payload_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        tid, origemTipo, String(origemId), opts.order_id || null, opts.mesa_num || null, opts.session_ref || null,
        referencia, cfg.ambiente || 'homologacao', 'pendente', built.total, opts.forma || orders?.[0]?.pag || 'PIX',
        JSON.stringify(built.payload)
      )
    marcarDirty()
    return { row: db.prepare('SELECT * FROM fiscal_nfce WHERE tenant_id=? AND referencia=?').get(tid, referencia), created: true }
  }
  const _fiscalFocusBase = (ambiente) => ambiente === 'producao' ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br'
  const _fiscalToken = (cfg) => cfg.ambiente === 'producao' ? cfg.token_producao : cfg.token_homologacao
  const _fiscalFocusRequest = async (cfg, method, pathFocus, body = null) => {
    const token = _fiscalToken(cfg)
    if (!token) throw new Error(`Token Focus ${cfg.ambiente === 'producao' ? 'producao' : 'homologacao'} nao configurado.`)
    const resp = await fetch(_fiscalFocusBase(cfg.ambiente) + pathFocus, {
      method,
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${token}:`).toString('base64'),
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    })
    const text = await resp.text()
    let data = null
    try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
    return { ok: resp.ok, statusCode: resp.status, data }
  }
  const _fiscalApplyFocusResponse = (tid, id, data, fallbackStatus = null) => {
    const status = String(data?.status || fallbackStatus || 'erro_autorizacao')
    const mensagem = data?.mensagem_sefaz || data?.mensagem || data?.erro || data?.error || (Array.isArray(data?.erros) ? data.erros.map(e => e.mensagem || e.message || e.codigo).filter(Boolean).join('; ') : '')
    const chave = data?.chave_nfe || data?.chave_nfce || data?.chave || data?.chave_acesso || null
    const xml = data?.caminho_xml_nota_fiscal || data?.caminho_xml || data?.caminho_xml_nfce || null
    const danfe = data?.caminho_danfe || data?.caminho_danfce || data?.caminho_pdf || data?.caminho_danfe_nfce || null
    const protocolo = data?.numero_protocolo || data?.protocolo || data?.protocolo_sefaz || null
    db.prepare(`UPDATE fiscal_nfce SET
      status=?, response_json=?, chave_nfe=?, numero=?, serie=?, protocolo=?, caminho_xml=?, caminho_danfe=?, qr_code=?, mensagem=?,
      emitted_at=CASE WHEN ? IN ('autorizado','autorizada') AND emitted_at IS NULL THEN datetime('now') ELSE emitted_at END,
      canceled_at=CASE WHEN ?='cancelado' AND canceled_at IS NULL THEN datetime('now') ELSE canceled_at END,
      updated_at=datetime('now')
      WHERE id=? AND tenant_id=?`)
      .run(status, JSON.stringify(data || {}), chave, data?.numero || data?.numero_nfce || null, data?.serie || null,
        protocolo, xml, danfe, data?.qr_code || data?.qrcode || data?.url_qrcode || null, mensagem || null,
        status, status, id, tid)
    marcarDirty()
    return db.prepare('SELECT * FROM fiscal_nfce WHERE id=? AND tenant_id=?').get(id, tid)
  }

  if (upath === '/api/fiscal/config') {
    const tid = _fiscalTenantId()
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    if (req.method === 'GET') {
      send(res, 200, _fiscalConfigOut(_fiscalEnsureConfig(tid)))
      return true
    }
    if (req.method === 'POST' || req.method === 'PATCH') {
      const body = await readBody(req)
      const current = _fiscalEnsureConfig(tid)
      const allowed = [
        'enabled','ambiente','emit_mode','cnpj_emitente','inscricao_estadual_emitente','regime_tributario_emitente',
        'nome_emitente','nome_fantasia_emitente','telefone_emitente','logradouro_emitente','numero_emitente',
        'bairro_emitente','municipio_emitente','uf_emitente','cep_emitente','csc_id','serie','proximo_numero',
        'natureza_operacao','ncm_padrao','cfop_padrao','icms_origem_padrao','icms_situacao_padrao','unidade_padrao'
      ]
      const payload = {}
      for (const k of allowed) {
        if (Object.prototype.hasOwnProperty.call(body || {}, k)) payload[k] = k === 'enabled' ? (body[k] ? 1 : 0) : body[k]
      }
      for (const secret of ['token_homologacao','token_producao','csc_token']) {
        const val = String(body?.[secret] || '').trim()
        if (val && !/^\*+$/.test(val)) payload[secret] = val
      }
      payload.ambiente = ['homologacao','producao'].includes(String(payload.ambiente || current.ambiente)) ? (payload.ambiente || current.ambiente) : 'homologacao'
      payload.emit_mode = ['fechamento','manual'].includes(String(payload.emit_mode || current.emit_mode)) ? (payload.emit_mode || current.emit_mode) : 'fechamento'
      payload.updated_at = new Date().toISOString()
      const keys = Object.keys(payload)
      if (keys.length) {
        db.prepare(`UPDATE fiscal_config SET ${keys.map(k => `"${k}"=?`).join(', ')} WHERE tenant_id=?`).run(...keys.map(k => payload[k]), tid)
        marcarDirty()
      }
      send(res, 200, _fiscalConfigOut(_fiscalEnsureConfig(tid)))
      return true
    }
  }

  if (upath === '/api/fiscal/nfce' && req.method === 'GET') {
    const tid = _fiscalTenantId()
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    const status = String(params.get('status') || '').trim()
    const limit = Math.min(300, Math.max(1, parseInt(params.get('limit') || '100', 10)))
    const where = ['tenant_id=?']
    const vals = [tid]
    if (status) { where.push('status=?'); vals.push(status) }
    const rows = db.prepare(`SELECT * FROM fiscal_nfce WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...vals, limit)
    send(res, 200, rows.map(_fiscalNoteOut))
    return true
  }

  if (upath === '/api/fiscal/nfce/importar-pendentes' && req.method === 'POST') {
    const tid = _fiscalTenantId()
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    const body = await readBody(req)
    const range = _fiscalDateRange(body)
    const pagamentoFiltro = _fiscalPagamentoFiltro(body.pagamento || body.pagamento_tipo || body.forma_pagamento || params.get('pagamento'))
    const rowsRaw = db.prepare(`
      SELECT * FROM orders
      WHERE tenant_id=?
        AND status IN ('finalizado','entregue')
        AND COALESCE(total,0)>0
        AND created_at>=?
        AND created_at<=?
      ORDER BY id ASC
    `).all(tid, range.start, range.end)
    const rows = pagamentoFiltro ? rowsRaw.filter(o => _fiscalOrderMatchesPagamento(o, pagamentoFiltro)) : rowsRaw
    const grupos = new Map()
    for (const o of rows) {
      const mesa = o.mesa_num ? parseInt(o.mesa_num) : null
      const sess = String(o.session_ref || '').trim()
      const key = mesa && sess
        ? `mesa_session:${mesa}:${sess}${pagamentoFiltro ? ':' + pagamentoFiltro : ''}`
        : `order:${o.id}`
      if (!grupos.has(key)) grupos.set(key, [])
      grupos.get(key).push(o)
    }
    const criadas = []
    const existentes = []
    const erros = []
    for (const [key, ords] of grupos.entries()) {
      try {
        const first = ords[0]
        const isMesa = key.startsWith('mesa_session:')
        const origemTipo = isMesa ? 'mesa_session' : 'order'
        const origemId = isMesa
          ? crypto.createHash('sha1').update(`${first.mesa_num}:${first.session_ref}:${pagamentoFiltro || 'todos'}`).digest('hex').slice(0, 16)
          : String(first.id)
        const result = _fiscalCreatePending(tid, origemTipo, origemId, ords, {
          order_id: isMesa ? null : first.id,
          mesa_num: first.mesa_num || null,
          session_ref: first.session_ref || null,
          forma: body.forma || _fiscalPagamentoLabel(pagamentoFiltro) || first.pag || 'PIX'
        })
        ;(result.created ? criadas : existentes).push(_fiscalNoteOut(result.row))
      } catch(e) {
        erros.push({ origem: key, error: e.message })
      }
    }
    send(res, 200, {
      ok: true,
      periodo: { de: range.de, ate: range.ate },
      pagamento: pagamentoFiltro || 'todos',
      vendas_encontradas: rows.length,
      criadas,
      existentes,
      erros
    })
    return true
  }

  if (upath === '/api/fiscal/nfce/from-order' && req.method === 'POST') {
    const tid = _fiscalTenantId()
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    const body = await readBody(req)
    const orderId = parseInt(body.order_id || body.id)
    if (!orderId) { send(res, 400, { error: 'order_id obrigatorio' }); return true }
    const order = db.prepare('SELECT * FROM orders WHERE tenant_id=? AND id=?').get(tid, orderId)
    if (!order) { send(res, 404, { error: 'Pedido nao encontrado' }); return true }
    try {
      const result = _fiscalCreatePending(tid, 'order', String(order.id), [order], { order_id: order.id, forma: body.forma || order.pag })
      send(res, result.created ? 201 : 200, _fiscalNoteOut(result.row))
    } catch(e) { send(res, 400, { error: e.message }) }
    return true
  }

  if (upath === '/api/fiscal/nfce/from-mesa' && req.method === 'POST') {
    const tid = _fiscalTenantId()
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    const body = await readBody(req)
    const mesa = parseInt(body.mesa_num)
    const sessionRef = String(body.session_ref || '').trim()
    if (!mesa || !sessionRef) { send(res, 400, { error: 'mesa_num e session_ref obrigatorios' }); return true }
    const orders = db.prepare(`
      SELECT * FROM orders
      WHERE tenant_id=? AND mesa_num=? AND COALESCE(session_ref,'')=? AND status IN ('entregue','finalizado','mesa_aberta','analise','producao','pronto')
      ORDER BY id ASC
    `).all(tid, mesa, sessionRef)
    if (!orders.length) { send(res, 404, { error: 'Nenhuma comanda encontrada para esta mesa' }); return true }
    try {
      const origemId = crypto.createHash('sha1').update(`${mesa}:${sessionRef}`).digest('hex').slice(0, 16)
      const result = _fiscalCreatePending(tid, 'mesa_session', origemId, orders, {
        mesa_num: mesa,
        session_ref: sessionRef,
        forma: body.forma || orders[0].pag || 'PIX',
        formas: body.formas || []
      })
      send(res, result.created ? 201 : 200, _fiscalNoteOut(result.row))
    } catch(e) { send(res, 400, { error: e.message }) }
    return true
  }

  const fiscalEmitMatch = upath.match(/^\/api\/fiscal\/nfce\/(\d+)\/emitir$/)
  if (fiscalEmitMatch && req.method === 'POST') {
    const tid = _fiscalTenantId()
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    const id = parseInt(fiscalEmitMatch[1])
    const cfg = _fiscalEnsureConfig(tid)
    const note = db.prepare('SELECT * FROM fiscal_nfce WHERE id=? AND tenant_id=?').get(id, tid)
    if (!note) { send(res, 404, { error: 'NFC-e nao encontrada' }); return true }
    try {
      const payload = _fiscalJson(note.payload_json, {})
      payload.data_emissao = _fiscalIsoNowBR()
      db.prepare('UPDATE fiscal_nfce SET payload_json=?, ambiente=?, updated_at=datetime(\'now\') WHERE id=? AND tenant_id=?')
        .run(JSON.stringify(payload), cfg.ambiente || note.ambiente || 'homologacao', id, tid)
      const fr = await _fiscalFocusRequest(cfg, 'POST', `/v2/nfce?ref=${encodeURIComponent(note.referencia)}&completa=1`, payload)
      const updated = _fiscalApplyFocusResponse(tid, id, fr.data, fr.ok ? null : 'erro_autorizacao')
      send(res, fr.ok ? 200 : 422, _fiscalNoteOut(updated))
    } catch(e) {
      db.prepare('UPDATE fiscal_nfce SET status=?, mensagem=?, updated_at=datetime(\'now\') WHERE id=? AND tenant_id=?')
        .run('erro_autorizacao', e.message, id, tid)
      marcarDirty()
      send(res, 400, { error: e.message })
    }
    return true
  }

  if (upath === '/api/fiscal/nfce/emitir-pendentes' && req.method === 'POST') {
    const tid = _fiscalTenantId()
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    const body = await readBody(req)
    const limit = Math.min(100, Math.max(1, parseInt(body.limit || 50, 10)))
    const pagamentoFiltro = _fiscalPagamentoFiltro(body.pagamento || body.pagamento_tipo || body.forma_pagamento || params.get('pagamento'))
    const pendentesRaw = db.prepare("SELECT id, forma_pagamento FROM fiscal_nfce WHERE tenant_id=? AND status IN ('pendente','erro_autorizacao') ORDER BY id ASC LIMIT ?")
      .all(tid, pagamentoFiltro ? 300 : limit)
    const pendentes = pagamentoFiltro
      ? pendentesRaw.filter(n => _fiscalPagamentoFiltro(n.forma_pagamento) === pagamentoFiltro).slice(0, limit)
      : pendentesRaw
    const ok = [], erros = []
    for (const p of pendentes) {
      try {
        const cfg = _fiscalEnsureConfig(tid)
        const note = db.prepare('SELECT * FROM fiscal_nfce WHERE id=? AND tenant_id=?').get(p.id, tid)
        const payload = _fiscalJson(note.payload_json, {})
        payload.data_emissao = _fiscalIsoNowBR()
        db.prepare('UPDATE fiscal_nfce SET payload_json=?, ambiente=?, updated_at=datetime(\'now\') WHERE id=? AND tenant_id=?')
          .run(JSON.stringify(payload), cfg.ambiente || note.ambiente || 'homologacao', note.id, tid)
        const fr = await _fiscalFocusRequest(cfg, 'POST', `/v2/nfce?ref=${encodeURIComponent(note.referencia)}&completa=1`, payload)
        const updated = _fiscalApplyFocusResponse(tid, note.id, fr.data, fr.ok ? null : 'erro_autorizacao')
        if (fr.ok) ok.push(_fiscalNoteOut(updated))
        else erros.push({ id: note.id, referencia: note.referencia, error: updated.mensagem || 'Erro na autorizacao' })
      } catch(e) {
        erros.push({ id: p.id, error: e.message })
      }
    }
    send(res, 200, { ok: true, pagamento: pagamentoFiltro || 'todos', selecionadas: pendentes.length, emitidas: ok, erros })
    return true
  }

  const fiscalConsultarMatch = upath.match(/^\/api\/fiscal\/nfce\/(\d+)\/consultar$/)
  if (fiscalConsultarMatch && req.method === 'POST') {
    const tid = _fiscalTenantId()
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    const id = parseInt(fiscalConsultarMatch[1])
    const cfg = _fiscalEnsureConfig(tid)
    const note = db.prepare('SELECT * FROM fiscal_nfce WHERE id=? AND tenant_id=?').get(id, tid)
    if (!note) { send(res, 404, { error: 'NFC-e nao encontrada' }); return true }
    try {
      const fr = await _fiscalFocusRequest(cfg, 'GET', `/v2/nfce/${encodeURIComponent(note.referencia)}?completa=1`)
      const updated = _fiscalApplyFocusResponse(tid, id, fr.data, fr.ok ? null : 'erro_autorizacao')
      send(res, fr.ok ? 200 : 422, _fiscalNoteOut(updated))
    } catch(e) { send(res, 400, { error: e.message }) }
    return true
  }

  const fiscalCancelarMatch = upath.match(/^\/api\/fiscal\/nfce\/(\d+)\/cancelar$/)
  if (fiscalCancelarMatch && req.method === 'POST') {
    const tid = _fiscalTenantId()
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    const id = parseInt(fiscalCancelarMatch[1])
    const body = await readBody(req)
    const justificativa = _fiscalText(body.justificativa || 'Cancelamento solicitado pelo estabelecimento', 255)
    if (justificativa.length < 15) { send(res, 400, { error: 'Justificativa precisa ter pelo menos 15 caracteres' }); return true }
    const cfg = _fiscalEnsureConfig(tid)
    const note = db.prepare('SELECT * FROM fiscal_nfce WHERE id=? AND tenant_id=?').get(id, tid)
    if (!note) { send(res, 404, { error: 'NFC-e nao encontrada' }); return true }
    try {
      const fr = await _fiscalFocusRequest(cfg, 'DELETE', `/v2/nfce/${encodeURIComponent(note.referencia)}`, { justificativa })
      const updated = _fiscalApplyFocusResponse(tid, id, fr.data, fr.ok ? 'cancelado' : 'erro_cancelamento')
      send(res, fr.ok ? 200 : 422, _fiscalNoteOut(updated))
    } catch(e) { send(res, 400, { error: e.message }) }
    return true
  }

  const _chatDigits = (v) => typeof chatNormalizePhone === 'function'
    ? chatNormalizePhone(v)
    : String(v || '').replace(/\D/g, '')
  const _chatMatches = (saved, incoming) => typeof chatPhoneMatches === 'function'
    ? chatPhoneMatches(saved, incoming)
    : (_chatDigits(saved) && _chatDigits(saved).slice(-8) === _chatDigits(incoming).slice(-8))
  const _chatIsStore = () => !!String(req.headers['x-user-id'] || '').trim()
  const _chatRequireStore = () => {
    if (_chatIsStore()) return true
    send(res, 401, { error: 'Sessao do gestor obrigatoria' })
    return false
  }
  const _chatOrder = (tid, orderId) => {
    if (!tid || !orderId) return null
    return db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(orderId, tid)
  }
  const _chatThreadByOrder = (tid, orderId) => {
    if (!tid || !orderId) return null
    return db.prepare('SELECT * FROM order_chat_threads WHERE tenant_id=? AND order_id=?').get(tid, orderId)
  }
  const _chatMessages = (tid, threadId, afterId = 0) => {
    if (!tid || !threadId) return []
    return db.prepare(`SELECT * FROM order_chat_messages
      WHERE tenant_id=? AND thread_id=? AND id>?
      ORDER BY id ASC LIMIT 300`).all(tid, threadId, afterId)
  }
  const _chatThreadOut = (thread, order) => typeof chatThreadPublic === 'function'
    ? chatThreadPublic(thread, order)
    : thread
  const _chatMessageOut = (msg) => typeof chatMessagePublic === 'function'
    ? chatMessagePublic(msg)
    : msg
  const _chatNorm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w\s]/g,' ').replace(/\s+/g,' ').trim()
  const _chatFmt = (v) => (parseFloat(v || 0)).toFixed(2).replace('.', ',')
  const _chatJson = (v, fallback) => {
    try {
      if (Array.isArray(v) || (v && typeof v === 'object')) return v
      return v ? JSON.parse(v) : fallback
    } catch { return fallback }
  }
  const _chatPendingNumber = (order) => {
    const status = String(order?.status || '').toLowerCase()
    const pag = String(order?.pag || '').toLowerCase()
    return status === 'aguardando_cartao' || (status === 'aguardando_pix' && pag !== 'pix_manual')
  }
  const _chatShortNum = (order) => {
    if (order?.order_num) return String(order.order_num).padStart(3, '0')
    if (!order?.id || !order?.tenant_id || _chatPendingNumber(order)) return ''
    try {
      const cfg = db.prepare('SELECT order_num_offset FROM store_config WHERE tenant_id=?').get(order.tenant_id)
      return _numeroPedidoPad(order, parseInt(cfg?.order_num_offset, 10) || 0)
    } catch { return '' }
  }
  const _chatPauseKey = (tid, phone) => `pausa:${tid}:${_chatDigits(phone)}`
  const _chatPauseMinutes = (tid) => {
    try {
      const cfg = db.prepare('SELECT ia_config FROM store_config WHERE tenant_id=?').get(tid)
      const ia = _chatJson(cfg?.ia_config, {})
      return Math.max(5, parseInt(ia?.pausa_min || ia?.pausaMin || 30, 10) || 30)
    } catch { return 30 }
  }
  const _chatBotPaused = (tid, phone) => {
    const p = _chatDigits(phone)
    if (!tid || !p || !_pausaHumano?.get) return false
    const at = _pausaHumano.get(_chatPauseKey(tid, p))
    return !!(at && (Date.now() - Number(at)) < _chatPauseMinutes(tid) * 60 * 1000)
  }
  const _chatPauseBot = (tid, phone) => {
    const p = _chatDigits(phone)
    if (tid && p && _pausaHumano?.set) _pausaHumano.set(_chatPauseKey(tid, p), Date.now())
  }
  const _chatLeadThread = (tid, phone, client = '') => {
    if (typeof chatEnsureThreadFromLead === 'function') return chatEnsureThreadFromLead(tid, { phone, client })
    const p = _chatDigits(phone)
    if (!tid || !p) return null
    const existing = db.prepare('SELECT * FROM order_chat_threads WHERE tenant_id=? AND order_id=0 AND phone=? ORDER BY id DESC LIMIT 1').get(tid, p)
    if (existing) return existing
    const ins = db.prepare(`INSERT INTO order_chat_threads (tenant_id,order_id,client,phone,updated_at) VALUES (?,0,?,?,datetime('now'))`).run(tid, client, p)
    return db.prepare('SELECT * FROM order_chat_threads WHERE id=? AND tenant_id=?').get(ins.lastInsertRowid, tid)
  }
  const _chatDraftRow = (tid, thread) => {
    if (!tid || !thread?.id) return null
    let row = db.prepare('SELECT * FROM order_chat_drafts WHERE tenant_id=? AND thread_id=?').get(tid, thread.id)
    if (!row) {
      db.prepare(`INSERT INTO order_chat_drafts
        (tenant_id, thread_id, phone, client, items, step, status, meta, updated_at)
        VALUES (?,?,?,?, '[]', 'items', 'draft', '{}', datetime('now'))`)
        .run(tid, thread.id, _chatDigits(thread.phone), thread.client || '')
      row = db.prepare('SELECT * FROM order_chat_drafts WHERE tenant_id=? AND thread_id=?').get(tid, thread.id)
    }
    return row
  }
  const _chatDraft = (tid, thread) => {
    const row = _chatDraftRow(tid, thread)
    if (!row) return null
    return {
      ...row,
      items: _chatJson(row.items, []),
      meta: _chatJson(row.meta, {})
    }
  }
  const _chatSaveDraft = (draft) => {
    if (!draft?.tenant_id || !draft?.thread_id) return
    db.prepare(`UPDATE order_chat_drafts
      SET phone=?, client=?, items=?, delivery_type=?, addr=?, pag=?, step=?, status=?, meta=?, updated_at=datetime('now')
      WHERE tenant_id=? AND thread_id=?`)
      .run(_chatDigits(draft.phone), draft.client || '', JSON.stringify(draft.items || []),
        draft.delivery_type || null, draft.addr || null, draft.pag || null,
        draft.step || 'items', draft.status || 'draft', JSON.stringify(draft.meta || {}),
        draft.tenant_id, draft.thread_id)
    marcarDirty()
  }
  const _chatClearDraft = (draft) => {
    if (!draft) return
    draft.items = []
    draft.delivery_type = null
    draft.addr = null
    draft.pag = null
    draft.step = 'items'
    draft.status = 'draft'
    draft.meta = {}
    _chatSaveDraft(draft)
  }
  const _chatMenuRows = (tid) => db.prepare(`SELECT id,name,description,price,item_type,custom_groups,status
    FROM menu_items WHERE tenant_id=? AND COALESCE(status,'ativo')!='pausado'
    ORDER BY sort_order IS NULL, sort_order, id LIMIT 300`).all(tid)
  const _chatPizzaSizes = (item) => {
    const groups = _chatJson(item?.custom_groups, [])
    const g = (groups || []).find(x => x && x.tipo === 'pizza_sizes' && Array.isArray(x.tamanhos))
    if (!g) return null
    return {
      regra: String(g.regra_meio || 'maior').toLowerCase(),
      tamanhos: g.tamanhos.map(t => ({
        key: String(t.key || '').toUpperCase(),
        nome: String(t.nome || t.key || ''),
        preco: parseFloat(t.preco || 0) || 0
      })).filter(t => t.key && t.preco >= 0)
    }
  }
  const _chatSizeFromText = (text) => {
    const n = _chatNorm(text)
    if (/\b(g|grande|familia|familia)\b/.test(n)) return 'G'
    if (/\b(m|media|medio)\b/.test(n)) return 'M'
    if (/\b(p|pequena|pequeno)\b/.test(n)) return 'P'
    return ''
  }
  const _chatSizePrice = (item, sizeKey) => {
    const cfg = _chatPizzaSizes(item)
    if (!cfg) return { price: parseFloat(item.price || 0) || 0, label: '', cfg: null }
    const found = cfg.tamanhos.find(t => t.key === sizeKey) || null
    return { price: parseFloat(found?.preco || item.price || 0) || 0, label: found?.nome || sizeKey, cfg }
  }
  const _chatAddonEsgSet = (tid) => {
    try {
      return new Set(db.prepare('SELECT nome_norm FROM addons_esgotados WHERE tenant_id=?').all(tid).map(r => String(r.nome_norm || '')))
    } catch { return new Set() }
  }
  const _chatAddonNorm = (v) => String(v || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  const _chatGroupSizeKey = (name) => (String(name || '').match(/\((P|M|G)\)\s*$/i)?.[1] || '').toUpperCase()
  const _chatAddonGroups = (tid, item, sizeKey = '') => {
    const groups = _chatJson(item?.custom_groups, [])
    const esg = _chatAddonEsgSet(tid)
    const excluded = new Set(['cortes','preparos','ocasiao','armazenamento','pesos','porcao_ref','kit_itens','pizza_sizes'])
    const hasPizzaSizes = !!_chatPizzaSizes(item)
    return (groups || [])
      .filter(g => g && !excluded.has(g.tipo))
      .filter(g => !(hasPizzaSizes && _chatNorm(g.nome) === 'tamanho'))
      .filter(g => {
        const gSize = _chatGroupSizeKey(g.nome)
        return !gSize || !sizeKey || gSize === String(sizeKey || '').toUpperCase()
      })
      .map(g => {
        const opts = (g.opcoes || []).map(o => ({
          nome: String(o.nome || o.name || '').trim(),
          preco: parseFloat(o.preco ?? o.price ?? o.valor ?? 0) || 0
        })).filter(o => o.nome && !esg.has(_chatAddonNorm(o.nome)))
        const tipo = g.tipo === 'checkbox' ? 'checkbox' : 'radio'
        const max = tipo === 'checkbox' ? Math.max(1, parseInt(g.max || 1, 10) || 1) : 1
        const min = g.required ? Math.max(1, parseInt(g.min || 1, 10) || 1) : Math.max(0, parseInt(g.min || 0, 10) || 0)
        return { nome: String(g.nome || 'Adicionais').trim(), tipo, required: !!g.required || min > 0, min, max, opcoes: opts }
      })
      .filter(g => g.opcoes.length)
  }
  const _chatAddonDesc = (item) => {
    const addons = item?.addons || {}
    const parts = []
    for (const [grupo, ops] of Object.entries(addons)) {
      if (!Array.isArray(ops) || !ops.length) continue
      const names = ops.map(o => `${o.qty > 1 ? `${o.qty}x ` : ''}${o.nome}${o.preco > 0 ? ` (+R$ ${_chatFmt(o.preco * (o.qty || 1))})` : ''}`)
      parts.push(`${grupo}: ${names.join(', ')}`)
    }
    return parts.join(' | ')
  }
  const _chatRecalcItem = (item) => {
    const base = parseFloat(item?.base_price ?? item?.price ?? 0) || 0
    const extra = Object.values(item?.addons || {}).flat().reduce((s,o)=>s+(parseFloat(o.preco || 0) * (parseInt(o.qty || 1, 10) || 1)),0)
    item.price = base + extra
    const addonDesc = _chatAddonDesc(item)
    item.obs = [item.base_obs || '', addonDesc].filter(Boolean).join(' | ')
    return item
  }
  const _chatAddonPrompt = (draft, tid) => {
    const pend = draft?.meta?.pending_addons
    const item = draft?.items?.[pend?.itemIndex]
    if (!pend || !item) return ''
    const groups = _chatAddonGroups(tid, item._source || item, item.sizeKey)
    const group = groups[pend.groupIndex || 0]
    if (!group) return ''
    const opts = group.opcoes.map((o, idx) => `${idx + 1}. ${o.nome}${o.preco > 0 ? ` + R$ ${_chatFmt(o.preco)}` : ' gratis'}`).join('\n')
    const tipo = group.tipo === 'checkbox'
      ? `Escolha ate ${group.max}${group.min ? ` (minimo ${group.min})` : ''}.`
      : 'Escolha uma opcao.'
    const skip = group.required ? '' : '\nResponda "sem" para seguir sem esse adicional.'
    return `${group.nome}\n${tipo}\n${opts}${skip}`
  }
  const _chatParseAddonSelection = (text, group) => {
    const n = _chatNorm(text)
    if (/\b(sem|nenhum|nenhuma|nao|não|pular|dispenso)\b/.test(n)) return []
    const selected = []
    const nums = Array.from(n.matchAll(/\b(\d{1,2})\b/g)).map(m => parseInt(m[1], 10)).filter(Boolean)
    for (const num of nums) {
      const opt = group.opcoes[num - 1]
      if (opt && !selected.find(s => s.nome === opt.nome)) selected.push({ ...opt, qty: 1 })
    }
    for (const opt of group.opcoes) {
      const on = _chatNorm(opt.nome)
      if (on && n.includes(on) && !selected.find(s => s.nome === opt.nome)) selected.push({ ...opt, qty: 1 })
    }
    return selected.slice(0, group.max || 1)
  }
  const _chatStartAddonFlow = (tid, draft, itemIndex, thread, order = null) => {
    const item = draft.items[itemIndex]
    const groups = _chatAddonGroups(tid, item._source || item, item.sizeKey)
    if (!groups.length) return false
    draft.meta = draft.meta || {}
    draft.meta.pending_addons = { itemIndex, groupIndex: 0 }
    _chatSaveDraft(draft)
    _chatAddBot(thread, `Antes de finalizar esse item, escolha os adicionais:\n\n${_chatAddonPrompt(draft, tid)}`, order)
    return true
  }
  const _chatHandlePendingAddons = (tid, thread, draft, text, order = null) => {
    const pend = draft?.meta?.pending_addons
    if (!pend) return false
    const item = draft.items?.[pend.itemIndex]
    if (!item) { delete draft.meta.pending_addons; _chatSaveDraft(draft); return false }
    const groups = _chatAddonGroups(tid, item._source || item, item.sizeKey)
    const group = groups[pend.groupIndex || 0]
    if (!group) {
      delete draft.meta.pending_addons
      _chatSaveDraft(draft)
      return false
    }
    const selected = _chatParseAddonSelection(text, group)
    if (selected.length < group.min) {
      _chatAddBot(thread, `${group.required ? 'Esse grupo e obrigatorio.' : 'Selecione ao menos ' + group.min + '.'}\n\n${_chatAddonPrompt(draft, tid)}`, order)
      return true
    }
    if (selected.length) {
      item.addons = item.addons || {}
      item.addons[group.nome] = selected
      _chatRecalcItem(item)
    }
    pend.groupIndex = (pend.groupIndex || 0) + 1
    if (groups[pend.groupIndex]) {
      draft.meta.pending_addons = pend
      _chatSaveDraft(draft)
      _chatAddBot(thread, _chatAddonPrompt(draft, tid), order)
      return true
    }
    delete draft.meta.pending_addons
    _chatSaveDraft(draft)
    _chatAddBot(thread, `${item.name} ficou assim:\n${_chatDraftSummary(draft)}\n\nDeseja adicionar mais algum item ou finalizar?`, order)
    return true
  }
  const _chatItemMatches = (rows, text) => {
    const n = _chatNorm(text)
    return rows.map(row => {
      const rn = _chatNorm(row.name)
      let score = 0
      if (n === rn) score = 100
      else if (n.includes(rn)) score = 80 + Math.min(15, rn.length / 3)
      else {
        const parts = rn.split(' ').filter(w => w.length > 2)
        const hits = parts.filter(w => n.includes(w)).length
        if (hits) score = 20 + hits * 10
      }
      return { row, score }
    }).filter(x => x.score > 0).sort((a,b) => b.score - a.score)
  }
  const _chatQtyFromText = (text) => {
    const n = _chatNorm(text)
    const m = n.match(/\b(\d{1,2})\s*(x|un|unidade|unidades)?\b/)
    if (m) return Math.max(1, Math.min(20, parseInt(m[1], 10) || 1))
    if (/\bduas\b/.test(n)) return 2
    if (/\btres\b/.test(n)) return 3
    return 1
  }
  const _chatListMenu = (tid) => {
    const rows = _chatMenuRows(tid).slice(0, 8)
    if (!rows.length) return 'No momento nao encontrei itens ativos no cardapio. Vou chamar a loja para te ajudar.'
    return 'Algumas opcoes do cardapio:\n' + rows.map((i, idx) => `${idx + 1}. ${i.name} - R$ ${_chatFmt(i.price)}`).join('\n') + '\n\nEscreva o nome do item que deseja adicionar.'
  }
  const _chatDraftSummary = (draft) => {
    const items = draft?.items || []
    if (!items.length) return 'Carrinho vazio.'
    const linhas = items.map(i => `${i.qty || 1}x ${i.name} - R$ ${_chatFmt((i.price || 0) * (i.qty || 1))}${i.obs ? `\n   ${i.obs}` : ''}`)
    const subtotal = items.reduce((s,i)=>s+(parseFloat(i.price||0)*(parseInt(i.qty||1)||1)),0)
    return `${linhas.join('\n')}\nSubtotal: R$ ${_chatFmt(subtotal)}`
  }
  const _chatDeliveryFromText = (text) => {
    const n = _chatNorm(text)
    if (/\b(retirada|retirar|balcao|balcao)\b/.test(n)) return 'retirada'
    if (/\b(entrega|delivery|entregar|casa|endereco)\b/.test(n)) return 'delivery'
    if (/\b(mesa)\b/.test(n)) return 'mesa'
    return ''
  }
  const _chatPayFromText = (text) => {
    const n = _chatNorm(text)
    if (/\bpix\b/.test(n)) return 'pix_manual'
    if (/\b(dinheiro|troco)\b/.test(n)) return 'dinheiro'
    if (/\b(credito|cartao credito|cartao)\b/.test(n)) return 'credito'
    if (/\b(debito)\b/.test(n)) return 'debito'
    return ''
  }
  const _chatDeliveryCfg = (tid) => {
    try {
      const cfgRow = db.prepare('SELECT delivery_fee_config FROM store_config WHERE tenant_id=?').get(tid)
      return _chatJson(cfgRow?.delivery_fee_config, {})
    } catch { return {} }
  }
  const _chatLev = (a, b) => {
    a = _chatNorm(a); b = _chatNorm(b)
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i])
    for (let j = 1; j <= b.length; j++) m[0][j] = j
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        m[i][j] = a[i - 1] === b[j - 1]
          ? m[i - 1][j - 1]
          : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1)
      }
    }
    return m[a.length][b.length]
  }
  const _chatAddrCandidates = (text) => {
    const raw = String(text || '')
    const parts = raw.split(/[,;\n]/).map(s => s.trim()).filter(Boolean)
    const out = [...parts]
    const bairro = raw.match(/\bbairro\s+([^,;\n]+)/i)
    if (bairro) out.unshift(bairro[1].trim())
    return [...new Set(out.concat(raw.trim()).filter(Boolean))]
  }
  const _chatMatchBairro = (text, bairrosLista) => {
    if (!text || !Array.isArray(bairrosLista) || !bairrosLista.length) return null
    const full = _chatNorm(text)
    for (const b of bairrosLista) {
      const bn = _chatNorm(b?.bairro || b)
      if (bn && new RegExp(`(^|\\s)${bn.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(\\s|$)`).test(full)) return b
    }
    const cands = _chatAddrCandidates(text)
    for (const cand of cands) {
      const cn = _chatNorm(cand)
      const exact = bairrosLista.find(b => _chatNorm(b?.bairro || b) === cn)
      if (exact) return exact
      const subset = bairrosLista.filter(b => {
        const bn = _chatNorm(b?.bairro || b)
        return bn && (bn.includes(cn) || cn.includes(bn))
      })
      if (subset.length === 1) return subset[0]
    }
    const scored = []
    for (const cand of cands) {
      const cn = _chatNorm(cand)
      if (!cn || cn.length < 4) continue
      bairrosLista.forEach(b => scored.push({ b, d: _chatLev(cn, b?.bairro || b) }))
    }
    scored.sort((a,b) => a.d - b.d)
    const best = scored[0], second = scored[1]
    if (best) {
      const size = Math.min(_chatNorm(best.b?.bairro || best.b).length, Math.max(...cands.map(c => _chatNorm(c).length)))
      const tol = size >= 5 ? 2 : 1
      if (best.d <= tol && (!second || second.d > best.d)) return best.b
    }
    return null
  }
  const _chatBairroSuggestions = (text, bairrosLista) => {
    if (!Array.isArray(bairrosLista) || !bairrosLista.length) return ''
    const cands = _chatAddrCandidates(text)
    const base = cands[cands.length - 1] || text
    return bairrosLista
      .map(b => ({ nome: b?.bairro || String(b || ''), d: _chatLev(base, b?.bairro || b) }))
      .filter(x => x.nome)
      .sort((a,b) => a.d - b.d)
      .slice(0, 3)
      .map(x => x.nome)
      .join(', ')
  }
  const _chatHasNumber = (text) => /\b(n|num|numero|nº|no)?\s*\d{1,6}[a-z]?\b/i.test(String(text || ''))
  const _chatHasReference = (text) => /\b(ref|referencia|ponto|perto|proximo|proxima|ao lado|em frente|casa|apto|apartamento|bloco|condominio|portao|esquina)\b/i.test(_chatNorm(text))
  const _chatGeoFromText = (text) => {
    const raw = String(text || '')
    const lat = raw.match(/latitude:\s*(-?\d+(?:[\.,]\d+)?)/i)
    const lng = raw.match(/longitude:\s*(-?\d+(?:[\.,]\d+)?)/i)
    if (!lat || !lng) return null
    const dist = raw.match(/distancia da loja:\s*([\d\.,]+)/i)
    const addr = raw.match(/endereco aproximado:\s*([^\n]+)/i)
    return {
      lat: parseFloat(lat[1].replace(',', '.')),
      lng: parseFloat(lng[1].replace(',', '.')),
      dist: dist ? parseFloat(dist[1].replace(',', '.')) : null,
      approx: addr ? addr[1].trim().slice(0, 180) : ''
    }
  }
  const _chatKmTaxa = (cfg, dist) => {
    const faixas = Array.isArray(cfg?.faixas) ? cfg.faixas : []
    if (!faixas.length || !(dist >= 0)) return { ok: false, taxa: 0, msg: 'Nao consegui calcular a distancia. Toque em "Enviar localizacao" para confirmar.' }
    const sorted = faixas.slice().sort((a,b) => (parseFloat(a.ate_km || 0) || 0) - (parseFloat(b.ate_km || 0) || 0))
    const found = sorted.find(f => dist <= (parseFloat(f.ate_km || 0) || 0) + 0.001)
    if (!found) {
      const max = parseFloat(sorted[sorted.length - 1]?.ate_km || 0) || 0
      return { ok: false, taxa: 0, msg: `A localizacao ficou a ${String(dist.toFixed(1)).replace('.', ',')} km, fora da area de entrega da loja (ate ${String(max).replace('.', ',')} km).` }
    }
    return { ok: true, taxa: parseFloat(found.taxa || 0) || 0, faixa: found }
  }
  const _chatAddressPrompt = (tid) => {
    const cfg = _chatDeliveryCfg(tid)
    if (cfg?.tipo === 'por_km') {
      return 'Para calcular a entrega por distancia, toque em "Enviar localizacao". Depois me envie numero da casa/apto e ponto de referencia. Se a rua nao vier automaticamente, envie tambem a rua.'
    }
    if (cfg?.tipo === 'por_bairro') {
      const bairros = Array.isArray(cfg.bairros) ? cfg.bairros.map(b => b.bairro).filter(Boolean).slice(0, 6).join(', ') : ''
      return `Me envie rua, numero, bairro e ponto de referencia. Vou conferir o bairro cadastrado para aplicar a taxa correta.${bairros ? '\nBairros atendidos: ' + bairros + (cfg.bairros.length > 6 ? ', ...' : '') : ''}`
    }
    return 'Me envie o endereco completo com rua, numero, bairro e ponto de referencia.'
  }
  const _chatValidateDeliveryAddress = (tid, text, draft) => {
    const cfg = _chatDeliveryCfg(tid)
    let raw = String(text || '').trim().slice(0, 260)
    draft.meta = draft.meta || {}
    if (draft.meta.pending_addr_raw && raw && !_chatHasNumber(raw) && raw.length <= 80) {
      raw = `${draft.meta.pending_addr_raw}, Bairro: ${raw}`.slice(0, 260)
      draft.meta.pending_addr_raw = null
    }
    if (deliveryPausaAtiva(cfg, 'delivery')) return { ok: false, ask: 'Delivery esta temporariamente pausado pela loja. Posso seguir como retirada ou mesa?' }

    const bloqueados = Array.isArray(cfg?.bairros_bloqueados) ? cfg.bairros_bloqueados : []
    const rawNorm = _chatNorm(raw)
    const blocked = bloqueados.find(b => {
      const bn = _chatNorm(b)
      return bn && new RegExp(`(^|\\s)${bn.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(\\s|$)`).test(rawNorm)
    })
    if (blocked) return { ok: false, ask: `Infelizmente a loja nao atende o bairro ${blocked}. Posso mudar para retirada ou mesa?` }

    if (cfg?.tipo === 'por_km') {
      const geo = _chatGeoFromText(raw)
      if (geo) {
        draft.meta.geo = geo
        const km = _chatKmTaxa(cfg, geo.dist)
        if (!km.ok) return { ok: false, ask: km.msg }
        draft.meta.delivery_taxa = km.taxa
        return { ok: false, ask: `Localizacao recebida. Distancia: ${String((geo.dist || 0).toFixed(1)).replace('.', ',')} km. Taxa: R$ ${_chatFmt(km.taxa)}.\nAgora envie numero da casa/apto e ponto de referencia. Exemplo: "numero 123, casa azul, perto da praca".` }
      }
      if (!draft.meta.geo) return { ok: false, ask: _chatAddressPrompt(tid) }
      if (!_chatHasNumber(raw)) return { ok: false, ask: 'Falta o numero da casa/apto. Envie o numero para eu completar o endereco.' }
      if (!_chatHasReference(raw)) return { ok: false, ask: 'Falta um ponto de referencia. Envie uma referencia para a entrega chegar certinha.' }
      const approx = draft.meta.geo.approx || ''
      const addr = [approx, raw, draft.meta.geo.dist != null ? `GPS: ${String(draft.meta.geo.dist.toFixed(1)).replace('.', ',')} km` : 'GPS confirmado'].filter(Boolean).join(', ')
      return { ok: true, addr: addr.slice(0, 260), taxa: parseFloat(draft.meta.delivery_taxa || 0) || 0 }
    }

    if (!_chatHasNumber(raw)) return { ok: false, ask: 'Falta o numero. Me envie rua, numero, bairro e ponto de referencia.' }
    if (!_chatHasReference(raw)) return { ok: false, ask: 'Falta o ponto de referencia. Envie uma referencia para evitar erro na entrega.' }

    if (cfg?.tipo === 'por_bairro') {
      const bairros = Array.isArray(cfg.bairros) ? cfg.bairros : []
      if (bairros.length) {
        const match = _chatMatchBairro(raw, bairros)
        if (!match) {
          draft.meta.pending_addr_raw = raw
          const sug = _chatBairroSuggestions(raw, bairros)
          return { ok: false, ask: sug ? `Nao encontrei esse bairro na area da loja. Voce quis dizer: ${sug}? Envie o endereco com o bairro correto.` : 'Nao encontrei esse bairro na area da loja. Confira o nome do bairro ou fale com a loja.' }
        }
        draft.meta.pending_addr_raw = null
        draft.meta.delivery_bairro = match.bairro || ''
        draft.meta.delivery_taxa = parseFloat(match.taxa || 0) || 0
        const bn = _chatNorm(match.bairro || '')
        const addr = bn && !_chatNorm(raw).includes(bn) ? `${raw}, Bairro: ${match.bairro}` : raw
        return { ok: true, addr: addr.slice(0, 260), taxa: parseFloat(match.taxa || 0) || 0, bairro: match.bairro || '' }
      }
    }

    return { ok: true, addr: raw, taxa: cfg?.tipo === 'fixo' ? (parseFloat(cfg.valor || 0) || 0) : 0 }
  }
  const _chatDeliveryFee = (tid, deliveryType, addr, draft = null) => {
    if (deliveryType !== 'delivery') return 0
    try {
      if (draft?.meta?.delivery_taxa != null) return parseFloat(draft.meta.delivery_taxa || 0) || 0
      const cfg = _chatDeliveryCfg(tid)
      if (deliveryPausaAtiva(cfg, 'delivery')) return null
      if (cfg?.tipo === 'fixo') return parseFloat(cfg.valor || 0) || 0
      if (cfg?.tipo === 'por_bairro' && Array.isArray(cfg.bairros)) {
        const found = _chatMatchBairro(addr, cfg.bairros)
        if (found) return parseFloat(found.taxa || 0) || 0
      }
      if (cfg?.tipo === 'por_km' && draft?.meta?.geo?.dist != null) {
        const km = _chatKmTaxa(cfg, parseFloat(draft.meta.geo.dist || 0))
        return km.ok ? km.taxa : null
      }
    } catch {}
    return 0
  }
  const _chatCreateOrderFromDraft = (tid, thread, draft) => {
    const items = (draft.items || []).filter(i => i && i.name && (parseInt(i.qty || 1) > 0))
    if (!items.length) throw new Error('Carrinho vazio')
    const deliveryType = draft.delivery_type || 'retirada'
    const mesaNum = String(draft.addr || '').replace(/\D/g,'')
    let addr = deliveryType === 'delivery'
      ? String(draft.addr || '').trim()
      : deliveryType === 'mesa'
        ? (mesaNum ? ('Mesa ' + mesaNum) : 'Mesa')
        : 'Retirada no balcao'
    if (deliveryType === 'delivery' && !addr) throw new Error('Endereco obrigatorio')
    if (deliveryType === 'delivery') {
      const checked = _chatValidateDeliveryAddress(tid, addr, draft)
      if (!checked.ok) throw new Error(checked.ask || 'Endereco incompleto')
      addr = checked.addr || addr
      if (checked.taxa != null) {
        draft.meta = draft.meta || {}
        draft.meta.delivery_taxa = checked.taxa
      }
    }
    const taxa = _chatDeliveryFee(tid, deliveryType, addr, draft)
    if (taxa === null) throw new Error('Delivery pausado pela loja')
    const subtotal = items.reduce((s,i)=>s+(parseFloat(i.price||0)*(parseInt(i.qty||1)||1)),0)
    const total = subtotal + (parseFloat(taxa || 0) || 0)
    const pag = draft.pag || 'dinheiro'
    const time = new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })
    const reqId = `chat:${thread.id}:${Date.now()}`
    const insert = db.prepare(`INSERT INTO orders
      (tenant_id, client, phone, addr, items, total, taxa, pag, pag_momento, status, time, client_request_id, wa_track)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`)
    const info = insert.run(tid, draft.client || thread.client || 'Cliente', _chatDigits(draft.phone || thread.phone), addr,
      JSON.stringify(items.map(i => ({ id: i.id || null, qty: i.qty || 1, name: i.name, price: i.price || 0, obs: i.obs || '' }))),
      total, taxa || 0, pag, 'entrega', 'analise', time, reqId)
    const orderId = info.lastInsertRowid
    try {
      const txFn = db.transaction((tenantId, rowid) => {
        const cfg = db.prepare('SELECT order_num_offset FROM store_config WHERE tenant_id=?').get(tenantId)
        const offset = parseInt(cfg?.order_num_offset) || 0
        const row = db.prepare('SELECT COALESCE(MAX(order_num),0) as mx FROM orders WHERE tenant_id=? AND id>?').get(tenantId, offset)
        const next = (row?.mx || 0) + 1
        db.prepare('UPDATE orders SET order_num=? WHERE rowid=?').run(next, rowid)
      })
      txFn(tid, orderId)
    } catch(e) { log('WARN', '[chat-order] order_num falhou:', e.message) }
    const order = db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(orderId, tid)
    try { if (typeof aplicarBaixaEstoquePedido === 'function') aplicarBaixaEstoquePedido(tid, order, 'chat-order-create') } catch(e) {}
    try { if (typeof emit === 'function') emit(tid, 'orders', order, 'INSERT') } catch(e) {}
    db.prepare(`UPDATE order_chat_threads
      SET order_id=?, order_num=?, updated_at=datetime('now')
      WHERE id=? AND tenant_id=?`).run(order.id, order.order_num || null, thread.id, tid)
    db.prepare(`UPDATE order_chat_drafts
      SET items='[]', delivery_type=NULL, addr=NULL, pag=NULL, step='items', status='draft', meta='{}', updated_at=datetime('now')
      WHERE tenant_id=? AND thread_id=?`).run(tid, thread.id)
    marcarDirty()
    return db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(order.id, tid)
  }
  const _chatAddBot = (thread, body, order = null, kind = 'assistant') => {
    if (!thread || !body) return null
    if (typeof chatAddMessageToThread === 'function') {
      return chatAddMessageToThread(thread, {
        sender: 'store',
        kind,
        author_name: 'EstimaIA',
        body
      }, order)
    }
    return null
  }
  const _chatOrderItemsLines = (order, fallbackText = '') => {
    const items = (() => {
      try {
        if (Array.isArray(order?.items)) return order.items
        return JSON.parse(order?.items || '[]') || []
      } catch { return [] }
    })()
    const lines = (items || [])
      .filter(i => i && i.item_status !== 'cancelado' && i.status !== 'cancelado')
      .map(i => {
        const qty = i.qty || i.quantity || 1
        const name = String(i.name || i.nome || 'Item').trim()
        const obs = String(i.obs || i.observacao || i.note || '').trim()
        const base = `- ${qty}x ${name || 'Item'}`
        if (!obs) return base
        const details = obs.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean)
        return details.length ? `${base}\n  ${details.join('\n  ')}` : base
      })
    if (lines.length) return lines.join('\n')
    return String(fallbackText || '')
      .split(/\s*,\s*/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => `- ${s}`)
      .join('\n')
  }
  const _chatOrderAnswer = (order) => {
    if (!order) return ''
    const pub = (() => { try { return chatOrderPublic(order) || {} } catch { return {} } })()
    const itens = pub.items_text || ''
    const itensLista = _chatOrderItemsLines(order, itens)
    const num = _chatShortNum(order)
    const status = pub.status_label || order.status || 'em andamento'
    const statusRaw = String(order.status || '').toLowerCase()
    const pagRaw = String(order.pag || '').toLowerCase()
    const aguardandoOnline = statusRaw === 'aguardando_cartao' || (statusRaw === 'aguardando_pix' && pagRaw !== 'pix_manual')
    const titulo = num ? `Pedido #${num}` : (aguardandoOnline ? 'Pedido aguardando pagamento' : 'Seu pedido')
    const total = (parseFloat(order.total || 0) || 0) + (parseFloat(order.taxa || 0) || 0)
    const pag = String(order.pag || '').replace(/_/g, ' ') || ''
    const addr = String(order.addr || '').trim()
    const when = (() => {
      try {
        const raw = String(order.updated_at || order.created_at || '').trim()
        const iso = raw ? raw.replace(' ', 'T') : ''
        const d = iso ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z') : new Date()
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
      } catch { return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) }
    })()
    const blocos = [
      `Claro. ${titulo} esta ${status}.`,
      itensLista ? `Itens\n${itensLista}` : '',
      `Valores\nTotal: R$ ${_chatFmt(total)}`,
      pag ? `Pagamento\n${pag}` : '',
      addr ? `Endereco/retirada\n${addr}` : '',
      `Atualizacao\n${when} (horario de Brasilia)`,
      'Mensagem\nPara falar com a loja sobre este pedido, envie sua mensagem por aqui.'
    ].filter(Boolean)
    return blocos.join('\n\n')
  }
  const _chatAssistant = (tid, thread, incomingText, order = null) => {
    const text = String(incomingText || '').trim()
    if (!tid || !thread || !text) return
    const phone = _chatDigits(thread.phone)
    const n = _chatNorm(text)
    const statusIntent = /\b(status|situacao|andamento|acompanhar|rastrear|rastreamento|pedido|meu pedido|cad[eê]|cade|demora|demorando|atrasou|atrasado|tempo|previsao|quanto falta|saiu|pronto|preparo|preparando|entrega|entregador|chega|chegar|onde esta|como esta)\b/.test(n)
      && !/\b(pedir|adicionar|mais|comprar|novo pedido|fazer pedido)\b/.test(n)
    const sensitiveIntent = /\b(cancelar|alterar|mudar|trocar|corrigir|endereco|problema|reclamacao|reembolso|devolver|errado|faltou|faltando)\b/.test(n)
    if (_chatBotPaused(tid, phone) && !(order && statusIntent)) return
    if (/\b(atendente|humano|pessoa|loja|responsavel|falar com)\b/.test(n)) {
      _chatPauseBot(tid, phone)
      _chatAddBot(thread, 'Certo, vou deixar a loja assumir por aqui. Em instantes alguem da equipe responde voce.', order)
      return
    }
    if (order && sensitiveIntent) {
      _chatPauseBot(tid, phone)
      _chatAddBot(thread, 'Entendi. Para evitar qualquer erro neste pedido, vou deixar a loja assumir por aqui. Em instantes alguem da equipe responde voce. Enquanto isso, o acompanhamento atual e:\n\n' + _chatOrderAnswer(order), order)
      return
    }
    if (order && statusIntent) {
      _chatAddBot(thread, _chatOrderAnswer(order), order)
      return
    }
    const trackingOnlyMsg = order
      ? 'Este chat e apenas para acompanhar este pedido. Para fazer um novo pedido, use o cardapio da loja. Se precisar de ajuda com este pedido, a equipe responde por aqui.'
      : 'Este chat fica disponivel apenas depois que um pedido e realizado. Para pedir, use o cardapio da loja.'
    if (!order || /\b(cardapio|menu|opcoes|pedir|pedido novo|novo pedido|adicionar|mais|confirmar|finalizar|fechar pedido|concluir|entrega|retirada|mesa|pix|dinheiro|credito|debito|comprar|produto|item|sabor|borda|adicional)\b/.test(n)) {
      _chatAddBot(thread, trackingOnlyMsg, order)
      return
    }
    _chatAddBot(thread, _chatOrderAnswer(order), order)
    return

    const draft = _chatDraft(tid, thread)
    if (!draft) return
    draft.phone = phone
    draft.client = draft.client || thread.client || ''
    if (/\b(alterar|mudar|trocar|corrigir|editar)\b.*\b(endereco|bairro|localizacao|localizacao|entrega)\b/.test(n)) {
      if (order && !draft.items.length) {
        _chatPauseBot(tid, phone)
        _chatAddBot(thread, 'Para alterar endereco de um pedido ja enviado, vou deixar a loja confirmar por aqui para evitar erro na entrega.', order)
        return
      }
      draft.delivery_type = 'delivery'
      draft.addr = null
      draft.step = 'addr'
      draft.meta = Object.assign({}, draft.meta || {}, { delivery_taxa: null, delivery_bairro: null, geo: null })
      _chatSaveDraft(draft)
      _chatAddBot(thread, _chatAddressPrompt(tid), order)
      return
    }
    if (draft.meta?.pending_addons && _chatHandlePendingAddons(tid, thread, draft, text, order)) return
    if (/\b(cancelar|limpar|recomecar|zerar)\b/.test(n)) {
      _chatClearDraft(draft)
      _chatAddBot(thread, 'Combinado, zerei o pedido guiado. Me diga o item que deseja adicionar ou escreva "cardapio".', order)
      return
    }
    if (/\b(cardapio|menu|opcoes|opcoes)\b/.test(n)) {
      _chatAddBot(thread, _chatListMenu(tid), order)
      return
    }

    const delivery = _chatDeliveryFromText(text)
    if (delivery) {
      draft.delivery_type = delivery
      draft.step = delivery === 'delivery' ? 'addr' : 'payment'
      if (delivery === 'mesa') {
        const mesa = n.match(/\bmesa\s*(\d+)\b/)
        if (mesa) draft.addr = mesa[1]
      }
      _chatSaveDraft(draft)
      if (delivery === 'delivery') _chatAddBot(thread, _chatAddressPrompt(tid), order)
      else _chatAddBot(thread, 'Certo. Qual sera a forma de pagamento? Pode ser Pix, dinheiro, credito ou debito.', order)
      return
    }

    const pay = _chatPayFromText(text)
    if (pay) {
      draft.pag = pay
      draft.step = 'confirm'
      _chatSaveDraft(draft)
      _chatAddBot(thread, `${_chatDraftSummary(draft)}\n\nForma de pagamento: ${pay === 'pix_manual' ? 'Pix' : pay}.\nPara enviar para a loja, responda "confirmar pedido".`, order)
      return
    }

    if ((draft.step === 'addr' || draft.delivery_type === 'delivery') && draft.items.length && !draft.addr && text.length >= 4) {
      const checked = _chatValidateDeliveryAddress(tid, text, draft)
      _chatSaveDraft(draft)
      if (!checked.ok) {
        _chatAddBot(thread, checked.ask || _chatAddressPrompt(tid), order)
        return
      }
      draft.addr = checked.addr || text.slice(0, 240)
      draft.meta = draft.meta || {}
      if (checked.taxa != null) draft.meta.delivery_taxa = checked.taxa
      if (checked.bairro) draft.meta.delivery_bairro = checked.bairro
      draft.step = 'payment'
      _chatSaveDraft(draft)
      const taxaMsg = checked.taxa != null ? ` Taxa de entrega: R$ ${_chatFmt(checked.taxa)}.` : ''
      _chatAddBot(thread, `Endereco confirmado.${taxaMsg}\nQual sera a forma de pagamento? Pode ser Pix, dinheiro, credito ou debito.`, order)
      return
    }

    if (/\b(confirmar|finalizar|enviar pedido|pode enviar|fechar pedido|concluir)\b/.test(n)) {
      if (!draft.items.length) {
        _chatAddBot(thread, 'Ainda nao tenho itens no carrinho. Me diga o que deseja pedir ou escreva "cardapio".', order)
        return
      }
      if (!draft.delivery_type) {
        draft.step = 'delivery'
        _chatSaveDraft(draft)
        _chatAddBot(thread, `${_chatDraftSummary(draft)}\n\nVai ser entrega, retirada ou mesa?`, order)
        return
      }
      if (draft.delivery_type === 'delivery' && !draft.addr) {
        draft.step = 'addr'
        _chatSaveDraft(draft)
        _chatAddBot(thread, _chatAddressPrompt(tid), order)
        return
      }
      if (!draft.pag) {
        draft.step = 'payment'
        _chatSaveDraft(draft)
        _chatAddBot(thread, 'Qual sera a forma de pagamento? Pode ser Pix, dinheiro, credito ou debito.', order)
        return
      }
      try {
        const newOrder = _chatCreateOrderFromDraft(tid, thread, draft)
        const updatedThread = db.prepare('SELECT * FROM order_chat_threads WHERE id=? AND tenant_id=?').get(thread.id, tid)
        _chatAddBot(updatedThread, `Pedido #${_chatShortNum(newOrder)} enviado para a loja.\nA equipe recebeu no gestor e vai acompanhar por aqui.\n\nSeu cadastro ficou salvo neste chat. Para fazer outro pedido, basta me enviar o item desejado ou escrever "cardapio".`, newOrder, 'status')
      } catch(e) {
        _chatAddBot(thread, `Nao consegui finalizar automaticamente: ${e.message}. Vou chamar a loja para conferir.`, order)
      }
      return
    }

    const rows = _chatMenuRows(tid)
    const sizeKey = _chatSizeFromText(text)
    const isHalf = /\b(meia|meio|metade)\b/.test(n)
    if (isHalf) {
      const pizzas = rows.filter(r => _chatPizzaSizes(r))
      const hits = _chatItemMatches(pizzas, text).slice(0, 2).map(x => x.row)
      if (hits.length >= 2 && sizeKey) {
        const p1 = _chatSizePrice(hits[0], sizeKey)
        const p2 = _chatSizePrice(hits[1], sizeKey)
        const regra = p1.cfg?.regra || p2.cfg?.regra || 'maior'
        const price = regra === 'media' ? ((p1.price + p2.price) / 2) : Math.max(p1.price, p2.price)
        const label = p1.label || p2.label || sizeKey
        draft.items.push({
          id: hits[0].id,
          qty: 1,
          name: `Pizza ${label} meia ${hits[0].name} / meia ${hits[1].name}`,
          price,
          base_price: price,
          base_obs: `Tamanho: ${label}. Meio a meio.`,
          obs: `Tamanho: ${label}. Meio a meio.`,
          sizeKey,
          addons: {},
          _source: hits[0]
        })
        draft.step = 'items'
        _chatSaveDraft(draft)
        if (_chatStartAddonFlow(tid, draft, draft.items.length - 1, thread, order)) return
        _chatAddBot(thread, `${draft.items[draft.items.length - 1].name} adicionada ao carrinho.\n${_chatDraftSummary(draft)}\n\nDeseja adicionar mais algum item ou finalizar?`, order)
        return
      }
      if (!sizeKey) {
        _chatAddBot(thread, 'Para pizza meio a meio, me diga tambem o tamanho: pequena, media ou grande. Exemplo: pizza grande meia calabresa meia frango.', order)
        return
      }
    }

    const matches = _chatItemMatches(rows, text)
    if (matches.length) {
      const item = matches[0].row
      const qty = _chatQtyFromText(text)
      const pizzaCfg = _chatPizzaSizes(item)
      let price = parseFloat(item.price || 0) || 0
      let obs = ''
      let name = item.name
      if (pizzaCfg) {
        if (!sizeKey) {
          const opts = pizzaCfg.tamanhos.map(t => `${t.nome || t.key} (R$ ${_chatFmt(t.preco)})`).join(', ')
          _chatAddBot(thread, `Qual tamanho da pizza ${item.name}? Opcoes: ${opts}.`, order)
          return
        }
        const sized = _chatSizePrice(item, sizeKey)
        price = sized.price
        obs = `Tamanho: ${sized.label || sizeKey}.`
        name = `Pizza ${sized.label || sizeKey} ${item.name}`
      }
      draft.items.push({ id: item.id, qty, name, price, base_price: price, base_obs: obs, obs, sizeKey: sizeKey || '', addons: {}, _source: item })
      draft.step = 'items'
      _chatSaveDraft(draft)
      if (_chatStartAddonFlow(tid, draft, draft.items.length - 1, thread, order)) return
      _chatAddBot(thread, `${qty}x ${name} adicionado ao carrinho.\n${_chatDraftSummary(draft)}\n\nDeseja adicionar mais algum item ou finalizar?`, order)
      return
    }

    if (!draft.items.length) {
      _chatAddBot(thread, 'Posso montar seu pedido por aqui. Escreva o nome do item que deseja ou mande "cardapio" para ver algumas opcoes.', order)
    } else {
      _chatAddBot(thread, 'Nao encontrei esse item com seguranca. Voce pode escrever "cardapio", adicionar outro item ou responder "confirmar pedido".', order)
    }
  }

  if (upath.startsWith('/api/chat/')) {
    const tid = req.headers['x-tenant-id'] || params.get('tenant_id') || ''
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }

    try {
      if (req.method === 'GET' && upath === '/api/chat/threads') {
        if (!_chatRequireStore()) return true
        const limit = Math.min(200, Math.max(1, parseInt(params.get('limit') || '100', 10) || 100))
        const rows = db.prepare(`SELECT * FROM order_chat_threads
          WHERE tenant_id=? AND COALESCE(order_id,0)>0
          ORDER BY datetime(COALESCE(last_at, updated_at, created_at)) DESC, id DESC
          LIMIT ?`).all(tid, limit)
        const getOrder = db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?')
        const threads = rows.map(t => _chatThreadOut(t, getOrder.get(t.order_id, tid)))
        send(res, 200, { ok: true, threads })
        return true
      }

      if (req.method === 'POST' && upath === '/api/chat/start') {
        send(res, 400, { error: 'Chat disponivel apenas para acompanhar pedidos ja realizados.' })
        return true
      }

      if (req.method === 'GET' && upath === '/api/chat/bootstrap') {
        const orderId = parseInt(params.get('order_id') || '0', 10)
        const phone = _chatDigits(params.get('phone') || '')
        const role = String(params.get('role') || '').toLowerCase()
        const storeMode = role === 'store'
        if (!orderId && !phone) { send(res, 400, { error: 'order_id ou telefone obrigatorio' }); return true }
        if (!orderId && phone) {
          send(res, 400, { error: 'Chat disponivel apenas para acompanhar pedidos ja realizados.' })
          return true
        }
        if (storeMode && !_chatRequireStore()) return true
        const order = _chatOrder(tid, orderId)
        if (!order) { send(res, 404, { error: 'Pedido nao encontrado' }); return true }
        if (!storeMode && !_chatMatches(order.phone, phone)) { send(res, 403, { error: 'Telefone nao confere com o pedido' }); return true }
        const thread = chatEnsureThreadFromOrder(order, { phone: phone || order.phone, client: order.client })
        if (!thread) { send(res, 400, { error: 'Pedido sem telefone para abrir chat' }); return true }
        const messages = _chatMessages(tid, thread.id, parseInt(params.get('after_id') || '0', 10) || 0).map(_chatMessageOut)
        send(res, 200, { ok: true, thread: _chatThreadOut(thread, order), messages, order: chatOrderPublic(order) })
        return true
      }

      if (req.method === 'GET' && upath === '/api/chat/messages') {
        const threadId = parseInt(params.get('thread_id') || '0', 10)
        const orderId = parseInt(params.get('order_id') || '0', 10)
        const afterId = parseInt(params.get('after_id') || '0', 10) || 0
        const phone = _chatDigits(params.get('phone') || '')
        const role = String(params.get('role') || '').toLowerCase()
        const storeMode = role === 'store'
        if (storeMode && !_chatRequireStore()) return true
        let thread = threadId ? db.prepare('SELECT * FROM order_chat_threads WHERE id=? AND tenant_id=?').get(threadId, tid) : null
        let order = thread && Number(thread.order_id || 0) > 0 ? _chatOrder(tid, thread.order_id) : null
        if (!thread && orderId) {
          order = _chatOrder(tid, orderId)
          if (!order) { send(res, 404, { error: 'Pedido nao encontrado' }); return true }
          if (!storeMode && !_chatMatches(order.phone, phone)) { send(res, 403, { error: 'Telefone nao confere com o pedido' }); return true }
          thread = chatEnsureThreadFromOrder(order, { phone: phone || order.phone, client: order.client })
        }
        if (!thread) { send(res, 404, { error: 'Chat nao encontrado' }); return true }
        if (!storeMode && !_chatMatches(thread.phone, phone)) { send(res, 403, { error: 'Telefone nao confere com o chat' }); return true }
        const messages = _chatMessages(tid, thread.id, afterId).map(_chatMessageOut)
        send(res, 200, { ok: true, thread: _chatThreadOut(thread, order), messages, order: chatOrderPublic(order) })
        return true
      }

      if (req.method === 'POST' && upath === '/api/chat/send') {
        const body = await readBody(req)
        const orderId = parseInt(body.order_id || '0', 10)
        const threadId = parseInt(body.thread_id || '0', 10)
        const sender = body.sender === 'store' ? 'store' : 'client'
        const phone = _chatDigits(body.phone || '')
        const text = String(body.body || body.message || '').trim().slice(0, 1000)
        if ((!orderId && !threadId) || !text) { send(res, 400, { error: 'chat e mensagem obrigatorios' }); return true }
        if (sender === 'store' && !_chatRequireStore()) return true
        let thread = threadId ? db.prepare('SELECT * FROM order_chat_threads WHERE id=? AND tenant_id=?').get(threadId, tid) : null
        let order = null
        if (orderId) {
          order = _chatOrder(tid, orderId)
          if (!order) { send(res, 404, { error: 'Pedido nao encontrado' }); return true }
          if (sender === 'client' && !_chatMatches(order.phone, phone)) { send(res, 403, { error: 'Telefone nao confere com o pedido' }); return true }
          thread = thread || chatEnsureThreadFromOrder(order, { phone: phone || order.phone, client: order.client })
        }
        if (!thread && !orderId && sender === 'client') {
          send(res, 400, { error: 'Chat disponivel apenas para acompanhar pedidos ja realizados.' })
          return true
        }
        if (!thread) { send(res, 404, { error: 'Chat nao encontrado' }); return true }
        if (sender === 'client' && !_chatMatches(thread.phone, phone)) { send(res, 403, { error: 'Telefone nao confere com o chat' }); return true }
        if (!order && Number(thread.order_id || 0) > 0) order = _chatOrder(tid, thread.order_id)
        if (!order) {
          send(res, 400, { error: 'Chat disponivel apenas para acompanhar pedidos ja realizados.' })
          return true
        }
        const author = sender === 'store'
          ? String(body.author_name || req.headers['x-user-id'] || 'Loja')
          : String(order?.client || thread.client || body.client || 'Cliente')
        const result = chatAddMessageFromOrder(order, {
          sender,
          kind: 'text',
          body: text,
          author_name: author,
          phone: phone || order.phone
        })
        if (!result) { send(res, 500, { error: 'Nao foi possivel enviar a mensagem' }); return true }
        if (sender === 'store') _chatPauseBot(tid, thread.phone || order?.phone)
        let responseThread = result.thread
        let responseOrder = order
        if (sender === 'client') {
          try {
            const latestThread = db.prepare('SELECT * FROM order_chat_threads WHERE id=? AND tenant_id=?').get(result.thread.id, tid)
            _chatAssistant(tid, latestThread || result.thread, text, order)
            responseThread = db.prepare('SELECT * FROM order_chat_threads WHERE id=? AND tenant_id=?').get(result.thread.id, tid) || latestThread || result.thread
            if (Number(responseThread?.order_id || 0) > 0) responseOrder = _chatOrder(tid, responseThread.order_id) || order
          } catch(e) { log('WARN', '[chat-assistant] falhou:', e.message) }
        }
        send(res, 200, {
          ok: true,
          thread: _chatThreadOut(responseThread, responseOrder),
          message: _chatMessageOut(result.message),
          order: chatOrderPublic(responseOrder)
        })
        return true
      }

      if (req.method === 'POST' && upath === '/api/chat/read') {
        const body = await readBody(req)
        const viewer = body.viewer === 'store' ? 'store' : 'client'
        const threadId = parseInt(body.thread_id || '0', 10)
        const orderId = parseInt(body.order_id || '0', 10)
        const phone = _chatDigits(body.phone || '')
        if (viewer === 'store' && !_chatRequireStore()) return true
        let thread = threadId ? db.prepare('SELECT * FROM order_chat_threads WHERE id=? AND tenant_id=?').get(threadId, tid) : null
        if (!thread && orderId) thread = _chatThreadByOrder(tid, orderId)
        if (!thread) { send(res, 404, { error: 'Chat nao encontrado' }); return true }
        if (viewer === 'client' && !_chatMatches(thread.phone, phone)) { send(res, 403, { error: 'Telefone nao confere com o chat' }); return true }
        const field = viewer === 'store' ? 'unread_store' : 'unread_client'
        db.prepare(`UPDATE order_chat_threads SET ${field}=0, updated_at=datetime('now') WHERE id=? AND tenant_id=?`).run(thread.id, tid)
        marcarDirty()
        const updated = db.prepare('SELECT * FROM order_chat_threads WHERE id=? AND tenant_id=?').get(thread.id, tid)
        const order = Number(updated.order_id || 0) > 0 ? _chatOrder(tid, updated.order_id) : null
        sseBroadcast(`chat-rt:${tid}`, 'chat:read', { thread: _chatThreadOut(updated, order), viewer })
        const p = _chatDigits(updated.phone)
        if (p) {
          sseBroadcast(`chat-client:${tid}:${updated.order_id || 0}:${p}`, 'chat:read', { thread: _chatThreadOut(updated, order), viewer })
          if (Number(updated.order_id || 0) !== 0) sseBroadcast(`chat-client:${tid}:0:${p}`, 'chat:read', { thread: _chatThreadOut(updated, order), viewer })
        }
        send(res, 200, { ok: true, thread: _chatThreadOut(updated, order) })
        return true
      }
    } catch(e) {
      log('ERRO', `[chat] ${req.method} ${upath}:`, e.message)
      send(res, 500, { error: e.message })
      return true
    }

    send(res, 404, { error: 'Rota de chat nao encontrada' })
    return true
  }

  const _parseOrderItemsDelivery = (items) => {
    if (Array.isArray(items)) return items
    try { return items ? JSON.parse(items) : [] } catch { return [] }
  }
  const _isDeliveryOrder = (order) => {
    if (!order) return false
    if (order.mesa_num && Number(order.mesa_num) > 0) return false
    const addr = String(order.addr || '').trim()
    if (/^Mesa\b/i.test(addr)) return false
    if (/^Retirada\b/i.test(addr)) return false
    const lower = addr.toLowerCase()
    if (lower.includes('balcao') || lower.includes('balcão')) return false
    return !!addr
  }
  const _orderTotalDelivery = (order) => {
    return parseFloat(order?.total || 0) + parseFloat(order?.taxa || 0)
  }
  const _valorReceberEntrega = (order) => {
    const pag = String(order?.pag || '').toLowerCase()
    const momento = String(order?.pag_momento || '').toLowerCase()
    const online = momento === 'online' || ['pix','pix_mp','pix_manual','cartao_mp'].includes(pag)
    return online ? 0 : _orderTotalDelivery(order)
  }
  const _comissaoEntrega = (entregador, order) => {
    const valor = parseFloat(entregador?.comissao_valor || 0)
    if (!valor) return 0
    if (String(entregador?.comissao_tipo || '') === 'percent') {
      return Math.round(_orderTotalDelivery(order) * valor) / 100
    }
    return valor
  }
  const _bairroEntrega = (addr) => {
    const parts = String(addr || '').split(',').map(p => p.trim()).filter(Boolean)
    return parts[2] || parts[1] || ''
  }
  const _orderOutDelivery = (row) => {
    if (!row) return row
    return { ...row, items: _parseOrderItemsDelivery(row.items) }
  }
  const _emitOrderDelivery = (tid, order) => {
    if (!tid || !order) return
    sseBroadcast(`orders-rt:${tid}`, 'orders:UPDATE', _orderOutDelivery(order))
  }
  const _emitEntregas = (tid, event, payload) => {
    if (!tid) return
    sseBroadcast(`entregas-rt:${tid}`, event, payload || { ts: Date.now() })
  }
  const _statusHistDelivery = (tid, orderId, oldStatus, newStatus, meta = {}) => {
    if (!tid || !orderId || !newStatus || oldStatus === newStatus) return
    try {
      db.prepare(`INSERT INTO order_status_history
        (tenant_id, order_id, old_status, new_status, actor_type, actor_id, actor_name, origem, note)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
          tid, orderId, oldStatus || null, newStatus,
          meta.actor_type || 'entregas',
          meta.actor_id || null,
          meta.actor_name || null,
          meta.origem || 'entregas',
          meta.note || null
        )
      marcarDirty()
    } catch(e) { log('⚠️', 'historico entrega status:', e.message) }
  }
  const _recalcularRotaEntrega = (tid, rotaId) => {
    if (!tid || !rotaId) return null
    const stats = db.prepare(`
      SELECT COUNT(*) as pedidos_count,
             COALESCE(SUM(valor_pedido),0) as total_pedidos,
             COALESCE(SUM(valor_receber),0) as dinheiro_previsto,
             COALESCE(SUM(comissao),0) as comissao_total
      FROM entregas
      WHERE tenant_id=? AND rota_id=?
    `).get(tid, rotaId)
    db.prepare(`UPDATE rotas_entrega
      SET pedidos_count=?, total_pedidos=?, dinheiro_previsto=?, comissao_total=?, updated_at=datetime('now')
      WHERE id=? AND tenant_id=?`).run(
        stats?.pedidos_count || 0,
        stats?.total_pedidos || 0,
        stats?.dinheiro_previsto || 0,
        stats?.comissao_total || 0,
        rotaId,
        tid
      )
    return db.prepare('SELECT * FROM rotas_entrega WHERE id=? AND tenant_id=?').get(rotaId, tid)
  }

  const _deliveryDashboard = (tid) => {
    const entregadores = db.prepare('SELECT * FROM entregadores WHERE tenant_id=? ORDER BY ativo DESC, nome ASC').all(tid)
    const pedidosRows = db.prepare(`
      SELECT o.*,
             e.id as entrega_id, e.status as entrega_status, e.entregador_id, e.rota_id,
             e.valor_receber, e.comissao, e.assigned_at, e.saiu_at, e.entregue_at, e.problema,
             d.nome as entregador_nome, d.telefone as entregador_telefone,
             l.lat as entregador_lat, l.lng as entregador_lng, l.accuracy as entregador_accuracy, l.updated_at as entregador_gps_at
      FROM orders o
      LEFT JOIN entregas e ON e.tenant_id=o.tenant_id AND e.order_id=o.id
      LEFT JOIN entregadores d ON d.id=e.entregador_id
      LEFT JOIN entregador_locations l ON l.tenant_id=o.tenant_id AND l.entregador_id=e.entregador_id
      WHERE o.tenant_id=? AND o.status IN ('pronto','saiu')
      ORDER BY o.created_at ASC
    `).all(tid).filter(_isDeliveryOrder)
    const fila = pedidosRows
      .filter(o => o.status === 'pronto' && (!o.entrega_status || ['pendente','cancelada','retornada'].includes(o.entrega_status)))
      .map(o => ({ ..._orderOutDelivery(o), bairro: _bairroEntrega(o.addr), total_pedido: _orderTotalDelivery(o), valor_receber_calc: _valorReceberEntrega(o) }))
    const ativas = pedidosRows
      .filter(o => o.entrega_status && ['atribuida','em_rota','problema'].includes(o.entrega_status))
      .map(o => ({ ..._orderOutDelivery(o), bairro: _bairroEntrega(o.addr), total_pedido: _orderTotalDelivery(o) }))
    const semEntregador = pedidosRows
      .filter(o => o.status === 'saiu' && !o.entrega_status)
      .map(o => ({ ..._orderOutDelivery(o), bairro: _bairroEntrega(o.addr), total_pedido: _orderTotalDelivery(o), valor_receber_calc: _valorReceberEntrega(o) }))
    const concluidasHoje = db.prepare(`
      SELECT e.*, o.order_num, o.client, o.phone, o.addr, o.total, o.taxa, o.pag, d.nome as entregador_nome
      FROM entregas e
      LEFT JOIN orders o ON o.id=e.order_id
      LEFT JOIN entregadores d ON d.id=e.entregador_id
      WHERE e.tenant_id=? AND e.status='entregue' AND date(e.entregue_at)=date('now')
      ORDER BY e.entregue_at DESC
      LIMIT 80
    `).all(tid).map(r => ({ ...r, bairro: _bairroEntrega(r.addr), total_pedido: _orderTotalDelivery(r) }))
    const rotas = db.prepare(`
      SELECT r.*, d.nome as entregador_nome
      FROM rotas_entrega r
      LEFT JOIN entregadores d ON d.id=r.entregador_id
      WHERE r.tenant_id=? AND r.status IN ('aberta','em_rota')
      ORDER BY r.created_at DESC
      LIMIT 30
    `).all(tid)
    const resumo = {
      prontos: fila.length + semEntregador.length,
      em_rota: ativas.filter(e => e.entrega_status === 'em_rota').length,
      atribuidas: ativas.filter(e => e.entrega_status === 'atribuida').length,
      problemas: ativas.filter(e => e.entrega_status === 'problema').length,
      entregues_hoje: concluidasHoje.length,
      dinheiro_rua: ativas.reduce((s,e) => s + parseFloat(e.valor_receber || 0), 0),
      comissao_aberta: ativas.reduce((s,e) => s + parseFloat(e.comissao || 0), 0)
    }
    return { entregadores, fila, ativas, sem_entregador: semEntregador, concluidas_hoje: concluidasHoje, rotas, resumo }
  }

  if (req.method === 'POST' && upath === '/api/entregadores/salvar') {
    const tid = req.headers['x-tenant-id'] || params.get('tenant_id') || ''
    if (!tid) { send(res, 400, { error: 'Sessao sem tenant. Recarregue o gestor.' }); return true }
    const body = await readBody(req)
    const id = parseInt(body.id || '0')
    const nome = String(body.nome || '').trim()
    const telefone = String(body.telefone || '').trim()
    const comissaoTipo = ['fixa', 'percent'].includes(String(body.comissao_tipo || '')) ? String(body.comissao_tipo) : 'fixa'
    const comissaoValor = parseFloat(body.comissao_valor || 0) || 0
    const ativo = body.ativo === undefined ? 1 : (body.ativo ? 1 : 0)
    try {
      if (id) {
        const atual = db.prepare('SELECT * FROM entregadores WHERE id=? AND tenant_id=?').get(id, tid)
        if (!atual) { send(res, 404, { error: 'Entregador nao encontrado' }); return true }
        const novoNome = nome || atual.nome
        if (!novoNome) { send(res, 400, { error: 'Informe o nome do entregador' }); return true }
        db.prepare(`UPDATE entregadores
          SET nome=?, telefone=?, comissao_tipo=?, comissao_valor=?, ativo=?
          WHERE id=? AND tenant_id=?`)
          .run(
            novoNome,
            body.telefone === undefined ? (atual.telefone || '') : telefone,
            body.comissao_tipo === undefined ? (atual.comissao_tipo || 'fixa') : comissaoTipo,
            body.comissao_valor === undefined ? (parseFloat(atual.comissao_valor || 0) || 0) : comissaoValor,
            body.ativo === undefined ? (Number(atual.ativo) !== 0 ? 1 : 0) : ativo,
            id,
            tid
          )
        const row = db.prepare('SELECT * FROM entregadores WHERE id=? AND tenant_id=?').get(id, tid)
        _emitEntregas(tid, 'entregadores:UPDATE', row)
        marcarDirty()
        send(res, 200, { ok: true, entregador: row })
        return true
      }
      if (!nome) { send(res, 400, { error: 'Informe o nome do entregador' }); return true }
      const info = db.prepare(`INSERT INTO entregadores
        (tenant_id, nome, telefone, comissao_tipo, comissao_valor, ativo)
        VALUES (?,?,?,?,?,?)`)
        .run(tid, nome, telefone, comissaoTipo, comissaoValor, ativo)
      const row = db.prepare('SELECT * FROM entregadores WHERE id=? AND tenant_id=?').get(info.lastInsertRowid, tid)
      _emitEntregas(tid, 'entregadores:INSERT', row)
      marcarDirty()
      send(res, 201, { ok: true, entregador: row })
    } catch(e) {
      log('ERRO', '/api/entregadores/salvar:', e.message)
      send(res, 400, { error: e.message })
    }
    return true
  }

  const ENTREGADOR_SESSION_TTL = 14 * 24 * 60 * 60 * 1000
  const _digits = (v) => String(v || '').replace(/\D/g, '')
  const _driverToken = (req) => {
    const auth = req.headers['authorization'] || ''
    if (auth.startsWith('Bearer ')) return auth.slice(7).trim()
    return String(req.headers['x-entregador-token'] || '').trim()
  }
  const _validarEntregador = (req) => {
    const token = _driverToken(req)
    if (!token) return null
    const sess = db.prepare('SELECT * FROM entregador_sessions WHERE token=?').get(token)
    if (!sess) return null
    if (Date.now() - Number(sess.ts || 0) > ENTREGADOR_SESSION_TTL) {
      db.prepare('DELETE FROM entregador_sessions WHERE token=?').run(token)
      return null
    }
    const entregador = db.prepare('SELECT * FROM entregadores WHERE id=? AND tenant_id=? AND ativo=1').get(sess.entregador_id, sess.tenant_id)
    if (!entregador) return null
    return { ...sess, entregador }
  }
  const _driverOrderNum = (order) => order?.order_num || order?.id || order?.order_id || ''
  const _driverEntregaRow = (row) => {
    if (!row) return row
    return {
      ...row,
      items: _parseOrderItemsDelivery(row.items),
      bairro: _bairroEntrega(row.addr),
      total_pedido: _orderTotalDelivery(row)
    }
  }
  let _entregasSequenciaReady = false
  const _ensureEntregaSequencia = () => {
    if (_entregasSequenciaReady) return
    const cols = new Set(db.prepare("PRAGMA table_info(entregas)").all().map(c => c.name))
    if (!cols.has('sequencia')) {
      try {
        db.exec("ALTER TABLE entregas ADD COLUMN sequencia INTEGER")
      } catch(e) {
        if (!/duplicate column name/i.test(String(e?.message || ''))) throw e
      }
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_entregas_rota_seq ON entregas(tenant_id, entregador_id, status, sequencia)")
    _entregasSequenciaReady = true
  }
  const _driverEntregas = (tid, entregadorId) => {
    _ensureEntregaSequencia()
    const abertas = db.prepare(`
      SELECT e.*, o.order_num, o.client, o.phone, o.addr, o.items, o.total, o.taxa, o.pag, o.pag_momento, o.troco,
             o.status as order_status, o.created_at as order_created_at,
             l.lat as entregador_lat, l.lng as entregador_lng, l.accuracy as entregador_accuracy, l.updated_at as entregador_gps_at
      FROM entregas e
      JOIN orders o ON o.id=e.order_id AND o.tenant_id=e.tenant_id
      LEFT JOIN entregador_locations l ON l.tenant_id=e.tenant_id AND l.entregador_id=e.entregador_id
      WHERE e.tenant_id=? AND e.entregador_id=? AND e.status IN ('atribuida','em_rota','problema')
      ORDER BY COALESCE(e.sequencia, 999999) ASC, COALESCE(e.saiu_at,e.assigned_at,e.created_at) ASC, e.id ASC
    `).all(tid, entregadorId).map(_driverEntregaRow)
    const concluidas = db.prepare(`
      SELECT e.*, o.order_num, o.client, o.phone, o.addr, o.items, o.total, o.taxa, o.pag, o.pag_momento, o.troco,
             o.status as order_status, o.created_at as order_created_at
      FROM entregas e
      JOIN orders o ON o.id=e.order_id AND o.tenant_id=e.tenant_id
      WHERE e.tenant_id=? AND e.entregador_id=? AND e.status='entregue' AND date(e.entregue_at)=date('now')
      ORDER BY e.entregue_at DESC
      LIMIT 30
    `).all(tid, entregadorId).map(_driverEntregaRow)
    const location = db.prepare('SELECT * FROM entregador_locations WHERE tenant_id=? AND entregador_id=?').get(tid, entregadorId) || null
    return { abertas, concluidas, location }
  }
  const _driverDisponiveis = (tid) => {
    return db.prepare(`
      SELECT o.*,
             e.id as entrega_id, e.status as entrega_status, e.entregador_id, e.rota_id
      FROM orders o
      LEFT JOIN entregas e ON e.tenant_id=o.tenant_id AND e.order_id=o.id
      WHERE o.tenant_id=? AND o.status='pronto'
      ORDER BY o.created_at ASC, o.id ASC
    `).all(tid)
      .filter(_isDeliveryOrder)
      .filter(o => !o.entrega_status || ['pendente','cancelada','retornada'].includes(String(o.entrega_status || '')))
      .map(o => ({
        ..._orderOutDelivery(o),
        bairro: _bairroEntrega(o.addr),
        total_pedido: _orderTotalDelivery(o),
        valor_receber_calc: _valorReceberEntrega(o)
      }))
  }
  const _driverNextSeq = (tid, entregadorId) => {
    _ensureEntregaSequencia()
    const row = db.prepare(`
      SELECT COALESCE(MAX(sequencia), 0) as max_seq
      FROM entregas
      WHERE tenant_id=? AND entregador_id=? AND status IN ('atribuida','em_rota','problema')
    `).get(tid, entregadorId)
    return (parseInt(row?.max_seq || 0) || 0) + 1
  }
  const _driverMensagem = (tipo, order, entregador, custom) => {
    const nome = String(order?.client || 'Cliente').split(' ')[0] || 'Cliente'
    const pedido = _driverOrderNum(order)
    const loja = 'Pedido #' + pedido
    const presets = {
      a_caminho: `Ola, ${nome}! Seu ${loja} saiu para entrega. Estou indo ate voce agora.`,
      cheguei: `Ola, ${nome}! Ja cheguei com seu ${loja}. Pode me receber, por favor?`,
      nao_achei: `Ola, ${nome}! Estou proximo com seu ${loja}, mas nao estou encontrando o endereco. Pode me mandar uma referencia?`,
      atraso: `Ola, ${nome}! Estou a caminho com seu ${loja}, mas peguei um pequeno atraso na rota. Chego em alguns minutos.`,
      retorno: `Ola, ${nome}! Tentei entregar seu ${loja}, mas nao consegui contato. Vou avisar a loja para orientar o proximo passo.`
    }
    if (tipo === 'custom') return String(custom || '').trim().slice(0, 320)
    return presets[tipo] || presets.cheguei
  }
  const _normalizeAdminAlertInput = (body) => {
    const tipos = new Set(['aviso', 'promocao', 'alerta', 'novidade'])
    const modos = new Set(['banner', 'popup', 'both', 'robo'])
    const fontes = new Set(['outfit', 'dm-sans', 'plus-jakarta', 'inter', 'system', 'serif', 'mono'])
    const color = (v, fallback = '') => {
      const s = String(v || '').trim()
      return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : fallback
    }
    const tipo = tipos.has(String(body.tipo || '').toLowerCase()) ? String(body.tipo).toLowerCase() : 'aviso'
    const displayMode = modos.has(String(body.display_mode || '').toLowerCase()) ? String(body.display_mode).toLowerCase() : 'banner'
    const titulo = String(body.titulo || '').trim().slice(0, 80)
    const mensagem = String(body.mensagem || '').trim().slice(0, 5000)
    if (!mensagem) throw new Error('Mensagem obrigatória')
    const bgColor = color(body.bg_color)
    const textColor = color(body.text_color)
    const fontFamily = fontes.has(String(body.font_family || '').toLowerCase()) ? String(body.font_family).toLowerCase() : 'outfit'
    // Botão opcional que abre o WhatsApp — só faz sentido em "banner"/"popup"/"robo"
    // com mensagem pronta (ex: falar sobre uma promoção). Guarda só os dígitos
    // do telefone; o link wa.me é montado na hora de exibir.
    const ctaLabel = String(body.cta_label || '').trim().slice(0, 40)
    const ctaWhatsappDigits = String(body.cta_whatsapp || '').replace(/\D/g, '')
    const ctaWhatsapp = ctaWhatsappDigits ? ctaWhatsappDigits.slice(0, 15) : ''
    const targetAll = body.target_all === false || body.target_all === 0 || body.target_all === '0' ? 0 : 1
    let targetTenants = Array.isArray(body.target_tenants) ? body.target_tenants.map(String).filter(Boolean) : []
    if (!targetAll) {
      const valid = new Set(db.prepare("SELECT id FROM tenants WHERE slug <> '_global'").all().map(t => String(t.id)))
      targetTenants = [...new Set(targetTenants.filter(id => valid.has(id)))]
      if (!targetTenants.length) throw new Error('Selecione pelo menos um cliente')
    } else {
      targetTenants = []
    }
    const ativo = body.ativo === false || body.ativo === 0 || body.ativo === '0' ? 0 : 1
    let expiresAt = String(body.expires_at || '').trim() || null
    if (expiresAt) {
      expiresAt = expiresAt.replace('T', ' ')
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(expiresAt)) expiresAt += ':00'
    }
    return { tipo, displayMode, titulo, mensagem, bgColor, textColor, fontFamily, ctaLabel, ctaWhatsapp, targetAll, targetTenants, ativo, expiresAt }
  }
  const indicadorComPermissaoGestor = (sess) => {
    if (!sess) return null
    return db.prepare(`
      SELECT id, ativo, pode_criar_gestor
      FROM indicadores
      WHERE id=?
    `).get(sess.indicador_id)
  }
  const tenantDisponivelParaGestor = (ref) => {
    const raw = String(ref || '').trim()
    if (!raw) return null
    return db.prepare(`
      SELECT id, nome, slug, plano, ativo
      FROM tenants
      WHERE ativo=1
        AND id NOT IN ('system','_global')
        AND COALESCE(slug,'') NOT IN ('admin','_global')
        AND (id=? OR slug=?)
      LIMIT 1
    `).get(raw, raw)
  }
  const slugifyTenant = (value) => String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  const criarTenantGestorPadrao = (body, opts = {}) => {
    const nome = String(body.nome || body.nome_estabelecimento || '').trim()
    const gestorNome = String(body.nomeGestor || body.nome_gestor || body.gestor_nome || '').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const rawSenhaHash = String(body.senha_hash || '').trim()
    const rawSenha = body.senha ? String(body.senha) : ''
    const senhaHash = /^[a-f0-9]{64}$/i.test(rawSenhaHash)
      ? rawSenhaHash.toLowerCase()
      : rawSenha ? crypto.createHash('sha256').update(rawSenha).digest('hex') : ''
    const slugPedido = slugifyTenant(body.slug || nome)
    const plano = ['basic', 'pro', 'premium'].includes(body.plano) ? body.plano : 'pro'
    const segmento = ['restaurante', 'acougue'].includes(body.segmento) ? body.segmento : 'restaurante'
    const expiresAt = opts.expiresAt || body.expires_at || null

    const fail = (status, message) => {
      const err = new Error(message)
      err.status = status
      throw err
    }
    if (!nome || !slugPedido || !gestorNome || !email || !senhaHash) fail(400, 'Estabelecimento, slug, responsável, e-mail e senha são obrigatórios.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'E-mail inválido.')
    if (db.prepare('SELECT id FROM sys_users WHERE lower(email)=lower(?) LIMIT 1').get(email)) fail(400, `E-mail "${email}" já cadastrado.`)

    let slugFinal = slugPedido
    let suffix = 2
    while (db.prepare('SELECT id FROM tenants WHERE slug=?').get(slugFinal)) slugFinal = `${slugPedido}-${suffix++}`
    if (body.slug && slugFinal !== slugPedido) fail(400, `Slug "${slugPedido}" já em uso. Sugerimos: "${slugFinal}".`)

    const catInsert = db.prepare("INSERT INTO categories (tenant_id,name,label,type,emoji,sort_order,ativo) VALUES (?,?,?,?,?,?,1)")
    // Desconto do indicador (até 10%, aplicado só na criação — vira o valor_mensalidade fixo do tenant)
    const valorMensalidade = (opts.valorMensalidade !== undefined && opts.valorMensalidade !== null)
      ? parseFloat(opts.valorMensalidade) : null

    const result = db.transaction(() => {
      db.prepare('INSERT INTO tenants (nome, plano, slug, segmento, expires_at, valor_mensalidade) VALUES (?,?,?,?,?,?)')
        .run(nome, plano, slugFinal, segmento, expiresAt, valorMensalidade)
      const tenant = db.prepare('SELECT id, nome, slug, plano, segmento, expires_at FROM tenants WHERE slug=?').get(slugFinal)
      db.prepare('INSERT OR IGNORE INTO store_config (tenant_id) VALUES (?)').run(tenant.id)
      const maxOrderId = db.prepare('SELECT COALESCE(MAX(id),0) as m FROM orders').get()?.m || 0
      db.prepare('UPDATE store_config SET order_num_offset=? WHERE tenant_id=?').run(maxOrderId, tenant.id)
      db.prepare('INSERT INTO sys_users (nome, email, senha_hash, role, tenant_id, ativo) VALUES (?, ?, ?, ?, ?, 1)')
        .run(gestorNome, email, senhaHash, opts.role || 'gestor', tenant.id)
      if (segmento === 'acougue') {
        [
          ['bovinos', 'Bovinos', '\uD83D\uDC04', 1],
          ['suinos', 'Suínos', '\uD83D\uDC37', 2],
          ['aves', 'Aves', '\uD83D\uDC14', 3],
          ['ovinos', 'Ovinos', '\uD83D\uDC11', 4],
          ['embutidos', 'Embutidos', '\uD83C\uDF2D', 5],
          ['kits', 'Kits & Combos', '\uD83D\uDCE6', 6],
          ['temperos', 'Temperos & Acompanhamentos', '\uD83E\uDDC4', 7],
        ].forEach(c => catInsert.run(tenant.id, c[0], c[1], 'Itens principais', c[2], c[3]))
        db.prepare('UPDATE store_config SET store_tema=?, store_cor=? WHERE tenant_id=?').run('tropical', '#b45309', tenant.id)
      } else {
        [
          ['entradas', 'Entradas', '\uD83E\uDD57', 1],
          ['pratos', 'Pratos', '\uD83C\uDF7D\uFE0F', 2],
          ['bebidas', 'Bebidas', '\uD83E\uDD64', 3],
          ['sobremesas', 'Sobremesas', '\uD83C\uDF70', 4],
        ].forEach(c => catInsert.run(tenant.id, c[0], c[1], 'Itens principais', c[2], c[3]))
      }
      const usuario = db.prepare('SELECT id, nome, email, role, tenant_id FROM sys_users WHERE lower(email)=lower(?)').get(email)
      return { tenant, usuario }
    })()
    marcarDirty()
    setTimeout(() => fazerBackup(true), 2000)
    return result
  }

  // ── Inicia job de recuperação de PIX na primeira requisição ───────────────
  // O job resolve o token MP por tenant em cada iteração — pagamentos de
  // pedidos do tenant X consultam a conta MP do tenant X (com fallback global).
  _iniciarPixRecoveryJob(db, log, sseBroadcast, MP_TOKEN, aplicarBaixaEstoquePedido)

  // ── Inicia job de auto-cobrança SaaS (uma vez) ────────────────────────────
  _iniciarAutoCobrancaJob(ctx)

  if (req.method === 'POST' && upath === '/api/entregador-login') {
    const body = await readBody(req)
    const ref = String(body.tenant_id || body.tenant || body.slug || req.headers['x-tenant-id'] || '').trim()
    const phone = _digits(body.telefone || body.phone || '')
    if (!ref || !phone) { send(res, 400, { error: 'Loja e telefone obrigatorios' }); return true }
    // Login só por telefone (sem senha) — mais fácil de tentar vários números
    // em sequência pra descobrir um entregador válido, então o limite aqui é
    // por IP+loja (não dá pra travar por telefone individual, já que é
    // justamente o que se está tentando adivinhar).
    const _rlKeyEntregador = 'entregador-login:' + clientIp(req) + ':' + ref
    if (loginRateLimited(_rlKeyEntregador, 8, 5 * 60 * 1000)) {
      send(res, 429, { error: 'Muitas tentativas. Aguarde alguns minutos.' }); return true
    }
    try {
      const tenant = db.prepare('SELECT id,nome,slug FROM tenants WHERE id=? OR slug=? LIMIT 1').get(ref, ref)
      if (!tenant) { registrarLoginFalho(_rlKeyEntregador, 5 * 60 * 1000); send(res, 404, { error: 'Loja nao encontrada' }); return true }
      const entregadores = db.prepare('SELECT * FROM entregadores WHERE tenant_id=? AND ativo=1').all(tenant.id)
      const driver = entregadores.find(d => {
        const dPhone = _digits(d.telefone || '')
        return dPhone && (dPhone === phone || dPhone.slice(-8) === phone.slice(-8))
      })
      if (!driver) { registrarLoginFalho(_rlKeyEntregador, 5 * 60 * 1000); send(res, 401, { error: 'Entregador nao encontrado ou inativo' }); return true }
      const token = crypto.randomBytes(32).toString('hex')
      const ts = Date.now()
      db.prepare('DELETE FROM entregador_sessions WHERE ts < ?').run(ts - ENTREGADOR_SESSION_TTL)
      db.prepare('INSERT OR REPLACE INTO entregador_sessions (token,tenant_id,entregador_id,ts) VALUES (?,?,?,?)')
        .run(token, tenant.id, driver.id, ts)
      send(res, 200, {
        ok: true,
        token,
        tenant: { id: tenant.id, nome: tenant.nome, slug: tenant.slug },
        entregador: { id: driver.id, nome: driver.nome, telefone: driver.telefone }
      })
    } catch(e) {
      log('ERRO', '/api/entregador-login:', e.message)
      send(res, 500, { error: e.message })
    }
    return true
  }

  if (req.method === 'GET' && upath === '/api/entregador/me') {
    const sess = _validarEntregador(req)
    if (!sess) { send(res, 401, { error: 'Sessao invalida' }); return true }
    const tenant = db.prepare('SELECT id,nome,slug FROM tenants WHERE id=?').get(sess.tenant_id)
    send(res, 200, {
      tenant,
      entregador: {
        id: sess.entregador.id,
        nome: sess.entregador.nome,
        telefone: sess.entregador.telefone,
        comissao_tipo: sess.entregador.comissao_tipo,
        comissao_valor: sess.entregador.comissao_valor
      }
    })
    return true
  }

  if (req.method === 'GET' && upath === '/api/entregador/entregas') {
    const sess = _validarEntregador(req)
    if (!sess) { send(res, 401, { error: 'Sessao invalida' }); return true }
    try {
      send(res, 200, _driverEntregas(sess.tenant_id, sess.entregador_id))
    } catch(e) {
      log('ERRO', '/api/entregador/entregas:', e.message)
      send(res, 500, { error: e.message })
    }
    return true
  }

  if (req.method === 'GET' && upath === '/api/entregador/disponiveis') {
    const sess = _validarEntregador(req)
    if (!sess) { send(res, 401, { error: 'Sessao invalida' }); return true }
    try {
      send(res, 200, { disponiveis: _driverDisponiveis(sess.tenant_id) })
    } catch(e) {
      log('ERRO', '/api/entregador/disponiveis:', e.message)
      send(res, 500, { error: e.message })
    }
    return true
  }

  if (req.method === 'POST' && upath === '/api/entregador/adicionar-entregas') {
    const sess = _validarEntregador(req)
    if (!sess) { send(res, 401, { error: 'Sessao invalida' }); return true }
    const body = await readBody(req)
    const orderIds = [...new Set((Array.isArray(body.order_ids) ? body.order_ids : [body.order_id || body.id])
      .map(id => parseInt(id || '0')).filter(Boolean))]
    if (!orderIds.length) { send(res, 400, { error: 'Selecione pelo menos uma entrega' }); return true }
    try {
      const entregador = sess.entregador
      const entregas = db.transaction(() => {
        let seq = _driverNextSeq(sess.tenant_id, sess.entregador_id)
        const created = []
        for (const orderId of orderIds) {
          const order = db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(orderId, sess.tenant_id)
          if (!order) throw new Error(`Pedido ${orderId} nao encontrado`)
          if (!_isDeliveryOrder(order)) throw new Error(`Pedido ${orderId} nao e delivery`)
          if (String(order.status || '') !== 'pronto') throw new Error(`Pedido ${orderId} ainda nao esta pronto para entrega`)
          const atual = db.prepare('SELECT * FROM entregas WHERE tenant_id=? AND order_id=?').get(sess.tenant_id, orderId)
          const atualStatus = String(atual?.status || '')
          if (atual && ['atribuida','em_rota','problema','entregue'].includes(atualStatus)) {
            if (Number(atual.entregador_id) === Number(sess.entregador_id) && atualStatus !== 'entregue') {
              if (!atual.sequencia) {
                db.prepare("UPDATE entregas SET sequencia=?, updated_at=datetime('now') WHERE id=? AND tenant_id=?")
                  .run(seq++, atual.id, sess.tenant_id)
              }
              created.push(db.prepare('SELECT * FROM entregas WHERE id=? AND tenant_id=?').get(atual.id, sess.tenant_id))
              continue
            }
            throw new Error(`Pedido ${_driverOrderNum(order)} ja foi assumido por outro entregador`)
          }
          const valorPedido = _orderTotalDelivery(order)
          const valorReceber = _valorReceberEntrega(order)
          const comissao = _comissaoEntrega(entregador, order)
          db.prepare(`INSERT INTO entregas
            (tenant_id, order_id, entregador_id, status, sequencia, taxa_entrega, valor_pedido, valor_receber, comissao, assigned_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
            ON CONFLICT(tenant_id, order_id) DO UPDATE SET
              entregador_id=excluded.entregador_id,
              rota_id=NULL,
              status=excluded.status,
              sequencia=excluded.sequencia,
              taxa_entrega=excluded.taxa_entrega,
              valor_pedido=excluded.valor_pedido,
              valor_receber=excluded.valor_receber,
              comissao=excluded.comissao,
              assigned_at=COALESCE(entregas.assigned_at, datetime('now')),
              updated_at=datetime('now')`)
            .run(sess.tenant_id, orderId, sess.entregador_id, 'atribuida', seq++, parseFloat(order.taxa || 0), valorPedido, valorReceber, comissao)
          created.push(db.prepare('SELECT * FROM entregas WHERE tenant_id=? AND order_id=?').get(sess.tenant_id, orderId))
        }
        return created
      })()
      for (const entrega of entregas) {
        _emitEntregas(sess.tenant_id, 'entregas:UPDATE', { entrega, order_id: entrega.order_id })
      }
      marcarDirty()
      send(res, 200, { ok: true, entregas, ..._driverEntregas(sess.tenant_id, sess.entregador_id), disponiveis: _driverDisponiveis(sess.tenant_id) })
    } catch(e) {
      send(res, 409, { error: e.message })
    }
    return true
  }

  if (req.method === 'POST' && upath === '/api/entregador/entregas/ordem') {
    const sess = _validarEntregador(req)
    if (!sess) { send(res, 401, { error: 'Sessao invalida' }); return true }
    const body = await readBody(req)
    const requestedRaw = Array.isArray(body.entrega_ids) ? body.entrega_ids : (Array.isArray(body.order_ids) ? body.order_ids : [])
    const requested = [...new Set(requestedRaw
      .map(id => parseInt(id || '0')).filter(Boolean))]
    if (!requested.length) { send(res, 400, { error: 'Informe a sequencia da rota' }); return true }
    try {
      _ensureEntregaSequencia()
      const abertas = db.prepare(`
        SELECT id
        FROM entregas
        WHERE tenant_id=? AND entregador_id=? AND status IN ('atribuida','em_rota','problema')
        ORDER BY COALESCE(sequencia, 999999) ASC, id ASC
      `).all(sess.tenant_id, sess.entregador_id).map(r => Number(r.id))
      const abertasSet = new Set(abertas)
      for (const id of requested) {
        if (!abertasSet.has(Number(id))) { send(res, 403, { error: 'A sequencia contem entrega que nao pertence a este entregador' }); return true }
      }
      const finalOrder = requested.concat(abertas.filter(id => !requested.includes(id)))
      db.transaction(() => {
        finalOrder.forEach((id, idx) => {
          db.prepare("UPDATE entregas SET sequencia=?, updated_at=datetime('now') WHERE id=? AND tenant_id=? AND entregador_id=?")
            .run(idx + 1, id, sess.tenant_id, sess.entregador_id)
        })
      })()
      _emitEntregas(sess.tenant_id, 'entregas:UPDATE', { entregador_id: sess.entregador_id, sequencia: finalOrder })
      marcarDirty()
      send(res, 200, { ok: true, ..._driverEntregas(sess.tenant_id, sess.entregador_id) })
    } catch(e) {
      send(res, 500, { error: e.message })
    }
    return true
  }

  if (req.method === 'POST' && upath === '/api/entregador/localizacao') {
    const sess = _validarEntregador(req)
    if (!sess) { send(res, 401, { error: 'Sessao invalida' }); return true }
    const body = await readBody(req)
    const lat = parseFloat(body.lat)
    const lng = parseFloat(body.lng)
    const accuracy = parseFloat(body.accuracy || 0) || 0
    const entregaId = parseInt(body.entrega_id || '0') || null
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      send(res, 400, { error: 'Localizacao invalida' }); return true
    }
    if (entregaId) {
      const own = db.prepare('SELECT id FROM entregas WHERE id=? AND tenant_id=? AND entregador_id=?').get(entregaId, sess.tenant_id, sess.entregador_id)
      if (!own) { send(res, 403, { error: 'Entrega nao pertence a este entregador' }); return true }
    }
    db.prepare(`INSERT INTO entregador_locations
      (tenant_id, entregador_id, entrega_id, lat, lng, accuracy, updated_at)
      VALUES (?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(tenant_id, entregador_id) DO UPDATE SET
        entrega_id=excluded.entrega_id,
        lat=excluded.lat,
        lng=excluded.lng,
        accuracy=excluded.accuracy,
        updated_at=datetime('now')`)
      .run(sess.tenant_id, sess.entregador_id, entregaId, lat, lng, accuracy)
    const location = db.prepare('SELECT * FROM entregador_locations WHERE tenant_id=? AND entregador_id=?').get(sess.tenant_id, sess.entregador_id)
    _emitEntregas(sess.tenant_id, 'entregador_locations:UPDATE', { location })
    marcarDirty()
    send(res, 200, { ok: true, location })
    return true
  }

  if (req.method === 'POST' && upath === '/api/entregador/status') {
    const sess = _validarEntregador(req)
    if (!sess) { send(res, 401, { error: 'Sessao invalida' }); return true }
    const body = await readBody(req)
    const entregaId = parseInt(body.entrega_id || body.id || '0')
    const status = String(body.status || '').trim()
    const allowed = new Set(['em_rota','entregue','problema','retornada'])
    if (!entregaId || !allowed.has(status)) { send(res, 400, { error: 'Entrega ou status invalido' }); return true }
    try {
      const entrega = db.prepare('SELECT * FROM entregas WHERE id=? AND tenant_id=? AND entregador_id=?').get(entregaId, sess.tenant_id, sess.entregador_id)
      if (!entrega) { send(res, 404, { error: 'Entrega nao encontrada' }); return true }
      const order = db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(entrega.order_id, sess.tenant_id)
      const problema = status === 'problema' || body.problema
        ? String(body.problema || '').trim().slice(0, 280)
        : null
      const recebido = body.recebido === undefined || body.recebido === null || body.recebido === ''
        ? parseFloat(entrega.recebido || 0)
        : parseFloat(body.recebido || 0)
      db.prepare(`UPDATE entregas SET
          status=?,
          problema=?,
          recebido=?,
          saiu_at=CASE WHEN ?='em_rota' THEN COALESCE(saiu_at, datetime('now')) ELSE saiu_at END,
          entregue_at=CASE WHEN ?='entregue' THEN COALESCE(entregue_at, datetime('now')) ELSE entregue_at END,
          updated_at=datetime('now')
        WHERE id=? AND tenant_id=?`)
        .run(status, problema, isFinite(recebido) ? recebido : 0, status, status, entrega.id, sess.tenant_id)
      if (status === 'em_rota' && order && !['saiu','entregue','finalizado','cancelado'].includes(order.status)) {
        db.prepare("UPDATE orders SET status='saiu' WHERE id=? AND tenant_id=?").run(order.id, sess.tenant_id)
        _statusHistDelivery(sess.tenant_id, order.id, order.status, 'saiu', {
          actor_type: 'entregador',
          actor_id: String(sess.entregador_id),
          actor_name: sess.entregador.nome,
          origem: 'app-entregador',
          note: 'Entrega iniciada pelo app'
        })
      }
      if (status === 'entregue' && order && !['entregue','finalizado','cancelado'].includes(order.status)) {
        db.prepare("UPDATE orders SET status='entregue' WHERE id=? AND tenant_id=?").run(order.id, sess.tenant_id)
        _statusHistDelivery(sess.tenant_id, order.id, order.status, 'entregue', {
          actor_type: 'entregador',
          actor_id: String(sess.entregador_id),
          actor_name: sess.entregador.nome,
          origem: 'app-entregador',
          note: 'Entrega concluida pelo app'
        })
      }
      if (entrega.rota_id) _recalcularRotaEntrega(sess.tenant_id, entrega.rota_id)
      const updatedEntrega = db.prepare('SELECT * FROM entregas WHERE id=? AND tenant_id=?').get(entrega.id, sess.tenant_id)
      const updatedOrder = order ? db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(order.id, sess.tenant_id) : null
      if (updatedOrder) _emitOrderDelivery(sess.tenant_id, updatedOrder)
      _emitEntregas(sess.tenant_id, 'entregas:UPDATE', { entrega: updatedEntrega, order_id: updatedEntrega.order_id })
      marcarDirty()
      send(res, 200, { ok: true, entrega: updatedEntrega, order: _orderOutDelivery(updatedOrder) })
    } catch(e) {
      log('ERRO', '/api/entregador/status:', e.message)
      send(res, 500, { error: e.message })
    }
    return true
  }

  if (req.method === 'POST' && upath === '/api/entregador/mensagem') {
    const sess = _validarEntregador(req)
    if (!sess) { send(res, 401, { error: 'Sessao invalida' }); return true }
    const body = await readBody(req)
    const entregaId = parseInt(body.entrega_id || '0')
    const tipo = String(body.tipo || 'cheguei').trim()
    if (!entregaId) { send(res, 400, { error: 'entrega_id obrigatorio' }); return true }
    try {
      const entrega = db.prepare('SELECT * FROM entregas WHERE id=? AND tenant_id=? AND entregador_id=?').get(entregaId, sess.tenant_id, sess.entregador_id)
      if (!entrega) { send(res, 404, { error: 'Entrega nao encontrada' }); return true }
      const order = db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(entrega.order_id, sess.tenant_id)
      if (!order?.phone) { send(res, 400, { error: 'Pedido sem telefone do cliente' }); return true }
      const msg = _driverMensagem(tipo, order, sess.entregador, body.message)
      if (!msg) { send(res, 400, { error: 'Mensagem vazia' }); return true }
      const cfg = db.prepare('SELECT evo_instance FROM store_config WHERE tenant_id=?').get(sess.tenant_id)
      const wantsLocalTest = req.headers['x-local-test'] === '1' || req.headers['x-local-dry-run'] === '1'
      const localTest = wantsLocalTest && (
        String(sess.tenant_id || '').startsWith('test_entregador_') ||
        process.env.ALLOW_LOCAL_TEST_MESSAGES === '1'
      )
      const r = localTest
        ? { ok: true, data: { local_test: true } }
        : await sendWA(order.phone, msg, cfg?.evo_instance || EVO_INST, 900)
      db.prepare(`INSERT INTO entrega_mensagens
        (tenant_id, entrega_id, order_id, entregador_id, tipo, message, ok, error, lat, lng)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(sess.tenant_id, entrega.id, order.id, sess.entregador_id, tipo, msg, r.ok ? 1 : 0, r.ok ? null : String(r.error || JSON.stringify(r.data || {})).slice(0, 300), body.lat || null, body.lng || null)
      const row = db.prepare('SELECT * FROM entrega_mensagens WHERE id=last_insert_rowid()').get()
      _emitEntregas(sess.tenant_id, 'entrega_mensagens:INSERT', { mensagem: row, entrega_id: entrega.id, order_id: order.id })
      marcarDirty()
      send(res, 200, { ok: !!r.ok, message: msg })
    } catch(e) {
      log('ERRO', '/api/entregador/mensagem:', e.message)
      send(res, 500, { error: e.message })
    }
    return true
  }

  if (req.method === 'GET' && upath === '/api/entregas/dashboard') {
    const tid = req.headers['x-tenant-id'] || params.get('tenant_id') || ''
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    try {
      send(res, 200, _deliveryDashboard(tid))
    } catch(e) {
      send(res, 500, { error: e.message })
    }
    return true
  }

  if (req.method === 'GET' && upath === '/api/order-status-history') {
    const tid = req.headers['x-tenant-id'] || params.get('tenant_id') || ''
    const orderId = parseInt(params.get('order_id') || '0')
    if (!tid || !orderId) { send(res, 400, { error: 'tenant_id e order_id obrigatorios' }); return true }
    try {
      const rows = db.prepare(`
        SELECT *
        FROM order_status_history
        WHERE tenant_id=? AND order_id=?
        ORDER BY created_at ASC, id ASC
      `).all(tid, orderId)
      send(res, 200, rows)
    } catch(e) {
      send(res, 500, { error: e.message })
    }
    return true
  }

  if (req.method === 'POST' && upath === '/api/entregas/atribuir') {
    const tid = req.headers['x-tenant-id'] || ''
    const body = await readBody(req)
    const orderId = parseInt(body.order_id || body.id || '0')
    const entregadorId = parseInt(body.entregador_id || '0')
    const rotaId = parseInt(body.rota_id || '0') || null
    const iniciar = !!body.iniciar_rota || body.status === 'em_rota'
    if (!tid || !orderId || !entregadorId) {
      send(res, 400, { error: 'order_id e entregador_id obrigatorios' }); return true
    }
    try {
      const order = db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(orderId, tid)
      if (!order) { send(res, 404, { error: 'Pedido nao encontrado' }); return true }
      if (!_isDeliveryOrder(order)) { send(res, 400, { error: 'Pedido nao e delivery' }); return true }
      if (!['pronto','saiu'].includes(String(order.status || ''))) {
        send(res, 409, { error: 'Pedido precisa estar pronto ou em rota' }); return true
      }
      const entregador = db.prepare('SELECT * FROM entregadores WHERE id=? AND tenant_id=? AND ativo=1').get(entregadorId, tid)
      if (!entregador) { send(res, 404, { error: 'Entregador nao encontrado ou inativo' }); return true }
      if (rotaId) {
        const rota = db.prepare('SELECT * FROM rotas_entrega WHERE id=? AND tenant_id=?').get(rotaId, tid)
        if (!rota || rota.status === 'finalizada' || rota.status === 'cancelada') {
          send(res, 404, { error: 'Rota nao encontrada ou encerrada' }); return true
        }
        if (parseInt(rota.entregador_id || 0) !== entregadorId) {
          send(res, 400, { error: 'Rota pertence a outro entregador' }); return true
        }
      }
      const status = iniciar ? 'em_rota' : 'atribuida'
      const valorPedido = _orderTotalDelivery(order)
      const valorReceber = _valorReceberEntrega(order)
      const comissao = _comissaoEntrega(entregador, order)
      _ensureEntregaSequencia()
      const sequencia = parseInt(body.sequencia || '0') || _driverNextSeq(tid, entregadorId)
      db.prepare(`INSERT INTO entregas
        (tenant_id, order_id, entregador_id, rota_id, status, sequencia, taxa_entrega, valor_pedido, valor_receber, comissao, assigned_at, saiu_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'),${iniciar ? "datetime('now')" : "NULL"},datetime('now'))
        ON CONFLICT(tenant_id, order_id) DO UPDATE SET
          entregador_id=excluded.entregador_id,
          rota_id=excluded.rota_id,
          status=excluded.status,
          sequencia=excluded.sequencia,
          taxa_entrega=excluded.taxa_entrega,
          valor_pedido=excluded.valor_pedido,
          valor_receber=excluded.valor_receber,
          comissao=excluded.comissao,
          assigned_at=COALESCE(entregas.assigned_at, datetime('now')),
          saiu_at=CASE WHEN excluded.status='em_rota' THEN COALESCE(entregas.saiu_at, datetime('now')) ELSE entregas.saiu_at END,
          updated_at=datetime('now')`)
        .run(tid, orderId, entregadorId, rotaId, status, sequencia, parseFloat(order.taxa || 0), valorPedido, valorReceber, comissao)
      if (iniciar && order.status !== 'saiu') {
        db.prepare("UPDATE orders SET status='saiu' WHERE id=? AND tenant_id=?").run(orderId, tid)
        _statusHistDelivery(tid, orderId, order.status, 'saiu', {
          actor_type: 'entregador',
          actor_id: String(entregadorId),
          actor_name: entregador.nome,
          origem: 'entregas',
          note: 'Entrega saiu para rota'
        })
      }
      if (rotaId) _recalcularRotaEntrega(tid, rotaId)
      const entrega = db.prepare('SELECT * FROM entregas WHERE tenant_id=? AND order_id=?').get(tid, orderId)
      const updatedOrder = db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(orderId, tid)
      _emitOrderDelivery(tid, updatedOrder)
      _emitEntregas(tid, 'entregas:UPDATE', { entrega, order_id: orderId })
      marcarDirty()
      send(res, 200, { ok: true, entrega, order: _orderOutDelivery(updatedOrder) })
    } catch(e) {
      log('ERRO', '/api/entregas/atribuir:', e.message)
      send(res, 500, { error: e.message })
    }
    return true
  }

  if (req.method === 'POST' && upath === '/api/entregas/status') {
    const tid = req.headers['x-tenant-id'] || ''
    const body = await readBody(req)
    const entregaId = parseInt(body.entrega_id || body.id || '0')
    const orderId = parseInt(body.order_id || '0')
    const status = String(body.status || '').trim()
    const allowed = new Set(['pendente','atribuida','em_rota','entregue','problema','retornada','cancelada'])
    if (!tid || !status || !allowed.has(status)) { send(res, 400, { error: 'status invalido' }); return true }
    try {
      const entrega = entregaId
        ? db.prepare('SELECT * FROM entregas WHERE id=? AND tenant_id=?').get(entregaId, tid)
        : db.prepare('SELECT * FROM entregas WHERE order_id=? AND tenant_id=?').get(orderId, tid)
      if (!entrega) { send(res, 404, { error: 'Entrega nao encontrada' }); return true }
      const order = db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(entrega.order_id, tid)
      const entregador = entrega.entregador_id
        ? db.prepare('SELECT * FROM entregadores WHERE id=? AND tenant_id=?').get(entrega.entregador_id, tid)
        : null
      const problema = status === 'problema' || body.problema
        ? String(body.problema || '').trim().slice(0, 280)
        : null
      const recebido = body.recebido === undefined || body.recebido === null || body.recebido === ''
        ? parseFloat(entrega.recebido || 0)
        : parseFloat(body.recebido || 0)
      db.prepare(`UPDATE entregas SET
          status=?,
          problema=?,
          recebido=?,
          saiu_at=CASE WHEN ?='em_rota' THEN COALESCE(saiu_at, datetime('now')) ELSE saiu_at END,
          entregue_at=CASE WHEN ?='entregue' THEN COALESCE(entregue_at, datetime('now')) ELSE entregue_at END,
          updated_at=datetime('now')
        WHERE id=? AND tenant_id=?`)
        .run(status, problema, isFinite(recebido) ? recebido : 0, status, status, entrega.id, tid)
      if (status === 'em_rota' && order && !['saiu','finalizado','cancelado'].includes(order.status)) {
        db.prepare("UPDATE orders SET status='saiu' WHERE id=? AND tenant_id=?").run(order.id, tid)
        _statusHistDelivery(tid, order.id, order.status, 'saiu', {
          actor_type: 'entregador',
          actor_id: entrega.entregador_id ? String(entrega.entregador_id) : null,
          actor_name: entregador?.nome || null,
          origem: 'entregas',
          note: 'Entrega saiu para rota'
        })
      }
      if (entrega.rota_id) _recalcularRotaEntrega(tid, entrega.rota_id)
      const updatedEntrega = db.prepare('SELECT * FROM entregas WHERE id=? AND tenant_id=?').get(entrega.id, tid)
      const updatedOrder = order ? db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(order.id, tid) : null
      if (updatedOrder) _emitOrderDelivery(tid, updatedOrder)
      _emitEntregas(tid, 'entregas:UPDATE', { entrega: updatedEntrega, order_id: updatedEntrega.order_id })
      marcarDirty()
      send(res, 200, { ok: true, entrega: updatedEntrega, order: _orderOutDelivery(updatedOrder) })
    } catch(e) {
      log('ERRO', '/api/entregas/status:', e.message)
      send(res, 500, { error: e.message })
    }
    return true
  }

  if (req.method === 'POST' && upath === '/api/rotas-entrega/criar') {
    const tid = req.headers['x-tenant-id'] || ''
    const body = await readBody(req)
    const entregadorId = parseInt(body.entregador_id || '0')
    const orderIds = [...new Set((Array.isArray(body.order_ids) ? body.order_ids : [])
      .map(id => parseInt(id || '0')).filter(Boolean))]
    const iniciar = !!body.iniciar_rota
    if (!tid || !entregadorId || !orderIds.length) {
      send(res, 400, { error: 'entregador_id e order_ids obrigatorios' }); return true
    }
    try {
      _ensureEntregaSequencia()
      const entregador = db.prepare('SELECT * FROM entregadores WHERE id=? AND tenant_id=? AND ativo=1').get(entregadorId, tid)
      if (!entregador) { send(res, 404, { error: 'Entregador nao encontrado ou inativo' }); return true }
      const orders = []
      for (const id of orderIds) {
        const order = db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(id, tid)
        if (!order) { send(res, 404, { error: `Pedido ${id} nao encontrado` }); return true }
        if (!_isDeliveryOrder(order)) { send(res, 400, { error: `Pedido ${id} nao e delivery` }); return true }
        if (!['pronto','saiu'].includes(String(order.status || ''))) {
          send(res, 409, { error: `Pedido ${id} precisa estar pronto ou em rota` }); return true
        }
        orders.push(order)
      }
      const rotaId = db.transaction(() => {
        const info = db.prepare(`INSERT INTO rotas_entrega
          (tenant_id, entregador_id, status, iniciado_em, obs, updated_at)
          VALUES (?,?,?,${iniciar ? "datetime('now')" : "NULL"},?,datetime('now'))`)
          .run(tid, entregadorId, iniciar ? 'em_rota' : 'aberta', String(body.obs || '').trim().slice(0, 280) || null)
        const rid = info.lastInsertRowid
        const statusEntrega = iniciar ? 'em_rota' : 'atribuida'
        for (let idx = 0; idx < orders.length; idx++) {
          const order = orders[idx]
          const valorPedido = _orderTotalDelivery(order)
          db.prepare(`INSERT INTO entregas
            (tenant_id, order_id, entregador_id, rota_id, status, sequencia, taxa_entrega, valor_pedido, valor_receber, comissao, assigned_at, saiu_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'),${iniciar ? "datetime('now')" : "NULL"},datetime('now'))
            ON CONFLICT(tenant_id, order_id) DO UPDATE SET
              entregador_id=excluded.entregador_id,
              rota_id=excluded.rota_id,
              status=excluded.status,
              sequencia=excluded.sequencia,
              taxa_entrega=excluded.taxa_entrega,
              valor_pedido=excluded.valor_pedido,
              valor_receber=excluded.valor_receber,
              comissao=excluded.comissao,
              assigned_at=COALESCE(entregas.assigned_at, datetime('now')),
              saiu_at=CASE WHEN excluded.status='em_rota' THEN COALESCE(entregas.saiu_at, datetime('now')) ELSE entregas.saiu_at END,
              updated_at=datetime('now')`)
            .run(tid, order.id, entregadorId, rid, statusEntrega, idx + 1, parseFloat(order.taxa || 0), valorPedido, _valorReceberEntrega(order), _comissaoEntrega(entregador, order))
          if (iniciar && order.status !== 'saiu') {
            db.prepare("UPDATE orders SET status='saiu' WHERE id=? AND tenant_id=?").run(order.id, tid)
            _statusHistDelivery(tid, order.id, order.status, 'saiu', {
              actor_type: 'entregador',
              actor_id: String(entregadorId),
              actor_name: entregador.nome,
              origem: 'rotas-entrega',
              note: 'Rota iniciada'
            })
          }
        }
        return rid
      })()
      const rota = _recalcularRotaEntrega(tid, rotaId)
      const entregas = db.prepare('SELECT * FROM entregas WHERE tenant_id=? AND rota_id=? ORDER BY id ASC').all(tid, rotaId)
      for (const order of orders) {
        const updatedOrder = db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(order.id, tid)
        _emitOrderDelivery(tid, updatedOrder)
      }
      _emitEntregas(tid, 'rotas_entrega:INSERT', { rota, entregas })
      marcarDirty()
      send(res, 200, { ok: true, rota, entregas })
    } catch(e) {
      log('ERRO', '/api/rotas-entrega/criar:', e.message)
      send(res, 500, { error: e.message })
    }
    return true
  }

  if (req.method === 'POST' && upath === '/api/rotas-entrega/status') {
    const tid = req.headers['x-tenant-id'] || ''
    const body = await readBody(req)
    const rotaId = parseInt(body.rota_id || body.id || '0')
    const status = String(body.status || '').trim()
    const allowed = new Set(['aberta','em_rota','finalizada','cancelada'])
    if (!tid || !rotaId || !allowed.has(status)) { send(res, 400, { error: 'rota_id ou status invalido' }); return true }
    try {
      const rota = db.prepare('SELECT * FROM rotas_entrega WHERE id=? AND tenant_id=?').get(rotaId, tid)
      if (!rota) { send(res, 404, { error: 'Rota nao encontrada' }); return true }
      const entregador = db.prepare('SELECT * FROM entregadores WHERE id=? AND tenant_id=?').get(rota.entregador_id, tid)
      db.transaction(() => {
        db.prepare(`UPDATE rotas_entrega SET
            status=?,
            iniciado_em=CASE WHEN ?='em_rota' THEN COALESCE(iniciado_em, datetime('now')) ELSE iniciado_em END,
            finalizado_em=CASE WHEN ? IN ('finalizada','cancelada') THEN COALESCE(finalizado_em, datetime('now')) ELSE finalizado_em END,
            updated_at=datetime('now')
          WHERE id=? AND tenant_id=?`)
          .run(status, status, status, rotaId, tid)
        if (status === 'em_rota') {
          db.prepare(`UPDATE entregas SET status='em_rota', saiu_at=COALESCE(saiu_at, datetime('now')), updated_at=datetime('now')
            WHERE tenant_id=? AND rota_id=? AND status IN ('pendente','atribuida')`).run(tid, rotaId)
          const rows = db.prepare(`
            SELECT e.order_id, o.status as order_status
            FROM entregas e
            JOIN orders o ON o.id=e.order_id AND o.tenant_id=e.tenant_id
            WHERE e.tenant_id=? AND e.rota_id=?
          `).all(tid, rotaId)
          for (const r of rows) {
            if (!['saiu','finalizado','cancelado'].includes(r.order_status)) {
              db.prepare("UPDATE orders SET status='saiu' WHERE id=? AND tenant_id=?").run(r.order_id, tid)
              _statusHistDelivery(tid, r.order_id, r.order_status, 'saiu', {
                actor_type: 'entregador',
                actor_id: rota.entregador_id ? String(rota.entregador_id) : null,
                actor_name: entregador?.nome || null,
                origem: 'rotas-entrega',
                note: 'Rota iniciada'
              })
            }
          }
        } else if (status === 'cancelada') {
          db.prepare(`UPDATE entregas SET status='cancelada', updated_at=datetime('now')
            WHERE tenant_id=? AND rota_id=? AND status NOT IN ('entregue','retornada')`).run(tid, rotaId)
        }
      })()
      const rotaAtual = _recalcularRotaEntrega(tid, rotaId)
      const entregaRows = db.prepare('SELECT order_id FROM entregas WHERE tenant_id=? AND rota_id=?').all(tid, rotaId)
      for (const r of entregaRows) {
        const updatedOrder = db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(r.order_id, tid)
        _emitOrderDelivery(tid, updatedOrder)
      }
      _emitEntregas(tid, 'rotas_entrega:UPDATE', { rota: rotaAtual })
      marcarDirty()
      send(res, 200, { ok: true, rota: rotaAtual })
    } catch(e) {
      log('ERRO', '/api/rotas-entrega/status:', e.message)
      send(res, 500, { error: e.message })
    }
    return true
  }

  // ═══════════════════════════════════════════════════════
  // Download do App Desktop
  // ═══════════════════════════════════════════════════════
  if (req.method === 'GET' && (upath === '/download' || upath === '/download/')) {
    // Redireciona para a página de releases — o usuário baixa o .exe de lá
    // Alternativa: redirecionar direto pro .exe da versão atual
    const GITHUB_RELEASES = 'https://github.com/brisamenos/estimafood/releases/latest'
    res.writeHead(302, { 'Location': GITHUB_RELEASES })
    res.end()
    return true
  }

  // ═══════════════════════════════════════════════════════
  // Auth — Clientes
  // ═══════════════════════════════════════════════════════


  // ── Registro de cliente (cardápio) ───────────────────
  if (req.method === 'POST' && upath === '/api/customer-register') {
    const body = await readBody(req)
    const tid  = getTenantId(req, params)
    const { name, phone, email, senha, birthday } = body
    if (!name || !phone || !senha) { send(res, 400, { error: 'Nome, telefone e senha são obrigatórios' }); return true }
    if (!tid) { send(res, 400, { error: 'Tenant não identificado' }); return true }
    try {
      const hash     = crypto.createHash('sha256').update(senha).digest('hex')
      const existing = db.prepare('SELECT id FROM customers WHERE tenant_id=? AND phone=?').get(tid, phone)
      if (existing) {
        db.prepare('UPDATE customers SET name=?,email=?,birthday=?,senha_hash=? WHERE tenant_id=? AND phone=?').run(name, email || null, birthday || null, hash, tid, phone)
        const c = db.prepare('SELECT id,tenant_id,name,phone,email,birthday,orders_count,total_spent,created_at FROM customers WHERE tenant_id=? AND phone=?').get(tid, phone)
        send(res, 200, { ...c, token: Buffer.from(`${c.id}:${tid}:${hash.slice(0, 16)}`).toString('base64') })
        return true
      }
      const info = db.prepare('INSERT INTO customers (tenant_id,name,phone,email,birthday,senha_hash,orders_count,total_spent) VALUES (?,?,?,?,?,?,0,0)').run(tid, name, phone, email || null, birthday || null, hash)
      const c    = db.prepare('SELECT id,tenant_id,name,phone,email,birthday,orders_count,total_spent,created_at FROM customers WHERE id=? AND tenant_id=?').get(info.lastInsertRowid, tid)
      marcarDirty()
      send(res, 201, { ...c, token: Buffer.from(`${c.id}:${tid}:${hash.slice(0, 16)}`).toString('base64') })
    } catch (e) { send(res, 400, { error: e.message }) }
    return true
  }

  // ── Login de cliente (cardápio) ──────────────────────
  if (req.method === 'POST' && upath === '/api/customer-login') {
    const body = await readBody(req)
    const tid  = getTenantId(req, params)
    const { phone, senha } = body
    if (!phone || !senha) { send(res, 400, { error: 'Telefone e senha obrigatórios' }); return true }
    if (!tid) { send(res, 400, { error: 'Tenant não identificado' }); return true }
    try {
      const hash = crypto.createHash('sha256').update(senha).digest('hex')
      const c    = db.prepare('SELECT id,tenant_id,name,phone,email,birthday,orders_count,total_spent,created_at,senha_hash FROM customers WHERE tenant_id=? AND phone=?').get(tid, phone)
      if (!c || !c.senha_hash) { send(res, 401, { error: 'Telefone não cadastrado' }); return true }
      if (c.senha_hash !== hash) { send(res, 401, { error: 'Senha incorreta' }); return true }
      const { senha_hash: _, ...safe } = c
      send(res, 200, { ...safe, token: Buffer.from(`${c.id}:${tid}:${hash.slice(0, 16)}`).toString('base64') })
    } catch (e) { send(res, 400, { error: e.message }) }
    return true
  }

  // ── Tempo de entrega estimado (ajusta dinamicamente conforme backlog) ─
  // Conta pedidos ativos (analise/producao/pronto) e adiciona overhead à
  // string base configurada em store_tempo_entrega.
  if (req.method === 'GET' && upath === '/api/tempo-estimado') {
    const tid = getTenantId(req, params)
    if (!tid) { send(res, 400, { error: 'Tenant não identificado' }); return true }
    try {
      const cfg = db.prepare('SELECT store_tempo_entrega,store_tempo_retirada FROM store_config WHERE tenant_id=?').get(tid)
      const tipoTempo = params.get('tipo') === 'retirada' ? 'retirada' : 'delivery'
      const baseStr = ((tipoTempo === 'retirada' ? cfg?.store_tempo_retirada : cfg?.store_tempo_entrega) || '').trim()

      // Extrai range numérico da string (ex: "30-45 min", "30 min", "45")
      // Suporta ambos os hífens (- e –) e formatos "30 a 45"
      let lo = 30, hi = 45 // defaults
      const m = baseStr.match(/(\d+)\s*[-–a]\s*(\d+)/) || baseStr.match(/(\d+)/)
      if (m) {
        lo = parseInt(m[1])
        hi = parseInt(m[2] || m[1]) || lo + 15
      }

      // Conta backlog: delivery considera entrega; retirada considera balcão/retirada
      const backlog = tipoTempo === 'retirada'
        ? (db.prepare(
            "SELECT COUNT(*) as n FROM orders WHERE tenant_id=? AND status IN ('analise','producao','pronto') AND (addr LIKE 'Retirada%' OR addr LIKE 'Balcão%' OR addr LIKE 'Balcao%')"
          ).get(tid)?.n || 0)
        : (db.prepare(
            "SELECT COUNT(*) as n FROM orders WHERE tenant_id=? AND status IN ('analise','producao','pronto') AND addr IS NOT NULL AND addr NOT LIKE 'Mesa%' AND addr NOT LIKE 'Retirada%' AND addr NOT LIKE 'Balcão%' AND addr NOT LIKE 'Balcao%'"
          ).get(tid)?.n || 0)

      // Heurística: cada 3 pedidos de backlog adiciona +5 min
      // Limita a +30 min de overhead pra não assustar
      const overhead = Math.min(Math.floor(backlog / 3) * 5, 30)
      const finalLo = lo + overhead
      const finalHi = hi + overhead
      const isHighDemand = backlog >= 6

      send(res, 200, {
        base: baseStr,
        tipo: tipoTempo,
        backlog,
        overhead_min: overhead,
        tempo_estimado: `${finalLo}-${finalHi} min`,
        alta_demanda: isHighDemand
      })
    } catch (e) { send(res, 400, { error: e.message }) }
    return true
  }

  // ── Pedidos do cliente ───────────────────────────────
  if (req.method === 'GET' && upath === '/api/customer-orders') {
    const tid   = getTenantId(req, params)
    const cid   = params.get('customer_id')
    const phone = params.get('phone')
    if (!tid || (!cid && !phone)) { send(res, 400, { error: 'Parâmetros faltando' }); return true }

    // Cliente COM conta (customer_id) — valida token Bearer se enviado.
    if (cid) {
      const auth = req.headers['authorization'] || ''
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
      if (token) {
        try {
          const decoded = Buffer.from(token, 'base64').toString()
          const [tkCid, tkTid, tkHashPrefix] = decoded.split(':')
          if (String(tkCid) !== String(cid) || String(tkTid) !== String(tid)) {
            send(res, 403, { error: 'Token inválido para este cliente' }); return true
          }
          const custRow = db.prepare('SELECT senha_hash FROM customers WHERE id=? AND tenant_id=?').get(cid, tid)
          if (!custRow || !custRow.senha_hash || custRow.senha_hash.slice(0, 16) !== tkHashPrefix) {
            send(res, 403, { error: 'Token inválido' }); return true
          }
        } catch (e) {
          send(res, 403, { error: 'Token malformado' }); return true
        }
      }
      // Nota: sem token, endpoint continua público para compatibilidade com pedido por URL (?acompanhar=).
      // Para hardening total, exigir token sempre e atualizar frontend para enviar Authorization header.
      try {
        const rows = db.prepare('SELECT id,order_num,client,phone,addr,items,total,taxa,pag,status,created_at FROM orders WHERE tenant_id=? AND customer_id=? ORDER BY id DESC LIMIT 30').all(tid, cid)
        send(res, 200, rows.map(r => ({ ...r, items: (() => { try { return JSON.parse(r.items) } catch { return [] } })() })))
      } catch (e) { send(res, 400, { error: e.message }) }
      return true
    }

    // Cliente SEM conta (guest) — usa o telefone salvo no navegador do próprio
    // cliente (checkout anterior) pra achar o histórico, sem exigir login.
    // Mesmo nível de exposição de dado que o cliente já vê no seu próprio
    // checkout (nome do prato, valor) — nada sensível tipo senha/endereço completo.
    try {
      const phoneWhere = phoneLookupSql('phone')
      const phoneArgs  = phoneLookupArgs(phone)
      const rows = db.prepare(`
        SELECT id,order_num,client,phone,addr,items,total,taxa,pag,status,created_at
        FROM orders WHERE tenant_id=? AND ${phoneWhere}
        ORDER BY id DESC LIMIT 30
      `).all(tid, ...phoneArgs)
      send(res, 200, rows.map(r => ({ ...r, items: (() => { try { return JSON.parse(r.items) } catch { return [] } })() })))
    } catch (e) { send(res, 400, { error: e.message }) }
    return true
  }

  // ── Favoritos do cliente — exige conta (customer_id + token) ──────────
  // Reaproveita o mesmo esquema de token do /api/customer-orders:
  // token = base64("customerId:tenantId:hashPrefixDaSenha")
  const _validarTokenCliente = (tid, cid, req) => {
    const auth = req.headers['authorization'] || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (!token) return false
    try {
      const decoded = Buffer.from(token, 'base64').toString()
      const [tkCid, tkTid, tkHashPrefix] = decoded.split(':')
      if (String(tkCid) !== String(cid) || String(tkTid) !== String(tid)) return false
      const custRow = db.prepare('SELECT senha_hash FROM customers WHERE id=? AND tenant_id=?').get(cid, tid)
      if (!custRow || !custRow.senha_hash || custRow.senha_hash.slice(0, 16) !== tkHashPrefix) return false
      return true
    } catch (e) { return false }
  }

  if (req.method === 'GET' && upath === '/api/favoritos') {
    const tid = getTenantId(req, params)
    const cid = params.get('customer_id')
    if (!tid || !cid) { send(res, 400, { error: 'Parâmetros faltando' }); return true }
    if (!_validarTokenCliente(tid, cid, req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    try {
      const rows = db.prepare('SELECT item_id FROM customer_favoritos WHERE tenant_id=? AND customer_id=?').all(tid, cid)
      send(res, 200, rows.map(r => r.item_id))
    } catch (e) { send(res, 400, { error: e.message }) }
    return true
  }

  if (req.method === 'POST' && upath === '/api/favoritos/toggle') {
    const tid = getTenantId(req, params)
    const body = await readBody(req)
    const cid = body.customer_id
    const itemId = parseInt(body.item_id)
    if (!tid || !cid || !itemId) { send(res, 400, { error: 'Parâmetros faltando' }); return true }
    if (!_validarTokenCliente(tid, cid, req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    try {
      const existente = db.prepare('SELECT id FROM customer_favoritos WHERE tenant_id=? AND customer_id=? AND item_id=?').get(tid, cid, itemId)
      if (existente) {
        db.prepare('DELETE FROM customer_favoritos WHERE id=?').run(existente.id)
        send(res, 200, { ok: true, favorito: false })
      } else {
        db.prepare('INSERT INTO customer_favoritos (tenant_id,customer_id,item_id) VALUES (?,?,?)').run(tid, cid, itemId)
        send(res, 200, { ok: true, favorito: true })
      }
    } catch (e) { send(res, 400, { error: e.message }) }
    return true
  }

  // ── Cancelamento de pedido pelo cliente ──────────────
  // Endpoint dedicado (em vez de PATCH genérico) — valida:
  //   - Tenant do pedido bate com o header
  //   - Cliente é dono do pedido (customer_id no token OU phone informado bate)
  //   - Status atual permite cancelamento (só analise / aguardando_*)
  // Ao cancelar: atualiza customer stats, cria estorno se pagamento online, emite SSE.
  if (req.method === 'POST' && upath === '/api/customer-cancel-order') {
    const tid  = getTenantId(req, params)
    if (!tid) { send(res, 400, { error: 'Tenant não identificado' }); return true }
    const body = await readBody(req)
    const orderId = parseInt(body.order_id) || 0
    const phone   = String(body.phone || '').replace(/\D/g,'')
    if (!orderId) { send(res, 400, { error: 'order_id obrigatório' }); return true }

    // Busca o pedido
    const order = db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(orderId, tid)
    if (!order) { send(res, 404, { error: 'Pedido não encontrado' }); return true }

    // Valida status — só permite cancelar antes da produção
    const STATUS_OK = ['aguardando_pix', 'aguardando_cartao', 'analise']
    if (!STATUS_OK.includes(order.status)) {
      send(res, 400, { error: 'Este pedido não pode mais ser cancelado. Entre em contato com o restaurante.' })
      return true
    }

    // Validação de ownership — aceita qualquer uma:
    //  (a) Bearer token bate com o customer do pedido
    //  (b) phone informado no body bate com o phone do pedido
    //  (c) order recente (< 2h) sem customer_id (compra anônima pelo WhatsApp) com phone batendo
    let autorizado = false
    const auth = req.headers['authorization'] || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (token && order.customer_id) {
      try {
        const [tkCid, tkTid, tkHashPrefix] = Buffer.from(token, 'base64').toString().split(':')
        if (String(tkCid) === String(order.customer_id) && String(tkTid) === String(tid)) {
          const custRow = db.prepare('SELECT senha_hash FROM customers WHERE id=? AND tenant_id=?').get(order.customer_id, tid)
          if (custRow?.senha_hash && custRow.senha_hash.slice(0, 16) === tkHashPrefix) autorizado = true
        }
      } catch(_) {}
    }
    if (!autorizado && phone && order.phone) {
      const phoneOrd = String(order.phone).replace(/\D/g,'')
      // Compara pelos últimos 8 dígitos (ignora DDI/DDD divergentes)
      if (phoneOrd.slice(-8) === phone.slice(-8) && phone.length >= 8) autorizado = true
    }
    if (!autorizado) {
      send(res, 403, { error: 'Não autorizado a cancelar este pedido' })
      return true
    }

    try {
      // Atualiza status
      db.prepare("UPDATE orders SET status='cancelado' WHERE id=? AND tenant_id=?").run(orderId, tid)

      // Reverte customer stats (se o pedido tinha sido contabilizado)
      if (order.customer_id) {
        const valorPago = parseFloat(order.total||0) + parseFloat(order.taxa||0)
        db.prepare(`UPDATE customers SET orders_count = MAX(0, orders_count - 1),
                    total_spent = MAX(0, total_spent - ?) WHERE id=?`)
          .run(valorPago, order.customer_id)
      }

      // Estorno financeiro se pagamento online aprovado
      const pagOnline = (order.pag === 'pix_mp' || order.pag === 'cartao_mp')
      if (pagOnline) {
        try {
          const time = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
          const valor = parseFloat(order.total||0) + parseFloat(order.taxa||0)
          const numStr = _chatShortNum(order) || String(order.id)
          // Descrição compatível com o padrão do finishOrderById ("Pedido #N – Cliente")
          db.prepare(`INSERT INTO movimentos (tenant_id, description, tipo, val, pag, time)
                      VALUES (?, ?, 'saida', ?, ?, ?)`)
            .run(tid, `Estorno — Pedido #${numStr} cancelado pelo cliente`, valor, order.pag, time)
        } catch(e) { log('⚠️','[customer-cancel] estorno financeiro falhou:', e.message) }
      }

      marcarDirty()
      // Broadcast SSE pro kanban do gestor
      const _fo = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId)
      const _it = _fo && typeof _fo.items === 'string' ? (() => { try { return JSON.parse(_fo.items) } catch { return [] } })() : (_fo?.items || [])
      sseBroadcast(`orders-rt:${tid}`, 'orders:UPDATE', _fo ? { ..._fo, items: _it, status: 'cancelado' } : { id: orderId, status: 'cancelado' })

      // Notifica o gestor no WhatsApp se configurado
      setImmediate(async () => {
        try {
          const cfg  = db.prepare('SELECT evo_instance, store_whatsapp, store_name, order_num_offset FROM store_config WHERE tenant_id=?').get(tid)
          if (cfg?.store_whatsapp) {
            const inst   = cfg.evo_instance || EVO_INST
            const offset = parseInt(cfg.order_num_offset) || 0
            const idStr  = _numeroPedidoPad(order, offset)
            const msg    = `🔔 *Pedido cancelado pelo cliente*\n\nPedido *#${idStr}* — ${order.client}\nFoi cancelado pelo cliente via cardápio.${pagOnline ? '\n\n💰 Estorno financeiro registrado automaticamente.' : ''}`
            await sendWA(cfg.store_whatsapp, msg, inst)
          }
        } catch(e) { log('⚠️','[customer-cancel] notif gestor falhou:', e.message) }
      })

      send(res, 200, { ok: true, estorno: pagOnline })
    } catch(e) {
      send(res, 500, { error: e.message })
    }
    return true
  }

  // ═══════════════════════════════════════════════════════
  // Admin, Backup & Tenants
  // ═══════════════════════════════════════════════════════


  // ── Login admin ──────────────────────────────────────
  if (req.method === 'POST' && upath === '/api/admin-login') {
    const body = await readBody(req)
    const { email, senha, senha_hash } = body
    const plain = senha || senha_hash // aceita senha em texto puro (novo) ou hash legado, pra não quebrar admin.html velho em cache
    if (!email || !plain) { send(res, 400, { error: 'email e senha obrigatórios' }); return true }
    const _rlKeyAdmin = 'admin-login:' + clientIp(req) + ':' + email.toLowerCase().trim()
    if (loginRateLimited(_rlKeyAdmin, 8, 5 * 60 * 1000)) {
      send(res, 429, { error: 'Muitas tentativas. Aguarde alguns minutos.' }); return true
    }
    const u = db.prepare("SELECT id,nome,email,role,senha_hash FROM sys_users WHERE email=? AND ativo=1 AND role IN ('superadmin','admin')").get(email.toLowerCase().trim())
    // Aceita tanto senha em texto puro quanto o hash sha256 legado calculado no
    // cliente (compatibilidade com telas antigas em cache) — verifyPassword só
    // aceita texto puro contra o hash real; se vier um hash pronto, compara
    // direto contra o valor salvo (suporta o formato antigo apenas).
    const ok = u && (verifyPassword(plain, u.senha_hash) || (senha_hash && u.senha_hash === senha_hash))
    if (!ok) { registrarLoginFalho(_rlKeyAdmin, 5 * 60 * 1000); send(res, 401, { error: 'Acesso negado. Credenciais inválidas.' }); return true }
    if (senha && precisaMigrarHash(u.senha_hash)) {
      try { db.prepare('UPDATE sys_users SET senha_hash=? WHERE id=?').run(hashPassword(senha), u.id) } catch(_) {}
    }
    const token = criarSessaoAdmin(u)
    send(res, 200, { ok: true, id: u.id, nome: u.nome, email: u.email, role: u.role, token })
    return true
  }

  // ── Login gestor (painel normal, por tenant) ──────────
  // Antes disso o login.html fazia um SELECT direto na tabela sys_users pelo
  // motor REST genérico — sem senha verificada no servidor de forma real e
  // sem emitir nenhum token de sessão. Esse endpoint é o único jeito
  // correto de logar como gestor agora: verifica a senha no servidor e
  // devolve um token que autoriza as próximas chamadas (ver gestor_sessions).
  if (req.method === 'POST' && upath === '/api/gestor-login') {
    const body = await readBody(req)
    const { email, senha } = body
    if (!email || !senha) { send(res, 400, { error: 'email e senha obrigatórios' }); return true }
    const _rlKeyGestor = 'gestor-login:' + clientIp(req) + ':' + email.toLowerCase().trim()
    if (loginRateLimited(_rlKeyGestor, 8, 5 * 60 * 1000)) {
      send(res, 429, { error: 'Muitas tentativas. Aguarde alguns minutos.' }); return true
    }
    const u = db.prepare(`
      SELECT su.id,su.nome,su.email,su.role,su.ativo,su.senha_hash,su.tenant_id,
             t.nome as t_nome, t.ativo as t_ativo, t.expires_at as t_expires_at, t.plano as t_plano
      FROM sys_users su LEFT JOIN tenants t ON su.tenant_id=t.id
      WHERE su.email=?
    `).get(email.toLowerCase().trim())
    if (!u || !verifyPassword(senha, u.senha_hash)) { registrarLoginFalho(_rlKeyGestor, 5 * 60 * 1000); send(res, 401, { error: 'Email ou senha incorretos.' }); return true }
    if (!u.ativo) { send(res, 403, { error: 'Sua conta está desativada. Fale com o administrador.' }); return true }
    if (precisaMigrarHash(u.senha_hash)) {
      try { db.prepare('UPDATE sys_users SET senha_hash=? WHERE id=?').run(hashPassword(senha), u.id) } catch(_) {}
    }
    try { db.prepare('UPDATE sys_users SET ultimo_acesso=? WHERE id=?').run(new Date().toISOString(), u.id) } catch(_) {}
    const token = criarSessaoGestor(u)
    send(res, 200, {
      ok: true, id: u.id, nome: u.nome, email: u.email, role: u.role, tenant_id: u.tenant_id, token,
      tenant: { nome: u.t_nome, ativo: u.t_ativo === 1, expires_at: u.t_expires_at, plano: u.t_plano }
    })
    return true
  }

  // ── Logout gestor ─────────────────────────────────────
  if (req.method === 'POST' && upath === '/api/gestor-logout') {
    const auth  = req.headers['authorization'] || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (token) db.prepare('DELETE FROM gestor_sessions WHERE token=?').run(token)
    send(res, 200, { ok: true })
    return true
  }

  // ── Logout admin ─────────────────────────────────────
  if (req.method === 'POST' && upath === '/api/admin-logout') {
    const auth  = req.headers['authorization'] || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (token) db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token)
    send(res, 200, { ok: true })
    return true
  }

  // ── Renovação manual (admin renova cliente sem passar pelo PIX) ─────
  // Sem isso, o robô de "fatura vencendo" continuava aparecendo pro
  // cliente mesmo depois do admin já ter renovado ele manualmente.
  if (req.method === 'POST' && upath === '/api/admin/robo-fatura/limpar') {
    const adm = validarSessaoAdmin(req)
    if (!adm) { send(res, 401, { error: 'Sessão admin inválida' }); return true }
    try {
      const body = await readBody(req)
      const tenantId = String(body.tenant_id || '')
      if (!tenantId) { send(res, 400, { error: 'tenant_id obrigatório' }); return true }
      db.prepare("UPDATE faturas SET status='pago', pago_em=datetime('now') WHERE tenant_id=? AND status='pendente'").run(tenantId)
      _limparRoboFaturaAlert(db, sseBroadcast, tenantId)
      marcarDirty()
      send(res, 200, { ok: true })
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Sincroniza retroativamente o robô pra faturas pendentes que já
  // existiam antes dessa funcionalidade (ou que por qualquer motivo não
  // geraram o aviso na hora certa). Sem isso, só fatura NOVA (gerada depois
  // dessa atualização) ganhava o robô automaticamente.
  if (req.method === 'POST' && upath === '/api/admin/robo-fatura/sincronizar') {
    const adm = validarSessaoAdmin(req)
    if (!adm) { send(res, 401, { error: 'Sessão admin inválida' }); return true }
    try {
      const pendentes = db.prepare(`
        SELECT f.tenant_id, f.plano, f.valor, f.vence_em
        FROM faturas f
        WHERE f.status='pendente'
          AND f.id = (SELECT MAX(f2.id) FROM faturas f2 WHERE f2.tenant_id = f.tenant_id AND f2.status='pendente')
      `).all()
      let criados = 0
      for (const f of pendentes) {
        _upsertRoboFaturaAlert(db, sseBroadcast, f.tenant_id, {
          planoNome: _planoSaasLabel(f.plano),
          valorTxt: parseFloat(f.valor).toFixed(2).replace('.', ','),
          venceEmTxt: new Date(f.vence_em + 'T00:00:00').toLocaleDateString('pt-BR')
        })
        criados++
      }
      send(res, 200, { ok: true, criados })
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Dashboard operacional de pedidos por loja (super admin) ─────────
  // Agrega pedidos por tenant num intervalo de datas: total, ativos,
  // cancelados, concluídos, em rota de entrega, e tempo médio até entregar.
  // "Tempo médio" usa updated_at como aproximação do momento da entrega —
  // o schema não guarda um timestamp dedicado por status, então assume que
  // a última atualização de um pedido já entregue foi a própria entrega
  // (verdade na prática, já que nada mais costuma mudar depois disso).
  if (req.method === 'GET' && upath === '/api/admin/dashboard-pedidos') {
    const adm = validarSessaoAdmin(req)
    if (!adm) { send(res, 401, { error: 'Sessão admin inválida' }); return true }
    try {
      const dataIni = params.get('data_ini') || new Date().toISOString().slice(0, 10)
      const dataFim = params.get('data_fim') || dataIni
      // dataIni/dataFim são dias civis de Brasília (o filtro do admin), mas
      // created_at é gravado em UTC — Brasília é UTC-3, então o "dia" em
      // Brasília começa 3h depois da meia-noite UTC e termina 3h depois da
      // meia-noite UTC do dia seguinte. Sem isso, filtrar "hoje" perto da
      // virada da noite pegava só um pedaço errado do dia.
      const desde = `${dataIni} 03:00:00`
      const _fimMaisUm = new Date(dataFim + 'T00:00:00Z'); _fimMaisUm.setUTCDate(_fimMaisUm.getUTCDate() + 1)
      const ate = _fimMaisUm.toISOString().slice(0, 10) + ' 02:59:59'
      const lojas = db.prepare(`
        SELECT
          o.tenant_id,
          t.nome,
          t.plano,
          t.ativo AS tenant_ativo,
          COUNT(*) AS total,
          SUM(CASE WHEN o.status IN ('analise','producao','pronto','saiu','aguardando_pix','aguardando_cartao') THEN 1 ELSE 0 END) AS ativos,
          SUM(CASE WHEN o.status = 'cancelado' THEN 1 ELSE 0 END) AS cancelados,
          SUM(CASE WHEN o.status IN ('entregue','finalizado') THEN 1 ELSE 0 END) AS concluidos,
          SUM(CASE WHEN o.status = 'saiu' THEN 1 ELSE 0 END) AS em_entrega,
          SUM(o.total + COALESCE(o.taxa,0)) AS faturado,
          AVG(CASE WHEN o.status IN ('entregue','finalizado') THEN (julianday(o.updated_at) - julianday(o.created_at)) * 1440 ELSE NULL END) AS tempo_medio_min
        FROM orders o
        JOIN tenants t ON t.id = o.tenant_id
        WHERE o.created_at BETWEEN ? AND ?
        GROUP BY o.tenant_id
        ORDER BY total DESC
      `).all(desde, ate)

      const resumo = lojas.reduce((acc, l) => {
        acc.total += l.total; acc.ativos += l.ativos; acc.cancelados += l.cancelados
        acc.concluidos += l.concluidos; acc.em_entrega += l.em_entrega; acc.faturado += l.faturado || 0
        if (l.tempo_medio_min) { acc._somaTempo += l.tempo_medio_min * l.concluidos; acc._qtdTempo += l.concluidos }
        return acc
      }, { total: 0, ativos: 0, cancelados: 0, concluidos: 0, em_entrega: 0, faturado: 0, _somaTempo: 0, _qtdTempo: 0 })
      resumo.tempo_medio_min = resumo._qtdTempo > 0 ? resumo._somaTempo / resumo._qtdTempo : null
      delete resumo._somaTempo; delete resumo._qtdTempo

      // ── Série temporal (pro gráfico de linhas) ──────────────────────
      // Período de 1 dia (hoje/ontem) → agrupa por hora (0-23h).
      // Período maior (7d/30d/custom) → agrupa por dia.
      // Só das top 6 lojas por volume, pra não virar um emaranhado de linhas
      // ilegível — as outras entram somadas numa linha "Outras lojas".
      const _diffDias = Math.round((new Date(dataFim + 'T00:00:00Z') - new Date(dataIni + 'T00:00:00Z')) / 86400000)
      const porHora = _diffDias < 1
      const brutos = db.prepare('SELECT tenant_id, created_at FROM orders WHERE created_at BETWEEN ? AND ?').all(desde, ate)
      const topIds = lojas.slice(0, 6).map(l => l.tenant_id)
      const nomesPorId = Object.fromEntries(lojas.map(l => [l.tenant_id, l.nome]))
      const buckets = []
      if (porHora) { for (let h = 0; h < 24; h++) buckets.push(String(h).padStart(2, '0') + 'h') }
      else { for (let d = 0; d <= _diffDias; d++) { const dt = new Date(dataIni + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + d); buckets.push(dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })) } }
      const contagem = {} // tenant_id -> array de contagens por bucket
      const contagemOutras = new Array(buckets.length).fill(0)
      for (const id of topIds) contagem[id] = new Array(buckets.length).fill(0)
      // created_at é gravado em UTC — converte pra horário de Brasília (UTC-3)
      // antes de decidir em qual hora/dia o pedido cai, senão a "hora" do
      // gráfico fica 3h adiantada e o "dia" muda 3h antes da meia-noite real.
      for (const o of brutos) {
        const brMs = new Date(o.created_at.replace(' ', 'T') + 'Z').getTime() - 3 * 3600 * 1000
        const brDate = new Date(brMs)
        const idx = porHora
          ? brDate.getUTCHours()
          : Math.round((new Date(brDate.toISOString().slice(0, 10) + 'T00:00:00Z') - new Date(dataIni + 'T00:00:00Z')) / 86400000)
        if (idx < 0 || idx >= buckets.length) continue
        if (contagem[o.tenant_id]) contagem[o.tenant_id][idx]++
        else contagemOutras[idx]++
      }
      const serieLojas = topIds.map(id => ({ tenant_id: id, nome: nomesPorId[id], dados: contagem[id] }))
      if (lojas.length > topIds.length) serieLojas.push({ tenant_id: '_outras', nome: 'Outras lojas', dados: contagemOutras })

      // ── Comparação com o período anterior equivalente ───────────────
      // Mesmo tamanho de período, imediatamente antes — dá pra mostrar
      // "+12% que ontem" etc nos cards de resumo.
      const _iniAnt = new Date(dataIni + 'T00:00:00Z'); _iniAnt.setUTCDate(_iniAnt.getUTCDate() - (_diffDias + 1))
      const _fimAnt = new Date(dataIni + 'T00:00:00Z'); _fimAnt.setUTCDate(_fimAnt.getUTCDate() - 1)
      const dataIniAnt = _iniAnt.toISOString().slice(0, 10)
      const dataFimAnt = _fimAnt.toISOString().slice(0, 10)
      const desdeAnt = `${dataIniAnt} 03:00:00`
      const _fimAntMaisUm = new Date(dataFimAnt + 'T00:00:00Z'); _fimAntMaisUm.setUTCDate(_fimAntMaisUm.getUTCDate() + 1)
      const ateAnt = _fimAntMaisUm.toISOString().slice(0, 10) + ' 02:59:59'
      const anterior = db.prepare(`
        SELECT COUNT(*) AS total, SUM(CASE WHEN status='cancelado' THEN 1 ELSE 0 END) AS cancelados, SUM(total + COALESCE(taxa,0)) AS faturado
        FROM orders WHERE created_at BETWEEN ? AND ?
      `).get(desdeAnt, ateAnt)
      resumo.comparativo = {
        total: anterior?.total || 0,
        cancelados: anterior?.cancelados || 0,
        faturado: anterior?.faturado || 0
      }

      send(res, 200, { resumo, lojas, serie: { tipo: porHora ? 'hora' : 'dia', buckets, lojas: serieLojas }, data_ini: dataIni, data_fim: dataFim })
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Fatura pendente do tenant (pro botão "Pagar agora" do robô) ─────
  // Devolve só o necessário pra mostrar o QR/copia-cola — nunca o histórico
  // inteiro, e nunca dado de outro tenant (sempre filtrado pelo header).
  if (req.method === 'GET' && upath === '/api/gestor/fatura-pendente') {
    const tid = getTenantId(req, params)
    if (!tid) { send(res, 400, { error: 'Tenant não identificado' }); return true }
    const f = db.prepare(`
      SELECT id, plano, valor, vence_em, qr_code, qr_code_base64, link_pagamento, status
      FROM faturas
      WHERE tenant_id=? AND status='pendente'
      ORDER BY id DESC LIMIT 1
    `).get(tid)
    send(res, 200, f || null)
    return true
  }

  // ── Comunicados do admin exibidos no topo do gestor ─────
  if (req.method === 'GET' && upath === '/api/gestor/comunicados') {
    const tid = getTenantId(req, params)
    if (!tid) { send(res, 400, { error: 'Tenant não identificado' }); return true }
    const rows = db.prepare(`
      SELECT id,tipo,titulo,mensagem,display_mode,bg_color,text_color,font_family,cta_label,cta_whatsapp,target_all,target_tenants,ativo,created_at,updated_at,expires_at
      FROM admin_alerts
      WHERE ativo=1
      ORDER BY created_at DESC
      LIMIT 50
    `).all()
    const nowBr = _brNowWallClockMs()
    const out = rows
      .map(_parseAdminAlert)
      .filter(a => !a.expires_at || (_brWallClockMs(a.expires_at) || 0) >= nowBr)
      .filter(a => a.target_all || (Array.isArray(a.target_tenants) && a.target_tenants.includes(tid)))
      .slice(0, 6)
    send(res, 200, out)
    return true
  }

  if (req.method === 'GET' && upath === '/api/admin/comunicados') {
    const adm = validarSessaoAdmin(req)
    if (!adm) { send(res, 401, { error: 'Sessão admin inválida' }); return true }
    // tipo='robo_fatura' é gerado sozinho pelo job de cobrança (um por
    // tenant com fatura pendente) — fica de fora daqui pra não lotar a tela
    // de gerenciar comunicados manuais com um aviso por cliente.
    const rows = db.prepare(`
      SELECT id,tipo,titulo,mensagem,display_mode,bg_color,text_color,font_family,cta_label,cta_whatsapp,target_all,target_tenants,ativo,created_by,created_at,updated_at,expires_at
      FROM admin_alerts
      WHERE tipo <> 'robo_fatura'
      ORDER BY created_at DESC
      LIMIT 200
    `).all().map(_parseAdminAlert)
    send(res, 200, rows)
    return true
  }

  if (req.method === 'POST' && upath === '/api/admin/comunicados') {
    const adm = validarSessaoAdmin(req)
    if (!adm) { send(res, 401, { error: 'Sessão admin inválida' }); return true }
    try {
      const body = await readBody(req)
      const data = _normalizeAdminAlertInput(body)
      const info = db.prepare(`
        INSERT INTO admin_alerts (tipo,titulo,mensagem,display_mode,bg_color,text_color,font_family,cta_label,cta_whatsapp,target_all,target_tenants,ativo,created_by,expires_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), datetime('now'))
      `).run(data.tipo, data.titulo, data.mensagem, data.displayMode, data.bgColor, data.textColor, data.fontFamily, data.ctaLabel, data.ctaWhatsapp, data.targetAll, JSON.stringify(data.targetTenants), data.ativo, adm.nome || adm.email || adm.user_id, data.expiresAt)
      const row = db.prepare('SELECT * FROM admin_alerts WHERE id=?').get(info.lastInsertRowid)
      marcarDirty()
      _broadcastAdminAlerts(row, 'insert')
      send(res, 200, _parseAdminAlert(row))
    } catch(e) { send(res, 400, { error: e.message }) }
    return true
  }

  if (req.method === 'PUT' && upath.startsWith('/api/admin/comunicados/')) {
    const adm = validarSessaoAdmin(req)
    if (!adm) { send(res, 401, { error: 'Sessão admin inválida' }); return true }
    const id = parseInt(upath.replace('/api/admin/comunicados/', '').split('/')[0])
    const prev = db.prepare('SELECT * FROM admin_alerts WHERE id=?').get(id)
    if (!prev) { send(res, 404, { error: 'Comunicado não encontrado' }); return true }
    try {
      const body = await readBody(req)
      const data = _normalizeAdminAlertInput(body)
      db.prepare(`
        UPDATE admin_alerts
        SET tipo=?, titulo=?, mensagem=?, display_mode=?, bg_color=?, text_color=?, font_family=?, cta_label=?, cta_whatsapp=?, target_all=?, target_tenants=?, ativo=?, expires_at=?, updated_at=datetime('now')
        WHERE id=?
      `).run(data.tipo, data.titulo, data.mensagem, data.displayMode, data.bgColor, data.textColor, data.fontFamily, data.ctaLabel, data.ctaWhatsapp, data.targetAll, JSON.stringify(data.targetTenants), data.ativo, data.expiresAt, id)
      const row = db.prepare('SELECT * FROM admin_alerts WHERE id=?').get(id)
      marcarDirty()
      _broadcastAdminAlerts(row, 'update', prev)
      send(res, 200, _parseAdminAlert(row))
    } catch(e) { send(res, 400, { error: e.message }) }
    return true
  }

  if (req.method === 'DELETE' && upath.startsWith('/api/admin/comunicados/')) {
    const adm = validarSessaoAdmin(req)
    if (!adm) { send(res, 401, { error: 'Sessão admin inválida' }); return true }
    const id = parseInt(upath.replace('/api/admin/comunicados/', '').split('/')[0])
    const prev = db.prepare('SELECT * FROM admin_alerts WHERE id=?').get(id)
    if (!prev) { send(res, 404, { error: 'Comunicado não encontrado' }); return true }
    db.prepare('DELETE FROM admin_alerts WHERE id=?').run(id)
    marcarDirty()
    _broadcastAdminAlerts(null, 'delete', prev)
    send(res, 200, { ok: true })
    return true
  }

  // ── Login do indicador ──────────────────────────────
  if (req.method === 'POST' && upath === '/api/indicador-login') {
    const body = await readBody(req)
    const { email, senha_hash } = body
    if (!email || !senha_hash) { send(res, 400, { error: 'email e senha_hash obrigatórios' }); return true }
    const ind = db.prepare(`
      SELECT id, nome, email, codigo, ativo
      FROM indicadores
      WHERE lower(email)=lower(?) AND senha_hash=? AND ativo=1
    `).get(String(email).trim(), senha_hash)
    if (!ind) { send(res, 401, { error: 'Acesso negado. Credenciais inválidas.' }); return true }
    const token = criarSessaoIndicador(ind)
    db.prepare('UPDATE indicadores SET ultimo_acesso=CURRENT_TIMESTAMP WHERE id=?').run(ind.id)
    send(res, 200, { ok: true, id: ind.id, nome: ind.nome, email: ind.email, codigo: ind.codigo, token })
    return true
  }

  if (req.method === 'POST' && upath === '/api/indicador-logout') {
    const auth = req.headers['authorization'] || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (token) db.prepare('DELETE FROM indicador_sessions WHERE token=?').run(token)
    send(res, 200, { ok: true })
    return true
  }

  // ── Criar tenant ─────────────────────────────────────
  if (req.method === 'POST' && upath === '/api/criar-tenant') {
    // CRÍTICO: essa rota cria um restaurante novo (tenant) + a primeira conta
    // de gestor dele — só o superadmin deve poder fazer isso (é assim que o
    // admin.html sempre usou). Faltava essa checagem: sem ela, qualquer
    // pessoa sem login nenhum conseguia chamar essa rota direto e, pior,
    // definir role:'superadmin' no corpo da requisição pra criar uma conta
    // de administrador da PLATAFORMA INTEIRA pra si mesma.
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado. Faça login no painel admin.' }); return true }
    const body = await readBody(req)
    const { nome, plano, slug, email, senha, nomeGestor, segmento } = body
    // Nunca confia no "role" vindo do cliente — a única conta criada aqui é
    // sempre um gestor comum do novo tenant, mesmo com sessão de admin válida.
    const role = 'gestor'
    const expiresAtRaw = String(body.expires_at || '').trim()
    const expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(expiresAtRaw) ? expiresAtRaw : null
    const valorMensalidade = (body.valor_mensalidade !== undefined && body.valor_mensalidade !== null && body.valor_mensalidade !== '')
      ? parseFloat(body.valor_mensalidade) : null
    const valorMensalidadeExpiraRaw = String(body.valor_mensalidade_expira_em || '').trim()
    // Validade só faz sentido junto de um preço personalizado; sem preço, ignora a data
    const valorMensalidadeExpira = (valorMensalidade !== null && /^\d{4}-\d{2}-\d{2}$/.test(valorMensalidadeExpiraRaw))
      ? valorMensalidadeExpiraRaw : null
    const telefoneCobrancaRaw = String(body.telefone_cobranca || '').replace(/\D/g, '')
    const telefoneCobranca = (telefoneCobrancaRaw.length === 10 || telefoneCobrancaRaw.length === 11) ? telefoneCobrancaRaw : null
    if (!nome || !email || !senha) { send(res, 400, { error: 'nome, email e senha obrigatórios' }); return true }
    try {
      const hash     = crypto.createHash('sha256').update(senha).digest('hex')
      const slugBase = slug || nome.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/, '')
      let slugFinal  = slugBase, suffix = 2
      while (db.prepare('SELECT id FROM tenants WHERE slug=?').get(slugFinal)) slugFinal = `${slugBase}-${suffix++}`
      if (slug && slugFinal !== slug) { send(res, 400, { error: `Slug "${slug}" já em uso. Sugerimos: "${slugFinal}"` }); return true }
      if (db.prepare('SELECT id FROM sys_users WHERE email=?').get(email)) { send(res, 400, { error: `E-mail "${email}" já cadastrado.` }); return true }
      const seg = ['restaurante','acougue'].includes(segmento) ? segmento : 'restaurante'
      db.prepare('INSERT INTO tenants (nome,plano,slug,segmento,expires_at,valor_mensalidade,valor_mensalidade_expira_em,telefone_cobranca) VALUES (?,?,?,?,?,?,?,?)').run(nome, plano || 'basic', slugFinal, seg, expiresAt, valorMensalidade, valorMensalidadeExpira, telefoneCobranca)
      const t = db.prepare('SELECT id FROM tenants WHERE slug=?').get(slugFinal)
      db.prepare('INSERT OR IGNORE INTO store_config (tenant_id) VALUES (?)').run(t.id)
      // Define offset = max(id) atual para que o 1º pedido deste tenant comece em #1
      const maxOrderId = db.prepare('SELECT COALESCE(MAX(id),0) as m FROM orders').get()?.m || 0
      db.prepare('UPDATE store_config SET order_num_offset=? WHERE tenant_id=?').run(maxOrderId, t.id)
      db.prepare('INSERT INTO sys_users (nome,email,senha_hash,role,tenant_id) VALUES (?,?,?,?,?)').run(nomeGestor || nome, email, hash, role || 'gestor', t.id)

      // ── Seed de categorias padrão por segmento ──────────────────────────
      if (seg === 'acougue') {
        const catInsert = db.prepare("INSERT INTO categories (tenant_id,name,label,type,emoji,sort_order,ativo) VALUES (?,?,?,?,?,?,1)")
        const catsAcougue = [
          { name: 'bovinos',  label: 'Bovinos',         emoji: '🐄', sort: 1 },
          { name: 'suinos',   label: 'Suínos',           emoji: '🐷', sort: 2 },
          { name: 'aves',     label: 'Aves',             emoji: '🐔', sort: 3 },
          { name: 'ovinos',   label: 'Ovinos',           emoji: '🐑', sort: 4 },
          { name: 'embutidos',label: 'Embutidos',        emoji: '🌭', sort: 5 },
          { name: 'kits',     label: 'Kits & Combos',    emoji: '📦', sort: 6 },
          { name: 'temperos', label: 'Temperos & Acompanhamentos', emoji: '🧄', sort: 7 },
        ]
        catsAcougue.forEach(c => catInsert.run(t.id, c.name, c.label, 'Itens principais', c.emoji, c.sort))
        // Tema e cor padrão do açougue
        db.prepare('UPDATE store_config SET store_tema=?, store_cor=? WHERE tenant_id=?').run('tropical', '#b45309', t.id)
        log('🥩', `Categorias padrão açougue criadas para tenant=${t.id}`)
      } else {
        const catInsert = db.prepare("INSERT INTO categories (tenant_id,name,label,type,emoji,sort_order,ativo) VALUES (?,?,?,?,?,?,1)")
        const catsRest = [
          { name: 'entradas',  label: 'Entradas',    emoji: '🥗', sort: 1 },
          { name: 'pratos',    label: 'Pratos',       emoji: '🍽️', sort: 2 },
          { name: 'bebidas',   label: 'Bebidas',      emoji: '🥤', sort: 3 },
          { name: 'sobremesas',label: 'Sobremesas',   emoji: '🍰', sort: 4 },
        ]
        catsRest.forEach(c => catInsert.run(t.id, c.name, c.label, 'Itens principais', c.emoji, c.sort))
      }
      // ────────────────────────────────────────────────────────────────────

      marcarDirty()
      setTimeout(() => fazerBackup(true), 2000)
      send(res, 201, { ok: true, tenant_id: t.id, slug: slugFinal, segmento: seg, expires_at: expiresAt })
    } catch (e) { send(res, 400, { error: e.message }) }
    return true
  }

  // ── Backup simples (trigger) ─────────────────────────
  if (req.method === 'POST' && upath === '/api/backup') {
    fazerBackup(true)
    const size = fs.existsSync(BACKUP_PATH) ? fs.statSync(BACKUP_PATH).size : 0
    send(res, 200, { ok: true, path: BACKUP_PATH, size })
    return true
  }

  // ── Restore simples ──────────────────────────────────
  if (req.method === 'POST' && upath === '/api/restore') {
    const ok = restaurarBackup()
    send(res, 200, { ok, msg: ok ? 'Restauração concluída' : 'Nenhum backup encontrado' })
    return true
  }

  // ── Endpoints /api/admin-backup/* ────────────────────
  if (upath.startsWith('/api/admin-backup')) {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado. Faça login no painel admin.' }); return true }

    // ── Lê config do backup automático via Telegram ──
    if (req.method === 'GET' && upath === '/api/admin-backup/telegram-config') {
      try {
        const row = db.prepare("SELECT telegram_backup_config FROM store_config WHERE tenant_id='_global'").get()
        let cfg = {}
        try { cfg = JSON.parse(row?.telegram_backup_config || '{}') } catch { cfg = {} }
        const size = fs.existsSync(BACKUP_PATH) ? fs.statSync(BACKUP_PATH).size : 0
        send(res, 200, {
          enabled: !!cfg.enabled,
          bot_token: cfg.bot_token || '',
          chat_id: cfg.chat_id || '',
          interval_minutes: cfg.interval_minutes || 60,
          last_send: enviarBackupTelegram._lastSend || null,
          backup_size: size
        })
      } catch(e) { send(res, 500, { error: e.message }) }
      return true
    }

    // ── Salva config do backup automático via Telegram ──
    if (req.method === 'POST' && upath === '/api/admin-backup/telegram-config') {
      const body = await readBody(req)
      const cfg = {
        enabled: !!body.enabled,
        bot_token: String(body.bot_token || '').trim(),
        chat_id: String(body.chat_id || '').trim(),
        interval_minutes: Math.max(5, parseInt(body.interval_minutes) || 60)
      }
      try {
        db.prepare("UPDATE store_config SET telegram_backup_config=? WHERE tenant_id='_global'").run(JSON.stringify(cfg))
        send(res, 200, { ok: true })
      } catch(e) { send(res, 500, { error: e.message }) }
      return true
    }

    // ── Dispara um envio de teste imediato pro Telegram ──
    // Usa o backup.json já existente (no máx. ~5min desatualizado) — suficiente
    // pra validar bot_token/chat_id sem esperar a escrita assíncrona de um novo snapshot.
    if (req.method === 'POST' && upath === '/api/admin-backup/telegram-test') {
      try {
        const resultado = await enviarBackupTelegram(true)
        send(res, 200, resultado)
      } catch(e) { send(res, 500, { error: e.message }) }
      return true
    }

    // ── Lê ia_config de um tenant (usado pelo painel IA) ──
    if (req.method === 'GET' && upath === '/api/admin-backup/ia-config') {
      const tid = params.get('tenant_id') || '_global'
      try {
        const row = db.prepare('SELECT ia_config FROM store_config WHERE tenant_id=?').get(tid)
        send(res, 200, { ia_config: row?.ia_config || null })
      } catch(e) { send(res, 500, { error: e.message }) }
      return true
    }

    // ── Salva ia_config de um tenant (usado pelo painel IA) ──
    if (req.method === 'POST' && upath === '/api/admin-backup/ia-config') {
      const tid  = params.get('tenant_id') || '_global'
      const body = await readBody(req)
      const { ia_config } = body
      if (!ia_config) { send(res, 400, { error: 'ia_config obrigatório' }); return true }
      try {
        db.prepare("INSERT INTO store_config (tenant_id,ia_config) VALUES (?,?) ON CONFLICT(tenant_id) DO UPDATE SET ia_config=excluded.ia_config").run(tid, typeof ia_config === 'string' ? ia_config : JSON.stringify(ia_config))
        marcarDirty()
        send(res, 200, { ok: true })
      } catch(e) { send(res, 500, { error: e.message }) }
      return true
    }

    // Download backup JSON
    if (req.method === 'GET' && upath === '/api/admin-backup-download') {
      fazerBackup(true)
      if (!fs.existsSync(BACKUP_PATH)) { send(res, 404, { error: 'Nenhum backup disponível' }); return true }
      const data  = fs.readFileSync(BACKUP_PATH, 'utf8')
      const fname = `backup-completo-${new Date().toISOString().slice(0, 10)}.json`
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${fname}"`, 'Content-Length': Buffer.byteLength(data) })
      res.end(data)
      return true
    }

    // Restore global com imagens
    if (req.method === 'POST' && upath === '/api/admin-backup-restore-global') {
      try {
        const body = await readBody(req)
        if (!body?.tabelas) { send(res, 400, { error: 'JSON inválido (falta "tabelas")' }); return true }
        // Lista centralizada em TABELAS_BACKUP (server.js) — nunca duplicar aqui.
        const TABS = TABELAS_BACKUP
        let totalOk = 0, totalFail = 0
        for (const t of TABS) {
          const rows = body.tabelas?.[t]; if (!rows?.length) continue
          try {
            const cols = Object.keys(rows[0])
            const stmt = db.prepare(`INSERT OR IGNORE INTO "${t}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
            const ins  = db.transaction(items => { let ok = 0; for (const r of items) { try { stmt.run(Object.values(r)); ok++ } catch { totalFail++ } } return ok })
            totalOk += ins(rows)
          } catch (e) { log('⚠️', `Restore ${t}: ${e.message}`) }
        }
        let imgOk = 0, imgFail = 0
        for (const [fname, img] of Object.entries(body.imagens || {})) {
          try {
            if (!img?.data || !/^[A-Za-z0-9+/=]+$/.test(img.data.replace(/\s/g, ''))) continue
            fs.writeFileSync(path.join(UPLOADS_DIR, path.basename(fname)), Buffer.from(img.data, 'base64'))
            imgOk++
          } catch (e) { imgFail++; log('⚠️', `Restore img ${fname}: ${e.message}`) }
        }
        marcarDirty(); setTimeout(() => fazerBackup(true), 2000)
        send(res, 200, { ok: true, registros: totalOk, registros_ignorados: totalFail, imagens: imgOk, imagens_falha: imgFail, ts: body.ts || null })
      } catch (e) { send(res, 400, { error: 'Erro ao restaurar: ' + e.message }) }
      return true
    }

    // ── Backup GLOBAL completo COM IMAGENS (todos os tenants + sys_users + uploads) ──
    // Gera snapshot in-memory de todas as tabelas + base64 de cada arquivo de imagem
    // referenciado em menu_items.image_url e store_config.{store_logo_url, store_banner_url}.
    // Comprime com gzip pra reduzir tráfego (backup pode passar de 50MB sem compressão).
    if (req.method === 'GET' && upath === '/api/admin-backup-global-imagens') {
      try {
        const TABS = TABELAS_BACKUP
        const snapshot = { ts: new Date().toISOString(), tipo: 'global', tabelas: {}, imagens: {} }
        let totalRegs = 0
        for (const t of TABS) {
          try {
            const rows = db.prepare(`SELECT * FROM "${t}"`).all()
            // Não filtra campos grandes aqui (ao contrário do backup interno),
            // pra que o restore consiga recuperar ia_config, evo_automacoes etc.
            snapshot.tabelas[t] = rows
            totalRegs += rows.length
          } catch (e) {
            log('⚠️', `Backup global: falha em ${t}: ${e.message}`)
            snapshot.tabelas[t] = []
          }
        }

        // Coleta nomes de imagens e vídeos referenciados em menu_items e store_config
        const imageUrls = new Set()
        for (const item of (snapshot.tabelas.menu_items || [])) {
          if (item.image_url) imageUrls.add(item.image_url)
          if (item.video_url) imageUrls.add(item.video_url)
        }
        for (const cfg of (snapshot.tabelas.store_config || [])) {
          if (cfg.store_logo_url)   imageUrls.add(cfg.store_logo_url)
          if (cfg.store_banner_url) imageUrls.add(cfg.store_banner_url)
        }

        let imgOk = 0, imgFail = 0
        for (const url of imageUrls) {
          try {
            // Aceita tanto URL absoluta quanto path relativo — extrai só o nome do arquivo
            const fname = path.basename(url.split('?')[0])
            const fpath = path.join(UPLOADS_DIR, fname)
            if (fs.existsSync(fpath)) {
              const buf  = fs.readFileSync(fpath)
              const ext  = (path.extname(fname).slice(1) || 'jpeg').toLowerCase()
              const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : ext === 'mp4' ? 'video/mp4' : ext === 'mov' ? 'video/quicktime' : ext === 'webm' ? 'video/webm' : 'image/jpeg'
              snapshot.imagens[fname] = { mime, data: buf.toString('base64') }
              imgOk++
            } else {
              imgFail++
            }
          } catch (e) {
            imgFail++
            log('⚠️', `Backup img falhou: ${e.message}`)
          }
        }

        const json = JSON.stringify(snapshot)
        // Gzip pra comprimir — backup grande
        zlib.gzip(json, (err, buf) => {
          if (err) {
            send(res, 500, { error: 'Falha ao comprimir backup: ' + err.message })
            return
          }
          const fname = `backup-global-${new Date().toISOString().slice(0,10)}.json.gz`
          res.writeHead(200, {
            'Content-Type':        'application/gzip',
            'Content-Disposition': `attachment; filename="${fname}"`,
            'Content-Length':       buf.length,
          })
          res.end(buf)
          log('💾', `Backup global gerado: ${totalRegs} registros, ${imgOk} imagens (${imgFail} falhas), ${(buf.length/1024).toFixed(1)} KB`)
        })
      } catch (e) {
        log('❌', 'Erro backup global:', e.message)
        send(res, 500, { error: 'Erro ao gerar backup: ' + e.message })
      }
      return true
    }

    // ── Backup de UM tenant específico (dados + imagens) ──
    // Útil pra suporte: gerar backup de um cliente específico antes de mexer.
    if (req.method === 'GET' && upath === '/api/admin-backup-tenant') {
      const tid = params.get('tenant_id')
      if (!tid) { send(res, 400, { error: 'tenant_id obrigatório' }); return true }
      try {
        const tenant = db.prepare('SELECT * FROM tenants WHERE id=?').get(tid)
        if (!tenant) { send(res, 404, { error: 'Tenant não encontrado' }); return true }
        // Tabelas que têm tenant_id (todas exceto a tabela tenants em si)
        const TABS = TABELAS_BACKUP.filter(t => t !== 'tenants')
        const snapshot = {
          ts: new Date().toISOString(),
          tipo: 'tenant',
          tenant_id: tid,
          tenant_nome: tenant.nome,
          tabelas: { tenants: [tenant] },
          imagens: {}
        }
        let totalRegs = 1
        for (const t of TABS) {
          try {
            const rows = db.prepare(`SELECT * FROM "${t}" WHERE tenant_id=?`).all(tid)
            snapshot.tabelas[t] = rows
            totalRegs += rows.length
          } catch (e) {
            snapshot.tabelas[t] = []
          }
        }
        // Coleta imagens e vídeos referenciados SOMENTE pelo tenant
        const imageUrls = new Set()
        for (const item of (snapshot.tabelas.menu_items || [])) {
          if (item.image_url) imageUrls.add(item.image_url)
          if (item.video_url) imageUrls.add(item.video_url)
        }
        for (const cfg of (snapshot.tabelas.store_config || [])) {
          if (cfg.store_logo_url)   imageUrls.add(cfg.store_logo_url)
          if (cfg.store_banner_url) imageUrls.add(cfg.store_banner_url)
        }
        let imgOk = 0
        for (const url of imageUrls) {
          try {
            const fname = path.basename(url.split('?')[0])
            const fpath = path.join(UPLOADS_DIR, fname)
            if (fs.existsSync(fpath)) {
              const buf  = fs.readFileSync(fpath)
              const ext  = (path.extname(fname).slice(1) || 'jpeg').toLowerCase()
              const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : ext === 'mp4' ? 'video/mp4' : ext === 'mov' ? 'video/quicktime' : ext === 'webm' ? 'video/webm' : 'image/jpeg'
              snapshot.imagens[fname] = { mime, data: buf.toString('base64') }
              imgOk++
            }
          } catch {}
        }
        const json  = JSON.stringify(snapshot)
        const fname = `backup-${tenant.slug || tid}-${new Date().toISOString().slice(0,10)}.json`
        res.writeHead(200, {
          'Content-Type':        'application/json',
          'Content-Disposition': `attachment; filename="${fname}"`,
          'Content-Length':      Buffer.byteLength(json),
        })
        res.end(json)
        log('💾', `Backup tenant ${tenant.slug||tid}: ${totalRegs} regs, ${imgOk} imgs`)
      } catch (e) {
        log('❌', 'Erro backup tenant:', e.message)
        send(res, 500, { error: 'Erro ao gerar backup: ' + e.message })
      }
      return true
    }

    send(res, 404, { error: 'Rota admin não encontrada' })
    return true
  }

  // ── Backup completo do gestor (dados + imagens) ──────
  if (req.method === 'GET' && upath === '/api/backup-completo-gestor') {
    const tid = req.headers['x-tenant-id']
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    const tenant = db.prepare('SELECT id,nome,slug FROM tenants WHERE id=?').get(tid)
    if (!tenant) { send(res, 404, { error: 'Tenant não encontrado' }); return true }
    try {
      const TABS     = TABELAS_BACKUP.filter(t => t !== 'tenants')
      const snapshot = { ts: new Date().toISOString(), tenant_id: tid, tenant_nome: tenant.nome, tabelas: { tenants: [tenant] }, imagens: {} }
      for (const t of TABS) { try { snapshot.tabelas[t] = db.prepare(`SELECT * FROM "${t}" WHERE tenant_id=?`).all(tid) } catch { snapshot.tabelas[t] = [] } }
      const imageUrls = new Set()
      ;(snapshot.tabelas.menu_items || []).forEach(r => { if (r.image_url) imageUrls.add(r.image_url); if (r.video_url) imageUrls.add(r.video_url) })
      const cfg = (snapshot.tabelas.store_config || [])[0]
      if (cfg) { if (cfg.store_logo_url) imageUrls.add(cfg.store_logo_url); if (cfg.store_banner_url) imageUrls.add(cfg.store_banner_url) }
      for (const url of imageUrls) {
        const fname = path.basename(url.split('?')[0])
        const fpath = path.join(UPLOADS_DIR, fname)
        if (fs.existsSync(fpath)) {
          const ext  = (path.extname(fname).slice(1) || 'jpeg').toLowerCase()
          const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'mp4' ? 'video/mp4' : ext === 'mov' ? 'video/quicktime' : ext === 'webm' ? 'video/webm' : 'image/jpeg'
          snapshot.imagens[fname] = { mime, data: fs.readFileSync(fpath).toString('base64') }
        }
      }
      const json  = JSON.stringify(snapshot)
      const slug  = tenant.slug || tid
      const fname = `backup-completo-${slug}-${new Date().toISOString().slice(0, 10)}.json`
      log('💾', `Backup completo gestor: ${slug} (${imageUrls.size} arquivo(s) de mídia, ${Math.round(json.length / 1024)}KB)`)
      zlib.gzip(Buffer.from(json, 'utf8'), (err, compressed) => {
        if (err) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${fname}"`, 'Content-Length': Buffer.byteLength(json) })
          res.end(json)
        } else {
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${fname}.gz"`, 'Content-Encoding': 'gzip', 'Content-Length': compressed.length })
          res.end(compressed)
        }
      })
    } catch (e) { send(res, 500, { error: 'Erro ao gerar backup: ' + e.message }) }
    return true
  }

  // ═══════════════════════════════════════════════════════
  // SISTEMA DE INDICAÇÕES (referral / afiliados)
  // ═══════════════════════════════════════════════════════
  // Permite cadastrar pessoas como "indicadores" (parceiros/afiliados).
  // Cada um tem um link único: /indicacao/{codigo}
  // Quando alguém preenche o form do link, cai como "lead" no admin.
  // Você converte manualmente quando fechar a venda. A cada cobrança paga,
  // gera-se um registro de comissão no mês (default: 30% × 12 meses).

  // ── PÚBLICO: Captura lead via link de indicação ─────
  // Não precisa auth — cliente preenche e envia
  const _tutorialUrlValida = (url) => /^https?:\/\//i.test(String(url || '').trim())

  if (req.method === 'GET' && upath.startsWith('/api/indicacao/info/')) {
    const codigo = upath.replace('/api/indicacao/info/', '').trim()
    if (!codigo) { send(res, 400, { error: 'Código obrigatório' }); return true }
    const ind = db.prepare('SELECT id, nome, codigo, ativo FROM indicadores WHERE codigo=?').get(codigo)
    if (!ind || !ind.ativo) { send(res, 404, { error: 'Link inválido ou desativado' }); return true }
    // Não retorna dados sensíveis (email/phone/comissão), só o nome do indicador
    send(res, 200, { nome: ind.nome, codigo: ind.codigo })
    return true
  }

  if (req.method === 'POST' && upath === '/api/indicacao/lead') {
    const body = await readBody(req)
    const { codigo, nome_cliente, phone_cliente, nome_estabelecimento, segmento, cidade, observacoes } = body
    if (!codigo || !nome_cliente || !phone_cliente || !nome_estabelecimento) {
      send(res, 400, { error: 'codigo, nome_cliente, phone_cliente e nome_estabelecimento obrigatórios' })
      return true
    }
    const ind = db.prepare('SELECT id, ativo FROM indicadores WHERE codigo=?').get(codigo)
    if (!ind || !ind.ativo) { send(res, 404, { error: 'Link inválido ou desativado' }); return true }
    // Anti-duplicação: se mesma combinação (indicador + phone + estabelecimento)
    // já existe nos últimos 30 dias, retorna OK sem criar duplicata.
    const _phoneClean = String(phone_cliente).replace(/\D/g, '')
    const dup = db.prepare(`SELECT id FROM leads_indicacao
       WHERE indicador_id=? AND replace(replace(phone_cliente,'+',''),' ','')=?
         AND lower(nome_estabelecimento)=lower(?) AND created_at > datetime('now','-30 day')`)
       .get(ind.id, _phoneClean, nome_estabelecimento)
    if (dup) { send(res, 200, { ok: true, dup: true }); return true }
    try {
      const r = db.prepare(`INSERT INTO leads_indicacao
        (indicador_id, nome_cliente, phone_cliente, nome_estabelecimento, segmento, cidade, observacoes)
        VALUES (?,?,?,?,?,?,?)`)
        .run(ind.id, String(nome_cliente).trim(), _phoneClean, String(nome_estabelecimento).trim(),
             segmento || null, cidade || null, observacoes || null)
      log('🎯', `Novo lead via indicação: ${nome_estabelecimento} (indicador #${ind.id})`)
      marcarDirty()
      sseBroadcast(`indicador-rt:${ind.id}`, 'indicador:LEAD_INSERT', { id: r.lastInsertRowid })
      send(res, 200, { ok: true, lead_id: r.lastInsertRowid })
    } catch (e) { send(res, 500, { error: 'Falha ao registrar lead: ' + e.message }) }
    return true
  }

  // ── INDICADOR: dados do próprio painel ─────────────
  if (req.method === 'GET' && upath === '/api/indicador/me') {
    const sess = validarSessaoIndicador(req)
    if (!sess) { send(res, 401, { error: 'Não autorizado' }); return true }
    const ind = db.prepare(`
      SELECT id, nome, email, phone, chave_pix, codigo, comissao_pct, comissao_meses, ativo, pode_criar_gestor, ultimo_acesso
      FROM indicadores WHERE id=?
    `).get(sess.indicador_id)
    if (!ind || !ind.ativo) { send(res, 401, { error: 'Indicador inativo' }); return true }
    const resumo = {
      total_leads: db.prepare('SELECT COUNT(*) AS n FROM leads_indicacao WHERE indicador_id=?').get(ind.id)?.n || 0,
      leads_novos: db.prepare("SELECT COUNT(*) AS n FROM leads_indicacao WHERE indicador_id=? AND status='novo'").get(ind.id)?.n || 0,
      convertidos: db.prepare("SELECT COUNT(*) AS n FROM leads_indicacao WHERE indicador_id=? AND status='convertido'").get(ind.id)?.n || 0,
      a_pagar: db.prepare("SELECT COALESCE(SUM(comissao_valor),0) AS v FROM comissoes WHERE indicador_id=? AND status='a_pagar'").get(ind.id)?.v || 0,
      pago_total: db.prepare("SELECT COALESCE(SUM(comissao_valor),0) AS v FROM comissoes WHERE indicador_id=? AND status='pago'").get(ind.id)?.v || 0
    }
    send(res, 200, { ...ind, resumo })
    return true
  }

  if (req.method === 'GET' && upath === '/api/indicador/leads') {
    const sess = validarSessaoIndicador(req)
    if (!sess) { send(res, 401, { error: 'Não autorizado' }); return true }
    const status = params.get('status') || ''
    const vals = [sess.indicador_id]
    let sql = 'SELECT * FROM leads_indicacao WHERE indicador_id=?'
    if (status) { sql += ' AND status=?'; vals.push(status) }
    sql += ' ORDER BY created_at DESC LIMIT 500'
    send(res, 200, db.prepare(sql).all(...vals))
    return true
  }

  if (req.method === 'PUT' && upath === '/api/indicador/pix') {
    const sess = validarSessaoIndicador(req)
    if (!sess) { send(res, 401, { error: 'Não autorizado' }); return true }
    const body = await readBody(req)
    const chavePix = String(body.chave_pix || '').trim()
    if (!chavePix) { send(res, 400, { error: 'Chave PIX obrigatória' }); return true }
    if (chavePix.length > 180) { send(res, 400, { error: 'Chave PIX muito longa' }); return true }
    const ind = db.prepare('SELECT id, ativo FROM indicadores WHERE id=?').get(sess.indicador_id)
    if (!ind || !ind.ativo) { send(res, 401, { error: 'Indicador inativo' }); return true }
    try {
      db.prepare('UPDATE indicadores SET chave_pix=? WHERE id=?').run(chavePix, sess.indicador_id)
      marcarDirty()
      send(res, 200, { ok: true, chave_pix: chavePix })
    } catch (e) {
      send(res, 500, { error: 'Falha ao salvar PIX: ' + e.message })
    }
    return true
  }

  if (req.method === 'GET' && upath === '/api/indicador/clientes') {
    const sess = validarSessaoIndicador(req)
    if (!sess) { send(res, 401, { error: 'Não autorizado' }); return true }
    send(res, 410, { error: 'Listagem de clientes não disponível no painel do indicador.' })
    return true
  }

  if (req.method === 'POST' && upath === '/api/indicador/gestor-login') {
    const sess = validarSessaoIndicador(req)
    if (!sess) { send(res, 401, { error: 'Não autorizado' }); return true }
    const ind = indicadorComPermissaoGestor(sess)
    if (!ind || ind.ativo !== 1) { send(res, 401, { error: 'Indicador inativo' }); return true }
    if (ind.pode_criar_gestor !== 1) { send(res, 403, { error: 'Função não liberada para este indicador.' }); return true }

    const body = await readBody(req)
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    // Indicador pode dar até 10% de desconto sobre o valor geral do plano.
    // Ele NUNCA define um valor fixo — só a % de desconto, e o limite de 10%
    // é validado aqui no servidor (não confia no que vem do painel).
    const descontoPctRaw = parseFloat(body.desconto_pct)
    const descontoPct = Number.isFinite(descontoPctRaw) ? Math.min(10, Math.max(0, descontoPctRaw)) : 0
    let valorMensalidade = null
    if (descontoPct > 0) {
      let precoEss = 79.99, precoPre = 99.90
      try {
        const c = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
        const g = c?.ia_config ? JSON.parse(c.ia_config) : {}
        if (g.preco_essencial !== undefined) precoEss = parseFloat(g.preco_essencial)
        if (g.preco_premium   !== undefined) precoPre = parseFloat(g.preco_premium)
      } catch {}
      const planoBase = (body.plano === 'premium') ? precoPre : precoEss
      valorMensalidade = Math.round(planoBase * (1 - descontoPct / 100) * 100) / 100
    }

    try {
      const criado = criarTenantGestorPadrao(body, { expiresAt, role: 'gestor', valorMensalidade })
      send(res, 201, { ok: true, ...criado, expires_at: expiresAt, dias: 30, desconto_pct: descontoPct, valor_mensalidade: valorMensalidade })
    } catch (e) {
      send(res, e.status || 500, { error: (e.status ? '' : 'Falha ao criar cliente: ') + e.message })
    }
    return true
  }

  if (req.method === 'GET' && upath === '/api/indicador/tutorial') {
    const sess = validarSessaoIndicador(req)
    if (!sess) { send(res, 401, { error: 'Não autorizado' }); return true }
    const videos = db.prepare(`
      SELECT id, titulo, descricao, video_url, sort_order
      FROM indicador_tutorial_videos
      WHERE ativo=1
      ORDER BY sort_order ASC, id ASC
    `).all()
    const progRows = db.prepare(`
      SELECT video_id, concluido, completed_at
      FROM indicador_tutorial_progress
      WHERE indicador_id=?
    `).all(sess.indicador_id)
    const prog = new Map(progRows.map(p => [p.video_id, p]))
    let previousComplete = true
    const items = videos.map(v => {
      const p = prog.get(v.id)
      const concluido = p?.concluido === 1
      const locked = !previousComplete
      if (!concluido) previousComplete = false
      return { ...v, concluido, locked, completed_at: p?.completed_at || null }
    })
    const concluidos = items.filter(v => v.concluido).length
    const current = items.find(v => !v.locked && !v.concluido) || items.find(v => !v.locked) || null
    send(res, 200, {
      videos: items,
      total: items.length,
      concluidos,
      progresso_pct: items.length ? Math.round((concluidos / items.length) * 100) : 0,
      current_id: current?.id || null
    })
    return true
  }

  if (req.method === 'PUT' && upath.startsWith('/api/indicador/tutorial/') && upath.endsWith('/progresso')) {
    const sess = validarSessaoIndicador(req)
    if (!sess) { send(res, 401, { error: 'Não autorizado' }); return true }
    const id = parseInt(upath.replace('/api/indicador/tutorial/', '').split('/')[0])
    if (!id) { send(res, 400, { error: 'ID inválido' }); return true }
    const video = db.prepare('SELECT id, sort_order, ativo FROM indicador_tutorial_videos WHERE id=?').get(id)
    if (!video || video.ativo !== 1) { send(res, 404, { error: 'Vídeo não encontrado' }); return true }
    const anterior = db.prepare(`
      SELECT id FROM indicador_tutorial_videos
      WHERE ativo=1 AND (sort_order < ? OR (sort_order = ? AND id < ?))
      ORDER BY sort_order DESC, id DESC
      LIMIT 1
    `).get(video.sort_order || 0, video.sort_order || 0, id)
    if (anterior) {
      const prevOk = db.prepare(`
        SELECT concluido FROM indicador_tutorial_progress
        WHERE indicador_id=? AND video_id=?
      `).get(sess.indicador_id, anterior.id)
      if (prevOk?.concluido !== 1) {
        send(res, 409, { error: 'Assista o vídeo anterior antes de continuar.' })
        return true
      }
    }
    try {
      db.prepare(`
        INSERT INTO indicador_tutorial_progress (indicador_id, video_id, concluido, completed_at, updated_at)
        VALUES (?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(indicador_id, video_id) DO UPDATE SET
          concluido=1,
          completed_at=COALESCE(completed_at, CURRENT_TIMESTAMP),
          updated_at=CURRENT_TIMESTAMP
      `).run(sess.indicador_id, id)
      marcarDirty()
      send(res, 200, { ok: true, video_id: id })
    } catch (e) {
      send(res, 500, { error: 'Falha ao salvar progresso: ' + e.message })
    }
    return true
  }

  if (req.method === 'GET' && upath === '/api/indicador/comissoes') {
    const sess = validarSessaoIndicador(req)
    if (!sess) { send(res, 401, { error: 'Não autorizado' }); return true }
    const status = params.get('status') || ''
    const vals = [sess.indicador_id]
    let sql = `SELECT c.*, l.nome_estabelecimento, l.nome_cliente, l.tenant_id_convertido
               FROM comissoes c
               LEFT JOIN leads_indicacao l ON l.id=c.lead_id
               WHERE c.indicador_id=?`
    if (status) { sql += ' AND c.status=?'; vals.push(status) }
    sql += ' ORDER BY c.mes_referencia DESC, c.created_at DESC LIMIT 500'
    send(res, 200, db.prepare(sql).all(...vals))
    return true
  }

  // ── ADMIN: Listar indicadores ──────────────────────
  if (req.method === 'GET' && upath === '/api/admin/indicadores') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const rows = db.prepare(`
      SELECT i.id, i.codigo, i.nome, i.email, i.phone, i.chave_pix,
        i.comissao_pct, i.comissao_meses, i.ativo, i.pode_criar_gestor, i.observacoes,
        i.created_at, i.ultimo_acesso,
        (SELECT COUNT(*) FROM leads_indicacao l WHERE l.indicador_id=i.id) AS total_leads,
        (SELECT COUNT(*) FROM leads_indicacao l WHERE l.indicador_id=i.id AND l.status='convertido') AS total_convertidos,
        (SELECT COALESCE(SUM(comissao_valor),0) FROM comissoes c WHERE c.indicador_id=i.id AND c.status='pago') AS total_pago,
        (SELECT COALESCE(SUM(comissao_valor),0) FROM comissoes c WHERE c.indicador_id=i.id AND c.status='a_pagar') AS total_a_pagar
      FROM indicadores i ORDER BY i.created_at DESC
    `).all()
    send(res, 200, rows)
    return true
  }

  // ── ADMIN: Criar indicador ─────────────────────────
  if (req.method === 'POST' && upath === '/api/admin/indicadores') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const body = await readBody(req)
    const { nome, email, phone, chave_pix, comissao_pct, comissao_meses, observacoes, senha, senha_hash, pode_criar_gestor } = body
    if (!nome) { send(res, 400, { error: 'Nome é obrigatório' }); return true }
    if (email && db.prepare('SELECT id FROM indicadores WHERE lower(email)=lower(?)').get(String(email).trim())) {
      send(res, 400, { error: `E-mail "${email}" já cadastrado para outro indicador.` }); return true
    }
    // Gera código único de 8 chars (alfanumérico maiúsculo, sem ambíguos como 0/O/1/I)
    const _gerarCodigo = () => {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      let c = ''; for (let i = 0; i < 8; i++) c += chars[Math.floor(Math.random() * chars.length)]
      return c
    }
    let codigo, tries = 0
    do { codigo = _gerarCodigo(); tries++ }
    while (db.prepare('SELECT 1 FROM indicadores WHERE codigo=?').get(codigo) && tries < 20)
    try {
      const r = db.prepare(`INSERT INTO indicadores
        (codigo, nome, email, phone, chave_pix, comissao_pct, comissao_meses, observacoes, senha_hash, pode_criar_gestor)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(codigo, String(nome).trim(),
             email ? String(email).toLowerCase().trim() : null,
             phone ? String(phone).replace(/\D/g, '') : null,
             chave_pix || null,
             parseFloat(comissao_pct) || 30.0,
             parseInt(comissao_meses) || 12,
             observacoes || null,
             senha_hash || (senha ? crypto.createHash('sha256').update(String(senha)).digest('hex') : null),
             pode_criar_gestor ? 1 : 0)
      marcarDirty()
      send(res, 200, { ok: true, id: r.lastInsertRowid, codigo })
    } catch (e) { send(res, 500, { error: 'Falha ao criar indicador: ' + e.message }) }
    return true
  }

  // ── ADMIN: Atualizar indicador ─────────────────────
  if (req.method === 'PUT' && upath.startsWith('/api/admin/indicadores/')) {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const id = parseInt(upath.replace('/api/admin/indicadores/', '').split('/')[0])
    if (!id) { send(res, 400, { error: 'ID inválido' }); return true }
    const body = await readBody(req)
    const fields = []
    const values = []
    if (body.email && db.prepare('SELECT id FROM indicadores WHERE lower(email)=lower(?) AND id<>?').get(String(body.email).trim(), id)) {
      send(res, 400, { error: `E-mail "${body.email}" já cadastrado para outro indicador.` }); return true
    }
    const allowed = ['nome', 'email', 'phone', 'chave_pix', 'comissao_pct', 'comissao_meses', 'ativo', 'pode_criar_gestor', 'observacoes']
    for (const k of allowed) if (body[k] !== undefined) {
      let v = body[k]
      if (k === 'phone' && v) v = String(v).replace(/\D/g, '')
      if (k === 'email' && v) v = String(v).toLowerCase().trim()
      if (k === 'comissao_pct')   v = parseFloat(v) || 30.0
      if (k === 'comissao_meses') v = parseInt(v) || 12
      if (k === 'ativo')           v = v ? 1 : 0
      if (k === 'pode_criar_gestor') v = v ? 1 : 0
      fields.push(`${k}=?`); values.push(v)
    }
    if (body.senha || body.senha_hash) {
      fields.push('senha_hash=?')
      values.push(body.senha_hash || crypto.createHash('sha256').update(String(body.senha)).digest('hex'))
    }
    if (!fields.length) { send(res, 400, { error: 'Nada a atualizar' }); return true }
    values.push(id)
    try {
      db.prepare(`UPDATE indicadores SET ${fields.join(',')} WHERE id=?`).run(...values)
      marcarDirty()
      send(res, 200, { ok: true })
    } catch (e) { send(res, 500, { error: 'Falha ao atualizar: ' + e.message }) }
    return true
  }

  // ── ADMIN: Deletar indicador ───────────────────────
  if (req.method === 'DELETE' && upath.startsWith('/api/admin/indicadores/')) {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const id = parseInt(upath.replace('/api/admin/indicadores/', '').split('/')[0])
    if (!id) { send(res, 400, { error: 'ID inválido' }); return true }
    // Protege histórico financeiro: se tem QUALQUER comissão registrada
    // (a_pagar, pago ou cancelado), não deixa deletar — só desativar.
    const cp = db.prepare("SELECT COUNT(*) AS n FROM comissoes WHERE indicador_id=?").get(id)
    if (cp?.n > 0) { send(res, 400, { error: `Indicador tem ${cp.n} comissão(ões) registrada(s). Desative em vez de deletar — preserva histórico financeiro.` }); return true }
    // Protege também se tiver leads convertidos
    const lc = db.prepare("SELECT COUNT(*) AS n FROM leads_indicacao WHERE indicador_id=? AND status='convertido'").get(id)
    if (lc?.n > 0) { send(res, 400, { error: `Indicador tem ${lc.n} lead(s) convertido(s). Desative em vez de deletar.` }); return true }
    try {
      db.prepare('DELETE FROM indicadores WHERE id=?').run(id)
      marcarDirty()
      send(res, 200, { ok: true })
    } catch (e) { send(res, 500, { error: 'Falha ao deletar: ' + e.message }) }
    return true
  }

  // ── ADMIN: Listar leads ────────────────────────────
  if (req.method === 'GET' && upath === '/api/admin/leads-indicacao') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const status = params.get('status') || null
    let sql = `SELECT l.*, i.nome AS indicador_nome, i.codigo AS indicador_codigo
               FROM leads_indicacao l LEFT JOIN indicadores i ON i.id=l.indicador_id`
    const sqlParams = []
    if (status) { sql += ' WHERE l.status=?'; sqlParams.push(status) }
    sql += ' ORDER BY l.created_at DESC LIMIT 500'
    send(res, 200, db.prepare(sql).all(...sqlParams))
    return true
  }

  // ── ADMIN: Atualizar status do lead ────────────────
  // Quando muda pra "convertido", deve passar tenant_id e valor_plano.
  // Sistema marca data_conversao automaticamente.
  if (req.method === 'PUT' && upath.startsWith('/api/admin/leads-indicacao/')) {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const id = parseInt(upath.replace('/api/admin/leads-indicacao/', '').split('/')[0])
    if (!id) { send(res, 400, { error: 'ID inválido' }); return true }
    const body = await readBody(req)
    const lead = db.prepare('SELECT * FROM leads_indicacao WHERE id=?').get(id)
    if (!lead) { send(res, 404, { error: 'Lead não encontrado' }); return true }

    const fields = []
    const values = []
    if (body.status !== undefined) {
      const okStatus = ['novo', 'em_contato', 'negociando', 'convertido', 'perdido']
      if (!okStatus.includes(body.status)) { send(res, 400, { error: 'Status inválido' }); return true }
      fields.push('status=?'); values.push(body.status)
      // Se mudou pra convertido pela primeira vez, marca data_conversao
      if (body.status === 'convertido' && lead.status !== 'convertido') {
        fields.push('data_conversao=CURRENT_TIMESTAMP')
      }
    }
    if (body.tenant_id_convertido !== undefined) {
      let tenantConvertido = null
      const rawTenant = String(body.tenant_id_convertido || '').trim()
      if (rawTenant) {
        const tConv = db.prepare('SELECT id FROM tenants WHERE id=? OR slug=? LIMIT 1').get(rawTenant, rawTenant)
        if (!tConv?.id) {
          send(res, 400, { error: `Cliente/tenant "${rawTenant}" não encontrado. Use o ID ou slug de um cliente cadastrado.` })
          return true
        }
        tenantConvertido = tConv.id
      }
      fields.push('tenant_id_convertido=?'); values.push(tenantConvertido)
    }
    if (body.valor_plano !== undefined) {
      fields.push('valor_plano=?'); values.push(parseFloat(body.valor_plano) || 99.90)
    }
    if (body.observacoes !== undefined) {
      fields.push('observacoes=?'); values.push(body.observacoes || null)
    }
    if (!fields.length) { send(res, 400, { error: 'Nada a atualizar' }); return true }
    values.push(id)
    try {
      db.prepare(`UPDATE leads_indicacao SET ${fields.join(',')} WHERE id=?`).run(...values)
      marcarDirty()
      sseBroadcast(`indicador-rt:${lead.indicador_id}`, 'indicador:LEAD_UPDATE', { id })
      send(res, 200, { ok: true })
    } catch (e) { send(res, 500, { error: 'Falha ao atualizar: ' + e.message }) }
    return true
  }

  // ── ADMIN: Listar comissões ────────────────────────
  // Filtros opcionais: ?status=a_pagar|pago, ?indicador_id=N, ?mes=YYYY-MM
  if (req.method === 'GET' && upath === '/api/admin/comissoes') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const q = {
      status: params.get('status') || '',
      indicador_id: params.get('indicador_id') || '',
      mes: params.get('mes') || ''
    }
    let sql = `SELECT c.*, i.nome AS indicador_nome, i.chave_pix,
               l.nome_estabelecimento, l.tenant_id_convertido
               FROM comissoes c
               LEFT JOIN indicadores i ON i.id=c.indicador_id
               LEFT JOIN leads_indicacao l ON l.id=c.lead_id WHERE 1=1`
    const sqlParams = []
    if (q.status)        { sql += ' AND c.status=?';        sqlParams.push(q.status) }
    if (q.indicador_id)  { sql += ' AND c.indicador_id=?';  sqlParams.push(parseInt(q.indicador_id)) }
    if (q.mes)           { sql += ' AND c.mes_referencia=?'; sqlParams.push(q.mes) }
    sql += ' ORDER BY c.mes_referencia DESC, i.nome ASC LIMIT 1000'
    send(res, 200, db.prepare(sql).all(...sqlParams))
    return true
  }

  // ── ADMIN: Registrar pagamento mensal do tenant convertido ─
  // Chama esse endpoint quando o tenant pagou a mensalidade. O sistema:
  //   1. Verifica todos leads "convertidos" e cria/atualiza linha de comissão
  //      no mes_referencia (limitado a comissao_meses do indicador)
  //   2. Status default = "a_pagar" (você ainda precisa pagar o indicador depois)
  if (req.method === 'POST' && upath === '/api/admin/comissoes/gerar-mes') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const body = await readBody(req)
    const mes = body.mes // formato YYYY-MM
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) { send(res, 400, { error: 'mes deve estar no formato YYYY-MM' }); return true }
    // Pega só leads convertidos com tenant_id, dentro da janela de comissão
    const leadsAtivos = db.prepare(`
      SELECT l.id AS lead_id, l.indicador_id, l.valor_plano, l.data_conversao,
             i.comissao_pct, i.comissao_meses
      FROM leads_indicacao l
      JOIN indicadores i ON i.id=l.indicador_id
      WHERE l.status='convertido' AND l.tenant_id_convertido IS NOT NULL
    `).all()
    let geradas = 0, ignoradas = 0
    const [anoMes, mesNum] = mes.split('-').map(Number)
    for (const l of leadsAtivos) {
      // Calcula quantos meses se passaram desde a conversão
      const dt = new Date(l.data_conversao)
      const mesesDesde = (anoMes - dt.getFullYear()) * 12 + (mesNum - (dt.getMonth() + 1))
      if (mesesDesde < 0 || mesesDesde >= l.comissao_meses) { ignoradas++; continue }
      const comVal = parseFloat((l.valor_plano * l.comissao_pct / 100).toFixed(2))
      try {
        db.prepare(`INSERT OR IGNORE INTO comissoes
          (indicador_id, lead_id, mes_referencia, valor_pagamento, comissao_valor, status)
          VALUES (?,?,?,?,?,'a_pagar')`)
          .run(l.indicador_id, l.lead_id, mes, l.valor_plano, comVal)
        sseBroadcast(`indicador-rt:${l.indicador_id}`, 'indicador:COMISSAO_UPDATE', { mes })
        geradas++
      } catch (e) { log('⚠️', `[comissao] erro lead ${l.lead_id}:`, e.message) }
    }
    if (geradas > 0) marcarDirty()
    send(res, 200, { ok: true, geradas, ignoradas, mes })
    return true
  }

  // ── ADMIN: Marcar comissão como paga ───────────────
  if (req.method === 'PUT' && upath.startsWith('/api/admin/comissoes/')) {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const id = parseInt(upath.replace('/api/admin/comissoes/', '').split('/')[0])
    if (!id) { send(res, 400, { error: 'ID inválido' }); return true }
    const body = await readBody(req)
    const fields = []
    const values = []
    if (body.status !== undefined) {
      if (!['a_pagar', 'pago', 'cancelado'].includes(body.status)) {
        send(res, 400, { error: 'Status inválido' }); return true
      }
      fields.push('status=?'); values.push(body.status)
      if (body.status === 'pago') fields.push('data_pagamento_indicador=CURRENT_TIMESTAMP')
    }
    if (body.observacoes !== undefined) {
      fields.push('observacoes=?'); values.push(body.observacoes || null)
    }
    if (!fields.length) { send(res, 400, { error: 'Nada a atualizar' }); return true }
    values.push(id)
    try {
      const atual = db.prepare('SELECT indicador_id FROM comissoes WHERE id=?').get(id)
      db.prepare(`UPDATE comissoes SET ${fields.join(',')} WHERE id=?`).run(...values)
      marcarDirty()
      if (atual?.indicador_id) sseBroadcast(`indicador-rt:${atual.indicador_id}`, 'indicador:COMISSAO_UPDATE', { id })
      send(res, 200, { ok: true })
    } catch (e) { send(res, 500, { error: 'Falha ao atualizar: ' + e.message }) }
    return true
  }

  // ── ADMIN: Resumo geral (cards do dashboard) ──────
  if (req.method === 'GET' && upath === '/api/admin/indicacoes-resumo') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const r = {
      indicadores_ativos: db.prepare("SELECT COUNT(*) AS n FROM indicadores WHERE ativo=1").get()?.n || 0,
      leads_novos:        db.prepare("SELECT COUNT(*) AS n FROM leads_indicacao WHERE status='novo'").get()?.n || 0,
      leads_total:        db.prepare("SELECT COUNT(*) AS n FROM leads_indicacao").get()?.n || 0,
      convertidos:        db.prepare("SELECT COUNT(*) AS n FROM leads_indicacao WHERE status='convertido'").get()?.n || 0,
      a_pagar:            db.prepare("SELECT COALESCE(SUM(comissao_valor),0) AS v FROM comissoes WHERE status='a_pagar'").get()?.v || 0,
      pago_total:         db.prepare("SELECT COALESCE(SUM(comissao_valor),0) AS v FROM comissoes WHERE status='pago'").get()?.v || 0,
    }
    send(res, 200, r)
    return true
  }

  // ═══════════════════════════════════════════════════════
  // PIX, Carteira & Saques
  // ═══════════════════════════════════════════════════════


  // ── Gera cobrança PIX via Mercado Pago ───────────────
  if (req.method === 'GET' && upath === '/api/admin/indicador-tutoriais') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const rows = db.prepare(`
      SELECT id, titulo, descricao, video_url, sort_order, ativo, created_at, updated_at
      FROM indicador_tutorial_videos
      ORDER BY sort_order ASC, id ASC
    `).all()
    send(res, 200, rows)
    return true
  }

  if (req.method === 'POST' && upath === '/api/admin/indicador-tutoriais') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const body = await readBody(req)
    const titulo = String(body.titulo || '').trim()
    const videoUrl = String(body.video_url || '').trim()
    const descricao = String(body.descricao || '').trim() || null
    if (!titulo) { send(res, 400, { error: 'Título obrigatório' }); return true }
    if (!videoUrl || !_tutorialUrlValida(videoUrl)) { send(res, 400, { error: 'Link do vídeo inválido' }); return true }
    const proxOrdem = db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM indicador_tutorial_videos').get()?.n || 10
    const sortOrder = body.sort_order === undefined || body.sort_order === '' ? proxOrdem : (parseInt(body.sort_order) || proxOrdem)
    try {
      const r = db.prepare(`
        INSERT INTO indicador_tutorial_videos (titulo, descricao, video_url, sort_order, ativo, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(titulo, descricao, videoUrl, sortOrder, body.ativo === false ? 0 : 1)
      marcarDirty()
      send(res, 200, { ok: true, id: r.lastInsertRowid })
    } catch (e) { send(res, 500, { error: 'Falha ao criar vídeo: ' + e.message }) }
    return true
  }

  if (req.method === 'PUT' && upath.startsWith('/api/admin/indicador-tutoriais/')) {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const id = parseInt(upath.replace('/api/admin/indicador-tutoriais/', '').split('/')[0])
    if (!id) { send(res, 400, { error: 'ID inválido' }); return true }
    const body = await readBody(req)
    const fields = []
    const values = []
    if (body.titulo !== undefined) {
      const titulo = String(body.titulo || '').trim()
      if (!titulo) { send(res, 400, { error: 'Título obrigatório' }); return true }
      fields.push('titulo=?'); values.push(titulo)
    }
    if (body.video_url !== undefined) {
      const videoUrl = String(body.video_url || '').trim()
      if (!videoUrl || !_tutorialUrlValida(videoUrl)) { send(res, 400, { error: 'Link do vídeo inválido' }); return true }
      fields.push('video_url=?'); values.push(videoUrl)
    }
    if (body.descricao !== undefined) { fields.push('descricao=?'); values.push(String(body.descricao || '').trim() || null) }
    if (body.sort_order !== undefined) { fields.push('sort_order=?'); values.push(parseInt(body.sort_order) || 0) }
    if (body.ativo !== undefined) { fields.push('ativo=?'); values.push(body.ativo ? 1 : 0) }
    if (!fields.length) { send(res, 400, { error: 'Nada a atualizar' }); return true }
    fields.push('updated_at=CURRENT_TIMESTAMP')
    values.push(id)
    try {
      db.prepare(`UPDATE indicador_tutorial_videos SET ${fields.join(',')} WHERE id=?`).run(...values)
      marcarDirty()
      send(res, 200, { ok: true })
    } catch (e) { send(res, 500, { error: 'Falha ao atualizar vídeo: ' + e.message }) }
    return true
  }

  if (req.method === 'DELETE' && upath.startsWith('/api/admin/indicador-tutoriais/')) {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const id = parseInt(upath.replace('/api/admin/indicador-tutoriais/', '').split('/')[0])
    if (!id) { send(res, 400, { error: 'ID inválido' }); return true }
    try {
      db.prepare('DELETE FROM indicador_tutorial_progress WHERE video_id=?').run(id)
      db.prepare('DELETE FROM indicador_tutorial_videos WHERE id=?').run(id)
      marcarDirty()
      send(res, 200, { ok: true })
    } catch (e) { send(res, 500, { error: 'Falha ao deletar vídeo: ' + e.message }) }
    return true
  }

  if (req.method === 'POST' && upath === '/api/pix/criar') {
    const tid = req.headers['x-tenant-id']
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    const body = await readBody(req)
    const { order_id, client, email = 'pagador@email.com' } = body
    let valor = body.valor
    if (!valor || valor <= 0) { send(res, 400, { error: 'valor inválido' }); return true }

    // ── Guarda server-side do modo PIX manual ───────────────────────────────
    // O front-end (cardápio) já evita chamar esta rota quando o gestor
    // desativou o PIX online (usa _pixAtivoGestor), mas isso não é garantia:
    // cache de JS antigo no navegador do cliente, outro canal, ou qualquer
    // chamada direta a esta API ainda geravam a cobrança PIX online/global
    // mesmo com o tenant configurado como manual. A fonte da verdade tem que
    // ser o servidor. Se o gestor escolheu manual de propósito (pix_ativo
    // === false, salvo explicitamente via togglePixOnline), bloqueia aqui —
    // sem exceção, independente de quem chamou a rota.
    try {
      const _cfgPixRow = db.prepare('SELECT ia_config FROM store_config WHERE tenant_id=?').get(tid)
      const _iaPixCfg  = _cfgPixRow?.ia_config ? JSON.parse(_cfgPixRow.ia_config) : {}
      const _pixModoDefinido = Object.prototype.hasOwnProperty.call(_iaPixCfg, 'pix_ativo')
      if (_pixModoDefinido && _iaPixCfg.pix_ativo === false) {
        log('🚫', `PIX online bloqueado tenant=${tid}: modo manual ativo (pix_ativo=false)`)
        send(res, 403, { error: 'PIX online está desativado para esta loja (modo manual ativo). Use a chave PIX manual.' })
        return true
      }
    } catch (e) { log('⚠️', 'Erro ao checar modo PIX manual:', e.message) }

    // ── Validações anti-fraude server-side ────────────────────────────────
    // (a) order_id deve pertencer ao tenant
    // (b) valor deve bater com total+taxa do pedido (anti-downgrade)
    // Se algo divergir, sobrescreve valor com o real do pedido (resiliente).
    if (order_id) {
      const ped = db.prepare('SELECT tenant_id, total, taxa, status FROM orders WHERE id=?').get(order_id)
      if (!ped) { send(res, 404, { error: 'Pedido não encontrado' }); return true }
      if (ped.tenant_id !== tid) { send(res, 403, { error: 'Pedido não pertence ao tenant' }); return true }
      // Status: 'aguardando_pix' (recém-criado). Outros status indicam pagamento já iniciado/finalizado.
      if (ped.status !== 'aguardando_pix') {
        send(res, 409, { error: `Pedido em status "${ped.status}" — não pode iniciar novo PIX` }); return true
      }
      // Anti-downgrade: força o valor real do pedido (com tolerância de 1 centavo p/ rounding)
      const totalPedido = (parseFloat(ped.total) || 0) + (parseFloat(ped.taxa) || 0)
      if (totalPedido > 0 && Math.abs(parseFloat(valor) - totalPedido) > 0.01) {
        log('⚠️', `PIX: valor R$${valor} ≠ total do pedido R$${totalPedido.toFixed(2)} — usando valor do pedido (anti-fraude) tenant=${tid}`)
        valor = totalPedido
      }
    }

    // ── Resolve conta MP: tenant primeiro, depois global ──
    // Isolamento garantido: tid vem do x-tenant-id (autenticado).
    const _mpCfg = _resolveMpForTenant(db, tid, MP_TOKEN)
    let mpToken = _mpCfg.mp_token
    let taxa = TAXA_PIX
    // Taxa PIX é da plataforma — sempre lida do global (admin define)
    try {
      const cfgMp = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
      const gCfg = cfgMp?.ia_config ? JSON.parse(cfgMp.ia_config) : {}
      if (gCfg.taxa_pix !== undefined) taxa = parseFloat(gCfg.taxa_pix) || 0
    } catch {}
    // Se tenant tem conta própria, taxa da plataforma não se aplica (dinheiro
    // não passa pela carteira interna — vai direto pro MP do gestor)
    if (_mpCfg.source === 'tenant') taxa = 0
    if (!mpToken) { send(res, 400, { error: 'Token Mercado Pago não configurado.' }); return true }
    // Valida e normaliza o valor ANTES de chamar a API. MP rejeita com 4037
    // ("Invalid transaction_amount") se for string com vírgula, NaN, <=0
    // ou com mais de 2 casas. O job retentava infinitamente com o valor errado.
    const _valorMp = _mpValor(valor)
    if (_valorMp === null) {
      log('❌', `PIX rejeitado tenant=${tid}: valor inválido (recebido: ${JSON.stringify(valor)})`)
      send(res, 400, { error: 'Valor do pedido inválido. Verifique se o total está correto.' })
      return true
    }
    // Log de diagnóstico: mostra os primeiros caracteres do token usado.
    // Útil pra confirmar se é APP_USR/TEST e se não tem caracteres estranhos.
    log('💳', `PIX iniciando tenant=${tid} conta=${_mpCfg.source} valor=${_valorMp} token_prefix=${mpToken.slice(0, 12)}... len=${mpToken.length}`)

    // extRef único — usa tenant_id completo + order_id (ou timestamp se não tiver pedido)
    const extRef = `ef-${tid}-${order_id || Date.now()}`
    const valorLiq = Math.max(0, _valorMp - taxa)

    // URL pública do servidor — necessária pra passar notification_url abaixo.
    // Sem isso, o Mercado Pago só avisa o webhook se ele estiver configurado
    // manualmente no painel de desenvolvedor DAQUELA conta MP específica.
    // Quando o restaurante usa conta própria (mp_source='tenant'), é uma
    // aplicação MP diferente da da plataforma, e ninguém configura webhook
    // manualmente lá — por isso o aviso nunca chegava e o pedido não
    // confirmava sozinho no gestor, mesmo com o pagamento aprovado.
    const _mpBaseUrl = String(process.env.PUBLIC_BASE_URL || process.env.APP_URL || process.env.BASE_URL || '').replace(/\/+$/, '') || (() => {
      const proto = String(req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0].trim()
      const host  = String(req.headers['x-forwarded-host'] || req.headers.host || 'estimafood.evocrm.sbs').split(',')[0].trim()
      return `${proto || 'https'}://${host || 'estimafood.evocrm.sbs'}`
    })()

    try {
      const mp = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${mpToken}`, 'X-Idempotency-Key': extRef },
        body: JSON.stringify({
          transaction_amount: _valorMp,
          description: `Pedido online - ${client || 'Cliente'}`,
          payment_method_id: 'pix',
          external_reference: extRef,
          notification_url: `${_mpBaseUrl}/webhook/mercadopago`,
          payer: { email, first_name: client || 'Cliente', last_name: '' },
        })
      })
      const mpData = await mp.json()
      if (!mp.ok) {
        log('❌', `MP PIX erro tenant=${tid} conta=${_mpCfg.source} status=${mp.status}:`, JSON.stringify(mpData).slice(0, 500))
        // Mensagem mais útil dependendo do erro
        let userMsg = mpData.message || 'Erro ao gerar PIX'
        if (mp.status === 401) {
          userMsg = _mpCfg.source === 'tenant'
            ? 'Sua conta Mercado Pago rejeitou a operação. Verifique se o Access Token cadastrado em Carteira → Conta MP Própria está correto e ativo.'
            : 'Conta Mercado Pago da plataforma rejeitou a operação.'
        } else if (mp.status === 400 && mpData.cause?.[0]?.code === 'invalid_token') {
          userMsg = 'Access Token Mercado Pago inválido. Atualize em Carteira → Conta MP Própria.'
        } else if (/payer.*not.*found|collector_id/i.test(JSON.stringify(mpData))) {
          userMsg = 'Conta Mercado Pago não está habilitada para receber PIX. Verifique no painel MP se as credenciais de produção estão ativas.'
        }
        send(res, 400, { error: userMsg })
        return true
      }

      const qr    = mpData.point_of_interaction?.transaction_data?.qr_code || ''
      const qrB64 = mpData.point_of_interaction?.transaction_data?.qr_code_base64 || ''

      // CRÍTICO: Quando MP é do tenant, dinheiro vai direto pra conta dele —
      // NÃO registramos em pagamentos_pix, pois essa tabela alimenta a carteira
      // interna da plataforma. Inseririr aqui faria o gestor poder sacar duas
      // vezes (uma direto na conta MP dele, outra solicitando à plataforma).
      // Usamos um marcador na tabela apenas para fins de auditoria/rastreio,
      // mas com valor_liquido = 0 para nunca virar saldo sacável.
      // mp_source é fixado no momento da criação para que webhooks e polls
      // futuros usem SEMPRE a mesma conta MP que originou o pagamento, mesmo
      // que o gestor mude a config depois (evita race condition).
      const isMpProprio = (_mpCfg.source === 'tenant')
      db.prepare(`INSERT OR IGNORE INTO pagamentos_pix
        (tenant_id,order_id,mp_payment_id,mp_external_ref,valor,taxa,valor_liquido,status,payer_name,qr_code,qr_code_base64,mp_source)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(tid, order_id || null, String(mpData.id), extRef, _valorMp, taxa,
          isMpProprio ? 0 : valorLiq,
          (mpData.status==='approved'?'aprovado':mpData.status==='rejected'?'rejeitado':mpData.status==='cancelled'?'cancelado':'pendente'),
          client || (isMpProprio ? 'MP_PROPRIO' : ''), qr, qrB64,
          isMpProprio ? 'tenant' : 'global')

      log('💳', `PIX criado: R$${_valorMp} tenant=${tid} mp_id=${mpData.id} conta=${_mpCfg.source}`)
      send(res, 200, { ok: true, mp_payment_id: mpData.id, qr_code: qr, qr_code_base64: qrB64, valor: _valorMp, taxa, valor_liquido: isMpProprio ? 0 : valorLiq, status: mpData.status })

      // ── Envia copia e cola via WhatsApp ────────────────────────────────────
      if (qr && body.phone) {
        setImmediate(async () => {
          try {
            const cfgWa  = db.prepare('SELECT evo_instance, evo_automacoes, order_num_offset, store_name FROM store_config WHERE tenant_id=?').get(tid)
            const inst   = cfgWa?.evo_instance || EVO_INST
            const auto   = (() => { try { return JSON.parse(cfgWa?.evo_automacoes||'{}') } catch { return {} } })()
            const pixCop = auto['pix_copia_cola'] || {}
            if (pixCop.on === false) return
            const offset = parseInt(cfgWa?.order_num_offset) || 0
            // Usa order_num sequencial do tenant quando disponível; senão fallback p/ id - offset
            const _ord   = body.order_id ? db.prepare('SELECT id, order_num, wa_track FROM orders WHERE id=? AND tenant_id=?').get(body.order_id, tid) : null
            if (body.order_id && parseInt(_ord?.wa_track || 0) !== 1) return
            const idStr  = _ord?.order_num ? String(_ord.order_num).padStart(3,'0') : ''
            const nome   = client || 'Cliente'
            const fmtVal = parseFloat(valor).toFixed(2).replace('.',',')
            // Mensagem 1: texto com instruções (customizável pelo gestor, sem o código)
            const nomeLoja  = cfgWa?.store_name || 'Restaurante'
            const tituloPix = idStr ? `PIX - Pedido #${idStr}` : 'PIX do seu pedido'
            const msgPadTxt = `🏪 *${nomeLoja}*\n${'─'.repeat(20)}\n\n💠 *${tituloPix}*\n\nOlá, *${nome}*! Para confirmar seu pedido, use o PIX Copia e Cola.\n\n*Valor:* R$ ${fmtVal}\n\nO código será enviado na próxima mensagem.`
            const msgTxt = pixCop.msg ? fillVars(pixCop.msg.replace('{codigo_pix}', '').trim(), { nome, id: idStr, total: fmtVal, codigo_pix: '' }).trim() : msgPadTxt
            await sendWA(body.phone, msgTxt, inst)
            // Mensagem 2: só o código (separado para facilitar cópia)
            await new Promise(r => setTimeout(r, 1000))
            await sendWA(body.phone, qr, inst)
            log('📤', `PIX copia e cola enviado WA → ${body.phone}`)
          } catch(e) { log('⚠️', 'Erro WA PIX copia e cola:', e.message) }
        })
      }
      // ──────────────────────────────────────────────────────────────────────
    } catch (e) { log('❌', 'MP fetch erro:', { error: e.message }); send(res, 500, { error: 'Erro ao criar PIX: ' + e.message }) }
    return true
  }

  // ── Consulta status PIX ──────────────────────────────
  if (req.method === 'GET' && upath === '/api/pix/status') {
    const mpId = params.get('mp_payment_id') || ''
    if (!mpId) { send(res, 400, { error: 'mp_payment_id obrigatório' }); return true }
    const tid = req.headers['x-tenant-id'] || ''
    if (tid) {
      const own = db.prepare('SELECT tenant_id FROM pagamentos_pix WHERE mp_payment_id=?').get(String(mpId))
      if (own && own.tenant_id !== tid) { send(res, 403, { error: 'Acesso negado' }); return true }
    }
    let mpToken = MP_TOKEN
    // Resolve token usando o mp_source GRAVADO no pagamento (evita race condition
    // se o gestor mudou a config entre criação e poll).
    const _cfgPoll = _resolveMpForExistingPayment(db, mpId, MP_TOKEN)
    if (_cfgPoll.mp_token) mpToken = _cfgPoll.mp_token
    if (!mpToken) { send(res, 400, { error: 'Token MP não configurado' }); return true }
    try {
      const r = await fetch('https://api.mercadopago.com/v1/payments/' + mpId, { headers: { 'Authorization': 'Bearer ' + mpToken } })
      const pd = await r.json()
      if (!r.ok) { const fb = db.prepare('SELECT status FROM pagamentos_pix WHERE mp_payment_id=?').get(String(mpId)); send(res, 200, { status: fb ? fb.status : 'pendente' }); return true }
      const novoStatus = pd.status === 'approved' ? 'aprovado' : pd.status === 'rejected' ? 'rejeitado' : pd.status === 'cancelled' ? 'cancelado' : 'pendente'
      const rowAtual = db.prepare('SELECT status,valor,tenant_id,order_id FROM pagamentos_pix WHERE mp_payment_id=?').get(String(mpId))
      // Atualiza status do pagamento apenas se mudou
      if (rowAtual && rowAtual.status !== novoStatus) {
        db.prepare('UPDATE pagamentos_pix SET status=?,paid_at=? WHERE mp_payment_id=?').run(novoStatus, pd.date_approved || null, String(mpId))
      }
      // Libera o pedido para o gestor SEMPRE que aprovado — independente de mudança de status
      // (corrige race condition: webhook pode ter setado 'aprovado' antes do poll chegar aqui)
      if (novoStatus === 'aprovado' && rowAtual?.order_id) {
        const pedAtual = db.prepare("SELECT status, pag FROM orders WHERE id=? AND tenant_id=?").get(rowAtual.order_id, rowAtual.tenant_id)
        const eraAguardando = pedAtual?.status === 'aguardando_pix'
        // Ressurreição: pedido cancelado pelo cleanup que recebeu pagamento depois
        const podeRessurreicao = pedAtual?.status === 'cancelado'
          && pedAtual?.pag !== 'pix_mp' && pedAtual?.pag !== 'cartao_mp'
        if (eraAguardando || podeRessurreicao) {
          log('✅', `PIX APROVADO (poll): R$${rowAtual.valor} tenant=${rowAtual.tenant_id}${podeRessurreicao ? ' — pedido ressuscitado' : ''}`)
          marcarDirty()
          // PIX online confirmado pelo MP → entra direto em produção (pula análise)
          // O pagamento já foi validado, não precisa de aceite manual.
          db.prepare("UPDATE orders SET status='producao', pag='pix_mp' WHERE id=? AND tenant_id=?").run(rowAtual.order_id, rowAtual.tenant_id)
          _atribuirOrderNumSeNecessario(db, rowAtual.tenant_id, rowAtual.order_id)
          const _fo1 = db.prepare("SELECT * FROM orders WHERE id=? AND tenant_id=?").get(rowAtual.order_id, rowAtual.tenant_id)
          if (typeof aplicarBaixaEstoquePedido === 'function' && _fo1) {
            aplicarBaixaEstoquePedido(rowAtual.tenant_id, _fo1, 'pix-status')
          }
          const _it1 = _fo1 && typeof _fo1.items==='string' ? (() => { try{return JSON.parse(_fo1.items)}catch{return []} })() : (_fo1?.items||[])
          sseBroadcast(`orders-rt:${rowAtual.tenant_id}`, `orders:UPDATE`, _fo1 ? {..._fo1, items:_it1, status:'producao', pag:'pix_mp', _pixOnlineConfirmado: true} : { id: rowAtual.order_id, status: 'producao', pag: 'pix_mp', _pixOnlineConfirmado: true })
          _notificarPixConfirmado(rowAtual.tenant_id, _fo1, sendWA, fillVars, EVO_INST, db)
        }
        _sincronizarPedidoPixAprovado(db, log, sseBroadcast, aplicarBaixaEstoquePedido, rowAtual.order_id, rowAtual.tenant_id, 'pix-status-sync')
      }
      send(res, 200, { status: novoStatus, mp_status: pd.status })
    } catch (e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Vincula PIX ao pedido ────────────────────────────
  // Quantidade de pedidos que um cliente (por telefone) já fez NESSE tenant.
  // Usa sufixo de 8 dígitos do telefone pra tolerar diferenças de formatação
  // (com/sem DDI, com/sem espaços etc.) — mesmo critério já usado em /api/clientes-gestor.
  // IMPORTANTE: sempre filtra por tenant_id pra nunca misturar dados entre lojas.
  if (req.method === 'GET' && upath === '/api/cliente-pedidos-count') {
    const tid = req.headers['x-tenant-id'] || ''
    const phoneRaw = params.get('phone') || ''
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatório' }); return true }
    const digits = phoneRaw.replace(/\D/g, '')
    const last8 = digits.slice(-8)
    if (!last8) { send(res, 200, { count: 0 }); return true }
    try {
      const row = db.prepare(
        `SELECT COUNT(*) as c FROM orders
         WHERE tenant_id=? AND status NOT IN ('cancelado','aguardando_pix')
           AND phone LIKE ?`
      ).get(tid, '%' + last8)
      send(res, 200, { count: row?.c || 0 })
    } catch (e) {
      log('❌', '/api/cliente-pedidos-count erro:', e.message)
      send(res, 500, { error: e.message })
    }
    return true
  }

  if (req.method === 'GET' && upath === '/api/pix/order-sync') {
    const tid = req.headers['x-tenant-id'] || ''
    const orderId = parseInt(params.get('order_id') || '0', 10)
    if (!tid || !orderId) { send(res, 400, { error: 'tenant/order obrigatorios' }); return true }
    const own = db.prepare('SELECT id FROM orders WHERE id=? AND tenant_id=?').get(orderId, tid)
    if (!own) { send(res, 404, { error: 'Pedido nao encontrado' }); return true }
    const synced = _sincronizarPedidoPixAprovado(db, log, sseBroadcast, aplicarBaixaEstoquePedido, orderId, tid, 'pix-print-sync')
    const order = synced || db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(orderId, tid)
    const items = order && typeof order.items === 'string'
      ? (() => { try { return JSON.parse(order.items) } catch { return [] } })()
      : (order?.items || [])
    send(res, 200, { ok: true, order: order ? { ...order, items } : null })
    return true
  }

  if (req.method === 'POST' && upath === '/api/pix/vincular') {
    const tid = req.headers['x-tenant-id']
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatório' }); return true }
    const body = await readBody(req)
    const mpId = String(body.mp_payment_id || ''), ordId = parseInt(body.order_id) || 0
    if (!mpId || !ordId) { send(res, 400, { error: 'obrigatórios' }); return true }
    // Verifica ownership: o pagamento deve pertencer ao tenant
    const pixRow = db.prepare('SELECT tenant_id, status FROM pagamentos_pix WHERE mp_payment_id=?').get(mpId)
    if (!pixRow) { send(res, 404, { error: 'Pagamento não encontrado' }); return true }
    if (pixRow.tenant_id !== tid) { send(res, 403, { error: 'Acesso negado' }); return true }
    // Verifica ownership do pedido
    const orderRow = db.prepare('SELECT tenant_id FROM orders WHERE id=?').get(ordId)
    if (!orderRow || orderRow.tenant_id !== tid) { send(res, 403, { error: 'Pedido não pertence ao tenant' }); return true }
    // Vincula sempre (mesmo se ainda pendente)
    db.prepare('UPDATE pagamentos_pix SET order_id=? WHERE mp_payment_id=? AND tenant_id=?').run(ordId, mpId, tid)
    // Só marca como pago se o pagamento estiver realmente aprovado
    if (pixRow.status === 'aprovado') {
      _sincronizarPedidoPixAprovado(db, log, sseBroadcast, aplicarBaixaEstoquePedido, ordId, tid, 'pix-vincular')
    }
    marcarDirty()
    send(res, 200, { ok: true, aprovado: pixRow.status === 'aprovado' })
    return true
  }

  // ── Lê config PIX do tenant ──────────────────────────
  if (req.method === 'GET' && upath === '/api/pix/config') {
    const tid = req.headers['x-tenant-id'] || params.get('tenant_id') || ''
    if (!tid) { send(res, 400, { error: 'tenant_id obrigatório' }); return true }
    try {
      const safeJson = (v) => { try { return v ? JSON.parse(v) : {} } catch { return {} } }
      const cfg  = db.prepare('SELECT ia_config FROM store_config WHERE tenant_id=?').get(tid)
      const ia   = safeJson(cfg?.ia_config)
      const gCfg = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
      const gIa  = safeJson(gCfg?.ia_config)
      // Resolve conta MP que vai ser usada para os pedidos deste tenant
      const _mpResolv = _resolveMpForTenant(db, tid, MP_TOKEN)
      const mpConfigurado  = !!_mpResolv.mp_token
      const pixAtivo       = ia.pix_ativo === true
      // Diferencia "nunca configurado" (undefined) de "desativado de propósito"
      // (false explícito, via togglePixOnline -> Manual). O front usa isso pra
      // só cair no fallback da conta MP global quando o gestor NUNCA escolheu
      // manual — se ele escolheu manual de propósito, isso tem que ser respeitado
      // mesmo com uma conta MP global disponível na plataforma.
      const pixAtivoDefinido = Object.prototype.hasOwnProperty.call(ia, 'pix_ativo')
      const pagOnlineAtivo = ia.pag_online_ativo !== false
      // Cartão disponível se a conta resolvida (tenant ou global) tem public key
      const cartaoDisponivel   = !!_mpResolv.mp_public_key
      const cartaoOnlineAtivo  = ia.cartao_online_ativo !== false && cartaoDisponivel
      send(res, 200, {
        pix_ativo:            pixAtivo,
        pix_ativo_gestor:     pixAtivo,
        pix_ativo_definido:   pixAtivoDefinido,
        mp_configurado:       mpConfigurado,
        // Quando tenant tem conta própria, taxa da plataforma não se aplica
        taxa_pix:             _mpResolv.source === 'tenant' ? 0 :
                              (gIa.taxa_pix !== undefined ? parseFloat(gIa.taxa_pix) : parseFloat(process.env.TAXA_PIX || '1.00')),
        pix_key_manual:       ia.pix_key_manual || '',
        pix_key_manual_tipo:  ia.pix_key_manual_tipo || '',
        pix_key_manual_banco: ia.pix_key_manual_banco || '',
        pag_online_ativo:     pagOnlineAtivo,
        cartao_disponivel:    cartaoDisponivel,
        cartao_online_ativo:  cartaoOnlineAtivo,
      })
    } catch (e) { log('❌', '/api/pix/config erro:', e.message); send(res, 500, { error: e.message }) }
    return true
  }

  // ── Gestor salva config PIX ──────────────────────────
  if (req.method === 'POST' && upath === '/api/pix/gestor-config') {
    const tid = req.headers['x-tenant-id'] || ''
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatório' }); return true }
    const body = await readBody(req)
    try {
      const cfg = db.prepare('SELECT ia_config FROM store_config WHERE tenant_id=?').get(tid)
      const ia  = cfg?.ia_config ? JSON.parse(cfg.ia_config) : {}
      if (body.pix_ativo !== undefined)            ia.pix_ativo            = body.pix_ativo !== false
      if (body.pix_key_manual !== undefined)        ia.pix_key_manual       = body.pix_key_manual || ''
      if (body.pix_key_manual_tipo !== undefined)   ia.pix_key_manual_tipo  = body.pix_key_manual_tipo || ''
      if (body.pix_key_manual_banco !== undefined)  ia.pix_key_manual_banco = body.pix_key_manual_banco || ''
      if (body.pag_online_ativo !== undefined)      ia.pag_online_ativo     = body.pag_online_ativo !== false
      if (body.cartao_online_ativo !== undefined)   ia.cartao_online_ativo  = body.cartao_online_ativo !== false
      db.prepare('INSERT INTO store_config (tenant_id,ia_config) VALUES (?,?) ON CONFLICT(tenant_id) DO UPDATE SET ia_config=excluded.ia_config').run(tid, JSON.stringify(ia))
      marcarDirty()
      // Notifica o cardápio em tempo real (SSE) — sem isso, um cliente com a
      // página já aberta ficava com o estado antigo de PIX em memória até
      // recarregar, e o pedido dele ainda tentava gerar QR online da conta
      // global mesmo depois do gestor salvar "Manual".
      try {
        const _rowPix = db.prepare('SELECT * FROM store_config WHERE tenant_id=?').get(tid)
        if (typeof emit === 'function' && _rowPix) emit(tid, 'store_config', _rowPix, 'UPDATE')
      } catch (e) { log('⚠️', 'emit store_config (pix) falhou:', e.message) }
      log('⚙️', `PIX/pagamentos config salva tenant=${tid} pix_ativo=${ia.pix_ativo} pag_online=${ia.pag_online_ativo}`)
      send(res, 200, { ok: true, pix_ativo: ia.pix_ativo, pix_key_manual: ia.pix_key_manual || '', pag_online_ativo: ia.pag_online_ativo !== false, cartao_online_ativo: ia.cartao_online_ativo !== false })
    } catch (e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Webhook Mercado Pago ─────────────────────────────
  if (req.method === 'POST' && upath === '/webhook/mercadopago') {
    const body = await readBody(req)
    const mpId = body?.data?.id || body?.id
    if (!mpId) { send(res, 200, { ok: true }); return true }
    // Webhook pode vir do MP por qualquer tenant — descobre pelo mp_source
    // gravado no pagamento. Se não achar (pagamento SaaS ou ainda não inserido),
    // cai no global como fallback razoável.
    let mpToken = MP_TOKEN
    const _cfgWh = _resolveMpForExistingPayment(db, mpId, MP_TOKEN)
    if (_cfgWh.mp_token) mpToken = _cfgWh.mp_token
    else {
      // Fallback final: global (cobre faturas SaaS antes do INSERT)
      const _g = _resolveMpGlobal(db, MP_TOKEN)
      if (_g) mpToken = _g
    }
    if (!mpToken) { send(res, 200, { ok: true }); return true }
    try {
      const whType = String(body?.type || body?.topic || body?.action || '').toLowerCase()
      if (whType.includes('subscription_authorized_payment') || whType.includes('authorized_payment')) {
        const ar = await fetch(`https://api.mercadopago.com/authorized_payments/${mpId}`, { headers: { 'Authorization': `Bearer ${mpToken}` } })
        const ap = await ar.json()
        if (ar.ok) {
          const preId = ap.preapproval_id || ap.preapproval?.id || ap.subscription_id || ''
          const extRef = ap.external_reference || ap.preapproval?.external_reference || ap.metadata?.external_reference || ''
          const ass = _localizarAssinaturaMp(db, { preapprovalId: preId, externalRef: extRef })
          if (ass) {
            const paymentId = ap.payment?.id || ap.payment_id || ap.mp_payment_id || ''
            const paymentStatus = ap.payment?.status || ap.status || ''
            const paymentDate = ap.payment?.date_approved || ap.date_created || null
            _processarCobrancaAssinatura(db, log, marcarDirty, ass, paymentId, paymentStatus, paymentDate, String(ap.id || mpId))
          }
        }
        send(res, 200, { ok: true })
        return true
      }

      if (whType.includes('subscription_preapproval') || whType === 'preapproval') {
        const pr = await fetch(`https://api.mercadopago.com/preapproval/${mpId}`, { headers: { 'Authorization': `Bearer ${mpToken}` } })
        const pre = await pr.json()
        if (pr.ok) {
          const ass = _localizarAssinaturaMp(db, { preapprovalId: pre.id || mpId, externalRef: pre.external_reference || '' })
          if (ass) {
            const statusPre = pre.status || ass.status || 'pending'
            const nextPayment = pre.next_payment_date || pre.auto_recurring?.start_date || ass.next_payment_at || null
            const cancelado = ['cancelled', 'canceled'].includes(String(statusPre).toLowerCase())
            db.prepare(`UPDATE plano_assinaturas
              SET status=?, next_payment_at=?, canceled_at=CASE WHEN ? THEN COALESCE(canceled_at, ?) ELSE canceled_at END,
                  updated_at=datetime('now')
              WHERE id=?`)
              .run(statusPre, nextPayment, cancelado ? 1 : 0, new Date().toISOString(), ass.id)
            marcarDirty()
          }
        }
        send(res, 200, { ok: true })
        return true
      }

      const r = await fetch(`https://api.mercadopago.com/v1/payments/${mpId}`, { headers: { 'Authorization': `Bearer ${mpToken}` } })
      const pd = await r.json()
      if (!r.ok) { send(res, 200, { ok: true }); return true }
      const novoStatus = pd.status === 'approved' ? 'aprovado' : pd.status === 'rejected' ? 'rejeitado' : pd.status === 'cancelled' ? 'cancelado' : 'pendente'

      // ── Rota 1: PIX (pagamentos_pix) ──────────────────────────────────────
      const row = db.prepare('SELECT status,valor,tenant_id,order_id FROM pagamentos_pix WHERE mp_payment_id=?').get(String(mpId))
      if (row && row.status !== novoStatus) {
        db.prepare('UPDATE pagamentos_pix SET status=?,paid_at=? WHERE mp_payment_id=?').run(novoStatus, pd.date_approved || null, String(mpId))
        marcarDirty()
        if (novoStatus === 'aprovado') {
          log('✅', `Webhook MP APROVADO (PIX): R$${row.valor} tenant=${row.tenant_id}`)
          if (row.order_id) {
            const pedAtual = db.prepare("SELECT status, pag FROM orders WHERE id=? AND tenant_id=?").get(row.order_id, row.tenant_id)
            const eraAguardando = pedAtual?.status === 'aguardando_pix'
            // Ressurreição: pedido cancelado pelo cleanup que recebeu pagamento agora
            const podeRessurreicao = pedAtual?.status === 'cancelado'
              && pedAtual?.pag !== 'pix_mp' && pedAtual?.pag !== 'cartao_mp'

            if (eraAguardando || podeRessurreicao) {
              // PIX online confirmado pelo MP → entra direto em produção (pula análise)
              // O pagamento já foi validado pelo Mercado Pago, não precisa de aceite manual.
              db.prepare("UPDATE orders SET status='producao', pag='pix_mp' WHERE id=? AND tenant_id=?").run(row.order_id, row.tenant_id)
              _atribuirOrderNumSeNecessario(db, row.tenant_id, row.order_id)
              if (podeRessurreicao) log('🔄', `PEDIDO RESSUSCITADO (webhook): pagamento PIX chegou após cancelamento — id=${row.order_id} tenant=${row.tenant_id}`)
            } else if (pedAtual) {
              db.prepare("UPDATE orders SET pag='pix_mp' WHERE id=? AND tenant_id=?").run(row.order_id, row.tenant_id)
              _atribuirOrderNumSeNecessario(db, row.tenant_id, row.order_id)
            }
            const _ns4 = (eraAguardando || podeRessurreicao) ? 'producao' : pedAtual?.status
            const _fo4 = db.prepare("SELECT * FROM orders WHERE id=? AND tenant_id=?").get(row.order_id, row.tenant_id)
            if ((eraAguardando || podeRessurreicao) && typeof aplicarBaixaEstoquePedido === 'function' && _fo4) {
              aplicarBaixaEstoquePedido(row.tenant_id, _fo4, 'pix-webhook')
            }
            const _it4 = _fo4 && typeof _fo4.items==='string' ? (() => { try{return JSON.parse(_fo4.items)}catch{return []} })() : (_fo4?.items||[])
            // Marca _pixOnlineConfirmado para o frontend reconhecer e imprimir automático
            sseBroadcast(`orders-rt:${row.tenant_id}`, `orders:UPDATE`, _fo4 ? {..._fo4, items:_it4, status:_ns4, pag:'pix_mp', _pixOnlineConfirmado: (eraAguardando || podeRessurreicao)} : { id: row.order_id, status: _ns4, pag: 'pix_mp', _pixOnlineConfirmado: (eraAguardando || podeRessurreicao) })
            // Notifica cliente: pagamento PIX confirmado
            if (eraAguardando || podeRessurreicao) _notificarPixConfirmado(row.tenant_id, _fo4, sendWA, fillVars, EVO_INST, db)
          }
        }
      }
      if (row && novoStatus === 'aprovado' && row.order_id) {
        _sincronizarPedidoPixAprovado(db, log, sseBroadcast, aplicarBaixaEstoquePedido, row.order_id, row.tenant_id, 'pix-webhook-sync')
      }

      // ── Rota 2: Cartão online (pagamentos_cartao) ────────────────────────
      const rowC = db.prepare('SELECT status,valor,tenant_id,order_id FROM pagamentos_cartao WHERE mp_payment_id=?').get(String(mpId))
      if (rowC && rowC.status !== novoStatus) {
        db.prepare('UPDATE pagamentos_cartao SET status=?, status_detail=?, paid_at=? WHERE mp_payment_id=?')
          .run(novoStatus, pd.status_detail || '', pd.date_approved || null, String(mpId))
        marcarDirty()
        if (novoStatus === 'aprovado') {
          log('✅', `Webhook MP APROVADO (CARTÃO): R$${rowC.valor} tenant=${rowC.tenant_id}`)
          if (rowC.order_id) {
            const pedAtualC = db.prepare("SELECT status, pag FROM orders WHERE id=? AND tenant_id=?").get(rowC.order_id, rowC.tenant_id)
            const eraAguardandoC = pedAtualC?.status === 'aguardando_cartao'
            const podeRessurreicaoC = pedAtualC?.status === 'cancelado'
              && pedAtualC?.pag !== 'pix_mp' && pedAtualC?.pag !== 'cartao_mp'

            if (eraAguardandoC || podeRessurreicaoC) {
              db.prepare("UPDATE orders SET status='analise', pag='cartao_mp' WHERE id=? AND tenant_id=?").run(rowC.order_id, rowC.tenant_id)
              _atribuirOrderNumSeNecessario(db, rowC.tenant_id, rowC.order_id)
              if (podeRessurreicaoC) log('🔄', `PEDIDO RESSUSCITADO (cartão): pagamento chegou após cancelamento — id=${rowC.order_id} tenant=${rowC.tenant_id}`)
            } else if (pedAtualC) {
              db.prepare("UPDATE orders SET pag='cartao_mp' WHERE id=? AND tenant_id=?").run(rowC.order_id, rowC.tenant_id)
              _atribuirOrderNumSeNecessario(db, rowC.tenant_id, rowC.order_id)
            }
            const _nsC = (eraAguardandoC || podeRessurreicaoC) ? 'analise' : pedAtualC?.status
            const _foC = db.prepare("SELECT * FROM orders WHERE id=? AND tenant_id=?").get(rowC.order_id, rowC.tenant_id)
            const _itC = _foC && typeof _foC.items==='string' ? (() => { try{return JSON.parse(_foC.items)}catch{return []} })() : (_foC?.items||[])
            sseBroadcast(`orders-rt:${rowC.tenant_id}`, `orders:UPDATE`, _foC ? {..._foC, items:_itC, status:_nsC, pag:'cartao_mp'} : { id: rowC.order_id, status: _nsC, pag: 'cartao_mp' })
            // Notifica cliente: cartão confirmado
            if ((eraAguardandoC || podeRessurreicaoC) && _foC?.phone && parseInt(_foC.wa_track || 0) === 1) {
              setImmediate(async () => {
                try {
                  const cfg    = db.prepare('SELECT evo_instance, order_num_offset, store_name FROM store_config WHERE tenant_id=?').get(rowC.tenant_id)
                  const inst   = cfg?.evo_instance || EVO_INST
                  const loja   = cfg?.store_name || 'Restaurante'
                  const offset = parseInt(cfg?.order_num_offset) || 0
                  const idStr  = _numeroPedidoPad(_foC, offset)
                  const nome   = (_foC.client || 'Cliente').split(' ')[0]
                  const total  = (parseFloat(_foC.total||0)+parseFloat(_foC.taxa||0)).toFixed(2).replace('.',',')
                  const msg    = `🏪 *${loja}*\n${'─'.repeat(20)}\n\n✅ *Pagamento confirmado*\n\nOlá, *${nome}*! Recebemos o pagamento no cartão do pedido *#${idStr}*.\n\n*Total:* R$ ${total}\n\nSeu pedido já entrou em preparo.`
                  await sendWA(_foC.phone, msg, inst)
                } catch(e) { log('❌','Erro notif cartão:', e.message) }
              })
            }
          }
        }
      }

      // ── Rota 3: Fatura SaaS (assinatura mensal do restaurante) ───────────
      // Tenta casar por mp_payment_id (PIX) ou external_reference (cartão preference)
      const assPg = _localizarAssinaturaMp(db, {
        preapprovalId: pd.metadata?.preapproval_id || pd.preapproval_id || '',
        externalRef: pd.external_reference || pd.metadata?.external_reference || ''
      })
      if (assPg) {
        _processarCobrancaAssinatura(db, log, marcarDirty, assPg, String(mpId), pd.status, pd.date_approved || pd.date_created || null, '')
        send(res, 200, { ok: true })
        return true
      }

      let rowF = db.prepare('SELECT * FROM faturas WHERE mp_payment_id=?').get(String(mpId))
      if (!rowF && pd.external_reference) {
        rowF = db.prepare('SELECT * FROM faturas WHERE mp_external_ref=?').get(pd.external_reference)
        // Se casou por external_ref e ainda não tinha mp_payment_id (caso preference), salva
        if (rowF && !rowF.mp_payment_id) {
          db.prepare('UPDATE faturas SET mp_payment_id=? WHERE id=?').run(String(mpId), rowF.id)
        }
      }
      if (rowF && rowF.status !== 'pago' && rowF.status !== 'cancelado' && novoStatus === 'aprovado') {
        const tenant = db.prepare('SELECT * FROM tenants WHERE id=?').get(rowF.tenant_id)
        if (tenant) {
          // Marca fatura paga
          db.prepare("UPDATE faturas SET status='pago', pago_em=? WHERE id=?")
            .run(pd.date_approved || new Date().toISOString(), rowF.id)
          _limparRoboFaturaAlert(db, sseBroadcast, rowF.tenant_id)

          // Renova plano: soma meses ao expires_at atual (ou hoje se já expirou/sem data)
          const hoje = new Date()
          hoje.setHours(0,0,0,0)
          const atual = _parseDateOnlyLocal(tenant.expires_at)
          const baseDate = atual && atual > hoje ? atual : hoje
          const novaExpISO = _dateOnlyISO(_addCalendarMonths(baseDate, parseInt(rowF.meses) || 1))

          // Atualiza plano também (caso fatura tenha sido pra upgrade)
          const planoNovo = ['premium','essencial','pro','fiscal'].includes(rowF.plano) ? rowF.plano : tenant.plano
          db.prepare('UPDATE tenants SET expires_at=?, ativo=1, plano=?, updated_at=datetime(\'now\') WHERE id=?')
            .run(novaExpISO, planoNovo, tenant.id)

          marcarDirty()
          log('✅', `FATURA PAGA: tenant=${tenant.nome} valor=R$${rowF.valor} plano=${planoNovo} novo_vencimento=${novaExpISO}`)

          // Notifica gestor por WhatsApp
          ;(async () => {
            try {
              let telefone = tenant.telefone_cobranca ? String(tenant.telefone_cobranca).replace(/\D/g, '') : null
              if (!telefone) {
                try {
                  const cfg = db.prepare('SELECT store_whatsapp FROM store_config WHERE tenant_id=?').get(tenant.id)
                  if (cfg?.store_whatsapp) telefone = String(cfg.store_whatsapp).replace(/\D/g, '')
                } catch {}
              }
              if (telefone && (telefone.length === 11 || telefone.length === 10)) telefone = '55' + telefone
              if (telefone) {
                const planoNome = _planoSaasLabel(planoNovo)
                const valorTxt  = parseFloat(rowF.valor).toFixed(2).replace('.', ',')
                const venceTxt  = _parseDateOnlyLocal(novaExpISO)?.toLocaleDateString('pt-BR') || novaExpISO
                const msg = [
                  `✅ *Pagamento confirmado*`,
                  ``,
                  `Recebemos seu pagamento do plano *${planoNome}*.`,
                  ``,
                  `💰 *Valor:* R$ ${valorTxt}`,
                  `📅 *Próximo vencimento:* ${venceTxt}`,
                  ``,
                  `Seu acesso continua ativo. Obrigado por usar o *${_brandNome(tenant.segmento)}*! 🍽️`
                ].join('\n')
                const instCob = _getInstanciaCobranca(db, EVO_INST)
                await sendWA(telefone, msg, instCob)
                log('📨', `Confirmação fatura WA enviada: tenant=${tenant.nome} (instância: ${instCob})`)
              }
            } catch (e) { log('⚠️', 'Confirmação fatura WA erro:', e.message) }
          })()
        }
      } else if (rowF && rowF.status !== novoStatus && (novoStatus === 'rejeitado' || novoStatus === 'cancelado')) {
        db.prepare("UPDATE faturas SET status=? WHERE id=?").run(novoStatus, rowF.id)
        marcarDirty()
        log('⚠️', `Fatura ${rowF.id} marcada como ${novoStatus}`)
      }
    } catch (e) { log('❌', 'Webhook MP erro:', e.message) }
    send(res, 200, { ok: true })
    return true
  }

  // ── Saldo da carteira ────────────────────────────────
  if (req.method === 'GET' && upath === '/api/carteira') {
    const tid = req.headers['x-tenant-id']
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatório' }); return true }
    if (!requireFinanceAccess(tid)) return true
    try {
      // PIX aprovados
      const pixRecebido  = db.prepare("SELECT COALESCE(SUM(valor_liquido),0) as v FROM pagamentos_pix WHERE tenant_id=? AND status='aprovado'").get(tid)?.v || 0
      const pixTaxas     = db.prepare("SELECT COALESCE(SUM(taxa),0) as v FROM pagamentos_pix WHERE tenant_id=? AND status='aprovado'").get(tid)?.v || 0
      const pixCount     = db.prepare("SELECT COUNT(*) as c FROM pagamentos_pix WHERE tenant_id=? AND status='aprovado'").get(tid)?.c || 0
      const ultimosPix   = db.prepare("SELECT * FROM pagamentos_pix WHERE tenant_id=? ORDER BY created_at DESC LIMIT 10").all(tid)
      const pixPendentes = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(valor),0) as v FROM pagamentos_pix WHERE tenant_id=? AND status='pendente'").get(tid)

      // Cartão online aprovados (taxa = 7% já descontada na hora do pagamento)
      const cartaoRows   = db.prepare("SELECT COALESCE(SUM(valor),0) as bruto, COUNT(*) as c FROM pagamentos_cartao WHERE tenant_id=? AND status='aprovado'").get(tid)
      const cartaoBruto  = cartaoRows?.bruto || 0
      const cartaoCount  = cartaoRows?.c || 0
      const TAXA_CARTAO  = 0.07
      const cartaoLiq    = cartaoBruto * (1 - TAXA_CARTAO)
      const cartaoTaxas  = cartaoBruto * TAXA_CARTAO
      const ultimosCartao= db.prepare("SELECT * FROM pagamentos_cartao WHERE tenant_id=? ORDER BY created_at DESC LIMIT 10").all(tid)

      // Total recebido = PIX líquido + Cartão líquido
      const totalRecebido = pixRecebido + cartaoLiq
      const totalTaxas    = pixTaxas + cartaoTaxas
      const totalPagamentos = pixCount + cartaoCount

      // Saques já solicitados/pagos
      const totalSacado   = db.prepare("SELECT COALESCE(SUM(valor_liquido),0) as v FROM saques WHERE tenant_id=? AND status IN ('pendente','aprovado','pago')").get(tid)?.v || 0
      const saldoDisp     = Math.max(0, totalRecebido - totalSacado)

      let taxaPix = 1.00
      try { const gc = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get(); const g = gc?.ia_config ? JSON.parse(gc.ia_config) : {}; if (g.taxa_pix !== undefined) taxaPix = parseFloat(g.taxa_pix) || 0 } catch {}

      // Tenant tem MP próprio? Se sim, novos pagamentos não passam pela carteira
      const _mpResolv = _resolveMpForTenant(db, tid, MP_TOKEN)
      const mpProprio = _mpResolv.source === 'tenant'

      send(res, 200, {
        saldo_disponivel:  saldoDisp,
        total_recebido:    totalRecebido,
        total_sacado:      totalSacado,
        total_taxas:       totalTaxas,
        taxa_por_pagamento: taxaPix,
        total_pagamentos:  totalPagamentos,
        pix_recebido:      pixRecebido,
        pix_count:         pixCount,
        cartao_recebido:   cartaoLiq,
        cartao_bruto:      cartaoBruto,
        cartao_count:      cartaoCount,
        ultimos_pagamentos: ultimosPix,
        ultimos_cartao:    ultimosCartao,
        pendentes_count:   pixPendentes?.c || 0,
        pendentes_valor:   pixPendentes?.v || 0,
        mp_proprio:        mpProprio,
        mp_source:         _mpResolv.source,
      })
    } catch (e) { log('❌', '/api/carteira erro:', e.message); send(res, 500, { error: e.message }) }
    return true
  }

  // ── Solicitar saque ──────────────────────────────────
  if (req.method === 'POST' && upath === '/api/saques/solicitar') {
    const tid = req.headers['x-tenant-id']
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatório' }); return true }
    if (!requireFinanceAccess(tid)) return true
    // Blindagem: se tenant tem MP próprio, dinheiro cai direto na conta dele
    // — não passa pela carteira interna, então saque não faz sentido.
    const _mpResolvSaq = _resolveMpForTenant(db, tid, MP_TOKEN)
    if (_mpResolvSaq.source === 'tenant') {
      send(res, 400, { error: 'Você está usando sua própria conta Mercado Pago. Os pagamentos vão direto pra ela — não há nada a sacar pela plataforma.' })
      return true
    }
    try {
      const body = await readBody(req)
      const { pix_key, pix_key_tipo = 'aleatoria' } = body
      if (!pix_key) { send(res, 400, { error: 'Chave PIX obrigatória' }); return true }

      // Executa cálculo + insert dentro de uma transação para evitar race condition
      let resultado
      try {
        resultado = db.transaction(() => {
          // PIX aprovados
          const pixLiq  = db.prepare("SELECT COALESCE(SUM(valor_liquido),0) as v FROM pagamentos_pix WHERE tenant_id=? AND status='aprovado'").get(tid)?.v || 0
          // Cartão aprovados (desconta 7% taxa)
          const cartaoB = db.prepare("SELECT COALESCE(SUM(valor),0) as v FROM pagamentos_cartao WHERE tenant_id=? AND status='aprovado'").get(tid)?.v || 0
          const cartaoLiq = cartaoB * 0.93

          const totalRecebido = pixLiq + cartaoLiq
          const totalSacado   = db.prepare("SELECT COALESCE(SUM(valor_liquido),0) as v FROM saques WHERE tenant_id=? AND status IN ('pendente','aprovado','pago')").get(tid)?.v || 0
          const saldo = Math.max(0, totalRecebido - totalSacado)

          if (saldo < 1) return { err: 'Saldo insuficiente para saque' }
          const jaTemPendente = db.prepare("SELECT id FROM saques WHERE tenant_id=? AND status='pendente'").get(tid)
          if (jaTemPendente) return { err: 'Você já tem um saque pendente aguardando aprovação' }

          const numPix    = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(taxa),0) as t FROM pagamentos_pix WHERE tenant_id=? AND status='aprovado'").get(tid)
          const numCartao = db.prepare("SELECT COUNT(*) as c FROM pagamentos_cartao WHERE tenant_id=? AND status='aprovado'").get(tid)
          const numTotal  = (numPix?.c || 0) + (numCartao?.c || 0)
          const taxaTotal = (numPix?.t || 0) + (cartaoB * 0.07)

          const tenant  = db.prepare('SELECT nome FROM tenants WHERE id=?').get(tid)
          const saqInfo = db.prepare(`INSERT INTO saques (tenant_id,tenant_nome,valor_solicitado,num_pagamentos,taxa_total,valor_liquido,pix_key,pix_key_tipo)
            VALUES (?,?,?,?,?,?,?,?)`).run(tid, tenant?.nome || tid, saldo, numTotal, taxaTotal, saldo, pix_key, pix_key_tipo)
          const saqNovo = db.prepare('SELECT * FROM saques WHERE id=?').get(saqInfo.lastInsertRowid)
          return { ok: true, saqNovo, saldo, pixLiq, cartaoLiq }
        })()
      } catch(txErr) {
        log('❌', '/api/saques/solicitar transação falhou:', txErr.message)
        send(res, 500, { error: 'Erro ao processar saque' })
        return true
      }

      if (resultado.err) { send(res, 400, { error: resultado.err }); return true }

      sseBroadcast('saques-admin', 'saques:INSERT', resultado.saqNovo)
      sseBroadcast(`saques-rt:${tid}`, 'saques:INSERT', resultado.saqNovo)
      marcarDirty()
      log('💰', `Saque solicitado: R$${resultado.saldo.toFixed(2)} tenant=${tid} (pix=${resultado.pixLiq.toFixed(2)} + cartão=${resultado.cartaoLiq.toFixed(2)})`)
      send(res, 200, { ok: true, valor: resultado.saldo, pix_key })
    } catch (e) { log('❌', '/api/saques/solicitar erro:', e.message); send(res, 500, { error: e.message }) }
    return true
  }

  // ── Lista saques do gestor ───────────────────────────
  if (req.method === 'GET' && upath === '/api/saques/meus') {
    const tid = req.headers['x-tenant-id']
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatório' }); return true }
    if (!requireFinanceAccess(tid)) return true
    try {
      const saques = db.prepare('SELECT * FROM saques WHERE tenant_id=? ORDER BY created_at DESC').all(tid)
      send(res, 200, saques)
    } catch (e) { log('❌', '/api/saques/meus erro:', e.message); send(res, 500, { error: e.message }) }
    return true
  }

  // ── Admin: lista todos os saques ─────────────────────
  if (req.method === 'GET' && upath === '/api/admin/saques') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const status = params.get('status') || 'pendente'
    const saques = db.prepare('SELECT s.*,t.slug FROM saques s LEFT JOIN tenants t ON s.tenant_id=t.id WHERE s.status=? ORDER BY s.created_at ASC').all(status)
    send(res, 200, saques)
    return true
  }

  // ── Admin: atualiza status de um saque ───────────────
  if (req.method === 'PATCH' && upath === '/api/admin/saques/atualizar') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const body = await readBody(req)
    const { id, status, obs_admin } = body
    if (!id || !status) { send(res, 400, { error: 'id e status obrigatórios' }); return true }
    const paid_at = status === 'pago' ? new Date().toISOString() : null
    db.prepare('UPDATE saques SET status=?,obs_admin=?,paid_at=COALESCE(?,paid_at) WHERE id=?').run(status, obs_admin || null, paid_at, id)
    const saqAtual = db.prepare('SELECT * FROM saques WHERE id=?').get(id)
    if (saqAtual) { sseBroadcast(`saques-rt:${saqAtual.tenant_id}`, 'saques:UPDATE', saqAtual); sseBroadcast('saques-admin', 'saques:UPDATE', saqAtual) }
    marcarDirty()
    log('💰', `Saque #${id} → ${status}`)
    send(res, 200, { ok: true })
    return true
  }

  // ── Admin: salvar token MP e taxa ────────────────────
  if (req.method === 'POST' && upath === '/api/admin/mp-config') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const body = await readBody(req)
    const { mp_token, taxa_pix, mp_public_key } = body
    try {
      const cfgMp = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
      const cur   = cfgMp?.ia_config ? JSON.parse(cfgMp.ia_config) : {}
      if (mp_token)      cur.mp_token      = mp_token
      if (mp_public_key) cur.mp_public_key = mp_public_key
      if (taxa_pix !== undefined) cur.taxa_pix = parseFloat(taxa_pix)
      db.prepare("INSERT INTO store_config (tenant_id,ia_config) VALUES ('_global',?) ON CONFLICT(tenant_id) DO UPDATE SET ia_config=excluded.ia_config").run(JSON.stringify(cur))
      marcarDirty()
      send(res, 200, { ok: true })
    } catch (e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Admin: ler config MP ─────────────────────────────
  if (req.method === 'GET' && upath === '/api/admin/mp-config') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    try {
      const row      = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
      const cfg      = row?.ia_config ? JSON.parse(row.ia_config) : {}
      const mp_token = cfg.mp_token ? '••••' + cfg.mp_token.slice(-6) : ''
      const taxa_pix = cfg.taxa_pix !== undefined ? cfg.taxa_pix : TAXA_PIX
      const mp_public_key_mascarado = cfg.mp_public_key ? '••••' + cfg.mp_public_key.slice(-6) : ''
      send(res, 200, { mp_token_mascarado: mp_token, taxa_pix, mp_configurado: !!cfg.mp_token, mp_public_key_mascarado, mp_public_key_configurado: !!cfg.mp_public_key })
    } catch (e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ═══════════════════════════════════════════════════════
  // GESTOR: Configuração de Mercado Pago próprio (por tenant)
  // ═══════════════════════════════════════════════════════
  // Cada tenant pode opcionalmente cadastrar suas próprias credenciais MP.
  // Quando configurado, todos os PIX/cartão de pedidos do tenant caem
  // direto na conta dele — não passa pela carteira interna.
  // SEGURANÇA CRÍTICA: tenant_id vem do header (sessão), nunca do body.
  // Isso impede um tenant escrever na config de outro.
  // ═══════════════════════════════════════════════════════

  // ── Gestor: ler própria config MP ────────────────────
  if (req.method === 'GET' && upath === '/api/gestor/mp-config') {
    const tid = req.headers['x-tenant-id']
    if (!tid || tid === '_global' || tid === '_admin') {
      send(res, 400, { error: 'x-tenant-id obrigatório' })
      return true
    }
    if (!requireFinanceAccess(tid)) return true
    try {
      const row = db.prepare('SELECT ia_config FROM store_config WHERE tenant_id=?').get(tid)
      const ia  = row?.ia_config ? JSON.parse(row.ia_config) : {}
      const tokenMasc = ia.mp_token ? '••••' + ia.mp_token.slice(-6) : ''
      const pkMasc    = ia.mp_public_key ? '••••' + ia.mp_public_key.slice(-6) : ''
      // Saldo pendente que ainda pode sacar (mesmo após ativar MP próprio,
      // se sobrar saldo de antes, queremos avisar pra ele sacar)
      let saldoCarteira = 0
      try {
        const pixLiq  = db.prepare("SELECT COALESCE(SUM(valor_liquido),0) as v FROM pagamentos_pix WHERE tenant_id=? AND status='aprovado'").get(tid)?.v || 0
        const cartaoB = db.prepare("SELECT COALESCE(SUM(valor),0) as v FROM pagamentos_cartao WHERE tenant_id=? AND status='aprovado'").get(tid)?.v || 0
        const totalRec = pixLiq + (cartaoB * 0.93)
        const totalSac = db.prepare("SELECT COALESCE(SUM(valor_liquido),0) as v FROM saques WHERE tenant_id=? AND status IN ('pendente','aprovado','pago')").get(tid)?.v || 0
        saldoCarteira = Math.max(0, totalRec - totalSac)
      } catch {}
      send(res, 200, {
        mp_token_mascarado:        tokenMasc,
        mp_public_key_mascarado:   pkMasc,
        mp_token_configurado:      !!ia.mp_token,
        mp_public_key_configurado: !!ia.mp_public_key,
        usando_global:             !ia.mp_token,
        saldo_carteira_pendente:   saldoCarteira,
      })
    } catch (e) { log('❌', '/api/gestor/mp-config GET erro:', e.message); send(res, 500, { error: e.message }) }
    return true
  }

  // ── Gestor: salvar/limpar própria config MP ──────────
  if (req.method === 'POST' && upath === '/api/gestor/mp-config') {
    const tid = req.headers['x-tenant-id']
    if (!tid || tid === '_global' || tid === '_admin') {
      send(res, 400, { error: 'x-tenant-id obrigatório' })
      return true
    }
    if (!requireFinanceAccess(tid)) return true
    const body = await readBody(req)
    const { mp_token, mp_public_key, limpar } = body
    try {
      // Lê config atual e faz MERGE (preserva outros campos do ia_config —
      // automações WA, configs de PIX manual, etc)
      const row = db.prepare('SELECT ia_config FROM store_config WHERE tenant_id=?').get(tid)
      const ia  = row?.ia_config ? JSON.parse(row.ia_config) : {}

      if (limpar === true) {
        // Ao limpar o MP próprio, NÃO desativa o pix_ativo/cartao_online_ativo —
        // o gestor pode querer continuar recebendo via conta global. Se ele
        // quiser desligar, faz manualmente em "Pagamentos Online".
        delete ia.mp_token
        delete ia.mp_public_key
        log('⚙️', `MP gestor LIMPO tenant=${tid}`)
      } else {
        // Validação básica do formato (token MP começa com APP_USR ou TEST)
        if (mp_token !== undefined) {
          // Sanitização agressiva: remove aspas, espaços, quebras de linha invisíveis,
          // BOM, etc. Causa comum: gestor copia "APP_USR-..." (com aspas) ou
          // colou de um campo que tinha \r\n no final.
          let tk = String(mp_token || '')
            .replace(/^["'\s\u200B-\u200D\uFEFF]+|["'\s\u200B-\u200D\uFEFF]+$/g, '') // trim aspas/espaços/zero-width
            .replace(/[\r\n\t]/g, '') // remove qualquer quebra de linha/tab no meio

          if (tk && !tk.startsWith('•')) {
            // Aceita só se parece com formato válido (defesa simples)
            if (tk.length < 20) {
              send(res, 400, { error: 'Token Mercado Pago parece inválido (muito curto)' })
              return true
            }
            // Detecta erros comuns: alguém colou public key no lugar do token
            if (tk.startsWith('APP_USR-') && tk.length < 60) {
              // Public keys são curtas, access tokens são longos (>70 chars)
              send(res, 400, { error: 'Esse parece ser uma Public Key, não o Access Token. Cole o Access Token aqui (geralmente tem ~75 caracteres).' })
              return true
            }
            // Validação de formato esperado
            if (!tk.startsWith('APP_USR-') && !tk.startsWith('TEST-')) {
              send(res, 400, { error: 'Access Token deve começar com APP_USR- (produção) ou TEST- (sandbox).' })
              return true
            }
            // VALIDAÇÃO REAL: tenta uma chamada simples ao MP pra ver se token funciona.
            // Endpoint /v1/payment_methods é leve e exige autenticação válida.
            try {
              const testR = await fetch('https://api.mercadopago.com/v1/payment_methods', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${tk}` }
              })
              if (testR.status === 401) {
                send(res, 400, { error: 'Token Mercado Pago inválido (não autorizado). Confira se copiou o Access Token completo do painel MP.' })
                return true
              }
              if (!testR.ok) {
                const errData = await testR.json().catch(() => ({}))
                send(res, 400, { error: 'Mercado Pago rejeitou o token: ' + (errData.message || `erro ${testR.status}`) })
                return true
              }
              // Aviso: token de teste não funciona com clientes reais
              if (tk.startsWith('TEST-')) {
                log('⚠️', `MP gestor tenant=${tid} salvou TOKEN DE TESTE — clientes reais não conseguirão pagar`)
              }
            } catch (testErr) {
              // Falha de rede — deixa salvar mas avisa no log
              log('⚠️', `MP gestor tenant=${tid} validação online falhou (rede?):`, testErr.message)
            }
            ia.mp_token = tk
          }
        }
        if (mp_public_key !== undefined) {
          let pk = String(mp_public_key || '')
            .replace(/^["'\s\u200B-\u200D\uFEFF]+|["'\s\u200B-\u200D\uFEFF]+$/g, '')
            .replace(/[\r\n\t]/g, '')
          if (pk && !pk.startsWith('•')) {
            if (pk.length < 20) {
              send(res, 400, { error: 'Public key Mercado Pago parece inválida (muito curta)' })
              return true
            }
            ia.mp_public_key = pk
          }
        }
        // Auto-ativa PIX/cartão quando o gestor salva MP próprio.
        // Faz sentido: ele só configurou MP próprio porque quer receber online.
        // Antes ele tinha que ir em "Pagamentos Online" e ativar manualmente —
        // resultado era PIX não aparecer no cardápio mesmo com MP configurado.
        if (ia.mp_token) {
          ia.pix_ativo = true
          // Cartão só faz sentido se tem public key
          if (ia.mp_public_key) {
            ia.cartao_online_ativo = true
          }
          // Garante que pagamento online geral está ligado
          ia.pag_online_ativo = true
        }
        log('⚙️', `MP gestor SALVO tenant=${tid} token=${ia.mp_token ? 'sim' : 'não'} pk=${ia.mp_public_key ? 'sim' : 'não'} pix_ativo=${ia.pix_ativo}`)
      }

      db.prepare('INSERT INTO store_config (tenant_id,ia_config) VALUES (?,?) ON CONFLICT(tenant_id) DO UPDATE SET ia_config=excluded.ia_config')
        .run(tid, JSON.stringify(ia))
      marcarDirty()

      const tokenMasc = ia.mp_token ? '••••' + ia.mp_token.slice(-6) : ''
      const pkMasc    = ia.mp_public_key ? '••••' + ia.mp_public_key.slice(-6) : ''
      send(res, 200, {
        ok: true,
        mp_token_mascarado:        tokenMasc,
        mp_public_key_mascarado:   pkMasc,
        mp_token_configurado:      !!ia.mp_token,
        mp_public_key_configurado: !!ia.mp_public_key,
        usando_global:             !ia.mp_token,
      })
    } catch (e) { log('❌', '/api/gestor/mp-config POST erro:', e.message); send(res, 500, { error: e.message }) }
    return true
  }

  // ── Admin: toggle PIX por tenant ─────────────────────
  if (req.method === 'POST' && upath === '/api/admin/pix-toggle') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const body = await readBody(req)
    const { tenant_id, pix_ativo } = body
    if (!tenant_id) { send(res, 400, { error: 'tenant_id obrigatório' }); return true }
    try {
      const cfg = db.prepare('SELECT ia_config FROM store_config WHERE tenant_id=?').get(tenant_id)
      const cur = cfg?.ia_config ? JSON.parse(cfg.ia_config) : {}
      cur.pix_ativo = pix_ativo !== false
      db.prepare('INSERT INTO store_config (tenant_id,ia_config) VALUES (?,?) ON CONFLICT(tenant_id) DO UPDATE SET ia_config=excluded.ia_config').run(tenant_id, JSON.stringify(cur))
      marcarDirty()
      send(res, 200, { ok: true, pix_ativo: cur.pix_ativo })
    } catch (e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ═══════════════════════════════════════════════════════
  // WhatsApp, IA & Webhooks
  // ═══════════════════════════════════════════════════════


  // ── Envio manual de mensagem WA ──────────────────────
  if (req.method === 'POST' && upath === '/enviar') {
    const { phone, text, tenant_id } = await readBody(req)
    if (!phone || !text) { send(res, 400, { ok: false, error: 'phone e text obrigatórios' }); return true }
    const tid    = tenant_id || req.headers['x-tenant-id']
    const cfgEnv = tid ? db.prepare('SELECT evo_instance FROM store_config WHERE tenant_id=?').get(tid) : null
    const r      = await sendWA(phone, text, cfgEnv?.evo_instance)
    send(res, r.ok ? 200 : 500, r)
    return true
  }

  // ── Disparo de promoção em massa ─────────────────────
  if (req.method === 'POST' && upath === '/promocao') {
    const body = await readBody(req)
    const { destino = 'todos', msg, tenant_id } = body
    if (!msg) { send(res, 400, { ok: false, error: 'msg obrigatório' }); return true }
    const tid  = tenant_id || req.headers['x-tenant-id']
    const cfgP = tid ? db.prepare('SELECT evo_instance FROM store_config WHERE tenant_id=?').get(tid) : null
    const instP = cfgP?.evo_instance || EVO_INST
    const baseUrl = String(process.env.PUBLIC_BASE_URL || process.env.APP_URL || process.env.BASE_URL || '').replace(/\/+$/,'') || (() => {
      const proto = String(req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0].trim()
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'estimafood.evocrm.sbs').split(',')[0].trim()
      return `${proto || 'https'}://${host || 'estimafood.evocrm.sbs'}`
    })()
    const slugP = tid ? db.prepare('SELECT slug FROM tenants WHERE id=?').get(tid)?.slug : ''
    const linkCardapio = tid
      ? `${baseUrl}/index.html?${slugP ? `slug=${encodeURIComponent(slugP)}` : `tenant=${encodeURIComponent(tid)}`}`
      : `${baseUrl}/index.html`
    let cl = db.prepare('SELECT * FROM fidelidade WHERE phone IS NOT NULL' + (tid ? ' AND tenant_id=?' : '')).all(...(tid ? [tid] : []))
    if (destino === 'com_pedido') cl = cl.filter(c => c.orders_count > 0)
    if (!cl.length) { send(res, 200, { ok: true, enviados: 0 }); return true }
    send(res, 200, { ok: true, total: cl.length, msg: 'Envio iniciado' })
    ;(async () => {
      let ok = 0, fail = 0
      for (const c of cl) {
        const texto = fillVars(msg, { nome: c.name, link: linkCardapio, link_cardapio: linkCardapio, cardapio_link: linkCardapio })
        const r = await sendWA(c.phone, texto, instP)
        r.ok ? ok++ : fail++
        await sleep(1500)
      }
      log('📢', `Promoção: ${ok} ok, ${fail} fail`)
    })()
    return true
  }

  // ── Disparar verificação de aniversariantes ──────────
  if (req.method === 'POST' && upath === '/aniversario') {
    checarAniv()
    send(res, 200, { ok: true })
    return true
  }

  // ── Rastreio via WA (IA responde status do pedido) ───
  if (req.method === 'POST' && upath === '/api/rastreio-wa') {
    const { phone, order_id, tenant_id } = await readBody(req)
    if (!phone || !order_id || !tenant_id) { send(res, 400, { ok: false }); return true }
    const cfg         = db.prepare('SELECT evo_instance,store_name,ia_config,order_num_offset FROM store_config WHERE tenant_id=?').get(tenant_id)
    const inst        = cfg?.evo_instance || EVO_INST
    const ia          = cfg?.ia_config ? JSON.parse(cfg.ia_config) : {}
    if (!ia.ativo && !ia.resp_rastreio_manual) { send(res, 200, { ok: false, msg: 'IA inativa' }); return true }
    const phoneWhere  = phoneLookupSql('phone')
    const pedido      = db.prepare(`SELECT id,order_num,client,status,items,total,taxa,addr,pag,troco,created_at FROM orders WHERE id=? AND tenant_id=? AND ${phoneWhere}`).get(order_id, tenant_id, ...phoneLookupArgs(phone))
    if (!pedido) { send(res, 400, { ok: false }); return true }
    const offset      = parseInt(cfg?.order_num_offset || 0) || 0
    const statusPix   = String(pedido.status || '').toLowerCase()
    const pagPix      = String(pedido.pag || '').toLowerCase()
    const pendenteOnline = statusPix === 'aguardando_cartao' || (statusPix === 'aguardando_pix' && pagPix !== 'pix_manual')
    const numPedido   = pedido.order_num
      ? String(pedido.order_num).padStart(3, '0')
      : (pendenteOnline ? '' : _numeroPedidoPad(pedido, offset))
    try { db.prepare("UPDATE orders SET wa_track=1 WHERE id=? AND tenant_id=? AND COALESCE(wa_track,0)=0").run(pedido.id, tenant_id) } catch {}
    const msg         = buildOrderTrackingMessage({
      order: pedido,
      storeName: cfg?.store_name || 'Restaurante',
      orderNumber: numPedido,
      includeTrackingNote: true
    })
    const r           = await sendWA(phone, msg, inst)
    send(res, r.ok ? 200 : 500, r)
    return true
  }

  // ── Humano assumiu conversa (pausa IA) ───────────────
  if (req.method === 'POST' && upath === '/api/ia-humano-assumiu') {
    const body = await readBody(req)
    const { phone, tenant_id } = body
    log('👤', '[PAUSA-DEBUG] Body recebido:', JSON.stringify(body))
    log('👤', '[PAUSA-DEBUG] phone extraído:', phone, '| tenant_id extraído:', tenant_id)
    log('👤', '[PAUSA-DEBUG] x-tenant-id header:', req.headers['x-tenant-id'])
    if (phone && tenant_id) {
      const pausaKey = `pausa:${tenant_id}:${phone}`
      _pausaHumano.set(pausaKey, Date.now())
      log('👤', `[PAUSA-DEBUG] Chave gravada no _pausaHumano: "${pausaKey}"`)
      log('👤', `[PAUSA-DEBUG] Total de chaves no _pausaHumano: ${_pausaHumano.size}`)
      log('👤', `Humano assumiu conversa com ${phone}`)
    } else {
      log('⚠️', '[PAUSA-DEBUG] FALHOU — phone ou tenant_id ausente no body:', { phone, tenant_id })
    }
    send(res, 200, { ok: true })
    return true
  }

  // ── Proxy Evolution API (/api/evo/*) ─────────────────
  if (upath.startsWith('/api/evo')) {
    const tenantId = req.headers['x-tenant-id']
    if (!tenantId) { send(res, 401, { error: 'x-tenant-id obrigatório' }); return true }
    const cfg      = db.prepare('SELECT evo_instance FROM store_config WHERE tenant_id=?').get(tenantId)
    const instance = cfg?.evo_instance || null
    const body     = ['POST', 'DELETE'].includes(req.method) ? await readBody(req) : {}
    const action   = upath.replace('/api/evo', '')
    if (req.method === 'POST' && body.instanceName === undefined && instance && action.startsWith('/instance/')) body.instanceName = instance
    const evoPath  = action.replace(':instance', instance || '')
    try {
      const r    = await fetch(`${EVO_URL}${evoPath}`, { method: req.method, headers: { 'Content-Type': 'application/json', apikey: EVO_KEY }, body: req.method !== 'GET' ? JSON.stringify(body) : undefined })
      const data = await r.json().catch(() => ({}))
      if (evoPath.startsWith('/instance/create') && r.ok && body.instanceName) db.prepare('UPDATE store_config SET evo_instance=? WHERE tenant_id=?').run(body.instanceName, tenantId)
      send(res, r.status, data)
    } catch (e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Webhook do chatbot de cobrança (instância admin) ──
  // Registrado automaticamente ao criar/conectar a instância em Admin → Saques PIX.
  // Fica separado do webhook multi-tenant (linha abaixo) porque a instância de
  // cobrança não pertence a nenhum tenant — é do super admin.
  if (req.method === 'POST' && upath === '/webhook/cobranca-admin') {
    const body = await readBody(req)
    try { await _handleCobrancaBot(ctx, body) } catch (e) { log('⚠️', 'Bot cobrança erro:', e.message) }
    send(res, 200, { ok: true })
    return true
  }

  // ── Webhook WhatsApp / IA ────────────────────────────
  if (req.method === 'POST' && (upath.startsWith('/webhook/whatsapp') || upath.startsWith('/webhook/'))) {
    const body  = await readBody(req)
    const event = body?.event || ''

    // Resolve tenant a partir da URL
    const tid_wh = (() => {
      if (upath.startsWith('/webhook/whatsapp')) return upath.split('/')[3] || null
      const slug = upath.split('/')[2] || null
      if (!slug) return null
      const row = db.prepare('SELECT id FROM tenants WHERE slug=? OR id=?').get(slug, slug)
      return row?.id || null
    })()

    // Broadcast SSE + salva no banco — mensagens recebidas E enviadas
    if (tid_wh && (event === 'messages.upsert' || event === 'message.upsert')) {
      const msgs = Array.isArray(body?.data?.messages)
        ? body.data.messages
        : (body?.data ? [body.data] : [])

      const stmt = db.prepare(
        'INSERT OR IGNORE INTO wa_messages (tenant_id, remote_jid, msg_id, payload, from_me, ts) VALUES (?,?,?,?,?,?)'
      )

      for (const m of msgs) {
        const fromMe = m?.key?.fromMe === true || m?.key?.fromMe === 'true'
        const jid    = m?.key?.remoteJid || ''
        const mid    = m?.key?.id || ''
        const ts     = +m?.messageTimestamp || 0

        // Só ignora status e LIDs — qualquer outra mensagem é válida
        if (!jid || !mid || jid.startsWith('status@') || jid.endsWith('@lid')) continue

        // Salva no banco (recebidas e enviadas)
        try {
          stmt.run(tid_wh, jid, mid, JSON.stringify(m), fromMe ? 1 : 0, ts)
          marcarDirty()
        } catch(e) { /* UNIQUE — já existe */ }

        // Se gestor enviou mensagem pelo próprio WhatsApp → pausa a IA para este contato
        if (fromMe && tid_wh) {
          const phone = jid.replace('@s.whatsapp.net','').replace('@c.us','')
          if (phone) {
            const pausaKey = `pausa:${tid_wh}:${phone}`
            _pausaHumano.set(pausaKey, Date.now())
            log('👤', `[PAUSA] Gestor enviou via WA (webhook) — IA pausada para ${phone} [${tid_wh}]`)
          }
        }

        // SSE para mensagens RECEBIDAS (fromMe=false)
        if (!fromMe) {
          sseBroadcast(`wa-msgs:${tid_wh}`, 'wa:msg', m)
        }
      }

      // Limpa msgs com mais de 7 dias
      try {
        const cutoff = Math.floor(Date.now()/1000) - 7*24*3600
        db.prepare('DELETE FROM wa_messages WHERE tenant_id=? AND ts < ? AND ts > 0').run(tid_wh, cutoff)
      } catch(e) {}
    }

    // Processa IA (re-usa body já lido)
    const fakeReq = Object.assign(Object.create(req), { _parsedBody: body })
    await handleIAWebhook(fakeReq, res)
    return true
  }

  // ── Cache de mensagens WhatsApp — GET (carrega conversa) ──
  if (req.method === 'GET' && upath === '/api/wa/messages') {
    const tenantId = req.headers['x-tenant-id']
    const jid      = params.get('jid')
    if (!tenantId || !jid) { send(res, 400, { error: 'tenant e jid obrigatórios' }); return true }
    try {
      const rows = db.prepare(
        'SELECT payload FROM wa_messages WHERE tenant_id=? AND remote_jid=? ORDER BY ts ASC LIMIT 200'
      ).all(tenantId, jid)
      const msgs = rows.map(r => { try { return JSON.parse(r.payload) } catch { return null } }).filter(Boolean)
      send(res, 200, msgs)
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Cache de mensagens WhatsApp — POST (salva batch) ───
  if (req.method === 'POST' && upath === '/api/wa/messages') {
    const tenantId = req.headers['x-tenant-id']
    if (!tenantId) { send(res, 401, { error: 'x-tenant-id obrigatório' }); return true }
    const body = await readBody(req)
    const msgs = Array.isArray(body) ? body : (body?.messages || [])
    if (!msgs.length) { send(res, 200, { saved: 0 }); return true }
    try {
      const stmt = db.prepare(
        'INSERT OR IGNORE INTO wa_messages (tenant_id, remote_jid, msg_id, payload, from_me, ts) VALUES (?,?,?,?,?,?)'
      )
      const insert = db.transaction(list => {
        let n = 0
        for (const m of list) {
          const jid   = m.key?.remoteJid
          const mid   = m.key?.id
          const fromMe = (m.key?.fromMe === true || m.key?.fromMe === 'true') ? 1 : 0
          const ts    = +m.messageTimestamp || 0
          if (!jid || !mid) continue
          try { stmt.run(tenantId, jid, mid, JSON.stringify(m), fromMe, ts); n++ } catch {}
        }
        return n
      })
      const saved = insert(msgs)
      // Limpa mensagens com mais de 7 dias para não crescer indefinidamente
      const cutoff = Math.floor(Date.now()/1000) - 7*24*3600
      db.prepare('DELETE FROM wa_messages WHERE tenant_id=? AND ts < ? AND ts > 0').run(tenantId, cutoff)
      marcarDirty()
      send(res, 200, { saved })
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }


  if (req.method === 'GET' && upath === '/api/wa/avatar') {
    const rawUrl = params.get('url')
    if (!rawUrl) { res.writeHead(204); res.end(); return true }
    try {
      const decoded = decodeURIComponent(rawUrl)
      const r = await fetch(decoded, {
        headers: { 'User-Agent': 'WhatsApp/2.2413.51 A' },
        signal:  AbortSignal.timeout(5000)
      })
      if (!r.ok) { res.writeHead(404); res.end(); return true }
      const buf = Buffer.from(await r.arrayBuffer())
      const ct  = r.headers.get('content-type') || 'image/jpeg'
      res.writeHead(200, {
        'Content-Type':  ct,
        'Cache-Control': 'public, max-age=7200',
        'Access-Control-Allow-Origin': '*'
      })
      res.end(buf)
    } catch { res.writeHead(502); res.end() }
    return true
  }

  // ── Download de mídia WhatsApp (sob demanda) ─────────
  if (req.method === 'POST' && upath === '/api/wa/media') {
    const tenantId = req.headers['x-tenant-id']
    if (!tenantId) { send(res, 401, { error: 'x-tenant-id obrigatório' }); return true }
    const body = await readBody(req)
    const { messageId, remoteJid } = body
    if (!messageId || !remoteJid) { send(res, 400, { error: 'messageId e remoteJid obrigatórios' }); return true }
    try {
      const cfg  = db.prepare('SELECT evo_instance FROM store_config WHERE tenant_id=?').get(tenantId)
      const inst = cfg?.evo_instance || EVO_INST
      if (!inst) { send(res, 400, { error: 'Instância não configurada' }); return true }

      // EVO 2.7: POST /chat/getBase64FromMediaMessage/{instance}
      const r = await fetch(`${EVO_URL}/chat/getBase64FromMediaMessage/${inst}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', apikey: EVO_KEY },
        body:    JSON.stringify({
          message:    { key: { id: messageId, remoteJid } },
          convertTo:  'base64',
          convertToMp4: false
        }),
        signal: AbortSignal.timeout(30000)
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) { send(res, r.status, { error: data?.message || 'Erro ao baixar mídia' }); return true }
      send(res, 200, {
        base64:   data.base64   || data.data   || null,
        mimetype: data.mimetype || data.mimeType || 'application/octet-stream',
        fileName: data.fileName || null
      })
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }


  // ── Clientes do gestor com stats calculados em tempo real ──
  if (req.method === 'GET' && upath === '/api/clientes-gestor') {
    const tid = req.headers['x-tenant-id']
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatório' }); return true }
    try {
      // Customers com stats calculados via JOIN com orders
      const customers = db.prepare(`
        SELECT
          c.id, c.name, c.phone, c.email, c.birthday, c.addr,
          c.created_at,
          COUNT(o.id)                       AS orders_count,
          COALESCE(SUM(o.total + o.taxa), 0) AS total_spent,
          MAX(o.created_at)                  AS last_order_at
        FROM customers c
        LEFT JOIN orders o ON o.tenant_id = c.tenant_id
          AND (o.customer_id = c.id OR o.phone = c.phone)
          AND o.status NOT IN ('cancelado', 'aguardando_pix')
        WHERE c.tenant_id = ?
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `).all(tid)

      // Fidelidade por telefone (para pontos)
      const fid = db.prepare(
        'SELECT id, phone, pts, resgates FROM fidelidade WHERE tenant_id = ?'
      ).all(tid)
      const fidMap = {}
      fid.forEach(f => {
        const ph = (f.phone || '').replace(/\D/g, '').slice(-8)
        if (ph) fidMap[ph] = f
      })

      const result = customers.map(c => {
        const ph = (c.phone || '').replace(/\D/g, '').slice(-8)
        const f  = fidMap[ph] || null
        return {
          ...c,
          orders_count: c.orders_count || 0,
          total_spent:  parseFloat(c.total_spent || 0),
          last_order_at: c.last_order_at || null,
          fid_pts:  f ? (f.pts || 0) : null,
          fid_id:   f ? f.id : null
        }
      })

      send(res, 200, result)
    } catch (e) {
      log('❌', '/api/clientes-gestor erro:', e.message)
      send(res, 500, { error: e.message })
    }
    return true
  }

  // ══════════════════════════════════════════════════════
  // CARTÃO DE CRÉDITO — Mercado Pago
  // ══════════════════════════════════════════════════════

  // ── Retorna public_key para o frontend inicializar o SDK ──
  if (req.method === 'GET' && upath === '/api/cartao/public-key') {
    try {
      // Resolve a public key da conta MP que vai processar este pagamento
      // (tenant primeiro, depois global). Se não tem header tenant_id (cardápio
      // público), usa o tenant_id da query string.
      const tid = req.headers['x-tenant-id'] || params.get('tenant_id') || ''
      const _cfg = _resolveMpForTenant(db, tid, MP_TOKEN)
      const pk = _cfg.mp_public_key || ''
      if (!pk) { send(res, 200, { ok: false, public_key: '', cartao_ativo: false }); return true }
      send(res, 200, { ok: true, public_key: pk, cartao_ativo: true })
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Cria pagamento de cartão com card_token do SDK MP ──
  if (req.method === 'POST' && upath === '/api/cartao/criar') {
    const tid = req.headers['x-tenant-id']
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatório' }); return true }
    const body = await readBody(req)
    const { card_token, payment_method_id, valor, order_id, client, email = 'cliente@email.com', issuer_id, identification_type, identification_number } = body
    if (!card_token)         { send(res, 400, { error: 'card_token obrigatório' }); return true }
    if (!payment_method_id)  { send(res, 400, { error: 'payment_method_id obrigatório' }); return true }
    const _valorMpC = _mpValor(valor)
    if (_valorMpC === null) { send(res, 400, { error: 'Valor inválido' }); return true }

    // Resolve conta MP: tenant primeiro, depois global
    const _mpCfgC = _resolveMpForTenant(db, tid, MP_TOKEN)
    const mpToken = _mpCfgC.mp_token
    if (!mpToken) { send(res, 400, { error: 'Token Mercado Pago não configurado' }); return true }

    const extRef = `ef-card-${tid.slice(0,8)}-${order_id || Date.now()}`
    // Mesma correção do PIX: garante que o MP avise o webhook mesmo quando
    // o pagamento é processado pela conta própria do restaurante.
    const _mpBaseUrlC = String(process.env.PUBLIC_BASE_URL || process.env.APP_URL || process.env.BASE_URL || '').replace(/\/+$/, '') || (() => {
      const proto = String(req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0].trim()
      const host  = String(req.headers['x-forwarded-host'] || req.headers.host || 'estimafood.evocrm.sbs').split(',')[0].trim()
      return `${proto || 'https'}://${host || 'estimafood.evocrm.sbs'}`
    })()

    try {
      const mpBody = {
        transaction_amount: _valorMpC,
        token:              card_token,
        description:        `Pedido online - ${client || 'Cliente'}`,
        installments:       1,
        payment_method_id,
        external_reference: extRef,
        notification_url:   `${_mpBaseUrlC}/webhook/mercadopago`,
        payer: { email, first_name: client || 'Cliente', last_name: '' },
      }
      // CPF do titular é exigido pelo antifraude do MP — sem isso o pagamento
      // é recusado quase sempre, mesmo com dados de cartão corretos.
      const _cpfLimpoC = String(identification_number || '').replace(/\D/g, '')
      if (_cpfLimpoC) {
        mpBody.payer.identification = { type: identification_type || 'CPF', number: _cpfLimpoC }
      }
      if (issuer_id) mpBody.issuer_id = issuer_id

      const mp = await fetch('https://api.mercadopago.com/v1/payments', {
        method:  'POST',
        headers: {
          'Content-Type':    'application/json',
          'Authorization':   `Bearer ${mpToken}`,
          'X-Idempotency-Key': extRef
        },
        body: JSON.stringify(mpBody)
      })
      const mpData = await mp.json()

      if (!mp.ok) {
        log('❌', 'MP Cartão erro:', mpData)
        send(res, 400, { error: mpData.message || 'Erro ao processar cartão', cause: mpData.cause || [] })
        return true
      }

      const statusMap = { approved: 'aprovado', rejected: 'rejeitado', cancelled: 'cancelado', in_process: 'em_processo', pending: 'pendente' }
      const novoStatus = statusMap[mpData.status] || 'pendente'
      const lastFour   = mpData.card?.last_four_digits || ''

      // CRÍTICO: Quando MP é do tenant, dinheiro vai direto pra conta dele —
      // gravamos valor=0 para que a carteira (que faz cartaoB*0.93) ignore.
      // Mantemos o registro para auditoria/rastreio do pedido.
      // mp_source é fixado para webhooks/polls futuros usarem a conta certa.
      const isMpProprioC = (_mpCfgC.source === 'tenant')
      db.prepare(`INSERT OR IGNORE INTO pagamentos_cartao
        (tenant_id, order_id, mp_payment_id, mp_external_ref, valor, status, status_detail, payer_name, payer_email, last_four_digits, payment_method_id, mp_source)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(tid, order_id || null, String(mpData.id), extRef,
          isMpProprioC ? 0 : parseFloat(valor),
          novoStatus, mpData.status_detail || '',
          (isMpProprioC ? 'MP_PROPRIO' : (client || '')),
          email, lastFour, payment_method_id,
          isMpProprioC ? 'tenant' : 'global')

      // Se aprovado, atualiza o pedido para 'analise'
      if (novoStatus === 'aprovado' && order_id) {
        db.prepare("UPDATE orders SET status='analise', pag='cartao_mp' WHERE id=? AND tenant_id=? AND status='aguardando_cartao'").run(order_id, tid)
        _atribuirOrderNumSeNecessario(db, tid, order_id)
        marcarDirty()
        const ord = db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(order_id, tid)
        if (ord) {
          const its = (() => { try { return JSON.parse(ord.items) } catch { return [] } })()
          sseBroadcast(`orders-rt:${tid}`, 'orders:UPDATE', { ...ord, items: its, status: 'analise', pag: 'cartao_mp' })
        }
      }

      log('💳', `Cartão ${novoStatus}: R$${valor} tenant=${tid} mp_id=${mpData.id} detail=${mpData.status_detail}`)
      send(res, 200, {
        ok:             novoStatus === 'aprovado',
        mp_payment_id:  mpData.id,
        status:         novoStatus,
        status_detail:  mpData.status_detail || '',
        last_four:      lastFour,
        payment_method: payment_method_id,
      })
    } catch(e) {
      log('❌', 'Cartão fetch erro:', e.message)
      send(res, 500, { error: 'Erro ao processar pagamento: ' + e.message })
    }
    return true
  }

  // ── Consulta status de pagamento de cartão ──
  if (req.method === 'GET' && upath === '/api/cartao/status') {
    const mpId = params.get('mp_payment_id') || ''
    if (!mpId) { send(res, 400, { error: 'mp_payment_id obrigatório' }); return true }
    const tid3 = req.headers['x-tenant-id'] || ''
    if (tid3) {
      const own3 = db.prepare('SELECT tenant_id FROM pagamentos_cartao WHERE mp_payment_id=?').get(String(mpId))
      if (own3 && own3.tenant_id !== tid3) { send(res, 403, { error: 'Acesso negado' }); return true }
    }
    // Resolve token usando o mp_source GRAVADO no pagamento de cartão
    let mpToken = MP_TOKEN
    const _cfgC = _resolveMpForExistingPayment(db, mpId, MP_TOKEN)
    if (_cfgC.mp_token) mpToken = _cfgC.mp_token
    if (!mpToken) { send(res, 400, { error: 'Token MP não configurado' }); return true }
    try {
      const r  = await fetch(`https://api.mercadopago.com/v1/payments/${mpId}`, { headers: { 'Authorization': `Bearer ${mpToken}` } })
      const pd = await r.json()
      const statusMap = { approved: 'aprovado', rejected: 'rejeitado', cancelled: 'cancelado', in_process: 'em_processo', pending: 'pendente' }
      const novoStatus = statusMap[pd.status] || 'pendente'
      // Lê status anterior antes de atualizar (para detectar transição para 'aprovado')
      const rowBefore = db.prepare('SELECT status, tenant_id, order_id FROM pagamentos_cartao WHERE mp_payment_id=?').get(String(mpId))
      // Atualiza banco
      db.prepare('UPDATE pagamentos_cartao SET status=?, status_detail=?, paid_at=? WHERE mp_payment_id=?')
        .run(novoStatus, pd.status_detail || '', pd.date_approved || null, String(mpId))
      // Se acabou de aprovar (transição pendente/in_process → aprovado), sincroniza pedido e notifica
      if (rowBefore && rowBefore.status !== 'aprovado' && novoStatus === 'aprovado' && rowBefore.order_id) {
        const pedAtual = db.prepare("SELECT status, pag FROM orders WHERE id=? AND tenant_id=?").get(rowBefore.order_id, rowBefore.tenant_id)
        const eraAguardando = pedAtual?.status === 'aguardando_cartao'
        const podeRessurreicao = pedAtual?.status === 'cancelado'
          && pedAtual?.pag !== 'pix_mp' && pedAtual?.pag !== 'cartao_mp'
        if (eraAguardando || podeRessurreicao) {
          db.prepare("UPDATE orders SET status='analise', pag='cartao_mp' WHERE id=? AND tenant_id=?").run(rowBefore.order_id, rowBefore.tenant_id)
          _atribuirOrderNumSeNecessario(db, rowBefore.tenant_id, rowBefore.order_id)
          if (podeRessurreicao) log('🔄', `PEDIDO RESSUSCITADO (cartão poll): id=${rowBefore.order_id} tenant=${rowBefore.tenant_id}`)
        } else if (pedAtual) {
          db.prepare("UPDATE orders SET pag='cartao_mp' WHERE id=? AND tenant_id=?").run(rowBefore.order_id, rowBefore.tenant_id)
          _atribuirOrderNumSeNecessario(db, rowBefore.tenant_id, rowBefore.order_id)
        }
        marcarDirty()
        const _ns = (eraAguardando || podeRessurreicao) ? 'analise' : pedAtual?.status
        const _fo = db.prepare("SELECT * FROM orders WHERE id=? AND tenant_id=?").get(rowBefore.order_id, rowBefore.tenant_id)
        const _it = _fo && typeof _fo.items === 'string' ? (() => { try { return JSON.parse(_fo.items) } catch { return [] } })() : (_fo?.items || [])
        sseBroadcast(`orders-rt:${rowBefore.tenant_id}`, 'orders:UPDATE', _fo ? { ..._fo, items: _it, status: _ns, pag: 'cartao_mp' } : { id: rowBefore.order_id, status: _ns, pag: 'cartao_mp' })
        // Notifica cliente
        if ((eraAguardando || podeRessurreicao) && _fo?.phone && parseInt(_fo.wa_track || 0) === 1) {
          setImmediate(async () => {
            try {
              const cfg    = db.prepare('SELECT evo_instance, order_num_offset, store_name FROM store_config WHERE tenant_id=?').get(rowBefore.tenant_id)
              const inst   = cfg?.evo_instance || EVO_INST
              const loja   = cfg?.store_name || 'Restaurante'
              const offset = parseInt(cfg?.order_num_offset) || 0
              const idStr  = _numeroPedidoPad(_fo, offset)
              const nome   = (_fo.client || 'Cliente').split(' ')[0]
              const total  = (parseFloat(_fo.total||0)+parseFloat(_fo.taxa||0)).toFixed(2).replace('.',',')
              const msg    = `🏪 *${loja}*\n${'─'.repeat(20)}\n\n✅ *Pagamento confirmado*\n\nOlá, *${nome}*! Recebemos o pagamento no cartão do pedido *#${idStr}*.\n\n*Total:* R$ ${total}\n\nSeu pedido já entrou em preparo.`
              await sendWA(_fo.phone, msg, inst)
            } catch(e) { log('❌','Erro notif cartão (poll):', e.message) }
          })
        }
      }
      send(res, 200, { status: novoStatus, status_detail: pd.status_detail || '', mp_status: pd.status })
    } catch(e) {
      const fb = db.prepare('SELECT status,status_detail FROM pagamentos_cartao WHERE mp_payment_id=?').get(String(mpId))
      send(res, 200, { status: fb?.status || 'pendente', status_detail: fb?.status_detail || '' })
    }
    return true
  }

  // ═══════════════════════════════════════════════════════
  // Planos & Renovacao
  // ═══════════════════════════════════════════════════════

  // ── Precos dos planos (publico) ──────────────────────
  if (req.method === 'GET' && upath === '/api/planos/precos') {
    try {
      const cfg = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
      const ia = cfg?.ia_config ? JSON.parse(cfg.ia_config) : {}
      send(res, 200, {
        essencial: ia.preco_essencial !== undefined ? parseFloat(ia.preco_essencial) : 79.99,
        premium: ia.preco_premium !== undefined ? parseFloat(ia.preco_premium) : 99.90,
        addon_voz: ia.preco_addon_voz !== undefined ? parseFloat(ia.preco_addon_voz) : 89.90,
        whatsapp_robo: ia.whatsapp_robo || ''
      })
    } catch(e) { send(res, 200, { essencial: 79.99, premium: 99.90, addon_voz: 89.90, whatsapp_robo: '' }) }
    return true
  }

  // ── Admin: Salvar precos dos planos ──────────────────
  if (req.method === 'POST' && upath === '/api/admin/planos/precos') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Nao autorizado' }); return true }
    const body = await readBody(req)
    const { preco_essencial, preco_premium, preco_addon_voz, whatsapp_robo } = body
    try {
      const cfg = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
      const ia = cfg?.ia_config ? JSON.parse(cfg.ia_config) : {}
      if (preco_essencial !== undefined) ia.preco_essencial = parseFloat(preco_essencial)
      if (preco_premium !== undefined) ia.preco_premium = parseFloat(preco_premium)
      if (preco_addon_voz !== undefined) ia.preco_addon_voz = parseFloat(preco_addon_voz)
      if (whatsapp_robo !== undefined) ia.whatsapp_robo = String(whatsapp_robo).replace(/\D/g, '').slice(0, 15)
      db.prepare("INSERT INTO store_config (tenant_id,ia_config) VALUES ('_global',?) ON CONFLICT(tenant_id) DO UPDATE SET ia_config=excluded.ia_config").run(JSON.stringify(ia))
      marcarDirty()
      log('⚙️', `Precos planos atualizados: Essencial=R$${ia.preco_essencial} Premium=R$${ia.preco_premium} AddonVoz=R$${ia.preco_addon_voz}`)
      send(res, 200, { ok: true, preco_essencial: ia.preco_essencial, preco_premium: ia.preco_premium, preco_addon_voz: ia.preco_addon_voz, whatsapp_robo: ia.whatsapp_robo })
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Pagar plano via PIX ──────────────────────────────
  if (req.method === 'POST' && upath === '/api/planos/pagar-pix') {
    const tid = req.headers['x-tenant-id']
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    const body = await readBody(req)
    const { plano, valor } = body
    if (!plano) { send(res, 400, { error: 'Plano obrigatorio' }); return true }
    const _valorMpP = _mpValor(valor)
    if (_valorMpP === null) { send(res, 400, { error: 'Valor inválido' }); return true }

    // Token MP — SEMPRE GLOBAL (mensalidade da plataforma cobrada do tenant)
    const mpToken = _resolveMpGlobal(db, MP_TOKEN)
    if (!mpToken) { send(res, 400, { error: 'Token Mercado Pago nao configurado.' }); return true }

    const tenant = db.prepare('SELECT nome FROM tenants WHERE id=?').get(tid)
    const extRef = `plano-${tid.slice(0,8)}-${plano}-${Date.now()}`

    try {
      const mp = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${mpToken}`, 'X-Idempotency-Key': extRef },
        body: JSON.stringify({
          transaction_amount: _valorMpP,
          description: `Renovacao Plano ${_planoSaasLabel(plano)} - ${tenant?.nome || 'Cliente'}`,
          payment_method_id: 'pix',
          external_reference: extRef,
          payer: { email: 'renovacao@estimafood.com', first_name: tenant?.nome || 'Cliente', last_name: '' },
        })
      })
      const mpData = await mp.json()
      if (!mp.ok) { log('❌', 'MP PIX plano erro:', mpData); send(res, 400, { error: mpData.message || 'Erro MP' }); return true }

      const qr    = mpData.point_of_interaction?.transaction_data?.qr_code || ''
      const qrB64 = mpData.point_of_interaction?.transaction_data?.qr_code_base64 || ''

      // Salva na tabela de pagamentos de plano apenas se o tenant existir (leads da landing usam ID temporario)
      const tenantExiste = db.prepare('SELECT id FROM tenants WHERE id=?').get(tid)
      if (tenantExiste) {
        try {
          db.prepare(`INSERT INTO pagamentos_pix (tenant_id,mp_payment_id,mp_external_ref,valor,taxa,valor_liquido,status,payer_name,qr_code,qr_code_base64)
            VALUES (?,?,?,?,0,?,?,?,?,?)`)
            .run(tid, String(mpData.id), extRef, parseFloat(valor), parseFloat(valor),
              (mpData.status==='approved'?'aprovado':'pendente'), `PLANO:${plano}`, qr, qrB64)
        } catch (dbErr) { log('⚠️', `PIX plano: nao foi possivel salvar no BD tenant=${tid}:`, dbErr.message) }
      } else {
        log('ℹ️', `PIX plano criado para lead externo (sem tenant): mp_id=${mpData.id} plano=${plano}`)
      }

      log('💳', `PIX plano criado: R$${valor} plano=${plano} tenant=${tid} mp_id=${mpData.id}`)
      send(res, 200, { ok: true, mp_payment_id: mpData.id, qr_code: qr, qr_code_base64: qrB64, valor, status: mpData.status })
    } catch (e) { log('❌', 'MP plano fetch erro:', { error: e.message }); send(res, 500, { error: 'Erro ao criar PIX: ' + e.message }) }
    return true
  }

  // ── Status PIX plano ─────────────────────────────────
  if (req.method === 'GET' && upath === '/api/planos/status-pix') {
    const mpId = params.get('mp_payment_id') || ''
    if (!mpId) { send(res, 400, { error: 'mp_payment_id obrigatorio' }); return true }
    // Token MP — SEMPRE GLOBAL (consulta de mensalidade SaaS)
    const mpToken = _resolveMpGlobal(db, MP_TOKEN)
    if (!mpToken) { send(res, 400, { error: 'Token MP nao configurado' }); return true }
    try {
      const r = await fetch('https://api.mercadopago.com/v1/payments/' + mpId, { headers: { 'Authorization': 'Bearer ' + mpToken } })
      const pd = await r.json()
      if (!r.ok) { const fb = db.prepare('SELECT status FROM pagamentos_pix WHERE mp_payment_id=?').get(String(mpId)); send(res, 200, { status: fb ? fb.status : 'pendente' }); return true }
      const novoStatus = pd.status === 'approved' ? 'aprovado' : pd.status === 'rejected' ? 'rejeitado' : pd.status === 'cancelled' ? 'cancelado' : 'pendente'
      const rowAtual = db.prepare('SELECT status,valor,tenant_id,payer_name FROM pagamentos_pix WHERE mp_payment_id=?').get(String(mpId))
      if (rowAtual && rowAtual.status !== novoStatus) {
        db.prepare('UPDATE pagamentos_pix SET status=?,paid_at=? WHERE mp_payment_id=?').run(novoStatus, pd.date_approved || null, String(mpId))
        if (novoStatus === 'aprovado' && rowAtual.payer_name?.startsWith('PLANO:')) {
          // Renovar o plano do tenant
          const plano = rowAtual.payer_name.replace('PLANO:', '')
          const novaExpISO = _dateOnlyISO(_addCalendarMonths(new Date(), 1))
          db.prepare('UPDATE tenants SET plano=?, expires_at=?, ativo=1 WHERE id=?').run(plano, novaExpISO, rowAtual.tenant_id)
          marcarDirty()
          log('✅', `PLANO RENOVADO: ${plano} tenant=${rowAtual.tenant_id} expira=${novaExpISO}`)
        }
      }
      send(res, 200, { status: novoStatus, mp_status: pd.status })
    } catch (e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Pagar plano via Cartao (usando card_token do SDK MP) ──
  if (req.method === 'POST' && upath === '/api/planos/pagar-cartao') {
    const tid = req.headers['x-tenant-id']
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    const body = await readBody(req)
    const { plano, valor, card_token, payment_method_id, payer_email, payer_cpf } = body
    if (!plano) { send(res, 400, { error: 'Plano obrigatorio' }); return true }
    const _valorMpPC = _mpValor(valor)
    if (_valorMpPC === null) { send(res, 400, { error: 'Valor inválido' }); return true }
    if (!card_token) { send(res, 400, { error: 'card_token obrigatorio' }); return true }
    if (!payment_method_id) { send(res, 400, { error: 'payment_method_id obrigatorio' }); return true }

    // Token MP — SEMPRE GLOBAL (mensalidade SaaS via cartão)
    const mpToken = _resolveMpGlobal(db, MP_TOKEN)
    if (!mpToken) { send(res, 400, { error: 'Token Mercado Pago nao configurado.' }); return true }

    const tenant = db.prepare('SELECT nome FROM tenants WHERE id=?').get(tid)
    const extRef = `plano-cartao-${tid.slice(0,8)}-${plano}-${Date.now()}`

    try {
      const mp = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${mpToken}`, 'X-Idempotency-Key': extRef },
        body: JSON.stringify({
          transaction_amount: _valorMpPC,
          token: card_token,
          description: `Renovacao Plano ${_planoSaasLabel(plano)} - ${tenant?.nome || 'Cliente'}`,
          installments: 1,
          payment_method_id,
          external_reference: extRef,
          payer: {
            email: payer_email || 'renovacao@estimafood.com',
            identification: { type: 'CPF', number: (payer_cpf || '').replace(/\D/g,'') }
          }
        })
      })
      const mpData = await mp.json()
      if (!mp.ok) {
        log('❌', 'MP Cartao plano erro:', mpData)
        send(res, 400, { error: mpData.message || mpData.cause?.[0]?.description || 'Erro no pagamento' })
        return true
      }

      const novoStatus = mpData.status === 'approved' ? 'aprovado' : mpData.status === 'rejected' ? 'rejeitado' : 'pendente'

      // Salva pagamento
      db.prepare(`INSERT INTO pagamentos_cartao (tenant_id,mp_payment_id,mp_external_ref,valor,status,status_detail,payer_name,payment_method_id)
        VALUES (?,?,?,?,?,?,?,?)`)
        .run(tid, String(mpData.id), extRef, parseFloat(valor), novoStatus, mpData.status_detail || '', `PLANO:${plano}`, mpData.payment_method_id || '')

      // Se aprovado, renova o plano
      if (novoStatus === 'aprovado') {
        const novaExpISO = _dateOnlyISO(_addCalendarMonths(new Date(), 1))
        db.prepare('UPDATE tenants SET plano=?, expires_at=?, ativo=1 WHERE id=?').run(plano, novaExpISO, tid)
        marcarDirty()
        log('✅', `PLANO RENOVADO (Cartao): ${plano} tenant=${tid} expira=${novaExpISO}`)
      }

      log('💳', `Cartao plano: R$${valor} plano=${plano} tenant=${tid} status=${novoStatus}`)
      send(res, 200, { ok: true, status: novoStatus, status_detail: mpData.status_detail || '' })
    } catch (e) { log('❌', 'Cartao plano erro:', { error: e.message }); send(res, 500, { error: 'Erro ao processar pagamento: ' + e.message }) }
    return true
  }
  
  // ── Obter Public Key MP para frontend ────────────────
  // Consultar assinatura automatica do plano
  if (req.method === 'GET' && upath === '/api/planos/assinatura') {
    const tid = req.headers['x-tenant-id']
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    try {
      _ensurePlanoAssinaturas(db)
      let ass = db.prepare(`
        SELECT * FROM plano_assinaturas
        WHERE tenant_id=? AND lower(status) IN ('authorized','pending','paused')
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 1
      `).get(tid)
      if (!ass) ass = db.prepare(`
        SELECT * FROM plano_assinaturas
        WHERE tenant_id=?
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 1
      `).get(tid)
      send(res, 200, { ok: true, assinatura: ass || null })
    } catch (e) { send(res, 500, { error: e.message }) }
    return true
  }

  // Criar assinatura automatica via cartao (Mercado Pago preapproval)
  if (req.method === 'POST' && upath === '/api/planos/assinatura-cartao') {
    const tid = req.headers['x-tenant-id']
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    const body = await readBody(req)
    const { plano, valor, card_token, payment_method_id, payer_email } = body
    const planoOk = ['essencial', 'premium'].includes(String(plano || '').toLowerCase())
    if (!planoOk) { send(res, 400, { error: 'Plano invalido' }); return true }
    const planoNorm = String(plano).toLowerCase()
    const _valorMpPA = _mpValor(valor)
    if (_valorMpPA === null) { send(res, 400, { error: 'Valor invalido' }); return true }
    if (!card_token) { send(res, 400, { error: 'card_token obrigatorio' }); return true }
    const email = String(payer_email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      send(res, 400, { error: 'E-mail valido obrigatorio para assinatura automatica' })
      return true
    }

    const tenant = db.prepare('SELECT id,nome FROM tenants WHERE id=?').get(tid)
    if (!tenant) { send(res, 404, { error: 'Tenant nao encontrado' }); return true }

    _ensurePlanoAssinaturas(db)
    const ativa = db.prepare(`
      SELECT * FROM plano_assinaturas
      WHERE tenant_id=? AND lower(status) IN ('authorized','pending','paused')
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 1
    `).get(tid)
    if (ativa) {
      send(res, 409, { error: 'Ja existe uma assinatura automatica ativa ou pendente. Cancele antes de criar outra.', assinatura: ativa })
      return true
    }

    const mpToken = _resolveMpGlobal(db, MP_TOKEN)
    if (!mpToken) { send(res, 400, { error: 'Token Mercado Pago global nao configurado.' }); return true }

    const extRef = `assinatura-${tid.slice(0,8)}-${planoNorm}-${Date.now()}`
    const baseUrl = _baseUrlFromReq(req)
    const payload = {
      reason: `Assinatura Plano ${_planoSaasLabel(planoNorm)} - ${tenant.nome || 'Cliente'}`,
      external_reference: extRef,
      payer_email: email,
      card_token_id: card_token,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: _valorMpPA,
        currency_id: 'BRL'
      },
      status: 'authorized'
    }
    if (baseUrl) payload.back_url = `${baseUrl}/gestor.html?billing=1`

    try {
      const mp = await fetch('https://api.mercadopago.com/preapproval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${mpToken}`, 'X-Idempotency-Key': extRef },
        body: JSON.stringify(payload)
      })
      const mpData = await mp.json()
      if (!mp.ok) {
        log('WARN', 'MP assinatura plano erro:', mpData)
        send(res, 400, { error: mpData.message || mpData.error || mpData.cause?.[0]?.description || 'Erro ao criar assinatura automatica' })
        return true
      }

      const ass = _upsertAssinaturaPreapproval(db, tid, planoNorm, _valorMpPA, mpData, extRef, email, payment_method_id || '')
      marcarDirty()
      log('OK', `Assinatura plano criada: tenant=${tid} plano=${planoNorm} status=${ass.status} preapproval=${ass.mp_preapproval_id}`)
      send(res, 200, {
        ok: true,
        status: ass.status,
        assinatura: ass,
        renovado: false,
        aguardando_cobranca: true,
        message: 'Assinatura criada. A renovacao sera aplicada quando o Mercado Pago aprovar a cobranca.'
      })
    } catch (e) {
      log('WARN', 'Assinatura plano fetch erro:', { error: e.message })
      send(res, 500, { error: 'Erro ao criar assinatura: ' + e.message })
    }
    return true
  }

  // Cancelar assinatura automatica do plano
  if (req.method === 'POST' && upath === '/api/planos/assinatura-cancelar') {
    const tid = req.headers['x-tenant-id']
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    _ensurePlanoAssinaturas(db)
    const ass = db.prepare(`
      SELECT * FROM plano_assinaturas
      WHERE tenant_id=? AND lower(status) IN ('authorized','pending','paused')
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 1
    `).get(tid)
    if (!ass) {
      send(res, 404, { error: 'Nenhuma assinatura automatica ativa encontrada.' })
      return true
    }

    const mpToken = _resolveMpGlobal(db, MP_TOKEN)
    if (!mpToken) { send(res, 400, { error: 'Token Mercado Pago global nao configurado.' }); return true }

    try {
      if (ass.mp_preapproval_id) {
        const mp = await fetch(`https://api.mercadopago.com/preapproval/${ass.mp_preapproval_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${mpToken}` },
          body: JSON.stringify({ status: 'canceled' })
        })
        const mpData = await mp.json().catch(() => ({}))
        if (!mp.ok && mp.status !== 404) {
          send(res, 400, { error: mpData.message || mpData.error || 'Nao foi possivel cancelar no Mercado Pago' })
          return true
        }
      }

      db.prepare(`UPDATE plano_assinaturas
        SET status='canceled', canceled_at=COALESCE(canceled_at, ?), updated_at=datetime('now')
        WHERE id=?`)
        .run(new Date().toISOString(), ass.id)
      marcarDirty()
      send(res, 200, { ok: true, status: 'canceled' })
    } catch (e) { send(res, 500, { error: e.message }) }
    return true
  }

  if (req.method === 'GET' && upath === '/api/planos/mp-public-key') {
    try {
      const cfgMp = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
      const gCfg = cfgMp?.ia_config ? JSON.parse(cfgMp.ia_config) : {}
      send(res, 200, { public_key: gCfg.mp_public_key || '' })
    } catch { send(res, 200, { public_key: '' }) }
    return true
  }

  // ── Solicitar teste gratis (landing page → WA admin) ─────────────
  if (req.method === 'POST' && upath === '/api/planos/solicitar-teste') {
    const body = await readBody(req)
    const { nome, restaurante, telefone, cidade, plano } = body
    if (!nome || !telefone) { send(res, 400, { error: 'Nome e telefone obrigatorios' }); return true }
    try {
      // Busca numero do admin no config global
      const cfgG = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
      const gCfg = cfgG?.ia_config ? JSON.parse(cfgG.ia_config) : {}
      const adminPhone = (gCfg.admin_phone || '').replace(/\D/g,'')
      const planoLabel = _planoSaasLabel(plano)
      const msgAdmin = [
        `*🆕 NOVO LEAD — TESTE GRATIS*`,
        ``,
        `*Nome:* ${nome}`,
        `*Restaurante:* ${restaurante || '—'}`,
        `*Telefone:* ${telefone}`,
        `*Cidade:* ${cidade || '—'}`,
        `*Plano de interesse:* ${planoLabel}`,
        ``,
        `_Enviado automaticamente pela landing page_`
      ].join('\n')
      // Envia WA para admin
      if (adminPhone) {
        try {
          const evoHeaders = { 'Content-Type': 'application/json', apikey: EVO_KEY }
          const evoBody = JSON.stringify({ number: adminPhone, text: msgAdmin })
          await fetch(`${EVO_URL}/message/sendText/${EVO_INST}`, { method: 'POST', headers: evoHeaders, body: evoBody })
          log('📨', `Trial lead WA enviado para admin (${adminPhone}): ${nome} — ${planoLabel}`)
        } catch(eWa) { log('⚠️', 'WA admin trial erro:', eWa.message) }
      } else {
        log('⚠️', 'admin_phone nao configurado no painel admin — WA nao enviado')
      }
      // Salva lead na tabela (cria se nao existir)
      try {
        db.prepare(`CREATE TABLE IF NOT EXISTS leads_trial (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT, restaurante TEXT, telefone TEXT, cidade TEXT, plano TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )`).run()
        db.prepare('INSERT INTO leads_trial (nome,restaurante,telefone,cidade,plano) VALUES (?,?,?,?,?)').run(
          nome, restaurante||'', telefone, cidade||'', plano||'essencial'
        )
      } catch(eDb) { log('⚠️', 'leads_trial insert erro:', eDb.message) }
      send(res, 200, { ok: true })
    } catch(e) { log('❌', 'solicitar-teste erro:', e.message); send(res, 500, { error: e.message }) }
    return true
  }

  // ── Admin: Configurar telefone admin (WA para receber leads) ──────
  if (req.method === 'POST' && upath === '/api/admin/planos/admin-phone') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Nao autorizado' }); return true }
    const body = await readBody(req)
    const { admin_phone } = body
    try {
      const cfgG = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
      const ia = cfgG?.ia_config ? JSON.parse(cfgG.ia_config) : {}
      ia.admin_phone = (admin_phone || '').replace(/\D/g,'')
      db.prepare("INSERT INTO store_config (tenant_id,ia_config) VALUES ('_global',?) ON CONFLICT(tenant_id) DO UPDATE SET ia_config=excluded.ia_config").run(JSON.stringify(ia))
      marcarDirty()
      log('⚙️', `admin_phone configurado: ${ia.admin_phone}`)
      send(res, 200, { ok: true, admin_phone: ia.admin_phone })
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Admin: Obter telefone admin ────────────────────────────────────
  if (req.method === 'GET' && upath === '/api/admin/planos/admin-phone') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Nao autorizado' }); return true }
    try {
      const cfgG = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
      const ia = cfgG?.ia_config ? JSON.parse(cfgG.ia_config) : {}
      send(res, 200, { admin_phone: ia.admin_phone || '' })
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Admin: Listar leads trial ──────────────────────────────────────
  if (req.method === 'GET' && upath === '/api/admin/leads-trial') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Nao autorizado' }); return true }
    try {
      db.prepare(`CREATE TABLE IF NOT EXISTS leads_trial (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT, restaurante TEXT, telefone TEXT, cidade TEXT, plano TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`).run()
      const leads = db.prepare('SELECT * FROM leads_trial ORDER BY created_at DESC LIMIT 200').all()
      send(res, 200, leads)
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Segmento do tenant ──────────────────────────────────────────────────
  if (upath === '/api/tenant-segmento') {
    const tid = req.headers['x-tenant-id'] || params.get('tenant_id') || ''
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatório' }); return true }
    if (req.method === 'GET') {
      const row = db.prepare('SELECT segmento FROM tenants WHERE id=?').get(tid)
      send(res, 200, { segmento: row?.segmento || 'restaurante' }); return true
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req)
      const seg  = ['restaurante','acougue'].includes(body.segmento) ? body.segmento : 'restaurante'
      db.prepare('UPDATE tenants SET segmento=? WHERE id=?').run(seg, tid)
      marcarDirty()
      send(res, 200, { ok: true, segmento: seg }); return true
    }
  }

  // ── Catálogos do Açougue (cortes, preparos, ocasiao, armazenamento) ────────
  if (upath === '/api/acougue-catalogs') {
    const tid = req.headers['x-tenant-id'] || params.get('tenant_id') || ''
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatório' }); return true }

    if (req.method === 'GET') {
      const row = db.prepare('SELECT ia_config FROM store_config WHERE tenant_id=?').get(tid)
      const ia  = row?.ia_config ? JSON.parse(row.ia_config) : {}
      send(res, 200, { catalogs: ia.acougue_catalogs || null }); return true
    }

    if (req.method === 'POST') {
      const body = await readBody(req)
      if (!body || typeof body !== 'object') { send(res, 400, { error: 'Body inválido' }); return true }
      const row = db.prepare('SELECT ia_config FROM store_config WHERE tenant_id=?').get(tid)
      const ia  = row?.ia_config ? JSON.parse(row.ia_config) : {}
      ia.acougue_catalogs = body
      db.prepare('INSERT INTO store_config (tenant_id,ia_config) VALUES (?,?) ON CONFLICT(tenant_id) DO UPDATE SET ia_config=excluded.ia_config')
        .run(tid, JSON.stringify(ia))
      marcarDirty()
      send(res, 200, { ok: true }); return true
    }
  }
  // ── Rádio push-to-talk (garçom ↔ garçom, garçom ↔ gestor) ──────────────────
  if (req.method === 'POST' && upath === '/api/radio/send') {
    const tid  = getTenantId(req, params)
    if (!tid) { send(res, 400, { error: 'Tenant não identificado' }); return true }
    const body = await readBody(req)
    const { audio, garcom_nome, garcom_id, destino, audio_mime, mime, mimeType: bodyMimeType } = body
    if (!audio) { send(res, 400, { error: 'Áudio obrigatório' }); return true }
    if (audio.length > 2000000) { send(res, 413, { error: 'Áudio muito grande (máx 10s)' }); return true }

    const from_id = garcom_id ? String(garcom_id) : 'gestor'
    const to_id = (!destino || destino === 'gestor') ? 'gestor' : String(destino)
    const from_nome = garcom_nome || (from_id === 'gestor' ? 'Gestor' : 'Garçom')
    const rawMime = String(audio_mime || mime || bodyMimeType || 'audio/webm').trim().toLowerCase()
    const safeMime = /^audio\/[a-z0-9.+-]+(?:;\s*codecs=[a-z0-9.+-]+)?$/i.test(rawMime) ? rawMime : 'audio/webm'

    // Salva no banco
    try {
      db.prepare('INSERT INTO radio_messages (tenant_id, from_id, from_nome, to_id, audio, audio_mime) VALUES (?,?,?,?,?,?)').run(tid, from_id, from_nome, to_id, audio, safeMime)
    } catch(e) { console.warn('[RADIO] db insert:', e.message) }

    const payload = { audio, audio_mime: safeMime, garcom_nome: from_nome, garcom_id: from_id, ts: Date.now() }
    if (to_id === 'gestor') {
      sseBroadcast(`radio-rt:${tid}`, 'radio:msg', payload)
    } else {
      sseBroadcast(`radio-garcom-${to_id}:${tid}`, 'radio:msg', payload)
    }
    send(res, 200, { ok: true })
    return true
  }

  // ── Lista mensagens de rádio (histórico das últimas 10h) ──────────────────
  if (req.method === 'GET' && upath === '/api/radio/messages') {
    const tid = getTenantId(req, params)
    if (!tid) { send(res, 400, { error: 'Tenant não identificado' }); return true }
    const user_id = params.get('user_id') || 'gestor'
    try {
      // Retorna mensagens enviadas OU recebidas por este user nos últimos 10h (sem o blob de áudio — só metadata)
      const rows = db.prepare(`
        SELECT id, from_id, from_nome, to_id, COALESCE(audio_mime,'audio/webm') AS audio_mime, created_at
        FROM radio_messages
        WHERE tenant_id=? AND (from_id=? OR to_id=?)
          AND created_at >= datetime('now','-10 hours')
        ORDER BY id DESC LIMIT 100
      `).all(tid, user_id, user_id)
      send(res, 200, rows || [])
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Busca áudio de uma mensagem específica ────────────────────────────────
  if (req.method === 'GET' && upath.startsWith('/api/radio/audio/')) {
    const tid = getTenantId(req, params)
    const msgId = parseInt(upath.split('/')[4]) || 0
    if (!tid || !msgId) { send(res, 400, { error: 'Parâmetros inválidos' }); return true }
    try {
      const row = db.prepare("SELECT audio, COALESCE(audio_mime,'audio/webm') AS audio_mime FROM radio_messages WHERE id=? AND tenant_id=?").get(msgId, tid)
      if (!row) { send(res, 404, { error: 'Áudio não encontrado' }); return true }
      send(res, 200, { audio: row.audio, audio_mime: row.audio_mime || 'audio/webm' })
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Lista garçons ativos (para o seletor de rádio) ────────────────────────
  if (req.method === 'GET' && upath === '/api/radio/garcons') {
    const tid = getTenantId(req, params)
    if (!tid) { send(res, 400, { error: 'Tenant não identificado' }); return true }
    try {
      const rows = db.prepare('SELECT id, nome FROM garcons WHERE tenant_id=? AND ativo=1 ORDER BY nome').all(tid)
      send(res, 200, rows || [])
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  if (req.method === 'POST' && upath === '/api/garcom-login') {
    const tid  = getTenantId(req, params)
    const body = await readBody(req)
    const { usuario, senha } = body
    if (!usuario || !senha) { send(res, 400, { error: 'Usuário e senha obrigatórios' }); return true }
    if (!tid)               { send(res, 400, { error: 'Tenant não identificado' }); return true }
    const _rlKeyGarcom = 'garcom-login:' + clientIp(req) + ':' + tid + ':' + usuario.trim().toLowerCase()
    if (loginRateLimited(_rlKeyGarcom, 8, 5 * 60 * 1000)) {
      send(res, 429, { error: 'Muitas tentativas. Aguarde alguns minutos.' }); return true
    }
    try {
      // Senha pode estar em plain text (legado) ou SHA256 (novo).
      // Aceita ambos e, ao detectar plain text, migra automaticamente para hash.
      const user = usuario.trim().toLowerCase()
      const hashSenha = crypto.createHash('sha256').update(senha).digest('hex')
      const row = db.prepare(
        'SELECT id, tenant_id, nome, usuario, senha, ativo FROM garcons WHERE tenant_id=? AND usuario=? AND ativo=1'
      ).get(tid, user)
      if (!row) { registrarLoginFalho(_rlKeyGarcom, 5 * 60 * 1000); send(res, 401, { error: 'Usuário ou senha incorretos' }); return true }
      const stored = row.senha || ''
      const isHash = /^[a-f0-9]{64}$/i.test(stored)
      const match = isHash ? (stored === hashSenha) : (stored === senha)
      if (!match) { registrarLoginFalho(_rlKeyGarcom, 5 * 60 * 1000); send(res, 401, { error: 'Usuário ou senha incorretos' }); return true }
      // Migração lazy: se estava em plain text, atualiza para hash
      if (!isHash) {
        try { db.prepare('UPDATE garcons SET senha=? WHERE id=?').run(hashSenha, row.id); log('🔐', `[MIGRACAO] Senha do garçom ${row.usuario} migrada para hash`) } catch(_) {}
      }
      const token = criarSessaoGarcom(row)
      send(res, 200, { id: row.id, tenant_id: row.tenant_id, nome: row.nome, usuario: row.usuario, ativo: true, token })
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Gera PDF de um job e devolve base64 (para extensão Chrome) ──
  if (req.method === 'GET' && upath.startsWith('/api/print-queue/pdf/')) {
    const tid   = req.headers['x-tenant-id']
    const jobId = parseInt(upath.split('/')[4]) || 0
    if (!tid || !jobId) { send(res, 400, { error: 'parâmetros inválidos' }); return true }
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS print_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL, html TEXT NOT NULL,
        format TEXT DEFAULT 'A4', printer TEXT,
        status TEXT DEFAULT 'pending', error TEXT,
        created_at TEXT DEFAULT (datetime('now')), done_at TEXT
      )`)
      const job = db.prepare(
        `SELECT id, html, format, printer FROM print_jobs WHERE id=? AND tenant_id=?`
      ).get(jobId, tid)
      if (!job) { send(res, 404, { error: 'Job não encontrado' }); return true }

      let puppeteer
      try { puppeteer = require('puppeteer') } catch {
        send(res, 500, { error: 'Puppeteer não instalado' }); return true
      }

      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']
      })
      let pdfBase64
      try {
        const page = await browser.newPage()
        const fullHtml = job.html.includes('<html') ? job.html
          : `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important }
  body { font-family:'Courier New',monospace; font-size:12px; color:#000; background:#fff; width:100%; overflow-wrap:break-word; word-break:break-word }
  hr { border:none; border-top:1px dashed #000; margin:4px 0 }
  .pt-center { text-align:center } .pt-large { font-size:15px; font-weight:bold }
  .pt-hr { border:none; border-top:1px dashed #000; margin:4px 0 }
  .print-ticket { padding:0 2px; width:100%; overflow:visible; word-wrap:break-word; overflow-wrap:break-word }
  @media print { @page { margin:0 } }
</style></head><body>${job.html}</body></html>`
        await page.setContent(fullHtml, { waitUntil: 'networkidle0' })
        const pdfOpts = {
          printBackground: true,
          margin: { top:'2mm', bottom:'3mm', left:'0', right:'0' }
        }
        const fmt = job.format || 'A4'
        if (fmt === '80mm' || fmt === '58mm') {
          pdfOpts.width  = fmt
          pdfOpts.height = (await page.evaluate(() => document.body.scrollHeight + 20)) + 'px'
        } else {
          pdfOpts.format = fmt
        }
        const pdfBuf = await page.pdf(pdfOpts)
        pdfBase64 = pdfBuf.toString('base64')
      } finally {
        await browser.close()
      }
      send(res, 200, {
        ok: true,
        id: job.id,
        pdf: pdfBase64,
        format: job.format || 'A4',
        printer: job.printer || ''
      })
    } catch (e) {
      log('❌', 'PDF para extensão erro:', e.message)
      send(res, 500, { error: e.message })
    }
    return true
  }

  // ═══════════════════════════════════════════════════════
  // FILA DE IMPRESSÃO — Agente local
  // O agente roda no computador da loja e consulta esta fila
  // ═══════════════════════════════════════════════════════

  // ── Lista impressoras do sistema ──────────────────────────────────
  if (req.method === 'GET' && upath === '/api/printers') {
    log('🖨️', '[PRINT] GET /api/printers | plataforma:', process.platform)
    try {
      const { execSync } = require('child_process')
      let printers = []
      let defaultPrinter = ''
      try {
        if (process.platform === 'win32') {
          const out = execSync('powershell -Command "Get-Printer | Select-Object Name,Default | ConvertTo-Json"', { timeout: 5000 }).toString()
          const list = JSON.parse(out)
          const arr = Array.isArray(list) ? list : [list]
          printers       = arr.map(p => p.Name)
          defaultPrinter = (arr.find(p => p.Default) || {}).Name || ''
        } else {
          const out = execSync('lpstat -a 2>/dev/null || lpstat -p 2>/dev/null', { timeout: 5000 }).toString()
          printers = out.split('\n').filter(Boolean).map(l => l.split(' ')[0] || l.split('\t')[0]).filter(Boolean)
          try { defaultPrinter = execSync('lpstat -d 2>/dev/null', { timeout: 3000 }).toString().split(':')[1]?.trim() || '' } catch {}
        }
      } catch (e) {
        log('⚠️', '[PRINT] Erro ao listar impressoras:', e.message)
      }
      log('🖨️', '[PRINT] Impressoras encontradas:', printers.length, '| padrão:', defaultPrinter || '(nenhuma)')
      send(res, 200, { printers, default: defaultPrinter })
    } catch (e) {
      log('❌', '[PRINT] /api/printers erro:', e.message)
      send(res, 200, { printers: [], default: '' })
    }
    return true
  }

  // ── Gera PDF no servidor e devolve como base64 para o navegador imprimir ──
  if (req.method === 'POST' && upath === '/api/print') {
    const tid  = req.headers['x-tenant-id']
    const body = await readBody(req)
    log('🖨️', '[PRINT] POST /api/print | tenant:', tid || '(sem tenant)' , '| format:', body.format || '80mm', '| html length:', body.html?.length || 0)

    if (!tid)       { log('❌','[PRINT] Rejeitado: sem x-tenant-id'); send(res, 400, { error: 'x-tenant-id obrigatório' }); return true }
    if (!body.html) { log('❌','[PRINT] Rejeitado: sem html');         send(res, 400, { error: 'html obrigatório' });         return true }

    try {
      let puppeteer
      try {
        puppeteer = require('puppeteer')
        log('🖨️', '[PRINT] Puppeteer carregado OK')
      } catch (e) {
        log('❌', '[PRINT] Puppeteer não instalado:', e.message)
        send(res, 500, { error: 'Puppeteer não instalado no servidor' }); return true
      }

      log('🖨️', '[PRINT] Iniciando browser...')
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']
      })
      log('🖨️', '[PRINT] Browser iniciado')

      let pdfBase64
      try {
        const page = await browser.newPage()
        const fmt  = body.format || '80mm'
        const fullHtml = body.html.includes('<html') ? body.html
          : `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important }
  body { font-family:'Courier New',monospace; font-size:12px; color:#000; background:#fff; width:100%; overflow-wrap:break-word; word-break:break-word }
  hr { border:none; border-top:1px dashed #000; margin:4px 0 }
  .pt-center { text-align:center } .pt-large { font-size:15px; font-weight:bold }
  .pt-hr { border:none; border-top:1px dashed #000; margin:4px 0 }
  .print-ticket { padding:0 2px; width:100%; overflow:visible; word-wrap:break-word; overflow-wrap:break-word }
  @media print { @page { margin:0 } }
</style></head><body>${body.html}</body></html>`

        await page.setContent(fullHtml, { waitUntil: 'networkidle0' })
        log('🖨️', '[PRINT] Página renderizada | formato:', fmt)

        const pdfOpts = {
          printBackground: true,
          margin: { top:'2mm', bottom:'3mm', left:'0', right:'0' }
        }
        if (fmt === '80mm' || fmt === '58mm') {
          pdfOpts.width  = fmt
          pdfOpts.height = (await page.evaluate(() => document.body.scrollHeight + 24)) + 'px'
        } else {
          pdfOpts.format = fmt
        }
        const pdfBuf = await page.pdf(pdfOpts)
        pdfBase64 = pdfBuf.toString('base64')
        log('✅', '[PRINT] PDF gerado | tamanho:', Math.round(pdfBuf.length / 1024) + 'KB')
      } finally {
        await browser.close()
        log('🖨️', '[PRINT] Browser fechado')
      }

      send(res, 200, { ok: true, pdf: pdfBase64 })
      log('✅', '[PRINT] PDF enviado ao navegador com sucesso')
    } catch (e) {
      log('❌', '[PRINT] /api/print erro:', e.message)
      log('❌', '[PRINT] Stack:', e.stack?.split('\n')[1] || '')
      send(res, 500, { error: e.message })
    }
    return true
  }

  // Mapa em memória: tenant_id → { last_seen, printer, format }
  if (!handleRoutes._agents) handleRoutes._agents = new Map()
  const _agents = handleRoutes._agents
  const _normalizePrintAgentTipo = (tipo) => {
    const t = String(tipo || '').trim().toLowerCase()
    return (t === 'caixa' || t === 'cozinha') ? t : ''
  }
  const _getPrintAgentBucket = (tid) => {
    const current = _agents.get(tid)
    if (current instanceof Map) return current
    const bucket = new Map()
    if (current && typeof current === 'object' && current.last_seen) {
      bucket.set(`${current.tipo || 'all'}:${current.printer || ''}`, {
        last_seen: current.last_seen,
        printer: current.printer || '',
        format: current.format || 'A4',
        tipo: _normalizePrintAgentTipo(current.tipo)
      })
    }
    _agents.set(tid, bucket)
    return bucket
  }
  const _activePrintAgents = (tid, tipoFilter = '') => {
    const bucket = _getPrintAgentBucket(tid)
    const now = Date.now()
    const active = []
    for (const [key, agent] of bucket.entries()) {
      if (!agent || (now - agent.last_seen) >= 30000) {
        if (!agent || (now - (agent.last_seen || 0)) > 120000) bucket.delete(key)
        continue
      }
      if (!tipoFilter || !agent.tipo || agent.tipo === tipoFilter) active.push(agent)
    }
    return active
  }

  // ── Heartbeat do agente (a cada 10s) ─────────────────
  if (req.method === 'POST' && upath === '/api/print-queue/heartbeat') {
    const tid  = req.headers['x-tenant-id']
    const body = await readBody(req)
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatório' }); return true }
    const tipo = _normalizePrintAgentTipo(body.tipo)
    const bucket = _getPrintAgentBucket(tid)
    bucket.set(`${tipo || 'all'}:${body.printer || ''}`, {
      last_seen: Date.now(),
      printer: body.printer || '',
      format: body.format || 'A4',
      tipo
    })
    send(res, 200, { ok: true })
    return true
  }

  // ── Status do agente (gestor consulta antes de criar job) ──
  if (req.method === 'GET' && upath === '/api/print-queue/status') {
    const tid = req.headers['x-tenant-id']
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatório' }); return true }
    const parsedUrl = new URL(req.url, 'http://localhost')
    const tipoFilter = _normalizePrintAgentTipo(parsedUrl.searchParams.get('tipo') || '')
    const activeAgents = _activePrintAgents(tid, tipoFilter)
    const agent = activeAgents[0]
    send(res, 200, {
      active: activeAgents.length > 0,
      printer: agent?.printer || '',
      format: agent?.format || 'A4',
      tipo: agent?.tipo || '',
      agents: activeAgents.map(a => ({ printer: a.printer || '', format: a.format || 'A4', tipo: a.tipo || '' }))
    })
    return true
  }

  // ── Gestor cria job na fila ───────────────────────────
  if (req.method === 'POST' && upath === '/api/print-queue/job') {
    const tid  = req.headers['x-tenant-id']
    const body = await readBody(req)
    if (!tid)       { send(res, 400, { error: 'x-tenant-id obrigatório' }); return true }
    if (!body.html) { send(res, 400, { error: 'html obrigatório' }); return true }
    try {
      // Garante que a tabela existe (com coluna tipo para roteamento caixa/cozinha)
      db.exec(`CREATE TABLE IF NOT EXISTS print_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL, html TEXT NOT NULL,
        format TEXT DEFAULT 'A4', printer TEXT,
        tipo TEXT DEFAULT NULL,
        status TEXT DEFAULT 'pending', error TEXT,
        created_at TEXT DEFAULT (datetime('now')), done_at TEXT
      )`)
      // Migration: adiciona coluna tipo se não existir (para DBs já criados)
      try { db.exec(`ALTER TABLE print_jobs ADD COLUMN tipo TEXT DEFAULT NULL`) } catch (_) {}
      const info = db.prepare(
        `INSERT INTO print_jobs (tenant_id, html, format, printer, tipo) VALUES (?, ?, ?, ?, ?)`
      ).run(tid, body.html, body.format || 'A4', body.printer || null, body.tipo || null)
      const job = {
        id: info.lastInsertRowid,
        tenant_id: tid,
        html: body.html,
        format: body.format || 'A4',
        printer: body.printer || '',
        tipo: body.tipo || null,
        status: 'pending'
      }
      try { sseBroadcast(`print-jobs-rt:${tid}`, 'print_jobs:INSERT', job) } catch (_) {}
      send(res, 201, { ok: true, id: info.lastInsertRowid })
    } catch (e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Agente busca jobs pendentes ───────────────────────
  if (req.method === 'GET' && upath === '/api/print-queue/pending') {
    const tid = req.headers['x-tenant-id']
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatório' }); return true }
    // Filtro opcional por tipo (caixa, cozinha) via query string ?tipo=caixa
    const parsedUrl = new URL(req.url, 'http://localhost')
    const tipoFilter = parsedUrl.searchParams.get('tipo') || null
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS print_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL, html TEXT NOT NULL,
        format TEXT DEFAULT 'A4', printer TEXT,
        tipo TEXT DEFAULT NULL,
        status TEXT DEFAULT 'pending', error TEXT,
        created_at TEXT DEFAULT (datetime('now')), done_at TEXT
      )`)
      try { db.exec(`ALTER TABLE print_jobs ADD COLUMN tipo TEXT DEFAULT NULL`) } catch (_) {}
      // Recupera jobs travados em 'processing' há mais de 2 minutos — agente pode ter caído
      try { db.exec(`UPDATE print_jobs SET status='pending' WHERE status='processing' AND created_at < datetime('now','-2 minutes')`) } catch (_) {}
      let jobs
      if (tipoFilter) {
        jobs = db.prepare(
          `SELECT id, html, format, printer, tipo FROM print_jobs WHERE tenant_id=? AND status='pending' AND tipo=? ORDER BY id ASC LIMIT 5`
        ).all(tid, tipoFilter)
      } else {
        jobs = db.prepare(
          `SELECT id, html, format, printer, tipo FROM print_jobs WHERE tenant_id=? AND status='pending' ORDER BY id ASC LIMIT 5`
        ).all(tid)
      }
      // Marca como 'processing' para não duplicar
      if (jobs.length) {
        const ids = jobs.map(j => j.id).join(',')
        db.exec(`UPDATE print_jobs SET status='processing' WHERE id IN (${ids})`)
      }
      send(res, 200, jobs)
    } catch (e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Agente marca job como concluído ou erro ───────────
  if (req.method === 'PATCH' && upath.startsWith('/api/print-queue/job/') && upath.endsWith('/done')) {
    const tid   = req.headers['x-tenant-id']
    const id    = parseInt(upath.split('/')[4]) || 0
    const body  = await readBody(req)
    if (!tid || !id) { send(res, 400, { error: 'parâmetros inválidos' }); return true }
    try {
      const status = body.status === 'error' ? 'error' : 'done'
      db.prepare(
        `UPDATE print_jobs SET status=?, error=?, done_at=datetime('now') WHERE id=? AND tenant_id=?`
      ).run(status, body.error || null, id, tid)
      // Limpa jobs antigos (>24h)
      db.exec(`DELETE FROM print_jobs WHERE created_at < datetime('now','-1 day')`)
      send(res, 200, { ok: true })
    } catch (e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Max global ID para cálculo de offset por tenant ──
  if (req.method === 'GET' && upath === '/api/orders/global-max-id') {
    try {
      const row = db.prepare('SELECT COALESCE(MAX(id),0) as max_id FROM orders').get()
      send(res, 200, { max_id: row?.max_id || 0 })
    } catch (e) { send(res, 500, { error: e.message }) }
    return true
  }


  // ── Import cardápio em lote (transação única) ─────────────────────────
  if (req.method === 'POST' && upath === '/api/orders/reset-counter') {
    const tid = getTenantId(req, params)
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    try {
      const body = await readBody(req)
      if (String(body?.confirmacao || '').trim().toUpperCase() !== 'ZERAR') {
        send(res, 400, { error: 'Confirmacao invalida' })
        return true
      }

      const offset = db.prepare('SELECT COALESCE(MAX(id),0) as max_id FROM orders').get()?.max_id || 0
      const hoje = _brasiliaDateString()
      db.transaction(() => {
        db.prepare('INSERT OR IGNORE INTO store_config (tenant_id) VALUES (?)').run(tid)
        db.prepare('UPDATE store_config SET order_num_offset=?, order_auto_reset_last_date=? WHERE tenant_id=?').run(offset, hoje, tid)
      })()
      marcarDirty()
      const payload = { tenant_id: tid, order_num_offset: offset, order_auto_reset_last_date: hoje }
      sseBroadcast(`store-config-rt:${tid}`, 'store_config:UPDATE', payload)
      sseBroadcast(`orders-rt:${tid}`, 'store_config:UPDATE', payload)
      send(res, 200, { ok: true, order_num_offset: offset, order_auto_reset_last_date: hoje, next_order_num: 1 })
    } catch (e) {
      log('ERR', `reset-counter erro tenant=${tid}:`, e.message)
      send(res, 500, { error: e.message })
    }
    return true
  }

  if (req.method === 'POST' && upath === '/api/importar-cardapio') {
    const tid = req.headers['x-tenant-id'] || params.get('tenant_id') || ''
    if (!tid) { send(res, 401, { error: 'Não autorizado' }); return true }
    try {
      const body = await readBody(req)
      const categorias = body?.categorias
      if (!Array.isArray(categorias)) { send(res, 400, { error: 'categorias[] obrigatório' }); return true }
      const substituir = body?.substituir === true || body?.replace === true || body?.limpar === true
      const tenant = db.prepare('SELECT id FROM tenants WHERE id=? AND ativo=1').get(tid)
      if (!tenant) { send(res, 404, { error: 'Tenant não encontrado' }); return true }

      const COLS_MI = ['tenant_id','name','description','price','price_old','category_id','cat','cat_key','emoji','image_url',
                       'item_type','allow_half','max_flavors','promo','destaque','status',
                       'days','ingredients','custom_groups','sort_order']
      const COLS_CAT = ['tenant_id','name','label','type','promo','emoji','sort_order']

      let catsCriadas = 0, itensCriados = 0, erros = 0, catsRemovidas = 0, itensRemovidos = 0
      const catIds = {}  // name → id

      const doImport = db.transaction(() => {
        if (substituir) {
          itensRemovidos = db.prepare('DELETE FROM menu_items WHERE tenant_id=?').run(tid).changes || 0
          catsRemovidas = db.prepare('DELETE FROM categories WHERE tenant_id=?').run(tid).changes || 0
        }

        let catOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as mx FROM categories WHERE tenant_id=?').get(tid)?.mx || 0

        for (const catDef of categorias) {
          if (!catDef.name || !catDef.label) { erros++; continue }
          try {
            const catRow = {
              tenant_id: tid, name: catDef.name, label: catDef.label,
              type: catDef.type || 'Itens principais',
              promo: catDef.promo ? 1 : 0,
              emoji: catDef.emoji || null,
              sort_order: ++catOrder
            }
            const catKeys = Object.keys(catRow).filter(k => COLS_CAT.includes(k))
            const catInfo = db.prepare(
              `INSERT INTO categories (${catKeys.map(k=>`"${k}"`).join(',')}) VALUES (${catKeys.map(()=>'?').join(',')})`
            ).run(...catKeys.map(k => catRow[k]))
            catIds[catDef.name] = catInfo.lastInsertRowid
            catsCriadas++

            let itemOrder = 0
            for (const itemDef of (catDef.itens || [])) {
              if (!itemDef.name) { erros++; continue }
              try {
                const serialize = v => {
                  if (v === undefined || v === null) return null
                  if (v === true) return 1; if (v === false) return 0
                  if (Array.isArray(v) || (typeof v === 'object')) return JSON.stringify(v)
                  return v
                }
                const itemRow = {
                  tenant_id: tid,
                  name: itemDef.name,
                  description: itemDef.description || '',
                  price: parseFloat(itemDef.price) || 0,
                  price_old: itemDef.price_old || null,
                  category_id: catInfo.lastInsertRowid,
                  cat: catDef.label,
                  cat_key: catDef.name,
                  emoji: itemDef.emoji || '🍽️',
                  image_url: typeof itemDef.image_url === 'string' ? itemDef.image_url
                    : (typeof itemDef.imageUrl === 'string' ? itemDef.imageUrl : null),
                  item_type: itemDef.item_type || 'normal',
                  allow_half: itemDef.allow_half ? 1 : 0,
                  max_flavors: itemDef.max_flavors || 1,
                  promo: 0, destaque: 0,
                  status: itemDef.status || 'active',
                  days: JSON.stringify(itemDef.days || [1,1,1,1,1,1,1]),
                  ingredients: JSON.stringify(itemDef.ingredients || []),
                  custom_groups: JSON.stringify(itemDef.custom_groups || []),
                  sort_order: ++itemOrder
                }
                const itemKeys = Object.keys(itemRow).filter(k => COLS_MI.includes(k))
                db.prepare(
                  `INSERT INTO menu_items (${itemKeys.map(k=>`"${k}"`).join(',')}) VALUES (${itemKeys.map(()=>'?').join(',')})`
                ).run(...itemKeys.map(k => itemRow[k]))
                itensCriados++
              } catch(e) { erros++ }
            }
          } catch(e) { erros++ }
        }
      })

      doImport()
      marcarDirty()
      try {
        emit(tid, 'categories', { tenant_id: tid, bulk: true }, 'UPDATE')
        emit(tid, 'menu_items', { tenant_id: tid, bulk: true }, 'UPDATE')
      } catch {}
      send(res, 200, { ok: true, substituir, catsRemovidas, itensRemovidos, catsCriadas, itensCriados, erros })
    } catch(e) {
      send(res, 500, { error: e.message })
    }
    return true
  }

  // ── Repara imagens antigas salvas como data URL no cardápio ─────────
  if (req.method === 'POST' && upath === '/api/cardapio/reparar-imagens') {
    const tid = req.headers['x-tenant-id'] || params.get('tenant_id') || ''
    if (!tid) { send(res, 401, { error: 'x-tenant-id obrigatório' }); return true }
    try {
      const tenant = db.prepare('SELECT id FROM tenants WHERE id=? AND ativo=1').get(tid)
      if (!tenant) { send(res, 404, { error: 'Tenant não encontrado' }); return true }

      fs.mkdirSync(UPLOADS_DIR, { recursive: true })
      const rows = db.prepare(`
        SELECT id, image_url
          FROM menu_items
         WHERE tenant_id=?
           AND image_url LIKE 'data:image/%;base64,%'
      `).all(tid)

      const extByMime = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/svg+xml': 'svg'
      }
      const safeTid = String(tid).replace(/[^a-zA-Z0-9_-]/g, '')
      const cache = new Map()
      const update = db.prepare('UPDATE menu_items SET image_url=? WHERE id=? AND tenant_id=?')
      let converted = 0, files = 0, skipped = 0

      for (const row of rows) {
        const dataUrl = String(row.image_url || '')
        let publicUrl = cache.get(crypto.createHash('sha256').update(dataUrl).digest('hex'))
        if (!publicUrl) {
          const m = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp|gif|svg\+xml));base64,([\s\S]+)$/i)
          if (!m) { skipped++; continue }
          const mime = m[1].toLowerCase()
          const ext = extByMime[mime] || 'jpg'
          const buf = Buffer.from(m[2], 'base64')
          if (!buf.length || buf.length > 10 * 1024 * 1024) { skipped++; continue }
          const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 20)
          const fname = `${safeTid}_${hash}.${ext}`
          const fpath = path.join(UPLOADS_DIR, fname)
          if (!fs.existsSync(fpath)) {
            fs.writeFileSync(fpath, buf)
            files++
          }
          publicUrl = `/uploads/${fname}`
          cache.set(crypto.createHash('sha256').update(dataUrl).digest('hex'), publicUrl)
        }
        converted += update.run(publicUrl, row.id, tid).changes || 0
      }

      if (converted) {
        marcarDirty()
        try { emit(tid, 'menu_items', { tenant_id: tid, bulk: true, image_repair: true }, 'UPDATE') } catch {}
      }
      send(res, 200, { ok: true, scanned: rows.length, converted, files, skipped })
    } catch(e) {
      send(res, 500, { error: e.message })
    }
    return true
  }

  // ════════════════════════════════════════════════════════
  // ADMIN — AUDIT LOG, FATURAMENTO, COBRANÇA, SAÚDE
  // ════════════════════════════════════════════════════════

  // ── Helper interno: registra log de auditoria ─────────
  function _registrarAudit(adminSess, payload, reqHeaders) {
    try {
      const ip = (reqHeaders['x-forwarded-for'] || reqHeaders['x-real-ip'] || '').toString().split(',')[0].trim()
        || req.socket?.remoteAddress || ''
      const ua = (reqHeaders['user-agent'] || '').toString().slice(0, 500)
      const det = payload.detalhes && typeof payload.detalhes === 'object'
        ? JSON.stringify(payload.detalhes)
        : (payload.detalhes || null)
      db.prepare(`INSERT INTO admin_audit_log
        (admin_id, admin_nome, admin_email, acao, alvo_tipo, alvo_id, alvo_nome, detalhes, ip, user_agent)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
          adminSess?.user_id || null,
          adminSess?.nome    || null,
          adminSess?.email   || null,
          String(payload.acao || ''),
          payload.alvo_tipo  || null,
          payload.alvo_id    ? String(payload.alvo_id) : null,
          payload.alvo_nome  || null,
          det,
          ip,
          ua
        )
      marcarDirty()
      return true
    } catch (e) {
      log('⚠️', 'audit log erro:', e.message)
      return false
    }
  }

  // ── POST /api/admin/audit-log — registra ação do admin ───
  if (req.method === 'POST' && upath === '/api/admin/audit-log') {
    const sess = validarSessaoAdmin(req)
    if (!sess) { send(res, 401, { error: 'Não autorizado' }); return true }
    const body = await readBody(req)
    if (!body?.acao) { send(res, 400, { error: 'campo acao obrigatorio' }); return true }
    _registrarAudit(sess, body, req.headers)
    send(res, 200, { ok: true })
    return true
  }

  // ── GET /api/admin/audit-log — lista logs ────────────
  if (req.method === 'GET' && upath === '/api/admin/audit-log') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    try {
      const limit  = Math.min(parseInt(params.get('limit'))  || 200, 1000)
      const offset = Math.max(parseInt(params.get('offset')) || 0, 0)
      const acao   = params.get('acao') || null
      let sql  = 'SELECT * FROM admin_audit_log'
      const ps = []
      if (acao) { sql += ' WHERE acao LIKE ?'; ps.push(acao + '%') }
      sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ps.push(limit, offset)
      const rows = db.prepare(sql).all(...ps)
      // Faz parse do JSON detalhes para o frontend não precisar
      const out = rows.map(r => {
        let det = r.detalhes
        try { det = det ? JSON.parse(det) : {} } catch { /* deixa string */ }
        return { ...r, detalhes: det }
      })
      send(res, 200, out)
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── GET /api/admin/saude/:tenantId — métricas do cliente ─
  if (req.method === 'GET' && /^\/api\/admin\/saude\/[^/]+$/.test(upath)) {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const tid = upath.split('/').pop()
    try {
      const tenant = db.prepare('SELECT * FROM tenants WHERE id=?').get(tid)
      if (!tenant) { send(res, 404, { error: 'Tenant não encontrado' }); return true }

      // Pedidos 30d (apenas finalizados/entregues, ignorando cancelados)
      const pedidos30d = db.prepare(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) + COALESCE(SUM(taxa),0) as fat
        FROM orders
        WHERE tenant_id=?
          AND created_at > datetime('now','-30 days')
          AND status NOT IN ('cancelado','aguardando_pix','aguardando_cartao')
      `).get(tid) || { cnt: 0, fat: 0 }

      // Mensagens IA 30d (heurística: count em wa_messages do bot, se a tabela existir)
      let mensagensIa = 0
      try {
        mensagensIa = db.prepare(`
          SELECT COUNT(*) as cnt FROM wa_messages
          WHERE tenant_id=? AND from_me=1
            AND created_at > datetime('now','-30 days')
        `).get(tid)?.cnt || 0
      } catch { /* tabela pode não existir */ }

      // Último login do gestor (sys_users.ultimo_acesso)
      let ultimoLoginDias = null
      try {
        const u = db.prepare(`
          SELECT MAX(ultimo_acesso) as ult FROM sys_users
          WHERE tenant_id=? AND ativo=1 AND role='gestor'
        `).get(tid)
        if (u?.ult) {
          const dt = new Date(u.ult).getTime()
          if (!isNaN(dt)) ultimoLoginDias = Math.floor((Date.now() - dt) / (24 * 3600 * 1000))
        }
      } catch { /* não-fatal */ }

      // IA configurada?
      let iaAtiva = false
      try {
        const cfg = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id=?").get(tid)
        if (cfg?.ia_config) {
          const ia = JSON.parse(cfg.ia_config)
          iaAtiva = !!(ia.openai_key || ia.ativo)
        }
      } catch { /* não-fatal */ }

      const parseDetalhesAudit = (raw) => {
        try { return raw ? JSON.parse(raw) : {} } catch { return raw || {} }
      }
      const timeline = []
      if (tenant.created_at) {
        timeline.push({
          at: tenant.created_at,
          tipo: 'cliente.criado',
          titulo: 'Cliente cadastrado',
          detalhe: `Plano ${tenant.plano || 'pro'}`,
          origem: 'tenant'
        })
      }
      try {
        const logs = db.prepare(`
          SELECT id, created_at, acao, admin_nome, alvo_tipo, alvo_id, alvo_nome, detalhes
          FROM admin_audit_log
          WHERE alvo_id=? OR detalhes LIKE ?
          ORDER BY created_at DESC
          LIMIT 30
        `).all(tid, `%${tid}%`)
        for (const l of logs) {
          timeline.push({
            at: l.created_at,
            tipo: l.acao || 'admin.acao',
            titulo: l.acao || 'Ação administrativa',
            detalhe: parseDetalhesAudit(l.detalhes),
            admin: l.admin_nome || 'Admin',
            origem: 'audit',
            id: l.id
          })
        }
      } catch { /* não-fatal */ }
      try {
        const faturas = db.prepare(`
          SELECT id, plano, valor, meses, metodo, status, created_at, vence_em, pago_em, cancelado_em
          FROM faturas
          WHERE tenant_id=?
          ORDER BY created_at DESC
          LIMIT 20
        `).all(tid)
        const faturaDetalhe = (f) => ({
          id: f.id,
          plano: f.plano,
          valor: f.valor,
          meses: f.meses,
          metodo: f.metodo,
          status: f.status,
          vence_em: f.vence_em
        })
        for (const f of faturas) {
          if (f.created_at) timeline.push({ at: f.created_at, tipo: 'cobranca.criada', titulo: 'Cobrança gerada', detalhe: faturaDetalhe(f), origem: 'fatura', id: f.id })
          if (f.pago_em) timeline.push({ at: f.pago_em, tipo: 'cobranca.paga', titulo: 'Pagamento confirmado', detalhe: faturaDetalhe(f), origem: 'fatura', id: f.id })
          if (f.cancelado_em) timeline.push({ at: f.cancelado_em, tipo: 'cobranca.cancelada', titulo: 'Cobrança cancelada', detalhe: faturaDetalhe(f), origem: 'fatura', id: f.id })
          if (f.status === 'pendente' && f.vence_em && new Date(f.vence_em).getTime() < Date.now()) {
            timeline.push({ at: f.vence_em, tipo: 'cobranca.vencida', titulo: 'Cobrança vencida', detalhe: faturaDetalhe(f), origem: 'fatura', id: f.id })
          }
        }
      } catch { /* não-fatal */ }
      timeline.sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime())

      send(res, 200, {
        pedidos_30d:     pedidos30d.cnt || 0,
        faturamento_30d: parseFloat(pedidos30d.fat || 0),
        mensagens_ia_30d: mensagensIa,
        ultimo_login_dias: ultimoLoginDias,
        ia_ativa: iaAtiva,
        criado_em: tenant.created_at,
        plano: tenant.plano,
        ativo: !!tenant.ativo,
        expires_at: tenant.expires_at,
        timeline: timeline.slice(0, 20),
      })
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── GET /api/admin/faturamento — lista todas faturas ──
  if (req.method === 'GET' && upath === '/api/admin/faturamento') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    try {
      const rows = db.prepare(`
        SELECT f.*, t.nome as tenant_nome, t.slug as tenant_slug
        FROM faturas f
        LEFT JOIN tenants t ON t.id = f.tenant_id
        ORDER BY f.created_at DESC
        LIMIT 500
      `).all()
      send(res, 200, rows)
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  const ADMIN_FISCAL_LIMITE_PADRAO = 500
  const ADMIN_FISCAL_VALOR_EXCEDENTE_PADRAO = 0.10
  const ADMIN_FISCAL_PLANO_VALOR_PADRAO = 159.90
  function _adminFiscalMesInfo(rawMes) {
    const now = new Date()
    let mes = String(rawMes || '').trim()
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      mes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    }
    const [ano, mesNum] = mes.split('-').map(Number)
    const start = `${ano}-${String(mesNum).padStart(2, '0')}-01`
    const endDate = new Date(Date.UTC(ano, mesNum, 1))
    const end = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, '0')}-01`
    return { mes, start, end }
  }
  function _adminFiscalNum(value, fallback) {
    const n = parseFloat(String(value ?? '').replace(',', '.'))
    return Number.isFinite(n) ? n : fallback
  }
  function _adminFiscalMoney(value) {
    return Math.round((parseFloat(value) || 0) * 100) / 100
  }
  function _adminFiscalUso(opts = {}) {
    const mesInfo = _adminFiscalMesInfo(opts.mes)
    const limite = Math.max(0, parseInt(opts.limite ?? ADMIN_FISCAL_LIMITE_PADRAO, 10) || ADMIN_FISCAL_LIMITE_PADRAO)
    const valorExcedente = Math.max(0, _adminFiscalNum(opts.valor_excedente, ADMIN_FISCAL_VALOR_EXCEDENTE_PADRAO))
    const planoValor = Math.max(0, _adminFiscalNum(opts.plano_valor, ADMIN_FISCAL_PLANO_VALOR_PADRAO))
    const rawRows = db.prepare(`
      SELECT
        t.id, t.nome, t.slug, t.plano, t.ativo, t.expires_at,
        COALESCE(fc.enabled, 0) AS fiscal_enabled,
        COUNT(n.id) AS notas_usadas,
        COALESCE(SUM(n.total), 0) AS valor_notas
      FROM tenants t
      LEFT JOIN fiscal_config fc ON fc.tenant_id = t.id
      LEFT JOIN fiscal_nfce n ON n.tenant_id = t.id
        AND lower(COALESCE(n.status, '')) IN ('autorizado','autorizada','cancelado','cancelada')
        AND date(COALESCE(n.emitted_at, n.created_at)) >= date(?)
        AND date(COALESCE(n.emitted_at, n.created_at)) < date(?)
      WHERE COALESCE(t.slug, '') NOT IN ('_admin','_global','admin','system')
        AND COALESCE(t.id, '') NOT IN ('_admin','_global','admin','system')
      GROUP BY t.id
      ORDER BY notas_usadas DESC, t.nome COLLATE NOCASE ASC
    `).all(mesInfo.start, mesInfo.end)
    const faturas = db.prepare(`
      SELECT id, tenant_id, valor, status, link_pagamento, vence_em, created_at, obs
      FROM faturas
      WHERE plano='fiscal'
        AND COALESCE(status, '') <> 'cancelado'
        AND COALESCE(obs, '') LIKE ?
      ORDER BY id DESC
    `).all(`%NFC-e ${mesInfo.mes}%`)
    const faturaPorTenant = new Map()
    for (const f of faturas) {
      if (!faturaPorTenant.has(f.tenant_id)) faturaPorTenant.set(f.tenant_id, f)
    }
    let rows = rawRows.map(t => {
      const notasUsadas = parseInt(t.notas_usadas || 0, 10) || 0
      const excedente = Math.max(0, notasUsadas - limite)
      const valorExtra = _adminFiscalMoney(excedente * valorExcedente)
      const fiscalAtivo = t.plano === 'fiscal' || !!t.fiscal_enabled || notasUsadas > 0
      const valorTotal = fiscalAtivo ? _adminFiscalMoney(planoValor + valorExtra) : valorExtra
      const fatura = faturaPorTenant.get(t.id) || null
      return {
        tenant_id: t.id,
        nome: t.nome,
        slug: t.slug,
        plano: t.plano,
        ativo: !!t.ativo,
        fiscal_enabled: !!t.fiscal_enabled,
        fiscal_ativo: fiscalAtivo,
        notas_usadas: notasUsadas,
        valor_notas: _adminFiscalMoney(t.valor_notas),
        limite,
        excedente,
        valor_excedente: valorExcedente,
        valor_extra: valorExtra,
        plano_valor: fiscalAtivo ? planoValor : 0,
        valor_total: valorTotal,
        fatura_id: fatura?.id || null,
        fatura_status: fatura?.status || null,
        fatura_valor: fatura ? _adminFiscalMoney(fatura.valor) : null,
        fatura_link: fatura?.link_pagamento || null,
        fatura_vence_em: fatura?.vence_em || null
      }
    }).filter(r => r.fiscal_ativo || opts.incluir_todos)
    if (opts.tenant_id) rows = rows.filter(r => r.tenant_id === opts.tenant_id)
    const sum = (key) => rows.reduce((s, r) => s + (parseFloat(r[key]) || 0), 0)
    return {
      mes: mesInfo.mes,
      inicio: mesInfo.start,
      fim: mesInfo.end,
      limite,
      valor_excedente: valorExcedente,
      plano_valor: planoValor,
      total_clientes: rows.length,
      total_notas: sum('notas_usadas'),
      total_excedente: sum('excedente'),
      total_extra: _adminFiscalMoney(sum('valor_extra')),
      total_cobrar: _adminFiscalMoney(sum('valor_total')),
      rows
    }
  }

  if (req.method === 'GET' && upath === '/api/admin/fiscal-nfce/uso') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Nao autorizado' }); return true }
    try {
      const data = _adminFiscalUso({
        mes: params.get('mes'),
        limite: params.get('limite'),
        valor_excedente: params.get('valor_excedente'),
        plano_valor: params.get('plano_valor'),
        incluir_todos: params.get('todos') === '1'
      })
      send(res, 200, data)
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Helper: gera cobrança PIX no Mercado Pago e retorna { fatura, link } ──
  async function _gerarCobrancaMP(tenant, opts) {
    const { plano, valor, meses, metodo, obs } = opts
    const _valorMpG = _mpValor(valor)
    if (_valorMpG === null) throw new Error('Valor da cobrança inválido')

    // Token MP — SEMPRE GLOBAL (faturamento SaaS da plataforma)
    const mpToken = _resolveMpGlobal(db, MP_TOKEN)
    if (!mpToken) throw new Error('Token Mercado Pago não configurado em /admin → Saques PIX')

    const extRef = `fatura-${tenant.id.slice(0, 8)}-${plano}-${Date.now()}`
    // vence_em salvo na fatura = vencimento REAL do plano do cliente, não a
    // validade técnica do Pix (usada só no date_of_expiration abaixo, pro
    // Mercado Pago — são coisas diferentes). Sem isso, tanto essa mensagem
    // quanto a consulta "fatura em aberto" pelo bot mostravam uma data
    // errada, sempre 7 dias à frente da data real de corte do acesso.
    const venceEm = tenant.expires_at || new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const descricao = `Plano ${_planoSaasLabel(plano)} — ${meses} ${meses === 1 ? 'mês' : 'meses'} — ${tenant.nome}`

    let mpData = null, qrCode = null, qrCodeBase64 = null, linkPagamento = null

    if (metodo === 'pix') {
      // Cria pagamento PIX direto
      const mpResp = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${mpToken}`, 'X-Idempotency-Key': extRef },
        body: JSON.stringify({
          transaction_amount: _valorMpG,
          description: descricao,
          payment_method_id: 'pix',
          external_reference: extRef,
          date_of_expiration: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().replace('Z', '-03:00'),
          payer: { email: 'cobranca@estimafood.com', first_name: tenant.nome.split(' ')[0] || 'Cliente' }
        })
      })
      mpData = await mpResp.json()
      if (!mpResp.ok) throw new Error(mpData.message || 'Falha ao criar PIX no Mercado Pago')
      qrCode       = mpData.point_of_interaction?.transaction_data?.qr_code || null
      qrCodeBase64 = mpData.point_of_interaction?.transaction_data?.qr_code_base64 || null
      // Link de pagamento (ticket_url para ver QR no MP, ou nosso próprio link)
      linkPagamento = mpData.point_of_interaction?.transaction_data?.ticket_url || null
    } else {
      // Cartão de crédito: cria preference (link de checkout)
      const prefResp = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${mpToken}` },
        body: JSON.stringify({
          items: [{ title: descricao, quantity: 1, unit_price: _valorMpG, currency_id: 'BRL' }],
          external_reference: extRef,
          payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }], installments: 12 },
          expires: true,
          expiration_date_to: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          metadata: { tenant_id: tenant.id, plano, meses }
        })
      })
      mpData = await prefResp.json()
      if (!prefResp.ok) throw new Error(mpData.message || 'Falha ao criar preferência no Mercado Pago')
      linkPagamento = mpData.init_point || mpData.sandbox_init_point || null
    }

    // Salva fatura
    const info = db.prepare(`INSERT INTO faturas
      (tenant_id, plano, valor, meses, metodo, status, link_pagamento, mp_payment_id, mp_external_ref, qr_code, qr_code_base64, vence_em, obs)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        tenant.id, plano, parseFloat(valor), parseInt(meses) || 1, metodo, 'pendente',
        linkPagamento, mpData.id ? String(mpData.id) : null, extRef,
        qrCode, qrCodeBase64, venceEm, obs || null
      )
    marcarDirty()
    const fatura = db.prepare('SELECT * FROM faturas WHERE id=?').get(info.lastInsertRowid)
    return { fatura, link: linkPagamento, qr_code: qrCode }
  }

  // ── Helper: envia link de pagamento por WhatsApp pro gestor ──
  async function _enviarCobrancaWA(tenant, fatura) {
    try {
      const gestor = db.prepare(`
        SELECT nome, email FROM sys_users
        WHERE tenant_id=? AND role='gestor' AND ativo=1
        ORDER BY created_at ASC LIMIT 1
      `).get(tenant.id)

      // Tenta achar telefone: prioriza telefone_cobranca cadastrado no super admin;
      // se não houver, cai pro WhatsApp da loja (store_config) — mesma prioridade
      // usada pelo job de auto-cobrança e pela confirmação de pagamento.
      let telefone = tenant.telefone_cobranca ? String(tenant.telefone_cobranca).replace(/\D/g, '') : null
      if (!telefone) {
        try {
          const cfg = db.prepare('SELECT store_whatsapp FROM store_config WHERE tenant_id=?').get(tenant.id)
          if (cfg?.store_whatsapp) telefone = String(cfg.store_whatsapp).replace(/\D/g, '')
        } catch {}
      }
      if (!telefone) {
        log('⚠️', `Cobrança WA: tenant ${tenant.nome} sem telefone — link gerado mas não enviado`)
        return { enviado: false, motivo: 'telefone_nao_configurado' }
      }
      // Garante DDI 55
      if (telefone.length === 11 || telefone.length === 10) telefone = '55' + telefone

      const valorTxt = parseFloat(fatura.valor).toFixed(2).replace('.', ',')
      const planoNome = _planoSaasLabel(fatura.plano)
      // fatura.vence_em já é o vencimento real do plano (corrigido na
      // geração, em _gerarCobrancaMP) — só formata com o truque de
      // T00:00:00 pra não deslocar o dia por fuso horário.
      const venceEmTxt = fatura.vence_em
        ? new Date(fatura.vence_em + 'T00:00:00').toLocaleDateString('pt-BR')
        : '7 dias'

      const linhas = [
        `🧾 *Cobrança — Plano ${planoNome}*`,
        ``,
        `Olá ${(gestor?.nome || tenant.nome).split(' ')[0]}! 👋`,
        ``,
        `Sua mensalidade do *${_brandNome(tenant.segmento)}* está disponível para pagamento:`,
        ``,
        `💰 *Valor:* R$ ${valorTxt}`,
        `📅 *Período:* ${fatura.meses} ${fatura.meses === 1 ? 'mês' : 'meses'}`,
        `⏰ *Vence em:* ${venceEmTxt}`,
        ``,
        fatura.metodo === 'pix' ? `💸 *Pague agora via PIX:*` : `💳 *Pague com cartão:*`,
        fatura.link_pagamento || '(link indisponível)',
        ``,
        `_Após o pagamento, seu acesso é renovado automaticamente._ ✅`,
        `_Dúvidas? É só responder esta mensagem._`
      ]
      const msg = linhas.join('\n')

      const instCob = _getInstanciaCobranca(db, EVO_INST)
      const r = await sendWA(telefone, msg, instCob)
      if (!r.ok) {
        const motivo = r.data?.message || r.data?.error || r.error || 'Evolution API recusou o envio'
        log('⚠️', `Cobrança WA FALHOU: tenant=${tenant.nome} fatura=${fatura.id} tel=${telefone} (instância: ${instCob}) — ${motivo}`)
        return { enviado: false, telefone, instance: instCob, motivo }
      }
      log('📨', `Cobrança WA enviada: tenant=${tenant.nome} fatura=${fatura.id} tel=${telefone} (instância: ${instCob})`)
      return { enviado: true, telefone, instance: instCob }
    } catch (e) {
      log('⚠️', 'Cobrança WA erro:', e.message)
      return { enviado: false, motivo: e.message }
    }
  }

  if (req.method === 'POST' && upath === '/api/admin/fiscal-nfce/gerar-cobranca') {
    const sess = validarSessaoAdmin(req)
    if (!sess) { send(res, 401, { error: 'Nao autorizado' }); return true }
    const body = await readBody(req)
    const tenantId = String(body?.tenant_id || '').trim()
    if (!tenantId) { send(res, 400, { error: 'tenant_id obrigatorio' }); return true }
    try {
      const tenant = db.prepare('SELECT * FROM tenants WHERE id=?').get(tenantId)
      if (!tenant) { send(res, 404, { error: 'Tenant nao encontrado' }); return true }
      const uso = _adminFiscalUso({
        tenant_id: tenantId,
        mes: body?.mes,
        limite: body?.limite,
        valor_excedente: body?.valor_excedente,
        plano_valor: body?.plano_valor,
        incluir_todos: true
      })
      const row = uso.rows[0]
      if (!row || !row.valor_total) { send(res, 400, { error: 'Sem valor fiscal para cobrar neste mes' }); return true }
      if (row.fatura_id && row.fatura_status === 'pago') {
        send(res, 409, { error: 'A cobranca fiscal deste mes ja foi paga', row })
        return true
      }
      if (row.fatura_id && !body?.force) {
        send(res, 409, { error: 'Ja existe cobranca fiscal para este cliente neste mes', row })
        return true
      }
      const faturaSubstituidaId = row.fatura_id || null
      const obs = _adminFiscalObs(uso, row, faturaSubstituidaId ? `Substitui fatura #${faturaSubstituidaId}` : 'Cobranca fiscal')
      const result = await _gerarCobrancaMP(tenant, {
        plano: 'fiscal',
        valor: row.valor_total,
        meses: 1,
        metodo: body?.metodo === 'cartao' ? 'cartao' : 'pix',
        obs
      })
      if (faturaSubstituidaId) {
        db.prepare(`UPDATE faturas
          SET status='cancelado',
              cancelado_em=datetime('now'),
              obs=TRIM(COALESCE(obs, '') || ' | substituida_por=' || ?)
          WHERE id=? AND status<>'pago'`).run(String(result.fatura.id), faturaSubstituidaId)
      }
      result.fatura.obs = obs
      marcarDirty()
      const wa = await _enviarCobrancaWA(tenant, result.fatura)
      _registrarAudit(sess, {
        acao: 'cobranca.fiscal_nfce',
        alvo_tipo: 'tenant', alvo_id: tenantId, alvo_nome: tenant.nome,
        detalhes: {
          mes: uso.mes,
          fatura_id: result.fatura.id,
          notas_usadas: row.notas_usadas,
          limite: row.limite,
          excedente: row.excedente,
          valor_extra: row.valor_extra,
          valor_total: row.valor_total,
          fatura_substituida_id: faturaSubstituidaId,
          wa_enviado: wa.enviado
        }
      }, req.headers)
      send(res, 200, { ok: true, fatura: result.fatura, link: result.link, wa, uso: row })
    } catch(e) {
      log('❌', 'Cobrança fiscal NFC-e erro:', e.message)
      send(res, 500, { error: e.message })
    }
    return true
  }

  // ── POST /api/admin/cobranca/gerar — gera 1 cobrança e envia ──
  if (req.method === 'POST' && upath === '/api/admin/cobranca/gerar') {
    const sess = validarSessaoAdmin(req)
    if (!sess) { send(res, 401, { error: 'Não autorizado' }); return true }
    const body = await readBody(req)
    const { tenant_id, plano, valor, meses, metodo } = body || {}
    if (!tenant_id || !plano || !valor) { send(res, 400, { error: 'tenant_id, plano e valor obrigatórios' }); return true }
    try {
      const tenant = db.prepare('SELECT * FROM tenants WHERE id=?').get(tenant_id)
      const planoFinal = ['essencial', 'premium', 'pro', 'fiscal'].includes(plano) ? plano : 'essencial'
      const mesesFinal = parseInt(meses) || 1
      let valorFinal = parseFloat(valor)
      let obsFiscal = null
      let fiscalRow = null
      if (planoFinal === 'fiscal') {
        const fiscal = _adminFiscalCobrancaAtual(db, tenant_id, {
          mes: body?.mes || _adminFiscalMesAtual(),
          plano_valor: _adminFiscalMoney(valorFinal * mesesFinal),
          prefix: 'Renovacao fiscal'
        })
        if (fiscal.row) {
          fiscalRow = fiscal.row
          valorFinal = fiscal.valor
          obsFiscal = fiscal.obs
        }
      }
      if (!tenant) { send(res, 404, { error: 'Tenant não encontrado' }); return true }
      const result = await _gerarCobrancaMP(tenant, {
        plano: planoFinal,
        valor: valorFinal,
        meses: mesesFinal,
        metodo: metodo === 'cartao' ? 'cartao' : 'pix',
        obs: obsFiscal
      })
      const wa = await _enviarCobrancaWA(tenant, result.fatura)
      _registrarAudit(sess, {
        acao: 'cobranca.gerar',
        alvo_tipo: 'tenant', alvo_id: tenant_id, alvo_nome: tenant.nome,
        detalhes: { fatura_id: result.fatura.id, valor: result.fatura.valor, plano: planoFinal, meses: mesesFinal, metodo, fiscal: fiscalRow, wa_enviado: wa.enviado }
      }, req.headers)
      send(res, 200, { ok: true, fatura: result.fatura, link: result.link, wa })
    } catch(e) {
      log('❌', 'Cobrança gerar erro:', e.message)
      send(res, 500, { error: e.message })
    }
    return true
  }

  // ── POST /api/admin/cobranca/em-massa — várias cobranças ──
  if (req.method === 'POST' && upath === '/api/admin/cobranca/em-massa') {
    const sess = validarSessaoAdmin(req)
    if (!sess) { send(res, 401, { error: 'Não autorizado' }); return true }
    const body = await readBody(req)
    const ids = Array.isArray(body?.tenant_ids) ? body.tenant_ids : []
    if (!ids.length) { send(res, 400, { error: 'tenant_ids obrigatório (array)' }); return true }
    _expirarPromocoesVencidas(db, log)
    // Lê preços dos planos
    let precoEss = 79.99, precoPre = 99.90, precoFiscal = 159.90, precoAddonVoz = 89.90
    try {
      const c = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
      const g = c?.ia_config ? JSON.parse(c.ia_config) : {}
      if (g.preco_essencial !== undefined) precoEss = parseFloat(g.preco_essencial)
      if (g.preco_premium   !== undefined) precoPre = parseFloat(g.preco_premium)
      if (g.preco_addon_voz !== undefined) precoAddonVoz = parseFloat(g.preco_addon_voz)
    } catch {}

    let enviadas = 0, falhas = 0
    const erros = []
    for (const id of ids) {
      try {
        const tenant = db.prepare('SELECT * FROM tenants WHERE id=?').get(id)
        if (!tenant) { falhas++; erros.push({ id, erro: 'tenant não encontrado' }); continue }
        const plano = (tenant.plano === 'premium') ? 'premium' : (tenant.plano === 'fiscal' ? 'fiscal' : 'essencial')
        let valor = (plano === 'premium') ? precoPre : (plano === 'fiscal' ? precoFiscal : precoEss)
        // Preço individual do tenant (promoção/desconto) tem prioridade sobre o preço do plano
        if (plano !== 'fiscal' && tenant.valor_mensalidade !== null && tenant.valor_mensalidade !== undefined) {
          valor = parseFloat(tenant.valor_mensalidade)
        }
        // Add-on de pedido por voz (WhatsApp) — soma ao valor quando ativado pelo admin
        if (tenant.voz_ativo) valor += precoAddonVoz
        let obsFiscal = null
        if (plano === 'fiscal') {
          const fiscal = _adminFiscalCobrancaAtual(db, tenant.id, {
            mes: body?.mes || _adminFiscalMesAtual(),
            plano_valor: precoFiscal,
            prefix: 'Cobranca em massa fiscal'
          })
          if (fiscal.row) {
            valor = fiscal.valor
            obsFiscal = fiscal.obs
          }
        }
        const result = await _gerarCobrancaMP(tenant, { plano, valor, meses: 1, metodo: 'pix', obs: obsFiscal })
        await _enviarCobrancaWA(tenant, result.fatura)
        enviadas++
      } catch(e) {
        falhas++
        erros.push({ id, erro: e.message })
        log('⚠️', `Cobrança massa falhou tenant=${id}:`, e.message)
      }
    }
    _registrarAudit(sess, {
      acao: 'cobranca.em_massa',
      alvo_tipo: null, alvo_id: null, alvo_nome: null,
      detalhes: { total: ids.length, enviadas, falhas, erros }
    }, req.headers)
    send(res, 200, { ok: true, enviadas, falhas, erros })
    return true
  }

  // ── POST /api/admin/cobranca/reenviar — reenvia link via WA ──
  if (req.method === 'POST' && upath === '/api/admin/cobranca/reenviar') {
    const sess = validarSessaoAdmin(req)
    if (!sess) { send(res, 401, { error: 'Não autorizado' }); return true }
    const body = await readBody(req)
    if (!body?.id) { send(res, 400, { error: 'id obrigatório' }); return true }
    try {
      const f = db.prepare('SELECT * FROM faturas WHERE id=?').get(body.id)
      if (!f) { send(res, 404, { error: 'Fatura não encontrada' }); return true }
      if (f.status === 'pago') { send(res, 400, { error: 'Fatura já paga' }); return true }
      if (f.status === 'cancelado') { send(res, 400, { error: 'Fatura cancelada' }); return true }
      const t = db.prepare('SELECT * FROM tenants WHERE id=?').get(f.tenant_id)
      if (!t) { send(res, 404, { error: 'Tenant não encontrado' }); return true }
      const wa = await _enviarCobrancaWA(t, f)
      _registrarAudit(sess, {
        acao: 'cobranca.reenviar',
        alvo_tipo: 'tenant', alvo_id: t.id, alvo_nome: t.nome,
        detalhes: { fatura_id: f.id, wa_enviado: wa.enviado }
      }, req.headers)
      send(res, 200, { ok: true, wa })
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── POST /api/admin/cobranca/cancelar ────────────────
  if (req.method === 'POST' && upath === '/api/admin/cobranca/cancelar') {
    const sess = validarSessaoAdmin(req)
    if (!sess) { send(res, 401, { error: 'Não autorizado' }); return true }
    const body = await readBody(req)
    if (!body?.id) { send(res, 400, { error: 'id obrigatório' }); return true }
    try {
      const f = db.prepare('SELECT * FROM faturas WHERE id=?').get(body.id)
      if (!f) { send(res, 404, { error: 'Fatura não encontrada' }); return true }
      if (f.status === 'pago') { send(res, 400, { error: 'Fatura já paga, não pode cancelar' }); return true }
      db.prepare("UPDATE faturas SET status='cancelado', cancelado_em=datetime('now') WHERE id=?").run(body.id)
      marcarDirty()
      _registrarAudit(sess, {
        acao: 'cobranca.cancelar',
        alvo_tipo: 'fatura', alvo_id: String(body.id), alvo_nome: `Fatura #${body.id}`,
        detalhes: { tenant_id: f.tenant_id, valor: f.valor }
      }, req.headers)
      send(res, 200, { ok: true })
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── GET /api/admin/cobranca-wa — lê instância configurada ──
  if (req.method === 'GET' && upath === '/api/admin/cobranca-wa') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    try {
      const c = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
      const g = c?.ia_config ? JSON.parse(c.ia_config) : {}
      send(res, 200, { instance: g.cobranca_wa_instance || '', atendente_whatsapp: g.cobranca_atendente_whatsapp || '' })
    } catch(e) { send(res, 200, { instance: '', atendente_whatsapp: '' }) }
    return true
  }

  // ── POST /api/admin/cobranca-wa — salva instância ──
  if (req.method === 'POST' && upath === '/api/admin/cobranca-wa') {
    const sess = validarSessaoAdmin(req)
    if (!sess) { send(res, 401, { error: 'Não autorizado' }); return true }
    const body = await readBody(req)
    let instance = (body?.instance || '').trim()
    // Validação: só letras/números/-/_
    if (instance && !/^[a-zA-Z0-9_-]+$/.test(instance)) {
      send(res, 400, { error: 'Nome da instância inválido (use apenas letras, números, - e _)' })
      return true
    }
    const atendenteRaw = String(body?.atendente_whatsapp || '').replace(/\D/g, '')
    if (atendenteRaw && atendenteRaw.length !== 10 && atendenteRaw.length !== 11) {
      send(res, 400, { error: 'WhatsApp do atendente inválido (use DDD + número)' })
      return true
    }
    try {
      const c = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
      const g = c?.ia_config ? JSON.parse(c.ia_config) : {}
      g.cobranca_wa_instance = instance || null
      g.cobranca_atendente_whatsapp = atendenteRaw || null
      db.prepare("INSERT INTO store_config (tenant_id, ia_config) VALUES ('_global', ?) ON CONFLICT(tenant_id) DO UPDATE SET ia_config=excluded.ia_config")
        .run(JSON.stringify(g))
      marcarDirty()
      _registrarAudit(sess, {
        acao: 'config.cobranca_wa',
        alvo_tipo: null, alvo_id: null, alvo_nome: null,
        detalhes: { instance: instance || null, atendente_whatsapp: atendenteRaw || null }
      }, req.headers)
      send(res, 200, { ok: true, instance: instance || null, atendente_whatsapp: atendenteRaw || null })
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Proxy Evolution API para o super admin (/api/admin/evo/*) ──
  // Usado pra criar/conectar a instância dedicada de cobranças direto do
  // painel, sem precisar entrar no painel da Evolution API manualmente.
  if (upath.startsWith('/api/admin/evo')) {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const body   = ['POST', 'DELETE'].includes(req.method) ? await readBody(req) : {}
    const action = upath.replace('/api/admin/evo', '')
    try {
      const r    = await fetch(`${EVO_URL}${action}`, { method: req.method, headers: { 'Content-Type': 'application/json', apikey: EVO_KEY }, body: req.method !== 'GET' ? JSON.stringify(body) : undefined })
      const data = await r.json().catch(() => ({}))
      // Ao criar a instância com sucesso, já salva como instância de cobranças
      if (action.startsWith('/instance/create') && r.ok && body.instanceName) {
        const c = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
        const g = c?.ia_config ? JSON.parse(c.ia_config) : {}
        g.cobranca_wa_instance = body.instanceName
        db.prepare("INSERT INTO store_config (tenant_id, ia_config) VALUES ('_global', ?) ON CONFLICT(tenant_id) DO UPDATE SET ia_config=excluded.ia_config")
          .run(JSON.stringify(g))
        marcarDirty()
      }
      send(res, r.status, data)
    } catch (e) { send(res, 500, { error: e.message }) }
    return true
  }

  return false // nenhuma rota tratada aqui — passa para o REST engine
}

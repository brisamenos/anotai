// ═══════════════════════════════════════════════════════
// SUPORTE-VENDAS-BOT.JS — WhatsApp de Suporte, Vendas e Cobranças do super admin
// ═══════════════════════════════════════════════════════
// - Canal de envio unico para tudo que sai do numero do admin (robo, lembretes
//   de mensalidade, confirmacao de pagamento, cobranca manual):
//     * WuzAPI (recomendado): listas, botoes e imagem do QR Pix
//     * Evolution API (antigo): texto; listas/botoes viram texto numerado
// - Robo de atendimento com menu em lista: Vendas / Suporte / Financeiro.
// Configurado em /admin → Saques PIX → "WhatsApp de Suporte e Vendas".
// ═══════════════════════════════════════════════════════
'use strict'

const crypto = require('crypto')
const wuzapi = require('./wuzapi')

let D = null // dependencias injetadas pelo routes.js (db, log, sendWA, ...)

function init(deps) {
  D = deps
}

// ==================== Config global (_global.ia_config) ====================

function cfg() {
  try {
    const c = D.db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
    return c?.ia_config ? JSON.parse(c.ia_config) : {}
  } catch { return {} }
}

function saveCfg(patch) {
  const g = { ...cfg(), ...patch }
  D.db.prepare("INSERT INTO store_config (tenant_id, ia_config) VALUES ('_global', ?) ON CONFLICT(tenant_id) DO UPDATE SET ia_config=excluded.ia_config")
    .run(JSON.stringify(g))
  D.marcarDirty?.()
  return g
}

function provider() {
  const g = cfg()
  return g.cobranca_provider === 'wuzapi' && g.wuzapi_user_token ? 'wuzapi' : 'evolution'
}

function wuzToken() {
  return cfg().wuzapi_user_token || null
}

function atendenteWa() {
  return String(cfg().cobranca_atendente_whatsapp || '').replace(/\D/g, '') || null
}

function webhookSecret() {
  let s = cfg().wuzapi_webhook_secret
  if (!s) {
    s = crypto.randomBytes(16).toString('hex')
    saveCfg({ wuzapi_webhook_secret: s })
  }
  return s
}

// ==================== Canal de envio ====================

function num55(phone) {
  const n = String(phone || '').replace(/\D/g, '')
  if (!n) return ''
  return n.startsWith('55') ? n : `55${n}`
}

// IDs enviados pelo proprio sistema (para saber quando foi o admin respondendo na mao)
const sentIds = new Map()
function rememberSent(id) {
  if (!id) return
  sentIds.set(id, Date.now())
  if (sentIds.size > 5000) {
    const limit = Date.now() - 6 * 3600 * 1000
    for (const [k, t] of sentIds) if (t < limit) sentIds.delete(k)
  }
}

// Contatos que chegam com LID (id interno do WhatsApp): guarda para reenviar se o telefone falhar
const altLid = new Map()
function rememberLid(phone, lid) {
  if (phone && lid && String(lid).endsWith('@lid')) altLid.set(num55(phone), lid)
}

// numeros com/sem o 9 depois do DDD — mesma logica ja usada em tenant-wa.js
function phoneVariants(n) {
  const list = [n]
  if (n.startsWith('55') && n.length === 13 && n[4] === '9') list.push(n.slice(0, 4) + n.slice(5))
  if (n.startsWith('55') && n.length === 12 && /[6-9]/.test(n[4])) list.push(n.slice(0, 4) + '9' + n.slice(4))
  return list
}
// Resolucao ativa via /user/check quando o envio falha com "no LID found" — cobre a
// cobranca automatica, que costuma ser o PRIMEIRO contato com aquele numero (o robo
// nunca recebeu mensagem dele antes pra aprender o LID sozinho via webhook, e por
// isso so tinha o telefone puro, que a WuzAPI as vezes recusa nesse caso).
const _resolved = new Map()

async function wuzSend(phone, fn) {
  const token = wuzToken()
  const to = num55(phone)
  const cached = altLid.get(to) || _resolved.get(to)?.to
  try {
    return await fn(token, cached || to)
  } catch (err) {
    if (!/no LID found|not (registered|on whatsapp)|not found|invalid/i.test(err.message || '')) throw err
    const users = await wuzapi.checkUsers(token, phoneVariants(to)).catch(() => [])
    const found = users.find(u => u.IsInWhatsapp || u.isInWhatsapp)
    if (!found) throw err
    const resolved = String(found.JID || found.jid || found.Query).split('@')[0]
    _resolved.set(to, { to: resolved, at: Date.now() })
    return fn(token, resolved)
  }
}

// Mesma forma de retorno do sendWA antigo: { ok, data?, error? }
async function sendText(phone, text, delayMs) {
  if (provider() === 'wuzapi') {
    try {
      await wuzapi.sendPresence(wuzToken(), num55(phone)).catch(() => {})
      if (delayMs) await new Promise(r => setTimeout(r, Math.min(delayMs, 2500)))
      const id = await wuzSend(phone, (t, to) => wuzapi.sendText(t, to, text))
      rememberSent(id)
      return { ok: true, data: { id } }
    } catch (e) {
      D.log?.('⚠️', `WuzAPI sendText falhou (${phone}): ${e.message}`)
      // Reserva: se existe instancia Evolution dedicada a cobrancas, tenta por ela
      if (cfg().cobranca_wa_instance) {
        const r = await D.sendWA(phone, text, cfg().cobranca_wa_instance, delayMs).catch(() => null)
        if (r?.ok) return r
      }
      return { ok: false, error: `WuzAPI: ${e.message}`, data: { message: `WuzAPI: ${e.message}` } }
    }
  }
  return D.sendWA(phone, text, D.getInstanciaCobranca(), delayMs)
}

async function sendImage(phone, imageBase64, caption) {
  if (provider() === 'wuzapi') {
    const raw = String(imageBase64 || '')
    const dataUrl = raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`
    try {
      const id = await wuzSend(phone, (t, to) => wuzapi.sendImage(t, to, dataUrl, caption))
      rememberSent(id)
      return { ok: true, data: { id } }
    } catch (e) {
      D.log?.('⚠️', `WuzAPI sendImage falhou (${phone}): ${e.message}`)
      return { ok: false, error: e.message }
    }
  }
  return D.sendWAImage(phone, imageBase64, caption, D.getInstanciaCobranca())
}

// Ultimas opcoes mandadas em texto numerado (Evolution ou erro no envio interativo)
const numbered = new Map() // phone -> { options: [{id,title}], at }
function numberedText(text, options) {
  return `${text}\n\n${options.map((o, i) => `*${i + 1}.* ${o.title}`).join('\n')}\n\n_Responda com o número da opção._`
}

async function sendButtons(phone, text, buttons, footer) {
  const opts = buttons.slice(0, 3)
  if (provider() === 'wuzapi') {
    try {
      const id = await wuzSend(phone, (t, to) => wuzapi.sendButtons(t, to, {
        text, footer: footer || 'Estima Food', buttons: opts.map(b => ({ id: b.id, text: b.title }))
      }))
      rememberSent(id)
      return
    } catch (e) {
      D.log?.('⚠️', `WuzAPI botões falharam, enviando texto: ${e.message}`)
    }
  }
  numbered.set(num55(phone), { options: opts, at: Date.now() })
  await sendText(phone, numberedText(text, opts))
}

async function sendList(phone, text, buttonText, sections, footer) {
  const all = sections.flatMap(s => s.rows).slice(0, 10)
  if (provider() === 'wuzapi') {
    try {
      const id = await wuzSend(phone, (t, to) => wuzapi.sendList(t, to, {
        title: 'Estima Food',
        text,
        footer: footer || 'Estima Food',
        buttonText,
        sections: sections.map(s => ({ title: s.title, rows: s.rows.map(r => ({ id: r.id, title: r.title, description: r.description })) }))
      }))
      rememberSent(id)
      return
    } catch (e) {
      D.log?.('⚠️', `WuzAPI lista falhou, enviando texto: ${e.message}`)
    }
  }
  numbered.set(num55(phone), { options: all, at: Date.now() })
  await sendText(phone, numberedText(text, all))
}

// ==================== Conexao da WuzAPI (painel admin) ====================

const USER_NAME = 'estimafood-suporte'

async function status() {
  const g = cfg()
  let state = 'disconnected'
  if (g.wuzapi_user_token) {
    try { state = await wuzapi.getStatus(g.wuzapi_user_token) } catch (e) { state = 'erro: ' + e.message }
  }
  return {
    wuzapi_configured: wuzapi.isConfigured(),
    provider: g.cobranca_provider === 'wuzapi' ? 'wuzapi' : 'evolution',
    has_user: !!g.wuzapi_user_token,
    status: state,
    demo_link: g.bot_demo_link || '',
    atendente_whatsapp: g.cobranca_atendente_whatsapp || '',
    pix_chave: g.cobranca_pix_chave || '',
    pix_nome: g.cobranca_pix_nome || ''
  }
}

async function connect(baseUrl) {
  if (!wuzapi.isConfigured()) throw new Error('WuzAPI não configurada (WUZAPI_URL / WUZAPI_ADMIN_TOKEN)')
  let g = cfg()
  if (!g.wuzapi_user_token) {
    const created = await wuzapi.createUser(USER_NAME)
    g = saveCfg({ wuzapi_user_token: created.token, wuzapi_user_id: created.id })
  }
  const webhook = `${String(baseUrl).replace(/\/$/, '')}/webhook/cobranca-wuz/${webhookSecret()}`
  await wuzapi.connect(g.wuzapi_user_token, webhook)

  // Espera o QR (ou perceber que ja esta pareado)
  const started = Date.now()
  while (Date.now() - started < 20000) {
    await new Promise(r => setTimeout(r, 1500))
    try {
      if (await wuzapi.getStatus(g.wuzapi_user_token) === 'connected') return { status: 'connected', qr: null }
    } catch {}
    try {
      const qr = await wuzapi.getQr(g.wuzapi_user_token)
      if (qr) return { status: 'connecting', qr }
    } catch (e) {
      if (/logged in/i.test(e.message)) return { status: 'connected', qr: null }
    }
  }
  throw new Error('A WuzAPI não gerou o QR Code. Tente de novo em alguns segundos.')
}

async function currentQr() {
  const token = wuzToken() || cfg().wuzapi_user_token
  if (!token) return { status: 'disconnected', qr: null }
  let st = 'disconnected'
  try { st = await wuzapi.getStatus(token) } catch {}
  if (st === 'connected') return { status: st, qr: null }
  const qr = await wuzapi.getQr(token).catch(() => null)
  return { status: st, qr }
}

async function disconnect() {
  const token = cfg().wuzapi_user_token
  if (token) await wuzapi.logout(token).catch(() => {})
}

function webhookSecretMatches(secret) {
  const s = cfg().wuzapi_webhook_secret || ''
  return !!s && String(secret || '').length === s.length &&
    crypto.timingSafeEqual(Buffer.from(String(secret)), Buffer.from(s))
}

// ==================== Normalizacao das mensagens recebidas ====================

function phoneFromJid(jid) {
  const s = String(jid || '')
  if (!s.endsWith('@s.whatsapp.net') && !s.endsWith('@c.us')) return null
  return s.split('@')[0].split(':')[0]
}

function choiceFrom(message) {
  if (!message) return null
  const nf = message.interactiveResponseMessage?.nativeFlowResponseMessage
  if (nf) {
    try {
      const p = JSON.parse(nf.paramsJSON || nf.paramsJson || '{}')
      if (p.id) return String(p.id)
    } catch {}
  }
  return message.listResponseMessage?.singleSelectReply?.selectedRowID
    || message.listResponseMessage?.singleSelectReply?.selectedRowId
    || message.buttonsResponseMessage?.selectedButtonID
    || message.buttonsResponseMessage?.selectedButtonId
    || message.templateButtonReplyMessage?.selectedID
    || message.templateButtonReplyMessage?.selectedId
    || null
}

function textFrom(message) {
  if (!message) return ''
  return String(
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.listResponseMessage?.title ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    ''
  ).trim()
}

// Evolution (webhook /webhook/cobranca-admin)
function normalizeEvolution(body) {
  const event = body?.event || ''
  if (event !== 'messages.upsert' && event !== 'message.upsert') return []
  const msgs = Array.isArray(body?.data?.messages) ? body.data.messages : (body?.data ? [body.data] : [])
  const out = []
  for (const m of msgs) {
    const jid = m?.key?.remoteJid || ''
    if (!jid || jid.startsWith('status@') || jid.includes('@g.us')) continue
    const phone = phoneFromJid(jid) || phoneFromJid(m?.key?.remoteJidAlt) || phoneFromJid(m?.key?.senderPn)
    if (!phone) continue
    out.push({
      phone,
      fromMe: m?.key?.fromMe === true || m?.key?.fromMe === 'true',
      id: m?.key?.id,
      text: textFrom(m?.message),
      choiceId: choiceFrom(m?.message),
      hasImage: !!m?.message?.imageMessage
    })
  }
  return out
}

// WuzAPI (webhook /webhook/cobranca-wuz/:secret)
function normalizeWuzapi(body) {
  if (body?.type !== 'Message' || !body.event) return []
  const info = body.event.Info || {}
  const message = body.event.Message || {}
  const chat = String(info.Chat || '')
  if (info.IsGroup || chat.endsWith('@g.us') || chat.startsWith('status@') || chat.endsWith('@newsletter')) return []
  // IMPORTANTE: "Chat" é sempre o número da CONVERSA (o outro lado), nas duas direções.
  // "Sender" só serve pra descobrir o número em mensagem RECEBIDA — numa mensagem que
  // o próprio admin manda direto pelo celular (fromMe), Sender vem preenchido com o
  // número DELE mesmo, não do contato. Antes Sender vinha primeiro aqui, e por isso o
  // robô pausava (ou tentava pausar) o número errado quando o admin assumia a conversa
  // na mão — a pausa nunca "grudava" no contato certo. Mesma prioridade já usada em
  // tenant-wa.js (chat primeiro, Sender só se vier como @lid e SenderAlt resolver).
  // Contato "LID": em msg recebida quem vem em @lid é o Sender (resolve com SenderAlt);
  // em msg fromMe (admin mandando na mão) quem vem em @lid é o CHAT (resolve com
  // RecipientAlt) — sem isso a pausa grava sob "xxxx@lid" e nunca bate com o telefone
  // já resolvido das mensagens recebidas desse mesmo contato.
  const rawSender = String(info.Sender || chat || '')
  const senderAlt = String(info.SenderAlt || '')
  const recipientAlt = String(info.RecipientAlt || '')
  let remoteJid = chat || rawSender
  if (remoteJid.endsWith('@lid')) {
    if (remoteJid === chat && recipientAlt.endsWith('@s.whatsapp.net')) remoteJid = recipientAlt
    else if (senderAlt.endsWith('@s.whatsapp.net')) remoteJid = senderAlt
  }
  const phone = phoneFromJid(remoteJid)
  if (!phone) return []
  const lid = [info.Sender, info.Chat, info.SenderAlt, info.RecipientAlt].map(String).find(j => j.endsWith('@lid'))
  if (lid && !info.IsFromMe) rememberLid(phone, lid.split(':')[0])
  return [{
    phone,
    fromMe: !!info.IsFromMe,
    id: info.ID,
    // nome que a pessoa usa no perfil do WhatsApp (so vale em mensagem recebida; em fromMe e o seu)
    pushName: info.IsFromMe ? '' : String(info.PushName || '').trim(),
    text: textFrom(message),
    choiceId: choiceFrom(message),
    hasImage: !!message.imageMessage
  }]
}

// ==================== Robo: estado, debounce e pausa ====================

const SESSION_MS = 30 * 60 * 1000
const PAUSE_MS = 30 * 60 * 1000
const state = new Map() // phone -> { step, at, ... }
const buffers = new Map()
const seen = new Map()

function pauseKey(phone) { return `pausa:_cobranca:${num55(phone)}` }
function pause(phone) { D._pausaHumano.set(pauseKey(phone), Date.now()) }
function isPaused(phone) {
  const at = D._pausaHumano.get(pauseKey(phone))
  return !!at && (Date.now() - at) < PAUSE_MS
}

function getState(phone) {
  const s = state.get(num55(phone))
  if (!s || Date.now() - s.at > SESSION_MS) return null
  return s
}
function setState(phone, s) { state.set(num55(phone), { ...s, at: Date.now() }) }
function clearState(phone) { state.delete(num55(phone)) }

async function handleIncoming(list) {
  for (const m of list) {
    if (m.id) {
      if (seen.has(m.id)) continue
      seen.set(m.id, Date.now())
      if (seen.size > 5000) seen.delete(seen.keys().next().value)
    }
    // Admin respondeu pelo proprio WhatsApp → pausa o robo para esse contato
    if (m.fromMe) {
      // Fluxo de Marketing com "aceitar quando eu digitar" (palavra exata digitada por voce)
      if (!sentIds.has(m.id) && D.marketing?.onMessage({ ...m, paused: false }, { fromMe: true })) continue
      // Voce digitou so "/pix" na conversa → manda a chave + botao copiar para o cliente (sem pausar o robo)
      if (!sentIds.has(m.id) && /^\/pix$/i.test(String(m.text || '').trim())) {
        enviarPixChave(m.phone, { manual: true }).catch(e => D.log?.('⚠️', `Bot /pix erro (${m.phone}): ${e.message}`))
        continue
      }
      if (!sentIds.has(m.id)) pause(m.phone)
      continue
    }
    // Fluxos de Marketing (palavra-chave / clique de botao). Retorna true se algum fluxo assumiu a mensagem.
    if (D.marketing?.onMessage({ ...m, paused: isPaused(m.phone) }, { fromMe: false })) continue
    if (isPaused(m.phone)) continue
    // Cliente digitou /pix → responde na hora (sem esperar o debounce de texto)
    if (!m.choiceId && isPixCmd(m.text)) {
      enviarPixChave(m.phone).catch(e => D.log?.('⚠️', `Bot /pix erro (${m.phone}): ${e.message}`))
      continue
    }
    if (!m.text && !m.choiceId && !m.hasImage) continue
    buffer(m)
  }
}

// Junta mensagens rapidas (ex: "Oi" + "Boa tarde") numa resposta so
function buffer(m) {
  const key = num55(m.phone)
  const buf = buffers.get(key) || { texts: [], choiceId: null, hasImage: false }
  if (m.text && !m.choiceId) buf.texts.push(m.text)
  if (m.choiceId) buf.choiceId = m.choiceId
  if (m.hasImage) buf.hasImage = true
  clearTimeout(buf.timer)
  // Clique em lista/botao responde rapido; texto espera a pessoa terminar de digitar
  buf.timer = setTimeout(() => {
    buffers.delete(key)
    processMsg(m.phone, buf.texts.join('\n').trim(), buf.choiceId, buf.hasImage)
      .catch(e => D.log?.('⚠️', `Bot suporte/vendas erro (${m.phone}): ${e.message}`))
  }, buf.choiceId ? 800 : 4000)
  buffers.set(key, buf)
}

// ==================== Dados do sistema ====================

function tenantByPhone(phone) {
  try {
    return D.db.prepare(`
      SELECT t.*, sc.store_whatsapp FROM tenants t
      LEFT JOIN store_config sc ON sc.tenant_id = t.id
      WHERE t.slug NOT IN ('_admin','_global','admin')
        AND ((t.telefone_cobranca IS NOT NULL AND t.telefone_cobranca != '')
          OR (sc.store_whatsapp IS NOT NULL AND sc.store_whatsapp != ''))
    `).all().find(t => (t.telefone_cobranca && D.phonesMatch(t.telefone_cobranca, phone))
      || (t.store_whatsapp && D.phonesMatch(t.store_whatsapp, phone))) || null
  } catch { return null }
}

function brl(v) { return (parseFloat(v) || 0).toFixed(2).replace('.', ',') }
function dataBR(iso) {
  if (!iso) return '-'
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00')
  return isNaN(d) ? String(iso) : d.toLocaleDateString('pt-BR')
}

// Valor da mensalidade do plano unico (mesma regra da auto-cobranca)
function valorPlano(tenant) {
  const g = cfg()
  let valor = g.preco_premium !== undefined ? parseFloat(g.preco_premium) : 99.90
  if (tenant && tenant.valor_mensalidade !== null && tenant.valor_mensalidade !== undefined && tenant.valor_mensalidade !== '') {
    valor = parseFloat(tenant.valor_mensalidade)
  }
  if (tenant && tenant.voz_ativo) valor += g.preco_addon_voz !== undefined ? parseFloat(g.preco_addon_voz) : 89.90
  return valor
}

async function notifyAtendente(text) {
  const to = atendenteWa()
  if (to) await sendText(to, text).catch(() => {})
}

// ==================== Menus ====================

const BTN_MENU = { id: 'menu', title: '📋 Menu' }

function greeting() {
  const h = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(new Date()))
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

// Linha opcional no menu que abre um fluxo de Marketing (ex.: "Tutoriais em vídeo"), definida em Admin > Marketing
function atalhoMarketing() {
  try { const a = D.marketing?.atalhoMenu?.(); return a && a.id && a.title ? [a] : [] } catch { return [] }
}

async function sendMenu(phone, tenant, intro) {
  const g = cfg()
  const vendas = [
    { id: 'v_conhecer', title: '🍽️ Conhecer o sistema', description: 'Funções e benefícios' },
    { id: 'v_planos', title: '💰 Plano e preço', description: 'Plano único, tudo incluso' }
  ]
  if (g.bot_demo_link) vendas.push({ id: 'v_demo', title: '🎥 Ver demonstração', description: 'Cardápio e painel de exemplo' })
  vendas.push({ id: 'v_assinar', title: tenant ? '✅ Renovar assinatura' : '✅ Quero assinar', description: tenant ? 'Gerar Pix da mensalidade' : 'Comece a vender hoje' })

  const text = intro || (tenant
    ? `${greeting()}, *${tenant.nome}*! 👋\nAqui é o atendimento do *${D.brandNome(tenant.segmento)}*.\nComo posso te ajudar?`
    : `${greeting()}! 👋\nBem-vindo ao atendimento do *Estima Food* 🍽️\nComo posso te ajudar?`)

  await sendList(phone, text, '📋 Ver opções', [
    { title: '🚀 Vendas', rows: vendas },
    { title: '🛠️ Suporte', rows: [
      ...atalhoMarketing(),
      { id: 's_chamado', title: '🆘 Abrir chamado', description: 'Problema ou dúvida no sistema' },
      { id: 's_atendente', title: '💬 Falar com atendente', description: 'Uma pessoa da equipe responde' }
    ] },
    { title: '💳 Financeiro', rows: [
      { id: 'f_fatura', title: '🧾 Pagar fatura', description: 'Pix da fatura em aberto / 2ª via' },
      { id: 'f_plano', title: '📅 Meu plano', description: 'Situação e vencimento' },
      { id: 'f_comprovante', title: '📎 Enviar comprovante', description: 'Já paguei, quero enviar' }
    ] }
  ])
  setState(phone, { step: 'menu' })
}

const SUPORTE_CATEGORIAS = [
  { id: 'c_pedidos', title: '📦 Pedidos e Kanban', description: 'Pedidos não chegam, status' },
  { id: 'c_impressao', title: '🖨️ Impressão', description: 'Impressora, comanda, Estima Print' },
  { id: 'c_cardapio', title: '📋 Cardápio', description: 'Produtos, fotos, preços' },
  { id: 'c_pagamentos', title: '💸 Pix e pagamentos', description: 'Pix, saques, carteira' },
  { id: 'c_whatsapp', title: '🤖 WhatsApp e robô', description: 'Conexão, mensagens, IA' },
  { id: 'c_entregas', title: '🛵 Entregas', description: 'Motoboy, taxas, bairros' },
  { id: 'c_salao', title: '🍽️ Garçom e mesas', description: 'App do garçom, comandas' },
  { id: 'c_fiscal', title: '🧾 Nota fiscal', description: 'NFC-e' },
  { id: 'c_outro', title: '❓ Outro assunto', description: 'Qualquer outra coisa' }
]

const SEGMENTOS = [
  { id: 'seg_pizzaria', title: '🍕 Pizzaria' },
  { id: 'seg_hamburgueria', title: '🍔 Hamburgueria' },
  { id: 'seg_acai', title: '🍧 Açaí / Sorveteria' },
  { id: 'seg_marmitaria', title: '🍱 Marmitaria' },
  { id: 'seg_doceria', title: '🍰 Doceria / Confeitaria' },
  { id: 'seg_restaurante', title: '🍽️ Restaurante/Lanche' },
  { id: 'seg_acougue', title: '🥩 Açougue' },
  { id: 'seg_loja', title: '👕 Loja / Varejo' },
  { id: 'seg_outro', title: '✨ Outro' }
]

// ==================== Fluxos ====================

async function mostrarFatura(phone, tenant) {
  const fatura = D.db.prepare(`SELECT * FROM faturas WHERE tenant_id=? AND status='pendente' ORDER BY created_at DESC LIMIT 1`).get(tenant.id)
  if (!fatura) {
    await sendButtons(phone, `✅ Verifiquei aqui: não há fatura em aberto para *${tenant.nome}*. Você está em dia!`, [
      { id: 'f_plano', title: '📅 Meu plano' }, BTN_MENU
    ])
    return
  }
  await sendText(phone, [
    `🧾 *Fatura em aberto — ${tenant.nome}*`,
    ``,
    `💰 *Valor:* R$ ${brl(fatura.valor)}`,
    `⏰ *Vencimento:* ${dataBR(fatura.vence_em)}`,
    ``,
    `💸 Pague via Pix pelo QR Code ou pelo código *Copia e Cola* abaixo:`
  ].join('\n'))
  if (fatura.qr_code_base64) await sendImage(phone, fatura.qr_code_base64, `📱 QR Code Pix — R$ ${brl(fatura.valor)}`)
  if (fatura.qr_code) await sendText(phone, fatura.qr_code)
  if (!fatura.qr_code && !fatura.qr_code_base64 && fatura.link_pagamento) await sendText(phone, `🔗 ${fatura.link_pagamento}`)
  await sendButtons(phone, 'Depois de pagar, a liberação é automática ✅\nSe preferir, mande o comprovante por aqui.', [
    { id: 'f_comprovante', title: '📎 Comprovante' }, BTN_MENU
  ])
}

async function mostrarPlano(phone, tenant) {
  const ativo = tenant.ativo === 1 || tenant.ativo === true
  const vence = tenant.expires_at ? dataBR(tenant.expires_at) : 'sem data'
  await sendButtons(phone, [
    `📅 *Seu plano — ${tenant.nome}*`,
    ``,
    `📦 *Plano:* Plano único (tudo incluso)`,
    `💰 *Mensalidade:* R$ ${brl(valorPlano(tenant))}`,
    `🗓️ *Vencimento:* ${vence}`,
    `🔘 *Situação:* ${ativo ? 'Ativo ✅' : 'Suspenso ⚠️'}`
  ].join('\n'), [
    { id: 'f_fatura', title: '🧾 Pagar fatura' }, BTN_MENU
  ])
}

// Financeiro precisa saber quem e o cliente: pelo numero que chamou ou pelo telefone informado
async function precisaTenant(phone, tenant, acao) {
  if (tenant) return tenant
  setState(phone, { step: 'pedir_telefone', acao, tentativas: 0 })
  await sendText(phone, '📱 Me informa o telefone cadastrado no sistema (com DDD), por favor.\n\nEx: 85991234567')
  return null
}

async function executarAcaoTenant(phone, tenant, acao) {
  if (acao === 'f_fatura') return mostrarFatura(phone, tenant)
  if (acao === 'f_plano') return mostrarPlano(phone, tenant)
  if (acao === 'v_assinar') return oferecerRenovacao(phone, tenant)
}

async function oferecerRenovacao(phone, tenant) {
  setState(phone, { step: 'renovar', tenantId: tenant.id })
  await sendButtons(phone, [
    `✅ *Renovar assinatura — ${tenant.nome}*`,
    ``,
    `📦 Plano único (tudo incluso)`,
    `💰 R$ ${brl(valorPlano(tenant))} / mês`,
    ``,
    `Quer que eu gere o Pix agora?`
  ].join('\n'), [
    { id: 'a_pix', title: '💸 Gerar Pix' }, BTN_MENU
  ])
}

async function gerarPixRenovacao(phone, tenantId) {
  const tenant = D.db.prepare('SELECT * FROM tenants WHERE id=?').get(tenantId)
  if (!tenant) return sendMenu(phone, null, 'Não localizei seu cadastro 😕 Escolha uma opção:')
  const valor = valorPlano(tenant)
  try {
    const r = await D.gerarCobrancaPix(tenant, { plano: 'premium', valor, meses: 1 })
    await sendText(phone, `🧾 *Assinatura — Plano único*\n\n💰 *Valor:* R$ ${brl(valor)}/mês\n\n💸 Pague pelo QR Code ou pelo código *Copia e Cola*:`)
    if (r.qr_code_base64) await sendImage(phone, r.qr_code_base64, `📱 QR Code Pix — R$ ${brl(valor)}`)
    if (r.qr_code) await sendText(phone, r.qr_code)
    await sendText(phone, '✅ Assim que o pagamento cair, seu acesso é renovado automaticamente.')
    await notifyAtendente(`💳 *Renovação solicitada pelo robô* — ${tenant.nome} (R$ ${brl(valor)})`)
  } catch (e) {
    D.log?.('⚠️', 'Bot: falha ao gerar Pix:', e.message)
    pause(phone)
    await sendText(phone, 'Tive um problema para gerar o Pix agora 😕 Já chamei um atendente para finalizar com você.')
    await notifyAtendente(`⚠️ *Falha ao gerar Pix pelo robô* — ${tenant.nome}: ${e.message}`)
  }
  clearState(phone)
}

async function textoConhecer(phone) {
  await sendText(phone, [
    `🍽️ *Estima Food* — sistema completo de delivery e gestão para o seu negócio:`,
    ``,
    `✅ Cardápio digital próprio, *sem taxa por pedido*`,
    `✅ Pedidos direto no WhatsApp e no painel (Kanban)`,
    `✅ Pix integrado com confirmação automática`,
    `🤖 Robô com IA que atende e ajuda a fechar pedidos`,
    `✅ Gestão de mesas e app do garçom`,
    `✅ Entregas, motoboys e taxas por bairro/distância`,
    `✅ Financeiro, relatórios e impressão de comandas`
  ].join('\n'))
  const botoes = [{ id: 'v_planos', title: '💰 Plano e preço' }, { id: 'v_assinar', title: '✅ Quero assinar' }]
  botoes.push(cfg().bot_demo_link ? { id: 'v_demo', title: '🎥 Demonstração' } : BTN_MENU)
  await sendButtons(phone, 'Mesmas funções das grandes plataformas, por um preço bem mais justo 😉', botoes)
}

async function textoPlanos(phone, tenant) {
  const g = cfg()
  const preco = g.preco_premium !== undefined ? parseFloat(g.preco_premium) : 99.90
  const botoes = [{ id: 'v_assinar', title: tenant ? '✅ Renovar' : '✅ Quero assinar' }]
  if (g.bot_demo_link) botoes.push({ id: 'v_demo', title: '🎥 Demonstração' })
  botoes.push(BTN_MENU)
  await sendButtons(phone, [
    `💰 *Plano único — tudo incluso*`,
    ``,
    `*R$ ${brl(preco)} / mês*`,
    ``,
    `✅ Todas as funções liberadas`,
    `✅ Sem taxa por pedido`,
    `✅ Suporte pelo WhatsApp`
  ].join('\n'), botoes)
}

// ==================== Comando /pix ====================
// Quem digita /pix (o cliente, ou voce pelo proprio WhatsApp) faz o robo mandar a chave Pix (CNPJ)
// com o botao nativo "Copiar chave Pix". A chave fica em /admin → WhatsApp de Suporte e Vendas.

const PIX_CMD = /(^|\n)\s*\/pix\s*($|\n)/i
const isPixCmd = text => PIX_CMD.test(String(text || ''))
const pixCooldown = new Map() // phone -> ultimo envio (evita repeticao se o cliente spammar)

function formatCnpj(d) {
  return String(d).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

async function enviarPixChave(phone, { manual = false } = {}) {
  const key = num55(phone)
  const last = pixCooldown.get(key) || 0
  if (!manual && Date.now() - last < 15000) return
  pixCooldown.set(key, Date.now())

  const g = cfg()
  const chave = String(g.cobranca_pix_chave || '').replace(/\D/g, '')
  if (chave.length !== 14) {
    D.log?.('⚠️', 'Bot: /pix pedido, mas a chave Pix (CNPJ) não está configurada no painel admin')
    if (manual) await notifyAtendente('Você usou */pix*, mas a chave Pix (CNPJ) ainda não está cadastrada. Cadastre em Admin → WhatsApp de Suporte e Vendas.')
    else await sendText(phone, 'Não consegui pegar a chave Pix agora Já avisei a equipe, em instantes alguém te responde por aqui.')
    if (!manual) await notifyAtendente(`Cliente ${phone} pediu /pix, mas a chave Pix (CNPJ) não está cadastrada no painel.`)
    return
  }

  const cabecalho = [
    `*Pagamento via Pix*`,
    ``,
    `*Chave Pix (CNPJ):*`,
    formatCnpj(chave),
    ...(g.cobranca_pix_nome ? [``, `*Favorecido:* ${g.cobranca_pix_nome}`] : [])
  ].join('\n')
  const rodape = `Depois de pagar, é só mandar o comprovante por aqui`
  const texto = `${cabecalho}\n\nToque no botão abaixo para *copiar a chave* e cole no app do seu banco\n\n${rodape}`

  if (provider() === 'wuzapi') {
    try {
      const id = await wuzSend(phone, (t, to) => wuzapi.sendButtons(t, to, {
        text: texto,
        footer: 'Estima Food',
        buttons: [{ type: 'copy', id: 'pix_copiar', text: 'Copiar chave Pix', copyCode: chave }]
      }))
      rememberSent(id)
      return
    } catch (e) {
      D.log?.('⚠️', `WuzAPI botão copiar Pix falhou, enviando texto: ${e.message}`)
    }
  }
  // Reserva (Evolution ou falha no botao): texto simples, com a chave sozinha na ultima linha
  // para o cliente segurar e copiar com um toque
  await sendText(phone, `${cabecalho}\n\nSegure a chave abaixo para copiar`)
  await sendText(phone, chave)
  await sendText(phone, rodape)
}

// ==================== Processamento ====================

// No lugar do menu automatico, quem NAO e cliente pode receber um fluxo de Marketing (ou nada),
// conforme a opcao salva em Admin > Marketing > Fluxos. Cliente cadastrado sempre recebe o menu.
function marketingAssume(phone, tenant, text, choiceId) {
  if (tenant || typeof D.marketing?.naoCliente !== 'function') return false
  try { return !!D.marketing.naoCliente({ phone, text, choiceId }) } catch { return false }
}

async function processMsg(phone, text, choiceId, hasImage) {
  let st = getState(phone)
  const tenant = tenantByPhone(phone)
  const txt = text.toLowerCase()

  // Resposta com numero para opcoes que foram em texto numerado
  if (!choiceId && /^\d{1,2}$/.test(text)) {
    const n = numbered.get(num55(phone))
    if (n && Date.now() - n.at < SESSION_MS) choiceId = n.options[Number(text) - 1]?.id || null
  }

  // Opcao do menu que abre um fluxo de Marketing, escolhida pelo numero (menu enviado como texto numerado)
  if (choiceId && /^mkt_flow_\d+$/.test(choiceId)) {
    try { if (D.marketing?.onMessage({ phone, text: '', choiceId, paused: false }, { fromMe: false })) return } catch {}
    return sendMenu(phone, tenant)
  }

  // ── Chamado de suporte aguardando a descricao (texto e/ou print) ──
  if (st?.step === 'suporte_descricao' && (text || hasImage) && !choiceId) {
    const cat = SUPORTE_CATEGORIAS.find(c => c.id === st.categoria)
    const protocolo = Date.now().toString().slice(-6)
    await sendText(phone, `✅ *Chamado #${protocolo} aberto!*\n\nAssunto: ${cat ? cat.title : 'Suporte'}\nNossa equipe já vai te responder por aqui. 🙏`)
    pause(phone)
    clearState(phone)
    await notifyAtendente([
      `🆘 *Novo chamado #${protocolo}*`,
      ``,
      `Cliente: ${tenant ? tenant.nome : 'não identificado'}`,
      `WhatsApp: ${phone}`,
      `Assunto: ${cat ? cat.title : '-'}`,
      text ? `\nMensagem: ${text}` : '',
      hasImage ? `\n📎 Enviou imagem — veja no WhatsApp de suporte.` : ''
    ].filter(Boolean).join('\n'))
    return
  }

  // ── Comprovante (imagem) a qualquer momento ──
  if (hasImage && !choiceId) {
    await sendText(phone, '📎 Recebi seu comprovante! Vou repassar para o financeiro conferir e te aviso por aqui. 🙏')
    pause(phone)
    clearState(phone)
    await notifyAtendente(`📎 *Comprovante recebido*\n\nDe: ${phone}${tenant ? `\nCliente: ${tenant.nome}` : ''}\n\nConfira no WhatsApp de suporte.`)
    return
  }

  // ── Menu: saudacao, "menu", sessao nova ou botao Menu ──
  const isGreeting = /^(oi+|ol[aá]+|bom dia|boa tarde|boa noite|menu|in[ií]cio|come[cç]ar|hey|opa|e a[ií])\b/.test(txt)
  if (choiceId === 'menu' || (!choiceId && (isGreeting || !st))) {
    // Quem nao e cliente: o Marketing pode assumir no lugar do menu (Admin > Marketing > Fluxos)
    if (choiceId !== 'menu' && marketingAssume(phone, tenant, text, choiceId)) return
    return sendMenu(phone, tenant)
  }

  // ── Telefone informado (Financeiro de quem chamou de outro numero) ──
  if (st?.step === 'pedir_telefone' && !choiceId) {
    const digitado = text.replace(/\D/g, '')
    const t = digitado.length >= 8 ? tenantByPhone(digitado) : null
    if (!t) {
      st.tentativas = (st.tentativas || 0) + 1
      if (st.tentativas >= 3) {
        pause(phone)
        clearState(phone)
        await sendText(phone, 'Não encontrei esse número no sistema 😕 Vou te passar para um atendente.')
        await notifyAtendente(`⚠️ *Telefone não reconhecido no robô* — cliente ${phone} informou ${digitado || text}`)
        return
      }
      setState(phone, st)
      await sendText(phone, 'Não encontrei esse número 🤔 Confere e manda de novo, com DDD (ex: 85991234567).')
      return
    }
    clearState(phone)
    return executarAcaoTenant(phone, t, st.acao)
  }

  // ── Lead: nome do estabelecimento ──
  if (st?.step === 'lead_nome' && !choiceId) {
    const nome = text.slice(0, 120)
    setState(phone, { ...st, step: 'lead_telefone', nome })
    await sendButtons(phone, `Prazer, *${nome}*! 🙌\nPosso usar este número (${phone}) para o consultor falar com você?`, [
      { id: 'l_tel_ok', title: '✅ Sim, este número' }, { id: 'l_tel_outro', title: '📱 Outro número' }
    ])
    return
  }
  if (st?.step === 'lead_outro_numero' && !choiceId) {
    const digitado = text.replace(/\D/g, '')
    if (digitado.length < 10) {
      await sendText(phone, 'Manda o número com DDD, por favor (ex: 85991234567).')
      return
    }
    return finalizarLead(phone, { ...st, contato: digitado })
  }

  switch (choiceId) {
    // ── Vendas ──
    case 'v_conhecer': return textoConhecer(phone)
    case 'v_planos': return textoPlanos(phone, tenant)
    case 'v_demo': {
      const link = cfg().bot_demo_link
      if (!link) return sendMenu(phone, tenant)
      await sendText(phone, `🎥 *Veja o sistema funcionando:*\n${link}`)
      return sendButtons(phone, 'Gostou? Posso te ajudar a começar agora 🚀', [{ id: 'v_assinar', title: tenant ? '✅ Renovar' : '✅ Quero assinar' }, BTN_MENU])
    }
    case 'v_assinar': {
      if (tenant) return oferecerRenovacao(phone, tenant)
      setState(phone, { step: 'lead_segmento' })
      return sendList(phone, 'Show! 🙌 Para eu te atender melhor, qual é o seu *segmento*?', 'Escolher segmento', [{ title: 'Segmentos', rows: SEGMENTOS }])
    }
    case 'a_pix':
      if (st?.step === 'renovar' && st.tenantId) return gerarPixRenovacao(phone, st.tenantId)
      if (tenant) return oferecerRenovacao(phone, tenant)
      return sendMenu(phone, null)

    // ── Suporte ──
    case 's_chamado':
      setState(phone, { step: 'suporte_categoria' })
      return sendList(phone, '🛠️ *Abrir chamado*\nSobre qual assunto é?', 'Escolher assunto', [{ title: 'Assuntos', rows: SUPORTE_CATEGORIAS }])
    case 's_atendente':
      pause(phone)
      clearState(phone)
      await sendText(phone, '💬 Certo! Já avisei a equipe, em instantes alguém te responde por aqui. 🙂')
      return notifyAtendente(`💬 *Cliente pediu atendente*\n\nWhatsApp: ${phone}${tenant ? `\nCliente: ${tenant.nome}` : ''}`)

    // ── Financeiro ──
    case 'f_fatura':
    case 'f_plano': {
      const t = await precisaTenant(phone, tenant, choiceId)
      if (t) return executarAcaoTenant(phone, t, choiceId)
      return
    }
    case 'f_comprovante':
      setState(phone, { step: 'aguardando_comprovante' })
      return sendText(phone, '📎 Pode mandar a foto ou o print do comprovante aqui mesmo.')

    // ── Lead: telefone ──
    case 'l_tel_ok': return finalizarLead(phone, { ...st, contato: phone })
    case 'l_tel_outro':
      setState(phone, { ...st, step: 'lead_outro_numero' })
      return sendText(phone, '📱 Qual número o consultor deve chamar? (com DDD)')
  }

  // Categoria de suporte escolhida
  if (choiceId && choiceId.startsWith('c_')) {
    setState(phone, { step: 'suporte_descricao', categoria: choiceId })
    return sendText(phone, '✍️ Me conta o que está acontecendo. Se ajudar, pode mandar *print* ou foto da tela.')
  }
  // Segmento escolhido (lead)
  if (choiceId && choiceId.startsWith('seg_')) {
    const seg = SEGMENTOS.find(s => s.id === choiceId)
    setState(phone, { step: 'lead_nome', segmento: seg ? seg.title : choiceId })
    return sendText(phone, '🏪 Qual é o nome do seu estabelecimento?')
  }

  // Texto solto que nao se encaixa em nenhuma etapa → mostra o menu
  if (marketingAssume(phone, tenant, text, choiceId)) return
  return sendMenu(phone, tenant, 'Não entendi muito bem 🤔 Escolha uma das opções:')
}

async function finalizarLead(phone, st) {
  clearState(phone)
  pause(phone)
  await sendText(phone, `🎉 Perfeito, *${st.nome || 'tudo certo'}*! Um consultor do *Estima Food* vai te chamar em breve para liberar seu acesso. Obrigado pelo interesse! 🙌`)
  await notifyAtendente([
    `🆕 *Novo lead pelo robô*`,
    ``,
    `Estabelecimento: ${st.nome || '-'}`,
    `Segmento: ${st.segmento || '-'}`,
    `WhatsApp da conversa: ${phone}`,
    `Contato informado: ${st.contato || phone}`,
    ``,
    `Chame para finalizar o cadastro.`
  ].join('\n'))
}

module.exports = {
  init,
  // canal de envio (cobrancas, lembretes, confirmacoes)
  sendText,
  sendImage,
  provider,
  // painel admin
  status,
  connect,
  currentQr,
  disconnect,
  saveCfg,
  webhookSecretMatches,
  // webhooks
  // usados pelos fluxos de Marketing (marketing-flows.js)
  wuzRun: (phone, fn) => wuzSend(phone, fn),
  wuzToken,
  rememberSent,
  pausar: pause,
  notificar: notifyAtendente,
  tenantByPhone,
  config: cfg,
  handleEvolution: body => handleIncoming(normalizeEvolution(body)),
  handleWuzapi: body => handleIncoming(normalizeWuzapi(body))
}

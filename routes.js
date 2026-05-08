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

// ── Helper: notifica cliente quando PIX é confirmado (online ou manual) ──────
function _notificarPixConfirmado(tid, order, sendWA, fillVars, EVO_INST, db) {
  if (!order?.phone) return
  setImmediate(async () => {
    try {
      const cfg    = db.prepare('SELECT evo_instance, evo_automacoes, order_num_offset, store_name FROM store_config WHERE tenant_id=?').get(tid)
      const inst   = cfg?.evo_instance || EVO_INST
      const loja   = cfg?.store_name || 'Restaurante'
      const auto   = (() => { try { return JSON.parse(cfg?.evo_automacoes||'{}') } catch { return {} } })()
      const pixConf = auto['pix_confirmado'] || {}
      if (pixConf.on === false) return
      const offset = parseInt(cfg?.order_num_offset) || 0
      const idStr  = String(order.order_num || Math.max(1, order.id - offset)).padStart(3,'0')
      const nome   = order.client || 'Cliente'
      const items  = (()=>{ try{ return (JSON.parse(order.items)||[]).map(i=>`• ${i.qty}x ${i.name}`).join('\n') }catch{ return '' } })()
      const total  = (parseFloat(order.total||0)+parseFloat(order.taxa||0)).toFixed(2).replace('.',',')
      const msgPad = `🏪 *${loja}*\n${'─'.repeat(20)}\n\n✅ *Pagamento PIX confirmado!*\n\nOlá, *${nome}*! Recebemos seu pagamento do pedido *#${idStr}* com sucesso.\n\n*Itens:*\n${items}\n\n💰 *Total: R$ ${total}*\n\n📦 Seu pedido está sendo preparado. Obrigado! 🎉\n\n_Dúvidas? É só responder esta mensagem!_ 😊`
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

// Normaliza valor pra MP — aceita string ("15,90", "15.90"), número, retorna
// number com 2 casas decimais. Se inválido (NaN, <= 0), retorna null.
// MP rejeita com erro 4037 ("Invalid transaction_amount") se vier:
// - NaN, undefined, null
// - <= 0
// - mais de 2 casas decimais (ex: 15.999)
// - string com vírgula sem conversão
function _mpValor(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  // Aceita "15,90" → "15.90"
  const s = String(raw).replace(',', '.').trim()
  const n = parseFloat(s)
  if (!isFinite(n) || isNaN(n) || n <= 0) return null
  // Arredonda pra 2 casas SEM erros de ponto flutuante (15.595 → 15.60)
  return Math.round(n * 100) / 100
}

function _iniciarPixRecoveryJob(db, log, sseBroadcast, MP_TOKEN_ENV) {
  if (_pixJobIniciado) return
  _pixJobIniciado = true
  log('🔄', 'PIX recovery job iniciado (intervalo: 60s)')

  setInterval(async () => {
    try {
      // Busca pagamentos pendentes criados nas últimas 24h que ainda têm pedido aguardando
      const pendentes = db.prepare(`
        SELECT p.mp_payment_id, p.order_id, p.tenant_id, p.valor, p.mp_source
        FROM pagamentos_pix p
        LEFT JOIN orders o ON o.id = p.order_id
        WHERE p.status = 'pendente'
          AND p.order_id IS NOT NULL
          AND (o.status = 'aguardando_pix' OR o.status IS NULL)
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
                if (podeRessurreicao) log('🔄', `PEDIDO RESSUSCITADO (recovery): pagamento PIX chegou após cancelamento — id=${row.order_id} tenant=${tenantId}`)
                const pedFull = db.prepare("SELECT * FROM orders WHERE id=? AND tenant_id=?").get(row.order_id, tenantId)
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

// ═══════════════════════════════════════════════════════
// CRON DIÁRIO: auto-cobrança 3 dias antes de vencer
// ═══════════════════════════════════════════════════════
let _autoCobrancaJobIniciado = false
function _iniciarAutoCobrancaJob(ctx) {
  if (_autoCobrancaJobIniciado) return
  _autoCobrancaJobIniciado = true
  const { db, log, MP_TOKEN, EVO_URL, EVO_KEY, EVO_INST, sendWA, marcarDirty } = ctx
  log('🔄', 'Auto-cobrança job iniciado (intervalo: 6h)')

  async function tick() {
    try {
      // Lê preços globais
      let precoEss = 79.99, precoPre = 99.90
      try {
        const c = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
        const g = c?.ia_config ? JSON.parse(c.ia_config) : {}
        if (g.preco_essencial !== undefined) precoEss = parseFloat(g.preco_essencial)
        if (g.preco_premium   !== undefined) precoPre = parseFloat(g.preco_premium)
      } catch {}

      // Token MP — SEMPRE GLOBAL (cobrança SaaS da plataforma)
      // NÃO usar _resolveMpForTenant: é a plataforma cobrando do tenant,
      // dinheiro tem que cair na conta da plataforma, não na do tenant.
      const mpToken = _resolveMpGlobal(db, MP_TOKEN)
      if (!mpToken) return // sem token, pula silenciosamente

      // Tenants ativos vencendo em 3 dias (janela: hoje+2 a hoje+4 para evitar timing)
      const tenants = db.prepare(`
        SELECT * FROM tenants
        WHERE ativo=1
          AND slug NOT IN ('_admin','_global','admin')
          AND expires_at IS NOT NULL
          AND date(expires_at) BETWEEN date('now','+2 days') AND date('now','+4 days')
      `).all()
      if (!tenants.length) return

      let geradas = 0
      for (const t of tenants) {
        // Já existe fatura pendente recente para este tenant? (evita duplicar)
        const ja = db.prepare(`
          SELECT id FROM faturas
          WHERE tenant_id=? AND status='pendente'
            AND created_at > datetime('now','-7 days')
          LIMIT 1
        `).get(t.id)
        if (ja) continue

        try {
          const plano = (t.plano === 'premium') ? 'premium' : 'essencial'
          const valor = (plano === 'premium') ? precoPre : precoEss
          const _valorMp1 = _mpValor(valor)
          if (_valorMp1 === null) { log('⚠️', `Auto-cobrança ${t.id}: valor inválido (${valor})`); continue }
          const extRef = `auto-${t.id.slice(0,8)}-${plano}-${Date.now()}`
          const descricao = `Renovação Plano ${plano === 'premium' ? 'Premium' : 'Essencial'} — ${t.nome}`

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

          const venceEm = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
          const link = mpData.point_of_interaction?.transaction_data?.ticket_url || null
          const qr   = mpData.point_of_interaction?.transaction_data?.qr_code || null
          const qrB64= mpData.point_of_interaction?.transaction_data?.qr_code_base64 || null

          const info = db.prepare(`INSERT INTO faturas
            (tenant_id, plano, valor, meses, metodo, status, link_pagamento, mp_payment_id, mp_external_ref, qr_code, qr_code_base64, vence_em, obs)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
              t.id, plano, parseFloat(valor), 1, 'pix', 'pendente',
              link, String(mpData.id), extRef, qr, qrB64, venceEm,
              'Gerada automaticamente (3 dias antes do vencimento)'
            )
          const fatura = db.prepare('SELECT * FROM faturas WHERE id=?').get(info.lastInsertRowid)
          marcarDirty()

          // Manda WA
          try {
            let telefone = null
            const cfg = db.prepare('SELECT store_whatsapp FROM store_config WHERE tenant_id=?').get(t.id)
            if (cfg?.store_whatsapp) telefone = String(cfg.store_whatsapp).replace(/\D/g, '')
            if (telefone && (telefone.length === 11 || telefone.length === 10)) telefone = '55' + telefone
            if (telefone) {
              const valorTxt = parseFloat(valor).toFixed(2).replace('.', ',')
              const planoNome = plano === 'premium' ? 'Premium' : 'Essencial'
              const venceEmTxt = new Date(venceEm).toLocaleDateString('pt-BR')
              const msg = [
                `🧾 *Lembrete: sua mensalidade vence em breve*`,
                ``,
                `Olá! Seu plano *${planoNome}* do Estima Food vence em *3 dias*.`,
                ``,
                `💰 *Valor:* R$ ${valorTxt}`,
                `⏰ *Pague até:* ${venceEmTxt}`,
                ``,
                `💸 *Pague agora via PIX:*`,
                link || '(link indisponível)',
                ``,
                `_O pagamento renova seu acesso automaticamente._ ✅`
              ].join('\n')
              const instCob = _getInstanciaCobranca(db, EVO_INST)
              await sendWA(telefone, msg, instCob)
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

  // Roda 1x ao iniciar (após 5min para não atrasar startup) e depois a cada 6h
  setTimeout(tick, 5 * 60_000)
  setInterval(tick, 6 * 3600_000)
}

module.exports = async function handleRoutes(req, res, ctx) {
  const { upath, params, db, send, readBody, log, sseBroadcast, marcarDirty,
          validarSessaoAdmin, criarSessaoAdmin, fazerBackup, restaurarBackup, getTenantId,
          MP_TOKEN, TAXA_PIX, BACKUP_PATH, UPLOADS_DIR,
          EVO_URL, EVO_KEY, EVO_INST, sendWA, fillVars, sleep, checarAniv, handleIAWebhook, _pausaHumano } = ctx

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

  // ── Inicia job de recuperação de PIX na primeira requisição ───────────────
  // O job resolve o token MP por tenant em cada iteração — pagamentos de
  // pedidos do tenant X consultam a conta MP do tenant X (com fallback global).
  _iniciarPixRecoveryJob(db, log, sseBroadcast, MP_TOKEN)

  // ── Inicia job de auto-cobrança SaaS (uma vez) ────────────────────────────
  _iniciarAutoCobrancaJob(ctx)

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
        const c = db.prepare('SELECT id,name,phone,email,birthday,orders_count,total_spent,created_at FROM customers WHERE tenant_id=? AND phone=?').get(tid, phone)
        send(res, 200, { ...c, token: Buffer.from(`${c.id}:${tid}:${hash.slice(0, 16)}`).toString('base64') })
        return true
      }
      const info = db.prepare('INSERT INTO customers (tenant_id,name,phone,email,birthday,senha_hash,orders_count,total_spent) VALUES (?,?,?,?,?,?,0,0)').run(tid, name, phone, email || null, birthday || null, hash)
      const c    = db.prepare('SELECT id,name,phone,email,birthday,orders_count,total_spent,created_at FROM customers WHERE id=?').get(info.lastInsertRowid)
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
      const c    = db.prepare('SELECT id,name,phone,email,birthday,orders_count,total_spent,created_at,senha_hash FROM customers WHERE tenant_id=? AND phone=?').get(tid, phone)
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
      const cfg = db.prepare('SELECT store_tempo_entrega FROM store_config WHERE tenant_id=?').get(tid)
      const baseStr = (cfg?.store_tempo_entrega || '').trim()

      // Extrai range numérico da string (ex: "30-45 min", "30 min", "45")
      // Suporta ambos os hífens (- e –) e formatos "30 a 45"
      let lo = 30, hi = 45 // defaults
      const m = baseStr.match(/(\d+)\s*[-–a]\s*(\d+)/) || baseStr.match(/(\d+)/)
      if (m) {
        lo = parseInt(m[1])
        hi = parseInt(m[2] || m[1]) || lo + 15
      }

      // Conta backlog: pedidos delivery em produção
      const backlog = db.prepare(
        "SELECT COUNT(*) as n FROM orders WHERE tenant_id=? AND status IN ('analise','producao','pronto') AND addr IS NOT NULL AND addr NOT LIKE 'Mesa%' AND addr NOT LIKE 'Retirada%'"
      ).get(tid)?.n || 0

      // Heurística: cada 3 pedidos de backlog adiciona +5 min
      // Limita a +30 min de overhead pra não assustar
      const overhead = Math.min(Math.floor(backlog / 3) * 5, 30)
      const finalLo = lo + overhead
      const finalHi = hi + overhead
      const isHighDemand = backlog >= 6

      send(res, 200, {
        base: baseStr,
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
    const tid = getTenantId(req, params)
    const cid = params.get('customer_id')
    if (!tid || !cid) { send(res, 400, { error: 'Parâmetros faltando' }); return true }
    // Valida token Bearer se enviado — compara contra senha_hash do customer
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
          const numStr = String(order.order_num || order.id)
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
            const idStr  = String(order.order_num || Math.max(1, order.id - offset)).padStart(3,'0')
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
    const { email, senha_hash } = body
    if (!email || !senha_hash) { send(res, 400, { error: 'email e senha_hash obrigatórios' }); return true }
    const u = db.prepare("SELECT id,nome,email,role FROM sys_users WHERE email=? AND senha_hash=? AND ativo=1 AND role IN ('superadmin','admin')").get(email.toLowerCase().trim(), senha_hash)
    if (!u) { send(res, 401, { error: 'Acesso negado. Credenciais inválidas.' }); return true }
    const token = criarSessaoAdmin(u)
    send(res, 200, { ok: true, id: u.id, nome: u.nome, email: u.email, role: u.role, token })
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
    const body = await readBody(req)
    const { nome, plano, slug, email, senha, role, nomeGestor, segmento } = body
    if (!nome || !email || !senha) { send(res, 400, { error: 'nome, email e senha obrigatórios' }); return true }
    try {
      const hash     = crypto.createHash('sha256').update(senha).digest('hex')
      const slugBase = slug || nome.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/, '')
      let slugFinal  = slugBase, suffix = 2
      while (db.prepare('SELECT id FROM tenants WHERE slug=?').get(slugFinal)) slugFinal = `${slugBase}-${suffix++}`
      if (slug && slugFinal !== slug) { send(res, 400, { error: `Slug "${slug}" já em uso. Sugerimos: "${slugFinal}"` }); return true }
      if (db.prepare('SELECT id FROM sys_users WHERE email=?').get(email)) { send(res, 400, { error: `E-mail "${email}" já cadastrado.` }); return true }
      const seg = ['restaurante','acougue'].includes(segmento) ? segmento : 'restaurante'
      db.prepare('INSERT INTO tenants (nome,plano,slug,segmento) VALUES (?,?,?,?)').run(nome, plano || 'basic', slugFinal, seg)
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
      send(res, 201, { ok: true, tenant_id: t.id, slug: slugFinal, segmento: seg })
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
        // Lista deve casar com a do backup pra que o restore consiga restaurar tudo.
        // Antes faltavam pagamentos_pix, saques, pagamentos_cartao e stamp_progress —
        // se o backup tivesse essas tabelas, eram silenciosamente descartadas no restore.
        const TABS = ['tenants', 'sys_users', 'store_config', 'categories', 'menu_items', 'cupons', 'mesas', 'garcons', 'orders', 'movimentos', 'estoque', 'fidelidade', 'customers', 'pagamentos_pix', 'saques', 'pagamentos_cartao', 'stamp_progress', 'ratings']
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
        const TABS = ['tenants','sys_users','store_config','categories','menu_items','cupons','mesas','garcons','orders','movimentos','estoque','fidelidade','customers','pagamentos_pix','saques','pagamentos_cartao','stamp_progress','ratings']
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

        // Coleta nomes de imagens referenciadas em menu_items e store_config
        const imageUrls = new Set()
        for (const item of (snapshot.tabelas.menu_items || [])) {
          if (item.image_url) imageUrls.add(item.image_url)
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
              const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg'
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
        const TABS = ['sys_users','store_config','categories','menu_items','cupons','mesas','garcons','orders','movimentos','estoque','fidelidade','customers','pagamentos_pix','saques','pagamentos_cartao','stamp_progress','ratings']
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
        // Coleta imagens referenciadas SOMENTE pelo tenant
        const imageUrls = new Set()
        for (const item of (snapshot.tabelas.menu_items || [])) {
          if (item.image_url) imageUrls.add(item.image_url)
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
              const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg'
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
      const TABS     = ['sys_users', 'store_config', 'categories', 'menu_items', 'cupons', 'mesas', 'garcons', 'orders', 'movimentos', 'estoque', 'fidelidade', 'customers', 'ratings']
      const snapshot = { ts: new Date().toISOString(), tenant_id: tid, tenant_nome: tenant.nome, tabelas: { tenants: [tenant] }, imagens: {} }
      for (const t of TABS) { try { snapshot.tabelas[t] = db.prepare(`SELECT * FROM "${t}" WHERE tenant_id=?`).all(tid) } catch { snapshot.tabelas[t] = [] } }
      const imageUrls = new Set()
      ;(snapshot.tabelas.menu_items || []).forEach(r => { if (r.image_url) imageUrls.add(r.image_url) })
      const cfg = (snapshot.tabelas.store_config || [])[0]
      if (cfg) { if (cfg.store_logo_url) imageUrls.add(cfg.store_logo_url); if (cfg.store_banner_url) imageUrls.add(cfg.store_banner_url) }
      for (const url of imageUrls) {
        const fname = path.basename(url.split('?')[0])
        const fpath = path.join(UPLOADS_DIR, fname)
        if (fs.existsSync(fpath)) {
          const ext  = (path.extname(fname).slice(1) || 'jpeg').toLowerCase()
          const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
          snapshot.imagens[fname] = { mime, data: fs.readFileSync(fpath).toString('base64') }
        }
      }
      const json  = JSON.stringify(snapshot)
      const slug  = tenant.slug || tid
      const fname = `backup-completo-${slug}-${new Date().toISOString().slice(0, 10)}.json`
      log('💾', `Backup completo gestor: ${slug} (${imageUrls.size} imagem(ns), ${Math.round(json.length / 1024)}KB)`)
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
      SELECT id, nome, email, phone, chave_pix, codigo, comissao_pct, comissao_meses, ativo, ultimo_acesso
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
        i.comissao_pct, i.comissao_meses, i.ativo, i.observacoes,
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
    const { nome, email, phone, chave_pix, comissao_pct, comissao_meses, observacoes, senha, senha_hash } = body
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
        (codigo, nome, email, phone, chave_pix, comissao_pct, comissao_meses, observacoes, senha_hash)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(codigo, String(nome).trim(),
             email ? String(email).toLowerCase().trim() : null,
             phone ? String(phone).replace(/\D/g, '') : null,
             chave_pix || null,
             parseFloat(comissao_pct) || 30.0,
             parseInt(comissao_meses) || 12,
             observacoes || null,
             senha_hash || (senha ? crypto.createHash('sha256').update(String(senha)).digest('hex') : null))
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
    const allowed = ['nome', 'email', 'phone', 'chave_pix', 'comissao_pct', 'comissao_meses', 'ativo', 'observacoes']
    for (const k of allowed) if (body[k] !== undefined) {
      let v = body[k]
      if (k === 'phone' && v) v = String(v).replace(/\D/g, '')
      if (k === 'email' && v) v = String(v).toLowerCase().trim()
      if (k === 'comissao_pct')   v = parseFloat(v) || 30.0
      if (k === 'comissao_meses') v = parseInt(v) || 12
      if (k === 'ativo')           v = v ? 1 : 0
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
      fields.push('tenant_id_convertido=?'); values.push(body.tenant_id_convertido || null)
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
  if (req.method === 'POST' && upath === '/api/pix/criar') {
    const tid = req.headers['x-tenant-id']
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatorio' }); return true }
    const body = await readBody(req)
    const { order_id, client, email = 'pagador@email.com' } = body
    let valor = body.valor
    if (!valor || valor <= 0) { send(res, 400, { error: 'valor inválido' }); return true }

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

    try {
      const mp = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${mpToken}`, 'X-Idempotency-Key': extRef },
        body: JSON.stringify({
          transaction_amount: _valorMp,
          description: `Pedido #${order_id || '?'} - ${client || 'Cliente'}`,
          payment_method_id: 'pix',
          external_reference: extRef,
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
            const _ord   = body.order_id ? db.prepare('SELECT id, order_num FROM orders WHERE id=? AND tenant_id=?').get(body.order_id, tid) : null
            const idStr  = String(_ord?.order_num || Math.max(1, (body.order_id || 0) - offset)).padStart(3,'0')
            const nome   = client || 'Cliente'
            const fmtVal = parseFloat(valor).toFixed(2).replace('.',',')
            // Mensagem 1: texto com instruções (customizável pelo gestor, sem o código)
            const nomeLoja  = cfgWa?.store_name || 'Restaurante'
            const msgPadTxt = `🏪 *${nomeLoja}*\n${'─'.repeat(20)}\n\n💠 *PIX — Pedido #${idStr}*\n\nOlá, *${nome}*! Para confirmar seu pedido, realize o pagamento via PIX Copia e Cola.\n\n💰 *Valor: R$ ${fmtVal}*\n\nO código PIX chegará na próxima mensagem — só copiar e colar no app! 👇`
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
          const _fo1 = db.prepare("SELECT * FROM orders WHERE id=? AND tenant_id=?").get(rowAtual.order_id, rowAtual.tenant_id)
          const _it1 = _fo1 && typeof _fo1.items==='string' ? (() => { try{return JSON.parse(_fo1.items)}catch{return []} })() : (_fo1?.items||[])
          sseBroadcast(`orders-rt:${rowAtual.tenant_id}`, `orders:UPDATE`, _fo1 ? {..._fo1, items:_it1, status:'producao', pag:'pix_mp', _pixOnlineConfirmado: true} : { id: rowAtual.order_id, status: 'producao', pag: 'pix_mp', _pixOnlineConfirmado: true })
          _notificarPixConfirmado(rowAtual.tenant_id, _fo1, sendWA, fillVars, EVO_INST, db)
        }
      }
      send(res, 200, { status: novoStatus, mp_status: pd.status })
    } catch (e) { send(res, 500, { error: e.message }) }
    return true
  }

  // ── Vincula PIX ao pedido ────────────────────────────
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
      db.prepare("UPDATE orders SET pag='pix_mp' WHERE id=? AND tenant_id=?").run(ordId, tid)
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
      const pagOnlineAtivo = ia.pag_online_ativo !== false
      // Cartão disponível se a conta resolvida (tenant ou global) tem public key
      const cartaoDisponivel   = !!_mpResolv.mp_public_key
      const cartaoOnlineAtivo  = ia.cartao_online_ativo !== false && cartaoDisponivel
      send(res, 200, {
        pix_ativo:            pixAtivo,
        pix_ativo_gestor:     pixAtivo,
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
              if (podeRessurreicao) log('🔄', `PEDIDO RESSUSCITADO (webhook): pagamento PIX chegou após cancelamento — id=${row.order_id} tenant=${row.tenant_id}`)
            } else if (pedAtual) {
              db.prepare("UPDATE orders SET pag='pix_mp' WHERE id=? AND tenant_id=?").run(row.order_id, row.tenant_id)
            }
            const _ns4 = (eraAguardando || podeRessurreicao) ? 'producao' : pedAtual?.status
            const _fo4 = db.prepare("SELECT * FROM orders WHERE id=? AND tenant_id=?").get(row.order_id, row.tenant_id)
            const _it4 = _fo4 && typeof _fo4.items==='string' ? (() => { try{return JSON.parse(_fo4.items)}catch{return []} })() : (_fo4?.items||[])
            // Marca _pixOnlineConfirmado para o frontend reconhecer e imprimir automático
            sseBroadcast(`orders-rt:${row.tenant_id}`, `orders:UPDATE`, _fo4 ? {..._fo4, items:_it4, status:_ns4, pag:'pix_mp', _pixOnlineConfirmado: (eraAguardando || podeRessurreicao)} : { id: row.order_id, status: _ns4, pag: 'pix_mp', _pixOnlineConfirmado: (eraAguardando || podeRessurreicao) })
            // Notifica cliente: pagamento PIX confirmado
            if (eraAguardando || podeRessurreicao) _notificarPixConfirmado(row.tenant_id, _fo4, sendWA, fillVars, EVO_INST, db)
          }
        }
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
              if (podeRessurreicaoC) log('🔄', `PEDIDO RESSUSCITADO (cartão): pagamento chegou após cancelamento — id=${rowC.order_id} tenant=${rowC.tenant_id}`)
            } else if (pedAtualC) {
              db.prepare("UPDATE orders SET pag='cartao_mp' WHERE id=? AND tenant_id=?").run(rowC.order_id, rowC.tenant_id)
            }
            const _nsC = (eraAguardandoC || podeRessurreicaoC) ? 'analise' : pedAtualC?.status
            const _foC = db.prepare("SELECT * FROM orders WHERE id=? AND tenant_id=?").get(rowC.order_id, rowC.tenant_id)
            const _itC = _foC && typeof _foC.items==='string' ? (() => { try{return JSON.parse(_foC.items)}catch{return []} })() : (_foC?.items||[])
            sseBroadcast(`orders-rt:${rowC.tenant_id}`, `orders:UPDATE`, _foC ? {..._foC, items:_itC, status:_nsC, pag:'cartao_mp'} : { id: rowC.order_id, status: _nsC, pag: 'cartao_mp' })
            // Notifica cliente: cartão confirmado
            if ((eraAguardandoC || podeRessurreicaoC) && _foC?.phone) {
              setImmediate(async () => {
                try {
                  const cfg    = db.prepare('SELECT evo_instance, order_num_offset, store_name FROM store_config WHERE tenant_id=?').get(rowC.tenant_id)
                  const inst   = cfg?.evo_instance || EVO_INST
                  const loja   = cfg?.store_name || 'Restaurante'
                  const offset = parseInt(cfg?.order_num_offset) || 0
                  const idStr  = String(_foC.order_num || Math.max(1, _foC.id - offset)).padStart(3,'0')
                  const nome   = (_foC.client || 'Cliente').split(' ')[0]
                  const total  = (parseFloat(_foC.total||0)+parseFloat(_foC.taxa||0)).toFixed(2).replace('.',',')
                  const msg    = `🏪 *${loja}*\n${'─'.repeat(20)}\n\n✅ *Pagamento confirmado!*\n\nOlá, *${nome}*! Recebemos seu pagamento do pedido *#${idStr}* no cartão. 💳\n\n💰 *Total: R$ ${total}*\n\n📦 Seu pedido está sendo preparado! 🎉\n\n_Dúvidas? É só responder esta mensagem!_ 😊`
                  await sendWA(_foC.phone, msg, inst)
                } catch(e) { log('❌','Erro notif cartão:', e.message) }
              })
            }
          }
        }
      }

      // ── Rota 3: Fatura SaaS (assinatura mensal do restaurante) ───────────
      // Tenta casar por mp_payment_id (PIX) ou external_reference (cartão preference)
      let rowF = db.prepare('SELECT * FROM faturas WHERE mp_payment_id=?').get(String(mpId))
      if (!rowF && pd.external_reference) {
        rowF = db.prepare('SELECT * FROM faturas WHERE mp_external_ref=?').get(pd.external_reference)
        // Se casou por external_ref e ainda não tinha mp_payment_id (caso preference), salva
        if (rowF && !rowF.mp_payment_id) {
          db.prepare('UPDATE faturas SET mp_payment_id=? WHERE id=?').run(String(mpId), rowF.id)
        }
      }
      if (rowF && rowF.status !== 'pago' && novoStatus === 'aprovado') {
        const tenant = db.prepare('SELECT * FROM tenants WHERE id=?').get(rowF.tenant_id)
        if (tenant) {
          // Marca fatura paga
          db.prepare("UPDATE faturas SET status='pago', pago_em=? WHERE id=?")
            .run(pd.date_approved || new Date().toISOString(), rowF.id)

          // Renova plano: soma meses ao expires_at atual (ou hoje se já expirou/sem data)
          const hoje = new Date()
          const baseDate = (tenant.expires_at && new Date(tenant.expires_at) > hoje)
            ? new Date(tenant.expires_at)
            : hoje
          const novaExp = new Date(baseDate)
          novaExp.setDate(novaExp.getDate() + (parseInt(rowF.meses) || 1) * 30)
          const novaExpISO = novaExp.toISOString().slice(0, 10)

          // Atualiza plano também (caso fatura tenha sido pra upgrade)
          const planoNovo = ['premium','essencial','pro'].includes(rowF.plano) ? rowF.plano : tenant.plano
          db.prepare('UPDATE tenants SET expires_at=?, ativo=1, plano=?, updated_at=datetime(\'now\') WHERE id=?')
            .run(novaExpISO, planoNovo, tenant.id)

          marcarDirty()
          log('✅', `FATURA PAGA: tenant=${tenant.nome} valor=R$${rowF.valor} plano=${planoNovo} novo_vencimento=${novaExpISO}`)

          // Notifica gestor por WhatsApp
          ;(async () => {
            try {
              let telefone = null
              try {
                const cfg = db.prepare('SELECT store_whatsapp FROM store_config WHERE tenant_id=?').get(tenant.id)
                if (cfg?.store_whatsapp) telefone = String(cfg.store_whatsapp).replace(/\D/g, '')
              } catch {}
              if (telefone && (telefone.length === 11 || telefone.length === 10)) telefone = '55' + telefone
              if (telefone) {
                const planoNome = planoNovo === 'premium' ? 'Premium' : 'Essencial'
                const valorTxt  = parseFloat(rowF.valor).toFixed(2).replace('.', ',')
                const venceTxt  = novaExp.toLocaleDateString('pt-BR')
                const msg = [
                  `✅ *Pagamento confirmado!*`,
                  ``,
                  `Recebemos seu pagamento do plano *${planoNome}*.`,
                  ``,
                  `💰 *Valor:* R$ ${valorTxt}`,
                  `📅 *Próximo vencimento:* ${venceTxt}`,
                  ``,
                  `Seu acesso continua ativo. Obrigado por usar o *Estima Food*! 🍽️`
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
    let cl = db.prepare('SELECT * FROM fidelidade WHERE phone IS NOT NULL' + (tid ? ' AND tenant_id=?' : '')).all(...(tid ? [tid] : []))
    if (destino === 'com_pedido') cl = cl.filter(c => c.orders_count > 0)
    if (!cl.length) { send(res, 200, { ok: true, enviados: 0 }); return true }
    send(res, 200, { ok: true, total: cl.length, msg: 'Envio iniciado' })
    ;(async () => {
      let ok = 0, fail = 0
      for (const c of cl) { const r = await sendWA(c.phone, fillVars(msg, { nome: c.name }), instP); r.ok ? ok++ : fail++; await sleep(1500) }
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
    const pedido      = db.prepare('SELECT id,status,items,total,taxa FROM orders WHERE id=? AND tenant_id=?').get(order_id, tenant_id)
    if (!pedido) { send(res, 400, { ok: false }); return true }
    const sl          = { analise: '⏳ aguardando confirmação', producao: '👨‍🍳 em preparo', pronto: '🛵 saindo para entrega', entregue: '✅ entregue', cancelado: '❌ cancelado' }
    const offset      = parseInt(cfg?.order_num_offset || 0) || 0
    const numPedido   = String(Math.max(1, pedido.id - offset)).padStart(3, '0')
    const totalComTaxa = (parseFloat(pedido.total||0) + parseFloat(pedido.taxa||0)).toFixed(2).replace('.', ',')
    const msg         = `🍽️ *${cfg?.store_name || 'Restaurante'}*\n\nOlá! Seu pedido *#${numPedido}* está:\n\n${sl[pedido.status] || pedido.status}\n\nTotal: R$ ${totalComTaxa}\n\nQualquer dúvida é só responder! 😊`
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
    const { card_token, payment_method_id, valor, order_id, client, email = 'cliente@email.com', issuer_id } = body
    if (!card_token)         { send(res, 400, { error: 'card_token obrigatório' }); return true }
    if (!payment_method_id)  { send(res, 400, { error: 'payment_method_id obrigatório' }); return true }
    const _valorMpC = _mpValor(valor)
    if (_valorMpC === null) { send(res, 400, { error: 'Valor inválido' }); return true }

    // Resolve conta MP: tenant primeiro, depois global
    const _mpCfgC = _resolveMpForTenant(db, tid, MP_TOKEN)
    const mpToken = _mpCfgC.mp_token
    if (!mpToken) { send(res, 400, { error: 'Token Mercado Pago não configurado' }); return true }

    const extRef = `ef-card-${tid.slice(0,8)}-${order_id || Date.now()}`

    try {
      const mpBody = {
        transaction_amount: _valorMpC,
        token:              card_token,
        description:        `Pedido #${order_id || '?'} - ${client || 'Cliente'}`,
        installments:       1,
        payment_method_id,
        external_reference: extRef,
        payer: { email, first_name: client || 'Cliente', last_name: '' },
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
          if (podeRessurreicao) log('🔄', `PEDIDO RESSUSCITADO (cartão poll): id=${rowBefore.order_id} tenant=${rowBefore.tenant_id}`)
        } else if (pedAtual) {
          db.prepare("UPDATE orders SET pag='cartao_mp' WHERE id=? AND tenant_id=?").run(rowBefore.order_id, rowBefore.tenant_id)
        }
        marcarDirty()
        const _ns = (eraAguardando || podeRessurreicao) ? 'analise' : pedAtual?.status
        const _fo = db.prepare("SELECT * FROM orders WHERE id=? AND tenant_id=?").get(rowBefore.order_id, rowBefore.tenant_id)
        const _it = _fo && typeof _fo.items === 'string' ? (() => { try { return JSON.parse(_fo.items) } catch { return [] } })() : (_fo?.items || [])
        sseBroadcast(`orders-rt:${rowBefore.tenant_id}`, 'orders:UPDATE', _fo ? { ..._fo, items: _it, status: _ns, pag: 'cartao_mp' } : { id: rowBefore.order_id, status: _ns, pag: 'cartao_mp' })
        // Notifica cliente
        if ((eraAguardando || podeRessurreicao) && _fo?.phone) {
          setImmediate(async () => {
            try {
              const cfg    = db.prepare('SELECT evo_instance, order_num_offset, store_name FROM store_config WHERE tenant_id=?').get(rowBefore.tenant_id)
              const inst   = cfg?.evo_instance || EVO_INST
              const loja   = cfg?.store_name || 'Restaurante'
              const offset = parseInt(cfg?.order_num_offset) || 0
              const idStr  = String(_fo.order_num || Math.max(1, _fo.id - offset)).padStart(3,'0')
              const nome   = (_fo.client || 'Cliente').split(' ')[0]
              const total  = (parseFloat(_fo.total||0)+parseFloat(_fo.taxa||0)).toFixed(2).replace('.',',')
              const msg    = `🏪 *${loja}*\n${'─'.repeat(20)}\n\n✅ *Pagamento confirmado!*\n\nOlá, *${nome}*! Recebemos seu pagamento do pedido *#${idStr}* no cartão. 💳\n\n💰 *Total: R$ ${total}*\n\n📦 Seu pedido está sendo preparado! 🎉\n\n_Dúvidas? É só responder esta mensagem!_ 😊`
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
        premium: ia.preco_premium !== undefined ? parseFloat(ia.preco_premium) : 99.90
      })
    } catch(e) { send(res, 200, { essencial: 79.99, premium: 99.90 }) }
    return true
  }

  // ── Admin: Salvar precos dos planos ──────────────────
  if (req.method === 'POST' && upath === '/api/admin/planos/precos') {
    if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Nao autorizado' }); return true }
    const body = await readBody(req)
    const { preco_essencial, preco_premium } = body
    try {
      const cfg = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
      const ia = cfg?.ia_config ? JSON.parse(cfg.ia_config) : {}
      if (preco_essencial !== undefined) ia.preco_essencial = parseFloat(preco_essencial)
      if (preco_premium !== undefined) ia.preco_premium = parseFloat(preco_premium)
      db.prepare("INSERT INTO store_config (tenant_id,ia_config) VALUES ('_global',?) ON CONFLICT(tenant_id) DO UPDATE SET ia_config=excluded.ia_config").run(JSON.stringify(ia))
      marcarDirty()
      log('⚙️', `Precos planos atualizados: Essencial=R$${ia.preco_essencial} Premium=R$${ia.preco_premium}`)
      send(res, 200, { ok: true, preco_essencial: ia.preco_essencial, preco_premium: ia.preco_premium })
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
          description: `Renovacao ${plano === 'premium' ? 'Plano Premium' : 'Plano Essencial'} - ${tenant?.nome || 'Cliente'}`,
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
          const novaExpira = new Date()
          novaExpira.setDate(novaExpira.getDate() + 30)
          db.prepare('UPDATE tenants SET plano=?, expires_at=?, ativo=1 WHERE id=?').run(plano, novaExpira.toISOString().slice(0,10), rowAtual.tenant_id)
          marcarDirty()
          log('✅', `PLANO RENOVADO: ${plano} tenant=${rowAtual.tenant_id} expira=${novaExpira.toISOString().slice(0,10)}`)
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
          description: `Renovacao ${plano === 'premium' ? 'Plano Premium' : 'Plano Essencial'} - ${tenant?.nome || 'Cliente'}`,
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
        const novaExpira = new Date()
        novaExpira.setDate(novaExpira.getDate() + 30)
        db.prepare('UPDATE tenants SET plano=?, expires_at=?, ativo=1 WHERE id=?').run(plano, novaExpira.toISOString().slice(0,10), tid)
        marcarDirty()
        log('✅', `PLANO RENOVADO (Cartao): ${plano} tenant=${tid} expira=${novaExpira.toISOString().slice(0,10)}`)
      }

      log('💳', `Cartao plano: R$${valor} plano=${plano} tenant=${tid} status=${novoStatus}`)
      send(res, 200, { ok: true, status: novoStatus, status_detail: mpData.status_detail || '' })
    } catch (e) { log('❌', 'Cartao plano erro:', { error: e.message }); send(res, 500, { error: 'Erro ao processar pagamento: ' + e.message }) }
    return true
  }
  
  // ── Obter Public Key MP para frontend ────────────────
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
      const planoLabel = plano === 'premium' ? 'Premium' : 'Essencial'
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
    const { audio, garcom_nome, garcom_id, destino } = body
    if (!audio) { send(res, 400, { error: 'Áudio obrigatório' }); return true }
    if (audio.length > 500000) { send(res, 413, { error: 'Áudio muito grande (máx 10s)' }); return true }

    const from_id = garcom_id ? String(garcom_id) : 'gestor'
    const to_id = (!destino || destino === 'gestor') ? 'gestor' : String(destino)
    const from_nome = garcom_nome || (from_id === 'gestor' ? 'Gestor' : 'Garçom')

    // Salva no banco
    try {
      db.prepare('INSERT INTO radio_messages (tenant_id, from_id, from_nome, to_id, audio) VALUES (?,?,?,?,?)').run(tid, from_id, from_nome, to_id, audio)
    } catch(e) { console.warn('[RADIO] db insert:', e.message) }

    const payload = { audio, garcom_nome: from_nome, garcom_id: from_id, ts: Date.now() }
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
        SELECT id, from_id, from_nome, to_id, created_at
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
      const row = db.prepare('SELECT audio FROM radio_messages WHERE id=? AND tenant_id=?').get(msgId, tid)
      if (!row) { send(res, 404, { error: 'Áudio não encontrado' }); return true }
      send(res, 200, { audio: row.audio })
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
    try {
      // Senha pode estar em plain text (legado) ou SHA256 (novo).
      // Aceita ambos e, ao detectar plain text, migra automaticamente para hash.
      const user = usuario.trim().toLowerCase()
      const hashSenha = crypto.createHash('sha256').update(senha).digest('hex')
      const row = db.prepare(
        'SELECT id, tenant_id, nome, usuario, senha, ativo FROM garcons WHERE tenant_id=? AND usuario=? AND ativo=1'
      ).get(tid, user)
      if (!row) { send(res, 401, { error: 'Usuário ou senha incorretos' }); return true }
      const stored = row.senha || ''
      const isHash = /^[a-f0-9]{64}$/i.test(stored)
      const match = isHash ? (stored === hashSenha) : (stored === senha)
      if (!match) { send(res, 401, { error: 'Usuário ou senha incorretos' }); return true }
      // Migração lazy: se estava em plain text, atualiza para hash
      if (!isHash) {
        try { db.prepare('UPDATE garcons SET senha=? WHERE id=?').run(hashSenha, row.id); log('🔐', `[MIGRACAO] Senha do garçom ${row.usuario} migrada para hash`) } catch(_) {}
      }
      send(res, 200, { id: row.id, tenant_id: row.tenant_id, nome: row.nome, usuario: row.usuario, ativo: true })
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

  // ── Heartbeat do agente (a cada 10s) ─────────────────
  if (req.method === 'POST' && upath === '/api/print-queue/heartbeat') {
    const tid  = req.headers['x-tenant-id']
    const body = await readBody(req)
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatório' }); return true }
    _agents.set(tid, { last_seen: Date.now(), printer: body.printer || '', format: body.format || 'A4' })
    send(res, 200, { ok: true })
    return true
  }

  // ── Status do agente (gestor consulta antes de criar job) ──
  if (req.method === 'GET' && upath === '/api/print-queue/status') {
    const tid = req.headers['x-tenant-id']
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatório' }); return true }
    const agent = _agents.get(tid)
    const active = agent && (Date.now() - agent.last_seen) < 30000
    send(res, 200, { active: !!active, printer: agent?.printer || '', format: agent?.format || 'A4' })
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
      db.transaction(() => {
        db.prepare('INSERT OR IGNORE INTO store_config (tenant_id) VALUES (?)').run(tid)
        db.prepare('UPDATE store_config SET order_num_offset=? WHERE tenant_id=?').run(offset, tid)
      })()
      marcarDirty()
      sseBroadcast(`orders-rt:${tid}`, 'store_config:UPDATE', { tenant_id: tid, order_num_offset: offset })
      send(res, 200, { ok: true, order_num_offset: offset, next_order_num: 1 })
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

      const JSON_FIELDS_MI = new Set(['days','ingredients','custom_groups'])
      const COLS_MI = ['tenant_id','name','description','price','price_old','cat','cat_key','emoji',
                       'item_type','allow_half','max_flavors','promo','destaque','status',
                       'days','ingredients','custom_groups','sort_order']
      const COLS_CAT = ['tenant_id','name','label','type','promo','sort_order']

      let catsCriadas = 0, itensCriados = 0, erros = 0
      const catIds = {}  // name → id

      const doImport = db.transaction(() => {
        let catOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as mx FROM categories WHERE tenant_id=?').get(tid)?.mx || 0

        for (const catDef of categorias) {
          if (!catDef.name || !catDef.label) { erros++; continue }
          try {
            const catRow = {
              tenant_id: tid, name: catDef.name, label: catDef.label,
              type: catDef.type || 'Itens principais',
              promo: catDef.promo ? 1 : 0,
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
                  cat: catDef.label,
                  cat_key: catDef.name,
                  emoji: itemDef.emoji || '🍽️',
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
      send(res, 200, { ok: true, catsCriadas, itensCriados, erros })
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

  // ── Helper: gera cobrança PIX no Mercado Pago e retorna { fatura, link } ──
  async function _gerarCobrancaMP(tenant, opts) {
    const { plano, valor, meses, metodo } = opts
    const _valorMpG = _mpValor(valor)
    if (_valorMpG === null) throw new Error('Valor da cobrança inválido')

    // Token MP — SEMPRE GLOBAL (faturamento SaaS da plataforma)
    const mpToken = _resolveMpGlobal(db, MP_TOKEN)
    if (!mpToken) throw new Error('Token Mercado Pago não configurado em /admin → Saques PIX')

    const extRef = `fatura-${tenant.id.slice(0, 8)}-${plano}-${Date.now()}`
    const venceEm = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() // expira em 7d
    const descricao = `Plano ${plano === 'premium' ? 'Premium' : 'Essencial'} — ${meses} ${meses === 1 ? 'mês' : 'meses'} — ${tenant.nome}`

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
      (tenant_id, plano, valor, meses, metodo, status, link_pagamento, mp_payment_id, mp_external_ref, qr_code, qr_code_base64, vence_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        tenant.id, plano, parseFloat(valor), parseInt(meses) || 1, metodo, 'pendente',
        linkPagamento, mpData.id ? String(mpData.id) : null, extRef,
        qrCode, qrCodeBase64, venceEm
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

      // Tenta achar telefone: prioriza store_config.store_whatsapp do tenant
      let telefone = null
      try {
        const cfg = db.prepare('SELECT store_whatsapp FROM store_config WHERE tenant_id=?').get(tenant.id)
        if (cfg?.store_whatsapp) telefone = String(cfg.store_whatsapp).replace(/\D/g, '')
      } catch {}
      if (!telefone) {
        log('⚠️', `Cobrança WA: tenant ${tenant.nome} sem telefone — link gerado mas não enviado`)
        return { enviado: false, motivo: 'telefone_nao_configurado' }
      }
      // Garante DDI 55
      if (telefone.length === 11 || telefone.length === 10) telefone = '55' + telefone

      const valorTxt = parseFloat(fatura.valor).toFixed(2).replace('.', ',')
      const planoNome = fatura.plano === 'premium' ? 'Premium' : 'Essencial'
      const venceEmTxt = fatura.vence_em
        ? new Date(fatura.vence_em).toLocaleDateString('pt-BR')
        : '7 dias'

      const linhas = [
        `🧾 *Cobrança — Plano ${planoNome}*`,
        ``,
        `Olá ${(gestor?.nome || tenant.nome).split(' ')[0]}! 👋`,
        ``,
        `Sua mensalidade do *Estima Food* está disponível para pagamento:`,
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
      await sendWA(telefone, msg, instCob)
      log('📨', `Cobrança WA enviada: tenant=${tenant.nome} fatura=${fatura.id} tel=${telefone} (instância: ${instCob})`)
      return { enviado: true, telefone, instance: instCob }
    } catch (e) {
      log('⚠️', 'Cobrança WA erro:', e.message)
      return { enviado: false, motivo: e.message }
    }
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
      if (!tenant) { send(res, 404, { error: 'Tenant não encontrado' }); return true }
      const result = await _gerarCobrancaMP(tenant, {
        plano: ['essencial', 'premium', 'pro'].includes(plano) ? plano : 'essencial',
        valor: parseFloat(valor),
        meses: parseInt(meses) || 1,
        metodo: metodo === 'cartao' ? 'cartao' : 'pix'
      })
      const wa = await _enviarCobrancaWA(tenant, result.fatura)
      _registrarAudit(sess, {
        acao: 'cobranca.gerar',
        alvo_tipo: 'tenant', alvo_id: tenant_id, alvo_nome: tenant.nome,
        detalhes: { fatura_id: result.fatura.id, valor: result.fatura.valor, plano, meses, metodo, wa_enviado: wa.enviado }
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
    // Lê preços dos planos
    let precoEss = 79.99, precoPre = 99.90
    try {
      const c = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
      const g = c?.ia_config ? JSON.parse(c.ia_config) : {}
      if (g.preco_essencial !== undefined) precoEss = parseFloat(g.preco_essencial)
      if (g.preco_premium   !== undefined) precoPre = parseFloat(g.preco_premium)
    } catch {}

    let enviadas = 0, falhas = 0
    const erros = []
    for (const id of ids) {
      try {
        const tenant = db.prepare('SELECT * FROM tenants WHERE id=?').get(id)
        if (!tenant) { falhas++; erros.push({ id, erro: 'tenant não encontrado' }); continue }
        const plano = (tenant.plano === 'premium') ? 'premium' : 'essencial'
        const valor = (plano === 'premium') ? precoPre : precoEss
        const result = await _gerarCobrancaMP(tenant, { plano, valor, meses: 1, metodo: 'pix' })
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
      send(res, 200, { instance: g.cobranca_wa_instance || '' })
    } catch(e) { send(res, 200, { instance: '' }) }
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
    try {
      const c = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
      const g = c?.ia_config ? JSON.parse(c.ia_config) : {}
      g.cobranca_wa_instance = instance || null
      db.prepare("INSERT INTO store_config (tenant_id, ia_config) VALUES ('_global', ?) ON CONFLICT(tenant_id) DO UPDATE SET ia_config=excluded.ia_config")
        .run(JSON.stringify(g))
      marcarDirty()
      _registrarAudit(sess, {
        acao: 'config.cobranca_wa',
        alvo_tipo: null, alvo_id: null, alvo_nome: null,
        detalhes: { instance: instance || null }
      }, req.headers)
      send(res, 200, { ok: true, instance: instance || null })
    } catch(e) { send(res, 500, { error: e.message }) }
    return true
  }

  return false // nenhuma rota tratada aqui — passa para o REST engine
}

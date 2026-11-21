// VisseTV: cobrança dos anunciantes.
//
// Anunciante SÓ da VisseTV (sem loja do EstimaFood ligada):
//  - 2 dias antes do dia de vencimento dele, gera um Pix (Mercado Pago da
//    plataforma) com o valor negociado e manda pelo WhatsApp de cobranças.
//  - No dia do vencimento, se não pagou, manda um lembrete.
//  - Passou a tolerância (2 dias depois do vencimento) sem pagar: os anúncios
//    dele saem do ar em todas as TVs e ele recebe um aviso. Pagou, voltam na hora.
//  - O pagamento é reconhecido sozinho (aviso do Mercado Pago ou conferência a
//    cada 3 minutos).
//
// Anunciante LIGADO a uma loja do EstimaFood: não tem fatura aqui. O valor dele
// entra somado na mensalidade da loja (routes.js chama valorNaFaturaDaLoja). Se a
// loja passar da tolerância sem pagar a mensalidade, os anúncios saem do ar também.
//
// O admin pode desligar a cobrança de um anunciante a qualquer hora (não gera
// mais faturas e as abertas são canceladas), mudar o valor (vale para as
// próximas), cobrar na hora, marcar como pago e cancelar uma fatura.

const TOLERANCIA_DIAS = 2   // dias depois do vencimento até os anúncios saírem do ar
const ANTECEDENCIA_DIAS = 2 // quantos dias antes do vencimento a fatura é gerada

let D = null // { db, log, marcarDirty, mpToken(), sendText(), sendImage(), webhookUrl }
let _job = null

function agoraISO() { return new Date().toISOString() }
// Data de hoje no horário de Brasília (AAAA-MM-DD)
function hoje() { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10) }
function somaDias(dataISO, n) {
  const d = new Date(String(dataISO).slice(0, 10) + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function horaBrasilia() { return new Date(Date.now() - 3 * 3600 * 1000).getUTCHours() }
function brl(v) { return (parseFloat(v) || 0).toFixed(2).replace('.', ',') }
function dataBR(iso) { return iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '-' }
function valorMp(v) {
  const n = Math.round((parseFloat(String(v).replace(',', '.')) || 0) * 100) / 100
  return n > 0 ? n : null
}
function telefoneDe(a) {
  let t = String(a.telefone || '').replace(/\D/g, '')
  if (t.length === 10 || t.length === 11) t = '55' + t
  return t.length >= 12 ? t : null
}

// Vencimento do mês (dia ajustado quando o mês é mais curto)
function vencimentoNoMes(ano, mes0, dia) {
  const ultimo = new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate()
  return new Date(Date.UTC(ano, mes0, Math.min(Math.max(1, dia), ultimo))).toISOString().slice(0, 10)
}
// Próximo vencimento a partir de uma data (inclusive)
function proximoVencimento(dia, aPartir) {
  const [a, m] = String(aPartir).slice(0, 10).split('-').map(Number)
  for (let k = 0; k < 3; k++) {
    const v = vencimentoNoMes(a, m - 1 + k, dia)
    if (v >= aPartir) return v
  }
  return vencimentoNoMes(a, m + 1, dia)
}

function criarTabelas(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS od_faturas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anunciante_id INTEGER NOT NULL,
    valor REAL NOT NULL,
    vence_em TEXT NOT NULL,
    status TEXT DEFAULT 'pendente',
    metodo TEXT DEFAULT 'pix',
    origem TEXT,
    mp_payment_id TEXT,
    mp_external_ref TEXT,
    qr_code TEXT,
    qr_code_base64 TEXT,
    link TEXT,
    obs TEXT,
    wa_enviado_em TEXT,
    wa_erro TEXT,
    lembrete_em TEXT,
    aviso_pausa_em TEXT,
    pago_em TEXT,
    cancelado_em TEXT,
    created_at TEXT
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_od_faturas_anunciante ON od_faturas(anunciante_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_od_faturas_status ON od_faturas(status)')
  // Cobrança automática ligada (1) ou desligada (0) para o anunciante
  try { db.prepare('ALTER TABLE od_anunciantes ADD COLUMN cobranca_ativa INTEGER DEFAULT 1').run() } catch (e) { /* já existe */ }
}

// ── Quem está com os anúncios fora do ar por falta de pagamento ──────────
let _cachePausados = { em: 0, ids: new Set() }
function limparCache() { _cachePausados.em = 0 }
function idsPausadosPorPagamento(db) {
  if (Date.now() - _cachePausados.em < 20000) return _cachePausados.ids
  const limite = somaDias(hoje(), -TOLERANCIA_DIAS) // venceu antes disso = passou da tolerância
  const ids = new Set()
  try {
    for (const r of db.prepare(`SELECT DISTINCT f.anunciante_id id FROM od_faturas f
        JOIN od_anunciantes a ON a.id = f.anunciante_id
        WHERE f.status='pendente' AND f.vence_em < ? AND COALESCE(a.cobranca_ativa,1)=1 AND a.loja_id IS NULL`).all(limite)) ids.add(r.id)
    // Ligado ao EstimaFood: segue o vencimento da mensalidade da loja
    for (const r of db.prepare(`SELECT a.id FROM od_anunciantes a JOIN tenants t ON t.id = a.loja_id
        WHERE COALESCE(a.cobranca_ativa,1)=1 AND COALESCE(a.valor_mensal,0) > 0
          AND t.expires_at IS NOT NULL AND substr(t.expires_at,1,10) < ?`).all(limite)) ids.add(r.id)
  } catch (e) {}
  _cachePausados = { em: Date.now(), ids }
  return ids
}
function pausadoPorPagamento(db, aid) { return idsPausadosPorPagamento(db).has(aid) }

// Valor da VisseTV que entra na mensalidade da loja do EstimaFood ligada
function valorNaFaturaDaLoja(db, tid) {
  try {
    const a = db.prepare('SELECT valor_mensal FROM od_anunciantes WHERE loja_id=? AND ativo=1 AND COALESCE(cobranca_ativa,1)=1').get(String(tid))
    return a ? Math.max(0, parseFloat(a.valor_mensal) || 0) : 0
  } catch (e) { return 0 }
}

// ── Gerar a cobrança (Pix) ───────────────────────────────────────────────
async function gerarFatura(a, { valor, vence_em, origem, pago, obs } = {}) {
  const { db, log, marcarDirty } = D
  valor = valorMp(valor !== undefined ? valor : a.valor_mensal)
  if (!valor) throw new Error('Valor inválido para a cobrança.')
  vence_em = /^\d{4}-\d{2}-\d{2}$/.test(String(vence_em || '')) ? vence_em : proximoVencimento(a.dia_vencimento || 10, hoje())
  const ins = db.prepare(`INSERT INTO od_faturas (anunciante_id, valor, vence_em, status, metodo, origem, obs, created_at, pago_em)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(a.id, valor, vence_em, pago ? 'pago' : 'pendente', pago ? 'manual' : 'pix', origem || 'auto',
      obs || null, agoraISO(), pago ? agoraISO() : null)
  const id = ins.lastInsertRowid
  limparCache()
  if (pago) { try { marcarDirty() } catch (e) {} ; return db.prepare('SELECT * FROM od_faturas WHERE id=?').get(id) }
  const token = D.mpToken()
  if (token) {
    const extRef = `vtv-${id}-${Date.now()}`
    try {
      const r = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Idempotency-Key': extRef },
        body: JSON.stringify({
          transaction_amount: valor,
          description: `VisseTV: anúncio de ${a.nome} (vence ${dataBR(vence_em)})`,
          payment_method_id: 'pix',
          external_reference: extRef,
          notification_url: D.webhookUrl,
          date_of_expiration: new Date(Date.now() + 10 * 86400000).toISOString().replace('Z', '-03:00'),
          payer: { email: 'cobranca@estimafood.com', first_name: String(a.nome || 'Cliente').split(' ')[0] }
        })
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.message || 'Mercado Pago recusou')
      const td = d.point_of_interaction?.transaction_data || {}
      db.prepare('UPDATE od_faturas SET mp_payment_id=?, mp_external_ref=?, qr_code=?, qr_code_base64=?, link=? WHERE id=?')
        .run(String(d.id), extRef, td.qr_code || null, td.qr_code_base64 || null, td.ticket_url || null, id)
    } catch (e) {
      log('⚠️', `[VISSETV] Pix não gerado para "${a.nome}": ${e.message}`)
      db.prepare('UPDATE od_faturas SET obs=? WHERE id=?').run(('Pix não gerado: ' + e.message).slice(0, 300), id)
    }
  } else {
    db.prepare('UPDATE od_faturas SET obs=? WHERE id=?').run('Pix não gerado: Mercado Pago não configurado (Saques PIX)', id)
  }
  try { marcarDirty() } catch (e) {}
  return db.prepare('SELECT * FROM od_faturas WHERE id=?').get(id)
}

// ── Mensagens no WhatsApp ────────────────────────────────────────────────
async function enviar(a, linhas, f) {
  const tel = telefoneDe(a)
  if (!tel) return { ok: false, erro: 'Anunciante sem WhatsApp cadastrado' }
  try {
    const r = await D.sendText(tel, linhas.join('\n'))
    if (!r?.ok) return { ok: false, erro: r?.error || r?.data?.message || 'O WhatsApp recusou o envio' }
    if (f && f.qr_code) {
      await new Promise(ok => setTimeout(ok, 1000))
      await D.sendText(tel, f.qr_code)
      if (f.qr_code_base64) await D.sendImage(tel, f.qr_code_base64, `QR Code Pix: R$ ${brl(f.valor)}`)
    }
    return { ok: true }
  } catch (e) { return { ok: false, erro: e.message } }
}
function textoPix(f) { return f.qr_code ? ['', 'Pague pelo Pix com o código copia e cola abaixo ou pelo QR Code. O pagamento é reconhecido na hora.'] : ['', 'Responda esta mensagem que a gente te envia o Pix.'] }

async function mandarFatura(a, f) {
  const r = await enviar(a, [
    '*VisseTV: sua fatura chegou*', '',
    `Olá, *${a.nome}*! Segue a fatura do seu anúncio nas TVs da VisseTV.`, '',
    `*Valor:* R$ ${brl(f.valor)}`,
    `*Vencimento:* ${dataBR(f.vence_em)}`,
    ...textoPix(f), '',
    `Se o pagamento não for identificado até ${TOLERANCIA_DIAS} dias depois do vencimento, os anúncios saem do ar até a regularização.`
  ], f)
  D.db.prepare('UPDATE od_faturas SET wa_enviado_em=?, wa_erro=? WHERE id=?').run(r.ok ? agoraISO() : null, r.ok ? null : String(r.erro).slice(0, 300), f.id)
  return r
}
async function mandarLembrete(a, f) {
  const r = await enviar(a, [
    '*VisseTV: sua fatura vence hoje*', '',
    `Olá, *${a.nome}*! A fatura do seu anúncio, de *R$ ${brl(f.valor)}*, vence hoje (${dataBR(f.vence_em)}).`,
    ...textoPix(f)
  ], f)
  if (r.ok) D.db.prepare('UPDATE od_faturas SET lembrete_em=? WHERE id=?').run(agoraISO(), f.id)
  return r
}
async function mandarAvisoPausa(a, f) {
  const r = await enviar(a, [
    '*VisseTV: anúncios pausados*', '',
    `Olá, *${a.nome}*! A fatura de *R$ ${brl(f.valor)}*, que venceu em ${dataBR(f.vence_em)}, não foi paga.`,
    'Por isso seus anúncios saíram do ar nas TVs. Assim que o pagamento for feito, eles voltam sozinhos.',
    ...textoPix(f)
  ], f)
  if (r.ok) D.db.prepare('UPDATE od_faturas SET aviso_pausa_em=? WHERE id=?').run(agoraISO(), f.id)
  return r
}
async function mandarConfirmacao(a, f) {
  return enviar(a, [
    '*VisseTV: pagamento confirmado*', '',
    `Olá, *${a.nome}*! Recebemos R$ ${brl(f.valor)} da fatura com vencimento em ${dataBR(f.vence_em)}.`,
    'Seus anúncios seguem no ar. Obrigado!'
  ])
}

// ── Pagamento ────────────────────────────────────────────────────────────
function confirmarPagamento(f, origem, quando) {
  const { db, log, marcarDirty } = D
  const up = db.prepare(`UPDATE od_faturas SET status='pago', pago_em=?, metodo=CASE WHEN ?='manual' THEN 'manual' ELSE metodo END
    WHERE id=? AND status<>'pago'`).run(quando || agoraISO(), origem, f.id)
  if (!up.changes) return false
  limparCache()
  try { marcarDirty() } catch (e) {}
  const a = db.prepare('SELECT * FROM od_anunciantes WHERE id=?').get(f.anunciante_id)
  log('✅', `[VISSETV] fatura ${f.id} paga (${origem}) ${a ? a.nome : ''} R$${f.valor}`)
  if (a && origem !== 'manual') mandarConfirmacao(a, f).catch(() => {})
  return true
}

// Aviso do Mercado Pago (webhook). Retorna true se o pagamento era da VisseTV.
function pagamentoMercadoPago(pd) {
  const ref = String(pd?.external_reference || '')
  if (!ref.startsWith('vtv-')) return false
  const f = D.db.prepare('SELECT * FROM od_faturas WHERE mp_external_ref=? OR mp_payment_id=?').get(ref, String(pd.id || ''))
  if (f && pd.status === 'approved') confirmarPagamento(f, 'webhook', pd.date_approved)
  return true
}

async function conferirPagamentos() {
  const token = D.mpToken()
  if (!token) return
  const pend = D.db.prepare(`SELECT * FROM od_faturas WHERE status='pendente' AND COALESCE(mp_payment_id,'')<>'' AND created_at > ?`)
    .all(new Date(Date.now() - 20 * 86400000).toISOString())
  for (const f of pend) {
    try {
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(f.mp_payment_id)}`, { headers: { Authorization: `Bearer ${token}` } })
      const pd = r.ok ? await r.json() : null
      if (pd?.status === 'approved') confirmarPagamento(f, 'conferencia', pd.date_approved)
    } catch (e) {}
  }
}

// ── Rotina diária ────────────────────────────────────────────────────────
let _rodando = false
async function rotina() {
  if (_rodando) return
  _rodando = true
  const { db, log } = D
  try {
    const h = horaBrasilia()
    if (h < 9 || h >= 19) return // só em horário comercial
    const dia = hoje()
    const anunciantes = db.prepare(`SELECT * FROM od_anunciantes WHERE ativo=1 AND COALESCE(cobranca_ativa,1)=1
      AND loja_id IS NULL AND COALESCE(valor_mensal,0) > 0`).all()
    for (const a of anunciantes) {
      // 1) Gera a fatura do próximo vencimento quando faltam até 2 dias
      const venc = proximoVencimento(a.dia_vencimento || 10, dia)
      const inicio = String(a.created_at || '').slice(0, 10)
      if (venc <= somaDias(dia, ANTECEDENCIA_DIAS) && (!inicio || venc > inicio)) {
        const ja = db.prepare('SELECT 1 FROM od_faturas WHERE anunciante_id=? AND vence_em=?').get(a.id, venc)
        if (!ja) {
          try {
            const f = await gerarFatura(a, { vence_em: venc, origem: 'auto' })
            const r = await mandarFatura(a, f)
            log(r.ok ? '📨' : '⚠️', `[VISSETV] fatura ${f.id} de "${a.nome}" ${r.ok ? 'enviada' : 'gerada, WhatsApp falhou: ' + r.erro}`)
          } catch (e) { log('⚠️', `[VISSETV] cobrança de "${a.nome}": ${e.message}`) }
        }
      }
      // 2) Fatura aberta: reenvia se não chegou, lembra no vencimento, avisa ao pausar (um aviso por vez)
      let avisouPausa = !!db.prepare(`SELECT 1 FROM od_faturas WHERE anunciante_id=? AND status='pendente' AND aviso_pausa_em IS NOT NULL`).get(a.id)
      for (const f of db.prepare(`SELECT * FROM od_faturas WHERE anunciante_id=? AND status='pendente' ORDER BY vence_em`).all(a.id)) {
        try {
          if (!f.wa_enviado_em && f.vence_em >= somaDias(dia, -TOLERANCIA_DIAS) && Date.now() - Date.parse(f.created_at) > 25 * 60000) await mandarFatura(a, f)
          else if (f.vence_em === dia && !f.lembrete_em) await mandarLembrete(a, f)
          else if (!avisouPausa && f.vence_em < somaDias(dia, -TOLERANCIA_DIAS) && !f.aviso_pausa_em && f.vence_em >= somaDias(dia, -15)) { await mandarAvisoPausa(a, f); avisouPausa = true }
        } catch (e) {}
      }
    }
  } catch (e) { log('⚠️', '[VISSETV] rotina de cobrança: ' + e.message) }
  finally { _rodando = false }
}

function iniciar(deps) {
  if (D) return
  D = deps
  criarTabelas(D.db)
  setTimeout(() => { rotina(); conferirPagamentos() }, 90 * 1000)
  _job = setInterval(() => { rotina().catch(() => {}) }, 30 * 60 * 1000)
  setInterval(() => { conferirPagamentos().catch(() => {}) }, 3 * 60 * 1000)
  D.log('🔄', '[VISSETV] cobrança dos anunciantes ligada')
}
function pronto() { return !!D }

// ── Para o admin ─────────────────────────────────────────────────────────
function situacao(db, a) {
  if (a.cobranca_ativa === 0) return { codigo: 'desligada', texto: 'Cobrança desligada' }
  if (a.loja_id) {
    const t = db.prepare('SELECT expires_at FROM tenants WHERE id=?').get(a.loja_id) || {}
    const pausado = pausadoPorPagamento(db, a.id)
    return { codigo: pausado ? 'pausado' : 'loja', texto: pausado ? 'Pausado: mensalidade da loja atrasada' : 'Junto com a mensalidade do EstimaFood',
      vence_em: t.expires_at ? String(t.expires_at).slice(0, 10) : null }
  }
  const aberta = db.prepare(`SELECT * FROM od_faturas WHERE anunciante_id=? AND status='pendente' ORDER BY vence_em LIMIT 1`).get(a.id)
  const prox = proximoVencimento(a.dia_vencimento || 10, hoje())
  if (!aberta) return { codigo: 'em_dia', texto: 'Em dia', vence_em: prox }
  if (pausadoPorPagamento(db, a.id)) return { codigo: 'pausado', texto: 'Pausado por falta de pagamento', vence_em: aberta.vence_em, fatura_id: aberta.id }
  if (aberta.vence_em < hoje()) return { codigo: 'atrasado', texto: 'Atrasado', vence_em: aberta.vence_em, fatura_id: aberta.id }
  return { codigo: 'aberta', texto: 'Fatura aberta', vence_em: aberta.vence_em, fatura_id: aberta.id }
}

function listarFaturas(db, aid) {
  const sql = `SELECT f.id, f.anunciante_id, f.valor, f.vence_em, f.status, f.metodo, f.origem, f.obs, f.wa_enviado_em, f.wa_erro,
      f.pago_em, f.cancelado_em, f.created_at, f.link, (f.qr_code IS NOT NULL) tem_pix, a.nome anunciante_nome
    FROM od_faturas f JOIN od_anunciantes a ON a.id = f.anunciante_id`
  return aid ? db.prepare(sql + ' WHERE f.anunciante_id=? ORDER BY f.vence_em DESC, f.id DESC LIMIT 60').all(aid)
    : db.prepare(sql + ' ORDER BY f.vence_em DESC, f.id DESC LIMIT 300').all()
}

function resumoMes(db) {
  const mes = hoje().slice(0, 7)
  const recebido = db.prepare(`SELECT COALESCE(SUM(valor),0) v, COUNT(*) n FROM od_faturas WHERE status='pago' AND substr(COALESCE(pago_em,''),1,7)=?`).get(mes)
  const aberto = db.prepare(`SELECT COALESCE(SUM(valor),0) v, COUNT(*) n FROM od_faturas WHERE status='pendente'`).get()
  const atrasado = db.prepare(`SELECT COALESCE(SUM(valor),0) v, COUNT(*) n FROM od_faturas WHERE status='pendente' AND vence_em < ?`).get(hoje())
  return { mes, recebido: recebido.v, recebidas: recebido.n, a_receber: aberto.v, abertas: aberto.n, atrasado: atrasado.v, atrasadas: atrasado.n,
    pausados: idsPausadosPorPagamento(db).size }
}

// Cobrança desligada: as faturas abertas deixam de valer
function cancelarAbertas(db, aid, motivo) {
  const r = db.prepare(`UPDATE od_faturas SET status='cancelado', cancelado_em=?, obs=TRIM(COALESCE(obs,'') || ' ' || ?) WHERE anunciante_id=? AND status='pendente'`)
    .run(agoraISO(), motivo || '', aid)
  limparCache()
  return r.changes
}

module.exports = {
  TOLERANCIA_DIAS, criarTabelas, iniciar, pronto, idsPausadosPorPagamento, pausadoPorPagamento, valorNaFaturaDaLoja,
  gerarFatura, mandarFatura, confirmarPagamento, pagamentoMercadoPago, situacao, listarFaturas, resumoMes, cancelarAbertas,
  proximoVencimento, hoje, limparCache, rotina, conferirPagamentos
}

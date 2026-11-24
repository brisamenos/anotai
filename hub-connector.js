// hub-connector.js — Conector do SuperSaaS para o EstimaFood / Anotai
// Cada loja (tenant) aparece como um cliente no SuperSaaS. Chamado pelo routes.js para /api/hub/v1/*.
// Protegido por um token secreto (variavel de ambiente HUB_TOKEN). Sem HUB_TOKEN, o conector fica desligado.
'use strict'
const crypto = require('crypto')

const SYSTEM = { key: 'estimafood', label: 'EstimaFood', unit: 'pedidos', client_word: 'loja', login_path: '/gestor.html' }
const TZ = 'America/Sao_Paulo'

const todayBR = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const total = (m - 1) + n, ny = y + Math.floor(total / 12), nm = ((total % 12) + 12) % 12
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}
const addDays = (dateStr, n) => new Date(Date.parse(dateStr + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const safeEq = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest())
const DATA_LOCAL = "date(datetime(created_at, '-3 hours'))" // created_at e gravado em UTC
const iso = v => v ? (String(v).includes('T') ? String(v) : String(v).replace(' ', 'T') + 'Z') : null

function precosGlobais(db) {
  let p = { essencial: 79.99, premium: 99.90, fiscal: 159.90 }
  try {
    const c = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
    const g = c && c.ia_config ? JSON.parse(c.ia_config) : {}
    if (g.preco_essencial !== undefined) p.essencial = parseFloat(g.preco_essencial)
    if (g.preco_premium !== undefined) p.premium = parseFloat(g.preco_premium)
  } catch (_) { /* usa os padroes */ }
  return p
}

function buildTenants(db) {
  const today = todayBR(), ms = today.slice(0, 8) + '01'
  const precos = precosGlobais(db)
  const tenants = db.prepare("SELECT * FROM tenants WHERE id NOT LIKE '\\_%' ESCAPE '\\' AND id != 'system' ORDER BY created_at DESC").all()
  const gestores = new Map()
  for (const u of db.prepare("SELECT tenant_id, email FROM sys_users WHERE role = 'gestor' ORDER BY id ASC").all()) if (!gestores.has(u.tenant_id)) gestores.set(u.tenant_id, u.email)
  const agg = new Map(db.prepare(`
    SELECT tenant_id,
      SUM(CASE WHEN ${DATA_LOCAL} = @today THEN 1 ELSE 0 END) at_, SUM(CASE WHEN ${DATA_LOCAL} = @today THEN total ELSE 0 END) vt,
      COUNT(*) am, SUM(total) vm
    FROM orders WHERE status NOT IN ('cancelado','cancelada') AND ${DATA_LOCAL} >= @ms GROUP BY tenant_id`).all({ today, ms }).map(r => [r.tenant_id, r]))
  const last = new Map(db.prepare('SELECT tenant_id, MAX(created_at) la FROM orders GROUP BY tenant_id').all().map(r => [r.tenant_id, r.la]))
  const wa = new Map(db.prepare('SELECT tenant_id, store_whatsapp FROM store_config').all().map(r => [r.tenant_id, r.store_whatsapp]))
  return tenants.map(t => {
    const a = agg.get(t.id) || {}
    const plano = t.plano === 'premium' ? 'premium' : (t.plano === 'fiscal' ? 'fiscal' : 'essencial')
    const base = plano === 'premium' ? precos.premium : plano === 'fiscal' ? precos.fiscal : precos.essencial
    const price = t.valor_mensalidade !== null && t.valor_mensalidade !== undefined && plano !== 'fiscal' ? parseFloat(t.valor_mensalidade) : base
    return {
      id: String(t.id), name: t.nome, slug: t.slug, plan: t.plano || 'basic', active: !!t.ativo,
      expires_at: t.expires_at ? String(t.expires_at).slice(0, 10) : null, price,
      phone: t.telefone_cobranca || wa.get(t.id) || null, email: gestores.get(t.id) || null, created_at: iso(t.created_at),
      stats: { activity_today: a.at_ || 0, volume_today: Math.round((a.vt || 0) * 100) / 100, activity_month: a.am || 0, volume_month: Math.round((a.vm || 0) * 100) / 100, last_activity: iso(last.get(t.id)) }
    }
  })
}

module.exports = async function hubConnector(req, res, ctx) {
  const { upath, db, send, readBody, hashPassword, marcarDirty } = ctx
  if (!upath.startsWith('/api/hub/v1/')) return false
  const secret = process.env.HUB_TOKEN
  if (!secret) { send(res, 404, { error: 'Conector desligado (defina HUB_TOKEN).' }); return true }
  const h = req.headers['authorization'] || ''
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : ''
  if (!token || !safeEq(token, secret)) { send(res, 401, { error: 'Token inválido.' }); return true }

  const rota = upath.slice('/api/hub/v1'.length)
  const dirty = () => { try { if (typeof marcarDirty === 'function') marcarDirty() } catch (_) { /* backup roda no proximo ciclo */ } }

  if (req.method === 'GET' && rota === '/ping') { send(res, 200, { ok: true, ...SYSTEM, version: 1, time: new Date().toISOString() }); return true }
  if (req.method === 'GET' && rota === '/overview') { send(res, 200, { system: SYSTEM, generated_at: new Date().toISOString(), tenants: buildTenants(db) }); return true }

  if (req.method === 'POST' && rota === '/tenants') {
    const b = await readBody(req)
    const { name, email, password, plan, expires_at, phone, price, segmento } = b || {}
    if (!name || String(name).trim().length < 2) { send(res, 400, { error: 'Nome da loja inválido.' }); return true }
    if (!email || !String(email).includes('@')) { send(res, 400, { error: 'E-mail do gestor inválido.' }); return true }
    if (!password || String(password).length < 6) { send(res, 400, { error: 'A senha precisa ter pelo menos 6 caracteres.' }); return true }
    if (db.prepare('SELECT 1 FROM sys_users WHERE LOWER(email) = LOWER(?)').get(email)) { send(res, 409, { error: 'Já existe um login com esse e-mail.' }); return true }
    const slugBase = String(b.slug || name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'loja'
    let slug = slugBase, n = 2
    while (db.prepare('SELECT 1 FROM tenants WHERE slug = ?').get(slug)) { if (b.slug) { send(res, 409, { error: `O link "${slug}" já está em uso.` }); return true } slug = `${slugBase}-${n++}` }
    const seg = ['restaurante', 'acougue'].includes(segmento) ? segmento : 'restaurante'
    const plano = ['premium', 'fiscal'].includes(plan) ? plan : 'basic'
    const exp = /^\d{4}-\d{2}-\d{2}$/.test(String(expires_at || '')) ? expires_at : addMonths(todayBR(), 1)
    const fone = String(phone || '').replace(/\D/g, '')
    const valor = Number(price) > 0 ? Number(price) : null
    try {
      const tid = db.transaction(() => {
        db.prepare('INSERT INTO tenants (nome,plano,slug,segmento,expires_at,valor_mensalidade,telefone_cobranca) VALUES (?,?,?,?,?,?,?)')
          .run(String(name).trim(), plano, slug, seg, exp, valor, (fone.length === 10 || fone.length === 11) ? fone : null)
        const t = db.prepare('SELECT id FROM tenants WHERE slug = ?').get(slug)
        db.prepare('INSERT OR IGNORE INTO store_config (tenant_id) VALUES (?)').run(t.id)
        const maxOrderId = db.prepare('SELECT COALESCE(MAX(id),0) as m FROM orders').get().m || 0
        db.prepare('UPDATE store_config SET order_num_offset=? WHERE tenant_id=?').run(maxOrderId, t.id)
        db.prepare('INSERT INTO sys_users (nome,email,senha_hash,role,tenant_id) VALUES (?,?,?,?,?)').run(String(name).trim(), String(email).trim(), hashPassword(String(password)), 'gestor', t.id)
        const cats = seg === 'acougue'
          ? [['bovinos', 'Bovinos', '🐄'], ['suinos', 'Suínos', '🐷'], ['aves', 'Aves', '🐔'], ['ovinos', 'Ovinos', '🐑'], ['embutidos', 'Embutidos', '🌭'], ['kits', 'Kits & Combos', '📦'], ['temperos', 'Temperos & Acompanhamentos', '🧄']]
          : [['entradas', 'Entradas', '🥗'], ['pratos', 'Pratos', '🍽️'], ['bebidas', 'Bebidas', '🥤'], ['sobremesas', 'Sobremesas', '🍰']]
        const ins = db.prepare("INSERT INTO categories (tenant_id,name,label,type,emoji,sort_order,ativo) VALUES (?,?,?,?,?,?,1)")
        cats.forEach((c, i) => ins.run(t.id, c[0], c[1], 'Itens principais', c[2], i + 1))
        return t.id
      })()
      dirty()
      send(res, 201, { id: String(tid), slug, email: String(email).trim(), expires_at: exp })
    } catch (e) { send(res, 400, { error: e.message }) }
    return true
  }

  const m = rota.match(/^\/tenants\/([^/]+)\/(status|renew|password)$/)
  if (req.method === 'POST' && m) {
    const t = db.prepare('SELECT * FROM tenants WHERE id = ?').get(decodeURIComponent(m[1]))
    if (!t) { send(res, 404, { error: 'Loja não encontrada.' }); return true }
    const b = (await readBody(req)) || {}
    if (m[2] === 'status') {
      db.prepare('UPDATE tenants SET ativo = ? WHERE id = ?').run(b.active ? 1 : 0, t.id); _ativoCache.delete(String(t.id))
      dirty(); send(res, 200, { ok: true, active: !!b.active }); return true
    }
    if (m[2] === 'renew') {
      let next
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) next = b.date
      else {
        const hoje = todayBR(), atual = t.expires_at ? String(t.expires_at).slice(0, 10) : null
        const base = atual && atual > hoje ? atual : hoje
        next = b.days ? addDays(base, Math.max(1, Math.min(3650, Number(b.days) || 30))) : addMonths(base, Math.max(1, Math.min(36, Number(b.months) || 1)))
      }
      db.prepare('UPDATE tenants SET expires_at = ? WHERE id = ?').run(next, t.id)
      dirty(); send(res, 200, { ok: true, expires_at: next }); return true
    }
    const pw = String(b.password || '')
    if (pw.length < 6) { send(res, 400, { error: 'A senha precisa ter pelo menos 6 caracteres.' }); return true }
    const u = db.prepare("SELECT id FROM sys_users WHERE tenant_id = ? AND role = 'gestor' ORDER BY id ASC LIMIT 1").get(t.id)
    if (!u) { send(res, 404, { error: 'Esta loja não tem gestor cadastrado.' }); return true }
    db.prepare('UPDATE sys_users SET senha_hash = ? WHERE id = ?').run(hashPassword(pw), u.id)
    dirty(); send(res, 200, { ok: true }); return true
  }

  send(res, 404, { error: 'Rota do conector não encontrada.' })
  return true
}

// ---------- bloqueio de verdade: loja suspensa não usa o sistema nem logada ----------
// O login do gestor dura "para sempre" e o sistema não reconferia se a loja foi suspensa.
// Este guarda roda antes das rotas: se a sessão (gestor, garçom ou entregador) é de uma loja suspensa, recusa.
const SUSP_MSG = 'Acesso suspenso. Fale com o suporte para regularizar.'
const _ativoCache = new Map()
function lojaAtiva(db, tid) {
  const c = _ativoCache.get(String(tid)); if (c && Date.now() - c.at < 5000) return c.ativo
  let ativo = true; try { const r = db.prepare('SELECT ativo FROM tenants WHERE id = ?').get(tid); ativo = !r || r.ativo !== 0 } catch (_) { /* na dúvida, libera */ }
  _ativoCache.set(String(tid), { ativo, at: Date.now() }); return ativo
}
async function guard(req, res, ctx) {
  const { upath, db, send } = ctx
  if (!upath || !(upath.startsWith('/api/') || upath.startsWith('/rest'))) return false
  if (upath.startsWith('/api/hub/v1/') || upath === '/api/tenant-info-gestor' || /logout$/.test(upath) || upath === '/api/admin-login') return false
  try {
    if (req.method === 'POST' && upath === '/api/gestor-login') { // login de loja suspensa: recusa com mensagem clara
      const body = await ctx.readBody(req); ctx.readBody = async () => body // as rotas leem o mesmo corpo
      const email = String((body && body.email) || '').toLowerCase().trim()
      const u = email ? db.prepare('SELECT tenant_id FROM sys_users WHERE email = ?').get(email) : null
      if (u && u.tenant_id && !lojaAtiva(db, u.tenant_id)) { send(res, 403, { error: SUSP_MSG, suspenso: true }); return true }
      return false
    }
    const auth = req.headers['authorization'] || '', token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (!token) return false
    let tid = null
    for (const t of ['gestor_sessions', 'garcom_sessions', 'entregador_sessions']) {
      try { const r = db.prepare(`SELECT tenant_id FROM ${t} WHERE token = ?`).get(token); if (r) { tid = r.tenant_id; break } } catch (_) { /* tabela ausente */ }
    }
    if (tid && !lojaAtiva(db, tid)) { send(res, 403, { error: SUSP_MSG, suspenso: true }); return true }
  } catch (_) { /* o guarda nunca derruba o sistema */ }
  return false
}
module.exports.guard = guard
module.exports.lojaAtivaLimpar = tid => _ativoCache.delete(String(tid))


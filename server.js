// ═══════════════════════════════════════════════════════
// server.js — Estima Food · Servidor HTTP (roteamento)
// SQLite + REST + SSE + WhatsApp + IA
// ═══════════════════════════════════════════════════════
'use strict'

const http   = require('http')
const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')
const zlib   = require('zlib')

// ── Módulos internos ──────────────────────────────────
const { db, log, jsonParse, fazerBackup, restaurarBackup, marcarDirty, BACKUP_PATH, UPLOADS_DIR } = require('./lib/db')
const { sseSubscribe }                  = require('./lib/sse')
const { handleREST, handleTenantInfo, getTenantId, parseRow } = require('./lib/rest')
const { handleUpload }                  = require('./lib/upload')
const { sendWA, fillVars, sleep, checarAniv, handleOrderStatus, EVO_URL, EVO_KEY, EVO_INST } = require('./lib/wa')
const { handleIAWebhook, handleHumanoAssumiu } = require('./lib/ia')

const PORT = process.env.PORT || 3001

// ── MIME types ────────────────────────────────────────
const MIME = {
  '.html':'.text/html; charset=utf-8',
  '.js':  'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp':'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.json':'application/json',
}

// ── Cache de ETags de arquivos estáticos ──────────────
const etagCache = new Map()

function getEtag(fpath) {
  const cached = etagCache.get(fpath)
  const mtime  = fs.statSync(fpath).mtimeMs
  if (cached && cached.mtime === mtime) return cached.etag
  const content = fs.readFileSync(fpath)
  const etag    = '"' + crypto.createHash('md5').update(content).digest('hex') + '"'
  etagCache.set(fpath, { mtime, etag })
  return etag
}

// ── Helpers HTTP ──────────────────────────────────────
function sendJSON(res, status, data) {
  const body = JSON.stringify(data)
  res.setHeader('Content-Type', 'application/json')

  // Gzip para respostas maiores que 1 KB
  const acceptEnc = res.req?.headers?.['accept-encoding'] || ''
  if (body.length > 1024 && acceptEnc.includes('gzip')) {
    zlib.gzip(body, (err, buf) => {
      if (err) {
        res.writeHead(status)
        res.end(body)
        return
      }
      res.setHeader('Content-Encoding', 'gzip')
      res.setHeader('Vary', 'Accept-Encoding')
      res.writeHead(status)
      res.end(buf)
    })
    return
  }
  res.writeHead(status)
  res.end(body)
}

function send(res, status, data) { sendJSON(res, status, data) }

function readBody(req) {
  return new Promise((ok, err) => {
    let b = ''
    req.on('data', c => b += c)
    req.on('end', () => { try { ok(b ? JSON.parse(b) : {}) } catch { ok({}) } })
    req.on('error', err)
  })
}

// ── Servir arquivo estático com ETag + Cache-Control ──
function serveStatic(req, res, fpath, ext) {
  try {
    const etag  = getEtag(fpath)
    const isHtml = ext === '.html'

    // Imagens e assets: cache 1 semana
    // HTML: sem cache (sempre fresco)
    const cc = isHtml
      ? 'no-cache'
      : 'public, max-age=604800, immutable'

    res.setHeader('Cache-Control', cc)
    res.setHeader('ETag', etag)

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304)
      res.end()
      return
    }

    res.setHeader('Content-Type', MIME[ext] || 'text/plain')

    // Gzip para text/html, js, css
    if (['.html', '.js', '.css'].includes(ext)) {
      const content = fs.readFileSync(fpath)
      const ae = req.headers['accept-encoding'] || ''
      if (ae.includes('gzip')) {
        zlib.gzip(content, (err, buf) => {
          if (err) { res.writeHead(200); res.end(content); return }
          res.setHeader('Content-Encoding', 'gzip')
          res.setHeader('Vary', 'Accept-Encoding')
          res.writeHead(200)
          res.end(buf)
        })
        return
      }
      res.writeHead(200)
      res.end(content)
      return
    }

    // Arquivos binários — stream direto
    res.writeHead(200)
    fs.createReadStream(fpath).pipe(res)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
}

// ════════════════════════════════════════════════════════
// HTTP SERVER
// ════════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  // Injeta req em res para o helper de gzip
  res.req = req

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Prefer,apikey,Authorization,x-tenant-id')
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return }

  const url    = new URL(req.url, `http://localhost:${PORT}`)
  const upath  = url.pathname.replace(/\/$/, '') || '/'
  const params = url.searchParams

  // ── SSE ──────────────────────────────────────────────
  if (upath.startsWith('/sse/')) {
    const channel = decodeURIComponent(upath.slice(5))
    sseSubscribe(channel, res)
    return
  }

  // ── API / REST ────────────────────────────────────────

  // tenant-info (cardápio público)
  if (req.method === 'GET' && upath === '/api/tenant-info') {
    const info = handleTenantInfo(params)
    send(res, info.error ? 404 : 200, info); return
  }

  // tenant-slug
  if (req.method === 'GET' && upath === '/api/tenant-slug') {
    const tid = req.headers['x-tenant-id'] || params.get('tenant_id') || ''
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatório' }); return }
    const row = db.prepare('SELECT slug FROM tenants WHERE id=?').get(tid)
    send(res, 200, { slug: row?.slug || '' }); return
  }

  // tenant-info-gestor
  if (req.method === 'GET' && upath === '/api/tenant-info-gestor') {
    const tid = req.headers['x-tenant-id'] || params.get('tenant_id') || ''
    if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatório' }); return }
    const row = db.prepare('SELECT id,nome,slug,plano,ativo,expires_at FROM tenants WHERE id=?').get(tid)
    if (!row) { send(res, 404, { error: 'Tenant não encontrado' }); return }
    send(res, 200, row); return
  }

  // status / health-check
  if (upath === '/status') {
    send(res, 200, {
      ok: true,
      uptime: Math.floor(process.uptime()),
      db: 'sqlite-multitenant',
      version: '4.0.0',
      backup: fs.existsSync(BACKUP_PATH) ? fs.statSync(BACKUP_PATH).mtime : null,
    }); return
  }

  // order-status
  if (req.method === 'POST' && upath === '/api/order-status') {
    await handleOrderStatus(req, res, send); return
  }

  // customer-register
  if (req.method === 'POST' && upath === '/api/customer-register') {
    const body = await readBody(req)
    const tid  = getTenantId(req, params)
    const { name, phone, email, senha, birthday } = body
    if (!name || !phone || !senha) { send(res, 400, { error: 'Nome, telefone e senha são obrigatórios' }); return }
    if (!tid) { send(res, 400, { error: 'Tenant não identificado' }); return }
    try {
      const hash     = crypto.createHash('sha256').update(senha).digest('hex')
      const existing = db.prepare('SELECT id FROM customers WHERE tenant_id=? AND phone=?').get(tid, phone)
      if (existing) {
        db.prepare('UPDATE customers SET name=?,email=?,birthday=?,senha_hash=? WHERE tenant_id=? AND phone=?').run(name, email||null, birthday||null, hash, tid, phone)
        const c = db.prepare('SELECT id,name,phone,email,birthday,orders_count,total_spent,created_at FROM customers WHERE tenant_id=? AND phone=?').get(tid, phone)
        send(res, 200, { ...c, token: Buffer.from(`${c.id}:${tid}:${hash.slice(0,16)}`).toString('base64') }); return
      }
      const info = db.prepare('INSERT INTO customers (tenant_id,name,phone,email,birthday,senha_hash,orders_count,total_spent) VALUES (?,?,?,?,?,?,0,0)').run(tid, name, phone, email||null, birthday||null, hash)
      const c    = db.prepare('SELECT id,name,phone,email,birthday,orders_count,total_spent,created_at FROM customers WHERE id=?').get(info.lastInsertRowid)
      marcarDirty()
      send(res, 201, { ...c, token: Buffer.from(`${c.id}:${tid}:${hash.slice(0,16)}`).toString('base64') }); return
    } catch(e) { send(res, 400, { error: e.message }); return }
  }

  // customer-login
  if (req.method === 'POST' && upath === '/api/customer-login') {
    const body  = await readBody(req)
    const tid   = getTenantId(req, params)
    const { phone, senha } = body
    if (!phone || !senha) { send(res, 400, { error: 'Telefone e senha obrigatórios' }); return }
    if (!tid) { send(res, 400, { error: 'Tenant não identificado' }); return }
    try {
      const hash = crypto.createHash('sha256').update(senha).digest('hex')
      const c    = db.prepare('SELECT id,name,phone,email,birthday,orders_count,total_spent,created_at,senha_hash FROM customers WHERE tenant_id=? AND phone=?').get(tid, phone)
      if (!c || !c.senha_hash) { send(res, 401, { error: 'Telefone não cadastrado' }); return }
      if (c.senha_hash !== hash) { send(res, 401, { error: 'Senha incorreta' }); return }
      const { senha_hash: _, ...safe } = c
      send(res, 200, { ...safe, token: Buffer.from(`${c.id}:${tid}:${hash.slice(0,16)}`).toString('base64') }); return
    } catch(e) { send(res, 400, { error: e.message }); return }
  }

  // customer-orders
  if (req.method === 'GET' && upath === '/api/customer-orders') {
    const tid = getTenantId(req, params)
    const cid = params.get('customer_id')
    if (!tid || !cid) { send(res, 400, { error: 'Parâmetros faltando' }); return }
    try {
      const rows = db.prepare('SELECT id,client,phone,addr,items,total,taxa,pag,status,created_at FROM orders WHERE tenant_id=? AND customer_id=? ORDER BY id DESC LIMIT 30').all(tid, cid)
      send(res, 200, rows.map(r => ({ ...r, items: (() => { try { return JSON.parse(r.items) } catch { return [] } })() }))); return
    } catch(e) { send(res, 400, { error: e.message }); return }
  }

  // criar-tenant
  if (req.method === 'POST' && upath === '/api/criar-tenant') {
    const body = await readBody(req)
    const { nome, plano, slug, email, senha, role, nomeGestor } = body
    if (!nome || !email || !senha) { send(res, 400, { error: 'nome, email e senha obrigatórios' }); return }
    try {
      const hash     = crypto.createHash('sha256').update(senha).digest('hex')
      const slugBase = slug || nome.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
      let slugFinal  = slugBase, suffix = 2
      while (db.prepare('SELECT id FROM tenants WHERE slug=?').get(slugFinal)) slugFinal = `${slugBase}-${suffix++}`
      if (slug && slugFinal !== slug) { send(res, 400, { error: `Slug "${slug}" já em uso. Sugerimos: "${slugFinal}"` }); return }
      if (db.prepare('SELECT id FROM sys_users WHERE email=?').get(email)) { send(res, 400, { error: `E-mail "${email}" já cadastrado.` }); return }
      db.prepare('INSERT INTO tenants (nome,plano,slug) VALUES (?,?,?)').run(nome, plano||'basic', slugFinal)
      const t = db.prepare('SELECT id FROM tenants WHERE slug=?').get(slugFinal)
      db.prepare('INSERT OR IGNORE INTO store_config (tenant_id) VALUES (?)').run(t.id)
      db.prepare('INSERT INTO sys_users (nome,email,senha_hash,role,tenant_id) VALUES (?,?,?,?,?)').run(nomeGestor||nome, email, hash, role||'gestor', t.id)
      marcarDirty()
      setTimeout(() => fazerBackup(true), 2000)
      send(res, 201, { ok: true, tenant_id: t.id, slug: slugFinal }); return
    } catch(e) { send(res, 400, { error: e.message }); return }
  }

  // backup manual
  if (req.method === 'POST' && upath === '/api/backup') {
    fazerBackup(true)
    const size = fs.existsSync(BACKUP_PATH) ? fs.statSync(BACKUP_PATH).size : 0
    send(res, 200, { ok: true, path: BACKUP_PATH, size }); return
  }

  // restore manual
  if (req.method === 'POST' && upath === '/api/restore') {
    const ok = restaurarBackup()
    send(res, 200, { ok, msg: ok ? 'Restauração concluída' : 'Nenhum backup encontrado' }); return
  }

  // Proxy Evolution API
  if (upath.startsWith('/api/evo')) {
    const tenantId = req.headers['x-tenant-id']
    if (!tenantId) { send(res, 401, { error: 'x-tenant-id obrigatório' }); return }
    const cfg    = db.prepare('SELECT evo_instance FROM store_config WHERE tenant_id=?').get(tenantId)
    const instance = cfg?.evo_instance || null
    const body   = ['POST','DELETE'].includes(req.method) ? await readBody(req) : {}
    const action = upath.replace('/api/evo', '')
    if (req.method === 'POST' && body.instanceName === undefined && instance) body.instanceName = instance
    const evoPath = action.replace(':instance', instance || '')
    try {
      const r    = await fetch(`${EVO_URL}${evoPath}`, { method: req.method, headers: { 'Content-Type': 'application/json', apikey: EVO_KEY }, body: req.method !== 'GET' ? JSON.stringify(body) : undefined })
      const data = await r.json().catch(() => ({}))
      if (evoPath.startsWith('/instance/create') && r.ok && body.instanceName) {
        db.prepare('UPDATE store_config SET evo_instance=? WHERE tenant_id=?').run(body.instanceName, tenantId)
      }
      send(res, r.status, data); return
    } catch(e) { send(res, 500, { error: e.message }); return }
  }

  // enviar WA avulso
  if (req.method === 'POST' && upath === '/enviar') {
    const { phone, text, tenant_id } = await readBody(req)
    if (!phone || !text) { send(res, 400, { ok: false, error: 'phone e text obrigatórios' }); return }
    const tid    = tenant_id || req.headers['x-tenant-id']
    const cfgEnv = tid ? db.prepare('SELECT evo_instance FROM store_config WHERE tenant_id=?').get(tid) : null
    const r      = await sendWA(phone, text, cfgEnv?.evo_instance)
    send(res, r.ok ? 200 : 500, r); return
  }

  // Promoção em massa
  if (req.method === 'POST' && upath === '/promocao') {
    const body     = await readBody(req)
    const { destino='todos', msg, tenant_id } = body
    if (!msg) { send(res, 400, { ok: false, error: 'msg obrigatório' }); return }
    const tid    = tenant_id || req.headers['x-tenant-id']
    const cfgP   = tid ? db.prepare('SELECT evo_instance FROM store_config WHERE tenant_id=?').get(tid) : null
    const instP  = cfgP?.evo_instance || EVO_INST
    let cl = db.prepare('SELECT * FROM fidelidade WHERE phone IS NOT NULL' + (tid ? ' AND tenant_id=?' : '')).all(...(tid ? [tid] : []))
    if (destino === 'com_pedido') cl = cl.filter(c => c.orders_count > 0)
    if (!cl.length) { send(res, 200, { ok: true, enviados: 0 }); return }
    send(res, 200, { ok: true, total: cl.length, msg: 'Envio iniciado' })
    ;(async () => {
      let ok = 0, fail = 0
      for (const c of cl) { const r = await sendWA(c.phone, fillVars(msg, { nome: c.name }), instP); r.ok ? ok++ : fail++; await sleep(1500) }
      log('📢', `Promoção: ${ok} ok, ${fail} fail`)
    })()
    return
  }

  // Aniversário manual
  if (req.method === 'POST' && upath === '/aniversario') {
    checarAniv(); send(res, 200, { ok: true }); return
  }

  // rastreio-wa
  if (req.method === 'POST' && upath === '/api/rastreio-wa') {
    const { phone, order_id, tenant_id } = await readBody(req)
    if (!phone || !order_id || !tenant_id) { send(res, 400, { ok: false }); return }
    const cfg  = db.prepare('SELECT evo_instance,store_name,ia_config FROM store_config WHERE tenant_id=?').get(tenant_id)
    const inst = cfg?.evo_instance || EVO_INST
    const ia   = jsonParse(cfg?.ia_config) || {}
    if (!ia.ativo && !ia.resp_rastreio_manual) { send(res, 200, { ok: false, msg: 'IA inativa' }); return }
    const pedido = db.prepare('SELECT id,status,items,total FROM orders WHERE id=? AND tenant_id=?').get(order_id, tenant_id)
    if (!pedido) { send(res, 400, { ok: false }); return }
    const sl      = { analise:'⏳ aguardando confirmação', producao:'👨‍🍳 em preparo', pronto:'🛵 saindo para entrega', entregue:'✅ entregue', cancelado:'❌ cancelado' }
    const nomeLoja = cfg?.store_name || 'Restaurante'
    const msg = `🍽️ *${nomeLoja}*\n\nOlá! Seu pedido *#${String(pedido.id).padStart(3,'0')}* está:\n\n${sl[pedido.status]||pedido.status}\n\nTotal: R$ ${parseFloat(pedido.total).toFixed(2).replace('.',',')}\n\nQualquer dúvida é só responder! 😊`
    const r = await sendWA(phone, msg, inst)
    send(res, r.ok ? 200 : 500, r); return
  }

  // ia-humano-assumiu
  if (req.method === 'POST' && upath === '/api/ia-humano-assumiu') {
    await handleHumanoAssumiu(req, res, send); return
  }

  // IA webhook
  if (req.method === 'POST' && (upath.startsWith('/webhook/whatsapp') || upath.startsWith('/webhook/'))) {
    await handleIAWebhook(req, res, send); return
  }

  // ── REST genérico (/api/:table e /rest/v1/:table) ───
  const isApiRoute   = upath.startsWith('/api/')
  const isRestRoute  = upath.startsWith('/rest/v1/')
  const _specialApis = new Set(['/api/tenant-info','/api/tenant-slug','/api/tenant-info-gestor','/api/order-status','/api/customer-register','/api/customer-login','/api/customer-orders','/api/criar-tenant','/api/backup','/api/restore','/api/ia-humano-assumiu','/api/rastreio-wa'])
  if ((isApiRoute && !_specialApis.has(upath) && !upath.startsWith('/api/evo')) || isRestRoute) {
    const table = upath.split('/')[isRestRoute ? 3 : 2]
    const body  = ['POST','PATCH'].includes(req.method) ? await readBody(req) : {}
    await handleREST(req, res, table, params, body, send); return
  }

  // ── Upload de imagens ─────────────────────────────
  if (req.method === 'POST' && upath.startsWith('/storage/v1/object/')) {
    await handleUpload(req, res, send); return
  }

  // ── Servir imagens (uploads) ──────────────────────
  if (req.method === 'GET' && (upath.startsWith('/uploads/') || upath.startsWith('/storage/v1/object/public/'))) {
    const fname = path.basename(upath)
    const fpath = path.join(UPLOADS_DIR, fname)
    if (fs.existsSync(fpath)) {
      const ext = path.extname(fpath)
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
      res.setHeader('Cache-Control', 'public, max-age=2592000') // 30 dias
      res.writeHead(200)
      fs.createReadStream(fpath).pipe(res)
    } else { res.writeHead(404); res.end('Not found') }
    return
  }

  // ── Arquivos estáticos ────────────────────────────
  if (req.method === 'GET') {
    const fname = upath === '/' ? 'index.html' : upath.slice(1)
    const fpath = path.join(__dirname, fname)
    if (fs.existsSync(fpath) && !fname.includes('..')) {
      const ext = path.extname(fpath)
      serveStatic(req, res, fpath, ext)
      return
    }
  }

  send(res, 404, { ok: false, error: `Rota não encontrada: ${req.method} ${upath}` })
})

server.listen(PORT, () => {
  log('🚀', `Servidor rodando na porta ${PORT}`)
  log('🏢', `Multi-tenant · SQLite`)
})

// ── Schedulers ────────────────────────────────────────
setInterval(checarAniv, 60000)
setTimeout(checarAniv,  5000)

// ── Graceful shutdown ─────────────────────────────────
function shutdown() {
  fazerBackup(true)
  db.close()
  server.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT',  shutdown)

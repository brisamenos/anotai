// ═══════════════════════════════════════════════════════
// lib/rest.js — Motor REST multi-tenant (SQLite)
// ═══════════════════════════════════════════════════════
'use strict'

const { db, jsonParse, marcarDirty } = require('./db')
const { emit } = require('./sse')

// ── Schema de colunas por tabela ──────────────────────
const TABLE_COLS = {
  tenants:      ['id','nome','plano','ativo','slug','expires_at','created_at'],
  sys_users:    ['id','tenant_id','nome','email','senha_hash','role','ativo','ultimo_acesso','created_at'],
  store_config: ['id','tenant_id','store_open','caixa_open','delivery_fee_config','fid_config',
                 'evo_automacoes','evo_aniv_last','wa_server_url','sidebar_state','evo_instance',
                 'store_name','store_descricao','store_logo_url','store_banner_url','store_cor',
                 'store_tempo_entrega','store_avaliacao','store_whatsapp','gestor_tema',
                 'ia_config','horarios_config'],
  categories:   ['id','tenant_id','name','label','type','promo','emoji','sort_order','ativo'],
  menu_items:   ['id','tenant_id','name','description','price','price_old','category_id','cat',
                 'cat_key','emoji','image_url','promo','status','item_type','allow_half',
                 'max_flavors','days','ingredients','created_at'],
  cupons:       ['id','tenant_id','code','type','value','min_order','uses_left','ativo','expires_at'],
  mesas:        ['id','tenant_id','num','status','guests','opened_at','total','pag_forma','updated_at'],
  garcons:      ['id','tenant_id','nome','usuario','senha','ativo'],
  orders:       ['id','tenant_id','client','phone','addr','items','total','taxa','pag','troco',
                 'status','mesa_num','garcom_id','garcom_nome','customer_id','created_at'],
  movimentos:   ['id','tenant_id','description','tipo','val','pag','time','created_at'],
  estoque:      ['id','tenant_id','name','qty','unit','min_qty','cost','updated_at'],
  fidelidade:   ['id','tenant_id','name','phone','birthday','pts','max_pts','orders_count','resgates','created_at'],
  customers:    ['id','tenant_id','name','phone','addr','orders_count','total_spent','last_order_at',
                 'email','birthday','senha_hash','customer_id','created_at'],
  ratings:      ['id','tenant_id','order_id','client','phone','nota','comentario','created_at'],
}

// Tabelas que NÃO filtram por tenant
const NO_TENANT_FILTER = new Set(['tenants','sys_users'])

// Campos JSON (armazenados como texto no SQLite)
const JSON_FIELDS = {
  orders:       new Set(['items']),
  menu_items:   new Set(['days','ingredients']),
  store_config: new Set(['delivery_fee_config','fid_config','evo_automacoes','sidebar_state','horarios_config']),
}

// Campos booleanos (SQLite 0/1)
const BOOL_FIELDS = new Set(['ativo','store_open','caixa_open'])

// Tabelas que disparam SSE
const SSE_TABLES = new Set(['orders','mesas','store_config','menu_items','categories','garcons'])

// ── Parsers ───────────────────────────────────────────
function parseRow(table, row) {
  if (!row) return row
  const out = { ...row }
  const jf  = JSON_FIELDS[table]
  if (jf) for (const f of jf) { if (f in out) out[f] = jsonParse(out[f]) }
  for (const f of BOOL_FIELDS) { if (f in out) out[f] = out[f] === 1 || out[f] === true }
  return out
}

function sanitize(v) {
  if (v === undefined || v === null || v === '') return null
  if (v === true)  return 1
  if (v === false) return 0
  return v
}

function serialize(table, body) {
  const out = { ...body }
  const jf  = JSON_FIELDS[table]
  if (jf) for (const f of jf) { if (f in out && typeof out[f] !== 'string') out[f] = JSON.stringify(out[f]) }
  return out
}

// ── WHERE builder ─────────────────────────────────────
function buildWhere(params, cols, tenantId, table) {
  const conds = [], vals = []
  const colSet = new Set(cols)

  if (tenantId && !NO_TENANT_FILTER.has(table)) {
    conds.push('"tenant_id" = ?')
    vals.push(tenantId)
  }

  for (const [key, val] of params.entries()) {
    if (['_single','select','order','limit','offset','_tenant'].includes(key)) continue
    if (!colSet.has(key) && key !== 'or') continue

    let m
    if (key === 'or') {
      const parts = val.replace(/^\(|\)$/g, '').split(',')
      const orC = []
      for (const p of parts) {
        const pm = p.match(/^(\w+)\.(eq|neq)\.(.+)$/)
        if (pm && colSet.has(pm[1])) { orC.push(`"${pm[1]}" ${pm[2]==='eq'?'=':'!='} ?`); vals.push(pm[3]) }
      }
      if (orC.length) conds.push(`(${orC.join(' OR ')})`)
      continue
    }
    if ((m = val.match(/^eq\.(.+)$/)))    { let v=m[1]==='null'?null:m[1]; if(v==='true')v=1;else if(v==='false')v=0; conds.push(`"${key}" = ?`);  vals.push(v); continue }
    if ((m = val.match(/^neq\.(.+)$/)))   { let v=m[1]; if(v==='true')v=1;else if(v==='false')v=0; conds.push(`"${key}" != ?`); vals.push(v); continue }
    if ((m = val.match(/^gte\.(.+)$/)))   { conds.push(`"${key}" >= ?`); vals.push(m[1]); continue }
    if ((m = val.match(/^lte\.(.+)$/)))   { conds.push(`"${key}" <= ?`); vals.push(m[1]); continue }
    if ((m = val.match(/^gt\.(.+)$/)))    { conds.push(`"${key}" > ?`);  vals.push(m[1]); continue }
    if ((m = val.match(/^lt\.(.+)$/)))    { conds.push(`"${key}" < ?`);  vals.push(m[1]); continue }
    if (val === 'not.is.null') { conds.push(`"${key}" IS NOT NULL`); continue }
    if (val === 'is.null')     { conds.push(`"${key}" IS NULL`);     continue }
    if ((m = val.match(/^in\.\((.+)\)$/))) {
      const items = m[1].split(',').map(s => s.trim())
      conds.push(`"${key}" IN (${items.map(() => '?').join(',')})`)
      vals.push(...items); continue
    }
  }
  return { WHERE: conds.length ? `WHERE ${conds.join(' AND ')}` : '', vals }
}

function buildOrder(str, cols) {
  if (!str) return ''
  const colSet = new Set(cols)
  const parts  = str.split(',').map(p => {
    const [c, d] = p.trim().split('.')
    return colSet.has(c) ? `"${c}" ${d === 'desc' ? 'DESC' : 'ASC'}` : null
  }).filter(Boolean)
  return parts.length ? `ORDER BY ${parts.join(', ')}` : ''
}

function getTenantId(req, params) {
  return req.headers['x-tenant-id'] || params.get('_tenant') || null
}

// ── Handler principal ─────────────────────────────────
async function handleREST(req, res, table, params, body, sendFn) {
  const cols = TABLE_COLS[table]
  if (!cols) return sendFn(res, 404, { error: 'Tabela não encontrada' })

  const tenantId         = getTenantId(req, params)
  const { WHERE, vals }  = buildWhere(params, cols, tenantId, table)
  const isSingle         = req.headers['prefer']?.includes('single') || params.get('_single') === 'true'

  // ── GET ────────────────────────────────────────────
  if (req.method === 'GET') {
    const ORDER  = buildOrder(params.get('order') || '', cols)
    const limit  = parseInt(params.get('limit') || '1000')
    const offset = parseInt(params.get('offset') || '0')
    const sel    = params.get('select')

    let selectCols = '*'
    if (sel) {
      const valid = sel.split(',').map(s => s.trim().split(':')[0]).filter(c => cols.includes(c) || c === '*')
      if (valid.length) selectCols = valid.map(c => c === '*' ? '*' : `"${c}"`).join(', ')
    }

    // store_config — acesso por tenant_id
    if (table === 'store_config' && tenantId) {
      try {
        let row = db.prepare('SELECT * FROM store_config WHERE tenant_id=?').get(tenantId)
        if (!row) {
          db.prepare('INSERT OR IGNORE INTO store_config (tenant_id) VALUES (?)').run(tenantId)
          row = db.prepare('SELECT * FROM store_config WHERE tenant_id=?').get(tenantId)
        }
        return sendFn(res, 200, isSingle ? parseRow(table, row) : [parseRow(table, row)])
      } catch(e) { return sendFn(res, 400, { error: e.message }) }
    }

    // JOIN: sys_users + tenants
    if (table === 'sys_users' && sel?.includes('tenants')) {
      const rows = db.prepare(`SELECT u.*,t.nome as t_nome,t.plano as t_plano,t.ativo as t_ativo,t.expires_at as t_expires_at FROM sys_users u LEFT JOIN tenants t ON u.tenant_id=t.id ${WHERE} ${ORDER} LIMIT ? OFFSET ?`).all(...vals, limit, offset)
      const mapped = rows.map(r => { const{t_nome,t_plano,t_ativo,t_expires_at,...u}=r; u.tenants={nome:t_nome,plano:t_plano,ativo:t_ativo===1,expires_at:t_expires_at}; return parseRow(table,u) })
      return sendFn(res, 200, isSingle ? (mapped[0] || null) : mapped)
    }

    // JOIN: tenants + contagem sys_users
    if (table === 'tenants' && sel?.includes('sys_users')) {
      const rows   = db.prepare(`SELECT * FROM tenants ${WHERE} ${ORDER} LIMIT ? OFFSET ?`).all(...vals, limit, offset)
      const cntStmt = db.prepare('SELECT COUNT(*) as c FROM sys_users WHERE tenant_id=?')
      const mapped = rows.map(r => { const c = cntStmt.get(r.id); r.sys_users = Array(c?.c||0).fill({}); return parseRow(table, r) })
      return sendFn(res, 200, isSingle ? (mapped[0] || null) : mapped)
    }

    try {
      if (isSingle) {
        const row = db.prepare(`SELECT ${selectCols} FROM "${table}" ${WHERE} ${ORDER} LIMIT 1`).get(...vals)
        return sendFn(res, row ? 200 : 406, row ? parseRow(table, row) : { error: 'Not found' })
      }
      const rows = db.prepare(`SELECT ${selectCols} FROM "${table}" ${WHERE} ${ORDER} LIMIT ? OFFSET ?`).all(...vals, limit, offset)
      return sendFn(res, 200, rows.map(r => parseRow(table, r)))
    } catch(e) { return sendFn(res, 400, { error: e.message }) }
  }

  // ── POST ───────────────────────────────────────────
  if (req.method === 'POST') {
    const isUpsert    = req.headers['prefer']?.includes('resolution=merge-duplicates')
    const returnRep   = req.headers['prefer']?.includes('return=representation')
    try {
      const payload = serialize(table, body)
      if (tenantId && !NO_TENANT_FILTER.has(table) && !payload.tenant_id) payload.tenant_id = tenantId

      // store_config — sempre upsert
      if (table === 'store_config') {
        const scTid = tenantId || payload.tenant_id
        if (!scTid) return sendFn(res, 400, { error: 'tenant_id obrigatório' })
        payload.tenant_id = scTid
        const keys = Object.keys(payload).filter(k => cols.includes(k))
        const setClause = keys.filter(k => k !== 'tenant_id').map(k => `"${k}"=excluded."${k}"`).join(', ')
        db.prepare(`INSERT INTO store_config (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')}) ON CONFLICT(tenant_id) DO UPDATE SET ${setClause}`).run(...keys.map(k => sanitize(payload[k])))
        const row = db.prepare('SELECT * FROM store_config WHERE tenant_id=?').get(scTid)
        marcarDirty()
        return sendFn(res, 200, parseRow(table, row))
      }

      const keys = Object.keys(payload).filter(k => cols.includes(k))
      if (!keys.length) return sendFn(res, 400, { error: 'Sem campos válidos' })
      const colList = keys.map(k => `"${k}"`).join(', ')
      const phs     = keys.map(() => '?').join(', ')
      let stmt
      if (isUpsert) {
        const upd = keys.filter(k => k !== 'id' && k !== 'tenant_id').map(k => `"${k}"=excluded."${k}"`).join(', ')
        const conflict = table === 'mesas' ? '(tenant_id,num)' : '(id)'
        stmt = db.prepare(`INSERT INTO "${table}" (${colList}) VALUES (${phs}) ON CONFLICT${conflict} DO UPDATE SET ${upd}`)
      } else {
        stmt = db.prepare(`INSERT INTO "${table}" (${colList}) VALUES (${phs})`)
      }
      const info = stmt.run(...keys.map(k => sanitize(payload[k])))
      const rawForEmit = db.prepare(`SELECT * FROM "${table}" WHERE rowid=?`).get(info.lastInsertRowid)
      const parsedForEmit = rawForEmit ? parseRow(table, rawForEmit) : null
      let inserted = null
      if (returnRep) {
        if (table === 'sys_users' && rawForEmit) {
          const t = db.prepare('SELECT nome,plano,ativo,expires_at FROM tenants WHERE id=?').get(rawForEmit.tenant_id)
          inserted = parseRow(table, { ...rawForEmit, tenants: t ? { nome:t.nome,plano:t.plano,ativo:t.ativo===1,expires_at:t.expires_at } : null })
        } else {
          inserted = parsedForEmit
        }
      }
      if (SSE_TABLES.has(table)) emit(tenantId || payload.tenant_id, table, parsedForEmit || payload, 'INSERT')
      marcarDirty()
      return sendFn(res, 201, returnRep ? inserted : { id: info.lastInsertRowid })
    } catch(e) { return sendFn(res, 400, { error: e.message }) }
  }

  // ── PATCH ──────────────────────────────────────────
  if (req.method === 'PATCH') {
    try {
      const payload   = serialize(table, body)
      const keys      = Object.keys(payload).filter(k => cols.includes(k))
      if (!keys.length) return sendFn(res, 400, { error: 'Sem campos válidos' })

      if (table === 'store_config') {
        const pTid = tenantId || payload.tenant_id || vals[0] || null
        if (!pTid) return sendFn(res, 400, { error: 'tenant_id obrigatório' })
        const upsertKeys = [...new Set([...keys, 'tenant_id'])].filter(k => cols.includes(k))
        if (!payload.tenant_id) payload.tenant_id = pTid
        const setClause = upsertKeys.filter(k => k !== 'tenant_id').map(k => `"${k}"=excluded."${k}"`).join(', ')
        db.prepare(`INSERT INTO store_config (${upsertKeys.map(k=>`"${k}"`).join(',')}) VALUES (${upsertKeys.map(()=>'?').join(',')}) ON CONFLICT(tenant_id) DO UPDATE SET ${setClause}`).run(...upsertKeys.map(k => sanitize(payload[k] ?? (k === 'tenant_id' ? pTid : null))))
        const row = db.prepare('SELECT * FROM store_config WHERE tenant_id=?').get(pTid)
        const parsed = parseRow(table, row)
        emit(pTid, table, parsed, 'UPDATE')
        marcarDirty()
        return sendFn(res, 200, parsed)
      }

      const setClause = keys.map(k => `"${k}"=?`).join(', ')
      db.prepare(`UPDATE "${table}" SET ${setClause} ${WHERE}`).run(...keys.map(k => sanitize(payload[k])), ...vals)
      if (SSE_TABLES.has(table)) {
        const updatedRow = db.prepare(`SELECT * FROM "${table}" ${WHERE} LIMIT 1`).get(...vals)
        emit(tenantId || payload.tenant_id, table, updatedRow ? parseRow(table, updatedRow) : payload, 'UPDATE')
      }
      marcarDirty()
      return sendFn(res, 200, { updated: 1 })
    } catch(e) { return sendFn(res, 400, { error: e.message }) }
  }

  // ── DELETE ─────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!WHERE) return sendFn(res, 400, { error: 'DELETE sem filtro não permitido' })
    try {
      const info = db.prepare(`DELETE FROM "${table}" ${WHERE}`).run(...vals)
      if (SSE_TABLES.has(table)) emit(tenantId, table, {}, 'DELETE')
      marcarDirty()
      return sendFn(res, 200, { deleted: info.changes })
    } catch(e) { return sendFn(res, 400, { error: e.message }) }
  }
}

// ── tenant-info (cardápio público) ────────────────────
function handleTenantInfo(params) {
  const slug = params.get('slug'), id = params.get('id'), useDefault = params.get('default')
  if (!slug && !id && !useDefault) return { error: 'Informe slug ou id' }
  const t = slug
    ? db.prepare('SELECT id,nome,slug FROM tenants WHERE slug=? AND ativo=1').get(slug)
    : id
      ? db.prepare('SELECT id,nome,slug FROM tenants WHERE id=? AND ativo=1').get(id)
      : db.prepare('SELECT id,nome,slug FROM tenants WHERE ativo=1 ORDER BY id ASC LIMIT 1').get()
  if (!t) return { error: 'Restaurante não encontrado' }
  const cfg = db.prepare('SELECT store_name,store_descricao,store_logo_url,store_banner_url,store_cor,store_tempo_entrega,store_avaliacao,store_whatsapp FROM store_config WHERE tenant_id=?').get(t.id)
  return { ...t, branding: cfg || {} }
}

module.exports = { handleREST, handleTenantInfo, TABLE_COLS, getTenantId, parseRow }

// ═══════════════════════════════════════════════════════
// ESTIMA FOOD — Servidor Completo (SQLite + REST + SSE)
// Node.js 18+ | GitHub + Easypanel
// ═══════════════════════════════════════════════════════

const http        = require('http')
const fs          = require('fs')
const path        = require('path')
const crypto      = require('crypto')
const { execSync } = require('child_process')

// ── Instala better-sqlite3 se necessário ─────────────────
try { require.resolve('better-sqlite3') } catch(e) {
  console.log('Instalando better-sqlite3...')
  execSync('npm install better-sqlite3', { stdio: 'inherit' })
}
const Database = require('better-sqlite3')

// ── Configurações ─────────────────────────────────────────
const PORT       = process.env.PORT           || 3001
const EVO_URL    = process.env.EVOLUTION_URL  || 'https://projeto-evolution-api.xtknqq.easypanel.host'
const EVO_KEY    = process.env.EVOLUTION_KEY  || '429683C4C977415CAAFCCE10F7D57E11'
const EVO_INST   = process.env.EVOLUTION_INST || 'estima-food'
const DB_PATH    = process.env.DB_PATH        || '/app/data/estima.db'
const UPLOADS_DIR= process.env.UPLOADS_DIR    || '/app/data/uploads'

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
fs.mkdirSync(UPLOADS_DIR, { recursive: true })

// ── Log colorido ──────────────────────────────────────────
function log(emoji, msg, data) {
  const time = new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })
  console.log(`[${time}] ${emoji}  ${msg}`, data ? JSON.stringify(data) : '')
}

// ── Banco SQLite ──────────────────────────────────────────
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    nome TEXT NOT NULL, plano TEXT DEFAULT 'basic', ativo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sys_users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    tenant_id TEXT REFERENCES tenants(id), nome TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL, senha_hash TEXT NOT NULL,
    role TEXT DEFAULT 'gestor', ativo INTEGER DEFAULT 1,
    ultimo_acesso TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS store_config (
    id INTEGER PRIMARY KEY DEFAULT 1, store_open INTEGER DEFAULT 1,
    caixa_open INTEGER DEFAULT 0, delivery_fee_config TEXT DEFAULT '{}',
    fid_config TEXT DEFAULT '{}', evo_automacoes TEXT DEFAULT '{}',
    evo_aniv_last TEXT, wa_server_url TEXT, sidebar_state TEXT DEFAULT '{}'
  );
  INSERT OR IGNORE INTO store_config (id) VALUES (1);
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    emoji TEXT, sort_order INTEGER DEFAULT 0, ativo INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    description TEXT, price REAL NOT NULL, category_id INTEGER REFERENCES categories(id),
    image_url TEXT, status TEXT DEFAULT 'ativo', created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS cupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL,
    type TEXT DEFAULT 'percent', value REAL NOT NULL, min_order REAL DEFAULT 0,
    uses_left INTEGER DEFAULT -1, ativo INTEGER DEFAULT 1, expires_at TEXT
  );
  CREATE TABLE IF NOT EXISTS mesas (
    num INTEGER PRIMARY KEY, status TEXT DEFAULT 'free',
    guests INTEGER DEFAULT 0, opened_at TEXT, updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS garcons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL,
    usuario TEXT UNIQUE NOT NULL, senha TEXT NOT NULL, ativo INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, client TEXT, phone TEXT,
    addr TEXT, items TEXT DEFAULT '[]', total REAL DEFAULT 0, taxa REAL DEFAULT 0,
    pag TEXT DEFAULT 'dinheiro', status TEXT DEFAULT 'analise',
    mesa_num INTEGER, garcom_id INTEGER, garcom_nome TEXT, tenant_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS movimentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT,
    tipo TEXT DEFAULT 'entrada', val REAL DEFAULT 0, pag TEXT,
    time TEXT DEFAULT (datetime('now')), created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS estoque (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    qty REAL DEFAULT 0, unit TEXT DEFAULT 'un', min_qty REAL DEFAULT 0,
    cost REAL DEFAULT 0, updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS fidelidade (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT,
    birthday TEXT, pts INTEGER DEFAULT 0, max_pts INTEGER DEFAULT 500,
    orders_count INTEGER DEFAULT 0, resgates INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT UNIQUE,
    addr TEXT, orders_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
  );
`)

// Superadmin padrão
const adminExists = db.prepare("SELECT id FROM sys_users WHERE role='superadmin' LIMIT 1").get()
if (!adminExists) {
  const hash = crypto.createHash('sha256').update('admin123').digest('hex')
  db.prepare("INSERT OR IGNORE INTO tenants (id,nome,plano) VALUES ('default','Estima Food','premium')").run()
  const t = db.prepare("SELECT id FROM tenants LIMIT 1").get()
  db.prepare("INSERT INTO sys_users (nome,email,senha_hash,role,tenant_id) VALUES (?,?,?,?,?)")
    .run('Administrador','admin@estimafood.com',hash,'superadmin',t.id)
  log('🔑','Superadmin criado: admin@estimafood.com / admin123')
}

// ═══════════════════════════════════════════════════════
// SSE — Server-Sent Events (substitui Supabase Realtime)
// ═══════════════════════════════════════════════════════
const sseClients = new Map()

function sseSubscribe(channel, res) {
  res.writeHead(200, {
    'Content-Type':'text/event-stream','Cache-Control':'no-cache',
    'Connection':'keep-alive','Access-Control-Allow-Origin':'*'
  })
  res.write(': connected\n\n')
  if (!sseClients.has(channel)) sseClients.set(channel, new Set())
  sseClients.get(channel).add(res)
  const ka = setInterval(() => { try { res.write(': ping\n\n') } catch(e) { clearInterval(ka) } }, 25000)
  res.on('close', () => { clearInterval(ka); sseClients.get(channel)?.delete(res) })
}

function sseBroadcast(channel, event, data) {
  const clients = sseClients.get(channel)
  if (!clients?.size) return
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const r of clients) { try { r.write(msg) } catch(e) { clients.delete(r) } }
}

function emit(table, record, type) {
  // Canais fixos (gestor)
  const fixed = ['orders-rt','mesas-rt','store-config-rt','*']
  fixed.forEach(ch => sseBroadcast(ch, table+':'+type, record))

  // Canais dinâmicos dos garçons: 'garcom-mesas-{id}' e 'garcom-orders-{id}'
  // O servidor emite para TODOS os canais abertos que comecem com o prefixo
  for (const [ch] of sseClients) {
    if (ch.startsWith('garcom-mesas-') || ch.startsWith('garcom-orders-')) {
      sseBroadcast(ch, table+':'+type, record)
    }
  }
}

// ═══════════════════════════════════════════════════════
// REST ENGINE — compatível com a sintaxe do Supabase JS
// ═══════════════════════════════════════════════════════
const TABLE_COLS = {
  tenants:['id','nome','plano','ativo','created_at'],
  sys_users:['id','tenant_id','nome','email','senha_hash','role','ativo','ultimo_acesso','created_at'],
  store_config:['id','store_open','caixa_open','delivery_fee_config','fid_config','evo_automacoes','evo_aniv_last','wa_server_url','sidebar_state'],
  categories:['id','name','emoji','sort_order','ativo'],
  menu_items:['id','name','description','price','category_id','image_url','status','created_at'],
  cupons:['id','code','type','value','min_order','uses_left','ativo','expires_at'],
  mesas:['num','status','guests','opened_at','updated_at'],
  garcons:['id','nome','usuario','senha','ativo'],
  orders:['id','client','phone','addr','items','total','taxa','pag','status','mesa_num','garcom_id','garcom_nome','tenant_id','created_at'],
  movimentos:['id','description','tipo','val','pag','time','created_at'],
  estoque:['id','name','qty','unit','min_qty','cost','updated_at'],
  fidelidade:['id','name','phone','birthday','pts','max_pts','orders_count','resgates','created_at'],
  customers:['id','name','phone','addr','orders_count','created_at'],
}

const JSON_FIELDS = {
  orders:['items'],
  store_config:['delivery_fee_config','fid_config','evo_automacoes','sidebar_state']
}

function jsonParse(v) { if(typeof v!=='string')return v; try{return JSON.parse(v)}catch(e){return v} }

function parseRow(table, row) {
  if (!row) return row
  const out = {...row}
  for (const f of (JSON_FIELDS[table]||[])) { if(f in out) out[f]=jsonParse(out[f]) }
  for (const f of ['ativo','store_open','caixa_open']) { if(f in out) out[f]=out[f]===1||out[f]===true }
  return out
}

function serialize(table, body) {
  const out = {...body}
  for (const f of (JSON_FIELDS[table]||[])) { if(f in out && typeof out[f]!=='string') out[f]=JSON.stringify(out[f]) }
  return out
}

function buildWhere(params, cols) {
  const conds=[], vals=[]
  for (const [key,val] of params.entries()) {
    if(['_single','select','order','limit','offset'].includes(key)) continue
    if(!cols.includes(key)&&key!=='or') continue
    let m
    if(key==='or'){
      const parts=val.replace(/^\(|\)$/g,'').split(',')
      const orC=[]
      for(const p of parts){
        const pm=p.match(/^(\w+)\.(eq|neq)\.(.+)$/)
        if(pm&&cols.includes(pm[1])){orC.push(`"${pm[1]}" ${pm[2]==='eq'?'=':'!='} ?`);vals.push(pm[3])}
      }
      if(orC.length) conds.push(`(${orC.join(' OR ')})`)
      continue
    }
    if((m=val.match(/^eq\.(.+)$/)))   { conds.push(`"${key}" = ?`);  vals.push(m[1]==='null'?null:m[1]); continue }
    if((m=val.match(/^neq\.(.+)$/)))  { conds.push(`"${key}" != ?`); vals.push(m[1]); continue }
    if((m=val.match(/^gte\.(.+)$/)))  { conds.push(`"${key}" >= ?`); vals.push(m[1]); continue }
    if((m=val.match(/^lte\.(.+)$/)))  { conds.push(`"${key}" <= ?`); vals.push(m[1]); continue }
    if((m=val.match(/^gt\.(.+)$/)))   { conds.push(`"${key}" > ?`);  vals.push(m[1]); continue }
    if((m=val.match(/^lt\.(.+)$/)))   { conds.push(`"${key}" < ?`);  vals.push(m[1]); continue }
    if(val==='not.is.null') { conds.push(`"${key}" IS NOT NULL`); continue }
    if(val==='is.null')     { conds.push(`"${key}" IS NULL`);     continue }
    if((m=val.match(/^in\.\((.+)\)$/))) {
      const items=m[1].split(',').map(s=>s.trim())
      conds.push(`"${key}" IN (${items.map(()=>'?').join(',')})`)
      vals.push(...items); continue
    }
  }
  return { WHERE: conds.length?`WHERE ${conds.join(' AND ')}`:'', vals }
}

function buildOrder(str, cols) {
  if (!str) return ''
  const parts = str.split(',').map(p=>{ const[c,d]=p.trim().split('.'); return cols.includes(c)?`"${c}" ${d==='desc'?'DESC':'ASC'}`:null }).filter(Boolean)
  return parts.length ? `ORDER BY ${parts.join(', ')}` : ''
}

async function handleREST(req, res, table, params, body) {
  const cols = TABLE_COLS[table]
  if (!cols) return send(res,404,{error:'Tabela não encontrada'})
  const { WHERE, vals } = buildWhere(params, cols)

  // GET
  if (req.method==='GET') {
    const isSingle = req.headers['prefer']?.includes('single') || params.get('_single')==='true'
    const ORDER = buildOrder(params.get('order')||'', cols)
    const limit = parseInt(params.get('limit')||'1000')
    const offset= parseInt(params.get('offset')||'0')
    const sel   = params.get('select')
    let selectCols = '*'
    if (sel) {
      const valid = sel.split(',').map(s=>s.trim().split(':')[0]).filter(c=>cols.includes(c)||c==='*')
      if (valid.length) selectCols = valid.map(c=>`"${c}"`).join(', ')
    }
    // JOIN: sys_users + tenants
    if (table==='sys_users' && sel?.includes('tenants')) {
      const rows = db.prepare(`SELECT u.*,t.nome as t_nome,t.plano as t_plano,t.ativo as t_ativo FROM sys_users u LEFT JOIN tenants t ON u.tenant_id=t.id ${WHERE} ${ORDER} LIMIT ? OFFSET ?`).all(...vals,limit,offset)
      const mapped = rows.map(r=>{const{t_nome,t_plano,t_ativo,...u}=r;u.tenants={nome:t_nome,plano:t_plano,ativo:t_ativo===1};return parseRow(table,u)})
      return send(res,200,isSingle?(mapped[0]||null):mapped)
    }
    // JOIN: tenants + contagem sys_users
    if (table==='tenants' && sel?.includes('sys_users')) {
      const rows = db.prepare(`SELECT * FROM tenants ${WHERE} ${ORDER} LIMIT ? OFFSET ?`).all(...vals,limit,offset)
      const mapped = rows.map(r=>{const c=db.prepare("SELECT COUNT(*) as c FROM sys_users WHERE tenant_id=?").get(r.id);r.sys_users=Array(c?.c||0).fill({});return parseRow(table,r)})
      return send(res,200,isSingle?(mapped[0]||null):mapped)
    }
    try {
      if (isSingle) {
        const row = db.prepare(`SELECT ${selectCols} FROM "${table}" ${WHERE} ${ORDER} LIMIT 1`).get(...vals)
        return send(res,row?200:406,row?parseRow(table,row):{error:'Not found'})
      }
      const rows = db.prepare(`SELECT ${selectCols} FROM "${table}" ${WHERE} ${ORDER} LIMIT ? OFFSET ?`).all(...vals,limit,offset)
      return send(res,200,rows.map(r=>parseRow(table,r)))
    } catch(e) { return send(res,400,{error:e.message}) }
  }

  // POST
  if (req.method==='POST') {
    const isUpsert = req.headers['prefer']?.includes('resolution=merge-duplicates')
    try {
      const payload = serialize(table, body)
      const keys = Object.keys(payload).filter(k=>cols.includes(k))
      if (!keys.length) return send(res,400,{error:'Sem campos válidos'})
      const colList = keys.map(k=>`"${k}"`).join(', ')
      const phs = keys.map(()=>'?').join(', ')
      const conflictKey = table==='mesas'?'num':'id'
      let stmt
      if (isUpsert) {
        const upd = keys.filter(k=>k!==conflictKey).map(k=>`"${k}"=excluded."${k}"`).join(', ')
        stmt = db.prepare(`INSERT INTO "${table}" (${colList}) VALUES (${phs}) ON CONFLICT("${conflictKey}") DO UPDATE SET ${upd}`)
      } else {
        stmt = db.prepare(`INSERT INTO "${table}" (${colList}) VALUES (${phs})`)
      }
      const info = stmt.run(...keys.map(k=>payload[k]))
      const newId = info.lastInsertRowid
      const returnRep = req.headers['prefer']?.includes('return=representation')
      let inserted = null
      if (returnRep) {
        const pkCol = table==='mesas'?'num':'id'
        inserted = db.prepare(`SELECT * FROM "${table}" WHERE "${pkCol}"=?`).get(newId||payload[pkCol])
        inserted = parseRow(table, inserted)
      }
      if (['orders','mesas','store_config'].includes(table)) emit(table,inserted||{id:newId,...payload},'INSERT')
      return send(res,201,returnRep?inserted:{id:newId})
    } catch(e) { return send(res,400,{error:e.message}) }
  }

  // PATCH
  if (req.method==='PATCH') {
    try {
      const payload = serialize(table, body)
      const keys = Object.keys(payload).filter(k=>cols.includes(k))
      if (!keys.length) return send(res,400,{error:'Sem campos válidos'})
      const setClause = keys.map(k=>`"${k}"=?`).join(', ')
      const info = db.prepare(`UPDATE "${table}" SET ${setClause} ${WHERE}`).run(...keys.map(k=>payload[k]),...vals)
      if (['orders','mesas','store_config'].includes(table)) emit(table,{...payload},'UPDATE')
      return send(res,200,{updated:info.changes})
    } catch(e) { return send(res,400,{error:e.message}) }
  }

  // DELETE
  if (req.method==='DELETE') {
    if (!WHERE) return send(res,400,{error:'DELETE sem filtro não permitido'})
    try {
      const info = db.prepare(`DELETE FROM "${table}" ${WHERE}`).run(...vals)
      if (['orders','mesas'].includes(table)) emit(table,{},'DELETE')
      return send(res,200,{deleted:info.changes})
    } catch(e) { return send(res,400,{error:e.message}) }
  }
}

// ═══════════════════════════════════════════════════════
// UPLOAD DE IMAGENS (substitui Supabase Storage)
// ═══════════════════════════════════════════════════════
function handleUpload(req, res) {
  return new Promise(resolve => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks)
        const ct = req.headers['content-type']||''
        const boundary = ct.split('boundary=')[1]
        let fname = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
        let url = `/uploads/${fname}`
        if (!boundary) {
          // JSON base64
          const body = JSON.parse(buffer.toString())
          const ext  = (body.mime||'image/jpeg').split('/')[1]||'jpg'
          fname = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
          fs.writeFileSync(path.join(UPLOADS_DIR,fname),Buffer.from(body.data,'base64'))
          url = `/uploads/${fname}`
        } else {
          const raw  = buffer.toString('binary')
          const parts = raw.split('--'+boundary).filter(p=>p.includes('filename='))
          if (parts.length) {
            const [head,...bodyParts] = parts[0].split('\r\n\r\n')
            const fnMatch = head.match(/filename="([^"]+)"/)
            if (fnMatch) {
              const ext = path.extname(fnMatch[1])||'.jpg'
              fname = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
              url = `/uploads/${fname}`
              const fileContent = bodyParts.join('\r\n\r\n').replace(/\r\n$/,'')
              fs.writeFileSync(path.join(UPLOADS_DIR,fname),Buffer.from(fileContent,'binary'))
            }
          }
        }
        resolve(send(res,200,{url,publicUrl:url}))
      } catch(e) { resolve(send(res,400,{error:e.message})) }
    })
  })
}

// ═══════════════════════════════════════════════════════
// WHATSAPP
// ═══════════════════════════════════════════════════════
async function sendWA(phone, text) {
  const num = phone.replace(/\D/g,'')
  const number = num.startsWith('55')?num:`55${num}`
  try {
    const r = await fetch(`${EVO_URL}/message/sendText/${EVO_INST}`,{
      method:'POST',headers:{'Content-Type':'application/json',apikey:EVO_KEY},
      body:JSON.stringify({number,text})
    })
    const data = await r.json().catch(()=>({}))
    if (r.ok){log('📤',`Enviado para ${number}`);return{ok:true,data}}
    log('❌',`Falhou ${number}:`,data);return{ok:false,data}
  } catch(e){log('❌','Erro WA:',{error:e.message});return{ok:false,error:e.message}}
}

function fillVars(tpl, vars) {
  let t=tpl; Object.entries(vars).forEach(([k,v])=>{t=t.replaceAll(`{${k}}`,v??'')}) ; return t
}

// ── Scheduler aniversários ────────────────────────────
let _anivLast = null
async function checarAniv() {
  try {
    const cfg  = db.prepare("SELECT evo_automacoes,evo_aniv_last FROM store_config WHERE id=1").get()
    const auto = jsonParse(cfg?.evo_automacoes)||{}
    const ca   = auto['aniversario']||{}
    if (!ca.on) return
    const now    = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Fortaleza'}))
    const today  = `${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
    const hora   = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
    if (_anivLast===today||cfg?.evo_aniv_last===today) return
    if (hora<(auto._aniv_hora||'09:00')) return
    _anivLast = today
    const clientes = db.prepare("SELECT * FROM fidelidade WHERE birthday IS NOT NULL AND phone IS NOT NULL").all()
    const anivs    = clientes.filter(c=>c.birthday&&c.phone&&c.birthday.slice(5)===today)
    if (!anivs.length){db.prepare("UPDATE store_config SET evo_aniv_last=? WHERE id=1").run(today);return}
    log('🎂',`${anivs.length} aniversariante(s) hoje`)
    for (const c of anivs){await sendWA(c.phone,fillVars(ca.msg,{nome:c.name}));await sleep(1500)}
    db.prepare("UPDATE store_config SET evo_aniv_last=? WHERE id=1").run(today)
  } catch(e){log('❌','Erro aniv:',{error:e.message})}
}

// ── Checker pedidos ───────────────────────────────────
const processed = new Set()
async function checarPedidos() {
  try {
    const cfg  = db.prepare("SELECT evo_automacoes FROM store_config WHERE id=1").get()
    const auto = jsonParse(cfg?.evo_automacoes)||{}
    const desde = new Date(Date.now()-86400000).toISOString().slice(0,19).replace('T',' ')
    const pedidos = db.prepare(`SELECT * FROM orders WHERE phone IS NOT NULL AND created_at>=? AND status IN ('producao','pronto','cancelado','finalizado') ORDER BY id DESC LIMIT 50`).all(desde)
    for (const o of pedidos) {
      const chave=`${o.id}_${o.status}`
      if (processed.has(chave)) continue
      processed.add(chave)
      const tipo={producao:'confirmado',pronto:'pronto',cancelado:'cancelado',finalizado:'avaliacao'}[o.status]
      if (!tipo) continue
      const ct=auto[tipo]||{}; if(!ct.on) continue
      const items=(() => { try{return(JSON.parse(o.items)||[]).map(i=>`${i.qty}x ${i.name}`).join(', ')}catch(e){return''} })()
      const vars={ nome:o.client||'Cliente', id:String(o.id), itens:items, total:(parseFloat(o.total)||0).toFixed(2).replace('.',','),
        endereco:o.addr||'', mesa:String(o.mesa_num||''),
        tipo_entrega:(o.addr||'').includes('Mesa')?'🪑 Mesa':(o.addr||'').includes('alcão')?'🏪 Balcão':'🛵 Entrega' }
      await sendWA(o.phone, fillVars(ct.msg, vars)); await sleep(800)
      if (o.status==='finalizado') {
        const cp=auto['pontos']||{}; if(cp.on&&o.phone){
          await sleep(5000)
          const fid=db.prepare("SELECT * FROM fidelidade WHERE phone=? OR name=? LIMIT 1").get(o.phone,o.client)
          if(fid){const pg=Math.floor((parseFloat(o.total)||0)*10);const pt=(fid.pts||0)+pg;const pf=Math.max(0,(fid.max_pts||500)-pt)
            await sendWA(o.phone,fillVars(cp.msg,{nome:fid.name||o.client,pontos_ganhos:String(pg),pontos_total:String(pt),pontos_faltam:String(pf)}))}
        }
      }
    }
    if(processed.size>1000){const a=[...processed];a.slice(0,500).forEach(k=>processed.delete(k))}
  } catch(e){log('❌','Erro pedidos:',{error:e.message})}
}

// ═══════════════════════════════════════════════════════
// HTTP SERVER
// ═══════════════════════════════════════════════════════
function send(res,status,data){res.setHeader('Content-Type','application/json');res.writeHead(status);res.end(JSON.stringify(data))}
function readBody(req){return new Promise((ok,err)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{ok(b?JSON.parse(b):{})}catch(e){ok({})}});req.on('error',err)})}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.svg':'image/svg+xml','.webp':'image/webp'}

const server = http.createServer(async (req,res) => {
  res.setHeader('Access-Control-Allow-Origin','*')
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Prefer,apikey,Authorization')
  if(req.method==='OPTIONS'){res.writeHead(200);res.end();return}

  const url  = new URL(req.url,`http://localhost:${PORT}`)
  const upath= url.pathname.replace(/\/$/,'')||'/'
  const params=url.searchParams

  // SSE
  if(upath.startsWith('/sse/')){sseSubscribe(upath.slice(5),res);return}

  // REST API — /rest/v1/:table (mantém HTMLs sem alteração) + /api/:table
  if(upath.startsWith('/rest/v1/')||upath.startsWith('/api/')){
    const table = upath.split('/')[upath.startsWith('/api/')?2:3]
    const body  = ['POST','PATCH'].includes(req.method)?await readBody(req):{}
    await handleREST(req,res,table,params,body); return
  }

  // Upload de imagens
  if(req.method==='POST'&&upath.startsWith('/storage/v1/object/')){await handleUpload(req,res);return}

  // Servir imagens — /uploads/:file e /storage/v1/object/public/...
  if(req.method==='GET'&&(upath.startsWith('/uploads/')||upath.startsWith('/storage/v1/object/public/'))){
    const fname=path.basename(upath)
    const fpath=path.join(UPLOADS_DIR,fname)
    if(fs.existsSync(fpath)){
      const ext=path.extname(fpath)
      res.setHeader('Content-Type',MIME[ext]||'application/octet-stream')
      res.writeHead(200);fs.createReadStream(fpath).pipe(res)
    } else {res.writeHead(404);res.end('Not found')}
    return
  }

  // Status
  if(upath==='/status'){send(res,200,{ok:true,uptime:Math.floor(process.uptime()),db:'sqlite',version:'2.0.0'});return}

  // WA avulso
  if(req.method==='POST'&&upath==='/enviar'){
    const{phone,text}=await readBody(req)
    if(!phone||!text){send(res,400,{ok:false,error:'phone e text obrigatórios'});return}
    const r=await sendWA(phone,text);send(res,r.ok?200:500,r);return
  }

  // Promoção em massa
  if(req.method==='POST'&&upath==='/promocao'){
    const{destino='todos',msg}=await readBody(req)
    if(!msg){send(res,400,{ok:false,error:'msg obrigatório'});return}
    let cl=db.prepare("SELECT * FROM fidelidade WHERE phone IS NOT NULL").all()
    if(destino==='com_pedido') cl=cl.filter(c=>c.orders_count>0)
    if(!cl.length){send(res,200,{ok:true,enviados:0});return}
    send(res,200,{ok:true,total:cl.length,msg:'Envio iniciado'})
    ;(async()=>{let ok=0,fail=0;for(const c of cl){const r=await sendWA(c.phone,fillVars(msg,{nome:c.name}));r.ok?ok++:fail++;await sleep(1500)};log('📢',`Promoção: ${ok} ok, ${fail} fail`)})()
    return
  }

  // Aniversário manual
  if(req.method==='POST'&&upath==='/aniversario'){_anivLast=null;checarAniv();send(res,200,{ok:true});return}

  // Arquivos estáticos
  if(req.method==='GET'){
    const fname = upath==='/'?'index.html':upath.slice(1)
    const fpath = path.join(__dirname,fname)
    if(fs.existsSync(fpath)&&!fname.includes('..')){
      const ext=path.extname(fpath)
      res.setHeader('Content-Type',MIME[ext]||'text/plain')
      res.writeHead(200);fs.createReadStream(fpath).pipe(res);return
    }
  }

  send(res,404,{ok:false,error:`Rota não encontrada: ${req.method} ${upath}`})
})

server.listen(PORT,()=>{
  log('🚀',`Servidor rodando na porta ${PORT}`)
  log('🗄️ ',`SQLite: ${DB_PATH}`)
  log('📱',`Evolution: ${EVO_URL} | ${EVO_INST}`)
})

setInterval(checarAniv,60000)
setInterval(checarPedidos,15000)
setTimeout(checarAniv,3000)
setTimeout(checarPedidos,5000)
log('🎂','Scheduler aniversários ativo (60s)')
log('📦','Checker pedidos ativo (15s)')

process.on('SIGTERM',()=>{db.close();server.close();process.exit(0)})
process.on('SIGINT', ()=>{db.close();server.close();process.exit(0)})

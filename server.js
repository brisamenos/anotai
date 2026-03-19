// ═══════════════════════════════════════════════════════
// ESTIMA FOOD — Servidor Multi-Tenant (SQLite + REST + SSE)
// Cada restaurante tem seus próprios dados isolados
// ═══════════════════════════════════════════════════════

const http         = require('http')
const fs           = require('fs')
const path         = require('path')
const crypto       = require('crypto')
const Database     = require('better-sqlite3')

const PORT        = process.env.PORT           || 3001
const EVO_URL     = process.env.EVOLUTION_URL  || 'https://projeto-evolution-api.xtknqq.easypanel.host'
const EVO_KEY     = process.env.EVOLUTION_KEY  || '429683C4C977415CAAFCCE10F7D57E11'
const EVO_INST    = process.env.EVOLUTION_INST || 'estima-food'
const DB_PATH     = process.env.DB_PATH        || '/app/data/estima.db'
const UPLOADS_DIR = process.env.UPLOADS_DIR    || '/app/data/uploads'

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
fs.mkdirSync(UPLOADS_DIR, { recursive: true })

function log(emoji, msg, data) {
  const t = new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })
  console.log(`[${t}] ${emoji}  ${msg}`, data ? JSON.stringify(data) : '')
}

// ── Diagnóstico de persistência ────────────────────────
const _dbExistia = fs.existsSync(DB_PATH)
log('💾', `Banco: ${DB_PATH}`)
log(_dbExistia ? '✅' : '🆕', _dbExistia
  ? `Banco existente encontrado — dados preservados`
  : `Banco NOVO — se isso aparecer após um deploy, o volume /app/data NÃO está montado no Easypanel!`
)
log('📁', `Uploads: ${UPLOADS_DIR}`)

// ════════════════════════════════════════════════════════
// BANCO SQLite
// ════════════════════════════════════════════════════════
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ── Backup/Restore automático ─────────────────────────
// Salva um snapshot JSON a cada 5 minutos e também a cada criação de tenant.
// Se o banco sumir (volume não montado), restaura automaticamente do JSON.
const BACKUP_PATH = path.join(path.dirname(DB_PATH), 'backup.json')

function fazerBackup() {
  try {
    const TABELAS_BACKUP = ['tenants','sys_users','store_config','categories','menu_items',
      'cupons','mesas','garcons','orders','movimentos','estoque','fidelidade','customers']
    const snapshot = { ts: new Date().toISOString(), tabelas: {} }
    for (const t of TABELAS_BACKUP) {
      try { snapshot.tabelas[t] = db.prepare(`SELECT * FROM "${t}"`).all() } catch(e) { snapshot.tabelas[t] = [] }
    }
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(snapshot), 'utf8')
    log('💾', `Backup salvo em ${BACKUP_PATH} (${Object.values(snapshot.tabelas).reduce((a,b)=>a+b.length,0)} registros)`)
  } catch(e) {
    log('❌', 'Erro ao salvar backup:', { error: e.message })
  }
}

function restaurarBackup() {
  if (!fs.existsSync(BACKUP_PATH)) {
    log('⚠️', 'Nenhum backup encontrado para restaurar.')
    return false
  }
  try {
    const snapshot = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'))
    const tabelas = snapshot.tabelas || {}
    log('♻️', `Restaurando backup de ${snapshot.ts}...`)

    const ordem = ['tenants','sys_users','store_config','categories','menu_items',
      'cupons','mesas','garcons','orders','movimentos','estoque','fidelidade','customers']

    for (const t of ordem) {
      const rows = tabelas[t]
      if (!rows || !rows.length) continue
      try {
        const cols = Object.keys(rows[0])
        const placeholders = cols.map(() => '?').join(',')
        const colList = cols.map(c => `"${c}"`).join(',')
        const stmt = db.prepare(`INSERT OR IGNORE INTO "${t}" (${colList}) VALUES (${placeholders})`)
        const insertMany = db.transaction((items) => {
          let ok = 0
          for (const row of items) {
            try { stmt.run(Object.values(row)); ok++ } catch(e) {}
          }
          return ok
        })
        const ok = insertMany(rows)
        log('♻️', `  ${t}: ${ok}/${rows.length} registros restaurados`)
      } catch(e) {
        log('❌', `  Erro ao restaurar ${t}:`, { error: e.message })
      }
    }
    log('✅', 'Restauração concluída!')
    return true
  } catch(e) {
    log('❌', 'Erro ao ler backup:', { error: e.message })
    return false
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    nome TEXT NOT NULL, plano TEXT DEFAULT 'basic', ativo INTEGER DEFAULT 1,
    slug TEXT UNIQUE, expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sys_users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
    nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    senha_hash TEXT NOT NULL, role TEXT DEFAULT 'gestor',
    ativo INTEGER DEFAULT 1, ultimo_acesso TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Tabelas multi-tenant: todas têm tenant_id
  CREATE TABLE IF NOT EXISTS store_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    store_open INTEGER DEFAULT 1, caixa_open INTEGER DEFAULT 0,
    delivery_fee_config TEXT DEFAULT '{}', fid_config TEXT DEFAULT '{}',
    evo_automacoes TEXT DEFAULT '{}', evo_aniv_last TEXT,
    wa_server_url TEXT, sidebar_state TEXT DEFAULT '{}',
    store_name TEXT, store_descricao TEXT,
    store_logo_url TEXT, store_banner_url TEXT,
    store_cor TEXT DEFAULT '#3b82f6',
    store_tempo_entrega TEXT DEFAULT '30-45 min',
    store_avaliacao TEXT DEFAULT '5.0',
    store_whatsapp TEXT,
    gestor_tema TEXT
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL, label TEXT, type TEXT DEFAULT 'Itens principais',
    promo INTEGER DEFAULT 0, emoji TEXT, sort_order INTEGER DEFAULT 0, ativo INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL, description TEXT, price REAL NOT NULL,
    price_old REAL, category_id INTEGER REFERENCES categories(id),
    cat TEXT, cat_key TEXT,
    emoji TEXT, image_url TEXT,
    promo INTEGER DEFAULT 0, status TEXT DEFAULT 'ativo',
    item_type TEXT DEFAULT 'normal',
    allow_half INTEGER DEFAULT 0, max_flavors INTEGER DEFAULT 1,
    days TEXT DEFAULT '[1,1,1,1,1,1,1]',
    ingredients TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS cupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code TEXT NOT NULL, type TEXT DEFAULT 'percent', value REAL NOT NULL,
    min_order REAL DEFAULT 0, uses_left INTEGER DEFAULT -1,
    ativo INTEGER DEFAULT 1, expires_at TEXT,
    UNIQUE(tenant_id, code)
  );
  CREATE TABLE IF NOT EXISTS mesas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    num INTEGER NOT NULL, status TEXT DEFAULT 'free',
    guests INTEGER DEFAULT 0, opened_at TEXT,
    total REAL DEFAULT 0, pag_forma TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(tenant_id, num)
  );
  CREATE TABLE IF NOT EXISTS garcons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nome TEXT NOT NULL, usuario TEXT NOT NULL, senha TEXT NOT NULL,
    ativo INTEGER DEFAULT 1,
    UNIQUE(tenant_id, usuario)
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client TEXT, phone TEXT, addr TEXT, items TEXT DEFAULT '[]',
    total REAL DEFAULT 0, taxa REAL DEFAULT 0, pag TEXT DEFAULT 'dinheiro',
    troco REAL, status TEXT DEFAULT 'analise', mesa_num INTEGER,
    garcom_id INTEGER, garcom_nome TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS movimentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    description TEXT, tipo TEXT DEFAULT 'entrada', val REAL DEFAULT 0,
    pag TEXT, time TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS estoque (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL, qty REAL DEFAULT 0, unit TEXT DEFAULT 'un',
    min_qty REAL DEFAULT 0, cost REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS fidelidade (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL, phone TEXT, birthday TEXT, pts INTEGER DEFAULT 0,
    max_pts INTEGER DEFAULT 500, orders_count INTEGER DEFAULT 0,
    resgates INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT, phone TEXT, addr TEXT, orders_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(tenant_id, phone)
  );
  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id INTEGER,
    client TEXT,
    phone TEXT,
    nota INTEGER NOT NULL DEFAULT 5,
    comentario TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Índices para performance
  CREATE INDEX IF NOT EXISTS idx_orders_tenant     ON orders(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(tenant_id, status);
  CREATE INDEX IF NOT EXISTS idx_menu_tenant       ON menu_items(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_mesas_tenant      ON mesas(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_fidelidade_tenant ON fidelidade(tenant_id);
`)

// ════════════════════════════════════════════════════════
// MIGRATIONS — versionadas via PRAGMA user_version
// Para adicionar colunas/índices no futuro:
//   1. Crie um novo bloco { version: N, up: `SQL` }
//   2. Incremente o número — nunca edite migrations existentes
// ════════════════════════════════════════════════════════
const MIGRATIONS = [
  {
    version: 1,
    description: 'Adiciona expires_at em tenants',
    up: `ALTER TABLE tenants ADD COLUMN expires_at TEXT`
  },
  {
    version: 2,
    description: 'Adiciona evo_instance em store_config',
    up: `ALTER TABLE store_config ADD COLUMN evo_instance TEXT`
  },
  {
    version: 3,
    description: 'Adiciona label, type e promo em categories',
    up: [
      `ALTER TABLE categories ADD COLUMN label TEXT`,
      `ALTER TABLE categories ADD COLUMN type TEXT DEFAULT 'Itens principais'`,
      `ALTER TABLE categories ADD COLUMN promo INTEGER DEFAULT 0`,
      // Preenche label com name para categorias já existentes
      `UPDATE categories SET label = name WHERE label IS NULL`
    ]
  },
  {
    version: 4,
    description: 'Adiciona colunas faltantes em menu_items',
    up: [
      `ALTER TABLE menu_items ADD COLUMN price_old REAL`,
      `ALTER TABLE menu_items ADD COLUMN cat TEXT`,
      `ALTER TABLE menu_items ADD COLUMN cat_key TEXT`,
      `ALTER TABLE menu_items ADD COLUMN emoji TEXT`,
      `ALTER TABLE menu_items ADD COLUMN promo INTEGER DEFAULT 0`,
      `ALTER TABLE menu_items ADD COLUMN item_type TEXT DEFAULT 'normal'`,
      `ALTER TABLE menu_items ADD COLUMN allow_half INTEGER DEFAULT 0`,
      `ALTER TABLE menu_items ADD COLUMN max_flavors INTEGER DEFAULT 1`,
      `ALTER TABLE menu_items ADD COLUMN days TEXT DEFAULT '[1,1,1,1,1,1,1]'`,
      `ALTER TABLE menu_items ADD COLUMN ingredients TEXT DEFAULT '[]'`
    ]
  },
  {
    version: 5,
    description: 'Adiciona colunas de branding do cardápio público em store_config',
    up: [
      `ALTER TABLE store_config ADD COLUMN store_name TEXT`,
      `ALTER TABLE store_config ADD COLUMN store_descricao TEXT`,
      `ALTER TABLE store_config ADD COLUMN store_logo_url TEXT`,
      `ALTER TABLE store_config ADD COLUMN store_banner_url TEXT`,
      `ALTER TABLE store_config ADD COLUMN store_cor TEXT DEFAULT '#3b82f6'`,
      `ALTER TABLE store_config ADD COLUMN store_tempo_entrega TEXT DEFAULT '30-45 min'`,
      `ALTER TABLE store_config ADD COLUMN store_avaliacao TEXT DEFAULT '5.0'`,
      `ALTER TABLE store_config ADD COLUMN store_whatsapp TEXT`
    ]
  },
  {
    version: 6,
    description: 'Adiciona gestor_tema em store_config',
    up: `ALTER TABLE store_config ADD COLUMN gestor_tema TEXT`
  },
  {
    version: 7,
    description: 'Adiciona total e pag_forma em mesas',
    up: [
      `ALTER TABLE mesas ADD COLUMN total REAL DEFAULT 0`,
      `ALTER TABLE mesas ADD COLUMN pag_forma TEXT`
    ]
  },
  {
    version: 8,
    description: 'Adiciona ia_config em store_config para agente IA',
    up: `ALTER TABLE store_config ADD COLUMN ia_config TEXT`
  },
  {
    version: 9,
    description: 'Insere linha global para configurações de IA do admin',
    up: [
      `INSERT OR IGNORE INTO tenants (id, nome, plano, slug) VALUES ('_global', 'Global Config', 'premium', '_global')`,
      `INSERT OR IGNORE INTO store_config (tenant_id) VALUES ('_global')`
    ]
  },
  {
    version: 10,
    description: 'Adiciona horarios_config em store_config',
    up: `ALTER TABLE store_config ADD COLUMN horarios_config TEXT`
  },
  {
    version: 11,
    description: 'Adiciona total_spent, last_order_at, email e birthday em customers',
    up: [
      `ALTER TABLE customers ADD COLUMN total_spent REAL DEFAULT 0`,
      `ALTER TABLE customers ADD COLUMN last_order_at TEXT`,
      `ALTER TABLE customers ADD COLUMN email TEXT`,
      `ALTER TABLE customers ADD COLUMN birthday TEXT`
    ]
  },
  {
    version: 12,
    description: 'Adiciona senha_hash em customers para autenticação própria',
    up: `ALTER TABLE customers ADD COLUMN senha_hash TEXT`
  },
  {
    version: 13,
    description: 'Adiciona customer_id em orders para vincular pedido ao cliente logado',
    up: `ALTER TABLE orders ADD COLUMN customer_id INTEGER`
  },
  {
    version: 14,
    description: 'Cria tabela ratings para avaliações de satisfação dos clientes',
    up: `CREATE TABLE IF NOT EXISTS ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      order_id INTEGER, client TEXT, phone TEXT,
      nota INTEGER NOT NULL DEFAULT 5,
      comentario TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`
  },
  {
    version: 15,
    description: 'Adiciona coluna troco em orders para pedidos em dinheiro',
    up: `ALTER TABLE orders ADD COLUMN troco REAL`
  },
]

function runMigrations() {
  const currentVersion = db.pragma('user_version', { simple: true })
  const pending = MIGRATIONS.filter(m => m.version > currentVersion)

  if (!pending.length) {
    log('✅', `Schema atualizado (v${currentVersion}) — nenhuma migration pendente`)
    return
  }

  log('🔄', `Rodando ${pending.length} migration(s) (banco em v${currentVersion})...`)

  for (const migration of pending) {
    try {
      db.transaction(() => {
        const sqls = Array.isArray(migration.up) ? migration.up : [migration.up]
        for (const sql of sqls) {
          try {
            db.exec(sql)
          } catch(e) {
            // "duplicate column name" significa que a coluna já existe (migration aplicada
            // manualmente antes do sistema de versões) — trata como sucesso e continua
            if (e.message && e.message.includes('duplicate column name')) {
              log('⚠️', `  [v${migration.version}] Coluna já existia (OK): ${e.message}`)
            } else {
              throw e // erro real — propaga e aborta esta migration
            }
          }
        }
        db.pragma(`user_version = ${migration.version}`)
      })()
      log('✅', `  [v${migration.version}] ${migration.description}`)
    } catch(e) {
      log('❌', `  [v${migration.version}] Falhou: ${e.message}`)
      // Interrompe para não deixar o banco em estado inconsistente
      break
    }
  }

  const newVersion = db.pragma('user_version', { simple: true })
  log('💾', `Schema agora em v${newVersion}`)
}

runMigrations()

// ── Restaurar backup se o banco for novo ──────────────
if (!_dbExistia) {
  log('♻️', 'Banco novo detectado — tentando restaurar backup...')
  restaurarBackup()
}

// Superadmin padrão
const adminExists = db.prepare("SELECT id FROM sys_users WHERE role='superadmin' LIMIT 1").get()
if (!adminExists) {
  const hash = crypto.createHash('sha256').update('admin123').digest('hex')
  db.prepare("INSERT OR IGNORE INTO tenants (id,nome,plano,slug) VALUES ('system','Sistema Admin','premium','admin')").run()
  db.prepare("INSERT INTO sys_users (nome,email,senha_hash,role,tenant_id) VALUES (?,?,?,?,?)")
    .run('Administrador','admin@estimafood.com',hash,'superadmin','system')
  log('🔑','Superadmin criado: admin@estimafood.com / admin123')
}

// Garante que o tenant '_global' existe (necessário para store_config de IA do admin)
db.prepare("INSERT OR IGNORE INTO tenants (id, nome, plano, slug) VALUES ('_global', 'Global Config', 'premium', '_global')").run()
db.prepare("INSERT OR IGNORE INTO store_config (tenant_id) VALUES ('_global')").run()

// Garante store_config para cada tenant existente
const tenantsAtivos = db.prepare("SELECT id FROM tenants").all()
for (const t of tenantsAtivos) {
  db.prepare("INSERT OR IGNORE INTO store_config (tenant_id) VALUES (?)").run(t.id)
}

// ── Agenda backup automático a cada 5 minutos ─────────
setTimeout(fazerBackup, 10000) // primeiro backup 10s após start
setInterval(fazerBackup, 5 * 60 * 1000) // a cada 5 min


// ════════════════════════════════════════════════════════
// SSE — Server-Sent Events (Realtime por tenant)
// ════════════════════════════════════════════════════════
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

// Emite apenas para os canais do tenant correto
function emit(tenantId, table, record, type) {
  const tid = tenantId || (record && record.tenant_id) || 'global'
  if (tid === 'global') return // sem tenant = não emite para ninguém
  // Canais do gestor
  sseBroadcast(`orders-rt:${tid}`,      table+':'+type, record)
  sseBroadcast(`mesas-rt:${tid}`,       table+':'+type, record)
  sseBroadcast(`store-config-rt:${tid}`,table+':'+type, record)
  // Canais do cardápio público
  sseBroadcast(`menu-rt:${tid}`,        table+':'+type, record)
  sseBroadcast(`cats-rt:${tid}`,        table+':'+type, record)
  // Canais dinâmicos do garçom
  for (const [ch] of sseClients) {
    if (ch.startsWith(`garcom-mesas-`) && ch.endsWith(`:${tid}`)) sseBroadcast(ch, table+':'+type, record)
    if (ch.startsWith(`garcom-orders-`) && ch.endsWith(`:${tid}`)) sseBroadcast(ch, table+':'+type, record)
  }
}

// ════════════════════════════════════════════════════════
// REST ENGINE — multi-tenant automático
// ════════════════════════════════════════════════════════
const TABLE_COLS = {
  tenants:      ['id','nome','plano','ativo','slug','expires_at','created_at'],
  sys_users:    ['id','tenant_id','nome','email','senha_hash','role','ativo','ultimo_acesso','created_at'],
  store_config: ['id','tenant_id','store_open','caixa_open','delivery_fee_config','fid_config','evo_automacoes','evo_aniv_last','wa_server_url','sidebar_state','evo_instance','store_name','store_descricao','store_logo_url','store_banner_url','store_cor','store_tempo_entrega','store_avaliacao','store_whatsapp','gestor_tema','ia_config','horarios_config'],
  categories:   ['id','tenant_id','name','label','type','promo','emoji','sort_order','ativo'],
  menu_items:   ['id','tenant_id','name','description','price','price_old','category_id','cat','cat_key','emoji','image_url','promo','status','item_type','allow_half','max_flavors','days','ingredients','created_at'],
  cupons:       ['id','tenant_id','code','type','value','min_order','uses_left','ativo','expires_at'],
  mesas:        ['id','tenant_id','num','status','guests','opened_at','total','pag_forma','updated_at'],
  garcons:      ['id','tenant_id','nome','usuario','senha','ativo'],
  orders:       ['id','tenant_id','client','phone','addr','items','total','taxa','pag','troco','status','mesa_num','garcom_id','garcom_nome','customer_id','created_at'],
  movimentos:   ['id','tenant_id','description','tipo','val','pag','time','created_at'],
  estoque:      ['id','tenant_id','name','qty','unit','min_qty','cost','updated_at'],
  fidelidade:   ['id','tenant_id','name','phone','birthday','pts','max_pts','orders_count','resgates','created_at'],
  customers:    ['id','tenant_id','name','phone','addr','orders_count','total_spent','last_order_at','email','birthday','senha_hash','customer_id','created_at'],
  ratings:      ['id','tenant_id','order_id','client','phone','nota','comentario','created_at'],
}

// Tabelas que NÃO são filtradas por tenant (acesso global)
const NO_TENANT_FILTER = ['tenants','sys_users']

// Tabelas onde o tenant_id é identificado pela coluna 'tenant_id' e não 'id'
const JSON_FIELDS = {
  orders:       ['items'],
  menu_items:   ['days','ingredients'],
  store_config: ['delivery_fee_config','fid_config','evo_automacoes','sidebar_state','horarios_config']
}

function jsonParse(v) { if(typeof v!=='string')return v; try{return JSON.parse(v)}catch(e){return v} }

function parseRow(table, row) {
  if (!row) return row
  const out = {...row}
  for (const f of (JSON_FIELDS[table]||[])) { if(f in out) out[f]=jsonParse(out[f]) }
  for (const f of ['ativo','store_open','caixa_open']) { if(f in out) out[f]=out[f]===1||out[f]===true }
  return out
}

function sanitize(v) {
  if (v === undefined || v === null) return null
  if (v === '')    return null   // string vazia → null (evita FK constraint com '')
  if (v === true)  return 1
  if (v === false) return 0
  return v
}

function serialize(table, body) {
  const out = {...body}
  for (const f of (JSON_FIELDS[table]||[])) { if(f in out && typeof out[f]!=='string') out[f]=JSON.stringify(out[f]) }
  return out
}

function buildWhere(params, cols, tenantId, table) {
  const conds=[], vals=[]

  // Injeta filtro de tenant automaticamente
  if (tenantId && !NO_TENANT_FILTER.includes(table)) {
    conds.push('"tenant_id" = ?')
    vals.push(tenantId)
  }

  for (const [key,val] of params.entries()) {
    if(['_single','select','order','limit','offset','_tenant'].includes(key)) continue
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
    if((m=val.match(/^eq\.(.+)$/)))   {
      let v = m[1]==='null' ? null : m[1]
      if (v==='true') v=1; else if (v==='false') v=0  // SQLite usa 0/1 para boolean
      conds.push(`"${key}" = ?`);  vals.push(v); continue
    }
    if((m=val.match(/^neq\.(.+)$/)))  {
      let v = m[1]; if(v==='true') v=1; else if(v==='false') v=0
      conds.push(`"${key}" != ?`); vals.push(v); continue
    }
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

// Extrai tenant_id do header ou query param
function getTenantId(req, params) {
  return req.headers['x-tenant-id'] || params.get('_tenant') || null
}

async function handleREST(req, res, table, params, body) {
  const cols = TABLE_COLS[table]
  if (!cols) return send(res,404,{error:'Tabela não encontrada'})

  const tenantId = getTenantId(req, params)
  const { WHERE, vals } = buildWhere(params, cols, tenantId, table)

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
      if (valid.length) selectCols = valid.map(c=>c==='*'?'*':`"${c}"`).join(', ')
    }

    // store_config: busca por tenant_id em vez de id=1
    if (table==='store_config' && tenantId) {
      try {
        const row = db.prepare(`SELECT * FROM store_config WHERE tenant_id=?`).get(tenantId)
        if (!row && (params.get('_single')==='true' || req.headers['prefer']?.includes('single'))) {
          // Cria config vazia para esse tenant
          db.prepare("INSERT OR IGNORE INTO store_config (tenant_id) VALUES (?)").run(tenantId)
          const created = db.prepare("SELECT * FROM store_config WHERE tenant_id=?").get(tenantId)
          return send(res,200,parseRow(table,created))
        }
        if (isSingle) return send(res,200,row?parseRow(table,row):{error:'Not found'})
        return send(res,200,row?[parseRow(table,row)]:[])
      } catch(e) { return send(res,400,{error:e.message}) }
    }

    // JOIN: sys_users + tenants
    if (table==='sys_users' && sel?.includes('tenants')) {
      const rows = db.prepare(`SELECT u.*,t.nome as t_nome,t.plano as t_plano,t.ativo as t_ativo,t.expires_at as t_expires_at FROM sys_users u LEFT JOIN tenants t ON u.tenant_id=t.id ${WHERE} ${ORDER} LIMIT ? OFFSET ?`).all(...vals,limit,offset)
      const mapped = rows.map(r=>{const{t_nome,t_plano,t_ativo,t_expires_at,...u}=r;u.tenants={nome:t_nome,plano:t_plano,ativo:t_ativo===1,expires_at:t_expires_at};return parseRow(table,u)})
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

      // Injeta tenant_id no body automaticamente
      if (tenantId && !NO_TENANT_FILTER.includes(table) && !payload.tenant_id) {
        payload.tenant_id = tenantId
      }

      // store_config: sempre faz upsert — aceita tenant_id do header OU do body
      const scTenantId = tenantId || payload.tenant_id
      if (table==='store_config' && scTenantId) {
        if (!payload.tenant_id) payload.tenant_id = scTenantId
        const keys = Object.keys(payload).filter(k=>cols.includes(k))
        const setClause = keys.filter(k=>k!=='tenant_id').map(k=>`"${k}"=excluded."${k}"`).join(', ')
        const colList = keys.map(k=>`"${k}"`).join(', ')
        const phs = keys.map(()=>'?').join(', ')
        db.prepare(`INSERT INTO store_config (${colList}) VALUES (${phs}) ON CONFLICT(tenant_id) DO UPDATE SET ${setClause}`)
          .run(...keys.map(k=>sanitize(payload[k])))
        const row = db.prepare("SELECT * FROM store_config WHERE tenant_id=?").get(scTenantId)
        return send(res,200,parseRow(table,row))
      }

      const keys = Object.keys(payload).filter(k=>cols.includes(k))
      if (!keys.length) return send(res,400,{error:'Sem campos válidos'})
      const colList = keys.map(k=>`"${k}"`).join(', ')
      const phs = keys.map(()=>'?').join(', ')

      // Mesas: conflict por (tenant_id, num)
      const conflictKey = table==='mesas' ? '(tenant_id, num)' : 'id'

      let stmt
      if (isUpsert) {
        const upd = keys.filter(k=>k!=='id'&&k!=='tenant_id').map(k=>`"${k}"=excluded."${k}"`).join(', ')
        stmt = db.prepare(`INSERT INTO "${table}" (${colList}) VALUES (${phs}) ON CONFLICT${table==='mesas'?'(tenant_id,num)':'(id)'} DO UPDATE SET ${upd}`)
      } else {
        stmt = db.prepare(`INSERT INTO "${table}" (${colList}) VALUES (${phs})`)
      }
      const info = stmt.run(...keys.map(k=>sanitize(payload[k])))
      const newRowid = info.lastInsertRowid
      const returnRep = req.headers['prefer']?.includes('return=representation')
      let inserted = null
      // Sempre busca o registro completo do banco para o emit (garante JSON fields parseados)
      const rawForEmit = db.prepare(`SELECT * FROM "${table}" WHERE rowid=?`).get(newRowid)
      const insertedForEmit = rawForEmit ? parseRow(table, rawForEmit) : null
      if (returnRep) {
        if (table === 'sys_users' && rawForEmit) {
          const t = db.prepare("SELECT nome,plano,ativo,expires_at FROM tenants WHERE id=?").get(rawForEmit.tenant_id)
          inserted = parseRow(table, {...rawForEmit, tenants: t ? {nome:t.nome,plano:t.plano,ativo:t.ativo===1,expires_at:t.expires_at} : null})
        } else {
          inserted = insertedForEmit
        }
      }
      if (['orders','mesas','store_config','menu_items','categories'].includes(table)) {
        emit(tenantId||payload.tenant_id, table, insertedForEmit||payload, 'INSERT')
      }
      return send(res,201,returnRep?inserted:{id:newRowid})
    } catch(e) { return send(res,400,{error:e.message}) }
  }

  // PATCH
  if (req.method==='PATCH') {
    try {
      const payload = serialize(table, body)
      const keys = Object.keys(payload).filter(k=>cols.includes(k))
      if (!keys.length) return send(res,400,{error:'Sem campos válidos'})

      // store_config: usa UPSERT para garantir que nunca falhe com UNIQUE constraint
      // Aceita tenant_id do header (gestor) ou do body (admin sem header)
      const patchTenantId = tenantId || payload.tenant_id || vals[0] || null
      if (table==='store_config' && patchTenantId) {
        const upsertKeys = [...new Set([...keys, 'tenant_id'])]
          .filter(k => cols.includes(k))
        if (!payload.tenant_id) payload.tenant_id = patchTenantId
        const setClause = upsertKeys.filter(k=>k!=='tenant_id').map(k=>`"${k}"=excluded."${k}"`).join(', ')
        const colList   = upsertKeys.map(k=>`"${k}"`).join(', ')
        const phs       = upsertKeys.map(()=>'?').join(', ')
        db.prepare(`INSERT INTO store_config (${colList}) VALUES (${phs}) ON CONFLICT(tenant_id) DO UPDATE SET ${setClause}`)
          .run(...upsertKeys.map(k=>sanitize(payload[k] ?? (k==='tenant_id' ? patchTenantId : null))))
        const row = db.prepare("SELECT * FROM store_config WHERE tenant_id=?").get(patchTenantId)
        const parsed = parseRow(table, row)
        emit(patchTenantId, table, parsed, 'UPDATE')
        return send(res,200,parsed)
      }

      const setClause = keys.map(k=>`"${k}"=?`).join(', ')
      const info = db.prepare(`UPDATE "${table}" SET ${setClause} ${WHERE}`).run(...keys.map(k=>sanitize(payload[k])),...vals)
      // Busca registro atualizado do banco para o emit (garante JSON fields parseados)
      if (['orders','mesas','store_config','menu_items','categories'].includes(table)) {
        const idVal = vals[vals.length - 1] // último val geralmente é o id do filtro
        const updatedRow = db.prepare(`SELECT * FROM "${table}" ${WHERE}`).get(...vals)
        emit(tenantId||payload.tenant_id, table, updatedRow ? parseRow(table, updatedRow) : payload, 'UPDATE')
      }
      return send(res,200,{updated:info.changes})
    } catch(e) { return send(res,400,{error:e.message}) }
  }

  // DELETE
  if (req.method==='DELETE') {
    if (!WHERE) return send(res,400,{error:'DELETE sem filtro não permitido'})
    try {
      const info = db.prepare(`DELETE FROM "${table}" ${WHERE}`).run(...vals)
      if (['orders','mesas','menu_items','categories'].includes(table)) emit(tenantId, table, {}, 'DELETE')
      return send(res,200,{deleted:info.changes})
    } catch(e) { return send(res,400,{error:e.message}) }
  }
}

// ════════════════════════════════════════════════════════
// API: /api/tenant-info?slug=xxx  (cardápio público)
// ════════════════════════════════════════════════════════
function handleTenantInfo(params) {
  const slug       = params.get('slug')
  const id         = params.get('id')
  const useDefault = params.get('default')
  if (!slug && !id && !useDefault) return { error: 'Informe slug ou id' }
  const t = slug
    ? db.prepare("SELECT id,nome,slug FROM tenants WHERE slug=? AND ativo=1").get(slug)
    : id
      ? db.prepare("SELECT id,nome,slug FROM tenants WHERE id=? AND ativo=1").get(id)
      : db.prepare("SELECT id,nome,slug FROM tenants WHERE ativo=1 ORDER BY id ASC LIMIT 1").get()
  if (!t) return { error: 'Restaurante não encontrado' }
  // Inclui branding do cardápio público
  const cfg = db.prepare(`SELECT store_name,store_descricao,store_logo_url,store_banner_url,
    store_cor,store_tempo_entrega,store_avaliacao,store_whatsapp
    FROM store_config WHERE tenant_id=?`).get(t.id)
  return { ...t, branding: cfg || {} }
}

// ════════════════════════════════════════════════════════
// UPLOAD DE IMAGENS
// ════════════════════════════════════════════════════════
function handleUpload(req, res) {
  return new Promise(resolve => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks)
        const ct = req.headers['content-type']||''
        const boundary = ct.split('boundary=')[1]

        // Tenta extrair nome do arquivo a partir da URL do request
        // Ex: /storage/v1/object/menu-images/branding/21541f9b7a91d8a2-logo.jpg
        const urlPath = req.url || ''
        const urlBasename = path.basename(urlPath.split('?')[0])
        const hasValidExt = /\.(jpg|jpeg|png|webp|gif)$/i.test(urlBasename)
        const fnameFromUrl = hasValidExt ? urlBasename : null

        let fname = fnameFromUrl || `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`

        if (!boundary) {
          const body = JSON.parse(buffer.toString())
          const ext  = (body.mime||'image/jpeg').split('/')[1]||'jpg'
          if (!fnameFromUrl) fname = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
          fs.writeFileSync(path.join(UPLOADS_DIR, fname), Buffer.from(body.data,'base64'))
        } else {
          const raw   = buffer.toString('binary')
          const parts = raw.split('--'+boundary).filter(p=>p.includes('filename='))
          if (parts.length) {
            const [head,...bodyParts] = parts[0].split('\r\n\r\n')
            const fnMatch = head.match(/filename="([^"]+)"/)
            // Usa nome da URL se disponível, senão usa nome do multipart, senão aleatório
            if (!fnameFromUrl && fnMatch) {
              const ext = path.extname(fnMatch[1])||'.jpg'
              fname = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
            }
            const fileContent = bodyParts.join('\r\n\r\n').replace(/\r\n$/,'')
            fs.writeFileSync(path.join(UPLOADS_DIR, fname), Buffer.from(fileContent,'binary'))
          } else {
            // Sem partes multipart válidas — salva o buffer inteiro
            fs.writeFileSync(path.join(UPLOADS_DIR, fname), buffer)
          }
        }
        const url = `/uploads/${fname}`
        log('📸', `Upload: ${fname}`)
        resolve(send(res, 200, {url, publicUrl: url}))
      } catch(e) {
        log('❌', 'Upload error:', {error: e.message})
        resolve(send(res, 400, {error: e.message}))
      }
    })
  })
}

// ════════════════════════════════════════════════════════
// WHATSAPP
// ════════════════════════════════════════════════════════
async function sendWA(phone, text, inst) {
  const instance = inst || EVO_INST
  const num    = phone.replace(/\D/g,'')
  const number = num.startsWith('55') ? num : `55${num}`

  // Evolution API v2 — payload correto: textMessage.text
  const payload = {
    number,
    textMessage: { text },
    options: { delay: 1000, presence: 'composing' }
  }

  try {
    const headers = {
      'Content-Type': 'application/json',
      'apikey': EVO_KEY
    }
    const r    = await fetch(`${EVO_URL}/message/sendText/${instance}`, {
      method: 'POST', headers,
      body: JSON.stringify(payload)
    })
    const data = await r.json().catch(() => ({}))

    // Log detalhado para debug
    log('📬', `sendWA response [${r.status}]:`, JSON.stringify(data).slice(0, 200))

    if (r.ok) {
      log('📤', `Enviado para ${number} [${instance}]`)
      return { ok: true, data }
    }

    // Se falhou com @s.whatsapp.net, tenta sem
    log('🔄', `Tentando sem sufixo para ${number}`)
    const r2   = await fetch(`${EVO_URL}/message/sendText/${instance}`, {
      method: 'POST', headers,
      body: JSON.stringify({ number, textMessage: { text } })
    })
    const data2 = await r2.json().catch(() => ({}))
    log('📬', `sendWA retry [${r2.status}]:`, JSON.stringify(data2).slice(0, 200))

    if (r2.ok) {
      log('📤', `Enviado para ${number} [${instance}]`)
      return { ok: true, data: data2 }
    }

    log('❌', `Falhou ${number}:`, data2)
    return { ok: false, data: data2 }
  } catch(e) {
    log('❌', 'Erro WA:', { error: e.message })
    return { ok: false, error: e.message }
  }
}

function fillVars(tpl, vars) {
  let t=tpl; Object.entries(vars).forEach(([k,v])=>{t=t.replaceAll(`{${k}}`,v??'')}) ; return t
}

// ── Buffer de mensagens e pausa humano (IA) ───────────
const _msgBuffer   = new Map() // bufKey → { msgs, timer }
const _pausaHumano = new Map() // pausaKey → timestamp

// ── Scheduler aniversários (por tenant) ───────────────
const _anivLast = new Map()

async function checarAniv() {
  const tenants = db.prepare("SELECT id FROM tenants WHERE ativo=1").all()
  for (const t of tenants) {
    try {
      const cfg  = db.prepare("SELECT evo_automacoes,evo_aniv_last,evo_instance FROM store_config WHERE tenant_id=?").get(t.id)
      if (!cfg) continue
      const auto = jsonParse(cfg.evo_automacoes)||{}
      const inst = cfg.evo_instance || EVO_INST
      const ca   = auto['aniversario']||{}
      if (ca.on === false) continue
      const now    = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Fortaleza'}))
      const today  = `${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
      const hora   = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
      if (_anivLast.get(t.id)===today||cfg.evo_aniv_last===today) continue
      if (hora<(auto._aniv_hora||'09:00')) continue
      _anivLast.set(t.id, today)

      // Busca aniversariantes na tabela fidelidade
      const deFidelidade = db.prepare(
        "SELECT name, phone FROM fidelidade WHERE tenant_id=? AND birthday IS NOT NULL AND phone IS NOT NULL"
      ).all(t.id).filter(c => c.birthday && c.phone && c.birthday.slice(5) === today)

      // Busca aniversariantes na tabela customers (evita duplicar por phone)
      const deCustomers = db.prepare(
        "SELECT name, phone FROM customers WHERE tenant_id=? AND birthday IS NOT NULL AND phone IS NOT NULL"
      ).all(t.id).filter(c => c.birthday && c.phone && c.birthday.slice(5) === today)

      // Mescla sem duplicar por telefone (fidelidade tem prioridade)
      const phonesVistos = new Set(deFidelidade.map(c => c.phone))
      const anivs = [
        ...deFidelidade,
        ...deCustomers.filter(c => !phonesVistos.has(c.phone))
      ]

      if (!anivs.length) {
        db.prepare("UPDATE store_config SET evo_aniv_last=? WHERE tenant_id=?").run(today, t.id)
        continue
      }
      for (const c of anivs) {
        await sendWA(c.phone, fillVars(ca.msg, { nome: c.name }), inst)
        await sleep(1500)
      }
      db.prepare("UPDATE store_config SET evo_aniv_last=? WHERE tenant_id=?").run(today, t.id)
      log('🎂', `Aniversários tenant ${t.id}: ${anivs.length} enviados`)
    } catch(e) { log('❌','Erro aniv tenant '+t.id,{error:e.message}) }
  }
}

// ── Checker pedidos (por tenant) ─────────────────────
const processed = new Set()

async function checarPedidos() {
  try {
    const tenants = db.prepare("SELECT id FROM tenants WHERE ativo=1").all()
    const desde   = new Date(Date.now()-86400000).toISOString().slice(0,19).replace('T',' ')
    for (const t of tenants) {
      const cfg    = db.prepare("SELECT evo_automacoes,evo_instance FROM store_config WHERE tenant_id=?").get(t.id)
      if (!cfg) continue
      const auto   = jsonParse(cfg.evo_automacoes)||{}
      const inst   = cfg.evo_instance || EVO_INST
      // Scheduler apenas registra pedidos no processed para evitar reenvio.
      // O envio real de WA é feito pelo endpoint /api/order-status em tempo real.
      const pedidos = db.prepare(`SELECT id, status FROM orders WHERE tenant_id=? AND phone IS NOT NULL AND created_at>=? AND status IN ('producao','pronto','cancelado','finalizado') ORDER BY id DESC LIMIT 100`).all(t.id,desde)
      for (const o of pedidos) {
        processed.add(`${o.id}_${o.status}`)
      }
    }
    if(processed.size>2000){const a=[...processed];a.slice(0,1000).forEach(k=>processed.delete(k))}
  } catch(e){log('❌','Erro checker pedidos:',{error:e.message})}
}

// ════════════════════════════════════════════════════════
// HTTP SERVER
// ════════════════════════════════════════════════════════
function send(res,status,data){res.setHeader('Content-Type','application/json');res.writeHead(status);res.end(JSON.stringify(data))}
function readBody(req){return new Promise((ok,err)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{ok(b?JSON.parse(b):{})}catch(e){ok({})}});req.on('error',err)})}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.svg':'image/svg+xml','.webp':'image/webp'}

const server = http.createServer(async (req,res) => {
  res.setHeader('Access-Control-Allow-Origin','*')
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Prefer,apikey,Authorization,x-tenant-id')
  if(req.method==='OPTIONS'){res.writeHead(200);res.end();return}

  const url    = new URL(req.url,`http://localhost:${PORT}`)
  const upath  = url.pathname.replace(/\/$/,'')||'/'
  const params = url.searchParams

  // SSE — canal inclui tenant: /sse/orders-rt:TENANT_ID
  if(upath.startsWith('/sse/')){
    const channel = decodeURIComponent(upath.slice(5))
    sseSubscribe(channel, res)
    return
  }

  // Info do tenant para cardápio público ── ANTES do bloco genérico /api/
  if(req.method==='GET'&&upath==='/api/tenant-info'){
    const info = handleTenantInfo(params)
    send(res, info.error?404:200, info); return
  }

  // ── Autenticação de clientes (cardápio público) ──────────────────
  // POST /api/customer-register
  if(req.method==='POST'&&upath==='/api/customer-register'){
    const body   = await readBody(req)
    const tid    = getTenantId(req, params)
    const {name, phone, email, senha, birthday} = body
    if(!name||!phone||!senha) { send(res,400,{error:'Nome, telefone e senha são obrigatórios'}); return }
    if(!tid) { send(res,400,{error:'Tenant não identificado'}); return }
    try {
      const hash = crypto.createHash('sha256').update(senha).digest('hex')
      const existing = db.prepare('SELECT id FROM customers WHERE tenant_id=? AND phone=?').get(tid, phone)
      if(existing) {
        // já existe: atualiza senha e dados se ainda não tinha senha
        db.prepare('UPDATE customers SET name=?,email=?,birthday=?,senha_hash=? WHERE tenant_id=? AND phone=?')
          .run(name, email||null, birthday||null, hash, tid, phone)
        const c = db.prepare('SELECT id,name,phone,email,birthday,orders_count,total_spent,created_at FROM customers WHERE tenant_id=? AND phone=?').get(tid, phone)
        send(res,200,{...c, token: Buffer.from(`${c.id}:${tid}:${hash.slice(0,16)}`).toString('base64')}); return
      }
      const info = db.prepare('INSERT INTO customers (tenant_id,name,phone,email,birthday,senha_hash,orders_count,total_spent) VALUES (?,?,?,?,?,?,0,0)')
        .run(tid, name, phone, email||null, birthday||null, hash)
      const c = db.prepare('SELECT id,name,phone,email,birthday,orders_count,total_spent,created_at FROM customers WHERE id=?').get(info.lastInsertRowid)
      send(res,201,{...c, token: Buffer.from(`${c.id}:${tid}:${hash.slice(0,16)}`).toString('base64')}); return
    } catch(e) { send(res,400,{error:e.message}); return }
  }

  // POST /api/customer-login
  if(req.method==='POST'&&upath==='/api/customer-login'){
    const body  = await readBody(req)
    const tid   = getTenantId(req, params)
    const {phone, senha} = body
    if(!phone||!senha) { send(res,400,{error:'Telefone e senha obrigatórios'}); return }
    if(!tid) { send(res,400,{error:'Tenant não identificado'}); return }
    try {
      const hash = crypto.createHash('sha256').update(senha).digest('hex')
      const c = db.prepare('SELECT id,name,phone,email,birthday,orders_count,total_spent,created_at,senha_hash FROM customers WHERE tenant_id=? AND phone=?').get(tid, phone)
      if(!c||!c.senha_hash) { send(res,401,{error:'Telefone não cadastrado'}); return }
      if(c.senha_hash !== hash) { send(res,401,{error:'Senha incorreta'}); return }
      const {senha_hash:_, ...safe} = c
      send(res,200,{...safe, token: Buffer.from(`${c.id}:${tid}:${hash.slice(0,16)}`).toString('base64')}); return
    } catch(e) { send(res,400,{error:e.message}); return }
  }

  // GET /api/customer-orders?customer_id=X
  if(req.method==='GET'&&upath==='/api/customer-orders'){
    const tid = getTenantId(req, params)
    const cid = params.get('customer_id')
    if(!tid||!cid) { send(res,400,{error:'Parâmetros faltando'}); return }
    try {
      const rows = db.prepare('SELECT id,client,phone,addr,items,total,taxa,pag,status,created_at FROM orders WHERE tenant_id=? AND customer_id=? ORDER BY id DESC LIMIT 30').all(tid, cid)
      const parsed = rows.map(r=>({...r, items: (()=>{try{return JSON.parse(r.items)}catch(e){return[]}})()}))
      send(res,200,parsed); return
    } catch(e) { send(res,400,{error:e.message}); return }
  }

  // Criar tenant + store_config + usuário gestor ── ANTES do bloco genérico /api/
  if(req.method==='POST'&&upath==='/api/criar-tenant'){
    const body = await readBody(req)
    const {nome,plano,slug,email,senha,role,nomeGestor} = body
    if(!nome||!email||!senha){send(res,400,{error:'nome, email e senha obrigatórios'});return}
    try {
      const hash = crypto.createHash('sha256').update(senha).digest('hex')
      const slugBase = slug || nome.toLowerCase().replace(/[^a-z0-9]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'')

      let slugFinal = slugBase
      let suffix = 2
      while (db.prepare("SELECT id FROM tenants WHERE slug=?").get(slugFinal)) {
        slugFinal = `${slugBase}-${suffix++}`
      }
      if (slug && slugFinal !== slug) {
        send(res,400,{error:`O identificador (slug) "${slug}" já está em uso. Sugerimos: "${slugFinal}"`})
        return
      }
      if (db.prepare("SELECT id FROM sys_users WHERE email=?").get(email)) {
        send(res,400,{error:`O e-mail "${email}" já está cadastrado no sistema.`})
        return
      }
      const nomeUsuario = nomeGestor || nome
      db.prepare("INSERT INTO tenants (nome,plano,slug) VALUES (?,?,?)").run(nome,plano||'basic',slugFinal)
      const t = db.prepare("SELECT id FROM tenants WHERE slug=?").get(slugFinal)
      db.prepare("INSERT OR IGNORE INTO store_config (tenant_id) VALUES (?)").run(t.id)
      db.prepare("INSERT INTO sys_users (nome,email,senha_hash,role,tenant_id) VALUES (?,?,?,?,?)")
        .run(nomeUsuario,email,hash,role||'gestor',t.id)
      send(res,201,{ok:true,tenant_id:t.id,slug:slugFinal})
      setTimeout(fazerBackup, 2000) // backup 2s após criar tenant
    } catch(e){ send(res,400,{error:e.message}) }
    return
  }

  // REST API genérico ── /rest/v1/:table  e  /api/:table
  // Exclui rotas especiais /api/evo, /api/backup, /api/restore, /api/ia-*, /api/rastreio-*
  const _isSpecialApi = upath.startsWith('/api/evo') || upath.startsWith('/api/backup') ||
    upath.startsWith('/api/restore') || upath.startsWith('/api/ia-') || upath.startsWith('/api/rastreio') ||
    upath === '/api/order-status' || upath === '/api/customer-register' ||
    upath === '/api/customer-login' || upath === '/api/customer-orders' ||
    upath === '/api/criar-tenant'  || upath === '/api/tenant-info'
  if(upath.startsWith('/rest/v1/')||(upath.startsWith('/api/')&&!_isSpecialApi)){
    const table = upath.split('/')[upath.startsWith('/api/')?2:3]
    const body  = ['POST','PATCH'].includes(req.method)?await readBody(req):{}
    await handleREST(req,res,table,params,body); return
  }

  // Upload
  if(req.method==='POST'&&upath.startsWith('/storage/v1/object/')){await handleUpload(req,res);return}

  // Servir imagens
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
  if(upath==='/status'){send(res,200,{ok:true,uptime:Math.floor(process.uptime()),db:'sqlite-multitenant',version:'3.0.0',backup:fs.existsSync(BACKUP_PATH)?fs.statSync(BACKUP_PATH).mtime:null});return}

  // Backup manual sob demanda
  if(req.method==='POST'&&upath==='/api/backup'){
    fazerBackup()
    const size = fs.existsSync(BACKUP_PATH) ? fs.statSync(BACKUP_PATH).size : 0
    send(res,200,{ok:true,path:BACKUP_PATH,size})
    return
  }

  // Restaurar backup manualmente (emergência)
  if(req.method==='POST'&&upath==='/api/restore'){
    const ok = restaurarBackup()
    send(res,200,{ok,msg:ok?'Restauração concluída':'Nenhum backup encontrado'})
    return
  }

  // WA avulso
  // ── Proxy Evolution API (por tenant) ──────────────────────
  // Gestor chama /api/evo  →  servidor repassa com a apikey real
  if (upath.startsWith('/api/evo')) {
    const tenantId = req.headers['x-tenant-id']
    if (!tenantId) { send(res,401,{error:'x-tenant-id obrigatório'}); return }

    // Resolve instância do tenant
    const cfg = db.prepare("SELECT evo_instance FROM store_config WHERE tenant_id=?").get(tenantId)
    const instance = cfg?.evo_instance || null

    const body = ['POST','DELETE'].includes(req.method) ? await readBody(req) : {}
    const action = upath.replace('/api/evo','') // ex: /instance/create, /instance/connect/...

    // Injeta instanceName quando não vem no body
    if (req.method === 'POST' && body.instanceName === undefined && instance) {
      body.instanceName = instance
    }

    // Substitui :instance na path pelo valor real do tenant
    const evoPath = action.replace(':instance', instance || '')

    try {
      const r = await fetch(`${EVO_URL}${evoPath}`, {
        method: req.method,
        headers: { 'Content-Type': 'application/json', apikey: EVO_KEY },
        body: req.method !== 'GET' ? JSON.stringify(body) : undefined
      })
      const data = await r.json().catch(() => ({}))

      // Se criou instância com sucesso, salva o nome no store_config do tenant
      if (evoPath.startsWith('/instance/create') && r.ok && body.instanceName) {
        db.prepare("UPDATE store_config SET evo_instance=? WHERE tenant_id=?")
          .run(body.instanceName, tenantId)
        log('🤖', `Instância "${body.instanceName}" salva para tenant ${tenantId}`)
      }

      send(res, r.status, data)
    } catch(e) {
      send(res, 500, { error: e.message })
    }
    return
  }

  if(req.method==='POST'&&upath==='/enviar'){
    const{phone,text,tenant_id}=await readBody(req)
    if(!phone||!text){send(res,400,{ok:false,error:'phone e text obrigatórios'});return}
    const tid = tenant_id || req.headers['x-tenant-id']
    const cfgEnv = tid ? db.prepare("SELECT evo_instance FROM store_config WHERE tenant_id=?").get(tid) : null
    const r=await sendWA(phone,text,cfgEnv?.evo_instance);send(res,r.ok?200:500,r);return
  }

  // Promoção em massa (por tenant)
  if(req.method==='POST'&&upath==='/promocao'){
    const body=await readBody(req)
    const{destino='todos',msg,tenant_id}=body
    if(!msg){send(res,400,{ok:false,error:'msg obrigatório'});return}
    const tid = tenant_id || req.headers['x-tenant-id']
    const cfgPromo = tid ? db.prepare("SELECT evo_instance FROM store_config WHERE tenant_id=?").get(tid) : null
    const instPromo = cfgPromo?.evo_instance || EVO_INST
    let cl=db.prepare("SELECT * FROM fidelidade WHERE phone IS NOT NULL"+(tid?' AND tenant_id=?':'')).all(...(tid?[tid]:[]))
    if(destino==='com_pedido') cl=cl.filter(c=>c.orders_count>0)
    if(!cl.length){send(res,200,{ok:true,enviados:0});return}
    send(res,200,{ok:true,total:cl.length,msg:'Envio iniciado'})
    ;(async()=>{let ok=0,fail=0;for(const c of cl){const r=await sendWA(c.phone,fillVars(msg,{nome:c.name}),instPromo);r.ok?ok++:fail++;await sleep(1500)};log('📢',`Promoção: ${ok} ok, ${fail} fail`)})()
    return
  }

  // Aniversário manual
  if(req.method==='POST'&&upath==='/aniversario'){_anivLast.clear();checarAniv();send(res,200,{ok:true});return}

  // ════════════════════════════════════════════════════════
  // ATUALIZAR STATUS DO PEDIDO + NOTIFICAÇÃO WA IMEDIATA
  // ════════════════════════════════════════════════════════
  if(req.method==='POST'&&upath==='/api/order-status'){
    const body = await readBody(req)
    const { order_id, new_status } = body
    const tid = body.tenant_id || req.headers['x-tenant-id']
    if (!order_id || !new_status || !tid) { send(res,400,{ok:false,error:'order_id, new_status e tenant_id obrigatórios'}); return }

    try {
      // 1. Busca pedido atual
      const order = db.prepare("SELECT * FROM orders WHERE id=? AND tenant_id=?").get(order_id, tid)
      if (!order) { send(res,404,{ok:false,error:'Pedido não encontrado'}); return }

      const oldStatus = order.status

      // 2. Atualiza no banco
      db.prepare("UPDATE orders SET status=? WHERE id=?").run(new_status, order_id)
      const updatedOrder = db.prepare("SELECT * FROM orders WHERE id=?").get(order_id)

      // 3. Emite SSE para todos os clientes conectados
      emit(tid, 'orders', parseRow('orders', updatedOrder), 'UPDATE')

      send(res, 200, { ok: true, order: parseRow('orders', updatedOrder) })

      // 4. Envia WA imediatamente (assíncrono, não bloqueia resposta)
      if (order.phone && oldStatus !== new_status) {
        setImmediate(async () => {
          try {
            const cfg   = db.prepare("SELECT evo_instance, evo_automacoes, store_name, store_whatsapp FROM store_config WHERE tenant_id=?").get(tid)
            const inst  = cfg?.evo_instance || EVO_INST
            const auto  = jsonParse(cfg?.evo_automacoes) || {}
            const nome  = order.client || 'Cliente'
            const idStr = String(order.id).padStart(3,'0')
            const items = (() => { try { return (JSON.parse(order.items)||[]).map(i=>`${i.qty}x ${i.name}`).join(', ') } catch(e){ return '' } })()
            const isDelivery = (order.addr||'').includes('Mesa') ? '🪑 Mesa' : (order.addr||'').toLowerCase().includes('balc') ? '🏪 Balcão' : '🛵 Entrega'
            const total = (parseFloat(order.total||0) + parseFloat(order.taxa||0)).toFixed(2).replace('.',',')
            const vars  = { nome, id:idStr, itens:items, total, endereco:order.addr||'', mesa:String(order.mesa_num||''), tipo_entrega:isDelivery }

            // Mapeamento status → chave da automação
            const tipoAuto = {
              analise:   'recebido',
              producao:  'confirmado',
              pronto:    'pronto',
              saiu:      'entrega',
              entregue:  'entrega',
              cancelado: 'cancelado',
              finalizado:'avaliacao'
            }[new_status]

            const ct = tipoAuto ? (auto[tipoAuto] || {}) : {}

            // Mensagens padrão (usadas quando automação não está configurada)
            const msgPadrao = {
              analise:   `📥 Olá, *${nome}*! Recebemos seu pedido *#${idStr}* com sucesso! 🎉\n\n🛒 ${items}\n💰 Total: R$${total}\n\nEm breve confirmaremos. Aguarde! ⏱️`,
              producao:  `👨‍🍳 *#${idStr}* confirmado!\n\nOlá *${nome}*, seu pedido está sendo preparado agora. Aguarde! 😊`,
              pronto:    `✅ *#${idStr}* pronto!\n\n*${nome}*, seu pedido está pronto! ${isDelivery === '🛵 Entrega' ? 'Em instantes sairá para entrega.' : isDelivery === '🪑 Mesa' ? 'Já pode chamar o garçom.' : 'Pode retirar no balcão.'}`,
              saiu:      `🛵 *#${idStr}* a caminho!\n\n*${nome}*, seu pedido saiu para entrega! Chegará em breve. 🎉`,
              entregue:  `🎉 Entregue!\n\n*${nome}*, seu pedido *#${idStr}* foi entregue. Bom apetite! ⭐`,
              cancelado: `😔 *#${idStr}* cancelado.\n\n*${nome}*, seu pedido foi cancelado. Entre em contato para mais informações.`,
              finalizado:`🎉 *${nome}*, obrigado pelo pedido *#${idStr}*! Bom apetite! ⭐`,
            }

            // Regra de envio:
            // • ct.on === false → toggle desligado → NÃO envia
            // • ct.on === true e ct.msg preenchido → envia msg customizada
            // • ct não configurado (toggle nunca salvo) → envia msg padrão
            let msgFinal = null
            if (ct.on === false) {
              log('⏭️', `Automação "${tipoAuto}" desligada para #${idStr} — WA não enviado`)
            } else if (ct.on && ct.msg) {
              msgFinal = fillVars(ct.msg, vars)
            } else {
              msgFinal = msgPadrao[new_status] || null
            }

            if (msgFinal) {
              // finalizado → delay configurável (padrão 1 min) antes de enviar avaliação
              // todos os outros status → envio imediato
              if (new_status === 'finalizado') {
                const minutos = Math.max(1, parseInt(auto._aval_minutos || 1, 10) || 1)
                const delayMs = minutos * 60 * 1000
                log('⏳', `Avaliação agendada em ${minutos} min para #${idStr}`)
                setTimeout(async () => {
                  // Revalida toggle no momento do disparo
                  const cfgNow  = db.prepare("SELECT evo_automacoes FROM store_config WHERE tenant_id=?").get(tid)
                  const autoNow = jsonParse(cfgNow?.evo_automacoes) || {}
                  if (autoNow['avaliacao']?.on === false) {
                    log('⏭️', `Avaliação desligada durante espera — #${idStr} não enviado`)
                    return
                  }
                  const r = await sendWA(order.phone, msgFinal, inst)
                  log(r.ok ? '📲' : '❌', `Automação "avaliacao" (+${minutos}min) → WA #${idStr} (${order.phone}): ${r.ok ? 'enviado' : JSON.stringify(r)}`)
                  if (r.ok) processed.add(`${order.id}_${new_status}`)
                }, delayMs)
              } else {
                const r = await sendWA(order.phone, msgFinal, inst)
                log(r.ok ? '📲' : '❌', `Automação "${tipoAuto || new_status}" → WA #${idStr} (${order.phone}): ${r.ok ? 'enviado' : JSON.stringify(r)}`)
                if (r.ok) processed.add(`${order.id}_${new_status}`)
              }
            }
          } catch(e) {
            log('❌', `Erro WA order-status #${order.id}:`, { error: e.message })
          }
        })
      }

    } catch(e) {
      log('❌','Erro order-status:',{error:e.message})
      send(res,500,{ok:false,error:e.message})
    }
    return
  }

  // ════════════════════════════════════════════════════════
  // WEBHOOK EVOLUTION API → AGENTE IA
  // ════════════════════════════════════════════════════════
  if(req.method==='POST'&&(upath.startsWith('/webhook/whatsapp')||upath.startsWith('/webhook/'))){
    const body = await readBody(req)
    // Aceita /webhook/whatsapp/{tenant_id}  OU  /webhook/{slug}
    let tenantId = upath.startsWith('/webhook/whatsapp')
      ? (upath.split('/')[3] || null)
      : null
    if (!tenantId) {
      const slug = upath.split('/')[2] || null
      if (slug) {
        const row = db.prepare("SELECT id FROM tenants WHERE slug=? OR id=?").get(slug, slug)
        tenantId = row?.id || null
      }
    }
    tenantId = tenantId || req.headers['x-tenant-id'] || null
    try {
      const msg    = body?.data?.message?.conversation || body?.data?.message?.extendedTextMessage?.text || ''
      const from   = body?.data?.key?.remoteJid || ''
      const fromMe = body?.data?.key?.fromMe || false
      if (!msg || !from || fromMe) { send(res,200,{ok:true}); return }
      const phone = from.replace('@s.whatsapp.net','').replace('@c.us','')
      if (!tenantId) { send(res,200,{ok:true}); return }

      // Config do tenant (tópicos habilitados, ativo)
      const cfg = db.prepare("SELECT ia_config,evo_instance,store_name,store_descricao,store_whatsapp,store_tempo_entrega,delivery_fee_config,horarios_config,store_open FROM store_config WHERE tenant_id=?").get(tenantId)
      if (!cfg) { send(res,200,{ok:true}); return }
      const ia = jsonParse(cfg.ia_config) || {}
      if (!ia.ativo) { send(res,200,{ok:true}); return }

      // Config global do admin (key, modelo, buffer, quebra, pausa)
      const cfgGlobal = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
      const iaG = jsonParse(cfgGlobal?.ia_config) || {}
      const openaiKey  = iaG.openai_key || ''
      if (!openaiKey) { log('⚠️','OpenAI key não configurada no admin'); send(res,200,{ok:true}); return }
      const modelo    = iaG.modelo    || 'gpt-4o-mini'
      const maxTokens = iaG.max_tokens|| 800
      const bufferSeg = iaG.buffer_seg|| 3
      const quebraLen = iaG.quebra_linha || 0
      const pausaMin  = iaG.pausa_min || 30

      // Pausa humano: checa se está em pausa para este cliente
      const pausaKey = `pausa:${tenantId}:${phone}`
      const pausaAt  = _pausaHumano.get(pausaKey)
      if (pausaAt && (Date.now() - pausaAt) < pausaMin * 60 * 1000) {
        log('⏸️', `IA pausada para ${phone} (humano assumiu)`); send(res,200,{ok:true}); return
      }

      // Histórico de conversa por cliente (últimas 10 trocas)
      const convKey = `conv:${tenantId}:${phone}`
      if (!_msgBuffer.has(convKey + '_hist')) _msgBuffer.set(convKey + '_hist', [])
      const convHist = _msgBuffer.get(convKey + '_hist')

      // Buffer: acumula mensagens por N segundos antes de responder
      const bufKey = `buf:${tenantId}:${phone}`
      if (_msgBuffer.has(bufKey)) clearTimeout(_msgBuffer.get(bufKey).timer)
      const msgs = _msgBuffer.has(bufKey) ? _msgBuffer.get(bufKey).msgs : []
      msgs.push(msg)

      const timer = setTimeout(async () => {
        _msgBuffer.delete(bufKey)
        const msgFull = msgs.join('\n')
        const inst = cfg.evo_instance || EVO_INST
        const nomeLoja = cfg.store_name || 'Restaurante'

        // ══════════════════════════════════════════════════
        // CONTEXTO COMPLETO DO RESTAURANTE PARA A IA
        // ══════════════════════════════════════════════════
        const contexto = []

        // ── Link do cardápio ──────────────────────────────
        const tenantRow = db.prepare("SELECT slug FROM tenants WHERE id=?").get(tenantId)
        const slugTenant = tenantRow?.slug || tenantId
        const proto = req.headers['x-forwarded-proto'] || 'https'
        const host  = req.headers['host'] || ''
        const linkCardapio = `${proto}://${host}/index.html?slug=${slugTenant}`

        // ── Status da loja (aberta/fechada agora) ─────────
        const agora = new Date()
        const diasSemana = ['dom','seg','ter','qua','qui','sex','sab']
        const diaHoje = diasSemana[agora.getDay()]
        const horaMin = agora.getHours() * 60 + agora.getMinutes()
        let lojaAbertaAgora = cfg.store_open !== false
        const horariosCfg = jsonParse(cfg.horarios_config) || {}
        const diaConfig = horariosCfg[diaHoje]
        if (diaConfig) {
          if (!diaConfig.ativo) {
            lojaAbertaAgora = false
          } else {
            const [ah, am] = (diaConfig.abertura || '00:00').split(':').map(Number)
            const [fh, fm] = (diaConfig.fechamento || '23:59').split(':').map(Number)
            lojaAbertaAgora = horaMin >= ah * 60 + am && horaMin <= fh * 60 + fm
          }
        }

        // ── 1. INFORMAÇÕES DA LOJA ────────────────────────
        const taxaCfg = jsonParse(cfg.delivery_fee_config) || {}
        const infoLoja = []
        infoLoja.push(`Nome: ${nomeLoja}`)
        infoLoja.push(`Status agora: ${lojaAbertaAgora ? '🟢 ABERTO' : '🔴 FECHADO'}`)
        if (cfg.store_whatsapp) infoLoja.push(`WhatsApp: ${cfg.store_whatsapp}`)
        if (cfg.store_descricao) infoLoja.push(`Descrição: ${cfg.store_descricao}`)
        if (cfg.store_tempo_entrega) infoLoja.push(`Tempo estimado de entrega: ${cfg.store_tempo_entrega}`)
        // Taxa de entrega — formato real: { tipo:'fixo', valor:X } ou { tipo:'por_km', faixas:[{ate_km,taxa}] }
        if (taxaCfg.tipo === 'fixo') {
          const taxa = parseFloat(taxaCfg.valor || 0)
          infoLoja.push(`Taxa de entrega: ${taxa > 0 ? 'R$ ' + taxa.toFixed(2).replace('.', ',') : 'Grátis'}`)
        } else if (taxaCfg.tipo === 'por_km' && taxaCfg.faixas?.length) {
          const faixasTxt = taxaCfg.faixas.map(f => `até ${f.ate_km}km: R$${parseFloat(f.taxa).toFixed(2).replace('.',',')}`)
          infoLoja.push(`Taxa de entrega por distância: ${faixasTxt.join(' | ')}`)
        }
        infoLoja.push(`Cardápio digital: ${linkCardapio}`)
        contexto.push(`INFORMAÇÕES DA LOJA:\n${infoLoja.join('\n')}`)

        // ── 2. HORÁRIOS DE FUNCIONAMENTO ──────────────────
        const diasNome = {dom:'Domingo',seg:'Segunda',ter:'Terça',qua:'Quarta',qui:'Quinta',sex:'Sexta',sab:'Sábado'}
        if (Object.keys(horariosCfg).length) {
          const horTxt = Object.entries(horariosCfg).map(([d, h]) =>
            h.ativo
              ? `${diasNome[d]}: ${h.abertura} às ${h.fechamento}${d === diaHoje ? ' ← hoje' : ''}`
              : `${diasNome[d]}: Fechado`
          ).join('\n')
          contexto.push(`HORÁRIO DE FUNCIONAMENTO:\n${horTxt}`)
        }

        // ── 3. CARDÁPIO POR CATEGORIA ─────────────────────
        const categorias = db.prepare("SELECT name, label FROM categories WHERE tenant_id=? AND ativo=1 ORDER BY sort_order").all(tenantId)
        const itensTodos = db.prepare("SELECT name, description, price, price_old, status, cat_key, cat, emoji, promo FROM menu_items WHERE tenant_id=? AND status != 'pausado' ORDER BY id").all(tenantId)

        if (itensTodos.length) {
          // Agrupa por categoria
          const catMap = new Map()
          for (const item of itensTodos) {
            const catKey = item.cat_key || item.cat || 'outros'
            if (!catMap.has(catKey)) catMap.set(catKey, [])
            catMap.get(catKey).push(item)
          }
          let cardapioTxt = ''
          for (const [catKey, items] of catMap) {
            const catInfo = categorias.find(c => c.name === catKey)
            const catLabel = catInfo?.label || catInfo?.name || catKey
            const itensTxt = items.map(i => {
              const preco = `R$${parseFloat(i.price).toFixed(2).replace('.', ',')}`
              const precoAnt = i.price_old ? ` (era R$${parseFloat(i.price_old).toFixed(2).replace('.', ',')})` : ''
              const esgotado = i.status === 'esgotado' ? ' [ESGOTADO]' : ''
              const promo = i.promo ? ' 🔥PROMOÇÃO' : ''
              const desc = i.description ? ` — ${i.description.slice(0, 60)}${i.description.length > 60 ? '…' : ''}` : ''
              return `  • ${i.name}: ${preco}${precoAnt}${promo}${esgotado}${desc}`
            }).join('\n')
            cardapioTxt += `\n${catLabel.toUpperCase()}:\n${itensTxt}\n`
          }
          contexto.push(`CARDÁPIO COMPLETO:${cardapioTxt}\nPara ver fotos e fazer pedido: ${linkCardapio}`)
        }

        // ── 4. PROMOÇÕES ATIVAS (itens em oferta) ─────────
        const itensPromo = itensTodos.filter(i => i.promo && i.status !== 'esgotado')
        if (itensPromo.length) {
          const promoTxt = itensPromo.map(i => {
            const preco = `R$${parseFloat(i.price).toFixed(2).replace('.', ',')}`
            const ant   = i.price_old ? ` (antes R$${parseFloat(i.price_old).toFixed(2).replace('.', ',')})` : ''
            return `  🔥 ${i.name}: ${preco}${ant}`
          }).join('\n')
          contexto.push(`PROMOÇÕES DO DIA:\n${promoTxt}`)
        }

        // ── 5. CUPONS DE DESCONTO ATIVOS ──────────────────
        const cupons = db.prepare(`
          SELECT code, type, value, min_order FROM cupons
          WHERE tenant_id=? AND ativo=1
          AND (expires_at IS NULL OR expires_at > datetime('now'))
          LIMIT 5
        `).all(tenantId)
        if (cupons.length) {
          const cupTxt = cupons.map(cp => {
            const desc = cp.type === 'percent'
              ? `${cp.value}% de desconto`
              : `R$${parseFloat(cp.value).toFixed(2).replace('.', ',')} de desconto`
            const min = parseFloat(cp.min_order || 0) > 0
              ? ` (pedido mínimo R$${parseFloat(cp.min_order).toFixed(2).replace('.', ',')})`
              : ''
            return `  • Código *${cp.code}*: ${desc}${min}`
          }).join('\n')
          contexto.push(`CUPONS DE DESCONTO DISPONÍVEIS:\n${cupTxt}`)
        }

        // ── 6. PEDIDOS DO CLIENTE (pelo telefone) ─────────
        const pedidosCliente = db.prepare(`
          SELECT id, status, total, items, created_at FROM orders
          WHERE tenant_id=? AND phone LIKE ?
          ORDER BY id DESC LIMIT 3
        `).all(tenantId, `%${phone.slice(-8)}%`)

        if (pedidosCliente.length) {
          const slStatus = {
            analise:  '⏳ aguardando confirmação',
            producao: '👨‍🍳 em preparo',
            pronto:   '✅ pronto',
            saiu:     '🛵 saiu para entrega',
            entregue: '🎉 entregue',
            cancelado:'❌ cancelado',
            finalizado:'✅ finalizado'
          }
          const pedTxt = pedidosCliente.map(p => {
            const itsPed = (() => { try { return (JSON.parse(p.items)||[]).map(i=>`${i.qty}x ${i.name}`).join(', ') } catch(e) { return '' } })()
            return `  Pedido #${p.id}: ${slStatus[p.status]||p.status} — R$${parseFloat(p.total).toFixed(2).replace('.',',')}${itsPed ? ' — '+itsPed : ''}`
          }).join('\n')
          contexto.push(`PEDIDOS RECENTES DESTE CLIENTE:\n${pedTxt}`)
        }

        // ── 7. PEDIDO ESPECÍFICO MENCIONADO NA MENSAGEM ───
        const slStatus = {
          analise:  '⏳ aguardando confirmação',
          producao: '👨‍🍳 em preparo',
          pronto:   '✅ pronto para retirada/entrega',
          saiu:     '🛵 saiu para entrega',
          entregue: '🎉 entregue',
          cancelado:'❌ cancelado',
          finalizado:'✅ finalizado'
        }
        const numPedidoMatch =
          msgFull.match(/#\*?(\d{1,6})\*?/) ||
          msgFull.match(/pedido\s*[*#]?\s*(\d{1,6})/i) ||
          msgFull.match(/n[uú]mero\s*[*#]?\s*(\d{1,6})/i) ||
          msgFull.match(/\b0*([1-9]\d{0,5})\b/)

        const numPedido = numPedidoMatch ? parseInt(numPedidoMatch[1]) : null
        if (numPedido) log('🔍', `Buscando pedido #${numPedido} (tenant: ${tenantId}, phone: ...${phone.slice(-4)})`)

        if (numPedido) {
          let ped = db.prepare("SELECT id,status,total,items,client,phone,addr,pag,created_at FROM orders WHERE tenant_id=? AND id=?").get(tenantId, numPedido)
          if (!ped) ped = db.prepare("SELECT id,status,total,items,client,phone,addr,pag,created_at FROM orders WHERE id=? AND phone LIKE ?").get(numPedido, `%${phone.slice(-8)}%`)
          if (!ped) ped = db.prepare("SELECT id,status,total,items,client,phone,addr,pag,created_at FROM orders WHERE id=?").get(numPedido)

          if (ped) {
            log('✅', `Pedido #${numPedido} encontrado`)
            const itsPed = (() => { try { return (JSON.parse(ped.items)||[]).map(i=>`${i.qty}x ${i.name}`).join(', ') } catch(e) { return '' } })()
            contexto.push([
              `PEDIDO CONSULTADO (#${ped.id}):`,
              `  Cliente: ${ped.client || '—'}`,
              `  Status: ${slStatus[ped.status] || ped.status}`,
              `  Total: R$${parseFloat(ped.total).toFixed(2).replace('.', ',')}`,
              `  Itens: ${itsPed || '—'}`,
              ped.addr ? `  Endereço: ${ped.addr}` : '',
              ped.pag  ? `  Pagamento: ${ped.pag}` : '',
            ].filter(Boolean).join('\n'))
          } else {
            contexto.push(`PEDIDO #${numPedido}: não encontrado. Oriente o cliente a verificar o número.`)
          }
        }

        // ══════════════════════════════════════════════════
        // SYSTEM PROMPT COMPLETO
        // ══════════════════════════════════════════════════
        const systemPrompt = `${iaG.prompt_base || `Você é o assistente virtual do ${nomeLoja}. Seja simpático, objetivo e use emojis com moderação. Responda sempre em português.`}

${contexto.join('\n\n')}

REGRAS DE ATENDIMENTO:
- CARDÁPIO: Nunca liste todos os itens na mensagem. Sempre envie o link do cardápio: ${linkCardapio}
- PEDIDO: Se o cliente perguntar sobre pedido sem informar o número, pergunte "Qual o número do seu pedido? (ex: #023)". Se já informou, responda com o status diretamente.
- PROMOÇÕES: Se houver promoções ativas, mencione-as proativamente quando o cliente perguntar sobre o cardápio.
- CUPONS: Se houver cupons ativos, informe o código ao cliente quando relevante.
- HORÁRIO: Informe se a loja está aberta ou fechada agora, e os horários de funcionamento quando perguntado.
- ENTREGA: Informe a taxa e tempo estimado de entrega quando perguntado.
- FOCO: Responda apenas sobre este restaurante. Para assuntos não relacionados, diga educadamente que só pode ajudar com informações do estabelecimento.
- NOVO PEDIDO: Para fazer um pedido, sempre direcione o cliente para o cardápio digital: ${linkCardapio}`

        try {
          const r = await fetch('https://api.openai.com/v1/chat/completions',{
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':`Bearer ${openaiKey}`},
            body:JSON.stringify({model:modelo,max_tokens:maxTokens,messages:[
              {role:'system',content:systemPrompt},
              ...convHist.slice(-10), // últimas 10 mensagens do histórico
              {role:'user',content:msgFull}
            ]})
          })
          const d = await r.json().catch(()=>({}))
          let resposta = d?.choices?.[0]?.message?.content || ''

          // Quebra de linha
          if (quebraLen > 0 && resposta.length > quebraLen) {
            const words = resposta.split(' ')
            let linha = '', result = []
            for (const w of words) {
              if ((linha+' '+w).trim().length > quebraLen) { result.push(linha.trim()); linha = w }
              else linha = (linha+' '+w).trim()
            }
            if (linha) result.push(linha)
            resposta = result.join('\n')
          }

          if (resposta) {
            await sendWA(phone, resposta, inst)
            log('🤖',`IA → ${phone}: ${resposta.slice(0,60)}`)
            // Salva no histórico de conversa
            convHist.push({role:'user',content:msgFull})
            convHist.push({role:'assistant',content:resposta})
            // Mantém no máximo 20 mensagens (10 trocas)
            if (convHist.length > 20) convHist.splice(0, convHist.length - 20)
            _msgBuffer.set(convKey + '_hist', convHist)
          }
        } catch(e) { log('❌','IA OpenAI error:',e.message) }
      }, bufferSeg * 1000)

      _msgBuffer.set(bufKey, { msgs, timer })
    } catch(e) { log('❌','Webhook error:',e.message) }
    send(res,200,{ok:true}); return
  }

  // Notifica que humano assumiu — pausa IA para aquele cliente
  if(req.method==='POST'&&upath==='/api/ia-humano-assumiu'){
    const { phone, tenant_id } = await readBody(req)
    if (phone && tenant_id) {
      _pausaHumano.set(`pausa:${tenant_id}:${phone}`, Date.now())
      log('👤',`Humano assumiu conversa com ${phone} — IA pausada`)
    }
    send(res,200,{ok:true}); return
  }

  // Endpoint: envia mensagem de rastreio via WhatsApp (chamado pelo index.html)
  if(req.method==='POST'&&upath==='/api/rastreio-wa'){
    const { phone, order_id, tenant_id } = await readBody(req)
    if (!phone||!order_id||!tenant_id) { send(res,400,{ok:false}); return }
    const cfg = db.prepare("SELECT evo_instance,store_name,ia_config FROM store_config WHERE tenant_id=?").get(tenant_id)
    const inst = cfg?.evo_instance || EVO_INST
    const ia   = jsonParse(cfg?.ia_config)||{}
    if (!ia.ativo && !ia.resp_rastreio_manual) { send(res,200,{ok:false,msg:'IA inativa'}); return }
    const pedido = db.prepare("SELECT id,status,items,total FROM orders WHERE id=? AND tenant_id=?").get(order_id, tenant_id)
    if (!pedido) { send(res,400,{ok:false}); return }
    const statusLabel = {analise:'⏳ aguardando confirmação',producao:'👨‍🍳 em preparo',pronto:'🛵 saindo para entrega',entregue:'✅ entregue',cancelado:'❌ cancelado'}[pedido.status]||pedido.status
    const nomeLoja = cfg?.store_name || 'Restaurante'
    const msg = `🍽️ *${nomeLoja}*\n\nOlá! Seu pedido *#${String(pedido.id).padStart(3,'0')}* está com o status:\n\n${statusLabel}\n\nTotal: R$ ${parseFloat(pedido.total).toFixed(2).replace('.',',')}\n\nQualquer dúvida é só responder aqui! 😊`
    const r = await sendWA(phone, msg, inst)
    send(res, r.ok?200:500, r)
    return
  }

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
  log('🏢',`Multi-tenant ativo — SQLite: ${DB_PATH}`)
})

setInterval(checarAniv,60000)
setInterval(checarPedidos,15000)
setTimeout(checarAniv,5000)
setTimeout(checarPedidos,8000)

process.on('SIGTERM',()=>{db.close();server.close();process.exit(0)})
process.on('SIGINT', ()=>{db.close();server.close();process.exit(0)})

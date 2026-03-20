// ═══════════════════════════════════════════════════════
// lib/db.js — SQLite + Migrations + Backup
// ═══════════════════════════════════════════════════════
'use strict'

const fs       = require('fs')
const path     = require('path')
const crypto   = require('crypto')
const Database = require('better-sqlite3')

const DB_PATH     = process.env.DB_PATH     || '/app/data/estima.db'
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'
const BACKUP_PATH = path.join(path.dirname(DB_PATH), 'backup.json')

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
fs.mkdirSync(UPLOADS_DIR, { recursive: true })

// ── Logger centralizado ───────────────────────────────
function log(emoji, msg, data) {
  const t = new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })
  console.log(`[${t}] ${emoji}  ${msg}`, data ? JSON.stringify(data) : '')
}

// ── Diagnóstico de persistência ────────────────────────
const _dbExistia = fs.existsSync(DB_PATH)
log('💾', `Banco: ${DB_PATH}`)
log(_dbExistia ? '✅' : '🆕', _dbExistia
  ? 'Banco existente encontrado — dados preservados'
  : 'Banco NOVO — se aparecer após deploy, o volume /app/data NÃO está montado!')
log('📁', `Uploads: ${UPLOADS_DIR}`)

// ── Conexão ───────────────────────────────────────────
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')   // ← WAL+NORMAL: durável e ~3× mais rápido que FULL
db.pragma('cache_size = -16384')    // ← 16 MB de cache (default 2 MB)
db.pragma('temp_store = MEMORY')    // ← tabelas temp em RAM
db.pragma('mmap_size = 134217728')  // ← mmap 128 MB para reads sequenciais
db.pragma('foreign_keys = ON')

// ── Schema inicial ────────────────────────────────────
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
    store_whatsapp TEXT, gestor_tema TEXT
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
    cat TEXT, cat_key TEXT, emoji TEXT, image_url TEXT,
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
    garcom_id INTEGER, garcom_nome TEXT, customer_id INTEGER,
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
    order_id INTEGER, client TEXT, phone TEXT,
    nota INTEGER NOT NULL DEFAULT 5, comentario TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Índices de performance
  CREATE INDEX IF NOT EXISTS idx_orders_tenant     ON orders(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(tenant_id, status);
  CREATE INDEX IF NOT EXISTS idx_orders_phone      ON orders(tenant_id, phone);
  CREATE INDEX IF NOT EXISTS idx_menu_tenant       ON menu_items(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_mesas_tenant      ON mesas(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_fidelidade_tenant ON fidelidade(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_customers_phone   ON customers(tenant_id, phone);
`)

// ════════════════════════════════════════════════════════
// MIGRATIONS
// ════════════════════════════════════════════════════════
const MIGRATIONS = [
  { version:1,  description:'expires_at em tenants',           up:`ALTER TABLE tenants ADD COLUMN expires_at TEXT` },
  { version:2,  description:'evo_instance em store_config',    up:`ALTER TABLE store_config ADD COLUMN evo_instance TEXT` },
  { version:3,  description:'label/type/promo em categories',  up:[`ALTER TABLE categories ADD COLUMN label TEXT`,`ALTER TABLE categories ADD COLUMN type TEXT DEFAULT 'Itens principais'`,`ALTER TABLE categories ADD COLUMN promo INTEGER DEFAULT 0`,`UPDATE categories SET label = name WHERE label IS NULL`] },
  { version:4,  description:'colunas menu_items',              up:[`ALTER TABLE menu_items ADD COLUMN price_old REAL`,`ALTER TABLE menu_items ADD COLUMN cat TEXT`,`ALTER TABLE menu_items ADD COLUMN cat_key TEXT`,`ALTER TABLE menu_items ADD COLUMN emoji TEXT`,`ALTER TABLE menu_items ADD COLUMN promo INTEGER DEFAULT 0`,`ALTER TABLE menu_items ADD COLUMN item_type TEXT DEFAULT 'normal'`,`ALTER TABLE menu_items ADD COLUMN allow_half INTEGER DEFAULT 0`,`ALTER TABLE menu_items ADD COLUMN max_flavors INTEGER DEFAULT 1`,`ALTER TABLE menu_items ADD COLUMN days TEXT DEFAULT '[1,1,1,1,1,1,1]'`,`ALTER TABLE menu_items ADD COLUMN ingredients TEXT DEFAULT '[]'`] },
  { version:5,  description:'branding store_config',           up:[`ALTER TABLE store_config ADD COLUMN store_name TEXT`,`ALTER TABLE store_config ADD COLUMN store_descricao TEXT`,`ALTER TABLE store_config ADD COLUMN store_logo_url TEXT`,`ALTER TABLE store_config ADD COLUMN store_banner_url TEXT`,`ALTER TABLE store_config ADD COLUMN store_cor TEXT DEFAULT '#3b82f6'`,`ALTER TABLE store_config ADD COLUMN store_tempo_entrega TEXT DEFAULT '30-45 min'`,`ALTER TABLE store_config ADD COLUMN store_avaliacao TEXT DEFAULT '5.0'`,`ALTER TABLE store_config ADD COLUMN store_whatsapp TEXT`] },
  { version:6,  description:'gestor_tema em store_config',     up:`ALTER TABLE store_config ADD COLUMN gestor_tema TEXT` },
  { version:7,  description:'total/pag_forma em mesas',        up:[`ALTER TABLE mesas ADD COLUMN total REAL DEFAULT 0`,`ALTER TABLE mesas ADD COLUMN pag_forma TEXT`] },
  { version:8,  description:'ia_config em store_config',       up:`ALTER TABLE store_config ADD COLUMN ia_config TEXT` },
  { version:9,  description:'tenant _global',                  up:[`INSERT OR IGNORE INTO tenants (id,nome,plano,slug) VALUES ('_global','Global Config','premium','_global')`,`INSERT OR IGNORE INTO store_config (tenant_id) VALUES ('_global')`] },
  { version:10, description:'horarios_config em store_config', up:`ALTER TABLE store_config ADD COLUMN horarios_config TEXT` },
  { version:11, description:'colunas customers',               up:[`ALTER TABLE customers ADD COLUMN total_spent REAL DEFAULT 0`,`ALTER TABLE customers ADD COLUMN last_order_at TEXT`,`ALTER TABLE customers ADD COLUMN email TEXT`,`ALTER TABLE customers ADD COLUMN birthday TEXT`] },
  { version:12, description:'senha_hash em customers',         up:`ALTER TABLE customers ADD COLUMN senha_hash TEXT` },
  { version:13, description:'customer_id em orders',           up:`ALTER TABLE orders ADD COLUMN customer_id INTEGER` },
  { version:14, description:'tabela ratings',                  up:`CREATE TABLE IF NOT EXISTS ratings (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, order_id INTEGER, client TEXT, phone TEXT, nota INTEGER NOT NULL DEFAULT 5, comentario TEXT, created_at TEXT DEFAULT (datetime('now')))` },
  { version:15, description:'troco em orders',                 up:`ALTER TABLE orders ADD COLUMN troco REAL` },
]

function runMigrations() {
  const current = db.pragma('user_version', { simple: true })
  const pending = MIGRATIONS.filter(m => m.version > current)
  if (!pending.length) { log('✅', `Schema ok (v${current})`); return }
  log('🔄', `${pending.length} migration(s) pendentes (banco em v${current})`)
  for (const m of pending) {
    try {
      db.transaction(() => {
        for (const sql of [].concat(m.up)) {
          try { db.exec(sql) } catch(e) {
            if (e.message?.includes('duplicate column name')) {
              log('⚠️', `  [v${m.version}] Coluna já existia: ${e.message}`)
            } else throw e
          }
        }
        db.pragma(`user_version = ${m.version}`)
      })()
      log('✅', `  [v${m.version}] ${m.description}`)
    } catch(e) {
      log('❌', `  [v${m.version}] Falhou: ${e.message}`)
      break
    }
  }
  log('💾', `Schema agora em v${db.pragma('user_version', { simple: true })}`)
}

runMigrations()

// ── Backup / Restore ──────────────────────────────────
const TABELAS_BACKUP = ['tenants','sys_users','store_config','categories','menu_items',
  'cupons','mesas','garcons','orders','movimentos','estoque','fidelidade','customers']

let _dirty = false
function marcarDirty() { _dirty = true }

function fazerBackup(forcar = false) {
  if (!forcar && !_dirty) return  // Nada mudou — pula
  _dirty = false
  try {
    const snapshot = { ts: new Date().toISOString(), tabelas: {} }
    for (const t of TABELAS_BACKUP) {
      try { snapshot.tabelas[t] = db.prepare(`SELECT * FROM "${t}"`).all() } catch { snapshot.tabelas[t] = [] }
    }
    const total = Object.values(snapshot.tabelas).reduce((a, b) => a + b.length, 0)
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(snapshot), 'utf8')
    log('💾', `Backup salvo (${total} registros)`)
  } catch(e) { log('❌', 'Erro backup:', { error: e.message }) }
}

function restaurarBackup() {
  if (!fs.existsSync(BACKUP_PATH)) { log('⚠️', 'Nenhum backup encontrado.'); return false }
  try {
    const snapshot = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'))
    log('♻️', `Restaurando backup de ${snapshot.ts}...`)
    const ordem = TABELAS_BACKUP
    for (const t of ordem) {
      const rows = snapshot.tabelas?.[t]
      if (!rows?.length) continue
      try {
        const cols = Object.keys(rows[0])
        const stmt = db.prepare(`INSERT OR IGNORE INTO "${t}" (${cols.map(c=>`"${c}"`).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`)
        const ins  = db.transaction(items => { let ok=0; for(const r of items){try{stmt.run(Object.values(r));ok++}catch(e){}} ; return ok })
        log('♻️', `  ${t}: ${ins(rows)}/${rows.length}`)
      } catch(e) { log('❌', `  Erro ${t}:`, { error: e.message }) }
    }
    log('✅', 'Restauração concluída!')
    return true
  } catch(e) { log('❌', 'Erro ao ler backup:', { error: e.message }); return false }
}

// ── Seed: superadmin + global tenant ─────────────────
if (!_dbExistia) {
  log('♻️', 'Banco novo — tentando restaurar backup...')
  restaurarBackup()
}

if (!db.prepare("SELECT id FROM sys_users WHERE role='superadmin' LIMIT 1").get()) {
  const hash = crypto.createHash('sha256').update('admin123').digest('hex')
  db.prepare("INSERT OR IGNORE INTO tenants (id,nome,plano,slug) VALUES ('system','Sistema Admin','premium','admin')").run()
  db.prepare("INSERT INTO sys_users (nome,email,senha_hash,role,tenant_id) VALUES (?,?,?,?,?)")
    .run('Administrador','admin@estimafood.com',hash,'superadmin','system')
  log('🔑','Superadmin criado: admin@estimafood.com / admin123')
}
db.prepare("INSERT OR IGNORE INTO tenants (id,nome,plano,slug) VALUES ('_global','Global Config','premium','_global')").run()
db.prepare("INSERT OR IGNORE INTO store_config (tenant_id) VALUES ('_global')").run()
for (const t of db.prepare("SELECT id FROM tenants").all()) {
  db.prepare("INSERT OR IGNORE INTO store_config (tenant_id) VALUES (?)").run(t.id)
}

// ── Backup periódico (somente quando há mudanças) ─────
setTimeout(() => fazerBackup(true), 10000)
setInterval(() => fazerBackup(), 5 * 60 * 1000)

// ── Utilitários ───────────────────────────────────────
function jsonParse(v) {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return v }
}

module.exports = { db, log, jsonParse, fazerBackup, restaurarBackup, marcarDirty, BACKUP_PATH, UPLOADS_DIR, DB_PATH }

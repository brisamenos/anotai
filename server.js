// ═══════════════════════════════════════════════════════
// ESTIMA FOOD — Servidor Multi-Tenant (SQLite + REST + SSE)
// ═══════════════════════════════════════════════════════
'use strict'

const http   = require('http')
const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')
const zlib   = require('zlib')
const Database = require('better-sqlite3')

// ── Todas as rotas especiais em um único arquivo — edite só routes.js ──
const handleRoutes = require('./routes')

const PORT        = process.env.PORT           || 3001
const EVO_URL     = process.env.EVOLUTION_URL  || 'https://projeto-evolution-api.xtknqq.easypanel.host'
const EVO_KEY     = process.env.EVOLUTION_KEY  || '429683C4C977415CAAFCCE10F7D57E11'
const EVO_INST    = process.env.EVOLUTION_INST || 'estima-food'
const DB_PATH     = process.env.DB_PATH        || '/app/data/estima.db'
const MP_TOKEN    = process.env.MP_ACCESS_TOKEN || ''   // Token do Mercado Pago (prod ou test)
const TAXA_PIX    = parseFloat(process.env.TAXA_PIX || '1.00')  // R$1,00 fixo por pagamento
const UPLOADS_DIR = process.env.UPLOADS_DIR    || '/app/data/uploads'
const BACKUP_PATH = path.join(path.dirname(DB_PATH), 'backup.json')

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
fs.mkdirSync(UPLOADS_DIR, { recursive: true })

function log(emoji, msg, data) {
  const t = new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })
  console.log(`[${t}] ${emoji}  ${msg}`, data ? JSON.stringify(data) : '')
}

const _dbExistia = fs.existsSync(DB_PATH)
log('💾', `Banco: ${DB_PATH}`)
log(_dbExistia ? '✅' : '🆕', _dbExistia
  ? 'Banco existente encontrado — dados preservados'
  : 'Banco NOVO — se aparecer após deploy, o volume /app/data NÃO está montado!')
log('📁', `Uploads: ${UPLOADS_DIR}`)

// ════════════════════════════════════════════════════════
// BANCO SQLite
// ════════════════════════════════════════════════════════
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('cache_size = -16384')
db.pragma('temp_store = MEMORY')
db.pragma('mmap_size = 134217728')
db.pragma('foreign_keys = ON')

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

  CREATE TABLE IF NOT EXISTS pagamentos_pix (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id INTEGER,
    mp_payment_id TEXT UNIQUE,
    mp_external_ref TEXT,
    valor REAL NOT NULL,
    taxa REAL NOT NULL DEFAULT 1.0,
    valor_liquido REAL NOT NULL,
    status TEXT DEFAULT 'pendente',
    payer_name TEXT, payer_doc TEXT,
    qr_code TEXT, qr_code_base64 TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    paid_at TEXT
  );
  CREATE TABLE IF NOT EXISTS saques (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tenant_nome TEXT,
    valor_solicitado REAL NOT NULL,
    num_pagamentos INTEGER DEFAULT 0,
    taxa_total REAL DEFAULT 0,
    valor_liquido REAL NOT NULL,
    pix_key TEXT NOT NULL,
    pix_key_tipo TEXT DEFAULT 'aleatoria',
    status TEXT DEFAULT 'pendente',
    obs_admin TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    paid_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pix_tenant    ON pagamentos_pix(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_pix_status    ON pagamentos_pix(tenant_id, status);
  CREATE INDEX IF NOT EXISTS idx_saques_tenant ON saques(tenant_id);
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
  { version:16, description:'order_num_offset em store_config', up:`ALTER TABLE store_config ADD COLUMN order_num_offset INTEGER DEFAULT 0` },
  { version:17, description:'tabelas pix e saques',             up:[
    `CREATE TABLE IF NOT EXISTS pagamentos_pix (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, order_id INTEGER, mp_payment_id TEXT UNIQUE, mp_external_ref TEXT, valor REAL NOT NULL, taxa REAL NOT NULL DEFAULT 1.0, valor_liquido REAL NOT NULL, status TEXT DEFAULT 'pendente', payer_name TEXT, payer_doc TEXT, qr_code TEXT, qr_code_base64 TEXT, created_at TEXT DEFAULT (datetime('now')), paid_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS saques (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, tenant_nome TEXT, valor_solicitado REAL NOT NULL, num_pagamentos INTEGER DEFAULT 0, taxa_total REAL DEFAULT 0, valor_liquido REAL NOT NULL, pix_key TEXT NOT NULL, pix_key_tipo TEXT DEFAULT 'aleatoria', status TEXT DEFAULT 'pendente', obs_admin TEXT, created_at TEXT DEFAULT (datetime('now')), paid_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_pix_tenant ON pagamentos_pix(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_saques_tenant ON saques(tenant_id)`
  ]},
  { version:18, description:'custom_groups e destaque em menu_items', up:[
    `ALTER TABLE menu_items ADD COLUMN custom_groups TEXT DEFAULT '[]'`,
    `ALTER TABLE menu_items ADD COLUMN destaque INTEGER DEFAULT 0`
  ]},
  { version:19, description:'sort_order em menu_items', up:`ALTER TABLE menu_items ADD COLUMN sort_order INTEGER DEFAULT 0` },
  { version:20, description:'cashback em customers e store_config', up:[
    `ALTER TABLE customers ADD COLUMN cashback_saldo REAL DEFAULT 0`,
    `ALTER TABLE store_config ADD COLUMN cashback_config TEXT DEFAULT '{}'`,
  ]},
  { version:21, description:'pedido_minimo, endereco, gps e tipos_entrega em store_config', up:[
    `ALTER TABLE store_config ADD COLUMN pedido_minimo REAL DEFAULT 0`,
    `ALTER TABLE store_config ADD COLUMN store_address TEXT`,
    `ALTER TABLE store_config ADD COLUMN store_lat REAL`,
    `ALTER TABLE store_config ADD COLUMN store_lng REAL`,
    `ALTER TABLE store_config ADD COLUMN tipos_entrega TEXT DEFAULT '["delivery","retirada","mesa"]'`,
  ]},
  { version:22, description:'tabela pagamentos_cartao e mp_public_key em store_config', up:[
    `CREATE TABLE IF NOT EXISTS pagamentos_cartao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      order_id INTEGER,
      mp_payment_id TEXT UNIQUE,
      mp_external_ref TEXT,
      valor REAL NOT NULL,
      status TEXT DEFAULT 'pendente',
      status_detail TEXT,
      payer_name TEXT,
      payer_email TEXT,
      last_four_digits TEXT,
      payment_method_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      paid_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_cartao_tenant ON pagamentos_cartao(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cartao_status ON pagamentos_cartao(tenant_id, status)`,
  ]},
  { version:23, description:'tabela wa_messages (cache de msgs WhatsApp)', up:[
    `CREATE TABLE IF NOT EXISTS wa_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      remote_jid TEXT NOT NULL,
      msg_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      from_me INTEGER DEFAULT 0,
      ts INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(tenant_id, msg_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_wa_jid ON wa_messages(tenant_id, remote_jid, ts)`
  ]},
  { version:24, description:'segmento em tenants (restaurante|acougue)', up:
    `ALTER TABLE tenants ADD COLUMN segmento TEXT DEFAULT 'restaurante'`
  },
  { version:25, description:'tabela print_jobs (fila de impressão para agente local)', up:
    `CREATE TABLE IF NOT EXISTS print_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      html TEXT NOT NULL,
      format TEXT DEFAULT 'A4',
      printer TEXT,
      status TEXT DEFAULT 'pending',
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      done_at TEXT
    )`
  },
  { version:26, description:'print_config em store_config', up:
    `ALTER TABLE store_config ADD COLUMN print_config TEXT`
  },
  { version:27, description:'store_tema em store_config (tema visual do cardapio publico)', up:
    `ALTER TABLE store_config ADD COLUMN store_tema TEXT DEFAULT 'classico'`
  },
  { version:28, description:'time e pag_momento em orders', up:[
    `ALTER TABLE orders ADD COLUMN time TEXT`,
    `ALTER TABLE orders ADD COLUMN pag_momento TEXT DEFAULT 'entrega'`
  ]},
  { version:29, description:'cor_texto e cats_carrossel em store_config', up:[
    `ALTER TABLE store_config ADD COLUMN store_cor_texto TEXT`,
    `ALTER TABLE store_config ADD COLUMN cats_carrossel INTEGER DEFAULT 0`
  ]},
  { version:30, description:'order_num sequencial por tenant', up:[
    `ALTER TABLE orders ADD COLUMN order_num INTEGER`
  ]},
  { version:31, description:'taxa_servico_pct em store_config', up:
    `ALTER TABLE store_config ADD COLUMN taxa_servico_pct REAL DEFAULT 0`
  },
  { version:32, description:'tabela radio_messages (áudios push-to-talk com expiração 10h)', up:
    `CREATE TABLE IF NOT EXISTS radio_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      from_id TEXT NOT NULL,
      from_nome TEXT NOT NULL,
      to_id TEXT NOT NULL,
      audio TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`
  },
]

function runMigrations() {
  const current = db.pragma('user_version', { simple: true })
  const pending = MIGRATIONS.filter(m => m.version > current)
  if (!pending.length) { log('✅', `Schema ok (v${current})`); return }
  log('🔄', `${pending.length} migration(s) pendentes`)
  for (const m of pending) {
    try {
      db.transaction(() => {
        for (const sql of [].concat(m.up)) {
          try { db.exec(sql) } catch(e) {
            if (e.message?.includes('duplicate column name')) log('⚠️', `  [v${m.version}] Coluna já existia`)
            else throw e
          }
        }
        db.pragma(`user_version = ${m.version}`)
      })()
      log('✅', `  [v${m.version}] ${m.description}`)
    } catch(e) { log('❌', `  [v${m.version}] Falhou: ${e.message}`); break }
  }
}
runMigrations()

// ── Backfill order_num para pedidos existentes ────────────────────────────
try {
  const _needsBackfill = db.prepare('SELECT COUNT(*) as cnt FROM orders WHERE order_num IS NULL').get()
  if (_needsBackfill?.cnt > 0) {
    log('🔄', `Backfill order_num: ${_needsBackfill.cnt} pedidos sem número sequencial`)
    const _tenants = db.prepare('SELECT DISTINCT tenant_id FROM orders WHERE order_num IS NULL').all()
    for (const { tenant_id } of _tenants) {
      const _nullOrders = db.prepare('SELECT id FROM orders WHERE tenant_id=? AND order_num IS NULL ORDER BY id ASC').all(tenant_id)
      const _existingMax = db.prepare('SELECT COALESCE(MAX(order_num),0) as mx FROM orders WHERE tenant_id=? AND order_num IS NOT NULL').get(tenant_id)
      let _seq = _existingMax?.mx || 0
      const _upd = db.prepare('UPDATE orders SET order_num=? WHERE id=?')
      db.transaction(() => { for (const r of _nullOrders) _upd.run(++_seq, r.id) })()
      log('✅', `  Tenant ${tenant_id}: ${_nullOrders.length} pedidos numerados (1..${_seq})`)
    }
  }
} catch(e) { log('⚠️', 'Backfill order_num erro (não-fatal):', e.message) }
// ──────────────────────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════
// BACKUP / RESTORE
// ════════════════════════════════════════════════════════
const TABELAS_BACKUP = ['tenants','sys_users','store_config','categories','menu_items',
  'cupons','mesas','garcons','orders','movimentos','estoque','fidelidade','customers','pagamentos_pix','saques','pagamentos_cartao']
  // wa_messages excluída — pode conter muita mídia e estourar JSON.stringify

let _dirty = false
function marcarDirty() { _dirty = true }

// ── Sessões Admin (SQLite, sobrevivem a restarts) ─────
db.exec(`CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT, nome TEXT, email TEXT, role TEXT,
  ts INTEGER NOT NULL
)`)
const ADMIN_SESSION_TTL = 8 * 60 * 60 * 1000
function criarSessaoAdmin(user) {
  const token = crypto.randomBytes(32).toString('hex')
  const ts = Date.now()
  db.prepare('DELETE FROM admin_sessions WHERE ts < ?').run(ts - ADMIN_SESSION_TTL)
  db.prepare('INSERT OR REPLACE INTO admin_sessions (token,user_id,nome,email,role,ts) VALUES (?,?,?,?,?,?)').run(token,user.id,user.nome,user.email,user.role,ts)
  return token
}
function validarSessaoAdmin(req) {
  const auth = req.headers['authorization'] || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null
  const s = db.prepare('SELECT * FROM admin_sessions WHERE token=?').get(token)
  if (!s) return null
  if (Date.now() - s.ts > ADMIN_SESSION_TTL) { db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token); return null }
  return s
}

function fazerBackup(forcar = false) {
  if (!forcar && !_dirty) return
  _dirty = false
  // Evita chamadas simultâneas
  if (fazerBackup._running) return
  fazerBackup._running = true
  setImmediate(() => {
    try {
      const snapshot = { ts: new Date().toISOString(), tabelas: {} }
      let total = 0
      for (const t of TABELAS_BACKUP) {
        try {
          const rows = db.prepare(`SELECT * FROM "${t}"`).all()
          // Remove campos grandes (imagens base64, json extenso) linha a linha
          snapshot.tabelas[t] = rows.map(row => {
            const r = {}
            for (const [k, v] of Object.entries(row)) {
              if (typeof v === 'string' && v.length > 50000) r[k] = null
              else r[k] = v
            }
            return r
          })
          total += rows.length
        } catch { snapshot.tabelas[t] = [] }
      }
      // Escreve em partes para não estourar a heap
      const ws = fs.createWriteStream(BACKUP_PATH + '.tmp')
      ws.write(JSON.stringify(snapshot))
      ws.end()
      ws.on('finish', () => {
        try { fs.renameSync(BACKUP_PATH + '.tmp', BACKUP_PATH) } catch {}
        log('💾', `Backup salvo (${total} registros)`)
        fazerBackup._running = false
      })
      ws.on('error', (e) => {
        log('❌', 'Erro backup write:', { error: e.message })
        fazerBackup._running = false
      })
    } catch(e) {
      log('❌', 'Erro backup:', { error: e.message })
      fazerBackup._running = false
    }
  })
}
fazerBackup._running = false

function restaurarBackup() {
  if (!fs.existsSync(BACKUP_PATH)) { log('⚠️', 'Nenhum backup encontrado.'); return false }
  try {
    const snapshot = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'))
    log('♻️', `Restaurando backup de ${snapshot.ts}...`)
    for (const t of TABELAS_BACKUP) {
      const rows = snapshot.tabelas?.[t]
      if (!rows?.length) continue
      try {
        const cols = Object.keys(rows[0])
        const stmt = db.prepare(`INSERT OR IGNORE INTO "${t}" (${cols.map(c=>`"${c}"`).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`)
        const ins  = db.transaction(items => { let ok=0; for(const r of items){try{stmt.run(Object.values(r));ok++}catch{}} ; return ok })
        log('♻️', `  ${t}: ${ins(rows)}/${rows.length}`)
      } catch(e) { log('❌', `  Erro ${t}:`, { error: e.message }) }
    }
    log('✅', 'Restauração concluída!'); return true
  } catch(e) { log('❌', 'Erro ao ler backup:', { error: e.message }); return false }
}

if (!_dbExistia) { log('♻️', 'Banco novo — tentando restaurar backup...'); restaurarBackup() }

if (!db.prepare("SELECT id FROM sys_users WHERE role='superadmin' LIMIT 1").get()) {
  const hash = crypto.createHash('sha256').update('Igor@18129512').digest('hex')
  db.prepare("INSERT OR IGNORE INTO tenants (id,nome,plano,slug) VALUES ('system','Sistema Admin','premium','admin')").run()
  db.prepare("INSERT INTO sys_users (nome,email,senha_hash,role,tenant_id) VALUES (?,?,?,?,?)").run('Administrador','admin@estimafood.com',hash,'superadmin','system')
  log('🔑','Superadmin criado: admin@estimafood.com / Igor@18129512')
}
db.prepare("INSERT OR IGNORE INTO tenants (id,nome,plano,slug) VALUES ('_global','Global Config','premium','_global')").run()
db.prepare("INSERT OR IGNORE INTO store_config (tenant_id) VALUES ('_global')").run()
for (const t of db.prepare("SELECT id FROM tenants").all()) {
  db.prepare("INSERT OR IGNORE INTO store_config (tenant_id) VALUES (?)").run(t.id)
}

setTimeout(() => fazerBackup(true), 10000)
setInterval(() => fazerBackup(), 5 * 60 * 1000)

// Cleanup de áudios de rádio expirados (>10h) — roda a cada 30 min
setInterval(() => {
  try { db.prepare("DELETE FROM radio_messages WHERE created_at < datetime('now','-10 hours')").run(); } catch {}
}, 30 * 60 * 1000)

// ════════════════════════════════════════════════════════
// SSE — Server-Sent Events
// ════════════════════════════════════════════════════════
const sseClients = new Map()

function sseSubscribe(channel, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  })
  res.write(': connected\n\n')
  if (!sseClients.has(channel)) sseClients.set(channel, new Set())
  const set = sseClients.get(channel)
  set.add(res)
  const ka = setInterval(() => { try { res.write(': ping\n\n') } catch { clearInterval(ka) } }, 25000)
  res.on('close', () => { clearInterval(ka); set.delete(res); if (set.size === 0) sseClients.delete(channel) })
}

function sseBroadcast(channel, event, data) {
  const clients = sseClients.get(channel)
  if (!clients?.size) return
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const r of clients) { try { r.write(msg) } catch { clients.delete(r) } }
}

const TABLE_CHANNELS = {
  orders:       (tid) => [`orders-rt:${tid}`],
  mesas:        (tid) => [`mesas-rt:${tid}`],
  store_config: (tid) => [`store-config-rt:${tid}`],
  menu_items:   (tid) => [`menu-rt:${tid}`],
  categories:   (tid) => [`cats-rt:${tid}`, `menu-rt:${tid}`],
  garcons:      (tid) => [`orders-rt:${tid}`],
  saques:       (tid) => [`saques-rt:${tid}`, `saques-admin`],
  customers:    (tid) => [`customers-rt:${tid}`],
}
const GARCOM_PREFIXES = ['garcom-mesas-', 'garcom-orders-']

function emit(tenantId, table, record, type) {
  const tid = tenantId || record?.tenant_id
  if (!tid || tid === 'global') return
  const event = `${table}:${type}`
  for (const ch of (TABLE_CHANNELS[table]?.(tid) || [])) sseBroadcast(ch, event, record)
  if (table === 'orders' || table === 'mesas') {
    for (const [ch] of sseClients) {
      if (ch.endsWith(`:${tid}`)) {
        for (const prefix of GARCOM_PREFIXES) {
          if (ch.startsWith(prefix)) { sseBroadcast(ch, event, record); break }
        }
      }
    }
  }
}

// ════════════════════════════════════════════════════════
// REST ENGINE
// ════════════════════════════════════════════════════════
const TABLE_COLS = {
  tenants:      ['id','nome','plano','ativo','slug','segmento','expires_at','created_at'],
  sys_users:    ['id','tenant_id','nome','email','senha_hash','role','ativo','ultimo_acesso','created_at'],
  store_config: ['id','tenant_id','store_open','caixa_open','delivery_fee_config','fid_config','evo_automacoes','evo_aniv_last','wa_server_url','sidebar_state','evo_instance','store_name','store_descricao','store_logo_url','store_banner_url','store_cor','store_cor_texto','store_tema','cats_carrossel','store_tempo_entrega','store_avaliacao','store_whatsapp','gestor_tema','ia_config','horarios_config','order_num_offset','cashback_config','pedido_minimo','store_address','store_lat','store_lng','tipos_entrega','print_config','taxa_servico_pct'],
  categories:   ['id','tenant_id','name','label','type','promo','emoji','sort_order','ativo'],
  menu_items:   ['id','tenant_id','name','description','price','price_old','category_id','cat','cat_key','emoji','image_url','promo','status','item_type','allow_half','max_flavors','days','ingredients','custom_groups','destaque','sort_order','created_at'],
  cupons:       ['id','tenant_id','code','type','value','min_order','uses_left','ativo','expires_at'],
  mesas:        ['id','tenant_id','num','status','guests','opened_at','total','pag_forma','updated_at'],
  garcons:      ['id','tenant_id','nome','usuario','senha','ativo'],
  orders:       ['id','tenant_id','client','phone','addr','items','total','taxa','pag','pag_momento','troco','time','status','mesa_num','garcom_id','garcom_nome','customer_id','order_num','created_at'],
  movimentos:   ['id','tenant_id','description','tipo','val','pag','time','created_at'],
  estoque:      ['id','tenant_id','name','qty','unit','min_qty','cost','updated_at'],
  fidelidade:   ['id','tenant_id','name','phone','birthday','pts','max_pts','orders_count','resgates','created_at'],
  customers:    ['id','tenant_id','name','phone','addr','orders_count','total_spent','last_order_at','email','birthday','senha_hash','cashback_saldo','created_at'],
  ratings:      ['id','tenant_id','order_id','client','phone','nota','comentario','created_at'],
  pagamentos_cartao: ['id','tenant_id','order_id','mp_payment_id','mp_external_ref','valor','status','status_detail','payer_name','payer_email','last_four_digits','payment_method_id','created_at','paid_at'],
}
// Colunas que NUNCA aparecem na resposta GET — mas ainda funcionam como filtro WHERE e em escrita
const STRIP_FROM_OUTPUT = {
  sys_users:    new Set(['senha_hash']),
  garcons:      new Set(['senha']),
  customers:    new Set(['senha_hash']),
  store_config: new Set([]),
}

const NO_TENANT_FILTER = new Set(['tenants','sys_users'])
const JSON_FIELDS = {
  orders:       new Set(['items']),
  menu_items:   new Set(['days','ingredients','custom_groups']),
  store_config: new Set(['delivery_fee_config','fid_config','evo_automacoes','sidebar_state','horarios_config','cashback_config','tipos_entrega']),
}
const BOOL_FIELDS  = new Set(['ativo','store_open','caixa_open','destaque'])
const SSE_TABLES   = new Set(['orders','mesas','store_config','menu_items','categories','garcons','customers'])

function jsonParse(v) { if(typeof v!=='string')return v; try{return JSON.parse(v)}catch{return v} }

function parseRow(table, row, opts={}) {
  if (!row) return row
  const out = { ...row }
  const jf  = JSON_FIELDS[table]
  if (jf) for (const f of jf) { if (f in out) out[f] = jsonParse(out[f]) }
  for (const f of BOOL_FIELDS) { if (f in out) out[f] = out[f] === 1 || out[f] === true }
  // Remove colunas sensíveis do output (a menos que seja chamada interna com {raw:true})
  if (!opts.raw) {
    const strip = STRIP_FROM_OUTPUT[table]
    if (strip) for (const f of strip) delete out[f]
  }
  return out
}

function sanitize(v) {
  if (v === undefined || v === null || v === '') return null
  if (v === true) return 1; if (v === false) return 0; return v
}

function serialize(table, body) {
  const out = { ...body }
  const jf  = JSON_FIELDS[table]
  if (jf) for (const f of jf) { if (f in out && typeof out[f] !== 'string') out[f] = JSON.stringify(out[f]) }
  return out
}

function buildWhere(params, cols, tenantId, table) {
  const conds = [], vals = [], colSet = new Set(cols)
  if (tenantId && !NO_TENANT_FILTER.has(table)) { conds.push('"tenant_id" = ?'); vals.push(tenantId) }
  for (const [key, val] of params.entries()) {
    if (['_single','select','order','limit','offset','_tenant'].includes(key)) continue
    if (!colSet.has(key) && key !== 'or') continue
    let m
    if (key === 'or') {
      const parts = val.replace(/^\(|\)$/g,'').split(','), orC = []
      for (const p of parts) { const pm=p.match(/^(\w+)\.(eq|neq)\.(.+)$/); if(pm&&colSet.has(pm[1])){orC.push(`"${pm[1]}" ${pm[2]==='eq'?'=':'!='} ?`);vals.push(pm[3])} }
      if (orC.length) conds.push(`(${orC.join(' OR ')})`); continue
    }
    if ((m=val.match(/^eq\.(.+)$/)))   { let v=m[1]==='null'?null:m[1]; if(v==='true')v=1;else if(v==='false')v=0;else if(v==='0')v=0;else if(v==='1')v=1; conds.push(`"${key}" = ?`);  vals.push(v); continue }
    if ((m=val.match(/^neq\.(.+)$/)))  { let v=m[1]; if(v==='true')v=1;else if(v==='false')v=0; conds.push(`"${key}" != ?`); vals.push(v); continue }
    if ((m=val.match(/^gte\.(.+)$/)))  { conds.push(`"${key}" >= ?`); vals.push(m[1]); continue }
    if ((m=val.match(/^lte\.(.+)$/)))  { conds.push(`"${key}" <= ?`); vals.push(m[1]); continue }
    if ((m=val.match(/^gt\.(.+)$/)))   { conds.push(`"${key}" > ?`);  vals.push(m[1]); continue }
    if ((m=val.match(/^lt\.(.+)$/)))   { conds.push(`"${key}" < ?`);  vals.push(m[1]); continue }
    if (val==='not.is.null') { conds.push(`"${key}" IS NOT NULL`); continue }
    if (val==='is.null')     { conds.push(`"${key}" IS NULL`);     continue }
    if ((m=val.match(/^in\.\((.+)\)$/))) { const items=m[1].split(',').map(s=>s.trim()); conds.push(`"${key}" IN (${items.map(()=>'?').join(',')})`); vals.push(...items); continue }
  }
  return { WHERE: conds.length ? `WHERE ${conds.join(' AND ')}` : '', vals }
}

function buildOrder(str, cols) {
  if (!str) return ''
  const colSet = new Set(cols)
  const parts  = str.split(',').map(p => { const[c,d]=p.trim().split('.'); return colSet.has(c)?`"${c}" ${d==='desc'?'DESC':'ASC'}`:null }).filter(Boolean)
  return parts.length ? `ORDER BY ${parts.join(', ')}` : ''
}

function getTenantId(req, params) { return req.headers['x-tenant-id'] || params.get('_tenant') || null }

async function handleREST(req, res, table, params, body) {
  const cols = TABLE_COLS[table]
  if (!cols) return send(res, 404, { error: 'Tabela não encontrada' })
  const tenantId        = getTenantId(req, params)
  const { WHERE, vals } = buildWhere(params, cols, tenantId, table)
  const isSingle        = req.headers['prefer']?.includes('single') || params.get('_single') === 'true'

  if (req.method === 'GET') {
    const ORDER  = buildOrder(params.get('order') || '', cols)
    const limit  = parseInt(params.get('limit') || '1000')
    const offset = parseInt(params.get('offset') || '0')
    const sel    = params.get('select')
    let selectCols = '*'
    if (sel) { const valid=sel.split(',').map(s=>s.trim().split(':')[0]).filter(c=>cols.includes(c)||c==='*'); if(valid.length) selectCols=valid.map(c=>c==='*'?'*':`"${c}"`).join(', ') }

    if (table === 'store_config' && tenantId) {
      try {
        let row = db.prepare('SELECT * FROM store_config WHERE tenant_id=?').get(tenantId)
        if (!row) { db.prepare('INSERT OR IGNORE INTO store_config (tenant_id) VALUES (?)').run(tenantId); row = db.prepare('SELECT * FROM store_config WHERE tenant_id=?').get(tenantId) }
        return send(res, 200, isSingle ? parseRow(table, row) : [parseRow(table, row)])
      } catch(e) { return send(res, 400, { error: e.message }) }
    }
    if (table === 'sys_users' && sel?.includes('tenants')) {
      const rows   = db.prepare(`SELECT u.*,t.nome as t_nome,t.plano as t_plano,t.ativo as t_ativo,t.expires_at as t_expires_at FROM sys_users u LEFT JOIN tenants t ON u.tenant_id=t.id ${WHERE} ${ORDER} LIMIT ? OFFSET ?`).all(...vals,limit,offset)
      const mapped = rows.map(r=>{const{t_nome,t_plano,t_ativo,t_expires_at,...u}=r;u.tenants={nome:t_nome,plano:t_plano,ativo:t_ativo===1,expires_at:t_expires_at};return parseRow(table,u)})
      return send(res, 200, isSingle ? (mapped[0]||null) : mapped)
    }
    if (table === 'tenants' && sel?.includes('sys_users')) {
      const rows   = db.prepare(`SELECT * FROM tenants ${WHERE} ${ORDER} LIMIT ? OFFSET ?`).all(...vals,limit,offset)
      const cntStmt = db.prepare('SELECT COUNT(*) as c FROM sys_users WHERE tenant_id=?')
      const mapped = rows.map(r=>{const c=cntStmt.get(r.id);r.sys_users=Array(c?.c||0).fill({});return parseRow(table,r)})
      return send(res, 200, isSingle ? (mapped[0]||null) : mapped)
    }
    try {
      if (isSingle) { const row=db.prepare(`SELECT ${selectCols} FROM "${table}" ${WHERE} ${ORDER} LIMIT 1`).get(...vals); return send(res,row?200:406,row?parseRow(table,row):{error:'Not found'}) }
      return send(res, 200, db.prepare(`SELECT ${selectCols} FROM "${table}" ${WHERE} ${ORDER} LIMIT ? OFFSET ?`).all(...vals,limit,offset).map(r=>parseRow(table,r)))
    } catch(e) { return send(res, 400, { error: e.message }) }
  }

  if (req.method === 'POST') {
    const isUpsert  = req.headers['prefer']?.includes('resolution=merge-duplicates')
    const returnRep = req.headers['prefer']?.includes('return=representation')
    try {
      const payload = serialize(table, body)
      if (tenantId && !NO_TENANT_FILTER.has(table) && !payload.tenant_id) payload.tenant_id = tenantId
      if (table === 'store_config') {
        const scTid = tenantId || payload.tenant_id
        if (!scTid) return send(res, 400, { error: 'tenant_id obrigatório' })
        payload.tenant_id = scTid
        const keys = Object.keys(payload).filter(k=>cols.includes(k))
        const setClause = keys.filter(k=>k!=='tenant_id').map(k=>`"${k}"=excluded."${k}"`).join(', ')
        db.prepare(`INSERT INTO store_config (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')}) ON CONFLICT(tenant_id) DO UPDATE SET ${setClause}`).run(...keys.map(k=>sanitize(payload[k])))
        const row = db.prepare('SELECT * FROM store_config WHERE tenant_id=?').get(scTid)
        marcarDirty(); return send(res, 200, parseRow(table, row))
      }
      const keys = Object.keys(payload).filter(k=>cols.includes(k))
      if (!keys.length) return send(res, 400, { error: 'Sem campos válidos' })
      let stmt
      if (isUpsert) {
        const upd = keys.filter(k=>k!=='id'&&k!=='tenant_id').map(k=>`"${k}"=excluded."${k}"`).join(', ')
        stmt = db.prepare(`INSERT INTO "${table}" (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')}) ON CONFLICT${table==='mesas'?'(tenant_id,num)':'(id)'} DO UPDATE SET ${upd}`)
      } else {
        stmt = db.prepare(`INSERT INTO "${table}" (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`)
      }
      const info = stmt.run(...keys.map(k=>sanitize(payload[k])))

      // ── Auto-assign order_num sequencial por tenant ─────────────────────
      if (table === 'orders' && info.lastInsertRowid) {
        const _tid = tenantId || payload.tenant_id
        if (_tid) {
          const _maxRow = db.prepare('SELECT COALESCE(MAX(order_num),0) as mx FROM orders WHERE tenant_id=?').get(_tid)
          const _nextNum = (_maxRow?.mx || 0) + 1
          db.prepare('UPDATE orders SET order_num=? WHERE rowid=?').run(_nextNum, info.lastInsertRowid)
        }
      }
      // ────────────────────────────────────────────────────────────────────

      const rawForEmit = db.prepare(`SELECT * FROM "${table}" WHERE rowid=?`).get(info.lastInsertRowid)
      const parsedForEmit = rawForEmit ? parseRow(table, rawForEmit) : null
      let inserted = null
      if (returnRep) {
        if (table==='sys_users'&&rawForEmit) { const t=db.prepare('SELECT nome,plano,ativo,expires_at FROM tenants WHERE id=?').get(rawForEmit.tenant_id); inserted=parseRow(table,{...rawForEmit,tenants:t?{nome:t.nome,plano:t.plano,ativo:t.ativo===1,expires_at:t.expires_at}:null}) }
        else inserted = parsedForEmit
      }
      if (SSE_TABLES.has(table)) emit(tenantId||payload.tenant_id, table, parsedForEmit||payload, 'INSERT')

      // ── Notificação WhatsApp para PIX manual ─────────────────────────────
      if (table === 'orders' && rawForEmit && rawForEmit.pag === 'pix_manual') {
        const _ord = rawForEmit
        const _tid = _ord.tenant_id
        setImmediate(async () => {
          try {
            const cfg    = db.prepare('SELECT evo_instance, evo_automacoes, ia_config, order_num_offset, store_name FROM store_config WHERE tenant_id=?').get(_tid)
            const inst   = cfg?.evo_instance || EVO_INST
            const auto   = (() => { try { return JSON.parse(cfg?.evo_automacoes||'{}') } catch { return {} } })()
            const ia     = (() => { try { return JSON.parse(cfg?.ia_config||'{}') } catch { return {} } })()
            const pixAuto = auto['pix_cobranca'] || {}
            if (pixAuto.on === false) { log('⏭️','Automação pix_cobranca desligada'); return }
            const offset  = parseInt(cfg?.order_num_offset) || 0
            const idStr   = String(_ord.order_num || Math.max(1, _ord.id - offset)).padStart(3,'0')
            const nome    = _ord.client || 'Cliente'
            const items   = (()=>{ try{ return (JSON.parse(_ord.items)||[]).map(i=>`${i.qty}x ${i.name}`).join(', ') }catch{ return '' } })()
            const total   = (parseFloat(_ord.total||0) + parseFloat(_ord.taxa||0)).toFixed(2).replace('.',',')
            const chavePix  = ia.pix_key_manual || ''
            const tipoChave = ia.pix_key_manual_tipo || 'aleatoria'
            if (!chavePix) { log('⚠️','PIX manual: chave não configurada para tenant', _tid); return }
            const lojaP   = cfg?.store_name || 'Restaurante'
            const _nomeP = nome.split(' ')[0]
            const _pixVars = [
              `🏪 *${lojaP}*\n${'-'.repeat(20)}\n\n💠 *PIX — Pedido #${idStr}*\n\nOi, *${_nomeP}*! 👋 Seu pedido chegou pra gente.\n\n*Itens:*\n${(items||'').split(', ').map(i=>'• '+i).join('\n')}\n\n💰 *Total: R$ ${total}*\n\nPague via PIX pra confirmar:\n🔑 *Tipo:* ${tipoChave}\n📋 *Chave:* ${chavePix}\n\nAssim que o pagamento cair, a gente começa a preparar! ✅\n\n_Dúvidas? É só chamar! 😊_`,
              `🏪 *${lojaP}*\n${'-'.repeat(20)}\n\n✅ *Pedido #${idStr} recebido!*\n\n*${_nomeP}*, que ótimo ter você por aqui! Seu pedido já está na nossa fila.\n\n*Itens:*\n${(items||'').split(', ').map(i=>'• '+i).join('\n')}\n\n💰 *Total: R$ ${total}*\n\nSó falta o pagamento via PIX:\n🔑 ${tipoChave}: *${chavePix}*\n\nApós confirmar, partimos pra produção! 🚀\n\n_Qualquer dúvida é só responder! 😄_`,
              `🏪 *${lojaP}*\n${'-'.repeat(20)}\n\n🎯 *Quase lá, ${_nomeP}!*\n\nRecebemos seu pedido *#${idStr}*. Agora é só pagar via PIX!\n\n*Itens:*\n${(items||'').split(', ').map(i=>'• '+i).join('\n')}\n\n💰 *Total: R$ ${total}*\n\n📋 Chave PIX (${tipoChave}): *${chavePix}*\n\nAssim que o pagamento for identificado, você receberá confirmação. 🤝\n\n_Dúvidas? Estamos aqui! 😊_`,
            ]
            const msgPadrao = _pixVars[Math.floor(Math.random() * _pixVars.length)]
            const msgFinal  = pixAuto.msg ? fillVars(pixAuto.msg, { nome, id: idStr, itens: items, total, chave_pix: chavePix, tipo_chave: tipoChave }) : msgPadrao
            const r = await sendWA(_ord.phone, msgFinal, inst)
            if (r.ok) log('📤', `PIX manual notificado → ${_ord.phone} pedido #${idStr}`)
            else       log('⚠️', `PIX manual falhou envio WA → ${_ord.phone}`)
          } catch(e) { log('❌','Erro notif PIX manual:', e.message) }
        })
      }
      // ─────────────────────────────────────────────────────────────────────

      marcarDirty(); return send(res, 201, returnRep ? inserted : { id: info.lastInsertRowid })
    } catch(e) { return send(res, 400, { error: e.message }) }
  }

  if (req.method === 'PATCH') {
    try {
      const payload = serialize(table, body)
      const keys    = Object.keys(payload).filter(k=>cols.includes(k))
      if (!keys.length) return send(res, 400, { error: 'Sem campos válidos' })
      if (table === 'store_config') {
        const pTid = tenantId || payload.tenant_id || vals[0] || null
        if (!pTid) return send(res, 400, { error: 'tenant_id obrigatório' })
        const upsertKeys = [...new Set([...keys,'tenant_id'])].filter(k=>cols.includes(k))
        if (!payload.tenant_id) payload.tenant_id = pTid
        const setClause = upsertKeys.filter(k=>k!=='tenant_id').map(k=>`"${k}"=excluded."${k}"`).join(', ')
        db.prepare(`INSERT INTO store_config (${upsertKeys.map(k=>`"${k}"`).join(',')}) VALUES (${upsertKeys.map(()=>'?').join(',')}) ON CONFLICT(tenant_id) DO UPDATE SET ${setClause}`).run(...upsertKeys.map(k=>sanitize(payload[k]??(k==='tenant_id'?pTid:null))))
        const row = db.prepare('SELECT * FROM store_config WHERE tenant_id=?').get(pTid)
        const parsed = parseRow(table, row); emit(pTid, table, parsed, 'UPDATE'); marcarDirty(); return send(res, 200, parsed)
      }
      // Coleta IDs antes do UPDATE para poder re-SELECT depois (o WHERE original pode não casar após o UPDATE)
      const _idsAntes = SSE_TABLES.has(table) && cols.includes('id')
        ? db.prepare(`SELECT "id" FROM "${table}" ${WHERE}`).all(...vals).map(r => r.id)
        : [];
      db.prepare(`UPDATE "${table}" SET ${keys.map(k=>`"${k}"=?`).join(', ')} ${WHERE}`).run(...keys.map(k=>sanitize(payload[k])),...vals)
      if (SSE_TABLES.has(table) && _idsAntes.length) {
        // Emite SSE para cada row atualizada com dados completos
        for (const _rid of _idsAntes) {
          const updatedRow = db.prepare(`SELECT * FROM "${table}" WHERE "id"=?`).get(_rid);
          if (updatedRow) emit(tenantId||payload.tenant_id, table, parseRow(table, updatedRow), 'UPDATE');
        }
      } else if (SSE_TABLES.has(table)) {
        // Fallback: tenta re-SELECT com WHERE original
        const updatedRow = db.prepare(`SELECT * FROM "${table}" ${WHERE} LIMIT 1`).get(...vals);
        emit(tenantId||payload.tenant_id, table, updatedRow?parseRow(table,updatedRow):payload, 'UPDATE');
      }

      marcarDirty(); return send(res, 200, { updated: 1 })
    } catch(e) { return send(res, 400, { error: e.message }) }
  }

  if (req.method === 'DELETE') {
    if (!WHERE) return send(res, 400, { error: 'DELETE sem filtro não permitido' })
    try {
      const info = db.prepare(`DELETE FROM "${table}" ${WHERE}`).run(...vals)
      if (SSE_TABLES.has(table)) emit(tenantId, table, {}, 'DELETE')
      marcarDirty(); return send(res, 200, { deleted: info.changes })
    } catch(e) { return send(res, 400, { error: e.message }) }
  }
}

function handleTenantInfo(params) {
  const slug=params.get('slug'), id=params.get('id'), useDefault=params.get('default')
  if (!slug&&!id&&!useDefault) return { error: 'Informe slug ou id' }
  const t = slug ? db.prepare('SELECT id,nome,slug FROM tenants WHERE slug=? AND ativo=1').get(slug)
    : id ? db.prepare('SELECT id,nome,slug FROM tenants WHERE id=? AND ativo=1').get(id)
    : db.prepare('SELECT id,nome,slug FROM tenants WHERE ativo=1 ORDER BY id ASC LIMIT 1').get()
  if (!t) return { error: 'Restaurante não encontrado' }
  const cfg = db.prepare('SELECT store_name,store_descricao,store_logo_url,store_banner_url,store_cor,store_cor_texto,store_tema,cats_carrossel,store_tempo_entrega,store_avaliacao,store_whatsapp FROM store_config WHERE tenant_id=?').get(t.id)
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
        const buffer   = Buffer.concat(chunks)
        const ct       = req.headers['content-type'] || ''
        const boundary = ct.split('boundary=')[1]
        const urlBase  = path.basename((req.url||'').split('?')[0])
        const hasExt   = /\.(jpg|jpeg|png|webp|gif)$/i.test(urlBase)
        let fname      = hasExt ? urlBase : `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
        if (!boundary) {
          const body = JSON.parse(buffer.toString()), ext=(body.mime||'image/jpeg').split('/')[1]||'jpg'
          if (!hasExt) fname = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
          fs.writeFileSync(path.join(UPLOADS_DIR, fname), Buffer.from(body.data,'base64'))
        } else {
          const raw   = buffer.toString('binary')
          const parts = raw.split('--'+boundary).filter(p=>p.includes('filename='))
          if (parts.length) {
            const [head,...bodyParts] = parts[0].split('\r\n\r\n')
            const fnMatch = head.match(/filename="([^"]+)"/)
            if (!hasExt&&fnMatch) { const ext=path.extname(fnMatch[1])||'.jpg'; fname=`${Date.now()}-${Math.random().toString(36).slice(2)}${ext}` }
            fs.writeFileSync(path.join(UPLOADS_DIR, fname), Buffer.from(bodyParts.join('\r\n\r\n').replace(/\r\n$/,''),'binary'))
          } else { fs.writeFileSync(path.join(UPLOADS_DIR, fname), buffer) }
        }
        log('📸', `Upload: ${fname}`)
        const url = `/uploads/${fname}`
        resolve(send(res, 200, { url, publicUrl: url }))
      } catch(e) { log('❌','Upload error:',{error:e.message}); resolve(send(res, 400, { error: e.message })) }
    })
  })
}

// ════════════════════════════════════════════════════════
// WHATSAPP
// ════════════════════════════════════════════════════════
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function fillVars(tpl, vars) { let t=tpl; for(const[k,v]of Object.entries(vars))t=t.replaceAll(`{${k}}`,v??''); return t }

async function sendWA(phone, text, inst) {
  const instance = inst || EVO_INST
  const num      = phone.replace(/\D/g,'')
  const number   = num.startsWith('55') ? num : `55${num}`
  const headers  = { 'Content-Type':'application/json', apikey: EVO_KEY }
  const body     = { number, text, options: { delay:1000, presence:'composing' } }
  try {
    const r = await fetch(`${EVO_URL}/message/sendText/${instance}`, { method:'POST', headers, body:JSON.stringify(body) })
    const data = await r.json().catch(()=>({}))
    log('📬', `sendWA [${r.status}]:`, JSON.stringify(data).slice(0,200))
    if (r.ok) { log('📤',`Enviado para ${number}`); return { ok:true, data } }
    const r2   = await fetch(`${EVO_URL}/message/sendText/${instance}`, { method:'POST', headers, body:JSON.stringify({number,text}) })
    const data2 = await r2.json().catch(()=>({}))
    if (r2.ok) { log('📤',`Enviado para ${number} (retry)`); return { ok:true, data:data2 } }
    return { ok:false, data:data2 }
  } catch(e) { log('❌','Erro WA:',{error:e.message}); return { ok:false, error:e.message } }
}

const _anivLast = new Map()
async function checarAniv() {
  const tenants = db.prepare("SELECT id FROM tenants WHERE ativo=1").all()
  for (const t of tenants) {
    try {
      const cfg  = db.prepare("SELECT evo_automacoes,evo_aniv_last,evo_instance FROM store_config WHERE tenant_id=?").get(t.id)
      if (!cfg) continue
      const auto = jsonParse(cfg.evo_automacoes)||{}, ca=auto['aniversario']||{}
      if (ca.on===false) continue
      const now   = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Fortaleza'}))
      const today = `${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
      const hora  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
      if (_anivLast.get(t.id)===today||cfg.evo_aniv_last===today) continue
      if (hora<(auto._aniv_hora||'09:00')) continue
      _anivLast.set(t.id, today)
      const deF  = db.prepare("SELECT name,phone FROM fidelidade WHERE tenant_id=? AND birthday IS NOT NULL AND phone IS NOT NULL").all(t.id).filter(c=>c.birthday?.slice(5)===today)
      const deC  = db.prepare("SELECT name,phone FROM customers WHERE tenant_id=? AND birthday IS NOT NULL AND phone IS NOT NULL").all(t.id).filter(c=>c.birthday?.slice(5)===today)
      const seen = new Set(deF.map(c=>c.phone))
      const anivs = [...deF,...deC.filter(c=>!seen.has(c.phone))]
      if (!anivs.length) { db.prepare("UPDATE store_config SET evo_aniv_last=? WHERE tenant_id=?").run(today,t.id); continue }
      const inst = cfg.evo_instance||EVO_INST
      for (const c of anivs) { await sendWA(c.phone, fillVars(ca.msg,{nome:c.name}), inst); await sleep(1500) }
      db.prepare("UPDATE store_config SET evo_aniv_last=? WHERE tenant_id=?").run(today,t.id)
      log('🎂',`Aniversários tenant ${t.id}: ${anivs.length} enviados`)
    } catch(e) { log('❌',`Erro aniv ${t.id}:`,{error:e.message}) }
  }
}

const processed = new Set()
setInterval(() => { if (processed.size > 5000) processed.clear() }, 60 * 60 * 1000)
async function handleOrderStatus(req, res) {
  const body = await readBody(req)
  const { order_id, new_status } = body
  const tid = body.tenant_id || req.headers['x-tenant-id']
  if (!order_id||!new_status||!tid) return send(res,400,{ok:false,error:'order_id, new_status e tenant_id obrigatórios'})
  try {
    const order = db.prepare("SELECT * FROM orders WHERE id=? AND tenant_id=?").get(order_id,tid)
    if (!order) return send(res,404,{ok:false,error:'Pedido não encontrado'})
    const oldStatus = order.status
    db.prepare("UPDATE orders SET status=? WHERE id=?").run(new_status,order_id)
    const updated = db.prepare("SELECT * FROM orders WHERE id=?").get(order_id)
    emit(tid,'orders',parseRow('orders',updated),'UPDATE')
    send(res,200,{ok:true,order:parseRow('orders',updated)})

    // ── PIX manual confirmado pelo gestor ─────────────────────────────────
    if (new_status === 'analise' && oldStatus === 'aguardando_pix' && order.pag === 'pix_manual') {
      setImmediate(async () => {
        try {
          const cfg    = db.prepare('SELECT evo_instance, evo_automacoes, order_num_offset, store_name FROM store_config WHERE tenant_id=?').get(tid)
          const inst   = cfg?.evo_instance || EVO_INST
          const auto   = (() => { try { return JSON.parse(cfg?.evo_automacoes||'{}') } catch { return {} } })()
          const pixConf = auto['pix_confirmado'] || {}
          if (pixConf.on === false) { log('⏭️','Automação pix_confirmado desligada'); return }
          const offset = parseInt(cfg?.order_num_offset) || 0
          const idStr  = String(order.order_num || Math.max(1, order.id - offset)).padStart(3,'0')
          const nome   = order.client || 'Cliente'
          const items  = (()=>{ try{ return (JSON.parse(order.items)||[]).map(i=>`${i.qty}x ${i.name}`).join(', ') }catch{ return '' } })()
          const total  = (parseFloat(order.total||0)+parseFloat(order.taxa||0)).toFixed(2).replace('.',',')
          const lojaC = cfg?.store_name || 'Restaurante'
          const _nomePOk = nome.split(' ')[0]
              const _pixOkVars = [
                `🏪 *${lojaC}*\n${'-'.repeat(20)}\n\n✅ *PIX confirmado, ${_nomePOk}!*\n\nRecebemos seu pagamento do pedido *#${idStr}*! 🎉\n\n*Itens:*\n${(items||'').split(', ').map(i=>'• '+i).join('\n')}\n\n💰 *Total: R$ ${total}*\n\n🍳 Já estamos preparando tudo com muito carinho!\n\n_Dúvidas? Estamos aqui! 😊_`,
                `🏪 *${lojaC}*\n${'-'.repeat(20)}\n\n💚 *Pagamento recebido!*\n\nOi, *${_nomePOk}*! Seu PIX do pedido *#${idStr}* chegou certinho. Obrigado! 🙏\n\n*Itens:*\n${(items||'').split(', ').map(i=>'• '+i).join('\n')}\n\n💰 *Total: R$ ${total}*\n\n👨‍🍳 A equipe já colocou a mão na massa!\n\n_Qualquer dúvida é só chamar! 😄_`,
                `🏪 *${lojaC}*\n${'-'.repeat(20)}\n\n🚀 *Bora, ${_nomePOk}!*\n\nPagamento do pedido *#${idStr}* confirmado com sucesso! ✅\n\n*Itens:*\n${(items||'').split(', ').map(i=>'• '+i).join('\n')}\n\n💰 *Total: R$ ${total}*\n\n🔥 Seu pedido já entrou em produção. Em breve te avisamos quando estiver pronto!\n\n_Dúvidas? Responde aqui! 😊_`,
              ]
              const msgPad = _pixOkVars[Math.floor(Math.random() * _pixOkVars.length)]
          const msgFin = pixConf.msg ? fillVars(pixConf.msg, { nome, id: idStr, itens: items, total }) : msgPad
          const r = await sendWA(order.phone, msgFin, inst)
          if (r.ok) log('📤', `PIX manual confirmado notificado → ${order.phone} #${idStr}`)
        } catch(e) { log('❌','Erro notif pix_confirmado manual:', e.message) }
      })
    }
    // ─────────────────────────────────────────────────────────────────────

    // ── Cashback automático ─────────────────────────────
    if (['finalizado','entregue'].includes(new_status) && !['finalizado','entregue'].includes(oldStatus)) {
      try {
        const cfg    = db.prepare('SELECT cashback_config, evo_automacoes, evo_instance, fid_config FROM store_config WHERE tenant_id=?').get(tid)
        const inst   = cfg?.evo_instance || EVO_INST
        const auto   = (() => { try { return JSON.parse(cfg?.evo_automacoes||'{}') } catch { return {} } })()

        // ── Cashback ────────────────────────────────────
        const cbCfg  = (() => { try { return JSON.parse(cfg?.cashback_config||'{}') } catch { return {} } })()
        if (cbCfg.ativo && cbCfg.pct > 0 && order.phone) {
          const total  = parseFloat(order.total||0)
          const minPed = parseFloat(cbCfg.min_pedido||0)
          if (total >= minPed) {
            const credito = parseFloat((total * cbCfg.pct / 100).toFixed(2))
            const phone8  = order.phone.replace(/\D/g,'').slice(-8)
            const cust    = db.prepare('SELECT id, cashback_saldo FROM customers WHERE tenant_id=? AND phone LIKE ?').get(tid, `%${phone8}%`)
            if (cust) {
              db.prepare('UPDATE customers SET cashback_saldo=cashback_saldo+? WHERE id=?').run(credito, cust.id)
              const novoSaldo = parseFloat(((cust.cashback_saldo||0) + credito).toFixed(2))
              // WA cashback
              const cbAuto = auto['cashback'] || {}
              if (cbAuto.on !== false) {
                const lojaB   = cfg?.store_name || 'Restaurante'
                const msgPadrao = `🏪 *${lojaB}*\n${'-'.repeat(20)}\n\n💰 *Cashback creditado!*\n\nOlá, *${nome}*! Você ganhou *R$ ${credito.toFixed(2).replace('.',',')}* de cashback.\n\n💳 Saldo atual: *R$ ${novoSaldo.toFixed(2).replace('.',',')}*\n\nUse no seu próximo pedido! 🛍️\n\n_Dúvidas? É só responder esta mensagem!_ 😊`
                const msgFinal  = cbAuto.on && cbAuto.msg ? fillVars(cbAuto.msg, { nome, credito: credito.toFixed(2).replace('.',','), saldo: novoSaldo.toFixed(2).replace('.',',') }) : msgPadrao
                setImmediate(async () => { try { await sendWA(order.phone, msgFinal, inst) } catch(e) {} })
              }
            } else {
              db.prepare('INSERT OR IGNORE INTO customers (tenant_id,name,phone,cashback_saldo) VALUES (?,?,?,?)').run(tid, order.client||order.phone, order.phone, credito)
              const cbAuto = auto['cashback'] || {}
              if (cbAuto.on !== false) {
                const lojaB2  = cfg?.store_name || 'Restaurante'
                const msgPadrao = `💰 *${nome}*, você ganhou *R$ ${credito.toFixed(2).replace('.',',')}* de cashback com seu pedido!\n\nSeu saldo total: *R$ ${credito.toFixed(2).replace('.',',')}*\nUse no seu próximo pedido! 🛍️`
                const msgFinal  = cbAuto.on && cbAuto.msg ? fillVars(cbAuto.msg, { nome, credito: credito.toFixed(2).replace('.',','), saldo: credito.toFixed(2).replace('.',',') }) : msgPadrao
                setImmediate(async () => { try { await sendWA(order.phone, msgFinal, inst) } catch(e) {} })
              }
            }
            marcarDirty()
            log('💰', `Cashback R$${credito} creditado → ${order.phone} (pedido #${order_id})`)
          }
        }

        // ── Fidelidade pontos ────────────────────────────
        const fidCfg  = (() => { try { return JSON.parse(cfg?.fid_config||'{}') } catch { return {} } })()
        const ptsPorReal = parseFloat(fidCfg.pts_por_real || 10)
        if (ptsPorReal > 0 && order.phone) {
          const phone8 = order.phone.replace(/\D/g,'').slice(-8)
          const fid    = db.prepare('SELECT id, pts, max_pts, name FROM fidelidade WHERE tenant_id=? AND phone LIKE ?').get(tid, `%${phone8}%`)
          if (fid) {
            const totalVal  = parseFloat(order.total||0) + parseFloat(order.taxa||0)
            const ptosGanhos = Math.floor(totalVal * ptsPorReal)
            if (ptosGanhos > 0) {
              const novosPts = (fid.pts || 0) + ptosGanhos
              const meta     = fid.max_pts || 500
              db.prepare('UPDATE fidelidade SET pts=?, orders_count=orders_count+1 WHERE id=?').run(novosPts, fid.id)
              log('⭐', `Fidelidade +${ptosGanhos} pts → ${order.phone} (pedido #${order_id})`)
              // WA pontos
              const ptAuto = auto['pontos'] || {}
              if (ptAuto.on !== false) {
                const lojaP2  = cfg?.store_name || 'Restaurante'
                const faltam     = Math.max(0, meta - novosPts)
                const msgPadrao  = `🏪 *${lojaP2}*\n${'-'.repeat(20)}\n\n🏆 *Pontos de fidelidade!*\n\nOlá, *${nome}*! Você ganhou *${ptosGanhos} pontos* com seu pedido.\n\n🎯 Saldo atual: *${novosPts} pontos*\n${faltam > 0 ? `⏳ Faltam apenas *${faltam} pontos* para sua recompensa!` : '🎁 Você atingiu sua recompensa! Resgate no próximo pedido.'}\n\n_Dúvidas? É só responder esta mensagem!_ 😊`
                const msgFinal   = ptAuto.on && ptAuto.msg ? fillVars(ptAuto.msg, { nome, pontos_ganhos: String(ptosGanhos), pontos_total: String(novosPts), pontos_faltam: String(faltam) }) : msgPadrao
                setImmediate(async () => { try { await sendWA(order.phone, msgFinal, inst) } catch(e) {} })
              }
            }
          }
        }
      } catch(cbErr) { log('⚠️', 'Cashback/Fidelidade erro:', cbErr.message) }
    }
    if (order.phone&&oldStatus!==new_status) {
      setImmediate(async () => {
        try {
          const cfg   = db.prepare("SELECT evo_instance,evo_automacoes,store_name,order_num_offset FROM store_config WHERE tenant_id=?").get(tid)
          const _tnt  = db.prepare("SELECT segmento FROM tenants WHERE id=?").get(tid)
          const _seg  = _tnt?.segmento || 'restaurante'
          const inst  = cfg?.evo_instance||EVO_INST
          const auto  = jsonParse(cfg?.evo_automacoes)||{}
          const offset= parseInt(cfg?.order_num_offset)||0
          const loja  = cfg?.store_name || (_seg==='acougue' ? 'Açougue' : 'Restaurante')
          const nome  = order.client||'Cliente', idStr=String(order.order_num||Math.max(1,order.id-offset)).padStart(3,'0')
          const items = (()=>{try{return(JSON.parse(order.items)||[]).map(i=>`• ${i.qty}x ${i.name}`).join('\n')}catch{return ''}})()
          const isDelivery = (order.addr||'').includes('Mesa')?'🪴 Mesa':(order.addr||'').toLowerCase().includes('balc')?'🏪 Balcão':'🛵 Entrega'
          const total = (parseFloat(order.total||0)+parseFloat(order.taxa||0)).toFixed(2).replace('.',',')
          const vars  = {nome,id:idStr,itens:items,total,endereco:order.addr||'',mesa:String(order.mesa_num||''),tipo_entrega:isDelivery,loja}
          const tipoAuto = {analise:'recebido',producao:'confirmado',pronto:'pronto',saiu:'entrega',entregue:'entrega',cancelado:'cancelado',finalizado:'avaliacao'}[new_status]
          const ct = tipoAuto?(auto[tipoAuto]||{}):{} 
          // Emoji da loja por segmento
          const _lojaEmoji = _seg === 'acougue' ? '🥩' : '🍽️'
          const cab = `${_lojaEmoji} *${loja}*\n${'-'.repeat(20)}`
          const rod = '\n\n_Dúvidas? É só responder esta mensagem!_ 😊'
          // Emojis de comida por segmento
          const _emojisComida = _seg === 'acougue'
            ? ['🥩','🔪','⚖️','🍖','🥓']
            : ['🍽️','👨‍🍳','🔥','⚡','✨']
          const _ec = () => _emojisComida[Math.floor(Math.random() * _emojisComida.length)]
          // Variações humanizadas — escolhe uma aleatoriamente
          const _v = arr => arr[Math.floor(Math.random() * arr.length)]
          const _primeiroNome = nome.split(' ')[0]
          const _tipoLocal = isDelivery==='🛵 Entrega'
            ? '🛵 Seu pedido sairá para entrega em breve!'
            : isDelivery==='🪴 Mesa'
            ? '🪴 Pode ficar à vontade, logo trazemos até você!'
            : '🏪 Pode retirar no balcão quando quiser!'
          const msgPadrao = {
            analise: _v([
              `${cab}\n\n📥 *Pedido #${idStr} recebido!*\n\nOi, *${_primeiroNome}*! 👋 Recebemos seu pedido e já estamos verificando.\n\n*Itens:*\n${items}\n\n💰 *Total: R$ ${total}*\n\n⏱️ Em breve confirmaremos por aqui!${rod}`,
              `${cab}\n\n✅ *Chegou, ${_primeiroNome}!*\n\nSeu pedido *#${idStr}* entrou na nossa fila. Obrigado por escolher a gente! 🙌\n\n*Itens:*\n${items}\n\n💰 *Total: R$ ${total}*\n\nVou te avisar assim que confirmarmos!${rod}`,
              `${cab}\n\n🎯 *Pedido #${idStr} anotado!*\n\n*${_primeiroNome}*, que ótimo ter você aqui! Recebemos seu pedido certinho.\n\n*Itens:*\n${items}\n\n💰 *Total: R$ ${total}*\n\n⏳ Aguarda só um instante que confirmamos logo!${rod}`,
            ]),
            producao: _v([
              `${cab}\n\n${_ec()} *Mãos à obra, ${_primeiroNome}!*\n\nSeu pedido *#${idStr}* foi confirmado e já está sendo preparado com muito carinho! ❤️\n\n*Itens:*\n${items}\n\n💰 *Total: R$ ${total}*\n\n${_tipoLocal}${rod}`,
              `${cab}\n\n${_ec()} *Pedido #${idStr} confirmado!*\n\nOi, *${_primeiroNome}*! Nossa equipe já começou a preparar tudo pra você.\n\n*Itens:*\n${items}\n\n💰 *Total: R$ ${total}*\n\n${_tipoLocal}${rod}`,
              `${cab}\n\n✅ *Confirmado, ${_primeiroNome}!*\n\nPedido *#${idStr}* na produção agora. A gente capricha pra você! ${_ec()}\n\n*Itens:*\n${items}\n\n💰 *Total: R$ ${total}*${rod}`,
            ]),
            pronto: _v([
              `${cab}\n\n${_ec()} *Ficou incrível, ${_primeiroNome}!*\n\nSeu pedido *#${idStr}* está prontinho! ✅\n\n${_tipoLocal}${rod}`,
              `${cab}\n\n🎉 *Pedido #${idStr} pronto!*\n\n*${_primeiroNome}*, ficou ótimo e está te esperando! ${_ec()}\n\n${_tipoLocal}${rod}`,
              `${cab}\n\n${_ec()} *Tá na hora, ${_primeiroNome}!*\n\nSeu pedido *#${idStr}* foi preparado com capricho e está pronto!\n\n${_tipoLocal}${rod}`,
            ]),
            saiu: _v([
              `${cab}\n\n🛵 *Pedido #${idStr} a caminho!*\n\n*${_primeiroNome}*, seu pedido saiu agora e logo chega aí! 🚀\n\n📍 *Endereço:* ${order.addr||''}\n\nFique de olho, hein! 😉${rod}`,
              `${cab}\n\n🛵 *Saiu, ${_primeiroNome}!*\n\nSeu pedido *#${idStr}* está na estrada. Chegaremos em breve!\n\n📍 *Destino:* ${order.addr||''}${rod}`,
              `${cab}\n\n🏃 *A caminho, ${_primeiroNome}!*\n\nPedido *#${idStr}* saiu pra entrega. O nosso entregador está indo até você agora! 🛵\n\n📍 ${order.addr||''}${rod}`,
            ]),
            entregue: _v([
              `${cab}\n\n😊 *${_primeiroNome}, muito obrigado pela preferência!*\n\nFoi um prazer atender você no pedido *#${idStr}*. Esperamos que tudo esteja do jeitinho que você gosta! ❤️\n\nVolte sempre, viu? Estamos aqui pra você! 🤗${rod}`,
              `${cab}\n\n🙏 *Obrigado por escolher a gente, ${_primeiroNome}!*\n\nSeu pedido *#${idStr}* foi entregue com todo o carinho. Nada melhor do que saber que você confia no nosso trabalho! 💛\n\nQualquer coisa, pode contar com a gente. Volte sempre! 😊${rod}`,
              `${cab}\n\n❤️ *${_primeiroNome}, que bom ter você como cliente!*\n\nPedido *#${idStr}* entregue! Preparamos tudo com muito cuidado especialmente pra você. 😊\n\nA gente fica feliz demais com a sua confiança. Até a próxima! 🤝${rod}`,
            ]),
            cancelado: _v([
              `${cab}\n\n😔 *Pedido #${idStr} cancelado*\n\n*${_primeiroNome}*, sentimos muito pelo inconveniente. Infelizmente seu pedido precisou ser cancelado.\n\nEstamos à disposição se quiser fazer um novo pedido ou esclarecer qualquer dúvida.${rod}`,
              `${cab}\n\n⚠️ *Aviso sobre o pedido #${idStr}*\n\nOi, *${_primeiroNome}*. Lamentamos informar que seu pedido foi cancelado.\n\nQualquer dúvida, é só responder aqui — vamos resolver juntos! 🤝${rod}`,
            ]),
            finalizado: _v([
              `${cab}\n\n🎉 *Obrigado, ${_primeiroNome}!*\n\nSeu pedido *#${idStr}* foi finalizado. Foi um prazer te atender!\n\n⭐ Que tal nos avaliar? Leva só 5 segundos e nos ajuda muito!${rod}`,
              `${cab}\n\n🙏 *Até a próxima, ${_primeiroNome}!*\n\nPedido *#${idStr}* concluído. Obrigado por escolher a ${loja}!\n\n⭐ Adoraríamos saber sua opinião. Pode falar!${rod}`,
              `${cab}\n\n✨ *Missão cumprida, ${_primeiroNome}!*\n\nPedido *#${idStr}* finalizado com sucesso. Esperamos que tenha gostado! 😊\n\n⭐ Sua avaliação é muito importante para continuarmos melhorando!${rod}`,
            ]),
          }
          let msgFinal = null
          if (ct.on===false) { log('⏭️',`Automação "${tipoAuto}" desligada`) }
          else if (ct.on&&ct.msg) { msgFinal=fillVars(ct.msg,vars) }
          else { msgFinal=msgPadrao[new_status]||null }
          if (msgFinal) {
            const _pkey = `${order.id}_${new_status}`
            if (new_status==='finalizado') {
              const min=Math.max(1,parseInt(auto._aval_minutos||1,10)||1)
              log('⏳',`Avaliação agendada em ${min}min para #${idStr}`)
              setTimeout(async()=>{ if(processed.has(_pkey))return; const cfgNow=db.prepare("SELECT evo_automacoes FROM store_config WHERE tenant_id=?").get(tid); if(jsonParse(cfgNow?.evo_automacoes)||{}['avaliacao']?.on===false)return; const r=await sendWA(order.phone,msgFinal,inst); if(r.ok)processed.add(_pkey) },min*60*1000)
            } else { if(!processed.has(_pkey)){ const r=await sendWA(order.phone,msgFinal,inst); if(r.ok)processed.add(_pkey) } }
          }
        } catch(e) { log('❌',`Erro WA order-status #${order_id}:`,{error:e.message}) }
      })
    }
  } catch(e) { log('❌','Erro order-status:',{error:e.message}); send(res,500,{ok:false,error:e.message}) }
}

// ════════════════════════════════════════════════════════
// AGENTE IA
// ════════════════════════════════════════════════════════
const _msgBuffer   = new Map()
const _pausaHumano = new Map()
const _lastDayMsg  = new Map() // rastreia primeira msg do dia: "tenant:phone" → "YYYY-MM-DD"

async function handleIAWebhook(req, res) {
  const body = req._parsedBody !== undefined ? req._parsedBody : await readBody(req)
  const upath = new URL(req.url,`http://x`).pathname
  let tenantId = null
  if (upath.startsWith('/webhook/whatsapp')) tenantId = upath.split('/')[3]||null
  else { const slug=upath.split('/')[2]||null; if(slug){const row=db.prepare("SELECT id FROM tenants WHERE slug=? OR id=?").get(slug,slug);tenantId=row?.id||null} }
  tenantId = tenantId||req.headers['x-tenant-id']||null
  try {
    const msg    = body?.data?.message?.conversation||body?.data?.message?.extendedTextMessage?.text||''
    const from   = body?.data?.key?.remoteJid||''
    const fromMe = body?.data?.key?.fromMe||false
    // Se mensagem foi enviada pelo próprio gestor via WhatsApp, registra pausa da IA
    if (fromMe && from && tenantId) {
      const phone = from.replace('@s.whatsapp.net','').replace('@c.us','')
      if (phone) {
        const cfg2   = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id=?").get(tenantId)
        const ia2    = jsonParse(cfg2?.ia_config)||{}
        const cfgG2  = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
        const iaG2   = jsonParse(cfgG2?.ia_config)||{}
        if (ia2.ativo) {
          const pausaKey2 = `pausa:${tenantId}:${phone}`
          _pausaHumano.set(pausaKey2, Date.now())
          log('👤', `[PAUSA] Gestor enviou via WA — IA pausada para ${phone} [${tenantId}]`)
        }
      }
      send(res,200,{ok:true}); return
    }
    if (!msg||!from) { send(res,200,{ok:true}); return }
    const phone = from.replace('@s.whatsapp.net','').replace('@c.us','')
    if (!tenantId) { send(res,200,{ok:true}); return }
    const cfg = db.prepare("SELECT ia_config,evo_instance,store_name,store_descricao,store_whatsapp,store_tempo_entrega,delivery_fee_config,horarios_config,store_open FROM store_config WHERE tenant_id=?").get(tenantId)
    if (!cfg) { send(res,200,{ok:true}); return }
    const ia = jsonParse(cfg.ia_config)||{}
    if (!ia.ativo) { send(res,200,{ok:true}); return }
    const cfgGlobal = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
    const iaG = jsonParse(cfgGlobal?.ia_config)||{}
    const openaiKey = ia.openai_key || iaG.openai_key || ''
    if (!openaiKey) { send(res,200,{ok:true}); return }
    const modelo=iaG.modelo||'gpt-4o-mini', maxTokens=iaG.max_tokens||800, bufferSeg=iaG.buffer_seg||3, quebraLen=iaG.quebra_linha||0, pausaMin=iaG.pausa_min||30
    const pausaKey=`pausa:${tenantId}:${phone}`, pausaAt=_pausaHumano.get(pausaKey)
    log('🔍', `[PAUSA-DEBUG] Webhook — from JID: "${from}" → phone extraído: "${phone}" | tenantId: "${tenantId}"`)
    log('🔍', `[PAUSA-DEBUG] Webhook — pausaKey verificada: "${pausaKey}"`)
    log('🔍', `[PAUSA-DEBUG] Webhook — pausaAt encontrado: ${pausaAt || 'NÃO ENCONTRADO'} | pausaMin config: ${pausaMin}min`)
    log('🔍', `[PAUSA-DEBUG] Webhook — chaves ativas no _pausaHumano: [${[..._pausaHumano.keys()].join(', ')||'nenhuma'}]`)
    if (pausaAt&&(Date.now()-pausaAt)<pausaMin*60*1000) { log('🔇',`IA bloqueada (humano ativo) — ${phone} [${tenantId}]`); send(res,200,{ok:true}); return }
    const histKey=`conv:${tenantId}:${phone}:hist`
    if (!_msgBuffer.has(histKey)) _msgBuffer.set(histKey,[])
    const convHist = _msgBuffer.get(histKey)
    const bufKey=`buf:${tenantId}:${phone}`
    if (_msgBuffer.has(bufKey)) clearTimeout(_msgBuffer.get(bufKey).timer)
    const msgs=_msgBuffer.has(bufKey)?_msgBuffer.get(bufKey).msgs:[]
    msgs.push(msg)
    const timer = setTimeout(async () => {
      _msgBuffer.delete(bufKey)
      const pausaNow=_pausaHumano.get(pausaKey)
      if (pausaNow&&(Date.now()-pausaNow)<pausaMin*60*1000) { log('🔇',`IA bloqueada no timer (humano assumiu durante buffer) — ${phone} [${tenantId}]`); return }
      log('🔍', `[PAUSA-DEBUG] Timer — pausaKey: "${pausaKey}" | pausaNow: ${pausaNow || 'NÃO ENCONTRADO'} — IA vai responder`)
      const msgFull=msgs.join('\n'), inst=cfg.evo_instance||EVO_INST, nomeLoja=cfg.store_name||'Restaurante'
      // ── Detecção: primeira msg do dia e saudação avulsa ──
      const _hoje = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Fortaleza'})).toISOString().split('T')[0]
      const _dayKey = `${tenantId}:${phone}`
      const _isPrimeiraMsgDia = _lastDayMsg.get(_dayKey) !== _hoje
      _lastDayMsg.set(_dayKey, _hoje)
      const _saudacaoRegex = /^\s*(oi|olá|ola|hey|hi|hello|bom\s*dia|boa\s*(tarde|noite)|e\s*a[ií]|eai|opa|salve|fala|alo|alô|tudo\s*bem|td\s*bem|blz|beleza)\s*[!.,?☺😊🙂👋🤗]*\s*$/i
      const _isSoSaudacao = _saudacaoRegex.test(msgFull.trim())
      const _horaAtual = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Fortaleza'})).getHours()
      const _saudacaoHora = _horaAtual >= 5 && _horaAtual < 12 ? 'Bom dia' : _horaAtual >= 12 && _horaAtual < 18 ? 'Boa tarde' : 'Boa noite'
      const contexto=[]
      const tenantRow=db.prepare("SELECT slug FROM tenants WHERE id=?").get(tenantId)
      const proto=req.headers['x-forwarded-proto']||'https', host=req.headers['host']||''
      const linkCardapio=`${proto}://${host}/index.html?slug=${tenantRow?.slug||tenantId}`
      const agora=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Fortaleza'})), diasSemana=['dom','seg','ter','qua','qui','sex','sab'], diaHoje=diasSemana[agora.getDay()], horaMin=agora.getHours()*60+agora.getMinutes()
      let lojaAbertaAgora=cfg.store_open!==false
      const horariosCfg=jsonParse(cfg.horarios_config)||{}, diaConfig=horariosCfg[diaHoje]
      if (diaConfig) { if(!diaConfig.ativo)lojaAbertaAgora=false; else{const[ah,am]=(diaConfig.abertura||'00:00').split(':').map(Number);const[fh,fm]=(diaConfig.fechamento||'23:59').split(':').map(Number);lojaAbertaAgora=horaMin>=ah*60+am&&horaMin<=fh*60+fm} }
      const taxaCfg=jsonParse(cfg.delivery_fee_config)||{}
      const infoLoja=[`Nome: ${nomeLoja}`,`Status: ${lojaAbertaAgora?'🟢 ABERTO':'🔴 FECHADO'}`,cfg.store_whatsapp?`WhatsApp: ${cfg.store_whatsapp}`:null,cfg.store_descricao?`Descrição: ${cfg.store_descricao}`:null,cfg.store_tempo_entrega?`Tempo de entrega: ${cfg.store_tempo_entrega}`:null,taxaCfg.tipo==='fixo'?`Taxa: ${parseFloat(taxaCfg.valor||0)>0?'R$ '+parseFloat(taxaCfg.valor).toFixed(2).replace('.',','):'Grátis'}`:null,`Cardápio: ${linkCardapio}`].filter(Boolean)
      contexto.push(`INFORMAÇÕES DA LOJA:\n${infoLoja.join('\n')}`)
      const diasNome={dom:'Domingo',seg:'Segunda',ter:'Terça',qua:'Quarta',qui:'Quinta',sex:'Sexta',sab:'Sábado'}
      if (Object.keys(horariosCfg).length) contexto.push('HORÁRIO:\n'+Object.entries(horariosCfg).map(([d,h])=>h.ativo?`${diasNome[d]}: ${h.abertura} às ${h.fechamento}${d===diaHoje?' ← hoje':''}`:` ${diasNome[d]}: Fechado`).join('\n'))
      const categorias=db.prepare("SELECT name,label FROM categories WHERE tenant_id=? AND ativo=1 ORDER BY sort_order").all(tenantId)
      const itensTodos=db.prepare("SELECT name,description,price,price_old,status,cat_key,cat,emoji,promo FROM menu_items WHERE tenant_id=? AND status!='pausado' ORDER BY id").all(tenantId)
      if (itensTodos.length) {
        const catMap=new Map()
        for(const item of itensTodos){const ck=item.cat_key||item.cat||'outros';if(!catMap.has(ck))catMap.set(ck,[]);catMap.get(ck).push(item)}
        let txt=''
        for(const[catKey,items]of catMap){const ci=categorias.find(c=>c.name===catKey);const lbl=ci?.label||ci?.name||catKey;txt+=`\n${lbl.toUpperCase()}:\n${items.map(i=>`  • ${i.name}: R$${parseFloat(i.price).toFixed(2).replace('.',',')}${i.price_old?` (era R$${parseFloat(i.price_old).toFixed(2).replace('.',',')})`:''}${i.promo?' 🔥':''} ${i.status==='esgotado'?'[ESGOTADO]':''}${i.description?` — ${i.description.slice(0,60)}`:''}`)}\n`}
        contexto.push(`CARDÁPIO:${txt}\nPara fotos e pedidos: ${linkCardapio}`)
        const promo=itensTodos.filter(i=>i.promo&&i.status!=='esgotado')
        if(promo.length) contexto.push('PROMOÇÕES:\n'+promo.map(i=>`  🔥 ${i.name}: R$${parseFloat(i.price).toFixed(2).replace('.',',')}${i.price_old?` (antes R$${parseFloat(i.price_old).toFixed(2).replace('.',',')})`:''}`) .join('\n'))
      }
      const cupons=db.prepare("SELECT code,type,value,min_order FROM cupons WHERE tenant_id=? AND ativo=1 AND (expires_at IS NULL OR expires_at > datetime('now')) LIMIT 5").all(tenantId)
      if(cupons.length) contexto.push('CUPONS:\n'+cupons.map(cp=>`  • *${cp.code}*: ${cp.type==='percent'?`${cp.value}%`:`R$${parseFloat(cp.value).toFixed(2)}`} de desconto${parseFloat(cp.min_order||0)>0?` (mín R$${parseFloat(cp.min_order).toFixed(2)})`:''}`) .join('\n'))
      const pedCli=db.prepare("SELECT id,status,total,items FROM orders WHERE tenant_id=? AND phone LIKE ? ORDER BY id DESC LIMIT 3").all(tenantId,`%${phone.slice(-8)}%`)
      if(pedCli.length){const sl={analise:'⏳',producao:'👨‍🍳',pronto:'✅',saiu:'🛵',entregue:'🎉',cancelado:'❌',finalizado:'✅'};contexto.push('PEDIDOS DESTE CLIENTE:\n'+pedCli.map(p=>`  #${p.id}: ${sl[p.status]||p.status} R$${parseFloat(p.total).toFixed(2).replace('.',',')}`) .join('\n'))}
      const numMatch=msgFull.match(/#\*?(\d{1,6})\*?/)||msgFull.match(/pedido\s*[*#]?\s*(\d{1,6})/i)
      if(numMatch){const n=parseInt(numMatch[1]);let ped=db.prepare("SELECT id,status,total,items,client,addr,pag FROM orders WHERE tenant_id=? AND id=?").get(tenantId,n)||db.prepare("SELECT id,status,total,items,client,addr,pag FROM orders WHERE tenant_id=? AND phone LIKE ? ORDER BY id DESC LIMIT 1").get(tenantId,`%${phone.slice(-8)}%`);const sl={analise:'⏳ aguardando',producao:'👨‍🍳 em preparo',pronto:'✅ pronto',saiu:'🛵 saiu',entregue:'🎉 entregue',cancelado:'❌ cancelado',finalizado:'✅ finalizado'};if(ped){const its=(()=>{try{return(JSON.parse(ped.items)||[]).map(i=>`${i.qty}x ${i.name}`).join(', ')}catch{return''}})();contexto.push(`PEDIDO #${ped.id}:\n  Status: ${sl[ped.status]||ped.status}\n  Total: R$${parseFloat(ped.total).toFixed(2).replace('.',',')}\n  Itens: ${its}`)}else{contexto.push(`PEDIDO #${n}: não encontrado.`)}}
      const _promptPadrao = `Você é o atendente virtual do *${nomeLoja}* — simpático, acolhedor e com personalidade! Você representa a loja com orgulho e faz o cliente se sentir especial. Responda sempre em português brasileiro, com tom humano e caloroso.

PERSONALIDADE:
- Seja caloroso e genuíno, como um atendente que ama o que faz
- Use emojis com naturalidade (2-4 por mensagem) para dar vida à conversa
- Chame o cliente de "você" e seja próximo, nunca robótico
- Demonstre entusiasmo pelos produtos da loja
- Seja proativo: sugira itens, conte novidades, destaque promoções
- Respostas devem ter conteúdo rico — nunca respostas secas de 1 linha

FORMATO DAS RESPOSTAS:
- Use *negrito* para destacar nomes de produtos, preços e informações importantes
- Organize visualmente com quebras de linha quando listar algo
- Sempre finalize convidando o cliente a continuar a conversa ou fazer um pedido
- Quando mencionar o cardápio, SEMPRE inclua o link: ${linkCardapio}`

      const _instrucoesSituacao = []
      if (_isPrimeiraMsgDia) {
        _instrucoesSituacao.push(`SITUAÇÃO ESPECIAL — PRIMEIRA MENSAGEM DO DIA:
Esta é a primeira mensagem deste cliente hoje! Comece com uma saudação calorosa em nome do ${nomeLoja}. Use "${_saudacaoHora}" adequado ao horário.
Modelo: "${_saudacaoHora}! 😊 Seja muito bem-vindo(a) ao *${nomeLoja}*! Que bom ter você aqui com a gente hoje! [continue naturalmente com o que o cliente perguntou ou convide a ver o cardápio com o link: ${linkCardapio}]"`)
      }
      if (_isSoSaudacao) {
        _instrucoesSituacao.push(`SITUAÇÃO ESPECIAL — CLIENTE ENVIOU APENAS SAUDAÇÃO:
O cliente mandou só uma saudação sem perguntar nada específico. NÃO responda apenas com saudação de volta! Responda com calor humano e conduza a conversa:
- Cumprimente de volta com entusiasmo
- Apresente-se como atendente do ${nomeLoja}
- Pergunte como pode ajudar de forma envolvente
- Mencione algo atrativo (promoção, item popular, novidade) para despertar interesse
- Compartilhe o link do cardápio: ${linkCardapio}
Exemplo: "${_saudacaoHora}! 😄 Que prazer ter você aqui no *${nomeLoja}*! Eu sou o assistente virtual e estou aqui pra te ajudar com tudo! 🤗 Quer dar uma olhada no nosso cardápio? Tem coisa deliciosa esperando por você: ${linkCardapio} — Me conta, posso te ajudar com alguma coisa? 😋"`)
      }

      const systemPrompt = `${iaG.prompt_base || _promptPadrao}\n\n${_instrucoesSituacao.length ? _instrucoesSituacao.join('\n\n') + '\n\n' : ''}${contexto.join('\n\n')}\n\nREGRAS OBRIGATÓRIAS:\n- Nunca liste o cardápio inteiro. Cite no máximo 3-4 itens como sugestão e envie o link: ${linkCardapio}\n- Para fazer pedidos, SEMPRE direcione para o cardápio online: ${linkCardapio}\n- Se a loja estiver FECHADA, informe o horário de funcionamento e convide o cliente a ver o cardápio para quando abrir\n- Se o cliente perguntar sobre um pedido, dê informações detalhadas com status e itens\n- Nunca invente informações que não estão no contexto\n- Se houver promoções ou cupons, mencione-os naturalmente quando fizer sentido\n- Mantenha respostas entre 3-8 linhas — ricas em conteúdo mas sem ser prolixo`
      try {
        const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${openaiKey}`},body:JSON.stringify({model:modelo,max_tokens:maxTokens,messages:[{role:'system',content:systemPrompt},...convHist.slice(-10),{role:'user',content:msgFull}]})})
        const d=await r.json().catch(()=>({}))
        let resposta=d?.choices?.[0]?.message?.content||''
        if(quebraLen>0&&resposta.length>quebraLen){const words=resposta.split(' ');let linha='',result=[];for(const w of words){if((linha+' '+w).trim().length>quebraLen){result.push(linha.trim());linha=w}else linha=(linha+' '+w).trim()};if(linha)result.push(linha);resposta=result.join('\n')}
        if(resposta){await sendWA(phone,resposta,inst);log('🤖',`IA → ${phone}: ${resposta.slice(0,60)}`);convHist.push({role:'user',content:msgFull},{role:'assistant',content:resposta});if(convHist.length>20)convHist.splice(0,convHist.length-20);_msgBuffer.set(histKey,convHist)}
      } catch(e){log('❌','IA OpenAI error:',e.message)}
    }, bufferSeg*1000)
    _msgBuffer.set(bufKey,{msgs,timer})
  } catch(e){log('❌','Webhook error:',e.message)}
  send(res,200,{ok:true})
}

// ════════════════════════════════════════════════════════
// HTTP SERVER
// ════════════════════════════════════════════════════════
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.svg':'image/svg+xml','.json':'application/json'}

function send(res, status, data) {
  const body = JSON.stringify(data)
  res.setHeader('Content-Type','application/json')
  const ae = res.req?.headers?.['accept-encoding']||''
  if (body.length>1024&&ae.includes('gzip')) {
    zlib.gzip(body,(err,buf)=>{ if(err){res.writeHead(status);res.end(body);return}; res.setHeader('Content-Encoding','gzip');res.setHeader('Vary','Accept-Encoding');res.writeHead(status);res.end(buf) }); return
  }
  res.writeHead(status); res.end(body)
}

function readBody(req) { return new Promise((ok,err)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{ok(b?JSON.parse(b):{})}catch{ok({})}});req.on('error',err)}) }

const etagCache = new Map()
function getEtag(fpath) {
  const mtime=fs.statSync(fpath).mtimeMs, cached=etagCache.get(fpath)
  if(cached&&cached.mtime===mtime) return cached.etag
  const etag='"'+crypto.createHash('md5').update(fs.readFileSync(fpath)).digest('hex')+'"'
  etagCache.set(fpath,{mtime,etag}); return etag
}

function serveStatic(req,res,fpath,ext) {
  try {
    const etag=getEtag(fpath), isHtml=ext==='.html', isScript=['.js','.css'].includes(ext)
    res.setHeader('Cache-Control',(isHtml||isScript)?'no-cache':'public, max-age=604800, immutable')
    res.setHeader('ETag',etag)
    if(req.headers['if-none-match']===etag){res.writeHead(304);res.end();return}
    res.setHeader('Content-Type',MIME[ext]||'text/plain')
    if(['.html','.js','.css'].includes(ext)){
      const content=fs.readFileSync(fpath), ae=req.headers['accept-encoding']||''
      if(ae.includes('gzip')){zlib.gzip(content,(err,buf)=>{if(err){res.writeHead(200);res.end(content);return};res.setHeader('Content-Encoding','gzip');res.setHeader('Vary','Accept-Encoding');res.writeHead(200);res.end(buf)});return}
      res.writeHead(200);res.end(content);return
    }
    res.writeHead(200);fs.createReadStream(fpath).pipe(res)
  } catch{res.writeHead(404);res.end('Not found')}
}

const server = http.createServer(async (req,res) => {
  res.req = req
  res.setHeader('Access-Control-Allow-Origin','*')
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Prefer,apikey,Authorization,x-tenant-id')
  if(req.method==='OPTIONS'){res.writeHead(200);res.end();return}

  const url    = new URL(req.url,`http://localhost:${PORT}`)
  const upath  = url.pathname.replace(/\/$/,'')||'/'
  const params = url.searchParams

  if(upath.startsWith('/sse/')){sseSubscribe(decodeURIComponent(upath.slice(5)),res);return}
  if(req.method==='GET'&&upath==='/api/tenant-info'){const info=handleTenantInfo(params);send(res,info.error?404:200,info);return}
  if(req.method==='GET'&&upath==='/api/tenant-slug'){const tid=req.headers['x-tenant-id']||params.get('tenant_id')||'';if(!tid){send(res,400,{error:'x-tenant-id obrigatório'});return};const row=db.prepare('SELECT slug FROM tenants WHERE id=?').get(tid);send(res,200,{slug:row?.slug||''});return}
  if(req.method==='GET'&&upath==='/api/tenant-info-gestor'){const tid=req.headers['x-tenant-id']||params.get('tenant_id')||'';if(!tid){send(res,400,{error:'x-tenant-id obrigatório'});return};const row=db.prepare('SELECT id,nome,slug,plano,ativo,expires_at FROM tenants WHERE id=?').get(tid);if(!row){send(res,404,{error:'Tenant não encontrado'});return};send(res,200,row);return}
  if(upath==='/status'){send(res,200,{ok:true,uptime:Math.floor(process.uptime()),db:'sqlite-multitenant',version:'4.0.0',backup:fs.existsSync(BACKUP_PATH)?fs.statSync(BACKUP_PATH).mtime:null});return}
  if(req.method==='POST'&&upath==='/api/order-status'){await handleOrderStatus(req,res);return}

  // ── Cashback ─────────────────────────────────────────────
  if(upath==='/api/cashback/config'){
    const tid=req.headers['x-tenant-id']||params.get('tenant_id')||''
    if(!tid){send(res,400,{error:'x-tenant-id obrigatório'});return}
    if(req.method==='GET'){
      const cfg=db.prepare('SELECT cashback_config FROM store_config WHERE tenant_id=?').get(tid)
      const parsed=(() => { try { return JSON.parse(cfg?.cashback_config||'{}') } catch { return {} } })()
      send(res,200,parsed);return
    }
    if(req.method==='POST'||req.method==='PATCH'){
      const body=await readBody(req)
      const cfgStr=JSON.stringify({ativo:!!body.ativo,pct:parseFloat(body.pct)||0,min_pedido:parseFloat(body.min_pedido)||0,validade_dias:parseInt(body.validade_dias)||0})
      db.prepare('INSERT INTO store_config (tenant_id,cashback_config) VALUES (?,?) ON CONFLICT(tenant_id) DO UPDATE SET cashback_config=excluded.cashback_config').run(tid,cfgStr)
      marcarDirty();send(res,200,{ok:true});return
    }
  }
  if(req.method==='GET'&&upath==='/api/cashback/saldo'){
    const tid=req.headers['x-tenant-id']||params.get('tenant_id')||''
    const phone=(params.get('phone')||'').replace(/\D/g,'')
    if(!tid||!phone){send(res,400,{error:'tenant_id e phone obrigatórios'});return}
    const cust=db.prepare('SELECT cashback_saldo FROM customers WHERE tenant_id=? AND phone LIKE ?').get(tid,`%${phone.slice(-8)}%`)
    send(res,200,{saldo:parseFloat(cust?.cashback_saldo||0)});return
  }
  if(req.method==='POST'&&upath==='/api/cashback/usar'){
    const tid=req.headers['x-tenant-id']||params.get('tenant_id')||''
    const body=await readBody(req)
    const phone=(body.phone||'').replace(/\D/g,'')
    const valor=parseFloat(body.valor)||0
    if(!tid||!phone||valor<=0){send(res,400,{error:'Parâmetros inválidos'});return}
    const cust=db.prepare('SELECT id,cashback_saldo FROM customers WHERE tenant_id=? AND phone LIKE ?').get(tid,`%${phone.slice(-8)}%`)
    if(!cust){send(res,404,{error:'Cliente não encontrado'});return}
    const saldo=parseFloat(cust.cashback_saldo||0)
    if(saldo<valor){send(res,400,{error:'Saldo insuficiente',saldo});return}
    db.prepare('UPDATE customers SET cashback_saldo=cashback_saldo-? WHERE id=?').run(valor,cust.id)
    marcarDirty();send(res,200,{ok:true,saldo_restante:parseFloat((saldo-valor).toFixed(2))});return
  }
  if(req.method==='POST'&&upath==='/api/cashback/ajustar'){
    const tid=req.headers['x-tenant-id']||params.get('tenant_id')||''
    const body=await readBody(req)
    const custId=parseInt(body.customer_id)||0
    const valor=parseFloat(body.valor)||0
    if(!tid||!custId){send(res,400,{error:'Parâmetros inválidos'});return}
    db.prepare('UPDATE customers SET cashback_saldo=MAX(0,cashback_saldo+?) WHERE id=? AND tenant_id=?').run(valor,custId,tid)
    const updated=db.prepare('SELECT cashback_saldo FROM customers WHERE id=?').get(custId)
    marcarDirty();send(res,200,{ok:true,saldo:parseFloat(updated?.cashback_saldo||0)});return
  }

  // ── Fidelidade: sync automático ao cadastrar/logar ───
  if (req.method === 'POST' && upath === '/api/fidelidade/sync') {
    const tid = req.headers['x-tenant-id'] || ''
    const body = await readBody(req)
    const { phone, name } = body
    if (!tid || !phone) { send(res, 400, { error: 'tenant_id e phone obrigatórios' }); return }
    try {
      const phone8 = phone.replace(/\D/g,'').slice(-8)
      // Verifica se já está no programa
      const jaExiste = db.prepare('SELECT id FROM fidelidade WHERE tenant_id=? AND phone LIKE ?').get(tid, `%${phone8}%`)
      if (!jaExiste) {
        const cfg    = db.prepare('SELECT fid_config FROM store_config WHERE tenant_id=?').get(tid)
        const fidCfg = (() => { try { return JSON.parse(cfg?.fid_config||'{}') } catch { return {} } })()
        const meta   = parseInt(fidCfg.meta_pts || 500)
        db.prepare('INSERT OR IGNORE INTO fidelidade (tenant_id,name,phone,pts,max_pts,orders_count,resgates) VALUES (?,?,?,0,?,0,0)')
          .run(tid, name || phone, phone.replace(/\D/g,''), meta)
        marcarDirty()
        log('⭐', `Fidelidade: ${name||phone} cadastrado automaticamente (${tid})`)
        send(res, 200, { ok: true, novo: true }); return
      }
      send(res, 200, { ok: true, novo: false }); return
    } catch(e) { send(res, 500, { error: e.message }); return }
  }

  // ── Rotas especiais — todas em routes.js ───────────────────────────────────
  const _routeCtx = { upath, params, db, send, readBody, log, sseBroadcast, marcarDirty,
    validarSessaoAdmin, criarSessaoAdmin, fazerBackup, restaurarBackup, getTenantId,
    MP_TOKEN, TAXA_PIX, BACKUP_PATH, UPLOADS_DIR,
    EVO_URL, EVO_KEY, EVO_INST, sendWA, fillVars, sleep, checarAniv, handleIAWebhook, _pausaHumano }
  try {
    if (await handleRoutes(req, res, _routeCtx)) return
  } catch(e) {
    log('❌', `handleRoutes exception [${req.method} ${upath}]:`, e.message)
    if (!res.writableEnded) send(res, 500, { error: 'Erro interno do servidor', detail: e.message })
    return
  }

  // Rotas especiais — não passam pelo REST engine genérico
  // (inclui rotas dos arquivos routes-*.js + as tratadas diretamente aqui)
  const _specialApis=new Set(['/api/tenant-info','/api/tenant-slug','/api/tenant-info-gestor','/api/order-status','/api/customer-register','/api/customer-login','/api/customer-orders','/api/criar-tenant','/api/backup','/api/restore','/api/admin-login','/api/admin-logout','/api/ia-humano-assumiu','/api/rastreio-wa','/api/backup-completo-gestor','/api/pix/criar','/api/pix/status','/api/pix/vincular','/api/pix/config','/api/pix/gestor-config','/api/carteira','/api/saques/solicitar','/api/saques/meus','/api/admin/saques','/api/admin/saques/atualizar','/api/admin/mp-config','/api/admin/pix-toggle','/api/cashback/config','/api/cashback/saldo','/api/cashback/usar','/api/cashback/ajustar','/api/fidelidade/sync','/api/cartao/criar','/api/cartao/status','/api/cartao/public-key','/api/garcom-login','/api/radio/send','/api/radio/garcons','/api/radio/messages','/api/radio/audio/','/api/tenant-segmento','/api/print','/api/printers','/api/print-queue/heartbeat','/api/print-queue/pending','/api/print-queue/status','/api/print-queue/job','/api/print-queue/pdf'])
  if((upath.startsWith('/api/')&&!_specialApis.has(upath)&&!upath.startsWith('/api/evo')&&!upath.startsWith('/api/radio/audio/'))||upath.startsWith('/rest/v1/')){
    const table=upath.split('/')[upath.startsWith('/rest/v1/')?3:2],body=['POST','PATCH'].includes(req.method)?await readBody(req):{}
    await handleREST(req,res,table,params,body);return
  }

  if(req.method==='POST'&&upath.startsWith('/storage/v1/object/')){
    // Upload requer x-tenant-id ou sessão admin válida
    const uploadTid = req.headers['x-tenant-id']
    if (!uploadTid && !validarSessaoAdmin(req)) { send(res,401,{error:'Não autorizado'}); return }
    await handleUpload(req,res); return
  }

  if(req.method==='GET'&&(upath.startsWith('/uploads/')||upath.startsWith('/storage/v1/object/public/'))){
    const fname=path.basename(upath),fpath=path.join(UPLOADS_DIR,fname)
    if(fs.existsSync(fpath)){const ext=path.extname(fpath);res.setHeader('Content-Type',MIME[ext]||'application/octet-stream');res.setHeader('Cache-Control','public, max-age=2592000');res.writeHead(200);fs.createReadStream(fpath).pipe(res)}
    else{res.writeHead(404);res.end('Not found')}
    return
  }

  if(req.method==='GET'){
    const fname=upath==='/'?'index.html':upath.slice(1),fpath=path.join(__dirname,fname)
    if(fs.existsSync(fpath)&&!fname.includes('..')){serveStatic(req,res,fpath,path.extname(fpath));return}
  }

  send(res,404,{ok:false,error:`Rota não encontrada: ${req.method} ${upath}`})
})

server.listen(PORT,()=>{
  log('🚀',`Servidor rodando na porta ${PORT}`)
  log('🏢',`Multi-tenant · SQLite`)
})

// ── Inicializa CUPS automaticamente ──────────────────
;(function initCups() {
  const { execSync } = require('child_process')
  try {
    // Instala CUPS se não estiver instalado
    try {
      execSync('which lp', { timeout: 3000 })
      log('🖨️', 'CUPS já instalado')
    } catch {
      log('🖨️', 'Instalando CUPS...')
      execSync('apt-get update -qq && apt-get install -y cups cups-filters printer-driver-cups-pdf chromium --no-install-recommends 2>/dev/null', { timeout: 120000 })
      log('🖨️', 'CUPS instalado com sucesso')
    }
    execSync('service cups start 2>/dev/null || true', { timeout: 10000 })
    const lpstat = execSync('lpstat -a 2>/dev/null || echo ""', { encoding: 'utf8', timeout: 5000 })
    if (!lpstat.includes('PDF')) {
      execSync('lpadmin -p PDF -E -v cups-pdf:/ -P /usr/share/ppd/cupsfilters/Generic-PDF_Printer-PDF.ppd 2>/dev/null || true', { timeout: 10000 })
      log('🖨️', 'Impressora PDF virtual registrada')
    }
    log('🖨️', 'CUPS inicializado com sucesso')
  } catch (e) {
    log('⚠️', 'CUPS: ' + e.message?.slice(0,80))
  }
})()

setInterval(checarAniv,60000)
setTimeout(checarAniv,5000)

function shutdown(){fazerBackup(true);db.close();server.close();process.exit(0)}
process.on('SIGTERM',shutdown)
process.on('SIGINT',shutdown)

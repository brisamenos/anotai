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
  CREATE TABLE IF NOT EXISTS customer_enderecos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL,
    label TEXT,
    cep TEXT, rua TEXT, numero TEXT, bairro TEXT, complemento TEXT, referencia TEXT,
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_customer_enderecos_cliente ON customer_enderecos(tenant_id, customer_id);
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
  { version:33, description:'tabela fornecedores', up:
    `CREATE TABLE IF NOT EXISTS fornecedores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      nome TEXT NOT NULL,
      contato TEXT,
      telefone TEXT,
      email TEXT,
      cnpj TEXT,
      endereco TEXT,
      obs TEXT,
      ativo INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )`
  },
  { version:34, description:'tabela contas_pagar', up:
    `CREATE TABLE IF NOT EXISTS contas_pagar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      descricao TEXT NOT NULL,
      valor REAL NOT NULL,
      vencimento TEXT NOT NULL,
      categoria TEXT DEFAULT 'outros',
      fornecedor_id INTEGER,
      recorrente INTEGER DEFAULT 0,
      recorrencia TEXT,
      status TEXT DEFAULT 'pendente',
      pago_em TEXT,
      obs TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`
  },
  { version:35, description:'fornecedor_id no estoque', up:
    `ALTER TABLE estoque ADD COLUMN fornecedor_id INTEGER`
  },
  { version:36, description:'finaliza pedidos entregue antigos (>12h)', up:
    // Pedidos que ficaram em 'entregue' por mais de 12 horas são marcados como 'finalizado'.
    // Motivo: mudança no fluxo de delivery (pronto→saiu→entregue→finalizado) fez com que
    // pedidos antigos, que antes sumiam do kanban ao chegar em 'entregue', passassem a ficar
    // visíveis aguardando clique em "Finalizar" — poluindo o kanban com centenas de pedidos
    // históricos. Esta migração limpa esse backlog uma única vez.
    `UPDATE orders SET status='finalizado' WHERE status='entregue' AND created_at < datetime('now','-12 hours')`
  },
  { version:37, description:'tabela wa_followup_sent (idempotência do follow-up de pedido perdido)', up:[
    `CREATE TABLE IF NOT EXISTS wa_followup_sent (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      phone TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'pedido_perdido',
      anchor_ts INTEGER NOT NULL,
      sent_at TEXT DEFAULT (datetime('now')),
      UNIQUE(tenant_id, phone, tipo, anchor_ts)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_wa_fup_sent_at ON wa_followup_sent(sent_at)`
  ]},
  { version:38, description:'tabela addons_esgotados (adicionais globalmente esgotados por tenant)', up:[
    `CREATE TABLE IF NOT EXISTS addons_esgotados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      nome_norm TEXT NOT NULL,
      nome_original TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(tenant_id, nome_norm)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_addons_esg_tenant ON addons_esgotados(tenant_id)`
  ]},
  { version:39, description:'audit log admin + faturas + updated_at em tenants', up:[
    // updated_at em tenants (usado pelo cálculo de churn: quem ficou inativo nos últimos 30d)
    `ALTER TABLE tenants ADD COLUMN updated_at TEXT`,
    // backfill: usa created_at para registros existentes
    `UPDATE tenants SET updated_at = created_at WHERE updated_at IS NULL`,
    // Audit log: rastreia ações administrativas (deletar/pausar/renovar/cobrar/mudar preço)
    `CREATE TABLE IF NOT EXISTS admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id TEXT,
      admin_nome TEXT,
      admin_email TEXT,
      acao TEXT NOT NULL,
      alvo_tipo TEXT,
      alvo_id TEXT,
      alvo_nome TEXT,
      detalhes TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_acao ON admin_audit_log(acao)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_alvo ON admin_audit_log(alvo_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_data ON admin_audit_log(created_at DESC)`,
    // Faturas (cobranças mensais dos restaurantes pagando o SaaS)
    `CREATE TABLE IF NOT EXISTS faturas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      plano TEXT,
      valor REAL NOT NULL,
      meses INTEGER DEFAULT 1,
      metodo TEXT DEFAULT 'pix',
      status TEXT DEFAULT 'pendente',
      link_pagamento TEXT,
      mp_payment_id TEXT,
      mp_external_ref TEXT,
      qr_code TEXT,
      qr_code_base64 TEXT,
      vence_em TEXT,
      pago_em TEXT,
      cancelado_em TEXT,
      obs TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_faturas_tenant  ON faturas(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_faturas_status  ON faturas(status)`,
    `CREATE INDEX IF NOT EXISTS idx_faturas_mp      ON faturas(mp_payment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_faturas_extref  ON faturas(mp_external_ref)`,
  ]},
  { version:40, description:'mp_source em pagamentos (qual conta MP processou: tenant ou global)', up:[
    `ALTER TABLE pagamentos_pix    ADD COLUMN mp_source TEXT DEFAULT 'global'`,
    `ALTER TABLE pagamentos_cartao ADD COLUMN mp_source TEXT DEFAULT 'global'`,
  ]},
  { version:41, description:'cartao fidelidade carimbinho: stamp_progress + stamp_config', up:[
    `CREATE TABLE IF NOT EXISTS stamp_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      phone TEXT NOT NULL,
      compras INTEGER DEFAULT 0,
      ultimo_resgate INTEGER DEFAULT 0,
      UNIQUE(tenant_id, phone)
    )`,
    `ALTER TABLE store_config ADD COLUMN stamp_config TEXT DEFAULT '{}'`
  ]},
  { version:42, description:'pickup_addresses em store_config (múltiplos pontos de retirada)', up:
    `ALTER TABLE store_config ADD COLUMN pickup_addresses TEXT DEFAULT '[]'`
  },
  { version:43, description:'telegram_backup_config em store_config (config do backup automático para Telegram)', up:
    `ALTER TABLE store_config ADD COLUMN telegram_backup_config TEXT DEFAULT '{}'`
  },
  { version:44, description:'ia_pausa: persistir pausa da IA entre reinícios do servidor', up:
    `CREATE TABLE IF NOT EXISTS ia_pausa (
      tenant_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      pausado_em INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, phone)
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
  'cupons','mesas','garcons','orders','movimentos','estoque','fidelidade','customers','pagamentos_pix','saques','pagamentos_cartao','stamp_progress']
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

// Cleanup de pedidos abandonados em pagamento online — marca como 'cancelado' após 30 min.
// Cliente abandonou o checkout (fechou a aba sem pagar) → não polui kanban nem relatórios.
// Roda a cada 5 min. Pedidos 'aguardando_pix'/'aguardando_cartao' mais velhos que 30min viram 'cancelado'.
setInterval(() => {
  try {
    const rows = db.prepare(
      `SELECT id, tenant_id FROM orders
       WHERE status IN ('aguardando_pix','aguardando_cartao')
       AND created_at < datetime('now','-30 minutes')`
    ).all()
    if (rows.length) {
      db.prepare(
        `UPDATE orders SET status='cancelado'
         WHERE status IN ('aguardando_pix','aguardando_cartao')
         AND created_at < datetime('now','-30 minutes')`
      ).run()
      log('🧹', `[CLEANUP] ${rows.length} pedido(s) pendente(s) abandonado(s) foram cancelados`)
      marcarDirty()
      // Broadcast SSE para remover do kanban aberto no gestor
      const byTenant = new Map()
      for (const r of rows) {
        if (!byTenant.has(r.tenant_id)) byTenant.set(r.tenant_id, [])
        byTenant.get(r.tenant_id).push(r.id)
      }
      for (const [tid, ids] of byTenant) {
        for (const id of ids) {
          sseBroadcast(`orders-rt:${tid}`, 'orders:UPDATE', { id, status: 'cancelado' })
        }
      }
    }
  } catch(e) { log('⚠️','[CLEANUP] erro:', e.message) }
}, 5 * 60 * 1000)

// Cleanup de pedidos em 'entregue' abandonados — finaliza automaticamente após 6 horas.
// Motivo: o novo fluxo de delivery (saiu → entregue → finalizado) exige clique em "Finalizar"
// pelo gestor. Se o gestor esquece, pedidos acumulam no kanban. Após 6h sem ação, assumimos
// que já foi de fato finalizado e limpamos automaticamente.
// Roda a cada 30 min.
// Cleanup de pedidos em 'entregue' abandonados — finaliza automaticamente após 6 horas.
// APENAS para tenants de segmento 'restaurante'. No açougue, pedidos em 'entregue' são
// legítimos — ficam na coluna esperando o gestor clicar em "Finalizar" para registrar o
// movimento financeiro. Não devemos limpar automaticamente.
// Motivo: o novo fluxo de delivery (saiu → entregue → finalizado) exige clique em "Finalizar"
// pelo gestor. Se o gestor esquece, pedidos acumulam no kanban. Após 6h sem ação, assumimos
// que já foi de fato finalizado e limpamos automaticamente (só restaurante).
// Roda a cada 30 min.
setInterval(() => {
  try {
    const rows = db.prepare(
      `SELECT o.id, o.tenant_id FROM orders o
       JOIN tenants t ON t.id = o.tenant_id
       WHERE o.status='entregue'
       AND o.created_at < datetime('now','-6 hours')
       AND COALESCE(t.segmento, 'restaurante') != 'acougue'`
    ).all()
    if (rows.length) {
      const ids = rows.map(r => r.id)
      const placeholders = ids.map(() => '?').join(',')
      db.prepare(
        `UPDATE orders SET status='finalizado' WHERE id IN (${placeholders})`
      ).run(...ids)
      log('🧹', `[CLEANUP] ${rows.length} pedido(s) restaurante em "entregue" há >6h foram auto-finalizados`)
      marcarDirty()
      const byTenant = new Map()
      for (const r of rows) {
        if (!byTenant.has(r.tenant_id)) byTenant.set(r.tenant_id, [])
        byTenant.get(r.tenant_id).push(r.id)
      }
      for (const [tid, ids] of byTenant) {
        for (const id of ids) {
          sseBroadcast(`orders-rt:${tid}`, 'orders:UPDATE', { id, status: 'finalizado' })
        }
      }
    }
  } catch(e) { log('⚠️','[CLEANUP entregue] erro:', e.message) }
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
  orders:           (tid) => [`orders-rt:${tid}`],
  mesas:            (tid) => [`mesas-rt:${tid}`],
  store_config:     (tid) => [`store-config-rt:${tid}`],
  menu_items:       (tid) => [`menu-rt:${tid}`],
  categories:       (tid) => [`cats-rt:${tid}`, `menu-rt:${tid}`],
  garcons:          (tid) => [`orders-rt:${tid}`],
  saques:           (tid) => [`saques-rt:${tid}`, `saques-admin`],
  customers:        (tid) => [`customers-rt:${tid}`],
  addons_esgotados: (tid) => [`menu-rt:${tid}`],
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
  tenants:      ['id','nome','plano','ativo','slug','segmento','expires_at','updated_at','created_at'],
  sys_users:    ['id','tenant_id','nome','email','senha_hash','role','ativo','ultimo_acesso','created_at'],
  store_config: ['id','tenant_id','store_open','caixa_open','delivery_fee_config','fid_config','evo_automacoes','evo_aniv_last','wa_server_url','sidebar_state','evo_instance','store_name','store_descricao','store_logo_url','store_banner_url','store_cor','store_cor_texto','store_tema','cats_carrossel','store_tempo_entrega','store_avaliacao','store_whatsapp','gestor_tema','ia_config','horarios_config','order_num_offset','cashback_config','pedido_minimo','store_address','store_lat','store_lng','tipos_entrega','print_config','taxa_servico_pct','stamp_config','pickup_addresses'],
  categories:   ['id','tenant_id','name','label','type','promo','emoji','sort_order','ativo'],
  menu_items:   ['id','tenant_id','name','description','price','price_old','category_id','cat','cat_key','emoji','image_url','promo','status','item_type','allow_half','max_flavors','days','ingredients','custom_groups','destaque','sort_order','created_at'],
  cupons:       ['id','tenant_id','code','type','value','min_order','uses_left','ativo','expires_at'],
  mesas:        ['id','tenant_id','num','status','guests','opened_at','total','pag_forma','updated_at'],
  garcons:      ['id','tenant_id','nome','usuario','senha','ativo'],
  orders:       ['id','tenant_id','client','phone','addr','items','total','taxa','pag','pag_momento','troco','time','status','mesa_num','garcom_id','garcom_nome','customer_id','order_num','created_at'],
  movimentos:   ['id','tenant_id','description','tipo','val','pag','time','created_at'],
  estoque:      ['id','tenant_id','name','qty','unit','min_qty','cost','fornecedor_id','updated_at'],
  fidelidade:   ['id','tenant_id','name','phone','birthday','pts','max_pts','orders_count','resgates','created_at'],
  customers:    ['id','tenant_id','name','phone','addr','orders_count','total_spent','last_order_at','email','birthday','senha_hash','cashback_saldo','created_at'],
  customer_enderecos: ['id','tenant_id','customer_id','label','cep','rua','numero','bairro','complemento','referencia','is_default','created_at'],
  ratings:      ['id','tenant_id','order_id','client','phone','nota','comentario','created_at'],
  pagamentos_cartao: ['id','tenant_id','order_id','mp_payment_id','mp_external_ref','valor','status','status_detail','payer_name','payer_email','last_four_digits','payment_method_id','created_at','paid_at','mp_source'],
  stamp_progress: ['id','tenant_id','phone','compras','ultimo_resgate'],
  fornecedores: ['id','tenant_id','nome','contato','telefone','email','cnpj','endereco','obs','ativo','created_at'],
  contas_pagar: ['id','tenant_id','descricao','valor','vencimento','categoria','fornecedor_id','recorrente','recorrencia','status','pago_em','obs','created_at'],
  faturas:      ['id','tenant_id','plano','valor','meses','metodo','status','link_pagamento','mp_payment_id','mp_external_ref','qr_code','qr_code_base64','vence_em','pago_em','cancelado_em','obs','created_at'],
  admin_audit_log: ['id','admin_id','admin_nome','admin_email','acao','alvo_tipo','alvo_id','alvo_nome','detalhes','ip','user_agent','created_at'],
}
// Colunas que NUNCA aparecem na resposta GET — mas ainda funcionam como filtro WHERE e em escrita
const STRIP_FROM_OUTPUT = {
  sys_users:    new Set(['senha_hash']),
  garcons:      new Set(['senha']),
  customers:    new Set(['senha_hash']),
  store_config: new Set([]),
}

const NO_TENANT_FILTER = new Set(['tenants','sys_users','admin_audit_log'])
const JSON_FIELDS = {
  orders:       new Set(['items']),
  menu_items:   new Set(['days','ingredients','custom_groups']),
  store_config: new Set(['delivery_fee_config','fid_config','evo_automacoes','sidebar_state','horarios_config','cashback_config','tipos_entrega','stamp_config']),
  admin_audit_log: new Set(['detalhes']),
}
const BOOL_FIELDS  = new Set(['ativo','store_open','caixa_open','destaque'])
const SSE_TABLES   = new Set(['orders','mesas','store_config','menu_items','categories','garcons','customers','addons_esgotados'])

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
    if ((m=val.match(/^like\.(.+)$/))) { conds.push(`"${key}" LIKE ?`); vals.push(m[1]); continue }
    if ((m=val.match(/^ilike\.(.+)$/))){ conds.push(`LOWER("${key}") LIKE LOWER(?)`); vals.push(m[1]); continue }
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
      // Segurança: para tabelas com tenant_id, SEMPRE força o tenant_id do header.
      // Isso previne que um cliente injete tenant_id no body para escrever em outro tenant.
      if (tenantId && !NO_TENANT_FILTER.has(table)) {
        if (payload.tenant_id && payload.tenant_id !== tenantId) {
          return send(res, 403, { error: 'tenant_id do body não bate com o header' })
        }
        payload.tenant_id = tenantId
      }

      // ── Validação server-side para orders ────────────────────────────────
      // Previne: (a) bypass de bairros_bloqueados via API direta;
      //          (b) downgrade de taxa fixa via cliente malicioso;
      //          (c) cobrança indevida em retirada/mesa.
      if (table === 'orders' && tenantId) {
        const addrRaw = String(payload.addr || '').trim()
        const isMesa     = (payload.mesa_num != null && payload.mesa_num !== '') || /^Mesa\b/i.test(addrRaw)
        const isRetirada = /^Retirada\b/i.test(addrRaw)
        const isDelivery = !isMesa && !isRetirada && addrRaw.length > 0

        if (!isDelivery) {
          // Mesa ou retirada: nunca cobra taxa de entrega
          payload.taxa = 0
        } else {
          try {
            const sc = db.prepare('SELECT delivery_fee_config FROM store_config WHERE tenant_id=?').get(tenantId)
            const cfg = sc?.delivery_fee_config ? jsonParse(sc.delivery_fee_config) : {}

            // Pausa de delivery: rejeita pedidos novos
            if (cfg.delivery_pausado) {
              return send(res, 503, { error: 'Delivery temporariamente pausado pela loja. Tente retirada ou mesa, ou aguarde alguns minutos.' })
            }

            // Bloqueio: bairro do endereço bate com lista de bairros_bloqueados
            const bloqueados = Array.isArray(cfg.bairros_bloqueados) ? cfg.bairros_bloqueados : []
            if (bloqueados.length) {
              const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()
              const addrNorm = norm(addrRaw)
              for (const bb of bloqueados) {
                const bbNorm = norm(bb)
                if (bbNorm && new RegExp(`(^|[^a-z0-9])${bbNorm.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}([^a-z0-9]|$)`).test(addrNorm)) {
                  return send(res, 403, { error: `Bairro "${bb}" não é atendido pela loja.` })
                }
              }
            }

            // Anti-downgrade: taxa fixa não pode ser menor que o configurado
            if (cfg.tipo === 'fixo') {
              const taxaConf  = parseFloat(cfg.valor) || 0
              const taxaEnvio = parseFloat(payload.taxa) || 0
              if (taxaEnvio < taxaConf) payload.taxa = taxaConf
            }
            // Anti-downgrade: por_bairro — se algum bairro cadastrado bate, força a taxa correta
            else if (cfg.tipo === 'por_bairro' && Array.isArray(cfg.bairros) && cfg.bairros.length) {
              const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()
              const addrNorm = norm(addrRaw)
              for (const b of cfg.bairros) {
                const bNorm = norm(b.bairro)
                if (bNorm && addrNorm.includes(bNorm)) {
                  const taxaConf = parseFloat(b.taxa) || 0
                  if ((parseFloat(payload.taxa)||0) < taxaConf) payload.taxa = taxaConf
                  break
                }
              }
            }
            // por_km: não há como recalcular sem GPS no servidor — confia no front
          } catch(e) { log('⚠️', 'validação de delivery falhou:', e.message) }
        }
      }
      // ─────────────────────────────────────────────────────────────────────

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

      // ── Auto-assign order_num sequencial por tenant (atômico via transação) ──
      // Race: 2 pedidos simultâneos podem ler o mesmo MAX e gerar order_num duplicado.
      // Solução: executar SELECT MAX + UPDATE dentro de uma transação BEGIN IMMEDIATE.
      // SQLite + better-sqlite3 serializa as transações, então duas threads concorrentes
      // esperam uma a outra — sem duplicação.
      if (table === 'orders' && info.lastInsertRowid) {
        const _tid = tenantId || payload.tenant_id
        if (_tid) {
          try {
            const txFn = db.transaction((tenantId, rowid) => {
              const row = db.prepare('SELECT COALESCE(MAX(order_num),0) as mx FROM orders WHERE tenant_id=?').get(tenantId)
              const next = (row?.mx || 0) + 1
              db.prepare('UPDATE orders SET order_num=? WHERE rowid=?').run(next, rowid)
              return next
            })
            txFn(_tid, info.lastInsertRowid)
          } catch(e) { log('⚠️', 'order_num atômico falhou:', e.message) }
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
            // Emoji da loja conforme tipo de produto (açaí/pizza/etc)
            const _tntP    = db.prepare("SELECT segmento FROM tenants WHERE id=?").get(_tid)
            const _segP    = _tntP?.segmento || 'restaurante'
            const _emP     = detectarCategoriaPedido(items, _segP).lojaEmoji
            const _pixVars = [
              `${_emP} *${lojaP}*\n${'-'.repeat(20)}\n\n💠 *PIX — Pedido #${idStr}*\n\nOi, *${_nomeP}*! 👋 Seu pedido chegou pra gente.\n\n*Itens:*\n${(items||'').split(', ').map(i=>'• '+i).join('\n')}\n\n💰 *Total: R$ ${total}*\n\nPague via PIX pra confirmar:\n🔑 *Tipo:* ${tipoChave}\n📋 *Chave:* ${chavePix}\n\nAssim que o pagamento cair, a gente começa a preparar! ✅\n\n_Dúvidas? É só chamar! 😊_`,
              `${_emP} *${lojaP}*\n${'-'.repeat(20)}\n\n✅ *Pedido #${idStr} recebido!*\n\n*${_nomeP}*, que ótimo ter você por aqui! Seu pedido já está na nossa fila.\n\n*Itens:*\n${(items||'').split(', ').map(i=>'• '+i).join('\n')}\n\n💰 *Total: R$ ${total}*\n\nSó falta o pagamento via PIX:\n🔑 ${tipoChave}: *${chavePix}*\n\nApós confirmar, partimos pra produção! 🚀\n\n_Qualquer dúvida é só responder! 😄_`,
              `${_emP} *${lojaP}*\n${'-'.repeat(20)}\n\n🎯 *Quase lá, ${_nomeP}!*\n\nRecebemos seu pedido *#${idStr}*. Agora é só pagar via PIX!\n\n*Itens:*\n${(items||'').split(', ').map(i=>'• '+i).join('\n')}\n\n💰 *Total: R$ ${total}*\n\n📋 Chave PIX (${tipoChave}): *${chavePix}*\n\nAssim que o pagamento for identificado, você receberá confirmação. 🤝\n\n_Dúvidas? Estamos aqui! 😊_`,
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
      // Segurança: nunca deixa o payload reassignar tenant_id.
      // WHERE já filtra por tenant_id via buildWhere(), então remover do payload é suficiente.
      if (!NO_TENANT_FILTER.has(table) && 'tenant_id' in payload && payload.tenant_id !== tenantId) {
        delete payload.tenant_id
      }
      // Segurança: bloqueia tentativa de cancelar pedido via PATCH genérico.
      // Cancelamento deve passar pelos endpoints dedicados:
      //   - /api/order-status (gestor muda status livremente dentro do tenant)
      //   - /api/customer-cancel-order (cliente cancela o próprio pedido com validação)
      // Outros status (entregue, mesa_aberta, finalizado, etc.) continuam permitidos via PATCH —
      // o gestor precisa deles pra finalizar comanda de mesa, reabrir mesa, etc.
      if (table === 'orders' && payload.status === 'cancelado') {
        delete payload.status
      }
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
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB
const ALLOWED_EXT = new Set(['.jpg','.jpeg','.png','.webp','.gif'])

function handleUpload(req, res) {
  return new Promise(resolve => {
    const chunks = []
    let total = 0
    let abortado = false
    req.on('data', c => {
      total += c.length
      if (total > MAX_UPLOAD_BYTES) {
        abortado = true
        try { req.destroy() } catch(_) {}
        try { res.statusCode = 413; res.end(JSON.stringify({ error: 'Arquivo muito grande (máx 10MB)' })) } catch(_) {}
        resolve()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (abortado) return
      try {
        const buffer   = Buffer.concat(chunks)
        const ct       = req.headers['content-type'] || ''
        const boundary = ct.split('boundary=')[1]
        // Sanitiza nome do arquivo — path.basename remove diretórios, também remove .. e barras residuais
        const urlBaseRaw = path.basename((req.url||'').split('?')[0])
        const urlBase = urlBaseRaw.replace(/[^a-zA-Z0-9._-]/g, '_') // limita charset
        const hasExt   = /\.(jpg|jpeg|png|webp|gif)$/i.test(urlBase)
        const _ensureAllowedExt = (n) => {
          const e = path.extname(n).toLowerCase()
          return ALLOWED_EXT.has(e)
        }
        let fname      = hasExt ? urlBase : `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
        if (!_ensureAllowedExt(fname)) fname = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
        if (!boundary) {
          const body = JSON.parse(buffer.toString()), ext=(body.mime||'image/jpeg').split('/')[1]||'jpg'
          const safeExt = ALLOWED_EXT.has('.'+ext.toLowerCase()) ? ext.toLowerCase() : 'jpg'
          if (!hasExt) fname = `${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExt}`
          // Valida tamanho do base64 decodificado
          const decoded = Buffer.from(body.data,'base64')
          if (decoded.length > MAX_UPLOAD_BYTES) { resolve(send(res, 413, { error: 'Arquivo muito grande (máx 10MB)' })); return }
          fs.writeFileSync(path.join(UPLOADS_DIR, fname), decoded)
        } else {
          const raw   = buffer.toString('binary')
          const parts = raw.split('--'+boundary).filter(p=>p.includes('filename='))
          if (parts.length) {
            const [head,...bodyParts] = parts[0].split('\r\n\r\n')
            const fnMatch = head.match(/filename="([^"]+)"/)
            if (!hasExt&&fnMatch) {
              const rawExt = path.extname(fnMatch[1]).toLowerCase() || '.jpg'
              const ext = ALLOWED_EXT.has(rawExt) ? rawExt : '.jpg'
              fname=`${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
            }
            if (!_ensureAllowedExt(fname)) { resolve(send(res, 400, { error: 'Extensão não permitida' })); return }
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

// ══════════════════════════════════════════════════════════════
// Emojis por contexto do pedido — detecta categoria pelos itens
// ══════════════════════════════════════════════════════════════
// O sistema só tem 2 segmentos no banco (restaurante|acougue), então
// açaiteria/pizzaria/hamburgueria caem em "restaurante" e pegam emojis
// genéricos (🍽️ 👨‍🍳) que ficam estranhos. Esse helper detecta o tipo
// de comida pelos NOMES dos itens e devolve emojis apropriados.
function detectarCategoriaPedido(itemsStr, segmento) {
  if (segmento === 'acougue') {
    return { emojis: ['🥩','🔪','⚖️','🍖','🥓'], lojaEmoji: '🥩' }
  }
  const txt = String(itemsStr || '').toLowerCase()
  // Açaí / sorveteria
  if (/\baça[ií]|\baca[ií]|sorvete|milkshake|açaiteria|açaí na tigela|tigelinha|cremoso|frozen|gelato/.test(txt)) {
    return { emojis: ['🍧','🍨','🥥','🍓','🍌'], lojaEmoji: '🍧' }
  }
  // Pizza
  if (/\bpizz/.test(txt)) {
    return { emojis: ['🍕','🔥','🧀','🍅','✨'], lojaEmoji: '🍕' }
  }
  // Hamburgueria / lanches
  if (/\b(hamb[uú]rguer|hamburgueria|burger|x-|cheese|smash|artesanal|lanche)\b/.test(txt)) {
    return { emojis: ['🍔','🍟','🥤','🔥','✨'], lojaEmoji: '🍔' }
  }
  // Sushi / japonês
  if (/\b(sushi|sashimi|temaki|hot roll|combinado|yakisoba|japon)/.test(txt)) {
    return { emojis: ['🍣','🍱','🍤','🥢','✨'], lojaEmoji: '🍣' }
  }
  // Doces / confeitaria
  if (/\b(bolo|brigadeiro|doce|confeitaria|cupcake|torta|brownie|p[aã]o de mel|pudim)\b/.test(txt)) {
    return { emojis: ['🧁','🍰','🍫','🍪','✨'], lojaEmoji: '🍰' }
  }
  // Cafeteria
  if (/\b(caf[eé]|cappuccino|expresso|latte|moccacino|chocolate quente)\b/.test(txt)) {
    return { emojis: ['☕','🥐','🍩','✨','💛'], lojaEmoji: '☕' }
  }
  // Pastelaria / salgados
  if (/\b(pastel|coxinha|salgado|esfiha|esfirra|kibe|enroladinho|empada)\b/.test(txt)) {
    return { emojis: ['🥟','🌭','🔥','⚡','✨'], lojaEmoji: '🥟' }
  }
  // Comida saudável / saladas / fitness
  if (/\b(salada|fit|saud[aá]vel|natural|wrap|low\s*carb|vegano|vegetariano|bowl)\b/.test(txt)) {
    return { emojis: ['🥗','🥑','🥕','💚','✨'], lojaEmoji: '🥗' }
  }
  // Bebidas / sucos
  if (/\b(suco|smoothie|vitamina|drink|coquetel|caipirinha|cerveja|chopp)\b/.test(txt)) {
    return { emojis: ['🥤','🍹','🍓','✨','💧'], lojaEmoji: '🥤' }
  }
  // Marmita / comida caseira / executivo
  if (/\b(marmita|prato feito|pf|executivo|caseir[ao]|self.service|self.serv)\b/.test(txt)) {
    return { emojis: ['🍱','🍚','🍲','✨','💛'], lojaEmoji: '🍱' }
  }
  // Default genérico (restaurante)
  return { emojis: ['🍽️','👨‍🍳','🔥','⚡','✨'], lojaEmoji: '🍽️' }
}

async function sendWA(phone, text, inst, delayMs) {
  const instance = inst || EVO_INST
  const num      = phone.replace(/\D/g,'')
  const number   = num.startsWith('55') ? num : `55${num}`
  const headers  = { 'Content-Type':'application/json', apikey: EVO_KEY }
  // delayMs opcional: se passado, controla quanto tempo o WhatsApp mostra
  // "digitando..." antes de entregar a mensagem. Default 1000ms (legado).
  const delay    = typeof delayMs === 'number' ? Math.max(0, delayMs) : 1000
  const body     = { number, text, options: { delay, presence:'composing' } }
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

// Marca mensagem do cliente como "lida" (✓✓ azul) na Evolution API.
// Faz parte do fluxo humanizado: leitura → pausa → digitando → resposta.
// Falha silenciosamente se o endpoint não estiver disponível ou o ID
// for inválido — não bloqueia a resposta principal.
async function markAsRead(phone, msgId, inst) {
  if (!msgId) return
  const instance = inst || EVO_INST
  const num      = phone.replace(/\D/g,'')
  const number   = num.startsWith('55') ? num : `55${num}`
  const headers  = { 'Content-Type':'application/json', apikey: EVO_KEY }
  try {
    await fetch(`${EVO_URL}/chat/markMessageAsRead/${instance}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        readMessages: [{ remoteJid: `${number}@s.whatsapp.net`, fromMe: false, id: msgId }]
      })
    })
  } catch(e) { /* silencioso — endpoint pode não existir em algumas versões */ }
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

// ════════════════════════════════════════════════════════
// FOLLOW-UP PEDIDO PERDIDO
// ════════════════════════════════════════════════════════
// Cliente mandou mensagem no WhatsApp mas não fez pedido em 10 min → manda follow-up.
// Roda a cada 60s. Busca contatos cuja última mensagem no wa_messages é do cliente
// (from_me=0) há 10-15 minutos, e que não criaram pedido nem receberam resposta depois.
// Idempotente via tabela wa_followup_sent (UNIQUE por tenant+phone+anchor_ts).
async function checarPedidoPerdido() {
  const tenants = db.prepare("SELECT id FROM tenants WHERE ativo=1").all()
  const agora = Math.floor(Date.now()/1000)
  const janelaIni = agora - 15*60  // não olha mais longe que 15min atrás
  const janelaFim = agora - 10*60  // última msg precisa ter pelo menos 10min
  for (const t of tenants) {
    try {
      const cfg = db.prepare("SELECT evo_automacoes, evo_instance FROM store_config WHERE tenant_id=?").get(t.id)
      if (!cfg) continue
      const auto = jsonParse(cfg.evo_automacoes)||{}
      const pp   = auto['pedido_perdido']||{}
      if (pp.on === false) continue                  // desligado
      if (!pp.msg || !pp.msg.trim()) continue        // sem template configurado
      const inst = cfg.evo_instance||EVO_INST
      // Pega, por JID, a última mensagem (maior ts) dentro da janela, só se for do cliente (from_me=0)
      const rows = db.prepare(`
        SELECT w.remote_jid, w.ts, w.from_me
        FROM wa_messages w
        WHERE w.tenant_id = ?
          AND w.ts BETWEEN ? AND ?
          AND w.ts = (
            SELECT MAX(w2.ts) FROM wa_messages w2
            WHERE w2.tenant_id = w.tenant_id AND w2.remote_jid = w.remote_jid
          )
          AND w.from_me = 0
      `).all(t.id, janelaIni, janelaFim)
      if (!rows.length) continue
      for (const r of rows) {
        const jid   = r.remote_jid
        const phone = jid.replace('@s.whatsapp.net','').replace('@c.us','')
        if (!phone || !/^\d{10,15}$/.test(phone)) continue
        // Idempotência: já enviou pra este cliente nesta janela?
        const already = db.prepare(
          "SELECT 1 FROM wa_followup_sent WHERE tenant_id=? AND phone=? AND tipo='pedido_perdido' AND anchor_ts=?"
        ).get(t.id, phone, r.ts)
        if (already) continue
        // Cliente já pediu depois da mensagem? (compara ISO->epoch)
        const pedidoRecente = db.prepare(`
          SELECT 1 FROM orders
          WHERE tenant_id=? AND phone=?
            AND CAST(strftime('%s', created_at) AS INTEGER) >= ?
        `).get(t.id, phone, r.ts)
        if (pedidoRecente) continue
        // Pausa humana ativa? (gestor assumiu via WA ou chat — mesma lógica da IA)
        const pausaKey = `pausa:${t.id}:${phone}`
        const pausaAt  = _pausaHumano.get(pausaKey)
        if (pausaAt && (Date.now()-pausaAt) < 30*60*1000) continue
        // Envia
        const nomeRow = db.prepare("SELECT name FROM customers WHERE tenant_id=? AND phone=? ORDER BY id DESC LIMIT 1").get(t.id, phone)
        const nome = (nomeRow?.name || '').split(' ')[0] || 'tudo bem'
        const texto = fillVars(pp.msg, { nome })
        const r2 = await sendWA(phone, texto, inst)
        // Marca como enviado mesmo em falha pra não ficar tentando infinitamente
        try {
          db.prepare(
            "INSERT OR IGNORE INTO wa_followup_sent (tenant_id, phone, tipo, anchor_ts) VALUES (?,?,?,?)"
          ).run(t.id, phone, 'pedido_perdido', r.ts)
          marcarDirty()
        } catch(e) {}
        log(r2.ok?'💤':'⚠️', `[FOLLOWUP] pedido_perdido ${phone} tenant=${t.id} ok=${r2.ok}`)
        await sleep(1500)
      }
    } catch(e) { log('❌','[FOLLOWUP] erro tenant '+t.id+':',{error:e.message}) }
  }
  // Limpa registros com mais de 7 dias
  try {
    db.prepare("DELETE FROM wa_followup_sent WHERE sent_at < datetime('now','-7 days')").run()
  } catch(e) {}
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
    db.prepare("UPDATE orders SET status=? WHERE id=? AND tenant_id=?").run(new_status,order_id,tid)
    const updated = db.prepare("SELECT * FROM orders WHERE id=? AND tenant_id=?").get(order_id,tid)
    emit(tid,'orders',parseRow('orders',updated),'UPDATE')
    send(res,200,{ok:true,order:parseRow('orders',updated)})

    // ── PIX manual confirmado pelo gestor ─────────────────────────────────
    if (new_status === 'analise' && oldStatus === 'aguardando_pix' && order.pag === 'pix_manual') {
      setImmediate(async () => {
        try {
          const cfg    = db.prepare('SELECT evo_instance, evo_automacoes, order_num_offset, store_name FROM store_config WHERE tenant_id=?').get(tid)
          const _tnt   = db.prepare("SELECT segmento FROM tenants WHERE id=?").get(tid)
          const _seg   = _tnt?.segmento || 'restaurante'
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
          // Emojis baseados nos itens reais (açaí/pizza/etc.) em vez de fixo 🍳
          const _categPix    = detectarCategoriaPedido(items, _seg)
          const _emPrep      = _categPix.emojis[0]    // ex: 🍧 pra açaí, 🍕 pra pizza
          const _emProducao  = _categPix.emojis[1] || '🔥'
          const _emHeader    = _categPix.lojaEmoji
              const _pixOkVars = [
                `${_emHeader} *${lojaC}*\n${'-'.repeat(20)}\n\n✅ *PIX confirmado, ${_nomePOk}!*\n\nRecebemos seu pagamento do pedido *#${idStr}*! 🎉\n\n*Itens:*\n${(items||'').split(', ').map(i=>'• '+i).join('\n')}\n\n💰 *Total: R$ ${total}*\n\n${_emPrep} Já estamos preparando tudo com muito carinho!\n\n_Dúvidas? Estamos aqui! 😊_`,
                `${_emHeader} *${lojaC}*\n${'-'.repeat(20)}\n\n💚 *Pagamento recebido!*\n\nOi, *${_nomePOk}*! Seu PIX do pedido *#${idStr}* chegou certinho. Obrigado! 🙏\n\n*Itens:*\n${(items||'').split(', ').map(i=>'• '+i).join('\n')}\n\n💰 *Total: R$ ${total}*\n\n${_emProducao} A equipe já colocou a mão na massa!\n\n_Qualquer dúvida é só chamar! 😄_`,
                `${_emHeader} *${lojaC}*\n${'-'.repeat(20)}\n\n🚀 *Bora, ${_nomePOk}!*\n\nPagamento do pedido *#${idStr}* confirmado com sucesso! ✅\n\n*Itens:*\n${(items||'').split(', ').map(i=>'• '+i).join('\n')}\n\n💰 *Total: R$ ${total}*\n\n🔥 Seu pedido já entrou em produção. Em breve te avisamos quando estiver pronto!\n\n_Dúvidas? Responde aqui! 😊_`,
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
        const cfg    = db.prepare('SELECT cashback_config, evo_automacoes, evo_instance, fid_config, stamp_config, store_name FROM store_config WHERE tenant_id=?').get(tid)
        const inst   = cfg?.evo_instance || EVO_INST
        const auto   = (() => { try { return JSON.parse(cfg?.evo_automacoes||'{}') } catch { return {} } })()
        // CRÍTICO: declara `nome` aqui no escopo do bloco. Antes dessa correção,
        // todas as mensagens WA de cashback/pontos/carimbinho referenciavam `nome`
        // sem que ela estivesse declarada — ReferenceError silenciado pelo try/catch
        // → nenhuma mensagem chegava ao cliente.
        const nome   = (order.client || 'Cliente').split(' ')[0]
        // Detecta categoria do pedido pelos itens (açaí/pizza/hambúrguer/etc)
        // pra que os emojis das mensagens batam com o tipo de comida.
        const _tnt   = db.prepare("SELECT segmento FROM tenants WHERE id=?").get(tid)
        const _seg   = _tnt?.segmento || 'restaurante'
        const itemsStr = (() => { try { return (JSON.parse(order.items)||[]).map(i=>`${i.qty}x ${i.name}`).join(', ') } catch { return '' } })()
        const _categB  = detectarCategoriaPedido(itemsStr, _seg)
        const _lojaEmojiB = _categB.lojaEmoji  // ex: 🍧 açaí, 🍕 pizza, 🍔 hamb

        // ── Cashback ────────────────────────────────────
        const cbCfg  = (() => { try { return JSON.parse(cfg?.cashback_config||'{}') } catch { return {} } })()
        if (cbCfg.ativo && cbCfg.pct > 0 && order.phone) {
          const total  = parseFloat(order.total||0)
          const minPed = parseFloat(cbCfg.min_pedido||0)
          if (total >= minPed) {
            const credito = parseFloat((total * cbCfg.pct / 100).toFixed(2))
            // Phone clean: só dígitos, normalizado
            const phoneClean = order.phone.replace(/\D/g,'')
            const phone8     = phoneClean.slice(-8)
            // Match preciso: phone DEVE TERMINAR em phone8 (não conter no meio).
            // SQLite LIKE com sufixo: 'phone LIKE %XXXXXXXX' funciona com escape.
            const cust    = db.prepare("SELECT id, cashback_saldo FROM customers WHERE tenant_id=? AND substr(replace(replace(phone,'+',''),' ',''), -8) = ?").get(tid, phone8)
            if (cust) {
              db.prepare('UPDATE customers SET cashback_saldo=COALESCE(cashback_saldo,0)+? WHERE id=?').run(credito, cust.id)
              // Lê saldo real após o UPDATE pra evitar race condition
              const updated  = db.prepare('SELECT cashback_saldo FROM customers WHERE id=?').get(cust.id)
              const novoSaldo = parseFloat(parseFloat(updated?.cashback_saldo||0).toFixed(2))
              // WA cashback
              const cbAuto = auto['cashback'] || {}
              if (cbAuto.on !== false) {
                const lojaB   = cfg?.store_name || 'Restaurante'
                const msgPadrao = `${_lojaEmojiB} *${lojaB}*\n${'-'.repeat(20)}\n\n💰 *Cashback creditado!*\n\nOlá, *${nome}*! Você ganhou *R$ ${credito.toFixed(2).replace('.',',')}* de cashback.\n\n💳 Saldo atual: *R$ ${novoSaldo.toFixed(2).replace('.',',')}*\n\nUse no seu próximo pedido! 🛍️\n\n_Dúvidas? É só responder esta mensagem!_ 😊`
                const msgFinal  = cbAuto.on && cbAuto.msg ? fillVars(cbAuto.msg, { nome, credito: credito.toFixed(2).replace('.',','), saldo: novoSaldo.toFixed(2).replace('.',',') }) : msgPadrao
                setImmediate(async () => {
                  try {
                    const r = await sendWA(order.phone, msgFinal, inst)
                    if (r?.ok) log('📤', `WA cashback enviado → ${order.phone} (R$${credito})`)
                    else       log('⚠️', `WA cashback FALHOU → ${order.phone}:`, r?.error || 'sem detalhe')
                  } catch(e) { log('⚠️', `WA cashback ERROR → ${order.phone}:`, e.message) }
                })
              }
            } else {
              // Cliente não existe — cria com o crédito inicial.
              // Antes era INSERT OR IGNORE: se já existisse com mesmo phone exato (mas
              // com outro formato como sufixo), o crédito sumia. Agora UPSERT garante.
              db.prepare(`INSERT INTO customers (tenant_id,name,phone,cashback_saldo) VALUES (?,?,?,?)
                          ON CONFLICT(tenant_id,phone) DO UPDATE SET cashback_saldo=COALESCE(cashback_saldo,0)+excluded.cashback_saldo`)
                .run(tid, order.client||order.phone, phoneClean, credito)
              const cbAuto = auto['cashback'] || {}
              if (cbAuto.on !== false) {
                const lojaB2  = cfg?.store_name || 'Restaurante'
                const msgPadrao = `💰 *${nome}*, você ganhou *R$ ${credito.toFixed(2).replace('.',',')}* de cashback com seu pedido!\n\nSeu saldo total: *R$ ${credito.toFixed(2).replace('.',',')}*\nUse no seu próximo pedido! 🛍️`
                const msgFinal  = cbAuto.on && cbAuto.msg ? fillVars(cbAuto.msg, { nome, credito: credito.toFixed(2).replace('.',','), saldo: credito.toFixed(2).replace('.',',') }) : msgPadrao
                setImmediate(async () => {
                  try {
                    const r = await sendWA(order.phone, msgFinal, inst)
                    if (r?.ok) log('📤', `WA cashback (novo cliente) enviado → ${order.phone} (R$${credito})`)
                    else       log('⚠️', `WA cashback (novo cliente) FALHOU → ${order.phone}:`, r?.error || 'sem detalhe')
                  } catch(e) { log('⚠️', `WA cashback (novo cliente) ERROR → ${order.phone}:`, e.message) }
                })
              }
            }
            marcarDirty()
            log('💰', `Cashback R$${credito} creditado → ${order.phone} (pedido #${order_id})`)
          }
        }

        // ── Fidelidade pontos ────────────────────────────
        // Só roda se o gestor ATIVOU explicitamente o programa (ativo === true).
        // Antes usava fallback pts_por_real=10 quando o campo era undefined,
        // fazendo TODA loja enviar mensagem de "Você ganhou X pontos" mesmo
        // sem configurar fidelidade. Agora exige ativação consciente:
        //   1. ativo === true (gestor clicou no toggle e salvou)
        //   2. pts_por_real > 0
        // Lojas com config antiga sem campo "ativo" param de enviar até o
        // gestor reabrir o modal e clicar em "Salvar".
        const fidCfg     = (() => { try { return JSON.parse(cfg?.fid_config||'{}') } catch { return {} } })()
        const ptsPorReal = parseFloat(fidCfg.pts_por_real || 0)
        const fidAtivo   = fidCfg.ativo === true && ptsPorReal > 0
        if (fidAtivo && order.phone) {
          const phoneClean = order.phone.replace(/\D/g,'')
          const phone8 = phoneClean.slice(-8)
          let fid = db.prepare("SELECT id, pts, max_pts, name FROM fidelidade WHERE tenant_id=? AND substr(replace(replace(phone,'+',''),' ',''), -8) = ?").get(tid, phone8)
          // Se cliente nunca foi cadastrado em fidelidade, cria agora pra que possa pontuar.
          // Antes: pedido sem login no cardápio nunca pontuava porque ninguém criava o registro.
          if (!fid) {
            const meta = parseInt(fidCfg.meta_pts || 500)
            const insRes = db.prepare('INSERT OR IGNORE INTO fidelidade (tenant_id,name,phone,pts,max_pts,orders_count,resgates) VALUES (?,?,?,0,?,0,0)')
              .run(tid, order.client || phoneClean, phoneClean, meta)
            if (insRes.changes > 0) {
              log('⭐', `Fidelidade: criado automaticamente para ${order.phone} (sem cadastro prévio)`)
            }
            fid = db.prepare("SELECT id, pts, max_pts, name FROM fidelidade WHERE tenant_id=? AND substr(replace(replace(phone,'+',''),' ',''), -8) = ?").get(tid, phone8)
          }
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
                const msgPadrao  = `${_lojaEmojiB} *${lojaP2}*\n${'-'.repeat(20)}\n\n🏆 *Pontos de fidelidade!*\n\nOlá, *${nome}*! Você ganhou *${ptosGanhos} pontos* com seu pedido.\n\n🎯 Saldo atual: *${novosPts} pontos*\n${faltam > 0 ? `⏳ Faltam apenas *${faltam} pontos* para sua recompensa!` : '🎁 Você atingiu sua recompensa! Resgate no próximo pedido.'}\n\n_Dúvidas? É só responder esta mensagem!_ 😊`
                const msgFinal   = ptAuto.on && ptAuto.msg ? fillVars(ptAuto.msg, { nome, pontos_ganhos: String(ptosGanhos), pontos_total: String(novosPts), pontos_faltam: String(faltam) }) : msgPadrao
                setImmediate(async () => {
                  try {
                    const r = await sendWA(order.phone, msgFinal, inst)
                    if (r?.ok) log('📤', `WA pontos enviado → ${order.phone} (+${ptosGanhos}pts)`)
                    else       log('⚠️', `WA pontos FALHOU → ${order.phone}:`, r?.error || 'sem detalhe')
                  } catch(e) { log('⚠️', `WA pontos ERROR → ${order.phone}:`, e.message) }
                })
              }
            }
          }
        }
        // ── Cartão Fidelidade (Carimbinho) ─────────────
        const stampCfg = (() => { try { return JSON.parse(cfg?.stamp_config||'{}') } catch { return {} } })()
        if (stampCfg.ativo && order.phone) {
          const phoneCleanS = order.phone.replace(/\D/g,'')
          db.prepare(`INSERT INTO stamp_progress (tenant_id,phone,compras,ultimo_resgate)
            VALUES (?,?,1,0) ON CONFLICT(tenant_id,phone) DO UPDATE SET compras=compras+1`)
            .run(tid, phoneCleanS)
          log('🃏', `Carimbinho +1 → ${order.phone} (pedido #${order_id})`)

          // Notificação WhatsApp do carimbinho — antes não havia.
          // Lê o progresso REAL após o UPDATE pra calcular carimbos restantes
          // até a recompensa.
          try {
            const stAuto = auto['carimbinho'] || auto['stamp'] || {}
            if (stAuto.on !== false) {
              const prog = db.prepare('SELECT compras, ultimo_resgate FROM stamp_progress WHERE tenant_id=? AND phone=?').get(tid, phoneCleanS)
              const compras       = prog?.compras || 0
              const ultimoResgate = prog?.ultimo_resgate || 0
              const desdeResgate  = compras - ultimoResgate
              const meta          = parseInt(stampCfg.meta_compras || 10)
              const faltam        = Math.max(0, meta - desdeResgate)
              const elegivel      = desdeResgate >= meta
              // Texto da recompensa (se atingiu a meta)
              let recompensaTxt = '🎁 sua recompensa'
              const tipoR = stampCfg.recompensa_tipo || 'pedido_gratis'
              const valR  = parseFloat(stampCfg.recompensa_valor || 0)
              if (tipoR === 'pedido_gratis')      recompensaTxt = '🎁 *um pedido grátis*'
              else if (tipoR === 'frete_gratis')  recompensaTxt = '🚚 *frete grátis*'
              else if (tipoR === 'percent' && valR > 0) recompensaTxt = `🏷️ *${valR.toFixed(0).replace('.0','')}% de desconto*`
              else if (tipoR === 'fixo' && valR > 0)    recompensaTxt = `💵 *R$ ${valR.toFixed(2).replace('.',',')} de desconto*`
              // Visual dos carimbos: ● (cheio) ○ (vazio) limitado a 10 pra ficar legível no WA
              const limite = Math.min(meta, 10)
              const propCheios = Math.min(limite, Math.round((desdeResgate / meta) * limite))
              const carimbos   = '● '.repeat(propCheios).trim() + (propCheios < limite ? ' ' + '○ '.repeat(limite - propCheios).trim() : '')
              const lojaSt = cfg?.store_name || 'Restaurante'
              const msgPadrao = elegivel
                ? `${_lojaEmojiB} *${lojaSt}*\n${'-'.repeat(20)}\n\n🎉 *Parabéns, ${nome}!*\n\nVocê completou seu cartão fidelidade!\n\n${carimbos}\n\nGanhou ${recompensaTxt}!\n\nÉ só pedir no próximo pedido que aplicamos automaticamente. 😋`
                : `${_lojaEmojiB} *${lojaSt}*\n${'-'.repeat(20)}\n\n🃏 *Carimbo conquistado!*\n\nOlá, *${nome}*! Mais um carimbo no seu cartão fidelidade:\n\n${carimbos}\n\n${desdeResgate}/${meta} carimbos\n⏳ Faltam *${faltam}* para ganhar ${recompensaTxt}!\n\n_Continua comprando com a gente! 💚_`
              const msgFinal  = stAuto.on && stAuto.msg ? fillVars(stAuto.msg, {
                nome,
                carimbos: String(desdeResgate),
                meta: String(meta),
                faltam: String(faltam),
                recompensa: recompensaTxt.replace(/\*/g, '')
              }) : msgPadrao
              setImmediate(async () => {
                try {
                  const r = await sendWA(order.phone, msgFinal, inst)
                  if (r?.ok) log('📤', `WA carimbinho enviado → ${order.phone} (${desdeResgate}/${meta})`)
                  else       log('⚠️', `WA carimbinho FALHOU → ${order.phone}:`, r?.error || 'sem detalhe')
                } catch(e) { log('⚠️', `WA carimbinho ERROR → ${order.phone}:`, e.message) }
              })
            }
          } catch(stErr) { log('⚠️', 'Notif carimbinho erro:', stErr.message) }
        }
      } catch(cbErr) { log('⚠️', 'Cashback/Fidelidade/Stamp erro:', cbErr.message, '|', cbErr.stack?.split('\n')[1]?.trim() || '') }
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
          // Formata cada item com seus adicionais (kit, meio-meio, grupos como TEMPERADO,
          // obs livre). Antes mostrava só "qty x nome" — cliente não via o que escolheu.
          // Formato do obs: "Forma de preparo: X | TEMPERADO: a, b | Kit: it1 · it2 | obs livre"
          const items = (()=>{
            try {
              return (JSON.parse(order.items)||[]).map(i => {
                let linha = `• ${i.qty}x ${i.name}`
                const obs = String(i.obs||'').trim()
                if (!obs) return linha
                const partes = obs.split(' | ').map(s => s.trim()).filter(Boolean)
                const detalhes = []
                for (const p of partes) {
                  // "Kit: a · b" → lista os itens do kit
                  if (/^kit\s*:/i.test(p)) {
                    const itensKit = p.replace(/^kit\s*:\s*/i, '').split(' · ').filter(Boolean)
                    if (itensKit.length) detalhes.push('  _Inclui:_ ' + itensKit.join(', '))
                  }
                  // "Meio a meio · sabor1 + sabor2"
                  else if (/^meio a meio/i.test(p)) {
                    const sabores = p.replace(/^meio a meio\s*·?\s*/i, '').trim()
                    if (sabores) detalhes.push('  _½ + ½:_ ' + sabores)
                  }
                  // "Nome do grupo: opção1, opção2" (TEMPERADO, Adicionais, etc.)
                  else if (/^[^:]{1,40}:/.test(p)) {
                    detalhes.push('  ↳ ' + p)
                  }
                  // Obs livre digitada pelo cliente
                  else {
                    detalhes.push('  _Obs:_ ' + p)
                  }
                }
                return detalhes.length ? linha + '\n' + detalhes.join('\n') : linha
              }).join('\n')
            } catch { return '' }
          })()
          // Detecta tipo de entrega real do pedido. Antes só olhava Mesa/Balcão e
          // qualquer outra coisa (incluindo "Retirada — [Filial]") caía em Entrega,
          // fazendo o cliente que pediu pra retirar receber mensagem de entrega.
          const _addrLower = (order.addr||'').toLowerCase()
          const isDelivery = (order.addr||'').includes('Mesa')
                ? '🪴 Mesa'
                : /^retirada\b/i.test(order.addr||'') || _addrLower.includes('balc')
                  ? '🏪 Retirada'
                  : '🛵 Entrega'
          const total = (parseFloat(order.total||0)+parseFloat(order.taxa||0)).toFixed(2).replace('.',',')
          const vars  = {nome,id:idStr,itens:items,total,endereco:order.addr||'',mesa:String(order.mesa_num||''),tipo_entrega:isDelivery,loja}
          const tipoAuto = {analise:'recebido',producao:'confirmado',pronto:'pronto',saiu:'entrega',entregue:'entrega',cancelado:'cancelado',finalizado:'avaliacao'}[new_status]
          const ct = tipoAuto?(auto[tipoAuto]||{}):{} 
          // Emojis por categoria do pedido (detecta açaí/pizza/hambúrguer/etc
          // pelos itens; se não bater nada, cai em emojis genéricos de restaurante).
          const _categ      = detectarCategoriaPedido(items, _seg)
          const _lojaEmoji  = _categ.lojaEmoji
          const cab = `${_lojaEmoji} *${loja}*\n${'-'.repeat(20)}`
          const rod = '\n\n_Dúvidas? É só responder esta mensagem!_ 😊'
          const _emojisComida = _categ.emojis
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
              // Adiciona ao set ANTES do setTimeout para bloquear duplicações imediatas
              if (processed.has(_pkey)) return
              processed.add(_pkey)
              log('⏳',`Avaliação agendada em ${min}min para #${idStr}`)
              setTimeout(async()=>{ const cfgNow=db.prepare("SELECT evo_automacoes FROM store_config WHERE tenant_id=?").get(tid); if((jsonParse(cfgNow?.evo_automacoes)||{})['avaliacao']?.on===false) { processed.delete(_pkey); return } await sendWA(order.phone,msgFinal,inst) },min*60*1000)
            } else {
              // Marca ANTES do await para evitar race condition entre cliques duplos no gestor:
              // se 2 POSTs /api/order-status chegam em paralelo, ambos leem oldStatus='pronto',
              // passariam pelo check antigo simultaneamente e enviariam o WA duas vezes.
              if (processed.has(_pkey)) return
              processed.add(_pkey)
              try {
                const r = await sendWA(order.phone, msgFinal, inst)
                if (!r.ok) processed.delete(_pkey) // se falhou, permite retry
              } catch(_) { processed.delete(_pkey) }
            }
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
// Pausa da IA — agora persistente no banco (ia_pausa) pra sobreviver
// a reinícios do servidor. A interface é compatível com Map (.set/.get/.keys/.size)
// pra não quebrar o resto do código que já usa essa variável.
const _pausaHumano = {
  set(key, ts) {
    // key vem como "pausa:tenantId:phone" — extrai os 2 últimos pedaços
    const parts = String(key).split(':')
    if (parts.length < 3) return
    const phone = parts.pop(); const tid = parts.pop()
    try {
      db.prepare('INSERT INTO ia_pausa (tenant_id,phone,pausado_em) VALUES (?,?,?) ON CONFLICT(tenant_id,phone) DO UPDATE SET pausado_em=excluded.pausado_em')
        .run(tid, phone, Math.floor(ts))
    } catch (e) { log('⚠️','[PAUSA] erro ao gravar:', e.message) }
  },
  get(key) {
    const parts = String(key).split(':')
    if (parts.length < 3) return undefined
    const phone = parts.pop(); const tid = parts.pop()
    try {
      const row = db.prepare('SELECT pausado_em FROM ia_pausa WHERE tenant_id=? AND phone=?').get(tid, phone)
      return row?.pausado_em
    } catch { return undefined }
  },
  delete(key) {
    const parts = String(key).split(':')
    if (parts.length < 3) return
    const phone = parts.pop(); const tid = parts.pop()
    try { db.prepare('DELETE FROM ia_pausa WHERE tenant_id=? AND phone=?').run(tid, phone) } catch {}
  },
  // Usados só pelo log de debug
  keys() {
    try {
      return db.prepare('SELECT tenant_id, phone FROM ia_pausa ORDER BY pausado_em DESC LIMIT 20').all()
        .map(r => `pausa:${r.tenant_id}:${r.phone}`)
    } catch { return [] }
  },
  get size() {
    try { return db.prepare('SELECT COUNT(*) AS c FROM ia_pausa').get().c } catch { return 0 }
  },
}

// Limpa pausas mais antigas que 24h (gestor com pausaMin máximo de 12h aprox)
// Roda a cada 1h pra não inchar a tabela com pausas já vencidas.
setInterval(() => {
  try {
    const cutoff = Date.now() - 24*60*60*1000
    const r = db.prepare('DELETE FROM ia_pausa WHERE pausado_em < ?').run(cutoff)
    if (r.changes > 0) log('🧹', `[PAUSA] Limpou ${r.changes} pausa(s) antiga(s) do banco`)
  } catch {}
}, 60*60*1000)
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
    const msgId  = body?.data?.key?.id || null  // usado pra marcar como lida (visto azul)
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
    // Chave OpenAI não é mais necessária — IA usa roteador determinístico.
    // Mantemos apenas configs de buffer/quebra/pausa que ainda fazem sentido.
    const bufferSeg=iaG.buffer_seg||3, quebraLen=iaG.quebra_linha||0, pausaMin=iaG.pausa_min||30
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
    const msgs    = _msgBuffer.has(bufKey) ? _msgBuffer.get(bufKey).msgs    : []
    const msgIds  = _msgBuffer.has(bufKey) ? _msgBuffer.get(bufKey).msgIds  : []
    msgs.push(msg)
    if (msgId) msgIds.push(msgId)
    const timer = setTimeout(async () => {
      _msgBuffer.delete(bufKey)
      const pausaNow=_pausaHumano.get(pausaKey)
      if (pausaNow&&(Date.now()-pausaNow)<pausaMin*60*1000) { log('🔇',`IA bloqueada no timer (humano assumiu durante buffer) — ${phone} [${tenantId}]`); return }
      log('🔍', `[PAUSA-DEBUG] Timer — pausaKey: "${pausaKey}" | pausaNow: ${pausaNow || 'NÃO ENCONTRADO'} — IA vai responder`)
      const msgFull=msgs.join('\n'), inst=cfg.evo_instance||EVO_INST, nomeLoja=cfg.store_name||'Restaurante'

      // ── DETECÇÃO DE MENSAGEM SENSÍVEL ─────────────────────────────────
      // Tópicos onde a IA SEMPRE alucina ou piora a situação: reclamações,
      // pedido de reembolso, problemas com pagamento, ameaças de processo.
      // Nesses casos, melhor pausar a IA e avisar que um atendente humano
      // vai responder. Isso evita respostas erradas e protege o relacionamento
      // com o cliente.
      const _msgLower = msgFull.toLowerCase()
      const _palavrasReembolso = /\b(reembolso|estorno|devolu[çc][ãa]o|devolver|dinheiro\s+de\s+volta|quero\s+meu\s+dinheiro|me\s+devolva|estornar|me\s+ressarc|reclama[çc][ãa]o|procon|justi[çc]a|advogado|processar|processo)\b/i
      const _palavrasUrgencia = /\b(urgente|p[eé]ssimo|p[eé]ssima|horr[ií]vel|nojento|absurd|cad[eê]\s+meu|cancelei?\s+(meu|o)|fraude|golpe|enrolad)\b/i
      // Cliente pode estar frustrado mas a mensagem ser curta — checa por
      // sinais combinados: reclamação + valor R$ ou + reembolso + status pedido
      const _temReembolso = _palavrasReembolso.test(_msgLower)
      const _temUrgencia  = _palavrasUrgencia.test(_msgLower)

      if (_temReembolso || _temUrgencia) {
        log('⚠️', `[IA] Mensagem sensível detectada de ${phone} — pausando IA e avisando atendente humano. Motivo: ${_temReembolso ? 'reembolso/reclamação' : 'urgência/frustração'}`)
        // Pausa IA por 24h pra atendente humano resolver — não quer IA
        // tentando "ajudar" durante a resolução.
        _pausaHumano.set(pausaKey, Date.now())
        // Avisa o cliente que um atendente humano vai responder.
        const _msgPausa = _temReembolso
          ? 'Entendi sua mensagem. Vou chamar um atendente para te ajudar com isso pessoalmente. Em instantes alguém da loja vai te responder.'
          : 'Recebi sua mensagem. Um atendente vai te responder em instantes.'
        try {
          // Mesmo fluxo humano: marca como lida → pausa → digitando → envia
          if (msgId) await markAsRead(phone, msgId, inst)
          await sleep(800 + Math.floor(Math.random() * 1200))
          const _delayPausa = Math.min(6000, 1200 + Math.floor(Math.random()*800) + _msgPausa.length * 38)
          await sendWA(phone, _msgPausa, inst, _delayPausa)
          log('🤝', `[IA] Aviso de escalação enviado pra ${phone}`)
        } catch (e) { log('⚠️', `[IA] Falha ao enviar aviso de escalação: ${e.message}`) }
        // Avisa o gestor pelo SSE — aparece no painel WhatsApp como prioridade
        try {
          sseBroadcast(`wa-alerta:${tenantId}`, 'wa:atendimento_urgente', {
            phone,
            motivo: _temReembolso ? 'reembolso' : 'urgencia',
            mensagem: msgFull.slice(0, 200),
            timestamp: Date.now()
          })
        } catch {}
        // Salva no histórico pra contexto
        convHist.push({ role: 'user', content: msgFull }, { role: 'assistant', content: _msgPausa })
        if (convHist.length > 20) convHist.splice(0, convHist.length - 20)
        _msgBuffer.set(histKey, convHist)
        return
      }

      // ── Detecção: primeira msg do dia e saudação avulsa ──
      const _hoje = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Fortaleza'})).toISOString().split('T')[0]
      const _dayKey = `${tenantId}:${phone}`
      const _isPrimeiraMsgDia = _lastDayMsg.get(_dayKey) !== _hoje
      _lastDayMsg.set(_dayKey, _hoje)
      const _saudacaoRegex = /^\s*(oi|olá|ola|hey|hi|hello|bom\s*dia|boa\s*(tarde|noite)|e\s*a[ií]|eai|opa|salve|fala|alo|alô|tudo\s*bem|td\s*bem|blz|beleza)\s*[!.,?☺😊🙂👋🤗]*\s*$/i
      const _isSoSaudacao = _saudacaoRegex.test(msgFull.trim())
      const _horaAtual = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Fortaleza'})).getHours()
      const _saudacaoHora = _horaAtual >= 5 && _horaAtual < 12 ? 'Bom dia' : _horaAtual >= 12 && _horaAtual < 18 ? 'Boa tarde' : 'Boa noite'
      // ════════════════════════════════════════════════════════════════
      // ROTEADOR DETERMINÍSTICO (sem OpenAI)
      // ────────────────────────────────────────────────────────────────
      // A IA respondia QUALQUER pergunta via OpenAI, gerando padrão de
      // chatbot que faz o WhatsApp banir o número da loja. Agora ela
      // responde APENAS 4 coisas, sempre com texto curto e padronizado:
      //
      //   1. STATUS DO PEDIDO     (cliente citou pedido)
      //   2. CUPONS ATIVOS        ("cupom" / "promoção" / "desconto")
      //   3. HORÁRIO              ("que horas abrem" / "tão aberto")
      //   4. LINK DO CARDÁPIO     (saudação / primeira msg / "cardápio")
      //
      // Se a loja estiver FECHADA, qualquer resposta de saudação/cardápio
      // já inclui aviso "fechado, abrimos [próximo horário]" automatico.
      //
      // Para QUALQUER outro assunto, a IA fica em silêncio — o gestor
      // responde manualmente. Isso reduz drasticamente a interação
      // automatizada e evita banimento.
      // ════════════════════════════════════════════════════════════════
      const tenantRow=db.prepare("SELECT slug FROM tenants WHERE id=?").get(tenantId)
      const proto=req.headers['x-forwarded-proto']||'https', host=req.headers['host']||''
      const linkCardapio=`${proto}://${host}/index.html?slug=${tenantRow?.slug||tenantId}`
      const agora=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Fortaleza'})), diasSemana=['dom','seg','ter','qua','qui','sex','sab'], diaHoje=diasSemana[agora.getDay()], horaMin=agora.getHours()*60+agora.getMinutes()
      // ── Helpers para pedido ──
      const _offsetCfg = db.prepare("SELECT order_num_offset FROM store_config WHERE tenant_id=?").get(tenantId)
      const _iaOffset  = parseInt(_offsetCfg?.order_num_offset) || 0
      const _iaPedNum  = (p) => String(p.order_num || Math.max(1, p.id - _iaOffset)).padStart(3, '0')
      const _phone8    = phone.replace(/\D/g, '').slice(-8)
      const _tempoDecorrido = (ts) => {
        if (!ts) return ''
        const t = new Date(String(ts).includes('Z') ? ts : ts.replace(' ','T')+'Z').getTime()
        if (isNaN(t)) return ''
        const min = Math.floor((Date.now() - t) / 60000)
        if (min < 1) return 'agora há pouco'
        if (min < 60) return `há ${min}min`
        const h = Math.floor(min / 60), m = min % 60
        return m > 0 ? `há ${h}h${m}min` : `há ${h}h`
      }
      const _statusCurto = {
        aguardando_pix:    '⏳ Aguardando pagamento PIX',
        aguardando_cartao: '⏳ Aguardando pagamento (cartão)',
        analise:           '⏳ Em análise',
        producao:          '👨‍🍳 Em preparo',
        pronto:            '✅ Pronto para retirada/entrega',
        saiu:              '🛵 Saiu para entrega',
        entregue:          '🎉 Entregue',
        cancelado:         '❌ Cancelado — qualquer dúvida fale com a loja',
        finalizado:        '✅ Finalizado'
      }

      // ── Detecção de intenção ──
      const _msgL      = msgFull.toLowerCase()
      const _numMatch  = msgFull.match(/#\*?(\d{1,6})\*?/) || msgFull.match(/pedido\s*[*#]?\s*(\d{1,6})/i)
      const _kwPedido  = /\b(meu\s+pedido|pedido\s+(j[aá]|saiu|chegou|t[aá]|est[aá]|ainda|atrasou|atrasado|demorando|pronto|sair[aá]|sai)|status\s+(do\s+)?pedido|cad[eê]\s+(meu|o)\s+pedido|onde\s+(est[aá]|t[aá])\s+(meu|o)\s+pedido|quanto\s+(tempo|falta)|saiu\s+(da|para|pra)\s+entrega|j[aá]\s+saiu)\b/i
      const _kwCupom   = /\b(cupom|cupons|promo[çc][ãa]o|promo[çc][õo]es|desconto|descontos|oferta|ofertas)\b/i
      const _kwCardapio= /\b(card[aá]pio|menu|fome|pedir|fazer\s+pedido|quero\s+pedir|tem\s+o\s+que|t[ãa]o\s+servindo|pode\s+fazer)\b/i
      const _kwHorario = /\b(hor[aá]rio|que\s+horas?|que\s+hora|abre|abrem|fecha|fecham|fechou|fecharam|fechad|abriu|abriram|t[ãa]o?\s+aberto|est[ãa]o?\s+aberto|aberto\s+(agora|hoje)|funciona|funcionam|funcionando|atendem|atendendo|trabalha|trabalham|at[eé]\s+que\s+horas?|de\s+que\s+horas?)\b/i

      // ── Loja aberta? + próximo horário de abertura ──
      const horariosCfg = jsonParse(cfg.horarios_config) || {}
      const diaConfig = horariosCfg[diaHoje]
      let lojaAbertaAgora = cfg.store_open !== false
      let horarioHojeStr = null  // ex: "das 18h às 23h"
      if (diaConfig) {
        if (!diaConfig.ativo) lojaAbertaAgora = false
        else {
          const [ah, am] = (diaConfig.abertura||'00:00').split(':').map(Number)
          const [fh, fm] = (diaConfig.fechamento||'23:59').split(':').map(Number)
          lojaAbertaAgora = horaMin >= ah*60+am && horaMin <= fh*60+fm
          horarioHojeStr = `das ${diaConfig.abertura} às ${diaConfig.fechamento}`
        }
      }

      // Próximo horário de abertura (caso loja esteja fechada)
      // — usado tanto na resposta de "que horas abrem" quanto no aviso de
      //   "loja fechada" inserido em saudação/cardápio.
      const _diasNome = { dom:'domingo', seg:'segunda', ter:'terça', qua:'quarta', qui:'quinta', sex:'sexta', sab:'sábado' }
      let proxAberturaStr = null  // ex: "hoje às 18h" / "amanhã às 18h" / "sexta às 18h"
      if (Object.keys(horariosCfg).length) {
        const idxHoje = agora.getDay()
        for (let i = 0; i < 7; i++) {
          const idx = (idxHoje + i) % 7
          const dia = diasSemana[idx]
          const dc = horariosCfg[dia]
          if (!dc || !dc.ativo) continue
          const [ah, am] = (dc.abertura||'00:00').split(':').map(Number)
          const aberturaMin = ah*60 + am
          if (i === 0) {
            // Hoje — só conta se ainda não passou da abertura
            if (horaMin < aberturaMin) { proxAberturaStr = `hoje às ${dc.abertura}`; break }
          } else {
            const nome = i === 1 ? 'amanhã' : _diasNome[dia]
            proxAberturaStr = `${nome} às ${dc.abertura}`
            break
          }
        }
      }
      // Aviso curto de "fechado" pra prefixar respostas de cardápio/saudação
      const _avisoFechado = !lojaAbertaAgora
        ? `⚠️ No momento estamos fechados${proxAberturaStr ? ` — abrimos ${proxAberturaStr}` : ''}.`
        : ''

      // ── Helper: sorteia uma variação ──
      // Reduz padrão de bot — se a resposta da IA é sempre IDÊNTICA, fica
      // detectável. Cada intenção tem 3 variações; escolhemos uma aleatória.
      const _pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)]

      // ── Decisão: o que responder ──
      let resposta = null

      // [1] PEDIDO ─────────────────────────────────────────────
      if (_numMatch || _kwPedido.test(_msgL)) {
        let ped = null
        if (_numMatch) {
          const n = parseInt(_numMatch[1])
          const realId = n + _iaOffset
          ped = db.prepare("SELECT id,order_num,status,total,taxa,created_at FROM orders WHERE tenant_id=? AND id=?").get(tenantId, realId)
          if (!ped) ped = db.prepare("SELECT id,order_num,status,total,taxa,created_at FROM orders WHERE tenant_id=? AND order_num=?").get(tenantId, n)
          if (!ped) ped = db.prepare("SELECT id,order_num,status,total,taxa,created_at FROM orders WHERE tenant_id=? AND substr(replace(replace(phone,'+',''),' ',''), -8) = ? ORDER BY id DESC LIMIT 1").get(tenantId, _phone8)
        } else {
          // Sem número citado — pega o pedido mais recente do cliente
          ped = db.prepare("SELECT id,order_num,status,total,taxa,created_at FROM orders WHERE tenant_id=? AND substr(replace(replace(phone,'+',''),' ',''), -8) = ? ORDER BY id DESC LIMIT 1").get(tenantId, _phone8)
        }
        if (ped) {
          const pedNum = _iaPedNum(ped)
          const tot = (parseFloat(ped.total||0) + parseFloat(ped.taxa||0)).toFixed(2).replace('.', ',')
          const td = _tempoDecorrido(ped.created_at)
          const st = _statusCurto[ped.status] || ped.status
          const sufixoTempo = td ? ` — feito ${td}` : ''
          resposta = _pickOne([
            `Pedido *#${pedNum}*: ${st}\nTotal: R$ ${tot}${sufixoTempo}`,
            `*Pedido #${pedNum}* — ${st}\nValor: R$ ${tot}${sufixoTempo}`,
            `Seu pedido *#${pedNum}* está: ${st}\nTotal: R$ ${tot}${sufixoTempo}`
          ])
        } else {
          resposta = _pickOne([
            `Não localizei seu pedido. Pra fazer um novo: ${linkCardapio}`,
            `Não achei pedido recente seu. Confira o cardápio: ${linkCardapio}`,
            `Não encontrei pedido seu por aqui. Cardápio: ${linkCardapio}`
          ])
        }
      }
      // [2] CUPONS / PROMOÇÕES ─────────────────────────────────
      else if (_kwCupom.test(_msgL)) {
        const cupons = db.prepare("SELECT code,type,value,min_order FROM cupons WHERE tenant_id=? AND ativo=1 AND (expires_at IS NULL OR expires_at > datetime('now')) LIMIT 5").all(tenantId)
        if (cupons.length) {
          const lista = cupons.map(cp => {
            const desc = cp.type === 'percent' ? `${cp.value}%` : `R$ ${parseFloat(cp.value).toFixed(2).replace('.',',')}`
            const min = parseFloat(cp.min_order||0) > 0 ? ` (mín. R$ ${parseFloat(cp.min_order).toFixed(2).replace('.',',')})` : ''
            return `• *${cp.code}* — ${desc} de desconto${min}`
          }).join('\n')
          resposta = _pickOne([
            `Cupons ativos:\n${lista}\n\nFaça seu pedido: ${linkCardapio}`,
            `Temos esses cupons agora:\n${lista}\n\nCardápio: ${linkCardapio}`,
            `Cupons disponíveis:\n${lista}\n\nPra usar é só fazer o pedido: ${linkCardapio}`
          ])
        } else {
          resposta = _pickOne([
            `No momento não temos cupons ativos. Confira o cardápio: ${linkCardapio}`,
            `Sem cupons ativos por enquanto. Cardápio aqui: ${linkCardapio}`,
            `Agora não temos cupons. Dá uma olhada no cardápio: ${linkCardapio}`
          ])
        }
      }
      // [3] HORÁRIO DE FUNCIONAMENTO ───────────────────────────
      else if (_kwHorario.test(_msgL)) {
        if (lojaAbertaAgora && horarioHojeStr) {
          resposta = _pickOne([
            `Hoje funcionamos ${horarioHojeStr}. Estamos abertos agora ✅\nCardápio: ${linkCardapio}`,
            `Hoje atendemos ${horarioHojeStr}. Aberto agora ✅\nCardápio: ${linkCardapio}`,
            `Horário de hoje: ${horarioHojeStr}. Aberto agora ✅\n${linkCardapio}`
          ])
        } else if (horarioHojeStr && diaConfig?.ativo) {
          // Hoje atende mas está fora do horário (já fechou ou ainda não abriu)
          const fechSuffix = proxAberturaStr ? `\nNo momento estamos fechados — abrimos ${proxAberturaStr}.` : '\nNo momento estamos fechados.'
          resposta = _pickOne([
            `Hoje funcionamos ${horarioHojeStr}.${fechSuffix}\nCardápio: ${linkCardapio}`,
            `Atendemos hoje ${horarioHojeStr}.${proxAberturaStr ? `\nAgora estamos fechados — voltamos ${proxAberturaStr}.` : '\nNo momento estamos fechados.'}\nCardápio: ${linkCardapio}`,
            `Horário de hoje: ${horarioHojeStr}.${fechSuffix}\n${linkCardapio}`
          ])
        } else if (proxAberturaStr) {
          // Hoje não atende
          resposta = _pickOne([
            `Hoje estamos fechados.\nAbrimos ${proxAberturaStr}.\nCardápio: ${linkCardapio}`,
            `Hoje não atendemos.\nVoltamos ${proxAberturaStr}.\nCardápio: ${linkCardapio}`,
            `Fechado hoje. Abrimos ${proxAberturaStr}.\n${linkCardapio}`
          ])
        } else {
          // Sem config de horário no banco
          resposta = `Confira nosso cardápio: ${linkCardapio}`
        }
      }
      // [4] SAUDAÇÃO / PRIMEIRA MSG / CARDÁPIO ─────────────────
      else if (_isPrimeiraMsgDia || _isSoSaudacao || _kwCardapio.test(_msgL)) {
        const nomeLojaFmt = `*${nomeLoja}*`
        const aviso = _avisoFechado ? `\n${_avisoFechado}` : ''
        if (_isPrimeiraMsgDia || _isSoSaudacao) {
          resposta = _pickOne([
            `${_saudacaoHora}! Bem-vindo(a) ao ${nomeLojaFmt}.${aviso}\nConfira nosso cardápio: ${linkCardapio}`,
            `${_saudacaoHora}! Aqui é da ${nomeLojaFmt}.${aviso}\nNosso cardápio: ${linkCardapio}`,
            `${_saudacaoHora}! Que bom te ver por aqui.${aviso}\nDá uma olhada: ${linkCardapio}`
          ])
        } else {
          resposta = _pickOne([
            `${aviso ? aviso + '\n' : ''}Aqui está nosso cardápio: ${linkCardapio}`,
            `${aviso ? aviso + '\n' : ''}Cardápio: ${linkCardapio}`,
            `${aviso ? aviso + '\n' : ''}Confere nosso cardápio: ${linkCardapio}`
          ])
        }
      }
      // [5] OUTRAS MENSAGENS — SILÊNCIO ────────────────────────
      // Não responde. Deixa o atendente humano cuidar. Isso reduz
      // drasticamente o volume de mensagens automáticas e protege
      // contra banimento do número no WhatsApp.
      else {
        log('🔇', `[IA] Fora do escopo — silêncio | ${phone} [${tenantId}] | "${msgFull.slice(0, 80)}"`)
        return
      }

      // ── Envio ──
      try {
        // Quebra de linha por largura, se configurada
        if (quebraLen > 0 && resposta.length > quebraLen) {
          const words = resposta.split(' ')
          let linha = '', result = []
          for (const w of words) {
            if ((linha + ' ' + w).trim().length > quebraLen) { result.push(linha.trim()); linha = w }
            else linha = (linha + ' ' + w).trim()
          }
          if (linha) result.push(linha)
          resposta = result.join('\n')
        }

        // ── Fluxo humano: ler → pausar → digitar → enviar ──
        // 1) Marca a(s) mensagem(ns) como lida(s) — cliente vê o ✓✓ azul.
        //    Se cliente mandou várias msgs no buffer, marca todas.
        for (const id of msgIds) {
          await markAsRead(phone, id, inst)
        }
        // 2) Pausa curta de "leitura" — pessoa leu, agora vai pensar/digitar.
        //    Antes do "digitando..." aparecer, dá uns segundos pra parecer real.
        await sleep(800 + Math.floor(Math.random() * 1200))  // 0.8s–2.0s

        // 3) Delay humanizado ("digitando..." aparece e a msg chega no fim).
        //    Bot é detectado quando responde sempre com mesma latência.
        //    Aqui simulamos uma pessoa digitando: ~40ms por caractere, mais um
        //    tempo base de "leitura/pensamento", com variação aleatória.
        //    Cap em 6s pra não parecer travado.
        const _baseLeitura = 1200 + Math.floor(Math.random() * 800)  // 1.2s–2.0s
        const _porChar     = 35 + Math.floor(Math.random() * 15)      // 35-50ms
        const _humanDelay  = Math.min(6000, _baseLeitura + resposta.length * _porChar)

        await sendWA(phone, resposta, inst, _humanDelay)
        log('🤖', `IA → ${phone} (delay ${_humanDelay}ms): ${resposta.slice(0, 60).replace(/\n/g,' ')}`)
        convHist.push({ role: 'user', content: msgFull }, { role: 'assistant', content: resposta })
        if (convHist.length > 20) convHist.splice(0, convHist.length - 20)
        _msgBuffer.set(histKey, convHist)
      } catch (e) { log('❌', '[IA] erro envio:', e.message) }
    }, bufferSeg*1000)
    _msgBuffer.set(bufKey,{msgs,msgIds,timer})
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

  // ── Manifest PWA dinâmico para o garçom (por tenant) ──
  if(req.method==='GET'&&upath==='/api/manifest-garcom'){
    const tid=params.get('t')||params.get('tenant')||''
    const slug=params.get('slug')||''
    let t=null
    if(tid) t=db.prepare('SELECT id,nome,slug FROM tenants WHERE id=? AND ativo=1').get(tid)
    else if(slug) t=db.prepare('SELECT id,nome,slug FROM tenants WHERE slug=? AND ativo=1').get(slug)
    const cfg=t?db.prepare('SELECT store_name,store_logo_url FROM store_config WHERE tenant_id=?').get(t.id):null
    const nome=cfg?.store_name||t?.nome||'Garçom'
    const logo=cfg?.store_logo_url||'/favicon-garcom.png'
    const startSlug=t?.slug||slug||tid
    const startUrl=startSlug?`/garcom.html?t=${startSlug}`:`/garcom.html`
    const manifest={
      name:`${nome} — Garçom`,
      short_name:nome.length>12?nome.substring(0,12):nome,
      description:`App do garçom — ${nome}`,
      start_url:startUrl,
      display:'standalone',
      background_color:'#111113',
      theme_color:'#111113',
      orientation:'portrait-primary',
      icons:[
        {src:logo,sizes:'512x512',type:'image/png',purpose:'any maskable'}
      ]
    }
    res.writeHead(200,{'Content-Type':'application/manifest+json','Cache-Control':'no-cache'})
    res.end(JSON.stringify(manifest))
    return
  }
  if(req.method==='GET'&&upath==='/api/tenant-slug'){const tid=req.headers['x-tenant-id']||params.get('tenant_id')||'';if(!tid){send(res,400,{error:'x-tenant-id obrigatório'});return};const row=db.prepare('SELECT slug FROM tenants WHERE id=?').get(tid);send(res,200,{slug:row?.slug||''});return}
  if(req.method==='GET'&&upath==='/api/tenant-info-gestor'){const tid=req.headers['x-tenant-id']||params.get('tenant_id')||'';if(!tid){send(res,400,{error:'x-tenant-id obrigatório'});return};const row=db.prepare('SELECT id,nome,slug,plano,ativo,expires_at FROM tenants WHERE id=?').get(tid);if(!row){send(res,404,{error:'Tenant não encontrado'});return};send(res,200,row);return}

  // ── Histórico de pedidos (busca com filtros) ──
  if(req.method==='GET'&&upath==='/api/historico-pedidos'){
    const tid=req.headers['x-tenant-id']||params.get('tenant_id')||''
    if(!tid){send(res,400,{error:'x-tenant-id obrigatório'});return}
    const q=params.get('q')||'', status=params.get('status')||'', de=params.get('de')||'', ate=params.get('ate')||'', page=parseInt(params.get('page')||'1'), limit=parseInt(params.get('limit')||'50')
    let where='tenant_id=?', vals=[tid]
    if(status){where+=' AND status=?';vals.push(status)}
    if(de){where+=' AND created_at>=?';vals.push(de)}
    if(ate){where+=' AND created_at<=?';vals.push(ate+'T23:59:59.999Z')}
    if(q){where+=' AND (client LIKE ? OR phone LIKE ? OR id=? OR order_num=?)';vals.push(`%${q}%`,`%${q}%`,parseInt(q)||0,parseInt(q)||0)}
    const total=db.prepare(`SELECT COUNT(*) as cnt FROM orders WHERE ${where}`).get(...vals)?.cnt||0
    const rows=db.prepare(`SELECT id,order_num,client,phone,addr,items,total,taxa,pag,status,mesa_num,garcom_nome,created_at FROM orders WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...vals,limit,(page-1)*limit)
    rows.forEach(r=>{try{r.items=JSON.parse(r.items)}catch{}})
    send(res,200,{orders:rows,total,page,pages:Math.ceil(total/limit)})
    return
  }

  // ── Exportar relatório CSV completo ──
  if(req.method==='GET'&&upath==='/api/exportar-relatorio'){
    const tid=req.headers['x-tenant-id']||params.get('tenant_id')||''
    if(!tid){send(res,400,{error:'x-tenant-id obrigatório'});return}
    const de=params.get('de')||'', ate=params.get('ate')||''
    if(!de||!ate){send(res,400,{error:'Informe de e ate'});return}
    const orders=db.prepare(`SELECT id,order_num,client,phone,addr,items,total,taxa,pag,status,mesa_num,garcom_nome,created_at FROM orders WHERE tenant_id=? AND created_at>=? AND created_at<=? ORDER BY created_at ASC`).all(tid,de,ate+'T23:59:59.999Z')
    const movs=db.prepare(`SELECT id,description,tipo,val,pag,time,created_at FROM movimentos WHERE tenant_id=? AND created_at>=? AND created_at<=? ORDER BY created_at ASC`).all(tid,de,ate+'T23:59:59.999Z')
    const contas=db.prepare(`SELECT id,descricao,valor,vencimento,categoria,status,pago_em FROM contas_pagar WHERE tenant_id=? AND vencimento>=? AND vencimento<=? ORDER BY vencimento ASC`).all(tid,de,ate)
    orders.forEach(r=>{try{r.items=JSON.parse(r.items)}catch{}})
    send(res,200,{orders,movimentos:movs,contas_pagar:contas})
    return
  }

  if(upath==='/status'){send(res,200,{ok:true,uptime:Math.floor(process.uptime()),db:'sqlite-multitenant',version:'4.0.0',backup:fs.existsSync(BACKUP_PATH)?fs.statSync(BACKUP_PATH).mtime:null});return}
  if(req.method==='POST'&&upath==='/api/order-status'){await handleOrderStatus(req,res);return}

  // ── Adicionais esgotados (global por tenant) ─────────────
  // Normaliza nome (lowercase + trim + sem acento) para garantir match independente de digitação
  const _normAddon = (s) => String(s||'').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  if(upath==='/api/addons-esgotados'){
    const tid=req.headers['x-tenant-id']||params.get('tenant_id')||''
    if(!tid){send(res,400,{error:'x-tenant-id obrigatório'});return}
    if(req.method==='GET'){
      // Público — qualquer um pode consultar (cardápio precisa)
      const rows=db.prepare('SELECT nome_norm,nome_original FROM addons_esgotados WHERE tenant_id=?').all(tid)
      send(res,200,{esgotados:rows.map(r=>r.nome_norm),items:rows});return
    }
    if(req.method==='POST'){
      const body=await readBody(req)
      const nome=String(body.nome||'').trim()
      if(!nome){send(res,400,{error:'nome obrigatório'});return}
      const norm=_normAddon(nome)
      db.prepare('INSERT OR IGNORE INTO addons_esgotados (tenant_id,nome_norm,nome_original) VALUES (?,?,?)').run(tid,norm,nome)
      emit(tid,'addons_esgotados',{nome_norm:norm,nome_original:nome},'INSERT')
      marcarDirty();send(res,200,{ok:true,nome_norm:norm});return
    }
    if(req.method==='DELETE'){
      const nome=params.get('nome')||(await readBody(req).catch(()=>({}))).nome||''
      if(!nome){send(res,400,{error:'nome obrigatório'});return}
      const norm=_normAddon(nome)
      db.prepare('DELETE FROM addons_esgotados WHERE tenant_id=? AND nome_norm=?').run(tid,norm)
      emit(tid,'addons_esgotados',{nome_norm:norm},'DELETE')
      marcarDirty();send(res,200,{ok:true});return
    }
  }

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
    // Atômico: só decrementa se o saldo ainda for >= valor (evita race condition)
    const info = db.prepare('UPDATE customers SET cashback_saldo=cashback_saldo-? WHERE id=? AND tenant_id=? AND cashback_saldo>=?').run(valor, cust.id, tid, valor)
    if (info.changes === 0) {
      const atual = db.prepare('SELECT cashback_saldo FROM customers WHERE id=?').get(cust.id)
      send(res, 400, { error: 'Saldo insuficiente', saldo: parseFloat(atual?.cashback_saldo||0) })
      return
    }
    const updated = db.prepare('SELECT cashback_saldo FROM customers WHERE id=?').get(cust.id)
    marcarDirty();send(res,200,{ok:true,saldo_restante:parseFloat(updated?.cashback_saldo||0)});return
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

  // ── Cartão Fidelidade (Carimbinho) ──────────────────
  if (upath === '/api/stamp/config') {
    const tid = req.headers['x-tenant-id'] || ''
    if (!tid) { send(res, 400, { error: 'tenant_id obrigatório' }); return }
    if (req.method === 'GET') {
      const row = db.prepare('SELECT stamp_config FROM store_config WHERE tenant_id=?').get(tid)
      const cfg = (() => { try { return JSON.parse(row?.stamp_config||'{}') } catch { return {} } })()
      send(res, 200, cfg); return
    }
    if (req.method === 'POST') {
      const body = await readBody(req)
      db.prepare('INSERT INTO store_config (tenant_id,stamp_config) VALUES (?,?) ON CONFLICT(tenant_id) DO UPDATE SET stamp_config=excluded.stamp_config')
        .run(tid, JSON.stringify(body))
      marcarDirty(); send(res, 200, { ok: true }); return
    }
  }

  if (req.method === 'GET' && upath === '/api/stamp/check') {
    const tid   = req.headers['x-tenant-id'] || ''
    const phone = (params.phone || '').replace(/\D/g,'')
    if (!tid || !phone) { send(res, 400, { error: 'tenant_id e phone obrigatórios' }); return }
    const row = db.prepare('SELECT stamp_config FROM store_config WHERE tenant_id=?').get(tid)
    const cfg = (() => { try { return JSON.parse(row?.stamp_config||'{}') } catch { return {} } })()
    if (!cfg.ativo || !cfg.meta_compras) { send(res, 200, { ativo: false }); return }
    const phone8 = phone.slice(-8)
    const prog = db.prepare('SELECT compras, ultimo_resgate FROM stamp_progress WHERE tenant_id=? AND phone LIKE ?').get(tid, `%${phone8}%`)
    const compras = prog?.compras || 0
    const ultimoResgate = prog?.ultimo_resgate || 0
    const comprasDesdeResgate = compras - ultimoResgate
    const meta = parseInt(cfg.meta_compras || 10)
    const elegivel = comprasDesdeResgate >= meta
    send(res, 200, {
      ativo: true,
      compras: comprasDesdeResgate,
      meta,
      elegivel,
      recompensa_tipo: cfg.recompensa_tipo || 'pedido_gratis',
      recompensa_valor: parseFloat(cfg.recompensa_valor || 0)
    }); return
  }

  if (req.method === 'POST' && upath === '/api/stamp/usar') {
    const tid  = req.headers['x-tenant-id'] || ''
    const body = await readBody(req)
    const phone = (body.phone || '').replace(/\D/g,'')
    if (!tid || !phone) { send(res, 400, { error: 'tenant_id e phone obrigatórios' }); return }
    const phone8 = phone.slice(-8)
    db.prepare(`INSERT INTO stamp_progress (tenant_id,phone,compras,ultimo_resgate) VALUES (?,?,0,0)
      ON CONFLICT(tenant_id,phone) DO UPDATE SET ultimo_resgate=compras`)
      .run(tid, phone)
    marcarDirty(); send(res, 200, { ok: true }); return
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

  // ── Cupom: validação server-side (anti-fraude) ──────────────
  // Frontend valida e calcula desconto, mas pode ser burlado. Este endpoint
  // (a) confirma que o cupom existe, está ativo, não expirado e tem usos disponíveis
  // (b) decrementa uses_left atomicamente quando consume=true (chamado ao criar pedido)
  // (c) retorna os dados oficiais (type, value, min_order) pra que o frontend recalcule
  if (req.method === 'POST' && upath === '/api/cupom/validar') {
    const tid  = req.headers['x-tenant-id'] || ''
    const body = await readBody(req)
    const code = (body.code || '').trim().toUpperCase()
    const consume = !!body.consume
    const subtotal = parseFloat(body.subtotal || 0)
    if (!tid || !code) { send(res, 400, { ok:false, error:'tenant_id e code obrigatórios' }); return }
    try {
      const cup = db.prepare(`SELECT id, code, type, value, min_order, uses_left, ativo, expires_at FROM cupons
        WHERE tenant_id=? AND UPPER(code)=? AND ativo=1`).get(tid, code)
      if (!cup) { send(res, 200, { ok:false, error:'Cupom inválido' }); return }
      // Expiração
      if (cup.expires_at && String(cup.expires_at).trim()) {
        const exp = new Date(String(cup.expires_at).replace(' ', 'T') + (String(cup.expires_at).includes('Z') ? '' : 'Z'))
        if (!isNaN(exp.getTime()) && exp.getTime() < Date.now()) {
          send(res, 200, { ok:false, error:'Cupom expirado' }); return
        }
      }
      // Pedido mínimo
      if (cup.min_order && subtotal && subtotal < parseFloat(cup.min_order)) {
        send(res, 200, { ok:false, error:`Pedido mínimo de R$ ${parseFloat(cup.min_order).toFixed(2)}`, min_order: parseFloat(cup.min_order) }); return
      }
      // Usos disponíveis
      const usesLeft = (cup.uses_left === null || cup.uses_left === undefined) ? -1 : parseInt(cup.uses_left)
      if (usesLeft !== -1 && usesLeft <= 0) {
        send(res, 200, { ok:false, error:'Cupom esgotado' }); return
      }
      // Se for pra consumir, decrementa atomicamente (só se ainda houver usos)
      if (consume && usesLeft !== -1) {
        const upd = db.prepare('UPDATE cupons SET uses_left=uses_left-1 WHERE id=? AND tenant_id=? AND uses_left>0').run(cup.id, tid)
        if (upd.changes === 0) {
          // Outro pedido consumiu o último uso entre o SELECT e o UPDATE
          send(res, 200, { ok:false, error:'Cupom esgotado' }); return
        }
        marcarDirty()
        log('🎟️', `Cupom ${cup.code} usado (tenant=${tid}, restam ${usesLeft - 1})`)
      }
      send(res, 200, {
        ok: true,
        code: cup.code,
        type: cup.type,
        value: parseFloat(cup.value || 0),
        min_order: parseFloat(cup.min_order || 0),
        uses_left: usesLeft === -1 ? -1 : (consume ? usesLeft - 1 : usesLeft)
      })
      return
    } catch(e) {
      log('❌', '/api/cupom/validar erro:', e.message)
      send(res, 500, { ok:false, error:'Erro interno' }); return
    }
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
  const _specialApis=new Set(['/api/tenant-info','/api/manifest-garcom','/api/tenant-slug','/api/tenant-info-gestor','/api/order-status','/api/addons-esgotados','/api/customer-register','/api/customer-login','/api/customer-orders','/api/tempo-estimado','/api/criar-tenant','/api/backup','/api/restore','/api/admin-login','/api/admin-logout','/api/ia-humano-assumiu','/api/rastreio-wa','/api/backup-completo-gestor','/api/pix/criar','/api/pix/status','/api/pix/vincular','/api/pix/config','/api/pix/gestor-config','/api/carteira','/api/saques/solicitar','/api/saques/meus','/api/admin/saques','/api/admin/saques/atualizar','/api/admin/mp-config','/api/gestor/mp-config','/api/admin/pix-toggle','/api/cashback/config','/api/cashback/saldo','/api/cashback/usar','/api/cashback/ajustar','/api/stamp/config','/api/stamp/check','/api/stamp/usar','/api/fidelidade/sync','/api/cupom/validar','/api/cartao/criar','/api/cartao/status','/api/cartao/public-key','/api/garcom-login','/api/radio/send','/api/radio/garcons','/api/radio/messages','/api/radio/audio/','/api/tenant-segmento','/api/print','/api/printers','/api/print-queue/heartbeat','/api/print-queue/pending','/api/print-queue/status','/api/print-queue/job','/api/print-queue/pdf','/api/historico-pedidos','/api/exportar-relatorio'])
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


setInterval(checarAniv,60000)
setTimeout(checarAniv,5000)

setInterval(checarPedidoPerdido, 60000)
setTimeout(checarPedidoPerdido, 15000)

function shutdown(){fazerBackup(true);db.close();server.close();process.exit(0)}
process.on('SIGTERM',shutdown)
process.on('SIGINT',shutdown)

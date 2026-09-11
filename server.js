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
const { buildOrderTrackingMessage } = require('./order-message')
const phoneUtils = require('./phone-utils')

const PORT        = process.env.PORT           || 3001
const EVO_URL     = (process.env.EVOLUTION_URL || 'https://projeto-evolution-api.xtknqq.easypanel.host').replace(/\/+$/,'')
const EVO_KEY     = process.env.EVOLUTION_KEY  || '429683C4C977415CAAFCCE10F7D57E11'
const EVO_INST    = process.env.EVOLUTION_INST || 'estima-food'
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.APP_URL || process.env.BASE_URL || 'https://estimafood.evocrm.sbs').replace(/\/+$/,'')
const LOCAL_DATA_DIR = path.join(__dirname, '.dev-data')
const DB_PATH     = process.env.DB_PATH        || (process.platform === 'win32' ? path.join(LOCAL_DATA_DIR, 'estima.db') : '/app/data/estima.db')
const MP_TOKEN    = process.env.MP_ACCESS_TOKEN || ''   // Token do Mercado Pago (prod ou test)
const TAXA_PIX    = parseFloat(process.env.TAXA_PIX || '1.00')  // R$1,00 fixo por pagamento
const UPLOADS_DIR = process.env.UPLOADS_DIR    || (process.platform === 'win32' ? path.join(LOCAL_DATA_DIR, 'uploads') : '/app/data/uploads')
// Ícones padrão de açougue customizados pelo admin ficam aqui — dentro do
// volume persistente /app/data, e não em cardapio/img (que faz parte do
// código-fonte e é sobrescrito a cada deploy).
const ICONES_PADRAO_DIR = path.join(UPLOADS_DIR, 'icones-padrao')
const BACKUP_PATH = path.join(path.dirname(DB_PATH), 'backup.json')

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
fs.mkdirSync(UPLOADS_DIR, { recursive: true })
fs.mkdirSync(ICONES_PADRAO_DIR, { recursive: true })

function log(emoji, msg, data) {
  const t = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
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
// Sem isso, quando duas escritas chegam quase juntas (ex: dois dispositivos
// salvando ao mesmo tempo), a segunda falha na hora com "database is locked"
// em vez de simplesmente esperar a primeira terminar (que leva milissegundos)
// e seguir normalmente. 5s é bem mais que suficiente pra qualquer escrita
// individual — só evita a falha de corrida entre dispositivos.
db.pragma('busy_timeout = 5000')

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
    store_tempo_retirada TEXT DEFAULT '30-40 min',
    store_avaliacao TEXT DEFAULT '5.0',
    store_whatsapp TEXT, gestor_tema TEXT,
    order_auto_reset_daily INTEGER DEFAULT 0,
    order_auto_reset_last_date TEXT
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
    fiscal_ncm TEXT, fiscal_cfop TEXT, fiscal_icms_origem TEXT,
    fiscal_icms_situacao TEXT, fiscal_cest TEXT, fiscal_unidade TEXT,
    fiscal_codigo_produto TEXT, fiscal_pis_situacao TEXT, fiscal_cofins_situacao TEXT,
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
    taxa_servico REAL DEFAULT 0,
    clientes_json TEXT DEFAULT '[]',
    pagamentos_json TEXT DEFAULT '[]',
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
    client_request_id TEXT,
    session_ref TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS fiscal_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    enabled INTEGER DEFAULT 0,
    ambiente TEXT DEFAULT 'homologacao',
    emit_mode TEXT DEFAULT 'fechamento',
    token_homologacao TEXT,
    token_producao TEXT,
    cnpj_emitente TEXT,
    inscricao_estadual_emitente TEXT,
    regime_tributario_emitente TEXT DEFAULT '1',
    nome_emitente TEXT,
    nome_fantasia_emitente TEXT,
    telefone_emitente TEXT,
    logradouro_emitente TEXT,
    numero_emitente TEXT,
    bairro_emitente TEXT,
    municipio_emitente TEXT,
    uf_emitente TEXT DEFAULT 'CE',
    cep_emitente TEXT,
    csc_id TEXT,
    csc_token TEXT,
    serie TEXT,
    proximo_numero INTEGER,
    natureza_operacao TEXT DEFAULT 'VENDA AO CONSUMIDOR',
    ncm_padrao TEXT,
    cfop_padrao TEXT DEFAULT '5102',
    icms_origem_padrao TEXT DEFAULT '0',
    icms_situacao_padrao TEXT DEFAULT '102',
    unidade_padrao TEXT DEFAULT 'UN',
    updated_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS fiscal_nfce (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    origem_tipo TEXT DEFAULT 'order',
    origem_id TEXT,
    order_id INTEGER,
    mesa_num INTEGER,
    session_ref TEXT,
    referencia TEXT NOT NULL,
    ambiente TEXT DEFAULT 'homologacao',
    status TEXT DEFAULT 'pendente',
    total REAL DEFAULT 0,
    forma_pagamento TEXT,
    payload_json TEXT DEFAULT '{}',
    response_json TEXT DEFAULT '{}',
    chave_nfe TEXT,
    numero TEXT,
    serie TEXT,
    protocolo TEXT,
    caminho_xml TEXT,
    caminho_danfe TEXT,
    qr_code TEXT,
    mensagem TEXT,
    emitted_at TEXT,
    canceled_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(tenant_id, referencia)
  );
  CREATE INDEX IF NOT EXISTS idx_fiscal_nfce_tenant_status ON fiscal_nfce(tenant_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_fiscal_nfce_origem ON fiscal_nfce(tenant_id, origem_tipo, origem_id);
  CREATE TABLE IF NOT EXISTS chat_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id INTEGER NOT NULL,
    order_num INTEGER,
    client TEXT,
    phone TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    last_message TEXT,
    last_sender TEXT,
    last_at TEXT DEFAULT (datetime('now')),
    unread_store INTEGER DEFAULT 0,
    unread_client INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(tenant_id, order_id)
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    order_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    author_name TEXT,
    body TEXT NOT NULL,
    kind TEXT DEFAULT 'text',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS order_chat_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id INTEGER NOT NULL,
    order_num INTEGER,
    client TEXT,
    phone TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    last_message TEXT,
    last_sender TEXT,
    last_at TEXT DEFAULT (datetime('now')),
    unread_store INTEGER DEFAULT 0,
    unread_client INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS order_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    thread_id INTEGER NOT NULL REFERENCES order_chat_threads(id) ON DELETE CASCADE,
    order_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    author_name TEXT,
    body TEXT NOT NULL,
    kind TEXT DEFAULT 'text',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS order_chat_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    thread_id INTEGER NOT NULL REFERENCES order_chat_threads(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    client TEXT,
    items TEXT DEFAULT '[]',
    delivery_type TEXT,
    addr TEXT,
    pag TEXT,
    step TEXT DEFAULT 'items',
    status TEXT DEFAULT 'draft',
    meta TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(tenant_id, thread_id)
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
  CREATE TABLE IF NOT EXISTS admin_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT DEFAULT 'aviso',
    titulo TEXT,
    mensagem TEXT NOT NULL,
    display_mode TEXT DEFAULT 'banner',
    bg_color TEXT DEFAULT '',
    text_color TEXT DEFAULT '',
    font_family TEXT DEFAULT '',
    target_all INTEGER DEFAULT 1,
    target_tenants TEXT DEFAULT '[]',
    ativo INTEGER DEFAULT 1,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pix_tenant    ON pagamentos_pix(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_pix_status    ON pagamentos_pix(tenant_id, status);
  CREATE INDEX IF NOT EXISTS idx_saques_tenant ON saques(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_admin_alerts_ativo ON admin_alerts(ativo, created_at);
  CREATE INDEX IF NOT EXISTS idx_orders_tenant     ON orders(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(tenant_id, status);
  CREATE INDEX IF NOT EXISTS idx_orders_phone      ON orders(tenant_id, phone);
  CREATE INDEX IF NOT EXISTS idx_order_chat_threads_tenant_last ON order_chat_threads(tenant_id, last_at);
  CREATE INDEX IF NOT EXISTS idx_order_chat_threads_order ON order_chat_threads(tenant_id, order_id);
  CREATE INDEX IF NOT EXISTS idx_order_chat_threads_phone ON order_chat_threads(tenant_id, phone);
  CREATE INDEX IF NOT EXISTS idx_order_chat_messages_thread ON order_chat_messages(tenant_id, thread_id, id);
  CREATE INDEX IF NOT EXISTS idx_order_chat_drafts_thread ON order_chat_drafts(tenant_id, thread_id);
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
  { version:45, description:'orders.wa_track: cliente optou por receber atualizações do pedido via WhatsApp', up:
    `ALTER TABLE orders ADD COLUMN wa_track INTEGER DEFAULT 0`
  },
  { version:46, description:'Sistema de indicações com comissão recorrente (12 meses)', up:
    `CREATE TABLE IF NOT EXISTS indicadores (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       codigo TEXT NOT NULL UNIQUE,
       nome TEXT NOT NULL,
       email TEXT,
       phone TEXT,
       chave_pix TEXT,
       comissao_pct REAL NOT NULL DEFAULT 30.0,
       comissao_meses INTEGER NOT NULL DEFAULT 12,
       ativo INTEGER NOT NULL DEFAULT 1,
       observacoes TEXT,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
     );
     CREATE TABLE IF NOT EXISTS leads_indicacao (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       indicador_id INTEGER NOT NULL REFERENCES indicadores(id) ON DELETE CASCADE,
       nome_cliente TEXT NOT NULL,
       phone_cliente TEXT NOT NULL,
       nome_estabelecimento TEXT NOT NULL,
       segmento TEXT,
       cidade TEXT,
       observacoes TEXT,
       status TEXT NOT NULL DEFAULT 'novo',
       tenant_id_convertido TEXT REFERENCES tenants(id) ON DELETE SET NULL,
       data_conversao TIMESTAMP,
       valor_plano REAL DEFAULT 99.90,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
     );
     CREATE TABLE IF NOT EXISTS comissoes (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       indicador_id INTEGER NOT NULL REFERENCES indicadores(id) ON DELETE CASCADE,
       lead_id INTEGER NOT NULL REFERENCES leads_indicacao(id) ON DELETE CASCADE,
       mes_referencia TEXT NOT NULL,
       valor_pagamento REAL NOT NULL,
       comissao_valor REAL NOT NULL,
       status TEXT NOT NULL DEFAULT 'a_pagar',
       data_pagamento_indicador TIMESTAMP,
       observacoes TEXT,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       UNIQUE(lead_id, mes_referencia)
     );
     CREATE INDEX IF NOT EXISTS idx_leads_indicador ON leads_indicacao(indicador_id);
     CREATE INDEX IF NOT EXISTS idx_leads_status ON leads_indicacao(status);
     CREATE INDEX IF NOT EXISTS idx_comissoes_indicador ON comissoes(indicador_id);
     CREATE INDEX IF NOT EXISTS idx_comissoes_status ON comissoes(status);`
  },
  { version:47, description:'Acesso dos indicadores ao painel próprio', up:[
    `ALTER TABLE indicadores ADD COLUMN senha_hash TEXT`,
    `ALTER TABLE indicadores ADD COLUMN ultimo_acesso TIMESTAMP`,
    `CREATE TABLE IF NOT EXISTS indicador_sessions (
       token TEXT PRIMARY KEY,
       indicador_id INTEGER NOT NULL,
       nome TEXT,
       email TEXT,
       codigo TEXT,
       ts INTEGER NOT NULL
     )`
  ] },
  { version:48, description:'Tutorial dos indicadores com progresso', up:[
    `CREATE TABLE IF NOT EXISTS indicador_tutorial_videos (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       titulo TEXT NOT NULL,
       descricao TEXT,
       video_url TEXT NOT NULL,
       sort_order INTEGER DEFAULT 0,
       ativo INTEGER DEFAULT 1,
       created_at TEXT DEFAULT (datetime('now')),
       updated_at TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_ind_tut_videos_order ON indicador_tutorial_videos(ativo, sort_order, id)`,
    `CREATE TABLE IF NOT EXISTS indicador_tutorial_progress (
       indicador_id INTEGER NOT NULL REFERENCES indicadores(id) ON DELETE CASCADE,
       video_id INTEGER NOT NULL REFERENCES indicador_tutorial_videos(id) ON DELETE CASCADE,
       concluido INTEGER DEFAULT 0,
       completed_at TEXT,
       updated_at TEXT DEFAULT (datetime('now')),
       PRIMARY KEY (indicador_id, video_id)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_ind_tut_prog_ind ON indicador_tutorial_progress(indicador_id, video_id)`
  ] },
  { version:49, description:'Permissao do indicador criar login gestor', up:
    `ALTER TABLE indicadores ADD COLUMN pode_criar_gestor INTEGER DEFAULT 0`
  },
  { version:50, description:'tempo separado de retirada em store_config', up:
    `ALTER TABLE store_config ADD COLUMN store_tempo_retirada TEXT DEFAULT '30-40 min'`
  },
  { version:51, description:'comunicados do admin para gestores', up:[
    `CREATE TABLE IF NOT EXISTS admin_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT DEFAULT 'aviso',
      titulo TEXT,
      mensagem TEXT NOT NULL,
      display_mode TEXT DEFAULT 'banner',
      bg_color TEXT DEFAULT '',
      text_color TEXT DEFAULT '',
      font_family TEXT DEFAULT '',
      target_all INTEGER DEFAULT 1,
      target_tenants TEXT DEFAULT '[]',
      ativo INTEGER DEFAULT 1,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_admin_alerts_ativo ON admin_alerts(ativo, created_at)`
  ] },
  { version:52, description:'estilo visual dos comunicados admin', up:[
    `ALTER TABLE admin_alerts ADD COLUMN bg_color TEXT DEFAULT ''`,
    `ALTER TABLE admin_alerts ADD COLUMN text_color TEXT DEFAULT ''`,
    `ALTER TABLE admin_alerts ADD COLUMN font_family TEXT DEFAULT ''`
  ] },
  { version:53, description:'modulo de entregas, rotas e historico de status', up:[
    `CREATE TABLE IF NOT EXISTS entregadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      telefone TEXT,
      comissao_tipo TEXT DEFAULT 'fixa',
      comissao_valor REAL DEFAULT 0,
      ativo INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_entregadores_tenant ON entregadores(tenant_id, ativo)`,
    `CREATE TABLE IF NOT EXISTS rotas_entrega (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      entregador_id INTEGER REFERENCES entregadores(id),
      status TEXT DEFAULT 'aberta',
      pedidos_count INTEGER DEFAULT 0,
      total_pedidos REAL DEFAULT 0,
      dinheiro_previsto REAL DEFAULT 0,
      comissao_total REAL DEFAULT 0,
      iniciado_em TEXT,
      finalizado_em TEXT,
      obs TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_rotas_entrega_tenant ON rotas_entrega(tenant_id, status)`,
    `CREATE TABLE IF NOT EXISTS entregas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      entregador_id INTEGER REFERENCES entregadores(id),
      rota_id INTEGER REFERENCES rotas_entrega(id),
      status TEXT DEFAULT 'pendente',
      taxa_entrega REAL DEFAULT 0,
      valor_pedido REAL DEFAULT 0,
      valor_receber REAL DEFAULT 0,
      comissao REAL DEFAULT 0,
      recebido REAL DEFAULT 0,
      problema TEXT,
      assigned_at TEXT,
      saiu_at TEXT,
      entregue_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(tenant_id, order_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_entregas_tenant_status ON entregas(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_entregas_order ON entregas(order_id)`,
    `CREATE TABLE IF NOT EXISTS order_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      old_status TEXT,
      new_status TEXT NOT NULL,
      actor_type TEXT DEFAULT 'sistema',
      actor_id TEXT,
      actor_name TEXT,
      origem TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(tenant_id, order_id, created_at)`
  ] },
  { version:54, description:'ficha tecnica e movimentos de estoque por pedido', up:[
    `CREATE TABLE IF NOT EXISTS estoque_receitas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
      estoque_id INTEGER NOT NULL REFERENCES estoque(id) ON DELETE CASCADE,
      qty REAL NOT NULL DEFAULT 0,
      unit TEXT,
      ativo INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(tenant_id, item_id, estoque_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_estoque_receitas_item ON estoque_receitas(tenant_id, item_id, ativo)`,
    `CREATE TABLE IF NOT EXISTS estoque_movimentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      estoque_id INTEGER NOT NULL REFERENCES estoque(id) ON DELETE CASCADE,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
      tipo TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 0,
      saldo_antes REAL DEFAULT 0,
      saldo_depois REAL DEFAULT 0,
      origem TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(tenant_id, estoque_id, order_id, item_id, tipo)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_estoque_movimentos_tenant ON estoque_movimentos(tenant_id, estoque_id, created_at)`
  ] },
  { version:55, description:'app do entregador com sessao gps e mensagens', up:[
    `CREATE TABLE IF NOT EXISTS entregador_sessions (
      token TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      entregador_id INTEGER NOT NULL REFERENCES entregadores(id) ON DELETE CASCADE,
      ts INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_entregador_sessions_driver ON entregador_sessions(tenant_id, entregador_id, ts)`,
    `CREATE TABLE IF NOT EXISTS entregador_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      entregador_id INTEGER NOT NULL REFERENCES entregadores(id) ON DELETE CASCADE,
      entrega_id INTEGER REFERENCES entregas(id) ON DELETE SET NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      accuracy REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(tenant_id, entregador_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_entregador_locations_tenant ON entregador_locations(tenant_id, entregador_id, updated_at)`,
    `CREATE TABLE IF NOT EXISTS entrega_mensagens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      entrega_id INTEGER REFERENCES entregas(id) ON DELETE SET NULL,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      entregador_id INTEGER REFERENCES entregadores(id) ON DELETE SET NULL,
      tipo TEXT,
      message TEXT NOT NULL,
      ok INTEGER DEFAULT 0,
      error TEXT,
      lat REAL,
      lng REAL,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_entrega_mensagens_entrega ON entrega_mensagens(tenant_id, entrega_id, created_at)`
  ] },
  { version:56, description:'sequencia editavel no app do entregador', up:[
    `ALTER TABLE entregas ADD COLUMN sequencia INTEGER`,
    `CREATE INDEX IF NOT EXISTS idx_entregas_rota_seq ON entregas(tenant_id, entregador_id, status, sequencia)`
  ] },
  { version:57, description:'updated_at em orders para automacao de pedidos em rota', up:[
    `ALTER TABLE orders ADD COLUMN updated_at TEXT`,
    `UPDATE orders SET updated_at = created_at WHERE updated_at IS NULL`
  ] },
  { version:58, description:'modo popup para comunicados admin', up:
    `ALTER TABLE admin_alerts ADD COLUMN display_mode TEXT DEFAULT 'banner'`
  },
  { version:59, description:'idempotencia na criacao de pedidos', up:[
    `ALTER TABLE orders ADD COLUMN client_request_id TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_request ON orders(tenant_id, client_request_id) WHERE client_request_id IS NOT NULL`
  ] },
  { version:60, description:'reset diario automatico da numeracao de pedidos', up:[
    `ALTER TABLE store_config ADD COLUMN order_auto_reset_daily INTEGER DEFAULT 0`,
    `ALTER TABLE store_config ADD COLUMN order_auto_reset_last_date TEXT`
  ] },
  { version:61, description:'assinatura recorrente de planos SaaS', up:[
    `CREATE TABLE IF NOT EXISTS plano_assinaturas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      plano TEXT NOT NULL,
      valor REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      mp_preapproval_id TEXT UNIQUE,
      mp_external_ref TEXT UNIQUE,
      payer_email TEXT,
      payment_method_id TEXT,
      last_authorized_payment_id TEXT,
      last_payment_id TEXT,
      last_payment_status TEXT,
      next_payment_at TEXT,
      started_at TEXT,
      canceled_at TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_plano_ass_tenant ON plano_assinaturas(tenant_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_plano_ass_status ON plano_assinaturas(status)`,
    `CREATE INDEX IF NOT EXISTS idx_plano_ass_extref ON plano_assinaturas(mp_external_ref)`,
    `CREATE INDEX IF NOT EXISTS idx_plano_ass_preapproval ON plano_assinaturas(mp_preapproval_id)`
  ] },
  { version:62, description:'pedidos online pendentes sem numero publico', up:
    `UPDATE orders
     SET order_num=NULL
     WHERE status='aguardando_cartao'
        OR (status='aguardando_pix' AND COALESCE(pag,'')!='pix_manual')`
  },
  { version:63, description:'chat interno por pedido e tenant', up:[
    `CREATE TABLE IF NOT EXISTS chat_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      order_id INTEGER NOT NULL,
      order_num INTEGER,
      client TEXT,
      phone TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      last_message TEXT,
      last_sender TEXT,
      last_at TEXT DEFAULT (datetime('now')),
      unread_store INTEGER DEFAULT 0,
      unread_client INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(tenant_id, order_id)
    )`,
    `CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
      order_id INTEGER NOT NULL,
      sender TEXT NOT NULL,
      author_name TEXT,
      body TEXT NOT NULL,
      kind TEXT DEFAULT 'text',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `ALTER TABLE chat_threads ADD COLUMN tenant_id TEXT`,
    `ALTER TABLE chat_threads ADD COLUMN order_id INTEGER`,
    `ALTER TABLE chat_threads ADD COLUMN order_num INTEGER`,
    `ALTER TABLE chat_threads ADD COLUMN client TEXT`,
    `ALTER TABLE chat_threads ADD COLUMN phone TEXT DEFAULT ''`,
    `ALTER TABLE chat_threads ADD COLUMN status TEXT DEFAULT 'open'`,
    `ALTER TABLE chat_threads ADD COLUMN last_message TEXT`,
    `ALTER TABLE chat_threads ADD COLUMN last_sender TEXT`,
    `ALTER TABLE chat_threads ADD COLUMN last_at TEXT`,
    `ALTER TABLE chat_threads ADD COLUMN unread_store INTEGER DEFAULT 0`,
    `ALTER TABLE chat_threads ADD COLUMN unread_client INTEGER DEFAULT 0`,
    `ALTER TABLE chat_threads ADD COLUMN created_at TEXT`,
    `ALTER TABLE chat_threads ADD COLUMN updated_at TEXT`,
    `ALTER TABLE chat_messages ADD COLUMN tenant_id TEXT`,
    `ALTER TABLE chat_messages ADD COLUMN thread_id INTEGER`,
    `ALTER TABLE chat_messages ADD COLUMN order_id INTEGER`,
    `ALTER TABLE chat_messages ADD COLUMN sender TEXT DEFAULT 'client'`,
    `ALTER TABLE chat_messages ADD COLUMN author_name TEXT`,
    `ALTER TABLE chat_messages ADD COLUMN body TEXT DEFAULT ''`,
    `ALTER TABLE chat_messages ADD COLUMN kind TEXT DEFAULT 'text'`,
    `ALTER TABLE chat_messages ADD COLUMN created_at TEXT`,
    `SELECT 1`,
    `SELECT 1`,
    `SELECT 1`,
    `SELECT 1`
  ] },
  { version:64, description:'chat interno isolado de tabelas antigas', up:[
    `CREATE TABLE IF NOT EXISTS order_chat_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      order_id INTEGER NOT NULL,
      order_num INTEGER,
      client TEXT,
      phone TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      last_message TEXT,
      last_sender TEXT,
      last_at TEXT DEFAULT (datetime('now')),
      unread_store INTEGER DEFAULT 0,
      unread_client INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS order_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      thread_id INTEGER NOT NULL REFERENCES order_chat_threads(id) ON DELETE CASCADE,
      order_id INTEGER NOT NULL,
      sender TEXT NOT NULL,
      author_name TEXT,
      body TEXT NOT NULL,
      kind TEXT DEFAULT 'text',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_order_chat_threads_tenant_last ON order_chat_threads(tenant_id, last_at)`,
    `CREATE INDEX IF NOT EXISTS idx_order_chat_threads_order ON order_chat_threads(tenant_id, order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_chat_threads_phone ON order_chat_threads(tenant_id, phone)`,
    `CREATE INDEX IF NOT EXISTS idx_order_chat_messages_thread ON order_chat_messages(tenant_id, thread_id, id)`
  ] },
  { version:65, description:'rascunho de pedido guiado no chat interno', up:[
    `CREATE TABLE IF NOT EXISTS order_chat_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      thread_id INTEGER NOT NULL REFERENCES order_chat_threads(id) ON DELETE CASCADE,
      phone TEXT NOT NULL,
      client TEXT,
      items TEXT DEFAULT '[]',
      delivery_type TEXT,
      addr TEXT,
      pag TEXT,
      step TEXT DEFAULT 'items',
      status TEXT DEFAULT 'draft',
      meta TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(tenant_id, thread_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_order_chat_drafts_thread ON order_chat_drafts(tenant_id, thread_id)`
  ] },
  { version:66, description:'clientes individuais por mesa', up:
    `ALTER TABLE mesas ADD COLUMN clientes_json TEXT DEFAULT '[]'`
  },
  { version:67, description:'recebimentos parciais por cliente na mesa', up:
    `ALTER TABLE mesas ADD COLUMN pagamentos_json TEXT DEFAULT '[]'`
  },
  { version:68, description:'modulo fiscal NFC-e Focus', up:[
    `CREATE TABLE IF NOT EXISTS fiscal_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      enabled INTEGER DEFAULT 0,
      ambiente TEXT DEFAULT 'homologacao',
      emit_mode TEXT DEFAULT 'fechamento',
      token_homologacao TEXT,
      token_producao TEXT,
      cnpj_emitente TEXT,
      inscricao_estadual_emitente TEXT,
      regime_tributario_emitente TEXT DEFAULT '1',
      nome_emitente TEXT,
      nome_fantasia_emitente TEXT,
      telefone_emitente TEXT,
      logradouro_emitente TEXT,
      numero_emitente TEXT,
      bairro_emitente TEXT,
      municipio_emitente TEXT,
      uf_emitente TEXT DEFAULT 'CE',
      cep_emitente TEXT,
      csc_id TEXT,
      csc_token TEXT,
      serie TEXT,
      proximo_numero INTEGER,
      natureza_operacao TEXT DEFAULT 'VENDA AO CONSUMIDOR',
      ncm_padrao TEXT,
      cfop_padrao TEXT DEFAULT '5102',
      icms_origem_padrao TEXT DEFAULT '0',
      icms_situacao_padrao TEXT DEFAULT '102',
      unidade_padrao TEXT DEFAULT 'UN',
      updated_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS fiscal_nfce (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      origem_tipo TEXT DEFAULT 'order',
      origem_id TEXT,
      order_id INTEGER,
      mesa_num INTEGER,
      session_ref TEXT,
      referencia TEXT NOT NULL,
      ambiente TEXT DEFAULT 'homologacao',
      status TEXT DEFAULT 'pendente',
      total REAL DEFAULT 0,
      forma_pagamento TEXT,
      payload_json TEXT DEFAULT '{}',
      response_json TEXT DEFAULT '{}',
      chave_nfe TEXT,
      numero TEXT,
      serie TEXT,
      protocolo TEXT,
      caminho_xml TEXT,
      caminho_danfe TEXT,
      qr_code TEXT,
      mensagem TEXT,
      emitted_at TEXT,
      canceled_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(tenant_id, referencia)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_fiscal_nfce_tenant_status ON fiscal_nfce(tenant_id, status, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_fiscal_nfce_origem ON fiscal_nfce(tenant_id, origem_tipo, origem_id)`,
    `ALTER TABLE menu_items ADD COLUMN fiscal_ncm TEXT`,
    `ALTER TABLE menu_items ADD COLUMN fiscal_cfop TEXT`,
    `ALTER TABLE menu_items ADD COLUMN fiscal_icms_origem TEXT`,
    `ALTER TABLE menu_items ADD COLUMN fiscal_icms_situacao TEXT`,
    `ALTER TABLE menu_items ADD COLUMN fiscal_cest TEXT`,
    `ALTER TABLE menu_items ADD COLUMN fiscal_unidade TEXT`,
    `ALTER TABLE menu_items ADD COLUMN fiscal_codigo_produto TEXT`,
    `ALTER TABLE menu_items ADD COLUMN fiscal_pis_situacao TEXT`,
    `ALTER TABLE menu_items ADD COLUMN fiscal_cofins_situacao TEXT`
  ] },
  { version:69, description:'mime dos audios do EstimaFone', up:
    `ALTER TABLE radio_messages ADD COLUMN audio_mime TEXT DEFAULT 'audio/webm'`
  },
  { version:70, description:'nome customizado da mesa (garcom pode renomear)', up:
    `ALTER TABLE mesas ADD COLUMN nome TEXT`
  },
  { version:71, description:'plano unico com tudo incluso (essencial/premium/fiscal viram um so) + valor de mensalidade personalizado por tenant', up:[
    `ALTER TABLE tenants ADD COLUMN valor_mensalidade REAL`,
    `UPDATE tenants SET plano='premium' WHERE plano != 'premium'`
  ] },
  { version:72, description:'validade do preco promocional/personalizado do tenant (expira e volta pro valor geral automaticamente)', up:
    `ALTER TABLE tenants ADD COLUMN valor_mensalidade_expira_em TEXT`
  },
  { version:73, description:'telefone dedicado para cobranca automatica (admin cadastra por tenant, separado do whatsapp da loja)', up:
    `ALTER TABLE tenants ADD COLUMN telefone_cobranca TEXT`
  },
  { version:74, description:'imagem de categoria (icone redondo no cardapio, alem do emoji)', up:
    `ALTER TABLE categories ADD COLUMN image_url TEXT`
  },
  { version:75, description:'banner promocional configuravel no cardapio (tipo "Kit Churrasco")', up:
    [`ALTER TABLE store_config ADD COLUMN promo_banner_ativo INTEGER DEFAULT 0`,
     `ALTER TABLE store_config ADD COLUMN promo_banner_titulo TEXT`,
     `ALTER TABLE store_config ADD COLUMN promo_banner_destaque TEXT`,
     `ALTER TABLE store_config ADD COLUMN promo_banner_subtitulo TEXT`,
     `ALTER TABLE store_config ADD COLUMN promo_banner_cta_texto TEXT`,
     `ALTER TABLE store_config ADD COLUMN promo_banner_image_url TEXT`,
     `ALTER TABLE store_config ADD COLUMN promo_banner_selo TEXT`,
     `ALTER TABLE store_config ADD COLUMN promo_banner_categoria TEXT`]
  },
  { version:76, description:'banners promocionais viram lista (ate 5, com rotacao automatica no cardapio)', up:
    `ALTER TABLE store_config ADD COLUMN promo_banners TEXT`
  },
  { version:77, description:'favoritos do cliente exigem conta (tabela customer_favoritos)', up:
    `CREATE TABLE IF NOT EXISTS customer_favoritos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(tenant_id, customer_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_customer_favoritos_cliente ON customer_favoritos(tenant_id, customer_id);`
  },
  { version:78, description:'liga/desliga a seção "Não sabe qual carne escolher?" no cardápio do açougue', up:
    `ALTER TABLE store_config ADD COLUMN mostrar_indicacao_preparo INTEGER DEFAULT 1`
  },
  { version:79, description:'esconde o preço do item no cardápio (usado quando o preço real está só nos adicionais)', up:
    `ALTER TABLE menu_items ADD COLUMN hide_price INTEGER DEFAULT 0`
  },
  { version:80, description:'agendamento de pedido quando a loja está fechada', up:
    `ALTER TABLE orders ADD COLUMN scheduled_for TEXT;
     ALTER TABLE store_config ADD COLUMN permitir_agendamento INTEGER DEFAULT 1`
  },
  { version:81, description:'fundo do portal de boas-vindas do cardápio de mesa/tablet', up:
    `ALTER TABLE store_config ADD COLUMN tablet_splash_bg_url TEXT`
  },
  { version:82, description:'identifica de qual canal veio o pedido (ex: tablet fixo na mesa)', up:
    `ALTER TABLE orders ADD COLUMN canal TEXT`
  },
  { version:83, description:'add-on de pedido por voz via WhatsApp — liga/desliga por tenant, ativado só pelo admin', up:
    `ALTER TABLE tenants ADD COLUMN voz_ativo INTEGER DEFAULT 0`
  },
  { version:84, description:'log de uso do pedido por voz (WhatsApp) — controla limite de áudios por telefone/hora, evita custo de transcrição sem controle', up:
    `CREATE TABLE IF NOT EXISTS voz_uso_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      ts INTEGER NOT NULL
    )`
  },
  { version:85, description:'rascunho de pedido por voz aguardando confirmação do cliente (sim/não) antes de criar o pedido de verdade', up:
    `CREATE TABLE IF NOT EXISTS voz_pedidos_pendentes (
      tenant_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      dados TEXT NOT NULL,
      ts INTEGER NOT NULL,
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

function garantirColuna(table, column, definition, afterAddSql = null) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
    if (cols.includes(column)) return true
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    if (afterAddSql) db.exec(afterAddSql)
    log('✅', `Schema guard: coluna ${table}.${column} criada`)
    return true
  } catch(e) {
    log('⚠️', `Schema guard falhou para ${table}.${column}:`, e.message)
    return false
  }
}

const HAS_ORDERS_UPDATED_AT = garantirColuna(
  'orders',
  'updated_at',
  "TEXT",
  "UPDATE orders SET updated_at = created_at WHERE updated_at IS NULL"
)

garantirColuna('orders', 'client_request_id', "TEXT")
garantirColuna('orders', 'session_ref', "TEXT")
try {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_request ON orders(tenant_id, client_request_id) WHERE client_request_id IS NOT NULL")
} catch(e) {
  log('⚠️', 'Schema guard falhou para indice orders.client_request_id:', e.message)
}

garantirColuna('store_config', 'order_auto_reset_daily', "INTEGER DEFAULT 0")
garantirColuna('store_config', 'order_auto_reset_last_date', "TEXT")
garantirColuna('store_config', 'store_banners', "TEXT DEFAULT '[]'")
garantirColuna('admin_alerts', 'display_mode', "TEXT DEFAULT 'banner'")
garantirColuna('admin_alerts', 'cta_label', "TEXT DEFAULT ''")
garantirColuna('admin_alerts', 'cta_whatsapp', "TEXT DEFAULT ''")
garantirColuna('radio_messages', 'audio_mime', "TEXT DEFAULT 'audio/webm'")
garantirColuna('mesas', 'clientes_json', "TEXT DEFAULT '[]'")
garantirColuna('mesas', 'pagamentos_json', "TEXT DEFAULT '[]'")
garantirColuna('mesas', 'taxa_servico', "REAL DEFAULT 0")
garantirColuna('menu_items', 'fiscal_ncm', "TEXT")
garantirColuna('menu_items', 'fiscal_cfop', "TEXT")
garantirColuna('menu_items', 'fiscal_icms_origem', "TEXT")
garantirColuna('menu_items', 'fiscal_icms_situacao', "TEXT")
garantirColuna('menu_items', 'fiscal_cest', "TEXT")
garantirColuna('menu_items', 'fiscal_unidade', "TEXT")
garantirColuna('menu_items', 'fiscal_codigo_produto', "TEXT")
garantirColuna('menu_items', 'fiscal_pis_situacao', "TEXT")
garantirColuna('menu_items', 'fiscal_cofins_situacao', "TEXT")
garantirColuna('menu_items', 'video_url', "TEXT")

function garantirSchemaFiscal() {
  const execSafe = (sql) => {
    try { db.exec(sql) } catch(e) { log('⚠️', 'Schema fiscal guard:', e.message) }
  }
  execSafe(`CREATE TABLE IF NOT EXISTS fiscal_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    enabled INTEGER DEFAULT 0,
    ambiente TEXT DEFAULT 'homologacao',
    emit_mode TEXT DEFAULT 'fechamento',
    token_homologacao TEXT,
    token_producao TEXT,
    cnpj_emitente TEXT,
    inscricao_estadual_emitente TEXT,
    regime_tributario_emitente TEXT DEFAULT '1',
    nome_emitente TEXT,
    nome_fantasia_emitente TEXT,
    telefone_emitente TEXT,
    logradouro_emitente TEXT,
    numero_emitente TEXT,
    bairro_emitente TEXT,
    municipio_emitente TEXT,
    uf_emitente TEXT DEFAULT 'CE',
    cep_emitente TEXT,
    csc_id TEXT,
    csc_token TEXT,
    serie TEXT,
    proximo_numero INTEGER,
    natureza_operacao TEXT DEFAULT 'VENDA AO CONSUMIDOR',
    ncm_padrao TEXT,
    cfop_padrao TEXT DEFAULT '5102',
    icms_origem_padrao TEXT DEFAULT '0',
    icms_situacao_padrao TEXT DEFAULT '102',
    unidade_padrao TEXT DEFAULT 'UN',
    updated_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  )`)
  execSafe(`CREATE TABLE IF NOT EXISTS fiscal_nfce (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    origem_tipo TEXT DEFAULT 'order',
    origem_id TEXT,
    order_id INTEGER,
    mesa_num INTEGER,
    session_ref TEXT,
    referencia TEXT NOT NULL,
    ambiente TEXT DEFAULT 'homologacao',
    status TEXT DEFAULT 'pendente',
    total REAL DEFAULT 0,
    forma_pagamento TEXT,
    payload_json TEXT DEFAULT '{}',
    response_json TEXT DEFAULT '{}',
    chave_nfe TEXT,
    numero TEXT,
    serie TEXT,
    protocolo TEXT,
    caminho_xml TEXT,
    caminho_danfe TEXT,
    qr_code TEXT,
    mensagem TEXT,
    emitted_at TEXT,
    canceled_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(tenant_id, referencia)
  )`)
  execSafe('CREATE INDEX IF NOT EXISTS idx_fiscal_nfce_tenant_status ON fiscal_nfce(tenant_id, status, created_at)')
  execSafe('CREATE INDEX IF NOT EXISTS idx_fiscal_nfce_origem ON fiscal_nfce(tenant_id, origem_tipo, origem_id)')
}
garantirSchemaFiscal()

function garantirSchemaChatInterno() {
  const execSafe = (sql) => {
    try { db.exec(sql) } catch(e) { log('⚠️', 'Schema chat guard:', e.message) }
  }
  execSafe(`CREATE TABLE IF NOT EXISTS chat_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id INTEGER NOT NULL,
    order_num INTEGER,
    client TEXT,
    phone TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    last_message TEXT,
    last_sender TEXT,
    last_at TEXT DEFAULT (datetime('now')),
    unread_store INTEGER DEFAULT 0,
    unread_client INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(tenant_id, order_id)
  )`)
  execSafe(`CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    thread_id INTEGER,
    order_id INTEGER,
    sender TEXT DEFAULT 'client',
    author_name TEXT,
    body TEXT DEFAULT '',
    kind TEXT DEFAULT 'text',
    created_at TEXT DEFAULT (datetime('now'))
  )`)
  garantirColuna('chat_threads', 'tenant_id', "TEXT")
  garantirColuna('chat_threads', 'order_id', "INTEGER")
  garantirColuna('chat_threads', 'order_num', "INTEGER")
  garantirColuna('chat_threads', 'client', "TEXT")
  garantirColuna('chat_threads', 'phone', "TEXT DEFAULT ''")
  garantirColuna('chat_threads', 'status', "TEXT DEFAULT 'open'")
  garantirColuna('chat_threads', 'last_message', "TEXT")
  garantirColuna('chat_threads', 'last_sender', "TEXT")
  garantirColuna('chat_threads', 'last_at', "TEXT")
  garantirColuna('chat_threads', 'unread_store', "INTEGER DEFAULT 0")
  garantirColuna('chat_threads', 'unread_client', "INTEGER DEFAULT 0")
  garantirColuna('chat_threads', 'created_at', "TEXT")
  garantirColuna('chat_threads', 'updated_at', "TEXT")
  garantirColuna('chat_messages', 'tenant_id', "TEXT")
  garantirColuna('chat_messages', 'thread_id', "INTEGER")
  garantirColuna('chat_messages', 'order_id', "INTEGER")
  garantirColuna('chat_messages', 'sender', "TEXT DEFAULT 'client'")
  garantirColuna('chat_messages', 'author_name', "TEXT")
  garantirColuna('chat_messages', 'body', "TEXT DEFAULT ''")
  garantirColuna('chat_messages', 'kind', "TEXT DEFAULT 'text'")
  garantirColuna('chat_messages', 'created_at', "TEXT")
  execSafe('CREATE INDEX IF NOT EXISTS idx_chat_threads_tenant_last ON chat_threads(tenant_id, last_at)')
  execSafe('CREATE INDEX IF NOT EXISTS idx_chat_threads_order ON chat_threads(tenant_id, order_id)')
  execSafe('CREATE INDEX IF NOT EXISTS idx_chat_threads_phone ON chat_threads(tenant_id, phone)')
  execSafe('CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(tenant_id, thread_id, id)')
}
garantirSchemaChatInterno()

function garantirSchemaChatPedido() {
  const execSafe = (sql) => {
    try { db.exec(sql) } catch(e) { log('⚠️', 'Schema order chat guard:', e.message) }
  }
  execSafe(`CREATE TABLE IF NOT EXISTS order_chat_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id INTEGER NOT NULL,
    order_num INTEGER,
    client TEXT,
    phone TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    last_message TEXT,
    last_sender TEXT,
    last_at TEXT DEFAULT (datetime('now')),
    unread_store INTEGER DEFAULT 0,
    unread_client INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`)
  execSafe(`CREATE TABLE IF NOT EXISTS order_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    thread_id INTEGER NOT NULL REFERENCES order_chat_threads(id) ON DELETE CASCADE,
    order_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    author_name TEXT,
    body TEXT NOT NULL,
    kind TEXT DEFAULT 'text',
    created_at TEXT DEFAULT (datetime('now'))
  )`)
  execSafe(`CREATE TABLE IF NOT EXISTS order_chat_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    thread_id INTEGER NOT NULL REFERENCES order_chat_threads(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    client TEXT,
    items TEXT DEFAULT '[]',
    delivery_type TEXT,
    addr TEXT,
    pag TEXT,
    step TEXT DEFAULT 'items',
    status TEXT DEFAULT 'draft',
    meta TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(tenant_id, thread_id)
  )`)
  execSafe('CREATE INDEX IF NOT EXISTS idx_order_chat_threads_tenant_last ON order_chat_threads(tenant_id, last_at)')
  execSafe('CREATE INDEX IF NOT EXISTS idx_order_chat_threads_order ON order_chat_threads(tenant_id, order_id)')
  execSafe('CREATE INDEX IF NOT EXISTS idx_order_chat_threads_phone ON order_chat_threads(tenant_id, phone)')
  execSafe('CREATE INDEX IF NOT EXISTS idx_order_chat_messages_thread ON order_chat_messages(tenant_id, thread_id, id)')
  execSafe('CREATE INDEX IF NOT EXISTS idx_order_chat_drafts_thread ON order_chat_drafts(tenant_id, thread_id)')
}
garantirSchemaChatPedido()

// ── Backfill order_num para pedidos existentes ────────────────────────────
try {
  const _backfillWhere = "order_num IS NULL AND NOT (status='aguardando_cartao' OR (status='aguardando_pix' AND COALESCE(pag,'')!='pix_manual'))"
  const _needsBackfill = db.prepare(`SELECT COUNT(*) as cnt FROM orders WHERE ${_backfillWhere}`).get()
  if (_needsBackfill?.cnt > 0) {
    log('🔄', `Backfill order_num: ${_needsBackfill.cnt} pedidos sem número sequencial`)
    const _tenants = db.prepare(`SELECT DISTINCT tenant_id FROM orders WHERE ${_backfillWhere}`).all()
    for (const { tenant_id } of _tenants) {
      const _cfg = db.prepare('SELECT order_num_offset FROM store_config WHERE tenant_id=?').get(tenant_id)
      const _offset = parseInt(_cfg?.order_num_offset) || 0
      const _nullOrders = db.prepare(`SELECT id FROM orders WHERE tenant_id=? AND id>? AND ${_backfillWhere} ORDER BY id ASC`).all(tenant_id, _offset)
      if (!_nullOrders.length) continue
      const _existingMax = db.prepare('SELECT COALESCE(MAX(order_num),0) as mx FROM orders WHERE tenant_id=? AND id>? AND order_num IS NOT NULL').get(tenant_id, _offset)
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
  'cupons','mesas','garcons','orders','movimentos','estoque','estoque_receitas','estoque_movimentos','fidelidade','customers','customer_enderecos','pagamentos_pix','saques','pagamentos_cartao','stamp_progress','ratings',
  'entregadores','entregas','rotas_entrega','entregador_locations','entrega_mensagens','order_status_history',
  'chat_threads','chat_messages','order_chat_threads','order_chat_messages','order_chat_drafts',
  'indicadores','leads_indicacao','comissoes','indicador_tutorial_videos','indicador_tutorial_progress','admin_alerts','admin_audit_log','plano_assinaturas',
  'fiscal_config','fiscal_nfce','contas_pagar','faturas','fornecedores']
  // wa_messages, radio_messages excluídas — mídia/áudio pode estourar JSON.stringify
  // sessions (admin/indicador/entregador), print_jobs, ia_pausa, addons_esgotados —
  // dados transitórios/operacionais, não fazem sentido restaurar
  // ⚠️ Lista única — reutilizada em TODOS os backups/restores (Telegram, global, por-tenant, gestor).
  // Nunca duplicar essa lista em outro lugar do código — sempre importar TABELAS_BACKUP daqui.

let _dirty = false
function marcarDirty() { _dirty = true }

// ── Sessões Admin (SQLite, sobrevivem a restarts) ─────
db.exec(`CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT, nome TEXT, email TEXT, role TEXT,
  ts INTEGER NOT NULL
)`)
db.exec(`CREATE TABLE IF NOT EXISTS indicador_sessions (
  token TEXT PRIMARY KEY,
  indicador_id INTEGER NOT NULL,
  nome TEXT, email TEXT, codigo TEXT,
  ts INTEGER NOT NULL
)`)
// ── Sessões de Gestor por tenant (login normal do painel, não-superadmin) ──
// Antes o login do gestor (login.html) fazia um SELECT direto na tabela
// sys_users pelo motor REST genérico, sem nunca emitir um token de sessão —
// ou seja, depois de "logar" o navegador só guardava o tenant_id e nada mais
// era verificado no servidor em cada chamada seguinte. Qualquer requisição
// com o x-tenant-id certo (visível publicamente no cardápio) passava como
// se fosse o gestor autenticado. Essa tabela + as funções abaixo consertam
// isso: agora existe um token de sessão real, criado só após validar a
// senha no servidor, e as tabelas sensíveis do painel passam a exigi-lo.
db.exec(`CREATE TABLE IF NOT EXISTS gestor_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT, tenant_id TEXT, nome TEXT, email TEXT, role TEXT,
  ts INTEGER NOT NULL
)`)
// ── Sessões de garçom (app garcom.html) ──
// Mesma lógica: antes o app do garçom também só guardava tenant_id depois do
// login, sem token nenhum. Sessão de garçom autoriza escrita só nas tabelas
// que o app realmente usa no dia a dia (comandas/mesas) — não vale pra
// mexer no cardápio, estoque, cupons etc.
db.exec(`CREATE TABLE IF NOT EXISTS garcom_sessions (
  token TEXT PRIMARY KEY,
  garcom_id INTEGER, tenant_id TEXT, nome TEXT, usuario TEXT,
  ts INTEGER NOT NULL
)`)
const GARCOM_SESSION_TTL = 30 * 24 * 60 * 60 * 1000 // 30 dias — o app já guardava login local por 30 dias
const GARCOM_SESSION_TABLES = new Set(['orders','mesas'])
function criarSessaoGarcom(row) {
  const token = crypto.randomBytes(32).toString('hex')
  const ts = Date.now()
  db.prepare('DELETE FROM garcom_sessions WHERE ts < ?').run(ts - GARCOM_SESSION_TTL)
  db.prepare('INSERT OR REPLACE INTO garcom_sessions (token,garcom_id,tenant_id,nome,usuario,ts) VALUES (?,?,?,?,?,?)').run(token,row.id,row.tenant_id,row.nome,row.usuario,ts)
  return token
}
function validarSessaoGarcom(req, tenantId, table) {
  if (!GARCOM_SESSION_TABLES.has(table)) return null
  const auth = req.headers['authorization'] || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null
  const s = db.prepare('SELECT * FROM garcom_sessions WHERE token=?').get(token)
  if (!s) return null
  if (Date.now() - s.ts > GARCOM_SESSION_TTL) { db.prepare('DELETE FROM garcom_sessions WHERE token=?').run(token); return null }
  if (tenantId && String(s.tenant_id) !== String(tenantId)) return null
  return s
}
const ADMIN_SESSION_TTL  = 8 * 60 * 60 * 1000
// Sem expiração de fato: sessão do gestor não deve mais forçar logout.
// Antes eram 30 dias — motivo de pedidos "sumirem" sem aviso quando o
// token expirava no meio do uso. Valor bem alto (100 anos) mantém a
// mesma lógica de sliding expiration (ver validarSessaoGestor) sem
// nunca derrubar a sessão na prática.
const GESTOR_SESSION_TTL = 100 * 365 * 24 * 60 * 60 * 1000
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
function criarSessaoGestor(user) {
  const token = crypto.randomBytes(32).toString('hex')
  const ts = Date.now()
  db.prepare('DELETE FROM gestor_sessions WHERE ts < ?').run(ts - GESTOR_SESSION_TTL)
  db.prepare('INSERT OR REPLACE INTO gestor_sessions (token,user_id,tenant_id,nome,email,role,ts) VALUES (?,?,?,?,?,?,?)').run(token,user.id,user.tenant_id,user.nome,user.email,user.role,ts)
  return token
}
// Sessão de gestor é renovada (sliding expiration) enquanto estiver em uso,
// em vez de expirar sempre 30 dias após o login original. Sem isso, um
// gestor que usa o painel todo dia era deslogado no dia 31 do mesmo jeito
// que um que nunca mais voltou — e a escrita falhava silenciosamente até
// ele perceber e logar de novo. Throttle de 1h pra não escrever no banco
// a cada requisição.
const GESTOR_SESSION_RENEW_INTERVAL = 60 * 60 * 1000
// Valida sessão de gestor. Se tenantId for informado, a sessão só é aceita
// se pertencer àquele tenant (evita que o token de um restaurante seja
// usado pra escrever nos dados de outro). Sessão de admin/superadmin
// (validarSessaoAdmin) sempre passa também, como fallback administrativo.
function validarSessaoGestor(req, tenantId, table) {
  const admin = validarSessaoAdmin(req)
  if (admin) return admin
  const auth = req.headers['authorization'] || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (token) {
    const s = db.prepare('SELECT * FROM gestor_sessions WHERE token=?').get(token)
    if (s) {
      if (Date.now() - s.ts > GESTOR_SESSION_TTL) { db.prepare('DELETE FROM gestor_sessions WHERE token=?').run(token) }
      else if (!tenantId || String(s.tenant_id) === String(tenantId)) {
        if (Date.now() - s.ts > GESTOR_SESSION_RENEW_INTERVAL) {
          db.prepare('UPDATE gestor_sessions SET ts=? WHERE token=?').run(Date.now(), token)
        }
        return s
      }
    }
  }
  // Garçom não tem privilégio de gestor completo — só cobre comandas/mesas
  return validarSessaoGarcom(req, tenantId, table)
}

// ── Hash de senha (scrypt nativo do Node — sem depender de pacote externo) ──
// Formato novo: "scrypt$<saltHex>$<hashHex>". Mantém compatibilidade com o
// hash antigo (SHA-256 puro, sem salt, 64 caracteres hex) só para permitir
// login de contas antigas — no primeiro login bem-sucedido a senha é
// re-hasheada automaticamente pro formato novo (migração silenciosa).
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex')
  return `scrypt$${salt}$${hash}`
}
function verifyPassword(plain, stored) {
  if (!stored) return false
  if (stored.startsWith('scrypt$')) {
    const [, salt, hash] = stored.split('$')
    if (!salt || !hash) return false
    try {
      const calc = crypto.scryptSync(String(plain), salt, 64)
      const orig = Buffer.from(hash, 'hex')
      return calc.length === orig.length && crypto.timingSafeEqual(calc, orig)
    } catch { return false }
  }
  // Formato legado: SHA-256 sem salt (senha_hash calculado direto)
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    const calc = crypto.createHash('sha256').update(String(plain)).digest('hex')
    try {
      return crypto.timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(stored, 'hex'))
    } catch { return false }
  }
  return false
}
function precisaMigrarHash(stored) { return !!stored && !stored.startsWith('scrypt$') }

// ── Rate limiting simples em memória (sem dependência externa) ──
// Protege endpoints de login/senha contra força bruta e o servidor como um
// todo contra flood de requisições. Não sobrevive a restart do processo —
// suficiente pra mitigar abuso automatizado; não substitui um WAF/proxy
// dedicado em produção de alto tráfego.
const _rateBuckets = new Map()
function checkRateLimit(key, maxAttempts, windowMs) {
  const now = Date.now()
  let b = _rateBuckets.get(key)
  if (!b || now - b.start > windowMs) { b = { start: now, count: 0 }; _rateBuckets.set(key, b) }
  b.count++
  return b.count <= maxAttempts
}
// ── Rate limit de login (só conta tentativa ERRADA) ──────
// Diferente de checkRateLimit (que conta toda chamada, usada pro flood geral
// da API), aqui a chave já deve incluir IP + identificador da conta (email/
// usuário/tenant) — assim um IP compartilhado (várias pessoas da mesma loja/
// Wi-Fi) não trava por causa da tentativa de outra pessoa, só quem estiver
// de fato errando a senha repetidamente naquela conta específica.
function loginRateLimited(key, maxAttempts, windowMs) {
  const now = Date.now()
  const b = _rateBuckets.get(key)
  if (!b || now - b.start > windowMs) return false // sem tentativas recentes: liberado
  return b.count >= maxAttempts
}
function registrarLoginFalho(key, windowMs) {
  const now = Date.now()
  let b = _rateBuckets.get(key)
  if (!b || now - b.start > windowMs) { b = { start: now, count: 0 }; _rateBuckets.set(key, b) }
  b.count++
}
setInterval(() => {
  const now = Date.now()
  for (const [k, b] of _rateBuckets) { if (now - b.start > 30 * 60 * 1000) _rateBuckets.delete(k) }
}, 5 * 60 * 1000)
function clientIp(req) {
  const xf = req.headers['x-forwarded-for']
  if (xf) return String(xf).split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}


const FINANCE_AUTH_TTL = 30 * 60 * 1000
const financeAuthTokens = new Map()
function limparFinanceAuthExpirado() {
  const now = Date.now()
  for (const [token, sess] of financeAuthTokens) {
    if (!sess || sess.expires_at <= now) financeAuthTokens.delete(token)
  }
}
function validarFinanceAccess(req, tidArg) {
  limparFinanceAuthExpirado()
  const tid = String(tidArg || req.headers['x-tenant-id'] || '')
  const token = String(req.headers['x-finance-auth'] || '')
  if (!tid || !token) return null
  const sess = financeAuthTokens.get(token)
  if (!sess || sess.expires_at <= Date.now()) {
    if (token) financeAuthTokens.delete(token)
    return null
  }
  if (String(sess.tenant_id) !== tid) return null
  const reqUser = String(req.headers['x-user-id'] || '')
  if (reqUser && sess.session_user_id && String(sess.session_user_id) !== reqUser) return null
  return sess
}
function sendFinanceLocked(res) {
  send(res, 403, { error: 'FINANCE_LOCKED', message: 'Area financeira bloqueada. Informe a senha do gestor.' })
}
function criarFinanceAccess(row, sessionUserId) {
  limparFinanceAuthExpirado()
  const token = crypto.randomBytes(32).toString('hex')
  const expires_at = Date.now() + FINANCE_AUTH_TTL
  financeAuthTokens.set(token, {
    token,
    tenant_id: String(row.tenant_id),
    authorized_user_id: String(row.id),
    authorized_user_nome: row.nome || '',
    session_user_id: sessionUserId ? String(sessionUserId) : '',
    expires_at
  })
  return { token, expires_at, ttl_ms: FINANCE_AUTH_TTL }
}

// ── Envio automático do backup para o Telegram (cópia fora do volume) ──
async function enviarBackupTelegram(forcar = false) {
  try {
    const cfgRow = db.prepare("SELECT telegram_backup_config FROM store_config WHERE tenant_id='_global'").get()
    let cfg = {}
    try { cfg = JSON.parse(cfgRow?.telegram_backup_config || '{}') } catch { cfg = {} }
    if (!cfg.enabled || !cfg.bot_token || !cfg.chat_id) return { ok:false, motivo:'nao_configurado' }

    const intervalMs = Math.max(5, Number(cfg.interval_minutes) || 60) * 60 * 1000
    const agora = Date.now()
    if (!forcar && enviarBackupTelegram._lastSend && (agora - enviarBackupTelegram._lastSend) < intervalMs) {
      return { ok:false, motivo:'intervalo_nao_atingido' }
    }
    if (!fs.existsSync(BACKUP_PATH)) return { ok:false, motivo:'backup_inexistente' }

    const rawBuf = fs.readFileSync(BACKUP_PATH)
    const buf    = zlib.gzipSync(rawBuf)
    const stamp  = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

    // Limite do Telegram Bot API pra sendDocument: 50MB
    const TELEGRAM_MAX_BYTES = 50 * 1024 * 1024
    if (buf.length > TELEGRAM_MAX_BYTES) {
      log('❌', 'Backup Telegram: arquivo excede 50MB mesmo comprimido', { kb: Math.round(buf.length/1024) })
      return { ok:false, motivo:'arquivo_excede_limite_telegram', tamanho_kb: Math.round(buf.length/1024) }
    }

    const form  = new FormData()
    form.append('chat_id', String(cfg.chat_id))
    form.append('caption', `💾 Backup Anotai — ${stamp} (${(rawBuf.length / 1024).toFixed(0)} KB → ${(buf.length / 1024).toFixed(0)} KB gzip)`)
    form.append('document', new Blob([buf], { type: 'application/gzip' }), `backup-${new Date().toISOString().slice(0, 10)}.json.gz`)

    // Serializa o FormData num Buffer fixo e envia com Content-Length explícito.
    // O envio direto de FormData/Blob pelo fetch nativo do Node pode truncar uploads
    // grandes, e o Telegram responde "Bad Request: incomplete input" quando isso ocorre.
    const formResponse = new Response(form)
    const contentType  = formResponse.headers.get('content-type')
    const bodyBuf       = Buffer.from(await formResponse.arrayBuffer())

    const resp = await fetch(`https://api.telegram.org/bot${cfg.bot_token}/sendDocument`, {
      method: 'POST',
      body: bodyBuf,
      headers: { 'Content-Type': contentType, 'Content-Length': String(bodyBuf.length) }
    })
    const data = await resp.json().catch(() => null)
    if (!resp.ok || !data?.ok) {
      log('❌', 'Erro envio backup Telegram:', { status: resp.status, error: data?.description })
      return { ok:false, motivo: data?.description || `http_${resp.status}` }
    }
    enviarBackupTelegram._lastSend = agora
    log('📤', 'Backup enviado ao Telegram com sucesso')
    return { ok:true }
  } catch (e) {
    log('❌', 'Erro envio backup Telegram:', { error: e.message })
    return { ok:false, motivo: e.message }
  }
}
enviarBackupTelegram._lastSend = 0

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
        enviarBackupTelegram().catch(() => {})
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
  // Nunca mais senha fixa no código-fonte. Usa ADMIN_BOOTSTRAP_PASSWORD do
  // ambiente se existir; senão gera uma senha aleatória forte e imprime só
  // esta vez no log — troque-a assim que entrar pela primeira vez.
  const bootstrapPass = process.env.ADMIN_BOOTSTRAP_PASSWORD || crypto.randomBytes(12).toString('base64url')
  const hash = hashPassword(bootstrapPass)
  db.prepare("INSERT OR IGNORE INTO tenants (id,nome,plano,slug) VALUES ('system','Sistema Admin','premium','admin')").run()
  db.prepare("INSERT INTO sys_users (nome,email,senha_hash,role,tenant_id) VALUES (?,?,?,?,?)").run('Administrador','admin@estimafood.com',hash,'superadmin','system')
  if (process.env.ADMIN_BOOTSTRAP_PASSWORD) {
    log('🔑','Superadmin criado: admin@estimafood.com (senha definida via ADMIN_BOOTSTRAP_PASSWORD)')
  } else {
    log('🔑',`Superadmin criado: admin@estimafood.com / ${bootstrapPass}  ⚠️ ANOTE E TROQUE A SENHA AGORA — não será mostrada de novo.`)
  }
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
// Roda a cada 5 min. Cancela pendencias online antigas; PIX manual fica para o gestor confirmar.
setInterval(() => {
  try {
    const rows = db.prepare(
      `SELECT id, tenant_id FROM orders
       WHERE (status='aguardando_cartao' OR (status='aguardando_pix' AND COALESCE(pag,'')!='pix_manual'))
       AND created_at < datetime('now','-30 minutes')`
    ).all()
    if (rows.length) {
      db.prepare(
        `UPDATE orders SET status='cancelado'
         WHERE (status='aguardando_cartao' OR (status='aguardando_pix' AND COALESCE(pag,'')!='pix_manual'))
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

function pedidoOnlineAguardandoPagamento(order) {
  const status = String(order?.status || '').toLowerCase()
  const pag = String(order?.pag || '').toLowerCase()
  return status === 'aguardando_cartao'
    || (status === 'aguardando_pix' && pag !== 'pix_manual')
}

function atribuirOrderNumSeNecessario(tid, orderId) {
  if (!tid || !orderId) return null
  const txFn = db.transaction((tenantId, id) => {
    const atual = db.prepare('SELECT id, order_num FROM orders WHERE id=? AND tenant_id=?').get(id, tenantId)
    if (!atual) return null
    if (atual.order_num) {
      db.prepare('UPDATE order_chat_threads SET order_num=?, updated_at=datetime(\'now\') WHERE order_id=? AND tenant_id=?')
        .run(atual.order_num, id, tenantId)
      return Number(atual.order_num)
    }
    const cfg = db.prepare('SELECT order_num_offset FROM store_config WHERE tenant_id=?').get(tenantId)
    const offset = parseInt(cfg?.order_num_offset) || 0
    const row = db.prepare(`
      SELECT COALESCE(MAX(order_num),0) as mx
      FROM orders
      WHERE tenant_id=? AND id>? AND order_num IS NOT NULL
    `).get(tenantId, offset)
    const next = (row?.mx || 0) + 1
    db.prepare('UPDATE orders SET order_num=? WHERE id=? AND tenant_id=? AND order_num IS NULL').run(next, id, tenantId)
    db.prepare('UPDATE order_chat_threads SET order_num=?, updated_at=datetime(\'now\') WHERE order_id=? AND tenant_id=?')
      .run(next, id, tenantId)
    return next
  })
  return txFn(tid, orderId)
}

function numeroPedidoComOffset(order, offset = 0) {
  if (order?.order_num) return Number(order.order_num)
  const id = Number(order?.id || 0)
  const off = Number(offset || 0)
  return id > off ? Math.max(1, id - off) : id
}

function numeroPedidoPad(order, offset = 0) {
  const num = numeroPedidoComOffset(order, offset)
  return num ? String(num).padStart(3, '0') : ''
}

function numeroPedidoServidor(tid, order) {
  const cfg = db.prepare("SELECT order_num_offset FROM store_config WHERE tenant_id=?").get(tid)
  return numeroPedidoComOffset(order, cfg?.order_num_offset)
}

function numeroPedidoChat(order, opts = {}) {
  if (!order) return ''
  if (order.order_num) return Number(order.order_num)
  if (opts.fallback && !pedidoOnlineAguardandoPagamento(order)) {
    return numeroPedidoServidor(order.tenant_id, order)
  }
  return ''
}

function registrarMovimentoFinalizacaoAuto(tid, order) {
  if (!tid || !order) return
  const num = numeroPedidoServidor(tid, order)
  const existe = db.prepare(
    "SELECT id FROM movimentos WHERE tenant_id=? AND tipo='entrada' AND description LIKE ? LIMIT 1"
  ).get(tid, `Pedido #${num} %`)
  if (existe) return
  const total = (parseFloat(order.total || 0) || 0) + (parseFloat(order.taxa || 0) || 0)
  const time = new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Fortaleza'
  })
  db.prepare(
    "INSERT INTO movimentos (tenant_id,description,tipo,val,pag,time) VALUES (?,?,?,?,?,?)"
  ).run(tid, `Pedido #${num} - ${order.client || 'Cliente'}`, 'entrada', total, order.pag || 'PIX', time)
}

function finalizarPedidosSaiuAntigos() {
  try {
    if (!HAS_ORDERS_UPDATED_AT) return
    const rows = db.prepare(
      `SELECT * FROM orders
       WHERE status='saiu'
       AND datetime(COALESCE(updated_at, created_at)) < datetime('now','-8 hours')`
    ).all()
    if (!rows.length) return

    const tx = db.transaction((orders) => {
      for (const order of orders) {
        registrarMovimentoFinalizacaoAuto(order.tenant_id, order)
        db.prepare(
          "UPDATE orders SET status='finalizado', updated_at=datetime('now') WHERE id=? AND tenant_id=? AND status='saiu'"
        ).run(order.id, order.tenant_id)
        registrarStatusPedido(order.tenant_id, order.id, 'saiu', 'finalizado', {
          actor_type: 'system',
          actor_name: 'Auto finalizacao',
          origem: 'auto-finalizar-saiu',
          note: 'Pedido auto-finalizado apos 8h em saiu pra entrega'
        })
      }
    })
    tx(rows)

    log('🧹', `[CLEANUP] ${rows.length} pedido(s) em "saiu pra entrega" há >8h foram auto-finalizados`)
    marcarDirty()
    for (const order of rows) {
      sseBroadcast(`orders-rt:${order.tenant_id}`, 'orders:UPDATE', {
        id: order.id,
        tenant_id: order.tenant_id,
        status: 'finalizado'
      })
    }
  } catch(e) { log('⚠️','[CLEANUP saiu] erro:', e.message) }
}

setTimeout(finalizarPedidosSaiuAntigos, 15 * 1000)
setInterval(finalizarPedidosSaiuAntigos, 5 * 60 * 1000)

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
  estoque:          (tid) => [`estoque-rt:${tid}`],
  estoque_receitas: (tid) => [`estoque-rt:${tid}`],
  estoque_movimentos:(tid) => [`estoque-rt:${tid}`],
  addons_esgotados: (tid) => [`menu-rt:${tid}`],
  entregadores:     (tid) => [`entregas-rt:${tid}`],
  entregas:         (tid) => [`entregas-rt:${tid}`],
  rotas_entrega:    (tid) => [`entregas-rt:${tid}`],
  entregador_locations:(tid) => [`entregas-rt:${tid}`],
  entrega_mensagens:(tid) => [`entregas-rt:${tid}`],
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
const BRASILIA_TZ = 'America/Sao_Paulo'
let _resetDiarioPedidosTimer = null

function brasiliaParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRASILIA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const out = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') out[part.type] = part.value
  }
  if (out.hour === '24') out.hour = '00'
  return out
}

function brasiliaDateString(date = new Date()) {
  const p = brasiliaParts(date)
  return `${p.year}-${p.month}-${p.day}`
}

// Loja permite agendamento quando fechada? Padrão sim (config não existe
// ainda pra quem nunca mexeu nisso — não pode quebrar quem já confiava
// que dava pra deixar pedido agendado antes desse toggle existir).
function _permiteAgendamentoServer(tenantId) {
  try {
    const cfg = db.prepare('SELECT permitir_agendamento FROM store_config WHERE tenant_id=?').get(tenantId)
    if (!cfg || cfg.permitir_agendamento === null || cfg.permitir_agendamento === undefined) return true
    return !!cfg.permitir_agendamento
  } catch(e) { return true }
}

// ── Loja aberta? (validação SERVER-SIDE) ──────────────────────────────────
// Porte fiel da lógica de cardapio-core.js (isLojaAberta / _horarioAbertoNoMinuto
// / _horaParaMinutos etc). Antes, "loja fechada" só era checado no JS do
// cardápio (client-side) — ou seja, dava pra criar pedido com a loja fechada
// bastando chamar POST /api/orders direto (sem passar pela tela). Agora o
// próprio backend recusa o pedido nesse caso, igual já faz com bairro
// bloqueado / delivery pausado logo abaixo.
function _storeOpenAtivoServer(store_open) {
  if (store_open === false || store_open === 0) return false
  if (typeof store_open === 'string') {
    const v = store_open.trim().toLowerCase()
    if (v === 'false' || v === '0' || v === 'fechado') return false
  }
  return true
}
function _horarioAtivoServer(cfg) {
  if (!cfg) return false
  if (cfg.ativo === true || cfg.ativo === 1) return true
  if (typeof cfg.ativo === 'string') {
    const v = cfg.ativo.trim().toLowerCase()
    return v === 'true' || v === '1' || v === 'sim'
  }
  return false
}
function _horaParaMinutosServer(valor) {
  const raw = String(valor || '').trim().toLowerCase().replace(/\s+/g, '')
  const match = raw.match(/^(\d{1,2})(?:(?::|h)(\d{1,2}))?h?$/)
  if (!match) return null
  const h = parseInt(match[1], 10)
  const m = match[2] === undefined ? 0 : parseInt(match[2], 10)
  if (h === 24 && m === 0) return 1440
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}
function _janelasDiaServer(cfg) {
  if (!cfg) return []
  if (Array.isArray(cfg.janelas) && cfg.janelas.length) return cfg.janelas
  if (cfg.abertura || cfg.fechamento) return [{ abertura: cfg.abertura, fechamento: cfg.fechamento }]
  return []
}
function _horarioAbertoNoMinutoServer(cfg, minutoAtual, usandoDiaAnterior) {
  if (!_horarioAtivoServer(cfg)) return false
  const janelas = _janelasDiaServer(cfg)
  if (!janelas.length) return false
  return janelas.some(j => {
    const abertura = _horaParaMinutosServer(j.abertura) ?? 0
    const fechamento = _horaParaMinutosServer(j.fechamento) ?? 1439
    if (abertura === fechamento) return true
    if (fechamento > abertura) return !usandoDiaAnterior && minutoAtual >= abertura && minutoAtual < fechamento
    return usandoDiaAnterior ? minutoAtual < fechamento : minutoAtual >= abertura
  })
}
// Retorna { aberto, motivo } — motivo só preenchido quando aberto=false, pra
// devolver uma mensagem clara no erro 503.
// Decide se uma modalidade ('delivery' ou 'retirada') está pausada agora,
// considerando: (a) se a pausa foi configurada pra incluir essa modalidade
// (padrão: só delivery, pra manter compatível com configs antigas que só
// tinham o campo delivery_pausado sem escolher modalidade), e (b) se ainda
// não passou do prazo, quando um prazo foi definido — sem prazo, fica
// pausado até o gestor desmarcar manualmente.
// Não escreve nada de volta no banco quando expira: é sempre calculado na
// hora, então nunca fica "preso" pausado por engano.
function deliveryPausaAtiva(feeConfig, modalidade) {
  if (!feeConfig?.delivery_pausado) return false
  const modalidades = Array.isArray(feeConfig.delivery_pausado_modalidades) && feeConfig.delivery_pausado_modalidades.length
    ? feeConfig.delivery_pausado_modalidades
    : ['delivery']
  if (!modalidades.includes(modalidade)) return false
  if (feeConfig.delivery_pausado_ate) {
    const expira = new Date(feeConfig.delivery_pausado_ate)
    if (!isNaN(expira) && expira <= new Date()) return false
  }
  return true
}

function isLojaAbertaServer(tenantId) {
  try {
    const cfg = db.prepare('SELECT store_open, horarios_config FROM store_config WHERE tenant_id=?').get(tenantId)
    if (!cfg) return { aberto: true } // sem config cadastrada — não bloqueia (comportamento anterior)
    if (!_storeOpenAtivoServer(cfg.store_open)) return { aberto: false, motivo: 'Loja fechada no momento.' }
    let horarios = null
    try { horarios = cfg.horarios_config ? JSON.parse(cfg.horarios_config) : null } catch(e) { horarios = null }
    if (!horarios || !Object.keys(horarios).length) return { aberto: true } // sem horário configurado — só respeita o toggle manual
    const agora = new Date(new Date().toLocaleString('en-US', { timeZone: BRASILIA_TZ }))
    const dias = ['dom','seg','ter','qua','qui','sex','sab']
    const idxHoje = agora.getDay()
    const minutoAtual = agora.getHours() * 60 + agora.getMinutes()
    const abertoHoje  = _horarioAbertoNoMinutoServer(horarios[dias[idxHoje]], minutoAtual, false)
    const abertoOntem = _horarioAbertoNoMinutoServer(horarios[dias[(idxHoje + 6) % 7]], minutoAtual, true)
    if (abertoHoje || abertoOntem) return { aberto: true }
    return { aberto: false, motivo: 'Loja fechada no momento — fora do horário de funcionamento.' }
  } catch(e) {
    log('⚠️', 'isLojaAbertaServer erro:', e.message)
    return { aberto: true } // falha na checagem não deve travar pedidos legítimos
  }
}

function msUntilNextBrasiliaMidnight(now = new Date()) {
  const p = brasiliaParts(now)
  let targetUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + 1, 3, 0, 5)
  while (targetUtc <= now.getTime()) targetUtc += 24 * 60 * 60 * 1000
  return Math.max(1000, targetUtc - now.getTime())
}

function executarResetDiarioPedidos() {
  const hoje = brasiliaDateString()
  const tenants = db.prepare(`
    SELECT tenant_id
      FROM store_config
     WHERE COALESCE(order_auto_reset_daily,0)=1
       AND COALESCE(order_auto_reset_last_date,'')<>?
  `).all(hoje)
  if (!tenants.length) return 0

  const offset = db.prepare('SELECT COALESCE(MAX(id),0) as max_id FROM orders').get()?.max_id || 0
  const updateCfg = db.prepare(`
    UPDATE store_config
       SET order_num_offset=?,
           order_auto_reset_last_date=?
     WHERE tenant_id=?
  `)

  db.transaction(() => {
    for (const row of tenants) updateCfg.run(offset, hoje, row.tenant_id)
  })()

  marcarDirty()
  for (const row of tenants) {
    const payload = {
      tenant_id: row.tenant_id,
      order_num_offset: offset,
      order_auto_reset_daily: true,
      order_auto_reset_last_date: hoje,
    }
    sseBroadcast(`store-config-rt:${row.tenant_id}`, 'store_config:UPDATE', payload)
    sseBroadcast(`orders-rt:${row.tenant_id}`, 'store_config:UPDATE', payload)
  }
  log('INFO', `Reset diario de pedidos executado para ${tenants.length} tenant(s); offset=${offset}`)
  return tenants.length
}

function agendarResetDiarioPedidos() {
  if (_resetDiarioPedidosTimer) clearTimeout(_resetDiarioPedidosTimer)
  const ms = msUntilNextBrasiliaMidnight()
  _resetDiarioPedidosTimer = setTimeout(() => {
    try {
      executarResetDiarioPedidos()
    } catch (e) {
      log('WARN', 'Reset diario de pedidos falhou:', e.message)
    } finally {
      agendarResetDiarioPedidos()
    }
  }, ms)
}

try {
  const n = executarResetDiarioPedidos()
  if (n > 0) log('INFO', `Reset diario pendente aplicado na inicializacao: ${n} tenant(s)`)
} catch (e) {
  log('WARN', 'Reset diario na inicializacao falhou:', e.message)
}
agendarResetDiarioPedidos()

const TABLE_COLS = {
  tenants:      ['id','nome','plano','ativo','slug','segmento','expires_at','updated_at','created_at','valor_mensalidade','valor_mensalidade_expira_em','telefone_cobranca','voz_ativo'],
  sys_users:    ['id','tenant_id','nome','email','senha_hash','role','ativo','ultimo_acesso','created_at'],
  store_config: ['id','tenant_id','store_open','caixa_open','delivery_fee_config','fid_config','evo_automacoes','evo_aniv_last','wa_server_url','sidebar_state','evo_instance','store_name','store_descricao','store_logo_url','store_banner_url','store_banners','store_cor','store_cor_texto','store_tema','cats_carrossel','store_tempo_entrega','store_tempo_retirada','store_avaliacao','store_whatsapp','gestor_tema','ia_config','horarios_config','order_num_offset','order_auto_reset_daily','order_auto_reset_last_date','cashback_config','pedido_minimo','store_address','store_lat','store_lng','tipos_entrega','print_config','taxa_servico_pct','stamp_config','pickup_addresses','telegram_backup_config','promo_banner_ativo','promo_banner_titulo','promo_banner_destaque','promo_banner_subtitulo','promo_banner_cta_texto','promo_banner_image_url','promo_banner_selo','promo_banner_categoria','promo_banners','mostrar_indicacao_preparo','permitir_agendamento','tablet_splash_bg_url'],
  categories:   ['id','tenant_id','name','label','type','promo','emoji','image_url','sort_order','ativo'],
  menu_items:   ['id','tenant_id','name','description','price','price_old','category_id','cat','cat_key','emoji','image_url','video_url','promo','status','item_type','allow_half','max_flavors','days','ingredients','custom_groups','destaque','sort_order','hide_price','fiscal_ncm','fiscal_cfop','fiscal_icms_origem','fiscal_icms_situacao','fiscal_cest','fiscal_unidade','fiscal_codigo_produto','fiscal_pis_situacao','fiscal_cofins_situacao','created_at'],
  cupons:       ['id','tenant_id','code','type','value','min_order','uses_left','ativo','expires_at'],
  mesas:        ['id','tenant_id','num','status','guests','opened_at','total','pag_forma','taxa_servico','clientes_json','pagamentos_json','nome','updated_at'],
  garcons:      ['id','tenant_id','nome','usuario','senha','ativo'],
  orders:       ['id','tenant_id','client','phone','addr','items','total','taxa','pag','pag_momento','troco','time','status','mesa_num','session_ref','garcom_id','garcom_nome','customer_id','client_request_id','order_num','wa_track','scheduled_for','canal','created_at'],
  movimentos:   ['id','tenant_id','description','tipo','val','pag','time','created_at'],
  estoque:      ['id','tenant_id','name','qty','unit','min_qty','cost','fornecedor_id','updated_at'],
  estoque_receitas: ['id','tenant_id','item_id','estoque_id','qty','unit','ativo','created_at','updated_at'],
  estoque_movimentos: ['id','tenant_id','estoque_id','order_id','item_id','tipo','qty','saldo_antes','saldo_depois','origem','note','created_at'],
  fidelidade:   ['id','tenant_id','name','phone','birthday','pts','max_pts','orders_count','resgates','created_at'],
  customers:    ['id','tenant_id','name','phone','addr','orders_count','total_spent','last_order_at','email','birthday','senha_hash','cashback_saldo','created_at'],
  customer_enderecos: ['id','tenant_id','customer_id','label','cep','rua','numero','bairro','complemento','referencia','is_default','created_at'],
  ratings:      ['id','tenant_id','order_id','client','phone','nota','comentario','created_at'],
  pagamentos_cartao: ['id','tenant_id','order_id','mp_payment_id','mp_external_ref','valor','status','status_detail','payer_name','payer_email','last_four_digits','payment_method_id','created_at','paid_at','mp_source'],
  stamp_progress: ['id','tenant_id','phone','compras','ultimo_resgate'],
  entregadores: ['id','tenant_id','nome','telefone','comissao_tipo','comissao_valor','ativo','created_at'],
  entregas: ['id','tenant_id','order_id','entregador_id','rota_id','sequencia','status','taxa_entrega','valor_pedido','valor_receber','comissao','recebido','problema','assigned_at','saiu_at','entregue_at','created_at','updated_at'],
  rotas_entrega: ['id','tenant_id','entregador_id','status','pedidos_count','total_pedidos','dinheiro_previsto','comissao_total','iniciado_em','finalizado_em','obs','created_at','updated_at'],
  entregador_locations: ['id','tenant_id','entregador_id','entrega_id','lat','lng','accuracy','updated_at'],
  entrega_mensagens: ['id','tenant_id','entrega_id','order_id','entregador_id','tipo','message','ok','error','lat','lng','created_at'],
  order_status_history: ['id','tenant_id','order_id','old_status','new_status','actor_type','actor_id','actor_name','origem','note','created_at'],
  fornecedores: ['id','tenant_id','nome','contato','telefone','email','cnpj','endereco','obs','ativo','created_at'],
  contas_pagar: ['id','tenant_id','descricao','valor','vencimento','categoria','fornecedor_id','recorrente','recorrencia','status','pago_em','obs','created_at'],
  faturas:      ['id','tenant_id','plano','valor','meses','metodo','status','link_pagamento','mp_payment_id','mp_external_ref','qr_code','qr_code_base64','vence_em','pago_em','cancelado_em','obs','created_at'],
  plano_assinaturas: ['id','tenant_id','plano','valor','status','mp_preapproval_id','mp_external_ref','payer_email','payment_method_id','last_authorized_payment_id','last_payment_id','last_payment_status','next_payment_at','started_at','canceled_at','updated_at','created_at'],
  admin_audit_log: ['id','admin_id','admin_nome','admin_email','acao','alvo_tipo','alvo_id','alvo_nome','detalhes','ip','user_agent','created_at'],
  admin_alerts: ['id','tipo','titulo','mensagem','display_mode','bg_color','text_color','font_family','cta_label','cta_whatsapp','target_all','target_tenants','ativo','created_by','created_at','updated_at','expires_at'],
}
// Colunas que NUNCA aparecem na resposta GET — mas ainda funcionam como filtro WHERE e em escrita
const STRIP_FROM_OUTPUT = {
  sys_users:    new Set(['senha_hash']),
  garcons:      new Set(['senha']),
  customers:    new Set(['senha_hash']),
  store_config: new Set([]),
}

const NO_TENANT_FILTER = new Set(['tenants','sys_users','admin_audit_log','admin_alerts'])
// Tabelas em NO_TENANT_FILTER são dados de plataforma (contas de gestor de
// TODOS os restaurantes, tenants, auditoria) — nunca devem ser acessíveis
// sem sessão de admin válida, em nenhum método, nem GET.
const ADMIN_ONLY_TABLES = NO_TENANT_FILTER
// Tabelas tenant-scoped que o CARDÁPIO PÚBLICO (cliente, sem login) precisa
// escrever normalmente: cadastro/login de cliente, endereço salvo, criar/
// atualizar o próprio pedido, avaliar o pedido. Todo o resto das tabelas do
// painel (cardápio/gestão, caixa, estoque, mesas, entregadores, etc.) passa
// a exigir sessão de gestor válida para POST/PATCH/DELETE.
const CUSTOMER_WRITABLE_TABLES = new Set(['orders','ratings','customers','customer_enderecos'])

const FINANCE_REST_RULES = {
  movimentos:   new Set(['GET','PATCH','DELETE']),
  contas_pagar: new Set(['GET','POST','PATCH','DELETE']),
  fornecedores: new Set(['GET','POST','PATCH','DELETE']),
  faturas:      new Set(['GET','POST','PATCH','DELETE']),
}
const JSON_FIELDS = {
  orders:       new Set(['items']),
  mesas:        new Set(['clientes_json','pagamentos_json']),
  menu_items:   new Set(['days','ingredients','custom_groups']),
  store_config: new Set(['delivery_fee_config','fid_config','evo_automacoes','sidebar_state','horarios_config','cashback_config','tipos_entrega','stamp_config']),
  admin_audit_log: new Set(['detalhes']),
  admin_alerts: new Set(['target_tenants']),
}
const BOOL_FIELDS  = new Set(['ativo','store_open','caixa_open','order_auto_reset_daily','destaque','target_all'])
const SSE_TABLES   = new Set(['orders','mesas','store_config','menu_items','categories','garcons','customers','estoque','estoque_receitas','estoque_movimentos','addons_esgotados','entregadores','entregas','rotas_entrega','entregador_locations','entrega_mensagens'])

function jsonParse(v) { if(typeof v!=='string')return v; try{return JSON.parse(v)}catch{return v} }

function phoneLookupArgs(raw) {
  return phoneUtils.phoneLookupArgs(raw)
}

function phoneLookupSql(col = 'phone') {
  return phoneUtils.phoneLookupSql(col)
}

function waInboundOptInHours() {
  const n = parseInt(process.env.WA_INBOUND_OPTIN_HOURS || '24', 10)
  return Math.min(72, Math.max(1, Number.isFinite(n) ? n : 24))
}

function clienteIniciouWhatsappRecentemente(tenantId, phone) {
  if (!tenantId || !phone) return false
  const variants = phoneUtils.phoneLookupVariants(phone)
    .map(v => String(v || '').replace(/\D/g, ''))
    .filter(v => v.length >= 8)
  if (!variants.length) return false

  const jids = [...new Set(variants.flatMap(v => [
    `${v}@s.whatsapp.net`,
    `${v}@c.us`
  ]))]
  if (!jids.length) return false

  const hours = waInboundOptInHours()
  const since = Math.floor(Date.now() / 1000) - hours * 3600
  const q = jids.map(() => '?').join(',')

  try {
    const row = db.prepare(`
      SELECT id, ts
      FROM wa_messages
      WHERE tenant_id=?
        AND from_me=0
        AND remote_jid IN (${q})
        AND (
          (ts > 0 AND ts >= ?)
          OR (ts = 0 AND created_at >= datetime('now', ?))
        )
      ORDER BY ts DESC, created_at DESC
      LIMIT 1
    `).get(tenantId, ...jids, since, `-${hours} hours`)
    return !!row
  } catch(e) {
    log('⚠️', '[wa_track] falha ao checar conversa recente:', e.message)
    return false
  }
}

function waTrackingTextInfo(text) {
  const raw = String(text || '').trim()
  const norm = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s#*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const numMatch = raw.match(/#\s*\*?\s*(\d{1,6})\s*\*?/)
    || norm.match(/pedido\s*(?:numero|nro|no|n)?\.?\s*[*#:]?\s*(\d{1,6})/i)
    || norm.match(/numero\s*(?:do\s+pedido)?\s*[*#:]?\s*(\d{1,6})/i)
  const wantsTracking = /\b(acompanhar\s+(meu\s+|o\s+)?pedido|quero\s+acompanhar\s+(meu\s+)?pedido|rastrear\s+(meu\s+|o\s+)?pedido|rastreio\s+(do\s+)?pedido|meu\s+pedido|status\s+(do\s+)?pedido|cade\s+(meu|o)\s+pedido|onde\s+(esta|ta)\s+(meu|o)\s+pedido|quanto\s+(tempo|falta)|pedido\s+(saiu|chegou|ta|esta|ainda|atrasou|atrasado|demorando|pronto|saira|sai)|saiu\s+(da|para|pra)\s+entrega|ja\s+saiu|ja\s+(fiz|pedi)\s+(meu\s+|um\s+)?pedido|acabei\s+de\s+(fazer|pedir))\b/i.test(norm)
  return {
    number: numMatch ? parseInt(numMatch[1], 10) : null,
    intent: !!numMatch || wantsTracking
  }
}

async function responderAcompanhamentoWhatsapp({ tenantId, phone, text, msgIds = [], cfg = {} }) {
  const info = waTrackingTextInfo(text)
  if (!info.intent || !tenantId || !phone) return false

  const inst = cfg?.evo_instance || EVO_INST
  const offset = parseInt(cfg?.order_num_offset || 0) || 0
  const phoneWhere = phoneLookupSql('phone')
  const phoneArgs = phoneLookupArgs(phone)
  let pedido = null

  if (info.number) {
    // IMPORTANTE: order_num só é gravado no banco sob demanda (em certas ações
    // específicas) — um pedido novíssimo pode ainda estar com order_num NULL
    // no momento em que o cliente pergunta pelo WhatsApp. O número que o
    // cliente vê/digita, porém, já é calculado (id - offset) mesmo sem estar
    // gravado. Buscar só por "order_num=?" nesse caso não acha o pedido de
    // hoje (coluna NULL não bate) e podia devolver um pedido antigo do mesmo
    // cliente que, por coincidência, tem esse número gravado de verdade (o
    // contador de número reinicia todo dia, então números se repetem entre
    // dias diferentes). Por isso comparamos o número EXIBIDO de cada pedido
    // recente (gravado ou calculado, com a mesma fórmula usada em toda a
    // parte) e priorizamos o mais recente que bater.
    const candidatos = db.prepare(`
      SELECT id,order_num,client,status,total,taxa,items,addr,pag,troco,created_at
      FROM orders
      WHERE tenant_id=? AND ${phoneWhere}
      ORDER BY id DESC
      LIMIT 100
    `).all(tenantId, ...phoneArgs)
    pedido = candidatos.find(c => numeroPedidoComOffset(c, offset) === info.number) || null
  } else {
    pedido = db.prepare(`
      SELECT id,order_num,client,status,total,taxa,items,addr,pag,troco,created_at
      FROM orders
      WHERE tenant_id=? AND ${phoneWhere}
      ORDER BY id DESC
      LIMIT 1
    `).get(tenantId, ...phoneArgs)
  }

  // Pedido já cancelado — não faz sentido o robô responder com a barra de
  // progresso completa (Recebido > Em preparo > ... > Entregue) pra um
  // pedido que nunca passou por esses passos de verdade. "Entregue" fica
  // de fora dessa checagem de propósito: é o final feliz normal de quase
  // todo pedido, e é comum o cliente confirmar "chegou?" logo depois — aí
  // sim faz sentido o robô responder confirmando.
  if (pedido && String(pedido.status || '').toLowerCase() === 'cancelado') {
    log('🔇', `[wa_track] Pedido #${pedido.id} está cancelado — não responde acompanhamento automático`)
    return false
  }

  let resposta = ''
  if (pedido) {
    const statusRaw = String(pedido.status || '').toLowerCase()
    const pagRaw = String(pedido.pag || '').toLowerCase()
    const pendenteOnline = statusRaw === 'aguardando_cartao' || (statusRaw === 'aguardando_pix' && pagRaw !== 'pix_manual')
    const orderNumber = pedido.order_num
      ? String(pedido.order_num).padStart(3, '0')
      : (pendenteOnline ? '' : String(atribuirOrderNumSeNecessario(tenantId, pedido.id) || numeroPedidoPad(pedido, offset)).padStart(3, '0'))

    try {
      db.prepare("UPDATE orders SET wa_track=1 WHERE id=? AND tenant_id=? AND COALESCE(wa_track,0)=0").run(pedido.id, tenantId)
    } catch(e) {
      log('⚠️', '[wa_track] falha ao ativar no rastreio:', e.message)
    }

    resposta = buildOrderTrackingMessage({
      order: pedido,
      storeName: cfg?.store_name || 'Restaurante',
      orderNumber,
      includeTrackingNote: true
    })
    log('✅', `[wa_track] Pedido #${pedido.id} ativado por solicitação de acompanhamento no WhatsApp`)
  } else if (info.number) {
    resposta = `🔎 Não encontrei o pedido *#${String(info.number).padStart(3, '0')}* aqui pra esse número de WhatsApp. Confere se o número do pedido está certo, ou chama a loja que a gente te ajuda!`
  } else {
    resposta = '🔎 Não encontrei nenhum pedido recente pra esse número de WhatsApp. Se você fez o pedido com outro número, chama a loja que a gente confere pra você!'
  }

  try {
    for (const id of msgIds.filter(Boolean)) await markAsRead(phone, id, inst)
    await sleep(800 + Math.floor(Math.random() * 900))
    await sendWA(phone, resposta, inst, Math.min(6000, 1200 + resposta.length * 32))
  } catch(e) {
    log('❌', '[wa_track] erro ao responder acompanhamento:', e.message)
  }
  return true
}

function parseRow(table, row, opts={}) {
  if (!row) return row
  const out = { ...row }
  const jf  = JSON_FIELDS[table]
  if (jf) for (const f of jf) { if (f in out) out[f] = jsonParse(out[f]) }
  for (const f of BOOL_FIELDS) { if (f in out) out[f] = out[f] === 1 || out[f] === true }
  // ia_config guarda a chave da OpenAI e o token do Mercado Pago do tenant,
  // mas fica de fora do JSON_FIELDS de propósito (não é parseado acima) —
  // assim ele nunca sai como objeto pronto pra usar sem passar por aqui.
  // O painel do gestor só precisa dos campos de configuração do robô
  // (ativo, textos, toggles); a chave de verdade só deve sair pelo admin,
  // que já usa uma rota própria e autenticada (/api/admin-backup/ia-config)
  // — essa rota chama parseRow com {raw:true} pra não perder o valor.
  if (table === 'store_config' && !opts.raw && typeof out.ia_config === 'string' && out.ia_config) {
    try {
      const ia = JSON.parse(out.ia_config)
      if (ia && typeof ia === 'object') {
        delete ia.openai_key
        delete ia.mp_token
        delete ia.mp_public_key
        out.ia_config = JSON.stringify(ia)
      }
    } catch(e) {}
  }
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
  // sys_users: nunca aceita senha_hash vindo do cliente (não dá pra saber
  // se foi calculado com o esquema forte certo) — só senha em texto puro,
  // que o servidor mesmo hasheia com scrypt antes de gravar.
  if (table === 'sys_users') {
    delete out.senha_hash
    if (out.senha) { out.senha_hash = hashPassword(String(out.senha)); delete out.senha }
  }
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

// Confirma que quem está pedindo os dados de um customer_id específico é
// de fato aquele cliente — reaproveita o mesmo esquema de token usado em
// /api/favoritos e /api/customer-orders (token = base64 de
// "customerId:tenantId:prefixoDoHashDaSenha"). Sem isso, o filtro
// "customer_id=eq.X" sozinho não provava nada — qualquer um podia trocar
// o X e ler o endereço salvo de outro cliente.
function _validarTokenClienteServer(tid, cid, req) {
  const auth = req.headers['authorization'] || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return false
  try {
    const decoded = Buffer.from(token, 'base64').toString()
    const [tkCid, tkTid, tkHashPrefix] = decoded.split(':')
    if (String(tkCid) !== String(cid) || String(tkTid) !== String(tid)) return false
    const custRow = db.prepare('SELECT senha_hash FROM customers WHERE id=? AND tenant_id=?').get(cid, tid)
    if (!custRow || !custRow.senha_hash || custRow.senha_hash.slice(0, 16) !== tkHashPrefix) return false
    return true
  } catch (e) { return false }
}

async function handleREST(req, res, table, params, body) {
  const cols = TABLE_COLS[table]
  if (!cols) return send(res, 404, { error: 'Tabela não encontrada' })
  if (table === 'tenants' && req.method === 'GET') {
    // Preço promocional/personalizado vencido volta pro valor geral antes de listar
    try {
      db.prepare(`
        UPDATE tenants SET valor_mensalidade=NULL, valor_mensalidade_expira_em=NULL
        WHERE valor_mensalidade IS NOT NULL
          AND valor_mensalidade_expira_em IS NOT NULL
          AND date(valor_mensalidade_expira_em) < date('now')
      `).run()
    } catch (e) {}
  }
  const tenantId        = getTenantId(req, params)
  const tenantScoped    = cols.includes('tenant_id') && !NO_TENANT_FILTER.has(table)
  // ISOLAMENTO TOTAL: qualquer operação (inclusive GET) numa tabela com tenant_id
  // exige x-tenant-id/_tenant. Sem isso, buildWhere() não filtraria por tenant
  // e a query devolveria/afetaria linhas de TODOS os tenants misturadas.
  // Antes só PATCH/DELETE eram bloqueados — GET sem tenant vazava pedidos/mesas
  // de outras lojas quando a sessão do cliente ainda não tinha carregado o tenant_id.
  if (tenantScoped && !tenantId) {
    return send(res, 400, { error: 'x-tenant-id obrigatório' })
  }
  // Tabelas de plataforma (contas de gestor, tenants, auditoria): exigem
  // sessão de admin válida em QUALQUER método, sem exceção.
  if (ADMIN_ONLY_TABLES.has(table) && !validarSessaoAdmin(req)) {
    return send(res, 401, { error: 'Sessão de administrador inválida ou ausente' })
  }
  // Demais tabelas do painel (tudo que não é escrita segura do cardápio
  // público): POST/PATCH/DELETE exigem sessão de gestor válida do próprio
  // tenant. Antes bastava saber o tenant_id (visível no cardápio público)
  // pra criar/editar/apagar qualquer coisa — cardápio, estoque, mesas, etc.
  if (!ADMIN_ONLY_TABLES.has(table) && !CUSTOMER_WRITABLE_TABLES.has(table) &&
      ['POST','PATCH','DELETE'].includes(req.method) &&
      !validarSessaoGestor(req, tenantId, table)) {
    return send(res, 401, { error: 'Sessão de gestor inválida ou expirada. Faça login novamente.' })
  }
  // Leitura de "orders" sem sessão de gestor: só libera quando é uma busca
  // exata por um id específico (é assim que o próprio cliente acompanha o
  // pedido dele, sem precisar logar — ver cardapio-tracking.js e
  // cardapio-auth.js). Sem esse id exato, seria uma listagem/busca ampla —
  // aí sim precisa de sessão, senão dava pra ler todos os pedidos (e os
  // dados de cliente dentro deles) de qualquer loja só sabendo o tenant_id,
  // que não é secreto (aparece pra qualquer visitante do cardápio público).
  // try/catch com "falha aberta": se algo inesperado der erro aqui dentro,
  // deixa passar em vez de derrubar a tela inteira do gestor (relatórios,
  // kanban, etc.) — só registra no log pra investigar depois. Prefiro uma
  // checagem de segurança falhando silenciosamente a quebrar o painel.
  try {
    if (table === 'orders' && req.method === 'GET' && !validarSessaoGestor(req, tenantId, table)) {
      const idFiltro = params.get('id') || ''
      const idExato = /^eq\.\d+$/.test(idFiltro)
      if (!idExato) {
        return send(res, 401, { error: 'Sessão de gestor inválida ou expirada. Faça login novamente.' })
      }
    }
  } catch(e) { log('⚠️', 'checagem de leitura de orders falhou, liberando:', e.message) }
  // "customers": sem sessão de gestor, só libera busca por telefone exato
  // (é o que o checkout usa pra ver se aquele telefone já é cliente antes
  // de pedir login — não expõe endereço nem senha, só contagem de pedidos).
  // Nunca libera listagem sem filtro (dump da base toda de clientes).
  try {
    if (table === 'customers' && req.method === 'GET' && !validarSessaoGestor(req, tenantId, table)) {
      const phoneExato = /^eq\./.test(params.get('phone') || '')
      if (!phoneExato) {
        return send(res, 401, { error: 'Sessão de gestor inválida ou expirada. Faça login novamente.' })
      }
    }
  } catch(e) { log('⚠️', 'checagem de leitura de customers falhou, liberando:', e.message) }
  // "customer_enderecos" guarda endereço de casa — mais sensível, então
  // aqui exige prova de verdade de que quem está pedindo é o próprio
  // cliente dono do endereço (reaproveita o token que já existe pra
  // favoritos), não só "sabia o número certo pra por no filtro".
  try {
    if (table === 'customer_enderecos' && req.method === 'GET' && !validarSessaoGestor(req, tenantId, table)) {
      const customerIdFiltro = (params.get('customer_id') || '').match(/^eq\.(\d+)$/)
      const idFiltro = (params.get('id') || '').match(/^eq\.(\d+)$/)
      let cidParaValidar = customerIdFiltro?.[1] || null
      if (!cidParaValidar && idFiltro) {
        // Busca por id do próprio endereço (não do cliente) — descobre de
        // quem é esse endereço antes de decidir se libera.
        const end = db.prepare('SELECT customer_id FROM customer_enderecos WHERE id=? AND tenant_id=?').get(idFiltro[1], tenantId)
        cidParaValidar = end?.customer_id || null
      }
      if (!cidParaValidar || !_validarTokenClienteServer(tenantId, cidParaValidar, req)) {
        return send(res, 401, { error: 'Não autorizado.' })
      }
    }
  } catch(e) { log('⚠️', 'checagem de leitura de customer_enderecos falhou, liberando:', e.message) }
  if (FINANCE_REST_RULES[table]?.has(req.method) && !validarFinanceAccess(req, tenantId)) {
    return sendFinanceLocked(res)
  }
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

      let orderReqId = ''
      if (table === 'orders') {
        const rawReqId = String(payload.client_request_id || '').trim()
        if (/^[A-Za-z0-9._:-]{12,128}$/.test(rawReqId)) {
          orderReqId = rawReqId
          payload.client_request_id = orderReqId
          const orderReqTid = tenantId || payload.tenant_id
          if (orderReqTid) {
            const existing = db.prepare('SELECT * FROM orders WHERE tenant_id=? AND client_request_id=?').get(orderReqTid, orderReqId)
            if (existing) {
              if (parseInt(existing.wa_track || 0) !== 1 && clienteIniciouWhatsappRecentemente(orderReqTid, existing.phone || payload.phone)) {
                try {
                  db.prepare('UPDATE orders SET wa_track=1 WHERE id=? AND tenant_id=?').run(existing.id, orderReqTid)
                  existing.wa_track = 1
                  log('✅', `[wa_track] Pedido #${existing.id} ativado por conversa recente no WhatsApp`)
                } catch(e) { log('⚠️', '[wa_track] falha ao ativar pedido existente:', e.message) }
              }
              log('↩️', `Pedido idempotente reutilizado tenant=${existing.tenant_id} order_id=${existing.id} order_num=${existing.order_num || ''}`)
              return send(res, 200, returnRep ? parseRow(table, existing) : { id: existing.id })
            }
          }
        } else {
          delete payload.client_request_id
        }

        const orderTid = tenantId || payload.tenant_id
        const autoTrack = clienteIniciouWhatsappRecentemente(orderTid, payload.phone)
        payload.wa_track = autoTrack ? 1 : 0
        if (autoTrack) {
          log('✅', `[wa_track] Novo pedido será acompanhado: cliente iniciou conversa no WhatsApp nas últimas ${waInboundOptInHours()}h`)
        }
      }

      // ── Validação server-side para orders ────────────────────────────────
      // Previne: (a) bypass de bairros_bloqueados via API direta;
      //          (b) downgrade de taxa fixa via cliente malicioso;
      //          (c) cobrança indevida em retirada/mesa.
      if (table === 'orders' && tenantId) {
        // Loja fechada: recusa o pedido no servidor mesmo que o front (JS do
        // cardápio) não tenha bloqueado — ver isLojaAbertaServer() acima.
        // IMPORTANTE: só aplica pra pedidos que vêm do cardápio público
        // (marcados com origem_pedido='cardapio_publico' pelo cardapio-checkout.js).
        // PDV (gestor-caixa), garçom/salão e mesa NÃO mandam esse campo — o
        // gestor tem que poder lançar pedido internamente mesmo com o
        // cardápio online marcado como fechado. origem_pedido não é coluna
        // real da tabela, então é descartado automaticamente antes do INSERT.
        if (payload.origem_pedido === 'cardapio_publico') {
          // Conta bloqueada por falta de pagamento (inativa ou plano vencido)
          // — o cardápio público não pode continuar aceitando pedido novo
          // nessa situação, mesmo que a loja esteja "aberta" no horário.
          // PDV/garçom/mesa não passam por aqui (não mandam origem_pedido),
          // então o gestor ainda consegue fechar pedidos que já estavam em
          // andamento fisicamente, só o cardápio online é que para.
          const _tenantAtivo = db.prepare('SELECT ativo, expires_at FROM tenants WHERE id=?').get(tenantId)
          if (_tenantAtivo) {
            const _venceu = _tenantAtivo.expires_at && new Date(_tenantAtivo.expires_at + 'T23:59:59') < new Date()
            if (_tenantAtivo.ativo === 0 || _venceu) {
              return send(res, 503, { error: 'Loja temporariamente indisponível. Tente novamente mais tarde.' })
            }
          }

          const _chk = isLojaAbertaServer(tenantId)
          if (!_chk.aberto) {
            // Loja fechada — mas se o cliente confirmou um pedido AGENDADO no
            // modal de loja fechada (scheduled_for preenchido) e o gestor não
            // desativou esse recurso, deixa passar mesmo assim.
            const ehAgendado = !!payload.scheduled_for && _permiteAgendamentoServer(tenantId)
            if (!ehAgendado) {
              return send(res, 503, { error: _chk.motivo || 'Loja fechada no momento.' })
            }
          }

          // ── Validação de preço (só pedido do cardápio público) ──────────
          // Não dá pra recalcular o preço exato aqui: tem item por peso/kg,
          // kit montado, meio a meio de pizza, adicionais e preço escondido
          // — cada um calcula diferente, e refazer tudo isso no servidor sem
          // testar direito arriscaria travar pedido legítimo por engano.
          // Em vez disso, dois cuidados que são seguros pra qualquer caso:
          //   1) todo item precisa existir de verdade no cardápio da loja
          //      (barra item inventado do zero);
          //   2) um item SEM nenhuma opção de customização (sem adicional,
          //      sem peso, sem kit — o caso mais simples) não pode chegar
          //      com menos da metade do preço cadastrado; nesse caso
          //      específico não existe motivo legítimo pro valor ser tão
          //      menor, então é o sinal mais seguro de manipulação.
          try {
            const orderItems = Array.isArray(payload.items) ? payload.items
              : (typeof payload.items === 'string' ? JSON.parse(payload.items) : [])
            for (const it of orderItems) {
              if (it?.id == null) continue // item avulso sem id de catálogo (ex: taxa extra) — não valida
              const catalogItem = db.prepare('SELECT price, item_type, custom_groups FROM menu_items WHERE id=? AND tenant_id=?').get(it.id, tenantId)
              if (!catalogItem) {
                return send(res, 422, { error: `Item "${it.name || it.id}" não existe mais no cardápio.` })
              }
              const isKg = catalogItem.item_type === 'kg'
              let temGrupos = false
              try { temGrupos = !!(JSON.parse(catalogItem.custom_groups || '[]')?.length) } catch(e) {}
              if (!isKg && !temGrupos) {
                const precoCatalogo = parseFloat(catalogItem.price) || 0
                const precoPedido   = parseFloat(it.price) || 0
                if (precoCatalogo > 0 && precoPedido < precoCatalogo * 0.5) {
                  return send(res, 422, { error: `Preço de "${it.name || 'item'}" não confere com o cardápio.` })
                }
              }
            }
          } catch(e) { log('⚠️', 'validação de preço falhou:', e.message) }
        }

        const addrRaw = String(payload.addr || '').trim()
        const isMesa     = (payload.mesa_num != null && payload.mesa_num !== '') || /^Mesa\b/i.test(addrRaw)
        const isRetirada = /^Retirada\b/i.test(addrRaw)
        const isDelivery = !isMesa && !isRetirada && addrRaw.length > 0

        if (!isDelivery) {
          // Mesa ou retirada: nunca cobra taxa de entrega
          payload.taxa = 0
          if (isRetirada) {
            try {
              const scR = db.prepare('SELECT delivery_fee_config FROM store_config WHERE tenant_id=?').get(tenantId)
              const cfgR = scR?.delivery_fee_config ? jsonParse(scR.delivery_fee_config) : {}
              if (deliveryPausaAtiva(cfgR, 'retirada')) {
                return send(res, 503, { error: 'Retirada temporariamente pausada pela loja. Tente delivery ou aguarde alguns minutos.' })
              }
            } catch (e) { log('⚠️', 'checagem de pausa de retirada falhou:', e.message) }
          }
        } else {
          try {
            const sc = db.prepare('SELECT delivery_fee_config FROM store_config WHERE tenant_id=?').get(tenantId)
            const cfg = sc?.delivery_fee_config ? jsonParse(sc.delivery_fee_config) : {}

            // Pausa de delivery: rejeita pedidos novos (considera prazo e
            // se essa modalidade específica realmente está na pausa)
            if (deliveryPausaAtiva(cfg, 'delivery')) {
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

            // Os 3 bloqueios de "config incompleta" abaixo (422) só valem pro
            // cardápio público. Pedido criado pelo próprio gestor/PDV/garçom
            // (origem_pedido não vem preenchido nesses casos) precisa continuar
            // podendo lançar entrega manual mesmo pra bairro fora da lista ou
            // com a taxa ainda não configurada — é uma decisão da loja, não
            // um bug. Sem essa distinção, isso quebraria o PDV interno.
            const _origemPublica = payload.origem_pedido === 'cardapio_publico'

            // Config nunca foi salva de verdade pra essa loja (delivery_fee_config
            // vazio no banco). O painel do gestor mostra "Fixo, R$5" por padrão
            // mesmo nesse caso, então o dono pode achar que está configurado
            // quando na real não está. Sem essa checagem, nenhum dos branches
            // abaixo (fixo/por_bairro/por_km) entra em ação e o servidor aceita
            // de graça o que o cliente mandar.
            if (_origemPublica && !['fixo', 'por_km', 'por_bairro'].includes(cfg.tipo)) {
              return send(res, 422, { error: 'A taxa de entrega ainda não foi configurada pela loja.' })
            }

            // Anti-downgrade: taxa fixa não pode ser menor que o configurado
            if (cfg.tipo === 'fixo') {
              const taxaConf  = parseFloat(cfg.valor) || 0
              const taxaEnvio = parseFloat(payload.taxa) || 0
              if (taxaEnvio < taxaConf) payload.taxa = taxaConf
            }
            // por_bairro — se algum bairro cadastrado bate, força a taxa correta.
            // Se a lista estiver vazia OU nenhum bairro do endereço bater, a
            // loja está com a área de entrega mal configurada (ou o cliente
            // digitou um endereço fora da área) — ANTES isso deixava passar
            // com a taxa que o cliente mandou (podendo ser R$0). Agora recusa
            // o pedido do cardápio público em vez de aceitar de graça
            // silenciosamente (pedido do gestor/PDV segue liberado).
            else if (cfg.tipo === 'por_bairro') {
              const bairrosCfg = Array.isArray(cfg.bairros) ? cfg.bairros : []
              if (!bairrosCfg.length) {
                if (_origemPublica) return send(res, 422, { error: 'A área de entrega ainda não foi configurada pela loja para cobrança por bairro.' })
              } else {
                const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()
                const addrNorm = norm(addrRaw)
                let bateu = false
                for (const b of bairrosCfg) {
                  const bNorm = norm(b.bairro)
                  if (bNorm && addrNorm.includes(bNorm)) {
                    bateu = true
                    const taxaConf = parseFloat(b.taxa) || 0
                    if ((parseFloat(payload.taxa)||0) < taxaConf) payload.taxa = taxaConf
                    break
                  }
                }
                if (!bateu && _origemPublica) {
                  return send(res, 422, { error: 'Não foi possível confirmar a taxa de entrega para o bairro informado. Confira o endereço ou fale com a loja.' })
                }
              }
            }
            // por_km: não há como recalcular a distância sem GPS no servidor,
            // mas se a loja nem tem faixas cadastradas é config incompleta —
            // isso não deve virar entrega grátis por acidente no cardápio público.
            else if (cfg.tipo === 'por_km') {
              const faixasCfg = Array.isArray(cfg.faixas) ? cfg.faixas : []
              if (!faixasCfg.length && _origemPublica) {
                return send(res, 422, { error: 'A área de entrega ainda não foi configurada pela loja para cobrança por distância.' })
              }
            }
          } catch(e) { log('⚠️', 'validação de delivery falhou:', e.message) }
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      if (table === 'store_config') {
        if (Object.prototype.hasOwnProperty.call(payload, 'order_auto_reset_daily') &&
            !Object.prototype.hasOwnProperty.call(payload, 'order_auto_reset_last_date')) {
          const ativoReset = payload.order_auto_reset_daily === true || payload.order_auto_reset_daily === 1 || payload.order_auto_reset_daily === '1'
          if (ativoReset) payload.order_auto_reset_last_date = brasiliaDateString()
        }
        // Proteção contra apagar openai_key/mp_token sem querer: como esses
        // campos agora nunca saem pra fora em GET (ver parseRow acima), o
        // painel do gestor faz "lê ia_config, muda só os toggles/textos,
        // regrava tudo" — sem essa camada aqui, essa regravação salvaria
        // ia_config SEM a chave (porque o gestor nunca a recebeu), apagando
        // a configuração da IA daquela loja sem ninguém pedir isso.
        // Só entra em ação quando a requisição vem com x-tenant-id (é assim
        // que o painel do GESTOR sempre chama) — o admin, que legitimamente
        // precisa poder apagar uma chave, usa uma rota própria autenticada
        // (/api/admin-backup/ia-config) que nunca passa por aqui.
        if (tenantId && Object.prototype.hasOwnProperty.call(payload, 'ia_config')) {
          try {
            const incoming = typeof payload.ia_config === 'string' ? JSON.parse(payload.ia_config) : payload.ia_config
            const existente = db.prepare('SELECT ia_config FROM store_config WHERE tenant_id=?').get(tenantId)
            const atual = existente?.ia_config ? JSON.parse(existente.ia_config) : {}
            if (incoming && typeof incoming === 'object') {
              for (const campoSegredo of ['openai_key', 'mp_token', 'mp_public_key']) {
                if (!(campoSegredo in incoming) && atual[campoSegredo] !== undefined) {
                  incoming[campoSegredo] = atual[campoSegredo]
                }
              }
              payload.ia_config = JSON.stringify(incoming)
            }
          } catch(e) { log('⚠️', 'merge ia_config falhou:', e.message) }
        }
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
      let info
      try {
        info = stmt.run(...keys.map(k=>sanitize(payload[k])))
      } catch(e) {
        if (table === 'orders' && orderReqId && /UNIQUE constraint failed/i.test(e.message || '')) {
          const orderReqTid = tenantId || payload.tenant_id
          if (orderReqTid) {
            const existing = db.prepare('SELECT * FROM orders WHERE tenant_id=? AND client_request_id=?').get(orderReqTid, orderReqId)
            if (existing) {
              log('↩️', `Pedido idempotente reutilizado apos corrida tenant=${existing.tenant_id} order_id=${existing.id} order_num=${existing.order_num || ''}`)
              return send(res, 200, returnRep ? parseRow(table, existing) : { id: existing.id })
            }
          }
        }
        throw e
      }

      // ── Auto-assign order_num sequencial por tenant (atômico via transação) ──
      // Race: 2 pedidos simultâneos podem ler o mesmo MAX e gerar order_num duplicado.
      // Solução: executar SELECT MAX + UPDATE dentro de uma transação BEGIN IMMEDIATE.
      // SQLite + better-sqlite3 serializa as transações, então duas threads concorrentes
      // esperam uma a outra — sem duplicação.
      if (table === 'orders' && info.lastInsertRowid) {
        const _tid = tenantId || payload.tenant_id
        if (_tid && !pedidoOnlineAguardandoPagamento(payload)) {
          try {
            const txFn = db.transaction((tenantId, rowid) => {
              const cfg = db.prepare('SELECT order_num_offset FROM store_config WHERE tenant_id=?').get(tenantId)
              const offset = parseInt(cfg?.order_num_offset) || 0
              const row = db.prepare('SELECT COALESCE(MAX(order_num),0) as mx FROM orders WHERE tenant_id=? AND id>?').get(tenantId, offset)
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
      if (table === 'orders' && rawForEmit) aplicarBaixaEstoquePedido(tenantId || payload.tenant_id, rawForEmit, 'order-create')
      let inserted = null
      if (returnRep) {
        if (table==='sys_users'&&rawForEmit) { const t=db.prepare('SELECT nome,plano,ativo,expires_at FROM tenants WHERE id=?').get(rawForEmit.tenant_id); inserted=parseRow(table,{...rawForEmit,tenants:t?{nome:t.nome,plano:t.plano,ativo:t.ativo===1,expires_at:t.expires_at}:null}) }
        else inserted = parsedForEmit
      }
      if (SSE_TABLES.has(table)) emit(tenantId||payload.tenant_id, table, parsedForEmit||payload, 'INSERT')
      if (table === 'orders' && rawForEmit) chatNotifyOrderCreated(rawForEmit)

      // Notificacao "Pedido Recebido" na criacao do pedido.
      // Para pix_manual, o bloco pix_cobranca abaixo ja envia a comanda com itens/total
      // junto da chave PIX; aqui evitamos duplicar e tratamos os demais pagamentos.
      if (table === 'orders' && rawForEmit && rawForEmit.phone && rawForEmit.pag !== 'pix_manual' && !pedidoOnlineAguardandoPagamento(rawForEmit)) {
        const _ord = rawForEmit
        const _tid = _ord.tenant_id
        setImmediate(async () => {
          try {
            const cfg   = db.prepare('SELECT evo_instance, evo_automacoes, order_num_offset, store_name FROM store_config WHERE tenant_id=?').get(_tid)
            const inst  = cfg?.evo_instance || EVO_INST
            const auto  = (() => { try { return JSON.parse(cfg?.evo_automacoes||'{}') } catch { return {} } })()
            const recAuto = auto['recebido'] || {}
            if (recAuto.on === false) { log('⏭️','Automacao recebido desligada'); return }
            const trackingAtivo = parseInt(_ord.wa_track || 0) === 1
            if (!trackingAtivo) {
              log('🔕', `[anti-ban] Pulando comanda do pedido #${_ord.id} — cliente não ativou tracking via WhatsApp`)
              return
            }
            // Usa a mesma lógica de atribuição por tenant que o resto do
            // sistema usa — evita o cálculo antigo (id - offset), que era
            // GLOBAL entre todos os restaurantes da plataforma, não por
            // tenant, e por isso mostrava número errado nessa mensagem
            // automática (disparada antes do order_num ser gravado).
            const numeroReal = atribuirOrderNumSeNecessario(_tid, _ord.id) || numeroPedidoPad(_ord, parseInt(cfg?.order_num_offset) || 0)
            const idStr  = String(numeroReal).padStart(3, '0')
            const nome   = _ord.client || 'Cliente'
            const items  = (() => {
              try {
                return (JSON.parse(_ord.items) || []).map(i => {
                  const base = `${i.qty || 1}x ${i.name || 'Item'}`
                  return i.obs ? `${base} (${i.obs})` : base
                }).join('\n')
              } catch { return '' }
            })()
            const total = (parseFloat(_ord.total||0) + parseFloat(_ord.taxa||0)).toFixed(2).replace('.',',')
            const loja  = cfg?.store_name || 'Restaurante'
            const msgPadrao = `🏪 *${loja}*\n${'-'.repeat(20)}\n\n📥 *Pedido recebido - #${idStr}*\n\nOlá, *${nome.split(' ')[0]}*! Recebemos seu pedido.\n\n*Itens*\n${items || 'Itens do pedido'}\n\n*Total:* R$ ${total}\n\nEm breve confirmaremos por aqui.`
            const msgFinal = recAuto.msg ? fillVars(recAuto.msg, { nome, id: idStr, itens: items, total, loja, endereco: _ord.addr || '', mesa: String(_ord.mesa_num || '') }) : msgPadrao
            const r = await sendWA(_ord.phone, msgFinal, inst, _autoDelayMs())
            if (r.ok) log('📤', `Comanda recebido enviada → ${_ord.phone} pedido #${idStr}`)
            else      log('⚠️', `Comanda recebido falhou WA → ${_ord.phone}`)
          } catch(e) { log('❌','Erro notif recebido:', e.message) }
        })
      }

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
            const trackingAtivo = parseInt(_ord.wa_track || 0) === 1
            if (!trackingAtivo) {
              log('🔕', `[anti-ban] Pulando comanda PIX manual do pedido #${_ord.id} — cliente não ativou tracking via WhatsApp`)
              return
            }
            const pixAuto = auto['pix_cobranca'] || {}
            if (pixAuto.on === false) { log('⏭️','Automação pix_cobranca desligada'); return }
            const numeroRealP = atribuirOrderNumSeNecessario(_tid, _ord.id) || numeroPedidoPad(_ord, parseInt(cfg?.order_num_offset) || 0)
            const idStr   = String(numeroRealP).padStart(3, '0')
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
            const msgPadrao = `${_emP} *${lojaP}*\n${'-'.repeat(20)}\n\n💠 *PIX manual - Pedido #${idStr}*\n\nOlá, *${_nomeP}*! Recebemos seu pedido.\n\n*Itens*\n${(items||'').split(', ').map(i=>'• '+i).join('\n')}\n\n*Total:* R$ ${total}\n\nPara confirmar, faça o PIX:\n*Tipo:* ${tipoChave}\n*Chave:* ${chavePix}\n\nAssim que o pagamento for confirmado, seguimos com o preparo.`
            const msgFinal  = pixAuto.msg ? fillVars(pixAuto.msg, { nome, id: idStr, itens: items, total, chave_pix: chavePix, tipo_chave: tipoChave }) : msgPadrao
            const r = await sendWA(_ord.phone, msgFinal, inst, _autoDelayMs())
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
      // "orders" é escrita liberada pro cardápio público (cliente cria o
      // próprio pedido sem logar), mas o id do pedido é só um número
      // sequencial — bem fácil de adivinhar. Sem sessão de gestor, o PATCH
      // só pode mexer nos 2 campos que o cardápio realmente usa (total, ao
      // aplicar cashback; pag, quando cai no modo Pix manual) — nunca em
      // status, itens, cliente, endereço, etc. Antes dava pra reescrever um
      // pedido de OUTRO cliente inteiro só sabendo o número dele.
      if (table === 'orders' && !validarSessaoGestor(req, tenantId, table)) {
        const camposPermitidos = new Set(['total', 'pag', 'id', 'tenant_id'])
        const camposExtras = Object.keys(payload).filter(k => !camposPermitidos.has(k))
        if (camposExtras.length) {
          return send(res, 403, { error: 'Alteração não permitida sem sessão de gestor.' })
        }
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
        if (Object.prototype.hasOwnProperty.call(payload, 'order_auto_reset_daily') &&
            !Object.prototype.hasOwnProperty.call(payload, 'order_auto_reset_last_date')) {
          const ativoReset = payload.order_auto_reset_daily === true || payload.order_auto_reset_daily === 1 || payload.order_auto_reset_daily === '1'
          if (ativoReset) payload.order_auto_reset_last_date = brasiliaDateString()
        }
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
      const _statusAntes = (table === 'orders' && Object.prototype.hasOwnProperty.call(payload, 'status') && cols.includes('id'))
        ? db.prepare(`SELECT id,status FROM "${table}" ${WHERE}`).all(...vals)
        : [];
      const _statusAntesMap = new Map(_statusAntes.map(r => [r.id, r.status]))
      const _reavaliarEstoque = table === 'orders' && (
        Object.prototype.hasOwnProperty.call(payload, 'status') ||
        Object.prototype.hasOwnProperty.call(payload, 'items')
      )
      db.prepare(`UPDATE "${table}" SET ${keys.map(k=>`"${k}"=?`).join(', ')} ${WHERE}`).run(...keys.map(k=>sanitize(payload[k])),...vals)
      if (_statusAntes.length) {
        for (const r of _statusAntes) {
          registrarStatusPedido(tenantId || payload.tenant_id, r.id, r.status, payload.status, {
            actor_type: 'sistema',
            origem: 'rest-patch'
          })
        }
      }
      if (SSE_TABLES.has(table) && _idsAntes.length) {
        // Emite SSE para cada row atualizada com dados completos
        for (const _rid of _idsAntes) {
          const updatedRow = db.prepare(`SELECT * FROM "${table}" WHERE "id"=?`).get(_rid);
          if (updatedRow) {
            if (_reavaliarEstoque) aplicarBaixaEstoquePedido(updatedRow.tenant_id || tenantId || payload.tenant_id, updatedRow, _statusAntesMap.has(_rid) ? 'rest-patch' : 'rest-patch-items')
            if (table === 'orders' && _statusAntesMap.has(_rid) && _statusAntesMap.get(_rid) !== updatedRow.status) {
              chatNotifyOrderStatus(updatedRow.tenant_id || tenantId || payload.tenant_id, updatedRow, _statusAntesMap.get(_rid), updatedRow.status)
            }
            emit(tenantId||payload.tenant_id, table, parseRow(table, updatedRow), 'UPDATE');
          }
        }
      } else if (SSE_TABLES.has(table)) {
        // Fallback: tenta re-SELECT com WHERE original
        const updatedRow = db.prepare(`SELECT * FROM "${table}" ${WHERE} LIMIT 1`).get(...vals);
        if (updatedRow && _reavaliarEstoque) aplicarBaixaEstoquePedido(updatedRow.tenant_id || tenantId || payload.tenant_id, updatedRow, 'rest-patch')
        if (table === 'orders' && updatedRow && Object.prototype.hasOwnProperty.call(payload, 'status')) {
          chatNotifyOrderStatus(updatedRow.tenant_id || tenantId || payload.tenant_id, updatedRow, null, updatedRow.status)
        }
        emit(tenantId||payload.tenant_id, table, updatedRow?parseRow(table,updatedRow):payload, 'UPDATE');
      }

      marcarDirty(); return send(res, 200, { updated: 1 })
    } catch(e) { return send(res, 400, { error: e.message }) }
  }

  if (req.method === 'DELETE') {
    if (!WHERE) return send(res, 400, { error: 'DELETE sem filtro não permitido' })
    try {
      // "categories" tem FK em menu_items.category_id sem ON DELETE, então excluir uma
      // categoria com itens vinculados por esse campo numérico quebra com FOREIGN KEY
      // constraint failed. Os itens continuam existindo (por isso desvincula, não apaga).
      if (table === 'categories') {
        const idsParaExcluir = db.prepare(`SELECT id FROM "categories" ${WHERE}`).all(...vals).map(r => r.id)
        if (idsParaExcluir.length) {
          const placeholders = idsParaExcluir.map(() => '?').join(',')
          db.prepare(`UPDATE "menu_items" SET category_id = NULL WHERE category_id IN (${placeholders})`).run(...idsParaExcluir)
        }
      }
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
  const cfg = db.prepare('SELECT store_name,store_descricao,store_logo_url,store_banner_url,store_banners,store_cor,store_cor_texto,store_tema,cats_carrossel,store_tempo_entrega,store_tempo_retirada,store_avaliacao,store_whatsapp,promo_banner_ativo,promo_banners,tablet_splash_bg_url FROM store_config WHERE tenant_id=?').get(t.id)
  return { ...t, branding: cfg || {} }
}

// ════════════════════════════════════════════════════════
// UPLOAD DE IMAGENS
// ════════════════════════════════════════════════════════
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB
const ALLOWED_EXT = new Set(['.jpg','.jpeg','.png','.webp','.gif','.bmp','.mp4','.webm'])

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
        const hasExt   = /\.(jpg|jpeg|png|webp|gif|mp4|webm)$/i.test(urlBase)
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

const BUTCHERBOX_BASE_URL = (process.env.BUTCHERBOX_BASE_URL || 'https://butcherbox.evocrm.sbs').replace(/\/+$/, '')

function linkCardapioTenant(tid) {
  let slug = '', segmento = ''
  try {
    const row = db.prepare('SELECT slug,segmento FROM tenants WHERE id=?').get(tid)
    slug = row?.slug || ''
    segmento = row?.segmento || ''
  } catch {}
  const param = slug
    ? `slug=${encodeURIComponent(slug)}`
    : `tenant=${encodeURIComponent(tid || '')}`
  // Lojas do segmento açougue usam o domínio próprio (butcherbox), em vez
  // do domínio genérico da plataforma — mesmo caminho/parâmetros, só muda
  // a "casa" pra combinar com a marca que o cliente reconhece.
  const base = segmento === 'acougue' ? BUTCHERBOX_BASE_URL : PUBLIC_BASE_URL
  return `${base}/index.html?${param}`
}

function aplicarLinkCardapioMensagem(text, linkCardapio) {
  let out = String(text || '')
  const hosts = new Set(['estimafood.evocrm.sbs'])
  try {
    const host = new URL(PUBLIC_BASE_URL).host
    if (host) hosts.add(host)
  } catch {}
  for (const host of hosts) {
    const esc = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`https?://${esc}(?:/(?:index\\.html)?)?(?:\\?(?:slug|tenant)=[A-Za-z0-9._~-]+)?`, 'gi'), linkCardapio)
    out = out.replace(new RegExp(`(^|[^/])\\b${esc}(?:/(?:index\\.html)?)?(?:\\?(?:slug|tenant)=[A-Za-z0-9._~-]+)?`, 'gi'), (_, prefix) => `${prefix}${linkCardapio}`)
  }
  return out
}

function fillVarsComLinkCardapio(tpl, tid, vars = {}) {
  const linkCardapio = linkCardapioTenant(tid)
  return aplicarLinkCardapioMensagem(fillVars(tpl, {
    ...vars,
    link: linkCardapio,
    link_cardapio: linkCardapio,
    cardapio_link: linkCardapio,
  }), linkCardapio)
}

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
  const delay    = typeof delayMs === 'number' ? Math.max(0, delayMs) : 1000
  const body     = { number, text, delay, linkPreview: false }
  try {
    const r = await fetch(`${EVO_URL}/message/sendText/${instance}`, { method:'POST', headers, body:JSON.stringify(body) })
    const data = await r.json().catch(()=>({}))
    log('📬', `sendWA [${r.status}]:`, JSON.stringify(data).slice(0,200))
    if (r.ok) { log('📤',`Enviado para ${number}`); return { ok:true, data } }
    const legacyBody = { number, textMessage: { text }, options: { delay, presence:'composing', linkPreview:false } }
    const r2   = await fetch(`${EVO_URL}/message/sendText/${instance}`, { method:'POST', headers, body:JSON.stringify(legacyBody) })
    const data2 = await r2.json().catch(()=>({}))
    if (r2.ok) { log('📤',`Enviado para ${number} (retry)`); return { ok:true, data:data2 } }
    return { ok:false, data:data2 }
  } catch(e) { log('❌','Erro WA:',{error:e.message}); return { ok:false, error:e.message } }
}

// Envia uma imagem (ex: QR Code do PIX) via Evolution API.
// imageBase64 aceita tanto data URL completa ("data:image/png;base64,...")
// quanto o base64 puro — normaliza antes de enviar.
async function sendWAImage(phone, imageBase64, caption, inst) {
  const instance = inst || EVO_INST
  const num      = phone.replace(/\D/g,'')
  const number   = num.startsWith('55') ? num : `55${num}`
  const headers  = { 'Content-Type':'application/json', apikey: EVO_KEY }
  const media    = String(imageBase64 || '').replace(/^data:image\/\w+;base64,/, '')
  if (!media) return { ok:false, error:'imagem vazia' }
  const body = { number, mediatype:'image', mimetype:'image/png', media, caption: caption || '', fileName: 'pix-qrcode.png' }
  try {
    const r = await fetch(`${EVO_URL}/message/sendMedia/${instance}`, { method:'POST', headers, body:JSON.stringify(body) })
    const data = await r.json().catch(()=>({}))
    log('📬', `sendWAImage [${r.status}]:`, JSON.stringify(data).slice(0,200))
    if (r.ok) { log('📤',`Imagem enviada para ${number}`); return { ok:true, data } }
    return { ok:false, data }
  } catch(e) { log('❌','Erro WA imagem:',{error:e.message}); return { ok:false, error:e.message } }
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

// Helper: delay variável pra notificações automáticas (0.8s a 3.0s).
// Evita padrão de bot: hoje cada notificação saía com delay fixo de 1s,
// fazendo o WhatsApp identificar facilmente o número como automatizado.
// Cada chamada retorna um valor levemente diferente, então mesmo quando
// 5 status do pedido saem em sequência, cada um tem latência única.
function _autoDelayMs() {
  return 800 + Math.floor(Math.random() * 2200)
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
      const now   = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Sao_Paulo'}))
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
      // Envia aniversários com delay variável entre cada cliente (3-7s)
      // pra não disparar 50 mensagens em rajada quando há muitos aniversariantes.
      // Antes: sleep fixo de 1.5s = padrão detectável de bot.
      for (const c of anivs) {
        await sendWA(c.phone, fillVars(ca.msg,{nome:c.name}), inst, _autoDelayMs())
        await sleep(3000 + Math.floor(Math.random() * 4000))  // 3-7s entre cada cliente
      }
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
        const texto = fillVarsComLinkCardapio(pp.msg, t.id, { nome })
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

function registrarStatusPedido(tid, orderId, oldStatus, newStatus, meta = {}) {
  if (!tid || !orderId || !newStatus || oldStatus === newStatus) return
  try {
    db.prepare(`INSERT INTO order_status_history
      (tenant_id, order_id, old_status, new_status, actor_type, actor_id, actor_name, origem, note)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
        tid,
        orderId,
        oldStatus || null,
        newStatus,
        meta.actor_type || 'gestor',
        meta.actor_id || null,
        meta.actor_name || null,
        meta.origem || 'order-status',
        meta.note || null
      )
    marcarDirty()
  } catch(e) {
    log('⚠️', 'Historico de status falhou:', e.message)
  }
}

function chatNormalizePhone(value) {
  return String(value || '').replace(/\D/g, '')
}

function chatPhoneMatches(saved, incoming) {
  const a = chatNormalizePhone(saved)
  const b = chatNormalizePhone(incoming)
  if (!a || !b) return false
  return a === b || a.slice(-8) === b.slice(-8)
}

function chatStatusLabel(status) {
  return ({
    aguardando_pix: 'Aguardando PIX',
    aguardando_cartao: 'Aguardando cartao',
    analise: 'Em analise',
    producao: 'Em preparo',
    pronto: 'Pedido pronto',
    saiu: 'Saiu para entrega',
    entregue: 'Entregue',
    finalizado: 'Finalizado',
    cancelado: 'Cancelado',
    mesa_aberta: 'Mesa aberta'
  })[String(status || '')] || String(status || 'Status')
}

function chatBrasiliaTime(dateLike) {
  const raw = String(dateLike || '').trim()
  const iso = raw ? raw.replace(' ', 'T') : ''
  const d = iso ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z') : new Date()
  const valid = Number.isFinite(d.getTime()) ? d : new Date()
  return valid.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo'
  })
}

function chatStatusClientText(order, status) {
  const label = chatStatusLabel(status)
  const num = numeroPedidoChat({ ...order, status }, { fallback: true })
  const prefix = num ? `Pedido #${num}` : 'Seu pedido'
  const when = chatBrasiliaTime()
  const details = ({
    aguardando_pix: 'Estamos aguardando a confirmacao do pagamento via PIX para seguir com o pedido.',
    aguardando_cartao: 'Estamos aguardando a confirmacao do pagamento no cartao para seguir com o pedido.',
    analise: 'Recebemos seu pedido e a loja ja vai conferir as informacoes.',
    producao: 'Seu pedido foi confirmado e ja esta em preparo.',
    pronto: 'Seu pedido esta pronto. Se for retirada, pode se dirigir a loja; se for entrega, ele seguira para o envio.',
    saiu: 'Seu pedido saiu para entrega. Fique atento ao telefone e ao endereco informado.',
    entregue: 'Seu pedido foi marcado como entregue. Obrigado pela preferencia.',
    finalizado: 'Seu pedido foi finalizado. Agradecemos pela preferencia.',
    cancelado: 'Seu pedido foi cancelado. Se tiver qualquer duvida, fale com a loja por aqui.'
  })[String(status || '')] || `Seu pedido foi atualizado para: ${label}.`
  return `${prefix} atualizado: ${label}.\n${details}\nAtualizado as ${when} (horario de Brasilia).`
}

function chatOrderItemsText(order) {
  try {
    const items = Array.isArray(order?.items) ? order.items : JSON.parse(order?.items || '[]')
    return (items || [])
      .filter(i => i && i.item_status !== 'cancelado' && i.status !== 'cancelado')
      .map(i => {
        const qty = i.qty || i.quantity || 1
        const name = i.name || i.nome || 'Item'
        const obs = String(i.obs || '').trim()
        return obs ? `${qty}x ${name} (${obs})` : `${qty}x ${name}`
      })
      .join(', ')
  } catch {
    return ''
  }
}

function chatOrderPublic(order) {
  if (!order) return null
  const num = numeroPedidoChat(order, { fallback: true })
  return {
    id: order.id,
    order_num: order.order_num || null,
    num: num || null,
    client: order.client || '',
    phone: order.phone || '',
    addr: order.addr || '',
    status: order.status || '',
    status_label: chatStatusLabel(order.status),
    pag: order.pag || '',
    total: parseFloat(order.total || 0),
    taxa: parseFloat(order.taxa || 0),
    items_text: chatOrderItemsText(order),
    created_at: order.created_at || null,
    updated_at: order.updated_at || null
  }
}

function chatThreadPublic(thread, order = null) {
  const publicOrder = order ? chatOrderPublic(order) : null
  let lastMessage = thread?.last_message || ''
  const publicNum = publicOrder?.num || ''
  const internalId = Number(order?.id || thread?.order_id || 0)
  if (publicNum && internalId && Number(publicNum) !== internalId) {
    lastMessage = String(lastMessage).replace(new RegExp(`(Pedido\\s*#)${internalId}(\\b)`, 'gi'), `$1${publicNum}$2`)
  } else if (!publicNum && internalId) {
    lastMessage = String(lastMessage).replace(new RegExp(`Pedido\\s*#${internalId}\\b`, 'gi'), 'Pedido')
  }
  if (!thread) return null
  return {
    id: thread.id,
    tenant_id: thread.tenant_id,
    order_id: thread.order_id,
    order_num: order ? (publicOrder?.order_num || null) : (thread.order_num || null),
    client: thread.client || '',
    phone: thread.phone || '',
    status: thread.status || 'open',
    last_message: lastMessage,
    last_sender: thread.last_sender || '',
    last_at: thread.last_at || thread.updated_at || thread.created_at || null,
    unread_store: parseInt(thread.unread_store || 0),
    unread_client: parseInt(thread.unread_client || 0),
    created_at: thread.created_at || null,
    updated_at: thread.updated_at || null,
    order: publicOrder
  }
}

function chatMessagePublic(row, order = null) {
  if (!row) return null
  let body = row.body || ''
  let publicNum = order ? numeroPedidoChat(order, { fallback: true }) : ''
  const orderId = Number(order?.id || row.order_id || 0)
  if (!publicNum && orderId && row.tenant_id) {
    try {
      const msgOrder = db.prepare('SELECT id,tenant_id,order_num,status,pag FROM orders WHERE id=? AND tenant_id=?').get(orderId, row.tenant_id)
      publicNum = numeroPedidoChat(msgOrder, { fallback: true })
    } catch {}
  }
  if (publicNum && orderId && Number(publicNum) !== orderId) {
    body = String(body).replace(new RegExp(`(Pedido\\s*#)${orderId}(\\b)`, 'gi'), `$1${publicNum}$2`)
  } else if (!publicNum && orderId) {
    body = String(body).replace(new RegExp(`Pedido\\s*#${orderId}\\b`, 'gi'), 'Pedido')
  }
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    thread_id: row.thread_id,
    order_id: row.order_id,
    sender: row.sender,
    author_name: row.author_name || '',
    body,
    kind: row.kind || 'text',
    created_at: row.created_at || null
  }
}

function chatEnsureThreadFromOrder(order, override = {}) {
  if (!order?.tenant_id || !order?.id) return null
  const phone = chatNormalizePhone(override.phone || order.phone)
  if (!phone) return null
  const client = String(override.client || order.client || '').trim()
  const hasOrderNumField = Object.prototype.hasOwnProperty.call(order, 'order_num')
  const incomingOrderNum = hasOrderNumField ? (order.order_num || null) : undefined
  const existing = db.prepare('SELECT * FROM order_chat_threads WHERE tenant_id=? AND order_id=? ORDER BY id DESC LIMIT 1').get(order.tenant_id, order.id)
  if (existing) {
    const threadOrderNum = hasOrderNumField ? incomingOrderNum : (existing.order_num || null)
    db.prepare(`UPDATE order_chat_threads
      SET order_num=?,
          client=CASE WHEN ?!='' THEN ? ELSE client END,
          phone=CASE WHEN ?!='' THEN ? ELSE phone END,
          updated_at=datetime('now')
      WHERE id=? AND tenant_id=?`)
      .run(threadOrderNum, client, client, phone, phone, existing.id, order.tenant_id)
  } else {
    db.prepare(`INSERT INTO order_chat_threads
      (tenant_id, order_id, order_num, client, phone, updated_at)
      VALUES (?,?,?,?,?,datetime('now'))`)
      .run(order.tenant_id, order.id, incomingOrderNum || null, client, phone)
  }
  return db.prepare('SELECT * FROM order_chat_threads WHERE tenant_id=? AND order_id=?').get(order.tenant_id, order.id)
}

function chatEnsureThreadFromLead(tenantId, override = {}) {
  const tid = String(tenantId || '').trim()
  const phone = chatNormalizePhone(override.phone)
  if (!tid || !phone) return null
  const client = String(override.client || '').trim()
  const existing = db.prepare(`SELECT * FROM order_chat_threads
    WHERE tenant_id=? AND order_id=0 AND phone=?
    ORDER BY id DESC LIMIT 1`).get(tid, phone)
  if (existing) {
    db.prepare(`UPDATE order_chat_threads
      SET client=CASE WHEN ?!='' THEN ? ELSE client END,
          updated_at=datetime('now')
      WHERE id=? AND tenant_id=?`)
      .run(client, client, existing.id, tid)
    return db.prepare('SELECT * FROM order_chat_threads WHERE id=? AND tenant_id=?').get(existing.id, tid)
  }
  const ins = db.prepare(`INSERT INTO order_chat_threads
    (tenant_id, order_id, order_num, client, phone, status, updated_at)
    VALUES (?,0,NULL,?,?, 'open', datetime('now'))`).run(tid, client, phone)
  return db.prepare('SELECT * FROM order_chat_threads WHERE id=? AND tenant_id=?').get(ins.lastInsertRowid, tid)
}

function chatBroadcastMessage(thread, message, order = null) {
  if (!thread || !message) return
  const payload = {
    thread: chatThreadPublic(thread, order),
    message: chatMessagePublic(message, order),
    order: chatOrderPublic(order)
  }
  const tid = thread.tenant_id
  sseBroadcast(`chat-rt:${tid}`, 'chat:message', payload)
  const phone = chatNormalizePhone(thread.phone)
  if (phone) {
    sseBroadcast(`chat-client:${tid}:${thread.order_id || 0}:${phone}`, 'chat:message', payload)
    if (Number(thread.order_id || 0) !== 0) sseBroadcast(`chat-client:${tid}:0:${phone}`, 'chat:message', payload)
  }
}

function chatAddMessageFromOrder(order, opts = {}) {
  if (!order?.tenant_id || !order?.id) return null
  const body = String(opts.body || '').trim()
  if (!body) return null
  try {
    const thread = chatEnsureThreadFromOrder(order, opts)
    if (!thread) return null
    const sender = ['client','store','system'].includes(opts.sender) ? opts.sender : 'system'
    const kind = ['text','status','system'].includes(opts.kind) ? opts.kind : 'text'
    if (opts.skipDuplicate) {
      const dup = db.prepare(`SELECT id FROM order_chat_messages
        WHERE tenant_id=? AND order_id=? AND sender=? AND kind=? AND body=?
        ORDER BY id DESC LIMIT 1`).get(order.tenant_id, order.id, sender, kind, body)
      if (dup) return null
    }
    const author = String(opts.author_name || '').trim()
    const ins = db.prepare(`INSERT INTO order_chat_messages
      (tenant_id, thread_id, order_id, sender, author_name, body, kind)
      VALUES (?,?,?,?,?,?,?)`)
      .run(order.tenant_id, thread.id, order.id, sender, author, body.slice(0, 1200), kind)
    const msg = db.prepare('SELECT * FROM order_chat_messages WHERE id=?').get(ins.lastInsertRowid)
    const incStore = sender === 'client' ? 1 : 0
    const incClient = sender === 'client' ? 0 : 1
    db.prepare(`UPDATE order_chat_threads
      SET last_message=?, last_sender=?, last_at=datetime('now'), updated_at=datetime('now'),
          unread_store=COALESCE(unread_store,0)+?,
          unread_client=COALESCE(unread_client,0)+?
      WHERE id=? AND tenant_id=?`)
      .run(msg.body, sender, incStore, incClient, thread.id, order.tenant_id)
    const updatedThread = db.prepare('SELECT * FROM order_chat_threads WHERE id=? AND tenant_id=?').get(thread.id, order.tenant_id)
    marcarDirty()
    chatBroadcastMessage(updatedThread, msg, order)
    return { thread: updatedThread, message: msg }
  } catch(e) {
    log('WARN', 'Chat interno falhou:', e.message)
    return null
  }
}

function chatAddMessageToThread(thread, opts = {}, order = null) {
  if (!thread?.tenant_id || !thread?.id) return null
  const body = String(opts.body || '').trim()
  if (!body) return null
  try {
    const sender = ['client','store','system'].includes(opts.sender) ? opts.sender : 'system'
    const kind = ['text','status','system','assistant'].includes(opts.kind) ? opts.kind : 'text'
    if (opts.skipDuplicate) {
      const dup = db.prepare(`SELECT id FROM order_chat_messages
        WHERE tenant_id=? AND thread_id=? AND sender=? AND kind=? AND body=?
        ORDER BY id DESC LIMIT 1`).get(thread.tenant_id, thread.id, sender, kind, body)
      if (dup) return null
    }
    const author = String(opts.author_name || '').trim()
    const orderId = parseInt(thread.order_id || order?.id || 0, 10) || 0
    const ins = db.prepare(`INSERT INTO order_chat_messages
      (tenant_id, thread_id, order_id, sender, author_name, body, kind)
      VALUES (?,?,?,?,?,?,?)`)
      .run(thread.tenant_id, thread.id, orderId, sender, author, body.slice(0, 1200), kind)
    const msg = db.prepare('SELECT * FROM order_chat_messages WHERE id=?').get(ins.lastInsertRowid)
    const incStore = sender === 'client' ? 1 : 0
    const incClient = sender === 'client' ? 0 : 1
    db.prepare(`UPDATE order_chat_threads
      SET last_message=?, last_sender=?, last_at=datetime('now'), updated_at=datetime('now'),
          unread_store=COALESCE(unread_store,0)+?,
          unread_client=COALESCE(unread_client,0)+?
      WHERE id=? AND tenant_id=?`)
      .run(msg.body, sender, incStore, incClient, thread.id, thread.tenant_id)
    const updatedThread = db.prepare('SELECT * FROM order_chat_threads WHERE id=? AND tenant_id=?').get(thread.id, thread.tenant_id)
    marcarDirty()
    chatBroadcastMessage(updatedThread, msg, order)
    return { thread: updatedThread, message: msg }
  } catch(e) {
    log('WARN', 'Chat interno falhou:', e.message)
    return null
  }
}

function chatNotifyOrderCreated(order) {
  if (!order?.phone) return null
  const num = numeroPedidoChat(order, { fallback: true })
  const body = num
    ? `Pedido #${num} recebido pela loja.`
    : 'Pedido recebido pela loja. Aguardando confirmacao do pagamento.'
  return chatAddMessageFromOrder(order, {
    sender: 'system',
    kind: 'status',
    body,
    skipDuplicate: true
  })
}

function chatNotifyOrderStatus(tid, order, oldStatus, newStatus) {
  if (!order?.phone || !newStatus || oldStatus === newStatus) return null
  const withTid = { ...order, tenant_id: order.tenant_id || tid, status: newStatus }
  return chatAddMessageFromOrder({ ...order, tenant_id: order.tenant_id || tid, status: newStatus }, {
    sender: 'system',
    kind: 'status',
    body: chatStatusClientText(withTid, newStatus),
    skipDuplicate: true
  })
}

const STATUS_BAIXA_ESTOQUE = new Set(['producao','pronto','saiu','entregue','finalizado'])

function _estoqueNum(v, fallback = 0) {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

function _estoqueRound(v) {
  return Math.round((_estoqueNum(v) + Number.EPSILON) * 10000) / 10000
}

function _parseOrderItemsEstoque(items) {
  if (Array.isArray(items)) return items
  try {
    const parsed = items ? JSON.parse(items) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function _estoqueNormName(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function _orderItemProductId(item) {
  const raw = item?.menu_item_id ?? item?.product_id ?? item?.produto_id ?? item?.id ?? null
  const s = String(raw ?? '').trim()
  if (!/^\d+$/.test(s)) return null
  const n = parseInt(s, 10)
  return n > 0 ? n : null
}

function aplicarBaixaEstoquePedido(tid, order, origem = 'pedido') {
  if (!tid || !order?.id || !STATUS_BAIXA_ESTOQUE.has(String(order.status || ''))) {
    return { baixados: 0, ignorado: true }
  }
  try {
    const rawItems = _parseOrderItemsEstoque(order.items)
      .filter(i => i && !i.cancelado && i.status !== 'cancelado' && i.item_status !== 'cancelado')
    if (!rawItems.length) return { baixados: 0 }

    const qtyByProduct = new Map()
    const qtyByName = new Map()
    for (const item of rawItems) {
      const qty = _estoqueNum(item.qty ?? item.quantity ?? item.qtd ?? 1, 1)
      if (!(qty > 0)) continue
      const productId = _orderItemProductId(item)
      if (productId) {
        qtyByProduct.set(productId, _estoqueRound((qtyByProduct.get(productId) || 0) + qty))
        continue
      }
      const nameKey = _estoqueNormName(item.name || item.nome)
      if (nameKey) qtyByName.set(nameKey, _estoqueRound((qtyByName.get(nameKey) || 0) + qty))
    }

    if (qtyByName.size) {
      const products = db.prepare('SELECT id,name FROM menu_items WHERE tenant_id=?').all(tid)
      const nameToId = new Map()
      for (const p of products) {
        const key = _estoqueNormName(p.name)
        if (!key) continue
        if (nameToId.has(key)) nameToId.set(key, null)
        else nameToId.set(key, p.id)
      }
      for (const [nameKey, qty] of qtyByName) {
        const productId = nameToId.get(nameKey)
        if (productId) qtyByProduct.set(productId, _estoqueRound((qtyByProduct.get(productId) || 0) + qty))
      }
    }

    const productIds = [...qtyByProduct.keys()].filter(Boolean)
    if (!productIds.length) return { baixados: 0 }

    const placeholders = productIds.map(() => '?').join(',')
    const receitas = db.prepare(`
      SELECT r.item_id, r.estoque_id, r.qty, r.unit, e.name AS estoque_name
      FROM estoque_receitas r
      JOIN estoque e ON e.id = r.estoque_id AND e.tenant_id = r.tenant_id
      WHERE r.tenant_id=? AND r.ativo=1 AND COALESCE(r.qty,0) > 0
        AND r.item_id IN (${placeholders})
    `).all(tid, ...productIds)
    if (!receitas.length) return { baixados: 0 }

    const movimentos = []
    for (const r of receitas) {
      const productQty = qtyByProduct.get(r.item_id) || 0
      const consumo = _estoqueRound(productQty * _estoqueNum(r.qty))
      if (!(consumo > 0)) continue
      movimentos.push({
        tenant_id: tid,
        estoque_id: r.estoque_id,
        order_id: order.id,
        item_id: r.item_id,
        tipo: 'saida',
        qty: consumo,
        origem: origem || 'pedido',
        note: `Pedido #${numeroPedidoChat(order, { fallback: true }) || order.id}`
      })
    }
    if (!movimentos.length) return { baixados: 0 }

    const tx = db.transaction((rows) => {
      const stockStmt = db.prepare('SELECT id,qty FROM estoque WHERE id=? AND tenant_id=?')
      const updateStmt = db.prepare("UPDATE estoque SET qty=?, updated_at=datetime('now') WHERE id=? AND tenant_id=?")
      const insertStmt = db.prepare(`INSERT OR IGNORE INTO estoque_movimentos
        (tenant_id, estoque_id, order_id, item_id, tipo, qty, saldo_antes, saldo_depois, origem, note)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
      const updatedStocks = []
      const newMovs = []
      for (const m of rows) {
        const stock = stockStmt.get(m.estoque_id, m.tenant_id)
        if (!stock) continue
        const before = _estoqueRound(stock.qty)
        const after = _estoqueRound(before - m.qty)
        const ins = insertStmt.run(m.tenant_id, m.estoque_id, m.order_id, m.item_id, m.tipo, m.qty, before, after, m.origem, m.note)
        if (!ins.changes) continue
        updateStmt.run(after, m.estoque_id, m.tenant_id)
        const updated = db.prepare('SELECT * FROM estoque WHERE id=? AND tenant_id=?').get(m.estoque_id, m.tenant_id)
        const mov = db.prepare('SELECT * FROM estoque_movimentos WHERE id=?').get(ins.lastInsertRowid)
        if (updated) updatedStocks.push(updated)
        if (mov) newMovs.push(mov)
      }
      return { updatedStocks, newMovs }
    })

    const result = tx(movimentos)
    if (result.newMovs.length) {
      marcarDirty()
      for (const stock of result.updatedStocks) emit(tid, 'estoque', parseRow('estoque', stock), 'UPDATE')
      for (const mov of result.newMovs) emit(tid, 'estoque_movimentos', parseRow('estoque_movimentos', mov), 'INSERT')
    }
    return { baixados: result.newMovs.length }
  } catch(e) {
    log('âš ï¸', 'Baixa automatica de estoque falhou:', e.message)
    return { baixados: 0, error: e.message }
  }
}

async function handleOrderStatus(req, res) {
  const body = await readBody(req)
  const { order_id, new_status } = body
  const tid = body.tenant_id || req.headers['x-tenant-id']
  if (!order_id||!new_status||!tid) return send(res,400,{ok:false,error:'order_id, new_status e tenant_id obrigatórios'})
  try {
    const order = db.prepare("SELECT * FROM orders WHERE id=? AND tenant_id=?").get(order_id,tid)
    if (!order) return send(res,404,{ok:false,error:'Pedido não encontrado'})
    const oldStatus = order.status
    db.prepare("UPDATE orders SET status=?, updated_at=datetime('now') WHERE id=? AND tenant_id=?").run(new_status,order_id,tid)
    // Pedido cancelado não pode entrar no financeiro de forma nenhuma. Faz isso aqui
    // no servidor (não depende do gestor estar com a área financeira destravada no
    // navegador) — remove de vez qualquer entrada já lançada pra esse pedido.
    if (new_status === 'cancelado' && oldStatus !== 'cancelado') {
      try {
        const cfgCanc = db.prepare('SELECT order_num_offset FROM store_config WHERE tenant_id=?').get(tid)
        const numCanc = numeroPedidoComOffset(order, cfgCanc?.order_num_offset)
        db.prepare(`DELETE FROM movimentos WHERE tenant_id=? AND tipo='entrada' AND (description LIKE ? OR description LIKE ?)`)
          .run(tid, `Pedido #${numCanc} –%`, `Pedido #${numCanc} -%`)
      } catch(e) { log('warn', '[order-status] remoção do movimento financeiro falhou:', e.message) }
    }
    if (!pedidoOnlineAguardandoPagamento({ ...order, status: new_status }) && !order.order_num) {
      try { atribuirOrderNumSeNecessario(tid, order_id) } catch(e) { log('âš ï¸', 'order_num ao mudar status falhou:', e.message) }
    }
    registrarStatusPedido(tid, order_id, oldStatus, new_status, {
      actor_type: body.actor_type || 'gestor',
      actor_id: body.actor_id || null,
      actor_name: body.actor_name || null,
      origem: body.origem || 'kanban',
      note: body.note || null
    })
    const updated = db.prepare("SELECT * FROM orders WHERE id=? AND tenant_id=?").get(order_id,tid)
    aplicarBaixaEstoquePedido(tid, updated, body.origem || 'kanban')
    chatNotifyOrderStatus(tid, updated, oldStatus, new_status)
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
          if (parseInt(order.wa_track || 0) !== 1) {
            log('🔕', `[anti-ban] Pulando pix_confirmado do pedido #${order.id} — cliente não ativou tracking via WhatsApp`)
            return
          }
          const numeroRealPC = atribuirOrderNumSeNecessario(tid, order.id) || numeroPedidoPad(order, parseInt(cfg?.order_num_offset) || 0)
          const idStr  = String(numeroRealPC).padStart(3, '0')
          const nome   = order.client || 'Cliente'
          const items  = (()=>{ try{ return (JSON.parse(order.items)||[]).map(i=>`${i.qty}x ${i.name}`).join(', ') }catch{ return '' } })()
          const total  = (parseFloat(order.total||0)+parseFloat(order.taxa||0)).toFixed(2).replace('.',',')
          const lojaC = cfg?.store_name || 'Restaurante'
          const _nomePOk = nome.split(' ')[0]
          // Emojis baseados nos itens reais (açaí/pizza/etc.) em vez de fixo 🍳
          const _categPix    = detectarCategoriaPedido(items, _seg)
          const _emHeader    = _categPix.lojaEmoji
              const msgPad = `${_emHeader} *${lojaC}*\n${'-'.repeat(20)}\n\n✅ *Pagamento confirmado*\n\nOlá, *${_nomePOk}*! Recebemos o PIX do pedido *#${idStr}*.\n\n*Itens*\n${(items||'').split(', ').map(i=>'• '+i).join('\n')}\n\n*Total:* R$ ${total}\n\nSeu pedido já entrou em preparo.`
          const msgFin = pixConf.msg ? fillVars(pixConf.msg, { nome, id: idStr, itens: items, total }) : msgPad
          const r = await sendWA(order.phone, msgFin, inst, _autoDelayMs())
          if (r.ok) log('📤', `PIX manual confirmado notificado → ${order.phone} #${idStr}`)
        } catch(e) { log('❌','Erro notif pix_confirmado manual:', e.message) }
      })
    }
    // ─────────────────────────────────────────────────────────────────────

    // ── Recompensas (cashback + pontos + carimbinho) ─────
    // ANTES: cada programa enviava sua PRÓPRIA mensagem WhatsApp ao
    // finalizar pedido. Cliente recebia 3 msgs em rajada (1 cashback +
    // 1 pontos + 1 carimbinho) → padrão de bot que faz o WhatsApp banir.
    //
    // AGORA: cada programa CALCULA + faz UPDATE no banco normalmente,
    // mas só ALIMENTA o array `_recompensas`. No fim do bloco, mandamos
    // UMA mensagem única consolidada com tudo que o cliente ganhou.
    // Reduz volume em 66% pra clientes que têm múltiplos programas ativos.
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

        // Acumulador de recompensas que serão enviadas em UMA msg só
        const _recompensas = []  // [{ tipo, linha }, ...]

        // ── Cashback ────────────────────────────────────
        const cbCfg  = (() => { try { return JSON.parse(cfg?.cashback_config||'{}') } catch { return {} } })()
        if (cbCfg.ativo && cbCfg.pct > 0 && order.phone) {
          const total  = parseFloat(order.total||0)
          const minPed = parseFloat(cbCfg.min_pedido||0)
          if (total >= minPed) {
            const credito = parseFloat((total * cbCfg.pct / 100).toFixed(2))
            const phoneClean = order.phone.replace(/\D/g,'')
            const phoneSql   = phoneLookupSql('phone')
            const cust    = db.prepare(`SELECT id, cashback_saldo FROM customers WHERE tenant_id=? AND ${phoneSql} ORDER BY id DESC LIMIT 1`).get(tid, ...phoneLookupArgs(phoneClean))
            let novoSaldo = credito  // fallback para cliente novo
            if (cust) {
              db.prepare('UPDATE customers SET cashback_saldo=COALESCE(cashback_saldo,0)+? WHERE id=?').run(credito, cust.id)
              const updated = db.prepare('SELECT cashback_saldo FROM customers WHERE id=?').get(cust.id)
              novoSaldo = parseFloat(parseFloat(updated?.cashback_saldo||0).toFixed(2))
            } else {
              db.prepare(`INSERT INTO customers (tenant_id,name,phone,cashback_saldo) VALUES (?,?,?,?)
                          ON CONFLICT(tenant_id,phone) DO UPDATE SET cashback_saldo=COALESCE(cashback_saldo,0)+excluded.cashback_saldo`)
                .run(tid, order.client||order.phone, phoneClean, credito)
            }
            // Só ADICIONA na mensagem consolidada se gestor não desligou notif de cashback
            const cbAuto = auto['cashback'] || {}
            if (cbAuto.on !== false) {
              _recompensas.push({
                tipo: 'cashback',
                linha: `💰 *Cashback:* R$ ${credito.toFixed(2).replace('.',',')}\n*Saldo atual:* R$ ${novoSaldo.toFixed(2).replace('.',',')}`
              })
            }
            marcarDirty()
            log('💰', `Cashback R$${credito} creditado → ${order.phone} (pedido #${order_id})`)
          }
        }

        // ── Fidelidade pontos ────────────────────────────
        // Só roda se o gestor ATIVOU explicitamente (ativo === true).
        const fidCfg     = (() => { try { return JSON.parse(cfg?.fid_config||'{}') } catch { return {} } })()
        const ptsPorReal = parseFloat(fidCfg.pts_por_real || 0)
        const fidAtivo   = fidCfg.ativo === true && ptsPorReal > 0
        if (fidAtivo && order.phone) {
          const phoneClean = order.phone.replace(/\D/g,'')
          const phone8 = phoneClean.slice(-8)
          let fid = db.prepare("SELECT id, pts, max_pts, name FROM fidelidade WHERE tenant_id=? AND substr(replace(replace(phone,'+',''),' ',''), -8) = ?").get(tid, phone8)
          if (!fid) {
            const meta = parseInt(fidCfg.meta_pts || 500)
            db.prepare('INSERT OR IGNORE INTO fidelidade (tenant_id,name,phone,pts,max_pts,orders_count,resgates) VALUES (?,?,?,0,?,0,0)')
              .run(tid, order.client || phoneClean, phoneClean, meta)
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
              const ptAuto = auto['pontos'] || {}
              if (ptAuto.on !== false) {
                const faltam = Math.max(0, meta - novosPts)
                _recompensas.push({
                  tipo: 'pontos',
                  linha: faltam > 0
                    ? `⭐ *Pontos:* +${ptosGanhos}\n*Saldo atual:* ${novosPts} pontos\n*Faltam:* ${faltam} pontos para a recompensa`
                    : `⭐ *Pontos:* +${ptosGanhos}\n🎁 *Recompensa desbloqueada*\nResgate no próximo pedido`
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

          const stAuto = auto['carimbinho'] || auto['stamp'] || {}
          if (stAuto.on !== false) {
            const prog = db.prepare('SELECT compras, ultimo_resgate FROM stamp_progress WHERE tenant_id=? AND phone=?').get(tid, phoneCleanS)
            const compras       = prog?.compras || 0
            const ultimoResgate = prog?.ultimo_resgate || 0
            const desdeResgate  = compras - ultimoResgate
            const meta          = parseInt(stampCfg.meta_compras || 10)
            const faltam        = Math.max(0, meta - desdeResgate)
            const elegivel      = desdeResgate >= meta
            // Texto da recompensa
            let recompensaTxt = 'sua recompensa'
            const tipoR = stampCfg.recompensa_tipo || 'pedido_gratis'
            const valR  = parseFloat(stampCfg.recompensa_valor || 0)
            if (tipoR === 'pedido_gratis')      recompensaTxt = 'um *pedido grátis*'
            else if (tipoR === 'frete_gratis')  recompensaTxt = '*frete grátis*'
            else if (tipoR === 'percent' && valR > 0) recompensaTxt = `*${valR.toFixed(0).replace('.0','')}% de desconto*`
            else if (tipoR === 'fixo' && valR > 0)    recompensaTxt = `*R$ ${valR.toFixed(2).replace('.',',')} de desconto*`
            _recompensas.push({
              tipo: 'carimbo',
              linha: elegivel
                ? `🎟️ *Cartão fidelidade completo*\n*Progresso:* ${desdeResgate}/${meta}\nVocê ganhou ${recompensaTxt}`
                : `🎟️ *Carimbos:* ${desdeResgate}/${meta}\n*Faltam:* ${faltam} para ganhar ${recompensaTxt}`
            })
          }
        }

        // ── ENVIO CONSOLIDADO ─────────────────────────
        // 1 mensagem só, com tudo que o cliente ganhou. Substitui as 3 antigas.
        if (_recompensas.length > 0 && order.phone) {
          const trackingAtivo = parseInt(order.wa_track || 0) === 1
          if (!trackingAtivo) {
            log('🔕', `[anti-ban] Pulando recompensas do pedido #${order_id} — cliente não ativou tracking via WhatsApp`)
            return
          }
          const lojaNome  = cfg?.store_name || 'Restaurante'
          const linhasRec = _recompensas.map(r => r.linha).join('\n')
          const msgFinal  = _recompensas.length === 1
            ? `${_lojaEmojiB} *${lojaNome}*\n\n🎉 *${nome}, você ganhou uma recompensa!*\n\n${linhasRec}\n\nUse no próximo pedido.`
            : `${_lojaEmojiB} *${lojaNome}*\n\n🎉 *${nome}, seu pedido foi finalizado!*\n\nVocê ganhou:\n\n${linhasRec}\n\nUse no próximo pedido.`
          setImmediate(async () => {
            try {
              // Delay humanizado pra evitar padrão de bot (rajada de 1s fixo).
              // Notificações de fidelidade: 1.5s a 4s, com variação aleatória.
              const _delay = 1500 + Math.floor(Math.random() * 2500)
              const r = await sendWA(order.phone, msgFinal, inst, _delay)
              if (r?.ok) log('📤', `WA recompensas (${_recompensas.map(r=>r.tipo).join('+')}) → ${order.phone}`)
              else       log('⚠️', `WA recompensas FALHOU → ${order.phone}:`, r?.error || 'sem detalhe')
            } catch(e) { log('⚠️', `WA recompensas ERROR → ${order.phone}:`, e.message) }
          })
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
          const numeroRealSC = atribuirOrderNumSeNecessario(tid, order.id) || numeroPedidoPad(order, offset)
          const nome  = order.client||'Cliente', idStr=String(numeroRealSC).padStart(3, '0')
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
          const _primeiroNome = nome.split(' ')[0]
          const _tipoLocal = isDelivery==='🛵 Entrega'
            ? '🛵 Seu pedido sairá para entrega em breve!'
            : isDelivery==='🪴 Mesa'
            ? '🪴 Pode ficar à vontade, logo trazemos até você!'
            : '🏪 Pode retirar no balcão quando quiser!'
          const msgPadrao = {}
          const rodLimpo = '\n\n_Dúvidas? É só responder esta mensagem._'
          const msgPadraoOrganizado = {
            analise: `${cab}\n\n📥 *Pedido recebido - #${idStr}*\n\nOlá, *${_primeiroNome}*! Recebemos seu pedido.\n\n*Itens*\n${items}\n\n*Total:* R$ ${total}\n\nEm breve confirmaremos por aqui.${rodLimpo}`,
            producao: `${cab}\n\n✅ *Pedido confirmado - #${idStr}*\n\nOlá, *${_primeiroNome}*! Seu pedido já está em preparo.\n\n*Itens*\n${items}\n\n*Total:* R$ ${total}\n\n${_tipoLocal}${rodLimpo}`,
            pronto: `${cab}\n\n🔔 *Pedido pronto - #${idStr}*\n\n*${_primeiroNome}*, seu pedido está pronto.\n\n${_tipoLocal}${rodLimpo}`,
            saiu: `${cab}\n\n🛵 *Saiu para entrega - #${idStr}*\n\n*${_primeiroNome}*, seu pedido está a caminho.\n\n*Endereço*\n${order.addr || ''}\n\nFique de olho por aí.${rodLimpo}`,
            entregue: `${cab}\n\n✅ *Pedido entregue - #${idStr}*\n\n*${_primeiroNome}*, obrigado pela preferência.\n\nEsperamos que tenha gostado. Até a próxima!`,
            cancelado: `${cab}\n\n⚠️ *Pedido cancelado - #${idStr}*\n\nOlá, *${_primeiroNome}*. Infelizmente seu pedido foi cancelado.\n\nSe tiver alguma dúvida, responda esta mensagem que vamos ajudar.`,
            finalizado: `${cab}\n\n⭐ *Pedido finalizado - #${idStr}*\n\n*${_primeiroNome}*, obrigado por escolher a ${loja}.\n\nSua opinião ajuda muito a gente melhorar.`,
          }
          let msgFinal = null
          // ── ENVIO DE STATUS — opt-in via WhatsApp ─────────────
          // Estrategia anti-ban: a loja so envia atualizacao de pedido se o
          // pedido tiver wa_track=1. Isso acontece quando:
          //   1) o cliente clicou em "Acompanhar pedido pelo WhatsApp" e enviou
          //      a mensagem; ou
          //   2) o cliente iniciou conversa com a loja no WhatsApp nas ultimas
          //      horas e depois fez o pedido com o mesmo telefone.
          //
          // Nenhum status fura a trava. Sem contexto iniciado pelo cliente, a
          // loja nao inicia conversa pelo WhatsApp.
          const _trackingAtivo = parseInt(order.wa_track || 0) === 1

          if (ct.on===false) { log('⏭️',`Automação "${tipoAuto}" desligada`) }
          else if (!_trackingAtivo) {
            log('🔕', `[anti-ban] Pulando "${new_status}" do pedido #${idStr} — cliente não ativou tracking via WhatsApp`)
          }
          else if (ct.on&&ct.msg) { msgFinal=fillVars(ct.msg,vars) }
          else { msgFinal=msgPadraoOrganizado[new_status]||msgPadrao[new_status]||null }
          if (msgFinal) {
            const _pkey = `${order.id}_${new_status}`
            if (new_status==='finalizado') {
              const min=Math.max(1,parseInt(auto._aval_minutos||1,10)||1)
              // Adiciona ao set ANTES do setTimeout para bloquear duplicações imediatas
              if (processed.has(_pkey)) return
              processed.add(_pkey)
              log('⏳',`Avaliação agendada em ${min}min para #${idStr}`)
              setTimeout(async()=>{ const cfgNow=db.prepare("SELECT evo_automacoes FROM store_config WHERE tenant_id=?").get(tid); if((jsonParse(cfgNow?.evo_automacoes)||{})['avaliacao']?.on===false) { processed.delete(_pkey); return } await sendWA(order.phone,msgFinal,inst,_autoDelayMs()) },min*60*1000)
            } else {
              // Marca ANTES do await para evitar race condition entre cliques duplos no gestor:
              // se 2 POSTs /api/order-status chegam em paralelo, ambos leem oldStatus='pronto',
              // passariam pelo check antigo simultaneamente e enviariam o WA duas vezes.
              if (processed.has(_pkey)) return
              processed.add(_pkey)
              try {
                const r = await sendWA(order.phone, msgFinal, inst, _autoDelayMs())
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
const _iaLoopGuard = new Map()

function _iaNormBotText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/https?:\/\/\S+/g, ' link ')
    .replace(/[^\p{L}\p{N}\s#]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function _iaLooksLikeAutoReply(text) {
  const raw = String(text || '').trim()
  const n = _iaNormBotText(raw)
  if (!n) return false

  const patterns = [
    /\bpor favor selecione (a )?opcao (desejada|desejado)\b/,
    /\bselecione (uma|a) opcao\b/,
    /\bescolha (uma|a) opcao\b/,
    /\bdigite (uma|a|o numero da) opcao\b/,
    /\binforme (uma|a) opcao\b/,
    /\bqual opcao deseja\b/,
    /\bopcao (invalida|nao reconhecida|incorreta)\b/,
    /\bresponda (com|informando) (o )?(numero|opcao)\b/,
    /\bpara continuar (digite|escolha|selecione)\b/,
    /\bmenu (principal|inicial|de atendimento)\b/,
    /\batendimento (automatico|eletronico|virtual)\b/,
    /\bassistente virtual\b/,
    /\bsou (um )?(bot|robo|atendente virtual)\b/,
    /\bnao entendi (sua )?(resposta|mensagem)\b/,
    /\bopcoes? disponiveis\b/
  ]
  if (patterns.some(re => re.test(n))) return true

  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  const numbered = lines.filter(s => /^(\d+|[*)-])[\).\-\s]/.test(s)).length
  return numbered >= 2 && /\b(menu|opcao|opcoes|escolha|selecione|digite)\b/.test(n)
}

function _iaAutoLoopDecision(tenantId, phone, text) {
  const now = Date.now()
  const key = `ia-loop:${tenantId}:${phone}`
  const prev = _iaLoopGuard.get(key)
  if (prev?.muteUntil && prev.muteUntil > now) {
    return { ignore: true, pause: false, reason: 'anti-loop ativo' }
  }

  const norm = _iaNormBotText(text)
  const botLike = _iaLooksLikeAutoReply(text)
  const sameRecent = !!(prev && prev.norm === norm && now - prev.lastAt < 20 * 60 * 1000)
  const burstRecent = !!(prev && now - prev.lastAt < 90 * 1000)
  const count = sameRecent ? (prev.count || 1) + 1 : 1
  const burst = burstRecent ? (prev.burst || 1) + 1 : 1
  const repeatedAutoLoop = sameRecent && count >= 3 && norm.length >= 10
  const burstLoop = burst >= 5
  const shouldPause = botLike || repeatedAutoLoop || burstLoop

  _iaLoopGuard.set(key, {
    norm,
    count,
    burst,
    lastAt: now,
    muteUntil: shouldPause ? now + 60 * 60 * 1000 : 0
  })

  if (!shouldPause) return { ignore: false }
  return {
    ignore: true,
    pause: true,
    reason: botLike ? 'mensagem automatica detectada' : repeatedAutoLoop ? 'mensagem repetida em loop' : 'rajada de mensagens'
  }
}
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
// Limite de uso do pedido por voz — protege contra custo de transcrição sem
// controle (cliente mandando dezenas de áudios seguidos). Configurável aqui;
// não existe tela pra isso ainda, é intencionalmente conservador.
const VOZ_LIMITE_POR_HORA = 8
function _vozDentroDoLimite(tenantId, phone) {
  try {
    const umaHoraAtras = Date.now() - 60 * 60 * 1000
    const row = db.prepare('SELECT COUNT(*) AS c FROM voz_uso_log WHERE tenant_id=? AND phone=? AND ts>?').get(tenantId, phone, umaHoraAtras)
    return (row?.c || 0) < VOZ_LIMITE_POR_HORA
  } catch (e) { return true } // falha na checagem não deve travar o cliente
}
function _vozRegistrarUso(tenantId, phone) {
  try { db.prepare('INSERT INTO voz_uso_log (tenant_id,phone,ts) VALUES (?,?,?)').run(tenantId, phone, Date.now()) } catch (e) {}
}
// Limpa logs de uso com mais de 24h — só serve pra checagem da última hora,
// não precisa guardar histórico.
setInterval(() => {
  try {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    const r = db.prepare('DELETE FROM voz_uso_log WHERE ts < ?').run(cutoff)
    if (r.changes > 0) log('🧹', `[VOZ] Limpou ${r.changes} log(s) de uso antigo(s)`)
  } catch {}
}, 60 * 60 * 1000)

// ── Matching de bairro (portado de cardapio-cart.js) ─────────────────────
// Mesma lógica usada no cardápio pra bater o bairro digitado com a lista
// cadastrada pelo gestor — exato, depois substring, depois fuzzy. Usada aqui
// pra dar uma PRÉVIA de taxa no fluxo de voz antes de confirmar o pedido; a
// validação final e oficial continua sendo feita pelo endpoint de criação
// de pedido (handleREST), que já revalida tudo de novo.
function _normBairro(s) {
  return (s || '').toString().trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}
function _levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}
function _matchBairro(digitadoRaw, bairrosLista) {
  if (!digitadoRaw || !Array.isArray(bairrosLista) || !bairrosLista.length) return null
  const digitado = _normBairro(digitadoRaw)
  if (!digitado) return null
  const exato = bairrosLista.find(b => _normBairro(b.bairro || b) === digitado)
  if (exato) return exato
  const subset = bairrosLista.filter(b => {
    const cad = _normBairro(b.bairro || b)
    return cad.includes(digitado) || digitado.includes(cad)
  })
  if (subset.length === 1) return subset[0]
  const distancias = bairrosLista
    .map(b => ({ b, d: _levenshtein(digitado, _normBairro(b.bairro || b)) }))
    .sort((a, b) => a.d - b.d)
  const melhor = distancias[0], segundoMelhor = distancias[1]
  if (melhor) {
    const tamanhoMin = Math.min(digitado.length, _normBairro(melhor.b.bairro || melhor.b).length)
    const tolerancia = tamanhoMin >= 5 ? 2 : 1
    if (melhor.d <= tolerancia && (!segundoMelhor || segundoMelhor.d > melhor.d)) return melhor.b
  }
  return null
}

// ── Rascunho de pedido por voz (aguardando confirmação) ──────────────────
function _vozSalvarDraft(tenantId, phone, dados) {
  try {
    db.prepare('INSERT OR REPLACE INTO voz_pedidos_pendentes (tenant_id,phone,dados,ts) VALUES (?,?,?,?)')
      .run(tenantId, phone, JSON.stringify(dados), Date.now())
  } catch (e) { log('❌', '[VOZ] Falha ao salvar rascunho:', e.message) }
}
function _vozLerDraft(tenantId, phone) {
  try {
    const row = db.prepare('SELECT dados, ts FROM voz_pedidos_pendentes WHERE tenant_id=? AND phone=?').get(tenantId, phone)
    if (!row) return null
    // Rascunho expira em 15min — evita confirmar/cancelar um pedido antigo por engano
    if (Date.now() - row.ts > 15 * 60 * 1000) { _vozApagarDraft(tenantId, phone); return null }
    return JSON.parse(row.dados)
  } catch (e) { return null }
}
// Retorna true só se REALMENTE apagou uma linha — usado como trava contra
// duas mensagens "sim" duplicadas (reenvio de rede do WhatsApp) chegarem
// quase juntas e criarem o pedido duas vezes. Só quem apaga de verdade
// segue em frente; o outro encontra o rascunho já removido e para ali.
function _vozApagarDraft(tenantId, phone) {
  try { return db.prepare('DELETE FROM voz_pedidos_pendentes WHERE tenant_id=? AND phone=?').run(tenantId, phone).changes > 0 } catch (e) { return false }
}
setInterval(() => {
  try {
    const cutoff = Date.now() - 60 * 60 * 1000
    const r = db.prepare('DELETE FROM voz_pedidos_pendentes WHERE ts < ?').run(cutoff)
    if (r.changes > 0) log('🧹', `[VOZ] Limpou ${r.changes} rascunho(s) de pedido expirado(s)`)
  } catch {}
}, 60 * 60 * 1000)

// Tenta resolver a taxa de entrega a partir de um texto de bairro falado,
// contra a configuração de entrega da loja. Só cobre 'fixo' e 'por_bairro' —
// 'por_km' depende de GPS, que não existe no fluxo de voz, então esses casos
// (e config incompleta) retornam suportado:false pra o fluxo pedir pro
// cliente terminar pelo cardápio normal em vez de arriscar uma taxa errada.
function _vozResolverTaxa(feeConfig, bairroTexto) {
  const cfg = feeConfig || {}
  if (cfg.tipo === 'fixo') {
    return { suportado: true, resolvido: true, taxa: parseFloat(cfg.valor ?? cfg.value ?? 0) || 0, addrLabel: bairroTexto || null }
  }
  if (cfg.tipo === 'por_bairro') {
    const bairros = Array.isArray(cfg.bairros) ? cfg.bairros : []
    if (!bairros.length) return { suportado: false }
    if (!bairroTexto) return { suportado: true, resolvido: false, sugestoes: [] }
    const match = _matchBairro(bairroTexto, bairros)
    if (match) return { suportado: true, resolvido: true, taxa: parseFloat(match.taxa) || 0, addrLabel: match.bairro }
    const sugestoes = bairros
      .map(b => ({ nome: b.bairro, d: _levenshtein(_normBairro(bairroTexto), _normBairro(b.bairro)) }))
      .sort((a, b) => a.d - b.d).slice(0, 3).map(s => s.nome)
    return { suportado: true, resolvido: false, sugestoes }
  }
  return { suportado: false }
}

const _lastDayMsg  = new Map() // rastreia primeira msg do dia: "tenant:phone" → "YYYY-MM-DD"

// Inicia (ou avança) a confirmação de um pedido por voz: dado o que a IA já
// extraiu do áudio, tenta resolver a taxa de entrega e manda a mensagem
// certa pro cliente — ou pede o bairro, ou já pede a confirmação final.
// Resolve se o PIX é online (Mercado Pago) ou manual (chave copia-e-cola)
// pra esse tenant — chama o mesmo endpoint que o cardápio usa (/api/pix/config)
// e aplica a MESMA fórmula de decisão do front, pra nunca divergir do que o
// cardápio normal já faz.
async function _vozResolverModoPix(tenantId) {
  try {
    const r = await fetch(`http://localhost:${PORT}/api/pix/config`, { headers: { 'x-tenant-id': tenantId } })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) return { online: false, manualDisponivel: false }
    const temChaveManual = !!(d.pix_key_manual && String(d.pix_key_manual).trim())
    const online = d.pix_ativo_gestor === true || (d.pix_ativo_definido !== true && d.mp_configurado === true && !temChaveManual)
    return { online, manualDisponivel: temChaveManual, chave: d.pix_key_manual, tipo: d.pix_key_manual_tipo, banco: d.pix_key_manual_banco }
  } catch (e) { return { online: false, manualDisponivel: false } }
}

// Fila de pendências de grupo obrigatório (ex: Borda) ainda sem escolha —
// pega o primeiro item da lista que ainda tem grupo faltando.
function _vozProximaPendenciaGrupo(itens) {
  for (let idx = 0; idx < itens.length; idx++) {
    const it = itens[idx]
    if (it.gruposFaltando && it.gruposFaltando.length) return { itemIndex: idx, item: it, grupo: it.gruposFaltando[0] }
  }
  return null
}

function _vozTiposEntregaDisponiveis(tenantId) {
  const sc = db.prepare('SELECT tipos_entrega, delivery_fee_config FROM store_config WHERE tenant_id=?').get(tenantId)
  let tipos = ['delivery', 'retirada', 'mesa']
  try { const p = sc?.tipos_entrega ? JSON.parse(sc.tipos_entrega) : null; if (Array.isArray(p) && p.length) tipos = p } catch {}
  // "mesa" não é suportado por voz — não dá pra saber em qual mesa física
  // o cliente está sem ele digitar/mostrar isso de outra forma.
  tipos = tipos.filter(t => t === 'delivery' || t === 'retirada')
  // Pausa rápida de delivery (o gestor liga/desliga isso na hora, ex: "muito
  // cheio agora") — o cardápio já remove "delivery" das opções nesse caso,
  // então o voz precisa respeitar a mesma pausa, senão aceita pedido que a
  // loja não quer aceitar naquele momento.
  try {
    const feeConfig = sc?.delivery_fee_config ? JSON.parse(sc.delivery_fee_config) : {}
    if (deliveryPausaAtiva(feeConfig, 'delivery')) tipos = tipos.filter(t => t !== 'delivery')
    if (deliveryPausaAtiva(feeConfig, 'retirada')) tipos = tipos.filter(t => t !== 'retirada')
  } catch {}
  return tipos
}

function _vozPontosRetirada(tenantId) {
  const sc = db.prepare('SELECT store_address, pickup_addresses FROM store_config WHERE tenant_id=?').get(tenantId)
  let pontos = []
  try { pontos = sc?.pickup_addresses ? JSON.parse(sc.pickup_addresses) : [] } catch {}
  const todos = []
  if (sc?.store_address) todos.push({ nome: 'Principal', endereco: sc.store_address })
  if (Array.isArray(pontos)) pontos.forEach(p => todos.push({ nome: p.nome || 'Filial', endereco: p.endereco || '' }))
  return todos
}

async function _vozIniciarConfirmacao(tenantId, phone, inst, extraido) {
  if (!extraido.itens.length) {
    const motivo = extraido.nao_entendido ? ` (${extraido.nao_entendido})` : ''
    await sendWA(phone, `Não consegui identificar nenhum item do cardápio no seu áudio${motivo}. Pode tentar de novo ou escrever o pedido?`, inst)
    return
  }
  await _vozProcessarGruposPendentes(tenantId, phone, inst, {
    itens: extraido.itens,
    bairro: extraido.bairro,
    tipo_pedido: extraido.tipo_pedido,
    forma_pagamento: extraido.forma_pagamento,
    observacao_geral: extraido.observacao_geral
  })
}

// Pergunta, um de cada vez, qualquer grupo obrigatório (ex: Borda) que o
// áudio não tenha esclarecido — só segue pro tipo de pedido/endereço quando
// TODOS os itens já tiverem grupo resolvido (preço final fechado).
async function _vozProcessarGruposPendentes(tenantId, phone, inst, draft) {
  const pend = _vozProximaPendenciaGrupo(draft.itens)
  if (pend) {
    _vozSalvarDraft(tenantId, phone, { estado: 'aguardando_grupo', ...draft })
    const fmt = v => v.toFixed(2).replace('.', ',')
    const opcoesTxt = pend.grupo.opcoes.map(o => o.preco > 0 ? `${o.nome} (+R$${fmt(o.preco)})` : o.nome).join(', ')
    await sendWA(phone, `Pro seu *${pend.item.name}*, qual ${pend.grupo.nome.toLowerCase()}? Opções: ${opcoesTxt}`, inst)
    return
  }
  // Todos os grupos resolvidos — fecha o preço final de cada item (base +
  // extras escolhidos) e monta a descrição pro resumo/comanda.
  const itensFinal = draft.itens.map(it => {
    const extras = (it.gruposResolvidos || []).reduce((s, g) => s + g.precoExtra, 0)
    const fmt = v => v.toFixed(2).replace('.', ',')
    const obsGrupos = (it.gruposResolvidos || []).map(g => `${g.nome}: ${g.opcaoNome}${g.precoExtra > 0 ? ` (+R$${fmt(g.precoExtra)})` : ''}`).join(' · ')
    return { id: it.id, name: it.name, qty: it.qty, price: it.price + extras, obs: [obsGrupos, it.obs].filter(Boolean).join(' | ') }
  })
  await _vozResolverTipoEEndereco(tenantId, phone, inst, { itens: itensFinal, bairro: draft.bairro, tipo_pedido: draft.tipo_pedido, forma_pagamento: draft.forma_pagamento, observacao_geral: draft.observacao_geral })
}

// Resolve tipo de pedido (entrega/retirada) e, a partir dele, o
// endereço/taxa — depois segue pra forma de pagamento.
async function _vozResolverTipoEEndereco(tenantId, phone, inst, draft) {
  const tiposDisp = _vozTiposEntregaDisponiveis(tenantId)
  if (!tiposDisp.length) {
    await sendWA(phone, 'No momento o pedido por voz não está disponível pra essa loja. Fale com o atendente ou use o cardápio.', inst)
    return
  }
  if (draft.tipo_pedido === 'mesa') {
    await sendWA(phone, 'Pedido por voz ainda não funciona pra quem já está numa mesa do restaurante — chame o garçom ou use o cardápio/totem da mesa.', inst)
    return
  }
  let tipo = draft.tipo_pedido
  if (!tipo) {
    if (tiposDisp.length === 1) {
      tipo = tiposDisp[0]
    } else {
      _vozSalvarDraft(tenantId, phone, { estado: 'aguardando_tipo_entrega', ...draft })
      await sendWA(phone, 'Vai ser *entrega* ou *retirada*?', inst)
      return
    }
  }
  if (!tiposDisp.includes(tipo)) {
    await sendWA(phone, `Essa loja não trabalha com ${tipo === 'delivery' ? 'entrega' : 'retirada'} no momento. Pode ser ${tiposDisp.includes('delivery') ? 'entrega' : 'retirada'}?`, inst)
    return
  }
  if (tipo === 'retirada') {
    const pontos = _vozPontosRetirada(tenantId)
    if (pontos.length > 1) {
      _vozSalvarDraft(tenantId, phone, { estado: 'aguardando_ponto_retirada', ...draft, tipo_pedido: tipo })
      const opcoesTxt = pontos.map((p, i) => `${i + 1}. ${p.nome}${p.endereco ? ' — ' + p.endereco : ''}`).join('\n')
      await sendWA(phone, `De qual unidade vai ser a retirada?\n${opcoesTxt}`, inst)
      return
    }
    const addr = pontos.length === 1 ? ['Retirada', pontos[0].endereco].filter(Boolean).join(' — ') : 'Retirada no balcão'
    await _vozContinuarPagamento(tenantId, phone, inst, { ...draft, tipo_pedido: 'retirada', addr, taxa: 0 })
    return
  }
  // delivery — pedido mínimo só vale pra entrega (mesma regra do cardápio)
  const sc = db.prepare('SELECT delivery_fee_config, pedido_minimo FROM store_config WHERE tenant_id=?').get(tenantId)
  const pedidoMinimo = parseFloat(sc?.pedido_minimo) || 0
  const subtotalCheck = draft.itens.reduce((s, i) => s + i.price * i.qty, 0)
  if (pedidoMinimo > 0 && subtotalCheck < pedidoMinimo) {
    const fmt = v => v.toFixed(2).replace('.', ',')
    await sendWA(phone, `O pedido mínimo pra entrega é R$${fmt(pedidoMinimo)} — faltam R$${fmt(pedidoMinimo - subtotalCheck)}. Quer adicionar mais alguma coisa?`, inst)
    return
  }
  const feeConfig = sc?.delivery_fee_config ? jsonParse(sc.delivery_fee_config) : {}
  const resTaxa = _vozResolverTaxa(feeConfig, draft.bairro)
  if (!resTaxa.suportado) {
    await sendWA(phone, 'No momento o pedido por voz só calcula entrega por bairro ou taxa fixa. Pode finalizar pelo cardápio da loja ou prefere retirada?', inst)
    return
  }
  if (!resTaxa.resolvido) {
    _vozSalvarDraft(tenantId, phone, { estado: 'aguardando_bairro', ...draft, tipo_pedido: 'delivery' })
    const sugestoesTxt = resTaxa.sugestoes?.length ? ` Você quis dizer: ${resTaxa.sugestoes.join(', ')}?` : ''
    await sendWA(phone, `Pra qual bairro é a entrega?${sugestoesTxt}`, inst)
    return
  }
  await _vozContinuarPagamento(tenantId, phone, inst, { ...draft, tipo_pedido: 'delivery', addr: resTaxa.addrLabel || draft.bairro, taxa: resTaxa.taxa })
}

async function _vozContinuarPagamento(tenantId, phone, inst, draft) {
  if (!draft.forma_pagamento) {
    _vozSalvarDraft(tenantId, phone, { estado: 'aguardando_pagamento', ...draft })
    const pixInfo = await _vozResolverModoPix(tenantId)
    const opcoes = ['*dinheiro*']
    if (pixInfo.online || pixInfo.manualDisponivel) opcoes.push('*pix*')
    const opcoesTxt = opcoes.length > 1 ? opcoes.join(' ou ') : opcoes[0]
    await sendWA(phone, `Como prefere pagar? Responda ${opcoesTxt}.`, inst)
    return
  }
  // Cartão ainda não é aceito por voz — normaliza pra dinheiro aqui (antes da
  // pergunta de troco), guardando o aviso pra mostrar no resumo final.
  if (draft.forma_pagamento === 'cartao') draft = { ...draft, forma_pagamento: 'dinheiro', _eraCartao: true }
  // Pagamento em dinheiro: o cardápio sempre pergunta troco no checkout —
  // replica aqui antes de fechar o resumo, pra não deixar o entregador sem
  // saber se precisa levar troco.
  if (draft.forma_pagamento === 'dinheiro' && draft.troco === undefined) {
    _vozSalvarDraft(tenantId, phone, { estado: 'aguardando_troco', ...draft })
    await sendWA(phone, 'Precisa de troco? Se sim, me diga pra quanto (ex: "pra 50 reais"). Se não precisar, responda *não*.', inst)
    return
  }
  await _vozMontarConfirmacaoFinal(tenantId, phone, inst, draft)
}

// Monta e envia o resumo final (itens + entrega/retirada + pagamento) e
// salva o rascunho no estado "aguardando_confirmacao".
async function _vozMontarConfirmacaoFinal(tenantId, phone, inst, draft) {
  const subtotal = draft.itens.reduce((s, i) => s + i.price * i.qty, 0)
  const taxa = parseFloat(draft.taxa) || 0
  const total = subtotal + taxa
  const fmt = v => v.toFixed(2).replace('.', ',')
  const listaItens = draft.itens.map(i => `${i.qty}x ${i.name}${i.obs ? ` (${i.obs})` : ''}`).join('\n')
  let pagLabel = draft.forma_pagamento === 'pix' ? 'PIX' : draft._eraCartao ? 'Cartão (ainda não aceito por voz — será dinheiro na entrega)' : 'Dinheiro na entrega'
  if (draft.forma_pagamento === 'dinheiro' && draft.troco) {
    pagLabel += draft.troco === -1 ? ' (precisa de troco, valor a combinar)' : ` (troco para R$${fmt(draft.troco)})`
  }
  const linhaEntrega = draft.tipo_pedido === 'retirada'
    ? `Retirada: ${draft.addr}`
    : `Entrega: ${draft.addr}${taxa > 0 ? `\nTaxa de entrega: R$${fmt(taxa)}` : ''}`
  _vozSalvarDraft(tenantId, phone, {
    estado: 'aguardando_confirmacao',
    itens: draft.itens,
    tipo_pedido: draft.tipo_pedido,
    addr: draft.addr,
    taxa,
    forma_pagamento: draft.forma_pagamento,
    troco: draft.troco ?? null,
    observacao_geral: draft.observacao_geral
  })
  await sendWA(phone,
    `🎙️ Confirma seu pedido?\n\n${listaItens}\n\n${linhaEntrega}\nSubtotal: R$${fmt(subtotal)}\n*Total: R$${fmt(total)}*\nPagamento: ${pagLabel}\n\nResponda *sim* pra confirmar ou *não* pra cancelar.`,
    inst)
}

// Cria o pedido de verdade — reaproveita o MESMO endpoint que o cardápio
// público usa (self-call HTTP interno), pra herdar de graça todas as
// validações que já existem lá (bairro bloqueado, delivery pausado, loja
// fechada, etc.), em vez de duplicar essa lógica aqui.
async function _vozCriarPedido(tenantId, phone, inst, draft, nomeCliente) {
  const subtotal = draft.itens.reduce((s, i) => s + i.price * i.qty, 0)
  const total = subtotal + (parseFloat(draft.taxa) || 0)
  const fmt = v => v.toFixed(2).replace('.', ',')
  const items = draft.itens.map(i => ({ id: i.id, qty: i.qty, name: i.name, price: i.price, cat: '', cat_key: '', obs: i.obs || '' }))
  const reqId = 'vzc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10)

  // Resolve forma de pagamento ANTES de criar o pedido, pra já gravar com o
  // pag/status certo (evita ficar corrigindo depois com PATCH em cascata).
  let pixInfo = { online: false, manualDisponivel: false }
  const querPix = draft.forma_pagamento === 'pix'
  if (querPix) pixInfo = await _vozResolverModoPix(tenantId)
  let pag = 'dinheiro', status = 'analise'
  if (querPix && pixInfo.online) { pag = 'pix'; status = 'aguardando_pix' }
  else if (querPix && pixInfo.manualDisponivel) { pag = 'pix_manual'; status = 'aguardando_pix' }
  else if (querPix) {
    await sendWA(phone, 'Não consegui gerar PIX pra essa loja no momento — vou registrar seu pedido como pagamento na entrega (dinheiro). Se preferir, fale com a loja.', inst)
  }

  const body = {
    tenant_id: tenantId,
    client_request_id: reqId,
    origem_pedido: 'cardapio_publico',
    canal: 'voz_whatsapp',
    client: nomeCliente || 'Cliente WhatsApp',
    phone,
    addr: draft.addr,
    items,
    total: subtotal,
    taxa: draft.taxa,
    status,
    pag,
    ...(pag === 'dinheiro' && draft.troco ? { troco: draft.troco } : {}),
    // Ativa o acompanhamento automático via WhatsApp — é o que já faz o
    // sistema mandar sozinho a mensagem de "pagamento confirmado" pro
    // cliente quando o gestor aprovar o PIX manual (ver /api/order-status).
    // Sem isso, essa notificação automática nem dispara.
    wa_track: 1,
    time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }
  let data
  try {
    const r = await fetch(`http://localhost:${PORT}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify(body)
    })
    data = await r.json().catch(() => ({}))
    if (!r.ok) {
      log('❌', `[VOZ] Falha ao criar pedido [${tenantId}] ${phone}:`, data?.error || r.status)
      await sendWA(phone, `Não consegui finalizar seu pedido automaticamente: ${data?.error || 'erro desconhecido'}. Por favor finalize pelo cardápio da loja ou fale com o atendente.`, inst)
      return
    }
  } catch (e) {
    log('❌', '[VOZ] erro na criação do pedido:', e.message)
    await sendWA(phone, 'Tive um problema técnico ao finalizar seu pedido. Por favor finalize pelo cardápio da loja ou fale com o atendente.', inst)
    return
  }
  const numero = data?.order_num || data?.id

  if (pag === 'dinheiro') {
    await sendWA(phone, `✅ Pedido #${numero} confirmado! Já caiu no sistema da loja e logo começa a ser preparado.`, inst)
    return
  }

  if (pag === 'pix') {
    try {
      const pr = await fetch(`http://localhost:${PORT}/api/pix/criar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ order_id: data.id, valor: total, client: nomeCliente || 'Cliente WhatsApp', phone })
      })
      const pd = await pr.json().catch(() => ({}))
      if (pr.ok && pd?.qr_code) {
        await sendWA(phone, `✅ Pedido #${numero} confirmado! Segue o PIX pra pagamento — R$${fmt(total)}:`, inst)
        await new Promise(res2 => setTimeout(res2, 1000))
        await sendWA(phone, pd.qr_code, inst)
        if (pd.qr_code_base64) await sendWAImage(phone, pd.qr_code_base64, `📱 QR Code PIX — R$${fmt(total)}`, inst)
        return
      }
      log('⚠️', `[VOZ] PIX online falhou [${tenantId}] pedido#${numero}:`, pd?.error || pr.status)
    } catch (e) { log('⚠️', '[VOZ] erro ao gerar PIX online:', e.message) }
    // Online falhou — cai pro manual se existir, senão avisa e mantém "aguardando_pix"
    // (a loja consegue ver e resolver manualmente pelo painel).
    if (pixInfo.manualDisponivel) {
      try {
        await fetch(`http://localhost:${PORT}/api/orders?id=eq.${data.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
          body: JSON.stringify({ pag: 'pix_manual' })
        })
      } catch (e) {}
      await _vozEnviarPixManual(phone, inst, numero, total, pixInfo)
      return
    }
    await sendWA(phone, `✅ Pedido #${numero} confirmado, mas não consegui gerar o PIX automaticamente. A loja vai te enviar os dados de pagamento em instantes.`, inst)
    return
  }

  if (pag === 'pix_manual') {
    await _vozEnviarPixManual(phone, inst, numero, total, pixInfo)
  }
}

async function _vozEnviarPixManual(phone, inst, numero, total, pixInfo) {
  const fmt = v => v.toFixed(2).replace('.', ',')
  await sendWA(phone,
    `✅ Pedido #${numero} confirmado! Pague via PIX:\n\nChave (${pixInfo.tipo || 'aleatória'}): ${pixInfo.chave}\n${pixInfo.banco ? `Banco: ${pixInfo.banco}\n` : ''}Valor: R$${fmt(total)}\n\n📎 Depois de pagar, me envie o comprovante aqui. Seu pedido só entra em preparo depois que a loja confirmar o pagamento — você recebe uma mensagem assim que isso acontecer.`,
    inst)
}

// ── Pedido por voz (WhatsApp) — download + transcrição ──────────────────
// Baixa o áudio de uma mensagem do WhatsApp via Evolution API. Mesma chamada
// já usada em /api/wa/media (routes.js) pro atendente ouvir áudio no painel
// manualmente — aqui é a versão automática, chamada pelo robô.
async function baixarMidiaWhatsapp(tenantId, messageId, remoteJid) {
  try {
    const cfg  = db.prepare('SELECT evo_instance FROM store_config WHERE tenant_id=?').get(tenantId)
    const inst = cfg?.evo_instance || EVO_INST
    const r = await fetch(`${EVO_URL}/chat/getBase64FromMediaMessage/${inst}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVO_KEY },
      body:    JSON.stringify({ message: { key: { id: messageId, remoteJid } }, convertTo: 'base64', convertToMp4: false }),
      signal: AbortSignal.timeout(30000)
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok || !(data.base64 || data.data)) return null
    return { base64: data.base64 || data.data, mimetype: data.mimetype || data.mimeType || 'audio/ogg' }
  } catch (e) { log('❌', '[VOZ] Falha ao baixar áudio:', e.message); return null }
}

// Transcreve o áudio via Whisper (OpenAI). Usa a chave própria do tenant se
// ele tiver cadastrado uma (mesmo campo openai_key do painel do gestor/admin,
// hoje sem uso porque o robô de texto virou determinístico), senão cai pra
// chave global da plataforma (OPENAI_API_KEY no ambiente) — o custo da
// transcrição já está embutido no valor do add-on cobrado do tenant.
// Resolve a chave OpenAI a usar pra um tenant: chave própria dele (mesmo
// campo do painel do gestor/admin, hoje sem uso porque o robô de texto virou
// determinístico) ou, na falta dela, a chave global da plataforma — o custo
// já está embutido no valor do add-on de voz cobrado do tenant.
function _resolverOpenAIKey(tenantId) {
  try {
    const cfg = db.prepare('SELECT ia_config FROM store_config WHERE tenant_id=?').get(tenantId)
    const ia  = jsonParse(cfg?.ia_config) || {}
    if (ia.openai_key) return ia.openai_key
    // Chave própria do tenant não existe — cai pra chave global da plataforma,
    // a mesma salva na tela "Agente IA" do admin (tenant_id='_global'). É o
    // mesmo lugar que o resto do sistema já usa como fallback de IA.
    const cfgG = db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
    const iaG  = jsonParse(cfgG?.ia_config) || {}
    return iaG.openai_key || process.env.OPENAI_API_KEY || null
  } catch (e) { return process.env.OPENAI_API_KEY || null }
}

async function transcreverAudioWhatsapp(base64, mimetype, tenantId) {
  try {
    const apiKey = _resolverOpenAIKey(tenantId)
    if (!apiKey) { log('⚠️', `[VOZ] Sem chave OpenAI configurada (tenant nem global) — tenant=${tenantId}`); return null }
    const buffer = Buffer.from(String(base64 || ''), 'base64')
    if (!buffer.length) return null
    const ext  = String(mimetype || '').includes('mp4') ? 'mp4' : 'ogg'
    const form = new FormData()
    form.append('file', new Blob([buffer], { type: mimetype || 'audio/ogg' }), `audio.${ext}`)
    form.append('model', 'whisper-1')
    form.append('language', 'pt')
    // Mesma correção já usada no backup pro Telegram: enviar o FormData/Blob
    // direto pro fetch nativo do Node pode truncar o upload — serializa num
    // Buffer fixo com Content-Length explícito antes de mandar.
    const formResponse = new Response(form)
    const contentType  = formResponse.headers.get('content-type')
    const bodyBuf       = Buffer.from(await formResponse.arrayBuffer())
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': contentType, 'Content-Length': String(bodyBuf.length) },
      body: bodyBuf,
      signal: AbortSignal.timeout(30000)
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) { log('❌', '[VOZ] Whisper erro:', data?.error?.message || r.status); return null }
    return String(data?.text || '').trim() || null
  } catch (e) { log('❌', '[VOZ] Falha na transcrição:', e.message); return null }
}

// Extrai itens + bairro a partir do texto transcrito, usando o cardápio real
// do tenant como contexto — a IA só pode escolher item_id que exista na lista
// enviada (nunca inventa item nem preço; o preço final sempre vem do catálogo,
// nunca do que a IA disser). Retorna null se a chamada falhar por completo.
// Detecta itens complexos demais pra montar preço com segurança por voz:
// pizza com tamanho/meio-a-meio variável e açougue por peso/corte. Esses
// continuam de fora — cliente pede pelo cardápio normal. Grupo genérico
// obrigatório (ex: "Borda", "Molho") NÃO entra aqui — esses agora são
// perguntados por voz em vez de excluídos.
function _vozItemEhComplexo(item) {
  if (item.item_type === 'kg' || item.item_type === 'pizza') return true
  let grupos = []
  try { grupos = item.custom_groups ? JSON.parse(item.custom_groups) : [] } catch {}
  if (Array.isArray(grupos) && grupos.some(g => ['pizza_sizes', 'tamanhos_pizza', 'cortes', 'pesos'].includes(g?.tipo))) return true
  const catTxt = `${item.cat || ''} ${item.cat_key || ''}`.toLowerCase()
  if (catTxt.includes('pizza')) return true
  return false
}

// Grupos genéricos obrigatórios de um item (ex: Borda) — exclui os tipos
// especiais já tratados por _vozItemEhComplexo (não deveriam sobrar aqui,
// mas filtra de novo por segurança).
function _vozGruposObrigatorios(item) {
  let grupos = []
  try { grupos = item.custom_groups ? JSON.parse(item.custom_groups) : [] } catch {}
  if (!Array.isArray(grupos)) return []
  return grupos.filter(g => g?.required === true && !['pizza_sizes', 'tamanhos_pizza', 'cortes', 'pesos'].includes(g?.tipo) && Array.isArray(g.opcoes) && g.opcoes.length)
}

async function extrairPedidoDeTexto(tenantId, texto) {
  try {
    const apiKey = _resolverOpenAIKey(tenantId)
    if (!apiKey) { log('⚠️', `[VOZ] Sem chave OpenAI pra extração — tenant=${tenantId}`); return null }
    // Exclui itens vendidos por peso (açougue) ou de preço escondido (o real
    // está nos adicionais) — não dá pra cobrar certo só com o preço base.
    // Grupos obrigatórios genéricos (ex: Borda) NÃO excluem mais o item —
    // eles entram no contexto da IA pra ela tentar capturar a escolha, ou o
    // sistema pergunta depois se não veio no áudio.
    const itensRaw = db.prepare("SELECT id,name,price,item_type,custom_groups,hide_price,cat,cat_key FROM menu_items WHERE tenant_id=? AND COALESCE(status,'ativo')!='pausado'").all(tenantId)
    const itensAtivos = itensRaw.filter(i => {
      if (i.hide_price) return false
      if (_vozItemEhComplexo(i)) return false
      return true
    })
    if (!itensAtivos.length) return { itens: [], bairro: null, tipo_pedido: null, forma_pagamento: null, observacao_geral: null, nao_entendido: itensRaw.length ? 'Todos os itens do cardápio precisam de alguma escolha (sabor, tamanho, peso) que ainda não dá pra fazer por áudio.' : 'Cardápio vazio ou não configurado.' }
    const cardapioCtx = itensAtivos.map(i => {
      const grupos = _vozGruposObrigatorios(i)
      const base = { id: i.id, nome: i.name, preco: parseFloat(i.price) || 0 }
      if (grupos.length) base.grupos_obrigatorios = grupos.map(g => ({ nome: g.nome, opcoes: g.opcoes.map(o => ({ nome: o.nome, preco_extra: parseFloat(o.preco) || 0 })) }))
      return base
    })
    const sysPrompt = [
      'Você extrai pedidos de restaurante a partir de um texto transcrito de áudio de WhatsApp.',
      'Responda APENAS com um JSON válido, sem nenhum texto fora do JSON, no formato:',
      '{"itens":[{"item_id":123,"qty":1,"obs":"","escolhas":[{"grupo":"Borda","opcao":"Catupiry"}]}],"bairro":"nome do bairro ou null","tipo_pedido":"delivery|retirada|mesa|null","forma_pagamento":"dinheiro|pix|cartao|null","observacao_geral":"texto ou null","nao_entendido":"texto ou null"}',
      'Regras: use SOMENTE item_id que existam na lista de cardápio fornecida — nunca invente um id.',
      'Se o item tiver "grupos_obrigatorios" no cardápio, é PRECISO escolher uma opção de cada grupo — se o cliente já disse no áudio (ex: "borda catupiry"), preencha em "escolhas" usando o nome EXATO da opção fornecida; se não disse, deixe "escolhas" vazio pra esse item (o sistema pergunta depois).',
      'Se o cliente mencionar algo que não existe no cardápio, não invente um item parecido: descreva em "nao_entendido".',
      'Se o cliente não falar bairro/endereço, deixe "bairro" como null.',
      'Se o cliente disser que vai buscar/retirar, "tipo_pedido"="retirada". Se disser que é pra entregar/mandar em casa, "tipo_pedido"="delivery". Se disser que está numa mesa do restaurante, "tipo_pedido"="mesa". Se não falar nada sobre isso, deixe null.',
      'Se o cliente não falar forma de pagamento, deixe "forma_pagamento" como null — não assuma dinheiro por padrão.',
      '"obs" é só pra observação daquele item específico (ex: "sem cebola"), não pro pedido inteiro.'
    ].join(' ')
    const userPrompt = JSON.stringify({ texto_transcrito: texto, cardapio: cardapioCtx })
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: sysPrompt }, { role: 'user', content: userPrompt }]
      }),
      signal: AbortSignal.timeout(30000)
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) { log('❌', '[VOZ] Extração erro:', data?.error?.message || r.status); return null }
    let parsed
    try { parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}') } catch { return null }
    const mapaCardapio = new Map(itensAtivos.map(i => [i.id, i]))
    const itens = (Array.isArray(parsed.itens) ? parsed.itens : [])
      .map(it => {
        const item = mapaCardapio.get(parseInt(it.item_id))
        if (!item) return null // ignora qualquer id que a IA tenha inventado
        const qty = Math.max(1, parseInt(it.qty) || 1)
        const gruposObrig = _vozGruposObrigatorios(item)
        // Resolve as escolhas que a IA já capturou do áudio, batendo o nome
        // da opção contra a lista real do grupo (evita aceitar algo inventado).
        const escolhasIA = Array.isArray(it.escolhas) ? it.escolhas : []
        const gruposResolvidos = [] // [{nome, opcaoNome, precoExtra}]
        const gruposFaltando = []   // [{nome, opcoes:[{nome,preco}]}]
        for (const g of gruposObrig) {
          const escolha = escolhasIA.find(e => _normBairro(e?.grupo || '') === _normBairro(g.nome))
          const opcaoMatch = escolha ? g.opcoes.find(o => _normBairro(o.nome) === _normBairro(escolha.opcao || '')) : null
          if (opcaoMatch) gruposResolvidos.push({ nome: g.nome, opcaoNome: opcaoMatch.nome, precoExtra: parseFloat(opcaoMatch.preco) || 0 })
          else gruposFaltando.push({ nome: g.nome, opcoes: g.opcoes.map(o => ({ nome: o.nome, preco: parseFloat(o.preco) || 0 })) })
        }
        return {
          id: item.id, name: item.name, price: parseFloat(item.price) || 0, qty,
          obs: String(it.obs || '').slice(0, 200),
          gruposResolvidos, gruposFaltando
        }
      })
      .filter(Boolean)
    const formaPagValida = ['dinheiro', 'pix', 'cartao'].includes(parsed.forma_pagamento) ? parsed.forma_pagamento : null
    const tipoPedidoValido = ['delivery', 'retirada', 'mesa'].includes(parsed.tipo_pedido) ? parsed.tipo_pedido : null
    return {
      itens,
      bairro: parsed.bairro ? String(parsed.bairro).slice(0, 80) : null,
      tipo_pedido: tipoPedidoValido,
      forma_pagamento: formaPagValida,
      observacao_geral: parsed.observacao_geral ? String(parsed.observacao_geral).slice(0, 300) : null,
      nao_entendido: parsed.nao_entendido ? String(parsed.nao_entendido).slice(0, 300) : null
    }
  } catch (e) { log('❌', '[VOZ] Falha na extração do pedido:', e.message); return null }
}

async function handleIAWebhook(req, res) {
  const body = req._parsedBody !== undefined ? req._parsedBody : await readBody(req)
  const upath = new URL(req.url,`http://x`).pathname
  let tenantId = null
  if (upath.startsWith('/webhook/whatsapp')) tenantId = upath.split('/')[3]||null
  else { const slug=upath.split('/')[2]||null; if(slug){const row=db.prepare("SELECT id FROM tenants WHERE slug=? OR id=?").get(slug,slug);tenantId=row?.id||null} }
  tenantId = tenantId||req.headers['x-tenant-id']||null
  try {
    const msg    = body?.data?.message?.conversation||body?.data?.message?.extendedTextMessage?.text||''
    const data   = body?.data || {}
    const from   = [data?.key?.remoteJid, data?.key?.remoteJidAlt, data?.key?.participant, data?.key?.participantAlt, data?.participant, data?.sender].find(j => phoneUtils.cleanWhatsappJid(j)) || data?.key?.remoteJid || ''
    const fromMe = body?.data?.key?.fromMe||false
    const msgId  = body?.data?.key?.id || null  // usado pra marcar como lida (visto azul)
    // Se mensagem foi enviada pelo próprio gestor via WhatsApp, registra pausa da IA
    if (fromMe && from && tenantId) {
      const phone = phoneUtils.cleanWhatsappJid(from)
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
    // ── Pedido por voz (WhatsApp) ────────────────────────────────────
    // Mensagem de áudio (voice note) do cliente — só processa se o tenant
    // tiver o add-on ativado pelo admin (tenants.voz_ativo). Sem isso,
    // mantém o comportamento de sempre: áudio é ignorado (msg vazio cai
    // no early-return logo abaixo).
    const audioMsg = body?.data?.message?.audioMessage || null
    if (!msg && audioMsg && from && tenantId) {
      const phoneVoz = phoneUtils.cleanWhatsappJid(from)
      const tRow = phoneVoz ? db.prepare('SELECT voz_ativo FROM tenants WHERE id=?').get(tenantId) : null
      if (phoneVoz && tRow?.voz_ativo) {
        send(res, 200, { ok: true, voz: true }) // responde rápido — processa em background
        ;(async () => {
          try {
            const cfgV = db.prepare('SELECT evo_instance FROM store_config WHERE tenant_id=?').get(tenantId)
            const inst = cfgV?.evo_instance || EVO_INST
            if (msgId) await markAsRead(phoneVoz, msgId, inst)
            if (!_vozDentroDoLimite(tenantId, phoneVoz)) {
              log('🚫', `[VOZ] Limite de áudios/hora atingido — ${phoneVoz} [${tenantId}]`)
              await sendWA(phoneVoz, 'Você enviou muitos áudios em pouco tempo 🙏 Aguarde alguns minutos ou escreva seu pedido, por favor.', inst)
              return
            }
            _vozRegistrarUso(tenantId, phoneVoz)
            const media = await baixarMidiaWhatsapp(tenantId, msgId, from)
            if (!media?.base64) {
              await sendWA(phoneVoz, 'Não consegui baixar seu áudio 😕 Pode tentar reenviar ou escrever o pedido?', inst)
              return
            }
            const texto = await transcreverAudioWhatsapp(media.base64, media.mimetype, tenantId)
            if (!texto) {
              await sendWA(phoneVoz, 'Não consegui entender o áudio 😕 Pode tentar de novo ou escrever o pedido?', inst)
              return
            }
            log('🎙️', `[VOZ] Transcrito [${tenantId}] ${phoneVoz}: "${texto}"`)
            // Checa loja aberta ANTES de gastar a chamada de extração — evita o
            // cliente passar por todo o fluxo (itens, bairro, pagamento) só pra
            // descobrir no final que a loja está fechada. Agendamento não é
            // suportado por voz ainda; nesse caso, direciona pro cardápio.
            const _abertaChk = isLojaAbertaServer(tenantId)
            if (!_abertaChk.aberto) {
              await sendWA(phoneVoz, `${_abertaChk.motivo || 'Loja fechada no momento.'} Se quiser agendar o pedido, finalize pelo cardápio da loja.`, inst)
              return
            }
            const extraido = await extrairPedidoDeTexto(tenantId, texto)
            if (!extraido) {
              await sendWA(phoneVoz, 'Entendi o áudio, mas tive um problema pra montar o pedido. Pode tentar de novo ou escrever?', inst)
              return
            }
            await _vozIniciarConfirmacao(tenantId, phoneVoz, inst, extraido)
          } catch (e) { log('❌', '[VOZ] erro no processamento do áudio:', e.message) }
        })()
        return
      }
      // Sem add-on ativo: ignora o áudio, igual já acontecia antes de existir essa função
      send(res, 200, { ok: true }); return
    }

    // ── Comprovante de PIX manual (imagem) enviado pelo cliente ──────
    // Só reconhece/responde se houver um pedido por voz dele aguardando
    // esse pagamento — não interfere em nenhum outro fluxo de imagem.
    const imageMsg = body?.data?.message?.imageMessage || null
    if (!msg && imageMsg && from && tenantId) {
      const phoneImg = phoneUtils.cleanWhatsappJid(from)
      if (phoneImg) {
        const pedidoPix = db.prepare(`
          SELECT id FROM orders
          WHERE tenant_id=? AND phone=? AND status='aguardando_pix' AND pag='pix_manual' AND canal='voz_whatsapp'
          ORDER BY id DESC LIMIT 1
        `).get(tenantId, phoneImg)
        if (pedidoPix) {
          const cfgImg = db.prepare('SELECT evo_instance FROM store_config WHERE tenant_id=?').get(tenantId)
          await sendWA(phoneImg, '📎 Recebi seu comprovante! Assim que a loja confirmar o pagamento, seu pedido entra em preparo e eu te aviso por aqui.', cfgImg?.evo_instance || EVO_INST)
          send(res, 200, { ok: true, voz: true }); return
        }
      }
    }

    if (!msg||!from) { send(res,200,{ok:true}); return }
    const phone = phoneUtils.cleanWhatsappJid(from)
    if (!phone) { send(res,200,{ok:true}); return }
    if (!tenantId) { send(res,200,{ok:true}); return }
    const cfg = db.prepare("SELECT ia_config,evo_instance,store_name,store_descricao,store_whatsapp,store_tempo_entrega,store_tempo_retirada,delivery_fee_config,horarios_config,store_open,order_num_offset FROM store_config WHERE tenant_id=?").get(tenantId)
    if (!cfg) { send(res,200,{ok:true}); return }
    // ── Pedido por voz: resposta a um rascunho pendente ──────────────
    // Tem prioridade sobre tudo (acompanhamento, robô determinístico) porque
    // é uma mini-conversa curta e já em andamento — uma resposta tipo "sim"
    // aqui não deve cair no roteador normal por engano.
    const vozDraft = _vozLerDraft(tenantId, phone)
    if (vozDraft) {
      const inst = cfg.evo_instance || EVO_INST
      const msgNorm = msg.trim().toLowerCase()
      if (vozDraft.estado === 'aguardando_grupo') {
        const pend = _vozProximaPendenciaGrupo(vozDraft.itens)
        if (!pend) { _vozApagarDraft(tenantId, phone); send(res,200,{ok:true, voz:true}); return }
        const digitado = msg.trim()
        const opcaoMatch = pend.grupo.opcoes.find(o => _normBairro(o.nome) === _normBairro(digitado))
          || pend.grupo.opcoes.find(o => _normBairro(o.nome).includes(_normBairro(digitado)) || _normBairro(digitado).includes(_normBairro(o.nome)))
        if (!opcaoMatch) {
          const opcoesTxt = pend.grupo.opcoes.map(o => o.nome).join(', ')
          await sendWA(phone, `Não entendi. Opções pra *${pend.grupo.nome}*: ${opcoesTxt}`, inst)
          send(res,200,{ok:true, voz:true}); return
        }
        const itensAtualizados = vozDraft.itens.map((it, idx) => {
          if (idx !== pend.itemIndex) return it
          return {
            ...it,
            gruposFaltando: it.gruposFaltando.slice(1),
            gruposResolvidos: [...(it.gruposResolvidos || []), { nome: pend.grupo.nome, opcaoNome: opcaoMatch.nome, precoExtra: parseFloat(opcaoMatch.preco) || 0 }]
          }
        })
        await _vozProcessarGruposPendentes(tenantId, phone, inst, { ...vozDraft, itens: itensAtualizados })
        send(res,200,{ok:true, voz:true}); return
      }
      if (vozDraft.estado === 'aguardando_tipo_entrega') {
        let tipo = null
        if (/\bentrega\b|\bdelivery\b/i.test(msgNorm)) tipo = 'delivery'
        else if (/\bretirad|\bretirar\b|\bbuscar\b/i.test(msgNorm)) tipo = 'retirada'
        if (!tipo) {
          await sendWA(phone, 'Não entendi — responda *entrega* ou *retirada*.', inst)
          send(res,200,{ok:true, voz:true}); return
        }
        await _vozResolverTipoEEndereco(tenantId, phone, inst, { ...vozDraft, tipo_pedido: tipo })
        send(res,200,{ok:true, voz:true}); return
      }
      if (vozDraft.estado === 'aguardando_ponto_retirada') {
        const pontos = _vozPontosRetirada(tenantId)
        const idxDigitado = parseInt(msg.trim())
        let ponto = (idxDigitado >= 1 && idxDigitado <= pontos.length) ? pontos[idxDigitado - 1] : null
        if (!ponto) ponto = pontos.find(p => _normBairro(p.nome).includes(_normBairro(msg.trim())))
        if (!ponto) {
          await sendWA(phone, 'Não entendi — responda com o número da unidade.', inst)
          send(res,200,{ok:true, voz:true}); return
        }
        const addr = ['Retirada', ponto.endereco || ponto.nome].filter(Boolean).join(' — ')
        await _vozContinuarPagamento(tenantId, phone, inst, { ...vozDraft, addr, taxa: 0 })
        send(res,200,{ok:true, voz:true}); return
      }
      if (vozDraft.estado === 'aguardando_bairro') {
        const feeConfig = cfg.delivery_fee_config ? jsonParse(cfg.delivery_fee_config) : {}
        const resTaxa = _vozResolverTaxa(feeConfig, msg.trim())
        if (resTaxa.suportado && resTaxa.resolvido) {
          await _vozContinuarPagamento(tenantId, phone, inst, { ...vozDraft, addr: resTaxa.addrLabel, taxa: resTaxa.taxa })
        } else {
          const sugestoesTxt = resTaxa.sugestoes?.length ? ` Você quis dizer: ${resTaxa.sugestoes.join(', ')}?` : ''
          await sendWA(phone, `Não encontrei esse bairro na nossa área de entrega.${sugestoesTxt} Pode confirmar o nome do bairro?`, inst)
        }
        send(res,200,{ok:true, voz:true}); return
      }
      if (vozDraft.estado === 'aguardando_pagamento') {
        const _pixRegex = /\bpix\b/i
        const _dinheiroRegex = /\b(dinheiro|especie|espécie|cash)\b/i
        const _cartaoRegex = /\bcart[aã]o\b/i
        let forma = null
        if (_pixRegex.test(msgNorm)) forma = 'pix'
        else if (_dinheiroRegex.test(msgNorm)) forma = 'dinheiro'
        else if (_cartaoRegex.test(msgNorm)) forma = 'cartao'
        if (!forma) {
          await sendWA(phone, 'Não entendi — responda *dinheiro* ou *pix*.', inst)
          send(res,200,{ok:true, voz:true}); return
        }
        await _vozMontarConfirmacaoFinal(tenantId, phone, inst, { ...vozDraft, forma_pagamento: forma })
        send(res,200,{ok:true, voz:true}); return
      }
      if (vozDraft.estado === 'aguardando_troco') {
        let troco = null
        if (!/^n[aã]o\b|^nao\b|sem troco/i.test(msgNorm)) {
          const valorMatch = msg.match(/(\d+[.,]?\d*)/)
          troco = valorMatch ? parseFloat(valorMatch[1].replace(',', '.')) : -1
        }
        await _vozMontarConfirmacaoFinal(tenantId, phone, inst, { ...vozDraft, troco })
        send(res,200,{ok:true, voz:true}); return
      }
      if (vozDraft.estado === 'aguardando_nome') {
        const nomeDigitado = msg.trim().slice(0, 60)
        if (!nomeDigitado || nomeDigitado.length < 2) {
          await sendWA(phone, 'Não peguei seu nome — pode escrever de novo?', inst)
          send(res,200,{ok:true, voz:true}); return
        }
        if (_vozApagarDraft(tenantId, phone)) {
          await _vozCriarPedido(tenantId, phone, inst, vozDraft, nomeDigitado)
        }
        send(res,200,{ok:true, voz:true}); return
      }
      if (vozDraft.estado === 'aguardando_confirmacao') {
        const _simRegex = /^(sim|s|confirmo|confirma|isso|ok|pode|correto|certo)\b/i
        const _naoRegex = /^(n[aã]o|nao|n|cancela|cancelar|errado)\b/i
        if (_simRegex.test(msgNorm)) {
          const nomeCli = data?.pushName || (db.prepare(`SELECT name FROM customers WHERE tenant_id=? AND ${phoneLookupSql('phone')} ORDER BY id DESC LIMIT 1`).get(tenantId, ...phoneLookupArgs(phone))?.name) || null
          if (!nomeCli) {
            // O cardápio sempre pede o nome no checkout — sem pushName do
            // WhatsApp nem cadastro anterior, pergunta em vez de criar o
            // pedido com "Cliente WhatsApp" genérico no kanban do gestor.
            _vozSalvarDraft(tenantId, phone, { ...vozDraft, estado: 'aguardando_nome' })
            await sendWA(phone, 'Qual seu nome, por favor?', inst)
          } else if (_vozApagarDraft(tenantId, phone)) {
            // Só segue se REALMENTE apagou agora — protege contra mensagem "sim"
            // duplicada (reenvio de rede do WhatsApp) criar o pedido 2x.
            await _vozCriarPedido(tenantId, phone, inst, vozDraft, nomeCli)
          }
        } else if (_naoRegex.test(msgNorm)) {
          if (_vozApagarDraft(tenantId, phone)) {
            await sendWA(phone, 'Pedido cancelado. Se quiser, mande outro áudio ou fale com a loja.', inst)
          }
        } else {
          await sendWA(phone, 'Não entendi — responda *sim* pra confirmar o pedido ou *não* pra cancelar.', inst)
        }
        send(res,200,{ok:true, voz:true}); return
      }
    }
    if (await responderAcompanhamentoWhatsapp({ tenantId, phone, text: msg, msgIds: msgId ? [msgId] : [], cfg })) {
      const pendingBufKey = `buf:${tenantId}:${phone}`
      if (_msgBuffer.has(pendingBufKey)) {
        try { clearTimeout(_msgBuffer.get(pendingBufKey).timer) } catch {}
        _msgBuffer.delete(pendingBufKey)
      }
      send(res,200,{ok:true, tracking:true}); return
    }
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
    const bufKey=`buf:${tenantId}:${phone}`
    const loopGuard = _iaAutoLoopDecision(tenantId, phone, msg)
    if (loopGuard.ignore) {
      if (_msgBuffer.has(bufKey)) {
        try { clearTimeout(_msgBuffer.get(bufKey).timer) } catch {}
        _msgBuffer.delete(bufKey)
      }
      if (loopGuard.pause) _pausaHumano.set(pausaKey, Date.now())
      log('[IA]', `[anti-loop] Silenciando ${phone} [${tenantId}] - ${loopGuard.reason}: "${String(msg).slice(0, 120)}"`)
      send(res,200,{ok:true, ignored:true, reason:loopGuard.reason}); return
    }
    const histKey=`conv:${tenantId}:${phone}:hist`
    if (!_msgBuffer.has(histKey)) _msgBuffer.set(histKey,[])
    const convHist = _msgBuffer.get(histKey)
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
      const _hoje = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Sao_Paulo'})).toISOString().split('T')[0]
      const _dayKey = `${tenantId}:${phone}`
      const _isPrimeiraMsgDia = _lastDayMsg.get(_dayKey) !== _hoje
      _lastDayMsg.set(_dayKey, _hoje)
      const _saudacaoRegex = /^\s*(oi|olá|ola|hey|hi|hello|bom\s*dia|boa\s*(tarde|noite)|e\s*a[ií]|eai|opa|salve|fala|alo|alô|tudo\s*bem|td\s*bem|blz|beleza)\s*[!.,?☺😊🙂👋🤗]*\s*$/i
      const _isSoSaudacao = _saudacaoRegex.test(msgFull.trim())
      const _horaAtual = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Sao_Paulo'})).getHours()
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
      // ════════════════════════════════════════════════════════════════
      // ── PEDIDO POR TEXTO (add-on de voz) — checado ANTES dos 4 intents
      // abaixo. Motivo: o intent [4] (saudação/cardápio) dispara pra
      // QUALQUER primeira mensagem do dia, não importa o conteúdo — sem
      // checar pedido antes, "quero um x-tudo" como primeira mensagem do
      // dia nunca vira pedido, sempre cai só no link do cardápio.
      // Reaproveita o MESMO pipeline do áudio (extração + confirmação); só
      // segue se a IA achar pelo menos 1 item de verdade, senão passa a
      // vez pro roteador normal (saudação/status/cupom/horário/silêncio).
      const _tRowTxt = db.prepare('SELECT voz_ativo FROM tenants WHERE id=?').get(tenantId)
      if (_tRowTxt?.voz_ativo && _vozDentroDoLimite(tenantId, phone)) {
        const _abertaChkTxt = isLojaAbertaServer(tenantId)
        if (_abertaChkTxt.aberto) {
          const extraidoTxt = await extrairPedidoDeTexto(tenantId, msgFull)
          if (extraidoTxt && extraidoTxt.itens.length > 0) {
            _vozRegistrarUso(tenantId, phone)
            log('🎙️', `[VOZ-TXT] Pedido por texto detectado [${tenantId}] ${phone}: "${msgFull.slice(0, 80)}"`)
            await _vozIniciarConfirmacao(tenantId, phone, inst, extraidoTxt)
            return
          }
        }
      }
      // ════════════════════════════════════════════════════════════════
      const linkCardapio=linkCardapioTenant(tenantId)
      const agora=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Sao_Paulo'})), diasSemana=['dom','seg','ter','qua','qui','sex','sab'], diaHoje=diasSemana[agora.getDay()], horaMin=agora.getHours()*60+agora.getMinutes()
      // ── Helpers para pedido ──
      const _offsetCfg = db.prepare("SELECT order_num_offset FROM store_config WHERE tenant_id=?").get(tenantId)
      const _iaOffset  = parseInt(_offsetCfg?.order_num_offset) || 0
      const _iaPedNum  = (p) => {
        const status = String(p?.status || '').toLowerCase()
        const pag = String(p?.pag || '').toLowerCase()
        if (p?.order_num) return String(p.order_num).padStart(3, '0')
        if (status === 'aguardando_cartao' || (status === 'aguardando_pix' && pag !== 'pix_manual')) return ''
        return String(atribuirOrderNumSeNecessario(tenantId, p.id) || numeroPedidoPad(p, _iaOffset)).padStart(3, '0')
      }
      const _phoneArgs  = phoneLookupArgs(phone)
      const _phoneWhere = phoneLookupSql('phone')
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
      const _msgNum    = msgFull.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      const _numMatch  = msgFull.match(/#\s*\*?\s*(\d{1,6})\s*\*?/) || _msgNum.match(/pedido\s*(?:n(?:umero|ro|o)?\.?\s*)?[*#:]?\s*(\d{1,6})/i) || _msgNum.match(/numero\s*(?:do\s+pedido)?\s*[*#:]?\s*(\d{1,6})/i)
      const _kwPedido  = /\b(acompanhar\s+(meu\s+|o\s+)?pedido|rastrear\s+(meu\s+|o\s+)?pedido|rastrei?o\s+(do\s+)?pedido|meu\s+pedido|fiz\s+(um\s+)?pedido|acabei\s+de\s+(fazer|pedir)|j[aá]\s+(fiz|pedi)\s+(meu\s+|um\s+)?pedido|pedido\s+(j[aá]|saiu|chegou|t[aá]|est[aá]|ainda|atrasou|atrasado|demorando|pronto|sair[aá]|sai)|me\s+avisa\s+(quando\s+)?(estiver|tiver|ficar)\s+pronto|me\s+avise\s+(quando\s+)?(estiver|tiver|ficar)\s+pronto|avis(a|e)\s+(quando\s+)?(estiver|tiver|ficar)\s+pronto|quando\s+(estiver|tiver|ficar)\s+pronto|status\s+(do\s+)?pedido|cad[eê]\s+(meu|o)\s+pedido|onde\s+(est[aá]|t[aá])\s+(meu|o)\s+pedido|quanto\s+(tempo|falta)|saiu\s+(da|para|pra)\s+entrega|j[aá]\s+saiu)\b/i
      const _kwCupom   = /\b(cupom|cupons|promo[çc][ãa]o|promo[çc][õo]es|desconto|descontos|oferta|ofertas)\b/i
      const _kwCardapio= /\b(card[aá]pio|menu|fome|pedir|fazer\s+pedido|quero\s+pedir|tem\s+o\s+que|t[ãa]o\s+servindo|pode\s+fazer)\b/i
      const _kwHorario = /\b(hor[aá]rio|que\s+horas?|que\s+hora|abre|abrem|fecha|fecham|fechou|fecharam|fechad|abriu|abriram|t[ãa]o?\s+aberto|est[ãa]o?\s+aberto|aberto\s+(agora|hoje)|funciona|funcionam|funcionando|atendem|atendendo|trabalha|trabalham|at[eé]\s+que\s+horas?|de\s+que\s+horas?)\b/i

      // ── Loja aberta? + próximo horário de abertura ──
      const horariosCfg = jsonParse(cfg.horarios_config) || {}
      const diaConfig = horariosCfg[diaHoje]
      const _flagAberto = (v) => {
        if (v === false || v === 0) return false
        if (typeof v === 'string') {
          const s = v.trim().toLowerCase()
          if (s === 'false' || s === '0' || s === 'fechado') return false
        }
        return true
      }
      const _horarioAtivoCfg = (dc) => {
        if (!dc) return false
        if (dc.ativo === true || dc.ativo === 1) return true
        if (typeof dc.ativo === 'string') {
          const s = dc.ativo.trim().toLowerCase()
          return s === 'true' || s === '1' || s === 'sim'
        }
        return false
      }
      const _horaMinCfg = (v) => {
        const raw = String(v || '').trim().toLowerCase().replace(/\s+/g, '')
        const m = raw.match(/^(\d{1,2})(?:(?::|h)(\d{1,2}))?h?$/)
        if (!m) return null
        const hh = parseInt(m[1], 10)
        const mm = m[2] === undefined ? 0 : parseInt(m[2], 10)
        if (hh === 24 && mm === 0) return 1440
        if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
        return hh * 60 + mm
      }
      // Normaliza o cfg do dia numa lista de janelas [{abertura,fechamento}].
      // Compatível com o formato antigo (abertura/fechamento direto no dia).
      const _janelasCfg = (dc) => {
        if (!dc) return []
        if (Array.isArray(dc.janelas) && dc.janelas.length) return dc.janelas
        if (dc.abertura || dc.fechamento) return [{ abertura: dc.abertura, fechamento: dc.fechamento }]
        return []
      }
      const _horarioAbertoCfg = (dc, minAtual, deOntem) => {
        if (!_horarioAtivoCfg(dc)) return false
        const janelas = _janelasCfg(dc)
        if (!janelas.length) return false
        return janelas.some(j => {
          const abertura = _horaMinCfg(j.abertura) ?? 0
          const fechamento = _horaMinCfg(j.fechamento) ?? 1439
          if (abertura === fechamento) return true
          if (fechamento > abertura) return !deOntem && minAtual >= abertura && minAtual < fechamento
          return deOntem ? minAtual < fechamento : minAtual >= abertura
        })
      }
      // Texto tipo "das 11:00 às 14:30 e das 18:00 às 23:00" (junta as janelas)
      const _horarioTxtCfg = (dc) => {
        const janelas = _janelasCfg(dc)
        if (!janelas.length) return null
        return janelas.map(j => `das ${j.abertura} às ${j.fechamento}`).join(' e ')
      }
      let lojaAbertaAgora = _flagAberto(cfg.store_open)
      let horarioHojeStr = null  // ex: "das 11:00 às 14:30 e das 18:00 às 23:00"
      if (_horarioAtivoCfg(diaConfig)) {
        horarioHojeStr = _horarioTxtCfg(diaConfig)
      }
      if (lojaAbertaAgora && Object.keys(horariosCfg).length) {
        const idxAgora = agora.getDay()
        const hojeAberto = _horarioAbertoCfg(horariosCfg[diasSemana[idxAgora]], horaMin, false)
        const ontemAberto = _horarioAbertoCfg(horariosCfg[diasSemana[(idxAgora + 6) % 7]], horaMin, true)
        lojaAbertaAgora = hojeAberto || ontemAberto
        if (!horarioHojeStr && ontemAberto) {
          const dcOntem = horariosCfg[diasSemana[(idxAgora + 6) % 7]]
          horarioHojeStr = _horarioTxtCfg(dcOntem)
        }
      }

      // Próximo horário de abertura (caso loja esteja fechada)
      // — usado tanto na resposta de "que horas abrem" quanto no aviso de
      //   "loja fechada" inserido em saudação/cardápio.
      const _diasNome = { dom:'domingo', seg:'segunda', ter:'terça', qua:'quarta', qui:'quinta', sex:'sexta', sab:'sábado' }
      let proxAberturaStr = null  // ex: "hoje às 18h" / "amanhã às 18h" / "sexta às 18h"
      if (Object.keys(horariosCfg).length) {
        const idxHoje = agora.getDay()
        busca:
        for (let i = 0; i < 7; i++) {
          const idx = (idxHoje + i) % 7
          const dia = diasSemana[idx]
          const dc = horariosCfg[dia]
          if (!_horarioAtivoCfg(dc)) continue
          const janelas = _janelasCfg(dc)
          if (!janelas.length) continue
          if (i === 0) {
            // Hoje — pega a primeira janela cuja abertura ainda não passou
            // (cobre o caso de almoço/jantar: fechado às 15h, abre de novo às 18h)
            for (const j of janelas) {
              const aberturaMin = _horaMinCfg(j.abertura) ?? 0
              if (horaMin < aberturaMin) { proxAberturaStr = `hoje às ${j.abertura}`; break busca }
            }
          } else {
            const nome = i === 1 ? 'amanhã' : _diasNome[dia]
            proxAberturaStr = `${nome} às ${janelas[0].abertura}`
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
          ped = db.prepare(`SELECT id,order_num,client,status,total,taxa,items,addr,pag,troco,created_at FROM orders WHERE tenant_id=? AND ${_phoneWhere} AND order_num=? ORDER BY id DESC LIMIT 1`).get(tenantId, ..._phoneArgs, n)
          if (!ped) ped = db.prepare(`SELECT id,order_num,client,status,total,taxa,items,addr,pag,troco,created_at FROM orders WHERE tenant_id=? AND ${_phoneWhere} AND id=? AND (order_num IS NULL OR order_num=0) LIMIT 1`).get(tenantId, ..._phoneArgs, realId)
        } else {
          // Sem número citado — pega o pedido mais recente do cliente
          ped = db.prepare(`SELECT id,order_num,client,status,total,taxa,items,addr,pag,troco,created_at FROM orders WHERE tenant_id=? AND ${_phoneWhere} ORDER BY id DESC LIMIT 1`).get(tenantId, ..._phoneArgs)
        }
        if (ped && String(ped.status || '').toLowerCase() === 'cancelado') {
          // Mesmo motivo do acompanhamento automático: não faz sentido mostrar
          // a barra de progresso completa pra um pedido que foi cancelado e
          // nunca passou por esses passos de verdade.
          ped = null
        }
        if (ped) {
          const pedNum = _iaPedNum(ped)
          const td = _tempoDecorrido(ped.created_at)

          // ── ATIVA TRACKING DESTE PEDIDO ────────────────────────
          // Cliente perguntou sobre o pedido (geralmente clicou no botão
          // "Acompanhar pelo WhatsApp"). A partir de agora, esse pedido
          // tem `wa_track=1` e a loja PASSA a enviar atualizações de
          // status (em produção, pronto, saiu, entregue) automaticamente,
          // sem o cliente perguntar de novo.
          // Se o pedido já está com tracking ativo, o UPDATE é noop.
          try {
            db.prepare("UPDATE orders SET wa_track=1 WHERE id=? AND tenant_id=? AND COALESCE(wa_track,0)=0").run(ped.id, tenantId)
          } catch(e) { log('⚠️', '[wa_track] falha ao ativar:', e.message) }

          resposta = buildOrderTrackingMessage({
            order: ped,
            storeName: cfg?.store_name || 'Restaurante',
            orderNumber: pedNum,
            elapsedText: td,
            includeTrackingNote: true
          })
        } else {
          if (_numMatch) {
            const nInfo = String(parseInt(_numMatch[1])).padStart(3, '0')
            resposta = _pickOne([
              `🔎 Não encontrei o pedido *#${nInfo}* pra esse WhatsApp. Confere o número ou chama a loja que a gente te ajuda!`,
              `🔎 Não achei o pedido *#${nInfo}* vinculado a esse número. Se precisar, um atendente confere pra você.`,
              `🔎 Esse pedido *#${nInfo}* não apareceu aqui pra esse WhatsApp. Confere o número e me chama de novo!`
            ])
          } else {
          resposta = _pickOne([
            `🔎 Não encontrei nenhum pedido seu por aqui. Bora fazer um novo? 😋 ${linkCardapio}`,
            `🔎 Não achei pedido recente seu. Dá uma olhada no cardápio: ${linkCardapio}`,
            `🔎 Não encontrei pedido seu por aqui. Cardápio completo: ${linkCardapio}`
          ])
          }
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
        } else if (horarioHojeStr && _horarioAtivoCfg(diaConfig)) {
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
            `${_saudacaoHora}! 😊 Seja muito bem-vindo(a) ao ${nomeLojaFmt}!${aviso}\nDá uma olhadinha no nosso cardápio, tem coisa boa esperando por você: ${linkCardapio}`,
            `${_saudacaoHora}! 👋 Que bom te ver por aqui! Aqui é a ${nomeLojaFmt}.${aviso}\nConfira nosso cardápio e escolhe o que mais te agradar: ${linkCardapio}`,
            `${_saudacaoHora}! 🍽️ Bem-vindo(a) ao ${nomeLojaFmt} — vai ser um prazer te atender!${aviso}\nNosso cardápio completo está aqui: ${linkCardapio}`
          ])
        } else {
          resposta = _pickOne([
            `${aviso ? aviso + '\n' : ''}Claro! 😋 Aqui está nosso cardápio: ${linkCardapio}`,
            `${aviso ? aviso + '\n' : ''}Segue nosso cardápio completinho: ${linkCardapio}`,
            `${aviso ? aviso + '\n' : ''}Aqui está, dá uma olhada: ${linkCardapio} 🍽️`
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
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.svg':'image/svg+xml','.json':'application/json','.mp4':'video/mp4','.webm':'video/webm'}

function send(res, status, data) {
  const body = JSON.stringify(data)
  res.setHeader('Content-Type','application/json')
  const ae = res.req?.headers?.['accept-encoding']||''
  if (body.length>1024&&ae.includes('gzip')) {
    zlib.gzip(body,(err,buf)=>{ if(err){res.writeHead(status);res.end(body);return}; res.setHeader('Content-Encoding','gzip');res.setHeader('Vary','Accept-Encoding');res.writeHead(status);res.end(buf) }); return
  }
  res.writeHead(status); res.end(body)
}

const MAX_BODY_BYTES = 8 * 1024 * 1024 // 8MB — protege a memória do processo contra POST/PATCH gigantes
function readBody(req, maxBytes) {
  const limit = maxBytes || MAX_BODY_BYTES
  return new Promise((ok, err) => {
    let b = '', bytes = 0, aborted = false
    req.on('data', c => {
      if (aborted) return
      bytes += c.length
      if (bytes > limit) {
        aborted = true
        req.destroy()
        err(new Error('Corpo da requisição excede o limite permitido'))
        return
      }
      b += c
    })
    req.on('end', () => { if (!aborted) { try { ok(b ? JSON.parse(b) : {}) } catch { ok({}) } } })
    req.on('error', err)
  })
}

const etagCache = new Map()
function getEtag(fpath) {
  const mtime=fs.statSync(fpath).mtimeMs, cached=etagCache.get(fpath)
  if(cached&&cached.mtime===mtime) return cached.etag
  const etag='"'+crypto.createHash('md5').update(fs.readFileSync(fpath)).digest('hex')+'"'
  etagCache.set(fpath,{mtime,etag}); return etag
}

function _escHtmlAttr(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))
}

// O logo da loja é salvo como data URL (base64) direto no banco — bom pra
// exibir dentro do próprio app (funciona liso num <img src="data:...">),
// mas inútil pra WhatsApp/Instagram gerarem prévia de link, porque esses
// crawlers precisam baixar a imagem de uma URL de verdade, não aceitam um
// data URI gigante dentro da tag og:image. Essa rota "destrava" isso,
// decodificando o base64 e servindo como um arquivo de imagem normal.
function logoUrlServer(tenantId) {
  return `${PUBLIC_BASE_URL}/api/store-logo/${encodeURIComponent(tenantId)}.png`
}
function _handleStoreLogo(req, res, upath) {
  const m = upath.match(/^\/api\/store-logo\/([^/]+)\.(png|jpg|jpeg|webp)$/)
  if (!m) return false
  try {
    const tenantId = decodeURIComponent(m[1])
    const row = db.prepare('SELECT store_logo_url FROM store_config WHERE tenant_id=?').get(tenantId)
    const dataUrl = row?.store_logo_url || ''
    const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl)
    if (!match) { res.writeHead(404); res.end('Sem logo'); return true }
    const buf = Buffer.from(match[2], 'base64')
    res.setHeader('Content-Type', match[1])
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.writeHead(200)
    res.end(buf)
  } catch (e) { res.writeHead(500); res.end('Erro') }
  return true
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

// ── Ícones padrão de açougue (cortes/preparo) — compartilhados por TODOS
// os tenants, servidos como arquivo estático de cardapio/img/. Editáveis
// só pelo superadmin (não por tenant). _iconesVersion muda a cada upload
// e a cada reinício do servidor, servindo de cache-buster (os arquivos
// estáticos têm cache de 7 dias no navegador — sem isso, a troca de um
// ícone não apareceria pra quem já tinha visitado o cardápio antes).
let _iconesVersion = Date.now()
const ICONES_PADRAO_VALIDOS = new Set([
  'cortes/bifefino.png',
  'cortes/bifegrosso.png',
  'cortes/bifemedio.png',
  'cortes/cubos.png',
  'cortes/espeto.png',
  'cortes/grelha.png',
  'cortes/inteira.png',
  'cortes/moida-2x.png',
  'cortes/peca.png',
  'cortes/picado.png',
  'cortes/postas.png',
  'cortes/strogonoff.png',
  'cortes/tiras.png',
  'cortes/tirinhas.png',
  'tags/airfryer.png',
  'tags/churrasco.png',
  'tags/dia_a_dia.png',
  'tags/ensopado.png',
  'tags/espeto.png',
  'tags/forno.png',
  'tags/frigideira.png',
  'tags/grellhar.png',
  'tags/panela.png',
  'tags/smoker.png',
  'tags/wind.png',
  'ocasiao/churrasco.png',
  'ocasiao/dia_a_dia.png',
  'ocasiao/final_semana.png',
  'ocasiao/festas.png',
  'ocasiao/especial.png',
  'ocasiao/semana.png',
])
// Vídeos das "Formas de preparo" (tags) — recurso exclusivo dessa seção,
// não existe pra cortes. Um único arquivo por preparo (sem variante
// claro/escuro: filmagem real não faz sentido invertida pro tema escuro).
const ICONES_VIDEO_TAGS_KEYS = ['airfryer','churrasco','dia_a_dia','ensopado','espeto','forno','frigideira','grellhar','panela','smoker','wind']
const ICONES_VIDEO_VALIDOS = new Set(ICONES_VIDEO_TAGS_KEYS.map(k => `tags/${k}.mp4`))
for (const v of ICONES_VIDEO_VALIDOS) ICONES_PADRAO_VALIDOS.add(v)
const MAX_ICONE_VIDEO_BYTES = 10 * 1024 * 1024 // 10MB
// Corpo em base64 fica ~37% maior que o arquivo original + folga pro resto do JSON
const MAX_ICONE_VIDEO_BODY_BYTES = Math.ceil(MAX_ICONE_VIDEO_BYTES * 1.4) + 64 * 1024

const server = http.createServer(async (req,res) => {
  res.req = req
  res.setHeader('Access-Control-Allow-Origin','*')
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Prefer,apikey,Authorization,x-tenant-id,x-finance-auth,x-user-id')
  if(req.method==='OPTIONS'){res.writeHead(200);res.end();return}

  const url    = new URL(req.url,`http://localhost:${PORT}`)
  const upath  = url.pathname.replace(/\/$/,'')||'/'
  const params = url.searchParams

  // Rate limit global básico por IP — não se aplica a SSE (conexão longa) nem
  // a arquivos estáticos, só a chamadas de API. Mitiga flood/DoS simples.
  if (upath.startsWith('/api/') || upath.startsWith('/rest/v1/')) {
    if (!checkRateLimit('flood:' + clientIp(req), 300, 60 * 1000)) {
      send(res, 429, { error: 'Muitas requisições. Tente novamente em instantes.' }); return
    }
  }

  if(upath.startsWith('/sse/')){sseSubscribe(decodeURIComponent(upath.slice(5)),res);return}
  if(req.method==='GET'&&upath==='/api/tenant-info'){const info=handleTenantInfo(params);send(res,info.error?404:200,info);return}


  if(req.method==='POST'&&upath==='/api/finance-auth/verify'){
    const tid=req.headers['x-tenant-id']||''
    if(!tid){send(res,400,{error:'x-tenant-id obrigatorio'});return}
    const body=await readBody(req)
    const senha=String(body.senha||'')
    if(!senha){send(res,400,{error:'Informe a senha'});return}
    // Usa a MESMA verificação do login normal (verifyPassword), que aceita
    // tanto o formato novo (scrypt$salt$hash) quanto o legado (SHA256 puro).
    // Antes comparava só SHA256 direto na query — funcionava apenas
    // enquanto a senha nunca tivesse sido migrada; assim que o gestor
    // logava uma vez no painel (o que migra a senha pro formato novo),
    // a senha "parava de funcionar" aqui mesmo estando correta.
    const candidatos=db.prepare(`
      SELECT id,nome,email,role,tenant_id,senha_hash
      FROM sys_users
      WHERE tenant_id=? AND ativo=1
        AND role IN ('gestor','admin','superadmin')
      ORDER BY CASE role WHEN 'gestor' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
    `).all(tid)
    const user=candidatos.find(u=>verifyPassword(senha,u.senha_hash))
    if(!user){send(res,401,{error:'Senha do gestor incorreta'});return}
    if(precisaMigrarHash(user.senha_hash)){
      try{ db.prepare('UPDATE sys_users SET senha_hash=? WHERE id=?').run(hashPassword(senha),user.id) }catch(_){}
    }
    const access=criarFinanceAccess(user, body.user_id || req.headers['x-user-id'] || '')
    send(res,200,{ok:true,token:access.token,expires_at:access.expires_at,ttl_ms:access.ttl_ms,authorized_by:user.nome||'Gestor'})
    return
  }

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
  if(req.method==='GET'&&upath==='/api/tenant-info-gestor'){const tid=req.headers['x-tenant-id']||params.get('tenant_id')||'';if(!tid){send(res,400,{error:'x-tenant-id obrigatório'});return};const row=db.prepare('SELECT id,nome,slug,plano,ativo,expires_at,valor_mensalidade,valor_mensalidade_expira_em FROM tenants WHERE id=?').get(tid);if(!row){send(res,404,{error:'Tenant não encontrado'});return};const cfg=db.prepare('SELECT store_name FROM store_config WHERE tenant_id=?').get(tid);send(res,200,{...row,store_name:cfg?.store_name||row.nome||''});return}

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

  // ── Excluir pedido do histórico (irreversível) ──
  // Protegido pela senha do gestor (mesma trava da área financeira, x-finance-auth).
  // Remove o pedido por completo E qualquer lançamento financeiro (movimentos)
  // ligado a ele, pra garantir que nunca mais conte em nenhum relatório —
  // seja o pedido cancelado, entregue ou finalizado.
  if(req.method==='POST'&&upath==='/api/historico-pedidos/excluir'){
    const tid=req.headers['x-tenant-id']||params.get('tenant_id')||''
    if(!tid){send(res,400,{error:'x-tenant-id obrigatório'});return}
    const finAuth=validarFinanceAccess(req,tid)
    if(!finAuth){sendFinanceLocked(res);return}
    const body=await readBody(req)
    const orderId=parseInt(body.order_id)||0
    if(!orderId){send(res,400,{error:'order_id obrigatório'});return}
    try{
      const order=db.prepare('SELECT * FROM orders WHERE id=? AND tenant_id=?').get(orderId,tid)
      if(!order){send(res,404,{error:'Pedido não encontrado'});return}

      const cfg=db.prepare('SELECT order_num_offset FROM store_config WHERE tenant_id=?').get(tid)
      const numPedido=numeroPedidoComOffset(order,cfg?.order_num_offset)

      // Remove qualquer movimento financeiro ligado a esse pedido (entrada original
      // e eventuais estornos), pra não sobrar rastro nenhum no financeiro.
      const movsApagados=db.prepare(
        `DELETE FROM movimentos WHERE tenant_id=? AND (
           (tipo='entrada' AND (description LIKE ? OR description LIKE ?))
           OR (description LIKE ?)
         )`
      ).run(tid, `Pedido #${numPedido} –%`, `Pedido #${numPedido} -%`, `Estorno — Pedido #${numPedido}%`)

      // Reverte estatísticas do cliente, se contabilizadas
      if(order.customer_id){
        const valorPago=parseFloat(order.total||0)+parseFloat(order.taxa||0)
        db.prepare(`UPDATE customers SET orders_count = MAX(0, orders_count - 1),
                    total_spent = MAX(0, total_spent - ?) WHERE id=?`).run(valorPago,order.customer_id)
      }

      db.prepare('DELETE FROM order_status_history WHERE tenant_id=? AND order_id=?').run(tid,orderId)
      db.prepare('DELETE FROM orders WHERE id=? AND tenant_id=?').run(orderId,tid)

      // Log de auditoria em arquivo — quem excluiu, quando, e o que foi removido.
      try{
        const linha=`${new Date().toISOString()} | tenant=${tid} | user=${req.headers['x-user-id']||finAuth.session_user_id||'?'} | pedido #${numPedido} (id=${orderId}) | status_era=${order.status} | valor=R$${(parseFloat(order.total||0)+parseFloat(order.taxa||0)).toFixed(2)} | movimentos_removidos=${movsApagados.changes}\n`
        fs.appendFileSync(path.join(path.dirname(DB_PATH),'exclusoes-pedidos.log'),linha)
      }catch(e){ log('⚠️','[hist-excluir] log de auditoria falhou:',e.message) }

      marcarDirty()
      sseBroadcast(`orders-rt:${tid}`,'orders:DELETE',{id:orderId})
      send(res,200,{ok:true,movimentos_removidos:movsApagados.changes})
    }catch(e){ send(res,500,{error:e.message}) }
    return
  }

  // ── Exportar relatório CSV completo ──
  if(req.method==='GET'&&upath==='/api/exportar-relatorio'){
    const tid=req.headers['x-tenant-id']||params.get('tenant_id')||''
    if(!tid){send(res,400,{error:'x-tenant-id obrigatório'});return}
    if(!validarFinanceAccess(req,tid)){sendFinanceLocked(res);return}
    const de=params.get('de')||'', ate=params.get('ate')||''
    if(!de||!ate){send(res,400,{error:'Informe de e ate'});return}
    const orders=db.prepare(`SELECT id,order_num,client,phone,addr,items,total,taxa,pag,status,mesa_num,garcom_nome,created_at FROM orders WHERE tenant_id=? AND created_at>=? AND created_at<=? ORDER BY created_at ASC`).all(tid,de,ate+'T23:59:59.999Z')
    const movs=db.prepare(`SELECT id,description,tipo,val,pag,time,created_at FROM movimentos WHERE tenant_id=? AND created_at>=? AND created_at<=? ORDER BY created_at ASC`).all(tid,de,ate+'T23:59:59.999Z')
    const contas=db.prepare(`SELECT id,descricao,valor,vencimento,categoria,status,pago_em FROM contas_pagar WHERE tenant_id=? AND vencimento>=? AND vencimento<=? ORDER BY vencimento ASC`).all(tid,de,ate)
    const entregas=db.prepare(`
      SELECT e.id,e.order_id,e.status,e.valor_pedido,e.valor_receber,e.comissao,e.recebido,e.problema,
             e.assigned_at,e.saiu_at,e.entregue_at,e.created_at,
             o.order_num,o.client,o.phone,o.addr,o.pag,
             d.nome as entregador_nome
      FROM entregas e
      LEFT JOIN orders o ON o.id=e.order_id AND o.tenant_id=e.tenant_id
      LEFT JOIN entregadores d ON d.id=e.entregador_id AND d.tenant_id=e.tenant_id
      WHERE e.tenant_id=? AND e.created_at>=? AND e.created_at<=?
      ORDER BY e.created_at ASC
    `).all(tid,de,ate+'T23:59:59.999Z')
    const rotas=db.prepare(`
      SELECT r.id,r.status,r.pedidos_count,r.total_pedidos,r.dinheiro_previsto,r.comissao_total,
             r.iniciado_em,r.finalizado_em,r.obs,r.created_at,
             d.nome as entregador_nome
      FROM rotas_entrega r
      LEFT JOIN entregadores d ON d.id=r.entregador_id AND d.tenant_id=r.tenant_id
      WHERE r.tenant_id=? AND r.created_at>=? AND r.created_at<=?
      ORDER BY r.created_at ASC
    `).all(tid,de,ate+'T23:59:59.999Z')
    const estoqueMovs=db.prepare(`
      SELECT m.id,m.tipo,m.qty,m.saldo_antes,m.saldo_depois,m.origem,m.note,m.created_at,
             e.name as ingrediente,e.unit,
             mi.name as produto,
             o.order_num,o.client
      FROM estoque_movimentos m
      LEFT JOIN estoque e ON e.id=m.estoque_id AND e.tenant_id=m.tenant_id
      LEFT JOIN menu_items mi ON mi.id=m.item_id AND mi.tenant_id=m.tenant_id
      LEFT JOIN orders o ON o.id=m.order_id AND o.tenant_id=m.tenant_id
      WHERE m.tenant_id=? AND m.created_at>=? AND m.created_at<=?
      ORDER BY m.created_at ASC
    `).all(tid,de,ate+'T23:59:59.999Z')
    orders.forEach(r=>{try{r.items=JSON.parse(r.items)}catch{}})
    send(res,200,{orders,movimentos:movs,contas_pagar:contas,entregas,rotas_entrega:rotas,estoque_movimentos:estoqueMovs})
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
    const phoneSql = phoneLookupSql('phone')
    const cust=db.prepare(`SELECT cashback_saldo FROM customers WHERE tenant_id=? AND ${phoneSql} ORDER BY id DESC LIMIT 1`).get(tid,...phoneLookupArgs(phone))
    send(res,200,{saldo:parseFloat(cust?.cashback_saldo||0)});return
  }
  if(req.method==='POST'&&upath==='/api/cashback/usar'){
    const tid=req.headers['x-tenant-id']||params.get('tenant_id')||''
    const body=await readBody(req)
    const phone=(body.phone||'').replace(/\D/g,'')
    const valor=parseFloat(body.valor)||0
    if(!tid||!phone||valor<=0){send(res,400,{error:'Parâmetros inválidos'});return}
    const phoneSql = phoneLookupSql('phone')
    const cust=db.prepare(`SELECT id,cashback_saldo FROM customers WHERE tenant_id=? AND ${phoneSql} ORDER BY id DESC LIMIT 1`).get(tid,...phoneLookupArgs(phone))
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
    const phoneSql = phoneLookupSql('phone')
    const prog = db.prepare(`SELECT compras, ultimo_resgate FROM stamp_progress WHERE tenant_id=? AND ${phoneSql} ORDER BY id DESC LIMIT 1`).get(tid, ...phoneLookupArgs(phone))
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

  // ── Fidelidade (pontos): consulta de saldo pro cardápio público ──
  // Os pontos já eram somados a cada pedido finalizado (ver finishOrderById
  // / rota de confirmação), mas não existia nenhum jeito do CLIENTE ver
  // esse saldo no cardápio — só aparecia numa mensagem de WhatsApp depois
  // do pedido. Essa rota espelha exatamente o /api/stamp/check.
  if (req.method === 'GET' && upath === '/api/fidelidade/saldo') {
    const tid   = req.headers['x-tenant-id'] || ''
    const phone = (params.phone || '').replace(/\D/g,'')
    if (!tid || !phone) { send(res, 400, { error: 'tenant_id e phone obrigatórios' }); return }
    const row = db.prepare('SELECT fid_config FROM store_config WHERE tenant_id=?').get(tid)
    const cfg = (() => { try { return JSON.parse(row?.fid_config||'{}') } catch { return {} } })()
    const ptsPorReal = parseFloat(cfg.pts_por_real || 0)
    if (!cfg.ativo || !(ptsPorReal > 0)) { send(res, 200, { ativo: false }); return }
    const phone8 = phone.slice(-8)
    const fid = db.prepare("SELECT pts, max_pts FROM fidelidade WHERE tenant_id=? AND substr(replace(replace(phone,'+',''),' ',''), -8) = ?").get(tid, phone8)
    const pts  = fid?.pts || 0
    const meta = fid?.max_pts || parseInt(cfg.meta_pts || 500)
    const faltam   = Math.max(0, meta - pts)
    const elegivel = pts >= meta
    send(res, 200, { ativo: true, pts, meta, faltam, elegivel, recompensa_reais: parseFloat(cfg.recompensa_reais || 0) }); return
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
    validarSessaoAdmin, criarSessaoAdmin, validarSessaoGestor, criarSessaoGestor, criarSessaoGarcom,
    hashPassword, verifyPassword, precisaMigrarHash, checkRateLimit, clientIp,
    loginRateLimited, registrarLoginFalho,
    validarFinanceAccess, fazerBackup, restaurarBackup, enviarBackupTelegram, TABELAS_BACKUP, getTenantId,
    MP_TOKEN, TAXA_PIX, BACKUP_PATH, UPLOADS_DIR,
    EVO_URL, EVO_KEY, EVO_INST, sendWA, sendWAImage, fillVars, sleep, checarAniv, handleIAWebhook, _pausaHumano,
    aplicarBaixaEstoquePedido,
    chatNormalizePhone, chatPhoneMatches, chatStatusLabel, chatOrderPublic, chatThreadPublic, chatMessagePublic,
    chatEnsureThreadFromOrder, chatEnsureThreadFromLead, chatAddMessageFromOrder, chatAddMessageToThread,
    deliveryPausaAtiva, linkCardapioTenant,
    emit }
  try {
    if (await handleRoutes(req, res, _routeCtx)) return
  } catch(e) {
    log('❌', `handleRoutes exception [${req.method} ${upath}]:`, e.message)
    if (!res.writableEnded) send(res, 500, { error: 'Erro interno do servidor', detail: e.message })
    return
  }

  // Rotas especiais — não passam pelo REST engine genérico
  // (inclui rotas dos arquivos routes-*.js + as tratadas diretamente aqui)
  const _specialApis=new Set(['/api/tenant-info','/api/manifest-garcom','/api/tenant-slug','/api/tenant-info-gestor','/api/order-status','/api/addons-esgotados','/api/customer-register','/api/customer-login','/api/customer-orders','/api/tempo-estimado','/api/criar-tenant','/api/backup','/api/restore','/api/admin-login','/api/gestor-login','/api/gestor-logout','/api/admin-logout','/api/ia-humano-assumiu','/api/rastreio-wa','/api/backup-completo-gestor','/api/pix/criar','/api/pix/status','/api/pix/vincular','/api/pix/config','/api/pix/gestor-config','/api/carteira','/api/saques/solicitar','/api/saques/meus','/api/admin/saques','/api/admin/saques/atualizar','/api/admin/mp-config','/api/gestor/mp-config','/api/admin/pix-toggle','/api/cashback/config','/api/cashback/saldo','/api/cashback/usar','/api/cashback/ajustar','/api/stamp/config','/api/stamp/check','/api/stamp/usar','/api/fidelidade/sync','/api/fidelidade/saldo','/api/cupom/validar','/api/cartao/criar','/api/cartao/status','/api/cartao/public-key','/api/garcom-login','/api/entregador-login','/api/entregador/me','/api/entregador/entregas','/api/entregador/disponiveis','/api/entregador/adicionar-entregas','/api/entregador/entregas/ordem','/api/entregador/status','/api/entregador/mensagem','/api/entregador/localizacao','/api/radio/send','/api/radio/garcons','/api/radio/messages','/api/radio/audio/','/api/tenant-segmento','/api/print','/api/printers','/api/print-queue/heartbeat','/api/print-queue/pending','/api/print-queue/status','/api/print-queue/job','/api/print-queue/pdf','/api/historico-pedidos','/api/historico-pedidos/excluir','/api/exportar-relatorio','/api/entregadores/salvar','/api/entregas/dashboard','/api/entregas/atribuir','/api/entregas/status','/api/rotas-entrega/criar','/api/rotas-entrega/status','/api/order-status-history','/api/icones-version','/api/admin/icone-padrao','/api/favoritos','/api/favoritos/toggle'])
  if((upath.startsWith('/api/')&&!_specialApis.has(upath)&&!upath.startsWith('/api/evo')&&!upath.startsWith('/api/radio/audio/')&&!upath.startsWith('/api/store-logo/'))||upath.startsWith('/rest/v1/')){
    try {
      const table=upath.split('/')[upath.startsWith('/rest/v1/')?3:2],body=['POST','PATCH'].includes(req.method)?await readBody(req):{}
      await handleREST(req,res,table,params,body)
    } catch(e) {
      if (!res.writableEnded) send(res, e.message?.includes('excede o limite') ? 413 : 500, { error: e.message || 'Erro interno' })
    }
    return
  }

  if(req.method==='POST'&&upath.startsWith('/storage/v1/object/')){
    // Upload requer x-tenant-id ou sessão admin válida
    const uploadTid = req.headers['x-tenant-id']
    if (!uploadTid && !validarSessaoAdmin(req)) { send(res,401,{error:'Não autorizado'}); return }
    await handleUpload(req,res); return
  }

  if(req.method==='DELETE'&&upath.startsWith('/storage/v1/object/')){
    // Exclusão definitiva do arquivo em disco — requer x-tenant-id ou sessão admin válida
    const delTid = req.headers['x-tenant-id']
    if (!delTid && !validarSessaoAdmin(req)) { send(res,401,{error:'Não autorizado'}); return }
    const fname = path.basename(upath.split('?')[0]).replace(/[^a-zA-Z0-9._-]/g, '_')
    // Segurança: um tenant só pode apagar arquivo com o próprio prefixo (ex: 7_1699999999.mp4)
    if (delTid && !fname.startsWith(`${delTid}_`)) { send(res,403,{error:'Arquivo não pertence a este tenant'}); return }
    try {
      const fpath = path.join(UPLOADS_DIR, fname)
      if (fs.existsSync(fpath)) fs.unlinkSync(fpath)
      log('🗑️', `Upload removido: ${fname}`)
      send(res,200,{ok:true})
    } catch(e) { send(res,500,{error:e.message}) }
    return
  }

  if(req.method==='GET'&&upath==='/api/icones-version'){
    // videoTags: quais "formas de preparo" têm vídeo customizado no lugar
    // do ícone estático — usa a CHAVE DE ARQUIVO (ex.: "grellhar"), porque
    // o admin.html também consome esse mesmo endpoint e casa por essa
    // chave. O cardápio do cliente (cardapio-acougue.js) é quem faz a
    // conversão pro id real do preparo ("grelhar") do lado dele.
    const videoTags = ICONES_VIDEO_TAGS_KEYS.filter(k => fs.existsSync(path.join(ICONES_PADRAO_DIR,'tags',`${k}.mp4`)))
    // photoTags: preparos cujo admin já subiu uma FOTO real (PNG) no lugar do
    // ícone padrão (linha preta simples) — o front usa isso pra não aplicar
    // o filtro brightness(0)+invert(1) (pensado só pro ícone de linha) em
    // cima de uma foto colorida, senão ela vira um quadrado branco.
    const photoTags = ICONES_VIDEO_TAGS_KEYS.filter(k => fs.existsSync(path.join(ICONES_PADRAO_DIR,'tags',`${k}.png`)))
    send(res,200,{version:_iconesVersion,videoTags,photoTags}); return
  }


  if(req.method==='POST'&&upath==='/api/admin/icone-padrao'){
    if (!validarSessaoAdmin(req)) { send(res,401,{error:'Não autorizado'}); return }
    try {
      const body = await readBody(req, MAX_ICONE_VIDEO_BODY_BYTES)
      const arquivo = String(body.arquivo||'')
      if (!ICONES_PADRAO_VALIDOS.has(arquivo)) { send(res,400,{error:'Ícone inválido'}); return }
      const ehVideo = ICONES_VIDEO_VALIDOS.has(arquivo)
      const base64 = String(body.data||'').split(',').pop()
      const buffer = Buffer.from(base64,'base64')
      if (!buffer.length) { send(res,400,{error: ehVideo ? 'Vídeo vazio' : 'Imagem vazia'}); return }
      const limiteBytes = ehVideo ? MAX_ICONE_VIDEO_BYTES : 2*1024*1024
      if (buffer.length > limiteBytes) { send(res,413,{error: ehVideo ? 'Vídeo muito grande (máx 10MB)' : 'Imagem muito grande (máx 2MB)'}); return }
      // Aceita PNG ou JPEG — checa os bytes de verdade do arquivo (não o
      // nome), porque o arquivo sempre é salvo com nome ".png" pra combinar
      // com o resto do sistema (que espera essa extensão em todo lugar),
      // mesmo quando o conteúdo enviado é um JPEG de verdade.
      if (!ehVideo) {
        const ehPng  = buffer.length >= 8 && buffer[0]===0x89 && buffer[1]===0x50 && buffer[2]===0x4E && buffer[3]===0x47
        const ehJpeg = buffer.length >= 3 && buffer[0]===0xFF && buffer[1]===0xD8 && buffer[2]===0xFF
        if (!ehPng && !ehJpeg) { send(res,400,{error:'Envie uma imagem PNG ou JPEG válida'}); return }
      }
      // Grava no volume persistente (ICONES_PADRAO_DIR), não em cardapio/img —
      // essa pasta faz parte do código-fonte e some a cada novo deploy.
      const fpath = path.join(ICONES_PADRAO_DIR,arquivo)
      fs.mkdirSync(path.dirname(fpath), { recursive: true })
      fs.writeFileSync(fpath, buffer)
      _iconesVersion = Date.now()
      log('🖼️', `${ehVideo ? 'Vídeo' : 'Ícone'} padrão atualizado por admin: ${arquivo}`)
      send(res,200,{ok:true,version:_iconesVersion})
    } catch(e) { send(res,e.message?.includes('excede o limite') ? 413 : 500,{error:e.message}) }
    return
  }

  if(req.method==='DELETE'&&upath==='/api/admin/icone-padrao'){
    if (!validarSessaoAdmin(req)) { send(res,401,{error:'Não autorizado'}); return }
    try {
      const body = await readBody(req)
      const arquivo = String(body.arquivo||(req.headers['x-arquivo']||''))
      // Só permite remover vídeos (a remoção de imagem padrão não faz
      // sentido — sempre tem que existir um ícone base pra cada preparo).
      if (!ICONES_VIDEO_VALIDOS.has(arquivo)) { send(res,400,{error:'Arquivo inválido'}); return }
      const fpath = path.join(ICONES_PADRAO_DIR,arquivo)
      if (fs.existsSync(fpath)) fs.unlinkSync(fpath)
      _iconesVersion = Date.now()
      log('🗑️', `Vídeo padrão removido por admin: ${arquivo}`)
      send(res,200,{ok:true,version:_iconesVersion})
    } catch(e) { send(res,500,{error:e.message}) }
    return
  }

  // Serve ícones padrão de açougue: se o admin já customizou, o arquivo
  // persistido em ICONES_PADRAO_DIR tem prioridade; senão cai pro arquivo
  // padrão do código-fonte via rota estática genérica, mais abaixo.
  if(req.method==='GET'&&upath.startsWith('/cardapio/img/')){
    const rel = upath.slice('/cardapio/img/'.length)
    if (ICONES_PADRAO_VALIDOS.has(rel)) {
      const customPath = path.join(ICONES_PADRAO_DIR, rel)
      if (fs.existsSync(customPath)) {
        // O arquivo sempre é salvo com nome ".png" (pra combinar com o resto
        // do sistema), mesmo quando o admin subiu um JPEG de verdade — então
        // não dá pra confiar na extensão do nome pra saber o tipo de
        // verdade. Lê só os primeiros bytes (rápido) pra descobrir se é PNG
        // ou JPEG e mandar o Content-Type certo pro navegador.
        let extReal = path.extname(customPath)
        if (extReal === '.png') {
          try {
            const fd = fs.openSync(customPath, 'r')
            const head = Buffer.alloc(3)
            fs.readSync(fd, head, 0, 3, 0)
            fs.closeSync(fd)
            if (head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF) extReal = '.jpg'
          } catch(e) {}
        }
        serveStatic(req,res,customPath,extReal); return
      }
    }
  }


  if(req.method==='GET'&&(upath.startsWith('/uploads/')||upath.startsWith('/storage/v1/object/public/'))){
    const fname=path.basename(upath),fpath=path.join(UPLOADS_DIR,fname)
    if(fs.existsSync(fpath)){const ext=path.extname(fpath);res.setHeader('Content-Type',MIME[ext]||'application/octet-stream');res.setHeader('Cache-Control','public, max-age=2592000');res.writeHead(200);fs.createReadStream(fpath).pipe(res)}
    else{res.writeHead(404);res.end('Not found')}
    return
  }

  // ── Página pública de captura de leads via link de indicação ──
  // /indicacao/CODIGO → serve indicacao.html (a página lê o código da URL
  // e busca info do indicador via /api/indicacao/info/{codigo})
  if(req.method==='GET'&&upath.startsWith('/indicacao/')){
    const fpath=path.join(__dirname,'indicacao.html')
    if(fs.existsSync(fpath)){serveStatic(req,res,fpath,'.html');return}
  }

  if(req.method==='GET'&&(upath==='/admin'||upath==='/admin/')){
    const fpath=path.join(__dirname,'admin.html')
    if(fs.existsSync(fpath)){serveStatic(req,res,fpath,'.html');return}
  }

  if(req.method==='GET'&&(upath==='/indicador'||upath==='/indicador/')){
    const fpath=path.join(__dirname,'indicador.html')
    if(fs.existsSync(fpath)){serveStatic(req,res,fpath,'.html');return}
  }

  if(req.method==='GET'&&(upath==='/entregador'||upath==='/entregador/')){
    const fpath=path.join(__dirname,'entregador.html')
    if(fs.existsSync(fpath)){serveStatic(req,res,fpath,'.html');return}
  }

  // ── Cardápio público: favicon/preview de link com a cara da loja ──────
  // WhatsApp, Instagram etc. leem as tags og:* e o favicon direto do HTML
  // (não executam JS), então isso só pode ser feito aqui no servidor,
  // antes de mandar o arquivo — trocando os placeholders por dados reais
  // da loja (nome, descrição, logo) com base no slug/tenant do link.
  if (req.method === 'GET' && upath.startsWith('/api/store-logo/')) {
    if (_handleStoreLogo(req, res, upath)) return
  }

  if (req.method === 'GET' && (upath === '/' || upath === '/index.html')) {
    const slugQ = params.get('slug') || ''
    const tenantQ = params.get('tenant') || ''
    let t = null
    if (slugQ) t = db.prepare('SELECT id,nome,slug,segmento FROM tenants WHERE slug=? AND ativo=1').get(slugQ)
    else if (tenantQ) t = db.prepare('SELECT id,nome,slug,segmento FROM tenants WHERE id=? AND ativo=1').get(tenantQ)
    if (t) {
      try {
        const cfg = db.prepare('SELECT store_name,store_descricao,store_logo_url FROM store_config WHERE tenant_id=?').get(t.id)
        const nome = _escHtmlAttr(cfg?.store_name || t.nome || 'Cardápio')
        const descricao = _escHtmlAttr(cfg?.store_descricao || 'Confira o cardápio digital e faça seu pedido online.')
        const baseAtual = t.segmento === 'acougue' ? BUTCHERBOX_BASE_URL : PUBLIC_BASE_URL
        // Se o logo foi salvo como data URL (base64), usa a rota que serve
        // ele como arquivo de verdade — data URI não funciona em og:image.
        // Se já for uma URL normal (http/https), usa direto.
        const logoRaw = cfg?.store_logo_url || ''
        const logo = logoRaw.startsWith('data:')
          ? _escHtmlAttr(logoUrlServer(t.id))
          : (logoRaw ? _escHtmlAttr(logoRaw) : `${baseAtual}/favicon-cardapio.png`)
        const pageUrl = _escHtmlAttr(linkCardapioTenant(t.id))
        let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8')
        html = html.replace(/<!--OG_FAVICON-->[\s\S]*?<!--\/OG_FAVICON-->/, `<link rel="icon" type="image/png" href="${logo}">`)
        html = html.replace(/<!--OG_TITLE-->[\s\S]*?<!--\/OG_TITLE-->/, `<title>${nome}</title>`)
        html = html.replace(/<!--OG_TAGS-->[\s\S]*?<!--\/OG_TAGS-->/, [
          `<meta property="og:type" content="website">`,
          `<meta property="og:title" content="${nome}">`,
          `<meta property="og:description" content="${descricao}">`,
          `<meta property="og:image" content="${logo}">`,
          `<meta property="og:url" content="${pageUrl}">`,
          `<meta name="twitter:card" content="summary">`,
          `<meta name="twitter:title" content="${nome}">`,
          `<meta name="twitter:description" content="${descricao}">`,
          `<meta name="twitter:image" content="${logo}">`
        ].join('\n'))
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.writeHead(200)
        res.end(html)
        return
      } catch (e) { log('⚠️', 'Falha ao injetar preview do cardápio:', e.message) }
    }
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

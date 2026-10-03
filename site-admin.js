// ═══════════════════════════════════════════════════════
// SITE-ADMIN.JS — site institucional (landing page) + contas de teste grátis
// ═══════════════════════════════════════════════════════
// O site fica hospedado separado (arquivos estáticos) e busca tudo daqui:
//   GET  /api/site/conteudo        público — textos, preços, camadas, mídias e se o teste grátis está ligado
//   POST /api/site/teste           público — cria a conta de teste (só quando o teste está ligado no admin)
// Painel admin (exigem sessão de superadmin):
//   GET  /api/admin/site           conteúdo atual (ou o padrão) + mídias enviadas
//   POST /api/admin/site           salva e publica o conteúdo
//   POST /api/admin/site/restaurar volta ao conteúdo padrão
//   POST /api/admin/site/midia     envia imagem ou vídeo (corpo binário)
//   POST /api/admin/site/midia/excluir
//   GET  /api/admin/testes         lista + contagens + configuração
//   POST /api/admin/testes/config  liga/desliga, dias, limite por dia, link do programa
//   POST /api/admin/testes/ativar  transforma o teste em cliente
//   POST /api/admin/testes/excluir apaga a conta de teste (uma, ou todas as expiradas)
//   POST /api/admin/testes/senha    mostra a senha escolhida no cadastro
//   POST /api/admin/testes/mensagem envia agora a mensagem de boas-vindas no WhatsApp
// Depois do cadastro, o cliente recebe uma mensagem no WhatsApp (por padrão 30 minutos
// depois), enviada pelo WhatsApp de Suporte e Vendas do painel admin.
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PADRAO = require('./site-padrao.json')

let D = null // { db, log, marcarDirty, fazerBackup, hashPassword, verifyPassword, clientIp, linkCardapioTenant, uploadsDir, bot }

const BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.APP_URL || process.env.BASE_URL || 'https://estimafood.evocrm.sbs').replace(/\/+$/, '')
const MSG_PADRAO = [
  'Olá, {nome}! Aqui é da EstimaFood.',
  '',
  'Sua conta de teste da *{loja}* está pronta e vale até {validade}.',
  '',
  'Entrar no painel: {link_gestor}',
  'Programa para Windows, que imprime os pedidos sozinho: {link_download}',
  '',
  'Quer ajuda para montar o cardápio? É só responder esta mensagem.'
].join('\n')
const TESTE_PADRAO = { ativo: false, dias: 7, limite_dia: 30, download_url: '', gestor_url: '', msg_ativa: true, msg_minutos: 30, msg_texto: MSG_PADRAO }
const MSG_TENTATIVAS = 5        // quantas vezes tenta enviar antes de marcar como falha
const MSG_NOVA_TENTATIVA = 5    // minutos entre uma tentativa e outra
const MAX_CONTEUDO_BYTES = 600 * 1024
const MAX_IMAGEM_BYTES = 8 * 1024 * 1024
const MAX_VIDEO_BYTES = 40 * 1024 * 1024
const TIPOS_MIDIA = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4'
}

// ==================== Inicialização ====================

function init(deps) {
  if (D) return
  D = deps
  D.db.exec(`
    CREATE TABLE IF NOT EXISTS site_dados (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS testes_gratis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT,
      nome TEXT, restaurante TEXT, telefone TEXT, email TEXT,
      ip TEXT,
      dias INTEGER DEFAULT 7,
      expira_em TEXT,
      status TEXT DEFAULT 'ativo',
      convertido_em TEXT, excluido_em TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_testes_gratis_status ON testes_gratis(status, expira_em);
    CREATE INDEX IF NOT EXISTS idx_testes_gratis_tenant ON testes_gratis(tenant_id);
  `)
  // Colunas acrescentadas depois da primeira versão (o banco pode já ter a tabela)
  const existentes = new Set(D.db.prepare('PRAGMA table_info(testes_gratis)').all().map(c => c.name))
  const novas = {
    senha_cifrada: 'TEXT',       // senha do cadastro, cifrada (ver cifrar/decifrar)
    msg_status: 'TEXT',          // pendente | enviada | falhou | cancelada
    msg_em: 'TEXT',              // quando a mensagem deve sair (UTC)
    msg_enviada_em: 'TEXT',
    msg_tentativas: 'INTEGER DEFAULT 0',
    msg_erro: 'TEXT'
  }
  for (const [col, tipo] of Object.entries(novas)) {
    if (!existentes.has(col)) D.db.exec(`ALTER TABLE testes_gratis ADD COLUMN ${col} ${tipo}`)
  }
  // Confere a cada minuto se há mensagem de boas-vindas na hora de sair
  const relogio = setInterval(() => { processarMensagens().catch(() => {}) }, 60 * 1000)
  if (relogio.unref) relogio.unref()
  setTimeout(() => { processarMensagens().catch(() => {}) }, 20 * 1000)
}

// ==================== Utilidades ====================

// Datas de vencimento são "dia de Brasília" (mesmo formato de tenants.expires_at).
function hojeBR() { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10) }
function somaDias(dataISO, n) {
  const d = new Date(dataISO + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function diasEntre(deISO, ateISO) {
  return Math.round((new Date(ateISO + 'T12:00:00Z') - new Date(deISO + 'T12:00:00Z')) / 86400000)
}

function lerDado(chave) {
  const row = D.db.prepare('SELECT valor, updated_at FROM site_dados WHERE chave=?').get(chave)
  if (!row) return null
  try { return { valor: JSON.parse(row.valor), updated_at: row.updated_at } } catch { return null }
}
function gravarDado(chave, valor) {
  D.db.prepare(`INSERT INTO site_dados (chave, valor, updated_at) VALUES (?,?,datetime('now'))
    ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor, updated_at=excluded.updated_at`).run(chave, JSON.stringify(valor))
  D.marcarDirty()
}

function cfgTeste() {
  const salvo = lerDado('teste')?.valor || {}
  const dias = parseInt(salvo.dias, 10)
  const limite = parseInt(salvo.limite_dia, 10)
  const minutos = parseInt(salvo.msg_minutos, 10)
  return {
    ativo: salvo.ativo === true,
    dias: dias >= 1 && dias <= 60 ? dias : TESTE_PADRAO.dias,
    limite_dia: limite >= 1 && limite <= 500 ? limite : TESTE_PADRAO.limite_dia,
    download_url: urlSegura(salvo.download_url) || '',
    gestor_url: urlSegura(salvo.gestor_url) || '',
    msg_ativa: salvo.msg_ativa !== false,
    msg_minutos: minutos >= 1 && minutos <= 1440 ? minutos : TESTE_PADRAO.msg_minutos,
    msg_texto: typeof salvo.msg_texto === 'string' && salvo.msg_texto.trim() ? salvo.msg_texto.slice(0, 1500) : MSG_PADRAO
  }
}
function downloadUrl(cfg) { return cfg.download_url || `${BASE_URL}/download` }
function gestorUrl(cfg) { return cfg.gestor_url || `${BASE_URL}/login.html` }
function cfgParaPainel(cfg) {
  return { ...cfg, download_padrao: `${BASE_URL}/download`, gestor_padrao: `${BASE_URL}/login.html`, msg_padrao: MSG_PADRAO }
}

// ── Senha do cadastro ───────────────────────────────────
// O admin pediu para ver a senha que o cliente escolheu. Ela fica cifrada no
// banco (AES-256-GCM) com uma chave guardada FORA dele: na variável de ambiente
// TESTE_SENHA_KEY ou, se não houver, num arquivo ao lado da pasta de uploads.
// Assim, uma cópia do banco ou do backup sozinha não revela as senhas.
let _chave = null
function chaveSenha() {
  if (_chave) return _chave
  if (process.env.TESTE_SENHA_KEY) return (_chave = crypto.createHash('sha256').update(process.env.TESTE_SENHA_KEY).digest())
  const arquivo = path.join(path.dirname(D.uploadsDir), '.site-chave')
  try {
    const lido = fs.readFileSync(arquivo, 'utf-8').trim()
    if (/^[0-9a-f]{64}$/.test(lido)) return (_chave = Buffer.from(lido, 'hex'))
  } catch {}
  const nova = crypto.randomBytes(32)
  fs.writeFileSync(arquivo, nova.toString('hex'), { mode: 0o600 })
  return (_chave = nova)
}
function cifrar(texto) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', chaveSenha(), iv)
  const dados = Buffer.concat([c.update(String(texto), 'utf8'), c.final()])
  return `v1:${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${dados.toString('hex')}`
}
function decifrar(valor) {
  const [v, iv, tag, dados] = String(valor || '').split(':')
  if (v !== 'v1' || !iv || !tag || !dados) return null
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', chaveSenha(), Buffer.from(iv, 'hex'))
    d.setAuthTag(Buffer.from(tag, 'hex'))
    return Buffer.concat([d.update(Buffer.from(dados, 'hex')), d.final()]).toString('utf8')
  } catch { return null }
}

// ── Mensagem de boas-vindas no WhatsApp ─────────────────
function textoMensagem(linha, cfg) {
  let cardapio = ''
  try { cardapio = D.linkCardapioTenant(linha.tenant_id) } catch {}
  const valores = {
    nome: String(linha.nome || '').split(' ')[0],
    loja: linha.restaurante || '',
    email: linha.email || '',
    dias: String(linha.dias || cfg.dias),
    validade: String(linha.expira_em || '').split('-').reverse().join('/'),
    link_gestor: gestorUrl(cfg),
    link_download: downloadUrl(cfg),
    link_cardapio: cardapio
  }
  return String(cfg.msg_texto || MSG_PADRAO).replace(/\{(\w+)\}/g, (m, k) => (k in valores ? valores[k] : m))
}

async function enviarMensagem(linha, manual) {
  const db = D.db
  const cfg = cfgTeste()
  if (!D.bot?.sendText) throw new Error('O WhatsApp de Suporte e Vendas não está disponível')
  const r = await D.bot.sendText(linha.telefone, textoMensagem(linha, cfg), 1200)
  if (r && r.ok) {
    db.prepare("UPDATE testes_gratis SET msg_status='enviada', msg_enviada_em=datetime('now'), msg_erro=NULL WHERE id=?").run(linha.id)
    D.log('🧪', `Mensagem de boas-vindas enviada: ${linha.restaurante} (${linha.telefone})`)
    return { ok: true }
  }
  const erro = String((r && (r.error || r.data?.message)) || 'o WhatsApp de Suporte e Vendas não está conectado ou recusou o número').slice(0, 300)
  const tentativas = (linha.msg_tentativas || 0) + 1
  if (manual) {
    db.prepare('UPDATE testes_gratis SET msg_erro=? WHERE id=?').run(erro, linha.id)
  } else if (tentativas >= MSG_TENTATIVAS) {
    db.prepare("UPDATE testes_gratis SET msg_status='falhou', msg_tentativas=?, msg_erro=? WHERE id=?").run(tentativas, erro, linha.id)
    D.log('⚠️', `Mensagem de boas-vindas desistiu após ${tentativas} tentativas: ${linha.restaurante} — ${erro}`)
  } else {
    db.prepare(`UPDATE testes_gratis SET msg_tentativas=?, msg_erro=?, msg_em=datetime('now','+${MSG_NOVA_TENTATIVA} minutes') WHERE id=?`).run(tentativas, erro, linha.id)
  }
  return { ok: false, error: erro }
}

let _enviando = false
async function processarMensagens() {
  if (_enviando || !D) return
  _enviando = true
  try {
    const cfg = cfgTeste()
    const fila = D.db.prepare(`
      SELECT * FROM testes_gratis
      WHERE msg_status='pendente' AND msg_em <= datetime('now') AND status <> 'excluido'
      ORDER BY msg_em LIMIT 10
    `).all()
    for (const linha of fila) {
      if (!cfg.msg_ativa) { D.db.prepare("UPDATE testes_gratis SET msg_status='cancelada' WHERE id=?").run(linha.id); continue }
      try { await enviarMensagem(linha, false) } catch (e) {
        D.db.prepare('UPDATE testes_gratis SET msg_erro=? WHERE id=?').run(String(e.message).slice(0, 300), linha.id)
      }
    }
    if (fila.length) D.marcarDirty()
  } finally { _enviando = false }
}

function urlSegura(u) {
  const s = String(u || '').trim()
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s.slice(0, 500) : ''
}

// O conteúdo é texto puro e listas: o site monta o HTML e escapa tudo. Aqui só
// se limita tamanho/profundidade para o banco não guardar lixo.
function limpar(v, nivel = 0) {
  if (nivel > 8) return null
  if (typeof v === 'string') return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 6000)
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'boolean' || v === null) return v
  if (Array.isArray(v)) return v.slice(0, 80).map(x => limpar(x, nivel + 1))
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).slice(0, 80)) {
      if (/^[a-zA-Z0-9_-]{1,40}$/.test(k)) out[k] = limpar(v[k], nivel + 1)
    }
    return out
  }
  return null
}

function validarConteudo(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return 'Conteúdo inválido'
  if (!Array.isArray(c.camadas) || !c.camadas.length) return 'O site precisa de pelo menos uma camada'
  const ids = new Set()
  for (const cam of c.camadas) {
    if (!cam || typeof cam !== 'object') return 'Camada inválida'
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(String(cam.id || ''))) return 'Camada sem identificação'
    if (ids.has(cam.id)) return 'Há duas camadas com a mesma identificação'
    ids.add(cam.id)
    if (!/^[a-z0-9-]{1,30}$/.test(String(cam.tipo || ''))) return 'Camada sem tipo'
    if (!cam.dados || typeof cam.dados !== 'object') return 'Camada sem conteúdo'
  }
  return null
}

function listarMidias() {
  try {
    return fs.readdirSync(D.uploadsDir)
      .filter(f => /^site-[a-z0-9-]+\.(jpg|png|webp|gif|mp4)$/i.test(f))
      .map(f => {
        const st = fs.statSync(path.join(D.uploadsDir, f))
        return { nome: f, url: `/uploads/${f}`, tamanho: st.size, tipo: /\.mp4$/i.test(f) ? 'video' : 'imagem', data: st.mtime.toISOString() }
      })
      .sort((a, b) => b.data.localeCompare(a.data))
  } catch { return [] }
}

function lerCorpoBinario(req, limite) {
  return new Promise((ok, err) => {
    const partes = []
    let total = 0, abortado = false
    req.on('data', c => {
      if (abortado) return
      total += c.length
      if (total > limite) { abortado = true; err(Object.assign(new Error('Arquivo grande demais'), { status: 413 })); req.destroy(); return }
      partes.push(c)
    })
    req.on('end', () => { if (!abortado) ok(Buffer.concat(partes)) })
    req.on('error', e => { if (!abortado) err(e) })
  })
}

function slugDe(nome) {
  const base = String(nome || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return base || 'loja'
}

// ==================== Contas de teste ====================

function criarContaTeste({ nome, restaurante, telefone, email, senha, ip, dias, cfg }) {
  const db = D.db
  const hoje = hojeBR()
  const expira = somaDias(hoje, dias)
  const base = slugDe(restaurante)
  let slug = base, n = 2
  while (db.prepare('SELECT id FROM tenants WHERE slug=?').get(slug)) slug = `${base}-${n++}`
  const fone11 = telefone.length > 11 && telefone.startsWith('55') ? telefone.slice(2) : telefone
  const foneCobranca = (fone11.length === 10 || fone11.length === 11) ? fone11 : null

  const criar = db.transaction(() => {
    db.prepare('INSERT INTO tenants (nome,plano,slug,segmento,expires_at,telefone_cobranca) VALUES (?,?,?,?,?,?)')
      .run(restaurante, 'premium', slug, 'restaurante', expira, foneCobranca)
    const t = db.prepare('SELECT id FROM tenants WHERE slug=?').get(slug)
    db.prepare('INSERT OR IGNORE INTO store_config (tenant_id) VALUES (?)').run(t.id)
    // Mesmo acerto do cadastro pelo admin: o 1º pedido da loja começa em #1.
    const maxOrderId = db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM orders').get()?.m || 0
    db.prepare('UPDATE store_config SET order_num_offset=?, store_name=? WHERE tenant_id=?').run(maxOrderId, restaurante, t.id)
    db.prepare('INSERT INTO sys_users (nome,email,senha_hash,role,tenant_id) VALUES (?,?,?,?,?)')
      .run(nome, email, D.hashPassword(senha), 'gestor', t.id)
    const cat = db.prepare("INSERT INTO categories (tenant_id,name,label,type,emoji,sort_order,ativo) VALUES (?,?,?,?,?,?,1)")
    ;[['entradas', 'Entradas', '🥗'], ['pratos', 'Pratos', '🍽️'], ['bebidas', 'Bebidas', '🥤'], ['sobremesas', 'Sobremesas', '🍰']]
      .forEach(([name, label, emoji], i) => cat.run(t.id, name, label, 'Itens principais', emoji, i + 1))
    db.prepare(`INSERT INTO testes_gratis (tenant_id,nome,restaurante,telefone,email,ip,dias,expira_em,senha_cifrada,msg_status,msg_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,${cfg.msg_ativa ? `datetime('now','+${cfg.msg_minutos} minutes')` : 'NULL'})`)
      .run(t.id, nome, restaurante, telefone, email, ip, dias, expira, cifrar(senha), cfg.msg_ativa ? 'pendente' : null)
    return t.id
  })
  const tenantId = criar()
  D.marcarDirty()
  return { tenantId, slug, expira }
}

// Ajusta o que mudou por fora desta tela: loja apagada em "Clientes" ou teste
// que pagou a mensalidade (o vencimento passou do fim do teste).
function sincronizarTestes() {
  const db = D.db
  const linhas = db.prepare(`
    SELECT g.id, g.expira_em, t.id AS t_id, t.expires_at AS t_expira
    FROM testes_gratis g LEFT JOIN tenants t ON t.id = g.tenant_id
    WHERE g.status = 'ativo'
  `).all()
  for (const l of linhas) {
    if (!l.t_id) db.prepare("UPDATE testes_gratis SET status='excluido', excluido_em=datetime('now') WHERE id=?").run(l.id)
    else if (!l.t_expira || l.t_expira > l.expira_em) db.prepare("UPDATE testes_gratis SET status='convertido', convertido_em=datetime('now') WHERE id=?").run(l.id)
  }
}

function listarTestes() {
  sincronizarTestes()
  const hoje = hojeBR()
  const linhas = D.db.prepare(`
    SELECT g.id, g.tenant_id, g.nome, g.restaurante, g.telefone, g.email, g.dias, g.expira_em, g.status,
           g.convertido_em, g.created_at,
           g.msg_status, g.msg_em, g.msg_enviada_em, g.msg_erro,
           (g.senha_cifrada IS NOT NULL) AS tem_senha,
           t.nome AS loja, t.slug, t.ativo AS loja_ativa, t.expires_at AS loja_expira,
           (SELECT COUNT(*) FROM orders o WHERE o.tenant_id = g.tenant_id) AS pedidos,
           (SELECT COUNT(*) FROM menu_items m WHERE m.tenant_id = g.tenant_id) AS produtos,
           (SELECT MAX(u.ultimo_acesso) FROM sys_users u WHERE u.tenant_id = g.tenant_id) AS ultimo_acesso
    FROM testes_gratis g LEFT JOIN tenants t ON t.id = g.tenant_id
    WHERE g.status IN ('ativo','convertido')
    ORDER BY g.id DESC LIMIT 500
  `).all()
  const testes = linhas.map(l => {
    const situacao = l.status === 'convertido' ? 'cliente' : (l.expira_em >= hoje ? 'ativo' : 'expirado')
    return { ...l, situacao, dias_restantes: l.status === 'ativo' ? diasEntre(hoje, l.expira_em) : null }
  })
  const ativos = testes.filter(t => t.situacao === 'ativo')
  const totalCriados = D.db.prepare('SELECT COUNT(*) AS c FROM testes_gratis').get().c
  const convertidos = D.db.prepare("SELECT COUNT(*) AS c FROM testes_gratis WHERE status='convertido'").get().c
  return {
    testes,
    resumo: {
      ativos: ativos.length,
      vencendo: ativos.filter(t => t.dias_restantes <= 2).length,
      expirados: testes.filter(t => t.situacao === 'expirado').length,
      convertidos,
      total: totalCriados
    }
  }
}

function apagarContaTeste(linha) {
  const db = D.db
  db.transaction(() => {
    if (linha.tenant_id) {
      try { db.prepare('DELETE FROM gestor_sessions WHERE tenant_id=?').run(linha.tenant_id) } catch {}
      db.prepare('DELETE FROM tenants WHERE id=?').run(linha.tenant_id)
    }
    db.prepare(`UPDATE testes_gratis SET status='excluido', excluido_em=datetime('now'), senha_cifrada=NULL,
      msg_status=CASE WHEN msg_status='pendente' THEN 'cancelada' ELSE msg_status END WHERE id=?`).run(linha.id)
  })()
}

async function avisarAdmin(texto) {
  try {
    const row = D.db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()
    const fone = String((row?.ia_config ? JSON.parse(row.ia_config) : {}).admin_phone || '').replace(/\D/g, '')
    if (fone && D.bot?.sendText) await D.bot.sendText(fone, texto)
  } catch (e) { D.log('⚠️', 'Aviso de teste grátis para o admin falhou:', e.message) }
}

// ==================== Rotas ====================

async function api(req, res, { upath, send, readBody, validarSessaoAdmin }) {
  const metodo = req.method

  // ── Público: conteúdo do site ──────────────────────────
  if (metodo === 'GET' && upath === '/api/site/conteudo') {
    const salvo = lerDado('conteudo')
    const teste = cfgTeste()
    res.setHeader('Cache-Control', 'no-cache')
    send(res, 200, {
      ok: true,
      conteudo: salvo?.valor || PADRAO,
      personalizado: !!salvo,
      atualizado_em: salvo?.updated_at || null,
      teste: { ativo: teste.ativo, dias: teste.dias },
      download_url: downloadUrl(teste)
    })
    return true
  }

  // ── Público: criar conta de teste ──────────────────────
  if (metodo === 'POST' && upath === '/api/site/teste') {
    const cfg = cfgTeste()
    if (!cfg.ativo) { send(res, 403, { error: 'O teste grátis não está disponível no momento. Fale com a gente pelo WhatsApp.' }); return true }
    let body
    try { body = await readBody(req, 20 * 1024) } catch { send(res, 400, { error: 'Dados inválidos' }); return true }
    if (String(body.website || '').trim()) { send(res, 400, { error: 'Não foi possível criar a conta.' }); return true } // campo-isca para robôs

    const nome = String(body.nome || '').trim().replace(/\s+/g, ' ').slice(0, 80)
    const restaurante = String(body.restaurante || '').trim().replace(/\s+/g, ' ').slice(0, 80)
    let telefone = String(body.telefone || '').replace(/\D/g, '').slice(0, 13)
    if (telefone.length > 11 && telefone.startsWith('55')) telefone = telefone.slice(2)
    const email = String(body.email || '').trim().toLowerCase().slice(0, 120)
    const senha = String(body.senha || '')
    if (nome.length < 2) { send(res, 400, { error: 'Informe o seu nome', campo: 'nome' }); return true }
    if (restaurante.length < 2) { send(res, 400, { error: 'Informe o nome do restaurante', campo: 'restaurante' }); return true }
    if (!/^[1-9][1-9]\d{8,9}$/.test(telefone)) { send(res, 400, { error: 'Informe o WhatsApp com DDD, por exemplo (88) 99999-0000', campo: 'telefone' }); return true }
    if (!email) { send(res, 400, { error: 'Informe o seu e-mail', campo: 'email' }); return true }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { send(res, 400, { error: 'Informe um e-mail válido', campo: 'email' }); return true }
    if (senha.length < 6 || senha.length > 72) { send(res, 400, { error: 'A senha precisa ter pelo menos 6 caracteres', campo: 'senha' }); return true }

    const db = D.db
    const ip = D.clientIp(req)
    try {
      if (db.prepare('SELECT id FROM sys_users WHERE email=?').get(email)) {
        send(res, 409, { error: 'Este e-mail já tem uma conta. Entre no painel com ele.', campo: 'email', login_url: gestorUrl(cfg) }); return true
      }
      if (db.prepare("SELECT id FROM testes_gratis WHERE telefone=? AND status='ativo'").get(telefone)) {
        send(res, 409, { error: 'Já existe um teste em andamento com este WhatsApp.', campo: 'telefone', login_url: gestorUrl(cfg) }); return true
      }
      const doIp = db.prepare("SELECT COUNT(*) AS c FROM testes_gratis WHERE ip=? AND created_at >= datetime('now','-1 day')").get(ip).c
      if (doIp >= 3) { send(res, 429, { error: 'Muitas contas criadas a partir desta conexão hoje. Fale com a gente pelo WhatsApp.' }); return true }
      const doDia = db.prepare("SELECT COUNT(*) AS c FROM testes_gratis WHERE created_at >= datetime('now','-1 day')").get().c
      if (doDia >= cfg.limite_dia) { send(res, 429, { error: 'As vagas de teste de hoje acabaram. Fale com a gente pelo WhatsApp para liberar a sua.' }); return true }

      const conta = criarContaTeste({ nome, restaurante, telefone, email, senha, ip, dias: cfg.dias, cfg })
      D.log('🧪', `Teste grátis criado: ${restaurante} (${email}) até ${conta.expira}`)
      try { setTimeout(() => D.fazerBackup(true), 2000) } catch {}
      setImmediate(() => avisarAdmin([
        '*🧪 NOVO TESTE GRÁTIS*', '',
        `*Loja:* ${restaurante}`,
        `*Responsável:* ${nome}`,
        `*WhatsApp:* ${telefone}`,
        `*E-mail:* ${email}`,
        `*Válido até:* ${conta.expira.split('-').reverse().join('/')}`, '',
        '_Conta criada pelo site_'
      ].join('\n')))
      let cardapio = ''
      try { cardapio = D.linkCardapioTenant(conta.tenantId) } catch {}
      send(res, 201, {
        ok: true, loja: restaurante, email, dias: cfg.dias, expira_em: conta.expira,
        login_url: gestorUrl(cfg),
        cardapio_url: cardapio || `${BASE_URL}/l/${conta.slug}`,
        download_url: downloadUrl(cfg)
      })
    } catch (e) {
      D.log('❌', 'Criar teste grátis falhou:', e.message)
      send(res, 500, { error: 'Não foi possível criar a conta agora. Tente de novo em instantes.' })
    }
    return true
  }

  // ── Daqui para baixo: só superadmin ────────────────────
  if (!upath.startsWith('/api/admin/site') && !upath.startsWith('/api/admin/testes')) return false
  if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }

  if (metodo === 'GET' && upath === '/api/admin/site') {
    const salvo = lerDado('conteudo')
    send(res, 200, {
      conteudo: salvo?.valor || PADRAO,
      personalizado: !!salvo,
      atualizado_em: salvo?.updated_at || null,
      padrao: PADRAO,
      midias: listarMidias(),
      base_url: BASE_URL
    })
    return true
  }

  if (metodo === 'POST' && upath === '/api/admin/site') {
    let body
    try { body = await readBody(req, MAX_CONTEUDO_BYTES) } catch { send(res, 413, { error: 'Conteúdo grande demais' }); return true }
    const conteudo = limpar(body.conteudo)
    const erro = validarConteudo(conteudo)
    if (erro) { send(res, 400, { error: erro }); return true }
    gravarDado('conteudo', conteudo)
    D.log('🌐', `Site publicado (${conteudo.camadas.length} camadas)`)
    send(res, 200, { ok: true, atualizado_em: lerDado('conteudo')?.updated_at || null })
    return true
  }

  if (metodo === 'POST' && upath === '/api/admin/site/restaurar') {
    D.db.prepare("DELETE FROM site_dados WHERE chave='conteudo'").run()
    D.marcarDirty()
    D.log('🌐', 'Site voltou ao conteúdo padrão')
    send(res, 200, { ok: true, conteudo: PADRAO })
    return true
  }

  if (metodo === 'POST' && upath === '/api/admin/site/midia') {
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    const ext = TIPOS_MIDIA[mime]
    if (!ext) { send(res, 400, { error: 'Formato não aceito. Use JPG, PNG, WebP, GIF ou vídeo MP4.' }); return true }
    const limite = ext === '.mp4' ? MAX_VIDEO_BYTES : MAX_IMAGEM_BYTES
    try {
      const buf = await lerCorpoBinario(req, limite)
      if (!buf.length) { send(res, 400, { error: 'Arquivo vazio' }); return true }
      const nome = `site-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}${ext}`
      fs.writeFileSync(path.join(D.uploadsDir, nome), buf)
      D.log('🌐', `Mídia do site enviada: ${nome} (${Math.round(buf.length / 1024)} KB)`)
      send(res, 200, { ok: true, nome, url: `/uploads/${nome}`, tipo: ext === '.mp4' ? 'video' : 'imagem', tamanho: buf.length })
    } catch (e) {
      const mb = Math.round(limite / 1024 / 1024)
      send(res, e.status || 500, { error: e.status === 413 ? `Arquivo grande demais (máximo ${mb} MB)` : 'Não foi possível salvar o arquivo' })
    }
    return true
  }

  if (metodo === 'POST' && upath === '/api/admin/site/midia/excluir') {
    const body = await readBody(req)
    const nome = path.basename(String(body.nome || ''))
    if (!/^site-[a-z0-9-]+\.(jpg|png|webp|gif|mp4)$/i.test(nome)) { send(res, 400, { error: 'Arquivo inválido' }); return true }
    try { fs.unlinkSync(path.join(D.uploadsDir, nome)) } catch {}
    send(res, 200, { ok: true, midias: listarMidias() })
    return true
  }

  if (metodo === 'GET' && upath === '/api/admin/testes') {
    const cfg = cfgTeste()
    send(res, 200, { ...listarTestes(), config: cfgParaPainel(cfg), hoje: hojeBR() })
    return true
  }

  if (metodo === 'POST' && upath === '/api/admin/testes/config') {
    const body = await readBody(req)
    const atual = cfgTeste()
    const novo = { ...atual }
    if (body.ativo !== undefined) novo.ativo = body.ativo === true
    if (body.dias !== undefined) {
      const d = parseInt(body.dias, 10)
      if (!(d >= 1 && d <= 60)) { send(res, 400, { error: 'A duração do teste deve ficar entre 1 e 60 dias' }); return true }
      novo.dias = d
    }
    if (body.limite_dia !== undefined) {
      const l = parseInt(body.limite_dia, 10)
      if (!(l >= 1 && l <= 500)) { send(res, 400, { error: 'O limite por dia deve ficar entre 1 e 500' }); return true }
      novo.limite_dia = l
    }
    if (body.download_url !== undefined) {
      const u = String(body.download_url || '').trim()
      if (u && !urlSegura(u)) { send(res, 400, { error: 'O link do programa precisa começar com http:// ou https://' }); return true }
      novo.download_url = urlSegura(u)
    }
    if (body.gestor_url !== undefined) {
      const u = String(body.gestor_url || '').trim()
      if (u && !urlSegura(u)) { send(res, 400, { error: 'O link do gestor precisa começar com http:// ou https://' }); return true }
      novo.gestor_url = urlSegura(u)
    }
    if (body.msg_ativa !== undefined) novo.msg_ativa = body.msg_ativa === true
    if (body.msg_minutos !== undefined) {
      const m = parseInt(body.msg_minutos, 10)
      if (!(m >= 1 && m <= 1440)) { send(res, 400, { error: 'O tempo até a mensagem deve ficar entre 1 e 1440 minutos' }); return true }
      novo.msg_minutos = m
    }
    if (body.msg_texto !== undefined) {
      const txt = String(body.msg_texto || '').replace(/\r/g, '').trim()
      if (txt.length > 1500) { send(res, 400, { error: 'A mensagem pode ter até 1500 caracteres' }); return true }
      novo.msg_texto = txt || MSG_PADRAO
    }
    gravarDado('teste', novo)
    D.log('🧪', `Teste grátis no site: ${novo.ativo ? 'LIGADO' : 'desligado'} (${novo.dias} dias, até ${novo.limite_dia}/dia)`)
    send(res, 200, { ok: true, config: cfgParaPainel(cfgTeste()) })
    return true
  }

  if (metodo === 'POST' && upath === '/api/admin/testes/senha') {
    const body = await readBody(req)
    const linha = D.db.prepare('SELECT * FROM testes_gratis WHERE id=?').get(parseInt(body.id, 10) || 0)
    if (!linha || linha.status === 'excluido') { send(res, 404, { error: 'Teste não encontrado' }); return true }
    const senha = linha.senha_cifrada ? decifrar(linha.senha_cifrada) : null
    if (!senha) { send(res, 200, { ok: true, senha: null, motivo: 'Esta conta foi criada antes de a senha passar a ser guardada.' }); return true }
    // Se o cliente trocou a senha no gestor, a do cadastro não abre mais a conta: avisa.
    let vale = true
    try {
      const u = D.db.prepare('SELECT senha_hash FROM sys_users WHERE tenant_id=? AND email=?').get(linha.tenant_id, linha.email)
      vale = !!u && !!D.verifyPassword(senha, u.senha_hash)
    } catch {}
    D.log('🧪', `Admin consultou a senha do teste: ${linha.restaurante}`)
    send(res, 200, { ok: true, senha, vale })
    return true
  }

  if (metodo === 'POST' && upath === '/api/admin/testes/mensagem') {
    const body = await readBody(req)
    const linha = D.db.prepare('SELECT * FROM testes_gratis WHERE id=?').get(parseInt(body.id, 10) || 0)
    if (!linha || linha.status === 'excluido') { send(res, 404, { error: 'Teste não encontrado' }); return true }
    try {
      const r = await enviarMensagem(linha, true)
      D.marcarDirty()
      if (!r.ok) { send(res, 502, { error: 'A mensagem não saiu: ' + r.error }); return true }
      send(res, 200, { ok: true, ...listarTestes() })
    } catch (e) { send(res, 502, { error: e.message }) }
    return true
  }

  if (metodo === 'POST' && upath === '/api/admin/testes/ativar') {
    const body = await readBody(req)
    const linha = D.db.prepare('SELECT * FROM testes_gratis WHERE id=?').get(parseInt(body.id, 10) || 0)
    if (!linha || linha.status !== 'ativo') { send(res, 404, { error: 'Teste não encontrado' }); return true }
    const tenant = D.db.prepare('SELECT id FROM tenants WHERE id=?').get(linha.tenant_id)
    if (!tenant) { send(res, 404, { error: 'A loja deste teste não existe mais' }); return true }
    const validadeRaw = String(body.expires_at || '').trim()
    const validade = /^\d{4}-\d{2}-\d{2}$/.test(validadeRaw) ? validadeRaw : somaDias(hojeBR(), 30)
    if (validade < hojeBR()) { send(res, 400, { error: 'A validade precisa ser uma data de hoje em diante' }); return true }
    const temValor = body.valor_mensalidade !== undefined && body.valor_mensalidade !== null && body.valor_mensalidade !== ''
    const valor = temValor ? parseFloat(String(body.valor_mensalidade).replace(',', '.')) : null
    if (temValor && !(valor >= 0)) { send(res, 400, { error: 'Mensalidade inválida' }); return true }
    D.db.transaction(() => {
      D.db.prepare("UPDATE tenants SET ativo=1, expires_at=?, valor_mensalidade=COALESCE(?, valor_mensalidade), updated_at=datetime('now') WHERE id=?")
        .run(validade, valor, linha.tenant_id)
      D.db.prepare("UPDATE testes_gratis SET status='convertido', convertido_em=datetime('now') WHERE id=?").run(linha.id)
    })()
    D.marcarDirty()
    D.log('🧪', `Teste virou cliente: ${linha.restaurante} (validade ${validade})`)
    send(res, 200, { ok: true, ...listarTestes() })
    return true
  }

  if (metodo === 'POST' && upath === '/api/admin/testes/excluir') {
    const body = await readBody(req)
    const hoje = hojeBR()
    let alvos = []
    if (body.expirados === true) {
      sincronizarTestes()
      alvos = D.db.prepare("SELECT * FROM testes_gratis WHERE status='ativo' AND expira_em < ?").all(hoje)
    } else {
      const linha = D.db.prepare('SELECT * FROM testes_gratis WHERE id=?').get(parseInt(body.id, 10) || 0)
      // Só apaga loja que ainda é teste: quem já virou cliente sai pela tela de Clientes.
      if (!linha || linha.status !== 'ativo') { send(res, 404, { error: 'Teste não encontrado' }); return true }
      alvos = [linha]
    }
    for (const linha of alvos) apagarContaTeste(linha)
    if (alvos.length) {
      D.marcarDirty()
      D.log('🧪', `Teste(s) excluído(s): ${alvos.map(a => a.restaurante).join(', ')}`)
    }
    send(res, 200, { ok: true, excluidos: alvos.length, ...listarTestes() })
    return true
  }

  send(res, 404, { error: 'Rota não encontrada' })
  return true
}

module.exports = { init, api, processarMensagens }

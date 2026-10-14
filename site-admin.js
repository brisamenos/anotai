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
const dns = require('dns')

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
// Acompanhamento do teste: mensagens ao longo dos dias, pelo mesmo WhatsApp de Suporte e Vendas
const SEQ_PADRAO = {
  dia1: [
    'Oi, {nome}! Já montou o cardápio da *{loja}*?',
    '',
    'Dica: no painel, em *Gestor de cardápio*, clique em *Criar por IA* e envie fotos do seu cardápio. A IA cria os produtos, os preços e os adicionais em poucos minutos.',
    '',
    'Entrar no painel: {link_gestor}',
    '',
    'Se preferir, responda esta mensagem que a gente ajuda a montar.'
  ].join('\n'),
  dia3: [
    '{nome}, que tal ver um pedido chegando?',
    '',
    'Abra o seu cardápio, faça um pedido de teste e acompanhe ele aparecendo no painel e saindo na impressora.',
    '',
    'Seu cardápio: {link_cardapio}',
    '',
    'Qualquer dúvida, é só responder aqui.'
  ].join('\n'),
  vespera: [
    '{nome}, o teste da *{loja}* termina amanhã ({validade}).',
    '',
    'Para continuar sem perder nada do que você montou, garanta o primeiro mês por *R$ {preco}*: responda esta mensagem ou pague em *Meu plano*, dentro do painel.',
    '',
    '{link_gestor}'
  ].join('\n'),
  expirou: [
    '{nome}, o teste da *{loja}* terminou, mas o seu cardápio e as configurações continuam guardados.',
    '',
    'Quer continuar? Responda esta mensagem que a gente libera a sua loja.'
  ].join('\n')
}
const SEQ_ETAPAS = ['dia1', 'dia3', 'vespera', 'expirou']
const META_PIXEL_PADRAO = '3403468509829400' // pixel "estima" (conta de anúncios Solução Brisanet)
const META_PIXEL_ANTIGO = '1075636798774814' // pixel usado antes; quem salvou com ele passa a usar o novo
const META_GRAPH = process.env.META_GRAPH_VERSION || 'v23.0'
const TESTE_PADRAO = { ativo: false, dias: 7, limite_dia: 30, download_url: '', gestor_url: '', msg_ativa: true, msg_minutos: 2, msg_texto: MSG_PADRAO,
  seq_ativa: true, seq: SEQ_PADRAO, meta_pixel: META_PIXEL_PADRAO, meta_token: '', meta_teste: '', ia_teste: true, compra_ativa: true }
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
    msg_erro: 'TEXT',
    // acompanhamento do teste
    seq_enviados: "TEXT DEFAULT ''", // etapas já enviadas, separadas por vírgula
    seq_ultimo_em: 'TEXT',           // última mensagem enviada (boas-vindas ou etapa)
    seq_tentativa_em: 'TEXT',
    seq_erro: 'TEXT',
    // Meta (API de Conversões)
    fbp: 'TEXT', fbc: 'TEXT', ua: 'TEXT', origem_url: 'TEXT', ev_id: 'TEXT',
    meta_compra_em: 'TEXT', meta_compra_erro: 'TEXT',
    // atendente com IA (pedido por voz/texto no WhatsApp) liberada só durante o teste
    ia_teste: 'INTEGER DEFAULT 0'
  }
  for (const [col, tipo] of Object.entries(novas)) {
    if (!existentes.has(col)) D.db.exec(`ALTER TABLE testes_gratis ADD COLUMN ${col} ${tipo}`)
  }
  // Visitas do site de vendas: uma linha por pessoa (aparelho) por dia, sem dado pessoal
  D.db.exec(`
    CREATE TABLE IF NOT EXISTS site_visitas (
      dia TEXT NOT NULL,
      visitante TEXT NOT NULL,
      origem TEXT,
      paginas INTEGER DEFAULT 1,
      whats INTEGER DEFAULT 0,
      celular INTEGER DEFAULT 0,
      criado_em TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (dia, visitante)
    );
    CREATE INDEX IF NOT EXISTS idx_site_visitas_dia ON site_visitas(dia);
    CREATE TABLE IF NOT EXISTS site_compras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chave TEXT NOT NULL,
      nome TEXT, restaurante TEXT, telefone TEXT, email TEXT, senha_cifrada TEXT,
      valor REAL, metodo TEXT,
      status TEXT DEFAULT 'pendente',
      status_detalhe TEXT, erro TEXT,
      mp_payment_id TEXT, mp_ref TEXT, bandeira TEXT,
      qr_code TEXT, qr_code_base64 TEXT, pix_expira TEXT,
      tenant_id TEXT, expira_em TEXT,
      ip TEXT, ua TEXT, fbp TEXT, fbc TEXT, origem_url TEXT, ev_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      conferido_em TEXT, aprovado_em TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_site_compras_mp ON site_compras(mp_payment_id);
  `)
  try { D.db.prepare("DELETE FROM site_visitas WHERE dia < ?").run(somaDias(hojeBR(), -400)) } catch {}
  // Confere a cada minuto se há mensagem de boas-vindas na hora de sair
  const relogio = setInterval(() => { processarMensagens().catch(() => {}) }, 60 * 1000)
  if (relogio.unref) relogio.unref()
  setTimeout(() => { processarMensagens().catch(() => {}) }, 20 * 1000)
}

// ==================== Acompanhamento do teste ====================
// Uma mensagem por vez, só entre 9h e 20h de Brasília, com pelo menos 12 horas
// desde a última mensagem para a mesma pessoa. Quem já virou cliente ou teve o
// teste apagado não recebe mais nada.
function precoSite() {
  try { return String(conteudoAtual().conteudo?.precos?.atual || PADRAO.precos?.atual || '') } catch { return '' }
}
function etapaDevida(l, hoje) {
  const feitas = new Set(String(l.seq_enviados || '').split(',').filter(Boolean))
  const horas = (Date.now() - new Date(String(l.created_at).replace(' ', 'T') + 'Z').getTime()) / 3600000
  const vespera = somaDias(l.expira_em, -1)
  if (l.expira_em < hoje) {
    // terminou: só o recado de fim, e só nos 2 primeiros dias depois do prazo
    return !feitas.has('expirou') && diasEntre(l.expira_em, hoje) <= 2 ? 'expirou' : null
  }
  if (hoje >= vespera && !feitas.has('vespera')) return 'vespera'
  if (horas >= 72 && !feitas.has('dia3') && hoje < vespera) return 'dia3'
  if (horas >= 24 && !feitas.has('dia1') && hoje < vespera) return 'dia1'
  return null
}
async function processarAcompanhamento(cfg) {
  if (!cfg.seq_ativa || !D.bot?.sendText) return
  const horaBR = new Date(Date.now() - 3 * 3600 * 1000).getUTCHours()
  if (horaBR < 9 || horaBR >= 20) return
  sincronizarTestes()
  const hoje = hojeBR()
  const linhas = D.db.prepare(`
    SELECT * FROM testes_gratis
    WHERE status = 'ativo' AND COALESCE(msg_status,'') <> 'pendente'
      AND (seq_ultimo_em IS NULL OR seq_ultimo_em <= datetime('now','-12 hours'))
      AND (seq_tentativa_em IS NULL OR seq_tentativa_em <= datetime('now','-60 minutes'))
    ORDER BY id LIMIT 200
  `).all()
  let enviadas = 0
  for (const l of linhas) {
    if (enviadas >= 5) break // poucas por minuto, para o WhatsApp não estranhar
    const etapa = etapaDevida(l, hoje)
    if (!etapa) continue
    D.db.prepare("UPDATE testes_gratis SET seq_tentativa_em=datetime('now') WHERE id=?").run(l.id)
    try {
      const r = await D.bot.sendText(l.telefone, textoMensagem(l, cfg, cfg.seq[etapa]), 1200)
      if (r && r.ok) {
        // a etapa enviada já cobre as anteriores (quem recebeu a do 3º dia não
        // recebe depois a do 1º dia fora de ordem)
        const ordem = ['dia1', 'dia3', 'vespera', 'expirou']
        const feitas = String(l.seq_enviados || '').split(',').filter(Boolean)
        for (const e of ordem.slice(0, ordem.indexOf(etapa) + 1)) if (!feitas.includes(e)) feitas.push(e)
        D.db.prepare("UPDATE testes_gratis SET seq_enviados=?, seq_ultimo_em=datetime('now'), seq_erro=NULL WHERE id=?").run(feitas.join(','), l.id)
        D.log('🧪', `Acompanhamento do teste (${etapa}) enviado: ${l.restaurante}`)
        enviadas++
      } else {
        D.db.prepare('UPDATE testes_gratis SET seq_erro=? WHERE id=?').run(String((r && (r.error || r.data?.message)) || 'WhatsApp de Suporte e Vendas indisponível').slice(0, 300), l.id)
      }
    } catch (e) {
      D.db.prepare('UPDATE testes_gratis SET seq_erro=? WHERE id=?').run(String(e.message).slice(0, 300), l.id)
    }
  }
  if (enviadas) D.marcarDirty()
}

// ==================== Meta (API de Conversões) ====================
// O pixel do navegador só vê o cadastro. A venda acontece depois, dentro do
// sistema, quando a loja paga a mensalidade: este envio conta para a Meta qual
// cadastro virou cliente pagante, para os anúncios buscarem gente parecida.
// Os dados pessoais vão embaralhados (SHA-256), como a Meta exige.
const sha = v => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex')
function dadosUsuarioMeta(l) {
  const ud = {}
  if (l.email) ud.em = [sha(l.email)]
  const fone = String(l.telefone || '').replace(/\D/g, '')
  if (fone) ud.ph = [sha(fone.length <= 11 ? '55' + fone : fone)]
  const pn = String(l.nome || '').trim().split(/\s+/)
  if (pn[0]) ud.fn = [sha(pn[0])]
  if (pn.length > 1) ud.ln = [sha(pn[pn.length - 1])]
  if (l.tenant_id) ud.external_id = [sha(l.tenant_id)]
  ud.country = [sha('br')]
  if (l.ip) ud.client_ip_address = String(l.ip).replace(/^::ffff:/, '')
  if (l.ua) ud.client_user_agent = l.ua
  if (l.fbp) ud.fbp = l.fbp
  if (l.fbc) ud.fbc = l.fbc
  return ud
}
async function enviarEventoMeta(nome, l, extra = {}) {
  const cfg = cfgTeste()
  if (!cfg.meta_token || !cfg.meta_pixel) return { ok: false, error: 'Token da API de Conversões não configurado' }
  const evento = {
    event_name: nome,
    event_time: Math.floor((extra.quando || Date.now()) / 1000),
    action_source: 'website',
    event_source_url: l.origem_url || BASE_URL,
    user_data: dadosUsuarioMeta(l),
    ...(extra.event_id ? { event_id: extra.event_id } : {}),
    ...(extra.custom_data ? { custom_data: extra.custom_data } : {})
  }
  const corpo = { data: [evento] }
  if (cfg.meta_teste) corpo.test_event_code = cfg.meta_teste
  try {
    const r = await fetch(`https://graph.facebook.com/${META_GRAPH}/${cfg.meta_pixel}/events?access_token=${encodeURIComponent(cfg.meta_token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(15000)
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, error: String(j?.error?.message || `Meta respondeu ${r.status}`).slice(0, 300) }
    return { ok: true, recebidos: j.events_received }
  } catch (e) { return { ok: false, error: String(e.message).slice(0, 300) } }
}
// Chamado pelo sistema quando uma loja paga a mensalidade (Pix, cartão, fatura,
// assinatura) ou quando o admin ativa o teste. Só conta lojas que vieram do
// teste grátis do site, e só uma vez por loja.
async function registrarCompra(tenantId, valor, origem) {
  if (!D || !tenantId) return
  try {
    const l = D.db.prepare('SELECT * FROM testes_gratis WHERE tenant_id=? AND meta_compra_em IS NULL ORDER BY id DESC LIMIT 1').get(String(tenantId))
    if (!l) return
    const v = Math.round((parseFloat(valor) || parseFloat(String(precoSite()).replace(/\./g, '').replace(',', '.')) || 0) * 100) / 100
    const r = await enviarEventoMeta('Purchase', l, { event_id: 'compra-' + l.id, custom_data: { currency: 'BRL', value: v, content_name: 'Mensalidade EstimaFood', content_category: origem || '' } })
    if (r.ok) {
      D.db.prepare("UPDATE testes_gratis SET meta_compra_em=datetime('now'), meta_compra_erro=NULL WHERE id=?").run(l.id)
      D.log('📈', `Venda enviada para a Meta: ${l.restaurante} R$ ${v.toFixed(2)} (${origem})`)
    } else {
      D.db.prepare('UPDATE testes_gratis SET meta_compra_erro=? WHERE id=?').run(r.error, l.id)
      if (!/não configurado/.test(r.error)) D.log('⚠️', `Venda não enviada para a Meta (${l.restaurante}): ${r.error}`)
    }
    D.marcarDirty()
  } catch (e) { D.log('⚠️', 'registrarCompra:', e.message) }
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
    msg_texto: typeof salvo.msg_texto === 'string' && salvo.msg_texto.trim() ? salvo.msg_texto.slice(0, 1500) : MSG_PADRAO,
    seq_ativa: salvo.seq_ativa !== false,
    seq: Object.fromEntries(SEQ_ETAPAS.map(k => [k, typeof salvo.seq?.[k] === 'string' && salvo.seq[k].trim() ? salvo.seq[k].slice(0, 1500) : SEQ_PADRAO[k]])),
    meta_pixel: /^\d{6,20}$/.test(String(salvo.meta_pixel || '')) && String(salvo.meta_pixel) !== META_PIXEL_ANTIGO ? String(salvo.meta_pixel) : META_PIXEL_PADRAO,
    meta_token: typeof salvo.meta_token === 'string' ? salvo.meta_token : '',
    meta_teste: typeof salvo.meta_teste === 'string' ? salvo.meta_teste.slice(0, 40) : '',
    ia_teste: salvo.ia_teste !== false,
    compra_ativa: salvo.compra_ativa !== false
  }
}
function downloadUrl(cfg) { return cfg.download_url || `${BASE_URL}/download` }
function gestorUrl(cfg) { return cfg.gestor_url || `${BASE_URL}/login.html` }
function cfgParaPainel(cfg) {
  // o token da Meta nunca volta inteiro para a tela
  const { meta_token, ...resto } = cfg
  return { ...resto, meta_token_salvo: meta_token ? '••••' + meta_token.slice(-4) : '', download_padrao: `${BASE_URL}/download`, gestor_padrao: `${BASE_URL}/login.html`,
    msg_padrao: MSG_PADRAO, seq_padrao: SEQ_PADRAO }
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
function textoMensagem(linha, cfg, texto) {
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
    link_cardapio: cardapio,
    preco: precoSite()
  }
  return String(texto || cfg.msg_texto || MSG_PADRAO).replace(/\{(\w+)\}/g, (m, k) => (k in valores ? valores[k] : m))
}

async function enviarMensagem(linha, manual) {
  const db = D.db
  const cfg = cfgTeste()
  if (!D.bot?.sendText) throw new Error('O WhatsApp de Suporte e Vendas não está disponível')
  const r = await D.bot.sendText(linha.telefone, textoMensagem(linha, cfg), 1200)
  if (r && r.ok) {
    db.prepare("UPDATE testes_gratis SET msg_status='enviada', msg_enviada_em=datetime('now'), msg_erro=NULL, seq_ultimo_em=datetime('now') WHERE id=?").run(linha.id)
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
    await processarAcompanhamento(cfg)
    await conferirComprasPendentes()
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

// Conteúdo que vale agora. Se o que está salvo no painel é de uma versão
// anterior do site (antes das seções da IA, do cardápio por IA e do garçom),
// usa o padrão novo, mantendo o WhatsApp, os preços e as camadas extras que
// o admin criou. O conteúdo antigo continua guardado até o admin publicar.
function completarComPadrao(v) {
  const novo = JSON.parse(JSON.stringify(v))
  const pad = JSON.parse(JSON.stringify(PADRAO))
  novo.versao = pad.versao
  for (const bloco of ['geral', 'precos']) {
    if (!novo[bloco] || typeof novo[bloco] !== 'object') novo[bloco] = {}
    for (const [k, val] of Object.entries(pad[bloco] || {})) if (!(k in novo[bloco])) novo[bloco][k] = val
  }
  if (!Array.isArray(novo.camadas)) novo.camadas = []
  const padPorId = new Map((pad.camadas || []).map(c => [c.id, c]))
  for (const c of novo.camadas) {
    const p = c && padPorId.get(c.id)
    if (!p || !p.dados) continue
    if (!c.dados || typeof c.dados !== 'object') c.dados = {}
    for (const [k, val] of Object.entries(p.dados)) if (!(k in c.dados)) c.dados[k] = val
  }
  // camadas que o padrão ganhou: entram logo depois da camada que vem antes delas no padrão
  const ids = new Set(novo.camadas.map(c => c && c.id))
  ;(pad.camadas || []).forEach((p, i) => {
    if (ids.has(p.id)) return
    let pos = 0
    for (let j = i - 1; j >= 0; j--) {
      const k = novo.camadas.findIndex(c => c && c.id === pad.camadas[j].id)
      if (k >= 0) { pos = k + 1; break }
    }
    novo.camadas.splice(pos, 0, p)
    ids.add(p.id)
  })
  return novo
}

function conteudoAtual() {
  const salvo = lerDado('conteudo')
  const v = salvo?.valor
  if (!v) return { conteudo: PADRAO, salvo: null, migrado: false }
  const vSalvo = parseInt(v.versao) || 1
  if (vSalvo >= (parseInt(PADRAO.versao) || 1)) return { conteudo: v, salvo, migrado: false }
  // A partir da versão 2 o texto salvo no painel é mantido: só entram os
  // campos e as camadas novas do padrão, no lugar em que o padrão os coloca.
  if (vSalvo >= 2) return { conteudo: completarComPadrao(v), salvo, migrado: true }
  const novo = JSON.parse(JSON.stringify(PADRAO))
  const g = v.geral || {}
  for (const k of ['whatsapp', 'mensagem_whatsapp']) if (g[k]) novo.geral[k] = g[k]
  if (v.precos && typeof v.precos === 'object') novo.precos = { ...novo.precos, ...v.precos }
  const ids = new Set(novo.camadas.map(c => c.id))
  const extras = (Array.isArray(v.camadas) ? v.camadas : []).filter(c => c && c.id && !ids.has(c.id))
  if (extras.length) {
    const i = novo.camadas.findIndex(c => c.id === 'faq')
    novo.camadas.splice(i < 0 ? novo.camadas.length : i, 0, ...extras)
  }
  return { conteudo: novo, salvo, migrado: true }
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

// A mesma caixa de e-mail escrita de outro jeito conta como o mesmo e-mail:
// maiúsculas, o "+algo" antes do @ e, no Gmail, os pontos (joao.silva = joaosilva).
function chaveEmail(email) {
  const s = String(email || '').trim().toLowerCase()
  const i = s.lastIndexOf('@')
  if (i < 1) return s
  let local = s.slice(0, i).split('+')[0]
  let dominio = s.slice(i + 1)
  if (dominio === 'googlemail.com') dominio = 'gmail.com'
  if (dominio === 'gmail.com') local = local.replace(/\./g, '')
  return local + '@' + dominio
}

// ── E-mail de verdade ───────────────────────────────────
// O teste grátis só aceita e-mail de provedor real. Provedores conhecidos passam
// direto; qualquer outro domínio precisa ter servidor de e-mail publicado (registro
// MX no DNS). E-mail temporário/descartável e endereço de mentira não passam.
const PROVEDORES_CONHECIDOS = new Set([
  'gmail.com', 'googlemail.com',
  'icloud.com', 'me.com', 'mac.com',
  'outlook.com', 'outlook.com.br', 'hotmail.com', 'hotmail.com.br', 'live.com', 'live.com.br', 'msn.com',
  'yahoo.com', 'yahoo.com.br', 'ymail.com', 'rocketmail.com',
  'uol.com.br', 'bol.com.br', 'terra.com.br', 'ig.com.br', 'globo.com', 'globomail.com', 'r7.com', 'zipmail.com.br', 'oi.com.br',
  'proton.me', 'protonmail.com', 'pm.me', 'aol.com', 'gmx.com', 'zoho.com'
])
const EMAIL_DESCARTAVEL = new Set([
  'mailinator.com', 'yopmail.com', 'yopmail.net', 'yopmail.fr', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz',
  'guerrillamail.de', 'sharklasers.com', 'grr.la', '10minutemail.com', '10minutemail.net', '20minutemail.com', 'tempmail.com', 'temp-mail.org',
  'temp-mail.io', 'tempmailo.com', 'tempmail.net', 'tempail.com', 'tempr.email', 'tempinbox.com', 'throwawaymail.com', 'trashmail.com',
  'trashmail.net', 'getnada.com', 'nada.email', 'maildrop.cc', 'dispostable.com', 'fakeinbox.com', 'fakemail.net', 'emailfake.com',
  'mohmal.com', 'emailondeck.com', 'mintemail.com', 'mailnesia.com', 'moakt.com', 'tmpmail.org', 'tmpmail.net', '1secmail.com',
  '1secmail.org', '1secmail.net', 'discard.email', 'spamgourmet.com', 'mytemp.email', 'burnermail.io', 'mailcatch.com', 'inboxkitten.com',
  'minuteinbox.com', 'luxusmail.org', 'mail.tm', 'getairmail.com', 'spam4.me', 'mailsac.com', 'harakirimail.com', 'tempmailaddress.com',
  'example.com', 'example.org', 'example.net', 'exemplo.com', 'exemplo.com.br', 'test.com', 'teste.com', 'teste.com.br', 'email.teste'
])
// Erros de digitação mais comuns: o cadastro mostra a correção em vez de aceitar um endereço que não existe.
const DOMINIO_DIGITADO_ERRADO = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmil.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'gemail.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com',
  'gmail.comm': 'gmail.com', 'gmail.com.br': 'gmail.com', 'gmail.cim': 'gmail.com', 'gmail.vom': 'gmail.com',
  'hotmal.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmil.com': 'hotmail.com', 'hormail.com': 'hotmail.com',
  'hotmaill.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotmail.cm': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outllok.com': 'outlook.com', 'outlook.co': 'outlook.com', 'outlook.con': 'outlook.com',
  'iclod.com': 'icloud.com', 'icoud.com': 'icloud.com', 'icloud.co': 'icloud.com', 'icloud.con': 'icloud.com', 'icloud.com.br': 'icloud.com',
  'yaho.com': 'yahoo.com', 'yhoo.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yaho.com.br': 'yahoo.com.br'
}
const _mxGuardado = new Map() // domínio -> { r: 'sim' | 'nao', ate }

// 'sim' = o domínio recebe e-mail, 'nao' = não existe ou não recebe, 'indefinido' = não deu para consultar agora
async function dominioRecebeEmail(dominio) {
  const g = _mxGuardado.get(dominio)
  if (g && g.ate > Date.now()) return g.r
  let relogio
  const limite = new Promise(ok => { relogio = setTimeout(() => ok('indefinido'), 4000) })
  const consulta = dns.promises.resolveMx(dominio)
    .then(lista => (Array.isArray(lista) && lista.some(m => m && m.exchange && m.exchange !== '.')) ? 'sim' : 'nao')
    .catch(e => (e && (e.code === 'ENOTFOUND' || e.code === 'ENODATA')) ? 'nao' : 'indefinido')
  const r = await Promise.race([consulta, limite])
  clearTimeout(relogio)
  if (r !== 'indefinido') {
    if (_mxGuardado.size > 2000) _mxGuardado.clear()
    _mxGuardado.set(dominio, { r, ate: Date.now() + (r === 'sim' ? 6 : 1) * 3600 * 1000 })
  }
  return r
}

// Devolve null quando o e-mail serve, ou { error, sugestao? } explicando por que não serve.
async function conferirProvedorEmail(email) {
  const s = String(email || '').trim().toLowerCase()
  const i = s.lastIndexOf('@')
  const local = s.slice(0, i), dominio = s.slice(i + 1)
  const certo = DOMINIO_DIGITADO_ERRADO[dominio]
  if (certo) {
    const sugestao = local + '@' + certo
    return { error: `Confira o e-mail. Você quis dizer ${sugestao}?`, sugestao }
  }
  if (EMAIL_DESCARTAVEL.has(dominio) || [...EMAIL_DESCARTAVEL].some(d => dominio.endsWith('.' + d))) {
    return { error: 'Use um e-mail de verdade, como Gmail, Outlook ou iCloud. E-mail temporário não é aceito.' }
  }
  if (dominio === 'gmail.com' || dominio === 'googlemail.com') {
    // o Gmail só tem endereços com 6 a 30 letras, números ou pontos antes do @
    const nome = local.split('+')[0]
    if (!/^[a-z0-9.]{6,30}$/.test(nome) || /^\.|\.$|\.\./.test(nome)) return { error: 'Este endereço do Gmail não existe. Confira o que vem antes do @.' }
  }
  if (PROVEDORES_CONHECIDOS.has(dominio)) return null
  const mx = await dominioRecebeEmail(dominio)
  if (mx === 'sim') return null
  if (mx === 'nao') return { error: `Não encontramos o provedor deste e-mail (@${dominio}). Confira o endereço ou use Gmail, Outlook ou iCloud.` }
  return { error: 'Não foi possível conferir este e-mail agora. Tente de novo em instantes ou use Gmail, Outlook ou iCloud.' }
}

// O teste grátis é sempre com e-mail novo. Devolve por que o e-mail não serve:
//   'conta' — já existe uma conta com ele (cliente ou teste em andamento)
//   'teste' — já fez teste antes, mesmo que o teste tenha vencido ou a conta tenha sido apagada
//   ''      — e-mail novo, pode seguir
function emailJaUsado(email) {
  const db = D.db
  if (db.prepare('SELECT id FROM sys_users WHERE email=?').get(email)) return 'conta'
  const chave = chaveEmail(email)
  if (db.prepare('SELECT email FROM sys_users WHERE email IS NOT NULL').all().some(u => chaveEmail(u.email) === chave)) return 'conta'
  if (db.prepare('SELECT email FROM testes_gratis WHERE email IS NOT NULL').all().some(g => chaveEmail(g.email) === chave)) return 'teste'
  return ''
}

// Cria a loja com o gestor e as categorias iniciais (teste grátis e compra pelo site).
// Precisa rodar dentro de uma transação de quem chama.
function criarLoja({ nome, restaurante, slug, foneCobranca, email, senha, expira, robo }) {
  const db = D.db
  db.prepare('INSERT INTO tenants (nome,plano,slug,segmento,expires_at,telefone_cobranca) VALUES (?,?,?,?,?,?)')
    .run(restaurante, 'premium', slug, 'restaurante', expira, foneCobranca)
  const t = db.prepare('SELECT id FROM tenants WHERE slug=?').get(slug)
  db.prepare('INSERT OR IGNORE INTO store_config (tenant_id) VALUES (?)').run(t.id)
  // Mesmo acerto do cadastro pelo admin: o 1º pedido da loja começa em #1.
  const maxOrderId = db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM orders').get()?.m || 0
  db.prepare('UPDATE store_config SET order_num_offset=?, store_name=? WHERE tenant_id=?').run(maxOrderId, restaurante, t.id)
  // Teste com a atendente com IA: o robô do WhatsApp da loja já começa ligado
  // (só responde depois que a loja conectar o WhatsApp no painel)
  if (robo) db.prepare("UPDATE store_config SET ia_config=? WHERE tenant_id=? AND (ia_config IS NULL OR ia_config='')").run(JSON.stringify({ ativo: true }), t.id)
  db.prepare('INSERT INTO sys_users (nome,email,senha_hash,role,tenant_id) VALUES (?,?,?,?,?)')
    .run(nome, email, D.hashPassword(senha), 'gestor', t.id)
  const cat = db.prepare("INSERT INTO categories (tenant_id,name,label,type,emoji,sort_order,ativo) VALUES (?,?,?,?,?,?,1)")
  ;[['entradas', 'Entradas', '🥗'], ['pratos', 'Pratos', '🍽️'], ['bebidas', 'Bebidas', '🥤'], ['sobremesas', 'Sobremesas', '🍰']]
    .forEach(([name, label, emoji], i) => cat.run(t.id, name, label, 'Itens principais', emoji, i + 1))
  return t.id
}

function slugLivre(restaurante) {
  const base = slugDe(restaurante)
  let slug = base, n = 2
  while (D.db.prepare('SELECT id FROM tenants WHERE slug=?').get(slug)) slug = `${base}-${n++}`
  return slug
}

function criarContaTeste({ nome, restaurante, telefone, email, senha, ip, dias, cfg, meta = {} }) {
  const db = D.db
  const hoje = hojeBR()
  const expira = somaDias(hoje, dias)
  const base = slugDe(restaurante)
  let slug = base, n = 2
  while (db.prepare('SELECT id FROM tenants WHERE slug=?').get(slug)) slug = `${base}-${n++}`
  const fone11 = telefone.length > 11 && telefone.startsWith('55') ? telefone.slice(2) : telefone
  const foneCobranca = (fone11.length === 10 || fone11.length === 11) ? fone11 : null

  const criar = db.transaction(() => {
    const t = { id: criarLoja({ nome, restaurante, slug, foneCobranca, email, senha, expira, robo: cfg.ia_teste }) }
    db.prepare(`INSERT INTO testes_gratis (tenant_id,nome,restaurante,telefone,email,ip,dias,expira_em,senha_cifrada,msg_status,msg_em,fbp,fbc,ua,origem_url,ev_id,ia_teste)
      VALUES (?,?,?,?,?,?,?,?,?,?,${cfg.msg_ativa ? `datetime('now','+${cfg.msg_minutos} minutes')` : 'NULL'},?,?,?,?,?,?)`)
      .run(t.id, nome, restaurante, telefone, email, ip, dias, expira, cifrar(senha), cfg.msg_ativa ? 'pendente' : null,
        meta.fbp || null, meta.fbc || null, meta.ua || null, meta.url || null, meta.ev_id || null, cfg.ia_teste ? 1 : 0)
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

// ==================== Compra do plano pelo site ====================
// A pessoa preenche os mesmos dados do teste grátis e paga o 1º mês (preço do
// site) com Pix ou cartão, no Mercado Pago da plataforma. A conta só é criada
// quando o pagamento é aprovado — confirmação pela tela do site, pelo aviso do
// Mercado Pago (webhook) ou pela conferência a cada minuto, o que vier primeiro.
const PIX_MINUTOS = 30
const MSG_COMPRA = [
  'Oi, {nome}! Pagamento confirmado. Seja bem-vindo(a) ao EstimaFood.',
  '',
  'A loja *{loja}* já está ativa até {validade}.',
  '',
  'Para entrar no painel:',
  '{link_gestor}',
  'E-mail: {email}',
  '',
  'Para imprimir os pedidos sozinho no computador, baixe o programa:',
  '{link_download}',
  '',
  'Qualquer dúvida, é só responder aqui que a gente te ajuda a montar o cardápio.'
].join('\n')
const RECUSA_CARTAO = {
  cc_rejected_bad_filled_card_number: 'Confira o número do cartão.',
  cc_rejected_bad_filled_date: 'Confira a data de validade do cartão.',
  cc_rejected_bad_filled_security_code: 'Confira o código de segurança (CVV) do cartão.',
  cc_rejected_bad_filled_other: 'Confira os dados do cartão.',
  cc_rejected_insufficient_amount: 'O cartão não tem limite suficiente. Tente outro cartão ou pague com Pix.',
  cc_rejected_call_for_authorize: 'O banco pediu autorização. Ligue para o banco, libere a compra e tente de novo.',
  cc_rejected_card_disabled: 'O cartão está bloqueado. Fale com o banco ou use outro cartão.',
  cc_rejected_duplicated_payment: 'Esse pagamento já foi feito. Confira o WhatsApp que você informou.',
  cc_rejected_max_attempts: 'Muitas tentativas com este cartão. Use outro cartão ou pague com Pix.'
}
const RECUSA_PADRAO = 'O banco recusou o pagamento. Tente outro cartão ou pague com Pix.'

function valorCompra() {
  const v = parseFloat(String(precoSite() || '').replace(/[^\d,.]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'))
  return Number.isFinite(v) && v >= 1 ? Math.round(v * 100) / 100 : 0
}
function infoCompra(cfg) {
  const token = D.mpToken ? D.mpToken() : ''
  const valor = valorCompra()
  const pk = D.mpPublicKey ? D.mpPublicKey() : ''
  return { ativo: !!(cfg.compra_ativa && token && valor), valor, public_key: pk, cartao: !!pk }
}
// "2026-10-14T18:30:00.000-03:00" (formato que o Mercado Pago aceita para o vencimento do Pix)
function isoBrasilia(ms) {
  return new Date(ms - 3 * 3600 * 1000).toISOString().replace('Z', '-03:00')
}
async function mpPagamento(metodo, caminho, corpo, chaveIdem) {
  const token = D.mpToken ? D.mpToken() : ''
  if (!token) throw new Error('Mercado Pago não configurado')
  const r = await fetch('https://api.mercadopago.com/v1/payments' + (caminho || ''), {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(chaveIdem ? { 'X-Idempotency-Key': chaveIdem } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(25000)
  })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data: j }
}

function respostaCompra(c) {
  const out = { ok: true, id: c.id, chave: c.chave, status: c.status, metodo: c.metodo, valor: c.valor }
  if (c.status === 'pendente' && c.metodo === 'pix') Object.assign(out, { qr_code: c.qr_code, qr_code_base64: c.qr_code_base64, pix_expira: c.pix_expira })
  if (c.status === 'recusado') out.mensagem = c.status_detalhe || RECUSA_PADRAO
  if (c.status === 'analise') out.mensagem = 'O banco está analisando o pagamento. Assim que aprovar, sua conta é criada e você recebe o acesso no WhatsApp.'
  if (c.status === 'expirado') out.mensagem = 'O Pix venceu sem pagamento. Gere um novo para continuar.'
  if (c.status === 'erro') out.mensagem = 'Recebemos o pagamento, mas houve um problema ao criar a conta. A nossa equipe já foi avisada e vai te chamar no WhatsApp.'
  if (c.status === 'aprovado') {
    const cfg = cfgTeste()
    let cardapio = ''
    try { cardapio = D.linkCardapioTenant(c.tenant_id) } catch {}
    Object.assign(out, { loja: c.restaurante, email: c.email, expira_em: c.expira_em, login_url: gestorUrl(cfg), cardapio_url: cardapio, download_url: downloadUrl(cfg), ev_id: 'venda-' + c.id })
  }
  return out
}

async function iniciarCompra(req, body) {
  const cfg = cfgTeste()
  const info = infoCompra(cfg)
  if (!info.ativo) return { http: 403, json: { error: 'A compra pelo site não está disponível agora. Fale com a gente pelo WhatsApp.' } }
  if (String(body.website || '').trim()) return { http: 400, json: { error: 'Não foi possível concluir.' } }
  const nome = String(body.nome || '').trim().replace(/\s+/g, ' ').slice(0, 80)
  const restaurante = String(body.restaurante || '').trim().replace(/\s+/g, ' ').slice(0, 80)
  let telefone = String(body.telefone || '').replace(/\D/g, '').slice(0, 13)
  if (telefone.length > 11 && telefone.startsWith('55')) telefone = telefone.slice(2)
  const email = String(body.email || '').trim().toLowerCase().slice(0, 120)
  const senha = String(body.senha || '')
  const metodo = body.metodo === 'cartao' ? 'cartao' : 'pix'
  const erro = (msg, campo) => ({ http: 400, json: { error: msg, campo } })
  if (nome.length < 2) return erro('Informe o seu nome', 'nome')
  if (restaurante.length < 2) return erro('Informe o nome do restaurante', 'restaurante')
  if (!/^[1-9][1-9]\d{8,9}$/.test(telefone)) return erro('Informe o WhatsApp com DDD, por exemplo (88) 99999-0000', 'telefone')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return erro('Informe um e-mail válido', 'email')
  if (senha.length < 6 || senha.length > 72) return erro('A senha precisa ter pelo menos 6 caracteres', 'senha')
  const cpf = String(body.cpf || '').replace(/\D/g, '')
  if (metodo === 'cartao') {
    if (!info.cartao) return erro('O pagamento com cartão não está disponível agora. Use o Pix.')
    if (!/^[\w-]{16,}$/.test(String(body.card_token || ''))) return erro('Não foi possível ler o cartão. Confira os dados e tente de novo.')
    if (!/^[a-z_]{2,30}$/.test(String(body.payment_method_id || ''))) return erro('Bandeira do cartão não reconhecida. Confira o número do cartão.')
    if (cpf.length !== 11) return erro('Informe o CPF do dono do cartão', 'cpf')
  }

  const db = D.db
  const ip = D.clientIp(req)
  try {
    if (emailJaUsado(email) === 'conta') {
      return { http: 409, json: { error: 'Este e-mail já tem uma conta. Entre no painel e pague em "Meu plano".', campo: 'email', login_url: gestorUrl(cfg) } }
    }
    const provedor = await conferirProvedorEmail(email)
    if (provedor) return { http: 400, json: { error: provedor.error, campo: 'email', sugestao: provedor.sugestao } }
    const doIp = db.prepare("SELECT COUNT(*) AS c FROM site_compras WHERE ip=? AND created_at >= datetime('now','-1 hour')").get(ip).c
    if (doIp >= 6) return { http: 429, json: { error: 'Muitas tentativas a partir desta conexão. Espere alguns minutos ou fale com a gente pelo WhatsApp.' } }

    const txtMeta = (v, re, max) => { const t = String(v || '').trim().slice(0, max); return re.test(t) ? t : '' }
    const chave = crypto.randomBytes(16).toString('hex')
    const ins = db.prepare(`INSERT INTO site_compras (chave,nome,restaurante,telefone,email,senha_cifrada,valor,metodo,ip,ua,fbp,fbc,origem_url,ev_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(chave, nome, restaurante, telefone, email, cifrar(senha), info.valor, metodo, ip,
      String(req.headers['user-agent'] || '').slice(0, 400),
      txtMeta(body.fbp, /^fb\.\d\.\d+\.\d+$/, 80) || null, txtMeta(body.fbc, /^fb\.\d\.\d+\.[\w-]+$/, 300) || null,
      txtMeta(body.url, /^https?:\/\/[^\s"'<>]+$/i, 500) || null, txtMeta(body.ev_id, /^[\w-]{8,64}$/, 64) || null)
    const id = ins.lastInsertRowid
    const ref = 'site-compra-' + id
    const pn = nome.split(' ')
    const pagamento = {
      transaction_amount: info.valor,
      description: 'EstimaFood - primeiro mês',
      external_reference: ref,
      notification_url: `${D.urlBase ? D.urlBase(req) : BASE_URL}/webhook/mercadopago`,
      statement_descriptor: 'ESTIMAFOOD',
      payer: { email, first_name: pn[0], last_name: pn.slice(1).join(' ') || pn[0] }
    }
    if (metodo === 'pix') {
      pagamento.payment_method_id = 'pix'
      pagamento.date_of_expiration = isoBrasilia(Date.now() + PIX_MINUTOS * 60000)
    } else {
      Object.assign(pagamento, { token: String(body.card_token), installments: 1, payment_method_id: String(body.payment_method_id) })
      if (/^\d{1,10}$/.test(String(body.issuer_id || ''))) pagamento.issuer_id = String(body.issuer_id)
      pagamento.payer.identification = { type: 'CPF', number: cpf }
    }
    const mp = await mpPagamento('POST', '', pagamento, ref)
    if (!mp.ok || !mp.data?.id) {
      const msg = metodo === 'cartao' ? (RECUSA_CARTAO[mp.data?.cause?.[0]?.code] || 'Não foi possível processar o cartão. Confira os dados ou pague com Pix.') : 'Não foi possível gerar o Pix agora. Tente de novo em instantes.'
      db.prepare("UPDATE site_compras SET status='recusado', status_detalhe=?, erro=? WHERE id=?").run(msg, String(mp.data?.message || mp.status).slice(0, 300), id)
      D.log('❌', `Compra pelo site (${metodo}) recusada pelo Mercado Pago:`, mp.data?.message || mp.status)
      return { http: 400, json: { error: msg } }
    }
    const d = mp.data
    db.prepare('UPDATE site_compras SET mp_payment_id=?, mp_ref=?, bandeira=?, qr_code=?, qr_code_base64=?, pix_expira=? WHERE id=?')
      .run(String(d.id), ref, d.payment_method_id || null, d.point_of_interaction?.transaction_data?.qr_code || null,
        d.point_of_interaction?.transaction_data?.qr_code_base64 || null, metodo === 'pix' ? new Date(Date.now() + PIX_MINUTOS * 60000).toISOString() : null, id)
    D.log('🛒', `Compra pelo site iniciada: ${restaurante} (${email}) ${metodo} R$ ${info.valor.toFixed(2)} mp=${d.id}`)
    await aplicarStatusMp(id, d)
    return { http: 200, json: respostaCompra(D.db.prepare('SELECT * FROM site_compras WHERE id=?').get(id)) }
  } catch (e) {
    D.log('❌', 'Compra pelo site falhou:', e.message)
    return { http: 500, json: { error: 'Não foi possível iniciar o pagamento agora. Tente de novo em instantes.' } }
  }
}

// Atualiza a compra conforme o status do Mercado Pago
async function aplicarStatusMp(id, pd) {
  const c = D.db.prepare('SELECT * FROM site_compras WHERE id=?').get(id)
  if (!c || !pd) return
  const st = String(pd.status || '')
  D.db.prepare("UPDATE site_compras SET conferido_em=datetime('now') WHERE id=?").run(id)
  if (st === 'approved') return finalizarCompra(id)
  if (!['pendente', 'analise'].includes(c.status)) return
  if (st === 'rejected') {
    D.db.prepare("UPDATE site_compras SET status='recusado', status_detalhe=? WHERE id=?").run(RECUSA_CARTAO[pd.status_detail] || RECUSA_PADRAO, id)
  } else if (st === 'cancelled' || st === 'expired') {
    D.db.prepare("UPDATE site_compras SET status='expirado' WHERE id=?").run(id)
  } else if (c.metodo === 'cartao' && (st === 'in_process' || st === 'pending' || st === 'authorized')) {
    D.db.prepare("UPDATE site_compras SET status='analise' WHERE id=?").run(id)
  }
}

async function finalizarCompra(id) {
  const db = D.db
  if (!db.prepare("UPDATE site_compras SET status='processando' WHERE id=? AND status IN ('pendente','analise','recusado','expirado')").run(id).changes) return
  const c = db.prepare('SELECT * FROM site_compras WHERE id=?').get(id)
  try {
    let tenantId = db.prepare('SELECT tenant_id FROM sys_users WHERE email=?').get(c.email)?.tenant_id || null
    const novaConta = !tenantId
    if (novaConta) {
      const senha = decifrar(c.senha_cifrada)
      if (!senha) throw new Error('senha da compra ilegível')
      const fone11 = c.telefone.length > 11 && c.telefone.startsWith('55') ? c.telefone.slice(2) : c.telefone
      tenantId = db.transaction(() => criarLoja({
        nome: c.nome, restaurante: c.restaurante, slug: slugLivre(c.restaurante),
        foneCobranca: (fone11.length === 10 || fone11.length === 11) ? fone11 : null,
        email: c.email, senha, expira: hojeBR(), robo: false
      }))()
    }
    // registra o pagamento no histórico do plano e soma 1 mês a partir de hoje
    const ren = D.confirmarPlano ? D.confirmarPlano({ tenantId, mpPaymentId: c.mp_payment_id, valor: c.valor, metodo: c.metodo, extRef: c.mp_ref, bandeira: c.bandeira }) : null
    if (!ren) {
      const t = db.prepare('SELECT expires_at FROM tenants WHERE id=?').get(tenantId)
      if (!t?.expires_at || t.expires_at <= hojeBR()) db.prepare("UPDATE tenants SET expires_at=?, ativo=1 WHERE id=?").run(somaDias(hojeBR(), 30), tenantId)
    }
    const expira = db.prepare('SELECT expires_at FROM tenants WHERE id=?').get(tenantId)?.expires_at || ''
    db.prepare("UPDATE site_compras SET status='aprovado', aprovado_em=datetime('now'), tenant_id=?, expira_em=?, senha_cifrada=NULL WHERE id=?")
      .run(tenantId, String(expira).slice(0, 10), id)
    D.marcarDirty()
    try { setTimeout(() => D.fazerBackup(true), 2000) } catch {}
    D.log('🛒', `VENDA PELO SITE: ${c.restaurante} (${c.email}) R$ ${Number(c.valor).toFixed(2)} ${c.metodo} — conta ${novaConta ? 'criada' : 'existente renovada'} até ${expira}`)
    const f = db.prepare('SELECT * FROM site_compras WHERE id=?').get(id)
    setImmediate(async () => {
      const cfg = cfgTeste()
      // boas-vindas com o acesso
      try {
        if (D.bot?.sendText && novaConta) {
          const v = { nome: String(f.nome || '').split(' ')[0], loja: f.restaurante, email: f.email, validade: String(f.expira_em || '').split('-').reverse().join('/'),
            link_gestor: gestorUrl(cfg), link_download: downloadUrl(cfg) }
          await D.bot.sendText(f.telefone, MSG_COMPRA.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)), 1200)
        }
      } catch (e) { D.log('⚠️', 'Boas-vindas da compra não enviadas:', e.message) }
      avisarAdmin([
        '*🛒 NOVA VENDA PELO SITE*', '',
        `*Loja:* ${f.restaurante}`, `*Responsável:* ${f.nome}`, `*WhatsApp:* ${f.telefone}`, `*E-mail:* ${f.email}`,
        `*Valor:* R$ ${Number(f.valor).toFixed(2).replace('.', ',')} (${f.metodo === 'pix' ? 'Pix' : 'cartão'})`,
        `*Ativa até:* ${String(f.expira_em || '').split('-').reverse().join('/')}`, '',
        novaConta ? '_Conta criada automaticamente_' : '_E-mail já tinha conta: a loja foi renovada_'
      ].join('\n'))
      // venda para a Meta (mesmo ID do pixel do navegador; quem veio do teste já é contado pelo sistema)
      if (novaConta) {
        const r = await enviarEventoMeta('Purchase', { ...f, origem_url: f.origem_url }, { event_id: 'venda-' + f.id, custom_data: { currency: 'BRL', value: Number(f.valor), content_name: 'Mensalidade EstimaFood', content_category: 'site' } })
        if (!r.ok && !/não configurado/.test(r.error)) D.log('⚠️', 'Venda do site não enviada para a Meta:', r.error)
      }
    })
  } catch (e) {
    db.prepare("UPDATE site_compras SET status='erro', erro=? WHERE id=?").run(String(e.message).slice(0, 300), id)
    D.log('❌', `Compra pelo site aprovada mas a conta não foi criada (id ${id}):`, e.message)
    avisarAdmin(`*⚠️ VENDA PELO SITE COM PROBLEMA*\n\nO pagamento de *${c.restaurante}* (${c.email}, ${c.telefone}) foi aprovado, mas a conta não foi criada automaticamente: ${e.message}\n\nCrie a conta pelo painel e avise o cliente.`)
  }
}

async function statusCompra(id, chave) {
  const c = id ? D.db.prepare('SELECT * FROM site_compras WHERE id=?').get(id) : null
  if (!c || !chave || c.chave !== chave) return { http: 404, json: { error: 'Compra não encontrada' } }
  // Pix ou cartão em análise: confere no Mercado Pago, no máximo a cada 4 segundos
  if (['pendente', 'analise'].includes(c.status) && c.mp_payment_id) {
    const ultimo = c.conferido_em ? new Date(c.conferido_em.replace(' ', 'T') + 'Z').getTime() : 0
    if (Date.now() - ultimo > 4000) {
      try {
        const mp = await mpPagamento('GET', '/' + c.mp_payment_id)
        if (mp.ok) await aplicarStatusMp(c.id, mp.data)
      } catch {}
    }
    const atual = D.db.prepare('SELECT * FROM site_compras WHERE id=?').get(c.id)
    if (atual.status === 'pendente' && atual.metodo === 'pix' && atual.pix_expira && Date.parse(atual.pix_expira) < Date.now() - 60000) {
      D.db.prepare("UPDATE site_compras SET status='expirado' WHERE id=? AND status='pendente'").run(c.id)
    }
  }
  return { http: 200, json: respostaCompra(D.db.prepare('SELECT * FROM site_compras WHERE id=?').get(c.id)) }
}

// Aviso do Mercado Pago (webhook): devolve true se o pagamento é de uma compra do site
async function pagamentoDoSite(mpId, pd) {
  if (!D) return false
  const c = D.db.prepare('SELECT id FROM site_compras WHERE mp_payment_id=?').get(String(mpId))
  if (!c) return false
  await aplicarStatusMp(c.id, pd)
  return true
}

// A cada minuto: Pix ainda pendentes (até 2 horas) e cartões em análise (até 3 dias)
async function conferirComprasPendentes() {
  let linhas = []
  try {
    linhas = D.db.prepare(`SELECT id, mp_payment_id FROM site_compras
      WHERE mp_payment_id IS NOT NULL AND (
        (status='pendente' AND created_at >= datetime('now','-2 hours')) OR
        (status='analise' AND created_at >= datetime('now','-3 days')))
        AND (conferido_em IS NULL OR conferido_em <= datetime('now','-90 seconds'))
      ORDER BY id LIMIT 20`).all()
  } catch { return }
  for (const l of linhas) {
    try {
      const mp = await mpPagamento('GET', '/' + l.mp_payment_id)
      if (mp.ok) await aplicarStatusMp(l.id, mp.data)
    } catch {}
  }
  try { D.db.prepare("UPDATE site_compras SET status='expirado' WHERE status='pendente' AND metodo='pix' AND created_at < datetime('now','-2 hours')").run() } catch {}
}

function listarCompras() {
  return D.db.prepare(`SELECT c.id, c.nome, c.restaurante, c.telefone, c.email, c.valor, c.metodo, c.status, c.status_detalhe, c.erro,
      c.created_at, c.aprovado_em, c.expira_em, c.tenant_id, t.nome AS loja
    FROM site_compras c LEFT JOIN tenants t ON t.id = c.tenant_id
    ORDER BY c.id DESC LIMIT 40`).all()
}

// ==================== Visitas do site ====================
// O site manda um aviso a cada página aberta (e quando a pessoa toca no
// WhatsApp). Cada aparelho tem um código aleatório guardado no navegador, então
// dá para contar pessoas, e não só acessos. Robôs e pré-visualizações ficam de fora.
const ORIGENS = new Set(['meta', 'google', 'whatsapp', 'direto'])
const ROBO_UA = /bot|crawl|spider|slurp|facebookexternalhit|facebookcatalog|whatsapp\/|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch/i
const _limiteVisitas = new Map()
function registrarVisita(req, body) {
  try {
    const ua = String(req.headers['user-agent'] || '')
    if (!ua || ROBO_UA.test(ua)) return
    const vid = String(body.v || '')
    if (!/^[a-z0-9]{8,40}$/i.test(vid)) return
    // no máximo 120 avisos por hora por conexão
    const ip = D.clientIp(req) || '-'
    const agora = Date.now()
    const lim = _limiteVisitas.get(ip)
    if (!lim || lim.ate < agora) _limiteVisitas.set(ip, { n: 1, ate: agora + 3600000 })
    else if (++lim.n > 120) return
    if (_limiteVisitas.size > 5000) for (const [k, l] of _limiteVisitas) if (l.ate < agora) _limiteVisitas.delete(k)
    const origem = ORIGENS.has(body.o) ? body.o : 'direto'
    const celular = body.m ? 1 : 0
    const dia = hojeBR()
    if (body.t === 'whats') {
      D.db.prepare(`INSERT INTO site_visitas (dia,visitante,origem,paginas,whats,celular) VALUES (?,?,?,1,1,?)
        ON CONFLICT(dia,visitante) DO UPDATE SET whats=whats+1`).run(dia, vid, origem, celular)
    } else {
      D.db.prepare(`INSERT INTO site_visitas (dia,visitante,origem,paginas,whats,celular) VALUES (?,?,?,1,0,?)
        ON CONFLICT(dia,visitante) DO UPDATE SET paginas=paginas+1`).run(dia, vid, origem, celular)
    }
  } catch (e) { /* contador nunca atrapalha o site */ }
}

function resumoVisitas() {
  const db = D.db
  const hoje = hojeBR()
  const periodo = (ini) => {
    const r = db.prepare(`SELECT COUNT(DISTINCT visitante) AS pessoas, COALESCE(SUM(paginas),0) AS acessos,
      COUNT(DISTINCT CASE WHEN whats > 0 THEN visitante END) AS whats,
      COUNT(DISTINCT CASE WHEN celular = 1 THEN visitante END) AS celular
      FROM site_visitas WHERE dia >= ?`).get(ini)
    const origens = { meta: 0, google: 0, whatsapp: 0, direto: 0 }
    db.prepare('SELECT origem, COUNT(DISTINCT visitante) AS c FROM site_visitas WHERE dia >= ? GROUP BY origem').all(ini)
      .forEach(o => { origens[ORIGENS.has(o.origem) ? o.origem : 'direto'] += o.c })
    const cadastros = db.prepare("SELECT COUNT(*) AS c FROM testes_gratis WHERE date(created_at,'-3 hours') >= ?").get(ini).c
    let compras = 0
    try { compras = db.prepare("SELECT COUNT(*) AS c FROM site_compras WHERE status='aprovado' AND date(aprovado_em,'-3 hours') >= ?").get(ini).c } catch {}
    return { ...r, cadastros, compras, origens }
  }
  const ini30 = somaDias(hoje, -29)
  const porDia = new Map(db.prepare('SELECT dia, COUNT(*) AS pessoas, SUM(paginas) AS acessos FROM site_visitas WHERE dia >= ? GROUP BY dia').all(ini30).map(r => [r.dia, r]))
  const cadDia = new Map(db.prepare("SELECT date(created_at,'-3 hours') AS dia, COUNT(*) AS c FROM testes_gratis WHERE date(created_at,'-3 hours') >= ? GROUP BY 1").all(ini30).map(r => [r.dia, r.c]))
  const dias = []
  for (let i = 29; i >= 0; i--) {
    const d = somaDias(hoje, -i)
    const r = porDia.get(d) || {}
    dias.push({ dia: d, pessoas: r.pessoas || 0, acessos: r.acessos || 0, cadastros: cadDia.get(d) || 0 })
  }
  const desde = db.prepare('SELECT MIN(dia) AS d FROM site_visitas').get()?.d || null
  return { hoje: periodo(hoje), dias7: periodo(somaDias(hoje, -6)), dias30: periodo(ini30), por_dia: dias, desde }
}

function listarTestes() {
  sincronizarTestes()
  const hoje = hojeBR()
  const linhas = D.db.prepare(`
    SELECT g.id, g.tenant_id, g.nome, g.restaurante, g.telefone, g.email, g.dias, g.expira_em, g.status,
           g.convertido_em, g.created_at,
           g.msg_status, g.msg_em, g.msg_enviada_em, g.msg_erro,
           g.seq_enviados, g.seq_erro, g.meta_compra_em, g.meta_compra_erro, g.ia_teste,
           (g.senha_cifrada IS NOT NULL) AS tem_senha, t.voz_ativo,
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
    const { conteudo, salvo } = conteudoAtual()
    const teste = cfgTeste()
    res.setHeader('Cache-Control', 'no-cache')
    send(res, 200, {
      ok: true,
      conteudo,
      personalizado: !!salvo,
      atualizado_em: salvo?.updated_at || null,
      teste: { ativo: teste.ativo, dias: teste.dias },
      compra: infoCompra(teste),
      download_url: downloadUrl(teste)
    })
    return true
  }

  // ── Público: comprar o plano pelo site ────────────────
  if (metodo === 'POST' && upath === '/api/site/compra') {
    let body
    try { body = await readBody(req, 20 * 1024) } catch { send(res, 400, { error: 'Dados inválidos' }); return true }
    const r = await iniciarCompra(req, body)
    send(res, r.http || 200, r.json)
    return true
  }
  if (metodo === 'GET' && upath === '/api/site/compra') {
    const q = new URL(req.url, 'http://x').searchParams
    const r = await statusCompra(parseInt(q.get('id'), 10) || 0, String(q.get('chave') || ''))
    res.setHeader('Cache-Control', 'no-store')
    send(res, r.http || 200, r.json)
    return true
  }

  // ── Público: contador de visitas do site ──────────────
  if (metodo === 'POST' && upath === '/api/site/visita') {
    let body = {}
    try { body = await readBody(req, 2048) } catch {}
    registrarVisita(req, body)
    send(res, 200, { ok: true })
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
      const usado = emailJaUsado(email)
      if (usado === 'conta') {
        send(res, 409, { error: 'Este e-mail já tem uma conta. Entre no painel com ele.', campo: 'email', login_url: gestorUrl(cfg) }); return true
      }
      if (usado === 'teste') {
        send(res, 409, { error: 'Este e-mail já foi usado em um teste grátis. Use outro e-mail ou fale com a gente pelo WhatsApp.', campo: 'email' }); return true
      }
      const provedor = await conferirProvedorEmail(email)
      if (provedor) { send(res, 400, { error: provedor.error, campo: 'email', sugestao: provedor.sugestao }); return true }
      if (db.prepare("SELECT id FROM testes_gratis WHERE telefone=? AND status='ativo'").get(telefone)) {
        send(res, 409, { error: 'Já existe um teste em andamento com este WhatsApp.', campo: 'telefone', login_url: gestorUrl(cfg) }); return true
      }
      const doIp = db.prepare("SELECT COUNT(*) AS c FROM testes_gratis WHERE ip=? AND created_at >= datetime('now','-1 day')").get(ip).c
      if (doIp >= 3) { send(res, 429, { error: 'Muitas contas criadas a partir desta conexão hoje. Fale com a gente pelo WhatsApp.' }); return true }
      const doDia = db.prepare("SELECT COUNT(*) AS c FROM testes_gratis WHERE created_at >= datetime('now','-1 day')").get().c
      if (doDia >= cfg.limite_dia) { send(res, 429, { error: 'As vagas de teste de hoje acabaram. Fale com a gente pelo WhatsApp para liberar a sua.' }); return true }

      const txtMeta = (v, re, max) => { const t = String(v || '').trim().slice(0, max); return re.test(t) ? t : '' }
      const meta = {
        fbp: txtMeta(body.fbp, /^fb\.\d\.\d+\.\d+$/, 80),
        fbc: txtMeta(body.fbc, /^fb\.\d\.\d+\.[\w-]+$/, 300),
        ev_id: txtMeta(body.ev_id, /^[\w-]{8,64}$/, 64),
        url: txtMeta(body.url, /^https?:\/\/[^\s"'<>]+$/i, 500),
        ua: String(req.headers['user-agent'] || '').slice(0, 400)
      }
      const conta = criarContaTeste({ nome, restaurante, telefone, email, senha, ip, dias: cfg.dias, cfg, meta })
      // Mesmo cadastro que o pixel do navegador registrou, agora pelo servidor (mesmo ID: a Meta conta uma vez só)
      setImmediate(() => {
        const l = db.prepare('SELECT * FROM testes_gratis WHERE tenant_id=?').get(conta.tenantId)
        if (l) enviarEventoMeta('CompleteRegistration', l, { event_id: meta.ev_id || undefined, custom_data: { content_name: 'Teste grátis EstimaFood', status: 'true' } })
          .then(r => { if (!r.ok && !/não configurado/.test(r.error)) D.log('⚠️', 'Cadastro não enviado para a Meta:', r.error) })
      })
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
    const { conteudo, salvo, migrado } = conteudoAtual()
    send(res, 200, {
      conteudo,
      personalizado: !!salvo,
      migrado,
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
    if (conteudo && typeof conteudo === 'object' && !conteudo.versao) conteudo.versao = PADRAO.versao || 1
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
    let visitas = null
    try { visitas = resumoVisitas() } catch (e) { D.log('⚠️', 'Visitas do site:', e.message) }
    let compras = []
    try { compras = listarCompras() } catch (e) { D.log('⚠️', 'Compras do site:', e.message) }
    send(res, 200, { ...listarTestes(), config: cfgParaPainel(cfg), hoje: hojeBR(), visitas, compras, compra: infoCompra(cfg) })
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
    if (body.seq_ativa !== undefined) novo.seq_ativa = body.seq_ativa === true
    if (body.seq && typeof body.seq === 'object') {
      novo.seq = { ...atual.seq }
      for (const k of SEQ_ETAPAS) {
        if (body.seq[k] === undefined) continue
        const txt = String(body.seq[k] || '').replace(/\r/g, '').trim()
        if (txt.length > 1500) { send(res, 400, { error: 'Cada mensagem do acompanhamento pode ter até 1500 caracteres' }); return true }
        novo.seq[k] = txt || SEQ_PADRAO[k]
      }
    }
    if (body.meta_pixel !== undefined) {
      const px = String(body.meta_pixel || '').replace(/\D/g, '')
      if (px && !/^\d{6,20}$/.test(px)) { send(res, 400, { error: 'O ID do pixel tem só números' }); return true }
      novo.meta_pixel = px || META_PIXEL_PADRAO
    }
    if (body.meta_token !== undefined && !String(body.meta_token).startsWith('••••')) {
      const tk = String(body.meta_token || '').trim()
      if (tk && !/^[A-Za-z0-9_-]{30,600}$/.test(tk)) { send(res, 400, { error: 'Token da API de Conversões inválido: copie de novo no Gerenciador de Eventos' }); return true }
      novo.meta_token = tk
    } else novo.meta_token = atual.meta_token
    if (body.meta_teste !== undefined) novo.meta_teste = String(body.meta_teste || '').trim().slice(0, 40)
    if (body.ia_teste !== undefined) novo.ia_teste = body.ia_teste === true
    if (body.compra_ativa !== undefined) novo.compra_ativa = body.compra_ativa === true
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
    setImmediate(() => registrarCompra(linha.tenant_id, valor, 'ativado pelo admin'))
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

module.exports = { init, api, processarMensagens, registrarCompra, pagamentoDoSite, _internals: { chaveEmail, conferirProvedorEmail, dominioRecebeEmail, etapaDevida, enviarEventoMeta } }

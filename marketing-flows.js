// ═══════════════════════════════════════════════════════
// MARKETING-FLOWS.JS — Fluxos de mensagens (estilo n8n simplificado) sobre a WuzAPI
// ═══════════════════════════════════════════════════════
// Um fluxo = grafo de nos ligados por setas (como no n8n), com um no de gatilho no comeco.
//   Gatilho:  palavra-chave (o cliente escreve ou clica num botao/lista) ou disparo manual.
//   Nos de mensagem: texto, imagem, video, audio (mensagem de voz gravada na hora), documento,
//             botoes (resposta, link, copiar, ligar), lista, espera.
//   Nos de logica: aguardar resposta do cliente, condicao (se/senao), definir variavel.
//   Nos de acao: notificar atendente, pausar robo, chamar outro fluxo.
//   Ramificacao: cada botao de "resposta" e cada linha de lista tem a propria saida no grafo.
//   Fluxos antigos (lista de passos) sao convertidos em grafo automaticamente ao carregar.
// Disparo em massa: fila persistida no banco, com intervalo aleatorio entre contatos.
// Tudo sai pelo WhatsApp de Suporte e Vendas (suporte-vendas-bot.js) e exige o canal WuzAPI ativo.
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFile, spawnSync } = require('child_process')
const wuzapi = require('./wuzapi')

let D = null // { db, log, bot, uploadsDir }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const clamp = (n, a, b) => Math.min(b, Math.max(a, n))
const rand = (a, b) => a + Math.random() * (b - a)

// ==================== Inicializacao e tabelas ====================

function init(deps) {
  if (D) return
  D = deps
  D.db.exec(`
    CREATE TABLE IF NOT EXISTS mkt_flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      ativo INTEGER NOT NULL DEFAULT 0,
      gatilho TEXT NOT NULL DEFAULT '{}',
      opcoes TEXT NOT NULL DEFAULT '{}',
      passos TEXT NOT NULL DEFAULT '[]',
      execucoes INTEGER NOT NULL DEFAULT 0,
      ultima_execucao TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mkt_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flow_id INTEGER, telefone TEXT, origem TEXT, status TEXT, erro TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mkt_disparos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flow_id INTEGER, flow_nome TEXT, publico TEXT,
      total INTEGER DEFAULT 0, enviados INTEGER DEFAULT 0, falhas INTEGER DEFAULT 0,
      status TEXT DEFAULT 'fila', motivo TEXT,
      int_min INTEGER DEFAULT 15, int_max INTEGER DEFAULT 40, descadastro INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')), finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS mkt_disparo_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      disparo_id INTEGER, telefone TEXT, nome TEXT,
      status TEXT DEFAULT 'pendente', erro TEXT, enviado_em TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mkt_itens_disparo ON mkt_disparo_itens(disparo_id, status);
    CREATE INDEX IF NOT EXISTS idx_mkt_itens_tel ON mkt_disparo_itens(telefone);
    CREATE TABLE IF NOT EXISTS mkt_optout (
      telefone TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)
  try { D.db.exec('ALTER TABLE mkt_flows ADD COLUMN grafo TEXT') } catch { /* coluna ja existe */ }
  D.db.exec(`
    CREATE TABLE IF NOT EXISTS mkt_sessoes (
      telefone TEXT PRIMARY KEY,
      flow_id INTEGER,
      custom TEXT NOT NULL DEFAULT '{}',
      aguardando TEXT, var_nome TEXT, tipo_entrada TEXT, msg_invalida TEXT,
      tentativas INTEGER NOT NULL DEFAULT 0,
      expira_em INTEGER,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `)
  try {
    D.db.prepare("DELETE FROM mkt_logs WHERE created_at < datetime('now','-90 day')").run()
    D.db.prepare("DELETE FROM mkt_sessoes WHERE updated_at < datetime('now','-7 day')").run()
  } catch {}
  setInterval(() => varrerTimeouts().catch(e => D.log?.('⚠️', `Marketing: varredura de tempo limite: ${e.message}`)), 30000).unref()
  // Disparos que estavam rodando quando o servidor caiu voltam para a fila
  try {
    D.db.prepare("UPDATE mkt_disparos SET status='fila' WHERE status='rodando'").run()
    if (D.db.prepare("SELECT 1 FROM mkt_disparos WHERE status='fila'").get()) setTimeout(iniciarWorker, 15000)
  } catch {}
}

// ==================== Utilitarios ====================

// telefone com DDI 55 (numero com ate 11 digitos ganha o 55; cuidado: DDD 55 existe)
function n55(phone) {
  const n = String(phone || '').replace(/\D/g, '')
  if (!n) return ''
  return n.length <= 11 ? `55${n}` : n
}

const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const json = (s, dflt) => { try { return JSON.parse(s) } catch { return dflt } }

function saudacao() {
  const h = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }), 10)
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

function agoraSP() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  return { hora: d.getHours(), dia: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'][d.getDay()] }
}

function formatCnpj(d) {
  return String(d).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

// {{nome}} · {{nome|cliente}} (valor padrao depois da barra)
function aplicarVars(texto, vars) {
  return String(texto ?? '').replace(/\{\{\s*([a-z][a-z0-9_]*)\s*(?:\|([^}]*))?\}\}/gi, (_, k, padrao) => {
    const v = vars[k.toLowerCase()]
    return (v !== undefined && v !== null && String(v) !== '') ? String(v) : (padrao ?? '').trim()
  }).replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+|[ \t]+$/gm, '').trim() // limpa espacos quando a variavel fica vazia
}

// ---- Nome do contato: lista > agenda do WhatsApp > nome do perfil > cadastro do cliente ----
const nomesPush = new Map() // tel -> nome do perfil visto no webhook
let _agenda = { at: 0, idx: null }

function ult8(tel) { return String(tel).replace(/\D/g, '').slice(-8) }

async function nomeDaAgenda(tel) {
  try {
    if (!_agenda.idx || Date.now() - _agenda.at > 10 * 60 * 1000) {
      const token = D.bot.wuzToken()
      if (!token) return ''
      const contatos = await wuzapi.getContacts(token)
      const idx = new Map()
      for (const [jid, c] of Object.entries(contatos || {})) {
        const nome = String(c?.FullName || c?.FirstName || c?.BusinessName || '').trim()
        const push = String(c?.PushName || '').trim()
        const d = String(jid).split('@')[0].split(':')[0]
        if (!/^\d{8,}$/.test(d)) continue
        idx.set(ult8(d), { agenda: nome, push })
      }
      _agenda = { at: Date.now(), idx }
    }
    return _agenda.idx.get(ult8(tel)) || null
  } catch (e) {
    _agenda = { at: Date.now() - 9 * 60 * 1000, idx: _agenda.idx || new Map() } // tenta de novo em ~1 min
    return null
  }
}

async function resolverNome(tel, { nome, pushName } = {}) {
  if (nome) return String(nome).trim()
  if (pushName) nomesPush.set(tel, pushName)
  const c = await nomeDaAgenda(tel)
  return (c?.agenda || nomesPush.get(tel) || pushName || c?.push || '').trim()
}

function montarVars(tel, extra = {}) {
  let tenant = null
  try { tenant = D.bot.tenantByPhone(tel) } catch {}
  let g = {}
  try { g = D.bot.config() || {} } catch {}
  const nome = String(extra.nome || tenant?.nome || '').trim() // extra.nome ja vem resolvido (agenda/perfil)
  const pix = String(g.cobranca_pix_chave || '').replace(/\D/g, '')
  return {
    nome,
    primeiro_nome: nome.split(/\s+/)[0] || '',
    loja: tenant?.nome || '',
    telefone: tel,
    saudacao: saudacao(),
    cliente: tenant ? 'sim' : 'nao',
    hora: String(agoraSP().hora),
    dia_semana: agoraSP().dia,
    pix: pix.length === 14 ? formatCnpj(pix) : '',
    pix_chave: pix,
    link_demo: g.bot_demo_link || ''
  }
}

// ==================== Midia (arquivos dos fluxos) ====================

const MIDIA_TIPOS = {
  imagem:    { exts: { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }, max: 10 * 1024 * 1024 },
  video:     { exts: { mp4: 'video/mp4', mov: 'video/quicktime', '3gp': 'video/3gpp', webm: 'video/webm' }, max: 32 * 1024 * 1024 },
  audio:     { exts: { ogg: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', webm: 'audio/webm' }, max: 16 * 1024 * 1024 },
  documento: { exts: { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip' }, max: 32 * 1024 * 1024 }
}
const ARQUIVO_RE = /^[a-f0-9]{16}\.[a-z0-9]{2,5}$/

function pastaMidia() {
  const dir = path.join(D.uploadsDir, 'marketing')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function mimeDoArquivo(nome) {
  const ext = path.extname(nome).slice(1).toLowerCase()
  for (const t of Object.values(MIDIA_TIPOS)) if (t.exts[ext]) return t.exts[ext]
  return 'application/octet-stream'
}

let _ffmpeg
function temFfmpeg() {
  if (_ffmpeg === undefined) {
    try { _ffmpeg = spawnSync('ffmpeg', ['-version'], { timeout: 5000 }).status === 0 } catch { _ffmpeg = false }
  }
  return _ffmpeg
}

function exec(cmd, args, timeout = 90000) {
  return new Promise((ok, err) => execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (e, out) => e ? err(e) : ok(String(out))))
}

async function duracaoSegundos(file) {
  try {
    const out = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], 15000)
    const s = parseFloat(out.trim())
    return isFinite(s) ? Math.round(s) : 0
  } catch { return 0 }
}

// Salva o arquivo enviado pelo painel. Audio vira OGG/Opus (formato das mensagens de voz do WhatsApp)
function lerBinario(req, limite) {
  return new Promise((ok, err) => {
    const partes = []; let total = 0
    req.on('data', c => {
      total += c.length
      if (total > limite) { err(new Error('Arquivo grande demais')); req.destroy(); return }
      partes.push(c)
    })
    req.on('end', () => ok(Buffer.concat(partes)))
    req.on('error', err)
  })
}

async function salvarMidia({ nome, dados, tipo, buffer }) {
  const cfgTipo = MIDIA_TIPOS[tipo]
  if (!cfgTipo) throw new Error('Tipo de mídia inválido')
  let buf
  if (buffer) buf = buffer
  else {
    const m = /^data:[^;,]*(?:;[^,]*)?;base64,([\s\S]+)$/.exec(String(dados || ''))
    if (!m) throw new Error('Arquivo inválido')
    buf = Buffer.from(m[1], 'base64')
  }
  if (!buf.length) throw new Error('Arquivo vazio')
  if (buf.length > cfgTipo.max) throw new Error(`Arquivo grande demais (máximo ${Math.round(cfgTipo.max / 1048576)} MB para ${tipo})`)
  const ext = path.extname(String(nome || '')).slice(1).toLowerCase()
  if (!cfgTipo.exts[ext]) throw new Error(`Formato .${ext || '?'} não aceito para ${tipo}. Aceitos: ${Object.keys(cfgTipo.exts).join(', ')}`)

  const dir = pastaMidia()
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
  let arquivo = `${hash}.${ext}`
  let fpath = path.join(dir, arquivo)
  fs.writeFileSync(fpath, buf)
  let aviso = null, convertido = false, segundos = 0

  if (tipo === 'audio') {
    if (temFfmpeg()) {
      const saida = `${hash}.ogg`
      const spath = path.join(dir, saida)
      const tmp = path.join(dir, `${hash}.tmp.ogg`)
      try {
        await exec('ffmpeg', ['-y', '-i', fpath, '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-application', 'voip', tmp])
        if (fpath !== spath) fs.unlinkSync(fpath)
        fs.renameSync(tmp, spath)
        arquivo = saida; fpath = spath; convertido = true
      } catch (e) {
        try { fs.unlinkSync(tmp) } catch {}
        aviso = 'Não consegui converter o áudio; ele será enviado como está.'
      }
      segundos = await duracaoSegundos(fpath)
    } else if (ext !== 'ogg' && ext !== 'opus') {
      aviso = 'O servidor não tem ffmpeg: o áudio será enviado sem conversão e pode não aparecer como mensagem gravada. Use um arquivo .ogg (opus) ou instale o ffmpeg.'
    }
  }
  return { arquivo, nome: String(nome).slice(0, 120), tipo, bytes: fs.statSync(fpath).size, segundos, convertido, aviso }
}

const _cacheMidia = new Map()
function carregarMidia(ref, tipo) {
  const r = String(ref || '').trim()
  if (!r) throw new Error('Passo sem arquivo ou link de mídia')
  if (/^https?:\/\//i.test(r)) return { valor: r, mime: null }
  if (!ARQUIVO_RE.test(r)) throw new Error('Arquivo de mídia inválido')
  const fpath = path.join(pastaMidia(), r)
  if (!fs.existsSync(fpath)) throw new Error('Arquivo de mídia não encontrado no servidor (envie de novo no fluxo)')
  const st = fs.statSync(fpath)
  const chave = `${r}:${st.mtimeMs}`
  let hit = _cacheMidia.get(chave)
  if (!hit) {
    const mime = mimeDoArquivo(r)
    hit = { valor: `data:${mime};base64,${fs.readFileSync(fpath).toString('base64')}`, mime }
    if (st.size <= 20 * 1024 * 1024) {
      if (_cacheMidia.size >= 4) _cacheMidia.delete(_cacheMidia.keys().next().value)
      _cacheMidia.set(chave, hit)
    }
  }
  return hit
}

// ==================== Validacao / normalizacao do fluxo (grafo) ====================

const TIPOS_MSG = ['texto', 'imagem', 'video', 'audio', 'documento', 'botoes', 'lista', 'carrossel', 'espera']
const TIPOS_NO = [...TIPOS_MSG, 'aguardar', 'condicao', 'definir_var', 'notificar', 'pausar_robo', 'chamar_fluxo']
const NOME_NO = { gatilho: 'Gatilho', texto: 'Texto', imagem: 'Imagem', video: 'Vídeo', audio: 'Áudio', documento: 'Documento', botoes: 'Botões', lista: 'Lista', carrossel: 'Carrossel', espera: 'Espera', aguardar: 'Aguardar resposta', condicao: 'Condição', definir_var: 'Definir variável', notificar: 'Notificar atendente', pausar_robo: 'Pausar robô', chamar_fluxo: 'Chamar outro fluxo' }
const OPS = ['igual', 'contem', 'comeca', 'termina', 'regex', 'numero', 'email', 'telefone', 'maior', 'menor', 'vazio', 'preenchido']
const ENTRADAS = ['texto', 'numero', 'email', 'telefone']
const str = (v, max) => String(v ?? '').trim().slice(0, max)

function nomeVar(v, dflt = 'resposta') {
  const n = norm(v).replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[0-9]+/, '').slice(0, 30)
  return n || dflt
}

function sanitizarBotao(b) {
  const tipo = ['resposta', 'link', 'copiar', 'ligar'].includes(b?.tipo) ? b.tipo : 'resposta'
  return { tipo, titulo: str(b?.titulo, 20), valor: str(b?.valor, 500) }
}

function sanitizarPasso(p) {
  if (!p || !TIPOS_MSG.includes(p.tipo)) return null
  const out = { tipo: p.tipo }
  switch (p.tipo) {
    case 'texto':
      out.texto = str(p.texto, 4000); break
    case 'imagem': case 'video':
      out.midia = str(p.midia, 500); out.nome = str(p.nome, 120); out.legenda = str(p.legenda, 1000); break
    case 'audio':
      out.midia = str(p.midia, 500); out.nome = str(p.nome, 120)
      out.gravado = p.gravado !== false; out.segundos = clamp(parseInt(p.segundos, 10) || 0, 0, 600); break
    case 'documento':
      out.midia = str(p.midia, 500); out.nome = str(p.nome, 120); out.legenda = str(p.legenda, 1000); break
    case 'botoes':
      out.texto = str(p.texto, 1000); out.rodape = str(p.rodape, 60)
      out.midia = str(p.midia, 500); out.nome = str(p.nome, 120)
      out.botoes = (Array.isArray(p.botoes) ? p.botoes : []).slice(0, 3).map(sanitizarBotao); break
    case 'lista':
      out.titulo = str(p.titulo, 60); out.texto = str(p.texto, 1000); out.rodape = str(p.rodape, 60)
      out.botao_texto = str(p.botao_texto, 20) || 'Ver opções'
      out.secoes = (Array.isArray(p.secoes) ? p.secoes : []).slice(0, 5).map(s => ({
        titulo: str(s?.titulo, 24) || 'Opções',
        linhas: (Array.isArray(s?.linhas) ? s.linhas : []).slice(0, 10).map(l => ({
          titulo: str(l?.titulo, 24), descricao: str(l?.descricao, 72), valor: str(l?.valor, 200)
        }))
      })); break
    case 'carrossel':
      out.intervalo = clamp(parseInt(p.intervalo, 10) || 2, 1, 10)
      out.modo = p.modo === 'sequencia' ? 'sequencia' : 'auto'
      out.intro = str(p.intro, 1000)
      out.cartoes = (Array.isArray(p.cartoes) ? p.cartoes : []).slice(0, 10).map(k => ({
        midia: str(k?.midia, 500), nome: str(k?.nome, 120), texto: str(k?.texto, 1000), rodape: str(k?.rodape, 60),
        botoes: (Array.isArray(k?.botoes) ? k.botoes : []).slice(0, 3).map(sanitizarBotao)
      })); break
    case 'espera':
      out.segundos = clamp(parseInt(p.segundos, 10) || 1, 1, 120); break
  }
  return out
}

function sanitizarCfg(tipo, c = {}) {
  if (TIPOS_MSG.includes(tipo)) { const { tipo: _t, ...cfg } = sanitizarPasso({ ...c, tipo }); return cfg }
  switch (tipo) {
    case 'aguardar':
      return {
        variavel: nomeVar(c.variavel), tipo_entrada: ENTRADAS.includes(c.tipo_entrada) ? c.tipo_entrada : 'texto',
        msg_invalida: str(c.msg_invalida, 300), timeout_min: clamp(parseInt(c.timeout_min, 10) || 30, 1, 1440)
      }
    case 'condicao':
      return {
        casos: (Array.isArray(c.casos) ? c.casos : []).slice(0, 8).map(k => ({
          variavel: nomeVar(k?.variavel), op: OPS.includes(k?.op) ? k.op : 'igual', valor: str(k?.valor, 200)
        }))
      }
    case 'definir_var':
      return { variavel: nomeVar(c.variavel, 'valor'), valor: str(c.valor, 500) }
    case 'notificar':
      return { texto: str(c.texto, 1000) }
    case 'chamar_fluxo':
      return { fluxo: parseInt(c.fluxo, 10) || null }
    default:
      return {}
  }
}

// Saidas (portas) de cada no. O editor visual usa a mesma regra.
function portasDe(tipo, cfg = {}) {
  switch (tipo) {
    case 'botoes':
      return [
        ...(cfg.botoes || []).map((b, j) => b.tipo === 'resposta' ? { id: 'b' + j, label: b.titulo || 'Botão' } : null).filter(Boolean),
        { id: 'out', label: 'Sempre continuar' }
      ]
    case 'carrossel':
      return [
        ...(cfg.cartoes || []).flatMap((k, i) => (k.botoes || []).map((b, j) => b.tipo === 'resposta' ? { id: `k${i}b${j}`, label: `Cartão ${i + 1}: ${b.titulo || 'Botão'}` } : null).filter(Boolean)),
        { id: 'out', label: 'Sempre continuar' }
      ]
    case 'lista': {
      const rows = []; let k = 0
      for (const s of cfg.secoes || []) for (const l of s.linhas || []) rows.push({ id: 'l' + (k++), label: l.titulo || 'Linha' })
      return [...rows, { id: 'out', label: 'Sempre continuar' }]
    }
    case 'aguardar': return [{ id: 'out', label: 'Resposta recebida' }, { id: 'timeout', label: 'Sem resposta' }]
    case 'condicao': return [...(cfg.casos || []).map((k, i) => ({ id: 'c' + i, label: `${k.variavel} ${k.op} ${k.valor}`.trim() })), { id: 'else', label: 'Senão' }]
    case 'chamar_fluxo': return []
    case 'gatilho': return [{ id: 'out', label: 'Início' }]
    default: return [{ id: 'out', label: 'Próximo' }]
  }
}

function sanitizarGrafo(g) {
  const nodes = [], ids = new Set()
  for (const n of (Array.isArray(g?.nodes) ? g.nodes : []).slice(0, 80)) {
    const id = String(n?.id || '')
    if (!/^[a-z0-9]{1,20}$/i.test(id) || ids.has(id)) continue
    const tipo = id === 'inicio' ? 'gatilho' : n.tipo
    if (tipo !== 'gatilho' && !TIPOS_NO.includes(tipo)) continue
    ids.add(id)
    nodes.push({
      id, tipo, x: clamp(Math.round(Number(n.x) || 0), -5000, 8000), y: clamp(Math.round(Number(n.y) || 0), -5000, 8000),
      cfg: tipo === 'gatilho' ? {} : sanitizarCfg(tipo, n.cfg)
    })
  }
  if (!ids.has('inicio')) nodes.unshift({ id: 'inicio', tipo: 'gatilho', x: 60, y: 140, cfg: {} })
  const porNo = new Map(nodes.map(n => [n.id, n]))
  const edges = new Map()
  for (const e of (Array.isArray(g?.edges) ? g.edges : []).slice(0, 300)) {
    const de = porNo.get(String(e?.de)), para = porNo.get(String(e?.para))
    if (!de || !para || para.id === 'inicio') continue
    const porta = String(e?.porta || 'out')
    if (!portasDe(de.tipo, de.cfg).some(p => p.id === porta)) continue
    edges.set(`${de.id}|${porta}`, { de: de.id, porta, para: para.id }) // uma seta por saida
  }
  return { nodes, edges: [...edges.values()] }
}

// Fluxos antigos (lista de passos) -> grafo em cadeia. Botoes/linhas que abriam outro fluxo viram "Chamar outro fluxo".
function passosParaGrafo(passos) {
  const nodes = [{ id: 'inicio', tipo: 'gatilho', x: 60, y: 140, cfg: {} }], edges = []
  let prev = 'inicio'
  ;(Array.isArray(passos) ? passos : []).forEach((p, k) => {
    if (!p || !TIPOS_MSG.includes(p.tipo)) return
    const id = 'n' + (k + 1), { tipo, ...cfg } = p
    const x = 380 + k * 320
    nodes.push({ id, tipo, x, y: 140, cfg })
    edges.push({ de: prev, porta: 'out', para: id })
    prev = id
    let extra = 0
    const ramo = (porta, fluxo) => {
      const cid = `c${k + 1}x${porta}`
      nodes.push({ id: cid, tipo: 'chamar_fluxo', x, y: 420 + extra++ * 130, cfg: { fluxo } })
      edges.push({ de: id, porta, para: cid })
    }
    if (tipo === 'botoes') (p.botoes || []).forEach((b, j) => { if (b.tipo === 'resposta' && b.fluxo) ramo('b' + j, b.fluxo) })
    if (tipo === 'lista') { let i = 0; for (const s of p.secoes || []) for (const l of s.linhas || []) { if (l.fluxo) ramo('l' + i, l.fluxo); i++ } }
  })
  return { nodes, edges }
}

function sanitizarFluxo(b) {
  const nome = str(b?.nome, 80)
  if (!nome) throw new Error('Dê um nome para o fluxo')
  const g = b?.gatilho || {}
  const gatilho = {
    tipo: g.tipo === 'manual' ? 'manual' : 'palavra',
    palavras: [...new Set((Array.isArray(g.palavras) ? g.palavras : String(g.palavras || '').split(/[\n,;]+/)).map(x => str(x, 60)).filter(Boolean))].slice(0, 30),
    modo: ['contem', 'exata', 'inicia'].includes(g.modo) ? g.modo : 'contem',
    publico: ['todos', 'clientes', 'nao_clientes'].includes(g.publico) ? g.publico : 'todos'
  }
  const o = b?.opcoes || {}
  const opcoes = {
    presenca: o.presenca !== false,
    ignorar_pausa: !!o.ignorar_pausa,
    pausar_robo: !!o.pausar_robo,
    aceita_meu_envio: !!o.aceita_meu_envio,
    cooldown: clamp(parseInt(o.cooldown, 10) || 0, 0, 86400)
  }
  const grafo = sanitizarGrafo(b?.grafo || passosParaGrafo(b?.passos))
  return { nome, gatilho, opcoes, grafo }
}

// Nos alcancaveis a partir do gatilho
function alcancaveis(grafo) {
  const viz = new Map()
  for (const e of grafo.edges) { if (!viz.has(e.de)) viz.set(e.de, []); viz.get(e.de).push(e.para) }
  const vistos = new Set(['inicio']), fila = ['inicio']
  while (fila.length) for (const v of viz.get(fila.shift()) || []) if (!vistos.has(v)) { vistos.add(v); fila.push(v) }
  return vistos
}

// Erros que impedem ativar / executar (rascunho incompleto pode ser salvo, mas nao ativado)
function problemas(f) {
  const erros = []
  const g = f.grafo || { nodes: [], edges: [] }
  if (f.gatilho.tipo === 'palavra' && !f.gatilho.palavras.length) erros.push('Informe pelo menos uma palavra-chave no gatilho')
  if (!g.edges.some(e => e.de === 'inicio')) erros.push('Ligue o gatilho ao primeiro nó do fluxo')
  const vivos = alcancaveis(g)
  let n = 0
  for (const no of g.nodes) {
    if (no.id === 'inicio' || !vivos.has(no.id)) continue
    n++
    const c = no.cfg, rot = `${NOME_NO[no.tipo]} (nó ${n})`
    if (no.tipo === 'texto' && !c.texto) erros.push(`${rot}: texto vazio`)
    if (['imagem', 'video', 'audio', 'documento'].includes(no.tipo) && !c.midia) erros.push(`${rot}: falta o arquivo`)
    if (no.tipo === 'botoes') {
      if (!c.texto) erros.push(`${rot}: texto da mensagem vazio`)
      if (!c.botoes.length) erros.push(`${rot}: adicione pelo menos um botão`)
      c.botoes.forEach((b, j) => {
        if (!b.titulo) erros.push(`${rot}, botão ${j + 1}: falta o título`)
        if (b.tipo === 'link' && !/^(https?:\/\/\S+|{{link_demo}})$/i.test(b.valor)) erros.push(`${rot}, botão ${j + 1}: o link precisa começar com http:// ou https://`)
        if (b.tipo === 'copiar' && !b.valor) erros.push(`${rot}, botão ${j + 1}: falta o texto a copiar`)
        if (b.tipo === 'ligar' && b.valor.replace(/\D/g, '').length < 8) erros.push(`${rot}, botão ${j + 1}: telefone inválido`)
      })
    }
    if (no.tipo === 'carrossel') {
      if (!c.cartoes.length) erros.push(`${rot}: adicione pelo menos um cartão`)
      c.cartoes.forEach((k, i) => {
        const r2 = `${rot}, cartão ${i + 1}`
        if (!k.texto) erros.push(`${r2}: texto vazio`)
        if (!k.botoes.length) erros.push(`${r2}: adicione pelo menos um botão`)
        k.botoes.forEach((b, j) => {
          if (!b.titulo) erros.push(`${r2}, botão ${j + 1}: falta o título`)
          if (b.tipo === 'link' && !/^(https?:\/\/\S+|{{link_demo}})$/i.test(b.valor)) erros.push(`${r2}, botão ${j + 1}: o link precisa começar com http:// ou https://`)
          if (b.tipo === 'copiar' && !b.valor) erros.push(`${r2}, botão ${j + 1}: falta o texto a copiar`)
          if (b.tipo === 'ligar' && b.valor.replace(/\D/g, '').length < 8) erros.push(`${r2}, botão ${j + 1}: telefone inválido`)
        })
      })
    }
    if (no.tipo === 'lista') {
      const linhas = c.secoes.flatMap(s => s.linhas)
      if (!c.texto) erros.push(`${rot}: texto da lista vazio`)
      if (!linhas.length) erros.push(`${rot}: a lista precisa de pelo menos uma linha`)
      if (linhas.length > 10) erros.push(`${rot}: a lista aceita no máximo 10 linhas no total`)
      if (linhas.some(l => !l.titulo)) erros.push(`${rot}: há linha da lista sem título`)
    }
    if (no.tipo === 'condicao' && !c.casos.length) erros.push(`${rot}: adicione pelo menos uma regra`)
    if (no.tipo === 'notificar' && !c.texto) erros.push(`${rot}: escreva o texto do aviso`)
    if (no.tipo === 'chamar_fluxo' && !c.fluxo) erros.push(`${rot}: escolha o fluxo`)
    if (no.tipo === 'definir_var' && !c.valor) erros.push(`${rot}: informe o valor`)
  }
  if (n === 0) erros.push('O fluxo não tem nenhum nó ligado ao gatilho')
  return erros
}

// ==================== Persistencia ====================

let _cache = null
const invalidar = () => { _cache = null }

function rowToFlow(r) {
  if (!r) return null
  let grafo = json(r.grafo, null)
  const legado = !grafo
  if (!grafo) grafo = sanitizarGrafo(passosParaGrafo(json(r.passos, [])))
  return {
    id: r.id, nome: r.nome, ativo: !!r.ativo, legado,
    gatilho: json(r.gatilho, {}), opcoes: json(r.opcoes, {}), grafo,
    execucoes: r.execucoes || 0, ultima_execucao: r.ultima_execucao || null,
    created_at: r.created_at, updated_at: r.updated_at
  }
}

const listarFluxos = () => D.db.prepare('SELECT * FROM mkt_flows ORDER BY id DESC').all().map(rowToFlow)
const obterFluxo = id => rowToFlow(D.db.prepare('SELECT * FROM mkt_flows WHERE id=?').get(id))

function fluxosAtivos() {
  if (!_cache) _cache = D.db.prepare('SELECT * FROM mkt_flows WHERE ativo=1 ORDER BY id').all().map(rowToFlow)
  return _cache
}

function salvarFluxo(id, body) {
  const f = sanitizarFluxo(body)
  if (id) {
    const atual = obterFluxo(id)
    if (!atual) throw new Error('Fluxo não encontrado')
    // Se ficou incompleto, desativa para nao disparar pela metade
    const ativo = atual.ativo && !problemas(f).length ? 1 : 0
    D.db.prepare("UPDATE mkt_flows SET nome=?, gatilho=?, opcoes=?, grafo=?, passos='[]', ativo=?, updated_at=datetime('now') WHERE id=?")
      .run(f.nome, JSON.stringify(f.gatilho), JSON.stringify(f.opcoes), JSON.stringify(f.grafo), ativo, id)
  } else {
    id = D.db.prepare("INSERT INTO mkt_flows (nome, gatilho, opcoes, grafo, passos, ativo) VALUES (?,?,?,?, '[]', 0)")
      .run(f.nome, JSON.stringify(f.gatilho), JSON.stringify(f.opcoes), JSON.stringify(f.grafo)).lastInsertRowid
  }
  invalidar()
  return obterFluxo(Number(id))
}

function definirAtivo(id, ativo) {
  const f = obterFluxo(id)
  if (!f) throw new Error('Fluxo não encontrado')
  if (ativo) {
    const erros = problemas(f)
    if (erros.length) throw new Error('Não dá para ativar: ' + erros.join('; '))
  }
  D.db.prepare("UPDATE mkt_flows SET ativo=?, updated_at=datetime('now') WHERE id=?").run(ativo ? 1 : 0, id)
  invalidar()
  return obterFluxo(id)
}

function duplicarFluxo(id) {
  const f = obterFluxo(id)
  if (!f) throw new Error('Fluxo não encontrado')
  return salvarFluxo(null, { ...f, nome: `${f.nome} (cópia)` })
}

function excluirFluxo(id) {
  const busy = D.db.prepare("SELECT 1 FROM mkt_disparos WHERE flow_id=? AND status IN ('fila','rodando')").get(id)
  if (busy) throw new Error('Este fluxo tem um disparo em andamento. Cancele o disparo antes de excluir.')
  D.db.prepare('DELETE FROM mkt_flows WHERE id=?').run(id)
  D.db.prepare('DELETE FROM mkt_sessoes WHERE flow_id=?').run(id)
  invalidar()
}

function registrarLog(flowId, tel, origem, status, erro) {
  try {
    D.db.prepare('INSERT INTO mkt_logs (flow_id, telefone, origem, status, erro) VALUES (?,?,?,?,?)').run(flowId, tel, origem, status, erro ? String(erro).slice(0, 300) : null)
  } catch {}
}

// ==================== Execucao dos passos ====================

const emExecucao = new Set()
const filas = new Map() // telefone -> { p, n }: gatilhos da mesma pessoa rodam um depois do outro
function enfileirar(tel, fn) {
  const cur = filas.get(tel) || { p: Promise.resolve(), n: 0 }
  if (cur.n >= 3) return Promise.resolve() // spam: descarta o excedente
  cur.n++
  cur.p = cur.p.catch(() => {}).then(fn).finally(() => { if (--cur.n <= 0) filas.delete(tel) })
  filas.set(tel, cur)
  return cur.p
}
const ultimoDisparo = new Map() // `${flowId}:${tel}` -> timestamp

function exigirCanal() {
  if (D.bot.provider() !== 'wuzapi') {
    throw new Error('O canal WuzAPI não está ativo. Configure em Saques PIX > WhatsApp de Suporte e Vendas.')
  }
}

async function presenca(tel, media, ms) {
  try {
    await D.bot.wuzRun(tel, (t, to) => wuzapi.sendPresence(t, to, media, 'composing'))
    await sleep(ms)
    await D.bot.wuzRun(tel, (t, to) => wuzapi.sendPresence(t, to, media, 'paused')).catch(() => {})
  } catch { /* presenca e cosmetica: nunca derruba o fluxo */ }
}

const enviou = id => { D.bot.rememberSent(id); return id }

function textoAlternativoBotoes(texto, botoes) {
  const linhas = botoes.map(b => b.tipo === 'link' ? `${b.titulo}: ${b.valor}`
    : b.tipo === 'copiar' ? `${b.titulo}:\n${b.valor}`
    : b.tipo === 'ligar' ? `${b.titulo}: ${b.valor}`
    : `Responda *${b.valorFinal || b.titulo}* para: ${b.titulo}`)
  return `${texto}\n\n${linhas.join('\n')}`
}

const carrosselOff = new Set()

async function executarPasso(p, tel, vars, opts) {
  const T = s => aplicarVars(s, vars)
  const run = fn => D.bot.wuzRun(tel, fn)

  switch (p.tipo) {
    case 'espera':
      await sleep(p.segundos * 1000)
      return

    case 'texto': {
      const texto = T(p.texto)
      if (opts.presenca) await presenca(tel, '', clamp(texto.length * 35, 700, 4000))
      enviou(await run((t, to) => wuzapi.sendText(t, to, texto)))
      return
    }

    case 'imagem': {
      const m = carregarMidia(p.midia, 'imagem')
      if (opts.presenca) await presenca(tel, '', 900)
      enviou(await run((t, to) => wuzapi.sendImage(t, to, m.valor, T(p.legenda))))
      return
    }

    case 'video': {
      const m = carregarMidia(p.midia, 'video')
      if (opts.presenca) await presenca(tel, '', 1200)
      enviou(await run((t, to) => wuzapi.sendVideo(t, to, m.valor, T(p.legenda))))
      return
    }

    case 'audio': {
      const m = carregarMidia(p.midia, 'audio')
      const gravado = p.gravado !== false
      // "gravando audio..." antes de mandar, com tempo proporcional a duracao
      if (opts.presenca && gravado) await presenca(tel, 'audio', clamp((p.segundos || 4) * 700, 2000, 9000))
      const ogg = /\.ogg$/i.test(String(p.midia)) || m.mime === 'audio/ogg'
      enviou(await run((t, to) => wuzapi.sendAudio(t, to, m.valor, {
        ptt: gravado, seconds: p.segundos || 0, mimetype: ogg ? 'audio/ogg; codecs=opus' : undefined
      })))
      return
    }

    case 'documento': {
      const m = carregarMidia(p.midia, 'documento')
      if (opts.presenca) await presenca(tel, '', 900)
      enviou(await run((t, to) => wuzapi.sendDocument(t, to, m.valor, p.nome || 'arquivo', T(p.legenda))))
      return
    }

    case 'botoes': {
      const texto = T(p.texto)
      const botoes = p.botoes.map((b, j) => {
        const titulo = T(b.titulo).slice(0, 20)
        const valor = T(b.valor)
        // Botao com seta no grafo: id do no+saida (o clique segue a ramificacao). Sem seta: a palavra vira mensagem
        // e pode acionar outro fluxo por palavra-chave.
        const id = b.tipo === 'resposta'
          ? ((opts.idBase && opts.temAresta && opts.temAresta('b' + j)) ? `${opts.idBase}_b${j}` : (valor || titulo))
          : `mkt_btn_${titulo}`
        return { tipo: b.tipo, titulo, valor, id, valorFinal: valor || titulo }
      }).filter(b => !(b.tipo === 'link' && !/^https?:\/\//i.test(b.valor)) && !(b.tipo === 'copiar' && !b.valor))
      if (!botoes.length) { // todos os botoes ficaram invalidos (ex: {{link_demo}} vazio): manda so o texto
        if (opts.presenca) await presenca(tel, '', clamp(texto.length * 25, 600, 3000))
        enviou(await run((t, to) => wuzapi.sendText(t, to, texto)))
        return
      }
      let imagem
      if (p.midia) { try { imagem = carregarMidia(p.midia, 'imagem').valor } catch {} }
      if (opts.presenca) await presenca(tel, '', clamp(texto.length * 25, 600, 3000))
      try {
        enviou(await run((t, to) => wuzapi.sendButtons(t, to, {
          text: texto, footer: T(p.rodape), image: imagem,
          buttons: botoes.map(b => ({
            id: b.id, text: b.titulo,
            type: b.tipo === 'link' ? 'url' : b.tipo === 'copiar' ? 'copy' : b.tipo === 'ligar' ? 'call' : 'reply',
            url: b.valor, copyCode: b.valor, phone: b.valor.replace(/\D/g, '')
          }))
        })))
      } catch (e) {
        D.log?.('⚠️', `Marketing: botões falharam para ${tel}, enviando texto: ${e.message}`)
        enviou(await run((t, to) => wuzapi.sendText(t, to, textoAlternativoBotoes(texto, botoes))))
      }
      return
    }

    case 'carrossel': {
      // Modo automatico: tenta o carrossel nativo (se a WuzAPI tiver o endpoint e todos os cartoes tiverem imagem);
      // se falhar, envia cada cartao como uma mensagem com imagem no topo e botoes, em sequencia.
      if (p.modo !== 'sequencia' && !carrosselOff.has('nativo') && p.cartoes.every(k => k.midia)) {
        try {
          const cards = p.cartoes.map((k, i) => ({
            image: carregarMidia(k.midia, 'imagem').valor, text: T(k.texto), footer: T(k.rodape),
            buttons: k.botoes.map((b, j) => {
              const titulo = T(b.titulo).slice(0, 20), valor = T(b.valor)
              const id = b.tipo === 'resposta'
                ? ((opts.idBase && opts.temAresta && opts.temAresta(`k${i}b${j}`)) ? `${opts.idBase}_k${i}_b${j}` : (valor || titulo))
                : `mkt_btn_${titulo}`
              return { id, text: titulo, type: b.tipo === 'link' ? 'url' : b.tipo === 'copiar' ? 'copy' : b.tipo === 'ligar' ? 'call' : 'reply', url: valor, copyCode: valor, phone: valor.replace(/\D/g, '') }
            }).filter(b => !(b.type === 'url' && !/^https?:\/\//i.test(b.url)) && !(b.type === 'copy' && !b.copyCode))
          }))
          if (cards.every(c => c.buttons.length)) {
            if (opts.presenca) await presenca(tel, '', 1500)
            enviou(await run((t, to) => wuzapi.sendCarousel(t, to, { text: T(p.intro), cards })))
            return
          }
        } catch (e) {
          // 404/405 = a WuzAPI nao tem o endpoint: nao insiste por 30 minutos
          if (e.status === 404 || e.status === 405) { carrosselOff.add('nativo'); setTimeout(() => carrosselOff.delete('nativo'), 30 * 60 * 1000).unref?.() }
          D.log?.('⚠️', `Marketing: carrossel nativo indisponível (${e.message}); enviando cartões em sequência`)
        }
      }
      for (let i = 0; i < p.cartoes.length; i++) {
        const k = p.cartoes[i]
        await executarPasso({ tipo: 'botoes', texto: k.texto, rodape: k.rodape, midia: k.midia, nome: k.nome, botoes: k.botoes }, tel, vars, {
          ...opts,
          idBase: opts.idBase ? `${opts.idBase}_k${i}` : '',
          temAresta: porta => !!(opts.temAresta && opts.temAresta(`k${i}${porta}`))
        })
        if (i < p.cartoes.length - 1) await sleep((p.intervalo || 2) * 1000)
      }
      return
    }

    case 'lista': {
      let k = 0
      const secoes = p.secoes.map(s => ({
        title: T(s.titulo),
        rows: s.linhas.map(l => {
          const i = k++
          return {
            id: (opts.idBase && opts.temAresta && opts.temAresta('l' + i)) ? `${opts.idBase}_l${i}` : (T(l.valor) || T(l.titulo)),
            title: T(l.titulo).slice(0, 24), description: T(l.descricao).slice(0, 72)
          }
        })
      }))
      const texto = T(p.texto)
      if (opts.presenca) await presenca(tel, '', clamp(texto.length * 25, 600, 3000))
      try {
        enviou(await run((t, to) => wuzapi.sendList(t, to, {
          title: T(p.titulo) || undefined, text: texto, footer: T(p.rodape),
          buttonText: T(p.botao_texto) || 'Ver opções', sections: secoes
        })))
      } catch (e) {
        D.log?.('⚠️', `Marketing: lista falhou para ${tel}, enviando texto: ${e.message}`)
        const linhas = secoes.flatMap(s => s.rows).map(r => `- ${r.title}${r.description ? `: ${r.description}` : ''}`)
        enviou(await run((t, to) => wuzapi.sendText(t, to, `${texto}\n\n${linhas.join('\n')}`)))
      }
      return
    }
  }
}

// ---- Sessao do contato (variaveis coletadas + espera de resposta) ----
const lerSessao = tel => D.db.prepare('SELECT * FROM mkt_sessoes WHERE telefone=?').get(tel) || null
function salvarSessao(tel, flowId, custom, aguardo) {
  D.db.prepare(`INSERT INTO mkt_sessoes (telefone, flow_id, custom, aguardando, var_nome, tipo_entrada, msg_invalida, tentativas, expira_em, updated_at)
    VALUES (?,?,?,?,?,?,?,0,?,datetime('now'))
    ON CONFLICT(telefone) DO UPDATE SET flow_id=excluded.flow_id, custom=excluded.custom, aguardando=excluded.aguardando,
      var_nome=excluded.var_nome, tipo_entrada=excluded.tipo_entrada, msg_invalida=excluded.msg_invalida,
      tentativas=0, expira_em=excluded.expira_em, updated_at=datetime('now')`)
    .run(tel, flowId, JSON.stringify(custom || {}), aguardo?.no || null, aguardo?.variavel || null, aguardo?.tipo_entrada || null,
      aguardo?.msg_invalida || null, aguardo ? Date.now() + aguardo.timeout_min * 60000 : null)
}
const limparAguardo = tel => D.db.prepare("UPDATE mkt_sessoes SET aguardando=NULL, expira_em=NULL WHERE telefone=?").run(tel)

function mapaGrafo(flow) {
  const nodes = new Map(flow.grafo.nodes.map(n => [n.id, n]))
  const arestas = new Map(flow.grafo.edges.map(e => [`${e.de}|${e.porta}`, e.para]))
  return { nodes, prox: (id, porta) => arestas.get(`${id}|${porta}`) || null, tem: (id, porta) => arestas.has(`${id}|${porta}`) }
}

function avaliarCaso(caso, vars) {
  const bruto = String(vars[caso.variavel] ?? '')
  const v = norm(bruto)
  const alvo = norm(aplicarVars(caso.valor, vars))
  switch (caso.op) {
    case 'igual': return v === alvo
    case 'contem': return alvo !== '' && v.includes(alvo)
    case 'comeca': return alvo !== '' && v.startsWith(alvo)
    case 'termina': return alvo !== '' && v.endsWith(alvo)
    case 'regex': try { return new RegExp(caso.valor, 'i').test(bruto) } catch { return false }
    case 'numero': return validarEntrada('numero', bruto)
    case 'email': return validarEntrada('email', bruto)
    case 'telefone': return validarEntrada('telefone', bruto)
    case 'maior': return parseFloat(bruto.replace(',', '.')) > parseFloat(String(alvo).replace(',', '.'))
    case 'menor': return parseFloat(bruto.replace(',', '.')) < parseFloat(String(alvo).replace(',', '.'))
    case 'vazio': return v === ''
    case 'preenchido': return v !== ''
  }
  return false
}

function validarEntrada(tipo, texto) {
  const t = String(texto || '').trim()
  switch (tipo) {
    case 'numero': return /^-?\d+([.,]\d+)?$/.test(t)
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)
    case 'telefone': { const d = t.replace(/\D/g, ''); return d.length >= 10 && d.length <= 13 }
    default: return t !== ''
  }
}

// Executa um no. Retorna { porta } para seguir, ou { fim: true } para parar este caminho.
async function executarNo(flow, g, no, tel, ctx, prof) {
  const c = no.cfg || {}
  if (TIPOS_MSG.includes(no.tipo)) {
    await executarPasso({ tipo: no.tipo, ...c }, tel, ctx.vars, {
      presenca: ctx.presenca, idBase: `mkt_g_${flow.id}_${no.id}`, temAresta: porta => g.tem(no.id, porta)
    })
    return { porta: 'out' }
  }
  switch (no.tipo) {
    case 'aguardar':
      salvarSessao(tel, flow.id, ctx.custom, { no: no.id, variavel: c.variavel, tipo_entrada: c.tipo_entrada, msg_invalida: c.msg_invalida, timeout_min: c.timeout_min })
      ctx.salvo = true
      return { fim: true }
    case 'condicao': {
      const i = (c.casos || []).findIndex(k => avaliarCaso(k, ctx.vars))
      return { porta: i >= 0 ? 'c' + i : 'else' }
    }
    case 'definir_var': {
      const v = aplicarVars(c.valor, ctx.vars)
      ctx.custom[c.variavel] = v; ctx.vars[c.variavel] = v
      return { porta: 'out' }
    }
    case 'notificar':
      try { await D.bot.notificar(aplicarVars(c.texto, ctx.vars)) } catch (e) { D.log?.('⚠️', `Marketing: aviso ao atendente falhou: ${e.message}`) }
      return { porta: 'out' }
    case 'pausar_robo':
      D.bot.pausar(tel)
      return { porta: 'out' }
    case 'chamar_fluxo': {
      const alvo = obterFluxo(c.fluxo)
      if (!alvo) throw new Error('O fluxo chamado não existe mais')
      if (prof >= 5) throw new Error('Fluxos chamando fluxos em excesso')
      await correr(alvo, tel, ctx, mapaGrafo(alvo).prox('inicio', 'out'), prof + 1)
      return { fim: true }
    }
  }
  return { fim: true }
}

// Segue o grafo a partir de um no ate acabar o caminho (ou parar esperando o cliente).
async function correr(flow, tel, ctx, noId, prof = 0) {
  const g = mapaGrafo(flow)
  let cur = noId
  while (cur) {
    if (++ctx.passos > 100) throw new Error('O fluxo entrou em repetição (mais de 100 passos seguidos)')
    const no = g.nodes.get(cur)
    if (!no) break
    const r = await executarNo(flow, g, no, tel, ctx, prof)
    if (r.fim) break
    cur = g.prox(no.id, r.porta)
  }
}

async function novoCtx(flow, tel, { nome = '', pushName = '', custom = {} } = {}) {
  const vars = montarVars(tel, { nome: await resolverNome(tel, { nome, pushName }) })
  Object.assign(vars, custom)
  return { vars, custom: { ...custom }, presenca: flow.opcoes?.presenca !== false, passos: 0, salvo: false }
}

// Envolve uma corrida: trava o telefone, guarda variaveis, registra log
async function rodar(flow, tel, origem, fn) {
  exigirCanal()
  emExecucao.add(tel)
  try {
    const ctx = await fn()
    if (!ctx.salvo && Object.keys(ctx.custom).length) salvarSessao(tel, flow.id, ctx.custom, null)
    D.db.prepare("UPDATE mkt_flows SET execucoes=execucoes+1, ultima_execucao=datetime('now') WHERE id=?").run(flow.id)
    registrarLog(flow.id, tel, origem, 'ok')
    if (flow.opcoes?.pausar_robo) D.bot.pausar(tel)
    return ctx
  } catch (e) {
    registrarLog(flow.id, tel, origem, 'erro', e.message)
    throw e
  } finally {
    emExecucao.delete(tel)
  }
}

// Roda o fluxo desde o gatilho para um contato (palavra-chave, teste, disparo). Lanca erro se algum no falhar.
// Testes: o fluxo pode estar desativado, mas enquanto voce testa (ate 3 h) os cliques e respostas do numero de teste continuam valendo
const testes = new Map()
const emTeste = (id, tel) => (testes.get(`${id}:${tel}`) || 0) > Date.now() - 3 * 3600 * 1000
function fluxoVivo(id, tel) {
  const f = obterFluxo(id)
  return f && (f.ativo || emTeste(id, tel)) ? f : null
}

async function executarFluxo(flow, tel, { origem = 'palavra', nome = '', rodape = '', pushName = '' } = {}) {
  if (origem === 'teste') testes.set(`${flow.id}:${tel}`, Date.now())
  await rodar(flow, tel, origem, async () => {
    limparAguardo(tel)
    const ctx = await novoCtx(flow, tel, { nome, pushName })
    await correr(flow, tel, ctx, mapaGrafo(flow).prox('inicio', 'out'))
    if (rodape) {
      if (ctx.presenca) await presenca(tel, '', 700)
      enviou(await D.bot.wuzRun(tel, (t, to) => wuzapi.sendText(t, to, rodape)))
    }
    return ctx
  })
}

// Cliente clicou em um botao/linha de lista que tem seta no grafo
async function retomarClique(flow, tel, noId, porta, pushName) {
  const g = mapaGrafo(flow)
  const destino = g.prox(noId, porta)
  if (!destino) return
  const ses = lerSessao(tel)
  const custom = ses ? json(ses.custom, {}) : {}
  await rodar(flow, tel, 'botao', async () => {
    limparAguardo(tel)
    const ctx = await novoCtx(flow, tel, { pushName, custom })
    await correr(flow, tel, ctx, destino)
    return ctx
  })
}

// Cliente respondeu a um "Aguardar resposta". Retorna true se a mensagem foi consumida.
function tratarResposta(ses, texto, tel, pushName) {
  const flow = obterFluxo(ses.flow_id)
  if (!flow || !(flow.ativo || emTeste(flow.id, tel))) { limparAguardo(tel); return false }
  if (!validarEntrada(ses.tipo_entrada || 'texto', texto)) {
    const tent = (ses.tentativas || 0) + 1
    if (tent >= 3) { limparAguardo(tel); return true }
    D.db.prepare('UPDATE mkt_sessoes SET tentativas=? WHERE telefone=?').run(tent, tel)
    const aviso = ses.msg_invalida || ({ numero: 'Envie apenas um número, por favor.', email: 'Esse e-mail parece inválido. Envie de novo, por favor.', telefone: 'Envie o telefone com DDD, por favor.' }[ses.tipo_entrada] || 'Não entendi. Pode enviar de novo?')
    D.bot.wuzRun(tel, (t, to) => wuzapi.sendText(t, to, aviso)).then(enviou).catch(() => {})
    return true
  }
  const g = mapaGrafo(flow)
  const custom = json(ses.custom, {})
  custom[ses.var_nome] = String(texto).trim().slice(0, 1000)
  const destino = g.prox(ses.aguardando, 'out')
  limparAguardo(tel)
  enfileirar(tel, () => rodar(flow, tel, 'resposta', async () => {
    const ctx = await novoCtx(flow, tel, { pushName, custom })
    await correr(flow, tel, ctx, destino)
    return ctx
  })).catch(e => D.log?.('⚠️', `Marketing: retomada após resposta falhou (${tel}): ${e.message}`))
  return true
}

// Tempo limite do "Aguardar resposta": segue a saida "Sem resposta" (se existir)
async function varrerTimeouts() {
  if (!D) return
  const vencidos = D.db.prepare('SELECT * FROM mkt_sessoes WHERE aguardando IS NOT NULL AND expira_em IS NOT NULL AND expira_em < ?').all(Date.now())
  for (const ses of vencidos) {
    limparAguardo(ses.telefone)
    const flow = fluxoVivo(ses.flow_id, ses.telefone)
    if (!flow) continue
    const destino = mapaGrafo(flow).prox(ses.aguardando, 'timeout')
    if (!destino) continue
    enfileirar(ses.telefone, () => rodar(flow, ses.telefone, 'tempo_limite', async () => {
      const ctx = await novoCtx(flow, ses.telefone, { custom: json(ses.custom, {}) })
      await correr(flow, ses.telefone, ctx, destino)
      return ctx
    })).catch(e => D.log?.('⚠️', `Marketing: tempo limite falhou (${ses.telefone}): ${e.message}`))
  }
}

// ==================== Gatilho: palavra-chave / clique ====================

const OPTOUT_RE = /^(sair|parar|stop|descadastrar|cancelar inscricao|nao quero receber)$/

function recebeuDisparoRecente(tel) {
  try {
    return !!D.db.prepare("SELECT 1 FROM mkt_disparo_itens WHERE telefone=? AND status='enviado' AND enviado_em >= datetime('now','-30 day') LIMIT 1").get(tel)
  } catch { return false }
}

function casaGatilho(flow, texto, fromMe) {
  const g = flow.gatilho || {}
  if (g.tipo !== 'palavra') return false
  const modo = fromMe ? 'exata' : g.modo
  return (g.palavras || []).some(pl => {
    const k = norm(pl)
    if (!k) return false
    if (modo === 'exata') return texto === k
    if (modo === 'inicia') return texto === k || texto.startsWith(k + ' ')
    return new RegExp(`(^|[^a-z0-9])${escRe(k)}($|[^a-z0-9])`).test(texto)
  })
}

// Chamado pelo bot a cada mensagem. Retorna true se um fluxo assumiu a conversa
// (nesse caso o robo de atendimento nao responde).
function onMessage(m, { fromMe = false } = {}) {
  try {
    if (!D || !m?.phone) return false
    const tel = n55(m.phone)
    const texto = norm(m.choiceId || m.text)
    if (!texto && !m.choiceId) return false
    if (m.hasImage && !m.text && !m.choiceId) return false

    // Descadastro: so vale para quem recebeu um disparo nos ultimos 30 dias
    if (!fromMe && !m.choiceId && OPTOUT_RE.test(texto) && recebeuDisparoRecente(tel)) {
      try { D.db.prepare('INSERT OR IGNORE INTO mkt_optout (telefone) VALUES (?)').run(tel) } catch {}
      D.bot.wuzRun(tel, (t, to) => wuzapi.sendText(t, to, 'Tudo certo, você não vai mais receber mensagens promocionais nossas.'))
        .then(enviou).catch(() => {})
      return true
    }

    // 1) Clique em botao/linha de lista que tem seta no grafo: segue a ramificacao
    const clique = /^mkt_g_(\d+)_([a-z0-9]+)_(?:(k\d+)_)?([bl]\d+)$/i.exec(String(m.choiceId || ''))
    if (clique && !fromMe) {
      const flow = fluxoVivo(Number(clique[1]), tel)
      if (!flow) return false
      if (m.paused && !flow.opcoes?.ignorar_pausa) return false
      enfileirar(tel, () => retomarClique(flow, tel, clique[2], (clique[3] || '') + clique[4], m.pushName || ''))
        .catch(e => D.log?.('⚠️', `Marketing: ramificação do fluxo "${flow.nome}" falhou (${tel}): ${e.message}`))
      return true
    }

    // 2) Estava aguardando a resposta do cliente
    if (!fromMe && !m.choiceId && m.text) {
      const ses = lerSessao(tel)
      if (ses?.aguardando) {
        if (ses.expira_em && ses.expira_em < Date.now()) limparAguardo(tel)
        else {
          const flow = fluxoVivo(ses.flow_id, tel)
          if (flow && m.paused && !flow.opcoes?.ignorar_pausa) return false
          return tratarResposta(ses, m.text, tel, m.pushName || '')
        }
      }
    }

    // 3) Botao de fluxos antigos (abria outro fluxo pelo id) e palavras-chave
    const ativos = fluxosAtivos()
    let escolhido = null
    const dir = /^mkt_flow_(\d+)$/.exec(String(m.choiceId || ''))
    if (dir) {
      escolhido = ativos.find(f => f.id === Number(dir[1])) || null
      if (!escolhido) return false
    } else {
      escolhido = ativos.find(f => casaGatilho(f, texto, fromMe) && (!fromMe || f.opcoes?.aceita_meu_envio)) || null
    }
    if (!escolhido) return false

    if (!dir) {
      let tenant = null
      try { tenant = D.bot.tenantByPhone(tel) } catch {}
      const pub = escolhido.gatilho.publico
      if (pub === 'clientes' && !tenant) return false
      if (pub === 'nao_clientes' && tenant) return false
    }
    if (m.paused && !escolhido.opcoes?.ignorar_pausa) return false

    const chave = `${escolhido.id}:${tel}`
    const cd = (escolhido.opcoes?.cooldown || 0) * 1000
    if (cd && Date.now() - (ultimoDisparo.get(chave) || 0) < cd) return true
    ultimoDisparo.set(chave, Date.now())
    if (ultimoDisparo.size > 5000) ultimoDisparo.delete(ultimoDisparo.keys().next().value)

    enfileirar(tel, () => executarFluxo(escolhido, tel, { origem: fromMe ? 'meu_envio' : (dir ? 'botao' : 'palavra'), pushName: m.pushName || '' }))
      .catch(e => D.log?.('⚠️', `Marketing: fluxo "${escolhido.nome}" falhou (${tel}): ${e.message}`))
    return true
  } catch (e) {
    D.log?.('⚠️', `Marketing onMessage: ${e.message}`)
    return false
  }
}

// ==================== Disparo em massa ====================

function contatosDoPublico(publico, texto) {
  const mapa = new Map()
  const add = (tel, nome) => {
    const t = n55(tel)
    if (t.length < 12 || t.length > 13) return
    if (!mapa.has(t)) mapa.set(t, String(nome || '').trim())
  }
  if (publico === 'lista') {
    for (const linha of String(texto || '').split(/\r?\n/)) {
      const [num, ...resto] = linha.split(/[;,\t]/)
      if (num && num.replace(/\D/g, '')) add(num, resto.join(' '))
    }
  } else if (publico === 'clientes_ativos' || publico === 'clientes_inativos') {
    const ativo = publico === 'clientes_ativos' ? 1 : 0
    const rows = D.db.prepare(`
      SELECT t.nome, t.telefone_cobranca, sc.store_whatsapp FROM tenants t
      LEFT JOIN store_config sc ON sc.tenant_id = t.id
      WHERE t.slug NOT IN ('_admin','_global','admin') AND COALESCE(t.ativo,1) = ?
    `).all(ativo)
    for (const r of rows) add(r.telefone_cobranca || r.store_whatsapp, r.nome)
  }
  const optout = new Set(D.db.prepare('SELECT telefone FROM mkt_optout').all().map(r => r.telefone))
  return [...mapa].filter(([t]) => !optout.has(t)).map(([telefone, nome]) => ({ telefone, nome }))
}

function criarDisparo({ flowId, publico, telefones, intMin, intMax, descadastro }) {
  const flow = obterFluxo(flowId)
  if (!flow) throw new Error('Fluxo não encontrado')
  const erros = problemas(flow)
  if (erros.length) throw new Error('O fluxo está incompleto: ' + erros.join('; '))
  exigirCanal()
  const contatos = contatosDoPublico(publico, telefones)
  if (!contatos.length) throw new Error('Nenhum contato válido encontrado para este público')
  if (contatos.length > 3000) throw new Error('Máximo de 3000 contatos por disparo')
  const a = clamp(parseInt(intMin, 10) || 15, 5, 600)
  const b = clamp(parseInt(intMax, 10) || 40, a, 900)
  const id = D.db.transaction(() => {
    const did = D.db.prepare('INSERT INTO mkt_disparos (flow_id, flow_nome, publico, total, int_min, int_max, descadastro) VALUES (?,?,?,?,?,?,?)')
      .run(flow.id, flow.nome, publico, contatos.length, a, b, descadastro ? 1 : 0).lastInsertRowid
    const ins = D.db.prepare('INSERT INTO mkt_disparo_itens (disparo_id, telefone, nome) VALUES (?,?,?)')
    for (const c of contatos) ins.run(did, c.telefone, c.nome)
    return did
  })()
  iniciarWorker()
  return { id: Number(id), total: contatos.length }
}

const listarDisparos = () => D.db.prepare('SELECT * FROM mkt_disparos ORDER BY id DESC LIMIT 30').all()

function mudarStatusDisparo(id, acao) {
  const d = D.db.prepare('SELECT * FROM mkt_disparos WHERE id=?').get(id)
  if (!d) throw new Error('Disparo não encontrado')
  if (acao === 'pausar' && ['fila', 'rodando'].includes(d.status)) {
    D.db.prepare("UPDATE mkt_disparos SET status='pausado', motivo='Pausado por você' WHERE id=?").run(id)
  } else if (acao === 'retomar' && d.status === 'pausado') {
    D.db.prepare("UPDATE mkt_disparos SET status='fila', motivo=NULL WHERE id=?").run(id)
    iniciarWorker()
  } else if (acao === 'cancelar' && !['concluido', 'cancelado'].includes(d.status)) {
    D.db.prepare("UPDATE mkt_disparos SET status='cancelado', finished_at=datetime('now') WHERE id=?").run(id)
    D.db.prepare("UPDATE mkt_disparo_itens SET status='cancelado' WHERE disparo_id=? AND status='pendente'").run(id)
  } else {
    throw new Error('Ação não permitida para o estado atual do disparo')
  }
}

let workerRodando = false
async function iniciarWorker() {
  if (workerRodando) return
  workerRodando = true
  try {
    for (;;) {
      const d = D.db.prepare("SELECT * FROM mkt_disparos WHERE status IN ('fila','rodando') ORDER BY id LIMIT 1").get()
      if (!d) break
      await rodarDisparo(d)
    }
  } catch (e) {
    D.log?.('⚠️', `Marketing: worker parou: ${e.message}`)
  } finally {
    workerRodando = false
    _cacheMidia.clear()
  }
}

async function rodarDisparo(d) {
  D.db.prepare("UPDATE mkt_disparos SET status='rodando' WHERE id=?").run(d.id)
  const flow = obterFluxo(d.flow_id)
  const fim = (status, motivo) => D.db.prepare("UPDATE mkt_disparos SET status=?, motivo=?, finished_at=datetime('now') WHERE id=?").run(status, motivo || null, d.id)
  if (!flow) return fim('cancelado', 'O fluxo foi excluído')
  const rodape = d.descadastro ? 'Para não receber mais mensagens nossas, responda SAIR.' : ''
  let falhasSeguidas = 0

  for (;;) {
    const atual = D.db.prepare('SELECT status FROM mkt_disparos WHERE id=?').get(d.id)
    if (!atual || atual.status !== 'rodando') return // pausado ou cancelado pelo painel
    const item = D.db.prepare("SELECT * FROM mkt_disparo_itens WHERE disparo_id=? AND status='pendente' ORDER BY id LIMIT 1").get(d.id)
    if (!item) return fim('concluido')

    if (D.db.prepare('SELECT 1 FROM mkt_optout WHERE telefone=?').get(item.telefone)) {
      D.db.prepare("UPDATE mkt_disparo_itens SET status='ignorado', erro='descadastrado' WHERE id=?").run(item.id)
      continue
    }
    try {
      await executarFluxo(flow, item.telefone, { origem: 'disparo', nome: item.nome, rodape })
      D.db.prepare("UPDATE mkt_disparo_itens SET status='enviado', enviado_em=datetime('now') WHERE id=?").run(item.id)
      D.db.prepare('UPDATE mkt_disparos SET enviados=enviados+1 WHERE id=?').run(d.id)
      falhasSeguidas = 0
    } catch (e) {
      D.db.prepare("UPDATE mkt_disparo_itens SET status='falhou', erro=? WHERE id=?").run(String(e.message).slice(0, 300), item.id)
      D.db.prepare('UPDATE mkt_disparos SET falhas=falhas+1 WHERE id=?').run(d.id)
      // Canal fora do ar / numero bloqueado: pausa em vez de queimar a lista inteira
      if (++falhasSeguidas >= 5) {
        D.db.prepare("UPDATE mkt_disparos SET status='pausado', motivo=? WHERE id=?").run('Pausado automaticamente: 5 falhas seguidas (' + String(e.message).slice(0, 120) + ')', d.id)
        return
      }
    }
    const restam = D.db.prepare("SELECT 1 FROM mkt_disparo_itens WHERE disparo_id=? AND status='pendente' LIMIT 1").get(d.id)
    if (restam) await sleep(rand(d.int_min, d.int_max) * 1000)
  }
}

// ==================== API do painel admin ====================
// Todas as rotas exigem sessao de super admin.

async function api(req, res, { upath, send, readBody, validarSessaoAdmin }) {
  if (!validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
  const sub = upath.slice('/api/admin/marketing'.length) || '/'
  const met = req.method
  let m
  try {
    if (met === 'GET' && sub === '/status') {
      const st = await D.bot.status().catch(e => ({ status: 'erro: ' + e.message }))
      send(res, 200, { canal: st.provider, conectado: st.status === 'connected', status: st.status, ffmpeg: temFfmpeg(), pix: !!D.bot.config().cobranca_pix_chave })
      return true
    }
    if (met === 'GET' && sub === '/fluxos') {
      send(res, 200, { fluxos: listarFluxos() }); return true
    }
    if (met === 'POST' && sub === '/fluxos') {
      const body = await readBody(req)
      send(res, 200, { ok: true, fluxo: salvarFluxo(body?.id ? Number(body.id) : null, body) }); return true
    }
    if ((m = /^\/fluxos\/(\d+)\/(ativar|desativar)$/.exec(sub)) && met === 'POST') {
      send(res, 200, { ok: true, fluxo: definirAtivo(Number(m[1]), m[2] === 'ativar') }); return true
    }
    if ((m = /^\/fluxos\/(\d+)\/duplicar$/.exec(sub)) && met === 'POST') {
      send(res, 200, { ok: true, fluxo: duplicarFluxo(Number(m[1])) }); return true
    }
    if ((m = /^\/fluxos\/(\d+)\/excluir$/.exec(sub)) && met === 'POST') {
      excluirFluxo(Number(m[1])); send(res, 200, { ok: true }); return true
    }
    if ((m = /^\/fluxos\/(\d+)\/testar$/.exec(sub)) && met === 'POST') {
      const body = await readBody(req)
      const flow = obterFluxo(Number(m[1]))
      if (!flow) { send(res, 404, { error: 'Fluxo não encontrado' }); return true }
      const erros = problemas(flow)
      if (erros.length) { send(res, 400, { error: 'O fluxo está incompleto: ' + erros.join('; ') }); return true }
      const tel = n55(body?.telefone)
      if (tel.length < 12 || tel.length > 13) { send(res, 400, { error: 'Informe o WhatsApp com DDD (ex: 85991234567)' }); return true }
      exigirCanal()
      executarFluxo(flow, tel, { origem: 'teste', nome: str(body?.nome, 60) }).catch(e => D.log?.('⚠️', `Marketing: teste falhou (${tel}): ${e.message}`))
      send(res, 200, { ok: true, mensagem: 'Teste iniciado. As mensagens chegam em instantes.' }); return true
    }
    if ((m = /^\/fluxos\/(\d+)\/disparar$/.exec(sub)) && met === 'POST') {
      const body = await readBody(req)
      const r = criarDisparo({
        flowId: Number(m[1]), publico: body?.publico, telefones: body?.telefones,
        intMin: body?.int_min, intMax: body?.int_max, descadastro: body?.descadastro !== false
      })
      send(res, 200, { ok: true, ...r }); return true
    }
    if (met === 'POST' && sub === '/contatos/previa') {
      const body = await readBody(req)
      const c = contatosDoPublico(body?.publico, body?.telefones)
      send(res, 200, { total: c.length, amostra: c.slice(0, 5) }); return true
    }
    if (met === 'GET' && sub === '/disparos') {
      send(res, 200, { disparos: listarDisparos() }); return true
    }
    if ((m = /^\/disparos\/(\d+)\/(pausar|retomar|cancelar)$/.exec(sub)) && met === 'POST') {
      mudarStatusDisparo(Number(m[1]), m[2]); send(res, 200, { ok: true }); return true
    }
    if (met === 'GET' && sub === '/logs') {
      const fid = parseInt(new URL(req.url, 'http://x').searchParams.get('fluxo'), 10)
      const rows = fid
        ? D.db.prepare('SELECT * FROM mkt_logs WHERE flow_id=? ORDER BY id DESC LIMIT 60').all(fid)
        : D.db.prepare('SELECT l.*, f.nome AS fluxo FROM mkt_logs l LEFT JOIN mkt_flows f ON f.id=l.flow_id ORDER BY l.id DESC LIMIT 60').all()
      send(res, 200, { logs: rows }); return true
    }
    if (met === 'POST' && sub.split('?')[0] === '/midia') {
      // Envio binario direto (application/octet-stream): sem base64, bem mais leve para foto de celular
      if (/octet-stream/i.test(req.headers['content-type'] || '')) {
        const q = new URL(req.url, 'http://x').searchParams
        const buffer = await lerBinario(req, 40 * 1024 * 1024)
        send(res, 200, { ok: true, ...(await salvarMidia({ nome: q.get('nome'), tipo: q.get('tipo'), buffer })) }); return true
      }
      const body = await readBody(req, 60 * 1024 * 1024)
      send(res, 200, { ok: true, ...(await salvarMidia(body || {})) }); return true
    }
    if ((m = /^\/midia\/([a-f0-9]{16}\.[a-z0-9]{2,5})$/.exec(sub)) && met === 'GET') {
      const fpath = path.join(pastaMidia(), m[1])
      if (!fs.existsSync(fpath)) { send(res, 404, { error: 'Arquivo não encontrado' }); return true }
      res.setHeader('Content-Type', mimeDoArquivo(m[1]))
      res.setHeader('Cache-Control', 'private, max-age=3600')
      res.writeHead(200)
      fs.createReadStream(fpath).pipe(res)
      return true
    }
    send(res, 404, { error: 'Rota não encontrada' })
  } catch (e) {
    send(res, 400, { error: e.message })
  }
  return true
}

module.exports = {
  init, api, onMessage,
  // uteis para testes
  _internals: { varrerTimeouts, sanitizarFluxo, sanitizarGrafo, passosParaGrafo, portasDe, problemas, casaGatilho, aplicarVars, norm, contatosDoPublico, executarFluxo, obterFluxo, salvarFluxo, criarDisparo, iniciarWorker, salvarMidia }
}

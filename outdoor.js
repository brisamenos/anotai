// OUTDOOR: rede de TVs em comércios, vendida separada do EstimaFood.
//
// - O admin cadastra os ANUNCIANTES (login, senha, valor negociado) e os
//   PONTOS (cada comércio com TV). Um ponto pode ser do próprio anunciante.
// - O admin escolhe em quais pontos cada anunciante aparece (contratos).
// - Quem sobe e troca os vídeos é a equipe, pelo admin. Cada vídeo passa na
//   TV do comércio do próprio anunciante (se ele tiver) e nos pontos escolhidos.
//   Ao substituir um vídeo, o antigo continua no ar até o novo ficar pronto e
//   depois é apagado de vez (banco e arquivo).
// - O anunciante entra em /outdoor com login e senha só para acompanhar: quais
//   vídeos estão no ar, onde passam e quantas vezes passaram.
// - A TV de um ponto mistura os vídeos do dono com os anúncios aprovados de
//   quem contratou aquele ponto, e conta quantas vezes cada anúncio passou.
// - Usa o mesmo app/página de TV, upload e compressão da TV Indoor.

const crypto = require('crypto')

let ctxBase = null
let tv = null // tv-indoor.js

const TAB = 'od_videos'

function agoraISO() { return new Date().toISOString() }
function hoje() {
  // dia no horário de Brasília (para o relatório de exibições)
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}

function senhaHash(senha) {
  const sal = crypto.randomBytes(16).toString('hex')
  const h = crypto.scryptSync(String(senha), sal, 32).toString('hex')
  return `scrypt$${sal}$${h}`
}
function senhaConfere(senha, guardada) {
  try {
    const [, sal, h] = String(guardada || '').split('$')
    if (!sal || !h) return false
    const calc = crypto.scryptSync(String(senha), sal, 32)
    return crypto.timingSafeEqual(calc, Buffer.from(h, 'hex'))
  } catch (e) { return false }
}

// Cria as tabelas (também chamado antes de restaurar um backup)
function criarTabelas(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS od_anunciantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    responsavel TEXT,
    telefone TEXT,
    email TEXT UNIQUE,
    senha_hash TEXT,
    valor_mensal REAL DEFAULT 0,
    dia_vencimento INTEGER,
    ativo INTEGER DEFAULT 1,
    observacoes TEXT,
    created_at TEXT
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS od_pontos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    endereco TEXT,
    anunciante_id INTEGER,
    anuncios_a_cada INTEGER DEFAULT 1,
    ativo INTEGER DEFAULT 1,
    created_at TEXT
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS od_contratos (
    anunciante_id INTEGER NOT NULL,
    ponto_id INTEGER NOT NULL,
    PRIMARY KEY (anunciante_id, ponto_id)
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS od_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anunciante_id INTEGER NOT NULL,
    titulo TEXT,
    arquivo TEXT,
    capa TEXT,
    tamanho INTEGER DEFAULT 0,
    duracao REAL DEFAULT 0,
    status TEXT DEFAULT 'processando',
    erro TEXT,
    original TEXT,
    ordem INTEGER DEFAULT 0,
    minha_tv INTEGER DEFAULT 1,
    rede TEXT DEFAULT 'nao',
    rede_motivo TEXT,
    rede_em TEXT,
    created_at TEXT
  )`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_od_videos_anunciante ON od_videos(anunciante_id)`)
  try { db.prepare('ALTER TABLE od_videos ADD COLUMN ativo INTEGER DEFAULT 1').run() } catch (e) { /* já existe */ }
  try { db.prepare('ALTER TABLE od_videos ADD COLUMN substitui_id INTEGER').run() } catch (e) { /* já existe */ }
  db.exec(`CREATE TABLE IF NOT EXISTS od_exibicoes (
    video_id INTEGER NOT NULL,
    ponto_id INTEGER NOT NULL,
    dia TEXT NOT NULL,
    qtd INTEGER DEFAULT 0,
    PRIMARY KEY (video_id, ponto_id, dia)
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS od_sessoes (
    token TEXT PRIMARY KEY,
    anunciante_id INTEGER NOT NULL,
    criado_em INTEGER
  )`)
}

function init(ctx, tvIndoor) {
  ctxBase = ctx
  tv = tvIndoor
  const { db } = ctx
  criarTabelas(db)
  tv.registrarOutdoor({ playlistDoPonto, registrarExibicao, aoFicarPronto })
  // Sessões com mais de 30 dias saem
  setInterval(() => { try { db.prepare('DELETE FROM od_sessoes WHERE criado_em < ?').run(Date.now() - 30 * 86400000) } catch (e) {} }, 3600000)
}

// ── TV de um ponto: vídeos do dono + anúncios aprovados de quem contratou ──
function itemTv(v) {
  return { id: -v.id, titulo: v.titulo || '', url: v.arquivo, tamanho: v.tamanho || 0, duracao: v.duracao || 0, hora_ini: '', hora_fim: '' }
}

function playlistDoPonto(pontoId) {
  const { db } = ctxBase
  const p = db.prepare('SELECT * FROM od_pontos WHERE id=?').get(pontoId)
  if (!p || !p.ativo) return { versao: 'off-' + pontoId, ativo: false, loja: { nome: p ? p.nome : '' }, videos: [] }
  const dono = p.anunciante_id ? db.prepare('SELECT * FROM od_anunciantes WHERE id=?').get(p.anunciante_id) : null
  const daCasa = (dono && dono.ativo) ? db.prepare(`SELECT * FROM od_videos WHERE anunciante_id=? AND status='pronto' AND minha_tv=1 AND COALESCE(ativo,1)=1 ORDER BY ordem, id`).all(dono.id) : []
  const anuncios = db.prepare(`SELECT v.* FROM od_videos v
      JOIN od_contratos c ON c.anunciante_id = v.anunciante_id AND c.ponto_id = ?
      JOIN od_anunciantes a ON a.id = v.anunciante_id AND a.ativo = 1
      WHERE v.status='pronto' AND v.rede='aprovado' AND COALESCE(v.ativo,1)=1 AND v.anunciante_id <> ?
      ORDER BY a.id, v.ordem, v.id`).all(pontoId, p.anunciante_id || 0)
  let seq = []
  const n = Math.max(1, Math.min(10, p.anuncios_a_cada || 1))
  if (!daCasa.length) seq = anuncios
  else if (!anuncios.length) seq = daCasa
  else {
    // A cada N vídeos da casa, 1 anúncio da rede (todos aparecem pelo menos uma vez)
    const voltas = Math.max(Math.ceil(daCasa.length / n), anuncios.length)
    for (let r = 0; r < voltas && seq.length < 300; r++) {
      for (let k = 0; k < n; k++) seq.push(daCasa[(r * n + k) % daCasa.length])
      seq.push(anuncios[r % anuncios.length])
    }
  }
  const lista = seq.map(itemTv)
  const versao = crypto.createHash('sha1').update(JSON.stringify(lista)).digest('hex').slice(0, 16)
  return { versao, ativo: true, loja: { nome: p.nome }, videos: lista }
}

// Vídeo novo ficou pronto: se ele substitui outro, o antigo sai de vez
function aoFicarPronto(id) {
  const { db, log } = ctxBase
  const v = db.prepare('SELECT * FROM od_videos WHERE id=?').get(id)
  if (!v || !v.substitui_id) return
  const velho = db.prepare('SELECT * FROM od_videos WHERE id=? AND anunciante_id=?').get(v.substitui_id, v.anunciante_id)
  db.prepare('UPDATE od_videos SET substitui_id=NULL, ordem=? WHERE id=?').run(velho ? velho.ordem : v.ordem, v.id)
  if (velho) { apagarVideo(db, velho); log('📺', `[OUTDOOR] vídeo ${velho.id} substituído pelo ${v.id} e apagado`) }
}

function registrarExibicao(videoId, pontoId) {
  const { db } = ctxBase
  db.prepare(`INSERT INTO od_exibicoes (video_id, ponto_id, dia, qtd) VALUES (?,?,?,1)
    ON CONFLICT(video_id, ponto_id, dia) DO UPDATE SET qtd = qtd + 1`).run(videoId, pontoId, hoje())
}

function exibicoesPorVideo(db, desde) {
  const m = new Map()
  for (const r of db.prepare('SELECT video_id, SUM(qtd) n FROM od_exibicoes WHERE dia >= ? GROUP BY video_id').all(desde)) m.set(r.video_id, r.n)
  return m
}
function diaHaDias(n) { return new Date(Date.now() - 3 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10) }

// ── Respostas ──
function videosDoAnunciante(db, aid) {
  const exib = exibicoesPorVideo(db, diaHaDias(30))
  return db.prepare('SELECT * FROM od_videos WHERE anunciante_id=? ORDER BY ordem, id').all(aid).map(v => {
    const pr = tv.progressoDe(TAB, v.id)
    return { id: v.id, titulo: v.titulo, arquivo: v.arquivo, capa: v.capa, tamanho: v.tamanho, duracao: v.duracao,
      status: v.status, erro: v.erro, minha_tv: v.minha_tv, rede: v.rede, rede_motivo: v.rede_motivo, ordem: v.ordem,
      ativo: v.ativo === 0 ? 0 : 1, substitui_id: v.substitui_id || null,
      progresso: pr.progresso, na_fila: v.status === 'processando' && pr.na_fila, exibicoes_30d: exib.get(v.id) || 0 }
  })
}

function pontosComTelas(db, where, args) {
  return db.prepare(`SELECT p.*, a.nome AS dono_nome FROM od_pontos p LEFT JOIN od_anunciantes a ON a.id = p.anunciante_id ${where} ORDER BY p.nome`).all(...args)
    .map(p => ({ ...p, telas: tv.telasDoPonto(p.id) }))
}

function painelAnunciante(db, aid) {
  const a = db.prepare('SELECT id, nome, responsavel, valor_mensal, dia_vencimento, ativo FROM od_anunciantes WHERE id=?').get(aid)
  const desde = diaHaDias(30)
  const contratados = db.prepare(`SELECT p.id, p.nome, p.endereco, p.ativo FROM od_contratos c JOIN od_pontos p ON p.id = c.ponto_id WHERE c.anunciante_id=? ORDER BY p.nome`).all(aid)
    .map(p => {
      const telas = tv.telasDoPonto(p.id)
      const n = db.prepare(`SELECT COALESCE(SUM(e.qtd),0) n FROM od_exibicoes e JOIN od_videos v ON v.id = e.video_id WHERE v.anunciante_id=? AND e.ponto_id=? AND e.dia >= ?`).get(aid, p.id, desde).n
      return { id: p.id, nome: p.nome, endereco: p.endereco, ativo: p.ativo, telas: telas.length, ligadas: telas.filter(t => t.online).length, exibicoes_30d: n }
    })
  return {
    anunciante: a,
    max: tv.MAX_VIDEOS,
    comprime: tv.temCompressor(),
    videos: videosDoAnunciante(db, aid),
    meus_pontos: pontosComTelas(db, 'WHERE p.anunciante_id = ?', [aid]),
    pontos_contratados: contratados
  }
}

function resumoAdmin(db) {
  const desde = diaHaDias(30)
  const exib = exibicoesPorVideo(db, desde)
  const anunciantes = db.prepare('SELECT id, nome, responsavel, telefone, email, valor_mensal, dia_vencimento, ativo, observacoes, created_at FROM od_anunciantes ORDER BY nome').all().map(a => {
    const vids = db.prepare('SELECT id, rede, status, ativo FROM od_videos WHERE anunciante_id=?').all(a.id)
    return { ...a,
      pontos: db.prepare('SELECT ponto_id FROM od_contratos WHERE anunciante_id=?').all(a.id).map(r => r.ponto_id),
      videos: vids.length,
      na_rede: vids.filter(v => v.rede === 'aprovado' && v.status === 'pronto' && v.ativo !== 0).length,
      aguardando: vids.filter(v => v.rede === 'aguardando').length,
      exibicoes_30d: vids.reduce((s, v) => s + (exib.get(v.id) || 0), 0) }
  })
  const pontos = pontosComTelas(db, '', []).map(p => ({ ...p,
    anunciantes: db.prepare('SELECT COUNT(*) n FROM od_contratos c JOIN od_anunciantes a ON a.id=c.anunciante_id AND a.ativo=1 WHERE c.ponto_id=?').get(p.id).n }))
  const no_ar = db.prepare(`SELECT COUNT(*) n FROM od_videos v JOIN od_anunciantes a ON a.id = v.anunciante_id AND a.ativo = 1 WHERE v.status='pronto' AND COALESCE(v.ativo,1)=1`).get().n
  const receita = anunciantes.filter(a => a.ativo).reduce((s, a) => s + (+a.valor_mensal || 0), 0)
  return { anunciantes, pontos, no_ar, receita_mensal: receita, comprime: tv.temCompressor(), max: tv.MAX_VIDEOS }
}

function limparTexto(v, max) { return String(v ?? '').trim().slice(0, max) }

function salvarContratos(db, aid, pontos) {
  if (!Array.isArray(pontos)) return
  const ids = [...new Set(pontos.map(Number).filter(n => n > 0))]
  db.transaction(() => {
    db.prepare('DELETE FROM od_contratos WHERE anunciante_id=?').run(aid)
    const ins = db.prepare('INSERT OR IGNORE INTO od_contratos (anunciante_id, ponto_id) SELECT ?, id FROM od_pontos WHERE id=?')
    ids.forEach(pid => ins.run(aid, pid))
  })()
}

function apagarVideo(db, v) {
  tv.tirarDaFila(TAB, v.id)
  db.prepare('DELETE FROM od_videos WHERE id=?').run(v.id)
  db.prepare('DELETE FROM od_exibicoes WHERE video_id=?').run(v.id)
  tv.apagarArquivosVideo(v)
}

function apagarTelasDoPonto(db, pid) { db.prepare('DELETE FROM tv_telas WHERE ponto_id=?').run(pid) }

function anuncianteDaSessao(req, db) {
  const auth = String(req.headers['authorization'] || '')
  const tok = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!tok) return null
  const s = db.prepare('SELECT * FROM od_sessoes WHERE token=?').get(tok)
  if (!s || Date.now() - s.criado_em > 30 * 86400000) return null
  const a = db.prepare('SELECT * FROM od_anunciantes WHERE id=?').get(s.anunciante_id)
  if (!a || !a.ativo) return null
  return a
}

function novaSessao(db, aid) {
  const token = crypto.randomBytes(24).toString('hex')
  db.prepare('INSERT INTO od_sessoes (token, anunciante_id, criado_em) VALUES (?,?,?)').run(token, aid, Date.now())
  return token
}

// ── Rotas ──────────────────────────────────────────────────────────────────
async function handle(req, res, ctx) {
  const { upath, params, db, send, readBody, log } = ctx
  if (!upath.startsWith('/api/outdoor/')) return false
  const ip = ctx.clientIp ? ctx.clientIp(req) : ''
  let m

  // ════════════ ADMIN ════════════
  if (upath.startsWith('/api/outdoor/admin/')) {
    if (!ctx.validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }

    if (req.method === 'GET' && upath === '/api/outdoor/admin/resumo') { send(res, 200, resumoAdmin(db)); return true }

    // Anunciantes
    if (req.method === 'POST' && upath === '/api/outdoor/admin/anunciantes') {
      const b = await readBody(req).catch(() => ({}))
      const nome = limparTexto(b.nome, 80), email = limparTexto(b.email, 120).toLowerCase(), senha = String(b.senha || '')
      if (!nome) { send(res, 400, { error: 'Informe o nome do anunciante.' }); return true }
      if (!/^\S+@\S+\.\S+$/.test(email)) { send(res, 400, { error: 'Informe um e-mail válido para o login.' }); return true }
      if (senha.length < 6) { send(res, 400, { error: 'A senha precisa ter pelo menos 6 caracteres.' }); return true }
      if (db.prepare('SELECT 1 FROM od_anunciantes WHERE email=?').get(email)) { send(res, 409, { error: 'Já existe um anunciante com esse e-mail.' }); return true }
      const r = db.prepare(`INSERT INTO od_anunciantes (nome, responsavel, telefone, email, senha_hash, valor_mensal, dia_vencimento, ativo, observacoes, created_at)
        VALUES (?,?,?,?,?,?,?,1,?,?)`).run(nome, limparTexto(b.responsavel, 80), limparTexto(b.telefone, 30), email, senhaHash(senha),
        Math.max(0, +b.valor_mensal || 0), Math.min(31, Math.max(1, parseInt(b.dia_vencimento, 10) || 10)), limparTexto(b.observacoes, 1000), agoraISO())
      const aid = r.lastInsertRowid
      if (b.criar_ponto_proprio) {
        db.prepare('INSERT INTO od_pontos (nome, endereco, anunciante_id, anuncios_a_cada, ativo, created_at) VALUES (?,?,?,1,1,?)')
          .run(nome, limparTexto(b.endereco, 200), aid, agoraISO())
      }
      salvarContratos(db, aid, b.pontos)
      log('📺', `[OUTDOOR] anunciante "${nome}" cadastrado`)
      send(res, 200, { ok: true, id: aid }); return true
    }
    if ((m = /^\/api\/outdoor\/admin\/anunciantes\/(\d+)$/.exec(upath))) {
      const aid = +m[1]
      const a = db.prepare('SELECT * FROM od_anunciantes WHERE id=?').get(aid)
      if (!a) { send(res, 404, { error: 'Anunciante não encontrado' }); return true }
      if (req.method === 'PATCH') {
        const b = await readBody(req).catch(() => ({}))
        const c = {}
        if (b.nome !== undefined) c.nome = limparTexto(b.nome, 80) || a.nome
        if (b.responsavel !== undefined) c.responsavel = limparTexto(b.responsavel, 80)
        if (b.telefone !== undefined) c.telefone = limparTexto(b.telefone, 30)
        if (b.email !== undefined) {
          const email = limparTexto(b.email, 120).toLowerCase()
          if (!/^\S+@\S+\.\S+$/.test(email)) { send(res, 400, { error: 'E-mail inválido.' }); return true }
          if (db.prepare('SELECT 1 FROM od_anunciantes WHERE email=? AND id<>?').get(email, aid)) { send(res, 409, { error: 'Já existe outro anunciante com esse e-mail.' }); return true }
          c.email = email
        }
        if (b.senha) {
          if (String(b.senha).length < 6) { send(res, 400, { error: 'A senha precisa ter pelo menos 6 caracteres.' }); return true }
          c.senha_hash = senhaHash(b.senha)
          db.prepare('DELETE FROM od_sessoes WHERE anunciante_id=?').run(aid)
        }
        if (b.valor_mensal !== undefined) c.valor_mensal = Math.max(0, +b.valor_mensal || 0)
        if (b.dia_vencimento !== undefined) c.dia_vencimento = Math.min(31, Math.max(1, parseInt(b.dia_vencimento, 10) || 10))
        if (b.observacoes !== undefined) c.observacoes = limparTexto(b.observacoes, 1000)
        if (b.ativo !== undefined) c.ativo = b.ativo ? 1 : 0
        const ks = Object.keys(c)
        if (ks.length) db.prepare(`UPDATE od_anunciantes SET ${ks.map(k => k + '=?').join(',')} WHERE id=?`).run(...ks.map(k => c[k]), aid)
        if (b.pontos !== undefined) salvarContratos(db, aid, b.pontos)
        send(res, 200, { ok: true }); return true
      }
      if (req.method === 'DELETE') {
        for (const v of db.prepare('SELECT * FROM od_videos WHERE anunciante_id=?').all(aid)) apagarVideo(db, v)
        for (const p of db.prepare('SELECT id FROM od_pontos WHERE anunciante_id=?').all(aid)) {
          apagarTelasDoPonto(db, p.id)
          db.prepare('DELETE FROM od_contratos WHERE ponto_id=?').run(p.id)
          db.prepare('DELETE FROM od_pontos WHERE id=?').run(p.id)
        }
        db.prepare('DELETE FROM od_contratos WHERE anunciante_id=?').run(aid)
        db.prepare('DELETE FROM od_sessoes WHERE anunciante_id=?').run(aid)
        db.prepare('DELETE FROM od_anunciantes WHERE id=?').run(aid)
        log('📺', `[OUTDOOR] anunciante "${a.nome}" excluído`)
        send(res, 200, { ok: true }); return true
      }
    }
    // Admin entra no painel do anunciante (para subir vídeo por ele, por exemplo)
    if ((m = /^\/api\/outdoor\/admin\/anunciantes\/(\d+)\/entrar$/.exec(upath)) && req.method === 'POST') {
      const a = db.prepare('SELECT id, ativo FROM od_anunciantes WHERE id=?').get(+m[1])
      if (!a) { send(res, 404, { error: 'Anunciante não encontrado' }); return true }
      if (!a.ativo) { send(res, 400, { error: 'Anunciante pausado. Reative para entrar no painel dele.' }); return true }
      send(res, 200, { token: novaSessao(db, a.id) }); return true
    }

    // Pontos
    if (req.method === 'POST' && upath === '/api/outdoor/admin/pontos') {
      const b = await readBody(req).catch(() => ({}))
      const nome = limparTexto(b.nome, 80)
      if (!nome) { send(res, 400, { error: 'Informe o nome do ponto.' }); return true }
      const dono = parseInt(b.anunciante_id, 10) || null
      const r = db.prepare('INSERT INTO od_pontos (nome, endereco, anunciante_id, anuncios_a_cada, ativo, created_at) VALUES (?,?,?,?,1,?)')
        .run(nome, limparTexto(b.endereco, 200), dono, Math.max(1, Math.min(10, parseInt(b.anuncios_a_cada, 10) || 1)), agoraISO())
      send(res, 200, { ok: true, id: r.lastInsertRowid }); return true
    }
    if ((m = /^\/api\/outdoor\/admin\/pontos\/(\d+)$/.exec(upath))) {
      const pid = +m[1]
      const p = db.prepare('SELECT * FROM od_pontos WHERE id=?').get(pid)
      if (!p) { send(res, 404, { error: 'Ponto não encontrado' }); return true }
      if (req.method === 'PATCH') {
        const b = await readBody(req).catch(() => ({}))
        const c = {}
        if (b.nome !== undefined) c.nome = limparTexto(b.nome, 80) || p.nome
        if (b.endereco !== undefined) c.endereco = limparTexto(b.endereco, 200)
        if (b.anunciante_id !== undefined) c.anunciante_id = parseInt(b.anunciante_id, 10) || null
        if (b.anuncios_a_cada !== undefined) c.anuncios_a_cada = Math.max(1, Math.min(10, parseInt(b.anuncios_a_cada, 10) || 1))
        if (b.ativo !== undefined) c.ativo = b.ativo ? 1 : 0
        const ks = Object.keys(c)
        if (ks.length) db.prepare(`UPDATE od_pontos SET ${ks.map(k => k + '=?').join(',')} WHERE id=?`).run(...ks.map(k => c[k]), pid)
        send(res, 200, { ok: true }); return true
      }
      if (req.method === 'DELETE') {
        apagarTelasDoPonto(db, pid)
        db.prepare('DELETE FROM od_contratos WHERE ponto_id=?').run(pid)
        db.prepare('DELETE FROM od_pontos WHERE id=?').run(pid)
        send(res, 200, { ok: true }); return true
      }
    }
    if ((m = /^\/api\/outdoor\/admin\/pontos\/(\d+)\/telas$/.exec(upath)) && req.method === 'POST') {
      const pid = +m[1]
      if (!db.prepare('SELECT 1 FROM od_pontos WHERE id=?').get(pid)) { send(res, 404, { error: 'Ponto não encontrado' }); return true }
      const b = await readBody(req).catch(() => ({}))
      const r = tv.vincularTela(b.codigo, { ponto_id: pid, nome: b.nome })
      if (r.erro) { send(res, r.status, { error: r.erro }); return true }
      send(res, 200, { ok: true }); return true
    }
    if ((m = /^\/api\/outdoor\/admin\/telas\/(\d+)$/.exec(upath))) {
      const t = db.prepare('SELECT id FROM tv_telas WHERE id=? AND ponto_id IS NOT NULL').get(+m[1])
      if (!t) { send(res, 404, { error: 'TV não encontrada' }); return true }
      if (req.method === 'PATCH') {
        const b = await readBody(req).catch(() => ({}))
        if (b.nome) db.prepare('UPDATE tv_telas SET nome=? WHERE id=?').run(limparTexto(b.nome, 60), t.id)
        if ([0, 90, 270].includes(+b.rotacao)) db.prepare('UPDATE tv_telas SET rotacao=? WHERE id=?').run(+b.rotacao, t.id)
        send(res, 200, { ok: true }); return true
      }
      if (req.method === 'DELETE') { db.prepare('DELETE FROM tv_telas WHERE id=?').run(t.id); send(res, 200, { ok: true }); return true }
    }

    // ── Vídeos: a equipe sobe e troca pelo admin ──
    if (req.method === 'GET' && upath === '/api/outdoor/admin/videos') {
      const aid = parseInt(params.get('anunciante_id'), 10)
      send(res, 200, { videos: aid ? videosDoAnunciante(db, aid) : [], max: tv.MAX_VIDEOS, comprime: tv.temCompressor() }); return true
    }
    if ((m = /^\/api\/outdoor\/admin\/anunciantes\/(\d+)\/upload\/(iniciar|[a-f0-9]{32}(?:\/concluir)?)$/.exec(upath)) && (req.method === 'POST' || req.method === 'PUT')) {
      const aid = +m[1]
      if (!db.prepare('SELECT 1 FROM od_anunciantes WHERE id=?').get(aid)) { send(res, 404, { error: 'Anunciante não encontrado' }); return true }
      const dono = `od:a${aid}`
      // Substituição não conta como vídeo a mais (o antigo sai quando o novo ficar pronto)
      const usados = db.prepare(`SELECT COUNT(*) n FROM od_videos WHERE anunciante_id=? AND status<>'erro' AND substitui_id IS NULL`).get(aid).n
      if (m[2] === 'iniciar') {
        const b = await readBody(req).catch(() => ({}))
        const r = tv.uploadIniciar(dono, b, b.substitui_id ? 0 : usados)
        send(res, r.status || 200, r.erro ? { error: r.erro } : r); return true
      }
      if (!m[2].endsWith('/concluir')) {
        const r = await tv.uploadParte(req, dono, m[2], params.get('offset'))
        send(res, r.status, r.corpo); return true
      }
      const b = await readBody(req).catch(() => ({}))
      const velho = b.substitui_id ? db.prepare('SELECT * FROM od_videos WHERE id=? AND anunciante_id=?').get(+b.substitui_id, aid) : null
      const r = tv.uploadConcluir(dono, m[2].slice(0, 32), velho ? 0 : usados)
      if (r.erro) { send(res, r.status, { error: r.erro }); return true }
      const ordem = velho ? velho.ordem : (db.prepare('SELECT MAX(ordem) m FROM od_videos WHERE anunciante_id=?').get(aid).m || 0) + 1
      const titulo = velho ? velho.titulo : r.titulo
      const ins = db.prepare(`INSERT INTO od_videos (anunciante_id, titulo, ordem, minha_tv, rede, ativo, substitui_id, status, original, rede_em, created_at)
        VALUES (?,?,?,1,'aprovado',1,?,'processando',?,?,?)`).run(aid, titulo, ordem, velho ? velho.id : null, r.original, agoraISO(), agoraISO())
      tv.enfileirar(ins.lastInsertRowid, TAB)
      log('📺', `[OUTDOOR] vídeo novo ${ins.lastInsertRowid} do anunciante ${aid}${velho ? ' (substitui o ' + velho.id + ')' : ''}`)
      send(res, 200, { ok: true, id: ins.lastInsertRowid }); return true
    }
    if (req.method === 'POST' && upath === '/api/outdoor/admin/videos/ordem') {
      const b = await readBody(req).catch(() => ({}))
      const ids = Array.isArray(b.ids) ? b.ids.map(Number) : []
      const up = db.prepare('UPDATE od_videos SET ordem=? WHERE id=?')
      db.transaction(() => ids.forEach((id, i) => up.run(i + 1, id)))()
      send(res, 200, { ok: true }); return true
    }
    if ((m = /^\/api\/outdoor\/admin\/videos\/(\d+)$/.exec(upath))) {
      const v = db.prepare('SELECT * FROM od_videos WHERE id=?').get(+m[1])
      if (!v) { send(res, 404, { error: 'Vídeo não encontrado' }); return true }
      if (req.method === 'PATCH') {
        const b = await readBody(req).catch(() => ({}))
        if (b.titulo !== undefined) db.prepare('UPDATE od_videos SET titulo=? WHERE id=?').run(limparTexto(b.titulo, 80) || v.titulo, v.id)
        if (b.ativo !== undefined) db.prepare('UPDATE od_videos SET ativo=? WHERE id=?').run(b.ativo ? 1 : 0, v.id)
        send(res, 200, { ok: true }); return true
      }
      if (req.method === 'DELETE') {
        if (tv.emProcessamento(TAB, v.id)) { send(res, 409, { error: 'Esse vídeo está sendo preparado agora. Espere terminar para apagar.' }); return true }
        apagarVideo(db, v)
        log('📺', `[OUTDOOR] vídeo ${v.id} apagado`)
        send(res, 200, { ok: true }); return true
      }
    }

    send(res, 404, { error: 'Rota não encontrada' }); return true
  }

  // ════════════ ANUNCIANTE ════════════
  if (req.method === 'POST' && upath === '/api/outdoor/login') {
    if (!ctx.checkRateLimit('od-login:' + ip, 10, 15 * 60 * 1000)) { send(res, 429, { error: 'Muitas tentativas. Aguarde 15 minutos.' }); return true }
    const b = await readBody(req).catch(() => ({}))
    const a = db.prepare('SELECT * FROM od_anunciantes WHERE email=?').get(limparTexto(b.email, 120).toLowerCase())
    if (!a || !senhaConfere(b.senha, a.senha_hash)) { send(res, 401, { error: 'E-mail ou senha incorretos.' }); return true }
    if (!a.ativo) { send(res, 403, { error: 'Seu acesso está pausado. Fale com a nossa equipe.' }); return true }
    send(res, 200, { token: novaSessao(db, a.id), nome: a.nome }); return true
  }

  const a = anuncianteDaSessao(req, db)
  if (!a) { send(res, 401, { error: 'Sessão expirada. Entre de novo.' }); return true }
  if (req.method === 'POST' && upath === '/api/outdoor/sair') {
    const tok = String(req.headers['authorization'] || '').slice(7).trim()
    db.prepare('DELETE FROM od_sessoes WHERE token=?').run(tok)
    send(res, 200, { ok: true }); return true
  }
  if (req.method === 'GET' && upath === '/api/outdoor/painel') { send(res, 200, painelAnunciante(db, a.id)); return true }

  send(res, 404, { error: 'Rota não encontrada' })
  return true
}

module.exports = { init, handle, criarTabelas }

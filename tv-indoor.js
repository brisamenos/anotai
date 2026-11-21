// TV Indoor: vídeos da loja passando na TV do estabelecimento.
//
// Como funciona:
//  - A loja tem o adicional ligado pelo admin (tenants.tv_ativo).
//  - No gestor, ela sobe até 10 vídeos. O upload vai em partes (aguenta vídeo
//    grande e internet ruim) e o servidor comprime para Full HD (ffmpeg).
//  - A TV (app Android ou a página /tv) mostra um código de 6 números. O
//    gestor digita o código e a TV fica ligada à loja (recebe um token).
//  - A TV pergunta a lista de vídeos a cada ~15s. Mudou no gestor, a TV
//    atualiza sozinha. O app Android guarda os vídeos no aparelho e continua
//    passando mesmo sem internet.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawn, spawnSync } = require('child_process')

const MAX_VIDEOS = 10
const MAX_ARQUIVO = 8 * 1024 * 1024 * 1024 // 8 GB por vídeo enviado (antes de comprimir)
const MAX_PARTE = 16 * 1024 * 1024          // cada parte do upload
const ONLINE_MS = 60 * 1000                 // TV que falou no último minuto = ligada

let ctxBase = null
let temFfmpeg = false
const _progresso = new Map()  // video_id -> % da compressão
const _fila = []
let _comprimindo = false

function agoraISO() { return new Date().toISOString() }
function rnd(n) { return crypto.randomBytes(n).toString('hex') }
function safeTid(tid) { return String(tid).replace(/[^a-zA-Z0-9_-]/g, '') }

// Cria as tabelas (também chamado antes de restaurar um backup)
function criarTabelas(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS tv_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    titulo TEXT,
    arquivo TEXT,
    capa TEXT,
    tamanho INTEGER DEFAULT 0,
    duracao REAL DEFAULT 0,
    ordem INTEGER DEFAULT 0,
    ativo INTEGER DEFAULT 1,
    hora_ini TEXT,
    hora_fim TEXT,
    status TEXT DEFAULT 'processando',
    erro TEXT,
    original TEXT,
    created_at TEXT
  )`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tv_videos_tenant ON tv_videos(tenant_id)`)
  db.exec(`CREATE TABLE IF NOT EXISTS tv_telas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    nome TEXT,
    token TEXT UNIQUE,
    plataforma TEXT,
    app_versao TEXT,
    tocando TEXT,
    ultimo_contato TEXT,
    created_at TEXT
  )`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tv_telas_tenant ON tv_telas(tenant_id)`)
  db.exec(`CREATE TABLE IF NOT EXISTS tv_pareamentos (
    codigo TEXT PRIMARY KEY,
    segredo TEXT,
    plataforma TEXT,
    criado_em INTEGER,
    tela_token TEXT
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS tv_uploads (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    nome TEXT,
    tamanho INTEGER,
    recebido INTEGER DEFAULT 0,
    criado_em INTEGER
  )`)
  try { db.prepare('ALTER TABLE tenants ADD COLUMN tv_ativo INTEGER DEFAULT 0').run() } catch (e) { /* já existe */ }
  // Posição da TV: 0 = deitada (normal); 90 ou 270 = TV em pé (a imagem gira)
  try { db.prepare('ALTER TABLE tv_telas ADD COLUMN rotacao INTEGER DEFAULT 0').run() } catch (e) { /* já existe */ }
  // TV do Outdoor: pertence a um ponto (tenant_id fica 'od:<ponto>')
  try { db.prepare('ALTER TABLE tv_telas ADD COLUMN ponto_id INTEGER').run() } catch (e) { /* já existe */ }

}

function init(ctx) {
  ctxBase = ctx
  const { db } = ctx
  criarTabelas(db)
  try { temFfmpeg = spawnSync('ffmpeg', ['-version'], { timeout: 8000 }).status === 0 } catch (e) { temFfmpeg = false }
  if (!temFfmpeg) ctx.log('⚠️', '[TV] ffmpeg não encontrado: os vídeos da TV indoor vão sem compressão')

  fs.mkdirSync(pastaTemp(), { recursive: true })
  // Vídeos que estavam comprimindo quando o servidor reiniciou: volta pra fila
  setTimeout(() => {
    try {
      const pend = db.prepare(`SELECT id FROM tv_videos WHERE status='processando'`).all()
      for (const p of pend) enfileirar(p.id)
      try { for (const p of db.prepare(`SELECT id FROM od_videos WHERE status='processando'`).all()) enfileirar(p.id, 'od_videos') } catch (e) {}
    } catch (e) {}
  }, 15000)
  // Limpeza: códigos de pareamento vencidos e uploads largados (24h)
  setInterval(() => {
    try {
      db.prepare('DELETE FROM tv_pareamentos WHERE criado_em < ?').run(Date.now() - 30 * 60 * 1000)
      const velhos = db.prepare('SELECT id FROM tv_uploads WHERE criado_em < ?').all(Date.now() - 24 * 3600 * 1000)
      for (const u of velhos) {
        try { fs.unlinkSync(arqTemp(u.id)) } catch (e) {}
        db.prepare('DELETE FROM tv_uploads WHERE id=?').run(u.id)
      }
    } catch (e) {}
  }, 10 * 60 * 1000)
}

function pastaTemp() { return path.join(ctxBase.UPLOADS_DIR, '_tvtmp') }
function arqTemp(id) { return path.join(pastaTemp(), String(id).replace(/[^a-f0-9]/g, '') + '.part') }

function tvLiberada(db, tid) {
  const t = db.prepare('SELECT tv_ativo FROM tenants WHERE id=?').get(tid)
  return !!(t && t.tv_ativo)
}

// ── Compressão (uma de cada vez, para não travar o servidor) ─────────────
// Serve à TV Indoor (tabela tv_videos) e ao Outdoor (tabela od_videos).
const PREFIXO_ARQUIVO = {
  tv_videos: v => `tv_${safeTid(v.tenant_id)}`,
  od_videos: v => `od_a${parseInt(v.anunciante_id, 10) || 0}`
}
function chaveFila(tabela, id) { return `${tabela}:${id}` }
function enfileirar(id, tabela = 'tv_videos') {
  const k = chaveFila(tabela, id)
  if (!_fila.includes(k)) _fila.push(k)
  proximo()
}
function progressoDe(tabela, id) {
  const k = chaveFila(tabela, id)
  return { progresso: _progresso.has(k) ? _progresso.get(k) : null, na_fila: !_progresso.has(k) }
}

function duracaoDe(arquivo) {
  try {
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', arquivo], { timeout: 30000 })
    const d = parseFloat(String(r.stdout || ''))
    return isFinite(d) ? d : 0
  } catch (e) { return 0 }
}

function rodar(cmd, args, aoLer) {
  return new Promise((ok, falha) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let erro = ''
    p.stdout.on('data', d => { if (aoLer) aoLer(String(d)) })
    p.stderr.on('data', d => { erro = (erro + String(d)).slice(-2000) })
    p.on('error', falha)
    p.on('close', c => c === 0 ? ok() : falha(new Error(erro.split('\n').filter(Boolean).slice(-2).join(' ') || ('código ' + c))))
  })
}

async function proximo() {
  if (_comprimindo || !_fila.length) return
  _comprimindo = true
  const chave = _fila.shift()
  const [tabela, idTxt] = chave.split(':')
  const id = parseInt(idTxt, 10)
  const { db, log, UPLOADS_DIR } = ctxBase
  if (!PREFIXO_ARQUIVO[tabela]) { _comprimindo = false; setImmediate(proximo); return }
  const v = db.prepare(`SELECT * FROM ${tabela} WHERE id=?`).get(id)
  try {
    if (!v || v.status !== 'processando') return
    const origem = v.original && path.join(pastaTemp(), path.basename(v.original))
    if (!origem || !fs.existsSync(origem)) throw new Error('arquivo enviado não foi encontrado')
    const base = `${PREFIXO_ARQUIVO[tabela](v)}_${rnd(10)}`
    const saida = path.join(UPLOADS_DIR, base + '.mp4')
    const capa = path.join(UPLOADS_DIR, base + '.jpg')
    const dur = duracaoDe(origem)
    if (temFfmpeg) {
      _progresso.set(chave, 0)
      await rodar('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', origem,
        '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', "scale='if(gte(iw,ih),min(1920,iw),min(1080,iw))':'if(gte(iw,ih),min(1080,ih),min(1920,ih))':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30,format=yuv420p",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'high', '-level', '4.1',
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', saida + '.tmp.mp4'],
        txt => {
          const m = /out_time_(?:ms|us)=(\d+)/.exec(txt)
          if (m && dur > 0) _progresso.set(chave, Math.min(99, Math.round(parseInt(m[1], 10) / 1e6 / dur * 100)))
        })
      fs.renameSync(saida + '.tmp.mp4', saida)
      try { await rodar('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.min(1, dur / 2 || 0)), '-i', saida, '-frames:v', '1', '-vf', 'scale=480:-2', capa]) } catch (e) {}
      try { fs.unlinkSync(origem) } catch (e) {}
    } else {
      // Sem ffmpeg: usa o arquivo como veio
      fs.renameSync(origem, saida)
    }
    const tam = fs.statSync(saida).size
    db.prepare(`UPDATE ${tabela} SET status='pronto', arquivo=?, capa=?, tamanho=?, duracao=?, original=NULL, erro=NULL WHERE id=?`)
      .run('/uploads/' + base + '.mp4', fs.existsSync(capa) ? '/uploads/' + base + '.jpg' : null, tam, duracaoDe(saida) || dur, id)
    log('📺', `[TV] vídeo ${chave} pronto (${(tam / 1048576).toFixed(1)} MB)`)
    if (tabela === 'od_videos' && _outdoor && _outdoor.aoFicarPronto) { try { _outdoor.aoFicarPronto(id) } catch (e) { log('⚠️', '[OUTDOOR] troca: ' + e.message) } }
  } catch (e) {
    log('⚠️', `[TV] vídeo ${chave} falhou: ${e.message}`)
    try { db.prepare(`UPDATE ${tabela} SET status='erro', erro=? WHERE id=?`).run('Não foi possível preparar este vídeo. Tente outro arquivo.', id) } catch (x) {}
  } finally {
    _progresso.delete(chave)
    _comprimindo = false
    setImmediate(proximo)
  }
}

function apagarArquivosVideo(v) {
  const { UPLOADS_DIR } = ctxBase
  for (const u of [v.arquivo, v.capa]) {
    if (u && u.startsWith('/uploads/')) { try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(u))) } catch (e) {} }
  }
  if (v.original) { try { fs.unlinkSync(path.join(pastaTemp(), path.basename(v.original))) } catch (e) {} }
}

// ── Lista que a TV recebe ─────────────────────────────────────────────────
function playlistDa(db, tid) {
  const loja = db.prepare('SELECT nome, tv_ativo FROM tenants WHERE id=?').get(tid) || {}
  const videos = loja.tv_ativo ? db.prepare(`SELECT id, titulo, arquivo, tamanho, duracao, hora_ini, hora_fim FROM tv_videos
      WHERE tenant_id=? AND status='pronto' AND ativo=1 ORDER BY ordem, id`).all(tid) : []
  const lista = videos.map(v => ({ id: v.id, titulo: v.titulo || '', url: v.arquivo, tamanho: v.tamanho || 0,
    duracao: v.duracao || 0, hora_ini: v.hora_ini || '', hora_fim: v.hora_fim || '' }))
  const versao = crypto.createHash('sha1').update(JSON.stringify([!!loja.tv_ativo, lista])).digest('hex').slice(0, 16)
  return { versao, ativo: !!loja.tv_ativo, loja: { nome: loja.nome || '' }, videos: lista }
}

// ── Utilidades de rota ────────────────────────────────────────────────────
function lerCorpoBruto(req, max) {
  return new Promise((ok, falha) => {
    const partes = []; let n = 0, parou = false
    req.on('data', c => {
      if (parou) return
      n += c.length
      if (n > max) { parou = true; req.destroy(); falha(new Error('parte grande demais')); return }
      partes.push(c)
    })
    req.on('end', () => { if (!parou) ok(Buffer.concat(partes)) })
    req.on('error', falha)
  })
}

function tidDoGestor(req, ctx) {
  const tid = String(req.headers['x-tenant-id'] || '')
  if (!tid || !ctx.validarSessaoGestor(req, tid)) return null
  return tid
}

function telaDoToken(req, db, params) {
  const auth = String(req.headers['authorization'] || '')
  const tok = auth.startsWith('Tv ') ? auth.slice(3).trim() : String(req.headers['x-tv-token'] || params.get('token') || '')
  if (!tok || tok.length < 20) return null
  return db.prepare('SELECT * FROM tv_telas WHERE token=?').get(tok) || null
}

function resumoTelas(db, tid) {
  return db.prepare('SELECT id, nome, plataforma, app_versao, tocando, ultimo_contato, rotacao, created_at FROM tv_telas WHERE tenant_id=? ORDER BY id').all(tid)
    .map(t => ({ ...t, online: !!t.ultimo_contato && (Date.now() - Date.parse(t.ultimo_contato) < ONLINE_MS) }))
}

// ── Peças reaproveitadas pelo Outdoor (outdoor.js) ───────────────────────

// Liga a TV que mostra o código a uma loja (tenant_id) ou a um ponto do Outdoor.
function vincularTela(codigoTxt, { tenant_id, ponto_id, nome }) {
  const { db } = ctxBase
  const codigo = String(codigoTxt || '').replace(/\D/g, '')
  const p = db.prepare('SELECT * FROM tv_pareamentos WHERE codigo=?').get(codigo)
  if (!p || Date.now() - p.criado_em > 30 * 60 * 1000) return { erro: 'Código não encontrado. Confira os números que aparecem na TV.', status: 404 }
  if (p.tela_token) return { erro: 'Esse código já foi usado.', status: 409 }
  const token = rnd(24)
  const dono = ponto_id ? `od:${ponto_id}` : tenant_id
  const n = db.prepare('SELECT COUNT(*) n FROM tv_telas WHERE tenant_id=?').get(dono).n
  const nomeFinal = String(nome || '').trim().slice(0, 60) || `TV ${n + 1}`
  const r = db.prepare('INSERT INTO tv_telas (tenant_id, nome, token, plataforma, ponto_id, created_at) VALUES (?,?,?,?,?,?)')
    .run(dono, nomeFinal, token, p.plataforma || 'web', ponto_id || null, agoraISO())
  db.prepare('UPDATE tv_pareamentos SET tela_token=? WHERE codigo=?').run(token, codigo)
  return { ok: true, tela_id: r.lastInsertRowid, nome: nomeFinal }
}

// dono: id da loja, ou 'od:a<id>' para anunciante do Outdoor
function uploadIniciar(dono, body, usados, max = MAX_VIDEOS) {
  const { db } = ctxBase
  const tamanho = Math.floor(+body?.tamanho || 0)
  const nome = String(body?.nome || 'video').slice(0, 120)
  if (!(tamanho > 0)) return { erro: 'Arquivo vazio', status: 400 }
  if (tamanho > MAX_ARQUIVO) return { erro: 'Vídeo grande demais (máximo 8 GB).', status: 400 }
  if (!/\.(mp4|mov|m4v|mkv|webm|avi|3gp|mpeg|mpg|wmv)$/i.test(nome) && !String(body?.tipo || '').startsWith('video/')) return { erro: 'Esse arquivo não parece ser um vídeo.', status: 400 }
  if (usados >= max) return { erro: `Limite de ${max} vídeos. Apague um para subir outro.`, status: 400 }
  const id = rnd(16)
  fs.writeFileSync(arqTemp(id), Buffer.alloc(0))
  db.prepare('INSERT INTO tv_uploads (id, tenant_id, nome, tamanho, recebido, criado_em) VALUES (?,?,?,?,0,?)').run(id, String(dono), nome, tamanho, Date.now())
  return { upload_id: id, parte: 8 * 1024 * 1024 }
}

async function uploadParte(req, dono, uploadId, offsetTxt) {
  const { db } = ctxBase
  const up = db.prepare('SELECT * FROM tv_uploads WHERE id=? AND tenant_id=?').get(uploadId, String(dono))
  if (!up) return { status: 404, corpo: { error: 'Envio não encontrado. Comece de novo.' } }
  const offset = parseInt(offsetTxt || '0', 10)
  if (offset !== up.recebido) return { status: 409, corpo: { error: 'fora de ordem', recebido: up.recebido } }
  let buf
  try { buf = await lerCorpoBruto(req, MAX_PARTE) } catch (e) { return { status: 413, corpo: { error: e.message } } }
  if (up.recebido + buf.length > up.tamanho) return { status: 400, corpo: { error: 'Recebi mais do que o tamanho do arquivo.' } }
  fs.appendFileSync(arqTemp(up.id), buf)
  const rec = up.recebido + buf.length
  db.prepare('UPDATE tv_uploads SET recebido=? WHERE id=?').run(rec, up.id)
  return { status: 200, corpo: { recebido: rec } }
}

// Retorna { original, titulo } para gravar o vídeo como 'processando' e enfileirar
function uploadConcluir(dono, uploadId, usados, max = MAX_VIDEOS) {
  const { db } = ctxBase
  const up = db.prepare('SELECT * FROM tv_uploads WHERE id=? AND tenant_id=?').get(uploadId, String(dono))
  if (!up) return { erro: 'Envio não encontrado. Comece de novo.', status: 404 }
  if (up.recebido !== up.tamanho) return { erro: 'O vídeo não chegou inteiro. Tente de novo.', status: 400 }
  if (usados >= max) {
    try { fs.unlinkSync(arqTemp(up.id)) } catch (e) {}
    db.prepare('DELETE FROM tv_uploads WHERE id=?').run(up.id)
    return { erro: `Limite de ${max} vídeos.`, status: 400 }
  }
  db.prepare('DELETE FROM tv_uploads WHERE id=?').run(up.id)
  const titulo = up.nome.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 80) || 'Vídeo'
  return { original: path.basename(arqTemp(up.id)), titulo }
}

function telasDoPonto(pontoId) { return resumoTelas(ctxBase.db, `od:${pontoId}`) }
function emProcessamento(tabela, id) { return _progresso.has(chaveFila(tabela, id)) }
function tirarDaFila(tabela, id) { const i = _fila.indexOf(chaveFila(tabela, id)); if (i >= 0) _fila.splice(i, 1) }

// O Outdoor pluga aqui a lista das TVs dos pontos e a contagem de exibições
let _outdoor = null
function registrarOutdoor(api) { _outdoor = api }

// Retorna true se tratou a rota
async function handle(req, res, ctx) {
  const { upath, params, db, send, readBody, log } = ctx
  if (!upath.startsWith('/api/tv/')) return false
  const ip = ctx.clientIp ? ctx.clientIp(req) : ''

  // ════════════ ROTAS DA TV ════════════

  // TV pede um código de pareamento
  if (req.method === 'POST' && upath === '/api/tv/parear') {
    if (!ctx.checkRateLimit('tv-parear:' + ip, 20, 60 * 60 * 1000)) { send(res, 429, { error: 'Muitas tentativas. Aguarde um pouco.' }); return true }
    const body = await readBody(req).catch(() => ({}))
    let codigo
    for (let i = 0; i < 20; i++) {
      codigo = String(crypto.randomInt(100000, 1000000))
      if (!db.prepare('SELECT 1 FROM tv_pareamentos WHERE codigo=?').get(codigo)) break
    }
    const segredo = rnd(16)
    db.prepare('INSERT INTO tv_pareamentos (codigo, segredo, plataforma, criado_em) VALUES (?,?,?,?)')
      .run(codigo, segredo, String(body?.plataforma || 'web').slice(0, 20), Date.now())
    send(res, 200, { codigo, segredo, expira_em_s: 30 * 60 })
    return true
  }

  // TV pergunta se o código já foi usado no gestor
  if (req.method === 'GET' && upath === '/api/tv/parear/status') {
    const p = db.prepare('SELECT * FROM tv_pareamentos WHERE codigo=? AND segredo=?').get(String(params.get('codigo') || ''), String(params.get('segredo') || ''))
    if (!p || Date.now() - p.criado_em > 30 * 60 * 1000) { send(res, 404, { error: 'Código vencido. A TV vai gerar outro.' }); return true }
    if (!p.tela_token) { send(res, 200, { pronto: false }); return true }
    db.prepare('DELETE FROM tv_pareamentos WHERE codigo=?').run(p.codigo)
    send(res, 200, { pronto: true, token: p.tela_token })
    return true
  }

  // Lista de vídeos (a TV chama a cada ~15s; também serve de "estou ligada")
  if (req.method === 'GET' && upath === '/api/tv/playlist') {
    const tela = telaDoToken(req, db, params)
    if (!tela) { send(res, 401, { error: 'TV desligada da loja. Gere um novo código.' }); return true }
    let tocando = String(req.headers['x-tv-tocando'] || '').slice(0, 300)
    try { tocando = decodeURIComponent(tocando) } catch (e) {}
    tocando = tocando.slice(0, 120)
    const versaoApp = String(req.headers['x-tv-versao'] || '').slice(0, 20)
    db.prepare('UPDATE tv_telas SET ultimo_contato=?, tocando=?, app_versao=COALESCE(NULLIF(?,\'\'), app_versao) WHERE id=?')
      .run(agoraISO(), tocando || null, versaoApp, tela.id)
    const pl = (tela.ponto_id && _outdoor) ? _outdoor.playlistDoPonto(tela.ponto_id) : playlistDa(db, tela.tenant_id)
    send(res, 200, { ...pl, tela: { id: tela.id, nome: tela.nome || '', rotacao: tela.rotacao || 0 } })
    return true
  }

  // A TV avisa que começou a passar um vídeo (relatório de exibições do Outdoor)
  if (req.method === 'POST' && upath === '/api/tv/exibiu') {
    const tela = telaDoToken(req, db, params)
    if (!tela) { send(res, 401, { error: 'TV desligada' }); return true }
    const body = await readBody(req).catch(() => ({}))
    const id = parseInt(body?.id, 10)
    if (tela.ponto_id && _outdoor && id < 0) { try { _outdoor.registrarExibicao(-id, tela.ponto_id) } catch (e) {} }
    send(res, 200, { ok: true })
    return true
  }

  // ════════════ ROTAS DO GESTOR ════════════
  if (upath.startsWith('/api/tv/gestor/')) {
    const tid = tidDoGestor(req, ctx)
    if (!tid) { send(res, 401, { error: 'Sessão expirada. Entre de novo no painel.' }); return true }
    const liberada = tvLiberada(db, tid)

    if (req.method === 'GET' && upath === '/api/tv/gestor/estado') {
      const videos = db.prepare('SELECT id, titulo, arquivo, capa, tamanho, duracao, ordem, ativo, hora_ini, hora_fim, status, erro, created_at FROM tv_videos WHERE tenant_id=? ORDER BY ordem, id').all(tid)
        .map(v => { const pr = progressoDe('tv_videos', v.id); return { ...v, progresso: pr.progresso, na_fila: v.status === 'processando' && pr.na_fila } })
      send(res, 200, { ativo: liberada, max: MAX_VIDEOS, comprime: temFfmpeg, videos, telas: resumoTelas(db, tid) })
      return true
    }

    if (!liberada) { send(res, 403, { error: 'A TV Indoor não está ativa para esta loja. Fale com o suporte para ativar.' }); return true }

    // Ligar uma TV pelo código que aparece na tela dela
    if (req.method === 'POST' && upath === '/api/tv/gestor/telas') {
      if (!ctx.checkRateLimit('tv-vincular:' + tid, 15, 10 * 60 * 1000)) { send(res, 429, { error: 'Muitas tentativas. Aguarde alguns minutos.' }); return true }
      const body = await readBody(req).catch(() => ({}))
      const r = vincularTela(body?.codigo, { tenant_id: tid, nome: body?.nome })
      if (r.erro) { send(res, r.status, { error: r.erro }); return true }
      log('📺', `[TV] loja ${tid} ligou a tela "${r.nome}"`)
      send(res, 200, { ok: true, telas: resumoTelas(db, tid) })
      return true
    }

    let m
    if ((m = /^\/api\/tv\/gestor\/telas\/(\d+)$/.exec(upath))) {
      const id = +m[1]
      const t = db.prepare('SELECT id FROM tv_telas WHERE id=? AND tenant_id=?').get(id, tid)
      if (!t) { send(res, 404, { error: 'TV não encontrada' }); return true }
      if (req.method === 'PATCH') {
        const body = await readBody(req).catch(() => ({}))
        const nome = String(body?.nome || '').trim().slice(0, 60)
        if (nome) db.prepare('UPDATE tv_telas SET nome=? WHERE id=?').run(nome, id)
        if (body && [0, 90, 270].includes(+body.rotacao)) db.prepare('UPDATE tv_telas SET rotacao=? WHERE id=?').run(+body.rotacao, id)
        send(res, 200, { ok: true, telas: resumoTelas(db, tid) }); return true
      }
      if (req.method === 'DELETE') {
        db.prepare('DELETE FROM tv_telas WHERE id=?').run(id)
        send(res, 200, { ok: true, telas: resumoTelas(db, tid) }); return true
      }
    }

    // ── Upload em partes ──
    const usadosLoja = () => db.prepare(`SELECT COUNT(*) n FROM tv_videos WHERE tenant_id=? AND status<>'erro'`).get(tid).n
    if (req.method === 'POST' && upath === '/api/tv/gestor/upload/iniciar') {
      const body = await readBody(req).catch(() => ({}))
      const r = uploadIniciar(tid, body, usadosLoja())
      send(res, r.status || 200, r.erro ? { error: r.erro } : r)
      return true
    }
    if ((m = /^\/api\/tv\/gestor\/upload\/([a-f0-9]{32})$/.exec(upath)) && (req.method === 'PUT' || req.method === 'POST')) {
      const r = await uploadParte(req, tid, m[1], params.get('offset'))
      send(res, r.status, r.corpo)
      return true
    }
    if ((m = /^\/api\/tv\/gestor\/upload\/([a-f0-9]{32})\/concluir$/.exec(upath)) && req.method === 'POST') {
      const r = uploadConcluir(tid, m[1], usadosLoja())
      if (r.erro) { send(res, r.status, { error: r.erro }); return true }
      const ordem = (db.prepare('SELECT MAX(ordem) m FROM tv_videos WHERE tenant_id=?').get(tid).m || 0) + 1
      const ins = db.prepare(`INSERT INTO tv_videos (tenant_id, titulo, ordem, ativo, status, original, created_at) VALUES (?,?,?,1,'processando',?,?)`)
        .run(tid, r.titulo, ordem, r.original, agoraISO())
      enfileirar(ins.lastInsertRowid)
      send(res, 200, { ok: true, id: ins.lastInsertRowid })
      return true
    }

    // ── Vídeos ──
    if (req.method === 'POST' && upath === '/api/tv/gestor/videos/ordem') {
      const body = await readBody(req).catch(() => ({}))
      const ids = Array.isArray(body?.ids) ? body.ids.map(Number) : []
      const up = db.prepare('UPDATE tv_videos SET ordem=? WHERE id=? AND tenant_id=?')
      db.transaction(() => ids.forEach((id, i) => up.run(i + 1, id, tid)))()
      send(res, 200, { ok: true }); return true
    }
    if ((m = /^\/api\/tv\/gestor\/videos\/(\d+)$/.exec(upath))) {
      const v = db.prepare('SELECT * FROM tv_videos WHERE id=? AND tenant_id=?').get(+m[1], tid)
      if (!v) { send(res, 404, { error: 'Vídeo não encontrado' }); return true }
      if (req.method === 'PATCH') {
        const body = await readBody(req).catch(() => ({}))
        const hora = x => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(x || '')) ? String(x) : null
        const campos = {}
        if (body.titulo !== undefined) campos.titulo = String(body.titulo || '').trim().slice(0, 80) || v.titulo
        if (body.ativo !== undefined) campos.ativo = body.ativo ? 1 : 0
        if (body.hora_ini !== undefined) campos.hora_ini = hora(body.hora_ini)
        if (body.hora_fim !== undefined) campos.hora_fim = hora(body.hora_fim)
        const ks = Object.keys(campos)
        if (ks.length) db.prepare(`UPDATE tv_videos SET ${ks.map(k => k + '=?').join(',')} WHERE id=?`).run(...ks.map(k => campos[k]), v.id)
        send(res, 200, { ok: true }); return true
      }
      if (req.method === 'DELETE') {
        const i = _fila.indexOf(chaveFila('tv_videos', v.id)); if (i >= 0) _fila.splice(i, 1)
        if (_progresso.has(chaveFila('tv_videos', v.id))) { send(res, 409, { error: 'Esse vídeo está sendo preparado agora. Espere terminar para apagar.' }); return true }
        db.prepare('DELETE FROM tv_videos WHERE id=?').run(v.id)
        apagarArquivosVideo(v)
        send(res, 200, { ok: true }); return true
      }
    }
    send(res, 404, { error: 'Rota não encontrada' })
    return true
  }

  // ════════════ ADMIN ════════════
  if (req.method === 'GET' && upath === '/api/tv/admin/resumo') {
    if (!ctx.validarSessaoAdmin(req)) { send(res, 401, { error: 'Não autorizado' }); return true }
    const tid = String(params.get('tenant_id') || '')
    const telas = tid ? resumoTelas(db, tid) : []
    const videos = tid ? db.prepare(`SELECT COUNT(*) n FROM tv_videos WHERE tenant_id=? AND status='pronto'`).get(tid).n : 0
    send(res, 200, { telas: telas.length, ligadas: telas.filter(t => t.online).length, videos })
    return true
  }

  return false
}

module.exports = { init, handle, criarTabelas, enfileirar, progressoDe, emProcessamento, tirarDaFila, apagarArquivosVideo,
  vincularTela, uploadIniciar, uploadParte, uploadConcluir, telasDoPonto, registrarOutdoor,
  temCompressor: () => temFfmpeg, MAX_VIDEOS }

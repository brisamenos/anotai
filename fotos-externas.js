// Traz para o nosso servidor as fotos de produtos que apontam para outro site
// (ex.: cardápio importado do Anota AI ou do iFood). Assim a foto continua
// aparecendo mesmo se a loja cancelar a outra plataforma e as fotos sumirem lá.
//
// Cada foto é baixada uma vez, vira JPEG (no máximo 1200px) em uploads/ e o
// produto passa a usar /uploads/<arquivo>. Mesma foto em vários produtos é
// baixada só uma vez.
//
// Segurança: só baixa de endereços públicos (nada de localhost ou rede
// interna, nem por redirecionamento) e só aceita arquivo de imagem até 10 MB.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const dns = require('dns').promises
const net = require('net')

let sharp = null
try { sharp = require('sharp') } catch (e) { sharp = null }

const MAX_BYTES = 10 * 1024 * 1024
const _falhou = new Map()          // url -> quando falhou (não tenta de novo por 6h)
const _rodando = new Set()         // tenants com download em andamento

function _ipPrivado(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const s = ip.toLowerCase()
  if (s.startsWith('::ffff:')) return _ipPrivado(s.slice(7))
  return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80')
}

async function _enderecoPublico(u) {
  let url
  try { url = new URL(u) } catch (e) { return false }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  if (url.username || url.password) return false
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (/^localhost$/i.test(host) || /\.local$/i.test(host) || /\.internal$/i.test(host)) return false
  try {
    const ips = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true })
    return ips.length > 0 && ips.every(x => !_ipPrivado(x.address))
  } catch (e) { return false }
}

async function _baixar(u) {
  let atual = u
  for (let i = 0; i < 4; i++) {
    if (!(await _enderecoPublico(atual))) throw new Error('endereço não permitido')
    const r = await fetch(atual, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (EstimaFood importador de cardapio)', Accept: 'image/*' } })
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { atual = new URL(r.headers.get('location'), atual).href; continue }
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const tipo = String(r.headers.get('content-type') || '').toLowerCase()
    if (tipo && !tipo.startsWith('image/') && !tipo.startsWith('application/octet-stream') && !tipo.startsWith('binary/')) throw new Error('não é imagem')
    if (+r.headers.get('content-length') > MAX_BYTES) throw new Error('grande demais')
    const buf = Buffer.from(await r.arrayBuffer())
    if (!buf.length || buf.length > MAX_BYTES) throw new Error('tamanho inválido')
    return buf
  }
  throw new Error('redirecionamentos demais')
}

function _extPorAssinatura(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg'
  if (buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a') return 'png'
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp'
  if (buf.slice(0, 3).toString() === 'GIF') return 'gif'
  return null
}

// Converte para JPEG leve; sem o sharp, guarda como veio (se for imagem conhecida)
async function _salvar(buf, uploadsDir, nomeBase) {
  if (sharp) {
    try {
      const jpg = await sharp(buf, { failOn: 'none', animated: false }).rotate()
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer()
      const nome = nomeBase + '.jpg'
      fs.writeFileSync(path.join(uploadsDir, nome), jpg)
      return nome
    } catch (e) { /* tenta guardar como veio */ }
  }
  const ext = _extPorAssinatura(buf)
  if (!ext) throw new Error('formato de imagem desconhecido')
  const nome = nomeBase + '.' + ext
  fs.writeFileSync(path.join(uploadsDir, nome), buf)
  return nome
}

// Baixa as fotos externas dos produtos da loja.
// opts: { db, tid, uploadsDir, log, limiteMs, aoTerminar(resumo) }
// Espera até limiteMs; o que faltar continua em segundo plano.
// Retorna { encontradas, salvas, falhas, pendentes }
async function baixarFotosExternas({ db, tid, uploadsDir, log, limiteMs = 40000, aoTerminar }) {
  const resumo = { encontradas: 0, salvas: 0, falhas: 0, pendentes: 0 }
  if (!tid || _rodando.has(tid)) return resumo
  const linhas = db.prepare(`SELECT id, image_url FROM menu_items WHERE tenant_id=? AND (image_url LIKE 'http://%' OR image_url LIKE 'https://%')`).all(tid)
  const agora = Date.now()
  const porUrl = new Map()
  for (const l of linhas) {
    const u = String(l.image_url).trim()
    const f = _falhou.get(u)
    if (f && agora - f < 6 * 3600 * 1000) continue
    if (!porUrl.has(u)) porUrl.set(u, [])
    porUrl.get(u).push(l.id)
  }
  resumo.encontradas = porUrl.size
  if (!porUrl.size) return resumo

  _rodando.add(tid)
  fs.mkdirSync(uploadsDir, { recursive: true })
  const safeTid = String(tid).replace(/[^a-zA-Z0-9_-]/g, '')
  const atualiza = db.prepare('UPDATE menu_items SET image_url=? WHERE id=? AND tenant_id=? AND image_url=?')
  const fila = [...porUrl.entries()]

  const trabalhador = async () => {
    while (fila.length) {
      const [u, ids] = fila.shift()
      try {
        const buf = await _baixar(u)
        const nomeBase = `${safeTid}_imp_${crypto.createHash('sha1').update(u).digest('hex').slice(0, 20)}`
        const nome = await _salvar(buf, uploadsDir, nomeBase)
        for (const id of ids) atualiza.run(`/uploads/${nome}`, id, tid, u)
        resumo.salvas++
      } catch (e) {
        _falhou.set(u, Date.now())
        resumo.falhas++
        if (log) log(`[FOTOS] não deu para baixar ${u.slice(0, 120)}: ${e.message}`)
      }
    }
  }
  const tudo = Promise.all(Array.from({ length: Math.min(5, fila.length) }, trabalhador)).finally(() => {
    _rodando.delete(tid)
    if (log && (resumo.salvas || resumo.falhas)) log(`[FOTOS] loja ${tid}: ${resumo.salvas} foto(s) trazida(s) para o servidor, ${resumo.falhas} falha(s)`)
    try { if (aoTerminar) aoTerminar(resumo) } catch (e) {}
  })
  let estourou = false
  await Promise.race([tudo, new Promise(ok => setTimeout(() => { estourou = true; ok() }, limiteMs))])
  if (estourou) resumo.pendentes = fila.length + Math.max(0, porUrl.size - resumo.salvas - resumo.falhas - fila.length)
  return { ...resumo }
}

module.exports = { baixarFotosExternas }

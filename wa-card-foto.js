// Foto dos cartões do carrossel do pedido pelo WhatsApp.
//
// O carrossel do WhatsApp exige foto em todos os cartões, e fica bonito
// quando todas têm o mesmo formato. Aqui cada produto vira uma imagem JPEG
// 960x600 (recorte central da foto do produto). Produto sem foto ganha o
// mesmo "selo" do cardápio: o desenho do tipo de produto (hambúrguer, pizza,
// bebida...) sobre a cor da loja.
//
// A imagem vai como data URL (base64), assim o WhatsApp não precisa baixar
// nada do nosso servidor. Fica guardada em uploads/_wacard para não refazer.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const vm = require('vm')

let sharp = null
try { sharp = require('sharp') } catch (e) { sharp = null }

const LARG = 960
const ALT = 600
const VERSAO = 'v1' // trocar quando mudar o desenho, para refazer o cache

// Os desenhos e a regra de "que tipo de produto é" vêm do próprio cardápio
// (cardapio/cardapio-utils.js), para os dois ficarem sempre iguais.
let ICONES = { padrao: '<path d="M3 17.5h18"/><path d="M4.5 17.5a7.5 7.5 0 0 1 15 0"/><path d="M12 8.5v-2M10.5 6.5h3"/>' }
let tipoDoProduto = () => 'padrao'
try {
  const src = fs.readFileSync(path.join(__dirname, 'cardapio', 'cardapio-utils.js'), 'utf8')
  const ini = src.indexOf('const _PH_ICONES')
  const fim = src.indexOf('function _placeholderProduto', ini)
  if (ini !== -1 && fim !== -1) {
    const r = vm.runInNewContext(src.slice(ini, fim) + ';({ I: _PH_ICONES, t: _iconeProdutoTipo })', {}, { timeout: 1000 })
    if (r && r.I && typeof r.t === 'function') { ICONES = r.I; tipoDoProduto = r.t }
  }
} catch (e) { /* fica com o desenho padrão */ }

function corValida(c) {
  const s = String(c || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s.slice(1).split('').map(x => x + x).join('')).toLowerCase()
  return '#ea1d2c'
}
function luminancia(hex) {
  const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
}

function svgSelo(tipo, cor) {
  const clara = luminancia(cor) > 0.45
  const tinta = clara ? '#1a1a1a' : '#ffffff'
  const icone = ICONES[tipo] || ICONES.padrao
  // Desenho 24x24 ampliado 10x (240px) no centro, dentro de um círculo suave
  const esc = 10
  const x = (LARG - 24 * esc) / 2
  const y = (ALT - 24 * esc) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LARG}" height="${ALT}" viewBox="0 0 ${LARG} ${ALT}">
  <defs>
    <radialGradient id="luz" cx="50%" cy="42%" r="70%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="${clara ? 0.28 : 0.16}"/>
      <stop offset="1" stop-color="#000000" stop-opacity="${clara ? 0.06 : 0.22}"/>
    </radialGradient>
  </defs>
  <rect width="${LARG}" height="${ALT}" fill="${cor}"/>
  <rect width="${LARG}" height="${ALT}" fill="url(#luz)"/>
  <circle cx="${LARG / 2}" cy="${ALT / 2}" r="190" fill="${tinta}" fill-opacity="0.12"/>
  <g transform="translate(${x} ${y}) scale(${esc})" fill="none" stroke="${tinta}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.92">${icone}</g>
</svg>`
}

// Caminho do arquivo no disco para "/uploads/x.jpg" (ou /storage/v1/object/public/...)
function arquivoLocal(uploadsDir, url) {
  const u = String(url || '').split('?')[0]
  if (!u.startsWith('/uploads/') && !u.startsWith('/storage/v1/object/public/')) return null
  const p = path.join(uploadsDir, path.basename(u))
  return fs.existsSync(p) ? p : null
}

async function baixar(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length > 15 * 1024 * 1024) throw new Error('foto grande demais')
  return buf
}

function paraDataUrl(buf) { return `data:image/jpeg;base64,${buf.toString('base64')}` }

// item: linha de menu_items. opts: { uploadsDir, cor, urlAbsoluta(url) }
// Retorna a imagem do cartão (data URL ou URL pública) ou null se não deu.
async function fotoCartao(item, { uploadsDir, cor, urlAbsoluta }) {
  const img = String(item.image_url || '').trim()
  const corLoja = corValida(cor)

  // Sem o sharp não dá para recortar nem desenhar: usa a foto como está e
  // produto sem foto fica fora do carrossel (continua na lista).
  if (!sharp) return img ? urlAbsoluta(img) : null

  const cacheDir = path.join(uploadsDir, '_wacard')
  let chave, origem = null
  if (img) {
    const local = /^https?:\/\//i.test(img) ? null : arquivoLocal(uploadsDir, img)
    if (local) {
      origem = { tipo: 'arquivo', valor: local }
      chave = `${VERSAO}|f|${local}|${fs.statSync(local).mtimeMs}`
    } else {
      origem = { tipo: 'url', valor: urlAbsoluta(img) }
      chave = `${VERSAO}|u|${origem.valor}`
    }
  } else {
    const tipo = tipoDoProduto(item)
    origem = { tipo: 'selo', valor: tipo }
    chave = `${VERSAO}|s|${tipo}|${corLoja}`
  }
  const nome = crypto.createHash('sha1').update(chave).digest('hex').slice(0, 20) + '.jpg'
  const destino = path.join(cacheDir, nome)
  try {
    if (fs.existsSync(destino)) return paraDataUrl(fs.readFileSync(destino))
    let entrada
    if (origem.tipo === 'selo') entrada = Buffer.from(svgSelo(origem.valor, corLoja))
    else if (origem.tipo === 'arquivo') entrada = fs.readFileSync(origem.valor)
    else entrada = await baixar(origem.valor)
    const saida = await sharp(entrada, { failOn: 'none', animated: false })
      .rotate()
      .resize(LARG, ALT, { fit: 'cover', position: 'centre' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer()
    try {
      fs.mkdirSync(cacheDir, { recursive: true })
      fs.writeFileSync(destino + '.tmp', saida)
      fs.renameSync(destino + '.tmp', destino)
    } catch (e) { /* sem cache, segue */ }
    return paraDataUrl(saida)
  } catch (e) {
    // Foto quebrada ou fora do ar: tenta o selo no lugar, para o produto
    // não sumir do carrossel
    if (origem.tipo !== 'selo') return fotoCartao({ ...item, image_url: '' }, { uploadsDir, cor, urlAbsoluta })
    return null
  }
}

module.exports = { fotoCartao, tipoDoProduto }

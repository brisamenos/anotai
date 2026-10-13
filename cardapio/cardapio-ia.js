// ════════════════════════════════════════════════════════════════
// Criar cardápio por foto (gestor)
//
//   POST /api/cardapio-ia/ler    { imagens: [{ nome, tipo, dados(base64) }] }
//        → lê até 10 fotos com IA de visão e devolve o cardápio montado
//          (categorias, produtos, preços, tamanhos e adicionais) para o
//          gestor revisar. NADA é salvo aqui.
//   POST /api/cardapio-ia/criar  { categorias: [...] }
//        → cria no cardápio da loja o que o gestor confirmou na revisão.
//
// Chave da IA: a da loja (ia_config.openai_key) ou, na falta dela, a chave
// global da plataforma (mesma regra do pedido por voz).
// ════════════════════════════════════════════════════════════════
const MAX_IMAGENS = 10
const LEITURAS_POR_DIA = 15          // por loja, para o custo não sair do controle
const MODELO = process.env.CARDAPIO_IA_MODELO || 'gpt-4o'
const _usoDia = new Map()            // "tenant|AAAA-MM-DD" → leituras

const jp = (v, d) => { try { return typeof v === 'string' ? JSON.parse(v) : (v ?? d) } catch { return d } }
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const num = v => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) / 100 : null
  const s = String(v).replace(/[^\d,.-]/g, '')
  if (!s) return null
  const n = s.includes(',') ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : parseFloat(s)
  return isFinite(n) ? Math.round(n * 100) / 100 : null
}
const txt = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

function chaveOpenAI(db, tid) {
  try {
    const ia = jp(db.prepare('SELECT ia_config FROM store_config WHERE tenant_id=?').get(tid)?.ia_config, {}) || {}
    if (ia.openai_key) return ia.openai_key
    const g = jp(db.prepare("SELECT ia_config FROM store_config WHERE tenant_id='_global'").get()?.ia_config, {}) || {}
    return g.openai_key || process.env.OPENAI_API_KEY || null
  } catch { return process.env.OPENAI_API_KEY || null }
}

// Foto de iPhone (HEIC) que o navegador não conseguiu converter: converte aqui
async function paraJpeg(img) {
  const tipo = String(img.tipo || '').toLowerCase(), nome = String(img.nome || '').toLowerCase()
  const ehHeic = /heic|heif/.test(tipo) || /\.(heic|heif)$/.test(nome)
  if (!ehHeic) return { mime: /png|webp|gif|jpe?g/.test(tipo) ? tipo : 'image/jpeg', b64: img.dados }
  let conv
  try { conv = require('heic-convert') } catch { throw new Error('Foto em formato HEIC: envie como JPG (no iPhone, tire um print da foto ou mude a câmera para "Mais compatível").') }
  let saida
  try { saida = await conv({ buffer: Buffer.from(img.dados, 'base64'), format: 'JPEG', quality: 0.85 }) }
  catch { throw new Error('Não consegui abrir esta foto do iPhone. Envie como JPG ou tire um print da foto.') }
  return { mime: 'image/jpeg', b64: Buffer.from(saida).toString('base64') }
}

const PROMPT = [
  'Você lê fotos de cardápios de restaurantes, lanchonetes, pizzarias, açaiterias e similares no Brasil e transcreve o cardápio em JSON.',
  'Responda SOMENTE um objeto JSON com este formato:',
  '{"categorias":[{"nome":"","grupos":[GRUPO],"itens":[{"nome":"","descricao":"","preco":0,"tamanhos":[{"nome":"","preco":0}],"grupos":[GRUPO],"meio_a_meio":false,"max_sabores":1,"duvida":null}]}],"avisos":[""]}',
  'GRUPO = {"nome":"","tipo":"radio|checkbox","obrigatorio":false,"max":1,"opcoes":[{"nome":"","preco":0}]}',
  'Regras:',
  '1) Copie nomes e descrições como estão escritos, corrigindo só erros óbvios de digitação. Não invente produtos, descrições nem preços.',
  '2) "preco" é número em reais (ex: 32.9). Se o produto tem vários tamanhos/volumes com preços diferentes (P/M/G, 300ml/500ml, broto/grande, simples/duplo), deixe "preco" null e preencha "tamanhos". Se só tem um preço, "tamanhos" fica [].',
  '3) Adicionais, bordas, molhos, pontos da carne e outras escolhas viram grupos. "tipo":"radio" quando o cliente escolhe só uma opção (borda, ponto, sabor do refri), "checkbox" quando pode escolher várias (adicionais). "obrigatorio" true só quando a escolha é necessária para montar o produto (ex: escolher o sabor). "max" = quantas opções no máximo. Opção sem preço extra usa "preco":0.',
  '4) Se os adicionais valem para todos os produtos de uma categoria (ex: "Adicionais para lanches: bacon R$ 4, ovo R$ 2"), coloque o grupo em "grupos" da CATEGORIA, não repita em cada item.',
  '5) Pizzas que podem ser meio a meio ("meio a meio", "2 sabores"): "meio_a_meio":true e "max_sabores" com o número de sabores.',
  '6) Se não conseguir ler um preço ou nome com segurança (foto borrada, cortada, reflexo), ainda inclua o item com o que conseguiu e explique em "duvida" (ex: "preço ilegível"). Senão "duvida": null.',
  '7) Use as categorias do próprio cardápio. Se não houver, agrupe de forma natural (Lanches, Pizzas, Bebidas, Porções, Sobremesas...).',
  '8) Ignore endereço, telefone, horários, promoções de rede social e textos que não são produtos. Se a imagem não for um cardápio, devolva {"categorias":[],"avisos":["A imagem não parece ser um cardápio."]}.',
].join('\n')

async function lerImagem(chave, img, indice) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` },
    body: JSON.stringify({
      model: MODELO, temperature: 0, response_format: { type: 'json_object' }, max_tokens: 8000,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: [
          { type: 'text', text: `Foto ${indice + 1} do cardápio. Transcreva tudo o que estiver nela.` },
          { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.b64}`, detail: 'high' } },
        ] },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) {
    const m = String(d?.error?.message || '')
    if (r.status === 401) throw new Error('chave da IA inválida')
    if (r.status === 429) throw new Error(/quota|billing/i.test(m) ? 'a conta da IA está sem crédito' : 'a IA está ocupada agora, tente em alguns minutos')
    if (r.status === 400 && /image/i.test(m)) throw new Error('a imagem não pôde ser aberta')
    throw new Error(`a IA não respondeu (erro ${r.status})`)
  }
  const out = jp(d?.choices?.[0]?.message?.content, null)
  if (!out || typeof out !== 'object') throw new Error('A IA não devolveu um cardápio válido')
  return out
}

// ── limpeza e junção das leituras de várias fotos ─────────────────
function limpaGrupo(g) {
  const opcoes = (Array.isArray(g?.opcoes) ? g.opcoes : []).map(o => ({ nome: txt(o?.nome, 80), preco: Math.max(0, num(o?.preco) ?? 0) })).filter(o => o.nome)
  if (!opcoes.length || !txt(g?.nome)) return null
  const tipo = g.tipo === 'checkbox' ? 'checkbox' : 'radio'
  const max = Math.max(1, Math.min(opcoes.length, parseInt(g.max) || (tipo === 'radio' ? 1 : opcoes.length)))
  return { nome: txt(g.nome, 60), tipo, obrigatorio: !!g.obrigatorio, max: tipo === 'radio' ? 1 : max, opcoes }
}
function limpaItem(it) {
  const nome = txt(it?.nome, 90); if (!nome) return null
  const tamanhos = (Array.isArray(it.tamanhos) ? it.tamanhos : []).map(t => ({ nome: txt(t?.nome, 40), preco: num(t?.preco) })).filter(t => t.nome && t.preco !== null)
  const preco = num(it.preco)
  const grupos = (Array.isArray(it.grupos) ? it.grupos : []).map(limpaGrupo).filter(Boolean)
  let duvida = it.duvida ? txt(it.duvida, 120) : null
  if (preco === null && !tamanhos.length && !duvida) duvida = 'Preço não encontrado na foto'
  return { nome, descricao: txt(it.descricao, 300), preco, tamanhos: tamanhos.length >= 2 ? tamanhos : [], grupos,
    meio_a_meio: !!it.meio_a_meio, max_sabores: Math.max(1, Math.min(4, parseInt(it.max_sabores) || (it.meio_a_meio ? 2 : 1))), duvida,
    ...(tamanhos.length === 1 && preco === null ? { preco: tamanhos[0].preco } : {}) }
}
function juntar(leituras) {
  const cats = new Map(), avisos = []
  leituras.forEach(l => {
    ;(Array.isArray(l?.avisos) ? l.avisos : []).forEach(a => { const s = txt(a, 160); if (s && !avisos.includes(s)) avisos.push(s) })
    ;(Array.isArray(l?.categorias) ? l.categorias : []).forEach(c => {
      const nome = txt(c?.nome, 60) || 'Outros', k = norm(nome)
      if (!cats.has(k)) cats.set(k, { nome, grupos: [], itens: [] })
      const cat = cats.get(k)
      ;(Array.isArray(c.grupos) ? c.grupos : []).map(limpaGrupo).filter(Boolean).forEach(g => { if (!cat.grupos.some(x => norm(x.nome) === norm(g.nome))) cat.grupos.push(g) })
      ;(Array.isArray(c.itens) ? c.itens : []).map(limpaItem).filter(Boolean).forEach(it => {
        const ja = cat.itens.find(x => norm(x.nome) === norm(it.nome))
        if (!ja) { cat.itens.push(it); return }
        // mesma página fotografada duas vezes: completa o que faltava
        if (ja.preco === null && it.preco !== null) ja.preco = it.preco
        if (!ja.descricao && it.descricao) ja.descricao = it.descricao
        if (!ja.tamanhos.length && it.tamanhos.length) ja.tamanhos = it.tamanhos
        it.grupos.forEach(g => { if (!ja.grupos.some(x => norm(x.nome) === norm(g.nome))) ja.grupos.push(g) })
        if (ja.duvida && (ja.preco !== null || ja.tamanhos.length) && /pre[cç]o/i.test(ja.duvida)) ja.duvida = null
      })
    })
  })
  return { categorias: [...cats.values()].filter(c => c.itens.length), avisos }
}

// ── formato do sistema (custom_groups) ───────────────────────────
function gruposDoSistema(item, gruposCat) {
  const out = []
  let base = item.preco
  if (item.tamanhos?.length >= 2) {
    const precos = item.tamanhos.map(t => num(t.preco)).filter(p => p !== null)
    base = Math.min(...precos)
    out.push({ nome: 'Tamanho', tipo: 'radio', required: true, min: 0, max: 1,
      opcoes: item.tamanhos.map(t => ({ nome: txt(t.nome, 40), preco: Math.round(((num(t.preco) ?? base) - base) * 100) / 100 })) })
  }
  const todos = [...(item.grupos || [])]
  ;(gruposCat || []).forEach(g => { if (!todos.some(x => norm(x.nome) === norm(g.nome))) todos.push(g) })
  todos.forEach(g0 => {
    const g = limpaGrupo(g0); if (!g) return
    out.push({ nome: g.nome, tipo: g.tipo, required: g.obrigatorio, min: 0, max: g.max, opcoes: g.opcoes.map(o => ({ nome: o.nome, preco: o.preco })) })
  })
  return { base: Math.max(0, base ?? 0), grupos: out }
}

module.exports = async function cardapioIA(req, res, ctx) {
  const { upath, db, send, readBody, log, validarSessaoGestor, marcarDirty, emit } = ctx
  if (req.method !== 'POST' || (upath !== '/api/cardapio-ia/ler' && upath !== '/api/cardapio-ia/criar')) return false
  const tid = req.headers['x-tenant-id'] || ''
  if (!tid) { send(res, 400, { error: 'x-tenant-id obrigatório' }); return true }
  if (!validarSessaoGestor(req, tid)) { send(res, 401, { error: 'Sessão expirada. Entre de novo no gestor.' }); return true }

  // ── ler as fotos ──────────────────────────────────────────────
  if (upath === '/api/cardapio-ia/ler') {
    let body
    try { body = await readBody(req, 60 * 1024 * 1024) } catch (e) { send(res, 413, { error: 'As fotos passaram do tamanho permitido. Envie menos fotos por vez.' }); return true }
    const imagens = (Array.isArray(body?.imagens) ? body.imagens : []).filter(i => i && typeof i.dados === 'string' && i.dados.length > 100)
    if (!imagens.length) { send(res, 400, { error: 'Envie pelo menos uma foto do cardápio.' }); return true }
    if (imagens.length > MAX_IMAGENS) { send(res, 400, { error: `Envie no máximo ${MAX_IMAGENS} fotos por vez.` }); return true }
    const chave = chaveOpenAI(db, tid)
    if (!chave) { send(res, 503, { error: 'A leitura por IA ainda não está configurada na plataforma. Fale com o suporte.' }); return true }
    const dia = new Date().toISOString().slice(0, 10), kUso = `${tid}|${dia}`, usados = _usoDia.get(kUso) || 0
    if (usados >= LEITURAS_POR_DIA) { send(res, 429, { error: 'Limite de leituras de hoje atingido. Tente de novo amanhã.' }); return true }
    _usoDia.set(kUso, usados + 1)
    for (const k of _usoDia.keys()) if (!k.endsWith(dia)) _usoDia.delete(k)

    const t0 = Date.now(), leituras = [], falhas = []
    let prox = 0
    const trabalhador = async () => {
      while (prox < imagens.length) {
        const i = prox++
        try { leituras[i] = await lerImagem(chave, await paraJpeg(imagens[i]), i) }
        catch (e) { falhas.push({ foto: i + 1, erro: e.message }); log('⚠️', `[CARDAPIO-IA] foto ${i + 1} tenant=${tid}:`, e.message) }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, imagens.length) }, trabalhador))
    const out = juntar(leituras.filter(Boolean))
    const nItens = out.categorias.reduce((s, c) => s + c.itens.length, 0)
    log('🧾', `[CARDAPIO-IA] tenant=${tid} fotos=${imagens.length} itens=${nItens} falhas=${falhas.length} ${Math.round((Date.now() - t0) / 1000)}s`)
    if (!nItens && falhas.length) { send(res, 502, { error: 'Não consegui ler as fotos agora: ' + falhas[0].erro, falhas }); return true }
    send(res, 200, { ...out, falhas })
    return true
  }

  // ── criar o que o gestor confirmou ────────────────────────────
  let body
  try { body = await readBody(req, 4 * 1024 * 1024) } catch { send(res, 413, { error: 'Cardápio grande demais para salvar de uma vez.' }); return true }
  const cats = (Array.isArray(body?.categorias) ? body.categorias : [])
  if (!cats.length) { send(res, 400, { error: 'Nada para criar.' }); return true }
  try {
    const existentes = db.prepare('SELECT id, name, label, sort_order FROM categories WHERE tenant_id=?').all(tid)
    let ordemCat = existentes.reduce((m, c) => Math.max(m, c.sort_order || 0), 0)
    const ordemItemRow = db.prepare('SELECT COALESCE(MAX(sort_order),0) m FROM menu_items WHERE tenant_id=?').get(tid)
    let ordemItem = ordemItemRow?.m || 0
    const insCat = db.prepare('INSERT INTO categories (tenant_id,name,label,type,promo,sort_order,ativo) VALUES (?,?,?,?,0,?,1)')
    const insItem = db.prepare(`INSERT INTO menu_items (tenant_id,name,description,price,category_id,cat,cat_key,emoji,status,item_type,allow_half,max_flavors,days,ingredients,custom_groups,destaque,promo,sort_order)
      VALUES (?,?,?,?,?,?,?,'🍽️','active','normal',?,?,'[1,1,1,1,1,1,1]','[]',?,0,0,?)`)
    let nCats = 0, nItens = 0, nRepetidos = 0
    const jaTem = new Set(db.prepare('SELECT category_id, name FROM menu_items WHERE tenant_id=?').all(tid).map(r => r.category_id + '|' + norm(r.name)))
    db.transaction(() => {
      for (const c of cats) {
        const itens = (Array.isArray(c?.itens) ? c.itens : []).filter(i => i && i.incluir !== false && txt(i.nome))
        if (!itens.length) continue
        const label = txt(c.nome, 60) || 'Outros'
        let cat = existentes.find(e => norm(e.label || e.name) === norm(label))
        if (!cat) {
          let slug = norm(label).replace(/ /g, '_') || 'categoria', s = slug, k = 2
          while (existentes.some(e => e.name === s)) s = `${slug}_${k++}`
          const r = insCat.run(tid, s, label, 'Itens principais', ++ordemCat)
          cat = { id: r.lastInsertRowid, name: s, label }
          existentes.push(cat); nCats++
        }
        for (const it of itens) {
          // mesmo produto na mesma categoria (leu o mesmo cardápio duas vezes): não duplica
          const kRep = cat.id + '|' + norm(it.nome)
          if (jaTem.has(kRep)) { nRepetidos++; continue }
          jaTem.add(kRep)
          const { base, grupos } = gruposDoSistema({ ...it, preco: num(it.preco), tamanhos: (it.tamanhos || []).map(t => ({ nome: t.nome, preco: num(t.preco) })).filter(t => t.preco !== null) }, c.grupos)
          insItem.run(tid, txt(it.nome, 90), txt(it.descricao, 300), base, cat.id, cat.label || label, cat.name,
            it.meio_a_meio ? 1 : 0, it.meio_a_meio ? Math.max(2, Math.min(4, parseInt(it.max_sabores) || 2)) : 1, JSON.stringify(grupos), ++ordemItem)
          nItens++
        }
      }
    })()
    try { marcarDirty?.() } catch {}
    try { emit?.(tid, 'categories', { tenant_id: tid, bulk: true }, 'UPDATE'); emit?.(tid, 'menu_items', { tenant_id: tid, bulk: true }, 'UPDATE') } catch {}
    log('🧾', `[CARDAPIO-IA] criado tenant=${tid} categorias=${nCats} itens=${nItens} repetidos=${nRepetidos}`)
    send(res, 200, { ok: true, categorias: nCats, itens: nItens, repetidos: nRepetidos })
  } catch (e) {
    log('❌', '[CARDAPIO-IA] criar:', e.message)
    send(res, 500, { error: 'Erro ao criar o cardápio: ' + e.message })
  }
  return true
}
module.exports._teste = { juntar, gruposDoSistema, limpaItem }

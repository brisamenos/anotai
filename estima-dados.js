// Estima — dados da loja (somente leitura).
// Cada função recebe o tenant_id da SESSÃO do gestor (nunca da IA), então a
// Estima só enxerga a própria loja. As contas seguem as mesmas regras da tela
// de Relatórios do gestor:
//  - faturamento = total + taxa dos pedidos com status pronto, saiu, entregue
//    ou finalizado (pedido em análise, em produção, mesa aberta e cancelado
//    não entram);
//  - período em horário de Brasília (o banco guarda em UTC);
//  - semana = domingo a sábado.

const VALIDOS = new Set(['pronto', 'saiu', 'entregue', 'finalizado'])
const EM_ANDAMENTO = ['analise', 'aguardando_pix', 'aguardando_cartao', 'producao', 'pronto', 'saiu', 'mesa_aberta']
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const BR = 3 * 3600 * 1000 // Brasília = UTC-3 (sem horário de verão)
const DIA = 86400000

// ── datas ───────────────────────────────────────────────────────────────
const r2 = v => Math.round((Number(v) || 0) * 100) / 100
const hojeBR = (agora = Date.now()) => new Date(agora - BR).toISOString().slice(0, 10)
const msDe = d => Date.parse(d + 'T03:00:00Z')                    // meia-noite de Brasília daquele dia
const dataDe = ms => new Date(ms - BR).toISOString().slice(0, 10) // dia (Brasília) de um instante
const sqlDe = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
const somaDias = (d, n) => dataDe(msDe(d) + n * DIA + 1)
const fmtData = d => d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : null
function somaMeses(d, n) {
  const [y, m] = d.split('-').map(Number), t = (m - 1) + n
  return `${y + Math.floor(t / 12)}-${String(((t % 12) + 12) % 12 + 1).padStart(2, '0')}-01`
}
function tsDoPedido(v) { // created_at vem como "AAAA-MM-DD HH:MM:SS" (UTC) ou ISO
  const s = String(v || '')
  return Date.parse(/[TZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z')
}
const horaBR = ms => new Date(ms - BR).getUTCHours()
const diaSemanaBR = ms => new Date(ms - BR).getUTCDay()

const PERIODOS = ['hoje', 'ontem', 'semana', 'semana_passada', 'ultimos_7_dias', 'ultimos_30_dias', 'mes', 'mes_passado', 'ano', 'dia', 'mes_especifico', 'intervalo']

// Devolve o intervalo [ini, fim) em ms, o rótulo e o período anterior equivalente
// (para comparar "até agora" com "até a mesma altura" do período anterior).
function periodo(a = {}, agora = Date.now()) {
  const hoje = hojeBR(agora), dow = new Date(msDe(hoje) - BR + 12 * 3600 * 1000).getUTCDay()
  let p = PERIODOS.includes(a.periodo) ? a.periodo : 'hoje'
  let ini, fim, rotulo, ant // ant = função que dá o início do período anterior
  const valida = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !isNaN(msDe(d))
  if (p === 'dia' && !valida(a.data)) p = 'hoje'
  if (p === 'intervalo' && !(valida(a.de) && valida(a.ate))) p = 'ultimos_30_dias'
  if (p === 'mes_especifico' && !/^\d{4}-\d{2}$/.test(String(a.mes || ''))) p = 'mes'
  switch (p) {
    case 'hoje': ini = hoje; fim = somaDias(hoje, 1); rotulo = 'hoje, ' + fmtData(hoje); ant = d => somaDias(d, -1); break
    case 'ontem': ini = somaDias(hoje, -1); fim = hoje; rotulo = 'ontem, ' + fmtData(ini); ant = d => somaDias(d, -1); break
    case 'dia': ini = a.data; fim = somaDias(a.data, 1); rotulo = fmtData(ini); ant = d => somaDias(d, -7); break
    case 'semana': ini = somaDias(hoje, -dow); fim = somaDias(ini, 7); rotulo = 'esta semana (domingo ' + fmtData(ini) + ' a sábado ' + fmtData(somaDias(fim, -1)) + ')'; ant = d => somaDias(d, -7); break
    case 'semana_passada': ini = somaDias(hoje, -dow - 7); fim = somaDias(ini, 7); rotulo = 'semana passada (' + fmtData(ini) + ' a ' + fmtData(somaDias(fim, -1)) + ')'; ant = d => somaDias(d, -7); break
    case 'ultimos_7_dias': ini = somaDias(hoje, -6); fim = somaDias(hoje, 1); rotulo = 'últimos 7 dias (' + fmtData(ini) + ' a ' + fmtData(hoje) + ')'; ant = d => somaDias(d, -7); break
    case 'ultimos_30_dias': ini = somaDias(hoje, -29); fim = somaDias(hoje, 1); rotulo = 'últimos 30 dias (' + fmtData(ini) + ' a ' + fmtData(hoje) + ')'; ant = d => somaDias(d, -30); break
    case 'mes': ini = hoje.slice(0, 8) + '01'; fim = somaMeses(ini, 1); rotulo = MESES[Number(ini.slice(5, 7)) - 1] + ' de ' + ini.slice(0, 4); ant = d => somaMeses(d, -1); break
    case 'mes_passado': ini = somaMeses(hoje.slice(0, 8) + '01', -1); fim = somaMeses(ini, 1); rotulo = MESES[Number(ini.slice(5, 7)) - 1] + ' de ' + ini.slice(0, 4); ant = d => somaMeses(d, -1); break
    case 'mes_especifico': ini = a.mes + '-01'; fim = somaMeses(ini, 1); rotulo = MESES[Number(ini.slice(5, 7)) - 1] + ' de ' + ini.slice(0, 4); ant = d => somaMeses(d, -1); break
    case 'ano': ini = hoje.slice(0, 4) + '-01-01'; fim = (Number(hoje.slice(0, 4)) + 1) + '-01-01'; rotulo = 'ano de ' + hoje.slice(0, 4); ant = d => (Number(d.slice(0, 4)) - 1) + d.slice(4); break
    case 'intervalo': {
      let de = a.de, ate = a.ate; if (de > ate) [de, ate] = [ate, de]
      ini = de; fim = somaDias(ate, 1); rotulo = fmtData(de) + ' a ' + fmtData(ate)
      const n = Math.round((msDe(fim) - msDe(ini)) / DIA); ant = d => somaDias(d, -n); break
    }
  }
  const iniMs = msDe(ini), fimMs = msDe(fim)
  const emAndamento = fimMs > agora && iniMs <= agora
  const decorrido = emAndamento ? agora - iniMs : fimMs - iniMs
  const antIni = msDe(ant(ini)), antFimCheio = msDe(ant(fim))
  const antFim = Math.min(antIni + decorrido, antFimCheio)
  return { periodo: p, ini: iniMs, fim: Math.min(fimMs, Math.max(agora, iniMs)), fimCheio: fimMs, rotulo, emAndamento, anterior: { ini: antIni, fim: antFim, ateMesmaAltura: emAndamento } }
}

// ── leitura dos pedidos ────────────────────────────────────────────────────
function lerItens(v) {
  if (Array.isArray(v)) return v
  try { const x = JSON.parse(v || '[]'); return Array.isArray(x) ? x : [] } catch (e) { return [] }
}
function pedidos(db, tid, iniMs, fimMs) {
  return db.prepare(`SELECT id, status, total, taxa, items, mesa_num, addr, pag, phone, client, customer_id, canal, created_at
                     FROM orders WHERE tenant_id=? AND datetime(created_at) >= ? AND datetime(created_at) < ?`)
    .all(tid, sqlDe(iniMs), sqlDe(fimMs))
    .map(o => { const ms = tsDoPedido(o.created_at); return { ...o, ms, valor: (Number(o.total) || 0) + (Number(o.taxa) || 0), valido: VALIDOS.has(o.status) } })
    .filter(o => !isNaN(o.ms))
}
const itensAtivos = o => lerItens(o.items).filter(i => i && (i.item_status || 'active') !== 'cancelado')
const qtdItem = i => { const q = Number(i.qty); return q > 0 ? q : 1 }
const tipoVenda = o => (o.mesa_num || String(o.addr || '').startsWith('Mesa')) ? 'consumo no local' : String(o.addr || '').toLowerCase().includes('balc') || /^retirada/i.test(String(o.addr || '')) ? 'retirada no balcão' : 'delivery'
function formaPag(p) {
  const s = String(p || '').toLowerCase()
  if (s.includes('pix')) return 'Pix'
  if (s.includes('cart') || s.includes('credito') || s.includes('débito') || s.includes('debito')) return 'Cartão'
  if (s.includes('dinheiro')) return 'Dinheiro'
  if (s.includes('mesa')) return 'Mesa'
  return p ? String(p) : 'Não informado'
}
const fone = p => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-11) : '' }
function bairroDe(addr) {
  const partes = String(addr || '').split(',').map(s => s.trim()).filter(s => s && !/^ref:/i.test(s))
  if (partes.length < 2) return null
  const b = /^\d+[a-z]?$|^s\/?n$/i.test(partes[1]) ? partes[2] : partes[1]
  return b ? b.replace(/\s+/g, ' ').slice(0, 40) : null
}
const pct = (a, b) => b > 0 ? Math.round((a - b) / b * 1000) / 10 : null
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

function somar(lista) {
  const v = lista.filter(o => o.valido)
  const fat = v.reduce((s, o) => s + o.valor, 0)
  return { faturamento: r2(fat), pedidos_concluidos: v.length, ticket_medio: v.length ? r2(fat / v.length) : 0, pedidos_no_total: lista.length, cancelados: lista.filter(o => o.status === 'cancelado').length }
}

// ── catálogo da loja (para casar itens vendidos com o cardápio) ─────────────────
function catalogo(db, tid) {
  return db.prepare('SELECT id, name, price, cat, cat_key, status, image_url, description, promo, price_old, destaque, created_at FROM menu_items WHERE tenant_id=?').all(tid)
}
const ativoNoCardapio = m => !['pausado', 'esgotado', 'inativo'].includes(String(m.status || '').toLowerCase())

// Agrupa por produto do cardápio (id) e, sem id, pelo nome
function agruparProdutos(lista, cat) {
  const porId = new Map(cat.map(m => [String(m.id), m])), porNome = new Map(cat.map(m => [norm(m.name), m]))
  const mapa = new Map()
  for (const o of lista) {
    if (!o.valido) continue
    for (const i of itensAtivos(o)) {
      const m = (i.id != null && porId.get(String(i.id))) || porNome.get(norm(i.name))
      const chave = m ? 'id:' + m.id : 'n:' + norm(i.name)
      if (!chave || chave === 'n:') continue
      const g = mapa.get(chave) || { produto: m ? m.name : String(i.name || '?'), categoria: (m && (m.cat || m.cat_key)) || i.cat || i.cat_key || null, quantidade: 0, faturamento: 0, pedidos: new Set(), id: m ? m.id : null }
      g.quantidade += qtdItem(i); g.faturamento += (Number(i.price) || 0) * qtdItem(i); g.pedidos.add(o.id)
      mapa.set(chave, g)
    }
  }
  return [...mapa.values()].map(g => ({ produto: g.produto, categoria: g.categoria, quantidade: r2(g.quantidade), faturamento: r2(g.faturamento), pedidos: g.pedidos.size, id: g.id }))
}

// ═════════════════════════ FERRAMENTAS ═════════════════════════

function resumoVendas(db, tid, a = {}) {
  const P = periodo(a), lista = pedidos(db, tid, P.ini, P.fim), s = somar(lista)
  const porTipo = {}, porPag = {}
  for (const o of lista.filter(x => x.valido)) {
    const t = tipoVenda(o), g = porTipo[t] = porTipo[t] || { pedidos: 0, faturamento: 0 }; g.pedidos++; g.faturamento = r2(g.faturamento + o.valor)
    const f = formaPag(o.pag), h = porPag[f] = porPag[f] || { pedidos: 0, faturamento: 0 }; h.pedidos++; h.faturamento = r2(h.faturamento + o.valor)
  }
  const canc = lista.filter(o => o.status === 'cancelado')
  const andamento = lista.filter(o => !o.valido && o.status !== 'cancelado')
  const out = {
    periodo: P.rotulo, ...s,
    taxa_de_entrega_cobrada: r2(lista.filter(o => o.valido).reduce((x, o) => x + (Number(o.taxa) || 0), 0)),
    cancelamentos: { quantidade: canc.length, valor: r2(canc.reduce((x, o) => x + o.valor, 0)), percentual: lista.length ? Math.round(canc.length / lista.length * 1000) / 10 : 0 },
    ainda_em_andamento: { quantidade: andamento.length, valor: r2(andamento.reduce((x, o) => x + o.valor, 0)), observacao: 'Pedidos em análise, produção ou mesa aberta ainda não entram no faturamento (igual aos Relatórios).' },
    por_tipo_de_venda: porTipo, por_forma_de_pagamento: porPag,
    regra: 'Faturamento = pedidos prontos, saiu para entrega, entregues ou finalizados (total + taxa de entrega), igual à tela de Relatórios.'
  }
  if (a.comparar !== false) {
    const ant = somar(pedidos(db, tid, P.anterior.ini, P.anterior.fim))
    out.comparacao_com_periodo_anterior = {
      periodo_anterior: fmtData(dataDe(P.anterior.ini)) + (P.anterior.fim - P.anterior.ini > DIA ? ' a ' + fmtData(dataDe(P.anterior.fim - 1)) : ''),
      observacao: P.anterior.ateMesmaAltura ? 'Comparado até o mesmo ponto do período anterior (o período atual ainda não acabou).' : undefined,
      faturamento_anterior: ant.faturamento, pedidos_anterior: ant.pedidos_concluidos, ticket_anterior: ant.ticket_medio,
      variacao_faturamento_pct: pct(s.faturamento, ant.faturamento), variacao_pedidos_pct: pct(s.pedidos_concluidos, ant.pedidos_concluidos), variacao_ticket_pct: pct(s.ticket_medio, ant.ticket_medio)
    }
  }
  // melhor dia do período (quando tem mais de um dia)
  if (P.fimCheio - P.ini > DIA) {
    const dias = {}; for (const o of lista.filter(x => x.valido)) { const d = dataDe(o.ms); dias[d] = r2((dias[d] || 0) + o.valor) }
    const ord = Object.entries(dias).sort((x, y) => y[1] - x[1])
    if (ord.length) { out.melhor_dia = { data: fmtData(ord[0][0]), dia_da_semana: DIAS[new Date(msDe(ord[0][0]) + 12 * 3600 * 1000 - BR).getUTCDay()], faturamento: ord[0][1] }; out.dias_com_venda = ord.length }
  }
  return out
}

function produtos(db, tid, a = {}) {
  const P = periodo({ periodo: 'ultimos_30_dias', ...a }), cat = catalogo(db, tid)
  let lista = agruparProdutos(pedidos(db, tid, P.ini, P.fim), cat)
  const totalQtd = lista.reduce((s, g) => s + g.quantidade, 0), totalFat = lista.reduce((s, g) => s + g.faturamento, 0)
  if (a.categoria) { const c = norm(a.categoria); lista = lista.filter(g => norm(g.categoria).includes(c)) }
  const ordem = ['mais_vendidos', 'menos_vendidos', 'maior_faturamento', 'menor_faturamento'].includes(a.ordem) ? a.ordem : 'mais_vendidos'
  const f = { mais_vendidos: (x, y) => y.quantidade - x.quantidade, menos_vendidos: (x, y) => x.quantidade - y.quantidade, maior_faturamento: (x, y) => y.faturamento - x.faturamento, menor_faturamento: (x, y) => x.faturamento - y.faturamento }[ordem]
  lista.sort(f)
  const limite = Math.min(Math.max(Number(a.limite) || 10, 1), 40)
  const out = {
    periodo: P.rotulo, ordem, produtos_diferentes_vendidos: lista.length, itens_vendidos_no_total: r2(totalQtd), faturamento_dos_itens: r2(totalFat),
    lista: lista.slice(0, limite).map(g => ({ produto: g.produto, categoria: g.categoria, quantidade: g.quantidade, faturamento: g.faturamento, em_quantos_pedidos: g.pedidos, participacao_pct: totalFat ? Math.round(g.faturamento / totalFat * 1000) / 10 : 0 }))
  }
  // Produtos ativos no cardápio que não venderam NADA no período (cadastrados antes do período)
  if (ordem.startsWith('menos') || a.incluir_sem_venda) {
    const vendidos = new Set(lista.map(g => g.id).filter(Boolean).map(String)), nomes = new Set(lista.map(g => norm(g.produto)))
    const semVenda = cat.filter(m => ativoNoCardapio(m) && !vendidos.has(String(m.id)) && !nomes.has(norm(m.name)) && (!m.created_at || tsDoPedido(m.created_at) < P.ini) && (!a.categoria || norm(m.cat || m.cat_key).includes(norm(a.categoria))))
    out.sem_nenhuma_venda_no_periodo = { quantidade: semVenda.length, produtos: semVenda.slice(0, 25).map(m => ({ produto: m.name, categoria: m.cat || m.cat_key || null, preco: r2(m.price) })) }
  }
  out.observacao = 'Quantidade e faturamento contam só itens de pedidos concluídos, sem itens cancelados.'
  return out
}

function produtoDetalhe(db, tid, a = {}) {
  const cat = catalogo(db, tid)
  if (!a.nome) return { erro: 'Diga o nome do produto.' }
  const q = norm(a.nome)
  let achados = cat.filter(m => norm(m.name) === q)
  if (!achados.length) achados = cat.filter(m => norm(m.name).includes(q) || q.includes(norm(m.name)))
  if (!achados.length) { // a voz pode ter entendido errado: o mais parecido
    const pal = q.split(' ').filter(w => w.length > 2)
    achados = cat.map(m => ({ m, s: pal.filter(w => norm(m.name).includes(w)).length / (pal.length || 1) })).filter(x => x.s >= 0.5).sort((x, y) => y.s - x.s).map(x => x.m)
  }
  if (!achados.length) return { erro: `Não achei "${a.nome}" no cardápio.`, dica: 'Peça a lista com a ferramenta cardapio (busca) ou confira o nome.' }
  if (achados.length > 5) return { opcoes: achados.slice(0, 8).map(m => m.name), aviso: 'Vários produtos parecidos. Pergunte qual deles.' }
  const P = periodo({ periodo: 'ultimos_30_dias', ...a }), lista = pedidos(db, tid, P.ini, P.fim), listaAnt = pedidos(db, tid, P.anterior.ini, P.anterior.fim)
  return {
    periodo: P.rotulo,
    produtos: achados.map(m => {
      const g = agruparProdutos(lista, cat).find(x => x.id === m.id) || { quantidade: 0, faturamento: 0, pedidos: 0 }
      const ga = agruparProdutos(listaAnt, cat).find(x => x.id === m.id) || { quantidade: 0, faturamento: 0 }
      const horas = new Array(24).fill(0), dias = new Array(7).fill(0)
      for (const o of lista.filter(x => x.valido)) if (itensAtivos(o).some(i => String(i.id) === String(m.id) || norm(i.name) === norm(m.name))) { horas[horaBR(o.ms)]++; dias[diaSemanaBR(o.ms)]++ }
      const melhorHora = horas.indexOf(Math.max(...horas)), melhorDia = dias.indexOf(Math.max(...dias))
      return {
        produto: m.name, categoria: m.cat || m.cat_key || null, preco: r2(m.price), preco_antigo: m.price_old ? r2(m.price_old) : null,
        situacao_no_cardapio: ativoNoCardapio(m) ? 'ativo' : String(m.status), tem_foto: !!m.image_url, tem_descricao: !!String(m.description || '').trim(), em_destaque: !!m.destaque,
        vendidos: g.quantidade, faturamento: g.faturamento, em_quantos_pedidos: g.pedidos, vendidos_periodo_anterior: ga.quantidade, variacao_pct: pct(g.quantidade, ga.quantidade),
        vende_mais_as: g.quantidade ? melhorHora + 'h' : null, vende_mais_no_dia: g.quantidade ? DIAS[melhorDia] : null
      }
    })
  }
}

function horarios(db, tid, a = {}) {
  const P = periodo({ periodo: 'ultimos_30_dias', ...a }), lista = pedidos(db, tid, P.ini, P.fim).filter(o => o.valido)
  const h = Array.from({ length: 24 }, (_, i) => ({ hora: i + 'h', pedidos: 0, faturamento: 0 })), d = DIAS.map(x => ({ dia: x, pedidos: 0, faturamento: 0 }))
  for (const o of lista) { const x = h[horaBR(o.ms)], y = d[diaSemanaBR(o.ms)]; x.pedidos++; x.faturamento = r2(x.faturamento + o.valor); y.pedidos++; y.faturamento = r2(y.faturamento + o.valor) }
  const comVenda = h.filter(x => x.pedidos)
  return {
    periodo: P.rotulo, pedidos_concluidos: lista.length,
    horarios_mais_fortes: [...comVenda].sort((x, y) => y.faturamento - x.faturamento).slice(0, 4),
    horarios_mais_fracos_com_venda: [...comVenda].sort((x, y) => x.faturamento - y.faturamento).slice(0, 4),
    por_dia_da_semana: d, dia_mais_forte: [...d].sort((x, y) => y.faturamento - x.faturamento)[0], dia_mais_fraco: [...d].sort((x, y) => x.faturamento - y.faturamento)[0],
    por_hora: comVenda, observacao: 'Horário de Brasília.'
  }
}

function clientes(db, tid, a = {}) {
  const tipo = ['melhores', 'novos', 'sumidos', 'resumo'].includes(a.tipo) ? a.tipo : 'resumo'
  const limite = Math.min(Math.max(Number(a.limite) || 10, 1), 30)
  // Histórico de quem tem telefone (pedidos concluídos), de todo o tempo
  const hist = db.prepare(`SELECT phone, client, total, taxa, status, created_at FROM orders WHERE tenant_id=? AND phone IS NOT NULL AND phone<>''`).all(tid)
  const porFone = new Map()
  for (const o of hist) {
    if (!VALIDOS.has(o.status)) continue
    const f = fone(o.phone); if (!f) continue
    const ms = tsDoPedido(o.created_at); if (isNaN(ms)) continue
    const c = porFone.get(f) || { nome: o.client || 'Cliente', telefone: f, pedidos: 0, gasto: 0, primeiro: ms, ultimo: ms }
    c.pedidos++; c.gasto += (Number(o.total) || 0) + (Number(o.taxa) || 0)
    if (ms < c.primeiro) c.primeiro = ms
    if (ms >= c.ultimo) { c.ultimo = ms; if (o.client) c.nome = o.client }
    porFone.set(f, c)
  }
  const todos = [...porFone.values()]
  const fmt = c => ({ nome: c.nome, telefone: c.telefone, pedidos: c.pedidos, gasto_total: r2(c.gasto), primeiro_pedido: fmtData(dataDe(c.primeiro)), ultimo_pedido: fmtData(dataDe(c.ultimo)), dias_sem_pedir: Math.floor((Date.now() - c.ultimo) / DIA) })
  if (tipo === 'sumidos') {
    const dias = Math.min(Math.max(Number(a.dias) || 30, 7), 365)
    const s = todos.filter(c => c.pedidos >= 2 && Date.now() - c.ultimo > dias * DIA && Date.now() - c.ultimo < 365 * DIA).sort((x, y) => y.gasto - x.gasto)
    return { tipo, criterio: `clientes com 2 ou mais pedidos que não pedem há mais de ${dias} dias (até 1 ano)`, quantidade: s.length, gasto_historico_somado: r2(s.reduce((x, c) => x + c.gasto, 0)), lista: s.slice(0, limite).map(fmt) }
  }
  const P = periodo({ periodo: 'ultimos_30_dias', ...a })
  const noPeriodo = pedidos(db, tid, P.ini, P.fim).filter(o => o.valido)
  const grupo = new Map()
  for (const o of noPeriodo) { const f = fone(o.phone); if (!f) continue; const g = grupo.get(f) || { pedidos: 0, gasto: 0 }; g.pedidos++; g.gasto += o.valor; grupo.set(f, g) }
  const novos = [...grupo.keys()].filter(f => porFone.get(f) && porFone.get(f).primeiro >= P.ini)
  const voltaram = grupo.size - novos.length
  if (tipo === 'novos') return { tipo, periodo: P.rotulo, quantidade: novos.length, lista: novos.map(f => porFone.get(f)).sort((x, y) => y.primeiro - x.primeiro).slice(0, limite).map(fmt) }
  if (tipo === 'melhores') {
    const top = [...grupo.entries()].sort((x, y) => y[1].gasto - x[1].gasto).slice(0, limite)
    return { tipo, periodo: P.rotulo, lista: top.map(([f, g]) => ({ ...fmt(porFone.get(f)), pedidos_no_periodo: g.pedidos, gasto_no_periodo: r2(g.gasto) })) }
  }
  const semFone = noPeriodo.filter(o => !fone(o.phone)).length
  return {
    tipo, periodo: P.rotulo, clientes_que_compraram: grupo.size, novos: novos.length, que_ja_eram_clientes: voltaram,
    recompra_pct: grupo.size ? Math.round(voltaram / grupo.size * 1000) / 10 : 0,
    clientes_com_telefone_no_historico: todos.length, sumidos_ha_mais_de_30_dias: todos.filter(c => c.pedidos >= 2 && Date.now() - c.ultimo > 30 * DIA && Date.now() - c.ultimo < 365 * DIA).length,
    pedidos_sem_telefone_no_periodo: semFone, observacao: 'Clientes contados pelo telefone. Pedidos de mesa e balcão sem telefone não entram.'
  }
}

function pedidosAgora(db, tid) {
  const desde = Date.now() - 2 * DIA
  const ativos = db.prepare(`SELECT id, status, total, taxa, mesa_num, addr, created_at, scheduled_for FROM orders WHERE tenant_id=? AND status IN (${EM_ANDAMENTO.map(() => '?').join(',')}) AND datetime(created_at) >= ?`).all(tid, ...EM_ANDAMENTO, sqlDe(desde))
  const nomes = { analise: 'em análise (esperando aceitar)', aguardando_pix: 'aguardando Pix', aguardando_cartao: 'aguardando cartão', producao: 'em produção', pronto: 'pronto', saiu: 'saiu para entrega', mesa_aberta: 'mesas abertas' }
  const porStatus = {}
  for (const o of ativos) { const k = nomes[o.status] || o.status; porStatus[k] = (porStatus[k] || 0) + 1 }
  const analise = ativos.filter(o => o.status === 'analise').map(o => tsDoPedido(o.created_at)).filter(x => !isNaN(x)).sort()
  const cfg = db.prepare('SELECT store_open, caixa_open FROM store_config WHERE tenant_id=?').get(tid) || {}
  const hoje = resumoVendas(db, tid, { periodo: 'hoje', comparar: true })
  return {
    agora: new Date(Date.now() - BR).toISOString().slice(11, 16), loja_aberta: cfg.store_open === undefined ? null : !!cfg.store_open, caixa_aberto: cfg.caixa_open === undefined ? null : !!cfg.caixa_open,
    pedidos_em_andamento: ativos.length, por_situacao: porStatus,
    pedido_mais_antigo_em_analise_ha_minutos: analise.length ? Math.round((Date.now() - analise[0]) / 60000) : null,
    valor_em_andamento: r2(ativos.reduce((s, o) => s + (Number(o.total) || 0) + (Number(o.taxa) || 0), 0)),
    hoje: { faturamento: hoje.faturamento, pedidos_concluidos: hoje.pedidos_concluidos, ticket_medio: hoje.ticket_medio, cancelados: hoje.cancelamentos.quantidade, comparado_com_ontem_ate_esta_hora: hoje.comparacao_com_periodo_anterior }
  }
}

function cardapio(db, tid, a = {}) {
  const cat = catalogo(db, tid)
  const cats = db.prepare('SELECT name, label, ativo FROM categories WHERE tenant_id=?').all(tid)
  const ativos = cat.filter(ativoNoCardapio)
  const precos = ativos.map(m => Number(m.price) || 0).filter(p => p > 0).sort((x, y) => x - y)
  const out = {
    produtos_no_cardapio: cat.length, ativos: ativos.length,
    pausados: cat.filter(m => String(m.status).toLowerCase() === 'pausado').map(m => m.name),
    esgotados: cat.filter(m => String(m.status).toLowerCase() === 'esgotado').map(m => m.name),
    categorias: cats.length, sem_foto: ativos.filter(m => !m.image_url).length, sem_descricao: ativos.filter(m => !String(m.description || '').trim()).length,
    em_promocao: ativos.filter(m => m.promo || (m.price_old && Number(m.price_old) > Number(m.price))).map(m => m.name).slice(0, 15),
    em_destaque: ativos.filter(m => m.destaque).map(m => m.name).slice(0, 15),
    preco_mais_barato: precos.length ? r2(precos[0]) : null, preco_mais_caro: precos.length ? r2(precos[precos.length - 1]) : null, preco_medio: precos.length ? r2(precos.reduce((s, p) => s + p, 0) / precos.length) : null
  }
  if (a.busca) {
    const q = norm(a.busca)
    out.busca = cat.filter(m => norm(m.name).includes(q) || norm(m.cat || m.cat_key).includes(q)).slice(0, 20).map(m => ({ produto: m.name, preco: r2(m.price), categoria: m.cat || m.cat_key || null, situacao: ativoNoCardapio(m) ? 'ativo' : m.status, tem_foto: !!m.image_url }))
  }
  if (a.listar_sem_foto) out.lista_sem_foto = ativos.filter(m => !m.image_url).map(m => m.name).slice(0, 30)
  try { out.estoque_abaixo_do_minimo = db.prepare('SELECT name, qty, unit, min_qty FROM estoque WHERE tenant_id=? AND min_qty IS NOT NULL AND min_qty > 0 AND qty <= min_qty ORDER BY name').all(tid).slice(0, 20) } catch (e) { /* loja sem estoque */ }
  return out
}

function avaliacoes(db, tid, a = {}) {
  const P = periodo({ periodo: 'ultimos_30_dias', ...a })
  const lista = db.prepare('SELECT nota, comentario, client, created_at FROM ratings WHERE tenant_id=? AND datetime(created_at) >= ? AND datetime(created_at) < ? ORDER BY created_at DESC').all(tid, sqlDe(P.ini), sqlDe(P.fim))
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }; lista.forEach(r => { dist[r.nota] = (dist[r.nota] || 0) + 1 })
  const fmt = r => ({ nota: r.nota, comentario: String(r.comentario || '').slice(0, 200), cliente: r.client || null, data: fmtData(dataDe(tsDoPedido(r.created_at))) })
  return {
    periodo: P.rotulo, avaliacoes: lista.length, media: lista.length ? Math.round(lista.reduce((s, r) => s + (Number(r.nota) || 0), 0) / lista.length * 10) / 10 : null, distribuicao: dist,
    reclamacoes_recentes: lista.filter(r => r.nota <= 3 && String(r.comentario || '').trim()).slice(0, 6).map(fmt),
    elogios_recentes: lista.filter(r => r.nota >= 4 && String(r.comentario || '').trim()).slice(0, 4).map(fmt)
  }
}

function bairros(db, tid, a = {}) {
  const P = periodo({ periodo: 'ultimos_30_dias', ...a })
  const lista = pedidos(db, tid, P.ini, P.fim).filter(o => o.valido && tipoVenda(o) === 'delivery')
  const m = new Map()
  for (const o of lista) { const b = bairroDe(o.addr) || 'Não informado'; const k = norm(b); const g = m.get(k) || { bairro: b, pedidos: 0, faturamento: 0, taxas: 0 }; g.pedidos++; g.faturamento += o.valor; g.taxas += Number(o.taxa) || 0; m.set(k, g) }
  const ord = [...m.values()].sort((x, y) => y.pedidos - x.pedidos)
  return { periodo: P.rotulo, pedidos_de_delivery: lista.length, bairros: ord.slice(0, Math.min(Number(a.limite) || 10, 25)).map(g => ({ bairro: g.bairro, pedidos: g.pedidos, faturamento: r2(g.faturamento), taxa_media: g.pedidos ? r2(g.taxas / g.pedidos) : 0 })) }
}

function lerJson(v) { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(v) || {} } catch (e) { return {} } }

// Retrato da loja nos últimos 30 dias, com os sinais que viram dicas de venda
function diagnostico(db, tid) {
  const r = resumoVendas(db, tid, { periodo: 'ultimos_30_dias' })
  const prod = produtos(db, tid, { periodo: 'ultimos_30_dias', ordem: 'mais_vendidos', limite: 5, incluir_sem_venda: true })
  const fracos = produtos(db, tid, { periodo: 'ultimos_30_dias', ordem: 'menos_vendidos', limite: 5 })
  const hr = horarios(db, tid, { periodo: 'ultimos_30_dias' })
  const cli = clientes(db, tid, { tipo: 'resumo', periodo: 'ultimos_30_dias' })
  const card = cardapio(db, tid, {})
  const av = avaliacoes(db, tid, { periodo: 'ultimos_30_dias' })
  const cfg = db.prepare('SELECT cashback_config, fid_config, stamp_config, promo_automatica, ia_config FROM store_config WHERE tenant_id=?').get(tid) || {}
  let cupons = 0; try { cupons = db.prepare('SELECT COUNT(*) n FROM cupons WHERE tenant_id=? AND ativo=1').get(tid).n } catch (e) { /* sem tabela */ }
  const ia = lerJson(cfg.ia_config)
  return {
    periodo: r.periodo,
    vendas: { faturamento: r.faturamento, pedidos: r.pedidos_concluidos, ticket_medio: r.ticket_medio, comparacao_30_dias_antes: r.comparacao_com_periodo_anterior, cancelamento_pct: r.cancelamentos.percentual, cancelados: r.cancelamentos.quantidade, valor_cancelado: r.cancelamentos.valor, por_tipo_de_venda: r.por_tipo_de_venda },
    produtos_campeoes: prod.lista, produtos_que_menos_venderam: fracos.lista, produtos_sem_nenhuma_venda: prod.sem_nenhuma_venda_no_periodo,
    horarios: { fortes: hr.horarios_mais_fortes, fracos: hr.horarios_mais_fracos_com_venda, dia_mais_forte: hr.dia_mais_forte, dia_mais_fraco: hr.dia_mais_fraco },
    clientes: { compraram: cli.clientes_que_compraram, novos: cli.novos, recompra_pct: cli.recompra_pct, sumidos_ha_mais_de_30_dias: cli.sumidos_ha_mais_de_30_dias },
    cardapio: { ativos: card.ativos, sem_foto: card.sem_foto, sem_descricao: card.sem_descricao, pausados: card.pausados.length, esgotados: card.esgotados.length, em_promocao: card.em_promocao.length, em_destaque: card.em_destaque.length },
    avaliacoes: { media: av.media, quantidade: av.avaliacoes, reclamacoes: av.reclamacoes_recentes.length },
    ferramentas_de_venda_do_estimafood: {
      cupons_ativos: cupons, cashback_ligado: !!lerJson(cfg.cashback_config).ativo, fidelidade_ligada: !!lerJson(cfg.fid_config).ativo,
      cartao_fidelidade_selos_ligado: !!lerJson(cfg.stamp_config).ativo, promocao_automatica_ligada: !!lerJson(cfg.promo_automatica).ativo, robo_whatsapp_com_ia_ligado: !!ia.ativo
    }
  }
}

function infoLoja(db, tid) {
  const t = db.prepare('SELECT nome, segmento FROM tenants WHERE id=?').get(tid) || {}
  let nome = t.nome
  try { const c = db.prepare('SELECT store_name FROM store_config WHERE tenant_id=?').get(tid); if (c && c.store_name) nome = c.store_name } catch (e) { /* ok */ }
  return { nome: nome || 'sua loja', segmento: t.segmento || 'restaurante' }
}

module.exports = { periodo, PERIODOS, resumoVendas, produtos, produtoDetalhe, horarios, clientes, pedidosAgora, cardapio, avaliacoes, bairros, diagnostico, infoLoja, hojeBR, fmtData, bairroDe, VALIDOS }

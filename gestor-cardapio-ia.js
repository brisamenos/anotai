// ════════════════════════════════════════════════════════════════
// Criar cardápio por IA — gestor
//   1) o lojista escolhe até 10 fotos do cardápio (qualquer formato de imagem)
//   2) a IA lê as fotos (POST /api/cardapio-ia/ler)
//   3) o lojista revisa categorias, produtos, preços e adicionais
//   4) cria no cardápio (POST /api/cardapio-ia/criar) — só acrescenta, não apaga nada
// Módulo independente: injeta o próprio modal e estilos.
// ════════════════════════════════════════════════════════════════
(function () {
  const MAX_FOTOS = 10
  const LADO_MAX = 1600
  const st = { fotos: [], dados: null, lendo: false, criando: false, timer: null }

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const brl = v => (v === null || v === undefined || v === '' || isNaN(v)) ? '' : Number(v).toFixed(2).replace('.', ',')
  const lerNum = s => { const t = String(s || '').replace(/[^\d,.]/g, ''); if (!t) return null; const n = t.includes(',') ? parseFloat(t.replace(/\./g, '').replace(',', '.')) : parseFloat(t); return isFinite(n) ? Math.round(n * 100) / 100 : null }
  const toast = (t, m) => { try { sbToast(t, m) } catch { alert(m) } }

  function headers() {
    const h = { 'Content-Type': 'application/json' }
    const s = (typeof _sessao !== 'undefined' && _sessao) || (() => { try { return JSON.parse(sessionStorage.getItem('sys_session') || '{}') } catch { return {} } })()
    if (s?.tenant_id) h['x-tenant-id'] = s.tenant_id
    if (s?.token) h['Authorization'] = 'Bearer ' + s.token
    return h
  }
  async function api(path, body) {
    const r = await fetch(path, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
    let d = {}
    try { d = await r.json() } catch {}
    if (!r.ok) throw new Error(d.error || (r.status === 413 ? 'As fotos ficaram grandes demais. Envie menos fotos por vez.' : 'Não foi possível concluir. Tente de novo.'))
    return d
  }

  // ── estilos e modal ───────────────────────────────────────────
  function montar() {
    if (document.getElementById('modal-cardapio-ia')) return
    const css = document.createElement('style')
    css.textContent = `
#modal-cardapio-ia .modal{width:760px;max-width:96vw;padding:0;display:flex;flex-direction:column;max-height:92vh;overflow:hidden;background:var(--surface)!important;color:var(--text)}
#modal-cardapio-ia .modal h2{color:var(--text)}
.cia-head{padding:22px 24px 14px;border-bottom:1px solid rgba(127,127,127,.18)}
.cia-head h2{font-size:18px;font-weight:700;margin:0 40px 4px 0}
.cia-head p{font-size:12.5px;color:var(--muted2,var(--muted));line-height:1.5;margin:0}
.cia-body{padding:18px 24px;overflow-y:auto;flex:1;min-height:0}
.cia-foot{padding:14px 24px;border-top:1px solid rgba(127,127,127,.18);display:flex;gap:10px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
.cia-foot .cia-resumo{margin-right:auto;font-size:12px;color:var(--muted)}
.cia-drop{border:1.5px dashed rgba(127,127,127,.4);border-radius:14px;padding:26px 16px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s}
.cia-drop:hover,.cia-drop.on{border-color:var(--accent);background:var(--accent-dim,rgba(14,165,233,.08))}
.cia-drop strong{display:block;font-size:14px;margin:8px 0 4px}
.cia-drop span{font-size:12px;color:var(--muted)}
.cia-grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px;margin-top:14px}
.cia-foto{position:relative;aspect-ratio:3/4;border-radius:10px;overflow:hidden;background:rgba(127,127,127,.1);border:1px solid rgba(127,127,127,.2)}
.cia-foto img{width:100%;height:100%;object-fit:cover;display:block}
.cia-foto .cia-sem{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--muted);padding:8px;text-align:center}
.cia-foto button{position:absolute;top:5px;right:5px;width:26px;height:26px;border-radius:8px;border:0;background:rgba(0,0,0,.6);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.cia-foto i{position:absolute;left:6px;bottom:5px;font-style:normal;font-size:11px;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.8)}
.cia-dicas{margin-top:14px;font-size:12px;color:var(--muted);line-height:1.6}
.cia-prog{padding:36px 8px;text-align:center}
.cia-prog strong{display:block;font-size:15px;margin-bottom:6px}
.cia-prog span{font-size:12.5px;color:var(--muted)}
.cia-barra{height:6px;border-radius:99px;background:rgba(127,127,127,.18);overflow:hidden;margin:22px auto 0;max-width:420px}
.cia-barra div{height:100%;width:0;background:var(--accent);border-radius:99px;transition:width .6s ease}
.cia-aviso{font-size:12px;line-height:1.5;padding:10px 12px;border-radius:10px;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.35);color:inherit;margin-bottom:12px}
.cia-cat{border:1px solid rgba(127,127,127,.22);border-radius:14px;margin-bottom:14px;overflow:hidden}
.cia-cat-top{display:flex;gap:8px;align-items:center;padding:10px 12px;background:rgba(127,127,127,.07)}
.cia-cat-top input{flex:1;font-weight:700;font-size:14px}
.cia-cat-top small{font-size:11.5px;color:var(--muted);white-space:nowrap}
.cia-in{border-radius:8px;padding:7px 10px;font:inherit;font-size:13.5px;min-width:0;width:100%;min-height:38px;background:var(--surface2)!important;color:var(--text)!important;border:1px solid var(--border2,var(--border))!important;box-shadow:none!important}
.cia-in:focus{outline:none;border-color:var(--accent)!important}
.cia-in::placeholder{color:var(--muted)}
.cia-in:disabled{opacity:.75}
.cia-item{display:grid;grid-template-columns:22px 1fr 118px;gap:6px 10px;padding:10px 12px;border-top:1px solid rgba(127,127,127,.18);align-items:start}
.cia-item.off{opacity:.45}
.cia-item input[type=checkbox]{width:16px;height:16px;margin-top:8px;accent-color:var(--accent);cursor:pointer}
.cia-item .cia-desc{grid-column:2/4;font-size:12px}
.cia-item .cia-extra{grid-column:2/4;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.cia-chip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;padding:4px 9px;border-radius:99px;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.22);color:inherit;line-height:1.35}
.cia-chip button{border:0;background:none;color:var(--muted);cursor:pointer;font-size:13px;line-height:1;padding:0}
.cia-chip button:hover{color:var(--danger)}
.cia-chip.tam{border-color:var(--accent);background:var(--accent-dim,rgba(14,165,233,.08))}
.cia-conf{font-size:11.5px;font-weight:600;color:#b7791f;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);padding:3px 8px;border-radius:99px}
.cia-gcat{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px 10px;background:rgba(127,127,127,.07);border-top:1px solid rgba(127,127,127,.18);align-items:center}
.cia-gcat>span{font-size:11.5px;color:var(--muted)}
.cia-preco{text-align:right}
.cia-preco:disabled{font-size:12.5px;padding-left:6px}
@media(max-width:560px){.cia-item{grid-template-columns:22px 1fr 96px}.cia-body{padding:14px}.cia-head{padding:18px 16px 12px}.cia-foot{padding:12px 16px}}
`
    document.head.appendChild(css)
    const bg = document.createElement('div')
    bg.className = 'modal-bg'; bg.id = 'modal-cardapio-ia'
    bg.innerHTML = `<div class="modal">
      <button class="modal-close" onclick="ciaFechar()"></button>
      <div class="cia-head"><h2 id="cia-titulo">Criar cardápio por IA</h2><p id="cia-sub"></p></div>
      <div class="cia-body" id="cia-body"></div>
      <div class="cia-foot" id="cia-foot"></div>
    </div>
    <input type="file" id="cia-input" accept="image/*,.heic,.heif" multiple style="display:none">`
    document.body.appendChild(bg)
    document.getElementById('cia-input').addEventListener('change', e => { adicionar([...e.target.files]); e.target.value = '' })
  }

  function mostrar(on) {
    const el = document.getElementById('modal-cardapio-ia')
    if (on) el.classList.add('on'); else el.classList.remove('on')
  }

  // ── passo 1: fotos ────────────────────────────────────────────
  function telaFotos() {
    document.getElementById('cia-titulo').textContent = 'Criar cardápio por IA'
    document.getElementById('cia-sub').textContent = 'Envie até 10 fotos do seu cardápio impresso ou de outro aplicativo. A IA monta as categorias, os produtos, os preços e os adicionais, e você confere tudo antes de salvar.'
    const n = st.fotos.length
    document.getElementById('cia-body').innerHTML = `
      ${n < MAX_FOTOS ? `<div class="cia-drop" id="cia-drop" onclick="document.getElementById('cia-input').click()">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h3l2-2.5h6L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.6"/></svg>
        <strong>${n ? 'Adicionar mais fotos' : 'Escolher fotos do cardápio'}</strong>
        <span>JPG, PNG, WEBP ou foto do iPhone (HEIC). ${n ? `Ainda cabem ${MAX_FOTOS - n}.` : 'Você também pode arrastar as fotos para cá.'}</span>
      </div>` : ''}
      ${n ? `<div class="cia-grade">${st.fotos.map((f, i) => `<div class="cia-foto">
        ${f.url ? `<img src="${f.url}" alt="">` : `<div class="cia-sem">${esc(f.nome)}</div>`}
        <i>${i + 1}</i><button title="Remover foto" onclick="ciaRemover(${i})"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 2l6 6M8 2l-6 6"/></svg></button></div>`).join('')}</div>` : ''}
      <div class="cia-dicas">Para uma leitura melhor: fotografe uma página por vez, de frente, com boa luz e sem reflexo. Preços e nomes precisam estar nítidos.</div>`
    document.getElementById('cia-foot').innerHTML = `
      <span class="cia-resumo">${n ? `${n} de ${MAX_FOTOS} fotos` : ''}</span>
      <button class="btn bg" onclick="ciaFechar()">Cancelar</button>
      <button class="btn bp" ${n ? '' : 'disabled style="opacity:.5;pointer-events:none"'} onclick="ciaLer()">Ler cardápio</button>`
    const drop = document.getElementById('cia-drop')
    if (drop) {
      drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('on') })
      drop.addEventListener('dragleave', () => drop.classList.remove('on'))
      drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('on'); adicionar([...e.dataTransfer.files]) })
    }
  }

  // Reduz para no máximo 1600 px em JPEG. Se o navegador não abrir o arquivo
  // (HEIC no Chrome/Windows, por exemplo), manda o original e o servidor converte.
  async function preparar(file) {
    const nome = file.name || 'foto', tipo = (file.type || '').toLowerCase()
    let fonte = null
    try { fonte = await createImageBitmap(file) } catch {}
    if (!fonte) {
      try {
        const url = URL.createObjectURL(file)
        fonte = await new Promise((ok, err) => { const im = new Image(); im.onload = () => ok(im); im.onerror = err; im.src = url })
      } catch { fonte = null }
    }
    if (fonte) {
      const w0 = fonte.width || fonte.naturalWidth, h0 = fonte.height || fonte.naturalHeight
      const k = Math.min(1, LADO_MAX / Math.max(w0, h0))
      const cv = document.createElement('canvas')
      cv.width = Math.round(w0 * k); cv.height = Math.round(h0 * k)
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height)
      cx.drawImage(fonte, 0, 0, cv.width, cv.height)
      const url = cv.toDataURL('image/jpeg', 0.85)
      return { nome, tipo: 'image/jpeg', dados: url.split(',')[1], url }
    }
    if (file.size > 15 * 1024 * 1024) throw new Error(`"${nome}" é grande demais`)
    const b64 = await new Promise((ok, err) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = err; fr.readAsDataURL(file) })
    return { nome, tipo: tipo || (/\.hei[cf]$/i.test(nome) ? 'image/heic' : 'application/octet-stream'), dados: b64, url: null }
  }

  async function adicionar(files) {
    const imgs = files.filter(f => /^image\//i.test(f.type) || /\.(heic|heif|jpe?g|png|webp|gif|bmp|tiff?)$/i.test(f.name))
    if (files.length && !imgs.length) { toast('err', 'Escolha arquivos de imagem.'); return }
    const livres = MAX_FOTOS - st.fotos.length
    if (imgs.length > livres) toast('err', `Cabem no máximo ${MAX_FOTOS} fotos. ${livres ? `Adicionei só as ${livres} primeiras.` : ''}`)
    for (const f of imgs.slice(0, Math.max(0, livres))) {
      try { st.fotos.push(await preparar(f)) } catch (e) { toast('err', 'Não consegui abrir ' + (e.message || f.name)) }
    }
    telaFotos()
  }

  // ── passo 2: leitura ──────────────────────────────────────────
  function telaLendo() {
    const n = st.fotos.length
    document.getElementById('cia-sub').textContent = ''
    document.getElementById('cia-body').innerHTML = `<div class="cia-prog">
      <strong>Lendo ${n} ${n === 1 ? 'foto' : 'fotos'} do cardápio</strong>
      <span id="cia-etapa">Identificando categorias e produtos...</span>
      <div class="cia-barra"><div id="cia-barra"></div></div>
      <span style="display:block;margin-top:14px;font-size:11.5px">Pode levar até ${n > 4 ? 2 : 1} minuto${n > 4 ? 's' : ''}. Não feche esta janela.</span></div>`
    document.getElementById('cia-foot').innerHTML = ''
    const etapas = ['Identificando categorias e produtos...', 'Lendo preços e tamanhos...', 'Separando adicionais e opções...', 'Juntando as fotos em um cardápio só...']
    const total = (Math.ceil(n / 4) * 30 + 10) * 1000, t0 = Date.now()
    clearInterval(st.timer)
    st.timer = setInterval(() => {
      const p = Math.min(0.94, (Date.now() - t0) / total)
      const b = document.getElementById('cia-barra'); if (b) b.style.width = (p * 100).toFixed(1) + '%'
      const e = document.getElementById('cia-etapa'); if (e) e.textContent = etapas[Math.min(etapas.length - 1, Math.floor(p * etapas.length))]
    }, 700)
  }

  async function ler() {
    if (st.lendo || !st.fotos.length) return
    st.lendo = true
    telaLendo()
    try {
      const d = await api('/api/cardapio-ia/ler', { imagens: st.fotos.map(f => ({ nome: f.nome, tipo: f.tipo, dados: f.dados })) })
      ;(d.categorias || []).forEach(c => {
        c.grupos = c.grupos || []
        c.itens.forEach(it => { it.incluir = true; it.grupos = it.grupos || []; it.tamanhos = it.tamanhos || [] })
      })
      st.dados = d
      if (!d.categorias?.length) {
        telaFotos()
        toast('err', (d.avisos && d.avisos[0]) || 'Não encontrei produtos nas fotos. Tente fotos mais nítidas.')
        return
      }
      telaRevisao()
    } catch (e) {
      telaFotos()
      toast('err', e.message)
    } finally {
      clearInterval(st.timer); st.lendo = false
    }
  }

  // ── passo 3: revisão ──────────────────────────────────────────
  function chipsGrupo(g, onRemove) {
    const ops = (g.opcoes || []).slice(0, 4).map(o => esc(o.nome) + (o.preco ? ' +' + brl(o.preco) : '')).join(', ')
    const mais = (g.opcoes || []).length > 4 ? ` e mais ${(g.opcoes.length - 4)}` : ''
    const tipo = g.tipo === 'checkbox' ? 'várias' : 'escolhe 1'
    return `<span class="cia-chip" title="${esc((g.opcoes || []).map(o => o.nome + (o.preco ? ' +R$ ' + brl(o.preco) : '')).join('\n'))}"><b>${esc(g.nome)}</b> (${tipo}${g.obrigatorio ? ', obrigatório' : ''}): ${ops}${mais}<button title="Remover grupo" onclick="${onRemove}">&times;</button></span>`
  }

  function contar() {
    let itens = 0, conferir = 0
    ;(st.dados?.categorias || []).forEach(c => c.itens.forEach(it => { if (it.incluir) { itens++; if (it.duvida) conferir++ } }))
    return { itens, conferir }
  }

  function rodape() {
    const { itens, conferir } = contar()
    document.getElementById('cia-foot').innerHTML = `
      <span class="cia-resumo">${itens} ${itens === 1 ? 'produto selecionado' : 'produtos selecionados'}${conferir ? `, ${conferir} para conferir` : ''}</span>
      <button class="btn bg" onclick="ciaVoltar()">Trocar fotos</button>
      <button class="btn bp" ${itens ? '' : 'disabled style="opacity:.5;pointer-events:none"'} onclick="ciaCriar()">Criar ${itens} ${itens === 1 ? 'produto' : 'produtos'}</button>`
  }

  function telaRevisao() {
    const d = st.dados
    const nCat = d.categorias.length
    document.getElementById('cia-titulo').textContent = 'Confira o cardápio'
    document.getElementById('cia-sub').textContent = `Encontrei ${nCat} ${nCat === 1 ? 'categoria' : 'categorias'}. Corrija o que precisar e desmarque o que não quer criar. Os produtos entram no seu cardápio atual, sem apagar nada, e você pode adicionar fotos depois.`
    const avisos = [...(d.avisos || []), ...(d.falhas || []).map(f => `A foto ${f.foto} não foi lida: ${f.erro}`)]
    document.getElementById('cia-body').innerHTML = `
      ${avisos.length ? `<div class="cia-aviso">${avisos.map(esc).join('<br>')}</div>` : ''}
      ${d.categorias.map((c, ci) => `<div class="cia-cat">
        <div class="cia-cat-top">
          <input class="cia-in" value="${esc(c.nome)}" oninput="ciaSet(${ci},-1,'nome',this.value)" aria-label="Nome da categoria">
          <small>${c.itens.length} ${c.itens.length === 1 ? 'produto' : 'produtos'}</small>
        </div>
        ${c.grupos.length ? `<div class="cia-gcat"><span>Vale para todos desta categoria:</span>${c.grupos.map((g, gi) => chipsGrupo(g, `ciaTirarGrupo(${ci},-1,${gi})`)).join('')}</div>` : ''}
        ${c.itens.map((it, ii) => itemHtml(it, ci, ii)).join('')}
      </div>`).join('')}`
    rodape()
  }

  function itemHtml(it, ci, ii) {
    const temTam = it.tamanhos.length >= 2
    return `<div class="cia-item${it.incluir ? '' : ' off'}" id="cia-it-${ci}-${ii}">
      <input type="checkbox" ${it.incluir ? 'checked' : ''} onchange="ciaIncluir(${ci},${ii},this.checked)" title="Criar este produto">
      <input class="cia-in" value="${esc(it.nome)}" oninput="ciaSet(${ci},${ii},'nome',this.value)" aria-label="Nome do produto">
      ${temTam
        ? `<input class="cia-in cia-preco" value="desde ${brl(Math.min(...it.tamanhos.map(t => t.preco)))}" disabled title="O preço vem dos tamanhos">`
        : `<input class="cia-in cia-preco" inputmode="decimal" placeholder="Preço" value="${brl(it.preco)}" oninput="ciaSet(${ci},${ii},'preco',this.value)" aria-label="Preço">`}
      <input class="cia-in cia-desc" value="${esc(it.descricao)}" placeholder="Descrição (opcional)" oninput="ciaSet(${ci},${ii},'descricao',this.value)" aria-label="Descrição">
      ${(temTam || it.grupos.length || it.duvida || it.meio_a_meio) ? `<div class="cia-extra">
        ${it.duvida ? `<span class="cia-conf" title="Confira na foto">Conferir: ${esc(it.duvida)}</span>` : ''}
        ${temTam ? `<span class="cia-chip tam"><b>Tamanhos:</b> ${it.tamanhos.map(t => esc(t.nome) + ' ' + brl(t.preco)).join(', ')}<button title="Usar só o menor preço" onclick="ciaTirarTamanhos(${ci},${ii})">&times;</button></span>` : ''}
        ${it.meio_a_meio ? `<span class="cia-chip">Até ${it.max_sabores || 2} sabores<button title="Tirar meio a meio" onclick="ciaTirarMeio(${ci},${ii})">&times;</button></span>` : ''}
        ${it.grupos.map((g, gi) => chipsGrupo(g, `ciaTirarGrupo(${ci},${ii},${gi})`)).join('')}
      </div>` : ''}
    </div>`
  }

  function redesenharItem(ci, ii) {
    const el = document.getElementById(`cia-it-${ci}-${ii}`)
    if (el) el.outerHTML = itemHtml(st.dados.categorias[ci].itens[ii], ci, ii)
    rodape()
  }

  async function criar() {
    if (st.criando) return
    const { itens, conferir } = contar()
    if (!itens) return
    const semPreco = []
    st.dados.categorias.forEach(c => c.itens.forEach(it => { if (it.incluir && !(it.tamanhos.length >= 2) && !(it.preco > 0)) semPreco.push(it.nome) }))
    if (semPreco.length && !confirm(`${semPreco.length} ${semPreco.length === 1 ? 'produto está' : 'produtos estão'} sem preço (${semPreco.slice(0, 3).join(', ')}${semPreco.length > 3 ? '...' : ''}). Eles serão criados com preço zero. Continuar?`)) return
    if (conferir && !semPreco.length && !confirm(`${conferir} ${conferir === 1 ? 'produto está marcado' : 'produtos estão marcados'} para conferir. Criar mesmo assim?`)) return
    st.criando = true
    const btn = document.querySelector('#cia-foot .bp'); if (btn) { btn.textContent = 'Criando...'; btn.style.pointerEvents = 'none' }
    try {
      const r = await api('/api/cardapio-ia/criar', { categorias: st.dados.categorias })
      await recarregar()
      fechar(true)
      toast('ok', `${r.itens} ${r.itens === 1 ? 'produto criado' : 'produtos criados'}${r.categorias ? ` em ${r.categorias} ${r.categorias === 1 ? 'categoria nova' : 'categorias novas'}` : ''}.${r.repetidos ? ` ${r.repetidos} já ${r.repetidos === 1 ? 'existia e ficou' : 'existiam e ficaram'} como ${r.repetidos === 1 ? 'estava' : 'estavam'}.` : ''}`)
    } catch (e) {
      toast('err', e.message)
      rodape()
    } finally { st.criando = false }
  }

  async function recarregar() {
    try {
      const [ir, cr] = await Promise.all([sb.from('menu_items').select('*'), sb.from('categories').select('*').order('sort_order')])
      if (ir?.data) items = ir.data.map(mapItem)
      if (cr?.data) categories = cr.data.map(c => ({ id: c.id, name: c.name, label: c.label || c.name, type: c.type || 'Itens principais', promo: !!c.promo, imageUrl: c.image_url || null, open: false, garcomOculto: Number(c.garcom_oculto) === 1, cardapioOculto: Number(c.cardapio_oculto) === 1 }))
      ;['renderGestor', 'renderTable', 'populateCatSelects', 'atualizarQualidadeCardapio', 'renderPDV'].forEach(f => { try { if (typeof window[f] === 'function') window[f]() } catch {} })
    } catch (e) { console.warn('[cardapio-ia] recarregar', e) }
  }

  function fechar(forcar) {
    if (st.lendo && !forcar) { toast('err', 'Aguarde terminar a leitura das fotos.'); return }
    if (!forcar && st.dados && !confirm('Fechar sem criar os produtos? A leitura será perdida.')) return
    mostrar(false)
    clearInterval(st.timer)
    st.fotos = []; st.dados = null
  }

  // ── funções chamadas pelo HTML ────────────────────────────────
  window.abrirCardapioIA = function () {
    montar()
    if (!st.lendo) { st.fotos = []; st.dados = null; telaFotos() }
    mostrar(true)
  }
  window.ciaFechar = () => fechar(false)
  window.ciaRemover = i => { st.fotos.splice(i, 1); telaFotos() }
  window.ciaLer = ler
  window.ciaVoltar = () => { if (st.dados && !confirm('Voltar para as fotos? As correções feitas aqui serão perdidas.')) return; st.dados = null; telaFotos() }
  window.ciaCriar = criar
  window.ciaSet = (ci, ii, campo, v) => {
    const c = st.dados?.categorias?.[ci]; if (!c) return
    if (ii < 0) { c[campo] = v; return }
    const it = c.itens[ii]; if (!it) return
    if (campo === 'preco') { it.preco = lerNum(v); if (it.preco !== null && it.duvida && /pre[cç]o/i.test(it.duvida)) { it.duvida = null; redesenharItemDepois(ci, ii) } }
    else it[campo] = v
  }
  // não redesenha enquanto o usuário digita no campo de preço
  function redesenharItemDepois(ci, ii) {
    const el = document.getElementById(`cia-it-${ci}-${ii}`)
    const b = el?.querySelector('.cia-conf'); if (b) b.remove()
    rodape()
  }
  window.ciaIncluir = (ci, ii, on) => { const it = st.dados.categorias[ci].itens[ii]; it.incluir = on; redesenharItem(ci, ii) }
  window.ciaTirarGrupo = (ci, ii, gi) => {
    const c = st.dados.categorias[ci]
    if (ii < 0) { c.grupos.splice(gi, 1); telaRevisao(); return }
    c.itens[ii].grupos.splice(gi, 1); redesenharItem(ci, ii)
  }
  window.ciaTirarTamanhos = (ci, ii) => {
    const it = st.dados.categorias[ci].itens[ii]
    it.preco = Math.min(...it.tamanhos.map(t => t.preco)); it.tamanhos = []
    redesenharItem(ci, ii)
  }
  window.ciaTirarMeio = (ci, ii) => { const it = st.dados.categorias[ci].itens[ii]; it.meio_a_meio = false; redesenharItem(ci, ii) }
})()

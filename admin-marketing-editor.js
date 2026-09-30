// ═══════════════════════════════════════════════════════
// ADMIN-MARKETING-EDITOR.JS — editor visual de fluxos (canvas de nos estilo n8n)
// Arraste os nos pelo titulo, puxe da bolinha de saida ate outro no para ligar.
// Cada botao de resposta e cada linha de lista tem a propria saida.
// Funciona com mouse e com toque (arrastar, pinca para zoom, ou tocar na saida e depois no destino).
// Depende de admin-marketing.js (window.MKUI) e de helpers do admin.html (toast).
// ═══════════════════════════════════════════════════════
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ED = { d: null, sel: null, v: { x: 40, y: 40, z: 1 }, arm: null, drag: null, ptrs: new Map(), pinch: null, blobs: {}, seq: 0, sujo: false, ultimoCampo: null };

  // ── Definicao dos nos ──────────────────────────────
  const NOME = { gatilho: 'Gatilho', texto: 'Texto', imagem: 'Imagem', video: 'Vídeo', audio: 'Áudio', documento: 'Documento', botoes: 'Botões', lista: 'Lista', carrossel: 'Carrossel', espera: 'Espera', aguardar: 'Aguardar resposta', condicao: 'Condição', definir_var: 'Definir variável', notificar: 'Notificar atendente', pausar_robo: 'Pausar robô', chamar_fluxo: 'Chamar outro fluxo' };
  const CAT = { gatilho: 'g', texto: 'm', imagem: 'm', video: 'm', audio: 'm', documento: 'm', botoes: 'm', lista: 'm', carrossel: 'm', espera: 'l', aguardar: 'l', condicao: 'l', definir_var: 'l', notificar: 'a', pausar_robo: 'a', chamar_fluxo: 'a' };
  const GRUPOS = [
    ['Mensagens', ['texto', 'imagem', 'video', 'audio', 'documento', 'botoes', 'lista', 'carrossel']],
    ['Lógica', ['aguardar', 'condicao', 'espera', 'definir_var']],
    ['Ações', ['notificar', 'pausar_robo', 'chamar_fluxo']]
  ];
  const OPS = [['igual', 'é igual a'], ['contem', 'contém'], ['comeca', 'começa com'], ['termina', 'termina com'], ['regex', 'combina com regex'], ['numero', 'é um número'], ['email', 'é um e-mail'], ['telefone', 'é um telefone'], ['maior', 'é maior que'], ['menor', 'é menor que'], ['vazio', 'está vazio'], ['preenchido', 'está preenchido']];
  const OPS_SEM_VALOR = ['numero', 'email', 'telefone', 'vazio', 'preenchido'];
  const VARS_BASE = ['primeiro_nome', 'nome', 'loja', 'saudacao', 'pix', 'pix_chave', 'telefone', 'link_demo', 'cliente', 'hora', 'dia_semana'];

  const novoCartao = () => ({ midia: '', nome: '', texto: '', rodape: '', botoes: [{ tipo: 'resposta', titulo: '', valor: '' }] });
  const NOVO = {
    texto: () => ({ texto: '' }),
    imagem: () => ({ midia: '', nome: '', legenda: '' }),
    video: () => ({ midia: '', nome: '', legenda: '' }),
    audio: () => ({ midia: '', nome: '', gravado: true, segundos: 0 }),
    documento: () => ({ midia: '', nome: '', legenda: '' }),
    espera: () => ({ segundos: 3 }),
    botoes: () => ({ texto: '', rodape: '', midia: '', nome: '', botoes: [{ tipo: 'resposta', titulo: '', valor: '' }] }),
    lista: () => ({ titulo: '', texto: '', rodape: '', botao_texto: 'Ver opções', secoes: [{ titulo: 'Opções', linhas: [{ titulo: '', descricao: '', valor: '' }] }] }),
    carrossel: () => ({ modo: 'auto', intro: '', intervalo: 2, cartoes: [novoCartao(), novoCartao()] }),
    aguardar: () => ({ variavel: 'resposta', tipo_entrada: 'texto', msg_invalida: '', timeout_min: 30 }),
    condicao: () => ({ casos: [{ variavel: 'resposta', op: 'contem', valor: '' }] }),
    definir_var: () => ({ variavel: 'valor', valor: '' }),
    notificar: () => ({ texto: 'Novo contato: {{nome}} ({{telefone}})' }),
    pausar_robo: () => ({}),
    chamar_fluxo: () => ({ fluxo: null })
  };

  // Saidas de cada no (mesma regra do servidor)
  function portas(tipo, cfg = {}) {
    switch (tipo) {
      case 'botoes':
        return [...(cfg.botoes || []).map((b, j) => b.tipo === 'resposta' ? { id: 'b' + j, label: b.titulo || 'Botão' } : null).filter(Boolean), { id: 'out', label: 'Sempre continuar' }];
      case 'carrossel':
        return [...(cfg.cartoes || []).flatMap((k, i) => (k.botoes || []).map((b, j) => b.tipo === 'resposta' ? { id: `k${i}b${j}`, label: `Cartão ${i + 1}: ${b.titulo || 'Botão'}` } : null).filter(Boolean)), { id: 'out', label: 'Sempre continuar' }];
      case 'lista': {
        const rows = []; let k = 0;
        for (const s of cfg.secoes || []) for (const l of s.linhas || []) rows.push({ id: 'l' + (k++), label: l.titulo || 'Linha' });
        return [...rows, { id: 'out', label: 'Sempre continuar' }];
      }
      case 'aguardar': return [{ id: 'out', label: 'Resposta recebida' }, { id: 'timeout', label: 'Sem resposta' }];
      case 'condicao': return [...(cfg.casos || []).map((k, i) => ({ id: 'c' + i, label: rotuloCaso(k) })), { id: 'else', label: 'Senão' }];
      case 'chamar_fluxo': return [];
      case 'gatilho': return [{ id: 'out', label: 'Início' }];
      default: return [{ id: 'out', label: 'Próximo' }];
    }
  }
  function rotuloCaso(k) {
    const op = (OPS.find(o => o[0] === k.op) || [0, k.op])[1];
    return OPS_SEM_VALOR.includes(k.op) ? `${k.variavel} ${op}` : `${k.variavel} ${op} ${k.valor}`.trim();
  }

  function cortar(t, n) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
  function resumo(no) {
    const c = no.cfg || {};
    switch (no.tipo) {
      case 'gatilho': {
        const g = ED.d.gatilho;
        return g.tipo === 'manual' ? 'Somente disparo manual' : ((g.palavras || []).length ? 'Palavras: ' + cortar(g.palavras.join(', '), 70) : 'Defina as palavras-chave');
      }
      case 'texto': return cortar(c.texto, 110) || 'Mensagem vazia';
      case 'imagem': case 'video': case 'audio': case 'documento':
        return (c.midia ? (c.nome || 'arquivo enviado') : 'Sem arquivo') + (c.legenda ? ' · ' + cortar(c.legenda, 50) : '') + (no.tipo === 'audio' && c.gravado !== false ? ' · voz gravada' : '');
      case 'botoes': return cortar(c.texto, 90) || 'Mensagem vazia';
      case 'lista': return cortar(c.titulo || c.texto, 90) || 'Lista vazia';
      case 'carrossel': return `${(c.cartoes || []).length} cartão(ões)`;
      case 'espera': return `Esperar ${c.segundos || 1}s`;
      case 'aguardar': return `Guarda a resposta em {{${c.variavel}}} · até ${c.timeout_min} min`;
      case 'condicao': return (c.casos || []).length ? `${c.casos.length} regra(s)` : 'Sem regras';
      case 'definir_var': return `{{${c.variavel}}} = ${cortar(c.valor, 60)}`;
      case 'notificar': return cortar(c.texto, 100);
      case 'pausar_robo': return 'Passa a conversa para o atendimento humano';
      case 'chamar_fluxo': { const f = MKUI.fluxos().find(x => x.id === c.fluxo); return f ? 'Fluxo: ' + f.nome : 'Escolha o fluxo'; }
    }
    return '';
  }

  // ── Estilos ────────────────────────────────────────
  function css() {
    if ($('ed-css')) return;
    const st = document.createElement('style');
    st.id = 'ed-css';
    st.textContent = `
.ed{position:fixed;inset:0;z-index:230;background:var(--bg);display:none;flex-direction:column}
.ed.on{display:flex}
.ed-top{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border);background:var(--s1);flex-wrap:wrap}
.ed-nome{flex:1;min-width:140px;max-width:340px}
.ed-acts{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
.ed-main{flex:1;display:flex;min-height:0;position:relative}
.ed-pal{width:176px;overflow:auto;border-right:1px solid var(--border);background:var(--s1);padding:10px;flex-shrink:0}
.ed-pal h4{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin:12px 0 6px}
.ed-pal h4:first-child{margin-top:0}
.ed-pal button{display:block;width:100%;text-align:left;margin-bottom:5px;padding:7px 9px;border-radius:8px;border:1px solid var(--border);background:var(--s2);color:var(--text);font-size:12.5px;cursor:pointer;border-left:3px solid var(--c)}
.ed-pal button:hover{border-color:var(--border-hover);background:var(--s3)}
.ed-cv{flex:1;position:relative;overflow:hidden;touch-action:none;cursor:grab;background-color:var(--bg);background-image:radial-gradient(circle,rgba(148,163,184,.28) 1px,transparent 1px);background-size:24px 24px}
.ed-cv.pan{cursor:grabbing}
.ed-world{position:absolute;left:0;top:0;transform-origin:0 0;width:1px;height:1px}
.ed-svg{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.ed-svg .eg path.hit{stroke:transparent;stroke-width:16;fill:none;pointer-events:stroke}
.ed-svg .eg path.ln{stroke:var(--accent);stroke-width:2.2;fill:none}
.ed-svg .eg .xb{pointer-events:all;cursor:pointer}
.ed-svg .eg .xb circle{fill:var(--s1);stroke:var(--border-hover);stroke-width:1.2}
.ed-svg .eg .xb text{fill:var(--text-2);font-size:13px;text-anchor:middle;dominant-baseline:central;font-weight:700}
.ed-svg .eg:hover path.ln{stroke-width:3}
.ed-svg .ghost{stroke:var(--accent);stroke-width:2;stroke-dasharray:6 5;fill:none}
.nd{position:absolute;width:244px;background:var(--s1);border:1.5px solid var(--border-hover);border-radius:12px;box-shadow:0 6px 22px rgba(0,0,0,.28);--c:#3b82f6;cursor:default}
.nd.cat-g{--c:#22c55e}.nd.cat-l{--c:#f97316}.nd.cat-a{--c:#8b5cf6}
.nd.sel{border-color:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 28%,transparent),0 8px 26px rgba(0,0,0,.35)}
.nd-head{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:8px 10px;border-radius:10px 10px 0 0;background:color-mix(in srgb,var(--c) 16%,var(--s1));border-bottom:1px solid var(--border);font-size:11.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;cursor:grab;color:var(--text)}
.nd-x{width:22px;height:22px;border-radius:6px;border:0;background:transparent;color:var(--text-2);cursor:pointer;font-size:15px;line-height:1}
.nd-x:hover{color:var(--danger);background:rgba(239,68,68,.12)}
.nd-body{padding:9px 11px;font-size:12px;color:var(--text-2);line-height:1.45;word-break:break-word;min-height:20px}
.nd-ports{border-top:1px solid var(--border);padding:4px 0 6px}
.prt{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 24px 5px 11px;font-size:12px;color:var(--text)}
.prt span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pt{position:absolute;width:16px;height:16px;border-radius:50%;border:2.5px solid var(--c);background:var(--s1);top:50%;transform:translateY(-50%);cursor:crosshair;touch-action:none}
.pt::after{content:'';position:absolute;inset:-9px}
.pt-out{right:-9px}
.pt-out.on{background:var(--c)}
.pt-in{left:-9px;top:20px;transform:none;background:var(--c);cursor:default}
.ed-zoom{position:absolute;left:12px;bottom:12px;display:flex;gap:6px;z-index:5;flex-wrap:wrap}
.ed-zoom button{height:34px;min-width:34px;padding:0 10px;border-radius:9px;border:1px solid var(--border-hover);background:var(--s1);color:var(--text);cursor:pointer;font-size:12.5px;font-weight:700}
.ed-banner{position:absolute;left:50%;top:10px;transform:translateX(-50%);background:var(--accent);color:#fff;padding:7px 14px;border-radius:99px;font-size:12.5px;font-weight:700;z-index:6;display:none;max-width:90%;text-align:center}
.ed-side{width:370px;overflow:auto;border-left:1px solid var(--border);background:var(--s1);padding:14px;flex-shrink:0}
.ed-side-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.ed-side-t{font-family:'Space Grotesk',sans-serif;font-weight:800;font-size:15px}
.ed-help{font-size:12.5px;color:var(--text-2);line-height:1.6}
.ed-help li{margin:4px 0 4px 16px}
.ed-mob{display:none}
.ed-fld{margin-bottom:12px}
.ed-box{border:1px solid var(--border);border-radius:10px;padding:9px;margin-bottom:8px;background:var(--s2)}
.ed-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ed-ph{background:#0b141a;border-radius:12px;padding:10px;margin-top:10px}
.ed-ph .b{background:#202c33;color:#e9edef;border-radius:9px;padding:7px 10px;font-size:12.5px;line-height:1.45;word-break:break-word;white-space:pre-wrap;max-width:95%}
.ed-ph .b img,.ed-ph .b video{max-width:100%;border-radius:6px;display:block;margin-bottom:4px}
.ed-ph .b audio{width:100%}
.ed-ph .b small{display:block;color:#8696a0;font-size:11px;margin-top:3px}
.ed-ph .bt{display:block;text-align:center;color:#53bdeb;border-top:1px solid #2a3942;padding:7px 4px 2px;font-size:12.5px;margin-top:6px}
.ed-vars{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0 2px}
.ed-var{font-size:11px;padding:2px 8px;border-radius:6px;border:1px solid var(--border);background:var(--s1);color:var(--text-2);cursor:pointer;font-family:monospace}
.ed-var:hover{color:var(--text);border-color:var(--accent)}
.ed-file{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.ed-media{max-width:100%;max-height:140px;border-radius:8px;margin-top:6px;display:block}
.ed-check{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:var(--text-2);margin:7px 0;line-height:1.4;cursor:pointer}
.ed-check input{margin-top:2px}
@media(max-width:820px){
  .ed-pal{position:absolute;z-index:8;left:0;top:0;bottom:0;transform:translateX(-102%);transition:transform .18s;box-shadow:8px 0 30px rgba(0,0,0,.4)}
  .ed-pal.on{transform:none}
  .ed-side{position:absolute;z-index:7;left:0;right:0;bottom:0;width:auto;height:56%;border-left:0;border-top:1px solid var(--border-hover);border-radius:16px 16px 0 0;box-shadow:0 -10px 30px rgba(0,0,0,.4);display:none}
  .ed-side.on{display:block}
  .ed-mob{display:inline-flex}
  .ed-nome{min-width:0;max-width:none;flex-basis:100%;order:2}
  .ed-zoom{bottom:auto;top:10px;left:auto;right:10px}
  .ed-side.on ~ .ed-cv .ed-zoom{display:none}
}
`;
    document.head.appendChild(st);
  }

  // ── Casca do editor ────────────────────────────────
  function casca() {
    css();
    if ($('mked')) return;
    const el = document.createElement('div');
    el.className = 'ed'; el.id = 'mked';
    el.innerHTML = `
      <div class="ed-top">
        <button class="btn bg2 bsm" onclick="MKED.fechar()">Fechar</button>
        <button class="btn bg2 bsm ed-mob" onclick="MKED.paleta()">+ Adicionar nó</button>
        <input class="minput ed-nome" id="ed-nome" placeholder="Nome do fluxo" maxlength="80" oninput="MKED.nome(this.value)">
        <div class="ed-acts">
          <button class="btn bg2 bsm" onclick="MKED.testar()">Testar</button>
          <button class="btn bg2 bsm" onclick="MKED.salvar(false)">Salvar</button>
          <button class="btn bp bsm" onclick="MKED.salvar(true)">Salvar e ativar</button>
        </div>
      </div>
      <div class="ed-main">
        <div class="ed-pal" id="ed-pal"></div>
        <div class="ed-cv" id="ed-cv">
          <div class="ed-world" id="ed-world">
            <svg class="ed-svg" id="ed-svg"></svg>
            <div id="ed-nodes"></div>
          </div>
          <div class="ed-banner" id="ed-banner"></div>
          <div class="ed-zoom">
            <button title="Diminuir" onclick="MKED.zoom(-0.15)">−</button>
            <button title="Aumentar" onclick="MKED.zoom(0.15)">+</button>
            <button onclick="MKED.ajustar()">Centralizar</button>
            <button onclick="MKED.organizar()">Organizar</button>
          </div>
        </div>
        <div class="ed-side" id="ed-side"></div>
      </div>`;
    document.body.appendChild(el);
    montarPaleta();
    ligarEventos();
  }

  function montarPaleta() {
    $('ed-pal').innerHTML = GRUPOS.map(([g, tipos]) => `<h4>${g}</h4>` + tipos.map(t =>
      `<button style="--c:${{ g: '#22c55e', m: '#3b82f6', l: '#f97316', a: '#8b5cf6' }[CAT[t]]}" onclick="MKED.add('${t}')">${NOME[t]}</button>`).join('')).join('');
  }

  // ── Abrir / fechar ─────────────────────────────────
  function abrir(draft) {
    casca();
    ED.d = JSON.parse(JSON.stringify(draft));
    if (!ED.d.grafo || !ED.d.grafo.nodes) ED.d.grafo = { nodes: [{ id: 'inicio', tipo: 'gatilho', x: 60, y: 140, cfg: {} }], edges: [] };
    if (!ED.d.grafo.nodes.some(n => n.id === 'inicio')) ED.d.grafo.nodes.unshift({ id: 'inicio', tipo: 'gatilho', x: 60, y: 140, cfg: {} });
    ED.seq = Math.max(0, ...ED.d.grafo.nodes.map(n => parseInt(String(n.id).replace(/\D/g, ''), 10) || 0));
    ED.sel = null; ED.arm = null; ED.sujo = false;
    $('ed-nome').value = ED.d.nome || '';
    $('mked').classList.add('on');
    document.body.style.overflow = 'hidden';
    renderNos(); renderPainel();
    requestAnimationFrame(() => { ajustar(); });
  }
  function fechar(forcar) {
    if (!forcar && ED.sujo && !confirm('Fechar o editor? Alterações não salvas serão perdidas.')) return;
    $('mked').classList.remove('on');
    document.body.style.overflow = '';
    ED.d = null;
  }

  // ── Renderizacao dos nos ───────────────────────────
  const porId = id => ED.d.grafo.nodes.find(n => n.id === id);
  const temAresta = (de, porta) => ED.d.grafo.edges.some(e => e.de === de && e.porta === porta);

  function htmlNo(n) {
    const ps = portas(n.tipo, n.cfg);
    return `
      ${n.tipo !== 'gatilho' ? `<i class="pt pt-in" data-in="${n.id}"></i>` : ''}
      <div class="nd-head" data-drag="${n.id}"><span>${NOME[n.tipo]}</span>${n.tipo !== 'gatilho' ? `<button class="nd-x" data-del="${n.id}" title="Excluir nó">×</button>` : ''}</div>
      <div class="nd-body">${esc(resumo(n))}</div>
      ${ps.length ? `<div class="nd-ports">${ps.map(p => `<div class="prt"><span>${esc(p.label)}</span><i class="pt pt-out ${temAresta(n.id, p.id) ? 'on' : ''}" data-de="${n.id}" data-porta="${p.id}"></i></div>`).join('')}</div>` : ''}`;
  }
  function elNo(n) {
    const d = document.createElement('div');
    d.className = `nd cat-${CAT[n.tipo]}${ED.sel === n.id ? ' sel' : ''}`;
    d.dataset.id = n.id;
    d.style.left = n.x + 'px'; d.style.top = n.y + 'px';
    d.innerHTML = htmlNo(n);
    return d;
  }
  function renderNos() {
    const box = $('ed-nodes');
    box.innerHTML = '';
    ED.d.grafo.nodes.forEach(n => box.appendChild(elNo(n)));
    aplicarView();
    desenharArestas();
  }
  function atualizaNo(id) {
    const n = porId(id), old = document.querySelector(`#ed-nodes .nd[data-id="${id}"]`);
    if (!n || !old) return;
    old.replaceWith(elNo(n));
    desenharArestas();
  }
  function atualizaPortas() { // reaplica a marca de "ligada" nas bolinhas
    document.querySelectorAll('#ed-nodes .pt-out').forEach(p => p.classList.toggle('on', temAresta(p.dataset.de, p.dataset.porta)));
  }

  // ── Vista (pan/zoom) ───────────────────────────────
  function aplicarView() {
    const v = ED.v, cv = $('ed-cv');
    $('ed-world').style.transform = `translate(${v.x}px,${v.y}px) scale(${v.z})`;
    cv.style.backgroundSize = `${24 * v.z}px ${24 * v.z}px`;
    cv.style.backgroundPosition = `${v.x}px ${v.y}px`;
  }
  function zoomEm(px, py, novoZ) {
    const v = ED.v, z = Math.min(1.6, Math.max(0.3, novoZ));
    const wx = (px - v.x) / v.z, wy = (py - v.y) / v.z;
    v.z = z; v.x = px - wx * z; v.y = py - wy * z;
    aplicarView();
  }
  function zoom(delta) {
    const r = $('ed-cv').getBoundingClientRect();
    zoomEm(r.width / 2, r.height / 2, ED.v.z + delta);
  }
  function ajustar() {
    const cv = $('ed-cv'), r = cv.getBoundingClientRect(), nodes = ED.d.grafo.nodes;
    if (!nodes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    nodes.forEach(n => {
      const el = document.querySelector(`#ed-nodes .nd[data-id="${n.id}"]`);
      const h = el ? el.offsetHeight : 120;
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + 244); y1 = Math.max(y1, n.y + h);
    });
    const pad = 40, z = Math.min(1, (r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0));
    ED.v.z = Math.max(0.3, z);
    ED.v.x = pad + (r.width - pad * 2 - (x1 - x0) * ED.v.z) / 2 - x0 * ED.v.z;
    ED.v.y = pad + Math.max(0, (r.height - pad * 2 - (y1 - y0) * ED.v.z) / 2) - y0 * ED.v.z;
    aplicarView();
  }

  // Organiza em colunas por profundidade a partir do gatilho
  function organizar() {
    const g = ED.d.grafo, prof = new Map([['inicio', 0]]), fila = ['inicio'];
    while (fila.length) {
      const id = fila.shift();
      g.edges.filter(e => e.de === id).forEach(e => { if (!prof.has(e.para)) { prof.set(e.para, prof.get(id) + 1); fila.push(e.para); } });
    }
    let extra = Math.max(...prof.values()) + 1;
    g.nodes.forEach(n => { if (!prof.has(n.id)) prof.set(n.id, extra); });
    const cols = new Map();
    g.nodes.forEach(n => { const p = prof.get(n.id); if (!cols.has(p)) cols.set(p, []); cols.get(p).push(n); });
    [...cols.entries()].sort((a, b) => a[0] - b[0]).forEach(([p, ns]) => {
      let y = 40;
      ns.forEach(n => {
        const el = document.querySelector(`#ed-nodes .nd[data-id="${n.id}"]`);
        n.x = 40 + p * 320; n.y = y; y += (el ? el.offsetHeight : 140) + 36;
      });
    });
    ED.sujo = true;
    renderNos(); ajustar();
  }

  // ── Setas ──────────────────────────────────────────
  function centro(el) {
    const r = el.getBoundingClientRect(), w = $('ed-world').getBoundingClientRect(), z = ED.v.z;
    return { x: (r.left + r.width / 2 - w.left) / z, y: (r.top + r.height / 2 - w.top) / z };
  }
  const curva = (a, b) => {
    const dx = Math.max(50, Math.min(220, Math.abs(b.x - a.x) / 2));
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  };
  function desenharArestas() {
    const svg = $('ed-svg');
    if (!svg) return;
    let h = '';
    ED.d.grafo.edges.forEach((e, i) => {
      const o = document.querySelector(`#ed-nodes .pt-out[data-de="${e.de}"][data-porta="${e.porta}"]`);
      const t = document.querySelector(`#ed-nodes .pt-in[data-in="${e.para}"]`);
      if (!o || !t) return;
      const a = centro(o), b = centro(t), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      h += `<g class="eg"><path class="hit" d="${curva(a, b)}"/><path class="ln" d="${curva(a, b)}"/>
        <g class="xb" data-xe="${i}"><circle cx="${mx}" cy="${my}" r="10"/><text x="${mx}" y="${my}">×</text></g></g>`;
    });
    svg.innerHTML = h + '<path class="ghost" id="ed-ghost" d="" style="display:none"/>';
  }
  function fantasma(a, b) {
    const g = $('ed-ghost');
    if (!g) return;
    if (!b) { g.style.display = 'none'; return; }
    g.setAttribute('d', curva(a, b)); g.style.display = '';
  }

  function ligar(de, porta, para) {
    if (de === para || para === 'inicio') return;
    const g = ED.d.grafo;
    g.edges = g.edges.filter(e => !(e.de === de && e.porta === porta));
    g.edges.push({ de, porta, para });
    ED.sujo = true;
    atualizaPortas(); desenharArestas();
  }
  function tirarArmado() { ED.arm = null; banner(''); }
  function banner(t) { const b = $('ed-banner'); b.style.display = t ? 'block' : 'none'; b.textContent = t; }

  // ── Eventos do canvas (mouse + toque) ──────────────
  function mundo(e) {
    const w = $('ed-world').getBoundingClientRect();
    return { x: (e.clientX - w.left) / ED.v.z, y: (e.clientY - w.top) / ED.v.z };
  }
  function ligarEventos() {
    const cv = $('ed-cv');

    cv.addEventListener('pointerdown', e => {
      ED.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ED.ptrs.size === 2) { // pinca
        const [a, b] = [...ED.ptrs.values()];
        ED.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: ED.v.z };
        ED.drag = null;
        return;
      }
      if (e.target.closest('[data-del]') || e.target.closest('[data-xe]')) return; // tratados no click
      const out = e.target.closest('.pt-out');
      const head = e.target.closest('.nd-head');
      const nd = e.target.closest('.nd');
      cv.setPointerCapture(e.pointerId);
      if (out) {
        ED.drag = { k: 'liga', de: out.dataset.de, porta: out.dataset.porta, ox: e.clientX, oy: e.clientY, moved: false, a: centro(out) };
      } else if (head) {
        const n = porId(head.dataset.drag);
        ED.drag = { k: 'no', id: n.id, ox: e.clientX, oy: e.clientY, nx: n.x, ny: n.y, moved: false };
      } else if (nd) {
        ED.drag = { k: 'sel', id: nd.dataset.id, ox: e.clientX, oy: e.clientY, moved: false };
      } else {
        ED.drag = { k: 'pan', ox: e.clientX, oy: e.clientY, vx: ED.v.x, vy: ED.v.y, moved: false };
        cv.classList.add('pan');
      }
    });

    cv.addEventListener('pointermove', e => {
      if (ED.ptrs.has(e.pointerId)) ED.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ED.pinch && ED.ptrs.size >= 2) {
        const [a, b] = [...ED.ptrs.values()], r = cv.getBoundingClientRect();
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        zoomEm((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, ED.pinch.z0 * d / ED.pinch.d0);
        return;
      }
      const d = ED.drag;
      if (!d) return;
      const dx = e.clientX - d.ox, dy = e.clientY - d.oy;
      if (!d.moved && Math.hypot(dx, dy) < 5) return;
      d.moved = true;
      if (d.k === 'pan') { ED.v.x = d.vx + dx; ED.v.y = d.vy + dy; aplicarView(); }
      else if (d.k === 'no') {
        const n = porId(d.id);
        n.x = Math.round(d.nx + dx / ED.v.z); n.y = Math.round(d.ny + dy / ED.v.z);
        const el = document.querySelector(`#ed-nodes .nd[data-id="${d.id}"]`);
        el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
        ED.sujo = true;
        desenharArestas();
      } else if (d.k === 'liga') fantasma(d.a, mundo(e));
    });

    const fim = e => {
      ED.ptrs.delete(e.pointerId);
      if (ED.pinch) { if (ED.ptrs.size < 2) ED.pinch = null; return; }
      const d = ED.drag; ED.drag = null;
      cv.classList.remove('pan');
      if (!d) return;
      if (d.k === 'liga') {
        fantasma(null, null);
        if (d.moved) {
          const alvo = document.elementFromPoint(e.clientX, e.clientY)?.closest('.nd');
          if (alvo) ligar(d.de, d.porta, alvo.dataset.id);
          tirarArmado();
        } else { // toque simples na bolinha: escolhe o destino no proximo toque
          ED.arm = { de: d.de, porta: d.porta };
          banner('Toque no nó de destino (ou no fundo para cancelar)');
        }
        return;
      }
      if (ED.arm && !d.moved) {
        const alvoId = d.k === 'sel' || d.k === 'no' ? d.id : null;
        if (alvoId) ligar(ED.arm.de, ED.arm.porta, alvoId);
        tirarArmado();
        return;
      }
      if (!d.moved) {
        if (d.k === 'sel' || d.k === 'no') selecionar(d.id);
        else selecionar(null);
      }
    };
    cv.addEventListener('pointerup', fim);
    cv.addEventListener('pointercancel', fim);

    cv.addEventListener('click', e => {
      const del = e.target.closest('[data-del]');
      if (del) { removerNo(del.dataset.del); return; }
      const xe = e.target.closest('[data-xe]');
      if (xe) { ED.d.grafo.edges.splice(parseInt(xe.dataset.xe, 10), 1); ED.sujo = true; atualizaPortas(); desenharArestas(); }
    });

    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      zoomEm(e.clientX - r.left, e.clientY - r.top, ED.v.z * (e.deltaY < 0 ? 1.1 : 0.9));
    }, { passive: false });

    document.addEventListener('keydown', e => {
      if (!$('mked') || !$('mked').classList.contains('on')) return;
      if (e.key === 'Escape') { tirarArmado(); return; }
      const tag = (e.target.tagName || '').toLowerCase();
      if ((e.key === 'Delete' || e.key === 'Backspace') && ED.sel && ED.sel !== 'inicio' && !['input', 'textarea', 'select'].includes(tag)) {
        e.preventDefault(); removerNo(ED.sel);
      }
    });
  }

  // ── Selecao e edicao de nos ────────────────────────
  function selecionar(id) {
    ED.sel = id;
    document.querySelectorAll('#ed-nodes .nd').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
    renderPainel();
    $('ed-pal').classList.remove('on');
  }

  function novoId() { return 'n' + (++ED.seq); }
  function livre(x, y) { // evita empilhar nos
    let yy = y;
    while (ED.d.grafo.nodes.some(n => Math.abs(n.x - x) < 200 && Math.abs(n.y - yy) < 110)) yy += 130;
    return yy;
  }
  function add(tipo) {
    const g = ED.d.grafo, cv = $('ed-cv').getBoundingClientRect();
    const selNo = ED.sel ? porId(ED.sel) : null;
    let x, y, ligarDe = null;
    if (selNo) {
      const livres = portas(selNo.tipo, selNo.cfg).filter(p => !temAresta(selNo.id, p.id));
      if (livres.length) ligarDe = livres[0];
      x = selNo.x + 300; y = selNo.y + (ligarDe ? Math.max(0, portas(selNo.tipo, selNo.cfg).findIndex(p => p.id === ligarDe.id)) * 34 : 0);
    } else {
      x = (cv.width / 2 - ED.v.x) / ED.v.z - 120; y = (cv.height / 3 - ED.v.y) / ED.v.z;
    }
    const n = { id: novoId(), tipo, x: Math.round(x), y: Math.round(livre(x, y)), cfg: NOVO[tipo]() };
    g.nodes.push(n);
    if (ligarDe) g.edges.push({ de: selNo.id, porta: ligarDe.id, para: n.id });
    ED.sujo = true;
    renderNos();
    selecionar(n.id);
    $('ed-pal').classList.remove('on');
  }

  function removerNo(id) {
    if (id === 'inicio') return;
    const g = ED.d.grafo;
    if (g.edges.some(e => e.de === id || e.para === id) && !confirm('Excluir este nó e as ligações dele?')) return;
    g.nodes = g.nodes.filter(n => n.id !== id);
    g.edges = g.edges.filter(e => e.de !== id && e.para !== id);
    ED.sujo = true;
    if (ED.sel === id) ED.sel = null;
    renderNos(); renderPainel();
  }

  // Remove um item indexado (botao b, linha l, regra c) e reajusta as setas seguintes
  function removeIndice(id, prefixo, idx) {
    const g = ED.d.grafo;
    g.edges = g.edges.filter(e => !(e.de === id && e.porta === prefixo + idx));
    g.edges.forEach(e => {
      if (e.de === id && e.porta.startsWith(prefixo)) { const k = parseInt(e.porta.slice(prefixo.length), 10); if (k > idx) e.porta = prefixo + (k - 1); }
    });
  }
  function soltaPorta(id, porta) { const g = ED.d.grafo; g.edges = g.edges.filter(e => !(e.de === id && e.porta === porta)); }

  // ── Painel lateral ─────────────────────────────────
  const inp = (k, v, ph, extra = '') => `<input class="minput" data-k="${k}" value="${esc(v)}" placeholder="${esc(ph || '')}" oninput="MKED.in(this)" ${extra}>`;
  const txa = (k, v, ph) => `<textarea class="minput" style="min-height:80px;resize:vertical" data-k="${k}" placeholder="${esc(ph || '')}" oninput="MKED.in(this)" onfocus="MKED.foco(this)">${esc(v)}</textarea>`;
  const sel = (v, opts) => opts.map(([val, txt]) => `<option value="${val}" ${String(v) === String(val) ? 'selected' : ''}>${txt}</option>`).join('');

  function nomesVars() {
    const extra = [];
    ED.d.grafo.nodes.forEach(n => { if ((n.tipo === 'aguardar' || n.tipo === 'definir_var') && n.cfg.variavel) extra.push(n.cfg.variavel); });
    return [...new Set([...VARS_BASE, ...extra])];
  }
  function chips() {
    return `<div class="ed-vars">${nomesVars().map(v => `<span class="ed-var" onclick="MKED.varr('${v}')">{{${v}}}</span>`).join('')}</div>
      <div class="form-hint">Toque numa variável para inserir no último campo de texto. Sem nome conhecido a variável fica vazia; use um padrão: {{primeiro_nome|cliente}}.</div>`;
  }

  function campoMidia(P, c, tipo, idx, k) {
    const KA = k == null ? '' : ',' + k;
    const tem = c.midia && !/^https?:/i.test(c.midia);
    const accept = { imagem: '.jpg,.jpeg,.png,.webp', video: '.mp4,.mov,.3gp,.webm', audio: '.mp3,.ogg,.opus,.m4a,.aac,.wav,.webm', documento: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip' }[tipo];
    let prev = '';
    if (tem) {
      if (tipo === 'imagem') prev = `<img class="ed-media" data-blob="${esc(c.midia)}">`;
      if (tipo === 'video') prev = `<video class="ed-media" controls data-blob="${esc(c.midia)}"></video>`;
      if (tipo === 'audio') prev = `<audio controls data-blob="${esc(c.midia)}" style="margin-top:6px;max-width:100%"></audio>`;
    }
    return `<div class="ed-up form-hint" style="display:none;font-weight:700;margin:0 0 6px"></div><div class="ed-file">
        <button class="btn bg2 bsm" onclick="MKED.arquivo(${idx},'${tipo}','${accept}'${KA})">${c.midia ? 'Trocar arquivo' : 'Escolher arquivo'}</button>
        <span class="form-hint" style="margin:0">${tem ? esc(c.nome || c.midia) : (c.midia ? '' : 'Nenhum arquivo')}</span>
        ${tem ? `<button class="btn bd bsm" onclick="MKED.limpaMidia(${idx}${KA})">Remover</button>` : ''}
      </div>
      ${tem ? '' : inp(P + 'midia', c.midia, 'ou cole um link público https://...')}
      ${prev}`;
  }

  function formNo(n, idx) {
    const P = `grafo.nodes.${idx}.cfg.`, c = n.cfg;
    switch (n.tipo) {
      case 'texto':
        return txa(P + 'texto', c.texto, 'Escreva a mensagem. Use *negrito* e _itálico_.') + chips();
      case 'imagem': case 'video':
        return campoMidia(P, c, n.tipo, idx) + `<label class="form-label" style="margin-top:8px">Legenda</label>` + txa(P + 'legenda', c.legenda, 'Opcional') + chips();
      case 'audio':
        return campoMidia(P, c, 'audio', idx) + `<label class="ed-check"><input type="checkbox" data-k="${P}gravado" ${c.gravado !== false ? 'checked' : ''} onchange="MKED.in(this)"> <span>Enviar como mensagem de voz gravada na hora ("gravando áudio..." e ícone de microfone)</span></label>`;
      case 'documento':
        return campoMidia(P, c, 'documento', idx) + `<label class="form-label" style="margin-top:8px">Nome do arquivo</label>` + inp(P + 'nome', c.nome, 'cardapio.pdf') + `<label class="form-label" style="margin-top:8px">Legenda</label>` + txa(P + 'legenda', c.legenda, 'Opcional');
      case 'espera':
        return `<label class="form-label">Esperar (segundos)</label>` + inp(P + 'segundos', c.segundos, '3', 'type="number" min="1" max="120"') + `<div class="form-hint">Pausa antes do próximo nó.</div>`;
      case 'botoes':
        return `<label class="form-label">Texto da mensagem</label>${txa(P + 'texto', c.texto, 'Ex: Qual opção você prefere?')}${chips()}
          <label class="form-label" style="margin-top:8px">Rodapé <span style="font-weight:400;text-transform:none">(opcional)</span></label>${inp(P + 'rodape', c.rodape, '', 'maxlength="60"')}
          <label class="form-label" style="margin-top:8px">Imagem no topo <span style="font-weight:400;text-transform:none">(opcional)</span></label>${campoMidia(P, c, 'imagem', idx)}
          <div class="form-hint" style="margin:10px 0 6px"><b>Botões (máx. 3).</b> Cada botão de <b>Resposta</b> ganha uma saída no nó: ligue essa saída ao que deve acontecer quando o cliente tocar nele.</div>
          ${(c.botoes || []).map((b, j) => `<div class="ed-box">
            <div class="ed-row">
              <div><label class="form-label">Tipo</label><select class="minput" data-k="${P}botoes.${j}.tipo" onchange="MKED.in(this,'estrutura')">${sel(b.tipo, [['resposta', 'Resposta'], ['link', 'Abrir link'], ['copiar', 'Copiar texto'], ['ligar', 'Ligar']])}</select></div>
              <div><label class="form-label">Título</label>${inp(`${P}botoes.${j}.titulo`, b.titulo, 'Até 20 letras', 'maxlength="20"')}</div>
            </div>
            ${b.tipo === 'resposta' ? '' : `<label class="form-label" style="margin-top:6px">${{ link: 'Link', copiar: 'Texto a copiar', ligar: 'Telefone com DDD' }[b.tipo]}</label>` + inp(`${P}botoes.${j}.valor`, b.valor, { link: 'https://seusite.com.br', copiar: '{{pix_chave}}', ligar: '85991234567' }[b.tipo])}
            <div style="text-align:right;margin-top:6px"><button class="btn bd bsm" onclick="MKED.rmBotao(${idx},${j})">Remover botão</button></div>
          </div>`).join('')}
          ${(c.botoes || []).length < 3 ? `<button class="btn bg2 bsm" onclick="MKED.addBotao(${idx})">Adicionar botão</button>` : ''}`;
      case 'carrossel':
        return `<label class="form-label">Como enviar</label><select class="minput" data-k="${P}modo" onchange="MKED.in(this,'no')">${sel(c.modo || 'auto', [['auto', 'Carrossel deslizante, com plano B'], ['sequencia', 'Cartões em sequência']])}</select>
          <div class="form-hint" style="margin:6px 0 8px">${(c.modo || 'auto') === 'auto' ? 'Tenta o carrossel deslizante nativo do WhatsApp (precisa de imagem em todos os cartões e de uma WuzAPI que tenha o recurso). Se não der, envia os cartões em sequência.' : 'Cada cartão chega como uma mensagem com imagem no topo, texto e até 3 botões, uma após a outra.'} Cada botão de <b>Resposta</b> ganha uma saída própria no nó.</div>
          ${(c.modo || 'auto') === 'auto' ? `<label class="form-label">Texto de abertura <span style="font-weight:400;text-transform:none">(opcional)</span></label>${txa(P + 'intro', c.intro, 'Ex: Veja nossos planos')}` : ''}
          <label class="form-label" style="margin-top:8px">Intervalo entre cartões, no envio em sequência (segundos)</label>${inp(P + 'intervalo', c.intervalo, '2', 'type="number" min="1" max="10"')}
          ${(c.cartoes || []).map((k, ki) => {
            const Q = `${P}cartoes.${ki}.`;
            return `<div class="ed-box"><div class="form-hint" style="margin:0 0 6px"><b>Cartão ${ki + 1}</b></div>
              <label class="form-label">Imagem no topo <span style="font-weight:400;text-transform:none">(opcional)</span></label>${campoMidia(Q, k, 'imagem', idx, ki)}
              <label class="form-label" style="margin-top:8px">Texto</label>${txa(Q + 'texto', k.texto, 'Ex: *Plano Básico* - R$ 99/mês')}
              <label class="form-label" style="margin-top:8px">Rodapé <span style="font-weight:400;text-transform:none">(opcional)</span></label>${inp(Q + 'rodape', k.rodape, '', 'maxlength="60"')}
              ${(k.botoes || []).map((b, j) => `<div class="ed-box">
                <div class="ed-row">
                  <div><label class="form-label">Tipo</label><select class="minput" data-k="${Q}botoes.${j}.tipo" onchange="MKED.in(this,'estrutura')">${sel(b.tipo, [['resposta', 'Resposta'], ['link', 'Abrir link'], ['copiar', 'Copiar texto'], ['ligar', 'Ligar']])}</select></div>
                  <div><label class="form-label">Título</label>${inp(`${Q}botoes.${j}.titulo`, b.titulo, 'Até 20 letras', 'maxlength="20"')}</div>
                </div>
                ${b.tipo === 'resposta' ? '' : `<label class="form-label" style="margin-top:6px">${{ link: 'Link', copiar: 'Texto a copiar', ligar: 'Telefone com DDD' }[b.tipo]}</label>` + inp(`${Q}botoes.${j}.valor`, b.valor, { link: 'https://seusite.com.br', copiar: '{{pix_chave}}', ligar: '85991234567' }[b.tipo])}
                <div style="text-align:right;margin-top:6px"><button class="btn bd bsm" onclick="MKED.rmBotaoCartao(${idx},${ki},${j})">Remover botão</button></div>
              </div>`).join('')}
              <div style="display:flex;gap:6px;justify-content:space-between;margin-top:6px">
                ${(k.botoes || []).length < 3 ? `<button class="btn bg2 bsm" onclick="MKED.addBotaoCartao(${idx},${ki})">Adicionar botão</button>` : '<span></span>'}
                <button class="btn bd bsm" onclick="MKED.rmCartao(${idx},${ki})">Remover cartão</button>
              </div></div>`;
          }).join('')}
          ${(c.cartoes || []).length < 10 ? `<button class="btn bg2 bsm" onclick="MKED.addCartao(${idx})">Adicionar cartão</button>` : ''}
          ${chips()}`;
      case 'lista': {
        let k = 0;
        return `<div class="ed-row"><div><label class="form-label">Título</label>${inp(P + 'titulo', c.titulo, '', 'maxlength="60"')}</div>
          <div><label class="form-label">Texto do botão</label>${inp(P + 'botao_texto', c.botao_texto, 'Ver opções', 'maxlength="20"')}</div></div>
          <label class="form-label" style="margin-top:8px">Texto da mensagem</label>${txa(P + 'texto', c.texto, 'Ex: Escolha uma das opções')}${chips()}
          <label class="form-label" style="margin-top:8px">Rodapé <span style="font-weight:400;text-transform:none">(opcional)</span></label>${inp(P + 'rodape', c.rodape, '', 'maxlength="60"')}
          <div class="form-hint" style="margin:10px 0 6px"><b>Linhas (máx. 10 no total).</b> Cada linha ganha uma saída no nó.</div>
          ${(c.secoes || []).map((s, si) => `<div class="ed-box">
            <div style="display:flex;gap:6px;margin-bottom:8px">${inp(`${P}secoes.${si}.titulo`, s.titulo, 'Título da seção', 'maxlength="24"')}<button class="btn bd bsm" onclick="MKED.rmSecao(${idx},${si})">×</button></div>
            ${(s.linhas || []).map((l, li) => { const kk = k++; return `<div class="ed-box" style="background:var(--s1)">
              <div class="ed-row">${inp(`${P}secoes.${si}.linhas.${li}.titulo`, l.titulo, 'Título da linha', 'maxlength="24"')}${inp(`${P}secoes.${si}.linhas.${li}.descricao`, l.descricao, 'Descrição (opcional)', 'maxlength="72"')}</div>
              <div style="text-align:right;margin-top:6px"><button class="btn bd bsm" onclick="MKED.rmLinha(${idx},${si},${li},${kk})">Remover linha</button></div></div>`; }).join('')}
            <button class="btn bg2 bsm" onclick="MKED.addLinha(${idx},${si})">Adicionar linha</button></div>`).join('')}
          <button class="btn bg2 bsm" onclick="MKED.addSecao(${idx})">Adicionar seção</button>`;
      }
      case 'aguardar':
        return `<div class="form-hint" style="margin-bottom:10px">Depois deste nó o fluxo <b>para</b> e espera o cliente escrever. A próxima mensagem dele é guardada na variável abaixo. Ligue <b>Resposta recebida</b> ao próximo nó. Se quiser agir quando ele não responder, ligue também <b>Sem resposta</b>.</div>
          <div class="ed-row"><div><label class="form-label">Guardar em</label>${inp(P + 'variavel', c.variavel, 'resposta')}</div>
          <div><label class="form-label">Aceitar</label><select class="minput" data-k="${P}tipo_entrada" onchange="MKED.in(this)">${sel(c.tipo_entrada, [['texto', 'Qualquer texto'], ['numero', 'Só número'], ['email', 'Só e-mail'], ['telefone', 'Só telefone']])}</select></div></div>
          <label class="form-label" style="margin-top:8px">Aviso se a resposta for inválida <span style="font-weight:400;text-transform:none">(opcional)</span></label>${txa(P + 'msg_invalida', c.msg_invalida, 'Ex: Envie só números, por favor.')}
          <label class="form-label" style="margin-top:8px">Tempo limite (minutos)</label>${inp(P + 'timeout_min', c.timeout_min, '30', 'type="number" min="1" max="1440"')}
          <div class="form-hint">Use depois como {{${esc(c.variavel)}}} nas mensagens ou em uma Condição.</div>`;
      case 'condicao':
        return `<div class="form-hint" style="margin-bottom:10px">As regras são testadas em ordem. A primeira que valer segue pela sua saída; se nenhuma valer, segue por <b>Senão</b>.</div>
          <datalist id="ed-dl">${nomesVars().map(v => `<option value="${v}">`).join('')}</datalist>
          ${(c.casos || []).map((k, i) => `<div class="ed-box">
            <label class="form-label">Se a variável</label><input class="minput" list="ed-dl" data-k="${P}casos.${i}.variavel" value="${esc(k.variavel)}" oninput="MKED.in(this)">
            <div class="ed-row" style="margin-top:6px"><div><select class="minput" data-k="${P}casos.${i}.op" onchange="MKED.in(this,'estrutura')">${sel(k.op, OPS)}</select></div>
            <div>${OPS_SEM_VALOR.includes(k.op) ? '' : inp(`${P}casos.${i}.valor`, k.valor, 'valor')}</div></div>
            <div style="text-align:right;margin-top:6px"><button class="btn bd bsm" onclick="MKED.rmCaso(${idx},${i})">Remover regra</button></div></div>`).join('')}
          ${(c.casos || []).length < 8 ? `<button class="btn bg2 bsm" onclick="MKED.addCaso(${idx})">Adicionar regra</button>` : ''}
          <div class="form-hint" style="margin-top:8px">Variáveis úteis: hora (0 a 23), dia_semana (dom, seg, ter...), cliente (sim ou nao) e as que você criou em Aguardar resposta.</div>`;
      case 'definir_var':
        return `<div class="ed-row"><div><label class="form-label">Variável</label>${inp(P + 'variavel', c.variavel, 'valor')}</div></div>
          <label class="form-label" style="margin-top:8px">Valor</label>${txa(P + 'valor', c.valor, 'Texto ou outra variável, ex: {{primeiro_nome}}')}${chips()}`;
      case 'notificar':
        return `<div class="form-hint" style="margin-bottom:8px">Envia este aviso ao WhatsApp do atendente (configurado em Saques PIX, card "WhatsApp de Suporte e Vendas"). O cliente não vê.</div>${txa(P + 'texto', c.texto, 'Ex: Lead quente: {{nome}} ({{telefone}})')}${chips()}`;
      case 'pausar_robo':
        return `<div class="form-hint">Pausa o robô de atendimento nesta conversa por 30 minutos, para você ou sua equipe assumir. Nada é enviado ao cliente.</div>`;
      case 'chamar_fluxo':
        return `<label class="form-label">Fluxo a executar</label><select class="minput" data-k="${P}fluxo" onchange="MKED.in(this,'no')"><option value="">Escolha...</option>${MKUI.fluxos().filter(f => f.id !== ED.d.id).map(f => `<option value="${f.id}" ${c.fluxo === f.id ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}</select>
          <div class="form-hint">Passa a conversa para o começo do outro fluxo. Este caminho termina aqui.</div>`;
    }
    return '';
  }

  function blocoGatilho() {
    const g = ED.d.gatilho, o = ED.d.opcoes;
    const palavras = g.tipo === 'palavra' ? `
      <div class="ed-fld"><label class="form-label">Palavras-chave (uma por linha)</label>
        <textarea class="minput" style="min-height:80px;resize:vertical" data-k="gatilho.palavras" placeholder="promoção&#10;cardápio&#10;/pix" oninput="MKED.in(this)">${esc((g.palavras || []).join('\n'))}</textarea>
        <div class="form-hint">Sem diferença entre maiúsculas, minúsculas e acentos.</div></div>
      <div class="ed-row">
        <div class="ed-fld"><label class="form-label">Como comparar</label><select class="minput" data-k="gatilho.modo" onchange="MKED.in(this)">${sel(g.modo, [['contem', 'Contém a palavra'], ['exata', 'É exatamente a palavra'], ['inicia', 'Começa com a palavra']])}</select></div>
        <div class="ed-fld"><label class="form-label">Quem aciona</label><select class="minput" data-k="gatilho.publico" onchange="MKED.in(this)">${sel(g.publico, [['todos', 'Qualquer pessoa'], ['clientes', 'Só clientes'], ['nao_clientes', 'Só não clientes']])}</select></div>
      </div>
      <div class="ed-fld"><label class="form-label">Esperar antes de responder a mesma pessoa de novo (segundos)</label>${inp('opcoes.cooldown', o.cooldown, '30', 'type="number" min="0"')}</div>
      <label class="ed-check"><input type="checkbox" data-k="opcoes.ignorar_pausa" ${o.ignorar_pausa ? 'checked' : ''} onchange="MKED.in(this)"> <span>Responder mesmo quando eu assumi a conversa pelo celular</span></label>
      <label class="ed-check"><input type="checkbox" data-k="opcoes.aceita_meu_envio" ${o.aceita_meu_envio ? 'checked' : ''} onchange="MKED.in(this)"> <span>Também disparar quando <b>eu</b> digitar a palavra na conversa (só palavra exata; envia o fluxo ao cliente daquela conversa)</span></label>
      <label class="ed-check"><input type="checkbox" data-k="opcoes.pausar_robo" ${o.pausar_robo ? 'checked' : ''} onchange="MKED.in(this)"> <span>Pausar o robô de atendimento nessa conversa ao terminar</span></label>` : '';
    return palavras + `<label class="ed-check"><input type="checkbox" data-k="opcoes.presenca" ${o.presenca !== false ? 'checked' : ''} onchange="MKED.in(this)"> <span>Simular "digitando..." e "gravando áudio..." antes de cada mensagem</span></label>`;
  }

  function fmt(t) {
    const vars = { nome: 'Maria Souza', primeiro_nome: 'Maria', loja: 'Pizzaria Bom Sabor', saudacao: 'Bom dia', telefone: '5585991234567', pix: '12.345.678/0001-90', pix_chave: '12345678000190', link_demo: 'https://...' };
    return esc(String(t || '').replace(/\{\{\s*([a-z][a-z0-9_]*)\s*(?:\|([^}]*))?\}\}/gi, (_, k, pad) => vars[k.toLowerCase()] || (pad || '').trim() || '...')).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>');
  }
  function bolha(n) {
    const c = n.cfg || {};
    const m = (tag) => !c.midia ? '<i style="opacity:.6">sem arquivo</i><br>' : /^https?:/i.test(c.midia) ? (tag === 'img' ? `<img src="${esc(c.midia)}">` : '[link]<br>') : `<${tag} ${tag !== 'img' ? 'controls' : ''} data-blob="${esc(c.midia)}"></${tag}>`;
    switch (n.tipo) {
      case 'texto': return `<div class="b">${fmt(c.texto)}</div>`;
      case 'imagem': return `<div class="b">${m('img')}${fmt(c.legenda)}</div>`;
      case 'video': return `<div class="b">${m('video')}${fmt(c.legenda)}</div>`;
      case 'audio': return `<div class="b">${m('audio')}<small>${c.gravado !== false ? 'Mensagem de voz' : 'Arquivo de áudio'}</small></div>`;
      case 'documento': return `<div class="b">[Documento] ${esc(c.nome || '')}<br>${fmt(c.legenda)}</div>`;
      case 'botoes': return `<div class="b">${c.midia ? m('img') : ''}${fmt(c.texto)}${c.rodape ? `<small>${esc(c.rodape)}</small>` : ''}${(c.botoes || []).map(b => `<span class="bt">${{ link: '&#8599; ', copiar: '&#10063; ', ligar: '&#9990; ', resposta: '' }[b.tipo]}${esc(b.titulo || 'Botão')}</span>`).join('')}</div>`;
      case 'carrossel': return (c.cartoes || []).map(k => bolha({ tipo: 'botoes', cfg: k })).join('');
      case 'lista': return `<div class="b"><b>${esc(c.titulo)}</b>${c.titulo ? '<br>' : ''}${fmt(c.texto)}${c.rodape ? `<small>${esc(c.rodape)}</small>` : ''}<span class="bt">&#9776; ${esc(c.botao_texto || 'Ver opções')}</span></div>`;
    }
    return '';
  }

  function renderPainel() {
    const box = $('ed-side');
    if (!box || !ED.d) return;
    const n = ED.sel ? porId(ED.sel) : null;
    box.classList.toggle('on', !!n);
    if (!n) {
      box.innerHTML = `<div class="ed-side-t" style="margin-bottom:8px">Como montar o fluxo</div>
        <ul class="ed-help">
          <li>Toque em <b>Gatilho</b> para definir as palavras-chave que iniciam o fluxo.</li>
          <li>Adicione nós pela lista à esquerda (no celular, <b>+ Adicionar nó</b>). Com um nó selecionado, o novo já sai ligado a ele.</li>
          <li>Para ligar: arraste da <b>bolinha à direita</b> de um nó até o nó de destino, ou toque na bolinha e depois no destino.</li>
          <li>Em <b>Botões</b> e <b>Lista</b>, cada opção tem a própria saída: é o que acontece quando o cliente toca nela.</li>
          <li>Toque no <b>×</b> no meio da seta para desfazer a ligação.</li>
          <li>Arraste o fundo para mover a tela; use dois dedos ou os botões para o zoom.</li>
        </ul>`;
      return;
    }
    const idx = ED.d.grafo.nodes.findIndex(x => x.id === n.id);
    const corpo = n.tipo === 'gatilho' ? blocoGatilho() : formNo(n, idx);
    const prev = ['texto', 'imagem', 'video', 'audio', 'documento', 'botoes', 'lista', 'carrossel'].includes(n.tipo) ? `<div class="form-label" style="margin-top:14px">Como o cliente vê</div><div class="ed-ph">${bolha(n)}</div>` : '';
    box.innerHTML = `<div class="ed-side-h"><div class="ed-side-t">${NOME[n.tipo]}</div><div style="display:flex;gap:6px">
        ${n.tipo !== 'gatilho' ? `<button class="btn bd bsm" onclick="MKED.del()">Excluir nó</button>` : ''}
        <button class="btn bg2 bsm" onclick="MKED.sel(null)">Fechar</button></div></div>
      ${n.tipo === 'gatilho' ? `<div class="ed-fld"><label class="form-label">Quando este fluxo começa</label>
        <select class="minput" data-k="gatilho.tipo" onchange="MKED.in(this,'gatilho')">${sel(ED.d.gatilho.tipo, [['palavra', 'Quando alguém enviar uma palavra-chave'], ['manual', 'Somente por disparo manual (lista de contatos)']])}</select></div>` : ''}
      ${corpo}${prev}`;
    carregarBlobs();
  }

  // ── Edicao de campos ───────────────────────────────
  function setPath(obj, path, val) {
    const ks = path.split('.'); let o = obj;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = val;
  }
  function entrada(el, modo) {
    const k = el.dataset.k;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (k === 'gatilho.palavras') v = String(v).split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
    if (/\.fluxo$/.test(k)) v = v ? parseInt(v, 10) : null;
    if (/\.variavel$/.test(k)) v = String(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]+/g, '_').slice(0, 30);
    setPath(ED.d, k, v);
    ED.sujo = true;
    if (/\.tipo$/.test(k) && /botoes\.\d+\.tipo$/.test(k)) { // botao deixou de ser "resposta": solta a seta
      const m = /nodes\.(\d+)\.cfg\.botoes\.(\d+)\.tipo/.exec(k);
      if (v !== 'resposta') soltaPorta(ED.d.grafo.nodes[+m[1]].id, 'b' + m[2]);
    }
    const mc = /nodes\.(\d+)\.cfg\.cartoes\.(\d+)\.botoes\.(\d+)\.tipo$/.exec(k);
    if (mc && v !== 'resposta') soltaPorta(ED.d.grafo.nodes[+mc[1]].id, `k${mc[2]}b${mc[3]}`);
    const alvo = k.startsWith('grafo.nodes.') ? ED.d.grafo.nodes[+k.split('.')[2]] : porId('inicio');
    if (modo === 'gatilho') { renderPainel(); atualizaNo('inicio'); return; }
    if (modo === 'estrutura') { renderPainel(); if (alvo) { atualizaNo(alvo.id); atualizaPortas(); } return; }
    if (alvo) atualizaNo(alvo.id);
    if (modo === 'no') renderPainel();
    else refazBolha();
  }
  function refazBolha() {
    const ph = document.querySelector('#ed-side .ed-ph');
    const n = ED.sel ? porId(ED.sel) : null;
    if (ph && n) { ph.innerHTML = bolha(n); carregarBlobs(); }
  }
  function foco(el) { ED.ultimoCampo = el; }
  function varr(nome) {
    const el = ED.ultimoCampo;
    if (!el || !document.body.contains(el)) { toast('err', 'Toque primeiro no campo de texto onde quer inserir'); return; }
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, a) + `{{${nome}}}` + el.value.slice(b);
    el.focus(); el.selectionStart = el.selectionEnd = a + nome.length + 4;
    entrada(el);
  }
  function nomeFluxo(v) { ED.d.nome = v; ED.sujo = true; }

  // Estrutura dos botoes / listas / regras
  const cfgIdx = i => ED.d.grafo.nodes[i];
  function addBotao(i) { cfgIdx(i).cfg.botoes.push({ tipo: 'resposta', titulo: '', valor: '' }); reestrutura(i); }
  function rmBotao(i, j) { const n = cfgIdx(i); n.cfg.botoes.splice(j, 1); removeIndice(n.id, 'b', j); reestrutura(i); }
  function addCartao(i) { const n = cfgIdx(i); if (n.cfg.cartoes.length < 10) n.cfg.cartoes.push(novoCartao()); reestrutura(i); }
  function rmCartao(i, k) {
    const n = cfgIdx(i), g = ED.d.grafo;
    if (n.cfg.cartoes.length <= 1) { toast('err', 'O carrossel precisa de pelo menos um cartão'); return; }
    g.edges = g.edges.filter(e => !(e.de === n.id && new RegExp(`^k${k}b\\d+$`).test(e.porta)));
    g.edges.forEach(e => { const m = e.de === n.id && /^k(\d+)b(\d+)$/.exec(e.porta); if (m && +m[1] > k) e.porta = `k${+m[1] - 1}b${m[2]}`; });
    n.cfg.cartoes.splice(k, 1); reestrutura(i);
  }
  function addBotaoCartao(i, k) { const c = cfgIdx(i).cfg.cartoes[k]; if (c.botoes.length < 3) c.botoes.push({ tipo: 'resposta', titulo: '', valor: '' }); reestrutura(i); }
  function rmBotaoCartao(i, k, j) { const n = cfgIdx(i); n.cfg.cartoes[k].botoes.splice(j, 1); removeIndice(n.id, `k${k}b`, j); reestrutura(i); }
  function addSecao(i) { cfgIdx(i).cfg.secoes.push({ titulo: 'Opções', linhas: [{ titulo: '', descricao: '', valor: '' }] }); reestrutura(i); }
  function totalLinhas(n) { return n.cfg.secoes.reduce((t, s) => t + s.linhas.length, 0); }
  function addLinha(i, s) {
    const n = cfgIdx(i);
    if (totalLinhas(n) >= 10) { toast('err', 'A lista aceita no máximo 10 linhas no total'); return; }
    n.cfg.secoes[s].linhas.push({ titulo: '', descricao: '', valor: '' }); reestrutura(i);
  }
  function rmLinha(i, s, l, flat) { const n = cfgIdx(i); n.cfg.secoes[s].linhas.splice(l, 1); removeIndice(n.id, 'l', flat); reestrutura(i); }
  function rmSecao(i, s) {
    const n = cfgIdx(i);
    let inicio = 0; for (let x = 0; x < s; x++) inicio += n.cfg.secoes[x].linhas.length;
    const qtd = n.cfg.secoes[s].linhas.length;
    for (let q = 0; q < qtd; q++) removeIndice(n.id, 'l', inicio);
    n.cfg.secoes.splice(s, 1); reestrutura(i);
  }
  function addCaso(i) { cfgIdx(i).cfg.casos.push({ variavel: 'resposta', op: 'contem', valor: '' }); reestrutura(i); }
  function rmCaso(i, k) { const n = cfgIdx(i); n.cfg.casos.splice(k, 1); removeIndice(n.id, 'c', k); reestrutura(i); }
  function reestrutura(i) {
    ED.sujo = true;
    const n = cfgIdx(i);
    renderPainel(); atualizaNo(n.id); atualizaPortas();
  }

  // ── Midia ──────────────────────────────────────────
  // Reduz foto grande do celular (max 1600px, JPEG) antes de enviar: sobe mais rapido e nao estoura limite de tamanho
  async function reduzImagem(file) {
    if (file.size < 1.2 * 1048576 || !window.createImageBitmap) return file;
    try {
      const bmp = await createImageBitmap(file);
      const esc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * esc); cv.height = Math.round(bmp.height * esc);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.85));
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    } catch (_) { return file; }
  }
  const lerArquivo = f => new Promise((ok, no) => { const rd = new FileReader(); rd.onload = () => ok(rd.result); rd.onerror = () => no(new Error('Não consegui ler o arquivo')); rd.readAsDataURL(f); });
  function statusUpload(msg, erro) {
    document.querySelectorAll('#ed-side .ed-up').forEach(el => { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; el.style.color = erro ? '#f87171' : 'var(--accent)'; });
  }

  function arquivo(i, tipo, accept, k) {
    const f = document.createElement('input');
    f.type = 'file';
    f.accept = tipo === 'imagem' ? 'image/*,' + accept : tipo === 'video' ? 'video/*,' + accept : tipo === 'audio' ? 'audio/*,' + accept : accept;
    f.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(f); // no Android o input solto da pagina pode nunca disparar o "change"
    const limpa = () => setTimeout(() => f.remove(), 60000);
    f.addEventListener('change', async () => {
      let file = f.files[0];
      if (!file) { f.remove(); return; }
      try {
        statusUpload('Enviando ' + file.name + '...');
        toast('ok', 'Enviando arquivo...');
        if (tipo === 'imagem') file = await reduzImagem(file);
        const dados = await lerArquivo(file);
        const r = await MKUI.req('POST', '/midia', { nome: file.name, tipo, dados });
        const n = cfgIdx(i), alvo = k == null ? n.cfg : n.cfg.cartoes[k];
        alvo.midia = r.arquivo; alvo.nome = file.name;
        if (n.tipo === 'audio') n.cfg.segundos = r.segundos || 0;
        ED.blobs[r.arquivo] = URL.createObjectURL(file);
        ED.sujo = true;
        if (r.aviso) toast('err', r.aviso); else toast('ok', r.convertido ? 'Áudio enviado e convertido para mensagem de voz' : 'Arquivo enviado: ' + file.name);
        renderPainel(); atualizaNo(n.id);
        statusUpload('');
      } catch (e) {
        statusUpload('Falha no envio: ' + e.message, true);
        toast('err', 'Falha no envio: ' + e.message);
      }
      f.remove();
    });
    f.addEventListener('cancel', () => f.remove());
    limpa();
    f.click();
  }
  function limpaMidia(i, k) { const n = cfgIdx(i), alvo = k == null ? n.cfg : n.cfg.cartoes[k]; alvo.midia = ''; alvo.nome = ''; if (n.tipo === 'audio') n.cfg.segundos = 0; ED.sujo = true; renderPainel(); atualizaNo(n.id); }
  async function blobUrl(a) {
    if (ED.blobs[a]) return ED.blobs[a];
    const r = await fetch('/api/admin/marketing/midia/' + a, { headers: adminAuthHeader() });
    if (!r.ok) throw new Error('sem arquivo');
    return (ED.blobs[a] = URL.createObjectURL(await r.blob()));
  }
  function carregarBlobs() {
    document.querySelectorAll('#ed-side [data-blob]').forEach(async el => {
      if (el.src) return;
      try { el.src = await blobUrl(el.dataset.blob); } catch (_) {}
    });
  }

  // ── Salvar / testar ────────────────────────────────
  async function gravar(ativar, manter) {
    const d = ED.d;
    if (!String(d.nome || '').trim()) { toast('err', 'Dê um nome para o fluxo'); $('ed-nome').focus(); return null; }
    try {
      const r = await MKUI.req('POST', '/fluxos', d);
      d.id = r.fluxo.id; ED.sujo = false;
      if (ativar) {
        try { await MKUI.req('POST', `/fluxos/${d.id}/ativar`); toast('ok', 'Fluxo salvo e ativado'); }
        catch (e) { toast('err', 'Salvo, mas não ativou: ' + e.message); }
      } else if (!manter) toast('ok', 'Fluxo salvo');
      await MKUI.recarregar(!manter);
      return d.id;
    } catch (e) { toast('err', e.message); return null; }
  }
  async function salvar(ativar) {
    const id = await gravar(ativar, false);
    if (id) fechar(true);
  }
  async function testar() {
    const id = await gravar(false, true);
    if (id) MKUI.testar(id);
  }

  window.MKED = {
    abrir, fechar, salvar, testar, nome: nomeFluxo,
    add, del: () => ED.sel && removerNo(ED.sel), sel: selecionar,
    paleta: () => $('ed-pal').classList.toggle('on'),
    zoom, ajustar, organizar,
    in: entrada, foco, varr,
    addBotao, rmBotao, addCartao, rmCartao, addBotaoCartao, rmBotaoCartao, addSecao, rmSecao, addLinha, rmLinha, addCaso, rmCaso,
    arquivo, limpaMidia
  };
})();

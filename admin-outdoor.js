// ══════════════════════════════════════════════════════════════════════
// OUTDOOR (admin): anunciantes, pontos (comércios com TV) e aprovação dos
// vídeos que vão para a rede. Produto separado do EstimaFood.
// ══════════════════════════════════════════════════════════════════════
(function () {
  const O = { dados: null, aba: 'anunciantes', carregando: false, excluir: null, timer: null,
    envios: [], enviando: false, videos: {}, timerVid: null, aberto: null };
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const brl = v => 'R$ ' + (+v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dur = s => { s = Math.round(+s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const mb = b => { b = +b || 0; return b >= 1073741824 ? (b / 1073741824).toFixed(1).replace('.', ',') + ' GB' : Math.max(1, Math.round(b / 1048576)) + ' MB'; };
  const quando = iso => {
    if (!iso) return 'nunca se conectou';
    const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (min < 2) return 'agora há pouco';
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
  };

  const dataBR = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '-';
  const PILL_SIT = { em_dia: 'ok', aberta: 'azul', atrasado: 'esp', pausado: 'atr', desligada: 'off', loja: 'ok' };
  function pillFatura(f) {
    if (f.status === 'pago') return `<span class="od-pill ok">Paga${f.metodo === 'manual' ? ' (por fora)' : ''}</span>`;
    if (f.status === 'cancelado') return '<span class="od-pill off">Cancelada</span>';
    const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    return f.vence_em < hoje ? '<span class="od-pill atr">Atrasada</span>' : '<span class="od-pill esp">Em aberto</span>';
  }

  async function api(caminho, opts = {}) {
    const h = { ...(typeof adminAuthHeader === 'function' ? adminAuthHeader() : {}) };
    if (opts.body !== undefined) h['Content-Type'] = 'application/json';
    const r = await fetch(caminho, { method: opts.method || 'GET', headers: h, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Não foi possível concluir.');
    return d;
  }
  const aviso = (tipo, msg) => (typeof toast === 'function' ? toast(tipo, msg) : alert(msg));

  function css() {
    if ($('od-css')) return;
    const st = document.createElement('style');
    st.id = 'od-css';
    st.textContent = `
    #sec-outdoor .od-abas{display:flex;gap:6px;flex-wrap:wrap;margin:16px 0}
    #sec-outdoor .od-abas button{padding:8px 14px;border-radius:9px;border:1px solid var(--border);background:var(--s2);color:var(--text-2);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
    #sec-outdoor .od-abas button.on{background:var(--accent);border-color:var(--accent);color:#fff}
    #sec-outdoor .od-abas b{margin-left:6px;background:var(--danger);color:#fff;border-radius:99px;padding:1px 7px;font-size:11px}
    #sec-outdoor .od-topo{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
    #sec-outdoor .od-titulo{font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:800}
    #sec-outdoor .od-sub{font-size:12.5px;color:var(--muted);margin-top:4px;max-width:70ch;line-height:1.5}
    #sec-outdoor .od-vazio{padding:18px;border:1px dashed var(--border);border-radius:12px;color:var(--muted);font-size:13px;line-height:1.5}
    #sec-outdoor .od-grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
    #sec-outdoor .od-vid{border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--s2)}
    #sec-outdoor .od-vid video{width:100%;aspect-ratio:16/9;background:#000;display:block}
    #sec-outdoor .od-vid-info{padding:12px 14px}
    #sec-outdoor .od-vid-nome{font-weight:800;font-size:13.5px}
    #sec-outdoor .od-vid-det{font-size:12px;color:var(--muted);margin-top:3px}
    #sec-outdoor .od-vid-acoes{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
    #sec-outdoor .od-tab{width:100%;border-collapse:collapse;font-size:13px}
    #sec-outdoor .od-tab th{text-align:left;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;padding:8px 10px;border-bottom:1px solid var(--border)}
    #sec-outdoor .od-tab td{padding:10px;border-bottom:1px solid var(--border);vertical-align:middle}
    #sec-outdoor .od-tab tr:last-child td{border-bottom:0}
    #sec-outdoor .od-rolar{overflow-x:auto}
    #sec-outdoor .od-pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:800}
    #sec-outdoor .od-pill.ok{background:rgba(34,197,94,.14);color:#22c55e}
    #sec-outdoor .od-pill.off{background:rgba(148,163,184,.14);color:var(--muted)}
    #sec-outdoor .od-pill.esp{background:rgba(245,158,11,.15);color:#f59e0b}
    #sec-outdoor .od-ponto{border:1px solid var(--border);border-radius:12px;padding:14px 16px;background:var(--s2)}
    #sec-outdoor .od-ponto-topo{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start}
    #sec-outdoor .od-tela{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--border);font-size:12.5px;flex-wrap:wrap}
    #sec-outdoor .od-ponto-tv{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--muted)}
    #sec-outdoor .od-ponto-tv.on{background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.2)}
    #sec-outdoor .od-ligar{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
    #sec-outdoor .od-ligar .minput{width:130px;letter-spacing:3px;font-weight:800;text-align:center}
    #sec-outdoor select.minput.od-mini,#od-modal select.minput.od-mini{width:auto;padding:5px 8px;font-size:12px}
    #od-modal .modal{width:640px}
    #od-modal .od-checks{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px;max-height:220px;overflow:auto;padding:4px}
    #od-modal .od-checks label{display:flex;align-items:center;gap:8px;font-size:13px;padding:7px 9px;border:1px solid var(--border);border-radius:8px;cursor:pointer}
    #od-modal .od-checks input{width:16px;height:16px}
    #od-modal .od-mvid{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12.5px}
    #od-modal .od-mvid img{width:72px;height:40px;object-fit:cover;border-radius:6px;background:#000}
    #sec-outdoor .od-pill.atr{background:rgba(239,68,68,.12);color:var(--danger)}
    #sec-outdoor .od-pill.azul{background:rgba(59,130,246,.12);color:var(--accent)}
    #od-modal .od-pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:800}
    #od-modal .od-pill.ok{background:rgba(34,197,94,.14);color:#22c55e}
    #od-modal .od-pill.off{background:rgba(148,163,184,.14);color:var(--muted)}
    #od-modal .od-pill.esp{background:rgba(245,158,11,.15);color:#f59e0b}
    #od-modal .od-pill.atr{background:rgba(239,68,68,.12);color:var(--danger)}
    #od-modal .od-fat{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);font-size:12.5px;flex-wrap:wrap}
    #od-modal .od-fat:last-child{border-bottom:0}
    #od-modal .od-nova{border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:14px;background:var(--s2)}
    #od-modal .od-nova .mrow2{grid-template-columns:1fr 1fr}
    #sec-outdoor .od-fat-acoes,#od-modal .od-fat-acoes{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
    #sec-outdoor .od-pend{border:1px solid rgba(245,158,11,.45);background:rgba(245,158,11,.06)}
    #sec-outdoor .od-pend-item{padding:14px 0;border-top:1px solid var(--border)}
    #sec-outdoor .od-pend-item:first-of-type{border-top:0}
    #sec-outdoor .od-comparar{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px}
    #sec-outdoor .od-comparar video{width:100%;max-height:300px;background:#000;border-radius:10px;display:block}
    #sec-outdoor .od-comparar .rot{font-size:11.5px;color:var(--muted);font-weight:700;margin-bottom:5px}
    #sec-outdoor .od-pend-acoes{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center}
    #sec-outdoor .od-pend-acoes .minput{flex:1;min-width:200px}
    @media(max-width:640px){#od-modal .mrow2{grid-template-columns:1fr}#sec-outdoor .od-comparar{grid-template-columns:1fr}}
    `;
    document.head.appendChild(st);
  }

  async function carregar() {
    O.carregando = true;
    try {
      O.dados = await api('/api/outdoor/admin/resumo');
      if (O.aba === 'cobrancas') O.faturas = (await api('/api/outdoor/admin/faturas')).faturas;
    }
    catch (e) { O.dados = null; O.erro = e.message; }
    O.carregando = false;
    render();
    badge();
  }

  // Aviso no menu: trocas pedidas pelas lojas esperando aprovação
  function badge(n) {
    if (n === undefined) n = O.dados ? (O.dados.pendentes || []).length : 0;
    const b = $('nav-outdoor-badge');
    if (!b) return;
    b.textContent = n; b.title = n ? `${n} troca(s) de vídeo esperando sua aprovação` : '';
    b.style.display = n ? '' : 'none';
  }
  async function verPendentes() {
    try {
      if (typeof getAdminToken === 'function' && !getAdminToken()) return;
      const d = await api('/api/outdoor/admin/pendentes');
      const antes = O.ultimoPend;
      O.ultimoPend = d.n;
      badge(d.n);
      if (antes !== undefined && d.n > antes) aviso('ok', 'VisseTV: chegou um pedido de troca de vídeo para você aprovar.');
    } catch (e) {}
  }
  setTimeout(verPendentes, 4000);
  setInterval(verPendentes, 60000);

  function renderPendentes(d) {
    const lista = d.pendentes || [];
    if (!lista.length) return '';
    return `<div class="card od-pend"><div class="od-titulo" style="font-size:15px">Trocas esperando sua aprovação (${lista.length})</div>
      <div class="od-sub" style="margin-bottom:6px">A loja pediu para trocar o anúncio. Assista ao vídeo novo antes de aprovar. Se aprovar, o anúncio atual é apagado de vez e o novo entra no lugar em todas as TVs. Se recusar, a loja vê o motivo no painel dela.</div>
      ${lista.map(p => `<div class="od-pend-item">
        <div style="font-weight:800">${esc(p.anunciante_nome)}<span style="font-weight:600;color:var(--muted);font-size:12px"> pediu em ${new Date(p.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span></div>
        <div class="od-comparar">
          <div><div class="rot">Anúncio atual${p.atual_titulo ? ': ' + esc(p.atual_titulo) : ''}</div>${p.atual_arquivo ? `<video src="${esc(p.atual_arquivo)}" ${p.atual_capa ? `poster="${esc(p.atual_capa)}"` : ''} controls muted preload="none" playsinline></video>` : '<div class="od-vazio">Sem vídeo atual</div>'}</div>
          <div><div class="rot">Vídeo novo (${dur(p.duracao)}, ${mb(p.tamanho)})</div><video src="${esc(p.arquivo)}" ${p.capa ? `poster="${esc(p.capa)}"` : ''} controls muted preload="none" playsinline></video></div>
        </div>
        <div class="od-pend-acoes">
          <button class="btn bp" onclick="OUTDOORUI.aprovar(${p.id})">Aprovar troca</button>
          <input class="minput" id="od-motivo-${p.id}" maxlength="300" placeholder="Motivo, se for recusar (a loja vê)">
          <button class="btn bd" onclick="OUTDOORUI.recusar(${p.id})">Recusar</button>
        </div>
      </div>`).join('')}</div>`;
  }

  function render() {
    const sec = $('sec-outdoor');
    if (!sec) return;
    const d = O.dados;
    const topo = `<div class="card"><div class="od-topo"><div>
        <div style="display:flex;align-items:center;gap:12px"><img src="/vissetv/vissetv-icone.svg" alt="" style="width:40px;height:40px"><div class="od-titulo">VisseTV: rede de TVs</div></div>
        <div class="od-sub">Produto separado do EstimaFood, gerenciado pela sua equipe. Você cadastra os anunciantes e os comércios com TV (pontos), sobe os vídeos de cada um e escolhe onde cada anúncio passa. O anúncio sempre passa na TV do próprio anunciante (se ele tiver) e nos pontos marcados. O anunciante só acompanha pelo painel dele.</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn bg2" onclick="OUTDOORUI.novoPonto()">Novo ponto</button><button class="btn bp" onclick="OUTDOORUI.novoAnunciante()">Novo anunciante</button></div>
    </div></div>`;
    if (!d) { sec.innerHTML = topo + `<div class="card"><div class="od-vazio">${O.carregando ? 'Carregando...' : esc(O.erro || 'Não foi possível carregar.')}</div></div>`; return; }
    const ativos = d.anunciantes.filter(a => a.ativo);
    const telas = d.pontos.flatMap(p => p.telas);
    const stats = `<div class="stats-grid" style="margin:0 0 4px">
      <div class="stat-card" style="--ca:var(--accent)"><div class="stat-card-label">Anunciantes ativos</div><div class="stat-card-val">${ativos.length}</div><div class="stat-card-sub">${d.anunciantes.length - ativos.length} pausado(s)</div></div>
      <div class="stat-card" style="--ca:var(--success)"><div class="stat-card-label">Receita mensal</div><div class="stat-card-val">${brl(d.receita_mensal)}</div><div class="stat-card-sub">soma dos valores negociados</div></div>
      <div class="stat-card" style="--ca:#a855f7"><div class="stat-card-label">Pontos com TV</div><div class="stat-card-val">${d.pontos.length}</div><div class="stat-card-sub">${telas.filter(t => t.online).length} de ${telas.length} TV(s) ligada(s) agora</div></div>
      <div class="stat-card" style="--ca:#f59e0b"><div class="stat-card-label">Vídeos no ar</div><div class="stat-card-val">${d.no_ar}</div><div class="stat-card-sub">de anunciantes ativos</div></div>
    </div>`;
    const abas = `<div class="od-abas">
      <button class="${O.aba === 'anunciantes' ? 'on' : ''}" onclick="OUTDOORUI.aba('anunciantes')">Anunciantes</button>
      <button class="${O.aba === 'pontos' ? 'on' : ''}" onclick="OUTDOORUI.aba('pontos')">Pontos e TVs</button>
      <button class="${O.aba === 'cobrancas' ? 'on' : ''}" onclick="OUTDOORUI.aba('cobrancas')">Cobranças${d.cobranca && d.cobranca.atrasadas ? `<b>${d.cobranca.atrasadas}</b>` : ''}</button>
    </div>`;
    let corpo = '';
    if (O.aba === 'anunciantes') corpo = renderAnunciantes(d);
    else if (O.aba === 'cobrancas') corpo = renderCobrancas(d);
    else corpo = renderPontos(d);
    sec.innerHTML = topo + renderPendentes(d) + stats + abas + corpo;
  }

  function renderAnunciantes(d) {
    if (!d.anunciantes.length) return '<div class="card"><div class="od-vazio">Nenhum anunciante ainda. Toque em "Novo anunciante" para cadastrar o primeiro.</div></div>';
    const nomePonto = Object.fromEntries(d.pontos.map(p => [p.id, p.nome]));
    return `<div class="card"><div class="od-rolar"><table class="od-tab">
      <thead><tr><th>Anunciante</th><th>Valor</th><th>Onde aparece</th><th>Vídeos</th><th>Exibições (30 dias)</th><th>Situação</th><th>Cobrança</th><th></th></tr></thead>
      <tbody>${d.anunciantes.map(a => `<tr>
        <td><div style="font-weight:800">${esc(a.nome)}</div><div style="font-size:11.5px;color:var(--muted)">${[a.email, a.telefone].filter(Boolean).map(esc).join(', ')}</div>${a.loja_nome ? `<div style="font-size:11.5px;margin-top:2px"><span class="od-pill ok">EstimaFood</span> ${esc(a.loja_nome)}</div>` : ''}${a.aguardando ? `<div style="font-size:11.5px;margin-top:2px"><span class="od-pill esp">${a.aguardando} troca(s) para aprovar</span></div>` : ''}</td>
        <td><div style="font-weight:700">${brl(a.valor_mensal)}</div><div style="font-size:11.5px;color:var(--muted)">vence dia ${a.dia_vencimento || '-'}</div></td>
        <td style="font-size:12px;max-width:220px">${a.pontos.length ? a.pontos.map(id => esc(nomePonto[id] || '')).join(', ') : '<span style="color:var(--muted)">nenhum ponto</span>'}</td>
        <td style="font-size:12px">${a.na_rede} no ar<br><span style="color:var(--muted)">${a.videos} no total</span></td>
        <td style="font-weight:700">${(a.exibicoes_30d || 0).toLocaleString('pt-BR')}</td>
        <td>${a.ativo ? '<span class="od-pill ok">Ativo</span>' : '<span class="od-pill off">Pausado</span>'}</td>
        <td style="font-size:12px">${a.situacao ? `<span class="od-pill ${PILL_SIT[a.situacao.codigo] || 'off'}">${esc(a.situacao.texto)}</span>${a.situacao.vence_em && a.situacao.codigo !== 'desligada' ? `<div style="color:var(--muted);margin-top:3px">${a.situacao.codigo === 'em_dia' ? 'próximo' : 'vence'} ${dataBR(a.situacao.vence_em)}</div>` : ''}` : ''}</td>
        <td style="white-space:nowrap"><button class="btn bp bsm" onclick="OUTDOORUI.videos(${a.id})">Vídeos</button> <button class="btn bg2 bsm" onclick="OUTDOORUI.cobranca(${a.id})">Cobrança</button> <button class="btn bg2 bsm" onclick="OUTDOORUI.editarAnunciante(${a.id})">Editar</button> <button class="btn bg2 bsm" onclick="OUTDOORUI.entrar(${a.id})" title="Abre o painel do anunciante">Abrir painel</button></td>
      </tr>`).join('')}</tbody></table></div></div>`;
  }

  function renderCobrancas(d) {
    const c = d.cobranca || {};
    const cards = `<div class="stats-grid" style="margin:0 0 14px">
      <div class="stat-card" style="--ca:var(--success)"><div class="stat-card-label">Recebido no mês</div><div class="stat-card-val">${brl(c.recebido)}</div><div class="stat-card-sub">${c.recebidas || 0} fatura(s) paga(s)</div></div>
      <div class="stat-card" style="--ca:var(--accent)"><div class="stat-card-label">A receber</div><div class="stat-card-val">${brl(c.a_receber)}</div><div class="stat-card-sub">${c.abertas || 0} fatura(s) em aberto</div></div>
      <div class="stat-card" style="--ca:#f59e0b"><div class="stat-card-label">Atrasado</div><div class="stat-card-val">${brl(c.atrasado)}</div><div class="stat-card-sub">${c.atrasadas || 0} fatura(s) vencida(s)</div></div>
      <div class="stat-card" style="--ca:var(--danger)"><div class="stat-card-label">Pausados</div><div class="stat-card-val">${c.pausados || 0}</div><div class="stat-card-sub">anúncios fora do ar por falta de pagamento</div></div>
    </div>`;
    const regra = `<div class="od-sub" style="margin:0 0 12px">A fatura sai 2 dias antes do vencimento, com Pix, pelo WhatsApp de cobranças. No dia do vencimento vai um lembrete. Passados ${d.tolerancia || 2} dias sem pagamento, os anúncios saem do ar e voltam sozinhos quando o pagamento cai. Quem está ligado a uma loja do EstimaFood paga junto com a mensalidade dela.</div>`;
    const lista = O.faturas;
    let tabela;
    if (!lista) { tabela = '<div class="od-vazio">Carregando...</div>'; carregarFaturas(); }
    else if (!lista.length) tabela = '<div class="od-vazio">Nenhuma fatura ainda. Elas aparecem aqui quando chegar perto do vencimento de cada anunciante, ou quando você usar "Cobrar agora".</div>';
    else tabela = `<div class="od-rolar"><table class="od-tab"><thead><tr><th>Anunciante</th><th>Valor</th><th>Vencimento</th><th>Situação</th><th>WhatsApp</th><th></th></tr></thead><tbody>
      ${lista.map(f => `<tr>
        <td style="font-weight:700">${esc(f.anunciante_nome)}</td>
        <td style="font-weight:700">${brl(f.valor)}</td>
        <td>${dataBR(f.vence_em)}${f.pago_em && f.status === 'pago' ? `<div style="font-size:11.5px;color:var(--muted)">paga em ${dataBR(f.pago_em)}</div>` : ''}</td>
        <td>${pillFatura(f)}${f.obs && /Pix não gerado/.test(f.obs) ? `<div style="font-size:11.5px;color:var(--danger);margin-top:3px">${esc(f.obs)}</div>` : ''}</td>
        <td style="font-size:12px">${f.status !== 'pendente' ? '' : f.wa_enviado_em ? 'Enviada' : `<span style="color:var(--danger)">${esc(f.wa_erro || 'Ainda não enviada')}</span>`}</td>
        <td>${acoesFatura(f)}</td>
      </tr>`).join('')}</tbody></table></div>`;
    return `<div class="card">${regra}${cards}${tabela}</div>`;
  }
  function acoesFatura(f) {
    if (f.status === 'pago') return '';
    const confirma = O.excluir === 'f' + f.id;
    if (f.status === 'cancelado') return `<div class="od-fat-acoes"><button class="btn bg2 bsm" onclick="OUTDOORUI.faturaAcao(${f.id},'pago')">Marcar como paga</button></div>`;
    return `<div class="od-fat-acoes">
      ${f.link ? `<a class="btn bg2 bsm" href="${esc(f.link)}" target="_blank" rel="noopener" style="text-decoration:none">Ver Pix</a>` : ''}
      <button class="btn bg2 bsm" onclick="OUTDOORUI.faturaAcao(${f.id},'reenviar')">Reenviar</button>
      <button class="btn bg2 bsm" onclick="OUTDOORUI.faturaAcao(${f.id},'pago')">Marcar como paga</button>
      <button class="btn bd bsm" onclick="OUTDOORUI.faturaAcao(${f.id},'cancelar')">${confirma ? 'Confirmar' : 'Cancelar'}</button>
    </div>`;
  }
  async function carregarFaturas() {
    if (O.carregandoFat) return;
    O.carregandoFat = true;
    try { O.faturas = (await api('/api/outdoor/admin/faturas')).faturas; }
    catch (e) { O.faturas = []; aviso('err', e.message); }
    O.carregandoFat = false;
    if (O.aba === 'cobrancas') render();
  }

  // ── Cobrança de um anunciante ──
  async function modalCobranca(aid) {
    const a = O.dados.anunciantes.find(x => x.id === aid);
    if (!a) return;
    O.aberto = 'cob' + aid;
    let d = { faturas: [], proximo: null };
    try { d = await api('/api/outdoor/admin/faturas?anunciante_id=' + aid); } catch (e) { aviso('err', e.message); }
    const sit = a.situacao || {};
    const ligado = !!a.tenant_id;
    const nova = ligado ? `<div class="od-nova" style="font-size:12.5px;line-height:1.55">Este anunciante está ligado à loja <b>${esc(a.loja_nome || '')}</b> do EstimaFood. O valor de ${brl(a.valor_mensal)} entra somado na mensalidade da loja${sit.vence_em ? `, que vence em ${dataBR(sit.vence_em)}` : ''}. Se a loja passar ${O.dados.tolerancia || 2} dias do vencimento sem pagar, os anúncios saem do ar.</div>`
      : a.cobranca_ativa ? `<div class="od-nova">
        <div style="font-weight:800;margin-bottom:10px">Cobrar agora</div>
        <div class="mrow2"><div class="mrow"><label class="mlabel">Valor (R$)</label><input class="minput" id="od-c-valor" type="number" step="0.01" min="0" value="${esc((+a.valor_mensal || 0).toFixed(2))}"></div>
        <div class="mrow"><label class="mlabel">Vencimento</label><input class="minput" id="od-c-venc" type="date" value="${esc(d.proximo || '')}"></div></div>
        <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;margin-bottom:10px"><input type="checkbox" id="od-c-pago" style="width:16px;height:16px"> Já foi pago por fora (dinheiro, transferência). Só registra, não manda Pix.</label>
        <button class="btn bp" id="od-c-btn" onclick="OUTDOORUI.cobrar(${aid})">Gerar e mandar no WhatsApp</button>
        <div style="font-size:11.5px;color:var(--muted);margin-top:8px">O Pix vai para o WhatsApp ${a.telefone ? esc(a.telefone) : '(cadastre o WhatsApp do anunciante)'}. Se já existir fatura nesse vencimento, a rotina automática não gera outra.</div>
      </div>` : `<div class="od-nova" style="font-size:12.5px">A cobrança automática deste anunciante está desligada. Para voltar a cobrar, ligue em "Editar".</div>`;
    const lista = d.faturas.length ? d.faturas.map(f => `<div class="od-fat">
        <div style="min-width:120px"><b>${brl(f.valor)}</b><div style="color:var(--muted)">vence ${dataBR(f.vence_em)}</div></div>
        <div>${pillFatura(f)}${f.status === 'pendente' ? `<div style="font-size:11.5px;color:${f.wa_enviado_em ? 'var(--muted)' : 'var(--danger)'};margin-top:3px">${f.wa_enviado_em ? 'WhatsApp enviado' : esc(f.wa_erro || 'WhatsApp ainda não enviado')}</div>` : ''}</div>
        ${acoesFatura(f)}
      </div>`).join('') : '<div style="font-size:12.5px;color:var(--muted)">Nenhuma fatura ainda.</div>';
    modal(`<h2>Cobrança de ${esc(a.nome)}</h2>
      <div style="margin:-8px 0 14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="od-pill ${PILL_SIT[sit.codigo] || 'off'}">${esc(sit.texto || '')}</span>${!ligado && a.cobranca_ativa && sit.codigo === 'em_dia' && sit.vence_em ? `<span style="font-size:12.5px;color:var(--muted)">Próxima fatura: vencimento em ${dataBR(sit.vence_em)}</span>` : ''}</div>
      ${nova}
      <div class="modal-sec-title">Faturas</div>
      <div id="od-c-lista">${lista}</div>
      <div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn bg2" onclick="OUTDOORUI.fechar()">Fechar</button></div>`);
  }

  function renderPontos(d) {
    if (!d.pontos.length) return '<div class="card"><div class="od-vazio">Nenhum ponto ainda. Um ponto é um comércio com TV onde os anúncios passam. Toque em "Novo ponto" ou cadastre um anunciante marcando que o comércio dele tem TV.</div></div>';
    const linkTv = location.origin + '/tv', linkApp = location.origin + '/app-tv';
    return `<div class="card"><div class="od-sub" style="margin:0 0 12px">Para ligar uma TV: instale o app (${esc(linkApp)}) ou abra ${esc(linkTv)} no navegador da TV, e digite aqui o código que aparecer.</div>
      <div class="od-grade">${d.pontos.map(p => `
      <div class="od-ponto">
        <div class="od-ponto-topo">
          <div><div style="font-weight:800;font-size:14px">${esc(p.nome)} ${p.ativo ? '' : '<span class="od-pill off">Pausado</span>'}</div>
          <div style="font-size:12px;color:var(--muted)">${esc(p.endereco || 'Sem endereço')}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:4px">${p.dono_nome ? 'TV de ' + esc(p.dono_nome) + ', ' : ''}${p.anunciantes} anunciante(s) da rede, 1 anúncio a cada ${p.anuncios_a_cada} vídeo(s) da casa</div></div>
          <button class="btn bg2 bsm" onclick="OUTDOORUI.editarPonto(${p.id})">Editar</button>
        </div>
        ${p.telas.map(t => `<div class="od-tela">
          <span class="od-ponto-tv ${t.online ? 'on' : ''}"></span>
          <div style="flex:1;min-width:120px"><b>${esc(t.nome)}</b><div style="color:var(--muted);font-size:11.5px">${t.online ? (t.tocando ? 'Passando: ' + esc(t.tocando) : 'Ligada') : 'Desligada, ' + quando(t.ultimo_contato)}</div></div>
          <select class="minput od-mini" onchange="OUTDOORUI.girar(${t.id},this.value)">
            <option value="0" ${!t.rotacao ? 'selected' : ''}>Deitada</option>
            <option value="270" ${t.rotacao == 270 ? 'selected' : ''}>Em pé, girada p/ direita</option>
            <option value="90" ${t.rotacao == 90 ? 'selected' : ''}>Em pé, girada p/ esquerda</option>
          </select>
          <button class="btn bd bsm" onclick="OUTDOORUI.removerTela(${t.id})">${O.excluir === 'tela' + t.id ? 'Confirmar' : 'Remover'}</button>
        </div>`).join('')}
        <div class="od-ligar">
          <input class="minput" id="od-cod-${p.id}" inputmode="numeric" maxlength="6" placeholder="Código" oninput="this.value=this.value.replace(/\\D/g,'').slice(0,6)">
          <button class="btn bp bsm" onclick="OUTDOORUI.ligarTela(${p.id})">Ligar TV</button>
        </div>
      </div>`).join('')}</div></div>`;
  }

  // ── Modal ──
  function modal(html) {
    let bg = $('od-modal');
    if (!bg) {
      bg = document.createElement('div');
      bg.className = 'modal-bg'; bg.id = 'od-modal';
      bg.addEventListener('click', e => { if (e.target === bg && !O.enviando) fecharModal(); });
      document.body.appendChild(bg);
    }
    bg.innerHTML = `<div class="modal"><button class="modal-x" onclick="OUTDOORUI.fechar()">✕</button>${html}</div>`;
    bg.classList.add('on');
  }
  function fecharModal() {
    if (O.enviando && !confirm('Ainda tem vídeo enviando. Se fechar agora, o envio continua só enquanto esta página estiver aberta. Fechar mesmo assim?')) return;
    $('od-modal')?.classList.remove('on'); O.excluir = null; O.aberto = null; clearTimeout(O.timerVid);
  }

  function formAnunciante(a) {
    const d = O.dados;
    const novo = !a;
    a = a || { nome: '', responsavel: '', telefone: '', email: '', valor_mensal: '', dia_vencimento: 10, observacoes: '', pontos: [], ativo: 1, cobranca_ativa: 1 };
    const proprios = d.pontos.filter(p => a.id && p.anunciante_id === a.id);
    const outros = d.pontos.filter(p => !(a.id && p.anunciante_id === a.id));
    return `<h2>${novo ? 'Novo anunciante' : 'Editar anunciante'}</h2>
      <div class="mrow2"><div class="mrow"><label class="mlabel">Nome do comércio ou anunciante</label><input class="minput" id="od-a-nome" value="${esc(a.nome)}"></div>
      <div class="mrow"><label class="mlabel">Responsável</label><input class="minput" id="od-a-resp" value="${esc(a.responsavel || '')}"></div></div>
      <div class="mrow2"><div class="mrow"><label class="mlabel">WhatsApp</label><input class="minput" id="od-a-tel" value="${esc(a.telefone || '')}" placeholder="(88) 99999-0000"></div>
      <div class="mrow"><label class="mlabel">Valor mensal negociado (R$)</label><input class="minput" id="od-a-valor" type="number" step="0.01" min="0" value="${esc(a.valor_mensal)}"></div></div>
      <div class="mrow"><label class="mlabel">Cliente do EstimaFood (opcional)</label>
        <select class="minput" id="od-a-loja" onchange="OUTDOORUI.trocouLoja()"><option value="">Nenhum (anunciante só da VisseTV)</option>${(d.lojas || []).filter(l => l.id === String(a.tenant_id || '') || !d.anunciantes.some(x => String(x.tenant_id || '') === l.id)).map(l => `<option value="${esc(l.id)}" ${String(a.tenant_id || '') === l.id ? 'selected' : ''}>${esc(l.nome)}</option>`).join('')}</select>
        <div id="od-a-loja-info" style="font-size:12px;color:var(--muted);margin-top:6px;line-height:1.5;${a.tenant_id ? '' : 'display:none'}">A loja ganha a TV Indoor completa no gestor dela, sem cobrar o adicional (o preço é o negociado aqui). O anúncio passa também nas TVs da loja. Ela não apaga nem troca o anúncio: só pede a troca, e você aprova aqui.</div></div>
      <div class="mrow2"><div class="mrow"><label class="mlabel" id="od-a-email-rot">E-mail (login do painel)${a.tenant_id ? ', opcional' : ''}</label><input class="minput" id="od-a-email" type="email" value="${esc(a.email || '')}" autocomplete="off"></div>
      <div class="mrow"><label class="mlabel">${novo ? 'Senha' : 'Nova senha (deixe em branco para manter)'}</label><input class="minput" id="od-a-senha" type="text" autocomplete="new-password" placeholder="mínimo 6 caracteres"></div></div>
      <div class="mrow" style="display:flex;align-items:flex-start;gap:8px"><input type="checkbox" id="od-a-cob" style="width:16px;height:16px;margin-top:2px" ${a.cobranca_ativa === 0 ? '' : 'checked'}><label for="od-a-cob" style="font-size:13px;cursor:pointer;line-height:1.45"><b>Cobrança automática ligada</b><br><span style="color:var(--muted);font-size:12px">Desligando, não sai mais nenhuma fatura e as que estão em aberto são canceladas. Mudando o valor, vale para as próximas faturas.</span></label></div>
      <div class="mrow2"><div class="mrow"><label class="mlabel">Dia do vencimento</label><input class="minput" id="od-a-venc" type="number" min="1" max="31" value="${esc(a.dia_vencimento || 10)}"></div>
      <div class="mrow"><label class="mlabel">Situação</label><select class="minput" id="od-a-ativo"><option value="1" ${a.ativo ? 'selected' : ''}>Ativo (anúncios passando)</option><option value="0" ${a.ativo ? '' : 'selected'}>Pausado (nada passa, sem acesso ao painel)</option></select></div></div>
      ${novo ? `<div class="mrow" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="od-a-tv" style="width:16px;height:16px" onchange="document.getElementById('od-a-end-row').style.display=this.checked?'':'none'"><label for="od-a-tv" style="font-size:13px;cursor:pointer">O comércio dele tem TV (vira um ponto: os vídeos dele passam lá, junto com os de outros anunciantes que você escolher)</label></div>
      <div class="mrow" id="od-a-end-row" style="display:none"><label class="mlabel">Endereço do comércio</label><input class="minput" id="od-a-end"></div>`
      : (proprios.length ? `<div class="mrow" style="font-size:12.5px;color:var(--muted)">TV própria: ${proprios.map(p => esc(p.nome)).join(', ')}</div>` : '')}
      <div class="modal-sec-title">Onde os anúncios dele aparecem</div>
      ${outros.length ? `<div class="od-checks">${outros.map(p => `<label><input type="checkbox" class="od-a-ponto" value="${p.id}" ${a.pontos.includes(p.id) ? 'checked' : ''}>${esc(p.nome)}</label>`).join('')}</div>`
        : '<div style="font-size:12.5px;color:var(--muted)">Nenhum outro ponto cadastrado ainda.</div>'}
      <div class="mrow" style="margin-top:14px"><label class="mlabel">Observações (só você vê)</label><textarea class="minput" id="od-a-obs" style="min-height:60px">${esc(a.observacoes || '')}</textarea></div>
      <div style="display:flex;justify-content:space-between;gap:8px;margin-top:18px;flex-wrap:wrap">
        ${novo ? '<span></span>' : `<button class="btn bd" onclick="OUTDOORUI.excluirAnunciante(${a.id})">${O.excluir === 'a' + a.id ? 'Confirmar exclusão (apaga vídeos e TV própria)' : 'Excluir anunciante'}</button>`}
        <div style="display:flex;gap:8px"><button class="btn bg2" onclick="OUTDOORUI.fechar()">Cancelar</button><button class="btn bp" id="od-a-salvar" onclick="OUTDOORUI.salvarAnunciante(${a.id || 0})">Salvar</button></div>
      </div>`;
  }

  // ── Vídeos do anunciante (a equipe sobe, troca e apaga) ──
  function modalVideos(aid) {
    const a = O.dados.anunciantes.find(x => x.id === aid);
    O.aberto = aid;
    modal(`<h2>Vídeos de ${esc(a ? a.nome : '')}</h2>
      <div style="font-size:12.5px;color:var(--muted);margin:-10px 0 14px;line-height:1.5">Passam na TV do próprio anunciante (se ele tiver) e nos pontos marcados no cadastro dele, sempre sem som (o áudio é removido). Para trocar um anúncio, use "Substituir": o vídeo antigo fica no ar até o novo ficar pronto e depois é apagado de vez.</div>
      <div id="od-v-lista">Carregando...</div>
      <div style="display:flex;justify-content:space-between;gap:8px;margin-top:16px;flex-wrap:wrap">
        <label class="btn bp" id="od-v-subir"><input type="file" accept="video/*" multiple style="display:none" onchange="OUTDOORUI.escolher(${aid},this)">Subir vídeo</label>
        <button class="btn bg2" onclick="OUTDOORUI.fechar()">Fechar</button>
      </div>`);
    carregarVideos(aid);
  }

  async function carregarVideos(aid) {
    try {
      const d = await api('/api/outdoor/admin/videos?anunciante_id=' + aid);
      O.videos[aid] = d;
      desenharVideos(aid);
    } catch (e) { const el = $('od-v-lista'); if (el) el.textContent = e.message; }
    clearTimeout(O.timerVid);
    const ocupado = O.videos[aid]?.videos.some(v => v.status === 'processando');
    if (O.aberto === aid && $('od-modal')?.classList.contains('on') && (ocupado || O.enviando)) O.timerVid = setTimeout(() => carregarVideos(aid), 3000);
  }

  function desenharVideos(aid) {
    const el = $('od-v-lista');
    if (!el || O.aberto !== aid) return;
    const d = O.videos[aid] || { videos: [], max: 10 };
    const vids = d.videos;
    const envios = O.envios.filter(x => x.aid === aid);
    const contam = vids.filter(v => v.status !== 'erro' && !v.substitui_id).length + envios.filter(x => !x.erro && !x.substitui_id).length;
    const subir = $('od-v-subir');
    if (subir) { subir.style.opacity = contam >= d.max ? '.5' : ''; subir.style.pointerEvents = contam >= d.max ? 'none' : ''; }
    const novoDe = id => vids.find(x => x.substitui_id === id);
    const linhaEnvio = x => {
      const pct = x.tamanho ? Math.floor(x.enviado / x.tamanho * 100) : 0;
      return `<div class="od-mvid"><img alt=""><div style="flex:1;min-width:0"><b>${esc(x.nome)}</b><div style="color:${x.erro ? 'var(--danger)' : 'var(--muted)'}">${x.erro ? esc(x.erro) : (x.esperando ? 'Na fila para enviar' : `Enviando ${pct}% de ${mb(x.tamanho)}${x.substitui_id ? ' (substituindo)' : ''}. Não feche esta janela.`)}</div></div>${x.erro ? `<button class="btn bg2 bsm" onclick="OUTDOORUI.descartar('${x.id}')">Fechar</button>` : ''}</div>`;
    };
    const principais = vids.filter(v => !v.substitui_id);
    el.innerHTML = (principais.map(v => {
      const novo = novoDe(v.id);
      const enviando = envios.find(x => x.substitui_id === v.id);
      let status;
      if (v.status === 'processando') status = v.na_fila ? 'Na fila para preparar' : `Preparando ${v.progresso || 0}%`;
      else if (v.status === 'erro') status = `<span style="color:var(--danger)">${esc(v.erro || 'Erro no vídeo')}</span>`;
      else status = `${dur(v.duracao)}, ${mb(v.tamanho)}, ${v.exibicoes_30d} exibições em 30 dias, ${v.ativo ? '<b style="color:#22c55e">no ar</b>' : '<b>pausado</b>'}`;
      if (novo && novo.rede === 'recusado') status += `<br><span style="color:var(--muted)">Troca pedida pela loja foi recusada: ${esc(novo.rede_motivo || '')}</span>`;
      else if (novo && novo.rede === 'aguardando') status += `<br><span style="color:#f59e0b">${novo.status === 'pronto' ? 'A loja pediu troca deste anúncio: aprove ou recuse no topo da página VisseTV.' : novo.status === 'erro' ? 'A loja pediu troca, mas o vídeo novo deu erro.' : 'A loja pediu troca: o vídeo novo está sendo preparado.'}</span>`;
      else if (novo) status += `<br><span style="color:#f59e0b">Versão nova ${novo.status === 'erro' ? 'com erro: ' + esc(novo.erro || '') : (novo.na_fila ? 'na fila' : 'sendo preparada ' + (novo.progresso || 0) + '%')}. Este fica no ar até ela ficar pronta.</span>`;
      if (enviando) status += `<br><span style="color:#f59e0b">${enviando.erro ? esc(enviando.erro) : 'Enviando versão nova ' + (enviando.tamanho ? Math.floor(enviando.enviado / enviando.tamanho * 100) : 0) + '%'}</span>`;
      const confirma = O.excluir === 'v' + v.id;
      return `<div class="od-mvid">
        ${v.capa ? `<a href="${esc(v.arquivo)}" target="_blank" rel="noopener"><img src="${esc(v.capa)}" alt=""></a>` : '<img alt="">'}
        <div style="flex:1;min-width:0">
          <input class="minput" style="padding:5px 8px;font-size:12.5px;font-weight:700;margin-bottom:4px" value="${esc(v.titulo)}" maxlength="80" onchange="OUTDOORUI.renomear(${v.id},${aid},this.value)">
          <div style="color:var(--muted);line-height:1.45">${status}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;align-items:stretch">
          ${v.status === 'pronto' ? `<button class="btn bg2 bsm" onclick="OUTDOORUI.ligar(${v.id},${aid},${v.ativo ? 0 : 1})">${v.ativo ? 'Pausar' : 'Pôr no ar'}</button>` : ''}
          ${(!novo || novo.rede !== 'aprovado') && !enviando ? `<label class="btn bg2 bsm" style="cursor:pointer"><input type="file" accept="video/*" style="display:none" onchange="OUTDOORUI.substituir(${aid},${v.id},this)">Substituir</label>` : ''}
          <button class="btn bd bsm" onclick="OUTDOORUI.apagarVideo(${v.id},${aid})">${confirma ? 'Confirmar' : 'Apagar'}</button>
        </div>
      </div>`;
    }).join('')) + envios.filter(x => !x.substitui_id).map(linhaEnvio).join('')
      || '<div style="font-size:12.5px;color:var(--muted)">Nenhum vídeo ainda. Toque em "Subir vídeo".</div>';
  }

  // Envio em partes (aguenta vídeo grande e internet que cai)
  async function enviarFila() {
    if (O.enviando) return;
    O.enviando = true;
    try {
      let x;
      while ((x = O.envios.find(e => e.esperando))) {
        x.esperando = false;
        try {
          await enviarArquivo(x);
          O.envios = O.envios.filter(e => e !== x);
          aviso('ok', x.substitui_id ? 'Versão nova enviada. Quando ficar pronta, a antiga é apagada.' : 'Vídeo enviado. Agora o sistema prepara ele.');
        } catch (e) { x.erro = 'Não foi possível enviar: ' + e.message; }
        desenharVideos(x.aid);
        carregarVideos(x.aid);
      }
    } finally { O.enviando = false; }
  }
  async function enviarArquivo(x) {
    const f = x.arquivo, base = `/api/outdoor/admin/anunciantes/${x.aid}/upload/`;
    const ini = await api(base + 'iniciar', { method: 'POST', body: { nome: f.name, tamanho: f.size, tipo: f.type, substitui_id: x.substitui_id || undefined } });
    const PARTE = ini.parte || 8 * 1024 * 1024;
    let pos = 0, tentativas = 0, ultimo = 0;
    while (pos < f.size) {
      try {
        const h = { ...(typeof adminAuthHeader === 'function' ? adminAuthHeader() : {}), 'Content-Type': 'application/octet-stream' };
        const r = await fetch(`${base}${ini.upload_id}?offset=${pos}`, { method: 'POST', headers: h, body: f.slice(pos, Math.min(pos + PARTE, f.size)) });
        const d = await r.json().catch(() => ({}));
        if (r.status === 409 && typeof d.recebido === 'number') { pos = d.recebido; continue; }
        if (!r.ok) throw Object.assign(new Error(d.error || 'falha no envio'), { definitivo: r.status !== 502 && r.status !== 503 && r.status !== 504 });
        pos = d.recebido; tentativas = 0;
      } catch (e) {
        if (e.definitivo) throw e;
        if (++tentativas > 8) throw new Error('a internet caiu várias vezes. Tente de novo.');
        await new Promise(ok => setTimeout(ok, Math.min(30000, 1500 * tentativas)));
        continue;
      }
      x.enviado = pos;
      if (Date.now() - ultimo > 400) { ultimo = Date.now(); desenharVideos(x.aid); }
    }
    await api(`${base}${ini.upload_id}/concluir`, { method: 'POST', body: { substitui_id: x.substitui_id || undefined } });
  }

  function formPonto(p) {
    const d = O.dados;
    const novo = !p;
    p = p || { nome: '', endereco: '', anunciante_id: null, anuncios_a_cada: 1, ativo: 1 };
    return `<h2>${novo ? 'Novo ponto' : 'Editar ponto'}</h2>
      <div class="mrow"><label class="mlabel">Nome do comércio</label><input class="minput" id="od-p-nome" value="${esc(p.nome)}"></div>
      <div class="mrow"><label class="mlabel">Endereço</label><input class="minput" id="od-p-end" value="${esc(p.endereco || '')}"></div>
      <div class="mrow2">
        <div class="mrow"><label class="mlabel">A TV é de qual anunciante?</label><select class="minput" id="od-p-dono"><option value="">Nenhum (só passa anúncios da rede)</option>${d.anunciantes.map(a => `<option value="${a.id}" ${p.anunciante_id === a.id ? 'selected' : ''}>${esc(a.nome)}</option>`).join('')}</select></div>
        <div class="mrow"><label class="mlabel">Anúncios da rede</label><select class="minput" id="od-p-cada">${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${+p.anuncios_a_cada === n ? 'selected' : ''}>1 a cada ${n} vídeo(s) da casa</option>`).join('')}</select></div>
      </div>
      <div class="mrow"><label class="mlabel">Situação</label><select class="minput" id="od-p-ativo"><option value="1" ${p.ativo ? 'selected' : ''}>Ativo</option><option value="0" ${p.ativo ? '' : 'selected'}>Pausado (a TV mostra aviso)</option></select></div>
      <div style="display:flex;justify-content:space-between;gap:8px;margin-top:18px;flex-wrap:wrap">
        ${novo ? '<span></span>' : `<button class="btn bd" onclick="OUTDOORUI.excluirPonto(${p.id})">${O.excluir === 'p' + p.id ? 'Confirmar exclusão' : 'Excluir ponto'}</button>`}
        <div style="display:flex;gap:8px"><button class="btn bg2" onclick="OUTDOORUI.fechar()">Cancelar</button><button class="btn bp" onclick="OUTDOORUI.salvarPonto(${p.id || 0})">Salvar</button></div>
      </div>`;
  }

  const val = id => ($(id)?.value ?? '').trim();

  window.OUTDOORUI = {
    init() {
      css();
      render();
      carregar();
      clearInterval(O.timer);
      O.timer = setInterval(() => { if ($('sec-outdoor')?.style.display !== 'none' && !$('od-modal')?.classList.contains('on')) carregar(); }, 30000);
    },
    aba(a) { O.aba = a; if (a === 'cobrancas') O.faturas = null; render(); },
    cobranca(aid) { O.excluir = null; modalCobranca(aid); },
    async cobrar(aid) {
      const btn = $('od-c-btn'); if (btn) { btn.disabled = true; btn.textContent = 'Gerando...'; }
      const pago = !!$('od-c-pago')?.checked;
      try {
        const r = await api(`/api/outdoor/admin/anunciantes/${aid}/cobrar`, { method: 'POST', body: { valor: val('od-c-valor'), vence_em: val('od-c-venc'), pago } });
        if (pago) aviso('ok', 'Pagamento registrado.');
        else if (r.whatsapp) aviso('ok', r.pix ? 'Fatura gerada e enviada no WhatsApp com o Pix.' : 'Fatura gerada e enviada, mas sem Pix: confira o Mercado Pago em Saques PIX.');
        else aviso('err', 'Fatura gerada, mas o WhatsApp não foi: ' + (r.erro_whatsapp || 'erro'));
        await carregar(); modalCobranca(aid);
      } catch (e) { aviso('err', e.message); if (btn) { btn.disabled = false; btn.textContent = 'Gerar e mandar no WhatsApp'; } }
    },
    async faturaAcao(fid, acao) {
      if (acao === 'cancelar' && O.excluir !== 'f' + fid) {
        O.excluir = 'f' + fid;
        if (String(O.aberto || '').startsWith('cob')) modalCobranca(+String(O.aberto).slice(3)); else render();
        setTimeout(() => { if (O.excluir === 'f' + fid) { O.excluir = null; if (O.aba === 'cobrancas' && !$('od-modal')?.classList.contains('on')) render(); } }, 4000);
        return;
      }
      O.excluir = null;
      try {
        await api(`/api/outdoor/admin/faturas/${fid}/${acao}`, { method: 'POST', body: {} });
        aviso('ok', acao === 'pago' ? 'Fatura marcada como paga. Se os anúncios estavam fora do ar, voltam em alguns segundos.' : acao === 'cancelar' ? 'Fatura cancelada.' : 'Fatura reenviada no WhatsApp.');
      } catch (e) { aviso('err', e.message); }
      O.faturas = null;
      await carregar();
      if (String(O.aberto || '').startsWith('cob') && $('od-modal')?.classList.contains('on')) modalCobranca(+String(O.aberto).slice(3));
    },
    trocouLoja() {
      const tem = !!val('od-a-loja');
      const i = $('od-a-loja-info'); if (i) i.style.display = tem ? '' : 'none';
      const r = $('od-a-email-rot'); if (r) r.textContent = 'E-mail (login do painel)' + (tem ? ', opcional' : '');
    },
    async aprovar(id) {
      try { await api(`/api/outdoor/admin/videos/${id}/aprovar`, { method: 'POST', body: {} }); aviso('ok', 'Troca aprovada. O anúncio antigo foi apagado e as TVs atualizam em alguns segundos.'); carregar(); verPendentes(); }
      catch (e) { aviso('err', e.message); }
    },
    async recusar(id) {
      const motivo = val('od-motivo-' + id);
      if (!motivo) { aviso('err', 'Escreva o motivo para a loja saber o que mudar.'); $('od-motivo-' + id)?.focus(); return; }
      try { await api(`/api/outdoor/admin/videos/${id}/recusar`, { method: 'POST', body: { motivo } }); aviso('ok', 'Troca recusada. A loja vai ver o motivo.'); carregar(); verPendentes(); }
      catch (e) { aviso('err', e.message); }
    },
    fechar: fecharModal,
    novoAnunciante() { O.excluir = null; modal(formAnunciante(null)); },
    editarAnunciante(id) { O.excluir = null; O.aberto = null; modal(formAnunciante(O.dados.anunciantes.find(a => a.id === id))); },
    videos(id) { O.excluir = null; modalVideos(id); },
    escolher(aid, inp) {
      const arqs = [...(inp.files || [])]; inp.value = '';
      const d = O.videos[aid] || { videos: [], max: 10 };
      const livres = d.max - (d.videos.filter(v => v.status !== 'erro' && !v.substitui_id).length + O.envios.filter(x => x.aid === aid && !x.erro && !x.substitui_id).length);
      if (arqs.length > livres) aviso('err', `Cabem só mais ${Math.max(0, livres)} vídeo(s) para este anunciante.`);
      arqs.slice(0, Math.max(0, livres)).forEach(f => O.envios.push({ id: 'e' + Date.now() + Math.random().toString(36).slice(2, 6), aid, arquivo: f, nome: f.name, tamanho: f.size, enviado: 0, esperando: true }));
      desenharVideos(aid); enviarFila();
    },
    substituir(aid, vid, inp) {
      const f = inp.files && inp.files[0]; inp.value = '';
      if (!f) return;
      O.envios.push({ id: 'e' + Date.now(), aid, arquivo: f, nome: f.name, tamanho: f.size, enviado: 0, esperando: true, substitui_id: vid });
      desenharVideos(aid); enviarFila();
    },
    descartar(id) { const x = O.envios.find(e => e.id === id); O.envios = O.envios.filter(e => e.id !== id); if (x) desenharVideos(x.aid); },
    async renomear(vid, aid, titulo) {
      try { await api('/api/outdoor/admin/videos/' + vid, { method: 'PATCH', body: { titulo } }); aviso('ok', 'Nome salvo.'); } catch (e) { aviso('err', e.message); }
    },
    async ligar(vid, aid, ativo) {
      try { await api('/api/outdoor/admin/videos/' + vid, { method: 'PATCH', body: { ativo: !!ativo } }); aviso('ok', ativo ? 'Vídeo no ar. As TVs atualizam em alguns segundos.' : 'Vídeo pausado.'); carregarVideos(aid); carregar(); }
      catch (e) { aviso('err', e.message); }
    },
    async apagarVideo(vid, aid) {
      if (O.excluir !== 'v' + vid) { O.excluir = 'v' + vid; desenharVideos(aid); setTimeout(() => { if (O.excluir === 'v' + vid) { O.excluir = null; desenharVideos(aid); } }, 4000); return; }
      O.excluir = null;
      try { await api('/api/outdoor/admin/videos/' + vid, { method: 'DELETE' }); aviso('ok', 'Vídeo apagado de vez.'); carregarVideos(aid); carregar(); }
      catch (e) { aviso('err', e.message); }
    },
    async salvarAnunciante(id) {
      const corpo = {
        nome: val('od-a-nome'), responsavel: val('od-a-resp'), telefone: val('od-a-tel'), email: val('od-a-email'),
        valor_mensal: val('od-a-valor'), dia_vencimento: val('od-a-venc'), observacoes: val('od-a-obs'), ativo: val('od-a-ativo') === '1', tenant_id: val('od-a-loja'), cobranca_ativa: !!$('od-a-cob')?.checked,
        pontos: [...document.querySelectorAll('.od-a-ponto:checked')].map(c => +c.value)
      };
      const senha = val('od-a-senha');
      if (senha) corpo.senha = senha;
      if (!id) { corpo.criar_ponto_proprio = !!$('od-a-tv')?.checked; corpo.endereco = val('od-a-end'); }
      try {
        await api(id ? '/api/outdoor/admin/anunciantes/' + id : '/api/outdoor/admin/anunciantes', { method: id ? 'PATCH' : 'POST', body: corpo });
        fecharModal(); aviso('ok', 'Anunciante salvo.'); carregar();
      } catch (e) { aviso('err', e.message); }
    },
    async excluirAnunciante(id) {
      if (O.excluir !== 'a' + id) { O.excluir = 'a' + id; modal(formAnunciante(O.dados.anunciantes.find(a => a.id === id))); return; }
      try { await api('/api/outdoor/admin/anunciantes/' + id, { method: 'DELETE' }); fecharModal(); aviso('ok', 'Anunciante excluído.'); carregar(); }
      catch (e) { aviso('err', e.message); }
    },
    async entrar(id) {
      try { const { token } = await api(`/api/outdoor/admin/anunciantes/${id}/entrar`, { method: 'POST', body: {} }); window.open('/outdoor#sessao=' + token, '_blank'); }
      catch (e) { aviso('err', e.message); }
    },
    novoPonto() { O.excluir = null; modal(formPonto(null)); },
    editarPonto(id) { O.excluir = null; modal(formPonto(O.dados.pontos.find(p => p.id === id))); },
    async salvarPonto(id) {
      const corpo = { nome: val('od-p-nome'), endereco: val('od-p-end'), anunciante_id: val('od-p-dono') || null, anuncios_a_cada: val('od-p-cada'), ativo: val('od-p-ativo') === '1' };
      try { await api(id ? '/api/outdoor/admin/pontos/' + id : '/api/outdoor/admin/pontos', { method: id ? 'PATCH' : 'POST', body: corpo }); fecharModal(); aviso('ok', 'Ponto salvo.'); O.aba = 'pontos'; carregar(); }
      catch (e) { aviso('err', e.message); }
    },
    async excluirPonto(id) {
      if (O.excluir !== 'p' + id) { O.excluir = 'p' + id; modal(formPonto(O.dados.pontos.find(p => p.id === id))); return; }
      try { await api('/api/outdoor/admin/pontos/' + id, { method: 'DELETE' }); fecharModal(); aviso('ok', 'Ponto excluído.'); carregar(); }
      catch (e) { aviso('err', e.message); }
    },
    async ligarTela(pid) {
      const codigo = val('od-cod-' + pid);
      if (codigo.length !== 6) { aviso('err', 'Digite os 6 números que aparecem na TV.'); return; }
      try { await api(`/api/outdoor/admin/pontos/${pid}/telas`, { method: 'POST', body: { codigo } }); aviso('ok', 'TV ligada! Em alguns segundos ela começa a passar.'); carregar(); }
      catch (e) { aviso('err', e.message); }
    },
    async girar(tid, valor) {
      try { await api('/api/outdoor/admin/telas/' + tid, { method: 'PATCH', body: { rotacao: +valor } }); aviso('ok', 'Pronto. A TV gira em alguns segundos.'); }
      catch (e) { aviso('err', e.message); }
    },
    async removerTela(tid) {
      if (O.excluir !== 'tela' + tid) { O.excluir = 'tela' + tid; render(); setTimeout(() => { if (O.excluir === 'tela' + tid) { O.excluir = null; render(); } }, 4000); return; }
      O.excluir = null;
      try { await api('/api/outdoor/admin/telas/' + tid, { method: 'DELETE' }); aviso('ok', 'TV removida.'); carregar(); }
      catch (e) { aviso('err', e.message); }
    }
  };

  window.addEventListener('beforeunload', ev => { if (O.enviando) { ev.preventDefault(); ev.returnValue = 'Ainda tem vídeo enviando.'; return ev.returnValue; } });
})();

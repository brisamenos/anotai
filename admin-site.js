// ═══════════════════════════════════════════════════════
// ADMIN-SITE.JS — telas "Testes grátis" e "Site" do painel admin
// Usa a API de site-admin.js (/api/admin/testes e /api/admin/site).
// Depende de helpers do admin.html: adminAuthHeader, getAdminToken, toast, doLogout, auditLog.
// ═══════════════════════════════════════════════════════
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dataBR = iso => String(iso || '').slice(0, 10).split('-').reverse().join('/');
  const plural = (n, um, varios) => n === 1 ? um : varios;

  async function api(metodo, caminho, corpo) {
    const r = await fetch(caminho, {
      method: metodo, headers: adminAuthHeader(),
      body: metodo === 'GET' ? undefined : JSON.stringify(corpo || {})
    });
    if (r.status === 401) { toast('err', 'Sessão expirada'); setTimeout(doLogout, 1500); throw new Error('Sessão expirada'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Não foi possível concluir');
    return d;
  }

  const ICO = {
    cima: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5l4-4 4 4"/></svg>',
    baixo: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5l4 4 4-4"/></svg>',
    x: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    olho: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.9"/></svg>',
    olhoOff: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2l12 12M6.5 3.7A6.6 6.6 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.7 2.2M10.6 11.9A6.2 6.2 0 0 1 8 12.5C3.9 12.5 1.5 8 1.5 8a11 11 0 0 1 2.6-3"/></svg>',
    mais: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
    lixo: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>'
  };

  function css() {
    if ($('sa-css')) return;
    const st = document.createElement('style');
    st.id = 'sa-css';
    st.textContent = `
.sa-liga{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:22px;align-items:center}
.sa-vis-topo{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
.sa-vis-baixo{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:28px;margin-top:18px;padding-top:16px;border-top:1px solid var(--border)}
.sa-vis-sub{font-size:12px;font-weight:700;color:var(--muted);margin-bottom:10px;text-transform:none}
.sa-vis-sub span{font-weight:500}
.sa-vis-orig{display:grid;grid-template-columns:130px minmax(0,1fr) 44px;gap:10px;align-items:center;font-size:13px;margin-bottom:8px}
.sa-vis-orig b{text-align:right;font-variant-numeric:tabular-nums}
.sa-vis-barra{height:8px;border-radius:99px;background:var(--surface2,rgba(127,127,127,.15));overflow:hidden}
.sa-vis-barra i{display:block;height:100%;border-radius:99px;background:var(--accent)}
.sa-vis-graf{display:flex;align-items:flex-end;gap:4px;height:150px}
.sa-vis-col{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;height:100%}
.sa-vis-num{font-size:10px;color:var(--muted);height:14px;font-variant-numeric:tabular-nums}
.sa-vis-pilar{flex:1;width:100%;display:flex;align-items:flex-end;position:relative}
.sa-vis-pilar i{display:block;width:100%;min-height:2px;border-radius:5px 5px 2px 2px;background:var(--accent);opacity:.85}
.sa-vis-pilar em{position:absolute;left:50%;bottom:4px;transform:translateX(-50%);font-style:normal;font-size:10px;font-weight:800;color:#fff;background:var(--orange);border-radius:99px;padding:0 5px;line-height:15px}
.sa-vis-dia{font-size:9.5px;color:var(--muted);margin-top:4px;white-space:nowrap}
.sa-vis{min-width:0;overflow:hidden}
.sa-vis-baixo > div{min-width:0}
.sa-vis-dia,.sa-vis-num{max-width:100%;overflow:hidden}
@media (max-width:900px){.sa-vis-baixo{grid-template-columns:1fr}.sa-vis-dia{font-size:8.5px}}
@media (max-width:600px){
  .sa-vis-orig{grid-template-columns:minmax(0,1fr) 72px 36px;gap:8px}
  .sa-vis-graf{gap:2px;height:130px}
  .sa-vis-num{font-size:8.5px}
  .sa-vis-col:nth-child(even) .sa-vis-dia{visibility:hidden}
}
.sa-liga-titulo{font-family:'Space Grotesk',sans-serif;font-size:19px;font-weight:800;letter-spacing:-.3px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.sa-liga-texto{font-size:13px;color:var(--text-2);margin-top:5px;max-width:640px;line-height:1.55}
.sa-chave{position:relative;width:64px;height:36px;flex-shrink:0;cursor:pointer;display:block}
.sa-chave input{position:absolute;opacity:0;width:0;height:0}
.sa-chave span{position:absolute;inset:0;border-radius:99px;background:var(--s3);border:1px solid var(--border-hover);transition:background .18s,border-color .18s}
.sa-chave span::after{content:'';position:absolute;top:3px;left:3px;width:28px;height:28px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.35);transition:transform .18s}
.sa-chave input:checked + span{background:var(--success);border-color:var(--success)}
.sa-chave input:checked + span::after{transform:translateX(28px)}
.sa-chave input:focus-visible + span{outline:2px solid var(--accent);outline-offset:3px}
.sa-cfg{display:grid;grid-template-columns:130px 190px minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:end;margin-top:18px;padding-top:18px;border-top:1px solid var(--border)}
.sa-msg{margin-top:18px;padding-top:18px;border-top:1px solid var(--border)}
.sa-msg-topo{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
.sa-msg-topo b{font-size:14px;font-weight:700}
.sa-msg-corpo{display:grid;grid-template-columns:200px minmax(0,1fr);gap:14px;margin-top:14px;align-items:start}
.sa-msg-corpo textarea.minput{min-height:190px;resize:vertical;line-height:1.5;font-size:13px}
.sa-msg.desligada .sa-msg-corpo{opacity:.45}
.sa-senha{font-size:12px;color:var(--muted);margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.sa-senha code{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:12.5px;color:var(--text);background:var(--s3);border:1px solid var(--border);border-radius:6px;padding:1px 7px;user-select:all}
.sa-link{background:none;border:0;padding:0;font:inherit;font-size:12px;font-weight:700;color:var(--accent);cursor:pointer}
.sa-link:hover{text-decoration:underline}
.sa-campo{display:flex;flex-direction:column;gap:6px;min-width:0}
.sa-campo > label,.sa-rotulo{font-size:12px;font-weight:600;color:var(--text-2)}
.sa-dica{font-size:12px;color:var(--muted);line-height:1.5}
.sa-filtros{display:inline-flex;border:1px solid var(--border);border-radius:9px;overflow:hidden}
.sa-filtros button{background:none;border:0;border-left:1px solid var(--border);padding:7px 13px;font:inherit;font-size:12.5px;font-weight:600;color:var(--muted);cursor:pointer}
.sa-filtros button:first-child{border-left:0}
.sa-filtros button.on{background:var(--accent-dim);color:var(--accent)}
.sa-loja{font-weight:700;font-size:13.5px}
.sa-sub{font-size:12px;color:var(--muted);margin-top:2px}
.sa-vazio{text-align:center;padding:40px 20px;color:var(--muted);font-size:13.5px}
.sa-vazio b{display:block;color:var(--text);font-size:15px;margin-bottom:4px}
.sa-acoes{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}
.sa-abas{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:20px;overflow-x:auto}
.sa-aba{background:none;border:0;border-bottom:2px solid transparent;padding:10px 16px;font:inherit;font-size:13.5px;font-weight:600;color:var(--muted);cursor:pointer;white-space:nowrap}
.sa-aba.on{color:var(--text);border-bottom-color:var(--accent)}
.sa-editor{display:grid;grid-template-columns:330px minmax(0,1fr);gap:18px;align-items:start}
.sa-lista{background:var(--s1);border:1px solid var(--border);border-radius:14px;overflow:hidden;position:sticky;top:84px}
.sa-lista-topo{padding:14px 16px;border-bottom:1px solid var(--border);font-size:12px;color:var(--muted);line-height:1.5}
.sa-cam{display:flex;align-items:center;gap:8px;padding:9px 10px 9px 14px;border-bottom:1px solid var(--border);cursor:pointer;border-left:3px solid transparent}
.sa-cam:hover{background:var(--s2)}
.sa-cam.on{background:var(--accent-dim);border-left-color:var(--accent)}
.sa-cam.oculta .sa-cam-nome{opacity:.5}
.sa-cam-nome{flex:1;min-width:0}
.sa-cam-nome b{display:block;font-size:13px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sa-cam-nome small{display:block;font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sa-mini{width:26px;height:26px;border-radius:7px;border:1px solid var(--border);background:var(--s2);color:var(--text-2);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;padding:0}
.sa-mini:hover{border-color:var(--border-hover);color:var(--text)}
.sa-mini[disabled]{opacity:.3;cursor:default}
.sa-mini.perigo:hover{color:var(--danger);border-color:rgba(239,68,68,.35)}
.sa-add{padding:12px 14px;display:flex;gap:8px}
.sa-add select{flex:1;min-width:0}
.sa-form{background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:22px}
.sa-form-topo{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:6px}
.sa-form-titulo{font-family:'Space Grotesk',sans-serif;font-size:17px;font-weight:800;letter-spacing:-.3px}
.sa-grupo{margin-top:18px}
.sa-geral > .sa-grupo:first-child{margin-top:0}
.sa-grupo > .sa-rotulo{display:block;margin-bottom:6px}
.sa-form textarea.minput{min-height:84px;resize:vertical;line-height:1.5}
.sa-itens{display:grid;gap:8px}
.sa-item{border:1px solid var(--border);border-radius:11px;padding:10px;background:var(--s2);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:start}
.sa-item-campos{display:grid;gap:8px;min-width:0}
.sa-item-campos.duas{grid-template-columns:1fr 1fr}
.sa-item-botoes{display:flex;gap:4px}
.sa-linha{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}
.sa-img{display:grid;grid-template-columns:76px minmax(0,1fr);gap:10px;align-items:center}
.sa-img-previa{width:76px;height:56px;border-radius:9px;border:1px solid var(--border);background:var(--s3) center/cover no-repeat;display:flex;align-items:center;justify-content:center;font-size:10.5px;color:var(--muted);text-align:center;overflow:hidden}
.sa-img-botoes{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}
.sa-duas{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.sa-midias{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}
.sa-midia{border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--s2)}
.sa-midia-img{height:118px;background:var(--s3) center/cover no-repeat;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px}
.sa-midia-pe{padding:9px 10px;display:flex;align-items:center;justify-content:space-between;gap:6px}
.sa-midia-pe small{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sa-midia.escolher{cursor:pointer}
.sa-midia.escolher:hover{border-color:var(--accent)}
.sa-solta{border:1.5px dashed var(--border-hover);border-radius:14px;padding:22px;text-align:center;color:var(--text-2);font-size:13px;margin-bottom:16px}
.sa-estado{font-size:12.5px;color:var(--muted)}
.sa-estado.pendente{color:var(--orange);font-weight:600}
.sa-previa-quadro{width:100%;height:72vh;border:1px solid var(--border);border-radius:12px;background:#fff;display:block;margin:0 auto}
.sa-previa-quadro.celular{width:400px;max-width:100%}
/* o tema claro do painel deixa campos e botões secundários escuros: aqui eles acompanham o tema */
body.theme-light #sec-testes .minput,body.theme-light #sec-site .minput,body.theme-light [id^="sa-m-"] .minput{background:#fff;border-color:rgba(15,23,42,.16);color:var(--text)}
body.theme-light #sec-testes .bg2,body.theme-light #sec-site .bg2,body.theme-light [id^="sa-m-"] .bg2{background:#fff;border-color:rgba(15,23,42,.16);color:var(--text-2)}
body.theme-light .sa-chave span{background:#cbd5e1}
@media(max-width:1100px){.sa-editor{grid-template-columns:1fr}.sa-lista{position:static}.sa-cfg{grid-template-columns:1fr 1fr}}
@media(max-width:700px){.sa-liga{grid-template-columns:1fr}.sa-cfg,.sa-duas,.sa-item-campos.duas,.sa-msg-corpo{grid-template-columns:1fr}}
`;
    document.head.appendChild(st);
  }

  // ════════════════════════════════════════════════════
  // TESTES GRÁTIS
  // ════════════════════════════════════════════════════
  const T = { dados: null, filtro: 'todos', busca: '', senhas: {}, rascunho: {}, visPeriodo: 'dias7' };

  // ── Visitas do site ─────────────────────────────────────
  const NOME_ORIGEM = { meta: 'Facebook / Instagram', google: 'Google', whatsapp: 'WhatsApp', direto: 'Direto e outros' };
  const fmtN = n => Number(n || 0).toLocaleString('pt-BR');
  function blocoVisitas() {
    const vis = T.dados?.visitas;
    if (!vis) return '';
    const per = vis[T.visPeriodo] || vis.dias7;
    const rotulo = { hoje: 'hoje', dias7: 'nos últimos 7 dias', dias30: 'nos últimos 30 dias' }[T.visPeriodo];
    const taxa = per.pessoas ? (per.cadastros / per.pessoas * 100) : 0;
    const taxaTxt = per.pessoas ? (taxa < 10 ? taxa.toFixed(1).replace('.', ',') : Math.round(taxa)) + '%' : '—';
    const totalOrig = Object.values(per.origens || {}).reduce((a, b) => a + b, 0);
    const origens = ['meta', 'google', 'whatsapp', 'direto'].map(k => {
      const n = per.origens?.[k] || 0;
      const pct = totalOrig ? Math.round(n / totalOrig * 100) : 0;
      return `<div class="sa-vis-orig"><span>${NOME_ORIGEM[k]}</span><div class="sa-vis-barra"><i style="width:${pct}%"></i></div><b>${fmtN(n)}</b></div>`;
    }).join('');
    const dias = (vis.por_dia || []).slice(T.visPeriodo === 'dias30' ? -30 : -14);
    const max = Math.max(1, ...dias.map(d => d.pessoas));
    const graf = dias.map(d => {
      const h = Math.round(d.pessoas / max * 100);
      const dd = d.dia.slice(8, 10) + '/' + d.dia.slice(5, 7);
      return `<div class="sa-vis-col" title="${dd}: ${fmtN(d.pessoas)} ${plural(d.pessoas, 'pessoa', 'pessoas')}, ${fmtN(d.cadastros)} ${plural(d.cadastros, 'cadastro', 'cadastros')}">
        <div class="sa-vis-num">${d.pessoas || ''}</div><div class="sa-vis-pilar"><i style="height:${h}%"></i>${d.cadastros ? `<em>${d.cadastros}</em>` : ''}</div><div class="sa-vis-dia">${dd}</div></div>`;
    }).join('');
    return `
      <div class="card sa-vis">
        <div class="sa-vis-topo">
          <div><div class="sa-liga-titulo">Visitas do site</div>
            <div class="sa-liga-texto">Quantas pessoas entraram no site de vendas ${rotulo}, de onde vieram e quantas criaram o teste grátis.</div></div>
          <div class="sa-filtros" role="group" aria-label="Período das visitas">
            ${[['hoje', 'Hoje'], ['dias7', '7 dias'], ['dias30', '30 dias']].map(([k, l]) => `<button class="${T.visPeriodo === k ? 'on' : ''}" data-vis="${k}">${l}</button>`).join('')}
          </div>
        </div>
        <div class="stats-grid" style="margin:16px 0 0">
          <div class="stat-card" style="--ca:var(--accent)"><div class="stat-card-label">Pessoas no site</div><div class="stat-card-val">${fmtN(per.pessoas)}</div><div class="stat-card-sub">${fmtN(per.acessos)} ${plural(per.acessos, 'acesso', 'acessos')} · ${per.pessoas ? Math.round(per.celular / per.pessoas * 100) : 0}% pelo celular</div></div>
          <div class="stat-card" style="--ca:var(--success)"><div class="stat-card-label">Chamaram no WhatsApp</div><div class="stat-card-val">${fmtN(per.whats)}</div><div class="stat-card-sub">tocaram em algum botão do WhatsApp</div></div>
          <div class="stat-card" style="--ca:var(--orange)"><div class="stat-card-label">Criaram o teste grátis</div><div class="stat-card-val">${fmtN(per.cadastros)}</div><div class="stat-card-sub">${per.compras ? fmtN(per.compras) + ' ' + plural(per.compras, 'comprou', 'compraram') + ' direto pelo site' : 'contas novas pelo site'}</div></div>
          <div class="stat-card" style="--ca:#a855f7"><div class="stat-card-label">Taxa de cadastro</div><div class="stat-card-val">${taxaTxt}</div><div class="stat-card-sub">de cada 100 pessoas que entram</div></div>
        </div>
        <div class="sa-vis-baixo">
          <div><div class="sa-vis-sub">De onde vieram</div>${origens}
            <div class="sa-dica" style="margin-top:8px">Facebook / Instagram inclui quem veio dos anúncios da Meta.</div></div>
          <div><div class="sa-vis-sub">Pessoas por dia <span>(o número laranja é quantos criaram o teste no dia)</span></div><div class="sa-vis-graf">${graf}</div></div>
        </div>
        ${vis.desde ? '' : '<div class="sa-dica" style="margin-top:10px">A contagem começa assim que o site novo estiver no ar.</div>'}
      </div>`;
  }

  function badgeMenu(n) {
    const b = $('nav-testes-badge');
    if (!b) return;
    b.textContent = n ? String(n) : '';
    b.style.display = n ? '' : 'none';
    b.title = n + ' ' + plural(n, 'teste ativo', 'testes ativos');
  }

  // Lojas que ainda são teste (no prazo ou expiradas): o painel usa esta lista para
  // marcar "Teste grátis" em Clientes e deixar essas contas fora da receita mensal.
  const EM_TESTE = new Set();
  function marcarTestes() {
    EM_TESTE.clear();
    (T.dados?.testes || []).forEach(x => { if (x.situacao !== 'cliente' && x.tenant_id) EM_TESTE.add(x.tenant_id); });
    badgeMenu(T.dados?.resumo?.ativos || 0);
    try { if (typeof calcularFinanceiro === 'function') calcularFinanceiro(); } catch (e) {}
    try { if (typeof renderClientes === 'function' && typeof _clientes !== 'undefined' && _clientes.length) renderClientes(); } catch (e) {}
  }

  async function carregarTestes(silencioso) {
    try {
      T.dados = await api('GET', '/api/admin/testes');
      marcarTestes();
      if ($('sec-testes') && $('sec-testes').style.display !== 'none') renderTestes();
    } catch (e) { if (!silencioso) toast('err', e.message); }
  }

  function situacao(t) {
    if (t.situacao === 'cliente') return '<span class="badge bg-blue">Virou cliente</span>';
    if (t.situacao === 'expirado') return '<span class="badge bg-red">Expirado há ' + Math.abs(t.dias_restantes) + ' ' + plural(Math.abs(t.dias_restantes), 'dia', 'dias') + '</span>';
    if (t.dias_restantes === 0) return '<span class="badge bg-orange">Termina hoje</span>';
    if (t.dias_restantes <= 2) return '<span class="badge bg-orange">' + plural(t.dias_restantes, 'Falta 1 dia', 'Faltam ' + t.dias_restantes + ' dias') + '</span>';
    return '<span class="badge bg-green">Faltam ' + t.dias_restantes + ' dias</span>';
  }

  // Datas do servidor vêm em UTC sem fuso ('2026-10-03 16:38:04')
  function horaLocal(v) {
    const d = new Date(String(v || '').replace(' ', 'T') + 'Z');
    if (isNaN(d)) return '';
    const hoje = new Date().toDateString() === d.toDateString();
    return (hoje ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ') + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function linhaSenha(x) {
    const s = T.senhas[x.id];
    if (!x.tem_senha) return '<div class="sa-senha">Senha não guardada</div>';
    if (!s) return `<div class="sa-senha">Senha <button class="sa-link" data-acao="senha" data-id="${x.id}">ver</button></div>`;
    if (!s.senha) return `<div class="sa-senha">${esc(s.motivo || 'Senha não guardada')}</div>`;
    return `<div class="sa-senha">Senha <code>${esc(s.senha)}</code>
      <button class="sa-link" data-acao="copiar-senha" data-id="${x.id}">copiar</button>
      <button class="sa-link" data-acao="ocultar-senha" data-id="${x.id}">ocultar</button>
      ${s.vale ? '' : '<span style="color:var(--orange);font-weight:600">o cliente já trocou esta senha</span>'}</div>`;
  }

  function linhaMensagem(x) {
    if (x.situacao === 'cliente' && x.msg_status !== 'enviada') return '';
    const enviar = `<button class="sa-link" data-acao="mensagem" data-id="${x.id}">enviar agora</button>`;
    if (x.msg_status === 'enviada') return `<div class="sa-sub">WhatsApp enviado ${horaLocal(x.msg_enviada_em)}</div>`;
    if (x.msg_status === 'pendente') return `<div class="sa-sub">WhatsApp sai ${horaLocal(x.msg_em)} · ${enviar}</div>`;
    if (x.msg_status === 'falhou') return `<div class="sa-sub" title="${esc(x.msg_erro || '')}"><span style="color:var(--danger);font-weight:600">WhatsApp não enviou</span> · ${enviar}</div>`;
    return `<div class="sa-sub">Sem mensagem · ${enviar}</div>`;
  }
  const ETAPAS_UI = [['dia1', '1 dia depois do cadastro'], ['dia2', '2 dias depois do cadastro'], ['dia3', '3 dias depois do cadastro'], ['dia5', '5 dias depois do cadastro'], ['vespera', 'Véspera do fim do teste'], ['expirou', 'Depois que o teste acaba']];
  const NOME_ETAPA = { dia1: '1º dia', dia2: '2º dia', dia3: '3º dia', dia5: '5º dia', vespera: 'véspera', expirou: 'fim' };
  function linhaAcompanhamento(x) {
    const feitas = String(x.seq_enviados || '').split(',').filter(Boolean);
    let h = feitas.length ? `<div class="sa-sub">Acompanhamento: ${feitas.map(k => NOME_ETAPA[k] || k).join(', ')}</div>` : '';
    if (x.seq_erro) h += `<div class="sa-sub" title="${esc(x.seq_erro)}" style="color:var(--danger)">Acompanhamento não enviou</div>`;
    if (x.meta_compra_em) h += '<div class="sa-sub" style="color:var(--success);font-weight:600">Venda enviada à Meta</div>';
    else if (x.meta_compra_erro && !/não configurado/.test(x.meta_compra_erro)) h += `<div class="sa-sub" title="${esc(x.meta_compra_erro)}" style="color:var(--danger)">Venda não chegou à Meta</div>`;
    return h;
  }

  const ST_COMPRA = {
    aprovado: '<span class="badge bg-green">Pago</span>', pendente: '<span class="badge bg-orange">Aguardando Pix</span>',
    analise: '<span class="badge bg-orange">Cartão em análise</span>', processando: '<span class="badge bg-orange">Criando a conta</span>',
    recusado: '<span class="badge bg-red">Recusado</span>', expirado: '<span class="badge bg-gray">Pix vencido</span>', erro: '<span class="badge bg-red">Pago, conta não criada</span>'
  };
  function blocoCompras() {
    const c = T.dados?.config || {};
    const info = T.dados?.compra || {};
    const lista = T.dados?.compras || [];
    const pagos = lista.filter(x => x.status === 'aprovado');
    const total = pagos.reduce((a, x) => a + (Number(x.valor) || 0), 0);
    const aviso = !info.valor ? 'O preço do 1º mês não está preenchido na camada "Oferta e preço" do site.'
      : (c.compra_ativa && !info.ativo) ? 'O Mercado Pago da plataforma não está configurado: confira o token em Configurações do admin.'
      : (c.compra_ativa && !info.cartao) ? 'Só Pix por enquanto: para aceitar cartão, falta a chave pública (public key) do Mercado Pago da plataforma.' : '';
    return `
      <div class="card">
        <div class="sa-liga">
          <div>
            <div class="sa-liga-titulo">Compra direto pelo site ${c.compra_ativa ? (info.ativo ? '<span class="badge bg-green">Ligada</span>' : '<span class="badge bg-orange">Ligada, mas indisponível</span>') : '<span class="badge bg-gray">Desligada</span>'}</div>
            <div class="sa-liga-texto">O botão da oferta abre uma tela de pagamento com Pix ou cartão, no Mercado Pago da plataforma, pelo preço do 1º mês mostrado no site${info.valor ? ' (R$ ' + Number(info.valor).toFixed(2).replace('.', ',') + ')' : ''}. A conta é criada sozinha quando o pagamento é aprovado, o cliente recebe o acesso no WhatsApp e você recebe um aviso.</div>
            ${aviso ? `<div class="sa-dica" style="margin-top:8px;color:var(--orange);font-weight:600">${aviso}</div>` : ''}
          </div>
          <label class="sa-chave" title="${c.compra_ativa ? 'Desligar a compra pelo site' : 'Ligar a compra pelo site'}">
            <input type="checkbox" id="sa-compra-ativa" ${c.compra_ativa ? 'checked' : ''} aria-label="Compra direto pelo site">
            <span></span>
          </label>
        </div>
        ${lista.length ? `
        <div class="sa-vis-sub" style="margin-top:18px">Últimas compras pelo site · ${pagos.length} ${plural(pagos.length, 'paga', 'pagas')}, R$ ${total.toFixed(2).replace('.', ',')}</div>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Loja</th><th>Contato</th><th>Valor</th><th>Situação</th><th>Data</th></tr></thead>
          <tbody>${lista.slice(0, 15).map(x => {
            const fone = String(x.telefone || '').replace(/\D/g, '');
            const wa = fone ? 'https://wa.me/' + (fone.length <= 11 ? '55' + fone : fone) : '';
            return `<tr>
              <td><div class="sa-loja">${esc(x.loja || x.restaurante)}</div><div class="sa-sub">${esc(x.nome)}</div></td>
              <td>${wa ? `<a href="${wa}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600">${esc(x.telefone)}</a>` : '—'}<div class="sa-sub">${esc(x.email)}</div></td>
              <td>R$ ${Number(x.valor || 0).toFixed(2).replace('.', ',')}<div class="sa-sub">${x.metodo === 'pix' ? 'Pix' : 'Cartão'}</div></td>
              <td>${ST_COMPRA[x.status] || esc(x.status)}${x.status === 'aprovado' && x.expira_em ? `<div class="sa-sub">ativa até ${dataBR(x.expira_em)}</div>` : ''}${x.status === 'recusado' && x.status_detalhe ? `<div class="sa-sub">${esc(x.status_detalhe)}</div>` : ''}${x.status === 'erro' ? `<div class="sa-sub" title="${esc(x.erro || '')}">crie a conta em Clientes</div>` : ''}</td>
              <td>${horaLocal(x.aprovado_em || x.created_at)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>` : '<div class="sa-dica" style="margin-top:12px">Nenhuma compra pelo site ainda.</div>'}
      </div>`;
  }

  // Escolha do fluxo do Marketing (vídeo, imagem e botões) de uma etapa do teste
  function seletorFluxo(k) {
    const lista = T.dados?.fluxos_mkt || [];
    const chave = 'sa-fluxo-' + k;
    const atual = String(chave in T.rascunho ? T.rascunho[chave] : (T.dados?.config?.fluxos?.[k] || ''));
    const existe = !atual || lista.some(f => String(f.id) === atual);
    return `<label class="sa-sub" for="sa-fluxo-${k}" style="display:block;margin:10px 0 4px;font-weight:600">Enviar</label>
      <select class="minput" id="sa-fluxo-${k}" style="font-size:12.5px">
        <option value="">Só o texto</option>
        ${lista.map(f => `<option value="${f.id}" ${String(f.id) === atual ? 'selected' : ''}>Fluxo: ${esc(f.nome)}${f.ativo ? '' : ' (desligado)'}</option>`).join('')}
        ${existe ? '' : `<option value="${esc(atual)}" selected>Fluxo apagado (vai o texto)</option>`}
      </select>
      ${atual && existe ? '<div class="sa-dica" style="margin-top:6px"><button class="sa-link" data-acao="ir-marketing">Editar no Marketing</button></div>' : ''}`;
  }
  function avisoFluxos() {
    const d = T.dados || {};
    const usados = Object.values(d.config?.fluxos || {}).filter(Boolean).length;
    const canal = d.canal_fluxos;
    return `<div class="sa-dica" style="margin-top:12px;padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:var(--s2,rgba(127,127,127,.06));line-height:1.55">
      <b style="color:var(--text)">Mensagens com vídeo, imagem e botões.</b> Cada etapa pode enviar um fluxo do Marketing no lugar do texto. Os fluxos prontos já vêm com os vídeos e as imagens, e você edita tudo em Marketing. O texto de cada etapa fica como reserva: vai se o fluxo não puder ser enviado.
      ${canal ? '' : '<div style="margin-top:6px;color:var(--orange);font-weight:600">Os fluxos saem pelo WhatsApp de Suporte e Vendas na conexão WuzAPI, que não está ativa agora. Enquanto isso, vai o texto de cada etapa.</div>'}
      <div style="margin-top:8px;display:flex;gap:14px;flex-wrap:wrap">${usados ? `<span>${usados} ${plural(usados, 'etapa usa', 'etapas usam')} fluxo</span>` : ''}
        ${d.midia_teste ? '<button class="sa-link" data-acao="fluxos-prontos">Criar os fluxos prontos de novo</button>' : ''}
        <button class="sa-link" data-acao="ir-marketing">Abrir o Marketing</button></div>
    </div>`;
  }

  function linhaIA(t) {
    if (t.voz_ativo) return '<div class="sa-sub" style="color:var(--success);font-weight:600">IA ligada pelo admin</div>';
    if (!t.ia_teste) return '';
    if (t.expira_em >= (T.dados?.hoje || '')) return '<div class="sa-sub" style="color:var(--accent);font-weight:600">IA liberada até ' + dataBR(t.expira_em) + '</div>';
    return '<div class="sa-sub">IA do teste encerrada</div>';
  }

  function uso(t) {
    const partes = [
      t.produtos + ' ' + plural(t.produtos, 'produto', 'produtos'),
      t.pedidos + ' ' + plural(t.pedidos, 'pedido', 'pedidos')
    ];
    const acesso = t.ultimo_acesso ? 'último acesso ' + dataBR(t.ultimo_acesso) : 'ainda não entrou';
    return '<div>' + partes.join(' · ') + '</div><div class="sa-sub">' + acesso + '</div>';
  }

  function renderTestes() {
    css();
    const sec = $('sec-testes');
    if (!sec) return;
    if (!T.dados) { sec.innerHTML = '<div class="sa-vazio">Carregando...</div>'; return; }
    const { resumo: r, config: c } = T.dados;
    const termo = T.busca.trim().toLowerCase();
    const lista = T.dados.testes.filter(t => {
      if (T.filtro === 'ativos' && t.situacao !== 'ativo') return false;
      if (T.filtro === 'expirados' && t.situacao !== 'expirado') return false;
      if (T.filtro === 'clientes' && t.situacao !== 'cliente') return false;
      if (!termo) return true;
      return [t.restaurante, t.loja, t.nome, t.email, t.telefone].some(v => String(v || '').toLowerCase().includes(termo));
    });
    const taxa = r.total ? Math.round((r.convertidos / r.total) * 100) : 0;
    // campos de configuração ainda não salvos sobrevivem aos redesenhos da tela
    const v = (id, salvo) => (id in T.rascunho ? T.rascunho[id] : (salvo ?? ''));
    const msgAtiva = 'sa-teste-msg-ativa' in T.rascunho ? T.rascunho['sa-teste-msg-ativa'] : c.msg_ativa;
    const seqAtiva = 'sa-teste-seq-ativa' in T.rascunho ? T.rascunho['sa-teste-seq-ativa'] : c.seq_ativa !== false;

    sec.innerHTML = `
      <div class="sec-head">
        <div>
          <div class="sec-head-title">Testes grátis</div>
          <div class="sec-head-sub">Contas criadas pelo site para experimentar o sistema por ${c.dias} ${plural(c.dias, 'dia', 'dias')}</div>
        </div>
        <button class="btn bg2" data-acao="atualizar">Atualizar</button>
      </div>

      ${blocoVisitas()}

      <div class="card" style="border-color:${c.ativo ? 'rgba(34,197,94,.35)' : 'var(--border)'}">
        <div class="sa-liga">
          <div>
            <div class="sa-liga-titulo">Teste grátis no site ${c.ativo ? '<span class="badge bg-green">Ligado</span>' : '<span class="badge bg-gray">Desligado</span>'}</div>
            <div class="sa-liga-texto">${c.ativo
              ? 'O site está mostrando a chamada de teste grátis e o cadastro. Cada conta criada entra aqui na hora e vale por ' + c.dias + ' ' + plural(c.dias, 'dia', 'dias') + '.'
              : 'O site não oferece o teste. Ligue para aparecer a chamada em destaque e o cadastro; as contas que já existem continuam valendo até o fim do prazo.'}</div>
          </div>
          <label class="sa-chave" title="${c.ativo ? 'Desligar o teste grátis' : 'Ligar o teste grátis'}">
            <input type="checkbox" id="sa-teste-ativo" ${c.ativo ? 'checked' : ''} aria-label="Teste grátis no site">
            <span></span>
          </label>
        </div>
        <div class="sa-cfg">
          <div class="sa-campo"><label for="sa-teste-dias">Duração (dias)</label><input class="minput" id="sa-teste-dias" type="number" min="1" max="60" value="${esc(v('sa-teste-dias', c.dias))}"></div>
          <div class="sa-campo"><label for="sa-teste-limite">Limite de contas por dia</label><input class="minput" id="sa-teste-limite" type="number" min="1" max="500" value="${esc(v('sa-teste-limite', c.limite_dia))}"></div>
          <div class="sa-campo"><label for="sa-teste-gestor">Link do gestor (botão "Entrar no painel")</label><input class="minput" id="sa-teste-gestor" type="url" value="${esc(v('sa-teste-gestor', c.gestor_url))}" placeholder="${esc(c.gestor_padrao)}"></div>
          <div class="sa-campo"><label for="sa-teste-download">Link para baixar o programa do Windows (Electron)</label><input class="minput" id="sa-teste-download" type="url" value="${esc(v('sa-teste-download', c.download_url))}" placeholder="${esc(c.download_padrao)}"></div>
        </div>
        <div class="sa-dica" style="margin-top:10px">Os dois links aparecem para o cliente assim que ele cria a conta e vão na mensagem do WhatsApp. Em branco, valem os endereços do próprio sistema, mostrados em cinza. A duração vale para as contas criadas a partir de agora.</div>

        <div class="sa-msg ${msgAtiva ? '' : 'desligada'}">
          <div class="sa-msg-topo">
            <div><b>Mensagem no WhatsApp depois do cadastro</b>
              <div class="sa-dica" style="margin-top:3px">Vai para o número que o cliente informou, pelo WhatsApp de Suporte e Vendas conectado neste painel.</div></div>
            <label class="toggle" title="${msgAtiva ? 'Desligar a mensagem' : 'Ligar a mensagem'}"><input type="checkbox" id="sa-teste-msg-ativa" ${msgAtiva ? 'checked' : ''} aria-label="Enviar mensagem depois do cadastro"><span class="toggle-slider"></span></label>
          </div>
          <div class="sa-msg-corpo">
            <div class="sa-campo"><label for="sa-teste-msg-min">Enviar depois de (minutos)</label><input class="minput" id="sa-teste-msg-min" type="number" min="1" max="1440" value="${esc(v('sa-teste-msg-min', c.msg_minutos))}">${seletorFluxo('boasvindas')}</div>
            <div class="sa-campo"><label for="sa-teste-msg-texto">Texto da mensagem</label><textarea class="minput" id="sa-teste-msg-texto" maxlength="1500">${esc(v('sa-teste-msg-texto', c.msg_texto))}</textarea>
              <div class="sa-dica">Use {nome}, {loja}, {email}, {validade}, {dias}, {link_gestor}, {link_download} e {link_cardapio}: cada um é trocado pelo dado do cliente. No WhatsApp, *asteriscos* deixam o trecho em negrito. <button class="sa-link" data-acao="msg-padrao">Voltar ao texto padrão</button></div></div>
          </div>
        </div>
        <div class="sa-msg ${seqAtiva ? '' : 'desligada'}">
          <div class="sa-msg-topo">
            <div><b>Acompanhamento do teste no WhatsApp</b>
              <div class="sa-dica" style="margin-top:3px">Mensagens automáticas ao longo do teste, entre 9h e 20h, com pelo menos 12 horas entre uma e outra. Quem vira cliente para de receber.</div></div>
            <label class="toggle" title="${seqAtiva ? 'Desligar o acompanhamento' : 'Ligar o acompanhamento'}"><input type="checkbox" id="sa-teste-seq-ativa" ${seqAtiva ? 'checked' : ''} aria-label="Acompanhamento do teste"><span class="toggle-slider"></span></label>
          </div>
          ${avisoFluxos()}
          ${ETAPAS_UI.map(([k, rot]) => `
          <div class="sa-msg-corpo">
            <div class="sa-campo"><label for="sa-seq-${k}">${rot}</label>${seletorFluxo(k)}<div class="sa-dica" style="margin-top:6px"><button class="sa-link" data-acao="seq-padrao" data-etapa="${k}">Voltar ao texto padrão</button></div></div>
            <div class="sa-campo"><textarea class="minput" id="sa-seq-${k}" maxlength="1500" style="min-height:130px" aria-label="${rot}">${esc(v('sa-seq-' + k, c.seq?.[k]))}</textarea></div>
          </div>`).join('')}
          <div class="sa-dica" style="margin-top:8px">Além dos códigos da mensagem de boas-vindas, aqui também vale {preco}: o preço do 1º mês mostrado no site.</div>
        </div>

        <div class="sa-msg ${c.ia_teste ? '' : 'desligada'}">
          <div class="sa-msg-topo">
            <div><b>Atendente com IA liberada no teste</b>
              <div class="sa-dica" style="margin-top:3px">Quem cria o teste já tem o pedido por IA no WhatsApp (texto e áudio) ligado, sem custo, até o último dia do teste. Depois disso a função desliga sozinha e só volta se você ligar "Pedido por voz" no cadastro do cliente, em Clientes. Vale para os testes criados a partir de agora.</div></div>
            <label class="toggle" title="${c.ia_teste ? 'Desligar a IA no teste' : 'Ligar a IA no teste'}"><input type="checkbox" id="sa-teste-ia" ${c.ia_teste ? 'checked' : ''} aria-label="Atendente com IA liberada no teste"><span class="toggle-slider"></span></label>
          </div>
        </div>

        <div class="sa-msg ${c.aviso_wa_teste || c.aviso_wa_clientes ? '' : 'desligada'}">
          <div class="sa-msg-topo">
            <div><b>Aviso do robô para conectar o WhatsApp</b>
              <div class="sa-dica" style="margin-top:3px">Quando o gestor abre o painel com o WhatsApp da loja desconectado, aparece um aviso com um robô animado e o botão "Conectar agora", que já abre o QR Code. Ao conectar, o Agente IA liga com todas as opções. Se o gestor tocar em "Agora não", o aviso volta no dia seguinte.</div></div>
          </div>
          <div class="sa-msg-topo" style="margin-top:12px">
            <div><b style="font-weight:600">Para quem está em teste</b>
              <div class="sa-dica" style="margin-top:3px">Teste grátis do site e clientes com teste da IA liberado em Clientes.</div></div>
            <label class="toggle" title="${c.aviso_wa_teste ? 'Desligar o aviso para quem está em teste' : 'Ligar o aviso para quem está em teste'}"><input type="checkbox" id="sa-aviso-wa-teste" ${c.aviso_wa_teste ? 'checked' : ''} aria-label="Aviso do robô para quem está em teste"><span class="toggle-slider"></span></label>
          </div>
          <div class="sa-msg-topo" style="margin-top:12px">
            <div><b style="font-weight:600">Para os clientes</b>
              <div class="sa-dica" style="margin-top:3px">Todas as outras lojas que ainda não conectaram o WhatsApp.</div></div>
            <label class="toggle" title="${c.aviso_wa_clientes ? 'Desligar o aviso para os clientes' : 'Ligar o aviso para os clientes'}"><input type="checkbox" id="sa-aviso-wa-clientes" ${c.aviso_wa_clientes ? 'checked' : ''} aria-label="Aviso do robô para os clientes"><span class="toggle-slider"></span></label>
          </div>
        </div>

        <div class="sa-msg">
          <div class="sa-msg-topo">
            <div><b>Venda nos anúncios da Meta (API de Conversões)</b>
              <div class="sa-dica" style="margin-top:3px">Quando uma loja que veio do teste grátis paga a mensalidade, o sistema avisa a Meta. Assim os anúncios aprendem a buscar quem compra, e não só quem testa. Gere o token no Gerenciador de Eventos: pixel > Configurações > API de Conversões > Gerar token de acesso.</div></div>
          </div>
          <div class="sa-cfg" style="margin-top:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
            <div class="sa-campo"><label for="sa-meta-pixel">ID do pixel</label><input class="minput" id="sa-meta-pixel" inputmode="numeric" value="${esc(v('sa-meta-pixel', c.meta_pixel))}"></div>
            <div class="sa-campo"><label for="sa-meta-token">Token da API de Conversões</label><input class="minput" id="sa-meta-token" type="password" autocomplete="off" value="${esc(v('sa-meta-token', ''))}" placeholder="${c.meta_token_salvo ? 'Salvo ' + esc(c.meta_token_salvo) + ' (vazio mantém)' : 'Cole aqui o token'}"></div>
            <div class="sa-campo"><label for="sa-meta-teste">Código de teste (opcional)</label><input class="minput" id="sa-meta-teste" value="${esc(v('sa-meta-teste', c.meta_teste))}" placeholder="TEST12345"></div>
          </div>
          <div class="sa-dica" style="margin-top:8px">${c.meta_token_salvo ? 'Ligado: cadastros e vendas estão sendo enviados para a Meta.' : 'Desligado até você colar o token.'} O código de teste só serve para conferir na aba "Testar eventos"; apague depois.</div>
        </div>

        <div style="display:flex;justify-content:flex-end;align-items:center;gap:12px;margin-top:16px">
          ${Object.keys(T.rascunho).length ? '<span class="sa-estado pendente">Alterações ainda não salvas</span>' : ''}
          <button class="btn bp" data-acao="salvar-config">Salvar configuração</button>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card" style="--ca:var(--success)"><div class="stat-card-label">Testes ativos</div><div class="stat-card-val">${r.ativos}</div><div class="stat-card-sub">dentro do prazo</div></div>
        <div class="stat-card" style="--ca:var(--orange)"><div class="stat-card-label">Terminam em até 2 dias</div><div class="stat-card-val">${r.vencendo}</div><div class="stat-card-sub">bom momento para ligar</div></div>
        <div class="stat-card" style="--ca:var(--danger)"><div class="stat-card-label">Expirados</div><div class="stat-card-val">${r.expirados}</div><div class="stat-card-sub">prazo acabou, sem assinar</div></div>
        <div class="stat-card" style="--ca:var(--accent)"><div class="stat-card-label">Viraram clientes</div><div class="stat-card-val">${r.convertidos}</div><div class="stat-card-sub">${r.total ? taxa + '% de ' + r.total + ' ' + plural(r.total, 'teste criado', 'testes criados') : 'nenhum teste criado ainda'}</div></div>
      </div>

      ${blocoCompras()}

      <div class="tw">
        <div class="tmeta">
          <div class="sa-filtros" role="group" aria-label="Filtrar testes">
            ${[['todos', 'Todos'], ['ativos', 'Ativos'], ['expirados', 'Expirados'], ['clientes', 'Clientes']].map(([k, l]) =>
              `<button class="${T.filtro === k ? 'on' : ''}" data-filtro="${k}">${l}</button>`).join('')}
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input class="minput" id="sa-teste-busca" placeholder="Buscar loja, nome ou WhatsApp" value="${esc(T.busca)}" style="width:240px">
            ${r.expirados ? `<button class="btn bd" data-acao="excluir-expirados">Excluir ${r.expirados} ${plural(r.expirados, 'expirado', 'expirados')}</button>` : ''}
          </div>
        </div>
        ${lista.length ? `<table>
          <thead><tr><th>Loja</th><th>Contato e acesso</th><th>Criado em</th><th>Validade</th><th>Uso</th><th style="text-align:right">Ações</th></tr></thead>
          <tbody>${lista.map(t => {
            const fone = String(t.telefone || '').replace(/\D/g, '');
            const wa = fone ? 'https://wa.me/' + (fone.length <= 11 ? '55' + fone : fone) : '';
            return `<tr>
              <td><div class="sa-loja">${esc(t.loja || t.restaurante)}</div><div class="sa-sub">${esc(t.nome)}</div></td>
              <td>${wa ? `<a href="${wa}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600">${esc(t.telefone)}</a>` : '—'}<div class="sa-sub">${esc(t.email)}</div>${linhaSenha(t)}</td>
              <td>${dataBR(t.created_at)}${linhaMensagem(t)}${linhaAcompanhamento(t)}</td>
              <td>${situacao(t)}<div class="sa-sub">até ${dataBR(t.situacao === 'cliente' ? (t.loja_expira || t.expira_em) : t.expira_em)}</div>${linhaIA(t)}</td>
              <td>${uso(t)}</td>
              <td><div class="sa-acoes">${t.situacao === 'cliente' ? '<span class="sa-sub">em Clientes</span>' : `
                <button class="btn bp bsm" data-acao="ativar" data-id="${t.id}">Ativar como cliente</button>
                <button class="btn bd bsm" data-acao="excluir" data-id="${t.id}">Excluir</button>`}</div></td>
            </tr>`;
          }).join('')}</tbody>
        </table>` : `<div class="sa-vazio"><b>${T.dados.testes.length ? 'Nenhum teste neste filtro' : 'Nenhum teste criado ainda'}</b>${T.dados.testes.length ? 'Troque o filtro ou a busca.' : (c.ativo ? 'Quando alguém criar uma conta pelo site, ela aparece aqui.' : 'Ligue o teste grátis para o site começar a oferecer.')}</div>`}
      </div>`;
  }

  function modal(id, titulo, corpo, rodape, largura) {
    document.getElementById(id)?.remove();
    const bg = document.createElement('div');
    bg.className = 'modal-bg on';
    bg.id = id;
    bg.innerHTML = `<div class="modal" style="width:${largura || 460}px" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <button class="modal-x" data-fechar aria-label="Fechar">×</button>
      <h2>${esc(titulo)}</h2>${corpo}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;flex-wrap:wrap">${rodape}</div></div>`;
    bg.addEventListener('click', ev => { if (ev.target === bg || ev.target.closest('[data-fechar]')) bg.remove(); });
    document.body.appendChild(bg);
    return bg;
  }

  function abrirAtivar(id) {
    const t = T.dados.testes.find(x => x.id === id);
    if (!t) return;
    const base = new Date(T.dados.hoje + 'T12:00:00Z');
    base.setUTCDate(base.getUTCDate() + 30);
    const m = modal('sa-m-ativar', 'Ativar como cliente', `
      <div class="sa-dica" style="font-size:13px;margin-bottom:16px"><b style="color:var(--text)">${esc(t.loja || t.restaurante)}</b> deixa de ser teste e passa a ser cliente, com tudo o que já cadastrou. A partir daí ela aparece em Clientes.</div>
      <div class="mrow2">
        <div class="sa-campo"><label for="sa-at-validade">Válido até</label><input class="minput" id="sa-at-validade" type="date" min="${T.dados.hoje}" value="${base.toISOString().slice(0, 10)}"></div>
        <div class="sa-campo"><label for="sa-at-valor">Mensalidade (R$)</label><input class="minput" id="sa-at-valor" type="number" step="0.01" min="0" placeholder="Preço do plano"></div>
      </div>
      <div class="sa-dica" style="margin-top:8px">Deixe a mensalidade em branco para usar o preço normal do plano.</div>`,
      `<button class="btn bg2" data-fechar>Cancelar</button><button class="btn bp" id="sa-at-ok">Ativar como cliente</button>`);
    $('sa-at-ok').addEventListener('click', async () => {
      const botao = $('sa-at-ok');
      botao.disabled = true;
      try {
        const d = await api('POST', '/api/admin/testes/ativar', { id, expires_at: $('sa-at-validade').value, valor_mensalidade: $('sa-at-valor').value });
        T.dados = { ...T.dados, testes: d.testes, resumo: d.resumo };
        m.remove(); marcarTestes(); renderTestes();
        toast('ok', (t.loja || t.restaurante) + ' agora é cliente');
        try { auditLog('teste.ativar', { tipo: 'tenant', id: t.tenant_id, nome: t.loja || t.restaurante }, { validade: $('sa-at-validade')?.value }); } catch (e) {}
        if (typeof loadAll === 'function') loadAll();
      } catch (e) { botao.disabled = false; toast('err', e.message); }
    });
  }

  function abrirExcluir(id, expirados) {
    const t = id ? T.dados.testes.find(x => x.id === id) : null;
    if (id && !t) return;
    const n = T.dados.resumo.expirados;
    const m = modal('sa-m-excluir', expirados ? 'Excluir testes expirados' : 'Excluir teste', `
      <div class="sa-dica" style="font-size:13px">${expirados
        ? `Apaga ${n === 1 ? 'a loja do teste expirado' : 'as lojas dos ' + n + ' testes expirados'}, com cardápio, pedidos e acesso.`
        : `Apaga a loja <b style="color:var(--text)">${esc(t.loja || t.restaurante)}</b>, com cardápio, pedidos e acesso de ${esc(t.nome)}.`} Não dá para desfazer.</div>`,
      `<button class="btn bg2" data-fechar>Cancelar</button><button class="btn bd" id="sa-ex-ok">${expirados ? 'Excluir expirados' : 'Excluir teste'}</button>`);
    $('sa-ex-ok').addEventListener('click', async () => {
      const botao = $('sa-ex-ok');
      botao.disabled = true;
      try {
        const d = await api('POST', '/api/admin/testes/excluir', expirados ? { expirados: true } : { id });
        T.dados = { ...T.dados, testes: d.testes, resumo: d.resumo };
        m.remove(); marcarTestes(); renderTestes();
        toast('ok', d.excluidos === 1 ? 'Teste excluído' : d.excluidos + ' testes excluídos');
        try { auditLog('teste.excluir', { tipo: 'tenant', id: t ? t.tenant_id : 'expirados', nome: t ? (t.loja || t.restaurante) : 'expirados' }, { excluidos: d.excluidos }); } catch (e) {}
        if (typeof loadAll === 'function') loadAll();
      } catch (e) { botao.disabled = false; toast('err', e.message); }
    });
  }

  async function verSenha(id) {
    try {
      T.senhas[id] = await api('POST', '/api/admin/testes/senha', { id });
      renderTestes();
    } catch (e) { toast('err', e.message); }
  }

  async function enviarMensagem(id, botao) {
    if (botao) { botao.disabled = true; botao.textContent = 'enviando...'; }
    try {
      const d = await api('POST', '/api/admin/testes/mensagem', { id });
      T.dados = { ...T.dados, testes: d.testes, resumo: d.resumo };
      renderTestes();
      toast('ok', 'Mensagem enviada no WhatsApp');
    } catch (e) { toast('err', e.message); await carregarTestes(true); renderTestes(); }
  }

  // soChave: a chave de ligar/desligar salva na hora e não mexe no que está sendo digitado
  async function salvarConfig(parcial, msg, soChave) {
    try {
      const d = await api('POST', '/api/admin/testes/config', parcial);
      T.dados.config = d.config;
      if (!soChave) T.rascunho = {};
      renderTestes();
      toast('ok', msg);
      if (S.conteudo) renderSite();
    } catch (e) { toast('err', e.message); renderTestes(); }
  }

  function ligarTestes() {
    const sec = $('sec-testes');
    if (!sec || sec.dataset.ligado) return;
    sec.dataset.ligado = '1';
    sec.addEventListener('click', ev => {
      const f = ev.target.closest('[data-filtro]');
      if (f) { T.filtro = f.dataset.filtro; renderTestes(); return; }
      const vp = ev.target.closest('[data-vis]');
      if (vp) { T.visPeriodo = vp.dataset.vis; renderTestes(); return; }
      const a = ev.target.closest('[data-acao]');
      if (!a) return;
      const id = parseInt(a.dataset.id, 10);
      if (a.dataset.acao === 'atualizar') carregarTestes();
      if (a.dataset.acao === 'ativar') abrirAtivar(id);
      if (a.dataset.acao === 'excluir') abrirExcluir(id);
      if (a.dataset.acao === 'excluir-expirados') abrirExcluir(null, true);
      if (a.dataset.acao === 'salvar-config') salvarConfig({
        dias: $('sa-teste-dias').value, limite_dia: $('sa-teste-limite').value,
        gestor_url: $('sa-teste-gestor').value.trim(), download_url: $('sa-teste-download').value.trim(),
        msg_ativa: $('sa-teste-msg-ativa').checked, msg_minutos: $('sa-teste-msg-min').value, msg_texto: $('sa-teste-msg-texto').value,
        seq_ativa: $('sa-teste-seq-ativa').checked,
        seq: Object.fromEntries(ETAPAS_UI.map(([k]) => [k, $('sa-seq-' + k).value])),
        fluxos: Object.fromEntries(['boasvindas', ...ETAPAS_UI.map(([k]) => k)].map(k => [k, $('sa-fluxo-' + k) ? ($('sa-fluxo-' + k).value || null) : undefined]).filter(([, x]) => x !== undefined)),
        meta_pixel: $('sa-meta-pixel').value.trim(), meta_teste: $('sa-meta-teste').value.trim(),
        ...($('sa-meta-token').value.trim() ? { meta_token: $('sa-meta-token').value.trim() } : {})
      }, 'Configuração do teste salva');
      if (a.dataset.acao === 'ir-marketing') { navTo('marketing'); return; }
      if (a.dataset.acao === 'fluxos-prontos') {
        if (!confirm('Criar de novo os fluxos prontos do teste grátis (com os vídeos e as imagens)? Eles entram no Marketing como fluxos novos e passam a ser usados em todas as etapas. Os fluxos que você já tem não são apagados.')) return;
        api('POST', '/api/admin/testes/fluxos-prontos', {}).then(() => { toast('ok', 'Fluxos prontos criados e ligados às etapas'); ['boasvindas', ...ETAPAS_UI.map(([k]) => k)].forEach(k => delete T.rascunho['sa-fluxo-' + k]); carregarTestes(); }).catch(e => toast('err', e.message));
        return;
      }
      if (a.dataset.acao === 'msg-padrao') { T.rascunho['sa-teste-msg-texto'] = T.dados.config.msg_padrao; renderTestes(); }
      if (a.dataset.acao === 'seq-padrao') { T.rascunho['sa-seq-' + a.dataset.etapa] = T.dados.config.seq_padrao?.[a.dataset.etapa] || ''; renderTestes(); }
      if (a.dataset.acao === 'senha') verSenha(id);
      if (a.dataset.acao === 'ocultar-senha') { delete T.senhas[id]; renderTestes(); }
      if (a.dataset.acao === 'copiar-senha') {
        const senha = T.senhas[id]?.senha || '';
        (navigator.clipboard ? navigator.clipboard.writeText(senha) : Promise.reject()).then(() => toast('ok', 'Senha copiada')).catch(() => toast('err', 'Não foi possível copiar: selecione e copie à mão'));
      }
      if (a.dataset.acao === 'mensagem') enviarMensagem(id, a);
    });
    sec.addEventListener('change', ev => {
      if (ev.target.id === 'sa-teste-ativo') {
        const ligar = ev.target.checked;
        salvarConfig({ ativo: ligar }, ligar ? 'Teste grátis ligado: o site já está oferecendo' : 'Teste grátis desligado: o site parou de oferecer', true);
      }
      if (ev.target.id === 'sa-compra-ativa') {
        const ligar = ev.target.checked;
        salvarConfig({ compra_ativa: ligar }, ligar ? 'Compra pelo site ligada: o botão da oferta abre o pagamento' : 'Compra pelo site desligada: o botão da oferta volta para o WhatsApp', true).then(() => carregarTestes(true));
      }
      if (ev.target.id === 'sa-teste-ia') {
        const ligar = ev.target.checked;
        salvarConfig({ ia_teste: ligar }, ligar ? 'Atendente com IA liberada nos próximos testes' : 'Os próximos testes vêm sem a atendente com IA', true);
      }
      if (ev.target.id === 'sa-aviso-wa-teste') {
        const ligar = ev.target.checked;
        salvarConfig({ aviso_wa_teste: ligar }, ligar ? 'Aviso do robô ligado para quem está em teste' : 'Aviso do robô desligado para quem está em teste', true);
      }
      if (ev.target.id === 'sa-aviso-wa-clientes') {
        const ligar = ev.target.checked;
        salvarConfig({ aviso_wa_clientes: ligar }, ligar ? 'Aviso do robô ligado para os clientes' : 'Aviso do robô desligado para os clientes', true);
      }
      if (/^sa-fluxo-/.test(ev.target.id)) { T.rascunho[ev.target.id] = ev.target.value; renderTestes(); return; }
      if (ev.target.id === 'sa-teste-msg-ativa') { T.rascunho['sa-teste-msg-ativa'] = ev.target.checked; renderTestes(); }
      if (ev.target.id === 'sa-teste-seq-ativa') { T.rascunho['sa-teste-seq-ativa'] = ev.target.checked; renderTestes(); }
    });
    sec.addEventListener('input', ev => {
      if (/^sa-teste-(dias|limite|gestor|download|msg-min|msg-texto)$/.test(ev.target.id) || /^sa-(seq-(dia1|dia2|dia3|dia5|vespera|expirou)|meta-(pixel|token|teste))$/.test(ev.target.id)) { T.rascunho[ev.target.id] = ev.target.value; return; }
      if (ev.target.id !== 'sa-teste-busca') return;
      T.busca = ev.target.value;
      const pos = ev.target.selectionStart;
      renderTestes();
      const campo = $('sa-teste-busca');
      if (campo) { campo.focus(); try { campo.setSelectionRange(pos, pos); } catch (e) {} }
    });
  }

  function initTestes() {
    css(); ligarTestes();
    renderTestes();
    carregarTestes();
  }

  // ════════════════════════════════════════════════════
  // SITE
  // ════════════════════════════════════════════════════
  const S = { conteudo: null, original: '', padrao: null, midias: [], base: '', aba: 'camadas', sel: null, atualizado: null, personalizado: false };

  const ICONES = ['relogio', 'conversa', 'grafico', 'celular', 'link', 'cartao', 'casa', 'check', 'estrela', 'caminhao', 'impressora', 'cupom', 'raio', 'coracao', 'mapa', 'pessoas', 'lista', 'pulso', 'barras'];
  const NOME_ICONE = { relogio: 'Relógio', conversa: 'Conversa', grafico: 'Gráfico', celular: 'Celular', link: 'Link', cartao: 'Cartão', casa: 'Casa', check: 'Certo', estrela: 'Estrela', caminhao: 'Entrega', impressora: 'Impressora', cupom: 'Cupom', raio: 'Raio', coracao: 'Coração', mapa: 'Local', pessoas: 'Pessoas', lista: 'Lista', pulso: 'Pulso', barras: 'Barras' };
  const FUNDOS = [['claro', 'Branco'], ['suave', 'Creme'], ['escuro', 'Roxo escuro']];
  const DESTINOS = [['whatsapp', 'Abrir o WhatsApp'], ['teste', 'Ir para o teste grátis'], ['oferta', 'Ir para a oferta'], ['comprar', 'Abrir a compra pelo site (Pix ou cartão)']];

  const t = (k, label, extra) => ({ k, label, t: 'texto', ...extra });
  const a = (k, label, extra) => ({ k, label, t: 'area', ...extra });
  const img = (k, label) => ({ k, label, t: 'img' });
  const lista = (k, label, extra) => ({ k, label, t: 'lista', ...extra });
  const itens = (k, label, campos, extra) => ({ k, label, t: 'itens', campos, ...extra });
  const sel = (k, label, opcoes) => ({ k, label, t: 'sel', opcoes });
  const ico = k => ({ k, label: 'Ícone', t: 'sel', opcoes: ICONES.map(i => [i, NOME_ICONE[i]]) });
  const cabecalho = [t('tag', 'Etiqueta acima do título'), t('titulo', 'Título'), a('texto', 'Texto')];
  const telas = (k, label) => itens(k, label, [img('url', 'Imagem'), t('alt', 'Descrição da imagem')], { fixo: true, duas: false });
  const botaoExtra = [t('botao', 'Texto do botão (em branco = sem botão)'), sel('botao_link', 'O botão leva para', DESTINOS)];
  const secaoVideo = [...cabecalho, lista('pontos', 'Pontos com check', { max: 6 }),
    { k: 'video', label: 'Vídeo MP4 (toca sem som quando aparece na tela)', t: 'img', video: true }, img('video_capa', 'Capa do vídeo'),
    { k: 'video_celular', label: 'Vídeo em pé para celular (opcional; no celular entra no lugar do vídeo acima)', t: 'img', video: true }, img('video_celular_capa', 'Capa do vídeo para celular'), ...botaoExtra];

  const TIPOS = {
    hero: { nome: 'Abertura', campos: [t('selo', 'Selo acima do título'), t('titulo1', 'Título, 1ª linha'), t('titulo_destaque', 'Título, linha em laranja'), t('titulo2', 'Título, 3ª linha'), a('texto', 'Texto'),
      t('botao1', 'Botão principal'), t('botao2', 'Botão secundário'),
      itens('numeros', 'Números em destaque', [t('valor', 'Valor'), t('rotulo', 'Legenda')], { max: 4, duas: true }),
      t('flutuante_titulo', 'Etiqueta flutuante: valor'), t('flutuante_texto', 'Etiqueta flutuante: legenda'),
      telas('imagens', 'Telas dos celulares atrás da conversa com a IA')] },
    ia: { nome: 'Atendente com IA (vídeo)', campos: secaoVideo },
    'cardapio-ia': { nome: 'Cardápio por IA (vídeo)', campos: secaoVideo },
    garcom: { nome: 'App do garçom (vídeo)', campos: secaoVideo },
    teste: { nome: 'Teste grátis', campos: [t('tag', 'Etiqueta acima do título'), t('titulo', 'Título'), a('texto', 'Texto'), t('botao', 'Botão do cadastro'), t('miudo', 'Frase abaixo do botão'),
      t('chamada', 'Chamada nos botões do site'), t('chamada_curta', 'Chamada curta (botão do topo)'), t('nota_hero', 'Frase abaixo do botão da abertura'),
      t('barra', 'Barra do topo: texto'), t('barra_botao', 'Barra do topo: botão'),
      t('comanda_topo', 'Comanda: linha abaixo da marca'), t('comanda_titulo', 'Comanda: título'), lista('itens', 'Comanda: itens inclusos (todos saem por R$ 0,00)', { max: 8 }),
      t('comanda_pe', 'Comanda: rodapé'), t('dias_rotulo', 'Selo redondo: texto abaixo de "R$ 0"'),
      t('sucesso_titulo', 'Conta criada: título'), a('sucesso_texto', 'Conta criada: texto')] },
    demo: { nome: 'Vídeo de demonstração', campos: [t('tag', 'Etiqueta acima do título'), t('titulo', 'Título'), a('texto', 'Texto'), lista('pontos', 'Pontos em destaque', { max: 5 }),
      t('video', 'Vídeo do YouTube (link ou código)'), t('video_titulo', 'Texto sobre o vídeo'), t('video_sub', 'Texto pequeno sobre o vídeo'), t('video_legenda', 'Legenda abaixo do vídeo')] },
    faixa: { nome: 'Faixa que corre', campos: [lista('itens', 'Frases da faixa', { max: 12 })] },
    problema: { nome: 'O problema', campos: [...cabecalho, itens('cards', 'Cartões', [ico('icone'), t('titulo', 'Título'), a('texto', 'Texto')], { max: 6 })] },
    escolha: { nome: 'Antes e depois', campos: [...cabecalho,
      t('antes_rotulo', 'Coluna "antes": etiqueta'), a('antes_titulo', 'Coluna "antes": título'), lista('antes_itens', 'Coluna "antes": itens', { max: 12 }),
      t('depois_rotulo', 'Coluna "depois": etiqueta'), a('depois_titulo', 'Coluna "depois": título'), lista('depois_itens', 'Coluna "depois": itens', { max: 12 })] },
    recursos: { nome: 'Recursos', campos: [...cabecalho, itens('cards', 'Recursos (o 1º fica em destaque)', [ico('icone'), t('titulo', 'Título'), a('texto', 'Texto')], { max: 12 })] },
    'como-funciona': { nome: 'Como funciona', campos: [...cabecalho, itens('itens', 'Pontos', [t('titulo', 'Frase em negrito'), t('texto', 'Complemento')], { max: 6 }), telas('imagens', 'Telas dos celulares')] },
    gestor: { nome: 'Painel do gestor', campos: [...cabecalho, lista('pontos', 'Pontos', { fixo: true }),
      t('flutuante_rotulo', 'Cartão flutuante: etiqueta'), t('flutuante_titulo', 'Cartão flutuante: título'), t('flutuante_texto', 'Cartão flutuante: rodapé'),
      itens('passos', 'Os três passos', [t('titulo', 'Título'), t('texto', 'Texto')], { fixo: true, duas: true }),
      t('videos_tag', 'Vídeos: etiqueta'), t('videos_titulo', 'Vídeos: título'), a('videos_texto', 'Vídeos: texto'), lista('videos_selos', 'Vídeos: selos', { max: 5 }),
      sel('videos_visivel', 'Bloco "Apresentação do gestor" (vídeos do YouTube)', [['nao', 'Esconder'], ['sim', 'Mostrar']]),
      itens('videos', 'Vídeos curtos (YouTube)', [t('video', 'Link ou código do vídeo'), t('legenda', 'Legenda')], { fixo: true, duas: true })] },
    conta: { nome: 'A conta', campos: [...cabecalho,
      t('a_rotulo', 'Lado da plataforma: etiqueta'), itens('a_linhas', 'Lado da plataforma: linhas', [t('nome', 'Descrição'), t('valor', 'Valor')], { max: 6, duas: true }), t('a_total_rotulo', 'Lado da plataforma: total (texto)'), t('a_total_valor', 'Lado da plataforma: total (valor)'),
      t('b_rotulo', 'Lado EstimaFood: etiqueta'), itens('b_linhas', 'Lado EstimaFood: linhas', [t('nome', 'Descrição'), t('valor', 'Valor')], { max: 6, duas: true }), t('b_total_rotulo', 'Lado EstimaFood: total (texto)'), t('b_total_valor', 'Lado EstimaFood: total (valor)'),
      t('conclusao_titulo', 'Conclusão: título'), a('conclusao_texto', 'Conclusão: texto')] },
    oferta: { nome: 'Oferta e preço', campos: [a('selo', 'Selo redondo (uma palavra por linha)'), t('tag', 'Etiqueta'), t('titulo', 'Título'),
      t('preco_de', 'Linha do preço antigo'), t('periodo', 'Ao lado do preço'), t('periodo_sub', 'Ao lado do preço: linha menor'),
      lista('itens', 'O que está incluso', { max: 12 }), t('botao', 'Botão'), sel('botao_link', 'O botão leva para', DESTINOS), a('nota', 'Nota abaixo do botão'),
      t('cronometro_minutos', 'Cronômetro da oferta, em minutos (0 = sem cronômetro)'), a('encerrada', 'Mensagem quando o tempo acaba')] },
    faq: { nome: 'Dúvidas', campos: [t('tag', 'Etiqueta acima do título'), t('titulo', 'Título'), itens('itens', 'Perguntas', [t('pergunta', 'Pergunta'), a('resposta', 'Resposta')], { max: 20 })] },
    contato: { nome: 'Contato', campos: [...cabecalho, t('botao', 'Botão do WhatsApp'), lista('segmentos', 'Segmentos atendidos', { max: 12 }), t('nota', 'Nota final')] },

    'texto-imagem': { nome: 'Texto com imagem', nova: true, campos: [...cabecalho, img('imagem.url', 'Imagem'), t('imagem.alt', 'Descrição da imagem'),
      sel('lado', 'Posição da imagem', [['direita', 'À direita do texto'], ['esquerda', 'À esquerda do texto']]), sel('fundo', 'Fundo', FUNDOS), ...botaoExtra],
      padrao: { tag: '', titulo: 'Título da nova camada', texto: 'Escreva aqui o texto desta parte do site.', imagem: { url: '', alt: '' }, lado: 'direita', fundo: 'claro', botao: '', botao_link: 'whatsapp' } },
    video: { nome: 'Vídeo', nova: true, campos: [...cabecalho, t('video', 'Vídeo do YouTube (link ou código)'), { k: 'arquivo', label: 'Ou envie um vídeo MP4', t: 'img', video: true }, sel('fundo', 'Fundo', FUNDOS), ...botaoExtra],
      padrao: { tag: '', titulo: 'Veja em vídeo', texto: '', video: '', arquivo: '', fundo: 'claro', botao: '', botao_link: 'whatsapp' } },
    galeria: { nome: 'Galeria de imagens', nova: true, campos: [...cabecalho, itens('imagens', 'Imagens', [img('url', 'Imagem'), t('alt', 'Legenda')], { max: 12 }), sel('fundo', 'Fundo', FUNDOS), ...botaoExtra],
      padrao: { tag: '', titulo: 'Galeria', texto: '', imagens: [], fundo: 'claro', botao: '', botao_link: 'whatsapp' } },
    cartoes: { nome: 'Cartões', nova: true, campos: [...cabecalho, itens('cards', 'Cartões', [ico('icone'), t('titulo', 'Título'), a('texto', 'Texto')], { max: 9 }), sel('fundo', 'Fundo', FUNDOS), ...botaoExtra],
      padrao: { tag: '', titulo: 'Título desta parte', texto: '', cards: [{ icone: 'check', titulo: 'Primeiro ponto', texto: 'Explique em uma ou duas frases.' }, { icone: 'estrela', titulo: 'Segundo ponto', texto: 'Explique em uma ou duas frases.' }, { icone: 'raio', titulo: 'Terceiro ponto', texto: 'Explique em uma ou duas frases.' }], fundo: 'claro', botao: '', botao_link: 'whatsapp' } },
    depoimentos: { nome: 'Depoimentos', nova: true, campos: [t('tag', 'Etiqueta acima do título'), t('titulo', 'Título'), itens('itens', 'Depoimentos', [a('texto', 'O que a pessoa disse'), t('nome', 'Nome'), t('loja', 'Loja e cidade'), img('foto', 'Foto')], { max: 9 }), sel('fundo', 'Fundo', FUNDOS)],
      padrao: { tag: 'Quem usa', titulo: 'O que dizem os clientes', itens: [{ texto: '', nome: '', loja: '', foto: '' }], fundo: 'suave' } },
    destaque: { nome: 'Chamada em destaque', nova: true, campos: [t('titulo', 'Título'), a('texto', 'Texto'), ...botaoExtra],
      padrao: { titulo: 'Uma chamada forte aqui', texto: '', botao: 'Falar no WhatsApp', botao_link: 'whatsapp' } }
  };

  const GERAL = [t('url_site', 'Endereço do site (para os botões Ver site e Pré-visualizar)'), t('whatsapp', 'WhatsApp de contato (com 55 e DDD, só números)'), a('mensagem_whatsapp', 'Mensagem que já vai escrita no WhatsApp'),
    t('botao_topo', 'Botão do topo'), t('botao_celular', 'Botão fixo no celular'), t('titulo_pagina', 'Título da página (aba do navegador e Google)'), a('descricao_pagina', 'Descrição da página (Google e redes sociais)'), t('rodape', 'Rodapé')];

  const sujo = () => S.conteudo && JSON.stringify(S.conteudo) !== S.original;

  function ler(obj, caminho) {
    return String(caminho).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function gravar(obj, caminho, valor) {
    const partes = String(caminho).split('.');
    let o = obj;
    for (let i = 0; i < partes.length - 1; i++) {
      const k = partes[i];
      if (o[k] == null || typeof o[k] !== 'object') o[k] = /^\d+$/.test(partes[i + 1]) ? [] : {};
      o = o[k];
    }
    o[partes[partes.length - 1]] = valor;
  }

  function urlMidia(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (/^https?:\/\//i.test(u) || u.startsWith('/uploads/')) return u;
    const site = String(S.conteudo?.geral?.url_site || '').trim().replace(/\/+$/, '');
    return /^https?:\/\//i.test(site) ? site + '/' + u.replace(/^\/+/, '') : '';
  }

  function campo(f, valor, caminho) {
    const id = 'sa-f-' + caminho.replace(/[^a-z0-9]/gi, '-');
    if (f.t === 'texto') return `<input class="minput" id="${id}" data-caminho="${esc(caminho)}" value="${esc(valor ?? '')}">`;
    if (f.t === 'area') return `<textarea class="minput" id="${id}" data-caminho="${esc(caminho)}">${esc(valor ?? '')}</textarea>`;
    if (f.t === 'sel') return `<select class="minput" id="${id}" data-caminho="${esc(caminho)}">${f.opcoes.map(([v, l]) => `<option value="${esc(v)}" ${String(valor ?? '') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    if (f.t === 'img') {
      const previa = f.video ? '' : urlMidia(valor);
      return `<div class="sa-img">
        <div class="sa-img-previa" ${previa ? `style="background-image:url('${esc(previa)}')"` : ''}>${previa ? '' : (valor ? (f.video ? 'vídeo' : 'sem prévia') : 'vazio')}</div>
        <div><input class="minput" id="${id}" data-caminho="${esc(caminho)}" value="${esc(valor ?? '')}" placeholder="${f.video ? 'Nenhum vídeo enviado' : 'Endereço da imagem'}">
          <div class="sa-img-botoes">
            <button type="button" class="btn bg2 bsm" data-enviar="${esc(caminho)}" data-tipo="${f.video ? 'video' : 'imagem'}">${f.video ? 'Enviar vídeo' : 'Enviar imagem'}</button>
            <button type="button" class="btn bg2 bsm" data-biblioteca="${esc(caminho)}" data-tipo="${f.video ? 'video' : 'imagem'}">Escolher das mídias</button>
            ${valor ? `<button type="button" class="btn bg2 bsm" data-limpar="${esc(caminho)}">Tirar</button>` : ''}
          </div></div></div>`;
    }
    if (f.t === 'lista') {
      const arr = Array.isArray(valor) ? valor : [];
      return `<div class="sa-itens">${arr.map((v, i) => `<div class="sa-linha">
          <input class="minput" data-caminho="${esc(caminho + '.' + i)}" value="${esc(v ?? '')}" aria-label="${esc(f.label)} ${i + 1}">
          ${botoesItem(caminho, i, arr.length, f)}</div>`).join('')}
        ${f.fixo || arr.length >= (f.max || 30) ? '' : `<div><button type="button" class="btn bg2 bsm" data-add="${esc(caminho)}" data-novo="texto">${ICO.mais} Adicionar</button></div>`}</div>`;
    }
    if (f.t === 'itens') {
      const arr = Array.isArray(valor) ? valor : [];
      return `<div class="sa-itens">${arr.map((item, i) => `<div class="sa-item">
          <div class="sa-item-campos ${f.duas ? 'duas' : ''}">${f.campos.map(sub => `<div class="sa-campo"><label>${esc(sub.label)}</label>${campo(sub, ler(item, sub.k), caminho + '.' + i + '.' + sub.k)}</div>`).join('')}</div>
          ${botoesItem(caminho, i, arr.length, f)}</div>`).join('')}
        ${f.fixo || arr.length >= (f.max || 30) ? '' : `<div><button type="button" class="btn bg2 bsm" data-add="${esc(caminho)}" data-novo="${esc(JSON.stringify(Object.fromEntries(f.campos.map(s => [s.k, s.t === 'sel' ? s.opcoes[0][0] : '']))))}">${ICO.mais} Adicionar</button></div>`}</div>`;
    }
    return '';
  }

  function botoesItem(caminho, i, total, f) {
    if (f.fixo) return '<div></div>';
    return `<div class="sa-item-botoes">
      <button type="button" class="sa-mini" data-mover="${esc(caminho)}" data-i="${i}" data-para="-1" ${i === 0 ? 'disabled' : ''} title="Subir" aria-label="Subir">${ICO.cima}</button>
      <button type="button" class="sa-mini" data-mover="${esc(caminho)}" data-i="${i}" data-para="1" ${i === total - 1 ? 'disabled' : ''} title="Descer" aria-label="Descer">${ICO.baixo}</button>
      <button type="button" class="sa-mini perigo" data-remover="${esc(caminho)}" data-i="${i}" title="Remover" aria-label="Remover">${ICO.x}</button></div>`;
  }

  function formulario(campos, dados, prefixo) {
    return campos.map(f => `<div class="sa-grupo"><label class="sa-rotulo" for="sa-f-${(prefixo + f.k).replace(/[^a-z0-9]/gi, '-')}">${esc(f.label)}</label>${campo(f, ler(dados, f.k), prefixo + f.k)}</div>`).join('');
  }

  function resumoCamada(c) {
    const d = c.dados || {};
    const bruto = d.titulo || [d.titulo1, d.titulo_destaque, d.titulo2].filter(Boolean).join(' ') || (Array.isArray(d.itens) && typeof d.itens[0] === 'string' ? d.itens.join(' · ') : '');
    return String(bruto).replace(/\*+/g, '').replace(/\{dias\}/g, String(T.dados?.config?.dias || 7)).replace(/\s+/g, ' ');
  }

  function painelCamadas() {
    const cams = S.conteudo.camadas;
    if (!cams.some(c => c.id === S.sel)) S.sel = cams[0]?.id || null;
    const atual = cams.find(c => c.id === S.sel);
    const tipo = atual ? TIPOS[atual.tipo] : null;
    const testeLigado = !!T.dados?.config?.ativo;
    const prefixo = atual ? 'camadas.' + cams.indexOf(atual) + '.dados.' : '';
    return `<div class="sa-editor">
      <div class="sa-lista">
        <div class="sa-lista-topo">As camadas aparecem no site nesta ordem. Use as setas para mudar de lugar e o olho para esconder.</div>
        ${cams.map((c, i) => {
          const ehTeste = c.tipo === 'teste';
          const oculta = ehTeste ? !testeLigado : c.visivel === false;
          return `<div class="sa-cam ${c.id === S.sel ? 'on' : ''} ${oculta ? 'oculta' : ''}" data-cam="${esc(c.id)}">
            <div class="sa-cam-nome"><b>${esc(TIPOS[c.tipo]?.nome || c.tipo)}</b><small>${ehTeste ? (testeLigado ? 'Teste ligado: aparecendo' : 'Teste desligado: escondida') : esc(resumoCamada(c) || '—')}</small></div>
            <button type="button" class="sa-mini" data-cam-mover="${i}" data-para="-1" ${i === 0 ? 'disabled' : ''} title="Subir" aria-label="Subir camada">${ICO.cima}</button>
            <button type="button" class="sa-mini" data-cam-mover="${i}" data-para="1" ${i === cams.length - 1 ? 'disabled' : ''} title="Descer" aria-label="Descer camada">${ICO.baixo}</button>
            ${ehTeste ? '' : `<button type="button" class="sa-mini" data-cam-ver="${i}" title="${oculta ? 'Mostrar no site' : 'Esconder do site'}" aria-label="${oculta ? 'Mostrar no site' : 'Esconder do site'}">${oculta ? ICO.olhoOff : ICO.olho}</button>`}
          </div>`;
        }).join('')}
        <div class="sa-add">
          <select class="minput" id="sa-nova-tipo" aria-label="Tipo da nova camada">${Object.entries(TIPOS).filter(([, v]) => v.nova).map(([k, v]) => `<option value="${k}">${esc(v.nome)}</option>`).join('')}</select>
          <button type="button" class="btn bp" data-acao="nova-camada">${ICO.mais} Adicionar</button>
        </div>
      </div>
      <div class="sa-form">${atual && tipo ? `
        <div class="sa-form-topo">
          <div><div class="sa-form-titulo">${esc(tipo.nome)}</div>
          <div class="sa-dica" style="margin-top:4px">*Entre asteriscos* fica em laranja e **entre dois** fica em negrito. {preco}, {preco_de} e {dias} são trocados pelos valores atuais.</div></div>
          ${tipo.nova ? `<button type="button" class="btn bd bsm" data-acao="excluir-camada">${ICO.lixo} Excluir camada</button>` : ''}
        </div>
        ${atual.tipo === 'teste' ? `<div class="infobox infobox-blue" style="margin-top:14px">Esta camada só aparece no site com o teste grátis ligado. <a href="#" data-acao="ir-testes" style="color:var(--accent);font-weight:700">${testeLigado ? 'Está ligado' : 'Está desligado'}: abrir Testes grátis</a></div>` : ''}
        ${formulario(tipo.campos, atual.dados, prefixo)}` : '<div class="sa-vazio">Escolha uma camada ao lado.</div>'}
      </div>
    </div>`;
  }

  function painelPrecos() {
    const p = S.conteudo.precos || (S.conteudo.precos = { atual: '', de: '' });
    return `<div class="card" style="max-width:720px">
      <div class="card-head"><div><div class="card-title">Preços que aparecem no site</div><div class="card-sub">Mudou aqui, muda na abertura, na oferta e em todo texto que usa {preco} ou {preco_de}</div></div></div>
      <div class="sa-duas">
        <div class="sa-campo"><label for="sa-preco-atual">Preço em destaque (R$)</label><input class="minput" id="sa-preco-atual" data-caminho="precos.atual" value="${esc(p.atual)}" inputmode="decimal" placeholder="99,90" style="font-size:22px;font-weight:800;font-family:'Space Grotesk',sans-serif"></div>
        <div class="sa-campo"><label for="sa-preco-de">Preço riscado, o "de" (R$)</label><input class="minput" id="sa-preco-de" data-caminho="precos.de" value="${esc(p.de)}" inputmode="decimal" placeholder="149,90" style="font-size:22px;font-weight:800;font-family:'Space Grotesk',sans-serif"></div>
      </div>
      <div class="sa-dica" style="margin-top:12px">Escreva com vírgula, como no site: 99,90. Este é o preço da vitrine; o valor cobrado dos clientes continua em Planos &amp; Leads.</div>
    </div>`;
  }

  function painelGeral() {
    return `<div class="card sa-geral" style="max-width:820px">${formulario(GERAL, S.conteudo.geral || {}, 'geral.')}</div>`;
  }

  function cartaoMidia(m, escolher) {
    const kb = m.tamanho > 1048576 ? (m.tamanho / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(m.tamanho / 1024)) + ' KB';
    return `<div class="sa-midia ${escolher ? 'escolher' : ''}" ${escolher ? `data-escolher="${esc(m.url)}"` : ''}>
      <div class="sa-midia-img" ${m.tipo === 'imagem' ? `style="background-image:url('${esc(m.url)}')"` : ''}>${m.tipo === 'video' ? 'Vídeo MP4' : ''}</div>
      <div class="sa-midia-pe"><small>${kb} · ${dataBR(m.data)}</small>${escolher ? '' : `<button type="button" class="sa-mini perigo" data-midia-excluir="${esc(m.nome)}" title="Excluir" aria-label="Excluir mídia">${ICO.lixo}</button>`}</div></div>`;
  }

  function painelMidias() {
    return `<div class="sa-solta">Imagens em JPG, PNG, WebP ou GIF (até 8 MB) e vídeos em MP4 (até 40 MB).<br>
        <button type="button" class="btn bp" data-enviar="" data-tipo="qualquer" style="margin-top:10px">${ICO.mais} Enviar arquivo</button></div>
      ${S.midias.length ? `<div class="sa-midias">${S.midias.map(m => cartaoMidia(m)).join('')}</div>` : '<div class="sa-vazio"><b>Nenhuma mídia enviada</b>O que você enviar aqui fica disponível para usar em qualquer camada.</div>'}
      <div class="sa-dica" style="margin-top:14px">Excluir uma mídia que está em uso deixa um espaço vazio no site: troque a imagem na camada antes.</div>`;
  }

  function renderSite() {
    css();
    const sec = $('sec-site');
    if (!sec) return;
    if (!S.conteudo) { sec.innerHTML = '<div class="sa-vazio">Carregando...</div>'; return; }
    const site = String(S.conteudo.geral?.url_site || '').trim();
    const temSite = /^https?:\/\//i.test(site);
    const pendente = sujo();
    sec.innerHTML = `
      <div class="sec-head">
        <div>
          <div class="sec-head-title">Site</div>
          <div class="sec-head-sub">Textos, preços, camadas e mídias do site de vendas</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="sa-estado ${pendente ? 'pendente' : ''}" id="sa-estado">${estadoTexto()}</span>
          ${temSite ? `<a class="btn bg2" href="${esc(site)}" target="_blank" rel="noopener">Ver site</a>` : ''}
          <button class="btn bg2" data-acao="previa">Pré-visualizar</button>
          <button class="btn bg2" data-acao="restaurar">Restaurar padrão</button>
          <button class="btn bp" data-acao="publicar" id="sa-publicar" ${pendente ? '' : 'disabled style="opacity:.5"'}>Publicar</button>
        </div>
      </div>
      <div class="sa-abas" role="tablist">
        ${[['camadas', 'Camadas'], ['precos', 'Preços'], ['geral', 'Geral'], ['midias', 'Mídias']].map(([k, l]) => `<button class="sa-aba ${S.aba === k ? 'on' : ''}" role="tab" data-aba="${k}">${l}</button>`).join('')}
      </div>
      <div id="sa-painel">${S.aba === 'camadas' ? painelCamadas() : S.aba === 'precos' ? painelPrecos() : S.aba === 'geral' ? painelGeral() : painelMidias()}</div>`;
  }

  function estadoTexto() {
    if (sujo()) return 'Alterações ainda não publicadas';
    if (!S.personalizado) return 'No ar: conteúdo padrão';
    const d = S.atualizado ? new Date(S.atualizado.replace(' ', 'T') + 'Z') : null;
    return 'Publicado' + (d && !isNaN(d) ? ' em ' + d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
  }

  function marcarEstado() {
    const el = $('sa-estado'), botao = $('sa-publicar');
    const pendente = sujo();
    if (el) { el.textContent = estadoTexto(); el.classList.toggle('pendente', pendente); }
    if (botao) { botao.disabled = !pendente; botao.style.opacity = pendente ? '' : '.5'; }
  }

  async function carregarSite() {
    try {
      const d = await api('GET', '/api/admin/site');
      S.conteudo = JSON.parse(JSON.stringify(d.conteudo));
      S.original = JSON.stringify(S.conteudo);
      S.padrao = d.padrao; S.midias = d.midias || []; S.base = d.base_url || '';
      S.atualizado = d.atualizado_em; S.personalizado = !!d.personalizado;
      renderSite();
    } catch (e) { toast('err', e.message); }
  }

  async function publicar() {
    const botao = $('sa-publicar');
    if (botao) botao.disabled = true;
    try {
      const d = await api('POST', '/api/admin/site', { conteudo: S.conteudo });
      S.original = JSON.stringify(S.conteudo);
      S.atualizado = d.atualizado_em; S.personalizado = true;
      marcarEstado();
      toast('ok', 'Site publicado');
      try { auditLog('site.publicar', { tipo: 'site', id: 'site', nome: 'Site' }, { camadas: S.conteudo.camadas.length }); } catch (e) {}
    } catch (e) { toast('err', e.message); marcarEstado(); }
  }

  function escolherArquivo(tipo) {
    return new Promise(ok => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = tipo === 'video' ? 'video/mp4' : tipo === 'imagem' ? 'image/jpeg,image/png,image/webp,image/gif' : 'image/jpeg,image/png,image/webp,image/gif,video/mp4';
      inp.addEventListener('change', () => ok(inp.files[0] || null));
      inp.click();
    });
  }

  async function enviarArquivo(arquivo) {
    const r = await fetch('/api/admin/site/midia', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (getAdminToken() || ''), 'Content-Type': arquivo.type || 'application/octet-stream' },
      body: arquivo
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Não foi possível enviar');
    S.midias.unshift({ nome: d.nome, url: d.url, tamanho: d.tamanho, tipo: d.tipo, data: new Date().toISOString() });
    return d;
  }

  function abrirBiblioteca(caminho, tipo) {
    const lista = S.midias.filter(m => tipo === 'video' ? m.tipo === 'video' : m.tipo === 'imagem');
    const m = modal('sa-m-midias', 'Escolher das mídias', lista.length
      ? `<div class="sa-midias">${lista.map(x => cartaoMidia(x, true)).join('')}</div>`
      : '<div class="sa-vazio"><b>Nenhuma mídia deste tipo ainda</b>Use "Enviar" para subir um arquivo.</div>',
      '<button class="btn bg2" data-fechar>Fechar</button>', 720);
    m.addEventListener('click', ev => {
      const alvo = ev.target.closest('[data-escolher]');
      if (!alvo) return;
      gravar(S.conteudo, caminho, alvo.dataset.escolher);
      m.remove(); renderSite();
    });
  }

  function abrirPrevia() {
    const site = String(S.conteudo.geral?.url_site || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(site)) {
      S.aba = 'geral'; renderSite();
      toast('err', 'Preencha o endereço do site para pré-visualizar');
      $('sa-f-geral-url-site')?.focus();
      return;
    }
    const origem = new URL(site).origin;
    const m = modal('sa-m-previa', 'Pré-visualização (ainda não publicado)', `
      <div style="display:flex;gap:8px;margin-bottom:12px"><div class="sa-filtros"><button class="on" data-largura="pc">Computador</button><button data-largura="celular">Celular</button></div></div>
      <iframe class="sa-previa-quadro" id="sa-previa" src="${esc(site)}/?previa=${Date.now()}" title="Pré-visualização do site"></iframe>`,
      '<button class="btn bg2" data-fechar>Fechar</button>', 1180);
    const quadro = $('sa-previa');
    const pacote = () => ({
      tipo: 'estima-previa',
      resp: { ok: true, conteudo: S.conteudo, teste: { ativo: !!T.dados?.config?.ativo, dias: T.dados?.config?.dias || 7 }, download_url: '' }
    });
    const mandar = () => { try { quadro.contentWindow.postMessage(pacote(), origem); } catch (e) {} };
    const ouvir = ev => { if (ev.origin === origem && ev.data && ev.data.tipo === 'estima-site-pronto') mandar(); };
    window.addEventListener('message', ouvir);
    quadro.addEventListener('load', () => setTimeout(mandar, 400));
    m.addEventListener('click', ev => {
      const l = ev.target.closest('[data-largura]');
      if (l) {
        m.querySelectorAll('[data-largura]').forEach(b => b.classList.toggle('on', b === l));
        quadro.classList.toggle('celular', l.dataset.largura === 'celular');
      }
      if (!document.body.contains(m)) window.removeEventListener('message', ouvir);
    });
  }

  function ligarSite() {
    const sec = $('sec-site');
    if (!sec || sec.dataset.ligado) return;
    sec.dataset.ligado = '1';

    sec.addEventListener('input', ev => {
      const c = ev.target.dataset.caminho;
      if (!c) return;
      gravar(S.conteudo, c, ev.target.value);
      marcarEstado();
    });
    sec.addEventListener('change', ev => {
      // selects e campos de imagem mudam o que aparece em volta (prévia, lista): redesenha
      if (ev.target.dataset.caminho && (ev.target.tagName === 'SELECT' || ev.target.closest('.sa-img'))) renderSite();
    });

    sec.addEventListener('click', async ev => {
      const alvo = ev.target.closest('button,a,[data-cam]');
      if (!alvo || !sec.contains(alvo)) return;
      const d = alvo.dataset;
      const cams = S.conteudo?.camadas;

      if (d.aba) { S.aba = d.aba; renderSite(); return; }
      if (d.camMover !== undefined) {
        const i = parseInt(d.camMover, 10), j = i + parseInt(d.para, 10);
        if (j >= 0 && j < cams.length) { [cams[i], cams[j]] = [cams[j], cams[i]]; renderSite(); }
        return;
      }
      if (d.camVer !== undefined) { const c = cams[parseInt(d.camVer, 10)]; c.visivel = c.visivel === false; renderSite(); return; }
      if (d.mover !== undefined) {
        const arr = ler(S.conteudo, d.mover), i = parseInt(d.i, 10), j = i + parseInt(d.para, 10);
        if (Array.isArray(arr) && j >= 0 && j < arr.length) { [arr[i], arr[j]] = [arr[j], arr[i]]; renderSite(); }
        return;
      }
      if (d.remover !== undefined) { const arr = ler(S.conteudo, d.remover); if (Array.isArray(arr)) { arr.splice(parseInt(d.i, 10), 1); renderSite(); } return; }
      if (d.add !== undefined) {
        let arr = ler(S.conteudo, d.add);
        if (!Array.isArray(arr)) { arr = []; gravar(S.conteudo, d.add, arr); }
        arr.push(d.novo === 'texto' ? '' : JSON.parse(d.novo));
        renderSite();
        return;
      }
      if (d.limpar !== undefined) { gravar(S.conteudo, d.limpar, ''); renderSite(); return; }
      if (d.biblioteca !== undefined) { abrirBiblioteca(d.biblioteca, d.tipo); return; }
      if (d.enviar !== undefined) {
        const arquivo = await escolherArquivo(d.tipo);
        if (!arquivo) return;
        toast('ok', 'Enviando ' + arquivo.name + '...');
        try {
          const r = await enviarArquivo(arquivo);
          if (d.enviar) gravar(S.conteudo, d.enviar, r.url);
          renderSite();
          toast('ok', 'Arquivo enviado');
        } catch (e) { toast('err', e.message); }
        return;
      }
      if (d.midiaExcluir) {
        if (!confirm('Excluir esta mídia? Se ela estiver em uso, o site fica com um espaço vazio.')) return;
        try { const r = await api('POST', '/api/admin/site/midia/excluir', { nome: d.midiaExcluir }); S.midias = r.midias; renderSite(); toast('ok', 'Mídia excluída'); }
        catch (e) { toast('err', e.message); }
        return;
      }
      if (d.cam && !ev.target.closest('.sa-mini')) { S.sel = d.cam; renderSite(); return; }

      if (d.acao === 'nova-camada') {
        const tipo = $('sa-nova-tipo').value;
        const nova = { id: 'c_' + Math.random().toString(36).slice(2, 8), tipo, visivel: true, dados: JSON.parse(JSON.stringify(TIPOS[tipo].padrao)) };
        const pos = cams.findIndex(c => c.id === S.sel);
        cams.splice(pos >= 0 ? pos + 1 : cams.length, 0, nova);
        S.sel = nova.id; renderSite();
        return;
      }
      if (d.acao === 'excluir-camada') {
        const i = cams.findIndex(c => c.id === S.sel);
        if (i < 0 || !confirm('Excluir esta camada do site?')) return;
        cams.splice(i, 1); S.sel = cams[Math.max(0, i - 1)]?.id || null; renderSite();
        return;
      }
      if (d.acao === 'ir-testes') { ev.preventDefault(); navTo('testes'); return; }
      if (d.acao === 'publicar') { publicar(); return; }
      if (d.acao === 'previa') { abrirPrevia(); return; }
      if (d.acao === 'restaurar') {
        if (!confirm('Voltar o site ao conteúdo padrão? Os textos, preços e camadas que você mudou são apagados. As mídias enviadas continuam guardadas.')) return;
        try {
          await api('POST', '/api/admin/site/restaurar');
          await carregarSite();
          toast('ok', 'Site voltou ao conteúdo padrão');
        } catch (e) { toast('err', e.message); }
      }
    });

    window.addEventListener('beforeunload', ev => { if (sujo()) { ev.preventDefault(); ev.returnValue = ''; } });
  }

  function initSite() {
    css(); ligarSite();
    if (S.conteudo) { renderSite(); return; }
    renderSite();
    carregarSite();
    if (!T.dados) carregarTestes(true);
  }

  // ════════════════════════════════════════════════════
  // UPGRADE IA — oferta de pedidos por IA para quem já é cliente
  // ════════════════════════════════════════════════════
  const U = { dados: null, carregando: false, filtro: 'todos' };
  const brl = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  async function carregarUpgrade() {
    U.carregando = true;
    try { U.dados = await api('GET', '/api/admin/upgrade-ia'); }
    catch (e) { toast('err', e.message); }
    U.carregando = false;
    renderUpgrade();
  }

  function situacaoUpgrade(l, vezes) {
    if (l.comprou_em) return `<span class="badge bg-green">Upgrade feito</span><div class="sa-sub">${horaLocal(l.comprou_em)}</div>`;
    const p = l.pagamento;
    if (p && p.status === 'pendente') return `<span class="badge bg-orange">Pix gerado</span><div class="sa-sub">${brl(p.valor)} aguardando</div>`;
    if (p && p.status === 'erro') return '<span class="badge bg-red">Pago, não ativou</span><div class="sa-sub">ligue "Pedido por voz" em Clientes</div>';
    if (l.clicou_em) return `<span class="badge bg-orange">Clicou em ativar</span><div class="sa-sub">viu ${l.vistas} de ${vezes}</div>`;
    if (l.vistas >= vezes) return `<span class="badge bg-gray">Viu ${l.vistas} de ${vezes}</span><div class="sa-sub">não aparece mais</div>`;
    if (l.vistas) return `<span class="badge bg-blue" style="background:rgba(59,130,246,.14);color:var(--accent)">Viu ${l.vistas} de ${vezes}</span><div class="sa-sub">última em ${dataBR(l.ultima_vista)}</div>`;
    return '<span class="badge bg-gray">Ainda não viu</span>';
  }

  function renderUpgrade() {
    const sec = $('sec-upgrade');
    if (!sec) return;
    const d = U.dados;
    if (!d) { sec.innerHTML = `<div class="card"><div class="sa-dica">${U.carregando ? 'Carregando...' : 'Não foi possível carregar.'}</div></div>`; return; }
    const c = d.config, r = d.resumo;
    const lista = d.lista.filter(l => U.filtro === 'todos' ? true : U.filtro === 'feitos' ? !!l.comprou_em : !l.comprou_em);
    const exBase = 99.90;
    sec.innerHTML = `
      <div class="card">
        <div class="sa-liga">
          <div>
            <div class="sa-liga-titulo">Oferta de upgrade: pedidos por IA ${c.ativo ? (d.mp_ok ? '<span class="badge bg-green">Ligada</span>' : '<span class="badge bg-orange">Ligada, mas sem Mercado Pago</span>') : '<span class="badge bg-gray">Desligada</span>'}</div>
            <div class="sa-liga-texto">Quando ligada, os clientes que ainda não têm os pedidos por IA veem ao abrir o painel uma tela mostrando como funciona, com a nova mensalidade e o valor proporcional para ativar hoje. Eles pagam por Pix na plataforma e o adicional liga sozinho, já entrando nas próximas faturas. Aparece no máximo uma vez por dia, até o limite de vezes abaixo, e fica sempre disponível na aba Agente IA do painel.</div>
            ${!d.mp_ok ? '<div class="sa-dica" style="margin-top:8px;color:var(--orange);font-weight:600">O Mercado Pago da plataforma não está configurado: confira o token em Saques PIX > Mercado Pago.</div>' : ''}
          </div>
          <label class="sa-chave" title="${c.ativo ? 'Desligar a oferta' : 'Ligar a oferta'}">
            <input type="checkbox" id="up-ativo" ${c.ativo ? 'checked' : ''} aria-label="Oferta de upgrade ligada">
            <span></span>
          </label>
        </div>
        <div class="up-cfg">
          <div class="sa-campo"><label for="up-preco">Preço do adicional (por mês)</label><input class="minput" id="up-preco" inputmode="decimal" value="${String(d.preco.toFixed(2)).replace('.', ',')}"></div>
          <div class="sa-campo"><label for="up-vezes">Mostrar para cada cliente</label><select class="minput" id="up-vezes">${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${n === c.vezes ? 'selected' : ''}>${n} ${plural(n, 'vez', 'vezes')}</option>`).join('')}</select></div>
          <div class="sa-campo"><button class="btn bp" data-up="salvar" style="height:42px">Salvar</button></div>
        </div>
        <div class="sa-dica" style="margin-top:10px">Exemplo: uma mensalidade de ${brl(exBase)} passa para ${brl(exBase + d.preco)}. Este é o mesmo preço somado nas faturas de quem já tem o pedido por IA, então mudar aqui muda também a próxima fatura deles.</div>
      </div>

      <div class="stats-grid" style="margin:16px 0">
        <div class="stat-card" style="--ca:var(--accent)"><div class="stat-card-label">Podem fazer o upgrade</div><div class="stat-card-val">${r.podem}</div><div class="stat-card-sub">clientes ativos sem a IA</div></div>
        <div class="stat-card" style="--ca:#a855f7"><div class="stat-card-label">Já viram a oferta</div><div class="stat-card-val">${r.viram}</div><div class="stat-card-sub">${r.clicaram} ${plural(r.clicaram, 'clicou', 'clicaram')} em ativar</div></div>
        <div class="stat-card" style="--ca:var(--success)"><div class="stat-card-label">Fizeram o upgrade</div><div class="stat-card-val">${r.fizeram}</div><div class="stat-card-sub">${brl(r.recebido)} recebidos na hora</div></div>
        <div class="stat-card" style="--ca:var(--orange)"><div class="stat-card-label">Receita extra por mês</div><div class="stat-card-val" style="font-size:24px">${brl(r.receita_mes)}</div><div class="stat-card-sub">${r.com_adicional} ${plural(r.com_adicional, 'loja', 'lojas')} com o adicional</div></div>
      </div>

      <div class="card">
        <div class="sa-vis-topo">
          <div><div class="sa-liga-titulo">Clientes</div>
            <div class="sa-liga-texto">Quanto cada um paga hoje, quanto passa a pagar e o valor proporcional para ativar.</div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <div class="sa-filtros" role="group" aria-label="Filtrar clientes">
              ${[['todos', 'Todos'], ['pendentes', 'Sem upgrade'], ['feitos', 'Com upgrade']].map(([k, l]) => `<button class="${U.filtro === k ? 'on' : ''}" data-up-filtro="${k}">${l}</button>`).join('')}
            </div>
            <button class="btn bg" data-up="todos" title="Zera a contagem de quem ainda não fez o upgrade">Mostrar de novo para todos</button>
          </div>
        </div>
        ${lista.length ? `<div style="overflow-x:auto;margin-top:14px"><table>
          <thead><tr><th>Loja</th><th>Mensalidade</th><th>Vencimento</th><th>Para ativar hoje</th><th>Oferta</th><th></th></tr></thead>
          <tbody>${lista.map(l => `<tr>
            <td><div class="sa-loja">${esc(l.nome)}</div></td>
            <td>${l.comprou_em ? `<b>${brl(l.nova)}</b><div class="sa-sub">com IA</div>` : `${brl(l.base)} <span style="color:var(--muted)">para</span> <b>${brl(l.nova)}</b>`}</td>
            <td>${l.vencimento ? dataBR(l.vencimento) : '—'}</td>
            <td>${l.comprou_em ? '—' : brl(l.valor_hoje)}</td>
            <td>${situacaoUpgrade(l, c.vezes)}</td>
            <td style="text-align:right">${!l.comprou_em && l.vistas ? `<button class="btn bg" style="font-size:12px;padding:6px 10px" data-up="de-novo" data-id="${esc(l.id)}">Mostrar de novo</button>` : ''}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : `<div class="sa-dica" style="margin-top:14px">${U.filtro === 'feitos' ? 'Nenhum upgrade ainda.' : 'Nenhum cliente nesta lista.'}</div>`}
      </div>

      ${d.pagos.length ? `<div class="card" style="margin-top:16px">
        <div class="sa-liga-titulo" style="font-size:16px">Pagamentos de upgrade</div>
        <div style="overflow-x:auto;margin-top:12px"><table>
          <thead><tr><th>Loja</th><th>Pago na hora</th><th>Nova mensalidade</th><th>Situação</th><th>Data</th></tr></thead>
          <tbody>${d.pagos.map(p => `<tr><td><div class="sa-loja">${esc(p.nome || p.tenant_id)}</div></td><td>${brl(p.valor)}<div class="sa-sub">Pix</div></td><td>${brl(p.nova_mensalidade)}</td>
            <td>${p.status === 'aprovado' ? '<span class="badge bg-green">Ativado</span>' : '<span class="badge bg-red">Pago, não ativou</span>'}</td><td>${horaLocal(p.aprovado_em)}</td></tr>`).join('')}</tbody>
        </table></div></div>` : ''}`;
  }

  async function salvarUpgrade(parcial, msg) {
    try { U.dados = await api('POST', '/api/admin/upgrade-ia/config', parcial); toast('ok', msg); }
    catch (e) { toast('err', e.message); }
    renderUpgrade();
  }

  function ligarUpgrade() {
    const sec = $('sec-upgrade');
    if (!sec || sec.dataset.ligado) return;
    sec.dataset.ligado = '1';
    sec.addEventListener('change', ev => {
      if (ev.target.id === 'up-ativo') {
        const ligar = ev.target.checked;
        salvarUpgrade({ ativo: ligar }, ligar ? 'Oferta ligada: os clientes vão ver ao abrir o painel' : 'Oferta desligada');
      }
    });
    sec.addEventListener('click', async ev => {
      const f = ev.target.closest('[data-up-filtro]');
      if (f) { U.filtro = f.dataset.upFiltro; renderUpgrade(); return; }
      const b = ev.target.closest('[data-up]');
      if (!b) return;
      if (b.dataset.up === 'salvar') {
        salvarUpgrade({ preco: $('up-preco').value, vezes: parseInt($('up-vezes').value, 10) }, 'Configuração do upgrade salva');
      }
      if (b.dataset.up === 'todos') {
        if (!confirm('Mostrar a oferta de novo para todos que ainda não fizeram o upgrade? A contagem de vezes volta a zero.')) return;
        try { U.dados = await api('POST', '/api/admin/upgrade-ia/mostrar-de-novo', { todos: true }); toast('ok', 'A oferta volta a aparecer para todos'); } catch (e) { toast('err', e.message); }
        renderUpgrade();
      }
      if (b.dataset.up === 'de-novo') {
        try { U.dados = await api('POST', '/api/admin/upgrade-ia/mostrar-de-novo', { tenant_id: b.dataset.id }); toast('ok', 'A oferta volta a aparecer para este cliente'); } catch (e) { toast('err', e.message); }
        renderUpgrade();
      }
    });
  }

  function initUpgrade() {
    css(); ligarUpgrade();
    if (!$('up-css')) {
      const st = document.createElement('style');
      st.id = 'up-css';
      st.textContent = '.up-cfg{display:grid;grid-template-columns:220px 200px max-content;justify-content:start;gap:12px;align-items:end;margin-top:18px;padding-top:18px;border-top:1px solid var(--border)}@media(max-width:700px){.up-cfg{grid-template-columns:1fr 1fr}.up-cfg .sa-campo:last-child{grid-column:1/-1}}';
      document.head.appendChild(st);
    }
    renderUpgrade();
    carregarUpgrade();
  }

  window.SITEUI = { initTestes, initSite, initUpgrade, badge: () => carregarTestes(true), emTeste: EM_TESTE };

  // contagem de testes ativos no menu assim que o painel abre
  const esperar = setInterval(() => {
    if (typeof getAdminToken !== 'function') return;
    const painel = document.getElementById('painel');
    if (getAdminToken() && painel && painel.style.display !== 'none') { clearInterval(esperar); carregarTestes(true); }
  }, 1500);
})();

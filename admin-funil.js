// ═══════════════════════════════════════════════════════
// ADMIN-FUNIL.JS — tela "Funil do teste" do painel admin
// Auditoria completa do teste grátis: até onde cada pessoa chegou, quanto tempo
// levou e quanto cada etapa pesa na hora de virar cliente pagante.
// Usa GET /api/admin/testes/auditoria (site-admin.js).
// Depende de helpers do admin.html: adminAuthHeader, toast, doLogout.
// ═══════════════════════════════════════════════════════
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, um, varios) => n === 1 ? um : varios;
  const num = n => Number(n || 0).toLocaleString('pt-BR');
  const pctTxt = n => `${String(Math.round((n || 0) * 10) / 10).replace('.', ',')}%`;

  // datas do servidor vêm em UTC ("AAAA-MM-DD HH:MM:SS"); a tela mostra no horário local
  const quando = s => s ? new Date(String(s).replace(' ', 'T') + 'Z') : null;
  const dataHora = s => {
    const d = quando(s);
    return d ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  };
  const dataCurta = s => {
    const d = quando(s);
    return d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
  };
  const haQuanto = s => {
    const d = quando(s);
    if (!d) return 'nunca';
    const min = Math.round((Date.now() - d) / 60000);
    if (min < 60) return min <= 1 ? 'agora há pouco' : `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h} h`;
    const dd = Math.round(h / 24);
    return `há ${dd} ${plural(dd, 'dia', 'dias')}`;
  };
  const tempo = h => {
    if (h == null) return '';
    if (h < 1) return 'em menos de 1 h';
    if (h < 48) return `em ${Math.round(h)} h`;
    const d = Math.round(h / 24);
    return `em ${d} ${plural(d, 'dia', 'dias')}`;
  };

  const F = { dados: null, dias: 30, filtro: 'ativos', busca: '', carregando: false };

  const ETAPAS = [
    ['painel', 'Entrou no painel'],
    ['produtos', 'Cadastrou produtos'],
    ['loja', 'Personalizou a loja (logo ou banner)'],
    ['whats', 'Conectou o WhatsApp'],
    ['pedido', 'Recebeu um pedido'],
    ['pedido_real', 'Recebeu pedido de outro telefone'],
    ['ia', 'Recebeu pedido feito pela IA'],
    ['pagou', 'Pagou']
  ];
  const NOME_MSG = { boasvindas: 'Boas-vindas', dia1: '1º dia', dia2: '2º dia', dia3: '3º dia', dia5: '5º dia', vespera: 'Véspera do fim', expirou: 'Teste acabou' };
  const SITUACAO = {
    ativo: t => `<span class="badge bg-blue fu-azul">No teste</span><div class="fu-sub">${t.dias_restantes === 0 ? 'acaba hoje' : `${t.dias_restantes} ${plural(t.dias_restantes, 'dia', 'dias')}`}</div>`,
    expirado: () => '<span class="badge bg-orange">Teste acabou</span>',
    cliente: () => '<span class="badge bg-green">Cliente</span>',
    excluido: () => '<span class="badge bg-gray">Apagado</span>'
  };
  const FILTROS = [
    ['ativos', 'No teste', t => t.situacao === 'ativo'],
    ['quentes', 'Prontos para fechar', t => t.proximo.nivel === 'quente' && t.situacao !== 'cliente'],
    ['parados', 'Sem produtos', t => t.situacao === 'ativo' && !t.etapas.produtos],
    ['expirados', 'Acabaram sem pagar', t => t.situacao === 'expirado'],
    ['clientes', 'Viraram clientes', t => t.situacao === 'cliente'],
    ['todos', 'Todos', () => true]
  ];

  async function api(caminho) {
    const r = await fetch(caminho, { headers: adminAuthHeader() });
    if (r.status === 401) { toast('err', 'Sessão expirada'); setTimeout(doLogout, 1500); throw new Error('Sessão expirada'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Não foi possível carregar');
    return d;
  }

  async function carregar() {
    F.carregando = true;
    render();
    try { F.dados = await api('/api/admin/testes/auditoria?dias=' + F.dias); }
    catch (e) { toast('err', e.message); }
    F.carregando = false;
    render();
  }

  function css() {
    if ($('fu-css')) return;
    const st = document.createElement('style');
    st.id = 'fu-css';
    st.textContent = `
.fu-topo{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
.fu-titulo{font-size:18px;font-weight:800;letter-spacing:-.3px}
.fu-texto{font-size:13px;color:var(--text-2);margin-top:4px;line-height:1.5;max-width:640px}
.fu-sub{font-size:11.5px;color:var(--muted);margin-top:3px}
.fu-seg{display:inline-flex;background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:3px;gap:2px;flex-wrap:wrap}
.fu-seg button{border:0;background:none;color:var(--text-2);font:inherit;font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:7px;cursor:pointer}
.fu-seg button.on{background:var(--accent);color:#fff}
.fu-seg button:focus-visible,.fu-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.fu-grade{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:16px;margin-top:16px}
.fu-grade > .card{margin:0}
.fu-funil{display:grid;gap:10px;margin-top:14px}
.fu-linha{display:grid;grid-template-columns:minmax(150px,210px) minmax(0,1fr) 92px;gap:12px;align-items:center;font-size:13px}
.fu-linha .fu-nome{font-weight:600}
.fu-barra{height:26px;border-radius:7px;background:var(--s2);position:relative;overflow:hidden}
.fu-barra i{position:absolute;inset:0 auto 0 0;border-radius:7px;background:var(--accent);opacity:.9}
.fu-barra.pagou i{background:var(--success)}
.fu-barra b{position:relative;display:flex;align-items:center;height:100%;padding:0 10px;font-size:12px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums;text-shadow:0 1px 2px rgba(0,0,0,.35)}
.fu-barra.zero b{color:var(--muted);text-shadow:none}
.fu-tempo{font-size:11.5px;color:var(--muted);text-align:right}
#sec-funil table.fu-tab{width:100%;min-width:0;border-collapse:collapse;font-size:13px;margin-top:12px}
#sec-funil table.fu-lista{min-width:940px}
.fu-tab th{text-align:left;font-size:11px;font-weight:700;color:var(--muted);padding:8px 8px;border-bottom:1px solid var(--border);white-space:nowrap}
.fu-tab td{padding:9px 8px;border-bottom:1px solid var(--border);vertical-align:top}
.fu-tab td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.fu-tab th.n{text-align:right}
.fu-tab tr.dest td{background:var(--accent-dim)}
.fu-taxa{font-weight:800}
.fu-msgs{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.fu-msgs span{background:var(--s2);border:1px solid var(--border);border-radius:99px;padding:5px 12px;font-size:12px}
.fu-msgs b{font-variant-numeric:tabular-nums}
.fu-ferr{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px}
.fu-ferr .minput{max-width:260px;padding:8px 12px;font-size:13px}
.fu-lista td{font-size:12.5px}
.fu-loja{font-weight:700;font-size:13px}
.fu-pontos{display:flex;gap:5px;align-items:center}
.fu-pontos i{width:13px;height:13px;border-radius:50%;border:2px solid var(--border-hover);display:block}
.fu-pontos i.ok{background:var(--success);border-color:var(--success)}
.fu-pontos i.pg.ok{background:var(--accent);border-color:var(--accent)}
.fu-uso{display:grid;gap:2px;white-space:nowrap}
.fu-passo{display:flex;gap:8px;align-items:flex-start;min-width:220px}
.fu-passo .dot{flex:0 0 8px;height:8px;border-radius:50%;margin-top:5px;background:var(--muted)}
.fu-passo .quente{background:var(--success)} .fu-passo .morno{background:var(--orange)} .fu-passo .frio{background:var(--danger)} .fu-passo .ok{background:var(--accent)}
.fu-btn{display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:11.5px;font-weight:700;color:var(--success);text-decoration:none;border:1px solid rgba(34,197,94,.35);border-radius:8px;padding:4px 9px}
.fu-btn:hover{background:rgba(34,197,94,.08)}
.fu-azul{background:var(--accent-dim);color:var(--accent)}
.fu-vazio{font-size:13px;color:var(--muted);padding:18px 0}
.fu-legenda{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--muted);margin-top:10px}
@media (max-width:1000px){.fu-grade{grid-template-columns:1fr}}
@media (max-width:640px){.fu-linha{grid-template-columns:1fr 64px}.fu-linha .fu-barra{grid-column:1/-1;grid-row:2}.fu-tempo{grid-row:1;grid-column:2}}
`;
    document.head.appendChild(st);
  }

  function zap(t) {
    const f = String(t.telefone || '').replace(/\D/g, '');
    if (f.length < 10) return '';
    const n = f.length <= 11 ? '55' + f : f;
    const nome = String(t.nome || '').split(' ')[0];
    const msg = `Oi ${nome}, aqui é do EstimaFood. Vi que você está testando o sistema da ${t.restaurante || 'sua loja'}. Posso te ajudar a deixar tudo pronto?`;
    return `<a class="fu-btn" href="https://wa.me/${n}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a>`;
  }

  function pontos(t) {
    return `<div class="fu-pontos" role="img" aria-label="${ETAPAS.filter(([k]) => t.etapas[k]).length} de ${ETAPAS.length} etapas">${ETAPAS.map(([k, nome]) => {
      const v = t.etapas[k];
      return `<i class="${v ? 'ok' : ''} ${k === 'pagou' ? 'pg' : ''}" title="${esc(nome)}: ${v ? dataHora(v) : 'ainda não'}"></i>`;
    }).join('')}</div>`;
  }

  function render() {
    const sec = $('sec-funil');
    if (!sec) return;
    const d = F.dados;
    const periodo = `<div class="fu-seg" role="group" aria-label="Período">${[[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [0, 'Tudo']]
      .map(([v, l]) => `<button class="${F.dias === v ? 'on' : ''}" data-fu-dias="${v}">${l}</button>`).join('')}</div>`;
    const cabeca = `
      <div class="card">
        <div class="fu-topo">
          <div>
            <div class="fu-titulo">Funil do teste grátis</div>
            <div class="fu-texto">Até onde cada pessoa que fez o teste chegou, quanto tempo levou e quanto cada etapa pesa para virar cliente pagante. Os dados são conferidos a cada 15 minutos e quando esta tela abre.</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            ${periodo}
            <div class="fu-sub">${d ? `Conferido às ${dataHora(d.gerado_em).slice(-5)}` : ''}</div>
          </div>
        </div>
      </div>`;
    if (!d) { sec.innerHTML = cabeca + `<div class="card" style="margin-top:16px"><div class="fu-vazio">${F.carregando ? 'Carregando o funil...' : 'Não foi possível carregar o funil.'}</div></div>`; return; }

    const r = d.resumo;
    const conv = Object.fromEntries(d.conversao.map(c => [c.k, c]));
    const cProd = conv.produtos || { taxa: 0, terminaram: 0 }, cSem = conv.sem_produtos || { taxa: 0, terminaram: 0 };

    const stats = `
      <div class="stats-grid" style="margin:16px 0 0">
        <div class="stat-card" style="--ca:var(--accent)"><div class="stat-card-label">Cadastros no teste</div><div class="stat-card-val">${num(r.cadastros)}</div><div class="stat-card-sub">${r.ativos} no prazo, ${r.terminados} ${plural(r.terminados, 'encerrado', 'encerrados')}${r.compras_diretas ? `, mais ${r.compras_diretas} ${plural(r.compras_diretas, 'compra direta', 'compras diretas')}` : ''}</div></div>
        <div class="stat-card" style="--ca:var(--success)"><div class="stat-card-label">Viraram clientes</div><div class="stat-card-val">${pctTxt(r.taxa_final)}</div><div class="stat-card-sub">${r.pagaram} ${plural(r.pagaram, 'pagou', 'pagaram')}, contando só testes encerrados</div></div>
        <div class="stat-card" style="--ca:#a855f7"><div class="stat-card-label">Prontos para fechar</div><div class="stat-card-val">${num(r.quentes)}</div><div class="stat-card-sub">no teste e já recebendo pedidos reais</div></div>
        <div class="stat-card" style="--ca:var(--danger)"><div class="stat-card-label">Parados sem produtos</div><div class="stat-card-val">${num(r.parados)}</div><div class="stat-card-sub">no teste e sem nenhum produto</div></div>
      </div>`;

    const maxN = Math.max(1, d.funil[0].n);
    const funil = `
      <div class="card">
        <div class="fu-titulo" style="font-size:16px">Até onde chegaram</div>
        <div class="fu-texto">De cada 100 pessoas que fizeram o cadastro, quantas passaram por cada etapa. À direita, o tempo típico desde o cadastro.</div>
        <div class="fu-funil">${d.funil.map(e => `
          <div class="fu-linha">
            <div class="fu-nome">${esc(e.nome)}</div>
            <div class="fu-barra ${e.k === 'pagou' ? 'pagou' : ''} ${e.n ? '' : 'zero'}"><i style="width:${Math.max(e.n ? 3 : 0, e.n * 100 / maxN)}%"></i><b>${num(e.n)} &nbsp;${e.k === 'cadastro' ? '' : pctTxt(e.pct)}</b></div>
            <div class="fu-tempo">${tempo(e.horas)}</div>
          </div>`).join('')}
        </div>
      </div>`;

    const conversao = `
      <div class="card">
        <div class="fu-titulo" style="font-size:16px">Quem paga depois do teste</div>
        <div class="fu-texto">Conversão em cliente de quem chegou até cada etapa. Conta só testes que já acabaram, porque quem está no prazo ainda pode pagar.</div>
        ${cProd.terminaram && cSem.terminaram ? `<div class="fu-texto" style="margin-top:10px;color:var(--text)">Quem cadastra produtos paga <b>${pctTxt(cProd.taxa)}</b> das vezes. Quem não cadastra, <b>${pctTxt(cSem.taxa)}</b>.</div>` : ''}
        <div style="overflow-x:auto"><table class="fu-tab">
          <thead><tr><th>Chegou até</th><th class="n">Encerrados</th><th class="n">Pagaram</th><th class="n">Conversão</th></tr></thead>
          <tbody>${d.conversao.map(c => `<tr class="${c.k === 'produtos' ? 'dest' : ''}">
            <td>${esc(c.nome)}</td><td class="n">${num(c.terminaram)}</td><td class="n">${num(c.pagaram)}</td>
            <td class="n fu-taxa">${c.terminaram ? pctTxt(c.taxa) : '—'}</td></tr>`).join('')}</tbody>
        </table></div>
        ${!r.terminados ? '<div class="fu-sub" style="margin-top:8px">Ainda não há testes encerrados neste período. A conversão aparece quando os primeiros testes acabarem.</div>' : ''}
      </div>`;

    const origens = `
      <div class="card">
        <div class="fu-titulo" style="font-size:16px">De onde vieram</div>
        <div style="overflow-x:auto"><table class="fu-tab">
          <thead><tr><th>Origem</th><th class="n">Cadastros</th><th class="n">Com produtos</th><th class="n">Pedido real</th><th class="n">Pagaram</th></tr></thead>
          <tbody>${d.origens.length ? d.origens.map(o => `<tr><td>${esc(o.origem)}</td><td class="n">${num(o.cadastros)}</td>
            <td class="n">${num(o.produtos)} <span class="fu-sub">${pctTxt(o.cadastros ? o.produtos * 100 / o.cadastros : 0)}</span></td>
            <td class="n">${num(o.pedido_real)}</td><td class="n">${num(o.pagaram)}</td></tr>`).join('') : '<tr><td colspan="5" class="fu-vazio">Sem cadastros no período.</td></tr>'}</tbody>
        </table></div>
        <div class="fu-sub" style="margin-top:8px">"Facebook e Instagram" inclui quem veio pelos anúncios e pelos links do perfil. "Direto" é quem digitou o site ou veio sem identificação.</div>
      </div>`;

    const msgsK = Object.keys(NOME_MSG).filter(k => d.mensagens[k]);
    const mensagens = `
      <div class="card">
        <div class="fu-titulo" style="font-size:16px">Mensagens do acompanhamento enviadas</div>
        ${msgsK.length ? `<div class="fu-msgs">${msgsK.map(k => `<span>${NOME_MSG[k]}: <b>${num(d.mensagens[k])}</b></span>`).join('')}</div>`
          : '<div class="fu-vazio">Nenhuma mensagem enviada neste período.</div>'}
      </div>`;

    const filtro = FILTROS.find(f => f[0] === F.filtro) || FILTROS[0];
    const busca = F.busca.trim().toLowerCase();
    const lista = d.testes.filter(filtro[2]).filter(t => !busca || [t.nome, t.restaurante, t.telefone, t.email].join(' ').toLowerCase().includes(busca));
    const contagem = Object.fromEntries(FILTROS.map(([k, , fn]) => [k, d.testes.filter(fn).length]));
    const tabela = `
      <div class="card" style="margin-top:16px">
        <div class="fu-titulo" style="font-size:16px">Cada teste, etapa por etapa</div>
        <div class="fu-texto">Os pontos seguem a ordem do funil: entrou no painel, cadastrou produtos, personalizou a loja, conectou o WhatsApp, recebeu um pedido, recebeu pedido de outro telefone, recebeu pedido pela IA e pagou. Passe o mouse em cada ponto para ver a data.</div>
        <div class="fu-ferr">
          <div class="fu-seg" role="group" aria-label="Filtrar testes">${FILTROS.map(([k, l]) => `<button class="${F.filtro === k ? 'on' : ''}" data-fu-filtro="${k}">${l} (${contagem[k]})</button>`).join('')}</div>
          <input class="minput" id="fu-busca" type="search" placeholder="Buscar loja, nome ou telefone" value="${esc(F.busca)}" aria-label="Buscar teste">
        </div>
        ${lista.length ? `<div style="overflow-x:auto"><table class="fu-tab fu-lista">
          <thead><tr><th>Loja</th><th>Cadastro</th><th>Etapas</th><th>Uso</th><th>Situação</th><th>Próximo passo</th></tr></thead>
          <tbody>${lista.map(t => `<tr>
            <td><div class="fu-loja">${esc(t.restaurante || t.nome)}</div><div class="fu-sub">${esc(t.nome)}${t.telefone ? ' · ' + esc(t.telefone) : ''}</div></td>
            <td style="white-space:nowrap">${dataCurta(t.created_at)}<div class="fu-sub">${esc(t.origem)}</div></td>
            <td>${pontos(t)}</td>
            <td><div class="fu-uso">
              <span>${num(t.produtos)} ${plural(t.produtos, 'produto', 'produtos')}${t.produtos ? ` <span class="fu-sub">(${num(t.fotos)} com foto)</span>` : ''}</span>
              <span>${num(t.pedidos)} ${plural(t.pedidos, 'pedido', 'pedidos')}${t.pedidos ? ` <span class="fu-sub">(${num(t.pedidos_reais)} de outros, ${num(t.pedidos_ia)} pela IA)</span>` : ''}</span>
              <span class="fu-sub">Último uso: ${haQuanto(t.ultimo_uso)}</span>
            </div></td>
            <td>${(SITUACAO[t.situacao] || SITUACAO.excluido)(t)}</td>
            <td><div class="fu-passo"><span class="dot ${t.proximo.nivel}"></span><div>${esc(t.proximo.texto)}${t.situacao === 'ativo' || t.situacao === 'expirado' ? `<div>${zap(t)}</div>` : ''}</div></div></td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div class="fu-legenda"><span>Próximo passo:</span><span style="color:var(--success)">verde, pronto para fechar</span><span style="color:var(--orange)">laranja, precisa de um empurrão</span><span style="color:var(--danger)">vermelho, parado</span></div>`
        : `<div class="fu-vazio">${d.testes.length ? 'Nenhum teste neste filtro.' : 'Nenhum teste neste período.'}</div>`}
      </div>`;

    sec.innerHTML = cabeca + stats + `<div class="fu-grade">${funil}${conversao}</div><div class="fu-grade">${origens}${mensagens}</div>` + tabela;
  }

  function ligar() {
    const sec = $('sec-funil');
    if (!sec || sec.dataset.ligado) return;
    sec.dataset.ligado = '1';
    sec.addEventListener('click', ev => {
      const p = ev.target.closest('[data-fu-dias]');
      if (p) { F.dias = parseInt(p.dataset.fuDias, 10) || 0; carregar(); return; }
      const f = ev.target.closest('[data-fu-filtro]');
      if (f) { F.filtro = f.dataset.fuFiltro; render(); }
    });
    sec.addEventListener('input', ev => {
      if (ev.target.id !== 'fu-busca') return;
      F.busca = ev.target.value;
      const pos = ev.target.selectionStart;
      render();
      const campo = $('fu-busca');
      if (campo) { campo.focus(); try { campo.setSelectionRange(pos, pos); } catch {} }
    });
  }

  function init() {
    css(); ligar(); render(); carregar();
  }

  window.FUNILUI = { init };
})();

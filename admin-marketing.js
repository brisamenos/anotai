// ═══════════════════════════════════════════════════════
// ADMIN-MARKETING.JS — aba "Marketing" do painel admin
// Construtor de fluxos de WhatsApp (palavra-chave, botoes, listas, midia, audio gravado)
// e disparos em massa. Usa a API /api/admin/marketing (marketing-flows.js).
// Depende de helpers do admin.html: adminAuthHeader, toast, doLogout, abrirModal/fecharModal.
// ═══════════════════════════════════════════════════════
(function () {
  'use strict';

  const MK = {
    tab: 'fluxos',
    fluxos: [],
    disparos: [],
    logs: [],
    status: null,
    draft: null,
    blobs: {},
    timer: null,
    ctxDisparo: null
  };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);

  // ── API ────────────────────────────────────────────
  async function req(method, path, body) {
    const r = await fetch('/api/admin/marketing' + path, {
      method, headers: adminAuthHeader(),
      body: method === 'GET' ? undefined : JSON.stringify(body || {})
    });
    if (r.status === 401) { toast('err', 'Sessão expirada'); setTimeout(doLogout, 1500); throw new Error('Sessão expirada'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    return d;
  }

  // ── Estilos ────────────────────────────────────────
  function injetarCss() {
    if ($('mk-css')) return;
    const st = document.createElement('style');
    st.id = 'mk-css';
    st.textContent = `
.mk-tabs{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap}
.mk-tab{padding:8px 14px;border-radius:9px;border:1px solid var(--border);background:var(--s2);color:var(--text-2);cursor:pointer;font-size:12.5px;font-weight:700}
.mk-tab.on{background:var(--accent-dim);border-color:var(--accent);color:var(--text)}
.mk-alert{padding:11px 14px;border-radius:10px;font-size:12.5px;line-height:1.5;margin-bottom:14px;border:1px solid rgba(249,115,22,.3);background:rgba(249,115,22,.08);color:var(--text)}
.mk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
.mk-flow{background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:10px}
.mk-flow.off{opacity:.78}
.mk-flow-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.mk-flow-name{font-family:'Space Grotesk',sans-serif;font-weight:800;font-size:15px;word-break:break-word}
.mk-meta{font-size:12px;color:var(--text-2);line-height:1.55}
.mk-meta b{color:var(--text)}
.mk-chips{display:flex;flex-wrap:wrap;gap:5px}
.mk-chip{font-size:11px;padding:3px 9px;border-radius:99px;background:var(--accent-dim);color:var(--text);border:1px solid var(--border)}
.mk-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.mk-empty{padding:40px 16px;text-align:center;color:var(--muted);font-size:13px;border:1px dashed var(--border);border-radius:14px}
.mk-ov{display:none;position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:210;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px;backdrop-filter:blur(6px)}
.mk-ov.on{display:flex}
.mk-box{background:var(--s1);border:1px solid var(--border);border-radius:16px;width:min(1120px,100%);box-shadow:0 30px 80px rgba(0,0,0,.5)}
.mk-box.sm{width:min(520px,100%)}
.mk-box-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border);gap:10px}
.mk-box-title{font-family:'Space Grotesk',sans-serif;font-size:17px;font-weight:800}
.mk-box-body{padding:18px 20px}
.mk-box-foot{display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--border);flex-wrap:wrap}
.mk-edit{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:20px}
@media(max-width:900px){.mk-edit{grid-template-columns:1fr}.mk-prev-wrap{order:-1}}
.mk-sec{font-size:10px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:var(--muted);padding-bottom:8px;border-bottom:1px solid var(--border);margin:18px 0 12px}
.mk-sec:first-child{margin-top:0}
.mk-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media(max-width:600px){.mk-row{grid-template-columns:1fr}}
.mk-ta{min-height:76px;resize:vertical;font-family:inherit}
.mk-check{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:var(--text-2);margin:7px 0;line-height:1.4;cursor:pointer}
.mk-check input{margin-top:2px}
.mk-step{background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:10px}
.mk-step-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.mk-step-tag{font-size:11px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--accent)}
.mk-step-tools{display:flex;gap:4px}
.mk-mini{width:26px;height:26px;border-radius:7px;border:1px solid var(--border);background:var(--s1);color:var(--text-2);cursor:pointer;font-size:13px;line-height:1;display:inline-flex;align-items:center;justify-content:center}
.mk-mini:hover{border-color:var(--border-hover);color:var(--text)}
.mk-mini.del:hover{color:var(--danger);border-color:rgba(239,68,68,.4)}
.mk-add{display:flex;flex-wrap:wrap;gap:6px}
.mk-sub{border:1px solid var(--border);border-radius:10px;padding:9px;margin-bottom:8px;background:var(--s1)}
.mk-vars{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0 2px}
.mk-var{font-size:11px;padding:2px 8px;border-radius:6px;border:1px solid var(--border);background:var(--s1);color:var(--text-2);cursor:pointer;font-family:monospace}
.mk-var:hover{color:var(--text);border-color:var(--accent)}
.mk-file{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.mk-file-name{font-size:12px;color:var(--text-2);word-break:break-all}
.mk-media{max-width:100%;max-height:150px;border-radius:8px;margin-top:6px;display:block}
.mk-prev-wrap{position:sticky;top:12px;align-self:start}
.mk-phone{background:#0b141a;border-radius:18px;border:1px solid var(--border);overflow:hidden}
.mk-phone-top{background:#202c33;color:#e9edef;padding:10px 14px;font-size:13px;font-weight:700}
.mk-chat{padding:12px 10px;min-height:260px;max-height:520px;overflow:auto;display:flex;flex-direction:column;gap:6px;background:#0b141a}
.mk-b{background:#202c33;color:#e9edef;border-radius:9px;padding:7px 10px;font-size:12.5px;line-height:1.45;max-width:92%;word-break:break-word;white-space:pre-wrap}
.mk-b small{display:block;color:#8696a0;font-size:11px;margin-top:3px}
.mk-b img,.mk-b video{max-width:100%;border-radius:6px;display:block;margin-bottom:4px}
.mk-b audio{width:210px;max-width:100%}
.mk-bbtn{display:block;text-align:center;color:#53bdeb;border-top:1px solid #2a3942;padding:7px 4px 2px;font-size:12.5px;margin-top:6px}
.mk-wait{align-self:center;font-size:11px;color:#8696a0;background:#182229;border-radius:99px;padding:2px 10px}
.mk-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
.mk-tbl th{text-align:left;font-size:10.5px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--border)}
.mk-tbl td{padding:10px;border-bottom:1px solid var(--border);vertical-align:middle}
.mk-tw{overflow:auto;background:var(--s1);border:1px solid var(--border);border-radius:14px}
.mk-bar{height:7px;border-radius:99px;background:var(--s3);overflow:hidden;min-width:110px}
.mk-bar>i{display:block;height:100%;background:var(--accent)}
.mk-st{font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px;border:1px solid var(--border);background:var(--s2)}
.mk-st.ok{color:var(--success)}.mk-st.err{color:var(--danger)}.mk-st.run{color:var(--orange)}
`;
    document.head.appendChild(st);
  }

  // ── Estrutura da secao ─────────────────────────────
  function shell() {
    const sec = $('sec-marketing');
    if (!sec || sec.dataset.pronto) return;
    sec.dataset.pronto = '1';
    sec.innerHTML = `
      <div class="sec-head">
        <div>
          <div class="sec-head-title">Marketing</div>
          <div class="sec-head-sub">Monte fluxos de mensagens para o WhatsApp: respostas automáticas por palavra-chave e disparos para listas de contatos</div>
        </div>
        <button class="btn bp" onclick="MKUI.novo()">Novo fluxo</button>
      </div>
      <div id="mk-status"></div>
      <div class="mk-tabs">
        <button class="mk-tab on" data-tab="fluxos" onclick="MKUI.aba('fluxos')">Fluxos</button>
        <button class="mk-tab" data-tab="disparos" onclick="MKUI.aba('disparos')">Disparos</button>
        <button class="mk-tab" data-tab="logs" onclick="MKUI.aba('logs')">Registro</button>
      </div>
      <div id="mk-body"></div>

      <div class="mk-ov" id="mk-ov-small"><div class="mk-box sm" id="mk-small-box"></div></div>`;
  }

  // ── Entrada da aba ─────────────────────────────────
  async function init() {
    injetarCss();
    shell();
    await Promise.all([carregarStatus(), carregarFluxos()]);
    aba(MK.tab);
    clearInterval(MK.timer);
    MK.timer = setInterval(() => {
      const sec = $('sec-marketing');
      if (!sec || sec.style.display === 'none') { clearInterval(MK.timer); return; }
      if (MK.tab === 'disparos') carregarDisparos(true);
    }, 5000);
  }

  async function carregarStatus() {
    try { MK.status = await req('GET', '/status'); } catch (e) { MK.status = { erro: e.message }; }
    const el = $('mk-status');
    if (!el) return;
    const s = MK.status || {};
    let msg = '';
    if (s.erro) msg = 'Não consegui verificar o canal: ' + esc(s.erro);
    else if (s.canal !== 'wuzapi') msg = 'O canal ativo é a Evolution API. Os fluxos só funcionam pela <b>WuzAPI</b>: vá em Saques PIX, card "WhatsApp de Suporte e Vendas", e escolha WuzAPI.';
    else if (!s.conectado) msg = 'O WhatsApp de Suporte e Vendas está <b>desconectado</b> (' + esc(s.status) + '). Conecte em Saques PIX para os fluxos funcionarem.';
    else if (!s.ffmpeg) msg = 'O servidor não tem o <b>ffmpeg</b> instalado. Áudios em formato diferente de .ogg (opus) não serão convertidos e podem não aparecer como mensagem gravada na hora.';
    el.innerHTML = msg ? `<div class="mk-alert">${msg}</div>` : '';
  }

  async function carregarFluxos() {
    try { MK.fluxos = (await req('GET', '/fluxos')).fluxos || []; } catch (e) { toast('err', e.message); }
  }
  async function carregarDisparos(silencioso) {
    try { MK.disparos = (await req('GET', '/disparos')).disparos || []; } catch (e) { if (!silencioso) toast('err', e.message); }
    if (MK.tab === 'disparos') renderDisparos();
  }
  async function carregarLogs() {
    try { MK.logs = (await req('GET', '/logs')).logs || []; } catch (e) { toast('err', e.message); }
    if (MK.tab === 'logs') renderLogs();
  }

  function aba(nome) {
    MK.tab = nome;
    document.querySelectorAll('#sec-marketing .mk-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === nome));
    if (nome === 'fluxos') renderFluxos();
    if (nome === 'disparos') { renderDisparos(); carregarDisparos(true); }
    if (nome === 'logs') { renderLogs(); carregarLogs(); }
  }

  // ── Lista de fluxos ────────────────────────────────
  function resumoGatilho(f) {
    const g = f.gatilho || {};
    if (g.tipo === 'manual') return 'Somente disparo manual';
    const modo = { contem: 'contém', exata: 'igual a', inicia: 'começa com' }[g.modo] || 'contém';
    return `Quando a mensagem ${modo}: ` + (g.palavras || []).map(p => `<b>${esc(p)}</b>`).join(', ');
  }

  const TIPO_NOME = { texto: 'Texto', imagem: 'Imagem', video: 'Vídeo', audio: 'Áudio', documento: 'Documento', botoes: 'Botões', lista: 'Lista', carrossel: 'Carrossel', espera: 'Espera', aguardar: 'Aguardar', condicao: 'Condição', definir_var: 'Variável', notificar: 'Notificar', pausar_robo: 'Pausar robô', chamar_fluxo: 'Outro fluxo' };

  function renderFluxos() {
    const el = $('mk-body');
    if (!el) return;
    if (!MK.fluxos.length) {
      el.innerHTML = '<div class="mk-empty">Nenhum fluxo criado ainda.<br>Clique em <b>Novo fluxo</b> para montar o primeiro.</div>';
      return;
    }
    el.innerHTML = '<div class="mk-grid">' + MK.fluxos.map(f => {
      const nos = ((f.grafo && f.grafo.nodes) || []).filter(n => n.tipo !== 'gatilho');
      const tipos = [...new Set(nos.map(n => TIPO_NOME[n.tipo]))];
      return `
      <div class="mk-flow ${f.ativo ? '' : 'off'}">
        <div class="mk-flow-top">
          <div class="mk-flow-name">${esc(f.nome)}</div>
          <label class="toggle" title="${f.ativo ? 'Ativo' : 'Desativado'}">
            <input type="checkbox" ${f.ativo ? 'checked' : ''} onchange="MKUI.ativar(${f.id}, this)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="mk-meta">${resumoGatilho(f)}</div>
        <div class="mk-chips">${nos.length ? `<span class="mk-chip">${nos.length} nó(s)</span>` : '<span class="mk-chip">Vazio</span>'}${tipos.map(t => `<span class="mk-chip">${t}</span>`).join('')}</div>
        <div class="mk-meta">Executado <b>${f.execucoes}</b> vez(es)${f.ultima_execucao ? ' · última em ' + esc(f.ultima_execucao) + ' (UTC)' : ''}</div>
        <div class="mk-actions">
          <button class="btn bp bsm" onclick="MKUI.editar(${f.id})">Editar</button>
          <button class="btn bg2 bsm" onclick="MKUI.testar(${f.id})">Testar</button>
          <button class="btn bg2 bsm" onclick="MKUI.disparar(${f.id})">Disparar</button>
          <button class="btn bg2 bsm" onclick="MKUI.duplicar(${f.id})">Duplicar</button>
          <button class="btn bd bsm" onclick="MKUI.excluir(${f.id})">Excluir</button>
        </div>
      </div>`;
    }).join('') + '</div>';
  }

  async function ativar(id, input) {
    const querAtivo = input.checked;
    try {
      await req('POST', `/fluxos/${id}/${querAtivo ? 'ativar' : 'desativar'}`);
      toast('ok', querAtivo ? 'Fluxo ativado' : 'Fluxo desativado');
    } catch (e) {
      input.checked = !querAtivo;
      toast('err', e.message);
    }
    await carregarFluxos();
    renderFluxos();
  }

  async function duplicar(id) {
    try { await req('POST', `/fluxos/${id}/duplicar`); toast('ok', 'Fluxo duplicado (fica desativado)'); await carregarFluxos(); renderFluxos(); }
    catch (e) { toast('err', e.message); }
  }

  async function excluir(id) {
    const f = MK.fluxos.find(x => x.id === id);
    if (!confirm(`Excluir o fluxo "${f ? f.nome : id}"? Esta ação não pode ser desfeita.`)) return;
    try { await req('POST', `/fluxos/${id}/excluir`); toast('ok', 'Fluxo excluído'); await carregarFluxos(); renderFluxos(); }
    catch (e) { toast('err', e.message); }
  }

  // ── Dialogo pequeno ────────────────────────────────
  function abrirSmall(html) {
    $('mk-small-box').innerHTML = html;
    $('mk-ov-small').classList.add('on');
  }
  function fecharSmall() { $('mk-ov-small').classList.remove('on'); }

  function testar(id) {
    const f = MK.fluxos.find(x => x.id === id);
    let ultimo = '';
    try { ultimo = localStorage.getItem('mkTelTeste') || ''; } catch (_) {}
    abrirSmall(`
      <div class="mk-box-head"><div class="mk-box-title">Testar "${esc(f ? f.nome : '')}"</div><button class="mk-mini" onclick="MKUI.fecharSmall()">×</button></div>
      <div class="mk-box-body">
        <div class="form-group"><label class="form-label">Seu WhatsApp (com DDD)</label>
          <input class="minput" id="mk-t-tel" inputmode="numeric" placeholder="85991234567" value="${esc(ultimo)}"></div>
        <div class="form-group"><label class="form-label">Nome para as variáveis <span style="font-weight:400;text-transform:none">(opcional)</span></label>
          <input class="minput" id="mk-t-nome" placeholder="Ex: Maria Souza"></div>
        <div class="form-hint">O fluxo roda inteiro, do jeito que o cliente vai receber. Aceita teste mesmo com o fluxo desativado.</div>
      </div>
      <div class="mk-box-foot"><button class="btn bg2" onclick="MKUI.fecharSmall()">Cancelar</button><button class="btn bp" onclick="MKUI.enviarTeste(${id})">Enviar teste</button></div>`);
  }
  async function enviarTeste(id) {
    const tel = $('mk-t-tel').value.trim();
    try { localStorage.setItem('mkTelTeste', tel); } catch (_) {}
    try {
      const r = await req('POST', `/fluxos/${id}/testar`, { telefone: tel, nome: $('mk-t-nome').value.trim() });
      toast('ok', r.mensagem || 'Teste iniciado');
      fecharSmall();
    } catch (e) { toast('err', e.message); }
  }

  // ── Disparo em massa ───────────────────────────────
  function disparar(id) {
    const f = MK.fluxos.find(x => x.id === id);
    MK.ctxDisparo = id;
    abrirSmall(`
      <div class="mk-box-head"><div class="mk-box-title">Disparar "${esc(f ? f.nome : '')}"</div><button class="mk-mini" onclick="MKUI.fecharSmall()">×</button></div>
      <div class="mk-box-body">
        <div class="form-group"><label class="form-label">Quem vai receber</label>
          <select class="minput" id="mk-d-pub" onchange="MKUI.dispPub()">
            <option value="lista">Lista de números que eu vou colar</option>
            <option value="clientes_ativos">Todos os clientes ativos do sistema</option>
            <option value="clientes_inativos">Clientes inativos / suspensos</option>
          </select></div>
        <div class="form-group" id="mk-d-lista-wrap"><label class="form-label">Números (um por linha)</label>
          <textarea class="minput mk-ta" id="mk-d-lista" placeholder="85991234567;Maria Souza&#10;85988887777" oninput="MKUI.dispPrevia()"></textarea>
          <div class="form-hint">Formato: número, ou número;nome. O nome preenche a variável {{nome}}.</div></div>
        <div class="mk-row">
          <div class="form-group"><label class="form-label">Intervalo mínimo (s)</label><input class="minput" id="mk-d-min" type="number" min="5" value="15"></div>
          <div class="form-group"><label class="form-label">Intervalo máximo (s)</label><input class="minput" id="mk-d-max" type="number" min="5" value="40"></div>
        </div>
        <label class="mk-check"><input type="checkbox" id="mk-d-desc" checked> <span>Terminar cada envio com o aviso "responda SAIR para não receber mais". Quem responder SAIR sai das próximas listas automaticamente.</span></label>
        <div class="mk-alert" style="margin:10px 0 0">Mande só para quem já conhece você e mantenha intervalos longos. Disparo agressivo para quem não pediu contato aumenta muito o risco de o WhatsApp banir o número. O envio pausa sozinho após 5 falhas seguidas.</div>
        <div class="mk-meta" id="mk-d-previa" style="margin-top:10px"></div>
      </div>
      <div class="mk-box-foot"><button class="btn bg2" onclick="MKUI.fecharSmall()">Cancelar</button><button class="btn bp" onclick="MKUI.confirmarDisparo()">Iniciar disparo</button></div>`);
    dispPub();
  }
  function dispPub() {
    const lista = $('mk-d-pub').value === 'lista';
    $('mk-d-lista-wrap').style.display = lista ? '' : 'none';
    dispPrevia();
  }
  let _previaT;
  function dispPrevia() {
    clearTimeout(_previaT);
    _previaT = setTimeout(async () => {
      const el = $('mk-d-previa');
      if (!el) return;
      try {
        const r = await req('POST', '/contatos/previa', { publico: $('mk-d-pub').value, telefones: $('mk-d-lista') ? $('mk-d-lista').value : '' });
        el.innerHTML = `<b>${r.total}</b> contato(s) válido(s)` + (r.amostra.length ? ' · ex: ' + r.amostra.map(a => esc(a.nome || a.telefone)).join(', ') : '');
      } catch (e) { el.textContent = e.message; }
    }, 350);
  }
  async function confirmarDisparo() {
    const pub = $('mk-d-pub').value;
    try {
      const r = await req('POST', `/fluxos/${MK.ctxDisparo}/disparar`, {
        publico: pub, telefones: $('mk-d-lista').value,
        int_min: $('mk-d-min').value, int_max: $('mk-d-max').value, descadastro: $('mk-d-desc').checked
      });
      toast('ok', `Disparo iniciado para ${r.total} contato(s)`);
      fecharSmall();
      aba('disparos');
    } catch (e) { toast('err', e.message); }
  }

  const ST_DISP = { fila: ['Na fila', 'run'], rodando: ['Enviando', 'run'], pausado: ['Pausado', 'err'], concluido: ['Concluído', 'ok'], cancelado: ['Cancelado', 'err'] };
  function renderDisparos() {
    const el = $('mk-body');
    if (!el || MK.tab !== 'disparos') return;
    if (!MK.disparos.length) { el.innerHTML = '<div class="mk-empty">Nenhum disparo feito ainda.<br>Use o botão <b>Disparar</b> em um fluxo.</div>'; return; }
    el.innerHTML = '<div class="mk-tw"><table class="mk-tbl"><thead><tr><th>Fluxo</th><th>Situação</th><th>Progresso</th><th>Criado</th><th></th></tr></thead><tbody>' +
      MK.disparos.map(d => {
        const feitos = d.enviados + d.falhas;
        const pct = d.total ? Math.round(feitos * 100 / d.total) : 0;
        const [rot, cls] = ST_DISP[d.status] || [d.status, ''];
        const acoes = [];
        if (d.status === 'fila' || d.status === 'rodando') acoes.push(`<button class="btn bg2 bsm" onclick="MKUI.disp(${d.id},'pausar')">Pausar</button>`);
        if (d.status === 'pausado') acoes.push(`<button class="btn bp bsm" onclick="MKUI.disp(${d.id},'retomar')">Retomar</button>`);
        if (!['concluido', 'cancelado'].includes(d.status)) acoes.push(`<button class="btn bd bsm" onclick="MKUI.disp(${d.id},'cancelar')">Cancelar</button>`);
        return `<tr>
          <td><b>${esc(d.flow_nome)}</b></td>
          <td><span class="mk-st ${cls}">${rot}</span>${d.motivo ? `<div class="form-hint">${esc(d.motivo)}</div>` : ''}</td>
          <td><div class="mk-bar"><i style="width:${pct}%"></i></div><div class="form-hint">${d.enviados} enviado(s) · ${d.falhas} falha(s) · ${d.total} no total</div></td>
          <td>${esc(d.created_at)} <span class="form-hint">UTC</span></td>
          <td style="white-space:nowrap">${acoes.join(' ')}</td></tr>`;
      }).join('') + '</tbody></table></div>';
  }
  async function disp(id, acao) {
    if (acao === 'cancelar' && !confirm('Cancelar este disparo? Quem ainda não recebeu não vai receber.')) return;
    try { await req('POST', `/disparos/${id}/${acao}`); await carregarDisparos(); } catch (e) { toast('err', e.message); }
  }

  function renderLogs() {
    const el = $('mk-body');
    if (!el || MK.tab !== 'logs') return;
    if (!MK.logs.length) { el.innerHTML = '<div class="mk-empty">Nenhuma execução registrada ainda.</div>'; return; }
    const origem = { palavra: 'Palavra-chave', botao: 'Clique em botão', disparo: 'Disparo', teste: 'Teste', resposta: 'Resposta do cliente', tempo_limite: 'Sem resposta (tempo)', meu_envio: 'Digitado por mim' };
    el.innerHTML = '<div class="mk-tw"><table class="mk-tbl"><thead><tr><th>Quando (UTC)</th><th>Fluxo</th><th>Contato</th><th>Origem</th><th>Resultado</th></tr></thead><tbody>' +
      MK.logs.map(l => `<tr><td>${esc(l.created_at)}</td><td>${esc(l.fluxo || '#' + l.flow_id)}</td><td>${esc(l.telefone)}</td><td>${esc(origem[l.origem] || l.origem)}</td>
        <td><span class="mk-st ${l.status === 'ok' ? 'ok' : 'err'}">${l.status === 'ok' ? 'Enviado' : 'Erro'}</span>${l.erro ? `<div class="form-hint">${esc(l.erro)}</div>` : ''}</td></tr>`).join('') +
      '</tbody></table></div>';
  }

  // ═══ NOVO / EDITAR (o editor visual fica em admin-marketing-editor.js) ═══
  const G = (nodes, edges) => ({ nodes: [{ id: 'inicio', tipo: 'gatilho', x: 60, y: 140, cfg: {} }, ...nodes], edges });
  const novoDraft = () => ({
    id: null, nome: '',
    gatilho: { tipo: 'palavra', palavras: [], modo: 'contem', publico: 'todos' },
    opcoes: { presenca: true, ignorar_pausa: false, pausar_robo: false, aceita_meu_envio: false, cooldown: 30 },
    grafo: G([{ id: 'n1', tipo: 'texto', x: 380, y: 140, cfg: { texto: '{{saudacao}}, {{primeiro_nome|tudo bem}}! Como posso ajudar?' } }],
      [{ de: 'inicio', porta: 'out', para: 'n1' }])
  });
  const comando = (nome, palavra, no) => () => {
    const d = novoDraft();
    d.nome = nome;
    d.gatilho = { tipo: 'palavra', palavras: [palavra], modo: 'exata', publico: 'todos' };
    d.opcoes = { presenca: true, ignorar_pausa: true, pausar_robo: false, aceita_meu_envio: true, cooldown: 15 };
    d.grafo = G([{ id: 'n1', x: 380, y: 140, ...no }], [{ de: 'inicio', porta: 'out', para: 'n1' }]);
    return d;
  };
  const saberMais = () => {
    const d = novoDraft();
    d.nome = 'Saber mais (exemplo com ramificação)';
    d.gatilho = { tipo: 'palavra', palavras: ['oi', 'olá'], modo: 'exata', publico: 'todos' };
    d.grafo = G([
      { id: 'n1', tipo: 'botoes', x: 380, y: 120, cfg: { texto: '{{saudacao}}, {{primeiro_nome|tudo bem}}! Quer conhecer nosso sistema?', rodape: '', midia: '', botoes: [{ tipo: 'resposta', titulo: 'Saber mais', valor: 'saber mais' }, { tipo: 'resposta', titulo: 'Falar com atendente', valor: 'atendente' }] } },
      { id: 'n2', tipo: 'texto', x: 780, y: 40, cfg: { texto: 'O sistema organiza seus pedidos, cardápio e entregas em um só lugar. Vou te mostrar como funciona.' } },
      { id: 'n3', tipo: 'espera', x: 1140, y: 40, cfg: { segundos: 3 } },
      { id: 'n4', tipo: 'botoes', x: 1480, y: 40, cfg: { texto: 'Veja uma demonstração:', rodape: '', midia: '', botoes: [{ tipo: 'link', titulo: 'Abrir demonstração', valor: '{{link_demo}}' }] } },
      { id: 'n5', tipo: 'notificar', x: 780, y: 380, cfg: { texto: 'Cliente pediu atendente humano.' } },
      { id: 'n6', tipo: 'texto', x: 1140, y: 380, cfg: { texto: 'Certo, já avisei a equipe. Em instantes alguém fala com você.' } }
    ], [
      { de: 'inicio', porta: 'out', para: 'n1' },
      { de: 'n1', porta: 'b0', para: 'n2' }, { de: 'n2', porta: 'out', para: 'n3' }, { de: 'n3', porta: 'out', para: 'n4' },
      { de: 'n1', porta: 'b1', para: 'n5' }, { de: 'n5', porta: 'out', para: 'n6' }
    ]);
    return d;
  };
  const carrossel = () => {
    const d = novoDraft();
    d.nome = 'Catálogo em carrossel';
    d.gatilho = { tipo: 'palavra', palavras: ['catalogo', 'planos'], modo: 'contem', publico: 'todos' };
    const cartao = (t, botoes) => ({ midia: '', nome: '', texto: t, rodape: '', botoes });
    d.grafo = G([
      { id: 'n1', tipo: 'carrossel', x: 380, y: 120, cfg: { intervalo: 2, cartoes: [
        cartao('*Plano Básico*\nPedidos, cardápio e entregas.', [{ tipo: 'resposta', titulo: 'Quero o básico', valor: '' }, { tipo: 'link', titulo: 'Ver detalhes', valor: '{{link_demo}}' }]),
        cartao('*Plano Completo*\nTudo do básico, mais impressão e relatórios.', [{ tipo: 'resposta', titulo: 'Quero o completo', valor: '' }])
      ] } },
      { id: 'n2', tipo: 'texto', x: 820, y: 40, cfg: { texto: 'Ótima escolha! Já vou te passar os próximos passos do plano básico.' } },
      { id: 'n3', tipo: 'texto', x: 820, y: 300, cfg: { texto: 'Ótima escolha! Já vou te passar os próximos passos do plano completo.' } }
    ], [
      { de: 'inicio', porta: 'out', para: 'n1' }, { de: 'n1', porta: 'k0b0', para: 'n2' }, { de: 'n1', porta: 'k1b0', para: 'n3' }
    ]);
    return d;
  };
  const MODELOS = [
    ['Em branco', 'Começar do zero, com um texto de boas-vindas.', () => novoDraft()],
    ['Catálogo em carrossel', 'Vários cartões em sequência, cada um com imagem, texto e botões que seguem caminhos diferentes.', carrossel],
    ['Botão "Saber mais" com ramificação', 'Exemplo pronto: cada botão segue por um caminho diferente. Use como base para montar seus próprios caminhos.', saberMais],
    ['Comando /pix', 'Envia a chave Pix (CNPJ) com o botão "Copiar chave Pix". Funciona quando o cliente digita /pix ou quando você digita na conversa.',
      comando('Comando /pix', '/pix', { tipo: 'botoes', cfg: { texto: '*Pagamento via Pix*\n\n*Chave Pix (CNPJ):*\n{{pix}}\n\nToque no botão abaixo para *copiar a chave* e cole no app do seu banco.\n\nDepois de pagar, é só mandar o comprovante por aqui.', rodape: '', midia: '', botoes: [{ tipo: 'copiar', titulo: 'Copiar chave Pix', valor: '{{pix_chave}}' }] } })],
    ['Comando de texto (ex: /horario)', 'Responde com um texto fixo quando alguém digitar a palavra. Troque a palavra e o texto.',
      comando('Comando /horario', '/horario', { tipo: 'texto', cfg: { texto: 'Nosso atendimento é de segunda a sexta, das 8h às 18h.' } })],
    ['Comando com link (ex: /site)', 'Envia uma mensagem com botão que abre um link.',
      comando('Comando /site', '/site', { tipo: 'botoes', cfg: { texto: 'Acesse nosso site:', rodape: '', midia: '', botoes: [{ tipo: 'link', titulo: 'Abrir site', valor: 'https://' }] } })]
  ];
  function novo() {
    const semPix = MK.status && MK.status.pix === false;
    abrirSmall(`
      <div class="mk-box-head"><div class="mk-box-title">Novo fluxo</div><button class="mk-mini" onclick="MKUI.fecharSmall()">×</button></div>
      <div class="mk-box-body">
        <div class="form-hint" style="margin-bottom:10px">Escolha um modelo. Você pode mudar tudo depois.</div>
        ${MODELOS.map((m, i) => `<div class="mk-sub" style="cursor:pointer" onclick="MKUI.modelo(${i})"><b>${esc(m[0])}</b><div class="form-hint">${esc(m[1])}</div></div>`).join('')}
        ${semPix ? '<div class="mk-alert" style="margin:10px 0 0">A chave Pix (CNPJ) ainda não está cadastrada. Cadastre em Saques PIX, card "WhatsApp de Suporte e Vendas", para o modelo /pix funcionar.</div>' : ''}
      </div>`);
  }
  function modelo(i) { fecharSmall(); window.MKED.abrir(MODELOS[i][2]()); }
  function editar(id) {
    const f = MK.fluxos.find(x => x.id === id);
    if (f) window.MKED.abrir(f);
  }
  async function recarregar(render) {
    await carregarFluxos();
    if (render !== false && MK.tab === 'fluxos') renderFluxos();
  }

  // ── API publica da aba ─────────────────────────────
  window.MKUI = {
    init, aba, novo, modelo, editar, ativar, duplicar, excluir,
    testar, enviarTeste, disparar, dispPub, dispPrevia, confirmarDisparo, disp, fecharSmall,
    req, fluxos: () => MK.fluxos, recarregar
  };
})();

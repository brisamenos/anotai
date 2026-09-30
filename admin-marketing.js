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

      <div class="mk-ov" id="mk-ov-edit"><div class="mk-box" id="mk-edit-box"></div></div>
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

  const TIPO_NOME = { texto: 'Texto', imagem: 'Imagem', video: 'Vídeo', audio: 'Áudio', documento: 'Documento', botoes: 'Botões', lista: 'Lista', espera: 'Espera' };

  function renderFluxos() {
    const el = $('mk-body');
    if (!el) return;
    if (!MK.fluxos.length) {
      el.innerHTML = '<div class="mk-empty">Nenhum fluxo criado ainda.<br>Clique em <b>Novo fluxo</b> para montar o primeiro.</div>';
      return;
    }
    el.innerHTML = '<div class="mk-grid">' + MK.fluxos.map(f => {
      const tipos = [...new Set((f.passos || []).map(p => TIPO_NOME[p.tipo]))];
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
        <div class="mk-chips">${(f.passos || []).length ? `<span class="mk-chip">${f.passos.length} passo(s)</span>` : '<span class="mk-chip">Sem passos</span>'}${tipos.map(t => `<span class="mk-chip">${t}</span>`).join('')}</div>
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
    const origem = { palavra: 'Palavra-chave', botao: 'Clique em botão', disparo: 'Disparo', teste: 'Teste', meu_envio: 'Digitado por mim' };
    el.innerHTML = '<div class="mk-tw"><table class="mk-tbl"><thead><tr><th>Quando (UTC)</th><th>Fluxo</th><th>Contato</th><th>Origem</th><th>Resultado</th></tr></thead><tbody>' +
      MK.logs.map(l => `<tr><td>${esc(l.created_at)}</td><td>${esc(l.fluxo || '#' + l.flow_id)}</td><td>${esc(l.telefone)}</td><td>${esc(origem[l.origem] || l.origem)}</td>
        <td><span class="mk-st ${l.status === 'ok' ? 'ok' : 'err'}">${l.status === 'ok' ? 'Enviado' : 'Erro'}</span>${l.erro ? `<div class="form-hint">${esc(l.erro)}</div>` : ''}</td></tr>`).join('') +
      '</tbody></table></div>';
  }

  // ═══ EDITOR DE FLUXO ═══════════════════════════════
  const novoDraft = () => ({
    id: null, nome: '',
    gatilho: { tipo: 'palavra', palavras: [], modo: 'contem', publico: 'todos' },
    opcoes: { presenca: true, ignorar_pausa: false, pausar_robo: false, aceita_meu_envio: false, cooldown: 30 },
    passos: [{ tipo: 'texto', texto: '{{saudacao}}, {{primeiro_nome|tudo bem}}! Como posso ajudar?' }]
  });

  // Modelos prontos: comandos rapidos (palavra exata, funcionam tambem quando VOCE digita na conversa)
  const comando = (nome, palavra, passos) => () => {
    const d = novoDraft();
    d.nome = nome;
    d.gatilho = { tipo: 'palavra', palavras: [palavra], modo: 'exata', publico: 'todos' };
    d.opcoes = { presenca: true, ignorar_pausa: true, pausar_robo: false, aceita_meu_envio: true, cooldown: 15 };
    d.passos = passos;
    return d;
  };
  const MODELOS = [
    ['Em branco', 'Começar do zero, com um texto de boas-vindas.', () => novoDraft()],
    ['Comando /pix', 'Envia a chave Pix (CNPJ) com o botão "Copiar chave Pix". Funciona quando o cliente digita /pix ou quando você digita na conversa.',
      comando('Comando /pix', '/pix', [{ tipo: 'botoes', texto: '*Pagamento via Pix*\n\n*Chave Pix (CNPJ):*\n{{pix}}\n\nToque no botão abaixo para *copiar a chave* e cole no app do seu banco.\n\nDepois de pagar, é só mandar o comprovante por aqui.', rodape: '', midia: '', botoes: [{ tipo: 'copiar', titulo: 'Copiar chave Pix', valor: '{{pix_chave}}', fluxo: null }] }])],
    ['Comando de texto (ex: /horario)', 'Responde com um texto fixo quando alguém digitar a palavra. Troque a palavra e o texto.',
      comando('Comando /horario', '/horario', [{ tipo: 'texto', texto: 'Nosso atendimento é de segunda a sexta, das 8h às 18h.' }])],
    ['Comando com link (ex: /site)', 'Envia uma mensagem com botão que abre um link.',
      comando('Comando /site', '/site', [{ tipo: 'botoes', texto: 'Acesse nosso site:', rodape: '', midia: '', botoes: [{ tipo: 'link', titulo: 'Abrir site', valor: 'https://', fluxo: null }] }])]
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
  function modelo(i) { fecharSmall(); MK.draft = MODELOS[i][2](); abrirEditor(); }
  function editar(id) {
    const f = MK.fluxos.find(x => x.id === id);
    if (!f) return;
    MK.draft = JSON.parse(JSON.stringify(f));
    abrirEditor();
  }

  function abrirEditor() {
    renderEditor();
    $('mk-ov-edit').classList.add('on');
    document.body.style.overflow = 'hidden';
  }
  function fecharEditor() {
    if (!confirm('Fechar o editor? Alterações não salvas serão perdidas.')) return;
    $('mk-ov-edit').classList.remove('on');
    document.body.style.overflow = '';
    MK.draft = null;
  }

  const sel = (v, opts) => opts.map(([val, txt]) => `<option value="${val}" ${String(v) === String(val) ? 'selected' : ''}>${txt}</option>`).join('');
  const inp = (k, v, ph, extra = '') => `<input class="minput" data-k="${k}" value="${esc(v)}" placeholder="${esc(ph || '')}" oninput="MKUI.in(this)" ${extra}>`;
  const txa = (k, v, ph) => `<textarea class="minput mk-ta" data-k="${k}" placeholder="${esc(ph || '')}" oninput="MKUI.in(this)" onfocus="MKUI.foco(this)">${esc(v)}</textarea>`;

  const VARS = ['primeiro_nome', 'nome', 'loja', 'saudacao', 'pix', 'pix_chave', 'telefone', 'link_demo'];
  function chipsVars() {
    return '<div class="mk-vars">' + VARS.map(v => `<span class="mk-var" onclick="MKUI.inserirVar('${v}')" title="Inserir no último campo de texto">{{${v}}}</span>`).join('') + '</div>';
  }

  function outrosFluxos() { return MK.fluxos.filter(f => f.id !== (MK.draft && MK.draft.id)); }
  function optFluxos(v) {
    return `<option value="">Nenhum (só enviar a palavra)</option>` + outrosFluxos().map(f => `<option value="${f.id}" ${String(v) === String(f.id) ? 'selected' : ''}>Abrir fluxo: ${esc(f.nome)}</option>`).join('');
  }

  function campoMidia(i, p, tipo) {
    const tem = p.midia && !/^https?:/i.test(p.midia);
    const accept = { imagem: '.jpg,.jpeg,.png,.webp', video: '.mp4,.mov,.3gp,.webm', audio: '.mp3,.ogg,.opus,.m4a,.aac,.wav,.webm', documento: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip' }[tipo];
    let prev = '';
    if (tem) {
      if (tipo === 'imagem') prev = `<img class="mk-media" data-blob="${esc(p.midia)}">`;
      if (tipo === 'video') prev = `<video class="mk-media" controls data-blob="${esc(p.midia)}"></video>`;
      if (tipo === 'audio') prev = `<audio controls data-blob="${esc(p.midia)}" style="margin-top:6px;max-width:100%"></audio>`;
    }
    return `
      <div class="mk-file">
        <button class="btn bg2 bsm" onclick="MKUI.arquivo(${i},'${tipo}','${accept}')">${p.midia ? 'Trocar arquivo' : 'Escolher arquivo'}</button>
        <span class="mk-file-name">${tem ? esc(p.nome || p.midia) : (p.midia ? '' : 'Nenhum arquivo')}</span>
        ${tem ? `<button class="mk-mini del" title="Remover" onclick="MKUI.limparMidia(${i})">×</button>` : ''}
      </div>
      ${tem ? '' : `<input class="minput" data-k="passos.${i}.midia" value="${esc(p.midia)}" placeholder="ou cole um link público https://..." oninput="MKUI.in(this)">`}
      ${prev}`;
  }

  function editorPasso(p, i) {
    const n = MK.draft.passos.length;
    const tools = `<div class="mk-step-tools">
      <button class="mk-mini" title="Subir" onclick="MKUI.mover(${i},-1)" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="mk-mini" title="Descer" onclick="MKUI.mover(${i},1)" ${i === n - 1 ? 'disabled' : ''}>↓</button>
      <button class="mk-mini del" title="Remover passo" onclick="MKUI.remover(${i})">×</button></div>`;
    let corpo = '';
    switch (p.tipo) {
      case 'texto':
        corpo = txa(`passos.${i}.texto`, p.texto, 'Escreva a mensagem. Use *negrito* e _itálico_.') + chipsVars(); break;
      case 'imagem': case 'video':
        corpo = campoMidia(i, p, p.tipo) + `<label class="form-label" style="margin-top:8px">Legenda</label>` + txa(`passos.${i}.legenda`, p.legenda, 'Opcional'); break;
      case 'audio':
        corpo = campoMidia(i, p, 'audio') + `
          <label class="mk-check"><input type="checkbox" data-k="passos.${i}.gravado" ${p.gravado !== false ? 'checked' : ''} onchange="MKUI.in(this)"> <span>Enviar como mensagem de voz gravada na hora (aparece "gravando áudio..." antes de chegar, com o ícone de microfone)</span></label>`; break;
      case 'documento':
        corpo = campoMidia(i, p, 'documento') + `<div class="mk-row"><div>${inp(`passos.${i}.nome`, p.nome, 'Nome do arquivo (ex: cardapio.pdf)')}</div></div>
          <label class="form-label" style="margin-top:8px">Legenda</label>` + txa(`passos.${i}.legenda`, p.legenda, 'Opcional'); break;
      case 'espera':
        corpo = `<div class="mk-row"><div><label class="form-label">Esperar (segundos)</label>${inp(`passos.${i}.segundos`, p.segundos, '3', 'type="number" min="1" max="120"')}</div></div>
          <div class="form-hint">Pausa antes do próximo passo. Útil para dar tempo de ler entre uma mensagem e outra.</div>`; break;
      case 'botoes':
        corpo = `
          <label class="form-label">Texto da mensagem</label>${txa(`passos.${i}.texto`, p.texto, 'Ex: Qual opção você prefere?')}${chipsVars()}
          <div class="mk-row" style="margin-top:8px">
            <div><label class="form-label">Rodapé <span style="font-weight:400;text-transform:none">(opcional)</span></label>${inp(`passos.${i}.rodape`, p.rodape, '', 'maxlength="60"')}</div>
          </div>
          <label class="form-label" style="margin-top:8px">Imagem no topo <span style="font-weight:400;text-transform:none">(opcional)</span></label>${campoMidia(i, { ...p, midia: p.midia }, 'imagem')}
          <div class="mk-sec" style="margin-top:12px">Botões (máximo 3)</div>
          ${(p.botoes || []).map((b, j) => editorBotao(i, b, j)).join('')}
          ${(p.botoes || []).length < 3 ? `<button class="btn bg2 bsm" onclick="MKUI.addBotao(${i})">Adicionar botão</button>` : ''}`; break;
      case 'lista':
        corpo = `
          <div class="mk-row"><div><label class="form-label">Título</label>${inp(`passos.${i}.titulo`, p.titulo, '', 'maxlength="60"')}</div>
          <div><label class="form-label">Texto do botão que abre a lista</label>${inp(`passos.${i}.botao_texto`, p.botao_texto, 'Ver opções', 'maxlength="20"')}</div></div>
          <label class="form-label" style="margin-top:8px">Texto da mensagem</label>${txa(`passos.${i}.texto`, p.texto, 'Ex: Escolha uma das opções')}${chipsVars()}
          <label class="form-label" style="margin-top:8px">Rodapé <span style="font-weight:400;text-transform:none">(opcional)</span></label>${inp(`passos.${i}.rodape`, p.rodape, '', 'maxlength="60"')}
          <div class="mk-sec" style="margin-top:12px">Seções e linhas (máximo 10 linhas no total)</div>
          ${(p.secoes || []).map((s, si) => `
            <div class="mk-sub">
              <div style="display:flex;gap:6px;margin-bottom:8px">${inp(`passos.${i}.secoes.${si}.titulo`, s.titulo, 'Título da seção', 'maxlength="24"')}
                <button class="mk-mini del" title="Remover seção" onclick="MKUI.rmSecao(${i},${si})">×</button></div>
              ${(s.linhas || []).map((l, li) => `
                <div class="mk-sub" style="background:var(--s2)">
                  <div class="mk-row">
                    <div>${inp(`passos.${i}.secoes.${si}.linhas.${li}.titulo`, l.titulo, 'Título da linha', 'maxlength="24"')}</div>
                    <div>${inp(`passos.${i}.secoes.${si}.linhas.${li}.descricao`, l.descricao, 'Descrição (opcional)', 'maxlength="72"')}</div>
                  </div>
                  <div class="mk-row" style="margin-top:6px">
                    <div>${inp(`passos.${i}.secoes.${si}.linhas.${li}.valor`, l.valor, 'Palavra enviada ao clicar')}</div>
                    <div><select class="minput" data-k="passos.${i}.secoes.${si}.linhas.${li}.fluxo" onchange="MKUI.in(this)">${optFluxos(l.fluxo)}</select></div>
                  </div>
                  <div style="text-align:right;margin-top:6px"><button class="btn bd bsm" onclick="MKUI.rmLinha(${i},${si},${li})">Remover linha</button></div>
                </div>`).join('')}
              <button class="btn bg2 bsm" onclick="MKUI.addLinha(${i},${si})">Adicionar linha</button>
            </div>`).join('')}
          <button class="btn bg2 bsm" onclick="MKUI.addSecao(${i})">Adicionar seção</button>`; break;
    }
    return `<div class="mk-step"><div class="mk-step-head"><span class="mk-step-tag">${i + 1}. ${TIPO_NOME[p.tipo]}</span>${tools}</div>${corpo}</div>`;
  }

  function editorBotao(i, b, j) {
    const ph = { resposta: 'Palavra enviada ao clicar (ex: quero)', link: 'https://seusite.com.br', copiar: 'Texto que será copiado (ex: {{pix_chave}})', ligar: 'Telefone com DDD (ex: 85991234567)' }[b.tipo];
    return `<div class="mk-sub">
      <div class="mk-row">
        <div><label class="form-label">Tipo</label>
          <select class="minput" data-k="passos.${i}.botoes.${j}.tipo" onchange="MKUI.in(this,true)">${sel(b.tipo, [['resposta', 'Resposta (palavra)'], ['link', 'Abrir link'], ['copiar', 'Copiar texto'], ['ligar', 'Ligar']])}</select></div>
        <div><label class="form-label">Título do botão</label>${inp(`passos.${i}.botoes.${j}.titulo`, b.titulo, 'Até 20 letras', 'maxlength="20"')}</div>
      </div>
      <div class="mk-row" style="margin-top:6px">
        <div><label class="form-label">${b.tipo === 'resposta' ? 'Palavra enviada' : b.tipo === 'link' ? 'Link' : b.tipo === 'copiar' ? 'Texto a copiar' : 'Telefone'}</label>${inp(`passos.${i}.botoes.${j}.valor`, b.valor, ph)}</div>
        ${b.tipo === 'resposta' ? `<div><label class="form-label">Ao clicar</label><select class="minput" data-k="passos.${i}.botoes.${j}.fluxo" onchange="MKUI.in(this)">${optFluxos(b.fluxo)}</select></div>` : '<div></div>'}
      </div>
      <div style="text-align:right;margin-top:6px"><button class="btn bd bsm" onclick="MKUI.rmBotao(${i},${j})">Remover botão</button></div>
    </div>`;
  }

  function renderEditor() {
    const d = MK.draft;
    const g = d.gatilho, o = d.opcoes;
    $('mk-edit-box').innerHTML = `
      <div class="mk-box-head">
        <div class="mk-box-title">${d.id ? 'Editar fluxo' : 'Novo fluxo'}</div>
        <button class="mk-mini" title="Fechar" onclick="MKUI.fechar()">×</button>
      </div>
      <div class="mk-box-body">
        <div class="mk-edit">
          <div>
            <div class="mk-sec">Identificação</div>
            <div class="form-group"><label class="form-label">Nome do fluxo</label>${inp('nome', d.nome, 'Ex: Promoção de setembro', 'maxlength="80"')}</div>

            <div class="mk-sec">Gatilho</div>
            <div class="form-group"><label class="form-label">Quando este fluxo começa</label>
              <select class="minput" data-k="gatilho.tipo" onchange="MKUI.in(this,'gatilho')">${sel(g.tipo, [['palavra', 'Quando alguém enviar uma palavra-chave (ou clicar em um botão com ela)'], ['manual', 'Somente por disparo manual para uma lista de contatos']])}</select></div>
            <div id="mk-gat">${blocoGatilho()}</div>

            <div class="mk-sec">Passos do fluxo</div>
            <div id="mk-steps">${d.passos.map(editorPasso).join('') || '<div class="mk-empty" style="padding:18px">Sem passos. Adicione o primeiro abaixo.</div>'}</div>
            <div class="mk-add">
              ${Object.keys(TIPO_NOME).map(t => `<button class="btn bg2 bsm" onclick="MKUI.addPasso('${t}')">+ ${TIPO_NOME[t]}</button>`).join('')}
            </div>
          </div>

          <div class="mk-prev-wrap">
            <div class="mk-sec">Pré-visualização</div>
            <div class="mk-phone"><div class="mk-phone-top">Cliente (exemplo: Maria Souza)</div><div class="mk-chat" id="mk-prev"></div></div>
            <div class="form-hint" style="margin-top:8px">Aproximação de como as mensagens chegam. Botões e listas nativos dependem da versão do WhatsApp do cliente.</div>
          </div>
        </div>
      </div>
      <div class="mk-box-foot">
        <button class="btn bg2" onclick="MKUI.fechar()">Cancelar</button>
        <button class="btn bg2" onclick="MKUI.salvar(false)">Salvar</button>
        <button class="btn bp" onclick="MKUI.salvar(true)">Salvar e ativar</button>
      </div>`;
    preview();
    carregarBlobs();
  }

  function blocoGatilho() {
    const g = MK.draft.gatilho, o = MK.draft.opcoes;
    const palavras = g.tipo === 'palavra' ? `
      <div class="form-group"><label class="form-label">Palavras-chave (uma por linha)</label>
        <textarea class="minput mk-ta" data-k="gatilho.palavras" placeholder="promoção&#10;cardápio&#10;/pix" oninput="MKUI.in(this)">${esc((g.palavras || []).join('\n'))}</textarea>
        <div class="form-hint">Sem diferença entre maiúsculas, minúsculas e acentos. Um botão de "resposta" com a mesma palavra também aciona este fluxo.</div></div>
      <div class="mk-row">
        <div class="form-group"><label class="form-label">Como comparar</label>
          <select class="minput" data-k="gatilho.modo" onchange="MKUI.in(this)">${sel(g.modo, [['contem', 'A mensagem contém a palavra'], ['exata', 'A mensagem é exatamente a palavra'], ['inicia', 'A mensagem começa com a palavra']])}</select></div>
        <div class="form-group"><label class="form-label">Quem pode acionar</label>
          <select class="minput" data-k="gatilho.publico" onchange="MKUI.in(this)">${sel(g.publico, [['todos', 'Qualquer pessoa'], ['clientes', 'Só clientes cadastrados'], ['nao_clientes', 'Só quem não é cliente']])}</select></div>
      </div>
      <div class="form-group"><label class="form-label">Esperar antes de responder a mesma pessoa de novo (segundos)</label>${inp('opcoes.cooldown', o.cooldown, '30', 'type="number" min="0"')}</div>
      <label class="mk-check"><input type="checkbox" data-k="opcoes.ignorar_pausa" ${o.ignorar_pausa ? 'checked' : ''} onchange="MKUI.in(this)"> <span>Responder mesmo quando eu assumi a conversa pelo celular</span></label>
      <label class="mk-check"><input type="checkbox" data-k="opcoes.aceita_meu_envio" ${o.aceita_meu_envio ? 'checked' : ''} onchange="MKUI.in(this)"> <span>Também disparar quando <b>eu</b> digitar a palavra na conversa (só palavra exata, envia o fluxo para o cliente daquela conversa)</span></label>
      <label class="mk-check"><input type="checkbox" data-k="opcoes.pausar_robo" ${o.pausar_robo ? 'checked' : ''} onchange="MKUI.in(this)"> <span>Pausar o robô de atendimento nessa conversa depois do fluxo</span></label>` : '';
    return palavras + `<label class="mk-check"><input type="checkbox" data-k="opcoes.presenca" ${o.presenca !== false ? 'checked' : ''} onchange="MKUI.in(this)"> <span>Simular "digitando..." e "gravando áudio..." antes de cada mensagem</span></label>`;
  }

  // ── Edicao do rascunho ─────────────────────────────
  let _ultimoCampo = null;
  function foco(el) { _ultimoCampo = el; }

  function setPath(obj, path, val) {
    const ks = path.split('.');
    let o = obj;
    for (let n = 0; n < ks.length - 1; n++) o = o[ks[n]];
    o[ks[ks.length - 1]] = val;
  }

  function entrada(el, re) {
    const k = el.dataset.k;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (k === 'gatilho.palavras') v = String(v).split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
    if (/\.fluxo$/.test(k)) v = v ? parseInt(v, 10) : null;
    setPath(MK.draft, k, v);
    if (re === 'gatilho') { $('mk-gat').innerHTML = blocoGatilho(); }
    else if (re === true) { $('mk-steps').innerHTML = MK.draft.passos.map(editorPasso).join(''); carregarBlobs(); }
    preview();
  }

  function inserirVar(nome) {
    const el = _ultimoCampo;
    if (!el || !document.body.contains(el)) { toast('err', 'Clique primeiro no campo de texto onde quer inserir'); return; }
    const ini = el.selectionStart ?? el.value.length, fim = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, ini) + `{{${nome}}}` + el.value.slice(fim);
    el.focus();
    el.selectionStart = el.selectionEnd = ini + nome.length + 4;
    entrada(el);
  }

  function refazPassos() { $('mk-steps').innerHTML = MK.draft.passos.map(editorPasso).join('') || '<div class="mk-empty" style="padding:18px">Sem passos. Adicione o primeiro abaixo.</div>'; preview(); carregarBlobs(); }

  function addPasso(tipo) {
    const base = {
      texto: { texto: '' }, imagem: { midia: '', nome: '', legenda: '' }, video: { midia: '', nome: '', legenda: '' },
      audio: { midia: '', nome: '', gravado: true, segundos: 0 }, documento: { midia: '', nome: '', legenda: '' },
      espera: { segundos: 3 },
      botoes: { texto: '', rodape: '', midia: '', botoes: [{ tipo: 'resposta', titulo: '', valor: '', fluxo: null }] },
      lista: { titulo: '', texto: '', rodape: '', botao_texto: 'Ver opções', secoes: [{ titulo: 'Opções', linhas: [{ titulo: '', descricao: '', valor: '', fluxo: null }] }] }
    }[tipo];
    MK.draft.passos.push({ tipo, ...base });
    refazPassos();
  }
  function remover(i) { MK.draft.passos.splice(i, 1); refazPassos(); }
  function mover(i, d) {
    const j = i + d, p = MK.draft.passos;
    if (j < 0 || j >= p.length) return;
    [p[i], p[j]] = [p[j], p[i]];
    refazPassos();
  }
  function addBotao(i) { MK.draft.passos[i].botoes.push({ tipo: 'resposta', titulo: '', valor: '', fluxo: null }); refazPassos(); }
  function rmBotao(i, j) { MK.draft.passos[i].botoes.splice(j, 1); refazPassos(); }
  function addSecao(i) { MK.draft.passos[i].secoes.push({ titulo: 'Opções', linhas: [{ titulo: '', descricao: '', valor: '', fluxo: null }] }); refazPassos(); }
  function rmSecao(i, s) { MK.draft.passos[i].secoes.splice(s, 1); refazPassos(); }
  function addLinha(i, s) {
    const total = MK.draft.passos[i].secoes.reduce((n, x) => n + x.linhas.length, 0);
    if (total >= 10) { toast('err', 'A lista aceita no máximo 10 linhas no total'); return; }
    MK.draft.passos[i].secoes[s].linhas.push({ titulo: '', descricao: '', valor: '', fluxo: null });
    refazPassos();
  }
  function rmLinha(i, s, l) { MK.draft.passos[i].secoes[s].linhas.splice(l, 1); refazPassos(); }
  function limparMidia(i) { const p = MK.draft.passos[i]; p.midia = ''; p.nome = ''; if (p.tipo === 'audio') p.segundos = 0; refazPassos(); }

  // ── Upload de midia ────────────────────────────────
  function arquivo(i, tipo, accept) {
    const inpF = document.createElement('input');
    inpF.type = 'file'; inpF.accept = accept;
    inpF.onchange = () => {
      const f = inpF.files[0];
      if (!f) return;
      const tipoUp = tipo === 'botoes' ? 'imagem' : tipo;
      const rd = new FileReader();
      toast('ok', 'Enviando arquivo...');
      rd.onload = async () => {
        try {
          const r = await req('POST', '/midia', { nome: f.name, tipo: tipoUp, dados: rd.result });
          const p = MK.draft.passos[i];
          p.midia = r.arquivo; p.nome = f.name;
          if (p.tipo === 'audio') p.segundos = r.segundos || 0;
          MK.blobs[r.arquivo] = URL.createObjectURL(f);
          if (r.aviso) toast('err', r.aviso); else toast('ok', r.convertido ? 'Áudio enviado e convertido para mensagem de voz' : 'Arquivo enviado');
          refazPassos();
        } catch (e) { toast('err', e.message); }
      };
      rd.readAsDataURL(f);
    };
    inpF.click();
  }

  async function blobUrl(arq) {
    if (MK.blobs[arq]) return MK.blobs[arq];
    const r = await fetch('/api/admin/marketing/midia/' + arq, { headers: adminAuthHeader() });
    if (!r.ok) throw new Error('sem arquivo');
    return (MK.blobs[arq] = URL.createObjectURL(await r.blob()));
  }
  function carregarBlobs() {
    document.querySelectorAll('#mk-ov-edit [data-blob]').forEach(async el => {
      if (el.src) return;
      try { el.src = await blobUrl(el.dataset.blob); } catch (_) {}
    });
  }

  // ── Pre-visualizacao ───────────────────────────────
  function fmt(t) {
    const vars = { nome: 'Maria Souza', primeiro_nome: 'Maria', loja: 'Pizzaria Bom Sabor', saudacao: 'Bom dia', telefone: '5585991234567', pix: '12.345.678/0001-90', pix_chave: '12345678000190', link_demo: 'https://...' };
    let s = String(t || '').replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi, (_, k, pad) => vars[k.toLowerCase()] || (pad || '').trim());
    s = esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>');
    return s;
  }
  function preview() {
    const el = $('mk-prev');
    if (!el || !MK.draft) return;
    const midia = (p, tag) => {
      if (!p.midia) return `<div style="opacity:.6">[${TIPO_NOME[p.tipo]} sem arquivo]</div>`;
      if (/^https?:/i.test(p.midia)) return tag === 'img' ? `<img src="${esc(p.midia)}">` : `<div>[${TIPO_NOME[p.tipo]}: link]</div>`;
      if (tag === 'img') return `<img data-blob="${esc(p.midia)}">`;
      if (tag === 'video') return `<video controls data-blob="${esc(p.midia)}"></video>`;
      if (tag === 'audio') return `<audio controls data-blob="${esc(p.midia)}"></audio>`;
      return `<div>[Arquivo: ${esc(p.nome || p.midia)}]</div>`;
    };
    el.innerHTML = MK.draft.passos.map(p => {
      switch (p.tipo) {
        case 'texto': return `<div class="mk-b">${fmt(p.texto) || '<i style="opacity:.5">mensagem vazia</i>'}</div>`;
        case 'imagem': return `<div class="mk-b">${midia(p, 'img')}${fmt(p.legenda)}</div>`;
        case 'video': return `<div class="mk-b">${midia(p, 'video')}${fmt(p.legenda)}</div>`;
        case 'audio': return `<div class="mk-b">${midia(p, 'audio')}<small>${p.gravado !== false ? 'Mensagem de voz' : 'Arquivo de áudio'}</small></div>`;
        case 'documento': return `<div class="mk-b">[Documento] ${esc(p.nome || p.midia || 'sem arquivo')}<br>${fmt(p.legenda)}</div>`;
        case 'espera': return `<div class="mk-wait">aguarda ${esc(p.segundos)}s</div>`;
        case 'botoes': return `<div class="mk-b">${p.midia ? midia({ ...p, tipo: 'imagem' }, 'img') : ''}${fmt(p.texto) || '<i style="opacity:.5">mensagem vazia</i>'}${p.rodape ? `<small>${esc(p.rodape)}</small>` : ''}${(p.botoes || []).map(b => `<span class="mk-bbtn">${{ link: '&#8599; ', copiar: '&#10063; ', ligar: '&#9990; ', resposta: '' }[b.tipo]}${esc(b.titulo || 'Botão')}</span>`).join('')}</div>`;
        case 'lista': return `<div class="mk-b"><b>${esc(p.titulo)}</b>${p.titulo ? '<br>' : ''}${fmt(p.texto)}${p.rodape ? `<small>${esc(p.rodape)}</small>` : ''}<span class="mk-bbtn">&#9776; ${esc(p.botao_texto || 'Ver opções')}</span></div>`;
      }
      return '';
    }).join('') || '<div class="mk-wait">sem passos</div>';
    carregarBlobs();
  }

  // ── Salvar ─────────────────────────────────────────
  async function salvar(ativar) {
    const d = MK.draft;
    try {
      const r = await req('POST', '/fluxos', d);
      const id = r.fluxo.id;
      if (ativar) {
        try { await req('POST', `/fluxos/${id}/ativar`); toast('ok', 'Fluxo salvo e ativado'); }
        catch (e) { toast('err', 'Salvo, mas não ativou: ' + e.message); }
      } else {
        toast('ok', 'Fluxo salvo');
      }
      $('mk-ov-edit').classList.remove('on');
      document.body.style.overflow = '';
      MK.draft = null;
      await carregarFluxos();
      aba('fluxos');
    } catch (e) { toast('err', e.message); }
  }

  // ── API publica da aba ─────────────────────────────
  window.MKUI = {
    init, aba, novo, modelo, editar, fechar: fecharEditor, salvar, ativar, duplicar, excluir,
    testar, enviarTeste, disparar, dispPub, dispPrevia, confirmarDisparo, disp, fecharSmall,
    in: entrada, foco, inserirVar, addPasso, remover, mover, addBotao, rmBotao, addSecao, rmSecao, addLinha, rmLinha,
    arquivo, limparMidia
  };
})();

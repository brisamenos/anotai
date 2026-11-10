// ═══════════════════════════════════════════════════════
// ADMIN-MARKETING.JS — aba "Marketing" do painel admin
// Construtor de fluxos de WhatsApp (palavra-chave, botoes, listas, midia, audio gravado)
// e disparos em massa. Usa a API /api/admin/marketing (marketing-flows.js).
// Importar / Exportar: pacote .zip com fluxo.json + midias (ver "IMPORTAR / EXPORTAR" abaixo).
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
    ctxDisparo: null,
    nc: null,        // opção "quem não é cliente" salva no servidor (null = servidor sem esse recurso)
    ncRascunho: null, // o que está na tela e ainda não foi salvo
    mr: null,         // opção extra no menu do robô (ex.: Tutoriais em vídeo)
    mrRascunho: null
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
.mk-head-acoes{display:flex;gap:8px;flex-wrap:wrap}
.mk-nc{background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:16px}
.mk-nc-t{font-family:'Space Grotesk',sans-serif;font-weight:800;font-size:15px;margin-bottom:3px}
.mk-nc-campos{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:12px}
.mk-nc-campos .form-group{margin:0}
.mk-nc-pe{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px}
.mk-drop{display:block;position:relative;border:1.5px dashed var(--border);border-radius:12px;padding:22px 16px;text-align:center;cursor:pointer;background:var(--s2);color:var(--text-2);font-size:12.5px;line-height:1.55}
.mk-drop:hover,.mk-drop.sobre,.mk-drop:focus-within{border-color:var(--accent);color:var(--text)}
.mk-drop b{display:block;color:var(--text);font-size:13.5px;margin-bottom:2px}
.mk-drop input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.mk-imp-resumo{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;font-size:12.5px;line-height:1.5;margin:0 0 14px}
.mk-imp-resumo dt{color:var(--muted)}
.mk-imp-resumo dd{margin:0;color:var(--text);word-break:break-word}
.mk-imp-lista{margin:6px 0 0;padding-left:18px;font-size:12px;line-height:1.55}
.mk-alert.erro{border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.08)}
.mk-imp-prog{margin-top:12px;font-size:12.5px;color:var(--text-2)}
.mk-imp-prog .mk-bar{margin-top:7px;min-width:0}
.mk-lista-t{font-family:'Space Grotesk',sans-serif;font-weight:800;font-size:15px;margin:4px 0 12px;display:flex;align-items:baseline;gap:10px}
.mk-lista-t span{font-family:inherit;font-weight:600;font-size:12px;color:var(--muted)}
.mk-estado{display:inline-block;margin-top:6px;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;border:1px solid var(--border);background:var(--s2);color:var(--muted)}
.mk-estado.on{color:var(--success);border-color:rgba(34,197,94,.4);background:rgba(34,197,94,.1)}
.mk-estado.av{color:var(--orange);border-color:rgba(249,115,22,.4);background:rgba(249,115,22,.1)}
.mk-estado.inc{color:var(--danger);border-color:rgba(239,68,68,.4);background:rgba(239,68,68,.1)}
.mk-como{background:var(--s2);border:1px solid var(--border);border-radius:11px;padding:11px 12px}
.mk-como-t{display:block;font-size:10.5px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:var(--muted);margin-bottom:7px}
.mk-linha{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;line-height:1.45;color:var(--text);margin:5px 0;word-break:break-word}
.mk-linha b{font-weight:700}
.mk-linha svg,.mk-rota-t svg,.mk-op-t svg{width:16px;height:16px;flex:none;fill:none;stroke:var(--accent);stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round;margin-top:1px}
.mk-linha.vazio{color:var(--text-2)}.mk-linha.erro{color:var(--danger)}
.mk-flow.off .mk-linha svg{stroke:var(--muted)}
.mk-links{display:flex;gap:14px;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:9px}
.mk-links button{background:none;border:0;padding:0;font:inherit;font-size:12px;font-weight:600;color:var(--text-2);cursor:pointer}
.mk-links button:hover{color:var(--text);text-decoration:underline}.mk-links button.del:hover{color:var(--danger)}
.mk-rotas{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:12px}
.mk-rota{background:var(--s2);border:1px solid var(--border);border-radius:11px;padding:12px;min-width:0}
.mk-rota-t{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;font-weight:700;margin-bottom:8px;line-height:1.35}
.mk-rota-num{font-family:'Space Grotesk',sans-serif;font-weight:800;font-size:15px;margin-bottom:2px}
.mk-rota .form-hint{margin-top:6px}.mk-vai{color:var(--orange)!important}
.mk-pal-pe{display:flex;gap:8px;margin-top:10px}
.mk-av{margin-top:18px;border:1px solid var(--border);border-radius:14px;background:var(--s1);padding:12px 16px}
.mk-av summary{cursor:pointer;font-size:12.5px;font-weight:700;color:var(--text-2)}
.mk-av[open] summary{margin-bottom:4px;color:var(--text)}
.mk-op{border:1px solid var(--border);border-radius:11px;padding:11px 12px;margin-bottom:9px;background:var(--s2)}
.mk-op-t{display:flex;gap:9px;align-items:flex-start;cursor:pointer;font-size:13px;font-weight:700;line-height:1.4}
.mk-op-t input{margin-top:3px;flex:none}.mk-op-t span{display:flex;gap:7px;align-items:flex-start}
.mk-op-h{margin:4px 0 0 24px}.mk-op-c{margin:10px 0 0 24px}
@media(max-width:600px){.mk-op-h,.mk-op-c{margin-left:0}}
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
        <div class="mk-head-acoes">
          <button class="btn bg2" onclick="MKUI.importar()">Importar fluxo</button>
          <button class="btn bp" onclick="MKUI.novo()">Novo fluxo</button>
        </div>
      </div>
      <div id="mk-status"></div>
      <div class="mk-tabs">
        <button class="mk-tab on" data-tab="fluxos" onclick="MKUI.aba('fluxos')">Fluxos</button>
        <button class="mk-tab" data-tab="disparos" onclick="MKUI.aba('disparos')">Disparos</button>
        <button class="mk-tab" data-tab="logs" onclick="MKUI.aba('logs')">Registro</button>
        <button class="mk-tab" data-tab="bloqueados" onclick="MKUI.aba('bloqueados')">Lista negra</button>
      </div>
      <div id="mk-body"></div>

      <div class="mk-ov" id="mk-ov-small"><div class="mk-box sm" id="mk-small-box"></div></div>`;
  }

  // ── Entrada da aba ─────────────────────────────────
  async function init() {
    injetarCss();
    shell();
    await Promise.all([carregarStatus(), carregarFluxos(), carregarNaoCliente()]);
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
    // o aviso da opção "quem não é cliente" depende de o fluxo escolhido existir e estar ativo
    if (MK.nc) { try { const c = await req('GET', '/config'); MK.nc = c.nao_cliente || MK.nc; MK.mr = c.menu_robo || MK.mr; } catch (_) {} }
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
    if (nome === 'bloqueados') { renderBloqueados(); carregarBloqueados(); }
  }

  // ── Lista negra ────────────────────────────────────
  async function carregarBloqueados() {
    try { MK.bloqueados = (await req('GET', '/bloqueados')).bloqueados || []; } catch (e) { toast('err', e.message); }
    if (MK.tab === 'bloqueados') renderBloqueados();
  }
  function renderBloqueados() {
    const el = $('mk-body');
    if (!el || MK.tab !== 'bloqueados') return;
    const lista = MK.bloqueados || [];
    const origem = { fluxo: 'Tocou em Bloquear', comando: 'Você digitou /bloquear', painel: 'Adicionado no painel' };
    const fone = t => { const d = String(t || ''); return d.length >= 12 ? `(${d.slice(2, 4)}) ${d.slice(4, -4)}-${d.slice(-4)}` : d; };
    el.innerHTML = `
      <div class="mk-sub" style="margin-bottom:14px">
        <div class="form-hint" style="margin-bottom:10px">Quem está aqui não recebe nada automático do WhatsApp de Suporte e Vendas: nem menu do robô, nem fluxo, nem disparo. Você continua podendo conversar com a pessoa pelo celular.<br>Para bloquear direto na conversa, digite <b>/bloquear</b>. Para liberar de novo, digite <b>/desbloquear</b>. O comando é apagado da conversa sozinho.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input class="minput" id="mk-bl-fone" type="text" inputmode="tel" placeholder="DDD + número, ex: 88999998888" style="flex:1;min-width:200px" oninput="this.value=this.value.replace(/\D/g,'').slice(0,13)">
          <button class="btn bp bsm" onclick="MKUI.bloquearNumero()">Bloquear número</button>
        </div>
      </div>
      ${lista.length ? '<div class="mk-tw"><table class="mk-tbl"><thead><tr><th>Contato</th><th>Como entrou</th><th>Desde (UTC)</th><th></th></tr></thead><tbody>' +
        lista.map(b => `<tr><td>${esc(fone(b.telefone))}</td><td>${esc(origem[b.origem] || b.origem || '-')}</td><td>${esc(b.created_at)}</td>
          <td style="text-align:right"><button class="btn bg2 bsm" onclick="MKUI.desbloquearNumero('${esc(b.telefone)}')">Desbloquear</button></td></tr>`).join('') +
        '</tbody></table></div>' : '<div class="mk-empty">Nenhum contato bloqueado.</div>'}`;
  }
  async function bloquearNumero() {
    const tel = ($('mk-bl-fone')?.value || '').trim();
    if (tel.replace(/\D/g, '').length < 10) { toast('err', 'Digite o número com DDD'); return; }
    try { await req('POST', '/bloqueados', { telefone: tel }); toast('ok', 'Contato bloqueado'); await carregarBloqueados(); } catch (e) { toast('err', e.message); }
  }
  async function desbloquearNumero(tel) {
    if (!confirm('Desbloquear este contato? Ele volta a receber o menu do robô e os fluxos.')) return;
    try { await req('POST', '/bloqueados/remover', { telefone: tel }); toast('ok', 'Contato desbloqueado'); await carregarBloqueados(); } catch (e) { toast('err', e.message); }
  }

  // ── Lista de fluxos ────────────────────────────────
  function resumoGatilho(f) {
    const g = f.gatilho || {};
    if (g.tipo === 'manual') return 'Somente disparo manual';
    const modo = { contem: 'contém', exata: 'igual a', inicia: 'começa com' }[g.modo] || 'contém';
    return `Quando a mensagem ${modo}: ` + (g.palavras || []).map(p => `<b>${esc(p)}</b>`).join(', ');
  }

  const TIPO_NOME = { texto: 'Texto', imagem: 'Imagem', video: 'Vídeo', audio: 'Áudio', documento: 'Documento', botoes: 'Botões', lista: 'Lista', carrossel: 'Carrossel', espera: 'Espera', aguardar: 'Aguardar', condicao: 'Condição', definir_var: 'Variável', notificar: 'Notificar', pausar_robo: 'Pausar robô', chamar_fluxo: 'Outro fluxo', bloquear: 'Bloquear', vendas: 'Vendas' };

  // ── Lista de fluxos: palavra-chave e liga/desliga direto no cartão ──
  // Regra única: fluxo ligado + palavra-chave = dispara, seja o cliente ou você quem enviou a
  // palavra. A caixa "primeira mensagem" é a única escolha a mais, e também fica no cartão.
  const palavrasDe = f => ((f.gatilho || {}).tipo === 'palavra' ? ((f.gatilho || {}).palavras || []) : []);
  const ehNaoCliente = f => !!MK.nc && MK.nc.modo === 'fluxo' && Number(MK.nc.fluxo) === f.id;
  const lerPalavras = id => ($('mk-p-' + id)?.value || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);

  function renderFluxos() {
    const el = $('mk-body');
    if (!el) return;
    if (!MK.fluxos.length) {
      el.innerHTML = '<div class="mk-empty">Nenhum fluxo criado ainda.<br>Clique em <b>Novo fluxo</b> para montar o primeiro ou em <b>Importar fluxo</b> para trazer um fluxo pronto.</div>' + htmlAvancado();
      return;
    }
    const ordem = MK.fluxos.slice().sort((a, b) => (b.ativo ? 1 : 0) - (a.ativo ? 1 : 0) || b.id - a.id);
    el.innerHTML = '<div class="mk-grid">' + ordem.map(f => {
      const nos = ((f.grafo && f.grafo.nodes) || []).filter(n => n.tipo !== 'gatilho');
      const pend = f.pendencias || [];
      const estado = pend.length ? ['inc', 'Incompleto'] : f.ativo ? ['on', 'Ligado'] : ['off', 'Desligado'];
      return `
      <div class="mk-flow ${f.ativo ? '' : 'off'}">
        <div class="mk-flow-top">
          <div style="min-width:0">
            <div class="mk-flow-name">${esc(f.nome)}</div>
            <span class="mk-estado ${estado[0]}">${estado[1]}</span>
          </div>
          <label class="toggle" title="${f.ativo ? 'Desligar este fluxo' : 'Ligar este fluxo'}">
            <input type="checkbox" ${f.ativo ? 'checked' : ''} onchange="MKUI.ativar(${f.id}, this)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        ${pend.length ? `<div class="mk-linha erro"><span>Falta terminar as mensagens: ${esc(pend.slice(0, 2).join('; '))}${pend.length > 2 ? ` e mais ${pend.length - 2}` : ''}</span></div>` : ''}
        <div class="mk-como">
          <label class="mk-como-t" for="mk-p-${f.id}">Palavras-chave</label>
          <textarea class="minput mk-ta" id="mk-p-${f.id}" rows="2" style="min-height:54px" placeholder="Ex.: promoção, cardápio, /apresentar" oninput="MKUI.palMudou(${f.id})">${esc(palavrasDe(f).join(', '))}</textarea>
          <div class="form-hint">Separe por vírgula. O fluxo é enviado quando o cliente escrever uma delas, ou quando você mesmo enviar a palavra sozinha na conversa.</div>
          ${MK.nc ? `<label class="mk-check" style="margin:9px 0 0"><input type="checkbox" id="mk-n-${f.id}" ${ehNaoCliente(f) ? 'checked' : ''} onchange="MKUI.palMudou(${f.id})"><span>Enviar também na primeira mensagem de quem ainda não é cliente</span></label>` : ''}
          <div class="mk-pal-pe" id="mk-s-${f.id}" style="display:none">
            <button class="btn bp bsm" onclick="MKUI.palSalvar(${f.id})">${f.ativo || pend.length ? 'Salvar' : 'Salvar e ligar'}</button>
            <button class="btn bg2 bsm" onclick="MKUI.recarregar()">Desfazer</button>
          </div>
        </div>
        <div class="mk-meta">${nos.length} nó(s) · executado <b>${f.execucoes}</b> vez(es)${f.ultima_execucao ? ' · última em ' + esc(f.ultima_execucao) + ' (UTC)' : ''}</div>
        <div class="mk-actions">
          <button class="btn ${pend.length ? 'bp' : 'bg2'} bsm" onclick="MKUI.editar(${f.id})">${pend.length ? 'Terminar no editor' : 'Editar mensagens'}</button>
          <button class="btn bg2 bsm" onclick="MKUI.testar(${f.id})">Testar</button>
          <button class="btn bg2 bsm" onclick="MKUI.disparar(${f.id})">Disparar</button>
        </div>
        <div class="mk-links">
          <button onclick="MKUI.duplicar(${f.id})">Duplicar</button>
          <button onclick="MKUI.exportar(${f.id}, this)">Exportar</button>
          <button class="del" onclick="MKUI.excluir(${f.id})">Excluir</button>
        </div>
      </div>`;
    }).join('') + '</div>' + htmlAvancado();
  }

  // Mostra "Salvar" no cartão só quando algo mudou nele
  function palMudou(id) {
    const f = MK.fluxos.find(x => x.id === id), pe = $('mk-s-' + id), nc = $('mk-n-' + id);
    if (!f || !pe) return;
    const mudou = lerPalavras(id).join('|') !== palavrasDe(f).join('|') || (!!nc && nc.checked !== ehNaoCliente(f));
    pe.style.display = mudou ? '' : 'none';
  }
  // Grava as palavras e a caixa "primeira mensagem" do cartão. Com algo para começar, o fluxo já fica ligado.
  async function palSalvar(id, pedirLigar) {
    const f = MK.fluxos.find(x => x.id === id);
    if (!f) return false;
    const palavras = lerPalavras(id), nc = $('mk-n-' + id), querNc = nc ? nc.checked : ehNaoCliente(f);
    const temComeco = palavras.length > 0 || querNc, pend = (f.pendencias || []).length > 0;
    if (pedirLigar && !temComeco) { toast('err', 'Escreva uma palavra-chave para este fluxo poder começar'); $('mk-p-' + id)?.focus(); return false; }
    if (pedirLigar && pend) { toast('err', 'Este fluxo está incompleto. Termine as mensagens no editor antes de ligar.'); return false; }
    const corpo = { ligar: temComeco && !pend, palavra: { on: palavras.length > 0, palavras } };
    if (nc) corpo.nao_cliente = querNc;
    try {
      const r = await req('POST', `/fluxos/${id}/inicio`, corpo);
      if (r.nao_cliente) MK.nc = r.nao_cliente;
      toast('ok', pend ? 'Palavras salvas. O fluxo liga quando as mensagens estiverem completas.'
        : temComeco ? (f.ativo ? 'Salvo. Já está valendo no WhatsApp.' : 'Fluxo ligado. Já está valendo no WhatsApp.')
        : 'Salvo. Sem palavra-chave o fluxo ficou desligado.');
    } catch (e) { toast('err', e.message); return false; }
    await carregarFluxos();
    if (MK.tab === 'fluxos') renderFluxos();
    return true;
  }
  // Botão liga/desliga do cartão
  async function ativar(id, input) {
    if (input.checked) { if (!(await palSalvar(id, true))) input.checked = false; return; }
    try { await req('POST', `/fluxos/${id}/desativar`); toast('ok', 'Fluxo desligado'); }
    catch (e) { input.checked = true; toast('err', e.message); }
    await carregarFluxos();
    renderFluxos();
  }

  // ── Opções avançadas (fechadas por padrão): o que quase nunca precisa mexer ──
  async function carregarNaoCliente() {
    try { const c = await req('GET', '/config'); MK.nc = c.nao_cliente || null; MK.mr = c.menu_robo || null; } catch (_) { MK.nc = null; MK.mr = null; }
    MK.ncRascunho = null; MK.mrRascunho = null;
  }
  function htmlAvancado() {
    if (!MK.nc && !MK.mr) return '';
    const fxNc = MK.nc && MK.nc.modo === 'fluxo' ? MK.fluxos.find(f => f.id === Number(MK.nc.fluxo)) : null;
    let nc = '';
    if (MK.nc && fxNc) {
      nc = `<div class="mk-rota"><div class="mk-rota-t"><span>Quem não é cliente e escreve de novo depois de receber "${esc(fxNc.nome)}"</span></div>
        <textarea class="minput mk-ta" id="mk-nc-resposta" maxlength="600" style="min-height:54px">${esc(MK.nc.resposta ?? '')}</textarea>
        <div class="form-hint">A equipe é avisada no WhatsApp do atendente, com a mensagem dele, e ele recebe esta resposta. Em branco, só a equipe é avisada.</div>
        <button class="btn bg2 bsm" style="margin-top:8px" onclick="MKUI.avSalvarNc()">Salvar resposta</button></div>`;
    } else if (MK.nc) {
      nc = `<div class="mk-rota"><div class="mk-rota-t"><span>Quem não é cliente e não usou nenhuma palavra-chave</span></div>
        <select class="minput" id="mk-nc-modo" onchange="MKUI.avSalvarNc()">
          <option value="menu" ${MK.nc.modo !== 'silencio' ? 'selected' : ''}>Recebe o menu do robô</option>
          <option value="silencio" ${MK.nc.modo === 'silencio' ? 'selected' : ''}>Não recebe resposta automática</option>
        </select>
        <div class="form-hint">Para ele receber um fluxo, marque a caixa "primeira mensagem" no cartão do fluxo.</div></div>`;
    }
    let mr = '';
    if (MK.mr) {
      const c = MK.mr;
      mr = `<div class="mk-rota"><div class="mk-rota-t"><span>Opção extra no menu do robô</span></div>
        <select class="minput" id="mk-mr-fluxo">
          <option value="">Não mostrar</option>
          ${MK.fluxos.map(f => `<option value="${f.id}" ${Number(c.fluxo) === f.id ? 'selected' : ''}>${esc(f.nome)}${f.ativo ? '' : ' (desligado)'}</option>`).join('')}
        </select>
        <div class="mk-row" style="margin-top:8px">
          <input class="minput" id="mk-mr-titulo" maxlength="24" placeholder="Nome da opção" value="${esc(c.titulo ?? '')}">
          <input class="minput" id="mk-mr-descricao" maxlength="72" placeholder="Descrição" value="${esc(c.descricao ?? '')}">
        </div>
        <div class="form-hint">Uma linha a mais na parte de Suporte do menu do robô, que abre o fluxo escolhido.${c.aviso ? ' ' + esc(c.aviso) : ''}</div>
        <button class="btn bg2 bsm" style="margin-top:8px" onclick="MKUI.avSalvarMr()">Salvar opção</button></div>`;
    }
    return `<details class="mk-av" ${MK.avAberto ? 'open' : ''} ontoggle="MKUI.avToggle(this.open)">
        <summary>Opções avançadas</summary>
        <div class="mk-rotas">${nc}${mr}</div>
      </details>`;
  }
  async function avSalvarNc() {
    const corpo = {};
    if ($('mk-nc-resposta')) corpo.resposta = $('mk-nc-resposta').value;
    if ($('mk-nc-modo')) corpo.modo = $('mk-nc-modo').value;
    try { MK.nc = (await req('POST', '/config', { nao_cliente: corpo })).nao_cliente; toast('ok', 'Salvo'); }
    catch (e) { toast('err', e.message); }
    if (MK.tab === 'fluxos') renderFluxos();
  }
  async function avSalvarMr() {
    try {
      MK.mr = (await req('POST', '/config', { ligar: true, menu_robo: { fluxo: parseInt($('mk-mr-fluxo').value, 10) || null, titulo: $('mk-mr-titulo').value, descricao: $('mk-mr-descricao').value } })).menu_robo;
      toast('ok', 'Salvo');
    } catch (e) { toast('err', e.message); }
    await carregarFluxos();
    if (MK.tab === 'fluxos') renderFluxos();
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
    const origem = { palavra: 'Palavra-chave', botao: 'Clique em botão', disparo: 'Disparo', teste: 'Teste', resposta: 'Resposta do cliente', tempo_limite: 'Sem resposta (tempo)', meu_envio: 'Digitado por mim', boas_vindas: 'Mensagem de quem não é cliente' };
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
  // /publi: você digita na conversa; vai o vídeo + texto com os botões Saber mais e Bloquear
  const publi = () => {
    const d = novoDraft();
    d.nome = 'Comando /publi';
    d.gatilho = { tipo: 'palavra', palavras: ['/publi'], modo: 'exata', publico: 'todos' };
    d.opcoes = { presenca: true, ignorar_pausa: true, pausar_robo: false, aceita_meu_envio: true, cooldown: 15 };
    d.grafo = G([
      { id: 'n1', tipo: 'video', x: 380, y: 140, cfg: { midia: '', nome: '', legenda: '' } },
      { id: 'n2', tipo: 'botoes', x: 740, y: 140, cfg: { texto: '{{saudacao}}, {{primeiro_nome|tudo bem}}! 👋\n\nSua loja ainda perde pedido no WhatsApp por demora pra responder?\n\nCom o *Estima Food*, a inteligência artificial atende seus clientes 24 horas, entende texto e áudio, monta o pedido e manda direto pro seu painel, com a comanda já impressa.\n\nQuer saber como funciona na sua loja?', rodape: 'Estima Food', midia: '', nome: '', botoes: [{ tipo: 'resposta', titulo: 'Saber mais', valor: 'saber mais' }, { tipo: 'resposta', titulo: 'Bloquear', valor: 'bloquear' }] } },
      { id: 'n3', tipo: 'vendas', x: 1120, y: 40, cfg: { texto: 'Que bom que você quer saber mais! 🙌\nPara eu te mostrar como o *Estima Food* funciona no seu negócio, me conta: qual é o seu *tipo de estabelecimento*?' } },
      { id: 'n4', tipo: 'texto', x: 1120, y: 320, cfg: { texto: 'Tudo bem, obrigado pelo contato! 🙏 Você não vai mais receber nossas mensagens.' } },
      { id: 'n5', tipo: 'bloquear', x: 1480, y: 320, cfg: {} }
    ], [
      { de: 'inicio', porta: 'out', para: 'n1' }, { de: 'n1', porta: 'out', para: 'n2' },
      { de: 'n2', porta: 'b0', para: 'n3' }, { de: 'n2', porta: 'b1', para: 'n4' }, { de: 'n4', porta: 'out', para: 'n5' }
    ]);
    return d;
  };
  const MODELOS = [
    ['Comando /publi (vídeo, Saber mais e Bloquear)', 'Você digita /publi na conversa e vai o vídeo com o texto da propaganda. "Saber mais" começa o atendimento de vendas (tipo de estabelecimento, nome e telefone). "Bloquear" agradece e coloca o contato na lista negra.', publi],
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


  // ═══ IMPORTAR / EXPORTAR ═══════════════════════════════
  // Pacote de fluxo: um .zip com "fluxo.json" na raiz e as mídias em "midias/".
  // Também aceita o .json solto, escolhido junto com os arquivos de mídia.
  // fluxo.json = { formato, versao, fluxo:{nome,gatilho,opcoes,grafo}, midias:[{arquivo,nome,tipo}], parametros:[{chave,rotulo,...}] }
  // Nos textos e links do fluxo, {{param:chave}} é trocado pelo valor informado na importação.
  const FORMATO = 'estimafood-fluxo';
  const ARQ_HASH = /^[a-f0-9]{16}\.[a-z0-9]{2,5}$/;
  const EXT_TIPO = { jpg: 'imagem', jpeg: 'imagem', png: 'imagem', webp: 'imagem', mp4: 'video', mov: 'video', '3gp': 'video', webm: 'video', ogg: 'audio', opus: 'audio', mp3: 'audio', m4a: 'audio', aac: 'audio', wav: 'audio' };
  const IMP = { itens: [], pacote: null, faltando: [], erro: '', ocupado: false, criado: null };

  const base = n => String(n || '').split(/[\\/]/).pop();
  const extDe = n => (/\.([a-z0-9]+)$/i.exec(String(n || '')) || [])[1]?.toLowerCase() || '';
  const tipoDaMidia = (nome, tipo) => ['imagem', 'video', 'audio', 'documento'].includes(tipo) ? tipo : (EXT_TIPO[extDe(nome)] || 'documento');
  const mb = b => b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

  // Percorre todos os textos de um objeto (profundo), trocando cada um por fn(texto)
  function trocarTextos(v, fn) {
    if (typeof v === 'string') return fn(v);
    if (Array.isArray(v)) return v.map(x => trocarTextos(x, fn));
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = trocarTextos(v[k], fn); return o; }
    return v;
  }
  function textosDe(v, out = []) {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(x => textosDe(x, out));
    else if (v && typeof v === 'object') Object.values(v).forEach(x => textosDe(x, out));
    return out;
  }

  // ── Leitura de .zip sem biblioteca (arquivos sem compressão ou com deflate) ──
  async function lerZip(file) {
    const fim = new DataView(await file.slice(Math.max(0, file.size - 66000)).arrayBuffer());
    let p = -1;
    for (let i = fim.byteLength - 22; i >= 0; i--) if (fim.getUint32(i, true) === 0x06054b50) { p = i; break; }
    if (p < 0) throw new Error(`"${file.name}" não é um arquivo .zip válido`);
    const total = fim.getUint16(p + 10, true), cdTam = fim.getUint32(p + 12, true), cdPos = fim.getUint32(p + 16, true);
    if (cdPos === 0xFFFFFFFF || total === 0xFFFF) throw new Error('Pacote grande demais para importar por aqui');
    const cd = new DataView(await file.slice(cdPos, cdPos + cdTam).arrayBuffer());
    const dec = new TextDecoder('utf-8');
    const itens = [];
    let o = 0;
    for (let n = 0; n < total && o + 46 <= cd.byteLength; n++) {
      if (cd.getUint32(o, true) !== 0x02014b50) break;
      const metodo = cd.getUint16(o + 10, true), comp = cd.getUint32(o + 20, true), real = cd.getUint32(o + 24, true);
      const nl = cd.getUint16(o + 28, true), el = cd.getUint16(o + 30, true), cl = cd.getUint16(o + 32, true), pos = cd.getUint32(o + 42, true);
      const caminho = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + o + 46, nl));
      o += 46 + nl + el + cl;
      if (!caminho || caminho.endsWith('/') || /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$)/.test(caminho)) continue;
      itens.push({
        nome: base(caminho), caminho, tamanho: real,
        abrir: async () => {
          const lh = new DataView(await file.slice(pos, pos + 30).arrayBuffer());
          if (lh.byteLength < 30 || lh.getUint32(0, true) !== 0x04034b50) throw new Error(`Não consegui ler "${base(caminho)}" dentro do pacote`);
          const ini = pos + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
          const bruto = file.slice(ini, ini + comp);
          if (metodo === 0) return bruto;
          if (metodo === 8 && typeof DecompressionStream === 'function') return new Response(bruto.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
          throw new Error('Este navegador não abre pacote compactado. Extraia o .zip e selecione o .json junto com as mídias.');
        }
      });
    }
    return itens;
  }

  // ── Escrita de .zip sem compressão (vídeo e imagem já são comprimidos) ──
  let _crcTab;
  function crc32(u8) {
    if (!_crcTab) { _crcTab = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; _crcTab[n] = c >>> 0; } }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = _crcTab[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function montarZip(arquivos) { // [{ caminho, dados: Uint8Array }]
    const enc = new TextEncoder(), partes = [], central = [];
    const d = new Date();
    const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let pos = 0;
    for (const a of arquivos) {
      const nome = enc.encode(a.caminho), crc = crc32(a.dados), tam = a.dados.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, hora, true); lh.setUint16(12, dia, true); lh.setUint32(14, crc, true); lh.setUint32(18, tam, true); lh.setUint32(22, tam, true);
      lh.setUint16(26, nome.length, true); lh.setUint16(28, 0, true);
      partes.push(lh, nome, a.dados);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, hora, true); ch.setUint16(14, dia, true); ch.setUint32(16, crc, true); ch.setUint32(20, tam, true); ch.setUint32(24, tam, true);
      ch.setUint16(28, nome.length, true); ch.setUint32(42, pos, true);
      central.push(ch, nome);
      pos += 30 + nome.length + tam;
    }
    const cdTam = central.reduce((n, x) => n + x.byteLength, 0);
    const fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
    fim.setUint32(12, cdTam, true); fim.setUint32(16, pos, true);
    return new Blob([...partes, ...central, fim], { type: 'application/zip' });
  }
  function baixar(blob, nome) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  // ── Exportar: gera o pacote do fluxo (json + mídias) para importar em outro painel ──
  async function exportar(id, btn) {
    const f = MK.fluxos.find(x => x.id === id);
    if (!f || (btn && btn.disabled)) return;
    const rotulo = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Exportando...'; }
    try {
      const grafo = JSON.parse(JSON.stringify(f.grafo || { nodes: [], edges: [] }));
      // mídias guardadas no servidor que o fluxo usa (links http ficam como estão)
      const midias = [], vistos = new Set(), nomes = new Set();
      const anotar = (o, tipo) => {
        const arq = String(o && o.midia || '');
        if (!ARQ_HASH.test(arq) || vistos.has(arq)) return;
        vistos.add(arq);
        let nome = base(o.nome) || arq;
        if (extDe(nome) !== extDe(arq)) nome = nome.replace(/\.[a-z0-9]+$/i, '') + '.' + extDe(arq);
        for (let k = 2; nomes.has(nome.toLowerCase()); k++) nome = nome.replace(/(-\d+)?(\.[a-z0-9]+)$/i, `-${k}$2`);
        nomes.add(nome.toLowerCase());
        midias.push({ arquivo: arq, nome, tipo: tipoDaMidia(arq, tipo) });
      };
      for (const n of grafo.nodes) {
        const c = n.cfg || {};
        if (['imagem', 'video', 'audio', 'documento'].includes(n.tipo)) anotar(c, n.tipo);
        if (n.tipo === 'botoes') anotar(c, 'imagem');
        if (n.tipo === 'carrossel') (c.cartoes || []).forEach(k => anotar(k, 'imagem'));
      }
      const arquivos = [], semArquivo = [];
      for (const m of midias) {
        const r = await fetch('/api/admin/marketing/midia/' + m.arquivo, { headers: adminAuthHeader() });
        if (!r.ok) { semArquivo.push(m.nome); continue; }
        const dados = new Uint8Array(await r.arrayBuffer());
        m.bytes = dados.length;
        arquivos.push({ caminho: 'midias/' + m.nome, dados });
      }
      const pacote = {
        formato: FORMATO, versao: 1, exportado_em: new Date().toISOString(),
        fluxo: { nome: f.nome, gatilho: f.gatilho, opcoes: f.opcoes, grafo },
        midias: midias.filter(m => m.bytes), parametros: []
      };
      const json = new TextEncoder().encode(JSON.stringify(pacote, null, 2));
      const slug = String(f.nome).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'fluxo';
      if (arquivos.length) baixar(montarZip([{ caminho: 'fluxo.json', dados: json }, ...arquivos]), `fluxo-${slug}.zip`);
      else baixar(new Blob([json], { type: 'application/json' }), `fluxo-${slug}.json`);
      if (semArquivo.length) toast('err', `Exportado sem ${semArquivo.length} mídia(s) que não estão mais no servidor: ${semArquivo.join(', ')}`);
      else toast('ok', arquivos.length ? `Fluxo exportado com ${arquivos.length} mídia(s)` : 'Fluxo exportado');
    } catch (e) { toast('err', 'Não consegui exportar: ' + e.message); }
    if (btn) { btn.disabled = false; btn.textContent = rotulo; }
  }

  // ── Importar ───────────────────────────────────────
  function importar() {
    if (IMP.ocupado) return;
    Object.assign(IMP, { itens: [], pacote: null, faltando: [], erro: '', criado: null });
    renderImportar();
  }

  function soltar(ev, sobre) {
    ev.preventDefault();
    const el = $('mk-imp-drop');
    if (el) el.classList.toggle('sobre', !!sobre);
    if (sobre === false && ev.type === 'drop' && ev.dataTransfer) impArquivos(ev.dataTransfer.files);
  }

  async function impArquivos(lista) {
    if (IMP.ocupado) return;
    IMP.erro = '';
    try {
      for (const file of Array.from(lista || [])) {
        const novos = /\.zip$/i.test(file.name) ? await lerZip(file) : [{ nome: file.name, caminho: file.name, tamanho: file.size, abrir: async () => file }];
        for (const it of novos) {
          IMP.itens = IMP.itens.filter(x => x.nome.toLowerCase() !== it.nome.toLowerCase());
          IMP.itens.push(it);
        }
      }
      await analisarPacote();
    } catch (e) { IMP.erro = e.message; }
    renderImportar();
  }

  // Acha o .json do fluxo entre os arquivos escolhidos e confere quais mídias vieram junto
  async function analisarPacote() {
    const jsons = IMP.itens.filter(x => /\.json$/i.test(x.nome));
    let achado = null;
    for (const it of jsons.sort((a, b) => (b.nome.toLowerCase() === 'fluxo.json') - (a.nome.toLowerCase() === 'fluxo.json'))) {
      let d = null;
      try { d = JSON.parse(await (await it.abrir()).text()); } catch (_) { continue; }
      const fx = d && d.formato === FORMATO ? d.fluxo : (d && d.grafo && Array.isArray(d.grafo.nodes) ? d : null); // também aceita o fluxo "puro"
      if (!fx || !fx.grafo || !Array.isArray(fx.grafo.nodes)) continue;
      if (achado) throw new Error('Há mais de um fluxo entre os arquivos. Importe um fluxo por vez.');
      achado = {
        origem: it.nome,
        fluxo: { nome: String(fx.nome || '').trim() || 'Fluxo importado', gatilho: fx.gatilho || {}, opcoes: fx.opcoes || {}, grafo: fx.grafo },
        midias: (d.formato === FORMATO && Array.isArray(d.midias) ? d.midias : []).filter(m => m && ARQ_HASH.test(String(m.arquivo || '')))
          .map(m => ({ arquivo: String(m.arquivo), nome: base(m.nome) || String(m.arquivo), tipo: tipoDaMidia(m.nome || m.arquivo, m.tipo) })),
        parametros: (d.formato === FORMATO && Array.isArray(d.parametros) ? d.parametros : []).filter(q => q && /^[a-z][a-z0-9_]{0,29}$/i.test(String(q.chave || ''))).slice(0, 8),
        descricao: d.formato === FORMATO ? String(d.descricao || '') : ''
      };
    }
    const antes = IMP.pacote;
    IMP.pacote = achado;
    IMP.faltando = [];
    if (!achado) {
      if (IMP.itens.length) IMP.erro = jsons.length ? 'O arquivo .json escolhido não é um fluxo do Marketing.' : 'Não encontrei o arquivo do fluxo (.json). Selecione o pacote .zip, ou o .json junto com as mídias.';
      return;
    }
    // valores já digitados continuam quando a pessoa só acrescenta arquivos
    achado.valores = antes && antes.origem === achado.origem ? antes.valores : {};
    achado.nomeEditado = antes && antes.origem === achado.origem ? antes.nomeEditado : null;
    const porNome = new Map(IMP.itens.map(x => [x.nome.toLowerCase(), x]));
    const noManifesto = new Set(achado.midias.map(m => m.arquivo));
    for (const m of achado.midias) {
      m.item = porNome.get(m.nome.toLowerCase()) || porNome.get(m.arquivo.toLowerCase()) || null;
      if (!m.item) IMP.faltando.push(m.nome);
    }
    // arquivo citado no fluxo, mas fora da lista de mídias do pacote: tenta achar pelo próprio nome
    for (const t of new Set(textosDe(achado.fluxo.grafo).filter(x => ARQ_HASH.test(x)))) {
      if (noManifesto.has(t)) continue;
      const item = porNome.get(t.toLowerCase()) || null;
      achado.midias.push({ arquivo: t, nome: t, tipo: tipoDaMidia(t), item });
      if (!item) IMP.faltando.push(t);
    }
    // sugestão para o endereço do site: o que estiver cadastrado em Site > Geral
    if (achado.parametros.some(q => q.chave === 'site') && achado.valores.site === undefined) {
      try {
        const r = await fetch('/api/admin/site', { headers: adminAuthHeader() });
        const u = r.ok ? String((await r.json())?.conteudo?.geral?.url_site || '').trim() : '';
        if (u) achado.valores.site = u;
      } catch (_) {}
    }
  }

  function renderImportar() {
    const pc = IMP.pacote;
    const cab = `<div class="mk-box-head"><div class="mk-box-title">Importar fluxo</div><button class="mk-mini" onclick="MKUI.impFechar()">×</button></div>`;
    const drop = (titulo, sub) => `
      <label class="mk-drop" id="mk-imp-drop" ondragover="MKUI.impSoltar(event,true)" ondragleave="MKUI.impSoltar(event)" ondrop="MKUI.impSoltar(event,false)">
        <input type="file" multiple accept=".zip,.json,video/*,image/*,audio/*,.pdf" onchange="MKUI.impArquivos(this.files);this.value=''">
        <b>${titulo}</b>${sub}
      </label>`;
    const erro = IMP.erro ? `<div class="mk-alert erro" style="margin:12px 0 0">${esc(IMP.erro)}</div>` : '';

    if (IMP.criado) {
      const f = IMP.criado;
      abrirSmall(`${cab}
        <div class="mk-box-body">
          <div class="mk-meta" style="font-size:13px"><b>${esc(f.nome)}</b> foi importado e está <b>desativado</b>.</div>
          <div class="form-hint" style="margin-top:8px">Mande um teste para o seu WhatsApp, confira as mensagens e depois ligue a chave do fluxo na lista para ele começar a responder os clientes.</div>
        </div>
        <div class="mk-box-foot">
          <button class="btn bg2" onclick="MKUI.impFechar()">Fechar</button>
          <button class="btn bg2" onclick="MKUI.impFechar();MKUI.editar(${f.id})">Abrir no editor</button>
          <button class="btn bp" onclick="MKUI.impFechar();MKUI.testar(${f.id})">Enviar teste</button>
        </div>`);
      return;
    }

    if (!pc) {
      abrirSmall(`${cab}
        <div class="mk-box-body">
          ${drop('Escolher o arquivo do fluxo', 'Selecione o pacote <b style="display:inline;font-size:inherit">.zip</b> do fluxo. Se você tem o .json e as mídias soltos, selecione todos de uma vez.')}
          ${erro}
          <div class="form-hint" style="margin-top:12px">O fluxo entra desativado, com os vídeos e as imagens dele. Você confere, testa e só então ativa.</div>
        </div>
        <div class="mk-box-foot"><button class="btn bg2" onclick="MKUI.impFechar()">Cancelar</button></div>`);
      return;
    }

    const nos = (pc.fluxo.grafo.nodes || []).filter(n => n && n.id !== 'inicio' && n.tipo !== 'gatilho');
    const tipos = [...new Set(nos.map(n => TIPO_NOME[n.tipo]).filter(Boolean))];
    const comArquivo = pc.midias.filter(m => m.item);
    const peso = comArquivo.reduce((n, m) => n + (m.item.tamanho || 0), 0);
    const jaExiste = MK.fluxos.some(x => x.nome.trim().toLowerCase() === (pc.nomeEditado ?? pc.fluxo.nome).trim().toLowerCase());
    const chama = nos.some(n => n.tipo === 'chamar_fluxo');
    const params = pc.parametros.map(q => `
      <div class="form-group"><label class="form-label">${esc(q.rotulo || q.chave)}</label>
        <input class="minput" id="mk-imp-p-${esc(q.chave)}" data-chave="${esc(q.chave)}" placeholder="${esc(q.exemplo || '')}" value="${esc(pc.valores[q.chave] ?? q.padrao ?? '')}" oninput="MKUI.impValor(this)">
        ${q.ajuda ? `<div class="form-hint">${esc(q.ajuda)}</div>` : ''}</div>`).join('');
    const avisos = [];
    if (IMP.faltando.length) avisos.push(`<div class="mk-alert erro" style="margin:0 0 12px"><b>Faltam ${IMP.faltando.length} arquivo(s) de mídia</b> deste fluxo. Adicione os arquivos abaixo para continuar:<ul class="mk-imp-lista">${IMP.faltando.slice(0, 30).map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>`);
    if (chama) avisos.push('<div class="mk-alert" style="margin:0 0 12px">Este fluxo chama outro fluxo. Depois de importar, abra no editor e escolha o fluxo de destino no nó "Outro fluxo".</div>');
    if (jaExiste) avisos.push('<div class="mk-alert" style="margin:0 0 12px">Já existe um fluxo com este nome. O importado entra como um fluxo separado; troque o nome se quiser diferenciar.</div>');

    abrirSmall(`${cab}
      <div class="mk-box-body">
        <div class="form-group"><label class="form-label">Nome do fluxo</label>
          <input class="minput" id="mk-imp-nome" maxlength="80" value="${esc(pc.nomeEditado ?? pc.fluxo.nome)}" oninput="MKUI.impValor(this)"></div>
        ${pc.descricao ? `<div class="form-hint" style="margin:-4px 0 12px">${esc(pc.descricao)}</div>` : ''}
        <dl class="mk-imp-resumo">
          <dt>Gatilho</dt><dd>${resumoGatilho(pc.fluxo)}</dd>
          <dt>Conteúdo</dt><dd>${nos.length} nó(s)${tipos.length ? ': ' + tipos.map(esc).join(', ') : ''}</dd>
          <dt>Mídias</dt><dd>${pc.midias.length ? `${comArquivo.length} de ${pc.midias.length} arquivo(s) prontos para enviar (${mb(peso)})` : 'Este fluxo não usa arquivos de mídia'}</dd>
        </dl>
        ${params}
        ${avisos.join('')}
        ${IMP.faltando.length ? drop('Adicionar os arquivos que faltam', 'Selecione os vídeos e as imagens que vieram com o fluxo.') : ''}
        ${erro}
        <div class="mk-imp-prog" id="mk-imp-prog" style="display:none"><span id="mk-imp-prog-txt"></span><div class="mk-bar"><i id="mk-imp-prog-bar" style="width:0%"></i></div></div>
      </div>
      <div class="mk-box-foot">
        <button class="btn bg2" id="mk-imp-cancelar" onclick="MKUI.impFechar()">Cancelar</button>
        <button class="btn bg2" id="mk-imp-trocar" onclick="MKUI.importar()">Escolher outro arquivo</button>
        <button class="btn bp" id="mk-imp-ok" onclick="MKUI.impConfirmar()" ${IMP.faltando.length ? 'disabled' : ''}>Importar fluxo</button>
      </div>`);
  }

  function impValor(input) {
    if (!IMP.pacote) return;
    if (input.id === 'mk-imp-nome') IMP.pacote.nomeEditado = input.value;
    else if (input.dataset.chave) IMP.pacote.valores[input.dataset.chave] = input.value;
  }
  function impFechar() {
    if (IMP.ocupado) return;
    fecharSmall();
  }

  // Envia um arquivo de mídia cru para o servidor (com progresso)
  function enviarMidia(blob, nome, tipo, progresso) {
    return new Promise((ok, no) => {
      const x = new XMLHttpRequest();
      x.open('POST', '/api/admin/marketing/midia?tipo=' + encodeURIComponent(tipo) + '&nome=' + encodeURIComponent(nome));
      const h = adminAuthHeader();
      Object.keys(h).forEach(k => { if (k.toLowerCase() !== 'content-type') x.setRequestHeader(k, h[k]); });
      x.setRequestHeader('Content-Type', 'application/octet-stream');
      x.timeout = 300000;
      x.upload.onprogress = ev => { if (ev.lengthComputable && progresso) progresso(ev.loaded / ev.total); };
      x.onload = () => {
        let d = {}; try { d = JSON.parse(x.responseText); } catch (_) {}
        if (x.status === 401) { setTimeout(doLogout, 1500); return no(new Error('Sessão expirada')); }
        if (x.status >= 200 && x.status < 300 && d.arquivo) return ok(d);
        no(new Error(d.error || 'HTTP ' + x.status));
      };
      x.onerror = () => no(new Error('sem conexão com o servidor'));
      x.ontimeout = () => no(new Error('o envio demorou demais'));
      x.send(blob);
    });
  }

  async function impConfirmar() {
    const pc = IMP.pacote;
    if (!pc || IMP.ocupado || IMP.faltando.length) return;
    const falha = msg => { IMP.erro = msg; renderImportar(); };
    const nome = String(pc.nomeEditado ?? pc.fluxo.nome).trim();
    if (!nome) return falha('Dê um nome para o fluxo.');

    // parâmetros do fluxo (ex.: endereço do site)
    const valores = {};
    for (const q of pc.parametros) {
      let v = String(pc.valores[q.chave] ?? q.padrao ?? '').trim();
      if (q.tipo === 'url' && v) {
        if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
        v = v.replace(/\/+$/, '');
        if (!/^https?:\/\/[^\s/]+\.[^\s/]+\S*$/i.test(v)) return falha(`"${q.rotulo || q.chave}" precisa ser um endereço válido, por exemplo ${q.exemplo || 'https://www.seusite.com.br'}.`);
      }
      if (!v && q.obrigatorio !== false) return falha(`Preencha "${q.rotulo || q.chave}".`);
      valores[q.chave] = v; pc.valores[q.chave] = v;
    }

    IMP.ocupado = true; IMP.erro = '';
    ['mk-imp-ok', 'mk-imp-cancelar', 'mk-imp-trocar'].forEach(i => { const b = $(i); if (b) b.disabled = true; });
    document.querySelectorAll('#mk-small-box input').forEach(i => { i.disabled = true; });
    const prog = (txt, fr) => {
      const w = $('mk-imp-prog'); if (!w) return;
      w.style.display = ''; $('mk-imp-prog-txt').textContent = txt; $('mk-imp-prog-bar').style.width = Math.round(Math.min(1, fr) * 100) + '%';
    };
    const enviados = [];
    try {
      const mapa = new Map();
      const lista = pc.midias.filter(m => m.item);
      const pesoTotal = lista.reduce((n, m) => n + (m.item.tamanho || 1), 0) || 1;
      let feito = 0;
      for (let i = 0; i < lista.length; i++) {
        const m = lista[i], rot = `Enviando mídia ${i + 1} de ${lista.length}: ${m.nome}`;
        prog(rot, feito / pesoTotal);
        let r;
        try {
          const blob = await m.item.abrir();
          r = await enviarMidia(blob, m.nome, m.tipo, fr => prog(rot, (feito + fr * (m.item.tamanho || 1)) / pesoTotal));
        } catch (e) { throw new Error(`Não consegui enviar "${m.nome}": ${e.message}`); }
        enviados.push(r.arquivo);
        mapa.set(m.arquivo, r.arquivo);
        feito += m.item.tamanho || 1;
      }
      prog('Criando o fluxo...', 1);
      const grafo = trocarTextos(pc.fluxo.grafo, t => {
        if (mapa.has(t)) return mapa.get(t);
        return t.replace(/\{\{\s*param:([a-z][a-z0-9_]*)\s*\}\}/gi, (tudo, k) => valores[k] !== undefined ? valores[k] : tudo);
      });
      // "Outro fluxo" aponta para um id que só existe no painel de origem
      for (const n of grafo.nodes) if (n && n.tipo === 'chamar_fluxo' && n.cfg) n.cfg.fluxo = null;
      const r = await req('POST', '/fluxos', { nome, gatilho: pc.fluxo.gatilho, opcoes: pc.fluxo.opcoes, grafo });
      IMP.ocupado = false;
      IMP.criado = r.fluxo;
      await carregarFluxos();
      if (MK.tab !== 'fluxos') aba('fluxos'); else renderFluxos();
      toast('ok', 'Fluxo importado (fica desativado até você ativar)');
      renderImportar();
    } catch (e) {
      IMP.ocupado = false;
      // não deixa arquivo órfão no servidor (só apaga o que nenhum fluxo usa)
      if (enviados.length) req('POST', '/midia/excluir', { arquivos: enviados }).catch(() => {});
      falha(e.message);
    }
  }

  // ── API publica da aba ─────────────────────────────
  window.MKUI = {
    init, aba, novo, modelo, editar, ativar, duplicar, excluir, bloquearNumero, desbloquearNumero,
    testar, enviarTeste, disparar, dispPub, dispPrevia, confirmarDisparo, disp, fecharSmall,
    req, fluxos: () => MK.fluxos, recarregar,
    importar, exportar, impArquivos, impSoltar: soltar, impValor, impFechar, impConfirmar,
    palMudou, palSalvar, avSalvarNc, avSalvarMr, avToggle: aberto => { MK.avAberto = !!aberto; }
  };
})();

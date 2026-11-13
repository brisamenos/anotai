// ═══════════════════════════════════════
// SERVIDOR DE AUTOMAÇÕES 24/7
// ═══════════════════════════════════════
async function salvarWaServerUrl() {
  const url = (document.getElementById('wa-server-url')?.value || '').replace(/\/$/,'');
  WA_SERVER = url;
  try { await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, wa_server_url: url }); } catch(e){}
}

async function testarServidorWA() {
  const url = (document.getElementById('wa-server-url')?.value || '').replace(/\/$/,'');
  if (!url) { sbToast('err','Informe a URL do servidor'); return; }
  WA_SERVER = url;
  const dot = document.getElementById('wa-sdot');
  const txt = document.getElementById('wa-stxt');
  const box = document.getElementById('wa-server-status');
  if (dot) dot.style.background = 'var(--accent3)';
  if (txt) txt.textContent = 'Testando...';
  try {
    const r = await fetch(`${url}/status`, { signal: AbortSignal.timeout(5000) });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.ok) {
      if (dot) dot.style.background = 'var(--success)';
      if (txt) txt.textContent = 'Online';
      if (box) { box.style.borderColor = 'rgba(34,197,94,.3)'; box.style.color = 'var(--success)'; }
      sbToast('ok', 'Servidor online! Automações 24/7 ativas.');
      await salvarWaServerUrl();
    } else {
      if (dot) dot.style.background = 'var(--danger)';
      if (txt) txt.textContent = 'Erro';
      sbToast('err', 'Servidor respondeu com erro');
    }
  } catch(e) {
    if (dot) dot.style.background = 'var(--danger)';
    if (txt) txt.textContent = 'Offline';
    if (box) box.style.borderColor = 'rgba(239,68,68,.3)';
    sbToast('err', 'Servidor não alcançado: ' + e.message);
  }
}

async function carregarWaServerUrl() {
  try {
    const { data } = await sb.from('store_config').select('wa_server_url').single();
    if (data?.wa_server_url) {
      WA_SERVER = data.wa_server_url;
      const el = document.getElementById('wa-server-url');
      if (el) el.value = data.wa_server_url;
      try {
        const r = await fetch(`${WA_SERVER}/status`, { signal: AbortSignal.timeout(3000) });
        const d = await r.json().catch(() => ({}));
        const dot = document.getElementById('wa-sdot');
        const txt = document.getElementById('wa-stxt');
        const box = document.getElementById('wa-server-status');
        if (r.ok && d.ok) {
          if (dot) dot.style.background = 'var(--success)';
          if (txt) txt.textContent = 'Online';
          if (box) { box.style.borderColor = 'rgba(34,197,94,.3)'; box.style.color = 'var(--success)'; }
        } else {
          if (dot) dot.style.background = 'var(--danger)';
          if (txt) txt.textContent = 'Offline';
        }
      } catch(e) {
        const dot = document.getElementById('wa-sdot');
        const txt = document.getElementById('wa-stxt');
        if (dot) dot.style.background = 'var(--danger)';
        if (txt) txt.textContent = 'Offline';
      }
    }
  } catch(e){}
}

// ═══════════════════════════════════════
// EVOLUTION API — proxy via servidor
// (API key nunca fica exposta no browser)
// ═══════════════════════════════════════
const EVO = {
  get instance(){ return (document.getElementById('evo-instance')?.value||'').trim(); },

  // Chama o proxy do servidor em /api/evo/*
  async req(method, path, body) {
    try {
      const tid = _sessao?.tenant_id || '';
      const r = await fetch(`/api/evo${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await r.json().catch(() => ({}));
      console.log(`[EVO proxy] ${method} ${path}`, r.status, data);
      return { ok: r.ok, status: r.status, data };
    } catch(e) {
      console.error('[EVO proxy] fetch error:', e);
      return { ok: false, error: e.message };
    }
  },

  async sendText(number, text) {
    const phone = number.replace(/\D/g,'');
    const num   = phone.startsWith('55') ? phone : `55${phone}`;
    const r = await this.req('POST', '/message/sendText/' + this.instance, { number: num, text });
    return r;
  }
};

// WhatsApp da loja via WuzAPI — alternativa mais leve à Evolution (mesmo formato de retorno do EVO.req,
// pra reusar a UI e o wa-chat.js sem duplicar lógica de exibição).
const WUZ = {
  async req(method, path, body) {
    try {
      const tid = _sessao?.tenant_id || '';
      const r = await fetch(`/api/tenant-wa${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await r.json().catch(() => ({}));
      console.log(`[WUZ] ${method} ${path}`, r.status, data);
      return { ok: r.ok, status: r.status, data };
    } catch(e) {
      console.error('[WUZ] fetch error:', e);
      return { ok: false, error: e.message };
    }
  },
  async sendText(number, text) {
    return this.req('POST', '/send', { phone: number.replace(/\D/g,''), text });
  }
};

let evoMsgHistory = [];
let evoConnected  = false;
let evoQrInterval = null;
let wuzConnected  = false;
let wuzQrInterval = null;

// ── Conexão do WhatsApp da loja ─────────────────────────
// Para o gestor existe uma conexão só, chamada "WhatsApp". Por trás há duas
// formas de conectar (a antiga e a nova); a escolha entre elas não aparece
// mais na tela:
//  · loja já na conexão nova           → mostra a conexão nova
//  · loja conectada pela antiga        → continua nela, só com o estado "conectado"
//  · loja na antiga, mas desconectada  → mostra a conexão nova; a troca só é
//    gravada quando o gestor clica em "Conectar WhatsApp"
//  · servidor sem a conexão nova       → mostra a antiga, com o nome da conexão
let _waProvider = null;          // 'wuzapi' | 'evolution' (o que está gravado no servidor)
let _waTrocarAoConectar = false; // true = gravar a conexão nova no primeiro "Conectar"
let _waJaConectou = false;       // a loja já tinha montado a conexão (caiu depois)

// ── Faixa "WhatsApp desconectado" ───────────────────────
// Aparece no topo do gestor, em qualquer tela, quando o WhatsApp da loja
// caiu. "Conectar agora" leva direto ao QR Code; "Depois" esconde por 1h.
// Some sozinha quando reconecta (o status é conferido a cada 30s).
function _waBarraChave() { return 'estima_wa_barra_' + (_sessao?.tenant_id || ''); }
function _waBarraDesconectado(mostrar) {
  let el = document.getElementById('wa-barra-off');
  if (!mostrar) { if (el) el.remove(); return; }
  try { const ate = Number(localStorage.getItem(_waBarraChave()) || 0); if (ate > Date.now()) { if (el) el.remove(); return; } } catch (e) {}
  if (el) return;
  if (!document.getElementById('wa-barra-off-css')) {
    const st = document.createElement('style');
    st.id = 'wa-barra-off-css';
    st.textContent = `
#wa-barra-off{position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:9000;width:min(720px,calc(100vw - 24px));display:flex;align-items:center;gap:14px;padding:12px 14px 12px 16px;border-radius:14px;background:#fff7ed;border:1px solid #fdba74;color:#7c2d12;box-shadow:0 10px 30px rgba(0,0,0,.14)}
#wa-barra-off .wbo-ic{width:36px;height:36px;border-radius:10px;background:#ffedd5;color:#c2410c;display:flex;align-items:center;justify-content:center;flex-shrink:0}
#wa-barra-off .wbo-tx{flex:1;min-width:0;font-size:13px;line-height:1.4}
#wa-barra-off .wbo-tx strong{display:block;font-size:14px;color:#7c2d12}
#wa-barra-off .wbo-bt{display:flex;gap:8px;flex-shrink:0}
#wa-barra-off button{border:0;border-radius:10px;font:inherit;font-size:13px;font-weight:700;padding:9px 14px;cursor:pointer;white-space:nowrap}
#wa-barra-off .wbo-ok{background:#16a34a;color:#fff}
#wa-barra-off .wbo-depois{background:transparent;color:#9a3412}
#wa-barra-off button:focus-visible{outline:2px solid #c2410c;outline-offset:2px}
@media(max-width:600px){#wa-barra-off{top:58px;flex-wrap:wrap;gap:10px}#wa-barra-off .wbo-bt{width:100%}#wa-barra-off .wbo-ok{flex:1}}`;
    document.head.appendChild(st);
  }
  el = document.createElement('div');
  el.id = 'wa-barra-off';
  el.setAttribute('role', 'alert');
  el.innerHTML = `<div class="wbo-ic" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg></div>
    <div class="wbo-tx"><strong>Seu WhatsApp está desconectado</strong>As mensagens automáticas e o robô não estão chegando aos clientes.</div>
    <div class="wbo-bt"><button type="button" class="wbo-depois">Depois</button><button type="button" class="wbo-ok">Conectar agora</button></div>`;
  el.querySelector('.wbo-depois').onclick = () => {
    try { localStorage.setItem(_waBarraChave(), String(Date.now() + 60 * 60 * 1000)); } catch (e) {}
    el.remove();
  };
  el.querySelector('.wbo-ok').onclick = () => {
    el.remove();
    try { if (typeof nav === 'function') nav('robo'); } catch (e) {}
    try { if (typeof roboTab === 'function') roboTab('wp'); } catch (e) {}
    setTimeout(() => { if (typeof wuzConectar === 'function') wuzConectar(); }, 300);
  };
  document.body.appendChild(el);
}

async function waProviderInit() {
  const r = await WUZ.req('GET', '/status');
  _waProvider = r.data?.provider === 'wuzapi' ? 'wuzapi' : 'evolution';
  const novaDisponivel = r.data?.wuzapi_configured !== false;
  _waTrocarAoConectar = false;
  const legacyCfg = document.getElementById('evo-legacy-config');
  if (legacyCfg) legacyCfg.style.display = 'none';

  if (_waProvider === 'wuzapi') {
    _waProviderShow('wuzapi');
    await wuzCheckStatus(r);
    return;
  }
  if (EVO.instance) await evoCheckStatus();
  if (evoConnected) { _waProviderShow('evolution'); return; }
  if (novaDisponivel) {
    _waTrocarAoConectar = true;
    _waProviderShow('wuzapi');
    _wuzSetStatus('disconnected', 'Desconectado');
    return;
  }
  _waProviderShow('evolution');
  if (legacyCfg) legacyCfg.style.display = '';
  if (!EVO.instance) _evoSetStatus('disconnected', 'Desconectado');
}

function _waProviderShow(provider) {
  const evoCards = document.getElementById('evo-cards');
  const wuzCards = document.getElementById('wuz-cards');
  if (evoCards) evoCards.style.display = provider === 'wuzapi' ? 'none' : 'block';
  if (wuzCards) wuzCards.style.display = provider === 'wuzapi' ? 'block' : 'none';
}

// Botão "Atualizar" da aba Conexão
function waConexaoAtualizar() { return waProviderInit(); }

// Atualiza o indicador do topo (bolinha do Robô) sem depender da tela aberta.
// So consulta a conexão nova quando a loja usa ela.
async function waStatusRefresh() {
  try {
    if (_waProvider === null) {
      const r = await WUZ.req('GET', '/status');
      _waProvider = r.data?.provider === 'wuzapi' ? 'wuzapi' : 'evolution';
      if (_waProvider === 'wuzapi') { await wuzCheckStatus(r); return; }
    } else if (_waProvider === 'wuzapi') {
      await wuzCheckStatus();
      return;
    }
    if (EVO.instance) await evoCheckStatus();
  } catch (e) {}
}

async function waProviderChange(provider) {
  const r = await WUZ.req('POST', '/provider', { provider });
  if (!r.ok) { sbToast('err', 'Não foi possível preparar a conexão do WhatsApp'); return false; }
  _waProvider = provider === 'wuzapi' ? 'wuzapi' : 'evolution';
  _waProviderShow(_waProvider);
  return true;
}

// ── Conexão WuzAPI ──────────────────────────────────────
function _wuzSetStatus(kind, txt) {
  const dot = document.getElementById('wuz-status-dot');
  const label = document.getElementById('wuz-status-txt');
  if (label) label.textContent = txt;
  if (dot) dot.style.background = kind === 'connected' ? 'var(--success,#22c55e)' : kind === 'loading' ? 'var(--warning,#f59e0b)' : 'var(--muted)';
  // mesmo indicador do cabeçalho da aba e da bolinha do topo
  if (typeof _evoSetStatus === 'function') _evoSetStatus(kind, txt);
}

const _WUZ_DESCONECTADO_HTML = `<div style="font-size:15px;font-weight:750;margin-bottom:6px">WhatsApp desconectado</div><div style="font-size:13px;color:var(--muted);margin-bottom:16px">Gere o QR Code e leia com o celular da loja</div><button class="btn bp" onclick="wuzConectar()">Conectar WhatsApp</button>`;

async function wuzCheckStatus(respostaPronta) {
  const naAbaRobo = document.getElementById('page-robo')?.classList.contains('on');
  if (naAbaRobo) _wuzSetStatus('loading', 'Verificando...');
  const r = (respostaPronta && respostaPronta.data) ? respostaPronta : await WUZ.req('GET', '/status');
  const area = document.getElementById('wuz-qr-area');
  if (r.ok && r.data && 'ja_conectou' in r.data) _waJaConectou = !!r.data.ja_conectou;
  if (r.ok && r.data?.status === 'connected') {
    wuzConnected = true;
    _waBarraDesconectado(false);
    _wuzSetStatus('connected', 'Conectado');
    if (area) area.innerHTML = `<div style="width:52px;height:52px;border-radius:50%;background:rgba(31,157,87,.12);color:var(--pf-ok);display:flex;align-items:center;justify-content:center;margin:0 auto 14px"><svg width="26" height="26" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div style="font-size:15px;font-weight:750;margin-bottom:4px">WhatsApp conectado</div><div style="font-size:13px;color:var(--muted);margin-bottom:16px">As mensagens automáticas saem por este número</div><button class="btn bd" onclick="wuzDesconectar()">Desconectar</button>`;
  } else {
    wuzConnected = false;
    _wuzSetStatus('disconnected', 'Desconectado');
    // Faixa "WhatsApp desconectado": só para loja que já usava a conexão e
    // quando a resposta é confiável (desconectado de fato ou instância
    // apagada) — se a WuzAPI estiver fora do ar, não assusta o gestor.
    const st = String(r.data?.status || '');
    const desconectadoDeFato = r.ok && (st === 'disconnected' || st === 'connecting' || /unauthori|invalid|not found/i.test(st));
    _waBarraDesconectado(_waProvider === 'wuzapi' && _waJaConectou && desconectadoDeFato);
    // só repõe o botão se não houver um QR Code na tela esperando leitura
    if (area && !area.querySelector('img')) area.innerHTML = _WUZ_DESCONECTADO_HTML;
  }
}

// Motivo técnico da falha, em letra pequena, pra facilitar o suporte
function _wuzDetalheErro(r) {
  const msg = String((r && r.data && r.data.error) || (r && r.status ? 'erro ' + r.status : '')).slice(0, 200);
  if (!msg) return '';
  const safe = msg.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<div style="font-size:11.5px;color:var(--muted);margin-top:12px">Motivo: ${safe}</div>`;
}

async function wuzConectar() {
  const area = document.getElementById('wuz-qr-area');
  if (area) area.innerHTML = '<div style="font-size:13.5px;color:var(--muted)">Gerando o QR Code... pode levar até 20 segundos</div>';
  // Loja que estava na conexão antiga (desconectada): passa a usar a nova a partir daqui
  if (_waTrocarAoConectar || _waProvider !== 'wuzapi') {
    const ok = await waProviderChange('wuzapi');
    if (!ok) { if (area) area.innerHTML = _WUZ_DESCONECTADO_HTML; return; }
    _waTrocarAoConectar = false;
  }
  const r = await WUZ.req('POST', '/connect', {});
  if (!r.ok) {
    console.warn('[WhatsApp] falha ao conectar:', r.data?.error || r.status);
    if (area) area.innerHTML = `<div style="font-size:14px;font-weight:700;margin-bottom:6px">Não foi possível gerar o QR Code agora</div><div style="font-size:13px;color:var(--muted);margin-bottom:14px">Tente de novo em instantes. Se continuar, fale com o suporte.</div><button class="btn bp" onclick="wuzConectar()">Tentar de novo</button>${_wuzDetalheErro(r)}`;
    return;
  }
  if (r.data?.status === 'connected') { wuzCheckStatus(); sbToast('ok', 'WhatsApp já estava conectado!'); return; }
  if (r.data?.qr && area) {
    area.innerHTML = `<div style="font-size:13px;font-weight:600;margin-bottom:12px">Escaneie com seu WhatsApp</div><img src="${r.data.qr}" style="width:220px;height:220px;border-radius:12px;border:3px solid var(--accent);margin-bottom:12px"><div style="font-size:11px;color:var(--muted);margin-bottom:12px">O QR Code se atualiza sozinho</div><button class="btn bg" style="font-size:11.5px" onclick="wuzConectar()">Gerar novo QR Code</button>`;
  }
  _iniciarPollingWuz();
}

function _iniciarPollingWuz() {
  if (wuzQrInterval) clearInterval(wuzQrInterval);
  let tries = 0;
  wuzQrInterval = setInterval(async () => {
    tries++;
    const r = await WUZ.req('GET', '/qr');
    if (r.data?.status === 'connected') {
      clearInterval(wuzQrInterval);
      wuzCheckStatus();
      sbToast('ok', 'WhatsApp conectado!');
      iaAtivarTudoAoConectar();
      return;
    }
    const img = document.querySelector('#wuz-qr-area img');
    if (img && r.data?.qr) img.src = r.data.qr;
    if (tries > 30) clearInterval(wuzQrInterval);
  }, 4000);
}

async function wuzDesconectar() {
  if (!confirm('Desconectar o WhatsApp da loja?')) return;
  await WUZ.req('POST', '/disconnect', {});
  wuzConnected = false;
  _wuzSetStatus('disconnected', 'Desconectado');
  const area = document.getElementById('wuz-qr-area');
  if (area) area.innerHTML = _WUZ_DESCONECTADO_HTML;
  sbToast('ok', 'WhatsApp desconectado');
}

function roboTab(tab) {
  ['wp','auto','msgs','ia'].forEach(t => {
    document.getElementById('robo-tab-'+t)?.classList.toggle('on', t===tab);
    const s = document.getElementById('robo-section-'+t);
    if (s) s.style.display = t===tab ? '' : 'none';
  });
  if (tab==='msgs') evoCarregarHistorico();
  if (tab==='wp')   waProviderInit();
  if (tab==='ia')   iaCarregarConfig();
}

// Carrega instância salva do store_config ao abrir o Robô
async function evoCarregarInstancia() {
  try {
    const { data } = await sb.from('store_config').select('evo_instance').single();
    if (data?.evo_instance) {
      const el = document.getElementById('evo-instance');
      if (el) el.value = data.evo_instance;
    }
  } catch(e) {}
}

// Salva o nome da instância no banco e CONFIRMA a gravação lendo de volta,
// em vez de simplesmente assumir que o upsert funcionou (silenciosamente
// falhava antes, deixando o webhook configurado pro nome errado/antigo).
// IMPORTANTE: não manda tenant_id no corpo — só o header conta (evita
// "tenant_id do body não bate com o header" quando há várias abas abertas
// logadas em restaurantes diferentes e a sessão em memória fica desatualizada).
async function _salvarEvoInstanceConfirmado(instName) {
  const { error } = await sb.from('store_config').upsert({ evo_instance: instName });
  if (error) {
    sbToast('err', `Falha ao salvar a conexão "${instName}" no banco: ${error.message || 'erro desconhecido'}. O robô pode não responder.`);
    return false;
  }
  const { data: confirmacao } = await sb.from('store_config').select('evo_instance').single();
  if (confirmacao?.evo_instance !== instName) {
    sbToast('err', `A conexão salva ("${confirmacao?.evo_instance || 'nenhuma'}") não bate com "${instName}". Tente criar de novo.`);
    return false;
  }
  return true;
}

async function evoCriarInstancia() {
  const instName = EVO.instance;
  if (!instName) { sbToast('err', 'Informe o nome da conexão antes de criar.'); return; }
  sbLoading(true);

  // v2: tenta criar — se já existir (409/500), usa a instância existente
  let r = await EVO.req('POST', '/instance/create', {
    instanceName: instName,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS'
  });

  // Se retornou 500, pode ser duplicata — tenta usar a instância existente
  if (!r.ok) {
    const msg = r.data?.message || '';
    const isDuplicate = r.status === 409 || (r.status === 500 && (
      msg.toLowerCase().includes('already') ||
      msg.toLowerCase().includes('exist') ||
      msg.toLowerCase().includes('duplicate')
    ));
    if (isDuplicate || r.status === 500) {
      sbToast('ok', `A conexão "${instName}" já existe. Usando a existente...`);
      sbLoading(false);
      const salvou = await _salvarEvoInstanceConfirmado(instName);
      if (!salvou) return;
      const whOk = await iaRegistrarWebhook();
      if (whOk) sbToast('ok', 'Webhook configurado com sucesso.');
      evoConectar();
      return;
    }
    sbLoading(false);
    const m = r.data?.message || r.data?.error || `Erro ${r.status}`;
    sbToast('err', 'Erro: ' + (typeof m === 'string' ? m : JSON.stringify(m)));
    return;
  }

  sbLoading(false);
  const salvou = await _salvarEvoInstanceConfirmado(instName);
  if (!salvou) return;
  const whOk = await iaRegistrarWebhook();
  sbToast('ok', `Conexão "${instName}" criada!${whOk ? '' : ' (verifique o webhook manualmente)'}`);

  // v2: QR pode vir direto na resposta de criação
  const qrBase64 = r.data?.qrcode?.base64 || r.data?.base64;
  if (qrBase64) {
    const qrArea = document.getElementById('evo-qr-area');
    if (qrArea) {
      qrArea.innerHTML = `<div style="font-size:13px;font-weight:600;margin-bottom:12px">Escaneie com seu WhatsApp</div><img src="${qrBase64}" style="width:220px;height:220px;border-radius:12px;border:3px solid var(--accent);margin-bottom:12px"><div style="font-size:11px;color:var(--muted);margin-bottom:12px">QR Code expira em 60 segundos</div><button class="btn bg" style="font-size:11.5px" onclick="evoConectar()">Gerar novo QR Code</button>`;
    }
    _iniciarPollingConexao();
  } else {
    evoConectar();
  }
}

async function evoCheckStatus() {
  if (!EVO.instance) return;
  _evoSetStatus('loading','Verificando...');
  // Salva o nome da instância no banco sempre que verificar (permite vincular instância existente)
  try { await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, evo_instance: EVO.instance }); } catch(e) {}
  const r = await EVO.req('GET', `/instance/connectionState/${EVO.instance}`);
  if (!r.ok) { _evoSetStatus('disconnected','Desconectado'); return; }
  const state = r.data?.instance?.state || r.data?.state || 'close';
  const naAbaRobo = document.getElementById('page-robo')?.classList.contains('on');
  if (state==='open') {
    evoConnected=true;
    _evoSetStatus('connected','Conectado');
    if (naAbaRobo) _evoShowConnected(r.data?.instance?.profileName||r.data?.me?.pushName||'WhatsApp');
  } else {
    evoConnected=false;
    _evoSetStatus('disconnected','Desconectado');
    if (naAbaRobo) _evoShowQRPrompt();
  }
}

async function evoConectar() {
  const qrArea = document.getElementById('evo-qr-area');
  if (qrArea) qrArea.innerHTML='<div style="margin-bottom:10px"><div style="font-size:13px;color:var(--muted)">Gerando QR Code... aguarde</div></div>';

  // Evolution API v2 pode demorar para gerar o QR — tenta até 10x com intervalo de 3s
  let r = null;
  for (let tentativa = 1; tentativa <= 10; tentativa++) {
    r = await EVO.req('GET', `/instance/connect/${EVO.instance}`);
    // QR disponível quando code ou base64 estiverem presentes e count > 0
    const temQR = r.ok && (r.data?.base64 || r.data?.code) && (r.data?.count > 0 || r.data?.base64);
    if (temQR) break;
    if (tentativa < 10) {
      if (qrArea) qrArea.innerHTML=`<div style="font-size:13px;color:var(--muted)">Gerando QR Code... (${tentativa}/10)</div>`;
      await new Promise(res => setTimeout(res, 3000));
    }
  }

  // v2: QR pode estar em r.data.base64, r.data.qrcode.base64, ou r.data.code
  const qrB64 = r?.data?.base64 || r?.data?.qrcode?.base64;
  const qrCode = r?.data?.code || r?.data?.qrcode?.code;

  if (!r?.ok || (!qrCode && !qrB64)) {
    if (qrArea) qrArea.innerHTML=`<div style="font-size:13px;color:var(--danger);margin-bottom:12px">${r?.data?.message||'Não foi possível gerar o QR Code.'}</div><button class="btn bp" onclick="evoCriarInstancia()">Criar conexão</button>`;
    return;
  }
  if (qrArea) {
    if (qrB64) {
      qrArea.innerHTML=`<div style="font-size:13px;font-weight:600;margin-bottom:12px">Escaneie com seu WhatsApp</div><img src="${qrB64}" style="width:220px;height:220px;border-radius:12px;border:3px solid var(--accent);margin-bottom:12px"><div style="font-size:11px;color:var(--muted);margin-bottom:12px">QR Code expira em 60 segundos</div><button class="btn bg" style="font-size:11.5px" onclick="evoConectar()">Gerar novo QR Code</button>`;
    } else {
      qrArea.innerHTML=`<div style="font-size:12px;word-break:break-all;padding:10px;background:var(--surface2);border-radius:8px;margin-bottom:12px;color:var(--muted)">${(qrCode||'').slice(0,80)}...</div><button class="btn bg" onclick="evoConectar()">Gerar novo QR</button>`;
    }
  }
  _iniciarPollingConexao();
}

function _iniciarPollingConexao() {
  if (evoQrInterval) clearInterval(evoQrInterval);
  let tries=0;
  evoQrInterval = setInterval(async()=>{
    tries++;
    const s = await EVO.req('GET', `/instance/connectionState/${EVO.instance}`);
    const state = s.data?.instance?.state||s.data?.state||'close';
    if (state==='open') { clearInterval(evoQrInterval); evoConnected=true; _evoSetStatus('connected','Conectado'); _evoShowConnected(s.data?.instance?.profileName||'WhatsApp'); sbToast('ok',' WhatsApp conectado!'); iaRegistrarWebhook(); iaAtivarTudoAoConectar(); }
    if (tries>30) clearInterval(evoQrInterval);
  }, 4000);
}

async function evoDesconectar() {
  if (!confirm('Desconectar WhatsApp?')) return;
  await EVO.req('DELETE', `/instance/logout/${EVO.instance}`);
  evoConnected=false; _evoSetStatus('disconnected','Desconectado'); _evoShowQRPrompt(); sbToast('ok','WhatsApp desconectado');
}

async function evoTestarEnvio() {
  const phone = document.getElementById('evo-test-phone')?.value?.replace(/\D/g,'');
  const msg   = document.getElementById('evo-test-msg')?.value;
  const res   = document.getElementById('evo-test-result');
  if (!phone || phone.length < 10) { sbToast('err','Número inválido. Ex: 85912345678'); return; }
  if (!msg)  { sbToast('err','Informe a mensagem'); return; }
  if (res) { res.style.display='block'; res.innerHTML='<span style="color:var(--muted)">Enviando...</span>'; }

  const r = await EVO.sendText(phone, msg);
  console.log('[EVO TEST]', r);

  if (r.ok) {
    if (res) res.innerHTML='<span style="color:var(--success)">Mensagem enviada!</span>';
    sbToast('ok','Mensagem enviada!');
    evoMsgHistory.unshift({ to:phone, tipo:'Teste', msg:(msg||'').slice(0,60), status:'enviado', time: new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) });
  } else {
    // Extrai erro real da resposta da API
    const d = r.data || {};
    const errMsg = d.message || d.error || d.response?.message || d.response || r.error || `HTTP ${r.status}`;
    const errStr = typeof errMsg === 'object' ? JSON.stringify(errMsg) : String(errMsg);
    if (res) res.innerHTML=`
      <span style="color:var(--danger)">❌ Erro: ${errStr}</span>
      <details style="margin-top:6px;font-size:11px;color:var(--muted)">
        <summary style="cursor:pointer">Ver resposta completa da API</summary>
        <pre style="margin-top:4px;background:var(--surface2);padding:8px;border-radius:6px;overflow:auto;font-size:10px">${JSON.stringify(d,null,2)}</pre>
      </details>`;
    sbToast('err', 'Erro: ' + errStr.slice(0,80));
  }
}

let _evoCardapioLinkCache = '';

async function _evoCardapioLinkAtual() {
  if (_evoCardapioLinkCache) return _evoCardapioLinkCache;
  const tid = _sessao?.tenant_id || '';
  let slug = '';
  try {
    const res = await fetch('/api/tenant-slug', { headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid } }).catch(()=>null);
    if (res?.ok) slug = (await res.json().catch(()=>({}))).slug || '';
  } catch(e) {}
  _evoCardapioLinkCache = slug
    ? `${window.location.origin}/index.html?slug=${encodeURIComponent(slug)}`
    : `${window.location.origin}/index.html?tenant=${encodeURIComponent(tid)}`;
  return _evoCardapioLinkCache;
}

function _evoAplicarLinkCardapio(text, linkCardapio) {
  let out = String(text || '');
  const hosts = new Set(['estimafood.evocrm.sbs']);
  try {
    const host = new URL(window.location.origin).host;
    if (host) hosts.add(host);
  } catch(e) {}
  hosts.forEach(host => {
    const esc = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`https?://${esc}(?:/(?:index\\.html)?)?(?:\\?(?:slug|tenant)=[A-Za-z0-9._~-]+)?`, 'gi'), linkCardapio);
    out = out.replace(new RegExp(`(^|[^/])\\b${esc}(?:/(?:index\\.html)?)?(?:\\?(?:slug|tenant)=[A-Za-z0-9._~-]+)?`, 'gi'), (_, prefix) => `${prefix}${linkCardapio}`);
  });
  return out;
}

async function evoEnviarMensagem(phone, tipo, vars={}) {
  // Verifica se o toggle da automação está ativo
  const toggle = document.getElementById(`auto-toggle-${tipo}`);
  if (toggle && !toggle.classList.contains('on')) return false;
  const msgEl = document.getElementById(`auto-msg-${tipo}`);
  if (!msgEl) return false;
  let text = msgEl.value;
  const linkCardapio = await _evoCardapioLinkAtual();
  vars = { ...vars, link: linkCardapio, link_cardapio: linkCardapio, cardapio_link: linkCardapio };
  Object.entries(vars).forEach(([k,v])=>{ text=text.replaceAll(`{${k}}`,v||''); });
  text = _evoAplicarLinkCardapio(text, linkCardapio);
  const r = await EVO.sendText(phone, text);
  console.log(`[EVO AUTO] tipo=${tipo} para=${phone}`, r.ok ? '✅' : '❌', r);
  evoMsgHistory.unshift({
    to: phone,
    tipo: tipo.charAt(0).toUpperCase()+tipo.slice(1),
    msg: text.slice(0,60)+'...',
    status: r.ok ? 'enviado' : 'falhou',
    time: new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
  });
  return r.ok;
}

async function evoEnviarAniversariantesManual() {
  try {
    const r = await fetch(`${WA_SERVER}/aniversario`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const d = await r.json().catch(() => ({}))
    sbToast(r.ok ? 'ok' : 'err', r.ok ? 'Verificação de aniversários iniciada!' : 'Erro: servidor offline?')
  } catch(e) {
    // Fallback: roda no browser se servidor offline
    evoEnviarAniversariantesHoje(false)
  }
}

async function evoEnviarAniversariantesHoje(silencioso = false) {
  const toggle = document.getElementById('auto-toggle-aniversario');
  if (toggle && !toggle.classList.contains('on')) {
    if (!silencioso) sbToast('err', 'Automação de aniversário está desativada');
    return;
  }
  const today  = new Date();
  const todayMD = `${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const anivs  = fidClients.filter(c => c.birthday && c.birthday.slice(5) === todayMD && c.phone);
  if (!anivs.length) {
    if (!silencioso) sbToast('ok', 'Nenhum aniversariante com telefone hoje');
    return;
  }
  if (!silencioso) sbLoading(true);
  let ok=0, fail=0;
  for (const c of anivs) {
    const sent = await evoEnviarMensagem(c.phone, 'aniversario', { nome: c.name });
    sent ? ok++ : fail++;
    await new Promise(r => setTimeout(r, 1200));
  }
  if (!silencioso) sbLoading(false);
  // Salva que já enviou hoje no Supabase
  try { await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, evo_aniv_last: todayMD }); } catch(e){}
  // Atualiza label na tela
  const lastEl = document.getElementById('aniv-last-send');
  if (lastEl) lastEl.textContent = 'Último envio: ' + todayMD + ' às ' + new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  if (!silencioso) sbToast('ok', 'Enviado para ' + ok + ' aniversariante(s)' + (fail ? ' | ' + fail + ' falhou' : '') + '!');
  else if (ok > 0) sbToast('ok', 'Felicitações enviadas para ' + ok + ' aniversariante(s)!');
}

// ── Scheduler automático de aniversário ──────────────────
let _anivSchedulerTimer = null;
let _anivLastSent = null; // cache em memória para não bater no banco a cada minuto

async function _checarAniversario() {
  const toggle = document.getElementById('auto-toggle-aniversario');
  if (!toggle || !toggle.classList.contains('on')) return;

  const horaEl  = document.getElementById('auto-aniv-hora');
  const horaCfg = horaEl?.value || '09:00';
  const [hCfg, mCfg] = horaCfg.split(':').map(Number);
  const now     = new Date();
  const todayMD = `${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  // Usa cache em memória primeiro
  if (_anivLastSent === todayMD) return;

  // Só consulta o banco uma vez por dia (quando cache está vazio ou é outro dia)
  if (!_anivLastSent) {
    try {
      const { data } = await sb.from('store_config').select('evo_aniv_last').single();
      _anivLastSent = data?.evo_aniv_last || null;
    } catch(e) {}
  }

  if (_anivLastSent === todayMD) return;

  const minutosAgora = now.getHours() * 60 + now.getMinutes();
  const minutosCfg   = hCfg * 60 + mCfg;

  if (minutosAgora >= minutosCfg) {
    console.log('[EVO SCHEDULER] ✅ Disparando aniversários automáticos:', todayMD, horaCfg);
    _anivLastSent = todayMD; // marca na memória imediatamente para não duplicar
    evoEnviarAniversariantesHoje(true);
  }
}

function _iniciarSchedulerAniversario() {
  if (_anivSchedulerTimer) clearInterval(_anivSchedulerTimer);
  // Roda logo ao iniciar (caso já tenha passado da hora hoje)
  setTimeout(_checarAniversario, 5000);
  // Verifica a cada 60s
  _anivSchedulerTimer = setInterval(_checarAniversario, 60000);
  console.log('[EVO SCHEDULER] Scheduler de aniversário iniciado ✅');
}

async function evoSalvarAutomacoes() {
  const tipos = ['pix_cobranca','pix_copia_cola','pix_confirmado','recebido','confirmado','pronto','entrega','cancelado','aniversario','boasvindas','avaliacao','retorno','pedido_perdido','promocao','pontos','cashback','carimbinho','conta'];
  const optinTipos = new Set(['recebido','confirmado','pronto','entrega']);
  const aliases = { confirmado: 'producao', entrega: 'saiu' };
  let data = {};
  try {
    const { data: atual } = await sb.from('store_config').select('evo_automacoes').single();
    data = atual?.evo_automacoes || {};
    if (typeof data === 'string') data = JSON.parse(data || '{}');
  } catch(e) {
    data = {};
  }
  tipos.forEach(tipo => {
    const alias = aliases[tipo];
    const toggle = document.getElementById(`auto-toggle-${tipo}`) || (alias ? document.getElementById(`auto-toggle-${alias}`) : null);
    const msgEl = document.getElementById(`auto-msg-${tipo}`) || (alias ? document.getElementById(`auto-msg-${alias}`) : null);
    const optEl = document.getElementById(`auto-optin-${tipo}`) || (alias ? document.getElementById(`auto-optin-${alias}`) : null);
    if (!toggle && !msgEl && !optEl) return;
    const atualTipo = data[tipo] && typeof data[tipo] === 'object' ? data[tipo] : {};
    data[tipo] = { ...atualTipo };
    if (toggle) data[tipo].on = toggle.classList.contains('on');
    if (msgEl) data[tipo].msg = msgEl.value;
    if (optinTipos.has(tipo)) {
      data[tipo].requer_optin = true;
      if (optEl) optEl.classList.add('on');
    }
  });
  data._aniv_hora = document.getElementById('auto-aniv-hora')?.value || '09:00';
  try {
    const { error } = await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, evo_automacoes: data });
    if (error) throw error;
    sbToast('ok', 'Automações salvas!');
  } catch(e) {
    sbToast('err', 'Erro ao salvar: ' + (e.message || JSON.stringify(e)));
  }
}

async function evoCarregarAutomacoesSalvas() {
  try {
    const { data } = await sb.from('store_config').select('evo_automacoes').single();
    let cfg = data?.evo_automacoes || {};
    if (typeof cfg === 'string') cfg = JSON.parse(cfg || '{}');
    ['recebido','confirmado','producao','pronto','entrega','saiu'].forEach(id => {
      const o = document.getElementById(`auto-optin-${id}`);
      if (!o) return;
      o.classList.add('on');
      o.style.pointerEvents = 'none';
      o.title = 'Obrigatorio para evitar banimento: so envia quando o cliente solicita acompanhamento.';
    });
    const aliases = { confirmado: 'producao', entrega: 'saiu' };
    Object.entries(cfg).forEach(([tipo, val]) => {
      if (tipo.startsWith('_')) return;
      if (!val || typeof val !== 'object') val = {};
      const ids = [tipo, aliases[tipo]].filter(Boolean);
      ids.forEach(id => {
        const t = document.getElementById(`auto-toggle-${id}`);
        const m = document.getElementById(`auto-msg-${id}`);
        const o = document.getElementById(`auto-optin-${id}`);
        if (t) { val.on ? t.classList.add('on') : t.classList.remove('on'); }
        if (m && val.msg) m.value = val.msg;
        if (o) {
          o.classList.add('on');
          o.style.pointerEvents = 'none';
          o.title = 'Obrigatorio para evitar banimento: so envia quando o cliente solicita acompanhamento.';
        }
      });
    });
    if (cfg._aniv_hora) {
      const h = document.getElementById('auto-aniv-hora');
      if (h) h.value = cfg._aniv_hora;
    }
  } catch(e) {
    console.warn('evoCarregarAutomacoesSalvas:', e);
  }
}

// ════════════════════════════════════════════════════════
// AGENTE IA
// ════════════════════════════════════════════════════════

async function iaCarregarConfig() {
  // URL do webhook — usa o slug do tenant (mesma URL já configurada nas automações)
  const urlEl = document.getElementById('ia-webhook-url');
  try {
    const _slugRes1 = await fetch('/api/tenant-slug', { headers: { 'Content-Type': 'application/json', 'x-tenant-id': _sessao?.tenant_id || '' } }).catch(()=>null);
    const slug = (_slugRes1?.ok ? (await _slugRes1.json().catch(()=>({}))).slug : '') || _sessao?.tenant_id || '';
    const webhookUrl = `${window.location.origin}/webhook/${slug}`;
    if (urlEl) urlEl.textContent = webhookUrl;
    // Registra webhook automaticamente na Evolution API ao carregar
    iaRegistrarWebhook(webhookUrl);
  } catch(e) {
    if (urlEl) urlEl.textContent = `${window.location.origin}/webhook/${_sessao?.tenant_id||''}`;
  }

  try {
    const { data } = await sb.from('store_config').select('ia_config').single();
    const ia = data?.ia_config ? JSON.parse(data.ia_config) : {};
    const tog = document.getElementById('ia-toggle-ativo');
    if (tog) { ia.ativo ? tog.classList.add('on') : tog.classList.remove('on'); }
    iaAtualizarStatus();
    ['cardapio','pedido','horario','entrega','promo'].forEach(c => {
      const el = document.getElementById(`ia-resp-${c}`);
      if (el) { ia[`resp_${c}`] ? el.classList.add('on') : el.classList.remove('on'); }
    });
    const pw = document.getElementById('ia-pedido-whatsapp');
    if (pw) { ia.pedido_whatsapp !== false ? pw.classList.add('on') : pw.classList.remove('on'); }
    iaPedidoWhatsappLiberado();
    if (ia.horario_txt) { const el = document.getElementById('ia-horario-txt'); if(el) el.value = ia.horario_txt; }
    if (ia.entrega_txt) { const el = document.getElementById('ia-entrega-txt'); if(el) el.value = ia.entrega_txt; }
  } catch(e) { console.warn('iaCarregarConfig:', e); }
  try { if (typeof upgradeIaCartao === 'function') upgradeIaCartao(); } catch (e) {}
}

// ── Pedidos pelo WhatsApp (texto e áudio) ───────────────
// Liga/desliga na hora (sem precisar do botão Salvar). Só funciona se o
// recurso estiver no plano da loja; senão a chave fica bloqueada com aviso.
let _iaPedidoSalvando = false;
async function iaPedidoWhatsappAlternar(el) {
  if (!el || _iaPedidoSalvando || el.dataset.bloqueado === '1') return;
  const ligar = !el.classList.contains('on');
  _iaPedidoSalvando = true;
  el.classList.toggle('on', ligar);
  try {
    const { data, error } = await sb.from('store_config').select('ia_config').single();
    if (error || !data) throw new Error(error?.message || 'sem resposta');
    const ia = data.ia_config ? JSON.parse(data.ia_config) : {};
    ia.pedido_whatsapp = ligar;
    const r = await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, ia_config: JSON.stringify(ia) });
    if (r.error) throw r.error;
    sbToast('ok', ligar ? 'Pedidos pelo WhatsApp ligados' : 'Pedidos pelo WhatsApp desligados. O robô vai mandar o link do cardápio.');
  } catch (e) {
    el.classList.toggle('on', !ligar);
    sbToast('err', 'Não foi possível salvar agora. Tente de novo.');
  } finally { _iaPedidoSalvando = false; }
}
// A chave só aparece para quem tem o pedido pelo WhatsApp: no plano (liberado
// pelo admin), comprado pelo upgrade ou no período de teste. Para os demais
// fica escondida (o cartão de upgrade da própria aba já oferece o recurso).
async function iaPedidoWhatsappLiberado() {
  const card = document.getElementById('ia-pedido-whatsapp-card');
  const el = document.getElementById('ia-pedido-whatsapp');
  if (!card || !el) return;
  let liberado = false;
  try {
    const r = await fetch('/api/site/aviso-whatsapp', { headers: { 'x-tenant-id': _sessao?.tenant_id || '' } });
    const d = await r.json().catch(() => ({}));
    liberado = r.ok && !!d.pedido_ia;
  } catch (e) {}
  el.dataset.bloqueado = liberado ? '' : '1';
  card.style.display = liberado ? '' : 'none';
}

function iaAtualizarStatus() {
  const on  = document.getElementById('ia-toggle-ativo')?.classList.contains('on');
  const lbl = document.getElementById('ia-status-lbl');
  if (lbl) {
    lbl.textContent = on ? 'Ativo — respondendo 24/7' : 'Inativo';
    lbl.style.color = on ? 'var(--success)' : 'var(--muted)';
  }
}

async function iaSalvarConfig() {
  // Gestor só salva os tópicos e textos — preserva key/modelo do admin
  let iaAtual = {};
  try {
    const { data, error } = await sb.from('store_config').select('ia_config').single();
    if (error || !data) throw new Error(error?.message || 'sem resposta');
    iaAtual = data?.ia_config ? JSON.parse(data.ia_config) : {};
  } catch(e) {
    // Sem a configuração atual, salvar aqui apagaria o resto (PIX manual, chave etc.)
    sbToast('err', 'Não foi possível ler a configuração atual. Verifique a conexão e tente salvar de novo.');
    return;
  }

  const ia = {
    ...iaAtual, // preserva openai_key, modelo, prompt_base, quebra_linha, buffer_seg, pausa_min
    ativo:        document.getElementById('ia-toggle-ativo')?.classList.contains('on'),
    resp_cardapio:document.getElementById('ia-resp-cardapio')?.classList.contains('on'),
    resp_pedido:  document.getElementById('ia-resp-pedido')?.classList.contains('on'),
    resp_horario: document.getElementById('ia-resp-horario')?.classList.contains('on'),
    resp_entrega: document.getElementById('ia-resp-entrega')?.classList.contains('on'),
    resp_promo:   document.getElementById('ia-resp-promo')?.classList.contains('on'),
    pedido_whatsapp: document.getElementById('ia-pedido-whatsapp') ? document.getElementById('ia-pedido-whatsapp').classList.contains('on') : iaAtual.pedido_whatsapp,
    horario_txt:  document.getElementById('ia-horario-txt')?.value || '',
    entrega_txt:  document.getElementById('ia-entrega-txt')?.value || '',
  };

  try {
    const { error } = await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, ia_config: JSON.stringify(ia) });
    if (error) throw error;
    sbToast('ok', 'Configurações da IA salvas!');
    iaAtualizarStatus();
  } catch(e) {
    sbToast('err', 'Erro ao salvar: ' + (e.message||JSON.stringify(e)));
  }
}

// Ao ler o QR Code e conectar o WhatsApp, o Agente IA liga sozinho com todas
// as capacidades. Depois o gestor pode desligar o que quiser na aba Agente IA.
async function iaAtivarTudoAoConectar() {
  let iaAtual = {};
  try {
    const { data, error } = await sb.from('store_config').select('ia_config').single();
    if (error || !data) throw new Error(error?.message || 'sem resposta');
    iaAtual = data?.ia_config ? JSON.parse(data.ia_config) : {};
  } catch(e) {
    // Sem a configuração atual, gravar aqui apagaria o resto (PIX manual, chave etc.)
    console.warn('iaAtivarTudoAoConectar: não leu a configuração atual', e);
    return;
  }
  const ia = { ...iaAtual, ativo: true, resp_cardapio: true, resp_pedido: true, resp_horario: true, resp_entrega: true, resp_promo: true };
  try {
    const { error } = await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, ia_config: JSON.stringify(ia) });
    if (error) throw error;
  } catch(e) {
    console.warn('iaAtivarTudoAoConectar: não salvou', e);
    return;
  }
  ['ia-toggle-ativo','ia-resp-cardapio','ia-resp-pedido','ia-resp-horario','ia-resp-entrega','ia-resp-promo']
    .forEach(id => document.getElementById(id)?.classList.add('on'));
  iaAtualizarStatus();
  sbToast('ok', 'Agente IA ativado com todas as opções');
}

// ═══════════════════════════════════════
// AVISO DO ROBÔ: conectar o WhatsApp
// O admin liga em Site > Testes (para quem está em teste e/ou para os clientes).
// Aparece ao abrir o painel com o WhatsApp desconectado. "Agora não" esconde
// até o dia seguinte.
// ═══════════════════════════════════════
function _avisoWaHoje() { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); }
function _avisoWaChave() { return 'estima_aviso_wa_' + (_sessao?.tenant_id || ''); }

async function avisoWhatsappVerificar() {
  try {
    if (wuzConnected || evoConnected || document.getElementById('wa-aviso')) return;
    if (_waJaConectou) return; // loja que só caiu: a faixa "WhatsApp desconectado" já avisa
    const tid = _sessao?.tenant_id || '';
    if (!tid) return;
    try { if (localStorage.getItem(_avisoWaChave()) === _avisoWaHoje()) return; } catch (e) {}
    const r = await fetch('/api/site/aviso-whatsapp', { headers: { 'x-tenant-id': tid } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.mostrar) return;
    if (wuzConnected || evoConnected) return;
    avisoWhatsappMostrar(d);
  } catch (e) { console.warn('avisoWhatsappVerificar:', e); }
}

function _avisoWaCss() {
  if (document.getElementById('wa-aviso-css')) return;
  const st = document.createElement('style');
  st.id = 'wa-aviso-css';
  st.textContent = `
  #wa-aviso{position:fixed;inset:0;z-index:99990;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(8,15,12,.62);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
  #wa-aviso .wa-av-card{position:relative;width:100%;max-width:860px;max-height:calc(100vh - 32px);overflow:auto;display:grid;grid-template-columns:350px 1fr;background:var(--surface,#fff);color:var(--text,#101828);border-radius:26px;box-shadow:0 30px 80px rgba(0,0,0,.45);animation:waAvEntra .45s cubic-bezier(.2,.9,.3,1.15) both}
  #wa-aviso .wa-av-vitrine{position:relative;overflow:hidden;background:radial-gradient(90% 70% at 30% 15%,#1c7a52 0%,#0f4a33 45%,#0a2e21 100%);padding:30px 24px;display:flex;align-items:center;justify-content:center;min-height:520px}
  #wa-aviso .wa-av-vitrine::before{content:"";position:absolute;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,rgba(37,211,102,.35),transparent 65%);top:-120px;right:-140px}
  #wa-aviso .wa-av-fone{position:relative;width:268px;height:470px;border-radius:38px;background:#0b141a;padding:9px;box-shadow:0 22px 50px rgba(0,0,0,.45),inset 0 0 0 1.5px rgba(255,255,255,.08)}
  #wa-aviso .wa-av-tela{width:100%;height:100%;border-radius:30px;overflow:hidden;display:flex;flex-direction:column;background:#efeae2}
  #wa-aviso .wa-av-topo-chat{display:flex;align-items:center;gap:9px;padding:12px 12px 10px;background:#0b5f4f;color:#fff}
  #wa-aviso .wa-av-avatar{width:34px;height:34px;border-radius:50%;background:#e9fbe9;display:flex;align-items:center;justify-content:center;flex:0 0 34px}
  #wa-aviso .wa-av-nome{font-size:13px;font-weight:700;line-height:1.2}
  #wa-aviso .wa-av-status{font-size:11px;opacity:.82;line-height:1.3}
  #wa-aviso .wa-av-chat{flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:6px;padding:10px 9px 12px;overflow:hidden;background-color:#efeae2;background-image:radial-gradient(rgba(0,0,0,.035) 1px,transparent 1px);background-size:14px 14px}
  #wa-aviso .wa-av-msg{max-width:84%;font-size:12px;line-height:1.38;padding:6px 8px 14px;border-radius:10px;position:relative;color:#111b21;box-shadow:0 1px .5px rgba(11,20,26,.13);animation:waAvMsg .32s ease-out both;word-wrap:break-word}
  #wa-aviso .wa-av-msg.cli{align-self:flex-start;background:#fff;border-top-left-radius:3px}
  #wa-aviso .wa-av-msg.ia{align-self:flex-end;background:#d9fdd3;border-top-right-radius:3px}
  #wa-aviso .wa-av-hora{position:absolute;right:7px;bottom:3px;font-size:9.5px;color:#667781;display:flex;align-items:center;gap:2px}
  #wa-aviso .wa-av-audio{display:flex;align-items:center;gap:7px;min-width:170px;padding-top:2px}
  #wa-aviso .wa-av-play{width:26px;height:26px;border-radius:50%;background:#0b5f4f;display:flex;align-items:center;justify-content:center;flex:0 0 26px}
  #wa-aviso .wa-av-onda{display:flex;align-items:center;gap:2px;height:22px;flex:1}
  #wa-aviso .wa-av-onda i{display:block;width:2.5px;border-radius:2px;background:#8aa59c}
  #wa-aviso .wa-av-dur{font-size:10px;color:#667781}
  #wa-aviso .wa-av-digitando{align-self:flex-end;background:#d9fdd3;border-radius:10px;border-top-right-radius:3px;padding:9px 11px;display:flex;gap:4px;animation:waAvMsg .25s ease-out both}
  #wa-aviso .wa-av-digitando i{width:6px;height:6px;border-radius:50%;background:#5c8f7e;animation:waAvDigita 1.1s ease-in-out infinite}
  #wa-aviso .wa-av-digitando i:nth-child(2){animation-delay:.15s}#wa-aviso .wa-av-digitando i:nth-child(3){animation-delay:.3s}
  #wa-aviso .wa-av-pedido{background:#fff;border-radius:8px;padding:8px 9px;margin:2px 0 4px;border:1px solid #c9ecd0}
  #wa-aviso .wa-av-pedido b{display:flex;align-items:center;gap:5px;font-size:12px;color:#0b5f4f;margin-bottom:5px}
  #wa-aviso .wa-av-pedido div{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:#3b4a54;line-height:1.5}
  #wa-aviso .wa-av-pedido .tot{border-top:1px dashed #c9d6cf;margin-top:4px;padding-top:4px;font-weight:700;color:#111b21}
  #wa-aviso .wa-av-notif{position:absolute;left:16px;right:16px;bottom:22px;display:flex;align-items:center;gap:11px;background:rgba(255,255,255,.97);color:#101828;border-radius:16px;padding:11px 13px;box-shadow:0 14px 34px rgba(0,0,0,.35);opacity:0;transform:translateY(16px);transition:opacity .35s ease,transform .45s cubic-bezier(.2,.9,.3,1.2);pointer-events:none;z-index:2}
  #wa-aviso .wa-av-notif.on{opacity:1;transform:none}
  #wa-aviso .wa-av-notif-ic{width:36px;height:36px;border-radius:11px;background:#128C4A;display:flex;align-items:center;justify-content:center;flex:0 0 36px}
  #wa-aviso .wa-av-notif strong{display:block;font-size:13px;line-height:1.25}
  #wa-aviso .wa-av-notif div > span{display:block;font-size:11.5px;color:#667085;line-height:1.3}
  #wa-aviso .wa-av-info{padding:40px 40px 30px;display:flex;flex-direction:column}
  #wa-aviso .wa-av-selo{align-self:flex-start;display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:#0f7a3f;background:rgba(37,211,102,.13);border-radius:99px;padding:6px 12px 6px 9px;margin-bottom:16px}
  #wa-aviso .wa-av-selo i{width:8px;height:8px;border-radius:50%;background:#25D366;box-shadow:0 0 0 0 rgba(37,211,102,.6);animation:waAvPulso 1.8s infinite}
  #wa-aviso h2{font-size:28px;line-height:1.14;font-weight:800;letter-spacing:-.022em;margin:0 0 12px;text-wrap:balance}
  #wa-aviso .wa-av-sub{font-size:14.5px;line-height:1.6;color:var(--muted,#667085);margin:0 0 22px;max-width:44ch}
  #wa-aviso .wa-av-lista{list-style:none;margin:0 0 22px;padding:0;display:grid;gap:14px}
  #wa-aviso .wa-av-lista li{display:flex;gap:12px;align-items:flex-start}
  #wa-aviso .wa-av-ic{width:36px;height:36px;border-radius:11px;background:rgba(37,211,102,.12);color:#0f7a3f;display:flex;align-items:center;justify-content:center;flex:0 0 36px}
  #wa-aviso .wa-av-lista strong{display:block;font-size:14px;line-height:1.3;margin-top:1px}
  #wa-aviso .wa-av-lista li > div > span{display:block;font-size:12.5px;line-height:1.45;color:var(--muted,#667085)}
  #wa-aviso .wa-av-prazo{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#0f7a3f;background:rgba(37,211,102,.08);border:1px solid rgba(37,211,102,.28);border-radius:12px;padding:9px 12px;margin:0 0 18px}
  #wa-aviso .wa-av-extra{font-size:12.5px;line-height:1.5;color:var(--muted,#667085);border-left:3px solid #25D366;padding:2px 0 2px 10px;margin:0 0 18px}
  #wa-aviso .wa-av-acoes{margin-top:auto}
  #wa-aviso .wa-av-btn{width:100%;border:0;border-radius:14px;padding:15px 18px;font-size:15.5px;font-weight:800;cursor:pointer;background:#128C4A;color:#fff;display:flex;align-items:center;justify-content:center;gap:10px;font-family:inherit;box-shadow:0 10px 24px rgba(18,140,74,.32);transition:transform .15s ease,background .15s ease}
  #wa-aviso .wa-av-btn:hover{background:#0f7a3f;transform:translateY(-1px)}
  #wa-aviso .wa-av-nota{text-align:center;font-size:12px;color:var(--muted,#667085);margin:9px 0 0}
  #wa-aviso .wa-av-depois{display:block;margin:4px auto 0;border:0;background:none;color:var(--muted,#667085);font-size:13px;font-weight:600;padding:8px 14px;cursor:pointer;font-family:inherit;border-radius:8px}
  #wa-aviso .wa-av-depois:hover{color:var(--text,#101828)}
  #wa-aviso .wa-av-x{position:absolute;top:14px;right:14px;z-index:3;width:36px;height:36px;border-radius:50%;border:0;background:rgba(16,24,40,.06);color:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center}
  #wa-aviso .wa-av-x:hover{background:rgba(16,24,40,.12)}
  #wa-aviso button:focus-visible{outline:3px solid rgba(37,211,102,.6);outline-offset:2px}
  @keyframes waAvEntra{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:none}}
  @keyframes waAvMsg{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
  @keyframes waAvDigita{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-3px);opacity:1}}
  @keyframes waAvPulso{0%{box-shadow:0 0 0 0 rgba(37,211,102,.55)}70%{box-shadow:0 0 0 8px rgba(37,211,102,0)}100%{box-shadow:0 0 0 0 rgba(37,211,102,0)}}
  @media (prefers-reduced-motion:reduce){#wa-aviso *{animation:none!important;transition:none!important}}
  @media (max-width:760px){
    #wa-aviso{padding:10px;align-items:flex-end}
    #wa-aviso .wa-av-card{grid-template-columns:1fr;max-height:calc(100vh - 20px);border-radius:24px}
    #wa-aviso .wa-av-vitrine{min-height:0;padding:18px 16px 14px}
    #wa-aviso .wa-av-fone{width:262px;height:250px;border-radius:30px;padding:7px}
    #wa-aviso .wa-av-tela{border-radius:24px}
    #wa-aviso .wa-av-topo-chat{padding:9px 11px 8px}
    #wa-aviso .wa-av-notif{left:12px;right:12px;bottom:10px;padding:9px 11px}
    #wa-aviso .wa-av-info{padding:20px 20px 0}
    #wa-aviso .wa-av-selo{margin-bottom:12px}
    #wa-aviso h2{font-size:22px;margin-bottom:8px}
    #wa-aviso .wa-av-sub{font-size:13.5px;margin-bottom:14px}
    #wa-aviso .wa-av-lista{gap:10px;margin-bottom:14px}
    #wa-aviso .wa-av-lista li{align-items:center}
    #wa-aviso .wa-av-lista li > div > span{display:none}
    #wa-aviso .wa-av-ic{width:32px;height:32px;flex-basis:32px;border-radius:10px}
    #wa-aviso .wa-av-prazo{font-size:12.5px;margin-bottom:12px}
    #wa-aviso .wa-av-acoes{position:sticky;bottom:0;margin:0 -20px;padding:12px 20px 10px;background:var(--surface,#fff);box-shadow:0 -10px 18px -12px rgba(16,24,40,.25)}
    #wa-aviso .wa-av-x{background:rgba(255,255,255,.16);color:#fff}
  }`;
  document.head.appendChild(st);
}

const _AVISO_WA_ROBO = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><line x1="12" y1="2.5" x2="12" y2="5" stroke="#0b5f4f" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="2.3" r="1.5" fill="#25D366"/><rect x="4" y="5.5" width="16" height="13" rx="4.5" fill="#fff" stroke="#0b5f4f" stroke-width="1.4"/><rect x="6.5" y="8.3" width="11" height="6.6" rx="2.6" fill="#0b5f4f"/><circle cx="9.6" cy="11.5" r="1.25" fill="#4ade80"/><circle cx="14.4" cy="11.5" r="1.25" fill="#4ade80"/></svg>';

function _avisoWaRoteiro(pedidoIa) {
  if (!pedidoIa) return [
    { de: 'cli', t: 'Oi! Que horas vocês abrem hoje?' },
    { de: 'ia', t: 'Oi! Hoje abrimos às 18h e vamos até 23h.' },
    { de: 'cli', t: 'Tem alguma promoção?' },
    { de: 'ia', t: 'Tem sim: pizza grande + refrigerante 2L por R$ 59,90. Te mando o link do cardápio?' },
    { de: 'cli', t: 'Manda!' },
    { de: 'ia', t: 'Aqui está. É só escolher e finalizar pelo link.' }
  ];
  return [
    { de: 'cli', t: 'Boa noite! Vocês entregam no Centro?' },
    { de: 'ia', t: 'Boa noite! Entregamos sim, a taxa é R$ 5,00. Pode mandar seu pedido por texto ou áudio.' },
    { de: 'cli', audio: '0:07' },
    { de: 'ia', t: 'Entendi seu áudio: 1 pizza grande de calabresa e 1 Coca-Cola 2L. Posso confirmar?' },
    { de: 'cli', t: 'Pode sim, pago no Pix' },
    { de: 'ia', pedido: true }
  ];
}

function _avisoWaHora() { return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }

function _avisoWaBolha(m) {
  const b = document.createElement('div');
  b.className = 'wa-av-msg ' + m.de;
  const vistos = m.de === 'ia' ? '<svg width="14" height="9" viewBox="0 0 16 10" fill="none" aria-hidden="true"><path d="M1 5.5l2.6 2.6L9.5 2M6.5 7.6l.6.6L13 2" stroke="#53bdeb" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '';
  let corpo;
  if (m.audio) {
    const alturas = [6, 10, 14, 9, 17, 12, 7, 15, 19, 11, 8, 13, 16, 9, 6, 11, 14, 8, 5, 9];
    corpo = `<div class="wa-av-audio"><span class="wa-av-play"><svg width="10" height="11" viewBox="0 0 10 11" aria-hidden="true"><path d="M1.5 1v9l7.5-4.5z" fill="#fff"/></svg></span><span class="wa-av-onda">${alturas.map(h => `<i style="height:${h}px"></i>`).join('')}</span><span class="wa-av-dur">${m.audio}</span></div>`;
  } else if (m.pedido) {
    corpo = `<div class="wa-av-pedido"><b><svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="#25D366"/><path d="M4.8 8.2l2.1 2.1 4.3-4.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Pedido nº 128 confirmado</b><div><span>1 Pizza G Calabresa</span><span>R$ 54,90</span></div><div><span>1 Coca-Cola 2L</span><span>R$ 13,00</span></div><div><span>Entrega</span><span>R$ 5,00</span></div><div class="tot"><span>Total no Pix</span><span>R$ 72,90</span></div></div>Seu pedido já está na cozinha. Chega em 40 a 50 min.`;
  } else corpo = m.t;
  b.innerHTML = `${corpo}<span class="wa-av-hora">${_avisoWaHora()}${vistos}</span>`;
  return b;
}

// Conversa animada dentro do celular. Devolve uma função que para a animação.
function _avisoWaAnimar(el, roteiro, comPedido) {
  const chat = el.querySelector('.wa-av-chat');
  const status = el.querySelector('.wa-av-status');
  const notif = el.querySelector('.wa-av-notif');
  const timers = [];
  const espera = (fn, ms) => timers.push(setTimeout(fn, ms));
  let reduz = false;
  try { reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  if (reduz) {
    roteiro.forEach(m => chat.appendChild(_avisoWaBolha(m)));
    if (comPedido && notif) notif.classList.add('on');
    return () => {};
  }
  let i = 0;
  function passo() {
    if (!document.body.contains(el)) return;
    if (i >= roteiro.length) {
      if (comPedido && notif) notif.classList.add('on');
      espera(() => { if (notif) notif.classList.remove('on'); chat.innerHTML = ''; i = 0; espera(passo, 500); }, 5200);
      return;
    }
    const m = roteiro[i++];
    if (m.de === 'ia') {
      if (status) status.textContent = 'digitando...';
      const dig = document.createElement('div');
      dig.className = 'wa-av-digitando';
      dig.innerHTML = '<i></i><i></i><i></i>';
      chat.appendChild(dig);
      espera(() => { dig.remove(); if (status) status.textContent = 'online'; chat.appendChild(_avisoWaBolha(m)); espera(passo, m.pedido ? 900 : 1300); }, m.pedido ? 1700 : 1300);
    } else {
      chat.appendChild(_avisoWaBolha(m));
      espera(passo, 1100);
    }
  }
  espera(passo, 600);
  return () => timers.forEach(clearTimeout);
}

function avisoWhatsappMostrar(info) {
  _avisoWaCss();
  const pedidoIa = !!info.pedido_ia;
  const dataBR = s => String(s || '').slice(0, 10).split('-').reverse().slice(0, 2).join('/');
  const ic = {
    audio: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    painel: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4" width="17" height="13" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M8 21h8M12 17v4M8 9.5l2.5 2.5L16 7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    relogio: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    chat: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>'
  };
  const itens = pedidoIa ? [
    [ic.audio, 'Entende texto e áudio', 'O cliente fala o pedido do jeito dele e a IA monta tudo certinho.'],
    [ic.painel, 'Pedido cai direto no painel', 'Confirmado com o cliente, o pedido entra na sua tela pronto para a cozinha.'],
    [ic.relogio, 'Atende 24 horas', 'Responde cardápio, horário, taxa de entrega e promoções, sem você parar o que está fazendo.']
  ] : [
    [ic.chat, 'Responde na hora', 'Cardápio, preços, horário, taxa de entrega e promoções.'],
    [ic.relogio, 'Atende 24 horas', 'Nenhum cliente fica esperando, nem no horário de pico.'],
    [ic.painel, 'Leva o cliente ao cardápio', 'Envia o link para o cliente escolher e finalizar o pedido.']
  ];
  const titulo = pedidoIa ? 'Seus pedidos pelo WhatsApp, anotados pela IA' : 'Atendimento com IA no WhatsApp da sua loja';
  const sub = pedidoIa
    ? 'Conecte o WhatsApp da loja e a IA atende seus clientes, monta o pedido e manda direto para o seu painel.'
    : 'Conecte o WhatsApp da loja e a atendente com IA responde seus clientes na hora, a qualquer momento.';
  const prazo = pedidoIa && info.ia_ate
    ? `<div class="wa-av-prazo"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>Pedido por IA liberado ${info.em_teste ? 'no seu teste ' : ''}até ${dataBR(info.ia_ate)}, sem custo</div>`
    : '';
  const extra = pedidoIa ? '' : (info.upgrade
    ? '<div class="wa-av-extra">Quer que a IA também anote os pedidos por texto e áudio? <button type="button" data-wa-av="upgrade" style="border:0;background:none;padding:0;color:#0f7a3f;font:inherit;font-weight:700;text-decoration:underline;cursor:pointer">Conheça os pedidos por IA</button></div>'
    : '<div class="wa-av-extra">Quer que a IA também anote os pedidos por texto e áudio? Fale com o nosso suporte para liberar.</div>');

  const el = document.createElement('div');
  el.id = 'wa-aviso';
  el.innerHTML = `
    <div class="wa-av-card" role="dialog" aria-modal="true" aria-labelledby="wa-av-titulo">
      <button class="wa-av-x" type="button" aria-label="Fechar" data-wa-av="depois"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      <div class="wa-av-vitrine" aria-hidden="true">
        <div class="wa-av-fone"><div class="wa-av-tela">
          <div class="wa-av-topo-chat">
            <span class="wa-av-avatar">${_AVISO_WA_ROBO}</span>
            <div><div class="wa-av-nome">Atendente IA da loja</div><div class="wa-av-status">online</div></div>
          </div>
          <div class="wa-av-chat"></div>
        </div></div>
        ${pedidoIa ? `<div class="wa-av-notif"><span class="wa-av-notif-ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 8.5h6M9 12h6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg></span><div><strong>Novo pedido nº 128 no painel</strong><span>Feito pela IA no WhatsApp, R$ 72,90</span></div></div>` : ''}
      </div>
      <div class="wa-av-info">
        <div class="wa-av-selo"><i></i>${pedidoIa ? 'Pedidos por IA' : 'Atendente com IA'}</div>
        <h2 id="wa-av-titulo">${titulo}</h2>
        <p class="wa-av-sub">${sub}</p>
        <ul class="wa-av-lista">${itens.map(([i, t, d]) => `<li><span class="wa-av-ic">${i}</span><div><strong>${t}</strong><span>${d}</span></div></li>`).join('')}</ul>
        ${prazo}${extra}
        <div class="wa-av-acoes">
          <button class="wa-av-btn" type="button" data-wa-av="conectar"><svg width="19" height="19" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M9.5 9.5h1.5v1.5M13.5 9.5v4h-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>Conectar meu WhatsApp</button>
          <p class="wa-av-nota">Leva menos de 1 minuto: é só ler um QR Code com o celular da loja.</p>
          <button class="wa-av-depois" type="button" data-wa-av="depois">Agora não</button>
        </div>
      </div>
    </div>`;
  el.addEventListener('click', ev => {
    const acao = ev.target.closest('[data-wa-av]')?.dataset.waAv;
    if (acao === 'conectar') avisoWaConectar();
    else if (acao === 'upgrade') { avisoWaFechar(true); upgradeIaAbrir(); }
    else if (acao === 'depois' || ev.target === el) avisoWaFechar(true);
  });
  el.addEventListener('keydown', ev => { if (ev.key === 'Escape') avisoWaFechar(true); });
  document.body.appendChild(el);
  el._parar = _avisoWaAnimar(el, _avisoWaRoteiro(pedidoIa), pedidoIa);
  setTimeout(() => el.querySelector('.wa-av-btn')?.focus({ preventScroll: true }), 80);
}

function avisoWaFechar(adiar) {
  const el = document.getElementById('wa-aviso');
  if (el) { try { el._parar && el._parar(); } catch (e) {} el.remove(); }
  if (adiar) { try { localStorage.setItem(_avisoWaChave(), _avisoWaHoje()); } catch (e) {} }
}
// Abre a aba Conexão do Robô e já gera o QR Code
async function avisoWaConectar() {
  avisoWaFechar(false);
  try {
    if (typeof nav === 'function') nav('robo');
    ['wp','auto','msgs','ia'].forEach(t => {
      document.getElementById('robo-tab-'+t)?.classList.toggle('on', t === 'wp');
      const s = document.getElementById('robo-section-'+t);
      if (s) s.style.display = t === 'wp' ? '' : 'none';
    });
    await waProviderInit();
    if (wuzConnected || evoConnected) return;
    if (document.getElementById('wuz-cards')?.style.display === 'block') await wuzConectar();
    else if (EVO.instance) await evoConectar();
  } catch (e) { console.warn('avisoWaConectar:', e); }
}

// ═══════════════════════════════════════
// POP-UP "CONECTE SEU WHATSAPP" (com tutorial e QR Code na própria janela)
// Abre ao entrar no gestor quando o WhatsApp da loja está desconectado.
// Mostra, num celular animado, onde tocar no WhatsApp para adicionar o
// dispositivo; "Conectar agora" gera o QR Code ali mesmo e fica conferindo
// até conectar. "Agora não" fecha até a próxima vez que o gestor abrir;
// "Não mostrar mais" desliga de vez neste aparelho.
// ═══════════════════════════════════════
let _wcpPoll = null, _wcpTour = null, _wcpAbertoNestaSessao = false;
function _wcpChaveNunca() { return 'estima_wa_conectar_nunca_' + (_sessao?.tenant_id || ''); }

// Retorna true se abriu o pop-up
async function waConectarPopupVerificar() {
  try {
    if (_wcpAbertoNestaSessao || document.getElementById('wcp')) return false;
    if (!_sessao?.tenant_id) return false;
    try { if (localStorage.getItem(_wcpChaveNunca()) === '1') return false; } catch (e) {}
    if (wuzConnected || evoConnected) return false;
    const r = await WUZ.req('GET', '/status');
    if (!r.ok || !r.data) return false;                       // servidor não respondeu: não arrisca
    if (r.data.wuzapi_configured === false) return false;     // servidor sem a conexão nova
    const st = String(r.data.status || '');
    if (st === 'connected') return false;
    if (/^erro/i.test(st)) return false;                      // WuzAPI fora do ar: não é culpa da loja
    if (r.data.provider !== 'wuzapi' && evoConnected) return false;
    waConectarPopupAbrir();
    return true;
  } catch (e) { console.warn('waConectarPopupVerificar:', e); return false; }
}

function _wcpCss() {
  if (document.getElementById('wcp-css')) return;
  const st = document.createElement('style');
  st.id = 'wcp-css';
  st.textContent = `
#wcp{position:fixed;inset:0;z-index:99991;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(6,14,11,.66);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)}
#wcp .wcp-card{position:relative;width:100%;max-width:880px;max-height:calc(100vh - 32px);overflow:auto;display:grid;grid-template-columns:340px 1fr;background:var(--surface,#fff);color:var(--text,#101828);border-radius:24px;box-shadow:0 30px 80px rgba(0,0,0,.45);animation:wcpIn .4s cubic-bezier(.2,.9,.3,1.12) both}
@keyframes wcpIn{from{opacity:0;transform:translateY(18px) scale(.97)}to{opacity:1;transform:none}}
#wcp .wcp-x{position:absolute;top:12px;right:12px;z-index:3;width:34px;height:34px;border-radius:50%;border:0;background:var(--surface2,#f1f5f9);color:var(--muted,#64748b);display:flex;align-items:center;justify-content:center;cursor:pointer}
#wcp .wcp-vit{position:relative;overflow:hidden;background:radial-gradient(110% 80% at 20% 10%,#1f8a5b 0%,#0f5238 50%,#0a3324 100%);padding:28px 22px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;min-height:540px}
#wcp .wcp-vit::before{content:"";position:absolute;width:420px;height:420px;border-radius:50%;border:1px solid rgba(255,255,255,.08);top:-160px;left:-170px}
#wcp .wcp-vit::after{content:"";position:absolute;width:300px;height:300px;border-radius:50%;border:1px solid rgba(255,255,255,.07);bottom:-140px;right:-130px}
#wcp .wcp-fone{position:relative;z-index:1;width:226px;height:452px;border-radius:36px;background:#0b0f0d;padding:9px;box-shadow:0 24px 50px rgba(0,0,0,.45),inset 0 0 0 2px #2b3a33}
#wcp .wcp-tela{position:relative;width:100%;height:100%;border-radius:28px;overflow:hidden;background:#fff;font-family:'DM Sans',system-ui,sans-serif;color:#111b21}
#wcp .wcp-tela::before{content:"";position:absolute;top:7px;left:50%;transform:translateX(-50%);width:62px;height:17px;border-radius:10px;background:#0b0f0d;z-index:6}
#wcp .wcp-cena{position:absolute;inset:0;opacity:0;transition:opacity .45s ease}
#wcp .wcp-cena.on{opacity:1}
#wcp .wcp-bar{background:#0f7a55;color:#fff;padding:32px 12px 10px;display:flex;align-items:center;gap:8px}
#wcp .wcp-bar b{flex:1;font-size:15px;font-weight:700;letter-spacing:.1px}
#wcp .wcp-bar .wcp-ic{width:18px;height:18px;opacity:.95}
#wcp .wcp-dots{position:relative;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center}
#wcp .wcp-abas{display:flex;background:#0f7a55;color:rgba(255,255,255,.75);font-size:10.5px;font-weight:700}
#wcp .wcp-abas span{flex:1;text-align:center;padding:7px 0}
#wcp .wcp-abas span:first-child{color:#fff;border-bottom:2.5px solid #fff}
#wcp .wcp-conv{display:flex;align-items:center;gap:9px;padding:9px 12px;border-bottom:1px solid #eef1f0}
#wcp .wcp-av{width:32px;height:32px;border-radius:50%;flex-shrink:0}
#wcp .wcp-ln{height:7px;border-radius:4px;background:#e3e8e6}
#wcp .wcp-menu{position:absolute;top:30px;right:8px;width:150px;background:#fff;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.22);padding:5px 0;font-size:11px;z-index:4}
#wcp .wcp-menu div{padding:8px 12px;color:#3b4a54}
#wcp .wcp-menu .wcp-alvo{background:#e7f6ee;color:#0f5238;font-weight:700}
#wcp .wcp-topo2{background:#0f7a55;color:#fff;padding:32px 12px 12px;font-size:13px;font-weight:700;display:flex;align-items:center;gap:8px}
#wcp .wcp-disp{padding:18px 14px;text-align:center}
#wcp .wcp-disp-ilu{width:120px;height:74px;margin:6px auto 12px;border-radius:12px;background:#e7f6ee;display:flex;align-items:center;justify-content:center}
#wcp .wcp-disp p{font-size:10.5px;color:#54656f;line-height:1.45;margin:0 0 14px}
#wcp .wcp-disp-btn{position:relative;display:block;width:100%;padding:10px 0;border-radius:20px;background:#0f7a55;color:#fff;font-size:11.5px;font-weight:700}
#wcp .wcp-cam{position:absolute;inset:0;background:linear-gradient(160deg,#1d2622,#0b100e);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px}
#wcp .wcp-mira{position:relative;width:150px;height:150px}
#wcp .wcp-mira i{position:absolute;width:30px;height:30px;border-color:#3ddc84;border-style:solid}
#wcp .wcp-mira i:nth-child(1){top:0;left:0;border-width:3px 0 0 3px;border-radius:8px 0 0 0}
#wcp .wcp-mira i:nth-child(2){top:0;right:0;border-width:3px 3px 0 0;border-radius:0 8px 0 0}
#wcp .wcp-mira i:nth-child(3){bottom:0;left:0;border-width:0 0 3px 3px;border-radius:0 0 0 8px}
#wcp .wcp-mira i:nth-child(4){bottom:0;right:0;border-width:0 3px 3px 0;border-radius:0 0 8px 0}
#wcp .wcp-mira .wcp-qrmini{position:absolute;inset:22px;border-radius:6px;background:#fff;opacity:.92;display:flex;align-items:center;justify-content:center}
#wcp .wcp-mira .wcp-scan{position:absolute;left:10px;right:10px;height:2px;background:#3ddc84;box-shadow:0 0 12px #3ddc84;top:12px;animation:wcpScan 1.8s ease-in-out infinite alternate}
@keyframes wcpScan{to{top:136px}}
#wcp .wcp-cam small{color:#d6e2dc;font-size:10.5px;text-align:center;padding:0 22px;line-height:1.45}
#wcp .wcp-toque{position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;background:rgba(255,255,255,.55);border:2px solid #fff;box-shadow:0 0 0 0 rgba(255,255,255,.6);z-index:7;pointer-events:none;opacity:0;transition:left .5s ease,top .5s ease,opacity .3s}
#wcp .wcp-toque.on{opacity:1;animation:wcpToque 1.3s ease-out infinite}
@keyframes wcpToque{0%{box-shadow:0 0 0 0 rgba(255,255,255,.7);transform:scale(1)}50%{transform:scale(.82)}100%{box-shadow:0 0 0 16px rgba(255,255,255,0);transform:scale(1)}}
#wcp .wcp-leg{position:relative;z-index:1;color:#e3f3ea;font-size:12.5px;font-weight:600;text-align:center;min-height:34px;max-width:260px;line-height:1.4}
#wcp .wcp-info{padding:34px 34px 26px;display:flex;flex-direction:column}
#wcp h2{font-size:24px;line-height:1.18;font-weight:800;margin:0 0 8px;letter-spacing:-.3px;max-width:22ch}
#wcp .wcp-sub{font-size:14px;line-height:1.5;color:var(--muted,#64748b);margin:0 0 20px;max-width:52ch}
#wcp .wcp-passos{list-style:none;margin:0 0 20px;padding:0;display:flex;flex-direction:column;gap:6px}
#wcp .wcp-passos li{display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border-radius:14px;border:1px solid transparent;transition:background .3s,border-color .3s;cursor:pointer}
#wcp .wcp-passos li.on{background:rgba(22,163,74,.08);border-color:rgba(22,163,74,.28)}
#wcp .wcp-n{width:26px;height:26px;border-radius:50%;background:var(--surface2,#f1f5f9);color:var(--muted,#64748b);font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .3s,color .3s}
#wcp .wcp-passos li.on .wcp-n{background:#16a34a;color:#fff}
#wcp .wcp-passos strong{display:block;font-size:14px;font-weight:700;margin-bottom:2px}
#wcp .wcp-passos li div>span{display:block;font-size:12.5px;color:var(--muted,#64748b);line-height:1.45}
#wcp .wcp-btn{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;border:0;border-radius:14px;padding:15px 18px;background:#16a34a;color:#fff;font:inherit;font-size:15.5px;font-weight:800;cursor:pointer;box-shadow:0 10px 24px rgba(22,163,74,.32);transition:transform .15s,box-shadow .15s}
#wcp .wcp-btn:hover{transform:translateY(-1px);box-shadow:0 14px 28px rgba(22,163,74,.38)}
#wcp .wcp-btn:disabled{opacity:.7;cursor:wait;transform:none}
#wcp .wcp-nota{display:flex;gap:9px;align-items:flex-start;margin-top:14px;padding:10px 12px;border-radius:12px;background:var(--surface2,#f1f5f9);font-size:12px;line-height:1.45;color:var(--muted,#64748b)}
#wcp .wcp-rodape{display:flex;justify-content:space-between;gap:10px;margin-top:auto;padding-top:18px}
#wcp .wcp-rodape button{border:0;background:none;font:inherit;font-size:13px;font-weight:700;color:var(--muted,#64748b);cursor:pointer;padding:8px 4px}
#wcp .wcp-rodape .wcp-nunca{text-decoration:underline;text-underline-offset:3px;font-weight:600}
#wcp .wcp-qrbox{display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;padding:6px 0 4px}
#wcp .wcp-qr{position:relative;width:236px;height:236px;border-radius:18px;background:#fff;padding:10px;border:2px solid rgba(22,163,74,.45);box-shadow:0 12px 30px rgba(0,0,0,.12);display:flex;align-items:center;justify-content:center}
#wcp .wcp-qr img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated}
#wcp .wcp-qr .wcp-gira{width:34px;height:34px;border-radius:50%;border:3px solid #d1fae5;border-top-color:#16a34a;animation:wcpGira .8s linear infinite}
@keyframes wcpGira{to{transform:rotate(360deg)}}
#wcp .wcp-espera{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#15803d}
#wcp .wcp-espera i{width:8px;height:8px;border-radius:50%;background:#16a34a;animation:wcpPulso 1.2s ease-in-out infinite}
@keyframes wcpPulso{50%{opacity:.25}}
#wcp .wcp-link{border:0;background:none;color:#15803d;font:inherit;font-size:13px;font-weight:700;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
#wcp .wcp-ok{width:72px;height:72px;border-radius:50%;background:rgba(22,163,74,.12);color:#16a34a;display:flex;align-items:center;justify-content:center;margin:24px auto 6px;animation:wcpIn .4s ease both}
#wcp .wcp-erro{font-size:13px;color:#b42318;background:#fef3f2;border:1px solid #fecdca;border-radius:12px;padding:10px 12px;text-align:left}
#wcp button:focus-visible,#wcp li:focus-visible{outline:2px solid #16a34a;outline-offset:2px}
@media(max-width:760px){
  #wcp{padding:0;align-items:flex-end}
  #wcp .wcp-card{grid-template-columns:1fr;border-radius:22px 22px 0 0;max-height:94vh}
  #wcp .wcp-vit{min-height:0;padding:20px 16px 14px;flex-direction:row;gap:14px}
  #wcp .wcp-fone{width:130px;height:260px;border-radius:24px;padding:6px;flex-shrink:0}
  #wcp .wcp-tela{border-radius:19px;zoom:.57}
  #wcp .wcp-leg{text-align:left;font-size:13px}
  #wcp .wcp-info{padding:20px 16px 16px}
  #wcp h2{font-size:20px}
  #wcp .wcp-sub{margin-bottom:14px}
  #wcp .wcp-passos{gap:2px;margin-bottom:14px}
  #wcp .wcp-passos li{padding:8px 10px}
  #wcp .wcp-btn{position:sticky;bottom:12px;z-index:2}
  #wcp .wcp-qr{width:210px;height:210px}
}
@media(prefers-reduced-motion:reduce){
  #wcp .wcp-card,#wcp .wcp-toque.on,#wcp .wcp-mira .wcp-scan,#wcp .wcp-espera i{animation:none}
  #wcp .wcp-cena{transition:none}
}`;
  document.head.appendChild(st);
}

// As 4 cenas do celular (tela inicial, menu, aparelhos conectados, câmera)
function _wcpCenasHtml() {
  const conv = (cor, w1, w2) => `<div class="wcp-conv"><span class="wcp-av" style="background:${cor}"></span><div style="flex:1"><div class="wcp-ln" style="width:${w1}%;margin-bottom:6px;background:#cfd8d4"></div><div class="wcp-ln" style="width:${w2}%"></div></div></div>`;
  const lista = conv('#f6c9a8', 52, 78) + conv('#b8d8f0', 40, 66) + conv('#d6c6ef', 58, 72) + conv('#c9ecd6', 46, 60) + conv('#f3d7a0', 50, 70) + conv('#f0b8c8', 36, 58);
  const tresPontos = '<svg width="16" height="16" viewBox="0 0 16 16" fill="#fff"><circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>';
  const lupa = '<svg class="wcp-ic" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg>';
  const camIc = '<svg class="wcp-ic" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  const topo = `<div class="wcp-bar"><b>WhatsApp</b>${camIc}${lupa}<span class="wcp-dots">${tresPontos}</span></div><div class="wcp-abas"><span>Conversas</span><span>Atualizações</span><span>Ligações</span></div>`;
  const qrMini = '<svg width="80" height="80" viewBox="0 0 21 21" shape-rendering="crispEdges"><path fill="#111" d="M0 0h7v7H0zM1 1v5h5V1zM2 2h3v3H2zM14 0h7v7h-7zM15 1v5h5V1zM16 2h3v3h-3zM0 14h7v7H0zM1 15v5h5v-5zM2 16h3v3H2zM9 0h2v2H9zM12 2h1v3h-1zM9 4h2v2H9zM8 8h3v1H8zM13 8h2v2h-2zM17 9h3v1h-3zM9 11h1v3H9zM11 12h3v2h-3zM15 12h2v1h-2zM18 12h3v2h-3zM14 15h2v2h-2zM17 16h4v1h-4zM9 16h3v1H9zM10 18h2v3h-2zM13 18h3v1h-3zM16 19h2v2h-2zM19 18h2v3h-2z"/></svg>';
  return `
    <div class="wcp-cena" data-c="0">${topo}${lista}</div>
    <div class="wcp-cena" data-c="1">${topo}${lista}
      <div class="wcp-menu"><div>Novo grupo</div><div>Nova transmissão</div><div class="wcp-alvo">Dispositivos conectados</div><div>Mensagens favoritas</div><div>Configurações</div></div>
    </div>
    <div class="wcp-cena" data-c="2">
      <div class="wcp-topo2"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M10 3L5 8l5 5"/></svg>Dispositivos conectados</div>
      <div class="wcp-disp">
        <div class="wcp-disp-ilu"><svg width="70" height="46" viewBox="0 0 70 46" fill="none"><rect x="4" y="4" width="44" height="30" rx="3" stroke="#0f7a55" stroke-width="2.5"/><path d="M1 40h50" stroke="#0f7a55" stroke-width="2.5" stroke-linecap="round"/><rect x="52" y="12" width="15" height="28" rx="3" stroke="#0f7a55" stroke-width="2.5"/></svg></div>
        <p>Use o WhatsApp em outros aparelhos, como o computador da loja.</p>
        <span class="wcp-disp-btn">Conectar dispositivo</span>
      </div>
    </div>
    <div class="wcp-cena" data-c="3"><div class="wcp-cam">
      <div class="wcp-mira"><i></i><i></i><i></i><i></i><div class="wcp-qrmini">${qrMini}</div><div class="wcp-scan"></div></div>
      <small>Aponte a câmera para o QR Code que aparece no painel</small>
    </div></div>
    <div class="wcp-toque"></div>`;
}

// Passos do tutorial: texto, legenda do celular e onde cai o "toque" (% da tela)
const _WCP_PASSOS = [
  { t: 'Abra o WhatsApp da loja', d: 'No celular que atende os clientes, abra o WhatsApp na tela de conversas.', leg: 'Abra o WhatsApp no celular da loja', toque: null },
  { t: 'Toque nos três pontinhos', d: 'No canto de cima. No iPhone, toque em Configurações, embaixo.', leg: 'Toque nos três pontinhos no canto de cima', toque: [88, 9] },
  { t: 'Entre em Dispositivos conectados', d: 'Depois toque no botão verde Conectar dispositivo.', leg: 'Dispositivos conectados e depois Conectar dispositivo', toque: [60, 27] },
  { t: 'Aponte a câmera para o QR Code', d: 'Toque em Conectar agora aqui embaixo e leia o código que aparecer.', leg: 'Aponte a câmera para o QR Code do painel', toque: null }
];

function _wcpMostrarPasso(i) {
  const el = document.getElementById('wcp');
  if (!el) return;
  // cena do celular: o passo 3 tem duas telas (menu e depois o botão)
  const cena = i === 0 ? 0 : i === 1 ? 0 : i === 2 ? 1 : 3;
  el.querySelectorAll('.wcp-cena').forEach(c => c.classList.toggle('on', Number(c.dataset.c) === cena));
  el.querySelectorAll('.wcp-passos li').forEach((li, k) => li.classList.toggle('on', k === i));
  const leg = el.querySelector('.wcp-leg');
  if (leg) leg.textContent = _WCP_PASSOS[i].leg;
  const toque = el.querySelector('.wcp-toque');
  const alvo = _WCP_PASSOS[i].toque;
  if (toque) {
    if (alvo) { toque.style.left = alvo[0] + '%'; toque.style.top = alvo[1] + '%'; toque.classList.add('on'); }
    else toque.classList.remove('on');
  }
  // no passo 3, depois de um instante, troca do menu para a tela do botão verde
  if (i === 2) {
    clearTimeout(el._sub);
    el._sub = setTimeout(() => {
      if (!document.getElementById('wcp') || !el.querySelector('.wcp-passos li.on')?.isSameNode(el.querySelectorAll('.wcp-passos li')[2])) return;
      el.querySelectorAll('.wcp-cena').forEach(c => c.classList.toggle('on', c.dataset.c === '2'));
      if (toque) { toque.style.left = '50%'; toque.style.top = '58%'; }
    }, 1700);
  }
}

function _wcpTourIniciar(deOnde) {
  _wcpTourParar();
  let i = typeof deOnde === 'number' ? deOnde : 0;
  _wcpMostrarPasso(i);
  _wcpTour = setInterval(() => { i = (i + 1) % _WCP_PASSOS.length; _wcpMostrarPasso(i); }, 3400);
}
function _wcpTourParar() { if (_wcpTour) { clearInterval(_wcpTour); _wcpTour = null; } }

function waConectarPopupAbrir() {
  if (document.getElementById('wcp')) return;
  _wcpCss();
  _wcpAbertoNestaSessao = true;
  const el = document.createElement('div');
  el.id = 'wcp';
  el.innerHTML = `
    <div class="wcp-card" role="dialog" aria-modal="true" aria-labelledby="wcp-titulo">
      <button class="wcp-x" type="button" aria-label="Fechar" data-wcp="depois"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      <div class="wcp-vit" aria-hidden="true">
        <div class="wcp-fone"><div class="wcp-tela">${_wcpCenasHtml()}</div></div>
        <div class="wcp-leg"></div>
      </div>
      <div class="wcp-info" id="wcp-info">${_wcpPainelInicialHtml()}</div>
    </div>`;
  el.addEventListener('click', ev => {
    const alvo = ev.target.closest('[data-wcp]');
    const acao = alvo?.dataset.wcp;
    if (acao === 'conectar') _wcpConectar();
    else if (acao === 'novo') _wcpConectar();
    else if (acao === 'depois' || acao === 'concluir') waConectarPopupFechar();
    else if (acao === 'nunca') { try { localStorage.setItem(_wcpChaveNunca(), '1'); } catch (e) {} waConectarPopupFechar(); sbToast('ok', 'Tudo bem. Para conectar depois, vá em Robô, na aba Conexão.'); }
    else if (acao === 'passo') { _wcpTourIniciar(Number(alvo.dataset.i)); }
  });
  el.addEventListener('keydown', ev => { if (ev.key === 'Escape') waConectarPopupFechar(); });
  document.body.appendChild(el);
  _wcpTourIniciar(0);
  setTimeout(() => el.querySelector('.wcp-btn')?.focus({ preventScroll: true }), 80);
}

function _wcpPainelInicialHtml() {
  return `
    <h2 id="wcp-titulo">Conecte o WhatsApp da sua loja</h2>
    <p class="wcp-sub">Com o WhatsApp conectado, o robô responde seus clientes e as mensagens de pedido saem sozinhas. Leva menos de 1 minuto.</p>
    <ol class="wcp-passos">${_WCP_PASSOS.map((p, i) => `<li data-wcp="passo" data-i="${i}" tabindex="0"><span class="wcp-n">${i + 1}</span><div><strong>${p.t}</strong><span>${p.d}</span></div></li>`).join('')}</ol>
    <button class="wcp-btn" type="button" data-wcp="conectar"><svg width="19" height="19" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M9.5 9.5h1.5v1.5M13.5 9.5v4h-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>Conectar agora</button>
    <div class="wcp-nota"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="flex-shrink:0;margin-top:1px"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 7v4M8 4.8v.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><span>Está usando o painel no mesmo celular do WhatsApp da loja? Abra o painel em um computador ou em outro celular para conseguir ler o código.</span></div>
    ${_wcpRodapeHtml()}`;
}
function _wcpRodapeHtml() {
  return `<div class="wcp-rodape"><button type="button" class="wcp-nunca" data-wcp="nunca">Não mostrar mais</button><button type="button" data-wcp="depois">Agora não</button></div>`;
}

async function _wcpConectar() {
  const info = document.getElementById('wcp-info');
  if (!info) return;
  // celular fica na tela da câmera enquanto o QR Code está na tela
  _wcpTourParar();
  _wcpMostrarPasso(3);
  info.innerHTML = `
    <h2 id="wcp-titulo">Leia o QR Code com o WhatsApp da loja</h2>
    <p class="wcp-sub">No celular: três pontinhos (ou Configurações no iPhone), Dispositivos conectados, Conectar dispositivo. Depois aponte a câmera para o código.</p>
    <div class="wcp-qrbox">
      <div class="wcp-qr" id="wcp-qr"><div class="wcp-gira" aria-label="Gerando o QR Code"></div></div>
      <div class="wcp-espera" id="wcp-espera"><i></i>Gerando o código, pode levar até 20 segundos</div>
    </div>
    ${_wcpRodapeHtml()}`;
  if (_wcpPoll) { clearInterval(_wcpPoll); _wcpPoll = null; }

  // Loja que estava na conexão antiga passa a usar a nova (igual ao botão da aba Conexão)
  if (_waTrocarAoConectar || _waProvider !== 'wuzapi') {
    const ok = await waProviderChange('wuzapi');
    if (!ok) { _wcpErro('Não foi possível preparar a conexão agora.'); return; }
    _waTrocarAoConectar = false;
  }
  const r = await WUZ.req('POST', '/connect', {});
  if (!document.getElementById('wcp')) return;
  if (!r.ok) { _wcpErro('Não foi possível gerar o QR Code agora.', r); return; }
  if (r.data?.status === 'connected') { _wcpSucesso(); return; }
  if (r.data?.qr) _wcpMostrarQr(r.data.qr);

  let tentativas = 0;
  _wcpPoll = setInterval(async () => {
    if (!document.getElementById('wcp')) { clearInterval(_wcpPoll); _wcpPoll = null; return; }
    tentativas++;
    const q = await WUZ.req('GET', '/qr');
    if (q.data?.status === 'connected') { clearInterval(_wcpPoll); _wcpPoll = null; _wcpSucesso(); return; }
    if (q.data?.qr) _wcpMostrarQr(q.data.qr);
    if (tentativas > 45) { // ~3 minutos sem ler
      clearInterval(_wcpPoll); _wcpPoll = null;
      const box = document.getElementById('wcp-qr');
      if (box) box.innerHTML = '<div style="font-size:13px;color:var(--muted,#64748b);padding:16px;text-align:center">O código expirou</div>';
      const esp = document.getElementById('wcp-espera');
      if (esp) esp.outerHTML = '<button type="button" class="wcp-link" data-wcp="novo">Gerar novo código</button>';
    }
  }, 4000);
}

function _wcpMostrarQr(src) {
  const box = document.getElementById('wcp-qr');
  if (!box) return;
  const img = box.querySelector('img');
  if (img) { if (img.src !== src) img.src = src; }
  else box.innerHTML = `<img src="${src}" alt="QR Code para conectar o WhatsApp">`;
  const esp = document.getElementById('wcp-espera');
  if (esp && !esp.dataset.lendo) { esp.dataset.lendo = '1'; esp.innerHTML = '<i></i>Aguardando a leitura. O código se atualiza sozinho'; }
}

function _wcpErro(msg, r) {
  const info = document.getElementById('wcp-info');
  if (!info) return;
  const det = (typeof _wuzDetalheErro === 'function' && r) ? _wuzDetalheErro(r) : '';
  info.innerHTML = `
    <h2 id="wcp-titulo">Não deu certo desta vez</h2>
    <div class="wcp-erro">${msg} Tente de novo em instantes. Se continuar, fale com o suporte.${det}</div>
    <button class="wcp-btn" type="button" data-wcp="novo" style="margin-top:18px">Tentar de novo</button>
    ${_wcpRodapeHtml()}`;
}

function _wcpSucesso() {
  const info = document.getElementById('wcp-info');
  if (info) info.innerHTML = `
    <div style="text-align:center;margin:auto 0">
      <div class="wcp-ok"><svg width="34" height="34" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <h2 id="wcp-titulo" style="margin:10px auto 8px">WhatsApp conectado</h2>
      <p class="wcp-sub" style="margin:0 auto 22px">O robô e as mensagens automáticas já estão funcionando pelo número da loja.</p>
      <button class="wcp-btn" type="button" data-wcp="concluir">Concluir</button>
    </div>`;
  const leg = document.querySelector('#wcp .wcp-leg');
  if (leg) leg.textContent = 'Pronto, conectado';
  try { wuzCheckStatus(); } catch (e) {}
  try { if (typeof iaAtivarTudoAoConectar === 'function') iaAtivarTudoAoConectar(); } catch (e) {}
  sbToast('ok', 'WhatsApp conectado!');
}

function waConectarPopupFechar() {
  _wcpTourParar();
  if (_wcpPoll) { clearInterval(_wcpPoll); _wcpPoll = null; }
  const el = document.getElementById('wcp');
  if (el) { clearTimeout(el._sub); el.remove(); }
}

// ═══════════════════════════════════════
// UPGRADE: PEDIDOS POR IA
// O admin liga a oferta em Upgrade IA. Ela abre sozinha ao entrar no painel,
// no máximo uma vez por dia e até o número de vezes que o admin escolheu.
// O cliente paga por Pix só a diferença proporcional até o vencimento; com o
// Pix aprovado, o adicional liga sozinho e entra nas próximas faturas.
// ═══════════════════════════════════════
function _upHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (_sessao?.tenant_id) h['x-tenant-id'] = _sessao.tenant_id;
  if (_sessao?.token) h['Authorization'] = 'Bearer ' + _sessao.token;
  return h;
}
async function _upApi(metodo, caminho, corpo) {
  const r = await fetch('/api/site/upgrade-ia' + caminho, { method: metodo, headers: _upHeaders(), body: corpo ? JSON.stringify(corpo) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Não foi possível concluir agora.');
  return d;
}
const _upBRL = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const _upData = s => String(s || '').slice(0, 10).split('-').reverse().slice(0, 2).join('/');
let _upInfo = null;

async function upgradeIaInfo() {
  try { _upInfo = await _upApi('GET', ''); } catch (e) { _upInfo = null; }
  return _upInfo;
}

// Ao abrir o painel: primeiro a oferta de upgrade; se não for a vez dela, o aviso do WhatsApp
async function avisosDoPainel() {
  try {
    const up = await upgradeIaInfo();
    if (up?.disponivel && up.mostrar && !document.getElementById('wa-aviso')) { upgradeIaMostrar(up, true); return; }
  } catch (e) {}
  // WhatsApp desconectado: janela de conexão com tutorial (até "Não mostrar mais")
  try { if (typeof waConectarPopupVerificar === 'function' && await waConectarPopupVerificar()) return; } catch (e) {}
  if (typeof avisoWhatsappVerificar === 'function') avisoWhatsappVerificar();
}

function _upCss() {
  _avisoWaCss();
  if (document.getElementById('wa-up-css')) return;
  const st = document.createElement('style');
  st.id = 'wa-up-css';
  st.textContent = `
  #wa-aviso.wa-up .wa-av-info{padding:36px 38px 26px}
  #wa-aviso.wa-up h2{font-size:26px}
  #wa-aviso.wa-up .wa-av-sub{margin-bottom:18px}
  #wa-aviso.wa-up .wa-av-lista{gap:11px;margin-bottom:18px}
  #wa-aviso .wa-up-preco{border:1px solid var(--border,#e4e7ec);border-radius:16px;padding:14px 16px;margin:0 0 12px}
  #wa-aviso .wa-up-linha{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:13.5px;color:var(--muted,#667085);padding:3px 0}
  #wa-aviso .wa-up-linha b{font-weight:700;color:var(--text,#101828);font-variant-numeric:tabular-nums}
  #wa-aviso .wa-up-linha.add b{color:#0f7a3f}
  #wa-aviso .wa-up-linha.total{border-top:1px solid var(--border,#e4e7ec);margin-top:7px;padding-top:10px;color:var(--text,#101828);font-weight:700;font-size:14.5px}
  #wa-aviso .wa-up-linha.total b{font-size:20px;font-weight:800;letter-spacing:-.01em}
  #wa-aviso .wa-up-linha.total small{font-size:12px;font-weight:600;color:var(--muted,#667085);margin-left:2px}
  #wa-aviso .wa-up-hoje{display:flex;gap:12px;align-items:flex-start;background:rgba(37,211,102,.09);border:1px solid rgba(37,211,102,.3);border-radius:14px;padding:12px 14px;margin:0 0 18px}
  #wa-aviso .wa-up-hoje-ic{width:34px;height:34px;border-radius:10px;background:#128C4A;color:#fff;display:flex;align-items:center;justify-content:center;flex:0 0 34px}
  #wa-aviso .wa-up-hoje strong{display:block;font-size:14px;color:#0f5f33;line-height:1.3}
  #wa-aviso .wa-up-hoje strong em{font-style:normal;font-size:17px}
  #wa-aviso .wa-up-hoje p{margin:2px 0 0;font-size:12.5px;line-height:1.45;color:var(--muted,#667085)}
  #wa-aviso .wa-up-voltar{align-self:flex-start;border:0;background:none;color:var(--muted,#667085);font:inherit;font-size:13px;font-weight:600;padding:4px 0;margin:-6px 0 12px;cursor:pointer;display:flex;align-items:center;gap:6px}
  #wa-aviso .wa-up-valor{font-size:34px;font-weight:800;letter-spacing:-.02em;margin:0 0 4px;font-variant-numeric:tabular-nums}
  #wa-aviso .wa-up-qr{display:flex;justify-content:center;margin:14px 0}
  #wa-aviso .wa-up-qr img{width:196px;height:196px;border-radius:14px;border:1px solid var(--border,#e4e7ec);padding:8px;background:#fff}
  #wa-aviso .wa-up-copiar{width:100%;border:1.5px solid #128C4A;background:transparent;color:#0f7a3f;border-radius:14px;padding:13px 16px;font:inherit;font-size:14.5px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:9px}
  #wa-aviso .wa-up-copiar:hover{background:rgba(37,211,102,.08)}
  #wa-aviso .wa-up-espera{display:flex;align-items:center;gap:10px;font-size:13.5px;font-weight:600;margin:16px 0 6px}
  #wa-aviso .wa-up-gira{width:18px;height:18px;border-radius:50%;border:2.5px solid rgba(18,140,74,.25);border-top-color:#128C4A;animation:waUpGira .8s linear infinite;flex:0 0 18px}
  #wa-aviso .wa-up-ok{width:64px;height:64px;border-radius:50%;background:#128C4A;color:#fff;display:flex;align-items:center;justify-content:center;margin:6px 0 18px;animation:waUpOk .5s cubic-bezier(.2,.9,.3,1.4) both;box-shadow:0 0 0 10px rgba(37,211,102,.14)}
  #wa-aviso .wa-up-erro{font-size:13px;color:#b42318;background:rgba(240,68,56,.08);border-radius:10px;padding:9px 12px;margin:0 0 12px}
  @keyframes waUpGira{to{transform:rotate(360deg)}}
  @keyframes waUpOk{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}
  @media (max-width:760px){
    #wa-aviso.wa-up .wa-av-info{padding:20px 20px 0}
    #wa-aviso.wa-up h2{font-size:21px}
    #wa-aviso .wa-up-preco{padding:11px 13px}
    #wa-aviso .wa-up-linha.total b{font-size:18px}
    #wa-aviso .wa-up-hoje{margin-bottom:12px}
    #wa-aviso .wa-up-qr img{width:170px;height:170px}
  }`;
  document.head.appendChild(st);
}

const _UP_IC = {
  audio: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  painel: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4" width="17" height="13" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M8 21h8M12 17v4M8 9.5l2.5 2.5L16 7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  relogio: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  raio: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 2.5L4.5 13.5h6.5l-1 8 8.5-11h-6.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  pix: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2.8l3.6 3.6-3.6 3.6-3.6-3.6zM12 14l3.6 3.6-3.6 3.6-3.6-3.6zM2.8 12l3.6-3.6L10 12l-3.6 3.6zM14 12l3.6-3.6 3.6 3.6-3.6 3.6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  copiar: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" stroke="currentColor" stroke-width="1.8"/></svg>',
  voltar: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

function upgradeIaMostrar(info, automatico) {
  if (!info?.disponivel) return;
  avisoWaFechar(false);
  _upCss();
  const el = document.createElement('div');
  el.id = 'wa-aviso';
  el.className = 'wa-up';
  el.innerHTML = `
    <div class="wa-av-card" role="dialog" aria-modal="true" aria-labelledby="wa-av-titulo">
      <button class="wa-av-x" type="button" aria-label="Fechar" data-up="fechar"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      <div class="wa-av-vitrine" aria-hidden="true">
        <div class="wa-av-fone"><div class="wa-av-tela">
          <div class="wa-av-topo-chat">
            <span class="wa-av-avatar">${_AVISO_WA_ROBO}</span>
            <div><div class="wa-av-nome">Atendente IA da loja</div><div class="wa-av-status">online</div></div>
          </div>
          <div class="wa-av-chat"></div>
        </div></div>
        <div class="wa-av-notif"><span class="wa-av-notif-ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 8.5h6M9 12h6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg></span><div><strong>Novo pedido nº 128 no painel</strong><span>Feito pela IA no WhatsApp, R$ 72,90</span></div></div>
      </div>
      <div class="wa-av-info"></div>
    </div>`;
  const pararChat = _avisoWaAnimar(el, _avisoWaRoteiro(true), true);
  let pararPix = () => {};
  el._parar = () => { pararChat(); pararPix(); };
  const info$ = el.querySelector('.wa-av-info');
  const focar = () => setTimeout(() => el.querySelector('.wa-av-btn, .wa-up-copiar')?.focus({ preventScroll: true }), 60);

  function telaOferta(erro) {
    const selo = info.ia_teste_ate ? `Seu teste da IA vai até ${_upData(info.ia_teste_ate)}` : 'Novo para a sua loja';
    const hoje = `Proporcional ${info.vencimento ? `aos ${info.dias} dias até o seu vencimento em ${_upData(info.vencimento)}` : 'ao primeiro mês'}. Depois, a fatura já vem com o novo valor.${info.inclui_proximo ? ` Inclui o adicional da fatura de ${_upData(info.fatura_venc)}, que já foi gerada.` : ''}`;
    info$.innerHTML = `
      <div class="wa-av-selo"><i></i>${selo}</div>
      <h2 id="wa-av-titulo">Ative os pedidos por IA no seu WhatsApp</h2>
      <p class="wa-av-sub">A IA atende seus clientes, entende texto e áudio, monta o pedido e manda direto para o seu painel. Nenhum pedido fica sem resposta, nem no horário de pico.</p>
      <ul class="wa-av-lista">
        <li><span class="wa-av-ic">${_UP_IC.audio}</span><div><strong>Entende texto e áudio</strong><span>O cliente fala do jeito dele e a IA monta o pedido certinho.</span></div></li>
        <li><span class="wa-av-ic">${_UP_IC.painel}</span><div><strong>Pedido cai direto no painel</strong><span>Confirmado com o cliente, entra na sua tela pronto para a cozinha.</span></div></li>
        <li><span class="wa-av-ic">${_UP_IC.relogio}</span><div><strong>Atende 24 horas</strong><span>Cardápio, horário, taxa de entrega e promoções, sem você parar.</span></div></li>
      </ul>
      <div class="wa-up-preco">
        <div class="wa-up-linha"><span>Sua mensalidade hoje</span><b>${_upBRL(info.base)}</b></div>
        <div class="wa-up-linha add"><span>Pedidos por IA</span><b>+ ${_upBRL(info.preco)}</b></div>
        <div class="wa-up-linha total"><span>Nova mensalidade</span><span><b>${_upBRL(info.nova)}</b><small>/mês</small></span></div>
      </div>
      <div class="wa-up-hoje"><span class="wa-up-hoje-ic">${_UP_IC.raio}</span><div><strong>Para ativar hoje: <em>${_upBRL(info.valor_hoje)}</em></strong><p>${hoje}</p></div></div>
      ${erro ? `<div class="wa-up-erro" role="alert">${erro}</div>` : ''}
      <div class="wa-av-acoes">
        <button class="wa-av-btn" type="button" data-up="pagar">${_UP_IC.raio}Ativar pedidos por IA</button>
        <p class="wa-av-nota">Pagamento por Pix. A IA liga assim que o Pix for aprovado.</p>
        <button class="wa-av-depois" type="button" data-up="fechar">Agora não</button>
      </div>`;
  }

  function telaPix(p) {
    const temImg = !!p.qr_code_base64;
    info$.innerHTML = `
      <button class="wa-up-voltar" type="button" data-up="voltar">${_UP_IC.voltar}Voltar</button>
      <div class="wa-av-selo"><i></i>Pix gerado</div>
      <h2 id="wa-av-titulo">Pague com Pix para ativar</h2>
      <div class="wa-up-valor">${_upBRL(p.valor)}</div>
      <p class="wa-av-sub" style="margin-bottom:6px">Abra o app do seu banco, escolha Pix e ${temImg ? 'leia o QR Code ou ' : ''}use o código copia e cola.</p>
      ${temImg ? `<div class="wa-up-qr"><img alt="QR Code do Pix" src="data:image/png;base64,${p.qr_code_base64}"></div>` : ''}
      <div class="wa-up-espera" role="status"><span class="wa-up-gira"></span><span>Aguardando o pagamento<span data-up-tempo></span></span></div>
      <p class="wa-av-sub" style="font-size:12.5px;margin-bottom:16px">Assim que o banco confirmar, os pedidos por IA ligam sozinhos. Pode deixar esta tela aberta.</p>
      <div class="wa-av-acoes">
        <button class="wa-up-copiar" type="button" data-up="copiar">${_UP_IC.copiar}<span>Copiar código Pix</span></button>
        <button class="wa-av-depois" type="button" data-up="fechar">Pagar depois</button>
      </div>`;
    el._pix = p;
    pararPix();
    const fim = p.pix_expira ? Date.parse(p.pix_expira) : 0;
    const relogio = setInterval(() => {
      const t = info$.querySelector('[data-up-tempo]');
      if (!t || !fim) return;
      const s = Math.max(0, Math.round((fim - Date.now()) / 1000));
      t.textContent = s > 0 ? ` (vence em ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})` : '';
    }, 1000);
    const consulta = setInterval(async () => {
      if (!document.body.contains(el)) { pararPix(); return; }
      try {
        const r = await _upApi('GET', `/pagamento?id=${p.id}&chave=${p.chave}`);
        if (r.status === 'aprovado') { pararPix(); telaSucesso(r); }
        else if (r.status === 'expirado' || r.status === 'erro') { pararPix(); telaOferta(r.mensagem); focar(); }
      } catch (e) {}
    }, 4000);
    pararPix = () => { clearInterval(relogio); clearInterval(consulta); };
  }

  function telaSucesso(r) {
    const conectado = (typeof wuzConnected !== 'undefined' && wuzConnected) || (typeof evoConnected !== 'undefined' && evoConnected);
    _upInfo = { disponivel: false, ja_tem: true };
    document.getElementById('ia-upgrade-card')?.remove();
    // Upgrade feito: a chave "Receber pedidos pelo WhatsApp" aparece na hora
    try { iaPedidoWhatsappLiberado(); } catch (e) {}
    info$.innerHTML = `
      <div class="wa-up-ok">${_UP_IC.check}</div>
      <h2 id="wa-av-titulo">Pedidos por IA ativados</h2>
      <p class="wa-av-sub">A partir de agora a IA atende e anota os pedidos que chegam no WhatsApp da sua loja.${r.nova ? ` Sua mensalidade passa a ser ${_upBRL(r.nova)}${r.vencimento ? `, a partir do vencimento em ${_upData(r.vencimento)}` : ''}.` : ''}</p>
      ${conectado ? '' : '<p class="wa-av-sub" style="margin-top:-8px">Falta só um passo: conectar o WhatsApp da loja lendo o QR Code.</p>'}
      <div class="wa-av-acoes">
        <button class="wa-av-btn" type="button" data-up="${conectado ? 'ver-ia' : 'conectar'}">${conectado ? 'Ver o Agente IA' : 'Conectar meu WhatsApp'}</button>
        <button class="wa-av-depois" type="button" data-up="fechar">Fechar</button>
      </div>`;
    try { sbToast('ok', 'Pedidos por IA ativados!'); } catch (e) {}
    focar();
  }

  async function pagar(btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="wa-up-gira" style="border-color:rgba(255,255,255,.35);border-top-color:#fff"></span>Gerando o Pix...'; }
    _upApi('POST', '/vista', { acao: 'clique' }).catch(() => {});
    try {
      const p = await _upApi('POST', '/pagar', {});
      if (p.status === 'aprovado') telaSucesso(p); else telaPix(p);
      focar();
    } catch (e) { telaOferta(e.message); focar(); }
  }

  async function copiar(btn) {
    const cod = el._pix?.qr_code || '';
    let ok = false;
    try { await navigator.clipboard.writeText(cod); ok = true; } catch (e) {
      try { const ta = document.createElement('textarea'); ta.value = cod; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch (e2) {}
    }
    const span = btn.querySelector('span');
    if (span) { span.textContent = ok ? 'Código copiado' : 'Não foi possível copiar'; setTimeout(() => { if (span.isConnected) span.textContent = 'Copiar código Pix'; }, 2500); }
  }

  el.addEventListener('click', ev => {
    const b = ev.target.closest('[data-up]');
    const acao = b?.dataset.up;
    if (acao === 'pagar') pagar(b);
    else if (acao === 'copiar') copiar(b);
    else if (acao === 'voltar') { pararPix(); telaOferta(); focar(); }
    else if (acao === 'conectar') avisoWaConectar();
    else if (acao === 'ver-ia') { avisoWaFechar(false); try { nav('robo'); roboTab('ia'); } catch (e) {} }
    else if (acao === 'fechar' || ev.target === el) avisoWaFechar(false);
  });
  el.addEventListener('keydown', ev => { if (ev.key === 'Escape') avisoWaFechar(false); });
  telaOferta();
  document.body.appendChild(el);
  focar();
  if (automatico) _upApi('POST', '/vista', { acao: 'vista' }).catch(() => {});
}

async function upgradeIaAbrir() {
  const info = (_upInfo && _upInfo.disponivel) ? _upInfo : await upgradeIaInfo();
  if (info?.disponivel) upgradeIaMostrar(info, false);
  else sbToast('err', 'O upgrade não está disponível agora. Fale com o suporte.');
}

// Cartão fixo na aba Agente IA para quem ainda não tem os pedidos por IA
async function upgradeIaCartao() {
  const sec = document.getElementById('robo-section-ia');
  if (!sec) return;
  const info = await upgradeIaInfo();
  document.getElementById('ia-upgrade-card')?.remove();
  if (!info?.disponivel) return;
  const c = document.createElement('div');
  c.id = 'ia-upgrade-card';
  c.style.cssText = 'display:flex;align-items:center;gap:14px;flex-wrap:wrap;max-width:700px;margin:0 0 16px;padding:16px 18px;border-radius:16px;background:linear-gradient(120deg,#0f4a33,#1c7a52);color:#fff;box-shadow:0 10px 26px rgba(15,74,51,.25)';
  c.innerHTML = `<span style="width:42px;height:42px;border-radius:12px;background:rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;flex:0 0 42px">${_UP_IC.audio.replace('width="18" height="18"', 'width="20" height="20"')}</span>
    <div style="flex:1;min-width:200px"><div style="font-size:15px;font-weight:800;margin-bottom:2px">Pedidos por IA no WhatsApp</div>
    <div style="font-size:12.5px;opacity:.85;line-height:1.45">A IA entende texto e áudio e manda o pedido pronto para o seu painel. Por ${_upBRL(info.preco)} a mais na mensalidade.</div></div>
    <button class="btn" type="button" onclick="upgradeIaAbrir()" style="background:#fff;color:#0f5f33;font-weight:800;border:0;padding:10px 16px;border-radius:11px">Conhecer e ativar</button>`;
  sec.insertBefore(c, sec.firstChild);
}

// ── Busca cliente para retorno manual ──
function retornoBuscar() {
  const q = (document.getElementById('retorno-search')?.value||'').toLowerCase();
  const res = document.getElementById('retorno-resultado');
  if (!q || q.length < 2) { if(res) res.innerHTML=''; return; }
  const found = fidClients.filter(c => c.name.toLowerCase().includes(q) && c.phone);
  if (!found.length) { if(res) res.innerHTML='<span style="color:var(--muted)">Nenhum cliente encontrado com telefone</span>'; return; }
  if (res) res.innerHTML = found.slice(0,3).map(c=>`
    <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:7px;margin-top:4px">
      <span style="font-size:13px;font-weight:600">${c.name}</span>
      <span style="font-size:11px;color:var(--muted)">${c.phone}</span>
      <button class="btn bp" style="font-size:10.5px;padding:2px 8px;margin-left:auto" onclick="evoEnviarRetornoCliente(${c.id})">📤 Enviar</button>
    </div>`).join('');
}

async function evoEnviarRetornoCliente(id) {
  const c = fidClients.find(x => x.id === id);
  if (!c?.phone) { sbToast('err','Cliente sem telefone'); return; }
  const sent = await evoEnviarMensagem(c.phone, 'retorno', { nome: c.name });
  sbToast(sent?'ok':'err', sent?`Mensagem enviada para ${c.name}!`:'Erro ao enviar');
}

async function evoEnviarRetornoManual() {
  const q = (document.getElementById('retorno-search')?.value||'').toLowerCase();
  const c = fidClients.find(x => x.name.toLowerCase().includes(q) && x.phone);
  if (!c) { sbToast('err','Nenhum cliente encontrado com esse nome'); return; }
  const sent = await evoEnviarMensagem(c.phone, 'retorno', { nome: c.name });
  sbToast(sent?'ok':'err', sent?`Mensagem enviada para ${c.name}!`:'Erro ao enviar');
}

// ── Promoção em massa via Edge Function ──────────────
async function evoEnviarPromocao() {
  const destino = document.getElementById('promo-destino')?.value || 'todos';
  const msg     = document.getElementById('auto-msg-promocao')?.value;
  const res     = document.getElementById('promo-resultado');
  if (!msg) { sbToast('err','Escreva a mensagem antes de enviar'); return; }
  // Conta clientes para confirmação
  const total = fidClients.filter(c => c.phone && (destino === 'todos' || (destino === 'com_pedido' && c.orders > 0))).length;
  if (!total) { sbToast('err','Nenhum cliente com telefone encontrado'); return; }
  if (!confirm(`Enviar promoção para ${total} cliente(s)? Este processo roda no servidor e pode demorar alguns minutos.`)) return;
  if (res) { res.style.display='block'; res.innerHTML='<span style="color:var(--muted)">Iniciando envio no servidor...</span>'; }
  sbLoading(true);
  try {
    const tid = _sessao?.tenant_id || '';
    const linkCardapio = await _evoCardapioLinkAtual();
    const msgFinal = _evoAplicarLinkCardapio(String(msg || ''), linkCardapio)
      .replaceAll('{link}', linkCardapio)
      .replaceAll('{link_cardapio}', linkCardapio)
      .replaceAll('{cardapio_link}', linkCardapio);
    // Chama a Edge Function — roda no servidor Supabase, não no browser
    const r = await fetch(`${WA_SERVER}/promocao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ destino, msg: msgFinal, tenant_id: tid })
    });
    const data = await r.json().catch(() => ({}));
    sbLoading(false);
    if (r.ok && data.ok) {
      if (res) res.innerHTML = `<span style="color:var(--success)">${data.enviados} enviados${data.falhou ? ` | ${data.falhou} falharam` : ''}</span>`;
      sbToast('ok', `Promoção enviada para ${data.enviados} clientes!`);
    } else {
      const err = data.error || `HTTP ${r.status}`;
      if (res) res.innerHTML = `<span style="color:var(--danger)">Erro: ${err}</span>`;
      sbToast('err', 'Erro: ' + err);
    }
  } catch(e) {
    sbLoading(false);
    if (res) res.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`;
    sbToast('err', 'Erro de conexão');
  }
}


function evoCarregarHistorico() {
  const tbody=document.getElementById('msgs-tbody'), count=document.getElementById('msgs-count');
  if (!tbody) return;
  if (!evoMsgHistory.length) { tbody.innerHTML='<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--muted);font-size:13px">Nenhuma mensagem enviada ainda</td></tr>'; if(count)count.textContent='0 mensagens'; return; }
  if (count) count.textContent=`${evoMsgHistory.length} mensagem(s)`;
  tbody.innerHTML=evoMsgHistory.map(m=>`<tr>
    <td style="font-size:12.5px">${m.to}</td>
    <td><span style="font-size:11px;background:rgba(59,130,246,.1);color:var(--accent);padding:2px 7px;border-radius:99px;font-weight:600">${m.tipo}</span></td>
    <td style="font-size:12px;color:var(--muted);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.msg}</td>
    <td><span style="font-size:11px;font-weight:600;color:${m.status==='enviado'?'var(--success)':'var(--danger)'}">${m.status==='enviado'?'✅ Enviado':'❌ Falhou'}</span></td>
    <td style="font-size:12px;color:var(--muted)">${m.time}</td>
  </tr>`).join('');
}

function _evoSetStatus(type,txt) {
  const dot=document.getElementById('evo-status-dot'), span=document.getElementById('evo-status-txt'), badge=document.getElementById('evo-status-badge');
  const colors={connected:'var(--success)',disconnected:'var(--danger)',loading:'var(--accent3)'};
  if(dot) dot.style.background=colors[type]||'var(--muted)';
  if(span) span.textContent=txt;
  if(badge){ badge.style.borderColor=type==='connected'?'rgba(34,197,94,.3)':'var(--border)'; badge.style.color=type==='connected'?'var(--success)':'var(--muted)'; }
  // Sincroniza bolinha no topnav
  const topDot=document.getElementById('evo-status-dot-top');
  if(topDot) topDot.style.background=colors[type]||'var(--muted)';
}

async function topnavCopiarCardapio(btn) {
  try {
    const tid = _sessao?.tenant_id || '';
    let slug = '';
    try {
      const _slugRes2 = await fetch('/api/tenant-slug', { headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid } }).catch(()=>null);
      slug = (_slugRes2?.ok ? (await _slugRes2.json().catch(()=>({}))).slug : '') || '';
    } catch(e) {}
    const url = slug
      ? `${window.location.origin}/index.html?slug=${encodeURIComponent(slug)}`
      : `${window.location.origin}/index.html?tenant=${encodeURIComponent(tid)}`;
    await navigator.clipboard.writeText(url);
    // Feedback visual temporário no botão
    const svg = btn.querySelector('svg');
    if (svg) {
      const orig = svg.innerHTML;
      svg.innerHTML = '<path d="M3 8l3.5 3.5L13 4" stroke="var(--success)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
      setTimeout(() => svg.innerHTML = orig, 1800);
    }
    sbToast('ok', 'Link copiado!');
  } catch(e) {
    sbToast('err', 'Erro ao copiar link');
  }
}
function _evoShowConnected(name) {
  const qr=document.getElementById('evo-qr-area'), cn=document.getElementById('evo-connected-area'), ph=document.getElementById('evo-phone-display');
  if(qr) qr.style.display='none'; if(cn) cn.style.display='block'; if(ph) ph.textContent=name;
}
function _evoShowQRPrompt() {
  const qr=document.getElementById('evo-qr-area'), cn=document.getElementById('evo-connected-area');
  if(qr){ qr.style.display='block'; qr.innerHTML='<div style="margin-bottom:12px;color:var(--muted)"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 8a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0" stroke="currentColor" stroke-width="1.4"/></svg></div><div style="font-size:14px;font-weight:600;margin-bottom:6px">WhatsApp desconectado</div><div style="font-size:12px;color:var(--muted);margin-bottom:16px">Clique para gerar o QR Code</div><button class="btn bp" onclick="evoConectar()">Conectar WhatsApp</button>'; }
  if(cn) cn.style.display='none';
}
// ══ HORÁRIOS DE FUNCIONAMENTO ════════════════════════
const _CP_DIAS = [
  { key:'dom', label:'Domingo' },
  { key:'seg', label:'Segunda' },
  { key:'ter', label:'Terça'   },
  { key:'qua', label:'Quarta'  },
  { key:'qui', label:'Quinta'  },
  { key:'sex', label:'Sexta'   },
  { key:'sab', label:'Sábado'  },
];

// Normaliza o cfg de um dia numa lista de janelas [{abertura,fechamento}].
// Compatível com o formato antigo (abertura/fechamento direto no dia = 1 janela).
function _cpJanelasDia(h, diaKey) {
  const ativoDefault = diaKey !== 'dom';
  if (!h) return { ativo: ativoDefault, janelas: [{ abertura:'11:00', fechamento:'22:00' }] };
  let janelas;
  if (Array.isArray(h.janelas) && h.janelas.length) {
    janelas = h.janelas.map(j => ({ abertura: j.abertura || '11:00', fechamento: j.fechamento || '22:00' }));
  } else {
    janelas = [{ abertura: h.abertura || '11:00', fechamento: h.fechamento || '22:00' }];
  }
  const ativo = h.ativo !== undefined ? (h.ativo === true || h.ativo === 1 || h.ativo === 'true' || h.ativo === '1' || h.ativo === 'sim') : ativoDefault;
  return { ativo, janelas };
}

function _cpJanelaRowHtml(dia, idx, j, podeRemover) {
  return `
    <div class="cp-janela-row" id="cp-janela-${dia}-${idx}" style="display:flex;align-items:center;gap:6px">
      <input type="time" value="${j.abertura}" id="cp-hr-ab-${dia}-${idx}"
        style="background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:5px 8px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:12px;outline:none;width:90px"
        oninput="cpHorarioChanged()">
      <span style="font-size:11px;color:var(--muted)">até</span>
      <input type="time" value="${j.fechamento}" id="cp-hr-fch-${dia}-${idx}"
        style="background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:5px 8px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:12px;outline:none;width:90px"
        oninput="cpHorarioChanged()">
      ${podeRemover ? `<button type="button" onclick="cpRemoveJanela('${dia}', ${idx})" title="Remover horário" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:2px 6px">✕</button>` : ''}
    </div>`;
}

function cpRenderHorarios(horarios) {
  const container = document.getElementById('cp-horarios-list');
  if (!container) return;
  container.innerHTML = '';
  for (const d of _CP_DIAS) {
    const h = _cpJanelasDia(horarios[d.key], d.key);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:9px;transition:opacity .15s';
    row.id = `cp-hr-row-${d.key}`;
    const janelasHtml = h.janelas.map((j, i) => _cpJanelaRowHtml(d.key, i, j, h.janelas.length > 1)).join('');
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;min-width:80px">
          <div class="toggle-wrap" onclick="cpToggleDia('${d.key}',this)" data-ativo="${h.ativo}" style="width:34px;height:18px;border-radius:9px;background:${h.ativo?'var(--success)':'var(--surface)'};border:1px solid ${h.ativo?'var(--success)':'var(--border)'};position:relative;cursor:pointer;transition:all .2s;flex-shrink:0">
            <div style="position:absolute;top:2px;left:${h.ativo?'16px':'2px'};width:12px;height:12px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>
          </div>
          <span style="font-size:12px;font-weight:600;color:${h.ativo?'var(--text)':'var(--muted)'}" id="cp-hr-label-${d.key}">${d.label}</span>
        </label>
        <div id="cp-hr-times-${d.key}" style="display:${h.ativo?'flex':'none'};flex-direction:column;gap:6px;flex:1">
          ${janelasHtml}
        </div>
        <span id="cp-hr-fechado-${d.key}" style="display:${h.ativo?'none':'flex'};font-size:11px;color:var(--muted);font-weight:600;flex:1">Fechado</span>
      </div>
      <div id="cp-hr-add-wrap-${d.key}" style="display:${h.ativo?'block':'none'};padding-left:90px">
        <button type="button" onclick="cpAddJanela('${d.key}')" style="background:none;border:1px dashed var(--border);color:var(--muted);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer">+ adicionar horário (ex: almoço/jantar)</button>
      </div>
    `;
    container.appendChild(row);
  }
}

function cpToggleDia(key, toggleEl) {
  const timesEl  = document.getElementById(`cp-hr-times-${key}`);
  const fechEl   = document.getElementById(`cp-hr-fechado-${key}`);
  const labelEl  = document.getElementById(`cp-hr-label-${key}`);
  const addWrap  = document.getElementById(`cp-hr-add-wrap-${key}`);
  const knob     = toggleEl.querySelector('div');
  const isOn     = toggleEl.dataset.ativo === 'true';
  const nowOn    = !isOn;
  toggleEl.dataset.ativo = String(nowOn);
  toggleEl.style.background = nowOn ? 'var(--success)' : 'var(--surface)';
  toggleEl.style.borderColor = nowOn ? 'var(--success)' : 'var(--border)';
  if (knob) knob.style.left = nowOn ? '16px' : '2px';
  if (timesEl)  timesEl.style.display  = nowOn ? 'flex' : 'none';
  if (fechEl)   fechEl.style.display   = nowOn ? 'none' : 'flex';
  if (labelEl)  labelEl.style.color    = nowOn ? 'var(--text)' : 'var(--muted)';
  if (addWrap)  addWrap.style.display  = nowOn ? 'block' : 'none';
}

// Adiciona uma 2ª (ou 3ª...) janela de horário no mesmo dia — uso típico:
// almoço 11:00–14:30 + jantar 18:00–23:00.
function cpAddJanela(dia) {
  const timesEl = document.getElementById(`cp-hr-times-${dia}`);
  if (!timesEl) return;
  const idx = timesEl.querySelectorAll('.cp-janela-row').length;
  const wrap = document.createElement('div');
  wrap.innerHTML = _cpJanelaRowHtml(dia, idx, { abertura: '18:00', fechamento: '23:00' }, true);
  timesEl.appendChild(wrap.firstElementChild);
  _cpRefreshRemoveButtons(dia);
  cpHorarioChanged();
}

function cpRemoveJanela(dia, idx) {
  const el = document.getElementById(`cp-janela-${dia}-${idx}`);
  const timesEl = document.getElementById(`cp-hr-times-${dia}`);
  if (!el || !timesEl) return;
  if (timesEl.querySelectorAll('.cp-janela-row').length <= 1) return; // sempre precisa de ao menos 1 janela
  el.remove();
  _cpRefreshRemoveButtons(dia);
  cpHorarioChanged();
}

// Mostra/esconde o botão "✕" de cada janela conforme sobra mais de uma.
function _cpRefreshRemoveButtons(dia) {
  const timesEl = document.getElementById(`cp-hr-times-${dia}`);
  if (!timesEl) return;
  const rows = Array.from(timesEl.querySelectorAll('.cp-janela-row'));
  rows.forEach(row => {
    let btn = row.querySelector('button');
    if (rows.length > 1) {
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.title = 'Remover horário';
        btn.style.cssText = 'background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:2px 6px';
        btn.textContent = '✕';
        row.appendChild(btn);
      }
      const rid = row.id.split('-').pop();
      btn.setAttribute('onclick', `cpRemoveJanela('${dia}', ${rid})`);
    } else if (btn) {
      btn.remove();
    }
  });
}

function cpGetHorarios() {
  const out = {};
  for (const d of _CP_DIAS) {
    const toggleEl = document.querySelector(`#cp-hr-row-${d.key} .toggle-wrap`);
    const ativo    = toggleEl ? toggleEl.dataset.ativo === 'true' : false;
    const timesEl  = document.getElementById(`cp-hr-times-${d.key}`);
    const janelaRows = timesEl ? Array.from(timesEl.querySelectorAll('.cp-janela-row')) : [];
    const janelas = janelaRows.map(row => {
      const inputs = row.querySelectorAll('input[type="time"]');
      return {
        abertura:   inputs[0]?.value || '11:00',
        fechamento: inputs[1]?.value || '22:00',
      };
    });
    const janelasFinal = janelas.length ? janelas : [{ abertura: '11:00', fechamento: '22:00' }];
    out[d.key] = {
      ativo,
      janelas: janelasFinal,
      // Compat: mantém abertura/fechamento no nível do dia (= 1ª janela) pra
      // qualquer trecho de código antigo que ainda espere o formato de 1 via.
      abertura:   janelasFinal[0].abertura,
      fechamento: janelasFinal[0].fechamento,
    };
  }
  return out;
}

function cpHorarioChanged() { /* placeholder para futuros listeners */ }


let _cpLogoUrl   = '';
let _cpBannerUrl = '';
let _cpBanners   = []; // [{type:'image'|'video', url}] — até 5, formam slide no cardápio

async function loadCardapioPublico() {
  const { data } = await sb.from('store_config').select(
    'store_name,store_descricao,store_logo_url,store_banner_url,store_banners,store_cor,store_tema,store_tempo_entrega,store_avaliacao,store_whatsapp,horarios_config,pedido_minimo,pedido_minimo_retirada,store_address,store_lat,store_lng,tipos_entrega,delivery_fee_config,pickup_addresses,mostrar_indicacao_preparo,permitir_agendamento,agendamento_config'
  ).single();
  if (!data) return;

  const v = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined && val !== null) el.value = val; };
  v('cp-nome',          data.store_name);
  v('cp-descricao',     data.store_descricao);
  v('cp-whatsapp',      data.store_whatsapp);
  v('cp-tempo',         data.store_tempo_entrega);
  v('cp-avaliacao',     data.store_avaliacao);
  v('cp-pedido-minimo', data.pedido_minimo ?? 0);
  // Pedido mínimo também na retirada — desligado por padrão (só liga se estiver salvo como 1)
  const minRetOn = data.pedido_minimo_retirada === 1 || data.pedido_minimo_retirada === true || data.pedido_minimo_retirada === '1';
  const minRetEl = document.getElementById('cp-pedido-minimo-retirada');
  if (minRetEl) { minRetEl.checked = minRetOn; cpToggleMinimoRetirada(minRetOn); }
  v('cp-store-address', data.store_address);
  v('cp-store-lat',     data.store_lat ?? '');
  v('cp-store-lng',     data.store_lng ?? '');

  // Múltiplos endereços de retirada
  let pickupAddrs = [];
  try {
    const pa = data.pickup_addresses;
    pickupAddrs = pa ? (Array.isArray(pa) ? pa : JSON.parse(pa)) : [];
  } catch(e) { pickupAddrs = []; }
  cpRenderPickupAddresses(pickupAddrs);

  // Tipos de entrega
  const tipos = Array.isArray(data.tipos_entrega)
    ? data.tipos_entrega
    : ['delivery','retirada','mesa'];
  const el_d = document.getElementById('cp-tipo-delivery');
  const el_r = document.getElementById('cp-tipo-retirada');
  const el_m = document.getElementById('cp-tipo-mesa');
  if (el_d) el_d.checked = tipos.includes('delivery');
  if (el_r) el_r.checked = tipos.includes('retirada');
  if (el_m) el_m.checked = tipos.includes('mesa');
  cpTipoChange(); // atualiza bordas visuais

  // Pausa de delivery/retirada — vem dentro do delivery_fee_config
  const feeCfg = data.delivery_fee_config || {};
  const elPausa = document.getElementById('cp-pausa-delivery');
  if (elPausa) {
    elPausa.checked = !!feeCfg.delivery_pausado;
    _cpPausaAtualizarUI(feeCfg);
  }

  // Horários de funcionamento
  let horarios = {};
  try {
    const hc = data.horarios_config;
    horarios = hc ? (typeof hc === 'string' ? JSON.parse(hc) : hc) : {};
  } catch(e) { horarios = {}; }
  cpRenderHorarios(horarios);

  const cor = data.store_cor || '#3b82f6';
  const corEl = document.getElementById('cp-cor');
  // Cor do texto
  const corTextoEl = document.getElementById('cp-cor-texto');
  if (corTextoEl) corTextoEl.value = data.store_cor_texto || '#111111';
  // Carrossel de categorias
  const catsCarrossel = !!data.cats_carrossel;
  const catsEl = document.getElementById('cp-cats-carrossel');
  if (catsEl) { catsEl.checked = catsCarrossel; cpToggleCatsCarrossel(catsCarrossel); }
  // Indicação de preparo (robozinho "Não sabe qual carne escolher?") — só açougue.
  // Sem essa coluna configurada ainda (null/undefined), considera ligado
  // por padrão, pra bater com o comportamento atual de quem nunca mexeu nisso.
  const indicacaoPreparoOn = data.mostrar_indicacao_preparo !== 0 && data.mostrar_indicacao_preparo !== false;
  const indicacaoEl = document.getElementById('cp-indicacao-preparo');
  if (indicacaoEl) { indicacaoEl.checked = indicacaoPreparoOn; cpToggleIndicacaoPreparo(indicacaoPreparoOn); }
  // Agendamento de pedido com loja fechada — vale pra qualquer segmento.
  // Mesmo raciocínio de default: sem config ainda, considera ligado.
  const agendamentoOn = data.permitir_agendamento !== 0 && data.permitir_agendamento !== false;
  const agendamentoEl = document.getElementById('cp-permitir-agendamento');
  if (agendamentoEl) { agendamentoEl.checked = agendamentoOn; cpToggleAgendamento(agendamentoOn); }
  // Agendamento com horário escolhido pelo cliente (desligado por padrão)
  try {
    let ag = data.agendamento_config;
    if (typeof ag === 'string') { try { ag = JSON.parse(ag); } catch(e) { ag = null; } }
    ag = (ag && typeof ag === 'object') ? ag : {};
    const agOn = ag.escolher_horario === true || ag.escolher_horario === 1;
    const agEl = document.getElementById('cp-ag-escolher');
    if (agEl) { agEl.checked = agOn; cpToggleAgEscolher(agOn); }
    const setSel = (id, v, pad) => { const el = document.getElementById(id); if (!el) return; el.value = String(v ?? pad); if (el.value === '') el.value = String(pad); };
    setSel('cp-ag-dias', ag.dias, 2);
    setSel('cp-ag-antecedencia', ag.antecedencia, 60);
    setSel('cp-ag-intervalo', ag.intervalo, 30);
    cpCarregarAgAviso();
  } catch(e) {}
  // Oculta opção de carrossel se for açougue (já usa por padrão)
  // Busca segmento direto para não depender de window._segmento que pode não ter carregado
  const catsWrap = document.getElementById('cp-cats-modo-wrap');
  const indicacaoWrap = document.getElementById('cp-indicacao-preparo-wrap');
  if (catsWrap) {
    const _tid = _sessao?.tenant_id;
    if (_tid) {
      fetch('/api/tenant-segmento', { headers: { 'x-tenant-id': _tid } })
        .then(r => r.json())
        .then(d => {
          const isAcougue = d.segmento === 'acougue';
          catsWrap.style.display = isAcougue ? 'none' : 'block';
          if (indicacaoWrap) indicacaoWrap.style.display = isAcougue ? 'block' : 'none';
        })
        .catch(() => { catsWrap.style.display = 'block'; });
    } else {
      catsWrap.style.display = 'block';
    }
  }
  if (corEl) corEl.value = cor;

  // Carrega tema
  cpSelecionarTema(data.store_tema || 'classico');

  if (data.store_logo_url) {
    _cpLogoUrl = data.store_logo_url;
    const prev = document.getElementById('cp-logo-preview');
    if (prev) { prev.innerHTML = ''; prev.style.backgroundImage = `url(${_cpLogoUrl})`; prev.style.backgroundSize = 'cover'; prev.style.backgroundPosition = 'center'; }
    const pp = document.getElementById('cp-prev-logo');
    if (pp) { pp.innerHTML = ''; pp.style.backgroundImage = `url(${_cpLogoUrl})`; pp.style.backgroundSize = 'cover'; pp.style.backgroundPosition = 'center'; }
  }
  // Banners (novo formato: array de até 5, imagem ou vídeo) — com fallback pro campo antigo
  try {
    const raw = data.store_banners;
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    _cpBanners = Array.isArray(arr) && arr.length ? arr.slice(0, 5) : (data.store_banner_url ? [{ type: 'image', url: data.store_banner_url }] : []);
  } catch(e) {
    _cpBanners = data.store_banner_url ? [{ type: 'image', url: data.store_banner_url }] : [];
  }
  _cpBannerUrl = (_cpBanners.find(b => b.type !== 'video') || {}).url || '';
  cpRenderBanners();

  cpMontarLink();
  cpCarregarTabletSplash();
}

async function cpMontarLink() {
  const tid  = _sessao?.tenant_id || '';
  const base = window.location.origin;

  let slug = '';
  try {
    const _slugRes3 = await fetch('/api/tenant-slug', { headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid } }).catch(()=>null);
    if (_slugRes3?.ok) { slug = (await _slugRes3.json().catch(()=>({}))).slug || ''; }
  } catch(e) {}

  const urlCardapio = slug
    ? `${base}/index.html?slug=${encodeURIComponent(slug)}`
    : `${base}/index.html?tenant=${encodeURIComponent(tid)}`;

  const urlGarcom = slug
    ? `${base}/garcom.html?slug=${encodeURIComponent(slug)}`
    : `${base}/garcom.html?tenant=${encodeURIComponent(tid)}`;

  const el = document.getElementById('cp-link-url');
  if (el) el.textContent = urlCardapio;

  const elG = document.getElementById('cp-link-garcom');
  if (elG) elG.textContent = urlGarcom;

  // Carrega iframe do cardápio real pela primeira vez
  cpCarregarIframe(urlCardapio);
}

// ── Iframe do cardápio ────────────────────────────────
function cpCarregarIframe(url) {
  const iframe = document.getElementById('cp-iframe');
  if (!iframe || iframe.src === url) return;
  iframe.src = url || 'about:blank';
}

function cpRecarregarIframe() {
  const iframe = document.getElementById('cp-iframe');
  if (!iframe) return;
  const src = iframe.src;
  iframe.src = 'about:blank';
  setTimeout(() => { iframe.src = src; }, 80);
  sbToast('ok', 'Preview atualizado!');
}

function cpCopiarLink() {
  const el = document.getElementById('cp-link-url');
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => sbToast('ok','Link copiado!'));
}

function cpAbrirLink() {
  const el = document.getElementById('cp-link-url');
  if (el) window.open(el.textContent, '_blank');
}

function cpSetCor(hex) {
  const el = document.getElementById('cp-cor');
  if (el) el.value = hex;
}

// ── Seleção de tema do cardápio público ──────────────────
const _CP_CARDAPIO_TEMAS = [
  {
    key:'classico', group:'essenciais', nome:'Classico', desc:'Claro e direto para qualquer loja.',
    tags:['Geral','Limpo'], accent:'#f97316', swatches:['#f97316','#0ea5e9','#16a34a'],
    colors:{ bg:'#f8f9fb', surface:'#ffffff', soft:'#e4e8ef', text:'#0f1117', muted:'#6b7280', border:'rgba(0,0,0,.08)' }
  },
  {
    key:'delivery_pro', group:'essenciais', nome:'Delivery Pro', desc:'Visual moderno para operacao diaria.',
    tags:['Delivery','Moderno'], accent:'#2563eb', swatches:['#2563eb','#f97316','#10b981'],
    colors:{ bg:'#f6f7fb', surface:'#ffffff', soft:'#d8e0ec', text:'#132032', muted:'#617089', border:'rgba(15,23,42,.08)' }
  },
  {
    key:'minimalista', group:'essenciais', nome:'Minimalista', desc:'Muito limpo, com foco nos produtos.',
    tags:['Clean','Premium'], accent:'#111111', swatches:['#111111','#64748b','#ea580c'],
    colors:{ bg:'#ffffff', surface:'#fafafa', soft:'#e5e5e5', text:'#111111', muted:'#737373', border:'rgba(0,0,0,.07)' }
  },
  {
    key:'premium_clean', group:'essenciais', nome:'Premium Clean', desc:'Neutro sofisticado para marcas fortes.',
    tags:['Premium','Neutro'], accent:'#18181b', swatches:['#18181b','#be123c','#2563eb'],
    colors:{ bg:'#f7f7f5', surface:'#ffffff', soft:'#deded8', text:'#18181b', muted:'#71717a', border:'rgba(24,24,27,.08)' }
  },
  {
    key:'moderno', group:'essenciais', nome:'Moderno', desc:'Cards com sombra e icones redondos, estilo apps de entrega.',
    tags:['Delivery','Clean'], accent:'#f97316', swatches:['#f97316','#2563eb','#16a34a'],
    colors:{ bg:'#f7f7f8', surface:'#ffffff', soft:'#e4e4e8', text:'#1a1a1a', muted:'#767676', border:'rgba(0,0,0,.08)' }
  },
  {
    key:'tropical', group:'lanches', nome:'Tropical', desc:'Quente e chamativo para lanches.',
    tags:['Lanche','Quente'], accent:'#ea580c', swatches:['#ea580c','#dc2626','#f59e0b'],
    colors:{ bg:'#fef9f0', surface:'#fff7ed', soft:'#fed7aa', text:'#431407', muted:'#92400e', border:'rgba(234,88,12,.15)' }
  },
  {
    key:'burger_red', group:'lanches', nome:'Burger Red', desc:'Forte para hamburgueria e fast food.',
    tags:['Burger','Fast food'], accent:'#dc2626', swatches:['#dc2626','#f97316','#facc15'],
    colors:{ bg:'#fff6ed', surface:'#fffaf5', soft:'#fbc891', text:'#3b1606', muted:'#9a3412', border:'rgba(194,65,12,.14)' }
  },
  {
    key:'pizzaria_italia', group:'lanches', nome:'Pizzaria Italia', desc:'Tradicional, bom para pizzas e massas.',
    tags:['Pizza','Massas'], accent:'#dc2626', swatches:['#dc2626','#15803d','#b45309'],
    colors:{ bg:'#fbf7ef', surface:'#ffffff', soft:'#f8d8b3', text:'#332014', muted:'#7d5a3a', border:'rgba(127,29,29,.12)' }
  },
  {
    key:'noite_delivery', group:'lanches', nome:'Noite Delivery', desc:'Escuro, pratico e forte para madrugada.',
    tags:['Delivery','Noite'], accent:'#22c55e', swatches:['#22c55e','#f97316','#38bdf8'],
    colors:{ bg:'#0e1118', surface:'#161b24', soft:'#293244', text:'#f8fafc', muted:'#9aa4b2', border:'rgba(255,255,255,.08)' }
  },
  {
    key:'verde', group:'naturais', nome:'Verde Natural', desc:'Leve para comida saudavel.',
    tags:['Saudavel','Natural'], accent:'#16a34a', swatches:['#16a34a','#0f766e','#84cc16'],
    colors:{ bg:'#f0faf2', surface:'#ffffff', soft:'#d1ecda', text:'#0d2b18', muted:'#3a7a52', border:'rgba(34,120,60,.12)' }
  },
  {
    key:'fresh_verde', group:'naturais', nome:'Fresh Verde', desc:'Fresco para saladas, marmitas e fit.',
    tags:['Fit','Fresh'], accent:'#10b981', swatches:['#10b981','#22c55e','#0284c7'],
    colors:{ bg:'#f4fbf6', surface:'#ffffff', soft:'#cfeade', text:'#10291d', muted:'#3f7459', border:'rgba(22,101,52,.10)' }
  },
  {
    key:'mercado_azul', group:'naturais', nome:'Mercado Azul', desc:'Organizado para mercado e conveniencia.',
    tags:['Mercado','Confiavel'], accent:'#2563eb', swatches:['#2563eb','#0891b2','#16a34a'],
    colors:{ bg:'#f3f8ff', surface:'#ffffff', soft:'#c8defa', text:'#10243c', muted:'#46637f', border:'rgba(37,99,235,.10)' }
  },
  {
    key:'acougue', group:'segmentos', nome:'Acougue', desc:'Escuro e robusto para carnes.',
    tags:['Carnes','Churrasco'], accent:'#dc2626', swatches:['#dc2626','#991b1b','#f97316'],
    colors:{ bg:'#1a0a05', surface:'#2a100a', soft:'#4a2018', text:'#f5e6e0', muted:'#c9a090', border:'rgba(220,80,30,.2)' }
  },
  {
    key:'acai_berry', group:'segmentos', nome:'Acai Berry', desc:'Vivo para acai, sorvetes e sobremesas.',
    tags:['Acai','Sobremesa'], accent:'#a21caf', swatches:['#a21caf','#be185d','#7c3aed'],
    colors:{ bg:'#fff7fb', surface:'#ffffff', soft:'#edc4dc', text:'#351123', muted:'#8a3a63', border:'rgba(134,25,80,.12)' }
  },
  {
    key:'sushi_black', group:'segmentos', nome:'Sushi Black', desc:'Escuro elegante para sushi e oriental.',
    tags:['Sushi','Oriental'], accent:'#06b6d4', swatches:['#06b6d4','#ef4444','#22c55e'],
    colors:{ bg:'#070b0c', surface:'#101719', soft:'#203437', text:'#edfafa', muted:'#93b5b8', border:'rgba(125,211,252,.10)' }
  },
  {
    key:'padaria_gold', group:'segmentos', nome:'Padaria Gold', desc:'Aconchegante para padaria e cafe.',
    tags:['Padaria','Cafe'], accent:'#d97706', swatches:['#d97706','#b45309','#78350f'],
    colors:{ bg:'#fff8ee', surface:'#fffdf8', soft:'#f5d29a', text:'#352411', muted:'#815c2b', border:'rgba(180,83,9,.12)' }
  },
  {
    key:'rose', group:'segmentos', nome:'Rose', desc:'Delicado para doces, cafes e presentes.',
    tags:['Doces','Cafe'], accent:'#e11d48', swatches:['#e11d48','#db2777','#f97316'],
    colors:{ bg:'#fff5f7', surface:'#ffffff', soft:'#ffc9d5', text:'#3d0a14', muted:'#a03050', border:'rgba(220,60,90,.12)' }
  },
  {
    key:'dark', group:'premium', nome:'Dark Luxo', desc:'Escuro premium para restaurantes.',
    tags:['Escuro','Luxo'], accent:'#3b82f6', swatches:['#3b82f6','#f97316','#a855f7'],
    colors:{ bg:'#0f1117', surface:'#181b24', soft:'#242840', text:'#e5e7eb', muted:'#9ca3af', border:'rgba(255,255,255,.08)' }
  },
  {
    key:'noturno', group:'premium', nome:'Noturno', desc:'Profundo para bares e operacao noturna.',
    tags:['Bar','Noite'], accent:'#8b5cf6', swatches:['#8b5cf6','#22c55e','#f97316'],
    colors:{ bg:'#080810', surface:'#0f0f1c', soft:'#1e1e30', text:'#eeedf6', muted:'#7878a0', border:'rgba(255,255,255,.07)' }
  },
  {
    key:'oceano', group:'premium', nome:'Oceano', desc:'Azul profundo para frutos do mar.',
    tags:['Peixes','Sushi'], accent:'#0ea5e9', swatches:['#0ea5e9','#14b8a6','#2563eb'],
    colors:{ bg:'#0a1628', surface:'#0f1f38', soft:'#1c3558', text:'#e0ecf8', muted:'#6890b0', border:'rgba(56,189,248,.10)' }
  },
  {
    key:'dourado', group:'premium', nome:'Dourado', desc:'Luxuoso para churrascarias e restaurantes.',
    tags:['Premium','Luxo'], accent:'#d4a574', swatches:['#d4a574','#f59e0b','#ef4444'],
    colors:{ bg:'#0f0d08', surface:'#1a1610', soft:'#2e2820', text:'#f0e8d8', muted:'#a09070', border:'rgba(212,165,116,.12)' }
  }
];

const _CP_TEMA_GRUPOS = [
  { key:'essenciais', titulo:'Essenciais', desc:'Bases seguras para quase todo cardapio.' },
  { key:'lanches', titulo:'Lanches e delivery', desc:'Mais energia visual para pedido rapido.' },
  { key:'naturais', titulo:'Naturais e mercado', desc:'Cores leves para rotinas de compra.' },
  { key:'segmentos', titulo:'Segmentos', desc:'Temas prontos para nichos especificos.' },
  { key:'premium', titulo:'Escuros e premium', desc:'Visual mais marcante para marcas fortes.' },
];

function cpTemaPreviewHtml(t) {
  const c = t.colors || {};
  const accent = t.accent || '#f97316';
  return `
    <div class="cp-theme-preview" style="background:${c.bg || '#f8f9fb'}">
      <div class="cp-theme-hero-mini" style="background:${c.surface || '#fff'};border-color:${c.border || 'rgba(0,0,0,.08)'}">
        <span style="background:${c.text || '#111'}"></span>
        <span style="background:${c.muted || '#777'}"></span>
      </div>
      <div class="cp-theme-products-mini">
        <div style="background:${c.surface || '#fff'};border-color:${c.border || 'rgba(0,0,0,.08)'}">
          <i style="background:${c.soft || '#e5e7eb'}"></i>
          <b style="background:${c.text || '#111'}"></b>
          <em style="background:${accent}"></em>
        </div>
        <div style="background:${c.surface || '#fff'};border-color:${c.border || 'rgba(0,0,0,.08)'}">
          <i style="background:${c.soft || '#e5e7eb'}"></i>
          <b style="background:${c.text || '#111'}"></b>
          <em style="background:${accent}"></em>
        </div>
      </div>
    </div>
  `;
}

function cpTemaSwatchesHtml(t) {
  return (t.swatches || [t.accent || '#f97316']).map(cor => `
    <button type="button" class="cp-theme-swatch" style="background:${cor}" title="Usar cor ${cor}"
      onclick="event.stopPropagation();cpSetCor('${cor}');cpSelecionarTema('${t.key}')"></button>
  `).join('');
}

function cpTemaCardHtml(t) {
  const tags = (t.tags || []).map(tag => `<span class="cp-theme-tag">${tag}</span>`).join('');
  return `
    <button type="button" class="cp-tema-card cp-theme-card" data-tema="${t.key}"
      onclick="cpSelecionarTema('${t.key}')" title="${t.desc}">
      ${cpTemaPreviewHtml(t)}
      <div class="cp-theme-info">
        <div class="cp-theme-title-row">
          <div>
            <strong>${t.nome}</strong>
            <small>${t.desc}</small>
          </div>
          <span class="cp-tema-check" aria-hidden="true">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </div>
        <div class="cp-theme-tags">${tags}</div>
        <div class="cp-theme-swatches">${cpTemaSwatchesHtml(t)}</div>
      </div>
    </button>
  `;
}

function cpUpdateTemaSelection(tema) {
  document.querySelectorAll('.cp-tema-card').forEach(card => {
    const isSelected = card.dataset.tema === tema;
    card.style.borderColor = isSelected ? 'var(--accent)' : 'var(--border)';
    card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    const check = card.querySelector('.cp-tema-check');
    if (check) check.style.display = isSelected ? 'flex' : 'none';
  });
}

function cpRenderTemasGrid() {
  const grid = document.getElementById('cp-temas-grid');
  if (!grid) return;

  document.body.classList.add('cp-theme-rendered');
  grid.className = 'cp-theme-grid';
  grid.style.cssText = 'display:flex;flex-direction:column;gap:14px';

  grid.innerHTML = _CP_TEMA_GRUPOS.map(grupo => {
    const temas = _CP_CARDAPIO_TEMAS.filter(t => t.group === grupo.key);
    if (!temas.length) return '';
    return `
      <section class="cp-theme-group">
        <div class="cp-theme-group-head">
          <div>
            <strong>${grupo.titulo}</strong>
            <span>${grupo.desc}</span>
          </div>
        </div>
        <div class="cp-theme-list">${temas.map(cpTemaCardHtml).join('')}</div>
      </section>
    `;
  }).join('');

  const selected = document.getElementById('cp-tema-value')?.value || 'classico';
  cpUpdateTemaSelection(selected);
}

function cpSetCorTexto(cor) {
  const el = document.getElementById('cp-cor-texto');
  if (el && cor) el.value = cor;
  // Se cor vazia = automático (limpa campo)
  if (!cor && el) el.value = '#111111';
}

function cpToggleCatsCarrossel(on) {
  const track = document.getElementById('cp-cats-carrossel-track');
  const thumb  = document.getElementById('cp-cats-carrossel-thumb');
  if (track) track.style.background = on ? 'var(--accent)' : 'var(--surface2)';
  if (thumb) { thumb.style.background = on ? '#fff' : 'var(--muted)'; thumb.style.left = on ? '22px' : '2px'; }
}

function cpToggleIndicacaoPreparo(on) {
  const track = document.getElementById('cp-indicacao-preparo-track');
  const thumb = document.getElementById('cp-indicacao-preparo-thumb');
  if (track) track.style.background = on ? 'var(--accent)' : 'var(--surface2)';
  if (thumb) { thumb.style.background = on ? '#fff' : 'var(--muted)'; thumb.style.left = on ? '22px' : '2px'; }
}

function cpToggleMinimoRetirada(on) {
  const track = document.getElementById('cp-pedido-minimo-retirada-track');
  const thumb = document.getElementById('cp-pedido-minimo-retirada-thumb');
  if (track) track.style.background = on ? 'var(--accent)' : 'var(--surface2)';
  if (thumb) { thumb.style.background = on ? '#fff' : 'var(--muted)'; thumb.style.left = on ? '22px' : '2px'; }
}

// Aviso de pedido agendado no WhatsApp do gestor. Fica fora do store_config
// de propósito: o cardápio público lê o store_config e o número do gestor
// não pode aparecer para os clientes.
async function cpCarregarAgAviso() {
  try {
    const r = await fetch('/api/gestor/aviso-agendamento', { headers: _upHeaders() });
    if (!r.ok) return;
    const d = await r.json();
    const el = document.getElementById('cp-ag-aviso');
    if (el) { el.checked = !!d.ativo; cpToggleAgAviso(!!d.ativo); }
    const f = document.getElementById('cp-ag-aviso-fone');
    if (f) f.value = d.fones || '';
  } catch(e) {}
}
async function cpSalvarAgAviso() {
  const el = document.getElementById('cp-ag-aviso');
  if (!el) return '';
  const ativo = !!el.checked;
  const fones = (document.getElementById('cp-ag-aviso-fone')?.value || '').replace(/[^\d,; ]/g, '').trim();
  if (ativo && !fones.replace(/\D/g, '')) return 'informe o WhatsApp que vai receber os avisos';
  try {
    const r = await fetch('/api/gestor/aviso-agendamento', { method: 'POST', headers: _upHeaders(), body: JSON.stringify({ ativo, fones }) });
    const d = await r.json().catch(() => ({}));
    return r.ok ? '' : (d.error || 'erro ao salvar');
  } catch(e) { return e.message; }
}

function cpToggleAgAviso(on) {
  const track = document.getElementById('cp-ag-aviso-track');
  const thumb = document.getElementById('cp-ag-aviso-thumb');
  if (track) track.style.background = on ? 'var(--accent)' : 'var(--surface2)';
  if (thumb) { thumb.style.background = on ? '#fff' : 'var(--muted)'; thumb.style.left = on ? '22px' : '2px'; }
  const op = document.getElementById('cp-ag-aviso-opcoes');
  if (op) op.style.display = on ? 'block' : 'none';
}

function cpToggleAgEscolher(on) {
  const track = document.getElementById('cp-ag-escolher-track');
  const thumb = document.getElementById('cp-ag-escolher-thumb');
  if (track) track.style.background = on ? 'var(--accent)' : 'var(--surface2)';
  if (thumb) { thumb.style.background = on ? '#fff' : 'var(--muted)'; thumb.style.left = on ? '22px' : '2px'; }
  const op = document.getElementById('cp-ag-opcoes');
  if (op) op.style.display = on ? 'grid' : 'none';
  cpAtualizarVisAgAviso();
}

function cpToggleAgendamento(on) {
  const track = document.getElementById('cp-permitir-agendamento-track');
  const thumb = document.getElementById('cp-permitir-agendamento-thumb');
  if (track) track.style.background = on ? 'var(--accent)' : 'var(--surface2)';
  if (thumb) { thumb.style.background = on ? '#fff' : 'var(--muted)'; thumb.style.left = on ? '22px' : '2px'; }
  cpAtualizarVisAgAviso();
}

// O aviso de pedido agendado só aparece quando alguma forma de agendamento
// está ligada (loja fechada ou cliente escolhe o horário).
function cpAtualizarVisAgAviso() {
  const card = document.getElementById('cp-ag-aviso-card');
  if (!card) return;
  const on = !!document.getElementById('cp-permitir-agendamento')?.checked || !!document.getElementById('cp-ag-escolher')?.checked;
  card.style.display = on ? 'block' : 'none';
}

function cpSelecionarTema(tema) {
  if (!document.querySelector('#cp-temas-grid .cp-theme-card')) cpRenderTemasGrid();
  // Atualiza borda visual de cada card
  cpUpdateTemaSelection(tema);
  // Armazena tema selecionado no input oculto
  let inp = document.getElementById('cp-tema-value');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'hidden';
    inp.id = 'cp-tema-value';
    document.body.appendChild(inp);
  }
  inp.value = tema;

  // Cada tema tem uma paleta curada (destaque + texto) — aplica junto pra já sair
  // com um visual completo e profissional, sem o gestor ter que ajustar cor por cor.
  const def = _CP_CARDAPIO_TEMAS.find(t => t.key === tema);
  if (def) {
    if (def.accent) cpSetCor(def.accent);
    if (def.colors?.text) cpSetCorTexto(def.colors.text);
  }
}

// Preview agora é o iframe real — cpPreviewCor e cpAtualizarPreview não são mais necessários

// ══════════════════════════════════════════
//  CARDÁPIO DE MESA/TABLET — fundo do portal de boas-vindas
// ══════════════════════════════════════════
async function uploadTabletSplashBg(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) { sbToast('err', 'Imagem muito grande. Use uma imagem de até 3MB.'); return; }

  sbLoading(true);
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
      reader.readAsDataURL(file);
    });

    const prev = document.getElementById('cp-tablet-splash-preview');
    if (prev) prev.style.backgroundImage = `url(${dataUrl})`;

    const { error } = await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, tablet_splash_bg_url: dataUrl });
    if (error) throw new Error(error.message || JSON.stringify(error));
    sbToast('ok', 'Fundo do cardápio de mesa atualizado!');
  } catch(e) {
    console.error('uploadTabletSplashBg:', e);
    sbToast('err', 'Erro ao enviar imagem: ' + (e.message || ''));
  } finally {
    sbLoading(false);
  }
}

async function removerTabletSplashBg() {
  sbLoading(true);
  try {
    const { error } = await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, tablet_splash_bg_url: null });
    if (error) throw new Error(error.message || JSON.stringify(error));
    const prev = document.getElementById('cp-tablet-splash-preview');
    if (prev) prev.style.backgroundImage = '';
    sbToast('ok', 'Removido — volta a usar o banner da loja.');
  } catch(e) {
    sbToast('err', 'Erro ao remover: ' + (e.message || ''));
  } finally {
    sbLoading(false);
  }
}

function copiarLinkTablet() {
  const inp = document.getElementById('cp-tablet-link');
  if (!inp || !inp.value) return;
  navigator.clipboard.writeText(inp.value).then(() => sbToast('ok', 'Link copiado!')).catch(() => {
    inp.select(); document.execCommand('copy'); sbToast('ok', 'Link copiado!');
  });
}

async function cpCarregarTabletSplash() {
  try {
    const { data } = await sb.from('store_config').select('tablet_splash_bg_url').eq('tenant_id', _sessao?.tenant_id).single();
    const prev = document.getElementById('cp-tablet-splash-preview');
    if (prev && data?.tablet_splash_bg_url) prev.style.backgroundImage = `url(${data.tablet_splash_bg_url})`;
    const linkInp = document.getElementById('cp-tablet-link');
    if (linkInp) {
      const linkBase = await _evoCardapioLinkAtual();
      linkInp.value = linkBase.replace('/index.html', '/totem.html');
    }
  } catch(e) { console.warn('cpCarregarTabletSplash:', e); }
}

async function cpUploadImagem(input) {
  const file = input.files[0];
  if (!file) return;

  // Valida tamanho máximo de 2MB para evitar banco muito pesado
  if (file.size > 2 * 1024 * 1024) {
    sbToast('err', 'Imagem muito grande. Use uma imagem de até 2MB.');
    return;
  }

  sbLoading(true);
  try {
    // Converte a imagem para base64 data URL e salva direto no banco,
    // evitando dependência do filesystem do container (que se perde ao reiniciar).
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
      reader.readAsDataURL(file);
    });

    _cpLogoUrl = dataUrl;
    const prev = document.getElementById('cp-logo-preview');
    if (prev) { prev.innerHTML = ''; prev.style.backgroundImage = `url(${dataUrl})`; prev.style.backgroundSize = 'cover'; prev.style.backgroundPosition = 'center'; }
    const pp = document.getElementById('cp-prev-logo');
    if (pp) { pp.innerHTML = ''; pp.style.backgroundImage = `url(${dataUrl})`; pp.style.backgroundSize = 'cover'; pp.style.backgroundPosition = 'center'; }

    // Salva data URL no banco imediatamente — persiste mesmo após reinício do container
    const { error } = await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, store_logo_url: dataUrl });
    if (error) throw new Error(error.message || JSON.stringify(error));

    sbToast('ok', 'Logo enviado e salvo!');
    // Recarrega iframe para refletir a nova imagem no cardápio
    setTimeout(() => cpRecarregarIframe(), 600);
  } catch(e) {
    console.error('cpUploadImagem:', e);
    sbToast('err', 'Erro ao enviar imagem: ' + (e.message || ''));
  } finally {
    sbLoading(false);
  }
}

// ══════════════════════════════════════════
//  BANNERS DO CARDÁPIO — até 5, imagem ou vídeo (formam slide)
// ══════════════════════════════════════════
const CP_BANNER_MAX = 5;
const CP_BANNER_IMG_MAX_BYTES   = 2  * 1024 * 1024; // 2MB
const CP_BANNER_VIDEO_MAX_BYTES = 10 * 1024 * 1024; // 10MB

function cpRenderBanners() {
  const list = document.getElementById('cp-banners-list');
  const addBtn = document.getElementById('cp-banner-add-btn');
  if (list) {
    list.innerHTML = _cpBanners.map((b, i) => `
      <div style="display:flex;align-items:center;gap:10px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:8px 10px">
        <div style="width:64px;height:44px;border-radius:6px;overflow:hidden;flex-shrink:0;background:#000;display:flex;align-items:center;justify-content:center">
          ${b.type === 'video'
            ? `<video src="${b.url}" style="width:100%;height:100%;object-fit:cover" muted></video>`
            : `<img src="${b.url}" style="width:100%;height:100%;object-fit:cover">`}
        </div>
        <div style="flex:1;font-size:12px;color:var(--muted)">${b.type === 'video' ? 'Vídeo' : 'Imagem'}${i === 0 ? ' (principal)' : ''}</div>
        <button type="button" class="btn" style="padding:5px 9px;font-size:11px" onclick="cpRemoveBanner(${i})">Remover</button>
      </div>
    `).join('') || `<div style="font-size:12px;color:var(--muted);text-align:center;padding:10px">Nenhum banner adicionado ainda.</div>`;
  }
  if (addBtn) {
    const cheio = _cpBanners.length >= CP_BANNER_MAX;
    addBtn.style.display = cheio ? 'none' : '';
  }
}

async function cpAddBanner(input) {
  const file = input.files[0];
  if (!file) return;

  if (_cpBanners.length >= CP_BANNER_MAX) {
    sbToast('err', `Máximo de ${CP_BANNER_MAX} banners.`);
    input.value = '';
    return;
  }

  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isVideo && !isImage) {
    sbToast('err', 'Envie uma imagem (JPG/PNG/WebP) ou vídeo (MP4/WebM).');
    input.value = '';
    return;
  }
  if (isImage && file.size > CP_BANNER_IMG_MAX_BYTES) {
    sbToast('err', 'Imagem muito grande. Use uma imagem de até 2MB.');
    input.value = '';
    return;
  }
  if (isVideo && file.size > CP_BANNER_VIDEO_MAX_BYTES) {
    sbToast('err', 'Vídeo muito grande. Use um vídeo de até 10MB.');
    input.value = '';
    return;
  }

  sbLoading(true);
  try {
    // Envia como ARQUIVO (pasta de uploads), igual ao vídeo dos produtos.
    // Antes virava texto base64 dentro da config da loja: um vídeo de 10MB
    // estourava o limite do servidor e TODO "Salvar alterações" do cardápio
    // público dava erro 502 (inclusive fechar a loja).
    const ext = (String(file.name || '').split('.').pop() || (isVideo ? 'mp4' : 'jpg')).toLowerCase().replace(/[^a-z0-9]/g, '') || (isVideo ? 'mp4' : 'jpg');
    const caminho = `banners/banner-${Date.now()}.${ext}`;
    const bucket = sb.storage.from('banners');
    const { data: up, error: upErr } = await bucket.upload(caminho, file, { upsert: true });
    if (upErr) throw new Error(upErr.message || upErr.error || 'Falha ao enviar arquivo');
    const urlArquivo = up?.publicUrl || up?.url || bucket.getPublicUrl(caminho).data.publicUrl;
    if (!urlArquivo) throw new Error('Envio sem endereço do arquivo');

    _cpBanners.push({ type: isVideo ? 'video' : 'image', url: urlArquivo });
    cpRenderBanners();
    await cpSalvarBanners();
    sbToast('ok', `${isVideo ? 'Vídeo' : 'Banner'} adicionado!`);
  } catch(e) {
    console.error('cpAddBanner:', e);
    sbToast('err', 'Erro ao enviar arquivo: ' + (e.message || ''));
  } finally {
    input.value = '';
    sbLoading(false);
  }
}

async function cpRemoveBanner(idx) {
  _cpBanners.splice(idx, 1);
  cpRenderBanners();
  sbLoading(true);
  try {
    await cpSalvarBanners();
    sbToast('ok', 'Banner removido.');
  } catch(e) {
    console.error('cpRemoveBanner:', e);
    sbToast('err', 'Erro ao remover banner: ' + (e.message || ''));
  } finally {
    sbLoading(false);
  }
}

async function cpSalvarBanners() {
  // store_banner_url (legado) fica sincronizado com o 1º banner de imagem,
  // pra manter compatibilidade com meta tags de compartilhamento (og:image).
  _cpBannerUrl = (_cpBanners.find(b => b.type !== 'video') || {}).url || '';
  const { error } = await sb.from('store_config').upsert({
    tenant_id: _sessao?.tenant_id,
    store_banners: JSON.stringify(_cpBanners),
    store_banner_url: _cpBannerUrl,
  });
  if (error) throw new Error(error.message || JSON.stringify(error));
  setTimeout(() => cpRecarregarIframe(), 600);
}

async function salvarCardapioPublico() {
  sbLoading(true);
  try {
    const payload = {
      tenant_id:           _sessao?.tenant_id,
      store_name:          document.getElementById('cp-nome')?.value.trim()      || null,
      store_descricao:     document.getElementById('cp-descricao')?.value.trim() || null,
      store_whatsapp:      document.getElementById('cp-whatsapp')?.value.trim()  || null,
      store_tempo_entrega: document.getElementById('cp-tempo')?.value.trim()     || '30-45 min',
      store_avaliacao:     document.getElementById('cp-avaliacao')?.value.trim() || '5.0',
      store_cor:           document.getElementById('cp-cor')?.value              || '#3b82f6',
      store_cor_texto:     document.getElementById('cp-cor-texto')?.value           || null,
      store_tema:          document.getElementById('cp-tema-value')?.value          || 'classico',
      cats_carrossel:      document.getElementById('cp-cats-carrossel')?.checked ? 1 : 0,
      mostrar_indicacao_preparo: document.getElementById('cp-indicacao-preparo')?.checked ? 1 : 0,
      permitir_agendamento: document.getElementById('cp-permitir-agendamento')?.checked ? 1 : 0,
      agendamento_config:  JSON.stringify({
        escolher_horario: !!document.getElementById('cp-ag-escolher')?.checked,
        dias:         parseInt(document.getElementById('cp-ag-dias')?.value, 10) || 0,
        antecedencia: parseInt(document.getElementById('cp-ag-antecedencia')?.value, 10) || 0,
        intervalo:    parseInt(document.getElementById('cp-ag-intervalo')?.value, 10) || 30,
      }),
      horarios_config:     JSON.stringify(cpGetHorarios()),
      pedido_minimo:       parseFloat(document.getElementById('cp-pedido-minimo')?.value) || 0,
      pedido_minimo_retirada: document.getElementById('cp-pedido-minimo-retirada')?.checked ? 1 : 0,
      store_address:       document.getElementById('cp-store-address')?.value.trim() || null,
      store_lat:           parseFloat(document.getElementById('cp-store-lat')?.value)  || null,
      store_lng:           parseFloat(document.getElementById('cp-store-lng')?.value)  || null,
      tipos_entrega:       cpGetTiposEntrega(),
      pickup_addresses:    JSON.stringify(cpGetPickupAddresses()),
    };
    if (_cpLogoUrl)   payload.store_logo_url   = _cpLogoUrl;
    // Banners NÃO vão aqui: já são gravados na hora em que são adicionados,
    // removidos ou reordenados (cpSalvarBanners). Reenviar aqui mandava o
    // vídeo do banner inteiro junto e estourava o limite (erro 502 ao salvar).

    const { error } = await sb.from('store_config').upsert(payload);
    if (error) throw error;
    const _avisoErro = await cpSalvarAgAviso();
    if (_avisoErro) sbToast('err', 'Cardápio salvo, mas o aviso de pedido agendado não: ' + _avisoErro);
    else sbToast('ok', 'Cardápio público salvo!');
    // Sincroniza o tempo de entrega usado pela impressão (comanda) com o que
    // foi salvo no cardápio público — assim a comanda usa SEMPRE o mesmo
    // valor que o cliente vê.
    try {
      const _novoTempo = payload.store_tempo_entrega || '';
      if (_novoTempo) {
        window._printTempoEntrega = _novoTempo;
        if (typeof _printTempoEntrega !== 'undefined') _printTempoEntrega = _novoTempo;
        localStorage.setItem('printTempoEntrega', _novoTempo);
      }
    } catch {}
    // Recarrega dados e atualiza iframe (sincroniza com o cardápio real)
    await loadCardapioPublico();
    // Pequeno delay para o banco propagar via SSE antes de recarregar o iframe
    setTimeout(() => cpRecarregarIframe(), 600);
  } catch(e) {
    sbToast('err', 'Erro ao salvar: ' + (e.message || JSON.stringify(e)));
    console.error('salvarCardapioPublico:', e);
  } finally {
    sbLoading(false);
  }
}

function cpTipoChange() {
  const ids = ['delivery','retirada','mesa'];
  ids.forEach(id => {
    const cb  = document.getElementById('cp-tipo-' + id);
    const lbl = document.getElementById('cp-tipo-' + id + '-lbl');
    if (cb && lbl) lbl.style.borderColor = cb.checked ? 'var(--accent)' : 'var(--border)';
  });
}

function cpGetTiposEntrega() {
  const tipos = [];
  if (document.getElementById('cp-tipo-delivery')?.checked) tipos.push('delivery');
  if (document.getElementById('cp-tipo-retirada')?.checked) tipos.push('retirada');
  if (document.getElementById('cp-tipo-mesa')?.checked)     tipos.push('mesa');
  // Garante pelo menos delivery
  if (!tipos.length) tipos.push('delivery');
  return tipos;
}

// ── Múltiplos endereços de retirada ──────────────────────────────────────
function cpGetPickupAddresses() {
  const rows = document.querySelectorAll('#cp-pickup-list .cp-pickup-row');
  const addrs = [];
  rows.forEach(row => {
    const nome = row.querySelector('.cp-pickup-nome')?.value.trim();
    const end  = row.querySelector('.cp-pickup-end')?.value.trim();
    if (nome || end) addrs.push({ nome: nome || '', endereco: end || '' });
  });
  return addrs;
}

function cpRenderPickupAddresses(addrs) {
  const list = document.getElementById('cp-pickup-list');
  if (!list) return;
  list.innerHTML = '';
  const items = (addrs && addrs.length) ? addrs : [];
  items.forEach((a, i) => _cpAddPickupRow(list, a.nome, a.endereco));
}

function _cpAddPickupRow(list, nome, endereco) {
  if (!list) list = document.getElementById('cp-pickup-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'cp-pickup-row';
  row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:9px;margin-bottom:7px';
  row.innerHTML = `
    <div style="flex:0 0 120px">
      <input class="cp-pickup-nome form-input" value="${(nome||'').replace(/"/g,'&quot;')}" placeholder="Nome da filial"
        style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:6px 9px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:12px;outline:none">
    </div>
    <div style="flex:1">
      <input class="cp-pickup-end form-input" value="${(endereco||'').replace(/"/g,'&quot;')}" placeholder="Endereço completo"
        style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:6px 9px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:12px;outline:none">
    </div>
    <button onclick="this.closest('.cp-pickup-row').remove()" style="flex-shrink:0;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);color:var(--danger);border-radius:7px;padding:5px 10px;cursor:pointer;font-size:13px;font-weight:700;line-height:1" title="Remover">✕</button>
  `;
  list.appendChild(row);
}

function cpAddPickupAddress() {
  _cpAddPickupRow(null, '', '');
}

// Pausa temporária de delivery/retirada — clicar no checkbox só revela as
// opções (modalidade + duração); a pausa de fato só é salva quando o
// gestor clica em "Confirmar pausa", já com tudo escolhido de uma vez.
function cpPausaDeliveryToggle() {
  const cb = document.getElementById('cp-pausa-delivery');
  const opcoes = document.getElementById('cp-pausa-delivery-opcoes');
  if (!cb || !opcoes) return;
  if (cb.checked) {
    opcoes.style.display = '';
  } else {
    opcoes.style.display = 'none';
    // Desmarcou sem confirmar nada novo — se já tinha pausa ativa salva,
    // desmarcar aqui reativa tudo de novo (mesmo comportamento simples de
    // antes, pra quem só quer ligar/desligar rápido sem mexer em duração).
    cpPausaDeliveryReativar();
  }
}

async function cpPausaDeliveryConfirmar() {
  const modDelivery = document.getElementById('cp-pausa-mod-delivery')?.checked;
  const modRetirada = document.getElementById('cp-pausa-mod-retirada')?.checked;
  const duracaoMin = parseInt(document.getElementById('cp-pausa-duracao')?.value) || 0;
  const modalidades = [modDelivery ? 'delivery' : null, modRetirada ? 'retirada' : null].filter(Boolean);
  if (!modalidades.length) { sbToast('err', 'Escolha pelo menos uma modalidade pra pausar'); return; }

  const pausadoAte = duracaoMin > 0 ? new Date(Date.now() + duracaoMin * 60000).toISOString() : null;
  try {
    const { data } = await sb.from('store_config').select('delivery_fee_config').single();
    const cfg = (data && typeof data.delivery_fee_config === 'object') ? data.delivery_fee_config : {};
    cfg.delivery_pausado = true;
    cfg.delivery_pausado_modalidades = modalidades;
    cfg.delivery_pausado_ate = pausadoAte;
    const { error } = await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, delivery_fee_config: cfg });
    if (error) throw error;
    _cpPausaAtualizarUI(cfg);
    sbToast('ok', '⏸ Pausa ativada pros clientes');
  } catch (e) {
    sbToast('err', 'Erro ao salvar: ' + (e.message || JSON.stringify(e)));
  }
}

async function cpPausaDeliveryReativar() {
  try {
    const { data } = await sb.from('store_config').select('delivery_fee_config').single();
    const cfg = (data && typeof data.delivery_fee_config === 'object') ? data.delivery_fee_config : {};
    cfg.delivery_pausado = false;
    const { error } = await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, delivery_fee_config: cfg });
    if (error) throw error;
    _cpPausaAtualizarUI(cfg);
    sbToast('ok', '✅ Reativado — tudo funcionando normal pros clientes');
  } catch (e) {
    sbToast('err', 'Erro ao reativar: ' + (e.message || JSON.stringify(e)));
  }
}

let _cpPausaCountdownTimer = null;
function _cpPausaAtualizarUI(cfg) {
  const cb = document.getElementById('cp-pausa-delivery');
  const opcoes = document.getElementById('cp-pausa-delivery-opcoes');
  const status = document.getElementById('cp-pausa-delivery-status');
  const statusTxt = document.getElementById('cp-pausa-delivery-status-txt');
  if (_cpPausaCountdownTimer) { clearInterval(_cpPausaCountdownTimer); _cpPausaCountdownTimer = null; }

  const ativo = !!cfg?.delivery_pausado;
  if (cb) cb.checked = ativo;
  if (opcoes) opcoes.style.display = 'none';
  if (!status) return;
  if (!ativo) { status.style.display = 'none'; return; }

  status.style.display = '';
  const modalidades = Array.isArray(cfg.delivery_pausado_modalidades) && cfg.delivery_pausado_modalidades.length ? cfg.delivery_pausado_modalidades : ['delivery'];
  const nomes = { delivery: 'Delivery', retirada: 'Retirada' };
  const nomesTxt = modalidades.map(m => nomes[m] || m).join(' e ');

  const _render = () => {
    if (!cfg.delivery_pausado_ate) {
      statusTxt.textContent = `⚠ ${nomesTxt} pausado até você reativar`;
      return;
    }
    const restanteMs = new Date(cfg.delivery_pausado_ate) - new Date();
    if (restanteMs <= 0) {
      statusTxt.textContent = `✅ Pausa expirou — ${nomesTxt} já reativado automaticamente`;
      if (cb) cb.checked = false;
      if (_cpPausaCountdownTimer) { clearInterval(_cpPausaCountdownTimer); _cpPausaCountdownTimer = null; }
      return;
    }
    const min = Math.floor(restanteMs / 60000), seg = Math.floor((restanteMs % 60000) / 1000);
    statusTxt.textContent = `⚠ ${nomesTxt} pausado — reativa sozinho em ${min}min ${seg}s`;
  };
  _render();
  _cpPausaCountdownTimer = setInterval(_render, 1000);
}

function cpGetStoreLoc() {
  if (!navigator.geolocation) { sbToast('err', 'Geolocalização não suportada'); return; }
  sbToast('ok', 'Obtendo localização...');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      const elLat = document.getElementById('cp-store-lat');
      const elLng = document.getElementById('cp-store-lng');
      if (elLat) elLat.value = lat;
      if (elLng) elLng.value = lng;
      sbToast('ok', `📍 Localização obtida: ${lat}, ${lng}`);
    },
    err => sbToast('err', 'Erro ao obter localização: ' + err.message),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function cpParseGmapsLink() {
  const raw = (document.getElementById('cp-gmaps-link')?.value || '').trim();
  if (!raw) { sbToast('err', 'Cole um link do Google Maps primeiro'); return; }

  let lat = null, lng = null;

  // Formato 1: /@lat,lng  (google.com/maps/@... ou /maps/place/.../@...)
  const atMatch = raw.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) { lat = atMatch[1]; lng = atMatch[2]; }

  // Formato 2: ?q=lat,lng ou &q=lat,lng
  if (!lat) {
    const qMatch = raw.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (qMatch) { lat = qMatch[1]; lng = qMatch[2]; }
  }

  // Formato 3: !3dLAT!4dLNG  (URLs longas do Place)
  if (!lat) {
    const dMatch = raw.match(/!3d(-?\d+\.\d+).*?!4d(-?\d+\.\d+)/);
    if (dMatch) { lat = dMatch[1]; lng = dMatch[2]; }
  }

  // Formato 4: ll=lat,lng
  if (!lat) {
    const llMatch = raw.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (llMatch) { lat = llMatch[1]; lng = llMatch[2]; }
  }

  if (lat && lng) {
    const elLat = document.getElementById('cp-store-lat');
    const elLng = document.getElementById('cp-store-lng');
    if (elLat) elLat.value = parseFloat(lat).toFixed(6);
    if (elLng) elLng.value = parseFloat(lng).toFixed(6);
    document.getElementById('cp-gmaps-link').value = '';
    sbToast('ok', `📍 Coordenadas extraídas: ${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}`);
  } else {
    sbToast('err', 'Não foi possível extrair coordenadas. Use um link completo do Google Maps (não links curtos goo.gl).');
  }
}
// ═══════════════════════════════════════
// MODELOS DE MENSAGEM — Templates editáveis pelo gestor
// ═══════════════════════════════════════
const _autoMsg = linhas => linhas.join('\n');
const _AUTO_MODELOS = {
  recebido: [
    { label: 'Modelo 1 - Direto', msg: _autoMsg(['📥 *Pedido recebido - #{id}*', '', 'Olá, {nome}! Recebemos seu pedido.', '', '*Itens*', '{itens}', '', '*Total:* R$ {total}', '', 'Em breve confirmaremos por aqui.']) },
    { label: 'Modelo 2 - Simples', msg: _autoMsg(['✅ *Pedido anotado*', '', '{nome}, seu pedido #{id} chegou certinho.', '', '*Itens*', '{itens}', '', '*Total:* R$ {total}', '', 'Vamos confirmar em instantes.']) },
    { label: 'Modelo 3 - Acolhedor', msg: _autoMsg(['📥 *Recebemos seu pedido, {nome}!*', '', 'Pedido #{id} registrado com sucesso.', '', '*Itens*', '{itens}', '', '*Total:* R$ {total}', '', 'Se precisar falar com a gente, responda esta mensagem.']) },
  ],
  confirmado: [
    { label: 'Modelo 1 - Direto', msg: _autoMsg(['✅ *Pedido confirmado - #{id}*', '', 'Olá, {nome}! Seu pedido já está em preparo.', '', '*Itens*', '{itens}', '', '*Total:* R$ {total}', '', '{tipo_entrega}']) },
    { label: 'Modelo 2 - Produção', msg: _autoMsg(['✅ *Confirmado, {nome}!*', '', 'O pedido #{id} entrou em produção.', '', '*Itens*', '{itens}', '', '*Total:* R$ {total}', '', '{tipo_entrega}']) },
    { label: 'Modelo 3 - Leve', msg: _autoMsg(['🍽️ *Tudo certo por aqui*', '', '{nome}, confirmamos o pedido #{id}.', '', 'Já estamos preparando com cuidado.', '', '{tipo_entrega}']) },
  ],
  pronto: [
    { label: 'Modelo 1 - Direto', msg: _autoMsg(['🔔 *Pedido pronto - #{id}*', '', '{nome}, seu pedido está pronto.', '', '{tipo_entrega}', '', 'Qualquer dúvida, é só responder esta mensagem.']) },
    { label: 'Modelo 2 - Retirada', msg: _autoMsg(['🔔 *Pronto para retirada*', '', '{nome}, o pedido #{id} já está pronto.', '', '{tipo_entrega}', '', 'Estamos te aguardando.']) },
    { label: 'Modelo 3 - Simples', msg: _autoMsg(['✅ *Pedido #{id} pronto*', '', '{nome}, finalizamos seu pedido.', '', '{tipo_entrega}']) },
  ],
  entrega: [
    { label: 'Modelo 1 - Direto', msg: _autoMsg(['🛵 *Saiu para entrega - #{id}*', '', '{nome}, seu pedido está a caminho.', '', '*Endereço*', '{endereco}', '', 'Fique de olho por aí.']) },
    { label: 'Modelo 2 - A caminho', msg: _autoMsg(['🛵 *A caminho, {nome}!*', '', 'O pedido #{id} saiu para entrega.', '', '*Endereço*', '{endereco}', '', 'Em breve chega até você.']) },
    { label: 'Modelo 3 - Curto', msg: _autoMsg(['🛵 *Pedido #{id} saiu*', '', '{nome}, seu pedido saiu para entrega.', '', '{endereco}']) },
  ],
  cancelado: [
    { label: 'Modelo 1 - Padrão', msg: _autoMsg(['⚠️ *Pedido cancelado - #{id}*', '', 'Olá, {nome}. Infelizmente seu pedido foi cancelado.', '', 'Se tiver alguma dúvida, responda esta mensagem que vamos ajudar.']) },
    { label: 'Modelo 2 - Cordial', msg: _autoMsg(['⚠️ *Aviso sobre o pedido #{id}*', '', '{nome}, precisamos cancelar este pedido.', '', 'Fale com a gente por aqui se quiser entender melhor ou refazer o pedido.']) },
  ],
  aniversario: [
    { label: 'Modelo 1 - Clássico', msg: _autoMsg(['🎉 *Feliz aniversário, {nome}!*', '', 'Desejamos um dia leve, feliz e cheio de coisas boas.', '', 'Com carinho,', 'nossa equipe.']) },
    { label: 'Modelo 2 - Carinhoso', msg: _autoMsg(['🎉 *Hoje é seu dia, {nome}!*', '', 'Que seu aniversário seja especial e cheio de bons momentos.', '', 'A nossa equipe te deseja muitas felicidades.']) },
    { label: 'Modelo 3 - Simples', msg: _autoMsg(['🎂 *Feliz aniversário, {nome}!*', '', 'Que seu dia seja muito feliz.', '', 'Conte sempre com a gente.']) },
  ],
  boasvindas: [
    { label: 'Modelo 1 - Acolhedor', msg: _autoMsg(['👋 *Bem-vindo(a), {nome}!*', '', 'Ficamos felizes com seu primeiro pedido.', '', 'Sempre que precisar, é só chamar por aqui.']) },
    { label: 'Modelo 2 - Simples', msg: _autoMsg(['👋 *Olá, {nome}!*', '', 'Seja muito bem-vindo(a).', '', 'Obrigado pelo primeiro pedido. Estamos por aqui se precisar.']) },
  ],
  avaliacao: [
    { label: 'Modelo 1 - Direto', msg: _autoMsg(['⭐ *Como foi seu pedido, {nome}?*', '', 'Esperamos que tenha gostado do pedido #{id}.', '', 'Sua opinião ajuda muito a gente melhorar:', '{link_avaliacao}']) },
    { label: 'Modelo 2 - Agradecimento', msg: _autoMsg(['⭐ *Obrigado pelo pedido, {nome}!*', '', 'Foi um prazer te atender no pedido #{id}.', '', 'Conta pra gente como foi:', '{link_avaliacao}']) },
  ],
  retorno: [
    { label: 'Modelo 1 - Saudade', msg: _autoMsg(['😋 *Sentimos sua falta, {nome}!*', '', 'Tem novidade esperando por você no cardápio.', '', 'Acesse:', '{link_cardapio}']) },
    { label: 'Modelo 2 - Convite', msg: _autoMsg(['👋 *Oi, {nome}!*', '', 'Passando para te convidar a pedir com a gente de novo.', '', 'Cardápio:', '{link_cardapio}']) },
  ],
  pedido_perdido: [
    { label: 'Modelo 1 - Cordial', msg: _autoMsg(['👋 *Oi, {nome}!*', '', 'Vi que você passou por aqui e ainda não finalizou o pedido.', '', 'Se precisar de ajuda, é só responder esta mensagem.', '', 'Cardápio:', '{link_cardapio}']) },
    { label: 'Modelo 2 - Ajuda', msg: _autoMsg(['👋 *Olá, {nome}!*', '', 'Percebi que seu pedido ficou pendente.', '', 'Posso ajudar com alguma dúvida?', '', 'Acesse:', '{link_cardapio}']) },
    { label: 'Modelo 3 - Direto', msg: _autoMsg(['🛒 *Seu pedido ficou quase pronto*', '', '{nome}, falta só finalizar pelo cardápio.', '', 'Se precisar, chama a gente por aqui.', '', '{link_cardapio}']) },
  ],
};

let _modelosTipoAtual = null;

function abrirModelosModal(tipo) {
  _modelosTipoAtual = tipo;
  const modelos = _AUTO_MODELOS[tipo] || [];
  const overlay  = document.getElementById('auto-modelos-overlay');
  const lista    = document.getElementById('auto-modelos-lista');
  const tituloEl = document.getElementById('auto-modelos-titulo');
  if (!overlay || !lista) return;
  const nomes = {
    recebido:'Pedido Recebido', confirmado:'Pedido Confirmado', pronto:'Pedido Pronto',
    entrega:'Saiu para Entrega', cancelado:'Pedido Cancelado', aniversario:'Aniversário',
    boasvindas:'Boas-vindas', avaliacao:'Avaliação', retorno:'Retorno de Cliente',
    pedido_perdido:'Pedido Perdido (10 min)',
  };
  if (tituloEl) tituloEl.textContent = 'Modelos — ' + (nomes[tipo] || tipo);
  lista.innerHTML = [
    `<div style="padding:14px;border:1.5px dashed var(--border);border-radius:10px;cursor:pointer;transition:border-color .15s" onclick="_usarVariacoesAuto()" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
        <span style="font-size:15px">🔄</span>
        <span style="font-weight:600;font-size:13px;color:var(--accent)">Usar variações automáticas do sistema</span>
      </div>
      <div style="font-size:11.5px;color:var(--muted);line-height:1.5">O sistema escolhe aleatoriamente entre as variações padrão a cada envio — mensagens mais humanizadas e menos repetitivas. (Apaga o texto atual)</div>
    </div>`,
    ...modelos.map((m, i) => `
      <div style="padding:14px;border:1.5px solid var(--border);border-radius:10px;cursor:pointer;transition:border-color .15s" onclick="_selecionarModelo(${i})" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="font-weight:600;font-size:12.5px;color:var(--accent)">${m.label}</span>
          <span style="font-size:11px;background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:1px 8px;color:var(--muted)">Usar este</span>
        </div>
        <pre style="font-family:'DM Sans',sans-serif;font-size:11.5px;color:var(--muted2);white-space:pre-wrap;margin:0;line-height:1.55;max-height:110px;overflow:hidden">${m.msg}</pre>
      </div>
    `)
  ].join('');
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function _fecharModelosModal() {
  const overlay = document.getElementById('auto-modelos-overlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
  _modelosTipoAtual = null;
}

function _selecionarModelo(idx) {
  if (!_modelosTipoAtual) return;
  const m = (_AUTO_MODELOS[_modelosTipoAtual] || [])[idx];
  if (!m) return;
  const ta = document.getElementById(`auto-msg-${_modelosTipoAtual}`);
  if (ta) ta.value = m.msg;
  _fecharModelosModal();
  sbToast('ok', 'Modelo aplicado! Lembre de salvar as automações.');
}

function _usarVariacoesAuto() {
  if (!_modelosTipoAtual) return;
  const ta = document.getElementById(`auto-msg-${_modelosTipoAtual}`);
  if (ta) ta.value = '';
  _fecharModelosModal();
  sbToast('ok', 'Variações automáticas ativadas! Lembre de salvar as automações.');
}

buildEmojiGrid();
if (typeof isBillingLocked === 'function' && isBillingLocked()) {
  if (typeof billingApplyLockUI === 'function') billingApplyLockUI();
} else {
  initSidebarState();
  requestNotifPermission();
  loadAllData();
  setTimeout(_iniciarSchedulerAniversario, 3000);
}
// Inicia scheduler automático de aniversário

// ════════════════════════════════════════════════════════
// TEMA — Delegado ao gestor-temas.js
// Este bloco apenas garante compatibilidade e init rápido
// ════════════════════════════════════════════════════════

// Compat: MODO_ESCURO/MODO_CLARO apontam para os do gestor-temas.js
const MODO_ESCURO = GESTOR_TEMAS[0].vars;
const MODO_CLARO  = GESTOR_TEMAS[1].vars;
const TEMAS_PRONTOS = GESTOR_TEMAS.map(t => ({ nome: t.nome, vars: t.vars }));

// Stub legado
function temaApply(vars, save) { _aplicarVars(vars); }

// Aplica o tema em cache imediatamente (antes do banco carregar)
(function(){
  try { ['ef_tema_modo','ef_tema_v2','tema','theme'].forEach(k=>localStorage.removeItem(k)); } catch(e){}
  let inicial = 'claro';
  try { inicial = localStorage.getItem('gestor_tema_atual') || document.documentElement.dataset.gestorTheme || 'claro'; } catch(e){}
  if (typeof temaAplicarCompleto === 'function') temaAplicarCompleto(inicial);
  else _aplicarVars(inicial === 'claro' ? MODO_CLARO : MODO_ESCURO);
})();

// ── Registra webhook na Evolution API automaticamente ──
// Retorna true/false pra quem chamar poder avisar o usuário se falhou.
async function iaRegistrarWebhook(webhookUrl) {
  try {
    const { data: cfg } = await sb.from('store_config').select('evo_instance').single();
    const inst = cfg?.evo_instance;
    if (!inst) return false; // instância ainda não criada, nada a fazer
    if (!webhookUrl) {
      const _slugRes4 = await fetch('/api/tenant-slug', { headers: { 'Content-Type': 'application/json', 'x-tenant-id': _sessao?.tenant_id || '' } }).catch(()=>null);
      const slug = (_slugRes4?.ok ? (await _slugRes4.json().catch(()=>({}))).slug : '') || _sessao?.tenant_id || '';
      webhookUrl = `${window.location.origin}/webhook/${slug}`;
    }
    // Evolution API v2.7: /webhook/set/{instance} espera o payload SEM envelope "webhook"
    const payload = {
      enabled: true,
      url: webhookUrl,
      webhookByEvents: false,
      webhookBase64: false,
      events: ['MESSAGES_UPSERT']
    };
    let r = await EVO.req('POST', `/webhook/set/${inst}`, payload);
    // Fallback: caso a instância rode uma versão mais antiga que exija o formato envelopado
    if (!r.ok) {
      r = await EVO.req('POST', `/webhook/set/${inst}`, { webhook: payload });
    }
    if (!r.ok) {
      console.error('iaRegistrarWebhook: FALHOU nas duas tentativas para instância', inst, r);
      sbToast('err', `Não foi possível terminar de configurar a conexão "${inst}". O WhatsApp pode não responder mensagens. Tente novamente em "Verificar webhook".`);
      return false;
    }
    return true;
  } catch(e) {
    console.warn('iaRegistrarWebhook:', e);
    sbToast('err', 'Erro ao configurar webhook: ' + e.message);
    return false;
  }
}

// ═══════════════════════════════════════
// CLIENTE PEDIU ATENDENTE (WhatsApp)
// Quando o cliente pede para falar com alguém (ou o robô percebe uma
// reclamação), o robô para de responder esse cliente e o painel mostra um
// aviso com o botão para abrir a conversa.
// ═══════════════════════════════════════
let _waAlertasES = null;
function waAlertasIniciar(tid) {
  if (_waAlertasES || !tid || typeof EventSource === 'undefined') return;
  try {
    _waAlertasES = new EventSource('/sse/' + encodeURIComponent('wa-alerta:' + tid));
    const tratar = ev => { try { _waAlertaMostrar(JSON.parse(ev.data || '{}'), ev.type); } catch (e) {} };
    _waAlertasES.addEventListener('wa:atendimento', tratar);
    _waAlertasES.addEventListener('wa:atendimento_urgente', tratar);
    _waAlertasES.onerror = () => {
      try { _waAlertasES.close(); } catch (e) {}
      _waAlertasES = null;
      setTimeout(() => waAlertasIniciar(tid), 5000);
    };
  } catch (e) { _waAlertasES = null; }
}
function _waAlertaFone(p) {
  const d = String(p || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d || p;
}
function _waAlertaMostrar(d, tipo) {
  if (!d || !d.phone) return;
  if (!document.getElementById('wa-alertas-css')) {
    const st = document.createElement('style');
    st.id = 'wa-alertas-css';
    st.textContent = `
#wa-alertas{position:fixed;left:16px;bottom:16px;z-index:9500;display:flex;flex-direction:column;gap:10px;width:min(360px,calc(100vw - 32px))}
.wa-alerta{background:var(--surface,#fff);color:var(--text,#101828);border:1px solid var(--border,#e4e7ec);border-left:4px solid #16a34a;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.18);padding:14px 14px 12px}
.wa-alerta.urg{border-left-color:#dc2626}
.wa-alerta strong{display:block;font-size:14px;margin-bottom:2px}
.wa-alerta .wal-sub{font-size:12.5px;color:var(--muted,#667085);line-height:1.45}
.wa-alerta .wal-bt{display:flex;gap:8px;margin-top:10px}
.wa-alerta button{border:0;border-radius:10px;font:inherit;font-size:13px;font-weight:700;padding:8px 12px;cursor:pointer}
.wa-alerta .wal-ok{background:#16a34a;color:#fff;flex:1}
.wa-alerta .wal-x{background:transparent;color:var(--muted,#667085)}`;
    document.head.appendChild(st);
  }
  let box = document.getElementById('wa-alertas');
  if (!box) { box = document.createElement('div'); box.id = 'wa-alertas'; box.setAttribute('aria-live', 'assertive'); document.body.appendChild(box); }
  const urg = tipo === 'wa:atendimento_urgente';
  const el = document.createElement('div');
  el.className = 'wa-alerta' + (urg ? ' urg' : '');
  el.setAttribute('role', 'alert');
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const titulo = urg ? 'Cliente precisa de atenção' : 'Cliente pediu atendente';
  const detalhe = urg ? (d.mensagem ? `"${esc(String(d.mensagem).slice(0, 120))}"` : 'Reclamação ou urgência no WhatsApp.')
    : (d.resumo ? `Estava pedindo: ${esc(d.resumo)}` : 'O robô parou de responder esse cliente para você atender.');
  el.innerHTML = `<strong>${titulo}</strong><div class="wal-sub">${esc(_waAlertaFone(d.phone))}<br>${detalhe}</div>
    <div class="wal-bt"><button type="button" class="wal-x">Fechar</button><button type="button" class="wal-ok">Abrir conversa</button></div>`;
  el.querySelector('.wal-x').onclick = () => el.remove();
  el.querySelector('.wal-ok').onclick = () => {
    el.remove();
    const jid = String(d.phone).replace(/\D/g, '') + '@s.whatsapp.net';
    try { if (typeof waOpenPanel === 'function') waOpenPanel(); } catch (e) {}
    setTimeout(() => { try { if (typeof waOpenConv === 'function') waOpenConv(jid, _waAlertaFone(d.phone)); } catch (e) {} }, 400);
  };
  box.appendChild(el);
  try { if (typeof sbToast === 'function') sbToast('ok', titulo); } catch (e) {}
}
(function _waAlertasBoot() {
  const tid = (typeof _sessao !== 'undefined' && _sessao) ? _sessao.tenant_id : null;
  if (!tid) { setTimeout(_waAlertasBoot, 2000); return; }
  waAlertasIniciar(tid);
})();

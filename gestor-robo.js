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

let evoMsgHistory = [];
let evoConnected  = false;
let evoQrInterval = null;

function roboTab(tab) {
  ['wp','auto','msgs','ia','chat'].forEach(t => {
    document.getElementById('robo-tab-'+t)?.classList.toggle('on', t===tab);
    const s = document.getElementById('robo-section-'+t);
    if (s) s.style.display = t===tab ? '' : 'none';
  });
  if (tab==='msgs') evoCarregarHistorico();
  if (tab==='wp')   evoCheckStatus();
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

async function evoCriarInstancia() {
  const instName = EVO.instance;
  if (!instName) { sbToast('err', 'Informe o nome da instância antes de criar.'); return; }
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
      sbToast('ok', `Instância "${instName}" já existe. Usando existente...`);
      sbLoading(false);
      await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, evo_instance: instName });
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
  await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, evo_instance: instName });
  const whOk = await iaRegistrarWebhook();
  sbToast('ok', `Instância "${instName}" criada!${whOk ? '' : ' (verifique o webhook manualmente)'}`);

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
    if (qrArea) qrArea.innerHTML=`<div style="font-size:13px;color:var(--danger);margin-bottom:12px">${r?.data?.message||'Erro ao gerar QR. Verifique se a instância existe.'}</div><button class="btn bp" onclick="evoCriarInstancia()">Criar instância</button>`;
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
    if (state==='open') { clearInterval(evoQrInterval); evoConnected=true; _evoSetStatus('connected','Conectado'); _evoShowConnected(s.data?.instance?.profileName||'WhatsApp'); sbToast('ok',' WhatsApp conectado!'); iaRegistrarWebhook(); }
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
    if (ia.horario_txt) { const el = document.getElementById('ia-horario-txt'); if(el) el.value = ia.horario_txt; }
    if (ia.entrega_txt) { const el = document.getElementById('ia-entrega-txt'); if(el) el.value = ia.entrega_txt; }
  } catch(e) { console.warn('iaCarregarConfig:', e); }
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
    const { data } = await sb.from('store_config').select('ia_config').single();
    iaAtual = data?.ia_config ? JSON.parse(data.ia_config) : {};
  } catch(e) {}

  const ia = {
    ...iaAtual, // preserva openai_key, modelo, prompt_base, quebra_linha, buffer_seg, pausa_min
    ativo:        document.getElementById('ia-toggle-ativo')?.classList.contains('on'),
    resp_cardapio:document.getElementById('ia-resp-cardapio')?.classList.contains('on'),
    resp_pedido:  document.getElementById('ia-resp-pedido')?.classList.contains('on'),
    resp_horario: document.getElementById('ia-resp-horario')?.classList.contains('on'),
    resp_entrega: document.getElementById('ia-resp-entrega')?.classList.contains('on'),
    resp_promo:   document.getElementById('ia-resp-promo')?.classList.contains('on'),
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
    'store_name,store_descricao,store_logo_url,store_banner_url,store_banners,store_cor,store_tema,store_tempo_entrega,store_avaliacao,store_whatsapp,horarios_config,pedido_minimo,store_address,store_lat,store_lng,tipos_entrega,delivery_fee_config,pickup_addresses'
  ).single();
  if (!data) return;

  const v = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined && val !== null) el.value = val; };
  v('cp-nome',          data.store_name);
  v('cp-descricao',     data.store_descricao);
  v('cp-whatsapp',      data.store_whatsapp);
  v('cp-tempo',         data.store_tempo_entrega);
  v('cp-avaliacao',     data.store_avaliacao);
  v('cp-pedido-minimo', data.pedido_minimo ?? 0);
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

  // Pausa de delivery — vem dentro do delivery_fee_config
  const feeCfg = data.delivery_fee_config || {};
  const elPausa = document.getElementById('cp-pausa-delivery');
  const elPausaStatus = document.getElementById('cp-pausa-delivery-status');
  if (elPausa) {
    elPausa.checked = !!feeCfg.delivery_pausado;
    if (elPausaStatus) elPausaStatus.style.display = feeCfg.delivery_pausado ? '' : 'none';
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
  // Oculta opção de carrossel se for açougue (já usa por padrão)
  // Busca segmento direto para não depender de window._segmento que pode não ter carregado
  const catsWrap = document.getElementById('cp-cats-modo-wrap');
  if (catsWrap) {
    const _tid = _sessao?.tenant_id;
    if (_tid) {
      fetch('/api/tenant-segmento', { headers: { 'x-tenant-id': _tid } })
        .then(r => r.json())
        .then(d => { catsWrap.style.display = d.segmento === 'acougue' ? 'none' : 'block'; })
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
        <div style="flex:1;font-size:12px;color:var(--muted)">${b.type === 'video' ? '🎬 Vídeo' : '🖼️ Imagem'} ${i === 0 ? '· principal' : ''}</div>
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
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
      reader.readAsDataURL(file);
    });

    _cpBanners.push({ type: isVideo ? 'video' : 'image', url: dataUrl });
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
      horarios_config:     JSON.stringify(cpGetHorarios()),
      pedido_minimo:       parseFloat(document.getElementById('cp-pedido-minimo')?.value) || 0,
      store_address:       document.getElementById('cp-store-address')?.value.trim() || null,
      store_lat:           parseFloat(document.getElementById('cp-store-lat')?.value)  || null,
      store_lng:           parseFloat(document.getElementById('cp-store-lng')?.value)  || null,
      tipos_entrega:       cpGetTiposEntrega(),
      pickup_addresses:    JSON.stringify(cpGetPickupAddresses()),
    };
    if (_cpLogoUrl)   payload.store_logo_url   = _cpLogoUrl;
    payload.store_banners    = JSON.stringify(_cpBanners);
    payload.store_banner_url = _cpBannerUrl;

    const { error } = await sb.from('store_config').upsert(payload);
    if (error) throw error;
    sbToast('ok', 'Cardápio público salvo!');
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

// Pausa rápida de delivery — salva IMEDIATAMENTE no clique
// (preserva resto da config do delivery_fee_config)
async function cpPausaDeliveryChange() {
  const cb     = document.getElementById('cp-pausa-delivery');
  const status = document.getElementById('cp-pausa-delivery-status');
  if (!cb) return;
  const pausado = !!cb.checked;
  if (status) status.style.display = pausado ? '' : 'none';
  try {
    const { data } = await sb.from('store_config').select('delivery_fee_config').single();
    const cfg = (data && typeof data.delivery_fee_config === 'object') ? data.delivery_fee_config : {};
    cfg.delivery_pausado = pausado;
    const { error } = await sb.from('store_config').upsert({
      tenant_id: _sessao?.tenant_id,
      delivery_fee_config: cfg
    });
    if (error) throw error;
    sbToast('ok', pausado ? '⏸ Delivery pausado para clientes' : '✅ Delivery reativado');
  } catch (e) {
    sbToast('err', 'Erro ao salvar: ' + (e.message || JSON.stringify(e)));
    // Reverte UI em caso de erro
    cb.checked = !pausado;
    if (status) status.style.display = !pausado ? '' : 'none';
  }
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
      sbToast('err', `Não foi possível configurar o webhook da instância "${inst}". O WhatsApp pode não responder mensagens. Tente novamente em "Verificar webhook".`);
      return false;
    }
    return true;
  } catch(e) {
    console.warn('iaRegistrarWebhook:', e);
    sbToast('err', 'Erro ao configurar webhook: ' + e.message);
    return false;
  }
}

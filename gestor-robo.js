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
  sbToast('ok', `Instância "${instName}" criada!`);

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
    if (state==='open') { clearInterval(evoQrInterval); evoConnected=true; _evoSetStatus('connected','Conectado'); _evoShowConnected(s.data?.instance?.profileName||'WhatsApp'); sbToast('ok',' WhatsApp conectado!'); }
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

async function evoEnviarMensagem(phone, tipo, vars={}) {
  // Verifica se o toggle da automação está ativo
  const toggle = document.getElementById(`auto-toggle-${tipo}`);
  if (toggle && !toggle.classList.contains('on')) return false;
  const msgEl = document.getElementById(`auto-msg-${tipo}`);
  if (!msgEl) return false;
  let text = msgEl.value;
  Object.entries(vars).forEach(([k,v])=>{ text=text.replaceAll(`{${k}}`,v||''); });
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
  const tipos = ['pix_cobranca','pix_copia_cola','pix_confirmado','recebido','confirmado','pronto','entrega','cancelado','aniversario','boasvindas','avaliacao','retorno','promocao','pontos','cashback','conta'];
  const data = {};
  tipos.forEach(tipo => {
    data[tipo] = {
      on:  document.getElementById(`auto-toggle-${tipo}`)?.classList.contains('on'),
      msg: document.getElementById(`auto-msg-${tipo}`)?.value
    };
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
    const cfg = data?.evo_automacoes || {};
    Object.entries(cfg).forEach(([tipo, val]) => {
      if (tipo.startsWith('_')) return;
      const t = document.getElementById(`auto-toggle-${tipo}`);
      const m = document.getElementById(`auto-msg-${tipo}`);
      if (t) { val.on ? t.classList.add('on') : t.classList.remove('on'); }
      if (m && val.msg) m.value = val.msg;
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
    // Chama a Edge Function — roda no servidor Supabase, não no browser
    const r = await fetch(`${WA_SERVER}/promocao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destino, msg })
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

function cpRenderHorarios(horarios) {
  const container = document.getElementById('cp-horarios-list');
  if (!container) return;
  container.innerHTML = '';
  for (const d of _CP_DIAS) {
    const h = horarios[d.key] || { ativo: d.key !== 'dom', abertura: '11:00', fechamento: '22:00' };
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:9px;transition:opacity .15s';
    row.id = `cp-hr-row-${d.key}`;
    row.innerHTML = `
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;min-width:80px">
        <div class="toggle-wrap" onclick="cpToggleDia('${d.key}',this)" data-ativo="${h.ativo}" style="width:34px;height:18px;border-radius:9px;background:${h.ativo?'var(--success)':'var(--surface)'};border:1px solid ${h.ativo?'var(--success)':'var(--border)'};position:relative;cursor:pointer;transition:all .2s;flex-shrink:0">
          <div style="position:absolute;top:2px;left:${h.ativo?'16px':'2px'};width:12px;height:12px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>
        </div>
        <span style="font-size:12px;font-weight:600;color:${h.ativo?'var(--text)':'var(--muted)'}" id="cp-hr-label-${d.key}">${d.label}</span>
      </label>
      <div id="cp-hr-times-${d.key}" style="display:${h.ativo?'flex':'none'};align-items:center;gap:6px;flex:1">
        <input type="time" value="${h.abertura||'11:00'}" id="cp-hr-ab-${d.key}"
          style="background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:5px 8px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:12px;outline:none;width:90px"
          oninput="cpHorarioChanged()">
        <span style="font-size:11px;color:var(--muted)">até</span>
        <input type="time" value="${h.fechamento||'22:00'}" id="cp-hr-fch-${d.key}"
          style="background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:5px 8px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:12px;outline:none;width:90px"
          oninput="cpHorarioChanged()">
      </div>
      <span id="cp-hr-fechado-${d.key}" style="display:${h.ativo?'none':'flex'};font-size:11px;color:var(--muted);font-weight:600;flex:1">Fechado</span>
    `;
    container.appendChild(row);
  }
}

function cpToggleDia(key, toggleEl) {
  const timesEl  = document.getElementById(`cp-hr-times-${key}`);
  const fechEl   = document.getElementById(`cp-hr-fechado-${key}`);
  const labelEl  = document.getElementById(`cp-hr-label-${key}`);
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
}

function cpGetHorarios() {
  const out = {};
  for (const d of _CP_DIAS) {
    const toggleEl = document.querySelector(`#cp-hr-row-${d.key} .toggle-wrap`);
    const ativo    = toggleEl ? toggleEl.dataset.ativo === 'true' : false;
    out[d.key] = {
      ativo,
      abertura:    document.getElementById(`cp-hr-ab-${d.key}`)?.value  || '11:00',
      fechamento:  document.getElementById(`cp-hr-fch-${d.key}`)?.value || '22:00',
    };
  }
  return out;
}

function cpHorarioChanged() { /* placeholder para futuros listeners */ }


let _cpLogoUrl   = '';
let _cpBannerUrl = '';

async function loadCardapioPublico() {
  const { data } = await sb.from('store_config').select(
    'store_name,store_descricao,store_logo_url,store_banner_url,store_cor,store_tema,store_tempo_entrega,store_avaliacao,store_whatsapp,horarios_config,pedido_minimo,store_address,store_lat,store_lng,tipos_entrega'
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
  if (data.store_banner_url) {
    _cpBannerUrl = data.store_banner_url;
    const prev = document.getElementById('cp-banner-preview');
    if (prev) { prev.innerHTML = ''; prev.style.backgroundImage = `url(${_cpBannerUrl})`; }
    const hero = document.getElementById('cp-preview-hero');
    if (hero) hero.style.backgroundImage = `url(${_cpBannerUrl})`;
  }

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
  // Atualiza borda visual de cada card
  document.querySelectorAll('.cp-tema-card').forEach(card => {
    const isSelected = card.dataset.tema === tema;
    card.style.borderColor = isSelected ? 'var(--accent)' : 'transparent';
    const check = card.querySelector('.cp-tema-check');
    if (check) check.style.display = isSelected ? 'flex' : 'none';
  });
  // Armazena tema selecionado no input oculto
  let inp = document.getElementById('cp-tema-value');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'hidden';
    inp.id = 'cp-tema-value';
    document.body.appendChild(inp);
  }
  inp.value = tema;
}

// Preview agora é o iframe real — cpPreviewCor e cpAtualizarPreview não são mais necessários

async function cpUploadImagem(input, tipo) {
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

    if (tipo === 'logo') {
      _cpLogoUrl = dataUrl;
      const prev = document.getElementById('cp-logo-preview');
      if (prev) { prev.innerHTML = ''; prev.style.backgroundImage = `url(${dataUrl})`; prev.style.backgroundSize = 'cover'; prev.style.backgroundPosition = 'center'; }
      const pp = document.getElementById('cp-prev-logo');
      if (pp) { pp.innerHTML = ''; pp.style.backgroundImage = `url(${dataUrl})`; pp.style.backgroundSize = 'cover'; pp.style.backgroundPosition = 'center'; }
    } else {
      _cpBannerUrl = dataUrl;
      const prev = document.getElementById('cp-banner-preview');
      if (prev) { prev.innerHTML = ''; prev.style.backgroundImage = `url(${dataUrl})`; }
      const hero = document.getElementById('cp-preview-hero');
      if (hero) hero.style.backgroundImage = `url(${dataUrl})`;
    }

    // Salva data URL no banco imediatamente — persiste mesmo após reinício do container
    const field = tipo === 'logo' ? 'store_logo_url' : 'store_banner_url';
    const { error } = await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, [field]: dataUrl });
    if (error) throw new Error(error.message || JSON.stringify(error));

    sbToast('ok', `${tipo === 'logo' ? 'Logo' : 'Banner'} enviado e salvo!`);
    // Recarrega iframe para refletir a nova imagem no cardápio
    setTimeout(() => cpRecarregarIframe(), 600);
  } catch(e) {
    console.error('cpUploadImagem:', e);
    sbToast('err', 'Erro ao enviar imagem: ' + (e.message || ''));
  } finally {
    sbLoading(false);
  }
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
    };
    if (_cpLogoUrl)   payload.store_logo_url   = _cpLogoUrl;
    if (_cpBannerUrl) payload.store_banner_url = _cpBannerUrl;

    const { error } = await sb.from('store_config').upsert(payload);
    if (error) throw error;
    sbToast('ok', 'Cardápio público salvo!');
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
// ═══════════════════════════════════════
// MODELOS DE MENSAGEM — Templates editáveis pelo gestor
// ═══════════════════════════════════════
const _AUTO_MODELOS = {
  recebido: [
    { label: 'Modelo 1 — Direto',    msg: '📥 Olá *{nome}*! Recebemos seu pedido *#{id}* com sucesso! 🎉\n\n🛒 *Itens:*\n{itens}\n\n💰 *Total: R$ {total}*\n\n⏱️ Em breve confirmaremos por aqui!\n\n_Dúvidas? É só responder esta mensagem!_ 😊' },
    { label: 'Modelo 2 — Animado',   msg: '✅ Chegou, *{nome}*!\n\nSeu pedido *#{id}* entrou na nossa fila. Obrigado por escolher a gente! 🙌\n\n🛒 *Itens:*\n{itens}\n\n💰 *Total: R$ {total}*\n\nVou te avisar assim que confirmarmos!\n\n_Dúvidas? É só responder esta mensagem!_ 😊' },
    { label: 'Modelo 3 — Acolhedor', msg: '🎯 *Pedido #{id} anotado!*\n\n*{nome}*, que ótimo ter você aqui! Recebemos seu pedido certinho.\n\n🛒 *Itens:*\n{itens}\n\n💰 *Total: R$ {total}*\n\n⏳ Aguarda só um instante que confirmamos logo!\n\n_Dúvidas? É só responder esta mensagem!_ 😊' },
  ],
  confirmado: [
    { label: 'Modelo 1 — Direto',    msg: '✅ Olá *{nome}*! Seu pedido *#{id}* foi confirmado e está sendo preparado! 🍽️\n\n🛒 *Itens:*\n{itens}\n\n💰 *Total: R$ {total}*\n\n{tipo_entrega}\n\n_Dúvidas? É só responder esta mensagem!_ 😊' },
    { label: 'Modelo 2 — Animado',   msg: '🔥 *Mãos à obra, {nome}!*\n\nSeu pedido *#{id}* foi confirmado e já está sendo preparado com muito carinho! ❤️\n\n🛒 *Itens:*\n{itens}\n\n💰 *Total: R$ {total}*\n\n{tipo_entrega}\n\n_Dúvidas? É só responder esta mensagem!_ 😊' },
    { label: 'Modelo 3 — Simples',   msg: '✅ *Confirmado, {nome}!*\n\nPedido *#{id}* na produção agora. A gente capricha pra você!\n\n🛒 *Itens:*\n{itens}\n\n💰 *Total: R$ {total}*\n\n_Dúvidas? É só responder esta mensagem!_ 😊' },
  ],
  pronto: [
    { label: 'Modelo 1 — Direto',    msg: '🛎️ *{nome}*, seu pedido *#{id}* está PRONTO! ✅\n\n{tipo_entrega}\n\n_Dúvidas? É só responder esta mensagem!_ 😊' },
    { label: 'Modelo 2 — Animado',   msg: '🎉 *Pedido #{id} pronto!*\n\n*{nome}*, ficou ótimo e está te esperando!\n\n{tipo_entrega}\n\n_Dúvidas? É só responder esta mensagem!_ 😊' },
    { label: 'Modelo 3 — Caprichado',msg: '🔥 *Tá na hora, {nome}!*\n\nSeu pedido *#{id}* foi preparado com capricho e está pronto!\n\n{tipo_entrega}\n\n_Dúvidas? É só responder esta mensagem!_ 😊' },
  ],
  entrega: [
    { label: 'Modelo 1 — Direto',    msg: '🛵 *{nome}*, seu pedido *#{id}* saiu para entrega!\n\n📍 *Endereço:* {endereco}\n\nFique de olho, hein! 😉\n\n_Dúvidas? É só responder esta mensagem!_ 😊' },
    { label: 'Modelo 2 — Animado',   msg: '🛵 *Saiu, {nome}!*\n\nSeu pedido *#{id}* está na estrada. Chegaremos em breve!\n\n📍 *Destino:* {endereco}\n\n_Dúvidas? É só responder esta mensagem!_ 😊' },
    { label: 'Modelo 3 — Urgente',   msg: '🏃 *A caminho, {nome}!*\n\nPedido *#{id}* saiu para entrega. O nosso entregador está indo até você agora! 🛵\n\n📍 {endereco}\n\n_Dúvidas? É só responder esta mensagem!_ 😊' },
  ],
  cancelado: [
    { label: 'Modelo 1 — Padrão',  msg: '😔 *Pedido #{id} cancelado*\n\n*{nome}*, sentimos muito pelo inconveniente. Infelizmente seu pedido precisou ser cancelado.\n\nEstamos à disposição se quiser fazer um novo pedido ou esclarecer qualquer dúvida.\n\n_Dúvidas? É só responder esta mensagem!_ 😊' },
    { label: 'Modelo 2 — Cordial', msg: '⚠️ *Aviso sobre o pedido #{id}*\n\nOi, *{nome}*. Lamentamos informar que seu pedido foi cancelado.\n\nQualquer dúvida, é só responder aqui — vamos resolver juntos! 🤝' },
  ],
  aniversario: [
    { label: 'Modelo 1 — Clássico', msg: '🎉 Feliz aniversário, *{nome}*! 🥳\nQue seu dia seja incrível e cheio de coisas boas!\nDesejamos tudo de melhor pra você! 🎂❤️' },
    { label: 'Modelo 2 — Animado',  msg: '🎂 *Hoje é dia de festa, {nome}!*\n\nA nossa equipe toda te deseja um aniversário muito especial! Que venham muitos momentos felizes. 🥳✨' },
    { label: 'Modelo 3 — Simples',  msg: '🎈 *Feliz aniversário, {nome}!*\n\nEsperamos que hoje seja um dia muito especial para você. Conte sempre com a gente! 😊❤️' },
  ],
  boasvindas: [
    { label: 'Modelo 1 — Acolhedor', msg: '👋 Olá *{nome}*, seja muito bem-vindo(a)! 🎉\nFicamos felizes com seu primeiro pedido!\nEm caso de dúvidas, é só chamar aqui. 😊' },
    { label: 'Modelo 2 — Animado',   msg: '🌟 Seja bem-vindo(a), *{nome}*!\n\nQue alegria ter você como cliente! Esperamos que goste de tudo. Estamos aqui pra que sua experiência seja incrível! 🙌' },
  ],
  avaliacao: [
    { label: 'Modelo 1 — Direto',   msg: '⭐ *{nome}*, esperamos que tenha curtido seu pedido *#{id}*!\nConta pra gente como foi — sua opinião é muito importante!\n\nAvalie agora: {link_avaliacao}' },
    { label: 'Modelo 2 — Caloroso', msg: '🙏 *Obrigado pela preferência, {nome}!*\n\nFoi um prazer te atender no pedido *#{id}*. O que achou?\n\nSua avaliação nos ajuda muito a melhorar! ⭐\n{link_avaliacao}' },
  ],
  retorno: [
    { label: 'Modelo 1 — Saudade',  msg: '😋 *{nome}*, sentimos sua falta!\nQue tal pedir hoje? Temos novidades no cardápio te esperando! 🍽️' },
    { label: 'Modelo 2 — Animado',  msg: '👋 Oi *{nome}*! Há alguns dias não te vemos por aqui...\n\nTemos novidades esperando por você! Que tal voltar? 😊' },
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
initSidebarState();
requestNotifPermission();
loadAllData();
// Inicia scheduler automático de aniversário
setTimeout(_iniciarSchedulerAniversario, 3000);

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

// Aplica tema escuro imediatamente (antes do banco carregar)
(function(){
  try { ['ef_tema_modo','ef_tema_v2','tema','theme'].forEach(k=>localStorage.removeItem(k)); } catch(e){}
  _aplicarVars(MODO_ESCURO);
})();

// ── Registra webhook na Evolution API automaticamente ──
async function iaRegistrarWebhook(webhookUrl) {
  try {
    const { data: cfg } = await sb.from('store_config').select('evo_instance').single();
    const inst = cfg?.evo_instance;
    if (!inst) return; // instância ainda não criada, nada a fazer
    if (!webhookUrl) {
      const _slugRes4 = await fetch('/api/tenant-slug', { headers: { 'Content-Type': 'application/json', 'x-tenant-id': _sessao?.tenant_id || '' } }).catch(()=>null);
      const slug = (_slugRes4?.ok ? (await _slugRes4.json().catch(()=>({}))).slug : '') || _sessao?.tenant_id || '';
      webhookUrl = `${window.location.origin}/webhook/${slug}`;
    }
    // Chama o proxy /api/evo para setar o webhook na instância
    await EVO.req('POST', `/webhook/set/${inst}`, {
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        webhookBase64: false,
        events: ['MESSAGES_UPSERT']
      }
    });
  } catch(e) {
    console.warn('iaRegistrarWebhook:', e);
  }
}

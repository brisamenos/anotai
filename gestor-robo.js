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
  const r = await EVO.req('POST', '/instance/create', {
    instanceName: instName,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS'
  });
  sbLoading(false);
  if (r.ok) {
    // Salva evo_instance no store_config do tenant
    await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, evo_instance: instName });
    sbToast('ok', `Instância "${instName}" criada!`);
    evoCheckStatus();
  } else {
    const m = r.data?.message||r.data?.error||`Erro ${r.status}`;
    sbToast('err','Erro: '+(typeof m==='string'?m:JSON.stringify(m)));
  }
}

async function evoCheckStatus() {
  if (!EVO.instance) return;
  _evoSetStatus('loading','Verificando...');
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
  if (qrArea) qrArea.innerHTML='<div style="margin-bottom:10px"><div style="font-size:13px;color:var(--muted)">Gerando QR Code...</div>';
  const r = await EVO.req('GET', `/instance/connect/${EVO.instance}`);
  if (!r.ok || !r.data?.code) {
    if (qrArea) qrArea.innerHTML=`<div style="font-size:13px;color:var(--danger);margin-bottom:12px">${r.data?.message||'Erro ao gerar QR. Crie a instância primeiro.'}</div><button class="btn bp" onclick="evoCriarInstancia()">Criar instância</button>`;
    return;
  }
  if (qrArea) {
    if (r.data.base64) {
      qrArea.innerHTML=`<div style="font-size:13px;font-weight:600;margin-bottom:12px">Escaneie com seu WhatsApp</div><img src="${r.data.base64}" style="width:220px;height:220px;border-radius:12px;border:3px solid var(--accent);margin-bottom:12px"><div style="font-size:11px;color:var(--muted);margin-bottom:12px">QR Code expira em 60 segundos</div><button class="btn bg" style="font-size:11.5px" onclick="evoConectar()">Gerar novo QR Code</button>`;
    } else {
      qrArea.innerHTML=`<div style="font-size:12px;word-break:break-all;padding:10px;background:var(--surface2);border-radius:8px;margin-bottom:12px;color:var(--muted)">${(r.data.code||'').slice(0,80)}...</div><button class="btn bg" onclick="evoConectar()">Gerar novo QR</button>`;
    }
  }
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
  sbLoading(true);
  try {
    const ext      = file.name.split('.').pop().toLowerCase();
    const filename = `${_sessao?.tenant_id || 'default'}-${tipo}.${ext}`;
    const filepath = `branding/${filename}`;
    await sb.storage.from('menu-images').upload(filepath, file, { upsert: true });
    const { data: { publicUrl } } = sb.storage.from('menu-images').getPublicUrl(filepath);

    if (tipo === 'logo') {
      _cpLogoUrl = publicUrl;
      const prev = document.getElementById('cp-logo-preview');
      if (prev) { prev.innerHTML = ''; prev.style.backgroundImage = `url(${publicUrl})`; prev.style.backgroundSize = 'cover'; prev.style.backgroundPosition = 'center'; }
      const pp = document.getElementById('cp-prev-logo');
      if (pp) { pp.innerHTML = ''; pp.style.backgroundImage = `url(${publicUrl})`; pp.style.backgroundSize = 'cover'; pp.style.backgroundPosition = 'center'; }
    } else {
      _cpBannerUrl = publicUrl;
      const prev = document.getElementById('cp-banner-preview');
      if (prev) { prev.innerHTML = ''; prev.style.backgroundImage = `url(${publicUrl})`; }
      const hero = document.getElementById('cp-preview-hero');
      if (hero) hero.style.backgroundImage = `url(${publicUrl})`;
    }

    // Salva URL no banco imediatamente, sem precisar clicar em "Salvar"
    const field = tipo === 'logo' ? 'store_logo_url' : 'store_banner_url';
    await sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, [field]: publicUrl });

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
      store_tema:          document.getElementById('cp-tema-value')?.value          || 'classico',
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
buildEmojiGrid();
initSidebarState();
requestNotifPermission();
loadAllData();
// Inicia scheduler automático de aniversário
setTimeout(_iniciarSchedulerAniversario, 3000);

// ════════════════════════════════════════════════════════
// TEMA — Modo Escuro (navy) e Modo Claro (sidebar navy)
// ════════════════════════════════════════════════════════

const MODO_ESCURO = {
  '--bg':'#0f1117','--surface':'#181b24','--surface2':'#1e2130','--surface3':'#242840',
  '--border':'rgba(255,255,255,.07)','--border2':'rgba(255,255,255,.13)',
  '--accent':'#3b82f6','--accent2':'#06b6d4','--accent3':'#f59e0b',
  '--accent-dim':'rgba(59,130,246,.18)','--accent-glow':'rgba(59,130,246,.35)',
  '--success':'#22c55e','--danger':'#ef4444','--purple':'#8b5cf6',
  '--pink':'#ec4899','--orange':'#f97316',
  '--text':'#f1f5f9','--muted':'#64748b','--muted2':'#94a3b8',
  '--sidebar-bg':'#131929','--topnav-bg':'#0d1117','--sfoot-bg':'rgba(8,10,18,.6)'
};

const MODO_CLARO = {
  '--bg':'#f4f8ff','--surface':'#ffffff','--surface2':'#e8f0fe','--surface3':'#d6e4ff',
  '--border':'rgba(30,100,220,.13)','--border2':'rgba(30,100,220,.22)',
  '--accent':'#1a6fd4','--accent2':'#2196f3','--accent3':'#f59e0b',
  '--accent-dim':'rgba(26,111,212,.12)','--accent-glow':'rgba(26,111,212,.3)',
  '--success':'#16a34a','--danger':'#dc2626','--purple':'#7c3aed',
  '--pink':'#db2777','--orange':'#ea580c',
  '--text':'#0a1929','--muted':'rgba(10,25,41,.45)','--muted2':'rgba(10,25,41,.65)',
  '--sidebar-bg':'#1a2744','--topnav-bg':'rgba(10,10,10,.92)','--sfoot-bg':'rgba(16,22,40,.8)'
};

// Compatibilidade com código legado
const TEMAS_PRONTOS = [
  { nome:'🌑 Modo Escuro', vars: MODO_ESCURO },
  { nome:'☀️ Modo Claro',  vars: MODO_CLARO  },
];

function _aplicarVars(vars) {
  const r = document.documentElement;
  Object.entries(vars).forEach(([k,v]) => r.style.setProperty(k, v));
}

function _aplicarOverrideClaro(vars) {
  const el = document.getElementById('tema-light-override');
  if (el) el.remove();
  const text = vars['--text'] || '#0a1929';
  const muted= vars['--muted']|| 'rgba(10,25,41,.45)';
  const sur  = vars['--surface']  || '#fff';
  const sur2 = vars['--surface2'] || '#e8f0fe';
  const sur3 = vars['--surface3'] || '#d6e4ff';
  const bord = vars['--border']   || 'rgba(30,100,220,.13)';
  const acc  = vars['--accent']   || '#1a6fd4';
  const style = document.createElement('style');
  style.id = 'tema-light-override';
  style.textContent = `
    body,.app{background:var(--bg)!important;color:${text}!important}
    .main,.page{background:var(--bg)!important;color:${text}!important}
    .topnav{background:var(--topnav-bg)!important;border-bottom:1px solid rgba(255,255,255,.06)!important;box-shadow:0 2px 16px rgba(0,0,0,.45)!important}
    .topnav *{color:#e2e8f0!important}
    .logo,.logo *{color:#fff!important}
    .tnav-pill{color:#cbd5e1!important;border-color:rgba(255,255,255,.18)!important;background:rgba(255,255,255,.08)!important}
    .tnav-pill:hover{color:#fff!important;background:rgba(255,255,255,.14)!important}
    .tnav-pill.on{background:rgba(34,197,94,.2)!important;border-color:rgba(34,197,94,.4)!important;color:#86efac!important}
    .ibtn{background:rgba(255,255,255,.08)!important;border-color:rgba(255,255,255,.15)!important;color:#cbd5e1!important}
    .ibtn:hover{color:#fff!important;background:rgba(255,255,255,.15)!important}
    .tbadge{background:rgba(255,255,255,.08)!important;border-color:rgba(255,255,255,.15)!important;color:#cbd5e1!important}
    .nbadge{background:var(--accent)!important;color:#fff!important}
    .caixa-btn.fechado{background:rgba(255,255,255,.1)!important;border-color:rgba(255,255,255,.2)!important;color:#e2e8f0!important}
    .mobile-menu-btn{background:rgba(255,255,255,.1)!important;border-color:rgba(255,255,255,.2)!important;color:#e2e8f0!important}
    .sidebar{background:var(--sidebar-bg)!important;border-right:1px solid rgba(255,255,255,.06)!important;box-shadow:4px 0 24px rgba(0,0,0,.5)!important}
    .sfoot{background:var(--sfoot-bg)!important;border-top-color:rgba(255,255,255,.08)!important}
    .si{color:#94a3b8!important;font-weight:500!important}
    .si svg{opacity:.75!important;color:#94a3b8!important}
    .si:hover{background:rgba(255,255,255,.08)!important;color:#e2e8f0!important}
    .si:hover svg{opacity:1!important;color:#e2e8f0!important}
    .si.on{background:rgba(59,130,246,.22)!important;color:#93c5fd!important;font-weight:600!important}
    .si.on svg{opacity:1!important;color:#93c5fd!important}
    .si.on::before{background:#3b82f6!important;box-shadow:0 0 8px rgba(59,130,246,.6)!important}
    .shead{color:rgba(255,255,255,.32)!important;border-color:rgba(255,255,255,.07)!important}
    .shead:hover{background:rgba(255,255,255,.05)!important}
    .sbc{background:#3b82f6!important;color:#fff!important}
    .ssub{color:rgba(255,255,255,.45)!important}
    .ssub:hover{color:#e2e8f0!important}
    .urow *{color:#94a3b8!important}
    .urow:hover *{color:#e2e8f0!important}
    .sb-pin{background:rgba(255,255,255,.08)!important;border-color:rgba(255,255,255,.15)!important;color:#94a3b8!important}
    .sidebar-search > div{background:rgba(255,255,255,.07)!important;border-color:rgba(255,255,255,.12)!important}
    .sidebar-search input{color:#e2e8f0!important}
    .sidebar-search input::placeholder{color:rgba(255,255,255,.28)!important}
    .pt,.ph .pt,.ph h1,.ph h2,.card-title,.iname{color:${text}!important;font-weight:700!important}
    .ps,.ph .ps,.icat,.sl,.str{color:${muted}!important}
    .sv{color:${text}!important;font-weight:700!important}
    .card,.sc,.sbox,.tw,.pm-tabs{background:${sur}!important;border-color:${bord}!important}
    .card *,.sc *{color:${text}!important}
    .kol{border-color:${bord}!important}
    .kol-analise{background:rgba(234,88,12,.07)!important;border-color:rgba(234,88,12,.22)!important}
    .kol-producao{background:rgba(245,158,11,.07)!important;border-color:rgba(245,158,11,.2)!important}
    .kol-pronto{background:rgba(34,197,94,.07)!important;border-color:rgba(34,197,94,.2)!important}
    .kol-head{background:transparent!important;border-bottom:1px solid ${bord}!important}
    .kol-analise .kol-title{color:#c2410c!important}
    .kol-producao .kol-title{color:#b45309!important}
    .kol-pronto .kol-title{color:#15803d!important}
    .kol-cnt{background:rgba(0,0,0,.1)!important;color:${text}!important}
    .kol-empty,.kol-empty *{color:${muted}!important;opacity:.7!important}
    .kol-config{background:rgba(0,0,0,.05)!important;border-color:${bord}!important;color:${muted}!important}
    .kol-config strong{color:${text}!important}
    .order-card{background:${sur}!important;border:1px solid ${bord}!important;color:${text}!important;box-shadow:0 2px 8px rgba(0,0,0,.08)!important;transition:all .2s ease!important}
    .order-card:hover{border-color:${acc}!important;transform:translateY(-2px)!important;box-shadow:0 6px 20px rgba(26,111,212,.15),0 0 0 3px rgba(26,111,212,.08)!important}
    .order-card *{color:${text}!important}
    .oc-id{color:${acc}!important;font-weight:700!important;font-size:13px!important}
    .oc-client{color:${text}!important;font-weight:600!important}
    .oc-items{color:${muted}!important}
    .oc-total{color:#15803d!important;font-weight:700!important}
    .oc-time,.oc-addr{color:${muted}!important}
    .oc-btn-ok{background:rgba(22,163,74,.12)!important;color:#15803d!important;border-color:rgba(22,163,74,.3)!important;font-weight:600!important}
    .oc-btn-ok:hover{background:rgba(22,163,74,.22)!important}
    .oc-btn-no{background:rgba(220,38,38,.08)!important;color:#b91c1c!important;border-color:rgba(220,38,38,.25)!important;font-weight:600!important}
    .oc-btn-no:hover{background:rgba(220,38,38,.16)!important}
    .oc-btn-fin{background:rgba(26,111,212,.1)!important;color:#1d4ed8!important;border-color:rgba(26,111,212,.25)!important;font-weight:600!important}
    .oc-btn-fin:hover{background:rgba(26,111,212,.18)!important}
    .kf-btn,.filter-btn{background:${sur2}!important;color:${muted}!important;border-color:${bord}!important}
    .kf-btn.on,.filter-btn.on{background:${acc}!important;color:#fff!important;border-color:${acc}!important}
    .pm-tab{color:${muted}!important}
    .pm-tab.on{background:${sur2}!important;color:${text}!important}
    .sbox{background:${sur}!important;border-color:${bord}!important}
    .sbox input{color:${text}!important}
    .sbox input::placeholder{color:${muted}!important}
    .sbox:focus-within{border-color:${acc}!important;box-shadow:0 0 0 3px rgba(26,111,212,.1)!important}
    input,textarea,select,.form-input{background:${sur}!important;color:${text}!important;border-color:${bord}!important}
    input::placeholder,textarea::placeholder{color:${muted}!important}
    .form-label{color:${muted}!important}
    .sw select{background:${sur}!important;color:${text}!important;border-color:${bord}!important}
    .btn.bg,.bg{background:${sur2}!important;color:${text}!important;border-color:${bord}!important}
    .btn.bg:hover{background:${sur3}!important}
    .tw table thead th{background:${sur2}!important;color:${muted}!important;border-color:${bord}!important}
    .tw table tbody tr:hover td{background:${sur2}!important}
    .tw table td{border-color:${bord}!important;color:${text}!important}
    .tmeta *{color:${text}!important}
    .modal{background:${sur}!important;color:${text}!important;border-color:${bord}!important;box-shadow:0 16px 48px rgba(0,0,0,.2)!important}
    .modal *{color:${text}!important}
    .modal-close{color:${muted}!important;background:${sur2}!important}
    .modal-bg{background:rgba(0,0,0,.4)!important}
    .toggle{background:${sur3}!important;border-color:${bord}!important}
    .toggle.on{background:var(--success)!important;border-color:var(--success)!important}
    .stbadge.sta{background:rgba(22,163,74,.1)!important;color:#15803d!important}
    .stbadge.ste{background:rgba(220,38,38,.1)!important;color:#b91c1c!important}
    .stbadge.stp{background:rgba(180,83,9,.1)!important;color:#92400e!important}
    .chip{background:${sur2}!important;color:${text}!important;border-color:${bord}!important}
    .cat-row{background:${sur}!important;border-color:${bord}!important}
    .cat-head *,.cat-name{color:${text}!important}
    .qpill{background:${sur2}!important;border-color:${bord}!important}
    .qpill-label{color:${muted}!important}
    .qpill-val{color:${text}!important}
    .pdvb-wrap,.pdvb-left{background:var(--bg)!important}
    .pdvb-right{border-left-color:${bord}!important;background:${sur}!important}
    .pdvb-toolbar,.pdvb-cats{border-bottom-color:${bord}!important;background:${sur}!important}
    .pdvb-grid-item{background:${sur}!important;border-color:${bord}!important;color:${text}!important}
    .pdvb-grid-item *{color:${text}!important}
    .pdvb-cat-btn{color:${muted}!important}
    .pdvb-cat-btn.on{color:${acc}!important;border-bottom-color:${acc}!important}
    .pdvb-order-item{border-bottom-color:${bord}!important;color:${text}!important}
    .pdvb-order-item *{color:${text}!important}
    .pdvb-bar-btn{background:${sur2}!important;color:${text}!important;border-color:${bord}!important}
    .pdvb-topbar{background:${sur}!important;border-bottom-color:${bord}!important;color:${text}!important}
    .pdvb-tab{color:${muted}!important}
    .pdvb-tab.on{color:${acc}!important;border-bottom-color:${acc}!important}
    .pdvb-bottom-bar{background:${sur}!important;border-top-color:${bord}!important}
    .pdvb-empty-order,.pdvb-empty-order *{color:${muted}!important}
    .pdvb-order-head{color:${muted}!important;background:${sur2}!important}
    .pdvb-tot-row{color:${text}!important}
    .pdvb-gerar-btn{background:${acc}!important;color:#fff!important}
    ::-webkit-scrollbar-thumb{background:${bord}!important}
  `;
  document.head.appendChild(style);
}

function temaAplicarModo(modo) {
  const vars = modo === 'claro' ? MODO_CLARO : MODO_ESCURO;
  _aplicarVars(vars);
  if (modo === 'claro') {
    _aplicarOverrideClaro(vars);
  } else {
    const el = document.getElementById('tema-light-override');
    if (el) el.remove();
  }
  sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, gestor_tema: modo }).then(()=>{}).catch(()=>{});
  temaUpdateCardSelection();
  sbToast('ok', modo === 'claro' ? 'Modo claro ativado!' : 'Modo escuro ativado!');
}

function temaUpdateCardSelection() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const modo = bg.startsWith('#f') ? 'claro' : 'escuro';
  const cardClaro  = document.getElementById('tema-card-claro');
  const cardEscuro = document.getElementById('tema-card-escuro');
  if (cardClaro)  { cardClaro.style.borderColor  = modo==='claro'  ? 'var(--accent)':'var(--border)'; cardClaro.style.boxShadow  = modo==='claro'  ? '0 0 0 3px var(--accent-glow)':'none'; }
  if (cardEscuro) { cardEscuro.style.borderColor = modo==='escuro' ? 'var(--accent)':'var(--border)'; cardEscuro.style.boxShadow = modo==='escuro' ? '0 0 0 3px var(--accent-glow)':'none'; }
}

function initTemaPage() { temaUpdateCardSelection(); }

// Stubs para não quebrar chamadas legadas
function temaApply(vars, save) { _aplicarVars(vars); }
function temaGetCurrent() { return {}; }
function temaSalvarStorage() {}
function temaCarregarStorage() {}
function temaReset() { temaAplicarModo('escuro'); }
async function temaSalvar() { sbToast('ok','Tema aplicado!'); }
function temaBuildPresets() {}
function temaBuildFields() {}
function temaUpdatePreview() {}
function temaUpdateInputs() {}
function temaBuildPreview() {}

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


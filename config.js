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
    'store_name,store_descricao,store_logo_url,store_banner_url,store_cor,store_tempo_entrega,store_avaliacao,store_whatsapp,horarios_config,pedido_minimo,store_address,store_lat,store_lng,tipos_entrega'
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

// ════════════════════════════════════════════════════════
// ZERAR CONTAGEM DE PEDIDOS
// ════════════════════════════════════════════════════════
async function abrirModalZerarPedidos() {
  const input = document.getElementById('zerar-confirmar');
  if (input) input.value = '';
  const btn = document.getElementById('btn-confirmar-zerar');
  if (btn) { btn.disabled = true; btn.style.opacity = '.5'; btn.style.cursor = 'not-allowed'; }

  // Busca o último ID para mostrar ao gestor
  const contEl = document.getElementById('zerar-contagem');
  if (contEl) contEl.textContent = 'Verificando...';
  try {
    const { data } = await sb.from('orders').select('id').order('id', { ascending: false }).limit(1);
    const maxId = data?.[0]?.id || 0;
    const proxNum = maxId - _orderNumOffset + 1;
    if (contEl) contEl.innerHTML = maxId
      ? `O próximo pedido é <strong>#${proxNum}</strong>. Após zerar, passará a ser <strong>#1</strong>.`
      : '<span style="color:var(--muted)">Nenhum pedido registrado ainda.</span>';
  } catch(e) {
    if (contEl) contEl.textContent = 'Não foi possível verificar.';
  }

  openModal('modal-zerar-pedidos');
}

function _zerarValidar(input) {
  const ok = input.value.trim().toUpperCase() === 'ZERAR';
  const btn = document.getElementById('btn-confirmar-zerar');
  btn.disabled      = !ok;
  btn.style.opacity = ok ? '1' : '.5';
  btn.style.cursor  = ok ? 'pointer' : 'not-allowed';
}

async function confirmarZerarPedidos() {
  const input = document.getElementById('zerar-confirmar');
  if (input.value.trim().toUpperCase() !== 'ZERAR') return;
  const btn = document.getElementById('btn-confirmar-zerar');
  btn.disabled = true;
  btn.textContent = 'Zerando...';

  try {
    // Pega o ID máximo atual do banco para usar como novo offset
    const { data } = await sb.from('orders').select('id').order('id', { ascending: false }).limit(1);
    const novoOffset = data?.[0]?.id || 0;

    // Salva o offset no store_config do tenant
    const { error } = await sb.from('store_config').update({ order_num_offset: novoOffset }).eq('tenant_id', _sessao.tenant_id);
    if (error) throw new Error(error.message);

    // Atualiza localmente
    _orderNumOffset = novoOffset;
    ordersKanban = ordersKanban.map(o => ({ ...o, num: _orderNum(o.id) }));
    renderKanban();

    closeModal('modal-zerar-pedidos');
    _renderConfiguracoes(); // atualiza o painel de config imediatamente
    sbToast('ok', 'Contagem zerada! Próximo pedido será #1.');
  } catch(e) {
    sbToast('err', 'Erro ao zerar contagem: ' + (e.message || 'Tente novamente'));
    btn.disabled = false;
    btn.textContent = 'Confirmar reset';
  }
}

// ── Configurações ─────────────────────────────────────
async function _renderConfiguracoes() {
  renderSoundConfig();
  const el = document.getElementById('cfg-prox-pedido');
  if (!el) return;
  try {
    const { data } = await sb.from('orders').select('id').order('id', { ascending: false }).limit(1);
    const maxId  = data?.[0]?.id || 0;
    const proxNum = maxId - _orderNumOffset + 1;
    el.innerHTML = maxId
      ? `Próximo pedido: <strong>#${proxNum}</strong> &nbsp;·&nbsp; Offset atual: ${_orderNumOffset}`
      : 'Nenhum pedido registrado ainda.';
  } catch(e) { el.textContent = '—'; }
}

// ── Backup completo (dados + imagens) ────────────────
async function baixarBackupCompleto() {
  const btn  = document.getElementById('btn-backup-completo');
  const info = document.getElementById('cfg-backup-info');
  if (btn) { btn.disabled = true; btn.textContent = 'Gerando backup...'; }
  if (info) info.textContent = 'Coletando dados e imagens...';

  try {
    const tid = _sessao?.tenant_id;
    if (!tid) throw new Error('Sessão inválida — faça login novamente.');

    const res = await fetch('/api/backup-completo-gestor', {
      headers: { 'x-tenant-id': tid }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Erro ${res.status}`);
    }

    // Determina nome do arquivo pelo header Content-Disposition
    const cd       = res.headers.get('Content-Disposition') || '';
    const match    = cd.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `backup-completo-${new Date().toISOString().slice(0,10)}.json.gz`;

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const kb = Math.round(blob.size / 1024);
    if (info) info.textContent = `Backup gerado! (${kb} KB)`;
    sbToast('ok', `Backup baixado! (${kb} KB)`);
  } catch(e) {
    if (info) info.textContent = 'Erro: ' + e.message;
    sbToast('err', 'Erro ao gerar backup: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Baixar backup completo'; }
  }
}

// ════════════════════════════════════════════════════════
// CARTEIRA & SAQUES
// ════════════════════════════════════════════════════════
const _fmtR = v => 'R$ ' + parseFloat(v||0).toFixed(2).replace('.',',');

let _saquesSSE = null;
let _pixAtivoGestor = true;

function conectarSaquesSSE() {
  if (_saquesSSE) return;
  const tid = _sessao?.tenant_id;
  if (!tid) return;
  _saquesSSE = new EventSource('/sse/saques-rt:'+tid);
  _saquesSSE.addEventListener('saques:INSERT', () => carregarCarteira());
  _saquesSSE.addEventListener('saques:UPDATE', (e) => {
    try {
      const d = JSON.parse(e.data);
      carregarCarteira();
      if (d.status === 'pago')      sbToast('ok', 'Saque pago! Verifique seu PIX.');
      else if (d.status === 'aprovado')  sbToast('ok', 'Saque aprovado. Pagamento em processamento.');
      else if (d.status === 'cancelado') sbToast('err', 'Saque cancelado. Entre em contato com o suporte.');
    } catch(ex) { carregarCarteira(); }
  });
  _saquesSSE.onerror = () => { _saquesSSE.close(); _saquesSSE = null; setTimeout(conectarSaquesSSE, 5000); };
}

// ════════════════════════════════════════════════════
// PAGAMENTOS ONLINE — PIX e Cartão
// ════════════════════════════════════════════════════

let _pixOnlineAtivo    = true;
let _cartaoOnlineAtivo = false; // false até o admin configurar a public key

function _renderPixOnlineToggle(ativo) {
  _pixOnlineAtivo = ativo;
  const btn    = document.getElementById('btn-pix-online-toggle');
  const status = document.getElementById('pix-online-status-txt');
  const card   = document.getElementById('card-pix-online');
  if (btn) {
    btn.textContent = ativo ? '✅ Ativado' : '🔴 Desativado';
    btn.className   = 'btn ' + (ativo ? 'bp' : 'bd');
  }
  if (status) status.textContent = ativo ? 'Ativo — clientes podem pagar via PIX' : 'Inativo — PIX não aparece no cardápio';
  if (card)  card.style.borderColor = ativo ? 'rgba(34,197,94,.35)' : 'var(--border)';
}

function _renderCartaoOnlineToggle(ativo, disponivel) {
  _cartaoOnlineAtivo = ativo;
  const btn    = document.getElementById('btn-cartao-online-toggle');
  const status = document.getElementById('cartao-online-status-txt');
  const card   = document.getElementById('card-cartao-online');
  if (!disponivel) {
    if (btn)    { btn.textContent = 'Indisponível'; btn.className = 'btn bg'; btn.disabled = true; }
    if (status) status.textContent = 'Não disponível — aguardando habilitação pelo suporte';
    return;
  }
  if (btn) {
    btn.textContent = ativo ? '✅ Ativado' : '🔴 Desativado';
    btn.className   = 'btn ' + (ativo ? 'bp' : 'bd');
    btn.disabled    = false;
  }
  if (status) status.textContent = ativo ? 'Ativo — clientes podem pagar com cartão online' : 'Inativo — cartão não aparece no cardápio';
  if (card)  card.style.borderColor = ativo ? 'rgba(59,130,246,.35)' : 'var(--border)';
}

async function carregarConfigPixGestor() {
  const tid = _sessao?.tenant_id;
  if (!tid) return;
  try {
    const r = await fetch('/api/pix/config', { headers: { 'x-tenant-id': tid } });
    if (!r.ok) return;
    const d = await r.json();
    // PIX
    _renderPixOnlineToggle(d.pix_ativo !== false);
    // Cartão — só aparece se admin configurou a public key
    const cartaoDisponivel = !!d.cartao_disponivel;
    const cartaoAtivo      = d.cartao_online_ativo !== false && cartaoDisponivel;
    _renderCartaoOnlineToggle(cartaoAtivo, cartaoDisponivel);
    // Mantém _pixAtivoGestor sincronizado (usado no fluxo PIX do cardápio)
    _pixAtivoGestor = d.pix_ativo !== false;
  } catch(e) {}
}

async function togglePixOnline() {
  const tid = _sessao?.tenant_id;
  if (!tid) return;
  const btn = document.getElementById('btn-pix-online-toggle');
  if (btn) btn.disabled = true;
  try {
    const novoEstado = !_pixOnlineAtivo;
    const r = await fetch('/api/pix/gestor-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ pix_ativo: novoEstado })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erro');
    _renderPixOnlineToggle(d.pix_ativo !== false);
    sbToast('ok', novoEstado ? '💠 PIX Online ativado!' : '🔴 PIX Online desativado!');
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
  finally { const b = document.getElementById('btn-pix-online-toggle'); if (b) b.disabled = false; }
}

async function toggleCartaoOnline() {
  const tid = _sessao?.tenant_id;
  if (!tid) return;
  const btn = document.getElementById('btn-cartao-online-toggle');
  if (btn) btn.disabled = true;
  try {
    const novoEstado = !_cartaoOnlineAtivo;
    const r = await fetch('/api/pix/gestor-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ cartao_online_ativo: novoEstado })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erro');
    _renderCartaoOnlineToggle(d.cartao_online_ativo !== false, true);
    sbToast('ok', novoEstado ? '💳 Cartão Online ativado!' : '🔴 Cartão Online desativado!');
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
  finally { const b = document.getElementById('btn-cartao-online-toggle'); if (b) b.disabled = false; }
}

async function carregarCarteira() {
  try {
    const tid = _sessao?.tenant_id;
    if (!tid) return;
    const _fetchTenant = (url) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      return fetch(url, { headers: { 'x-tenant-id': tid }, signal: ctrl.signal })
        .finally(() => clearTimeout(timer));
    };
    const [cartRes, saqRes] = await Promise.all([
      _fetchTenant('/api/carteira'),
      _fetchTenant('/api/saques/meus')
    ]);
    const cart   = cartRes.ok ? await cartRes.json() : {};
    const saques = saqRes.ok  ? await saqRes.json()  : [];

    const se = id => document.getElementById(id);
    if (se('crt-saldo'))       se('crt-saldo').textContent       = _fmtR(cart.saldo_disponivel);
    if (se('crt-total'))       se('crt-total').textContent       = _fmtR(cart.total_recebido);
    if (se('crt-sacado'))      se('crt-sacado').textContent      = _fmtR(cart.total_sacado);
    if (se('crt-npag'))        se('crt-npag').textContent        = cart.total_pagamentos || 0;
    if (se('crt-pix-count'))   se('crt-pix-count').textContent   = (cart.pix_count || 0) + ' pagtos';
    if (se('crt-cartao-count'))se('crt-cartao-count').textContent= (cart.cartao_count || 0) + ' pagtos';
    if (se('crt-pix-total'))   se('crt-pix-total').textContent   = _fmtR(cart.pix_recebido);
    if (se('crt-cartao-total'))se('crt-cartao-total').textContent = _fmtR(cart.cartao_recebido);

    // Aviso de PIX pendentes
    if (cart.pendentes_count > 0) {
      let avisoEl = se('crt-pendentes-aviso');
      if (!avisoEl) {
        avisoEl = document.createElement('div');
        avisoEl.id = 'crt-pendentes-aviso';
        avisoEl.style.cssText = 'background:rgba(249,115,22,.1);border:1px solid rgba(249,115,22,.25);border-radius:10px;padding:10px 14px;font-size:12px;color:var(--orange);margin-bottom:16px';
        const cardsEl = se('crt-saldo')?.closest('.card')?.parentElement;
        if (cardsEl?.nextElementSibling) cardsEl.parentElement.insertBefore(avisoEl, cardsEl.nextElementSibling);
      }
      avisoEl.innerHTML = `<strong>${cart.pendentes_count} PIX pendente(s)</strong> aguardando confirmação — ${_fmtR(cart.pendentes_valor)}. Não entram no saldo até confirmação.`;
      avisoEl.style.display = '';
    } else {
      const av = se('crt-pendentes-aviso'); if (av) av.style.display = 'none';
    }

    const saldo = parseFloat(cart.saldo_disponivel || 0);
    if (se('saque-valor-preview')) se('saque-valor-preview').textContent = _fmtR(saldo);
    const temPendente = saques.some(s => s.status === 'pendente');
    if (se('saque-form-wrap'))      se('saque-form-wrap').style.display      = temPendente ? 'none' : '';
    if (se('saque-pendente-aviso')) se('saque-pendente-aviso').style.display = temPendente ? '' : 'none';
    if (se('btn-solicitar-saque'))  se('btn-solicitar-saque').disabled       = saldo < 1;

    _renderSaqueHistorico(saques);
    _renderPixHistorico(cart.ultimos_pagamentos || []);
    _renderCartaoHistorico(cart.ultimos_cartao || []);
  } catch(e) {
    sbToast('err', 'Erro ao carregar carteira: ' + e.message);
  }
}

function showPayTab(tab) {
  const isPix = tab === 'pix';
  const pixDiv    = document.getElementById('pix-historico');
  const cartaoDiv = document.getElementById('cartao-historico');
  const btnPix    = document.getElementById('tab-pix-hist');
  const btnCartao = document.getElementById('tab-cartao-hist');
  if (pixDiv)    pixDiv.style.display    = isPix ? '' : 'none';
  if (cartaoDiv) cartaoDiv.style.display = isPix ? 'none' : '';
  if (btnPix) {
    btnPix.style.background = isPix ? 'var(--accent)' : 'var(--surface2)';
    btnPix.style.color      = isPix ? '#fff' : 'var(--muted)';
  }
  if (btnCartao) {
    btnCartao.style.background = isPix ? 'var(--surface2)' : 'var(--accent)';
    btnCartao.style.color      = isPix ? 'var(--muted)' : '#fff';
  }
}

    // Cards de saldo
    const se = id => document.getElementById(id);

function _renderSaqueHistorico(saques) {
  const el = document.getElementById('saque-historico');
  if (!el) return;
  if (!saques.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px">Nenhum saque solicitado ainda.</div>'; return; }
  const badge = { pendente:'background:rgba(249,115,22,.15);color:var(--orange)', aprovado:'background:rgba(59,130,246,.15);color:var(--accent)', pago:'background:rgba(34,197,94,.15);color:var(--success)', cancelado:'background:rgba(239,68,68,.15);color:var(--danger)' };
  const label = { pendente:'⏳ Pendente', aprovado:'✅ Aprovado', pago:'✅ Pago', cancelado:'❌ Cancelado' };
  el.innerHTML = saques.map(s => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-weight:600;font-size:13px">${_fmtR(s.valor_liquido)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${s.pix_key_tipo?.toUpperCase()}: ${s.pix_key} · ${new Date(s.created_at).toLocaleDateString('pt-BR')}</div>
        ${s.obs_admin ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">${s.obs_admin}</div>` : ''}
      </div>
      <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;${badge[s.status]||badge.pendente}">${label[s.status]||s.status}</span>
    </div>`).join('');
}

function _renderPixHistorico(pagamentos) {
  const el = document.getElementById('pix-historico');
  if (!el) return;
  if (!pagamentos.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px">Nenhum pagamento PIX ainda.</div>'; return; }
  const badge = { aprovado:'background:rgba(34,197,94,.15);color:var(--success)', pendente:'background:rgba(249,115,22,.15);color:var(--orange)', rejeitado:'background:rgba(239,68,68,.15);color:var(--danger)', cancelado:'background:rgba(239,68,68,.15);color:var(--danger)' };
  el.innerHTML = pagamentos.map(p => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-weight:600;font-size:13px">${_fmtR(p.valor)} <span style="font-weight:400;color:var(--muted);font-size:12px">→ líquido ${_fmtR(p.valor_liquido)}</span></div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${p.payer_name||'—'} · Pedido #${_orderNum(p.order_id||0)} · ${new Date(p.created_at).toLocaleDateString('pt-BR')}</div>
      </div>
      <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;${badge[p.status]||badge.pendente}">${p.status}</span>
    </div>`).join('');
}

function _renderCartaoHistorico(pagamentos) {
  const el = document.getElementById('cartao-historico');
  if (!el) return;
  if (!pagamentos.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px">Nenhum pagamento por cartão ainda.</div>'; return; }
  const badge = { aprovado:'background:rgba(34,197,94,.15);color:var(--success)', rejeitado:'background:rgba(239,68,68,.15);color:var(--danger)', pendente:'background:rgba(249,115,22,.15);color:var(--orange)' };
  el.innerHTML = pagamentos.map(p => {
    const liq = parseFloat(p.valor||0) * 0.93;
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-weight:600;font-size:13px">${_fmtR(p.valor)} <span style="font-weight:400;color:var(--muted);font-size:12px">→ líquido ${_fmtR(liq)}</span></div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">
          ${p.payer_name||'—'} · Pedido #${_orderNum(p.order_id||0)} ·
          ${p.payment_method_id ? p.payment_method_id.charAt(0).toUpperCase()+p.payment_method_id.slice(1) : 'Cartão'}
          ${p.last_four_digits ? '••••'+p.last_four_digits : ''} ·
          ${new Date(p.created_at).toLocaleDateString('pt-BR')}
        </div>
      </div>
      <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;${badge[p.status]||badge.pendente}">${p.status}</span>
    </div>`;
  }).join('');
}

async function solicitarSaque() {
  const pixKey  = document.getElementById('saque-pix-key')?.value.trim();
  const pixTipo = document.getElementById('saque-pix-tipo')?.value || 'aleatoria';
  if (!pixKey) { sbToast('err', 'Informe a chave PIX'); return; }

  const btn = document.getElementById('btn-solicitar-saque');
  if (btn) { btn.disabled = true; btn.textContent = 'Solicitando...'; }
  try {
    const tid = _sessao?.tenant_id;
    const res = await fetch('/api/saques/solicitar', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ pix_key: pixKey, pix_key_tipo: pixTipo })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');
    sbToast('ok', `Saque de ${_fmtR(data.valor)} solicitado! Pagamento em até 24 horas úteis.`);
    await carregarCarteira();
  } catch(e) {
    sbToast('err', 'Erro: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Solicitar saque'; }
  }
}

// ══════════════════════════════════════════
//  GRUPOS DE CUSTOMIZAÇÃO
// ══════════════════════════════════════════
function addGrupo(ctx) {
  var list = document.getElementById(ctx + '-grupos-list');
  if (!list) return;
  var div = document.createElement('div');
  div.className = 'grp-wrap';
  div.innerHTML = _grupoHtml({nome:'', tipo:'radio', min:1, max:1, opcoes:[]});
  list.appendChild(div);
}

function _grupoHtml(g) {
  var isCheck = g.tipo === 'checkbox';
  var optsHtml = (g.opcoes||[]).map(_optHtml).join('');
  var html = '<div class="grp-header">';
  html += '<input class="grp-title-input" placeholder="Nome do grupo" value="' + (g.nome||'').replace(/"/g,'"') + '">';
  html += '<button type="button" class="grp-del" onclick="delGrupo(this)">×</button>';
  html += '</div>';
  html += '<div class="grp-type-row">';
  html += '<button type="button" class="grp-type-btn ' + (!isCheck?'on':'') + '" onclick="setGrupoTipo(this,\'radio\')">● Escolha 1</button>';
  html += '<button type="button" class="grp-type-btn ' + (isCheck?'on':'') + '" onclick="setGrupoTipo(this,\'checkbox\')">☑ Múltipla</button>';
  html += '</div>';
  html += '<div class="grp-min-max" style="display:' + (isCheck?'flex':'none') + '">';
  html += '<label style="font-size:11px;color:var(--muted);align-self:center">Mín</label>';
  html += '<input type="number" class="grp-min" min="0" max="99" value="' + (g.min||0) + '">';
  html += '<label style="font-size:11px;color:var(--muted);align-self:center">Máx</label>';
  html += '<input type="number" class="grp-max" min="1" max="99" value="' + (g.max||1) + '">';
  html += '</div>';
  html += '<div class="grp-opts-list">' + optsHtml + '</div>';
  html += '<button type="button" class="grp-add-opt" onclick="addGrupoOpt(this)">+ Adicionar opção</button>';
  return html;
}

function _optHtml(o) {
  var html = '<div class="grp-opt-row">';
  html += '<input class="grp-opt-name" placeholder="Nome da opção" value="' + (o.nome||'').replace(/"/g,'"') + '">';
  html += '<input class="grp-opt-price" type="number" step="0.01" min="0" placeholder="+R$" value="' + (o.preco||'') + '">';
  html += '<button type="button" class="grp-opt-del" onclick="delGrupoOpt(this)">×</button>';
  html += '</div>';
  return html;
}

function delGrupo(btn)    { btn.closest('.grp-wrap').remove(); }
function delGrupoOpt(btn) { btn.closest('.grp-opt-row').remove(); }

function setGrupoTipo(btn, tipo) {
  var wrap = btn.closest('.grp-wrap');
  wrap.querySelectorAll('.grp-type-btn').forEach(function(b){ b.classList.remove('on'); });
  btn.classList.add('on');
  var mm = wrap.querySelector('.grp-min-max');
  if (mm) mm.style.display = (tipo === 'checkbox') ? 'flex' : 'none';
}

function addGrupoOpt(btn) {
  var list = btn.closest('.grp-wrap').querySelector('.grp-opts-list');
  var tmp = document.createElement('div');
  tmp.innerHTML = _optHtml({});
  list.appendChild(tmp.firstElementChild);
}

function renderGrupos(ctx, grupos) {
  var list = document.getElementById(ctx + '-grupos-list');
  if (!list) return;
  list.innerHTML = '';
  (grupos||[]).forEach(function(g) {
    var div = document.createElement('div');
    div.className = 'grp-wrap';
    div.innerHTML = _grupoHtml(g);
    list.appendChild(div);
  });
}

function readGrupos(ctx) {
  var list = document.getElementById(ctx + '-grupos-list');
  if (!list) return [];
  return Array.from(list.querySelectorAll('.grp-wrap')).map(function(wrap) {
    var nameEl  = wrap.querySelector('.grp-title-input');
    var tipoBtn = wrap.querySelector('.grp-type-btn.on');
    var minEl   = wrap.querySelector('.grp-min');
    var maxEl   = wrap.querySelector('.grp-max');
    var tipo    = (tipoBtn && tipoBtn.textContent.indexOf('Múltipla') >= 0) ? 'checkbox' : 'radio';
    var opcoes  = Array.from(wrap.querySelectorAll('.grp-opt-row')).map(function(row) {
      var n = (row.querySelector('.grp-opt-name') || {}).value || '';
      var p = parseFloat((row.querySelector('.grp-opt-price') || {}).value) || 0;
      return { nome: n.trim(), preco: p };
    }).filter(function(o){ return o.nome; });
    return {
      nome:   (nameEl ? nameEl.value : '').trim(),
      tipo:   tipo,
      min:    parseInt(minEl ? minEl.value : 0) || 0,
      max:    parseInt(maxEl ? maxEl.value : 1) || 1,
      opcoes: opcoes
    };
  }).filter(function(g){ return g.nome || g.opcoes.length; });
}




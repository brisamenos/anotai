// ══════════════════════════════════════════
//  AUTH — Login, registro, logout, endereço salvo
//  Estima Food — Cardápio
// ══════════════════════════════════════════
function loadCustomerSession() {
  try {
    const saved = _loadCustomerSessionForTenant();
    _customer = saved || null;
  } catch(e) {}
  updateProfileFab();
}

function _customerAuthKey(tid) {
  return AUTH_KEY + '_' + (tid || _tenantId || 'default');
}

function _customerTenantFromToken(customer) {
  try {
    if (!customer?.token) return '';
    return atob(customer.token).split(':')[1] || '';
  } catch(e) { return ''; }
}

function _isCustomerFromCurrentTenant(customer) {
  if (!customer || !customer.id || !customer.token || !_tenantId) return false;
  return String(customer.tenant_id || _customerTenantFromToken(customer)) === String(_tenantId);
}

function _loadCustomerSessionForTenant() {
  const key = _customerAuthKey();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch(e) {}
  if (_isCustomerFromCurrentTenant(saved)) return saved;

  // Migra sessao antiga global apenas quando o token pertence ao tenant atual.
  try {
    const legacy = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    if (_isCustomerFromCurrentTenant(legacy)) {
      legacy.tenant_id = _tenantId;
      localStorage.setItem(key, JSON.stringify(legacy));
      return legacy;
    }
  } catch(e) {}
  return null;
}

function _saveCustomerSession(customer) {
  if (!customer || !_tenantId) return;
  customer.tenant_id = customer.tenant_id || _tenantId;
  localStorage.setItem(_customerAuthKey(), JSON.stringify(customer));
}

function updateProfileFab() {
  const fab  = document.getElementById('profile-fab');
  const av   = document.getElementById('profile-fab-av');
  const name = document.getElementById('profile-fab-name');
  if (!fab) return;
  if (_customer) {
    // Logado: avatar com inicial + nome
    if (av) {
      av.className = 'profile-fab-av';
      av.textContent = (_customer.name||'?').charAt(0).toUpperCase();
    }
    if (name) name.textContent = (_customer.name||'Eu').split(' ')[0];
  } else {
    // Deslogado: icone de pessoa preenchido + "Entrar"
    if (av) {
      av.className = 'profile-fab-av icon';
      av.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12.5c2.76 0 5-2.35 5-5.25S14.76 2 12 2 7 4.35 7 7.25s2.24 5.25 5 5.25Zm0 2.25c-3.6 0-8 1.83-8 5.1V22h16v-2.15c0-3.27-4.4-5.1-8-5.1Z"/></svg>';
    }
    if (name) name.textContent = 'Entrar';
  }
}

function onProfileFabClick() {
  if (typeof setBnavActive === 'function') setBnavActive('profile-fab');
  if (_customer) openAccount();
  else openAuth();
}

function openAuth(tab) {
  document.getElementById('auth-overlay').classList.add('on');
  if (tab) switchAuthTab(tab);
  document.getElementById('auth-err').classList.remove('on');
}
function closeAuth() {
  document.getElementById('auth-overlay').classList.remove('on');
  if (typeof setBnavActive === 'function') setBnavActive('bnav-cardapio');
}
function switchAuthTab(tab) {
  document.getElementById('tab-login').classList.toggle('on',    tab==='login');
  document.getElementById('tab-register').classList.toggle('on', tab==='register');
  document.getElementById('auth-form-login').style.display    = tab==='login'    ? '' : 'none';
  document.getElementById('auth-form-register').style.display = tab==='register' ? '' : 'none';
  document.getElementById('auth-err').classList.remove('on');
}

// ── Busca CEP via ViaCEP ────────────────────────────
function formatCEP(el) {
  let v = el.value.replace(/\D/g, '').slice(0, 8);
  if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
  el.value = v;
}

async function buscarCEP() {
  const cepRaw = (document.getElementById('f-cep')?.value || '').replace(/\D/g, '');
  const status = document.getElementById('cep-status');
  const btn    = document.getElementById('cep-btn');
  if (cepRaw.length !== 8) {
    if (status) { status.textContent = '⚠️ CEP deve ter 8 dígitos'; status.style.color = 'var(--danger,#ef4444)'; }
    return;
  }
  if (status) { status.textContent = '🔍 Buscando...'; status.style.color = 'var(--muted)'; }
  if (btn) { btn.disabled = true; btn.style.opacity = '.5'; }
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cepRaw}/json/`);
    const data = await res.json();
    if (data.erro) {
      if (status) { status.textContent = '❌ CEP não encontrado'; status.style.color = 'var(--danger,#ef4444)'; }
      return;
    }
    const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    set('f-rua',    data.logradouro);
    set('f-bairro', data.bairro);
    set('f-compl',  data.complemento);
    // Foca no campo número
    const numEl = document.getElementById('f-num');
    if (numEl) { numEl.value = ''; numEl.focus(); }
    if (status) {
      status.innerHTML = '✅ <strong>' + [data.logradouro, data.bairro, data.localidade + '-' + data.uf].filter(Boolean).join(', ') + '</strong>';
      status.style.color = 'var(--success,#22c55e)';
    }
    // Recalcula taxa por bairro se aplicável
    if (typeof feeConfig !== 'undefined' && feeConfig?.tipo === 'por_bairro' && typeof renderTotals === 'function') renderTotals();
  } catch(e) {
    if (status) { status.textContent = '❌ Erro na busca. Tente novamente.'; status.style.color = 'var(--danger,#ef4444)'; }
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

async function buscarCEPRegistro() {
  const cepRaw = (document.getElementById('reg-cep')?.value || '').replace(/\D/g, '');
  const status = document.getElementById('reg-cep-status');
  const addrEl = document.getElementById('reg-addr');
  if (cepRaw.length !== 8) {
    if (status) { status.textContent = '⚠️ CEP deve ter 8 dígitos'; status.style.color = 'var(--danger,#ef4444)'; }
    return;
  }
  if (status) { status.textContent = '🔍 Buscando...'; status.style.color = 'var(--muted)'; }
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cepRaw}/json/`);
    const data = await res.json();
    if (data.erro) {
      if (status) { status.textContent = '❌ CEP não encontrado'; status.style.color = 'var(--danger,#ef4444)'; }
      if (addrEl) addrEl.value = '';
      return;
    }
    const addrStr = [data.logradouro, data.bairro, data.localidade + '-' + data.uf].filter(Boolean).join(', ');
    if (addrEl) { addrEl.value = addrStr; addrEl.readOnly = false; }
    if (status) { status.textContent = '✅ Endereço encontrado!'; status.style.color = 'var(--success,#22c55e)'; }
  } catch(e) {
    if (status) { status.textContent = '❌ Erro na busca'; status.style.color = 'var(--danger,#ef4444)'; }
  }
}

async function doLogin() {
  const phone = document.getElementById('login-phone').value.trim();
  const senha = document.getElementById('login-senha').value;
  if (!phone||!senha) { showAuthErr('Preencha telefone e senha'); return; }
  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spin"></div> Entrando…';
  try {
    const res = await fetch('/api/customer-login', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-tenant-id':_tenantId},
      body: JSON.stringify({ phone, senha })
    });
    const data = await res.json();
    if (!res.ok) { showAuthErr(data.error||'Erro ao entrar'); return; }
    _customer = data;
    _saveCustomerSession(_customer);
    updateProfileFab();
    closeAuth();
    toast('👋', `Olá, ${data.name.split(' ')[0]}!`);
    fillCartForm();
    if (typeof loadRepeatOrderBanner === 'function') loadRepeatOrderBanner();
    // Sincroniza com programa de fidelidade (caso ainda não esteja cadastrado)
    fetch('/api/fidelidade/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': _tenantId },
      body: JSON.stringify({ phone: data.phone, name: data.name })
    }).catch(() => {});
  } catch(e) {
    showAuthErr('Erro de conexão. Tente novamente.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Entrar na minha conta';
  }
}

async function doRegister() {
  const name     = document.getElementById('reg-name').value.trim();
  const phone    = document.getElementById('reg-phone').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const senha    = document.getElementById('reg-senha').value;
  const senha2   = document.getElementById('reg-senha2').value;
  const birthday = document.getElementById('reg-birthday').value;
  const addr     = (document.getElementById('reg-addr')?.value || '').trim();
  const btn      = document.getElementById('register-btn');
  document.getElementById('auth-err').classList.remove('on');
  if (!name)           { showAuthErr('Informe seu nome'); return; }
  if (!phone)          { showAuthErr('Informe seu WhatsApp'); return; }
  if (!senha)          { showAuthErr('Crie uma senha'); return; }
  if (senha.length < 6){ showAuthErr('Senha mínimo 6 caracteres'); return; }
  if (senha !== senha2){ showAuthErr('As senhas não coincidem'); return; }
  btn.disabled = true;
  btn.innerHTML = '<div class="spin"></div> Criando conta…';
  try {
    const res = await fetch('/api/customer-register', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-tenant-id':_tenantId},
      body: JSON.stringify({ name, phone, email, senha, birthday, addr })
    });
    const data = await res.json();
    if (!res.ok) { showAuthErr(data.error||'Erro ao criar conta'); return; }
    _customer = data;
    _saveCustomerSession(_customer);
    updateProfileFab();
    closeAuth();
    toast('🎉', `Bem-vindo, ${data.name.split(' ')[0]}!`);
    fillCartForm();
    // Sincroniza com programa de fidelidade
    fetch('/api/fidelidade/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': _tenantId },
      body: JSON.stringify({ phone: data.phone, name: data.name })
    }).catch(() => {});
  } catch(e) {
    showAuthErr('Erro de conexão. Tente novamente.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Criar minha conta';
  }
}

function doLogout() {
  _customer = null;
  try {
    localStorage.removeItem(_customerAuthKey());
    localStorage.removeItem(AUTH_KEY);
  } catch(e) {}
  updateProfileFab();
  closeAccount();
  const banner = document.getElementById('repeat-order-banner');
  if (banner) { banner.style.display = 'none'; banner.innerHTML = ''; }
  toast('👋','Você saiu da conta');
}

function showAuthErr(msg) {
  const el = document.getElementById('auth-err');
  el.textContent = msg;
  el.classList.add('on');
}

function fillCartForm() {
  if (!_customer) return;
  const v = (id,val) => { const el=document.getElementById(id); if(el&&val) el.value=val; };
  v('f-name',  _customer.name);
  v('f-phone', _customer.phone);
  // Dispara consulta de cashback para cliente logado (oninput não é acionado por .value=)
  if (_customer.phone) onPhoneCashback(_customer.phone);
  loadSavedAddr();
  // Carrega endereços salvos do cliente
  if (typeof carregarEnderecosSalvos === 'function') carregarEnderecosSalvos();
}

// ── Endereço salvo ─────────────────────────────────────
// Chave por cliente logado (ID) ou por tenant (anônimo)
function _addrStorageKey() {
  const tid = _tenantId || 'default';
  return _customer?.id ? `${ADDR_KEY}_${tid}_c${_customer.id}` : `${ADDR_KEY}_${tid}`;
}

// Tenta parsear string "Rua, Num, Bairro, Compl, Ref: xxx" de volta para campos
function _parseAddrString(addrStr) {
  if (!addrStr || typeof addrStr !== 'string') return null;
  const parts = addrStr.split(', ');
  if (parts.length < 2) return null;
  // Extrai ponto de referência (parte que começa com "Ref:")
  let referencia = '';
  const refIdx = parts.findIndex(p => /^Ref:\s*/i.test(p));
  if (refIdx >= 0) {
    referencia = parts[refIdx].replace(/^Ref:\s*/i, '').trim();
    parts.splice(refIdx, 1);
  }
  return {
    rua: parts[0] || '',
    num: parts[1] || '',
    bairro: parts[2] || '',
    compl: parts.slice(3).join(', ') || '',
    referencia
  };
}

function _showAddrBanner(a) {
  const banner = document.getElementById('saved-addr-banner');
  const txt    = document.getElementById('saved-addr-text');
  if (!banner || !txt) return;
  const parts = [a.rua, a.num, a.bairro, a.compl, a.referencia ? 'Ref: ' + a.referencia : ''].filter(Boolean);
  if (!parts.length) return;
  txt.textContent = '📍 ' + parts.join(', ');
  banner.style.display = 'flex';
}

function loadSavedAddr() {
  if (deliveryType !== 'delivery') return;
  const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };

  // 1ª prioridade: localStorage estruturado (mesmo dispositivo ou cliente logado)
  try {
    const raw = localStorage.getItem(_addrStorageKey());
    if (raw) {
      const a = JSON.parse(raw);
      set('f-cep',    a.cep);
      set('f-rua',    a.rua);
      set('f-num',    a.num);
      set('f-bairro', a.bairro);
      set('f-compl',  a.compl);
      set('f-referencia', a.referencia);
      _showAddrBanner(a);
      if (feeConfig?.tipo === 'por_bairro') renderTotals();
      return;
    }
  } catch(e) {}

  // 2ª prioridade: addr do banco (cliente logado em outro dispositivo)
  if (_customer?.addr) {
    const a = _parseAddrString(_customer.addr);
    if (a && a.rua && a.num) {
      set('f-rua',    a.rua);
      set('f-num',    a.num);
      set('f-bairro', a.bairro);
      set('f-compl',  a.compl);
      set('f-referencia', a.referencia);
      _showAddrBanner(a);
      // Salva estruturado para próximas vezes neste dispositivo
      try { localStorage.setItem(_addrStorageKey(), JSON.stringify(a)); } catch(e) {}
      if (feeConfig?.tipo === 'por_bairro') renderTotals();
    }
  }
}

function saveDeliveryAddr() {
  if (deliveryType !== 'delivery') return;
  try {
    const g = id => (document.getElementById(id)?.value || '').trim();
    const rua = g('f-rua'); const num = g('f-num');
    if (!rua || !num) return;
    const a = { rua, num, bairro: g('f-bairro'), compl: g('f-compl'), referencia: g('f-referencia'), cep: g('f-cep') };
    // Salva estruturado no localStorage (chave por cliente se logado)
    localStorage.setItem(_addrStorageKey(), JSON.stringify(a));
    // Atualiza cache do cliente logado para cross-device via banco
    if (_customer) {
      _customer.addr = [rua, num, a.bairro, a.compl, a.referencia ? 'Ref: ' + a.referencia : ''].filter(Boolean).join(', ');
      try { _saveCustomerSession(_customer); } catch(e) {}
    }
  } catch(e) {}
}

function clearSavedAddr() {
  try { localStorage.removeItem(_addrStorageKey()); } catch(e) {}
  // Limpa do cache do cliente logado também
  if (_customer) {
    _customer.addr = '';
    try { _saveCustomerSession(_customer); } catch(e) {}
  }
  ['f-rua','f-num','f-bairro','f-compl','f-referencia'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const banner = document.getElementById('saved-addr-banner');
  if (banner) banner.style.display = 'none';
  if (typeof renderTotals === 'function') renderTotals();
}

// ══════════════════════════════════════════
//  MINHA CONTA
// ══════════════════════════════════════════
async function openAccount() {
  if (!_customer) { openAuth(); return; }
  const av = _customer.name.charAt(0).toUpperCase();
  document.getElementById('acc-avatar').textContent  = av;
  document.getElementById('acc-name').textContent    = _customer.name;
  document.getElementById('acc-meta').textContent    = [_customer.phone, _customer.email].filter(Boolean).join(' · ');
  document.getElementById('acc-pedidos').textContent = _customer.orders_count || 0;
  document.getElementById('account-overlay').classList.add('on');
  loadMyOrders();
}
function closeAccount() {
  document.getElementById('account-overlay').classList.remove('on');
  if (typeof setBnavActive === 'function') setBnavActive('bnav-cardapio');
}

async function loadMyOrders() {
  const list = document.getElementById('acc-orders-list');
  list.innerHTML = '<div style="padding:20px;text-align:center"><div style="font-size:28px">⏳</div></div>';
  try {
    const headers = {'x-tenant-id':_tenantId};
    if (_customer?.token) headers.Authorization = 'Bearer ' + _customer.token;
    const res    = await fetch(`/api/customer-orders?customer_id=${_customer.id}`, {
      headers
    });
    const orders = await res.json();
    if (!orders.length) {
      list.innerHTML = '<div class="empty-state" style="padding:28px 20px"><div class="empty-state-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2h1.5l1.8 7.5h6.5l1.2-5H5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="13" r="1" fill="currentColor"/><circle cx="12" cy="13" r="1" fill="currentColor"/></svg></div><div class="empty-state-text">Nenhum pedido ainda</div></div>';
      return;
    }
    const SL = {analise:'Aguardando',producao:'Preparando',pronto:'Pronto',saiu:'A caminho',entregue:'Entregue',cancelado:'Cancelado'};
    list.innerHTML = orders.map(o => {
      const itemsTxt = Array.isArray(o.items) ? o.items.map(i=>`${parseInt(i.qty)||1}× ${i.name || i.nome || 'Item'}`).join(', ') : '';
      const d = new Date(o.created_at);
      const dateStr = isNaN(d) ? '' : d.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
      const isActive = ['analise','producao','pronto','saiu'].includes(o.status);
      const waitingOnlinePayment = o.status === 'aguardando_cartao' || (o.status === 'aguardando_pix' && o.pag !== 'pix_manual');
      const numLabel = o.order_num ? '#' + String(o.order_num).padStart(3,'0') : (waitingOnlinePayment ? 'Aguardando pagamento' : 'Sem numero');
      // "Repetir pedido" disponível para pedidos finalizados (entregue/cancelado) com itens válidos
      const podeRepetir = !isActive && Array.isArray(o.items) && o.items.length > 0;
      return `
      <div class="order-card">
        <div class="order-card-clickarea" ${isActive?`onclick="openOrderTracker(${o.id},${o.order_num||0})"`:''} style="${isActive?'cursor:pointer':''}">
          <div class="order-card-head">
            <span class="order-card-num">${numLabel}</span>
            <span class="order-card-status ${o.status}">${SL[o.status]||o.status}</span>
          </div>
          <div class="order-card-items">${itemsTxt}</div>
          <div class="order-card-foot">
            <span class="order-card-total">R$ ${fmt(o.total)}</span>
            <span class="order-card-date">${dateStr}</span>
          </div>
          ${isActive?'<div style="font-size:11px;color:var(--accent);margin-top:6px;font-weight:600"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M1 13c1-3 2.5-5 7-5s6 2 7 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M3.5 11c.8-2 2-3 4.5-3s3.7 1 4.5 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="10" r="1.2" fill="currentColor"/></svg> Toque para acompanhar</div>':''}
        </div>
        ${podeRepetir ? `<button onclick="event.stopPropagation();repetirPedido(${o.id})" style="margin-top:8px;width:100%;padding:8px 12px;background:rgba(var(--accent-rgb,249,115,22),.08);border:1.5px solid var(--accent);color:var(--accent);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2.5 8a5.5 5.5 0 0 1 9.5-3.8M13.5 8a5.5 5.5 0 0 1-9.5 3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 1.5v3h-3M4 14.5v-3h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Repetir pedido
        </button>` : ''}
      </div>`;
    }).join('');
  } catch(e) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">Erro ao carregar pedidos</div>';
  }
}

function openOrderTracker(orderId, orderNum) {
  closeAccount();
  _trackOrderId = orderId;
  const initialNum = orderNum ? '#' + String(orderNum).padStart(3,'0') : 'Pagamento pendente';
  document.getElementById('track-order-num').textContent = orderNum ? 'Pedido ' + initialNum : 'Pedido aguardando pagamento';
  sb.from('orders').select('id,order_num,status,items,client,addr,total,taxa,pag,troco').eq('id', orderId).single().then(({data})=>{
    if (data) {
      updateTracker(data.status, data.addr);
      renderTrackItems(Array.isArray(data.items)?data.items:[], data.client, {
        addr: data.addr,
        total: data.total,
        taxa: data.taxa,
        pag: data.pag,
        troco: data.troco
      });
      // Atualiza número com order_num do banco
      const dataNum = data.order_num ? '#' + String(data.order_num).padStart(3,'0') : 'Pagamento pendente';
      document.getElementById('track-order-num').textContent = data.order_num ? 'Pedido ' + dataNum : 'Pedido aguardando pagamento';
      document.getElementById('track-num').textContent = dataNum;
    }
  });
  if (_trackChannel) try{ sb.removeChannel(_trackChannel); }catch(e){}
  _trackChannel = sb.channel('orders-rt')
    .on('postgres_changes',{event:'UPDATE',table:'orders'}, p => {
      if (Number(p.new.id) === orderId) {
        updateTracker(p.new.status, p.new.addr);
        if (p.new.order_num) {
          const novoNum = '#' + String(p.new.order_num).padStart(3,'0');
          document.getElementById('track-order-num').textContent = 'Pedido ' + novoNum;
          document.getElementById('track-num').textContent = novoNum;
        }
      }
    }).subscribe();
  document.getElementById('track-fab').classList.add('show');
  document.getElementById('track-num').textContent = initialNum;
  openTracker();
}

// ══════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════
// Múltiplos endereços salvos por cliente (apenas para logados)
// CRUD via tabela customer_enderecos. Cliente vê dropdown no checkout.
// ══════════════════════════════════════════════════════════════════════

async function carregarEnderecosSalvos() {
  const wrap = document.getElementById('end-salvos-wrap');
  const list = document.getElementById('end-salvos-list');
  if (!wrap || !list) return;
  if (!_customer || !_customer.id) { wrap.style.display = 'none'; return; }
  try {
    const { data } = await sb.from('customer_enderecos').select('*').eq('customer_id', _customer.id).order('is_default', { ascending: false }).order('id', { ascending: false });
    const eds = data || [];
    if (!eds.length) {
      wrap.style.display = '';
      list.innerHTML = '<div style="font-size:11.5px;color:var(--muted);padding:6px 2px;text-align:center">Nenhum endereço salvo. Preencha abaixo e salve para usar nos próximos pedidos.</div>';
      return;
    }
    wrap.style.display = '';
    list.innerHTML = eds.map(e => {
      const titulo = e.label || (e.rua ? `${e.rua}, ${e.numero || 's/n'}` : 'Endereço');
      const sub    = [e.bairro, e.complemento, e.referencia ? 'Ref: ' + e.referencia : ''].filter(Boolean).join(' • ');
      return `<div class="end-item" data-id="${e.id}" style="padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;cursor:pointer;display:flex;justify-content:space-between;gap:8px;align-items:center">
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;font-weight:700;color:var(--text)">${e.is_default ? '★ ' : ''}${titulo}</div>
          ${sub ? `<div style="font-size:11px;color:var(--muted);margin-top:1px;text-overflow:ellipsis;overflow:hidden;white-space:nowrap">${sub}</div>` : ''}
        </div>
        <button onclick="event.stopPropagation();excluirEnderecoSalvo(${e.id})" style="background:transparent;border:none;color:var(--danger,#ef4444);cursor:pointer;font-size:14px;padding:4px 8px" title="Excluir">✕</button>
      </div>`;
    }).join('');
    list.querySelectorAll('.end-item').forEach(div => {
      div.addEventListener('click', () => usarEnderecoSalvo(parseInt(div.dataset.id)));
    });
  } catch (e) {
    console.error('carregarEnderecosSalvos:', e);
    wrap.style.display = 'none';
  }
}

async function usarEnderecoSalvo(id) {
  try {
    const { data } = await sb.from('customer_enderecos').select('*').eq('id', id).single();
    if (!data) return;
    const set = (inputId, v) => { const el = document.getElementById(inputId); if (el) el.value = v || ''; };
    set('f-cep',        data.cep);
    set('f-rua',        data.rua);
    set('f-num',        data.numero);
    set('f-bairro',     data.bairro);
    set('f-compl',      data.complemento);
    set('f-referencia', data.referencia);
    document.querySelectorAll('.end-item').forEach(d => {
      d.style.borderColor = parseInt(d.dataset.id) === id ? 'var(--accent)' : 'var(--border)';
      d.style.background  = parseInt(d.dataset.id) === id ? 'rgba(var(--accent-rgb,249,115,22),.06)' : '';
    });
    if (typeof renderTotals === 'function') renderTotals();
    if (typeof toast === 'function') toast('info', 'Endereço carregado');
  } catch (e) { console.error('usarEnderecoSalvo:', e); }
}

async function abrirCadastrarEndereco() {
  if (!_customer || !_customer.id) {
    if (typeof toast === 'function') toast('warn', 'Faça login para salvar endereços');
    return;
  }
  const cep = (document.getElementById('f-cep')?.value || '').trim();
  const rua = (document.getElementById('f-rua')?.value || '').trim();
  const num = (document.getElementById('f-num')?.value || '').trim();
  const bairro = (document.getElementById('f-bairro')?.value || '').trim();
  const compl  = (document.getElementById('f-compl')?.value || '').trim();
  const ref    = (document.getElementById('f-referencia')?.value || '').trim();
  if (!rua || !num) {
    if (typeof toast === 'function') toast('warn', 'Preencha rua e número antes de salvar');
    return;
  }
  const label = prompt('Dê um nome a este endereço (ex: Casa, Trabalho):', '') || '';
  try {
    const { error } = await sb.from('customer_enderecos').insert({
      customer_id: _customer.id,
      label: label.trim() || null,
      cep, rua, numero: num, bairro, complemento: compl, referencia: ref,
      is_default: 0
    });
    if (error) throw error;
    if (typeof toast === 'function') toast('ok', 'Endereço salvo!');
    await carregarEnderecosSalvos();
  } catch (e) {
    if (typeof toast === 'function') toast('err', 'Erro ao salvar: ' + (e.message || ''));
  }
}

async function excluirEnderecoSalvo(id) {
  if (!confirm('Excluir este endereço?')) return;
  try {
    const { error } = await sb.from('customer_enderecos').delete().eq('id', id);
    if (error) throw error;
    if (typeof toast === 'function') toast('ok', 'Removido');
    await carregarEnderecosSalvos();
  } catch (e) {
    if (typeof toast === 'function') toast('err', 'Erro: ' + (e.message || ''));
  }
}

// ══════════════════════════════════════════════════════════════════════
// Repetir pedido — recria o carrinho com os mesmos itens de um pedido
// finalizado. Cruza com allItems pra pegar preço e disponibilidade atuais.
// Itens pausados/removidos são pulados com aviso.
// ══════════════════════════════════════════════════════════════════════
function _repeatNormName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _findMenuItemForRepeat(savedItem) {
  const menu = Array.isArray(allItems) ? allItems : [];
  if (!menu.length || !savedItem) return null;

  const savedId = Number(savedItem.id || savedItem.item_id || savedItem.menu_item_id || 0);
  if (savedId) {
    const byId = menu.find(x => Number(x.id) === savedId);
    if (byId) return byId;
  }

  const savedName = _repeatNormName(savedItem.name || savedItem.nome);
  if (!savedName) return null;

  const savedPrice = Number(savedItem.price || savedItem.preco || savedItem.valor || 0);
  const exact = menu.filter(x => _repeatNormName(x.name) === savedName);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1 && savedPrice > 0) {
    return exact.find(x => Math.abs(Number(x.price || 0) - savedPrice) < 0.01) || exact[0];
  }

  const partial = menu
    .map(x => ({ item: x, name: _repeatNormName(x.name) }))
    .filter(x => x.name && (savedName.includes(x.name) || x.name.includes(savedName)))
    .sort((a, b) => b.name.length - a.name.length);
  if (!partial.length) return null;
  if (savedPrice > 0) {
    const byPrice = partial.find(x => Math.abs(Number(x.item.price || 0) - savedPrice) < 0.01);
    if (byPrice) return byPrice.item;
  }
  return partial[0].item;
}

// "Peça de novo" — banner na tela principal do cardápio (não escondido dentro
// de Meus Pedidos) pra cliente repetir com 1 toque o último pedido entregue.
// Funciona pra cliente logado (via conta) E pra quem só fez checkout como
// convidado (via telefone salvo no navegador de um pedido anterior).
async function loadRepeatOrderBanner() {
  const wrap = document.getElementById('repeat-order-banner');
  if (!wrap) return;

  let url = '';
  const headers = { 'x-tenant-id': _tenantId };
  if (_customer && _customer.id) {
    url = `/api/customer-orders?customer_id=${_customer.id}`;
    if (_customer.token) headers.Authorization = 'Bearer ' + _customer.token;
  } else {
    // Sem conta — usa o telefone salvo de um checkout anterior (convidado)
    let telefoneSalvo = '';
    try {
      const perfil = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
      telefoneSalvo = (perfil.phone || '').replace(/\D/g, '');
    } catch (e) {}
    if (!telefoneSalvo) return; // nunca fez pedido nesse navegador — não mostra nada
    url = `/api/customer-orders?phone=${encodeURIComponent(telefoneSalvo)}`;
  }

  try {
    const res = await fetch(url, { headers });
    const orders = await res.json();
    if (!Array.isArray(orders) || !orders.length) return;
    const ultimo = orders.find(o => o.status === 'entregue' && Array.isArray(o.items) && o.items.length);
    if (!ultimo) return;

    const itensTxt = ultimo.items.map(i => `${parseInt(i.qty) || 1}× ${i.name || i.nome || 'Item'}`).join(', ');
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;background:rgba(var(--accent-rgb,249,115,22),.07);border:1.5px solid rgba(var(--accent-rgb,249,115,22),.25);border-radius:12px;padding:10px 12px">
        <div style="font-size:20px;line-height:1">🔁</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;font-weight:700;color:var(--accent)">Peça de novo</div>
          <div style="font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${itensTxt}</div>
        </div>
        <button onclick="repetirPedido(${ultimo.id})" style="flex-shrink:0;padding:7px 12px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">Repetir</button>
      </div>`;
    wrap.style.display = '';
  } catch (e) {
    console.warn('[repeat-order-banner] erro:', e);
  }
}

async function repetirPedido(orderId) {
  let query = sb.from('orders').select('items,addr,total,phone').eq('id', orderId);
  if (_customer && _customer.id) {
    query = query.eq('customer_id', _customer.id);
  } else {
    // Convidado (sem conta) — confirma que o pedido é do mesmo telefone salvo
    // no navegador, em vez de exigir customer_id (que convidado não tem).
    let telefoneSalvo = '';
    try {
      const perfil = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
      telefoneSalvo = (perfil.phone || '').replace(/\D/g, '');
    } catch (e) {}
    if (!telefoneSalvo) {
      if (typeof toast === 'function') toast('warn', 'Não foi possível confirmar seu telefone.');
      return;
    }
  }
  try {
    const { data, error } = await query.single();
    if (error || !data) {
      if (typeof toast === 'function') toast('err', 'Pedido não encontrado');
      return;
    }
    // Confirmação extra pro caso de convidado: telefone do pedido tem que bater
    // com o telefone salvo no navegador (evita repetir pedido de outra pessoa
    // que usou o mesmo aparelho).
    if (!(_customer && _customer.id)) {
      let telefoneSalvo = '';
      try {
        const perfil = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
        telefoneSalvo = (perfil.phone || '').replace(/\D/g, '');
      } catch (e) {}
      const telefonePedido = (data.phone || '').replace(/\D/g, '');
      if (!telefonePedido || telefonePedido !== telefoneSalvo) {
        if (typeof toast === 'function') toast('err', 'Pedido não encontrado');
        return;
      }
    }
    const itensSalvos = Array.isArray(data.items) ? data.items : (() => { try { return JSON.parse(data.items || '[]'); } catch { return []; } })();
    if (!itensSalvos.length) {
      if (typeof toast === 'function') toast('warn', 'Pedido sem itens válidos');
      return;
    }

    // Reseta cart e cupons
    if (typeof cart !== 'undefined') cart.length = 0;
    if (typeof appliedCupom !== 'undefined') appliedCupom = null;

    let pulados = 0;
    let adicionados = 0;
    for (const it of itensSalvos) {
      // Resolve item atual pelo id (preço pode ter mudado, item pode estar pausado/removido)
      // Pedidos antigos podem nao ter id do produto; tenta nome/preco tambem.
      const atual = _findMenuItemForRepeat(it);
      if (!atual) {
        // Item não disponível (pausado, removido ou de outra loja) — pula
        pulados++;
        continue;
      }
      // Cria item de carrinho usando preço atual do menu (não o histórico)
      // Mantém obs/customizações do pedido original quando possível
      const cartItem = {
        ...atual,
        // Preserva obs e customizações do pedido anterior (ex: "Sem cebola")
        obs: it.obs || '',
        qty: parseInt(it.qty) || 1
      };
      // Se item tinha customizações específicas (preço calculado, addons), preserva
      // mas marca o `name` original (que pode ter "+ Bacon" etc)
      if (it.name && it.name !== atual.name) cartItem.name = it.name;
      if (it.price && Math.abs(parseFloat(it.price) - parseFloat(atual.price)) > 0.01) {
        // Preço difere significativamente — usa o preço atual mas avisa
        cartItem.price = parseFloat(atual.price);
      }
      cart.push(cartItem);
      adicionados++;
    }

    if (!adicionados) {
      if (typeof toast === 'function') toast('err', 'Nenhum item desse pedido está disponível agora');
      return;
    }

    // Limpa cupom anterior se ficou no DOM
    const cupomInp = document.getElementById('cupom-input');
    if (cupomInp) cupomInp.value = '';
    const cupomMsg = document.getElementById('cupom-msg');
    if (cupomMsg) cupomMsg.innerHTML = '';

    // Fecha modal de conta e abre o carrinho
    if (typeof closeAccount === 'function') closeAccount();
    if (typeof updateCartFloat === 'function') updateCartFloat();
    if (typeof openCart === 'function') openCart();

    if (typeof toast === 'function') {
      const itemTxt = adicionados > 1 ? 'itens adicionados' : 'item adicionado';
      const msg = pulados > 0
        ? `🔁 ${adicionados} ${itemTxt} (${pulados} indisponíve${pulados>1?'is':'l'} pulado${pulados>1?'s':''})`
        : `🔁 ${adicionados} ${itemTxt} ao carrinho`;
      toast('cart', msg);
    }
  } catch (e) {
    console.error('repetirPedido:', e);
    if (typeof toast === 'function') toast('err', 'Erro ao repetir pedido');
  }
}

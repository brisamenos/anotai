// ══════════════════════════════════════════
//  AUTH — Login, registro, logout, endereço salvo
//  Estima Food — Cardápio
// ══════════════════════════════════════════
function loadCustomerSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTH_KEY)||'null');
    if (saved && saved.id && saved.token) _customer = saved;
  } catch(e) {}
  updateProfileFab();
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
    // Deslogado: ícone de pessoa + "Entrar"
    if (av) {
      av.className = 'profile-fab-av icon';
      av.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="2.5" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 13.5c0-2.76 2.46-5 5.5-5s5.5 2.24 5.5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
    }
    if (name) name.textContent = 'Entrar';
  }
}

function onProfileFabClick() {
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
}
function switchAuthTab(tab) {
  document.getElementById('tab-login').classList.toggle('on',    tab==='login');
  document.getElementById('tab-register').classList.toggle('on', tab==='register');
  document.getElementById('auth-form-login').style.display    = tab==='login'    ? '' : 'none';
  document.getElementById('auth-form-register').style.display = tab==='register' ? '' : 'none';
  document.getElementById('auth-err').classList.remove('on');
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
    localStorage.setItem(AUTH_KEY, JSON.stringify(data));
    updateProfileFab();
    closeAuth();
    toast('👋', `Olá, ${data.name.split(' ')[0]}!`);
    fillCartForm();
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
      body: JSON.stringify({ name, phone, email, senha, birthday })
    });
    const data = await res.json();
    if (!res.ok) { showAuthErr(data.error||'Erro ao criar conta'); return; }
    _customer = data;
    localStorage.setItem(AUTH_KEY, JSON.stringify(data));
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
  localStorage.removeItem(AUTH_KEY);
  updateProfileFab();
  closeAccount();
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
}

// ── Endereço salvo ─────────────────────────────────────
// Chave por cliente logado (ID) ou por tenant (anônimo)
function _addrStorageKey() {
  const tid = _tenantId || 'default';
  return _customer?.id ? `${ADDR_KEY}_${tid}_c${_customer.id}` : `${ADDR_KEY}_${tid}`;
}

// Tenta parsear string "Rua, Num, Bairro, Compl" de volta para campos
function _parseAddrString(addrStr) {
  if (!addrStr || typeof addrStr !== 'string') return null;
  const parts = addrStr.split(', ');
  if (parts.length < 2) return null;
  return { rua: parts[0] || '', num: parts[1] || '', bairro: parts[2] || '', compl: parts.slice(3).join(', ') || '' };
}

function _showAddrBanner(a) {
  const banner = document.getElementById('saved-addr-banner');
  const txt    = document.getElementById('saved-addr-text');
  if (!banner || !txt) return;
  const parts = [a.rua, a.num, a.bairro, a.compl].filter(Boolean);
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
      set('f-rua',    a.rua);
      set('f-num',    a.num);
      set('f-bairro', a.bairro);
      set('f-compl',  a.compl);
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
    const a = { rua, num, bairro: g('f-bairro'), compl: g('f-compl') };
    // Salva estruturado no localStorage (chave por cliente se logado)
    localStorage.setItem(_addrStorageKey(), JSON.stringify(a));
    // Atualiza cache do cliente logado para cross-device via banco
    if (_customer) {
      _customer.addr = [rua, num, a.bairro, a.compl].filter(Boolean).join(', ');
      try { localStorage.setItem(AUTH_KEY, JSON.stringify(_customer)); } catch(e) {}
    }
  } catch(e) {}
}

function clearSavedAddr() {
  try { localStorage.removeItem(_addrStorageKey()); } catch(e) {}
  // Limpa do cache do cliente logado também
  if (_customer) {
    _customer.addr = '';
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(_customer)); } catch(e) {}
  }
  ['f-rua','f-num','f-bairro','f-compl'].forEach(id => {
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
  document.getElementById('acc-gasto').textContent   = 'R$ ' + fmt(_customer.total_spent || 0);
  document.getElementById('account-overlay').classList.add('on');
  loadMyOrders();
}
function closeAccount() {
  document.getElementById('account-overlay').classList.remove('on');
}

async function loadMyOrders() {
  const list = document.getElementById('acc-orders-list');
  list.innerHTML = '<div style="padding:20px;text-align:center"><div style="font-size:28px">⏳</div></div>';
  try {
    const res    = await fetch(`/api/customer-orders?customer_id=${_customer.id}`, {
      headers:{'x-tenant-id':_tenantId}
    });
    const orders = await res.json();
    if (!orders.length) {
      list.innerHTML = '<div class="empty-state" style="padding:28px 20px"><div class="empty-state-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2h1.5l1.8 7.5h6.5l1.2-5H5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="13" r="1" fill="currentColor"/><circle cx="12" cy="13" r="1" fill="currentColor"/></svg></div><div class="empty-state-text">Nenhum pedido ainda</div></div>';
      return;
    }
    const SL = {analise:'Aguardando',producao:'Preparando',pronto:'Pronto',saiu:'A caminho',entregue:'Entregue',cancelado:'Cancelado'};
    list.innerHTML = orders.map(o => {
      const itemsTxt = Array.isArray(o.items) ? o.items.map(i=>`${i.qty}× ${i.name}`).join(', ') : '';
      const d = new Date(o.created_at);
      const dateStr = isNaN(d) ? '' : d.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
      const isActive = ['analise','producao','pronto','saiu'].includes(o.status);
      return `
      <div class="order-card" onclick="${isActive?`openOrderTracker(${o.id})`:'void(0)'}">
        <div class="order-card-head">
          <span class="order-card-num">#${String(_orderNum(o.id)).padStart(3,'0')}</span>
          <span class="order-card-status ${o.status}">${SL[o.status]||o.status}</span>
        </div>
        <div class="order-card-items">${itemsTxt}</div>
        <div class="order-card-foot">
          <span class="order-card-total">R$ ${fmt(o.total)}</span>
          <span class="order-card-date">${dateStr}</span>
        </div>
        ${isActive?'<div style="font-size:11px;color:var(--accent);margin-top:6px;font-weight:600"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M1 13c1-3 2.5-5 7-5s6 2 7 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M3.5 11c.8-2 2-3 4.5-3s3.7 1 4.5 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="10" r="1.2" fill="currentColor"/></svg> Toque para acompanhar</div>':''}
      </div>`;
    }).join('');
  } catch(e) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">Erro ao carregar pedidos</div>';
  }
}

function openOrderTracker(orderId) {
  closeAccount();
  _trackOrderId = orderId;
  document.getElementById('track-order-num').textContent = 'Pedido #' + String(_orderNum(orderId)).padStart(3,'0');
  sb.from('orders').select('id,status,items,client,addr').eq('id', orderId).single().then(({data})=>{
    if (data) {
      updateTracker(data.status, data.addr);
      renderTrackItems(Array.isArray(data.items)?data.items:[], data.client);
    }
  });
  if (_trackChannel) try{ sb.removeChannel(_trackChannel); }catch(e){}
  _trackChannel = sb.channel('orders-rt')
    .on('postgres_changes',{event:'UPDATE',table:'orders'}, p => {
      if (Number(p.new.id) === orderId) updateTracker(p.new.status, p.new.addr);
    }).subscribe();
  document.getElementById('track-fab').classList.add('show');
  document.getElementById('track-num').textContent = '#' + String(_orderNum(orderId)).padStart(3,'0');
  openTracker();
}

// ══════════════════════════════════════════

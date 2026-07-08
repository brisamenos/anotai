// ═══════════════════════════════════════════════════════
// CLIENTE REST — ESTIMA FOOD
// ═══════════════════════════════════════════════════════

// ── Pré-inicialização de window._printMode ─────────────────
// gestor-relatorios.js declara `let _printMode` que lê de window._printMode.
// Como a ordem de carregamento dos <script> não é estritamente garantida em
// todos os caminhos (e o erro "_printMode is not defined" foi visto em
// produção), garantimos AQUI que window._printMode já tem valor antes
// de qualquer outro código rodar.
if (typeof window._printMode === 'undefined') {
  window._printMode = localStorage.getItem('printMode') || 'auto';
}

// URL do servidor de automações — carregada do banco
let WA_SERVER = '';
const sb = window.AppAPI;
let _tenantStoreName = '';
window._tenantStoreName = '';

// ── Autenticação ──────────────────────────────────────
let _sessao = null;
let _billingLocked = false;
let _planoAtual = 'pro'; // padrão conservador; atualizado via servidor em _carregarPlano()

// Busca o plano real do tenant no servidor (não depende da sessão salva)
function billingIsDateExpired(expiresAt) {
  const raw = String(expiresAt || '').trim();
  if (!raw) return false;
  const exp = new Date(raw.includes('T') ? raw : raw + 'T00:00:00');
  if (isNaN(exp.getTime())) return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const expDia = new Date(exp);
  expDia.setHours(0, 0, 0, 0);
  return expDia < hoje;
}

function billingIsLocked() {
  return !!(_billingLocked || _sessao?.billing_locked);
}
window.isBillingLocked = billingIsLocked;

function billingSaveSessionPatch(patch) {
  try {
    const sess = JSON.parse(sessionStorage.getItem('sys_session') || '{}');
    Object.assign(sess, patch);
    sessionStorage.setItem('sys_session', JSON.stringify(sess));
    _sessao = sess;
    _billingLocked = !!sess.billing_locked;
    if (window.ElectronPrint?.saveSession) window.ElectronPrint.saveSession(sess).catch(()=>{});
  } catch(e) {}
}

function billingSetLocked(expiresAt) {
  billingSaveSessionPatch({
    billing_locked: true,
    billing_reason: 'expired',
    billing_expired_at: expiresAt || _sessao?.billing_expired_at || _sessao?.tenant_expires_at || null,
    tenant_expires_at: expiresAt || _sessao?.tenant_expires_at || null
  });
}

function billingClearLock(opts = {}) {
  billingSaveSessionPatch({
    billing_locked: false,
    billing_reason: null,
    billing_expired_at: null
  });
  document.body?.classList.remove('billing-locked');
  if (opts.reload) {
    window.location.href = 'gestor.html';
  }
}

function billingForcePlanoPage() {
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('on');
    p.style.display = '';
  });
  document.querySelectorAll('.si').forEach(s => s.classList.remove('on'));
  const pg = document.getElementById('page-meu-plano');
  if (pg) pg.classList.add('on');
  const sn = document.getElementById('sn-meu-plano');
  if (sn) sn.classList.add('on');
  const main = document.querySelector('.main');
  if (main) main.scrollTop = 0;
}

function billingApplyLockUI() {
  if (!billingIsLocked()) return;
  document.body?.classList.add('billing-locked');

  if (!document.getElementById('billing-lock-style')) {
    const style = document.createElement('style');
    style.id = 'billing-lock-style';
    style.textContent = `
      body.billing-locked #caixa-btn,
      body.billing-locked .topnav .ibtn,
      body.billing-locked #rt-badge { display:none!important; }
      body.billing-locked .sidebar .shead:not(#sh-sistema),
      body.billing-locked .sidebar .sidebar-group:not(#sg-sistema),
      body.billing-locked .sidebar .si:not(#sn-meu-plano) { display:none!important; }
    `;
    document.head.appendChild(style);
  }

  document.querySelectorAll('.si').forEach(btn => {
    if (btn.id === 'sn-meu-plano') {
      btn.style.display = '';
      btn.removeAttribute('aria-disabled');
    } else {
      btn.classList.remove('on');
      btn.style.display = 'none';
      btn.setAttribute('aria-disabled', 'true');
    }
  });

  const page = document.getElementById('page-meu-plano');
  if (page && !document.getElementById('billing-lock-banner')) {
    page.insertAdjacentHTML('afterbegin', `
      <div id="billing-lock-banner" style="display:flex;align-items:flex-start;gap:12px;margin:0 0 18px;padding:14px 16px;border:1px solid rgba(239,68,68,.28);background:rgba(239,68,68,.08);border-radius:12px;color:var(--text)">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style="color:var(--danger);flex-shrink:0;margin-top:1px">
          <path d="M8 2L14 13H2L8 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M8 6v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          <circle cx="8" cy="11" r=".6" fill="currentColor"/>
        </svg>
        <div>
          <div style="font-weight:800;font-size:14px;color:var(--danger);margin-bottom:3px">Assinatura vencida</div>
          <div style="font-size:12.5px;color:var(--muted);line-height:1.45">O acesso esta liberado apenas para renovar o plano. Assim que o pagamento for confirmado, o gestor volta ao normal automaticamente.</div>
        </div>
      </div>
    `);
  }
  billingForcePlanoPage();
}
window.billingApplyLockUI = billingApplyLockUI;

function billingGateNav(id) {
  if (!billingIsLocked()) return false;
  if (id === 'meu-plano') return false;
  billingApplyLockUI();
  if (typeof sbToast === 'function') sbToast('err', 'Assinatura vencida. Renove o plano para liberar o sistema.');
  return true;
}
window.billingGateNav = billingGateNav;

function billingSyncFromTenant(data, opts = {}) {
  const ativo = data?.ativo !== false && data?.ativo !== 0;
  const expired = billingIsDateExpired(data?.expires_at);
  if (ativo && expired) {
    billingSetLocked(data.expires_at || null);
    billingApplyLockUI();
    if (opts.reload) window.location.href = 'gestor.html?billing=1';
    return true;
  }
  if (ativo && billingIsLocked() && !expired) {
    billingClearLock({ reload: opts.reload !== false });
    return false;
  }
  return billingIsLocked();
}

async function billingRefreshLockStatus(opts = {}) {
  try {
    const tid = _sessao?.tenant_id;
    if (!tid) return false;
    const res = await fetch('/api/tenant-info-gestor', {
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid }
    });
    if (!res.ok) return billingIsLocked();
    const data = await res.json();
    return billingSyncFromTenant(data, opts);
  } catch(e) {
    return billingIsLocked();
  }
}
window.billingRefreshLockStatus = billingRefreshLockStatus;

async function _carregarPlano() {
  try {
    const tid = _sessao?.tenant_id;
    if (!tid) return;
    const res = await fetch('/api/tenant-info-gestor', {
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid }
    });
    if (!res.ok) return;
    const data = await res.json();
    billingSyncFromTenant(data);
    const plano = (data?.plano || 'pro').toLowerCase();
    _planoAtual = plano;

    // Atualiza a sessão com o plano correto para futuras verificações
    try {
      const sess = JSON.parse(sessionStorage.getItem('sys_session') || '{}');
      sess.plano = _planoAtual;
      sessionStorage.setItem('sys_session', JSON.stringify(sess));
    } catch(e) { console.warn('[gestor-core] silent error:', e?.message || e); }

    // Atualiza badge do botão Robô na sidebar
    const roboBadge = document.getElementById('sn-robo-badge');
    if (roboBadge) {
      roboBadge.style.display = _planoAtual !== 'premium' ? 'inline-block' : 'none';
    }
  } catch(e) { console.warn('[gestor-core] silent error:', e?.message || e); }
}

function _verificarSessao() {
  try {
    const raw = sessionStorage.getItem('sys_session');
    if (!raw) { window.location.href = 'login.html'; return false; }
    _sessao = JSON.parse(raw);
    _billingLocked = !!_sessao.billing_locked;
    if (!_billingLocked && billingIsDateExpired(_sessao.tenant_expires_at)) {
      billingSetLocked(_sessao.tenant_expires_at);
    }
    if (Date.now() - _sessao.ts > 8 * 60 * 60 * 1000) {
      sessionStorage.removeItem('sys_session');
      // No Electron a sessão é renovada automaticamente — não expirar aqui
      if (!window.ElectronPrint) { window.location.href = 'login.html'; return false; }
      // Se Electron: renova o ts para mais 30 dias e continua
      _sessao.ts = Date.now();
      sessionStorage.setItem('sys_session', JSON.stringify(_sessao));
      if (window.ElectronPrint?.saveSession) window.ElectronPrint.saveSession(_sessao).catch(()=>{});
    }
    const nome = _sessao.nome || 'Usuário';
    const role = _sessao.role || 'gestor';
    // Salva sessão no Electron para auto-login na próxima abertura
    if (window.ElectronPrint?.saveSession) window.ElectronPrint.saveSession(_sessao).catch(()=>{});
    const el_av   = document.getElementById('sidebar-av');
    const el_nome = document.getElementById('sidebar-nome');
    const el_role = document.getElementById('sidebar-role');
    if (el_av)   el_av.textContent   = nome.charAt(0).toUpperCase();
    if (el_nome) el_nome.textContent = nome.split(' ')[0];
    if (el_role) el_role.textContent = role === 'superadmin' ? 'Super Admin' : role === 'admin' ? 'Administrador' : 'Gestor';
    // ── Badge de bloqueio no botão do Robô — atualizado após fetch do plano ──
    return true;
  } catch(e) {
    window.location.href = 'login.html';
    return false;
  }
}

function confirmarLogout() {
  if (confirm('Sair do sistema?')) {
    sessionStorage.removeItem('sys_session');
    sessionStorage.removeItem('finance_auth');
    // Remove sessão salva no Electron (sem auto-login na próxima abertura)
    if (window.ElectronPrint?.clearSession) window.ElectronPrint.clearSession().catch(()=>{});
    window.location.href = 'login.html';
  }
}

const FINANCE_LOCKED_PAGES = new Set(['caixa','saques','relatorios','dre','contas-pagar','fornecedores']);

function financeGetAuth() {
  try {
    const fin = JSON.parse(sessionStorage.getItem('finance_auth') || '{}');
    const sess = JSON.parse(sessionStorage.getItem('sys_session') || '{}');
    if (!fin?.token || !fin.expires_at || fin.expires_at <= Date.now()) {
      sessionStorage.removeItem('finance_auth');
      return null;
    }
    if (sess.tenant_id && fin.tenant_id !== sess.tenant_id) {
      sessionStorage.removeItem('finance_auth');
      return null;
    }
    return fin;
  } catch(e) {
    sessionStorage.removeItem('finance_auth');
    return null;
  }
}

function financeIsUnlocked() {
  return !!financeGetAuth();
}

function financeAuthHeaders() {
  const fin = financeGetAuth();
  if (!fin) return {};
  let userId = '';
  try { userId = JSON.parse(sessionStorage.getItem('sys_session') || '{}').id || ''; } catch(e) {}
  return {
    'x-finance-auth': fin.token,
    ...(userId ? { 'x-user-id': String(userId) } : {})
  };
}

function financeMergeHeaders(headers) {
  const h = new Headers(headers || {});
  const extra = financeAuthHeaders();
  Object.entries(extra).forEach(([k, v]) => { if (v && !h.has(k)) h.set(k, v); });
  return h;
}

let _financeRealtimePaused = false;

function financePauseRealtime() {
  if (_financeRealtimePaused) return;
  _financeRealtimePaused = true;
  try { if (typeof unsubscribeAll === 'function') unsubscribeAll(); } catch(e) {}
  try { _ordersSSE?.close(); _ordersSSE = null; } catch(e) {}
  try { _adminAnnouncementsSseTenant?.close(); _adminAnnouncementsSseTenant = null; } catch(e) {}
  try { _adminAnnouncementsSseAll?.close(); _adminAnnouncementsSseAll = null; } catch(e) {}
  try { if (window.WA?.sseConn) { window.WA.sseConn.close(); window.WA.sseConn = null; } } catch(e) {}
  try { _rtConnected = false; setRtStatus(false); } catch(e) {}
}

function financeResumeRealtime() {
  if (!_financeRealtimePaused) return;
  _financeRealtimePaused = false;
  setTimeout(() => {
    try { if (typeof subscribeOrders === 'function' && !_rtConnected) subscribeOrders(); } catch(e) {}
    try { if (typeof initAdminAnnouncementsGestor === 'function') initAdminAnnouncementsGestor(); } catch(e) {}
    try { if (typeof waConnectSSE === 'function') waConnectSSE(); } catch(e) {}
  }, 600);
}

(function patchFinanceFetchHeaders(){
  if (window.__financeFetchPatched) return;
  window.__financeFetchPatched = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    try {
      const url = typeof input === 'string' ? input : (input?.url || '');
      const apiUrl = url.startsWith('/api/') || url.startsWith(location.origin + '/api/');
      if (apiUrl && !url.includes('/api/finance-auth/verify')) {
        init = init || {};
        init.headers = financeMergeHeaders(init.headers || (typeof input !== 'string' ? input.headers : undefined));
      }
    } catch(e) {}
    return nativeFetch(input, init);
  };
})();

function financeCloseModal(opts = {}) {
  document.getElementById('finance-auth-modal')?.remove();
  if (!opts.keepRealtimePaused) financeResumeRealtime();
}

function financeOpenUnlockModal(afterUnlock) {
  const old = document.getElementById('finance-auth-modal');
  if (old) old.remove();
  financePauseRealtime();

  const wrap = document.createElement('div');
  wrap.id = 'finance-auth-modal';
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.72);z-index:10050;display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(4px)';
  wrap.innerHTML = `
    <div style="width:min(420px,94vw);background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:22px;box-shadow:0 24px 80px rgba(0,0,0,.45)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px">
        <div>
          <div style="font-size:16px;font-weight:800;color:var(--text)">Area financeira bloqueada</div>
          <div style="font-size:12px;color:var(--muted);margin-top:4px;line-height:1.35">Digite a senha do gestor para liberar esta area por 30 minutos.</div>
        </div>
        <button type="button" id="finance-auth-close" style="width:32px;height:32px;border-radius:50%;border:1px solid var(--border);background:var(--surface2);color:var(--muted);cursor:pointer;font-size:18px;line-height:1">x</button>
      </div>
      <label class="form-label" for="finance-auth-pass">Senha do gestor</label>
      <input class="form-input" id="finance-auth-pass" type="password" autocomplete="current-password" placeholder="Digite a senha" style="width:100%;margin-bottom:10px">
      <div id="finance-auth-error" style="display:none;color:#ef4444;font-size:12px;margin:0 0 10px"></div>
      <button class="btn bp" id="finance-auth-submit" type="button" style="width:100%;justify-content:center">Liberar financeiro</button>
    </div>
  `;
  document.body.appendChild(wrap);

  const pass = document.getElementById('finance-auth-pass');
  const err = document.getElementById('finance-auth-error');
  const btn = document.getElementById('finance-auth-submit');
  const close = document.getElementById('finance-auth-close');
  close.onclick = financeCloseModal;
  wrap.addEventListener('click', e => { if (e.target === wrap) financeCloseModal(); });
  pass.focus();

  const submit = async () => {
    const senha = pass.value || '';
    if (!senha.trim()) {
      err.style.display = 'block';
      err.textContent = 'Informe a senha.';
      return;
    }
    let sess = {};
    try { sess = JSON.parse(sessionStorage.getItem('sys_session') || '{}'); } catch(e) {}
    btn.disabled = true;
    btn.textContent = 'Validando...';
    err.style.display = 'none';
    try {
      const r = await fetch('/api/finance-auth/verify', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'x-tenant-id': sess.tenant_id || '', 'x-user-id': sess.id || '' },
        body: JSON.stringify({ senha, user_id: sess.id || '' })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.token) throw new Error(data.error || 'Senha incorreta');
      sessionStorage.setItem('finance_auth', JSON.stringify({
        token: data.token,
        expires_at: data.expires_at,
        tenant_id: sess.tenant_id || '',
        user_id: sess.id || ''
      }));
      financeCloseModal({ keepRealtimePaused: true });
      sbToast('ok', 'Financeiro liberado por 30 minutos.');
      try { if (typeof loadAllData === 'function') await loadAllData(true); } catch(e) {}
      if (typeof afterUnlock === 'function') afterUnlock();
      financeResumeRealtime();
    } catch(e) {
      err.style.display = 'block';
      err.textContent = e.message || 'Senha incorreta.';
      btn.disabled = false;
      btn.textContent = 'Liberar financeiro';
      pass.select();
    }
  };
  btn.onclick = submit;
  pass.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

function financeGateNav(id) {
  if (!FINANCE_LOCKED_PAGES.has(id)) return false;
  if (financeIsUnlocked()) return false;
  financeOpenUnlockModal(() => nav(id));
  return true;
}

if (!_verificarSessao()) { /* redireciona */ }
else {
  if (billingIsLocked()) {
    billingApplyLockUI();
    let billingPlanoTries = 0;
    setTimeout(function waitBillingPlano() {
      billingApplyLockUI();
      if (typeof renderMeuPlano === 'function') {
        try { renderMeuPlano(); } catch(e) {}
        return;
      }
      if (billingPlanoTries++ < 80) setTimeout(waitBillingPlano, 100);
    }, 50);
  }
  _carregarPlano();
  if (!billingIsLocked()) _carregarSegmento();
} // Busca plano e segmento do servidor

// ── Tenant injetado automaticamente pelo api-client.js ────
// O shim lê tenant_id da sessionStorage e envia x-tenant-id em cada request.
// Não precisa mais do proxy manual — sb já funciona com multi-tenant.

// ── Segmento do tenant (restaurante | acougue) ───────────────────────────
let _segmento = 'restaurante';
window._segmento = _segmento;

async function _carregarSegmento() {
  try {
    const tid = _sessao?.tenant_id;
    if (!tid) return;
    const r = await fetch('/api/tenant-segmento', { headers: { 'x-tenant-id': tid } });
    if (!r.ok) return;
    const d = await r.json();
    _segmento = d.segmento || 'restaurante';
    window._segmento = _segmento;
    _adaptarParaSegmento();
  } catch(e) { console.warn('[gestor-core] silent error:', e?.message || e); }
}

function _adaptarParaSegmento() {
  if (_segmento !== 'acougue') return;
  // Adiciona classe no body — CSS oculta tudo com data-hide-acougue
  document.body.classList.add('modo-acougue');
  // Kanban: exibe coluna "Entregue"
  const _kb = document.getElementById('kanban-board');
  if (_kb) _kb.classList.add('acougue-kanban');
  // Troca labels marcados com data-label-acougue
  document.querySelectorAll('[data-label-acougue]').forEach(el => {
    el.textContent = el.getAttribute('data-label-acougue');
  });
  // Dispara evento para outros módulos
  document.dispatchEvent(new CustomEvent('segmento:acougue'));
  // Re-renderiza o kanban — fetch de /tenant-segmento é assíncrono e pode chegar DEPOIS do
  // 1º renderKanban(), que já terá aplicado inline display:none !important no kol-entregue
  // assumindo restaurante. Precisamos chamar de novo agora pra corrigir.
  if (typeof renderKanban === 'function') {
    try { renderKanban(); } catch(e) { console.warn('[adaptar] renderKanban falhou:', e.message); }
  }
}

// ── Loading overlay ──────────────────────────────────
let _sbLoadingTimer = null;
function sbLoading(show) {
  let el = document.getElementById('sb-loading');
  if (!el && show) {
    el = document.createElement('div');
    el.id = 'sb-loading';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(15,17,23,.88);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;font-family:"DM Sans",sans-serif';
    el.innerHTML = `
      <div style="width:38px;height:38px;border:3px solid rgba(59,130,246,.25);border-top-color:var(--accent);border-radius:50%;animation:sb-spin .7s linear infinite"></div>
      <div style="font-size:12.5px;color:var(--muted)">Conectando ao banco de dados...</div>`;
    document.body.appendChild(el);
  }
  if (el) el.style.display = show ? 'flex' : 'none';
  // Timeout de segurança — força fechar após 8s para nunca ficar preso
  if (_sbLoadingTimer) { clearTimeout(_sbLoadingTimer); _sbLoadingTimer = null; }
  if (show) {
    _sbLoadingTimer = setTimeout(() => {
      const e = document.getElementById('sb-loading');
      if (e) e.style.display = 'none';
      _sbLoadingTimer = null;
    }, 8000);
  }
}

// ── Mapper helpers ───────────────────────────────────
function _safeParseArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch {}
  }
  return [];
}

function mapItem(i) {
  return {
    id: i.id,
    emoji: i.emoji || '',
    name: i.name,
    cat: i.cat || '',
    catKey: i.cat_key || i.cat || '',
    price: parseFloat(i.price) || 0,
    priceOld: i.price_old ? parseFloat(i.price_old) : undefined,
    promo: !!i.promo,
    status: i.status || 'active',
    days: _safeParseArray(i.days).length ? _safeParseArray(i.days) : [1,1,1,1,1,1,1],
    desc: i.description || '',
    imageUrl: i.image_url || null,
    ingredients: _safeParseArray(i.ingredients),
    itemType: i.item_type || 'normal',
    allowHalf: !!i.allow_half,
    maxFlavors: i.max_flavors || 1,
    customGroups: _safeParseArray(i.custom_groups),
    destaque: !!i.destaque
  };
}

// Converte timestamp UTC (do Supabase) para horário de Brasília formatado (HH:MM)
function _formatTimeBR(ts) {
  if (!ts) return '';
  try {
    // SQLite datetime('now') retorna UTC sem sufixo Z. Sem o Z, o JS interpreta
    // como horário local — gerando offset de 3h no Brasil. Anexa Z se faltar.
    let s = String(ts).trim();
    if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
    const d = new Date(s);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  } catch(e) { return ts; }
}

// Parse seguro de items — Supabase Realtime pode devolver JSONB como string
function _parseItems(items) {
  if (Array.isArray(items)) return items;
  if (typeof items === 'string') { try { return JSON.parse(items); } catch { return []; } }
  return [];
}

// Mesma coisa, mas exclui itens cancelados (item_status='cancelado').
// Use sempre que for SOMAR valores ou EXIBIR pro cliente — não use em telas
// internas que precisem rastrear o que foi cancelado.
function _parseItemsAtivos(items) {
  return _parseItems(items).filter(i => (i?.item_status || 'active') !== 'cancelado');
}

function mapOrder(o) {
  const pixPendente = o.status === 'aguardando_pix' && o.pag === 'pix_manual';
  const rawTime = o.created_at || o.time || '';
  return {
    id: o.id,
    num: _orderNum(o.id, o.order_num),
    order_num: o.order_num || null,
    client: o.client || '',
    phone: o.phone || '',
    items: _parseItems(o.items),
    total: parseFloat(o.total) || 0,
    taxa: parseFloat(o.taxa) || 0,
    status: pixPendente ? 'analise' : (o.status || 'analise'),
    _pixPendente: pixPendente,
    _statusReal: o.status || 'analise',
    time: _formatTimeBR(rawTime),
    created_at: o.created_at || '',
    updated_at: o.updated_at || '',
    addr: o.addr || '',
    pag: o.pag || '',
    troco: o.troco != null ? parseFloat(o.troco) : null,
    pag_momento: o.pag_momento || null,
    mesa_num: o.mesa_num || null,
    garcom_id: o.garcom_id || null,
    garcom_nome: o.garcom_nome || ''
  };
}

// ── Load all data ────────────────────────────────────
async function loadAllData(silent = false) {
  console.log('[LOAD] loadAllData chamado | silent:', silent, '| tenant:', _sessao?.tenant_id);
  if (billingIsLocked()) {
    billingApplyLockUI();
    return;
  }
  if (!silent) sbLoading(true);
  try {
    await ensureCardapioImageUrlsOptimized();
    // Run all queries independently so one failure doesn't block others
    const safe = q => q.then(r => r).catch(e => ({ data: null, error: e }));
    const canReadFinance = typeof financeIsUnlocked === 'function' && financeIsUnlocked();

    const [
      itemsRes, catsRes, ordersRes, ordersEntregueRes, movsRes,
      cuponsRes, mesasRes, estoqueRes, receitasRes, fidRes, cfgRes, mesaAbertaRes
    ] = await Promise.all([
      safe(sb.from('menu_items').select('*').order('sort_order').order('id')),
      safe(sb.from('categories').select('*').order('sort_order')),
      // Status ativos (análise até saiu) — sem limite, todos entram no kanban
      safe(sb.from('orders').select('*').in('status',['aguardando_pix','aguardando_cartao','analise','producao','pronto','saiu']).order('id',{ascending:false})),
      // Status "entregue" — sempre busca (limitado a 30 mais recentes de hoje).
      // No açougue, aparecem na coluna "Entregue".
      // No restaurante, ficam no array mas a coluna está oculta — não é problema (custo de memória é pequeno).
      // IMPORTANTE: não condicionar ao window._segmento aqui porque essa query roda antes
      // do fetch /api/tenant-segmento terminar — o segmento real ainda pode ser 'restaurante' (default).
      safe(sb.from('orders').select('*').eq('status','entregue')
        .gte('created_at', (() => { const d=new Date(); d.setHours(d.getHours()-3); return d.toISOString().split('T')[0]; })())
        .order('id',{ascending:false}).limit(30)),
      canReadFinance ? safe(sb.from('movimentos').select('*').gte('created_at', (() => {
        // Usa data local BR (UTC-3) para não perder movimentos do início do dia
        const d = new Date(); d.setHours(d.getHours() - 3);
        return d.toISOString().split('T')[0];
      })()).order('created_at')) : Promise.resolve({ data: [] }),
      safe(sb.from('cupons').select('*').order('id')),
      safe(sb.from('mesas').select('*').order('num')),
      safe(sb.from('estoque').select('*').order('id')),
      safe(sb.from('estoque_receitas').select('*').order('id')),
      safe(sb.from('fidelidade').select('*').order('pts',{ascending:false})),
      safe(sb.from('store_config').select('caixa_open,store_open,gestor_tema,order_num_offset,order_auto_reset_daily,order_auto_reset_last_date,taxa_servico_pct,store_tempo_entrega,store_tempo_retirada,store_name').single()),
      safe(sb.from('orders').select('*').eq('status','mesa_aberta').order('id',{ascending:false}))
    ]);

    if (itemsRes.data?.length)    items         = itemsRes.data.map(mapItem);
    if (catsRes.data?.length)     categories    = catsRes.data.map(c => ({
      id: c.id, name: c.name, label: c.label || c.name,
      type: c.type||'Itens principais', promo:!!c.promo, open:false
    }));
    // Merge pedidos ativos + pedidos entregue recentes
    const _ordersAtivosRaw = ordersRes?.data || [];
    pendingOnlineOrders = _ordersAtivosRaw.filter(o => o.status === 'aguardando_cartao' || (o.status === 'aguardando_pix' && o.pag !== 'pix_manual'));
    const _ativos   = _ordersAtivosRaw.filter(o => o.status !== 'aguardando_cartao' && !(o.status === 'aguardando_pix' && o.pag !== 'pix_manual'));
    const _entreg   = (ordersEntregueRes?.data || []);
    const _todosPed = [..._ativos, ..._entreg];
    // FORÇA: PIX online (pix_mp) NUNCA pode estar em análise no kanban. Sempre produção.
    // Corrige inclusive registros antigos no banco que ficaram com status errado.
    _todosPed.forEach(o => {
      if (o.pag === 'pix_mp' && o.status === 'analise') {
        o.status = 'producao';
        try {
          fetch('/api/order-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: o.id, new_status: 'producao', tenant_id: _sessao?.tenant_id })
          }).catch(()=>{});
        } catch(e) {}
      }
    });
    if (_todosPed.length)         ordersKanban  = _todosPed.map(mapOrder);
    // Comandas mesa_aberta: entram no cache do salão, não no kanban
    (mesaAbertaRes?.data || []).forEach(o => {
      if (!mesaOrdersCache.find(x => x.id === o.id)) mesaOrdersCache.unshift({ ...o, items: _parseItems(o.items), num: _orderNum(o.id, o.order_num) });
    });
    if (!canReadFinance)          movimentos    = [];
    else if (movsRes.data?.length) movimentos   = movsRes.data.map(m => ({
      id: m.id, desc: m.description||'', tipo: m.tipo,
      val: parseFloat(m.val)||0, pag: m.pag||'', time: m.time||''
    }));
    if (cuponsRes.data?.length)   cupons        = cuponsRes.data.map(c => ({
      id:c.id, code:c.code, tipo:c.type||'percent', val:parseFloat(c.value)||0,
      minimo:parseFloat(c.min_order)||0, usos:c.uses_left||-1, ativo:!!c.ativo
    }));
    if (mesasRes.data?.length)    tables        = mesasRes.data.map(t => ({
      id: t.id, num: t.num, status: t.status, guests: t.guests||0,
      total: parseFloat(t.total)||0, pag_forma: t.pag_forma||null,
      opened_at: t.opened_at||null, updated_at: t.updated_at||null
    }));
    if (estoqueRes.data?.length)  estoqueItems  = estoqueRes.data.map(e => ({
      id:e.id, name:e.name, unit:e.unit||'un', qty:parseFloat(e.qty)||0,
      min_qty:parseFloat(e.min_qty)||0, custo:parseFloat(e.cost)||0,
      updated_at:e.updated_at||null
    }));
    if (Array.isArray(receitasRes.data)) estoqueReceitas = receitasRes.data.map(r => ({
      id:r.id, item_id:parseInt(r.item_id)||0, estoque_id:parseInt(r.estoque_id)||0,
      qty:parseFloat(r.qty)||0, unit:r.unit||'', ativo:r.ativo !== false && r.ativo !== 0,
      updated_at:r.updated_at||null
    }));
    if (fidRes.data?.length)      fidClients    = fidRes.data.map(f => ({
      id:f.id, name:f.name, phone:f.phone||'', pts:f.pts||0,
      max:f.max_pts||_fidConfig.meta_pts||500,
      orders:f.orders_count||0, resgates:f.resgates||0
    }));


    // Set orderIdSeq above DB max and init polling tracker
    // Importante: usa Math.max com valor antigo persistido no localStorage
    // pra não regressar se o storage tiver valor maior (gestor reabre depois
    // de pedidos serem cancelados/finalizados — o maxId do kanban atual pode
    // ser menor que o último ID que ele já viu antes de fechar).
    if (ordersKanban.length) {
      const maxId = Math.max(...ordersKanban.map(o=>o.id));
      orderIdSeq = maxId + 1;
      _maxKnownOrderId = Math.max(_maxKnownOrderId, maxId);
      _saveMaxKnownOrderId();
    } else {
      // Kanban vazio — inicializa _maxKnownOrderId com o último ID do banco
      // para o polling detectar novos pedidos do cardápio corretamente
      try {
        const { data: lastOrder } = await sb.from('orders').select('id').order('id', {ascending:false}).limit(1);
        if (lastOrder?.[0]?.id) {
          _maxKnownOrderId = Math.max(_maxKnownOrderId, Number(lastOrder[0].id));
          _saveMaxKnownOrderId();
        }
      } catch(e) { console.warn('[gestor-core] silent error:', e?.message || e); }
    }

    // Aplica estado do caixa e loja
    if (cfgRes.data) {
      _tenantStoreName = cfgRes.data.store_name || _tenantStoreName || '';
      window._tenantStoreName = _tenantStoreName;
      try { if (typeof gestorChatSetStoreName === 'function') gestorChatSetStoreName(_tenantStoreName); } catch(e) {}
      _orderNumOffset = parseInt(cfgRes.data.order_num_offset) || 0;
      _orderAutoResetDaily = cfgRes.data.order_auto_reset_daily === true || cfgRes.data.order_auto_reset_daily === 1 || cfgRes.data.order_auto_reset_daily === '1';
      _orderAutoResetLastDate = cfgRes.data.order_auto_reset_last_date || '';
      _taxaServicoPct = parseFloat(cfgRes.data.taxa_servico_pct) || 0;
      _setTemposPedidoConfig({
        retirada: cfgRes.data.store_tempo_retirada ?? '30-40 min',
        delivery: cfgRes.data.store_tempo_entrega ?? ''
      });

      // Offset de numeracao nao deve ser alterado automaticamente no carregamento.
      // Ele so pode mudar por acao explicita de reset para evitar saltos inesperados.

      // Re-mapeia pedidos já carregados com o offset correto
      ordersKanban = ordersKanban.map(o => ({ ...o, num: _orderNum(o.id, o.order_num) }));
      setCaixaState(cfgRes.data.caixa_open !== false);
      const stOpen = cfgRes.data.store_open !== false;
      const st   = document.getElementById('status-txt');
      const dot  = document.getElementById('status-dot');
      const pill = document.getElementById('pill-status');
      if (st)   st.textContent = stOpen ? 'Online' : 'Offline';
      if (dot)  dot.style.background  = stOpen ? 'var(--success)' : 'var(--danger)';
      if (pill) { pill.style.background = stOpen ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)'; pill.style.borderColor = stOpen ? 'rgba(34,197,94,.25)' : 'rgba(239,68,68,.25)'; pill.style.color = stOpen ? 'var(--success)' : 'var(--danger)'; }
      // Aplica tema salvo no banco, com fallback local para quem trocou offline/antes do sync.
      let modoSalvo = cfgRes.data.gestor_tema || '';
      if (!modoSalvo) {
        try { modoSalvo = localStorage.getItem('gestor_tema_atual') || ''; } catch(e) {}
      }
      modoSalvo = modoSalvo || 'claro';
      if (typeof temaAplicarCompleto === 'function') {
        temaAplicarCompleto(modoSalvo);
        if (!cfgRes.data.gestor_tema && modoSalvo !== 'claro') {
          sb.from('store_config').upsert({ tenant_id: _sessao?.tenant_id, gestor_tema: modoSalvo }).then(()=>{}).catch(()=>{});
        }
      } else {
        _aplicarVars(modoSalvo === 'claro' ? MODO_CLARO : MODO_ESCURO);
        if (modoSalvo === 'claro') {
          _aplicarOverrideClaro(MODO_CLARO);
        } else {
          const el = document.getElementById('tema-light-override');
          if (el) el.remove();
        }
      }
    }

    await loadFidConfig();
    // Restaura config de impressão do Supabase (sincroniza web e Electron)
    if (typeof loadPrintConfigServer === 'function') loadPrintConfigServer().catch(()=>{});
    if (!_rtConnected) subscribeOrders();
    if (typeof renderKanban === 'function') renderKanban();
    if (typeof renderCaixa === 'function') renderCaixa();
    // Sincroniza SW com os dados carregados
    setTimeout(() => _initSwState(), 500);
  } catch(e) {
    console.error('Supabase load error:', e);
    if (!silent) sbToast('err', 'Erro ao conectar ao banco de dados');
  } finally {
    if (!silent) sbLoading(false);
  }
}

let _cardapioImageRepairTenant = '';
async function ensureCardapioImageUrlsOptimized() {
  const tid = _sessao?.tenant_id || '';
  if (!tid || _cardapioImageRepairTenant === tid) return;
  _cardapioImageRepairTenant = tid;
  try {
    const res = await fetch('/api/cardapio/reparar-imagens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Falha ao reparar imagens');
    if (data.converted) console.log('[CARDAPIO] imagens inline convertidas:', data);
  } catch(e) {
    _cardapioImageRepairTenant = '';
    console.warn('[CARDAPIO] reparo de imagens pulado:', e.message || e);
  }
}

function _refreshMesaPageIfActive() {
  const pg = document.getElementById('page-pedidos-mesa');
  if (pg && pg.classList.contains('on')) renderMesasPage();
}

// ── Realtime orders ──────────────────────────────────
function sendBrowserNotif(title, body) {
  // App desktop: usa notificação nativa do Windows (mais profissional)
  if (window.ElectronPrint) {
    window.ElectronPrint.notify(title, body);
    return;
  }
  // Web: notificação do navegador
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '' });
  }
}

let _rtChannels = [];
let _rtConnected = false;
let _swReg       = null;
let _heartbeat   = null;

// ── Service Worker ────────────────────────
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    _swReg = await navigator.serviceWorker.register('./gestor-sw.js', { scope: './' });
    console.log('[SW] gestor registered');

    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'SW_POLL_DONE') {
        // Recarga silenciosa quando SW detectou algo em background
        loadAllData(true);
        if (!_rtConnected) subscribeOrders();
      }
    });

    // Inicia SW assim que o worker estiver pronto
    if (_swReg.active) {
      _initSwState();
    } else {
      _swReg.addEventListener('updatefound', () => {
        const w = _swReg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'activated') _initSwState();
        });
      });
    }
  } catch(e) { console.warn('[SW] register failed', e); }
}

function _initSwState() {
  if (!_swReg?.active) return;
  _swReg.active.postMessage({
    type:         'INIT',
    tenant_id:    _sessao?.tenant_id || null,
    orderIds:     ordersKanban.map(o => o.id),
    mesaOrderIds: mesaOrdersCache.map(o => o.id)
  });
}

function _syncSwState() {
  if (!_swReg?.active) return;
  _swReg.active.postMessage({
    type:         'SYNC',
    tenant_id:    _sessao?.tenant_id || null,
    orderIds:     ordersKanban.map(o => o.id),
    mesaOrderIds: mesaOrdersCache.map(o => o.id)
  });
}

async function requestNotifPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') await Notification.requestPermission();
}

function setRtStatus(ok) {
  _rtConnected = ok;
  const dot = document.getElementById('rt-dot');
  const txt = document.getElementById('rt-txt');
  if (dot) dot.style.background = ok ? 'var(--success)' : 'var(--danger)';
  if (txt) txt.textContent = ok ? 'Ao vivo' : 'Reconectando...';
}

function unsubscribeAll() {
  _rtChannels.forEach(ch => { try { sb.removeChannel(ch); } catch(e){} });
  _rtChannels = [];
  if (_heartbeat) { clearInterval(_heartbeat); _heartbeat = null; }
  if (_radioSSE) { try { _radioSSE.close(); } catch{} _radioSSE = null; }
}

// mesaOrdersCache e tables são declarados em mesa-state.js (carregado antes)
// e permanecem como globais acessíveis a todos os módulos gestor-*.js.

// _updateMesaOrdersCache removida — use _patchOrderInCache() de mesa-state.js

function _renderMesaPageFromCache() {
  const pg = document.getElementById('page-pedidos-mesa');
  if (!pg || !pg.classList.contains('on')) return;

  const grid = document.getElementById('pm-mesas-grid');
  if (!grid) return;

  const activeTables = tables.filter(t => t.status !== 'free');

  // Atualiza stats sem piscar
  const elv = (id, v) => { const e = document.getElementById(id); if (e && e.textContent !== String(v)) e.textContent = v; };
  elv('pm-stat-livres',    tables.filter(t => t.status === 'free').length);
  elv('pm-stat-ocupadas',  tables.filter(t => t.status === 'busy').length);
  elv('pm-stat-aguardando',tables.filter(t => t.status === 'waiting').length);

  if (!activeTables.length) {
    grid.innerHTML = '<div style="text-align:center;padding:60px;color:var(--muted);font-size:13px"><div><div style="margin:0 auto 10px;text-align:center"><svg width="40" height="40" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;opacity:.25"><path d="M5 2h6v6a3 3 0 0 1-6 0V2z" stroke="currentColor" stroke-width="1.2"/><path d="M2 2h3M11 2h3M2 5H5M11 5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M8 8v4M5.5 14h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></div><div style="display:none"></div>Nenhuma mesa ocupada no momento</div>';
    return;
  }

  const sessionOrders = mesaOrdersCache.filter(o => {
    const mesa = activeTables.find(t => t.num === parseInt(o.mesa_num));
    if (!mesa) return false;
    return typeof mesaOrderBelongsToSession === 'function'
      ? mesaOrderBelongsToSession(o, mesa)
      : (!mesa.opened_at || new Date(o.created_at || 0).getTime() >= new Date(mesa.opened_at).getTime() - 5000);
  });

  // Atualização inteligente: só substitui o card da mesa que mudou
  const sorted = activeTables.sort((a, b) => a.num - b.num);
  const existing = grid.querySelectorAll('[data-mesa-card]');
  const existingNums = new Set([...existing].map(el => parseInt(el.dataset.mesaCard)));
  const activeNums   = new Set(sorted.map(t => t.num));

  // Remove cards de mesas que ficaram livres
  existing.forEach(el => {
    if (!activeNums.has(parseInt(el.dataset.mesaCard))) el.remove();
  });

  sorted.forEach((t, i) => {
    const orders  = sessionOrders.filter(o => parseInt(o.mesa_num) === t.num);
    const newHtml = renderMesaCard(t, orders);
    const cardId  = 'mesa-card-' + t.num;
    let el = document.getElementById(cardId);

    if (!el) {
      // Nova mesa — cria wrapper e insere na posição certa
      el = document.createElement('div');
      el.id = cardId;
      el.dataset.mesaCard = t.num;
      el.style.cssText = 'margin-bottom:0';
      el.innerHTML = newHtml;
      const ref = grid.children[i];
      if (ref) grid.insertBefore(el, ref); else grid.appendChild(el);
    } else {
      // Mesa existente — só atualiza se conteúdo mudou (evita piscar)
      if (el.innerHTML !== newHtml) {
        el.innerHTML = newHtml;
      }
    }
  });
}

// Imprime pedido de conta no caixa quando garçom solicita fechamento
// SOMENTE impressora do caixa — sem via de cozinha
async function _printComandaMesa(mesaNum, mesaData) {
  const _mesaNum = parseInt(mesaNum);
  const mesa = tables.find(t => t.num === _mesaNum) || mesaData;

  // Filtra pedidos da sessão atual — mesmo filtro usado em _renderMesaPageFromCache
  const pedidos = mesaOrdersCache.filter(o => {
    if (parseInt(o.mesa_num) !== _mesaNum) return false;
    if (o.status === 'cancelado') return false;
    return typeof mesaOrderBelongsToSession === 'function'
      ? mesaOrderBelongsToSession(o, mesa)
      : (!mesa?.opened_at || new Date(o.created_at || 0).getTime() >= new Date(mesa.opened_at).getTime() - 5000);
  });
  if (!pedidos.length) return;

  const allItems = pedidos.flatMap(o => _parseItems(o.items))
    .filter(i => i.item_status !== 'cancelado');
  if (!allItems.length) return;

  // Consolida itens iguais
  const itemMap = {};
  allItems.forEach(i => {
    const k = i.name + (i.obs || '');
    if (!itemMap[k]) itemMap[k] = { name: i.name, qty: 0, price: i.price || 0, obs: i.obs || '' };
    itemMap[k].qty += (i.qty || 1);
  });
  const itens = Object.values(itemMap);

  const cfg      = typeof _getPrintConfig === 'function' ? _getPrintConfig() : {};
  const nome     = (_sessao?.nome || cfg.nome || 'RESTAURANTE').toUpperCase();
  const fontSize = parseInt(cfg.fontSize) || 13;
  const rodape   = cfg.rodape || 'Obrigado pela preferência!';
  const fmt      = localStorage.getItem('printFormat') || cfg.format || '80mm';
  const printer  = cfg.printer_caixa || cfg.printer || localStorage.getItem('printPrinter') || '';
  const pagForma = mesaData.pag_forma || '';
  const total    = parseFloat(mesaData.total || 0);
  const now      = new Date().toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });

  const html = `
    <div class="print-ticket" style="font-size:${fontSize}px">
      <div style="text-align:center;font-size:1.1em;font-weight:900">${nome}</div>
      <div style="text-align:center;font-weight:bold;margin:4px 0">*** PEDIDO DE CONTA ***</div>
      <hr style="border:none;border-top:1px dashed #000;margin:4px 0">
      <div>Mesa: <b>${mesaNum}</b></div>
      <div>Data: ${now}</div>
      ${pagForma ? `<div>Pagamento: <b>${pagForma}</b></div>` : ''}
      <hr style="border:none;border-top:1px dashed #000;margin:4px 0">
      ${itens.map(i => `<div style="margin-bottom:4px">
        <div style="font-weight:bold;word-break:break-word">${i.qty}x ${i.name.toUpperCase()}
          <span style="float:right">R$ ${(i.price * i.qty).toFixed(2).replace('.',',')}</span>
        </div>
        ${i.obs ? `<div style="padding-left:12px;font-size:0.88em">↳ ${i.obs}</div>` : ''}
      </div>`).join('')}
      <hr style="border:none;border-top:1px dashed #000;margin:4px 0">
      <div style="display:flex;justify-content:space-between;font-weight:900;font-size:1.05em">
        <span>TOTAL</span><span>R$ ${total.toFixed(2).replace('.',',')}</span>
      </div>
      <hr style="border:none;border-top:1px dashed #000;margin:4px 0">
      <div style="text-align:center;font-size:0.85em">${rodape}</div>
    </div>`;

  // Envia SOMENTE para impressora do caixa — sem via de cozinha
  // Usa cascata direta sem passar por _printJobCascade (que tem USB path que reconstrói ticket)
  const tid = (() => { try { return JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || ''; } catch { return ''; } })();

  // 1. Electron
  if (window.ElectronPrint) {
    try {
      const pw = fmt === '58mm' ? 58 : 80;
      if (window.ElectronPrint.printHtml) {
        const r = await window.ElectronPrint.printHtml(html, { printer: printer || '', paperWidth: pw, landscape: false, scaleFactor: 100 });
        if (r && r.ok) return;
      }
    } catch(e) { console.warn('[PRINT CONTA] Electron falhou:', e.message); }
  }

  // 2. Print Agent — envia direto sem verificar status
  try {
    if (tid) {
      const res = await fetch('/api/print-queue/job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
        body: JSON.stringify({ html, format: fmt, printer: printer || undefined, tipo: 'caixa' }),
      });
      if (res.ok) return;
    }
  } catch(e) { console.warn('[PRINT CONTA] Agent falhou:', e.message); }

  // 3. Servidor PDF
  try {
    if (tid) {
      const r = await fetch('/api/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
        body: JSON.stringify({ html, format: fmt, printer: printer || undefined }),
      });
      const data = await r.json();
      if (data.pdf) {
        const bytes = Uint8Array.from(atob(data.pdf), c => c.charCodeAt(0));
        const blob  = new Blob([bytes], { type: 'application/pdf' });
        const url   = URL.createObjectURL(blob);
        const frame = document.createElement('iframe');
        frame.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;visibility:hidden';
        document.body.appendChild(frame);
        frame.src = url;
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    }
  } catch(e) { console.warn('[PRINT CONTA] Servidor falhou:', e.message); }
}

const _printJobsEmProcesso = new Set();

function _gestorImprimirJobCaixaViaNavegador(html, fmt) {
  if (!html || !document?.body) return false;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
  const page = html.includes('<html') ? html : `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Conta</title>
    <style>body{margin:0;padding:4px;font-family:monospace;background:#fff;color:#000} @media print{@page{margin:2mm;size:${fmt || '80mm'} auto} body{margin:0}}</style>
    </head><body>${html}</body></html>`;
  frame.onload = () => {
    setTimeout(() => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch(e) {
        console.warn('[PRINT JOB CAIXA] navegador falhou:', e?.message || e);
      }
    }, 250);
  };
  document.body.appendChild(frame);
  frame.srcdoc = page;
  setTimeout(() => { try { frame.remove(); } catch {} }, 60000);
  return true;
}

async function _gestorImprimirJobCaixa(job) {
  if (!job?.id || !job?.html) return;
  const tipo = String(job.tipo || 'caixa').toLowerCase();
  if (tipo !== 'caixa') return;
  if (_printJobsEmProcesso.has(job.id)) return;

  _printJobsEmProcesso.add(job.id);
  try {
    const tid = (() => { try { return JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || ''; } catch { return ''; } })();
    if (!tid) return;

    // Se o Print Agent está ativo, ele é o dono da fila e evita impressão duplicada no gestor.
    try {
      const st = await fetch('/api/print-queue/status', { headers: { 'x-tenant-id': tid } }).then(r => r.json());
      if (st?.active) return;
    } catch (_) {}

    const fmt = job.format || localStorage.getItem('printFormat') || '80mm';
    const pw  = fmt === '58mm' ? 58 : 80;
    const printer = job.printer || localStorage.getItem('printPrinter') || '';
    let impresso = false;

    if (window.ElectronPrint?.printHtml) {
      const r = await window.ElectronPrint.printHtml(job.html, {
        printer,
        paperWidth: pw,
        landscape: false,
        scaleFactor: 100
      }).catch(e => ({ ok: false, error: e?.message || String(e) }));
      impresso = !r || r.ok !== false;
    } else {
      impresso = _gestorImprimirJobCaixaViaNavegador(job.html, fmt);
    }

    if (impresso) {
      await fetch(`/api/print-queue/job/${job.id}/done`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
        body: JSON.stringify({ status: 'done' })
      }).catch(() => {});
      sbToast?.('ok', '🖨️ Conta recebida do garçom e impressa no caixa');
    }
  } finally {
    setTimeout(() => _printJobsEmProcesso.delete(job.id), 30000);
  }
}

function subscribeOrders() {
  if (billingIsLocked()) {
    unsubscribeAll();
    return;
  }
  unsubscribeAll();

  const chOrders = sb.channel('orders-rt')
    .on('postgres_changes', {event:'INSERT', schema:'public', table:'orders'}, p => {
      // Pedido aguardando cartão não entra no kanban — só após pagamento online confirmado
      // PIX manual entra no kanban na coluna "analise" para o gestor confirmar o recebimento
      if (p.new.status === 'aguardando_cartao' || (p.new.status === 'aguardando_pix' && p.new.pag !== 'pix_manual')) {
        pendingOnlineOrders = [p.new, ...pendingOnlineOrders.filter(o => o.id !== p.new.id)];
        if (p.new.id > _maxKnownOrderId) { _maxKnownOrderId = p.new.id; _saveMaxKnownOrderId(); }
        if (typeof renderPendingPaymentsAlert === 'function') renderPendingPaymentsAlert();
        return;
      }
      if (p.new.status === 'entregue') return; // bebidas de mesa já entregues não entram no kanban
      if (p.new.status === 'mesa_aberta') {
        // Comanda única de mesa — vai ao cache do salão, não ao kanban
        const hasFoodItems = Array.isArray(p.new.items) && p.new.items.some(i => i.item_status === 'producao');
        _patchOrderInCache(p.new);
        _renderMesaPageFromCache();
        if (hasFoodItems) {
          playOrderSound();
          const foodList = p.new.items.filter(i => i.item_status === 'producao').map(i => i.qty + 'x ' + i.name).join(', ');
          showToast('\uD83C\uDF74', 'Mesa ' + p.new.mesa_num + ' — ' + foodList);
          sendBrowserNotif('\uD83C\uDF74 Pedido Mesa ' + p.new.mesa_num, foodList);
          const nc = document.getElementById('notif-count');
          if (nc) { nc.style.display='flex'; nc.textContent = parseInt(nc.textContent||0)+1; }
          // Auto-impressão para pedidos de mesa — só imprime itens NOVOS (producao)
          if ((window._printMode || _printMode) === "auto") {
            const _mapped = mapOrder(p.new);
            const _onlyNew = (Array.isArray(p.new.items) ? p.new.items : []).filter(i => i.item_status === 'producao');
            if (_onlyNew.length) { const _clone = Object.assign({}, _mapped, { items: _onlyNew }); printOrder(_clone); }
          }
        }
        renderKanban();
        return;
      }
      if (!ordersKanban.find(x => x.id === p.new.id)) {
        // PIX manual aparece na coluna analise com badge próprio
        const _mapped = mapOrder(p.new);
        if (_mapped.status === 'aguardando_pix') _mapped._pixPendente = true;
        ordersKanban.unshift(_mapped);
        if (p.new.id > _maxKnownOrderId) { _maxKnownOrderId = p.new.id; _saveMaxKnownOrderId(); }
        if (window._pdvCreatedIds && window._pdvCreatedIds.has(Number(p.new.id))) { window._pdvCreatedIds.delete(Number(p.new.id)); renderKanban(); return; }
        renderKanban();
        playOrderSound();
        // Mesa: só um toque — garçom já sabe o que pediu. Delivery/retirada: alerta persistente.
        if (!p.new.mesa_num) _startPersistentAlert();
        const nc = document.getElementById('notif-count');
        if (nc) { nc.style.display='flex'; nc.textContent = parseInt(nc.textContent||0)+1; }
        const items = Array.isArray(p.new.items) ? p.new.items.map(i=>`${i.qty}x ${i.name}`).join(', ') : '';
        showToast('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M8 2a5 5 0 0 1 5 5v3l1 2H2l1-2V7a5 5 0 0 1 5-5z" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1.4"/></svg>', `Novo pedido #${_orderNum(p.new.id, p.new.order_num)} — ${p.new.client}`);
        sendBrowserNotif(`Novo pedido #${_orderNum(p.new.id, p.new.order_num)}`, `${p.new.client} — ${items}`);
        // Automação: mensagem de pedido recebido
        // Auto-aceitar se ativado e pedido em análise
        if (_autoAcceptOn && p.new.status === 'analise') {
          setTimeout(() => advanceOrderById(p.new.id), 800);
        }
        // Auto-impressão se modo automático estiver ativo (bebidas não imprimem)
        if ((window._printMode || _printMode) === 'auto') printOrder(mapOrder(p.new));
      }
      // Atualiza cache de mesa e rerenderiza SEM nova query ao banco
      if (p.new.mesa_num) {
        _patchOrderInCache(p.new);
        _renderMesaPageFromCache();
      }
      _syncSwState();
    })
    .on('postgres_changes', {event:'UPDATE', schema:'public', table:'orders'}, p => {
      const _stillPendingOnline = p.new.status === 'aguardando_cartao' || (p.new.status === 'aguardando_pix' && p.new.pag !== 'pix_manual');
      if (_stillPendingOnline) {
        pendingOnlineOrders = [p.new, ...pendingOnlineOrders.filter(o => o.id !== p.new.id)];
      } else {
        pendingOnlineOrders = pendingOnlineOrders.filter(o => o.id !== p.new.id);
      }
      if (typeof renderPendingPaymentsAlert === 'function') renderPendingPaymentsAlert();
      // FORÇA: PIX online (pix_mp) NUNCA pode ficar em análise. Sempre produção.
      if (p.new.pag === 'pix_mp' && p.new.status === 'analise') {
        p.new.status = 'producao';
        // Persiste no banco em paralelo (não bloqueia)
        try {
          fetch('/api/order-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: p.new.id, new_status: 'producao', tenant_id: _sessao?.tenant_id })
          }).catch(()=>{});
        } catch(e) {}
      }
      const idx = ordersKanban.findIndex(x => x.id === p.new.id);
      // PIX confirmado — entra no kanban agora
      // PIX online (pix_mp) confirmado pelo MP: vai direto para 'producao' (pula análise)
      // PIX manual (pix_manual) ou legado (pix): vai para 'analise' (precisa aceite)
      if (idx === -1 && (
            (p.new.status === 'producao' && p.new.pag === 'pix_mp') ||
            (p.new.status === 'analise' && (p.new.pag === 'pix_manual' || p.new.pag === 'pix' || p.new.pag === 'cartao_mp')) ||
            (p.new.status === 'aguardando_pix' && p.new.pag === 'pix_manual')
          )) {
        const mapped = mapOrder(p.new);
        const isPixManualPendente = mapped._pixPendente === true;
        ordersKanban.unshift(mapped);
        renderKanban();
        playOrderSound();
        if (!p.new.mesa_num) _startPersistentAlert();
        const nc = document.getElementById('notif-count');
        if (nc) { nc.style.display='flex'; nc.textContent = parseInt(nc.textContent||0)+1; }
        const items = Array.isArray(p.new.items) ? p.new.items.map(i=>`${i.qty}x ${i.name}`).join(', ') : '';
        const tituloPagamento = p.new.pag === 'cartao_mp' ? 'Cartao aprovado!' : (isPixManualPendente ? 'PIX manual pendente!' : 'PIX confirmado!');
        showToast('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><rect x="1" y="4" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M1 7h14" stroke="currentColor" stroke-width="1.4"/></svg>', `${tituloPagamento} Pedido #${_orderNum(p.new.id, p.new.order_num)} — ${p.new.client}`);
        sendBrowserNotif(`${tituloPagamento} #${_orderNum(p.new.id, p.new.order_num)}`, `${p.new.client} — ${items}`);
        // PIX online: pagamento já confirmado, imprime sempre (independe do modo de impressão e do toggle de auto-aceite)
        // PIX manual: respeita _autoAcceptOn e _printMode normalmente
        if (p.new.pag === 'pix_mp') {
          printOrder(mapped);
        } else {
          if (_autoAcceptOn && !isPixManualPendente) setTimeout(() => advanceOrderById(p.new.id), 800);
          if ((window._printMode || _printMode) === 'auto' && !isPixManualPendente) printOrder(mapped);
        }
        return;
      }
      // Pedido já está no kanban e virou pix_mp aprovado → garante que vai para produção e imprime
      if (idx !== -1 && p.new.pag === 'pix_mp' && (p.new.status === 'producao' || p.new.status === 'analise')) {
        const wasInAnalise = ordersKanban[idx].status === 'analise' || ordersKanban[idx].status === 'aguardando_pix';
        ordersKanban[idx] = mapOrder({ ...p.new, status: 'producao' });
        ordersKanban[idx].status = 'producao';
        renderKanban();
        if (wasInAnalise) {
          playOrderSound();
          printOrder(mapOrder({ ...p.new, status: 'producao' }));
        }
        return;
      }
      if (idx !== -1) {
        // Só mantém no kanban os status ativos (analise/producao/pronto/saiu).
        // 'entregue' só permanece para açougue (que tem coluna própria). Para restaurante,
        // 'entregue' não é mais um estado visível no kanban — ele vira 'finalizado' direto
        // via finishOrderById. Se chegar via SSE, remove.
        // 'finalizado'/'cancelado' sempre saem do kanban.
        if (['finalizado','cancelado'].includes(p.new.status)) {
          if (p.new.status === 'cancelado') {
            showToast('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>', `Pedido #${_orderNum(p.new.id, p.new.order_num)} cancelado pelo cliente — ${p.new.client}`);
            sendBrowserNotif(`Pedido cancelado pelo cliente`, `#${_orderNum(p.new.id, p.new.order_num)} — ${p.new.client}`);
          }
          ordersKanban.splice(idx, 1);
        } else if (p.new.status === 'entregue' && window._segmento !== 'acougue') {
          // Restaurante: entregue não é exibido → remove do kanban (mesa, delivery, balcão)
          ordersKanban.splice(idx, 1);
        } else {
          ordersKanban[idx] = mapOrder(p.new);
        }
        renderKanban();
      }
      if (p.new.mesa_num) {
        // Detecta novos itens de cozinha adicionados ao UPDATE da comanda
        if (p.new.status === 'mesa_aberta') {
          const _pNewItems = _parseItems(p.new.items);
          const prev = mesaOrdersCache.find(o => o.id === p.new.id);
          const prevProducao = prev ? _parseItems(prev.items).filter(i => i.item_status === 'producao').length : 0;
          const newProducao  = _pNewItems.filter(i => i.item_status === 'producao').length;
          if (newProducao > prevProducao) {
            playOrderSound();
            const _newFoodItems = _pNewItems.filter(i => i.item_status === 'producao').slice(-(newProducao - prevProducao));
            const newFoods = _newFoodItems.map(i => i.qty + 'x ' + i.name).join(', ');
            showToast('\uD83C\uDF74', 'Mesa ' + p.new.mesa_num + ' — ' + newFoods);
            sendBrowserNotif('\uD83C\uDF74 Mesa ' + p.new.mesa_num, newFoods);
            // Auto-impressão — só os itens NOVOS desta rodada
            if ((window._printMode || _printMode) === "auto" && _newFoodItems.length) {
              const _clone = Object.assign({}, mapOrder(p.new), { items: _newFoodItems });
              printOrder(_clone);
            }
          }
        }
        _patchOrderInCache(p.new);
        _renderMesaPageFromCache();
        renderKanban();
      }
      _syncSwState();
    })
    .on('postgres_changes', {event:'DELETE', schema:'public', table:'orders'}, p => {
      ordersKanban = ordersKanban.filter(o => o.id !== p.old.id);
      mesaOrdersCache = mesaOrdersCache.filter(o => o.id !== p.old.id);
      renderKanban();
      _renderMesaPageFromCache();
    })
    .subscribe(status => {
      setRtStatus(status === 'SUBSCRIBED');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setTimeout(() => subscribeOrders(), 3000);
      }
    });

  const chMesas = sb.channel('mesas-rt')
    .on('postgres_changes', {event:'*', schema:'public', table:'mesas'}, async p => {
      // Notifica o gestor quando garçom envia mesa para pagamento
      if (p.eventType === 'UPDATE' && p.new?.status === 'waiting' && p.old?.status !== 'waiting') {
        const mesaNum = p.new.num;
        const total   = parseFloat(p.new.total || 0).toFixed(2).replace('.', ',');
        const pagForma = p.new.pag_forma ? ` · ${p.new.pag_forma}` : '';
        showToast(
          '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0"><rect x="2" y="5" width="12" height="2" rx="1" fill="currentColor"/><line x1="4" y1="7" x2="4" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
          `Mesa ${mesaNum} aguardando pagamento — R$ ${total}${pagForma}`
        );
        sendBrowserNotif(`💰 Mesa ${mesaNum} pronta para fechar`, `Total: R$ ${total}${pagForma}`);
        playOrderSound();
        // Muda para a aba de mesas automaticamente se não estiver nela
        const pageMesas = document.getElementById('page-pedidos-mesa');
        if (pageMesas && !pageMesas.classList.contains('on')) {
          const navBtn = document.querySelector('[onclick*="pedidos-mesa"]');
          if (navBtn) navBtn.style.animation = 'pulse 1s ease 3';
        }
        // Imprime comanda da mesa — REMOVIDO: impressão agora é opcional no modal de pagamento
        // try { _printComandaMesa(mesaNum, p.new); } catch(e) { console.warn('[PRINT MESA]', e); }
      }

      // UPDATE → refresh cirúrgico de apenas a mesa afectada.
      // INSERT / DELETE → refresh completo (acontece raramente — criação/remoção de mesa).
      if (p.eventType === 'UPDATE' && p.new?.num) {
        await refreshMesa(p.new.num);
      } else {
        await refreshMesasState();
      }
      _renderMesaPageFromCache();
      if (typeof renderKanban === 'function') renderKanban();
      renderQR();
    }).subscribe();

  const chPrintJobs = sb.channel('print-jobs-rt')
    .on('postgres_changes', {event:'INSERT', schema:'public', table:'print_jobs'}, p => {
      _gestorImprimirJobCaixa(p.new).catch(e => console.warn('[PRINT JOB CAIXA]', e?.message || e));
    })
    .subscribe();

  const chConfig = sb.channel('store-config-rt')
    .on('postgres_changes', {event:'UPDATE', schema:'public', table:'store_config'}, p => {
      const cfg = p.new || {};
      if (Object.prototype.hasOwnProperty.call(cfg, 'store_open')) {
        const st = document.getElementById('status-txt');
        const open = cfg.store_open;
        if (st) {
          st.style.color = open ? 'var(--success)' : 'var(--danger)';
          st.textContent = open ? 'Online' : 'Offline';
        }
      }
      _applyStoreConfigUpdate(cfg);
    })
    .subscribe();

  const chEstoque = sb.channel('estoque-rt')
    .on('postgres_changes', {event:'*', schema:'public', table:'estoque'}, p => {
      const row = p.new || {};
      if (!row.id) return;
      const mapped = {
        id: row.id, name: row.name, unit: row.unit || 'un', qty: parseFloat(row.qty) || 0,
        min_qty: parseFloat(row.min_qty) || 0, custo: parseFloat(row.cost) || 0,
        updated_at: row.updated_at || null
      };
      const idx = estoqueItems.findIndex(e => e.id === mapped.id);
      if (idx >= 0) estoqueItems[idx] = mapped;
      else estoqueItems.push(mapped);
      if (typeof renderEstoque === 'function') renderEstoque();
      if (typeof estAtualizarDisponivel === 'function') estAtualizarDisponivel();
    })
    .on('postgres_changes', {event:'*', schema:'public', table:'estoque_receitas'}, p => {
      const row = p.new || {};
      if (!row.id) return;
      const mapped = {
        id: row.id, item_id: parseInt(row.item_id) || 0, estoque_id: parseInt(row.estoque_id) || 0,
        qty: parseFloat(row.qty) || 0, unit: row.unit || '',
        ativo: row.ativo !== false && row.ativo !== 0, updated_at: row.updated_at || null
      };
      const idx = estoqueReceitas.findIndex(r => r.id === mapped.id);
      if (idx >= 0) estoqueReceitas[idx] = mapped;
      else estoqueReceitas.push(mapped);
      if (typeof renderReceitaEstoque === 'function') renderReceitaEstoque();
    })
    .subscribe();

  // Heartbeat: mantém WS vivo em background (a cada 25s)
  _heartbeat = setInterval(() => {
    try { sb.channel('orders-rt').send({ type:'broadcast', event:'ping', payload:{} }); }
    catch(e){}
  }, 25000);

  _rtChannels = [chOrders, chMesas, chPrintJobs, chConfig, chEstoque];

  // ── Rádio garçom → gestor (push-to-talk via SSE) ──────────────
  _subscribeRadio();
  // ── SSE do servidor para pedidos PIX online ────────────────────
  _subscribeOrdersSSE();
}

// ══ RÁDIO GARÇOM ↔ GESTOR (push-to-talk + chat de áudios) ══════════════════
let _radioSSE = null;
let _radioPanelOpen = false;
let _radioUnread = 0;
let _radioGestorRec = null;
let _radioGestorStream = null;
let _radioGestorChunks = [];
let _radioGestorRecording = false;
let _radioGestorMaxTimer = null;

function _radioPickMimeType() {
  if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  const types = [
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/aac',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus'
  ];
  for (const type of types) {
    try { if (MediaRecorder.isTypeSupported(type)) return type; } catch {}
  }
  return '';
}

function _subscribeRadio() {
  if (_radioSSE) { try { _radioSSE.close(); } catch{} }
  const tid = _sessao?.tenant_id;
  if (!tid) return;

  _radioSSE = new EventSource(`/sse/radio-rt:${tid}`);
  _radioSSE.addEventListener('radio:msg', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (!data.audio) return;

      // Toca automaticamente
      const blob = _base64ToBlob(data.audio, data.audio_mime || 'audio/webm');
      _radioPlayBlob(blob, data.garcom_nome);

      showToast(
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M8 1a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 8 1z" stroke="currentColor" stroke-width="1.4"/><path d="M4 7v.5a4 4 0 0 0 8 0V7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
        `🎙️ ${data.garcom_nome}: mensagem de voz`
      );
      sendBrowserNotif(`🎙️ EstimaFone — ${data.garcom_nome}`, 'Mensagem de voz recebida');

      if (!_radioPanelOpen) {
        _radioUnread++;
        const badge = document.getElementById('radio-unread-badge');
        if (badge) { badge.style.display = 'flex'; badge.textContent = _radioUnread; }
      }
      if (_radioPanelOpen) _radioLoadMessages();
    } catch(err) { console.error('[RADIO] error:', err); }
  });

  _radioSSE.onerror = () => {
    _radioSSE?.close(); _radioSSE = null;
    setTimeout(() => _subscribeRadio(), 5000);
  };
}

// ══ SSE SERVIDOR → GESTOR (pedidos PIX online) ════════════════════════════
let _ordersSSE = null;

function _subscribeOrdersSSE() {
  if (_ordersSSE) { try { _ordersSSE.close(); } catch{} }
  const tid = _sessao?.tenant_id;
  if (!tid) return;

  _ordersSSE = new EventSource(`/sse/orders-rt:${tid}`);

  _ordersSSE.addEventListener('orders:INSERT', (e) => {
    try {
      const order = JSON.parse(e.data);
      if (!order || !order.id) return;
      // Este canal SSE é só um reforço para pagamento online (MP), que depende
      // de webhook e já tem proteção própria contra duplicidade (ver bloco
      // "idx !== -1 && pix_mp" abaixo). Todo o resto do fluxo de pedidos
      // (PIX manual, dinheiro, mesa, garçom, cartão presencial) já é tratado
      // por completo pelo canal principal (postgres_changes) — processar de
      // novo aqui só duplicava som, toast, auto-aceite e impressão.
      if (order.pag !== 'pix_mp' && order.pag !== 'cartao_mp') return;
      if (order.status === 'aguardando_cartao' || (order.status === 'aguardando_pix' && order.pag !== 'pix_manual')) {
        pendingOnlineOrders = [order, ...pendingOnlineOrders.filter(o => o.id !== order.id)];
        if (order.id > _maxKnownOrderId) { _maxKnownOrderId = order.id; _saveMaxKnownOrderId(); }
        if (typeof renderPendingPaymentsAlert === 'function') renderPendingPaymentsAlert();
        return;
      }
      if (order.status === 'entregue') return;
      const items = typeof order.items === 'string' ? (() => { try { return JSON.parse(order.items); } catch { return []; } })() : (order.items || []);
      if (order.status === 'mesa_aberta') {
        const mappedMesa = mapOrder({ ...order, items });
        _patchOrderInCache(mappedMesa);
        _renderMesaPageFromCache();
        renderKanban();
        return;
      }
      if (!ordersKanban.find(x => x.id === order.id)) {
        const mapped = mapOrder({ ...order, items });
        if (mapped.status === 'aguardando_pix') mapped._pixPendente = true;
        ordersKanban.unshift(mapped);
        if (order.id > _maxKnownOrderId) { _maxKnownOrderId = order.id; _saveMaxKnownOrderId(); }
        renderKanban();
        playOrderSound();
        if (!order.mesa_num) _startPersistentAlert();
        const nc = document.getElementById('notif-count');
        if (nc) { nc.style.display = 'flex'; nc.textContent = parseInt(nc.textContent || 0) + 1; }
        const itemsList = Array.isArray(items) ? items.map(i => `${i.qty}x ${i.name}`).join(', ') : '';
        showToast('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M8 2a5 5 0 0 1 5 5v3l1 2H2l1-2V7a5 5 0 0 1 5-5z" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1.4"/></svg>', `Novo pedido #${_orderNum(order.id, order.order_num)} - ${order.client}`);
        sendBrowserNotif(`Novo pedido #${_orderNum(order.id, order.order_num)}`, `${order.client} - ${itemsList}`);
        if (_autoAcceptOn && mapped.status === 'analise') setTimeout(() => advanceOrderById(order.id), 800);
        if ((window._printMode || _printMode) === 'auto') printOrder(mapped);
      }
    } catch(err) { console.error('[ORDERS-SSE INSERT] error:', err); }
  });

  _ordersSSE.addEventListener('orders:UPDATE', (e) => {
    try {
      const order = JSON.parse(e.data);
      if (!order || !order.id) return;
      // Mesmo motivo do handler de INSERT acima — só PIX/cartão online passam
      // por aqui; o resto já é coberto pelo canal principal.
      if (order.pag !== 'pix_mp' && order.pag !== 'cartao_mp') return;

      // FORÇA: PIX online (pix_mp) NUNCA pode ficar em análise. Sempre produção.
      if (order.pag === 'pix_mp' && order.status === 'analise') {
        order.status = 'producao';
        try {
          fetch('/api/order-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: order.id, new_status: 'producao', tenant_id: _sessao?.tenant_id })
          }).catch(()=>{});
        } catch(e) {}
      }

      const idx = ordersKanban.findIndex(x => x.id === order.id);

      // Pedido PIX online confirmado — ainda não está no kanban, entra agora
      // PIX online (pix_mp): vai direto para 'producao' (já confirmado pelo MP)
      // PIX manual (pix_manual) e legado (pix): continuam indo para 'analise' (precisam aceite)
      if (idx === -1 && (
            (order.status === 'producao' && order.pag === 'pix_mp') ||
            (order.status === 'analise' && (order.pag === 'pix_manual' || order.pag === 'pix' || order.pag === 'cartao_mp')) ||
            (order.status === 'aguardando_pix' && order.pag === 'pix_manual')
          )) {
        const items = typeof order.items === 'string' ? (() => { try { return JSON.parse(order.items); } catch { return []; } })() : (order.items || []);
        const mapped = mapOrder({ ...order, items });
        const isPixManualPendente = mapped._pixPendente === true;
        ordersKanban.unshift(mapped);
        renderKanban();
        playOrderSound();
        if (!order.mesa_num) _startPersistentAlert();
        const nc = document.getElementById('notif-count');
        if (nc) { nc.style.display = 'flex'; nc.textContent = parseInt(nc.textContent || 0) + 1; }
        const itemsList = Array.isArray(items) ? items.map(i => `${i.qty}x ${i.name}`).join(', ') : '';
        const tituloPagamento = order.pag === 'cartao_mp' ? 'Cartao aprovado!' : (isPixManualPendente ? 'PIX manual pendente!' : 'PIX confirmado!');
        const numPedido = _orderNum(order.id, order.order_num);
        showToast('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><rect x="1" y="4" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M1 7h14" stroke="currentColor" stroke-width="1.4"/></svg>', `${tituloPagamento} Pedido #${numPedido} — ${order.client}`);
        sendBrowserNotif(`${tituloPagamento} #${numPedido}`, `${order.client} — ${itemsList}`);
        // PIX online: pagamento já confirmado pelo MP, imprime automático sempre (independe do toggle/_printMode)
        // PIX manual: respeita _autoAcceptOn e _printMode normalmente
        if (order.pag === 'pix_mp') {
          printOrder(mapped);
        } else {
          if (_autoAcceptOn && !isPixManualPendente) setTimeout(() => advanceOrderById(order.id), 800);
          if ((window._printMode || _printMode) === 'auto' && !isPixManualPendente) printOrder(mapped);
        }
        return;
      }

      // Pedido já no kanban e virou pix_mp aprovado → garante produção e imprime
      if (idx !== -1 && order.pag === 'pix_mp' && (order.status === 'producao' || order.status === 'analise')) {
        const items = typeof order.items === 'string' ? (() => { try { return JSON.parse(order.items); } catch { return []; } })() : (order.items || []);
        const wasInAnaliseOrAguard = ordersKanban[idx].status === 'analise' || ordersKanban[idx].status === 'aguardando_pix';
        ordersKanban[idx] = mapOrder({ ...order, items, status: 'producao' });
        ordersKanban[idx].status = 'producao';
        renderKanban();
        if (wasInAnaliseOrAguard) {
          playOrderSound();
          printOrder(mapOrder({ ...order, items, status: 'producao' }));
        }
        return;
      }

      // Pedido já no kanban — atualiza
      if (idx !== -1) {
        const items = typeof order.items === 'string' ? (() => { try { return JSON.parse(order.items); } catch { return []; } })() : (order.items || []);
        // Remove do kanban só quando o pedido foi finalizado (ou cancelado).
        // 'entregue' continua visível na coluna para que o gestor clique em "Finalizar".
        // 'saiu' também continua visível (aparece na coluna Saiu pra entrega).
        if (['finalizado', 'cancelado'].includes(order.status)) {
          ordersKanban.splice(idx, 1);
        } else {
          ordersKanban[idx] = mapOrder({ ...order, items });
        }
        renderKanban();
      }
      if (order.mesa_num && typeof _patchOrderInCache === 'function') {
        const items = typeof order.items === 'string' ? (() => { try { return JSON.parse(order.items); } catch { return []; } })() : (order.items || []);
        _patchOrderInCache({ ...order, items });
        _renderMesaPageFromCache();
      }
    } catch(err) { console.error('[ORDERS-SSE] error:', err); }
  });

  _ordersSSE.addEventListener('store_config:UPDATE', (e) => {
    try {
      _applyStoreConfigUpdate(JSON.parse(e.data) || {});
    } catch(err) { console.error('[STORE-CONFIG-SSE] error:', err); }
  });

  _ordersSSE.onerror = () => {
    _ordersSSE?.close(); _ordersSSE = null;
    setTimeout(() => _subscribeOrdersSSE(), 5000);
  };
}

// ══ COMUNICADOS DO ADMIN → GESTOR ═══════════════════════
let _adminAnnouncements = [];
let _adminAnnouncementsSseTenant = null;
let _adminAnnouncementsSseAll = null;
let _adminAnnouncementsRefreshTimer = null;
let _adminAnnPopupDismissed = new Set();

function _adminAnnEscape(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function _adminAnnTipoLabel(tipo) {
  return ({ aviso:'Aviso', promocao:'Promo', alerta:'Alerta', novidade:'Novo' })[tipo] || 'Aviso';
}

function _adminAnnColor(value) {
  const s = String(value || '').trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : '';
}

function _adminAnnFont(value) {
  value = String(value || '').toLowerCase();
  return ({
    'outfit':'"Outfit", sans-serif',
    'dm-sans':'"DM Sans", sans-serif',
    'plus-jakarta':'"Plus Jakarta Sans", sans-serif',
    'inter':'"Inter", sans-serif',
    'system':'Arial, Helvetica, sans-serif',
    'serif':'Georgia, serif',
    'mono':'"Courier New", monospace'
  })[value] || '"Outfit", sans-serif';
}

function _adminAnnStyle(a) {
  const css = [`font-family:${_adminAnnFont(a.font_family)}!important`];
  const bg = _adminAnnColor(a.bg_color);
  const tx = _adminAnnColor(a.text_color) || '#ffffff';
  if (bg) css.push(`background:${bg}!important`);
  css.push(`color:${tx}!important`);
  return css.join(';');
}

function _adminAnnTextStyle(a) {
  const tx = _adminAnnColor(a.text_color) || '#ffffff';
  return `color:${tx}!important`;
}

function _renderAdminAnnouncements() {
  const el = document.getElementById('admin-announcements-strip');
  if (!el) return;
  const banners = _adminAnnouncements.filter(a => {
    const mode = String(a.display_mode || 'banner').toLowerCase();
    return mode === 'banner' || mode === 'both';
  });
  if (!banners.length) {
    el.classList.add('is-empty');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('is-empty');
  const visible = banners.slice(0, 3);
  el.innerHTML = visible.map(a => `
    <div class="admin-ann-card" data-tipo="${_adminAnnEscape(a.tipo || 'aviso')}" style="${_adminAnnEscape(_adminAnnStyle(a))}" title="${_adminAnnEscape((a.titulo ? a.titulo + ': ' : '') + a.mensagem)}">
      <span class="admin-ann-type" style="${_adminAnnEscape(_adminAnnTextStyle(a))}">${_adminAnnTipoLabel(a.tipo)}</span>
      <span class="admin-ann-text" style="${_adminAnnEscape(_adminAnnTextStyle(a))}">${a.titulo ? `<strong style="${_adminAnnEscape(_adminAnnTextStyle(a))}">${_adminAnnEscape(a.titulo)}</strong>` : ''}${_adminAnnEscape(a.mensagem || '')}</span>
    </div>
  `).join('') + (banners.length > visible.length ? `<span class="admin-ann-more">+${banners.length - visible.length}</span>` : '');
}

function _adminAnnPopupKey(a) {
  const tid = _sessao?.tenant_id || 'tenant';
  const ver = String(a.updated_at || a.created_at || '');
  return `admin_popup_seen:${tid}:${a.id}:${ver}`;
}

function _adminAnnPopupSeen(a) {
  return _adminAnnPopupDismissed.has(_adminAnnPopupKey(a));
}

function fecharAdminAnnouncementPopup() {
  const el = document.getElementById('admin-ann-popup');
  const id = el?.dataset?.alertId;
  const alert = _adminAnnouncements.find(a => String(a.id) === String(id));
  if (alert) {
    _adminAnnPopupDismissed.add(_adminAnnPopupKey(alert));
  }
  el?.remove();
}

function _renderAdminAnnouncementPopup() {
  const popup = _adminAnnouncements.find(a => {
    const mode = String(a.display_mode || 'banner').toLowerCase();
    return (mode === 'popup' || mode === 'both') && !_adminAnnPopupSeen(a);
  });
  const current = document.getElementById('admin-ann-popup');
  if (!popup) { current?.remove(); return; }
  if (current?.dataset?.alertId === String(popup.id)) return;
  current?.remove();

  const bg = _adminAnnColor(popup.bg_color) || '#0ea5e9';
  const tx = _adminAnnColor(popup.text_color) || '#ffffff';
  const font = _adminAnnFont(popup.font_family);
  const wrap = document.createElement('div');
  wrap.id = 'admin-ann-popup';
  wrap.dataset.alertId = String(popup.id);
  wrap.style.cssText = 'position:fixed;inset:0;z-index:10090;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(15,23,42,.62);backdrop-filter:blur(7px)';
  wrap.innerHTML = `
    <div style="width:min(540px,94vw);max-height:min(86vh,760px);display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:22px;box-shadow:0 28px 90px rgba(2,6,23,.48);overflow:hidden;font-family:${font}">
      <div style="position:relative;padding:22px 24px 20px;background:${bg};color:${tx};flex-shrink:0">
        <button type="button" id="admin-ann-popup-close" aria-label="Fechar comunicado" style="position:absolute;right:14px;top:14px;width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.38);background:rgba(255,255,255,.16);color:${tx};cursor:pointer;font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center">x</button>
        <div style="display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.32);background:rgba(255,255,255,.14);border-radius:999px;padding:6px 10px;font-size:11px;font-weight:900;text-transform:uppercase;margin-bottom:14px;color:${tx}">
          ${_adminAnnEscape(_adminAnnTipoLabel(popup.tipo))}
        </div>
        <div style="font-size:24px;font-weight:900;line-height:1.12;padding-right:42px;color:${tx}">${_adminAnnEscape(popup.titulo || 'Comunicado')}</div>
      </div>
      <div style="padding:22px 24px 24px;background:var(--surface);color:var(--text);overflow:auto">
        <div style="font-size:15px;line-height:1.58;color:var(--text);white-space:pre-wrap">${_adminAnnEscape(popup.mensagem || '')}</div>
        <div style="display:flex;justify-content:flex-end;margin-top:22px">
          <button type="button" id="admin-ann-popup-ok" class="btn bp" style="min-width:120px;justify-content:center">Entendi</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  document.getElementById('admin-ann-popup-close')?.addEventListener('click', fecharAdminAnnouncementPopup);
  document.getElementById('admin-ann-popup-ok')?.addEventListener('click', fecharAdminAnnouncementPopup);
  wrap.addEventListener('click', e => { if (e.target === wrap) fecharAdminAnnouncementPopup(); });
}

async function carregarAdminAnnouncementsGestor() {
  const tid = _sessao?.tenant_id;
  if (!tid) return;
  try {
    const r = await fetch('/api/gestor/comunicados', { headers: { 'x-tenant-id': tid } });
    const rows = r.ok ? await r.json() : [];
    _adminAnnouncements = Array.isArray(rows) ? rows : [];
    _renderAdminAnnouncements();
    _renderAdminAnnouncementPopup();
  } catch(e) {
    console.warn('[admin-alerts] erro:', e?.message || e);
  }
}

function _scheduleAdminAnnouncementsRefresh() {
  clearTimeout(_adminAnnouncementsRefreshTimer);
  _adminAnnouncementsRefreshTimer = setTimeout(carregarAdminAnnouncementsGestor, 180);
}

function _subscribeAdminAnnouncements() {
  const tid = _sessao?.tenant_id;
  if (!tid) return;
  try { _adminAnnouncementsSseTenant?.close(); } catch {}
  try { _adminAnnouncementsSseAll?.close(); } catch {}
  _adminAnnouncementsSseTenant = new EventSource(`/sse/admin-alerts:${tid}`);
  _adminAnnouncementsSseAll = new EventSource('/sse/admin-alerts:all');
  const onRefresh = () => _scheduleAdminAnnouncementsRefresh();
  _adminAnnouncementsSseTenant.addEventListener('admin_alerts:REFRESH', onRefresh);
  _adminAnnouncementsSseAll.addEventListener('admin_alerts:REFRESH', onRefresh);
  _adminAnnouncementsSseTenant.onerror = () => {
    try { _adminAnnouncementsSseTenant.close(); } catch {}
    _adminAnnouncementsSseTenant = null;
    setTimeout(_subscribeAdminAnnouncements, 5000);
  };
  _adminAnnouncementsSseAll.onerror = () => {
    try { _adminAnnouncementsSseAll.close(); } catch {}
    _adminAnnouncementsSseAll = null;
    setTimeout(_subscribeAdminAnnouncements, 5000);
  };
}

function initAdminAnnouncementsGestor() {
  carregarAdminAnnouncementsGestor();
  _subscribeAdminAnnouncements();
}

function _base64ToBlob(b64, mime) {
  const bin = atob(b64); const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: mime });
}

function _radioPlayBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.volume = 1.0;
  audio.onended = () => URL.revokeObjectURL(url);
  audio.onerror = () => {
    URL.revokeObjectURL(url);
    sbToast('err', 'Nao foi possivel reproduzir este audio neste navegador');
  };
  const playPromise = audio.play();
  if (playPromise?.catch) {
    playPromise.catch(() => {
      audio.onended = null;
      audio.onerror = null;
      _radioShowManualPlay(url, nome || 'Audio');
    });
  }
}

function _radioShowManualPlay(url, nome) {
  const el = document.getElementById('radio-manual-banner');
  if (el) el.remove();
  const d = document.createElement('div'); d.id = 'radio-manual-banner';
  d.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:9999;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;padding:10px 20px;border-radius:12px;cursor:pointer;font-family:"DM Sans",sans-serif;font-size:13px;font-weight:700;box-shadow:0 4px 20px rgba(0,0,0,.3);display:flex;align-items:center;gap:8px';
  d.textContent = `Audio de ${nome || 'EstimaFone'} - clique para ouvir`;
  let used = false;
  d.onclick = () => {
    used = true;
    const audio = new Audio(url);
    audio.volume = 1.0;
    audio.onended = () => URL.revokeObjectURL(url);
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      sbToast('err', 'Nao foi possivel reproduzir este audio neste navegador');
    };
    audio.play().catch(() => {
      URL.revokeObjectURL(url);
      sbToast('err', 'Nao foi possivel reproduzir este audio neste navegador');
    });
    d.remove();
  };
  document.body.appendChild(d);
  setTimeout(() => {
    if (!used) URL.revokeObjectURL(url);
    d.remove();
  }, 15000);
}

// ── Painel do gestor ─────────────────────────────────────
async function radioTogglePanelGestor() {
  const panel = document.getElementById('radio-panel-gestor');
  if (_radioPanelOpen) { panel.style.display = 'none'; _radioPanelOpen = false; return; }
  panel.style.display = 'flex';
  _radioPanelOpen = true;
  _radioUnread = 0;
  const badge = document.getElementById('radio-unread-badge');
  if (badge) badge.style.display = 'none';

  try {
    const tid = _sessao?.tenant_id;
    const res = await fetch('/api/radio/garcons', { headers: { 'x-tenant-id': tid } });
    const garcons = await res.json();
    const sel = document.getElementById('radio-gestor-dest');
    sel.innerHTML = '<option value="" disabled selected>Selecionar destino...</option>'
      + garcons.map(g => `<option value="${g.id}">${g.nome}</option>`).join('');
  } catch {}
  _radioLoadMessages();
}

async function _radioLoadMessages() {
  const tid = _sessao?.tenant_id; if (!tid) return;
  try {
    const res = await fetch(`/api/radio/messages?user_id=gestor`, { headers: { 'x-tenant-id': tid } });
    const msgs = await res.json();
    const c = document.getElementById('radio-gestor-msgs');
    if (!msgs.length) { c.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:30px">Nenhuma mensagem nas últimas 10h</div>'; return; }
    c.innerHTML = msgs.reverse().map(m => {
      const isMe = m.from_id === 'gestor';
      const time = new Date(m.created_at+'Z').toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
      const align = isMe ? 'flex-end' : 'flex-start';
      const bg = isMe ? 'rgba(99,102,241,.12)' : 'var(--surface2)';
      const brd = isMe ? 'rgba(99,102,241,.25)' : 'var(--border)';
      const lbl = isMe ? `Você → ${_radioDestNome(m.to_id)}` : m.from_nome;
      return `<div style="align-self:${align};max-width:85%;background:${bg};border:1px solid ${brd};border-radius:12px;padding:8px 12px">
        <div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:4px">${lbl} · ${time}</div>
        <button onclick="_radioPlayMsg(${m.id})" style="display:flex;align-items:center;gap:6px;background:none;border:none;color:var(--text);cursor:pointer;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;padding:0">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><polygon points="4,2 14,8 4,14" fill="currentColor"/></svg> Reproduzir
        </button>
      </div>`;
    }).join('');
    c.scrollTop = c.scrollHeight;
  } catch(e) { console.error('[RADIO] load:', e); }
}

function _radioDestNome(id) {
  if (id === 'gestor') return 'Gestor';
  const s = document.getElementById('radio-gestor-dest');
  if (s) for (const o of s.options) if (o.value === String(id)) return o.textContent;
  return `Garçom #${id}`;
}

async function _radioPlayMsg(id) {
  try {
    const res = await fetch(`/api/radio/audio/${id}`, { headers: { 'x-tenant-id': _sessao?.tenant_id } });
    const d = await res.json(); if (!d.audio) return;
    const blob = _base64ToBlob(d.audio, d.audio_mime || 'audio/webm');
    _radioPlayBlob(blob, 'EstimaFone');
  } catch { sbToast('err', 'Erro ao reproduzir'); }
}

// ── Gravação do gestor ───────────────────────────────────
async function _radioGestorStartRec() {
  const destId = document.getElementById('radio-gestor-dest')?.value;
  if (!destId) { sbToast('err', 'Selecione um garçom primeiro'); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    sbToast('err', 'Gravacao de audio nao suportada neste navegador');
    return;
  }
  if (_radioGestorRecording) { _radioGestorStopRec(); return; }
  _radioGestorRecording = true;
  const btn = document.getElementById('radio-gestor-rec-btn');
  btn.style.borderColor = '#ef4444';
  btn.style.background = 'rgba(239,68,68,.15)';
  btn.style.color = '#ef4444';
  btn.title = 'Gravando... clique novamente para enviar';
  try {
    _radioGestorStream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true }});
    _radioGestorChunks = [];
    const preferredMime = _radioPickMimeType();
    _radioGestorRec = preferredMime
      ? new MediaRecorder(_radioGestorStream, { mimeType: preferredMime })
      : new MediaRecorder(_radioGestorStream);
    const recMime = _radioGestorRec.mimeType || preferredMime || 'audio/webm';
    _radioGestorRec.ondataavailable = e => { if(e.data.size>0) _radioGestorChunks.push(e.data); };
    _radioGestorRec.onstop = async () => {
      _radioGestorStream?.getTracks().forEach(t=>t.stop()); _radioGestorStream=null;
      _radioGestorRecording=false;
      clearTimeout(_radioGestorMaxTimer); _radioGestorMaxTimer = null;
      btn.style.borderColor=''; btn.style.background=''; btn.style.color='';
      btn.title = 'Gravar e enviar';
      if(!_radioGestorChunks.length)return;
      const blob=new Blob(_radioGestorChunks,{type:recMime}); if(blob.size<500)return;
      const r=new FileReader();
      r.onloadend=async()=>{
        const b64=r.result.split(',')[1];
        try{
          const res = await fetch('/api/radio/send',{method:'POST',headers:{'Content-Type':'application/json','x-tenant-id':_sessao?.tenant_id},
            body:JSON.stringify({audio:b64,audio_mime:blob.type||recMime,garcom_nome:'Gestor',garcom_id:null,destino:destId})});
          const data = await res.json().catch(()=>({}));
          if(!res.ok) throw new Error(data.error || 'Erro ao enviar');
          sbToast('ok','🎙️ Áudio enviado!');
          if(_radioPanelOpen) _radioLoadMessages();
        }catch(e){ sbToast('err', e.message || 'Erro ao enviar'); }
      };
      r.readAsDataURL(blob);
    };
    _radioGestorRec.start();
    clearTimeout(_radioGestorMaxTimer);
    _radioGestorMaxTimer = setTimeout(() => _radioGestorStopRec(), 10000);
  } catch(e) {
    sbToast('err','Permita o microfone'); _radioGestorRecording=false;
    clearTimeout(_radioGestorMaxTimer); _radioGestorMaxTimer = null;
    _radioGestorStream?.getTracks().forEach(t=>t.stop()); _radioGestorStream=null;
    btn.style.borderColor=''; btn.style.background=''; btn.style.color='';
    btn.title = 'Gravar e enviar';
  }
}
function _radioGestorStopRec() {
  clearTimeout(_radioGestorMaxTimer); _radioGestorMaxTimer = null;
  if(_radioGestorRec?.state==='recording') _radioGestorRec.stop();
}

// ── Timer de atualização do tempo decorrido por mesa (a cada 60s) ──────
setInterval(() => {
  // Só atualiza se a aba de mesas estiver visível
  const pg = document.getElementById('page-pedidos-mesa');
  if (pg && pg.classList.contains('on') && tables.some(t => t.status !== 'free')) {
    _renderMesaPageFromCache();
  }
}, 60000);

// Sync ao voltar para a aba
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (billingIsLocked()) {
      billingApplyLockUI();
      return;
    }
    loadAllData(true);
    if (!_rtConnected) subscribeOrders();
  }
});

// Polling de 12s — só re-renderiza se houver mudança real no banco
let _lastPollHash = '';
// Rastreia o maior ID visto — para detectar novos pedidos. Persistido em
// localStorage por tenant pra sobreviver entre fechar/abrir o gestor. Sem isso,
// reabrir o gestor zerava esse contador e fazia o polling tratar pedidos
// antigos (já entregues) como novos, disparando reimpressão de comandas.
const _maxKnownStorageKey = () => `_maxKnownOrderId:${_sessao?.tenant_id || 'anon'}`;
let _maxKnownOrderId = (() => {
  try { return parseInt(localStorage.getItem(_maxKnownStorageKey()) || '0') || 0; }
  catch { return 0; }
})();
function _saveMaxKnownOrderId() {
  try { localStorage.setItem(_maxKnownStorageKey(), String(_maxKnownOrderId)); }
  catch {}
}

// ── Polling principal do kanban — roda a cada 5s ───────
// Garante que pedidos do garçom e do cardápio cheguem
// mesmo que o SSE falhe ou tenha problemas de canal
setInterval(async () => {
  if (document.visibilityState !== 'visible') return;
  if (billingIsLocked()) {
    billingApplyLockUI();
    return;
  }

  try {
    // 1. Busca pedidos novos (ID maior que o último conhecido)
    // Roda sempre — incluindo quando _maxKnownOrderId = 0 (ex: gestor abre com kanban vazio
    // e um pedido do cardápio chega antes do SSE estabilizar ou antes do próximo loadAllData)
    {
      const q = sb.from('orders')
        .select('*')
        .in('status', ['aguardando_pix','aguardando_cartao','analise','producao','pronto','saiu','entregue'])
        .order('id', {ascending:false});
      // Quando _maxKnownOrderId > 0 usa filtro eficiente; quando 0 varre todos os ativos
      if (_maxKnownOrderId > 0) q.gt('id', _maxKnownOrderId);
      const { data: novos } = await q;

      if (novos?.length) {
        let houveMudanca = false;
        for (const o of novos) {
          if (!ordersKanban.find(x => x.id === o.id)) {
            // PIX online Mercado Pago ainda nao pago: nao entra no gestor, nao alerta e nao imprime.
            // Ele aparece quando o MP confirmar e o servidor mudar para status='producao', pag='pix_mp'.
            if (o.status === 'aguardando_cartao' || (o.status === 'aguardando_pix' && o.pag !== 'pix_manual')) {
              pendingOnlineOrders = [o, ...pendingOnlineOrders.filter(p => p.id !== o.id)];
              if (typeof renderPendingPaymentsAlert === 'function') renderPendingPaymentsAlert();
              if (o.id > _maxKnownOrderId) _maxKnownOrderId = o.id;
              continue;
            }
            // Pedidos de mesa que acabaram de ser pagos (entregue) não devem entrar no kanban
            // nem disparar notificação — são comandas finalizadas, não pedidos novos
            if (o.status === 'entregue' && o.mesa_num) { if (o.id > _maxKnownOrderId) _maxKnownOrderId = o.id; continue; }
            if (window._pdvCreatedIds && window._pdvCreatedIds.has(Number(o.id))) { window._pdvCreatedIds.delete(Number(o.id)); ordersKanban.unshift(mapOrder(o)); if (o.id > _maxKnownOrderId) _maxKnownOrderId = o.id; continue; }
            ordersKanban.unshift(mapOrder(o));
            houveMudanca = true;
            // ── Detecta se o pedido já estava em estado avançado quando entrou ──
            // Se o status é 'pronto', 'saiu' ou 'entregue', significa que o pedido
            // já foi processado (gestor fechou e reabriu o painel). NÃO imprime,
            // NÃO toca som, NÃO mostra toast — só adiciona silenciosamente ao kanban.
            // Antes esse caso disparava print/som/toast, fazendo a comanda ser
            // reimpressa toda vez que o gestor abria o gestor.
            const _jaProcessado = ['pronto','saiu','entregue'].includes(o.status);
            if (_jaProcessado) {
              if (o.id > _maxKnownOrderId) _maxKnownOrderId = o.id;
              continue;
            }
            // Notifica como novo pedido
            playOrderSound();
            if (!o.mesa_num) _startPersistentAlert();
            const nc = document.getElementById('notif-count');
            if (nc) { nc.style.display='flex'; nc.textContent = parseInt(nc.textContent||0)+1; }
            const items = Array.isArray(o.items) ? o.items.map(i=>`${i.qty}x ${i.name}`).join(', ') : '';
            showToast('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M8 2a5 5 0 0 1 5 5v3l1 2H2l1-2V7a5 5 0 0 1 5-5z" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1.4"/></svg>', `Novo pedido #${_orderNum(o.id, o.order_num)} — ${o.client}`);
            sendBrowserNotif(`Novo pedido #${_orderNum(o.id, o.order_num)}`, `${o.client} — ${items}`);
            if (_autoAcceptOn && o.status === 'analise') setTimeout(() => advanceOrderById(o.id), 800);
            if ((window._printMode || _printMode) === 'auto' && !(o.status === 'aguardando_pix' && o.pag !== 'pix_manual')) printOrder(mapOrder(o));
            // Atualiza cache mesa se for pedido de mesa
            if (o.mesa_num) { _patchOrderInCache(o); _renderMesaPageFromCache(); }
          }
          if (o.id > _maxKnownOrderId) _maxKnownOrderId = o.id;
        }
        if (houveMudanca) renderKanban();
        _saveMaxKnownOrderId();
      }
    }

    // 2. Verifica mudanças de status nos pedidos já no kanban
    if (ordersKanban.length) {
      const ids = ordersKanban.map(o => o.id);
      const { data: atuais } = await sb.from('orders')
        .select('id,status,pag')
        .in('id', ids.slice(0, 50)); // limita para não sobrecarregar

      if (atuais?.length) {
        let houveMudanca = false;
        for (const a of atuais) {
          const idx = ordersKanban.findIndex(x => x.id === a.id);
          if (idx !== -1) {
            // Usa _statusReal para comparar — pedidos pix_manual têm status='analise' no kanban
            // mas 'aguardando_pix' no banco, então não devem ser removidos por isso
            const statusNoCanban = ordersKanban[idx]._statusReal || ordersKanban[idx].status;
            const pagNoKanban = ordersKanban[idx].pag || '';
            const pagAtual = a.pag || '';
            if (statusNoCanban !== a.status || pagNoKanban !== pagAtual) {
              if (['finalizado','cancelado'].includes(a.status)) {
                // finalizado/cancelado → remove do kanban
                ordersKanban.splice(idx, 1);
              } else if (a.status === 'entregue') {
                // entregue não aparece no kanban → remove (mesa, delivery, balcão, açougue)
                ordersKanban.splice(idx, 1);
              } else if (a.status === 'aguardando_pix') {
                ordersKanban[idx].pag = pagAtual;
                ordersKanban[idx]._statusReal = a.status;
                ordersKanban[idx]._pixPendente = pagAtual === 'pix_manual';
                ordersKanban[idx].status = pagAtual === 'pix_manual' ? 'analise' : 'aguardando_pix';
                // continua como analise no kanban — é pix_manual pendente
              } else {
                // analise/producao/pronto/saiu → atualiza e mantém visível
                ordersKanban[idx].status   = a.status;
                ordersKanban[idx]._statusReal = a.status;
                ordersKanban[idx]._pixPendente = false;
                ordersKanban[idx].pag = pagAtual;
              }
              houveMudanca = true;
            }
          }
        }
        if (houveMudanca) renderKanban();
      }
    }

    // 3. Polling de mesas (página de mesas aberta)
    const pg = document.getElementById('page-pedidos-mesa');
    if (pg?.classList.contains('on')) {
      const { data } = await sb.from('orders')
        .select('id,status,mesa_num')
        .not('mesa_num', 'is', null)
        .in('status', ['analise','producao','pronto','mesa_aberta'])
        .order('id');
      const hash = JSON.stringify((data||[]).map(o => o.id + o.status));
      if (hash !== _lastPollHash) {
        _lastPollHash = hash;
        renderMesasPage();
      }
    }

    // 4. Reconecta SSE se perdeu conexão
    if (!_rtConnected) subscribeOrders();

  } catch(e) { /* polling silencioso */ }
}, 5000);

// Registra SW e pede permissão de notificação ao carregar
if (!billingIsLocked()) {
  requestNotifPermission();
  registerSW();
  initAdminAnnouncementsGestor();
} else {
  billingApplyLockUI();
}

// ── Generic toast for Supabase ops ───────────────────
const _ICON_OK  = `<svg width='13' height='13' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'><circle cx='8' cy='8' r='6' stroke='currentColor' stroke-width='1.4'/><path d='M5.5 8l2 2 3-3' stroke='currentColor' stroke-width='1.4' stroke-linecap='round'/></svg>`;
const _ICON_ERR = `<svg width='13' height='13' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'><path d='M8 2L14 13H2L8 2z' stroke='currentColor' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/><path d='M8 6v3' stroke='currentColor' stroke-width='1.4' stroke-linecap='round'/><circle cx='8' cy='11' r='.6' fill='currentColor'/></svg>`;
const _ICON_SAV = `<svg width='13' height='13' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'><path d='M3 2h8l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z' stroke='currentColor' stroke-width='1.4'/><path d='M5 2v5h6V2' stroke='currentColor' stroke-width='1.4' stroke-linecap='round'/></svg>`;
const _ICON_TRS = `<svg width='13' height='13' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'><path d='M3 4h10M6 4V2.5A.5 0 0 1 6.5 2h3a.5 0 0 1 .5.5V4M5 4l.7 9.5a.5 0 0 0 .5.5h3.6a.5 0 0 0 .5-.5L11 4' stroke='currentColor' stroke-width='1.4' stroke-linecap='round'/></svg>`;
const _ICON_IMG = `<svg width='13' height='13' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'><rect x='2' y='3' width='12' height='10' rx='1.5' stroke='currentColor' stroke-width='1.4'/><circle cx='6' cy='7' r='1.5' stroke='currentColor' stroke-width='1.4'/><path d='M2 11l3.5-3.5 2 2 3-4 3.5 5.5' stroke='currentColor' stroke-width='1.4' stroke-linecap='round'/></svg>`;

function sbToast(type, msg) {
  showToast(type === 'ok' ? _ICON_OK : _ICON_ERR, msg);
}

// ── Bloqueio de recurso por plano ─────────────────────
function _toastUpgradePlano() {
  // Remove modal anterior se existir
  const existing = document.getElementById('upgrade-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'upgrade-modal-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    background:rgba(0,0,0,.65);
    backdrop-filter:blur(6px);
    display:flex;align-items:center;justify-content:center;
    animation:fadeInBg .2s ease;
  `;

  overlay.innerHTML = `
    <div style="
      background:linear-gradient(145deg,#1a1d2b,#1e2235);
      border:1px solid rgba(139,92,246,.35);
      border-radius:20px;
      padding:36px 32px;
      width:380px;max-width:92vw;
      box-shadow:0 32px 80px rgba(0,0,0,.7),0 0 0 1px rgba(139,92,246,.15),inset 0 1px 0 rgba(255,255,255,.06);
      animation:slideUpModal .28s cubic-bezier(.34,1.56,.64,1);
      text-align:center;
      position:relative;
    ">
      <!-- Ícone glow -->
      <div style="
        width:72px;height:72px;border-radius:20px;
        background:linear-gradient(135deg,#7c3aed,#4f46e5);
        display:flex;align-items:center;justify-content:center;
        font-size:34px;margin:0 auto 20px;
        box-shadow:0 8px 28px rgba(124,58,237,.45);
      "><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l2 5h5l-4 3 1.5 5L8 11l-4.5 3L5 9 1 6h5z"/></svg></div>

      <!-- Título -->
      <div style="font-family:'Playfair Display',sans-serif;font-size:20px;font-weight:800;margin-bottom:8px;letter-spacing:-.3px;">
        Recurso exclusivo Premium
      </div>
      <div style="font-size:13px;color:rgba(255,255,255,.55);margin-bottom:24px;line-height:1.6;">
        O <strong style="color:rgba(255,255,255,.85)">Robô IA</strong> está disponível apenas no plano<br>
        <strong style="color:#a78bfa">Premium</strong>. Faça upgrade para automatizar<br>
        seus atendimentos via WhatsApp.
      </div>

      <!-- Comparativo -->
      <div style="
        display:grid;grid-template-columns:1fr 1fr;gap:10px;
        margin-bottom:24px;
      ">
        <div style="
          background:rgba(255,255,255,.04);
          border:1px solid rgba(255,255,255,.08);
          border-radius:12px;padding:14px 12px;
        ">
          <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.35);letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px;">Plano Pro</div>
          <div style="font-size:12px;color:rgba(255,255,255,.5);line-height:1.8;">
            Pedidos<br>
            Cardápio<br>
            Mesas & PDV<br>
            <span style="opacity:.4">Robô WhatsApp</span>
          </div>
        </div>
        <div style="
          background:linear-gradient(135deg,rgba(124,58,237,.12),rgba(79,70,229,.08));
          border:1px solid rgba(139,92,246,.3);
          border-radius:12px;padding:14px 12px;
          position:relative;overflow:hidden;
        ">
          <div style="
            position:absolute;top:8px;right:8px;
            background:linear-gradient(135deg,#7c3aed,#4f46e5);
            font-size:9px;font-weight:800;color:#fff;
            padding:2px 7px;border-radius:99px;letter-spacing:.4px;
          ">ATUAL</div>
          <div style="font-size:11px;font-weight:700;color:#a78bfa;letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px;">⭐ Premium</div>
          <div style="font-size:12px;color:rgba(255,255,255,.7);line-height:1.8;">
            Pedidos<br>
            Cardápio<br>
            Mesas & PDV<br>
            <strong style="color:#a78bfa">Robô WhatsApp</strong>
          </div>
        </div>
      </div>

      <!-- Botões -->
      <button onclick="
        document.getElementById('upgrade-modal-overlay').remove();
        window.open('https://wa.me/5585989042222?text=Quero+fazer+upgrade+para+o+plano+Premium','_blank');
      " style="
        width:100%;padding:13px;border-radius:11px;border:none;cursor:pointer;
        background:linear-gradient(135deg,#7c3aed,#4f46e5);
        color:#fff;font-family:'Playfair Display',sans-serif;font-size:14px;font-weight:800;
        box-shadow:0 6px 20px rgba(124,58,237,.45);
        transition:transform .15s,box-shadow .15s;
        margin-bottom:10px;
        letter-spacing:-.2px;
      "
      onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 10px 28px rgba(124,58,237,.6)'"
      onmouseout="this.style.transform='';this.style.boxShadow='0 6px 20px rgba(124,58,237,.45)'"
      >
        Fazer Upgrade para Premium
      </button>
      <button onclick="document.getElementById('upgrade-modal-overlay').remove()" style="
        width:100%;padding:10px;border-radius:11px;border:1px solid rgba(255,255,255,.1);
        background:transparent;color:rgba(255,255,255,.45);
        font-family:'DM Sans',sans-serif;font-size:13px;cursor:pointer;
        transition:all .15s;
      "
      onmouseover="this.style.color='rgba(255,255,255,.7)';this.style.borderColor='rgba(255,255,255,.2)'"
      onmouseout="this.style.color='rgba(255,255,255,.45)';this.style.borderColor='rgba(255,255,255,.1)'"
      >
        Agora não
      </button>
    </div>
  `;

  // Fechar ao clicar fora
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Adiciona animações CSS se ainda não existirem
  if (!document.getElementById('upgrade-modal-styles')) {
    const style = document.createElement('style');
    style.id = 'upgrade-modal-styles';
    style.textContent = `
      @keyframes fadeInBg { from{opacity:0} to{opacity:1} }
      @keyframes slideUpModal { from{opacity:0;transform:translateY(24px) scale(.95)} to{opacity:1;transform:none} }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(overlay);
}


// ── Image upload (Supabase Storage) ──────────────────
// ── New item image preview ────────────────────
let _newItemImageFile = null;
// ── Image Gallery inline ───────────────────────────────
let _newItemImageUrl  = null;
let _editItemImageUrl = null;
let _imgGalleryCache  = null; // cache da sessão

async function loadImgGallery(prefix) {
  const el = document.getElementById(`${prefix}-img-gallery`);
  if (!el) return;

  // Usa cache se já carregou nessa sessão
  if (_imgGalleryCache) { _renderImgGallery(el, prefix, _imgGalleryCache); return; }

  el.innerHTML = '<span style="font-size:11.5px;color:var(--muted)">Carregando...</span>';
  try {
    const { data, error } = await sb.from('menu_items')
      .select('image_url')
      .not('image_url', 'is', null);
    if (error) throw error;
    const urls = [...new Set((data || []).map(r => r.image_url).filter(Boolean))];
    _imgGalleryCache = urls;
    _renderImgGallery(el, prefix, urls);
  } catch(e) {
    el.innerHTML = '<span style="font-size:11.5px;color:var(--muted)">Nenhuma imagem ainda.</span>';
  }
}

function _renderImgGallery(el, prefix, urls) {
  if (!urls.length) {
    el.innerHTML = '<span style="font-size:11.5px;color:var(--muted)">Nenhuma imagem ainda.</span>';
    return;
  }
  el.innerHTML = urls.map(url =>
    `<div onclick="selectGalleryImg('${prefix}','${url.replace(/'/g,'%27')}')"
      style="flex-shrink:0;width:52px;height:52px;border-radius:8px;overflow:hidden;border:2px solid var(--border);cursor:pointer;transition:border-color .15s"
      onmouseenter="this.style.borderColor='var(--accent)'"
      onmouseleave="this.style.borderColor='var(--border)'"
      title="Reutilizar esta imagem">
      <img src="${url}" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy"
           onerror="this.closest('div').style.display='none'">
    </div>`
  ).join('');
}

function selectGalleryImg(prefix, url) {
  const thumb   = document.getElementById(`${prefix}-img-thumb`);
  const ph      = document.getElementById(`${prefix}-img-placeholder`);
  const chg     = document.getElementById(`${prefix}-img-change`);
  const preview = document.getElementById(`${prefix}-img-preview`);
  thumb.src = url; thumb.style.display = 'block';
  if (ph)  ph.style.display  = 'none';
  if (chg) chg.style.display = 'block';
  if (preview) preview.style.border = '2px solid var(--accent)';
  if (prefix === 'new') { _newItemImageFile = null;  _newItemImageUrl  = url; }
  else                  { _editItemImageFile = null; _editItemImageUrl = url; }
}

// Invalida cache após upload para incluir a nova imagem
function _invalidateImgGalleryCache() { _imgGalleryCache = null; }
// ───────────────────────────────────────────────────────

function triggerNewItemImage()  { document.getElementById('new-img-input').click();  }
function triggerEditItemImage() { document.getElementById('edit-img-input').click(); }

function previewNewItemImage(inp) {
  const file = inp.files[0];
  if (!file) return;
  _newItemImageFile = file;
  _newItemImageUrl  = null;
  const url = URL.createObjectURL(file);
  const thumb = document.getElementById('new-img-thumb');
  thumb.src = url; thumb.style.display = 'block';
  document.getElementById('new-img-placeholder').style.display = 'none';
  document.getElementById('new-img-change').style.display = 'block';
  document.getElementById('new-img-preview').style.border = '2px solid var(--accent)';
}

// ── Edit item image preview ────────────────────
let _editItemImageFile = null;
function previewEditItemImage(inp) {
  const file = inp.files[0];
  if (!file) return;
  _editItemImageFile = file;
  _editItemImageUrl  = null;
  const url = URL.createObjectURL(file);
  const thumb = document.getElementById('edit-img-thumb');
  thumb.src = url; thumb.style.display = 'block';
  document.getElementById('edit-img-placeholder').style.display = 'none';
  document.getElementById('edit-img-change').style.display = 'block';
  document.getElementById('edit-img-preview').style.border = '2px solid var(--accent)';
}

// ── Upload image to Supabase Storage ─────────
async function uploadItemImage(file, itemId) {
  if (file.size > 2 * 1024 * 1024) throw new Error('Imagem muito grande. Use uma imagem de até 2MB.');
  const extFromType = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
  };
  const ext = extFromType[file.type] || (String(file.name || '').split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const safeItem = String(itemId || 'novo').replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = `menu-items/${safeItem}-${Date.now()}.${ext}`;
  const bucket = sb.storage.from('menu-images');
  const { data, error } = await bucket.upload(filePath, file, { upsert: true });
  if (error) throw new Error(error.message || error.error || 'Falha ao enviar imagem');
  const publicUrl = data?.publicUrl || data?.url || bucket.getPublicUrl(filePath).data.publicUrl;
  if (!publicUrl) throw new Error('Upload sem URL pública');
  _invalidateImgGalleryCache(); // nova imagem disponível na galeria
  return publicUrl;
}

function triggerImageUpload(itemId, itemName) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/jpeg,image/jpg,image/png,image/webp';
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.click();
  inp.onchange = async () => {
    const file = inp.files[0];
    if (!file) return;
    document.body.removeChild(inp);
    sbLoading(true);
    try {
      const publicUrl = await uploadItemImage(file, itemId);
      if (itemId) {
        await sb.from('menu_items').update({image_url: publicUrl}).eq('id', itemId);
        const it = items.find(i => i.id === itemId);
        if (it) it.imageUrl = publicUrl;
        renderImagens(); renderGestor();
      }
      sbToast('ok', `Foto de ${itemName} atualizada!`);
    } catch(e) {
      sbToast('err', 'Erro ao enviar imagem');
    } finally { sbLoading(false); }
  };
}

// ═══════════════════════════════════════════════════════
// SUPABASE — CRUD OVERRIDES
// ═══════════════════════════════════════════════════════

// ── addItem ──────────────────────────────────────────

// ── saveEditItem ─────────────────────────────────────

// ── deleteItem ───────────────────────────────────────

// ── addCategory ──────────────────────────────────────

// ── createOrder ──────────────────────────────────────

// ── advanceOrderById ─────────────────────────────────

// Helper unificado de detecção do tipo do pedido.
// Retorna 'mesa' | 'balcao' | 'delivery'.
// Usa prioridade: mesa_num > _isMesa > addr.startsWith('Mesa') > addr contém balcão/retirada > delivery (default).
function _detectOrderType(o) {
  if (!o) return 'delivery';
  if (o._isMesa || (o.mesa_num && Number(o.mesa_num) > 0)) return 'mesa';
  const addr = String(o.addr || '').trim();
  if (/^Mesa\b/i.test(addr)) return 'mesa';
  const lower = addr.toLowerCase();
  if (lower.startsWith('retirada') || lower.startsWith('balcão') || lower.startsWith('balcao')
      || lower.includes('retirada no balc') || lower.includes('balcão') || lower === 'balcao') {
    return 'balcao';
  }
  return 'delivery';
}
// Expõe como global pra outros arquivos (gestor-pedidos) usarem
if (typeof window !== 'undefined') window._detectOrderType = _detectOrderType;

// Guard contra cliques duplos: impede que o mesmo pedido seja avançado 2x antes do servidor responder.
const _advancingIds = new Set();

async function advanceOrderById(id) {
  const o = ordersKanban.find(x => x.id === id);
  if (!o) return;
  // Dedupe: se já temos um advance em voo para este pedido, ignora cliques extras
  if (_advancingIds.has(id)) return;
  _advancingIds.add(id);
  if (o.status === 'aguardando_pix') {
    _advancingIds.delete(id);
    sbToast('err', 'Use o botão "Confirmar Pago PIX" para este pedido.');
    return;
  }
  const oldStatus = o.status;
  const tipo = _detectOrderType(o);
  let newStatus;
  if (o.status === 'analise') newStatus = 'producao';
  else if (o.status === 'producao') newStatus = 'pronto';
  else if (o.status === 'pronto') {
    // Fluxo unificado (restaurante e açougue):
    //   delivery: pronto → saiu (saiu para entrega, dispara WA "a caminho")
    //   mesa/balcão: pronto → usa finishOrderById via botão no kanban (não passa por aqui)
    if (tipo === 'delivery') newStatus = 'saiu';
    else {
      // Balcão e mesa são finalizados via finishOrderById (botão dedicado no kanban).
      // Se advanceOrderById for chamado, delega para finishOrderById.
      _advancingIds.delete(id);
      return finishOrderById(id);
    }
  }
  else if (o.status === 'saiu') {
    // Saiu → "Entregue ao cliente" → finaliza direto (kanban tem só 4 colunas, sem "entregue" para delivery).
    // Delega para finishOrderById que cuida de: movimento financeiro, cashback, fidelidade, remover do kanban.
    _advancingIds.delete(id);
    return finishOrderById(id);
  }
  else newStatus = 'pronto';
  // Se estava em analise e vai para producao, verifica se para o alerta
  if (o.status === 'analise') setTimeout(_checkStopAlert, 200);
  // UI otimista: atualiza imediatamente para resposta instantânea
  o.status = newStatus;
  if (newStatus === 'saiu') o.updated_at = new Date().toISOString();
  playOrderSound();
  renderKanban();
  sbToast('ok', `Pedido #${_orderNum(id, o?.order_num)} avançado!`);
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: newStatus, tenant_id: _sessao?.tenant_id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');
  } catch(e) {
    // Reverte se falhou
    o.status = oldStatus;
    renderKanban();
    sbToast('err', 'Erro ao avançar pedido: ' + e.message);
  } finally {
    _advancingIds.delete(id);
  }
}

// ── cancelOrderById ──────────────────────────────────
async function cancelOrderById(id) {
  const o = ordersKanban.find(x => x.id === id);
  const time = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'cancelado', tenant_id: _sessao?.tenant_id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');
    ordersKanban = ordersKanban.filter(x => x.id !== id);
    // Estorno: se existir movimento financeiro deste pedido, cria saída para anular
    if (o) {
      try {
        // Usa separador " –" para evitar match de prefixo (ex: #3 pegando #31).
        // Se a descrição do movimento mudar, ajustar aqui junto com finishOrderById.
        const { data: movs } = await sb.from('movimentos')
          .select('id,val,pag')
          .ilike('description', `Pedido #${o.num} –%`)
          .eq('tipo', 'entrada')
          .limit(1);
        if (movs?.length && _sessao?.tenant_id) {
          await sb.from('movimentos').insert({
            tenant_id: _sessao.tenant_id,
            description: `Estorno — Pedido #${o.num} cancelado`,
            tipo: 'saida', val: movs[0].val,
            pag: o.pag || 'Estorno', time
          });
        }
      } catch(e) { console.warn('[cancelOrder] estorno falhou (não-fatal):', e.message); }
    }
  } catch(e) {
    sbToast('err', 'Erro ao cancelar pedido: ' + e.message); return;
  }
  renderKanban();
  showToast(_ICON_TRS, `Pedido #${_orderNum(id, o?.order_num)} cancelado`);
}

// ── finishOrderById ──────────────────────────────────
async function finishOrderById(id) {
  const o = ordersKanban.find(x => x.id === id);
  const time = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  let movimentoFalhou = false;
  sbLoading(true);
  try {
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'finalizado', tenant_id: _sessao?.tenant_id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');
    // Registra movimento financeiro
    if (o && _sessao?.tenant_id) {
      try {
      // Fix: usa parseFloat para evitar concatenação de string quando vem do SSE/JSON
      const _totalVal = parseFloat(o.total || 0) + parseFloat(o.taxa || 0);
      await sb.from('movimentos').insert({
        tenant_id: _sessao.tenant_id,
        description: `Pedido #${o.num} – ${o.client}`,
        tipo: 'entrada', val: _totalVal, pag: o.pag || 'PIX', time
      });
      movimentos.push({ desc:`Pedido #${o.num} – ${o.client}`, tipo:'entrada', val: _totalVal, pag:o.pag||'PIX', time });
      } catch(e) {
        movimentoFalhou = true;
        console.warn('[finishOrder] movimento financeiro falhou (pedido ja finalizado):', e.message);
      }
    }
    ordersKanban = ordersKanban.filter(x => x.id !== id);
    // BUG 1 fix: adiciona pontos de fidelidade ao finalizar
    if (o?.phone) _autoAddFidPoints(o.phone, parseFloat(o.total || 0) + parseFloat(o.taxa || 0));
  } catch(e) {
    sbLoading(false);
    sbToast('err', 'Erro ao finalizar pedido: ' + e.message); return;
  }
  sbLoading(false);
  renderKanban();
  if (movimentoFalhou) {
    sbToast('err', `Pedido #${_orderNum(id, o?.order_num)} finalizado, mas o financeiro nao foi registrado.`);
  } else {
    sbToast('ok', `Pedido #${_orderNum(id, o?.order_num)} finalizado!`);
  }
}

// ── confirmarPagamentoPix (PIX manual) ──────────────
async function confirmarPagamentoPix(id) {
  const o = ordersKanban.find(x => x.id === id);
  if (!o) return;
  if (!confirm(`Confirmar que o pagamento PIX do pedido #${o.num} foi recebido?`)) return;
  sbLoading(true);
  try {
    // Usa /api/order-status para mover para analise — isso dispara WA de confirmação ao cliente
    const res = await fetch('/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, new_status: 'analise', tenant_id: _sessao?.tenant_id })
    });
    if (!res.ok) throw new Error('Erro');
    if (o) {
      o.status      = 'analise';
      o._statusReal = 'analise';
      o._pixPendente = false;
      o.pag         = 'pix_mp'; // marca como pago para o badge mudar para PAGO PIX
    }
    renderKanban();
    sbToast('ok', `Pagamento PIX do pedido #${o.num} confirmado! Cliente será notificado.`);
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
  sbLoading(false);
}

// ══════════════════════════════════════════════════════════
// AÇOUGUE — Ajuste de peso disponível
// ══════════════════════════════════════════════════════════

let _ajustePesoOrderId = null;
let _ajustePesoItens   = []; // [{idx, name, obs, pesoOriginal, precoKg}]

function _parsePesoObs(obs) {
  // Extrai peso do obs. Formato: "500g Contra-filé · ..."
  const m = (obs || '').match(/(\d+)\s*g/i);
  return m ? parseInt(m[1]) : 0;
}

function _calcPrecoKg(price, pesoGramas) {
  // price já é o valor total (preço/kg * peso/1000)
  // então precoKg = price / (pesoGramas/1000)
  if (!pesoGramas) return 0;
  return price / (pesoGramas / 1000);
}

function abrirModalAjustePeso(orderId) {
  const o = ordersKanban.find(x => x.id === orderId);
  if (!o) return;
  _ajustePesoOrderId = orderId;

  // Filtra itens de kg (obs tem formato "NNNg NomeCorte")
  const itensKg = (o.items || []).filter(i =>
    i.item_type === 'kg' || (i.obs && /\d+g\s/.test(i.obs))
  );

  if (!itensKg.length) { sbToast('err', 'Nenhum item de peso neste pedido.'); return; }

  _ajustePesoItens = itensKg.map((i, idx) => {
    const pesoOriginal = _parsePesoObs(i.obs);
    const precoKg      = pesoOriginal > 0 ? _calcPrecoKg(parseFloat(i.price), pesoOriginal) : parseFloat(i.price);
    return { idx, name: i.name, obs: i.obs || '', pesoOriginal, precoKg, price: parseFloat(i.price) };
  });

  const wrap = document.getElementById('ajuste-peso-itens');
  if (!wrap) return;

  wrap.innerHTML = _ajustePesoItens.map((it, i) => `
    <div style="background:var(--surface2);border-radius:12px;padding:14px;border:1px solid var(--border)">
      <div style="font-weight:700;font-size:13.5px;margin-bottom:4px">${it.name}</div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px">${it.obs}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end">
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Peso solicitado</div>
          <div style="font-size:15px;font-weight:700;color:var(--accent)">${it.pesoOriginal}g</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Peso disponível (g)</div>
          <input type="number" id="ajuste-peso-${i}" min="1" max="${it.pesoOriginal}"
            value="${it.pesoOriginal}"
            oninput="atualizarPreviewAjuste(${i})"
            style="width:100%;padding:8px 10px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);font-size:14px;font-weight:700;font-family:inherit">
        </div>
      </div>
      <div id="ajuste-preview-${i}" style="font-size:12px;color:var(--muted);margin-top:8px">
        Valor: <strong>R$ ${it.price.toFixed(2).replace('.',',')}</strong>
      </div>
    </div>
  `).join('');

  const modal = document.getElementById('modal-ajuste-peso-bg');
  if (modal) modal.style.display = 'flex';
}

function atualizarPreviewAjuste(i) {
  const it  = _ajustePesoItens[i];
  if (!it) return;
  const el  = document.getElementById(`ajuste-peso-${i}`);
  const prev = document.getElementById(`ajuste-preview-${i}`);
  if (!el || !prev) return;
  const novoPeso = parseInt(el.value) || 0;
  const novoVal  = it.precoKg * (novoPeso / 1000);
  prev.innerHTML = `Novo valor: <strong style="color:var(--success)">R$ ${novoVal.toFixed(2).replace('.',',')}</strong>`;
}

function fecharModalAjustePeso() {
  const modal = document.getElementById('modal-ajuste-peso-bg');
  if (modal) modal.style.display = 'none';
  _ajustePesoOrderId = null;
  _ajustePesoItens   = [];
}

async function enviarAjustePeso() {
  if (!_ajustePesoOrderId) return;
  const o = ordersKanban.find(x => x.id === _ajustePesoOrderId);
  if (!o?.phone) { sbToast('err', 'Pedido sem telefone cadastrado.'); return; }

  // Monta proposta com novos pesos/valores
  const propostas = _ajustePesoItens.map((it, i) => {
    const el       = document.getElementById(`ajuste-peso-${i}`);
    const novoPeso = parseInt(el?.value) || it.pesoOriginal;
    const novoVal  = it.precoKg * (novoPeso / 1000);
    return { ...it, novoPeso, novoVal };
  }).filter(p => p.novoPeso !== p.pesoOriginal); // só os que mudaram

  if (!propostas.length) { sbToast('err', 'Nenhum peso foi alterado.'); return; }

  // Monta mensagem WA com nome da loja
  const idStr = String(_orderNum(_ajustePesoOrderId)).padStart(3,'0');
  let nomeLoja = 'Açougue';
  try {
    const cfgR = await fetch('/api/tenant-info-gestor', { headers: { 'Content-Type':'application/json', 'x-tenant-id': _sessao?.tenant_id } });
    if (cfgR.ok) { const d = await cfgR.json(); nomeLoja = d.nome || nomeLoja; }
  } catch(e) { console.warn('[gestor-core] silent error:', e?.message || e); }
  let msg = `🏪 *${nomeLoja}*\n${'─'.repeat(20)}\n\n⚖️ *Ajuste de peso — Pedido #${idStr}*\n\nOlá, *${o.client}*!\n\nAo separar seu pedido, verificamos que não temos a quantidade solicitada:\n\n`;
  propostas.forEach(p => {
    msg += `🥩 *${p.name}*\n`;
    msg += `   • Solicitado: ${p.pesoOriginal}g — R$ ${p.price.toFixed(2).replace('.',',')}\n`;
    msg += `   • Disponível: *${p.novoPeso}g — R$ ${p.novoVal.toFixed(2).replace('.',',')}*\n\n`;
  });
  msg += `Você aceita o ajuste?\n\n✅ Responda *SIM* para confirmar\n❌ Responda *NÃO* para cancelar o pedido\n\n_Dúvidas? É só responder esta mensagem!_ 😊`;

  sbLoading(true);
  try {
    // Usa o proxy EVO para enviar (mesmo mecanismo do robô)
    const phone  = (o.phone || '').replace(/\D/g,'');
    const number = phone.startsWith('55') ? phone : '55' + phone;
    const r = await EVO.sendText(number, msg);
    if (!r.ok) throw new Error('Erro ao enviar mensagem WA');

    // Salva proposta pendente no estado do pedido
    const idx = ordersKanban.findIndex(x => x.id === _ajustePesoOrderId);
    if (idx !== -1) {
      ordersKanban[idx]._ajustePendente = propostas;
      ordersKanban[idx]._ajustePesoOrderId = _ajustePesoOrderId;
    }

    sbToast('ok', 'Proposta enviada ao cliente via WhatsApp!');
    fecharModalAjustePeso();
    renderKanban();
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
  sbLoading(false);
}

// ── Aplicar ajuste manual (cliente confirmou presencialmente ou por WA) ─────
async function aplicarAjusteManual() {
  if (!_ajustePesoOrderId) return;
  const o   = ordersKanban.find(x => x.id === _ajustePesoOrderId);
  const idx = ordersKanban.findIndex(x => x.id === _ajustePesoOrderId);
  if (!o || idx === -1) return;

  // Lê pesos dos inputs do modal (mesmos campos de abrirModalAjustePeso)
  const propostas = _ajustePesoItens.map((it, i) => {
    const el       = document.getElementById('ajuste-peso-' + i);
    const novoPeso = parseInt(el?.value) || it.pesoOriginal;
    const novoVal  = it.precoKg * (novoPeso / 1000);
    return { ...it, novoPeso, novoVal };
  }); // inclui todos, mesmo sem mudança

  sbLoading(true);
  try {
    const novosItens = (o.items || []).map(item => {
      const p = propostas.find(p => p.name === item.name);
      if (!p) return item;
      const novaObs = (item.obs || '').replace(/\d+g/, p.novoPeso + 'g');
      return { ...item, price: parseFloat(p.novoVal.toFixed(2)), obs: novaObs };
    });

    const totalItens = novosItens.reduce((s, i) => s + parseFloat(i.price || 0) * (i.qty || 1), 0);

    const r = await fetch('/api/orders?id=eq.' + _ajustePesoOrderId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': _sessao?.tenant_id },
      body: JSON.stringify({ items: novosItens, total: totalItens })
    });
    if (!r.ok) throw new Error('Erro ao atualizar pedido');

    ordersKanban[idx] = { ...o, items: novosItens, total: totalItens, _ajustePendente: null };
    fecharModalAjustePeso();
    if (typeof renderKanban === 'function') renderKanban();
    sbToast('ok', 'Pedido atualizado! Novo total: R$ ' + totalItens.toFixed(2).replace('.',','));
  } catch(e) {
    sbToast('err', 'Erro ao aplicar: ' + (e?.message || e));
  }
  sbLoading(false);
}

// ── Modal de resposta WA ──────────────────────────────────
let _respostaWAOrderId = null;

function abrirRespostaWA(orderId) {
  const o = ordersKanban.find(x => x.id === orderId);
  if (!o) return;
  _respostaWAOrderId = orderId;

  const prev = document.getElementById('modal-wa-msg-preview');
  if (prev) prev.textContent = o._waRespostaTxt || '(mensagem não disponível)';

  const modal = document.getElementById('modal-resposta-wa-bg');
  if (modal) modal.style.display = 'flex';
}

function fecharRespostaWA() {
  const modal = document.getElementById('modal-resposta-wa-bg');
  if (modal) modal.style.display = 'none';
  _respostaWAOrderId = null;
}

async function clienteAceitouAjuste() {
  if (!_respostaWAOrderId) return;
  const o   = ordersKanban.find(x => x.id === _respostaWAOrderId);
  const idx = ordersKanban.findIndex(x => x.id === _respostaWAOrderId);
  if (!o || idx === -1) return;

  const propostas = o._ajustePendente || [];
  if (!propostas.length) {
    // Sem proposta de peso — só limpa a notificação e avança
    if (o) { o._waResposta = false; o._waRespostaTxt = null; }
    fecharRespostaWA(); renderKanban(); return;
  }

  sbLoading(true);
  try {
    // Atualiza itens do pedido com novos pesos/valores
    // Usa name + obs para encontrar o item correto (idx era do array filtrado, não do completo)
    const novosItens = (o.items || []).map(item => {
      const proposta = propostas.find(p =>
        p.name === item.name &&
        (item.obs || '').includes(String(p.pesoOriginal) + 'g')
      );
      if (!proposta) return item;
      const novaObs = (item.obs || '').replace(/\d+g/, `${proposta.novoPeso}g`);
      return { ...item, price: proposta.novoVal, obs: novaObs };
    });

    // Recalcula total dos itens + mantém taxa de entrega original
    const totalItens = novosItens.reduce((s, i) => s + parseFloat(i.price || 0) * (i.qty || 1), 0);
    const taxaOriginal = parseFloat(o.taxa || 0);
    const novoTotal = totalItens + taxaOriginal;

    const r = await fetch(`/api/orders?id=eq.${_respostaWAOrderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': _sessao?.tenant_id },
      body: JSON.stringify({ items: novosItens, total: totalItens })
    });
    if (!r.ok) throw new Error('Erro ao atualizar pedido');

    ordersKanban[idx] = { ...o, items: novosItens, total: totalItens, _waResposta: false, _waRespostaTxt: null, _ajustePendente: null };
    sbToast('ok', `Pedido #${_orderNum(_respostaWAOrderId)} atualizado! Novo total: R$ ${novoTotal.toFixed(2).replace('.',',')}`);
    fecharRespostaWA(); renderKanban();
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
  sbLoading(false);
}

async function clienteRecusouAjuste() {
  if (!_respostaWAOrderId) return;
  if (!confirm('Cancelar o pedido?')) return;
  await cancelOrderById(_respostaWAOrderId);
  fecharRespostaWA();
}

function waOpenFromOrder() {
  if (!_respostaWAOrderId) return;
  const o = ordersKanban.find(x => x.id === _respostaWAOrderId);
  if (!o?.phone) return;
  fecharRespostaWA();
  // Abre o WA Chat direto na conversa do cliente
  const phone = o.phone.replace(/\D/g,'');
  const jid   = (phone.startsWith('55') ? phone : '55' + phone) + '@s.whatsapp.net';
  // Navega para aba WA e abre a conversa
  if (typeof nav === 'function') nav('robo');
  setTimeout(() => {
    if (typeof waOpenConv === 'function') waOpenConv(jid, o.client);
    if (typeof WA !== 'undefined') WA.open = true;
  }, 300);
}

// ── Hook: detecta resposta WA do cliente em pedidos pendentes ──────────
function _verificarRespostaWACliente(msg) {
  if (!msg?.key || msg.key.fromMe === true || msg.key.fromMe === 'true') return;
  const jid   = msg.key.remoteJid || '';
  const phone = jid.replace('@s.whatsapp.net','').replace(/\D/g,'');
  if (!phone) return;

  // Procura pedido no kanban com esse telefone que tem ajuste pendente
  ordersKanban.forEach((o, idx) => {
    const orderPhone = (o.phone || '').replace(/\D/g,'');
    const match = phone.endsWith(orderPhone) || orderPhone.endsWith(phone);
    if (!match) return;

    // Só notifica se há ajuste pendente OU se é açougue (qualquer resposta é relevante)
    if (!o._ajustePendente && window._segmento !== 'acougue') return;

    const texto = _waExtractText(msg);
    if (!texto) return;

    ordersKanban[idx]._waResposta    = true;
    ordersKanban[idx]._waRespostaTxt = texto;
    renderKanban();
    sbToast('ok', `💬 #${_orderNum(o.id, o.order_num)} — ${o.client} respondeu no WhatsApp!`);
  });
}

function _waExtractText(msg) {
  const m = msg?.message;
  if (!m) return '';
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || '';
}

// ── addMovimento (quick register) ────────────────────

// ── addMovimentoModal ────────────────────────────────

// ── addCupom ─────────────────────────────────────────

// ── deleteCupom ──────────────────────────────────────

// ── addTable ─────────────────────────────────────────

// ── toggleMesaStatus ─────────────────────────────────

// ── saveAll (edição em massa) ─────────────────────────

// ── updatePrice + cycleStatus sync ───────────────────

// ── finalizeSale with Supabase ────────────────────────

// ── renderImagens with real photos ────────────────────

// ─────────────────────────────────────────
// DATA
// ─────────────────────────────────────────
const DAYS=['D','S','T','Q','Q','S','S'];
const DAYS_FULL=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const STATUS_CYCLE=[['sta','Disponível'],['ste','Esgotado'],['stp','Pausado']];
const EMOJIS_PLAIN = [
  '🍔','🌭','🍟','🍕','🥪','🌮','🌯','🥙','🧆','🍿',
  '🍗','🍖','🥩','🥚','🍳','🥓','🍝','🍜','🍲','🍛',
  '🥗','🥘','🫕','🥫','🧇','🥞','🧈','🍞','🥐','🥖',
  '🧀','🥨','🍰','🎂','🍮','🍯','🍩','🍪','🍫','🍬',
  '🍭','🍦','🍧','🍨','🍱','🍣','🍤','🦐','🦑','🥤',
  '🧃','🍵','☕','🧋','🥛','🍺','🍷','🧉','🍹','🍸',
  '🍉','🍓','🍇','🍒','🍑','🥭','🍍','🥝','🍋','🍌'
];
const EMOJIS = EMOJIS_PLAIN;
const BOT_ANSWERS={
  'cardapio':'Aqui está nosso cardápio! Cachorrão R$8, X-Burguer R$12, Batata Frita R$9, Coca lata R$5, Suco R$6. O que deseja pedir?',
  'taxa':'A taxa de entrega é R$5,00 para toda a área. ',
  'horario':'Atendemos das 08:00 às 22:00 de segunda a sábado. ',
  'horário':'Atendemos das 08:00 às 22:00 de segunda a sábado. ',
  'pix':'Nossa chave PIX: estima@food.com.br ',
  'oi':'Olá! Bem-vindo ao Estima Food! Como posso ajudar? Digite *cardapio*, *taxa*, *horario* ou *pedido*.',
  'olá':'Olá! Bem-vindo ao Estima Food! ',
  'ola':'Olá! Posso ajudar?',
  'pedido':'Que ótimo! Por favor, informe o endereço e os itens desejados.',
  'obrigado':'De nada! Volte sempre! ',
  'tchau':'Até logo! Obrigado pela preferência! ',
};

let editingId=null, garcomCart=[], garcomMesa='';

// ── Todos os dados vêm exclusivamente do Supabase ──────────
let items        = [];
let categories   = [];
let ordersKanban = [];
let pendingOnlineOrders = [];
let _orderNumOffset = 0;   // offset salvo em store_config (fallback para pedidos antigos sem order_num)
let _orderAutoResetDaily = false;
let _orderAutoResetLastDate = '';
let _taxaServicoPct = 0;   // % taxa de serviço do garçom (opcional no fechamento de mesa)
let _tempoRetiradaPedido = '30-40 min';
let _tempoDeliveryPedido = '';

function _applyStoreConfigUpdate(cfg = {}) {
  let remapOrders = false;
  if (Object.prototype.hasOwnProperty.call(cfg, 'store_name')) {
    _tenantStoreName = cfg.store_name || '';
    window._tenantStoreName = _tenantStoreName;
    try { if (typeof gestorChatSetStoreName === 'function') gestorChatSetStoreName(_tenantStoreName); } catch(e) {}
  }
  if (Object.prototype.hasOwnProperty.call(cfg, 'order_num_offset')) {
    _orderNumOffset = parseInt(cfg.order_num_offset) || 0;
    remapOrders = true;
  }
  if (Object.prototype.hasOwnProperty.call(cfg, 'order_auto_reset_daily')) {
    _orderAutoResetDaily = cfg.order_auto_reset_daily === true || cfg.order_auto_reset_daily === 1 || cfg.order_auto_reset_daily === '1';
  }
  if (Object.prototype.hasOwnProperty.call(cfg, 'order_auto_reset_last_date')) {
    _orderAutoResetLastDate = cfg.order_auto_reset_last_date || '';
  }
  if (Object.prototype.hasOwnProperty.call(cfg, 'taxa_servico_pct')) {
    _taxaServicoPct = parseFloat(cfg.taxa_servico_pct) || 0;
  }
  if (remapOrders) {
    ordersKanban = ordersKanban.map(o => ({ ...o, num: _orderNum(o.id, o.order_num) }));
    if (typeof renderKanban === 'function') renderKanban();
  }
  if (typeof _renderConfiguracoes === 'function') _renderConfiguracoes();
}

function _orderNum(id, orderNum) {
  // Prefere order_num do servidor (sequencial por tenant), fallback para id - offset
  if (orderNum) return Number(orderNum);
  const n = Number(id) || 0;
  const off = Number(_orderNumOffset) || 0;
  return n > off ? Math.max(1, n - off) : n;
}

function _tempoPedidoDisplay(v) {
  const txt = String(v || '').trim();
  return txt || 'Não informado';
}

function _tempoPedidoRangeFromText(txt) {
  const nums = String(txt || '').match(/\d+/g) || [];
  return {
    min: nums[0] ? parseInt(nums[0], 10) : '',
    max: nums[1] ? parseInt(nums[1], 10) : ''
  };
}

function _tempoPedidoTextFromInputs(prefix) {
  const min = Math.max(0, parseInt(document.getElementById(prefix + '-min')?.value, 10) || 0);
  const max = Math.max(0, parseInt(document.getElementById(prefix + '-max')?.value, 10) || 0);
  if (!min && !max) return '';
  if (min && max && max !== min) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return `${lo} a ${hi} min`;
  }
  return `${min || max} min`;
}

function _setTemposPedidoConfig(cfg = {}) {
  _tempoRetiradaPedido = Object.prototype.hasOwnProperty.call(cfg, 'retirada')
    ? String(cfg.retirada || '').trim()
    : '30-40 min';
  _tempoDeliveryPedido = Object.prototype.hasOwnProperty.call(cfg, 'delivery')
    ? String(cfg.delivery || '').trim()
    : '';
  try {
    localStorage.setItem('printTempoRetirada', _tempoRetiradaPedido);
    localStorage.setItem('printTempoEntrega', _tempoDeliveryPedido);
    if (typeof _printTempoRetirada !== 'undefined') _printTempoRetirada = _tempoRetiradaPedido;
    if (typeof _printTempoEntrega !== 'undefined') _printTempoEntrega = _tempoDeliveryPedido;
  } catch(e) { console.warn('[tempos-pedido] sync local falhou:', e?.message || e); }
  _renderTemposPedidoKanban();
}

function _renderTemposPedidoKanban() {
  const ret = document.getElementById('tempo-retirada-kanban');
  const del = document.getElementById('tempo-delivery-kanban');
  if (ret) ret.textContent = _tempoPedidoDisplay(_tempoRetiradaPedido);
  if (del) del.textContent = _tempoPedidoDisplay(_tempoDeliveryPedido);
}

function abrirModalTemposPedido() {
  const r = _tempoPedidoRangeFromText(_tempoRetiradaPedido);
  const d = _tempoPedidoRangeFromText(_tempoDeliveryPedido);
  const rMin = document.getElementById('tempo-retirada-min');
  const rMax = document.getElementById('tempo-retirada-max');
  const dMin = document.getElementById('tempo-delivery-min');
  const dMax = document.getElementById('tempo-delivery-max');
  if (rMin) rMin.value = r.min;
  if (rMax) rMax.value = r.max;
  if (dMin) dMin.value = d.min;
  if (dMax) dMax.value = d.max;
  openModal('modal-tempos-pedido');
}

async function salvarTemposPedido() {
  const tid = _sessao?.tenant_id;
  if (!tid) return sbToast('err', 'Sessão inválida. Faça login novamente.');
  const retirada = _tempoPedidoTextFromInputs('tempo-retirada');
  const delivery = _tempoPedidoTextFromInputs('tempo-delivery');
  const btn = document.getElementById('btn-salvar-tempos-pedido');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
  try {
    const { error } = await sb.from('store_config').upsert({
      tenant_id: tid,
      store_tempo_retirada: retirada,
      store_tempo_entrega: delivery
    });
    if (error) throw error;
    _setTemposPedidoConfig({ retirada, delivery });
    closeModal('modal-tempos-pedido');
    sbToast('ok', 'Tempos salvos para este tenant.');
  } catch(e) {
    sbToast('err', 'Erro ao salvar tempos: ' + (e?.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar tempos'; }
  }
}

// Retorna true se o pedido contém APENAS bebidas industrializadas (não imprime na cozinha)
const _BEBIDAS_RE = /refrigerante|coca.cola|pepsi|guarana|guaraná|fanta|sprite|soda|schweppes|tônica|tonica|agua\s|água\s|agua$|água$|agua com|água com|agua sem|água sem|mineral|cerveja|chopp|brahma|skol|heineken|budweiser|corona|stella|amstel|itaipava|eisenbahn|vinho|wine|espumante|prosecco|champagne|sake|dose|tanque|long.neck|long neck|energetico|energético|red.bull|redbull|monster|gatorade|powerade|isotônico|isotonico|ice.tea|nescau|leite.caixinha|leite longa/i;
function _isSoBebidas(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) return false;
  return items.every(i => _BEBIDAS_RE.test((i.name || '').toLowerCase()));
}
let orderIdSeq   = 1;
// tables declarado em mesa-state.js
let fidClients   = [];
let cliData      = [];  // customers carregados
let _cliTab      = 'todos';
let estoqueItems = [];
let estoqueReceitas = [];
let cartItems    = [];
let filters      = {search:'', cat:'', status:''};
let chatInitialized = false;
let cupons       = [];
let movimentos   = [];

// ─────────────────────────────────────────

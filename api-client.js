// ═══════════════════════════════════════════════════════
// API CLIENT — Estima Food
// Cliente REST nativo para o servidor próprio (SQLite + Node.js)
// Substitui completamente o supabase-shim.js
// ═══════════════════════════════════════════════════════
(function () {
  'use strict';

  const BASE = window.location.origin;
  const API_BASE = BASE + '/api';

  // ── Sessão / tenant ───────────────────────────────────
  // CRÍTICO: detecta o contexto pela URL pra escolher a sessão certa.
  // Se o usuário tem o gestor de um tenant aberto numa aba e o cardápio de
  // OUTRO tenant em outra, ler sys_session primeiro vazaria o pedido do
  // cardápio pro gestor errado.
  //
  // Páginas de cardápio neste sistema:
  //   - /                         (raiz, com ?slug=... ou ?cardapio=...)
  //   - /index.html?slug=...
  //   - /cardapio/* ou /c/*       (rotas legadas/futuras)
  //
  // Páginas de gestor: /gestor.html, /admin.html, /app.html, /garcom.html, /estimafood.html
  function isCardapioPage() {
    try {
      const path = (window.location.pathname || '').toLowerCase();
      // Páginas explícitas de gestor — sys_session sempre
      if (path.endsWith('/gestor.html') || path.endsWith('/admin.html')
          || path.endsWith('/app.html')   || path.endsWith('/garcom.html')
          || path.endsWith('/estimafood.html')) return false;
      // Caminhos de cardápio explícitos (futuro)
      if (path.startsWith('/cardapio') || path.startsWith('/c/')) return true;
      // Cardápio público real: raiz + index.html
      if (path === '/' || path === '' || path.endsWith('/index.html')) return true;
      // Detecção por marcador no body (caso a página seja servida via outra rota)
      if (document.body && document.body.dataset && document.body.dataset.contexto === 'cardapio') return true;
      return false;
    } catch (e) { return false; }
  }

  function readSession(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.tenant_id ? parsed.tenant_id : null;
    } catch (e) { return null; }
  }

  function getTenantId() {
    try {
      const inCardapio = isCardapioPage();
      // Em páginas de cardápio: cardapio_session é a fonte de verdade.
      // Em páginas de gestor/admin/etc: sys_session é a fonte de verdade.
      if (inCardapio) {
        const cTid = readSession('cardapio_session');
        if (cTid) return cTid;
        // Fallback: window._tenantId é setado pelo cardapio-core.js antes do sessionStorage
        if (typeof window !== 'undefined' && window._tenantId) return window._tenantId;
        // Último recurso: sys_session (caso o cardápio rode antes de gravar cardapio_session)
        const sTid = readSession('sys_session');
        if (sTid) return sTid;
      } else {
        const sTid = readSession('sys_session');
        if (sTid) return sTid;
        const cTid = readSession('cardapio_session');
        if (cTid) return cTid;
      }
      return null;
    } catch (e) {
      console.error('[v0] getTenantId: erro:', e);
      return null;
    }
  }

  // ── Cabeçalhos padrão ─────────────────────────────────
  function defaultHeaders(extra) {
    const h = { 'Content-Type': 'application/json', ...extra };
    const tid = getTenantId();
    if (tid) h['x-tenant-id'] = tid;
    try {
      const sess = JSON.parse(localStorage.getItem('sys_session') || '{}');
      const fin = JSON.parse(sessionStorage.getItem('finance_auth') || '{}');
      if (fin && fin.token && fin.expires_at > Date.now() && (!tid || fin.tenant_id === tid)) {
        h['x-finance-auth'] = fin.token;
        if (sess.id) h['x-user-id'] = String(sess.id);
      }
    } catch (e) {}
    return h;
  }

  // ── Query string ──────────────────────────────────────
  function toQS(params) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) p.set(k, String(v));
    }
    const s = p.toString();
    return s ? '?' + s : '';
  }

  function tenantScopedFilePath(filePath) {
    const raw = String(filePath || '');
    const tid = String(getTenantId() || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!tid) return raw;
    const parts = raw.split('/');
    const base = (parts.pop() || 'upload.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
    const scopedBase = base.startsWith(`${tid}_`) ? base : `${tid}_${base}`;
    return [...parts, scopedBase].filter(Boolean).join('/');
  }

  // ── Storage (upload de imagens) ───────────────────────
  class StorageBucket {
    constructor(bucket) { this.bucket = bucket; }
    upload(filePath, file, opts = {}) {
      return new Promise(async resolve => {
        try {
          const safePath = tenantScopedFilePath(filePath);
          const headers = defaultHeaders({});
          delete headers['Content-Type'];
          const formData = new FormData();
          formData.append('file', file, safePath);
          const res = await fetch(`${BASE}/storage/v1/object/${this.bucket}/${safePath}`, {
            method: 'POST', headers, body: formData
          });
          const data = await res.json();
          resolve({ data, error: res.ok ? null : data });
        } catch (e) { resolve({ data: null, error: { message: e.message } }); }
      });
    }
    getPublicUrl(filePath) {
      const safePath = tenantScopedFilePath(filePath);
      return { data: { publicUrl: `${BASE}/uploads/${safePath.split('/').pop()}` } };
    }
    // Remove um arquivo do storage a partir da sua URL pública (ou path relativo)
    remove(urls) {
      return new Promise(async resolve => {
        try {
          const list = Array.isArray(urls) ? urls : [urls];
          const headers = defaultHeaders({});
          const results = await Promise.all(list.filter(Boolean).map(async (u) => {
            const fname = String(u).split('/').pop().split('?')[0];
            const res = await fetch(`${BASE}/storage/v1/object/${this.bucket}/${fname}`, { method: 'DELETE', headers });
            return res.ok;
          }));
          resolve({ data: results, error: null });
        } catch (e) { resolve({ data: null, error: { message: e.message } }); }
      });
    }
  }

  class StorageClient {
    from(bucket) { return new StorageBucket(bucket); }
  }

  // ── Realtime via SSE ──────────────────────────────────
  class Channel {
    constructor(name) {
      this._name = name;
      this._handlers = {};
      this._sse = null;
      this._statusCb = null;
      this._destroyed = false;       // impede reconexão após unsubscribe()
      this._reconnectTimer = null;   // controla timer de reconexão para evitar duplicatas
    }

    on(event, filter, callback) {
      if (typeof filter === 'function') { callback = filter; filter = {}; }
      const key = (filter?.table || '*') + ':' + (filter?.event || event);
      if (!this._handlers[key]) this._handlers[key] = [];
      this._handlers[key].push(callback);
      return this;
    }

    subscribe(statusCb) {
      // Guarda o callback mais recente (permite re-subscribe com mesmo canal)
      if (statusCb) this._statusCb = statusCb;
      // Se já existe SSE ativo, não abre outro
      if (this._sse) return this;
      this._destroyed = false;

      const tid = getTenantId();
      const channel = tid ? `${this._name}:${tid}` : this._name;
      const url = `${BASE}/sse/${encodeURIComponent(channel)}`;
      this._sse = new EventSource(url);
      const self = this;

      this._sse.onopen = () => {
        // Cancela qualquer timer de reconexão pendente ao conectar com sucesso
        if (self._reconnectTimer) { clearTimeout(self._reconnectTimer); self._reconnectTimer = null; }
        self._statusCb?.('SUBSCRIBED');
      };

      this._sse.onerror = () => {
        // Só reconecta se não foi destruído manualmente (unsubscribe/removeChannel)
        if (self._destroyed) return;
        // Fecha conexão defeituosa antes de reagendar
        try { self._sse.close(); } catch(e) {}
        self._sse = null;
        self._statusCb?.('CHANNEL_ERROR');
        // Evita timers duplicados
        if (self._reconnectTimer) clearTimeout(self._reconnectTimer);
        self._reconnectTimer = setTimeout(() => {
          self._reconnectTimer = null;
          if (!self._destroyed) self.subscribe();
        }, 3000);
      };

      const handle = (e) => {
        try {
          const data = JSON.parse(e.data);
          const [table, evType] = (e.type || '').split(':');
          self._dispatch(table, evType || 'UPDATE', data);
        } catch (err) {}
      };

      ['INSERT', 'UPDATE', 'DELETE'].forEach(evType => {
        ['orders', 'mesas', 'menu_items', 'categories', 'store_config', 'garcons', 'customers', 'estoque', 'estoque_receitas', 'estoque_movimentos', 'addons_esgotados', 'entregadores', 'entregas', 'rotas_entrega', 'entregador_locations', 'entrega_mensagens', 'print_jobs'].forEach(tbl => {
          self._sse.addEventListener(`${tbl}:${evType}`, handle);
        });
      });

      return this;
    }

    _dispatch(table, evType, payload) {
      const called = new Set();
      const fire = fn => {
        if (called.has(fn)) return;
        called.add(fn);
        try { fn({ eventType: evType, new: payload, old: {} }); } catch (e) {}
      };
      for (const key of [`${table}:${evType}`, `${table}:*`, `*:${evType}`, '*:*']) {
        for (const fn of (this._handlers[key] || [])) fire(fn);
      }
    }

    unsubscribe() {
      this._destroyed = true;
      if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
      if (this._sse) { this._sse.close(); this._sse = null; }
      return Promise.resolve();
    }

    send() { return Promise.resolve({ status: 'ok' }); }
  }

  class RealtimeManager {
    constructor() { this._channels = new Map(); }
    channel(name) {
      if (!this._channels.has(name)) this._channels.set(name, new Channel(name));
      return this._channels.get(name);
    }
    removeChannel(ch) {
      if (!ch) return Promise.resolve();
      ch.unsubscribe();
      // Remove do mapa para que a próxima chamada a channel() crie instância limpa
      for (const [key, val] of this._channels) {
        if (val === ch) { this._channels.delete(key); break; }
      }
      return Promise.resolve();
    }
    removeAllChannels() {
      this._channels.forEach(ch => ch.unsubscribe());
      this._channels.clear();
      return Promise.resolve();
    }
  }

  // ── Query Builder ─────────────────────────────────────
  class Query {
    constructor(table) {
      this._table = table;
      this._params = new URLSearchParams(); // URLSearchParams suporta múltiplos valores por chave (ex: gte+lt no mesmo campo)
      this._method = 'GET';
      this._body = null;
      this._headers = {};
      this._single = false;
    }

    select(cols = '*')     { this._params.set('select', cols);                                    return this; }
    eq(col, val)           { this._params.set(col, `eq.${val === null ? 'null' : val}`);          return this; }
    neq(col, val)          { this._params.set(col, `neq.${val}`);                                 return this; }
    like(col, val)         { this._params.set(col, `like.${val}`);                                return this; }
    ilike(col, val)        { this._params.set(col, `ilike.${val}`);                               return this; }
    in(col, vals)          { this._params.set(col, `in.(${vals.join(',')})`);                     return this; }
    gte(col, val)          { this._params.append(col, `gte.${val}`);                              return this; } // append = permite coexistir com lt no mesmo campo
    lte(col, val)          { this._params.append(col, `lte.${val}`);                              return this; }
    gt(col, val)           { this._params.append(col, `gt.${val}`);                               return this; }
    lt(col, val)           { this._params.append(col, `lt.${val}`);                               return this; } // append = permite coexistir com gte no mesmo campo
    not(col, op, val)      { this._params.set(col, op === 'is' && (val === null || val === 'null') ? 'not.is.null' : `neq.${val}`); return this; }
    is(col, val)           { this._params.set(col, val === null ? 'is.null' : `eq.${val}`);       return this; }
    or(cond)               { this._params.set('or', `(${cond})`);                                 return this; }
    order(col, opts = {})  { const d = opts.ascending === false ? 'desc' : 'asc'; const prev = this._params.get('order'); this._params.set('order', (prev ? prev + ',' : '') + `${col}.${d}`); return this; }
    limit(n)               { this._params.set('limit', n);                                        return this; }
    range(from, to)        { this._params.set('offset', from); this._params.set('limit', to - from + 1); return this; }

    single()      { this._single = true; this._headers['Prefer'] = 'return=representation'; return this._run(); }
    maybeSingle() { this._single = true; return this._run(); }

    insert(data) { this._method = 'POST';   this._body = data; this._headers['Prefer'] = 'return=representation'; return this; }
    update(data) { this._method = 'PATCH';  this._body = data; return this; }
    upsert(data) { this._method = 'POST';   this._body = data; this._headers['Prefer'] = 'resolution=merge-duplicates,return=representation'; return this; }
    delete()     { this._method = 'DELETE'; return this; }

    then(resolve, reject) { return this._run().then(resolve, reject); }

  async _run() {
    const url = `${API_BASE}/${this._table}${this._params.toString() ? "?" + this._params.toString() : ""}`;
    if (this._method === 'POST' && this._table === 'orders' && this._body && typeof this._body === 'object' && !Array.isArray(this._body) && !this._body.client_request_id) {
      let reqId = '';
      try {
        if (window.crypto?.randomUUID) reqId = 'ord_' + window.crypto.randomUUID();
      } catch(e) {}
      if (!reqId) reqId = 'ord_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
      this._body = { ...this._body, client_request_id: reqId };
    }
    const hdrs = defaultHeaders(this._headers);
    if (this._single) hdrs['Prefer'] = (hdrs['Prefer'] ? hdrs['Prefer'] + ',' : '') + 'single';

    // Fallback tenant_id: se o sessionStorage perdeu (iOS Safari background kill, modo privado, etc),
    // tenta recuperar do window._tenantId (setado pelo cardapio-core.js em memória).
    if (!hdrs['x-tenant-id']) {
      const memTid = (typeof window !== 'undefined' && window._tenantId) ? window._tenantId : null;
      if (memTid) {
        console.warn('[v0] fallback tenant_id via window._tenantId:', memTid);
        hdrs['x-tenant-id'] = memTid;
      }
    }

    const opts = { method: this._method, headers: hdrs };
    if (this._body !== null) opts.body = JSON.stringify(this._body);

    // Log para debug (só writes)
    if (this._method !== 'GET') {
      console.log(`[v0] API ${this._method} ${this._table}:`, { url, headers: hdrs, body: this._body });
    }

    // Retry: writes (POST/PATCH/DELETE) têm 2 tentativas extras com backoff 600ms/1.8s em caso
    // de erro de rede (TypeError: Failed to fetch) ou 5xx. NÃO faz retry em 4xx (erro do cliente).
    // GET também tenta 1x extra. Timeout de 15s via AbortController.
    const maxAttempts = this._method === 'GET' ? 2 : 3;
    const backoffs = [0, 600, 1800];
    let lastErr = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (backoffs[attempt]) await new Promise(r => setTimeout(r, backoffs[attempt]));

      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const tid = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
      if (ctrl) opts.signal = ctrl.signal;

      try {
        const res = await fetch(url, opts);
        if (tid) clearTimeout(tid);
        const json = await res.json().catch(() => null);

        // 4xx: erro do cliente (validação, auth) — não adianta retry
        if (res.status >= 400 && res.status < 500) {
          console.error(`[v0] API ${this._method} ${this._table} ${res.status}:`, json);
          return { data: null, error: { message: json?.error || res.statusText, status: res.status } };
        }
        // 5xx: erro do servidor — tenta de novo
        if (!res.ok) {
          lastErr = { message: json?.error || res.statusText, status: res.status };
          console.warn(`[v0] API ${this._method} ${this._table} ${res.status} (tentativa ${attempt+1}/${maxAttempts})`);
          continue;
        }
        return { data: json, error: null };
      } catch (e) {
        if (tid) clearTimeout(tid);
        const isTimeout = e.name === 'AbortError';
        lastErr = { message: isTimeout ? 'Tempo esgotado ao conectar' : (e.message || 'Erro de rede'), network: true };
        console.warn(`[v0] API ${this._method} ${this._table} rede (${attempt+1}/${maxAttempts}):`, e.message);
      }
    }

    console.error(`[v0] API ${this._method} ${this._table} falhou após ${maxAttempts} tentativas`);
    return { data: null, error: lastErr || { message: 'Falha de conexão' } };
  }
}

  // ── Cliente principal ─────────────────────────────────
  class AppClient {
    constructor() {
      this.realtime = new RealtimeManager();
      this.storage  = new StorageClient();
    }
    from(table)       { return new Query(table); }
    channel(name)     { return this.realtime.channel(name); }
    removeChannel(ch) { return this.realtime.removeChannel(ch); }
  }

  window.AppAPI = new AppClient();

  console.log('%c[Estima Food] API Client carregado ✓', 'color:#22c55e;font-weight:bold');
})();

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
  function getTenantId() {
    try {
      // Sessão do gestor/admin tem prioridade
      const s = sessionStorage.getItem('sys_session');
      if (s) {
        const parsed = JSON.parse(s);
        if (parsed.tenant_id) {
          console.log('[v0] getTenantId: encontrado tenant_id na sys_session:', parsed.tenant_id);
          return parsed.tenant_id;
        }
        console.warn('[v0] getTenantId: sys_session existe mas sem tenant_id:', parsed);
      }
      // Fallback: sessão do cardápio (chave separada para não sobrescrever gestor)
      const c = sessionStorage.getItem('cardapio_session');
      if (c) {
        const parsed = JSON.parse(c);
        if (parsed.tenant_id) {
          console.log('[v0] getTenantId: encontrado tenant_id na cardapio_session:', parsed.tenant_id);
          return parsed.tenant_id;
        }
      }
      console.warn('[v0] getTenantId: nenhum tenant_id encontrado nas sessões');
      return null;
    } catch (e) { 
      console.error('[v0] getTenantId: erro ao ler sessão:', e);
      return null; 
    }
  }

  // ── Cabeçalhos padrão ─────────────────────────────────
  function defaultHeaders(extra) {
    const h = { 'Content-Type': 'application/json', ...extra };
    const tid = getTenantId();
    if (tid) h['x-tenant-id'] = tid;
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

  // ── Storage (upload de imagens) ───────────────────────
  class StorageBucket {
    constructor(bucket) { this.bucket = bucket; }
    upload(filePath, file, opts = {}) {
      return new Promise(async resolve => {
        try {
          const formData = new FormData();
          formData.append('file', file, filePath);
          const res = await fetch(`${BASE}/storage/v1/object/${this.bucket}/${filePath}`, {
            method: 'POST', body: formData
          });
          const data = await res.json();
          resolve({ data, error: res.ok ? null : data });
        } catch (e) { resolve({ data: null, error: { message: e.message } }); }
      });
    }
    getPublicUrl(filePath) {
      return { data: { publicUrl: `${BASE}/uploads/${filePath.split('/').pop()}` } };
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
        ['orders', 'mesas', 'menu_items', 'categories', 'store_config', 'garcons', 'customers'].forEach(tbl => {
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
    const hdrs = defaultHeaders(this._headers);
    if (this._single) hdrs['Prefer'] = (hdrs['Prefer'] ? hdrs['Prefer'] + ',' : '') + 'single';
    const opts = { method: this._method, headers: hdrs };
    if (this._body !== null) opts.body = JSON.stringify(this._body);
    
    // Log para debug
    if (this._method !== 'GET') {
      console.log(`[v0] API ${this._method} ${this._table}:`, {
        url, 
        headers: hdrs,
        body: this._body
      });
    }
    
    try {
      const res = await fetch(url, opts);
      const json = await res.json().catch(() => null);
      
      if (!res.ok) {
        console.error(`[v0] API ${this._method} ${this._table} ERRO:`, {
          status: res.status,
          response: json
        });
      }
      
      return res.ok ? { data: json, error: null } : { data: null, error: { message: json?.error || res.statusText } };
    } catch (e) { 
      console.error(`[v0] API ${this._method} ${this._table} EXCEÇÃO:`, e);
      return { data: null, error: { message: e.message } }; 
    }
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

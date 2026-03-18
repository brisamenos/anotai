// ═══════════════════════════════════════════════════════
// SUPABASE SHIM — Emula a SDK do Supabase sobre nossa API
// Mantém 100% de compatibilidade com os HTMLs existentes
// ═══════════════════════════════════════════════════════

(function() {
'use strict'

// Auto-detecta a URL base do servidor
const BASE = window.location.origin

// ── Utilitários ──────────────────────────────────────────
function qs(params) {
  const p = new URLSearchParams()
  if (!params) return ''
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) p.set(k, String(v))
  }
  const s = p.toString()
  return s ? '?' + s : ''
}

// ── Upload de imagens ─────────────────────────────────────
class StorageBucket {
  constructor(bucket) { this.bucket = bucket }
  upload(filePath, file, opts) {
    return new Promise(async (resolve) => {
      try {
        const formData = new FormData()
        formData.append('file', file, filePath)
        const res = await fetch(`${BASE}/storage/v1/object/${this.bucket}/${filePath}`, {
          method: 'POST', body: formData
        })
        const data = await res.json()
        resolve({ data, error: res.ok ? null : data })
      } catch(e) { resolve({ data: null, error: { message: e.message } }) }
    })
  }
  getPublicUrl(filePath) {
    return { data: { publicUrl: `${BASE}/uploads/${filePath.split('/').pop()}` } }
  }
}

class StorageClient {
  from(bucket) { return new StorageBucket(bucket) }
}

// ── SSE Realtime (substitui Supabase Realtime) ────────────
class RealtimeChannel {
  constructor(name, client) {
    this._name    = name
    this._client  = client
    this._handlers= {} // event → [fn]
    this._sse     = null
    this._status  = 'CLOSED'
  }

  on(event, filter, callback) {
    // Suporte: .on('postgres_changes', {event:'*',table:'orders'}, cb)
    if (typeof filter === 'function') { callback = filter; filter = {} }
    const key = (filter?.table || '*') + ':' + (filter?.event || event)
    if (!this._handlers[key]) this._handlers[key] = []
    this._handlers[key].push(callback)
    return this
  }

  subscribe(statusCb) {
    if (this._sse) return this
    const url = `${BASE}/sse/${encodeURIComponent(this._name)}`
    this._sse  = new EventSource(url)

    this._sse.onopen = () => {
      this._status = 'SUBSCRIBED'
      statusCb?.('SUBSCRIBED')
    }

    this._sse.onerror = () => {
      this._status = 'CHANNEL_ERROR'
      statusCb?.('CHANNEL_ERROR')
      // Reconecta automaticamente após 3s
      setTimeout(() => { if (this._sse) { this._sse.close(); this._sse = null; this.subscribe(statusCb) } }, 3000)
    }

    // Trata eventos do tipo "orders:UPDATE", "mesas:INSERT", etc.
    this._sse.addEventListener('message', (e) => {
      try {
        const [table, evType] = (e.lastEventId || '').split(':')
        const payload = JSON.parse(e.data)
        this._dispatch(table, evType, payload)
      } catch(err) {}
    })

    // EventSource padrão não suporta custom events natively em todos os browsers
    // Então o server envia como "event: table:TYPE\ndata: {...}"
    const self = this
    const originalOnMessage = this._sse.onmessage
    this._sse.onmessage = null

    // Escuta via EventSource genérico
    const proxyHandler = function(e) {
      try {
        const data = JSON.parse(e.data)
        // O servidor emite como "event: orders:UPDATE" então o tipo fica em e.type
        const parts = (e.type || '').split(':')
        const table = parts[0]
        const evType = parts[1] || 'UPDATE'
        self._dispatch(table, evType, data)
      } catch(err) {}
    }

    // Substitui por listener genérico capturando todos os tipos de eventos
    ;['INSERT','UPDATE','DELETE'].forEach(evType => {
      ;['orders','mesas','menu_items','categories','store_config'].forEach(tbl => {
        self._sse.addEventListener(`${tbl}:${evType}`, proxyHandler)
      })
    })

    return this
  }

  _dispatch(table, evType, payload) {
    const called = new Set()
    const fire = (fn) => {
      if (called.has(fn)) return
      called.add(fn)
      try { fn({ eventType: evType, new: payload, old: {} }) } catch(e) {}
    }
    const keys = [
      `${table}:${evType}`,
      `${table}:*`,
      `*:${evType}`,
      '*:*'
    ]
    for (const key of keys) {
      for (const fn of (this._handlers[key] || [])) fire(fn)
    }
  }

  unsubscribe() {
    if (this._sse) { this._sse.close(); this._sse = null }
    this._status = 'CLOSED'
    return Promise.resolve()
  }

  // send() é usado para ping/broadcast — no SSE é no-op (sem-operação)
  send(payload) {
    return Promise.resolve({ status: 'ok' })
  }
}

class RealtimeClient {
  constructor() { this._channels = new Map() }

  channel(name) {
    if (!this._channels.has(name)) this._channels.set(name, new RealtimeChannel(name, this))
    return this._channels.get(name)
  }

  removeChannel(ch) { ch?.unsubscribe(); return Promise.resolve() }
  removeAllChannels() { this._channels.forEach(ch => ch.unsubscribe()); this._channels.clear(); return Promise.resolve() }
}

// ── QueryBuilder — emula sb.from('table').select().eq().single() ──
class QueryBuilder {
  constructor(table) {
    this._table   = table
    this._params  = {}
    this._method  = 'GET'
    this._body    = null
    this._headers = {}
    this._single  = false
  }

  select(cols = '*') {
    this._params.select = cols
    return this
  }

  eq(col, val) {
    this._params[col] = `eq.${val === null ? 'null' : val}`
    return this
  }

  neq(col, val) {
    this._params[col] = `neq.${val}`
    return this
  }

  in(col, vals) {
    this._params[col] = `in.(${vals.join(',')})`
    return this
  }

  gte(col, val) {
    this._params[col] = `gte.${val}`
    return this
  }

  lte(col, val) {
    this._params[col] = `lte.${val}`
    return this
  }

  gt(col, val) {
    this._params[col] = `gt.${val}`
    return this
  }

  lt(col, val) {
    this._params[col] = `lt.${val}`
    return this
  }

  not(col, op, val) {
    if (op === 'is' && (val === null || val === 'null')) {
      this._params[col] = 'not.is.null'
    } else {
      this._params[col] = `neq.${val}`
    }
    return this
  }

  is(col, val) {
    this._params[col] = val === null ? 'is.null' : `eq.${val}`
    return this
  }

  or(conditions) {
    this._params['or'] = `(${conditions})`
    return this
  }

  order(col, opts = {}) {
    const dir = opts.ascending === false ? 'desc' : 'asc'
    this._params.order = (this._params.order ? this._params.order + ',' : '') + `${col}.${dir}`
    return this
  }

  limit(n) {
    this._params.limit = n
    return this
  }

  range(from, to) {
    this._params.offset = from
    this._params.limit  = to - from + 1
    return this
  }

  single() {
    this._single = true
    this._headers['Prefer'] = 'return=representation'
    return this._execute()
  }

  maybeSingle() {
    this._single = true
    return this._execute()
  }

  insert(data) {
    this._method = 'POST'
    this._body   = data
    this._headers['Prefer'] = 'return=representation'
    return this
  }

  update(data) {
    this._method = 'PATCH'
    this._body   = data
    return this
  }

  upsert(data, opts = {}) {
    this._method = 'POST'
    this._body   = data
    this._headers['Prefer'] = 'resolution=merge-duplicates,return=representation'
    return this
  }

  delete() {
    this._method = 'DELETE'
    return this
  }

  then(resolve, reject) {
    return this._execute().then(resolve, reject)
  }

  async _execute() {
    const url = `${BASE}/rest/v1/${this._table}${qs(this._params)}${this._single ? (Object.keys(this._params).some(k => k !== 'select' && k !== 'order' && k !== 'limit') ? '' : '') : ''}`
    const opts = {
      method:  this._method,
      headers: { 'Content-Type': 'application/json', ...this._headers },
    }
    if (this._single) opts.headers['Prefer'] = (opts.headers['Prefer'] ? opts.headers['Prefer'] + ',' : '') + 'single'
    if (this._body !== null) opts.body = JSON.stringify(this._body)

    try {
      const res  = await fetch(url, opts)
      const json = await res.json().catch(() => null)
      if (res.ok) {
        return { data: json, error: null }
      } else {
        return { data: null, error: { message: json?.error || res.statusText, details: json } }
      }
    } catch(e) {
      return { data: null, error: { message: e.message } }
    }
  }
}

// ── Cliente principal ─────────────────────────────────────
class SupabaseClient {
  constructor() {
    this.realtime = new RealtimeClient()
    this.storage  = new StorageClient()
    this.auth     = {
      // Autenticação não é usada (sistema usa sys_users próprio)
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } })
    }
  }

  from(table) { return new QueryBuilder(table) }

  channel(name) { return this.realtime.channel(name) }

  removeChannel(ch) { return this.realtime.removeChannel(ch) }
}

// ── Expõe como window.supabase ────────────────────────────
function createClient(url, key, opts) {
  return new SupabaseClient()
}

window.supabase = { createClient }

// Log de inicialização
console.log('%c[Estima Food] Supabase Shim carregado — usando API local', 'color:#22c55e;font-weight:bold')

})()

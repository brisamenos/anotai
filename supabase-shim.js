// ═══════════════════════════════════════════════════════
// SUPABASE SHIM v2 — Multi-Tenant
// Envia x-tenant-id em todas as requisições automaticamente
// ═══════════════════════════════════════════════════════
(function() {
'use strict'

const BASE = window.location.origin

// ── Recupera tenant_id da sessão ──────────────────────
function getTenantId() {
  try {
    const s = sessionStorage.getItem('sys_session')
    return s ? JSON.parse(s).tenant_id : null
  } catch(e) { return null }
}

// ── Utilitário query string ───────────────────────────
function qs(params) {
  const p = new URLSearchParams()
  if (!params) return ''
  for (const [k,v] of Object.entries(params)) {
    if (v !== undefined && v !== null) p.set(k, String(v))
  }
  const s = p.toString(); return s ? '?'+s : ''
}

// ── Storage (upload de imagens) ───────────────────────
class StorageBucket {
  constructor(bucket) { this.bucket = bucket }
  upload(filePath, file, opts) {
    return new Promise(async resolve => {
      try {
        const formData = new FormData()
        formData.append('file', file, filePath)
        const res = await fetch(`${BASE}/storage/v1/object/${this.bucket}/${filePath}`, {
          method:'POST', body:formData
        })
        const data = await res.json()
        resolve({ data, error: res.ok ? null : data })
      } catch(e) { resolve({ data:null, error:{ message:e.message } }) }
    })
  }
  getPublicUrl(filePath) {
    return { data: { publicUrl: `${BASE}/uploads/${filePath.split('/').pop()}` } }
  }
}

class StorageClient {
  from(bucket) { return new StorageBucket(bucket) }
}

// ── Realtime SSE — canais por tenant ─────────────────
class RealtimeChannel {
  constructor(name) {
    this._name     = name
    this._handlers = {}
    this._sse      = null
  }

  on(event, filter, callback) {
    if (typeof filter === 'function') { callback = filter; filter = {} }
    const key = (filter?.table || '*') + ':' + (filter?.event || event)
    if (!this._handlers[key]) this._handlers[key] = []
    this._handlers[key].push(callback)
    return this
  }

  subscribe(statusCb) {
    if (this._sse) return this
    // Adiciona tenant ao canal: orders-rt → orders-rt:TENANT_ID
    const tid     = getTenantId()
    const channel = tid ? `${this._name}:${tid}` : this._name
    const url     = `${BASE}/sse/${encodeURIComponent(channel)}`
    this._sse = new EventSource(url)
    const self = this

    this._sse.onopen = () => statusCb?.('SUBSCRIBED')

    this._sse.onerror = () => {
      statusCb?.('CHANNEL_ERROR')
      setTimeout(() => { if(self._sse){self._sse.close();self._sse=null;self.subscribe(statusCb)} }, 3000)
    }

    const proxyHandler = (e) => {
      try {
        const data  = JSON.parse(e.data)
        const parts = (e.type||'').split(':')
        self._dispatch(parts[0], parts[1]||'UPDATE', data)
      } catch(err) {}
    }

    ;['INSERT','UPDATE','DELETE'].forEach(evType => {
      ;['orders','mesas','menu_items','categories','store_config','garcons'].forEach(tbl => {
        self._sse.addEventListener(`${tbl}:${evType}`, proxyHandler)
      })
    })

    return this
  }

  _dispatch(table, evType, payload) {
    const called = new Set()
    const fire = fn => { if(called.has(fn))return; called.add(fn); try{fn({eventType:evType,new:payload,old:{}})}catch(e){} }
    const keys = [`${table}:${evType}`,`${table}:*`,`*:${evType}`,'*:*']
    for (const key of keys) { for (const fn of (this._handlers[key]||[])) fire(fn) }
  }

  unsubscribe() {
    if(this._sse){this._sse.close();this._sse=null}
    return Promise.resolve()
  }

  send(payload) { return Promise.resolve({status:'ok'}) }
}

class RealtimeClient {
  constructor() { this._channels = new Map() }
  channel(name) {
    if(!this._channels.has(name)) this._channels.set(name, new RealtimeChannel(name))
    return this._channels.get(name)
  }
  removeChannel(ch)     { ch?.unsubscribe(); return Promise.resolve() }
  removeAllChannels()   { this._channels.forEach(ch=>ch.unsubscribe()); this._channels.clear(); return Promise.resolve() }
}

// ── QueryBuilder — toda query envia x-tenant-id ───────
class QueryBuilder {
  constructor(table) {
    this._table   = table
    this._params  = {}
    this._method  = 'GET'
    this._body    = null
    this._headers = {}
    this._single  = false
  }

  _withTenant() {
    const tid = getTenantId()
    if (tid) this._headers['x-tenant-id'] = tid
    return this
  }

  select(cols='*')       { this._params.select=cols;  return this }
  eq(col,val)            { this._params[col]=`eq.${val===null?'null':val}`; return this }
  neq(col,val)           { this._params[col]=`neq.${val}`; return this }
  in(col,vals)           { this._params[col]=`in.(${vals.join(',')})`; return this }
  gte(col,val)           { this._params[col]=`gte.${val}`; return this }
  lte(col,val)           { this._params[col]=`lte.${val}`; return this }
  gt(col,val)            { this._params[col]=`gt.${val}`;  return this }
  lt(col,val)            { this._params[col]=`lt.${val}`;  return this }
  not(col,op,val)        { this._params[col]=op==='is'&&(val===null||val==='null')?'not.is.null':`neq.${val}`; return this }
  is(col,val)            { this._params[col]=val===null?'is.null':`eq.${val}`; return this }
  or(cond)               { this._params['or']=`(${cond})`; return this }
  order(col,opts={})     { const d=opts.ascending===false?'desc':'asc'; this._params.order=(this._params.order?this._params.order+',':'')+`${col}.${d}`; return this }
  limit(n)               { this._params.limit=n; return this }
  range(from,to)         { this._params.offset=from; this._params.limit=to-from+1; return this }

  single()     { this._single=true; this._headers['Prefer']='return=representation'; return this._withTenant()._execute() }
  maybeSingle(){ this._single=true; return this._withTenant()._execute() }

  insert(data) { this._method='POST';  this._body=data; this._headers['Prefer']='return=representation'; return this }
  update(data) { this._method='PATCH'; this._body=data; return this }
  upsert(data) { this._method='POST';  this._body=data; this._headers['Prefer']='resolution=merge-duplicates,return=representation'; return this }
  delete()     { this._method='DELETE'; return this }

  then(resolve,reject) { return this._withTenant()._execute().then(resolve,reject) }

  async _execute() {
    this._withTenant()
    const url  = `${BASE}/rest/v1/${this._table}${qs(this._params)}`
    const opts = { method:this._method, headers:{'Content-Type':'application/json',...this._headers} }
    if (this._single) opts.headers['Prefer'] = (opts.headers['Prefer']?opts.headers['Prefer']+',':'')+'single'
    if (this._body !== null) opts.body = JSON.stringify(this._body)
    try {
      const res  = await fetch(url, opts)
      const json = await res.json().catch(()=>null)
      return res.ok ? {data:json,error:null} : {data:null,error:{message:json?.error||res.statusText}}
    } catch(e) { return {data:null,error:{message:e.message}} }
  }
}

// ── Cliente principal ─────────────────────────────────
class SupabaseClient {
  constructor() {
    this.realtime = new RealtimeClient()
    this.storage  = new StorageClient()
    this.auth     = {
      getSession: async () => ({ data:{session:null}, error:null }),
      onAuthStateChange: () => ({ data:{ subscription:{ unsubscribe:()=>{} } } })
    }
  }
  from(table)         { return new QueryBuilder(table) }
  channel(name)       { return this.realtime.channel(name) }
  removeChannel(ch)   { return this.realtime.removeChannel(ch) }
}

function createClient(url, key, opts) { return new SupabaseClient() }

window.supabase = { createClient }

console.log('%c[Estima Food] Multi-Tenant Shim carregado ✓', 'color:#22c55e;font-weight:bold')

})()

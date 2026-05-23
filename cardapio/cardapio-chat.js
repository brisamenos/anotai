(function(){
  'use strict';

  const CHAT_TTL_MS = 72 * 60 * 60 * 1000;
  const state = {
    tid: '',
    orderId: null,
    orderNum: null,
    phone: '',
    client: '',
    thread: null,
    order: null,
    messages: [],
    open: false,
    unread: 0,
    sse: null,
    booting: false,
    ready: false
  };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function digits(v) { return String(v || '').replace(/\D/g, ''); }
  function tid() { return window._tenantId || ''; }
  function storageKey() { return 'ef_chat_' + (state.tid || tid() || ''); }
  function orderStorageKey() { return 'ef_order_' + (state.tid || tid() || ''); }

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  }

  function saveSession() {
    if (!state.tid || !state.orderId || !state.phone) return;
    try {
      localStorage.setItem(storageKey(), JSON.stringify({
        orderId: state.orderId,
        orderNum: state.orderNum,
        phone: state.phone,
        client: state.client,
        ts: Date.now()
      }));
    } catch(e) {}
  }

  function loadSession() {
    const k = storageKey();
    let data = readJson(k);
    if (!data) data = readJson(orderStorageKey());
    if (!data || !data.orderId || !data.phone) return null;
    if (data.ts && Date.now() - data.ts > CHAT_TTL_MS) {
      try { localStorage.removeItem(k); } catch(e) {}
      return null;
    }
    return data;
  }

  function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const currentTid = state.tid || tid();
    if (currentTid) headers['x-tenant-id'] = currentTid;
    return fetch(path, Object.assign({}, opts, { headers }));
  }

  function injectStyle() {
    if (document.getElementById('ef-chat-style')) return;
    const style = document.createElement('style');
    style.id = 'ef-chat-style';
    style.textContent = `
      #ef-chat-root{position:fixed;right:16px;bottom:22px;z-index:370;font-family:'DM Sans',system-ui,sans-serif}
      #ef-chat-root.efc-cart-on{bottom:86px}
      .efc-bubble{width:54px;height:54px;border:none;border-radius:50%;background:var(--accent,#f97316);color:#fff;display:none;align-items:center;justify-content:center;box-shadow:0 12px 30px rgba(0,0,0,.28);cursor:pointer;position:relative;transition:transform .18s,box-shadow .18s}
      .efc-bubble.on{display:flex}
      .efc-bubble:hover{transform:translateY(-2px);box-shadow:0 16px 36px rgba(0,0,0,.32)}
      .efc-badge{position:absolute;right:-3px;top:-4px;min-width:19px;height:19px;border-radius:99px;background:#ef4444;color:#fff;font-size:11px;font-weight:800;display:none;align-items:center;justify-content:center;border:2px solid #fff;padding:0 5px}
      .efc-badge.on{display:flex}
      .efc-panel{position:absolute;right:0;bottom:66px;width:min(360px,calc(100vw - 24px));height:min(520px,calc(100vh - 126px));background:#fff;color:#111827;border:1px solid rgba(15,23,42,.12);border-radius:18px;box-shadow:0 22px 70px rgba(15,23,42,.28);display:none;overflow:hidden;flex-direction:column}
      .efc-panel.on{display:flex}
      .efc-head{height:58px;background:#111827;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 14px 0 16px;gap:10px}
      .efc-title{font-size:14px;font-weight:850;line-height:1.1}
      .efc-sub{font-size:11.5px;color:rgba(255,255,255,.72);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:250px}
      .efc-close{width:32px;height:32px;border:none;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
      .efc-order{padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e5e7eb;font-size:12px;color:#475569;line-height:1.35}
      .efc-order strong{color:#111827}
      .efc-msgs{flex:1;overflow-y:auto;padding:14px 12px;background:#f3f4f6;display:flex;flex-direction:column;gap:8px}
      .efc-empty{margin:auto;text-align:center;color:#64748b;font-size:12.5px;line-height:1.35;max-width:230px}
      .efc-msg{max-width:86%;padding:9px 11px;border-radius:14px;font-size:13px;line-height:1.35;word-break:break-word;box-shadow:0 1px 1px rgba(15,23,42,.06)}
      .efc-msg.client{align-self:flex-end;background:var(--accent,#f97316);color:#fff;border-bottom-right-radius:5px}
      .efc-msg.store{align-self:flex-start;background:#fff;color:#111827;border-bottom-left-radius:5px}
      .efc-msg.system{align-self:center;background:#e0f2fe;color:#075985;border:1px solid #bae6fd;box-shadow:none;font-size:12px;text-align:center;border-radius:10px}
      .efc-time{font-size:10px;opacity:.7;margin-top:4px;text-align:right}
      .efc-form{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff}
      .efc-input{flex:1;min-width:0;height:40px;border:1px solid #d1d5db;border-radius:12px;padding:0 12px;font:500 13px 'DM Sans',system-ui,sans-serif;outline:none;color:#111827;background:#fff}
      .efc-input:focus{border-color:var(--accent,#f97316);box-shadow:0 0 0 3px rgba(var(--accent-rgb,249,115,22),.12)}
      .efc-send{width:42px;height:40px;border:none;border-radius:12px;background:var(--accent,#f97316);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
      .efc-send:disabled{opacity:.45;cursor:not-allowed}
      @media(max-width:520px){
        #ef-chat-root{right:12px;bottom:18px}
        #ef-chat-root.efc-cart-on{bottom:82px}
        .efc-panel{position:fixed;left:8px;right:8px;bottom:8px;width:auto;height:min(74vh,560px);border-radius:20px}
      }`;
    document.head.appendChild(style);
  }

  function ensureDom() {
    if (document.getElementById('ef-chat-root')) return;
    injectStyle();
    const root = document.createElement('div');
    root.id = 'ef-chat-root';
    root.innerHTML = `
      <button class="efc-bubble" id="ef-chat-bubble" type="button" title="Chat da loja" aria-label="Chat da loja">
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 6.5A4.5 4.5 0 0 1 9.5 2h5A4.5 4.5 0 0 1 19 6.5v3A4.5 4.5 0 0 1 14.5 14H11l-4.2 3.2c-.7.5-1.8 0-1.8-.9V14A4.5 4.5 0 0 1 1 9.5v-3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
          <path d="M9 7h6M9 10h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
        </svg>
        <span class="efc-badge" id="ef-chat-badge"></span>
      </button>
      <div class="efc-panel" id="ef-chat-panel">
        <div class="efc-head">
          <div>
            <div class="efc-title">Chat da loja</div>
            <div class="efc-sub" id="ef-chat-sub">Pedido</div>
          </div>
          <button class="efc-close" id="ef-chat-close" type="button" title="Fechar" aria-label="Fechar">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="efc-order" id="ef-chat-order"></div>
        <div class="efc-msgs" id="ef-chat-msgs"></div>
        <form class="efc-form" id="ef-chat-form">
          <input class="efc-input" id="ef-chat-input" maxlength="1000" autocomplete="off" placeholder="Mensagem para a loja">
          <button class="efc-send" id="ef-chat-send" type="submit" title="Enviar" aria-label="Enviar">
            <svg width="17" height="17" viewBox="0 0 18 18" fill="none"><path d="M2 9l13-6-3.4 12-2.5-5.1L2 9Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          </button>
        </form>
      </div>`;
    document.body.appendChild(root);
    document.getElementById('ef-chat-bubble').addEventListener('click', openPanel);
    document.getElementById('ef-chat-close').addEventListener('click', closePanel);
    document.getElementById('ef-chat-form').addEventListener('submit', sendMessage);
    state.ready = true;
  }

  function messageTime(m) {
    try {
      if (!m.created_at) return '';
      return new Date(String(m.created_at).replace(' ', 'T')).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  function mergeMessages(rows) {
    const seen = new Set(state.messages.map(m => Number(m.id)));
    (rows || []).forEach(m => {
      if (!m || seen.has(Number(m.id))) return;
      state.messages.push(m);
      seen.add(Number(m.id));
    });
    state.messages.sort((a,b) => Number(a.id || 0) - Number(b.id || 0));
  }

  function render() {
    ensureDom();
    const root = document.getElementById('ef-chat-root');
    const bubble = document.getElementById('ef-chat-bubble');
    const panel = document.getElementById('ef-chat-panel');
    const badge = document.getElementById('ef-chat-badge');
    const msgs = document.getElementById('ef-chat-msgs');
    const orderBox = document.getElementById('ef-chat-order');
    const sub = document.getElementById('ef-chat-sub');
    const hasSession = !!(state.orderId && state.phone);
    bubble.classList.toggle('on', hasSession);
    panel.classList.toggle('on', hasSession && state.open);
    root.classList.toggle('efc-cart-on', !!document.getElementById('cart-float')?.classList.contains('show'));

    const unread = Math.max(0, Number(state.unread || state.thread?.unread_client || 0));
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.classList.toggle('on', unread > 0);

    const order = state.order || state.thread?.order || {};
    const num = state.orderNum || order.order_num || order.num || state.orderId;
    const label = order.status_label || '';
    sub.textContent = num ? ('Pedido #' + num) : 'Pedido';
    orderBox.innerHTML = `<strong>Pedido #${esc(num || '')}</strong>${label ? ' - ' + esc(label) : ''}${order.items_text ? '<br>' + esc(order.items_text) : ''}`;

    if (!state.messages.length) {
      msgs.innerHTML = '<div class="efc-empty">As mensagens do pedido aparecem aqui.</div>';
      return;
    }
    msgs.innerHTML = state.messages.map(m => {
      const cls = m.sender === 'client' ? 'client' : (m.sender === 'system' ? 'system' : 'store');
      return `<div class="efc-msg ${cls}">
        <div>${esc(m.body)}</div>
        ${m.sender !== 'system' ? `<div class="efc-time">${esc(messageTime(m))}</div>` : ''}
      </div>`;
    }).join('');
    msgs.scrollTop = msgs.scrollHeight;
  }

  async function markRead() {
    if (!state.thread?.id || !state.phone) return;
    state.unread = 0;
    render();
    try {
      await api('/api/chat/read', {
        method: 'POST',
        body: JSON.stringify({ thread_id: state.thread.id, order_id: state.orderId, phone: state.phone, viewer: 'client' })
      });
    } catch(e) {}
  }

  function openPanel() {
    state.open = true;
    render();
    markRead();
    setTimeout(() => document.getElementById('ef-chat-input')?.focus(), 80);
  }

  function closePanel() {
    state.open = false;
    render();
  }

  async function sendMessage(ev) {
    ev.preventDefault();
    const input = document.getElementById('ef-chat-input');
    const btn = document.getElementById('ef-chat-send');
    const body = String(input?.value || '').trim();
    if (!body || !state.orderId || !state.phone) return;
    if (btn) btn.disabled = true;
    try {
      const r = await api('/api/chat/send', {
        method: 'POST',
        body: JSON.stringify({ order_id: state.orderId, phone: state.phone, sender: 'client', body })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || 'Falha ao enviar');
      if (input) input.value = '';
      if (data.thread) state.thread = data.thread;
      if (data.order) state.order = data.order;
      mergeMessages([data.message]);
      render();
    } catch(e) {
      if (typeof toast === 'function') toast('Erro', e?.message || 'Nao foi possivel enviar a mensagem.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function connectSSE() {
    if (state.sse) {
      try { state.sse.close(); } catch(e) {}
      state.sse = null;
    }
    if (!state.tid || !state.orderId || !state.phone || typeof EventSource === 'undefined') return;
    const channel = `chat-client:${state.tid}:${state.orderId}:${digits(state.phone)}`;
    const es = new EventSource('/sse/' + encodeURIComponent(channel));
    es.addEventListener('chat:message', ev => {
      try {
        const data = JSON.parse(ev.data || '{}');
        if (Number(data?.thread?.order_id) !== Number(state.orderId)) return;
        if (data.thread) state.thread = data.thread;
        if (data.order) state.order = data.order;
        if (data.message) {
          mergeMessages([data.message]);
          if (!state.open && data.message.sender !== 'client') state.unread = Math.max(state.unread || 0, Number(state.thread?.unread_client || 0));
        }
        render();
      } catch(e) {}
    });
    es.addEventListener('chat:read', ev => {
      try {
        const data = JSON.parse(ev.data || '{}');
        if (Number(data?.thread?.order_id) !== Number(state.orderId)) return;
        if (data.thread) state.thread = data.thread;
        state.unread = Number(state.thread?.unread_client || 0);
        render();
      } catch(e) {}
    });
    es.onerror = () => {};
    state.sse = es;
  }

  async function bootstrap(openAfter) {
    if (state.booting || !state.tid || !state.orderId || !state.phone) return;
    state.booting = true;
    ensureDom();
    render();
    try {
      const qs = new URLSearchParams({ order_id: state.orderId, phone: state.phone });
      const r = await api('/api/chat/bootstrap?' + qs.toString());
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || 'Chat indisponivel');
      state.thread = data.thread || null;
      state.order = data.order || data.thread?.order || null;
      state.orderNum = data.order?.order_num || data.thread?.order_num || state.orderNum;
      state.unread = Number(state.thread?.unread_client || 0);
      state.messages = [];
      mergeMessages(data.messages || []);
      saveSession();
      connectSSE();
      if (openAfter) state.open = true;
      render();
      if (openAfter) markRead();
    } catch(e) {
      render();
    } finally {
      state.booting = false;
    }
  }

  window.efChatStart = function(payload, opts) {
    payload = payload || {};
    state.tid = tid();
    state.orderId = payload.orderId || payload.id || state.orderId;
    state.orderNum = payload.orderNum || payload.order_num || state.orderNum;
    state.phone = digits(payload.phone || state.phone);
    state.client = payload.client || state.client || '';
    state.open = !!(opts && opts.open);
    saveSession();
    bootstrap(state.open);
  };

  function bootFromStorage() {
    state.tid = tid();
    if (!state.tid) return false;
    const data = loadSession();
    if (!data) return false;
    state.orderId = data.orderId;
    state.orderNum = data.orderNum || null;
    state.phone = digits(data.phone);
    state.client = data.client || '';
    bootstrap(false);
    return true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureDom();
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (bootFromStorage() || tries > 40) clearInterval(timer);
      render();
    }, 500);
  });
})();

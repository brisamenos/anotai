(function(){
  'use strict';

  const GCHAT = {
    tid: '',
    userId: '',
    open: false,
    threads: [],
    active: null,
    messages: [],
    sse: null,
    ready: false,
    loading: false,
    search: '',
    storeName: ''
  };
  window.GCHAT = GCHAT;

  let gcAudioCtx = null;
  let soundUnlockInstalled = false;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function sess() {
    try { return window._sessao || JSON.parse(sessionStorage.getItem('sys_session') || '{}') || {}; } catch { return {}; }
  }

  function setupIdentity() {
    const s = sess();
    GCHAT.tid = s.tenant_id || GCHAT.tid || '';
    GCHAT.userId = s.id || GCHAT.userId || 'gestor';
    return !!GCHAT.tid;
  }

  function storeName() {
    const inputName = document.getElementById('cp-nome')?.value || '';
    return String(GCHAT.storeName || window._tenantStoreName || inputName || 'Loja').trim() || 'Loja';
  }

  function setStoreName(name) {
    const value = String(name || '').trim();
    if (!value) return;
    GCHAT.storeName = value;
    renderTitle();
  }

  function renderTitle() {
    const name = storeName();
    const title = document.getElementById('gc-title');
    const fab = document.getElementById('gc-fab');
    if (title) title.textContent = name;
    if (fab) {
      fab.title = 'Chats de ' + name;
      fab.setAttribute('aria-label', 'Chats de ' + name);
    }
  }

  function getAudioCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!gcAudioCtx) gcAudioCtx = new AC();
    return gcAudioCtx;
  }

  function unlockSound() {
    try {
      const ctx = getAudioCtx();
      if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
    } catch(e) {}
  }

  function installSoundUnlock() {
    if (soundUnlockInstalled) return;
    soundUnlockInstalled = true;
    ['pointerdown','keydown','touchstart'].forEach(evt => {
      window.addEventListener(evt, unlockSound, { once: true, passive: true });
    });
  }

  function playChatSound() {
    try {
      const ctx = gcAudioCtx;
      if (!ctx || ctx.state === 'suspended') return;
      const now = ctx.currentTime + 0.01;
      [523.25, 783.99, 1046.5].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + idx * 0.075;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.05, start + 0.014);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.13);
      });
    } catch(e) {}
  }

  function api(path, opts) {
    opts = opts || {};
    setupIdentity();
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (GCHAT.tid) headers['x-tenant-id'] = GCHAT.tid;
    if (GCHAT.userId) headers['x-user-id'] = String(GCHAT.userId);
    return fetch(path, Object.assign({}, opts, { headers }));
  }

  function injectStyle() {
    if (document.getElementById('gestor-chat-style')) return;
    const style = document.createElement('style');
    style.id = 'gestor-chat-style';
    style.textContent = `
      #gestor-chat-root{position:fixed;right:22px;bottom:22px;z-index:6500;font-family:'DM Sans',system-ui,sans-serif}
      .gc-fab{width:52px;height:52px;border-radius:50%;border:1px solid rgba(14,165,233,.32);background:linear-gradient(135deg,#0ea5e9,#2563eb);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 14px 36px rgba(2,8,23,.32);cursor:pointer;position:relative}
      .gc-fab-badge{position:absolute;right:-4px;top:-5px;min-width:20px;height:20px;border-radius:99px;background:#ef4444;color:#fff;font-size:11px;font-weight:900;display:none;align-items:center;justify-content:center;border:2px solid var(--surface,#0f1117);padding:0 5px}
      .gc-fab-badge.on{display:flex}
      .gc-panel{position:absolute;right:0;bottom:64px;width:min(900px,calc(100vw - 36px));height:min(620px,calc(100vh - 112px));background:var(--surface,#111827);color:var(--text,#f8fafc);border:1px solid var(--border,rgba(255,255,255,.1));border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.42);display:none;overflow:hidden}
      .gc-panel.on{display:grid;grid-template-rows:56px 1fr}
      .gc-head{display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid var(--border,rgba(255,255,255,.1));background:rgba(255,255,255,.03)}
      .gc-title{font-size:14px;font-weight:850}
      .gc-close{width:32px;height:32px;border:none;border-radius:50%;background:var(--surface2,rgba(255,255,255,.08));color:var(--text,#fff);display:flex;align-items:center;justify-content:center;cursor:pointer}
      .gc-body{min-height:0;display:grid;grid-template-columns:300px minmax(0,1fr)}
      .gc-list-wrap{border-right:1px solid var(--border,rgba(255,255,255,.1));min-width:0;display:flex;flex-direction:column;background:rgba(255,255,255,.02)}
      .gc-search{padding:10px;border-bottom:1px solid var(--border,rgba(255,255,255,.08))}
      .gc-search input{width:100%;height:36px;border:1px solid var(--border,rgba(255,255,255,.12));border-radius:10px;background:var(--surface2,rgba(255,255,255,.06));color:var(--text,#fff);padding:0 11px;font:500 12.5px 'DM Sans',system-ui,sans-serif;outline:none}
      .gc-list{flex:1;overflow-y:auto}
      .gc-item{display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:10px;padding:11px 12px;border-bottom:1px solid rgba(148,163,184,.08);cursor:pointer;align-items:center}
      .gc-item:hover{background:rgba(14,165,233,.08)}
      .gc-item.on{background:rgba(14,165,233,.13);border-left:3px solid #0ea5e9;padding-left:9px}
      .gc-avatar{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#e0f2fe,#bfdbfe);color:#075985;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900}
      .gc-meta{min-width:0}
      .gc-name{font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .gc-prev{font-size:11.5px;color:var(--muted,#94a3b8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
      .gc-side{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:5px}
      .gc-time{font-size:10.5px;color:var(--muted,#94a3b8)}
      .gc-unread{min-width:19px;height:19px;border-radius:99px;background:#ef4444;color:#fff;font-size:10px;font-weight:900;display:flex;align-items:center;justify-content:center;padding:0 5px}
      .gc-chat{min-width:0;min-height:0;display:grid;grid-template-rows:auto 1fr auto;background:var(--bg,#0f172a)}
      .gc-context{padding:12px 14px;border-bottom:1px solid var(--border,rgba(255,255,255,.1));background:rgba(255,255,255,.03)}
      .gc-context-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
      .gc-order-title{font-size:14px;font-weight:850}
      .gc-status{font-size:11px;font-weight:800;color:#38bdf8;border:1px solid rgba(56,189,248,.25);background:rgba(56,189,248,.1);border-radius:99px;padding:3px 8px;white-space:nowrap}
      .gc-order-sub{font-size:11.5px;color:var(--muted,#94a3b8);margin-top:4px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .gc-msgs{min-height:0;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:linear-gradient(180deg,rgba(15,23,42,.55),rgba(15,23,42,.85))}
      .gc-empty{margin:auto;color:var(--muted,#94a3b8);font-size:13px;text-align:center}
      .gc-msg{max-width:78%;padding:9px 11px;border-radius:14px;font-size:13px;line-height:1.35;word-break:break-word}
      .gc-msg.client{align-self:flex-start;background:var(--surface,#111827);border:1px solid var(--border,rgba(255,255,255,.1));color:var(--text,#fff);border-bottom-left-radius:5px}
      .gc-msg.store{align-self:flex-end;background:#0ea5e9;color:#fff;border-bottom-right-radius:5px}
      .gc-msg.system{align-self:center;background:rgba(14,165,233,.1);border:1px solid rgba(14,165,233,.22);color:#7dd3fc;text-align:center;font-size:12px;border-radius:10px}
      .gc-msg-time{font-size:10px;opacity:.72;margin-top:4px;text-align:right}
      .gc-form{display:flex;gap:8px;padding:11px;border-top:1px solid var(--border,rgba(255,255,255,.1));background:rgba(255,255,255,.03)}
      .gc-input{flex:1;min-width:0;height:40px;border:1px solid var(--border,rgba(255,255,255,.12));border-radius:12px;background:var(--surface,#111827);color:var(--text,#fff);padding:0 12px;font:500 13px 'DM Sans',system-ui,sans-serif;outline:none}
      .gc-send{width:42px;height:40px;border:none;border-radius:12px;background:#0ea5e9;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer}
      .gc-send:disabled{opacity:.45;cursor:not-allowed}
      @media(max-width:760px){
        #gestor-chat-root{right:12px;bottom:12px}
        .gc-panel{position:fixed;left:8px;right:8px;top:68px;bottom:8px;width:auto;height:auto}
        .gc-body{grid-template-columns:1fr}
        .gc-list-wrap{display:none}
        .gc-panel.list-mode .gc-list-wrap{display:flex}
        .gc-panel.list-mode .gc-chat{display:none}
      }`;
    document.head.appendChild(style);
  }

  function ensureDom() {
    if (document.getElementById('gestor-chat-root')) return;
    injectStyle();
    const root = document.createElement('div');
    root.id = 'gestor-chat-root';
    root.innerHTML = `
      <button class="gc-fab" id="gc-fab" type="button" title="Chat clientes" aria-label="Chat clientes">
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none"><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2h9A3.5 3.5 0 0 1 20 5.5v6A3.5 3.5 0 0 1 16.5 15H10l-4.2 3.1c-.7.5-1.8 0-1.8-.9V15A3.5 3.5 0 0 1 .5 11.5v-6Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 7h8M8 10h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        <span class="gc-fab-badge" id="gc-fab-badge"></span>
      </button>
      <div class="gc-panel" id="gc-panel">
        <div class="gc-head">
          <div class="gc-title" id="gc-title">Chat clientes</div>
          <button class="gc-close" id="gc-close" type="button" title="Fechar" aria-label="Fechar">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="gc-body">
          <div class="gc-list-wrap">
            <div class="gc-search"><input id="gc-search" placeholder="Buscar cliente ou pedido"></div>
            <div class="gc-list" id="gc-list"></div>
          </div>
          <div class="gc-chat">
            <div class="gc-context" id="gc-context"></div>
            <div class="gc-msgs" id="gc-msgs"></div>
            <form class="gc-form" id="gc-form">
              <input class="gc-input" id="gc-input" maxlength="1000" autocomplete="off" placeholder="Responder cliente">
              <button class="gc-send" id="gc-send" type="submit" title="Enviar" aria-label="Enviar">
                <svg width="17" height="17" viewBox="0 0 18 18" fill="none"><path d="M2 9l13-6-3.4 12-2.5-5.1L2 9Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
              </button>
            </form>
          </div>
        </div>
      </div>`;
    document.body.appendChild(root);
    document.getElementById('gc-fab').addEventListener('click', () => openPanel());
    document.getElementById('gc-close').addEventListener('click', closePanel);
    document.getElementById('gc-search').addEventListener('input', ev => {
      GCHAT.search = ev.target.value || '';
      renderList();
    });
    document.getElementById('gc-list').addEventListener('click', ev => {
      const item = ev.target.closest('.gc-item');
      if (!item) return;
      const id = Number(item.getAttribute('data-id'));
      const thread = GCHAT.threads.find(t => Number(t.id) === id);
      if (thread) selectThread(thread);
    });
    document.getElementById('gc-form').addEventListener('submit', sendMessage);
    GCHAT.ready = true;
    renderTitle();
  }

  function whenText(t) {
    if (!t) return '';
    try {
      return new Date(String(t).replace(' ', 'T')).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  function initials(name) {
    const parts = String(name || 'C').trim().split(/\s+/).filter(Boolean);
    return (parts[0]?.[0] || 'C').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
  }

  function orderNum(thread) {
    const n = thread?.order?.order_num || thread?.order_num || thread?.order?.num || '';
    if (n) return n;
    return Number(thread?.order_id || 0) > 0 ? thread.order_id : '';
  }

  function threadLabel(thread) {
    const n = orderNum(thread);
    return n ? ('#' + n) : 'Novo pedido';
  }

  function upsertThread(thread) {
    if (!thread) return;
    const idx = GCHAT.threads.findIndex(t => Number(t.id) === Number(thread.id));
    if (idx >= 0) GCHAT.threads[idx] = Object.assign({}, GCHAT.threads[idx], thread);
    else GCHAT.threads.unshift(thread);
    GCHAT.threads.sort((a,b) => String(b.last_at || '').localeCompare(String(a.last_at || '')));
  }

  function mergeMessages(rows) {
    const seen = new Set(GCHAT.messages.map(m => Number(m.id)));
    (rows || []).forEach(m => {
      if (!m || seen.has(Number(m.id))) return;
      GCHAT.messages.push(m);
      seen.add(Number(m.id));
    });
    GCHAT.messages.sort((a,b) => Number(a.id || 0) - Number(b.id || 0));
  }

  function renderBadge() {
    const total = GCHAT.threads.reduce((s,t) => s + Number(t.unread_store || 0), 0);
    const badge = document.getElementById('gc-fab-badge');
    if (!badge) return;
    badge.textContent = total > 9 ? '9+' : String(total);
    badge.classList.toggle('on', total > 0);
  }

  function renderList() {
    ensureDom();
    const list = document.getElementById('gc-list');
    const q = String(GCHAT.search || '').toLowerCase().trim();
    const rows = GCHAT.threads.filter(t => {
      if (!q) return true;
      const hay = [t.client, t.phone, orderNum(t), t.last_message, t.order?.items_text].join(' ').toLowerCase();
      return hay.includes(q);
    });
    if (!rows.length) {
      list.innerHTML = '<div class="gc-empty">Nenhum chat encontrado.</div>';
      renderBadge();
      return;
    }
    list.innerHTML = rows.map(t => {
      const active = GCHAT.active && Number(GCHAT.active.id) === Number(t.id);
      const unread = Number(t.unread_store || 0);
      return `<div class="gc-item${active ? ' on' : ''}" data-id="${esc(t.id)}">
        <div class="gc-avatar">${esc(initials(t.client || t.phone))}</div>
        <div class="gc-meta">
          <div class="gc-name">${esc(t.client || t.phone || 'Cliente')} - ${esc(threadLabel(t))}</div>
          <div class="gc-prev">${esc(t.last_message || t.order?.items_text || '')}</div>
        </div>
        <div class="gc-side">
          <div class="gc-time">${esc(whenText(t.last_at))}</div>
          ${unread ? `<div class="gc-unread">${unread > 9 ? '9+' : unread}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    renderBadge();
  }

  function renderActive() {
    ensureDom();
    const ctx = document.getElementById('gc-context');
    const msgs = document.getElementById('gc-msgs');
    const input = document.getElementById('gc-input');
    const send = document.getElementById('gc-send');
    const t = GCHAT.active;
    if (!t) {
      ctx.innerHTML = '<div class="gc-order-title">Selecione um chat</div>';
      msgs.innerHTML = '<div class="gc-empty">As conversas dos pedidos ficam aqui.</div>';
      if (input) input.disabled = true;
      if (send) send.disabled = true;
      return;
    }
    if (input) input.disabled = false;
    if (send) send.disabled = false;
    const order = t.order || {};
    ctx.innerHTML = `
      <div class="gc-context-top">
        <div>
          <div class="gc-order-title">${esc(orderNum(t) ? ('Pedido #' + orderNum(t)) : 'Pedido pelo chat')} - ${esc(t.client || order.client || 'Cliente')}</div>
          <div class="gc-order-sub">${esc(t.phone || order.phone || '')}${order.items_text ? ' | ' + esc(order.items_text) : ''}</div>
        </div>
        <div class="gc-status">${esc(order.status_label || order.status || 'Atendimento')}</div>
      </div>`;
    if (!GCHAT.messages.length) {
      msgs.innerHTML = '<div class="gc-empty">Nenhuma mensagem ainda.</div>';
      return;
    }
    msgs.innerHTML = GCHAT.messages.map(m => {
      const cls = m.sender === 'store' ? 'store' : (m.sender === 'system' ? 'system' : 'client');
      return `<div class="gc-msg ${cls}">
        <div>${esc(m.body)}</div>
        ${m.sender !== 'system' ? `<div class="gc-msg-time">${esc(whenText(m.created_at))}</div>` : ''}
      </div>`;
    }).join('');
    msgs.scrollTop = msgs.scrollHeight;
  }

  function renderAll() {
    renderTitle();
    const panel = document.getElementById('gc-panel');
    if (panel) {
      panel.classList.toggle('on', GCHAT.open);
      panel.classList.toggle('list-mode', GCHAT.open && !GCHAT.active);
    }
    renderList();
    renderActive();
  }

  async function loadThreads() {
    if (!setupIdentity() || GCHAT.loading) return;
    GCHAT.loading = true;
    try {
      const r = await api('/api/chat/threads');
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || 'Falha ao carregar chats');
      GCHAT.threads = data.threads || [];
      renderAll();
    } catch(e) {
      renderAll();
    } finally {
      GCHAT.loading = false;
    }
  }

  async function markRead(thread) {
    if (!thread) return;
    try {
      await api('/api/chat/read', {
        method: 'POST',
        body: JSON.stringify({ thread_id: thread.id, viewer: 'store' })
      });
      thread.unread_store = 0;
      upsertThread(thread);
      renderList();
    } catch(e) {}
  }

  async function selectThread(thread, existingMessages) {
    if (!thread) return;
    GCHAT.active = thread;
    GCHAT.messages = [];
    mergeMessages(existingMessages || []);
    renderAll();
    try {
      if (!existingMessages) {
        const qs = new URLSearchParams({ thread_id: thread.id, role: 'store' });
        const r = await api('/api/chat/messages?' + qs.toString());
        const data = await r.json().catch(() => ({}));
        if (r.ok && data.ok) {
          GCHAT.active = data.thread || thread;
          upsertThread(GCHAT.active);
          GCHAT.messages = [];
          mergeMessages(data.messages || []);
        }
      }
      markRead(GCHAT.active);
      renderAll();
      setTimeout(() => document.getElementById('gc-input')?.focus(), 80);
    } catch(e) {
      renderAll();
    }
  }

  async function openOrder(orderId) {
    ensureDom();
    openPanel({ skipLoad: true });
    if (!setupIdentity() || !orderId) return;
    try {
      const qs = new URLSearchParams({ order_id: orderId, role: 'store' });
      const r = await api('/api/chat/bootstrap?' + qs.toString());
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || 'Chat indisponivel');
      upsertThread(data.thread);
      await selectThread(data.thread, data.messages || []);
      renderAll();
    } catch(e) {
      if (typeof sbToast === 'function') sbToast('err', e.message || 'Nao foi possivel abrir o chat.');
    }
  }

  function openPanel(opts) {
    ensureDom();
    GCHAT.open = true;
    renderAll();
    if (!opts || !opts.skipLoad) loadThreads();
  }

  function closePanel() {
    GCHAT.open = false;
    renderAll();
  }

  async function sendMessage(ev) {
    ev.preventDefault();
    const input = document.getElementById('gc-input');
    const btn = document.getElementById('gc-send');
    const text = String(input?.value || '').trim();
    if (!text || !GCHAT.active) return;
    if (btn) btn.disabled = true;
    try {
      const r = await api('/api/chat/send', {
        method: 'POST',
        body: JSON.stringify({ thread_id: GCHAT.active.id, order_id: GCHAT.active.order_id || 0, sender: 'store', body: text })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || 'Falha ao enviar');
      if (input) input.value = '';
      if (data.thread) {
        GCHAT.active = data.thread;
        upsertThread(data.thread);
      }
      mergeMessages([data.message]);
      renderAll();
    } catch(e) {
      if (typeof sbToast === 'function') sbToast('err', e.message || 'Nao foi possivel enviar.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function connectSSE() {
    if (!setupIdentity() || typeof EventSource === 'undefined') return;
    if (GCHAT.sse) {
      try { GCHAT.sse.close(); } catch(e) {}
      GCHAT.sse = null;
    }
    const es = new EventSource('/sse/' + encodeURIComponent('chat-rt:' + GCHAT.tid));
    es.addEventListener('chat:message', ev => {
      try {
        const data = JSON.parse(ev.data || '{}');
        const alreadyHad = data.message ? GCHAT.messages.some(m => Number(m.id) === Number(data.message.id)) : false;
        if (data.thread) upsertThread(data.thread);
        const active = GCHAT.active && data.thread && Number(GCHAT.active.id) === Number(data.thread.id);
        if (active) {
          GCHAT.active = Object.assign({}, GCHAT.active, data.thread);
          mergeMessages([data.message]);
          if (GCHAT.open) markRead(GCHAT.active);
        }
        if (!alreadyHad && data.message?.sender === 'client') playChatSound();
        renderAll();
      } catch(e) {}
    });
    es.addEventListener('chat:read', ev => {
      try {
        const data = JSON.parse(ev.data || '{}');
        if (data.thread) upsertThread(data.thread);
        if (GCHAT.active && data.thread && Number(GCHAT.active.id) === Number(data.thread.id)) {
          GCHAT.active = Object.assign({}, GCHAT.active, data.thread);
        }
        renderAll();
      } catch(e) {}
    });
    es.onerror = () => {};
    GCHAT.sse = es;
  }

  window.gestorChatOpenOrder = openOrder;
  window.gestorChatOpenPanel = openPanel;
  window.gestorChatSetStoreName = setStoreName;

  installSoundUnlock();

  document.addEventListener('DOMContentLoaded', () => {
    ensureDom();
    installSoundUnlock();
    setStoreName(window._tenantStoreName || '');
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (setupIdentity()) {
        clearInterval(timer);
        loadThreads();
        connectSSE();
      } else if (tries > 80) {
        clearInterval(timer);
      }
    }, 500);
  });
})();

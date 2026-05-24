(function(){
  'use strict';

  const CHAT_TTL_MS = 72 * 60 * 60 * 1000;
  const state = {
    tid: '',
    threadId: null,
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
    ready: false,
    storeName: '',
    quickSelections: {},
    pendingSuggestion: '',
    payment: null,
    follow: null
  };

  let audioCtx = null;
  let soundUnlockInstalled = false;
  let viewportHandlingInstalled = false;
  let nudgeTimer = null;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function digits(v) { return String(v || '').replace(/\D/g, ''); }
  function tid() {
    try { if (window._tenantId) return String(window._tenantId); } catch(e) {}
    try { if (typeof _tenantId !== 'undefined' && _tenantId) return String(_tenantId); } catch(e) {}
    try {
      const s = JSON.parse(sessionStorage.getItem('cardapio_session') || 'null');
      if (s?.tenant_id) return String(s.tenant_id);
    } catch(e) {}
    return '';
  }
  function storageKey() { return 'ef_chat_' + (state.tid || tid() || ''); }
  function orderStorageKey() { return 'ef_order_' + (state.tid || tid() || ''); }

  function storeName() {
    return String(
      state.storeName ||
      window._storeName ||
      document.getElementById('hero-name')?.textContent ||
      'Loja'
    ).trim() || 'Loja';
  }

  function setStoreName(name) {
    const value = String(name || '').trim();
    if (!value) return;
    state.storeName = value;
    renderTitle();
  }

  function renderTitle() {
    const name = storeName();
    const title = document.getElementById('ef-chat-title');
    const bubble = document.getElementById('ef-chat-bubble');
    if (title) title.textContent = name;
    if (bubble) {
      bubble.title = 'Acompanhar pedido - ' + name;
      bubble.setAttribute('aria-label', 'Acompanhar pedido - ' + name);
    }
  }

  function setTenantId(id) {
    const value = String(id || '').trim();
    if (!value) return;
    state.tid = value;
    try { window._tenantId = value; } catch(e) {}
    ensureDom();
    render();
  }

  function getAudioCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    return audioCtx;
  }

  function unlockSound() {
    try {
      const ctx = getAudioCtx();
      if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
      ensureNotificationPermission();
    } catch(e) {}
  }

  function ensureNotificationPermission() {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
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
      const ctx = audioCtx;
      if (!ctx || ctx.state === 'suspended') return;
      const now = ctx.currentTime + 0.01;
      [740, 988, 1318].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + idx * 0.08;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.22, start + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.2);
      });
    } catch(e) {}
  }

  function showBrowserNotification(title, body) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const n = new Notification(title || storeName(), {
        body: String(body || '').slice(0, 180),
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: 'ef-chat-' + (state.thread?.id || state.orderId || Date.now()),
        renotify: true
      });
      n.onclick = () => {
        try { window.focus(); openPanel(); } catch(e) {}
        try { n.close(); } catch(e) {}
      };
    } catch(e) {}
  }

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  }

  function normText(v) {
    return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function statusKey(v) {
    return normText(v).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function isFinalOrderStatus(status) {
    const key = statusKey(status);
    return key === 'finalizado' || key === 'cancelado';
  }

  function isFinalOrder(order) {
    return !!order && isFinalOrderStatus(order.status);
  }

  function activeOrderFromState() {
    const order = state.order || state.thread?.order || null;
    return isFinalOrder(order) ? null : order;
  }

  function trackingOrderId() {
    return Number(state.orderId || state.order?.id || state.thread?.order_id || 0) || 0;
  }

  function hasTrackingContext() {
    return !!(state.phone && trackingOrderId() > 0);
  }

  function stripThreadOrder(thread) {
    if (!thread) return thread;
    const clean = Object.assign({}, thread);
    clean.order_id = 0;
    clean.order_num = null;
    clean.order = null;
    return clean;
  }

  function clearOrderTrackingStorage() {
    try { localStorage.removeItem(orderStorageKey()); } catch(e) {}
    try { localStorage.removeItem(storageKey()); } catch(e) {}
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('acompanhar');
      window.history.replaceState({}, '', u.toString());
    } catch(e) {}
  }

  function resetOrderContextForNextOrder() {
    state.order = null;
    state.orderId = 0;
    state.orderNum = null;
    state.payment = null;
    state.follow = null;
    if (state.thread) state.thread = stripThreadOrder(state.thread);
    clearOrderTrackingStorage();
  }

  function applyFinalOrderReset(order) {
    if (!isFinalOrder(order)) return false;
    resetOrderContextForNextOrder();
    return true;
  }

  function cachedMessages() {
    return (state.messages || []).slice(-80).map(m => ({
      id: m.id,
      sender: m.sender,
      body: m.body,
      created_at: m.created_at,
      author_name: m.author_name,
      kind: m.kind
    })).filter(m => m.body);
  }

  function restoreCachedState(data) {
    if (!data) return;
    if (data.storeName) state.storeName = data.storeName;
    if (Array.isArray(data.messages) && data.messages.length) {
      state.messages = [];
      mergeMessages(data.messages);
    }
    if (data.payment) state.payment = data.payment;
    if (data.follow) state.follow = data.follow;
    if (typeof data.open === 'boolean') state.open = data.open;
  }

  function saveSession() {
    if (!state.tid || !hasTrackingContext()) return;
    try {
      localStorage.setItem(storageKey(), JSON.stringify({
        orderId: state.orderId,
        threadId: state.thread?.id || state.threadId || null,
        orderNum: state.orderNum,
        orderStatus: activeOrderFromState()?.status || '',
        phone: state.phone,
        client: state.client,
        storeName: state.storeName || storeName(),
        open: !!state.open,
        messages: cachedMessages(),
        payment: state.payment || null,
        follow: state.follow || null,
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
      #ef-chat-root{position:fixed;right:16px;bottom:calc(22px + env(safe-area-inset-bottom,0px));z-index:370;font-family:'DM Sans',system-ui,sans-serif}
      #ef-chat-root.efc-open{inset:0;right:0;bottom:0;z-index:2147483000;pointer-events:none}
      #ef-chat-root.efc-open .efc-panel{pointer-events:auto;z-index:2147483001}
      #ef-chat-root.efc-open .efc-bubble,#ef-chat-root.efc-open .efc-nudges{display:none!important}
      body.ef-chat-open #track-fab,body.ef-chat-open .track-fab,body.ef-chat-open #track-drawer-bg{display:none!important;pointer-events:none!important;visibility:hidden!important}
      body.ef-chat-open #cart-float{pointer-events:none}
      #ef-chat-root.efc-cart-on{bottom:calc(86px + env(safe-area-inset-bottom,0px))}
      .efc-bubble{width:54px;height:54px;border:none;border-radius:50%;background:var(--accent,#f97316);color:#fff;display:none;align-items:center;justify-content:center;box-shadow:0 12px 30px rgba(0,0,0,.28);cursor:pointer;position:relative;transition:transform .18s,box-shadow .18s}
      .efc-bubble.on{display:flex}
      .efc-bubble:hover{transform:translateY(-2px);box-shadow:0 16px 36px rgba(0,0,0,.32)}
      .efc-badge{position:absolute;right:-3px;top:-4px;min-width:19px;height:19px;border-radius:99px;background:#ef4444;color:#fff;font-size:11px;font-weight:800;display:none;align-items:center;justify-content:center;border:2px solid #fff;padding:0 5px}
      .efc-badge.on{display:flex}
      .efc-nudges{position:absolute;right:64px;bottom:0;width:min(268px,calc(100vw - 92px));display:none;flex-direction:column;align-items:flex-end;gap:7px;pointer-events:none}
      .efc-nudge{position:relative;width:100%;border:none;border-radius:15px;background:#fff;color:#111827;text-align:left;padding:10px 12px 10px 13px;box-shadow:0 14px 40px rgba(15,23,42,.22);border:1px solid rgba(15,23,42,.1);cursor:pointer;pointer-events:auto;overflow:visible}
      .efc-nudge:after{content:"";display:none;position:absolute;right:-7px;bottom:18px;width:14px;height:14px;background:#fff;border-right:1px solid rgba(15,23,42,.1);border-bottom:1px solid rgba(15,23,42,.1);transform:rotate(-45deg)}
      .efc-nudge:last-child:after{display:block}
      .efc-nudge strong{display:block;font-size:12.5px;font-weight:900;line-height:1.15;margin-bottom:2px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .efc-nudge span{display:block;font-size:11.2px;font-weight:650;line-height:1.28;color:#64748b;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .efc-nudge.promo{border-color:rgba(var(--accent-rgb,249,115,22),.24);background:linear-gradient(135deg,#fff,#fff7ed)}
      .efc-nudge.promo strong{color:var(--accent,#f97316)}
      .efc-nudge.item{background:linear-gradient(135deg,#fff,#eff6ff);border-color:rgba(14,165,233,.22)}
      .efc-nudge.ai{background:linear-gradient(135deg,#fff,#ecfeff);border-color:rgba(6,182,212,.2)}
      #ef-chat-root.efc-show-nudge .efc-nudges{display:flex;animation:efNudgeIn .34s cubic-bezier(.2,.9,.22,1)}
      .efc-panel{position:absolute;right:0;bottom:66px;width:min(360px,calc(100vw - 24px));height:min(520px,calc(var(--efc-vh,100vh) - 126px));background:#fff;color:#111827;border:1px solid rgba(15,23,42,.12);border-radius:18px;box-shadow:0 22px 70px rgba(15,23,42,.28);display:none;overflow:hidden;flex-direction:column;z-index:2}
      .efc-panel.on{display:flex}
      .efc-head{height:58px;background:#111827;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 14px 0 16px;gap:10px}
      .efc-head>div{min-width:0;flex:1}
      .efc-title{font-size:14px;font-weight:850;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .efc-sub{display:block;font-size:11.5px;color:rgba(255,255,255,.72);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
      .efc-close{width:32px;height:32px;border:none;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 32px;position:relative;z-index:20}
      .efc-order{padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e5e7eb;font-size:12px;color:#475569;line-height:1.35}
      .efc-order strong{color:#111827}
      .efc-start{display:none;padding:14px;background:#fff;border-bottom:1px solid #e5e7eb}
      .efc-start.on{display:block}
      .efc-start-title{font-size:13px;font-weight:900;color:#111827;margin-bottom:4px}
      .efc-start-text{font-size:12px;color:#64748b;line-height:1.35;margin-bottom:10px}
      .efc-start-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
      .efc-start input{height:38px;border:1px solid #d1d5db;border-radius:11px;padding:0 11px;font:500 12.5px 'DM Sans',system-ui,sans-serif;outline:none;color:#111827;background:#fff;min-width:0}
      .efc-start input:focus{border-color:var(--accent,#f97316);box-shadow:0 0 0 3px rgba(var(--accent-rgb,249,115,22),.12)}
      .efc-start button{height:38px;border:none;border-radius:11px;background:var(--accent,#f97316);color:#fff;font:850 12.5px 'DM Sans',system-ui,sans-serif;cursor:pointer;width:100%}
      .efc-msgs{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:14px 12px;background:#f3f4f6;display:flex;flex-direction:column;gap:8px}
      .efc-empty{margin:auto;text-align:center;color:#64748b;font-size:12.5px;line-height:1.35;max-width:230px}
      .efc-msg{max-width:86%;padding:9px 11px;border-radius:14px;font-size:13px;line-height:1.35;word-break:break-word;box-shadow:0 1px 1px rgba(15,23,42,.06)}
      .efc-msg.client{align-self:flex-end;background:var(--accent,#f97316);color:#fff;border-bottom-right-radius:5px}
      .efc-msg.store{align-self:flex-start;background:#fff;color:#111827;border-bottom-left-radius:5px}
      .efc-msg.system{align-self:center;background:#e0f2fe;color:#075985;border:1px solid #bae6fd;box-shadow:none;font-size:12px;text-align:center;border-radius:10px}
      .efc-time{font-size:10px;opacity:.7;margin-top:4px;text-align:right}
      .efc-quick{align-self:flex-start;max-width:94%;display:flex;flex-wrap:wrap;gap:7px;margin:-2px 0 4px 2px}
      .efc-chip{min-height:32px;border:1px solid rgba(14,165,233,.28);border-radius:999px;background:#fff;color:#0f172a;padding:7px 11px;font:800 12px 'DM Sans',system-ui,sans-serif;cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,.06);transition:transform .15s,border-color .15s,background .15s}
      .efc-chip:hover{transform:translateY(-1px);border-color:var(--accent,#f97316)}
      .efc-chip.on{background:rgba(var(--accent-rgb,249,115,22),.12);border-color:var(--accent,#f97316);color:#111827}
      .efc-chip.primary{background:var(--accent,#f97316);border-color:var(--accent,#f97316);color:#fff}
      .efc-chip.ghost{background:#f8fafc;color:#475569}
      .efc-chip:disabled{opacity:.45;cursor:not-allowed;transform:none}
      .efc-card{align-self:stretch;background:#fff;border:1px solid rgba(15,23,42,.1);border-radius:14px;padding:12px;box-shadow:0 1px 2px rgba(15,23,42,.06);color:#111827}
      .efc-card-kicker{font-size:10.5px;font-weight:900;color:var(--accent,#f97316);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px}
      .efc-card-title{font-size:14px;font-weight:900;line-height:1.2;margin-bottom:5px}
      .efc-card-text{font-size:12.2px;color:#64748b;line-height:1.4;margin-bottom:10px}
      .efc-card-actions{display:flex;gap:7px;flex-wrap:wrap}
      .efc-pay-qr{width:154px;height:154px;margin:8px auto 10px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden}
      .efc-pay-qr img{width:100%;height:100%;display:block;object-fit:contain}
      .efc-pay-code{display:flex;gap:7px;align-items:stretch;margin:8px 0 10px}
      .efc-pay-code input{flex:1;min-width:0;height:36px;border:1px solid #d1d5db;border-radius:10px;background:#f8fafc;color:#111827;padding:0 10px;font:700 11px ui-monospace,SFMono-Regular,Consolas,monospace;overflow:hidden;text-overflow:ellipsis}
      .efc-pay-btn{min-height:36px;border:none;border-radius:10px;background:var(--accent,#f97316);color:#fff;padding:0 12px;font:850 12px 'DM Sans',system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none}
      .efc-pay-btn.wa{background:#128c7e}
      .efc-pay-btn.ghost{background:#f1f5f9;color:#334155}
      .efc-pay-status{font-size:12px;font-weight:800;color:#64748b;margin-top:2px}
      .efc-pay-status.ok{color:#16a34a}
      .efc-pay-status.err{color:#dc2626}
      .efc-form{display:flex;align-items:flex-end;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff;flex-shrink:0}
      .efc-input{flex:1;min-width:0;min-height:40px;height:40px;max-height:112px;border:1px solid #d1d5db;border-radius:12px;padding:10px 12px;font:500 13px/1.35 'DM Sans',system-ui,sans-serif;outline:none;color:#111827;background:#fff;resize:none;overflow-y:auto;white-space:pre-wrap}
      .efc-input:focus{border-color:var(--accent,#f97316);box-shadow:0 0 0 3px rgba(var(--accent-rgb,249,115,22),.12)}
      .efc-send{width:42px;height:40px;border:none;border-radius:12px;background:var(--accent,#f97316);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
      .efc-send:disabled{opacity:.45;cursor:not-allowed}
      .ef-follow-layer{position:fixed;inset:0;z-index:3900;display:flex;align-items:flex-end;justify-content:center;padding:18px;pointer-events:none}
      .ef-follow-card{width:min(430px,calc(100vw - 28px));background:#fff;color:#111827;border:1px solid rgba(15,23,42,.12);border-radius:20px;box-shadow:0 24px 80px rgba(15,23,42,.28);display:grid;grid-template-columns:74px minmax(0,1fr);gap:14px;padding:16px;position:relative;pointer-events:auto;animation:efFollowIn .42s cubic-bezier(.2,.9,.22,1)}
      .ef-follow-close{position:absolute;right:10px;top:10px;width:28px;height:28px;border:none;border-radius:50%;background:#f1f5f9;color:#475569;display:flex;align-items:center;justify-content:center;cursor:pointer}
      .ef-follow-bot{width:64px;height:64px;border-radius:20px;background:linear-gradient(145deg,#e0f2fe,#ecfeff);border:1px solid #bae6fd;box-shadow:inset 0 -8px 18px rgba(14,165,233,.12);position:relative;align-self:center;animation:efBotFloat 2.4s ease-in-out infinite}
      .ef-follow-bot:before{content:"";position:absolute;left:29px;top:-12px;width:6px;height:14px;border-radius:99px;background:#0ea5e9}
      .ef-follow-bot:after{content:"";position:absolute;left:24px;top:-18px;width:16px;height:8px;border-radius:99px;background:#22c55e;box-shadow:0 0 14px rgba(34,197,94,.45)}
      .ef-follow-eye{position:absolute;top:25px;width:9px;height:9px;border-radius:50%;background:#0f172a;animation:efBotBlink 4s infinite}
      .ef-follow-eye.left{left:18px}
      .ef-follow-eye.right{right:18px}
      .ef-follow-mouth{position:absolute;left:22px;right:22px;bottom:18px;height:4px;border-radius:99px;background:#38bdf8}
      .ef-follow-kicker{font-size:11px;font-weight:900;color:var(--accent,#f97316);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px}
      .ef-follow-title{font-size:16px;font-weight:900;line-height:1.2;padding-right:22px}
      .ef-follow-text{font-size:12.5px;color:#64748b;line-height:1.42;margin-top:5px}
      .ef-follow-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
      .ef-follow-btn{height:38px;border:none;border-radius:12px;padding:0 13px;font:800 12.5px 'DM Sans',system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:7px}
      .ef-follow-btn.primary{background:var(--accent,#f97316);color:#fff}
      .ef-follow-btn.wa{background:#128c7e;color:#fff}
      @keyframes efNudgeIn{from{opacity:0;transform:translateX(14px) scale(.97)}to{opacity:1;transform:translateX(0) scale(1)}}
      @keyframes efFollowIn{from{opacity:0;transform:translateY(42px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
      @keyframes efBotFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
      @keyframes efBotBlink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.18)}}
      @media(max-width:520px){
        #ef-chat-root{right:10px;bottom:calc(14px + env(safe-area-inset-bottom,0px))}
        #ef-chat-root.efc-cart-on{bottom:calc(76px + env(safe-area-inset-bottom,0px))}
        .efc-bubble{width:52px;height:52px}
        .efc-nudges{right:60px;bottom:2px;width:min(244px,calc(100vw - 88px))}
        .efc-nudge{padding:9px 10px}
        .efc-nudge:nth-child(n+2){display:none}
        .efc-nudge:after{display:block}
        .efc-nudge strong{font-size:12px}
        .efc-nudge span{font-size:10.8px}
        .efc-panel{position:fixed;left:0;right:0;bottom:calc(var(--efc-kb,0px) + env(safe-area-inset-bottom,0px));width:100vw;height:calc(var(--efc-vh,100vh) - 8px - env(safe-area-inset-bottom,0px));max-height:none;border-left:none;border-right:none;border-bottom:none;border-radius:18px 18px 0 0}
        #ef-chat-root.efc-open .efc-panel{top:0!important;left:0!important;right:0!important;bottom:calc(var(--efc-kb,0px) + env(safe-area-inset-bottom,0px))!important;width:100vw!important;height:auto!important;border-radius:0!important}
        .efc-head{height:54px;padding-left:14px;padding-right:12px;position:relative;z-index:4}
        #ef-chat-root.efc-open .efc-head{height:calc(56px + env(safe-area-inset-top,0px));padding-top:env(safe-area-inset-top,0px)}
        .efc-close{width:38px;height:38px;flex-basis:38px}
        .efc-sub{max-width:100%}
        .efc-order{padding:9px 12px;font-size:11.8px}
        .efc-start{padding:12px}
        .efc-start-row{grid-template-columns:1fr}
        .efc-start input{height:42px;font-size:16px}
        .efc-start button{height:42px;font-size:14px}
        .efc-msgs{padding:12px 10px;gap:7px}
        .efc-msg{max-width:88%;font-size:13px}
        .efc-quick{max-width:100%;gap:6px;margin-left:0}
        .efc-chip{min-height:34px;padding:7px 10px;font-size:12px}
        .efc-card{border-radius:12px;padding:11px}
        .efc-card-actions .efc-pay-btn{flex:1;min-width:132px}
        .efc-pay-code input{font-size:12px}
        .efc-form{padding:8px 8px calc(8px + env(safe-area-inset-bottom,0px));gap:7px}
        .efc-input{min-height:46px;height:46px;max-height:118px;border-radius:12px;font-size:16px;padding:11px 12px}
        .efc-send{width:44px;height:44px;border-radius:12px}
        .ef-follow-layer{align-items:flex-end;padding:12px}
        .ef-follow-card{grid-template-columns:58px minmax(0,1fr);gap:10px;padding:14px}
        .ef-follow-bot{width:54px;height:54px;border-radius:18px}
        .ef-follow-eye{top:22px}
        .ef-follow-eye.left{left:15px}
        .ef-follow-eye.right{right:15px}
      }
      @media(max-width:360px){
        .efc-card-actions .efc-pay-btn{flex-basis:100%;width:100%}
        .efc-pay-code{flex-direction:column}
        .efc-pay-code .efc-pay-btn{width:100%}
      }`;
    document.head.appendChild(style);
  }

  function updateViewportVars() {
    try {
      const vv = window.visualViewport;
      const h = Math.max(320, Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight || 0));
      const w = Math.max(280, Math.round(vv?.width || window.innerWidth || document.documentElement.clientWidth || 0));
      const layoutH = Math.max(h, Math.round(window.innerHeight || document.documentElement.clientHeight || h));
      const offsetTop = Math.max(0, Math.round(vv?.offsetTop || 0));
      const keyboard = Math.max(0, layoutH - h - offsetTop);
      document.documentElement.style.setProperty('--efc-vh', h + 'px');
      document.documentElement.style.setProperty('--efc-vw', w + 'px');
      document.documentElement.style.setProperty('--efc-kb', keyboard + 'px');
      document.documentElement.style.setProperty('--efc-vv-top', offsetTop + 'px');
    } catch(e) {}
  }

  function scrollMessagesToBottom(delay) {
    const run = () => {
      const msgs = document.getElementById('ef-chat-msgs');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    };
    if (delay) setTimeout(run, delay);
    else requestAnimationFrame(run);
  }

  function setTrackingSuppressed(on) {
    try {
      const fab = document.getElementById('track-fab');
      if (fab) {
        if (on) {
          fab.dataset.efChatSuppressed = '1';
          fab.style.setProperty('display', 'none', 'important');
          fab.style.setProperty('visibility', 'hidden', 'important');
          fab.style.setProperty('pointer-events', 'none', 'important');
        } else if (fab.dataset.efChatSuppressed === '1') {
          delete fab.dataset.efChatSuppressed;
          fab.style.removeProperty('display');
          fab.style.removeProperty('visibility');
          fab.style.removeProperty('pointer-events');
        }
      }
      const drawer = document.getElementById('track-drawer-bg');
      if (drawer) {
        if (on) drawer.classList.remove('on');
        drawer.style.pointerEvents = on ? 'none' : '';
        drawer.style.visibility = on ? 'hidden' : '';
      }
    } catch(e) {}
  }

  function guardTrackingOverlay(ev) {
    if (!state.open) return;
    const target = ev?.target;
    if (!target?.closest) return;
    if (target.closest('#track-fab,.track-fab,#track-drawer-bg')) {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      closePanel();
    }
  }

  function installViewportHandling() {
    if (viewportHandlingInstalled) {
      updateViewportVars();
      return;
    }
    viewportHandlingInstalled = true;
    updateViewportVars();
    const refresh = () => {
      updateViewportVars();
      if (state.open) scrollMessagesToBottom(60);
    };
    window.addEventListener('resize', refresh, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(refresh, 250), { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', refresh, { passive: true });
      window.visualViewport.addEventListener('scroll', refresh, { passive: true });
    }
    document.addEventListener('focusin', ev => {
      const el = ev.target;
      if (el && (el.id === 'ef-chat-input' || el.id === 'ef-chat-start-name' || el.id === 'ef-chat-start-phone')) {
        refresh();
        scrollMessagesToBottom(220);
      }
    });
  }

  function autoSizeChatInput() {
    const input = document.getElementById('ef-chat-input');
    if (!input) return;
    const min = window.matchMedia && window.matchMedia('(max-width:520px)').matches ? 46 : 40;
    const max = window.matchMedia && window.matchMedia('(max-width:520px)').matches ? 118 : 112;
    input.style.height = min + 'px';
    const next = Math.max(min, Math.min(input.scrollHeight || min, max));
    input.style.height = next + 'px';
    input.style.overflowY = (input.scrollHeight || 0) > max ? 'auto' : 'hidden';
    if (state.open) scrollMessagesToBottom(40);
  }

  function handleInputKeydown(ev) {
    if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return;
    ev.preventDefault();
    const form = document.getElementById('ef-chat-form');
    if (form?.requestSubmit) form.requestSubmit();
    else form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }

  function compactName(name, max) {
    const text = String(name || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length <= max) return text;
    return text.slice(0, max - 1).trim() + '...';
  }

  function readMenuItems() {
    try {
      if (typeof allItems !== 'undefined' && Array.isArray(allItems)) return allItems;
    } catch(e) {}
    return Array.isArray(window._cardapioItems) ? window._cardapioItems : [];
  }

  function readCoupons() {
    try {
      if (typeof allCupons !== 'undefined' && Array.isArray(allCupons)) return allCupons;
    } catch(e) {}
    return Array.isArray(window._cardapioCupons) ? window._cardapioCupons : [];
  }

  function readCats() {
    try {
      if (typeof allCats !== 'undefined' && Array.isArray(allCats)) return allCats;
    } catch(e) {}
    return Array.isArray(window._cardapioCats) ? window._cardapioCats : [];
  }

  function nudgePriceText(item) {
    const price = parseFloat(item?.price || 0) || 0;
    return price > 0 ? ' por R$ ' + fmtMoney(price) : '';
  }

  function buildSmartNudges() {
    return [];
  }

  function renderNudges() {
    const wrap = document.getElementById('ef-chat-nudges');
    if (!wrap) return 0;
    const nudges = buildSmartNudges();
    const total = nudges.length;
    if (!total) {
      wrap.innerHTML = '';
      return 0;
    }
    const start = total ? (state.nudgeIndex % total) : 0;
    const ordered = nudges.slice(start).concat(nudges.slice(0, start));
    const visible = ordered.slice(0, Math.min(3, ordered.length));
    wrap.innerHTML = visible.map(n => `
      <button class="efc-nudge ${esc(n.kind || 'ai')}" type="button" data-nudge-prompt="${esc(n.prompt || '')}">
        <strong>${esc(n.title)}</strong>
        <span>${esc(n.text)}</span>
      </button>`).join('');
    return total;
  }

  function installNudgeRotation() {
    if (nudgeTimer) return;
    nudgeTimer = setInterval(() => {
      if (!document.getElementById('ef-chat-root')) return;
      if (state.open || state.phone) return;
      state.nudgeIndex = (state.nudgeIndex + 1) % 20;
      renderNudges();
    }, 6500);
  }

  function updateStartText() {
    const el = document.getElementById('ef-chat-start-text');
    if (!el) return;
    el.textContent = 'O chat fica disponivel para acompanhar um pedido ja realizado.';
  }

  function handleNudgeClick(ev) {
    ev.preventDefault();
  }

  function ensureDom() {
    if (document.getElementById('ef-chat-root')) {
      installViewportHandling();
      return;
    }
    injectStyle();
    installViewportHandling();
    const root = document.createElement('div');
    root.id = 'ef-chat-root';
    root.innerHTML = `
      <div class="efc-nudges" id="ef-chat-nudges"></div>
      <button class="efc-bubble" id="ef-chat-bubble" type="button" title="Acompanhar pedido" aria-label="Acompanhar pedido">
        <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3v2.2M8.2 5.4l-.9-1.5M15.8 5.4l.9-1.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          <rect x="4.2" y="6" width="15.6" height="13" rx="5" stroke="currentColor" stroke-width="1.7"/>
          <circle cx="9.2" cy="12.2" r="1.15" fill="currentColor"/>
          <circle cx="14.8" cy="12.2" r="1.15" fill="currentColor"/>
          <path d="M9.2 16h5.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          <path d="M19.8 11h1.4M2.8 11h1.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
        </svg>
        <span class="efc-badge" id="ef-chat-badge"></span>
      </button>
      <div class="efc-panel" id="ef-chat-panel">
        <div class="efc-head">
          <div>
            <div class="efc-title" id="ef-chat-title">Chat da loja</div>
            <div class="efc-sub" id="ef-chat-sub">Pedido</div>
          </div>
          <button class="efc-close" id="ef-chat-close" type="button" title="Fechar" aria-label="Fechar">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="efc-order" id="ef-chat-order"></div>
        <form class="efc-start" id="ef-chat-start">
          <div class="efc-start-title">Chat de acompanhamento</div>
          <div class="efc-start-text" id="ef-chat-start-text">O chat fica disponivel para acompanhar um pedido ja realizado.</div>
          <div class="efc-start-row">
            <input id="ef-chat-start-name" autocomplete="name" enterkeyhint="next" placeholder="Seu nome">
            <input id="ef-chat-start-phone" autocomplete="tel" inputmode="tel" enterkeyhint="done" placeholder="WhatsApp">
          </div>
          <button type="submit">Acompanhar pedido</button>
        </form>
        <div class="efc-msgs" id="ef-chat-msgs"></div>
        <form class="efc-form" id="ef-chat-form">
          <textarea class="efc-input" id="ef-chat-input" maxlength="1000" autocomplete="off" enterkeyhint="send" rows="1" placeholder="Mensagem para a loja"></textarea>
          <button class="efc-send" id="ef-chat-send" type="submit" title="Enviar" aria-label="Enviar">
            <svg width="17" height="17" viewBox="0 0 18 18" fill="none"><path d="M2 9l13-6-3.4 12-2.5-5.1L2 9Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          </button>
        </form>
      </div>`;
    document.body.appendChild(root);
    document.getElementById('ef-chat-nudges').addEventListener('click', handleNudgeClick);
    document.getElementById('ef-chat-bubble').addEventListener('click', openPanel);
    document.getElementById('ef-chat-close').addEventListener('click', closePanel);
    document.addEventListener('pointerdown', guardTrackingOverlay, true);
    document.addEventListener('click', guardTrackingOverlay, true);
    document.getElementById('ef-chat-form').addEventListener('submit', sendMessage);
    document.getElementById('ef-chat-input').addEventListener('input', autoSizeChatInput);
    document.getElementById('ef-chat-input').addEventListener('keydown', handleInputKeydown);
    document.getElementById('ef-chat-start').addEventListener('submit', startChat);
    document.getElementById('ef-chat-msgs').addEventListener('click', handleQuickReplyClick);
    state.ready = true;
    installNudgeRotation();
    renderTitle();
  }

  function messageTime(m) {
    try {
      if (!m.created_at) return '';
      const iso = String(m.created_at).replace(' ', 'T');
      const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    } catch { return ''; }
  }

  function mergeMessages(rows) {
    const byId = new Map(state.messages.map((m, idx) => [Number(m.id), idx]));
    (rows || []).forEach(m => {
      if (!m) return;
      const id = Number(m.id);
      if (byId.has(id)) {
        state.messages[byId.get(id)] = Object.assign({}, state.messages[byId.get(id)], m);
        return;
      }
      state.messages.push(m);
      byId.set(id, state.messages.length - 1);
    });
    state.messages.sort((a,b) => Number(a.id || 0) - Number(b.id || 0));
  }

  function isAssistantMessage(m) {
    if (!m || m.sender === 'client') return false;
    const author = normText(m.author_name || '');
    const kind = normText(m.kind || '');
    return author.includes('estimaia') || kind === 'assistant' || kind === 'status';
  }

  function cleanQuickValue(label) {
    return String(label || '')
      .replace(/\s+(gratis|grátis)$/i, '')
      .replace(/\s*\+\s*R\$\s*[\d.,]+.*$/i, '')
      .replace(/\s*-\s*R\$\s*[\d.,]+.*$/i, '')
      .trim();
  }

  function parseNumberedOptions(body) {
    const rows = [];
    String(body || '').split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*(\d{1,2})\.\s+(.+?)\s*$/);
      if (!m) return;
      const label = m[2].trim();
      const value = cleanQuickValue(label);
      if (value) rows.push({ label, value });
    });
    return rows.slice(0, 12);
  }

  function quickRepliesFor(m) {
    if (!isAssistantMessage(m)) return null;
    const body = String(m.body || '');
    const n = normText(body);
    if (/pedido guiado|adicionad[ao]|adicional|qual tamanho da pizza|forma de pagamento|confirmar pedido|finalizar pedido|ver cardapio|mande "?cardapio"?|escreva o nome do item|entrega ou retirada|retirada ou mesa/i.test(n)) {
      return null;
    }
    const buttons = [];

    if (/localizacao|gps|distancia|distancia|enviar localizacao/i.test(n)) {
      return {
        type: 'single',
        buttons: [
          { label: 'Enviar localizacao', value: 'localizacao', action: 'location', primary: true },
          { label: 'Digitar endereco', value: 'vou digitar o endereco', ghost: true }
        ]
      };
    }

    const bairroSug = body.match(/Voce quis dizer:\s*([^?]+)\?/i) || body.match(/Você quis dizer:\s*([^?]+)\?/i);
    if (bairroSug) {
      const opts = bairroSug[1].split(',').map(x => x.trim()).filter(Boolean).slice(0, 3);
      if (opts.length) {
        return { type: 'single', buttons: opts.map(x => ({ label: x, value: x })) };
      }
    }

    const sizeAsk = body.match(/Qual tamanho da pizza\s+(.+?)\?/i);
    if (sizeAsk) {
      const pizza = sizeAsk[1].trim();
      return {
        type: 'single',
        buttons: [
          { label: 'Pequena', value: 'pizza pequena ' + pizza },
          { label: 'Media', value: 'pizza media ' + pizza },
          { label: 'Grande', value: 'pizza grande ' + pizza }
        ]
      };
    }

    const numbered = parseNumberedOptions(body);
    if (numbered.length) {
      const multi = /\bescolha ate\b|\bescolha até\b|\bminimo\b|\bmínimo\b/i.test(body);
      const opts = numbered.map(o => ({ label: o.label, value: o.value }));
      if (/responda\s+"sem"|responda\s+'sem'|sem esse adicional/i.test(body)) {
        opts.push({ label: 'Sem adicional', value: 'sem', ghost: true });
      }
      return { type: multi ? 'multi' : 'single', buttons: opts };
    }

    if (/vai ser entrega ou retirada|entrega ou retirada|entrega, retirada ou mesa|retirada ou mesa/i.test(n)) {
      return { type: 'single', buttons: [
        { label: 'Entrega', value: 'entrega' },
        { label: 'Retirada', value: 'retirada' },
        { label: 'Mesa', value: 'mesa' }
      ] };
    }

    if (/forma de pagamento|qual sera a forma de pagamento/i.test(n)) {
      return { type: 'single', buttons: [
        { label: 'Pix', value: 'pix' },
        { label: 'Dinheiro', value: 'dinheiro' },
        { label: 'Credito', value: 'credito' },
        { label: 'Debito', value: 'debito' }
      ] };
    }

    if (/confirmar pedido|enviar para a loja|deseja adicionar mais algum item ou finalizar|adicionar mais algum item ou finalizar/i.test(n)) {
      buttons.push({ label: 'Ver cardapio', value: 'cardapio', ghost: true });
      buttons.push({ label: 'Finalizar pedido', value: 'confirmar pedido', primary: true });
      return { type: 'single', buttons };
    }

    if (/escreva o nome do item|mande \"cardapio\"|mande "cardapio"|ver algumas opcoes/i.test(n)) {
      return { type: 'single', buttons: [
        { label: 'Ver cardapio', value: 'cardapio' },
        { label: 'Falar com atendente', value: 'falar com atendente', ghost: true }
      ] };
    }

    return null;
  }

  function latestQuickMessageId() {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const m = state.messages[i];
      if (quickRepliesFor(m)) return Number(m.id);
      if (m?.sender === 'client') return null;
    }
    return null;
  }

  function quickRepliesHtml(m, lastQuickId) {
    if (Number(m.id) !== Number(lastQuickId)) return '';
    const cfg = quickRepliesFor(m);
    if (!cfg?.buttons?.length) return '';
    const mid = String(m.id);
    const selected = state.quickSelections[mid] || [];
    const chips = cfg.buttons.map((b, idx) => {
      const on = selected.includes(b.value) ? ' on' : '';
      const cls = 'efc-chip' + on + (b.primary ? ' primary' : '') + (b.ghost ? ' ghost' : '');
      return `<button type="button" class="${cls}" data-quick-mid="${esc(mid)}" data-quick-type="${esc(cfg.type)}" data-quick-value="${esc(b.value)}" ${b.action ? `data-quick-action="${esc(b.action)}"` : ''}>${esc(b.label)}</button>`;
    }).join('');
    const send = cfg.type === 'multi'
      ? `<button type="button" class="efc-chip primary" data-quick-send="${esc(mid)}" ${selected.length ? '' : 'disabled'}>Enviar escolhas</button>`
      : '';
    return `<div class="efc-quick" data-quick-wrap="${esc(mid)}">${chips}${send}</div>`;
  }

  function fmtMoney(v) {
    const n = parseFloat(v || 0) || 0;
    try { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    catch { return n.toFixed(2).replace('.', ','); }
  }

  function currentOrderId() {
    return Number(state.orderId || state.thread?.order_id || state.order?.id || 0);
  }

  function normalizePaymentPayload(payload) {
    payload = payload || {};
    const orderId = Number(payload.orderId || payload.order_id || payload.id || state.orderId || 0);
    const orderNum = payload.orderNum || payload.order_num || state.orderNum || '';
    const amount = parseFloat(payload.amount || payload.valor || payload.total || 0) || 0;
    const qrB64 = String(payload.qr_code_base64 || payload.qrCodeBase64 || '').replace(/[\r\n\s"]/g, '');
    return {
      orderId,
      orderNum,
      mode: payload.mode || payload.type || (payload.pix_key ? 'manual' : 'online'),
      status: payload.status || 'waiting',
      amount,
      amountText: payload.amountText || (amount ? 'R$ ' + fmtMoney(amount) : ''),
      qr_code: payload.qr_code || payload.qrCode || '',
      qr_code_base64: qrB64,
      pix_key: payload.pix_key || payload.pixKey || '',
      pix_key_tipo: payload.pix_key_tipo || payload.pixKeyTipo || '',
      bank: payload.bank || payload.banco || '',
      mp_payment_id: payload.mp_payment_id || payload.mpPaymentId || '',
      waLink: payload.waLink || payload.whatsappLink || '',
      proofWaLink: payload.proofWaLink || payload.comprovanteWaLink || ''
    };
  }

  function paymentMatches(card) {
    if (!card) return false;
    const oid = currentOrderId();
    return !card.orderId || !oid || Number(card.orderId) === Number(oid);
  }

  function paymentQrSrc(card) {
    const raw = String(card?.qr_code_base64 || '').trim();
    if (!raw) return '';
    return raw.startsWith('data:image/') ? raw : `data:image/png;base64,${raw}`;
  }

  function paymentCode(card) {
    return card?.qr_code || card?.pix_key || '';
  }

  function paymentCardHtml() {
    const card = state.payment;
    if (!paymentMatches(card)) return '';
    const mode = card.mode === 'manual' ? 'manual' : 'online';
    const code = paymentCode(card);
    const qrSrc = paymentQrSrc(card);
    const isPaid = card.status === 'paid' || card.status === 'aprovado';
    const isFailed = card.status === 'failed' || card.status === 'rejeitado' || card.status === 'cancelado';
    const isLoading = card.status === 'loading';
    const title = mode === 'manual' ? 'Pagamento via Pix manual' : 'Pagamento via Pix';
    const codeLabel = mode === 'manual' ? 'Chave Pix' : 'Pix copia e cola';
    const statusClass = isPaid ? ' ok' : (isFailed ? ' err' : '');
    const statusText = isPaid
      ? 'Pagamento confirmado. Seu pedido sera preparado pela loja.'
      : isFailed
        ? 'Pagamento nao confirmado. Fale com a loja ou tente outra forma.'
        : isLoading
          ? 'Gerando o Pix para pagamento...'
          : (mode === 'manual' ? 'Apos pagar, envie o comprovante para a loja.' : 'Aguardando confirmacao do pagamento.');
    return `<div class="efc-card efc-pay-card">
      <div class="efc-card-kicker">Pagamento</div>
      <div class="efc-card-title">${esc(title)}${card.amountText ? ' - ' + esc(card.amountText) : ''}</div>
      <div class="efc-card-text">${mode === 'manual'
        ? 'Transfira para a chave abaixo. O pedido entra em preparo apos a conferencia da loja.'
        : 'Escaneie o QR Code no app do seu banco ou copie o codigo Pix.'}</div>
      ${qrSrc ? `<div class="efc-pay-qr"><img src="${esc(qrSrc)}" alt="QR Code Pix"></div>` : (card.qr_code ? '<div class="efc-pay-qr" data-chat-qrcode="1"></div>' : '')}
      ${code ? `<div style="font-size:11px;font-weight:800;color:#64748b;margin-bottom:5px">${esc(codeLabel)}</div>
        <div class="efc-pay-code">
          <input readonly value="${esc(code)}" aria-label="${esc(codeLabel)}">
          <button type="button" class="efc-pay-btn" data-chat-copy="pix">Copiar</button>
        </div>` : ''}
      <div class="efc-card-actions">
        ${mode === 'manual' && card.proofWaLink ? `<button type="button" class="efc-pay-btn wa" data-chat-wa="${esc(card.proofWaLink)}">Enviar comprovante</button>` : ''}
        ${card.waLink ? `<button type="button" class="efc-pay-btn ghost" data-chat-wa="${esc(card.waLink)}">Acompanhar no WhatsApp</button>` : ''}
      </div>
      <div class="efc-pay-status${statusClass}">${esc(statusText)}</div>
    </div>`;
  }

  function followCardHtml() {
    const f = state.follow;
    if (!f || f.chosen || !paymentMatches(f)) return '';
    const num = f.orderNum ? '#' + String(f.orderNum).padStart(3, '0') : '';
    return `<div class="efc-card">
      <div class="efc-card-kicker">Acompanhe seu pedido</div>
      <div class="efc-card-title">${num ? 'Pedido ' + esc(num) + ' recebido' : 'Pedido recebido'}</div>
      <div class="efc-card-text">Voce pode acompanhar as atualizacoes em tempo real por aqui na EstimaIA ou ativar o acompanhamento pelo WhatsApp.</div>
      <div class="efc-card-actions">
        <button type="button" class="efc-pay-btn" data-follow-choice="chat">Acompanhar pela EstimaIA</button>
        ${f.waLink ? `<button type="button" class="efc-pay-btn wa" data-follow-choice="wa">Acompanhar pelo WhatsApp</button>` : ''}
      </div>
    </div>`;
  }

  function extraCardsHtml() {
    return [paymentCardHtml(), followCardHtml()].filter(Boolean).join('');
  }

  async function copyText(text) {
    text = String(text || '');
    if (!text) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      if (typeof toast === 'function') toast('OK', 'Copiado.');
      return true;
    } catch(e) {
      if (typeof toast === 'function') toast('Erro', 'Nao foi possivel copiar.');
      return false;
    }
  }

  async function renderPaymentQrFallback() {
    const el = document.querySelector('[data-chat-qrcode="1"]');
    if (!el || el.dataset.done === '1' || !state.payment?.qr_code) return;
    el.dataset.done = '1';
    try {
      const QRCodeLib = window.QRCode || (typeof _ensureQRCodeLib === 'function' ? await _ensureQRCodeLib() : null);
      if (!QRCodeLib) throw new Error('QRCode indisponivel');
      el.innerHTML = '';
      new QRCodeLib(el, { text: state.payment.qr_code, width: 154, height: 154, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCodeLib.CorrectLevel?.M });
    } catch(e) {
      el.innerHTML = '<span style="font-size:12px;color:#64748b;text-align:center;padding:12px">Use o codigo copia e cola abaixo.</span>';
    }
  }

  async function handleQuickReplyClick(ev) {
    const copyBtn = ev.target.closest('[data-chat-copy]');
    if (copyBtn) {
      await copyText(paymentCode(state.payment));
      return;
    }

    const waBtn = ev.target.closest('[data-chat-wa]');
    if (waBtn) {
      const link = waBtn.getAttribute('data-chat-wa') || '';
      if (link) window.open(link, '_blank', 'noopener');
      return;
    }

    const followBtn = ev.target.closest('[data-follow-choice]');
    if (followBtn) {
      const choice = followBtn.getAttribute('data-follow-choice');
      if (choice === 'wa') {
        const link = state.follow?.waLink || '';
        if (link) window.open(link, '_blank', 'noopener');
        if (state.follow) state.follow.chosen = 'wa';
        saveSession();
        render();
        return;
      }
      if (choice === 'chat') {
        if (state.follow) state.follow.chosen = 'chat';
        saveSession();
        render();
        await sendChatText('Acompanhar pela EstimaIA');
        return;
      }
    }

    const sendBtn = ev.target.closest('[data-quick-send]');
    if (sendBtn) {
      const mid = sendBtn.getAttribute('data-quick-send');
      const selected = state.quickSelections[mid] || [];
      if (!selected.length) return;
      const body = selected.includes('sem') ? 'sem' : selected.join(' e ');
      const ok = await sendQuickReply(body, sendBtn);
      if (ok) delete state.quickSelections[mid];
      return;
    }

    const btn = ev.target.closest('[data-quick-value]');
    if (!btn) return;
    const mid = btn.getAttribute('data-quick-mid');
    const type = btn.getAttribute('data-quick-type') || 'single';
    const value = String(btn.getAttribute('data-quick-value') || '').trim();
    const action = String(btn.getAttribute('data-quick-action') || '').trim();
    if (!mid || !value) return;

    if (action === 'location') {
      await sendCurrentLocation(btn);
      return;
    }

    if (type === 'multi') {
      const current = state.quickSelections[mid] || [];
      if (value === 'sem') {
        state.quickSelections[mid] = current.includes(value) ? [] : ['sem'];
      } else {
        const withoutSkip = current.filter(v => v !== 'sem');
        state.quickSelections[mid] = withoutSkip.includes(value)
          ? withoutSkip.filter(v => v !== value)
          : withoutSkip.concat(value);
      }
      render();
      return;
    }

    sendQuickReply(value, btn);
  }

  function render() {
    ensureDom();
    updateViewportVars();
    renderTitle();
    const root = document.getElementById('ef-chat-root');
    const bubble = document.getElementById('ef-chat-bubble');
    const panel = document.getElementById('ef-chat-panel');
    const badge = document.getElementById('ef-chat-badge');
    const msgs = document.getElementById('ef-chat-msgs');
    const orderBox = document.getElementById('ef-chat-order');
    const sub = document.getElementById('ef-chat-sub');
    const startBox = document.getElementById('ef-chat-start');
    const form = document.getElementById('ef-chat-form');
    const hasTenant = !!(state.tid || tid());
    const hasSession = hasTrackingContext();
    const nudgeCount = renderNudges();
    if (!hasSession && state.open) state.open = false;
    const panelOpen = state.open && hasSession;
    updateStartText();
    bubble.classList.toggle('on', hasSession);
    panel.classList.toggle('on', panelOpen);
    root.classList.toggle('efc-open', panelOpen);
    document.body.classList.toggle('ef-chat-open', panelOpen);
    setTrackingSuppressed(panelOpen);
    root.classList.toggle('efc-cart-on', !!document.getElementById('cart-float')?.classList.contains('show'));

    const unread = Math.max(0, Number(state.unread || state.thread?.unread_client || 0));
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.classList.toggle('on', unread > 0);
    root.classList.toggle('efc-show-nudge', false);

    const order = activeOrderFromState() || {};
    const num = state.orderNum || order.order_num || order.num || '';
    const label = order.status_label || '';
    sub.textContent = num ? ('Pedido #' + num) : (hasSession ? 'Pedido em acompanhamento' : 'EstimaIA');
    if (hasSession) {
      orderBox.innerHTML = num
        ? `<strong>Pedido #${esc(num || '')}</strong>${label ? ' - ' + esc(label) : ''}${order.items_text ? '<br>' + esc(order.items_text) : ''}`
        : '<strong>Pedido em acompanhamento</strong><br>O numero publico sera exibido assim que estiver disponivel.';
    } else {
      orderBox.innerHTML = '<strong>Chat de acompanhamento</strong><br>O chat fica disponivel depois que o pedido e realizado.';
    }
    if (startBox) startBox.classList.toggle('on', false);
    if (form) form.style.display = hasSession ? 'flex' : 'none';
    if (!hasSession) {
      msgs.innerHTML = '<div class="efc-empty">Depois que houver um pedido, as mensagens aparecem aqui.</div>';
      return;
    }

    const extras = extraCardsHtml();
    if (!state.messages.length && !extras) {
      msgs.innerHTML = '<div class="efc-empty">As mensagens do pedido aparecem aqui.</div>';
      return;
    }
    const lastQuickId = latestQuickMessageId();
    const messageHtml = state.messages.map(m => {
      const cls = m.sender === 'client' ? 'client' : (m.sender === 'system' ? 'system' : 'store');
      return `<div class="efc-msg ${cls}">
        <div>${esc(m.body)}</div>
        ${m.sender !== 'system' ? `<div class="efc-time">${esc(messageTime(m))}</div>` : ''}
      </div>${quickRepliesHtml(m, lastQuickId)}`;
    }).join('');
    msgs.innerHTML = messageHtml + extras;
    renderPaymentQrFallback();
    autoSizeChatInput();
    scrollMessagesToBottom();
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
    if (!hasTrackingContext()) {
      state.open = false;
      if (typeof toast === 'function') toast('Chat', 'O chat fica disponivel apos realizar um pedido.');
      render();
      return;
    }
    state.open = true;
    try { document.getElementById('track-drawer-bg')?.classList.remove('on'); } catch(e) {}
    setTrackingSuppressed(true);
    ensureNotificationPermission();
    updateViewportVars();
    saveSession();
    render();
    fillStartFromProfile();
    markRead();
    const focusInput = () => {
      const input = document.getElementById('ef-chat-input');
      if (!input) return;
      input.focus({ preventScroll: true });
      scrollMessagesToBottom(180);
    };
    setTimeout(focusInput, 80);
  }

  function closePanel() {
    state.open = false;
    try { document.body.classList.remove('ef-chat-open'); } catch(e) {}
    try { document.getElementById('ef-chat-root')?.classList.remove('efc-open'); } catch(e) {}
    setTrackingSuppressed(false);
    saveSession();
    render();
  }

  function fillStartFromProfile() {
    try {
      const profile = JSON.parse(localStorage.getItem('ef_profile_' + (state.tid || tid() || '')) || 'null') || {};
      const oldOrder = readJson(orderStorageKey()) || {};
      const name = profile.name || oldOrder.client || state.client || '';
      const phone = profile.phone || oldOrder.phone || state.phone || '';
      const nEl = document.getElementById('ef-chat-start-name');
      const pEl = document.getElementById('ef-chat-start-phone');
      if (nEl && !nEl.value) nEl.value = name;
      if (pEl && !pEl.value) pEl.value = phone;
    } catch(e) {}
  }

  async function startChat(ev) {
    ev.preventDefault();
    if (typeof toast === 'function') toast('Chat', 'O chat fica disponivel apos realizar um pedido.');
    return;
  }

  async function sendChatText(body, btn) {
    body = String(body || '').trim();
    if (!body || !hasTrackingContext()) return false;
    const oldOrderId = state.orderId || 0;
    if (btn) btn.disabled = true;
    try {
      const r = await api('/api/chat/send', {
        method: 'POST',
        body: JSON.stringify({ thread_id: state.thread?.id || state.threadId || null, order_id: state.orderId || 0, phone: state.phone, sender: 'client', body, client: state.client })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || 'Falha ao enviar');
      if (data.thread) state.thread = data.thread;
      state.threadId = state.thread?.id || state.threadId;
      if (data.thread?.order_id != null) state.orderId = data.thread.order_id;
      if (data.thread?.order_num) state.orderNum = data.thread.order_num;
      if (data.order) state.order = data.order;
      if (data.order?.id) state.orderId = data.order.id;
      if (data.message) mergeMessages([data.message]);
      const finalReset = applyFinalOrderReset(data.order || data.thread?.order || null);
      saveSession();
      if (finalReset || Number(state.orderId || 0) !== Number(oldOrderId || 0)) connectSSE();
      render();
      return true;
    } catch(e) {
      if (typeof toast === 'function') toast('Erro', e?.message || 'Nao foi possivel enviar a mensagem.');
      return false;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function sendMessage(ev) {
    ev.preventDefault();
    const input = document.getElementById('ef-chat-input');
    const btn = document.getElementById('ef-chat-send');
    const ok = await sendChatText(input?.value || '', btn);
    if (ok && input) {
      input.value = '';
      autoSizeChatInput();
    }
  }

  function sendQuickReply(value, btn) {
    return sendChatText(value, btn);
  }

  function chatReadGlobal(name) {
    try {
      if (name === '_storeLat' && typeof _storeLat !== 'undefined') return _storeLat;
      if (name === '_storeLng' && typeof _storeLng !== 'undefined') return _storeLng;
    } catch(e) {}
    return window[name];
  }

  function chatDistKm(lat1, lon1, lat2, lon2) {
    const toRad = v => Number(v) * Math.PI / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function reverseGeoForChat(lat, lng) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1&accept-language=pt-BR`, {
        headers: { 'Accept': 'application/json' }
      });
      const data = await r.json().catch(() => ({}));
      const a = data?.address || {};
      const rua = a.road || a.pedestrian || a.footway || a.path || '';
      const bairro = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.village || '';
      const cidade = a.city || a.town || a.municipality || '';
      return [rua, bairro, cidade].filter(Boolean).join(', ');
    } catch(e) {
      return '';
    }
  }

  async function sendCurrentLocation(btn) {
    if (!navigator.geolocation) {
      if (typeof toast === 'function') toast('Erro', 'Este aparelho nao permite enviar localizacao.');
      return false;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Obtendo...';
    }
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
      });
      const lat = Number(pos.coords.latitude);
      const lng = Number(pos.coords.longitude);
      const storeLat = Number(chatReadGlobal('_storeLat') || 0);
      const storeLng = Number(chatReadGlobal('_storeLng') || 0);
      const dist = storeLat && storeLng ? chatDistKm(storeLat, storeLng, lat, lng) : null;
      const approx = await reverseGeoForChat(lat, lng);
      const linhas = [
        'Localizacao confirmada pelo cliente.',
        'Latitude: ' + lat.toFixed(6),
        'Longitude: ' + lng.toFixed(6),
        dist != null ? 'Distancia da loja: ' + dist.toFixed(2) + ' km' : '',
        approx ? 'Endereco aproximado: ' + approx : ''
      ].filter(Boolean);
      return sendChatText(linhas.join('\n'), btn);
    } catch(e) {
      const msg = e?.code === 1 ? 'Permissao de localizacao negada.' : 'Nao foi possivel obter a localizacao.';
      if (typeof toast === 'function') toast('Localizacao', msg);
      return false;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Enviar localizacao';
      }
    }
  }

  function connectSSE() {
    if (state.sse) {
      try { state.sse.close(); } catch(e) {}
      state.sse = null;
    }
    if (!state.tid || !state.phone || typeof EventSource === 'undefined') return;
    const channelOrder = state.orderId || 0;
    const channel = `chat-client:${state.tid}:${channelOrder}:${digits(state.phone)}`;
    const es = new EventSource('/sse/' + encodeURIComponent(channel));
    es.addEventListener('chat:message', ev => {
      try {
        const data = JSON.parse(ev.data || '{}');
        if (state.thread?.id && data?.thread?.id && Number(data.thread.id) !== Number(state.thread.id)) return;
        if (data.thread) state.thread = data.thread;
        if (data.order) state.order = data.order;
        if (data.order?.id) state.orderId = data.order.id;
        if (data.message) {
          const alreadyHad = state.messages.some(m => Number(m.id) === Number(data.message.id));
          mergeMessages([data.message]);
          if (!alreadyHad && data.message.sender !== 'client') {
            playChatSound();
            if (document.hidden || !state.open) showBrowserNotification(storeName(), data.message.body || 'Seu pedido foi atualizado.');
          }
          if (!state.open && data.message.sender !== 'client') state.unread = Math.max(state.unread || 0, Number(state.thread?.unread_client || 0));
        }
        const finalReset = applyFinalOrderReset(data.order || data.thread?.order || null);
        saveSession();
        if (finalReset) connectSSE();
        render();
      } catch(e) {}
    });
    es.addEventListener('chat:read', ev => {
      try {
        const data = JSON.parse(ev.data || '{}');
        if (state.thread?.id && data?.thread?.id && Number(data.thread.id) !== Number(state.thread.id)) return;
        if (data.thread) state.thread = data.thread;
        state.unread = Number(state.thread?.unread_client || 0);
        const finalReset = applyFinalOrderReset(data.thread?.order || null);
        if (finalReset) saveSession();
        if (finalReset) connectSSE();
        render();
      } catch(e) {}
    });
    es.onerror = () => {};
    state.sse = es;
  }

  async function bootstrap(openAfter) {
    if (state.booting || !state.tid || !state.phone || trackingOrderId() <= 0) return;
    state.booting = true;
    ensureDom();
    render();
    try {
      let r;
      if (state.orderId) {
        const qs = new URLSearchParams({ order_id: state.orderId, phone: state.phone });
        r = await api('/api/chat/bootstrap?' + qs.toString());
      } else if (state.threadId) {
        const qs = new URLSearchParams({ thread_id: state.threadId, phone: state.phone });
        r = await api('/api/chat/messages?' + qs.toString());
      } else {
        const qs = new URLSearchParams({ phone: state.phone, client: state.client || '' });
        r = await api('/api/chat/bootstrap?' + qs.toString());
      }
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || 'Chat indisponivel');
      const serverOrder = data.order || data.thread?.order || null;
      state.thread = data.thread || null;
      state.threadId = state.thread?.id || state.threadId || null;
      state.order = serverOrder;
      state.orderId = data.order?.id || data.thread?.order_id || state.orderId || 0;
      state.orderNum = data.order?.order_num || data.thread?.order_num || state.orderNum;
      state.unread = Number(state.thread?.unread_client || 0);
      const incoming = Array.isArray(data.messages) ? data.messages : [];
      if (incoming.length || !state.messages.length) {
        state.messages = [];
        mergeMessages(incoming);
      }
      applyFinalOrderReset(serverOrder);
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

  function closeFollowPrompt() {
    const el = document.getElementById('ef-follow-prompt');
    if (el) el.remove();
  }

  function whatsappLinkFromPayload(payload) {
    payload = payload || {};
    if (payload.waLink) return payload.waLink;
    const btn = document.getElementById('success-wa-btn');
    if (btn?.href && !btn.href.endsWith('#')) return btn.href;
    try {
      if (typeof buildWaLink === 'function') {
        return buildWaLink(payload.orderId || payload.id || state.orderId, payload.orderNum || payload.order_num || state.orderNum);
      }
    } catch(e) {}
    return '';
  }

  function normalizeFollowPayload(payload) {
    payload = payload || {};
    return {
      orderId: payload.orderId || payload.id || state.orderId,
      orderNum: payload.orderNum || payload.order_num || state.orderNum,
      phone: digits(payload.phone || state.phone),
      client: payload.client || state.client || '',
      storeName: payload.storeName || payload.store_name || storeName()
    };
  }

  function showFollowPrompt(payload) {
    payload = payload || {};
    showOrderCreated(payload, { open: true });
    return;
    ensureDom();
    const data = normalizeFollowPayload(payload);
    if (data.storeName) setStoreName(data.storeName);
    if (data.orderId && data.phone) {
      state.tid = tid();
      state.orderId = data.orderId;
      state.orderNum = data.orderNum;
      state.phone = data.phone;
      state.client = data.client;
      saveSession();
      bootstrap(false);
    }

    closeFollowPrompt();
    const link = whatsappLinkFromPayload(payload);
    const showWa = !!link && payload.whatsappEnabled !== false;
    const loja = storeName();
    const layer = document.createElement('div');
    layer.id = 'ef-follow-prompt';
    layer.className = 'ef-follow-layer';
    layer.innerHTML = `
      <div class="ef-follow-card" role="dialog" aria-live="polite" aria-label="Acompanhar pedido">
        <button class="ef-follow-close" type="button" data-ef-follow-close title="Fechar" aria-label="Fechar">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
        <div class="ef-follow-bot" aria-hidden="true">
          <span class="ef-follow-eye left"></span>
          <span class="ef-follow-eye right"></span>
          <span class="ef-follow-mouth"></span>
        </div>
        <div>
          <div class="ef-follow-kicker">Acompanhe seu pedido</div>
          <div class="ef-follow-title">Pedido recebido</div>
          <div class="ef-follow-text">Escolha por onde deseja acompanhar as atualizações em tempo real da ${esc(loja)}.</div>
          <div class="ef-follow-actions">
            ${showWa ? '<button class="ef-follow-btn wa" type="button" data-ef-follow-wa>WhatsApp</button>' : ''}
            <button class="ef-follow-btn primary" type="button" data-ef-follow-chat>EstimaIA</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(layer);
    layer.addEventListener('click', ev => {
      if (ev.target === layer || ev.target.closest('[data-ef-follow-close]')) closeFollowPrompt();
    });
    layer.querySelector('[data-ef-follow-chat]')?.addEventListener('click', () => {
      closeFollowPrompt();
      if (typeof window.efChatStart === 'function') window.efChatStart(data, { open: true });
      else openPanel();
    });
    layer.querySelector('[data-ef-follow-wa]')?.addEventListener('click', () => {
      closeFollowPrompt();
      if (link) window.open(link, '_blank', 'noopener');
    });
    window.setTimeout(() => {
      const cur = document.getElementById('ef-follow-prompt');
      if (cur === layer) closeFollowPrompt();
    }, 35000);
  }

  window.efChatStart = function(payload, opts) {
    payload = payload || {};
    state.tid = tid();
    state.orderId = payload.orderId || payload.id || state.orderId;
    state.orderNum = payload.orderNum || payload.order_num || state.orderNum;
    state.phone = digits(payload.phone || state.phone);
    state.client = payload.client || state.client || '';
    setStoreName(payload.storeName || payload.store_name || window._storeName || state.storeName);
    state.open = !!(opts && opts.open);
    saveSession();
    bootstrap(state.open);
  };

  function showOrderCreated(payload, opts) {
    payload = payload || {};
    opts = opts || {};
    ensureDom();
    state.tid = tid();
    state.orderId = payload.orderId || payload.id || state.orderId;
    state.orderNum = payload.orderNum || payload.order_num || state.orderNum;
    state.phone = digits(payload.phone || state.phone);
    state.client = payload.client || state.client || '';
    if (payload.storeName || payload.store_name) setStoreName(payload.storeName || payload.store_name);
    state.follow = {
      orderId: Number(state.orderId || 0),
      orderNum: state.orderNum || '',
      waLink: whatsappLinkFromPayload(payload),
      chosen: ''
    };
    state.open = opts.open !== false;
    saveSession();
    bootstrap(state.open);
    render();
    if (state.open) setTimeout(markRead, 250);
  }

  window.efChatShowOrderCreated = showOrderCreated;
  window.efChatShowPayment = function(payload) {
    ensureDom();
    const card = normalizePaymentPayload(payload);
    if (card.orderId) state.orderId = card.orderId;
    if (card.orderNum) state.orderNum = card.orderNum;
    if (payload?.phone) state.phone = digits(payload.phone);
    if (payload?.client) state.client = payload.client;
    if (payload?.storeName || payload?.store_name) setStoreName(payload.storeName || payload.store_name);
    state.payment = card;
    state.open = true;
    saveSession();
    render();
  };
  window.efChatUpdatePayment = function(payload) {
    payload = payload || {};
    if (!state.payment) return;
    const orderId = Number(payload.orderId || payload.order_id || 0);
    if (orderId && state.payment.orderId && Number(state.payment.orderId) !== orderId) return;
    state.payment = Object.assign({}, state.payment, normalizePaymentPayload(Object.assign({}, state.payment, payload)));
    saveSession();
    render();
  };
  window.efChatOpen = openPanel;
  window.efChatSetTenant = setTenantId;
  window.efChatSetStoreName = setStoreName;
  window.efChatShowFollowPrompt = showFollowPrompt;
  window.efChatRefreshNudges = function() {
    ensureDom();
    renderNudges();
    render();
  };

  function bootFromStorage() {
    state.tid = tid();
    if (!state.tid) return false;
    const data = loadSession();
    if (!data) return false;
    state.orderId = data.orderId || 0;
    state.threadId = data.threadId || null;
    state.orderNum = data.orderNum || null;
    state.phone = digits(data.phone);
    state.client = data.client || '';
    restoreCachedState(data);
    render();
    bootstrap(state.open);
    return true;
  }

  installSoundUnlock();

  document.addEventListener('DOMContentLoaded', () => {
    ensureDom();
    installSoundUnlock();
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (bootFromStorage() || tries > 40) clearInterval(timer);
      render();
    }, 500);
  });
})();

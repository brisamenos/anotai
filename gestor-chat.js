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
    const subtitle = document.getElementById('gc-subtitle');
    const fab = document.getElementById('gc-fab');
    if (title) title.textContent = name;
    if (subtitle) subtitle.textContent = 'Atendimento em tempo real';
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
      [587.33, 880, 1174.66].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + idx * 0.075;
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.2, start + 0.014);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.18);
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
      #gestor-chat-root{--gc-bg:#08111f;--gc-surface:#0f1b2d;--gc-surface-2:#142238;--gc-surface-3:#1a2b43;--gc-line:rgba(148,163,184,.17);--gc-line-strong:rgba(125,211,252,.28);--gc-text:#eef6ff;--gc-muted:#9fb0c7;--gc-soft:#d7e5f5;--gc-accent:#08b6d8;--gc-accent-2:#2563eb;--gc-success:#22c55e;--gc-danger:#ef4444;position:fixed;inset:0;z-index:6500;font-family:'DM Sans',system-ui,sans-serif;color:var(--gc-text);pointer-events:none}
      .gc-backdrop{position:fixed;inset:0;z-index:0;border:0;background:rgba(2,8,23,.26);backdrop-filter:blur(1px);display:none;cursor:default;pointer-events:auto}
      .gc-backdrop.on{display:block}
      .gc-fab{width:56px;height:56px;border-radius:18px;border:1px solid rgba(125,211,252,.42);background:linear-gradient(135deg,#08b6d8,#2563eb);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 18px 44px rgba(8,17,31,.46);cursor:pointer;position:fixed;right:18px;bottom:18px;z-index:3;transition:transform .18s ease,box-shadow .18s ease,filter .18s ease;pointer-events:auto}
      #gestor-chat-root.gc-open .gc-fab{display:none!important}
      .gc-fab:hover{transform:translateY(-2px);box-shadow:0 22px 54px rgba(8,17,31,.56);filter:saturate(1.08)}
      .gc-fab:active{transform:translateY(0) scale(.98)}
      .gc-fab svg{filter:drop-shadow(0 5px 10px rgba(15,23,42,.22))}
      .gc-fab-badge{position:absolute;right:-6px;top:-7px;min-width:21px;height:21px;border-radius:99px;background:var(--gc-danger);color:#fff;font-size:11px;font-weight:900;display:none;align-items:center;justify-content:center;border:2px solid #eef6ff;padding:0 5px;box-shadow:0 8px 18px rgba(239,68,68,.35)}
      .gc-fab-badge.on{display:flex}
      .gc-panel{position:fixed;right:16px;top:76px;bottom:16px;width:min(760px,calc(100vw - 108px));min-width:min(640px,calc(100vw - 108px));max-height:calc(100vh - 92px);background:var(--gc-bg);color:var(--gc-text);border:1px solid var(--gc-line-strong);border-radius:18px;box-shadow:0 28px 86px rgba(2,8,23,.52);display:none;overflow:hidden;isolation:isolate;z-index:2;pointer-events:auto}
      .gc-panel::before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 82% 8%,rgba(14,165,233,.16),transparent 32%),linear-gradient(180deg,rgba(255,255,255,.035),transparent 22%);z-index:0}
      .gc-panel.on{display:flex;flex-direction:column;animation:gcPanelIn .18s ease-out}
      @keyframes gcPanelIn{from{opacity:0;transform:translateY(8px) scale(.992)}to{opacity:1;transform:none}}
      .gc-head,.gc-body{position:relative;z-index:1}
      .gc-panel>.gc-head{order:0!important;display:flex!important;visibility:visible!important;opacity:1!important;align-items:center;justify-content:space-between;gap:12px;flex:0 0 58px;min-height:58px;max-height:58px;padding:0 12px 0 14px;border-bottom:1px solid var(--gc-line);background:rgba(15,27,45,.96);backdrop-filter:blur(16px)}
      .gc-head-main{min-width:0;display:flex;flex-direction:column;gap:2px}
      .gc-title{font-size:15px;font-weight:900;line-height:1.12;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff}
      .gc-subtitle{font-size:11.5px;font-weight:700;color:var(--gc-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .gc-head-actions{display:flex;align-items:center;gap:9px;flex-shrink:0}
      .gc-head-count{height:28px;display:flex;align-items:center;border:1px solid rgba(125,211,252,.22);background:rgba(8,182,216,.09);color:#b9ecff;border-radius:999px;padding:0 10px;font-size:11px;font-weight:850;white-space:nowrap}
      .gc-back,.gc-close{width:34px;height:34px;border:1px solid rgba(148,163,184,.18);border-radius:12px;background:rgba(255,255,255,.06);color:var(--gc-text);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .16s ease,border-color .16s ease,transform .16s ease}
      .gc-head-actions .gc-close{display:flex}
      .gc-back{display:none;flex-shrink:0}
      .gc-close:hover,.gc-back:hover{background:rgba(14,165,233,.14);border-color:rgba(125,211,252,.36)}
      .gc-close:active,.gc-back:active{transform:scale(.96)}
      .gc-float-close{position:absolute;right:10px;top:10px;z-index:5;width:36px;height:36px;border:1px solid rgba(148,163,184,.2);border-radius:12px;background:rgba(15,27,45,.92);color:#fff;display:none!important;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 10px 28px rgba(2,8,23,.32)}
      .gc-panel.on .gc-float-close{display:none!important}
      .gc-float-close:hover{background:rgba(14,165,233,.18);border-color:rgba(125,211,252,.38)}
      .gc-panel>.gc-body{order:1!important;flex:1 1 auto;min-height:0;overflow:hidden;display:grid;grid-template-columns:285px minmax(0,1fr)}
      .gc-list-wrap{border-right:1px solid var(--gc-line);min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column;background:rgba(15,27,45,.72)}
      .gc-search{padding:10px;border-bottom:1px solid var(--gc-line)}
      .gc-search input{width:100%;height:36px;border:1px solid rgba(148,163,184,.18);border-radius:10px;background:rgba(8,17,31,.72);color:var(--gc-text);padding:0 11px;font:700 12px 'DM Sans',system-ui,sans-serif;outline:none;box-shadow:inset 0 1px 0 rgba(255,255,255,.035)}
      .gc-search input::placeholder{color:#7588a3}
      .gc-search input:focus{border-color:rgba(8,182,216,.7);box-shadow:0 0 0 3px rgba(8,182,216,.14)}
      .gc-list{flex:1;overflow-y:auto;padding:8px}
      .gc-list::-webkit-scrollbar,.gc-msgs::-webkit-scrollbar{width:8px}
      .gc-list::-webkit-scrollbar-thumb,.gc-msgs::-webkit-scrollbar-thumb{background:rgba(148,163,184,.26);border-radius:999px}
      .gc-item{display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:10px;padding:9px;border:1px solid transparent;border-radius:12px;cursor:pointer;align-items:center;color:var(--gc-text);transition:background .16s ease,border-color .16s ease,transform .16s ease}
      .gc-item+.gc-item{margin-top:5px}
      .gc-item:hover{background:rgba(255,255,255,.045);border-color:rgba(148,163,184,.12)}
      .gc-item.on{background:linear-gradient(135deg,rgba(8,182,216,.2),rgba(37,99,235,.12));border-color:rgba(125,211,252,.34);box-shadow:0 12px 32px rgba(2,8,23,.2)}
      .gc-avatar{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,#d9f99d,#67e8f9 52%,#93c5fd);color:#082f49;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:950;letter-spacing:0}
      .gc-meta{min-width:0}
      .gc-name{font-size:13px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#f8fbff}
      .gc-prev{font-size:11.5px;color:var(--gc-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px;line-height:1.25}
      .gc-side{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
      .gc-time{font-size:10.5px;color:#7f93ad;font-weight:800}
      .gc-unread{min-width:20px;height:20px;border-radius:99px;background:linear-gradient(135deg,#fb7185,#ef4444);color:#fff;font-size:10px;font-weight:950;display:flex;align-items:center;justify-content:center;padding:0 6px;box-shadow:0 8px 18px rgba(239,68,68,.26)}
      .gc-chat{min-width:0;min-height:0;overflow:hidden;display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:#0a1322}
      .gc-context{padding:11px 14px;border-bottom:1px solid var(--gc-line);background:linear-gradient(180deg,rgba(20,34,56,.86),rgba(15,27,45,.72))}
      .gc-context-top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
      .gc-order-main{min-width:0}
      .gc-order-title{font-size:14px;font-weight:950;color:#fff;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .gc-order-sub{font-size:11.8px;color:var(--gc-muted);margin-top:5px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .gc-status{font-size:11px;font-weight:900;color:#a7f3d0;border:1px solid rgba(34,197,94,.24);background:rgba(34,197,94,.1);border-radius:999px;padding:5px 9px;white-space:nowrap;max-width:190px;overflow:hidden;text-overflow:ellipsis}
      .gc-msgs{min-height:0;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:linear-gradient(180deg,rgba(10,19,34,.86),rgba(8,17,31,.98))}
      .gc-empty{margin:auto;color:var(--gc-muted);font-size:13px;text-align:center;line-height:1.45;max-width:280px;padding:18px}
      .gc-list .gc-empty{margin:24px auto}
      .gc-msg-row{width:100%;min-width:0;display:flex;align-items:flex-end}
      .gc-msg-row.client{justify-content:flex-start}
      .gc-msg-row.store{justify-content:flex-end}
      .gc-msg-row.system{justify-content:center}
      .gc-msg-bubble{box-sizing:border-box;display:flex;flex-direction:column;min-width:0;max-width:min(78%,520px);padding:9px 12px;border-radius:15px;font-size:12.8px;line-height:1.36;overflow:hidden;box-shadow:none}
      .gc-msg-row.client .gc-msg-bubble{background:#f8fafc;color:#172033;border:1px solid rgba(226,232,240,.92);border-bottom-left-radius:5px}
      .gc-msg-row.store .gc-msg-bubble{background:linear-gradient(135deg,#09a9d1,#2563eb);color:#fff;border-bottom-right-radius:5px}
      .gc-msg-row.system .gc-msg-bubble{background:rgba(14,165,233,.1);border:1px solid rgba(14,165,233,.23);color:#b9ecff;text-align:center;font-size:11.8px;border-radius:999px;max-width:min(86%,560px);padding:6px 10px}
      .gc-msg-text{display:block;margin:0;min-width:0;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
      .gc-msg-time{display:block;font-size:10px;line-height:1.1;opacity:.72;margin-top:6px;text-align:right;font-weight:850;align-self:flex-end;white-space:nowrap}
      .gc-form{display:flex;gap:9px;padding:13px;border-top:1px solid var(--gc-line);background:rgba(15,27,45,.92)}
      .gc-input{flex:1;min-width:0;height:44px;border:1px solid rgba(148,163,184,.2);border-radius:14px;background:#f8fafc;color:#172033;padding:0 14px;font:700 14px 'DM Sans',system-ui,sans-serif;outline:none}
      .gc-input::placeholder{color:#6b7b91}
      .gc-input:focus{border-color:rgba(8,182,216,.75);box-shadow:0 0 0 3px rgba(8,182,216,.16)}
      .gc-input:disabled{opacity:.58;background:#dbe5ef}
      .gc-send{width:46px;height:44px;border:none;border-radius:14px;background:linear-gradient(135deg,#08b6d8,#2563eb);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 12px 28px rgba(14,165,233,.24);transition:transform .16s ease,filter .16s ease,opacity .16s ease}
      .gc-send:hover{filter:saturate(1.1);transform:translateY(-1px)}
      .gc-send:active{transform:scale(.97)}
      .gc-send:disabled{opacity:.45;cursor:not-allowed;transform:none;filter:none}
      @media(max-width:1040px){
        .gc-panel{left:78px;right:12px;width:auto;min-width:0}
        .gc-panel>.gc-body{grid-template-columns:280px minmax(0,1fr)}
      }
      @media(max-width:760px){
        #gestor-chat-root{right:auto;bottom:auto}
        /* Abinha lateral (não mais botão flutuante em cima da barra de
           baixo/outras ferramentas) — fica encostada na borda direita,
           na metade da altura da tela. */
        .gc-fab{
          right:0;bottom:auto;top:40%;
          width:30px;height:58px;border-radius:14px 0 0 14px;
          box-shadow:-3px 3px 14px rgba(37,99,235,.4);
        }
        .gc-fab svg{width:16px;height:16px}
        .gc-fab-badge{left:-6px;right:auto;top:-6px}
        .gc-panel{position:fixed;left:8px;right:8px;top:58px;bottom:calc(8px + env(safe-area-inset-bottom,0px));width:auto;min-width:0;max-height:calc(100vh - 66px - env(safe-area-inset-bottom,0px));border-radius:18px}
        .gc-panel.on{animation:gcPanelInRight .22s cubic-bezier(.34,1.1,.64,1)}
        @keyframes gcPanelInRight{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}
        .gc-panel>.gc-head{padding:0 10px 0 12px;gap:9px}
        .gc-head-count{display:none}
        .gc-back{display:flex}
        .gc-panel.list-mode .gc-back{display:none}
        .gc-panel>.gc-body{grid-template-columns:1fr}
        .gc-list-wrap{display:none;border-right:0}
        .gc-panel.list-mode .gc-list-wrap{display:flex}
        .gc-panel.list-mode .gc-chat{display:none}
        .gc-list{padding:8px}
        .gc-chat{grid-template-rows:auto minmax(0,1fr) auto}
        .gc-context{padding:12px}
        .gc-context-top{display:block}
        .gc-status{display:inline-flex;margin-top:8px;max-width:100%}
        .gc-msgs{padding:12px;gap:8px}
        .gc-msg-bubble{max-width:88%;font-size:13px}
        .gc-form{padding:10px;gap:8px}
        .gc-input{height:46px;font-size:16px}
        .gc-send{height:46px;width:48px;flex-shrink:0}
      }`;
    document.head.appendChild(style);
  }

  function ensureDom() {
    if (document.getElementById('gestor-chat-root')) return;
    injectStyle();
    const root = document.createElement('div');
    root.id = 'gestor-chat-root';
    root.innerHTML = `
      <button class="gc-backdrop" id="gc-backdrop" type="button" aria-label="Fechar chat"></button>
      <button class="gc-fab" id="gc-fab" type="button" title="Chat clientes" aria-label="Chat clientes">
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none"><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2h9A3.5 3.5 0 0 1 20 5.5v6A3.5 3.5 0 0 1 16.5 15H10l-4.2 3.1c-.7.5-1.8 0-1.8-.9V15A3.5 3.5 0 0 1 .5 11.5v-6Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 7h8M8 10h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        <span class="gc-fab-badge" id="gc-fab-badge"></span>
      </button>
      <div class="gc-panel" id="gc-panel">
        <button class="gc-float-close" id="gc-float-close" type="button" title="Fechar chat" aria-label="Fechar chat">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
        <div class="gc-head">
          <button class="gc-back" id="gc-back" type="button" title="Voltar para conversas" aria-label="Voltar para conversas">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3 5 8l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="gc-head-main">
            <div class="gc-title" id="gc-title">Chat clientes</div>
            <div class="gc-subtitle" id="gc-subtitle">Atendimento em tempo real</div>
          </div>
          <div class="gc-head-actions">
            <div class="gc-head-count" id="gc-count">0 conversas</div>
            <button class="gc-close" id="gc-close" type="button" title="Fechar" aria-label="Fechar">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </button>
          </div>
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
              <input class="gc-input" id="gc-input" maxlength="1000" autocomplete="off" enterkeyhint="send" placeholder="Responder cliente">
              <button class="gc-send" id="gc-send" type="submit" title="Enviar" aria-label="Enviar">
                <svg width="17" height="17" viewBox="0 0 18 18" fill="none"><path d="M2 9l13-6-3.4 12-2.5-5.1L2 9Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
              </button>
            </form>
          </div>
        </div>
      </div>`;
    document.body.appendChild(root);
    document.getElementById('gc-backdrop').addEventListener('click', closePanel);
    document.getElementById('gc-fab').addEventListener('click', togglePanel);
    document.getElementById('gc-close').addEventListener('click', closePanel);
    document.getElementById('gc-float-close').addEventListener('click', closePanel);
    document.getElementById('gc-back').addEventListener('click', () => {
      GCHAT.active = null;
      GCHAT.messages = [];
      renderAll();
    });
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
    document.addEventListener('pointerdown', ev => {
      if (!GCHAT.open) return;
      const panel = document.getElementById('gc-panel');
      const fab = document.getElementById('gc-fab');
      const target = ev.target;
      if (panel?.contains(target) || fab?.contains(target)) return;
      closePanel();
    }, true);
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && GCHAT.open) closePanel();
    });
    GCHAT.ready = true;
    renderTitle();
  }

  function whenText(t) {
    if (!t) return '';
    try {
      const iso = String(t).replace(' ', 'T');
      const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    } catch { return ''; }
  }

  function initials(name) {
    const parts = String(name || 'C').trim().split(/\s+/).filter(Boolean);
    return (parts[0]?.[0] || 'C').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
  }

  function orderNum(thread) {
    const n = thread?.order?.order_num || thread?.order_num || thread?.order?.num || '';
    if (n) return n;
    return '';
  }

  function isPendingOnlinePayment(thread) {
    const status = String(thread?.order?.status || '').toLowerCase();
    const pag = String(thread?.order?.pag || '').toLowerCase();
    return status === 'aguardando_cartao' || (status === 'aguardando_pix' && pag !== 'pix_manual');
  }

  function threadLabel(thread) {
    const n = orderNum(thread);
    if (n) return '#' + n;
    if (isPendingOnlinePayment(thread)) return 'Aguardando pagamento';
    return 'Novo pedido';
  }

  function orderTitle(thread) {
    const n = orderNum(thread);
    if (n) return 'Pedido #' + n;
    if (isPendingOnlinePayment(thread)) return 'Pedido aguardando pagamento';
    return 'Pedido pelo chat';
  }

  function upsertThread(thread) {
    if (!thread) return;
    const idx = GCHAT.threads.findIndex(t => Number(t.id) === Number(thread.id));
    if (idx >= 0) GCHAT.threads[idx] = Object.assign({}, GCHAT.threads[idx], thread);
    else GCHAT.threads.unshift(thread);
    GCHAT.threads.sort((a,b) => String(b.last_at || '').localeCompare(String(a.last_at || '')));
  }

  function mergeMessages(rows) {
    const byId = new Map(GCHAT.messages.map((m, idx) => [Number(m.id), idx]));
    (rows || []).forEach(m => {
      if (!m) return;
      const id = Number(m.id);
      if (byId.has(id)) {
        GCHAT.messages[byId.get(id)] = Object.assign({}, GCHAT.messages[byId.get(id)], m);
        return;
      }
      GCHAT.messages.push(m);
      byId.set(id, GCHAT.messages.length - 1);
    });
    GCHAT.messages.sort((a,b) => Number(a.id || 0) - Number(b.id || 0));
  }

  function renderBadge() {
    const total = GCHAT.threads.reduce((s,t) => s + Number(t.unread_store || 0), 0);
    const badge = document.getElementById('gc-fab-badge');
    const count = document.getElementById('gc-count');
    if (badge) {
      badge.textContent = total > 9 ? '9+' : String(total);
      badge.classList.toggle('on', total > 0);
    }
    if (count) {
      const totalThreads = GCHAT.threads.length;
      const label = totalThreads === 1 ? '1 conversa' : `${totalThreads} conversas`;
      count.textContent = total > 0 ? `${label} | ${total} nova${total > 1 ? 's' : ''}` : label;
    }
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
      ctx.innerHTML = `
        <div class="gc-context-top">
          <div class="gc-order-main">
            <div class="gc-order-title">Selecione uma conversa</div>
            <div class="gc-order-sub">Escolha um cliente na lista para responder, acompanhar o pedido e assumir o atendimento quando precisar.</div>
          </div>
        </div>`;
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
        <div class="gc-order-main">
          <div class="gc-order-title">${esc(orderTitle(t))} - ${esc(t.client || order.client || 'Cliente')}</div>
          <div class="gc-order-sub">${esc(t.phone || order.phone || 'Sem telefone')}${order.items_text ? ' | ' + esc(order.items_text) : ''}</div>
        </div>
        <div class="gc-status">${esc(order.status_label || order.status || 'Atendimento')}</div>
      </div>`;
    if (!GCHAT.messages.length) {
      msgs.innerHTML = '<div class="gc-empty">Nenhuma mensagem ainda.</div>';
      return;
    }
    const rows = (GCHAT.messages || []).slice(-180);
    msgs.innerHTML = rows.map(m => {
      const kind = String(m.kind || '').toLowerCase();
      const cls = (m.sender === 'system' || kind === 'status' || kind === 'system')
        ? 'system'
        : (m.sender === 'store' ? 'store' : 'client');
      return `<div class="gc-msg-row ${cls}">
        <div class="gc-msg-bubble">
          <div class="gc-msg-text">${esc(m.body)}</div>
          ${cls !== 'system' ? `<div class="gc-msg-time">${esc(whenText(m.created_at))}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    msgs.scrollTop = msgs.scrollHeight;
  }

  function renderAll() {
    renderTitle();
    const root = document.getElementById('gestor-chat-root');
    const panel = document.getElementById('gc-panel');
    const backdrop = document.getElementById('gc-backdrop');
    if (root) root.classList.toggle('gc-open', GCHAT.open);
    if (backdrop) backdrop.classList.toggle('on', GCHAT.open);
    if (panel) {
      panel.classList.toggle('on', GCHAT.open);
      panel.classList.toggle('list-mode', GCHAT.open && !GCHAT.active);
      panel.classList.toggle('has-active', !!GCHAT.active);
      panel.setAttribute('aria-hidden', GCHAT.open ? 'false' : 'true');
    }
    try { renderList(); } catch(e) {}
    try { renderActive(); } catch(e) {}
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

  function togglePanel() {
    if (GCHAT.open) closePanel();
    else openPanel();
  }

  function closePanel() {
    GCHAT.open = false;
    document.getElementById('gestor-chat-root')?.classList.remove('gc-open');
    document.getElementById('gc-backdrop')?.classList.remove('on');
    const panel = document.getElementById('gc-panel');
    if (panel) {
      panel.classList.remove('on');
      panel.setAttribute('aria-hidden', 'true');
    }
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

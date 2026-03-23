// ═══════════════════════════════════════════════════════
// WA-CHAT.JS — Chat WhatsApp do Gestor (Evolution API 2.7)
// Tempo real via SSE · Mídia sob demanda · Cache em memória
// ═══════════════════════════════════════════════════════
'use strict';

const WA = {
  open:          false,
  chats:         [],
  filteredChats: [],
  activeJid:     null,
  activeName:    '',
  messages:      [],
  avatarCache:   {},
  mediaCache:    {},
  contactCache:  {},   // jid → { name, phone, pushName }
  pendingFile:   null,
  mediaRecorder: null,
  audioChunks:   [],
  recTimer:      null,
  recSeconds:    0,
  pollTimer:     null,
  sseConn:       null,
  lastMsgTs:     0,

  getJid(c) {
    for (const f of [c.remoteJid, c.id, c.key?.remoteJid, c.lastMessage?.key?.remoteJid])
      if (f && typeof f === 'string' && f.includes('@')) return f;
    return null;
  },

  isReal(jid) {
    if (!jid) return false;
    return (jid.replace(/@.*/,'').replace(/\D/g,'')).length >= 9;
  },

  // Retorna número real do contato (do cache de contatos)
  getRealPhone(jid) {
    const cached = this.contactCache[jid];
    if (cached?.phone) return cached.phone;
    // Extrai do JID diretamente
    const n = (jid||'').replace(/@.*/,'').replace(/\D/g,'');
    return n || '';
  },

  fmtPhone(jid) {
    const n = this.getRealPhone(jid);
    if (!n || n.length < 9) return jid || '';
    if (n.startsWith('55') && n.length >= 12) {
      const ddd = n.slice(2,4), r = n.slice(4);
      if (r.length === 9) return `+55 (${ddd}) ${r.slice(0,5)}-${r.slice(5)}`;
      if (r.length === 8) return `+55 (${ddd}) ${r.slice(0,4)}-${r.slice(4)}`;
    }
    return '+' + n;
  },

  // Nome real do contato — usa cache de contatos ou pushName do chat
  getName(c) {
    const jid    = this.getJid(c);
    const cached = jid ? this.contactCache[jid] : null;
    return cached?.name
        || cached?.pushName
        || c.name
        || c.pushName
        || c.verifiedName
        || (jid ? this.fmtPhone(jid) : '');
  },

  sendNum(jid) {
    let n = this.getRealPhone(jid) || (jid||'').replace(/@.*/,'').replace(/\D/g,'');
    if (n.length <= 11 && !n.startsWith('55')) n = '55' + n;
    return n;
  },

  fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(+ts > 9999999999 ? +ts : +ts * 1000);
    if (isNaN(d)) return '';
    const now = new Date(), diff = now - d;
    if (d.getDate() === now.getDate() && diff < 86400000)
      return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    if (diff < 604800000) return d.toLocaleDateString('pt-BR',{weekday:'short'});
    return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
  },

  fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(+ts > 9999999999 ? +ts : +ts * 1000);
    if (isNaN(d)) return '';
    const now = new Date(), diff = now - d;
    if (d.getDate() === now.getDate() && diff < 86400000) return 'Hoje';
    if (diff < 172800000) return 'Ontem';
    return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'});
  },

  initials(name) {
    if (!name) return '?';
    const stripped = name.replace(/[\s\-\(\)\+]/g,'');
    if (/^\d{6,}$/.test(stripped)) {
      // É um número de telefone — mostra últimos 2 dígitos
      return stripped.slice(-2);
    }
    const p = name.trim().split(' ').filter(Boolean);
    return p.length >= 2
      ? (p[0][0] + p[p.length-1][0]).toUpperCase()
      : (p[0]?.[0] || '?').toUpperCase();
  },

  getTs(c) {
    return c.lastMessage?.messageTimestamp || c.updatedAt || c.lastMessageTimestamp || 0;
  },

  getPreview(c) {
    const lm = c.lastMessage; if (!lm) return '';
    const m  = lm.message || {};
    if (lm.conversation)                return lm.conversation;
    if (m.conversation)                 return m.conversation;
    if (m.extendedTextMessage?.text)    return m.extendedTextMessage.text;
    if (m.imageMessage)                 return '📷 Imagem' + (m.imageMessage.caption ? ': '+m.imageMessage.caption : '');
    if (m.videoMessage)                 return '🎥 Vídeo';
    if (m.audioMessage || m.pttMessage) return '🎵 Áudio';
    if (m.documentMessage)              return '📎 ' + (m.documentMessage.fileName || 'Documento');
    if (m.stickerMessage)               return '🎭 Figurinha';
    if (m.locationMessage)              return '📍 Localização';
    if (Object.keys(m).length > 0)     return '📎 Mídia';
    return '';
  },

  async fetchAvatar(jid) {
    if (this.avatarCache[jid] !== undefined) return this.avatarCache[jid];
    this.avatarCache[jid] = null;
    try {
      const n = (jid||'').replace(/@.*/,'').replace(/\D/g,'');
      if (!n) return null;
      const tid = (typeof _sessao !== 'undefined') ? (_sessao?.tenant_id || '') : '';
      const r   = await fetch('/api/wa/avatar', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
        body:    JSON.stringify({ number: n })
      });
      const data = await r.json().catch(() => ({}));
      const rawUrl = data?.url || null;
      // Usa proxy do servidor para evitar CORS na URL da foto
      const url = rawUrl
        ? `/api/wa/avatar?url=${encodeURIComponent(rawUrl)}`
        : null;
      this.avatarCache[jid] = url;
      return url;
    } catch { return null; }
  },

  async renderAvatar(jid, name, el) {
    if (!el) return;
    const url = await this.fetchAvatar(jid);
    if (!el.isConnected) return;
    const ini = (this.initials(name)||'?').replace(/'/g,"\\'");
    if (url) {
      // Tenta carregar a imagem; se falhar CORS usa iniciais
      const img = new Image();
      img.onload = () => {
        if (!el.isConnected) return;
        el.innerHTML = '';
        el.appendChild(img);
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
      };
      img.onerror = () => { if (el.isConnected) el.textContent = ini; };
      img.src = url;
      img.alt = '';
    } else {
      el.textContent = ini;
    }
  },
};

function waEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function waSbToast(t, m) { if (typeof sbToast === 'function') sbToast(t, m); }

// ─────────────────────────────────────────────────────
// Abrir / Fechar
// ─────────────────────────────────────────────────────
function waOpenPanel() {
  const panel = document.getElementById('wa-panel');
  if (!panel) return;
  panel.style.display = 'flex';
  WA.open = true;
  if (typeof closeNotif === 'function') closeNotif();
  WA.checkConnection().then(() => {
    waFetchContacts(); // busca nomes/números reais dos contatos
    waLoadChats();
  });
  if (!WA.pollTimer) {
    WA.pollTimer = setInterval(() => {
      if (WA.open && WA.activeJid) waLoadMessages(true);
    }, 15000);
  }
}

function waClosePanel() {
  const p = document.getElementById('wa-panel');
  if (p) p.style.display = 'none';
  WA.open = false;
  if (WA.pollTimer) { clearInterval(WA.pollTimer); WA.pollTimer = null; }
}

function waBackToList() { document.getElementById('wa-list-col')?.classList.remove('hidden'); }

// ─────────────────────────────────────────────────────
// SSE — mensagens em tempo real
// ─────────────────────────────────────────────────────
function waConnectSSE() {
  if (WA.sseConn) return;
  try {
    const tid = (typeof _sessao !== 'undefined') ? _sessao?.tenant_id : null;
    if (!tid) return;
    const sse = new EventSource(`/sse/wa-msgs:${tid}`);
    WA.sseConn = sse;

    sse.addEventListener('wa:msg', (e) => {
      try { waOnSseMessage(JSON.parse(e.data)); } catch {}
    });

    sse.onerror = () => {
      sse.close(); WA.sseConn = null;
      setTimeout(waConnectSSE, 5000);
    };
  } catch(e) { console.warn('[WA] SSE erro:', e.message); }
}

// ─────────────────────────────────────────────────────
// Buscar contatos reais da Evolution API (nome + número)
// ─────────────────────────────────────────────────────
async function waFetchContacts() {
  const inst = EVO.instance;
  if (!inst) return;
  try {
    const r = await EVO.req('POST', `/contact/findContacts/${inst}`, { where: {} });
    let contacts = [];
    const d = r.data;
    if      (Array.isArray(d))           contacts = d;
    else if (Array.isArray(d?.contacts)) contacts = d.contacts;
    else if (Array.isArray(d?.data))     contacts = d.data;
    else if (Array.isArray(d?.records))  contacts = d.records;

    contacts.forEach(c => {
      const jid   = c.remoteJid || c.id || c.jid || '';
      if (!jid) return;
      // Número real = parte numérica do remoteJid
      const phone = (c.remoteJid || c.id || '').replace(/@.*/,'').replace(/\D/g,'');
      WA.contactCache[jid] = {
        name:     c.name || c.pushName || c.verifiedName || null,
        pushName: c.pushName || null,
        phone:    phone || null
      };
    });

    // Re-renderiza lista com nomes/números corretos
    if (WA.chats.length) waRenderChatList(WA.chats);
  } catch(e) {
    console.warn('[WA] fetchContacts erro:', e.message);
  }
}


function waOnSseMessage(msg) {
  if (!msg) return;
  const jid    = msg.key?.remoteJid || '';
  const fromMe = msg.key?.fromMe === true || msg.fromMe === true;
  if (!jid || jid.startsWith('status@')) return;

  // Badge só para mensagens RECEBIDAS (não enviadas por mim)
  if (!fromMe && (!WA.open || WA.activeJid !== jid)) waIncrementBadge();

  // Atualiza preview na lista
  waUpdateChatPreview(jid, msg, fromMe);

  // Insere na conversa ativa em tempo real
  if (WA.activeJid === jid) {
    const msgsEl = document.getElementById('wa-messages');
    if (!msgsEl) return;
    const mid = msg.key?.id;
    // Remove mensagem otimista temporária se existir
    if (mid) {
      const existing = msgsEl.querySelector(`[data-msgid="${CSS.escape(mid)}"]`);
      if (existing) return;
    }
    const el = waCreateMsgEl(msg);
    if (el) { msgsEl.appendChild(el); msgsEl.scrollTop = msgsEl.scrollHeight; }
  }
}

function waIncrementBadge() {
  const b = document.getElementById('wa-unread-badge');
  if (!b) return;
  b.textContent = (parseInt(b.textContent)||0) + 1;
  b.style.display = 'flex';
}

function waClearBadge() {
  const b = document.getElementById('wa-unread-badge');
  if (b) { b.textContent = '0'; b.style.display = 'none'; }
}

function waUpdateChatPreview(jid, msg, fromMe) {
  const chat = WA.chats.find(c => WA.getJid(c) === jid);
  if (chat) {
    chat.lastMessage = msg;
    if (!fromMe) chat.unreadCount = (chat.unreadCount || 0) + 1;
    WA.chats = [chat, ...WA.chats.filter(c => WA.getJid(c) !== jid)];
    WA.filteredChats = WA.chats;
    waRenderChatList(WA.chats);
  } else {
    waLoadChats();
  }
}

// ─────────────────────────────────────────────────────
// Verificar conexão
// ─────────────────────────────────────────────────────
WA.checkConnection = async function() {
  const inst = EVO.instance;
  const el   = document.getElementById('wa-conn-status');
  if (!inst) { if (el) el.textContent = '⚠️ Configure a instância no Robô'; return false; }
  try {
    const r     = await EVO.req('GET', `/instance/connectionState/${inst}`);
    const state = r.data?.instance?.state || r.data?.state || '';
    const ok    = state === 'open';
    if (el) el.textContent = ok ? '🟢 Conectado' : `🔴 ${state || 'Desconectado'}`;
    return ok;
  } catch { if (el) el.textContent = '⚠️ Erro de conexão'; return false; }
};

// ─────────────────────────────────────────────────────
// Carregar conversas
// ─────────────────────────────────────────────────────
async function waLoadChats() {
  const listEl = document.getElementById('wa-chat-list');
  if (!listEl) return;
  const inst = EVO.instance;
  if (!inst) {
    listEl.innerHTML = `<div class="wa-empty-state"><p style="color:#94a3b8;font-size:13px;text-align:center">⚠️ Configure a instância no painel <b>Robô</b>.</p></div>`;
    return;
  }
  listEl.innerHTML = `<div class="wa-empty-state"><div class="wa-typing-dots"><span></span><span></span><span></span></div><p style="color:#64748b;font-size:12px;margin-top:10px">Carregando...</p></div>`;

  try {
    let chats = [];
    const r  = await EVO.req('POST', `/chat/findChats/${inst}`, { where: {} });
    const d  = r.data;
    if      (Array.isArray(d))          chats = d;
    else if (Array.isArray(d?.chats))   chats = d.chats;
    else if (Array.isArray(d?.data))    chats = d.data;
    else if (Array.isArray(d?.records)) chats = d.records;
    else {
      const r2 = await EVO.req('GET', `/chat/findChats/${inst}`);
      const d2 = r2.data;
      if      (Array.isArray(d2))         chats = d2;
      else if (Array.isArray(d2?.chats))  chats = d2.chats;
      else if (Array.isArray(d2?.data))   chats = d2.data;
    }

    chats = chats.filter(c => {
      const jid = WA.getJid(c);
      if (!jid) return false;
      if (jid.startsWith('status@')) return false;
      if (jid.includes('broadcast'))  return false;
      if (!WA.isReal(jid))            return false;
      return true;
    });

    chats.sort((a,b) => {
      const ta = WA.getTs(a), tb = WA.getTs(b);
      const na = typeof ta==='number' ? ta : new Date(ta||0).getTime()/1000;
      const nb = typeof tb==='number' ? tb : new Date(tb||0).getTime()/1000;
      return nb - na;
    });

    WA.chats = chats; WA.filteredChats = chats;
    waRenderChatList(chats);
  } catch(e) {
    listEl.innerHTML = `<div class="wa-empty-state"><p style="color:#ef4444;font-size:12px">Erro: ${waEsc(e.message)}</p><button class="wa-btn-primary" style="margin-top:12px" onclick="waLoadChats()">Tentar novamente</button></div>`;
  }
}

// ─────────────────────────────────────────────────────
// Renderizar lista
// ─────────────────────────────────────────────────────
function waRenderChatList(chats) {
  const listEl = document.getElementById('wa-chat-list');
  if (!listEl) return;
  if (!chats.length) {
    listEl.innerHTML = `<div class="wa-empty-state"><p style="color:#64748b;font-size:13px;text-align:center">Nenhuma conversa.<br><br><button class="wa-btn-primary" onclick="waLoadChats()">Atualizar</button></p></div>`;
    return;
  }
  listEl.innerHTML = chats.map((c,i) => {
    const jid    = WA.getJid(c);
    const name   = WA.getName(c);
    const prev   = WA.getPreview(c);
    const time   = WA.fmtTime(WA.getTs(c));
    const unread = c.unreadCount || 0;
    const active = jid === WA.activeJid;
    const sj     = (jid||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const sn     = (name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return `<div class="wa-chat-item${active?' waci-active':''}" onclick="waOpenConversation('${sj}','${sn}')" data-jid="${waEsc(jid)}">
      <div class="wa-chat-avatar" id="wa-av-${i}">${WA.initials(name)}</div>
      <div class="wa-chat-meta">
        <div class="wa-chat-name">${waEsc(name)}</div>
        <div class="wa-chat-preview">${prev ? waEsc(prev) : '<i style="opacity:.4">Sem mensagens</i>'}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
        ${time ? `<div class="wa-chat-time">${time}</div>` : ''}
        ${unread > 0 ? `<div class="wa-unread-dot">${unread > 99 ? '99+' : unread}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  // Carrega avatares em lotes paralelos de 5 (mais rápido que serial com throttle)
  const avatarQueue = chats.map((c, i) => {
    const jid  = WA.getJid(c);
    const name = WA.getName(c);
    // A Evolution API às vezes já inclui a foto no objeto do chat
    const photoInline = c.profilePicture || c.photo || c.profilePictureUrl || null;
    return { jid, name, elId: `wa-av-${i}`, photoInline };
  }).filter(x => x.jid);

  // Aplica fotos inline imediatamente (sem API call)
  avatarQueue.forEach(({ jid, name, elId, photoInline }) => {
    if (!photoInline) return;
    const el = document.getElementById(elId);
    if (!el) return;
    // Guarda no cache para não buscar depois
    if (!WA.avatarCache[jid]) {
      const proxied = `/api/wa/avatar?url=${encodeURIComponent(photoInline)}`;
      WA.avatarCache[jid] = proxied;
      WA.renderAvatar(jid, name, el);
    }
  });

  // Busca via API apenas os que não têm foto inline e não estão em cache
  const needsFetch = avatarQueue.filter(x => !x.photoInline && WA.avatarCache[x.jid] === undefined);

  const loadBatch = async (batch) => {
    await Promise.all(batch.map(async ({ jid, name, elId }) => {
      const el = document.getElementById(elId);
      if (el) await WA.renderAvatar(jid, name, el);
    }));
  };

  // Processa em lotes de 5 com 500ms entre lotes
  (async () => {
    const BATCH = 5;
    for (let i = 0; i < needsFetch.length; i += BATCH) {
      await loadBatch(needsFetch.slice(i, i + BATCH));
      if (i + BATCH < needsFetch.length) await new Promise(r => setTimeout(r, 500));
    }
  })();
}

function waFilterChats(q) {
  const t = (q||'').toLowerCase().trim();
  WA.filteredChats = t
    ? WA.chats.filter(c => {
        const jid  = WA.getJid(c)||'';
        const name = (c.name||c.pushName||'').toLowerCase();
        return name.includes(t) || jid.includes(t);
      })
    : WA.chats;
  waRenderChatList(WA.filteredChats);
}

// ─────────────────────────────────────────────────────
// Abrir conversa
// ─────────────────────────────────────────────────────
async function waOpenConversation(jid, name) {
  WA.activeJid = jid; WA.activeName = name; WA.lastMsgTs = 0;
  waClearBadge();

  const nameEl   = document.getElementById('wa-conv-name');
  const phoneEl  = document.getElementById('wa-conv-phone');
  const avatarEl = document.getElementById('wa-conv-avatar');
  if (nameEl)  nameEl.textContent  = name || WA.fmtPhone(jid);
  if (phoneEl) phoneEl.textContent = WA.fmtPhone(jid);
  if (avatarEl) avatarEl.textContent = WA.initials(name);

  document.getElementById('wa-conv-empty').style.display  = 'none';
  document.getElementById('wa-conv-active').style.display = 'flex';

  if (avatarEl && jid) WA.renderAvatar(jid, name, avatarEl);
  if (window.innerWidth <= 640) document.getElementById('wa-list-col')?.classList.add('hidden');

  document.querySelectorAll('.wa-chat-item').forEach(e => e.classList.remove('waci-active'));
  document.querySelector(`.wa-chat-item[data-jid="${CSS.escape(jid)}"]`)?.classList.add('waci-active');

  const chat = WA.chats.find(c => WA.getJid(c) === jid);
  if (chat) { chat.unreadCount = 0; waRenderChatList(WA.chats); }

  await waLoadMessages();
}

// ─────────────────────────────────────────────────────
// Carregar mensagens
// ─────────────────────────────────────────────────────
async function waLoadMessages(silent = false) {
  if (!WA.activeJid) return;
  const inst   = EVO.instance;
  const msgsEl = document.getElementById('wa-messages');
  const loadEl = document.getElementById('wa-msgs-loading');
  if (!inst || !msgsEl) return;

  if (!silent) {
    msgsEl.innerHTML = '';
    if (loadEl) { loadEl.style.display = 'flex'; msgsEl.appendChild(loadEl); }
  }

  try {
    const r = await EVO.req('POST', `/chat/findMessages/${inst}`, {
      where: { key: { remoteJid: WA.activeJid } }, limit: 60, skip: 0
    });

    let msgs = [];
    const d  = r.data;
    if      (Array.isArray(d))                    msgs = d;
    else if (Array.isArray(d?.records))           msgs = d.records;
    else if (Array.isArray(d?.messages))          msgs = d.messages;
    else if (Array.isArray(d?.messages?.records)) msgs = d.messages.records;

    msgs.sort((a,b) => (a.messageTimestamp||0) - (b.messageTimestamp||0));

    if (silent && msgs.length) {
      const lastTs = msgs[msgs.length-1].messageTimestamp || 0;
      if (lastTs === WA.lastMsgTs) return;
      WA.lastMsgTs = lastTs;
    } else if (msgs.length) {
      WA.lastMsgTs = msgs[msgs.length-1].messageTimestamp || 0;
    }

    if (loadEl) loadEl.style.display = 'none';
    msgsEl.innerHTML = '';

    if (!msgs.length) {
      msgsEl.innerHTML = '<div style="text-align:center;color:#64748b;font-size:12px;padding:30px">Nenhuma mensagem nesta conversa.</div>';
      return;
    }

    let lastDate = '';
    msgs.forEach(msg => {
      const dateStr = WA.fmtDate(msg.messageTimestamp || msg.key?.timestamp);
      if (dateStr && dateStr !== lastDate) {
        lastDate = dateStr;
        const sep = document.createElement('div');
        sep.className = 'wa-date-sep';
        sep.innerHTML = `<span>${dateStr}</span>`;
        msgsEl.appendChild(sep);
      }
      const el = waCreateMsgEl(msg);
      if (el) msgsEl.appendChild(el);
    });

    msgsEl.scrollTop = msgsEl.scrollHeight;
  } catch(e) {
    if (loadEl) loadEl.style.display = 'none';
    if (!silent) msgsEl.innerHTML = `<div style="text-align:center;color:#ef4444;font-size:12px;padding:20px">Erro: ${waEsc(e.message)}</div>`;
  }
}

// ─────────────────────────────────────────────────────
// Criar elemento de mensagem
// ─────────────────────────────────────────────────────
function waCreateMsgEl(msg) {
  // Evolution API 2.7 pode ter fromMe em vários lugares
  // Prioridade: key.fromMe > fromMe top-level > inferido por pushName
  let fromMe = false;
  if (msg.key?.fromMe === true)        fromMe = true;
  else if (msg.key?.fromMe === false)  fromMe = false;
  else if (msg.fromMe === true)        fromMe = true;
  else if (msg.fromMe === false)       fromMe = false;
  // Fallback: se tem pushName, é mensagem recebida (do cliente)
  else if (msg.pushName)               fromMe = false;
  else                                 fromMe = false; // default: recebida
  const ts      = msg.messageTimestamp || msg.key?.timestamp;
  const time    = ts ? new Date((+ts > 9999999999 ? +ts : +ts * 1000)).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '';
  const m       = msg.message || {};
  const msgId   = msg.key?.id || '';
  const remJid  = msg.key?.remoteJid || WA.activeJid || '';

  const text       = m.conversation || m.extendedTextMessage?.text || '';
  const imgMsg     = m.imageMessage;
  const vidMsg     = m.videoMessage;
  const audioMsg   = m.audioMessage || m.pttMessage;
  const docMsg     = m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage;
  const stickerMsg = m.stickerMessage;
  const locMsg     = m.locationMessage;
  const reactMsg   = m.reactionMessage;
  const btnMsg     = m.buttonsResponseMessage || m.templateButtonReplyMessage;
  const listMsg    = m.listResponseMessage;

  const wrap = document.createElement('div');
  wrap.className = `wa-msg ${fromMe ? 'sent' : 'recv'}`;
  if (msgId) wrap.dataset.msgid = msgId;

  const bubble = document.createElement('div');
  bubble.className = 'wa-bubble';

  function dlBtn(type, label, fname) {
    const sj = waEsc(msgId), rj = waEsc(remJid), fn = waEsc(fname||'');
    return `<button class="wa-dl-btn" onclick="waDownloadMedia('${sj}','${rj}','${type}',this,'${fn}')">
      <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 13h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      ${label}
    </button>`;
  }

  function mediaThumb(icon, title, sub, dlType, fname) {
    const cached = msgId ? WA.mediaCache[msgId] : null;
    if (cached) return null; // já baixado — renderiza direto
    return `<div class="wa-media-thumb" id="wamt-${waEsc(msgId)}">
      <span class="wa-media-icon">${icon}</span>
      <div class="wa-media-info">
        <div style="font-size:12.5px;color:#f1f5f9;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${waEsc(title)}</div>
        ${sub ? `<div style="font-size:11px;color:#64748b">${waEsc(sub)}</div>` : ''}
      </div>
      ${dlBtn(dlType, dlType==='audio'?'Ouvir':'Baixar', fname)}
    </div>`;
  }

  // ── Imagem ──
  if (imgMsg) {
    const cap    = imgMsg.caption || '';
    const cached = msgId ? WA.mediaCache[msgId] : null;
    if (cached) {
      bubble.innerHTML = `<img src="data:${cached.mimetype};base64,${cached.base64}" onclick="waViewMedia(this.src)" style="max-width:220px;max-height:180px;border-radius:8px;display:block;cursor:zoom-in">${cap?`<div style="margin-top:4px;font-size:13px">${waEsc(cap)}</div>`:''}`;
    } else {
      const thumb = mediaThumb('🖼️', cap||'Imagem', imgMsg.fileLength ? waFmtBytes(imgMsg.fileLength) : '', 'image');
      bubble.innerHTML = thumb || `<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" style="width:1px;height:1px">`;
    }
  }

  // ── Vídeo ──
  else if (vidMsg) {
    const cap    = vidMsg.caption || '';
    const cached = msgId ? WA.mediaCache[msgId] : null;
    if (cached) {
      bubble.innerHTML = `<video controls style="max-width:220px;max-height:180px;border-radius:8px;display:block"><source src="data:${cached.mimetype};base64,${cached.base64}" type="${cached.mimetype}"></video>${cap?`<div style="margin-top:4px;font-size:13px">${waEsc(cap)}</div>`:''}`;
    } else {
      bubble.innerHTML = mediaThumb('🎥', cap||'Vídeo', vidMsg.fileLength ? waFmtBytes(vidMsg.fileLength) : '', 'video') || '';
    }
  }

  // ── Áudio / PTT ──
  else if (audioMsg) {
    const cached = msgId ? WA.mediaCache[msgId] : null;
    const dur    = audioMsg.seconds ? audioMsg.seconds + 's' : '';
    if (cached) {
      bubble.innerHTML = `<div class="wa-audio-player"><audio controls style="height:32px;width:200px"><source src="data:${cached.mimetype};base64,${cached.base64}" type="${cached.mimetype}"></audio></div>`;
    } else {
      bubble.innerHTML = mediaThumb('🎵', audioMsg.ptt ? 'Mensagem de voz' : 'Áudio', dur, 'audio') || '';
    }
  }

  // ── Documento ──
  else if (docMsg) {
    const fname  = docMsg.fileName || docMsg.title || 'Documento';
    const mime   = docMsg.mimetype || '';
    const icon   = mime.includes('pdf') ? '📄' : mime.includes('sheet')||mime.includes('excel') ? '📊' : mime.includes('word') ? '📝' : '📎';
    const cached = msgId ? WA.mediaCache[msgId] : null;
    if (cached) {
      bubble.innerHTML = `<div class="wa-doc-bubble" onclick="waOpenDoc('${waEsc(msgId)}','${waEsc(fname)}')">
        <span style="font-size:22px">${icon}</span>
        <div><div style="font-size:12.5px;color:#f1f5f9">${waEsc(fname)}</div><div style="font-size:11px;color:#25D366">Toque para abrir</div></div>
      </div>`;
    } else {
      bubble.innerHTML = mediaThumb(icon, fname, docMsg.fileLength ? waFmtBytes(docMsg.fileLength) : mime, 'document', fname) || '';
    }
  }

  // ── Sticker ──
  else if (stickerMsg) { bubble.innerHTML = `<span style="font-size:28px">🎭</span>`; }

  // ── Localização ──
  else if (locMsg) {
    const lat = (locMsg.degreesLatitude  || 0).toFixed(5);
    const lng = (locMsg.degreesLongitude || 0).toFixed(5);
    bubble.innerHTML = `<a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:6px;color:#25D366;text-decoration:none;font-size:13px">📍 Ver localização</a>`;
  }

  // ── Reação ──
  else if (reactMsg) { bubble.innerHTML = `<span style="font-size:26px">${waEsc(reactMsg.text||'👍')}</span>`; }

  // ── Botão / lista ──
  else if (btnMsg||listMsg) {
    bubble.textContent = btnMsg?.selectedButtonId || btnMsg?.selectedId || listMsg?.title || listMsg?.singleSelectReply?.selectedRowId || '(Resposta)';
  }

  // ── Texto ──
  else if (text) {
    bubble.innerHTML = waEsc(text)
      .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
      .replace(/_([^_\n]+)_/g,   '<i>$1</i>')
      .replace(/~([^~\n]+)~/g,   '<s>$1</s>')
      .replace(/\n/g, '<br>');
  }

  else { return null; }

  const timeDiv = document.createElement('div');
  timeDiv.className = 'wa-msg-time';
  timeDiv.innerHTML = time + (fromMe ? ' <span class="wa-check">✓✓</span>' : '');

  wrap.appendChild(bubble);
  wrap.appendChild(timeDiv);
  return wrap;
}

// ─────────────────────────────────────────────────────
// Download de mídia sob demanda
// ─────────────────────────────────────────────────────
async function waDownloadMedia(msgId, remoteJid, type, btn, fileName) {
  if (!msgId || !remoteJid) return;

  // Cache hit
  if (WA.mediaCache[msgId]) { waApplyMedia(msgId, type, fileName); return; }

  const origHTML = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="wa-dl-spin"></span>'; }

  try {
    const tid = (typeof _sessao !== 'undefined') ? (_sessao?.tenant_id || '') : '';
    const r   = await fetch('/api/wa/media', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body:    JSON.stringify({ messageId: msgId, remoteJid })
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok || !data.base64) {
      waSbToast('err', data.error || 'Erro ao baixar mídia');
      if (btn) { btn.disabled = false; btn.innerHTML = origHTML; }
      return;
    }

    WA.mediaCache[msgId] = {
      base64:   data.base64,
      mimetype: data.mimetype || 'application/octet-stream',
      fileName: data.fileName || fileName || 'arquivo'
    };

    waApplyMedia(msgId, type, fileName);

  } catch(e) {
    waSbToast('err', 'Erro: ' + e.message);
    if (btn) { btn.disabled = false; btn.innerHTML = origHTML; }
  }
}

function waApplyMedia(msgId, type, fileName) {
  const c = WA.mediaCache[msgId];
  if (!c) return;
  const src  = `data:${c.mimetype};base64,${c.base64}`;
  const thumb = document.getElementById(`wamt-${msgId}`);
  if (!thumb) return;

  if (type === 'image') {
    thumb.outerHTML = `<img src="${src}" onclick="waViewMedia('${src}')" style="max-width:220px;max-height:180px;border-radius:8px;display:block;cursor:zoom-in">`;
  } else if (type === 'video') {
    thumb.outerHTML = `<video controls style="max-width:220px;max-height:180px;border-radius:8px;display:block"><source src="${src}" type="${c.mimetype}"></video>`;
  } else if (type === 'audio') {
    thumb.outerHTML = `<div class="wa-audio-player"><audio controls style="height:32px;width:200px"><source src="${src}" type="${c.mimetype}"></audio></div>`;
  } else if (type === 'document') {
    const fn   = c.fileName || fileName || 'arquivo';
    const mime = c.mimetype;
    const icon = mime.includes('pdf') ? '📄' : mime.includes('sheet') ? '📊' : mime.includes('word') ? '📝' : '📎';
    thumb.outerHTML = `<div class="wa-doc-bubble" onclick="waOpenDoc('${waEsc(msgId)}','${waEsc(fn)}')">
      <span style="font-size:22px">${icon}</span>
      <div><div style="font-size:12.5px;color:#f1f5f9">${waEsc(fn)}</div><div style="font-size:11px;color:#25D366">Toque para abrir</div></div>
    </div>`;
  }
}

function waOpenDoc(msgId, fileName) {
  const c = WA.mediaCache[msgId];
  if (!c) return;
  const a = document.createElement('a');
  a.href     = `data:${c.mimetype};base64,${c.base64}`;
  a.download = c.fileName || fileName || 'arquivo';
  a.click();
}

function waViewMedia(src) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.93);display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  ov.onclick = () => ov.remove();
  const img = document.createElement('img');
  img.src = src;
  img.style.cssText = 'max-width:92vw;max-height:92vh;border-radius:10px;object-fit:contain';
  ov.appendChild(img);
  document.body.appendChild(ov);
}

function waFmtBytes(b) {
  if (!b) return '';
  if (b < 1024)     return b + ' B';
  if (b < 1048576)  return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}

// ─────────────────────────────────────────────────────
// Enviar texto
// ─────────────────────────────────────────────────────
async function waSendMessage() {
  const inp  = document.getElementById('wa-msg-input');
  const text = (inp?.value || '').trim();
  const inst = EVO.instance;
  if (!inst || !WA.activeJid) { waSbToast('err', 'Nenhuma conversa selecionada'); return; }
  if (WA.pendingFile) { await waSendMedia(); return; }
  if (!text) return;

  inp.value = '';
  waToggleSendMic(false);

  const fake = {
    key: { fromMe: true, id: 'tmp_'+Date.now(), remoteJid: WA.activeJid },
    messageTimestamp: Math.floor(Date.now()/1000),
    message: { conversation: text }
  };
  const msgsEl = document.getElementById('wa-messages');
  const el = waCreateMsgEl(fake);
  if (el && msgsEl) { msgsEl.appendChild(el); msgsEl.scrollTop = msgsEl.scrollHeight; }

  try {
    const num = WA.sendNum(WA.activeJid);
    const r = await EVO.req('POST', `/message/sendText/${inst}`, {
      number: num,
      text,
      textMessage: { text }
    });
    if (!r.ok) waSbToast('err', r.data?.message || r.data?.error || 'Erro ao enviar');
    else setTimeout(() => waLoadMessages(true), 2000);
  } catch(e) { waSbToast('err', 'Erro: ' + e.message); }
}

function waOnTyping(inp) { waToggleSendMic(inp.value.trim().length > 0 || !!WA.pendingFile); }

function waToggleSendMic(has) {
  const s = document.getElementById('wa-send-btn');
  const m = document.getElementById('wa-mic-btn');
  if (s) s.style.display = has ? 'flex' : 'none';
  if (m) m.style.display = has ? 'none'  : 'flex';
}

// ─────────────────────────────────────────────────────
// Seleção de arquivo
// ─────────────────────────────────────────────────────
function waOnFileSelect(evt) {
  const file = evt.target.files?.[0];
  if (!file) return;
  WA.pendingFile = file;
  const prev  = document.getElementById('wa-media-preview');
  const prevI = document.getElementById('wa-preview-img');
  const prevN = document.getElementById('wa-preview-name');
  if (prev)  prev.style.display = 'block';
  if (prevN) prevN.textContent = file.name;
  if (prevI && file.type.startsWith('image/')) {
    const fr = new FileReader();
    fr.onload = e => { prevI.src = e.target.result; prevI.style.display = 'block'; };
    fr.readAsDataURL(file);
  } else if (prevI) prevI.style.display = 'none';
  waToggleSendMic(true);
}

function waClearMedia() {
  WA.pendingFile = null;
  const prev = document.getElementById('wa-media-preview');
  const fi   = document.getElementById('wa-file-input');
  if (prev) prev.style.display = 'none';
  if (fi)   fi.value = '';
  waToggleSendMic((document.getElementById('wa-msg-input')?.value?.trim().length||0) > 0);
}

async function waSendMedia() {
  const file = WA.pendingFile;
  if (!file || !WA.activeJid || !EVO.instance) return;
  const fr = new FileReader();
  fr.onload = async (e) => {
    const b64     = e.target.result.split(',')[1];
    const mime    = file.type || 'application/octet-stream';
    const caption = document.getElementById('wa-msg-input')?.value?.trim() || '';
    let mt = 'document';
    if (mime.startsWith('image/')) mt = 'image';
    else if (mime.startsWith('video/')) mt = 'video';
    else if (mime.startsWith('audio/')) mt = 'audio';
    waClearMedia();
    if (document.getElementById('wa-msg-input')) document.getElementById('wa-msg-input').value = '';
    waToggleSendMic(false);
    try {
      const r = await EVO.req('POST', `/message/sendMedia/${EVO.instance}`, {
        number:    WA.sendNum(WA.activeJid),
        mediatype: mt,
        mimetype:  mime,
        caption,
        media:     b64,
        fileName:  file.name
      });
      if (r.ok) { waSbToast('ok', 'Enviado!'); setTimeout(() => waLoadMessages(true), 2000); }
      else {
        // Fallback: formato alternativo EVO 2.7
        const r2 = await EVO.req('POST', `/message/sendMedia/${EVO.instance}`, {
          number:   WA.sendNum(WA.activeJid),
          mediaMessage: { mediatype: mt, mimetype: mime, caption, media: b64, fileName: file.name }
        });
        if (r2.ok) { waSbToast('ok', 'Enviado!'); setTimeout(() => waLoadMessages(true), 2000); }
        else waSbToast('err', r2.data?.message || r2.data?.error || 'Erro ao enviar mídia');
      }
    } catch(err) { waSbToast('err', 'Erro: '+err.message); }
  };
  fr.readAsDataURL(file);
}

// ─────────────────────────────────────────────────────
// Áudio
// ─────────────────────────────────────────────────────
async function waStartAudio() {
  if (WA.mediaRecorder) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    WA.audioChunks = []; WA.recSeconds = 0;
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    WA.mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
    WA.mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) WA.audioChunks.push(e.data); };
    WA.mediaRecorder.start(100);
    document.getElementById('wa-audio-recording').style.display = 'flex';
    document.getElementById('wa-mic-btn')?.classList.add('recording');
    WA.recTimer = setInterval(() => {
      WA.recSeconds++;
      const el = document.getElementById('wa-rec-time');
      if (el) el.textContent = `${Math.floor(WA.recSeconds/60)}:${String(WA.recSeconds%60).padStart(2,'0')}`;
    }, 1000);
  } catch { waSbToast('err', 'Permita acesso ao microfone'); }
}

async function waStopAudio() {
  if (!WA.mediaRecorder) return;
  clearInterval(WA.recTimer); WA.recTimer = null;
  document.getElementById('wa-audio-recording').style.display = 'none';
  document.getElementById('wa-mic-btn')?.classList.remove('recording');
  const rec = WA.mediaRecorder; WA.mediaRecorder = null;
  rec.stream?.getTracks().forEach(t => t.stop());
  await new Promise(res => { rec.onstop = res; rec.stop(); });
  const chunks = [...WA.audioChunks]; WA.audioChunks = [];
  if (!chunks.length || WA.recSeconds < 1) return;
  const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
  const fr   = new FileReader();
  fr.onload  = async (e) => {
    try {
      const r = await EVO.req('POST', `/message/sendWhatsAppAudio/${EVO.instance}`, {
        number:   WA.sendNum(WA.activeJid),
        audio:    e.target.result.split(',')[1],
        encoding: true,
        audioMessage: { audio: e.target.result.split(',')[1] }
      });
      if (r.ok) { waSbToast('ok', 'Áudio enviado!'); setTimeout(() => waLoadMessages(true), 2000); }
      else        waSbToast('err', r.data?.message || r.data?.error || 'Erro ao enviar áudio');
    } catch(err) { waSbToast('err', 'Erro: '+err.message); }
  };
  fr.readAsDataURL(blob);
}

function waCancelAudio() {
  if (WA.mediaRecorder) {
    clearInterval(WA.recTimer); WA.recTimer = null;
    WA.mediaRecorder.stream?.getTracks().forEach(t => t.stop());
    try { WA.mediaRecorder.stop(); } catch {}
    WA.mediaRecorder = null; WA.audioChunks = [];
  }
  document.getElementById('wa-audio-recording').style.display = 'none';
  document.getElementById('wa-mic-btn')?.classList.remove('recording');
}

// ─────────────────────────────────────────────────────
// CSS extra — botão download + spinner
// ─────────────────────────────────────────────────────
(function waInjectCSS() {
  const style = document.createElement('style');
  style.textContent = `
.wa-media-thumb{display:flex;align-items:center;gap:8px;padding:6px 0;min-width:200px}
.wa-media-icon{font-size:24px;flex-shrink:0}
.wa-media-info{flex:1;min-width:0}
.wa-doc-bubble{display:flex;align-items:center;gap:10px;padding:4px 0;cursor:pointer}
.wa-doc-bubble:hover div{text-decoration:underline}
.wa-dl-btn{
  display:flex;align-items:center;gap:5px;
  background:#25D366;color:#fff;border:none;border-radius:20px;
  padding:5px 12px;font-size:11.5px;font-weight:600;
  cursor:pointer;white-space:nowrap;flex-shrink:0;
  font-family:'Outfit',sans-serif;transition:background .15s;
}
.wa-dl-btn:hover{background:#22c55e}
.wa-dl-btn:disabled{background:#374151;cursor:wait}
.wa-dl-spin{
  display:inline-block;width:12px;height:12px;
  border:2px solid rgba(255,255,255,.3);border-top-color:#fff;
  border-radius:50%;animation:waSpin .6s linear infinite;
}
@keyframes waSpin{to{transform:rotate(360deg)}}
.wa-audio-player{display:flex;align-items:center;gap:8px;padding:3px 0}
`;
  document.head.appendChild(style);
})();

// ─────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────
(function waInit() {
  const run = () => { waToggleSendMic(false); waConnectSSE(); };
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', run)
    : run();
})();

// ── Fim WA-CHAT ───────────────────────────────────────

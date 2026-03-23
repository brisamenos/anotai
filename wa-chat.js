
// ═══════════════════════════════════════════════════════
// WHATSAPP CHAT — Gestor de Conversas (Evolution API 2.7)
// ═══════════════════════════════════════════════════════

const WA = {
  open: false,
  chats: [],
  filteredChats: [],
  activeJid: null,
  activeName: '',
  messages: [],
  avatarCache: {},
  pendingFile: null,
  mediaRecorder: null,
  audioChunks: [],
  recTimer: null,
  recSeconds: 0,
  pollTimer: null,
  lastMsgTs: 0,

  // ── Extrai JID confiável do objeto de chat (v2.7) ────
  getJid(c) {
    // Em v2.7 o JID real pode estar em vários campos
    const candidates = [
      c.remoteJid,
      c.id,
      c.key?.remoteJid,
      c.lastMessage?.key?.remoteJid
    ];
    for (const jid of candidates) {
      if (jid && typeof jid === 'string' && jid.includes('@')) return jid;
    }
    return null;
  },

  // ── Verifica se o JID é um contato real (não LID) ───
  isRealContact(jid) {
    if (!jid) return false;
    const num = jid.replace(/@.*/,'').replace(/\D/g,'');
    // LIDs do v2.7 são IDs curtos (< 9 dígitos) que não são telefones reais
    // Telefones reais BR: mínimo 12 dígitos com código país 55
    if (num.length < 9) return false;
    return true;
  },

  // ── Formata número para exibição ─────────────────────
  formatPhone(jid) {
    const num = (jid || '').replace(/@.*/,'').replace(/\D/g,'');
    if (!num || num.length < 9) return jid || '';
    // Brasil: 55 + DDD (2) + número (8 ou 9)
    if (num.startsWith('55') && num.length >= 12) {
      const ddd  = num.slice(2,4);
      const rest = num.slice(4);
      if (rest.length === 9) return `+55 (${ddd}) ${rest.slice(0,5)}-${rest.slice(5)}`;
      if (rest.length === 8) return `+55 (${ddd}) ${rest.slice(0,4)}-${rest.slice(4)}`;
    }
    // Internacional: só mostra com +
    return `+${num}`;
  },

  // ── Número limpo para envio ──────────────────────────
  cleanNumber(jid) {
    return (jid || '').replace(/@.*/,'').replace(/\D/g,'');
  },

  // ── Número com código do país para envio ─────────────
  sendNumber(jid) {
    let num = this.cleanNumber(jid);
    // Garante que começa com 55 para Brasil
    if (num.length === 11 && !num.startsWith('55')) num = '55' + num;
    if (num.length === 10 && !num.startsWith('55')) num = '55' + num;
    return num;
  },

  // ── Timestamp → hora ─────────────────────────────────
  formatTime(ts) {
    if (!ts) return '';
    const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
    if (isNaN(d)) return '';
    const now = new Date();
    if (d.getDate() === now.getDate() && (now - d) < 86400000)
      return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    if ((now - d) < 604800000)
      return d.toLocaleDateString('pt-BR',{weekday:'short'});
    return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
  },

  // ── Timestamp → data por extenso ─────────────────────
  formatDate(ts) {
    if (!ts) return '';
    const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
    if (isNaN(d)) return '';
    const now = new Date();
    const diff = now - d;
    if (d.getDate() === now.getDate() && diff < 86400000) return 'Hoje';
    if (diff < 172800000) return 'Ontem';
    return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'});
  },

  // ── Iniciais para avatar ──────────────────────────────
  initials(name) {
    if (!name || name.startsWith('+')) return '?';
    const p = name.trim().split(' ').filter(Boolean);
    if (p.length >= 2) return (p[0][0] + p[p.length-1][0]).toUpperCase();
    return (p[0]?.[0] || '?').toUpperCase();
  },

  // ── Verificar conexão EVO ─────────────────────────────
  async checkConnection() {
    const inst     = EVO.instance;
    const statusEl = document.getElementById('wa-conn-status');
    if (!inst) {
      if (statusEl) statusEl.textContent = '⚠️ Configure a instância no painel Robô';
      return false;
    }
    try {
      const r     = await EVO.req('GET', `/instance/connectionState/${inst}`);
      const state = r.data?.instance?.state || r.data?.state || '';
      const ok    = state === 'open';
      if (statusEl) statusEl.textContent = ok ? '🟢 Conectado' : `🔴 ${state || 'Desconectado'}`;
      return ok;
    } catch(e) {
      if (statusEl) statusEl.textContent = '⚠️ Erro de conexão';
      return false;
    }
  },

  // ── Buscar foto de perfil (cache) ─────────────────────
  async fetchAvatar(jid) {
    if (this.avatarCache[jid] !== undefined) return this.avatarCache[jid];
    this.avatarCache[jid] = null;
    try {
      const num = this.cleanNumber(jid);
      const r   = await EVO.req('GET', `/chat/fetchProfilePictureUrl/${EVO.instance}?number=${num}&type=image`);
      const url = r.data?.profilePictureUrl || r.data?.image || null;
      this.avatarCache[jid] = url;
      return url;
    } catch(e) { return null; }
  },

  // ── Renderiza avatar assíncrono num elemento ──────────
  async renderAvatar(jid, name, el) {
    if (!el) return;
    const url = await this.fetchAvatar(jid);
    if (url) {
      const safe = (this.initials(name) || '?').replace(/'/g,"\\'");
      el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.textContent='${safe}'" alt="">`;
    } else {
      el.textContent = this.initials(name) || '?';
    }
  },

  // ── Extrai preview da última mensagem ─────────────────
  getPreview(c) {
    const lm = c.lastMessage;
    if (!lm) return '';
    const m = lm.message || lm.msg || {};
    // texto direto
    if (lm.conversation) return lm.conversation;
    if (m.conversation)  return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    if (m.imageMessage)  return '📷 Imagem' + (m.imageMessage.caption ? ': ' + m.imageMessage.caption : '');
    if (m.videoMessage)  return '🎥 Vídeo';
    if (m.audioMessage)  return '🎵 Áudio';
    if (m.documentMessage) return '📎 ' + (m.documentMessage.fileName || 'Documento');
    if (m.stickerMessage)  return '🎭 Figurinha';
    if (m.locationMessage) return '📍 Localização';
    if (Object.keys(m).length) return '📎 Mídia';
    return '';
  },

  // ── Extrai timestamp ──────────────────────────────────
  getTs(c) {
    return c.lastMessage?.messageTimestamp
        || c.updatedAt
        || c.lastMessageTimestamp
        || 0;
  }
};

// ─────────────────────────────────────────────────────
// Abrir / Fechar painel
// ─────────────────────────────────────────────────────
function waOpenPanel() {
  const panel = document.getElementById('wa-panel');
  if (!panel) return;
  panel.style.display = 'flex';
  WA.open = true;
  closeNotif?.();
  WA.checkConnection().then(ok => { if (ok) waLoadChats(); else waLoadChats(); });
  if (!WA.pollTimer) {
    WA.pollTimer = setInterval(() => {
      if (WA.open && WA.activeJid) waLoadMessages(true);
    }, 8000);
  }
}

function waClosePanel() {
  const panel = document.getElementById('wa-panel');
  if (panel) panel.style.display = 'none';
  WA.open = false;
  if (WA.pollTimer) { clearInterval(WA.pollTimer); WA.pollTimer = null; }
}

function waBackToList() {
  document.getElementById('wa-list-col')?.classList.remove('hidden');
}

// ─────────────────────────────────────────────────────
// Carregar lista de conversas (Evolution API 2.7)
// ─────────────────────────────────────────────────────
async function waLoadChats() {
  const listEl = document.getElementById('wa-chat-list');
  if (!listEl) return;
  const inst = EVO.instance;
  if (!inst) {
    listEl.innerHTML = `<div class="wa-empty-state"><p style="color:#94a3b8;font-size:13px">⚠️ Configure a instância no painel <b>Robô</b> primeiro.</p></div>`;
    return;
  }

  listEl.innerHTML = `<div class="wa-empty-state"><div class="wa-typing-dots"><span></span><span></span><span></span></div><p style="color:#64748b;font-size:12px;margin-top:10px">Carregando conversas...</p></div>`;

  try {
    // Evolution API 2.7: POST /chat/findChats/{instance}
    const r = await EVO.req('POST', `/chat/findChats/${inst}`, {
      where: {}
    });

    let raw = r.data;

    // Normaliza a resposta — v2.7 pode retornar array direto ou objeto
    let chats = [];
    if (Array.isArray(raw))              chats = raw;
    else if (Array.isArray(raw?.chats))  chats = raw.chats;
    else if (Array.isArray(raw?.data))   chats = raw.data;
    else if (Array.isArray(raw?.records))chats = raw.records;
    else {
      // Tenta GET como fallback
      const r2 = await EVO.req('GET', `/chat/findChats/${inst}`);
      const d2 = r2.data;
      if (Array.isArray(d2))             chats = d2;
      else if (Array.isArray(d2?.chats)) chats = d2.chats;
      else if (Array.isArray(d2?.data))  chats = d2.data;
    }

    // Remove status@broadcast e chats sem JID válido
    chats = chats.filter(c => {
      const jid = WA.getJid(c);
      if (!jid) return false;
      if (jid.startsWith('status@'))    return false;
      if (jid.includes('broadcast'))    return false;
      if (!WA.isRealContact(jid))       return false; // remove LIDs curtos
      return true;
    });

    // Ordena por mais recente
    chats.sort((a, b) => {
      const ta = WA.getTs(a);
      const tb = WA.getTs(b);
      const nta = typeof ta === 'number' ? ta : new Date(ta||0).getTime()/1000;
      const ntb = typeof tb === 'number' ? tb : new Date(tb||0).getTime()/1000;
      return ntb - nta;
    });

    WA.chats = chats;
    WA.filteredChats = chats;
    waRenderChatList(chats);

  } catch(e) {
    listEl.innerHTML = `<div class="wa-empty-state"><p style="color:#ef4444;font-size:12px">Erro: ${e.message}</p><button class="wa-btn-primary" style="margin-top:12px" onclick="waLoadChats()">Tentar novamente</button></div>`;
  }
}

// ─────────────────────────────────────────────────────
// Renderizar lista de chats
// ─────────────────────────────────────────────────────
function waRenderChatList(chats) {
  const listEl = document.getElementById('wa-chat-list');
  if (!listEl) return;

  if (!chats.length) {
    listEl.innerHTML = `<div class="wa-empty-state"><p style="color:#64748b;font-size:13px;text-align:center">Nenhuma conversa encontrada.</p><button class="wa-btn-primary" style="margin-top:12px" onclick="waLoadChats()">Atualizar</button></div>`;
    return;
  }

  listEl.innerHTML = chats.map((c, i) => {
    const jid     = WA.getJid(c);
    const name    = c.name || c.pushName || c.verifiedName || WA.formatPhone(jid);
    const preview = WA.getPreview(c);
    const ts      = WA.getTs(c);
    const timeStr = WA.formatTime(ts);
    const unread  = c.unreadCount || 0;
    const isActive= jid === WA.activeJid;
    const safeName = (name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const safeJid  = (jid ||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");

    return `<div class="wa-chat-item${isActive?' waci-active':''}" onclick="waOpenConversation('${safeJid}','${safeName}')" data-jid="${waEsc(jid)}">
      <div class="wa-chat-avatar" id="wa-av-${i}">${WA.initials(name)}</div>
      <div class="wa-chat-meta">
        <div class="wa-chat-name">${waEsc(name)}</div>
        <div class="wa-chat-preview">${preview ? waEsc(preview) : '<i style="opacity:.5">Sem mensagens</i>'}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
        ${timeStr ? `<div class="wa-chat-time">${timeStr}</div>` : ''}
        ${unread > 0 ? `<div class="wa-unread-dot">${unread > 99 ? '99+' : unread}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  // Avatares assíncronos (sem bloquear render)
  chats.forEach((c, i) => {
    const jid  = WA.getJid(c);
    const name = c.name || c.pushName || WA.formatPhone(jid);
    const el   = document.getElementById(`wa-av-${i}`);
    if (el && jid) WA.renderAvatar(jid, name, el);
  });
}

// ─────────────────────────────────────────────────────
// Filtrar chats por busca
// ─────────────────────────────────────────────────────
function waFilterChats(q) {
  const term = (q || '').toLowerCase().trim();
  WA.filteredChats = term
    ? WA.chats.filter(c => {
        const jid  = WA.getJid(c) || '';
        const name = (c.name || c.pushName || '').toLowerCase();
        return name.includes(term) || jid.includes(term);
      })
    : WA.chats;
  waRenderChatList(WA.filteredChats);
}

// ─────────────────────────────────────────────────────
// Abrir conversa
// ─────────────────────────────────────────────────────
async function waOpenConversation(jid, name) {
  WA.activeJid   = jid;
  WA.activeName  = name;
  WA.lastMsgTs   = 0;

  // Atualiza header
  const nameEl   = document.getElementById('wa-conv-name');
  const phoneEl  = document.getElementById('wa-conv-phone');
  const avatarEl = document.getElementById('wa-conv-avatar');

  if (nameEl)  nameEl.textContent  = name || WA.formatPhone(jid);
  if (phoneEl) phoneEl.textContent = WA.formatPhone(jid);
  if (avatarEl) avatarEl.textContent = WA.initials(name);

  document.getElementById('wa-conv-empty').style.display  = 'none';
  document.getElementById('wa-conv-active').style.display = 'flex';

  if (avatarEl && jid) WA.renderAvatar(jid, name, avatarEl);

  // Mobile
  if (window.innerWidth <= 640)
    document.getElementById('wa-list-col')?.classList.add('hidden');

  // Destaca item ativo
  document.querySelectorAll('.wa-chat-item').forEach(el => el.classList.remove('waci-active'));
  document.querySelector(`.wa-chat-item[data-jid="${CSS.escape(jid)}"]`)?.classList.add('waci-active');

  await waLoadMessages();
}

// ─────────────────────────────────────────────────────
// Carregar mensagens (Evolution API 2.7)
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
    // v2.7: POST /chat/findMessages/{instance}
    const r = await EVO.req('POST', `/chat/findMessages/${inst}`, {
      where: { key: { remoteJid: WA.activeJid } },
      limit: 60,
      skip:  0
    });

    let msgs = [];
    const d  = r.data;
    if (Array.isArray(d))                    msgs = d;
    else if (Array.isArray(d?.records))      msgs = d.records;
    else if (Array.isArray(d?.messages))     msgs = d.messages;
    else if (Array.isArray(d?.messages?.records)) msgs = d.messages.records;
    else if (d?.messages && Array.isArray(Object.values(d.messages))) {
      // objeto com registros aninhados
      msgs = d.messages.records || d.messages || [];
    }

    // Ordena crescente por timestamp
    msgs.sort((a, b) => {
      const ta = a.messageTimestamp || a.key?.timestamp || 0;
      const tb = b.messageTimestamp || b.key?.timestamp || 0;
      return ta - tb;
    });

    // Polling: só re-renderiza se houver mensagem nova
    if (silent && msgs.length > 0) {
      const lastTs = msgs[msgs.length - 1].messageTimestamp || 0;
      if (lastTs === WA.lastMsgTs) return;
      WA.lastMsgTs = lastTs;
    } else if (msgs.length > 0) {
      WA.lastMsgTs = msgs[msgs.length - 1].messageTimestamp || 0;
    }

    if (loadEl) loadEl.style.display = 'none';
    msgsEl.innerHTML = '';

    if (!msgs.length) {
      msgsEl.innerHTML = '<div style="text-align:center;color:#64748b;font-size:12px;padding:30px">Nenhuma mensagem encontrada nesta conversa.</div>';
      return;
    }

    // Renderiza com separadores de data
    let lastDate = '';
    msgs.forEach(msg => {
      const ts      = msg.messageTimestamp || msg.key?.timestamp;
      const dateStr = WA.formatDate(ts);
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
    if (!silent)
      msgsEl.innerHTML = `<div style="text-align:center;color:#ef4444;font-size:12px;padding:20px">Erro ao carregar: ${e.message}</div>`;
  }
}

// ─────────────────────────────────────────────────────
// Criar elemento DOM de mensagem
// ─────────────────────────────────────────────────────
function waCreateMsgEl(msg) {
  const fromMe  = msg.key?.fromMe === true;
  const ts      = msg.messageTimestamp || msg.key?.timestamp;
  const timeStr = ts ? new Date(ts * 1000).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '';
  const m       = msg.message || {};

  const text      = m.conversation || m.extendedTextMessage?.text || '';
  const imgMsg    = m.imageMessage;
  const vidMsg    = m.videoMessage;
  const audioMsg  = m.audioMessage || m.pttMessage;
  const docMsg    = m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage;
  const stickerMsg= m.stickerMessage;
  const locMsg    = m.locationMessage;
  const btnMsg    = m.buttonsResponseMessage || m.templateButtonReplyMessage;
  const listMsg   = m.listResponseMessage;

  const wrap   = document.createElement('div');
  wrap.className = `wa-msg ${fromMe ? 'sent' : 'recv'}`;

  const bubble = document.createElement('div');
  bubble.className = 'wa-bubble';

  if (imgMsg) {
    const cap = imgMsg.caption || '';
    const b64 = msg._base64 || imgMsg._base64;
    if (b64) {
      bubble.innerHTML = `<img src="data:${imgMsg.mimetype||'image/jpeg'};base64,${b64}" onclick="waViewMedia(this.src)" loading="lazy" style="max-width:220px;max-height:180px;border-radius:8px;display:block;cursor:pointer">${cap?`<div style="margin-top:4px;font-size:13px">${waEsc(cap)}</div>`:''}`;
    } else {
      bubble.innerHTML = `<div class="wa-doc-bubble">🖼️ <span>Imagem${cap?': '+waEsc(cap):''}</span></div>`;
    }
  }
  else if (vidMsg) {
    const cap = vidMsg.caption || '';
    const b64 = msg._base64;
    if (b64) {
      bubble.innerHTML = `<video controls style="max-width:220px;max-height:180px;border-radius:8px;display:block"><source src="data:${vidMsg.mimetype||'video/mp4'};base64,${b64}"></video>${cap?`<div style="margin-top:4px;font-size:13px">${waEsc(cap)}</div>`:''}`;
    } else {
      bubble.innerHTML = `<div class="wa-doc-bubble">🎥 <span>Vídeo${cap?': '+waEsc(cap):''}</span></div>`;
    }
  }
  else if (audioMsg) {
    const b64  = msg._base64 || audioMsg._base64;
    const mime = audioMsg.mimetype || 'audio/ogg; codecs=opus';
    if (b64) {
      bubble.innerHTML = `<div class="wa-audio-player"><audio controls style="height:32px;width:190px"><source src="data:${mime};base64,${b64}"></audio></div>`;
    } else {
      bubble.innerHTML = `<div class="wa-audio-player">🎵 <span style="font-size:12px;opacity:.7">Áudio</span></div>`;
    }
  }
  else if (docMsg) {
    const fname = docMsg.fileName || docMsg.title || 'Documento';
    const mime  = docMsg.mimetype || '';
    const icon  = mime.includes('pdf') ? '📄' : mime.includes('sheet') || mime.includes('excel') ? '📊' : mime.includes('word') ? '📝' : '📎';
    bubble.innerHTML = `<div class="wa-doc-bubble">${icon} <span>${waEsc(fname)}</span></div>`;
  }
  else if (stickerMsg) {
    bubble.innerHTML = `<span style="font-size:14px;opacity:.7">🎭 Figurinha</span>`;
  }
  else if (locMsg) {
    bubble.innerHTML = `<div class="wa-doc-bubble">📍 <span>Localização: ${locMsg.degreesLatitude?.toFixed(4)}, ${locMsg.degreesLongitude?.toFixed(4)}</span></div>`;
  }
  else if (btnMsg) {
    const t = btnMsg.selectedButtonId || btnMsg.selectedId || btnMsg.title || 'Resposta';
    bubble.textContent = t;
  }
  else if (listMsg) {
    const t = listMsg.title || listMsg.singleSelectReply?.selectedRowId || 'Resposta';
    bubble.textContent = t;
  }
  else if (text) {
    // Suporta markdown simples: *negrito*, _itálico_
    bubble.innerHTML = waEsc(text)
      .replace(/\*([^*]+)\*/g, '<b>$1</b>')
      .replace(/_([^_]+)_/g, '<i>$1</i>');
  }
  else {
    return null; // tipo desconhecido — ignora
  }

  const timeDiv = document.createElement('div');
  timeDiv.className = 'wa-msg-time';
  timeDiv.innerHTML = timeStr + (fromMe ? ' <span class="wa-check">✓✓</span>' : '');

  wrap.appendChild(bubble);
  wrap.appendChild(timeDiv);
  return wrap;
}

// ─────────────────────────────────────────────────────
// Ver imagem em fullscreen
// ─────────────────────────────────────────────────────
function waViewMedia(src) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  ov.onclick = () => ov.remove();
  const img = document.createElement('img');
  img.src = src;
  img.style.cssText = 'max-width:92vw;max-height:92vh;border-radius:10px;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,.8)';
  ov.appendChild(img);
  document.body.appendChild(ov);
}

// ─────────────────────────────────────────────────────
// Enviar mensagem de texto
// ─────────────────────────────────────────────────────
async function waSendMessage() {
  const inp  = document.getElementById('wa-msg-input');
  const text = (inp?.value || '').trim();
  const inst = EVO.instance;

  if (!inst || !WA.activeJid) { sbToast('err', 'Nenhuma conversa selecionada'); return; }
  if (WA.pendingFile) { await waSendMedia(); return; }
  if (!text) return;

  inp.value = '';
  waToggleSendMic(false);

  // Otimista: adiciona mensagem na tela imediatamente
  const fakeMsg = {
    key: { fromMe: true, id: 'tmp_' + Date.now() },
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: { conversation: text }
  };
  const msgsEl = document.getElementById('wa-messages');
  const el = waCreateMsgEl(fakeMsg);
  if (el && msgsEl) { msgsEl.appendChild(el); msgsEl.scrollTop = msgsEl.scrollHeight; }

  try {
    // Evolution API 2.7: POST /message/sendText/{instance}
    const num = WA.sendNumber(WA.activeJid);
    const r = await EVO.req('POST', `/message/sendText/${inst}`, {
      number: num,
      text:   text
    });
    if (!r.ok) {
      const errMsg = r.data?.message || r.data?.error || 'Erro ao enviar';
      sbToast('err', errMsg);
    } else {
      setTimeout(() => waLoadMessages(true), 2000);
    }
  } catch(e) {
    sbToast('err', 'Erro: ' + e.message);
  }
}

// ─────────────────────────────────────────────────────
// Toggle botão enviar / microfone
// ─────────────────────────────────────────────────────
function waOnTyping(inp) {
  waToggleSendMic(inp.value.trim().length > 0 || !!WA.pendingFile);
}

function waToggleSendMic(hasContent) {
  const s = document.getElementById('wa-send-btn');
  const m = document.getElementById('wa-mic-btn');
  if (s) s.style.display = hasContent ? 'flex' : 'none';
  if (m) m.style.display = hasContent ? 'none'  : 'flex';
}

// ─────────────────────────────────────────────────────
// Seleção de arquivo para envio de mídia
// ─────────────────────────────────────────────────────
function waOnFileSelect(evt) {
  const file = evt.target.files?.[0];
  if (!file) return;
  WA.pendingFile = file;

  const prev   = document.getElementById('wa-media-preview');
  const prevImg= document.getElementById('wa-preview-img');
  const prevNm = document.getElementById('wa-preview-name');
  if (prev)  prev.style.display = 'block';
  if (prevNm) prevNm.textContent = file.name;
  if (prevImg) {
    if (file.type.startsWith('image/')) {
      const fr = new FileReader();
      fr.onload = e => { prevImg.src = e.target.result; prevImg.style.display = 'block'; };
      fr.readAsDataURL(file);
    } else {
      prevImg.style.display = 'none';
    }
  }
  waToggleSendMic(true);
}

function waClearMedia() {
  WA.pendingFile = null;
  const prev  = document.getElementById('wa-media-preview');
  const fi    = document.getElementById('wa-file-input');
  if (prev) prev.style.display = 'none';
  if (fi)   fi.value = '';
  const inp = document.getElementById('wa-msg-input');
  waToggleSendMic(inp?.value?.trim().length > 0);
}

// ─────────────────────────────────────────────────────
// Enviar mídia
// ─────────────────────────────────────────────────────
async function waSendMedia() {
  const file = WA.pendingFile;
  if (!file || !WA.activeJid || !EVO.instance) return;

  const fr = new FileReader();
  fr.onload = async (e) => {
    const b64     = e.target.result.split(',')[1];
    const mime    = file.type || 'application/octet-stream';
    const caption = document.getElementById('wa-msg-input')?.value?.trim() || '';
    let mediatype = 'document';
    if (mime.startsWith('image/')) mediatype = 'image';
    else if (mime.startsWith('video/')) mediatype = 'video';
    else if (mime.startsWith('audio/')) mediatype = 'audio';

    waClearMedia();
    if (document.getElementById('wa-msg-input')) document.getElementById('wa-msg-input').value = '';
    waToggleSendMic(false);

    try {
      const r = await EVO.req('POST', `/message/sendMedia/${EVO.instance}`, {
        number:    WA.sendNumber(WA.activeJid),
        mediatype,
        mimetype:  mime,
        caption,
        media:     b64,
        fileName:  file.name
      });
      if (r.ok) { sbToast('ok', 'Mídia enviada!'); setTimeout(() => waLoadMessages(true), 2000); }
      else       sbToast('err', r.data?.message || 'Erro ao enviar mídia');
    } catch(err) { sbToast('err', 'Erro: ' + err.message); }
  };
  fr.readAsDataURL(file);
}

// ─────────────────────────────────────────────────────
// Gravação de áudio
// ─────────────────────────────────────────────────────
async function waStartAudio() {
  if (WA.mediaRecorder) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    WA.audioChunks = [];
    WA.recSeconds  = 0;
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';
    WA.mediaRecorder = new MediaRecorder(stream, { mimeType });
    WA.mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) WA.audioChunks.push(e.data); };
    WA.mediaRecorder.start(100);

    document.getElementById('wa-audio-recording').style.display = 'flex';
    document.getElementById('wa-mic-btn')?.classList.add('recording');

    WA.recTimer = setInterval(() => {
      WA.recSeconds++;
      const el = document.getElementById('wa-rec-time');
      if (el) el.textContent = `${Math.floor(WA.recSeconds/60)}:${String(WA.recSeconds%60).padStart(2,'0')}`;
    }, 1000);
  } catch(e) {
    sbToast('err', 'Permita o acesso ao microfone');
  }
}

async function waStopAudio() {
  if (!WA.mediaRecorder) return;
  clearInterval(WA.recTimer); WA.recTimer = null;

  document.getElementById('wa-audio-recording').style.display = 'none';
  document.getElementById('wa-mic-btn')?.classList.remove('recording');

  const recorder = WA.mediaRecorder;
  WA.mediaRecorder = null;
  recorder.stream?.getTracks().forEach(t => t.stop());

  await new Promise(res => { recorder.onstop = res; recorder.stop(); });

  const chunks = [...WA.audioChunks]; WA.audioChunks = [];
  if (!chunks.length || WA.recSeconds < 1) return;

  const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
  const fr   = new FileReader();
  fr.onload  = async (e) => {
    const b64 = e.target.result.split(',')[1];
    try {
      const r = await EVO.req('POST', `/message/sendWhatsAppAudio/${EVO.instance}`, {
        number:   WA.sendNumber(WA.activeJid),
        audio:    b64,
        encoding: true
      });
      if (r.ok) { sbToast('ok', 'Áudio enviado!'); setTimeout(() => waLoadMessages(true), 2000); }
      else       sbToast('err', r.data?.message || 'Erro ao enviar áudio');
    } catch(err) { sbToast('err', 'Erro: ' + err.message); }
  };
  fr.readAsDataURL(blob);
}

function waCancelAudio() {
  if (WA.mediaRecorder) {
    clearInterval(WA.recTimer); WA.recTimer = null;
    WA.mediaRecorder.stream?.getTracks().forEach(t => t.stop());
    try { WA.mediaRecorder.stop(); } catch(e) {}
    WA.mediaRecorder = null; WA.audioChunks = [];
  }
  document.getElementById('wa-audio-recording').style.display = 'none';
  document.getElementById('wa-mic-btn')?.classList.remove('recording');
}

// ─────────────────────────────────────────────────────
// Escape HTML
// ─────────────────────────────────────────────────────
function waEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─────────────────────────────────────────────────────
// Init: esconde send, mostra mic
// ─────────────────────────────────────────────────────
(function waInit() {
  const run = () => { waToggleSendMic(false); };
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', run)
    : run();
})();

// ── Fim WHATSAPP CHAT ─────────────────────────────────

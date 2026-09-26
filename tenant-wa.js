// ═══════════════════════════════════════════════════════
// TENANT-WA.JS — WhatsApp de cada loja: Evolution API ou WuzAPI
// ═══════════════════════════════════════════════════════
// Cada restaurante escolhe o motor em store_config.whatsapp_provider.
// A Evolution continua exatamente como estava (nao mexemos nela aqui).
// A WuzAPI e' a alternativa mais leve: sem findChats, entao a lista de
// conversas e' montada a partir do wa_messages (que ja existe e ja
// recebe as msgs de ambos os motores via webhook).
//
// Peca central: normalizeWuzToBaileys() traduz o evento da WuzAPI
// (whatsmeow) para o MESMO formato que a Evolution (Baileys) ja manda
// hoje — o conteudo interno da mensagem (message.conversation,
// message.imageMessage, etc) usa os mesmos nomes de campo nos dois,
// entao so precisamos remontar o "envelope" (key/messageTimestamp/
// pushName). Assim o wa-chat.js (tela de conversas) nao precisa saber
// qual motor gerou a mensagem — continua lendo o mesmo formato de sempre.

const crypto = require('crypto');
const wuzapi = require('./wuzapi');

let D = null; // dependencias injetadas pelo routes.js (db, log, marcarDirty, sseBroadcast)

function init(deps) {
  D = deps;
}

function isWuzapi(tenantId) {
  const cfg = D.db.prepare('SELECT whatsapp_provider FROM store_config WHERE tenant_id=?').get(tenantId);
  return cfg?.whatsapp_provider === 'wuzapi';
}

function getConfig(tenantId) {
  return D.db.prepare(
    'SELECT whatsapp_provider, wuzapi_token, wuzapi_user_id, wuzapi_webhook_secret, store_name FROM store_config WHERE tenant_id=?'
  ).get(tenantId) || {};
}

function webhookSecretFor(tenantId) {
  const cfg = getConfig(tenantId);
  if (cfg.wuzapi_webhook_secret) return cfg.wuzapi_webhook_secret;
  const secret = crypto.randomBytes(16).toString('hex');
  D.db.prepare('UPDATE store_config SET wuzapi_webhook_secret=? WHERE tenant_id=?').run(secret, tenantId);
  return secret;
}

// ==================== Conexao (WuzAPI) ====================

async function status(tenantId) {
  const cfg = getConfig(tenantId);
  if (!wuzapi.isConfigured()) return { wuzapi_configured: false, status: 'disconnected' };
  if (!cfg.wuzapi_token) return { wuzapi_configured: true, status: 'disconnected' };
  try {
    const st = await wuzapi.getStatus(cfg.wuzapi_token);
    return { wuzapi_configured: true, status: st };
  } catch (e) {
    return { wuzapi_configured: true, status: 'erro: ' + e.message };
  }
}

async function connect(tenantId, baseUrl) {
  if (!wuzapi.isConfigured()) throw new Error('WuzAPI não configurada no servidor (WUZAPI_URL / WUZAPI_ADMIN_TOKEN)');
  let cfg = getConfig(tenantId);
  if (!cfg.wuzapi_token) {
    const tenantRow = D.db.prepare('SELECT slug, nome FROM tenants WHERE id=?').get(tenantId);
    const userName = `estimafood-${tenantRow?.slug || tenantId}`;
    const created = await wuzapi.createUser(userName);
    D.db.prepare('UPDATE store_config SET wuzapi_token=?, wuzapi_user_id=? WHERE tenant_id=?')
      .run(created.token, created.id === null ? null : String(created.id), tenantId);
    cfg = getConfig(tenantId);
  }
  const secret = webhookSecretFor(tenantId);
  const webhook = `${String(baseUrl).replace(/\/$/, '')}/webhook/wuz/${tenantId}/${secret}`;
  await wuzapi.connect(cfg.wuzapi_token, webhook);

  const started = Date.now();
  while (Date.now() - started < 20000) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      if (await wuzapi.getStatus(cfg.wuzapi_token) === 'connected') return { status: 'connected', qr: null };
    } catch (_) {}
    try {
      const qr = await wuzapi.getQr(cfg.wuzapi_token);
      if (qr) return { status: 'connecting', qr };
    } catch (e) {
      if (/logged in/i.test(e.message)) return { status: 'connected', qr: null };
    }
  }
  throw new Error('A WuzAPI não gerou o QR Code. Tente de novo em alguns segundos.');
}

async function currentQr(tenantId) {
  const cfg = getConfig(tenantId);
  if (!cfg.wuzapi_token) return { status: 'disconnected', qr: null };
  let st = 'disconnected';
  try { st = await wuzapi.getStatus(cfg.wuzapi_token); } catch (_) {}
  if (st === 'connected') return { status: st, qr: null };
  return { status: st, qr: await wuzapi.getQr(cfg.wuzapi_token).catch(() => null) };
}

async function disconnect(tenantId) {
  const cfg = getConfig(tenantId);
  if (cfg.wuzapi_token) await wuzapi.logout(cfg.wuzapi_token).catch(() => {});
}

async function setProvider(tenantId, provider) {
  const p = provider === 'wuzapi' ? 'wuzapi' : 'evolution';
  D.db.prepare('UPDATE store_config SET whatsapp_provider=? WHERE tenant_id=?').run(p, tenantId);
  return p;
}

// ==================== Envio (WuzAPI) ====================
// numeros com/sem o 9 depois do DDD — algumas contas de WhatsApp ficaram sem o 9
function phoneVariants(n) {
  const list = [n];
  if (n.startsWith('55') && n.length === 13 && n[4] === '9') list.push(n.slice(0, 4) + n.slice(5));
  if (n.startsWith('55') && n.length === 12 && /[6-9]/.test(n[4])) list.push(n.slice(0, 4) + '9' + n.slice(4));
  return list;
}
const _resolved = new Map();

async function sendText(tenantId, phone, text) {
  const cfg = getConfig(tenantId);
  if (!cfg.wuzapi_token) throw new Error('WhatsApp (WuzAPI) não conectado para esta loja');
  const n = String(phone || '').replace(/\D/g, '');
  const digits = n.startsWith('55') ? n : `55${n}`;
  const known = _resolved.get(`${tenantId}:${digits}`);
  const first = known && Date.now() - known.at < 24 * 3600 * 1000 ? known.to : digits;
  try {
    return await wuzapi.sendText(cfg.wuzapi_token, first, text);
  } catch (err) {
    if (!/no LID found|not (registered|on whatsapp)|not found|invalid/i.test(err.message)) throw err;
    const users = await wuzapi.checkUsers(cfg.wuzapi_token, phoneVariants(digits)).catch(() => []);
    const found = users.find(u => u.IsInWhatsapp || u.isInWhatsapp);
    if (!found) throw err;
    const to = String(found.JID || found.jid || found.Query).split('@')[0];
    _resolved.set(`${tenantId}:${digits}`, { to, at: Date.now() });
    return wuzapi.sendText(cfg.wuzapi_token, to, text);
  }
}

async function sendPresence(tenantId, phone) {
  const cfg = getConfig(tenantId);
  if (!cfg.wuzapi_token) return;
  await wuzapi.sendPresence(cfg.wuzapi_token, String(phone || '').replace(/\D/g, '')).catch(() => {});
}

// imageBase64 aceita data URL completa ou base64 puro (mesmo padrão do sendWAImage do Evolution)
async function sendImage(tenantId, phone, imageBase64, caption) {
  const cfg = getConfig(tenantId);
  if (!cfg.wuzapi_token) throw new Error('WhatsApp (WuzAPI) não conectado para esta loja');
  const n = String(phone || '').replace(/\D/g, '');
  const digits = n.startsWith('55') ? n : `55${n}`;
  const known = _resolved.get(`${tenantId}:${digits}`);
  const first = known && Date.now() - known.at < 24 * 3600 * 1000 ? known.to : digits;
  return wuzapi.sendImage(cfg.wuzapi_token, first, imageBase64, caption || '');
}

// tipo: 'image' | 'video' | 'audio' | 'document'
async function downloadMedia(tenantId, tipo, media) {
  const cfg = getConfig(tenantId);
  if (!cfg.wuzapi_token) throw new Error('WhatsApp (WuzAPI) não conectado para esta loja');
  return wuzapi.downloadMedia(cfg.wuzapi_token, tipo, media);
}

// ==================== Bot-echo suppression ====================
// Quando o robo manda uma mensagem via WuzAPI (sendWA), o proprio webhook da
// WuzAPI ecoa essa mensagem de volta como fromMe:true — sem isso, o sistema
// pensaria que um HUMANO (gestor) mandou a mensagem e pausaria a IA nela mesma.
// Guarda o ID por ate 6h (tempo de sobra pra qualquer atraso de webhook).
const _botSent = new Map();
const _BOT_SENT_TTL = 6 * 3600 * 1000;

function markBotSent(id) {
  if (!id) return;
  _botSent.set(id, Date.now());
  if (_botSent.size > 2000) {
    const cutoff = Date.now() - _BOT_SENT_TTL;
    for (const [k, t] of _botSent) if (t < cutoff) _botSent.delete(k);
  }
}

function wasBotSent(id) {
  if (!id) return false;
  const t = _botSent.get(id);
  if (t === undefined) return false;
  if (Date.now() - t > _BOT_SENT_TTL) { _botSent.delete(id); return false; }
  return true;
}

// ==================== Webhook: WuzAPI -> formato Baileys ====================

function webhookSecretMatches(tenantId, secret) {
  const cfg = getConfig(tenantId);
  const s = cfg.wuzapi_webhook_secret || '';
  return !!s && String(secret || '').length === s.length &&
    crypto.timingSafeEqual(Buffer.from(String(secret)), Buffer.from(s));
}

// Recebe o corpo cru do webhook da WuzAPI ({type:'Message', event:{Info,Message}})
// e devolve uma lista de mensagens no MESMO formato que o webhook da Evolution ja produz
// (m.key.remoteJid/id/fromMe, m.messageTimestamp, m.pushName, m.message.*) — o resto do
// sistema (salvar em wa_messages, SSE, pausa da IA) continua identico para os dois motores.
function normalizeWuzToBaileys(body) {
  if (body?.type !== 'Message' || !body.event) return [];
  const info = body.event.Info || {};
  const message = body.event.Message || {};
  const chat = String(info.Chat || '');
  if (info.IsGroup || chat.endsWith('@g.us') || chat.startsWith('status@') || chat.endsWith('@newsletter')) return [];

  // Contas novas mandam o numero real como LID (@lid); o numero de verdade vem em SenderAlt
  const rawSender = String(info.Sender || chat || '');
  const senderAlt = String(info.SenderAlt || '');
  const remoteJid = rawSender.endsWith('@lid') && senderAlt.endsWith('@s.whatsapp.net') ? senderAlt : (chat || rawSender);

  return [{
    key: {
      remoteJid,
      id: info.ID,
      fromMe: !!info.IsFromMe
    },
    messageTimestamp: info.Timestamp ? Math.floor(new Date(info.Timestamp).getTime() / 1000) : Math.floor(Date.now() / 1000),
    pushName: info.PushName || '',
    message
  }];
}

module.exports = {
  init,
  isWuzapi,
  getConfig,
  status,
  connect,
  currentQr,
  disconnect,
  setProvider,
  sendText,
  sendPresence,
  sendImage,
  downloadMedia,
  webhookSecretMatches,
  normalizeWuzToBaileys,
  markBotSent,
  wasBotSent
};

// Cliente para a WuzAPI (github.com/asternic/wuzapi) — mesma base usada no BarberSync.
// Aqui e usado pelo WhatsApp de Suporte e Vendas do super admin (bot de atendimento + cobrancas).
// .env: WUZAPI_URL (ex: https://wuzapi.seudominio.com) e WUZAPI_ADMIN_TOKEN (o mesmo do .env da WuzAPI).
//
// Como a WuzAPI funciona:
// - Cada numero de WhatsApp e um "usuario" da WuzAPI, criado com o token de admin (header Authorization).
// - Todas as outras rotas usam o token do proprio usuario (header "token"). Guardamos esse token no banco.
// - Respostas vem no envelope { code, data, success }.
// - O webhook pode chegar como JSON ou como formulario (jsonData=...), conforme WEBHOOK_FORMAT da WuzAPI.

const crypto = require('crypto');

// TEMPORARIO: URL fixa como padrao (a pagina /api e so a documentacao; a API fica na raiz).
// Se WUZAPI_URL estiver no .env, ela tem prioridade.
const BASE_URL = (process.env.WUZAPI_URL || 'https://projeto-wuazapi.xtknqq.easypanel.host').replace(/\/$/, '').replace(/\/api$/, '');
// TEMPORARIO: token de admin fixo como padrao (e o valor de exemplo da WuzAPI: TROCAR o quanto antes).
// Se WUZAPI_ADMIN_TOKEN estiver no .env, ele tem prioridade.
const ADMIN_TOKEN = process.env.WUZAPI_ADMIN_TOKEN || '1234ABCD';

function isConfigured() {
  return Boolean(BASE_URL && ADMIN_TOKEN);
}

async function wzFetch(path, { method = 'GET', body, token, admin = false } = {}) {
  if (!isConfigured()) {
    throw new Error('WuzAPI não configurada (defina WUZAPI_URL e WUZAPI_ADMIN_TOKEN no .env)');
  }

  const headers = { 'Content-Type': 'application/json' };
  if (admin) headers.Authorization = ADMIN_TOKEN;
  else headers.token = token;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000)
  }).catch(err => {
    throw new Error(err.name === 'TimeoutError' ? 'a WuzAPI demorou demais para responder' : `não consegui acessar a WuzAPI (${err.message})`);
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!response.ok || (data && data.success === false)) {
    let message = (data && (data.error || data.message)) || `WuzAPI retornou ${response.status}`;
    // Rota de admin recusada = a senha de admin do EstimaFood não é a mesma da WuzAPI
    if (admin && response.status === 401) message = 'senha de admin da WuzAPI não confere (WUZAPI_ADMIN_TOKEN diferente nos dois serviços)';
    const err = new Error(String(message));
    err.status = response.status;
    throw err;
  }

  return data && Object.prototype.hasOwnProperty.call(data, 'data') ? data.data : data;
}

// ==================== Usuarios (admin) ====================

// Confere quais numeros existem no WhatsApp e o JID certo de cada um
// (ex: celular cadastrado com o 9 extra, mas registrado no WhatsApp sem ele)
async function checkUsers(token, phones) {
  const data = await wzFetch('/user/check', { method: 'POST', token, body: { Phone: phones } });
  return Array.isArray(data?.Users) ? data.Users : [];
}

async function listUsers() {
  const data = await wzFetch('/admin/users', { admin: true });
  return Array.isArray(data) ? data : [];
}

// Cria o usuario da barbearia (ou reaproveita um existente com o mesmo nome). Retorna { id, token }.
async function createUser(name) {
  const existing = (await listUsers().catch(() => [])).find(u => u.name === name);
  if (existing) return { id: existing.id, token: existing.token };

  const token = crypto.randomBytes(24).toString('hex');
  const created = await wzFetch('/admin/users', { method: 'POST', admin: true, body: { name, token, events: 'Message' } });
  let id = created?.id ?? null;
  if (id === null) id = (await listUsers().catch(() => [])).find(u => u.name === name)?.id ?? null;
  return { id, token };
}

// Erro de "token não existe/não autorizado": a instância foi apagada na WuzAPI
function tokenInvalido(err) {
  return !!err && (err.status === 401 || /unauthori[sz]ed|invalid token|user not found|no user/i.test(String(err.message || '')));
}

async function deleteUser(id) {
  if (id === null || id === undefined || id === '') return null;
  return wzFetch(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE', admin: true });
}

// ==================== Sessao ====================

// Define o webhook e conecta (gera QR se ainda nao estiver pareado)
async function connect(token, webhookUrl) {
  if (webhookUrl) {
    await wzFetch('/webhook', { method: 'POST', token, body: { webhookurl: webhookUrl, events: ['Message'] } });
  }
  try {
    await wzFetch('/session/connect', { method: 'POST', token, body: { Subscribe: ['Message'], Immediate: true } });
  } catch (err) {
    if (!/already connected/i.test(err.message)) throw err;
  }
}

async function setWebhook(token, webhookUrl) {
  return wzFetch('/webhook', { method: 'POST', token, body: { webhookurl: webhookUrl, events: ['Message'] } });
}

// Data URL da imagem do QR, ou null se ainda nao foi gerado
async function getQr(token) {
  const data = await wzFetch('/session/qr', { token });
  const qr = data?.QRCode || data?.qrcode || '';
  return qr || null;
}

// 'connected' | 'connecting' | 'disconnected'
async function getStatus(token) {
  const data = await wzFetch('/session/status', { token });
  const loggedIn = data?.loggedIn ?? data?.LoggedIn;
  const connected = data?.connected ?? data?.Connected;
  if (loggedIn) return connected ? 'connected' : 'connecting';
  return connected ? 'connecting' : 'disconnected';
}

async function logout(token) {
  return wzFetch('/session/logout', { method: 'POST', token });
}

// ==================== Envio ====================

// Mensagem com link vai com "card" (imagem, título e descrição do site),
// igual quando a pessoa cola um link no WhatsApp. Desliga com WUZAPI_LINK_PREVIEW=0.
const LINK_PREVIEW = process.env.WUZAPI_LINK_PREVIEW !== '0';

async function sendText(token, phone, text) {
  const body = { Phone: phone, Body: text };
  if (LINK_PREVIEW && /https?:\/\/\S+/i.test(String(text || ''))) body.LinkPreview = true;
  const data = await wzFetch('/chat/send/text', { method: 'POST', token, body });
  return data?.Id || null;
}

// image (opcional): data URL ("data:image/jpeg;base64,...") ou URL http(s) publica; vira a foto no topo
// imageDataUrl: "data:image/png;base64,..." (ex: QR Code do Pix)
async function sendImage(token, phone, imageDataUrl, caption) {
  const data = await wzFetch('/chat/send/image', {
    method: 'POST',
    token,
    body: { Phone: phone, Image: imageDataUrl, Caption: caption || '' }
  });
  return data?.Id || null;
}

async function sendButtons(token, phone, { text, footer, buttons, image }) {
  const data = await wzFetch('/chat/send/buttons', {
    method: 'POST',
    token,
    body: {
      Phone: phone,
      Body: text,
      Footer: footer && footer.trim() ? footer : undefined,
      Image: image || undefined,
      // type 'copy' = botao nativo "copiar" (cta_copy): copia b.copyCode para a area de transferencia
      Buttons: buttons.map(b => b.type === 'copy'
        ? { type: 'copy', title: b.text, id: b.id, copy_code: String(b.copyCode || '') }
        : b.type === 'url'
          ? { type: 'cta_url', title: b.text, id: b.id, url: String(b.url || '') }
          : b.type === 'call'
            ? { type: 'cta_call', title: b.text, id: b.id, phone_number: String(b.phone || '') }
            : { type: 'reply', title: b.text, id: b.id })
    }
  });
  return data?.Id || null;
}

const mapBotao = b => b.type === 'copy'
  ? { type: 'copy', title: b.text, id: b.id, copy_code: String(b.copyCode || '') }
  : b.type === 'url'
    ? { type: 'cta_url', title: b.text, id: b.id, url: String(b.url || '') }
    : b.type === 'call'
      ? { type: 'cta_call', title: b.text, id: b.id, phone_number: String(b.phone || '') }
      : { type: 'reply', title: b.text, id: b.id };

// Carrossel nativo. Depende da sua WuzAPI ter o endpoint (padrao /chat/send/carousel; troque com WUZAPI_CAROUSEL_PATH).
// Se a API nao tiver, lanca erro (status 404/405) e o chamador cai para o envio dos cartoes em sequencia.
async function sendCarousel(token, phone, { text, footer, cards }) {
  const data = await wzFetch(process.env.WUZAPI_CAROUSEL_PATH || '/chat/send/carousel', {
    method: 'POST',
    token,
    body: {
      Phone: phone,
      Body: text || undefined,
      Footer: footer && footer.trim() ? footer : undefined,
      Cards: cards.map(c => ({
        Image: c.image || undefined,
        Body: c.text,
        Footer: c.footer && c.footer.trim() ? c.footer : undefined,
        Buttons: c.buttons.map(mapBotao)
      }))
    }
  });
  return data?.Id || null;
}

async function sendList(token, phone, { title, text, footer, buttonText, sections }) {
  const data = await wzFetch('/chat/send/list', {
    method: 'POST',
    token,
    body: {
      Phone: phone,
      TopText: title || undefined,
      Desc: text,
      FooterText: footer && footer.trim() ? footer : undefined,
      ButtonText: buttonText || 'Ver opções',
      Sections: sections.map(sec => ({
        title: sec.title || 'Opções',
        rows: sec.rows.map(r => ({ title: r.title, desc: r.description || '', RowId: r.id }))
      }))
    }
  });
  return data?.Id || null;
}

// Enquete. Na WuzAPI a enquete e sempre de escolha unica.
async function sendPoll(token, phone, { question, options }) {
  const data = await wzFetch('/chat/send/poll', { method: 'POST', token, body: { group: phone, header: question, options } });
  return data?.Id || null;
}

// media: '' (digitando...) ou 'audio' (gravando audio...). state: 'composing' | 'paused'
async function sendPresence(token, phone, media = '', state = 'composing') {
  return wzFetch('/chat/presence', { method: 'POST', token, body: { Phone: phone, State: state, Media: media } });
}

// Agenda do WhatsApp conectado: { "5585999999999@s.whatsapp.net": { FullName, FirstName, PushName, BusinessName, Found } }
async function getContacts(token) {
  let data = await wzFetch('/user/contacts', { token });
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = {}; } }
  return data && typeof data === 'object' ? data : {};
}

// ==================== Midia (video, audio, documento) ====================

// video: data URL ("data:video/mp4;base64,...") ou URL http(s) publica
async function sendVideo(token, phone, video, caption) {
  const data = await wzFetch('/chat/send/video', { method: 'POST', token, body: { Phone: phone, Video: video, Caption: caption || '' } });
  return data?.Id || null;
}

// audio: data URL ("data:audio/ogg;base64,...") ou URL http(s). ptt=true aparece como mensagem de voz gravada na hora.
async function sendAudio(token, phone, audio, { ptt = true, seconds = 0, mimetype } = {}) {
  const body = { Phone: phone, Audio: audio, PTT: ptt };
  if (seconds) body.Seconds = Math.round(seconds);
  if (mimetype) body.MimeType = mimetype;
  const data = await wzFetch('/chat/send/audio', { method: 'POST', token, body });
  return data?.Id || null;
}

async function sendDocument(token, phone, document, fileName, caption) {
  const data = await wzFetch('/chat/send/document', { method: 'POST', token, body: { Phone: phone, Document: document, FileName: fileName || 'arquivo', Caption: caption || '' } });
  return data?.Id || null;
}

// tipo: 'image' | 'video' | 'audio' | 'document'. media = objeto {audio,image,video,document}Message do webhook.
async function downloadMedia(token, tipo, media) {
  const endpoint = { image: 'downloadimage', video: 'downloadvideo', audio: 'downloadaudio', document: 'downloaddocument' }[tipo];
  if (!endpoint) throw new Error(`Tipo de mídia desconhecido: ${tipo}`);
  const data = await wzFetch(`/chat/${endpoint}`, {
    method: 'POST',
    token,
    body: {
      Url: media.URL || media.url,
      DirectPath: media.directPath,
      MediaKey: media.mediaKey,
      Mimetype: media.mimetype,
      FileEncSHA256: media.fileEncSHA256,
      FileSHA256: media.fileSHA256,
      FileLength: Number(media.fileLength || 0)
    }
  });
  const dataUrl = String(data?.Data || '');
  const comma = dataUrl.indexOf(',');
  return {
    base64: comma === -1 ? dataUrl || null : dataUrl.slice(comma + 1),
    mimetype: data?.Mimetype || media.mimetype || 'application/octet-stream'
  };
}

// audio = objeto audioMessage que veio no webhook (mantido por compatibilidade)
async function downloadAudio(token, audio) {
  return downloadMedia(token, 'audio', audio);
}

module.exports = {
  isConfigured,
  createUser,
  listUsers,
  deleteUser,
  tokenInvalido,
  checkUsers,
  connect,
  setWebhook,
  getQr,
  getStatus,
  logout,
  sendText,
  sendImage,
  sendButtons,
  sendCarousel,
  sendList,
  sendPoll,
  sendPresence,
  getContacts,
  sendVideo,
  sendAudio,
  sendDocument,
  downloadMedia,
  downloadAudio
};

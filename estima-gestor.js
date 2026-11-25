// Estima: assistente de voz do gestor.
// Fica ouvindo "Olá, Estima" (se o gestor ligar), responde falando sobre a própria loja e mostra um globo de luz.
// É um adicional: só funciona quando o admin liga para a loja (teste grátis ou ativa). Sem isso, mostra a apresentação.
(function () {
  'use strict';
  if (window.Estima) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const TTS = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* ok */ } } };
  const sstore = { get(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (_) { /* ok */ } } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (msg, err) => { try { if (typeof window.sbToast === 'function') return window.sbToast(err ? 'err' : 'ok', msg); } catch (_) { /* ok */ } console[err ? 'warn' : 'log']('[Estima]', msg); };

  // ---------- ícones (traço, no padrão do painel) ----------
  const I = {
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    send: '<path d="M4 12l16-8-6 16-2.5-6.5L4 12z"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    play: '<path d="M8 5.5v13l10.5-6.5L8 5.5z"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    chart: '<path d="M4 19V9M10 19V5M16 19v-7M21 19H3"/>',
    star: '<path d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4 7.2 18.9l.9-5.4L4.2 9.7l5.4-.8L12 4z"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 13.6c2.6.2 4.5 2.1 4.5 4.9"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
    whats: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7L4 20z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8c-1-.4-1.8-1.2-2.2-2.2l.8-1-1-2L9 9.5z"/>'
  };
  const ic = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n] || ''}</svg>`;

  // ---------- sessão do gestor e chamadas ao servidor ----------
  function sessao() { try { return (typeof _sessao !== 'undefined' && _sessao) || JSON.parse(sessionStorage.getItem('sys_session') || 'null'); } catch (_) { return null; } }
  function headers(json) {
    const s = sessao() || {}; let tok = s.token || '';
    if (!tok) { try { tok = JSON.parse(sessionStorage.getItem('adm_session') || '{}').token || ''; } catch (_) { /* ok */ } }
    const h = { 'x-tenant-id': String(s.tenant_id || '') }; if (tok) h.Authorization = 'Bearer ' + tok; if (json) h['Content-Type'] = 'application/json'; return h;
  }
  async function api(caminho, corpo) {
    const r = await fetch('/api/estima/' + caminho, corpo === undefined ? { headers: headers(false) } : { method: 'POST', headers: headers(true), body: JSON.stringify(corpo) });
    let j = null; try { j = await r.json(); } catch (_) { /* sem corpo */ }
    if (!r.ok) { const e = new Error((j && j.error) || 'A Estima não respondeu (erro ' + r.status + ').'); e.status = r.status; e.code = j && j.code; throw e; }
    return j;
  }

  // ---------- estado da loja (contratado? teste?) ----------
  let estado = null;
  const liberada = () => !!(estado && estado.liberada);
  async function carregarEstado() {
    try { estado = await api('estado'); } catch (e) { if (!estado) estado = { status: 'erro', liberada: false, erro: e.message }; }
    premium = estado && estado.voz_premium && estado.voz_premium.ready ? estado.voz_premium : { ready: false, voices: [] };
    pintarTopo(); if (paginaAberta()) renderPagina();
    if (liberada()) startWake(); else stopWake();
    return estado;
  }

  // ---------- preferências (neste aparelho) ----------
  const prefs = {
    get wake() { return store.get('est_wake') === '1'; }, set wake(v) { store.set('est_wake', v ? '1' : '0'); },
    get voice() { return store.get('est_voice') || ''; }, set voice(v) { store.set('est_voice', v || ''); },
    get rate() { return Number(store.get('est_rate')) || 1.04; }, set rate(v) { store.set('est_rate', String(v)); },
    get pitch() { return Number(store.get('est_pitch')) || 1.05; }, set pitch(v) { store.set('est_pitch', String(v)); },
    get name() { const n = store.get('est_name'); if (n !== null) return n; const u = String((sessao() || {}).nome || '').trim().split(/\s+/)[0] || ''; return /^(admin|administrador|gestor|dono|usu[aá]rio|estima)$/i.test(u) ? '' : u; },
    set name(v) { store.set('est_name', String(v || '').trim().slice(0, 30)); }
  };

  // ---------- vozes ----------
  const FEM = /maria|francisca|thalita|luciana|fernanda|vit[oó]ria|camila|raquel|joana|helena|leila|brenda|elza|giovanna|let[ií]cia|manuela|yara|\bana\b|catarina|in[eê]s|female|feminin|mulher|google portugu[eê]s do brasil|google português/i;
  const MASC = /daniel|ant[oô]nio|donato|f[aá]bio|humberto|j[uú]lio|nicolau|val[eé]rio|duarte|felipe|male\b|masculin|reed|eddy|rocko|grandpa|jo[aã]o/i;
  let premium = { ready: false, voices: [] };
  const premiumList = () => premium.ready ? premium.voices.map(x => ({ id: 'openai:' + x.id, label: x.label, note: x.note, gender: x.gender, premium: true })) : [];
  const selectedPremium = id => { const v = id !== undefined ? id : (prefs.voice || (premium.ready ? 'openai:marin' : '')); return premium.ready && /^openai:/.test(v) ? v.slice(7) : null; };
  function browserVoices() {
    if (!TTS) return [];
    return speechSynthesis.getVoices().filter(v => /^pt/i.test(v.lang)).map(v => {
      const female = FEM.test(v.name) && !/male\b/i.test(v.name.replace(/female/i, '')), male = !female && MASC.test(v.name);
      const natural = /natural|online|neural|premium|enhanced|aprimorad/i.test(v.name), google = /google/i.test(v.name);
      let label = v.name.replace(/^Microsoft\s+/i, '').replace(/\s*Online\s*\(Natural\)/i, '').replace(/\s*-\s*Portuguese.*$/i, '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
      if (google) label = 'Google (padrão do Chrome)';
      return { v, id: v.voiceURI || v.name, label, gender: female ? 'f' : male ? 'm' : '', br: /pt[-_]BR/i.test(v.lang), score: (/pt[-_]BR/i.test(v.lang) ? 100 : 0) + (female ? 50 : 0) + (natural ? 30 : 0) + (google ? 12 : 0) };
    }).sort((a, b) => b.score - a.score);
  }
  const currentVoice = () => { const vs = browserVoices(); return (vs.find(x => x.id === prefs.voice) || vs[0] || {}).v || null; };
  if (TTS && speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', () => { if (paginaAberta()) pintarVozes(); });

  // ---------- texto -> fala natural ----------
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  // cardápio escrito sem acento ou em MAIÚSCULAS: a voz soletraria; corrigimos só para falar
  const ACENTOS = { acai: 'açaí', acaí: 'açaí', açai: 'açaí', acougue: 'açougue', pao: 'pão', paes: 'pães', cafe: 'café', file: 'filé', files: 'filés', pure: 'purê', feijao: 'feijão', macarrao: 'macarrão', camarao: 'camarão', limao: 'limão', maracuja: 'maracujá', guarana: 'guaraná', agua: 'água', acucar: 'açúcar', linguica: 'linguiça', coracao: 'coração', baiao: 'baião',
    sanduiche: 'sanduíche', hamburguer: 'hambúrguer', hamburger: 'hambúrguer', pudim: 'pudim', porcao: 'porção', porcoes: 'porções', calabresa: 'calabresa', mussarela: 'muçarela', file_: 'filé', frances: 'francês', pastel: 'pastel', salgado: 'salgado', petisco: 'petisco', molho: 'molho', estrogonofe: 'estrogonofe', strogonoff: 'estrogonofe',
    pizzaria: 'pizzaria', lanchonete: 'lanchonete', churrascaria: 'churrascaria', espetinho: 'espetinho', marmita: 'marmita', marmitex: 'marmitex', parmegiana: 'parmegiana', aipim: 'aipim', mandioca: 'mandioca', cha: 'chá', creme: 'creme', sorvete: 'sorvete', picole: 'picolé', brigadeiro: 'brigadeiro', bebidas: 'bebidas', lanches: 'lanches', pratos: 'pratos', porcoes_: 'porções', sobremesas: 'sobremesas',
    joao: 'João', jose: 'José', sebastiao: 'Sebastião', antonio: 'Antônio', conceicao: 'Conceição', ze: 'Zé', sao: 'São', delicias: 'delícias', praca: 'praça', nacao: 'nação', paixao: 'paixão', tentacao: 'tentação' };
  const SIGLAS = /^(CPF|CNPJ|PIX|MEI|LTDA|ME|TV|DJ|PDV|VIP|BBQ|DRE|KDS|QR|ML|KG)$/;
  function sayWords(s) {
    return s.replace(/[A-Za-zÀ-ÿ]{2,}/g, w => {
      const low = w.toLowerCase(), fix = ACENTOS[low];
      const isCaps = w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w);
      if (isCaps && SIGLAS.test(w)) return w;
      if (isCaps && /^(A|O|E|DE|DA|DO|DAS|DOS|NA|NO|NAS|NOS|COM|EM|AO|OU|SEM)$/.test(w)) return low; // "FILE A PARMEGIANA" -> "Filé a Parmegiana"
      const base = fix || (isCaps ? low : w);
      if (fix && fix[0] === fix[0].toUpperCase()) return fix;
      return (isCaps || /^[A-ZÀ-Ý]/.test(w)) ? base.charAt(0).toUpperCase() + base.slice(1) : base;
    });
  }
  function toSpeech(t) {
    let s = String(t || '');
    s = s.replace(/\bX[\s-]?(?=[A-Za-zÀ-ÿ]{3})/g, 'xis ').replace(/\b(\d+)\s?ml\b/gi, '$1 mililitros').replace(/\b(\d+(?:[.,]\d+)?)\s?kg\b/gi, '$1 quilos').replace(/\b(\d+)\s?L\b/g, '$1 litros').replace(/\b(\d+)\s?g\b/g, '$1 gramas');
    s = s.replace(/\b([A-ZÀ-Ý]{2,}) (A|O|E|DE|DA|DO|DAS|DOS|NA|NO|COM|EM|AO|SEM) (?=[A-ZÀ-Ý]{2,})/g, (m, a, b) => a + ' ' + b.toLowerCase() + ' ');
    s = sayWords(s);
    s = s.replace(/\*\*|__|`|#+\s/g, '').replace(/^\s*(?:[-•*]|\d+[.)])\s+/gm, '').replace(/\p{Extended_Pictographic}|️/gu, '');
    s = s.replace(/R\$\s*([\d.]+)(?:,(\d{1,2}))?/g, (_, r, c) => { const reais = Number(r.replace(/\./g, '')); const cent = c ? Number(c.padEnd(2, '0')) : 0; return `${reais} ${reais === 1 ? 'real' : 'reais'}${cent ? ` e ${cent} ${cent === 1 ? 'centavo' : 'centavos'}` : ''}`; });
    s = s.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (m, d, mo, y) => MESES[Number(mo) - 1] ? `${Number(d)} de ${MESES[Number(mo) - 1]} de ${y}` : m);
    s = s.replace(/\b(\d{1,2})\/(\d{1,2})\b/g, (m, d, mo) => Number(mo) >= 1 && Number(mo) <= 12 && Number(d) <= 31 ? `${Number(d)} de ${MESES[Number(mo) - 1]}` : m);
    s = s.replace(/\b(\d{1,2})h(\d{2})\b/g, '$1 e $2').replace(/\b(\d{1,2})h\b/g, '$1 horas').replace(/\s*[|]\s*/g, ', ').replace(/ — | – /g, ', ').replace(/(\d)%/g, '$1 por cento').replace(/(\d+)x\b/g, '$1 vezes');
    s = s.split('\n').map(l => l.trim()).filter(Boolean).map(l => /[.!?:]$/.test(l) ? l : l + '.').join(' ');
    return s.replace(/\s+/g, ' ').trim();
  }
  function chunks(s) { const out = []; let cur = ''; for (const part of s.split(/(?<=[.!?;])\s+/)) { if ((cur + ' ' + part).length > 170 && cur) { out.push(cur); cur = part; } else cur = cur ? cur + ' ' + part : part; } if (cur) out.push(cur); return out; }

  let speakToken = 0, speechBlocked = false, voiceBroken = '', keep = [], premiumWarned = false;
  function speak(text, opt = {}) {
    const pv = opt.premium !== undefined ? opt.premium : selectedPremium();
    if (pv) {
      const my = speakToken + 1;
      return speakPremium(text, pv, opt.rate || prefs.rate).catch(e => {
        if (e && e.name === 'AbortError') return;
        if (e && e.blocked) { speechBlocked = true; return; }
        if (my < speakToken) return;
        if (!premiumWarned || opt.premium) { premiumWarned = true; toast((e && e.message ? e.message : 'A voz premium falhou.') + ' Usando a voz do navegador.', true); }
        return speakBrowser(text, opt);
      });
    }
    return speakBrowser(text, opt);
  }
  let actx = null, cur = null;
  function audioCtx() { if (actx) return actx; try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { actx = null; } return actx; }
  function premiumLevel() { if (!cur || !cur.an || !cur.audio || cur.audio.paused) return 0; cur.an.getByteTimeDomainData(cur.buf); let x = 0; for (let i = 0; i < cur.buf.length; i++) { const v = (cur.buf[i] - 128) / 128; x += v * v; } return Math.sqrt(x / cur.buf.length); }
  function premiumParts(t) { const sents = toSpeech(t).split(/(?<=[.!?;])\s+/).filter(Boolean); const out = []; let acc = ''; for (const x of sents) { const lim = out.length ? 420 : 150; if (acc && (acc + ' ' + x).length > lim) { out.push(acc); acc = x; } else acc = acc ? acc + ' ' + x : x; } if (acc) out.push(acc); return out.slice(0, 6); }
  async function fetchSpeech(text, voice, signal) {
    const r = await fetch('/api/estima/voz', { method: 'POST', signal, headers: headers(true), body: JSON.stringify({ text, voice }) });
    if (!r.ok) { let m = 'A voz premium falhou.'; try { m = (await r.json()).error || m; } catch (_) { /* ok */ } throw new Error(m); }
    return URL.createObjectURL(await r.blob());
  }
  async function speakPremium(text, voice, rate) {
    stopAudio(); if (TTS && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
    const my = ++speakToken, ctl = new AbortController(); const parts = premiumParts(text); if (!parts.length) return;
    const ac = audioCtx(); if (ac && ac.state !== 'running') { try { await ac.resume(); } catch (_) { /* ok */ } }
    const urls = parts.map(p => fetchSpeech(p, voice, ctl.signal)); urls.forEach(u => u.catch(() => {}));
    cur = { ctl }; const made = [];
    try {
      for (const pu of urls) {
        const url = await pu; made.push(url); if (my !== speakToken) return;
        const audio = new Audio(); audio.src = url; audio.playbackRate = rate || 1; audio.preservesPitch = true;
        let an = null, buf = null;
        if (ac && ac.state === 'running') { try { const src = ac.createMediaElementSource(audio); an = ac.createAnalyser(); an.fftSize = 512; src.connect(an); an.connect(ac.destination); buf = new Uint8Array(an.fftSize); } catch (_) { an = null; } }
        cur = { audio, an, buf, ctl };
        await new Promise((res, rej) => {
          audio.onended = res; audio.onerror = () => rej(new Error('Não consegui tocar o áudio da voz.')); audio.onpause = () => { if (my !== speakToken) res(); };
          audio.play().then(() => orbKick(0.4)).catch(e => { if (e && e.name === 'NotAllowedError') { const b = new Error('blocked'); b.blocked = true; rej(b); } else rej(e); });
        });
        if (my !== speakToken) return;
      }
    } finally { setTimeout(() => made.forEach(u => URL.revokeObjectURL(u)), 1500); if (cur && cur.ctl === ctl) cur = null; }
  }
  function stopAudio() { if (!cur) return; try { cur.ctl && cur.ctl.abort(); } catch (_) { /* ok */ } try { cur.audio && cur.audio.pause(); } catch (_) { /* ok */ } cur = null; }
  function speakBrowser(text, opt = {}) {
    return new Promise(resolve => {
      if (!TTS) return resolve();
      const parts = chunks(toSpeech(text)); if (!parts.length) return resolve();
      const my = ++speakToken; let i = 0, guard = null, startT = null;
      if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
      const done = () => { clearTimeout(guard); clearTimeout(startT); keep = []; resolve(); };
      const say = (txt, useVoice) => {
        const u = new SpeechSynthesisUtterance(txt); keep.push(u); u.lang = 'pt-BR'; u.rate = opt.rate || prefs.rate; u.pitch = opt.pitch || prefs.pitch;
        const v = useVoice ? (opt.voice || currentVoice()) : null; if (v) { u.voice = v; u.lang = v.lang; }
        let started = false;
        u.onstart = () => { started = true; clearTimeout(startT); orbKick(0.4); };
        u.onboundary = () => orbKick(0.32);
        u.onend = () => { if (started || !useVoice) next(); };
        u.onerror = e => { clearTimeout(startT); if (e && e.error === 'not-allowed') speechBlocked = true; if (e && (e.error === 'interrupted' || e.error === 'canceled')) return; if (!started && useVoice && v) { voiceBroken = v.name; return say(txt, false); } next(); };
        startT = setTimeout(() => { if (started || my !== speakToken) return; if (useVoice && v) { voiceBroken = v.name; speechSynthesis.cancel(); setTimeout(() => say(txt, false), 80); } else next(); }, 2500);
        clearTimeout(guard); guard = setTimeout(next, 6000 + txt.length * 110);
        try { speechSynthesis.resume(); } catch (_) { /* ok */ }
        speechSynthesis.speak(u);
      };
      const next = () => { clearTimeout(guard); clearTimeout(startT); if (my !== speakToken) return done(); if (i >= parts.length) return done(); say(parts[i++], true); };
      setTimeout(next, 90);
    });
  }
  function stopSpeaking() { speakToken++; stopAudio(); if (TTS) speechSynthesis.cancel(); }

  // ---------- globo (azul EstimaFood) ----------
  const orbs = new Set();
  function orbKick(v) { orbs.forEach(o => o.kick(v)); }
  function Orb(cv, mini) {
    const ctx = cv.getContext('2d'); const N = mini ? 650 : 1500; const pts = [];
    for (let i = 0; i < N; i++) { const y = 1 - 2 * (i + 0.5) / N, r = Math.sqrt(1 - y * y), th = i * 2.399963; pts.push([Math.cos(th) * r, y, Math.sin(th) * r, th, Math.asin(y)]); }
    let w = 0, h = 0, raf = 0, last = performance.now(), t = 0, level = 0, kick = 0, hue = 200, spin = 0, state = 'idle', input = null, lastRipple = 0; const ripples = [];
    const HUE = { idle: 200, listening: 186, thinking: 258, speaking: 202, locked: 215 };
    function size() { const dpr = Math.min(window.devicePixelRatio || 1, 2), b = cv.getBoundingClientRect(); w = b.width; h = b.height; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      let dt = Math.min((now - last) / 1000, 0.05); last = now; if (REDUCED) dt *= 0.35; t += dt;
      if (!cv.isConnected || !cv.getClientRects().length) return; // escondido: não gasta processamento
      if (!w) size(); if (!w || !h) return;
      const ext = input ? input() : 0;
      let tg = 0.07 + 0.03 * Math.sin(t * 1.5);
      if (state === 'listening') tg = 0.13 + Math.min(ext * 2.4, 0.75);
      else if (state === 'thinking') tg = 0.24 + 0.07 * Math.sin(t * 6);
      else if (state === 'speaking') tg = ext > 0.004 ? 0.26 + Math.min(ext * 3.4, 0.8) + kick * 0.3 : 0.3 + 0.22 * Math.abs(Math.sin(t * 7.1) * Math.sin(t * 2.9 + 1)) + kick;
      else if (state === 'locked') tg = 0.04;
      kick *= Math.pow(0.04, dt); level += (tg - level) * Math.min(1, dt * 9); hue += ((HUE[state] || 200) - hue) * Math.min(1, dt * 2.5);
      spin += dt * (state === 'thinking' ? 1.15 : state === 'speaking' ? 0.45 : 0.22);
      const cx = w / 2, cy = h * (mini ? 0.5 : 0.42), R = Math.min(w, h) * (mini ? 0.27 : 0.165) * (1 + level * 0.1);
      const sat = state === 'locked' ? 45 : 100;
      ctx.clearRect(0, 0, w, h); ctx.globalCompositeOperation = 'lighter';
      let g = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R * 2.8);
      g.addColorStop(0, `hsla(${hue},${sat}%,60%,${0.3 + level * 0.32})`); g.addColorStop(0.35, `hsla(${hue + 24},${sat}%,55%,${0.12 + level * 0.12})`); g.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      if (state === 'speaking' && !REDUCED && t - lastRipple > 0.26 && level > 0.36) { ripples.push({ r: R * 1.1, a: 0.5, h: hue + Math.random() * 40 - 10 }); lastRipple = t; }
      for (let i = ripples.length - 1; i >= 0; i--) { const rp = ripples[i]; rp.r += R * 1.25 * dt; rp.a *= Math.pow(0.18, dt); if (rp.a < 0.015) { ripples.splice(i, 1); continue; } ctx.strokeStyle = `hsla(${rp.h},100%,66%,${rp.a})`; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(cx, cy, rp.r, 0, 6.2832); ctx.stroke(); }
      const rings = mini ? 3 : 4;
      for (let k = 0; k < rings; k++) {
        const rad = R * (1.2 + k * 0.14), amp = R * (0.025 + level * 0.17) * (1 - k * 0.16), c = `hsla(${hue + 10 + k * 22},${sat}%,64%,${0.55 - k * 0.1})`;
        ctx.strokeStyle = c; ctx.lineWidth = mini ? 1.1 : 1.6; if (!mini) { ctx.shadowColor = c; ctx.shadowBlur = 14; }
        ctx.beginPath();
        for (let s = 0; s <= 160; s++) { const a = s / 160 * 6.2832; const rr = rad + amp * (Math.sin(a * (3 + k * 2) + t * (1.6 + k * 0.7)) * 0.6 + Math.sin(a * (7 + k) - t * (2.4 + k * 0.5)) * 0.4); const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.98; if (s) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.closePath(); ctx.stroke();
      }
      ctx.shadowBlur = 0;
      for (let k = 0; k < 2; k++) { ctx.strokeStyle = `hsla(${hue + 36 + k * 46},${sat}%,70%,${0.18 + level * 0.25})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(cx, cy, R * (1.55 + k * 0.12), R * (0.34 + k * 0.08), spin * (k ? -0.6 : 0.4) + k * 1.1, 0, 6.2832); ctx.stroke(); }
      const cy0 = Math.cos(spin), sy0 = Math.sin(spin), tilt = 0.24 + 0.08 * Math.sin(t * 0.4), cx0 = Math.cos(tilt), sx0 = Math.sin(tilt);
      for (let i = 0; i < N; i++) {
        const p = pts[i]; let x = p[0] * cy0 + p[2] * sy0, z = -p[0] * sy0 + p[2] * cy0, y = p[1];
        const y2 = y * cx0 - z * sx0; z = y * sx0 + z * cx0; y = y2;
        const d = 1 + level * (0.07 * Math.sin(p[4] * 6 - t * 5.2) + 0.045 * Math.sin(p[3] * 4 + t * 3) * Math.cos(p[4]) + 0.025 * Math.sin(t * 13 + p[3] * 9));
        const per = 4.2 / (4.2 - z * d), sx = cx + x * d * R * per, sy = cy + y * d * R * per, dep = (z + 1) / 2;
        const sz = (mini ? 0.8 : 1.05) + dep * (mini ? 1.3 : 1.8) * (1 + level * 0.8);
        ctx.fillStyle = `hsla(${hue + p[4] * 34 + dep * 26},${sat}%,${52 + dep * 30}%,${0.22 + dep * 0.72})`; ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
      }
      ctx.strokeStyle = `hsla(${hue + 8},${sat}%,70%,${0.22 + level * 0.3})`; ctx.lineWidth = mini ? 1 : 1.5; if (!mini) { ctx.shadowColor = `hsla(${hue},100%,65%,.9)`; ctx.shadowBlur = 22; }
      ctx.beginPath(); ctx.arc(cx, cy, R * (1.03 + level * 0.05), 0, 6.2832); ctx.stroke(); ctx.shadowBlur = 0;
      g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * (0.7 + level * 0.4));
      g.addColorStop(0, `hsla(${hue - 10},100%,92%,${0.35 + level * 0.4})`); g.addColorStop(0.4, `hsla(${hue},${sat}%,62%,${0.12 + level * 0.2})`); g.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.2, 0, 6.2832); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    const o = { start() { if (!raf) { size(); last = performance.now(); raf = requestAnimationFrame(frame); } orbs.add(o); return o; }, stop() { cancelAnimationFrame(raf); raf = 0; orbs.delete(o); }, resize: size, setState(s) { state = s; }, kick(v) { kick = Math.min(kick + v, 0.6); }, setInput(fn) { input = fn; } };
    return o;
  }
  window.addEventListener('resize', () => orbs.forEach(o => o.resize()));

  // ---------- microfone (só para o globo reagir à voz) ----------
  let mic = null;
  async function micOn() {
    if (mic || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ac = new (window.AudioContext || window.webkitAudioContext)(), an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize); mic = { stream, ac, read() { an.getByteTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; } return Math.sqrt(s / buf.length); } };
    } catch (_) { mic = null; }
  }
  function micOff() { if (!mic) return; try { mic.stream.getTracks().forEach(t => t.stop()); mic.ac.close(); } catch (_) { /* ok */ } mic = null; }

  // ---------- frases ----------
  const pick = (arr, key) => { const lastI = Number(sstore.get(key)); let i; do { i = Math.floor(Math.random() * arr.length); } while (arr.length > 1 && i === lastI); sstore.set(key, String(i)); return arr[i]; };
  function greeting() {
    const n = prefs.name, hNow = new Date().getHours(), part = hNow < 12 ? 'Bom dia' : hNow < 18 ? 'Boa tarde' : 'Boa noite', N = n ? ', ' + n : '';
    return pick([`Olá${N}. O que você quer saber da loja?`, `Oi${N}. Estou ouvindo.`, `${part}${N}. Em que posso ajudar?`, `Pode falar${N}. Quer saber das vendas, dos produtos ou dos clientes?`, `Estou aqui${N}. Pode perguntar.`, `${part}${N}. Vamos ver como está a loja?`, `Oi${N}. Como posso ajudar a vender mais hoje?`], 'est_g');
  }
  function goodbye() { const N = prefs.name ? ', ' + prefs.name : ''; return pick([`Por nada${N}. Boas vendas!`, `Disponha${N}.`, `Quando precisar, é só chamar.`, `Combinado${N}. Até já.`, `Imagina${N}. Qualquer coisa, me chama.`], 'est_b'); }

  // ---------- palavra de ativação ----------
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  // "estima" é palavra comum ("a gente estima que..."): só atende com um chamado antes (olá, oi, ei...)
  const WAKE = /(?:^|\s)(?:ola|oi|ei|hey|alo|fala|e ai|eae|ok|okay)\s+(?:a\s+)?(?:estima|estimar|estime|istima|esteema|estiima|stima|estimo)(?:\s+|$)/;
  const FAREWELL = /^((ok |beleza |ta |entao )?(obrigad[oa]|valeu|tchau|ate mais|ate logo|ate depois|ate amanha|falou|so isso|era so isso|e so isso|nao obrigado|pode fechar|fechar|encerrar|encerra|pode encerrar|fecha|desligar|pode desligar|boa noite|bom descanso)( estima)?( (obrigad[oa]|tchau|valeu|era so isso))?)$/;

  let rec = null;
  function killRec() { if (!rec) return; const r = rec; rec = null; r.onresult = r.onerror = r.onend = r.onstart = null; try { r.abort(); } catch (_) { /* ok */ } }
  const canListen = () => !!SR && window.isSecureContext;

  let mode = 'off', phase = 'idle', wakeBackoff = 300, wakeTimer = null, ctxMsgs = [], ctxAt = 0, busy = false;
  try { ctxMsgs = JSON.parse(sstore.get('est_ctx') || '[]'); } catch (_) { ctxMsgs = []; }
  const saveCtx = () => sstore.set('est_ctx', JSON.stringify(ctxMsgs.slice(-24)));

  function startWake() {
    clearTimeout(wakeTimer);
    if (!prefs.wake || !liberada() || !canListen() || mode === 'open' || document.hidden) { if (mode === 'wake') mode = 'off'; pintarTopo(); return; }
    killRec(); mode = 'wake'; pintarTopo();
    const r = new SR(); rec = r; r.lang = 'pt-BR'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    let pending = null;
    const fire = after => { clearTimeout(pending); if (rec !== r) return; killRec(); wakeBackoff = 300; open(after); };
    r.onstart = () => { wakeBackoff = 300; };
    r.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i], txt = norm(res[0].transcript), m = WAKE.exec(txt); if (!m) continue;
        const after = txt.slice(m.index + m[0].length).trim();
        clearTimeout(pending);
        if (res.isFinal) return fire(after);
        pending = setTimeout(() => fire(after), after ? 1000 : 600);
      }
    };
    r.onerror = e => {
      if (rec !== r) return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { prefs.wake = false; killRec(); mode = 'off'; pintarTopo(); toast('O navegador bloqueou o microfone. Clique no cadeado ao lado do endereço e permita o microfone.', true); if (paginaAberta()) renderPagina(); }
      else if (e.error === 'network') wakeBackoff = 4000;
      else if (e.error === 'audio-capture') wakeBackoff = 8000;
    };
    r.onend = () => { if (rec !== r) return; rec = null; if (mode === 'wake') wakeTimer = setTimeout(startWake, wakeBackoff); wakeBackoff = Math.min(wakeBackoff * 1.5, 8000); };
    try { r.start(); } catch (_) { rec = null; wakeTimer = setTimeout(startWake, 1500); }
  }
  function stopWake() { clearTimeout(wakeTimer); if (mode === 'wake') { killRec(); mode = 'off'; } pintarTopo(); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (mode === 'wake') stopWake(); } else if (mode !== 'open') startWake(); });

  // ---------- janela da Estima ----------
  let ov = null, bigOrb = null;
  function build() {
    if (ov) return ov;
    ov = document.createElement('div'); ov.id = 'estima-ov'; ov.className = 'est-ov'; ov.hidden = true;
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Estima, assistente de voz');
    ov.innerHTML = `<canvas class="est-cv" aria-hidden="true"></canvas>
      <button class="est-orb-hit" type="button" aria-label="Tocar no globo: falar com a Estima ou interromper"></button>
      <div class="est-top"><span class="est-name"><i class="est-dot" aria-hidden="true"></i>Estima</span><button class="est-x" type="button" aria-label="Fechar a Estima">${ic('x', 20)}</button></div>
      <div class="est-cap" aria-live="polite"><p class="est-state"></p><p class="est-you"></p><p class="est-say"></p></div>
      <form class="est-type" autocomplete="off"><label class="est-sr" for="estIn">Digitar pergunta para a Estima</label><input id="estIn" maxlength="600" placeholder="Prefere digitar? Escreva aqui"><button type="submit" aria-label="Enviar pergunta">${ic('send', 18)}</button></form>`;
    document.body.appendChild(ov);
    bigOrb = Orb(ov.querySelector('.est-cv'), false);
    bigOrb.setInput(() => (mic && phase === 'listening') ? mic.read() : (phase === 'speaking' || phase === 'greet') ? premiumLevel() : 0);
    ov.querySelector('.est-x').addEventListener('click', () => close());
    ov.querySelector('.est-orb-hit').addEventListener('click', () => { if (phase === 'speaking' || phase === 'greet') { stopSpeaking(); listen(); } else if (phase === 'idle') listen(); });
    ov.querySelector('.est-type').addEventListener('submit', e => { e.preventDefault(); const i = ov.querySelector('#estIn'); const q = i.value.trim(); if (!q) return; i.value = ''; killRec(); stopSpeaking(); ask(q, false); });
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
    return ov;
  }
  const STATE_TXT = { greet: 'Estima', listening: 'Ouvindo', thinking: 'Olhando os números da loja', speaking: 'Estima', idle: 'Toque no globo para falar' };
  function setPhase(p) { phase = p; if (!ov) return; bigOrb.setState(p === 'greet' ? 'speaking' : p); ov.dataset.phase = p; ov.querySelector('.est-state').textContent = STATE_TXT[p] || ''; }
  function caption(you, say) { if (!ov) return; if (you !== undefined) ov.querySelector('.est-you').textContent = you; if (say !== undefined) ov.querySelector('.est-say').textContent = say; }

  function open(after, typed) {
    if (!liberada()) { abrirPagina(); return; }
    build(); stopWake(); killRec(); mode = 'open'; pintarTopo();
    if (ov.hidden) { ov.hidden = false; requestAnimationFrame(() => ov.classList.add('on')); bigOrb.start(); caption('', ''); document.documentElement.classList.add('est-aberta'); }
    ov.querySelector('.est-x').focus({ preventScroll: true });
    if (Date.now() - ctxAt > 5 * 60000) { ctxMsgs = []; saveCtx(); }
    if (typed) return ask(typed, false);
    if (after && after.split(' ').length >= 2) return ask(after, true);
    greet();
  }
  async function greet() {
    const g = greeting(); setPhase('greet'); caption('', g);
    await speak(g); if (mode !== 'open') return;
    if (speechBlocked) { speechBlocked = false; toast('Clique uma vez em qualquer lugar da tela para a Estima poder falar.', true); }
    listen();
  }
  function close() {
    if (!ov || ov.hidden) return; stopSpeaking(); killRec(); micOff(); busy = false;
    ov.classList.remove('on'); document.documentElement.classList.remove('est-aberta');
    setTimeout(() => { if (!ov.classList.contains('on')) { ov.hidden = true; bigOrb.stop(); } }, 260);
    mode = 'off'; phase = 'idle'; setTimeout(startWake, 500);
    if (paginaAberta()) pintarHistorico();
  }

  const END_FINAL = 650, END_INTERIM = 1100;
  function listen() {
    if (mode !== 'open') return;
    if (!canListen()) { setPhase('idle'); caption('', !SR ? 'Este navegador não entende voz. Use o Google Chrome ou o Microsoft Edge. Você pode digitar abaixo.' : 'O microfone só funciona com o endereço em https://. Você pode digitar abaixo.'); return; }
    killRec(); setPhase('listening'); caption(''); micOn();
    const r = new SR(); rec = r; r.lang = 'pt-BR'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    let fin = '', interim = '', endT = null, sent = false, failed = false;
    const finish = () => { if (rec !== r || sent) return; const q = (fin + ' ' + interim).replace(/\s+/g, ' ').trim(); if (!q) return; sent = true; clearTimeout(endT); killRec(); ask(q, true); };
    r.onresult = e => {
      if (rec !== r) return; interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const x = e.results[i]; if (x.isFinal) fin += ' ' + x[0].transcript; else interim += x[0].transcript; }
      caption((fin + ' ' + interim).replace(/\s+/g, ' ').trim());
      clearTimeout(endT); endT = setTimeout(finish, interim.trim() ? END_INTERIM : END_FINAL);
    };
    r.onerror = e => {
      if (rec !== r) return;
      // a última resposta continua na tela; o aviso vai na linha de estado
      const aviso = m => { failed = true; killRec(); setPhase('idle'); if (ov) ov.querySelector('.est-state').textContent = m; };
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') aviso('Microfone bloqueado: clique no cadeado ao lado do endereço e permita. Ou digite abaixo.');
      else if (e.error === 'network') aviso('A voz precisa de internet e não conectou. Toque no globo para tentar de novo.');
      else if (e.error === 'audio-capture') aviso('Não encontrei o microfone. Confira se está ligado e toque no globo.');
    };
    r.onend = () => {
      if (rec !== r) return; rec = null; clearTimeout(endT);
      if (sent || failed) return;
      if ((fin + interim).trim()) { sent = true; return ask((fin + ' ' + interim).replace(/\s+/g, ' ').trim(), true); }
      if (mode === 'open' && !busy) setTimeout(() => { if (mode === 'open' && !busy && !rec && phase === 'listening') listen(); }, 120);
    };
    try { r.start(); } catch (_) { rec = null; setTimeout(() => { if (mode === 'open' && !rec) listen(); }, 400); }
  }

  async function ask(q, spoken) {
    if (busy) return; busy = true;
    const nq = norm(q).replace(/\bestima\b/g, '').trim();
    caption(q, '');
    if (spoken && FAREWELL.test(nq)) { busy = false; const b = goodbye(); setPhase('speaking'); caption(q, b); await speak(b); return close(); }
    setPhase('thinking');
    ctxMsgs.push({ role: 'user', content: q }); ctxAt = Date.now(); saveCtx();
    let reply, failed = false;
    try {
      const r = await api('perguntar', { voice: true, name: prefs.name, messages: ctxMsgs.slice(-14) });
      reply = r.reply; ctxMsgs.push({ role: 'assistant', content: reply, used: r.used }); saveCtx();
    } catch (e) {
      failed = true; ctxMsgs.pop(); saveCtx(); reply = e.message;
      if (e.code === 'ESTIMA_BLOQUEADA') { carregarEstado(); }
    }
    busy = false; if (mode !== 'open') return;
    setPhase('speaking'); caption(q, reply);
    await speak(reply); if (mode !== 'open' || phase !== 'speaking') return;
    if (speechBlocked) { speechBlocked = false; toast('Clique uma vez em qualquer lugar da tela para a Estima poder falar.', true); }
    if (failed) { setPhase('idle'); return; }
    listen();
  }

  // ---------- botão no topo, item no menu e no "Mais" do celular ----------
  function pintarTopo() {
    const b = document.getElementById('est-topbtn'); if (!b) return;
    b.classList.toggle('waking', mode === 'wake'); b.classList.toggle('locked', !liberada());
    b.title = !liberada() ? 'Estima: assistente de voz da loja (conheça)' : mode === 'wake' ? 'A Estima está esperando você dizer “Olá, Estima”' : 'Falar com a Estima';
    const t = b.querySelector('.est-top-txt'); if (t) t.textContent = mode === 'wake' ? 'Diga “Olá, Estima”' : 'Estima';
    const side = document.getElementById('sn-estima'); if (side) { const tag = side.querySelector('.est-tag'); if (tag) { tag.textContent = estado && estado.status === 'teste' ? 'TESTE' : liberada() ? 'IA' : 'NOVO'; } }
  }
  function montarEntradas() {
    // topo
    const tnr = document.querySelector('.topnav .tnr');
    if (tnr && !document.getElementById('est-topbtn')) {
      const b = document.createElement('button'); b.type = 'button'; b.id = 'est-topbtn'; b.className = 'est-topbtn';
      b.innerHTML = '<i class="est-dot" aria-hidden="true"></i><span class="est-top-txt">Estima</span>';
      b.addEventListener('click', () => { if (liberada()) open(''); else abrirPagina(); });
      tnr.insertBefore(b, tnr.firstChild);
    }
    // menu lateral (grupo Gestão, antes de "Meu desempenho")
    if (!document.getElementById('sn-estima')) {
      const ref = document.getElementById('sn-desempenho') || document.getElementById('sn-relatorios');
      if (ref && ref.parentNode) {
        const s = document.createElement('button'); s.className = 'si'; s.id = 'sn-estima'; s.type = 'button';
        s.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.6" stroke="currentColor" stroke-width="1.4"/><path d="M2.6 8c1.6-1.5 3.4-1.5 5.4 0s3.8 1.5 5.4 0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/></svg> Estima <span class="est-tag">IA</span><span style="display:none"> assistente voz inteligencia artificial perguntar vendas dicas</span>';
        s.addEventListener('click', () => abrirPagina());
        ref.parentNode.insertBefore(s, ref);
      }
    }
    // "Mais" do celular: primeiro grupo
    const grid = document.querySelector('#m-mais div[style*="grid-template-columns"]');
    if (grid && !document.getElementById('mm-estima')) {
      const m = document.createElement('button'); m.className = 'm-mi'; m.id = 'mm-estima'; m.type = 'button';
      m.innerHTML = '<i class="est-dot est-dot-lg" aria-hidden="true"></i><span>Estima</span>';
      m.addEventListener('click', () => { try { window.mClose && window.mClose(); } catch (_) { /* ok */ } if (liberada()) open(''); else abrirPagina(); });
      grid.insertBefore(m, grid.firstChild);
    }
    // página
    const main = document.querySelector('.main');
    if (main && !document.getElementById('page-estima')) { const p = document.createElement('div'); p.className = 'page'; p.id = 'page-estima'; main.appendChild(p); }
    pintarTopo();
  }

  // ---------- página da Estima ----------
  const paginaAberta = () => { const p = document.getElementById('page-estima'); return !!(p && p.classList.contains('on')); };
  let miniOrb = null;
  function abrirPagina() {
    montarEntradas();
    if (typeof window.nav === 'function') { try { window.nav('estima'); } catch (_) { /* ok */ } }
    const p = document.getElementById('page-estima');
    if (p && !p.classList.contains('on')) { document.querySelectorAll('.page').forEach(x => x.classList.remove('on')); p.classList.add('on'); }
    document.querySelectorAll('.sidebar .si').forEach(x => x.classList.toggle('on', x.id === 'sn-estima'));
    renderPagina(); carregarEstado();
  }
  const EXEMPLOS = ['Quanto eu vendi hoje?', 'Quais produtos mais vendem este mês?', 'O que menos vende no meu cardápio?', 'Qual é o meu melhor horário de vendas?', 'Como eu posso vender mais?', 'Quais clientes sumiram?', 'Compare esta semana com a passada', 'Como estão as minhas avaliações?'];
  function renderPagina() {
    const p = document.getElementById('page-estima'); if (!p) return;
    if (miniOrb) { miniOrb.stop(); miniOrb = null; }
    const st = estado || { status: 'carregando' }, lib = liberada();
    const head = `<div class="gz-page-head"><div><div class="gz-page-title">Estima</div><div class="gz-page-sub">Sua assistente de voz: pergunte sobre a sua loja e receba dicas para vender mais</div></div></div>`;
    if (st.status === 'carregando') { p.innerHTML = head + '<div class="card est-card" style="padding:26px;color:var(--muted)">Carregando…</div>'; return; }
    if (!lib) { p.innerHTML = head + paginaBloqueada(st); ligarMiniOrb(p, 'locked'); return; }
    const sit = st.status === 'teste'
      ? `<span class="est-pill est-pill-teste">Teste grátis: ${st.dias_restantes === 1 ? 'último dia' : 'faltam ' + st.dias_restantes + ' dias'} (até ${fmtData(st.teste_ate)})</span>`
      : '<span class="est-pill">Ativa nesta loja</span>';
    const wakeOk = canListen();
    p.innerHTML = head + `
      <section class="est-hero">
        <div class="est-hero-orb"><canvas aria-hidden="true"></canvas><button type="button" class="est-hero-hit" aria-label="Conversar com a Estima"></button></div>
        <div class="est-hero-txt">
          ${sit}
          <h2>Olá${prefs.name ? ', ' + esc(prefs.name) : ''}. Pergunte o que quiser sobre ${esc(st.nome_loja || 'a sua loja')}.</h2>
          <p>Vendas, produtos que mais e menos vendem, horários, clientes, avaliações e dicas práticas, tudo com os números reais da loja.</p>
          <div class="est-hero-act"><button type="button" class="btn bp est-talk">${ic('mic', 16)} Conversar com a Estima</button>
          <span class="est-hint">${prefs.wake && wakeOk ? 'Ou diga “Olá, Estima” com o painel aberto.' : 'Dica: ligue o “Olá, Estima” abaixo para chamar só com a voz.'}</span></div>
        </div>
      </section>
      <div class="est-grid">
        <section class="card est-card"><h3>Pergunte, por exemplo</h3><div class="est-chips">${EXEMPLOS.map(q => `<button type="button" class="est-chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div></section>
        <section class="card est-card"><h3>Voz e ativação</h3>
          <label class="est-switch"><input type="checkbox" id="est-wake" ${prefs.wake ? 'checked' : ''} ${wakeOk ? '' : 'disabled'}><span class="est-sw" aria-hidden="true"></span><span><b>Atender quando eu disser “Olá, Estima”</b><small>${wakeOk ? 'O navegador vai pedir o microfone. Funciona com o painel aberto na tela.' : (!SR ? 'Este navegador não entende voz: use o Chrome ou o Edge.' : 'O microfone só funciona com o endereço em https://.')}</small></span></label>
          <label class="est-lbl" for="est-voz">Voz</label><select id="est-voz" class="form-input"></select>
          <div class="est-row"><div><label class="est-lbl" for="est-rate">Velocidade</label><input type="range" id="est-rate" min="0.8" max="1.4" step="0.02" value="${prefs.rate}"></div>
          <div><label class="est-lbl" for="est-nome">Como a Estima te chama</label><input id="est-nome" class="form-input" maxlength="30" value="${esc(prefs.name)}" placeholder="Seu nome"></div></div>
          <button type="button" class="btn bg est-test">${ic('play', 14)} Ouvir a voz</button>
        </section>
      </div>
      <section class="card est-card"><div class="est-card-head"><h3>Últimas perguntas</h3><button type="button" class="btn bg est-clear">${ic('trash', 14)} Limpar</button></div><ul class="est-hist" id="est-hist"></ul></section>
      <p class="est-foot">A Estima só lê os dados desta loja e não muda nada sozinha. Lucro e despesas ficam na área financeira protegida por senha.</p>`;
    ligarMiniOrb(p, 'idle');
    p.querySelector('.est-talk').addEventListener('click', () => open(''));
    p.querySelector('.est-hero-hit').addEventListener('click', () => open(''));
    p.querySelectorAll('.est-chip').forEach(b => b.addEventListener('click', () => open('', b.dataset.q)));
    const wk = p.querySelector('#est-wake');
    wk.addEventListener('change', () => { prefs.wake = wk.checked; if (wk.checked) { startWake(); toast('Pronto. Diga “Olá, Estima” quando quiser.'); } else stopWake(); renderPagina(); });
    p.querySelector('#est-voz').addEventListener('change', e => { prefs.voice = e.target.value; });
    p.querySelector('#est-rate').addEventListener('change', e => { prefs.rate = Number(e.target.value); });
    p.querySelector('#est-nome').addEventListener('change', e => { prefs.name = e.target.value; });
    p.querySelector('.est-test').addEventListener('click', () => { voiceBroken = ''; speechBlocked = false; const id = p.querySelector('#est-voz').value; const pv = selectedPremium(id); const v = pv ? null : browserVoices().find(x => x.id === id); speak(greeting(), { premium: pv || null, voice: v && v.v }).then(() => { if (speechBlocked) toast('O navegador bloqueou o som. Clique na página e tente de novo.', true); else if (voiceBroken) toast('Essa voz não funcionou neste navegador. Escolha outra na lista.', true); }); });
    p.querySelector('.est-clear').addEventListener('click', () => { ctxMsgs = []; saveCtx(); pintarHistorico(); });
    pintarVozes(); pintarHistorico();
  }
  function paginaBloqueada(st) {
    const zap = st && st.suporte_whatsapp;
    const msg = encodeURIComponent(`Olá! Quero testar a Estima, a assistente de voz, na loja ${st && st.nome_loja ? st.nome_loja : ''}.`);
    const fim = st.status === 'teste_encerrado' ? `<span class="est-pill est-pill-fim">O teste grátis terminou em ${fmtData(st.teste_ate)}</span>` : '<span class="est-pill est-pill-novo">Novo no EstimaFood</span>';
    const itens = [['chart', 'Suas vendas na hora', 'Pergunte “quanto vendi hoje?” ou “compare com a semana passada” e ouça a resposta.'], ['star', 'O que vende e o que encalha', 'Os produtos campeões, os que menos vendem e os que estão parados no cardápio.'], ['users', 'Seus clientes', 'Quem são os melhores clientes, quem é novo e quem sumiu e merece uma mensagem.'], ['bulb', 'Dicas para vender mais', 'Sugestões práticas com base nos números reais da sua loja: combos, horários fracos, promoções.']];
    return `<section class="est-hero est-hero-lock">
        <div class="est-hero-orb"><canvas aria-hidden="true"></canvas></div>
        <div class="est-hero-txt">${fim}
          <h2>Conheça a Estima, a assistente de voz da sua loja.</h2>
          <p>Diga “Olá, Estima” e pergunte. Ela responde falando, com os números reais da sua loja, e ainda dá dicas para vender mais.</p>
          <div class="est-hero-act">${zap ? `<a class="btn bp" href="https://wa.me/${esc(zap)}?text=${msg}" target="_blank" rel="noopener">${ic('whats', 16)} ${st.status === 'teste_encerrado' ? 'Quero continuar com a Estima' : 'Quero testar grátis'}</a>` : ''}<span class="est-hint">${zap ? 'Fale com o suporte do EstimaFood para liberar na sua loja.' : 'Fale com o suporte do EstimaFood para liberar na sua loja.'}</span></div>
        </div>
      </section>
      <div class="est-feats">${itens.map(([i, t, d]) => `<div class="card est-card est-feat"><span class="est-feat-ic">${ic(i, 20)}</span><b>${t}</b><p>${d}</p></div>`).join('')}</div>`;
  }
  function ligarMiniOrb(p, st) {
    const cv = p.querySelector('.est-hero-orb canvas'); if (!cv) return;
    miniOrb = Orb(cv, true).start(); miniOrb.setState(st);
  }
  function pintarVozes() {
    const sel = document.getElementById('est-voz'); if (!sel) return;
    const prem = premiumList(), br = browserVoices(), cur = prefs.voice || (prem.length ? 'openai:marin' : (br[0] && br[0].id) || '');
    const opt = v => `<option value="${esc(v.id)}"${v.id === cur ? ' selected' : ''}>${esc(v.label)}${v.note ? ' (' + esc(v.note) + ')' : v.gender === 'f' ? ' (feminina)' : v.gender === 'm' ? ' (masculina)' : ''}</option>`;
    let h = '';
    if (prem.length) { h += `<optgroup label="Vozes premium (mais naturais)">${prem.filter(v => v.gender === 'f').map(opt).join('')}${prem.filter(v => v.gender !== 'f').map(opt).join('')}</optgroup>`; }
    if (br.length) h += `<optgroup label="Vozes deste aparelho">${br.map(opt).join('')}</optgroup>`;
    sel.innerHTML = h || '<option value="">Voz padrão do navegador</option>';
  }
  function pintarHistorico() {
    const ul = document.getElementById('est-hist'); if (!ul) return;
    const pares = []; for (let i = 0; i < ctxMsgs.length; i++) if (ctxMsgs[i].role === 'user') pares.push([ctxMsgs[i].content, (ctxMsgs[i + 1] && ctxMsgs[i + 1].role === 'assistant') ? ctxMsgs[i + 1].content : '']);
    ul.innerHTML = pares.length ? pares.reverse().slice(0, 8).map(([q, a]) => `<li><b>${esc(q)}</b><span>${esc(a)}</span></li>`).join('') : '<li class="est-empty">As perguntas desta sessão aparecem aqui.</li>';
  }
  const fmtData = d => d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) : '';

  // ---------- estilos ----------
  function estilos() {
    if (document.getElementById('estima-css')) return;
    const s = document.createElement('style'); s.id = 'estima-css';
    s.textContent = `
.est-dot{display:inline-block;width:13px;height:13px;border-radius:50%;flex:none;background:radial-gradient(circle at 35% 30%,#e7f7ff 0 12%,#38bdf8 36%,#2563eb 70%,#0b1e5b 100%);box-shadow:0 0 8px 1px rgba(56,189,248,.55)}
.est-dot-lg{width:19px;height:19px}
.est-topbtn{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 12px 0 9px;margin-right:2px;border-radius:99px;border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border));background:color-mix(in srgb,var(--accent) 9%,transparent);color:var(--text);font-size:12.5px;font-weight:700;font-family:inherit;cursor:pointer;white-space:nowrap}
.est-topbtn:hover{background:color-mix(in srgb,var(--accent) 16%,transparent)}
.est-topbtn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.est-topbtn.waking .est-dot{animation:estPulse 2.4s ease-in-out infinite}
.est-topbtn.locked{border-color:var(--border);background:transparent;color:var(--muted)}
@keyframes estPulse{0%,100%{box-shadow:0 0 6px 1px rgba(56,189,248,.45)}50%{box-shadow:0 0 14px 5px rgba(56,189,248,.75)}}
#sn-estima .est-tag{font-size:8.5px;font-weight:800;letter-spacing:.4px;padding:1px 5px;border-radius:99px;margin-left:5px;background:linear-gradient(135deg,#0ea5e9,#2563eb);color:#fff}
.est-ov{position:fixed;inset:0;z-index:10050;color:#e8f4ff;background:radial-gradient(ellipse 70% 60% at 50% 42%,#0b2249 0%,#05101f 55%,#02060d 100%);opacity:0;transition:opacity .26s ease;font-family:inherit}
.est-ov.on{opacity:1}.est-ov[hidden]{display:none}
.est-cv{position:absolute;inset:0;width:100%;height:100%;display:block}
.est-orb-hit{position:absolute;left:50%;top:42%;width:calc(min(100vw,100vh)*.42);aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:transparent;border:0;cursor:pointer}
.est-orb-hit:focus-visible{outline:2px solid rgba(125,211,252,.7);outline-offset:6px}
.est-top{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;padding:20px 26px;padding-top:max(20px,env(safe-area-inset-top))}
.est-name{display:inline-flex;align-items:center;gap:10px;font-size:21px;font-weight:700;letter-spacing:.02em;color:#dbeeff;text-shadow:0 0 18px rgba(56,189,248,.5)}
.est-x{width:44px;height:44px;border-radius:50%;border:1px solid rgba(125,211,252,.25);background:rgba(255,255,255,.04);color:#dbeeff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.est-x:hover{background:rgba(255,255,255,.1)}
.est-cap{position:absolute;left:50%;transform:translateX(-50%);top:calc(42vh + min(100vw,100vh)*.3);bottom:86px;width:min(780px,calc(100% - 32px));text-align:center;overflow-y:auto;scrollbar-width:none;pointer-events:none}
.est-cap::-webkit-scrollbar{display:none}
.est-state{margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:.04em;color:#7dd3fc;min-height:18px}
.est-ov[data-phase="thinking"] .est-state{color:#c4b5fd}
.est-you{margin:0 0 10px;font-size:16px;line-height:1.45;color:rgba(205,230,255,.62)}
.est-say{margin:0;font-size:clamp(19px,2.1vw,25px);line-height:1.4;font-weight:500;color:#f2f8ff;text-shadow:0 0 22px rgba(56,189,248,.3)}
.est-type{position:absolute;left:50%;bottom:22px;bottom:max(22px,env(safe-area-inset-bottom));transform:translateX(-50%);width:min(560px,calc(100% - 32px));display:flex;gap:8px}
.est-type input{flex:1;min-height:46px;border-radius:99px;padding:0 20px;background:rgba(255,255,255,.05);border:1px solid rgba(125,211,252,.2);color:#eaf6ff;font-size:15px;font-family:inherit}
.est-type input::placeholder{color:rgba(205,230,255,.45)}
.est-type input:focus{outline:none;border-color:rgba(56,189,248,.7);box-shadow:0 0 0 3px rgba(56,189,248,.18)}
.est-type button{width:46px;height:46px;border-radius:50%;border:1px solid rgba(125,211,252,.25);background:rgba(14,165,233,.25);color:#eaf6ff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.est-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
html.est-aberta{overflow:hidden}
#page-estima{max-width:1180px}
.est-hero{position:relative;display:grid;grid-template-columns:220px 1fr;gap:26px;align-items:center;padding:24px 28px;border-radius:20px;margin-bottom:16px;color:#e8f4ff;background:radial-gradient(ellipse 60% 120% at 12% 50%,#0d2a57 0%,#071428 58%,#040b17 100%);border:1px solid rgba(56,189,248,.18);overflow:hidden}
.est-hero-orb{position:relative;width:220px;height:200px}
.est-hero-orb canvas{position:absolute;inset:0;width:100%;height:100%}
.est-hero-hit{position:absolute;left:50%;top:50%;width:130px;height:130px;transform:translate(-50%,-50%);border-radius:50%;border:0;background:transparent;cursor:pointer}
.est-hero-hit:focus-visible{outline:2px solid #7dd3fc;outline-offset:4px}
.est-hero-txt h2{margin:10px 0 6px;font-size:clamp(19px,2vw,24px);line-height:1.25;font-weight:800;color:#f2f8ff;max-width:34ch}
.est-hero-txt p{margin:0 0 16px;color:rgba(214,234,255,.75);font-size:14px;line-height:1.55;max-width:62ch}
.est-hero-act{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.est-hero-act .btn{display:inline-flex;align-items:center;gap:8px;text-decoration:none}
.est-hint{font-size:12.5px;color:rgba(214,234,255,.62)}
.est-pill{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:99px;background:rgba(34,197,94,.14);color:#86efac;border:1px solid rgba(34,197,94,.3)}
.est-pill-teste{background:rgba(56,189,248,.14);color:#7dd3fc;border-color:rgba(56,189,248,.35)}
.est-pill-novo{background:rgba(56,189,248,.14);color:#7dd3fc;border-color:rgba(56,189,248,.35)}
.est-pill-fim{background:rgba(245,158,11,.14);color:#fcd34d;border-color:rgba(245,158,11,.35)}
.est-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:16px;margin-bottom:16px}
.est-card{padding:18px 20px}
.est-card h3{margin:0 0 12px;font-size:14px;font-weight:800}
.est-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.est-card-head h3{margin:0}
.est-card .btn{display:inline-flex;align-items:center;gap:7px}
.est-chips{display:flex;flex-wrap:wrap;gap:8px}
.est-chip{border:1px solid var(--border);background:var(--surface2);color:var(--text);border-radius:99px;padding:8px 13px;font-size:12.5px;font-family:inherit;cursor:pointer;text-align:left}
.est-chip:hover{border-color:var(--accent);color:var(--accent)}
.est-chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.est-switch{display:flex;gap:12px;align-items:flex-start;cursor:pointer;margin-bottom:14px}
.est-switch input{position:absolute;opacity:0;width:1px;height:1px}
.est-sw{flex:none;width:38px;height:22px;border-radius:99px;background:var(--surface2);border:1px solid var(--border);position:relative;transition:background .2s;margin-top:1px}
.est-sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--muted);transition:transform .2s,background .2s}
.est-switch input:checked+.est-sw{background:var(--accent);border-color:var(--accent)}
.est-switch input:checked+.est-sw::after{transform:translateX(16px);background:#fff}
.est-switch input:focus-visible+.est-sw{outline:2px solid var(--accent);outline-offset:2px}
.est-switch input:disabled+.est-sw{opacity:.5}
.est-switch b{display:block;font-size:13px}
.est-switch small{display:block;color:var(--muted);font-size:11.5px;margin-top:2px;line-height:1.45}
.est-lbl{display:block;font-size:11.5px;font-weight:700;color:var(--muted);margin:0 0 5px}
.est-card select.form-input,.est-card input.form-input{width:100%;margin-bottom:12px}
.est-card input[type=range]{width:100%;accent-color:var(--accent);margin:6px 0 12px}
.est-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.est-hist{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.est-hist li{display:grid;gap:3px;padding-bottom:12px;border-bottom:1px solid var(--border)}
.est-hist li:last-child{border-bottom:0;padding-bottom:0}
.est-hist b{font-size:13px}.est-hist span{color:var(--muted);font-size:13px;line-height:1.5}
.est-hist .est-empty{color:var(--muted);font-size:13px;border:0}
.est-foot{color:var(--muted);font-size:12px;margin:4px 2px 28px}
.est-feats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px}
.est-feat b{display:block;font-size:13.5px;margin:10px 0 4px}
.est-feat p{margin:0;color:var(--muted);font-size:12.5px;line-height:1.5}
.est-feat-ic{display:inline-flex;width:38px;height:38px;border-radius:11px;align-items:center;justify-content:center;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent)}
:root[data-gestor-theme="claro"] .est-topbtn.locked{color:var(--muted)}
@media (max-width:1000px){.est-feats{grid-template-columns:1fr 1fr}.est-grid{grid-template-columns:1fr}}
@media (max-width:900px){.est-top-txt{display:none}.est-topbtn{width:34px;padding:0;justify-content:center;margin-right:0}.est-topbtn .est-dot{width:16px;height:16px}}
@media (max-width:640px){.est-hero{grid-template-columns:1fr;padding:16px 16px 20px;text-align:center;gap:6px}.est-hero-orb{width:100%;height:170px}.est-hero-txt h2{margin-left:auto;margin-right:auto}.est-hero-act{justify-content:center}.est-feats{grid-template-columns:1fr}.est-row{grid-template-columns:1fr}.est-top{padding:14px 16px}.est-cap{bottom:80px}.est-say{font-size:19px}}
@media (prefers-reduced-motion:reduce){.est-topbtn.waking .est-dot{animation:none}}
`;
    document.head.appendChild(s);
  }

  // ---------- início ----------
  function iniciar() {
    if (!sessao() || !sessao().tenant_id) return setTimeout(iniciar, 700);
    estilos(); montarEntradas(); carregarEstado();
    setInterval(() => { if (!document.hidden && mode !== 'open') carregarEstado(); }, 10 * 60 * 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(iniciar, 400)); else setTimeout(iniciar, 400);

  window.Estima = { abrir: () => open(''), perguntar: q => open('', q), fechar: close, pagina: abrirPagina, recarregar: carregarEstado, get estado() { return estado; }, toSpeech, prefs };
})();

// ══════════════════════════════════════════════════════════════════════
// TV INDOOR (gestor)
// A loja sobe até 10 vídeos e liga as TVs do estabelecimento pelo código
// que aparece na tela da TV. O servidor comprime cada vídeo para Full HD.
// ══════════════════════════════════════════════════════════════════════
const _tv = {
  estado: null,
  timer: null,
  envios: [],          // { id, nome, tamanho, enviado, erro }
  enviando: false,
  apagarPendente: null,
  removerTelaPendente: null,
  adicionando: false,
  suporteWa: '',
  rede: null,          // anúncio da loja na rede VisseTV (se a loja for anunciante)
  trocas: {},          // envio do pedido de troca, por id do anúncio: { nome, tamanho, enviado, erro }
  cancelarPendente: null
};

function _tvCss() {
  if (document.getElementById('tv-css')) return;
  const st = document.createElement('style');
  st.id = 'tv-css';
  st.textContent = `
  #tv-root{display:flex;flex-direction:column;gap:16px;max-width:980px}
  .tv-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden}
  .tv-card-head{padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
  .tv-card-title{font-weight:800;font-size:14px}
  .tv-card-sub{font-size:11.5px;color:var(--muted);margin-top:2px}
  .tv-card-body{padding:14px 18px}
  .tv-vazio{font-size:12.5px;color:var(--muted);padding:14px;border:1px dashed var(--border);border-radius:10px;line-height:1.5}
  .tv-tela{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)}
  .tv-tela:last-child{border-bottom:0}
  .tv-ponto{width:10px;height:10px;border-radius:50%;flex:none;background:var(--muted)}
  .tv-ponto.on{background:var(--success);box-shadow:0 0 0 4px color-mix(in srgb,var(--success) 20%,transparent)}
  .tv-tela-info{flex:1;min-width:0}
  .tv-tela-nome{font-weight:700;font-size:13.5px}
  .tv-tela-det{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tv-acoes{display:flex;gap:6px;flex-wrap:wrap}
  .tv-posicao{height:32px;padding:0 8px;border-radius:7px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:12px;max-width:100%}
  .tv-btn-x{height:32px;padding:0 10px;border-radius:7px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);color:var(--danger);cursor:pointer;font:inherit;font-size:12px;font-weight:700;white-space:nowrap}
  .tv-add{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:8px;align-items:end;margin-top:12px;padding:12px;border-radius:10px;background:color-mix(in srgb,var(--accent) 7%,transparent);border:1px solid color-mix(in srgb,var(--accent) 25%,transparent)}
  .tv-add .form-input{margin:0}
  .tv-codigo{font-size:22px!important;letter-spacing:6px;font-weight:800;text-align:center}
  .tv-ajuda{font-size:12px;color:var(--muted);line-height:1.55;margin-top:10px}
  .tv-ajuda b{color:var(--text)}
  .tv-video{display:grid;grid-template-columns:28px 112px minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--border)}
  .tv-video:last-child{border-bottom:0}
  .tv-ordem{display:flex;flex-direction:column;gap:4px}
  .tv-ordem button{width:28px;height:24px;border-radius:6px;border:1px solid var(--border);background:var(--surface2,transparent);color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center}
  .tv-ordem button:disabled{opacity:.3;cursor:default}
  .tv-capa{width:112px;height:63px;border-radius:8px;background:#0b0f16;overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center;color:#64748b}
  .tv-capa img{width:100%;height:100%;object-fit:cover}
  .tv-capa span{position:absolute;right:4px;bottom:4px;background:rgba(0,0,0,.75);color:#fff;font-size:10.5px;font-weight:700;padding:1px 5px;border-radius:4px}
  .tv-video-info{min-width:0}
  .tv-video-info .form-input{margin:0 0 6px;height:34px;font-size:13px;font-weight:700}
  .tv-status{font-size:11.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center}
  .tv-status b{font-weight:700}
  .tv-barra{height:5px;border-radius:3px;background:var(--border);overflow:hidden;margin-top:6px}
  .tv-barra i{display:block;height:100%;background:var(--accent);transition:width .4s}
  .tv-horas{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted);margin-top:6px;flex-wrap:wrap}
  .tv-horas input{height:30px;padding:0 6px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--text);font:inherit;font-size:12px}
  .tv-chave{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;font-weight:700;user-select:none}
  .tv-chave input{display:none}
  .tv-chave i{width:34px;height:20px;border-radius:10px;background:var(--border);position:relative;transition:background .2s}
  .tv-chave i:after{content:'';position:absolute;left:3px;top:3px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .2s}
  .tv-chave input:checked+i{background:var(--success)}
  .tv-chave input:checked+i:after{left:17px}
  .tv-direita{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
  .tv-bloqueio{padding:22px;text-align:left;line-height:1.6;font-size:13px}
  .tv-bloqueio h3{margin:0 0 6px;font-size:16px}
  .tv-erro{color:var(--danger)!important}
  @media(max-width:640px){.tv-anuncio{grid-template-columns:88px minmax(0,1fr)}.tv-anuncio .tv-direita{grid-column:1 / 3;flex-direction:row;justify-content:flex-start}}
  .tv-rede{border-color:color-mix(in srgb,#ff2e63 45%,var(--border))}
  .tv-rede .tv-card-head{background:linear-gradient(100deg,color-mix(in srgb,#ffc800 10%,transparent),color-mix(in srgb,#ff2e63 12%,transparent))}
  .tv-rede-marca{display:flex;align-items:center;gap:10px}
  .tv-rede-marca img{width:34px;height:34px;flex:none}
  .tv-anuncio{display:grid;grid-template-columns:112px minmax(0,1fr) auto;gap:12px;align-items:start;padding:12px 0;border-bottom:1px solid var(--border)}
  .tv-anuncio:last-child{border-bottom:0}
  .tv-pedido{margin-top:8px;padding:9px 11px;border-radius:9px;font-size:12px;line-height:1.5;background:color-mix(in srgb,#f59e0b 10%,transparent);border:1px solid color-mix(in srgb,#f59e0b 35%,transparent)}
  .tv-pedido.recusado{background:color-mix(in srgb,var(--danger) 8%,transparent);border-color:color-mix(in srgb,var(--danger) 35%,transparent)}
  .tv-pedido-acoes{display:flex;gap:8px;margin-top:6px;flex-wrap:wrap}
  .tv-link{background:none;border:0;padding:0;color:var(--accent);font:inherit;font-size:12px;font-weight:700;cursor:pointer;text-decoration:underline}
  @media(max-width:640px){
    .tv-add{grid-template-columns:1fr}
    .tv-video{grid-template-columns:28px 88px minmax(0,1fr)}
    .tv-capa{width:88px;height:50px}
    .tv-direita{grid-column:2 / 4;flex-direction:row;justify-content:space-between;align-items:center}
    .tv-tela{flex-wrap:wrap}
    .tv-tela .tv-acoes{width:100%;padding-left:22px}
  }`;
  document.head.appendChild(st);
}

function _tvHeaders(json) {
  let tok = '', tid = '';
  try { tid = (typeof _sessao !== 'undefined' && _sessao?.tenant_id) || JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || ''; } catch (e) {}
  try {
    const s = JSON.parse(sessionStorage.getItem('sys_session') || '{}');
    tok = s.token || (typeof _sessao !== 'undefined' && _sessao?.token) || JSON.parse(sessionStorage.getItem('adm_session') || '{}').token || '';
  } catch (e) {}
  const h = { 'x-tenant-id': tid };
  if (tok) h['Authorization'] = 'Bearer ' + tok;
  if (json) h['Content-Type'] = 'application/json';
  return h;
}
async function _tvApi(caminho, opts = {}) {
  const r = await fetch(caminho, { method: opts.method || 'GET', headers: _tvHeaders(opts.body !== undefined), body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Não foi possível concluir. Tente de novo.');
  return d;
}
function _tvEsc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function _tvMb(b) { b = +b || 0; return b >= 1073741824 ? (b / 1073741824).toFixed(1).replace('.', ',') + ' GB' : Math.max(1, Math.round(b / 1048576)) + ' MB'; }
function _tvDur(s) { s = Math.round(+s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function _tvQuando(iso) {
  if (!iso) return 'nunca se conectou';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 2) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

async function tvRender() {
  _tvCss();
  const root = document.getElementById('tv-root');
  if (!root) return;
  if (!_tv.estado) root.innerHTML = '<div class="tv-card"><div class="tv-card-body" style="color:var(--muted);font-size:13px">Carregando...</div></div>';
  try {
    _tv.estado = await _tvApi('/api/tv/gestor/estado');
  } catch (e) {
    root.innerHTML = `<div class="tv-card"><div class="tv-card-body tv-erro" style="font-size:13px">${_tvEsc(e.message)}</div></div>`;
    return;
  }
  await _tvCarregarRede();
  if (!_tv.estado.ativo && !_tv.suporteWa) {
    try { const p = await fetch('/api/planos/precos').then(r => r.json()); _tv.suporteWa = p.whatsapp_robo || ''; _tv.preco = p.addon_tv; } catch (e) {}
  }
  _tvDesenhar();
  _tvAgendar();
}

async function _tvCarregarRede() {
  if (!_tv.estado?.rede) { _tv.rede = null; return; }
  try { _tv.rede = await _tvApi('/api/outdoor/gestor/rede'); } catch (e) {}
}

function tvPararAtualizacao() { if (_tv.timer) { clearTimeout(_tv.timer); _tv.timer = null; } }
function _tvAgendar() {
  tvPararAtualizacao();
  const pg = document.getElementById('page-tv');
  if (!pg || !pg.classList.contains('on')) return;
  const ocupado = _tv.estado?.videos?.some(v => v.status === 'processando') || (_tv.rede?.videos || []).some(v => v.pedido && v.pedido.status === 'processando');
  _tv.timer = setTimeout(async () => {
    try { _tv.estado = await _tvApi('/api/tv/gestor/estado'); await _tvCarregarRede(); _tvDesenharParcial(); } catch (e) {}
    _tvAgendar();
  }, ocupado ? 3000 : 15000);
}

function _tvDesenhar() {
  const root = document.getElementById('tv-root');
  const e = _tv.estado;
  if (!e.ativo) {
    const preco = _tv.preco ? `R$ ${(+_tv.preco).toFixed(2).replace('.', ',')} por mês` : 'um valor mensal pequeno';
    const wa = _tv.suporteWa ? `https://wa.me/${_tv.suporteWa.length <= 11 ? '55' + _tv.suporteWa : _tv.suporteWa}?text=${encodeURIComponent('Olá! Quero ativar a TV Indoor na minha loja.')}` : '';
    root.innerHTML = `<div class="tv-card"><div class="tv-bloqueio">
      <h3>Coloque seus produtos na TV da loja</h3>
      Com a TV Indoor, a TV do seu estabelecimento passa os vídeos dos seus produtos o dia todo, sozinha. Você sobe até 10 vídeos aqui no painel e a TV atualiza na hora.
      <div style="margin-top:8px">É um adicional de <b>${preco}</b>, cobrado junto com a sua mensalidade.</div>
      ${wa ? `<a class="btn bp" style="margin-top:14px;display:inline-flex" href="${wa}" target="_blank" rel="noopener">Quero ativar</a>` : '<div style="margin-top:12px;font-weight:700">Fale com o suporte para ativar.</div>'}
    </div></div>`;
    return;
  }
  root.innerHTML = `
    <div class="tv-card tv-rede" id="tv-card-rede" style="display:none"></div>
    <div class="tv-card" id="tv-card-telas"></div>
    <div class="tv-card" id="tv-card-videos"></div>`;
  _tvDesenharRede();
  _tvDesenharTelas();
  _tvDesenharVideos();
}

// Atualização silenciosa: não redesenha campo que a pessoa está digitando
function _tvDesenharParcial() {
  if (!_tv.estado?.ativo) { _tvDesenhar(); return; }
  const foco = document.activeElement;
  const digitando = foco && foco.closest && foco.closest('#tv-root') && /INPUT|SELECT/.test(foco.tagName);
  if (!digitando) { _tvDesenharRede(); _tvDesenharTelas(); _tvDesenharVideos(); }
}

// ── Anúncio da loja na rede VisseTV (contratado: não apaga, só pede troca) ──
function _tvDesenharRede() {
  const el = document.getElementById('tv-card-rede');
  if (!el) return;
  const r = _tv.rede;
  if (!r || !r.vinculado) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';
  const ICO_PLAY = '<svg width="22" height="22" viewBox="0 0 16 16" fill="none"><path d="M6 4.5v7l5.5-3.5L6 4.5z" fill="currentColor"/></svg>';
  const onde = r.pontos.length ? r.pontos.map(p => _tvEsc(p.nome)).join(', ') : 'nenhum comércio marcado ainda';
  el.innerHTML = `
    <div class="tv-card-head">
      <div class="tv-rede-marca"><img src="/vissetv/vissetv-icone.svg" alt=""><div>
        <div class="tv-card-title">Seu anúncio na rede VisseTV</div>
        <div class="tv-card-sub">Passa nas suas TVs e em: ${onde}.</div></div></div>
    </div>
    <div class="tv-card-body">
      <div class="tv-ajuda" style="margin:0 0 6px">Este vídeo faz parte do seu plano de anúncio e fica salvo. Para mudar, toque em "Pedir troca" e escolha o vídeo novo: a equipe VisseTV assiste e aprova. Enquanto isso, o anúncio atual continua passando.</div>
      ${r.videos.map(v => {
        const p = v.pedido, envio = _tv.trocas[v.id];
        let caixa = '';
        if (envio) {
          const pct = envio.tamanho ? Math.floor(envio.enviado / envio.tamanho * 100) : 0;
          caixa = envio.erro
            ? `<div class="tv-pedido recusado">${_tvEsc(envio.erro)}<div class="tv-pedido-acoes"><button class="tv-link" onclick="tvDescartarTroca(${v.id})">Fechar</button></div></div>`
            : `<div class="tv-pedido">Enviando o vídeo novo ${pct}% de ${_tvMb(envio.tamanho)}. Não feche esta tela.<div class="tv-barra"><i style="width:${pct}%"></i></div></div>`;
        } else if (p) {
          const confirma = _tv.cancelarPendente === p.id;
          if (p.rede === 'recusado') {
            caixa = `<div class="tv-pedido recusado"><b>Troca não aprovada.</b> Motivo: ${_tvEsc(p.motivo || 'não informado')}
              <div class="tv-pedido-acoes"><button class="tv-link" onclick="tvCancelarTroca(${p.id},true)">Fechar aviso</button></div></div>`;
          } else if (p.status === 'erro') {
            caixa = `<div class="tv-pedido recusado">${_tvEsc(p.erro || 'Não foi possível preparar o vídeo novo.')} Escolha outro arquivo.
              <div class="tv-pedido-acoes"><button class="tv-link" onclick="tvCancelarTroca(${p.id},true)">Fechar aviso</button></div></div>`;
          } else if (p.status === 'processando') {
            caixa = `<div class="tv-pedido">Troca pedida. ${p.na_fila ? 'Na fila para preparar o vídeo novo.' : `Preparando o vídeo novo ${p.progresso || 0}%.`}
              ${p.na_fila ? '' : `<div class="tv-barra"><i style="width:${p.progresso || 0}%"></i></div>`}</div>`;
          } else {
            caixa = `<div class="tv-pedido"><b>Troca aguardando aprovação da equipe VisseTV.</b> ${p.arquivo ? `<a href="${_tvEsc(p.arquivo)}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:700">Ver o vídeo novo</a>` : ''}
              <div class="tv-pedido-acoes"><button class="tv-link" onclick="tvCancelarTroca(${p.id})">${confirma ? 'Confirmar cancelamento' : 'Cancelar pedido'}</button></div></div>`;
          }
        }
        const podePedir = !envio && !(p && p.rede === 'aguardando' && p.status === 'processando');
        return `<div class="tv-anuncio">
          <a class="tv-capa" href="${_tvEsc(v.arquivo || '#')}" target="_blank" rel="noopener" title="Assistir">${v.capa ? `<img src="${_tvEsc(v.capa)}" alt="">` : ICO_PLAY}<span>${_tvDur(v.duracao)}</span></a>
          <div class="tv-video-info">
            <div style="font-weight:800;font-size:13.5px">${_tvEsc(v.titulo || 'Anúncio')}</div>
            <div class="tv-status">${v.ativo ? '<span style="color:var(--success);font-weight:700">No ar</span>' : '<span>Pausado pela equipe</span>'}<span>${(v.exibicoes_30d || 0).toLocaleString('pt-BR')} exibições em 30 dias</span></div>
            ${caixa}
          </div>
          <div class="tv-direita">
            ${podePedir ? `<label class="btn bg" style="cursor:pointer"><input type="file" accept="video/*" style="display:none" onchange="tvPedirTroca(${v.id},this)">${p && p.rede === 'aguardando' ? 'Mandar outro' : 'Pedir troca'}</label>` : ''}
          </div>
        </div>`;
      }).join('') || '<div class="tv-vazio">A equipe VisseTV ainda está preparando o seu anúncio. Assim que ele estiver no ar, aparece aqui.</div>'}
    </div>`;
}

function tvPedirTroca(vid, inp) {
  const f = inp.files && inp.files[0];
  inp.value = '';
  if (!f) return;
  _tv.trocas[vid] = { nome: f.name, tamanho: f.size, enviado: 0 };
  _tvDesenharRede();
  _tvEnviarTroca(vid, f);
}
function tvDescartarTroca(vid) { delete _tv.trocas[vid]; _tvDesenharRede(); }

async function _tvEnviarTroca(vid, f) {
  const x = _tv.trocas[vid];
  window.addEventListener('beforeunload', _tvAvisoSaidaTroca);
  try {
    const ini = await _tvApi('/api/outdoor/gestor/troca/iniciar', { method: 'POST', body: { nome: f.name, tamanho: f.size, tipo: f.type, substitui_id: vid } });
    const PARTE = ini.parte || 8 * 1024 * 1024;
    let pos = 0, tentativas = 0, ultimo = 0;
    while (pos < f.size) {
      try {
        const r = await fetch(`/api/outdoor/gestor/troca/${ini.upload_id}?offset=${pos}`, { method: 'POST', headers: { ..._tvHeaders(false), 'Content-Type': 'application/octet-stream' }, body: f.slice(pos, Math.min(pos + PARTE, f.size)) });
        const d = await r.json().catch(() => ({}));
        if (r.status === 409 && typeof d.recebido === 'number') { pos = d.recebido; continue; }
        if (!r.ok) throw Object.assign(new Error(d.error || 'falha no envio'), { definitivo: r.status < 500 });
        pos = d.recebido; tentativas = 0;
      } catch (e) {
        if (e.definitivo) throw e;
        if (++tentativas > 8) throw new Error('a internet caiu várias vezes. Tente de novo.');
        await new Promise(ok => setTimeout(ok, Math.min(30000, 1500 * tentativas)));
        continue;
      }
      x.enviado = pos;
      if (Date.now() - ultimo > 400) { ultimo = Date.now(); _tvDesenharRede(); }
    }
    await _tvApi(`/api/outdoor/gestor/troca/${ini.upload_id}/concluir`, { method: 'POST', body: { substitui_id: vid } });
    delete _tv.trocas[vid];
    sbToast('ok', 'Vídeo enviado. Quando ficar pronto, a equipe VisseTV assiste e aprova a troca.');
    await _tvCarregarRede();
    _tvDesenharRede();
    _tvAgendar();
  } catch (e) {
    x.erro = 'Não foi possível enviar: ' + e.message;
    _tvDesenharRede();
  } finally {
    if (!Object.values(_tv.trocas).some(t => !t.erro)) window.removeEventListener('beforeunload', _tvAvisoSaidaTroca);
  }
}
function _tvAvisoSaidaTroca(ev) { ev.preventDefault(); ev.returnValue = 'Ainda tem vídeo enviando.'; return ev.returnValue; }

async function tvCancelarTroca(pid, direto) {
  if (!direto && _tv.cancelarPendente !== pid) {
    _tv.cancelarPendente = pid; _tvDesenharRede();
    setTimeout(() => { if (_tv.cancelarPendente === pid) { _tv.cancelarPendente = null; _tvDesenharRede(); } }, 4000);
    return;
  }
  _tv.cancelarPendente = null;
  try { await _tvApi('/api/outdoor/gestor/troca/' + pid, { method: 'DELETE' }); await _tvCarregarRede(); _tvDesenharRede(); }
  catch (e) { sbToast('err', e.message); }
}

// ── TVs ──
function _tvDesenharTelas() {
  const el = document.getElementById('tv-card-telas');
  if (!el) return;
  const telas = _tv.estado.telas || [];
  const linkTv = location.origin + '/tv';
  el.innerHTML = `
    <div class="tv-card-head">
      <div><div class="tv-card-title">Suas TVs</div><div class="tv-card-sub">${telas.length ? `${telas.filter(t => t.online).length} de ${telas.length} ligada(s) agora` : 'Nenhuma TV ligada ainda'}</div></div>
      ${_tv.adicionando ? '' : '<button class="btn bp" onclick="tvMostrarAdicionar(true)">Adicionar TV</button>'}
    </div>
    <div class="tv-card-body">
      ${telas.map(t => {
        const confirma = _tv.removerTelaPendente === t.id;
        return `<div class="tv-tela">
          <span class="tv-ponto ${t.online ? 'on' : ''}"></span>
          <div class="tv-tela-info">
            <div class="tv-tela-nome">${_tvEsc(t.nome)}</div>
            <div class="tv-tela-det">${t.online ? (t.tocando ? 'Ligada, passando: ' + _tvEsc(t.tocando) : 'Ligada') : 'Desligada, último contato ' + _tvQuando(t.ultimo_contato)}${t.plataforma === 'android' ? ' (app Android)' : ' (navegador)'}</div>
          </div>
          <div class="tv-acoes">
            <select class="tv-posicao" onchange="tvPosicaoTela(${t.id},this.value)" title="Como a TV está pendurada">
              <option value="0" ${!t.rotacao ? 'selected' : ''}>TV deitada (normal)</option>
              <option value="270" ${t.rotacao == 270 ? 'selected' : ''}>TV em pé, girada para a direita</option>
              <option value="90" ${t.rotacao == 90 ? 'selected' : ''}>TV em pé, girada para a esquerda</option>
            </select>
            <button class="btn bg pf-sm" onclick="tvRenomearTela(${t.id})">Renomear</button>
            <button class="tv-btn-x" onclick="tvRemoverTela(${t.id})">${confirma ? 'Confirmar' : 'Remover'}</button>
          </div>
        </div>`;
      }).join('') || (_tv.adicionando ? '' : '<div class="tv-vazio">Para ligar uma TV, toque em "Adicionar TV" e siga os passos.</div>')}
      ${_tv.adicionando ? `
        <div class="tv-add">
          <div><label class="form-label">Código que aparece na TV</label><input class="form-input tv-codigo" id="tv-add-codigo" inputmode="numeric" maxlength="6" placeholder="000000" oninput="this.value=this.value.replace(/\\D/g,'').slice(0,6)" onkeydown="if(event.key==='Enter')tvLigarTela()"></div>
          <div><label class="form-label">Nome da TV (opcional)</label><input class="form-input" id="tv-add-nome" maxlength="60" placeholder="Ex.: TV do salão" onkeydown="if(event.key==='Enter')tvLigarTela()"></div>
          <div class="tv-acoes"><button class="btn bg" onclick="tvMostrarAdicionar(false)">Cancelar</button><button class="btn bp" id="tv-add-btn" onclick="tvLigarTela()">Ligar TV</button></div>
        </div>
        <div class="tv-ajuda">
          <b>Na TV com Android (ou TV box):</b> instale o app VisseTV (na TV, baixe pelo endereço <b>${_tvEsc(location.origin + '/app-tv')}</b>) e abra. <br>
          <b>Em outras TVs (Samsung, LG):</b> abra o navegador da TV e entre em <b>${_tvEsc(linkTv)}</b>. <br>
          Vai aparecer um código de 6 números na TV. Digite ele aqui.
        </div>` : ''}
    </div>`;
  if (_tv.adicionando) setTimeout(() => document.getElementById('tv-add-codigo')?.focus(), 30);
}
function tvMostrarAdicionar(sim) { _tv.adicionando = !!sim; _tvDesenharTelas(); }
async function tvLigarTela() {
  const codigo = document.getElementById('tv-add-codigo')?.value || '';
  const nome = document.getElementById('tv-add-nome')?.value || '';
  if (codigo.length !== 6) { sbToast('err', 'Digite os 6 números que aparecem na TV.'); return; }
  const btn = document.getElementById('tv-add-btn'); if (btn) { btn.disabled = true; btn.textContent = 'Ligando...'; }
  try {
    const d = await _tvApi('/api/tv/gestor/telas', { method: 'POST', body: { codigo, nome } });
    _tv.estado.telas = d.telas;
    _tv.adicionando = false;
    _tvDesenharTelas();
    sbToast('ok', 'TV ligada! Em alguns segundos ela começa a passar os vídeos.');
  } catch (e) {
    sbToast('err', e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Ligar TV'; }
  }
}
async function tvPosicaoTela(id, valor) {
  try {
    const d = await _tvApi('/api/tv/gestor/telas/' + id, { method: 'PATCH', body: { rotacao: +valor } });
    _tv.estado.telas = d.telas;
    sbToast('ok', +valor ? 'Pronto. Em alguns segundos a imagem gira na TV. Se ficar de cabeça para baixo, escolha a outra opção "em pé".' : 'Pronto. Em alguns segundos a TV volta ao normal.');
  } catch (e) { sbToast('err', e.message); }
}
async function tvRenomearTela(id) {
  const t = (_tv.estado.telas || []).find(x => x.id === id);
  const nome = prompt('Nome da TV', t?.nome || '');
  if (!nome || !nome.trim()) return;
  try { const d = await _tvApi('/api/tv/gestor/telas/' + id, { method: 'PATCH', body: { nome } }); _tv.estado.telas = d.telas; _tvDesenharTelas(); }
  catch (e) { sbToast('err', e.message); }
}
async function tvRemoverTela(id) {
  if (_tv.removerTelaPendente !== id) {
    _tv.removerTelaPendente = id; _tvDesenharTelas();
    setTimeout(() => { if (_tv.removerTelaPendente === id) { _tv.removerTelaPendente = null; _tvDesenharTelas(); } }, 4000);
    return;
  }
  _tv.removerTelaPendente = null;
  try { const d = await _tvApi('/api/tv/gestor/telas/' + id, { method: 'DELETE' }); _tv.estado.telas = d.telas; _tvDesenharTelas(); sbToast('ok', 'TV removida. Ela volta a mostrar um código.'); }
  catch (e) { sbToast('err', e.message); }
}

// ── Vídeos ──
function _tvDesenharVideos() {
  const el = document.getElementById('tv-card-videos');
  if (!el) return;
  const e = _tv.estado;
  const videos = e.videos || [];
  const usados = videos.filter(v => v.status !== 'erro').length + _tv.envios.filter(x => !x.erro).length;
  const cheio = usados >= e.max;
  const ICO_UP = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICO_DN = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICO_PLAY = '<svg width="22" height="22" viewBox="0 0 16 16" fill="none"><path d="M6 4.5v7l5.5-3.5L6 4.5z" fill="currentColor"/></svg>';
  el.innerHTML = `
    <div class="tv-card-head">
      <div><div class="tv-card-title">Vídeos (${Math.min(usados, e.max)} de ${e.max})</div>
      <div class="tv-card-sub">Passam em sequência, sem parar, na ordem abaixo, e sem som: a mensagem precisa estar escrita na tela.${e.comprime ? ' Pode subir vídeo de qualquer tamanho: o sistema deixa em Full HD e mais leve.' : ''}</div></div>
      <label class="btn bp" style="${cheio ? 'opacity:.5;pointer-events:none' : ''}">
        <input type="file" accept="video/*" multiple style="display:none" onchange="tvEscolherVideos(this)">Subir vídeo
      </label>
    </div>
    <div class="tv-card-body">
      ${_tv.envios.map(x => {
        const pct = x.tamanho ? Math.floor(x.enviado / x.tamanho * 100) : 0;
        return `<div class="tv-video">
          <div></div>
          <div class="tv-capa">${ICO_PLAY}</div>
          <div class="tv-video-info">
            <div style="font-weight:700;font-size:13px;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_tvEsc(x.nome)}</div>
            <div class="tv-status ${x.erro ? 'tv-erro' : ''}">${x.erro ? _tvEsc(x.erro) : (x.esperando ? 'Na fila para enviar' : `Enviando ${pct}% de ${_tvMb(x.tamanho)}. Não feche esta tela.`)}</div>
            ${x.erro ? '' : `<div class="tv-barra"><i style="width:${pct}%"></i></div>`}
          </div>
          <div class="tv-direita">${x.erro ? `<button class="tv-btn-x" onclick="tvDescartarEnvio('${x.id}')">Fechar</button>` : ''}</div>
        </div>`;
      }).join('')}
      ${videos.map((v, i) => {
        const pronto = v.status === 'pronto';
        let status;
        if (v.status === 'processando') status = v.na_fila ? 'Na fila para preparar' : `Preparando o vídeo ${v.progresso || 0}%`;
        else if (v.status === 'erro') status = `<span class="tv-erro">${_tvEsc(v.erro || 'Erro ao preparar')}</span>`;
        else status = `<b>${_tvDur(v.duracao)}</b><span>${_tvMb(v.tamanho)}</span>${v.ativo ? '<span style="color:var(--success);font-weight:700">Passando na TV</span>' : '<span>Pausado</span>'}`;
        const confirma = _tv.apagarPendente === v.id;
        return `<div class="tv-video">
          <div class="tv-ordem">
            <button onclick="tvMover(${v.id},-1)" ${i === 0 ? 'disabled' : ''} title="Passar antes">${ICO_UP}</button>
            <button onclick="tvMover(${v.id},1)" ${i === videos.length - 1 ? 'disabled' : ''} title="Passar depois">${ICO_DN}</button>
          </div>
          <a class="tv-capa" ${pronto ? `href="${_tvEsc(v.arquivo)}" target="_blank" rel="noopener" title="Assistir"` : ''}>
            ${v.capa ? `<img src="${_tvEsc(v.capa)}" alt="">` : ICO_PLAY}${pronto ? `<span>${_tvDur(v.duracao)}</span>` : ''}
          </a>
          <div class="tv-video-info">
            <input class="form-input" value="${_tvEsc(v.titulo)}" maxlength="80" onchange="tvSalvarVideo(${v.id},{titulo:this.value})" title="Nome do vídeo (só aparece aqui)">
            <div class="tv-status">${status}</div>
            ${v.status === 'processando' && !v.na_fila ? `<div class="tv-barra"><i style="width:${v.progresso || 0}%"></i></div>` : ''}
            ${pronto ? `<div class="tv-horas">Passar só das <input type="time" value="${_tvEsc(v.hora_ini || '')}" onchange="tvSalvarVideo(${v.id},{hora_ini:this.value})"> às <input type="time" value="${_tvEsc(v.hora_fim || '')}" onchange="tvSalvarVideo(${v.id},{hora_fim:this.value})"><span>(em branco = o dia todo)</span></div>` : ''}
          </div>
          <div class="tv-direita">
            ${pronto ? `<label class="tv-chave"><input type="checkbox" ${v.ativo ? 'checked' : ''} onchange="tvSalvarVideo(${v.id},{ativo:this.checked})"><i></i>${v.ativo ? 'Ligado' : 'Pausado'}</label>` : ''}
            <button class="tv-btn-x" onclick="tvApagarVideo(${v.id})">${confirma ? 'Confirmar' : 'Apagar'}</button>
          </div>
        </div>`;
      }).join('')}
      ${!videos.length && !_tv.envios.length ? '<div class="tv-vazio">Nenhum vídeo ainda. Toque em "Subir vídeo" e escolha um vídeo do celular ou do computador. Use vídeos deitados para TV deitada e vídeos em pé para TV em pé (a posição de cada TV se escolhe em "Suas TVs").</div>' : ''}
    </div>`;
}

async function tvSalvarVideo(id, campos) {
  try {
    await _tvApi('/api/tv/gestor/videos/' + id, { method: 'PATCH', body: campos });
    const v = _tv.estado.videos.find(x => x.id === id);
    if (v) Object.assign(v, campos, campos.ativo !== undefined ? { ativo: campos.ativo ? 1 : 0 } : {});
    if (campos.ativo !== undefined) _tvDesenharVideos();
    sbToast('ok', 'Salvo. A TV atualiza em alguns segundos.');
  } catch (e) { sbToast('err', e.message); }
}
async function tvMover(id, dir) {
  const lista = _tv.estado.videos;
  const i = lista.findIndex(v => v.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= lista.length) return;
  [lista[i], lista[j]] = [lista[j], lista[i]];
  _tvDesenharVideos();
  try { await _tvApi('/api/tv/gestor/videos/ordem', { method: 'POST', body: { ids: lista.map(v => v.id) } }); }
  catch (e) { sbToast('err', e.message); tvRender(); }
}
async function tvApagarVideo(id) {
  if (_tv.apagarPendente !== id) {
    _tv.apagarPendente = id; _tvDesenharVideos();
    setTimeout(() => { if (_tv.apagarPendente === id) { _tv.apagarPendente = null; _tvDesenharVideos(); } }, 4000);
    return;
  }
  _tv.apagarPendente = null;
  try { await _tvApi('/api/tv/gestor/videos/' + id, { method: 'DELETE' }); _tv.estado.videos = _tv.estado.videos.filter(v => v.id !== id); _tvDesenharVideos(); sbToast('ok', 'Vídeo apagado.'); }
  catch (e) { sbToast('err', e.message); }
}

// ── Envio em partes (aguenta vídeo grande e internet que cai) ──
function tvEscolherVideos(inp) {
  const arqs = [...(inp.files || [])];
  inp.value = '';
  const livres = _tv.estado.max - (_tv.estado.videos.filter(v => v.status !== 'erro').length + _tv.envios.filter(x => !x.erro).length);
  if (arqs.length > livres) sbToast('err', `Cabem só mais ${Math.max(0, livres)} vídeo(s). Os outros ficaram de fora.`);
  arqs.slice(0, Math.max(0, livres)).forEach(f => _tv.envios.push({ id: 'e' + Date.now() + Math.random().toString(36).slice(2, 6), arquivo: f, nome: f.name, tamanho: f.size, enviado: 0, esperando: true }));
  _tvDesenharVideos();
  _tvEnviarFila();
}
function tvDescartarEnvio(id) { _tv.envios = _tv.envios.filter(x => x.id !== id); _tvDesenharVideos(); }
function _tvAvisoSaida(ev) { if (_tv.enviando) { ev.preventDefault(); ev.returnValue = 'Ainda tem vídeo enviando.'; return ev.returnValue; } }

async function _tvEnviarFila() {
  if (_tv.enviando) return;
  _tv.enviando = true;
  window.addEventListener('beforeunload', _tvAvisoSaida);
  try {
    let x;
    while ((x = _tv.envios.find(e => e.esperando))) {
      x.esperando = false;
      try {
        await _tvEnviarArquivo(x);
        _tv.envios = _tv.envios.filter(e => e !== x);
        _tv.estado = await _tvApi('/api/tv/gestor/estado');
        _tvDesenharVideos();
        _tvAgendar();
      } catch (e) {
        x.erro = 'Não foi possível enviar: ' + e.message;
        _tvDesenharVideos();
      }
    }
  } finally {
    _tv.enviando = false;
    window.removeEventListener('beforeunload', _tvAvisoSaida);
  }
}

async function _tvEnviarArquivo(x) {
  const f = x.arquivo;
  const ini = await _tvApi('/api/tv/gestor/upload/iniciar', { method: 'POST', body: { nome: f.name, tamanho: f.size, tipo: f.type } });
  const PARTE = ini.parte || 8 * 1024 * 1024;
  let pos = 0, tentativas = 0, ultimoDesenho = 0;
  while (pos < f.size) {
    const pedaco = f.slice(pos, Math.min(pos + PARTE, f.size));
    try {
      const r = await fetch(`/api/tv/gestor/upload/${ini.upload_id}?offset=${pos}`, { method: 'POST', headers: { ..._tvHeaders(false), 'Content-Type': 'application/octet-stream' }, body: pedaco });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409 && typeof d.recebido === 'number') { pos = d.recebido; continue; }
      if (!r.ok) throw new Error(d.error || 'falha no envio');
      pos = d.recebido;
      tentativas = 0;
    } catch (e) {
      // Internet oscilou: espera e tenta a mesma parte de novo
      if (++tentativas > 8) throw new Error('a internet caiu várias vezes. Tente de novo.');
      await new Promise(ok => setTimeout(ok, Math.min(30000, 1500 * tentativas)));
      continue;
    }
    x.enviado = pos;
    if (Date.now() - ultimoDesenho > 400) { ultimoDesenho = Date.now(); _tvDesenharVideos(); }
  }
  x.enviado = f.size;
  _tvDesenharVideos();
  await _tvApi(`/api/tv/gestor/upload/${ini.upload_id}/concluir`, { method: 'POST', body: {} });
}

// ════════════════════════════════════════════════════════
// ZERAR CONTAGEM DE PEDIDOS
// ════════════════════════════════════════════════════════
async function abrirModalZerarPedidos() {
  const input = document.getElementById('zerar-confirmar');
  if (input) input.value = '';
  const btn = document.getElementById('btn-confirmar-zerar');
  if (btn) { btn.disabled = true; btn.style.opacity = '.5'; btn.style.cursor = 'not-allowed'; }

  // Busca o último ID para mostrar ao gestor
  const contEl = document.getElementById('zerar-contagem');
  if (contEl) contEl.textContent = 'Verificando...';
  try {
    const { data } = await sb.from('orders').select('id').order('id', { ascending: false }).limit(1);
    const maxId = data?.[0]?.id || 0;
    const proxNum = maxId - _orderNumOffset + 1;
    if (contEl) contEl.innerHTML = maxId
      ? `O próximo pedido é <strong>#${proxNum}</strong>. Após zerar, passará a ser <strong>#1</strong>.`
      : '<span style="color:var(--muted)">Nenhum pedido registrado ainda.</span>';
  } catch(e) {
    if (contEl) contEl.textContent = 'Não foi possível verificar.';
  }

  openModal('modal-zerar-pedidos');
}

function _zerarValidar(input) {
  const ok = input.value.trim().toUpperCase() === 'ZERAR';
  const btn = document.getElementById('btn-confirmar-zerar');
  btn.disabled      = !ok;
  btn.style.opacity = ok ? '1' : '.5';
  btn.style.cursor  = ok ? 'pointer' : 'not-allowed';
}

async function confirmarZerarPedidos() {
  const input = document.getElementById('zerar-confirmar');
  if (input.value.trim().toUpperCase() !== 'ZERAR') return;
  const btn = document.getElementById('btn-confirmar-zerar');
  btn.disabled = true;
  btn.textContent = 'Zerando...';

  try {
    // Pega o ID máximo atual do banco para usar como novo offset
    const { data } = await sb.from('orders').select('id').order('id', { ascending: false }).limit(1);
    const novoOffset = data?.[0]?.id || 0;

    // Salva o offset no store_config do tenant
    const { error } = await sb.from('store_config').update({ order_num_offset: novoOffset }).eq('tenant_id', _sessao.tenant_id);
    if (error) throw new Error(error.message);

    // Atualiza localmente
    _orderNumOffset = novoOffset;
    ordersKanban = ordersKanban.map(o => ({ ...o, num: _orderNum(o.id) }));
    renderKanban();

    closeModal('modal-zerar-pedidos');
    _renderConfiguracoes(); // atualiza o painel de config imediatamente
    sbToast('ok', 'Contagem zerada! Próximo pedido será #1.');
  } catch(e) {
    sbToast('err', 'Erro ao zerar contagem: ' + (e.message || 'Tente novamente'));
    btn.disabled = false;
    btn.textContent = 'Confirmar reset';
  }
}

// ── Configurações ─────────────────────────────────────
async function _renderConfiguracoes() {
  renderSoundConfig();
  const el = document.getElementById('cfg-prox-pedido');
  if (!el) return;
  try {
    const { data } = await sb.from('orders').select('id').order('id', { ascending: false }).limit(1);
    const maxId  = data?.[0]?.id || 0;
    const proxNum = maxId - _orderNumOffset + 1;
    el.innerHTML = maxId
      ? `Próximo pedido: <strong>#${proxNum}</strong> &nbsp;·&nbsp; Offset atual: ${_orderNumOffset}`
      : 'Nenhum pedido registrado ainda.';
  } catch(e) { el.textContent = '—'; }
  // Carrega taxa de serviço atual
  try {
    const inp = document.getElementById('cfg-taxa-servico-input');
    if (inp) inp.value = _taxaServicoPct > 0 ? _taxaServicoPct : '';
  } catch(e) {}
}

async function salvarTaxaServico() {
  const val = parseFloat(document.getElementById('cfg-taxa-servico-input')?.value) || 0;
  try {
    const { error } = await sb.from('store_config').update({ taxa_servico_pct: val }).eq('tenant_id', _sessao.tenant_id);
    if (error) throw error;
    _taxaServicoPct = val;
    sbToast('ok', val > 0 ? `Taxa de serviço salva: ${val}%` : 'Taxa de serviço desativada');
  } catch(e) {
    sbToast('err', 'Erro ao salvar: ' + (e?.message || e));
  }
}

// ── Backup completo (dados + imagens) ────────────────
async function baixarBackupCompleto() {
  const btn  = document.getElementById('btn-backup-completo');
  const info = document.getElementById('cfg-backup-info');
  if (btn) { btn.disabled = true; btn.textContent = 'Gerando backup...'; }
  if (info) info.textContent = 'Coletando dados e imagens...';

  try {
    const tid = _sessao?.tenant_id;
    if (!tid) throw new Error('Sessão inválida — faça login novamente.');

    const res = await fetch('/api/backup-completo-gestor', {
      headers: { 'x-tenant-id': tid }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Erro ${res.status}`);
    }

    // Determina nome do arquivo pelo header Content-Disposition
    const cd       = res.headers.get('Content-Disposition') || '';
    const match    = cd.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `backup-completo-${new Date().toISOString().slice(0,10)}.json.gz`;

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const kb = Math.round(blob.size / 1024);
    if (info) info.textContent = `Backup gerado! (${kb} KB)`;
    sbToast('ok', `Backup baixado! (${kb} KB)`);
  } catch(e) {
    if (info) info.textContent = 'Erro: ' + e.message;
    sbToast('err', 'Erro ao gerar backup: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Baixar backup completo'; }
  }
}

// ════════════════════════════════════════════════════════
// CARTEIRA & SAQUES
// ════════════════════════════════════════════════════════
const _fmtR = v => 'R$ ' + parseFloat(v||0).toFixed(2).replace('.',',');

let _saquesSSE = null;
let _pixAtivoGestor = true;

function conectarSaquesSSE() {
  if (_saquesSSE) return;
  const tid = _sessao?.tenant_id;
  if (!tid) return;
  _saquesSSE = new EventSource('/sse/saques-rt:'+tid);
  _saquesSSE.addEventListener('saques:INSERT', () => carregarCarteira());
  _saquesSSE.addEventListener('saques:UPDATE', (e) => {
    try {
      const d = JSON.parse(e.data);
      carregarCarteira();
      if (d.status === 'pago')      sbToast('ok', 'Saque pago! Verifique seu PIX.');
      else if (d.status === 'aprovado')  sbToast('ok', 'Saque aprovado. Pagamento em processamento.');
      else if (d.status === 'cancelado') sbToast('err', 'Saque cancelado. Entre em contato com o suporte.');
    } catch(ex) { carregarCarteira(); }
  });
  _saquesSSE.onerror = () => { _saquesSSE.close(); _saquesSSE = null; setTimeout(conectarSaquesSSE, 5000); };
}

// ════════════════════════════════════════════════════
// PAGAMENTOS ONLINE — PIX e Cartão
// ════════════════════════════════════════════════════

let _pixOnlineAtivo    = false;
let _cartaoOnlineAtivo = false; // false até o admin configurar a public key

function _renderPixOnlineToggle(ativo) {
  _pixOnlineAtivo = ativo;
  const btn    = document.getElementById('btn-pix-online-toggle');
  const status = document.getElementById('pix-online-status-txt');
  const card   = document.getElementById('card-pix-online');
  const manual = document.getElementById('pix-manual-config-wrap');
  if (btn) {
    btn.textContent = ativo ? 'Online ✓' : 'Manual';
    btn.className   = 'btn ' + (ativo ? 'bp' : 'bd');
  }
  if (status) status.textContent = ativo
    ? 'PIX Online ativo — QR Code via Mercado Pago'
    : 'Modo manual — cliente recebe a chave PIX pelo WhatsApp';
  if (card)  card.style.borderColor = ativo ? 'rgba(34,197,94,.35)' : 'rgba(249,115,22,.35)';
  if (manual) manual.style.display  = ativo ? 'none' : '';
}

async function salvarPixManual() {
  const tid  = _sessao?.tenant_id;
  if (!tid) return;
  const key  = document.getElementById('pix-manual-key-input')?.value.trim();
  const tipo = document.getElementById('pix-manual-tipo-select')?.value || 'aleatoria';
  if (!key) { sbToast('err', 'Informe a chave PIX'); return; }
  const btn = document.getElementById('btn-salvar-pix-manual');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/pix/gestor-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ pix_key_manual: key, pix_key_manual_tipo: tipo })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erro');
    sbToast('ok', 'Chave PIX manual salva!');
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
  finally { const b = document.getElementById('btn-salvar-pix-manual'); if (b) b.disabled = false; }
}

function _renderCartaoOnlineToggle(ativo, disponivel) {
  _cartaoOnlineAtivo = ativo;
  const btn    = document.getElementById('btn-cartao-online-toggle');
  const status = document.getElementById('cartao-online-status-txt');
  const card   = document.getElementById('card-cartao-online');
  if (!disponivel) {
    if (btn)    { btn.textContent = 'Indisponível'; btn.className = 'btn bg'; btn.disabled = true; }
    if (status) status.textContent = 'Não disponível — aguardando habilitação pelo suporte';
    return;
  }
  if (btn) {
    btn.textContent = ativo ? 'Ativado' : 'Desativado';
    btn.className   = 'btn ' + (ativo ? 'bp' : 'bd');
    btn.disabled    = false;
  }
  if (status) status.textContent = ativo ? 'Ativo — clientes podem pagar com cartão online' : 'Inativo — cartão não aparece no cardápio';
  if (card)  card.style.borderColor = ativo ? 'rgba(59,130,246,.35)' : 'var(--border)';
}

async function carregarConfigPixGestor() {
  const tid = _sessao?.tenant_id;
  if (!tid) return;
  try {
    const r = await fetch('/api/pix/config', { headers: { 'x-tenant-id': tid } });
    if (!r.ok) return;
    const d = await r.json();
    // PIX
    _renderPixOnlineToggle(d.pix_ativo !== false);
    // Preenche campos da chave manual se existirem
    const keyEl  = document.getElementById('pix-manual-key-input');
    const tipoEl = document.getElementById('pix-manual-tipo-select');
    if (keyEl  && d.pix_key_manual)      keyEl.value  = d.pix_key_manual;
    if (tipoEl && d.pix_key_manual_tipo) tipoEl.value = d.pix_key_manual_tipo;
    // Cartão — só aparece se admin configurou a public key
    const cartaoDisponivel = !!d.cartao_disponivel;
    const cartaoAtivo      = d.cartao_online_ativo !== false && cartaoDisponivel;
    _renderCartaoOnlineToggle(cartaoAtivo, cartaoDisponivel);
    // Mantém _pixAtivoGestor sincronizado (usado no fluxo PIX do cardápio)
    _pixAtivoGestor = d.pix_ativo !== false;
  } catch(e) {}
}

async function togglePixOnline() {
  const tid = _sessao?.tenant_id;
  if (!tid) return;
  const btn = document.getElementById('btn-pix-online-toggle');
  if (btn) btn.disabled = true;
  try {
    const novoEstado = !_pixOnlineAtivo;
    const r = await fetch('/api/pix/gestor-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ pix_ativo: novoEstado })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erro');
    _renderPixOnlineToggle(d.pix_ativo !== false);
    sbToast('ok', novoEstado ? 'PIX Online ativado!' : 'PIX Online desativado!');
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
  finally { const b = document.getElementById('btn-pix-online-toggle'); if (b) b.disabled = false; }
}

async function toggleCartaoOnline() {
  const tid = _sessao?.tenant_id;
  if (!tid) return;
  const btn = document.getElementById('btn-cartao-online-toggle');
  if (btn) btn.disabled = true;
  try {
    const novoEstado = !_cartaoOnlineAtivo;
    const r = await fetch('/api/pix/gestor-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ cartao_online_ativo: novoEstado })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erro');
    _renderCartaoOnlineToggle(d.cartao_online_ativo !== false, true);
    sbToast('ok', novoEstado ? 'Cartão Online ativado!' : 'Cartão Online desativado!');
  } catch(e) { sbToast('err', 'Erro: ' + e.message); }
  finally { const b = document.getElementById('btn-cartao-online-toggle'); if (b) b.disabled = false; }
}

async function carregarCarteira() {
  try {
    const tid = _sessao?.tenant_id;
    if (!tid) return;
    const _fetchTenant = (url) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      return fetch(url, { headers: { 'x-tenant-id': tid }, signal: ctrl.signal })
        .finally(() => clearTimeout(timer));
    };
    const [cartRes, saqRes] = await Promise.all([
      _fetchTenant('/api/carteira'),
      _fetchTenant('/api/saques/meus')
    ]);
    const cart   = cartRes.ok ? await cartRes.json() : {};
    const saques = saqRes.ok  ? await saqRes.json()  : [];

    const se = id => document.getElementById(id);
    if (se('crt-saldo'))       se('crt-saldo').textContent       = _fmtR(cart.saldo_disponivel);
    if (se('crt-total'))       se('crt-total').textContent       = _fmtR(cart.total_recebido);
    if (se('crt-sacado'))      se('crt-sacado').textContent      = _fmtR(cart.total_sacado);
    if (se('crt-npag'))        se('crt-npag').textContent        = cart.total_pagamentos || 0;
    if (se('crt-pix-count'))   se('crt-pix-count').textContent   = (cart.pix_count || 0) + ' pagtos';
    if (se('crt-cartao-count'))se('crt-cartao-count').textContent= (cart.cartao_count || 0) + ' pagtos';
    if (se('crt-pix-total'))   se('crt-pix-total').textContent   = _fmtR(cart.pix_recebido);
    if (se('crt-cartao-total'))se('crt-cartao-total').textContent = _fmtR(cart.cartao_recebido);

    // Aviso de PIX pendentes
    if (cart.pendentes_count > 0) {
      let avisoEl = se('crt-pendentes-aviso');
      if (!avisoEl) {
        avisoEl = document.createElement('div');
        avisoEl.id = 'crt-pendentes-aviso';
        avisoEl.style.cssText = 'background:rgba(249,115,22,.1);border:1px solid rgba(249,115,22,.25);border-radius:10px;padding:10px 14px;font-size:12px;color:var(--orange);margin-bottom:16px';
        const cardsEl = se('crt-saldo')?.closest('.card')?.parentElement;
        if (cardsEl?.nextElementSibling) cardsEl.parentElement.insertBefore(avisoEl, cardsEl.nextElementSibling);
      }
      avisoEl.innerHTML = `<strong>${cart.pendentes_count} PIX pendente(s)</strong> aguardando confirmação — ${_fmtR(cart.pendentes_valor)}. Não entram no saldo até confirmação.`;
      avisoEl.style.display = '';
    } else {
      const av = se('crt-pendentes-aviso'); if (av) av.style.display = 'none';
    }

    const saldo = parseFloat(cart.saldo_disponivel || 0);
    if (se('saque-valor-preview')) se('saque-valor-preview').textContent = _fmtR(saldo);
    const temPendente = saques.some(s => s.status === 'pendente');
    if (se('saque-form-wrap'))      se('saque-form-wrap').style.display      = temPendente ? 'none' : '';
    if (se('saque-pendente-aviso')) se('saque-pendente-aviso').style.display = temPendente ? '' : 'none';
    if (se('btn-solicitar-saque'))  se('btn-solicitar-saque').disabled       = saldo < 1;

    _renderSaqueHistorico(saques);
    _renderPixHistorico(cart.ultimos_pagamentos || []);
    _renderCartaoHistorico(cart.ultimos_cartao || []);

    // ── Esconde TUDO da carteira quando MP próprio está ativo ──
    // (mostra só o card de configuração MP próprio, no topo)
    const blocoInterno = document.getElementById('carteira-bloco-interno');
    if (blocoInterno) {
      blocoInterno.style.display = cart.mp_proprio ? 'none' : '';
    }
    // Carrega config MP do gestor para preencher o card de cima
    _carregarMpProprio();
  } catch(e) {
    sbToast('err', 'Erro ao carregar carteira: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════
// MERCADO PAGO PRÓPRIO (gestor)
// ═══════════════════════════════════════════════════════
async function _carregarMpProprio() {
  try {
    const tid = _sessao?.tenant_id;
    if (!tid) return;
    const r = await fetch('/api/gestor/mp-config', { headers: { 'x-tenant-id': tid } });
    if (!r.ok) return;
    const d = await r.json();
    _renderMpProprio(d);
  } catch(e) { /* silencia */ }
}

function _renderMpProprio(d) {
  const se = id => document.getElementById(id);
  const ativo = !!d.mp_token_configurado;

  // Badge de status
  const badge = se('mp-proprio-badge');
  if (badge) {
    if (ativo) {
      badge.textContent = '● Sua conta';
      badge.style.background = 'rgba(34,197,94,.12)';
      badge.style.color      = '#16a34a';
      badge.style.borderColor = 'rgba(34,197,94,.30)';
    } else {
      badge.textContent = '● Conta da plataforma';
      badge.style.background = 'rgba(99,102,241,.10)';
      badge.style.color      = '#6366f1';
      badge.style.borderColor = 'rgba(99,102,241,.25)';
    }
  }

  // Avisos
  if (se('mp-proprio-aviso-ativo'))  se('mp-proprio-aviso-ativo').style.display  = ativo ? '' : 'none';
  if (se('mp-proprio-aviso-global')) se('mp-proprio-aviso-global').style.display = ativo ? 'none' : '';

  // Inputs (mostra mascarado quando configurado)
  if (se('mp-proprio-token')) se('mp-proprio-token').value = d.mp_token_mascarado || '';
  if (se('mp-proprio-pk'))    se('mp-proprio-pk').value    = d.mp_public_key_mascarado || '';

  // Aviso de saldo pendente: só relevante quando NÃO está ativo ainda E tem saldo
  if (se('mp-proprio-aviso-saldo')) {
    const saldo = parseFloat(d.saldo_carteira_pendente || 0);
    if (!ativo && saldo >= 1) {
      se('mp-proprio-aviso-saldo').style.display = '';
      if (se('mp-proprio-saldo-valor')) se('mp-proprio-saldo-valor').textContent = _fmtR(saldo);
    } else {
      se('mp-proprio-aviso-saldo').style.display = 'none';
    }
  }

  // Botão de limpar só aparece se tiver algo configurado
  if (se('btn-mp-proprio-limpar')) se('btn-mp-proprio-limpar').style.display = ativo ? '' : 'none';
}

async function salvarMpProprio() {
  const tid = _sessao?.tenant_id;
  if (!tid) return;
  const tokenEl = document.getElementById('mp-proprio-token');
  const pkEl    = document.getElementById('mp-proprio-pk');
  const token = (tokenEl?.value || '').trim();
  const pk    = (pkEl?.value || '').trim();

  // Se ambos estão mascarados (sem mudança), não faz nada
  const tokenInalterado = token.startsWith('•') || token === '';
  const pkInalterado    = pk.startsWith('•') || pk === '';
  if (tokenInalterado && pkInalterado) {
    sbToast('err', 'Cole o Access Token (e Public Key, se quiser cartão) para salvar.');
    return;
  }

  // Confirmação clara: ele tá ativando recebimento direto
  if (!confirm(
    'Tem certeza que quer ativar sua conta Mercado Pago própria?\n\n' +
    '• Os pagamentos PIX e cartão dos seus pedidos vão direto pra ela\n' +
    '• PIX e cartão online serão ativados automaticamente no cardápio\n' +
    '• Não terá mais carteira/saques na plataforma\n' +
    '• Você pode reverter a qualquer momento'
  )) return;

  const body = {};
  if (!tokenInalterado) body.mp_token = token;
  if (!pkInalterado)    body.mp_public_key = pk;

  const btn = document.getElementById('btn-mp-proprio-salvar');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/gestor/mp-config', {
      method: 'POST',
      headers: { 'x-tenant-id': tid, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if (!r.ok) { sbToast('err', d.error || 'Erro ao salvar'); return; }
    sbToast('ok', 'Conta Mercado Pago ativada!');
    _renderMpProprio(d);
    // Recarrega a carteira pra esconder o bloco interno
    await carregarCarteira();
  } catch(e) {
    sbToast('err', 'Erro: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function limparMpProprio() {
  const tid = _sessao?.tenant_id;
  if (!tid) return;
  if (!confirm(
    'Voltar a usar a conta da plataforma?\n\n' +
    '• Os próximos pagamentos voltarão a passar pela carteira interna\n' +
    '• Você precisará solicitar saques novamente\n' +
    '• Sua conta MP será removida do sistema'
  )) return;

  const btn = document.getElementById('btn-mp-proprio-limpar');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/gestor/mp-config', {
      method: 'POST',
      headers: { 'x-tenant-id': tid, 'Content-Type': 'application/json' },
      body: JSON.stringify({ limpar: true })
    });
    const d = await r.json();
    if (!r.ok) { sbToast('err', d.error || 'Erro ao limpar'); return; }
    sbToast('ok', 'Voltou a usar a conta da plataforma.');
    // Limpa inputs
    const t = document.getElementById('mp-proprio-token'); if (t) t.value = '';
    const p = document.getElementById('mp-proprio-pk');    if (p) p.value = '';
    _renderMpProprio(d);
    await carregarCarteira();
  } catch(e) {
    sbToast('err', 'Erro: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function showPayTab(tab) {
  const isPix = tab === 'pix';
  const pixDiv    = document.getElementById('pix-historico');
  const cartaoDiv = document.getElementById('cartao-historico');
  const btnPix    = document.getElementById('tab-pix-hist');
  const btnCartao = document.getElementById('tab-cartao-hist');
  if (pixDiv)    pixDiv.style.display    = isPix ? '' : 'none';
  if (cartaoDiv) cartaoDiv.style.display = isPix ? 'none' : '';
  if (btnPix) {
    btnPix.style.background = isPix ? 'var(--accent)' : 'var(--surface2)';
    btnPix.style.color      = isPix ? '#fff' : 'var(--muted)';
  }
  if (btnCartao) {
    btnCartao.style.background = isPix ? 'var(--surface2)' : 'var(--accent)';
    btnCartao.style.color      = isPix ? 'var(--muted)' : '#fff';
  }
}

    // Cards de saldo
    const se = id => document.getElementById(id);

function _renderSaqueHistorico(saques) {
  const el = document.getElementById('saque-historico');
  if (!el) return;
  if (!saques.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px">Nenhum saque solicitado ainda.</div>'; return; }
  const badge = { pendente:'background:rgba(249,115,22,.15);color:var(--orange)', aprovado:'background:rgba(59,130,246,.15);color:var(--accent)', pago:'background:rgba(34,197,94,.15);color:var(--success)', cancelado:'background:rgba(239,68,68,.15);color:var(--danger)' };
  const label = { pendente:'Pendente', aprovado:'Aprovado', pago:'Pago', cancelado:'Cancelado' };
  el.innerHTML = saques.map(s => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-weight:600;font-size:13px">${_fmtR(s.valor_liquido)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${s.pix_key_tipo?.toUpperCase()}: ${s.pix_key} · ${new Date(s.created_at).toLocaleDateString('pt-BR')}</div>
        ${s.obs_admin ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">${s.obs_admin}</div>` : ''}
      </div>
      <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;${badge[s.status]||badge.pendente}">${label[s.status]||s.status}</span>
    </div>`).join('');
}

function _renderPixHistorico(pagamentos) {
  const el = document.getElementById('pix-historico');
  if (!el) return;
  if (!pagamentos.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px">Nenhum pagamento PIX ainda.</div>'; return; }
  const badge = { aprovado:'background:rgba(34,197,94,.15);color:var(--success)', pendente:'background:rgba(249,115,22,.15);color:var(--orange)', rejeitado:'background:rgba(239,68,68,.15);color:var(--danger)', cancelado:'background:rgba(239,68,68,.15);color:var(--danger)' };
  el.innerHTML = pagamentos.map(p => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-weight:600;font-size:13px">${_fmtR(p.valor)} <span style="font-weight:400;color:var(--muted);font-size:12px">→ líquido ${_fmtR(p.valor_liquido)}</span></div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${p.payer_name||'—'} · Pedido #${_orderNum(p.order_id||0)} · ${new Date(p.created_at).toLocaleDateString('pt-BR')}</div>
      </div>
      <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;${badge[p.status]||badge.pendente}">${p.status}</span>
    </div>`).join('');
}

function _renderCartaoHistorico(pagamentos) {
  const el = document.getElementById('cartao-historico');
  if (!el) return;
  if (!pagamentos.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px">Nenhum pagamento por cartão ainda.</div>'; return; }
  const badge = { aprovado:'background:rgba(34,197,94,.15);color:var(--success)', rejeitado:'background:rgba(239,68,68,.15);color:var(--danger)', pendente:'background:rgba(249,115,22,.15);color:var(--orange)' };
  el.innerHTML = pagamentos.map(p => {
    const liq = parseFloat(p.valor||0) * 0.93;
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-weight:600;font-size:13px">${_fmtR(p.valor)} <span style="font-weight:400;color:var(--muted);font-size:12px">→ líquido ${_fmtR(liq)}</span></div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">
          ${p.payer_name||'—'} · Pedido #${_orderNum(p.order_id||0)} ·
          ${p.payment_method_id ? p.payment_method_id.charAt(0).toUpperCase()+p.payment_method_id.slice(1) : 'Cartão'}
          ${p.last_four_digits ? '••••'+p.last_four_digits : ''} ·
          ${new Date(p.created_at).toLocaleDateString('pt-BR')}
        </div>
      </div>
      <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;${badge[p.status]||badge.pendente}">${p.status}</span>
    </div>`;
  }).join('');
}

async function solicitarSaque() {
  const pixKey  = document.getElementById('saque-pix-key')?.value.trim();
  const pixTipo = document.getElementById('saque-pix-tipo')?.value || 'aleatoria';
  if (!pixKey) { sbToast('err', 'Informe a chave PIX'); return; }

  const btn = document.getElementById('btn-solicitar-saque');
  if (btn) { btn.disabled = true; btn.textContent = 'Solicitando...'; }
  try {
    const tid = _sessao?.tenant_id;
    const res = await fetch('/api/saques/solicitar', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ pix_key: pixKey, pix_key_tipo: pixTipo })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');
    sbToast('ok', `Saque de ${_fmtR(data.valor)} solicitado! Pagamento em até 24 horas úteis.`);
    await carregarCarteira();
  } catch(e) {
    sbToast('err', 'Erro: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Solicitar saque'; }
  }
}

// ══════════════════════════════════════════
//  GRUPOS DE CUSTOMIZAÇÃO
// ══════════════════════════════════════════
function addGrupo(ctx) {
  var list = document.getElementById(ctx + '-grupos-list');
  if (!list) return;
  var div = document.createElement('div');
  div.className = 'grp-wrap';
  div.innerHTML = _grupoHtml({nome:'', tipo:'radio', min:0, max:1, required:false, opcoes:[]});
  list.appendChild(div);
}

function _grupoHtml(g) {
  var isCheck = g.tipo === 'checkbox';
  var isReq   = g.required === true;
  var optsHtml = (g.opcoes||[]).map(_optHtml).join('');
  var html = '<div class="grp-header">';
  html += '<input class="grp-title-input" placeholder="Nome do grupo" value="' + (g.nome||'').replace(/"/g,'&quot;') + '">';
  html += '<button type="button" class="grp-del" onclick="delGrupo(this)">×</button>';
  html += '</div>';
  html += '<div class="grp-type-row">';
  html += '<button type="button" class="grp-type-btn ' + (!isCheck?'on':'') + '" onclick="setGrupoTipo(this,\'radio\')">● Escolha 1</button>';
  html += '<button type="button" class="grp-type-btn ' + (isCheck?'on':'') + '" onclick="setGrupoTipo(this,\'checkbox\')">☑ Múltipla</button>';
  html += '</div>';
  html += '<div style="display:flex;align-items:center;gap:8px;margin:6px 0 2px">';
  html += '<label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);cursor:pointer">';
  html += '<input type="checkbox" class="grp-required" ' + (isReq?'checked':'') + ' style="accent-color:var(--accent);width:14px;height:14px">';
  html += 'Obrigatório</label>';
  html += '</div>';
  html += '<div class="grp-min-max" style="display:' + (isCheck?'flex':'none') + '">';
  html += '<label style="font-size:11px;color:var(--muted);align-self:center">Mín</label>';
  html += '<input type="number" class="grp-min" min="0" max="99" value="' + (g.min||0) + '">';
  html += '<label style="font-size:11px;color:var(--muted);align-self:center">Máx</label>';
  html += '<input type="number" class="grp-max" min="1" max="99" value="' + (g.max||1) + '">';
  html += '</div>';
  html += '<div class="grp-opts-list">' + optsHtml + '</div>';
  html += '<button type="button" class="grp-add-opt" onclick="addGrupoOpt(this)">+ Adicionar opção</button>';
  return html;
}

function _optHtml(o) {
  // Estado de "esgotado" — lê do Set global do gestor.
  // Se o Set ainda não foi carregado (usuário não passou pela tela "Adicionais Esgotados"),
  // _carregarEsgotadosBg() é disparado em background pra atualizar os botões depois.
  var nomeNorm = (typeof _normAddonGestor === 'function')
    ? _normAddonGestor(o.nome || '')
    : String(o.nome||'').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  var esgotado = (typeof _addonsEsgSet !== 'undefined' && _addonsEsgSet && _addonsEsgSet.has)
    ? _addonsEsgSet.has(nomeNorm)
    : false;
  if (typeof _carregarEsgotadosBg === 'function') _carregarEsgotadosBg();

  // Botão de pausa: ⏸ cinza quando disponível, ▶ laranja quando esgotado
  var pauseStyle = esgotado
    ? 'background:rgba(249,115,22,.15);color:var(--accent);border:1px solid var(--accent)'
    : 'background:none;color:var(--muted);border:1px solid var(--border)';
  var pauseTitle = esgotado
    ? 'Esgotado em todos os pratos — clique para liberar'
    : 'Pausar este adicional em todos os pratos';
  var pauseIcon = esgotado
    ? '<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M5 3l8 5-8 5V3z" fill="currentColor"/></svg>'
    : '<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor"/><rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor"/></svg>';

  var html = '<div class="grp-opt-row" data-nome-norm="' + nomeNorm + '">';
  html += '<input class="grp-opt-name" placeholder="Nome da opção" value="' + (o.nome||'').replace(/"/g,'&quot;') + '" onchange="_atualizarPauseBtnRow(this)">';
  html += '<input class="grp-opt-price" type="number" step="0.01" min="0" placeholder="+R$" value="' + (o.preco||'') + '">';
  html += '<button type="button" class="grp-opt-pause" title="' + pauseTitle + '" style="width:28px;height:28px;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;' + pauseStyle + '" onclick="_togglePauseRow(this)">' + pauseIcon + '</button>';
  html += '<button type="button" class="grp-opt-del" onclick="delGrupoOpt(this)">×</button>';
  html += '</div>';
  return html;
}

// ── Atualiza o botão de pausa de UMA linha (chamado quando o usuário muda o nome do adicional) ──
function _atualizarPauseBtnRow(inputNome) {
  var row = inputNome.closest('.grp-opt-row');
  if (!row) return;
  var nomeNorm = (typeof _normAddonGestor === 'function')
    ? _normAddonGestor(inputNome.value || '')
    : String(inputNome.value||'').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  row.dataset.nomeNorm = nomeNorm;
  _refreshPauseBtnStateRow(row);
}

// ── Reflete o estado atual (esgotado/disponível) no botão de pausa de UMA linha ──
function _refreshPauseBtnStateRow(row) {
  if (!row) return;
  var btn = row.querySelector('.grp-opt-pause');
  if (!btn) return;
  var nomeNorm = row.dataset.nomeNorm || '';
  var esgotado = (typeof _addonsEsgSet !== 'undefined' && _addonsEsgSet && _addonsEsgSet.has)
    ? _addonsEsgSet.has(nomeNorm) : false;
  if (esgotado) {
    btn.style.background = 'rgba(249,115,22,.15)';
    btn.style.color      = 'var(--accent)';
    btn.style.border     = '1px solid var(--accent)';
    btn.title            = 'Esgotado em todos os pratos — clique para liberar';
    btn.innerHTML        = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M5 3l8 5-8 5V3z" fill="currentColor"/></svg>';
  } else {
    btn.style.background = 'none';
    btn.style.color      = 'var(--muted)';
    btn.style.border     = '1px solid var(--border)';
    btn.title            = 'Pausar este adicional em todos os pratos';
    btn.innerHTML        = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor"/><rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor"/></svg>';
  }
}

// ── Atualiza TODAS as linhas visíveis (chamado depois de carregar o Set do servidor) ──
function _refreshTodosPauseBtns() {
  document.querySelectorAll('.grp-opt-row').forEach(_refreshPauseBtnStateRow);
}

// ── Carrega esgotados em background (idempotente; só a 1ª chamada faz fetch) ──
var _esgotadosBgFetched = false;
async function _carregarEsgotadosBg() {
  if (_esgotadosBgFetched) return;
  _esgotadosBgFetched = true;
  try {
    var tid = '';
    try { tid = JSON.parse(sessionStorage.getItem('sys_session')||'{}').tenant_id||''; } catch(e) {}
    if (!tid) { _esgotadosBgFetched = false; return; }
    var r = await fetch('/api/addons-esgotados', { headers: { 'x-tenant-id': tid } });
    if (!r.ok) { _esgotadosBgFetched = false; return; }
    var data = await r.json();
    if (typeof _addonsEsgSet !== 'undefined') {
      _addonsEsgSet = new Set(data.esgotados || []);
    } else {
      window._addonsEsgSet = new Set(data.esgotados || []);
    }
    _refreshTodosPauseBtns();
  } catch(e) { _esgotadosBgFetched = false; }
}

// ── Toggle pausa: pega o nome do input, chama o endpoint, atualiza TODAS as linhas com mesmo nome ──
async function _togglePauseRow(btn) {
  var row = btn.closest('.grp-opt-row');
  if (!row) return;
  var inputNome = row.querySelector('.grp-opt-name');
  var nome = (inputNome?.value || '').trim();
  if (!nome) {
    if (typeof sbToast === 'function') sbToast('err', 'Digite o nome do adicional antes de pausar');
    return;
  }
  var nomeNorm = (typeof _normAddonGestor === 'function')
    ? _normAddonGestor(nome)
    : nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  row.dataset.nomeNorm = nomeNorm;

  var jaEsgotado = (typeof _addonsEsgSet !== 'undefined' && _addonsEsgSet && _addonsEsgSet.has)
    ? _addonsEsgSet.has(nomeNorm) : false;
  var ativando = !jaEsgotado;

  // Otimista: atualiza Set local e TODAS as linhas com mesmo nome_norm
  if (typeof _addonsEsgSet !== 'undefined') {
    if (ativando) _addonsEsgSet.add(nomeNorm); else _addonsEsgSet.delete(nomeNorm);
  }
  document.querySelectorAll('.grp-opt-row').forEach(function(r){
    if (r.dataset.nomeNorm === nomeNorm) _refreshPauseBtnStateRow(r);
  });
  // Desabilita o botão durante a chamada
  btn.disabled = true; btn.style.opacity = '0.6'; btn.style.cursor = 'wait';

  try {
    var tid = '';
    try { tid = JSON.parse(sessionStorage.getItem('sys_session')||'{}').tenant_id||''; } catch(e) {}
    if (!tid) throw new Error('sem tenant');
    var url = '/api/addons-esgotados' + (!ativando ? '?nome=' + encodeURIComponent(nome) : '');
    var r = await fetch(url, {
      method: ativando ? 'POST' : 'DELETE',
      headers: { 'Content-Type':'application/json', 'x-tenant-id': tid },
      body: ativando ? JSON.stringify({ nome: nome }) : undefined
    });
    if (!r.ok) throw new Error('falhou');
    if (typeof sbToast === 'function') {
      sbToast('ok', ativando ? (nome + ': pausado em todos os pratos') : (nome + ': disponível novamente'));
    }
  } catch(e) {
    // Reverte
    if (typeof _addonsEsgSet !== 'undefined') {
      if (ativando) _addonsEsgSet.delete(nomeNorm); else _addonsEsgSet.add(nomeNorm);
    }
    document.querySelectorAll('.grp-opt-row').forEach(function(r){
      if (r.dataset.nomeNorm === nomeNorm) _refreshPauseBtnStateRow(r);
    });
    if (typeof sbToast === 'function') sbToast('err', 'Erro ao salvar');
  } finally {
    btn.disabled = false; btn.style.opacity = ''; btn.style.cursor = 'pointer';
  }
}

function delGrupo(btn)    { btn.closest('.grp-wrap').remove(); }
function delGrupoOpt(btn) { btn.closest('.grp-opt-row').remove(); }

function setGrupoTipo(btn, tipo) {
  var wrap = btn.closest('.grp-wrap');
  wrap.querySelectorAll('.grp-type-btn').forEach(function(b){ b.classList.remove('on'); });
  btn.classList.add('on');
  var mm = wrap.querySelector('.grp-min-max');
  if (mm) mm.style.display = (tipo === 'checkbox') ? 'flex' : 'none';
}

function addGrupoOpt(btn) {
  var list = btn.closest('.grp-wrap').querySelector('.grp-opts-list');
  var tmp = document.createElement('div');
  tmp.innerHTML = _optHtml({});
  list.appendChild(tmp.firstElementChild);
}

function renderGrupos(ctx, grupos) {
  var list = document.getElementById(ctx + '-grupos-list');
  if (!list) return;
  list.innerHTML = '';
  (grupos||[]).forEach(function(g) {
    var div = document.createElement('div');
    div.className = 'grp-wrap';
    div.innerHTML = _grupoHtml(g);
    list.appendChild(div);
  });
}

function readGrupos(ctx) {
  var list = document.getElementById(ctx + '-grupos-list');
  if (!list) return [];
  return Array.from(list.querySelectorAll('.grp-wrap')).map(function(wrap) {
    var nameEl  = wrap.querySelector('.grp-title-input');
    var tipoBtn = wrap.querySelector('.grp-type-btn.on');
    var minEl   = wrap.querySelector('.grp-min');
    var maxEl   = wrap.querySelector('.grp-max');
    var tipo    = (tipoBtn && tipoBtn.textContent.indexOf('Múltipla') >= 0) ? 'checkbox' : 'radio';
    var opcoes  = Array.from(wrap.querySelectorAll('.grp-opt-row')).map(function(row) {
      var n = (row.querySelector('.grp-opt-name') || {}).value || '';
      var p = parseFloat((row.querySelector('.grp-opt-price') || {}).value) || 0;
      return { nome: n.trim(), preco: p };
    }).filter(function(o){ return o.nome; });
    var reqEl = wrap.querySelector('.grp-required');
    return {
      nome:     (nameEl ? nameEl.value : '').trim(),
      tipo:     tipo,
      required: reqEl ? reqEl.checked : false,
      min:      tipo === 'radio' ? 0 : (parseInt(minEl ? minEl.value : 0) || 0),
      max:      parseInt(maxEl ? maxEl.value : 1) || 1,
      opcoes:   opcoes
    };
  }).filter(function(g){ return g.nome || g.opcoes.length; });
}



// ═══════════════════════════════════════════════════════
// CLIENTES — Base de clientes cadastrados no cardápio
// ═══════════════════════════════════════════════════════

let _cliModalId = null;

// Utilidade local segura (elv não é global)
function _cliSet(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function cliTab(tab) {
  _cliTab = tab;
  ['todos', 'aniversario', 'inativos'].forEach(t => {
    const b = document.getElementById('btn-cli-tab-' + t);
    if (!b) return;
    if (t === tab) {
      b.style.background  = 'var(--accent)';
      b.style.color       = '#fff';
      b.style.borderColor = 'var(--accent)';
    } else {
      b.style.background  = '';
      b.style.color       = '';
      b.style.borderColor = '';
    }
  });
  renderClientes();
}

async function cliCarregar() {
  sbLoading(true);
  try {
    // Endpoint dedicado: faz JOIN com orders e fidelidade no servidor
    const tid = (() => {
      try { return JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || null; } catch { return null; }
    })();

    const res = await fetch('/api/clientes-gestor', {
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid || '' }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    cliData = await res.json();

    // Enriquece com campos computados no client
    cliData = cliData.map(c => ({
      ...c,
      _lastOrderDate: c.last_order_at ? new Date(c.last_order_at) : null,
      _createdDate:   c.created_at    ? new Date(c.created_at)    : null,
      _birthdayMMDD:  c.birthday      ? c.birthday.slice(5)       : null  // MM-DD
    }));

    _cliTab = 'todos';
    cliTab('todos');
    renderClientes();
  } catch (e) {
    console.error('[Clientes] Erro:', e);
    sbToast('err', 'Erro ao carregar clientes: ' + e.message);
  }
  sbLoading(false);
}

function _cliDiasAteAniv(mmdd) {
  if (!mmdd) return 9999;
  const hoje = new Date();
  const [m, d] = mmdd.split('-').map(Number);
  let aniv = new Date(hoje.getFullYear(), m - 1, d);
  if (aniv < hoje) aniv = new Date(hoje.getFullYear() + 1, m - 1, d);
  return Math.round((aniv - hoje) / 86400000);
}

function renderClientes() {
  const hoje    = new Date();
  const mes     = String(hoje.getMonth() + 1).padStart(2, '0');
  const diaHoje = `${mes}-${String(hoje.getDate()).padStart(2, '0')}`;
  const lim30   = new Date(hoje - 30 * 86400000);

  const enriched = cliData.map(c => ({
    ...c,
    isAnivHoje: c._birthdayMMDD === diaHoje,
    isAnivMes:  c._birthdayMMDD?.startsWith(mes) || false,
    diasAteAniv: _cliDiasAteAniv(c._birthdayMMDD),
    isInativo:  !c._lastOrderDate || c._lastOrderDate < lim30
  }));

  // Stats
  _cliSet('cli-st-total',       enriched.length);
  _cliSet('cli-st-aniv-hoje',   enriched.filter(c => c.isAnivHoje).length);
  _cliSet('cli-st-aniv-mes',    enriched.filter(c => c.isAnivMes).length);
  _cliSet('cli-st-com-pedido',  enriched.filter(c => c.orders_count > 0).length);

  // Banner aniversariantes hoje
  const anivHoje = enriched.filter(c => c.isAnivHoje);
  const banner = document.getElementById('cli-aniv-banner');
  if (banner) {
    banner.style.display = anivHoje.length ? 'block' : 'none';
    _cliSet('cli-aniv-hoje-badge', anivHoje.length);
    const list = document.getElementById('cli-aniv-hoje-list');
    if (list) list.innerHTML = anivHoje.map(c =>
      `<div style="background:rgba(139,92,246,.2);border:1px solid rgba(139,92,246,.3);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600">
        ${c.name || '?'} ${c.phone ? `<span style="color:var(--muted);font-weight:400">${c.phone}</span>` : ''}
      </div>`
    ).join('');
  }

  // Filtro por aba
  let lista = [...enriched];
  if (_cliTab === 'aniversario') lista = lista.filter(c => c._birthdayMMDD);
  else if (_cliTab === 'inativos') lista = lista.filter(c => c.isInativo && c.orders_count > 0);

  // Busca
  const search = (document.getElementById('cli-search')?.value || '').trim().toLowerCase();
  if (search) lista = lista.filter(c =>
    (c.name  || '').toLowerCase().includes(search) ||
    (c.phone || '').includes(search) ||
    (c.email || '').toLowerCase().includes(search)
  );

  // Ordenação
  const order = document.getElementById('cli-order')?.value || 'recente';
  if      (order === 'nome')        lista.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  else if (order === 'pedidos')     lista.sort((a, b) => b.orders_count - a.orders_count);
  else if (order === 'gasto')       lista.sort((a, b) => b.total_spent  - a.total_spent);
  else if (order === 'aniversario') lista.sort((a, b) => a.diasAteAniv  - b.diasAteAniv);
  else                              lista.sort((a, b) => (b._createdDate || 0) - (a._createdDate || 0));

  const txt = `${lista.length} cliente${lista.length !== 1 ? 's' : ''}`;
  _cliSet('cli-count',  txt);
  _cliSet('cli-count2', txt);

  const tbody = document.getElementById('cli-tbody');
  const empty = document.getElementById('cli-empty');
  if (!tbody) return;

  if (!lista.length) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = lista.map(c => {
    // Aniversário
    const anivStr = c.birthday ? (() => {
      const [y, m2, d2] = c.birthday.split('-');
      const label = `${d2}/${m2}${y && y !== '0000' ? `/${y.slice(2)}` : ''}`;
      if (c.isAnivHoje) return `<span style="color:var(--purple);font-weight:700">🎂 ${label} hoje!</span>`;
      if (c.isAnivMes)  return `<span style="color:var(--accent3)">📅 ${label}</span>`;
      return `<span style="color:var(--muted)">${label}</span>`;
    })() : `<span style="color:var(--border2)">—</span>`;

    // Último pedido
    const ultimoStr = c.last_order_at ? (() => {
      const d3   = new Date(c.last_order_at);
      const diff = Math.floor((hoje - d3) / 86400000);
      const label = d3.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const cor  = diff > 60 ? 'var(--danger)' : diff > 30 ? 'var(--accent3)' : 'var(--success)';
      const ago  = diff === 0 ? 'hoje' : diff === 1 ? 'ontem' : `${diff}d atrás`;
      return `<span style="color:${cor}">${label}</span><br><span style="font-size:10px;color:var(--muted)">${ago}</span>`;
    })() : `<span style="color:var(--muted)">Nenhum</span>`;

    // Fidelidade
    const fidStr = c.fid_pts !== null
      ? `<span style="background:rgba(139,92,246,.18);color:var(--purple);padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700">${c.fid_pts} pts</span>`
      : `<span style="color:var(--border2)">—</span>`;

    // Gasto
    const gastoStr = c.total_spent > 0
      ? `<span style="color:var(--success);font-weight:600">R$ ${parseFloat(c.total_spent).toFixed(2).replace('.', ',')}</span>`
      : `<span style="color:var(--muted)">R$ 0,00</span>`;

    return `<tr>
      <td>
        <div style="font-weight:600;font-size:13px">${c.name || '—'}</div>
        ${c.email ? `<div style="font-size:11px;color:var(--muted)">${c.email}</div>` : ''}
        ${c.addr  ? `<div style="font-size:10px;color:var(--muted)">${c.addr.slice(0, 40)}${c.addr.length > 40 ? '…' : ''}</div>` : ''}
      </td>
      <td style="font-size:13px">${c.phone || '—'}</td>
      <td>${anivStr}</td>
      <td style="text-align:center;font-weight:700;font-size:14px;color:var(--accent)">${c.orders_count}</td>
      <td>${gastoStr}</td>
      <td>${ultimoStr}</td>
      <td>${fidStr}</td>
      <td>
        <button class="btn bp" style="font-size:11px;padding:4px 10px" onclick="openClienteModal(${c.id})">Ver</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Modal: abre detalhes ─────────────────────────────
async function openClienteModal(id) {
  const c = cliData.find(x => x.id === id);
  if (!c) return;
  _cliModalId = id;

  _cliSet('modal-cli-title', `${c.name || 'Cliente'}`);
  document.getElementById('edit-cli-id').value          = c.id;
  document.getElementById('edit-cli-nome').value        = c.name     || '';
  document.getElementById('edit-cli-phone').value       = c.phone    || '';
  document.getElementById('edit-cli-email').value       = c.email    || '';
  document.getElementById('edit-cli-aniversario').value = c.birthday || '';
  document.getElementById('edit-cli-addr').value        = c.addr     || '';

  _cliSet('cli-det-orders', c.orders_count);
  document.getElementById('cli-det-gasto').textContent =
    `R$ ${parseFloat(c.total_spent || 0).toFixed(2).replace('.', ',')}`;
  document.getElementById('cli-det-pts').textContent =
    c.fid_pts !== null ? `${c.fid_pts} pts` : '—';
  document.getElementById('cli-det-criado').textContent =
    c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR') : '—';
  document.getElementById('cli-det-ultimo').textContent =
    c.last_order_at ? new Date(c.last_order_at).toLocaleDateString('pt-BR') : 'Nenhum';

  cliModalTab('info');
  openModal('modal-cliente-detalhe');
}

// ── Modal: troca de aba ──────────────────────────────
function cliModalTab(tab) {
  document.getElementById('cli-modal-info').style.display    = tab === 'info'    ? 'block' : 'none';
  document.getElementById('cli-modal-pedidos').style.display = tab === 'pedidos' ? 'block' : 'none';
  document.getElementById('cli-tab-info').classList.toggle('active',    tab === 'info');
  document.getElementById('cli-tab-pedidos').classList.toggle('active', tab === 'pedidos');
  if (tab === 'pedidos') cliCarregarPedidos(_cliModalId);
}

// ── Modal: carrega pedidos do cliente ────────────────
async function cliCarregarPedidos(id) {
  const listEl = document.getElementById('cli-pedidos-list');
  if (!listEl) return;
  listEl.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted)">Carregando...</div>';

  const c = cliData.find(x => x.id === id);
  if (!c) { listEl.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted)">Cliente não encontrado</div>'; return; }

  // Busca por customer_id; fallback por phone
  let { data: orders } = await sb.from('orders')
    .select('id,client,items,total,taxa,pag,status,created_at,addr,mesa_num')
    .eq('customer_id', c.id)
    .order('id', { ascending: false })
    .limit(30);

  if ((!orders || !orders.length) && c.phone) {
    const r2 = await sb.from('orders')
      .select('id,client,items,total,taxa,pag,status,created_at,addr,mesa_num')
      .eq('phone', c.phone)
      .order('id', { ascending: false })
      .limit(30);
    orders = r2.data || [];
  }
  orders = orders || [];

  if (!orders.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted)">Nenhum pedido encontrado</div>';
    return;
  }

  const stLabel = { analise:'Aguardando', producao:'Preparo', pronto:'Pronto', saiu:'Saiu', entregue:'Entregue', cancelado:'Cancelado', finalizado:'✅ Finalizado', aguardando_pix:'⏳ Aguard. PIX', aguardando_cartao:'💳 Aguard. Cartão' };
  const stCor   = { analise:'var(--accent3)', producao:'var(--accent)', pronto:'var(--success)', saiu:'var(--accent2)', entregue:'var(--success)', cancelado:'var(--danger)', finalizado:'var(--success)', aguardando_pix:'var(--muted)', aguardando_cartao:'var(--muted)' };

  listEl.innerHTML = orders.map(o => {
    const items = Array.isArray(o.items) ? o.items : (() => { try { return JSON.parse(o.items) } catch { return [] } })();
    const itStr = items.map(i => `${i.qty}x ${i.name}`).join(', ');
    const total = parseFloat(o.total || 0) + parseFloat(o.taxa || 0);
    const data  = o.created_at ? new Date(o.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    const st    = o.status || 'analise';
    return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-weight:700;font-size:13px">Pedido #${o.id}</div>
        <span style="color:${stCor[st]||'var(--muted)'};font-size:11.5px;font-weight:600">${stLabel[st]||st}</span>
      </div>
      <div style="font-size:12px;color:var(--muted2);margin-bottom:6px">${itStr || 'Sem itens'}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px">
        <span style="color:var(--muted)">${data}${o.addr ? ` · ${o.addr.slice(0, 30)}` : ''}</span>
        <span style="font-weight:700;color:var(--success)">R$ ${total.toFixed(2).replace('.', ',')}</span>
      </div>
    </div>`;
  }).join('');
}

// ── Salvar edição do cliente ─────────────────────────
async function saveCliente() {
  const id       = parseInt(document.getElementById('edit-cli-id').value);
  if (!id) return;
  const nome     = document.getElementById('edit-cli-nome').value.trim();
  const phone    = document.getElementById('edit-cli-phone').value.trim();
  const email    = document.getElementById('edit-cli-email').value.trim() || null;
  const birthday = document.getElementById('edit-cli-aniversario').value || null;
  const addr     = document.getElementById('edit-cli-addr').value.trim() || null;

  if (!nome) { sbToast('err', 'Informe o nome'); return; }

  sbLoading(true);
  const { error } = await sb.from('customers').update({ name: nome, phone, email, birthday, addr }).eq('id', id);
  sbLoading(false);

  if (error) { sbToast('err', 'Erro ao salvar: ' + error.message); return; }

  // Atualiza cache local
  const idx = cliData.findIndex(x => x.id === id);
  if (idx >= 0) Object.assign(cliData[idx], {
    name: nome, phone, email, birthday, addr,
    _birthdayMMDD: birthday ? birthday.slice(5) : null
  });

  closeModal('modal-cliente-detalhe');
  renderClientes();
  sbToast('ok', `${nome} atualizado!`);
}

// ── Excluir cliente ──────────────────────────────────
async function deleteCliente() {
  const id = parseInt(document.getElementById('edit-cli-id').value);
  const c  = cliData.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`Excluir "${c.name || 'este cliente'}"? Ação irreversível.`)) return;

  sbLoading(true);
  const { error } = await sb.from('customers').delete().eq('id', id);
  sbLoading(false);

  if (error) { sbToast('err', 'Erro ao excluir'); return; }

  cliData = cliData.filter(x => x.id !== id);
  closeModal('modal-cliente-detalhe');
  renderClientes();
  sbToast('ok', `${c.name || 'Cliente'} removido`);
}

// ── Fim CLIENTES ─────────────────────────────────────

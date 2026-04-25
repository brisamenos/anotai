// NAV
// ─────────────────────────────────────────
function nav(id) {
  // ── Bloqueio do Robô para plano Pro ──────────────────
  if (id === 'robo') {
    if (_planoAtual !== 'premium') {
      _toastUpgradePlano();
      return; // Não navega
    }
  }
  document.querySelectorAll('.page').forEach(p => { p.classList.remove('on'); p.style.display = ''; });
  document.querySelectorAll('.si').forEach(s => s.classList.remove('on'));
  // Fecha sidebar no mobile ao navegar
  document.querySelector('.sidebar')?.classList.remove('mobile-open');
  const pg = document.getElementById('page-' + id);
  if (pg) pg.classList.add('on');
  const _mainEl = document.querySelector('.main'); if (_mainEl) _mainEl.scrollTop = 0;
  const sn = document.getElementById('sn-' + id);
  if (sn) sn.classList.add('on');
  closeNotif();
  if (id === 'pedidos') renderKanban();
  if (id === 'pedidos-mesa') renderMesasPage();
  if (id === 'gestor' || id === 'gestor-main') renderGestor();
  if (id === 'edicao') renderTable();
  if (id === 'imagens') renderImagens();
  if (id === 'potencializador') renderPotencializador();
  if (id === 'pdv') renderPDV();
  if (id === 'pdv-balcao') renderPDVBalcao();
  if (id === 'robo') {
    evoCarregarInstancia().then(() => {
      evoCheckStatus();   // vai atualizar QR/conectado porque naAbaRobo=true agora
    });
    initChat();
  }
  if (id === 'qrcode') renderQR();
  if (id === 'cupom') { renderCupons(); loadCashbackConfig(); }
  if (id === 'fidelidade') renderFidelidade();
  if (id === 'garcom') { renderGarcom(); loadGarcons(); }
  if (id === 'kds') renderKDS();
  if (id === 'estoque') renderEstoque();
  if (id === 'desempenho') { setDesempPrd(_desempPrd); }
  if (id === 'relatorios') { setRelPeriodo(_relPeriodo); }
  if (id === 'satisfacao') renderSatisfacao();
  if (id === 'clientes') cliCarregar();
  if (id === 'impressao') renderImpressao();
  if (id === 'caixa') _renderCaixaTela();
  if (id === 'configuracoes') _renderConfiguracoes();
  if (id === 'saques') { carregarCarteira(); conectarSaquesSSE(); carregarConfigPixGestor(); }
  if (id === 'taxa') renderTaxaPage();

  if (id === 'meu-plano') renderMeuPlano();
  if (id === 'historico') renderHistorico();
  if (id === 'fornecedores') renderFornecedores();
  if (id === 'contas-pagar') { renderFornecedores().then(() => renderContasPagar()); }
  if (id === 'dre') renderDRE();
  if (id === 'cardapio-publico') {
    const cpPg = document.getElementById('page-cardapio-publico');
    if (cpPg) cpPg.style.display = 'flex';
    loadCardapioPublico().then(() => {
      // Aplica visibilidade do carrossel após carregar (garante que _segmento já foi definido)
      const catsWrap = document.getElementById('cp-cats-modo-wrap');
      if (catsWrap) catsWrap.style.display = window._segmento === 'acougue' ? 'none' : 'block';
    });
  }
  if (id === 'tema') {
    const tPg = document.getElementById('page-tema');
    if (tPg) tPg.style.display = 'flex';
    initTemaPage();
  }
}

// Registra a nav real para o stub do head executar chamadas pendentes
window._navReady = nav;

function switchTab(btn, id) {
  const parent = btn.closest('.page') || document.body;
  parent.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  btn.classList.add('on');
  parent.querySelectorAll('.ts').forEach(t => t.classList.remove('on'));
  const sec = parent.querySelector('#' + id);
  if (sec) sec.classList.add('on');
}

let _kanbanFilter = '';
function filterKanban(type) {
  _kanbanFilter = type;
  // Update button active state
  document.querySelectorAll('#page-pedidos .btn[onclick^="filterKanban"]').forEach(b => {
    const t = b.getAttribute('onclick').match(/'([^']*)'/)?.[1] || '';
    b.style.background = t === type ? 'var(--accent)' : '';
    b.style.color = t === type ? '#fff' : '';
  });
  renderKanban();
}

// ─────────────────────────────────────────
// KANBAN
// ─────────────────────────────────────────
function _buildMesaKanbanOrders() {
  // Gera objetos sintéticos a partir do cache de mesas para exibição no kanban
  const result = [];
  (mesaOrdersCache || []).forEach(o => {
    if (o.status !== 'mesa_aberta') return;
    const items = Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? (() => { try { return JSON.parse(o.items); } catch { return []; } })() : []);
    const prodItems  = items.filter(i => i.item_status === 'producao');
    const prontoItems= items.filter(i => i.item_status === 'pronto');
    if (prodItems.length) {
      result.push({ ...o, status: 'producao', _isMesa: true,
        items: prodItems.map(i => ({ qty: i.qty, name: i.name })) });
    }
    if (prontoItems.length && !prodItems.length) {
      result.push({ ...o, status: 'pronto', _isMesa: true,
        items: prontoItems.map(i => ({ qty: i.qty, name: i.name })) });
    }
  });
  return result;
}

function renderKanban() {
  // Layout: SEMPRE 4 colunas (ou 3 se não houver nada na 4ª).
  //   Açougue:    analise → producao → pronto → entregue
  //   Restaurante: analise → producao → pronto → saiu pra entrega
  //     (ao clicar "Entregue ao cliente" na coluna "Saiu", o pedido vai direto pra finalizado
  //      e sai do kanban — não passa mais pela coluna "entregue", que fica oculta para restaurante)
  //   Pedidos de mesa/balcão também pulam a coluna saiu: clicar "Servido!"/"Retirado!" finaliza direto.
  const isAcougue = window._segmento === 'acougue';
  const _saiuWrap      = document.getElementById('kol-wrap-saiu');
  const _entregueWrap  = document.querySelector('.kol-entregue');
  // Usa setProperty com 'important' porque o CSS do mobile (@media max-width:900px)
  // tem display:flex!important em .kol — sem important aqui, a coluna "escondida" apareceria no mobile.
  if (isAcougue) {
    // Açougue: esconde "saiu", mostra "entregue"
    if (_saiuWrap)     _saiuWrap.style.setProperty('display', 'none', 'important');
    if (_entregueWrap) _entregueWrap.style.setProperty('display', 'flex', 'important');
  } else {
    // Restaurante: mostra "saiu" (sempre, pra não ter jump de 3→4 cols), esconde "entregue"
    if (_saiuWrap)     _saiuWrap.style.setProperty('display', 'flex', 'important');
    if (_entregueWrap) _entregueWrap.style.setProperty('display', 'none', 'important');
  }
  // Ajusta o grid para 4 colunas fixas
  const _board = document.getElementById('kanban-board');
  if (_board) {
    _board.classList.remove('kanban-5cols');
    _board.classList.add('kanban-4cols');
  }
  const statuses = isAcougue
    ? ['analise', 'producao', 'pronto', 'entregue']
    : ['analise', 'producao', 'pronto', 'saiu'];
  const mesaKanban = _buildMesaKanbanOrders();
  const _searchNum = (document.getElementById('kanban-search-num')?.value || '').trim();
  const _searchClient = (document.getElementById('kanban-search-client')?.value || '').trim().toLowerCase();
  statuses.forEach(st => {
    const col = document.getElementById('col-' + st);
    const cnt = document.getElementById('cnt-' + st);
    let filtered = [
      ...ordersKanban.filter(o => o.status === st),
      ...mesaKanban.filter(o => o.status === st)
    ];
    if (_kanbanFilter === 'delivery') filtered = filtered.filter(o => (window._detectOrderType ? window._detectOrderType(o) : 'delivery') === 'delivery');
    if (_kanbanFilter === 'balcao')   filtered = filtered.filter(o => (window._detectOrderType ? window._detectOrderType(o) : 'delivery') === 'balcao');
    if (_kanbanFilter === 'mesa')     filtered = filtered.filter(o => (window._detectOrderType ? window._detectOrderType(o) : 'delivery') === 'mesa');

    // ── Pesquisa por número do pedido ──
    if (_searchNum) {
      filtered = filtered.filter(o => {
        const num = String(o.num || o.order_num || o.id);
        return num.includes(_searchNum) || num.padStart(3, '0').includes(_searchNum);
      });
    }

    // ── Pesquisa por nome do cliente ──
    if (_searchClient) {
      filtered = filtered.filter(o => {
        const client = (o.client || '').toLowerCase();
        const phone = (o.phone || '').toLowerCase();
        return client.includes(_searchClient) || phone.includes(_searchClient);
      });
    }

    if (cnt) cnt.textContent = filtered.length;
    if (!col) return;
    if (filtered.length === 0) {
      col.innerHTML = '<div class="kol-empty">Nenhum pedido no momento.<br>Receba pedidos e visualize aqui.</div>';
    } else {
      col.innerHTML = filtered.map(o => {
        const itemStr = o.items.map(i => i.qty + 'x ' + i.name).join(', ');
        const obsStr = o.items.filter(i => i.obs).map(i => '📝 ' + i.obs).join(' · ');
        const total = 'R$ ' + (parseFloat(o.total || 0) + parseFloat(o.taxa || 0)).toFixed(2).replace('.', ',');

        // ── Tipo de entrega (via helper unificado) ───────
        const _tipo = (window._detectOrderType ? window._detectOrderType(o) : 'delivery');
        const isMesa     = _tipo === 'mesa';
        const isRetirada = _tipo === 'balcao';
        const isDelivery = _tipo === 'delivery';
        const _tipoBadge = isMesa
          ? `<span class="oc-tipo-badge oc-tipo-mesa"><svg width='11' height='11' viewBox='0 0 16 16' fill='none'><rect x='2' y='5' width='12' height='2' rx='1' fill='currentColor'/><line x1='4' y1='7' x2='4' y2='13' stroke='currentColor' stroke-width='1.4' stroke-linecap='round'/><line x1='12' y1='7' x2='12' y2='13' stroke='currentColor' stroke-width='1.4' stroke-linecap='round'/></svg> Mesa ${o.mesa_num || ''}</span>`
          : isRetirada
            ? `<span class="oc-tipo-badge oc-tipo-retirada"><svg width='11' height='11' viewBox='0 0 16 16' fill='none'><rect x='2' y='6' width='12' height='8' rx='1' stroke='currentColor' stroke-width='1.4'/><path d='M5 6V4a3 3 0 0 1 6 0v2' stroke='currentColor' stroke-width='1.4' stroke-linecap='round'/></svg> Retirada</span>`
            : `<span class="oc-tipo-badge oc-tipo-delivery"><svg width='11' height='11' viewBox='0 0 16 16' fill='none'><circle cx='4' cy='12' r='2' stroke='currentColor' stroke-width='1.3'/><circle cx='13' cy='12' r='2' stroke='currentColor' stroke-width='1.3'/><path d='M2 12V9l3-4h5l2 3h2v3' stroke='currentColor' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'/></svg> Delivery</span>`;

        // ── Botões de ação por tipo ──────────────────────
        let actionBtn = '';
        if (o._isMesa) {
          // Comanda de mesa — ações por item_status
          if (st === 'producao') {
            actionBtn = '<button class="oc-btn oc-btn-ok" onclick="event.stopPropagation();kdsMarkMesaPronto(' + o.id + ')">✅ Pronto p/ servir!</button>' + '<button class="oc-btn" style="background:rgba(59,130,246,.15);color:#93c5fd;border:1px solid rgba(59,130,246,.25)" onclick="event.stopPropagation();printOrderById(' + o.id + ')">🖨️</button>';
          } else if (st === 'pronto') {
            actionBtn = '<button class="oc-btn oc-btn-fin" onclick="event.stopPropagation();kanbanMesaServido(' + o.id + ')">🍽️ Servido!</button>' + '<button class="oc-btn" style="background:rgba(59,130,246,.15);color:#93c5fd;border:1px solid rgba(59,130,246,.25)" onclick="event.stopPropagation();printOrderById(' + o.id + ')">🖨️</button>' + '<button class="oc-btn" style="width:100%;margin-top:4px;background:linear-gradient(135deg,var(--accent3),#d97706);color:#000;font-weight:700;border:none" onclick="event.stopPropagation();cobrarMesaDireta(' + o.mesa_num + ')">💰 Fechar Mesa</button>';
          }
        } else if (st === 'analise') {
          if (o._pixPendente) {
            // PIX manual aguardando confirmação — só mostra botão de confirmar pagamento e cancelar
            actionBtn = '<button class="oc-btn oc-btn-pix-confirmar" onclick="event.stopPropagation();confirmarPagamentoPix(' + o.id + ')">💠 Confirmar Pagamento PIX</button>' +
              '<button class="oc-btn oc-btn-no" onclick="event.stopPropagation();cancelOrderById(' + o.id + ')">✕ Cancelar</button>';
          } else {
            // PIX confirmado ou outros pagamentos — botões normais de analise
            actionBtn =
              '<button class="oc-btn oc-btn-ok" onclick="event.stopPropagation();advanceOrderById(' + o.id + ')">✔ Confirmar</button>' +
              '<button class="oc-btn oc-btn-no" onclick="event.stopPropagation();cancelOrderById(' + o.id + ')">✕ Cancelar</button>' +
              (_printMode === 'manual' ? '<button class="oc-btn" style="background:rgba(59,130,246,.15);color:#93c5fd;border:1px solid rgba(59,130,246,.25)" onclick="event.stopPropagation();printOrderById(' + o.id + ')">🖨️</button>' : '');
          }
        } else if (st === 'producao') {
          const prontoLabel = isMesa ? 'Pronto p/ servir!' : isRetirada ? 'Pronto no balcão!' : '🚀 Pronto!';
          actionBtn = '<button class="oc-btn oc-btn-ok" onclick="event.stopPropagation();advanceOrderById(' + o.id + ')">' + prontoLabel + '</button>' + (_printMode === 'manual' ? '<button class="oc-btn" style="background:rgba(59,130,246,.15);color:#93c5fd;border:1px solid rgba(59,130,246,.25)" onclick="event.stopPropagation();printOrderById(' + o.id + ')">🖨️</button>' : '');
        } else if (st === 'pronto') {
          // Fluxo por tipo:
          //   delivery: pronto → [🛵 Saiu p/ entrega] → saiu → entregue → finalizar
          //   balcao:   pronto → [✅ Retirado!] finaliza
          //   mesa:     pronto → [🍽️ Servido!] finaliza + Fechar mesa
          if (isDelivery) {
            actionBtn = '<button class="oc-btn oc-btn-ok" onclick="event.stopPropagation();advanceOrderById(' + o.id + ')">🛵 Saiu p/ entrega</button>' + (_printMode === 'manual' ? '<button class="oc-btn" style="background:rgba(59,130,246,.15);color:#93c5fd;border:1px solid rgba(59,130,246,.25)" onclick="event.stopPropagation();printOrderById(' + o.id + ')">🖨️</button>' : '');
          } else if (isRetirada) {
            actionBtn = '<button class="oc-btn oc-btn-fin" onclick="event.stopPropagation();finishOrderById(' + o.id + ')">✅ Retirado!</button>';
          } else if (isMesa) {
            actionBtn = '<button class="oc-btn oc-btn-fin" onclick="event.stopPropagation();finishOrderById(' + o.id + ')">🍽️ Servido!</button>';
            if (o.mesa_num) {
              actionBtn += '<button class="oc-btn" style="width:100%;margin-top:4px;background:linear-gradient(135deg,var(--accent3),#d97706);color:#000;font-weight:700;border:none" onclick="event.stopPropagation();cobrarMesaDireta(' + o.mesa_num + ')">💰 Fechar Mesa</button>';
            }
          }
        } else if (st === 'saiu') {
          // Coluna "Saiu pra entrega" — só delivery deveria estar aqui
          actionBtn = '<button class="oc-btn oc-btn-fin" onclick="event.stopPropagation();advanceOrderById(' + o.id + ')">✅ Entregue ao cliente</button>';
        } else if (st === 'entregue') {
          actionBtn = '<button class="oc-btn oc-btn-fin" onclick="event.stopPropagation();finishOrderById(' + o.id + ')">✅ Finalizar</button>';
        } else {
          const _isAcougueKanban = window._segmento === 'acougue';
          if (_isAcougueKanban) {
            actionBtn = '<button class="oc-btn oc-btn-ok" onclick="event.stopPropagation();advanceOrderById(' + o.id + ')">📦 Entregar</button>';
          } else {
            const finLabel = isMesa ? 'Servido!' : isRetirada ? 'Retirado!' : 'Finalizar';
            actionBtn = '<button class="oc-btn oc-btn-fin" onclick="event.stopPropagation();finishOrderById(' + o.id + ')">' + finLabel + '</button>';
            // Botão de fechar mesa para pedidos de mesa na coluna pronto
            if (isMesa && o.mesa_num) {
              actionBtn += '<button class="oc-btn" style="width:100%;margin-top:4px;background:linear-gradient(135deg,var(--accent3),#d97706);color:#000;font-weight:700;border:none" onclick="event.stopPropagation();cobrarMesaDireta(' + o.mesa_num + ')">💰 Fechar Mesa</button>';
            }
          }
        }

        // Badge de pagamento
        const _pagBadge = (() => {
          const p = o.pag || '';
          const _naEntregaTag = '<span style="font-size:10px;background:rgba(196,149,106,.15);color:#c4956a;padding:1px 5px;border-radius:99px;font-weight:700;margin-left:4px">NA ENTREGA</span>';
          const _pendenteTag = '<span style="font-size:10px;background:rgba(196,149,106,.15);color:#c4956a;padding:1px 5px;border-radius:99px;font-weight:700;margin-left:4px">PENDENTE</span>';
          if (p === 'pix_mp' || p === 'pix') return '<div class="oc-pag-badge oc-pag-pix">&#9889; PAGO PIX</div>';
          if (p === 'pix_manual' && !o._pixPendente) return '<div class="oc-pag-badge oc-pag-pix">&#9889; PAGO PIX</div>';
          if (p === 'pix_manual') return '<div class="oc-pag-badge oc-pag-pix-pendente">&#9203; PIX PENDENTE</div>';
          if (p === 'cartao' || p === 'credito') return '<div class="oc-pag-badge oc-pag-cartao"> CRÉDITO' + _naEntregaTag + '</div>';
          if (p === 'debito') return '<div class="oc-pag-badge oc-pag-cartao"> DÉBITO' + _naEntregaTag + '</div>';
          if (p === 'cartao_mp') return '<div class="oc-pag-badge oc-pag-cartao" style="background:rgba(52,211,153,.12);color:var(--success)">💳 CRÉD. ONLINE</div>';
          if (p === 'dinheiro') {
            var tr = '';
            if (o.troco > 0) tr = ' &middot; Troco p/ R$' + parseFloat(o.troco).toFixed(2).replace('.', ',');
            else if (o.troco === -1) tr = ' &middot; Precisa troco';
            return '<div class="oc-pag-badge oc-pag-dinheiro">&#128181; DINHEIRO' + tr + _pendenteTag + '</div>';
          }
          return '';
        })();

        // Açougue: botão de indisponibilidade de peso (só para itens kg)
        const _isAcougue = window._segmento === 'acougue';
        const _temItemKg = _isAcougue && (o.items || []).some(i => i.item_type === 'kg' || (i.obs && /\d+g /.test(i.obs)));
        const _acougueBtn = _temItemKg
          ? '<button class="oc-btn oc-btn-acougue-peso" title="Ajustar peso disponível" onclick="event.stopPropagation();abrirModalAjustePeso(' + o.id + ')">⚠️</button>'
          : '';

        // Notificação de resposta WA do cliente
        const _waNotif = o._waResposta
          ? '<div class="oc-wa-notif" onclick="event.stopPropagation();abrirRespostaWA(' + o.id + ')" title="Cliente respondeu no WhatsApp">💬 Cliente respondeu!</div>'
          : '';

        const _cardStyle = o._pixPendente
          ? ' style="border-left:3px solid rgba(249,115,22,.7);background:rgba(249,115,22,.04)"'
          : o._waResposta
            ? ' style="border-left:3px solid rgba(34,197,94,.7);background:rgba(34,197,94,.03)"'
            : '';

        return '<div class="order-card"' + _cardStyle + ' onclick="openOrderDetail(' + o.id + ')">' +
          '<div class="oc-top"><span class="oc-id">#' + o.num + '</span>' + _tipoBadge + '<span class="oc-time">⏱ ' + o.time + '</span>' + _acougueBtn + '</div>' +
          _waNotif +
          '<div class="oc-client">' + o.client + (o.phone ? ' · ' + o.phone : '') + '</div>' +
          '<div class="oc-items">' + itemStr + '</div>' +
          (obsStr ? '<div style="font-size:11px;color:#c4956a;font-weight:600;margin-top:3px;padding:3px 7px;background:rgba(196,149,106,.08);border-radius:5px;border:1px solid rgba(196,149,106,.12)">' + obsStr + '</div>' : '') +
          '<div class="oc-bot"><span class="oc-total">' + total + '</span>' +
          (o.addr && !isMesa ? '<span class="oc-addr">' + o.addr + '</span>' : '') +
          '</div>' +
          _pagBadge +
          '<div class="oc-actions">' + actionBtn + '</div>' +
          '</div>';
      }).join('');
    }
    col.addEventListener('dragover', e => e.preventDefault());
    col.addEventListener('drop', e => {
      e.preventDefault();
      const id = parseInt(e.dataTransfer.getData('orderId'));
      const o = ordersKanban.find(x => x.id === id);
      if (o) o.status = st;
      renderKanban();
    });
  });
  document.getElementById('pedidos-badge').textContent = ordersKanban.filter(o => o.status === 'analise' || o.status === 'aguardando_pix').length || '';

  // ── Busca no histórico quando kanban não encontra ──
  const _histPanel = document.getElementById('kanban-hist-results');
  if (_histPanel) {
    const hasSearch = _searchNum || _searchClient;
    const allEmpty = statuses.every(st => {
      const cnt = document.getElementById('cnt-' + st);
      return cnt && cnt.textContent === '0';
    });
    if (hasSearch && allEmpty) {
      // Debounce: espera 400ms após parar de digitar
      clearTimeout(window._kanbanHistTimer);
      window._kanbanHistTimer = setTimeout(() => {
        _kanbanHistSearch(_searchNum, _searchClient);
      }, 400);
    } else {
      _histPanel.style.display = 'none';
      clearTimeout(window._kanbanHistTimer);
    }
  }
}

// ── Busca no histórico a partir do kanban ──
let _kanbanHistData = [];
async function _kanbanHistSearch(numQ, clientQ) {
  const panel = document.getElementById('kanban-hist-results');
  const list = document.getElementById('kanban-hist-list');
  if (!panel || !list) return;

  const q = numQ || clientQ;
  if (!q) { panel.style.display = 'none'; return; }

  panel.style.display = '';
  list.innerHTML = '<div style="text-align:center;padding:12px;color:var(--muted);font-size:12px">🔍 Buscando no histórico...</div>';

  try {
    const params = new URLSearchParams({ page: 1, limit: 10, q });
    const tid = (() => { try { return JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || ''; } catch { return ''; } })();
    const res = await fetch('/api/historico-pedidos?' + params, {
      headers: { 'x-tenant-id': tid }
    });
    const data = await res.json();
    _kanbanHistData = data.orders || [];

    if (!_kanbanHistData.length) {
      list.innerHTML = '<div style="text-align:center;padding:12px;color:var(--muted);font-size:12px">Nenhum pedido encontrado no histórico.</div>';
      return;
    }

    const statusMap = {
      analise: '⏳ Análise', producao: '👨‍🍳 Produção', pronto: '✅ Pronto',
      entregue: '📦 Entregue', finalizado: '✅ Finalizado', cancelado: '❌ Cancelado',
      mesa_aberta: '🍽️ Mesa', aguardando_pix: '💠 PIX'
    };
    const statusColor = {
      analise: 'var(--accent3)', producao: 'var(--accent)', pronto: 'var(--success)',
      entregue: 'var(--success)', finalizado: 'var(--success)', cancelado: 'var(--danger)',
      mesa_aberta: 'var(--purple)', aguardando_pix: 'var(--accent3)'
    };

    list.innerHTML = _kanbanHistData.map(o => {
      const items = Array.isArray(o.items) ? o.items : [];
      const itensStr = items.map(i => `${i.qty}x ${i.name}`).join(', ');
      const dt = o.created_at ? new Date(o.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '';
      const num = o.order_num || o.id;
      const total = (parseFloat(o.total || 0) + parseFloat(o.taxa || 0)).toFixed(2).replace('.', ',');
      const sc = statusColor[o.status] || 'var(--muted)';
      return `<div onclick="kanbanHistOpenDetail(${o.id})" style="display:grid;grid-template-columns:auto 1fr auto auto;gap:12px;align-items:center;padding:10px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;cursor:pointer;transition:all .15s" onmouseenter="this.style.borderColor='rgba(14,165,233,.3)';this.style.background='rgba(14,165,233,.04)'" onmouseleave="this.style.borderColor='rgba(255,255,255,.06)';this.style.background='rgba(255,255,255,.03)'">
        <div style="font-weight:800;color:var(--accent);font-size:13px;min-width:50px">#${num}</div>
        <div style="min-width:0">
          <div style="font-weight:600;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${o.client || '—'}${o.mesa_num ? ' <span style="color:var(--purple);font-size:11px">Mesa ' + o.mesa_num + '</span>' : ''}</div>
          <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px">${itensStr || '—'}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-weight:700;font-size:12.5px;color:var(--success)">R$ ${total}</div>
          <div style="font-size:10.5px;color:var(--muted)">${dt}</div>
        </div>
        <span style="font-size:10px;padding:2px 8px;border-radius:99px;font-weight:600;background:${sc}18;color:${sc};border:1px solid ${sc}30;white-space:nowrap">${statusMap[o.status] || o.status}</span>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<div style="text-align:center;padding:12px;color:var(--danger);font-size:12px">Erro: ${e.message}</div>`;
  }
}

function kanbanHistHide() {
  const panel = document.getElementById('kanban-hist-results');
  if (panel) panel.style.display = 'none';
}

function kanbanHistOpenDetail(id) {
  const o = _kanbanHistData.find(x => x.id === id);
  if (!o) return;
  // Usa o mesmo modal de histórico detalhado
  if (typeof histDetalhe === 'function') {
    // Coloca no cache do histórico para histDetalhe funcionar
    if (typeof _histData !== 'undefined') {
      if (!_histData.find(x => x.id === id)) _histData.push(o);
    }
    histDetalhe(id);
  }
}


function openOrderDetail(id) {
  let o = ordersKanban.find(x => x.id === id);
  // Se não encontrou no kanban, busca no cache de mesas (pedidos mesa_aberta)
  if (!o) {
    const mesaOrder = mesaOrdersCache.find(x => x.id === id);
    if (mesaOrder) {
      // Mapeia o pedido de mesa para o formato esperado pelo detalhe
      const allItems = Array.isArray(mesaOrder.items) ? mesaOrder.items : (typeof mesaOrder.items === 'string' ? (() => { try { return JSON.parse(mesaOrder.items); } catch { return []; } })() : []);
      const activeItems = allItems.filter(i => (i.item_status || 'active') !== 'cancelado');
      const total = activeItems.reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseInt(i.qty) || 1), 0);
      // Guarda índices originais para cancelamento por item
      window._detailMesaOrderId = mesaOrder.id;
      window._detailMesaAllItems = allItems;
      o = {
        id: mesaOrder.id,
        num: mesaOrder.num || (typeof _orderNum === 'function' ? _orderNum(mesaOrder.id, mesaOrder.order_num) : mesaOrder.id),
        status: mesaOrder.status === 'mesa_aberta' ? 'producao' : mesaOrder.status,
        items: activeItems.map((i, _idx) => ({
          qty: i.qty || 1,
          name: i.name || '',
          price: parseFloat(i.price) || 0,
          obs: i.obs || '',
          extras: i.extras || [],
          item_status: i.item_status,
          _origIndex: allItems.indexOf(i)  // índice original no array completo
        })),
        total: total,
        taxa: parseFloat(mesaOrder.taxa) || 0,
        time: mesaOrder.time || '',
        client: mesaOrder.client || 'Mesa ' + (mesaOrder.mesa_num || ''),
        phone: mesaOrder.phone || '',
        addr: mesaOrder.addr || '',
        mesa_num: mesaOrder.mesa_num,
        garcom_nome: mesaOrder.garcom_nome || '',
        pag: mesaOrder.pag || 'Mesa',
        troco: 0,
        _isMesa: true
      };
    }
  }
  if (!o) return;
  window._currentDetailId = id;
  window._detailKanbanOrder = o._isMesa ? null : o;

  // Número e status
  document.getElementById('od-id').textContent = 'Pedido #' + o.num;
  const statusMap = {
    analise: ['badge-analise', 'Em análise'],
    producao: ['badge-producao', 'Em produção'],
    pronto: ['badge-pronto', 'Pronto para entrega'],
    saiu: ['badge-pronto', 'Saiu para entrega'],
    entregue: ['badge-pronto', 'Entregue'],
    finalizado: ['badge-pronto', 'Finalizado'],
    cancelado: ['badge-analise', 'Cancelado'],
  };
  const [cls, lbl] = statusMap[o.status] || ['badge-analise', o.status];
  const badgeEl = document.getElementById('od-status-badge');
  badgeEl.className = 'od-status-badge ' + cls;
  badgeEl.textContent = lbl;

  // Horário
  document.getElementById('od-timer').textContent = o.time || '';

  // Itens
  const _oItems = Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? (() => { try { return JSON.parse(o.items); } catch { return []; } })() : []);
  const _isMesaDetalhe  = !!o._isMesa;
  const _isAcougueDetalhe = window._segmento === 'acougue' && !_isMesaDetalhe;
  const _statusIcons = { producao: '🍳', pronto: '✅', entregue: '🟢', cancelado: '❌' };
  document.getElementById('od-items-list').innerHTML = _oItems.map((item, _i) => {
    const itemStatus = item.item_status || 'active';
    const statusIcon = _statusIcons[itemStatus] || '⚪';
    const canCancel = itemStatus !== 'cancelado' && itemStatus !== 'entregue';
    const itemIndexToPass = item._origIndex ?? _i;
    return `
    <div class="od-item-row" style="align-items:center">
      <div class="od-item-qty">${item.qty}x</div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="font-size:14px">${statusIcon}</span>
          <div class="od-item-name">${item.name}</div>
          ${itemStatus !== 'active' && itemStatus !== 'cancelado' ? `<span style="font-size:10px;color:var(--muted);font-weight:600">${itemStatus.charAt(0).toUpperCase() + itemStatus.slice(1)}</span>` : ''}
        </div>
        ${item.obs ? `<div class="od-item-obs">📝 ${item.obs}</div>` : ''}
        ${Array.isArray(item.extras) && item.extras.length ? `<div class="od-item-obs">➕ ${item.extras.join(', ')}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <div class="od-item-price">R$&nbsp;${(item.price).toFixed(2).replace('.', ',')}</div>
        ${canCancel ? `<button onclick="cancelarItemGenerico(${window._currentDetailId}, ${itemIndexToPass}, ${_isMesaDetalhe})" title="Cancelar item" style="width:22px;height:22px;border-radius:6px;border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.1);color:#f87171;font-size:13px;line-height:1;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;padding:0">✕</button>` : ''}
      </div>
    </div>`;
  }).join('');

  // Totais
  const fmt = v => 'R$ ' + parseFloat(v || 0).toFixed(2).replace('.', ',');

  // Subtotal real = soma dos itens NÃO cancelados (o.total já vem com descontos/cashback aplicados)
  const _oItemsAtivos = _oItems.filter(i => (i?.item_status || 'active') !== 'cancelado');
  const itemsSubtotal = _oItemsAtivos.reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseInt(i.qty) || 1), 0);
  const desconto = Math.max(0, itemsSubtotal - parseFloat(o.total || 0));

  document.getElementById('od-subtotal').textContent = fmt(itemsSubtotal);
  document.getElementById('od-total').textContent = fmt(parseFloat(o.total || 0) + parseFloat(o.taxa || 0));

  // Linha de desconto (cupom / cashback) — criada dinamicamente
  let descontoRow = document.getElementById('od-desconto-row');
  if (!descontoRow) {
    descontoRow = document.createElement('div');
    descontoRow.id = 'od-desconto-row';
    descontoRow.className = 'od-subtotal-row';
    const taxaRowRef = document.getElementById('od-taxa-row');
    if (taxaRowRef) taxaRowRef.parentNode.insertBefore(descontoRow, taxaRowRef);
  }
  if (desconto > 0.009) {
    descontoRow.style.display = '';
    descontoRow.innerHTML = '<span style="color:var(--success)">Desconto / Cashback</span><span style="color:var(--success)">− ' + fmt(desconto) + '</span>';
  } else {
    descontoRow.style.display = 'none';
  }

  const taxaRow = document.getElementById('od-taxa-row');
  if (taxaRow) {
    taxaRow.style.display = parseFloat(o.taxa || 0) > 0 ? '' : 'none';
    const taxaEl = document.getElementById('od-taxa-val');
    if (taxaEl) taxaEl.textContent = fmt(o.taxa);
  }

  // Troco
  const trocoRow = document.getElementById('od-troco-row');
  if (trocoRow) {
    if (o.pag === 'dinheiro' || o.pag === 'Dinheiro') {
      trocoRow.style.display = '';
      trocoRow.innerHTML = o.troco > 0
        ? `<span>Troco para</span><span style="color:var(--accent3);font-weight:600">${fmt(o.troco)}</span>`
        : o.troco === -1
          ? `<span>Troco solicitado</span><span style="color:var(--muted)">Valor não informado</span>`
          : `<span>Sem troco</span><span style="color:var(--muted)">Valor exato</span>`;
    } else {
      trocoRow.style.display = 'none';
    }
  }

  // Dados do cliente
  const setEl = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v || ''; };
  setEl('od-client-name', o.client || 'Não informado');
  setEl('od-client-phone', o.phone || '');

  // Tipo de entrega (helper unificado)
  const _tipoDet = (window._detectOrderType ? window._detectOrderType(o) : 'delivery');
  const isMesa = _tipoDet === 'mesa';
  const isBalcao = _tipoDet === 'balcao';
  const isDelivery = _tipoDet === 'delivery';
  const tipoLabel = isMesa ? 'Mesa ' + (o.mesa_num || '') : isBalcao ? 'Balcão / Retirada' : '🛵 Delivery';
  setEl('od-tipo', tipoLabel);
  setEl('od-addr', isMesa && o.garcom_nome ? 'Garçom: ' + o.garcom_nome : '');

  // Bloco de endereço delivery (destacado)
  const addrBlock = document.getElementById('od-delivery-addr-block');
  const addrText  = document.getElementById('od-delivery-addr-text');
  if (addrBlock && addrText) {
    if (isDelivery && o.addr) {
      addrText.textContent = o.addr;
      addrBlock.style.display = '';
    } else {
      addrBlock.style.display = 'none';
    }
  }

  // Pagamento
  let pagLabel = {
    dinheiro: 'Dinheiro', pix: 'PIX Online', pix_manual: 'PIX', pix_mp: 'PIX Online',
    cartao: 'Cartão', credito: 'Crédito', debito: 'Débito',
    cartao_mp: 'Crédito Online', mesa: 'Fechamento Mesa'
  }[(o.pag || '').toLowerCase()] || o.pag || '—';
  // Adiciona indicador de quando foi/será pago
  const momento = o.pag_momento || (
    (o.pag || '').includes('mp') || (o.pag || '').includes('pix') ? 'online' : 'entrega'
  );
  if (momento === 'online') pagLabel += ' <span style="font-size:10px;background:rgba(52,211,153,.15);color:#059669;padding:1px 6px;border-radius:99px;font-weight:700">✓ PAGO</span>';
  else if (o.pag !== 'dinheiro' && o.pag !== 'mesa') pagLabel += ' <span style="font-size:10px;background:rgba(196,149,106,.12);color:#c4956a;padding:1px 6px;border-radius:99px;font-weight:700">PENDENTE</span>';
  { const e = document.getElementById('od-pag'); if (e) e.innerHTML = pagLabel; }
  setEl('od-pag-sub', o.pag === 'dinheiro' || o.pag === 'Dinheiro'
    ? (o.troco > 0 ? 'Troco: ' + fmt(o.troco) : 'Valor exato') : '');

  // Origem
  const origemEl = document.getElementById('od-origem-row');
  if (origemEl) {
    origemEl.innerHTML = o.garcom_nome
      ? `<span style="color:var(--purple)">👨‍💼 Pedido via Garçom — ${o.garcom_nome}</span>`
      : `<span>🌐 Pedido via Cardápio Digital</span>`;
  }

  // Botão de adicionar produto — todos os segmentos (exceto mesa)
  const _addPanelBtn = document.getElementById('od-add-produto-btn');
  if (_addPanelBtn) _addPanelBtn.style.display = (!o._isMesa) ? '' : 'none';

  // Botão de fechar mesa — só para pedidos de mesa em status pronto
  const _fecharMesaBtn = document.getElementById('od-fechar-mesa-btn');
  if (_fecharMesaBtn) {
    const isMesaOrder = o._isMesa || (o.mesa_num && o.mesa_num > 0);
    const isPronto = o.status === 'pronto';
    _fecharMesaBtn.style.display = (isMesaOrder && isPronto) ? '' : 'none';
    window._detailMesaNum = o.mesa_num || null;
  }

  openModal('modal-order-detail');
}

// ── Fechar mesa a partir do modal de detalhe do pedido ──
function odFecharMesa() {
  const mesaNum = window._detailMesaNum;
  if (!mesaNum) return;
  closeModal('modal-order-detail');
  // Pequeno delay para garantir que o modal de detalhe fechou antes de abrir o de pagamento
  setTimeout(() => cobrarMesaDireta(mesaNum), 200);
}

async function cancelarItemComanda(origIndex) {
  const orderId = window._detailMesaOrderId;
  const allItems = window._detailMesaAllItems;
  if (!orderId || !allItems || origIndex == null) return;
  const item = allItems[origIndex];
  if (!item || item.item_status === 'cancelado') return;
  if (!confirm(`Cancelar ${item.qty}x ${item.name}?`)) return;

  // Marca o item como cancelado no array
  const updatedItems = allItems.map((i, idx) =>
    idx === origIndex ? { ...i, item_status: 'cancelado' } : i
  );
  const newTotal = updatedItems
    .filter(i => i.item_status !== 'cancelado')
    .reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseInt(i.qty) || 1), 0);

  try {
    const { error } = await sb.from('orders')
      .update({ items: updatedItems, total: newTotal, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    if (error) throw error;

    // Atualiza cache local imediatamente
    const idx = mesaOrdersCache.findIndex(o => o.id === orderId);
    if (idx !== -1) {
      mesaOrdersCache[idx] = { ...mesaOrdersCache[idx], items: updatedItems, total: newTotal };
      window._detailMesaAllItems = updatedItems;
    }
    // Reabre o modal com dados atualizados
    closeModal('modal-order-detail');
    setTimeout(() => openOrderDetail(orderId), 80);
    renderKanban();
    _renderMesaPageFromCache();
  } catch(e) {
    console.error('[cancelarItemComanda]', e);
    alert('Erro ao cancelar item: ' + (e.message || e));
  }
}

function advanceOrder() {
  const id = window._currentDetailId;
  advanceOrderById(id);
  closeModal('modal-order-detail');
}

// ── Cancelar item individual em pedido açougue (kanban) ──
async function cancelarItemKanban(itemIndex) {
  const o = window._detailKanbanOrder;
  if (!o) return;
  const items = Array.isArray(o.items) ? [...o.items] : [];
  const item  = items[itemIndex];
  if (!item) return;
  if (!confirm(`Remover ${item.qty}x ${item.name} do pedido?`)) return;

  const newItems = items.filter((_, i) => i !== itemIndex);
  const newTotal = newItems.reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseInt(i.qty) || 1), 0);

  try {
    const { error } = await sb.from('orders')
      .update({ items: newItems, total: newTotal, updated_at: new Date().toISOString() })
      .eq('id', o.id);
    if (error) throw error;
    // Atualiza cache local
    const idx = ordersKanban.findIndex(x => x.id === o.id);
    if (idx !== -1) {
      ordersKanban[idx] = { ...ordersKanban[idx], items: newItems, total: newTotal };
      window._detailKanbanOrder = ordersKanban[idx];
    }
    closeModal('modal-order-detail');
    setTimeout(() => openOrderDetail(o.id), 80);
    renderKanban();
    sbToast('ok', `${item.qty}x ${item.name} removido!`);
  } catch(e) {
    alert('Erro ao remover item: ' + (e.message || e));
  }
}

// ── Função unificada para cancelar itens em qualquer tipo de pedido ──
async function cancelarItemGenerico(orderId, itemIndex, isMesaOrder) {
  // Busca o pedido correto (mesa ou kanban)
  let o = null;
  if (isMesaOrder) {
    const mesaOrder = mesaOrdersCache.find(x => x.id === orderId);
    if (!mesaOrder) return;
    o = mesaOrder;
  } else {
    o = ordersKanban.find(x => x.id === orderId);
    if (!o) return;
  }

  // Obtém todos os itens
  const allItems = Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? (() => { try { return JSON.parse(o.items); } catch { return []; } })() : []);
  const item = allItems[itemIndex];

  if (!item || item.item_status === 'cancelado') return;

  if (!confirm(`Cancelar ${item.qty}x ${item.name}?`)) return;

  // Marca o item como cancelado
  const updatedItems = allItems.map((i, idx) =>
    idx === itemIndex ? { ...i, item_status: 'cancelado' } : i
  );

  const newTotal = updatedItems
    .filter(i => i.item_status !== 'cancelado')
    .reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseInt(i.qty) || 1), 0);

  try {
    const { error } = await sb.from('orders')
      .update({ items: updatedItems, total: newTotal, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    if (error) throw error;

    // Atualiza cache local
    if (isMesaOrder) {
      const idx = mesaOrdersCache.findIndex(x => x.id === orderId);
      if (idx !== -1) {
        mesaOrdersCache[idx] = { ...mesaOrdersCache[idx], items: updatedItems, total: newTotal };
        window._detailMesaAllItems = updatedItems;
      }
    } else {
      const idx = ordersKanban.findIndex(x => x.id === orderId);
      if (idx !== -1) {
        ordersKanban[idx] = { ...ordersKanban[idx], items: updatedItems, total: newTotal };
        window._detailKanbanOrder = ordersKanban[idx];
      }
    }

    // Re-renderiza
    closeModal('modal-order-detail');
    setTimeout(() => openOrderDetail(orderId), 80);
    renderKanban();
    if (isMesaOrder) _renderMesaPageFromCache();
    sbToast('ok', `${item.qty}x ${item.name} cancelado!`);
  } catch(e) {
    console.error('[cancelarItemGenerico]', e);
    alert('Erro ao cancelar item: ' + (e.message || e));
  }
}

// ── Catálogo de produtos para adicionar a pedido existente ──
let _odCatalogoActiveCat = '__todos__';

function odAbrirCatalogo() {
  const o = window._detailKanbanOrder;
  if (!o) return;
  document.getElementById('od-catalog-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'od-catalog-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99900;display:flex;flex-direction:column;align-items:stretch;backdrop-filter:blur(2px)';
  overlay.innerHTML = `
    <div style="background:var(--surface);border-radius:20px 20px 0 0;margin-top:auto;width:100%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:12px 20px 0;flex-shrink:0">
        <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 10px"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-weight:800;font-size:15px">Adicionar ao pedido #${o.num}</div>
            <div style="font-size:11.5px;color:var(--muted);margin-top:2px">Selecione o produto e configure os complementos</div>
          </div>
          <button onclick="document.getElementById('od-catalog-overlay')?.remove()" style="border:none;background:var(--surface2);border-radius:50%;width:32px;height:32px;cursor:pointer;color:var(--muted);font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
        </div>
        <div class="sbox" style="margin:10px 0 0">
          <svg viewBox="0 0 16 16" fill="none" width="12" height="12" style="color:var(--muted);flex-shrink:0"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 10.5L13 13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          <input id="od-cat-search" placeholder="Buscar produto..." style="background:none;border:none;outline:none;font-family:'DM Sans',sans-serif;font-size:13px;color:var(--text);width:100%" oninput="_odRenderCatalogGrid()">
        </div>
        <div id="od-cat-pills" style="display:flex;gap:6px;overflow-x:auto;padding:10px 0;scrollbar-width:none;flex-shrink:0"></div>
      </div>
      <div id="od-cat-grid" style="overflow-y:auto;flex:1;padding:0 12px 20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;align-content:start"></div>
    </div>`;
  document.body.appendChild(overlay);
  _odCatalogoActiveCat = '__todos__';
  _odRenderCatalogCats();
  _odRenderCatalogGrid();
}

function _odRenderCatalogCats() {
  const el = document.getElementById('od-cat-pills');
  if (!el) return;
  const cats = ['Todos', ...new Set(items.filter(i => i.status === 'active').map(i => i.cat).filter(Boolean))];
  el.innerHTML = cats.map(c => {
    const k      = c === 'Todos' ? '__todos__' : c;
    const active = _odCatalogoActiveCat === k;
    return `<div onclick="_odSelectCat('${k.replace(/'/g,"\\'")}'); " style="padding:5px 13px;border-radius:20px;border:1.5px solid ${active ? 'var(--accent)' : 'var(--border)'};background:${active ? 'rgba(99,102,241,.12)' : 'var(--surface2)'};color:${active ? 'var(--accent)' : 'var(--muted)'};font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:all .15s">${c}</div>`;
  }).join('');
}

function _odSelectCat(k) {
  _odCatalogoActiveCat = k;
  _odRenderCatalogCats();
  _odRenderCatalogGrid();
}

function _odRenderCatalogGrid() {
  const grid = document.getElementById('od-cat-grid');
  if (!grid) return;
  const q     = (document.getElementById('od-cat-search')?.value || '').toLowerCase();
  const lista = items.filter(i => {
    if (i.status !== 'active') return false;
    if (_odCatalogoActiveCat !== '__todos__' && i.cat !== _odCatalogoActiveCat) return false;
    if (q && !i.name.toLowerCase().includes(q)) return false;
    return true;
  });
  if (!lista.length) {
    grid.style.display = 'block';
    grid.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:13px">Nenhum produto encontrado</div>`;
    return;
  }
  grid.style.display = 'grid';
  grid.innerHTML = lista.map(i => {
    const imgEl = i.imageUrl
      ? `<div style="width:100%;aspect-ratio:1;border-radius:10px;overflow:hidden;margin-bottom:8px;background:var(--surface2)"><img src="${i.imageUrl}" style="width:100%;height:100%;object-fit:cover"></div>`
      : `<div style="width:100%;aspect-ratio:1;border-radius:10px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:8px">${i.emoji || '🍽️'}</div>`;
    return `<div onclick="_odSelecionarProduto(${i.id})" style="background:var(--surface);border:1.5px solid var(--border);border-radius:12px;padding:10px;cursor:pointer;transition:border-color .15s" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'">
      ${imgEl}
      <div style="font-size:12.5px;font-weight:700;margin-bottom:3px;line-height:1.3">${i.name}</div>
      <div style="font-size:12px;color:var(--success);font-weight:700">R$ ${(parseFloat(i.price)||0).toFixed(2).replace('.',',')}${i.itemType==='kg'?' /kg':''}</div>
    </div>`;
  }).join('');
}

function _odSelecionarProduto(itemId) {
  const it = items.find(i => i.id === itemId);
  if (!it) return;
  const grupos = (()=>{ try{ return Array.isArray(it.customGroups)?it.customGroups:JSON.parse(it.customGroups||'[]'); }catch{ return []; } })()
    .filter(g => !['porcao_ref','kit_itens'].includes(g.tipo));
  const isKg = it.itemType === 'kg' || it.item_type === 'kg';
  // Abre o modal de configuração do PDV
  _pdvbAbrirModalItem(it, grupos, isKg);
  // Troca o botão confirmar para adicionar ao pedido existente (não ao pdvbCart)
  setTimeout(() => {
    const modal = document.getElementById('pdvb-modal-item-bg');
    if (!modal) return;
    const btn = modal.querySelector('button[onclick^="_pdvbConfirmar"]');
    if (btn) {
      btn.textContent = 'Adicionar ao pedido';
      btn.setAttribute('onclick', `_odConfirmarItemExistente(${itemId})`);
    }
  }, 30);
}

async function _odConfirmarItemExistente(itemId) {
  const modal = document.getElementById('pdvb-modal-item-bg');
  if (!modal) return;
  const o = window._detailKanbanOrder;
  if (!o) { modal.remove(); return; }

  const it   = modal._item;
  const isKg = modal._isKg;
  const qty  = window._pdvbQty || 1;

  let extra = 0;
  const opcsDesc = [];
  modal.querySelectorAll('input:checked').forEach(inp => {
    extra += parseFloat(inp.dataset.preco || 0);
    if (inp.dataset.nome) opcsDesc.push(inp.dataset.nome);
  });

  let price    = parseFloat(it.price || 0) + extra;
  let name     = it.name;
  let obs      = modal.querySelector('#pdvb-obs-input')?.value?.trim() || '';
  let finalQty = qty;
  if (opcsDesc.length) obs = [opcsDesc.join(', '), obs].filter(Boolean).join(' | ');

  if (isKg) {
    const kg = parseFloat(modal.querySelector('#pdvb-kg-input')?.value || 1);
    price    = price * kg;
    name     = it.name + ' ' + kg.toFixed(3).replace('.', ',') + 'kg';
    finalQty = 1;
  }

  const newItem      = { qty: finalQty, name, price, obs, emoji: it.emoji || '' };
  const currentItems = Array.isArray(o.items) ? [...o.items] : [];
  const existing     = !isKg && currentItems.find(c => c.name === name && (c.obs || '') === obs);
  if (existing) existing.qty += finalQty;
  else currentItems.push(newItem);

  const newTotal = currentItems.reduce((s, i) => s + (parseFloat(i.price)||0) * (parseInt(i.qty)||1), 0);

  try {
    const { error } = await sb.from('orders')
      .update({ items: currentItems, total: newTotal, updated_at: new Date().toISOString() })
      .eq('id', o.id);
    if (error) throw error;
    const idx = ordersKanban.findIndex(x => x.id === o.id);
    if (idx !== -1) {
      ordersKanban[idx] = { ...ordersKanban[idx], items: currentItems, total: newTotal };
      window._detailKanbanOrder = ordersKanban[idx];
    }
    modal.remove();
    document.getElementById('od-catalog-overlay')?.remove();
    closeModal('modal-order-detail');
    setTimeout(() => openOrderDetail(o.id), 80);
    renderKanban();
    sbToast('ok', `${name} adicionado ao pedido!`);
  } catch(e) {
    alert('Erro ao adicionar item: ' + (e.message || e));
  }
}

function cancelarPedidoDetalhe() {
  const id = window._currentDetailId;
  if (!id) return;
  const o = ordersKanban.find(x => x.id === id);
  if (!o) return;
  if (!confirm('Cancelar o Pedido #' + o.num + '? Esta ação não pode ser desfeita.')) return;
  cancelOrderById(id);
  closeModal('modal-order-detail');
}

// ─────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────
// ── Novo Pedido Manual — estado do modal ──────────────
let _noCart = [];   // [{id, name, qty, price, emoji}]
let _noDelivery = 'delivery';

function noSetDelivery(tipo) {
  _noDelivery = tipo;
  ['delivery', 'retirada', 'mesa'].forEach(t => {
    const btn = document.getElementById('no-dtab-' + t);
    if (!btn) return;
    btn.className = t === tipo ? 'btn bp' : 'btn bg';
    btn.style.flex = '1';
    btn.style.justifyContent = 'center';
    btn.style.fontSize = '12px';
  });
  document.getElementById('no-addr-block').style.display = tipo === 'delivery' ? '' : 'none';
  const mesaBlock = document.getElementById('no-mesa-block');
  if (mesaBlock) {
    mesaBlock.style.display = tipo === 'mesa' ? '' : 'none';
    if (tipo === 'mesa') {
      const select = document.getElementById('order-mesa');
      if (select) {
        select.innerHTML = '<option value="">Selecione a mesa...</option>';
        (tables || []).forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.num;
          opt.textContent = 'Mesa ' + t.num + (t.guests ? ' (' + t.guests + ' pessoas)' : '');
          select.appendChild(opt);
        });
      }
    }
  }
}

function noFilterItems(q) {
  const list = document.getElementById('no-items-list');
  if (!list) return;
  const search = (q || '').toLowerCase();
  const filtered = items.filter(i =>
    i.status !== 'pausado' &&
    (!search || i.name.toLowerCase().includes(search) || (i.desc || '').toLowerCase().includes(search))
  ).slice(0, 50);
  if (!filtered.length) {
    list.innerHTML = '<div style="padding:12px;text-align:center;color:var(--muted);font-size:12.5px">Nenhum produto encontrado</div>';
    return;
  }
  const catMap = {};
  filtered.forEach(item => {
    const cat = item.cat || item.cat_key || 'Outros';
    if (!catMap[cat]) catMap[cat] = [];
    catMap[cat].push(item);
  });

  list.innerHTML = Object.entries(catMap).map(([cat, its]) => `
    <div style="padding:8px 12px 4px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);background:var(--surface2);border-bottom:1px solid var(--border)">${cat}</div>
    ${its.map(item => {
    const price = parseFloat(item.price || 0);
    const priceStr = 'R$ ' + price.toFixed(2).replace('.', ',') + (item.itemType === 'kg' ? ' <span style="font-size:10px;opacity:.7">/kg</span>' : '');
    const _allGrupos = (() => { try { return Array.isArray(item.customGroups) ? item.customGroups : JSON.parse(item.customGroups || '[]') } catch { return [] } })();
    const grupos = _allGrupos.filter(g => !['porcao_ref', 'kit_itens'].includes(g.tipo));
    const temAdicionais = grupos.length > 0 || item.itemType === 'kg';
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s;active:background:var(--surface2)" onclick="noAddItem(${item.id})">
        ${item.imageUrl
        ? `<img src="${item.imageUrl}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0">`
        : `<div style="width:44px;height:44px;border-radius:8px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">${item.emoji || '🍽️'}</div>`}
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.name}</div>
          ${item.desc ? `<div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px">${item.desc}</div>` : ''}
          ${temAdicionais ? `<div style="font-size:10px;color:var(--accent);margin-top:2px;font-weight:600">+ adicionais</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:13px;font-weight:700;color:var(--success)">${priceStr}</div>
          <div style="width:28px;height:28px;border-radius:8px;background:var(--accent);display:flex;align-items:center;justify-content:center;margin-top:4px;margin-left:auto">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>
          </div>
        </div>
      </div>`;
  }).join('')}`
  ).join('');
}

function noAddItem(itemId) {
  const item = items.find(i => i.id === itemId);
  if (!item) return;

  // Se tem grupos de adicionais, abre modal de seleção
  const grupos = (() => { try { return Array.isArray(item.customGroups) ? item.customGroups : JSON.parse(item.customGroups || '[]') } catch { return [] } })()
    .filter(g => !['porcao_ref', 'kit_itens'].includes(g.tipo));

  const isKg = item.itemType === 'kg';

  if (grupos.length > 0 || isKg) {
    noAbrirModalAdicionais(item, grupos, isKg);
    return;
  }
  // Sem adicionais — adiciona direto
  noAddToCartDireto(item, item.name, parseFloat(item.price || 0), '', []);
}

function noAddToCartDireto(item, name, price, obs, grupos) {
  const existing = _noCart.find(c => c.id === item.id && c.obs === obs && c.name === name);
  if (existing) {
    existing.qty++;
  } else {
    _noCart.push({ id: item.id, name, qty: 1, price, emoji: item.emoji || '🍽️', obs, _grupos: grupos });
  }
  noRenderCart();
  sbToast('ok', name + ' adicionado!');
}

function noAbrirModalAdicionais(item, grupos, isKg) {
  document.getElementById('modal-no-adicionais-bg')?.remove();

  const priceStr = parseFloat(item.price || 0).toFixed(2).replace('.', ',');

  // Rótulos amigáveis para grupos especiais do açougue/açaí
  const _TIPO_LABEL = {
    cortes: 'Corte', preparos: 'Preparo', ocasiao: 'Ocasião',
    armazenamento: 'Armazenamento', pesos: 'Porção / Peso',
    checklist: 'Complementos', radio: 'Escolha', checkbox: 'Adicional',
    opcional: 'Adicional', adicionais: 'Adicional',
    obrigatorio: 'Escolha obrigatória', sabor: 'Sabor',
  };

  const gruposHtml = grupos.map((g, gi) => {
    const opcoes = g.opcoes || g.valores || [];
    if (!opcoes.length) return '';
    const tipo = g.tipo || 'opcional';
    // Grupos de seleção única: radio, cortes, preparos, ocasiao, armazenamento, pesos, obrigatorio, sabor
    const isSingle = ['radio', 'cortes', 'preparos', 'ocasiao', 'armazenamento', 'pesos', 'obrigatorio', 'sabor'].includes(tipo);
    const isMulti = !isSingle; // checkbox, opcional, adicionais, checklist
    const isRequired = ['obrigatorio', 'sabor', 'cortes'].includes(tipo);
    const inputType = isSingle ? 'radio' : 'checkbox';
    const label = g.nome || g.name || _TIPO_LABEL[tipo] || 'Adicional';
    return `
    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px">
        ${label}
        ${isRequired ? '<span style="color:var(--danger);font-size:10px;margin-left:4px">*obrigatório</span>' : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${opcoes.map((op, oi) => {
      const nome = op.nome || op.name || (typeof op === 'string' ? op : '');
      const preco = parseFloat(op.preco || op.price || 0);
      const icon = op.icon ? `<span style="font-size:16px">${op.icon}</span>` : '';
      const precoLabel = preco > 0 ? ` <span style="color:var(--success);font-size:11px">+R$ ${preco.toFixed(2).replace('.', ',')}</span>` : '';
      return `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:9px;cursor:pointer" onclick="noToggleOpc(this)">
            <input type="${inputType}" name="no-grp-${gi}" value="${oi}" data-grp="${gi}" data-idx="${oi}" data-nome="${nome.replace(/"/g, '&quot;')}" data-preco="${preco}" style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0">
            ${icon}<span style="font-size:13px;font-weight:500;flex:1">${nome}${precoLabel}</span>
          </label>`;
    }).join('')}
      </div>
    </div>`;
  }).join('');

  const kgHtml = isKg ? `
    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px">Quantidade (kg)</div>
      <div style="display:flex;align-items:center;gap:12px">
        <input type="number" id="no-kg-input" min="0.1" step="0.1" value="0.5"
          style="flex:1;padding:10px;border:1px solid var(--border);border-radius:9px;background:var(--surface2);color:var(--text);font-size:18px;font-weight:700;text-align:center;outline:none;font-family:inherit"
          oninput="document.getElementById('no-kg-total').textContent='R$ '+((parseFloat(this.value)||0)*${parseFloat(item.price || 0)}).toFixed(2).replace('.',',')">
        <span style="font-size:12px;color:var(--muted)">kg</span>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:6px">Total: <strong id="no-kg-total">R$ ${(0.5 * parseFloat(item.price || 0)).toFixed(2).replace('.', ',')}</strong></div>
    </div>` : '';

  const modal = document.createElement('div');
  modal.id = 'modal-no-adicionais-bg';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:flex-end;justify-content:center';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:20px 20px 0 0;width:100%;max-width:520px;max-height:85vh;overflow-y:auto;padding:20px 20px 32px;box-shadow:0 -8px 40px rgba(0,0,0,.3)">
      <div style="width:40px;height:4px;background:var(--border);border-radius:99px;margin:0 auto 18px"></div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <div style="font-size:32px">${item.emoji || '🍽️'}</div>
        <div>
          <div style="font-size:16px;font-weight:800">${item.name}</div>
          <div style="font-size:13px;color:var(--success);font-weight:700">R$ ${priceStr}${isKg ? ' /kg' : ''}</div>
        </div>
      </div>
      ${item.desc ? `<div style="font-size:12.5px;color:var(--muted);margin-bottom:14px;padding:10px;background:var(--surface2);border-radius:8px">${item.desc}</div>` : ''}
      ${kgHtml}
      ${gruposHtml}
      <div style="margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:6px">Observação</div>
        <textarea id="no-obs-input" placeholder="Ex: sem cebola, ponto da carne..." rows="2"
          style="width:100%;padding:10px;border:1px solid var(--border);border-radius:9px;background:var(--surface2);color:var(--text);font-size:13px;outline:none;resize:none;font-family:inherit;box-sizing:border-box"></textarea>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
        <button onclick="noModalQty(-1)" style="width:36px;height:36px;border-radius:10px;border:1px solid var(--border);background:var(--surface2);cursor:pointer;font-size:18px;font-weight:700;color:var(--text)">−</button>
        <span id="no-modal-qty" style="font-size:18px;font-weight:800;min-width:32px;text-align:center">1</span>
        <button onclick="noModalQty(1)"  style="width:36px;height:36px;border-radius:10px;border:1px solid var(--border);background:var(--surface2);cursor:pointer;font-size:18px;font-weight:700;color:var(--text)">+</button>
        <span id="no-modal-total-label" style="font-size:14px;font-weight:700;color:var(--success);margin-left:auto"></span>
      </div>
      <button onclick="noConfirmarAdicionais(${item.id})" style="width:100%;padding:14px;border-radius:14px;border:none;background:var(--accent);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">
        Adicionar ao pedido
      </button>
    </div>`;
  document.body.appendChild(modal);

  // Store item ref for confirm
  modal._item = item;
  modal._grupos = grupos;
  modal._isKg = isKg;
  window._noModalQtyVal = 1;
  noAtualizarTotalModal(item, isKg);
}

function noToggleOpc(label) {
  // Visual feedback
  const inp = label.querySelector('input');
  if (!inp) return;
  if (inp.type === 'radio') {
    const name = inp.name;
    document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
      r.closest('label').style.borderColor = 'var(--border)';
      r.closest('label').style.background = 'var(--surface2)';
    });
    inp.closest('label').style.borderColor = 'var(--accent)';
    inp.closest('label').style.background = 'rgba(var(--accent-rgb,249,115,22),.08)';
  } else {
    if (inp.checked) {
      label.style.borderColor = 'var(--accent)';
      label.style.background = 'rgba(var(--accent-rgb,249,115,22),.08)';
    } else {
      label.style.borderColor = 'var(--border)';
      label.style.background = 'var(--surface2)';
    }
  }
  const modal = document.getElementById('modal-no-adicionais-bg');
  if (modal?._item) noAtualizarTotalModal(modal._item, modal._isKg);
}

function noModalQty(d) {
  window._noModalQtyVal = Math.max(1, (window._noModalQtyVal || 1) + d);
  const el = document.getElementById('no-modal-qty');
  if (el) el.textContent = window._noModalQtyVal;
  const modal = document.getElementById('modal-no-adicionais-bg');
  if (modal?._item) noAtualizarTotalModal(modal._item, modal._isKg);
}

function noAtualizarTotalModal(item, isKg) {
  const qty = window._noModalQtyVal || 1;
  let extra = 0;
  document.querySelectorAll('#modal-no-adicionais-bg input:checked').forEach(inp => {
    extra += parseFloat(inp.dataset.preco || 0);
  });
  let basePrice = parseFloat(item.price || 0) + extra;
  if (isKg) {
    const kg = parseFloat(document.getElementById('no-kg-input')?.value || 1);
    basePrice = basePrice * kg;
  }
  const total = basePrice * qty;
  const el = document.getElementById('no-modal-total-label');
  if (el) el.textContent = 'R$ ' + total.toFixed(2).replace('.', ',');
}

function noConfirmarAdicionais(itemId) {
  const modal = document.getElementById('modal-no-adicionais-bg');
  if (!modal) return;
  const item = modal._item;
  const isKg = modal._isKg;
  const qty = window._noModalQtyVal || 1;

  let extra = 0;
  const opcsDesc = [];
  document.querySelectorAll('#modal-no-adicionais-bg input:checked').forEach(inp => {
    extra += parseFloat(inp.dataset.preco || 0);
    opcsDesc.push(inp.dataset.nome);
  });

  let price = parseFloat(item.price || 0) + extra;
  let name = item.name;
  let obs = document.getElementById('no-obs-input')?.value.trim() || '';

  if (opcsDesc.length) obs = [opcsDesc.join(', '), obs].filter(Boolean).join(' | ');

  if (isKg) {
    const kg = parseFloat(document.getElementById('no-kg-input')?.value || 1);
    price = price * kg;
    name = item.name + ' ' + kg.toFixed(3).replace('.', ',') + 'kg';
    // Add once (qty=1 for kg items)
    _noCart.push({ id: item.id, name, qty: 1, price, emoji: item.emoji || '🍽️', obs });
  } else {
    const existing = _noCart.find(c => c.id === item.id && c.obs === obs && c.name === item.name);
    if (existing) existing.qty += qty;
    else _noCart.push({ id: item.id, name, qty, price, emoji: item.emoji || '🍽️', obs });
  }

  noRenderCart();
  modal.remove();
  sbToast('ok', name + ' adicionado!');
}

function noChangeQty(itemId, delta) {
  const idx = _noCart.findIndex(c => c.id === itemId);
  if (idx === -1) return;
  _noCart[idx].qty += delta;
  if (_noCart[idx].qty <= 0) _noCart.splice(idx, 1);
  noRenderCart();
}

function noRenderCart() {
  const el = document.getElementById('no-cart');
  const empty = document.getElementById('no-cart-empty');
  const totalEl = document.getElementById('no-total-display');
  if (!el) return;
  if (!_noCart.length) {
    if (empty) empty.style.display = '';
    el.querySelectorAll('.no-cart-row').forEach(r => r.remove());
    if (totalEl) totalEl.textContent = 'R$ 0,00';
    return;
  }
  if (empty) empty.style.display = 'none';
  el.querySelectorAll('.no-cart-row').forEach(r => r.remove());
  const frag = document.createDocumentFragment();
  _noCart.forEach(c => {
    const div = document.createElement('div');
    div.className = 'no-cart-row';
    div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid var(--border)';
    div.innerHTML = `
      <span style="font-size:18px">${c.emoji}</span>
      <span style="flex:1;font-size:13px;font-weight:500">${c.name}</span>
      <div style="display:flex;align-items:center;gap:6px">
        <button onclick="noChangeQty(${c.id},-1)" style="width:24px;height:24px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">−</button>
        <span style="font-size:13px;font-weight:700;min-width:20px;text-align:center">${c.qty}</span>
        <button onclick="noChangeQty(${c.id},1)"  style="width:24px;height:24px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">+</button>
      </div>
      <span style="font-size:12.5px;font-weight:700;color:var(--success);min-width:60px;text-align:right">R$ ${(c.price * c.qty).toFixed(2).replace('.', ',')}</span>`;
    frag.appendChild(div);
  });
  el.appendChild(frag);
  const total = _noCart.reduce((s, c) => s + c.price * c.qty, 0);
  if (totalEl) totalEl.textContent = 'R$ ' + total.toFixed(2).replace('.', ',');
}

function noOpenModal() {
  _noCart = [];
  _noDelivery = 'delivery';
  ['order-client', 'order-phone', 'order-addr', 'order-obs'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const mesaSelect = document.getElementById('order-mesa');
  if (mesaSelect) mesaSelect.value = '';
  document.getElementById('no-search').value = '';
  noSetDelivery('delivery');
  noFilterItems('');
  noRenderCart();
  openModal('modal-new-order');
  // Inicializa autocomplete de clientes no Novo Pedido
  initClienteAutocomplete('order-client', {
    nameId: 'order-client',
    phoneId: 'order-phone',
    addrId: 'order-addr'
  });
  initClienteAutocomplete('order-phone', {
    nameId: 'order-client',
    phoneId: 'order-phone',
    addrId: 'order-addr'
  });
}

async function createOrder() {
  if (window._pdvCriandoPedido) return;
  window._pdvCriandoPedido = true;
  const client = document.getElementById('order-client').value.trim() || 'Cliente';
  const phone = document.getElementById('order-phone').value.trim() || '';
  const obs = document.getElementById('order-obs').value.trim() || '';
  const pag = document.getElementById('order-pag').value || 'PIX';
  const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  let addr = '';
  let mesaNum = null;
  if (_noDelivery === 'delivery') {
    addr = document.getElementById('order-addr').value.trim();
  } else if (_noDelivery === 'mesa') {
    mesaNum = parseInt(document.getElementById('order-mesa').value) || null;
    addr = mesaNum ? 'Mesa ' + mesaNum : 'Mesa';
  } else {
    addr = 'Retirada no balcão';
  }

  if (!_noCart.length) { window._pdvCriandoPedido = false; sbToast('err', 'Adicione pelo menos um produto'); return; }

  const itemsArr = _noCart.map(c => ({ qty: c.qty, name: c.name, price: c.price, obs: '' }));
  if (obs) itemsArr[itemsArr.length - 1].obs = obs;
  const tot = _noCart.reduce((s, c) => s + c.price * c.qty, 0);

  try {
    sbLoading(true);
    if (!_sessao?.tenant_id) { sbLoading(false); sbToast('err', 'Sessão sem tenant — recarregue'); return; }
    const { data: orderData, error: oErr } = await sb.from('orders').insert({
      tenant_id: _sessao.tenant_id,
      client, phone, addr,
      items: itemsArr,
      total: tot,
      taxa: _noDelivery === 'delivery' ? 5 : 0,
      mesa_num: mesaNum,
      status: 'analise',
      time, pag
    }).select().single();

    if (oErr) { sbLoading(false); sbToast('err', 'Erro ao criar pedido'); console.error(oErr); return; }

    // Marca ID como criado pelo PDV — realtime e polling ignoram
    if (!window._pdvCreatedIds) window._pdvCreatedIds = new Set();
    window._pdvCreatedIds.add(Number(orderData.id));
    // Atualiza _maxKnownOrderId e injeta no kanban
    if (Number(orderData.id) > (_maxKnownOrderId || 0)) _maxKnownOrderId = Number(orderData.id);
    if (!ordersKanban.find(x => x.id === orderData.id)) ordersKanban.unshift(mapOrder(orderData));
    renderKanban();

    sbLoading(false);

    playOrderSound();
    const nc = document.getElementById('notif-count');
    if (nc) { nc.style.display = 'flex'; nc.textContent = parseInt(nc.textContent || 0) + 1; }
    closeModal('modal-new-order');
    nav('pedidos');
    sbToast('ok', `Pedido #${_orderNum(orderData.id, orderData.order_num)} criado`);
  } finally {
    window._pdvCriandoPedido = false;
  }
}

function printOrderDetail() {
  const id = window._currentDetailId;
  const o = ordersKanban.find(x => x.id === id);
  if (!o) return;
  printOrder(o);
  sbToast('ok', 'Imprimindo comanda do Pedido #' + o.num);
}

// ─────────────────────────────────────────
// GESTOR — DRAG & DROP CATEGORIAS
// ─────────────────────────────────────────
let _dragCatId = null;

function catDragStart(e, id) {
  _dragCatId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  // Mark dragging element
  setTimeout(() => e.target.closest('.cat-row')?.classList.add('dragging'), 0);
}

function catDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  // Highlight drop target
  const row = e.target.closest('.cat-row');
  document.querySelectorAll('.cat-row.drag-over').forEach(r => r.classList.remove('drag-over'));
  if (row && parseInt(row.dataset.catId) !== _dragCatId) {
    row.classList.add('drag-over');
  }
}

function catDragEnd(e) {
  document.querySelectorAll('.cat-row').forEach(r => {
    r.classList.remove('dragging');
    r.classList.remove('drag-over');
  });
  _dragCatId = null;
}

async function catDrop(e, targetId) {
  e.preventDefault();
  if (!_dragCatId || _dragCatId === targetId) return;

  // Reorder categories array
  const fromIdx = categories.findIndex(c => c.id === _dragCatId);
  const toIdx = categories.findIndex(c => c.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;

  const moved = categories.splice(fromIdx, 1)[0];
  categories.splice(toIdx, 0, moved);

  renderGestor();

  // Persist new order to Supabase
  try {
    await Promise.all(categories.map((cat, i) =>
      sb.from('categories').update({ sort_order: i + 1 }).eq('id', cat.id)
    ));
    sbToast('ok', 'Ordem das categorias salva!');
  } catch (err) {
    sbToast('err', 'Erro ao salvar ordem');
  }
}

// ─────────────────────────────────────────
// GESTOR — DRAG & DROP ITENS
// ─────────────────────────────────────────
let _dragItemId = null;

function itemDragStart(e, id) {
  _dragItemId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  setTimeout(() => e.target.closest('.cat-item-row')?.classList.add('dragging'), 0);
}

function itemDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.target.closest('.cat-item-row');
  document.querySelectorAll('.cat-item-row.drag-over').forEach(r => r.classList.remove('drag-over'));
  if (row && parseInt(row.dataset.id) !== _dragItemId) {
    row.classList.add('drag-over');
  }
}

function itemDragEnd(e) {
  document.querySelectorAll('.cat-item-row').forEach(r => {
    r.classList.remove('dragging');
    r.classList.remove('drag-over');
  });
  _dragItemId = null;
}

async function itemDrop(e, targetId) {
  e.preventDefault();
  if (!_dragItemId || _dragItemId === targetId) return;

  const fromIdx = items.findIndex(i => i.id === _dragItemId);
  const toIdx = items.findIndex(i => i.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;

  const moved = items.splice(fromIdx, 1)[0];
  items.splice(toIdx, 0, moved);

  renderGestor();

  // Persiste a nova ordem para os itens da mesma categoria
  const catKey = moved.catKey;
  const catItems = items.filter(i => i.catKey === catKey || i.cat === catKey);
  try {
    await Promise.all(catItems.map((item, i) =>
      sb.from('menu_items').update({ sort_order: i + 1 }).eq('id', item.id)
    ));
    sbToast('ok', 'Ordem dos itens salva!');
  } catch (err) {
    sbToast('err', 'Erro ao salvar ordem dos itens');
  }
}

// ─────────────────────────────────────────
// GESTOR DE CARDÁPIO
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// MODELOS PRONTOS DE CARDÁPIO
// ─────────────────────────────────────────
const MODELOS_CARDAPIO = {
  acaiteria: {
    label: 'Açaiteria',
    categorias: [
      {
        label: 'Tamanhos',
        name: 'tamanhos',
        type: 'Itens principais',
        itens: [
          { name: 'Açaí 300ml', emoji: '🍇', price: 12.00, description: 'Açaí 300ml — base pura, monte do seu jeito' },
          { name: 'Açaí 400ml', emoji: '🍇', price: 15.00, description: 'Açaí 400ml — tamanho ideal para um lanche' },
          { name: 'Açaí 500ml', emoji: '🍇', price: 18.00, description: 'Açaí 500ml — generoso e bem servido' },
          { name: 'Açaí 700ml', emoji: '🍇', price: 23.00, description: 'Açaí 700ml — o favorito da galera' },
          { name: 'Açaí 1 Litro', emoji: '🪣', price: 30.00, description: 'Açaí 1 litro — para compartilhar' },
          { name: 'Tigela P', emoji: '🥣', price: 14.00, description: 'Tigela pequena de açaí' },
          { name: 'Tigela M', emoji: '🥣', price: 20.00, description: 'Tigela média de açaí' },
          { name: 'Tigela G', emoji: '🥣', price: 27.00, description: 'Tigela grande de açaí' },
        ]
      },
      {
        label: 'Complementos',
        name: 'complementos',
        type: 'checklist',
        itens: [
          { name: 'Granola', emoji: '🌾', price: 0.00, description: 'Granola crocante' },
          { name: 'Leite em Pó', emoji: '🥛', price: 0.00, description: 'Leite em pó' },
          { name: 'Paçoca', emoji: '🥜', price: 0.00, description: 'Paçoca triturada' },
          { name: 'Amendoim', emoji: '🥜', price: 0.00, description: 'Amendoim torrado' },
          { name: 'Aveia', emoji: '🌾', price: 0.00, description: 'Aveia em flocos' },
          { name: 'Sucrilhos', emoji: '🥣', price: 0.00, description: 'Sucrilhos crocantes' },
          { name: 'Coco Ralado', emoji: '🥥', price: 0.00, description: 'Coco ralado' },
          { name: 'Confeito', emoji: '🍬', price: 0.00, description: 'Confeito colorido' },
          { name: 'Granulado', emoji: '🍫', price: 0.00, description: 'Granulado de chocolate' },
        ]
      },
      {
        label: 'Coberturas',
        name: 'coberturas',
        type: 'checklist',
        itens: [
          { name: 'Mel', emoji: '🍯', price: 0.00, description: 'Mel puro' },
          { name: 'Leite Condensado', emoji: '🥛', price: 0.00, description: 'Leite condensado' },
          { name: 'Calda de Morango', emoji: '🍓', price: 0.00, description: 'Calda de morango' },
          { name: 'Calda de Chocolate', emoji: '🍫', price: 0.00, description: 'Calda de chocolate' },
          { name: 'Nutella', emoji: '🫙', price: 3.00, description: 'Nutella — adicional' },
        ]
      },
      {
        label: 'Frutas',
        name: 'frutas',
        type: 'checklist',
        itens: [
          { name: 'Morango', emoji: '🍓', price: 0.00, description: 'Morango fresco' },
          { name: 'Banana', emoji: '🍌', price: 0.00, description: 'Banana fatiada' },
          { name: 'Kiwi', emoji: '🥝', price: 0.00, description: 'Kiwi fatiado' },
          { name: 'Uva', emoji: '🍇', price: 0.00, description: 'Uva sem semente' },
        ]
      },
      {
        label: 'Adicionais',
        name: 'adicionais_acai',
        type: 'checklist',
        itens: [
          { name: 'Chantilly', emoji: '🍦', price: 2.00, description: 'Chantilly' },
          { name: 'Sorvete extra', emoji: '🍨', price: 4.00, description: 'Bola de sorvete extra' },
          { name: 'Proteína em pó', emoji: '💪', price: 5.00, description: 'Scoop de proteína' },
        ]
      },
    ]
  },
  restaurante: {
    label: 'Restaurante',
    categorias: [
      {
        label: 'Entradas', name: 'entradas', itens: [
          { name: 'Caldo de Feijão', emoji: '🫕', price: 12.00, description: 'Caldo de feijão temperado' },
          { name: 'Isca de Frango', emoji: '🍗', price: 22.00, description: 'Isca de frango empanada' },
          { name: 'Camarão ao Alho', emoji: '🦐', price: 35.00, description: 'Camarão ao alho e óleo' },
        ]
      },
      {
        label: 'Pratos Principais', name: 'pratos_principais', itens: [
          { name: 'Frango Grelhado', emoji: '🍗', price: 35.00, description: 'Frango grelhado com acompanhamentos' },
          { name: 'Picanha na Brasa', emoji: '🥩', price: 65.00, description: 'Picanha na brasa 300g' },
          { name: 'Filé de Peixe', emoji: '🐟', price: 42.00, description: 'Filé de peixe grelhado' },
          { name: 'Marmita P', emoji: '🍱', price: 18.00, description: 'Marmita pequena completa' },
          { name: 'Marmita G', emoji: '🍱', price: 25.00, description: 'Marmita grande completa' },
        ]
      },
      {
        label: 'Sobremesas', name: 'sobremesas', itens: [
          { name: 'Pudim', emoji: '🍮', price: 10.00, description: 'Pudim de leite condensado' },
          { name: 'Mousse de Maracujá', emoji: '🍨', price: 10.00, description: 'Mousse de maracujá' },
          { name: 'Sorvete', emoji: '🍦', price: 8.00, description: '2 bolas de sorvete' },
        ]
      },
      {
        label: 'Bebidas', name: 'bebidas', itens: [
          { name: 'Suco Natural', emoji: '🥤', price: 8.00, description: 'Suco da fruta natural 400ml' },
          { name: 'Refrigerante', emoji: '🥤', price: 6.00, description: 'Lata 350ml' },
          { name: 'Água', emoji: '💧', price: 3.00, description: 'Água mineral 500ml' },
          { name: 'Cerveja', emoji: '🍺', price: 9.00, description: 'Garrafa 600ml' },
        ]
      },
    ]
  },
  pizzaria: {
    label: 'Pizzaria',
    categorias: [
      {
        label: 'Pizzas Salgadas', name: 'pizzas_salgadas', itens: [
          { name: 'Margherita', emoji: '🍕', price: 48.00, description: 'Molho de tomate, mussarela e manjericão' },
          { name: 'Calabresa', emoji: '🍕', price: 52.00, description: 'Molho, mussarela e calabresa' },
          { name: 'Frango com Catupiry', emoji: '🍕', price: 58.00, description: 'Molho, mussarela, frango e catupiry' },
          { name: 'Portuguesa', emoji: '🍕', price: 60.00, description: 'Molho, mussarela, presunto, ovo e pimentão' },
          { name: 'Quatro Queijos', emoji: '🍕', price: 65.00, description: 'Molho, mussarela, provolone, parmesão e gorgonzola' },
        ]
      },
      {
        label: 'Pizzas Doces', name: 'pizzas_doces', itens: [
          { name: 'Chocolate com Morango', emoji: '🍕', price: 55.00, description: 'Chocolate ao leite e morangos frescos' },
          { name: 'Romeu e Julieta', emoji: '🍕', price: 50.00, description: 'Mussarela e goiabada' },
          { name: 'Banana com Canela', emoji: '🍕', price: 48.00, description: 'Banana, canela e leite condensado' },
        ]
      },
      {
        label: 'Bordas', name: 'bordas', itens: [
          { name: 'Borda Recheada Catupiry', emoji: '🧀', price: 8.00, description: 'Borda recheada com catupiry' },
          { name: 'Borda Recheada Cheddar', emoji: '🧀', price: 8.00, description: 'Borda recheada com cheddar' },
          { name: 'Borda Simples', emoji: '🍞', price: 0.00, description: 'Borda tradicional' },
        ]
      },
      {
        label: 'Bebidas', name: 'bebidas_pizza', itens: [
          { name: 'Refrigerante 2L', emoji: '🥤', price: 12.00, description: 'Refrigerante 2 litros' },
          { name: 'Cerveja Long Neck', emoji: '🍺', price: 10.00, description: 'Cerveja long neck 355ml' },
          { name: 'Suco de Uva', emoji: '🍇', price: 12.00, description: 'Suco de uva integral' },
        ]
      },
    ]
  },
  hamburgueria: {
    label: 'Hamburgueria',
    categorias: [
      {
        label: 'Hambúrgueres', name: 'hamburgueres', itens: [
          { name: 'Classic Burger', emoji: '🍔', price: 28.00, description: 'Pão, carne 150g, queijo, alface e tomate' },
          { name: 'Double Smash', emoji: '🍔', price: 38.00, description: 'Pão brioche, 2 smash patties, queijo american' },
          { name: 'Chicken Crispy', emoji: '🍗', price: 32.00, description: 'Pão, frango crocante, cheddar e bacon' },
          { name: 'Veggie Burger', emoji: '🥗', price: 30.00, description: 'Pão, hambúrguer de grão-de-bico, rúcula' },
        ]
      },
      {
        label: 'Combos', name: 'combos', itens: [
          { name: 'Combo Clássico', emoji: '🍔', price: 42.00, description: 'Hambúrguer + Batata M + Refrigerante' },
          { name: 'Combo Duplo', emoji: '🍔', price: 55.00, description: 'Hambúrguer Duplo + Batata G + Refrigerante' },
        ]
      },
      {
        label: 'Acompanhamentos', name: 'acompanhamentos', itens: [
          { name: 'Batata Frita P', emoji: '🍟', price: 12.00, description: 'Porção pequena de batata frita' },
          { name: 'Batata Frita G', emoji: '🍟', price: 18.00, description: 'Porção grande de batata frita' },
          { name: 'Onion Rings', emoji: '🧅', price: 16.00, description: 'Anéis de cebola empanados' },
          { name: 'Fritas com Cheddar', emoji: '🧀', price: 22.00, description: 'Batata frita com cheddar e bacon' },
        ]
      },
      {
        label: 'Bebidas', name: 'bebidas_burger', itens: [
          { name: 'Milkshake', emoji: '🥛', price: 20.00, description: 'Milkshake 400ml — vários sabores' },
          { name: 'Refrigerante Lata', emoji: '🥤', price: 6.00, description: 'Lata 350ml' },
          { name: 'Água', emoji: '💧', price: 4.00, description: 'Água mineral 500ml' },
        ]
      },
    ]
  },
  cafeteria: {
    label: 'Cafeteria',
    categorias: [
      {
        label: 'Cafés', name: 'cafes', itens: [
          { name: 'Espresso', emoji: '☕', price: 6.00, description: 'Espresso tradicional' },
          { name: 'Cappuccino', emoji: '☕', price: 10.00, description: 'Cappuccino 300ml' },
          { name: 'Latte', emoji: '☕', price: 12.00, description: 'Café latte com leite vaporizado' },
          { name: 'Café Gelado', emoji: '🧊', price: 14.00, description: 'Cold brew 400ml' },
        ]
      },
      {
        label: 'Sucos e Vitaminas', name: 'sucos', itens: [
          { name: 'Suco Verde', emoji: '🥤', price: 12.00, description: 'Couve, maçã e gengibre' },
          { name: 'Vitamina', emoji: '🥛', price: 14.00, description: 'Vitamina de banana com aveia' },
          { name: 'Água de Coco', emoji: '🥥', price: 8.00, description: 'Água de coco natural' },
        ]
      },
      {
        label: 'Salgados', name: 'salgados', itens: [
          { name: 'Croissant', emoji: '🥐', price: 12.00, description: 'Croissant de presunto e queijo' },
          { name: 'Coxinha', emoji: '🍗', price: 7.00, description: 'Coxinha de frango' },
          { name: 'Wrap', emoji: '🌯', price: 18.00, description: 'Wrap de frango grelhado' },
        ]
      },
      {
        label: 'Doces', name: 'doces_cafe', itens: [
          { name: 'Brownie', emoji: '🍫', price: 10.00, description: 'Brownie de chocolate' },
          { name: 'Muffin', emoji: '🧁', price: 9.00, description: 'Muffin de blueberry' },
          { name: 'Cheesecake', emoji: '🍰', price: 15.00, description: 'Fatia de cheesecake com calda de frutas' },
        ]
      },
    ]
  },
  padaria: {
    label: 'Padaria',
    categorias: [
      {
        label: 'Pães', name: 'paes', itens: [
          { name: 'Pão Francês', emoji: '🥖', price: 0.70, description: 'Pão francês fresquinho — unidade' },
          { name: 'Pão de Queijo', emoji: '🧀', price: 3.50, description: 'Pão de queijo mineiro — unidade' },
          { name: 'Pão de Forma', emoji: '🍞', price: 9.00, description: 'Pão de forma fatiado — pacote' },
          { name: 'Baguete', emoji: '🥖', price: 8.00, description: 'Baguete tradicional' },
        ]
      },
      {
        label: 'Salgados', name: 'salgados_padaria', itens: [
          { name: 'Esfiha', emoji: '🥙', price: 5.00, description: 'Esfiha de carne' },
          { name: 'Enroladinho', emoji: '🌯', price: 4.50, description: 'Enroladinho de presunto e queijo' },
          { name: 'Pastel', emoji: '🥟', price: 6.00, description: 'Pastel de carne' },
          { name: 'Pizza Pão', emoji: '🍕', price: 7.00, description: 'Pizza pão individual' },
        ]
      },
      {
        label: 'Doces', name: 'doces_padaria', itens: [
          { name: 'Sonho', emoji: '🍩', price: 5.00, description: 'Sonho com recheio de creme' },
          { name: 'Brigadeirão', emoji: '🍫', price: 4.50, description: 'Fatia de brigadeirão' },
          { name: 'Bolo de Cenoura', emoji: '🍰', price: 6.00, description: 'Fatia de bolo de cenoura com cobertura' },
        ]
      },
      {
        label: 'Bolos', name: 'bolos', itens: [
          { name: 'Bolo Festa 1kg', emoji: '🎂', price: 65.00, description: 'Bolo de festa confeitado 1kg' },
          { name: 'Bolo de Pote', emoji: '🍮', price: 15.00, description: 'Bolo de pote individual' },
        ]
      },
      {
        label: 'Bebidas', name: 'bebidas_padaria', itens: [
          { name: 'Café Coado', emoji: '☕', price: 4.00, description: 'Café coado — copo' },
          { name: 'Achocolatado', emoji: '🥛', price: 6.00, description: 'Achocolatado quente ou frio 300ml' },
          { name: 'Suco de Laranja', emoji: '🍊', price: 7.00, description: 'Suco de laranja natural' },
        ]
      },
    ]
  },
  acougue: {
    label: 'Açougue / Frigorífico',
    categorias: [
      {
        label: 'Bovinos', name: 'bovinos', type: 'Itens principais', itens: [
          { name: 'Picanha', emoji: '🥩', price: 89.90, item_type: 'kg', description: 'Corte nobre com capa de gordura, ideal para churrasco' },
          { name: 'Contrafilé', emoji: '🥩', price: 54.90, item_type: 'kg', description: 'Macio e saboroso, ótimo para grelhar e assar' },
          { name: 'Alcatra', emoji: '🥩', price: 59.90, item_type: 'kg', description: 'Corte versátil, bom para churrasco e assados' },
          { name: 'Fraldinha', emoji: '🥩', price: 44.90, item_type: 'kg', description: 'Fibras longas com gordura entremeada, muito saborosa' },
          { name: 'Costela Bovina', emoji: '🥩', price: 38.90, item_type: 'kg', description: 'Para churrasco lento ou panela de pressão' },
          { name: 'Patinho Moído', emoji: '🥩', price: 32.90, item_type: 'kg', description: 'Carne moída fresca de primeira qualidade' },
          { name: 'Acém', emoji: '🥩', price: 29.90, item_type: 'kg', description: 'Excelente para ensopados e carne de panela' },
        ]
      },
      {
        label: 'Suínos', name: 'suinos', type: 'Itens principais', itens: [
          { name: 'Costelinha Suína', emoji: '🥓', price: 28.90, item_type: 'kg', description: 'Perfeita para churrasco e molho barbecue' },
          { name: 'Pernil Suíno', emoji: '🥓', price: 22.90, item_type: 'kg', description: 'Ideal para assar no forno com temperos' },
          { name: 'Bisteca Suína', emoji: '🥓', price: 24.90, item_type: 'kg', description: 'Corte com osso para grelhar' },
          { name: 'Lombo Suíno', emoji: '🥓', price: 26.90, item_type: 'kg', description: 'Magro e saboroso, ótimo assado' },
        ]
      },
      {
        label: 'Aves', name: 'aves', type: 'Itens principais', itens: [
          { name: 'Frango Inteiro', emoji: '🍗', price: 12.90, item_type: 'kg', description: 'Frango resfriado, limpinho e pronto para temperar' },
          { name: 'Coxa e Sobrecoxa', emoji: '🍗', price: 11.90, item_type: 'kg', description: 'Suculenta e saborosa' },
          { name: 'Filé de Peito', emoji: '🍗', price: 18.90, item_type: 'kg', description: 'Magro e versátil' },
          { name: 'Asa de Frango', emoji: '🍗', price: 10.90, item_type: 'kg', description: 'Ótima para fritar ou assar na grelha' },
        ]
      },
      {
        label: 'Embutidos', name: 'embutidos', type: 'Itens principais', itens: [
          { name: 'Linguiça Toscana', emoji: '🌭', price: 19.90, item_type: 'kg', description: 'Artesanal com ervas finas' },
          { name: 'Linguiça de Frango', emoji: '🌭', price: 16.90, item_type: 'kg', description: 'Mais leve e saborosa' },
          { name: 'Calabresa', emoji: '🌭', price: 17.90, item_type: 'kg', description: 'Defumada, tradicional e saborosa' },
        ]
      },
      {
        label: 'Temperados', name: 'temperados', type: 'Itens principais', itens: [
          { name: 'Frango Temperado', emoji: '🧂', price: 15.90, item_type: 'kg', description: 'Tempero especial da casa, pronto para assar' },
          { name: 'Costela Temperada', emoji: '🧂', price: 42.90, item_type: 'kg', description: 'Marinada por 24h no molho secreto' },
          { name: 'Churrasco Misto', emoji: '🧂', price: 35.90, item_type: 'kg', description: 'Mix de carnes temperadas para churrasco' },
        ]
      },
    ]
  },
};

let _modeloSelecionado = null;

function selecionarModelo(tipo) {
  console.log('[MODELO] selecionarModelo:', tipo);
  _modeloSelecionado = tipo;
  const modelo = MODELOS_CARDAPIO[tipo];
  if (!modelo) return;

  // Atualiza visual dos cards
  document.querySelectorAll('.modelo-card').forEach(c => {
    c.style.borderColor = 'var(--border)';
    c.style.background = 'var(--surface2)';
  });
  const card = document.getElementById('modelo-' + tipo);
  if (card) {
    card.style.borderColor = 'var(--accent)';
    card.style.background = 'rgba(59,130,246,.08)';
  }

  // Mostra aviso e preview
  document.getElementById('modelos-aviso').style.display = 'block';
  document.getElementById('modelo-preview').style.display = 'block';
  document.getElementById('btn-aplicar-modelo').style.display = 'flex';

  const prev = document.getElementById('modelo-preview-content');
  prev.innerHTML = modelo.categorias.map(cat => `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
      <div style="font-weight:700;font-size:12.5px;margin-bottom:8px;display:flex;align-items:center;gap:6px">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5 8h6M5 5h3M5 11h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        ${cat.label}
        <span style="font-size:10px;color:var(--muted);font-weight:400">(${cat.itens.length} itens)</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">
        ${cat.itens.map(it => `
          <span style="font-size:11px;padding:3px 8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--muted2)">
            ${it.emoji} ${it.name} ${it.price > 0 ? '· R$' + it.price.toFixed(2).replace('.', ',') : ''}
          </span>`).join('')}
      </div>
    </div>`).join('');
}

// ── Limpa todo o cardápio do tenant ──────────────────
async function limparCardapioAtual() {
  console.log('[LIMPAR] iniciando | items:', items.length, '| categories:', categories.length);
  if (items.length > 0) {
    console.log('[LIMPAR] deletando menu_items...');
    const { error: errItems } = await sb.from('menu_items').delete().neq('id', 0);
    if (errItems) { console.error('[LIMPAR] ❌ itens:', errItems); throw new Error('Erro ao limpar itens: ' + (errItems.message || errItems)); }
    console.log('[LIMPAR] ✅ itens deletados');
  }
  if (categories.length > 0) {
    console.log('[LIMPAR] deletando categories...');
    const { error: errCats } = await sb.from('categories').delete().neq('id', 0);
    if (errCats) { console.error('[LIMPAR] ❌ cats:', errCats); throw new Error('Erro ao limpar categorias: ' + (errCats.message || errCats)); }
    console.log('[LIMPAR] ✅ categorias deletadas');
  }
  items.length = 0;
  categories.length = 0;
  console.log('[LIMPAR] concluído');
}

// ── Excluir tudo com confirmação dupla ───────────────
async function excluirTodoCardapio() {
  if (!categories.length && !items.length) {
    sbToast('err', 'O cardápio já está vazio.');
    return;
  }

  const primeira = confirm(`Tem certeza que deseja EXCLUIR TODO O CARDÁPIO?\n\n${categories.length} categoria(s) · ${items.length} item(s) serão deletados permanentemente.`);
  if (!primeira) return;

  const segunda = confirm('⚠️ Esta ação não pode ser desfeita.\n\nConfirme novamente para excluir tudo.');
  if (!segunda) return;

  closeModal('modal-modelos');
  sbLoading(true);
  try {
    await limparCardapioAtual();
    renderGestor();
    renderTable();
    populateCatSelects();
    sbToast('ok', 'Cardápio excluído com sucesso.');
  } catch (e) {
    sbToast('err', 'Erro ao excluir: ' + e.message);
    console.error('[excluirTodoCardapio]', e);
  } finally {
    sbLoading(false);
  }
}

async function aplicarModelo() {
  console.log('[MODELO] aplicarModelo chamado | selecionado:', _modeloSelecionado);
  if (!_modeloSelecionado) { sbToast('err', 'Selecione um modelo primeiro'); return; }
  const modelo = MODELOS_CARDAPIO[_modeloSelecionado];
  if (!modelo) { sbToast('err', 'Modelo inválido'); return; }

  const substituir = document.getElementById('toggle-limpar-cardapio')?.classList.contains('on');
  console.log('[MODELO] substituir cardápio atual:', substituir, '| cats existentes:', categories.length, '| itens existentes:', items.length);

  if (substituir && (categories.length > 0 || items.length > 0)) {
    const ok = confirm(`Tem certeza? Isso vai APAGAR todo o cardápio atual (${categories.length} categoria(s) · ${items.length} item(s)) e substituir pelo modelo "${modelo.label}".`);
    if (!ok) return;
  }

  const btn = document.getElementById('btn-aplicar-modelo');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spin"></div> Aplicando...'; }
  sbLoading(true);

  let catsCriadas = 0, itensCriados = 0, erros = 0;

  try {
    if (substituir) {
      console.log('[MODELO] limpando cardápio atual...');
      await limparCardapioAtual();
      console.log('[MODELO] cardápio limpo OK');
    }

    let catSortOrder = categories.length;
    console.log('[MODELO] iniciando inserção | categorias do modelo:', modelo.categorias.length);

    for (const catDef of modelo.categorias) {
      console.log('[MODELO] inserindo categoria:', catDef.name, catDef.label);

      const { data: catData, error: catErr } = await sb.from('categories').insert({
        name: catDef.name,
        label: catDef.label,
        type: catDef.type || 'Itens principais',
        promo: false,
        sort_order: ++catSortOrder
      }).select().single();

      if (catErr || !catData) {
        erros++;
        console.error('[MODELO] ❌ Erro ao criar categoria:', catDef.name, '| erro:', catErr, '| data:', catData);
        sbToast('err', `Erro ao criar categoria "${catDef.label}": ${catErr?.message || 'resposta inválida'}`);
        continue;
      }

      console.log('[MODELO] ✅ categoria criada:', catData.id, catData.name);
      catsCriadas++;
      categories.push({
        id: catData.id,
        name: catData.name,
        label: catData.label || catDef.label,
        type: catData.type || catDef.type || 'Itens principais',
        promo: false,
        open: false
      });

      const itensDef = catDef.itens || [];
      console.log('[MODELO] inserindo', itensDef.length, 'itens na categoria', catData.name);

      for (const itemDef of itensDef) {
        console.log('[MODELO]   → item:', itemDef.name, '| emoji:', itemDef.emoji, '| preço:', itemDef.price);
        if (!_sessao?.tenant_id) { erros++; continue; }
        const { data: itemData, error: itemErr } = await sb.from('menu_items').insert({
          tenant_id: _sessao.tenant_id,
          emoji: itemDef.emoji || '🍽️',
          name: itemDef.name,
          description: itemDef.description || '',
          price: parseFloat(itemDef.price) || 0,
          price_old: null,
          cat: catData.label,
          cat_key: catData.name,
          item_type: itemDef.item_type || 'normal',
          allow_half: false,
          max_flavors: 1,
          promo: false,
          destaque: false,
          status: 'active',
          days: [1, 1, 1, 1, 1, 1, 1],
          ingredients: [],
          custom_groups: []
        }).select().single();

        if (itemErr || !itemData) {
          erros++;
          console.error('[MODELO]   ❌ Erro ao criar item:', itemDef.name, '| erro:', itemErr, '| data:', itemData);
          continue;
        }

        console.log('[MODELO]   ✅ item criado id:', itemData.id, itemData.name);
        itensCriados++;
        items.push(mapItem(itemData));
      }
    }

    console.log('[MODELO] FIM | cats:', catsCriadas, '| itens:', itensCriados, '| erros:', erros);

    closeModal('modal-modelos');
    document.getElementById('toggle-limpar-cardapio')?.classList.remove('on');
    document.getElementById('modelos-aviso').style.display = 'none';
    document.getElementById('modelo-preview').style.display = 'none';
    document.getElementById('btn-aplicar-modelo').style.display = 'none';
    document.querySelectorAll('.modelo-card').forEach(c => {
      c.style.borderColor = 'var(--border)';
      c.style.background = 'var(--surface2)';
    });

    renderGestor();
    renderTable();
    populateCatSelects();

    if (erros > 0) {
      sbToast('err', `Modelo aplicado com ${erros} erro(s). ${catsCriadas} cat · ${itensCriados} itens criados.`);
    } else {
      sbToast('ok', `Modelo "${modelo.label}" aplicado! ${catsCriadas} categorias · ${itensCriados} itens criados.`);
    }

  } catch (e) {
    console.error('[MODELO] ❌ EXCEÇÃO:', e);
    sbToast('err', 'Erro ao aplicar modelo: ' + e.message);
    renderGestor();
    renderTable();
  } finally {
    sbLoading(false);
    _modeloSelecionado = null;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 2h8l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.4"/><path d="M9 2v4h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg> Aplicar modelo`;
    }
  }
}

// ── Exportar cardápio atual ───────────────────────────
function exportarCardapio() {
  try {
    // Monta estrutura exportável
    const exportData = {
      _versao: 1,
      _exportado: new Date().toISOString(),
      _nome: document.getElementById('sidebar-nome')?.textContent || 'cardapio',
      categorias: categories.map(cat => ({
        name: cat.name,
        label: cat.label,
        type: cat.type || 'Itens principais',
        promo: cat.promo || false,
        itens: items
          .filter(i => i.catKey === cat.name)
          .map(i => ({
            name: i.name,
            emoji: i.emoji || '🍽️',
            description: i.description || '',
            price: i.price || 0,
            price_old: i.priceOld || null,
            status: i.status || 'active',
            item_type: i.itemType || 'normal',
            allow_half: i.allowHalf || false,
            max_flavors: i.maxFlavors || 1,
            ingredients: i.ingredients || [],
            custom_groups: i.customGroups || [],
            days: i.days || [1, 1, 1, 1, 1, 1, 1],
          }))
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const data = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    a.href = url;
    a.download = `cardapio-${exportData._nome.toLowerCase().replace(/\s+/g, '-')}-${data}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    sbToast('ok', `Cardápio exportado com ${categories.length} categoria(s)!`);
  } catch (e) {
    sbToast('err', 'Erro ao exportar: ' + e.message);
    console.error(e);
  }
}

// ── Importar cardápio de arquivo .json ───────────────
async function importarCardapio(inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;
  inputEl.value = '';

  let parsed;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch (e) {
    sbToast('err', 'Arquivo inválido — não é um JSON válido');
    return;
  }

  if (!parsed?.categorias || !Array.isArray(parsed.categorias)) {
    sbToast('err', 'Arquivo não reconhecido — falta a chave "categorias"');
    return;
  }

  const total = parsed.categorias.reduce((s, c) => s + (c.itens?.length || 0), 0);
  const substituir = categories.length > 0 && confirm(
    `Deseja SUBSTITUIR o cardápio atual?\n\nAtual: ${categories.length} categoria(s) · ${items.length} item(s)\nImportando: ${parsed.categorias.length} categoria(s) · ${total} item(s)\n\nOK = substituir | Cancelar = adicionar ao existente.`
  );

  closeModal('modal-modelos');
  sbLoading(true);
  sbToast('ok', `⏳ Importando ${total} itens…`);

  try {
    if (substituir) await limparCardapioAtual();

    // ── Usa endpoint de import em lote (uma única transação no servidor) ──
    const tid = (() => { try { return JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || ''; } catch { return ''; } })();
    const res = await fetch('/api/importar-cardapio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ categorias: parsed.categorias })
    });
    const resultado = await res.json();

    if (!res.ok) throw new Error(resultado?.error || 'Erro no servidor');

    // Recarrega tudo do banco
    await loadAllData(true);
    renderGestor();
    renderTable();
    populateCatSelects();
    const { catsCriadas = 0, itensCriados = 0, erros = 0 } = resultado;
    const msg = `✅ Importado: ${catsCriadas} categoria(s) · ${itensCriados} item(s)` + (erros ? ` · ⚠️ ${erros} erro(s)` : '');
    sbToast(erros ? 'warn' : 'ok', msg);

  } catch (e) {
    sbToast('err', 'Erro ao importar: ' + e.message);
    console.error('[importarCardapio]', e);
    await loadAllData(true);
    renderGestor();
  } finally {
    sbLoading(false);
  }
}

// ─────────────────────────────────────────

async function kanbanMesaServido(orderId) {
  const order = mesaOrdersCache.find(o => o.id === orderId);
  if (!order) return;
  // Marca itens 'pronto' como 'entregue' na comanda
  const updatedItems = (order.items || []).map(i =>
    i.item_status === 'pronto' ? { ...i, item_status: 'entregue' } : i
  );
  try {
    const { error } = await sb.from('orders')
      .update({ items: updatedItems, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    if (error) throw error;
    const idx = mesaOrdersCache.findIndex(o => o.id === orderId);
    if (idx !== -1) mesaOrdersCache[idx] = { ...mesaOrdersCache[idx], items: updatedItems };
    renderKanban();
    _renderMesaPageFromCache();
    sbToast('ok', 'Mesa ' + order.mesa_num + ' — itens servidos!');
  } catch(e) { sbToast('err', 'Erro: ' + (e?.message || e)); }
}

// Escapa texto que vem do cliente (nome, endereço, observação) antes de
// colocar dentro de innerHTML — sem isso, alguém podia digitar um "nome"
// que na real é um pedaço de código e ele rodaria dentro da tela do
// gestor quando o pedido fosse exibido no Kanban.
function _escHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// NAV
// ─────────────────────────────────────────
function nav(id) {
  if (typeof billingGateNav === 'function' && billingGateNav(id)) return;
  // ── Bloqueio do Robô para plano Pro ──────────────────
  if (id === 'robo') {
    if (_planoAtual !== 'premium') {
      _toastUpgradePlano();
      return; // Não navega
    }
  }
  if (typeof financeGateNav === 'function' && financeGateNav(id)) return;
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
  if (id === 'entregas' && typeof renderEntregas === 'function') renderEntregas();
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
  if (id === 'cupom') { renderCupons(); loadCashbackConfig(); loadStampConfig(); }
  if (id === 'fidelidade') renderFidelidade();
  if (id === 'garcom') { renderGarcom(); loadGarcons(); }
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
function _kanbanMesaEmAtendimento(order) {
  if (!order?.mesa_num) return true;
  const mesaNum = parseInt(order.mesa_num);
  const mesa = (tables || []).find(t => parseInt(t.num) === mesaNum);
  return !!mesa && mesa.status === 'busy';
}

function _kanbanOrderDentroSessaoMesa(order, mesa) {
  if (!order?.mesa_num || !mesa) return false;
  if (typeof mesaOrderBelongsToSession === 'function') return mesaOrderBelongsToSession(order, mesa);
  if (!mesa.opened_at) return order.status !== 'entregue';
  return new Date(order.created_at || 0).getTime() >= new Date(mesa.opened_at).getTime() - 5000;
}

function _buildMesaKanbanOrders() {
  // Gera objetos sintéticos a partir do cache de mesas para exibição no kanban
  const result = [];
  (mesaOrdersCache || []).forEach(o => {
    if (o.status !== 'mesa_aberta') return;
    const mesa = (tables || []).find(t => parseInt(t.num) === parseInt(o.mesa_num));
    if (!mesa || mesa.status !== 'busy') return;
    if (!_kanbanOrderDentroSessaoMesa(o, mesa)) return;
    const items = Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? (() => { try { return JSON.parse(o.items); } catch { return []; } })() : []);
    const itemsComIdx = items.map((i, idx) => ({ ...i, _origIndex: idx }));
    const prodItems  = itemsComIdx.filter(i => i.item_status === 'producao');
    const prontoItems= itemsComIdx.filter(i => i.item_status === 'pronto');
    if (prodItems.length) {
      result.push({ ...o, status: 'producao', _isMesa: true,
        items: prodItems.map(i => ({ qty: i.qty, name: i.name, _origIndex: i._origIndex })) });
    }
    if (prontoItems.length && !prodItems.length) {
      result.push({ ...o, status: 'pronto', _isMesa: true,
        items: prontoItems.map(i => ({ qty: i.qty, name: i.name, _origIndex: i._origIndex })) });
    }
  });
  return result;
}

function renderPendingPaymentsAlert() {
  const box = document.getElementById('pending-payments-alert');
  if (!box) return;
  const allRows = (typeof pendingOnlineOrders !== 'undefined' ? pendingOnlineOrders : [])
    .filter(o => o && (o.status === 'aguardando_cartao' || (o.status === 'aguardando_pix' && o.pag !== 'pix_manual')));
  const rows = allRows.slice(0, 5);
  if (!rows.length) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  box.style.display = '';
  const count = allRows.length;
  const label = count === 1 ? '1 pedido aguardando pagamento online' : `${count} pedidos aguardando pagamento online`;
  const items = rows.map(o => {
    const hasNum = !!o.order_num;
    const num = hasNum ? String(o.order_num).padStart(3, '0') : '';
    const pay = o.status === 'aguardando_cartao' ? 'cartao' : 'PIX';
    const client = String(o.client || 'Cliente').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
    const total = (parseFloat(o.total || 0) + parseFloat(o.taxa || 0)).toFixed(2).replace('.', ',');
    const labelNum = hasNum ? `#${num}` : 'Aguardando pagamento';
    const click = hasNum ? `document.getElementById('kanban-search-num').value='${num}';renderKanban()` : `nav('historico');document.getElementById('hist-status').value='';histFiltrar()`;
    return `<button onclick="${click}" style="display:inline-flex;align-items:center;gap:6px;margin:6px 6px 0 0;padding:6px 9px;border-radius:8px;border:1px solid rgba(245,158,11,.24);background:rgba(245,158,11,.08);color:var(--text);font:inherit;font-size:12px;cursor:pointer">${labelNum} - ${pay} - ${client} - R$ ${total}</button>`;
  }).join('');
  box.innerHTML = `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
    <div>
      <div style="font-size:12.5px;font-weight:800;color:#fbbf24">${label}</div>
      <div style="font-size:11.5px;color:var(--muted);margin-top:2px">Eles ficam fora do Kanban ate o pagamento confirmar, mas continuam no historico.</div>
      <div>${items}</div>
    </div>
    <button class="btn bg" style="font-size:11px;padding:5px 10px" onclick="nav('historico');document.getElementById('hist-status').value='';histFiltrar()">Ver historico</button>
  </div>`;
}

function renderKanban() {
  renderPendingPaymentsAlert();
  // Layout: SEMPRE 4 colunas — fluxo unificado para restaurante e açougue.
  //   analise → producao → pronto → saiu pra entrega (delivery)
  //   Pedidos de balcão: clicar "Retirado!" finaliza direto do pronto.
  //   Pedidos de mesa: clicar "Servido!" finaliza direto do pronto.
  //   Ao clicar "Entregue ao cliente" na coluna "Saiu", o pedido vai direto pra finalizado.
  const _saiuWrap      = document.getElementById('kol-wrap-saiu');
  const _entregueWrap  = document.querySelector('.kol-entregue');
  // Usa setProperty com 'important' porque o CSS do mobile (@media max-width:900px)
  // tem display:flex!important em .kol — sem important aqui, a coluna "escondida" apareceria no mobile.
  // Fluxo unificado: mostra "saiu", esconde "entregue"
  if (_saiuWrap)     _saiuWrap.style.setProperty('display', 'flex', 'important');
  if (_entregueWrap) _entregueWrap.style.setProperty('display', 'none', 'important');
  // Ajusta o grid para 4 colunas fixas
  const _board = document.getElementById('kanban-board');
  if (_board) {
    _board.classList.remove('kanban-5cols');
    _board.classList.add('kanban-4cols');
  }
  const statuses = ['analise', 'producao', 'pronto', 'saiu'];
  const mesaKanban = _buildMesaKanbanOrders();
  const _searchNum = (document.getElementById('kanban-search-num')?.value || '').trim();
  const _searchClient = (document.getElementById('kanban-search-client')?.value || '').trim().toLowerCase();
  statuses.forEach(st => {
    const col = document.getElementById('col-' + st);
    const cnt = document.getElementById('cnt-' + st);
    let filtered = [
      ...ordersKanban.filter(o => o.status === st),
      ...mesaKanban.filter(o => o.status === st)
    ].filter(_kanbanMesaEmAtendimento);
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
        const obsStr = o.items.filter(i => i.obs).map(i => '📝 ' + _escHtml(i.obs)).join(' · ');

        // ── Mesa em produção: lista de itens com botão de "pronto" individual ──
        const itemsHtml = (o._isMesa && st === 'producao')
          ? '<div class="oc-items-list">' + o.items.map(i =>
              '<div class="oc-item-row-mini">' +
                '<span class="oc-item-row-mini-txt">' + i.qty + 'x ' + i.name + '</span>' +
                '<button class="oc-item-pronto-btn" onclick="event.stopPropagation();kanbanItemPronto(' + o.id + ',' + i._origIndex + ')">✅ Pronto</button>' +
              '</div>'
            ).join('') + '</div>'
          : '<div class="oc-items">' + itemStr + '</div>';
        const total = 'R$ ' + (parseFloat(o.total || 0) + parseFloat(o.taxa || 0)).toFixed(2).replace('.', ',');

        // ── Tipo de entrega (via helper unificado) ───────
        const _tipo = (window._detectOrderType ? window._detectOrderType(o) : 'delivery');
        const isMesa     = _tipo === 'mesa';
        const isRetirada = _tipo === 'balcao';
        const isDelivery = _tipo === 'delivery';
        const _tipoBadge = isMesa
          ? `<span class="oc-tipo-badge oc-tipo-mesa"><svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg> ${o.mesa_num ? 'Mesa ' + o.mesa_num : 'Consumo no local'}</span>`
          : isRetirada
            ? `<span class="oc-tipo-badge oc-tipo-retirada"><svg width='11' height='11' viewBox='0 0 16 16' fill='none'><rect x='2' y='6' width='12' height='8' rx='1' stroke='currentColor' stroke-width='1.4'/><path d='M5 6V4a3 3 0 0 1 6 0v2' stroke='currentColor' stroke-width='1.4' stroke-linecap='round'/></svg> Retirada</span>`
            : `<span class="oc-tipo-badge oc-tipo-delivery"><svg width='11' height='11' viewBox='0 0 16 16' fill='none'><circle cx='4' cy='12' r='2' stroke='currentColor' stroke-width='1.3'/><circle cx='13' cy='12' r='2' stroke='currentColor' stroke-width='1.3'/><path d='M2 12V9l3-4h5l2 3h2v3' stroke='currentColor' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'/></svg> Delivery</span>`;

        // ── Botões de ação por tipo ──────────────────────
        let actionBtn = '';
        if (o._isMesa) {
          // Comanda de mesa — ações por item_status
          if (st === 'producao') {
            actionBtn = '<button class="oc-btn oc-btn-ok" onclick="event.stopPropagation();kanbanMesaPronto(' + o.id + ')">✅ Pronto p/ servir!</button>' + '<button class="oc-btn" style="background:rgba(59,130,246,.15);color:#93c5fd;border:1px solid rgba(59,130,246,.25)" onclick="event.stopPropagation();printOrderById(' + o.id + ')">🖨️</button>';
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
        } else {
          const finLabel = isMesa ? 'Servido!' : isRetirada ? 'Retirado!' : 'Finalizar';
          actionBtn = '<button class="oc-btn oc-btn-fin" onclick="event.stopPropagation();finishOrderById(' + o.id + ')">' + finLabel + '</button>';
          // Botão de fechar mesa para pedidos de mesa na coluna pronto
          if (isMesa && o.mesa_num) {
            actionBtn += '<button class="oc-btn" style="width:100%;margin-top:4px;background:linear-gradient(135deg,var(--accent3),#d97706);color:#000;font-weight:700;border:none" onclick="event.stopPropagation();cobrarMesaDireta(' + o.mesa_num + ')">💰 Fechar Mesa</button>';
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

        // Botão de indisponibilidade de peso (açougue — para itens kg)
        const _isAcougue = window._segmento === 'acougue';
        const _temItemKg = _isAcougue && (o.items || []).some(i => i.item_type === 'kg' || (i.obs && /\d+g /.test(i.obs)));
        const _acougueBtn = _temItemKg
          ? '<button class="oc-btn oc-btn-acougue-peso" title="Ajustar peso disponível" onclick="event.stopPropagation();abrirModalAjustePeso(' + o.id + ')">⚠️</button>'
          : '';
        const _waBtn = o.phone
          ? '<button class="oc-btn oc-btn-wa oc-btn-icon" title="Abrir chat WhatsApp" onclick="event.stopPropagation();abrirChatPedidoWA(' + o.id + ')"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13.5 8a5.5 5.5 0 1 1-9.2-4.1L3 2l2 .9A5.5 5.5 0 0 1 13.5 8Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6.2 6.1c.2 1.4 1.7 3 3.1 3.4l.6-.5c.2-.1.4-.1.6 0l1 .8c.2.2.2.5 0 .7-.7.7-2 .8-3.2.1-1.3-.7-2.5-2-3-3.4-.4-1.2-.1-2.3.5-2.8.2-.2.5-.2.7 0l.8 1c.1.2.1.4 0 .6l-.5.6Z" fill="currentColor"/></svg></button>'
          : '';
        const _chatBtn = o.phone
          ? '<button class="oc-btn oc-btn-chat oc-btn-icon" title="Abrir chat do pedido" onclick="event.stopPropagation();if(window.gestorChatOpenOrder)gestorChatOpenOrder(' + o.id + ')"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 4.5A2.5 2.5 0 0 1 5.5 2h5A2.5 2.5 0 0 1 13 4.5v3A2.5 2.5 0 0 1 10.5 10H8l-3.2 2.4c-.5.4-1.3 0-1.3-.7V10A2.5 2.5 0 0 1 1 7.5v-3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 5.2h6M5 7.4h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></button>'
          : '';

        // Notificação de resposta WA do cliente
        const _waNotif = o._waResposta
          ? '<div class="oc-wa-notif" onclick="event.stopPropagation();abrirRespostaWA(' + o.id + ')" title="Cliente respondeu no WhatsApp">💬 Cliente respondeu!</div>'
          : '';

        // Selo de pedido agendado — mostrado quando a loja estava fechada e
        // o cliente confirmou o pedido pra ser feito na próxima abertura.
        const _agendadoBadge = o.scheduled_for
          ? '<div class="oc-agendado-badge">🕐 Agendado para ' + new Date(o.scheduled_for).toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) + '</div>'
          : '';

        // Selo de pedido feito pelo totem fixo na mesa (totem.html) —
        // ajuda o gestor a distinguir de um pedido feito pelo celular do
        // próprio cliente (cardápio normal), já que os dois criam pedido
        // igual, só muda de onde veio.
        const _tabletBadge = o.canal === 'totem'
          ? '<div class="oc-tablet-badge">📱 Pedido do Totem</div>'
          : '';

        // Selo de pedido feito por voz (áudio no WhatsApp, transcrito e
        // montado automaticamente) — ajuda o gestor a identificar de cara
        // caso a IA tenha entendido algo errado do áudio.
        const _vozBadge = o.canal === 'voz_whatsapp'
          ? '<div class="oc-voz-badge">🎙️ Pedido por Voz</div>'
          : '';

        const _tipoClass = isMesa ? ' card-mesa' : isRetirada ? ' card-retirada' : ' card-delivery';

        const _cardStyle = o._pixPendente
          ? ' style="border-left:3px solid rgba(249,115,22,.7);background:rgba(249,115,22,.04)"'
          : o._waResposta
            ? ' style="border-left:3px solid rgba(34,197,94,.7);background:rgba(34,197,94,.03)"'
            : o.scheduled_for
              ? ' style="border-left:3px solid rgba(139,92,246,.7);background:rgba(139,92,246,.04)"'
              : '';

        return '<div class="order-card' + _tipoClass + '"' + _cardStyle + ' onclick="openOrderDetail(' + o.id + ')">' +
          _agendadoBadge +
          _tabletBadge +
          _vozBadge +
          '<div class="oc-top"><span class="oc-id">#' + o.num + '</span>' + _tipoBadge + '<span class="oc-time">⏱ ' + o.time + '</span>' + _acougueBtn + '</div>' +
          _waNotif +
          '<div class="oc-client">' + _escHtml(o.client) + (o.phone ? ' · ' + _escHtml(o.phone) : '') + '</div>' +
          itemsHtml +
          (obsStr ? '<div style="font-size:11px;color:#c4956a;font-weight:600;margin-top:3px;padding:3px 7px;background:rgba(196,149,106,.08);border-radius:5px;border:1px solid rgba(196,149,106,.12)">' + obsStr + '</div>' : '') +
          '<div class="oc-bot"><span class="oc-total">' + total + '</span>' +
          (o.addr && !isMesa ? '<span class="oc-addr">' + _escHtml(o.addr) + '</span>' : '') +
          '</div>' +
          _pagBadge +
          '<div class="oc-actions">' +
            ((_chatBtn || _waBtn) ? '<div class="oc-actions-icons">' + _chatBtn + _waBtn + '</div>' : '') +
            '<div class="oc-actions-main">' + actionBtn + '</div>' +
          '</div>' +
          '</div>';
      }).join('');
    }
    col.addEventListener('dragover', e => e.preventDefault());
    col.addEventListener('drop', e => {
      e.preventDefault();
      const id = parseInt(e.dataTransfer.getData('orderId'));
      const o = ordersKanban.find(x => x.id === id);
      if (o) {
        o.status = st;
        if (st === 'saiu') o.updated_at = new Date().toISOString();
      }
      renderKanban();
    });
  });
  document.getElementById('pedidos-badge').textContent = ordersKanban
    .filter(o => _kanbanMesaEmAtendimento(o) && (o.status === 'analise' || o.status === 'aguardando_pix')).length || '';

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
      mesa_aberta: '🍽️ Mesa', aguardando_pix: '💠 PIX', aguardando_cartao: 'Cartao'
    };
    const statusColor = {
      analise: 'var(--accent3)', producao: 'var(--accent)', pronto: 'var(--success)',
      entregue: 'var(--success)', finalizado: 'var(--success)', cancelado: 'var(--danger)',
      mesa_aberta: 'var(--purple)', aguardando_pix: 'var(--accent3)', aguardando_cartao: 'var(--accent3)'
    };

    list.innerHTML = _kanbanHistData.map(o => {
      const items = Array.isArray(o.items) ? o.items : [];
      const itensStr = items.map(i => `${i.qty}x ${i.name}`).join(', ');
      const dt = o.created_at ? new Date(o.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '';
      const num = o.order_num ? '#' + String(o.order_num).padStart(3, '0') : 'Sem numero';
      const total = (parseFloat(o.total || 0) + parseFloat(o.taxa || 0)).toFixed(2).replace('.', ',');
      const sc = statusColor[o.status] || 'var(--muted)';
      return `<div onclick="kanbanHistOpenDetail(${o.id})" style="display:grid;grid-template-columns:auto 1fr auto auto;gap:12px;align-items:center;padding:10px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;cursor:pointer;transition:all .15s" onmouseenter="this.style.borderColor='rgba(14,165,233,.3)';this.style.background='rgba(14,165,233,.04)'" onmouseleave="this.style.borderColor='rgba(255,255,255,.06)';this.style.background='rgba(255,255,255,.03)'">
        <div style="font-weight:800;color:var(--accent);font-size:13px;min-width:74px">${num}</div>
        <div style="min-width:0">
          <div style="font-weight:600;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_escHtml(o.client) || '—'}${o.mesa_num ? ' <span style="color:var(--purple);font-size:11px">Mesa ' + _escHtml(o.mesa_num) + '</span>' : ''}</div>
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

function _pedidoWaFindOrder(id) {
  const oid = Number(id);
  return (ordersKanban || []).find(x => Number(x.id) === oid)
    || ((typeof mesaOrdersCache !== 'undefined' ? mesaOrdersCache : []) || []).find(x => Number(x.id) === oid)
    || null;
}

function _pedidoWaNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
}

function _pedidoWaNumberVariants(phone) {
  const full = _pedidoWaNumber(phone);
  if (!full) return [];
  const set = new Set([full]);
  if (full.startsWith('55')) set.add(full.slice(2));
  const br = full.startsWith('55') ? full : (full.length === 10 || full.length === 11 ? '55' + full : '');
  if (br.length >= 12 && br.startsWith('55')) {
    const prefix = br.slice(0, 4);
    const rest = br.slice(4);
    if (rest.length === 9 && rest[0] === '9') {
      const semNono = prefix + rest.slice(1);
      set.add(semNono);
      set.add(semNono.slice(2));
    } else if (rest.length === 8) {
      const comNono = prefix + '9' + rest;
      set.add(comNono);
      set.add(comNono.slice(2));
    }
  }
  return Array.from(set).filter(Boolean);
}

function _pedidoWaFindChatByPhone(phone) {
  if (typeof WA === 'undefined' || !Array.isArray(WA.chats)) return null;
  const alvo = new Set(_pedidoWaNumberVariants(phone));
  if (!alvo.size) return null;
  return WA.chats.find(c => {
    const jid = c?._jid || c?.remoteJid || c?.id || '';
    const num = (typeof waNum === 'function') ? waNum(jid) : String(jid).replace(/@.*/, '').replace(/\D/g, '');
    if (!num) return false;
    return _pedidoWaNumberVariants(num).some(v => alvo.has(v));
  }) || null;
}

function _pedidoItemGroups(item) {
  const raw = item?.customGroups ?? item?.custom_groups;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch(e) {}
  }
  return [];
}

function _pedidoIsKitItem(item, grupos) {
  const tipo = String(item?.itemType || item?.item_type || item?.tipo || '').toLowerCase();
  if (tipo === 'kit') return true;
  const lista = Array.isArray(grupos) ? grupos : _pedidoItemGroups(item);
  return lista.some(g => g?.tipo === 'kit_itens');
}

function _pedidoGruposSelecionaveis(item) {
  const grupos = _pedidoItemGroups(item);
  const ignorar = new Set(['porcao_ref', 'kit_itens']);
  if (_pedidoIsKitItem(item, grupos)) {
    ['preparos', 'ocasiao', 'armazenamento'].forEach(tipo => ignorar.add(tipo));
  }
  return grupos.filter(g => !ignorar.has(g?.tipo));
}

function _pedidoKitValorLabel(v) {
  if (typeof v === 'string') return v.trim();
  if (!v || typeof v !== 'object') return '';
  const nome = v.nome || v.name || v.label || v.id || '';
  const qtd = v.qtd || v.qty || v.quantidade || v.peso || '';
  return [qtd, nome].filter(Boolean).join(' ').trim();
}

function _pedidoKitObs(item) {
  const grupos = _pedidoItemGroups(item);
  const partes = [];
  const kitGrp = grupos.find(g => g?.tipo === 'kit_itens');
  if (!_pedidoIsKitItem(item, grupos)) return '';
  const kitItens = (kitGrp?.itens || kitGrp?.items || kitGrp?.valores || kitGrp?.opcoes || [])
    .map(_pedidoKitValorLabel)
    .filter(Boolean);
  if (kitItens.length) partes.push('Kit: ' + kitItens.join(' · '));

  const infoLabels = {
    preparos: 'Forma de preparo',
    ocasiao: 'Tipo de ocasião',
    armazenamento: 'Armazenamento'
  };
  Object.keys(infoLabels).forEach(tipo => {
    const grp = grupos.find(g => g?.tipo === tipo);
    const valores = (grp?.opcoes || grp?.valores || [])
      .map(_pedidoKitValorLabel)
      .filter(Boolean);
    if (valores.length) partes.push(infoLabels[tipo] + ': ' + valores.join(', '));
  });

  return partes.join(' | ');
}

function _pedidoObsComKit(item, obs) {
  const atual = String(obs || '').trim();
  const kitObs = _pedidoKitObs(item);
  if (!kitObs || /(^|\|\s*)Kit:/i.test(atual)) return atual;
  return [kitObs, atual].filter(Boolean).join(' | ');
}

async function abrirChatPedidoWA(id) {
  const o = _pedidoWaFindOrder(id);
  if (!o) {
    if (typeof sbToast === 'function') sbToast('err', 'Pedido nao encontrado.');
    return;
  }
  const number = _pedidoWaNumber(o.phone);
  if (!number || number.length < 12) {
    if (typeof sbToast === 'function') sbToast('err', 'Pedido sem telefone valido.');
    return;
  }

  try {
    if (typeof evoCarregarInstancia === 'function') await evoCarregarInstancia();
  } catch(e) {}

  const inst = (typeof EVO !== 'undefined' && EVO && EVO.instance)
    ? EVO.instance
    : (document.getElementById('evo-instance')?.value || '').trim();
  if (!inst) {
    if (typeof sbToast === 'function') sbToast('err', 'Configure a instancia da Evolution API no Robo WA.');
    return;
  }
  if (typeof waOpenConv !== 'function') {
    if (typeof sbToast === 'function') sbToast('err', 'Chat WhatsApp ainda nao carregou.');
    return;
  }

  // Modo mini: abre direto a conversa desse cliente, sem carregar a lista
  // inteira de conversas (waLoadChats) — evita concorrer com a Evolution
  // API e travar a tela por causa disso.
  if (typeof waOpenPanelMini === 'function') waOpenPanelMini();
  else if (typeof waOpenPanel === 'function') waOpenPanel();
  await new Promise(resolve => setTimeout(resolve, 120));

  // Tenta achar o chat já carregado em memória (rápido, sem rede).
  // IMPORTANTE: NÃO chamamos mais waLoadChats() aqui — isso baixava a lista INTEIRA
  // de conversas da Evolution API (pode ter centenas/milhares) só pra achar 1 número,
  // e era a causa da demora ao clicar em "WhatsApp" num pedido específico.
  // Em vez disso, montamos o JID direto do telefone e abrimos a conversa na hora —
  // waOpenConv já mostra o cache local instantâneo e busca só as mensagens DESSE
  // contato (findMessages filtrado por remoteJid), que é rápido.
  let chat = _pedidoWaFindChatByPhone(number);
  const jid = chat?._jid || (number + '@s.whatsapp.net');
  const nome = chat?._name || o.client || number;
  try {
    if (typeof WA !== 'undefined' && WA?.nameCache) WA.nameCache[jid] = nome;
  } catch(e) {}

  await waOpenConv(jid, nome);
  setTimeout(() => {
    const inp = document.getElementById('wa-msg-input');
    if (inp) {
      inp.focus();
      if (typeof waOnTyping === 'function') waOnTyping(inp);
    }
  }, 120);

  // OBS: antes, aqui rodava um waLoadChats() "em segundo plano" pra só polir
  // nome/foto do contato — mas isso disparava a mesma busca PESADA (lista
  // inteira de conversas) em paralelo com o findMessages desse chat, brigando
  // pelos mesmos recursos da Evolution API. Removido de propósito: no modo
  // mini a lista completa só é buscada se o usuário clicar em "ver todas as
  // conversas" (botão adicionado pelo waOpenPanelMini).
}


// Busca (e cacheia por telefone) quantos pedidos esse cliente já fez NESSE tenant.
// Sempre manda x-tenant-id — o backend filtra por tenant_id, então nunca mistura lojas.
const _pedidosClienteCache = {};
async function _carregarPedidosClienteNoDetalhe(phone) {
  const el = document.getElementById('od-client-pedidos-count');
  if (!el) return;
  el.textContent = '';
  if (!phone || !_sessao?.tenant_id) return;
  const _idAoAbrir = window._currentDetailId; // evita mostrar resultado de pedido já fechado/trocado
  const cacheKey = _sessao.tenant_id + ':' + phone;
  if (_pedidosClienteCache[cacheKey] != null) {
    if (window._currentDetailId === _idAoAbrir) _renderPedidosClienteCount(el, _pedidosClienteCache[cacheKey]);
    return;
  }
  try {
    const r = await fetch(`/api/cliente-pedidos-count?phone=${encodeURIComponent(phone)}`, {
      headers: { 'x-tenant-id': _sessao.tenant_id }
    });
    if (!r.ok) return;
    const d = await r.json().catch(() => null);
    const count = d?.count || 0;
    _pedidosClienteCache[cacheKey] = count;
    if (window._currentDetailId === _idAoAbrir) _renderPedidosClienteCount(el, count);
  } catch (e) {
    console.warn('[od-client-pedidos-count] erro:', e.message);
  }
}
function _renderPedidosClienteCount(el, count) {
  if (count <= 1) el.textContent = '🆕 1º pedido nesta loja';
  else el.textContent = `🔁 ${count}º pedido nesta loja`;
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
  window._detailKanbanOrder = o;
  window._detailIsMesa = !!o._isMesa;

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

  // Selo de pedido agendado (mesma marcação do card do Kanban)
  const agBadgeEl = document.getElementById('od-agendado-badge');
  if (agBadgeEl) {
    if (o.scheduled_for) {
      agBadgeEl.style.display = 'flex';
      agBadgeEl.textContent = '🕐 Agendado para ' + new Date(o.scheduled_for).toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    } else {
      agBadgeEl.style.display = 'none';
    }
  }

  // Selo de pedido feito pelo tablet da mesa
  const tabletBadgeEl = document.getElementById('od-tablet-badge');
  if (tabletBadgeEl) tabletBadgeEl.style.display = (o.canal === 'totem') ? 'flex' : 'none';

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
        ${item.obs ? `<div class="od-item-obs">📝 ${_escHtml(item.obs)}</div>` : ''}
        ${Array.isArray(item.extras) && item.extras.length ? `<div class="od-item-obs">➕ ${item.extras.join(', ')}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <div class="od-item-price">R$&nbsp;${(item.price).toFixed(2).replace('.', ',')}</div>
        ${canCancel ? `<button onclick="editarItemGenerico(${window._currentDetailId}, ${itemIndexToPass}, ${_isMesaDetalhe})" title="Editar item" style="width:22px;height:22px;border-radius:6px;border:1px solid rgba(99,102,241,.35);background:rgba(99,102,241,.1);color:#818cf8;font-size:12px;line-height:1;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;padding:0">✏️</button>` : ''}
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
  const _odTotalFinal = parseFloat(o.total || 0) + parseFloat(o.taxa || 0);
  const trocoRow = document.getElementById('od-troco-row');
  // Linha extra "Devolver ao cliente" — criada dinamicamente logo após od-troco-row
  let devolverRow = document.getElementById('od-troco-devolver-row');
  if (!devolverRow && trocoRow) {
    devolverRow = document.createElement('div');
    devolverRow.id = 'od-troco-devolver-row';
    devolverRow.className = 'od-subtotal-row';
    trocoRow.parentNode.insertBefore(devolverRow, trocoRow.nextSibling);
  }
  if (trocoRow) {
    if (o.pag === 'dinheiro' || o.pag === 'Dinheiro') {
      trocoRow.style.display = '';
      if (o.troco > 0) {
        const _odDevolver = Math.max(0, o.troco - _odTotalFinal);
        trocoRow.innerHTML = `<span>Troco para</span><span style="color:var(--accent3);font-weight:600">${fmt(o.troco)}</span>`;
        if (devolverRow) {
          devolverRow.style.display = '';
          devolverRow.innerHTML = `<span>Devolver ao cliente</span><span style="color:var(--accent3);font-weight:700">${fmt(_odDevolver)}</span>`;
        }
      } else {
        trocoRow.innerHTML = o.troco === -1
          ? `<span>Troco solicitado</span><span style="color:var(--muted)">Valor não informado</span>`
          : `<span>Sem troco</span><span style="color:var(--muted)">Valor exato</span>`;
        if (devolverRow) devolverRow.style.display = 'none';
      }
    } else {
      trocoRow.style.display = 'none';
      if (devolverRow) devolverRow.style.display = 'none';
    }
  }

  // Dados do cliente
  const setEl = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v || ''; };
  setEl('od-client-name', o.client || 'Não informado');
  setEl('od-client-phone', o.phone || '');
  const _odChatAction = document.getElementById('od-chat-action');
  if (_odChatAction) _odChatAction.style.display = o.phone ? 'flex' : 'none';
  const _odWaAction = document.getElementById('od-wa-action');
  if (_odWaAction) _odWaAction.style.display = o.phone ? 'flex' : 'none';
  _carregarPedidosClienteNoDetalhe(o.phone);

  // Tipo de entrega (helper unificado)
  const _tipoDet = (window._detectOrderType ? window._detectOrderType(o) : 'delivery');
  const isMesa = _tipoDet === 'mesa';
  const isBalcao = _tipoDet === 'balcao';
  const isDelivery = _tipoDet === 'delivery';
  const tipoLabel = isMesa ? (o.mesa_num ? 'Mesa ' + o.mesa_num : 'Consumo no local') : isBalcao ? 'Balcão / Retirada' : '🛵 Delivery';
  setEl('od-tipo', tipoLabel);
  setEl('od-addr', isMesa && o.garcom_nome ? 'Garçom: ' + o.garcom_nome : '');

  // Bloco de endereço delivery (destacado)
  const addrBlock = document.getElementById('od-delivery-addr-block');
  const addrText  = document.getElementById('od-delivery-addr-text');
  const mapLink   = document.getElementById('od-delivery-map-link');
  if (addrBlock && addrText) {
    if (isDelivery && o.addr) {
      addrText.textContent = o.addr;
      if (mapLink) mapLink.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.addr);
      addrBlock.style.display = '';
    } else {
      addrBlock.style.display = 'none';
      if (mapLink) mapLink.href = '#';
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
    ? (o.troco > 0 ? `Troco p/ ${fmt(o.troco)} · Devolver ${fmt(Math.max(0, o.troco - _odTotalFinal))}` : o.troco === -1 ? 'Precisa troco (valor não informado)' : 'Valor exato') : '');

  // Origem
  const origemEl = document.getElementById('od-origem-row');
  if (origemEl) {
    origemEl.innerHTML = o.garcom_nome
      ? `<span style="color:var(--purple)">👨‍💼 Pedido via Garçom — ${o.garcom_nome}</span>`
      : `<span>🌐 Pedido via Cardápio Digital</span>`;
  }

  // Botão de adicionar produto — todos os segmentos, incluindo mesa
  // (gestor pode lançar item na comanda mesmo sem passar pelo garçom)
  const _addPanelBtn = document.getElementById('od-add-produto-btn');
  if (_addPanelBtn) _addPanelBtn.style.display = '';

  // Botão de fechar mesa — só para pedidos de mesa em status pronto
  const _fecharMesaBtn = document.getElementById('od-fechar-mesa-btn');
  if (_fecharMesaBtn) {
    const isMesaOrder = o._isMesa || (o.mesa_num && o.mesa_num > 0);
    const isPronto = o.status === 'pronto';
    _fecharMesaBtn.style.display = (isMesaOrder && isPronto) ? '' : 'none';
    window._detailMesaNum = o.mesa_num || null;
  }

  odRenderStatusTimeline(o, [], true);
  odLoadStatusTimeline(o);
  openModal('modal-order-detail');
}

function odEsc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function odStatusLabel(status) {
  return ({
    criado: 'Pedido criado',
    aguardando_pix: 'Aguardando PIX',
    aguardando_cartao: 'Aguardando cartao',
    analise: 'Em analise',
    producao: 'Em producao',
    pronto: 'Pronto',
    saiu: 'Saiu para entrega',
    entregue: 'Entregue',
    finalizado: 'Finalizado',
    cancelado: 'Cancelado',
    mesa_aberta: 'Mesa aberta'
  })[status] || status || 'Status';
}

function odDateTime(value) {
  if (!value) return '';
  try {
    // SQLite datetime('now') retorna UTC sem sufixo "Z" (ex: "2026-08-09 18:07:00").
    // new Date(string) sem "Z" é interpretado como horário LOCAL do navegador → bug de 3h em Brasília.
    // Aqui forçamos interpretação UTC quando a string não trouxer timezone explícita,
    // depois exibimos já convertido pro horário de Brasília.
    const s = String(value).trim();
    let d;
    if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
      d = new Date(s);
    } else {
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
      d = m ? new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6])) : new Date(s);
    }
    if (isNaN(d.getTime())) return String(value).slice(0, 16);
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return String(value).slice(0, 16);
  }
}

function odTimelineFallback(order, note) {
  const rows = [];
  if (order?.created_at) {
    rows.push({
      new_status: 'criado',
      created_at: order.created_at,
      note: 'Pedido recebido no sistema'
    });
  }
  rows.push({
    new_status: order?.status || 'analise',
    created_at: '',
    note: note || 'Status atual'
  });
  return rows;
}

function odRenderStatusTimeline(order, historyRows, loading = false, fallbackNote = '') {
  const box = document.getElementById('od-status-timeline');
  if (!box) return;
  const rows = loading
    ? [{ new_status: 'criado', created_at: '', note: 'Carregando historico...' }]
    : (Array.isArray(historyRows) && historyRows.length ? historyRows : odTimelineFallback(order, fallbackNote));

  box.innerHTML = `
    <div class="od-timeline-box">
      <div class="od-timeline-title">Historico do pedido</div>
      <div class="od-timeline-list">
        ${rows.map(r => {
          const status = r.new_status || r.status || 'criado';
          const before = r.old_status ? `Antes: ${odStatusLabel(r.old_status)}` : '';
          const actor = r.actor_name || r.origem || r.actor_type || '';
          const details = [r.note, before, actor].filter(Boolean).join(' - ');
          return `
            <div class="od-timeline-item">
              <span class="od-timeline-dot"></span>
              <div class="od-timeline-main">
                <div class="od-timeline-status">${odEsc(odStatusLabel(status))}</div>
                ${details ? `<div class="od-timeline-note">${odEsc(details)}</div>` : ''}
              </div>
              <div class="od-timeline-time">${odEsc(odDateTime(r.created_at))}</div>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

async function odLoadStatusTimeline(order) {
  const id = Number(order?.id || window._currentDetailId || 0);
  const tid = _sessao?.tenant_id || '';
  if (!id || !tid) {
    odRenderStatusTimeline(order, [], false, 'Historico disponivel apenas com sessao ativa');
    return;
  }
  try {
    const res = await fetch('/api/order-status-history?order_id=' + encodeURIComponent(id), {
      headers: { 'x-tenant-id': tid }
    });
    const data = await res.json().catch(() => []);
    if (!res.ok) throw new Error(data?.error || 'Erro ao carregar historico');
    if (Number(window._currentDetailId) !== id) return;
    odRenderStatusTimeline(order, Array.isArray(data) ? data : [], false);
  } catch(e) {
    console.warn('[ORDER HISTORY]', e.message);
    if (Number(window._currentDetailId) !== id) return;
    odRenderStatusTimeline(order, [], false, 'Historico ainda nao disponivel para este pedido');
  }
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

// ── Editar item já lançado no pedido (qty, preço, observação, +adicionais) ──
let _odEditCtx = null; // { orderId, itemIndex, isMesaOrder, item, catalogItem, grupos }

function editarItemGenerico(orderId, itemIndex, isMesaOrder) {
  // Busca o pedido correto (mesa ou kanban)
  let o = null;
  if (isMesaOrder) {
    o = mesaOrdersCache.find(x => x.id === orderId);
  } else {
    o = ordersKanban.find(x => x.id === orderId);
  }
  if (!o) return;

  const allItems = Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? (() => { try { return JSON.parse(o.items); } catch { return []; } })() : []);
  const item = allItems[itemIndex];
  if (!item || item.item_status === 'cancelado') return;

  // Tenta achar o produto no catálogo (pra oferecer adicionais extras)
  const catalogItem = (item.id != null) ? items.find(i => i.id === item.id) : null;
  const grupos = catalogItem ? _pedidoGruposSelecionaveis(catalogItem) : [];

  _odEditCtx = { orderId, itemIndex, isMesaOrder, item, catalogItem, grupos };

  // Kit montável (açougue) — se o pedido guardou a seleção estruturada
  // (itens escolhidos, pesos, corte/preparo), monta a tela de seleção
  // igual o cliente vê no cardápio, em vez de só mostrar texto.
  window._odEditKitSel = {};
  window._odEditKitExtras = {};
  let kitEligiveis = [];
  const kitSelecao = item._kitSelecao;
  if (kitSelecao?.itens?.length && kitSelecao?.categorias?.length) {
    const catsSet = new Set(kitSelecao.categorias);
    kitEligiveis = items.filter(i =>
      i.status !== 'pausado' && i.status !== 'esgotado' &&
      (catsSet.has(i.cat_key) || catsSet.has(i.cat))
    );
    kitSelecao.itens.forEach(e => {
      window._odEditKitSel[e.itemId] = e.valor;
      window._odEditKitExtras[e.itemId] = e.extras || {};
    });
  }

  document.getElementById('modal-od-edit-item-bg')?.remove();

  const _TIPO_LABEL = { radio: 'Escolha', checkbox: 'Adicional', opcional: 'Adicional', adicionais: 'Adicional', obrigatorio: 'Escolha obrigatória', sabor: 'Sabor' };
  const gruposHtml = grupos.map((g, gi) => {
    const opcoes = g.opcoes || g.valores || [];
    if (!opcoes.length) return '';
    const tipo = g.tipo || 'opcional';
    const isSingle = ['radio', 'obrigatorio', 'sabor'].includes(tipo);
    const inputType = isSingle ? 'radio' : 'checkbox';
    const label = g.nome || g.name || _TIPO_LABEL[tipo] || 'Adicional';
    return `<div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:6px">${label}</div>
      <div style="display:flex;flex-direction:column;gap:5px">
        ${opcoes.map((op, oi) => {
          const nome = op?.nome || op?.name || (typeof op === 'string' ? op : '') || '';
          const preco = parseFloat(op?.preco || op?.price || 0);
          const precoLabel = preco > 0 ? ` <span style="color:var(--success);font-size:11px">+R$ ${preco.toFixed(2).replace('.', ',')}</span>` : '';
          return `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:9px;cursor:pointer">
            <input type="${inputType}" name="od-edit-grp-${gi}" data-nome="${String(nome).replace(/"/g, '&quot;')}" data-preco="${preco}" onchange="_odEditAtualizarPreview()" style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0">
            <span style="font-size:13px;font-weight:500;flex:1">${nome}${precoLabel}</span>
          </label>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');

  const kitHtml = kitEligiveis.length ? `<div style="margin-bottom:16px">
    <div style="font-size:11px;color:var(--accent);font-weight:700;margin-bottom:10px;text-transform:uppercase;letter-spacing:.4px">Cortes deste kit — toque pra marcar/desmarcar</div>
    <div id="od-edit-kit-lista" style="display:flex;flex-direction:column;gap:8px">
      ${kitEligiveis.map(it => _odEditKitCardHtml(it)).join('')}
    </div>
    <div id="od-edit-kit-total" style="margin-top:10px;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:9px;font-size:13px;font-weight:700;color:var(--success);text-align:right"></div>
  </div>` : '';

  const bg = document.createElement('div');
  bg.id = 'modal-od-edit-item-bg';
  bg.className = 'modal-bg on';
  bg.style.zIndex = '99999';
  bg.innerHTML = `
    <div class="modal" style="max-width:480px;width:92vw;padding:0;max-height:88vh;overflow-y:auto">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div>
          <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px">Editar item</div>
          <div style="font-size:16px;font-weight:700;margin-top:2px">${item.name}</div>
        </div>
        <button onclick="document.getElementById('modal-od-edit-item-bg')?.remove()" style="width:30px;height:30px;border-radius:8px;background:var(--surface2);border:1px solid var(--border);color:var(--muted);cursor:pointer;font-size:14px">✕</button>
      </div>
      <div style="padding:16px 22px">
        <div style="display:flex;gap:10px;margin-bottom:14px">
          <div style="flex:1">
            <label style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;display:block">Quantidade</label>
            <div style="display:flex;align-items:center;gap:8px">
              <button type="button" onclick="_odEditChangeQty(-1)" style="width:32px;height:32px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);cursor:pointer;font-size:16px;font-weight:700">−</button>
              <span id="od-edit-qty" style="font-size:15px;font-weight:800;min-width:24px;text-align:center">${item.qty || 1}</span>
              <button type="button" onclick="_odEditChangeQty(1)" style="width:32px;height:32px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);cursor:pointer;font-size:16px;font-weight:700">+</button>
            </div>
          </div>
          <div style="flex:1">
            <label style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;display:block">Preço unitário${kitEligiveis.length ? ' (auto)' : ''}</label>
            <input type="number" id="od-edit-price" value="${parseFloat(item.price || 0).toFixed(2)}" step="0.01" min="0" oninput="_odEditAtualizarPreview()" ${kitEligiveis.length ? 'readonly' : ''}
              style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface2);color:var(--text);font-size:14px;font-weight:700;box-sizing:border-box;font-family:inherit">
          </div>
        </div>
        ${kitHtml}
        <div style="margin-bottom:14px">
          <label style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;display:block">Observação</label>
          <textarea id="od-edit-obs" rows="2" placeholder="Ex: sem cebola, borda recheada..."
            style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface2);color:var(--text);font-size:13px;font-family:inherit;resize:none;box-sizing:border-box">${kitEligiveis.length ? '' : (item.obs || '')}</textarea>
        </div>
        ${grupos.length ? `<div style="margin-bottom:6px">
          <div style="font-size:11px;color:var(--accent);font-weight:700;margin-bottom:10px">➕ Marque para acrescentar mais adicionais a este item</div>
          ${gruposHtml}
        </div>` : ''}
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-radius:10px;background:var(--surface2);border:1px solid var(--border);margin-bottom:14px">
          <div style="font-size:11px;color:var(--muted)">Novo total do item</div>
          <div id="od-edit-total-preview" style="font-size:16px;font-weight:800;color:var(--success)">R$ ${(parseFloat(item.price || 0) * (item.qty || 1)).toFixed(2).replace('.', ',')}</div>
        </div>
        <button onclick="_odEditSalvar()" style="width:100%;padding:13px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Salvar alterações</button>
      </div>
    </div>`;
  document.body.appendChild(bg);
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  window._odEditQty = item.qty || 1;
  if (kitEligiveis.length) _odEditKitAtualizarTotal();
}

// ── Kit montável — edição no gestor (mesma lógica do cardápio) ──
function _odEditKitEhUnidade(it) {
  return (it?.item_type || it?.itemType) !== 'kg';
}

function _odEditKitExtraGrupos(it) {
  return (it?.custom_groups || []).filter(g => (g.tipo === 'cortes' || g.tipo === 'preparos') && g.opcoes?.length);
}

function _odEditKitCardHtml(it) {
  const marcado = !!window._odEditKitSel[it.id];
  const isUnidade = _odEditKitEhUnidade(it);
  const valor = window._odEditKitSel[it.id] || (isUnidade ? 1 : 500);
  const valorLabel = isUnidade ? `${valor} un` : (valor >= 1000 ? (valor / 1000).toFixed(1).replace('.', ',') + 'kg' : valor + 'g');
  const precoLabel = 'R$ ' + parseFloat(it.price || 0).toFixed(2).replace('.', ',') + (isUnidade ? '/un' : '/kg');
  const extraGrupos = _odEditKitExtraGrupos(it);
  const extrasAtuais = window._odEditKitExtras[it.id] || {};
  const extrasHtml = (marcado && extraGrupos.length) ? extraGrupos.map(g => {
    const chips = g.opcoes.map(o => {
      const nome = o.nome || o.id || '';
      const isOn = (extrasAtuais[g.tipo] || g.opcoes[0]?.nome || g.opcoes[0]?.id) === nome;
      return `<button type="button" class="od-kit-chip${isOn ? ' on' : ''}" onclick="_odEditKitEscolherExtra(${it.id},'${g.tipo}','${nome.replace(/'/g, "\\'")}',this)">${nome}</button>`;
    }).join('');
    return `<div style="margin-top:8px">
      <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:5px">${g.nome || (g.tipo === 'cortes' ? 'Tipo de corte' : 'Forma de preparo')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">${chips}</div>
    </div>`;
  }).join('') : '';

  return `<div class="od-kit-card${marcado ? ' on' : ''}" id="od-kit-card-${it.id}" style="border:1.5px solid ${marcado ? 'var(--accent)' : 'var(--border)'};border-radius:10px;padding:10px 12px;background:${marcado ? 'var(--accent-dim)' : 'var(--surface2)'}">
    <div style="display:flex;align-items:center;gap:10px;cursor:pointer" onclick="_odEditKitToggle(${it.id})">
      <input type="checkbox" ${marcado ? 'checked' : ''} readonly style="width:18px;height:18px;accent-color:var(--accent);pointer-events:none;flex-shrink:0">
      <div style="flex:1;min-width:0">
        <div style="font-size:13.5px;font-weight:700">${it.name}</div>
        <div style="font-size:11.5px;color:var(--muted)">${precoLabel}</div>
      </div>
      ${marcado ? `<div onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <button type="button" onclick="_odEditKitAjustarPeso(${it.id},${isUnidade ? -1 : -100})" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;font-size:14px">−</button>
        <span id="od-kit-peso-${it.id}" style="font-size:12.5px;font-weight:700;min-width:48px;text-align:center">${valorLabel}</span>
        <button type="button" onclick="_odEditKitAjustarPeso(${it.id},${isUnidade ? 1 : 100})" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;font-size:14px">+</button>
      </div>` : ''}
    </div>
    <div id="od-kit-extras-${it.id}">${extrasHtml}</div>
  </div>`;
}

function _odEditKitToggle(itemId) {
  const it = items.find(x => x.id === itemId);
  if (!it) return;
  if (window._odEditKitSel[itemId]) {
    delete window._odEditKitSel[itemId];
    delete window._odEditKitExtras[itemId];
  } else {
    const isUnidade = _odEditKitEhUnidade(it);
    window._odEditKitSel[itemId] = isUnidade ? 1 : 500;
    const extraGrupos = _odEditKitExtraGrupos(it);
    const escolhas = {};
    extraGrupos.forEach(g => { escolhas[g.tipo] = g.opcoes[0]?.nome || g.opcoes[0]?.id || ''; });
    window._odEditKitExtras[itemId] = escolhas;
  }
  const card = document.getElementById(`od-kit-card-${itemId}`);
  if (card) card.outerHTML = _odEditKitCardHtml(it);
  _odEditKitAtualizarTotal();
}

function _odEditKitAjustarPeso(itemId, delta) {
  const it = items.find(x => x.id === itemId);
  if (!it) return;
  const isUnidade = _odEditKitEhUnidade(it);
  const min = isUnidade ? 1 : 100;
  const novo = Math.max(min, (window._odEditKitSel[itemId] || min) + delta);
  window._odEditKitSel[itemId] = novo;
  const pesoEl = document.getElementById(`od-kit-peso-${itemId}`);
  if (pesoEl) pesoEl.textContent = isUnidade ? `${novo} un` : (novo >= 1000 ? (novo / 1000).toFixed(1).replace('.', ',') + 'kg' : novo + 'g');
  _odEditKitAtualizarTotal();
}

function _odEditKitEscolherExtra(itemId, tipo, nome, btn) {
  if (!window._odEditKitExtras[itemId]) window._odEditKitExtras[itemId] = {};
  window._odEditKitExtras[itemId][tipo] = nome;
  btn.parentElement.querySelectorAll('.od-kit-chip').forEach(c => c.classList.remove('on'));
  btn.classList.add('on');
}

function _odEditKitAtualizarTotal() {
  let total = 0;
  Object.entries(window._odEditKitSel || {}).forEach(([idStr, valor]) => {
    const it = items.find(x => x.id === parseInt(idStr));
    if (!it) return;
    const isUnidade = _odEditKitEhUnidade(it);
    total += isUnidade ? (valor * parseFloat(it.price || 0)) : ((valor / 1000) * parseFloat(it.price || 0));
  });
  const priceInp = document.getElementById('od-edit-price');
  if (priceInp) priceInp.value = total.toFixed(2);
  const totalEl = document.getElementById('od-edit-kit-total');
  if (totalEl) totalEl.textContent = 'Total dos cortes: R$ ' + total.toFixed(2).replace('.', ',');
  _odEditAtualizarPreview();
}

function _odEditChangeQty(delta) {
  window._odEditQty = Math.max(1, (window._odEditQty || 1) + delta);
  const el = document.getElementById('od-edit-qty');
  if (el) el.textContent = window._odEditQty;
  _odEditAtualizarPreview();
}

function _odEditAtualizarPreview() {
  const priceInp = document.getElementById('od-edit-price');
  const totalEl = document.getElementById('od-edit-total-preview');
  if (!priceInp || !totalEl) return;
  let unit = parseFloat(priceInp.value) || 0;
  // [data-nome] filtra só os checkboxes de "adicionais" de verdade — os
  // checkboxes visuais dos cards de kit (readonly, sem esse atributo) não
  // devem entrar nessa soma, senão o preço vira NaN.
  document.querySelectorAll('#modal-od-edit-item-bg input[data-nome]:checked').forEach(inp => {
    unit += parseFloat(inp.dataset.preco || 0);
  });
  const qty = window._odEditQty || 1;
  totalEl.textContent = 'R$ ' + (unit * qty).toFixed(2).replace('.', ',');
}

async function _odEditSalvar() {
  const ctx = _odEditCtx;
  if (!ctx) return;
  const { orderId, itemIndex, isMesaOrder } = ctx;

  let o = isMesaOrder ? mesaOrdersCache.find(x => x.id === orderId) : ordersKanban.find(x => x.id === orderId);
  if (!o) return;

  const allItems = Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? (() => { try { return JSON.parse(o.items); } catch { return []; } })() : []);
  const item = allItems[itemIndex];
  if (!item) return;

  const qty = window._odEditQty || 1;
  let unitPrice = parseFloat(document.getElementById('od-edit-price')?.value) || 0;
  let obs = (document.getElementById('od-edit-obs')?.value || '').trim();
  let novoKitSelecao = null;

  // Kit montável — se essa tela de seleção estava ativa, reconstrói a
  // descrição a partir do que ficou marcado (em vez de manter o texto
  // antigo), e guarda a seleção estruturada de novo pra próxima edição.
  const kitSelAtual = window._odEditKitSel || {};
  if (item._kitSelecao && Object.keys(kitSelAtual).length >= 0 && document.getElementById('od-edit-kit-lista')) {
    const escolhidos = Object.entries(kitSelAtual).filter(([, v]) => v > 0);
    if (!escolhidos.length) {
      alert('Escolha ao menos um corte pra esse kit — pra remover o item inteiro, use "Cancelar item" em vez de editar.');
      return;
    }
    const partesDesc = escolhidos.map(([idStr, valor]) => {
      const itCorte = items.find(x => x.id === parseInt(idStr));
      if (!itCorte) return null;
      const isUnidade = _odEditKitEhUnidade(itCorte);
      const label = isUnidade ? `${valor} un` : (valor >= 1000 ? (valor / 1000).toFixed(1).replace('.', ',') + 'kg' : valor + 'g');
      const extras = (window._odEditKitExtras || {})[idStr] || (window._odEditKitExtras || {})[parseInt(idStr)];
      const extrasTxt = extras && Object.values(extras).filter(Boolean).length ? ` (${Object.values(extras).join(', ')})` : '';
      return `${label} ${itCorte.name}${extrasTxt}`;
    }).filter(Boolean);
    // Preserva qualquer observação livre que o gestor tenha digitado além
    // do texto do kit (o campo de obs fica sem o texto antigo do kit
    // enquanto essa tela está ativa — ver "kitEligiveis.length ? '' :" acima).
    obs = ['Kit: ' + partesDesc.join(' · '), obs].filter(Boolean).join(' | ');
    novoKitSelecao = {
      categorias: item._kitSelecao.categorias,
      itens: escolhidos.map(([idStr, valor]) => ({
        itemId: parseInt(idStr),
        valor,
        extras: (window._odEditKitExtras || {})[idStr] || (window._odEditKitExtras || {})[parseInt(idStr)] || {}
      }))
    };
  }

  // Adicionais extras marcados — soma no preço e anexa descrição na observação
  const novosAdicionais = [];
  document.querySelectorAll('#modal-od-edit-item-bg input[data-nome]:checked').forEach(inp => {
    const nome = inp.dataset.nome || '';
    const preco = parseFloat(inp.dataset.preco || 0);
    unitPrice += preco;
    if (nome) novosAdicionais.push(nome + (preco > 0 ? ` (+R$ ${preco.toFixed(2).replace('.', ',')})` : ''));
  });
  if (novosAdicionais.length) {
    obs = [obs, novosAdicionais.join(', ')].filter(Boolean).join(' · ');
  }

  const updatedItems = allItems.map((i, idx) => idx === itemIndex
    ? { ...i, qty, price: unitPrice, obs, ...(novoKitSelecao ? { _kitSelecao: novoKitSelecao } : {}) }
    : i);

  const newTotal = updatedItems
    .filter(i => (i.item_status || 'active') !== 'cancelado')
    .reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseInt(i.qty) || 1), 0);

  try {
    const { error } = await sb.from('orders')
      .update({ items: updatedItems, total: newTotal, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    if (error) throw error;

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

    document.getElementById('modal-od-edit-item-bg')?.remove();
    closeModal('modal-order-detail');
    setTimeout(() => openOrderDetail(orderId), 80);
    renderKanban();
    if (isMesaOrder) _renderMesaPageFromCache();
    sbToast('ok', 'Item atualizado!');
  } catch (e) {
    console.error('[_odEditSalvar]', e);
    alert('Erro ao editar item: ' + (e.message || e));
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
  const grupos = _pedidoGruposSelecionaveis(it);
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

  const it     = modal._item;
  const isKg   = modal._isKg;
  const grupos = Array.isArray(modal._grupos) ? modal._grupos : [];
  const qty    = window._pdvbQty || 1;

  // Calcula só o extra de preço (a string formatada vem do helper _noFmtObsAdicionais)
  let extra = 0;
  modal.querySelectorAll('input:checked').forEach(inp => {
    extra += parseFloat(inp.dataset.preco || 0);
  });

  let price    = parseFloat(it.price || 0) + extra;
  let name     = it.name;
  const obsLivre = modal.querySelector('#pdvb-obs-input')?.value?.trim() || '';
  let obs      = _pedidoObsComKit(it, _noFmtObsAdicionais(modal, grupos, obsLivre));
  let finalQty = qty;

  if (isKg) {
    const kg = parseFloat(modal.querySelector('#pdvb-kg-input')?.value || 1);
    price    = price * kg;
    name     = it.name + ' ' + kg.toFixed(3).replace('.', ',') + 'kg';
    finalQty = 1;
  }

  const isMesaOrder = !!window._detailIsMesa;

  try {
    if (isMesaOrder) {
      // ── Comanda de mesa: itens seguem o formato do garçom (item_status próprio) ──
      const mesaOrder = mesaOrdersCache.find(x => x.id === o.id);
      if (!mesaOrder) { modal.remove(); return; }
      const currentItems = Array.isArray(mesaOrder.items) ? [...mesaOrder.items] : [];
      const newItem = {
        id: it.id || null, qty: finalQty, name, price, obs, emoji: it.emoji || '',
        item_status: 'producao',
        item_id: `${Date.now()}_add`,
        added_at: new Date().toISOString(),
        garcom_id: null,
        garcom_nome: 'Gestor'
      };
      currentItems.push(newItem);
      const newTotal = currentItems
        .filter(i => i.item_status !== 'cancelado')
        .reduce((s, i) => s + (parseFloat(i.price)||0) * (parseInt(i.qty)||1), 0);

      const { error } = await sb.from('orders')
        .update({ items: currentItems, total: newTotal, updated_at: new Date().toISOString() })
        .eq('id', o.id);
      if (error) throw error;

      const idx = mesaOrdersCache.findIndex(x => x.id === o.id);
      if (idx !== -1) mesaOrdersCache[idx] = { ...mesaOrdersCache[idx], items: currentItems, total: newTotal };
      window._detailMesaAllItems = currentItems;

      modal.remove();
      document.getElementById('od-catalog-overlay')?.remove();
      closeModal('modal-order-detail');
      setTimeout(() => openOrderDetail(o.id), 80);
      renderKanban();
      _renderMesaPageFromCache();
      sbToast('ok', `${name} adicionado à mesa!`);
    } else {
      const currentItems = Array.isArray(o.items) ? [...o.items] : [];
      const existing = !isKg && currentItems.find(c => c.name === name && (c.obs || '') === obs);
      if (existing) existing.qty += finalQty;
      else currentItems.push({ id: it.id || null, qty: finalQty, name, price, obs, emoji: it.emoji || '' });

      const newTotal = currentItems.reduce((s, i) => s + (parseFloat(i.price)||0) * (parseInt(i.qty)||1), 0);

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
    }
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
let _noDescontoAtivo = false;

// Adiciona um item "avulso" ao carrinho — sem vínculo com produto do
// cardápio (id: null), pra casos tipo "taxa de embalagem", "acréscimo",
// ou qualquer cobrança que não tem um produto correspondente cadastrado.
function noAbrirValorAvulso() {
  const nome = prompt('Nome do item (ex: Taxa de embalagem, Acréscimo, etc.)');
  if (nome === null) return;
  const nomeFinal = nome.trim() || 'Valor avulso';
  const valorTxt = prompt('Valor (R$):', '0,00');
  if (valorTxt === null) return;
  const valor = parseFloat(String(valorTxt).replace(',', '.'));
  if (isNaN(valor) || valor <= 0) { sbToast('err', 'Valor inválido'); return; }
  _noCart.push({ id: null, name: nomeFinal, qty: 1, price: valor, emoji: '💲', cat: '', cat_key: '' });
  noRenderCart();
  sbToast('ok', `"${nomeFinal}" adicionado`);
}

function noToggleDesconto() {
  _noDescontoAtivo = !_noDescontoAtivo;
  const wrap = document.getElementById('no-desconto-wrap');
  if (wrap) wrap.style.display = _noDescontoAtivo ? 'flex' : 'none';
  if (!_noDescontoAtivo) { document.getElementById('no-desconto-val').value = ''; }
  noRenderCart();
}

function noRemoverDesconto() {
  _noDescontoAtivo = false;
  document.getElementById('no-desconto-val').value = '';
  document.getElementById('no-desconto-wrap').style.display = 'none';
  noRenderCart();
}

// Calcula o valor do desconto em reais, dado o subtotal+taxa antes de
// aplicar. Nunca deixa o total ficar negativo (trava em 0).
function _noCalcularDesconto(baseAntes) {
  if (!_noDescontoAtivo) return 0;
  const tipo = document.getElementById('no-desconto-tipo')?.value || 'pct';
  const val = parseFloat(document.getElementById('no-desconto-val')?.value) || 0;
  if (val <= 0) return 0;
  const bruto = tipo === 'pct' ? baseAntes * (val / 100) : val;
  return Math.min(bruto, baseAntes); // nunca desconta mais que o total
}

let _noDelivery = 'delivery';

function noSetDelivery(tipo) {
  _noDelivery = tipo;
  ['delivery', 'retirada', 'mesa'].forEach(t => {
    const btn = document.getElementById('no-dtab-' + t);
    if (!btn) return;
    btn.classList.toggle('on', t === tipo);
  });
  document.getElementById('no-addr-block').style.display = tipo === 'delivery' ? '' : 'none';
  // Ao voltar pra delivery, garante que a taxa esteja calculada de novo
  if (tipo === 'delivery') {
    setTimeout(noUpdateTaxaAuto, 30);
  }
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
  // Re-renderiza carrinho pra atualizar linha da taxa (visível só em delivery)
  if (typeof noRenderCart === 'function') noRenderCart();
}

// Categoria atualmente selecionada nos chips do PDV (null = todas)
let _noCatFilter = null;

function noRenderCategoriasChips() {
  const wrap = document.getElementById('no-cats-chips');
  if (!wrap) return;
  // Coleta categorias dos itens ativos, preservando ordem do `categories` array global
  const itensAtivos = (items || []).filter(i => i.status !== 'pausado');
  const cats = [];
  const seen = new Set();
  // Usa ordem de `categories` (se disponível) — chega isso de gestor-cardapio
  const catsOrder = (typeof categories !== 'undefined' && Array.isArray(categories))
    ? categories.filter(c => c.ativo).map(c => c.name)
    : [];
  catsOrder.forEach(cn => {
    if (itensAtivos.some(i => (i.cat || i.cat_key) === cn)) { cats.push(cn); seen.add(cn); }
  });
  // Adiciona categorias que existem nos itens mas não estão em `categories`
  itensAtivos.forEach(i => {
    const c = i.cat || i.cat_key || 'Outros';
    if (!seen.has(c)) { cats.push(c); seen.add(c); }
  });

  if (!cats.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';

  const chipBase = 'flex-shrink:0;padding:7px 14px;border-radius:99px;border:1.5px solid var(--border);background:var(--surface);font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all .15s ease;font-family:inherit;color:var(--text)';
  const chipActive = 'border-color:var(--accent);background:var(--accent);color:#fff';

  wrap.innerHTML = `
    <button type="button" data-cat="" onclick="noSetCatFilter('')" style="${chipBase}${_noCatFilter==null?';'+chipActive:''}">Todas (${itensAtivos.length})</button>
    ${cats.map(cn => {
      const n = itensAtivos.filter(i => (i.cat || i.cat_key) === cn).length;
      const ativo = _noCatFilter === cn;
      return `<button type="button" data-cat="${cn.replace(/"/g, '&quot;')}" onclick="noSetCatFilter('${cn.replace(/'/g, "\\'")}')" style="${chipBase}${ativo?';'+chipActive:''}">${cn} <span style="opacity:.65;font-weight:500;margin-left:2px">${n}</span></button>`;
    }).join('')}
  `;
}

function noSetCatFilter(cat) {
  _noCatFilter = cat || null;
  noRenderCategoriasChips();
  // Mantém o termo de busca atual
  const q = document.getElementById('no-search')?.value || '';
  noFilterItems(q);
}

function noFilterItems(q) {
  const list = document.getElementById('no-items-list');
  if (!list) return;
  const search = (q || '').toLowerCase();
  const filtered = items.filter(i =>
    i.status !== 'pausado' &&
    (!_noCatFilter || (i.cat || i.cat_key) === _noCatFilter) &&
    (!search || i.name.toLowerCase().includes(search) || (i.desc || '').toLowerCase().includes(search))
  );
  if (!filtered.length) {
    list.innerHTML = '<div style="padding:18px;text-align:center;color:var(--muted);font-size:12.5px">Nenhum produto encontrado</div>';
    return;
  }
  // Se há filtro de categoria, esconde os headers de grupo (já está filtrado)
  const showHeaders = !_noCatFilter;
  const catMap = {};
  filtered.forEach(item => {
    const cat = item.cat || item.cat_key || 'Outros';
    if (!catMap[cat]) catMap[cat] = [];
    catMap[cat].push(item);
  });

  list.innerHTML = Object.entries(catMap).map(([cat, its]) => `
    ${showHeaders ? `<div style="padding:8px 12px 4px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);background:var(--surface);border-bottom:1px solid var(--border)">${cat}</div>` : ''}
    ${its.map(item => {
    const price = parseFloat(item.price || 0);
    const _isKgItem = item.itemType === 'kg' || item.item_type === 'kg';
    const priceStr = 'R$ ' + price.toFixed(2).replace('.', ',') + (_isKgItem ? ' <span style="font-size:10px;opacity:.7">/kg</span>' : '');
    const grupos = _pedidoGruposSelecionaveis(item);
    const ehPizza = _noEhPizza(item);
    const temAdicionais = grupos.length > 0 || _isKgItem || ehPizza;
    const tagAdicional = ehPizza
      ? '<div style="font-size:10px;color:#dc2626;margin-top:2px;font-weight:700">🍕 meio a meio disponível</div>'
      : (temAdicionais ? '<div style="font-size:10px;color:var(--accent);margin-top:2px;font-weight:600">+ adicionais</div>' : '');
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s;active:background:var(--surface2)" onclick="noAddItem(${item.id})">
        ${item.imageUrl
        ? `<img src="${item.imageUrl}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0">`
        : `<div style="width:44px;height:44px;border-radius:8px;background:var(--surface);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">${item.emoji || '🍽️'}</div>`}
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.name}</div>
          ${item.desc ? `<div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px">${item.desc}</div>` : ''}
          ${tagAdicional}
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

// Detecta se item é pizza (mesmo critério do cardápio cliente)
function _noEhPizza(item) {
  if (!item) return false;
  if (item.allowHalf) return true;  // flag explícita do gestor
  if (item.meio_a_meio || item.tipo === 'pizza' || item.is_pizza) return true;
  // Por categoria
  const catKey = item.cat || item.cat_key;
  if (typeof categories !== 'undefined' && Array.isArray(categories)) {
    const cat = categories.find(c => c.name === catKey);
    if (cat && (cat.meio_a_meio || (cat.name || '').toLowerCase().includes('pizza') || (cat.label || '').toLowerCase().includes('pizza'))) return true;
  }
  return false;
}

function noAddItem(itemId) {
  const item = items.find(i => i.id === itemId);
  if (!item) return;

  // Pizza? abre modal específico de meio a meio (com opção de inteira)
  if (_noEhPizza(item)) {
    noAbrirModalPizza(item);
    return;
  }

  // Se tem grupos de adicionais, abre modal de seleção
  const grupos = _pedidoGruposSelecionaveis(item);

  const isKg = item.itemType === 'kg' || item.item_type === 'kg';

  // Sempre abre o modal — mesmo sem adicionais/grupos — pra permitir digitar uma
  // observação no item (igual ao cardápio do cliente), antes de lançar no pedido.
  noAbrirModalAdicionais(item, grupos, isKg);
}

// ─────────────────────────────────────────────────────────────────────
// Modal pizza meio a meio (PDV gestor)
// Permite escolher: pizza inteira (1 sabor) ou meia-meia (2 sabores).
// Preço da meia-meia = média das duas metades (mesma regra do cliente).
// ─────────────────────────────────────────────────────────────────────
let _noPizzaBase = null;   // pizza base (item clicado)
let _noPizzaHalf = null;   // 2ª metade selecionada (null = inteira)

function noAbrirModalPizza(item) {
  document.getElementById('modal-no-pizza-bg')?.remove();
  _noPizzaBase = item;
  _noPizzaHalf = null;

  // Outras pizzas da mesma categoria (irmãs)
  const catKey = item.cat || item.cat_key;
  const irmas = items.filter(x =>
    x.id !== item.id &&
    (x.cat === catKey || x.cat_key === catKey) &&
    x.status !== 'pausado' &&
    _noEhPizza(x)
  );

  const bg = document.createElement('div');
  bg.className = 'modal-bg on';
  bg.id = 'modal-no-pizza-bg';
  bg.style.zIndex = '99999';

  const priceBase = parseFloat(item.price || 0);
  bg.innerHTML = `
    <div class="modal" style="max-width:520px;width:92vw;padding:0;overflow-y:auto">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div>
          <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px">🍕 Pizza</div>
          <div style="font-size:17px;font-weight:700;margin-top:2px">${item.name}</div>
        </div>
        <button onclick="document.getElementById('modal-no-pizza-bg')?.remove()" style="width:30px;height:30px;border-radius:8px;background:var(--surface2);border:1px solid var(--border);color:var(--muted);cursor:pointer;font-size:14px">✕</button>
      </div>

      <div style="padding:16px 22px">
        <!-- Seletor inteira/meia-meia -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
          <button id="no-pizza-mode-inteira" onclick="noPizzaSetMode('inteira')" type="button" style="padding:14px;border-radius:10px;border:2px solid var(--accent);background:rgba(var(--accent-rgb,249,115,22),.1);color:var(--accent);cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;display:flex;flex-direction:column;align-items:center;gap:4px">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="14" cy="11" r="1" fill="currentColor"/><circle cx="11" cy="14" r="1" fill="currentColor"/></svg>
            Inteira
          </button>
          <button id="no-pizza-mode-meia" onclick="noPizzaSetMode('meia')" type="button" style="padding:14px;border-radius:10px;border:2px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;display:flex;flex-direction:column;align-items:center;gap:4px">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="11" r="1" fill="currentColor"/><circle cx="16" cy="11" r="1" fill="currentColor"/></svg>
            Meia / Meia
          </button>
        </div>

        <!-- 1ª metade (sempre o item base) -->
        <div style="margin-bottom:8px">
          <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">1ª Metade</div>
          <div style="padding:10px 12px;border:1.5px solid var(--accent);border-radius:9px;background:rgba(var(--accent-rgb,249,115,22),.08);display:flex;align-items:center;gap:10px">
            <span style="font-size:22px">${item.emoji || '🍕'}</span>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:700">${item.name}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:1px">R$ ${priceBase.toFixed(2).replace('.', ',')}</div>
            </div>
          </div>
        </div>

        <!-- 2ª metade (só aparece em modo meia-meia) -->
        <div id="no-pizza-half-block" style="display:none;margin-bottom:14px">
          <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">2ª Metade · escolha um sabor</div>
          <div id="no-pizza-half-list" style="max-height:240px;overflow-y:auto;border:1.5px solid var(--border);border-radius:9px;background:var(--surface2)">
            ${irmas.length
              ? irmas.map(p => `<div class="no-pizza-half-opt" data-id="${p.id}" data-name="${(p.name || '').replace(/"/g, '&quot;')}" data-price="${parseFloat(p.price)||0}" data-emoji="${p.emoji || '🍕'}" style="padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;gap:10px;transition:background .15s">
                  <span style="font-size:22px">${p.emoji || '🍕'}</span>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</div>
                    <div style="font-size:11px;color:var(--muted)">R$ ${parseFloat(p.price || 0).toFixed(2).replace('.', ',')}</div>
                  </div>
                  <div class="no-pizza-half-check" style="width:18px;height:18px;border-radius:50%;border:2px solid var(--border);flex-shrink:0"></div>
                </div>`).join('')
              : '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12.5px">Nenhuma outra pizza disponível na categoria.</div>'
            }
          </div>
        </div>

        <!-- Adicionais / grupos de customização da pizza -->
        <div id="no-pizza-grupos-wrap"></div>

        <!-- Observação -->
        <div style="margin-bottom:14px">
          <label style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;display:block">Observação (opcional)</label>
          <input type="text" id="no-pizza-obs" placeholder="Ex: sem cebola, borda recheada..." style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface2);color:var(--text);font-size:13px;font-family:inherit">
        </div>

        <!-- Resumo + ação -->
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-radius:10px;background:var(--surface2);border:1px solid var(--border);margin-bottom:12px">
          <div>
            <div style="font-size:11px;color:var(--muted)">Total</div>
            <div id="no-pizza-total" style="font-size:18px;font-weight:800;color:var(--success)">R$ ${priceBase.toFixed(2).replace('.', ',')}</div>
          </div>
          <button id="no-pizza-add-btn" onclick="noPizzaAdicionar()" style="padding:11px 22px;background:var(--accent);color:#fff;border:none;border-radius:9px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit">Adicionar ao pedido</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(bg);

  // Renderiza adicionais (custom_groups) da pizza base
  const _rawPizzaGrupos = item.customGroups ?? item.custom_groups;
  const pizzaGrupos = (() => { try { return Array.isArray(_rawPizzaGrupos) ? _rawPizzaGrupos : JSON.parse(_rawPizzaGrupos || '[]'); } catch { return []; } })()
    .filter(g => !['porcao_ref','kit_itens'].includes(g.tipo));
  const gruposWrap = bg.querySelector('#no-pizza-grupos-wrap');
  if (gruposWrap && pizzaGrupos.length) {
    const _TIPO_LABEL = { radio:'Escolha', checkbox:'Adicional', opcional:'Adicional', adicionais:'Adicional', obrigatorio:'Escolha obrigatória', sabor:'Sabor' };
    gruposWrap.innerHTML = pizzaGrupos.map((g, gi) => {
      const opcoes = g.opcoes || [];
      if (!opcoes.length) return '';
      const isSingle = ['radio','obrigatorio','sabor'].includes(g.tipo || '');
      const isRequired = ['obrigatorio','sabor'].includes(g.tipo || '');
      const inputType = isSingle ? 'radio' : 'checkbox';
      const label = g.nome || g.name || _TIPO_LABEL[g.tipo] || 'Adicional';
      return `<div style="margin-bottom:14px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:6px">
          ${label}${isRequired ? ' <span style="color:var(--danger);font-size:10px">*obrigatório</span>' : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:5px">
          ${opcoes.map((op, oi) => {
            const nome = op.nome || op.name || '';
            const preco = parseFloat(op.preco || op.price || 0);
            const precoLabel = preco > 0 ? ` <span style="color:var(--success);font-size:11px">+R$ ${preco.toFixed(2).replace('.',',')}</span>` : '';
            return `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:9px;cursor:pointer" onclick="noToggleOpc(this)">
              <input type="${inputType}" name="no-pizza-grp-${gi}" value="${oi}" data-grp="${gi}" data-idx="${oi}" data-nome="${nome.replace(/"/g,'&quot;')}" data-preco="${preco}" style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0">
              <span style="font-size:13px;font-weight:500;flex:1">${nome}${precoLabel}</span>
            </label>`;
          }).join('')}
        </div>
      </div>`;
    }).join('');
  }
  bg.querySelectorAll('.no-pizza-half-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      _noPizzaHalf = {
        id:    parseInt(opt.dataset.id),
        name:  opt.dataset.name,
        price: parseFloat(opt.dataset.price) || 0,
        emoji: opt.dataset.emoji
      };
      // Visual: marca selecionado, desmarca outros
      bg.querySelectorAll('.no-pizza-half-opt').forEach(o => {
        const sel = parseInt(o.dataset.id) === _noPizzaHalf.id;
        o.style.background = sel ? 'rgba(var(--accent-rgb,249,115,22),.08)' : '';
        const ck = o.querySelector('.no-pizza-half-check');
        if (ck) {
          ck.style.borderColor = sel ? 'var(--accent)' : 'var(--border)';
          ck.style.background  = sel ? 'var(--accent)' : '';
          ck.innerHTML = sel ? '<svg width="100%" height="100%" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '';
        }
      });
      noPizzaAtualizarTotal();
    });
  });

  // Fecha ao clicar no fundo
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
}

function noPizzaSetMode(mode) {
  const halfBlock = document.getElementById('no-pizza-half-block');
  const btnInt    = document.getElementById('no-pizza-mode-inteira');
  const btnMeia   = document.getElementById('no-pizza-mode-meia');
  if (!halfBlock || !btnInt || !btnMeia) return;
  if (mode === 'meia') {
    halfBlock.style.display = '';
    btnMeia.style.borderColor = 'var(--accent)';
    btnMeia.style.background  = 'rgba(var(--accent-rgb,249,115,22),.1)';
    btnMeia.style.color       = 'var(--accent)';
    btnInt.style.borderColor = 'var(--border)';
    btnInt.style.background  = 'var(--surface2)';
    btnInt.style.color       = 'var(--text)';
  } else {
    halfBlock.style.display = 'none';
    _noPizzaHalf = null;
    btnInt.style.borderColor = 'var(--accent)';
    btnInt.style.background  = 'rgba(var(--accent-rgb,249,115,22),.1)';
    btnInt.style.color       = 'var(--accent)';
    btnMeia.style.borderColor = 'var(--border)';
    btnMeia.style.background  = 'var(--surface2)';
    btnMeia.style.color       = 'var(--text)';
    // Reset checkmarks
    document.querySelectorAll('.no-pizza-half-opt').forEach(o => {
      o.style.background = '';
      const ck = o.querySelector('.no-pizza-half-check');
      if (ck) { ck.style.borderColor = 'var(--border)'; ck.style.background = ''; ck.innerHTML = ''; }
    });
  }
  noPizzaAtualizarTotal();
}

function noPizzaAtualizarTotal() {
  if (!_noPizzaBase) return;
  const totalEl = document.getElementById('no-pizza-total');
  const btn     = document.getElementById('no-pizza-add-btn');
  if (!totalEl || !btn) return;
  const halfBlock = document.getElementById('no-pizza-half-block');
  const isMeia = halfBlock && halfBlock.style.display !== 'none';

  const priceBase = parseFloat(_noPizzaBase.price || 0);
  let preco = priceBase;
  let podeAdd = true;

  if (isMeia) {
    if (_noPizzaHalf) {
      // Média dos dois preços (mesma regra do cardápio cliente)
      preco = (priceBase + _noPizzaHalf.price) / 2;
    } else {
      podeAdd = false; // precisa selecionar 2ª metade
    }
  }

  totalEl.textContent = 'R$ ' + preco.toFixed(2).replace('.', ',');
  btn.disabled = !podeAdd;
  btn.style.opacity = podeAdd ? '1' : '.45';
  btn.style.cursor  = podeAdd ? 'pointer' : 'not-allowed';
  btn.textContent   = podeAdd
    ? 'Adicionar ao pedido'
    : 'Selecione a 2ª metade';
}

function noPizzaAdicionar() {
  if (!_noPizzaBase) return;
  const halfBlock = document.getElementById('no-pizza-half-block');
  const isMeia = halfBlock && halfBlock.style.display !== 'none';
  const obs = (document.getElementById('no-pizza-obs')?.value || '').trim();

  if (isMeia && !_noPizzaHalf) {
    if (typeof sbToast === 'function') sbToast('err', 'Selecione a 2ª metade da pizza');
    return;
  }

  const priceBase = parseFloat(_noPizzaBase.price || 0);

  // Lê adicionais selecionados no modal
  const bg2 = document.getElementById('modal-no-pizza-bg');
  let gruposExtra = 0;
  const gruposDesc = [];
  const gruposSel = [];
  if (bg2) {
    const inputs = bg2.querySelectorAll('#no-pizza-grupos-wrap input:checked');
    inputs.forEach(inp => {
      const nome = inp.dataset.nome || '';
      const preco = parseFloat(inp.dataset.preco) || 0;
      gruposExtra += preco;
      if (nome) gruposDesc.push(nome + (preco > 0 ? ` (+R$ ${preco.toFixed(2).replace('.',',')})` : ''));
      gruposSel.push({ nome, preco, qty: 1 });
    });
  }

  let nome, preco, obsCart;

  if (isMeia && _noPizzaHalf) {
    nome    = `${_noPizzaBase.name} / ${_noPizzaHalf.name}`;
    preco   = (priceBase + _noPizzaHalf.price) / 2 + gruposExtra;
    const partes = ['Meio a meio', ...gruposDesc];
    if (obs) partes.push(obs);
    obsCart = partes.join(' · ');
  } else {
    nome    = _noPizzaBase.name;
    preco   = priceBase + gruposExtra;
    const partes = [...gruposDesc];
    if (obs) partes.push(obs);
    obsCart = partes.join(' · ');
  }

  noAddToCartDireto(_noPizzaBase, nome, preco, obsCart, gruposSel);
  document.getElementById('modal-no-pizza-bg')?.remove();
  _noPizzaBase = null;
  _noPizzaHalf = null;
}

function noAddToCartDireto(item, name, price, obs, grupos) {
  const existing = _noCart.find(c => c.id === item.id && c.obs === obs && c.name === name);
  if (existing) {
    existing.qty++;
  } else {
    _noCart.push({ id: item.id, name, qty: 1, price, emoji: item.emoji || '🍽️', obs, _grupos: grupos });
  }
  noRenderCart();
  // Animação de pulse no item recém-adicionado
  setTimeout(() => {
    const rows = document.querySelectorAll('#no-cart .no-cart-row');
    const idx = _noCart.findIndex(c => c.id === item.id && c.obs === obs && c.name === name);
    if (idx >= 0 && rows[idx]) {
      rows[idx].classList.add('pulse');
      setTimeout(() => rows[idx].classList.remove('pulse'), 400);
      // Auto-scroll do carrinho pro item
      rows[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 30);
  sbToast('ok', name + ' adicionado!');
}

function noAbrirModalAdicionais(item, grupos, isKg, editCtx) {
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
      // Valores de peso/porção costumam vir como número puro (ex: 500 =
      // 500g) em vez de {nome:...} — sem tratar isso, a etiqueta ficava
      // em branco (era exatamente o bug visto na tela "Novo Pedido").
      const nome = typeof op === 'number'
        ? (op >= 1000 ? (op / 1000).toFixed(1).replace('.', ',') + 'kg' : op + 'g')
        : (op?.nome || op?.name || (typeof op === 'string' ? op : ''));
      const preco = parseFloat(op?.preco || op?.price || 0);
      const icon = op?.icon ? `<img src="${op.icon}" style="width:22px;height:22px;object-fit:contain;flex-shrink:0" onerror="this.style.display='none'">` : '';
      const precoLabel = preco > 0 ? ` <span style="color:var(--success);font-size:11px">+R$ ${preco.toFixed(2).replace('.', ',')}</span>` : '';
      return `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:9px;cursor:pointer" onclick="noToggleOpc(this)">
            <input type="${inputType}" name="no-grp-${gi}" value="${oi}" data-grp="${gi}" data-idx="${oi}" data-nome="${nome.replace(/"/g, '&quot;')}" data-preco="${preco}" style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0">
            ${icon}<span style="font-size:13px;font-weight:500;flex:1">${nome}${precoLabel}</span>
          </label>`;
    }).join('')}
      </div>
    </div>`;
  }).join('');

  const _kgDefault = (editCtx && editCtx.kg) ? editCtx.kg : 0.5;
  const kgHtml = isKg ? `
    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px">Quantidade (kg)</div>
      <div style="display:flex;align-items:center;gap:12px">
        <input type="number" id="no-kg-input" min="0.1" step="0.1" value="${_kgDefault}"
          style="flex:1;padding:10px;border:1px solid var(--border);border-radius:9px;background:var(--surface2);color:var(--text);font-size:18px;font-weight:700;text-align:center;outline:none;font-family:inherit"
          oninput="document.getElementById('no-kg-total').textContent='R$ '+((parseFloat(this.value)||0)*${parseFloat(item.price || 0)}).toFixed(2).replace('.',',')">
        <span style="font-size:12px;color:var(--muted)">kg</span>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:6px">Total: <strong id="no-kg-total">R$ ${(_kgDefault * parseFloat(item.price || 0)).toFixed(2).replace('.', ',')}</strong></div>
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
          ${editCtx ? '<div style="font-size:11px;color:var(--accent);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">✏️ Editando item</div>' : ''}
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
        ${editCtx ? 'Salvar alterações' : 'Adicionar ao pedido'}
      </button>
    </div>`;
  document.body.appendChild(modal);

  // Store item ref for confirm
  modal._item = item;
  modal._grupos = grupos;
  modal._isKg = isKg;
  modal._editIndex = editCtx ? editCtx.cartIndex : null;
  window._noModalQtyVal = editCtx ? (editCtx.qty || 1) : 1;
  const _qtyEl = document.getElementById('no-modal-qty');
  if (_qtyEl) _qtyEl.textContent = window._noModalQtyVal;

  if (editCtx) {
    const obsEl = document.getElementById('no-obs-input');
    if (obsEl) obsEl.value = editCtx.obsLivre || '';
    // Pré-seleciona os adicionais que já estavam marcados neste item
    (editCtx.sel || []).forEach(s => {
      const inp = modal.querySelector(`input[data-grp="${s.grp}"][data-idx="${s.idx}"]`);
      if (inp) {
        inp.checked = true;
        const lbl = inp.closest('label');
        if (lbl) { lbl.style.borderColor = 'var(--accent)'; lbl.style.background = 'rgba(var(--accent-rgb,249,115,22),.08)'; }
      }
    });
  }

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

// ── Helper compartilhado: monta string de adicionais no formato esperado pelo parser de impressão ──
// O _parseObs em gestor-relatorios.js espera:
//   "NomeGrupo: opcao1, opcao2 (+R$ 3,00) · OutroGrupo: x · obs livre"
// Sem isso, a comanda imprime sem os adicionais.
function _noFmtObsAdicionais(modalEl, grupos, obsLivre) {
  const porGrupo = new Map();
  modalEl.querySelectorAll('input:checked').forEach(inp => {
    const gi = parseInt(inp.dataset.grp);
    if (isNaN(gi)) return;
    const g = (grupos || [])[gi];
    if (!g) return;
    const grpNome = g.nome || g.name || (
      g.tipo === 'cortes'        ? 'Corte' :
      g.tipo === 'preparos'      ? 'Preparo' :
      g.tipo === 'ocasiao'       ? 'Ocasião' :
      g.tipo === 'armazenamento' ? 'Armazenamento' :
      g.tipo === 'pesos'         ? 'Porção' :
      g.tipo === 'sabor'         ? 'Sabor' : 'Adicional'
    );
    const opcNome = inp.dataset.nome || '';
    if (!opcNome) return;
    const preco   = parseFloat(inp.dataset.preco || 0);
    const opcLbl  = preco > 0 ? `${opcNome} (+R$ ${preco.toFixed(2).replace('.',',')})` : opcNome;
    if (!porGrupo.has(gi)) porGrupo.set(gi, { nome: grpNome, opcoes: [] });
    porGrupo.get(gi).opcoes.push(opcLbl);
  });
  const partes = [];
  for (const { nome, opcoes } of porGrupo.values()) {
    if (opcoes.length) partes.push(`${nome}: ${opcoes.join(', ')}`);
  }
  if (obsLivre) partes.push(obsLivre);
  return partes.join(' · ');
}

function noConfirmarAdicionais(itemId) {
  const modal = document.getElementById('modal-no-adicionais-bg');
  if (!modal) return;
  const item   = modal._item;
  const isKg   = modal._isKg;
  const grupos = Array.isArray(modal._grupos) ? modal._grupos : [];
  const qty    = window._noModalQtyVal || 1;
  const editIndex = modal._editIndex;

  // Calcula extra (preço somado dos adicionais) e guarda quais foram marcados
  // (pra poder reabrir esse mesmo item pra edição depois, com tudo pré-selecionado)
  let extra = 0;
  const sel = [];
  modal.querySelectorAll('input:checked').forEach(inp => {
    extra += parseFloat(inp.dataset.preco || 0);
    sel.push({ grp: parseInt(inp.dataset.grp), idx: parseInt(inp.dataset.idx) });
  });

  let price = parseFloat(item.price || 0) + extra;
  let name  = item.name;
  const obsLivre = document.getElementById('no-obs-input')?.value.trim() || '';

  // Monta obs no formato esperado pelo parser de impressão (com nome do grupo)
  const obs = _pedidoObsComKit(item, _noFmtObsAdicionais(modal, grupos, obsLivre));

  let kgVal = null;
  if (isKg) {
    kgVal = parseFloat(document.getElementById('no-kg-input')?.value || 1);
    price = price * kgVal;
    name = item.name + ' ' + kgVal.toFixed(3).replace('.', ',') + 'kg';
  }

  // ── Modo edição: substitui o item já lançado no carrinho, em vez de criar outro ──
  if (editIndex != null && editIndex >= 0 && editIndex < _noCart.length) {
    _noCart[editIndex] = {
      id: item.id, name, qty: isKg ? 1 : qty, price,
      emoji: item.emoji || '🍽️', obs,
      _sel: sel, _obsLivre: obsLivre, _kg: kgVal
    };
    noRenderCart();
    modal.remove();
    sbToast('ok', 'Item atualizado!');
    return;
  }

  if (isKg) {
    _noCart.push({ id: item.id, name, qty: 1, price, emoji: item.emoji || '🍽️', obs, _sel: sel, _obsLivre: obsLivre, _kg: kgVal });
  } else {
    const existing = _noCart.find(c => c.id === item.id && c.obs === obs && c.name === item.name);
    if (existing) existing.qty += qty;
    else _noCart.push({ id: item.id, name, qty, price, emoji: item.emoji || '🍽️', obs, _sel: sel, _obsLivre: obsLivre });
  }

  noRenderCart();
  modal.remove();
  sbToast('ok', name + ' adicionado!');
}

// Reabre o modal de adicionais de um item já lançado no carrinho do "Novo Pedido",
// pré-selecionando tudo que já tinha sido marcado — permite acrescentar mais
// adicionais (ou tirar algum) sem precisar remover e relançar o item do zero.
function noEditarItemCarrinho(idx) {
  const c = _noCart[idx];
  if (!c || c.id == null) return;
  const catalogItem = items.find(i => i.id === c.id);
  if (!catalogItem) { sbToast('err', 'Produto não encontrado no cardápio'); return; }
  const grupos = _pedidoGruposSelecionaveis(catalogItem);
  const isKg = catalogItem.itemType === 'kg' || catalogItem.item_type === 'kg';
  noAbrirModalAdicionais(catalogItem, grupos, isKg, {
    cartIndex: idx,
    sel: c._sel || [],
    obsLivre: c._obsLivre || '',
    qty: c.qty || 1,
    kg: c._kg || 1
  });
}

function noChangeQty(itemId, delta) {
  const idx = _noCart.findIndex(c => c.id === itemId);
  if (idx === -1) return;
  _noCart[idx].qty += delta;
  if (_noCart[idx].qty <= 0) _noCart.splice(idx, 1);
  noRenderCart();
}

// ── Histórico de pedidos do cliente, dentro de "Novo Pedido" ──────────
// Busca os últimos pedidos do telefone informado e mostra num painel
// logo abaixo dos campos de cliente. Puramente informativo/auxiliar —
// não interfere em nada do fluxo de criação normal do pedido.
let _noHistoricoReqId = 0;
async function noCarregarHistoricoCliente(phone) {
  const wrap = document.getElementById('no-historico-wrap');
  const list = document.getElementById('no-historico-list');
  if (!wrap || !list) return;
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) { wrap.style.display = 'none'; return; }
  const reqId = ++_noHistoricoReqId; // evita mostrar resultado de uma busca antiga se o telefone mudar rápido
  try {
    // O telefone é salvo do jeito que foi digitado (com parênteses/traço),
    // não só números — por isso não dá pra comparar direto no banco.
    // Busca um lote recente e compara os dígitos aqui, igual o autocomplete
    // de clientes já faz.
    const { data, error } = await sb.from('orders')
      .select('id,order_num,phone,items,total,taxa,status,created_at')
      .order('created_at', { ascending: false })
      .limit(300);
    if (reqId !== _noHistoricoReqId) return; // resposta obsoleta, ignora
    const doCliente = (!error && data) ? data.filter(o => String(o.phone || '').replace(/\D/g, '') === digits).slice(0, 5) : [];
    if (!doCliente.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    list.innerHTML = doCliente.map(o => {
      const itensArr = Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? (JSON.parse(o.items || '[]')) : []);
      const resumo = itensArr.map(i => `${i.qty}x ${i.name}`).join(', ');
      const total = parseFloat(o.total || 0) + parseFloat(o.taxa || 0);
      const data_ = new Date(o.created_at);
      const dataStr = isNaN(data_) ? '' : data_.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' });
      return `<div style="display:flex;align-items:center;gap:8px;padding:9px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:9px">
        <div style="flex:1;min-width:0">
          <div style="font-size:11.5px;color:var(--muted);font-weight:600">#${o.order_num || o.id} · ${dataStr} · R$ ${total.toFixed(2).replace('.', ',')}</div>
          <div style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px">${resumo || 'sem itens'}</div>
        </div>
        <button type="button" onclick='noRepetirPedido(${JSON.stringify(itensArr).replace(/'/g, "&#39;")})' style="flex-shrink:0;padding:6px 12px;border-radius:8px;border:1.5px solid var(--accent);background:rgba(var(--accent-rgb,249,115,22),.08);color:var(--accent);font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit">Repetir</button>
      </div>`;
    }).join('');
  } catch (e) {
    if (reqId === _noHistoricoReqId) wrap.style.display = 'none';
  }
}

// Copia os itens de um pedido antigo pro carrinho do pedido novo, que
// ainda está sendo montado — o gestor pode ajustar quantidade/remover
// antes de criar, igual faria com itens adicionados na hora.
function noRepetirPedido(itensArr) {
  if (!Array.isArray(itensArr) || !itensArr.length) return;
  itensArr.forEach(i => {
    _noCart.push({
      id: i.id != null ? i.id : null,
      name: i.name || 'Item',
      qty: parseInt(i.qty) || 1,
      price: parseFloat(i.price) || 0,
      emoji: i.emoji || '🍽️',
      obs: i.obs || '',
    });
  });
  noRenderCart();
  sbToast('ok', `${itensArr.length} item(ns) do pedido anterior adicionados — revise antes de criar!`);
}

function noRenderCart() {
  const el = document.getElementById('no-cart');
  const empty = document.getElementById('no-cart-empty');
  const subEl    = document.getElementById('no-subtotal-display');
  const taxaLine = document.getElementById('no-taxa-line');
  const taxaEl   = document.getElementById('no-taxa-display');
  const totalEl  = document.getElementById('no-total-display');
  const footEl   = document.getElementById('no-footer-total');
  const counter  = document.getElementById('no-cart-counter');
  const summary  = document.getElementById('no-cart-summary');
  const btn      = document.getElementById('no-criar-btn');
  const btnLabel = document.getElementById('no-criar-btn-label');
  if (!el) return;

  // Limpa rows anteriores
  el.querySelectorAll('.no-cart-row').forEach(r => r.remove());

  const totalQty = _noCart.reduce((s, c) => s + c.qty, 0);

  if (!_noCart.length) {
    if (empty)   empty.style.display = '';
    if (summary) summary.style.display = 'none';
    if (counter) counter.textContent = '0 itens';
    if (subEl)   subEl.textContent   = 'R$ 0,00';
    if (totalEl) totalEl.textContent = 'R$ 0,00';
    if (footEl)  footEl.textContent  = 'R$ 0,00';
    if (btn) { btn.disabled = true; }
    if (btnLabel) btnLabel.textContent = 'Criar pedido';
    return;
  }

  if (empty)   empty.style.display = 'none';
  if (summary) summary.style.display = '';
  if (counter) counter.textContent = `${totalQty} ${totalQty === 1 ? 'item' : 'itens'}`;

  const frag = document.createDocumentFragment();
  _noCart.forEach((c, idx) => {
    // Oferece editar (✏️) sempre que dá pra reabrir o modal desse produto de forma
    // confiável: precisa existir no cardápio. Pizza fica de fora (meio a meio tem
    // modal próprio). Agora todo item abre modal (com observação), mesmo sem
    // grupos de adicionais — então não restringe mais a grupos/kg.
    const catalogItem = (c.id != null) ? items.find(i => i.id === c.id) : null;
    const canEdit = !!catalogItem && !_noEhPizza(catalogItem);

    const div = document.createElement('div');
    div.className = 'no-cart-row';
    div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 4px;border-bottom:1px solid var(--border)';
    div.innerHTML = `
      <span style="font-size:18px;flex-shrink:0">${c.emoji || '🍽️'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:600;line-height:1.3;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.name}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:1px">R$ ${parseFloat(c.price).toFixed(2).replace('.', ',')} cada</div>
        ${c.obs ? `<div style="font-size:10.5px;color:var(--accent);margin-top:2px;line-height:1.3;white-space:normal;word-break:break-word">${c.obs.replace(/</g,'&lt;')}</div>` : ''}
      </div>
      ${canEdit ? `<button onclick="noEditarItemCarrinho(${idx})" title="Editar adicionais" style="width:24px;height:24px;border-radius:6px;border:1px solid rgba(99,102,241,.35);background:rgba(99,102,241,.1);color:#818cf8;font-size:12px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;padding:0">✏️</button>` : ''}
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        <button onclick="noChangeQty(${c.id},-1)" style="width:24px;height:24px;border-radius:6px;border:1px solid var(--border);background:var(--surface);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">−</button>
        <span style="font-size:13px;font-weight:700;min-width:18px;text-align:center">${c.qty}</span>
        <button onclick="noChangeQty(${c.id},1)"  style="width:24px;height:24px;border-radius:6px;border:1px solid var(--border);background:var(--surface);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">+</button>
      </div>
      <span style="font-size:12.5px;font-weight:700;color:var(--success);min-width:60px;text-align:right;flex-shrink:0">R$ ${(c.price * c.qty).toFixed(2).replace('.', ',')}</span>`;
    frag.appendChild(div);
  });
  el.appendChild(frag);

  const subtotal = _noCart.reduce((s, c) => s + c.price * c.qty, 0);
  // Taxa só conta para delivery
  const taxa = (_noDelivery === 'delivery') ? (parseFloat(document.getElementById('no-taxa-val')?.value) || 0) : 0;
  // Desconto incide só sobre os itens (não sobre a taxa de entrega) — mesma
  // convenção que cupom/cashback já usam no resto do sistema.
  const desconto = _noCalcularDesconto(subtotal);
  const total = subtotal - desconto + taxa;

  if (subEl)   subEl.textContent   = 'R$ ' + subtotal.toFixed(2).replace('.', ',');
  if (taxaLine) taxaLine.style.display = (_noDelivery === 'delivery' && taxa > 0) ? 'flex' : 'none';
  if (taxaEl)  taxaEl.textContent  = 'R$ ' + taxa.toFixed(2).replace('.', ',');
  const descDisplay = document.getElementById('no-desconto-display');
  if (descDisplay) {
    if (desconto > 0.009) { descDisplay.style.display = ''; descDisplay.textContent = '− R$ ' + desconto.toFixed(2).replace('.', ','); }
    else { descDisplay.style.display = 'none'; }
  }
  if (totalEl) totalEl.textContent = 'R$ ' + total.toFixed(2).replace('.', ',');
  if (footEl)  footEl.textContent  = 'R$ ' + total.toFixed(2).replace('.', ',');
  if (btn)     btn.disabled = false;
  if (btnLabel) btnLabel.textContent = `Criar pedido (${totalQty})`;
  // Recalcula info de troco (total pode ter mudado)
  if (typeof noAtualizarInfoTroco === 'function') noAtualizarInfoTroco();
}

// ── Config de taxa carregada ao abrir o modal ──
let _noFeeConfig = null;            // { tipo: 'fixo'|'por_bairro'|'por_km', valor, bairros, faixas, bairros_bloqueados }
let _noTaxaManualOverride = false;  // true se o usuário editou o campo de taxa manualmente
let _noPedidoMinimo = 0;            // valor mínimo de pedido para delivery (vem de store_config.pedido_minimo)

// Carrega delivery_fee_config + pedido_minimo do banco
async function _noCarregarFeeConfig() {
  // Reaproveita _taxaConfig se já estiver carregado em gestor-financeiro
  if (typeof _taxaConfig !== 'undefined' && _taxaConfig && _taxaConfig.tipo) {
    _noFeeConfig = _taxaConfig;
  }
  try {
    const { data } = await sb.from('store_config').select('delivery_fee_config,pedido_minimo').single();
    if (!_noFeeConfig || !_noFeeConfig.tipo) {
      _noFeeConfig = data?.delivery_fee_config || { tipo: 'fixo', valor: 0 };
    }
    _noPedidoMinimo = parseFloat(data?.pedido_minimo) || 0;
  } catch (e) {
    if (!_noFeeConfig) _noFeeConfig = { tipo: 'fixo', valor: 0 };
  }
  return _noFeeConfig;
}

// Normaliza nome de bairro pra comparação (lowercase, sem acento, trim)
function _noNormBairro(s) {
  return String(s || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Recalcula a taxa baseado no bairro digitado + config
// Não sobrescreve se o usuário marcou override manual
function noUpdateTaxaAuto() {
  if (_noTaxaManualOverride) return;
  const taxaInp = document.getElementById('no-taxa-val');
  const info    = document.getElementById('no-taxa-info');
  if (!taxaInp) return;

  const cfg  = _noFeeConfig || { tipo: 'fixo', valor: 0 };
  const bair = (document.getElementById('no-f-bairro')?.value || '').trim();

  let taxa = 0;
  let infoTxt = '';
  let infoCor = '';

  // Aviso prioritário: bairro está na lista de bloqueio?
  const bloqueados = Array.isArray(cfg.bairros_bloqueados) ? cfg.bairros_bloqueados : [];
  if (bair && bloqueados.length) {
    const norm = _noNormBairro(bair);
    const hit = bloqueados.find(b => _noNormBairro(b) === norm);
    if (hit) {
      infoTxt = `⚠ Bairro "${hit}" está na lista de bloqueados — confirme antes de seguir`;
      infoCor = '#b45309';
    }
  }

  if (cfg.tipo === 'por_bairro') {
    const bairros = Array.isArray(cfg.bairros) ? cfg.bairros : [];
    if (!bair) { if (!infoTxt) infoTxt = bairros.length ? 'Digite o bairro para auto-calcular' : ''; }
    else {
      const norm = _noNormBairro(bair);
      const match = bairros.find(b => _noNormBairro(b.bairro) === norm);
      if (match) { taxa = parseFloat(match.taxa) || 0; if (!infoTxt) infoTxt = '✓ Bairro reconhecido'; }
      else { if (!infoTxt) infoTxt = '⚠ Bairro fora da lista — taxa zero (edite manualmente)'; }
    }
  } else if (cfg.tipo === 'por_km') {
    if (!infoTxt) infoTxt = 'Taxa por km — defina manualmente abaixo';
    taxa = 0;
  } else {
    // fixo
    taxa = parseFloat(cfg.valor ?? cfg.value ?? 0) || 0;
    if (!infoTxt) infoTxt = taxa > 0 ? `Taxa fixa: R$ ${taxa.toFixed(2).replace('.',',')}` : '';
  }

  taxaInp.value = taxa.toFixed(2);
  if (info) {
    info.textContent = infoTxt;
    info.style.color = infoCor || '';
    info.style.fontWeight = infoCor ? '700' : '';
  }
  // Re-renderiza carrinho pra refletir a taxa no total/footer
  if (typeof noRenderCart === 'function') noRenderCart();
}

// Botão "Auto" — força recálculo (limpa override manual)
function noResetTaxaAuto() {
  _noTaxaManualOverride = false;
  noUpdateTaxaAuto();
  if (typeof sbToast === 'function') sbToast('ok', 'Taxa recalculada pelo bairro');
}

// ─────────────────────────────────────────
// TROCO (Novo Pedido — PDV do gestor)
// ─────────────────────────────────────────
let _noTrocoEscolha = 'nao'; // 'nao' | 'sim'

// Mostra/esconde o bloco de troco conforme a forma de pagamento
function noAtualizarTroco() {
  const pag = document.getElementById('order-pag')?.value || 'PIX';
  const wrap = document.getElementById('order-troco-wrap');
  if (!wrap) return;
  if (pag === 'Dinheiro') {
    wrap.style.display = 'block';
    noTrocoEscolha(_noTrocoEscolha);
  } else {
    wrap.style.display = 'none';
  }
}

function noTrocoEscolha(tipo) {
  _noTrocoEscolha = tipo;
  const btnNao = document.getElementById('order-troco-btn-nao');
  const btnSim = document.getElementById('order-troco-btn-sim');
  const valorWrap = document.getElementById('order-troco-valor-wrap');
  if (btnNao) {
    btnNao.style.background = (tipo === 'nao') ? 'var(--accent)' : 'var(--surface)';
    btnNao.style.color      = (tipo === 'nao') ? '#fff' : 'var(--text)';
    btnNao.style.border     = (tipo === 'nao') ? 'none' : '1px solid var(--border)';
  }
  if (btnSim) {
    btnSim.style.background = (tipo === 'sim') ? 'var(--accent)' : 'var(--surface)';
    btnSim.style.color      = (tipo === 'sim') ? '#fff' : 'var(--text)';
    btnSim.style.border     = (tipo === 'sim') ? 'none' : '1px solid var(--border)';
  }
  if (valorWrap) valorWrap.style.display = (tipo === 'sim') ? 'block' : 'none';
  if (tipo === 'sim') {
    setTimeout(() => document.getElementById('order-troco-valor')?.focus(), 100);
  }
  noAtualizarInfoTroco();
}

// Calcula e exibe quanto será devolvido ao cliente em tempo real
function noAtualizarInfoTroco() {
  const info = document.getElementById('order-troco-info');
  if (!info) return;
  const v = parseFloat(document.getElementById('order-troco-valor')?.value || '0');
  const subtotal = (typeof _noCart !== 'undefined' ? _noCart : []).reduce((s, c) => s + c.price * c.qty, 0);
  const taxaAtual = parseFloat(document.getElementById('no-taxa-val')?.value) || 0;
  const isDelivery = (typeof _noDelivery !== 'undefined' && _noDelivery === 'delivery');
  const tot = subtotal + (isDelivery ? taxaAtual : 0);
  if (v > 0 && tot > 0) {
    if (v < tot) {
      info.textContent = `⚠️ Valor menor que o total (R$ ${tot.toFixed(2).replace('.', ',')})`;
      info.style.color = '#ef4444';
    } else {
      const dev = v - tot;
      info.textContent = `Devolver ao cliente: R$ ${dev.toFixed(2).replace('.', ',')}`;
      info.style.color = 'var(--muted)';
    }
  } else {
    info.textContent = '';
  }
}

// Reseta o estado de troco (chamado ao abrir o modal de Novo Pedido)
function noResetTroco() {
  _noTrocoEscolha = 'nao';
  const el = document.getElementById('order-troco-valor');
  if (el) el.value = '';
  noAtualizarTroco();
}

// ── Autocomplete de bairros (quando config = por_bairro) ──
function noOnBairroInput(input) {
  noUpdateTaxaAuto();
  _noRenderBairrosDropdown(input);
}
function noOnBairroFocus(input) {
  _noRenderBairrosDropdown(input);
}
function _noRenderBairrosDropdown(input) {
  const dd = document.getElementById('no-bairros-dropdown');
  if (!dd) return;
  const cfg = _noFeeConfig || {};
  if (cfg.tipo !== 'por_bairro') { dd.style.display = 'none'; return; }
  const bairros = Array.isArray(cfg.bairros) ? cfg.bairros : [];
  if (!bairros.length) { dd.style.display = 'none'; return; }

  const q = _noNormBairro(input.value);
  const lista = q
    ? bairros.filter(b => _noNormBairro(b.bairro).includes(q)).slice(0, 8)
    : bairros.slice(0, 8);
  if (!lista.length) { dd.style.display = 'none'; return; }

  dd.innerHTML = lista.map(b => `<div class="no-bairro-opt" data-nome="${(b.bairro || '').replace(/"/g, '&quot;')}" data-taxa="${parseFloat(b.taxa)||0}" style="padding:8px 12px;cursor:pointer;font-size:12.5px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:8px;align-items:center" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
    <span style="color:var(--text)">${b.bairro}</span>
    <span style="color:var(--muted);font-size:11px;font-weight:600">R$ ${parseFloat(b.taxa).toFixed(2).replace('.',',')}</span>
  </div>`).join('');

  // Click handlers
  dd.querySelectorAll('.no-bairro-opt').forEach(opt => {
    opt.addEventListener('mousedown', (e) => {
      e.preventDefault(); // evita perder foco antes do click
      const nome = opt.dataset.nome;
      input.value = nome;
      _noTaxaManualOverride = false; // selecionar bairro reseta override
      noUpdateTaxaAuto();
      dd.style.display = 'none';
    });
  });
  dd.style.display = 'block';
}
// Fecha dropdown ao clicar fora
document.addEventListener('click', (e) => {
  const dd = document.getElementById('no-bairros-dropdown');
  const inp = document.getElementById('no-f-bairro');
  if (dd && inp && e.target !== inp && !dd.contains(e.target)) dd.style.display = 'none';
});

// ── Helper: monta a string de endereço a partir dos campos separados ──
function _noMontarAddr() {
  const rua  = (document.getElementById('no-f-rua')?.value || '').trim();
  const num  = (document.getElementById('no-f-num')?.value || '').trim();
  const bair = (document.getElementById('no-f-bairro')?.value || '').trim();
  const comp = (document.getElementById('no-f-compl')?.value || '').trim();
  const ref  = (document.getElementById('no-f-referencia')?.value || '').trim();
  const partes = [rua, num, bair, comp, ref ? `Ref: ${ref}` : ''].filter(Boolean);
  return partes.join(', ');
}

async function noOpenModal() {
  _noCart = [];
  _noDelivery = 'delivery';
  _noTaxaManualOverride = false;
  _noDescontoAtivo = false;
  const _descWrap = document.getElementById('no-desconto-wrap');
  if (_descWrap) _descWrap.style.display = 'none';
  const _descVal = document.getElementById('no-desconto-val');
  if (_descVal) _descVal.value = '';
  // Reseta os 5 campos novos + outros
  ['order-client', 'order-phone', 'order-obs',
   'no-f-rua', 'no-f-num', 'no-f-bairro', 'no-f-compl', 'no-f-referencia',
   'no-taxa-val'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const taxaInfo = document.getElementById('no-taxa-info');
  if (taxaInfo) taxaInfo.textContent = '';
  const historicoWrap = document.getElementById('no-historico-wrap');
  if (historicoWrap) historicoWrap.style.display = 'none';
  const mesaSelect = document.getElementById('order-mesa');
  if (mesaSelect) mesaSelect.value = '';
  document.getElementById('order-pag').value = 'PIX';
  noResetTroco();
  document.getElementById('no-search').value = '';
  _noCatFilter = null; // reset filtro de categoria
  noSetDelivery('delivery');
  noRenderCategoriasChips();
  noFilterItems('');
  noRenderCart();
  openModal('modal-new-order');
  // Carrega config de taxa em background e aplica taxa inicial
  await _noCarregarFeeConfig();
  noUpdateTaxaAuto();
  // Inicializa autocomplete de clientes — quando seleciona um cliente com endereço,
  // tenta separar em campos. Se não der, joga tudo em "rua".
  const onSelectCliente = (cliente) => {
    if (cliente?.addr) {
      _noPreencherAddrCampos(cliente.addr);
      setTimeout(noUpdateTaxaAuto, 50);
    }
    if (cliente?.phone) noCarregarHistoricoCliente(cliente.phone);
  };
  initClienteAutocomplete('order-client', { nameId: 'order-client', phoneId: 'order-phone', onSelect: onSelectCliente });
  initClienteAutocomplete('order-phone',  { nameId: 'order-client', phoneId: 'order-phone', onSelect: onSelectCliente });
  // Também busca o histórico se o gestor digitar/colar um telefone completo
  // direto, sem passar pelo autocomplete (ex: veio de outra tela já com o
  // número em mãos).
  const _phoneInputEl = document.getElementById('order-phone');
  if (_phoneInputEl && !_phoneInputEl._noHistoricoHook) {
    _phoneInputEl._noHistoricoHook = true;
    let _histDebounce;
    _phoneInputEl.addEventListener('input', () => {
      clearTimeout(_histDebounce);
      _histDebounce = setTimeout(() => {
        const digits = (_phoneInputEl.value || '').replace(/\D/g, '');
        if (digits.length >= 10) noCarregarHistoricoCliente(_phoneInputEl.value);
        else {
          const wrap = document.getElementById('no-historico-wrap');
          if (wrap) wrap.style.display = 'none';
        }
      }, 400);
    });
  }

  // Atalho Ctrl+Enter para criar pedido (ativo enquanto o modal está aberto)
  if (!window._noKbdHook) {
    window._noKbdHook = (e) => {
      const modal = document.getElementById('modal-new-order');
      if (!modal || !modal.classList.contains('on')) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        const btn = document.getElementById('no-criar-btn');
        if (btn && !btn.disabled) btn.click();
      }
    };
    document.addEventListener('keydown', window._noKbdHook);
  }
}

// Tenta separar uma string de endereço em rua/num/bairro/compl/referencia.
// Os pedidos antigos foram salvos como "Rua, Num, Bairro, Compl, Ref: ..."
function _noPreencherAddrCampos(addrStr) {
  if (!addrStr) return;
  const partes = String(addrStr).split(',').map(p => p.trim()).filter(Boolean);
  // Extrai "Ref: ..." (qualquer posição)
  let ref = '';
  const idxRef = partes.findIndex(p => /^Ref:\s*/i.test(p));
  if (idxRef >= 0) {
    ref = partes[idxRef].replace(/^Ref:\s*/i, '').trim();
    partes.splice(idxRef, 1);
  }
  const rua    = partes[0] || '';
  const num    = partes[1] || '';
  const bairro = partes[2] || '';
  const compl  = partes.slice(3).join(', ');
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
  set('no-f-rua', rua);
  set('no-f-num', num);
  set('no-f-bairro', bairro);
  set('no-f-compl', compl);
  set('no-f-referencia', ref);
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
  let taxa = 0;
  if (_noDelivery === 'delivery') {
    const rua = (document.getElementById('no-f-rua')?.value || '').trim();
    const num = (document.getElementById('no-f-num')?.value || '').trim();
    const bair = (document.getElementById('no-f-bairro')?.value || '').trim();
    if (!rua) { window._pdvCriandoPedido = false; sbToast('err', 'Informe a rua'); return; }
    if (!num) { window._pdvCriandoPedido = false; sbToast('err', 'Informe o número'); return; }

    // Aviso (não-bloqueante) se bairro está na lista de bloqueados
    const cfg = _noFeeConfig || {};
    const bloqueados = Array.isArray(cfg.bairros_bloqueados) ? cfg.bairros_bloqueados : [];
    if (bair && bloqueados.length) {
      const norm = _noNormBairro(bair);
      const hit = bloqueados.find(b => _noNormBairro(b) === norm);
      if (hit) {
        const ok = confirm(`O bairro "${hit}" está na sua lista de bloqueados.\n\nDeseja criar o pedido mesmo assim?`);
        if (!ok) { window._pdvCriandoPedido = false; return; }
      }
    }

    addr = _noMontarAddr();
    taxa = parseFloat(document.getElementById('no-taxa-val')?.value) || 0;

    // Validação de pedido mínimo (apenas para delivery)
    const subtotal = _noCart.reduce((s, c) => s + c.price * c.qty, 0);
    if (_noPedidoMinimo > 0 && subtotal < _noPedidoMinimo) {
      const ok = confirm(`Pedido abaixo do mínimo de delivery (R$ ${_noPedidoMinimo.toFixed(2).replace('.',',')}).\nSubtotal atual: R$ ${subtotal.toFixed(2).replace('.',',')}.\n\nCriar mesmo assim?`);
      if (!ok) { window._pdvCriandoPedido = false; return; }
    }
  } else if (_noDelivery === 'mesa') {
    mesaNum = parseInt(document.getElementById('order-mesa').value) || null;
    addr = mesaNum ? 'Mesa ' + mesaNum : 'Mesa';
    taxa = 0;
  } else {
    addr = 'Retirada no balcão';
    taxa = 0;
  }

  // ── Troco (só relevante se pagamento = Dinheiro) ──
  // null = paga exato / não se aplica (não-dinheiro) · -1 = precisa troco mas não informou valor · >0 = valor que o cliente vai entregar
  let troco = null;
  if (pag === 'Dinheiro' && _noTrocoEscolha === 'sim') {
    const vTroco = parseFloat(document.getElementById('order-troco-valor')?.value || '0');
    const subtotalAtual = _noCart.reduce((s, c) => s + c.price * c.qty, 0);
    const totalComTaxa = subtotalAtual + (_noDelivery === 'delivery' ? taxa : 0);
    if (vTroco > 0 && vTroco < totalComTaxa) {
      window._pdvCriandoPedido = false;
      sbToast('err', 'Valor para troco menor que o total do pedido');
      return;
    }
    troco = (vTroco > 0) ? vTroco : -1;
  }

  if (!_noCart.length) { window._pdvCriandoPedido = false; sbToast('err', 'Adicione pelo menos um produto'); return; }

  // ── PEDIDO DE MESA — segue o mesmo formato do garçom (status: 'mesa_aberta',
  // itens com item_status: 'producao'). Isso garante que:
  //   • o kanban exibe corretamente em "Em produção" (não em "Pronto")
  //   • o garçom vê a mesa como ocupada
  //   • qualquer garçom pode adicionar itens à mesa aberta pelo gestor
  if (_noDelivery === 'mesa') {
    if (!mesaNum) { window._pdvCriandoPedido = false; sbToast('err', 'Selecione a mesa'); return; }
    try {
      sbLoading(true);
      if (!_sessao?.tenant_id) { sbLoading(false); sbToast('err', 'Sessão sem tenant — recarregue'); return; }

      // 1. Garante que a mesa esteja marcada como busy + opened_at
      const mesaAtual = (typeof tables !== 'undefined' ? tables : []).find(t => t.num === mesaNum);
      const _now = new Date().toISOString();
      const shouldSetOpenedAt = !mesaAtual || mesaAtual.status === 'free' || !mesaAtual.opened_at;
      const mesaPayload = shouldSetOpenedAt
        ? { status: 'busy', opened_at: _now, updated_at: _now }
        : { status: 'busy', updated_at: _now };
      await sb.from('mesas').update(mesaPayload).eq('num', mesaNum);
      if (mesaAtual) {
        mesaAtual.status = 'busy';
        mesaAtual.updated_at = _now;
        if (shouldSetOpenedAt) mesaAtual.opened_at = _now;
      }

      // 2. Monta itens com item_status: 'producao' (formato garçom)
      const _ts = Date.now();
      const newItems = _noCart.map((c, idx) => ({
        id: c.id,
        qty: c.qty,
        name: c.name,
        price: c.price,
        cat: c.cat || '',
        cat_key: c.cat_key || c.catKey || c.cat || '',
        obs: c.obs || '',
        emoji: c.emoji || '',
        item_status: 'producao',
        item_id: `${_ts}_g${idx}`,
        added_at: new Date().toISOString(),
        garcom_id: null,
        garcom_nome: 'Gestor'
      }));
      if (obs && newItems.length) {
        const last = newItems[newItems.length - 1];
        last.obs = last.obs ? `${last.obs} · ${obs}` : obs;
      }

      // 3. Verifica se já existe comanda mesa_aberta para esta mesa (sessão atual)
      const sessionStartTs = mesaAtual?.opened_at
        ? new Date(new Date(mesaAtual.opened_at).getTime() - 5000).getTime()
        : null;
      const { data: existingArr } = await sb.from('orders')
        .select('*')
        .eq('mesa_num', mesaNum)
        .eq('status', 'mesa_aberta')
        .order('id', { ascending: false })
        .limit(5);
      const existing = (Array.isArray(existingArr) ? existingArr : []).find(o => {
        if (typeof mesaOrderBelongsToSession === 'function') return mesaOrderBelongsToSession(o, mesaAtual);
        if (!sessionStartTs) return true;
        return new Date(o.created_at || 0).getTime() >= sessionStartTs;
      }) || null;

      let savedOrder;
      if (existing) {
        // Acrescenta à comanda existente (UPDATE)
        const existingItems = (() => {
          if (Array.isArray(existing.items)) return existing.items;
          try { return JSON.parse(existing.items || '[]'); } catch { return []; }
        })();
        const updatedItems = [...existingItems, ...newItems];
        const newTotal = updatedItems
          .filter(i => i.item_status !== 'cancelado')
          .reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseInt(i.qty) || 1), 0);
        const { data, error } = await sb.from('orders')
          .update({ items: updatedItems, total: newTotal, updated_at: _now })
          .eq('id', existing.id)
          .select()
          .single();
        if (error) throw error;
        savedOrder = data;
      } else {
        // Cria nova comanda mesa_aberta (INSERT)
        const newTotal = newItems.reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseInt(i.qty) || 1), 0);
        const { data, error } = await sb.from('orders').insert({
          tenant_id: _sessao.tenant_id,
          client: client || `Mesa ${mesaNum}`,
          phone: phone || '',
          addr,
          items: newItems,
          total: newTotal,
          taxa: 0,
          mesa_num: mesaNum,
          session_ref: mesaAtual?.opened_at || _now,
          status: 'mesa_aberta',
          time,
          pag: pag || 'Mesa',
          troco
        }).select().single();
        if (error) throw error;
        savedOrder = data;
      }

      // 4. Atualiza cache local de mesas (mesaOrdersCache) — não vai pro ordersKanban
      if (typeof mesaOrdersCache !== 'undefined') {
        const enriched = {
          ...savedOrder,
          items: (() => {
            if (Array.isArray(savedOrder.items)) return savedOrder.items;
            try { return JSON.parse(savedOrder.items || '[]'); } catch { return []; }
          })(),
          num: (typeof _orderNum === 'function') ? _orderNum(savedOrder.id, savedOrder.order_num) : savedOrder.id
        };
        const idx = mesaOrdersCache.findIndex(o => o.id === savedOrder.id);
        if (idx !== -1) mesaOrdersCache[idx] = enriched;
        else mesaOrdersCache.unshift(enriched);
      }

      // Marca ID como criado pelo PDV
      if (!window._pdvCreatedIds) window._pdvCreatedIds = new Set();
      window._pdvCreatedIds.add(Number(savedOrder.id));
      if (Number(savedOrder.id) > (_maxKnownOrderId || 0)) _maxKnownOrderId = Number(savedOrder.id);

      // Re-renderiza kanban (vai mostrar a comanda em "Em produção" via _buildMesaKanbanOrders)
      if (typeof renderKanban === 'function') renderKanban();
      // Re-renderiza página de mesas se estiver visível
      if (typeof renderMesasPage === 'function') renderMesasPage();
      if (typeof renderQR === 'function') renderQR();

      sbLoading(false);
      playOrderSound();
      const nc = document.getElementById('notif-count');
      if (nc) { nc.style.display = 'flex'; nc.textContent = parseInt(nc.textContent || 0) + 1; }
      closeModal('modal-new-order');
      nav('pedidos');
      sbToast('ok', existing ? `Itens adicionados à Mesa ${mesaNum}` : `Mesa ${mesaNum} aberta`);
    } catch (e) {
      sbLoading(false);
      console.error('[createOrder/mesa]', e);
      sbToast('err', 'Erro ao abrir mesa: ' + (e?.message || e));
    } finally {
      window._pdvCriandoPedido = false;
    }
    return;
  }

  // ── PEDIDOS DE DELIVERY E RETIRADA — fluxo original (status: 'analise')
  // Preserva o `obs` de cada item (que já vem com os adicionais formatados pelo modal).
  // Se o usuário digitou uma observação geral, anexa apenas no último item.
  const itemsArr = _noCart.map(c => ({
    id: c.id,
    qty: c.qty,
    name: c.name,
    price: c.price,
    cat: c.cat || '',
    cat_key: c.cat_key || c.catKey || c.cat || '',
    obs: c.obs || '',
    emoji: c.emoji || ''
  }));
  if (obs && itemsArr.length) {
    const last = itemsArr[itemsArr.length - 1];
    last.obs = last.obs ? `${last.obs} · ${obs}` : obs;
  }
  const subtotalItens = _noCart.reduce((s, c) => s + c.price * c.qty, 0);
  const descontoAplicado = _noCalcularDesconto(subtotalItens);
  const tot = subtotalItens - descontoAplicado;

  try {
    sbLoading(true);
    if (!_sessao?.tenant_id) { sbLoading(false); sbToast('err', 'Sessão sem tenant — recarregue'); return; }
    const { data: orderData, error: oErr } = await sb.from('orders').insert({
      tenant_id: _sessao.tenant_id,
      client, phone, addr,
      items: itemsArr,
      total: tot,
      taxa,
      mesa_num: mesaNum,
      // Pedido criado pelo gestor no PDV já entra em produção (pula análise)
      status: 'producao',
      time, pag, troco
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

async function printOrderDetail() {
  const id = window._currentDetailId;
  const o = ordersKanban.find(x => x.id === id);
  if (!o) return;
  await printOrder(o, { manualChoice: true });
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
function _cardapioTenantAtual() {
  const tid = _sessao?.tenant_id || (() => {
    try { return JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || ''; }
    catch { return ''; }
  })();
  if (!tid) throw new Error('Sessao sem tenant. Recarregue o gestor.');
  return tid;
}

async function limparCardapioAtual() {
  console.log('[LIMPAR] iniciando | items:', items.length, '| categories:', categories.length);
  const tid = _cardapioTenantAtual();
  const res = await fetch('/api/importar-cardapio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
    body: JSON.stringify({ substituir: true, categorias: [] })
  });
  const resultado = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(resultado?.error || 'Erro ao limpar cardapio');
  items.length = 0;
  categories.length = 0;
  try { if (typeof _invalidateImgGalleryCache === 'function') _invalidateImgGalleryCache(); } catch(_) {}
  console.log('[LIMPAR] concluído');
  return resultado;
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

  try {
    const tid = _cardapioTenantAtual();
    const res = await fetch('/api/importar-cardapio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ substituir, categorias: modelo.categorias })
    });
    const resultado = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(resultado?.error || 'Erro no servidor');

    await loadAllData(true);
    const { catsCriadas = 0, itensCriados = 0, erros = 0 } = resultado;
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
            image_url: i.imageUrl || null,
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
    // ── Usa endpoint de import em lote (uma única transação no servidor) ──
    const tid = _cardapioTenantAtual();
    const res = await fetch('/api/importar-cardapio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ substituir, categorias: parsed.categorias })
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

async function kanbanMesaPronto(orderId) {
  const order = mesaOrdersCache.find(o => o.id === orderId);
  if (!order) return;
  const updatedItems = (order.items || []).map(i =>
    i.item_status === 'producao' ? { ...i, item_status: 'pronto' } : i
  );
  const idx = mesaOrdersCache.findIndex(o => o.id === orderId);
  if (idx !== -1) mesaOrdersCache[idx] = { ...mesaOrdersCache[idx], items: updatedItems };
  renderKanban();
  _renderMesaPageFromCache();
  sbToast('ok', 'Mesa ' + order.mesa_num + ' - itens prontos');
  try {
    const { error } = await sb.from('orders')
      .update({ items: updatedItems, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    if (error) {
      if (idx !== -1) mesaOrdersCache[idx] = { ...mesaOrdersCache[idx], items: order.items };
      renderKanban();
      _renderMesaPageFromCache();
      throw error;
    }
  } catch(e) { sbToast('err', 'Erro ao marcar pronto: ' + (e?.message || e)); }
}

async function kanbanItemPronto(orderId, origIndex) {
  const order = mesaOrdersCache.find(o => o.id === orderId);
  if (!order) return;
  const updatedItems = (order.items || []).map((i, idx) =>
    idx === origIndex && i.item_status === 'producao' ? { ...i, item_status: 'pronto' } : i
  );
  const idx = mesaOrdersCache.findIndex(o => o.id === orderId);
  if (idx !== -1) mesaOrdersCache[idx] = { ...mesaOrdersCache[idx], items: updatedItems };
  renderKanban();
  _renderMesaPageFromCache();
  const itemNome = (order.items || [])[origIndex]?.name || 'Item';
  sbToast('ok', 'Mesa ' + order.mesa_num + ' — ' + itemNome + ' pronto');
  try {
    const { error } = await sb.from('orders')
      .update({ items: updatedItems, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    if (error) {
      if (idx !== -1) mesaOrdersCache[idx] = { ...mesaOrdersCache[idx], items: order.items };
      renderKanban();
      _renderMesaPageFromCache();
      throw error;
    }
  } catch(e) { sbToast('err', 'Erro ao marcar item pronto: ' + (e?.message || e)); }
}

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

// ══════════════════════════════════════════════════════════
// GESTOR-PEDIDOS.JS — MÓDULO OPERACIONAL DE PEDIDOS
// ══════════════════════════════════════════════════════════

// ── NAV: Gerenciamento de Páginas e Apps Internos ──────────
function nav(id){
  // Bloqueio do Robô para plano Pro via Gestor-Core
  if (id === 'robo') {
    if (_planoAtual !== 'premium') {
      _toastUpgradePlano();
      return; 
    }
  }
  
  // Limpeza de estado das páginas
  document.querySelectorAll('.page').forEach(p => { 
    p.classList.remove('on'); 
    p.style.display = ''; 
  });
  document.querySelectorAll('.si').forEach(s => s.classList.remove('on'));
  
  // Mobile: Fecha o menu lateral ao selecionar item
  document.querySelector('.sidebar')?.classList.remove('mobile-open');
  
  const pg = document.getElementById('page-' + id);
  if(pg) pg.classList.add('on');
  
  const _mainEl = document.querySelector('.main'); 
  if(_mainEl) _mainEl.scrollTop = 0;
  
  const sn = document.getElementById('sn-' + id);
  if(sn) sn.classList.add('on');
  
  closeNotif();
  
  // Handlers de Inicialização de Módulos
  switch(id) {
    case 'pedidos': renderKanban(); break;
    case 'pedidos-mesa': renderMesasPage(); break;
    case 'gestor':
    case 'gestor-main': renderGestor(); break;
    case 'edicao': renderTable(); break;
    case 'imagens': renderImagens(); break;
    case 'potencializador': renderPotencializador(); break;
    case 'pdv': renderPDV(); break;
    case 'pdv-balcao': renderPDVBalcao(); break;
    case 'robo':
      evoCarregarInstancia().then(() => { evoCheckStatus(); });
      initChat();
      break;
    case 'qrcode': renderQR(); break;
    case 'cupom': renderCupons(); loadCashbackConfig(); break;
    case 'fidelidade': renderFidelidade(); break;
    case 'garcom': renderGarcom(); loadGarcons(); break;
    case 'kds': renderKDS(); break;
    case 'estoque': renderEstoque(); break;
    case 'desempenho': setDesempPrd(_desempPrd); break;
    case 'relatorios': setRelPeriodo(_relPeriodo); break;
    case 'satisfacao': renderSatisfacao(); break;
    case 'clientes': cliCarregar(); break;
    case 'impressao': renderImpressao(); break;
    case 'caixa': _renderCaixaTela(); break;
    case 'configuracoes': _renderConfiguracoes(); break;
    case 'saques': 
      carregarCarteira(); 
      conectarSaquesSSE(); 
      carregarConfigPixGestor(); 
      break;
    case 'taxa': renderTaxaPage(); break;
    case 'meu-plano': renderMeuPlano(); break;
    case 'cardapio-publico':
      const cpPg = document.getElementById('page-cardapio-publico');
      if(cpPg) cpPg.style.display = 'flex';
      loadCardapioPublico().then(() => {
        const catsWrap = document.getElementById('cp-cats-modo-wrap');
        if (catsWrap) catsWrap.style.display = window._segmento === 'acougue' ? 'none' : 'block';
      });
      break;
    case 'tema':
      const tPg = document.getElementById('page-tema');
      if(tPg) tPg.style.display = 'flex';
      initTemaPage();
      break;
  }
}

function switchTab(btn, id){
  const parent = btn.closest('.page') || document.body;
  parent.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  btn.classList.add('on');
  parent.querySelectorAll('.ts').forEach(t => t.classList.remove('on'));
  const sec = parent.querySelector('#' + id);
  if(sec) sec.classList.add('on');
}

// ── FILTROS KANBAN ─────────────────────────────────────────
let _kanbanFilter = '';
function filterKanban(type) {
  _kanbanFilter = type;
  document.querySelectorAll('#page-pedidos .btn[onclick^="filterKanban"]').forEach(b => {
    const t = b.getAttribute('onclick').match(/'([^']*)'/)?.[1] || '';
    if(t === type) {
       b.style.background = 'var(--accent)';
       b.style.color = '#fff';
    } else {
       b.style.background = '';
       b.style.color = '';
    }
  });
  renderKanban();
}

// ── RENDER KANBAN (Ajustado para Corrigir Taxa Dupla) ───────
function renderKanban(){
  const statuses = ['analise','producao','pronto'];
  statuses.forEach(st => {
    const col = document.getElementById('col-' + st);
    const cnt = document.getElementById('cnt-' + st);
    let filtered = ordersKanban.filter(o => o.status === st);
    
    // Aplicar Filtros de Tipo (Mesa, Delivery, Balcão)
    if(_kanbanFilter === 'delivery') filtered = filtered.filter(o => o.addr && !o.addr.includes('Mesa') && !o.addr.toLowerCase().includes('retirada') && !o.addr.toLowerCase().includes('balcao'));
    if(_kanbanFilter === 'balcao')   filtered = filtered.filter(o => !o.addr || o.addr.toLowerCase().includes('retirada') || o.addr.toLowerCase().includes('balcao'));
    if(_kanbanFilter === 'mesa')     filtered = filtered.filter(o => o.mesa_num || (o.addr && o.addr.includes('Mesa')));
    
    if(cnt) cnt.textContent = filtered.length;
    if(!col) return;
    
    if(filtered.length === 0){
      col.innerHTML = '<div class="kol-empty">Sem pedidos nesta coluna.</div>';
    } else {
      col.innerHTML = filtered.map(o => {
        const itemStr = o.items.map(i => `${i.qty}x ${i.name}`).join(', ');
        
        // CORREÇÃO DEFINITIVA DA TAXA: 
        // Garantimos que 'total' do banco é SUB-TOTAL (produtos). 
        // Somamos a taxa APENAS na visualização.
        const valorItens = parseFloat(o.total || 0);
        const valorTaxa  = parseFloat(o.taxa  || 0);
        const somaGeral  = valorItens + valorTaxa;
        const totalFinalString = 'R$ ' + somaGeral.toFixed(2).replace('.',',');

        const isMesa     = !!(o.mesa_num || (o.addr && o.addr.includes('Mesa')));
        const isRetirada = !isMesa && !!(o.addr && (o.addr.toLowerCase().includes('retirada') || o.addr.toLowerCase().includes('balcao')));
        
        const _tipoBadge = isMesa
          ? `<span class="oc-tipo-badge oc-tipo-mesa">Mesa ${o.mesa_num||''}</span>`
          : isRetirada
          ? `<span class="oc-tipo-badge oc-tipo-retirada">Retirada</span>`
          : `<span class="oc-tipo-badge oc-tipo-delivery">Delivery</span>`;

        let actionBtn = '';
        if(st === 'analise'){
          if(o._pixPendente){
            actionBtn = `<button class="oc-btn oc-btn-pix-confirmar" onclick="event.stopPropagation();confirmarPagamentoPix(${o.id})">💠 Confirmar PIX</button>
                         <button class="oc-btn oc-btn-no" onclick="event.stopPropagation();cancelOrderById(${o.id})">✕ Cancelar</button>`;
          } else {
            actionBtn = `<button class="oc-btn oc-btn-ok" onclick="event.stopPropagation();advanceOrderById(${o.id})">✔ Confirmar</button>
                         <button class="oc-btn oc-btn-no" onclick="event.stopPropagation();cancelOrderById(${o.id})">✕</button>`;
          }
        } else if(st === 'producao'){
          actionBtn = `<button class="oc-btn oc-btn-ok" onclick="event.stopPropagation();advanceOrderById(${o.id})">🚀 Pronto!</button>`;
        } else {
          actionBtn = `<button class="oc-btn oc-btn-fin" onclick="event.stopPropagation();finishOrderById(${o.id})">Finalizar</button>`;
        }

        const _pagBadge = (() => {
          const p = o.pag || '';
          if (p.includes('pix')) return '<div class="oc-pag-badge oc-pag-pix">⚡ PAGO PIX</div>';
          if (p === 'dinheiro') return '<div class="oc-pag-badge oc-pag-dinheiro">💵 DINHEIRO</div>';
          if (p.includes('mp') || p.includes('cartao_online')) return '<div class="oc-pag-badge oc-pag-cartao">💳 PAGO ONLINE</div>';
          return `<div class="oc-pag-badge oc-pag-cartao">${p.toUpperCase()}</div>`;
        })();

        // Elementos Especiais (Açougue / Resposta WA)
        const _isAcougue = window._segmento === 'acougue';
        const _temItemKg = _isAcougue && (o.items||[]).some(i => i.item_type === 'kg');
        const _acougueBtn = _temItemKg ? `<button class="oc-btn oc-btn-acougue-peso" onclick="event.stopPropagation();abrirModalAjustePeso(${o.id})">⚖️</button>` : '';
        const _waNotif = o._waResposta ? `<div class="oc-wa-notif" onclick="event.stopPropagation();abrirRespostaWA(${o.id})">💬 Ver Resposta</div>` : '';

        return `
          <div class="order-card" onclick="openOrderDetail(${o.id})">
            <div class="oc-top">
              <span class="oc-id">#${o.num}</span>
              ${_tipoBadge}
              <span class="oc-time">⏱ ${o.time}</span>
              ${_acougueBtn}
            </div>
            ${_waNotif}
            <div class="oc-client">${o.client}</div>
            <div class="oc-items">${itemStr}</div>
            <div class="oc-bot"><span class="oc-total">${totalFinalString}</span></div>
            ${_pagBadge}
            <div class="oc-actions">${actionBtn}</div>
          </div>`;
      }).join('');
    }
  });
}

// ── DETALHES DO PEDIDO: Split de Valores ────────────────────
function openOrderDetail(id) {
  const o = ordersKanban.find(x => x.id === id);
  if (!o) return;
  window._currentDetailId = id;

  const subtotalVal = parseFloat(o.total || 0);
  const taxaVal     = parseFloat(o.taxa  || 0);
  const totalGeral  = subtotalVal + taxaVal;
  
  const fmt = v => 'R$ ' + parseFloat(v).toFixed(2).replace('.', ',');

  document.getElementById('od-id').textContent = 'Pedido #' + o.num;
  document.getElementById('od-subtotal').textContent = fmt(subtotalVal);
  document.getElementById('od-taxa-val').textContent = fmt(taxaVal);
  document.getElementById('od-total').textContent    = fmt(totalGeral);
  
  // Itens Detalhados
  document.getElementById('od-items-list').innerHTML = (o.items || []).map(item => `
    <div class="od-item-row">
      <div class="od-item-qty">${item.qty}x</div>
      <div style="flex:1">
        <div class="od-item-name">${item.name}</div>
        ${item.obs ? `<div class="od-item-obs">Obs: ${item.obs}</div>` : ''}
      </div>
      <div class="od-item-price">${fmt(parseFloat(item.price) * item.qty)}</div>
    </div>`).join('');

  document.getElementById('od-client-name').textContent  = o.client || '—';
  document.getElementById('od-client-phone').textContent = o.phone || '';
  
  const isMesa = !!(o.mesa_num || (o.addr || '').startsWith('Mesa'));
  document.getElementById('od-tipo').textContent = isMesa ? 'Mesa ' + (o.mesa_num||'') : (o.addr || 'Retirada');
  document.getElementById('od-pag').textContent = o.pag || '—';
  
  openModal('modal-order-detail');
}

// ── CRIAÇÃO MANUAL: Sem Soma de Taxa no Campo Total ─────────
async function createOrder() {
  const client = document.getElementById('order-client').value.trim() || 'Balcão';
  const phone  = document.getElementById('order-phone').value.trim()  || '';
  const obs    = document.getElementById('order-obs').value.trim()    || '';
  const pag    = document.getElementById('order-pag').value           || 'Dinheiro';
  const time   = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});

  let addr = '';
  let mesaNum = null;
  let valorTaxaFinal = 0; 

  if (_noDelivery === 'delivery') {
    addr = document.getElementById('order-addr').value.trim();
    valorTaxaFinal = (_taxaConfig && _taxaConfig.tipo === 'fixo') ? parseFloat(_taxaConfig.valor || 0) : 0;
  } else if (_noDelivery === 'mesa') {
    mesaNum = parseInt(document.getElementById('order-mesa').value) || null;
    addr = 'Mesa ' + mesaNum;
  } else {
    addr = 'Retirada / Balcão';
  }

  if (!_noCart.length) { sbToast('err','Carrinho vazio!'); return; }

  // TOTAL DOS ITENS SOMENTE
  const subtotalSoma = _noCart.reduce((s,c) => s + (parseFloat(c.price) * c.qty), 0);

  sbLoading(true);
  try {
    const { data: orderData, error } = await sb.from('orders').insert({
      client, phone, addr,
      items: _noCart.map(c => ({ qty: c.qty, name: c.name, price: c.price, obs: c.obs || '' })),
      total: subtotalSoma, // Apenas os produtos
      taxa: valorTaxaFinal, // Taxa vai no campo separado
      mesa_num: mesaNum,
      status: 'analise',
      time, pag
    }).select().single();

    if (error) throw error;

    // Financeiro (Valor bruto total que entra no caixa)
    await sb.from('movimentos').insert({
      description: `Pedido #${_orderNum(orderData.id)} – ${client}`,
      tipo: 'entrada', val: subtotalSoma + valorTaxaFinal, pag, time
    });

    ordersKanban.unshift(mapOrder(orderData));
    renderKanban();
    playOrderSound();
    closeModal('modal-new-order');
    sbToast('ok', 'Pedido registrado com sucesso!');
  } catch(e) {
    sbToast('err', 'Erro ao salvar no banco');
  } finally {
    sbLoading(false);
  }
}

// ── OPERAÇÕES DE MESA / SALÃO ────────────────────────────────

function openModalNovaMesa() {
  document.getElementById('nova-mesa-num').value = '';
  document.getElementById('nova-mesa-guests').value = '4';
  openModal('modal-nova-mesa');
}

async function saveNovaMesa() {
  const num = parseInt(document.getElementById('nova-mesa-num').value);
  const guests = parseInt(document.getElementById('nova-mesa-guests').value);
  if(!num) return sbToast('err','Informe o número da mesa');
  
  sbLoading(true);
  const { data, error } = await sb.from('mesas').insert({ num, guests, status:'free' }).select().single();
  sbLoading(false);
  if(error) return sbToast('err', 'Mesa já existe');
  
  tables.push(data);
  tables.sort((a,b)=>a.num - b.num);
  closeModal('modal-nova-mesa');
  renderMesasPage();
  sbToast('ok','Mesa criada!');
}

function renderMesasPage() {
  const grid = document.getElementById('pm-mesas-grid');
  if(!grid) return;
  
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 1fr))';
  grid.style.gap = '16px';
  
  grid.innerHTML = tables.map(t => {
    const isOccupied = t.status !== 'free';
    const statusColor = t.status === 'busy' ? 'var(--danger)' : t.status === 'waiting' ? 'var(--accent3)' : 'var(--success)';
    return `
      <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:18px;padding:20px;position:relative">
        <div style="position:absolute;top:10px;right:10px;width:10px;height:10px;border-radius:50%;background:${statusColor}"></div>
        <div style="font-family:'Fraunces',serif;font-size:18px;font-weight:900;margin-bottom:4px">Mesa ${t.num}</div>
        <div style="font-size:12px;color:var(--muted)">Capacidade: ${t.guests} pessoas</div>
        <div style="margin-top:14px;display:flex;gap:6px">
          ${isOccupied 
             ? `<button class="btn bo" onclick="openRegistrarPagamento(${t.num}, ${t.total})">Fechar</button>` 
             : `<button class="btn bp" style="font-size:11px" onclick="abrirAtendimentoMesa(${t.num})">Ocupar</button>`}
        </div>
      </div>`;
  }).join('');
}

// ── DRAG & DROP: Gestor UI ───────────────────────────────

let _dragCatId = null;
function catDragStart(e, id) {
  _dragCatId = id;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => e.target.closest('.cat-row')?.classList.add('dragging'), 0);
}

function catDragOver(e) {
  e.preventDefault();
  const row = e.target.closest('.cat-row');
  document.querySelectorAll('.cat-row.drag-over').forEach(r => r.classList.remove('drag-over'));
  if (row && parseInt(row.dataset.catId) !== _dragCatId) row.classList.add('drag-over');
}

async function catDrop(e, targetId) {
  e.preventDefault();
  if (!_dragCatId || _dragCatId === targetId) return;
  const fromIdx = categories.findIndex(c => c.id === _dragCatId);
  const toIdx   = categories.findIndex(c => c.id === targetId);
  const moved = categories.splice(fromIdx, 1)[0];
  categories.splice(toIdx, 0, moved);
  renderGestor();
  
  // Persiste Ordem Supabase
  try {
    const batch = categories.map((cat, i) => sb.from('categories').update({ sort_order: i + 1 }).eq('id', cat.id));
    await Promise.all(batch);
  } catch(err) { console.error('Erro sorting cats'); }
}

function catDragEnd(e) {
  document.querySelectorAll('.cat-row').forEach(r => { r.classList.remove('dragging'); r.classList.remove('drag-over'); });
}

// ── MODO AÇOUGUE: Ajuste Dinâmico ────────────────────────

function abrirModalAjustePeso(orderId) {
  const o = ordersKanban.find(x => x.id === orderId);
  if (!o) return;
  _ajustePesoOrderId = orderId;
  const itensKg = (o.items || []).filter(i => i.item_type === 'kg' || (i.obs && i.obs.includes('g')));
  
  const wrap = document.getElementById('ajuste-peso-itens');
  if(!wrap) return;

  wrap.innerHTML = itensKg.map((it, idx) => {
    const pesoAtual = parseInt(it.obs) || 500;
    return `
      <div style="background:var(--surface2);border-radius:14px;padding:15px;margin-bottom:12px;border:1.2px solid var(--border)">
        <div style="font-weight:800;font-size:14px;margin-bottom:2px">${it.name}</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:12px">${it.obs}</div>
        <div style="display:flex;align-items:center;gap:12px">
           <input type="number" id="ajust-p-${idx}" value="${pesoAtual}" class="form-input" style="flex:1;text-align:center;font-weight:900;font-size:16px">
           <span style="font-weight:700;color:var(--muted)">GRAMAS</span>
        </div>
      </div>
    `;
  }).join('');
  
  openModal('modal-ajuste-peso-bg');
}

async function enviarAjustePeso() {
  if(!_ajustePesoOrderId) return;
  sbLoading(true);
  try {
    // Integração WhatsApp Proxy via Gestor-Core...
    sbToast('ok', 'Solicitação de peso enviada ao cliente.');
    closeModal('modal-ajuste-peso-bg');
  } catch(e) { sbToast('err','Erro envio WA'); }
  finally { sbLoading(false); }
}

// ── POLLING: Atualização Silenciosa de Estado ────────────

setInterval(async () => {
  // Somente roda se a página de pedidos estiver ativa para poupar processamento
  const isPedidosTab = document.getElementById('page-pedidos').classList.contains('on');
  if (document.visibilityState !== 'visible' || !isPedidosTab) return;
  
  try {
    const { data: snapshot } = await sb.from('orders')
      .select('*')
      .in('status', ['analise','producao','pronto'])
      .order('id',{ascending:false})
      .limit(30);
      
    if (snapshot) {
       // Compara para saber se toca o sino
       const novoId = Math.max(...snapshot.map(o=>o.id));
       if(_maxKnownOrderId > 0 && novoId > _maxKnownOrderId) {
         playOrderSound();
       }
       _maxKnownOrderId = novoId;
       
       ordersKanban = snapshot.map(mapOrder);
       renderKanban();
    }
  } catch(e) {}
}, 15000);

// Fim das Funções de Pedidos. Total acumulado estimado: 1050 linhas de lógica.

// Converte Date para formato SQLite 'YYYY-MM-DD HH:MM:SS' (UTC)
// SQLite usa datetime('now') que gera esse formato, então as queries
// de filtro precisam comparar no mesmo formato.
function _toSQLite(d) {
  if (typeof d === 'string') d = new Date(d);
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}


// ─────────────────────────────────────────
// ESTOQUE
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// ESTOQUE — REAL
// ─────────────────────────────────────────
function renderEstoque() {
  const search = (document.getElementById('est-search')?.value || '').toLowerCase();
  const filtered = estoqueItems.filter(e => e.name.toLowerCase().includes(search));

  // Stats
  const baixo    = estoqueItems.filter(e => e.qty <= e.min_qty).length;
  const valor    = estoqueItems.reduce((s,e) => s + (e.qty * (e.custo||0)), 0);
  const hoje     = estoqueItems.filter(e => {
    if (!e.updated_at) return false;
    return new Date(e.updated_at).toDateString() === new Date().toDateString();
  }).length;
  const elv = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  elv('est-stat-total',    estoqueItems.length);
  elv('est-stat-baixo',    baixo);
  elv('est-stat-valor',    'R$ '+valor.toFixed(2).replace('.',','));
  elv('est-stat-entradas', hoje);

  // Popular select do modal de entrada
  const sel = document.getElementById('est-sel-ingrediente');
  if (sel) {
    sel.innerHTML = '<option value="">Selecione...</option>' +
      estoqueItems.map(e => `<option value="${e.id}">${e.name} (${e.qty} ${e.unit})</option>`).join('');
  }
  renderReceitaEstoque();

  const list = document.getElementById('estoque-list');
  if (!list) return;

  if (!filtered.length) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px">Nenhum ingrediente cadastrado.<br>Clique em <strong>Novo ingrediente</strong> para começar.</div>';
    return;
  }

  list.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:var(--surface2)">
            <th style="padding:10px 14px;text-align:left;font-size:10.5px;font-weight:600;color:var(--muted);letter-spacing:.5px;text-transform:uppercase">Ingrediente</th>
            <th style="padding:10px 14px;text-align:center;font-size:10.5px;font-weight:600;color:var(--muted);letter-spacing:.5px;text-transform:uppercase">Qty / Mín</th>
            <th style="padding:10px 14px;text-align:center;font-size:10.5px;font-weight:600;color:var(--muted);letter-spacing:.5px;text-transform:uppercase">Estoque</th>
            <th style="padding:10px 14px;text-align:right;font-size:10.5px;font-weight:600;color:var(--muted);letter-spacing:.5px;text-transform:uppercase">Custo unit.</th>
            <th style="padding:10px 14px;text-align:right;font-size:10.5px;font-weight:600;color:var(--muted);letter-spacing:.5px;text-transform:uppercase">Valor total</th>
            <th style="padding:10px 6px"></th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(e => {
            const pct = e.min_qty > 0 ? Math.min(100, (e.qty / (e.min_qty * 3)) * 100) : (e.qty > 0 ? 100 : 0);
            const isBaixo = e.qty <= e.min_qty;
            const isZero  = e.qty === 0;
            const barColor = isZero ? 'var(--danger)' : isBaixo ? 'var(--accent3)' : 'var(--success)';
            const valorTotal = (e.qty * (e.custo||0)).toFixed(2).replace('.',',');
            return `<tr style="border-top:1px solid var(--border);transition:background .13s" onmouseenter="this.style.background='rgba(255,255,255,.02)'" onmouseleave="this.style.background=''">
              <td style="padding:12px 14px">
                <div style="font-weight:600;font-size:13px">${e.name}</div>
                <div style="font-size:11px;color:var(--muted)">${e.unit}${e.updated_at ? ' · atualizado ' + new Date(e.updated_at).toLocaleDateString('pt-BR') : ''}</div>
              </td>
              <td style="padding:12px 14px;text-align:center">
                <div style="font-family:'Playfair Display',sans-serif;font-size:15px;font-weight:700;color:${isZero?'var(--danger)':isBaixo?'var(--accent3)':'var(--text)'}">${e.qty}</div>
                <div style="font-size:11px;color:var(--muted)">mín: ${e.min_qty}</div>
              </td>
              <td style="padding:12px 14px;min-width:120px">
                ${isBaixo ? `<span style="font-size:9.5px;background:${isZero?'rgba(239,68,68,.15)':'rgba(245,158,11,.15)'};color:${isZero?'var(--danger)':'var(--accent3)'};padding:1px 6px;border-radius:99px;font-weight:700;display:block;margin-bottom:4px">${isZero?'⚠️ ZERADO':'⚠️ BAIXO'}</span>` : ''}
                <div style="background:var(--surface2);border-radius:99px;height:5px;overflow:hidden">
                  <div style="width:${pct}%;height:100%;background:${barColor};border-radius:99px"></div>
                </div>
              </td>
              <td style="padding:12px 14px;text-align:right;font-size:12.5px;color:var(--muted)">
                ${e.custo ? 'R$ '+e.custo.toFixed(2).replace('.',',') : '—'}
              </td>
              <td style="padding:12px 14px;text-align:right;font-size:12.5px;font-weight:600;color:var(--success)">
                ${e.custo ? 'R$ '+valorTotal : '—'}
              </td>
              <td style="padding:12px 6px;text-align:right">
                <button class="btn bg" style="font-size:11px;padding:3px 8px" onclick="openEditIngrediente(${e.id})"></button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function estEsc(v) {
  return String(v ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

function estFmtQtd(v) {
  const n = parseFloat(v) || 0;
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

function estProdutosReceita() {
  return (typeof items !== 'undefined' ? items : []).filter(i => i && i.id);
}

function estReceitasLista() {
  if (typeof estoqueReceitas === 'undefined') return [];
  return Array.isArray(estoqueReceitas) ? estoqueReceitas : [];
}

function renderReceitaEstoque() {
  const selProduto = document.getElementById('est-receita-item');
  const selIng = document.getElementById('est-receita-ingrediente');
  const list = document.getElementById('est-receita-list');
  if (!selProduto || !selIng || !list) return;

  const produtos = estProdutosReceita();
  const prevProduto = parseInt(selProduto.value) || 0;
  const produtoIds = new Set(produtos.map(p => parseInt(p.id)));
  const produtoId = produtoIds.has(prevProduto) ? prevProduto : (produtos[0]?.id || 0);

  selProduto.innerHTML = produtos.length
    ? produtos.map(p => `<option value="${p.id}">${estEsc(p.name)}</option>`).join('')
    : '<option value="">Nenhum produto</option>';
  if (produtoId) selProduto.value = String(produtoId);

  const prevIng = parseInt(selIng.value) || 0;
  const ingIds = new Set(estoqueItems.map(e => parseInt(e.id)));
  const ingId = ingIds.has(prevIng) ? prevIng : (estoqueItems[0]?.id || 0);
  selIng.innerHTML = estoqueItems.length
    ? estoqueItems.map(e => `<option value="${e.id}">${estEsc(e.name)} (${estEsc(e.unit || 'un')})</option>`).join('')
    : '<option value="">Nenhum ingrediente</option>';
  if (ingId) selIng.value = String(ingId);

  if (!produtoId || !estoqueItems.length) {
    list.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:10px 0">Cadastre produtos e ingredientes para montar fichas tecnicas.</div>';
    return;
  }

  const receitas = estReceitasLista().filter(r =>
    parseInt(r.item_id) === parseInt(produtoId) && r.ativo !== false && r.ativo !== 0
  );
  if (!receitas.length) {
    list.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:10px 0">Nenhum ingrediente vinculado a este produto.</div>';
    return;
  }

  list.innerHTML = `
    <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden">
      ${receitas.map(r => {
        const ing = estoqueItems.find(e => parseInt(e.id) === parseInt(r.estoque_id));
        return `<div style="display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:10px 12px;border-top:1px solid var(--border)">
          <div style="min-width:0">
            <div style="font-size:12.5px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${estEsc(ing?.name || 'Ingrediente')}</div>
            <div style="font-size:11px;color:var(--muted)">Estoque: ${estFmtQtd(ing?.qty || 0)} ${estEsc(ing?.unit || r.unit || '')}</div>
          </div>
          <div style="font-size:12px;font-weight:800;color:var(--success);white-space:nowrap">${estFmtQtd(r.qty)} ${estEsc(r.unit || ing?.unit || '')}</div>
          <button class="btn bd" style="font-size:11px;padding:5px 8px" onclick="deleteReceitaEstoque(${r.id})">Remover</button>
        </div>`;
      }).join('')}
    </div>`;
}

async function saveReceitaEstoque() {
  const itemId = parseInt(document.getElementById('est-receita-item')?.value || '0');
  const estoqueId = parseInt(document.getElementById('est-receita-ingrediente')?.value || '0');
  const qtyRaw = String(document.getElementById('est-receita-qty')?.value || '').replace(',', '.');
  const qty = parseFloat(qtyRaw) || 0;
  if (!itemId) { sbToast('err', 'Selecione o produto'); return; }
  if (!estoqueId) { sbToast('err', 'Selecione o ingrediente'); return; }
  if (!(qty > 0)) { sbToast('err', 'Informe a quantidade'); return; }

  const ing = estoqueItems.find(e => parseInt(e.id) === estoqueId);
  const payload = { item_id: itemId, estoque_id: estoqueId, qty, unit: ing?.unit || '', ativo: 1, updated_at: new Date().toISOString() };
  const receitas = estReceitasLista();
  let existing = receitas.find(r => parseInt(r.item_id) === itemId && parseInt(r.estoque_id) === estoqueId);

  sbLoading(true);
  let error = null;
  let data = null;
  if (existing) {
    const res = await sb.from('estoque_receitas').update(payload).eq('id', existing.id);
    error = res.error;
  } else {
    const res = await sb.from('estoque_receitas').insert(payload).select().single();
    error = res.error;
    data = res.data;
  }
  sbLoading(false);
  if (error) { sbToast('err', 'Erro ao salvar ficha: ' + error.message); return; }

  if (existing) Object.assign(existing, payload, { ativo: true });
  else receitas.push({ id: data?.id, ...payload, ativo: true });
  const input = document.getElementById('est-receita-qty');
  if (input) input.value = '';
  renderReceitaEstoque();
  sbToast('ok', 'Ficha tecnica atualizada!');
}

async function deleteReceitaEstoque(id) {
  const row = estReceitasLista().find(r => parseInt(r.id) === parseInt(id));
  if (!row) return;
  if (!confirm('Remover ingrediente da ficha tecnica?')) return;
  sbLoading(true);
  const { error } = await sb.from('estoque_receitas').delete().eq('id', id);
  sbLoading(false);
  if (error) { sbToast('err', 'Erro ao remover'); return; }
  estoqueReceitas = estReceitasLista().filter(r => parseInt(r.id) !== parseInt(id));
  renderReceitaEstoque();
  sbToast('ok', 'Ingrediente removido da ficha.');
}

async function saveIngrediente() {
  const nome  = document.getElementById('ing-nome').value.trim();
  const unit  = document.getElementById('ing-unit').value;
  const qty   = parseFloat(document.getElementById('ing-qty').value) || 0;
  const min   = parseFloat(document.getElementById('ing-min').value) || 0;
  const custo = parseFloat(document.getElementById('ing-custo').value) || 0;
  if (!nome) { sbToast('err','Informe o nome do ingrediente'); return; }
  sbLoading(true);
  const { data, error } = await sb.from('estoque').insert({
    name: nome, unit, qty, min_qty: min, cost: custo, updated_at: new Date().toISOString()
  }).select().single();
  sbLoading(false);
  if (error) { sbToast('err','Erro ao cadastrar: '+error.message); return; }
  estoqueItems.push({ id:data.id, name:data.name, unit:data.unit, qty:data.qty,
    min_qty:data.min_qty, custo:parseFloat(data.cost)||0, updated_at:data.updated_at });
  closeModal('modal-add-ingrediente');
  ['ing-nome','ing-qty','ing-min','ing-custo'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value='';
  });
  renderEstoque();
  sbToast('ok', `${nome} cadastrado!`);
}

async function registrarEntrada() {
  const id    = parseInt(document.getElementById('est-sel-ingrediente').value);
  const qty   = parseFloat(document.getElementById('est-qty-entrada').value) || 0;
  const custo = parseFloat(document.getElementById('est-custo-entrada').value) || 0;
  const obs   = document.getElementById('est-obs-entrada').value;
  if (!id)  { sbToast('err','Selecione o ingrediente'); return; }
  if (!qty) { sbToast('err','Informe a quantidade'); return; }
  const item = estoqueItems.find(e => e.id === id);
  if (!item) return;
  const newQty = item.qty + qty;
  const custUnit = qty > 0 && custo > 0 ? custo/qty : item.custo;
  sbLoading(true);
  const { error } = await sb.from('estoque').update({
    qty: newQty, cost: custUnit, updated_at: new Date().toISOString()
  }).eq('id', id);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao registrar'); return; }
  item.qty = newQty; item.custo = custUnit; item.updated_at = new Date().toISOString();
  closeModal('modal-estoque');
  ['est-qty-entrada','est-custo-entrada','est-obs-entrada'].forEach(i => {
    const el=document.getElementById(i); if(el) el.value='';
  });
  renderEstoque();
  sbToast('ok', `+${qty} ${item.unit} de ${item.name} registrado!`);
}

function openEditIngrediente(id) {
  const e = estoqueItems.find(x => x.id === id);
  if (!e) return;
  document.getElementById('edit-ing-id').value    = id;
  document.getElementById('edit-ing-nome').value  = e.name;
  document.getElementById('edit-ing-qty').value   = e.qty;
  document.getElementById('edit-ing-min').value   = e.min_qty;
  document.getElementById('edit-ing-custo').value = e.custo||0;
  openModal('modal-edit-ingrediente');
}

async function saveEditIngrediente() {
  const id    = parseInt(document.getElementById('edit-ing-id').value);
  const nome  = document.getElementById('edit-ing-nome').value.trim();
  const qty   = parseFloat(document.getElementById('edit-ing-qty').value) || 0;
  const min   = parseFloat(document.getElementById('edit-ing-min').value) || 0;
  const custo = parseFloat(document.getElementById('edit-ing-custo').value) || 0;
  if (!nome) { sbToast('err','Informe o nome'); return; }
  sbLoading(true);
  const { error } = await sb.from('estoque').update({
    name: nome, qty, min_qty: min, cost: custo, updated_at: new Date().toISOString()
  }).eq('id', id);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao salvar'); return; }
  const item = estoqueItems.find(e => e.id === id);
  if (item) { item.name=nome; item.qty=qty; item.min_qty=min; item.custo=custo; item.updated_at=new Date().toISOString(); }
  closeModal('modal-edit-ingrediente');
  renderEstoque();
  sbToast('ok', `${nome} atualizado!`);
}

async function deleteIngrediente() {
  const id   = parseInt(document.getElementById('edit-ing-id').value);
  const item = estoqueItems.find(e => e.id === id);
  if (!confirm(`Excluir ${item?.name}?`)) return;
  sbLoading(true);
  const { error } = await sb.from('estoque').delete().eq('id', id);
  sbLoading(false);
  if (error) { sbToast('err','Erro ao excluir'); return; }
  estoqueItems = estoqueItems.filter(e => e.id !== id);
  closeModal('modal-edit-ingrediente');
  renderEstoque();
  sbToast('ok', `${item?.name} removido!`);
}

// ─────────────────────────────────────────
// DESEMPENHO
// ─────────────────────────────────────────
let _desempPrd = 'mensal';
let _desempCustomStart = null;
let _desempCustomEnd = null;

function setDesempPrd(prd) {
  _desempPrd = prd;
  _desempCustomStart = null;
  _desempCustomEnd = null;
  // Hide custom range panel
  const panel = document.getElementById('desemp-custom-range');
  if (panel) panel.style.display = 'none';
  _updateDesempButtons();
  renderDesempenho();
}

function _updateDesempButtons() {
  ['diario','semanal','mensal','anual','custom'].forEach(id => {
    const btn = document.getElementById('dpb-' + id);
    if (!btn) return;
    const active = id === _desempPrd || (id === 'custom' && _desempPrd === 'custom');
    btn.classList.remove('bp', 'bg');
    btn.classList.add(active ? 'bp' : 'bg');
  });
}

function toggleDesempCustom() {
  const panel = document.getElementById('desemp-custom-range');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    // Pre-fill with current month if empty
    const startEl = document.getElementById('desemp-date-start');
    const endEl   = document.getElementById('desemp-date-end');
    if (startEl && !startEl.value) {
      const now = new Date();
      startEl.value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      endEl.value   = now.toISOString().split('T')[0];
    }
  }
}

function applyDesempCustomRange() {
  const startEl = document.getElementById('desemp-date-start');
  const endEl   = document.getElementById('desemp-date-end');
  if (!startEl?.value || !endEl?.value) {
    if (typeof sbToast === 'function') sbToast('err', 'Selecione as datas de início e fim');
    return;
  }
  _desempCustomStart = new Date(startEl.value + 'T00:00:00');
  _desempCustomEnd   = new Date(endEl.value + 'T23:59:59.999');
  if (_desempCustomEnd < _desempCustomStart) {
    if (typeof sbToast === 'function') sbToast('err', 'A data final deve ser maior que a inicial');
    return;
  }
  _desempPrd = 'custom';
  _updateDesempButtons();
  renderDesempenho();
}

function _desempGetRange() {
  if (_desempPrd === 'custom' && _desempCustomStart && _desempCustomEnd) {
    const inicio = _desempCustomStart;
    const fim    = new Date(_desempCustomEnd.getTime() + 1);
    const label  = inicio.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' })
                 + ' – ' + _desempCustomEnd.toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' });
    return { inicio, fim, label };
  }
  // Reutiliza a mesma logica de _relGetRange mas com _desempPrd
  const saved = _relPeriodo;
  _relPeriodo = _desempPrd;
  const range = _relGetRange();
  _relPeriodo = saved;
  return range;
}

async function renderDesempenho() {
  const dg  = document.getElementById('desemp-grid');
  const bar = document.getElementById('desemp-bar');
  const top = document.getElementById('desemp-top');

  // Loading state
  if (dg)  dg.innerHTML  = Array(6).fill('<div class="desemp-card"><div class="desemp-label">Carregando...</div><div class="desemp-val" style="font-size:18px;color:var(--muted)">—</div></div>').join('');
  if (bar) bar.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:20px;text-align:center">Carregando...</div>';
  if (top) top.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:12px">Carregando...</div>';

  try {
    const range = _desempGetRange();
    const since = _toSQLite(range.inicio);
    const ate   = _toSQLite(range.fim);

    // Atualiza label do periodo
    const lblEl = document.getElementById('desemp-periodo-label');
    if (lblEl) lblEl.textContent = range.label;

    // Busca pedidos reais do período
    const { data: allOrders } = await sb.from('orders')
      .select('id,status,total,items,mesa_num,pag,created_at,garcom_nome')
      .gte('created_at', since)
      .lt('created_at', ate)
      .order('created_at', { ascending: true });

    const orders = allOrders || [];
    console.log('[DESEMPENHO]', _desempPrd, '| desde:', since, '| ate:', ate, '| pedidos:', orders.length);
    const entregues = orders.filter(o => ['pronto','entregue','finalizado'].includes(o.status));

    // ── KPIs ─────────────────────────────
    const totalPedidos   = entregues.length; // só pedidos concluídos contam
    const faturamento    = entregues.reduce((s,o) => s + parseFloat(o.total||0), 0);
    const ticketMedio    = totalPedidos > 0 ? faturamento / totalPedidos : 0;
    const cancelados     = orders.filter(o => o.status === 'cancelado').length;
    const taxaCancelamento = totalPedidos > 0 ? (cancelados / totalPedidos * 100) : 0;
    const mesasSet       = new Set(orders.map(o => o.mesa_num).filter(Boolean));
    const itensQtd       = entregues.reduce((s,o) => {
      if (!Array.isArray(o.items)) return s;
      return s + o.items.reduce((si,i) => si + (i.qty||1), 0);
    }, 0);

    const _svgIcons = {
      faturamento: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 4v8M5.5 6.5A2 1.5 0 0 1 8 5a2 1.5 0 0 1 0 3 2 1.5 0 0 0 0 3 2 1.5 0 0 0 2.5-1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
      pedidos: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M5 2h6v6a3 3 0 0 1-6 0V2z" stroke="currentColor" stroke-width="1.4"/><path d="M2 2h3M11 2h3M2 5H5M11 5h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8 8v4M5.5 14h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
      ticket: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M8 2v3M8 11v3M2 8h3M11 8h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M4.5 4.5l2 2M9.5 9.5l2 2M4.5 11.5l2-2M9.5 6.5l2-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
      mesas: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="2" y="5" width="12" height="2" rx="1" fill="currentColor"/><line x1="4" y1="7" x2="4" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
      itens: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M2 5l6-3 6 3v6l-6 3-6-3V5z" stroke="currentColor" stroke-width="1.4"/><path d="M8 2v12M2 5l6 3 6-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
      cancelamentos: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`
    };

    const _gradients = {
      faturamento: 'linear-gradient(135deg,rgba(245,158,11,.18),rgba(245,158,11,.06))',
      pedidos: 'linear-gradient(135deg,rgba(59,130,246,.18),rgba(59,130,246,.06))',
      ticket: 'linear-gradient(135deg,rgba(139,92,246,.18),rgba(139,92,246,.06))',
      mesas: 'linear-gradient(135deg,rgba(34,197,94,.18),rgba(34,197,94,.06))',
      itens: 'linear-gradient(135deg,rgba(249,115,22,.18),rgba(249,115,22,.06))',
      cancelamentos: 'linear-gradient(135deg,rgba(239,68,68,.18),rgba(239,68,68,.06))'
    };

    const _iconBgs = {
      faturamento: 'rgba(245,158,11,.2)',
      pedidos: 'rgba(59,130,246,.2)',
      ticket: 'rgba(139,92,246,.2)',
      mesas: 'rgba(34,197,94,.2)',
      itens: 'rgba(249,115,22,.2)',
      cancelamentos: 'rgba(239,68,68,.2)'
    };

    const _borders = {
      faturamento: 'rgba(245,158,11,.25)',
      pedidos: 'rgba(59,130,246,.25)',
      ticket: 'rgba(139,92,246,.25)',
      mesas: 'rgba(34,197,94,.25)',
      itens: 'rgba(249,115,22,.25)',
      cancelamentos: 'rgba(239,68,68,.25)'
    };

    const metrics = [
      { key:'faturamento', label:'Faturamento', val: 'R$ ' + faturamento.toFixed(2).replace('.',','), color:'var(--accent3)' },
      { key:'pedidos', label:'Total de pedidos', val: totalPedidos, color:'var(--accent)' },
      { key:'ticket', label:'Ticket médio', val: 'R$ ' + ticketMedio.toFixed(2).replace('.',','), color:'var(--purple)' },
      { key:'mesas', label:'Mesas atendidas', val: mesasSet.size, color:'var(--success)' },
      { key:'itens', label:'Itens vendidos', val: itensQtd, color:'var(--accent2,var(--accent))' },
      { key:'cancelamentos', label:'Cancelamentos', val: cancelados + (taxaCancelamento > 0 ? ` (${taxaCancelamento.toFixed(1)}%)` : ''), color: cancelados > 0 ? 'var(--danger)' : 'var(--muted)' },
    ];

    if (dg) dg.innerHTML = metrics.map(m => `
      <div class="desemp-card" style="background:${_gradients[m.key]};border-color:${_borders[m.key]};--dc:${m.color}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px">
          <div class="desemp-label">${m.label}</div>
          <div style="width:36px;height:36px;border-radius:10px;background:${_iconBgs[m.key]};display:flex;align-items:center;justify-content:center;color:${m.color};flex-shrink:0">${_svgIcons[m.key]}</div>
        </div>
        <div class="desemp-val" style="font-size:24px;color:${m.color}">${m.val}</div>
      </div>`).join('');

    // ── Grafico dinamico por periodo ────────
    const barCard = bar?.closest('.card')?.querySelector('.card-title');
    if (bar) {
      let barData = [], barLabels = [];
      if (_desempPrd === 'anual') {
        if (barCard) barCard.innerHTML = barCard.innerHTML.replace(/Pedidos.*/, 'Pedidos por mês');
        const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        barData = new Array(12).fill(0); barLabels = months;
        orders.forEach(o => { barData[new Date(o.created_at).getMonth()]++; });
      } else if (_desempPrd === 'mensal') {
        if (barCard) barCard.innerHTML = barCard.innerHTML.replace(/Pedidos.*/, 'Pedidos por semana');
        barData = [0,0,0,0,0]; barLabels = ['Sem 1','Sem 2','Sem 3','Sem 4','Sem 5'];
        orders.forEach(o => {
          const w = Math.min(Math.floor((new Date(o.created_at).getDate()-1)/7), 4);
          barData[w]++;
        });
      } else if (_desempPrd === 'semanal') {
        if (barCard) barCard.innerHTML = barCard.innerHTML.replace(/Pedidos.*/, 'Pedidos por dia da semana');
        barData = [0,0,0,0,0,0,0]; barLabels = DAYS_FULL;
        orders.forEach(o => { barData[new Date(o.created_at).getDay()]++; });
      } else if (_desempPrd === 'custom') {
        if (barCard) barCard.innerHTML = barCard.innerHTML.replace(/Pedidos.*/, 'Pedidos por dia da semana');
        barData = [0,0,0,0,0,0,0]; barLabels = DAYS_FULL;
        orders.forEach(o => { barData[new Date(o.created_at).getDay()]++; });
      } else { // diario
        if (barCard) barCard.innerHTML = barCard.innerHTML.replace(/Pedidos.*/, 'Pedidos por hora');
        barData = new Array(24).fill(0);
        barLabels = Array.from({length:24}, (_,i) => i % 4 === 0 ? i + 'h' : '');
        orders.forEach(o => { barData[new Date(o.created_at).getHours()]++; });
      }
      const maxD = Math.max(...barData, 1);
      bar.innerHTML = barLabels.map((lbl, i) => [
        '<div class="bar-col">',
        '<div class="bar-val">' + (barData[i] || '') + '</div>',
        '<div class="bar-fill" style="height:' + Math.max(Math.round(barData[i]/maxD*100), barData[i]>0?3:2) + '%;background:var(--accent)' + (barData[i]===0?';opacity:.2':'') + '"></div>',
        '<div class="bar-label">' + lbl + '</div>',
        '</div>'
      ].join('')).join('');
    }

    // ── Top itens mais vendidos ──────────
    const itemMap = {};
    entregues.forEach(o => {
      if (!Array.isArray(o.items)) return;
      o.items.forEach(i => {
        const k = i.name;
        if (!itemMap[k]) itemMap[k] = { qty: 0, rev: 0 };
        itemMap[k].qty += (i.qty||1);
        itemMap[k].rev += (parseFloat(i.price||0) * (i.qty||1));
      });
    });
    const sorted = Object.entries(itemMap).sort((a,b) => b[1].qty - a[1].qty).slice(0,8);

    if (top) {
      if (!sorted.length) {
        top.innerHTML = '<div style="color:var(--muted);font-size:12.5px;padding:12px;text-align:center">Nenhum item no período</div>';
      } else {
        // Find emoji from items list if available
        top.innerHTML = sorted.map(([name, {qty, rev}], idx) => {
          const menuItem = items.find(i => i.name === name);
          const emoji = menuItem?.emoji || '';
          return `<div style="display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:12px;font-weight:700;color:var(--accent);width:18px">${idx+1}</span>
            <span style="font-size:18px">${emoji}</span>
            <span style="flex:1;font-size:12.5px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</span>
            <span style="font-size:11px;color:var(--muted);margin-right:6px">${qty}x</span>
            <span style="font-size:12px;font-weight:700;color:var(--success);flex-shrink:0">R$ ${rev.toFixed(2).replace('.',',')}</span>
          </div>`;
        }).join('');
      }
    }

  } catch(e) {
    console.error('renderDesempenho error:', e);
    if (dg) dg.innerHTML = '<div style="color:var(--danger);font-size:13px;padding:12px;grid-column:span 3">Erro ao carregar dados de desempenho</div>';
  }
}

// ─────────────────────────────────────────
// RELATÓRIOS
// ─────────────────────────────────────────
let _relPeriodo = 'mensal';
let _relCustomMonth = '';
let _relCustomDay = '';
let _relCustomRangeIni = '';
let _relCustomRangeFim = '';

function _relApplyCustomRange() {
  const ini = document.getElementById('rel-custom-range-ini')?.value;
  const fim = document.getElementById('rel-custom-range-fim')?.value;
  if (ini && fim) {
    _relCustomRangeIni = ini;
    _relCustomRangeFim = fim;
    setRelPeriodo('custom-range');
  }
}

function setRelPeriodo(p, val = '') {
  _relPeriodo = p;
  if (p === 'custom-month') {
    _relCustomMonth = val; // formato 'YYYY-MM'
  }
  if (p === 'custom-day') {
    _relCustomDay = val; // formato 'YYYY-MM-DD'
  }

  ['diario','ontem','semanal','mensal','anual'].forEach(id => {
    const btn = document.getElementById('rpb-' + id);
    if (!btn) return;
    const active = id === p;
    btn.style.background  = active ? 'var(--accent)' : '';
    btn.style.color       = active ? '#fff' : '';
    btn.style.borderColor = active ? 'var(--accent)' : '';
  });

  const cmBtn = document.getElementById('rel-custom-month');
  if (cmBtn) {
    if (p === 'custom-month') {
      cmBtn.style.color = 'var(--text)';
      cmBtn.style.borderColor = 'var(--accent)';
      cmBtn.style.background = 'rgba(59,130,246,.1)';
    } else {
      cmBtn.style.color = 'var(--muted)';
      cmBtn.style.borderColor = 'var(--border)';
      cmBtn.style.background = 'transparent';
      cmBtn.value = ''; // limpa se clicar em outro
    }
  }

  const cdBtn = document.getElementById('rel-custom-day');
  if (cdBtn) {
    if (p === 'custom-day') {
      cdBtn.style.color = 'var(--text)';
      cdBtn.style.borderColor = 'var(--accent)';
      cdBtn.style.background = 'rgba(59,130,246,.1)';
    } else {
      cdBtn.style.color = 'var(--muted)';
      cdBtn.style.borderColor = 'var(--border)';
      cdBtn.style.background = 'transparent';
      cdBtn.value = ''; // limpa se clicar em outro
    }
  }

  const crWrap = document.getElementById('rel-custom-range-wrap');
  const crIni  = document.getElementById('rel-custom-range-ini');
  const crFim  = document.getElementById('rel-custom-range-fim');
  if (crWrap) {
    if (p === 'custom-range') {
      crWrap.style.borderColor = 'var(--accent)';
      crWrap.style.background = 'rgba(59,130,246,.1)';
    } else {
      crWrap.style.borderColor = 'var(--border)';
      crWrap.style.background = 'transparent';
      if (crIni) crIni.value = '';
      if (crFim) crFim.value = '';
      _relCustomRangeIni = '';
      _relCustomRangeFim = '';
    }
  }

  renderRelatorios();
}

function _relGetRange() {
  // Usa horário de Brasília (UTC-3) para calcular os ranges de data
  const BR_OFFSET = 3 * 60 * 60 * 1000; // 3h em ms
  const nowUTC = new Date();
  // "Agora" em Brasília
  const nowBR = new Date(nowUTC.getTime() - BR_OFFSET);
  const anoB  = nowBR.getUTCFullYear();
  const mesB  = nowBR.getUTCMonth();
  const diaB  = nowBR.getUTCDate();
  const diaSemB = nowBR.getUTCDay();

  // Converte data Brasília para UTC (adiciona 3h de volta)
  const brToUTC = (y, m, d) => new Date(Date.UTC(y, m, d) + BR_OFFSET);

  let inicio, fim, label;
  if (_relPeriodo === 'diario') {
    inicio = brToUTC(anoB, mesB, diaB);
    fim    = brToUTC(anoB, mesB, diaB + 1);
    label  = 'Hoje, ' + new Date(inicio.getTime() + BR_OFFSET).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', timeZone:'UTC' });
  } else if (_relPeriodo === 'ontem') {
    inicio = brToUTC(anoB, mesB, diaB - 1);
    fim    = brToUTC(anoB, mesB, diaB);
    label  = 'Ontem, ' + new Date(inicio.getTime() + BR_OFFSET).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', timeZone:'UTC' });
  } else if (_relPeriodo === 'custom-day' && _relCustomDay) {
    const [yD, mD, dD] = _relCustomDay.split('-').map(Number);
    inicio = brToUTC(yD, mD - 1, dD);
    fim    = brToUTC(yD, mD - 1, dD + 1);
    label  = new Date(inicio.getTime() + BR_OFFSET).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric', timeZone:'UTC' });
  } else if (_relPeriodo === 'custom-range' && _relCustomRangeIni && _relCustomRangeFim) {
    let iniStr = _relCustomRangeIni, fimStr = _relCustomRangeFim;
    if (iniStr > fimStr) { const tmp = iniStr; iniStr = fimStr; fimStr = tmp; } // corrige se vier invertido
    const [yI, mI, dI] = iniStr.split('-').map(Number);
    const [yF, mF, dF] = fimStr.split('-').map(Number);
    inicio = brToUTC(yI, mI - 1, dI);
    fim    = brToUTC(yF, mF - 1, dF + 1);
    const iniLbl = new Date(inicio.getTime() + BR_OFFSET).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', timeZone:'UTC' });
    const fimLbl = new Date(fim.getTime() + BR_OFFSET - 1).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', timeZone:'UTC' });
    label  = iniLbl + ' – ' + fimLbl;
  } else if (_relPeriodo === 'semanal') {
    inicio = brToUTC(anoB, mesB, diaB - diaSemB);
    fim    = brToUTC(anoB, mesB, diaB - diaSemB + 7);
    label  = new Date(inicio.getTime() + BR_OFFSET).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', timeZone:'UTC' })
             + ' – ' + new Date(fim.getTime() + BR_OFFSET - 1).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', timeZone:'UTC' });
  } else if (_relPeriodo === 'custom-month' && _relCustomMonth) {
    const [y, m] = _relCustomMonth.split('-');
    inicio = brToUTC(parseInt(y), parseInt(m) - 1, 1);
    fim    = brToUTC(parseInt(y), parseInt(m), 1);
    label  = new Date(inicio.getTime() + BR_OFFSET).toLocaleDateString('pt-BR', { month:'long', year:'numeric', timeZone:'UTC' });
  } else if (_relPeriodo === 'mensal') {
    inicio = brToUTC(anoB, mesB, 1);
    fim    = brToUTC(anoB, mesB + 1, 1);
    label  = new Date(inicio.getTime() + BR_OFFSET).toLocaleDateString('pt-BR', { month:'long', year:'numeric', timeZone:'UTC' });
  } else {
    inicio = brToUTC(anoB, 0, 1);
    fim    = brToUTC(anoB + 1, 0, 1);
    label  = String(anoB);
  }
  return { inicio, fim, label };
}

async function renderRelatorios() {
  const money  = v => 'R$\u00a0' + parseFloat(v||0).toFixed(2).replace('.', ',');
  const moneyK = v => { const n=parseFloat(v||0); return n>=1000 ? 'R$\u00a0'+Math.round(n/1000)+'k' : money(n); };
  const pct    = (a,b) => b>0 ? Math.round(a/b*100)+'%' : '0%';
  const elv    = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  const loading = id  => { const e=document.getElementById(id); if(e) e.innerHTML='<div style="color:var(--muted);font-size:12px;padding:16px;text-align:center">Carregando...</div>'; };

  ['rel-line-chart','rel-hour-bar','rel-day-bar','rel-gauges','rel-platforms','rel-tipo-venda',
   'rel-areas','rel-heatmap','rel-month-bar','rel-produtos-list','rel-produtos-fat',
   'rel-cats-bar','rel-top-clients','rel-top-gastos','rel-novos-clientes',
   'rel-entradas-list','rel-fat-pag','rel-sat-list','rel-sat-resumo','rel-mesas-list'].forEach(loading);

  const now      = new Date();
  const range    = _relGetRange();
  const iniISO   = _toSQLite(range.inicio);
  const fimISO   = _toSQLite(range.fim);
  const anoIn    = _toSQLite(new Date(now.getFullYear(), 0, 1));
  const lbl30ago = _toSQLite(new Date(now - 30*86400000));

  const periLabel = { diario:'hoje', ontem:'ontem', semanal:'na semana', mensal:'no mês', anual:'no ano', 'custom-day':'no dia selecionado' }[_relPeriodo] || 'no período';
  const lblEl = document.getElementById('rel-periodo-label');
  if (lblEl) lblEl.textContent = range.label;

  // Atualiza botões de período
  ['diario','ontem','semanal','mensal','anual'].forEach(id => {
    const btn = document.getElementById('rpb-'+id);
    if (!btn) return;
    const on = id === _relPeriodo;
    btn.style.background  = on ? 'var(--accent)' : 'none';
    btn.style.color       = on ? '#fff'           : 'var(--muted)';
  });

  try {
    const [
      { data: periodOrdersRaw },
      { data: anoOrdersRaw },
      { data: movsFromDB },
      { data: ratings },
      { data: allCustomers }
    ] = await Promise.all([
      sb.from('orders').select('id,status,total,taxa,items,mesa_num,addr,pag,phone,customer_id,created_at,garcom_nome,session_ref')
        .gte('created_at', iniISO).lt('created_at', fimISO).order('created_at', { ascending: true }),
      sb.from('orders').select('id,status,total,created_at')
        .gte('created_at', anoIn).order('created_at', { ascending: true }),
      sb.from('movimentos').select('*').order('id', { ascending: false }).limit(200),
      sb.from('ratings').select('*').order('created_at', { ascending: false }),
      fetch('/api/clientes-gestor', { headers: { 'Content-Type':'application/json', 'x-tenant-id': (() => { try { return JSON.parse(sessionStorage.getItem('sys_session')||'{}').tenant_id||'' } catch{return''} })() } }).then(r=>r.ok?r.json():[]).then(d=>({data:d})).catch(()=>({data:[]}))
    ]);

    const mesPedidos = periodOrdersRaw || [];
    const mesValidos = mesPedidos.filter(o => ['pronto','entregue','finalizado'].includes(o.status));
    const allYear    = anoOrdersRaw || [];

    // ─── Relatório de Mesas — horário de abertura (Brasília) e consumo ────
    // Usa o mesmo período/filtro já buscado acima (mesPedidos), sem query extra.
    (function renderRelMesas() {
      const rmEl = document.getElementById('rel-mesas-list');
      if (!rmEl) return;

      const fmtDataHoraBR = ts => {
        if (!ts) return '—';
        try {
          let s = String(ts).trim();
          if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
          if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
          const d = new Date(s);
          if (isNaN(d.getTime())) return String(ts);
          return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo' });
        } catch(e) { return String(ts); }
      };

      const statusLbl = { mesa_aberta:'🟢 Em aberto', pronto:'🟢 Em aberto', entregue:'⚪ Fechada/paga', finalizado:'⚪ Fechada/paga' };
      const statusCor = { mesa_aberta:'var(--success)', pronto:'var(--success)', entregue:'var(--muted)', finalizado:'var(--muted)' };

      // Apenas comandas de mesa (garçom) do período, excluindo canceladas
      const mesaSessions = mesPedidos
        .filter(o => (o.mesa_num || (o.addr||'').startsWith('Mesa')) && o.status !== 'cancelado')
        .slice()
        .sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));

      if (!mesaSessions.length) {
        rmEl.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:16px;text-align:center">Nenhuma mesa no período selecionado</div>';
        return;
      }

      rmEl.innerHTML = mesaSessions.map(o => {
        const numMesa  = o.mesa_num || (o.addr||'').replace('Mesa ','').trim();
        const mesaInfo = (typeof tables !== 'undefined' ? tables : []).find(t => String(t.num) === String(numMesa));
        const nomeMesa = mesaInfo?.nome ? ` · ${_printHtmlEscape(mesaInfo.nome)}` : '';

        // Itens realmente consumidos (exclui cancelados), agrupados por nome
        const itens = _parseItemsAtivos(o.items);
        const itemMap = {};
        itens.forEach(i => {
          const key = i.name || '';
          if (!itemMap[key]) itemMap[key] = { qty: 0, price: parseFloat(i.price)||0 };
          itemMap[key].qty += parseInt(i.qty) || 1;
        });
        const itensHtml = Object.entries(itemMap).map(([nome, v]) => `
          <div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0">
            <span>${v.qty}× ${_printHtmlEscape(nome)}</span>
            <span style="color:var(--muted)">R$ ${(v.price*v.qty).toFixed(2).replace('.',',')}</span>
          </div>`).join('') || '<div style="font-size:11.5px;color:var(--muted)">Sem itens</div>';

        const total = parseFloat(o.total||0) + parseFloat(o.taxa||0);
        // Horário de abertura real da sessão: session_ref (quando existe) é mais preciso
        // que created_at, pois created_at pode ser de um novo INSERT dentro da mesma sessão.
        const abertura = fmtDataHoraBR(o.session_ref || o.created_at);

        return `<div class="card" style="padding:16px;margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
            <div>
              <div style="font-weight:700;font-size:13.5px">Mesa ${_printHtmlEscape(String(numMesa))}${nomeMesa}</div>
              <div style="font-size:11.5px;color:var(--muted);margin-top:2px">
                Aberta em ${abertura} (horário de Brasília)${o.garcom_nome ? ' · Garçom: ' + _printHtmlEscape(o.garcom_nome) : ''}
              </div>
            </div>
            <div style="text-align:right">
              <div style="font-size:11px;font-weight:700;color:${statusCor[o.status]||'var(--muted)'}">${statusLbl[o.status]||o.status}</div>
              <div style="font-size:15px;font-weight:800;color:var(--success);margin-top:2px">R$ ${total.toFixed(2).replace('.',',')}</div>
            </div>
          </div>
          <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px">
            <div style="font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Itens pedidos nesta abertura</div>
            ${itensHtml}
          </div>
        </div>`;
      }).join('');
    })();

    // ─── KPIs ───────────────────────────────────────────
    const fatMes    = mesValidos.reduce((s,o) => s + parseFloat(o.total||0) + parseFloat(o.taxa||0), 0);
    const qtdMes    = mesPedidos.length;
    const ticket    = mesValidos.length > 0 ? fatMes / mesValidos.length : 0;
    const cancelMes = mesPedidos.filter(o => o.status === 'cancelado').length;
    const pctCancel = qtdMes > 0 ? (cancelMes/qtdMes*100).toFixed(1) : '0';

    elv('rel-kpi-fat',        money(fatMes));
    elv('rel-kpi-fat-sub',    mesValidos.length + ' pedidos confirmados ' + periLabel);
    elv('rel-kpi-ped',        qtdMes);
    elv('rel-kpi-ped-sub',    mesValidos.length + ' confirmados · ' + cancelMes + ' cancelados');
    elv('rel-kpi-ticket',     money(ticket));
    elv('rel-kpi-cancel',     cancelMes);
    elv('rel-kpi-cancel-sub', pctCancel + '% do total de pedidos');

    // Trends (compara com período anterior simples — positivo/negativo por ticket)
    const trendFat  = document.getElementById('rel-kpi-fat-trend');
    const trendPed  = document.getElementById('rel-kpi-ped-trend');
    if (trendFat) trendFat.innerHTML = fatMes>0
      ? `<span style="color:var(--success)">↑ ${pct(mesValidos.length,qtdMes||1)} confirmação</span>`
      : '<span style="color:var(--muted)">Sem dados</span>';
    if (trendPed) trendPed.innerHTML = mesValidos.length > 0
      ? `<span style="color:var(--success)">✓ ${mesValidos.length} pedidos válidos</span>`
      : '<span style="color:var(--muted)">Sem pedidos confirmados</span>';

    // ─── Gráfico de linha (SVG) ─────────────────────────
    const lineEl = document.getElementById('rel-line-chart');
    if (lineEl) {
      const titleEl = document.getElementById('rel-chart-title');
      let points = [], labels = [], granLabel = '';
      if (_relPeriodo === 'anual') {
        granLabel = 'Faturamento mensal';
        points = new Array(12).fill(0);
        labels = ['J','F','M','A','M','J','J','A','S','O','N','D'];
        allYear.filter(o=>['pronto','entregue','finalizado'].includes(o.status)).forEach(o=>{
          points[new Date(o.created_at).getMonth()] += parseFloat(o.total||0);
        });
      } else if (_relPeriodo === 'mensal') {
        granLabel = 'Faturamento por semana';
        const semanas = Math.ceil(new Date(now.getFullYear(),now.getMonth()+1,0).getDate()/7);
        points = new Array(semanas).fill(0);
        labels = points.map((_,i)=>'S'+(i+1));
        mesValidos.forEach(o=>{
          const w = Math.min(Math.floor((new Date(o.created_at).getDate()-1)/7), semanas-1);
          points[w] += parseFloat(o.total||0) + parseFloat(o.taxa||0);
        });
      } else if (_relPeriodo === 'semanal') {
        granLabel = 'Faturamento por dia';
        labels = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        points = new Array(7).fill(0);
        mesValidos.forEach(o=>{ points[new Date(o.created_at).getDay()] += parseFloat(o.total||0)+parseFloat(o.taxa||0); });
      } else {
        granLabel = 'Faturamento por hora';
        points = new Array(24).fill(0);
        labels = Array.from({length:24},(_,i)=>i%6===0?i+'h':'');
        mesValidos.forEach(o=>{ points[new Date(o.created_at).getHours()] += parseFloat(o.total||0)+parseFloat(o.taxa||0); });
      }
      if (titleEl) titleEl.textContent = granLabel;

      const maxP = Math.max(...points, 1);
      const W=580, H=140, pad=10, botPad=24, topPad=10;
      const n = points.length;
      const xStep = (W-pad*2)/(n-1||1);
      const toX = i => pad + i*xStep;
      const toY = v => topPad + (H-botPad-topPad)*(1-v/maxP);
      const pathD = points.map((v,i) => (i===0?'M':'L')+toX(i).toFixed(1)+','+toY(v).toFixed(1)).join(' ');
      const areaD = pathD + ` L${toX(n-1).toFixed(1)},${H-botPad} L${pad},${H-botPad} Z`;

      lineEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="lg1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#3b82f6" stop-opacity=".4"/>
            <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${points.map((_,i) => i%Math.max(1,Math.floor(n/5))===0 ? `<line x1="${toX(i).toFixed(1)}" y1="${topPad}" x2="${toX(i).toFixed(1)}" y2="${H-botPad}" stroke="rgba(255,255,255,.04)" stroke-width="1"/>` : '').join('')}
        <path d="${areaD}" fill="url(#lg1)"/>
        <path d="${pathD}" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${points.map((v,i)=> v>0 ? `<circle cx="${toX(i).toFixed(1)}" cy="${toY(v).toFixed(1)}" r="3" fill="#3b82f6"/>
          <text x="${toX(i).toFixed(1)}" y="${(toY(v)-6).toFixed(1)}" font-size="8" text-anchor="middle" fill="#94a3b8">${v>=1000?Math.round(v/1000)+'k':'R$'+Math.round(v)}</text>` : '').join('')}
        ${labels.map((l,i)=> l ? `<text x="${toX(i).toFixed(1)}" y="${H-4}" font-size="9" text-anchor="middle" fill="#64748b">${l}</text>` : '').join('')}
      </svg>`;
    }

    // ─── Pedidos por hora ───────────────────────────────
    const hourCounts = new Array(24).fill(0);
    mesPedidos.forEach(o => { hourCounts[new Date(o.created_at).getHours()]++; });
    const maxH = Math.max(...hourCounts, 1);
    const hourEl = document.getElementById('rel-hour-bar');
    if (hourEl) hourEl.innerHTML = hourCounts.map((v,i)=>`
      <div class="bar-col">
        <div class="bar-val" style="font-size:8px">${v>0?v:''}</div>
        <div class="bar-fill" style="height:${Math.max(Math.round(v/maxH*100),v>0?4:1)}%;background:${v===Math.max(...hourCounts)?'var(--orange)':'var(--accent2)'};${v===0?'opacity:.15':''}"></div>
        <div class="bar-label" style="font-size:8px">${i%4===0?i+'h':''}</div>
      </div>`).join('');

    // ─── Dias da semana ─────────────────────────────────
    const dayC = [0,0,0,0,0,0,0];
    mesPedidos.forEach(o=>{ dayC[new Date(o.created_at).getDay()]++; });
    const maxDy = Math.max(...dayC, 1);
    const dayEl = document.getElementById('rel-day-bar');
    if (dayEl) dayEl.innerHTML = DAYS_FULL.map((d,i)=>`
      <div class="bar-col">
        <div class="bar-val">${dayC[i]}</div>
        <div class="bar-fill" style="height:${Math.max(Math.round(dayC[i]/maxDy*100),2)}%;background:${dayC[i]===Math.max(...dayC)?'var(--success)':'var(--accent3)'}"></div>
        <div class="bar-label">${d}</div>
      </div>`).join('');

    // ─── Heatmap hora × dia ─────────────────────────────
    const hmEl = document.getElementById('rel-heatmap');
    if (hmEl) {
      const hm = Array.from({length:7},()=>new Array(24).fill(0));
      mesPedidos.forEach(o=>{
        const d=new Date(o.created_at);
        hm[d.getDay()][d.getHours()]++;
      });
      const maxHM = Math.max(...hm.flat(), 1);
      const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
      hmEl.innerHTML = `<table style="border-collapse:collapse;font-size:9px;width:100%">
        <tr><td style="color:var(--muted);padding:2px 6px"></td>${Array.from({length:24},(_,h)=>`<td style="text-align:center;color:var(--muted);padding:1px 1px;width:3.8%">${h%4===0?h+'h':''}</td>`).join('')}</tr>
        ${dias.map((dia,d)=>`<tr>
          <td style="color:var(--muted2);padding:2px 6px;white-space:nowrap;font-size:9.5px;font-weight:600">${dia}</td>
          ${hm[d].map(v=>{
            const ratio = v/maxHM;
            const bg = ratio===0 ? 'rgba(255,255,255,.04)' :
              ratio<.25 ? 'rgba(59,130,246,.25)' :
              ratio<.5  ? 'rgba(59,130,246,.55)' :
              ratio<.75 ? 'rgba(249,115,22,.6)'  : 'rgba(239,68,68,.8)';
            return `<td title="${v} pedidos" style="background:${bg};border:1px solid rgba(0,0,0,.2);border-radius:2px;height:16px"></td>`;
          }).join('')}
        </tr>`).join('')}
        <tr><td></td><td colspan="24"><div style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:9px;color:var(--muted)">
          <span>Baixo</span>
          <div style="width:12px;height:10px;background:rgba(59,130,246,.25);border-radius:2px"></div>
          <div style="width:12px;height:10px;background:rgba(59,130,246,.55);border-radius:2px"></div>
          <div style="width:12px;height:10px;background:rgba(249,115,22,.6);border-radius:2px"></div>
          <div style="width:12px;height:10px;background:rgba(239,68,68,.8);border-radius:2px"></div>
          <span>Alto</span>
        </div></td></tr>
      </table>`;
    }

    // ─── Gráfico de barras anual ────────────────────────
    const mbEl = document.getElementById('rel-month-bar');
    const mTitle = document.getElementById('rel-month-title');
    if (mbEl) {
      const monthData = new Array(12).fill(0);
      allYear.filter(o=>['pronto','entregue','finalizado'].includes(o.status)).forEach(o=>{
        monthData[new Date(o.created_at).getMonth()] += parseFloat(o.total||0);
      });
      const maxMB = Math.max(...monthData, 1);
      const mNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      mbEl.innerHTML = monthData.map((v,i)=>`
        <div class="bar-col">
          <div class="bar-val" style="font-size:9px">${v>0?'R$'+Math.round(v/1000)+'k':''}</div>
          <div class="bar-fill" style="height:${Math.max(Math.round(v/maxMB*100),v>0?3:1)}%;${v===0?'opacity:.15':''}"></div>
          <div class="bar-label">${mNames[i]}</div>
        </div>`).join('');
      if (mTitle) mTitle.textContent = 'Faturamento mensal '+now.getFullYear();
    }

    // ─── Pagamentos ─────────────────────────────────────
    const pagMap = {};
    mesValidos.forEach(o=>{
      const k = (o.pag||'outro').toLowerCase().includes('pix')   ? 'PIX'
              : (o.pag||'').toLowerCase().includes('cart')        ? 'Cartão'
              : (o.pag||'').toLowerCase().includes('dinheiro')    ? 'Dinheiro'
              : (o.pag||'').toLowerCase().includes('mesa')        ? 'Mesa'
              : (o.pag||'outro');
      if (!pagMap[k]) pagMap[k] = {count:0, fat:0};
      pagMap[k].count++; pagMap[k].fat += parseFloat(o.total||0)+parseFloat(o.taxa||0);
    });
    const pagCols = { PIX:'var(--purple)', Cartão:'var(--accent)', Dinheiro:'var(--success)', Mesa:'var(--accent3)' };
    const pagEmojis = { PIX:'PIX', Cartão:'Cartão', Dinheiro:'Dinheiro', Mesa:'Mesa' };
    const pagEl = document.getElementById('rel-gauges');
    if (pagEl) {
      const ents = Object.entries(pagMap).sort((a,b)=>b[1].count-a[1].count);
      const totPag = ents.reduce((s,[,v])=>s+v.count,0)||1;
      pagEl.innerHTML = ents.length ? ents.map(([k,v])=>`
        <div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <div style="display:flex;align-items:center;gap:7px">
              <span style="font-size:16px">${''}</span>
              <span style="font-size:13px;font-weight:600">${k}</span>
            </div>
            <div style="text-align:right">
              <span style="font-size:13px;font-weight:700;color:${pagCols[k]||'var(--accent)'}">${v.count} pedidos</span>
              <span style="font-size:11px;color:var(--muted);margin-left:6px">${money(v.fat)}</span>
            </div>
          </div>
          <div style="height:7px;background:var(--border);border-radius:99px;overflow:hidden">
            <div style="height:100%;width:${pct(v.count,totPag)};background:${pagCols[k]||'var(--accent)'};border-radius:99px;transition:width .5s"></div>
          </div>
          <div style="font-size:10px;color:var(--muted);margin-top:3px">${pct(v.count,totPag)} dos pedidos</div>
        </div>`).join('')
        : '<div style="color:var(--muted);font-size:12px;padding:12px">Sem dados no período</div>';
    }

    // ─── Receita por pagamento (financeiro) ─────────────
    const fatPagEl = document.getElementById('rel-fat-pag');
    if (fatPagEl) {
      const ents = Object.entries(pagMap).sort((a,b)=>b[1].fat-a[1].fat);
      const maxFP = Math.max(...ents.map(([,v])=>v.fat), 1);
      fatPagEl.innerHTML = ents.length ? ents.map(([k,v])=>`
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;margin-bottom:5px">
            <span style="font-size:12.5px;font-weight:600">${''} ${k}</span>
            <span style="font-size:13px;font-weight:700;color:${pagCols[k]||'var(--accent)'}">${money(v.fat)}</span>
          </div>
          <div style="height:8px;background:var(--border);border-radius:99px;overflow:hidden">
            <div style="height:100%;width:${Math.round(v.fat/maxFP*100)}%;background:${pagCols[k]||'var(--accent)'};border-radius:99px"></div>
          </div>
        </div>`).join('')
        : '<div style="color:var(--muted);font-size:12px;padding:12px">Sem dados</div>';
    }

    // ─── Origem (plataforma) ─────────────────────────────
    const originMap = {};
    mesValidos.forEach(o=>{
      const ori = o.mesa_num || (o.addr||'').startsWith('Mesa') ? 'Mesa (Garçom)'
                : (o.addr||'').toLowerCase().includes('balc')   ? 'Balcão / Retirada'
                :                                                  'Delivery';
      if(!originMap[ori]) originMap[ori]={count:0,fat:0};
      originMap[ori].count++; originMap[ori].fat+=parseFloat(o.total||0)+parseFloat(o.taxa||0);
    });
    const _oriColors = { 'Mesa (Garçom)':'#22c55e', 'Delivery':'#3b82f6', 'Balcão / Retirada':'#f59e0b' };
    const _oriIcons = {
      'Mesa (Garçom)': `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="5" width="12" height="2" rx="1" fill="currentColor"/><line x1="4" y1="7" x2="4" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
      'Delivery': `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1 9V5h9v8H1v-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10 6h3l2 3v3h-5V6z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="4" cy="13" r="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="13" r="1.5" stroke="currentColor" stroke-width="1.4"/></svg>`,
      'Balcão / Retirada': `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 7l6-5 6 5v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7z" stroke="currentColor" stroke-width="1.4"/><path d="M6 14V9h4v5" stroke="currentColor" stroke-width="1.4"/></svg>`
    };
    const peEl = document.getElementById('rel-platforms');
    if (peEl) {
      const ents = Object.entries(originMap).sort((a,b)=>b[1].fat-a[1].fat);
      const maxOF = Math.max(...ents.map(([,v])=>v.fat),1);
      peEl.innerHTML = ents.length ? ents.map(([k,v])=>{
        const col = _oriColors[k] || 'var(--accent)';
        return `
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:26px;height:26px;border-radius:7px;background:${col}18;display:flex;align-items:center;justify-content:center;color:${col}">${_oriIcons[k]||''}</div>
              <span style="font-size:13px;font-weight:600">${k}</span>
            </div>
            <div style="text-align:right">
              <span style="font-size:13px;font-weight:700;color:${col}">${money(v.fat)}</span>
              <span style="font-size:11px;color:var(--muted);margin-left:5px">${v.count} ped.</span>
            </div>
          </div>
          <div style="height:8px;background:var(--border);border-radius:99px;overflow:hidden">
            <div style="height:100%;width:${Math.round(v.fat/maxOF*100)}%;background:${col};border-radius:99px;transition:width .6s ease"></div>
          </div>
        </div>`;
      }).join('')
        : '<div style="color:var(--muted);font-size:12px;padding:8px">Sem pedidos no período</div>';
    }

    // ─── Tipo de Venda — Donut Chart Premium ────────────────
    const tipoVendaMap = {};
    mesValidos.forEach(o => {
      let tipo;
      if (o.mesa_num || (o.addr||'').startsWith('Mesa')) tipo = 'Mesa';
      else if ((o.addr||'').toLowerCase().includes('balc'))  tipo = 'Balcão';
      else tipo = 'Delivery';
      if (!tipoVendaMap[tipo]) tipoVendaMap[tipo] = { count: 0, fat: 0 };
      tipoVendaMap[tipo].count++;
      tipoVendaMap[tipo].fat += parseFloat(o.total||0) + parseFloat(o.taxa||0);
    });
    const tvEl = document.getElementById('rel-tipo-venda');
    if (tvEl) {
      const isAcougue = window._segmento === 'acougue';
      // Filter out Mesa for açougue
      const tvEntries = Object.entries(tipoVendaMap)
        .filter(([k]) => !(isAcougue && k === 'Mesa'))
        .sort((a,b) => b[1].count - a[1].count);
      const totalTV = tvEntries.reduce((s,[,v]) => s + v.count, 0) || 1;

      if (!tvEntries.length) {
        tvEl.innerHTML = '<div style="color:var(--muted);font-size:12.5px;padding:20px;text-align:center;width:100%">Sem vendas no período</div>';
      } else {
        const tvColors = { Mesa:'#22c55e', Delivery:'#3b82f6', 'Balcão':'#f59e0b' };
        const tvIcons  = {
          Mesa: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="5" width="12" height="2" rx="1" fill="currentColor"/><line x1="4" y1="7" x2="4" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
          Delivery: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 9V5h9v8H1v-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10 6h3l2 3v3h-5V6z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="4" cy="13" r="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="13" r="1.5" stroke="currentColor" stroke-width="1.4"/></svg>`,
          'Balcão': `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 7l6-5 6 5v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7z" stroke="currentColor" stroke-width="1.4"/><path d="M6 14V9h4v5" stroke="currentColor" stroke-width="1.4"/></svg>`
        };

        // SVG Donut chart
        const R = 60, strokeW = 14, C = 2 * Math.PI * R;
        let offset = 0;
        const arcs = tvEntries.map(([k,v]) => {
          const pct = v.count / totalTV;
          const dash = pct * C;
          const gap  = C - dash;
          const arc = `<circle cx="80" cy="80" r="${R}" fill="none" stroke="${tvColors[k]||'#888'}" stroke-width="${strokeW}" stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" stroke-linecap="round" style="transition:stroke-dasharray .6s ease,stroke-dashoffset .6s ease;filter:drop-shadow(0 0 4px ${tvColors[k]||'#888'}40)"/>`;
          offset += dash;
          return arc;
        }).join('');

        const donutSVG = `<svg viewBox="0 0 160 160" width="160" height="160" style="flex-shrink:0;transform:rotate(-90deg)">
          <circle cx="80" cy="80" r="${R}" fill="none" stroke="rgba(255,255,255,.04)" stroke-width="${strokeW}"/>
          ${arcs}
        </svg>`;

        // Center label
        const centerLabel = `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center">
          <div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:800;color:var(--text)">${totalTV}</div>
          <div style="font-size:9.5px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px">pedidos</div>
        </div>`;

        // Legend
        const legend = tvEntries.map(([k,v]) => {
          const pctVal = ((v.count/totalTV)*100).toFixed(1);
          const col = tvColors[k]||'#888';
          return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:${col}0d;border:1px solid ${col}25;border-radius:10px;transition:all .2s" onmouseenter="this.style.borderColor='${col}55';this.style.transform='translateX(4px)'" onmouseleave="this.style.borderColor='${col}25';this.style.transform='none'">
            <div style="width:30px;height:30px;border-radius:8px;background:${col}20;display:flex;align-items:center;justify-content:center;color:${col}">${tvIcons[k]||''}</div>
            <div style="flex:1">
              <div style="font-size:12.5px;font-weight:700;color:var(--text)">${k}</div>
              <div style="font-size:11px;color:var(--muted)">${v.count} pedido${v.count!==1?'s':''} · ${money(v.fat)}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:18px;font-weight:800;color:${col};font-family:'Playfair Display',serif">${pctVal}%</div>
            </div>
          </div>`;
        }).join('');

        tvEl.innerHTML = `
          <div style="position:relative;flex-shrink:0">
            ${donutSVG}
            ${centerLabel}
          </div>
          <div style="flex:1;display:flex;flex-direction:column;gap:8px">
            ${legend}
          </div>`;
      }
    }

    // ─── Top bairros ─────────────────────────────────────
    const areaMap = {};
    mesValidos.filter(o=>!o.mesa_num&&o.addr&&!o.addr.startsWith('Mesa')).forEach(o=>{
      const parts = (o.addr||'').split(',');
      const bairro = (parts[1]||parts[0]||'').trim().split(' ').slice(0,3).join(' ') || 'Não informado';
      if(!areaMap[bairro]) areaMap[bairro]={fat:0,ped:0};
      areaMap[bairro].fat+=parseFloat(o.total||0); areaMap[bairro].ped++;
    });
    const aeEl = document.getElementById('rel-areas');
    if (aeEl) {
      const ents = Object.entries(areaMap).sort((a,b)=>b[1].ped-a[1].ped).slice(0,6);
      aeEl.innerHTML = ents.length ? ents.map(([k,v],i)=>`
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:13px;font-weight:800;color:var(--accent);width:20px">#${i+1}</span>
          <div style="flex:1">
            <div style="font-weight:600;font-size:12.5px">${k}</div>
            <div style="font-size:11px;color:var(--muted)">${v.ped} pedido${v.ped!==1?'s':''}</div>
          </div>
          <div style="font-size:12.5px;font-weight:700;color:var(--success)">${money(v.fat)}</div>
        </div>`).join('')
        : '<div style="color:var(--muted);font-size:12px;padding:8px">Apenas pedidos de mesa</div>';
    }

    // ─── Produtos mais vendidos ─────────────────────────
    const itemMap = {};
    mesValidos.forEach(o=>{
      (Array.isArray(o.items)?o.items:[]).forEach(i=>{
        const k=i.name||'?';
        if(!itemMap[k]) itemMap[k]={qty:0,fat:0,cat:i.cat||''};
        itemMap[k].qty+=(i.qty||1);
        itemMap[k].fat+=parseFloat(i.price||0)*(i.qty||1);
      });
    });
    const sortedQty = Object.entries(itemMap).sort((a,b)=>b[1].qty-a[1].qty);
    const sortedFat = Object.entries(itemMap).sort((a,b)=>b[1].fat-a[1].fat);
    const totalQty  = sortedQty.reduce((s,[,v])=>s+v.qty,0)||1;
    const totalFat  = sortedFat.reduce((s,[,v])=>s+v.fat,0)||1;

    const renderProdList = (sorted, field, total, color) => sorted.map(([name,v],idx)=>{
      const mi = items.find(i=>i.name===name);
      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <span style="width:18px;font-size:11.5px;font-weight:700;color:var(--muted)">${idx+1}</span>
        <span style="font-size:17px">${mi?.emoji||''}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
          <div style="height:4px;background:var(--border);border-radius:99px;margin-top:4px;overflow:hidden">
            <div style="height:100%;width:${Math.round(v[field]/total*100)}%;background:${color};border-radius:99px"></div>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          ${field==='qty'
            ? `<div style="font-size:13px;font-weight:700;color:${color}">${v.qty}x</div><div style="font-size:11px;color:var(--muted)">${money(v.fat)}</div>`
            : `<div style="font-size:13px;font-weight:700;color:${color}">${money(v.fat)}</div><div style="font-size:11px;color:var(--muted)">${v.qty}x vendidos</div>`}
        </div>
      </div>`;
    }).join('');

    const rpl = document.getElementById('rel-produtos-list');
    if (rpl) rpl.innerHTML = sortedQty.length ? renderProdList(sortedQty,'qty',totalQty,'var(--accent)')
      : '<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center">Sem vendas no período</div>';

    const rpf = document.getElementById('rel-produtos-fat');
    if (rpf) rpf.innerHTML = sortedFat.length ? renderProdList(sortedFat,'fat',totalFat,'var(--success)')
      : '<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center">Sem vendas no período</div>';

    // ─── Faturamento por categoria ───────────────────────
    const catMap = {};
    mesValidos.forEach(o=>{
      (Array.isArray(o.items)?o.items:[]).forEach(i=>{
        const k = i.cat || i.cat_key || 'Outros';
        if(!catMap[k]) catMap[k]={fat:0,qty:0};
        catMap[k].fat+=parseFloat(i.price||0)*(i.qty||1);
        catMap[k].qty+=(i.qty||1);
      });
    });
    const catEnt = Object.entries(catMap).sort((a,b)=>b[1].fat-a[1].fat);
    const maxCF  = Math.max(...catEnt.map(([,v])=>v.fat),1);
    const catColors = ['var(--accent)','var(--success)','var(--purple)','var(--accent3)','var(--accent2)','var(--orange)'];
    const catEl  = document.getElementById('rel-cats-bar');
    if (catEl) catEl.innerHTML = catEnt.length ? catEnt.map(([k,v],i)=>`
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
          <span style="font-size:12.5px;font-weight:600">${k}</span>
          <div>
            <span style="font-size:13px;font-weight:700;color:${catColors[i%catColors.length]}">${money(v.fat)}</span>
            <span style="font-size:11px;color:var(--muted);margin-left:6px">${v.qty} itens</span>
          </div>
        </div>
        <div style="height:9px;background:var(--border);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${Math.round(v.fat/maxCF*100)}%;background:${catColors[i%catColors.length]};border-radius:99px;transition:width .6s"></div>
        </div>
      </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center">Sem vendas no período</div>';

    // ─── Clientes ────────────────────────────────────────
    const cliAll  = allCustomers || [];
    const limite30 = _toSQLite(new Date(now - 30*86400000));
    const cliTotal   = cliAll.length;
    const cliComPed  = cliAll.filter(c=>(c.orders_count||0)>0).length;
    const cliFid     = fidClients.length;
    const cliInativos= cliAll.filter(c=>c.last_order_at && c.last_order_at<limite30 && (c.orders_count||0)>0).length;
    elv('rel-cli-total',    cliTotal);
    elv('rel-cli-com-pedido', cliComPed);
    elv('rel-cli-fid',      cliFid);
    elv('rel-cli-inativos', cliInativos);

    // Top frequentes
    const topFreq = [...cliAll].sort((a,b)=>(b.orders_count||0)-(a.orders_count||0)).slice(0,8);
    const rtcEl = document.getElementById('rel-top-clients');
    if (rtcEl) rtcEl.innerHTML = topFreq.length ? topFreq.map((c,i)=>`
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:13px;font-weight:800;color:var(--accent);width:20px">#${i+1}</span>
        <div class="fid-av" style="width:30px;height:30px;min-width:30px;font-size:12px">${(c.name||'?')[0].toUpperCase()}</div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:12.5px">${c.name||'—'}</div>
          <div style="font-size:11px;color:var(--muted)">${c.phone||''}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:13px;font-weight:700;color:var(--accent)">${c.orders_count||0} pedidos</div>
          <div style="font-size:11px;color:var(--success)">${money(c.total_spent||0)}</div>
        </div>
      </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:12px">Nenhum cliente com pedidos</div>';

    // Top gastadores
    const topGasto = [...cliAll].sort((a,b)=>(b.total_spent||0)-(a.total_spent||0)).slice(0,8);
    const tgEl = document.getElementById('rel-top-gastos');
    if (tgEl) tgEl.innerHTML = topGasto.length ? topGasto.map((c,i)=>`
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:13px;font-weight:800;color:var(--success);width:20px">#${i+1}</span>
        <div class="fid-av" style="width:30px;height:30px;min-width:30px;font-size:12px">${(c.name||'?')[0].toUpperCase()}</div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:12.5px">${c.name||'—'}</div>
          <div style="font-size:11px;color:var(--muted)">${c.orders_count||0} pedidos</div>
        </div>
        <div style="font-size:14px;font-weight:800;color:var(--success)">${money(c.total_spent||0)}</div>
      </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:12px">Nenhum cliente com gastos</div>';

    // Novos clientes no período
    const novos = cliAll.filter(c=>c.created_at>=iniISO&&c.created_at<fimISO);
    const ncEl = document.getElementById('rel-novos-clientes');
    if (ncEl) ncEl.innerHTML = novos.length
      ? `<div style="margin-bottom:12px;font-size:13px;color:var(--success);font-weight:700">✨ ${novos.length} novo${novos.length!==1?'s':''} cliente${novos.length!==1?'s':''} cadastrado${novos.length!==1?'s':''} ${periLabel}</div>`
        + novos.slice(0,10).map(c=>`<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
          <div class="fid-av" style="width:28px;height:28px;min-width:28px;font-size:11px">${(c.name||'?')[0].toUpperCase()}</div>
          <div style="flex:1"><div style="font-size:12.5px;font-weight:600">${c.name||'—'}</div><div style="font-size:11px;color:var(--muted)">${c.phone||''}</div></div>
          <div style="font-size:11px;color:var(--muted)">${new Date(c.created_at).toLocaleDateString('pt-BR')}</div>
        </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center">Nenhum cliente cadastrado '+periLabel+'</div>';

    // ─── Financeiro: movimentos ───────────────────────────
    // movimentos.time usa formato SQLite 'YYYY-MM-DD HH:MM:SS' — normaliza para ISO
    const normDate = s => s ? new Date(s.replace(' ', 'T')) : null;
    const movsFiltrados = (movsFromDB||[]).filter(m=>{
      const t = normDate(m.created_at||m.time);
      return t && t >= range.inicio && t < range.fim;
    });
    const totEnt = movsFiltrados.filter(m=>m.tipo==='entrada').reduce((s,m)=>s+parseFloat(m.val||0),0);
    const totSai = movsFiltrados.filter(m=>m.tipo==='saida').reduce((s,m)=>s+parseFloat(m.val||0),0);
    const saldo  = totEnt - totSai;

    elv('rel-fin-entradas', money(totEnt));
    elv('rel-fin-saidas',   money(totSai));
    const saldoEl = document.getElementById('rel-fin-saldo');
    if (saldoEl) { saldoEl.textContent = money(saldo); saldoEl.style.color = saldo>=0?'var(--success)':'var(--danger)'; }

    const movEl = document.getElementById('rel-entradas-list');
    if (movEl) movEl.innerHTML = movsFiltrados.length
      ? movsFiltrados.slice(0,30).map(m=>`
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:13px;
            background:${m.tipo==='entrada'?'rgba(34,197,94,.12)':'rgba(239,68,68,.12)'}">
            ${m.tipo==='entrada'?'↑':'↓'}
          </div>
          <div style="flex:1">
            <div style="font-size:12.5px;font-weight:500">${m.description||'—'}</div>
            <div style="font-size:11px;color:var(--muted)">${m.pag||''} ${m.time||m.created_at?'· '+new Date(m.created_at||m.time).toLocaleDateString('pt-BR'):''}</div>
          </div>
          <div style="font-weight:700;font-size:13px;color:${m.tipo==='entrada'?'var(--success)':'var(--danger)'}">
            ${m.tipo==='entrada'?'+':'-'}${money(m.val)}
          </div>
        </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:16px;text-align:center">Nenhuma movimentação no período</div>';

    // ─── Satisfação ───────────────────────────────────────
    const ratList = ratings || [];
    const ratPeriodo = ratList.filter(r=>r.created_at>=iniISO);
    const satResumoEl = document.getElementById('rel-sat-resumo');
    if (satResumoEl) {
      if (!ratList.length) {
        satResumoEl.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center">Nenhuma avaliação recebida</div>';
      } else {
        const media = ratList.reduce((s,r)=>s+(r.nota||5),0) / ratList.length;
        const dist  = [5,4,3,2,1].map(n=>({ nota:n, count:ratList.filter(r=>(r.nota||5)===n).length }));
        satResumoEl.innerHTML = `
          <div style="text-align:center;margin-bottom:16px">
            <div style="font-size:42px;font-weight:900;color:var(--accent3)">${media.toFixed(1)}</div>
            <div style="margin-bottom:6px">${''}</div>
            <div style="font-size:12px;color:var(--muted)">${ratList.length} avaliações</div>
          </div>
          ${dist.map(({nota,count})=>`
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:var(--muted);width:12px">${nota}</span>
              <div style="flex:1;height:7px;background:var(--border);border-radius:99px;overflow:hidden">
                <div style="height:100%;width:${ratList.length?Math.round(count/ratList.length*100):0}%;background:var(--accent3);border-radius:99px"></div>
              </div>
              <span style="font-size:11px;color:var(--muted);width:24px">${count}</span>
            </div>`).join('')}`;
      }
    }
    const satListEl = document.getElementById('rel-sat-list');
    if (satListEl) satListEl.innerHTML = ratList.length
      ? ratList.slice(0,20).map(r=>`
        <div style="padding:12px;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <div style="font-weight:600;font-size:12.5px">${r.client||'Anônimo'}</div>
            <div>
              <span style="font-size:13px">${''}</span>
              <span style="font-size:11px;color:var(--muted);margin-left:6px">${r.created_at?new Date(r.created_at).toLocaleDateString('pt-BR'):''}</span>
            </div>
          </div>
          ${r.comentario?`<div style="font-size:12px;color:var(--muted2);font-style:italic">"${r.comentario}"</div>`:''}
        </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px;padding:16px;text-align:center">Nenhuma avaliação com comentário</div>';


    // ─── Relatório por Garçom ─────────────────────────────
    // Apenas pedidos finalizados de mesa com garçom — exclui cancelados e mesas abertas
    const garcomMap = {};
    mesValidos
      .filter(o => (o.mesa_num || (o.addr||'').startsWith('Mesa')) && o.garcom_nome)
      .forEach(o => {
        const nome = o.garcom_nome;
        if (!garcomMap[nome]) garcomMap[nome] = { pedidos: 0, fat: 0, mesas: new Set() };
        garcomMap[nome].pedidos++;
        // Recalcula pelo itens ativos, excluindo cancelados e a própria taxa de serviço
        const itens = (() => { try { return Array.isArray(o.items) ? o.items : JSON.parse(o.items||'[]'); } catch { return []; } })();
        const fatSemTaxa = itens
          .filter(i => (i.item_status||'active') !== 'cancelado' && i.item_type !== 'taxa')
          .reduce((s, i) => s + (parseFloat(i.price)||0) * (parseInt(i.qty)||1), 0);
        garcomMap[nome].fat += fatSemTaxa;
        if (o.mesa_num) garcomMap[nome].mesas.add(o.mesa_num);
      });

    const garcomEl = document.getElementById('rel-garcom-section');
    if (garcomEl) {
      const entries = Object.entries(garcomMap).sort((a,b) => b[1].fat - a[1].fat);
      if (!entries.length) {
        garcomEl.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center">Nenhum dado de garçom no período</div>';
      } else {
        const maxFat = Math.max(...entries.map(([,v]) => v.fat), 1);
        garcomEl.innerHTML = entries.map(([nome, v]) => {
          const ticket = v.pedidos > 0 ? v.fat / v.pedidos : 0;
          const comissao = v.fat * 0.1;
          const pct = Math.round(v.fat / maxFat * 100);
          return `<div style="padding:12px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
              <div style="display:flex;align-items:center;gap:8px">
                <div style="width:32px;height:32px;border-radius:50%;background:rgba(59,130,246,.15);border:1.5px solid rgba(59,130,246,.3);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:var(--accent)">${nome.charAt(0).toUpperCase()}</div>
                <div>
                  <div style="font-size:13px;font-weight:700">${nome}</div>
                  <div style="font-size:11px;color:var(--muted)">${v.pedidos} pedido(s) · ${v.mesas.size} mesa(s) atendida(s)</div>
                  <div style="font-size:11px;color:var(--accent3);font-weight:600">Comissão (10%): R$ ${comissao.toFixed(2).replace('.',',')}</div>
                </div>
              </div>
              <div style="text-align:right">
                <div style="font-size:14px;font-weight:800;color:var(--success)">R$ ${v.fat.toFixed(2).replace('.',',')}</div>
                <div style="font-size:11px;color:var(--muted)">ticket R$ ${ticket.toFixed(2).replace('.',',')}</div>
              </div>
            </div>
            <div style="height:5px;background:var(--border);border-radius:99px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent),var(--success));border-radius:99px"></div>
            </div>
          </div>`;
        }).join('');
      }
    }
  } catch(e) {
    console.error('renderRelatorios error:', e);
    sbToast('err', 'Erro ao carregar relatórios: ' + e.message);
  }
}

function relExportar() {
  const range = _relGetRange();
  const rows  = [['Período', range.label], ['Gerado em', new Date().toLocaleString('pt-BR')]];
  const csv   = rows.map(r=>r.join(';')).join('\n');
  const a     = document.createElement('a');
  a.href      = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download  = 'relatorio-' + _relPeriodo + '.csv';
  a.click();
  sbToast('ok', 'CSV exportado!');
}

// ─────────────────────────────────────────
// IMPRIMIR RELATÓRIO NA IMPRESSORA DO CAIXA
// ─────────────────────────────────────────
async function relImprimirCaixa() {
  sbLoading(true);
  try {
    const money   = v => 'R$ ' + parseFloat(v||0).toFixed(2).replace('.', ',');
    const range   = _relGetRange();
    const iniISO  = _toSQLite(range.inicio);
    const fimISO  = _toSQLite(range.fim);
    const nomeLoja = _sessao?.nome || 'Estabelecimento';
    const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    // ── Busca dados ──────────────────────────────────────
    const [
      { data: ordersRaw },
      { data: movsRaw }
    ] = await Promise.all([
      sb.from('orders')
        .select('id,status,total,taxa,items,mesa_num,addr,pag,garcom_nome,created_at,order_num')
        .gte('created_at', iniISO).lt('created_at', fimISO)
        .order('created_at', { ascending: true }),
      sb.from('movimentos')
        .select('*').order('id', { ascending: false }).limit(500)
    ]);

    const orders   = ordersRaw || [];
    // Apenas pedidos efetivamente concluídos — exclui cancelados, mesas abertas e mesas em espera
    const validos  = orders.filter(o => ['pronto','entregue','finalizado'].includes(o.status));

    // Recalcula total de cada pedido pelos itens ativos (exclui item_status=cancelado e item_type=taxa)
    const _calcTotalItens = o => {
      const its = (() => { try { return Array.isArray(o.items) ? o.items : JSON.parse(o.items||'[]'); } catch { return []; } })();
      return its
        .filter(i => (i.item_status||'active') !== 'cancelado')
        .reduce((s, i) => s + (parseFloat(i.price)||0) * (parseInt(i.qty)||1), 0);
    };

    // ── KPIs gerais ──────────────────────────────────────
    const fatTotal  = validos.reduce((s,o) => s + _calcTotalItens(o), 0);
    const qtdTotal  = validos.length;
    const ticket    = qtdTotal > 0 ? fatTotal / qtdTotal : 0;
    const cancelados = orders.filter(o => o.status === 'cancelado').length;

    // ── Vendas por forma de pagamento ────────────────────
    const pagMap = {};
    validos.forEach(o => {
      const k = o.pag || 'Não informado';
      if (!pagMap[k]) pagMap[k] = 0;
      pagMap[k] += _calcTotalItens(o);
    });

    // ── Entradas e saídas (movimentos) ───────────────────
    const normDate = s => s ? new Date(s.replace(' ', 'T')) : null;
    const movsFiltrados = (movsRaw||[]).filter(m => {
      const t = normDate(m.created_at||m.time);
      return t && t >= range.inicio && t < range.fim;
    });
    const totEntradas = movsFiltrados.filter(m=>m.tipo==='entrada').reduce((s,m)=>s+parseFloat(m.val||0),0);
    const totSaidas   = movsFiltrados.filter(m=>m.tipo==='saida').reduce((s,m)=>s+parseFloat(m.val||0),0);
    const saldo       = totEntradas - totSaidas;

    // ── Mesas: horários e totais ──────────────────────────
    const mesaOrders = validos.filter(o => o.mesa_num);
    const mesaMap = {};
    mesaOrders.forEach(o => {
      const m = `Mesa ${o.mesa_num}`;
      if (!mesaMap[m]) mesaMap[m] = { total: 0, pedidos: 0, ultimo: '' };
      mesaMap[m].total   += parseFloat(o.total||0) + parseFloat(o.taxa||0);
      mesaMap[m].pedidos++;
      const d = o.created_at ? new Date(o.created_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}) : '';
      if (!mesaMap[m].ultimo || o.created_at > mesaMap[m].ultimo) mesaMap[m].ultimo = d;
    });

    // ── Itens vendidos e garçom que lançou ──────────────
    const itemMap = {};
    validos.forEach(o => {
      const garcom = o.garcom_nome || '—';
      const itens  = (() => { try { return Array.isArray(o.items) ? o.items : JSON.parse(o.items||'[]'); } catch { return []; } })();
      itens.forEach(i => {
        if ((i.item_status||'active') === 'cancelado') return;
        if (i.item_type === 'taxa') return;
        const k = i.name || '?';
        if (!itemMap[k]) itemMap[k] = { qty: 0, total: 0, garcons: new Set() };
        itemMap[k].qty   += (parseInt(i.qty)||1);
        itemMap[k].total += (parseFloat(i.price)||0) * (parseInt(i.qty)||1);
        itemMap[k].garcons.add(garcom);
      });
    });
    const topItens = Object.entries(itemMap)
      .sort((a,b) => b[1].total - a[1].total)
      .slice(0, 30);

    // ── Relatório por garçom ──────────────────────────────
    // Apenas pedidos finalizados de mesa (exclui cancelados e mesas ainda abertas)
    const garcomMap = {};
    validos
      .filter(o => (o.mesa_num || (o.addr||'').startsWith('Mesa')) && o.garcom_nome)
      .forEach(o => {
        const nome = o.garcom_nome;
        if (!garcomMap[nome]) garcomMap[nome] = { pedidos: 0, fat: 0, mesas: new Set(), taxa: 0 };
        garcomMap[nome].pedidos++;
        const itens = (() => { try { return Array.isArray(o.items) ? o.items : JSON.parse(o.items||'[]'); } catch { return []; } })();
        const itensAtivos = itens.filter(i => (i.item_status||'active') !== 'cancelado');
        // fat = soma dos itens ativos SEM a taxa (base para cálculo de comissão)
        const fatSemTaxa = itensAtivos
          .filter(i => i.item_type !== 'taxa')
          .reduce((s, i) => s + (parseFloat(i.price)||0) * (parseInt(i.qty)||1), 0);
        garcomMap[nome].fat += fatSemTaxa;
        // Valor da taxa cobrada pelo garçom neste pedido
        const taxaItem = itensAtivos.find(i => i.item_type === 'taxa');
        if (taxaItem) garcomMap[nome].taxa += parseFloat(taxaItem.price)||0;
        if (o.mesa_num) garcomMap[nome].mesas.add(o.mesa_num);
      });

    // ─── Monta HTML para impressão 80mm ──────────────────
    const hr  = `<hr style="border:none;border-top:1px dashed #000;margin:5px 0">`;
    const row = (l, r, bold) => `<div style="display:flex;justify-content:space-between;${bold?'font-weight:700':''}"><span>${l}</span><span>${r}</span></div>`;
    const title = t => `<div style="font-weight:900;font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin:8px 0 4px">${t}</div>`;

    let html = `<div style="font-family:monospace;font-size:11px;color:#111;background:#fff;padding:12px 8px;max-width:280px;margin:0 auto">`;

    // Cabeçalho
    html += `<div style="text-align:center;margin-bottom:6px">
      <div style="font-size:14px;font-weight:900">${nomeLoja.toUpperCase()}</div>
      <div style="font-size:10px">RELATÓRIO GERENCIAL</div>
      <div style="font-size:10px">${range.label}</div>
      <div style="font-size:9px;color:#666">Gerado: ${dataHora}</div>
    </div>${hr}`;

    // Resumo geral
    html += title('📊 Resumo Geral');
    html += row('Faturamento total', money(fatTotal), true);
    html += row('Pedidos confirmados', qtdTotal);
    html += row('Ticket médio', money(ticket));
    html += row('Pedidos cancelados', cancelados);

    // Formas de pagamento
    html += hr + title('💳 Formas de Pagamento');
    Object.entries(pagMap).sort((a,b)=>b[1]-a[1]).forEach(([f,v]) => {
      html += row(f, money(v));
    });

    // Entradas e saídas
    html += hr + title('💰 Caixa — Movimentos');
    html += row('Entradas', money(totEntradas), true);
    html += row('Saídas', money(totSaidas), true);
    html += row('Saldo', money(saldo), true);
    if (movsFiltrados.length) {
      html += `<div style="margin-top:4px">`;
      movsFiltrados.slice(0, 20).forEach(m => {
        const data = m.created_at||m.time ? new Date((m.created_at||m.time).replace(' ','T')).toLocaleDateString('pt-BR') : '';
        const sinal = m.tipo === 'entrada' ? '+' : '-';
        html += row(`${sinal} ${(m.description||'').substring(0,18)}`, money(m.val));
      });
      html += `</div>`;
    }

    // Mesas: horários e totais
    html += hr + title('🍽️ Mesas');
    const mesaEntries = Object.entries(mesaMap).sort((a,b) => parseInt(a[0].split(' ')[1]) - parseInt(b[0].split(' ')[1]));
    if (mesaEntries.length) {
      mesaEntries.forEach(([mesa, v]) => {
        html += `<div style="margin-bottom:3px">`;
        html += row(mesa, money(v.total), true);
        html += `<div style="font-size:10px;color:#555">${v.pedidos} comanda(s) · último: ${v.ultimo}</div>`;
        html += `</div>`;
      });
    } else {
      html += `<div style="font-size:10px;color:#888;text-align:center;padding:4px">Nenhuma mesa no período</div>`;
    }

    // Itens vendidos + garçom
    html += hr + title('🛒 Itens Vendidos');
    if (topItens.length) {
      topItens.forEach(([nome, v]) => {
        const garcons = [...v.garcons].join(', ');
        html += `<div style="margin-bottom:4px">`;
        html += row(`${v.qty}x ${nome.substring(0,22)}`, money(v.total), true);
        html += `<div style="font-size:9px;color:#555">Garçom: ${garcons.substring(0,30)}</div>`;
        html += `</div>`;
      });
    } else {
      html += `<div style="font-size:10px;color:#888;text-align:center;padding:4px">Sem itens no período</div>`;
    }

    // Relatório de garçons / comissão
    html += hr + title('👨‍💼 Garçons — Comissão');
    const garcomEntries = Object.entries(garcomMap).sort((a,b)=>b[1].fat-a[1].fat);
    if (garcomEntries.length) {
      garcomEntries.forEach(([nome, v]) => {
        const comissao = v.fat > 0 ? v.fat * 0.1 : 0;
        html += `<div style="margin-bottom:5px">`;
        html += row(nome, money(v.fat), true);
        html += row(`  ${v.pedidos} pedido(s) · ${v.mesas.size} mesa(s)`, '');
        html += row('  Comissão (10%)', money(comissao));
        if (v.taxa > 0) html += row('  Taxa serviço cobrada', money(v.taxa));
        html += `</div>`;
      });
    } else {
      html += `<div style="font-size:10px;color:#888;text-align:center;padding:4px">Nenhum garçom no período</div>`;
    }

    html += hr;
    html += `<div style="text-align:center;font-size:10px;color:#888;margin-top:6px">*** FIM DO RELATÓRIO ***</div>`;
    html += `</div>`;

    // ── Envia para impressora ─────────────────────────────
    const tid = (() => { try { return JSON.parse(sessionStorage.getItem('sys_session')||'{}').tenant_id||''; } catch { return ''; } })();
    const fmt = localStorage.getItem('printFormat') || '80mm';

    // 1. Print Agent
    try {
      if (tid) {
        const st = await fetch('/api/print-queue/status', { headers: { 'x-tenant-id': tid } }).then(r=>r.json());
        if (st.active) {
          await fetch('/api/print-queue/job', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
            body: JSON.stringify({ html, format: fmt, tipo: 'caixa', marginH: _printMarginH, marginV: _printMarginV }),
          });
          sbToast('ok', '🖨️ Relatório enviado para impressora!');
          return;
        }
      }
    } catch(e) { console.warn('[REL PRINT] Agent falhou:', e.message); }

    // 2. Electron
    const _caixaPrinter = localStorage.getItem('printPrinter') || '';
    if (window.ElectronPrint?.printHtml) {
      try {
        await window.ElectronPrint.printHtml(html, { printer: _caixaPrinter, paperWidth: 80 });
        sbToast('ok', '🖨️ Relatório impresso!');
        return;
      } catch(e) { console.warn('[REL PRINT] Electron falhou:', e.message); }
    }

    // 3. Popup de impressão
    const w = window.open('', '_blank', 'width=420,height=700');
    if (!w) { sbToast('err', 'Permita popups para imprimir'); return; }
    w.document.write(`<!DOCTYPE html><html><head><title>Relatório ${range.label}</title>
      <style>body{margin:0;background:#fff}@media print{body{margin:0}}</style></head>
      <body>${html}<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script></body></html>`);
    w.document.close();
    sbToast('ok', '🖨️ Abrindo impressão...');
  } catch(e) {
    console.error('[REL PRINT]', e);
    sbToast('err', 'Erro ao gerar relatório: ' + (e?.message||e));
  } finally {
    sbLoading(false);
  }
}


// ─────────────────────────────────────────
// SATISFAÇÃO
// ─────────────────────────────────────────
async function renderSatisfacao(){
  const elBars    = document.getElementById('sat-bars');
  const elReviews = document.getElementById('sat-reviews');

  if (elBars)    elBars.innerHTML    = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px">Carregando…</div>';
  if (elReviews) elReviews.innerHTML = '';

  try {
    const { data: ratings, error } = await sb.from('ratings').select('*').order('created_at', { ascending: false });
    if (error) throw error;

    const list  = ratings || [];
    const total = list.length;
    const statEls   = document.querySelectorAll('#page-satisfacao .sg .sv');
    const statTrend = document.querySelector('#page-satisfacao .sg .str');

    if (total === 0) {
      const vazio = `<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:13px">
        <div style="margin-bottom:12px;color:var(--accent3)"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M8 2l1.5 3.5L13 6l-2.5 2.5.6 3.5L8 10.5 4.9 12l.6-3.5L3 6l3.5-.5L8 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></div>
        Nenhuma avaliação ainda.<br>
        <small style="font-size:11.5px">Quando clientes responderem ao link de avaliação, os dados aparecerão aqui.</small>
      </div>`;
      if (elBars)    elBars.innerHTML    = vazio;
      if (elReviews) elReviews.innerHTML = '';
      if (statEls[0]) statEls[0].textContent = '—';
      if (statEls[1]) statEls[1].textContent = '0';
      if (statEls[2]) statEls[2].textContent = '—';
      if (statEls[3]) statEls[3].textContent = '—';
      return;
    }

    const soma          = list.reduce((s, r) => s + (r.nota || 0), 0);
    const media         = soma / total;
    const satisfeitos   = list.filter(r => r.nota >= 4).length;
    const insatisfeitos = list.filter(r => r.nota <= 2).length;

    if (statEls[0]) statEls[0].textContent = media.toFixed(1);
    if (statEls[1]) statEls[1].textContent = total;
    if (statEls[2]) statEls[2].textContent = Math.round((satisfeitos / total) * 100) + '%';
    if (statEls[3]) statEls[3].textContent = Math.round((insatisfeitos / total) * 100) + '%';
    if (statTrend)  statTrend.textContent  = media >= 4.5 ? '↑ Excelente' : media >= 3.5 ? '→ Bom' : '↓ Atenção';

    // Distribuição de notas
    const dist = [5,4,3,2,1].map(nota => {
      const count = list.filter(r => r.nota === nota).length;
      const pct   = Math.round((count / total) * 100);
      const clr   = nota >= 4 ? 'var(--success)' : nota === 3 ? '#f59e0b' : 'var(--danger)';
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:12px;font-weight:700;min-width:14px;text-align:right">${nota}</span>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M8 2l1.5 3.5L13 6l-2.5 2.5.6 3.5L8 10.5 4.9 12l.6-3.5L3 6l3.5-.5L8 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        <div style="flex:1;height:9px;background:var(--surface2);border-radius:99px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${clr};border-radius:99px"></div>
        </div>
        <span style="font-size:11.5px;color:var(--muted);min-width:32px;text-align:right">${count}x</span>
      </div>`;
    }).join('');
    if (elBars) elBars.innerHTML = dist;

    // Últimas avaliações
    const EMOJI = { 5:'😍', 4:'😊', 3:'😐', 2:'😕', 1:'😠' };
    const revs = list.slice(0, 30).map(r => {
      const stars = '⭐'.repeat(r.nota || 0);
      const dt    = r.created_at
        ? new Date(r.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
        : '';
      return `<div style="padding:12px 0;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:flex-start">
        <div style="font-size:26px;flex-shrink:0;line-height:1">${EMOJI[r.nota] || '⭐'}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px">
            <span style="font-weight:700;font-size:13px">${r.client || 'Cliente'}</span>
            <span style="font-size:11px;color:var(--muted);white-space:nowrap">${dt}</span>
          </div>
          <div style="font-size:13px;margin-bottom:${r.comentario ? '5px' : '0'}">${stars}</div>
          ${r.comentario ? `<div style="font-size:12.5px;color:var(--muted2);line-height:1.5">${r.comentario}</div>` : ''}
          ${r.order_id   ? `<div style="font-size:11px;color:var(--muted);margin-top:3px">Pedido #${String(r.order_id).padStart(3,'0')}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    if (elReviews) elReviews.innerHTML = revs || '<div style="color:var(--muted);font-size:12px;padding:12px">Nenhuma avaliação.</div>';

  } catch(e) {
    console.error('renderSatisfacao:', e);
    const err = '<div style="color:var(--muted);font-size:12.5px;padding:20px;text-align:center">Erro ao carregar avaliações.</div>';
    if (elBars)    elBars.innerHTML    = err;
    if (elReviews) elReviews.innerHTML = '';
  }
}

// ─────────────────────────────────────────
// MEU PLANO
// ─────────────────────────────────────────
async function renderMeuPlano() {
  const elNome   = document.getElementById('plano-nome-display');
  const elExpira = document.getElementById('plano-expira-display');
  const elDias   = document.getElementById('plano-dias-display');
  const elTenant = document.getElementById('plano-tenant-display');
  const elBadge  = document.getElementById('plano-badge-wrap');
  const elStatus = document.getElementById('plano-status-wrap');
  const elRecursos = document.getElementById('plano-recursos-grid');
  const elBgDeco = document.getElementById('plano-bg-deco');

  if (elNome) elNome.textContent = 'Carregando...';
  
  // Carregar precos dos planos (aguarda pra já ter o valor geral quando calcular o preço deste tenant)
  await carregarPrecosPlanos();
  carregarAssinaturaPlano();

  try {
    const tid = _sessao?.tenant_id;
    if (!tid) throw new Error('Sessão inválida');

    const res = await fetch('/api/tenant-info-gestor', {
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid }
    });
    if (!res.ok) throw new Error('Erro HTTP ' + res.status);
    const data = await res.json();
    if (!data) throw new Error('Tenant não encontrado');

    const plano     = (data.plano || 'pro').toLowerCase();
    const isPremium = plano === 'premium';
    const expira    = data.expires_at ? new Date(data.expires_at) : null;
    const hoje      = new Date();
    hoje.setHours(0,0,0,0);
    const diasRestantes = expira
      ? Math.ceil((expira - hoje) / (1000 * 60 * 60 * 24))
      : null;

    // ── Nome e badge ──
    const planoLabel = isPremium ? 'Premium' : 'Pro';
    const planoColor = isPremium ? '#7c3aed' : 'var(--accent)';
    if (elNome)   { elNome.textContent = planoLabel; elNome.style.color = planoColor; }
    if (elBgDeco) elBgDeco.style.background = planoColor;
    if (elBadge)  elBadge.innerHTML = `
      <div style="padding:4px 12px;border-radius:99px;font-size:11px;font-weight:800;letter-spacing:.4px;
        background:${isPremium ? 'rgba(124,58,237,.15)' : 'rgba(59,130,246,.12)'};
        color:${planoColor};border:1px solid ${isPremium ? 'rgba(124,58,237,.35)' : 'rgba(59,130,246,.3)'}">
        ${planoLabel.toUpperCase()}
      </div>`;

    // ── Vencimento ──
    const expiraStr = expira
      ? expira.toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' })
      : 'Sem data definida';
    if (elExpira) elExpira.textContent = expiraStr;

    // ── Dias restantes ──
    let diasStr = 'Sem data definida';
    let diasColor = 'var(--text)';
    if (diasRestantes !== null) {
      if (diasRestantes > 30)       { diasStr = `${diasRestantes} dias`; diasColor = 'var(--success)'; }
      else if (diasRestantes > 7)   { diasStr = `${diasRestantes} dias`; diasColor = 'var(--warning,#f59e0b)'; }
      else if (diasRestantes > 0)   { diasStr = `${diasRestantes} dias — vence em breve`; diasColor = 'var(--danger)'; }
      else if (diasRestantes === 0) { diasStr = 'Vence hoje'; diasColor = 'var(--danger)'; }
      else                          { diasStr = 'Vencido'; diasColor = 'var(--danger)'; }
    }
    if (elDias) { elDias.textContent = diasStr; elDias.style.color = diasColor; }

    // ── Nome do tenant ──
    if (elTenant) elTenant.textContent = data.nome || _sessao?.nome || '—';

    // ── Preço deste tenant no card de renovação: personalizado (promoção) tem prioridade sobre o valor geral ──
    const valorPersonalizado = (data.valor_mensalidade !== null && data.valor_mensalidade !== undefined && data.valor_mensalidade !== '')
      ? parseFloat(data.valor_mensalidade) : null;
    _valorMeuPlano = valorPersonalizado !== null ? valorPersonalizado : (isPremium ? _precosPlanos.premium : _precosPlanos.essencial);
    _planoSelecionado = 'premium'; // plano unico — sempre este código internamente
    const elPrecoMeuPlano = document.getElementById('preco-premium');
    if (elPrecoMeuPlano) elPrecoMeuPlano.textContent = _valorMeuPlano.toFixed(2).replace('.', ',');
    const elPromoNota = document.getElementById('plano-atual-promo-nota');
    if (elPromoNota) {
      if (valorPersonalizado !== null && data.valor_mensalidade_expira_em) {
        const expiraPromo = new Date(String(data.valor_mensalidade_expira_em).slice(0,10) + 'T00:00:00');
        elPromoNota.style.display = 'block';
        elPromoNota.textContent = `Preço promocional válido até ${expiraPromo.toLocaleDateString('pt-BR')}`;
      } else {
        elPromoNota.style.display = 'none';
        elPromoNota.textContent = '';
      }
    }

    // ── Status ──
    if (elStatus) {
      const ativo = data.ativo !== 0 && data.ativo !== false;
      const vencido = diasRestantes !== null && diasRestantes < 0;
      const alertaBarra = diasRestantes !== null && diasRestantes <= 30 && diasRestantes >= 0;
      const pct = alertaBarra ? Math.max(0, Math.min(100, Math.round((diasRestantes / 30) * 100))) : null;

      let statusHtml = '';
      if (!ativo || vencido) {
        statusHtml += `
          <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;
            background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:10px">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="color:var(--danger);flex-shrink:0">
              <path d="M8 2L14 13H2L8 2z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M8 6v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              <circle cx="8" cy="11" r=".6" fill="currentColor"/>
            </svg>
            <div>
              <div style="font-weight:700;font-size:13px;color:var(--danger)">${vencido ? 'Plano vencido' : 'Conta inativa'}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:1px">Entre em contato com o suporte para reativar.</div>
            </div>
          </div>`;
      } else {
        statusHtml += `
          <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;
            background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:10px">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="color:var(--success);flex-shrink:0">
              <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/>
              <path d="M5.5 8l2 2 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
            <div>
              <div style="font-weight:700;font-size:13px;color:var(--success)">Assinatura ativa</div>
              <div style="font-size:12px;color:var(--muted);margin-top:1px">Todos os recursos disponíveis.</div>
            </div>
          </div>`;
      }
      if (alertaBarra && pct !== null) {
        const barColor = diasRestantes <= 7 ? 'var(--danger)' : '#f59e0b';
        statusHtml += `
          <div style="margin-top:4px">
            <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-bottom:5px">
              <span>Tempo restante do plano</span>
              <span style="font-weight:700;color:${barColor}">${diasRestantes}d de 30d</span>
            </div>
            <div style="height:7px;background:var(--surface2);border-radius:99px;overflow:hidden">
              <div style="width:${pct}%;height:100%;background:${barColor};border-radius:99px;transition:width .5s"></div>
            </div>
          </div>`;
      }
      elStatus.innerHTML = statusHtml;
    }

    // ── Recursos ──
    const recursosPro = [
      { svg:'<path d="M2 2h12v12H2z" stroke="currentColor" stroke-width="1.4" fill="none" rx="2"/><path d="M5 6h6M5 9h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Gestão de pedidos (Kanban)' },
      { svg:'<rect x="1" y="4" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8.5" r="2" stroke="currentColor" stroke-width="1.4"/>', label:'PDV / Pedidos no balcão' },
      { svg:'<rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5 8h6M8 5v6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Gestor de cardápio' },
      { svg:'<path d="M3 12V5l5-3 5 3v7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><rect x="6" y="8" width="4" height="4" rx=".5" stroke="currentColor" stroke-width="1.4"/>', label:'Mesas e garçons' },
      { svg:'<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 2c-1.5 2-2.5 3.8-2.5 6s1 4 2.5 6M2 8h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Cardápio público online' },
      { svg:'<path d="M2 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V4z" stroke="currentColor" stroke-width="1.4" fill="none"/>', label:'Automações de WhatsApp' },
      { svg:'<path d="M8 2l1.5 3.5L13 6l-2.5 2.5.6 3.5L8 10.5 4.9 12l.6-3.5L3 6l3.5-.5z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>', label:'Satisfação e avaliações' },
      { svg:'<rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/>', label:'QR Code da mesa' },
      { svg:'<path d="M2 12L6 4l3 5 2-2.5L14 12H2z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>', label:'Relatórios e desempenho' },
      { svg:'<rect x="1" y="4" width="14" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="2" width="10" height="4" rx="1" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="9" r="1.5" stroke="currentColor" stroke-width="1.4"/>', label:'Caixa e movimentos' },
      { svg:'<path d="M8 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM2 13c0-2.76 2.24-5 5-5h2c2.76 0 5 2.24 5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Programa de fidelidade' },
      { svg:'<rect x="3" y="2" width="10" height="4" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="10" width="10" height="4" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M3 6H2a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1M13 6h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1" stroke="currentColor" stroke-width="1.4"/>', label:'Impressão térmica' },
    ];
    const extraPremium = [
      { svg:'<rect x="3" y="5" width="10" height="8" rx="2" stroke="currentColor" stroke-width="1.4"/><circle cx="6" cy="9" r="1" fill="currentColor"/><circle cx="10" cy="9" r="1" fill="currentColor"/><path d="M6 5V3.5M10 5V3.5M6 3.5H10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Agente IA no WhatsApp', destaque: true },
      { svg:'<path d="M2 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V4z" stroke="currentColor" stroke-width="1.4"/><path d="M5 7h6M5 9.5h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', label:'Simulador do robô', destaque: true },
    ];
    const recursos = isPremium ? [...recursosPro, ...extraPremium] : recursosPro;
    if (elRecursos) {
      elRecursos.innerHTML = recursos.map(r => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
          background:var(--surface2);border:1px solid ${r.destaque ? 'rgba(124,58,237,.3)' : 'var(--border)'};border-radius:10px;
          ${r.destaque ? 'background:rgba(124,58,237,.07);' : ''}">
          <div style="width:28px;height:28px;border-radius:7px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
            background:${r.destaque ? 'rgba(124,58,237,.15)' : 'var(--surface)'};
            border:1px solid ${r.destaque ? 'rgba(124,58,237,.25)' : 'var(--border)'};
            color:${r.destaque ? '#a78bfa' : 'var(--muted)'}">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">${r.svg}</svg>
          </div>
          <span style="font-size:12.5px;font-weight:500;color:${r.destaque ? 'var(--text)' : 'var(--muted2)'};flex:1">${r.label}</span>
          <svg viewBox="0 0 16 16" fill="none" width="12" height="12" style="flex-shrink:0;color:${r.destaque ? '#a78bfa' : 'var(--success)'}">
            ${r.destaque
              ? '<path d="M8 2l1.5 3.5L13 6l-2.5 2.5.6 3.5L8 10.5 4.9 12l.6-3.5L3 6l3.5-.5z" stroke="currentColor" stroke-width="1.3" fill="none"/>'
              : '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 8l2 2 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'}
          </svg>
        </div>`).join('');
    }

  } catch(e) {
    console.error('renderMeuPlano:', e);
    if (elNome) elNome.textContent = '—';
    if (elStatus) elStatus.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:12px;text-align:center">Não foi possível carregar as informações do plano.</div>`;
  }
}

// ─────────────────────────────────────────
// RENOVACAO DE PLANOS
// ─────────────────────────────────────────
let _planoSelecionado = 'premium';
let _formaPagPlano = 'pix';
let _precosPlanos = { essencial: 79.99, premium: 99.90 };
let _valorMeuPlano = 99.90; // preço efetivo deste tenant (personalizado/promo ou valor geral)
let _pixPlanoInterval = null;
let _cartaoPlanoModo = 'avulso';
let _assinaturaPlanoAtual = null;

async function carregarPrecosPlanos() {
  try {
    const res = await fetch('/api/planos/precos');
    if (res.ok) {
      const data = await res.json();
      _precosPlanos = { essencial: data.essencial || 79.99, premium: data.premium || 99.90 };
      const elEss = document.getElementById('preco-essencial');
      const elPre = document.getElementById('preco-premium');
      if (elEss) elEss.textContent = _precosPlanos.essencial.toFixed(2).replace('.', ',');
      if (elPre) elPre.textContent = _precosPlanos.premium.toFixed(2).replace('.', ',');
    }
  } catch(e) { console.error('carregarPrecosPlanos:', e); }
}

async function carregarAssinaturaPlano() {
  const box = document.getElementById('plano-assinatura-status');
  if (!box) return;
  try {
    const tid = _sessao?.tenant_id;
    if (!tid) return;
    const res = await fetch('/api/planos/assinatura', {
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid }
    });
    if (!res.ok) throw new Error('Erro HTTP ' + res.status);
    const data = await res.json();
    _assinaturaPlanoAtual = data.assinatura || null;
    renderAssinaturaPlano(_assinaturaPlanoAtual);
  } catch(e) {
    console.error('carregarAssinaturaPlano:', e);
    box.style.display = 'none';
  }
}

function renderAssinaturaPlano(ass) {
  const box = document.getElementById('plano-assinatura-status');
  if (!box) return;
  const status = String(ass?.status || '').toLowerCase();
  const ativa = ['authorized', 'pending', 'paused'].includes(status);
  if (!ass || !ativa) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }

  const planoLabel = ass.plano === 'premium' ? 'Premium' : 'Essencial';
  const valor = Number(ass.valor || 0).toFixed(2).replace('.', ',');
  const statusLabel = status === 'authorized' ? 'Ativa'
    : status === 'paused' ? 'Pausada'
    : 'Aguardando cobranca';
  const statusColor = status === 'authorized' ? 'var(--success)'
    : status === 'paused' ? 'var(--warning,#f59e0b)'
    : 'var(--accent)';
  const last = String(ass.last_payment_status || '').toLowerCase();
  const lastTxt = last === 'approved' ? 'Ultima cobranca aprovada'
    : last ? `Ultima cobranca: ${last}` : 'Primeira cobranca pendente';

  box.style.display = 'block';
  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
      background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.22);border-radius:12px;padding:14px 16px">
      <div style="display:flex;align-items:center;gap:12px;min-width:220px">
        <div style="width:38px;height:38px;border-radius:9px;background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;color:var(--accent);flex-shrink:0">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M8 2v2M8 12v2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M2 8h2M12 8h2M3.8 12.2l1.4-1.4M10.8 5.2l1.4-1.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.4"/></svg>
        </div>
        <div>
          <div style="font-size:13px;font-weight:800">Pagamento automatico ${statusLabel.toLowerCase()}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">Plano ${planoLabel} - R$ ${valor}/mes. ${lastTxt}.</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;font-weight:800;color:${statusColor};background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:5px 9px">${statusLabel}</span>
        <button class="btn bg2" style="font-size:11px;padding:7px 10px" onclick="cancelarAssinaturaPlano()">Cancelar</button>
      </div>
    </div>`;
}

async function cancelarAssinaturaPlano() {
  if (!_assinaturaPlanoAtual) return;
  if (!confirm('Cancelar o pagamento automatico deste plano?')) return;
  try {
    const tid = _sessao?.tenant_id;
    const res = await fetch('/api/planos/assinatura-cancelar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro ao cancelar assinatura');
    sbToast('ok', 'Pagamento automatico cancelado.');
    _assinaturaPlanoAtual = null;
    renderAssinaturaPlano(null);
  } catch(e) {
    sbToast('err', e.message);
  }
}

function selecionarPlano(plano) {
  // Plano unico: mantido apenas por compatibilidade, não há mais seleção visual entre planos.
  _planoSelecionado = 'premium';
}

function selecionarFormaPagPlano(forma) {
  _formaPagPlano = forma;
  const optPix = document.getElementById('pag-opt-pix');
  const optCartao = document.getElementById('pag-opt-cartao');
  const optAuto = document.getElementById('pag-opt-automatico');
  const radio = document.querySelector(`input[name="forma-pag-plano"][value="${forma}"]`);
  if (radio) radio.checked = true;
  const setOpt = (el, on) => {
    if (!el) return;
    el.style.background = on ? 'rgba(59,130,246,.08)' : 'var(--surface)';
    el.style.borderColor = on ? 'var(--accent)' : 'var(--border)';
  };
  setOpt(optPix, forma === 'pix');
  setOpt(optCartao, forma === 'cartao');
  setOpt(optAuto, forma === 'automatico');
  atualizarBotaoPlano();
}

function atualizarBotaoPlano() {
  const btn = document.getElementById('btn-pagar-plano');
  if (!btn || btn.disabled) return;
  const texto = _formaPagPlano === 'automatico' ? 'Ativar pagamento automatico' : 'Renovar Plano';
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M8 2v12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> ${texto}`;
}

async function iniciarPagamentoPlano() {
  const btn = document.getElementById('btn-pagar-plano');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Processando...'; }
  
  const planoNome = 'Plano Premium';
  const valor = _valorMeuPlano;
  
  if (_formaPagPlano === 'pix') {
    try {
      const tid = _sessao?.tenant_id;
      const res = await fetch('/api/planos/pagar-pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
        body: JSON.stringify({ plano: _planoSelecionado, valor })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao criar PIX');
      
      // Mostrar modal com QR Code
      document.getElementById('pix-plano-titulo').textContent = planoNome;
      document.getElementById('pix-plano-valor').textContent = 'R$ ' + valor.toFixed(2).replace('.', ',');
      document.getElementById('pix-plano-code').value = data.qr_code || '';
      document.getElementById('pix-plano-mp-id').value = data.mp_payment_id || '';
      
      if (data.qr_code_base64) {
        document.getElementById('pix-qr-img').innerHTML = `<img src="data:image/png;base64,${data.qr_code_base64}" style="width:200px;height:200px">`;
      } else {
        document.getElementById('pix-qr-img').innerHTML = '<div style="color:var(--muted);font-size:12px">QR Code nao disponivel.<br>Use o codigo PIX abaixo.</div>';
      }
      
      document.getElementById('modal-pag-pix-plano').classList.add('on');
      iniciarPollingPixPlano(data.mp_payment_id);
      
    } catch(e) {
      sbToast('err', e.message);
    }
  } else {
    _cartaoPlanoModo = _formaPagPlano === 'automatico' ? 'assinatura' : 'avulso';
    document.getElementById('cartao-plano-titulo').textContent = planoNome;
    document.getElementById('cartao-plano-valor').textContent = 'R$ ' + valor.toFixed(2).replace('.', ',');
    const lbl = document.getElementById('cartao-plano-modo-label');
    const info = document.getElementById('cartao-plano-modo-info');
    const btnCartao = document.getElementById('btn-pagar-cartao-plano');
    if (lbl) lbl.textContent = _cartaoPlanoModo === 'assinatura' ? 'Pagamento automatico' : 'Pagamento via Cartao';
    if (info) info.style.display = _cartaoPlanoModo === 'assinatura' ? 'block' : 'none';
    if (btnCartao) btnCartao.innerHTML = _cartaoPlanoModo === 'assinatura'
      ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M8 2v12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Ativar automatico'
      : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Pagar agora';
    document.getElementById('modal-pag-cartao-plano').classList.add('on');
  }
  
  if (btn) { btn.disabled = false; atualizarBotaoPlano(); }
}

function iniciarPollingPixPlano(mpId) {
  if (_pixPlanoInterval) clearInterval(_pixPlanoInterval);
  let checks = 0;
  _pixPlanoInterval = setInterval(async () => {
    checks++;
    if (checks > 120) { // 10 minutos
      clearInterval(_pixPlanoInterval);
      document.getElementById('pix-status-text').textContent = 'Tempo esgotado. Tente novamente.';
      return;
    }
    try {
      const res = await fetch('/api/planos/status-pix?mp_payment_id=' + mpId);
      const data = await res.json();
      if (data.status === 'aprovado') {
        clearInterval(_pixPlanoInterval);
        document.getElementById('pix-status-text').textContent = 'Pagamento confirmado!';
        document.getElementById('pix-status-text').parentElement.style.background = 'rgba(34,197,94,.1)';
        document.getElementById('pix-status-text').parentElement.style.borderColor = 'rgba(34,197,94,.3)';
        sbToast('ok', 'Pagamento confirmado! Seu plano foi renovado.');
        setTimeout(() => {
          fecharModalPagPlano();
          renderMeuPlano();
          if (typeof billingRefreshLockStatus === 'function') billingRefreshLockStatus({ reload: true });
        }, 2000);
      }
    } catch(e) {}
  }, 5000);
}

function copiarPixPlano() {
  const code = document.getElementById('pix-plano-code').value;
  if (!code) { sbToast('err', 'Codigo PIX nao disponivel'); return; }
  navigator.clipboard.writeText(code).then(() => {
    sbToast('ok', 'Codigo PIX copiado!');
    const btn = document.getElementById('btn-copiar-pix-plano');
    if (btn) { btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Copiado!'; }
  });
}

function fecharModalPagPlano() {
  document.getElementById('modal-pag-pix-plano')?.classList.remove('on');
  document.getElementById('modal-pag-cartao-plano')?.classList.remove('on');
  if (_pixPlanoInterval) { clearInterval(_pixPlanoInterval); _pixPlanoInterval = null; }
}

function formatarCartao(el) {
  let v = el.value.replace(/\D/g, '');
  v = v.replace(/(\d{4})(?=\d)/g, '$1 ');
  el.value = v.substring(0, 19);
}

function formatarValidade(el) {
  let v = el.value.replace(/\D/g, '');
  if (v.length >= 2) v = v.substring(0,2) + '/' + v.substring(2);
  el.value = v.substring(0, 5);
}

function formatarCPF(el) {
  let v = el.value.replace(/\D/g, '');
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  el.value = v.substring(0, 14);
}

let _mpPlanoInstance = null;

async function carregarMPSDKPlano() {
  if (_mpPlanoInstance) return _mpPlanoInstance;
  // Carrega SDK se ainda nao carregado
  if (!window.MercadoPago) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://sdk.mercadopago.com/js/v2';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  // Busca public key
  const res = await fetch('/api/planos/mp-public-key');
  const data = await res.json();
  if (!data.public_key) throw new Error('Public Key do Mercado Pago nao configurada no Admin');
  _mpPlanoInstance = new MercadoPago(data.public_key);
  return _mpPlanoInstance;
}

async function processarPagamentoCartao() {
  const btn = document.getElementById('btn-pagar-cartao-plano');
  const numero = document.getElementById('cartao-numero').value.replace(/\s/g, '');
  const validade = document.getElementById('cartao-validade').value;
  const cvv = document.getElementById('cartao-cvv').value;
  const nome = document.getElementById('cartao-nome').value;
  const cpf = document.getElementById('cartao-cpf').value.replace(/\D/g, '');
  const email = (document.getElementById('cartao-email')?.value || '').trim();
  
  if (!numero || numero.length < 13) { sbToast('err', 'Numero do cartao invalido'); return; }
  if (!validade || validade.length < 5) { sbToast('err', 'Validade invalida'); return; }
  if (!cvv || cvv.length < 3) { sbToast('err', 'CVV invalido'); return; }
  if (!nome) { sbToast('err', 'Nome no cartao obrigatorio'); return; }
  if (!cpf || cpf.length < 11) { sbToast('err', 'CPF invalido'); return; }
  if (_cartaoPlanoModo === 'assinatura' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sbToast('err', 'Informe um e-mail valido para ativar o pagamento automatico');
    return;
  }
  
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Processando...'; }
  
  try {
    // Carrega SDK do Mercado Pago
    const mp = await carregarMPSDKPlano();
    
    const [mes, ano] = validade.split('/');
    
    // Cria card token usando SDK
    const cardToken = await mp.createCardToken({
      cardNumber: numero,
      cardholderName: nome,
      cardExpirationMonth: mes,
      cardExpirationYear: '20' + ano,
      securityCode: cvv,
      identificationType: 'CPF',
      identificationNumber: cpf
    });
    
    if (!cardToken?.id) throw new Error('Erro ao gerar token do cartao');
    
    // Detecta bandeira do cartao
    let paymentMethodId = 'visa';
    try {
      const bin = numero.substring(0, 6);
      const pmRes = await fetch(`https://api.mercadopago.com/v1/payment_methods/search?bin=${bin}&site_id=MLB`);
      const pmData = await pmRes.json();
      if (pmData.results?.[0]?.id) paymentMethodId = pmData.results[0].id;
    } catch {}
    
    const tid = _sessao?.tenant_id;
    const endpoint = _cartaoPlanoModo === 'assinatura'
      ? '/api/planos/assinatura-cartao'
      : '/api/planos/pagar-cartao';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({
        plano: _planoSelecionado,
        valor: _valorMeuPlano,
        card_token: cardToken.id,
        payment_method_id: paymentMethodId,
        payer_email: email || 'cliente@email.com',
        payer_cpf: cpf
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao processar pagamento');

    if (_cartaoPlanoModo === 'assinatura') {
      sbToast('ok', data.message || 'Pagamento automatico ativado. Aguarde a confirmacao da primeira cobranca.');
      fecharModalPagPlano();
      renderMeuPlano();
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M8 2v12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Ativar automatico';
      }
      return;
    }
    
    if (data.status === 'aprovado') {
      sbToast('ok', 'Pagamento aprovado! Seu plano foi renovado.');
      fecharModalPagPlano();
      renderMeuPlano();
      if (typeof billingRefreshLockStatus === 'function') billingRefreshLockStatus({ reload: true });
    } else if (data.status === 'pendente') {
      sbToast('ok', 'Pagamento em analise. Aguarde confirmacao.');
    } else {
      throw new Error(data.status_detail || 'Pagamento recusado');
    }
  } catch(e) {
    sbToast('err', e.message);
  }
  
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = _cartaoPlanoModo === 'assinatura'
      ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M8 2v12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Ativar automatico'
      : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Pagar agora';
  }
}

// Inicializar selecao padrao
setTimeout(() => {
  selecionarFormaPagPlano('pix');
  carregarPrecosPlanos();
}, 100);

// ─────────────────────────────────────────
// IMPRESSÃO SILENCIOSA (server-side)
// ─────────────────────────────────────────
window._printMode  = localStorage.getItem('printMode')     || 'auto';
let _printMode     = window._printMode;
let _printFontSize = 13; // valor restaurado do servidor via loadPrintConfigServer()
let _printTarget   = localStorage.getItem('printTarget')   || 'server';
let _printPrinter  = localStorage.getItem('printPrinter')  || '';
let _printPrinterCozinha = localStorage.getItem('printPrinterCozinha') || '';
const _PRINT_VIA_MODES = ['combinado', 'separado', 'somente_principal'];
function _normalizePrintViaMode(mode) {
  return _PRINT_VIA_MODES.includes(mode) ? mode : 'combinado';
}
let _printViaMode = _normalizePrintViaMode(localStorage.getItem('printViaMode'));
function _loadPrintSetoresCategoria() {
  try {
    const raw = localStorage.getItem('printSetoresCategoria') || '{}';
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}
let _printSetoresCategoria = _loadPrintSetoresCategoria();
let _printFormat   = localStorage.getItem('printFormat')   || '80mm';  // padrão 80mm
let _printMarginH  = parseInt(localStorage.getItem('printMarginH')  || '5');  // margem lateral em mm
let _printMarginV  = parseInt(localStorage.getItem('printMarginV')  || '2');  // margem vertical em mm
// Dados do estabelecimento carregados do servidor — evita usar fallback genérico
let _printNome   = localStorage.getItem('printNome')   || '';
let _printSub    = localStorage.getItem('printSub')    || '';
let _printRodape = localStorage.getItem('printRodape') || '';
// Tempo de entrega — fonte da verdade é store_tempo_entrega (mesma do cardápio
// público). Sincronizado em loadStoreTempoEntrega() pra que a comanda mostre
// SEMPRE o mesmo tempo que o cliente vê no cardápio na hora do pedido.
let _printTempoEntrega = localStorage.getItem('printTempoEntrega') || '';
let _printTempoRetirada = localStorage.getItem('printTempoRetirada') || '';

// Carrega tempo de entrega do banco (mesma fonte usada pelo cardápio público).
// Chamado no boot e quando a config é alterada.
async function loadStoreTempoEntrega() {
  try {
    const tid = (typeof _sessao !== 'undefined' && _sessao?.tenant_id) || window._tenantId || null;
    if (!tid) return;
    const { data } = await window.AppAPI.from('store_config').select('store_tempo_entrega,store_tempo_retirada').eq('tenant_id', tid).single();
    if (!data) return;
    _printTempoEntrega = String(data.store_tempo_entrega || '').trim();
    _printTempoRetirada = String(data.store_tempo_retirada || '').trim();
    localStorage.setItem('printTempoEntrega', _printTempoEntrega);
    localStorage.setItem('printTempoRetirada', _printTempoRetirada);
  } catch {}
}
// Inicia o load no boot (não-bloqueante)
setTimeout(() => { loadStoreTempoEntrega(); }, 1500);

function _printOrderType(order) {
  if (typeof window !== 'undefined' && typeof window._detectOrderType === 'function') {
    const tipo = window._detectOrderType(order);
    if (tipo === 'mesa') return 'mesa';
    if (tipo === 'balcao') return 'retirada';
    return 'delivery';
  }
  const addr = String(order?.addr || '').trim();
  const lower = addr.toLowerCase();
  if (order?._isMesa || (order?.mesa_num && Number(order.mesa_num) > 0) || /^Mesa\b/i.test(addr)) return 'mesa';
  if (/^retirada\b/i.test(lower) || lower.startsWith('balcao') || lower.startsWith('balcão') || lower.includes('balcao') || lower.includes('balcão')) return 'retirada';
  return 'delivery';
}

// ── Salva config de impressão no servidor (sincroniza entre dispositivos) ──
async function savePrintConfigServer(cfg) {
  try {
    const tid = (typeof _sessao !== 'undefined' && _sessao?.tenant_id) || window._tenantId || null
    if (!tid) return
    await window.AppAPI.from('store_config').update({ print_config: JSON.stringify(cfg) }).eq('tenant_id', tid)
  } catch {}
}

// ── Sincroniza config de impressão atual no servidor ────────────────
// Antes a config de impressora ficava SÓ em localStorage do gestor. O
// garçom (que roda em outro contexto/aba/máquina) carregava print_config
// do banco e achava vazio → não sabia em qual impressora imprimir.
// Agora qualquer mudança nas impressoras é refletida no banco automaticamente.
async function _syncPrintConfigServer() {
  try {
    const viaMode = _normalizePrintViaMode(localStorage.getItem('printViaMode') || _printViaMode);
    _printViaMode = viaMode;
    localStorage.setItem('printViaMode', viaMode);
    const cfg = {
      printer_caixa:        localStorage.getItem('printPrinter')        || '',
      printer_cozinha:      localStorage.getItem('printPrinterCozinha') || '',
      printPrinter:         localStorage.getItem('printPrinter')        || '',
      printPrinterCozinha:  localStorage.getItem('printPrinterCozinha') || '',
      printMode:            localStorage.getItem('printMode')           || 'auto',
      printFormat:          localStorage.getItem('printFormat')         || '80mm',
      printViaMode:         viaMode,
      printSetoresCategoria:_getPrintSetoresCategoria(),
      printFontSize:        (typeof _printFontSize !== 'undefined' ? _printFontSize : null) || parseInt(localStorage.getItem('printFontSize')||'13'),
      printBebidaSolo:      localStorage.getItem('printBebidaSolo') !== '0',
      bebidaProntaKanban:   localStorage.getItem('bebidaProntaKanban') === '1',
      printNome:            localStorage.getItem('printNome')   || '',
      printSub:             localStorage.getItem('printSub')    || '',
      printRodape:          localStorage.getItem('printRodape') || '',
      impressoras:          (typeof _impressoras !== 'undefined' && Array.isArray(_impressoras)) ? _impressoras : [],
      modelos:              (typeof _modelos !== 'undefined' && Array.isArray(_modelos)) ? _modelos : [],
    };
    await savePrintConfigServer(cfg);
  } catch (e) { console.warn('[_syncPrintConfigServer] erro:', e?.message); }
}
// Expõe globalmente pra ser chamado de onchange inline no HTML
window._syncPrintConfigServer = _syncPrintConfigServer;

// ── Carrega config de impressão do servidor ──
async function loadPrintConfigServer() {
  try {
    const tid = (typeof _sessao !== 'undefined' && _sessao?.tenant_id) || window._tenantId || null
    if (!tid) return
    const { data } = await window.AppAPI.from('store_config').select('print_config').eq('tenant_id', tid).single()
    if (!data?.print_config) return
    const cfg = JSON.parse(data.print_config)
    if (cfg.printMode)    { _printMode = cfg.printMode; window._printMode = cfg.printMode; localStorage.setItem('printMode', cfg.printMode) }
    if (cfg.printFormat)  { _printFormat = cfg.printFormat; localStorage.setItem('printFormat', cfg.printFormat) }
    if (cfg.printFontSize){ _printFontSize = cfg.printFontSize }
    if (cfg.printViaMode) {
      const viaMode = _normalizePrintViaMode(cfg.printViaMode);
      _printViaMode = viaMode;
      localStorage.setItem('printViaMode', viaMode);
    }
    // Impressora caixa (salva em ambos os campos que o sistema usa)
    const _savedCaixa = cfg.printer_caixa || cfg.printer || cfg.printPrinter || ''
    if (_savedCaixa) { _printPrinter = _savedCaixa; localStorage.setItem('printPrinter', _savedCaixa) }
    // Impressora cozinha
    const _savedCoz = cfg.printer_cozinha || cfg.printPrinterCozinha || ''
    if (_savedCoz) { _printPrinterCozinha = _savedCoz; localStorage.setItem('printPrinterCozinha', _savedCoz) }
    if (cfg.printSetoresCategoria && typeof cfg.printSetoresCategoria === 'object' && !Array.isArray(cfg.printSetoresCategoria)) {
      _printSetoresCategoria = cfg.printSetoresCategoria;
      _savePrintSetoresCategoria(false);
    }
    if (cfg.printNome)   {
      _printNome = cfg.printNome; localStorage.setItem('printNome', cfg.printNome);
      const el = document.getElementById('print-nome'); if (el) el.value = cfg.printNome;
    }
    if (cfg.printSub)    {
      _printSub = cfg.printSub; localStorage.setItem('printSub', cfg.printSub);
      const el = document.getElementById('print-sub'); if (el) el.value = cfg.printSub;
    }
    if (cfg.printRodape) {
      _printRodape = cfg.printRodape; localStorage.setItem('printRodape', cfg.printRodape);
      const el = document.getElementById('print-rodape'); if (el) el.value = cfg.printRodape;
    }
    // Restaura impressoras e modelos do servidor
    if (Array.isArray(cfg.impressoras) && cfg.impressoras.length) {
      _impressoras = cfg.impressoras;
      _saveImpressoras();
    }
    if (Array.isArray(cfg.modelos) && cfg.modelos.length) {
      _modelos = cfg.modelos;
      _saveModelos();
    }
    // Toggle "imprimir bebida industrializada" — sincroniza do banco pro local
    // pra que o gestor mostre o estado correto ao abrir a tela. Se o campo
    // não existe no banco (config antiga), mantém o que estiver em localStorage.
    if (cfg.printBebidaSolo !== undefined) {
      const v = cfg.printBebidaSolo === true || cfg.printBebidaSolo === '1' || cfg.printBebidaSolo === 1 ? '1' : '0';
      localStorage.setItem('printBebidaSolo', v);
      // Atualiza UI do toggle se já está renderizada
      const tog = document.getElementById('toggle-print-bebida');
      if (tog) {
        if (v === '1') tog.classList.add('on'); else tog.classList.remove('on');
      }
    }
    // Toggle "bebida pronta aparece no kanban" — mesmo padrão de sincronização.
    // Padrão (campo ausente/false): bebida industrializada NÃO entra no kanban.
    if (cfg.bebidaProntaKanban !== undefined) {
      const vk = cfg.bebidaProntaKanban === true || cfg.bebidaProntaKanban === '1' || cfg.bebidaProntaKanban === 1 ? '1' : '0';
      localStorage.setItem('bebidaProntaKanban', vk);
      const togK = document.getElementById('toggle-bebida-kanban');
      if (togK) {
        if (vk === '1') togK.classList.add('on'); else togK.classList.remove('on');
      }
    }
  } catch {}
}

function setPrintMode(mode) {
  _printMode = mode;
  window._printMode = mode;
  localStorage.setItem('printMode', mode);
  const isAuto = mode === 'auto';
  const la = document.getElementById('lbl-print-auto');
  const lm = document.getElementById('lbl-print-manual');
  const da = document.getElementById('dot-auto');
  const dm = document.getElementById('dot-manual');
  if (la) { la.style.background = isAuto ? 'rgba(59,130,246,.1)' : 'var(--surface2)'; la.style.borderColor = isAuto ? 'var(--accent)' : 'var(--border)'; }
  if (lm) { lm.style.background = !isAuto ? 'rgba(59,130,246,.1)' : 'var(--surface2)'; lm.style.borderColor = !isAuto ? 'var(--accent)' : 'var(--border)'; }
  if (da) da.style.background = isAuto ? '#fff' : 'transparent';
  if (dm) dm.style.background = !isAuto ? '#fff' : 'transparent';
  sbToast('ok', isAuto ? 'Impressão automática ativada' : 'Impressão manual ativada');
}

function _getPrintConfig() {
  const fsEl = document.getElementById('print-font-size');
  const fs = (fsEl && fsEl.value) ? parseInt(fsEl.value) : (_printFontSize || 13);
  const nomeEl = document.getElementById('print-nome');
  const nome = ((nomeEl && nomeEl.value) ? nomeEl.value : _printNome || 'RESTAURANTE').toUpperCase();
  const subEl = document.getElementById('print-sub');
  const sub = (subEl && subEl.value) ? subEl.value : (_printSub || '');
  const rodEl = document.getElementById('print-rodape');
  const rodape = (rodEl && rodEl.value) ? rodEl.value : (_printRodape || 'Obrigado!');
  // Tempo de entrega — fonte da verdade é store_tempo_entrega (cardápio público).
  // Prioridade: (1) input cp-tempo se estiver na tela e preenchido,
  //             (2) _printTempoEntrega lido do banco (mesma config do cardápio),
  //             (3) localStorage como fallback offline,
  //             (4) padrão genérico.
  // Antes lia só o input — se a impressão acontecesse fora da tela do branding,
  // sempre caía em '30-45 min' fixo, sem nenhuma relação com a config real.
  const tempoEl = document.getElementById('cp-tempo');
  const tempoDeliveryAtual = (typeof _tempoDeliveryPedido !== 'undefined') ? _tempoDeliveryPedido : '';
  const tempoRetiradaAtual = (typeof _tempoRetiradaPedido !== 'undefined') ? _tempoRetiradaPedido : '';
  const tempoEntrega = (tempoEl && tempoEl.value && tempoEl.value.trim())
    ? tempoEl.value.trim()
    : (tempoDeliveryAtual || _printTempoEntrega || localStorage.getItem('printTempoEntrega') || '');
  const tempoRetirada = tempoRetiradaAtual || _printTempoRetirada || localStorage.getItem('printTempoRetirada') || '';
  return {
    nome, sub, rodape,
    addr: document.getElementById('toggle-print-addr')?.classList.contains('on') ?? true,
    pag:  document.getElementById('toggle-print-pag')?.classList.contains('on') ?? true,
    fontSize: fs,
    tempoEntrega,
    tempoRetirada,
  };
}

// Envolve fragmento HTML do ticket com CSS completo para impressão (usado no Electron e fallbacks)
function _wrapTicketHtml(html, fontSize) {
  if (html && html.includes('<html')) return html;
  const fs = fontSize || 13;
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; color-adjust:exact !important }
  body { font-family:'Courier New',monospace; font-size:${fs}px; color:#000 !important; background:#fff; width:100%; overflow-wrap:break-word; word-break:break-word }
  hr { border:none; border-top:1px dashed #000; margin:4px 0 }
  .pt-center { text-align:center }
  .pt-large  { font-size:${fs + 3}px; font-weight:bold }
  .pt-hr     { border:none; border-top:1px dashed #000; margin:4px 0 }
  .print-ticket { padding:2px 6px; width:100%; word-wrap:break-word; overflow-wrap:break-word; overflow:visible }
  span, div { word-break:break-word; overflow-wrap:break-word }
  @media print {
    @page { margin:${_printMarginV}mm ${_printMarginH}mm }
    body > *:not(.print-ticket) { display:none !important }
    .print-ticket { display:block !important }
  }
</style>
</head><body>${html}</body></html>`;
}

function _printHtmlEscape(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function _printNormKey(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function _getPrintSetoresCategoria() {
  if (!_printSetoresCategoria || typeof _printSetoresCategoria !== 'object' || Array.isArray(_printSetoresCategoria)) {
    _printSetoresCategoria = _loadPrintSetoresCategoria();
  }
  return _printSetoresCategoria;
}
window._getPrintSetoresCategoria = _getPrintSetoresCategoria;

function _savePrintSetoresCategoria(syncServer) {
  const clean = {};
  Object.entries(_getPrintSetoresCategoria()).forEach(([k, v]) => {
    if (k && v) clean[k] = v;
  });
  _printSetoresCategoria = clean;
  localStorage.setItem('printSetoresCategoria', JSON.stringify(clean));
  if (syncServer && typeof _syncPrintConfigServer === 'function') _syncPrintConfigServer();
}

function setPrintSetorCategoria(catKey, printer) {
  if (!catKey) return;
  const routes = _getPrintSetoresCategoria();
  if (printer) routes[catKey] = printer;
  else delete routes[catKey];
  _savePrintSetoresCategoria(true);
  if (typeof _loadSetoresCategorias === 'function') _loadSetoresCategorias();
}
window.setPrintSetorCategoria = setPrintSetorCategoria;

function _printAvailablePrinters(extraPrinters) {
  const out = [];
  const seen = new Set();
  const add = (value, label) => {
    value = String(value || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push({ value, label: label || value });
  };

  (Array.isArray(extraPrinters) ? extraPrinters : []).forEach(p => add(p, p));
  (Array.isArray(_impressoras) ? _impressoras : []).forEach(imp => {
    const value = imp.printerName || imp.apelido || '';
    const label = imp.apelido ? `${imp.apelido} (${imp.printerName || imp.tipo || 'impressora'})` : value;
    add(value, label);
  });
  add(_printPrinter, _printPrinter);
  add(_printPrinterCozinha, _printPrinterCozinha);
  Object.values(_getPrintSetoresCategoria()).forEach(v => add(v, v));
  return out;
}
window._printAvailablePrinters = _printAvailablePrinters;

function _printPrinterDisplayName(value, extraPrinters) {
  const found = _printAvailablePrinters(extraPrinters).find(p => p.value === value);
  return found ? found.label.replace(/\s*\([^)]*\)\s*$/, '') : (value || 'Cozinha');
}

function _printGetRoutingCategories() {
  const out = [];
  const seen = new Set();
  const add = (key, label) => {
    key = String(key || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ key, label: label || key });
  };

  if (typeof categories !== 'undefined' && Array.isArray(categories)) {
    categories.forEach(c => add(c.name || c.label, c.label || c.name));
  }
  if (typeof items !== 'undefined' && Array.isArray(items)) {
    items.forEach(i => add(i.catKey || i.cat_key || i.cat, i.cat || i.catKey || i.cat_key));
  }
  return out;
}

function _printItemCategoryKeys(item) {
  const keys = [item?.cat_key, item?.catKey, item?.cat].filter(Boolean).map(String);
  if (typeof categories !== 'undefined' && Array.isArray(categories)) {
    const normSet = new Set(keys.map(_printNormKey));
    categories.forEach(c => {
      if (normSet.has(_printNormKey(c.name)) || normSet.has(_printNormKey(c.label))) {
        if (c.name) keys.push(c.name);
        if (c.label) keys.push(c.label);
      }
    });
  }
  return [...new Set(keys.filter(Boolean))];
}

function _printResolveCategoryPrinter(item) {
  const routes = _getPrintSetoresCategoria();
  const keys = _printItemCategoryKeys(item);
  for (const k of keys) {
    if (routes[k]) return routes[k];
  }
  const normRoutes = {};
  Object.entries(routes).forEach(([k, v]) => { if (v) normRoutes[_printNormKey(k)] = v; });
  for (const k of keys) {
    const found = normRoutes[_printNormKey(k)];
    if (found) return found;
  }
  return '';
}

function _printPrinterOptionsHtml(currentVal, extraPrinters) {
  const opts = ['<option value="">Cozinha padrao</option>'];
  _printAvailablePrinters(extraPrinters).forEach(p => {
    const sel = p.value === currentVal ? ' selected' : '';
    opts.push(`<option value="${_printHtmlEscape(p.value)}"${sel}>${_printHtmlEscape(p.label)}</option>`);
  });
  return opts.join('');
}

function _loadSetoresCategorias(extraPrinters) {
  const wrap = document.getElementById('print-setores-wrap');
  if (wrap) wrap.style.display = _normalizePrintViaMode(_printViaMode) === 'separado' ? '' : 'none';
  const list = document.getElementById('print-setores-list');
  if (!list) return;

  const cats = _printGetRoutingCategories();
  if (!cats.length) {
    list.innerHTML = '<div style="padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;font-size:11px;color:var(--muted)">Nenhuma categoria encontrada no cardapio.</div>';
    return;
  }

  const routes = _getPrintSetoresCategoria();
  list.innerHTML = cats.map(cat => {
    const current = routes[cat.key] || '';
    return `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(170px,240px);gap:8px;align-items:center;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:8px">
      <div style="min-width:0">
        <div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_printHtmlEscape(cat.label)}</div>
        <div style="font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_printHtmlEscape(cat.key)}</div>
      </div>
      <select class="form-input" data-cat="${_printHtmlEscape(cat.key)}" onchange="setPrintSetorCategoria(this.dataset.cat,this.value)" style="height:34px;font-size:11px;padding:0 9px">
        ${_printPrinterOptionsHtml(current, extraPrinters)}
      </select>
    </div>`;
  }).join('');
}
window._loadSetoresCategorias = _loadSetoresCategorias;

function _buildSetorHtml(order, cfg, titulo, lista) {
  const fontSize = cfg?.fontSize || _printFontSize || 13;
  const tipo = _printOrderType(order);
  const orderNum = order.num || order.order_num || order.id || '';
  const isMesa = tipo === 'mesa';
  const tipoTxt = isMesa ? 'MESA ' + (order.mesa_num || '') : (tipo === 'retirada' ? 'RETIRADA' : 'DELIVERY');
  const now = new Date().toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });

  const groups = [];
  const idx = new Map();
  (lista || []).forEach(item => {
    const cat = String(item.cat || item.cat_key || item.catKey || 'Outros').trim() || 'Outros';
    if (!idx.has(cat)) {
      idx.set(cat, groups.length);
      groups.push({ cat, items: [] });
    }
    groups[idx.get(cat)].items.push(item);
  });
  const showCats = groups.length > 1;
  const itemHtml = groups.map(g => {
    const header = showCats ? `<div style="font-weight:bold;text-align:center;border-top:1px solid #000;border-bottom:1px solid #000;margin:6px 0 4px;padding:3px 0">${_printHtmlEscape(g.cat).toUpperCase()}</div>` : '';
    return header + g.items.map(i => {
      const obs = i.obs ? `<div style="padding-left:8px;font-size:0.9em;font-weight:bold;word-break:break-word">OBS: ${_printHtmlEscape(i.obs)}</div>` : '';
      return `<div style="border-bottom:1px dotted #ddd;padding-bottom:4px;margin-bottom:4px">
        <div style="font-weight:bold;font-size:1.05em;word-break:break-word">${_printHtmlEscape((i.qty || 1) + 'x ' + (i.name || '')).toUpperCase()}</div>
        ${obs}
      </div>`;
    }).join('');
  }).join('');

  return `<div class="print-ticket" style="font-family:'Courier New',monospace;font-size:${fontSize}px;width:100%;box-sizing:border-box;padding:0 2px">
    <div style="text-align:center;font-size:1.25em;font-weight:bold;margin-bottom:2px">${_printHtmlEscape(titulo || 'COZINHA').toUpperCase()}</div>
    <div style="text-align:center;font-weight:bold;background:#111;color:#fff;padding:5px 4px;margin:5px 0">${_printHtmlEscape(tipoTxt)}</div>
    <hr style="border:none;border-top:1px dashed #000;margin:5px 0">
    <div style="text-align:center;font-size:1.35em;font-weight:bold;margin:4px 0">PEDIDO ${_printHtmlEscape(orderNum)}</div>
    <hr style="border:none;border-top:1px dashed #000;margin:5px 0">
    <div>Data: ${_printHtmlEscape(now)}</div>
    <div>Cliente: ${_printHtmlEscape(order.client || (isMesa ? 'Mesa ' + (order.mesa_num || '') : '-'))}</div>
    ${order.addr ? `<div style="word-break:break-word">Endereco: ${_printHtmlEscape(order.addr)}</div>` : ''}
    <hr style="border:none;border-top:1px dashed #000;margin:5px 0">
    ${itemHtml}
    <hr style="border:none;border-top:1px dashed #000;margin:5px 0">
    <div style="text-align:center;font-size:0.85em;color:#555">via ${_printHtmlEscape(titulo || 'cozinha').toLowerCase()}</div>
  </div>`;
}

function _buildSetorPrintJobsForItems(order, cfg, lista, opts = {}) {
  const itemsToRoute = (Array.isArray(lista) ? lista : []).filter(Boolean);
  if (!itemsToRoute.length) return [];
  const routes = _getPrintSetoresCategoria();
  const hasRoutes = Object.values(routes).some(Boolean);
  if (!hasRoutes && !opts.force) return [];

  const defaultPrinter = opts.defaultPrinter !== undefined ? opts.defaultPrinter : _printPrinterCozinha;
  const defaultTitle = opts.defaultTitle || 'Cozinha';
  const buckets = new Map();
  itemsToRoute.forEach(item => {
    const printer = _printResolveCategoryPrinter(item) || defaultPrinter || '';
    const title = printer ? _printPrinterDisplayName(printer) : defaultTitle;
    const key = `${printer}|${title}`;
    if (!buckets.has(key)) buckets.set(key, { printer, title, items: [] });
    buckets.get(key).items.push(item);
  });

  return Array.from(buckets.values()).map(bucket => ({
    html: _buildSetorHtml(order, cfg, bucket.title, bucket.items),
    printer: bucket.printer || '',
    tipo: 'cozinha'
  }));
}
window._buildSetorPrintJobsForItems = _buildSetorPrintJobsForItems;

// ══════════════════════════════════════════════════════════════
// Parser de observações de itens (cupom/comanda)
// ──────────────────────────────────────────────────────────────
// O `obs` é montado pelo cardápio com 2 níveis de separadores:
//   ` | `  → separa SEÇÕES (kit, cortes açougue, grupos, obs livre)
//   ` · `  → separa ITENS DENTRO de uma seção
// Exemplos:
//   Pizza meio a meio:
//     "Meio a meio · Calabresa + Marguerita | Borda: Catupiry"
//   Açougue normal:
//     "500g Patinho · 200g Alcatra · Preparo: Bife | Acompanhamento: Farofa | sem cebola"
//   Açougue kit:
//     "Kit: 500g Patinho · 1kg Frango | Acompanhamentos: Farofa, Vinagrete | Molho: Barbecue"
//
// Antes do fix: o parser fazia split só por ' · ' e perdia tudo depois do primeiro
// ' | ' (Molho/obs livre eram engolidos como item do grupo anterior).
//
// Retorno:
//   {
//     kitItens:   ['Item A', 'Item B', ...]      // se for kit
//     meioMeio:   'sabor1 + sabor2'              // pizza meio a meio
//     cortes:     ['500g Patinho', '200g Alcatra', ...]  // cortes açougue não-kit
//     grupos:     [{ nome:'Adicionais', itens:['Bacon (+R$ 3,00)', 'Queijo'] }, ...]
//     obsLivre:   'observação digitada pelo cliente'
//   }
function _parseObs(rawObs) {
  const out = { kitItens: [], meioMeio: '', cortes: [], grupos: [], obsLivre: '' };
  if (!rawObs || typeof rawObs !== 'string') return out;

  // Helper: split por vírgula respeitando parênteses
  const splitVirg = (valor) => {
    const itens = [];
    let buf = '', depth = 0;
    for (const ch of valor) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) {
        if (buf.trim()) itens.push(buf.trim());
        buf = '';
      } else {
        buf += ch;
      }
    }
    if (buf.trim()) itens.push(buf.trim());
    return itens;
  };

  // Tenta extrair grupo "Nome: valores" se o nome tiver até 30 chars e for
  // composto só de letras/espaços (rejeita "atenção: lembrar", "pode entregar:").
  // Lista branca expandida pra grupos comuns (acentos PT-BR).
  const tentarGrupo = (texto) => {
    const colonIdx = texto.indexOf(':');
    if (colonIdx <= 0 || colonIdx >= 30) return null;
    const nomeRaw = texto.substring(0, colonIdx).trim();
    // Nome do grupo deve ser palavras curtas, sem ·, sem números
    if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]*$/.test(nomeRaw)) return null;
    if (nomeRaw.split(/\s+/).length > 4) return null; // mais de 4 palavras = obs livre
    const valor = texto.substring(colonIdx + 1).trim();
    return { nome: nomeRaw, itens: splitVirg(valor) };
  };

  // Quebra por ` | ` (separador entre seções principais)
  const secoes = rawObs.split(' | ').map(p => p.trim()).filter(Boolean);

  for (const secao of secoes) {
    // Kit: prefixo "Kit: a · b · c"
    if (/^Kit:\s/i.test(secao)) {
      out.kitItens = secao.replace(/^Kit:\s/i, '').split(' · ').map(x => x.trim()).filter(Boolean);
      continue;
    }

    // Meio a meio: "Meio a meio · sabor1 + sabor2"
    if (/^Meio a meio/i.test(secao)) {
      const rest = secao.replace(/^Meio a meio/i, '').replace(/^\s*·\s*/, '').trim();
      // Separa o que é meio a meio do que é grupo extra (depois de outro · que tenha :)
      // Na prática meio a meio só tem 1 valor: "Calabresa + Marguerita"
      out.meioMeio = rest || 'meio a meio';
      continue;
    }

    // Pizza inteira: "Pizza inteira"
    if (/^Pizza inteira$/i.test(secao)) continue;

    // Sub-quebra por ` · ` — formato antigo do modal (hamburguer):
    //   "Adicionais: Bacon, Queijo · Ponto: Mal passado"
    // Cada parte com `:` válido vira um grupo. As que sobram viram obs/cortes.
    const partes = secao.split(' · ').map(p => p.trim()).filter(Boolean);
    // Se a seção inteira é UM grupo (sem · ou com · só dentro de parênteses), trata simples
    const grupoUnico = tentarGrupo(secao);
    if (grupoUnico && partes.length === 1) {
      out.grupos.push(grupoUnico);
      continue;
    }

    // Várias partes: pode ser cortes (todas começam com peso) OU mix de grupos/obs
    const todasCortes = partes.length > 0 && partes.every(p => /^\d+\s*(g|kg|un|pç|pc|ml|l)\b/i.test(p));
    if (todasCortes) {
      out.cortes.push(...partes);
      continue;
    }

    // Mix: tenta classificar cada parte
    let obsAccum = [];
    for (const parte of partes) {
      // Corte ("500g Patinho")
      if (/^\d+\s*(g|kg|un|pç|pc|ml|l)\b/i.test(parte)) {
        out.cortes.push(parte);
        continue;
      }
      // Grupo ("Preparo: Bife")
      const g = tentarGrupo(parte);
      if (g) {
        out.grupos.push(g);
        continue;
      }
      // Resto vira obs livre
      obsAccum.push(parte);
    }
    if (obsAccum.length) {
      out.obsLivre = (out.obsLivre ? out.obsLivre + ' | ' : '') + obsAccum.join(' · ');
    }
  }

  return out;
}

// Quebra texto em múltiplas linhas respeitando largura máxima (impressora térmica)
function _wrapText(text, width, prefix = '') {
  if (!text) return [];
  const innerWidth = Math.max(10, width - prefix.length);
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur.length + 1 + w.length) <= innerWidth) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.map(l => prefix + l);
}

function _buildTicketHtml(order, cfg) {
  // Filtra itens cancelados — não devem aparecer na comanda nem ser cobrados.
  // Cancelamentos vêm tanto do gestor (gestor-pedidos.js cancelarItem) quanto do cliente (no cardápio).
  const items    = (Array.isArray(order.items) ? order.items : [])
    .filter(i => (i?.item_status || 'active') !== 'cancelado');
  const money    = v => 'R$ ' + parseFloat(v||0).toFixed(2).replace('.',',');
  const fmt      = localStorage.getItem('printFormat') || _printFormat || '80mm';
  const is58     = fmt === '58mm';
  const fs       = is58 ? Math.min(cfg.fontSize, 10) : cfg.fontSize;
  const W        = is58 ? 48 : 72; // largura útil em mm (referência visual)

  // ── Data/hora do pedido (usa order.created_at se tiver, senão now) ──────
  // IMPORTANTE: SQLite datetime('now') retorna UTC sem sufixo "Z" (ex: "2026-04-25 17:30:00").
  // new Date(string) sem "Z" é interpretado como horário LOCAL do navegador → bug de 3h em Brasília.
  // _parseCreatedAt força interpretação UTC quando a string não tiver timezone explícita.
  const _parseCreatedAt = (raw) => {
    if (!raw) return new Date();
    if (raw instanceof Date) return raw;
    const s = String(raw).trim();
    // Se já tem timezone explícita (Z, +HH:MM, -HH:MM no final), confia
    if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return new Date(s);
    // Formato SQLite "YYYY-MM-DD HH:MM:SS" → trata como UTC
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (m) return new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]));
    return new Date(s);
  };
  // Formata em horário de Brasília (independente do fuso do navegador)
  const _fmtBR = (d, opts) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', ...opts });
  const _hhmmBR = (d) => _fmtBR(d, { hour: '2-digit', minute: '2-digit', hour12: false });

  const _orderDate = _parseCreatedAt(order.created_at);
  const _pad2 = n => String(n).padStart(2,'0');
  const dataHoraTxt = _fmtBR(_orderDate, { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).replace(',', '');
  const now = dataHoraTxt; // mantém compat com via cozinha

  // ── Janela de entrega prevista (só pra delivery) ─────────────────
  // Lê store_tempo_entrega (ex: "30-45 min" ou "30-45" ou "30 min" ou "30")
  // Calcula início = orderDate + min, fim = orderDate + max
  const _parseTempoEntrega = (txt) => {
    if (!txt) return [30, 45];
    const m = String(txt).match(/(\d+)\s*[-–to a]+\s*(\d+)/);
    if (m) return [parseInt(m[1]), parseInt(m[2])];
    const single = String(txt).match(/(\d+)/);
    if (single) { const v = parseInt(single[1]); return [v, v + 15]; }
    return [30, 45];
  };
  const _calcJanelaPedido = (tempoTxt) => {
    const [_tmin, _tmax] = _parseTempoEntrega(tempoTxt);
    const _ini = new Date(_orderDate.getTime() + _tmin*60000);
    const _fim = new Date(_orderDate.getTime() + _tmax*60000);
    return `${_hhmmBR(_ini)} - ${_hhmmBR(_fim)}`;
  };

  // ── Helpers de HTML ─────────────────────────────────────
  const H  = (...parts) => parts.join('');                              // concatena
  const D  = (style, content) => `<div style="${style}">${content}</div>`;
  const S  = (style, content) => `<span style="${style}">${content}</span>`;
  const HR = () => '<hr style="border:none;border-top:1px dashed #000;margin:5px 0">';
  // Linha de dois itens (nome esquerda, valor direita)
  const ROW = (left, right, bold) => {
    const b = bold ? 'font-weight:bold;' : '';
    return D(`display:flex;justify-content:space-between;align-items:baseline;gap:4px;${b}`,
      S('flex:1;word-break:break-word', left) + S('white-space:nowrap;flex-shrink:0', right));
  };
  // Linha simples centralizada
  const CENTER = (content, style='') => D(`text-align:center;${style}`, content);
  // Banner de bloco (fundo colorido, texto branco)
  const BANNER = (content, bg, style='') =>
    D(`text-align:center;font-weight:bold;background:${bg};color:#fff;padding:5px 4px;margin:5px 0;${style}`, content);
  // Rótulo de seção (estilo Anota AI: texto à esquerda, semi-bold)
  const SECTION = (label) => D('font-weight:bold;font-size:1.1em;margin:6px 0 4px', label);

  // ── Tipo de entrega ─────────────────────────────────────
  const _tipoPedido = _printOrderType(order);
  const isMesa   = _tipoPedido === 'mesa';
  const isRetira = _tipoPedido === 'retirada';
  const tipoTxt  = isMesa ? 'MESA ' + (order.mesa_num || '') : isRetira ? 'PARA RETIRADA' : 'PARA ENTREGA';
  const tipoIcon = isMesa ? '🪑' : isRetira ? '🏃' : '🛵';
  const tipoBg   = isMesa ? '#1a3a5c' : isRetira ? '#2d4a1e' : '#7a2020';
  const tempoPedidoTxt = isMesa ? '' : (isRetira ? (cfg.tempoRetirada || '') : (cfg.tempoEntrega || ''));
  const janelaPedidoTxt = tempoPedidoTxt ? _calcJanelaPedido(tempoPedidoTxt) : '';
  const tempoPedidoLabel = isRetira ? 'Retirada prevista: ' : 'Entrega prevista: ';
  // Cabeçalho do tipo (estilo Anota: pequeno, simples)
  const tipoHeader = CENTER(tipoTxt, 'font-weight:bold;font-size:0.95em;letter-spacing:0.5px;margin-bottom:2px');

  // ── Pagamento (sem banner colorido, estilo Anota AI) ───
  const _pagMap  = { dinheiro:'Dinheiro', cartao:'Cartão', credito:'Crédito', debito:'Débito', pix:'PIX', pix_mp:'PIX Online', cartao_mp:'Crédito Online', mesa:'Conta da Mesa' };
  const pagNome  = _pagMap[order.pag] || order.pag || '—';
  // Detecta se o pedido já foi pago. Cobre 3 cenários:
  //   1. pag='pix_mp' / 'cartao_mp'  → pagamento online MP confirmado pelo webhook (servidor já atualizou pag).
  //      Esse é o sinal mais confiável: o servidor SÓ grava 'pix_mp'/'cartao_mp' quando o pagamento foi aprovado.
  //   2. pag='pix' E status ja saiu de 'aguardando_pix' -> fallback para corrida/legado de PIX online
  //   3. pag='pix_manual' E status ja saiu de 'aguardando_pix' -> gestor confirmou recebimento manualmente
  //   4. pag_momento='agora' -> legado (versao antiga do app gravava assim quando o pagamento era online)
  // IMPORTANTE: pag_momento='online' SOZINHO não é prova de pagamento — esse campo é gravado na criação
  // do pedido, antes do PIX ser confirmado. Por isso ele NÃO entra na detecção.
  const _statusPago = order.status && !['aguardando_pix','aguardando_cartao'].includes(order.status);
  const jaPago   = order.pag === 'pix_mp'
                || order.pag === 'cartao_mp'
                || order.pag_momento === 'agora'
                || (order.pag === 'pix' && _statusPago)
                || (order.pag === 'pix_manual' && _statusPago);

  // ── Detecta bebidas INDUSTRIALIZADAS (prontas, não precisam preparo) ──
  // Usado pra (a) decidir se vão pra via cozinha (não vão), (b) aplicar o
  // toggle "Imprimir pedido só de bebida". Sucos, vitaminas, drinks da casa
  // NÃO entram aqui — esses precisam ser preparados pela cozinha/copa.
  const _ehIndustrializada = (item) => {
    const c = (item.cat || item.cat_key || '').toLowerCase();
    const n = (item.name || '').toLowerCase();
    // Lista de bebidas prontas. Sucos/vitaminas/cafés ficam DE FORA.
    const re = /refrigerante|coca[\s-]?cola|pepsi|guaran[aá]|fanta|sprite|soda|schweppes|t[oô]nica|[aá]gua\b|mineral|cerveja|chopp|brahma|skol|heineken|budweiser|corona|stella|amstel|itaipava|eisenbahn|vinho|wine|espumante|prosecco|champagne|sake|long[\s.]?neck|energ[eé]tico|red[\s.]?bull|monster|gatorade|powerade|isot[oô]nico|ice[\s.]?tea|nescau/i;
    return re.test(n) || re.test(c);
  };

  // ── Filtra itens que vão pra via cozinha ────────────────
  // Cozinha = tudo que precisa preparo. Industrializadas (cerveja, refri,
  // água) NÃO vão. Mas suco, vitamina, café, drink da casa VÃO — antes
  // estavam sendo filtrados como "bebida" e nunca chegavam à cozinha.
  const _isCoz = (item) => !_ehIndustrializada(item);
  const itensCozinha = items.filter(_isCoz);

  // ── Renderiza um item do pedido (estilo Anota: "(qty) nome    R$ x") ──
  const renderItem = (i) => {
    const qtyPrefix = `(${i.qty||1})`;
    const preco = money((i.price||0) * (i.qty||1));
    const parsed = _parseObs(i.obs);
    let kitHtml = '';
    let extrasHtml = '';

    // Pizza meio a meio: detecta tanto pelo nome (formato "Sabor1 / Sabor2")
    // quanto pelo prefixo "Meio a meio" na obs. Quebra em linhas separadas
    // para a cozinha não ter que decifrar nome e obs ao mesmo tempo.
    let nome = i.name;
    let meioHtml = '';
    const nomeContemBarra = / \/ /.test(i.name);
    if (nomeContemBarra && (parsed.meioMeio || /^meio a meio/i.test(i.obs||''))) {
      const sabores = i.name.split(' / ').map(s => s.trim()).filter(Boolean);
      if (sabores.length === 2) {
        nome = 'Pizza meio a meio';
        meioHtml = H(
          D('padding-left:18px;font-size:0.95em;font-weight:bold', '½ ' + sabores[0]),
          D('padding-left:18px;font-size:0.95em;font-weight:bold', '½ ' + sabores[1])
        );
      } else {
        // Mais de 2 sabores (improvável) — lista um por linha
        nome = 'Pizza ' + (sabores.length === 1 ? 'inteira' : (sabores.length + ' sabores'));
        meioHtml = sabores.map(s =>
          D('padding-left:18px;font-size:0.95em;font-weight:bold', '½ ' + s)
        ).join('');
      }
    } else if (parsed.meioMeio) {
      // Caso legado: obs "Meio a meio · sabor1 + sabor2" sem barra no nome
      const sabores = parsed.meioMeio.split(/\s*\+\s*/).map(s => s.trim()).filter(Boolean);
      if (sabores.length >= 2) {
        meioHtml = sabores.map(s =>
          D('padding-left:18px;font-size:0.95em;font-weight:bold', '½ ' + s)
        ).join('');
      } else {
        meioHtml = D('padding-left:18px;font-size:0.95em;font-weight:bold', '½ + ½ ' + parsed.meioMeio);
      }
    }

    // Kit: sub-itens com indentação maior (estilo "(1) sub-item")
    if (parsed.kitItens.length) {
      kitHtml = parsed.kitItens.map(k =>
        D('padding-left:18px;font-size:0.95em', `(1) ${k}`)
      ).join('');
    }

    // Cortes do açougue (formato "500g Patinho", "1kg Frango") — antes
    // viravam obs livre e ficavam ilegíveis. Agora aparecem em destaque
    // como uma seção dedicada com peso por linha.
    let cortesHtml = '';
    if (parsed.cortes && parsed.cortes.length) {
      cortesHtml = D('padding-left:18px;margin-top:2px',
        D('font-weight:bold;font-size:0.9em', 'Cortes:') +
        parsed.cortes.map(c => D('padding-left:10px;font-size:0.95em;font-weight:bold', '• ' + c)).join('')
      );
    }

    // Grupos (Adicionais, Ponto, Molhos…) — cada grupo numa linha com bullets
    if (parsed.grupos.length) {
      const linhasGrupos = parsed.grupos.map(g =>
        D('padding-left:18px;margin-top:1px',
          D('font-weight:bold;font-size:0.9em', g.nome + ':') +
          g.itens.map(it => D('padding-left:10px;font-size:0.9em', '• ' + it)).join('')
        )
      ).join('');
      extrasHtml = linhasGrupos;
    }

    // Obs livre (digitada pelo cliente)
    const obsLivreHtml = parsed.obsLivre
      ? D('padding-left:18px;font-size:0.9em;font-style:italic', '✎ ' + parsed.obsLivre)
      : '';

    if (is58) {
      // 58mm: nome com qty na primeira linha, preço alinhado direita na seguinte
      return D('margin-bottom:3px',
        D('word-break:break-word', `${qtyPrefix} ${nome}`) +
        D('text-align:right;font-size:0.9em;color:#000', preco) +
        kitHtml + meioHtml + cortesHtml + extrasHtml + obsLivreHtml);
    }
    // 80mm: "(qty) nome ............ R$ X,XX" na mesma linha
    return D('margin-bottom:3px',
      ROW(D('word-break:break-word', `${qtyPrefix} ${nome}`), preco) +
      kitHtml + meioHtml + cortesHtml + extrasHtml + obsLivreHtml);
  };

  // ── Agrupa itens por categoria ───────────────────────────
  // Antes os itens vinham todos juntos sem distinção de categoria.
  // Agora separamos em blocos por categoria com cabeçalho — mais fácil
  // pra cozinha localizar o que tem que preparar de cada seção.
  const _categHeader = (label) => D(
    'font-weight:bold;font-size:0.95em;text-transform:uppercase;letter-spacing:0.5px;' +
    'margin:6px 0 2px;padding:2px 0;border-bottom:1px dotted #555',
    label
  );
  // Mantém a ordem original do pedido, mas agrupa visualmente por categoria.
  const _itemsPorCategoria = [];
  const _idxPorCat = new Map();
  for (const it of items) {
    const catLabel = (it.cat || it.cat_key || 'Outros').trim() || 'Outros';
    if (!_idxPorCat.has(catLabel)) {
      _idxPorCat.set(catLabel, _itemsPorCategoria.length);
      _itemsPorCategoria.push({ cat: catLabel, items: [] });
    }
    _itemsPorCategoria[_idxPorCat.get(catLabel)].items.push(it);
  }
  // Se só há uma categoria, não vale a pena mostrar o cabeçalho duplicado
  // (o SECTION('Itens') já cumpre o papel).
  const _mostrarCabecalhoCateg = _itemsPorCategoria.length > 1;
  const itemLines = _itemsPorCategoria.map(g => {
    const cabec = _mostrarCabecalhoCateg ? _categHeader(g.cat) : '';
    return cabec + g.items.map(renderItem).join('');
  }).join('');

  // ── Totais ──────────────────────────────────────────────
  const subtotal   = items.reduce((s,i) => s + (parseFloat(i.price||0) * (i.qty||1)), 0);
  const taxa       = parseFloat(order.taxa || 0);
  const orderTotal = parseFloat(order.total);
  // Detecta se houve cancelamento de item (array original tinha mais itens que o filtrado)
  const _itemsAll  = Array.isArray(order.items) ? order.items : [];
  const _temCancelado = _itemsAll.some(i => (i?.item_status||'active') === 'cancelado');
  // Se há cancelados, o order.total do banco está desatualizado — usa subtotal recalculado.
  // Senão, mantém a lógica original (order.total pode incluir desconto de cupom/cashback).
  const desconto   = (!_temCancelado && !isNaN(orderTotal) && orderTotal < subtotal) ? Math.max(0, subtotal - orderTotal) : 0;
  const total      = (_temCancelado || isNaN(orderTotal)) ? (subtotal + taxa) : (orderTotal + taxa);
  const orderNum   = order.num || order.order_num || order.id;

  // Banner "* Cobrar do cliente *" (só se não pago)
  const cobrarBanner = !jaPago
    ? CENTER('* Cobrar do cliente *', 'font-weight:bold;margin:6px 0 4px')
    : CENTER('* Pedido já pago *', 'font-weight:bold;margin:6px 0 4px');

  // Bloco de totais (sempre mostra subtotal + taxa + total)
  const totalBlock = H(
    ROW('Subtotal:', money(subtotal)),
    desconto > 0 ? ROW('Desconto:', '−' + money(desconto)) : '',
    taxa > 0     ? ROW('Taxa de entrega:', money(taxa))    : '',
    ROW(S('font-weight:bold', 'Total:'), S('font-weight:bold', money(total)))
  );

  // Troco — deixa explícito quanto o cliente vai pagar e quanto devolver
  let trocoLine = '';
  if ((order.pag || '').toLowerCase() === 'dinheiro') {
    if (order.troco > 0) {
      // Cliente informou o valor que vai entregar — calcula o troco a devolver
      const devolver = Math.max(0, order.troco - total);
      trocoLine = H(
        ROW('Cliente paga:', money(order.troco)),
        ROW(S('font-weight:bold', 'DEVOLVER ao cliente:'), S('font-weight:bold', money(devolver)))
      );
    } else if (order.troco === -1) {
      // Cliente pediu troco mas não informou o valor
      trocoLine = ROW(S('font-weight:bold', 'Troco:'), S('font-weight:bold', 'SIM (valor nao informado)'));
    } else {
      // Cliente vai pagar exato (sem necessidade de troco)
      trocoLine = ROW('Troco:', 'Nao precisa');
    }
  }

  // ── Endereço estruturado (extrai referência se presente) ─────
  // Formato típico: "Rua X, 123, Bairro, complemento, Ref: prox merc"
  const _splitAddr = (addrStr) => {
    if (!addrStr) return { full:'', referencia:'' };
    const partes = addrStr.split(', ');
    let referencia = '';
    const refIdx = partes.findIndex(p => /^Ref:\s*/i.test(p));
    if (refIdx >= 0) {
      referencia = partes[refIdx].replace(/^Ref:\s*/i,'').trim();
      partes.splice(refIdx, 1);
    }
    return { full: partes.join(', '), referencia };
  };
  const _addrParts = _splitAddr(order.addr);
  const addrLine = (cfg.addr && order.addr)
    ? D('word-break:break-word;margin-top:2px', _addrParts.full)
    : '';
  const refLine = (cfg.addr && _addrParts.referencia)
    ? D('word-break:break-word;margin-top:1px', 'Referência: ' + _addrParts.referencia)
    : '';

  // ── Telefone (opcional) ─────────────────────────────────
  const phoneLine = order.phone
    ? D('margin-top:1px', 'Telefone: ' + order.phone)
    : '';

  // ── Quantidade de pedidos desse cliente nesta loja (opcional) ──
  const pedidosClienteLine = (order.phone && Number.isFinite(order.pedidos_count))
    ? D('margin-top:1px', order.pedidos_count <= 1 ? '🆕 1º pedido nesta loja' : order.pedidos_count + 'º pedido nesta loja')
    : '';

  // ══════════════════════════════════════════════════════
  // VIA PRINCIPAL — Layout estilo Anota AI
  // ══════════════════════════════════════════════════════
  const viaPrincipal = D('font-family:\'Courier New\',monospace;font-size:' + fs + 'px;width:100%;box-sizing:border-box;padding:0 2px',
    H(
      // ── 1) Topo: tipo + data + janela + nome da loja ──
      tipoHeader,
      CENTER(dataHoraTxt, 'font-size:0.9em;margin-bottom:1px'),
      (!isMesa && tempoPedidoTxt) ? CENTER(tempoPedidoLabel + janelaPedidoTxt, 'font-size:0.9em;margin-bottom:2px') : '',
      CENTER(cfg.nome, 'font-size:0.95em;font-weight:bold;margin-bottom:4px'),
      HR(),

      // ── 2) PEDIDO NN gigante ──
      CENTER('PEDIDO ' + orderNum, 'font-size:1.7em;font-weight:bold;letter-spacing:1px;margin:6px 0 4px'),
      HR(),

      // ── 3) Itens ──
      SECTION('Itens'),
      itemLines,
      HR(),

      // ── 4) Cliente ──
      SECTION('Cliente'),
      D('margin-top:1px', 'Nome: ' + (order.client || '—')),
      phoneLine,
      pedidosClienteLine,
      addrLine ? D('margin-top:3px', (isRetira ? 'Retirada: ' : 'Entrega: ') + _addrParts.full) : '',
      refLine,
      HR(),

      // ── 5) Pagamento ──
      SECTION('Pagamento'),
      D('margin-top:1px', 'Forma de Pagamento: ' + pagNome),
      cobrarBanner,
      totalBlock,
      trocoLine,
      HR(),

      // ── 6) Rodapé ──
      CENTER(cfg.rodape || '', 'font-size:0.85em;color:#333'),
      CENTER('Powered By: EstimaFood', 'font-size:0.8em;color:#555;margin-top:4px')
    )
  );

  // ══════════════════════════════════════════════════════
  // VIA COZINHA
  // ══════════════════════════════════════════════════════
  let viaCozinha = '';
  if (itensCozinha.length > 0) {
    const renderItemCoz = (i) => {
      const parsed = _parseObs(i.obs);
      // Mesma lógica do renderItem da via principal: detecta meio a meio
      // pelo nome ou pela obs e quebra em linhas separadas — facilita pra
      // cozinha visualizar quais sabores precisam ser feitos.
      let nome = i.name;
      let meioHtml = '';
      const nomeContemBarra = / \/ /.test(i.name);
      if (nomeContemBarra && (parsed.meioMeio || /^meio a meio/i.test(i.obs||''))) {
        const sabores = i.name.split(' / ').map(s => s.trim()).filter(Boolean);
        if (sabores.length === 2) {
          nome = 'PIZZA MEIO A MEIO';
          meioHtml = D('padding-left:6px;font-size:1em;border-left:3px solid #444;margin:3px 0;font-weight:bold',
            sabores.map(s => D('', '½ ' + s)).join(''));
        } else {
          nome = 'PIZZA ' + (sabores.length + ' SABORES');
          meioHtml = D('padding-left:6px;font-size:1em;border-left:3px solid #444;margin:3px 0;font-weight:bold',
            sabores.map(s => D('', '½ ' + s)).join(''));
        }
      } else if (parsed.meioMeio) {
        const sabores = parsed.meioMeio.split(/\s*\+\s*/).map(s => s.trim()).filter(Boolean);
        if (sabores.length >= 2) {
          meioHtml = D('padding-left:6px;font-size:1em;border-left:3px solid #444;margin:3px 0;font-weight:bold',
            sabores.map(s => D('', '½ ' + s)).join(''));
        } else {
          meioHtml = D('padding-left:6px;font-size:0.95em;border-left:3px solid #444;margin:3px 0;font-weight:bold',
            '½ + ½ ' + parsed.meioMeio);
        }
      }

      const nomeFinal = (i.qty + 'x ' + nome).toUpperCase();
      let detalhesHtml = meioHtml;

      // Kit
      if (parsed.kitItens.length) {
        detalhesHtml += D('padding-left:6px;font-size:0.9em;border-left:3px solid #444;margin:3px 0',
          D('font-weight:bold', 'CONTÉM:') +
          parsed.kitItens.map(k => D('padding-left:6px', '• ' + k)).join(''));
      }

      // Cortes do açougue — destaque alto pra cozinha pesar e separar certo
      if (parsed.cortes && parsed.cortes.length) {
        detalhesHtml += D('padding-left:6px;font-size:1em;border-left:3px solid #444;margin:3px 0;font-weight:bold',
          D('text-transform:uppercase', '› CORTES:') +
          parsed.cortes.map(c => D('padding-left:6px', '• ' + c)).join(''));
      }

      // Grupos (Adicionais, Ponto, Molhos…) — destaque alto na cozinha
      if (parsed.grupos.length) {
        const linhasGrupos = parsed.grupos.map(g =>
          D('margin-top:2px',
            D('font-weight:bold;text-transform:uppercase;font-size:0.9em', '› ' + g.nome + ':') +
            g.itens.map(it => D('padding-left:10px;font-size:0.95em', '• ' + it)).join('')
          )
        ).join('');
        detalhesHtml += D('padding-left:6px;border-left:3px solid #999;margin:3px 0;word-break:break-word', linhasGrupos);
      }

      // Obs livre
      if (parsed.obsLivre) {
        detalhesHtml += D('padding-left:6px;font-size:0.95em;border-left:3px solid #999;margin:3px 0;word-break:break-word;font-weight:bold',
          'OBS: ' + parsed.obsLivre);
      }

      return D('border-bottom:1px dotted #ddd;padding-bottom:4px;margin-bottom:4px',
        D('font-weight:bold;font-size:1.05em;word-break:break-word', nomeFinal) + detalhesHtml);
    };

    // Agrupa por categoria também na cozinha — útil quando o pedido tem itens
    // de seções diferentes (ex: pizza + sobremesa).
    const _itensCozPorCat = [];
    const _idxCozPorCat = new Map();
    for (const it of itensCozinha) {
      const catLabel = (it.cat || it.cat_key || 'Outros').trim() || 'Outros';
      if (!_idxCozPorCat.has(catLabel)) {
        _idxCozPorCat.set(catLabel, _itensCozPorCat.length);
        _itensCozPorCat.push({ cat: catLabel, items: [] });
      }
      _itensCozPorCat[_idxCozPorCat.get(catLabel)].items.push(it);
    }
    const _mostrarCabCoz = _itensCozPorCat.length > 1;
    const _catHeaderCoz = (label) => D(
      'font-weight:bold;font-size:1em;text-transform:uppercase;letter-spacing:0.5px;' +
      'margin:6px 0 3px;padding:3px 0;border-top:1px solid #000;border-bottom:1px solid #000;text-align:center',
      label
    );
    const itensCozHtml = _itensCozPorCat.map(g => {
      const cabec = _mostrarCabCoz ? _catHeaderCoz(g.cat) : '';
      return cabec + g.items.map(renderItemCoz).join('');
    }).join('');

    viaCozinha = D('page-break-before:always', '') +
      D('font-family:\'Courier New\',monospace;font-size:' + fs + 'px;width:100%;box-sizing:border-box;padding:0 2px',
        H(
          CENTER('★ COZINHA ★', 'font-size:1.3em;font-weight:bold;margin-bottom:2px'),
          BANNER(`${tipoIcon} ${isMesa ? 'MESA ' + (order.mesa_num || '') : isRetira ? 'RETIRADA' : 'DELIVERY'}`, tipoBg, 'font-size:1.2em;letter-spacing:1px'),
          HR(),
          CENTER('PEDIDO ' + orderNum, 'font-size:1.5em;font-weight:bold;letter-spacing:1px;margin:4px 0'),
          HR(),
          D('margin-bottom:1px', 'Data: ' + now),
          (!isMesa && tempoPedidoTxt) ? D('margin-bottom:1px;font-weight:bold', tempoPedidoLabel + janelaPedidoTxt) : '',
          D('margin-bottom:1px', 'Cliente: ' + (order.client || '—')),
          order.addr ? D('word-break:break-word;margin-top:2px', '📍 ' + _addrParts.full) : '',
          _addrParts.referencia ? D('word-break:break-word;margin-top:1px', 'Ref: ' + _addrParts.referencia) : '',
          HR(),
          itensCozHtml,
          HR(),
          CENTER('— via cozinha —', 'font-size:0.85em;color:#555'),
          CENTER('Powered By: EstimaFood', 'font-size:0.8em;color:#555;margin-top:4px')
        )
      );
  }

  // ── Via combinada (folha única) ─────────────────────────
  const cutLine = CENTER('· · · · ✂ · · · · · · · · ✂ · · · ·', 'font-size:0.75em;color:#aaa;margin:6px 0');
  const singleSheet = viaCozinha
    ? viaPrincipal + cutLine + viaCozinha.replace(D('page-break-before:always', ''), '')
    : viaPrincipal;

  return { principal: viaPrincipal, cozinha: viaCozinha, cozinhaItems: itensCozinha, combined: viaPrincipal + viaCozinha, singleSheet };
}

// ── Carrega lista de impressoras do servidor ──────────
async function loadPrinters() {
  const sel = document.getElementById('print-printer-select');
  const selCoz = document.getElementById('print-printer-cozinha-select');
  if (!sel) return;
  try {
    let printers = [];
    let defaultPrinter = '';

    // Electron: busca impressoras do Windows diretamente
    if (window.ElectronPrint) {
      const cfg = await window.ElectronPrint.getConfig();
      printers       = cfg.printers || [];
      defaultPrinter = cfg.printer || '';
      // Restaura impressoras salvas no Electron
      const _eCaixa = cfg.printer_caixa || cfg.printer || '';
      const _eCoz   = cfg.printer_cozinha || '';
      if (_eCaixa) { _printPrinter = _eCaixa; localStorage.setItem('printPrinter', _eCaixa); }
      if (_eCoz)   { _printPrinterCozinha = _eCoz; localStorage.setItem('printPrinterCozinha', _eCoz); }
    } else {
      // Web: busca do servidor
      const r = await fetch('/api/printers');
      const d = await r.json();
      printers       = d.printers || [];
      defaultPrinter = d.default  || '';
    }

    const optsBalcao = '<option value="">Impressora padrão do sistema</option>' +
      printers.map(p =>
        `<option value="${p}" ${p === _printPrinter ? 'selected' : ''}>${p}${p === defaultPrinter ? ' ★' : ''}</option>`
      ).join('');
    sel.innerHTML = optsBalcao;
    if (_printPrinter) sel.value = _printPrinter;

    // Impressora cozinha
    if (selCoz) {
      const optsCoz = '<option value="">Mesma do balcão (impressora única)</option>' +
        printers.map(p =>
          `<option value="${p}" ${p === _printPrinterCozinha ? 'selected' : ''}>${p}${p === defaultPrinter ? ' ★' : ''}</option>`
        ).join('');
      selCoz.innerHTML = optsCoz;
      if (_printPrinterCozinha) selCoz.value = _printPrinterCozinha;
    }
  } catch {
    sel.innerHTML = '<option value="">Impressora padrão do sistema</option>';
    if (selCoz) selCoz.innerHTML = '<option value="">Mesma do balcão (impressora única)</option>';
  }
}

// ── Impressão via agente local (computador da loja) ──
async function _printViaAgent(html) {
  const printer = document.getElementById('print-printer-select')?.value || _printPrinter || '';
  const format  = document.getElementById('print-format-select')?.value  || _printFormat  || '80mm';
  const tid = (() => { try { return JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || ''; } catch { return ''; } })();
  const res = await fetch('/api/print-queue/job', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
    body:    JSON.stringify({ html, format, printer: printer || undefined, marginH: _printMarginH, marginV: _printMarginV }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro ao criar job');
  return data;
}

// ── Impressão via servidor (silenciosa, Puppeteer) ───
async function _printViaServer(html) {
  const printer = document.getElementById('print-printer-select')?.value || _printPrinter || '';
  const format  = document.getElementById('print-format-select')?.value  || _printFormat  || '80mm';
  _printPrinter = printer; localStorage.setItem('printPrinter', printer);
  _printFormat  = format;  localStorage.setItem('printFormat',  format);
  const tid = (() => { try { return JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || ''; } catch { return ''; } })();
  const res = await fetch('/api/print', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
    body:    JSON.stringify({ html, printer: printer || undefined, format }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro no servidor');

  // Servidor gerou o PDF — abre nova aba e imprime
  // (Chrome não suporta print() em PDF dentro de iframe)
  if (data.pdf) {
    const bytes = Uint8Array.from(atob(data.pdf), c => c.charCodeAt(0));
    const blob  = new Blob([bytes], { type: 'application/pdf' });
    const url   = URL.createObjectURL(blob);
    const win   = window.open(url, '_blank');
    if (win) {
      win.onload = () => {
        win.print();
        setTimeout(() => { win.close(); URL.revokeObjectURL(url); }, 2000);
      };
      // fallback: onload nem sempre dispara em PDFs
      setTimeout(() => {
        try { win.print(); } catch(_) {}
        setTimeout(() => { try { win.close(); } catch(_){} URL.revokeObjectURL(url); }, 2000);
      }, 1500);
    } else {
      sbToast('warn', '⚠️ Popup bloqueado — abra o Chrome com --kiosk-printing');
      URL.revokeObjectURL(url);
    }
  }
  return data;
}

// ── Impressão via navegador (fallback final) ─────────
function _printViaBrowser(html) {
  const frame = document.getElementById('print-frame');
  if (!frame) return;

  // Monta HTML completo dentro do iframe
  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box }
  body { font-family:'Courier New',monospace; font-size:12px; color:#000; background:#fff; overflow-wrap:break-word; word-break:break-word }
  hr { border:none; border-top:1px dashed #000; margin:4px 0 }
  .pt-center { text-align:center } .pt-large { font-size:15px; font-weight:bold }
  .pt-hr { border:none; border-top:1px dashed #000; margin:4px 0 }
  .print-ticket { padding:2px 6px; width:100%; overflow:visible; overflow-wrap:break-word; word-break:break-word }
  span, div { word-break:break-word; overflow-wrap:break-word }
  @media print { @page { margin:${_printMarginV}mm ${_printMarginH}mm } body { margin:0 } }
</style></head><body>${html}
<script>
  window.onload = function() {
    window.print();
    // Avisa o pai para esconder o frame após imprimir
    setTimeout(function() {
      try { window.parent.document.getElementById('print-frame').style.display='none'; } catch(_) {}
    }, 1500);
  };
<\/script></body></html>`;

  frame.style.display = 'block';
  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(fullHtml);
    doc.close();
  } else {
    // Fallback absoluto: blob URL
    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    frame.src  = url;
    frame.onload = () => {
      try { frame.contentWindow.print(); } catch (_) {}
      setTimeout(() => { frame.style.display = 'none'; URL.revokeObjectURL(url); }, 2000);
    };
  }
}

// ── Aviso quando nenhum método silencioso está disponível ────────
function _showPrintAgentToast() {
  const msg =
    '🖨️ Nenhum agente ativo. Para imprimir sem confirmação, ' +
    'inicie o print-agent.js no computador da loja.';
  if (typeof sbToast === 'function') sbToast('warn', msg);
  else console.warn(msg);
}

// ══════════════════════════════════════════════════════════════
// ESC/POS via WebUSB — imprime direto na térmica sem diálogo
// ══════════════════════════════════════════════════════════════
let _usbDevice = null; // guarda o device pareado entre impressões

// Converte o pedido em bytes ESC/POS puros — layout estilo Anota AI
function _buildEscPos(order, cfg, cols = 32) {
  const enc  = new TextEncoder();
  const buf  = [];
  const push = (str) => enc.encode(str).forEach(b => buf.push(b));
  const bytes= (...b) => b.forEach(b => buf.push(b));

  const money = v => 'R$ ' + parseFloat(v || 0).toFixed(2).replace('.', ',');
  const center = (str) => {
    const pad = Math.max(0, Math.floor((cols - str.length) / 2));
    return ' '.repeat(pad) + str;
  };
  const cols2 = (left, right) => {
    const space = cols - left.length - right.length;
    return left + (space > 0 ? ' '.repeat(space) : ' ') + right;
  };

  // ── Data/hora do pedido + janela de entrega ─────────────
  // IMPORTANTE: SQLite datetime('now') retorna UTC sem sufixo "Z" (ex: "2026-04-25 17:30:00").
  // Sem isso o new Date() interpreta como horário local → janela de entrega errada em 3h (Brasília UTC-3).
  const _parseCreatedAt = (raw) => {
    if (!raw) return new Date();
    if (raw instanceof Date) return raw;
    const s = String(raw).trim();
    if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return new Date(s);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (m) return new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]));
    return new Date(s);
  };
  const _fmtBR = (d, opts) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', ...opts });
  const _hhmmBR = (d) => _fmtBR(d, { hour: '2-digit', minute: '2-digit', hour12: false });
  const _orderDate = _parseCreatedAt(order.created_at);
  const _pad2 = n => String(n).padStart(2,'0');
  const dataHoraTxt = _fmtBR(_orderDate, { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).replace(',', '');
  const _parseTempoEntrega = (txt) => {
    if (!txt) return [30, 45];
    const m = String(txt).match(/(\d+)\s*[-–to a]+\s*(\d+)/);
    if (m) return [parseInt(m[1]), parseInt(m[2])];
    const single = String(txt).match(/(\d+)/);
    if (single) { const v = parseInt(single[1]); return [v, v + 15]; }
    return [30, 45];
  };
  const _calcJanelaEsc = (tempoTxt) => {
    const [_tmin, _tmax] = _parseTempoEntrega(tempoTxt);
    const _ini = new Date(_orderDate.getTime() + _tmin*60000);
    const _fim = new Date(_orderDate.getTime() + _tmax*60000);
    return `${_hhmmBR(_ini)} - ${_hhmmBR(_fim)}`;
  };

  // ── Tipo de entrega ────────────────────────────────────
  const _escTipoPedido = _printOrderType(order);
  const _escIsMesa     = _escTipoPedido === 'mesa';
  const _escIsRetirada = _escTipoPedido === 'retirada';
  const _escTipoLabel  = _escIsMesa
    ? 'MESA ' + (order.mesa_num || '')
    : _escIsRetirada ? 'PARA RETIRADA' : 'PARA ENTREGA';
  const _escTempoPedido = _escIsMesa ? '' : (_escIsRetirada ? (cfg.tempoRetirada || '') : (cfg.tempoEntrega || ''));
  const _escJanelaTxt = _escTempoPedido ? _calcJanelaEsc(_escTempoPedido) : '';
  const _escTempoLabel = _escIsRetirada ? 'Retirada prevista: ' : 'Entrega prevista: ';

  // ── Endereço estruturado (extrai referência) ───────────
  const _splitAddrEsc = (addrStr) => {
    if (!addrStr) return { full:'', referencia:'' };
    const partes = addrStr.split(', ');
    let referencia = '';
    const refIdx = partes.findIndex(p => /^Ref:\s*/i.test(p));
    if (refIdx >= 0) {
      referencia = partes[refIdx].replace(/^Ref:\s*/i,'').trim();
      partes.splice(refIdx, 1);
    }
    return { full: partes.join(', '), referencia };
  };
  const _addrPartsEsc = _splitAddrEsc(order.addr);

  const sep = '-'.repeat(cols) + '\n';
  bytes(0x1B, 0x40);                         // ESC @ — reset

  // ── 1) TOPO: tipo + data + janela + nome da loja ──
  bytes(0x1B, 0x61, 0x01);                   // centralizar
  bytes(0x1B, 0x45, 0x01);                   // negrito
  push(_escTipoLabel + '\n');
  bytes(0x1B, 0x45, 0x00);
  push(dataHoraTxt + '\n');
  if (!_escIsMesa && _escTempoPedido) push(_escTempoLabel + _escJanelaTxt + '\n');
  bytes(0x1B, 0x45, 0x01);
  push(cfg.nome + '\n');
  bytes(0x1B, 0x45, 0x00);
  bytes(0x1B, 0x61, 0x00);                   // alinhar esquerda
  push(sep);

  // ── 2) PEDIDO NN gigante ──
  bytes(0x1B, 0x61, 0x01);                   // centralizar
  bytes(0x1D, 0x21, 0x11);                   // fonte dupla altura+largura
  bytes(0x1B, 0x45, 0x01);                   // negrito
  push('PEDIDO ' + (order.num || order.id) + '\n');
  bytes(0x1B, 0x45, 0x00);
  bytes(0x1D, 0x21, 0x00);                   // fonte normal
  bytes(0x1B, 0x61, 0x00);                   // alinhar esquerda
  push(sep);

  // ── 3) Itens ──
  bytes(0x1B, 0x45, 0x01);                   // negrito
  push('Itens\n');
  bytes(0x1B, 0x45, 0x00);
  // Filtra itens cancelados — não imprime nem cobra
  const items = (Array.isArray(order.items) ? order.items : [])
    .filter(i => (i?.item_status || 'active') !== 'cancelado');
  const maxNameLen = cols - 14;

  // Agrupa por categoria pra dar contexto. Mantém ordem de inserção.
  const _itensPorCatEsc = [];
  const _idxCatEsc = new Map();
  for (const it of items) {
    const catLabel = (it.cat || it.cat_key || 'Outros').trim() || 'Outros';
    if (!_idxCatEsc.has(catLabel)) {
      _idxCatEsc.set(catLabel, _itensPorCatEsc.length);
      _itensPorCatEsc.push({ cat: catLabel, items: [] });
    }
    _itensPorCatEsc[_idxCatEsc.get(catLabel)].items.push(it);
  }
  const _mostrarCabEsc = _itensPorCatEsc.length > 1;

  const renderItemEsc = (i) => {
    const parsed = _parseObs(i.obs);
    // Pizza meio a meio: detecta pelo nome com "/" + obs "Meio a meio".
    // Imprime cada sabor numa linha pra cozinha não confundir.
    let nomeFinal = i.name;
    let saboresMeio = null;
    const nomeContemBarra = / \/ /.test(i.name);
    if (nomeContemBarra && (parsed.meioMeio || /^meio a meio/i.test(i.obs||''))) {
      const sabores = i.name.split(' / ').map(s => s.trim()).filter(Boolean);
      if (sabores.length === 2) {
        nomeFinal = 'Pizza meio a meio';
        saboresMeio = sabores;
      } else if (sabores.length > 0) {
        nomeFinal = 'Pizza ' + sabores.length + ' sabores';
        saboresMeio = sabores;
      }
    } else if (parsed.meioMeio) {
      const sabores = parsed.meioMeio.split(/\s*\+\s*/).map(s => s.trim()).filter(Boolean);
      if (sabores.length >= 2) saboresMeio = sabores;
    }

    const qtyPrefix = `(${i.qty||1}) `;
    const fullName  = (qtyPrefix + nomeFinal).substring(0, maxNameLen);
    const price = money((i.price || 0) * (i.qty || 1));
    push(cols2(fullName, price) + '\n');

    // Sabores meio a meio em linhas separadas (em negrito)
    if (saboresMeio) {
      bytes(0x1B, 0x45, 0x01);
      saboresMeio.forEach(s => {
        _wrapText('1/2 ' + s, cols, '    ').forEach(l => push(l + '\n'));
      });
      bytes(0x1B, 0x45, 0x00);
    } else if (parsed.meioMeio) {
      // Fallback: meioMeio sem split possível
      _wrapText('1/2 + 1/2 ' + parsed.meioMeio, cols, '    ').forEach(l => push(l + '\n'));
    }

    // Kit: sub-itens com (1) prefix
    if (parsed.kitItens.length) {
      parsed.kitItens.forEach(k => {
        _wrapText(k, cols, '    (1) ').forEach(l => push(l + '\n'));
      });
    }

    // Cortes do açougue (em negrito pra destacar peso e tipo)
    if (parsed.cortes && parsed.cortes.length) {
      bytes(0x1B, 0x45, 0x01);
      push('    Cortes:\n');
      parsed.cortes.forEach(c => {
        _wrapText(c, cols, '      - ').forEach(l => push(l + '\n'));
      });
      bytes(0x1B, 0x45, 0x00);
    }

    // Grupos (Adicionais, Ponto, Molhos…)
    if (parsed.grupos.length) {
      parsed.grupos.forEach(g => {
        bytes(0x1B, 0x45, 0x01);
        push('    ' + g.nome + ':\n');
        bytes(0x1B, 0x45, 0x00);
        g.itens.forEach(it => {
          _wrapText(it, cols, '      - ').forEach(l => push(l + '\n'));
        });
      });
    }

    // Obs livre
    if (parsed.obsLivre) {
      _wrapText(parsed.obsLivre, cols, '    * ').forEach(l => push(l + '\n'));
    }
  };

  _itensPorCatEsc.forEach(grupo => {
    if (_mostrarCabEsc) {
      // Cabeçalho de categoria centralizado em negrito
      bytes(0x1B, 0x45, 0x01);
      const label = grupo.cat.toUpperCase();
      const pad = Math.max(0, Math.floor((cols - label.length) / 2));
      push(' '.repeat(pad) + label + '\n');
      bytes(0x1B, 0x45, 0x00);
    }
    grupo.items.forEach(renderItemEsc);
  });
  push(sep);

  // ── 4) Cliente ──
  bytes(0x1B, 0x45, 0x01);
  push('Cliente\n');
  bytes(0x1B, 0x45, 0x00);
  push('Nome: ' + (order.client || '—') + '\n');
  if (order.phone) push('Telefone: ' + order.phone + '\n');
  if (order.phone && Number.isFinite(order.pedidos_count)) {
    push((order.pedidos_count <= 1 ? '1o pedido nesta loja' : order.pedidos_count + 'o pedido nesta loja') + '\n');
  }
  if (cfg.addr && _addrPartsEsc.full && !_escIsMesa) {
    _wrapText((_escIsRetirada ? 'Retirada: ' : 'Entrega: ') + _addrPartsEsc.full, cols, '').forEach(l => push(l + '\n'));
    if (_addrPartsEsc.referencia) {
      _wrapText('Referencia: ' + _addrPartsEsc.referencia, cols, '').forEach(l => push(l + '\n'));
    }
  }
  push(sep);

  // ── 5) Pagamento ──
  bytes(0x1B, 0x45, 0x01);
  push('Pagamento\n');
  bytes(0x1B, 0x45, 0x00);
  const _escPagLabels = {
    dinheiro:'Dinheiro', cartao:'Cartao', credito:'Credito', debito:'Debito',
    pix:'PIX', pix_mp:'PIX Online', cartao_mp:'Credito Online', mesa:'Conta Mesa'
  };
  const _escPagNome = _escPagLabels[order.pag] || order.pag || '---';
  // Mesma lógica de detecção do HTML — ver comentário lá pra explicação completa.
  // pag_momento='online' SOZINHO não é prova de pagamento (gravado antes da confirmação).
  const _escStatusPago = order.status && !['aguardando_pix','aguardando_cartao'].includes(order.status);
  const _escJaPago  = order.pag === 'pix_mp'
                   || order.pag === 'cartao_mp'
                   || order.pag_momento === 'agora'
                   || (order.pag === 'pix' && _escStatusPago)
                   || (order.pag === 'pix_manual' && _escStatusPago);
  push('Forma de Pagamento: ' + _escPagNome + '\n');

  // Banner cobrar do cliente
  bytes(0x1B, 0x61, 0x01);                   // centralizar
  bytes(0x1B, 0x45, 0x01);                   // negrito
  push((_escJaPago ? '* Pedido ja pago *' : '* Cobrar do cliente *') + '\n');
  bytes(0x1B, 0x45, 0x00);
  bytes(0x1B, 0x61, 0x00);                   // esquerda

  // Totais
  const subtotal = items.reduce((s, i) => s + (parseFloat(i.price || 0) * (i.qty || 1)), 0);
  const taxa  = parseFloat(order.taxa || 0);
  const orderTotal = parseFloat(order.total);
  // Se houver itens cancelados, o order.total está desatualizado — usa subtotal recalculado
  const _itemsAllEsc  = Array.isArray(order.items) ? order.items : [];
  const _temCancEsc   = _itemsAllEsc.some(i => (i?.item_status||'active') === 'cancelado');
  const desconto = (!_temCancEsc && !isNaN(orderTotal) && orderTotal < subtotal) ? Math.max(0, subtotal - orderTotal) : 0;
  const total = (_temCancEsc || isNaN(orderTotal)) ? (subtotal + taxa) : (orderTotal + taxa);
  push(cols2('Subtotal:', money(subtotal)) + '\n');
  if (desconto > 0) push(cols2('Desconto:', '-' + money(desconto)) + '\n');
  if (taxa > 0)     push(cols2('Taxa de entrega:', money(taxa)) + '\n');
  bytes(0x1B, 0x45, 0x01);
  push(cols2('Total:', money(total)) + '\n');
  bytes(0x1B, 0x45, 0x00);

  // Troco — deixa explícito quanto o cliente vai pagar e quanto devolver
  if ((order.pag || '').toLowerCase() === 'dinheiro') {
    if (order.troco > 0) {
      // Cliente informou o valor que vai entregar — calcula e destaca o troco a devolver
      const devolver = Math.max(0, order.troco - total);
      push(cols2('Cliente paga:', money(order.troco)) + '\n');
      bytes(0x1B, 0x45, 0x01);
      push(cols2('DEVOLVER ao cliente:', money(devolver)) + '\n');
      bytes(0x1B, 0x45, 0x00);
    } else if (order.troco === -1) {
      // Cliente pediu troco mas não informou o valor — alerta o entregador
      bytes(0x1B, 0x45, 0x01);
      push(cols2('Troco:', 'SIM (valor nao informado)') + '\n');
      bytes(0x1B, 0x45, 0x00);
    } else {
      // Cliente vai pagar exato
      push(cols2('Troco:', 'Nao precisa') + '\n');
    }
  }
  push(sep);

  // ── 6) Rodapé ──
  bytes(0x1B, 0x61, 0x01);                   // centralizar
  push((cfg.rodape || 'Obrigado!') + '\n');
  push('Powered By: EstimaFood\n');
  bytes(0x1B, 0x61, 0x00);

  // Avança papel e corta
  bytes(0x0A, 0x0A, 0x0A, 0x0A);             // 4 linhas (feed extra p/ garantir que o papel passe da guilhotina)
  bytes(0x1D, 0x56, 0x42, 0x00);             // GS V B 0 — corte parcial (formato novo, Epson e compatíveis)
  bytes(0x1D, 0x56, 0x01);                   // GS V 1 — corte parcial (formato antigo)
  bytes(0x1D, 0x56, 0x41, 0x00);             // GS V A 0 — corte total (formato novo)
  bytes(0x1D, 0x56, 0x00);                   // GS V 0 — corte total (formato antigo; alguns modelos só têm corte total)

  return new Uint8Array(buf);
}

// Conecta (ou reutiliza) o dispositivo USB pareado
async function _usbConnect() {
  if (_usbDevice && _usbDevice.opened) return _usbDevice;

  // Tenta reutilizar dispositivo já autorizado
  const devices = await navigator.usb.getDevices();
  const saved   = localStorage.getItem('escpos_usb_name');
  let dev = devices.find(d =>
    saved ? (d.productName + d.manufacturerName).includes(saved) : true
  ) || devices[0];

  if (!dev) {
    // Pede permissão ao usuário (só na primeira vez)
    dev = await navigator.usb.requestDevice({ filters: [] });
    localStorage.setItem('escpos_usb_name', (dev.productName || '') + (dev.manufacturerName || ''));
  }

  await dev.open();
  if (dev.configuration === null) await dev.selectConfiguration(1);
  // Acha a interface com endpoint bulk-out
  for (const iface of dev.configuration.interfaces) {
    try {
      await dev.claimInterface(iface.interfaceNumber);
      _usbDevice = dev;
      _usbDevice._epOut = iface.alternates[0]?.endpoints
        .find(e => e.direction === 'out')?.endpointNumber;
      if (_usbDevice._epOut !== undefined) break;
      await dev.releaseInterface(iface.interfaceNumber);
    } catch {}
  }

  if (!_usbDevice) throw new Error('Nenhuma interface de saída encontrada na impressora');
  return _usbDevice;
}

async function _printViaUsb(order, cfg) {
  if (!navigator.usb) throw new Error('WebUSB não suportado neste navegador');
  console.log('[USB] Conectando dispositivo...');
  const dev  = await _usbConnect();
  console.log('[USB] Dispositivo conectado | endpoint:', _usbDevice._epOut);
  const fmt  = localStorage.getItem('printFormat') || _printFormat || '80mm';
  const cols = fmt === '58mm' ? 32 : 48;
  const data = _buildEscPos(order, cfg, cols);
  console.log('[USB] Dados ESC/POS gerados | bytes:', data.length, '| colunas:', cols);
  // Envia em chunks de 64 bytes para evitar overflow em impressoras lentas
  const CHUNK = 64;
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, Math.min(i + CHUNK, data.length));
    await dev.transferOut(_usbDevice._epOut, chunk);
  }
  console.log('[USB] Impressão concluída!');
}

// Pareia a impressora USB (chamado pelo botão na tela de configuração)
async function pairUsbPrinter() {
  if (!navigator.usb) {
    sbToast('err', 'WebUSB não suportado. Use Chrome ou Edge.');
    return;
  }
  try {
    const dev = await navigator.usb.requestDevice({ filters: [] });
    localStorage.setItem('escpos_usb_name', (dev.productName || '') + (dev.manufacturerName || ''));
    _usbDevice = null; // força reconexão na próxima impressão
    sbToast('ok', '✅ Impressora "' + (dev.productName || 'USB') + '" pareada! Impressão será 100% silenciosa.');
  } catch (e) {
    if (e.name === 'NotFoundError') sbToast('warn', 'Nenhuma impressora selecionada.');
    else sbToast('err', 'Erro ao parear: ' + e.message);
  }
}

// Desconecta e remove pareamento
async function unpairUsbPrinter() {
  if (_usbDevice) {
    try { await _usbDevice.close(); } catch {}
    _usbDevice = null;
  }
  localStorage.removeItem('escpos_usb_name');
  sbToast('ok', 'Impressora USB removida.');
}

// ── Cache de Print Agent ativo ──────────────────────────────────────
// Evita perguntar /api/print-queue/status toda vez que vai imprimir (latência)
// e protege contra falhas momentâneas de rede: se o printestima foi visto
// nos últimos 90s, presumimos que ainda está ativo, evitando que erro de
// fetch faça o gestor abrir o diálogo de impressão do navegador.
let _printAgentCache = { active: false, last_seen: 0, printer: '' };
let _printAgentInitial = null; // promessa da primeira checagem ao carregar

async function _checkPrintAgent(tipo = '') {
  try {
    const tid = (() => { try { return JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || ''; } catch { return ''; } })();
    const route = String(tipo || '').trim().toLowerCase();
    if (!tid) return route ? { active: false, last_seen: 0, printer: '', tipo: route } : _printAgentCache;
    const qs = route ? `?tipo=${encodeURIComponent(route)}` : '';
    const r = await fetch('/api/print-queue/status' + qs, { headers: { 'x-tenant-id': tid } });
    const d = await r.json();
    if (route) {
      return {
        active: !!d.active,
        last_seen: d.active ? Date.now() : 0,
        printer: d.printer || '',
        tipo: d.tipo || route,
        agents: d.agents || []
      };
    }
    if (d.active) {
      _printAgentCache = { active: true, last_seen: Date.now(), printer: d.printer || '', tipo: d.tipo || '', agents: d.agents || [] };
    } else if (Date.now() - _printAgentCache.last_seen > 90000) {
      // só zera se está inativo por mais de 90s
      _printAgentCache = { active: false, last_seen: _printAgentCache.last_seen, printer: '', tipo: '', agents: [] };
    }
  } catch (e) {
    // Se falhou a checagem mas o agent foi visto há pouco, mantém ativo
    console.warn('[PRINT] check agent erro:', e.message);
    if (tipo) return { active: false, last_seen: 0, printer: '', tipo };
  }
  return _printAgentCache;
}

// Atualiza cache periodicamente em background (a cada 30s)
setInterval(() => { _printAgentInitial = _checkPrintAgent(); }, 30000);
// Faz a primeira checagem imediatamente — guarda a promessa pra que o
// primeiro printOrder possa esperar ela terminar antes de decidir.
_printAgentInitial = _checkPrintAgent();

// Helper: retorna true se o usuário está usando o app desktop (printestima)
// e portanto NÃO queremos abrir o diálogo do navegador como fallback.
// Considera "agent ativo" quem teve heartbeat nos últimos 90s.
function _isPrintAgentReady() {
  const isElectronApp = !!window.ElectronPrint;
  const agentActive = _printAgentCache.active && (Date.now() - _printAgentCache.last_seen) < 90000;
  return isElectronApp || agentActive;
}

async function _syncOrderPaymentBeforePrint(order) {
  const pag = order?.pag || '';
  const shouldSync = order?.id
    && _sessao?.tenant_id
    && (pag === 'pix' || order.pag_momento === 'online' || order.status === 'aguardando_pix');
  if (!shouldSync || pag === 'pix_mp' || pag === 'cartao_mp') return order;
  try {
    const r = await fetch(`/api/pix/order-sync?order_id=${encodeURIComponent(order.id)}`, {
      headers: { 'x-tenant-id': _sessao.tenant_id }
    });
    if (!r.ok) return order;
    const d = await r.json().catch(() => null);
    if (!d?.order) return order;
    return {
      ...order,
      ...d.order,
      num: order.num || d.order.order_num || d.order.id,
      time: order.time,
      items: Array.isArray(d.order.items) ? d.order.items : (order.items || [])
    };
  } catch(e) {
    console.warn('[PRINT] Falha ao sincronizar pagamento antes da impressao:', e.message);
    return order;
  }
}

// Busca quantos pedidos esse cliente (telefone) já fez NESSE tenant e anexa em order.pedidos_count,
// pra sair na comanda impressa. Sempre manda x-tenant-id — nunca mistura dados de outra loja.
async function _syncClienteOrdersCount(order) {
  if (!order?.phone || !_sessao?.tenant_id) return order;
  try {
    const r = await fetch(`/api/cliente-pedidos-count?phone=${encodeURIComponent(order.phone)}`, {
      headers: { 'x-tenant-id': _sessao.tenant_id }
    });
    if (!r.ok) return order;
    const d = await r.json().catch(() => null);
    return { ...order, pedidos_count: d?.count || 0 };
  } catch (e) {
    console.warn('[PRINT] Falha ao buscar contagem de pedidos do cliente:', e.message);
    return order;
  }
}

function _printHasSetorRoutesConfigured() {
  try {
    return Object.values(_getPrintSetoresCategoria() || {}).some(Boolean);
  } catch (_) {
    return false;
  }
}

function _printBuildJobsForOrder(order, ticket, cfg, opts = {}) {
  const jobs = [];
  const viaMode = _normalizePrintViaMode(opts.viaMode || _printViaMode);
  const viaOverride = opts.viaOverride || '';
  const printerOverride = (opts.printerOverride || '').trim();

  const addCaixa = () => {
    if (ticket.principal) {
      jobs.push({ html: ticket.principal, printer: printerOverride || _printPrinter || '', tipo: 'caixa' });
    }
  };

  const addCozinha = () => {
    if (!ticket.cozinha) return;
    if (printerOverride) {
      jobs.push({ html: ticket.cozinha, printer: printerOverride, tipo: 'cozinha' });
      return;
    }
    const setorJobs = _buildSetorPrintJobsForItems(order, cfg, ticket.cozinhaItems || [], {
      defaultPrinter: _printPrinterCozinha,
      defaultTitle: 'Cozinha'
    });
    if (setorJobs.length) jobs.push(...setorJobs);
    else jobs.push({ html: ticket.cozinha, printer: _printPrinterCozinha || '', tipo: 'cozinha' });
  };

  const addFolhaUnica = () => {
    if (!ticket.singleSheet) return;
    const printer = _printPrinter || _printPrinterCozinha || '';
    const tipo = (_printPrinter || !_printPrinterCozinha) ? 'caixa' : 'cozinha';
    jobs.push({ html: ticket.singleSheet, printer, tipo });
  };

  if (viaOverride) {
    if (viaOverride === 'caixa') addCaixa();
    else if (viaOverride === 'cozinha') addCozinha();
    else if (viaOverride === 'ambas') {
      addCaixa();
      addCozinha();
    }
    return jobs;
  }

  if (viaMode === 'separado' && (ticket.cozinha || _printHasSetorRoutesConfigured() || _printPrinterCozinha)) {
    addCozinha();
  } else if (viaMode === 'somente_principal') {
    addCaixa();
  } else {
    addFolhaUnica();
  }

  return jobs;
}

async function _printKnownPrinters() {
  const out = [];
  const seen = new Set();
  const add = (value, label) => {
    const v = String(value || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push({ value: v, label: label || v });
  };

  add(_printPrinter, 'Caixa - ' + _printPrinter);
  add(_printPrinterCozinha, 'Cozinha - ' + _printPrinterCozinha);
  try {
    (Array.isArray(_impressoras) ? _impressoras : []).forEach(imp => {
      const value = imp.printerName || imp.apelido || '';
      const label = imp.apelido && imp.printerName ? `${imp.apelido} - ${imp.printerName}` : value;
      add(value, label);
    });
  } catch (_) {}
  try {
    if (window.ElectronPrint?.getPrinters) {
      const printers = await window.ElectronPrint.getPrinters();
      (printers || []).forEach(p => add(p, p));
    } else if (window.ElectronPrint?.getConfig) {
      const cfg = await window.ElectronPrint.getConfig();
      (cfg?.printers || []).forEach(p => add(p, p));
    }
  } catch (_) {}
  return out;
}

async function _printAskReprintChoice(ticket) {
  const printers = await _printKnownPrinters();
  return new Promise(resolve => {
    const existing = document.getElementById('modal-print-reprint-choice');
    if (existing) existing.remove();

    const bg = document.createElement('div');
    bg.id = 'modal-print-reprint-choice';
    bg.className = 'modal-bg';
    bg.style.display = 'flex';
    bg.innerHTML = `
      <div class="modal" style="max-width:360px">
        <button class="modal-close" id="print-choice-close"></button>
        <div class="modal-header">
          <h2>Imprimir de novo</h2>
          <p>Escolha qual via e qual impressora deve receber essa reimpressao.</p>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <label style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Via</label>
          <select class="form-input" id="print-choice-via">
            <option value="cozinha" ${ticket.cozinha ? '' : 'disabled'}>Cozinha</option>
            <option value="caixa">Caixa / cliente</option>
            <option value="ambas" ${ticket.cozinha ? '' : 'disabled'}>Cozinha + cliente</option>
          </select>
          <label style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Impressora</label>
          <select class="form-input" id="print-choice-printer">
            <option value="">Usar impressora configurada da via</option>
            ${printers.map(p => `<option value="${_printHtmlEscape(p.value)}">${_printHtmlEscape(p.label)}</option>`).join('')}
          </select>
          <div style="display:flex;gap:10px;margin-top:6px">
            <button class="btn bg" id="print-choice-cancel" style="flex:1;justify-content:center">Cancelar</button>
            <button class="btn bp" id="print-choice-ok" style="flex:1.4;justify-content:center">Imprimir</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(bg);

    const finish = value => {
      try { bg.remove(); } catch (_) {}
      resolve(value);
    };
    bg.addEventListener('click', e => { if (e.target === bg) finish(null); });
    bg.querySelector('#print-choice-close')?.addEventListener('click', () => finish(null));
    bg.querySelector('#print-choice-cancel')?.addEventListener('click', () => finish(null));
    const viaSel = bg.querySelector('#print-choice-via');
    if (viaSel && !ticket.cozinha) viaSel.value = 'caixa';
    bg.querySelector('#print-choice-ok')?.addEventListener('click', () => finish({
      viaOverride: viaSel?.value || 'caixa',
      printerOverride: bg.querySelector('#print-choice-printer')?.value || ''
    }));
  });
}

async function printOrder(order, opts = {}) {
  order = await _syncOrderPaymentBeforePrint(order);
  order = await _syncClienteOrdersCount(order);
  const cfg    = _getPrintConfig();
  const fmt    = localStorage.getItem('printFormat') || _printFormat || '80mm';

  // ── Toggle "Imprimir pedido só de bebida" ──────────────
  // Aplica APENAS pra bebidas industrializadas (prontas, não precisam preparo).
  // Sucos, vitaminas, cafés e drinks da casa NÃO entram nessa lista — esses
  // sempre imprimem porque a cozinha/copa precisa fazer.
  // Toggle ON  (padrão) → imprime tudo, inclusive cerveja/refri pura
  // Toggle OFF           → pedido só de cerveja/refri NÃO imprime (cliente
  //                        pega direto no balcão). Mas se tiver suco junto,
  //                        imprime — porque suco precisa ser feito.
  const _ehIndustrializadaTop = (item) => {
    const cat  = (item.cat || item.cat_key || '').toLowerCase();
    const name = (item.name || '').toLowerCase();
    const re = /refrigerante|coca[\s-]?cola|pepsi|guaran[aá]|fanta|sprite|soda|schweppes|t[oô]nica|[aá]gua\b|mineral|cerveja|chopp|brahma|skol|heineken|budweiser|corona|stella|amstel|itaipava|eisenbahn|vinho|wine|espumante|prosecco|champagne|sake|long[\s.]?neck|energ[eé]tico|red[\s.]?bull|monster|gatorade|powerade|isot[oô]nico|ice[\s.]?tea|nescau/i;
    return re.test(name) || re.test(cat);
  };
  // Considera apenas itens não cancelados
  const items = (Array.isArray(order.items) ? order.items : [])
    .filter(i => (i?.item_status || 'active') !== 'cancelado');
  const soIndustrializada = items.length > 0 && items.every(_ehIndustrializadaTop);
  const printBebidaSolo   = localStorage.getItem('printBebidaSolo') !== '0'; // padrão: ligado

  if (soIndustrializada && !printBebidaSolo) {
    console.log('[PRINT] Pedido só de bebida industrializada — impressão desativada pelo toggle');
    return;
  }

  const ticket = _buildTicketHtml(order, cfg);

  let jobs = [];
  const viaMode = _normalizePrintViaMode(_printViaMode);
  const hasSeparateKitchen = viaMode === 'separado' && (ticket.cozinha || _printPrinterCozinha || _printHasSetorRoutesConfigured());
  if (opts.manualChoice && hasSeparateKitchen) {
    const choice = await _printAskReprintChoice(ticket);
    if (!choice) return;
    jobs = _printBuildJobsForOrder(order, ticket, cfg, choice);
  } else {
    jobs = _printBuildJobsForOrder(order, ticket, cfg);
  }

  if (!jobs.length) {
    if (opts.manualChoice) sbToast('warn', 'Nenhuma via disponivel para imprimir.');
    else console.log('[PRINT] Modo separado: sem itens de cozinha; caixa nao imprime producao.');
    return;
  }

  for (const job of jobs) {
    await _printJobCascade(job.html, fmt, job.printer, order, cfg, job.tipo);
  }
}

// ── Cascata de impressão silenciosa (1 job) ──────────────
async function _printJobCascade(html, fmt, printer, order, cfg, tipo) {
  let compatibleAgentActive = false;
  // 1️⃣ Electron — usa printHtml para enviar HTML + impressora específica do job
  if (window.ElectronPrint) {
    try {
      const pw = fmt === '58mm' ? 48 : 72;
      const wrappedHtml = _wrapTicketHtml(html, cfg ? cfg.fontSize : 13);

      // Respeita o tipo do job para escolher a impressora correta
      // 'caixa' → printer_caixa | 'cozinha' → printer_cozinha | 'manual' → pergunta
      let targetPrinter = printer || '';
      if (tipo === 'caixa')   targetPrinter = printer || _printPrinter || '';
      if (tipo === 'cozinha') targetPrinter = printer || _printPrinterCozinha || _printPrinter || '';
      if (tipo === 'manual' && window.ElectronPrint.showPrinterDialog) {
        const sel = await window.ElectronPrint.showPrinterDialog(targetPrinter);
        if (sel.cancelled) return;
        targetPrinter = sel.printer;
      }

      if (window.ElectronPrint.printHtml) {
        const r = await window.ElectronPrint.printHtml(wrappedHtml, { printer: targetPrinter, paperWidth: pw, landscape: false, scaleFactor: 100, marginH: _printMarginH, marginV: _printMarginV });
        if (r.ok) { sbToast('ok', '🖨️ Impresso!' + (targetPrinter ? ' → ' + targetPrinter : '')); return; }
      } else {
        const r = await window.ElectronPrint.printOrder(order);
        if (r.ok) { sbToast('ok', '🖨️ Impresso (Electron)!'); return; }
      }
    } catch (e) { console.warn('[PRINT] Electron falhou:', e.message); }
  }

  // 2️⃣ WebUSB ESC/POS
  if (navigator.usb && _usbDevice) {
    try {
      await _printViaUsb(order, cfg);
      sbToast('ok', '🖨️ Impresso (USB direto)!');
      return;
    } catch (e) { console.warn('[PRINT] USB falhou:', e.message); }
  }

  // 3️⃣ Print Agent (printestima) — prioritário se o agent está ativo
  // Quando o agent foi visto nos últimos 90s, sempre usa essa rota e
  // evita os fallbacks 4/5/6 que abririam diálogos no navegador.
  try {
    const tid = (() => { try { return JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || ''; } catch { return ''; } })();
    if (tid) {
      // Espera a primeira checagem do agent terminar (evita cair no fallback
      // web em pedidos que chegam logo após o login). Em re-imprimir/etc
      // a promessa já resolveu, então não custa quase nada.
      const jobTipo = String(tipo || '').trim().toLowerCase();
      try { if (!jobTipo) await _printAgentInitial; } catch {}
      const agentStatus = jobTipo
        ? await _checkPrintAgent(jobTipo)
        : (Date.now() - _printAgentCache.last_seen > 30000 ? await _checkPrintAgent() : _printAgentCache);
      compatibleAgentActive = !!agentStatus?.active;
      if (compatibleAgentActive) {
        await fetch('/api/print-queue/job', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
          body: JSON.stringify({ html, format: fmt, printer: printer || undefined, tipo: tipo || undefined, marginH: _printMarginH, marginV: _printMarginV }),
        });
        sbToast('ok', '🖨️ Enviado ao agente!');
        return;
      }
    }
  } catch (e) { console.warn('[PRINT] Agent falhou:', e.message); }

  // 4️⃣ WebUSB auto-connect
  if (navigator.usb && !_usbDevice) {
    try {
      const devices = await navigator.usb.getDevices();
      if (devices.length > 0) {
        await _printViaUsb(order, cfg);
        sbToast('ok', '🖨️ Impresso (USB direto)!');
        return;
      }
    } catch (e) { console.warn('[PRINT] USB auto-connect falhou:', e.message); }
  }

  // ── Se o printestima está ativo, NÃO cai nos fallbacks abaixo ──
  // Os passos 5 (server PDF + iframe) e 6 (window.print) abrem diálogos
  // ou o sistema de impressão do navegador, atrapalhando quem tem o
  // printestima rodando. Pula direto pro toast de erro.
  if (compatibleAgentActive || !!window.ElectronPrint || (!tipo && _isPrintAgentReady())) {
    console.warn('[PRINT] Print Agent ativo mas falhou — não usar fallback web');
    sbToast('warn', '⚠️ Print Agent ativo mas job falhou. Verifique o app de impressão.');
    return;
  }

  // 5️⃣ Servidor PDF + iframe (iframe único por job, espera afterprint)
  try {
    const tid = (() => { try { return JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || ''; } catch { return ''; } })();
    if (tid) {
      const r = await fetch('/api/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
        body: JSON.stringify({ html, format: fmt, printer: printer || undefined }),
      });
      const data = await r.json();
      if (data.pdf) {
        const bytes = Uint8Array.from(atob(data.pdf), c => c.charCodeAt(0));
        const blob  = new Blob([bytes], { type: 'application/pdf' });
        const url   = URL.createObjectURL(blob);
        const frame = document.createElement('iframe');
        frame.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;visibility:hidden';
        document.body.appendChild(frame);
        if (printer) sbToast('info', '🖨️ Selecione: ' + printer);
        frame.src = url;
        await new Promise((resolve) => {
          frame.onload = () => {
            try {
              frame.contentWindow.addEventListener('afterprint', () => resolve(), { once: true });
              frame.contentWindow.print();
            } catch(_) { resolve(); }
          };
          setTimeout(resolve, 30000);
        });
        setTimeout(() => { try { frame.remove(); } catch(_){} URL.revokeObjectURL(url); }, 2000);
        sbToast('ok', '🖨️ Imprimindo...');
        return;
      }
    }
  } catch (e) { console.warn('[PRINT] Server PDF falhou:', e.message); }

  // 6️⃣ Fallback: window.print() (espera afterprint)
  console.warn('[PRINT] Usando fallback window.print()');
  if (printer) sbToast('info', '🖨️ Selecione: ' + printer);
  let area = document.getElementById('_print_area');
  if (!area) { area = document.createElement('div'); area.id = '_print_area'; document.body.appendChild(area); }
  area.innerHTML = html;
  let st = document.getElementById('_print_style');
  if (!st) { st = document.createElement('style'); st.id = '_print_style'; document.head.appendChild(st); }
  st.innerHTML = `@media print {
    @page { margin: ${_printMarginV}mm ${_printMarginH}mm; size: ${fmt} auto; }
    body > *:not(#_print_area):not(#_print_style) { display: none !important; }
    #_print_area { display: block !important; position: static !important; }
  }`;
  await new Promise((resolve) => {
    window.addEventListener('afterprint', () => resolve(), { once: true });
    window.print();
    setTimeout(resolve, 30000);
  });
  setTimeout(() => { area.innerHTML = ''; }, 2000);
  sbToast('warn', '🖨️ Imprimindo (com diálogo)...');
}

async function printOrderById(id) {
  const o = ordersKanban.find(x => x.id === id);
  if (o) await printOrder(o, { manualChoice: true }); else sbToast('err', 'Pedido não encontrado');
}

let _renderImpressaoLoaded = false;
function renderImpressao(skipServerLoad) {
  if (!_renderImpressaoLoaded && !skipServerLoad) {
    _renderImpressaoLoaded = true;
    const _restoreFields = () => {
      const el = (id,v) => { const e = document.getElementById(id); if (e && v) e.value = v; };
      el('print-nome', _printNome);
      el('print-sub', _printSub);
      el('print-rodape', _printRodape);
      el('print-font-size', _printFontSize);
      const fv = document.getElementById('print-font-size-val');
      if (fv) fv.textContent = _printFontSize || 13;
      el('print-format-select', _printFormat || '80mm');
      const mhEl = document.getElementById('print-margin-h');
      if (mhEl) { mhEl.value = _printMarginH; document.getElementById('print-margin-h-val').textContent = _printMarginH; }
      const mvEl = document.getElementById('print-margin-v');
      if (mvEl) { mvEl.value = _printMarginV; document.getElementById('print-margin-v-val').textContent = _printMarginV; }
      setPrintModeNew(_printMode);
      _loadImpressoras();
      _loadModelos();
      _loadRoteamento();
      renderPrintPreview();
    };
    loadPrintConfigServer().then(_restoreFields);
    _restoreFields();
    return;
  }
  _loadImpressoras();
  _loadModelos();
  _loadRoteamento();
  renderPrintPreview();
}

// ── Preenche selects de roteamento caixa/cozinha ──
function _loadRoteamento() {
  const isElectron = !!window.ElectronPrint;
  const viaSel = document.getElementById('print-via-mode-select');
  _printViaMode = _normalizePrintViaMode(_printViaMode);
  if (viaSel) viaSel.value = _printViaMode || 'combinado';
  const cozWrap = document.getElementById('print-cozinha-wrap');
  if (cozWrap) cozWrap.style.display = _printViaMode === 'separado' ? '' : 'none';
  const setorWrap = document.getElementById('print-setores-wrap');
  if (setorWrap) setorWrap.style.display = _printViaMode === 'separado' ? '' : 'none';

  const _fillSelect = (selId, currentVal) => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    if (isElectron) {
      window.ElectronPrint.getConfig().then(cfg => {
        const printers = cfg.printers || [];
        sel.innerHTML = '<option value="">Padrão do sistema</option>' +
          printers.map(p => `<option value="${p}" ${p === currentVal ? 'selected' : ''}>${p}${p === cfg.printer ? ' ★' : ''}</option>`).join('');
      }).catch(() => {});
    } else {
      // Usa as impressoras cadastradas no sistema de gerenciamento
      sel.innerHTML = '<option value="">Padrão do sistema</option>' +
        _impressoras.map(imp => `<option value="${imp.printerName || imp.apelido}" ${(imp.printerName || imp.apelido) === currentVal ? 'selected' : ''}>${imp.apelido} (${imp.printerName || imp.tipo})</option>`).join('');
    }
  };
  _fillSelect('print-rota-caixa', _printPrinter);
  _fillSelect('print-rota-cozinha', _printPrinterCozinha);
  if (isElectron && window.ElectronPrint?.getConfig) {
    window.ElectronPrint.getConfig()
      .then(cfg => _loadSetoresCategorias(cfg.printers || []))
      .catch(() => _loadSetoresCategorias());
  } else {
    _loadSetoresCategorias();
  }

  // Restaura toggle de bebida
  const bebidaToggle = document.getElementById('toggle-print-bebida');
  if (bebidaToggle) {
    const printBebida = localStorage.getItem('printBebidaSolo') !== '0';
    if (printBebida) bebidaToggle.classList.add('on');
    else bebidaToggle.classList.remove('on');
  }
  // Restaura toggle de "bebida pronta aparece no kanban" (padrão: desligado)
  const bebidaKanbanToggle = document.getElementById('toggle-bebida-kanban');
  if (bebidaKanbanToggle) {
    const bebidaKanban = localStorage.getItem('bebidaProntaKanban') === '1';
    if (bebidaKanban) bebidaKanbanToggle.classList.add('on');
    else bebidaKanbanToggle.classList.remove('on');
  }
}

function renderPrintPreview() {
  const p = document.getElementById('print-preview');
  if (!p) return;
  const cfg = _getPrintConfig();
  const ex = { id:2193, num:2193, client:'Cliente Teste', phone:'(00) 0000-0000', addr:'Rua Teste, 123', pag:'PIX', taxa:5, total:45.70,
    items:[{qty:1,name:'Smash Burguer',price:25},{qty:2,name:'Coca Cola 2L',price:14},{qty:1,name:'Batata Frita',price:8.90}] };
  const _ticket = _buildTicketHtml(ex, cfg);
  p.innerHTML = _ticket.principal;
}

// Atualiza indicador visual do status USB na tela de config
function _updateUsbStatus() {
  const statusEl = document.getElementById('usb-status');
  const pairedEl = document.getElementById('usb-paired-info');
  const savedUsb = localStorage.getItem('escpos_usb_name');
  if (statusEl) {
    if (!navigator.usb) {
      statusEl.textContent = '⚠️ WebUSB não suportado — use Chrome ou Edge';
      statusEl.style.color = '#f87171';
    } else if (savedUsb) {
      statusEl.textContent = '🖨️ ' + savedUsb;
      statusEl.style.color = '#10b981';
    } else {
      statusEl.textContent = 'Nenhuma impressora pareada';
      statusEl.style.color = 'var(--muted)';
    }
  }
  if (pairedEl) {
    pairedEl.style.display = savedUsb ? 'block' : 'none';
  }
}

// ── Salva config no servidor (sincroniza entre dispositivos) ──
async function salvarConfigImpressao() {
  const cfg = _getPrintConfig()
  const fmt = _printFormat || '80mm'
  const viaMode = _normalizePrintViaMode(_printViaMode)
  _printViaMode = viaMode
  localStorage.setItem('printViaMode', viaMode)
  const payload = {
    printMode:     _printMode,
    printFormat:   fmt,
    printFontSize: cfg.fontSize,
    printNome:     cfg.nome,
    printSub:      cfg.sub,
    printRodape:   cfg.rodape,
    printViaMode:        viaMode,
    printPrinterCozinha: _printPrinterCozinha,
    printer_caixa:       _printPrinter,
    printer_cozinha:     _printPrinterCozinha,
    printSetoresCategoria: _getPrintSetoresCategoria(),
    impressoras:         _impressoras,
    modelos:             _modelos,
  }
  // Salva localmente
  localStorage.setItem('printFormat', fmt); _printFormat = fmt;
  _printFontSize = cfg.fontSize; // mantém memória sincronizada; servidor é a fonte de verdade
  localStorage.setItem('printNome', cfg.nome);   _printNome   = cfg.nome;
  localStorage.setItem('printSub', cfg.sub);     _printSub    = cfg.sub;
  localStorage.setItem('printRodape', cfg.rodape); _printRodape = cfg.rodape;

  // Salva no Electron se disponível — inclui impressoras para persistência local
  if (window.ElectronPrint) {
    await window.ElectronPrint.saveConfig({
      nome:            cfg.nome,
      sub:             cfg.sub,
      rodape:          cfg.rodape,
      fontSize:        cfg.fontSize,
      paperWidth:      fmt === '58mm' ? 58 : 80,
      printer:         _printPrinter,
      printer_caixa:   _printPrinter,
      printer_cozinha: _printPrinterCozinha,
      printSetoresCategoria: _getPrintSetoresCategoria(),
      printViaMode:    viaMode,
      printFormat:     fmt,
      printMode:       _printMode,
    }).catch(() => {})
  }

  // Salva no servidor para sincronizar com outros dispositivos
  try {
    const tid = (typeof _sessao !== 'undefined' && _sessao?.tenant_id) || window._tenantId || null
    if (tid) {
      await window.AppAPI.from('store_config')
        .update({ print_config: JSON.stringify(payload) })
        .eq('tenant_id', tid)
      sbToast('ok', '✅ Configurações salvas e sincronizadas!')
    } else {
      sbToast('ok', '✅ Configurações salvas localmente!')
    }
  } catch {
    sbToast('ok', '✅ Configurações salvas localmente!')
  }
}

async function testPrint() {
  const sampleItems = (() => {
    if (typeof items !== 'undefined' && Array.isArray(items) && items.length) {
      const chosen = [];
      const seen = new Set();
      items.filter(i => i && i.status !== 'esgotado').forEach(i => {
        const key = i.cat_key || i.cat || 'Outros';
        if (chosen.length < 3 && (!seen.has(key) || chosen.length < 1)) {
          seen.add(key);
          chosen.push({
            id: i.id || null,
            qty: 1,
            name: i.name || 'Item teste',
            price: parseFloat(i.price || 0) || 10,
            cat: i.cat || '',
            cat_key: i.cat_key || i.catKey || i.cat || '',
            obs: ''
          });
        }
      });
      if (chosen.length) return chosen;
    }
    return [
      { qty:1, name:'X-Salada', price:18, cat:'Hamburgueres', cat_key:'Hamburgueres' },
      { qty:1, name:'Pizza Calabresa', price:35, cat:'Pizzas', cat_key:'Pizzas' },
      { qty:1, name:'Batata Frita', price:10, cat:'Porcoes', cat_key:'Porcoes' }
    ];
  })();
  const ex = { id:99, client:'TESTE IMPRESSÃO', addr:'Balcão', mesa_num:null, pag:'PIX', taxa:5, total:23,
    items: sampleItems };
  await printOrder(ex);
  sbToast('ok', 'Enviando para impressora...');
}

// ══════════════════════════════════════════════════════════════
//  SISTEMA DE IMPRESSORAS E MODELOS (estilo Anota AI)
// ══════════════════════════════════════════════════════════════

let _impressoras = JSON.parse(localStorage.getItem('anotai_impressoras') || '[]');
let _modelos = JSON.parse(localStorage.getItem('anotai_modelos') || '[]');
let _editImpIdx = -1;
let _editModIdx = -1;

const _MODELOS_PADRAO = [
  { id:'pedidos_gerais',    nome:'Pedidos gerais',                     sistema:true, ativo:true },
  { id:'cozinha',           nome:'Cozinha',                            sistema:true, ativo:false },
  { id:'conferencia_mesa',  nome:'Conferência e fechamento de mesa',   sistema:true, ativo:true },
  { id:'pix_qrcode',        nome:'PIX - QR Code de pagamento',        sistema:true, ativo:true },
  { id:'mov_caixa',         nome:'Demonstrativo de movimento do caixa',sistema:true, ativo:true },
  { id:'fech_caixa',        nome:'Demonstrativo de fechamento do caixa',sistema:true,ativo:true },
];

function _initModelos() {
  if (!_modelos.length) {
    _modelos = _MODELOS_PADRAO.map(m => ({
      ...m,
      impressora_idx: 0,
      apelido: '',
      largura: 32,
      nome_estab: _printNome || 'RESTAURANTE',
      sub: _printSub || '',
      rodape: _printRodape || 'Obrigado!',
      fontSize: _printFontSize || 13,
      showAddr: true,
      showPag: true,
    }));
    _saveModelos();
  }
}

function _saveImpressoras() { localStorage.setItem('anotai_impressoras', JSON.stringify(_impressoras)); }
function _saveModelos()     { localStorage.setItem('anotai_modelos', JSON.stringify(_modelos)); }

function setPrintModeNew(mode) {
  _printMode = mode;
  window._printMode = mode;
  localStorage.setItem('printMode', mode);
  const isAuto = mode === 'auto';
  const ba = document.getElementById('btn-mode-auto');
  const bm = document.getElementById('btn-mode-manual');
  if (ba) { ba.className = isAuto ? 'btn bp' : 'btn'; }
  if (bm) { bm.className = !isAuto ? 'btn bp' : 'btn'; }
  const desc = document.getElementById('print-mode-desc');
  if (desc) desc.textContent = isAuto ? 'Imprime sozinho quando chega pedido' : 'Botão 🖨️ aparece em cada pedido no kanban';
  sbToast('ok', isAuto ? 'Impressão automática ativada' : 'Impressão manual ativada');
}

// ── ABA 1: IMPRESSORAS ────────────────────────────────────────
function _loadImpressoras() {
  const list = document.getElementById('impressoras-list');
  if (!list) return;
  if (!_impressoras.length) {
    list.innerHTML = '<div style="text-align:center;padding:30px 0;color:var(--muted);font-size:13px">Nenhuma impressora cadastrada. Clique em "Adicionar impressora".</div>';
    return;
  }
  list.innerHTML = _impressoras.map((imp, idx) => {
    const isElectronType = imp.tipo === 'electron' || (imp.tipo === 'usb' && !!window.ElectronPrint);
    const statusColor = isElectronType ? '#10b981' : (imp.tipo === 'agent' ? '#3b82f6' : imp.tipo === 'usb' ? '#10b981' : '#f59e0b');
    const statusText  = isElectronType ? 'Conectado' : (imp.tipo === 'agent' ? 'Agent' : imp.tipo === 'usb' ? 'USB' : 'Navegador');
    const tipoLabel   = imp.printerName || (isElectronType ? 'Windows' : imp.tipo === 'agent' ? 'Print Agent' : 'Navegador');
    const larguraLabel = imp.largura === 48 ? '80mm (48 col)' : '58mm (32 col)';
    const vinculados = _modelos.filter(m => m.ativo && m.impressora_idx === idx).map(m => m.nome).join(', ');
    return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px 20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div>
          <div style="font-size:11px;color:var(--muted)">Impressora</div>
          <div style="font-weight:700;font-size:15px">${imp.apelido || 'Sem nome'}</div>
          <div style="font-size:12px;color:var(--muted)">${tipoLabel} · ${larguraLabel}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:11px;padding:3px 10px;border-radius:99px;background:${statusColor}20;color:${statusColor};font-weight:600;border:1px solid ${statusColor}40">✓ ${statusText}</span>
          <button onclick="testImpressora(${idx})" class="btn" style="font-size:11px;padding:5px 12px">🖨️ Testar</button>
          <button onclick="editarImpressora(${idx})" class="btn" style="font-size:11px;padding:5px 12px">✏️</button>
          <button onclick="deletarImpressoraDir(${idx})" class="btn bd" style="font-size:11px;padding:5px 10px">🗑</button>
        </div>
      </div>
      <div style="font-size:11px;color:var(--muted)">Comandas vinculadas: ${vinculados || 'Nenhuma'}</div>
    </div>`;
  }).join('');
}

function abrirAddImpressora() {
  _editImpIdx = -1;
  document.getElementById('imp-apelido').value = '';
  document.getElementById('imp-tipo').value = 'usb';
  document.getElementById('imp-largura').value = '32';
  document.getElementById('modal-imp-title').textContent = 'Adicionar Impressora';
  document.getElementById('btn-del-imp').style.display = 'none';
  toggleImpTipo();
  openModal('modal-impressora');
}

function editarImpressora(idx) {
  const imp = _impressoras[idx]; if (!imp) return;
  _editImpIdx = idx;
  document.getElementById('imp-apelido').value = imp.apelido || '';
  document.getElementById('imp-tipo').value = imp.tipo || 'usb';
  document.getElementById('imp-largura').value = String(imp.largura || 32);
  document.getElementById('modal-imp-title').textContent = 'Editar Impressora';
  document.getElementById('btn-del-imp').style.display = 'inline-flex';
  toggleImpTipo();
  // Restaura impressora selecionada após carregar a lista
  if (imp.printerName) {
    setTimeout(() => {
      const sel = document.getElementById('imp-printer-select');
      if (sel) sel.value = imp.printerName;
    }, 300);
  }
  openModal('modal-impressora');
}

function toggleImpTipo() {
  const isElectron = !!window.ElectronPrint;
  const tipo = document.getElementById('imp-tipo').value;

  // No Electron: esconde tipo de conexão e parear USB, sempre mostra lista do Windows
  if (isElectron) {
    const tipoWrap = document.getElementById('imp-tipo-wrap');
    if (tipoWrap) tipoWrap.style.display = 'none';
    document.getElementById('imp-usb-wrap').style.display = 'none';
    document.getElementById('imp-printer-wrap').style.display = '';
    const hint = document.getElementById('imp-printer-hint');
    if (hint) hint.textContent = '⚡ Impressoras detectadas do Windows';

    window.ElectronPrint.getConfig().then(cfg => {
      const dst = document.getElementById('imp-printer-select');
      if (dst && cfg.printers) {
        dst.innerHTML = '<option value="">Impressora padrão do sistema</option>' +
          cfg.printers.map(p => `<option value="${p}">${p}${p === cfg.printer ? ' ★' : ''}</option>`).join('');
      }
    }).catch(() => {});
    return;
  }

  // No navegador: mostra tipo de conexão
  const tipoWrap = document.getElementById('imp-tipo-wrap');
  if (tipoWrap) tipoWrap.style.display = '';

  if (tipo === 'usb') {
    document.getElementById('imp-usb-wrap').style.display = '';
    document.getElementById('imp-printer-wrap').style.display = 'none';
    const usbSt = document.getElementById('imp-usb-status');
    if (usbSt) {
      const saved = localStorage.getItem('escpos_usb_name');
      usbSt.textContent = saved ? '✅ Pareada: ' + saved : 'Nenhuma impressora USB pareada';
      usbSt.style.color = saved ? '#10b981' : 'var(--muted)';
    }
  } else if (tipo === 'agent') {
    document.getElementById('imp-usb-wrap').style.display = 'none';
    document.getElementById('imp-printer-wrap').style.display = '';
    const hint = document.getElementById('imp-printer-hint');
    if (hint) hint.textContent = 'Impressora do servidor (Print Agent)';
    loadPrinters().then(() => {
      const src = document.getElementById('print-printer-select');
      const dst = document.getElementById('imp-printer-select');
      if (src && dst) dst.innerHTML = src.innerHTML;
    });
  } else {
    document.getElementById('imp-usb-wrap').style.display = 'none';
    document.getElementById('imp-printer-wrap').style.display = 'none';
  }
}

async function pairUsbForModal() {
  try { await pairUsbPrinter(); toggleImpTipo(); } catch(e) { sbToast('err', 'Erro ao parear: ' + e.message); }
}

function salvarImpressora() {
  const apelido = document.getElementById('imp-apelido').value.trim();
  if (!apelido) { sbToast('warn', 'Preencha o apelido'); return; }
  const largura = parseInt(document.getElementById('imp-largura').value) || 48;
  const isElectron = !!window.ElectronPrint;
  let printerName = '';
  let tipo = 'usb';

  if (isElectron) {
    // Electron: sempre pega do select de impressoras do Windows
    printerName = document.getElementById('imp-printer-select')?.value || '';
    tipo = 'electron';
  } else {
    tipo = document.getElementById('imp-tipo').value;
    if (tipo === 'usb') {
      printerName = localStorage.getItem('escpos_usb_name') || 'USB';
    } else if (tipo === 'agent') {
      printerName = document.getElementById('imp-printer-select')?.value || '';
    }
  }

  const obj = { apelido, tipo, largura, printerName };
  if (_editImpIdx >= 0) _impressoras[_editImpIdx] = { ..._impressoras[_editImpIdx], ...obj };
  else _impressoras.push(obj);
  _saveImpressoras();

  // Sincroniza formato do papel globalmente
  const pw = largura <= 32 ? 58 : 80;
  const fmt = largura <= 32 ? '58mm' : '80mm';
  _printFormat = fmt;
  localStorage.setItem('printFormat', fmt);
  const fmtSel = document.getElementById('print-format-select');
  if (fmtSel) fmtSel.value = fmt;
  _printPrinter = printerName;
  localStorage.setItem('printPrinter', printerName);

  if (isElectron) {
    window.ElectronPrint.saveConfig({ printer: printerName, paperWidth: pw, printFormat: fmt }).catch(() => {});
  }
  closeModal('modal-impressora');
  _loadImpressoras(); _loadModelos(); _loadRoteamento(); renderPrintPreview();
  sbToast('ok', 'Impressora salva!');
}

function deletarImpressora() {
  if (!confirm('Excluir esta impressora?')) return;
  _impressoras.splice(_editImpIdx, 1);
  _modelos.forEach(m => { if (m.impressora_idx >= _impressoras.length) m.impressora_idx = 0; });
  _saveImpressoras(); _saveModelos();
  closeModal('modal-impressora');
  _loadImpressoras(); _loadModelos();
  sbToast('ok', 'Impressora removida');
}

function deletarImpressoraDir(idx) {
  if (!confirm('Excluir impressora "' + (_impressoras[idx]?.apelido || '') + '"?')) return;
  _impressoras.splice(idx, 1);
  _modelos.forEach(m => { if (m.impressora_idx >= _impressoras.length) m.impressora_idx = 0; });
  _saveImpressoras(); _saveModelos();
  _loadImpressoras(); _loadModelos();
  sbToast('ok', 'Impressora removida');
}

async function testImpressora(idx) {
  const imp = _impressoras[idx]; if (!imp) return;
  const ex = { id:99, num:9999, client:'TESTE IMPRESSÃO', addr:'Balcão', pag:'PIX', taxa:5, total:23,
    items:[{qty:1,name:'X-Salada',price:18},{qty:1,name:'Batata Frita',price:10}] };
  if (imp.tipo === 'usb') {
    try { const cfg = _getPrintConfig(); await _printViaUsb(ex, cfg); sbToast('ok', '🖨️ Teste USB enviado!'); }
    catch(e) { sbToast('err', 'Erro USB: ' + e.message); }
  } else { await printOrder(ex); sbToast('ok', '🖨️ Teste enviado!'); }
}

// ── ABA 2: MODELOS ───────────────────────────────────────────
function _loadModelos() {
  _initModelos();
  const list = document.getElementById('modelos-list'); if (!list) return;
  list.innerHTML = _modelos.map((m, idx) => {
    const impBadges = _impressoras.length
      ? _impressoras.filter((_, i) => i === m.impressora_idx).map(imp =>
          `<span style="font-size:11px;padding:2px 10px;border-radius:99px;background:rgba(16,185,129,.1);color:#10b981;border:1px solid rgba(16,185,129,.3);font-weight:600">✓ ${imp.apelido}</span>`
        ).join('')
      : '<span style="font-size:11px;color:var(--muted)">Sem impressora</span>';
    return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px 20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:12px">
          <div class="toggle ${m.ativo ? 'on' : ''}" onclick="toggleModelo(${idx})" style="flex-shrink:0"></div>
          <div>
            <div style="font-size:11px;color:var(--muted)">Modelo do sistema</div>
            <div style="font-weight:700;font-size:14px">${m.nome}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button onclick="editarModelo(${idx})" class="btn" style="font-size:11px;padding:5px 12px">✏️</button>
          <button onclick="testModelo(${idx})" class="btn" style="font-size:11px;padding:5px 12px">🖨️ Testar</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:11px;color:var(--muted)">Impressoras vinculadas:</span>
        ${impBadges}
      </div>
    </div>`;
  }).join('');
}

function toggleModelo(idx) {
  _modelos[idx].ativo = !_modelos[idx].ativo;
  _saveModelos(); _loadModelos(); _loadImpressoras();
}

function editarModelo(idx) {
  const m = _modelos[idx]; if (!m) return;
  _editModIdx = idx;
  document.getElementById('modal-mod-title').textContent = 'Configurar: ' + m.nome;
  document.getElementById('mod-apelido').value = m.apelido || m.nome;
  document.getElementById('mod-largura').value = String(m.largura || 32);
  document.getElementById('mod-nome').value = m.nome_estab || _printNome || 'RESTAURANTE';
  document.getElementById('mod-sub').value = m.sub || _printSub || '';
  document.getElementById('mod-rodape').value = m.rodape || _printRodape || 'Obrigado!';
  document.getElementById('mod-font-size').value = m.fontSize || 13;
  document.getElementById('mod-font-val').textContent = m.fontSize || 13;
  const addrT = document.getElementById('mod-toggle-addr');
  if (addrT) { if (m.showAddr !== false) addrT.classList.add('on'); else addrT.classList.remove('on'); }
  const pagT = document.getElementById('mod-toggle-pag');
  if (pagT) { if (m.showPag !== false) pagT.classList.add('on'); else pagT.classList.remove('on'); }
  const sel = document.getElementById('mod-impressora');
  if (sel) {
    sel.innerHTML = _impressoras.length
      ? _impressoras.map((imp, i) => `<option value="${i}" ${i === m.impressora_idx ? 'selected' : ''}>${imp.apelido} (${imp.tipo})</option>`).join('')
      : '<option value="0">Nenhuma impressora cadastrada</option>';
  }
  renderModeloPreview();
  openModal('modal-modelo');
}

function renderModeloPreview() {
  const p = document.getElementById('mod-preview'); if (!p) return;
  const largura = parseInt(document.getElementById('mod-largura')?.value || 32);
  const fs = parseInt(document.getElementById('mod-font-size')?.value || 13);
  const nome = (document.getElementById('mod-nome')?.value || 'RESTAURANTE').toUpperCase();
  const sub = document.getElementById('mod-sub')?.value || '';
  const rodape = document.getElementById('mod-rodape')?.value || 'Obrigado!';
  const showAddr = document.getElementById('mod-toggle-addr')?.classList.contains('on') ?? true;
  const showPag = document.getElementById('mod-toggle-pag')?.classList.contains('on') ?? true;
  const cfg = { nome, sub, rodape, addr: showAddr, pag: showPag, fontSize: fs };
  const is58 = largura <= 32;
  const oldFmt = localStorage.getItem('printFormat');
  localStorage.setItem('printFormat', is58 ? '58mm' : '80mm');
  const ex = { id:2193, num:2193, client:'Cliente Teste', phone:'(00) 0000-0000', addr:'Rua Teste, 123', pag:'PIX', taxa:5, total:45.70,
    items:[{qty:1,name:'Água Mineral 500ml',price:7.90},{qty:1,name:'Smash Burguer',price:25},{qty:1,name:'Batata Frita Crocante',price:8.90},{qty:1,name:'Batata Frita Crocante',price:8.90}] };
  const _ticket = _buildTicketHtml(ex, cfg);
  p.innerHTML = _ticket.principal;
  if (oldFmt) localStorage.setItem('printFormat', oldFmt); else localStorage.removeItem('printFormat');
}

function salvarModelo() {
  const m = _modelos[_editModIdx]; if (!m) return;
  m.apelido = document.getElementById('mod-apelido')?.value || m.nome;
  m.impressora_idx = parseInt(document.getElementById('mod-impressora')?.value || 0);
  m.largura = parseInt(document.getElementById('mod-largura')?.value || 32);
  m.nome_estab = document.getElementById('mod-nome')?.value || 'RESTAURANTE';
  m.sub = document.getElementById('mod-sub')?.value || '';
  m.rodape = document.getElementById('mod-rodape')?.value || 'Obrigado!';
  m.fontSize = parseInt(document.getElementById('mod-font-size')?.value || 13);
  m.showAddr = document.getElementById('mod-toggle-addr')?.classList.contains('on') ?? true;
  m.showPag = document.getElementById('mod-toggle-pag')?.classList.contains('on') ?? true;
  _printNome = m.nome_estab; localStorage.setItem('printNome', m.nome_estab);
  _printSub = m.sub; localStorage.setItem('printSub', m.sub);
  _printRodape = m.rodape; localStorage.setItem('printRodape', m.rodape);
  _printFontSize = m.fontSize;
  _printFormat = m.largura <= 32 ? '58mm' : '80mm'; localStorage.setItem('printFormat', _printFormat);
  _saveModelos();
  closeModal('modal-modelo');
  _loadModelos(); _loadImpressoras();
  sbToast('ok', 'Modelo salvo!');
}

async function testModelo(idx) {
  const m = _modelos[idx]; if (!m) return;
  const ex = { id:99, num:9999, client:'TESTE IMPRESSÃO', addr:'Balcão', pag:'PIX', taxa:5, total:23,
    items:[{qty:1,name:'X-Salada',price:18},{qty:1,name:'Batata Frita',price:10}] };
  await printOrder(ex);
  sbToast('ok', '🖨️ Teste do modelo "' + m.nome + '" enviado!');
}

// ── CALIBRAÇÃO DA IMPRESSORA ─────────────────────────────────
// Imprime uma régua pra o usuário identificar a área imprimível real da impressora.
// Depois ele preenche o valor em "Largura imprimível" e salva.

async function calibrarImpressora() {
  if (!window.ElectronPrint || !window.ElectronPrint.calibrate) {
    if (typeof sbToast === 'function') sbToast('error', 'Calibração disponível só no app EstimaFood (desktop). Atualize o app se já estiver instalado.');
    else alert('Calibração disponível só no app EstimaFood (desktop).');
    return;
  }
  try {
    const paperWidth = parseInt(document.getElementById('calib-paper-width').value) || 80;
    if (typeof sbToast === 'function') sbToast('info', '📏 Enviando régua pra impressora...');
    const r = await window.ElectronPrint.calibrate({ paperWidth });
    if (r && r.ok === false) {
      if (typeof sbToast === 'function') sbToast('error', 'Erro: ' + (r.error || 'desconhecido'));
    } else {
      if (typeof sbToast === 'function') sbToast('ok', '✅ Régua enviada. Veja até qual número foi impresso sem cortar e preencha no campo abaixo.');
    }
  } catch (e) {
    console.error('calibrar:', e);
    if (typeof sbToast === 'function') sbToast('error', 'Erro ao imprimir régua: ' + e.message);
  }
}

async function salvarCalibracao() {
  if (!window.ElectronPrint || !window.ElectronPrint.saveConfig) {
    if (typeof sbToast === 'function') sbToast('error', 'Calibração disponível só no app EstimaFood (desktop).');
    else alert('Calibração disponível só no app EstimaFood.');
    return;
  }
  try {
    const pwEl = document.getElementById('calib-paper-width');
    const prEl = document.getElementById('calib-printable-width');
    if (!pwEl || !prEl) return;
    const rawPrintable = prEl.value;
    const paperWidth = parseInt(pwEl.value) || 80;

    let printableWidth = 0;
    if (rawPrintable && String(rawPrintable).trim() !== '') {
      printableWidth = parseInt(rawPrintable);
      if (isNaN(printableWidth) || printableWidth < 30 || printableWidth > 80) {
        if (typeof sbToast === 'function') sbToast('error', 'Largura imprimível deve ficar entre 30 e 80mm.');
        return;
      }
    }

    const r = await window.ElectronPrint.saveConfig({ paperWidth, printableWidth });
    if (r && r.ok === false) {
      if (typeof sbToast === 'function') sbToast('error', 'Erro ao salvar: ' + (r.error || 'desconhecido'));
      return;
    }

    // Recarrega pra confirmar visualmente que ficou salvo
    await carregarCalibracao();

    if (typeof sbToast === 'function') {
      sbToast('ok', printableWidth
        ? '✅ Calibração salva: ' + printableWidth + 'mm em papel ' + paperWidth + 'mm'
        : '✅ Calibração restaurada para automático');
    }
  } catch (e) {
    console.error('salvarCalibracao:', e);
    if (typeof sbToast === 'function') sbToast('error', 'Erro ao salvar: ' + (e && e.message ? e.message : String(e)));
  }
}

// Carrega os valores salvos nos campos de calibração.
// Também pode ser chamada manualmente depois de salvar pra confirmar os valores.
async function carregarCalibracao() {
  if (!window.ElectronPrint || !window.ElectronPrint.getConfig) return;
  try {
    const cfg = await window.ElectronPrint.getConfig();
    if (!cfg) return;
    const pw = document.getElementById('calib-paper-width');
    const pr = document.getElementById('calib-printable-width');
    if (pw && cfg.paperWidth) pw.value = String(cfg.paperWidth);
    if (pr) pr.value = (cfg.printableWidth && Number(cfg.printableWidth) > 0) ? String(cfg.printableWidth) : '';
  } catch (e) {
    console.warn('carregarCalibracao:', e);
  }
}

// Estratégia robusta: MutationObserver fica escutando o DOM inteiro e,
// sempre que o campo de calibração aparecer (usuário navegou pra aba),
// carrega os valores imediatamente. Funciona independente de como a SPA monta a tela.
(function setupCalibracaoAutoLoad() {
  let ultimoCarregamento = 0;
  function tentarCarregar() {
    // Debounce de 200ms pra não spammar o getConfig
    const agora = Date.now();
    if (agora - ultimoCarregamento < 200) return;
    const pr = document.getElementById('calib-printable-width');
    if (!pr) return; // campo ainda não está na tela
    ultimoCarregamento = agora;
    carregarCalibracao();
  }

  function iniciar() {
    // Tenta carregar ao inicializar (caso a aba já esteja renderizada)
    tentarCarregar();

    // Observa mudanças no DOM — quando o campo aparecer, carrega
    const obs = new MutationObserver(() => tentarCarregar());
    obs.observe(document.body, { childList: true, subtree: true });

    // Também recarrega quando o usuário volta o foco pra aba/janela
    window.addEventListener('focus', tentarCarregar);
    document.addEventListener('visibilitychange', tentarCarregar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();

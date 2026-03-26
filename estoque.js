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

function setDesempPrd(prd) {
  _desempPrd = prd;
  ['diario','semanal','mensal','anual'].forEach(id => {
    const btn = document.getElementById('dpb-' + id);
    if (!btn) return;
    const active = id === prd;
    btn.style.background  = active ? 'var(--accent)' : '';
    btn.style.color       = active ? '#fff' : '';
    btn.style.borderColor = active ? 'var(--accent)' : '';
  });
  renderDesempenho();
}

function _desempGetRange() {
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
    const since = range.inicio.toISOString();
    const ate   = range.fim.toISOString();

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
    const entregues = orders.filter(o => !['cancelado'].includes(o.status));

    // ── KPIs ─────────────────────────────
    const totalPedidos   = orders.length;
    const faturamento    = entregues.reduce((s,o) => s + parseFloat(o.total||0), 0);
    const ticketMedio    = totalPedidos > 0 ? faturamento / totalPedidos : 0;
    const cancelados     = orders.filter(o => o.status === 'cancelado').length;
    const taxaCancelamento = totalPedidos > 0 ? (cancelados / totalPedidos * 100) : 0;
    const mesasSet       = new Set(orders.map(o => o.mesa_num).filter(Boolean));
    const itensQtd       = entregues.reduce((s,o) => {
      if (!Array.isArray(o.items)) return s;
      return s + o.items.reduce((si,i) => si + (i.qty||1), 0);
    }, 0);

    const metrics = [
      { label:'Faturamento', val: 'R$ ' + faturamento.toFixed(2).replace('.',','), icon:'💰', color:'var(--accent3)' },
      { label:'Total de pedidos', val: totalPedidos, icon:'🛎️', color:'var(--accent)' },
      { label:'Ticket médio', val: 'R$ ' + ticketMedio.toFixed(2).replace('.',','), icon:'🎯', color:'var(--purple)' },
      { label:'Mesas atendidas', val: mesasSet.size, icon:'🍽️', color:'var(--success)' },
      { label:'Itens vendidos', val: itensQtd, icon:'📦', color:'var(--accent2)' },
      { label:'Cancelamentos', val: cancelados + (taxaCancelamento > 0 ? ` (${taxaCancelamento.toFixed(1)}%)` : ''), icon:'❌', color: cancelados > 0 ? 'var(--danger)' : 'var(--muted)' },
    ];

    if (dg) dg.innerHTML = metrics.map(m => `
      <div class="desemp-card">
        <div style="font-size:24px;margin-bottom:4px">${m.icon}</div>
        <div class="desemp-label">${m.label}</div>
        <div class="desemp-val" style="font-size:22px;color:${m.color}">${m.val}</div>
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
          const emoji = menuItem?.emoji || '🍽️';
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

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
        🎂 ${c.name || '?'} ${c.phone ? `<span style="color:var(--muted);font-weight:400">${c.phone}</span>` : ''}
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

  _cliSet('modal-cli-title', `👤 ${c.name || 'Cliente'}`);
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

  const stLabel = { analise:'⏳ Aguardando', producao:'👨‍🍳 Preparo', pronto:'✅ Pronto', saiu:'🛵 Saiu', entregue:'🎉 Entregue', cancelado:'❌ Cancelado', finalizado:'✅ Finalizado', aguardando_pix:'⏳ Aguard. PIX', aguardando_cartao:'💳 Aguard. Cartão' };
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

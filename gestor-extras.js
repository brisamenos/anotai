// ═══════════════════════════════════════════════════════════
// GESTOR-EXTRAS: Histórico, Fornecedores, Contas a Pagar,
//                DRE Simplificado, Exportação de Relatórios
// ═══════════════════════════════════════════════════════════

const _tid = () => { try { return JSON.parse(sessionStorage.getItem('sys_session')||'{}').tenant_id||'' } catch{return''} };
const _money = v => 'R$ ' + parseFloat(v||0).toFixed(2).replace('.',',');

// ─────────────────────────────────────────
// 1. HISTÓRICO DE PEDIDOS
// ─────────────────────────────────────────
let _histPage = 1;
let _histData = [];

async function renderHistorico() {
  const list = document.getElementById('hist-list');
  const stats = document.getElementById('hist-stats');
  if (list) list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px">Carregando...</div>';
  _histPage = 1;
  await _histBuscar();
}

async function _histBuscar() {
  const list = document.getElementById('hist-list');
  const q = document.getElementById('hist-search')?.value || '';
  const status = document.getElementById('hist-status')?.value || '';
  const de = document.getElementById('hist-de')?.value || '';
  const ate = document.getElementById('hist-ate')?.value || '';

  const params = new URLSearchParams({ page: _histPage, limit: 50 });
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (de) params.set('de', de + 'T00:00:00');
  if (ate) params.set('ate', ate);

  try {
    const res = await fetch('/api/historico-pedidos?' + params, {
      headers: { 'x-tenant-id': _tid() }
    });
    const data = await res.json();
    _histData = data.orders || [];

    const elTotal = document.getElementById('hist-total');
    const elPages = document.getElementById('hist-pages');
    if (elTotal) elTotal.textContent = data.total || 0;
    if (elPages) elPages.textContent = `Página ${data.page} de ${data.pages || 1}`;

    const btnPrev = document.getElementById('hist-prev');
    const btnNext = document.getElementById('hist-next');
    if (btnPrev) btnPrev.disabled = data.page <= 1;
    if (btnNext) btnNext.disabled = data.page >= data.pages;

    if (!list) return;
    if (!_histData.length) {
      list.innerHTML = '<div style="text-align:center;padding:48px 20px;color:var(--muted);font-size:13.5px"><strong style="display:block;color:var(--text);font-size:14.5px;margin-bottom:4px">Nenhum pedido encontrado</strong>Tente outro período ou limpe a busca.</div>';
      return;
    }

    const statusMap = {
      analise:'Em análise', producao:'Em produção', pronto:'Pronto',
      entregue:'Entregue', finalizado:'Finalizado', cancelado:'Cancelado',
      mesa_aberta:'Mesa aberta', aguardando_pix:'Aguardando PIX', aguardando_cartao:'Aguardando cartão'
    };
    // cor da etiqueta: ok (verde), warn (amarelo), bad (vermelho), info (azul)
    const statusTom = {
      analise:'warn', producao:'info', pronto:'ok', entregue:'ok', finalizado:'ok', cancelado:'bad',
      mesa_aberta:'info', aguardando_pix:'warn', aguardando_cartao:'warn'
    };
    const pagNome = v => {
      const k = String(v || '').toLowerCase().trim();
      const mapa = { pix:'PIX', pix_manual:'PIX (manual)', pix_online:'PIX online', dinheiro:'Dinheiro', cartao:'Cartão', credito:'Crédito', debito:'Débito', mesa:'Na mesa', cartao_online:'Cartão online' };
      if (!k) return '—';
      return mapa[k] || (String(v).charAt(0).toUpperCase() + String(v).slice(1));
    };
    const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    const icoPrint = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="4" y="2" width="8" height="3.5" rx=".8" stroke="currentColor" stroke-width="1.4"/><rect x="4" y="10" width="8" height="4" rx=".8" stroke="currentColor" stroke-width="1.4"/><path d="M4 11.5H3a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1" stroke="currentColor" stroke-width="1.4"/></svg>';
    const icoRecibo = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 1.5h9v13l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1v-13Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6 5h4M6 7.5h4M6 10h2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
    const icoLixo = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4.5h10M6.5 4.5V3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1.5M4.5 4.5l.6 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    list.innerHTML = `<div class="pf-table-wrap"><table>
      <thead><tr>
        <th style="text-align:left">Pedido</th>
        <th style="text-align:left">Cliente</th>
        <th style="text-align:left">Itens</th>
        <th class="pf-num">Total</th>
        <th style="text-align:left">Pagamento</th>
        <th style="text-align:left">Situação</th>
        <th style="text-align:left">Data</th>
        <th></th>
      </tr></thead><tbody>
      ${_histData.map(o => {
        const items = Array.isArray(o.items) ? o.items : [];
        const itensStr = items.map(i => `${i.qty}x ${i.name}`).join(', ');
        // created_at vem do SQLite como "YYYY-MM-DD HH:MM:SS" em UTC, sem
        // indicação de fuso. Sem o "Z", o navegador interpretava como
        // horário LOCAL do dispositivo, mostrando a hora errada (não batia
        // com Brasília). Acrescenta "Z" pra deixar explícito que é UTC, e
        // força a exibição no fuso de Brasília independente do dispositivo.
        const dt = o.created_at ? new Date(o.created_at.replace(' ', 'T') + 'Z').toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}) : '';
        const num = o.order_num || o.id;
        return `<tr>
          <td style="font-weight:750;color:var(--accent);white-space:nowrap">#${num}</td>
          <td><div style="font-weight:650">${esc(o.client||'—')}</div><div style="font-size:12.5px;color:var(--muted)">${o.mesa_num ? 'Mesa ' + esc(o.mesa_num) : esc(o.phone||'')}</div></td>
          <td style="max-width:260px"><div style="font-size:13px;color:var(--muted2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(itensStr)}">${esc(itensStr)||'—'}</div></td>
          <td class="pf-num" style="font-weight:750;white-space:nowrap">${_money(parseFloat(o.total||0)+parseFloat(o.taxa||0))}</td>
          <td style="white-space:nowrap">${esc(pagNome(o.pag))}</td>
          <td><span class="pf-chip ${statusTom[o.status]||''}">${statusMap[o.status]||esc(o.status)}</span></td>
          <td style="color:var(--muted);white-space:nowrap">${dt}</td>
          <td style="white-space:nowrap;text-align:right">
            <button class="btn bg pf-sm" onclick="histDetalhe(${o.id})">Ver</button>
            <button class="btn bg pf-sm pf-icon" title="Imprimir de novo" aria-label="Imprimir de novo" onclick="histReimprimir(${o.id})">${icoPrint}</button>
            <button class="btn bg pf-sm pf-icon" title="Imprimir recibo" aria-label="Imprimir recibo" onclick="histRecibo(${o.id})" style="color:#16a34a">${icoRecibo}</button>
            <button class="btn bd pf-sm pf-icon" title="Excluir pedido (não dá para desfazer)" aria-label="Excluir pedido" onclick="histExcluir(${o.id})">${icoLixo}</button>
          </td>
        </tr>`;
      }).join('')}
      </tbody></table></div>`;
  } catch(e) {
    if (list) list.innerHTML = `<div style="color:var(--danger);padding:20px;text-align:center">Erro: ${e.message}</div>`;
  }
}

// Recibo do pedido (mesmo do detalhe do pedido no quadro de pedidos)
function histRecibo(orderId) {
  const o = _histData.find(x => x.id === orderId);
  if (!o) return;
  if (o.status === 'cancelado' && !confirm('Este pedido foi cancelado. Imprimir o recibo mesmo assim?')) return;
  if (typeof imprimirReciboDoPedido === 'function') imprimirReciboDoPedido(o);
}

function histPrev() { if (_histPage > 1) { _histPage--; _histBuscar(); } }
function histNext() { _histPage++; _histBuscar(); }
function histFiltrar() { _histPage = 1; _histBuscar(); }

// ── Excluir pedido do histórico (irreversível) ──────────────────────────────
// Remove o pedido por completo e qualquer lançamento financeiro ligado a ele
// (não conta mais em nenhum relatório). Exige a senha do gestor — reaproveita
// a mesma trava usada pra liberar a área financeira.
function histExcluir(orderId) {
  const o = _histData.find(x => x.id === orderId);
  if (!o) return;
  const num = o.order_num || o.id;
  const total = _money(parseFloat(o.total||0) + parseFloat(o.taxa||0));
  const confirmMsg = `Excluir o pedido #${num} (${total}) do histórico?\n\n` +
    `Esta ação NÃO pode ser desfeita. O pedido some do sistema e nenhum valor dele\n` +
    `entra em relatório ou financeiro nunca mais.`;
  if (!confirm(confirmMsg)) return;

  const executar = () => _histExcluirConfirmado(orderId);
  if (typeof financeIsUnlocked === 'function' && financeIsUnlocked()) {
    executar();
  } else if (typeof financeOpenUnlockModal === 'function') {
    financeOpenUnlockModal(executar);
  } else {
    sbToast('err', 'Não foi possível verificar a senha do gestor.');
  }
}

async function _histExcluirConfirmado(orderId) {
  try {
    const headers = { 'Content-Type': 'application/json', 'x-tenant-id': _tid() };
    if (typeof financeAuthHeaders === 'function') Object.assign(headers, financeAuthHeaders());
    const res = await fetch('/api/historico-pedidos/excluir', {
      method: 'POST',
      headers,
      body: JSON.stringify({ order_id: orderId })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && data.error === 'FINANCE_LOCKED') {
      if (typeof financeOpenUnlockModal === 'function') {
        financeOpenUnlockModal(() => _histExcluirConfirmado(orderId));
      }
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Erro ao excluir');
    sbToast('ok', 'Pedido excluído do histórico.');
    _histBuscar();
  } catch(e) {
    sbToast('err', 'Erro ao excluir pedido: ' + (e.message || e));
  }
}

// Reimprime um pedido do histórico usando o mesmo fluxo padrão de impressão
// (respeita via única/separada, impressora configurada, formato, etc.)
async function histReimprimir(id) {
  const o = _histData.find(x => x.id === id);
  if (!o) { sbToast?.('err', 'Pedido não encontrado no histórico.'); return; }
  try {
    if (typeof mapOrder !== 'function' || typeof printOrder !== 'function') {
      sbToast?.('err', 'Impressão indisponível nesta tela.'); return;
    }
    const mapped = mapOrder({ ...o, items: o.items || [] });
    await printOrder(mapped);
    sbToast?.('ok', `Pedido #${o.order_num || o.id} enviado para impressão.`);
  } catch (e) {
    console.error('[HIST REIMPRIMIR] erro:', e);
    sbToast?.('err', 'Erro ao reimprimir: ' + e.message);
  }
}

function histDetalhe(id) {
  const o = _histData.find(x => x.id === id);
  if (!o) return;
  const items = Array.isArray(o.items) ? o.items : [];
  const num = o.order_num || o.id;
  // Mesmo motivo do fix na listagem: "Z" garante interpretação como UTC,
  // e timeZone força exibição em Brasília independente do dispositivo.
  const dt = o.created_at ? new Date(o.created_at.replace(' ', 'T') + 'Z').toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : '';
  const subtotal = items.reduce((s,i) => s + (parseFloat(i.price||0) * (i.qty||1)), 0);
  const esc = typeof _printHtmlEscape === 'function' ? _printHtmlEscape : (s => String(s ?? ''));

  // Se o garçom dividiu a mesa por pessoa (cliente_nome no item), agrupa os
  // itens por quem consumiu — mesmo tratamento do Relatório de Mesas.
  const temDivisaoCliente = items.some(i => String(i?.cliente_nome || '').trim());
  let itensHtml;
  if (!temDivisaoCliente) {
    itensHtml = items.map(i => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
      <span>${i.qty}x ${esc(i.name)}${i.obs?' <span style="color:var(--muted);font-size:11px">('+esc(i.obs)+')</span>':''}</span>
      <span style="font-weight:600">${_money(parseFloat(i.price||0)*(i.qty||1))}</span>
    </div>`).join('');
  } else {
    const porCliente = new Map();
    items.forEach(i => {
      const nomeCliente = String(i.cliente_nome || '').trim() || 'Mesa toda (sem divisão)';
      if (!porCliente.has(nomeCliente)) porCliente.set(nomeCliente, []);
      porCliente.get(nomeCliente).push(i);
    });
    itensHtml = [...porCliente.entries()].map(([nomeCliente, lista]) => {
      const subtotalCliente = lista.reduce((s,i) => s + (parseFloat(i.price||0) * (i.qty||1)), 0);
      const rows = lista.map(i => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
        <span>${i.qty}x ${esc(i.name)}${i.obs?' <span style="color:var(--muted);font-size:11px">('+esc(i.obs)+')</span>':''}</span>
        <span style="font-weight:600">${_money(parseFloat(i.price||0)*(i.qty||1))}</span>
      </div>`).join('');
      return `<div style="margin-bottom:10px">
        <div style="font-size:11px;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.3px;margin-bottom:2px">👤 ${esc(nomeCliente)}</div>
        ${rows}
        <div style="display:flex;justify-content:space-between;font-size:11.5px;font-weight:700;padding-top:4px">
          <span>Subtotal ${esc(nomeCliente)}</span>
          <span>${_money(subtotalCliente)}</span>
        </div>
      </div>`;
    }).join('');
  }

  const html = `<div style="padding:20px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="font-size:18px;font-weight:800">Pedido #${num}</div>
      <div style="display:flex;align-items:center;gap:10px">
        <div style="font-size:12px;color:var(--muted)">${dt}</div>
        <button class="btn bg" style="font-size:11px;padding:5px 10px" onclick="histReimprimir(${o.id})">🖨️ Imprimir novamente</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
      <div><div style="font-size:11px;color:var(--muted)">Cliente</div><div style="font-weight:600">${o.client||'—'}</div></div>
      <div><div style="font-size:11px;color:var(--muted)">Telefone</div><div>${o.phone||'—'}</div></div>
      <div><div style="font-size:11px;color:var(--muted)">Endereço</div><div style="font-size:12px">${o.addr||'—'}</div></div>
      <div><div style="font-size:11px;color:var(--muted)">Pagamento</div><div>${o.pag||'—'}</div></div>
      ${o.mesa_num?`<div><div style="font-size:11px;color:var(--muted)">Mesa</div><div>${o.mesa_num}</div></div>`:''}
      ${o.garcom_nome?`<div><div style="font-size:11px;color:var(--muted)">Garçom</div><div>${o.garcom_nome}</div></div>`:''}
    </div>
    <div style="font-size:12px;font-weight:700;margin-bottom:8px">Itens</div>
    ${itensHtml}
    <div style="margin-top:12px;padding-top:10px;border-top:2px solid var(--border)">
      ${parseFloat(o.taxa||0)>0?`<div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px"><span>Subtotal</span><span>${_money(subtotal)}</span></div><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px"><span>Taxa</span><span>${_money(o.taxa)}</span></div>`:''}
      <div style="display:flex;justify-content:space-between;font-weight:800;font-size:14px"><span>TOTAL</span><span style="color:var(--success)">${_money(parseFloat(o.total||0)+parseFloat(o.taxa||0))}</span></div>
    </div>
  </div>`;

  document.getElementById('modal-hist-body').innerHTML = html;
  openModal('modal-hist-detalhe');
}

// ─────────────────────────────────────────
// 2. FORNECEDORES
// ─────────────────────────────────────────
let fornecedoresCache = [];

const _PF_ICO = {
  editar: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.2 2.3l2.5 2.5L5.6 12.9l-3.1.6.6-3.1 8.1-8.1z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  excluir: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4.5h10M6.5 4.5V3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1.5M4.5 4.5l.6 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  ok: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8.3l3.3 3.2L13 4.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
const _pfEsc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

async function renderFornecedores() {
  const list = document.getElementById('forn-list');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:13.5px">Carregando...</div>';

  try {
    const { data } = await sb.from('fornecedores').select('*').order('nome');
    fornecedoresCache = data || [];
  } catch(e) { fornecedoresCache = []; }

  const elTotal = document.getElementById('forn-total');
  if (elTotal) elTotal.textContent = fornecedoresCache.length;

  if (!fornecedoresCache.length) {
    list.className = '';
    list.innerHTML = '<div class="pf-empty"><strong>Nenhum fornecedor cadastrado</strong>Use o botão Novo fornecedor para começar.</div>';
    return;
  }

  list.className = 'pf-list';
  list.innerHTML = fornecedoresCache.map(f => `
    <div class="pf-row">
      <div class="pf-avatar">${_pfEsc((f.nome||'?')[0].toUpperCase())}</div>
      <div class="pf-row-main">
        <div class="pf-row-title">${_pfEsc(f.nome)}</div>
        <div class="pf-row-sub">${[f.telefone,f.email,f.cnpj].filter(Boolean).map(_pfEsc).join(', ')||'Sem contato cadastrado'}</div>
        ${f.obs?`<div class="pf-row-sub">${_pfEsc(f.obs)}</div>`:''}
      </div>
      <div class="pf-row-actions">
        <button class="btn bg pf-sm pf-icon" title="Editar" aria-label="Editar fornecedor" onclick="editFornecedor(${f.id})">${_PF_ICO.editar}</button>
        <button class="btn bd pf-sm pf-icon" title="Excluir" aria-label="Excluir fornecedor" onclick="deleteFornecedor(${f.id})">${_PF_ICO.excluir}</button>
      </div>
    </div>`).join('');
}

function openAddFornecedor() {
  document.getElementById('forn-edit-id').value = '';
  ['forn-nome','forn-contato','forn-telefone','forn-email','forn-cnpj','forn-endereco','forn-obs'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value = '';
  });
  document.getElementById('modal-forn-title').textContent = 'Novo fornecedor';
  openModal('modal-fornecedor');
}

function editFornecedor(id) {
  const f = fornecedoresCache.find(x => x.id === id);
  if (!f) return;
  document.getElementById('forn-edit-id').value = id;
  document.getElementById('forn-nome').value = f.nome || '';
  document.getElementById('forn-contato').value = f.contato || '';
  document.getElementById('forn-telefone').value = f.telefone || '';
  document.getElementById('forn-email').value = f.email || '';
  document.getElementById('forn-cnpj').value = f.cnpj || '';
  document.getElementById('forn-endereco').value = f.endereco || '';
  document.getElementById('forn-obs').value = f.obs || '';
  document.getElementById('modal-forn-title').textContent = 'Editar fornecedor';
  openModal('modal-fornecedor');
}

async function saveFornecedor() {
  const id = document.getElementById('forn-edit-id').value;
  const nome = document.getElementById('forn-nome').value.trim();
  if (!nome) { sbToast('err','Informe o nome'); return; }
  const obj = {
    nome,
    contato: document.getElementById('forn-contato').value.trim(),
    telefone: document.getElementById('forn-telefone').value.trim(),
    email: document.getElementById('forn-email').value.trim(),
    cnpj: document.getElementById('forn-cnpj').value.trim(),
    endereco: document.getElementById('forn-endereco').value.trim(),
    obs: document.getElementById('forn-obs').value.trim(),
  };
  sbLoading(true);
  if (id) {
    await sb.from('fornecedores').update(obj).eq('id', parseInt(id));
  } else {
    await sb.from('fornecedores').insert(obj);
  }
  sbLoading(false);
  closeModal('modal-fornecedor');
  renderFornecedores();
  sbToast('ok', id ? 'Fornecedor atualizado!' : 'Fornecedor cadastrado!');
}

async function deleteFornecedor(id) {
  const f = fornecedoresCache.find(x => x.id === id);
  if (!confirm(`Excluir "${f?.nome}"?`)) return;
  sbLoading(true);
  await sb.from('fornecedores').delete().eq('id', id);
  sbLoading(false);
  renderFornecedores();
  sbToast('ok', 'Fornecedor removido!');
}

// ─────────────────────────────────────────
// 3. CONTAS A PAGAR
// ─────────────────────────────────────────
let contasPagarCache = [];

async function renderContasPagar() {
  const list = document.getElementById('cp-list');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:13.5px">Carregando...</div>';

  try {
    const { data } = await sb.from('contas_pagar').select('*').order('vencimento');
    contasPagarCache = data || [];
  } catch(e) { contasPagarCache = []; }

  const hoje = new Date().toISOString().split('T')[0];
  const pendentes = contasPagarCache.filter(c => c.status === 'pendente');
  const vencidas = pendentes.filter(c => c.vencimento < hoje);
  const totalPend = pendentes.reduce((s,c) => s + parseFloat(c.valor||0), 0);
  const totalPago = contasPagarCache.filter(c => c.status === 'pago').reduce((s,c) => s + parseFloat(c.valor||0), 0);

  const elPend = document.getElementById('cp-pendentes');
  const elVenc = document.getElementById('cp-vencidas');
  const elTotalP = document.getElementById('cp-total-pend');
  const elTotalPago = document.getElementById('cp-total-pago');
  if (elPend) elPend.textContent = pendentes.length;
  if (elVenc) elVenc.textContent = vencidas.length;
  if (elTotalP) elTotalP.textContent = _money(totalPend);
  if (elTotalPago) elTotalPago.textContent = _money(totalPago);

  const filtro = document.getElementById('cp-filtro')?.value || 'todos';
  let filtered = contasPagarCache;
  if (filtro === 'pendente') filtered = pendentes;
  else if (filtro === 'vencidas') filtered = vencidas;
  else if (filtro === 'pago') filtered = contasPagarCache.filter(c => c.status === 'pago');

  if (!filtered.length) {
    list.className = '';
    list.innerHTML = filtro === 'todos'
      ? '<div class="pf-empty"><strong>Nenhuma conta cadastrada</strong>Use o botão Nova conta para lançar aluguel, fornecedores e outras despesas.</div>'
      : '<div class="pf-empty"><strong>Nenhuma conta neste filtro</strong>Troque o filtro acima para ver as demais.</div>';
    return;
  }

  const catNome = { aluguel:'Aluguel', salario:'Salários', fornecedor:'Fornecedores', agua:'Água', luz:'Energia', internet:'Internet', gas:'Gás', marketing:'Marketing', manutencao:'Manutenção', impostos:'Impostos', outros:'Outros' };

  list.className = 'pf-list';
  list.innerHTML = filtered.map(c => {
    const vencida = c.status === 'pendente' && c.vencimento < hoje;
    const paga = c.status === 'pago';
    const fornNome = c.fornecedor_id ? (fornecedoresCache.find(f => f.id === c.fornecedor_id)?.nome || '') : '';
    const dtVenc = c.vencimento ? new Date(c.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : '';
    const detalhes = [catNome[c.categoria] || _pfEsc(c.categoria || 'Outros'), _pfEsc(fornNome), c.recorrente ? 'Recorrente' : ''].filter(Boolean).join(', ');
    const chip = paga ? '<span class="pf-chip ok">Paga</span>' : vencida ? '<span class="pf-chip bad">Vencida</span>' : '<span class="pf-chip warn">Pendente</span>';
    return `<div class="pf-row"${vencida ? ' style="box-shadow:inset 3px 0 0 var(--pf-bad)"' : ''}>
      <div class="pf-row-main">
        <div class="pf-row-title">${_pfEsc(c.descricao)} ${chip}</div>
        <div class="pf-row-sub">${detalhes}</div>
        <div class="pf-row-sub"${vencida ? ' style="color:var(--pf-bad);font-weight:650"' : ''}>${paga ? 'Vencimento em ' : vencida ? 'Venceu em ' : 'Vence em '}${dtVenc}</div>
      </div>
      <div class="pf-row-val">${_money(c.valor)}</div>
      <div class="pf-row-actions">
        ${c.status==='pendente'?`<button class="btn bg pf-sm" title="Marcar como paga" onclick="marcarContaPaga(${c.id})">${_PF_ICO.ok} Paga</button>`:''}
        <button class="btn bg pf-sm pf-icon" title="Editar" aria-label="Editar conta" onclick="editConta(${c.id})">${_PF_ICO.editar}</button>
        <button class="btn bd pf-sm pf-icon" title="Excluir" aria-label="Excluir conta" onclick="deleteConta(${c.id})">${_PF_ICO.excluir}</button>
      </div>
    </div>`;
  }).join('');
}

function openAddConta() {
  document.getElementById('ctp-edit-id').value = '';
  ['ctp-descricao','ctp-valor','ctp-vencimento','ctp-obs'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value = '';
  });
  document.getElementById('ctp-categoria').value = 'outros';
  document.getElementById('ctp-fornecedor').value = '';
  document.getElementById('ctp-recorrente').checked = false;
  document.getElementById('ctp-recorrencia-wrap').style.display = 'none';
  document.getElementById('modal-cp-title').textContent = 'Nova conta a pagar';
  _populateFornSelect();
  openModal('modal-conta-pagar');
}

function _populateFornSelect() {
  const sel = document.getElementById('ctp-fornecedor');
  if (!sel) return;
  sel.innerHTML = '<option value="">Nenhum</option>' +
    fornecedoresCache.map(f => `<option value="${f.id}">${f.nome}</option>`).join('');
}

function editConta(id) {
  const c = contasPagarCache.find(x => x.id === id);
  if (!c) return;
  document.getElementById('ctp-edit-id').value = id;
  document.getElementById('ctp-descricao').value = c.descricao || '';
  document.getElementById('ctp-valor').value = c.valor || '';
  document.getElementById('ctp-vencimento').value = c.vencimento || '';
  document.getElementById('ctp-categoria').value = c.categoria || 'outros';
  document.getElementById('ctp-obs').value = c.obs || '';
  document.getElementById('ctp-recorrente').checked = !!c.recorrente;
  document.getElementById('ctp-recorrencia-wrap').style.display = c.recorrente ? '' : 'none';
  if (c.recorrencia) document.getElementById('ctp-recorrencia').value = c.recorrencia;
  document.getElementById('modal-cp-title').textContent = 'Editar conta';
  _populateFornSelect();
  if (c.fornecedor_id) document.getElementById('ctp-fornecedor').value = c.fornecedor_id;
  openModal('modal-conta-pagar');
}

async function saveConta() {
  const id = document.getElementById('ctp-edit-id').value;
  const descricao = document.getElementById('ctp-descricao').value.trim();
  const valor = parseFloat(document.getElementById('ctp-valor').value) || 0;
  const vencimento = document.getElementById('ctp-vencimento').value;
  if (!descricao) { sbToast('err','Informe a descrição'); return; }
  if (!valor) { sbToast('err','Informe o valor'); return; }
  if (!vencimento) { sbToast('err','Informe o vencimento'); return; }
  const obj = {
    descricao, valor, vencimento,
    categoria: document.getElementById('ctp-categoria').value || 'outros',
    fornecedor_id: parseInt(document.getElementById('ctp-fornecedor').value) || null,
    recorrente: document.getElementById('ctp-recorrente').checked ? 1 : 0,
    recorrencia: document.getElementById('ctp-recorrente').checked ? (document.getElementById('ctp-recorrencia')?.value || 'mensal') : null,
    obs: document.getElementById('ctp-obs').value.trim(),
  };
  sbLoading(true);
  if (id) {
    await sb.from('contas_pagar').update(obj).eq('id', parseInt(id));
  } else {
    obj.status = 'pendente';
    await sb.from('contas_pagar').insert(obj);
  }
  sbLoading(false);
  closeModal('modal-conta-pagar');
  renderContasPagar();
  sbToast('ok', id ? 'Conta atualizada!' : 'Conta cadastrada!');
}

async function marcarContaPaga(id) {
  if (!confirm('Marcar como pago?')) return;
  sbLoading(true);
  await sb.from('contas_pagar').update({ status: 'pago', pago_em: new Date().toISOString() }).eq('id', id);

  // Se recorrente, cria próxima
  const c = contasPagarCache.find(x => x.id === id);
  if (c && c.recorrente) {
    const dt = new Date(c.vencimento + 'T12:00:00');
    if (c.recorrencia === 'semanal') dt.setDate(dt.getDate() + 7);
    else if (c.recorrencia === 'quinzenal') dt.setDate(dt.getDate() + 15);
    else dt.setMonth(dt.getMonth() + 1); // mensal
    await sb.from('contas_pagar').insert({
      descricao: c.descricao, valor: c.valor, vencimento: dt.toISOString().split('T')[0],
      categoria: c.categoria, fornecedor_id: c.fornecedor_id, recorrente: 1,
      recorrencia: c.recorrencia, status: 'pendente', obs: c.obs
    });
  }
  sbLoading(false);
  renderContasPagar();
  sbToast('ok', 'Conta paga!' + (c?.recorrente ? ' Próxima criada automaticamente.' : ''));
}

async function deleteConta(id) {
  if (!confirm('Excluir esta conta?')) return;
  sbLoading(true);
  await sb.from('contas_pagar').delete().eq('id', id);
  sbLoading(false);
  renderContasPagar();
  sbToast('ok', 'Conta removida!');
}

// ─────────────────────────────────────────
// 4. DRE SIMPLIFICADO
// ─────────────────────────────────────────
async function renderDRE() {
  const container = document.getElementById('dre-body');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px">Carregando...</div>';

  const de = document.getElementById('dre-de')?.value || '';
  const ate = document.getElementById('dre-ate')?.value || '';
  if (!de || !ate) {
    // Padrão: mês atual
    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,'0');
    if (!de) document.getElementById('dre-de').value = `${y}-${m}-01`;
    if (!ate) document.getElementById('dre-ate').value = now.toISOString().split('T')[0];
    return renderDRE();
  }

  try {
    const deISO = de + 'T00:00:00';
    const ateISO = ate + 'T23:59:59.999Z';

    const [{ data: ordersRaw }, { data: movsRaw }, { data: contasRaw }] = await Promise.all([
      sb.from('orders').select('id,status,total,taxa,created_at')
        .gte('created_at', deISO).lte('created_at', ateISO),
      sb.from('movimentos').select('*').order('id', { ascending: false }).limit(1000),
      sb.from('contas_pagar').select('*').gte('vencimento', de).lte('vencimento', ate)
    ]);

    const validos = (ordersRaw||[]).filter(o => ['pronto','entregue','finalizado'].includes(o.status));
    const receita = validos.reduce((s,o) => s + parseFloat(o.total||0) + parseFloat(o.taxa||0), 0);

    // Movimentos no período
    // Timestamp do SQLite vem em UTC sem "Z" (ex: "2026-08-09 18:07:00") — new Date()
    // sem timezone explícita seria interpretado como horário LOCAL do navegador, causando
    // erro de 3h em Brasília. Forçamos interpretação UTC quando não houver timezone na string.
    const normDate = s => {
      if (!s) return null;
      const str = String(s).trim();
      if (/(Z|[+-]\d{2}:?\d{2})$/.test(str)) return new Date(str);
      const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
      return m ? new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6])) : new Date(str);
    };
    const movsFilt = (movsRaw||[]).filter(m => {
      const t = normDate(m.created_at||m.time);
      return t && t >= new Date(deISO) && t <= new Date(ateISO);
    });
    const entradas = movsFilt.filter(m => m.tipo === 'entrada').reduce((s,m) => s + parseFloat(m.val||0), 0);
    const saidasMov = movsFilt.filter(m => m.tipo === 'saida').reduce((s,m) => s + parseFloat(m.val||0), 0);

    // Contas pagas no período
    const contasPagas = (contasRaw||[]).filter(c => c.status === 'pago').reduce((s,c) => s + parseFloat(c.valor||0), 0);
    const contasPend = (contasRaw||[]).filter(c => c.status === 'pendente').reduce((s,c) => s + parseFloat(c.valor||0), 0);

    // Despesas = saídas do caixa + contas pagas
    const despesasTotal = saidasMov + contasPagas;
    const lucro = receita - despesasTotal;
    const margem = receita > 0 ? (lucro / receita * 100).toFixed(1) : '0';

    // Categorizar contas pagas
    const catMap = {};
    (contasRaw||[]).filter(c => c.status === 'pago').forEach(c => {
      const k = c.categoria || 'outros';
      catMap[k] = (catMap[k]||0) + parseFloat(c.valor||0);
    });
    // Saídas do caixa como categoria
    if (saidasMov > 0) catMap['saidas_caixa'] = (catMap['saidas_caixa']||0) + saidasMov;

    const catLabels = { aluguel:'Aluguel', salario:'Salários', fornecedor:'Fornecedores', agua:'Água', luz:'Energia', internet:'Internet', gas:'Gás', marketing:'Marketing', manutencao:'Manutenção', impostos:'Impostos', outros:'Outros', saidas_caixa:'Saídas do caixa' };
    const maxCat = Math.max(...Object.values(catMap), 1);

    container.innerHTML = `
      <div class="sg">
        <div class="sc" style="--ca:var(--success)"><div class="sl">Receita bruta</div><div class="sv">${_money(receita)}</div><div class="str">${validos.length} ${validos.length === 1 ? 'pedido' : 'pedidos'}</div></div>
        <div class="sc" style="--ca:var(--danger)"><div class="sl">Despesas totais</div><div class="sv">${_money(despesasTotal)}</div><div class="str">Pagas no período</div></div>
        <div class="sc" style="--ca:${lucro>=0?'var(--accent)':'var(--danger)'}"><div class="sl">Lucro líquido</div><div class="sv" style="color:${lucro>=0?'var(--text)':'var(--danger)'}">${_money(lucro)}</div><div class="str">Margem de ${margem}%</div></div>
        <div class="sc" style="--ca:var(--accent3)"><div class="sl">Contas pendentes</div><div class="sv">${_money(contasPend)}</div><div class="str">A vencer no período</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card" style="padding:18px">
          <div class="card-title" style="margin-bottom:14px">Demonstrativo</div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-weight:600;color:var(--success)">( + ) Receita bruta</span><span style="font-weight:700;color:var(--success)">${_money(receita)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-weight:600;color:var(--danger)">( − ) Saídas do caixa</span><span style="color:var(--danger)">- ${_money(saidasMov)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-weight:600;color:var(--danger)">( − ) Contas pagas</span><span style="color:var(--danger)">- ${_money(contasPagas)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:12px 0;border-top:2px solid var(--border);margin-top:4px"><span style="font-weight:800;font-size:14px">= Lucro líquido</span><span style="font-weight:800;font-size:14px;color:${lucro>=0?'var(--accent)':'var(--danger)'}">${_money(lucro)}</span></div>
        </div>

        <div class="card" style="padding:18px">
          <div class="card-title" style="margin-bottom:14px">Despesas por categoria</div>
          ${Object.entries(catMap).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `
            <div style="margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                <span style="font-size:12.5px;font-weight:600">${catLabels[k]||k}</span>
                <span style="font-size:12.5px;font-weight:700;color:var(--danger)">${_money(v)}</span>
              </div>
              <div style="height:6px;background:var(--border);border-radius:99px;overflow:hidden">
                <div style="height:100%;width:${Math.round(v/maxCat*100)}%;background:var(--danger);border-radius:99px"></div>
              </div>
            </div>`).join('')}
          ${!Object.keys(catMap).length ? '<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px">Sem despesas no período</div>' : ''}
        </div>
      </div>`;
  } catch(e) {
    container.innerHTML = `<div style="color:var(--danger);padding:20px;text-align:center">Erro: ${e.message}</div>`;
  }
}

// ─────────────────────────────────────────
// 5. EXPORTAÇÃO DE RELATÓRIOS (CSV real)
// ─────────────────────────────────────────
async function relExportarCompleto() {
  const range = _relGetRange();
  const de = range.inicio.toISOString().split('T')[0];
  const ate = range.fim.toISOString().split('T')[0];

  sbLoading(true);
  try {
    const res = await fetch(`/api/exportar-relatorio?de=${de}&ate=${ate}`, {
      headers: { 'x-tenant-id': _tid() }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const clean = v => String(v || '').replace(/[;\r\n]+/g, ' ');

    // ── CSV de Pedidos ──
    let csv = 'SEP=;\n';
    csv += 'RELATÓRIO DE PEDIDOS\n';
    csv += `Período: ${range.label}\n\n`;
    csv += '#;Cliente;Telefone;Endereço;Itens;Total;Taxa;Pagamento;Status;Mesa;Garçom;Data\n';
    (data.orders||[]).forEach(o => {
      const itens = Array.isArray(o.items) ? o.items.map(i => `${i.qty}x ${i.name}`).join(' | ') : '';
      const dt = o.created_at ? new Date(o.created_at).toLocaleString('pt-BR') : '';
      csv += `${o.order_num||o.id};${(o.client||'').replace(/;/g,' ')};${o.phone||''};${(o.addr||'').replace(/;/g,' ')};${itens.replace(/;/g,' ')};${parseFloat(o.total||0).toFixed(2)};${parseFloat(o.taxa||0).toFixed(2)};${o.pag||''};${o.status};${o.mesa_num||''};${o.garcom_nome||''};${dt}\n`;
    });

    // ── Resumo ──
    const validos = (data.orders||[]).filter(o => ['pronto','entregue','finalizado'].includes(o.status));
    const fat = validos.reduce((s,o) => s + parseFloat(o.total||0) + parseFloat(o.taxa||0), 0);
    csv += `\nRESUMO\n`;
    csv += `Total de pedidos;${data.orders?.length||0}\n`;
    csv += `Pedidos confirmados;${validos.length}\n`;
    csv += `Faturamento;${fat.toFixed(2)}\n`;
    csv += `Ticket médio;${validos.length > 0 ? (fat/validos.length).toFixed(2) : '0'}\n`;

    // ── Movimentos ──
    csv += `\nMOVIMENTOS FINANCEIROS\n`;
    csv += `Descrição;Tipo;Valor;Pagamento;Data\n`;
    (data.movimentos||[]).forEach(m => {
      csv += `${(m.description||'').replace(/;/g,' ')};${m.tipo};${parseFloat(m.val||0).toFixed(2)};${m.pag||''};${m.created_at||m.time||''}\n`;
    });

    // ── Contas a Pagar ──
    if (data.contas_pagar?.length) {
      csv += `\nCONTAS A PAGAR\n`;
      csv += `Descrição;Valor;Vencimento;Categoria;Status;Pago em\n`;
      data.contas_pagar.forEach(c => {
        csv += `${(c.descricao||'').replace(/;/g,' ')};${parseFloat(c.valor||0).toFixed(2)};${c.vencimento};${c.categoria||''};${c.status};${c.pago_em||''}\n`;
      });
    }

    if (data.entregas?.length) {
      csv += `\nENTREGAS\n`;
      csv += `Pedido;Cliente;Telefone;Entregador;Status;Endereco;Valor pedido;Valor receber;Recebido;Comissao;Problema;Criada;Saiu;Entregue\n`;
      data.entregas.forEach(e => {
        csv += `${e.order_num||e.order_id};${clean(e.client)};${clean(e.phone)};${clean(e.entregador_nome)};${clean(e.status)};${clean(e.addr)};${parseFloat(e.valor_pedido||0).toFixed(2)};${parseFloat(e.valor_receber||0).toFixed(2)};${parseFloat(e.recebido||0).toFixed(2)};${parseFloat(e.comissao||0).toFixed(2)};${clean(e.problema)};${e.created_at||''};${e.saiu_at||''};${e.entregue_at||''}\n`;
      });
    }

    if (data.rotas_entrega?.length) {
      csv += `\nROTAS DE ENTREGA\n`;
      csv += `Rota;Entregador;Status;Pedidos;Total pedidos;Dinheiro previsto;Comissao;Criada;Iniciada;Finalizada;Obs\n`;
      data.rotas_entrega.forEach(r => {
        csv += `${r.id};${clean(r.entregador_nome)};${clean(r.status)};${r.pedidos_count||0};${parseFloat(r.total_pedidos||0).toFixed(2)};${parseFloat(r.dinheiro_previsto||0).toFixed(2)};${parseFloat(r.comissao_total||0).toFixed(2)};${r.created_at||''};${r.iniciado_em||''};${r.finalizado_em||''};${clean(r.obs)}\n`;
      });
    }

    if (data.estoque_movimentos?.length) {
      csv += `\nMOVIMENTOS DE ESTOQUE\n`;
      csv += `Data;Tipo;Ingrediente;Produto;Pedido;Cliente;Qtd;Unidade;Saldo antes;Saldo depois;Origem;Obs\n`;
      data.estoque_movimentos.forEach(m => {
        csv += `${m.created_at||''};${clean(m.tipo)};${clean(m.ingrediente)};${clean(m.produto)};${m.order_num||''};${clean(m.client)};${parseFloat(m.qty||0).toFixed(3)};${clean(m.unit)};${parseFloat(m.saldo_antes||0).toFixed(3)};${parseFloat(m.saldo_depois||0).toFixed(3)};${clean(m.origem)};${clean(m.note)}\n`;
      });
    }

    // Download
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-${de}-a-${ate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    sbToast('ok', 'Relatório CSV exportado!');
  } catch(e) {
    sbToast('err', 'Erro ao exportar: ' + e.message);
  } finally {
    sbLoading(false);
  }
}

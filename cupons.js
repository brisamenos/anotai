// CUPONS
// ─────────────────────────────────────────
function renderCupons(){
  const el=document.getElementById('cupom-list');
  if(!el) return;
  document.getElementById('cupom-count').textContent=cupons.filter(c=>c.ativo).length;
  el.innerHTML=cupons.map((c,i)=>`
    <div class="coupon-card">
      <div class="coupon-icon" style="background:${c.ativo?'rgba(34,197,94,.12)':'rgba(100,116,139,.1)'}"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><path d="M2 6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1a2 2 0 0 0 0 4v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-1a2 2 0 0 0 0-4V6z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 4v2M10 10v2" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div style="flex:1">
        <div class="coupon-code">${c.code}</div>
        <div class="coupon-desc">${c.tipo==='%'?c.val+'% de desconto':c.tipo==='frete'?'Frete grátis':'Desconto R$'+c.val}</div>
        <div class="coupon-use">Usado ${c.usos}x • ${c.minimo>0?'Pedido mín. R$'+c.minimo:'Sem pedido mínimo'}</div>
      </div>
      <span class="chip ${c.ativo?'chip-green':'chip-red'}">${c.ativo?'● Ativo':'● Inativo'}</span>
      <button class="btn bg" style="font-size:11px;padding:3px 8px" onclick="toggleCupom(${i})">${c.ativo?'Pausar':'Ativar'}</button>
      <button class="btn bd" style="font-size:11px;padding:3px 8px" onclick="deleteCupom(${i})"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;flex-shrink:0" xmlns="http://www.w3.org/2000/svg"><path d="M3 4h10M6 4V2.5A.5.5 0 0 1 6.5 2h3a.5.5 0 0 1 .5.5V4M5 4l.7 9.5a.5.5 0 0 0 .5.5h3.6a.5.5 0 0 0 .5-.5L11 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div>`).join('');
}

function toggleCupom(i){cupons[i].ativo=!cupons[i].ativo;renderCupons();sbToast('ok',`Cupom ${cupons[i].code} ${cupons[i].ativo?'ativado':'pausado'}!`);}
async function deleteCupom(idx) {
  const c = cupons[idx];
  if (!c) return;
  const { error } = await sb.from('cupons').delete().eq('id', c.id);
  if (!error) cupons.splice(idx, 1);
  renderCupons();
  showToast(_ICON_TRS,'Cupom removido');
}
async function addCupom() {
  const code = (document.getElementById('cupom-code').value||'').toUpperCase().trim();
  const val  = parseFloat(document.getElementById('cupom-val').value) || 0;
  const tipo = document.getElementById('cupom-tipo').value.includes('%') ? '%' : 'frete';
  if (!code) { sbToast('err','Informe o código'); return; }
  sbLoading(true);
  const { data, error } = await sb.from('cupons').insert({
    code, type: tipo === '%' ? 'percent' : 'fixed', value: val, min_order: 0, uses_left: -1, ativo: true
  }).select().single();
  sbLoading(false);
  if (error) { sbToast('err', error.code==='23505'?'Código já existe':'Erro ao criar cupom'); return; }
  cupons.push({id:data.id,code,tipo,val,minimo:0,usos:0,ativo:true});
  closeModal('modal-add-cupom');
  document.getElementById('cupom-code').value = '';
  renderCupons();
  sbToast('ok','Cupom criado!');
}

// ─────────────────────────────────────────
// CASHBACK
// ─────────────────────────────────────────
let _cbClienteAtual = null; // { id, name, phone, cashback_saldo }
let _cbTodosClientes = [];  // cache de todos os clientes com saldo > 0

async function loadCashbackConfig() {
  try {
    const tid = _sessao?.tenant_id || '';
    const res = await fetch('/api/cashback/config', {
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid }
    });
    if (!res.ok) return;
    const cfg = await res.json();
    const toggle = document.getElementById('cb-toggle-ativo');
    if (toggle) toggle.classList.toggle('on', !!cfg.ativo);
    const pct = document.getElementById('cb-pct');
    const min = document.getElementById('cb-min-pedido');
    const val = document.getElementById('cb-validade');
    if (pct) pct.value = cfg.pct || '';
    if (min) min.value = cfg.min_pedido || '';
    if (val) val.value = cfg.validade_dias || '';
  } catch(e) {
    console.error('[Cashback] loadCashbackConfig:', e);
  }
  // Carrega lista de clientes com saldo sempre que abre a aba
  await cbCarregarLista();
}

async function cbCarregarLista() {
  const tbody = document.getElementById('cb-lista-tbody');
  const empty = document.getElementById('cb-lista-vazio');
  const stat  = document.getElementById('cb-lista-stat');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--muted)"><div class="spinner" style="margin:0 auto 8px"></div>Carregando...</td></tr>`;

  try {
    const { data, error } = await sb.from('customers')
      .select('id,name,phone,cashback_saldo')
      .gt('cashback_saldo', 0)
      .order('cashback_saldo', { ascending: false });

    if (error) throw new Error(error.message);

    _cbTodosClientes = data || [];
    cbRenderLista();

    const total = _cbTodosClientes.reduce((s, c) => s + parseFloat(c.cashback_saldo || 0), 0);
    if (stat) stat.textContent = `${_cbTodosClientes.length} cliente${_cbTodosClientes.length !== 1 ? 's' : ''} • Total em carteira: R$ ${total.toFixed(2).replace('.', ',')}`;
  } catch(e) {
    console.error('[Cashback] cbCarregarLista:', e);
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--danger)">Erro ao carregar clientes</td></tr>`;
  }
}

function cbRenderLista() {
  const tbody  = document.getElementById('cb-lista-tbody');
  const empty  = document.getElementById('cb-lista-vazio');
  const search = (document.getElementById('cb-lista-search')?.value || '').toLowerCase();

  const lista = _cbTodosClientes.filter(c =>
    !search ||
    (c.name  || '').toLowerCase().includes(search) ||
    (c.phone || '').includes(search)
  );

  if (!lista.length) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = lista.map(c => {
    const saldo = parseFloat(c.cashback_saldo || 0);
    return `<tr>
      <td>
        <div style="font-weight:600;font-size:13px">${c.name || '—'}</div>
      </td>
      <td style="font-size:12.5px;color:var(--muted)">${c.phone || '—'}</td>
      <td>
        <span style="background:rgba(34,197,94,.15);color:#22c55e;padding:3px 10px;border-radius:99px;font-size:12.5px;font-weight:700">
          R$ ${saldo.toFixed(2).replace('.', ',')}
        </span>
      </td>
      <td>
        <button class="btn bg" style="font-size:11px;padding:3px 10px" onclick="cbSelecionarDaLista(${c.id})">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M13.5 7.75a5.75 5.75 0 1 1-9.6-4.28L2.5 1.5l1.97 1.17A5.72 5.72 0 0 1 13.5 7.75Z" stroke="currentColor" stroke-width="1.3"/></svg>
          Enviar WA
        </button>
      </td>
      <td>
        <button class="btn bd" style="font-size:11px;padding:3px 10px" onclick="cbSelecionarAjuste(${c.id})">Ajustar</button>
      </td>
    </tr>`;
  }).join('');
}

function cbSelecionarDaLista(id) {
  const c = _cbTodosClientes.find(x => x.id === id);
  if (!c) return;
  _cbClienteAtual = { ...c };
  // Preenche o painel de busca/ação
  const phone = (c.phone || '').replace(/\D/g, '');
  const saldo = parseFloat(c.cashback_saldo || 0);
  const el = key => document.getElementById(key);
  if (el('cb-phone-busca'))  el('cb-phone-busca').value = c.phone || '';
  if (el('cb-res-nome'))     el('cb-res-nome').textContent  = c.name || '—';
  if (el('cb-res-phone'))    el('cb-res-phone').textContent = c.phone || '—';
  if (el('cb-res-saldo'))    el('cb-res-saldo').textContent = 'R$ ' + saldo.toFixed(2).replace('.', ',');
  if (el('cb-msg-wa'))       el('cb-msg-wa').value = `💰 ${c.name || 'Cliente'}, você tem R$ ${saldo.toFixed(2).replace('.', ',')} de cashback disponível!\nUse no seu próximo pedido 🛍️`;
  if (el('cb-resultado'))    el('cb-resultado').style.display   = '';
  if (el('cb-busca-vazio'))  el('cb-busca-vazio').style.display = 'none';
  // Scrolla até o painel
  el('cb-resultado')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cbSelecionarAjuste(id) {
  cbSelecionarDaLista(id);
  setTimeout(() => document.getElementById('cb-ajuste-val')?.focus(), 300);
}

async function saveCashbackConfig() {
  const ativo       = document.getElementById('cb-toggle-ativo')?.classList.contains('on') || false;
  const pct         = parseFloat(document.getElementById('cb-pct')?.value) || 0;
  const min_pedido  = parseFloat(document.getElementById('cb-min-pedido')?.value) || 0;
  const validade_dias = parseInt(document.getElementById('cb-validade')?.value) || 0;

  if (pct < 0 || pct > 100) { sbToast('err', 'Percentual deve ser entre 0 e 100'); return; }

  sbLoading(true);
  try {
    const tid = _sessao?.tenant_id || '';
    const res = await fetch('/api/cashback/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ ativo, pct, min_pedido, validade_dias })
    });
    if (res.ok) {
      sbToast('ok', `Cashback ${ativo ? 'ativado' : 'desativado'} — ${pct}% por pedido`);
    } else {
      const err = await res.json().catch(() => ({}));
      sbToast('err', err.error || 'Erro ao salvar configuração');
    }
  } catch(e) {
    sbToast('err', 'Erro de conexão');
  }
  sbLoading(false);
}

async function cbBuscarCliente() {
  const phone = (document.getElementById('cb-phone-busca')?.value || '').replace(/\D/g, '');
  if (!phone || phone.length < 8) { sbToast('err', 'Informe um telefone válido'); return; }

  sbLoading(true);
  try {
    const tid = _sessao?.tenant_id || '';

    // Busca saldo direto pelo endpoint dedicado
    const resSaldo = await fetch(`/api/cashback/saldo?phone=${encodeURIComponent(phone)}`, {
      headers: { 'x-tenant-id': tid }
    });
    const saldoData = await resSaldo.json().catch(() => ({}));

    // Tenta achar o cliente no cache ou no banco
    let cliente = _cbTodosClientes.find(c => (c.phone || '').replace(/\D/g,'').slice(-8) === phone.slice(-8));
    if (!cliente) {
      const { data } = await sb.from('customers').select('id,name,phone,cashback_saldo').eq('phone', phone).maybeSingle();
      cliente = data || null;
    }

    const saldo = parseFloat(saldoData.saldo ?? 0);
    const nome  = cliente?.name || 'Cliente';
    const tel   = cliente?.phone || phone;

    _cbClienteAtual = cliente ? { ...cliente, cashback_saldo: saldo } : { id: null, name: nome, phone: tel, cashback_saldo: saldo };

    const el = key => document.getElementById(key);
    if (el('cb-res-nome'))   el('cb-res-nome').textContent  = nome;
    if (el('cb-res-phone'))  el('cb-res-phone').textContent = tel;
    if (el('cb-res-saldo'))  el('cb-res-saldo').textContent = 'R$ ' + saldo.toFixed(2).replace('.', ',');
    if (el('cb-msg-wa'))     el('cb-msg-wa').value = `💰 ${nome}, você tem R$ ${saldo.toFixed(2).replace('.', ',')} de cashback disponível!\nUse no seu próximo pedido 🛍️`;
    if (el('cb-resultado'))  el('cb-resultado').style.display   = '';
    if (el('cb-busca-vazio'))el('cb-busca-vazio').style.display = 'none';

  } catch(e) {
    console.error('[Cashback] cbBuscarCliente:', e);
    sbToast('err', 'Erro ao buscar cliente');
  }
  sbLoading(false);
}

function cbLimparResultado() {
  const el = key => document.getElementById(key);
  if (el('cb-resultado'))   el('cb-resultado').style.display   = 'none';
  if (el('cb-busca-vazio')) el('cb-busca-vazio').style.display = '';
  _cbClienteAtual = null;
}

async function cbEnviarWA() {
  const phone = (document.getElementById('cb-phone-busca')?.value || '').replace(/\D/g, '');
  if (!phone) { sbToast('err', 'Nenhum cliente selecionado'); return; }

  const msg = document.getElementById('cb-msg-wa')?.value?.trim();
  if (!msg) { sbToast('err', 'Digite a mensagem'); return; }

  sbLoading(true);
  try {
    const r = await EVO.sendText(phone, msg);
    if (r.ok || r.status === 201) {
      sbToast('ok', 'Mensagem enviada via WhatsApp ✓');
    } else {
      sbToast('err', 'Erro ao enviar — verifique se o WhatsApp está conectado no Robô');
    }
  } catch(e) {
    sbToast('err', 'Erro ao enviar mensagem');
  }
  sbLoading(false);
}

async function cbAjustarSaldo() {
  if (!_cbClienteAtual?.id) { sbToast('err', 'Busque um cliente primeiro'); return; }
  const valor = parseFloat(document.getElementById('cb-ajuste-val')?.value);
  if (isNaN(valor) || valor === 0) { sbToast('err', 'Informe um valor diferente de zero'); return; }

  sbLoading(true);
  try {
    const tid = _sessao?.tenant_id || '';
    const res = await fetch('/api/cashback/ajustar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tid },
      body: JSON.stringify({ customer_id: _cbClienteAtual.id, valor })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const novoSaldo = data.saldo ?? 0;
      const saldoEl = document.getElementById('cb-res-saldo');
      if (saldoEl) saldoEl.textContent = 'R$ ' + novoSaldo.toFixed(2).replace('.', ',');
      // Atualiza msg WA com novo saldo
      const msgEl = document.getElementById('cb-msg-wa');
      if (msgEl && _cbClienteAtual) {
        msgEl.value = `💰 ${_cbClienteAtual.name || 'Cliente'}, você tem R$ ${novoSaldo.toFixed(2).replace('.', ',')} de cashback disponível!\nUse no seu próximo pedido 🛍️`;
      }
      _cbClienteAtual.cashback_saldo = novoSaldo;
      document.getElementById('cb-ajuste-val').value = '';
      sbToast('ok', `Saldo ${valor > 0 ? 'creditado' : 'debitado'}: R$ ${Math.abs(valor).toFixed(2).replace('.', ',')}`);
    } else {
      sbToast('err', data.error || 'Erro ao ajustar saldo');
    }
  } catch(e) {
    sbToast('err', 'Erro de conexão');
  }
  sbLoading(false);
}

// ─────────────────────────────────────────

// ─────────────────────────────────────────
// IMPRESSÃO TÉRMICA
// ─────────────────────────────────────────
let _printMode    = localStorage.getItem('printMode') || 'auto';
let _qzConnected  = false;
let _qzPrinter    = localStorage.getItem('qzPrinter') || '';

// ── QZ Tray ──────────────────────────────
function qzConectar() {
  if (typeof qz === 'undefined') { sbToast('err', 'QZ Tray não carregado'); return; }
  if (qz.websocket.isActive()) { sbToast('ok', 'QZ Tray já conectado'); return; }
  qz.websocket.connect({ retries: 2, delay: 1 })
    .then(() => {
      _qzConnected = true;
      _qzAtualizarStatus(true);
      return qz.printers.find();
    })
    .then(printers => {
      const sel = document.getElementById('qz-printer-select');
      if (!sel) return;
      sel.innerHTML = printers.map(p => `<option value="${p}" ${p === _qzPrinter ? 'selected' : ''}>${p}</option>`).join('');
      if (!_qzPrinter && printers.length) { _qzPrinter = printers[0]; localStorage.setItem('qzPrinter', _qzPrinter); }
      document.getElementById('qz-printer-wrap').style.display = 'block';
      sbToast('ok', `QZ Tray conectado — ${printers.length} impressora(s)`);
    })
    .catch(e => { _qzConnected = false; _qzAtualizarStatus(false); sbToast('err', 'Falha ao conectar QZ Tray: ' + (e.message || e)); });
}

function qzSalvarImpressora(nome) {
  _qzPrinter = nome;
  localStorage.setItem('qzPrinter', nome);
  sbToast('ok', 'Impressora salva: ' + nome);
}

function _qzAtualizarStatus(on) {
  const dot = document.getElementById('qz-status-dot');
  const txt = document.getElementById('qz-status-txt');
  if (dot) dot.style.background = on ? 'var(--success)' : 'var(--danger)';
  if (txt) txt.textContent = on ? 'QZ Tray conectado ✓' : 'QZ Tray desconectado';
}

// ── ESC/POS universal (funciona em qualquer térmica) ──
function _buildEscPos(order, cfg) {
  const ESC = '\x1B', GS = '\x1D';
  const INIT        = ESC + '@';
  const CENTER      = ESC + '\x61\x01';
  const LEFT        = ESC + '\x61\x00';
  const BOLD_ON     = ESC + '\x45\x01';
  const BOLD_OFF    = ESC + '\x45\x00';
  const DOUBLE_ON   = ESC + '!' + String.fromCharCode(0x30);
  const DOUBLE_OFF  = ESC + '!' + String.fromCharCode(0x00);
  const LF          = '\n';
  const DIVIDER     = '-'.repeat(32) + LF;
  const CUT         = GS + 'V\x41\x10';
  const FEED        = ESC + '\x64\x04';

  const money = v => 'R$ ' + parseFloat(v||0).toFixed(2).replace('.',',');
  const pad   = (a, b, w=32) => { const s = a + b; return s.length >= w ? s : a + ' '.repeat(w - s.length) + b; };
  const now   = new Date().toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const items = Array.isArray(order.items) ? order.items : [];
  const subtotal = items.reduce((s,i) => s + (parseFloat(i.price||0) * (i.qty||1)), 0);
  const taxa  = parseFloat(order.taxa || 0);
  const total = subtotal + taxa;

  let cmd = INIT;
  cmd += CENTER + DOUBLE_ON + BOLD_ON + cfg.nome + LF + DOUBLE_OFF + BOLD_OFF;
  if (cfg.sub) cmd += CENTER + cfg.sub + LF;
  cmd += LEFT + DIVIDER;
  cmd += BOLD_ON + `Pedido: #${order.id}` + BOLD_OFF + LF;
  cmd += `Data:   ${now}` + LF;
  cmd += `Cliente: ${order.client || '—'}` + LF;
  if (cfg.addr && order.addr) cmd += `Local:  ${order.addr}` + LF;
  cmd += DIVIDER;
  items.forEach(i => {
    const name  = `${i.qty}x ${i.name}`.toUpperCase().substring(0, 24);
    const price = money((i.price||0) * (i.qty||1));
    cmd += pad(name, price) + LF;
  });
  cmd += DIVIDER;
  if (taxa > 0) {
    cmd += pad('Subtotal', money(subtotal)) + LF;
    cmd += pad('Taxa entrega', money(taxa)) + LF;
  }
  cmd += BOLD_ON + pad('TOTAL', money(total)) + BOLD_OFF + LF;
  if (cfg.pag && order.pag) cmd += `Pagamento: ${order.pag}` + LF;
  cmd += DIVIDER;
  cmd += CENTER + cfg.rodape + LF;
  cmd += FEED + CUT;
  return cmd;
}

async function _printViaQz(order) {
  if (!_qzConnected || !_qzPrinter) {
    sbToast('err', 'QZ Tray não conectado ou impressora não selecionada');
    return false;
  }
  try {
    const cfg  = _getPrintConfig();
    const data = [{ type: 'raw', format: 'plain', data: _buildEscPos(order, cfg) }];
    const config = qz.configs.create(_qzPrinter);
    await qz.print(config, data);
    return true;
  } catch(e) {
    sbToast('err', 'Erro QZ Tray: ' + (e.message || e));
    return false;
  }
}

function setPrintMode(mode) {
  _printMode = mode;
  localStorage.setItem('printMode', mode);
  const isAuto = mode === 'auto';
  const isQz   = mode === 'qz';
  const la = document.getElementById('lbl-print-auto');
  const lm = document.getElementById('lbl-print-manual');
  const lq = document.getElementById('lbl-print-qz');
  const da = document.getElementById('dot-auto');
  const dm = document.getElementById('dot-manual');
  const dq = document.getElementById('dot-qz');
  const qp = document.getElementById('qz-panel');
  if (la) { la.style.background = isAuto ? 'rgba(59,130,246,.1)' : 'var(--surface2)'; la.style.borderColor = isAuto ? 'var(--accent)' : 'var(--border)'; }
  if (lm) { lm.style.background = mode==='manual' ? 'rgba(59,130,246,.1)' : 'var(--surface2)'; lm.style.borderColor = mode==='manual' ? 'var(--accent)' : 'var(--border)'; }
  if (lq) { lq.style.background = isQz ? 'rgba(139,92,246,.1)' : 'var(--surface2)'; lq.style.borderColor = isQz ? 'var(--purple)' : 'var(--border)'; }
  if (da) da.style.background = isAuto ? '#fff' : 'transparent';
  if (dm) dm.style.background = mode==='manual' ? '#fff' : 'transparent';
  if (dq) dq.style.background = isQz ? '#fff' : 'transparent';
  if (qp) qp.style.display = isQz ? 'flex' : 'none';
  // Auto-conecta QZ ao selecionar o modo
  if (isQz && !_qzConnected) qzConectar();
}
  sbToast('ok', isAuto ? 'Impressão automática ativada' : 'Impressão manual ativada');
}

function _getPrintConfig() {
  return {
    nome:   ((document.getElementById('print-nome')?.value)   || 'ESTIMA FOOD').toUpperCase(),
    sub:     (document.getElementById('print-sub')?.value)    || '',
    rodape:  (document.getElementById('print-rodape')?.value) || 'Obrigado!',
    addr:    document.getElementById('toggle-print-addr')?.classList.contains('on') ?? true,
    pag:     document.getElementById('toggle-print-pag')?.classList.contains('on')  ?? true,
  };
}

function _buildTicketHtml(order, cfg) {
  const items = Array.isArray(order.items) ? order.items : [];
  const now = new Date().toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const money = v => 'R$ ' + parseFloat(v||0).toFixed(2).replace('.',',');
  const itemLines = items.map(i => {
    const name = (i.qty + 'x ' + i.name).toUpperCase();
    const price = money((i.price||0) * (i.qty||1));
    return `<div style="display:flex;justify-content:space-between"><span>${name}</span><span style="white-space:nowrap;margin-left:8px">${price}</span></div>`;
  }).join('');
  const subtotal = items.reduce((s,i) => s + (parseFloat(i.price||0) * (i.qty||1)), 0);
  const taxa = parseFloat(order.taxa || 0);
  const total = subtotal + taxa;
  return `<div class="print-ticket">
    <div class="pt-center pt-large">${cfg.nome}</div>
    ${cfg.sub ? `<div class="pt-center" style="font-size:11px">${cfg.sub}</div>` : ''}
    <hr class="pt-hr">
    <div>Pedido: <b>#${order.id}</b></div>
    <div>Data: ${now}</div>
    <div>Cliente: ${order.client || '—'}</div>
    ${cfg.addr && order.addr ? `<div>Local: ${order.addr}</div>` : ''}
    <hr class="pt-hr">
    ${itemLines}
    <hr class="pt-hr">
    ${taxa > 0 ? `<div style="display:flex;justify-content:space-between"><span>Subtotal</span><span>${money(subtotal)}</span></div><div style="display:flex;justify-content:space-between"><span>Taxa entrega</span><span>${money(taxa)}</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;font-weight:bold"><span>TOTAL</span><span>${money(total)}</span></div>
    ${cfg.pag && order.pag ? `<div>Pagamento: ${order.pag}</div>` : ''}
    <hr class="pt-hr">
    <div class="pt-center" style="font-size:11px">${cfg.rodape}</div>
  </div>`;
}

function printOrder(order) {
  // Modo QZ Tray — envia direto para a térmica sem diálogo
  if (_printMode === 'qz' && _qzConnected) {
    _printViaQz(order);
    return;
  }
  // Fallback: popup que auto-imprime e fecha
  const cfg  = _getPrintConfig();
  const html = _buildTicketHtml(order, cfg);
  const printStyles = Array.from(document.styleSheets)
    .map(s => { try { return Array.from(s.cssRules).map(r => r.cssText).join('\n'); } catch { return ''; } })
    .join('\n');
  const w = window.open('', '_blank', 'width=400,height=700,toolbar=0,scrollbars=0,status=0');
  if (!w) {
    const frame = document.getElementById('print-frame');
    if (!frame) return;
    frame.innerHTML = html;
    frame.style.display = 'block';
    setTimeout(() => { window.print(); setTimeout(() => { frame.style.display = 'none'; }, 1500); }, 150);
    return;
  }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Pedido #${order.id}</title>
    <style>
      body{margin:0;padding:12px;font-family:monospace;font-size:13px;background:#fff;color:#000}
      @media print{body{margin:0;padding:0} @page{margin:4mm}}
      ${printStyles}
    </style>
    </head><body>${html}<script>
      window.onload=function(){setTimeout(function(){window.print();window.close();},200)};
    <\/script></body></html>`);
  w.document.close();
}

function printOrderById(id) {
  const o = ordersKanban.find(x => x.id === id);
  if (o) printOrder(o); else sbToast('err', 'Pedido não encontrado');
}

function renderImpressao() {
  const p = document.getElementById('print-preview');
  if (!p) return;
  setPrintMode(_printMode);
  const cfg = _getPrintConfig();
  const ex = { id:99, client:'João Silva', addr:'Mesa 3', mesa_num:3, pag:'PIX', taxa:0,
    items:[{qty:1,name:'Pizza Calabreza',price:50},{qty:2,name:'Coca Cola 2L',price:14}] };
  p.innerHTML = _buildTicketHtml(ex, cfg);
}

function testPrint() {
  const ex = { id:99, client:'TESTE IMPRESSÃO', addr:'Balcão', mesa_num:null, pag:'PIX', taxa:5,
    items:[{qty:1,name:'X-Salada',price:18},{qty:1,name:'Batata Frita',price:10}] };
  printOrder(ex);
  sbToast('ok', 'Enviando para impressora...');
}

// ─────────────────────────────────────────

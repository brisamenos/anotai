// Fiscal NFC-e (Focus NFe)
(function () {
  'use strict';

  let fiscalConfig = null;
  let fiscalNotas = [];

  function fiscalTenantId() {
    try {
      if (typeof _sessao !== 'undefined' && _sessao?.tenant_id) return _sessao.tenant_id;
      return JSON.parse(sessionStorage.getItem('sys_session') || '{}').tenant_id || '';
    } catch (e) { return ''; }
  }

  function fiscalToken() {
    try {
      const sess = JSON.parse(sessionStorage.getItem('sys_session') || '{}');
      if (sess && sess.token) return sess.token;
      if (typeof _sessao !== 'undefined' && _sessao?.token) return _sessao.token;
      const adm = JSON.parse(sessionStorage.getItem('adm_session') || '{}');
      return adm && adm.token ? adm.token : '';
    } catch (e) { return ''; }
  }

  function fiscalHeaders(extra) {
    const tid = fiscalTenantId();
    const tok = fiscalToken();
    return {
      'Content-Type': 'application/json',
      ...(tid ? { 'x-tenant-id': tid } : {}),
      ...(tok ? { 'Authorization': 'Bearer ' + tok } : {}),
      ...(extra || {})
    };
  }

  async function fiscalApi(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: fiscalHeaders(opts.headers),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 207) throw new Error(data.error || data.message || 'Erro fiscal');
    return data;
  }

  function fiscalMoney(v) {
    return 'R$ ' + (parseFloat(v || 0)).toFixed(2).replace('.', ',');
  }

  function fiscalDateToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function fiscalPagamentoLabel(value) {
    return {
      credito: 'cartao de credito',
      debito: 'cartao de debito',
      pix: 'PIX',
      dinheiro: 'dinheiro'
    }[value] || '';
  }

  function fiscalEscape(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fiscalSetVal(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value == null ? '' : value;
  }

  function fiscalGetVal(id) {
    return (document.getElementById(id)?.value || '').trim();
  }

  function fiscalAlert(type, msg) {
    const el = document.getElementById('fiscal-alert');
    if (!el) return;
    if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
    el.style.display = 'block';
    el.style.border = type === 'err' ? '1px solid rgba(239,68,68,.25)' : '1px solid rgba(34,197,94,.25)';
    el.style.background = type === 'err' ? 'rgba(239,68,68,.08)' : 'rgba(34,197,94,.08)';
    el.style.color = type === 'err' ? 'var(--danger)' : 'var(--success)';
    el.textContent = msg;
  }

  function fiscalDocUrl(note, field) {
    const path = note?.[field] || '';
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    const base = note.ambiente === 'producao' ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br';
    return base + (path.startsWith('/') ? path : '/' + path);
  }

  function fiscalStatusInfo(status) {
    const s = String(status || 'pendente');
    if (s === 'autorizado' || s === 'autorizada') return { label: 'Autorizada', color: 'var(--success)', bg: 'rgba(34,197,94,.12)' };
    if (s === 'cancelado') return { label: 'Cancelada', color: 'var(--muted)', bg: 'rgba(148,163,184,.14)' };
    if (s === 'processando_autorizacao') return { label: 'Processando', color: 'var(--accent3)', bg: 'rgba(245,158,11,.12)' };
    if (s.includes('erro')) return { label: 'Rejeitada', color: 'var(--danger)', bg: 'rgba(239,68,68,.12)' };
    return { label: 'Pendente', color: 'var(--accent)', bg: 'rgba(59,130,246,.12)' };
  }

  function fiscalRenderConfig() {
    const cfg = fiscalConfig || {};
    const enabled = document.getElementById('fiscal-enabled');
    if (enabled) enabled.checked = !!cfg.enabled;
    fiscalSetVal('fiscal-ambiente', cfg.ambiente || 'homologacao');
    fiscalSetVal('fiscal-emit-mode', cfg.emit_mode || 'fechamento');
    fiscalSetVal('fiscal-cnpj', cfg.cnpj_emitente || '');
    fiscalSetVal('fiscal-ie', cfg.inscricao_estadual_emitente || '');
    fiscalSetVal('fiscal-regime', cfg.regime_tributario_emitente || '1');
    fiscalSetVal('fiscal-uf', cfg.uf_emitente || 'CE');
    fiscalSetVal('fiscal-nome', cfg.nome_emitente || '');
    fiscalSetVal('fiscal-fantasia', cfg.nome_fantasia_emitente || '');
    fiscalSetVal('fiscal-telefone', cfg.telefone_emitente || '');
    fiscalSetVal('fiscal-cep', cfg.cep_emitente || '');
    fiscalSetVal('fiscal-logradouro', cfg.logradouro_emitente || '');
    fiscalSetVal('fiscal-numero', cfg.numero_emitente || '');
    fiscalSetVal('fiscal-bairro', cfg.bairro_emitente || '');
    fiscalSetVal('fiscal-municipio', cfg.municipio_emitente || '');
    fiscalSetVal('fiscal-serie', cfg.serie || '');
    fiscalSetVal('fiscal-csc-id', cfg.csc_id || '');
    fiscalSetVal('fiscal-ncm', cfg.ncm_padrao || '');
    fiscalSetVal('fiscal-cfop', cfg.cfop_padrao || '5102');
    fiscalSetVal('fiscal-icms-origem', cfg.icms_origem_padrao || '0');
    fiscalSetVal('fiscal-icms-situacao', cfg.icms_situacao_padrao || '102');
    const impAuto = document.getElementById('fiscal-imprimir-auto');
    if (impAuto) impAuto.checked = !!cfg.imprimir_auto;
    const taxaEnt = document.getElementById('fiscal-taxa-entrega');
    if (taxaEnt) taxaEnt.checked = !!cfg.taxa_entrega_nota;
    fiscalSetVal('fiscal-token-homologacao', '');
    fiscalSetVal('fiscal-token-producao', '');
    fiscalSetVal('fiscal-csc-token', '');

    const ambiente = cfg.ambiente || 'homologacao';
    const hasToken = ambiente === 'producao' ? cfg.token_producao_set : cfg.token_homologacao_set;
    const badge = document.getElementById('fiscal-token-badge');
    if (badge) {
      badge.textContent = hasToken ? `Token ${ambiente === 'producao' ? 'producao' : 'homologacao'} OK` : 'Sem token';
      badge.style.background = hasToken ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.10)';
      badge.style.color = hasToken ? 'var(--success)' : 'var(--danger)';
    }
    const amb = document.getElementById('fiscal-stat-ambiente');
    if (amb) amb.textContent = ambiente === 'producao' ? 'Producao' : 'Homolog.';
  }

  function fiscalRenderStats() {
    const pend = fiscalNotas.filter(n => n.status === 'pendente').length;
    const aut = fiscalNotas.filter(n => n.status === 'autorizado' || n.status === 'autorizada').length;
    const err = fiscalNotas.filter(n => String(n.status || '').includes('erro')).length;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('fiscal-stat-pendente', pend);
    set('fiscal-stat-autorizado', aut);
    set('fiscal-stat-erro', err);
  }

  function fiscalRenderNotas() {
    fiscalRenderStats();
    const list = document.getElementById('fiscal-notas-list');
    if (!list) return;
    if (!fiscalNotas.length) {
      list.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:40px 12px">Nenhuma NFC-e encontrada</div>';
      return;
    }
    list.innerHTML = fiscalNotas.map(n => {
      const st = fiscalStatusInfo(n.status);
      const danfe = fiscalDocUrl(n, 'caminho_danfe');
      const xml = fiscalDocUrl(n, 'caminho_xml');
      const origem = n.origem_tipo === 'mesa_session' ? `Mesa ${n.mesa_num || ''}` : `Pedido #${n.order_id || n.origem_id || ''}`;
      const msg = n.mensagem ? `<div style="font-size:11.5px;color:var(--muted);margin-top:6px;line-height:1.35">${fiscalEscape(n.mensagem)}</div>` : '';
      const canEmit = n.status === 'pendente' || String(n.status || '').includes('erro');
      const canCancel = n.status === 'autorizado' || n.status === 'autorizada';
      return `<div style="border:1px solid var(--border);border-radius:10px;background:var(--surface2);padding:12px 14px;display:grid;grid-template-columns:1fr auto;gap:10px;align-items:start">
        <div style="min-width:0">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
            <span style="font-size:13.5px;font-weight:800">${fiscalEscape(origem)}</span>
            <span style="font-size:10px;font-weight:800;border-radius:999px;padding:2px 8px;background:${st.bg};color:${st.color}">${st.label}</span>
            <span style="font-size:11px;color:var(--muted)">${fiscalEscape(n.ambiente || '')}</span>
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--muted)">
            <span>Ref: ${fiscalEscape(n.referencia)}</span>
            <span>Total: <b style="color:var(--text)">${fiscalMoney(n.total)}</b></span>
            ${n.numero ? `<span>N: ${fiscalEscape(n.numero)}</span>` : ''}
            ${n.chave_nfe ? `<span>Chave: ${fiscalEscape(n.chave_nfe)}</span>` : ''}
          </div>
          ${msg}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          ${canEmit ? `<button class="btn bp" style="font-size:11px;padding:6px 9px" onclick="fiscalEmitir(${n.id})">Emitir</button>` : ''}
          <button class="btn bg" style="font-size:11px;padding:6px 9px" onclick="fiscalConsultar(${n.id})">Consultar</button>
          ${danfe && canCancel ? `<button class="btn bg" style="font-size:11px;padding:6px 9px" onclick="fiscalImprimirCupom(${n.id})">Imprimir cupom</button>` : ''}
          ${danfe ? `<button class="btn bg" style="font-size:11px;padding:6px 9px" onclick="window.open('${fiscalEscape(danfe)}','_blank')">DANFE</button>` : ''}
          ${xml ? `<button class="btn bg" style="font-size:11px;padding:6px 9px" onclick="window.open('${fiscalEscape(xml)}','_blank')">XML</button>` : ''}
          ${canCancel ? `<button class="btn bd" style="font-size:11px;padding:6px 9px" onclick="fiscalCancelar(${n.id})">Cancelar</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  async function fiscalLoadConfig() {
    fiscalConfig = await fiscalApi('/api/fiscal/config');
    fiscalRenderConfig();
  }

  async function fiscalLoadNotas() {
    const status = fiscalGetVal('fiscal-filter');
    fiscalNotas = await fiscalApi('/api/fiscal/nfce?limit=120' + (status ? '&status=' + encodeURIComponent(status) : ''));
    fiscalRenderNotas();
  }

  async function fiscalLoad() {
    fiscalAlert('', '');
    const importDate = document.getElementById('fiscal-import-date');
    if (importDate && !importDate.value) importDate.value = fiscalDateToday();
    try {
      if (typeof sbLoading === 'function') sbLoading(true);
      await fiscalLoadConfig();
      await fiscalLoadNotas();
      fiscalProdLoad().catch(e => fiscalProdStatus(e.message, true));
    } catch (e) {
      fiscalAlert('err', e.message);
      if (typeof sbToast === 'function') sbToast('err', e.message);
    } finally {
      if (typeof sbLoading === 'function') sbLoading(false);
    }
  }

  async function fiscalSaveConfig() {
    const body = {
      enabled: !!document.getElementById('fiscal-enabled')?.checked,
      ambiente: fiscalGetVal('fiscal-ambiente') || 'homologacao',
      emit_mode: fiscalGetVal('fiscal-emit-mode') || 'fechamento',
      token_homologacao: fiscalGetVal('fiscal-token-homologacao'),
      token_producao: fiscalGetVal('fiscal-token-producao'),
      cnpj_emitente: fiscalGetVal('fiscal-cnpj'),
      inscricao_estadual_emitente: fiscalGetVal('fiscal-ie'),
      regime_tributario_emitente: fiscalGetVal('fiscal-regime') || '1',
      nome_emitente: fiscalGetVal('fiscal-nome'),
      nome_fantasia_emitente: fiscalGetVal('fiscal-fantasia'),
      telefone_emitente: fiscalGetVal('fiscal-telefone'),
      cep_emitente: fiscalGetVal('fiscal-cep'),
      logradouro_emitente: fiscalGetVal('fiscal-logradouro'),
      numero_emitente: fiscalGetVal('fiscal-numero'),
      bairro_emitente: fiscalGetVal('fiscal-bairro'),
      municipio_emitente: fiscalGetVal('fiscal-municipio'),
      uf_emitente: fiscalGetVal('fiscal-uf') || 'CE',
      serie: fiscalGetVal('fiscal-serie'),
      csc_id: fiscalGetVal('fiscal-csc-id'),
      csc_token: fiscalGetVal('fiscal-csc-token'),
      natureza_operacao: 'VENDA AO CONSUMIDOR',
      ncm_padrao: fiscalGetVal('fiscal-ncm'),
      cfop_padrao: fiscalGetVal('fiscal-cfop') || '5102',
      icms_origem_padrao: fiscalGetVal('fiscal-icms-origem') || '0',
      icms_situacao_padrao: fiscalGetVal('fiscal-icms-situacao') || '102',
      unidade_padrao: 'UN',
      imprimir_auto: !!document.getElementById('fiscal-imprimir-auto')?.checked,
      taxa_entrega_nota: !!document.getElementById('fiscal-taxa-entrega')?.checked
    };
    try {
      if (typeof sbLoading === 'function') sbLoading(true);
      fiscalConfig = await fiscalApi('/api/fiscal/config', { method: 'POST', body });
      fiscalRenderConfig();
      fiscalAlert('ok', 'Configuração fiscal salva.');
      if (typeof sbToast === 'function') sbToast('ok', 'Configuração fiscal salva');
    } catch (e) {
      fiscalAlert('err', e.message);
      if (typeof sbToast === 'function') sbToast('err', e.message);
    } finally {
      if (typeof sbLoading === 'function') sbLoading(false);
    }
  }

  async function fiscalImportarHoje() {
    try {
      if (typeof sbLoading === 'function') sbLoading(true);
      const data = fiscalGetVal('fiscal-import-date') || fiscalDateToday();
      const body = { de: data, ate: data };
      const r = await fiscalApi('/api/fiscal/nfce/importar-pendentes', { method: 'POST', body });
      await fiscalLoadNotas();
      const erroMsg = r.erros?.length ? ` ${r.erros.length} venda(s) com erro fiscal.` : '';
      fiscalAlert(r.erros?.length ? 'err' : 'ok', `${r.criadas?.length || 0} NFC-e pendente(s) criada(s). ${r.existentes?.length || 0} ja existiam. Todas as formas de pagamento foram importadas.${erroMsg}`);
      if (typeof sbToast === 'function') sbToast(r.erros?.length ? 'err' : 'ok', `${r.criadas?.length || 0} pendente(s) importada(s)`);
    } catch (e) {
      fiscalAlert('err', e.message);
      if (typeof sbToast === 'function') sbToast('err', e.message);
    } finally {
      if (typeof sbLoading === 'function') sbLoading(false);
    }
  }

  async function fiscalEmitir(id) {
    try {
      if (typeof sbLoading === 'function') sbLoading(true);
      await fiscalApi(`/api/fiscal/nfce/${id}/emitir`, { method: 'POST', body: {} });
      await fiscalLoadNotas();
      fiscalAlert('ok', 'NFC-e enviada para autorizacao.');
      if (typeof sbToast === 'function') sbToast('ok', 'NFC-e enviada');
    } catch (e) {
      fiscalAlert('err', e.message);
      if (typeof sbToast === 'function') sbToast('err', e.message);
      await fiscalLoadNotas().catch(() => {});
    } finally {
      if (typeof sbLoading === 'function') sbLoading(false);
    }
  }

  async function fiscalEmitirPendentes() {
    try {
      if (typeof sbLoading === 'function') sbLoading(true);
      const pagamento = fiscalGetVal('fiscal-import-pagamento');
      const body = { limit: 50 };
      if (pagamento) body.pagamento = pagamento;
      const r = await fiscalApi('/api/fiscal/nfce/emitir-pendentes', { method: 'POST', body });
      await fiscalLoadNotas();
      const filtroMsg = pagamento ? ` Filtro: ${fiscalPagamentoLabel(pagamento)}.` : '';
      fiscalAlert(r.erros?.length ? 'err' : 'ok', `${r.emitidas?.length || 0} NFC-e processada(s). ${r.erros?.length || 0} erro(s).${filtroMsg}`);
      if (typeof sbToast === 'function') sbToast(r.erros?.length ? 'err' : 'ok', 'Emissão de pendentes concluída');
    } catch (e) {
      fiscalAlert('err', e.message);
      if (typeof sbToast === 'function') sbToast('err', e.message);
    } finally {
      if (typeof sbLoading === 'function') sbLoading(false);
    }
  }

  async function fiscalConsultar(id) {
    try {
      if (typeof sbLoading === 'function') sbLoading(true);
      await fiscalApi(`/api/fiscal/nfce/${id}/consultar`, { method: 'POST', body: {} });
      await fiscalLoadNotas();
      fiscalAlert('ok', 'Consulta atualizada.');
    } catch (e) {
      fiscalAlert('err', e.message);
      if (typeof sbToast === 'function') sbToast('err', e.message);
    } finally {
      if (typeof sbLoading === 'function') sbLoading(false);
    }
  }

  async function fiscalCancelar(id) {
    const justificativa = prompt('Justificativa do cancelamento', 'Cancelamento solicitado pelo estabelecimento');
    if (justificativa === null) return;
    try {
      if (typeof sbLoading === 'function') sbLoading(true);
      await fiscalApi(`/api/fiscal/nfce/${id}/cancelar`, { method: 'POST', body: { justificativa } });
      await fiscalLoadNotas();
      fiscalAlert('ok', 'Cancelamento enviado.');
      if (typeof sbToast === 'function') sbToast('ok', 'Cancelamento enviado');
    } catch (e) {
      fiscalAlert('err', e.message);
      if (typeof sbToast === 'function') sbToast('err', e.message);
    } finally {
      if (typeof sbLoading === 'function') sbLoading(false);
    }
  }

  // ── Cupom fiscal na impressora ─────────────────────────
  async function fiscalImprimirCupom(id) {
    try {
      if (typeof sbLoading === 'function') sbLoading(true);
      const r = await fiscalApi(`/api/fiscal/nfce/${id}/danfce`);
      const html = r.html || '';
      const fmt = localStorage.getItem('printFormat') || (typeof _printFormat !== 'undefined' ? _printFormat : '') || '80mm';
      const printer = (() => { try { const c = JSON.parse(localStorage.getItem('printConfig') || '{}'); return c.printer_caixa || c.printer || ''; } catch { return ''; } })() || localStorage.getItem('printPrinter') || '';
      // 1. App do computador (Electron)
      if (window.ElectronPrint && window.ElectronPrint.printHtml) {
        try {
          const er = await window.ElectronPrint.printHtml(html, { printer, paperWidth: fmt === '58mm' ? 58 : 80, landscape: false, scaleFactor: 100 });
          if (er && er.ok) { if (typeof sbToast === 'function') sbToast('ok', 'Cupom fiscal impresso'); return; }
        } catch (e) { console.warn('[fiscal] Electron falhou:', e.message); }
      }
      // 2. Agente de impressão
      try {
        const st = await fetch('/api/print-queue/status', { headers: { 'x-tenant-id': fiscalTenantId() } }).then(x => x.json());
        if (st && st.active) {
          await fetch('/api/print-queue/job', {
            method: 'POST', headers: fiscalHeaders(),
            body: JSON.stringify({ html, format: fmt, printer: printer || undefined, tipo: 'caixa' })
          });
          if (typeof sbToast === 'function') sbToast('ok', 'Cupom fiscal enviado para a impressora');
          return;
        }
      } catch (e) {}
      // 3. Janela do navegador
      const w = window.open('', '_blank', 'width=420,height=700');
      if (!w) { if (typeof sbToast === 'function') sbToast('err', 'Permita pop-ups para imprimir'); return; }
      w.document.write(html + '<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script>');
      w.document.close();
    } catch (e) {
      fiscalAlert('err', e.message);
      if (typeof sbToast === 'function') sbToast('err', e.message);
    } finally {
      if (typeof sbLoading === 'function') sbLoading(false);
    }
  }

  // ── Dados fiscais por produto ──────────────────────────
  const FISCAL_MODELOS = [
    { id: 'comida', nome: 'Comida pronta (lanche, prato, porção)', ncm: '21069090', cfop: '5102', csosn: '102' },
    { id: 'pizza', nome: 'Pizza, pão, bolo, salgado assado', ncm: '19059090', cfop: '5102', csosn: '102' },
    { id: 'sorvete', nome: 'Sorvete e gelados', ncm: '21050010', cfop: '5102', csosn: '102' },
    { id: 'refri', nome: 'Refrigerante (substituição tributária)', ncm: '22021000', cfop: '5405', csosn: '500' },
    { id: 'agua', nome: 'Água mineral (substituição tributária)', ncm: '22011000', cfop: '5405', csosn: '500' },
    { id: 'cerveja', nome: 'Cerveja (substituição tributária)', ncm: '22030000', cfop: '5405', csosn: '500' },
    { id: 'limpar', nome: 'Limpar (usar o padrão da configuração)', ncm: '', cfop: '', csosn: '' }
  ];
  let fiscalProdutos = [];
  const fiscalProdAlterados = new Set();

  function fiscalProdStatus(msg, erro) {
    const el = document.getElementById('fiscal-prod-status');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = erro ? 'var(--danger)' : 'var(--muted)';
  }

  async function fiscalProdLoad() {
    if (!document.getElementById('fiscal-prod-lista')) return;
    fiscalProdutos = await fiscalApi('/api/fiscal/produtos');
    fiscalProdAlterados.clear();
    const cats = [...new Map(fiscalProdutos.map(p => [String(p.category_id || ''), p.categoria || 'Sem categoria'])).entries()];
    const selCat = document.getElementById('fiscal-prod-cat');
    if (selCat) {
      const atual = selCat.value;
      selCat.innerHTML = '<option value="">Todas as categorias</option>' + cats.map(([id, nome]) => `<option value="${fiscalEscape(id)}">${fiscalEscape(nome)}</option>`).join('');
      selCat.value = cats.some(([id]) => id === atual) ? atual : '';
    }
    const selMod = document.getElementById('fiscal-prod-modelo');
    if (selMod && !selMod.options.length) {
      selMod.innerHTML = '<option value="">Escolha um modelo para preencher</option>' + FISCAL_MODELOS.map(m => `<option value="${m.id}">${fiscalEscape(m.nome)}${m.ncm ? ' | NCM ' + m.ncm : ''}</option>`).join('');
    }
    fiscalProdStatus('');
    fiscalProdRender();
  }

  function fiscalProdVisiveis() {
    const busca = fiscalGetVal('fiscal-prod-busca').toLowerCase();
    const cat = document.getElementById('fiscal-prod-cat')?.value || '';
    const faltando = !!document.getElementById('fiscal-prod-faltando')?.checked;
    return fiscalProdutos.filter(p =>
      (!busca || String(p.name || '').toLowerCase().includes(busca)) &&
      (!cat || String(p.category_id || '') === cat) &&
      (!faltando || !p.fiscal_ncm));
  }

  function fiscalProdRender() {
    const tb = document.getElementById('fiscal-prod-lista');
    if (!tb) return;
    const semNcm = fiscalProdutos.filter(p => !p.fiscal_ncm).length;
    const semCest = fiscalProdutos.filter(p => ['500', '60'].includes(String(p.fiscal_icms_situacao || '')) && !p.fiscal_cest).length;
    const res = document.getElementById('fiscal-prod-resumo');
    if (res) {
      const temPadrao = !!(fiscalConfig && fiscalConfig.ncm_padrao);
      res.textContent = !fiscalProdutos.length ? 'Nenhum produto' : semCest ? `${semCest} sem CEST` : semNcm ? `${semNcm} usando o NCM padrão` : 'Todos preenchidos';
      const alerta = semCest || (semNcm && !temPadrao);
      res.style.background = alerta ? 'rgba(239,68,68,.10)' : semNcm ? 'rgba(245,158,11,.12)' : 'rgba(34,197,94,.12)';
      res.style.color = alerta ? 'var(--danger)' : semNcm ? 'var(--accent3)' : 'var(--success)';
    }
    const lista = fiscalProdVisiveis();
    if (!lista.length) {
      tb.innerHTML = `<tr><td colspan="5" style="padding:28px 8px;text-align:center;color:var(--muted)">${fiscalProdutos.length ? 'Nenhum produto com esse filtro.' : 'Cadastre produtos no cardápio para preencher os dados fiscais.'}</td></tr>`;
      return;
    }
    const inp = (p, campo, w, ph) => `<input class="form-input" data-pid="${p.id}" data-campo="${campo}" value="${fiscalEscape(p[campo] || '')}" placeholder="${ph}" inputmode="numeric" style="width:${w};height:32px;font-size:12px;padding:4px 8px" oninput="fiscalProdEditar(this)">`;
    tb.innerHTML = lista.map(p => {
      const st = ['500', '60'].includes(String(p.fiscal_icms_situacao || '')) && !p.fiscal_cest;
      return `<tr style="border-top:1px solid var(--border)">
        <td style="padding:6px 8px;min-width:160px"><div style="font-weight:700">${fiscalEscape(p.name)}</div><div style="font-size:11px;color:${st ? 'var(--danger)' : 'var(--muted)'}">${st ? 'Precisa do CEST' : fiscalEscape(p.categoria || '')}</div></td>
        <td style="padding:6px 8px">${inp(p, 'fiscal_ncm', '108px', fiscalConfig?.ncm_padrao || 'padrão')}</td>
        <td style="padding:6px 8px">${inp(p, 'fiscal_cfop', '68px', fiscalConfig?.cfop_padrao || '5102')}</td>
        <td style="padding:6px 8px">${inp(p, 'fiscal_icms_situacao', '68px', fiscalConfig?.icms_situacao_padrao || '102')}</td>
        <td style="padding:6px 8px">${inp(p, 'fiscal_cest', '94px', '')}</td>
      </tr>`;
    }).join('');
  }

  function fiscalProdEditar(el) {
    const p = fiscalProdutos.find(x => String(x.id) === el.dataset.pid);
    if (!p) return;
    p[el.dataset.campo] = el.value.replace(/\D/g, '');
    fiscalProdAlterados.add(p.id);
    fiscalProdStatus(`${fiscalProdAlterados.size} produto(s) alterado(s). Clique em Salvar produtos.`);
  }

  function fiscalProdAplicarModelo() {
    const m = FISCAL_MODELOS.find(x => x.id === (document.getElementById('fiscal-prod-modelo')?.value || ''));
    if (!m) { fiscalProdStatus('Escolha um modelo primeiro.', true); return; }
    const lista = fiscalProdVisiveis();
    if (!lista.length) { fiscalProdStatus('Nenhum produto na lista.', true); return; }
    if (lista.length > 1 && !confirm(`Aplicar "${m.nome}" em ${lista.length} produtos da lista?`)) return;
    for (const p of lista) {
      p.fiscal_ncm = m.ncm; p.fiscal_cfop = m.cfop; p.fiscal_icms_situacao = m.csosn;
      if (m.csosn !== '500') p.fiscal_cest = '';
      fiscalProdAlterados.add(p.id);
    }
    fiscalProdRender();
    fiscalProdStatus(`${fiscalProdAlterados.size} produto(s) alterado(s). Clique em Salvar produtos.`);
  }

  async function fiscalProdSalvar() {
    if (!fiscalProdAlterados.size) { fiscalProdStatus('Nenhuma alteração para salvar.'); return; }
    const itens = fiscalProdutos.filter(p => fiscalProdAlterados.has(p.id)).map(p => ({
      id: p.id, nome: p.name, ncm: p.fiscal_ncm, cfop: p.fiscal_cfop, csosn: p.fiscal_icms_situacao, cest: p.fiscal_cest, origem: p.fiscal_icms_origem
    }));
    try {
      if (typeof sbLoading === 'function') sbLoading(true);
      const r = await fiscalApi('/api/fiscal/produtos', { method: 'POST', body: { itens } });
      if (r.erros && r.erros.length) {
        fiscalProdStatus(`${r.salvos} salvo(s). Corrija: ${r.erros.slice(0, 3).join('; ')}${r.erros.length > 3 ? '...' : ''}`, true);
        if (typeof sbToast === 'function') sbToast('err', 'Alguns produtos não foram salvos');
        const ruins = new Set(r.erros.map(e => e.split(':')[0]));
        fiscalProdAlterados.forEach(id => { const p = fiscalProdutos.find(x => x.id === id); if (p && !ruins.has(p.name) && !ruins.has(String(p.id))) fiscalProdAlterados.delete(id); });
      } else {
        fiscalProdAlterados.clear();
        fiscalProdStatus(`${r.salvos} produto(s) salvo(s).`);
        if (typeof sbToast === 'function') sbToast('ok', 'Dados fiscais salvos');
      }
      fiscalProdRender();
    } catch (e) {
      fiscalProdStatus(e.message, true);
      if (typeof sbToast === 'function') sbToast('err', e.message);
    } finally {
      if (typeof sbLoading === 'function') sbLoading(false);
    }
  }

  window.fiscalImprimirCupom = fiscalImprimirCupom;
  window.fiscalProdRender = fiscalProdRender;
  window.fiscalProdEditar = fiscalProdEditar;
  window.fiscalProdAplicarModelo = fiscalProdAplicarModelo;
  window.fiscalProdSalvar = fiscalProdSalvar;
  window.fiscalLoad = fiscalLoad;
  window.fiscalLoadNotas = fiscalLoadNotas;
  window.fiscalSaveConfig = fiscalSaveConfig;
  window.fiscalImportarHoje = fiscalImportarHoje;
  window.fiscalEmitir = fiscalEmitir;
  window.fiscalEmitirPendentes = fiscalEmitirPendentes;
  window.fiscalConsultar = fiscalConsultar;
  window.fiscalCancelar = fiscalCancelar;

  function hookNav() {
    if (typeof window._navReady === 'function') {
      const realNav = window._navReady;
      window._navReady = function (id) {
        const ret = realNav(id);
        if (id === 'fiscal') setTimeout(fiscalLoad, 50);
        return ret;
      };
    } else {
      setTimeout(hookNav, 100);
    }
  }
  hookNav();
})();

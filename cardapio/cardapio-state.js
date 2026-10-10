// ══════════════════════════════════════════
//  ESTADO GLOBAL — Cardápio
// ══════════════════════════════════════════
const sb = window.AppAPI;

// ── Tenant / plano ──
let _tenantId    = null;
let _tenantPlano = 'pro';  // 'pro' | 'premium'
let _waNumero    = null;   // WhatsApp do restaurante
let _storeName   = '';     // Nome publico da loja

// ── Dados do menu ──
let allItems     = [];
let allCats      = [];
let allCupons    = [];

// ── Carrinho ──
let cart         = [];
let activeCat    = '';
let searchQ      = '';
let deliveryType = 'delivery';
let selectedPay  = 'dinheiro';
let appliedCupom = null;

// ── Cashback ──
let _cbSaldo       = 0;    // saldo cashback disponível
let _cbUsar        = false; // cliente optou por usar cashback

// ── Taxas / entrega ──
let feeConfig     = {};
let promoAutomatica = {};
let selectedFaixa = 0;
let _pedidoMinimo = 0;
let _pedidoMinimoRetirada = false; // true = o mínimo também vale na retirada (chave do gestor, desligada por padrão)

// O pedido mínimo sempre vale no delivery; na retirada só se a loja ligou a chave.
function _pedidoMinimoAplica(tipo) {
  if (!(_pedidoMinimo > 0)) return false;
  return tipo === 'delivery' || (tipo === 'retirada' && _pedidoMinimoRetirada);
}
function _pedidoMinimoRotulo(tipo) { return tipo === 'retirada' ? 'retirada' : 'delivery'; }

// Barra "Pedido mínimo para ...: R$ X" do carrinho — mostra/esconde e ajusta o texto
function _pedidoMinimoBarra(tipo) {
  const bar = document.getElementById('cart-minimo-bar');
  const val = document.getElementById('cart-minimo-val');
  if (!bar) return;
  if (!_pedidoMinimoAplica(tipo)) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  if (val) {
    val.textContent = 'R$ ' + fmt(_pedidoMinimo);
    const lbl = val.previousSibling;
    if (lbl && lbl.nodeType === 3) lbl.nodeValue = ' Pedido mínimo para ' + _pedidoMinimoRotulo(tipo) + ': ';
  }
}
let _storeAddress = '';
let _storeLat     = null;
let _storeLng     = null;
let _tiposEntrega = ['delivery','retirada','mesa'];
let _pickupAddresses    = [];  // lista de { nome, endereco } — endereços adicionais de retirada
let _selectedPickupIdx  = 0;   // índice do endereço de retirada selecionado pelo cliente
// Seção "Não sabe qual carne escolher?" (robozinho + modal de preparo) —
// liga/desliga pelo gestor em Configurações. true até a config carregar.
let _mostrarIndicacaoPreparo = true;
// Agendamento de pedido quando a loja está fechada — idem, true por padrão.
let _permitirAgendamento = true;
let _agendamentoModalMostrado = false; // mostra o modal 1x por carregamento de página
// Horário escolhido pelo cliente (config do gestor em store_config.agendamento_config)
let _agendamentoCfg = { escolher_horario: false, dias: 2, antecedencia: 60, intervalo: 30 };
let _agModo = 'asap';   // 'asap' (o quanto antes) | 'agendar' (cliente escolheu dia e hora)
let _agDiaSel = '';     // 'AAAA-MM-DD' do dia escolhido
let _agHoraIso = '';    // horário escolhido, ISO com fuso de Brasília
let _pedidoAgendadoPara = null; // Date escolhida, preenchido ao confirmar no modal

// ── Segmento ──
let _segmento      = 'restaurante'; // 'restaurante' | 'acougue'
let _catsCarrossel = false;           // carrossel de categorias (gestor pode ativar)
let _filterPreparo = '';            // preparo selecionado para filtrar itens

// ── Estado da loja ──
let _lojaAberta  = true;

// ── Tracking ──
let _trackOrderId= null;
let _trackChannel= null;
let _initialOrderStatus = 'analise';
let _trackCurrentStatus = '';
let _waOptIn     = false;  // reservado para uso futuro

// ── Numeração de pedidos ──
let _orderNumOffset = 0;  // lido de store_config.order_num_offset (fallback)
function _orderNum(id, orderNum) {
  // Prefere order_num do servidor (sequencial por tenant)
  if (orderNum) return Number(orderNum);
  return Math.max(1, id - _orderNumOffset);
}

// ── Adicionais globalmente esgotados (Set de nomes normalizados) ──
let _addonsEsgotadosSet = new Set();
// Normalização — case-insensitive, sem acento, trim
function _normAddon(s) {
  return String(s||'').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function _isAddonEsgotado(nome) {
  return _addonsEsgotadosSet.has(_normAddon(nome));
}
// ── Adicional indisponível pelo dia da semana configurado (dom=0..sáb=6) ──
function _addonIndisponivelHoje(dias) {
  if (!Array.isArray(dias) || dias.length !== 7) return false; // sem config = disponível todos os dias
  const idxHoje = new Date().getDay();
  return !dias[idxHoje];
}

// ── PIX ──
let _pixPollTimer    = null;
let _pixMpId         = null;
let _pixAtivoGestor  = false;
let _pixKeyManual    = '';
let _pixKeyManualTipo  = 'aleatoria';
let _pixKeyManualBanco = '';

// ── Cartão de Crédito MP ──
let _mpPublicKey     = '';
let _cartaoAtivo     = false;
let _mpInstance      = null;  // instância do SDK MercadoPago
let _mpCardForm      = null;  // instância do CardForm

// ── Auth ──
let _customer    = null;
const AUTH_KEY   = 'estima_customer';
const PROFILE_KEY= 'estima_profile';
const ADDR_KEY   = 'ef_addr';

// ── Pizza meio a meio ──
let _halfItem       = null;   // item da 2ª metade selecionado
let _halfPickerOpen = false;

// ══════════════════════════════════════════
//  ESTADO GLOBAL — Cardápio
// ══════════════════════════════════════════
const sb = window.AppAPI;

// ── Tenant / plano ──
let _tenantId    = null;
let _tenantPlano = 'pro';  // 'pro' | 'premium'
let _waNumero    = null;   // WhatsApp do restaurante

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
let selectedFaixa = 0;
let _pedidoMinimo = 0;
let _storeAddress = '';
let _storeLat     = null;
let _storeLng     = null;
let _tiposEntrega = ['delivery','retirada','mesa'];
let _pickupAddresses    = [];  // lista de { nome, endereco } — endereços adicionais de retirada
let _selectedPickupIdx  = 0;   // índice do endereço de retirada selecionado pelo cliente

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

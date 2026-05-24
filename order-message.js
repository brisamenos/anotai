'use strict'

function moneyBR(value) {
  const n = Number(value || 0)
  return (Number.isFinite(n) ? n : 0).toFixed(2).replace('.', ',')
}

function parseItems(raw) {
  if (Array.isArray(raw)) return raw
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function itemQty(item) {
  const qty = Number(item?.qty ?? item?.quantidade ?? 1)
  return Number.isFinite(qty) && qty > 0 ? qty : 1
}

function itemPrice(item) {
  const price = Number(item?.price ?? item?.preco ?? item?.valor ?? 0)
  return Number.isFinite(price) ? price : 0
}

function itemName(item) {
  return cleanText(item?.name || item?.nome || 'Item')
}

function formatOrderItems(items) {
  if (!items.length) return '- Itens do pedido'
  return items.map((item) => {
    const qty = itemQty(item)
    const price = itemPrice(item)
    const total = qty * price
    const obs = cleanText(item?.obs || item?.observacao || item?.note || '')
    let line = `- ${qty}x ${itemName(item)}`
    if (total > 0) line += ` - R$ ${moneyBR(total)}`
    if (obs) {
      const details = obs
        .split(/\s*\|\s*/)
        .map(cleanText)
        .filter(Boolean)
        .map((part) => `  - ${part}`)
      if (details.length) line += `\n${details.join('\n')}`
    }
    return line
  }).join('\n')
}

function subtotalItems(items) {
  return items.reduce((sum, item) => sum + itemQty(item) * itemPrice(item), 0)
}

function deliveryKind(addr) {
  const text = cleanText(addr)
  const lower = text.toLowerCase()
  if (!text) return { kind: 'retirada', title: 'Retirada', detail: 'Retirada no balcao' }
  if (/^mesa\b/i.test(text)) return { kind: 'mesa', title: 'Mesa', detail: text }
  if (/^retirada\b/i.test(text) || lower.includes('balcao')) return { kind: 'retirada', title: 'Retirada', detail: text }
  return { kind: 'delivery', title: 'Entrega', detail: text }
}

function statusLabel(status, kind) {
  const deliveryReady = kind === 'delivery' ? 'Pronto para sair para entrega' : 'Pronto para retirada/consumo'
  const labels = {
    aguardando_pix: 'Aguardando pagamento PIX',
    aguardando_cartao: 'Aguardando pagamento no cartao',
    analise: 'Pedido recebido, aguardando confirmacao',
    producao: 'Em preparo',
    pronto: deliveryReady,
    saiu: 'Saiu para entrega',
    entregue: 'Entregue',
    cancelado: 'Cancelado',
    finalizado: 'Finalizado'
  }
  return labels[status] || cleanText(status || 'Em andamento')
}

function progressLine(status, kind) {
  const deliverySteps = ['Recebido', 'Em preparo', 'Pronto', 'Saiu para entrega', 'Entregue']
  const pickupSteps = kind === 'mesa'
    ? ['Recebido', 'Em preparo', 'Pronto', 'Servido']
    : ['Recebido', 'Em preparo', 'Pronto', 'Retirado']
  const paymentSteps = {
    aguardando_pix: ['Aguardando PIX', ...deliverySteps],
    aguardando_cartao: ['Aguardando cartao', ...deliverySteps]
  }
  const steps = paymentSteps[status] || (kind === 'delivery' ? deliverySteps : pickupSteps)
  return steps.join(' > ')
}

function paymentLabel(pag) {
  const labels = {
    dinheiro: 'Dinheiro',
    credito: 'Cartao de credito na entrega',
    debito: 'Cartao de debito na entrega',
    pix: 'PIX',
    pix_manual: 'PIX',
    cartao_mp: 'Cartao online'
  }
  return labels[pag] || cleanText(pag || '')
}

function buildOrderTrackingMessage(options) {
  const order = options?.order || {}
  const items = parseItems(order.items)
  const delivery = deliveryKind(order.addr)
  const subtotal = subtotalItems(items)
  const totalItens = Number(order.total || 0)
  const taxa = Number(order.taxa || 0)
  const desconto = Math.max(0, subtotal - totalItens)
  const totalFinal = Math.max(0, totalItens + taxa)
  const hasOrderNumberOption = Object.prototype.hasOwnProperty.call(options || {}, 'orderNumber')
  const orderNumber = hasOrderNumberOption
    ? cleanText(options.orderNumber || '')
    : String(order.order_num || order.id || '').padStart(3, '0')
  const orderTitle = orderNumber ? `*Pedido #${orderNumber}*` : '*Pedido aguardando pagamento*'
  const storeName = cleanText(options?.storeName || 'Restaurante')
  const elapsedText = cleanText(options?.elapsedText || '')
  const includeTrackingNote = options?.includeTrackingNote !== false
  const pay = paymentLabel(order.pag)
  const troco = Number(order.troco || 0)

  const lines = [
    `*${storeName}*`,
    orderTitle,
    '',
    `Status atual: ${statusLabel(order.status, delivery.kind)}${elapsedText ? ` - feito ${elapsedText}` : ''}`,
    `Progresso: ${progressLine(order.status, delivery.kind)}`,
    '',
    '*Itens do pedido*',
    formatOrderItems(items),
    '',
    '*Valores*'
  ]

  if (subtotal > 0) lines.push(`Subtotal dos itens: R$ ${moneyBR(subtotal)}`)
  if (desconto > 0.009) lines.push(`Descontos/Cashback: -R$ ${moneyBR(desconto)}`)
  if (delivery.kind === 'delivery') lines.push(`Taxa de entrega: R$ ${moneyBR(taxa)}`)
  else if (taxa > 0.009) lines.push(`Taxa: R$ ${moneyBR(taxa)}`)
  lines.push(`Total: R$ ${moneyBR(totalFinal)}`)
  if (pay) lines.push(`Pagamento: ${pay}`)
  if (troco > 0) lines.push(`Troco para: R$ ${moneyBR(troco)}`)
  else if (troco < 0) lines.push('Troco: cliente solicitou troco')

  lines.push('', `*${delivery.title}*`, delivery.detail)
  if (includeTrackingNote) {
    lines.push('', '_Vou te avisar por aqui a cada novidade do seu pedido._')
  }

  return lines.join('\n')
}

module.exports = {
  buildOrderTrackingMessage,
  moneyBR,
  parseItems
}

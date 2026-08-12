// scripts/limpar-movimentos-cancelados.js
//
// Limpeza ÚNICA do histórico financeiro: remove da tabela `movimentos`
// qualquer lançamento de "entrada" que pertença a um pedido que foi
// CANCELADO (orders.status = 'cancelado') — e também remove os lançamentos
// de "Estorno — Pedido #N..." que ficaram como saída pra compensar essas
// entradas (agora desnecessários, já que a entrada em si é removida).
//
// Rode uma vez, direto no servidor (mesma pasta/DB do server.js):
//   node scripts/limpar-movimentos-cancelados.js            → modo simulação (não apaga nada, só mostra)
//   node scripts/limpar-movimentos-cancelados.js --apagar   → apaga de verdade
//
// É seguro rodar mais de uma vez (idempotente).

const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')

const DB_PATH = process.env.DB_PATH || (process.platform === 'win32'
  ? path.join(process.env.APPDATA || '.', 'estima', 'estima.db')
  : '/app/data/estima.db')

if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ Banco não encontrado em ${DB_PATH}. Ajuste a variável DB_PATH e rode de novo.`)
  process.exit(1)
}

const DRY_RUN = !process.argv.includes('--apagar')
const db = new Database(DB_PATH)

function numeroPedidoComOffset(order, offset) {
  if (order.order_num) return Number(order.order_num)
  const id = Number(order.id || 0)
  const off = Number(offset || 0)
  return id > off ? Math.max(1, id - off) : id
}

console.log(`\n${DRY_RUN ? '🔎 SIMULAÇÃO (nada será apagado)' : '🗑️  MODO APAGAR — alterações são definitivas'}`)
console.log(`Banco: ${DB_PATH}\n`)

const tenants = db.prepare('SELECT id FROM tenants').all()
let totalRemovidos = 0
let totalValor = 0

for (const { id: tid } of tenants) {
  const cfg = db.prepare('SELECT order_num_offset FROM store_config WHERE tenant_id=?').get(tid)
  const offset = parseInt(cfg?.order_num_offset) || 0

  const cancelados = db.prepare(`SELECT id, order_num FROM orders WHERE tenant_id=? AND status='cancelado'`).all(tid)
  if (!cancelados.length) continue

  for (const order of cancelados) {
    const num = numeroPedidoComOffset(order, offset)

    // Entradas originais do pedido cancelado (padrão "Pedido #N – ..." ou "Pedido #N - ...")
    const entradas = db.prepare(`
      SELECT id, description, val FROM movimentos
      WHERE tenant_id=? AND tipo='entrada'
        AND (description LIKE ? OR description LIKE ?)
    `).all(tid, `Pedido #${num} –%`, `Pedido #${num} -%`)

    // Estornos (saída) que compensavam essa entrada — ficam órfãos depois da limpeza
    const estornos = db.prepare(`
      SELECT id, description, val FROM movimentos
      WHERE tenant_id=? AND tipo='saida'
        AND description LIKE ?
    `).all(tid, `Estorno — Pedido #${num}%`)

    for (const m of [...entradas, ...estornos]) {
      console.log(`  tenant ${tid} · pedido #${num} · remover mov #${m.id}: "${m.description}" (R$ ${Number(m.val).toFixed(2)})`)
      totalRemovidos++
      totalValor += Number(m.val) || 0
      if (!DRY_RUN) db.prepare('DELETE FROM movimentos WHERE id=?').run(m.id)
    }
  }
}

console.log(`\n${DRY_RUN ? 'Encontrados' : 'Removidos'}: ${totalRemovidos} lançamento(s), somando R$ ${totalValor.toFixed(2)}`)
if (DRY_RUN) console.log('\nPra aplicar de verdade: node scripts/limpar-movimentos-cancelados.js --apagar\n')

// ══════════════════════════════════════════════════════════════
//  Limpar links externos (ex: onbeef / S3) guardados DENTRO das
//  opções de corte/preparo/ocasião de cada produto.
//
//  Como rodar (no seu servidor, na pasta do projeto):
//    node limpar-links-externos.js            → SÓ MOSTRA o que encontrou
//    node limpar-links-externos.js --aplicar  → mostra E JÁ LIMPA
//
//  Não precisa instalar nada — usa o mesmo banco (better-sqlite3)
//  que o server.js já usa.
// ══════════════════════════════════════════════════════════════

const Database = require('better-sqlite3');
const path = require('path');

// Mesmo caminho que o server.js usa — ajuste aqui se o seu for diferente
const DB_PATH = process.env.DB_PATH || (process.platform === 'win32'
  ? path.join(__dirname, 'estima.db')
  : '/app/data/estima.db');

const APLICAR = process.argv.includes('--aplicar');

// Se quiser travar numa palavra específica do link (ex: "onbeef" ou o nome
// real do bucket S3 que você viu no navegador), troque aqui. Deixando "s3."
// e "amazonaws" pega qualquer link vindo de um bucket amazon, que é o caso
// que apareceu no print.
const PALAVRAS_SUSPEITAS = ['onbeef', 'amazonaws', 's3.'];

console.log(`Abrindo banco: ${DB_PATH}`);
const db = new Database(DB_PATH);

const rows = db.prepare(`SELECT id, tenant_id, name, custom_groups FROM menu_items WHERE custom_groups IS NOT NULL AND custom_groups != ''`).all();

let totalItensAfetados = 0;
let totalOpcoesLimpas = 0;

for (const row of rows) {
  let grupos;
  try { grupos = JSON.parse(row.custom_groups); } catch (e) { continue; }
  if (!Array.isArray(grupos)) continue;

  let mudou = false;

  for (const grupo of grupos) {
    if (!Array.isArray(grupo?.opcoes)) continue;
    for (const opcao of grupo.opcoes) {
      if (!opcao || typeof opcao !== 'object') continue;
      for (const campo of ['icon', 'image', 'img', 'image_url']) {
        const valor = opcao[campo];
        if (typeof valor === 'string' && PALAVRAS_SUSPEITAS.some(p => valor.toLowerCase().includes(p))) {
          console.log(`  [item #${row.id} · loja ${row.tenant_id} · "${row.name}"] opção "${opcao.nome || opcao.id || '?'}" campo "${campo}": ${valor}`);
          totalOpcoesLimpas++;
          if (APLICAR) { delete opcao[campo]; mudou = true; }
        }
      }
    }
  }

  if (mudou) {
    db.prepare('UPDATE menu_items SET custom_groups = ? WHERE id = ?').run(JSON.stringify(grupos), row.id);
    totalItensAfetados++;
  }
}

console.log('');
console.log(`Encontradas ${totalOpcoesLimpas} referências suspeitas.`);
if (APLICAR) {
  console.log(`✅ Limpo! ${totalItensAfetados} produto(s) atualizado(s) — agora usam o ícone padrão do admin de novo.`);
} else {
  console.log(`Nada foi alterado ainda (modo só-visualizar). Pra aplicar de verdade, rode:`);
  console.log(`  node limpar-links-externos.js --aplicar`);
}

db.close();

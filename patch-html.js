// ═══════════════════════════════════════════════════════
// patch-html.js — Remove CDN do Supabase e injeta o shim
// Execute uma vez: node patch-html.js
// ═══════════════════════════════════════════════════════
const fs = require('fs')
const path = require('path')

const files = ['garcom.html','gestor.html','index.html','login.html','admin.html']
const shimTag = '<script src="/supabase-shim.js"></script>'

// Service workers — adapta URL do Supabase para a API local
const swFiles = ['garcom-sw.js','gestor-sw.js']

let changed = 0

for (const file of files) {
  if (!fs.existsSync(file)) continue
  let html = fs.readFileSync(file, 'utf8')
  const original = html

  // Remove CDN do Supabase (várias variantes)
  html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^"]*"><\/script>\s*/g, '')
  html = html.replace(/<script src="https:\/\/unpkg\.com\/@supabase\/supabase-js[^"]*"><\/script>\s*/g, '')

  // Injeta shim antes do </head> (se ainda não estiver lá)
  if (!html.includes('/supabase-shim.js')) {
    html = html.replace('</head>', `  ${shimTag}\n</head>`)
  }

  if (html !== original) {
    fs.writeFileSync(file, html, 'utf8')
    console.log(`  ✔ Patched: ${file}`)
    changed++
  } else {
    console.log(`  ✓ OK (sem mudanças): ${file}`)
  }
}

// Adapta Service Workers para usar /rest/v1/ local
for (const file of swFiles) {
  if (!fs.existsSync(file)) continue
  let js = fs.readFileSync(file, 'utf8')
  const original = js

  // Substitui SUPA_URL e SUPA_ANON pelas URLs locais
  js = js.replace(
    /const SUPA_URL\s*=\s*'[^']+'/g,
    "const SUPA_URL = '' /* usa URL relativa ao servidor */"
  )
  js = js.replace(
    /const SUPA_ANON\s*=\s*'[^']+'/g,
    "const SUPA_ANON = '' /* não usado mais */'"
  )
  // Remove headers de autenticação do Supabase nos fetch (apikey, Authorization)
  js = js.replace(
    /\{ headers: \{ apikey: SUPA_ANON, Authorization: `Bearer \${SUPA_ANON}` \} \}/g,
    '{ headers: { "Content-Type": "application/json" } }'
  )

  if (js !== original) {
    fs.writeFileSync(file, js, 'utf8')
    console.log(`  ✔ Patched: ${file}`)
    changed++
  } else {
    console.log(`  ✓ OK: ${file}`)
  }
}

console.log(`\n✅ ${changed} arquivo(s) atualizado(s)`)
console.log('Agora faça: git add . && git commit -m "migrate: Supabase → SQLite local"')

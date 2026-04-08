#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  ANOTAÍ — Agente de Impressão Local (Sem Diálogo)       ║
 * ║  Roda no computador da loja e imprime silenciosamente.  ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Uso:
 *   node print-agent.js --url https://SEU-SITE.com --tenant SEU_TENANT_ID
 *
 * Parâmetros opcionais:
 *   --printer "Nome da Impressora"   (padrão: impressora do sistema)
 *   --format  80mm | 58mm | A4       (padrão: 80mm)
 *   --interval 4                     (segundos entre verificações, padrão: 4)
 *   --debug                          (mostra logs extras)
 *
 * Exemplos:
 *   node print-agent.js --url http://localhost:3000 --tenant abc123
 *   node print-agent.js --url https://minha-loja.fly.dev --tenant abc123 --printer "EPSON TM-T20"
 */

const https   = require('https');
const http    = require('http');
const { execSync, exec } = require('child_process');
const path    = require('path');
const os      = require('os');
const fs      = require('fs');

// ── Argumentos da linha de comando ──────────────────────────────
const args = process.argv.slice(2);
function getArg(name, def = '') {
  const i = args.indexOf('--' + name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const hasFlag = (name) => args.includes('--' + name);

const BASE_URL   = getArg('url',      '').replace(/\/$/, '');
const TENANT_ID  = getArg('tenant',   '');
const PRINTER    = getArg('printer',  '');
const FORMAT     = getArg('format',   '80mm');
const INTERVAL   = parseInt(getArg('interval', '4')) * 1000;
const DEBUG      = hasFlag('debug');

if (!BASE_URL || !TENANT_ID) {
  console.error('\n❌  Parâmetros obrigatórios faltando.\n');
  console.error('   Uso: node print-agent.js --url https://SEU-SITE.com --tenant SEU_TENANT_ID\n');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────
const log  = (...a) => console.log(new Date().toLocaleTimeString('pt-BR'), '|', ...a);
const dbg  = (...a) => DEBUG && log('[DBG]', ...a);

function request(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const fullUrl  = BASE_URL + urlPath;
    const parsed   = new URL(fullUrl);
    const lib      = parsed.protocol === 'https:' ? https : http;
    const payload  = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method,
      headers: {
        'x-tenant-id':   TENANT_ID,
        'Content-Type':  'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Heartbeat (mantém o agente "vivo" no servidor) ───────────────
async function sendHeartbeat() {
  try {
    await request('POST', '/api/print-queue/heartbeat', {
      printer: PRINTER,
      format:  FORMAT,
    });
    dbg('Heartbeat OK');
  } catch (e) {
    dbg('Heartbeat falhou:', e.message);
  }
}

// ── Impressão silenciosa com Puppeteer ───────────────────────────
let puppeteer = null;
async function getPuppeteer() {
  if (puppeteer) return puppeteer;
  try {
    puppeteer = require('puppeteer');
    return puppeteer;
  } catch {
    // Tenta instalar localmente
    log('⚙️  Puppeteer não encontrado. Instalando (pode demorar ~1 min)...');
    execSync('npm install puppeteer --no-save', { stdio: 'inherit' });
    puppeteer = require('puppeteer');
    log('✅  Puppeteer instalado!');
    return puppeteer;
  }
}

// Cria HTML completo para o ticket
function wrapHtml(html, fontSize = 12) {
  if (html.includes('<html')) return html;
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; color-adjust:exact !important }
  body { font-family:'Courier New',monospace; font-size:${fontSize}px; color:#000 !important; background:#fff; width:100%; overflow-wrap:break-word; word-break:break-word }
  hr { border:none; border-top:1px dashed #000; margin:4px 0 }
  .pt-center { text-align:center }
  .pt-large  { font-size:${fontSize + 3}px; font-weight:bold }
  .pt-hr     { border:none; border-top:1px dashed #000; margin:4px 0 }
  .print-ticket { padding:2px; width:100%; word-wrap:break-word; overflow-wrap:break-word; overflow:hidden }
  span, div { word-break:break-word; overflow-wrap:break-word }
  @media print {
    @page { margin:1mm; size: portrait }
    .print-ticket + div { page-break-before: always }
  }
</style>
</head><body>${html}</body></html>`;
}

async function printHtml(html, format, printerName) {
  const pptr   = await getPuppeteer();
  const tmpDir = os.tmpdir();
  const pdfPath = path.join(tmpDir, `anotai-print-${Date.now()}.pdf`);

  const browser = await pptr.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(wrapHtml(html), { waitUntil: 'networkidle0' });

    const pdfOpts = {
      path: pdfPath,
      printBackground: true,
      landscape: false,
      margin: { top: '2mm', bottom: '2mm', left: '2mm', right: '2mm' },
    };

    const fmt = format || FORMAT;
    if (fmt === '80mm' || fmt === '58mm') {
      pdfOpts.width  = fmt;
      // Usa scrollHeight para capturar toda a altura incluindo via de cozinha
      const totalH = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) + 32);
      pdfOpts.height = totalH + 'px';
    } else {
      pdfOpts.format = fmt || 'A4';
    }

    await page.pdf(pdfOpts);
  } finally {
    await browser.close();
  }

  // ── Envia para a impressora dependendo do SO ──────────────────
  await sendToPrinter(pdfPath, printerName || PRINTER);

  // Limpa arquivo temporário
  try { fs.unlinkSync(pdfPath); } catch {}
}

function sendToPrinter(pdfPath, printerName) {
  return new Promise((resolve, reject) => {
    let cmd;
    const plat = os.platform();

    if (plat === 'win32') {
      // Windows: SumatraPDF (recomendado) ou AdobeReader
      // Tenta SumatraPDF primeiro (mais confiável para impressão silenciosa)
      const sumatraPath = findSumatra();
      if (sumatraPath) {
        cmd = printerName
          ? `"${sumatraPath}" -print-to "${printerName}" -silent "${pdfPath}"`
          : `"${sumatraPath}" -print-to-default -silent "${pdfPath}"`;
      } else {
        // Fallback: PowerShell com Adobe/Edge PDF
        cmd = printerName
          ? `powershell -Command "Start-Process -FilePath '${pdfPath}' -Verb PrintTo -ArgumentList '${printerName}'"`
          : `powershell -Command "Start-Process -FilePath '${pdfPath}' -Verb Print"`;
      }
    } else if (plat === 'darwin') {
      // macOS: lpr
      cmd = printerName
        ? `lpr -P "${printerName}" "${pdfPath}"`
        : `lpr "${pdfPath}"`;
    } else {
      // Linux: lp / lpr / CUPS
      cmd = printerName
        ? `lp -d "${printerName}" "${pdfPath}"`
        : `lp "${pdfPath}"`;
    }

    dbg('Comando impressão:', cmd);
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        log('⚠️  Aviso ao imprimir:', stderr || err.message);
        // Não rejeita — pode ser warning não fatal
      }
      resolve();
    });
  });
}

function findSumatra() {
  const paths = [
    'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
    'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe',
    process.env.LOCALAPPDATA + '\\SumatraPDF\\SumatraPDF.exe',
  ];
  for (const p of paths) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

// ── Busca e processa jobs pendentes ─────────────────────────────
async function processPendingJobs() {
  let res;
  try {
    res = await request('GET', '/api/print-queue/pending');
  } catch (e) {
    log('❌  Erro ao buscar fila:', e.message);
    return;
  }

  if (!Array.isArray(res.body) || res.body.length === 0) {
    dbg('Nenhum job pendente');
    return;
  }

  log(`📋  ${res.body.length} job(s) para imprimir`);

  for (const job of res.body) {
    log(`🖨️  Imprimindo job #${job.id} (${job.format || FORMAT})...`);
    try {
      await printHtml(job.html, job.format, job.printer);
      await request('PATCH', `/api/print-queue/job/${job.id}/done`, { status: 'done' });
      log(`✅  Job #${job.id} impresso!`);
    } catch (e) {
      log(`❌  Erro no job #${job.id}:`, e.message);
      try {
        await request('PATCH', `/api/print-queue/job/${job.id}/done`, {
          status: 'error',
          error:  e.message,
        });
      } catch {}
    }
  }
}

// ── Loop principal ───────────────────────────────────────────────
async function main() {
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('🖨️  Anotaí — Agente de Impressão Local');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('URL:', BASE_URL);
  log('Tenant:', TENANT_ID);
  log('Impressora:', PRINTER || '(padrão do sistema)');
  log('Formato:', FORMAT);
  log('Intervalo:', INTERVAL / 1000 + 's');
  if (os.platform() === 'win32' && !findSumatra()) {
    log('💡  Dica: instale o SumatraPDF para impressão mais rápida no Windows.');
    log('   https://www.sumatrapdfreader.org/free-pdf-reader');
  }
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('Aguardando pedidos... (Ctrl+C para parar)\n');

  // Heartbeat imediato ao iniciar
  await sendHeartbeat();

  // Loop de heartbeat a cada 15s
  setInterval(sendHeartbeat, 15000);

  // Loop de processamento de jobs
  const loop = async () => {
    await processPendingJobs();
    setTimeout(loop, INTERVAL);
  };
  loop();
}

main().catch(e => {
  log('❌  Erro fatal:', e.message);
  process.exit(1);
});

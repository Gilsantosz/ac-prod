import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';

// Isolated browser fixture: real app modules + real production CSP, no credentials/API/database.
const repo = process.cwd();
const root = await mkdtemp(path.join(repo, '.branding-smoke-'));
const out = path.join(root, 'dist');
const artifacts = path.join(repo, 'branding-smoke-artifacts');
await mkdir(artifacts, { recursive: true });
const appHtml = await readFile(path.join(repo, 'index.html'), 'utf8');
const csp = appHtml.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i)?.[0] || '';
await writeFile(path.join(root, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">${csp}</head><body><div id="root"></div><button id="download">Exportar Excel</button><script type="module" src="/main.jsx"></script></body></html>`);
await writeFile(path.join(root, 'main.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import LeoLogo from '@/components/ui/LeoLogo';
import { loadLeoLogoDataUrl } from '@/lib/reportBranding';
import { createProductionAnalysisReport } from '@/lib/reports/productionAnalysisReport';
import { createReportXlsxBuffer, exportReportExcel } from '@/lib/reports/reportExcelRenderer';
import { createReportPdfBuffer } from '@/lib/reports/reportPdfRenderer';
createRoot(document.getElementById('root')).render(<div style={{ width: 96, height: 96 }}><LeoLogo size="lg" /></div>);
const report = createProductionAnalysisReport({
 generatedAt: '2026-09-22T01:00:00.000Z', period: { from: '2026-09-21', to: '2026-09-21' }, comparisonPeriod: null,
 entries: [
  { id: 'fixture-1', date: '2026-09-21', shift: '1º Turno', cell: 'Bordo', hour: '14:00', metric_unit: 'meters', produced: 875, target: 0, scrap: 0, downtime: 0, operator: 'TESTE SINTÉTICO', approval_status: 'valid', notes: 'Sem dados reais' },
  { id: 'fixture-2', date: '2026-09-21', shift: '1º Turno', cell: 'Corte', hour: '15:00', metric_unit: 'sheets', produced: 995, target: 1000, scrap: 0, downtime: 0, operator: 'TESTE SINTÉTICO', approval_status: 'valid', notes: 'Sem dados reais' }
 ], filters: { cell: 'all', shift: 'all' }, fetchedRowCount: 2,
}, { generatedBy: 'Teste automatizado sem dados reais' });
const encode = (buffer) => { const bytes = new Uint8Array(buffer); let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
window.brandingTest = {
 logo: loadLeoLogoDataUrl,
 xlsx: async (options = {}) => encode(await createReportXlsxBuffer(report, options)),
 pdf: async (options = {}) => encode(await createReportPdfBuffer(report, options)),
};
document.getElementById('download').onclick = async () => {
 try { window.downloadResult = await exportReportExcel(report, { filename: 'teste-producao.xlsx' }); }
 catch (error) { window.downloadError = error.stack || error.message; }
};
`);
let server;
let browser;
const results = [];
const check = async (name, fn) => {
 try { const detail = await fn(); results.push({ name, passed: true, detail }); console.log('PASS', name, detail || ''); }
 catch (error) { results.push({ name, passed: false, error: error.stack || String(error) }); console.error('FAIL', name, error.stack || error); }
};
try {
 await build({ configFile: false, root, base: '/ac-prod/', plugins: [react()], publicDir: path.join(repo, 'public'), resolve: { alias: { '@': path.join(repo, 'src') } }, build: { outDir: out, emptyOutDir: true }, logLevel: 'warn' });
 server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (!pathname.startsWith('/ac-prod/')) { response.writeHead(404); response.end(); return; }
  const rel = pathname.slice('/ac-prod/'.length) || 'index.html';
  const filename = path.resolve(out, rel);
  if (!filename.startsWith(out + path.sep)) { response.writeHead(403); response.end(); return; }
  try {
   const contents = await readFile(filename);
   const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' }[path.extname(filename)] || 'application/octet-stream';
   response.writeHead(200, { 'Content-Type': mime }); response.end(contents);
  } catch { response.writeHead(404, { 'Content-Type': 'text/html' }); response.end('<h1>Asset not found</h1>'); }
 });
 await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
 browser = await chromium.launch();
 const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, acceptDownloads: true });
 page.on('console', (message) => { if (message.type() === 'error') console.error('BROWSER', message.text()); });
 page.on('pageerror', (error) => console.error('PAGEERROR', error.stack));
 await page.route('**/*.supabase.co/**', (route) => route.abort());
 await page.goto(`http://127.0.0.1:${server.address().port}/ac-prod/`);
 await page.waitForFunction(() => Boolean(window.brandingTest), { timeout: 15000 });
 await check('sidebar logo decodes in the browser', async () => {
  await page.waitForFunction(() => { const img = document.querySelector('img[alt="Leo Madeiras"]'); return img?.complete; }, { timeout: 10000 });
  const image = await page.locator('img[alt="Leo Madeiras"]').evaluate((img) => ({ src: img.currentSrc, width: img.naturalWidth, height: img.naturalHeight }));
  console.log('LOGO', image);
  assert.ok(image.width > 0 && image.height > 0, 'Logo image failed to decode');
  return { width: image.width, height: image.height };
 });
 await page.screenshot({ path: path.join(artifacts, 'branding.png') });
 await check('report logo has matching PNG MIME and bytes', async () => {
  const logo = await page.evaluate(() => window.brandingTest.logo());
  assert.ok(logo?.startsWith('data:image/png;base64,'), `Unexpected logo MIME: ${logo?.slice(0, 70)}`);
  const bytes = Buffer.from(logo.split(',')[1], 'base64');
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  return { bytes: bytes.length };
 });
 const verifyXlsx = async (options, filename) => {
  const encoded = await page.evaluate((opts) => window.brandingTest.xlsx(opts), options);
  const bytes = Buffer.from(encoded, 'base64');
  await writeFile(path.join(artifacts, filename), bytes);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
  assert.ok(workbook.getWorksheet('RESUMO'));
  assert.equal(workbook.getWorksheet('DADOS').rowCount, 3);
  assert.ok(workbook.getWorksheet('ANÁLISE'));
  assert.ok(bytes.length > 5000);
  return { bytes: bytes.length, sheets: workbook.worksheets.map((s) => s.name), images: workbook.model.media?.map((m) => ({ extension: m.extension, bytes: m.buffer?.length })) };
 };
 await check('Excel with real logo and charts serializes and reopens', () => verifyXlsx({}, 'com-logo.xlsx'));
 await check('Excel still exports without logo', () => verifyXlsx({ includeLogo: false }, 'sem-logo.xlsx'));
 await check('Excel still exports when optional logo is invalid', () => verifyXlsx({ logoDataUrl: 'data:text/html;base64,PGgxPk5vdCBhbiBpbWFnZTwvaDE+' }, 'logo-invalida.xlsx'));
 await check('PDF with real logo and charts exports', async () => {
  const bytes = Buffer.from(await page.evaluate(() => window.brandingTest.pdf()), 'base64');
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 5000);
  await writeFile(path.join(artifacts, 'com-logo.pdf'), bytes);
  return { bytes: bytes.length };
 });
 await check('Excel download from a real click completes', async () => {
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await page.locator('#download').click();
  const download = await downloadPromise;
  assert.equal(await download.failure(), null);
  assert.equal(download.suggestedFilename(), 'teste-producao.xlsx');
  await download.saveAs(path.join(artifacts, 'download.xlsx'));
  return { filename: download.suggestedFilename() };
 });
 console.log('DOWNLOAD_ERROR', await page.evaluate(() => window.downloadError || null));
 await writeFile(path.join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
 console.log(JSON.stringify(results, null, 2));
 if (results.some((r) => !r.passed)) process.exitCode = 1;
} finally {
 await browser?.close();
 if (server) await new Promise((resolve) => server.close(resolve));
 await rm(root, { recursive: true, force: true });
}

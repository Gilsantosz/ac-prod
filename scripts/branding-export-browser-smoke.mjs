import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';

// Actual app modules, Vite/PWA configuration and CSP. No account, token or database access.
const repo = process.cwd();
const root = await mkdtemp(path.join(repo, '.branding-smoke-'));
const out = path.join(root, 'dist');
const artifacts = path.join(repo, 'branding-smoke-artifacts');
await mkdir(artifacts, { recursive: true });
const appHtml = await readFile(path.join(repo, 'index.html'), 'utf8');
const csp = appHtml.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i)?.[0] || '';
console.log('BRAND REFERENCES\n' + execFileSync('git', ['grep', '-n', 'leo-madeiras-logo', '--', 'src', 'public', 'vite.config.js'], { encoding: 'utf8' }));
await writeFile(path.join(root, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">${csp}</head><body><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>`);
await writeFile(path.join(root, 'main.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import LeoLogo from '@/components/ui/LeoLogo';
import ExportReportMenu from '@/components/reports/ExportReportMenu';
import { loadLeoLogoDataUrl } from '@/lib/reportBranding';
import { createProductionAnalysisReport } from '@/lib/reports/productionAnalysisReport';
import { createReportXlsxBuffer } from '@/lib/reports/reportExcelRenderer';
import { createReportPdf } from '@/lib/reports/reportPdfRenderer';
const report = createProductionAnalysisReport({
 generatedAt: '2026-09-22T01:00:00.000Z', period: { from: '2026-09-21', to: '2026-09-21' }, comparisonPeriod: null,
 entries: [
  { id: 'fixture-1', date: '2026-09-21', shift: '1º Turno', cell: 'Bordo', hour: '14:00', metric_unit: 'meters', produced: 875, target: 0, scrap: 0, downtime: 0, operator: 'TESTE SINTÉTICO', approval_status: 'valid', notes: 'Sem dados reais' },
  { id: 'fixture-2', date: '2026-09-21', shift: '1º Turno', cell: 'Corte', hour: '15:00', metric_unit: 'sheets', produced: 995, target: 1000, scrap: 0, downtime: 0, operator: 'TESTE SINTÉTICO', approval_status: 'valid', notes: 'Sem dados reais' }
 ], filters: { cell: 'all', shift: 'all' }, fetchedRowCount: 2,
}, { generatedBy: 'Teste automatizado sem dados reais' });
createRoot(document.getElementById('root')).render(<div><div style={{ width: 96, height: 96, overflow: 'hidden' }}><LeoLogo size="lg" /></div><ExportReportMenu report={report} onError={({ error }) => { window.exportError = error.stack || error.message; }} /></div>);
const encode = (buffer) => { const bytes = new Uint8Array(buffer); let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
window.brandingTest = {
 logo: loadLeoLogoDataUrl,
 xlsx: async (options = {}) => encode(await createReportXlsxBuffer(report, options)),
 pdf: async (options = {}) => { const doc = await createReportPdf(report, options); return { base64: encode(doc.output('arraybuffer')), imageCount: Object.keys(doc.internal.collections.addImage_images || {}).length }; },
};
`);
let server;
let browser;
const results = [];
const check = async (name, fn) => {
 try { const detail = await fn(); results.push({ name, passed: true, detail }); console.log('PASS', name, detail || ''); }
 catch (error) { results.push({ name, passed: false, error: error.stack || String(error) }); console.error('FAIL', name, error.stack || error); }
};
function imageExtension(bytes) {
 if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'png';
 if (bytes.subarray(0, 3).toString('hex') === 'ffd8ff') return 'jpeg';
 return null;
}
async function verifyWorkbook(bytes, withLogo) {
 const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
 assert.ok(workbook.getWorksheet('RESUMO'));
 const data = workbook.getWorksheet('DADOS');
 assert.equal(data.rowCount, 3);
 assert.ok(workbook.getWorksheet('ANÁLISE'));
 assert.ok(bytes.length > 5000);
 const media = workbook.model.media || [];
 for (const image of media) {
  assert.equal(imageExtension(image.buffer), image.extension, 'Embedded image MIME/extension must match actual bytes');
  assert.ok(image.buffer.length > 30, 'Invalid placeholder is not an image');
 }
 if (withLogo) assert.ok(media.some((m) => m.buffer.length === 8199 && m.extension === 'png'), 'Original company logo must be embedded, not omitted');
 assert.ok(data.getRow(2).values.includes(875));
 assert.ok(data.getRow(3).values.includes(995));
 return { bytes: bytes.length, sheets: workbook.worksheets.map((s) => s.name), images: media.length };
}
try {
 process.env.VITE_APP_BASE = '/ac-prod/';
 await build({ configFile: path.join(repo, 'vite.config.js'), root, base: '/ac-prod/', publicDir: path.join(repo, 'public'), build: { outDir: out, emptyOutDir: true }, logLevel: 'warn' });
 server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (!pathname.startsWith('/ac-prod/')) { response.writeHead(404); response.end(); return; }
  const rel = pathname.slice('/ac-prod/'.length) || 'index.html';
  const filename = path.resolve(out, rel);
  if (!filename.startsWith(out + path.sep)) { response.writeHead(403); response.end(); return; }
  try {
   const contents = await readFile(filename);
   const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }[path.extname(filename)] || 'application/octet-stream';
   response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); response.end(contents);
  } catch { response.writeHead(404, { 'Content-Type': 'text/html' }); response.end('<h1>Asset not found</h1>'); }
 });
 await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
 browser = await chromium.launch();
 const url = `http://127.0.0.1:${server.address().port}/ac-prod/`;
 const newContext = async () => {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, acceptDownloads: true });
  await context.route('**/*.supabase.co/**', (route) => route.abort());
  return context;
 };
 const context = await newContext();
 const page = await context.newPage();
 page.on('console', (message) => { if (message.type() === 'error') console.error('BROWSER', message.text()); });
 page.on('pageerror', (error) => console.error('PAGEERROR', error.stack));
 await page.goto(url);
 await page.waitForFunction(() => Boolean(window.brandingTest), null, { timeout: 15000 });
 const verifyLogo = async (target) => {
  await target.waitForFunction(() => { const img = document.querySelector('img[alt="Leo Madeiras"]'); return img?.complete; }, null, { timeout: 10000 });
  const image = await target.locator('img[alt="Leo Madeiras"]').evaluate((img) => ({ width: img.naturalWidth, height: img.naturalHeight }));
  assert.equal(image.width, 690); assert.equal(image.height, 685); return image;
 };
 await check('sidebar logo decodes online', () => verifyLogo(page));
 await page.screenshot({ path: path.join(artifacts, 'branding.png') });
 await check('report logo has matching PNG MIME and bytes', async () => {
  const logo = await page.evaluate(() => window.brandingTest.logo());
  assert.ok(logo?.startsWith('data:image/png;base64,'), `Unexpected logo MIME: ${logo?.slice(0, 70)}`);
  const bytes = Buffer.from(logo.split(',')[1], 'base64'); assert.equal(imageExtension(bytes), 'png'); return { bytes: bytes.length };
 });
 const verifyXlsx = async (options, filename, withLogo = true) => {
  const encoded = await page.evaluate((opts) => window.brandingTest.xlsx(opts), options);
  const bytes = Buffer.from(encoded, 'base64'); await writeFile(path.join(artifacts, filename), bytes);
  return verifyWorkbook(bytes, withLogo);
 };
 await check('Excel with company logo and charts reopens with intact media', () => verifyXlsx({}, 'com-logo.xlsx'));
 await check('Excel exports without optional logo', () => verifyXlsx({ includeLogo: false }, 'sem-logo.xlsx', false));
 await check('Excel skips invalid optional logo instead of corrupting workbook', () => verifyXlsx({ logoDataUrl: 'data:text/html;base64,PGgxPk5vdCBhbiBpbWFnZTwvaDE+' }, 'logo-invalida.xlsx', false));
 await check('PDF with company logo and charts exports', async () => {
  const result = await page.evaluate(() => window.brandingTest.pdf()); const bytes = Buffer.from(result.base64, 'base64');
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-'); assert.ok(result.imageCount >= 3);
  await writeFile(path.join(artifacts, 'com-logo.pdf'), bytes); return { bytes: bytes.length, images: result.imageCount };
 });
 const exportFromMenu = async (target, filename) => {
  const downloadPromise = target.waitForEvent('download', { timeout: 15000 });
  // Observe rejection immediately while the menu interaction is awaited.
  downloadPromise.catch(() => {});
  await target.getByRole('button', { name: 'Exportar' }).click();
  await target.getByRole('menuitem').filter({ hasText: 'Excel' }).click();
  try {
   const download = await downloadPromise;
   assert.equal(await download.failure(), null); assert.match(download.suggestedFilename(), /\.xlsx$/);
   await download.saveAs(path.join(artifacts, filename));
   return await verifyWorkbook(await readFile(path.join(artifacts, filename)), true);
  } catch (error) { throw new Error(`${error.message}; application error: ${await target.evaluate(() => window.exportError || null)}`); }
 };
 await check('actual ExportReportMenu Excel click downloads an intact workbook', () => exportFromMenu(page, 'menu-download.xlsx'));
 await check('cold PWA works offline with logo and first Excel export', async () => {
  const offlineContext = await newContext();
  try {
   const offlinePage = await offlineContext.newPage();
   await offlinePage.goto(url);
   await offlinePage.waitForFunction(() => Boolean(window.brandingTest), null, { timeout: 15000 });
   await offlinePage.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('PWA install timeout')), 15000))]).then(() => true));
   await offlinePage.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 10000 });
   const cdp = await offlineContext.newCDPSession(offlinePage);
   await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
   await offlineContext.setOffline(true); await offlinePage.reload();
   await offlinePage.waitForFunction(() => Boolean(window.brandingTest), null, { timeout: 15000 });
   await verifyLogo(offlinePage);
   return await exportFromMenu(offlinePage, 'offline-download.xlsx');
  } finally { await offlineContext.close(); }
 });
 await writeFile(path.join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
 console.log(JSON.stringify(results, null, 2));
 if (results.some((r) => !r.passed)) process.exitCode = 1;
} finally {
 await browser?.close();
 if (server) await new Promise((resolve) => server.close(resolve));
 await rm(root, { recursive: true, force: true });
}

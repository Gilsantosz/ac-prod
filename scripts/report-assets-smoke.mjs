import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';

// No login, credentials or database requests: exercise the real renderers with synthetic data.
const root = process.cwd();
const fixture = path.join(root, '.report-smoke');
const output = path.join(root, '.report-smoke-output');
await mkdir(fixture, { recursive: true });
await mkdir(output, { recursive: true });
const originalHtml = await readFile(path.join(root, 'index.html'), 'utf8');
await writeFile(path.join(fixture, 'index.html'), originalHtml.replace('src="/src/main.jsx"', 'src="./entry.jsx"'));
await writeFile(path.join(fixture, 'entry.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import LeoLogo from '@/components/ui/LeoLogo';
import { createProductionAnalysisReport } from '@/lib/reports/productionAnalysisReport';
import { createReportXlsxBuffer, exportReportExcel } from '@/lib/reports/reportExcelRenderer';
import { createReportPdfBuffer } from '@/lib/reports/reportPdfRenderer';
import { loadLeoLogoDataUrl } from '@/lib/reportBranding';
const entries = [{ id:'fixture', date:'2026-09-21', shift:'1º Turno', cell:'Bordo', hour:'14:00',
  produced:875, target:0, scrap:0, downtime:0, metric_unit:'meters', approval_status:'valid', operator:'Teste', notes:'=2+2' }];
const report = createProductionAnalysisReport({period:{from:'2026-09-21',to:'2026-09-21'},generatedAt:'2026-09-21T12:00:00Z', entries,
  filters:{cell:'Bordo',shift:'1º Turno',metric_unit:'meters'},fetchedRowCount:entries.length});
createRoot(document.getElementById('root')).render(<div style={{padding:30,background:'#eee'}}><h1>Validação de marca e exportação</h1><div style={{width:60,height:60}}><LeoLogo size="lg" /></div></div>);
window.reportSmoke = {report, loadLeoLogoDataUrl, createReportXlsxBuffer, createReportPdfBuffer, exportReportExcel};
`);
let server; let browser;
const evidence = {};
try {
  await build({ configFile: false, root: fixture, base: '/ac-prod/', plugins: [react()],
    resolve: { alias: { '@': path.join(root, 'src') } },
    build: { outDir: path.join(output, 'site'), emptyOutDir: true }, logLevel:'warn' });
  server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (!pathname.startsWith('/ac-prod/')) { res.writeHead(404); res.end(); return; }
      const relative = pathname.slice('/ac-prod/'.length) || 'index.html';
      const filename = path.resolve(output, 'site', relative);
      if (!filename.startsWith(path.join(output, 'site') + path.sep)) throw new Error('Invalid path');
      const bytes = await readFile(filename);
      const type = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'}[path.extname(filename)] || 'application/octet-stream';
      res.writeHead(200, {'Content-Type':type}); res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0,'127.0.0.1',resolve));
  browser = await chromium.launch();
  const page = await browser.newPage({ acceptDownloads:true });
  const errors=[];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/ac-prod/`);
  await page.waitForFunction(()=>Boolean(window.reportSmoke));
  await page.locator('img[alt="Leo Madeiras"]').waitFor();
  evidence.logo = await page.locator('img[alt="Leo Madeiras"]').evaluate(async (img) => {
    try { await img.decode(); return {ok:true,width:img.naturalWidth,height:img.naturalHeight,source:img.src.slice(0,120)}; }
    catch (error) { return {ok:false,error:error.message,source:img.src.slice(0,120)}; }
  });
  evidence.logoData = await page.evaluate(async()=>{const data=await window.reportSmoke.loadLeoLogoDataUrl();return data?.slice(0,70)||null;});
  for (const kind of ['xlsx','pdf']) {
    const result = await page.evaluate(async (kind) => {
      try {
        const api=window.reportSmoke;
        const buffer=await (kind==='xlsx'?api.createReportXlsxBuffer:api.createReportPdfBuffer)(api.report);
        return {ok:true,bytes:Array.from(new Uint8Array(buffer))};
      } catch(error) { return {ok:false,error:error.message,stack:error.stack}; }
    },kind);
    if(result.ok) {
      const bytes=Buffer.from(result.bytes);
      await writeFile(path.join(output,`production.${kind}`),bytes);
      evidence[kind]={ok:true,bytes:bytes.length};
      if(kind==='xlsx') {
        const workbook=new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
        evidence.xlsx.sheets=workbook.worksheets.map(s=>s.name);
        evidence.xlsx.media=workbook.model.media.map(m=>({extension:m.extension,size:m.buffer?.length}));
        assert.equal(workbook.getWorksheet('DADOS').getCell('F2').value,875);
      }
    } else evidence[kind]=result;
  }
  await page.screenshot({path:path.join(output,'logo.png')});
  evidence.browserErrors=errors;
  console.log('REPORT_BROWSER_EVIDENCE',JSON.stringify(evidence));
  await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
  assert.equal(evidence.logo.ok,true,'The actual logo must decode');
  assert.equal(evidence.xlsx.ok,true,'Excel must be generated');
  assert.equal(evidence.pdf.ok,true,'PDF must be generated');
} finally {
  await browser?.close();
  if(server) await new Promise(resolve=>server.close(resolve));
  await rm(fixture,{recursive:true,force:true});
}

import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { build } from 'vite';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';

// Real components, renderer and PWA configuration. No login or database requests.
const root = process.cwd();
const fixture = path.join(root, '.report-smoke');
const output = path.join(root, '.report-smoke-output');
await mkdir(fixture, { recursive: true });
await mkdir(output, { recursive: true });
const originalLogo = await readFile(path.join(root, 'src/assets/leo-madeiras-logo.jpg'));
const originalHtml = await readFile(path.join(root, 'index.html'), 'utf8');
await writeFile(path.join(fixture, 'index.html'), originalHtml.replace('src="/src/main.jsx"', 'src="./entry.jsx"'));
await writeFile(path.join(fixture, 'entry.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import LeoLogo from '@/components/ui/LeoLogo';
import ExportReportMenu from '@/components/reports/ExportReportMenu';
import { createProductionAnalysisReport } from '@/lib/reports/productionAnalysisReport';
import { createReportXlsxBuffer } from '@/lib/reports/reportExcelRenderer';
import { createReportPdfBuffer } from '@/lib/reports/reportPdfRenderer';
import { loadLeoLogoDataUrl } from '@/lib/reportBranding';
const entries = [{ id:'fixture', date:'2026-09-21', shift:'1º Turno', cell:'Bordo', hour:'14:00',
  produced:875, target:0, scrap:0, downtime:0, metric_unit:'meters', approval_status:'valid', operator:'Teste', notes:'=2+2' }];
const report = createProductionAnalysisReport({period:{from:'2026-09-21',to:'2026-09-21'},generatedAt:'2026-09-21T12:00:00Z', entries,
  filters:{cell:'Bordo',shift:'1º Turno',metric_unit:'meters'},fetchedRowCount:entries.length});
createRoot(document.getElementById('root')).render(<div style={{padding:30,background:'#eee'}}><h1>Validação de marca e exportação</h1><div style={{width:60,height:60,overflow:'hidden'}}><LeoLogo size="lg" /></div><ExportReportMenu report={report} onError={({error})=>{window.exportError=error.message;}} /></div>);
window.reportSmoke = {report, loadLeoLogoDataUrl, createReportXlsxBuffer, createReportPdfBuffer};
`);
let server; let browser;
const evidence = {};
const oldBase = process.env.VITE_APP_BASE;
try {
  process.env.VITE_APP_BASE = '/ac-prod/';
  await build({ configFile: path.join(root,'vite.config.js'), root: fixture,
    build: { outDir: path.join(output, 'site'), emptyOutDir: true }, logLevel:'warn' });
  server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (!pathname.startsWith('/ac-prod/')) { res.writeHead(404); res.end(); return; }
      const relative = pathname.slice('/ac-prod/'.length) || 'index.html';
      const filename = path.resolve(output, 'site', relative);
      if (!filename.startsWith(path.join(output, 'site') + path.sep)) throw new Error('Invalid path');
      const bytes = await readFile(filename);
      const type = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'}[path.extname(filename)] || 'application/octet-stream';
      res.writeHead(200, {'Content-Type':type}); res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0,'127.0.0.1',resolve));
  browser = await chromium.launch();
  const url = `http://127.0.0.1:${server.address().port}/ac-prod/`;
  const offline = await browser.newContext({acceptDownloads:true});
  const offlinePage = await offline.newPage();
  await offlinePage.goto(url);
  await offlinePage.waitForFunction(()=>Boolean(window.reportSmoke));
  await offlinePage.evaluate(async()=>{
    await navigator.serviceWorker.register('/ac-prod/sw.js');
    await navigator.serviceWorker.ready;
  });
  await offlinePage.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  await offline.setOffline(true);
  evidence.firstOfflineExcel = await offlinePage.evaluate(async()=>{
    try {
      const api=window.reportSmoke;
      const data=await api.createReportXlsxBuffer(api.report);
      const img=document.querySelector('img[alt="Leo Madeiras"]'); await img.decode();
      return {ok:true,bytes:data.byteLength,logoWidth:img.naturalWidth};
    } catch(error) { return {ok:false,error:error.message}; }
  });
  await offline.close();

  const page = await browser.newPage({ acceptDownloads:true });
  const errors=[];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(()=>Boolean(window.reportSmoke));
  await page.locator('img[alt="Leo Madeiras"]').waitFor();
  evidence.logo = await page.locator('img[alt="Leo Madeiras"]').evaluate(async (img) => {
    try { await img.decode(); return {ok:true,width:img.naturalWidth,height:img.naturalHeight,embedded:img.src.startsWith('data:image/png;base64,')}; }
    catch (error) { return {ok:false,error:error.message}; }
  });
  const logoData = await page.evaluate(()=>window.reportSmoke.loadLeoLogoDataUrl());
  evidence.originalArtworkPreserved = originalLogo.equals(Buffer.from(logoData.split(',')[1],'base64'));
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
        assert.equal(workbook.getWorksheet('DADOS').getCell('N2').value,"'=2+2");
        assert.equal(workbook.model.media[0].extension,'png');
      }
    } else evidence[kind]=result;
  }
  await page.getByRole('button',{name:'Exportar',exact:true}).click();
  const downloaded = page.waitForEvent('download',{timeout:30_000});
  await page.getByRole('menuitem').filter({hasText:'Excel'}).click();
  const download=await downloaded;
  const downloadedPath=path.join(output,'menu-download.xlsx');
  await download.saveAs(downloadedPath);
  const saved=await readFile(downloadedPath);
  const workbook=new ExcelJS.Workbook(); await workbook.xlsx.load(saved);
  evidence.menuDownload={ok:(await download.failure())===null,filename:download.suggestedFilename(),bytes:saved.length,produced:workbook.getWorksheet('DADOS').getCell('F2').value};
  await page.screenshot({path:path.join(output,'logo.png')});
  evidence.browserErrors=errors;
  console.log('REPORT_BROWSER_EVIDENCE',JSON.stringify(evidence));
  await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
  assert.equal(evidence.logo.ok,true,'The actual logo must decode');
  assert.equal(evidence.logo.embedded,true,'The logo must not require a network image');
  assert.equal(evidence.originalArtworkPreserved,true);
  assert.equal(evidence.xlsx.ok,true,'Excel must be generated');
  assert.equal(evidence.pdf.ok,true,'PDF must be generated');
  assert.equal(evidence.menuDownload.ok,true,'The actual menu must download a readable workbook');
  assert.equal(evidence.firstOfflineExcel.ok,true,'First export must work after the PWA is ready, even offline');
} finally {
  if(oldBase===undefined) delete process.env.VITE_APP_BASE; else process.env.VITE_APP_BASE=oldBase;
  await browser?.close();
  if(server) await new Promise(resolve=>server.close(resolve));
  await rm(fixture,{recursive:true,force:true});
}

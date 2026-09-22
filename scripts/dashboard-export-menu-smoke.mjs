import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { build } from 'vite';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';

// Real menu and export engine. Authentication is a local fixture; no account or
// production data is accessed. The production CSS, CSP and Vite config are reused.
const repo = process.cwd();
const root = await mkdtemp(path.join(repo, '.dashboard-export-'));
const out = path.join(root, 'dist');
const artifacts = path.join(repo, 'dashboard-export-artifacts');
await mkdir(artifacts, { recursive: true });
const html = await readFile(path.join(repo, 'index.html'), 'utf8');
await writeFile(path.join(root, 'index.html'), html.replace('src="/src/main.jsx"', 'src="./main.jsx"'));
const authStub = path.join(root, 'auth.js');
await writeFile(authStub, 'export const useAuth = () => ({ user: { name: "Validação sintética" } });');
await writeFile(path.join(root, 'main.jsx'), `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ExportMenu from '@/components/dashboard/ExportMenu';
import PageHeader from '@/components/ui/PageHeader';
import { LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import '@/index.css';
const selected = { id:'synthetic-day',date:'2026-09-21',cell:'Bordo',shift:'1º Turno',hour:'14:00',metric_unit:'meters',produced:875,target:0,scrap:0,downtime:0,approval_status:'valid' };
const previous = { ...selected,id:'synthetic-week',date:'2026-09-15',produced:25 };
function Fixture() {
 const [year, setYear] = useState('all');
 window.setExportYear = setYear;
 return <main className="p-4 sm:p-6 space-y-5"><PageHeader title="Painéis de Produtividade" subtitle="Indicadores automáticos por turno, célula e hora." icon={LayoutDashboard} />
  <div className="flex flex-wrap items-center gap-2.5" data-testid="dashboard-actions">
   <Button variant="outline">Gerar Relatório</Button>
   <ExportMenu entries={[selected]} allEntries={[selected,previous]} filters={{date:'2026-09-21',year,cell:'Bordo',shift:'1º Turno',metric_unit:'meters'}} />
   <Button variant="outline">Layout</Button><Button variant="outline">Modo Quiosque</Button>
  </div></main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
`);
let server; let browser;
const results = [];
try {
 process.env.VITE_APP_BASE = '/ac-prod/';
 await build({ configFile: path.join(repo,'vite.config.js'), root, publicDir:path.join(repo,'public'),
  resolve: { alias: [{ find:'@/lib/AuthContext',replacement:authStub }, {find:'@',replacement:path.join(repo,'src')}] },
  build:{ outDir:out,emptyOutDir:true }, logLevel:'warn' });
 server = createServer(async (request,response) => {
  const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  if (!pathname.startsWith('/ac-prod/')) { response.writeHead(404); response.end(); return; }
  const filename=path.resolve(out,pathname.slice('/ac-prod/'.length)||'index.html');
  if (!filename.startsWith(out+path.sep)) { response.writeHead(403); response.end(); return; }
  try {
   const bytes=await readFile(filename);
   const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'}[path.extname(filename)]||'application/octet-stream';
   response.writeHead(200,{'Content-Type':mime}); response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch();
 for (const viewport of [{width:390,height:844},{width:1280,height:900}]) {
  const context=await browser.newContext({viewport,acceptDownloads:true});
  await context.route('**/*.supabase.co/**',route=>route.abort());
  const page=await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/ac-prod/`);
  const button=page.getByRole('button',{name:'Exportar',exact:true});
  await button.waitFor();
  assert.equal(await button.count(),1);
  assert.equal(await page.getByText('Semana:',{exact:true}).count(),0);
  await page.screenshot({path:path.join(artifacts,`painel-${viewport.width}.png`),fullPage:true});
  await button.click();
  const menu=page.getByRole('menu');
  await menu.waitFor();
  assert.equal(await menu.getByRole('menuitem').count(),6);
  const box=await menu.boundingBox();
  assert.ok(box.x>=0 && box.x+box.width<=viewport.width+1,'Menu exceeds viewport width');
  assert.ok(box.y>=0 && box.y+box.height<=viewport.height+1,'Menu exceeds viewport height');
  await page.screenshot({path:path.join(artifacts,`menu-${viewport.width}.png`),fullPage:true});
  await page.keyboard.press('Escape');
  for (const [scope, expected] of [['Período selecionado',[875]],['Últimos 7 dias',[25,875]]]) {
   await button.click();
   const pending=page.waitForEvent('download',{timeout:20000}); pending.catch(()=>{});
   await page.getByRole('group',{name:new RegExp(scope)}).getByRole('menuitem',{name:/^Excel/}).click();
   const download=await pending;
   assert.equal(await download.failure(),null);
   const workbook=new ExcelJS.Workbook();
   await workbook.xlsx.load(await readFile(await download.path()));
   const sheet=workbook.getWorksheet('DADOS');
   const quantities=[];
   sheet.eachRow((row,index)=>{if(index>1) quantities.push(row.getCell(6).value);});
   assert.deepEqual(quantities.sort((a,b)=>a-b),expected);
   results.push({width:viewport.width,scope,singleButton:true,download:true,quantities});
   await page.waitForFunction(()=>!document.querySelector('button[aria-haspopup="menu"]')?.disabled);
  }
  await page.evaluate(()=>window.setExportYear('2026'));
  await button.click();
  await page.getByRole('group',{name:/Ano de 2026/}).waitFor();
  assert.equal(await page.getByRole('menuitem').count(),3);
  assert.equal(await page.getByRole('group',{name:/Últimos 7 dias/}).count(),0);
  results.push({width:viewport.width,annualMode:true,singleButton:true});
  await context.close();
 }
 await writeFile(path.join(artifacts,'results.json'),JSON.stringify(results,null,2));
 console.log('DASHBOARD_EXPORT_MENU_PASS',JSON.stringify(results));
} finally {
 await browser?.close();
 if(server) await new Promise(resolve=>server.close(resolve));
 await rm(root,{recursive:true,force:true});
}

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { build } from 'vite';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';

// Real Dashboard, queries, KPI/insight components, charts and export engine.
// Only remote data/auth/layout persistence and unrelated lot polling are stubbed.
// No account, credential, network data or writes to the production database.
const repo = process.cwd();
const root = await mkdtemp(path.join(repo, '.goal-kpi-'));
const out = path.join(root, 'dist');
const artifacts = path.join(repo, 'goal-kpi-artifacts');
await mkdir(artifacts, { recursive: true });
const aliases = [];
async function stub(name, code) {
  const file = path.join(root, `${aliases.length}.jsx`);
  await writeFile(file, code);
  aliases.push({ find: name, replacement: file });
}
await stub('@/lib/AuthContext', 'export const useAuth = () => ({ user: { name: "Validação sintética" } });');
await stub('@/hooks/useCells', 'const activeCells = ["Bordo","Corte","Embalagem"].map(name=>({name,active:true})); export const useCells=()=>({activeCells});');
await stub('@/lib/KioskContext', 'export const useKiosk=()=>({kiosk:false,toggleKiosk:()=>{}});');
await stub('@/hooks/useDashboardLayout', 'export const useDashboardLayout=(ids)=>({order:ids.filter(id=>id!=="generalLotProgress"),hidden:[],sizes:{},ready:true,saving:false,reorder:()=>{},toggleHidden:()=>{},toggleSize:()=>{}});');
await stub('@/hooks/useLowEfficiencyAlert', 'export const useLowEfficiencyAlert=()=>({open:false,alerts:[],dismiss:()=>{}});');
await stub('@/hooks/usePerformanceAlert', 'export const usePerformanceAlert=()=>{};');
await stub('@/hooks/useEfficiencyDropAlert', 'export const useEfficiencyDropAlert=()=>{};');
await stub('@/components/dashboard/GeneralLotProgressPanel', 'export default function UnrelatedLotFixture(){return null;}');
await stub('@/lib/dashboardData', `
const day = '2026-09-21';
const row = {date:day,cell:'Bordo',shift:'1º Turno',hour:'14:00',metric_unit:'meters',target:0,scrap:0,downtime:0,approval_status:'valid'};
window.goalFixture = { entries:[{...row,id:'a',produced:875},{...row,id:'b',hour:'15:00',produced:125}],
  goals:[{id:'g',date:'2026-07-29',cell_name:'Bordo',shift:'1º Turno',metric_unit:'meters',target:3000,capacity:9999}],calendar:[],failGoals:false };
export const fetchDashboardProductionEntries=async()=>structuredClone(window.goalFixture.entries);
export const fetchDashboardYearBounds=async()=>({oldestDate:day,newestDate:day});
export const fetchDashboardGoalContext=async()=>{ if(window.goalFixture.failGoals) throw new Error('Falha sintética de consulta'); return structuredClone({goals:window.goalFixture.goals,calendar:window.goalFixture.calendar}); };
`);
aliases.push({ find: '@', replacement: path.join(repo, 'src') });
const html = await readFile(path.join(repo, 'index.html'), 'utf8');
await writeFile(path.join(root, 'index.html'), html.replace('src="/src/main.jsx"', 'src="./main.jsx"'));
await writeFile(path.join(root, 'main.jsx'), `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import Dashboard from '@/pages/Dashboard';
import '@/index.css';
const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
window.goalQueryClient=client;
window.refreshGoalFixture=()=>Promise.all([client.invalidateQueries({queryKey:['dailyGoals']}),client.invalidateQueries({queryKey:['production']})]);
createRoot(document.getElementById('root')).render(<MemoryRouter><QueryClientProvider client={client}><Dashboard /></QueryClientProvider></MemoryRouter>);
`);
let server, browser;
const results=[];
try {
  process.env.VITE_APP_BASE='/ac-prod/';
  await build({configFile:path.join(repo,'vite.config.js'),root,publicDir:path.join(repo,'public'),resolve:{alias:aliases},build:{outDir:out,emptyOutDir:true},logLevel:'warn'});
  server=createServer(async(req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const filename=path.resolve(out,pathname.replace(/^\/ac-prod\//,'')||'index.html');
    if(!pathname.startsWith('/ac-prod/')||!filename.startsWith(out+path.sep)){res.writeHead(404);res.end();return;}
    try{
      const data=await readFile(filename);
      const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'}[path.extname(filename)]||'application/octet-stream';
      res.writeHead(200,{'Content-Type':mime});res.end(data);
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch();
  for(const width of [390,1280]){
    const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true});
    await context.route('**/*.supabase.co/**',route=>route.abort());
    const page=await context.newPage();
    const pageErrors=[];
    page.on('pageerror',error=>pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/ac-prod/`);
    await page.getByLabel('Data do painel').fill('2026-09-21');
    await page.waitForFunction(()=>document.querySelector('[data-kpi="target"]')?.textContent.includes('3.000'));
    const kpi=(field)=>page.locator(`[data-kpi="${field}"]`);
    assert.match(await kpi('produced').innerText(),/1\.000/);
    assert.match(await kpi('attainment').innerText(),/33,3%/);
    assert.equal(await page.getByRole('button',{name:'Exportar',exact:true}).count(),1);
    const noOverflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal page overflow');
    await noOverflow();
    await page.locator('summary').filter({hasText:'Conferir produção × meta'}).click();
    await page.getByText('29/07/2026',{exact:true}).waitFor();
    await noOverflow();
    for(const dark of [false,true]){
      await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark);
      await page.waitForTimeout(400);
      await page.locator('[data-testid="executive-kpis"]').screenshot({path:path.join(artifacts,`kpis-${width}-${dark?'dark':'light'}.png`)});
      await page.getByRole('region',{name:'Insights de produção e metas'}).screenshot({path:path.join(artifacts,`insights-${width}-${dark?'dark':'light'}.png`)});
    }
    await page.evaluate(()=>document.documentElement.classList.remove('dark'));
    // Click the real export menu and reopen the file. Two reads, one daily target.
    await page.getByRole('button',{name:'Exportar',exact:true}).click();
    const pending=page.waitForEvent('download',{timeout:25000}); pending.catch(()=>{});
    await page.getByRole('group',{name:/Período selecionado/}).getByRole('menuitem',{name:/^Excel/}).click();
    const download=await pending;
    assert.equal(await download.failure(),null);
    const filename=path.join(artifacts,`metas-${width}.xlsx`);
    await download.saveAs(filename);
    const workbook=new ExcelJS.Workbook(); await workbook.xlsx.load(await readFile(filename));
    assert.equal(workbook.getWorksheet('DADOS').rowCount,3);
    const summary=workbook.getWorksheet('RESUMO');
    let exportedTarget;
    summary.eachRow(row=>{if(row.getCell(1).value==='Meta · metros')exportedTarget=row.getCell(2).value;});
    assert.equal(exportedTarget,3000);
    assert.ok(workbook.getWorksheet('ANÁLISE').rowCount>5);
    // Simulate a registry mutation using the existing invalidation namespace.
    await page.evaluate(async()=>{window.goalFixture.goals[0].target=2000;await window.goalQueryClient.invalidateQueries({queryKey:['dailyGoals']});});
    await page.waitForFunction(()=>document.querySelector('[data-kpi="attainment"]')?.textContent.includes('50%'));
    assert.match(await kpi('target').innerText(),/2\.000/);
    // A failed refetch must not say there are no registered goals, or show 50%.
    await page.evaluate(async()=>{window.goalFixture.failGoals=true;await window.refreshGoalFixture();});
    await page.getByRole('alert').filter({hasText:'metas ou o calendário'}).waitFor();
    assert.match(await kpi('attainment').innerText(),/Indisponível/);
    assert.equal(await page.getByRole('button',{name:'Exportar',exact:true}).isDisabled(),true);
    // Restore and test the known volume protocol, without manufacturing meters.
    await page.evaluate(async()=>{window.goalFixture.failGoals=false;window.goalFixture.entries=window.goalFixture.entries.map(e=>({...e,entry_mode:'manual_volume',pieces_quantity:e.produced,edge_meters:0}));await window.refreshGoalFixture();});
    await page.waitForFunction(()=>document.querySelector('[data-kpi="produced"]')?.textContent.includes('A medir'));
    assert.match(await kpi('attainment').innerText(),/Sem base/);
    await page.getByText('Peças não são metros nem chapas',{exact:true}).waitFor();
    await page.getByRole('button',{name:'peças',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-kpi="produced"]')?.textContent.includes('1.000'));
    assert.match(await kpi('target').innerText(),/Sem base/);
    assert.match(await kpi('attainment').innerText(),/Sem base/);
    await noOverflow();
    await page.locator('[data-testid="executive-kpis"]').screenshot({path:path.join(artifacts,`pecas-${width}.png`)});
    // Annual filter uses per-date goal history and keeps the single export menu.
    await page.getByRole('combobox',{name:'Filtro de ano'}).click();
    await page.getByRole('option',{name:'Resumo anual · 2026'}).click();
    await page.getByText('Resumo Anual de Produção — 2026',{exact:true}).waitFor();
    await noOverflow();
    assert.deepEqual(pageErrors,[]);
    results.push({width,kpiTarget:3000,readings:2,targetCountedOnce:true,attainment:33.33333333333333,
      registryInvalidation:true,queryFailureSafe:true,piecesNotMeters:true,annualRender:true,exportedTarget,noHorizontalOverflow:true});
    await context.close();
  }
  await writeFile(path.join(artifacts,'results.json'),JSON.stringify(results,null,2));
  console.log('DASHBOARD_GOAL_KPI_PASS',JSON.stringify(results));
}finally{
  await browser?.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  await rm(root,{recursive:true,force:true});
}

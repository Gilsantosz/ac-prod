import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { createProductionAnalysisReport } from './productionAnalysisReport';
import { createReportXlsxBuffer } from './reportExcelRenderer';
import { createReportPdfBuffer } from './reportPdfRenderer';
const snapshot={generatedAt:'2026-09-05T12:00:00Z',period:{from:'2026-08-01',to:'2026-08-31'},comparisonPeriod:null,filters:{cell:'all',shift:'all'},entries:[
 {date:'2026-08-01',cell:'Corte',produced:80,target:100,scrap:4,downtime:20,notes:'=WEBSERVICE("unsafe")'},
 {date:'2026-08-01',cell:'Bordo',produced:520.5,target:600,scrap:0,downtime:10},
 {date:'2026-08-01',cell:'Embalagem',produced:180,target:200,scrap:2,downtime:30},
 {date:'2026-08-02',cell:'Corte',produced:999,target:999,approval_status:'reversed'},
]};
describe('exportação do diagnóstico compartilhado',()=>{
 it('gera Excel editável com unidades, fórmulas, ações e proteção de textos externos',async()=>{
  const report=createProductionAnalysisReport(snapshot);
  const buffer=await createReportXlsxBuffer(report,{includeCharts:false,includeLogo:false});
  const {default:ExcelJS}=await import('exceljs');const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);
  const sheet=workbook.getWorksheet('DADOS');
  const headers=sheet.getRow(1).values;
  const value=(label)=>sheet.getCell(2,headers.indexOf(label)).value;
  expect(sheet.rowCount).toBe(4);
  expect(value('Unidade')).toBe('chapas');
  expect(value('Produzido')).toBe(80);
  expect(value('Atingimento').formula).toContain('IF(');
  expect(value('Atingimento').result).toBe(0.8);
  expect(value('Observações')).toMatch(/^'/);
  const actions=workbook.getWorksheet('LEITURA E AÇÕES');
  expect(actions.getCell('B3').value).toBe(report.metadata.insights[0].evidence);
  expect(actions.getCell('D2').value).toBe('Responsável');
  expect(actions.getCell('F3').dataValidation.type).toBe('list');
  expect(report.summary.some(i=>i.key==='oee')).toBe(false);
  if(process.env.ANALYSIS_QA_DIR)await writeFile(`${process.env.ANALYSIS_QA_DIR}/production-demo.xlsx`,Buffer.from(buffer));
 });
 it('gera PDF paginado com o diagnóstico e as tabelas do mesmo recorte',async()=>{
  const report=createProductionAnalysisReport(snapshot);
  const buffer=await createReportPdfBuffer(report,{includeCharts:false,logoDataUrl:null});
  const content=new TextDecoder('latin1').decode(buffer);
  expect(content.startsWith('%PDF-')).toBe(true);
  expect(content).toContain('Indicadores');
  expect(content).toContain('Corte');
  if(process.env.ANALYSIS_QA_DIR)await writeFile(`${process.env.ANALYSIS_QA_DIR}/production-demo.pdf`,Buffer.from(buffer));
 });
});

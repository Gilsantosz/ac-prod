import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createReportDefinition } from './reportDefinition';
import { createReportXlsxBuffer } from './reportExcelRenderer';

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6eS8AAAAASUVORK5CYII=';

function buildLargeReport(rowCount = 2_050) {
  return createReportDefinition({
    id: 'production',
    title: 'Relatório de Produção',
    generatedAt: '2026-08-23T12:00:00.000Z',
    period: { from: '2026-08-01', to: '2026-08-31' },
    comparisonPeriod: { from: '2026-07-01', to: '2026-07-31' },
    filters: { Células: 'Todas', Turnos: 'Todos' },
    summary: [{ key: 'oee', label: 'OEE', value: 0.824, previous: 0.781, format: 'percentage' }],
    comparisons: [{ key: 'oee', delta: 4.3, mode: 'points', direction: 'up', assessment: 'positive' }],
    tables: [
      {
        id: 'data', title: 'Dados', sheet: 'data', primary: true,
        columns: [
          { key: 'date', label: 'Data', type: 'date', width: 12 },
          { key: 'produced', label: 'Produzido', type: 'number', width: 14 },
          { key: 'attainment', label: 'Atingimento', type: 'percentage', width: 14 },
          { key: 'notes', label: 'Observações', type: 'text', width: 24 },
        ],
        rows: Array.from({ length: rowCount }, (_, index) => ({
          date: `2026-08-${String((index % 28) + 1).padStart(2, '0')}`,
          produced: index + 1,
          attainment: 0.82,
          notes: index === 0 ? '=2+2' : `Linha ${index + 1}`,
        })),
      },
      {
        id: 'analysis', title: 'Análise', sheet: 'analysis',
        columns: [{ key: 'cell', label: 'Célula', type: 'text' }, { key: 'value', label: 'Valor', type: 'number' }],
        rows: [{ cell: 'Corte', value: 100 }],
      },
    ],
  });
}

describe('renderizador Excel institucional', () => {
  it('gera XLSX íntegro, tipado, filtrável, com logo e sem perder linhas entre chunks', async () => {
    const report = buildLargeReport();
    const logoDataUrl = process.env.REPORT_XLSX_OUTPUT
      ? `data:image/jpeg;base64,${(await readFile(resolve(process.cwd(), 'src/assets/leo-madeiras-logo.jpg'))).toString('base64')}`
      : TINY_PNG;
    const buffer = await createReportXlsxBuffer(report, { logoDataUrl, includeCharts: false });
    if (process.env.REPORT_XLSX_OUTPUT) await writeFile(process.env.REPORT_XLSX_OUTPUT, Buffer.from(buffer));
    const module = await import('exceljs');
    const ExcelJS = module.default || module;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['RESUMO', 'DADOS', 'ANÁLISE']);
    expect(workbook.model.media).toHaveLength(1);
    const data = workbook.getWorksheet('DADOS');
    expect(data.rowCount).toBe(2_051);
    expect(data.autoFilter).toBeTruthy();
    expect(data.getCell('A2').value).toBeInstanceOf(Date);
    expect(typeof data.getCell('B2').value).toBe('number');
    expect(data.getCell('C2').numFmt).toBe('0.0%');
    expect(data.getCell('D2').value).toBe("'=2+2");
  }, 20_000);
});

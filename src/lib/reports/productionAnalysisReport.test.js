import { describe, expect, it } from 'vitest';
import { createProductionAnalysisReport } from './productionAnalysisReport';

const entry = (date, produced, target, overrides = {}) => ({
  date,
  shift: '1º Turno',
  cell: 'Corte',
  hour: '08:00',
  produced,
  target,
  scrap: 0,
  downtime: 0,
  operator: 'Operador',
  notes: '',
  approval_status: 'valid',
  ...overrides,
});

describe('relatório analítico de produção', () => {
  it('compartilha exatamente as métricas da análise com PDF, XLSX e CSV', () => {
    const report = createProductionAnalysisReport({
      generatedAt: '2026-08-23T12:00:00.000Z',
      period: { from: '2026-08-01', to: '2026-08-15' },
      comparisonPeriod: { from: '2026-07-17', to: '2026-07-31' },
      filters: { cell: 'all', shift: 'all' },
      entries: [entry('2026-08-01', 120, 120), entry('2026-08-02', 80, 80, { scrap: 10, downtime: 30 })],
      comparisonEntries: [entry('2026-07-17', 100, 200, { downtime: 40 })],
      fetchedRowCount: 3,
    });

    const produced = report.summary.find((item) => item.key === 'produced-sheets');
    const attainment = report.summary.find((item) => item.key === 'attainment-sheets');
    const attainmentComparison = report.comparisons.find((item) => item.key === 'attainment-sheets');
    const dataTable = report.tables.find((table) => table.primary);

    expect(produced.value).toBe(report.metadata.analysis.units[0].produced);
    expect(produced.value).toBe(200);
    expect(attainment.value).toBe(1);
    expect(attainmentComparison.delta).toBe(50);
    expect(dataTable.rows).toHaveLength(2);
    expect(report.charts[0].series[0].values.reduce((sum, value) => sum + value, 0)).toBe(200);
  });
});

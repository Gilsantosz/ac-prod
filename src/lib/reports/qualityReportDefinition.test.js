import { describe, expect, it } from 'vitest';
import { createQualityReportDefinition } from '@/lib/reports/qualityReportDefinition';

describe('createQualityReportDefinition', () => {
  it('mantém uma única base tipada para PDF, Excel e CSV', () => {
    const report = createQualityReportDefinition({
      generatedBy: 'Auditora',
      filters: { periodLabel: 'Hoje', cell: 'Corte' },
      metrics: {
        period: { from: '2026-08-23', to: '2026-08-23' },
        snapshotAt: '2026-08-23T15:00:00.000Z',
        fpy: 92.5,
        rejectionRate: 7.5,
        openNCs: 1,
        totalDefects: 3,
        closureRate: 50,
        criticalNCs: 1,
        rawNCs: [{
          nc_code: 'NC-1', defect_name: 'Peça riscada', quantity: 3, severity: 'high',
          disposition: 'rework', status: 'open', cell_name: 'Corte',
          detected_at: '2026-08-23T12:00:00.000Z', notes: '=HYPERLINK("x")',
        }],
        paretoData: [{ defect: 'Peça riscada', count: 3, percentage: 100, cumulativePercentage: 100 }],
        sixMData: [{ name: 'Material', value: 3 }],
        byCellData: [{ cell: 'Corte', defects: 3 }],
        pChartData: [{ date: '2026-08-23', sampleSize: 40, approved: 37, rejected: 3, rejectionRate: 7.5, p: 0.075, pBar: 0.075, ucl: 0.2, lcl: 0 }],
      },
    });

    expect(report.summary.find((item) => item.key === 'fpy')?.value).toBe(0.925);
    expect(report.tables.find((table) => table.primary)?.rows[0]).toMatchObject({
      code: 'NC-1', quantity: 3, severity: 'Alta', status: 'Aberta', cell: 'Corte',
    });
    expect(report.tables.find((table) => table.id === 'quality-pareto')?.rows[0].percentage).toBe(1);
    expect(report.charts).toHaveLength(2);
  });
});

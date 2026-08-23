import { describe, expect, it } from 'vitest';
import {
  ANNUAL_FILTER_DISABLED,
  buildAnnualProductionSummary,
  buildDashboardYearOptions,
  getDashboardPeriodRange,
  matchesDashboardPeriod,
} from '@/lib/dashboardPeriod';

describe('dashboardPeriod', () => {
  it('usa o ano inteiro quando o filtro anual está ativo', () => {
    expect(getDashboardPeriodRange('2026-08-23', '2025')).toEqual({
      startDate: '2025-01-01',
      endDate: '2026-01-01',
    });
    expect(matchesDashboardPeriod('2025-12-31', '2026-08-23', '2025')).toBe(true);
    expect(matchesDashboardPeriod('2026-01-01', '2026-08-23', '2025')).toBe(false);
  });

  it('volta a considerar somente a data quando o filtro anual é desativado', () => {
    expect(matchesDashboardPeriod('2026-08-23', '2026-08-23', ANNUAL_FILTER_DISABLED)).toBe(true);
    expect(matchesDashboardPeriod('2026-08-22', '2026-08-23', ANNUAL_FILTER_DISABLED)).toBe(false);
  });

  it('oferece todos os anos entre o primeiro registro e o ano atual', () => {
    expect(buildDashboardYearOptions('2023-04-01', '2025-12-31', new Date('2026-08-23T12:00:00')))
      .toEqual(['2026', '2025', '2024', '2023']);
  });

  it('consolida produção e metas por mês e ignora registros estornados', () => {
    const summary = buildAnnualProductionSummary([
      { date: '2025-01-10', produced: 100, target: 90, scrap: 4, downtime: 5 },
      { date: '2025-01-11', produced: 50, target: 60, scrap: 1, downtime: 2 },
      { date: '2025-02-01', produced: 25, target: 30, approval_status: 'reversed' },
      { date: '2024-12-31', produced: 999, target: 999 },
    ], '2025');

    expect(summary.months[0]).toMatchObject({
      produced: 150,
      target: 150,
      records: 2,
      efficiency: 100,
      downtime: 7,
    });
    expect(summary.months[1]).toMatchObject({ produced: 0, target: 0, records: 0 });
    expect(summary.totals).toMatchObject({ produced: 150, target: 150, efficiency: 100, records: 2 });
  });
});

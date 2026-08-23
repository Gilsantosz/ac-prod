import { describe, expect, it } from 'vitest';
import { ANNUAL_FILTER_DISABLED, getDailySummaryPeriod } from '@/lib/dailySummaryPeriod';

describe('getDailySummaryPeriod', () => {
  it('mantém a consulta limitada ao dia quando o ano está desativado', () => {
    expect(getDailySummaryPeriod('2026-08-23', ANNUAL_FILTER_DISABLED)).toEqual({
      fromDate: '2026-08-23',
      toDate: '2026-08-23',
      annual: false,
      label: 'Data: 23/08/2026',
    });
  });

  it('consulta de janeiro a dezembro quando um ano é selecionado', () => {
    expect(getDailySummaryPeriod('2026-08-23', '2024')).toEqual({
      fromDate: '2024-01-01',
      toDate: '2024-12-31',
      annual: true,
      label: 'Ano de 2024',
    });
  });
});

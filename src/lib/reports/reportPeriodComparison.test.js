import { describe, expect, it } from 'vitest';
import {
  buildMetricComparison,
  calculateComparisonPeriod,
  calculatePercentagePointDifference,
  calculatePercentageVariation,
} from './reportPeriodComparison';

describe('comparação de períodos de relatórios', () => {
  it('usa o intervalo imediatamente anterior com a mesma quantidade de dias', () => {
    expect(calculateComparisonPeriod({ from: '2026-08-01', to: '2026-08-15' })).toEqual({
      from: '2026-07-17',
      to: '2026-07-31',
      strategy: 'previous-equivalent-period',
    });
  });

  it('prefere o mês calendário anterior para um mês completo', () => {
    expect(calculateComparisonPeriod({ from: '2026-08-01', to: '2026-08-31' })).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
      strategy: 'previous-month',
    });
  });

  it('compara anos completos com o ano anterior', () => {
    expect(calculateComparisonPeriod({ from: '2026-01-01', to: '2026-12-31' })).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
      strategy: 'previous-year',
    });
  });

  it('evita Infinity e NaN quando a base é zero', () => {
    expect(calculatePercentageVariation(0, 0)).toBe(0);
    expect(calculatePercentageVariation(10, 0)).toBeNull();
    expect(calculatePercentageVariation(110, 100)).toBeCloseTo(10);
  });

  it('diferencia percentual de pontos percentuais e interpreta menor como melhor', () => {
    expect(calculatePercentagePointDifference(82, 78)).toBe(4);
    expect(buildMetricComparison({
      key: 'downtime', label: 'Downtime', current: 420, previous: 510, lowerIsBetter: true,
    })).toMatchObject({ direction: 'down', assessment: 'positive' });
  });
});

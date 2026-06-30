import { describe, expect, it } from 'vitest';
import { groupBy, isValidProductionEntry, sumBy } from '@/lib/productionMetrics';

describe('productionMetrics', () => {
  it('ignora apontamentos estornados nos totais operacionais', () => {
    const entries = [
      { cell: 'Corte', produced: 10, target: 12, approval_status: 'valid' },
      { cell: 'Corte', produced: 5, target: 5, approval_status: 'reversed' },
      { cell: 'Corte', produced: 2, target: 2 },
    ];

    expect(isValidProductionEntry(entries[1])).toBe(false);
    expect(sumBy(entries, 'produced')).toBe(12);
    expect(groupBy(entries, 'cell')[0]).toMatchObject({ produced: 12, target: 14, count: 2 });
  });
});

import { describe, expect, it } from 'vitest';
import { createReportDefinition, validateReportDefinition } from './reportDefinition';

const input = {
  id: 'production',
  title: 'Produção',
  generatedAt: '2026-08-23T12:00:00.000Z',
  period: { from: '2026-08-01', to: '2026-08-23' },
  filters: { Células: 'Todas' },
  tables: [{ id: 'data', primary: true, columns: [{ key: 'value', label: 'Valor', type: 'number' }], rows: [{ value: 1 }] }],
};

describe('definição central de relatório', () => {
  it('normaliza uma definição válida', () => {
    const report = createReportDefinition(input);
    expect(validateReportDefinition(report)).toBe(true);
    expect(report.generatedAt).toBe('2026-08-23T12:00:00.000Z');
    expect(report.filters).toEqual({ Células: 'Todas' });
  });

  it('rejeita período invertido e tabelas sem colunas', () => {
    expect(() => createReportDefinition({ ...input, period: { from: '2026-08-23', to: '2026-08-01' } })).toThrow(/data inicial/i);
    expect(() => createReportDefinition({ ...input, tables: [{ id: 'data', columns: [], rows: [] }] })).toThrow(/não possui colunas/i);
  });
});

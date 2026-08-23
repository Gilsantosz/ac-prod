import { describe, expect, it } from 'vitest';
import { calculatePlannedMinutes, createDailySummaryReport } from './exportDailySummary';

const active = (entries = 1) => ({ entries, target: 0, capacity: 0 });

describe('calculatePlannedMinutes', () => {
  it('usa as horas configuradas da célula para cada turno ativo', () => {
    const summary = {
      matrixByCell: [{
        cell: 'Corte',
        shifts: {
          '1º Turno': active(),
          '2º Turno': active(),
          '3º Turno': active(0),
        },
      }],
    };
    const cells = [{
      name: 'Corte',
      hoursShift1: 7.5,
      hoursShift2: 6,
      hoursShift3: 4,
    }];

    expect(calculatePlannedMinutes(summary, cells)).toBe((7.5 + 6) * 60);
  });

  it('não duplica as horas quando a célula possui mais de uma unidade produtiva', () => {
    const summary = {
      matrixByCell: [
        { cell: 'Bordo', metric_unit: 'meters', shifts: { '1º Turno': active() } },
        { cell: 'Bordo', metric_unit: 'pieces', shifts: { '1º Turno': active() } },
      ],
    };

    expect(calculatePlannedMinutes(summary, [{ name: 'Bordo', hoursShift1: 7 }])).toBe(420);
  });

  it('usa oito horas apenas quando não existe configuração cadastrada', () => {
    const summary = {
      matrixByCell: [{ cell: 'Usinagem', shifts: { '2º Turno': active() } }],
    };

    expect(calculatePlannedMinutes(summary)).toBe(480);
  });
});

describe('createDailySummaryReport', () => {
  it('preserva o intervalo e o título anual sem exibir OEE diário', () => {
    const report = createDailySummaryReport({
      date: '2025-01-01',
      period: {
        from: '2025-01-01',
        to: '2025-12-31',
        label: 'Ano de 2025',
        title: 'Resumo Anual de Produção',
      },
      shift: [],
      cell: [],
      summary: { total: {}, totalsByUnit: [], byCellShift: [], byCell: [], byShift: [] },
    });

    expect(report).toMatchObject({
      title: 'Resumo Anual de Produção',
      subtitle: 'Ano de 2025',
      period: { from: '2025-01-01', to: '2025-12-31' },
    });
    expect(report.summary.map((item) => item.key)).not.toContain('oee');
  });
});

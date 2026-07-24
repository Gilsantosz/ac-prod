import { describe, expect, it } from 'vitest';
import { calculatePlannedMinutes } from './exportDailySummary';

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

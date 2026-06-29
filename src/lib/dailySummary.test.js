import { describe, expect, it } from 'vitest';
import { buildDailySummary } from '@/lib/dailySummary';

const date = '2026-05-22';

function goal(cell, shift, unit, capacity, target = capacity) {
  return {
    date,
    shift,
    cell_name: cell,
    area_name: cell,
    metric_unit: unit,
    metric_unit_label: unit === 'sheets' ? 'chapas' : unit === 'meters' ? 'metros' : 'peças',
    metric_name: cell,
    capacity,
    target,
  };
}

function entry(cell, shift, produced, extra = {}) {
  return {
    date,
    shift,
    cell,
    hour: '08:00',
    produced,
    ...extra,
  };
}

describe('buildDailySummary', () => {
  it('monta a matriz por célula, turno e unidade sem somar unidades diferentes', () => {
    const goals = [
      goal('Seccionadoras', '1º Turno', 'sheets', 150),
      goal('Seccionadoras', '2º Turno', 'sheets', 150),
      goal('Seccionadoras', '3º Turno', 'sheets', 50),
      goal('Coladeiras', '1º Turno', 'meters', 3000),
      goal('Coladeiras', '2º Turno', 'meters', 2315),
      goal('Coladeiras', '3º Turno', 'meters', 400),
      goal('Furadeiras', '1º Turno', 'pieces', 1400),
      goal('Furadeiras', '2º Turno', 'pieces', 600),
      goal('Embalagem', '1º Turno', 'pieces', 1600),
      goal('Embalagem', '2º Turno', 'pieces', 1400),
    ];
    const entries = [
      entry('Seccionadoras', '1º Turno', 249, { sheet_count: 249 }),
      entry('Seccionadoras', '2º Turno', 117, { sheet_count: 117 }),
      entry('Seccionadoras', '3º Turno', 61, { sheet_count: 61 }),
      entry('Coladeiras', '1º Turno', 1, { edge_meters: 3468 }),
      entry('Coladeiras', '2º Turno', 1, { edge_meters: 2505 }),
      entry('Coladeiras', '3º Turno', 1, { edge_meters: 510 }),
      entry('Furadeiras', '1º Turno', 445),
      entry('Furadeiras', '2º Turno', 1500),
      entry('Embalagem', '1º Turno', 1615),
      entry('Embalagem', '2º Turno', 1413),
    ];

    const summary = buildDailySummary(entries, goals);
    const seccionadoras = summary.matrixByCell.find((row) => row.cell === 'Seccionadoras');
    const coladeiras = summary.matrixByCell.find((row) => row.cell === 'Coladeiras');
    const pieces = summary.totalsByUnit.find((row) => row.metric_unit === 'pieces');

    expect(seccionadoras.unitLabel).toBe('chapas');
    expect(seccionadoras.total.capacity).toBe(350);
    expect(seccionadoras.total.realized).toBe(427);
    expect(seccionadoras.shifts['1º Turno'].differenceCapacity).toBe(99);

    expect(coladeiras.unitLabel).toBe('metros');
    expect(coladeiras.total.capacity).toBe(5715);
    expect(coladeiras.total.realized).toBe(6483);
    expect(coladeiras.shifts['2º Turno'].differenceCapacity).toBe(190);

    expect(summary.totalsByUnit).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric_unit: 'sheets', realized: 427 }),
      expect.objectContaining({ metric_unit: 'meters', realized: 6483 }),
    ]));
    expect(pieces.realized).toBe(4973);
  });
});

import { describe, expect, it } from 'vitest';
import { mergeEffectiveProductionGoals } from './cellsGoalsService';

describe('mergeEffectiveProductionGoals', () => {
  it('mantém a última meta anterior vigente na data selecionada', () => {
    const goals = mergeEffectiveProductionGoals({
      date: '2026-07-29',
      priorGoals: [
        {
          id: 'borda-27',
          date: '2026-07-27',
          shift: '1º Turno',
          cell_name: 'Borda',
          metric_unit: 'meters',
          target: 3000,
        },
      ],
    });

    expect(goals).toEqual([
      expect.objectContaining({
        id: 'borda-27',
        effective_date: '2026-07-29',
        inherited_from_date: '2026-07-27',
        is_inherited: true,
        target: 3000,
      }),
    ]);
  });

  it('substitui a meta herdada quando existe meta exata para a mesma célula, turno e unidade', () => {
    const goals = mergeEffectiveProductionGoals({
      date: '2026-07-29',
      priorGoals: [
        {
          id: 'embalagem-27',
          date: '2026-07-27',
          shift: '1º Turno',
          cell_name: 'Embalagem',
          metric_unit: 'pieces',
          target: 1600,
        },
      ],
      exactGoals: [
        {
          id: 'embalagem-29',
          date: '2026-07-29',
          shift: '1º Turno',
          cell_name: 'Embalagem',
          metric_unit: 'pieces',
          target: 1800,
        },
      ],
    });

    expect(goals).toHaveLength(1);
    expect(goals[0]).toEqual(expect.objectContaining({
      id: 'embalagem-29',
      target: 1800,
      inherited_from_date: null,
      is_inherited: false,
    }));
  });

  it('não confunde acentos ou diferenças de caixa na chave canônica da meta', () => {
    const goals = mergeEffectiveProductionGoals({
      date: '2026-07-29',
      priorGoals: [
        {
          id: 'furacao-27',
          date: '2026-07-27',
          shift: '1º TURNO',
          cell_name: 'Furação',
          metric_unit: 'pieces',
          target: 1000,
        },
      ],
      exactGoals: [
        {
          id: 'furacao-29',
          date: '2026-07-29',
          shift: '1º Turno',
          cell_name: 'Furacao',
          metric_unit: 'PIECES',
          target: 1200,
        },
      ],
    });

    expect(goals).toHaveLength(1);
    expect(goals[0].id).toBe('furacao-29');
  });
});

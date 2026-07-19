import { describe, expect, it } from 'vitest';
import { buildLotRuntimeSummary } from '@/lib/productionHistoryService';

function plannedPiece(id, routeSteps) {
  return {
    id,
    piece_uid: `PECA-${id}`,
    status: 'planned',
    current_stage: routeSteps[0],
    route_steps: routeSteps,
    completed_steps: [],
  };
}

describe('andamento real do Kanban de rastreabilidade', () => {
  it('não transforma 0/30 em 30/30 apenas porque o lote foi avançado', () => {
    const pieces = Array.from({ length: 30 }, (_, index) => plannedPiece(`p-${index + 1}`, ['cut', 'edge']));
    const runtime = buildLotRuntimeSummary({
      id: 'lot-1',
      current_stage: 'edge',
      current_step: 'edge',
      status: 'in_progress',
      progress_percent: 70,
    }, [], [], [], [], pieces);

    expect(runtime.routeProgress).toEqual(expect.arrayContaining([
      expect.objectContaining({ step_name: 'cut', total: 30, collected: 0, pending: 30 }),
      expect.objectContaining({ step_name: 'edge', total: 30, collected: 0, pending: 30 }),
    ]));
    expect(runtime.progress.percent).toBe(0);
    expect(runtime.currentStage).toBe('cut');
  });

  it('mantém a coleta especial de Marcenaria sem adiantar as demais etapas do lote', () => {
    const regularPieces = Array.from({ length: 30 }, (_, index) => plannedPiece(`regular-${index + 1}`, ['cut', 'edge']));
    const specialPiece = {
      ...plannedPiece('special-1', ['joinery']),
      status: 'in_progress',
      current_stage: 'separation',
      completed_steps: ['joinery'],
    };
    const readings = [{
      id: 'reading-1',
      piece_id: specialPiece.id,
      step_name: 'joinery',
      status: 'approved',
      created_at: '2026-07-18T12:00:00.000Z',
    }];

    const runtime = buildLotRuntimeSummary({
      id: 'lot-2',
      current_stage: 'joinery',
      current_step: 'joinery',
      status: 'in_progress',
      progress_percent: 90,
    }, [], readings, [], [], [...regularPieces, specialPiece]);

    expect(runtime.routeProgress).toEqual(expect.arrayContaining([
      expect.objectContaining({ step_name: 'cut', total: 30, collected: 0 }),
      expect.objectContaining({ step_name: 'edge', total: 30, collected: 0 }),
      expect.objectContaining({ step_name: 'joinery', total: 1, collected: 1 }),
    ]));
    expect(runtime.progress.percent).toBe(0);
    expect(runtime.currentStage).toBe('cut');
  });
});

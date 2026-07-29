import { describe, expect, it } from 'vitest';
import { buildEffectiveLotIntegrity, toggleExpandedLotIds } from './LotIntegrity';

describe('buildEffectiveLotIntegrity', () => {
  it('não libera o lote enquanto a Furação obrigatória estiver pendente', () => {
    const result = buildEffectiveLotIntegrity({
      clientLot: {
        lot_id: 'lot-1',
        total_pieces: 10,
        stages: [
          {
            stage_code: 'cut',
            stage_label: 'Corte',
            stage_order: 1,
            required_pieces: 10,
            completed_pieces: 10,
            remaining_pieces: 0,
            traceable_collection_required: true,
          },
          {
            stage_code: 'edge',
            stage_label: 'Borda',
            stage_order: 2,
            required_pieces: 10,
            completed_pieces: 10,
            remaining_pieces: 0,
            traceable_collection_required: true,
          },
          {
            stage_code: 'drill',
            stage_label: 'Furação',
            stage_order: 3,
            required_pieces: 10,
            completed_pieces: 4,
            remaining_pieces: 6,
            traceable_collection_required: true,
          },
        ],
      },
    });

    expect(result.approved_pieces).toBe(4);
    expect(result.pending_pieces).toBe(6);
    expect(result.integrity_percent).toBe(80);
    expect(result.bottleneck).toBe('Furação (6 peças pendentes)');
    expect(result.can_close).toBe(false);
  });

  it('mantém dois detalhes de lotes abertos de forma independente', () => {
    const firstOpen = toggleExpandedLotIds([], 'lot-1');
    const secondOpen = toggleExpandedLotIds(firstOpen, 'lot-2');

    expect(secondOpen).toEqual(['lot-1', 'lot-2']);
    expect(toggleExpandedLotIds(secondOpen, 'lot-1')).toEqual(['lot-2']);
    expect(toggleExpandedLotIds(secondOpen, 'lot-2')).toEqual(['lot-1']);
  });

  it('calcula a integridade com toda a rota rastreável e preserva etapas opcionais', () => {
    const result = buildEffectiveLotIntegrity({
      clientLot: {
        lot_id: 'lot-route',
        total_pieces: 10,
        stages: [
          {
            stage_code: 'cut',
            stage_label: 'Corte',
            stage_order: 1,
            required_pieces: 10,
            completed_pieces: 10,
            traceable_collection_required: true,
          },
          {
            stage_code: 'edge',
            stage_label: 'Borda',
            stage_order: 2,
            required_pieces: 10,
            completed_pieces: 10,
            traceable_collection_required: true,
          },
          {
            stage_code: 'drill',
            stage_label: 'Furação',
            stage_order: 3,
            required_pieces: 10,
            completed_pieces: 10,
            traceable_collection_required: true,
          },
          {
            stage_code: 'cnc',
            stage_label: 'Usinagem CNC',
            stage_order: 4,
            required_pieces: 10,
            completed_pieces: 0,
            traceable_collection_required: true,
          },
          {
            stage_code: 'separation',
            stage_label: 'Separação',
            stage_order: 6,
            required_pieces: 10,
            completed_pieces: 0,
            traceable_collection_required: false,
            manual_quantity_allowed: true,
          },
          {
            stage_code: 'packaging',
            stage_label: 'Embalagem',
            stage_order: 7,
            required_pieces: 10,
            completed_pieces: 4,
            manual_quantity: 4,
            traceable_collection_required: false,
            manual_quantity_allowed: true,
          },
        ],
      },
    });

    expect(result.integrity_percent).toBe(75);
    expect(result.approved_pieces).toBe(0);
    expect(result.bottleneck).toBe('Usinagem CNC (10 peças pendentes)');
    expect(result.can_close).toBe(false);
    expect(result.stages.map((stage) => stage.stage_code)).toEqual([
      'cut',
      'edge',
      'drill',
      'cnc',
      'separation',
      'packaging',
    ]);
  });
});

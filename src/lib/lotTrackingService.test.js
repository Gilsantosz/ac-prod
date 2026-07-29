import { describe, expect, it } from 'vitest';
import {
  ensureTraceableForecastModels,
  formatDuration,
  getConfidenceMeta,
  groupClientLotsByCustomer,
  mergeRouteStageProgress,
  normalizeTrackingPayload,
} from './lotTrackingService';

describe('lotTrackingService', () => {
  it('normaliza respostas vazias do RPC', () => {
    expect(normalizeTrackingPayload(null)).toMatchObject({
      prediction_target: 'ready_for_separation',
      stage_models: [],
      general_lots: [],
    });
  });

  it('preserva lote geral, lotes de clientes e etapas', () => {
    const result = normalizeTrackingPayload({
      general_lots: [{
        general_lot_code: '15587',
        stages: [{ stage_code: 'cut' }],
        client_lots: [{ lot_code: '143332', stages: [{ stage_code: 'edge' }] }],
      }],
    });

    expect(result.general_lots[0].general_lot_code).toBe('15587');
    expect(result.general_lots[0].client_lots[0].lot_code).toBe('143332');
    expect(result.general_lots[0].client_lots[0].stages[0].stage_code).toBe('edge');
  });

  it('agrupa visualmente lotes diferentes do mesmo cliente', () => {
    const groups = groupClientLotsByCustomer([
      { lot_code: '143334', customer_name: 'Ana Paula' },
      { lot_code: '143335', customer_name: 'Ana Paula' },
      { lot_code: '143344', customer_name: 'Ana Paula 1' },
    ]);

    expect(groups['Ana Paula']).toHaveLength(2);
    expect(groups['Ana Paula 1']).toHaveLength(1);
  });

  it('formata duração de previsão sem expor casas decimais', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(135)).toBe('2h 15min');
    expect(formatDuration(1500)).toBe('1d 1h');
  });

  it('explica baixa confiança enquanto o histórico ainda é inicial', () => {
    expect(getConfidenceMeta('low').label).toBe('Confiança inicial');
  });

  it('substitui o resumo legado pela rota produtiva completa do lote selecionado', () => {
    const tracking = normalizeTrackingPayload({
      general_lots: [{
        batch_id: 'batch-1',
        stages: [{ stage_code: 'cut' }],
        client_lots: [{ lot_id: 'lot-1', stages: [{ stage_code: 'cut' }] }],
      }],
    });
    const result = mergeRouteStageProgress(
      tracking,
      {
        batch_id: 'batch-1',
        batch_stages: [
          { stage_code: 'cut' },
          { stage_code: 'drill' },
          { stage_code: 'separation', traceable_collection_required: false },
          { stage_code: 'packaging', traceable_collection_required: false },
        ],
        lot_stages: {
          'lot-1': [{
            stage_code: 'drill',
            stage_label: 'Furação',
            required_pieces: 10,
            completed_pieces: 4,
            remaining_pieces: 6,
          }],
        },
      },
      {
        batch_summary: {
          total_operations: 10,
          completed_operations: 4,
          progress_percent: 40,
          ready_for_separation_pieces: 4,
        },
        lot_summaries: {
          'lot-1': {
            total_operations: 10,
            completed_operations: 4,
            progress_percent: 40,
            ready_for_separation_pieces: 4,
          },
        },
      }
    );

    expect(result.general_lots[0].stages.map((stage) => stage.stage_code)).toEqual([
      'cut',
      'drill',
      'separation',
      'packaging',
    ]);
    expect(result.general_lots[0].client_lots[0].stages[0]).toMatchObject({
      stage_code: 'drill',
      required_pieces: 10,
    });
    expect(result.general_lots[0].client_lots[0]).toMatchObject({
      progress_percent: 40,
      completed_operations: 4,
      ready_for_separation_pieces: 4,
    });
  });

  it('inclui Furação no modelo de acompanhamento mesmo antes de haver amostra suficiente', () => {
    const models = ensureTraceableForecastModels([
      { stage_code: 'cut', sample_count: 40, minutes_per_piece: 1.5 },
      { stage_code: 'cnc', sample_count: 10, minutes_per_piece: 5 },
    ]);

    expect(models.map((model) => model.stage_code)).toEqual([
      'cut',
      'edge',
      'drill',
      'cnc',
      'joinery',
    ]);
    expect(models.find((model) => model.stage_code === 'drill')).toMatchObject({
      stage_label: 'Furação',
      model_source: 'baseline',
      confidence: 'low',
    });
  });
});

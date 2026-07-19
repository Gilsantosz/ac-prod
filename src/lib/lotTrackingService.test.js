import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  getConfidenceMeta,
  groupClientLotsByCustomer,
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
});

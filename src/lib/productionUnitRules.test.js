import { describe, expect, it } from 'vitest';
import {
  buildProductionMetric,
  calculateEdgeMeters,
  getProductionUnitForCell,
  normalizeProductionQuantity,
} from '@/lib/productionUnitRules';

describe('productionUnitRules', () => {
  it('mapeia células industriais para a unidade correta', () => {
    expect(getProductionUnitForCell('Seccionadoras')).toBe('sheets');
    expect(getProductionUnitForCell('Coladeiras')).toBe('meters');
    expect(getProductionUnitForCell('Furadeiras')).toBe('pieces');
    expect(getProductionUnitForCell('Marcenaria')).toBe('pieces');
    expect(getProductionUnitForCell('Embalagem')).toBe('pieces');
    expect(getProductionUnitForCell('Expedição')).toBe('pieces');
    expect(getProductionUnitForCell('Expedição', { expeditionUnit: 'covers' })).toBe('covers');
  });

  it('calcula bordo em metros e não em peça', () => {
    const metric = buildProductionMetric({
      cell: 'Coladeiras',
      edge_meters: 2.5,
      quantity: 1,
    });
    expect(metric.metric_unit).toBe('meters');
    expect(metric.realized_quantity).toBe(2.5);
  });

  it('calcula metragem de bordo pelas dimensões quando não há campo direto', () => {
    expect(calculateEdgeMeters({
      width: 1000,
      height: 500,
      quantity: 2,
      edgeFront: 'Sim',
      edgeLeft: 'Sim',
    })).toBe(3);
  });

  it('não transforma coleta rastreável de peça em chapa cortada sem vínculo de chapa', () => {
    expect(normalizeProductionQuantity({
      cell: 'Corte',
      client_event_id: 'evt-1',
      produced: 1,
      quantity: 1,
    })).toBe(0);
  });

  it('mantém apontamento manual de corte como chapas quando informado pelo operador', () => {
    expect(normalizeProductionQuantity({
      cell: 'Corte',
      produced: 12,
      entry_mode: 'manual',
    })).toBe(12);
  });
});

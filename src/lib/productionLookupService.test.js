import { describe, expect, it } from 'vitest';
import { productionContextToEntryFields, resolveProductionContext } from './productionLookupService';

describe('resolveProductionContext', () => {
  it('mantém um contrato único para pedido, lote, item e rota', async () => {
    const context = await resolveProductionContext({ value: '15479', type: 'load' }, {
      repository: {
        resolve: async (value, hint) => ({
          productionOrder: { id: 'order-1', order_number: '142355', load_number: value, customer_legal_name: '3CARRARIAS' },
          lot: { id: 'lot-1', lot_code: 'LOT-01', production_order_id: 'order-1', current_step: 'joinery' },
          item: { id: 'item-1', product_name: 'Painel MDF', pallet_number: '10802', route_name: 'Rota Especial' },
          route: { id: 'route-1', step_name: 'joinery', cell_name: 'Marcenaria' },
          contextFound: true,
          matchedBy: hint,
          warnings: [],
        }),
      },
    });
    const fields = productionContextToEntryFields(context);
    expect(context.contextFound).toBe(true);
    expect(context.matchedBy).toBe('load');
    expect(fields.order_number).toBe('142355');
    expect(fields.load_number).toBe('15479');
    expect(fields.lot_code).toBe('LOT-01');
    expect(fields.pallet_number).toBe('10802');
    expect(fields.process_step).toBe('joinery');
    expect(fields.traceability_status).toBe('resolved');
  });

  it('retorna rastreabilidade limitada sem fabricar contexto', async () => {
    const context = await resolveProductionContext('INEXISTENTE', {
      repository: { resolve: async () => ({ contextFound: false, warnings: ['Não localizado.'] }) },
    });
    expect(context.contextFound).toBe(false);
    expect(context.productionOrder).toBeNull();
    expect(context.warnings).toEqual(['Não localizado.']);
  });
});


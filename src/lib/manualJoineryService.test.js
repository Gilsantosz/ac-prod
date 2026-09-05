import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabaseClient';
import {
  completeReadyJoineryPiece,
  fetchReadyJoineryLots,
  groupReadyJoineryPieces,
} from './manualJoineryService';

describe('fila canônica da Marcenaria', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exibe peça cuja etapa atual é joinery mesmo com requires_joinery legado falso', () => {
    const lots = groupReadyJoineryPieces([{
      id: 'piece-1',
      lot_id: 'lot-1',
      piece_uid: '09950035',
      traceability_code: '09950035',
      piece_name: 'Porta Maranello',
      current_stage: 'joinery',
      status: 'in_progress',
      requires_joinery: false,
      route_steps: ['cut', 'edge', 'cnc', 'joinery', 'separation'],
      completed_steps: ['cut', 'edge', 'cnc'],
      updated_at: '2026-09-05T14:00:00Z',
    }], [{
      id: 'lot-1',
      lot_code: '940004',
      customer_name: 'Cliente Teste',
      order_number: '940004',
      status: 'in_progress',
      pcp_import_batch_id: 'batch-1',
    }], [{ id: 'batch-1', general_lot_code: '26072640' }]);

    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({
      id: 'lot-1',
      lot_code: '940004',
      general_lot_code: '26072640',
    });
    expect(lots[0].lot_items[0]).toMatchObject({
      id: 'piece-1',
      traceability_code: '09950035',
      requires_joinery: true,
    });
  });

  it('consulta production_pieces, sem depender de lot_items', async () => {
    const piece = {
      id: 'piece-1',
      lot_id: 'lot-1',
      piece_uid: '09950035',
      traceability_code: '09950035',
      current_stage: 'joinery',
      status: 'in_progress',
      completed_steps: ['cut', 'edge', 'cnc'],
      updated_at: '2026-09-05T14:00:00Z',
      pcp_import_batch_id: 'batch-1',
    };
    const from = vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'production_pieces') {
        const builder = {
          select: vi.fn(() => builder),
          in: vi.fn(() => builder),
          not: vi.fn(() => builder),
          order: vi.fn(() => builder),
          limit: vi.fn().mockResolvedValue({ data: [piece], error: null }),
        };
        return builder;
      }
      if (table === 'production_lots') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [{ id: 'lot-1', lot_code: '940004', pcp_import_batch_id: 'batch-1' }],
              error: null,
            }),
          })),
        };
      }
      if (table === 'promob_import_batches') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [{ id: 'batch-1', general_lot_code: '26072640' }],
              error: null,
            }),
          })),
        };
      }
      throw new Error(`Tabela inesperada no teste: ${table}`);
    });

    const lots = await fetchReadyJoineryLots();

    expect(from).toHaveBeenCalledWith('production_pieces');
    expect(from).not.toHaveBeenCalledWith('lot_items');
    expect(lots[0].lot_items[0].id).toBe('piece-1');
  });

  it('envia a baixa pelo processador canônico com o token da sessão', async () => {
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: { success: true, status: 'approved' },
      error: null,
    });

    await completeReadyJoineryPiece({
      id: 'piece-1',
      traceability_code: '09950035',
      piece_name: 'Porta Maranello',
    }, {
      id: 'operator-1',
      token: 'session-token',
      name: 'Operador Marcenaria',
      shift: '1º Turno',
      selected_cell_id: 'cell-joinery',
    });

    expect(rpc).toHaveBeenCalledWith('process_production_reading', {
      p_payload: expect.objectContaining({
        rawValue: '09950035',
        operatorSessionToken: 'session-token',
        operator_session_token: 'session-token',
        cellName: 'Marcenaria',
        cellId: 'cell-joinery',
        stepName: 'joinery',
      }),
    });
  });
});

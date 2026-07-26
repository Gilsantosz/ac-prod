import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabaseClient';
import { auditLog } from '@/lib/auditLog';
import {
  approveReplacementWithCells,
  getReplacementApprovalContext,
} from '../replacementApprovalService';

vi.mock('@/lib/auditLog', () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

describe('replacementApprovalService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(auditLog).mockClear();
  });

  it('deve carregar ordem, peça e lote exatos para o modal', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        order: { id: 'order-1', original_piece_id: 'piece-1', replacement_code: 'REP-1' },
        original_piece: { id: 'piece-1', traceability_code: '09907891' },
        replacement_piece: null,
        barcode: '09907891',
        route_steps: ['cut'],
        cells: [{ selection_key: 'cell-1:cut', cell_id: 'cell-1', cell_name: 'Corte', step_code: 'cut' }],
      },
      error: null,
    });

    const result = await getReplacementApprovalContext('order-1');

    expect(result.barcode).toBe('09907891');
    expect(result.order.original_piece_id).toBe(result.originalPiece.id);
  });

  it('deve impedir aprovação quando o banco retorna peça de outra ordem', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        order: { id: 'order-1', original_piece_id: 'piece-1' },
        original_piece: { id: 'piece-2', traceability_code: '09907352' },
      },
      error: null,
    });

    await expect(getReplacementApprovalContext('order-1')).rejects.toThrow(/não corresponde/);
  });

  it('deve enviar as células selecionadas com a ordem confirmada', async () => {
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: { success: true, automatic_entries: 1, replacement_barcode: '09907891' },
      error: null,
    });

    await approveReplacementWithCells('order-1', {
      priority: 'high',
      notes: 'Confirmado',
      selectedCells: [{
        cell_id: 'cell-1',
        cell_name: 'Corte',
        step_code: 'cut',
        step_name: 'Corte',
      }],
    });

    expect(rpc).toHaveBeenCalledWith('approve_piece_replacement', {
      p_order_id: 'order-1',
      p_payload: {
        priority: 'high',
        notes: 'Confirmado',
        selected_cells: [{
          cell_id: 'cell-1',
          cell_name: 'Corte',
          step_code: 'cut',
          step_name: 'Corte',
        }],
      },
    });
  });
});

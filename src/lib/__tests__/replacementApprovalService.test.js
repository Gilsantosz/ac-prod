import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabaseClient';
import { auditLog } from '@/lib/auditLog';
import {
  approveReplacementWithCells,
  getReplacementApprovalCells,
} from '../replacementApprovalService';

vi.mock('@/lib/auditLog', () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

describe('replacementApprovalService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(auditLog).mockClear();
  });

  it('deve carregar as células elegíveis mantendo etapa e chave de seleção', async () => {
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        barcode: '09907352',
        route_steps: ['cut', 'edge', 'packaging'],
        cells: [
          {
            selection_key: 'cell-cut:cut',
            cell_id: 'cell-cut',
            cell_name: 'Corte',
            step_code: 'cut',
            step_name: 'Corte',
          },
        ],
      },
      error: null,
    });

    const result = await getReplacementApprovalCells('order-123');

    expect(rpc).toHaveBeenCalledWith('get_replacement_approval_cells', {
      p_order_id: 'order-123',
    });
    expect(result.barcode).toBe('09907352');
    expect(result.routeSteps).toEqual(['cut', 'edge', 'packaging']);
    expect(result.cells[0]).toEqual(expect.objectContaining({
      cell_name: 'Corte',
      step_code: 'cut',
    }));
  });

  it('deve aprovar e enviar todas as células selecionadas para baixas automáticas', async () => {
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        success: true,
        status: 'in_production',
        replacement_barcode: '09907352',
        automatic_entries: 2,
      },
      error: null,
    });

    const selectedCells = [
      { cell_id: 'cut-id', cell_name: 'Corte', step_code: 'cut', step_name: 'Corte' },
      { cell_id: 'edge-id', cell_name: 'Bordo', step_code: 'edge', step_name: 'Bordo' },
    ];

    const result = await approveReplacementWithCells('order-123', {
      priority: 'critical',
      notes: 'Liberar imediatamente',
      selectedCells,
    });

    expect(rpc).toHaveBeenCalledWith('approve_piece_replacement', {
      p_order_id: 'order-123',
      p_payload: {
        priority: 'critical',
        notes: 'Liberar imediatamente',
        selected_cells: selectedCells,
      },
    });
    expect(result.automatic_entries).toBe(2);
    expect(auditLog).toHaveBeenCalledWith(
      'replacement_approved',
      'replacement_orders',
      'order-123',
      expect.objectContaining({
        automatic_entries: 2,
        replacement_barcode: '09907352',
      }),
    );
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabaseClient';
import { auditLog } from '@/lib/auditLog';
import {
  approveReplacement,
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

  it('carrega a ordem e a peça exatas sem oferecer células automáticas', async () => {
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        order: { id: 'order-1', original_piece_id: 'piece-1', replacement_code: 'REP-1' },
        original_piece: { id: 'piece-1', traceability_code: '09907891' },
        replacement_piece: null,
        barcode: '09907891',
        route_steps: ['cut'],
      },
      error: null,
    });

    const result = await getReplacementApprovalContext('order-1');

    expect(rpc).toHaveBeenCalledWith('get_replacement_order_context', { p_order_id: 'order-1' });
    expect(result.barcode).toBe('09907891');
    expect(result.order.original_piece_id).toBe(result.originalPiece.id);
    expect(result.cells).toEqual([]);
    expect(result.automaticEntriesSupported).toBe(false);
  });

  it('impede aprovação quando o banco retorna peça de outra ordem', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        order: { id: 'order-1', original_piece_id: 'piece-1' },
        original_piece: { id: 'piece-2', traceability_code: '09907352' },
      },
      error: null,
    });

    await expect(getReplacementApprovalContext('order-1')).rejects.toThrow(/não corresponde/);
  });

  it('aprova diretamente sem senha, justificativa ou células', async () => {
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        success: true,
        status: 'released',
        automatic_entries: 0,
        approved_cells: [],
        approval_mode: 'station_queue',
        replacement_piece_id: 'replacement-piece-1',
        replacement_barcode: '09907891',
        next_step: 'cut',
      },
      error: null,
    });

    await approveReplacement('order-1');

    expect(rpc).toHaveBeenCalledWith('approve_piece_replacement', {
      p_order_id: 'order-1',
      p_payload: {},
    });
    expect(auditLog).toHaveBeenCalledWith(
      'replacement_approved_for_station',
      'replacement_orders',
      'order-1',
      expect.objectContaining({
        automatic_entries: 0,
        approved_cells: [],
        approval_mode: 'station_queue',
      }),
    );
  });

  it('ignora células e observações recebidas de chamadas legadas', async () => {
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: { success: true, automatic_entries: 0, approved_cells: [] },
      error: null,
    });

    await approveReplacementWithCells('order-1', {
      notes: 'Não deve ser enviada',
      selectedCells: [{ cell_id: 'cell-1', step_code: 'cut' }],
    });

    expect(rpc).toHaveBeenCalledWith('approve_piece_replacement', {
      p_order_id: 'order-1',
      p_payload: {},
    });
  });

  it('falha de forma segura se o servidor tentar gerar baixa automática', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: { success: true, automatic_entries: 1, approved_cells: [{ cell_id: 'cell-1' }] },
      error: null,
    });

    await expect(approveReplacement('order-1')).rejects.toThrow(/baixa automática indevida/);
  });
});

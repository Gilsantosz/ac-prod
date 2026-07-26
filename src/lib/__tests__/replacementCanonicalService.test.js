import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabaseClient';
import {
  getCanonicalReplacementOrder,
  getCanonicalReplacementOrders,
} from '../replacementCanonicalService';

describe('replacementCanonicalService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const context = {
    order: {
      id: 'order-1',
      replacement_code: 'REP-1',
      original_piece_id: 'piece-1',
      lot_code: '143348',
      general_lot_code: '15587',
    },
    original_piece: {
      id: 'piece-1',
      piece_uid: '09907891',
      traceability_code: '09907891',
      route_steps: ['cut', 'edge'],
    },
    replacement_piece: null,
    route_steps: ['cut', 'edge'],
    barcode: '09907891',
    integrity: { piece_link_valid: true },
  };

  it('deve buscar a ordem pelo ID e usar somente a peça vinculada por original_piece_id', async () => {
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: context, error: null });

    const result = await getCanonicalReplacementOrder('order-1');

    expect(rpc).toHaveBeenCalledWith('get_replacement_order_context', { p_order_id: 'order-1' });
    expect(result.original_piece.id).toBe('piece-1');
    expect(result.original_piece.traceability_code).toBe('09907891');
    expect(result.resolved_client_lot).toBe('143348');
    expect(result.resolved_general_lot).toBe('15587');
  });

  it('deve bloquear uma resposta cujo original_piece_id não corresponde à peça retornada', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        ...context,
        original_piece: { ...context.original_piece, id: 'piece-wrong' },
      },
      error: null,
    });

    await expect(getCanonicalReplacementOrder('order-1')).rejects.toThrow(/Vínculo inconsistente/);
  });

  it('deve carregar a lista básica sem joins frágeis e hidratar cada card pelo RPC canônico', async () => {
    const range = vi.fn().mockResolvedValue({
      data: [{ id: 'order-1', replacement_code: 'REP-1', original_piece_id: 'piece-1' }],
      error: null,
      count: 1,
    });
    const order = vi.fn(() => ({ range }));
    const select = vi.fn(() => ({ order }));
    const from = vi.spyOn(supabase, 'from').mockReturnValue({ select });
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: context, error: null });

    const result = await getCanonicalReplacementOrders({ limit: 50 });

    expect(from).toHaveBeenCalledWith('replacement_orders');
    expect(result.orders[0].original_piece.piece_uid).toBe('09907891');
    expect(result.orders[0].canonical_barcode).toBe('09907891');
    expect(result.count).toBe(1);
  });
});

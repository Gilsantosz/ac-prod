import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerManualQuantitativeEntry } from './manualProductionService';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    rpc: mocks.rpc,
    from: mocks.from,
    auth: { getUser: mocks.getUser },
  },
}));

describe('manualProductionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('considera a RPC atômica como fonte autoritativa e não duplica inserts', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        success: true,
        general_lot_code: '15587',
        target_cells: ['Corte'],
      },
      error: null,
    });

    const result = await registerManualQuantitativeEntry({
      general_lot_code: '15587',
      cell_name: 'Corte',
      quantity: 12,
    });

    expect(result).toMatchObject({
      success: true,
      general_lot_code: '15587',
      quantity: 12,
      target_cells: ['Corte'],
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('não recorre ao CRUD legado quando a RPC rejeita a operação', async () => {
    mocks.rpc.mockResolvedValue({
      data: { success: false, error: 'Lote Geral não encontrado.' },
      error: null,
    });

    await expect(registerManualQuantitativeEntry({
      general_lot_code: '14999',
      quantity: 1,
    })).rejects.toThrow('Lote Geral não encontrado.');

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
});

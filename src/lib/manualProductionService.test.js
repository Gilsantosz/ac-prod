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
        batch_id: 'batch-15587',
        stage_code: 'packaging',
        remaining_after: 28,
      },
      error: null,
    });

    const result = await registerManualQuantitativeEntry({
      pcp_import_batch_id: 'batch-15587',
      general_lot_code: '15587',
      cell_name: 'Embalagem',
      quantity: 12,
    });

    expect(result).toMatchObject({
      success: true,
      general_lot_code: '15587',
      pcp_import_batch_id: 'batch-15587',
      quantity: 12,
      cascade: false,
      is_untraceable: true,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'register_untraceable_stage_quantity',
      expect.objectContaining({
        p_payload: expect.objectContaining({
          pcp_import_batch_id: 'batch-15587',
          general_lot_code: '15587',
          cell_name: 'Embalagem',
          quantity: 12,
        }),
      }),
    );
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('exige o lote geral ativo com identificador do lote importado', async () => {
    await expect(registerManualQuantitativeEntry({
      general_lot_code: '14999',
      cell_name: 'Embalagem',
      quantity: 1,
    })).rejects.toThrow('Selecione um Lote Geral ativo');

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('não recorre ao CRUD legado quando a RPC rejeita a operação', async () => {
    mocks.rpc.mockResolvedValue({
      data: { success: false, error: 'Lote Geral não encontrado.' },
      error: null,
    });

    await expect(registerManualQuantitativeEntry({
      pcp_import_batch_id: 'batch-14999',
      general_lot_code: '14999',
      cell_name: 'Separação',
      quantity: 1,
    })).rejects.toThrow('Lote Geral não encontrado.');

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
});

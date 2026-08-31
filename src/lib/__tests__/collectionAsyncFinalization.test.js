import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { from, getOperatorSession } = vi.hoisted(() => ({
  from: vi.fn(),
  getOperatorSession: vi.fn(),
}));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from },
}));
vi.mock('@/lib/operatorSessionService', () => ({
  getOperatorSession,
}));

import { processProductionCollectionBatch } from '@/lib/collectionBatchService';

function insertResponse(rows) {
  const select = vi.fn().mockResolvedValue({ data: rows, error: null });
  const insert = vi.fn(() => ({ select }));
  return { insert, select };
}

describe('collectionBatchService asynchronous finalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOperatorSession.mockReturnValue({ token: 'operator-session-token' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('confirma o INSERT leve e só entrega a decisão depois do worker finalizar', async () => {
    vi.useFakeTimers();

    const acceptedRow = {
      id: 'inbox-a',
      client_event_id: 'event-a',
      tag_lida: '09950001',
      status_sincronizacao: 'recebida',
      retryable: false,
      resultado: null,
    };
    const finalRow = {
      ...acceptedRow,
      status_sincronizacao: 'sincronizada',
      processado_em: '2026-08-31T23:00:00.500Z',
      resultado: {
        success: true,
        status: 'approved',
        client_event_id: 'event-a',
      },
    };

    const insertQuery = insertResponse([acceptedRow]);
    const inFilter = vi.fn().mockResolvedValue({
      data: [finalRow],
      error: null,
    });
    const selectFinal = vi.fn(() => ({ in: inFilter }));

    from
      .mockReturnValueOnce({ insert: insertQuery.insert })
      .mockReturnValueOnce({ select: selectFinal });

    let settled = false;
    const promise = processProductionCollectionBatch([{
      client_event_id: 'event-a',
      raw_value: '09950001',
      event_kind: 'production_stage',
    }]).finally(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(insertQuery.insert).toHaveBeenCalledTimes(1);
    expect(inFilter).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);
    const result = await promise;

    expect(inFilter).toHaveBeenCalledWith('client_event_id', ['event-a']);
    expect(result).toEqual([
      expect.objectContaining({
        client_event_id: 'event-a',
        status_sincronizacao: 'sincronizada',
        accepted: false,
        result: expect.objectContaining({
          success: true,
          status: 'approved',
        }),
      }),
    ]);
  });

  it('não faz polling quando o registro já retorna final por idempotência', async () => {
    const finalRow = {
      id: 'inbox-a',
      client_event_id: 'event-a',
      tag_lida: '09950001',
      status_sincronizacao: 'sincronizada',
      retryable: false,
      resultado: { success: false, status: 'duplicated' },
    };
    const insertQuery = insertResponse([finalRow]);
    from.mockReturnValue({ insert: insertQuery.insert });

    const result = await processProductionCollectionBatch([{
      client_event_id: 'event-a',
      raw_value: '09950001',
      event_kind: 'production_stage',
    }]);

    expect(from).toHaveBeenCalledTimes(1);
    expect(result[0]).toMatchObject({
      status_sincronizacao: 'sincronizada',
      result: { status: 'duplicated' },
    });
  });
});

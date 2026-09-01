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

  it('reduz a frequência de polling durante uma finalização degradada', async () => {
    vi.useFakeTimers();

    const acceptedRow = {
      id: 'inbox-slow',
      client_event_id: 'event-slow',
      tag_lida: '09950002',
      status_sincronizacao: 'recebida',
      retryable: false,
      resultado: null,
    };
    const finalRow = {
      ...acceptedRow,
      status_sincronizacao: 'sincronizada',
      resultado: {
        success: true,
        status: 'approved',
        client_event_id: 'event-slow',
      },
    };
    const pollTimes = [];
    const insertQuery = insertResponse([acceptedRow]);
    const inFilter = vi.fn().mockImplementation(async () => {
      pollTimes.push(Date.now());
      return {
        data: [pollTimes.length >= 8 ? finalRow : acceptedRow],
        error: null,
      };
    });
    const selectFinal = vi.fn(() => ({ in: inFilter }));

    from
      .mockReturnValueOnce({ insert: insertQuery.insert })
      .mockReturnValue({ select: selectFinal });

    const promise = processProductionCollectionBatch([{
      client_event_id: 'event-slow',
      raw_value: '09950002',
      event_kind: 'production_stage',
    }]);

    await vi.runAllTimersAsync();
    const result = await promise;
    const gaps = pollTimes.map((time, index) => (
      index === 0 ? time - pollTimes[0] : time - pollTimes[index - 1]
    )).slice(1);

    expect(inFilter).toHaveBeenCalledTimes(8);
    expect(gaps.every((gap, index) => index === 0 || gap >= gaps[index - 1]))
      .toBe(true);
    expect(Math.max(...gaps)).toBeGreaterThan(1_000);
    expect(result[0]).toMatchObject({
      client_event_id: 'event-slow',
      status_sincronizacao: 'sincronizada',
    });
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

  it('publica cada item finalizado sem aguardar o mais lento do lote', async () => {
    vi.useFakeTimers();

    const acceptedA = {
      id: 'inbox-a',
      client_event_id: 'event-a',
      status_sincronizacao: 'recebida',
      retryable: false,
      resultado: null,
    };
    const acceptedB = {
      id: 'inbox-b',
      client_event_id: 'event-b',
      status_sincronizacao: 'recebida',
      retryable: false,
      resultado: null,
    };
    const finalA = {
      ...acceptedA,
      status_sincronizacao: 'sincronizada',
      resultado: { success: true, status: 'approved' },
    };
    const finalB = {
      ...acceptedB,
      status_sincronizacao: 'sincronizada',
      resultado: { success: true, status: 'approved' },
    };
    const insertQuery = insertResponse([acceptedA, acceptedB]);
    const inFilter = vi.fn()
      .mockResolvedValueOnce({ data: [finalA, acceptedB], error: null })
      .mockResolvedValueOnce({ data: [finalA, finalB], error: null });
    const selectFinal = vi.fn(() => ({ in: inFilter }));
    const onFinalized = vi.fn().mockResolvedValue(undefined);

    from
      .mockReturnValueOnce({ insert: insertQuery.insert })
      .mockReturnValue({ select: selectFinal });

    const promise = processProductionCollectionBatch([
      {
        client_event_id: 'event-a',
        raw_value: '09950001',
        event_kind: 'production_stage',
      },
      {
        client_event_id: 'event-b',
        raw_value: '09950002',
        event_kind: 'production_stage',
      },
    ], { onFinalized });

    await vi.advanceTimersByTimeAsync(150);
    expect(onFinalized).toHaveBeenCalledTimes(1);
    expect(onFinalized.mock.calls[0][0]).toEqual([
      expect.objectContaining({ client_event_id: 'event-a' }),
    ]);

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toHaveLength(2);
    expect(onFinalized).toHaveBeenCalledTimes(2);
    expect(onFinalized.mock.calls[1][0]).toEqual([
      expect.objectContaining({ client_event_id: 'event-b' }),
    ]);
    expect(inFilter).toHaveBeenNthCalledWith(
      1,
      'client_event_id',
      ['event-a', 'event-b'],
    );
    expect(inFilter).toHaveBeenNthCalledWith(
      2,
      'client_event_id',
      ['event-b'],
    );
  });

  it('anexa os itens já finalizados quando a fatia ativa expira', async () => {
    vi.useFakeTimers();

    const acceptedA = {
      id: 'inbox-a',
      client_event_id: 'event-a',
      status_sincronizacao: 'recebida',
      retryable: false,
      resultado: null,
    };
    const acceptedB = {
      id: 'inbox-b',
      client_event_id: 'event-b',
      status_sincronizacao: 'recebida',
      retryable: false,
      resultado: null,
    };
    const finalA = {
      ...acceptedA,
      status_sincronizacao: 'sincronizada',
      resultado: { success: true, status: 'approved' },
    };
    const insertQuery = insertResponse([acceptedA, acceptedB]);
    const inFilter = vi.fn().mockResolvedValue({
      data: [finalA, acceptedB],
      error: null,
    });
    const selectFinal = vi.fn(() => ({ in: inFilter }));

    from
      .mockReturnValueOnce({ insert: insertQuery.insert })
      .mockReturnValue({ select: selectFinal });

    const outcome = processProductionCollectionBatch([
      {
        client_event_id: 'event-a',
        raw_value: '09950001',
        event_kind: 'production_stage',
      },
      {
        client_event_id: 'event-b',
        raw_value: '09950002',
        event_kind: 'production_stage',
      },
    ]).catch((error) => error);

    await vi.runAllTimersAsync();
    const error = await outcome;

    expect(error).toMatchObject({
      code: 'COLLECTION_FINALIZATION_TIMEOUT',
      retryable: true,
      pendingClientEventIds: ['event-b'],
    });
    expect(error.finalizedEnvelopes).toEqual([
      expect.objectContaining({ client_event_id: 'event-a' }),
    ]);
    expect(inFilter.mock.calls.slice(1).every(([, ids]) => (
      ids.length === 1 && ids[0] === 'event-b'
    ))).toBe(true);
  });
});

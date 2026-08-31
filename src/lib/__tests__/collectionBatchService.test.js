import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  COLLECTION_BATCH_MAX_SIZE,
  processProductionCollectionBatch,
} from '@/lib/collectionBatchService';

function successfulInsert(rows) {
  const select = vi.fn().mockResolvedValue({ data: rows, error: null });
  const insert = vi.fn(() => ({ select }));
  return { query: { insert }, insert, select };
}

describe('processProductionCollectionBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOperatorSession.mockReturnValue({ token: 'operator-session-token' });
  });

  it('faz um único insert([]), preserva idempotência e propaga a sessão operacional', async () => {
    const insertedRows = [
      {
        client_event_id: 'event-a',
        tag_lida: '09950001',
        status_sincronizacao: 'sincronizada',
        retryable: false,
        resultado: { success: true, status: 'approved' },
      },
      {
        client_event_id: 'event-b',
        tag_lida: '09950002',
        status_sincronizacao: 'sincronizada',
        retryable: false,
        resultado: { success: false, status: 'duplicated' },
      },
    ];
    const { query, insert } = successfulInsert(insertedRows);
    from.mockReturnValue(query);

    const result = await processProductionCollectionBatch([
      {
        client_event_id: 'event-a',
        raw_value: '09950001',
        created_at_client: '2026-08-31T16:00:00.000Z',
        event_kind: 'production_stage',
      },
      {
        client_event_id: 'event-b',
        raw_value: '09950002',
        created_at_client: '2026-08-31T16:00:01.000Z',
        event_kind: 'production_stage',
      },
    ]);

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('coletas_producao');
    expect(insert).toHaveBeenCalledTimes(1);

    const rows = insert.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      client_event_id: 'event-a',
      tag_lida: '09950001',
      batch_sequence: 0,
      status_sincronizacao: 'recebida',
    });
    expect(rows[1]).toMatchObject({
      client_event_id: 'event-b',
      tag_lida: '09950002',
      batch_sequence: 1,
    });
    expect(rows[0].batch_id).toBe(rows[1].batch_id);
    expect(rows[0].payload).toMatchObject({
      client_event_id: 'event-a',
      rawValue: '09950001',
      operatorSessionToken: 'operator-session-token',
      operator_session_token: 'operator-session-token',
      microBatch: true,
    });
    expect(result.map((item) => item.client_event_id)).toEqual([
      'event-a',
      'event-b',
    ]);
  });

  it('prioriza o token congelado no próprio evento', async () => {
    const insertedRows = [{
      client_event_id: 'event-a',
      tag_lida: '09950001',
      status_sincronizacao: 'sincronizada',
      retryable: false,
      resultado: { success: true, status: 'approved' },
    }];
    const { query, insert } = successfulInsert(insertedRows);
    from.mockReturnValue(query);

    await processProductionCollectionBatch([{
      client_event_id: 'event-a',
      raw_value: '09950001',
      event_kind: 'production_stage',
      operator_session_token: 'event-session-token',
    }]);

    expect(insert.mock.calls[0][0][0].payload).toMatchObject({
      operatorSessionToken: 'event-session-token',
      operator_session_token: 'event-session-token',
    });
  });

  it('trata resposta perdida após commit recuperando client_event_id existente', async () => {
    const duplicateInsert = vi.fn(() => ({
      select: vi.fn().mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'duplicate key' },
      }),
    }));
    const selectExisting = vi.fn(() => ({
      in: vi.fn().mockResolvedValue({
        data: [{
          client_event_id: 'event-a',
          tag_lida: '09950001',
          status_sincronizacao: 'sincronizada',
          retryable: false,
          resultado: { success: true, status: 'approved' },
        }],
        error: null,
      }),
    }));
    const missingInsertRows = [{
      client_event_id: 'event-b',
      tag_lida: '09950002',
      status_sincronizacao: 'sincronizada',
      retryable: false,
      resultado: { success: true, status: 'approved' },
    }];
    const missingInsert = successfulInsert(missingInsertRows);

    from
      .mockReturnValueOnce({ insert: duplicateInsert })
      .mockReturnValueOnce({ select: selectExisting })
      .mockReturnValueOnce(missingInsert.query);

    const result = await processProductionCollectionBatch([
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
    ]);

    expect(from).toHaveBeenCalledTimes(3);
    expect(missingInsert.insert).toHaveBeenCalledTimes(1);
    expect(missingInsert.insert.mock.calls[0][0]).toHaveLength(1);
    expect(missingInsert.insert.mock.calls[0][0][0].client_event_id)
      .toBe('event-b');
    expect(result.map((item) => item.client_event_id)).toEqual([
      'event-a',
      'event-b',
    ]);
  });

  it('propaga falha de rede como retentável para recolocar o lote na fila', async () => {
    const insert = vi.fn(() => ({
      select: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST000', message: 'network unavailable' },
      }),
    }));
    from.mockReturnValue({ insert });

    await expect(processProductionCollectionBatch([{
      client_event_id: 'event-a',
      raw_value: '09950001',
      event_kind: 'production_stage',
    }])).rejects.toMatchObject({
      message: 'network unavailable',
      retryable: true,
    });
  });

  it('bloqueia lote acima do limite industrial', async () => {
    const events = Array.from(
      { length: COLLECTION_BATCH_MAX_SIZE + 1 },
      (_, index) => ({
        client_event_id: `event-${index}`,
        raw_value: String(index).padStart(8, '0'),
        event_kind: 'production_stage',
      }),
    );

    await expect(processProductionCollectionBatch(events))
      .rejects.toMatchObject({ retryable: false });
    expect(from).not.toHaveBeenCalled();
  });
});

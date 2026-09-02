import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map();

const mockDb = {
  transaction: () => {
    const tx = {
      objectStore: () => ({
        put: (item) => {
          store.set(item.client_event_id, item);
          setTimeout(() => tx.oncomplete?.(), 1);
        },
        get: (key) => {
          const request = { onsuccess: null };
          setTimeout(() => {
            request.onsuccess?.({
              target: { result: store.get(key) },
            });
          }, 1);
          return request;
        },
        getAll: () => {
          const request = { onsuccess: null };
          setTimeout(() => {
            request.onsuccess?.({
              target: { result: Array.from(store.values()) },
            });
          }, 1);
          return request;
        },
        index: (indexName) => ({
          getAll: (value) => {
            const request = { onsuccess: null };
            setTimeout(() => {
              const result = Array.from(store.values()).filter((item) => (
                indexName === 'by_status' && item.status === value
              ));
              request.onsuccess?.({ target: { result } });
            }, 1);
            return request;
          },
        }),
        delete: (key) => {
          store.delete(key);
          setTimeout(() => tx.oncomplete?.(), 1);
        },
      }),
      oncomplete: null,
      onerror: null,
    };
    return tx;
  },
};

globalThis.indexedDB = {
  open: () => {
    const request = {
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    setTimeout(() => {
      request.onsuccess?.({ target: { result: mockDb } });
    }, 1);
    return request;
  },
};

import {
  enqueueCollectionEvent,
  markEventDatabaseAcknowledged,
} from '@/lib/collectionEventQueue';
import {
  flushCollectionMicroBatchQueue,
  planCollectionMicroBatches,
} from '@/lib/collectionMicroBatchQueue';
import { COLLECTION_STATES } from '@/lib/collectionStateMachine';

describe('flushCollectionMicroBatchQueue', () => {
  beforeEach(() => {
    store.clear();
  });

  it('limita o tick e reserva um de cinco lotes para replay offline', () => {
    const live = Array.from({ length: 125 }, (_, index) => ({
      client_event_id: `live-${index}`,
      source_mode: 'live',
    }));
    const replay = Array.from({ length: 50 }, (_, index) => ({
      client_event_id: `replay-${index}`,
      source_mode: 'offline_replay',
    }));

    const batches = planCollectionMicroBatches([...replay, ...live], 25);

    expect(batches).toHaveLength(5);
    expect(batches.map((batch) => batch[0].source_mode)).toEqual([
      'live',
      'live',
      'live',
      'live',
      'offline_replay',
    ]);
    expect(batches.every((batch) => batch.length <= 25)).toBe(true);
  });

  it('salva ACK do banco sem marcar a leitura como aprovada/synced', async () => {
    await enqueueCollectionEvent({
      client_event_id: 'event-ack',
      rawValue: '09950001',
      event_kind: 'production_stage',
    });
    const processBatchFn = vi.fn().mockResolvedValue([{
      client_event_id: 'event-ack',
      batch_id: 'batch-1',
      received_at_db: '2026-09-01T12:00:00.000Z',
      status_sincronizacao: 'recebida',
      collection_state: COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
    }]);

    const summary = await flushCollectionMicroBatchQueue(processBatchFn);

    expect(summary).toMatchObject({
      processed: 1,
      acknowledged: 1,
      synced: 0,
      errors: 0,
    });
    expect(store.get('event-ack')).toMatchObject({
      status: 'processing',
      collection_state: COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
      batch_id: 'batch-1',
    });
  });

  it('não regride ACK recebido por Broadcast quando a resposta HTTP se perde', async () => {
    await enqueueCollectionEvent({
      client_event_id: 'event-lost-response',
      rawValue: '09950001',
      event_kind: 'production_stage',
    });
    const processBatchFn = vi.fn(async () => {
      await markEventDatabaseAcknowledged('event-lost-response', {
        batch_id: 'batch-committed',
        received_at_db: '2026-09-01T12:00:01.000Z',
      });
      throw Object.assign(new Error('resposta HTTP perdida'), { retryable: true });
    });

    const summary = await flushCollectionMicroBatchQueue(processBatchFn);

    expect(summary).toMatchObject({
      processed: 1,
      acknowledged: 1,
      synced: 0,
      errors: 0,
    });
    expect(store.get('event-lost-response')).toMatchObject({
      status: 'processing',
      collection_state: COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
      retries: 0,
    });
  });

  it('processa várias leituras em uma única chamada e marca todas como synced', async () => {
    for (let index = 1; index <= 3; index += 1) {
      await enqueueCollectionEvent({
        client_event_id: `event-${index}`,
        rawValue: `0995000${index}`,
        event_kind: 'production_stage',
      });
    }

    const processBatchFn = vi.fn(async (events) => (
      events.map((event) => ({
        client_event_id: event.client_event_id,
        status_sincronizacao: 'sincronizada',
        retryable: false,
        result: { success: true, status: 'approved' },
      }))
    ));

    const summary = await flushCollectionMicroBatchQueue(processBatchFn, {
      batchSize: 50,
    });

    expect(processBatchFn).toHaveBeenCalledTimes(1);
    expect(processBatchFn.mock.calls[0][0]).toHaveLength(3);
    expect(summary).toMatchObject({
      processed: 3,
      synced: 3,
      errors: 0,
      batches: 1,
    });
    expect(Array.from(store.values()).every((event) => (
      event.status === 'synced'
    ))).toBe(true);
  });

  it('recoloca o lote inteiro em pending quando a rede falha', async () => {
    for (let index = 1; index <= 2; index += 1) {
      await enqueueCollectionEvent({
        client_event_id: `event-${index}`,
        rawValue: `0995000${index}`,
        event_kind: 'production_stage',
      });
    }

    const networkError = Object.assign(
      new Error('internet indisponível'),
      { retryable: true },
    );
    const processBatchFn = vi.fn().mockRejectedValue(networkError);

    const summary = await flushCollectionMicroBatchQueue(processBatchFn);

    expect(summary).toMatchObject({
      processed: 2,
      synced: 0,
      errors: 2,
    });
    for (const event of store.values()) {
      expect(event).toMatchObject({
        status: 'pending',
        retries: 1,
      });
      expect(event.next_attempt_at).toBeTruthy();
    }
  });

  it('isola falha funcional sem reenviar eventos já sincronizados', async () => {
    await enqueueCollectionEvent({
      client_event_id: 'event-ok',
      rawValue: '09950001',
      event_kind: 'production_stage',
    });
    await enqueueCollectionEvent({
      client_event_id: 'event-error',
      rawValue: '09950002',
      event_kind: 'production_stage',
    });

    const processBatchFn = vi.fn().mockResolvedValue([
      {
        client_event_id: 'event-ok',
        status_sincronizacao: 'sincronizada',
        retryable: false,
        result: { success: true, status: 'approved' },
      },
      {
        client_event_id: 'event-error',
        status_sincronizacao: 'erro',
        retryable: false,
        error: 'sessão operacional inválida',
        result: {
          success: false,
          status: 'error',
          reason_code: '42501',
          message: 'sessão operacional inválida',
        },
      },
    ]);

    const summary = await flushCollectionMicroBatchQueue(processBatchFn);

    expect(summary).toMatchObject({
      processed: 2,
      synced: 1,
      errors: 1,
    });
    expect(store.get('event-ok').status).toBe('synced');
    expect(store.get('event-error')).toMatchObject({
      status: 'error',
      last_result: {
        reason_code: '42501',
      },
    });
  });

  it('não devolve ao pending itens já finalizados quando só parte do lote expira', async () => {
    await enqueueCollectionEvent({
      client_event_id: 'event-finalized',
      rawValue: '09950001',
      event_kind: 'production_stage',
    });
    await enqueueCollectionEvent({
      client_event_id: 'event-slow',
      rawValue: '09950002',
      event_kind: 'production_stage',
    });

    const finalizedEnvelope = {
      client_event_id: 'event-finalized',
      status_sincronizacao: 'sincronizada',
      retryable: false,
      result: { success: true, status: 'approved' },
    };
    const processBatchFn = vi.fn(async (_events, { onFinalized }) => {
      await onFinalized([finalizedEnvelope]);
      const timeout = Object.assign(
        new Error('uma leitura ainda não terminou'),
        {
          code: 'COLLECTION_FINALIZATION_TIMEOUT',
          retryable: true,
          pendingClientEventIds: ['event-slow'],
          finalizedEnvelopes: [finalizedEnvelope],
        },
      );
      throw timeout;
    });

    const summary = await flushCollectionMicroBatchQueue(processBatchFn);

    expect(summary).toMatchObject({ processed: 2, synced: 1, errors: 1 });
    expect(store.get('event-finalized')).toMatchObject({
      status: 'synced',
      retries: 0,
    });
    expect(store.get('event-slow')).toMatchObject({
      status: 'pending',
      retries: 1,
    });
  });
});

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
            request.onsuccess?.({ target: { result: store.get(key) } });
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

import { enqueueCollectionEvent } from '@/lib/collectionEventQueue';
import { flushCollectionMicroBatchQueue } from '@/lib/collectionMicroBatchQueue';

describe('flushCollectionMicroBatchQueue — transporte para inbox', () => {
  beforeEach(() => {
    store.clear();
  });

  it('marca ACK do servidor como server_pending sem reenviar', async () => {
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
        status_sincronizacao: 'recebida',
        retryable: false,
        result: {
          success: true,
          accepted: true,
          pending: true,
          status: 'server_accepted',
        },
        ingress: {
          client_event_id: event.client_event_id,
          status_sincronizacao: 'recebida',
        },
      }))
    ));

    const summary = await flushCollectionMicroBatchQueue(processBatchFn, {
      batchSize: 50,
    });

    expect(processBatchFn).toHaveBeenCalledTimes(1);
    expect(processBatchFn.mock.calls[0][0]).toHaveLength(3);
    expect(summary).toMatchObject({
      processed: 3,
      accepted: 3,
      synced: 0,
      errors: 0,
      batches: 1,
    });
    expect(Array.from(store.values()).every((event) => (
      event.status === 'server_pending'
    ))).toBe(true);
  });

  it('aceita decisão já finalizada retornada na recuperação idempotente', async () => {
    await enqueueCollectionEvent({
      client_event_id: 'event-final',
      rawValue: '09950001',
      event_kind: 'production_stage',
    });

    const processBatchFn = vi.fn().mockResolvedValue([{
      client_event_id: 'event-final',
      status_sincronizacao: 'sincronizada',
      retryable: false,
      result: { success: true, status: 'approved' },
      ingress: { status_sincronizacao: 'sincronizada' },
    }]);

    const summary = await flushCollectionMicroBatchQueue(processBatchFn);

    expect(summary).toMatchObject({
      processed: 1,
      accepted: 0,
      synced: 1,
      errors: 0,
    });
    expect(store.get('event-final')).toMatchObject({
      status: 'synced',
      server_status: 'sincronizada',
      result: { status: 'approved' },
    });
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
      accepted: 0,
      synced: 0,
      errors: 2,
    });
    for (const event of store.values()) {
      expect(event).toMatchObject({
        status: 'pending',
        retries: 1,
        retryable: true,
      });
      expect(event.next_attempt_at).toBeTruthy();
    }
  });

  it('mantém erro terminal do worker fora do ciclo automático de retry', async () => {
    await enqueueCollectionEvent({
      client_event_id: 'event-error',
      rawValue: '09950002',
      event_kind: 'production_stage',
    });

    const processBatchFn = vi.fn().mockResolvedValue([{
      client_event_id: 'event-error',
      status_sincronizacao: 'erro',
      retryable: false,
      error: 'sessão operacional inválida',
      result: {
        success: false,
        status: 'error',
        reason_code: 'OPERATOR_SESSION_INVALID',
        message: 'sessão operacional inválida',
      },
      ingress: { status_sincronizacao: 'erro' },
    }]);

    const summary = await flushCollectionMicroBatchQueue(processBatchFn);

    expect(summary).toMatchObject({
      processed: 1,
      accepted: 0,
      synced: 0,
      errors: 1,
    });
    expect(store.get('event-error')).toMatchObject({
      status: 'error',
      retryable: false,
      last_result: {
        reason_code: 'OPERATOR_SESSION_INVALID',
      },
    });
  });
});

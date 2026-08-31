import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map();

const mockDb = {
  onversionchange: null,
  close: vi.fn(),
  transaction: () => {
    const tx = {
      objectStore: () => ({
        put: (item) => {
          store.set(item.client_event_id, { ...item });
        },
        get: (key) => {
          const request = { onsuccess: null, onerror: null, result: undefined };
          setTimeout(() => {
            request.result = store.get(key);
            request.onsuccess?.({ target: { result: request.result } });
          }, 1);
          return request;
        },
        getAll: () => {
          const request = { onsuccess: null };
          setTimeout(() => {
            request.onsuccess?.({ target: { result: Array.from(store.values()) } });
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
        delete: (key) => store.delete(key),
      }),
      oncomplete: null,
      onerror: null,
      onabort: null,
    };
    setTimeout(() => tx.oncomplete?.(), 10);
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
    setTimeout(() => request.onsuccess?.({ target: { result: mockDb } }), 1);
    return request;
  },
};

import {
  enqueueCollectionEvent,
  markEventSynced,
} from '@/lib/collectionEventQueue';
import { flushCollectionMicroBatchQueue } from '@/lib/collectionMicroBatchQueue';

describe('flushCollectionMicroBatchQueue v8.8', () => {
  beforeEach(() => {
    store.clear();
  });

  async function enqueueThree() {
    for (let index = 1; index <= 3; index += 1) {
      await enqueueCollectionEvent({
        client_event_id: `event-${index}`,
        rawValue: `0995000${index}`,
        event_kind: 'production_stage',
      });
    }
  }

  it('move ACKs recebidos para accepted, sem marcar aprovação prematura', async () => {
    await enqueueThree();
    const processBatchFn = vi.fn(async (events) => events.map((event) => ({
      client_event_id: event.client_event_id,
      status_sincronizacao: 'recebida',
      retryable: false,
      result: null,
      ingress: {
        id: `ingress-${event.client_event_id}`,
        client_event_id: event.client_event_id,
        status_sincronizacao: 'recebida',
        server_received_at: '2026-08-31T22:00:00.000Z',
      },
    })));

    const summary = await flushCollectionMicroBatchQueue(processBatchFn, {
      batchSize: 50,
    });

    expect(processBatchFn).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({
      processed: 3,
      accepted: 3,
      synced: 0,
      errors: 0,
      batches: 1,
    });
    expect(Array.from(store.values()).every((event) => (
      event.status === 'accepted'
      && event.server_status === 'recebida'
      && event.result === undefined
    ))).toBe(true);
  });


  it('não deixa um ACK atrasado sobrescrever a decisão final do Realtime', async () => {
    await enqueueCollectionEvent({
      client_event_id: 'event-race',
      rawValue: '09950001',
      event_kind: 'production_stage',
    });

    const processBatchFn = vi.fn(async (events) => {
      await markEventSynced('event-race', {
        success: true,
        status: 'approved',
      });
      return events.map((event) => ({
        client_event_id: event.client_event_id,
        status_sincronizacao: 'recebida',
        retryable: false,
        result: null,
        ingress: {
          client_event_id: event.client_event_id,
          status_sincronizacao: 'recebida',
          server_received_at: '2026-08-31T22:00:00.000Z',
        },
      }));
    });

    const summary = await flushCollectionMicroBatchQueue(processBatchFn);

    expect(summary).toMatchObject({
      processed: 1,
      accepted: 1,
      synced: 0,
      errors: 0,
    });
    expect(store.get('event-race')).toMatchObject({
      status: 'synced',
      result: { success: true, status: 'approved' },
    });
  });

  it('marca final apenas quando o servidor retorna sincronizada', async () => {
    await enqueueThree();
    const processBatchFn = vi.fn(async (events) => events.map((event) => ({
      client_event_id: event.client_event_id,
      status_sincronizacao: 'sincronizada',
      retryable: false,
      result: { success: true, status: 'approved' },
    })));

    const summary = await flushCollectionMicroBatchQueue(processBatchFn);

    expect(summary).toMatchObject({
      processed: 3,
      accepted: 0,
      synced: 3,
      errors: 0,
    });
    expect(Array.from(store.values()).every((event) => (
      event.status === 'synced'
    ))).toBe(true);
  });

  it('recoloca o lote inteiro em pending quando o transporte falha', async () => {
    await enqueueThree();
    const networkError = Object.assign(
      new Error('internet indisponível'),
      { retryable: true },
    );

    const summary = await flushCollectionMicroBatchQueue(
      vi.fn().mockRejectedValue(networkError),
    );

    expect(summary).toMatchObject({
      processed: 3,
      accepted: 0,
      synced: 0,
      errors: 3,
    });
    for (const event of store.values()) {
      expect(event).toMatchObject({ status: 'pending', retries: 1 });
      expect(event.next_attempt_at).toBeTruthy();
    }
  });

  it('isola falha funcional sem reenviar evento finalizado', async () => {
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

    const summary = await flushCollectionMicroBatchQueue(
      vi.fn().mockResolvedValue([
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
      ]),
    );

    expect(summary).toMatchObject({
      processed: 2,
      synced: 1,
      errors: 1,
    });
    expect(store.get('event-ok').status).toBe('synced');
    expect(store.get('event-error')).toMatchObject({
      status: 'error',
      last_result: { reason_code: '42501' },
    });
  });
});

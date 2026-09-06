import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map();
globalThis.IDBKeyRange = {
  bound: (lower, upper) => ({ lower, upper }),
};

const mockDb = {
  transaction: () => {
    let completionTimer;
    let activeCursors = 0;
    let activeRequests = 0;
    const complete = () => {
      clearTimeout(completionTimer);
      if (activeCursors > 0 || activeRequests > 0) return;
      completionTimer = setTimeout(() => tx.oncomplete?.(), 1);
    };
    const tx = {
      objectStore: () => ({
        put: (item) => {
          store.set(item.client_event_id, item);
          complete();
        },
        get: (key) => {
          activeRequests += 1;
          const request = { onsuccess: null };
          setTimeout(() => {
            activeRequests -= 1;
            complete();
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
          openCursor: (range) => {
            activeCursors += 1;
            const request = { onsuccess: null };
            const values = [...store.values()]
              .filter((item) => item.status === range.lower[0]
                && (item.source_mode || 'live') === range.lower[1])
              .sort((a, b) => a.created_at_client.localeCompare(b.created_at_client)
                || a.client_event_id.localeCompare(b.client_event_id));
            let position = 0;
            const emit = () => setTimeout(() => {
              const value = values[position];
              let continued = false;
              request.onsuccess?.({ target: { result: value ? {
                value,
                primaryKey: value.client_event_id,
                continue: () => {
                  continued = true;
                  clearTimeout(completionTimer);
                  position += 1;
                  emit();
                },
              } : null } });
              if (!continued) {
                activeCursors -= 1;
                complete();
              }
            }, 1);
            emit();
            return request;
          },
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
      abort: () => {
        clearTimeout(completionTimer);
        tx.onabort?.({ target: tx });
      },
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
  markEventFinalized,
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

  it('não mistura sessão, dispositivo, célula nem versão de pipeline no envelope', () => {
    const base = { source_mode: 'live', device_id: 'd1', operator_session_id: 's1', cell_id: 'c1', pipeline_version: 3 };
    const events = [
      { ...base, client_event_id: 'one' },
      { ...base, client_event_id: 'same' },
      { ...base, client_event_id: 'session', operator_session_id: 's2' },
      { ...base, client_event_id: 'device', device_id: 'd2' },
      { ...base, client_event_id: 'cell', cell_id: 'c2' },
      { ...base, client_event_id: 'version', pipeline_version: 2 },
    ];
    expect(planCollectionMicroBatches(events).map((batch) => batch.map((event) => event.client_event_id)))
      .toEqual([['one', 'same'], ['session'], ['device'], ['cell'], ['version']]);
  });

  it('finalização por Broadcast vence timeout HTTP atrasado sem reenvio', async () => {
    await enqueueCollectionEvent({ client_event_id: 'broadcast-first', rawValue: '09906655' });
    const summary = await flushCollectionMicroBatchQueue(async () => {
      await markEventFinalized('broadcast-first', { result: { status: 'approved', success: true } });
      throw Object.assign(new Error('resposta perdida'), { retryable: true });
    });
    expect(summary).toMatchObject({ processed: 1, synced: 1, errors: 0, acknowledged: 0 });
    expect(store.get('broadcast-first')).toMatchObject({ status: 'synced', collection_state: 'APPROVED', retries: 0 });
  });

  it('não congela ACK parcial quando o mesmo HTTP também devolve decisão final', async () => {
    await enqueueCollectionEvent({ client_event_id: 'ack-then-final', rawValue: '09906655' });
    const summary = await flushCollectionMicroBatchQueue(async (_events, callbacks) => {
      await callbacks.onAcknowledged([{ client_event_id: 'ack-then-final', status_sincronizacao: 'recebida' }]);
      return [{ client_event_id: 'ack-then-final', status_sincronizacao: 'sincronizada', result: { status: 'approved' } }];
    });
    expect(summary).toMatchObject({ synced: 1, acknowledged: 0 });
    expect(store.get('ack-then-final').collection_state).toBe('APPROVED');
  });

  it('relê decisão final antes de publicar um ACK armazenado no cache de progresso', async () => {
    await enqueueCollectionEvent({ client_event_id: 'cached-ack', rawValue: '09906655' });
    const onResult = vi.fn();
    const receipt = { client_event_id: 'cached-ack', status_sincronizacao: 'recebida' };
    const summary = await flushCollectionMicroBatchQueue(async (_events, callbacks) => {
      await callbacks.onAcknowledged([receipt]);
      await markEventFinalized('cached-ack', { result: { status: 'approved', success: true } });
      return [receipt];
    }, { onResult });
    expect(summary).toMatchObject({ synced: 1, acknowledged: 0 });
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({
      state: 'APPROVED', acknowledged: false, result: { status: 'approved', success: true },
    }));
  });

  it('publica REJECTED canônico mesmo quando o payload interno contém status error', async () => {
    await enqueueCollectionEvent({ client_event_id: 'pre-ingress-rejected', rawValue: '09906655' });
    const onResult = vi.fn();
    await flushCollectionMicroBatchQueue(async () => [{
      client_event_id: 'pre-ingress-rejected', persisted: false,
      collection_state: 'REJECTED', status_sincronizacao: 'sincronizada',
      result: { status: 'error', reason_code: 'COLLECTION_INGRESS_REJECTED' },
    }], { onResult });
    expect(store.get('pre-ingress-rejected').collection_state).toBe('REJECTED');
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ state: 'REJECTED', acknowledged: false }));
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

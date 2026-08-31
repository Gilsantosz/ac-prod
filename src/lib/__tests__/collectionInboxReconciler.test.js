import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  from,
  getCollectionEvents,
  getEventsByStatus,
  markEventPending,
  markEventsAccepted,
  markEventsError,
  markEventsSynced,
} = vi.hoisted(() => ({
  from: vi.fn(),
  getCollectionEvents: vi.fn(),
  getEventsByStatus: vi.fn(),
  markEventPending: vi.fn(),
  markEventsAccepted: vi.fn(),
  markEventsError: vi.fn(),
  markEventsSynced: vi.fn(),
}));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from,
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));
vi.mock('@/lib/collectionEventQueue', () => ({
  getCollectionEvents,
  getEventsByStatus,
  markEventPending,
  markEventsAccepted,
  markEventsError,
  markEventsSynced,
}));
vi.mock('@/lib/collectionBatchService', () => ({
  INGRESS_SELECT: 'id,client_event_id,status_sincronizacao,resultado,erro,retryable',
}));

import {
  applyCollectionInboxRow,
  applyCollectionInboxRows,
  reconcileAcceptedCollectionEvents,
} from '@/lib/collectionInboxReconciler';

describe('collectionInboxReconciler v8.8', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: true },
    });
    markEventsAccepted.mockResolvedValue([]);
    markEventsError.mockResolvedValue([]);
    markEventsSynced.mockResolvedValue([]);
  });

  it('não finaliza uma atualização recebida/processando', async () => {
    const event = { client_event_id: 'event-a', status: 'accepted' };
    getCollectionEvents.mockResolvedValue([event]);

    await applyCollectionInboxRow({
      client_event_id: 'event-a',
      status_sincronizacao: 'processando',
    });

    expect(markEventsAccepted).toHaveBeenCalledTimes(1);
    expect(markEventsAccepted.mock.calls[0][0]).toHaveLength(1);
    expect(markEventsSynced.mock.calls[0][0]).toHaveLength(0);
    expect(markEventsError.mock.calls[0][0]).toHaveLength(0);
  });

  it('finaliza somente após sincronizada', async () => {
    const event = { client_event_id: 'event-a', status: 'accepted' };
    const result = { success: true, status: 'approved' };
    getCollectionEvents.mockResolvedValue([event]);
    const onResult = vi.fn();

    await applyCollectionInboxRow({
      client_event_id: 'event-a',
      status_sincronizacao: 'sincronizada',
      resultado: result,
    }, { onResult });

    expect(markEventsSynced).toHaveBeenCalledTimes(1);
    expect(markEventsSynced.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        event,
        result,
        ingress: expect.objectContaining({
          status_sincronizacao: 'sincronizada',
        }),
      }),
    ]);
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({
      event,
      result,
      error: null,
      source: 'server-final',
    }));
  });

  it('coalesce várias atualizações Realtime em transições por estado', async () => {
    const events = [
      { client_event_id: 'event-a', status: 'accepted' },
      { client_event_id: 'event-b', status: 'processing' },
    ];
    getCollectionEvents.mockResolvedValue(events);
    const onResult = vi.fn();

    const summary = await applyCollectionInboxRows([
      {
        client_event_id: 'event-a',
        status_sincronizacao: 'sincronizada',
        resultado: { success: true, status: 'approved' },
      },
      {
        client_event_id: 'event-b',
        status_sincronizacao: 'processando',
      },
    ], { onResult });

    expect(summary).toEqual({ checked: 2, finalized: 1, accepted: 1 });
    expect(markEventsSynced.mock.calls[0][0]).toHaveLength(1);
    expect(markEventsAccepted.mock.calls[0][0]).toHaveLength(1);
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('reconcilia vários resultados em lote sem uma transação local por item', async () => {
    const events = [
      { client_event_id: 'event-a', status: 'accepted', created_at_client: '2026-08-31T22:00:00Z' },
      { client_event_id: 'event-b', status: 'accepted', created_at_client: '2026-08-31T22:00:01Z' },
      { client_event_id: 'event-c', status: 'accepted', created_at_client: '2026-08-31T22:00:02Z' },
    ];
    getEventsByStatus.mockResolvedValue(events);

    const inQuery = vi.fn().mockResolvedValue({
      data: [
        {
          client_event_id: 'event-a',
          status_sincronizacao: 'sincronizada',
          resultado: { success: true, status: 'approved' },
        },
        {
          client_event_id: 'event-b',
          status_sincronizacao: 'processando',
          resultado: null,
        },
        {
          client_event_id: 'event-c',
          status_sincronizacao: 'erro',
          retryable: false,
          erro: 'célula incorreta',
          resultado: {
            success: false,
            status: 'wrong_cell',
            message: 'célula incorreta',
          },
        },
      ],
      error: null,
    });
    const select = vi.fn(() => ({ in: inQuery }));
    from.mockReturnValue({ select });
    const onResult = vi.fn();

    const summary = await reconcileAcceptedCollectionEvents({ onResult });

    expect(markEventsSynced).toHaveBeenCalledTimes(1);
    expect(markEventsSynced.mock.calls[0][0]).toHaveLength(1);
    expect(markEventsAccepted).toHaveBeenCalledTimes(1);
    expect(markEventsAccepted.mock.calls[0][0]).toHaveLength(1);
    expect(markEventsError).toHaveBeenCalledTimes(1);
    expect(markEventsError.mock.calls[0][0]).toHaveLength(1);
    expect(summary).toEqual({
      checked: 3,
      finalized: 2,
      stillWaiting: 1,
      requeued: 0,
    });
    expect(onResult).toHaveBeenCalledTimes(2);
  });
});

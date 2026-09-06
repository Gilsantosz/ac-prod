import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  channel: vi.fn(),
  from: vi.fn(),
  removeChannel: vi.fn(),
  getCollectionEvent: vi.fn(),
  getUnresolvedCollectionEvents: vi.fn(),
  markEventDatabaseAcknowledged: vi.fn(),
  markEventDeadLettered: vi.fn(),
  markEventFinalized: vi.fn(),
  markEventServerProcessing: vi.fn(),
}));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    channel: mocks.channel,
    from: mocks.from,
    removeChannel: mocks.removeChannel,
  },
}));
vi.mock('@/lib/collectionEventQueue', () => ({
  getCollectionEvent: mocks.getCollectionEvent,
  getUnresolvedCollectionEvents: mocks.getUnresolvedCollectionEvents,
  markEventDatabaseAcknowledged: mocks.markEventDatabaseAcknowledged,
  markEventDeadLettered: mocks.markEventDeadLettered,
  markEventFinalized: mocks.markEventFinalized,
  markEventServerProcessing: mocks.markEventServerProcessing,
}));

import {
  COLLECTION_BROADCAST_EVENTS,
  persistCollectionBroadcastMessage,
  reconcileCollectionEventsV3,
  subscribeToCollectionBroadcastV3,
  unsubscribeFromCollectionBroadcastV3,
} from '@/lib/collectionRealtimeService';

describe('collectionRealtimeService V3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markEventFinalized.mockResolvedValue({ client_event_id: 'event-1' });
    mocks.channel.mockImplementation((name, options) => {
      const realtimeChannel = {
        name,
        options,
        on: vi.fn(() => realtimeChannel),
        subscribe: vi.fn(() => realtimeChannel),
      };
      return realtimeChannel;
    });
    mocks.removeChannel.mockResolvedValue('ok');
  });

  it('multiplexa todos os eventos em um canal privado por device e um por célula', async () => {
    const subscription = subscribeToCollectionBroadcastV3({
      deviceId: 'device-1',
      cellId: 'cell-1',
      onMessage: vi.fn(),
    });

    expect(mocks.channel.mock.calls.map(([name]) => name)).toEqual([
      'collection:device:device-1',
      'collection:cell:cell-1',
    ]);
    for (const realtimeChannel of subscription.channels) {
      expect(realtimeChannel.options).toMatchObject({ config: { private: true } });
      expect(realtimeChannel.on).toHaveBeenCalledTimes(COLLECTION_BROADCAST_EVENTS.length);
      expect(realtimeChannel.on.mock.calls.map(([, filter]) => filter.event))
        .toEqual(COLLECTION_BROADCAST_EVENTS);
      expect(realtimeChannel.subscribe).toHaveBeenCalledOnce();
    }

    await unsubscribeFromCollectionBroadcastV3(subscription);
    expect(mocks.removeChannel).toHaveBeenCalledTimes(2);
  });

  it('persiste finalized como decisão canônica sem criar canal por leitura', async () => {
    const update = await persistCollectionBroadcastMessage({
      broadcast_event: 'collection.finalized',
      client_event_id: 'event-1',
      decision: 'approved',
      result: { status: 'approved', success: true },
    });

    expect(mocks.markEventFinalized).toHaveBeenCalledWith(
      'event-1',
      expect.objectContaining({ collection_state: 'APPROVED' }),
    );
    expect(update.state).toBe('APPROVED');
    expect(mocks.channel).not.toHaveBeenCalled();
  });

  it('aplica correção autoritativa de uma decisão já terminal', async () => {
    const update = await persistCollectionBroadcastMessage({
      broadcast_event: 'collection.projection_delta',
      client_event_id: 'event-1',
      outbox_id: 'outbox-correction-1',
      projection_kind: 'correction',
      previous_decision: 'approved',
      decision: 'pending_review',
      delta: { approved: -1, pending: 1, total: 0 },
    });

    expect(mocks.markEventFinalized).toHaveBeenCalledWith(
      'event-1',
      expect.objectContaining({ collection_state: 'PENDING_REVIEW' }),
      { force: true },
    );
    expect(update.state).toBe('PENDING_REVIEW');
  });

  it('reconcilia até 100 recibos e mantém paginação quando nenhum ID existe no servidor', async () => {
    const candidates = Array.from({ length: 100 }, (_, index) => ({ client_event_id: `event-${index}`, pipeline_version: 3 }));
    Object.defineProperty(candidates, 'hasMore', { value: true });
    mocks.getUnresolvedCollectionEvents.mockResolvedValue(candidates);
    const select = vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: [], error: null }) }));
    mocks.from.mockReturnValue({ select });
    const updates = await reconcileCollectionEventsV3({ limit: 100 });
    expect(mocks.getUnresolvedCollectionEvents).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    expect(select).toHaveBeenCalledWith(expect.stringContaining('pipeline_version'));
    expect(updates).toHaveLength(0);
    expect(updates.hasMore).toBe(true);
  });

  it('aplica V2/V3 somente ao client_event_id e pipeline originalmente fixados', async () => {
    mocks.getUnresolvedCollectionEvents.mockResolvedValue([
      { client_event_id: 'v2', pipeline_version: 2 },
      { client_event_id: 'v3', pipeline_version: 3 },
      { client_event_id: 'mismatch', pipeline_version: 3 },
    ]);
    mocks.from.mockReturnValue({ select: () => ({ in: vi.fn().mockResolvedValue({
      data: [
        { client_event_id: 'v2', pipeline_version: 2, status_sincronizacao: 'sincronizada', resultado: { status: 'approved' } },
        { client_event_id: 'v3', pipeline_version: 3, status_sincronizacao: 'sincronizada', resultado: { status: 'blocked' } },
        { client_event_id: 'mismatch', pipeline_version: 2, status_sincronizacao: 'sincronizada', resultado: { status: 'approved' } },
        { client_event_id: 'not-requested', pipeline_version: 3, status_sincronizacao: 'sincronizada', resultado: { status: 'approved' } },
      ], error: null,
    }) }) });
    const updates = await reconcileCollectionEventsV3();
    expect(updates).toHaveLength(2);
    expect(mocks.markEventFinalized.mock.calls.map(([id]) => id)).toEqual(['v2', 'v3']);
    expect(updates.hasMore).toBe(false);
  });

  it('não anuncia PROCESSING ao receber Broadcast atrasado depois de APPROVED', async () => {
    mocks.markEventServerProcessing.mockResolvedValue({ collection_state: 'APPROVED' });
    const update = await persistCollectionBroadcastMessage({ broadcast_event: 'collection.processing', client_event_id: 'event-1' });
    expect(update.state).toBe('APPROVED');
  });

  it('libera reconciliação travada com timeout sem apagar ou reenviar eventos', async () => {
    vi.useFakeTimers();
    try {
      mocks.getUnresolvedCollectionEvents.mockResolvedValue([{ client_event_id: 'v3', pipeline_version: 3 }]);
      const abortSignal = vi.fn(() => new Promise(() => {}));
      mocks.from.mockReturnValue({ select: () => ({ in: () => ({ abortSignal }) }) });
      const request = reconcileCollectionEventsV3({ timeoutMs: 250 });
      const result = expect(request).rejects.toMatchObject({ code: 'COLLECTION_RECONCILIATION_TIMEOUT', retryable: true });
      await vi.advanceTimersByTimeAsync(250);
      await result;
      expect(abortSignal.mock.calls[0][0].aborted).toBe(true);
      expect(mocks.markEventFinalized).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

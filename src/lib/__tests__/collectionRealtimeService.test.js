import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  channel: vi.fn(),
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
});

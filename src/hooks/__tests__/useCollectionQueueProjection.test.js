import { describe, expect, it } from 'vitest';
import {
  applyCollectionProjectionDelta,
  getCollectionProjectionDedupeKey,
} from '@/hooks/useCollectionQueue';

describe('collection projection delta dedupe', () => {
  it('gera a mesma identidade para o delta recebido nos canais device e cell', () => {
    const shared = {
      client_event_id: 'client-event-001',
      projected_at: '2026-09-01T12:00:00.000Z',
      decision: 'approved',
    };
    const devicePayload = {
      ...shared,
      outbox_id: 'outbox-001',
      broadcast_event: 'collection.projection_delta',
    };
    const cellPayload = {
      ...shared,
      outbox_id: 'outbox-001',
      broadcast_event: 'collection.projection_delta',
    };

    const seen = new Set();
    const applied = [devicePayload, cellPayload].filter((payload) => {
      const key = getCollectionProjectionDedupeKey(payload);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    expect(getCollectionProjectionDedupeKey(devicePayload))
      .toBe(getCollectionProjectionDedupeKey(cellPayload));
    expect(applied).toEqual([devicePayload]);
  });

  it('não colapsa duas projeções do mesmo evento com outbox distintos', () => {
    const base = {
      client_event_id: 'client-event-001',
      projected_at: '2026-09-01T12:00:00.000Z',
      decision: 'approved',
    };

    expect(getCollectionProjectionDedupeKey({ ...base, outbox_id: 'outbox-001' }))
      .not.toBe(getCollectionProjectionDedupeKey({ ...base, outbox_id: 'outbox-002' }));
  });

  it('aplica delta compensatório sem aumentar novamente o total', () => {
    let next;
    const queryClient = {
      setQueriesData: (_filters, updater) => {
        next = updater({
          total: 10,
          approved: 8,
          pending: 1,
          rejected: 1,
          blocked: 0,
          duplicated: 0,
        });
      },
    };

    applyCollectionProjectionDelta(queryClient, {
      projection_kind: 'correction',
      previous_decision: 'approved',
      decision: 'pending_review',
      delta: { total: 0, approved: -1, pending: 1 },
    });

    expect(next).toMatchObject({ total: 10, approved: 7, pending: 2 });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { processProductionReading, collectReplacementStageV2 } = vi.hoisted(() => ({
  processProductionReading: vi.fn(),
  collectReplacementStageV2: vi.fn(),
}));

vi.mock('@/lib/traceabilityService', () => ({ processProductionReading }));
vi.mock('@/lib/replacementService', () => ({
  REPLACEMENT_EVENT_KIND: 'replacement_stage',
  collectReplacementStageV2,
}));

import {
  COLLECTION_EVENT_KINDS,
  dispatchCollectionEvent,
  resolveCollectionEventKind,
} from '@/lib/collectionEventDispatcher';

describe('collectionEventDispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processProductionReading.mockResolvedValue({ success: true, source: 'production' });
    collectReplacementStageV2.mockResolvedValue({ success: true, source: 'replacement' });
  });

  it('despacha reposição exclusivamente para collect_replacement_stage_v2', async () => {
    const result = await dispatchCollectionEvent({
      event_kind: COLLECTION_EVENT_KINDS.REPLACEMENT_STAGE,
      session_token: 'session-token',
      raw_value: 'REP-001',
      client_event_id: 'event-1',
      device_id: 'device-1',
      created_at_client: '2026-08-10T00:00:00.000Z',
      queued_offline: true,
    });

    expect(result.source).toBe('replacement');
    expect(collectReplacementStageV2).toHaveBeenCalledWith(expect.objectContaining({
      sessionToken: 'session-token',
      barcode: 'REP-001',
      clientEventId: 'event-1',
      deviceId: 'device-1',
      payload: expect.objectContaining({ event_kind: 'replacement_stage', queued_offline: true }),
    }));
    expect(processProductionReading).not.toHaveBeenCalled();
  });

  it('mantém eventos produtivos no fluxo genérico', async () => {
    await dispatchCollectionEvent({
      event_kind: COLLECTION_EVENT_KINDS.PRODUCTION_STAGE,
      raw_value: 'P-001',
      cell_name: 'Corte',
      client_event_id: 'event-2',
    });

    expect(processProductionReading).toHaveBeenCalledWith(expect.objectContaining({
      rawValue: 'P-001', cellName: 'Corte', client_event_id: 'event-2',
    }));
    expect(collectReplacementStageV2).not.toHaveBeenCalled();
  });

  it('migra eventos legados marcados como reposição sem enviá-los ao fluxo genérico', () => {
    expect(resolveCollectionEventKind({ is_replacement_event: true })).toBe('replacement_stage');
  });

  it('bloqueia tipos desconhecidos como erro não retentável', async () => {
    await expect(dispatchCollectionEvent({ event_kind: 'unknown' })).rejects.toMatchObject({ retryable: false });
  });
});

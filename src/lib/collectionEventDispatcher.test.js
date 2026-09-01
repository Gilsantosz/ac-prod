import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  processProductionReading,
  processFastProductionReading,
  processProductionCollectionBatch,
  collectReplacementStageV2,
} = vi.hoisted(() => ({
  processProductionReading: vi.fn(),
  processFastProductionReading: vi.fn(),
  processProductionCollectionBatch: vi.fn(),
  collectReplacementStageV2: vi.fn(),
}));

vi.mock('@/lib/traceabilityService', () => ({ processProductionReading }));
vi.mock('@/lib/fastProductionReadingService', () => ({
  processFastProductionReading,
}));
vi.mock('@/lib/collectionBatchService', () => ({
  processProductionCollectionBatch,
}));
vi.mock('@/lib/replacementService', () => ({
  REPLACEMENT_EVENT_KIND: 'replacement_stage',
  collectReplacementStageV2,
}));

import {
  COLLECTION_EVENT_KINDS,
  dispatchCollectionEvent,
  dispatchCollectionEventBatch,
  resolveCollectionEventKind,
} from '@/lib/collectionEventDispatcher';

describe('collectionEventDispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processProductionReading.mockResolvedValue({
      success: true,
      source: 'production',
    });
    processFastProductionReading.mockResolvedValue({
      success: true,
      source: 'fast-production',
    });
    processProductionCollectionBatch.mockImplementation(async (events) => (
      events.map((event) => ({
        client_event_id: event.client_event_id,
        status_sincronizacao: 'sincronizada',
        retryable: false,
        result: { success: true, source: 'production-batch' },
      }))
    ));
    collectReplacementStageV2.mockResolvedValue({
      success: true,
      source: 'replacement',
    });
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
      payload: expect.objectContaining({
        event_kind: 'replacement_stage',
        queued_offline: true,
      }),
    }));
    expect(processProductionReading).not.toHaveBeenCalled();
  });

  it('mantém eventos produtivos genéricos no fluxo unitário legado', async () => {
    await dispatchCollectionEvent({
      event_kind: COLLECTION_EVENT_KINDS.PRODUCTION_STAGE,
      raw_value: 'P-001',
      cell_name: 'Corte',
      client_event_id: 'event-2',
    });

    expect(processProductionReading).toHaveBeenCalledWith(expect.objectContaining({
      rawValue: 'P-001',
      cellName: 'Corte',
      client_event_id: 'event-2',
    }));
    expect(processFastProductionReading).not.toHaveBeenCalled();
    expect(collectReplacementStageV2).not.toHaveBeenCalled();
  });

  it('mantém o caminho rápido unitário como fallback explícito', async () => {
    await dispatchCollectionEvent({
      event_kind: COLLECTION_EVENT_KINDS.PRODUCTION_STAGE,
      raw_value: '09950001',
      client_event_id: 'event-fast',
      fastPath: true,
    });

    expect(processFastProductionReading).toHaveBeenCalledTimes(1);
    expect(processProductionReading).not.toHaveBeenCalled();
  });

  it('envia eventos produtivos consecutivos em uma única operação de lote', async () => {
    const result = await dispatchCollectionEventBatch([
      {
        event_kind: COLLECTION_EVENT_KINDS.PRODUCTION_STAGE,
        raw_value: '09950001',
        client_event_id: 'event-a',
      },
      {
        event_kind: COLLECTION_EVENT_KINDS.PRODUCTION_STAGE,
        raw_value: '09950002',
        client_event_id: 'event-b',
      },
    ]);

    expect(processProductionCollectionBatch).toHaveBeenCalledTimes(1);
    expect(processProductionCollectionBatch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ client_event_id: 'event-a' }),
        expect.objectContaining({ client_event_id: 'event-b' }),
      ]),
      {},
    );
    expect(result).toHaveLength(2);
  });

  it('encaminha a confirmação progressiva do lote ao transporte assíncrono', async () => {
    const onFinalized = vi.fn();

    await dispatchCollectionEventBatch([{
      event_kind: COLLECTION_EVENT_KINDS.PRODUCTION_STAGE,
      raw_value: '09950001',
      client_event_id: 'event-progressive',
    }], { onFinalized });

    expect(processProductionCollectionBatch).toHaveBeenCalledWith(
      [expect.objectContaining({ client_event_id: 'event-progressive' })],
      { onFinalized },
    );
  });

  it('não mistura reposição dentro do INSERT produtivo', async () => {
    const result = await dispatchCollectionEventBatch([
      {
        event_kind: COLLECTION_EVENT_KINDS.PRODUCTION_STAGE,
        raw_value: '09950001',
        client_event_id: 'event-a',
      },
      {
        event_kind: COLLECTION_EVENT_KINDS.REPLACEMENT_STAGE,
        raw_value: 'REP-001',
        client_event_id: 'event-r',
      },
      {
        event_kind: COLLECTION_EVENT_KINDS.PRODUCTION_STAGE,
        raw_value: '09950002',
        client_event_id: 'event-b',
      },
    ]);

    expect(processProductionCollectionBatch).toHaveBeenCalledTimes(2);
    expect(collectReplacementStageV2).toHaveBeenCalledTimes(1);
    expect(result.map((item) => item.client_event_id)).toEqual([
      'event-a',
      'event-r',
      'event-b',
    ]);
  });

  it('migra eventos legados marcados como reposição sem enviá-los ao fluxo genérico', () => {
    expect(resolveCollectionEventKind({ is_replacement_event: true }))
      .toBe('replacement_stage');
  });

  it('bloqueia tipos desconhecidos como erro não retentável', async () => {
    await expect(dispatchCollectionEvent({ event_kind: 'unknown' }))
      .rejects.toMatchObject({ retryable: false });
  });
});

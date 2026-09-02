import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, from, getOperatorSession } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  getOperatorSession: vi.fn(),
}));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { rpc, from },
}));
vi.mock('@/lib/operatorSessionService', () => ({
  getOperatorSession,
}));
vi.mock('@/lib/collectionDeviceIdentity', () => ({
  getCollectionDeviceId: () => 'device-v3',
  getCollectionAppVersion: () => 'test-v3',
}));
vi.mock('@/lib/collectionEventQueue', () => ({
  pinCollectionPipelineVersion: async (events, version) => {
    events.forEach((item) => { item.pipeline_version = version; });
    return version;
  },
  reassignFirstCollectionPipelineAttempt: async (events, _from, to) => {
    events.forEach((item) => { item.pipeline_version = to; });
    return to;
  },
  sanitizeCollectionEventPayload: (event) => event,
}));

import {
  clearCollectionPipelineFlagsCache,
  processProductionCollectionBatch,
} from '@/lib/collectionBatchService';
import { COLLECTION_STATES } from '@/lib/collectionStateMachine';

const event = (overrides = {}) => ({
  client_event_id: 'event-v3',
  raw_value: '09950001',
  reader_type: 'keyboard_barcode',
  captured_at_client: '2026-09-01T12:00:00.000Z',
  device_id: 'device-v3',
  device_sequence: 41,
  source_mode: 'live',
  quantity: 1,
  event_kind: 'production_stage',
  operator_session_token: 'stale-secret-that-must-not-leave',
  ...overrides,
});

describe('processProductionCollectionBatch V3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCollectionPipelineFlagsCache();
    getOperatorSession.mockReturnValue({
      session_id: 'operator-session-id',
      token: 'current-secret-that-must-not-leave',
    });
    from.mockReset();
  });

  it('envia o envelope V3 sem token e retorna somente o ACK do banco', async () => {
    rpc.mockImplementation(async (name, args) => {
      if (name === 'get_collection_pipeline_flags_v3') {
        return {
          data: {
            collection_pipeline_v3_ingress: { enabled: true },
            collection_pipeline_v3_broadcast: { enabled: true },
          },
          error: null,
        };
      }
      expect(name).toBe('ingest_collection_batch_v3');
      return {
        data: {
          batch_id: args.p_batch_id,
          device_id: 'device-v3',
          received_at_db: '2026-09-01T12:00:01.000Z',
          results: [{ client_event_id: 'event-v3', persisted: true }],
        },
        error: null,
      };
    });
    const onAcknowledged = vi.fn();

    const result = await processProductionCollectionBatch([event()], {
      onAcknowledged,
    });

    expect(rpc).toHaveBeenCalledTimes(2);
    const [, args] = rpc.mock.calls[1];
    expect(args).toMatchObject({
      p_device_id: 'device-v3',
      p_events: {
        operator_session_id: 'operator-session-id',
        source_mode: 'live',
        app_version: 'test-v3',
        events: [{
          client_event_id: 'event-v3',
          raw_value: '09950001',
          tag_lida: '09950001',
          reader_type: 'keyboard_barcode',
          captured_at_client: '2026-09-01T12:00:00.000Z',
          device_sequence: 41,
          quantity: 1,
        }],
      },
    });
    expect(args.p_batch_id).toEqual(expect.any(String));
    expect(JSON.stringify(args.p_events)).not.toContain('secret');
    expect(result[0]).toMatchObject({
      client_event_id: 'event-v3',
      status_sincronizacao: 'recebida',
      collection_state: COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
      transport_phase: 'database_acknowledged',
      result: null,
    });
    expect(onAcknowledged).toHaveBeenCalledWith(result);
  });

  it('tolera retorno em array sem perder o pareamento por client_event_id', async () => {
    rpc.mockImplementation(async (name) => {
      if (name === 'get_collection_pipeline_flags_v3') {
        return {
          data: { collection_pipeline_v3_ingress: { enabled: true } },
          error: null,
        };
      }
      return {
        data: [{ client_event_id: 'event-v3', persisted: true }],
        error: null,
      };
    });

    await expect(processProductionCollectionBatch([
      event({ source_mode: 'offline_replay' }),
    ])).resolves.toEqual([
      expect.objectContaining({
        client_event_id: 'event-v3',
        collection_state: COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
      }),
    ]);
  });

  it('não registra como ACK um evento recusado antes do enfileiramento', async () => {
    rpc.mockImplementation(async (name) => {
      if (name === 'get_collection_pipeline_flags_v3') {
        return {
          data: { collection_pipeline_v3_ingress: { enabled: true } },
          error: null,
        };
      }
      return {
        data: {
          results: [{
            client_event_id: 'event-v3',
            persisted: false,
            queue_status: 'rejected',
            error_code: 'INVALID_DEVICE_SEQUENCE',
          }],
        },
        error: null,
      };
    });
    const onAcknowledged = vi.fn();
    const onFinalized = vi.fn();

    const [result] = await processProductionCollectionBatch([event()], {
      onAcknowledged,
      onFinalized,
    });

    expect(result).toMatchObject({
      accepted: false,
      status_sincronizacao: 'sincronizada',
      collection_state: COLLECTION_STATES.REJECTED,
      retryable: false,
    });
    expect(onAcknowledged).not.toHaveBeenCalled();
    expect(onFinalized).toHaveBeenCalledWith([result]);
  });

  it('mantém evento previamente atribuído ao V3 sem reconsultar a flag', async () => {
    rpc.mockResolvedValue({
      data: {
        results: [{ client_event_id: 'event-v3', persisted: true }],
      },
      error: null,
    });

    await processProductionCollectionBatch([event({ pipeline_version: 3 })]);

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      'ingest_collection_batch_v3',
      expect.any(Object),
    );
  });

  it('recusa trocar um evento V3 para V2 após atribuição', async () => {
    await expect(processProductionCollectionBatch([
      event({ pipeline_version: 3 }),
    ], { forceV2: true })).rejects.toMatchObject({
      code: 'COLLECTION_PIPELINE_ASSIGNMENT_CONFLICT',
      retryable: false,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('redireciona ao V2 só na primeira tentativa recusada pela flag desligada', async () => {
    rpc.mockImplementation(async (name) => {
      if (name === 'get_collection_pipeline_flags_v3') {
        return {
          data: { collection_pipeline_v3_ingress: { enabled: true } },
          error: null,
        };
      }
      return {
        data: null,
        error: {
          code: '55000',
          message: 'COLLECTION_PIPELINE_V3_INGRESS_DISABLED',
        },
      };
    });
    from.mockImplementation(() => ({
      insert: (rows) => ({
        select: async () => ({
          data: rows.map((row) => ({
            ...row,
            status_sincronizacao: 'sincronizada',
            resultado: {
              success: true,
              status: 'approved',
              client_event_id: row.client_event_id,
            },
          })),
          error: null,
        }),
      }),
    }));
    const firstAttempt = event();

    const [result] = await processProductionCollectionBatch([firstAttempt]);

    expect(firstAttempt.pipeline_version).toBe(2);
    expect(from).toHaveBeenCalledWith('coletas_producao');
    expect(result.result).toMatchObject({ status: 'approved' });
  });

  it('não redireciona um evento que já estava fixado no V3', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: '55000',
        message: 'COLLECTION_PIPELINE_V3_INGRESS_DISABLED',
      },
    });

    await expect(processProductionCollectionBatch([
      event({ pipeline_version: 3 }),
    ])).rejects.toMatchObject({ code: '55000' });
    expect(from).not.toHaveBeenCalled();
  });
});

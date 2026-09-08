import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  COLLECTION_TRANSPORT_TIMEOUT_MS,
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

const legacyFlags = { collection_pipeline_v3_ingress: { enabled: true } };
const immediateFlags = (limit = 5) => ({
  collection_pipeline_v3_ingress: {
    enabled: true,
    rollout_scope: {
      all: true,
      immediate_rpc: 'ingest_collection_batch_immediate_v3',
      immediate_max_events: limit,
    },
  },
});
const eventsOfSize = (size, overrides = {}) => Array.from({ length: size }, (_, index) => event({
  client_event_id: `event-${index}`,
  device_sequence: 41 + index,
  ...overrides,
}));
const finalizedResponse = (args) => ({
  data: {
    batch_id: args.p_batch_id,
    device_id: args.p_device_id,
    received_at_db: '2026-09-01T12:00:01.000Z',
    results: args.p_events.events.map((item) => ({
      client_event_id: item.client_event_id,
      persisted: true,
      decision: 'approved',
      decided_at: '2026-09-01T12:00:01.010Z',
      projection_status: 'pending',
      result: { status: 'approved', message: 'Peça liberada', quantity: item.quantity },
    })),
  },
  error: null,
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

  afterEach(() => vi.useRealTimers());

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
        data: [{ client_event_id: 'event-v3', persisted: true, received_at_db: '2026-09-01T12:00:01.000Z' }],
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

  it('mantém evento atribuído ao V3 e consulta a capacidade antes de usar o transporte legado', async () => {
    rpc.mockImplementation(async (name) => name === 'get_collection_pipeline_flags_v3'
      ? { data: legacyFlags, error: null }
      : { data: { results: [{ client_event_id: 'event-v3', persisted: true, received_at_db: '2026-09-01T12:00:01.000Z' }] }, error: null });

    await processProductionCollectionBatch([event({ pipeline_version: 3 })]);

    expect(rpc).toHaveBeenCalledTimes(2);
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

  it('publica decisão imediata com metadados sem transformá-la em ACK provisório', async () => {
    rpc.mockImplementation(async (_name, args) => finalizedResponse(args));
    const onFinalized = vi.fn();
    const onAcknowledged = vi.fn();

    const result = await processProductionCollectionBatch([event()], {
      pipelineFlags: immediateFlags(), onFinalized, onAcknowledged,
    });

    expect(rpc).toHaveBeenCalledWith('ingest_collection_batch_immediate_v3', expect.any(Object));
    expect(result).toEqual([expect.objectContaining({
      client_event_id: 'event-v3', pipeline_version: 3,
      collection_state: COLLECTION_STATES.APPROVED, transport_phase: 'finalized',
      status_sincronizacao: 'sincronizada', decision: 'approved',
      decided_at: '2026-09-01T12:00:01.010Z', projection_status: 'pending',
      result: { status: 'approved', message: 'Peça liberada', quantity: 1 },
    })]);
    expect(result[0].database_acknowledgement).toMatchObject({ persisted: true, decision: 'approved' });
    expect(onFinalized).toHaveBeenCalledWith(result);
    expect(onAcknowledged).not.toHaveBeenCalled();
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('secret');
  });

  it.each([
    [5, [5, 5, 2]],
    [2, [2, 2, 2, 2, 2, 2]],
    [99, [5, 5, 2]],
  ])('divide 12 eventos em chunks seguros com limite publicado %s', async (limit, expectedSizes) => {
    let inFlight = 0;
    rpc.mockImplementation(async (_name, args) => {
      inFlight += 1;
      expect(inFlight).toBe(1);
      await Promise.resolve();
      inFlight -= 1;
      return finalizedResponse(args);
    });
    const captured = eventsOfSize(12);
    const onFinalized = vi.fn();

    const results = await processProductionCollectionBatch(captured, {
      pipelineFlags: immediateFlags(limit), onFinalized,
    });

    expect(rpc.mock.calls.map(([, args]) => args.p_events.events.length)).toEqual(expectedSizes);
    expect(rpc.mock.calls.every(([name]) => name === 'ingest_collection_batch_immediate_v3')).toBe(true);
    expect(new Set(rpc.mock.calls.map(([, args]) => args.p_batch_id)).size).toBe(expectedSizes.length);
    expect(rpc.mock.calls.flatMap(([, args]) => args.p_events.events.map((item) => item.client_event_id)))
      .toEqual(captured.map((item) => item.client_event_id));
    expect(results.map((item) => item.client_event_id)).toEqual(captured.map((item) => item.client_event_id));
    expect(onFinalized).toHaveBeenCalledTimes(expectedSizes.length);
    expect(captured.every((item) => item.pipeline_version === 3)).toBe(true);
  });

  it('preserva as decisões do primeiro chunk quando a requisição seguinte falha', async () => {
    rpc.mockImplementationOnce(async (_name, args) => finalizedResponse(args))
      .mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'statement timeout' } });
    const captured = eventsOfSize(12);
    const onFinalized = vi.fn();
    const error = await processProductionCollectionBatch(captured, {
      pipelineFlags: immediateFlags(), onFinalized,
    }).catch((caught) => caught);

    expect(error).toMatchObject({ code: '57014', retryable: true, acknowledgedEnvelopes: [] });
    expect(error.finalizedEnvelopes.map((item) => item.client_event_id))
      .toEqual(captured.slice(0, 5).map((item) => item.client_event_id));
    expect(onFinalized).toHaveBeenCalledOnce();
    expect(error.finalizedEnvelopes).toEqual(onFinalized.mock.calls[0][0]);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(from).not.toHaveBeenCalled();
    expect(captured.every((item) => item.pipeline_version === 3)).toBe(true);
  });

  it('não migra um lote parcialmente confirmado para V2 se a flag desligar entre chunks', async () => {
    rpc.mockImplementationOnce(async (_name, args) => finalizedResponse(args))
      .mockResolvedValueOnce({
        data: null,
        error: { code: '55000', message: 'COLLECTION_PIPELINE_V3_INGRESS_DISABLED' },
      });
    const captured = eventsOfSize(7);
    const error = await processProductionCollectionBatch(captured, {
      pipelineFlags: immediateFlags(),
    }).catch((caught) => caught);

    expect(error).toMatchObject({ code: '55000' });
    expect(error.finalizedEnvelopes).toHaveLength(5);
    expect(from).not.toHaveBeenCalled();
    expect(captured.every((item) => item.pipeline_version === 3)).toBe(true);
  });

  it('replay fixado em V3 adota a capacidade imediata sem trocar identidade ou sessão de origem', async () => {
    rpc.mockImplementation(async (name, args) => name === 'get_collection_pipeline_flags_v3'
      ? { data: immediateFlags(), error: null }
      : finalizedResponse(args));
    const captured = event({
      pipeline_version: 3, source_mode: 'offline_replay', operator_session_id: 'original-session-id',
    });

    await processProductionCollectionBatch([captured]);

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'get_collection_pipeline_flags_v3', 'ingest_collection_batch_immediate_v3',
    ]);
    expect(rpc.mock.calls[1][1].p_events).toMatchObject({
      source_mode: 'offline_replay', operator_session_id: 'original-session-id',
      events: [{ client_event_id: 'event-v3', device_sequence: 41 }],
    });
    expect(captured.pipeline_version).toBe(3);
    expect(from).not.toHaveBeenCalled();
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
            id: `receipt-${row.client_event_id}`,
            server_received_at: '2026-09-01T12:00:01.000Z',
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
    ], { pipelineFlags: legacyFlags })).rejects.toMatchObject({ code: '55000' });
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { results: [] },
    { results: [{ client_event_id: 'another-event', persisted: true, received_at_db: '2026-09-01T12:00:01.000Z' }] },
    { results: [{ client_event_id: 'event-v3' }] },
    { results: [{ client_event_id: 'event-v3', persisted: true }] },
    { results: [{ client_event_id: 'event-v3', persisted: true, received_at_db: 'invalid' }] },
    { received_at_db: '2026-09-01T12:00:01.000Z', results: [
      { client_event_id: 'event-v3', persisted: true },
      { client_event_id: 'event-v3', persisted: true },
    ] },
  ])('não inventa recibo para resposta ausente, trocada, ambígua ou sem persistência: %j', async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    const onAcknowledged = vi.fn();
    const onFinalized = vi.fn();
    const captured = event({ pipeline_version: 3 });

    await expect(processProductionCollectionBatch([captured], {
      onAcknowledged,
      onFinalized,
      pipelineFlags: legacyFlags,
    })).rejects.toMatchObject({
      code: 'COLLECTION_ACK_INCOMPLETE',
      retryable: true,
      acknowledgementUnknown: true,
      pendingClientEventIds: ['event-v3'],
    });

    expect(onAcknowledged).not.toHaveBeenCalled();
    expect(onFinalized).not.toHaveBeenCalled();
    expect(captured.pipeline_version).toBe(3);
    expect(from).not.toHaveBeenCalled();
  });

  it('confirma somente os IDs exatos de uma resposta parcial fora de ordem', async () => {
    rpc.mockResolvedValue({
      data: {
        received_at_db: '2026-09-01T12:00:01.000Z',
        results: [
          { client_event_id: 'event-c', persisted: true },
          { client_event_id: 'unrelated-event', persisted: true },
          { client_event_id: 'event-a', persisted: true },
        ],
      },
      error: null,
    });
    const onAcknowledged = vi.fn();
    const events = ['event-a', 'event-b', 'event-c'].map((id, index) => event({
      client_event_id: id,
      device_sequence: 41 + index,
      pipeline_version: 3,
    }));
    const result = await processProductionCollectionBatch(events, { onAcknowledged, pipelineFlags: legacyFlags })
      .catch((error) => error);

    expect(result).toMatchObject({
      code: 'COLLECTION_ACK_INCOMPLETE',
      pendingClientEventIds: ['event-b'],
    });
    expect(onAcknowledged).toHaveBeenCalledOnce();
    expect(onAcknowledged.mock.calls[0][0].map((receipt) => receipt.client_event_id))
      .toEqual(['event-a', 'event-c']);
    expect(result.acknowledgedEnvelopes).toEqual(onAcknowledged.mock.calls[0][0]);
  });

  it('não troca o pipeline nem o ID quando fetch demora após possível commit', async () => {
    vi.useFakeTimers();
    const abortSignal = vi.fn(() => new Promise(() => {}));
    rpc.mockReturnValue({ abortSignal });
    const captured = event({ pipeline_version: 3 });
    const outcome = processProductionCollectionBatch([captured], { pipelineFlags: legacyFlags }).catch((error) => error);

    await vi.advanceTimersByTimeAsync(COLLECTION_TRANSPORT_TIMEOUT_MS + 1);

    expect(await outcome).toMatchObject({
      code: 'COLLECTION_TRANSPORT_TIMEOUT',
      retryable: true,
      acknowledgementUnknown: true,
    });
    expect(abortSignal.mock.calls[0][0].aborted).toBe(true);
    expect(captured.pipeline_version).toBe(3);
    expect(captured.client_event_id).toBe('event-v3');
    expect(from).not.toHaveBeenCalled();
  });

  it('não fixa V2 quando a configuração falha e compartilha o backoff de configuração', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'RPC unavailable' } });
    const captured = event();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(processProductionCollectionBatch([captured])).rejects.toMatchObject({
        code: 'COLLECTION_PIPELINE_FLAGS_UNAVAILABLE',
        retryable: true,
      });
    }

    expect(captured.pipeline_version).toBeUndefined();
    expect(rpc).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });

  it('não considera configuração vazia como autorização para escolher V2', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const captured = event();

    await expect(processProductionCollectionBatch([captured])).rejects.toMatchObject({
      code: 'COLLECTION_PIPELINE_FLAGS_UNAVAILABLE',
      cause: { code: 'COLLECTION_PIPELINE_FLAGS_INVALID' },
    });
    expect(captured.pipeline_version).toBeUndefined();
  });

  it('mantém micro-lotes contíguos durante transição V2/V3 e não transporta por item', async () => {
    from.mockImplementation(() => ({
      insert: (rows) => ({
        select: async () => ({
          data: rows.map((row) => ({
            ...row,
            id: `receipt-${row.client_event_id}`,
            server_received_at: '2026-09-01T12:00:01.000Z',
          })),
          error: null,
        }),
      }),
    }));
    rpc.mockImplementation(async (_name, args) => ({
      data: {
        received_at_db: '2026-09-01T12:00:01.000Z',
        results: args.p_events.events.map((item) => ({ client_event_id: item.client_event_id, persisted: true })),
      },
      error: null,
    }));
    const events = [2, 2, 3, 3].map((version, index) => event({
      pipeline_version: version,
      client_event_id: `event-${index}`,
      device_sequence: 41 + index,
    }));

    const results = await processProductionCollectionBatch(events, { pipelineFlags: legacyFlags });

    expect(from).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0][1].p_events.events).toHaveLength(2);
    expect(results.map((item) => item.client_event_id)).toEqual(events.map((item) => item.client_event_id));
    expect(results.every((item) => item.transport_phase === 'database_acknowledged')).toBe(true);
  });
});

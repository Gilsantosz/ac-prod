import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// Configura o mock do IndexedDB antes de importar o módulo.
const store = new Map();
const metrics = {
  cursorReads: [],
  cursorItemsPerTransaction: [],
  deleteCalls: 0,
  deleteCallsPerTransaction: [],
  fullScanCalls: 0,
  indexDelayMs: 5,
  indexReads: [],
  openCalls: 0,
  putCalls: 0,
  putCallsPerTransaction: [],
  readwriteTransactions: 0,
};
let openBehavior = 'success';

function cancelTransactionComplete(tx) {
  if (tx.completeTimer !== null) {
    clearTimeout(tx.completeTimer);
    tx.completeTimer = null;
  }
}

function scheduleTransactionComplete(tx) {
  cancelTransactionComplete(tx);
  if (tx.pendingCursors > 0 || tx.pendingRequests > 0) return;
  tx.completeTimer = setTimeout(() => {
    tx.completeTimer = null;
    if (tx.mode === 'readwrite') {
      metrics.deleteCallsPerTransaction.push(tx.deleteCalls);
      metrics.putCallsPerTransaction.push(tx.putCalls);
      metrics.cursorItemsPerTransaction.push(tx.cursorItems);
    }
    tx.oncomplete?.();
  }, 1);
}

function createCursorRequest(tx, range, source) {
  tx.pendingCursors = (tx.pendingCursors || 0) + 1;
  metrics.cursorReads.push({ source, range });
  const keyFor = (item) => {
    if (source === 'by_status_id') return [item.status, item.client_event_id];
    if (source === 'by_status_source_created') return [item.status, item.source_mode || 'live', item.created_at_client];
    return item.client_event_id;
  };
  const compare = (a, b) => {
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        const difference = compare(a[index], b[index]);
        if (difference) return difference;
      }
      return a.length - b.length;
    }
    if (Array.isArray(a)) return 1;
    if (Array.isArray(b)) return -1;
    return String(a).localeCompare(String(b));
  };
  const eligible = Array.from(store.values())
    .filter((item) => {
      if (!range) return true;
      const lower = compare(keyFor(item), range.lower);
      const upper = range.upper === undefined ? -1 : compare(keyFor(item), range.upper);
      return (range.lowerOpen ? lower > 0 : lower >= 0)
        && (range.upperOpen ? upper < 0 : upper <= 0);
    })
    .sort((a, b) => compare(keyFor(a), keyFor(b))
      || a.client_event_id.localeCompare(b.client_event_id));
  const req = { onsuccess: null, onerror: null };
  let position = 0;

  const emitCursor = () => {
    setTimeout(() => {
      const item = eligible[position];
      if (!item) {
        req.onsuccess?.({ target: { result: null } });
        tx.pendingCursors -= 1;
        scheduleTransactionComplete(tx);
        return;
      }

      tx.cursorItems += 1;
      let continued = false;
      req.onsuccess?.({
        target: {
          result: {
            key: keyFor(item),
            primaryKey: item.client_event_id,
            value: item,
            continue: () => {
              continued = true;
              cancelTransactionComplete(tx);
              position += 1;
              emitCursor();
            },
          },
        },
      });
      if (!continued) {
        tx.pendingCursors -= 1;
        scheduleTransactionComplete(tx);
      }
    }, metrics.indexDelayMs);
  };

  emitCursor();
  return req;
}

const mockDb = {
  close: vi.fn(),
  onclose: null,
  onversionchange: null,
  transaction: (storeName, mode) => {
    const tx = {
      oncomplete: null,
      onerror: null,
      onabort: null,
      error: null,
      completeTimer: null,
      cursorItems: 0,
      deleteCalls: 0,
      putCalls: 0,
      mode,
      abort: () => {
        cancelTransactionComplete(tx);
        tx.onabort?.({ target: tx });
      },
    };
    tx.objectStore = () => ({
      put: (item) => {
        metrics.putCalls += 1;
        tx.putCalls += 1;
        store.set(item.client_event_id, item);
        scheduleTransactionComplete(tx);
      },
      get: (key) => {
        tx.pendingRequests = (tx.pendingRequests || 0) + 1;
        const req = { onsuccess: null };
        setTimeout(() => {
          tx.pendingRequests -= 1;
          scheduleTransactionComplete(tx);
          req.onsuccess?.({ target: { result: store.get(key) } });
        }, 5);
        return req;
      },
      getAll: () => {
        metrics.fullScanCalls += 1;
        const req = { onsuccess: null };
        setTimeout(() => {
          req.onsuccess?.({ target: { result: Array.from(store.values()) } });
        }, 5);
        return req;
      },
      openCursor: (range) => createCursorRequest(tx, range, 'objectStore'),
      index: (indexName) => ({
        openCursor: (range) => createCursorRequest(tx, range, indexName),
        getAll: (value) => {
          metrics.indexReads.push({ indexName, value });
          const req = { onsuccess: null };
          setTimeout(() => {
            const result = Array.from(store.values()).filter((item) => (
              indexName === 'by_status' && item.status === value
            ));
            req.onsuccess?.({ target: { result } });
          }, metrics.indexDelayMs);
          return req;
        },
      }),
      delete: (key) => {
        metrics.deleteCalls += 1;
        tx.deleteCalls += 1;
        store.delete(key);
        scheduleTransactionComplete(tx);
      },
    });
    if (mode === 'readwrite') metrics.readwriteTransactions += 1;
    return tx;
  },
};

const originalIdbKeyRange = globalThis.IDBKeyRange;
globalThis.IDBKeyRange = {
  bound: (lower, upper, lowerOpen, upperOpen) => ({ lower, upper, lowerOpen, upperOpen }),
  lowerBound: (lower, lowerOpen) => ({
    type: 'lowerBound',
    lower,
    lowerOpen,
  }),
};

const originalIndexedDb = globalThis.indexedDB;
globalThis.indexedDB = {
  open: () => {
    metrics.openCalls += 1;
    const req = {
      onblocked: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    setTimeout(() => {
      if (openBehavior === 'blocked') {
        req.onblocked?.({ target: req });
      } else if (openBehavior === 'error') {
        req.onerror?.({ target: { error: new Error('open failed') } });
      } else if (openBehavior === 'success') {
        req.onsuccess?.({ target: { result: mockDb } });
      }
    }, 5);
    return req;
  },
};

// Importa os modulos a serem testados
import {
  enqueueCollectionEvent,
  getQueueStats,
  getQueueStatsByCellMachine,
  markEventError,
  markEventProcessing,
  markEventDatabaseAcknowledged,
  markEventFinalized,
  getUnresolvedCollectionEvents,
  getPendingCollectionEvents,
  claimCollectionEventsForTransport,
  pinCollectionPipelineVersion,
  reassignFirstCollectionPipelineAttempt,
  pruneOldSynced,
  recoverStaleProcessingEvents,
  runCollectionQueueMaintenance,
  runStaleProcessingRecovery,
} from '../collectionEventQueue';
import { COLLECTION_STATES } from '../collectionStateMachine';

const originalNavigatorLocks = navigator.locks;

function setNavigatorLocks(value) {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value,
  });
}

describe('Collection Local Queue SLA & Concurrency', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mockDb.onversionchange?.();
    mockDb.onversionchange = null;
    mockDb.onclose = null;
    mockDb.close.mockClear();
    store.clear();
    localStorage.clear();
    metrics.cursorReads = [];
    metrics.cursorItemsPerTransaction = [];
    metrics.deleteCalls = 0;
    metrics.deleteCallsPerTransaction = [];
    metrics.fullScanCalls = 0;
    metrics.indexDelayMs = 5;
    metrics.indexReads = [];
    metrics.openCalls = 0;
    metrics.putCalls = 0;
    metrics.putCallsPerTransaction = [];
    metrics.readwriteTransactions = 0;
    openBehavior = 'success';
    setNavigatorLocks(undefined);
  });

  afterAll(() => {
    setNavigatorLocks(originalNavigatorLocks);
    globalThis.IDBKeyRange = originalIdbKeyRange;
    globalThis.indexedDB = originalIndexedDb;
  });

  it('reutiliza a conexão e fecha o cache ao receber versionchange', async () => {
    await getQueueStats();
    await getQueueStats();

    expect(metrics.openCalls).toBe(1);
    expect(mockDb.onversionchange).toEqual(expect.any(Function));

    mockDb.onversionchange();
    expect(mockDb.close).toHaveBeenCalledTimes(1);

    await getQueueStats();
    expect(metrics.openCalls).toBe(2);
  });

  it('falha de forma limitada e acionável quando a abertura fica bloqueada', async () => {
    const onDatabaseError = vi.fn();
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.addEventListener('collection-queue-database-error', onDatabaseError);
    openBehavior = 'blocked';

    await expect(getQueueStats()).rejects.toMatchObject({
      code: 'COLLECTION_QUEUE_DB_UPGRADE_BLOCKED',
      message: expect.stringContaining('Feche ou recarregue'),
      retryable: true,
    });
    expect(onDatabaseError).toHaveBeenCalledTimes(1);

    openBehavior = 'success';
    await expect(getQueueStats()).resolves.toMatchObject({ total: 0 });
    expect(metrics.openCalls).toBe(2);

    window.removeEventListener('collection-queue-database-error', onDatabaseError);
    consoleWarn.mockRestore();
  });

  it('grava evento localmente e mede o tempo do SLA (< 800ms)', async () => {
    const payload = {
      rawValue: 'LSM-LOT1-P001',
      cellName: 'Corte',
      operator: 'Op Teste',
      shift: '1º Turno',
      machineId: 'm-123',
      machineName: 'Corte CNC 01',
    };

    const t0 = performance.now();
    const eventId = await enqueueCollectionEvent(payload);
    const elapsed = performance.now() - t0;

    expect(eventId).toBeDefined();
    expect(elapsed).toBeLessThan(800); // Meta do SLA

    const stats = await getQueueStats();
    expect(stats.total).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.hasSlowEnqueue).toBe(false);
  });

  it('remove tokens antes do IndexedDB e persiste somente a sessão não sensível', async () => {
    const eventId = await enqueueCollectionEvent({
      client_event_id: 'event-safe',
      rawValue: '09950001',
      operator_session_id: 'operator-session-id',
      operatorSessionToken: 'top-secret',
      operator_session_token: 'snake-secret',
      payload: {
        token: 'nested-secret',
        authorization: 'Bearer secret',
        safe_context: 'preserved',
      },
    });

    expect(store.get(eventId)).toMatchObject({
      operator_session_id: 'operator-session-id',
      collection_state: COLLECTION_STATES.PENDING_DATABASE,
      status: 'pending',
      raw_value: '09950001',
      device_id: expect.any(String),
      device_sequence: expect.any(Number),
      payload: { safe_context: 'preserved' },
    });
    expect(store.get(eventId)).not.toHaveProperty('operatorSessionToken');
    expect(store.get(eventId)).not.toHaveProperty('operator_session_token');
    expect(store.get(eventId).payload).not.toHaveProperty('token');
    expect(store.get(eventId).payload).not.toHaveProperty('authorization');
  });

  it('ignora estado, tentativas e agenda forjados pelo payload de captura', async () => {
    const eventId = await enqueueCollectionEvent({
      client_event_id: 'event-canonical-capture',
      rawValue: '09950001',
      status: 'synced',
      collection_state: COLLECTION_STATES.APPROVED,
      retries: 99,
      next_attempt_at: null,
      processed_at: '2020-01-01T00:00:00.000Z',
      result: { success: true },
      last_error: 'forged',
      pipeline_version: 3,
    });

    expect(store.get(eventId)).toMatchObject({
      status: 'pending',
      collection_state: COLLECTION_STATES.PENDING_DATABASE,
      retries: 0,
      next_attempt_at: expect.any(String),
      processed_at: null,
      result: null,
      last_error: null,
      pipeline_version: null,
    });
  });

  it('fixa o pipeline antes da rede e impede troca automática posterior', async () => {
    const eventId = await enqueueCollectionEvent({
      client_event_id: 'event-pipeline-pin',
      rawValue: '09950001',
    });
    const candidate = { client_event_id: eventId };

    await pinCollectionPipelineVersion([candidate], 3);
    expect(candidate.pipeline_version).toBe(3);
    expect(store.get(eventId)).toMatchObject({ pipeline_version: 3 });

    await expect(pinCollectionPipelineVersion([candidate], 2)).rejects.toMatchObject({
      code: 'COLLECTION_PIPELINE_ASSIGNMENT_CONFLICT',
      retryable: false,
    });
    expect(store.get(eventId)).toMatchObject({ pipeline_version: 3 });
  });

  it('permite rollback da primeira tentativa antes do ACK e bloqueia depois da fronteira', async () => {
    const firstId = await enqueueCollectionEvent({
      client_event_id: 'event-first-attempt-rollback',
      rawValue: '09950001',
    });
    const firstCandidate = { client_event_id: firstId };
    await pinCollectionPipelineVersion([firstCandidate], 3);
    await reassignFirstCollectionPipelineAttempt([firstCandidate], 3, 2);
    expect(firstCandidate.pipeline_version).toBe(2);
    expect(store.get(firstId)).toMatchObject({
      pipeline_version: 2,
      pipeline_reassignment_reason: 'V3_INGRESS_DISABLED_BEFORE_PERSISTENCE',
    });

    const acknowledgedId = await enqueueCollectionEvent({
      client_event_id: 'event-acknowledged-no-rollback',
      rawValue: '09950002',
    });
    const acknowledgedCandidate = { client_event_id: acknowledgedId };
    await pinCollectionPipelineVersion([acknowledgedCandidate], 3);
    store.set(acknowledgedId, {
      ...store.get(acknowledgedId),
      collection_state: COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
    });

    await expect(reassignFirstCollectionPipelineAttempt(
      [acknowledgedCandidate],
      3,
      2,
    )).rejects.toMatchObject({
      code: 'COLLECTION_PIPELINE_REASSIGNMENT_UNSAFE',
      retryable: false,
    });
    expect(store.get(acknowledgedId)).toMatchObject({ pipeline_version: 3 });
  });

  it('filtra estatísticas por célula e máquina', async () => {
    await enqueueCollectionEvent({
      rawValue: 'P001',
      cellName: 'Corte',
      machineId: 'machine-c1',
      machineName: 'Corte CNC 01',
    });

    await enqueueCollectionEvent({
      rawValue: 'P002',
      cellName: 'Borda',
      machineId: 'machine-b1',
      machineName: 'Coladeira 01',
    });

    const corteStats = await getQueueStatsByCellMachine('Corte', 'machine-c1');
    expect(corteStats.total).toBe(1);
    expect(corteStats.pending).toBe(1);

    const bordaStats = await getQueueStatsByCellMachine('Borda', 'machine-b1');
    expect(bordaStats.total).toBe(1);

    const wrongMachineStats = await getQueueStatsByCellMachine('Corte', 'machine-b1');
    expect(wrongMachineStats.total).toBe(0);
  });

  it('isola eventos produtivos e de reposição na mesma IndexedDB', async () => {
    await enqueueCollectionEvent({ rawValue: 'P001', cellName: 'Corte', event_kind: 'production_stage' });
    await enqueueCollectionEvent({ rawValue: 'R001', cellName: 'Corte', event_kind: 'replacement_stage' });

    expect((await getQueueStatsByCellMachine('Corte', null, 'production_stage')).total).toBe(1);
    expect((await getQueueStatsByCellMachine('Corte', null, 'replacement_stage')).total).toBe(1);
  });

  it('mantém falha de rede pendente com backoff e conserva bloqueio funcional para revisão', async () => {
    const retryableId = await enqueueCollectionEvent({ rawValue: 'R001', event_kind: 'replacement_stage' });
    await markEventError(retryableId, Object.assign(new Error('rede indisponível'), { retryable: true }));
    expect(store.get(retryableId)).toMatchObject({ status: 'pending', retries: 1 });
    expect(store.get(retryableId).next_attempt_at).toBeTruthy();

    const blockedId = await enqueueCollectionEvent({ rawValue: 'R002', event_kind: 'replacement_stage' });
    await markEventError(blockedId, Object.assign(new Error('etapa anterior pendente'), {
      retryable: false,
      result: { reason_code: 'PREVIOUS_STAGE_PENDING' },
    }));
    expect(store.get(blockedId)).toMatchObject({
      status: 'error',
      last_result: { reason_code: 'PREVIOUS_STAGE_PENDING' },
    });
  });

  it('recupera eventos de processamento travados há mais de 120s', async () => {
    // Insere evento travado (processing) antigo
    const oldEventId = 'event-old';
    store.set(oldEventId, {
      client_event_id: oldEventId,
      status: 'processing',
      created_at_client: new Date(Date.now() - 150000).toISOString(),
      updated_at: new Date(Date.now() - 150000).toISOString(),
    });

    // Insere evento travado (processing) recente
    const recentEventId = 'event-recent';
    store.set(recentEventId, {
      client_event_id: recentEventId,
      status: 'processing',
      created_at_client: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const recovered = await recoverStaleProcessingEvents(120000);
    expect(recovered).toBe(1);

    const oldEvent = store.get(oldEventId);
    expect(oldEvent.status).toBe('pending');

    const recentEvent = store.get(recentEventId);
    expect(recentEvent.status).toBe('processing');
  });

  it('preserva aprovação contra erro HTTP, ACK e claim locais atrasados', async () => {
    const id = await enqueueCollectionEvent({ client_event_id: 'terminal-race', rawValue: '09906655' });
    await markEventFinalized(id, { result: { success: true, status: 'approved' } });
    await Promise.all([
      markEventError(id, Object.assign(new Error('HTTP timeout'), { retryable: true })),
      markEventProcessing(id),
      markEventDatabaseAcknowledged(id),
    ]);
    expect(store.get(id)).toMatchObject({
      status: 'synced', collection_state: 'APPROVED', retries: 0,
      result: { status: 'approved', success: true },
    });
  });

  it('recibo canônico tardio recupera erro de transporte esgotado mas não DLQ do servidor', async () => {
    const id = await enqueueCollectionEvent({ client_event_id: 'late-receipt', rawValue: '09906655' });
    await markEventError(id, Object.assign(new Error('resposta perdida'), { retryable: true }), 1);
    expect(store.get(id)).toMatchObject({ collection_state: 'DEAD_LETTERED', decision_authority: 'transport' });
    await markEventFinalized(id, { result: { status: 'approved' } });
    expect(store.get(id)).toMatchObject({ collection_state: 'APPROVED', decision_authority: 'server' });
  });

  it('enriquece no IndexedDB a aprovação do Broadcast quando o HTTP traz peça e lotes', async () => {
    const id = await enqueueCollectionEvent({ client_event_id: 'metadata-race', rawValue: '09890703',
      operator_id: 'operator-original', operator_session_id: 'session-original', machine_id: 'machine-original' });
    const compact = { decision: 'approved', reading_id: 'reading-3', lot: { id: 'lot-1' } };
    await markEventFinalized(id, { result: compact });
    const before = store.get(id);
    await markEventFinalized(id, { result: { ...compact, status: 'approved', success: true,
      item: { id: 'piece-3', traceability_code: '09890703', piece_name: 'PECA TESTE 03' },
      lot: { id: 'lot-1', lot_code: '947001', general_lot_code: 'TESTECOLETA20260907', pcp_import_batch_id: 'batch-1' },
    } });
    expect(store.get(id)).toMatchObject({ status: 'synced', collection_state: 'APPROVED',
      operator_id: 'operator-original', operator_session_id: 'session-original', machine_id: 'machine-original',
      processed_at: before.processed_at, sync_finished_at: before.sync_finished_at, retries: 0,
      result: { decision: 'approved', reading_id: 'reading-3',
        item: { traceability_code: '09890703', piece_name: 'PECA TESTE 03' },
        lot: { lot_code: '947001', general_lot_code: 'TESTECOLETA20260907' } } });
    const enriched = store.get(id);
    await markEventFinalized(id, { result: compact });
    await markEventFinalized(id, { result: { status: 'blocked', item: { piece_uid: 'WRONG' } } });
    expect(store.get(id)).toEqual(enriched);
  });

  it('não sobrescreve evento existente ao capturar o mesmo client_event_id', async () => {
    const id = await enqueueCollectionEvent({ client_event_id: 'capture-replay', rawValue: '09906655', operator_id: 'old' });
    await markEventFinalized(id, { result: { status: 'approved' } });
    await enqueueCollectionEvent({ client_event_id: id, rawValue: '99999999', operator_id: 'other' });
    expect(store.get(id)).toMatchObject({ rawValue: '09906655', operator_id: 'old', status: 'synced' });
  });

  it('não reenfileira recibos ACK/PROCESSING antigos durante recuperação', async () => {
    const old = new Date(Date.now() - 300_000).toISOString();
    for (const state of ['DATABASE_ACKNOWLEDGED', 'PROCESSING']) {
      store.set(state, { client_event_id: state, status: 'processing', collection_state: state,
        created_at_client: old, updated_at: old });
    }
    expect(await recoverStaleProcessingEvents(120000)).toBe(0);
    expect([...store.values()].every((event) => event.status === 'processing')).toBe(true);
  });

  it('claim de micro-lote usa uma transação e não recupera snapshots já reclamados', async () => {
    const now = new Date(Date.now() - 5000).toISOString();
    const events = Array.from({ length: 25 }, (_, index) => ({
      client_event_id: `claim-${index}`, status: 'pending', collection_state: 'PENDING_DATABASE',
      created_at_client: now, next_attempt_at: now,
    }));
    events.forEach((event) => store.set(event.client_event_id, event));
    const claimed = await claimCollectionEventsForTransport(events);
    expect(claimed).toHaveLength(25);
    expect(metrics.readwriteTransactions).toBe(1);
    expect(metrics.putCallsPerTransaction).toEqual([25]);
    expect(await claimCollectionEventsForTransport(events)).toHaveLength(0);
  });

  it('busca pendentes FIFO limitados sem materializar histórico sincronizado', async () => {
    for (let index = 0; index < 1000; index += 1) {
      store.set(`old-${index}`, { client_event_id: `old-${index}`, status: 'synced' });
    }
    const now = Date.now();
    for (let index = 0; index < 10; index += 1) {
      store.set(`due-${index}`, { client_event_id: `due-${index}`, status: 'pending',
        event_kind: 'production_stage', created_at_client: new Date(now - (10 - index) * 1000).toISOString() });
    }
    expect((await getPendingCollectionEvents({ limit: 3 })).map((event) => event.client_event_id))
      .toEqual(['due-0', 'due-1', 'due-2']);
    expect(metrics.fullScanCalls).toBe(0);
    expect(metrics.cursorReads).toHaveLength(2);
    expect(metrics.cursorReads[0].source).toBe('by_status_source_created');
  });

  it('compartilha snapshot concorrente e não mantém alarme de gravação histórica', async () => {
    store.set('historic-slow', { client_event_id: 'historic-slow', status: 'synced', cellName: 'Corte',
      created_at_client: new Date(Date.now() - 300_000).toISOString(), enqueue_duration_ms: 5000 });
    const [all, cell] = await Promise.all([getQueueStats(), getQueueStatsByCellMachine('Corte')]);
    expect(all).toMatchObject({ total: 1, hasSlowEnqueue: false });
    expect(cell).toMatchObject({ total: 1, hasSlowEnqueue: false });
    expect(metrics.fullScanCalls).toBe(1);
  });

  it('consulta live separadamente para não esconder novas leituras atrás de replay', async () => {
    const old = new Date(Date.now() - 5000).toISOString();
    for (let index = 0; index < 200; index += 1) {
      const id = `offline-${index}`;
      store.set(id, { client_event_id: id, status: 'pending', source_mode: 'offline_replay', created_at_client: old });
    }
    store.set('fresh-live', { client_event_id: 'fresh-live', status: 'pending', source_mode: 'live',
      created_at_client: new Date().toISOString() });
    const pending = await getPendingCollectionEvents({ limit: 25 });
    expect(pending).toHaveLength(26);
    expect(pending.some((event) => event.client_event_id === 'fresh-live')).toBe(true);
    expect(metrics.fullScanCalls).toBe(0);
  });

  it('reconciliação rotativa ultrapassa IDs ausentes e inclui recibos V2 e V3', async () => {
    const old = new Date(Date.now() - 300000).toISOString();
    for (let index = 0; index < 205; index += 1) {
      const id = `receipt-${String(index).padStart(3, '0')}`;
      store.set(id, { client_event_id: id, status: 'processing', collection_state: 'DATABASE_ACKNOWLEDGED',
        pipeline_version: index % 2 ? 2 : 3, event_kind: 'production_stage',
        created_at_client: old, database_acknowledged_at: old });
    }
    store.set('unsent', { client_event_id: 'unsent', status: 'pending', event_kind: 'production_stage',
      pipeline_version: null, created_at_client: old });
    const first = await getUnresolvedCollectionEvents({ limit: 100 });
    const second = await getUnresolvedCollectionEvents({ limit: 100 });
    const last = await getUnresolvedCollectionEvents({ limit: 100 });
    expect(first).toHaveLength(100);
    expect(second).toHaveLength(100);
    expect(last).toHaveLength(5);
    expect(new Set([...first, ...second, ...last].map((event) => event.client_event_id)).size).toBe(205);
    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(true);
    expect(last.hasMore).toBe(false);
    expect(metrics.fullScanCalls).toBe(0);
    expect([...first, ...second, ...last].some((event) => event.client_event_id === 'unsent')).toBe(false);
  });

  it('remove synced expirados por cursor com leitura e transação limitadas', async () => {
    const oldTimestamp = new Date(Date.now() - (4 * 86_400_000)).toISOString();
    const recentTimestamp = new Date(Date.now() - 60_000).toISOString();
    const records = [
      { client_event_id: 'a-synced-old', status: 'synced', processed_at: oldTimestamp },
      { client_event_id: 'b-pending-old', status: 'pending', processed_at: oldTimestamp },
      { client_event_id: 'c-synced-old', status: 'synced', processed_at: oldTimestamp },
      { client_event_id: 'd-synced-old', status: 'synced', processed_at: oldTimestamp },
      { client_event_id: 'e-synced-recent', status: 'synced', processed_at: recentTimestamp },
      { client_event_id: 'f-processing-old', status: 'processing', processed_at: oldTimestamp },
      { client_event_id: 'g-error-old', status: 'error', processed_at: oldTimestamp },
    ];
    records.forEach((record) => store.set(record.client_event_id, record));

    const firstPruned = await pruneOldSynced(3, 3);

    expect(firstPruned).toBe(2);
    expect(store.has('a-synced-old')).toBe(false);
    expect(store.has('b-pending-old')).toBe(true);
    expect(store.has('c-synced-old')).toBe(false);
    expect(store.has('d-synced-old')).toBe(true);
    expect(store.has('e-synced-recent')).toBe(true);
    expect(store.has('f-processing-old')).toBe(true);
    expect(store.has('g-error-old')).toBe(true);
    expect(metrics.indexReads).toEqual([]);
    expect(metrics.cursorReads).toHaveLength(1);
    expect(metrics.cursorReads[0]).toMatchObject({
      source: 'objectStore',
      range: undefined,
    });
    expect(metrics.fullScanCalls).toBe(0);
    expect(metrics.readwriteTransactions).toBe(1);
    expect(metrics.deleteCalls).toBe(2);
    expect(metrics.deleteCallsPerTransaction).toEqual([2]);
    expect(metrics.cursorItemsPerTransaction).toEqual([3]);

    await expect(pruneOldSynced(3, 3)).resolves.toBe(1);
    expect(store.has('d-synced-old')).toBe(false);
    expect(metrics.cursorReads).toHaveLength(2);
    expect(metrics.readwriteTransactions).toBe(2);
    expect(metrics.deleteCallsPerTransaction).toEqual([2, 1]);
    expect(metrics.cursorItemsPerTransaction).toEqual([3, 3]);

    await expect(pruneOldSynced(3, 3)).resolves.toBe(0);
    expect(metrics.cursorItemsPerTransaction).toEqual([3, 3, 1]);
  });

  it('impõe teto defensivo mesmo quando o chamador solicita uma fatia enorme', async () => {
    const oldTimestamp = new Date(Date.now() - (4 * 86_400_000)).toISOString();
    for (let index = 0; index < 260; index += 1) {
      const clientEventId = `synced-old-${String(index).padStart(3, '0')}`;
      store.set(clientEventId, {
        client_event_id: clientEventId,
        status: 'synced',
        processed_at: oldTimestamp,
      });
    }
    metrics.indexDelayMs = 0;

    await expect(pruneOldSynced(3, 10_000)).resolves.toBe(250);

    expect(store.size).toBe(10);
    expect(metrics.cursorReads).toHaveLength(1);
    expect(metrics.readwriteTransactions).toBe(1);
    expect(metrics.deleteCallsPerTransaction).toEqual([250]);
    expect(metrics.cursorItemsPerTransaction).toEqual([250]);

    // Completa o ciclo e limpa o checkpoint compartilhado para a próxima rodada.
    await expect(pruneOldSynced(3, 10_000)).resolves.toBe(10);
    expect(metrics.cursorItemsPerTransaction).toEqual([250, 10]);
  });

  it('compartilha cada fatia em voo e só inicia cooldown depois da última', async () => {
    const oldTimestamp = new Date(Date.now() - (4 * 86_400_000)).toISOString();
    store.set('synced-old', {
      client_event_id: 'synced-old',
      status: 'synced',
      processed_at: oldTimestamp,
    });
    store.set('synced-old-2', {
      client_event_id: 'synced-old-2',
      status: 'synced',
      processed_at: oldTimestamp,
    });
    store.set('synced-old-3', {
      client_event_id: 'synced-old-3',
      status: 'synced',
      processed_at: oldTimestamp,
    });
    metrics.indexDelayMs = 20;
    const onQueueChanged = vi.fn();
    window.addEventListener('collection-queue-changed', onQueueChanged);

    const first = runCollectionQueueMaintenance({ force: true, batchSize: 2 });
    const concurrent = runCollectionQueueMaintenance({ force: true, batchSize: 2 });

    expect(concurrent).toBe(first);
    await expect(first).resolves.toEqual({
      pruned: 2,
      hasMore: true,
      skipped: false,
    });
    expect(metrics.cursorReads).toHaveLength(1);
    expect(onQueueChanged).not.toHaveBeenCalled();

    await expect(runCollectionQueueMaintenance({ batchSize: 2 })).resolves.toEqual({
      pruned: 1,
      hasMore: false,
      skipped: false,
    });
    expect(metrics.cursorReads).toHaveLength(2);
    expect(metrics.deleteCallsPerTransaction).toEqual([2, 1]);
    expect(onQueueChanged).toHaveBeenCalledTimes(1);

    await expect(runCollectionQueueMaintenance({
      cooldownMs: 6 * 60 * 60 * 1000,
    })).resolves.toEqual({
      pruned: 0,
      hasMore: false,
      skipped: true,
    });
    expect(metrics.cursorReads).toHaveLength(2);
    expect(onQueueChanged).toHaveBeenCalledTimes(1);
    window.removeEventListener('collection-queue-changed', onQueueChanged);
  });

  it('não inicia prune quando outra aba detém o Web Lock de manutenção', async () => {
    const request = vi.fn((name, options, callback) => (
      Promise.resolve(callback(null))
    ));
    setNavigatorLocks({ request });

    await expect(runCollectionQueueMaintenance({ force: true })).resolves.toEqual({
      pruned: 0,
      hasMore: false,
      skipped: true,
    });

    expect(request).toHaveBeenCalledWith(
      'acprod-collection-queue-maintenance',
      { ifAvailable: true },
      expect.any(Function),
    );
    expect(metrics.cursorReads).toHaveLength(0);
    expect(metrics.readwriteTransactions).toBe(0);
  });

  it('recupera processing em fatias, consolida concorrência e só então aplica cooldown', async () => {
    const oldTimestamp = new Date(Date.now() - 150_000).toISOString();
    store.set('a-processing-stale', {
      client_event_id: 'a-processing-stale',
      status: 'processing',
      created_at_client: oldTimestamp,
      updated_at: oldTimestamp,
    });
    store.set('b-processing-recent', {
      client_event_id: 'b-processing-recent',
      status: 'processing',
      created_at_client: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    store.set('c-processing-stale', {
      client_event_id: 'c-processing-stale',
      status: 'processing',
      created_at_client: oldTimestamp,
      updated_at: oldTimestamp,
    });
    metrics.indexDelayMs = 20;
    const onQueueChanged = vi.fn();
    window.addEventListener('collection-queue-changed', onQueueChanged);

    const first = runStaleProcessingRecovery({ force: true, batchSize: 2 });
    const concurrent = runStaleProcessingRecovery({ force: true, batchSize: 2 });

    expect(concurrent).toBe(first);
    await expect(first).resolves.toBe(1);
    expect(store.get('a-processing-stale').status).toBe('pending');
    expect(store.get('b-processing-recent').status).toBe('processing');
    expect(metrics.readwriteTransactions).toBe(1);
    expect(metrics.cursorItemsPerTransaction).toEqual([2]);
    expect(metrics.putCallsPerTransaction).toEqual([1]);
    expect(metrics.fullScanCalls).toBe(0);
    expect(metrics.indexReads).toEqual([]);
    expect(onQueueChanged).not.toHaveBeenCalled();

    await expect(runStaleProcessingRecovery({ batchSize: 2 })).resolves.toBe(1);
    expect(store.get('c-processing-stale').status).toBe('pending');
    expect(metrics.cursorItemsPerTransaction).toEqual([2, 1]);
    expect(metrics.putCallsPerTransaction).toEqual([1, 1]);
    expect(onQueueChanged).toHaveBeenCalledTimes(1);

    await expect(runStaleProcessingRecovery({ cooldownMs: 60_000 }))
      .resolves.toBe(0);
    expect(metrics.cursorReads).toHaveLength(2);
    window.removeEventListener('collection-queue-changed', onQueueChanged);
  });
});

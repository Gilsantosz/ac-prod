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
  metrics.cursorReads.push({ source, range });
  const eligible = Array.from(store.values())
    .filter((item) => {
      if (!range || range.type !== 'lowerBound') return true;
      const comparison = item.client_event_id.localeCompare(String(range.lower));
      return range.lowerOpen ? comparison > 0 : comparison >= 0;
    })
    .sort((a, b) => a.client_event_id.localeCompare(b.client_event_id));
  const req = { onsuccess: null, onerror: null };
  let position = 0;

  const emitCursor = () => {
    setTimeout(() => {
      const item = eligible[position];
      scheduleTransactionComplete(tx);
      if (!item) {
        req.onsuccess?.({ target: { result: null } });
        return;
      }

      tx.cursorItems += 1;
      req.onsuccess?.({
        target: {
          result: {
            key: item.client_event_id,
            primaryKey: item.client_event_id,
            value: item,
            continue: () => {
              cancelTransactionComplete(tx);
              position += 1;
              emitCursor();
            },
          },
        },
      });
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
    };
    tx.objectStore = () => ({
      put: (item) => {
        metrics.putCalls += 1;
        tx.putCalls += 1;
        store.set(item.client_event_id, item);
        scheduleTransactionComplete(tx);
      },
      get: (key) => {
        const req = { onsuccess: null };
        setTimeout(() => {
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
  pruneOldSynced,
  recoverStaleProcessingEvents,
  runCollectionQueueMaintenance,
  runStaleProcessingRecovery,
} from '../collectionEventQueue';

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

import { describe, expect, it, beforeEach } from 'vitest';

// Configura o Mock do IndexedDB antes de importar o modulo
const store = new Map();

const mockDb = {
  transaction: (storeName, mode) => {
    const tx = {
      objectStore: () => ({
        put: (item) => {
          store.set(item.client_event_id, item);
          setTimeout(() => {
            if (tx.oncomplete) tx.oncomplete();
          }, 5);
        },
        get: (key) => {
          const req = { onsuccess: null };
          setTimeout(() => {
            if (req.onsuccess) req.onsuccess({ target: { result: store.get(key) } });
          }, 5);
          return req;
        },
        getAll: () => {
          const req = { onsuccess: null };
          setTimeout(() => {
            if (req.onsuccess) req.onsuccess({ target: { result: Array.from(store.values()) } });
          }, 5);
          return req;
        },
        index: (indexName) => ({
          getAll: (val) => {
            const req = { onsuccess: null };
            setTimeout(() => {
              const res = Array.from(store.values()).filter(item => {
                if (indexName === 'by_status') return item.status === val;
                if (indexName === 'by_created') return item.created_at_client === val;
                return false;
              });
              if (req.onsuccess) req.onsuccess({ target: { result: res } });
            }, 5);
            return req;
          }
        }),
        delete: (key) => {
          store.delete(key);
          setTimeout(() => {
            if (tx.oncomplete) tx.oncomplete();
          }, 5);
        }
      }),
      oncomplete: null,
      onerror: null,
    };
    return tx;
  }
};

globalThis.indexedDB = {
  open: () => {
    const req = {
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    setTimeout(() => {
      if (req.onsuccess) req.onsuccess({ target: { result: mockDb } });
    }, 5);
    return req;
  }
};

// Importa os modulos a serem testados
import {
  enqueueCollectionEvent,
  getQueueStats,
  getQueueStatsByCellMachine,
  recoverStaleProcessingEvents,
} from '../collectionEventQueue';

describe('Collection Local Queue SLA & Concurrency', () => {
  beforeEach(() => {
    store.clear();
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
});

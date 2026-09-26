import { describe, expect, it } from 'vitest';
import { COLLECTION_STATES } from '@/lib/collectionStateMachine';
import { applyCollectionTerminalResultToCache, collectionHistoryRowFromTerminalResult, collectionSnapshotIsBehindDecision, collectionSnapshotMatchesPendingLot, preserveCollectionSnapshotIdentity } from '@/lib/collectionLocalProjection';

function createQueryClient(entries) {
  const cache = entries.map(([queryKey, data]) => ({ queryKey, data }));
  return {
    cache,
    setQueriesData(filters, updater) {
      cache.forEach((entry) => {
        if (filters.predicate({ queryKey: entry.queryKey })) {
          entry.data = updater(entry.data);
        }
      });
    },
  };
}

function approvedPayload() {
  return {
    state: COLLECTION_STATES.APPROVED,
    event: {
      client_event_id: 'event-001',
      raw_value: '09950101',
      quantity: 1,
      cellId: 'cell-corte',
      cellName: 'Corte',
      machineId: 'machine-corte',
      machineName: 'Nanshing',
      operatorId: 'operator-corte',
      operator: 'Operador Corte',
      shift: '1º Turno',
    },
    result: {
      client_event_id: 'event-001',
      status: 'approved',
      message: 'Leitura aprovada.',
      lot: {
        id: 'lot-client-1',
        lot_code: 'CLI-001',
        pcp_import_batch_id: 'batch-1',
        general_lot_code: 'GER-001',
      },
      general_lot: { id: 'batch-1', general_lot_code: 'GER-001' },
      order: { order_number: 'OP-001', customer_name: 'Cliente E2E' },
      item: { id: 'piece-001', piece_uid: '09950101' },
      route: { step_name: 'Corte', cell_name: 'Corte' },
      reading: { id: 'reading-001', created_at: new Date().toISOString() },
    },
  };
}

describe('projeção local de decisão terminal', () => {
  it('recusa a projeção anterior mesmo quando a consulta começa depois do ACK', () => {
    const queryClient = createQueryClient([[['collection-kpis', 'Corte', 'machine-corte'], {
      approved: 20, active_context: { active_pcp_import_batch_id: 'batch-1', active_lot_id: 'old-client' },
    }]]);
    const payload = approvedPayload();
    payload.result.committed_at = new Date().toISOString();
    applyCollectionTerminalResultToCache(queryClient, payload, new Set());
    const confirmed = queryClient.cache[0].data;
    expect(confirmed).toMatchObject({ approved: 21, active_context: { active_lot_code: 'CLI-001' } });
    const older = { approved: 20, active_context: {
      active_pcp_import_batch_id: 'batch-1', active_lot_id: 'old-client',
      source_client_event_id: 'older-event', last_event_occurred_at: '2020-01-01T00:00:00Z',
    } };
    expect(collectionSnapshotIsBehindDecision(confirmed, older)).toBe(true);
    expect(collectionSnapshotIsBehindDecision(confirmed, { active_context: null })).toBe(true);
    expect(collectionSnapshotIsBehindDecision(confirmed, { active_context: {
      source_client_event_id: 'event-001',
    } })).toBe(false);
    expect(collectionSnapshotIsBehindDecision(confirmed, { active_context: {
      source_client_event_id: 'newer-station-event',
      last_event_occurred_at: new Date(Date.parse(payload.result.committed_at) + 1).toISOString(),
    } })).toBe(false);
    expect(collectionSnapshotIsBehindDecision(confirmed, older, confirmed._collection_context_received_at + 30_000)).toBe(false);
    expect(collectionSnapshotIsBehindDecision({}, older)).toBe(false);
  });
  it('exibe a etapa coletada do recibo V3 separada da próxima etapa da peça', () => {
    const row = collectionHistoryRowFromTerminalResult({
      event: { client_event_id: 'v3-event', cellName: 'Bordo' },
      result: { status: 'approved', step_code: 'edge', reading_id: 'reading-v3',
        item: { current_stage: 'separation', route_steps: ['cut', 'edge', 'separation'], completed_steps: ['cut', 'edge'] } },
    });
    expect(row).toMatchObject({ id: 'reading-v3', operation_name: 'edge', reading_stage_name: 'edge',
      current_stage_name: 'edge', piece_current_stage: 'separation',
      route_steps: ['cut', 'edge', 'separation'], completed_steps: ['cut', 'edge'] });
    expect(collectionHistoryRowFromTerminalResult({
      event: { client_event_id: 'legacy-event', cellName: 'Corte' },
      result: { status: 'approved', item: { current_stage: 'edge' } },
    }).operation_name).toBe('Corte');
  });

  it('preserva somente os nomes do mesmo lote quando o snapshot vem incompleto', () => {
    const previous = { approved: 2, active_context: { active_lot_id: 'client-1',
      active_lot_code: 'CLI-001', active_general_lot_code: 'GER-001', customer_name: 'Cliente A', progress_percent: 50 } };
    const incoming = { approved: 3, active_context: { active_lot_id: 'client-1',
      active_lot_code: 'CLI-001', active_general_lot_code: null, customer_name: null, progress_percent: null } };
    expect(preserveCollectionSnapshotIdentity(previous, incoming)).toMatchObject({ approved: 3,
      active_context: { active_general_lot_code: 'GER-001', customer_name: 'Cliente A', progress_percent: null } });
    for (const context of [null, {}, { active_lot_id: 'client-2' },
      { active_lot_id: 'client-1', active_general_lot_code: 'GER-002' }]) {
      const changed = { active_context: context };
      expect(preserveCollectionSnapshotIdentity(previous, changed)).toBe(changed);
    }
    const changedBatch = { active_context: { active_lot_id: 'client-1', active_pcp_import_batch_id: 'batch-2' } };
    expect(preserveCollectionSnapshotIdentity({ active_context: {
      ...previous.active_context, active_pcp_import_batch_id: 'batch-1',
    } }, changedBatch)).toBe(changedBatch);
  });

  it('atualiza histórico e KPIs uma vez sem invalidar ou consultar o servidor', () => {
    const queryClient = createQueryClient([
      [['stageReadings', 'Corte', null, 'cell-corte', null, '1º Turno', '24h', 'all', 50], {
        readings: [], totalCount: 0,
      }],
      [['collection-kpis', 'Corte', 'machine-corte', '1º Turno', 'from', 'to', 'batch-1'], {
        expected: 100, approved: 20, pending: 79, rejected: 1,
        active_context: { active_pcp_import_batch_id: 'batch-1' },
      }],
      [['operator-shift-kpis', 'operator-corte', '1º Turno', 'from', 'to'], {
        approved: 20, rejected: 1, blocked: 0,
      }],
    ]);
    const seen = new Set();
    const payload = approvedPayload();

    expect(applyCollectionTerminalResultToCache(queryClient, payload, seen)).toBe(true);
    expect(applyCollectionTerminalResultToCache(queryClient, payload, seen)).toBe(false);

    expect(queryClient.cache[0].data).toMatchObject({
      totalCount: 1,
      readings: [{
        client_event_id: 'event-001',
        traceability_code: '09950101',
        reading_status: 'approved',
        lot_code: 'CLI-001',
        pcp_batch_name: 'GER-001',
      }],
    });
    expect(queryClient.cache[1].data).toMatchObject({
      approved: 21,
      pending: 78,
      active_context: {
        active_pcp_import_batch_id: 'batch-1',
        active_general_lot_code: 'GER-001',
        active_lot_id: 'lot-client-1',
        active_lot_code: 'CLI-001',
        customer_name: 'Cliente E2E',
      },
    });
    expect(queryClient.cache[2].data).toMatchObject({ approved: 21, rejected: 1, blocked: 0 });
  });

  it('não altera caches de outra célula, máquina ou operador', () => {
    const initialHistory = { readings: [], totalCount: 0 };
    const initialKpis = { approved: 7, pending: 9 };
    const initialShift = { approved: 3, rejected: 0, blocked: 0 };
    const queryClient = createQueryClient([
      [['stageReadings', 'Bordo', 'machine-bordo', 'cell-bordo', null, '1º Turno', '24h', 'all', 50], initialHistory],
      [['collection-kpis', 'Bordo', 'machine-bordo'], initialKpis],
      [['operator-shift-kpis', 'operator-bordo', '1º Turno'], initialShift],
    ]);

    applyCollectionTerminalResultToCache(queryClient, approvedPayload(), new Set());

    expect(queryClient.cache.map((entry) => entry.data)).toEqual([
      initialHistory,
      initialKpis,
      initialShift,
    ]);
  });

  it('registra duplicidade no histórico sem inflar produção aprovada', () => {
    const queryClient = createQueryClient([
      [['stageReadings', 'Corte', null, 'cell-corte', null, '1º Turno', '24h', 'all', 50], {
        readings: [], totalCount: 0,
      }],
      [['collection-kpis', 'Corte', 'machine-corte'], {
        approved: 20, pending: 79, blocked: 0,
        active_context: { active_pcp_import_batch_id: 'batch-1' },
      }],
    ]);
    const payload = approvedPayload();
    payload.state = COLLECTION_STATES.DUPLICATED;
    payload.result.status = 'duplicated';

    applyCollectionTerminalResultToCache(queryClient, payload, new Set());

    expect(queryClient.cache[0].data.readings[0].reading_status).toBe('duplicated');
    expect(queryClient.cache[1].data).toMatchObject({ approved: 20, pending: 79, blocked: 0 });
  });

  it('troca o lote sem transferir contagens, progresso ou cliente do lote anterior', () => {
    const queryClient = createQueryClient([
      [['collection-kpis', 'Corte', 'machine-corte'], {
        expected: 500, approved: 450, pending: 50, rejected: 0,
        active_context: {
          active_pcp_import_batch_id: 'batch-anterior', active_lot_id: 'cliente-anterior',
          active_lot_code: 'CLI-ANTERIOR', customer_name: 'Cliente anterior', progress_percent: 90,
        },
      }],
    ]);
    const payload = approvedPayload();
    delete payload.result.order;
    applyCollectionTerminalResultToCache(queryClient, payload, new Set());
    const projected = queryClient.cache[0].data;
    expect(projected).toMatchObject({ expected: null, approved: null, pending: null, lot_kpis_stale: true });
    expect(projected.active_context).toMatchObject({ active_pcp_import_batch_id: 'batch-1', active_lot_code: 'CLI-001' });
    expect(projected.active_context.progress_percent).toBeUndefined();
    expect(projected.active_context.customer_name).toBeUndefined();

    // Mais uma confirmação do mesmo lote não inventa uma base parcial.
    payload.event.client_event_id = 'event-002';
    payload.result.client_event_id = 'event-002';
    applyCollectionTerminalResultToCache(queryClient, payload, new Set());
    expect(queryClient.cache[0].data).toMatchObject({ approved: null, pending: null, lot_kpis_stale: true });
  });

  it('rejeita snapshot atrasado durante a transição e limita a janela de espera', () => {
    const previous = { lot_kpis_stale: true, lot_kpis_pending_since: 1000,
      active_context: { active_pcp_import_batch_id: 'batch-1' } };
    const oldSnapshot = { active_context: { active_pcp_import_batch_id: 'batch-anterior' } };
    const currentSnapshot = { active_context: { active_pcp_import_batch_id: 'batch-1' } };
    expect(collectionSnapshotMatchesPendingLot(previous, oldSnapshot, 2000)).toBe(false);
    expect(collectionSnapshotMatchesPendingLot(previous, currentSnapshot, 2000)).toBe(true);
    expect(collectionSnapshotMatchesPendingLot(previous, oldSnapshot, 31000)).toBe(true);
    expect(collectionSnapshotMatchesPendingLot({}, oldSnapshot, 2000)).toBe(true);
  });

  it('trocar somente o pedido preserva os totais do lote geral', () => {
    const queryClient = createQueryClient([
      [['collection-kpis', 'Corte', 'machine-corte'], {
        expected: 100, approved: 20, pending: 79, rejected: 1,
        active_context: { active_pcp_import_batch_id: 'batch-1', active_lot_id: 'outro-cliente',
          customer_name: 'Cliente anterior', progress_percent: 20 },
      }],
    ]);
    const payload = approvedPayload();
    delete payload.result.order;
    applyCollectionTerminalResultToCache(queryClient, payload, new Set());
    expect(queryClient.cache[0].data).toMatchObject({ approved: 21, pending: 78,
      active_context: { active_lot_id: 'lot-client-1', progress_percent: 20 } });
    expect(queryClient.cache[0].data.lot_kpis_stale).toBeUndefined();
    expect(queryClient.cache[0].data.active_context.customer_name).toBeUndefined();
  });

  it('completa metadados que chegam após o ACK sem contar a mesma peça novamente', () => {
    const queryClient = createQueryClient([
      [['stageReadings', 'Corte', null, 'cell-corte', null, '1º Turno', '24h', 'all', 50], {
        readings: [], totalCount: 0,
      }],
      [['collection-kpis', 'Corte', 'machine-corte'], {
        expected: 100, approved: 20, pending: 79, rejected: 1,
        active_context: { active_pcp_import_batch_id: 'batch-1' },
      }],
      [['operator-shift-kpis', 'operator-corte', '1º Turno'], { approved: 20 }],
    ]);
    const seen = new Set();
    const compact = approvedPayload();
    delete compact.result.lot;
    delete compact.result.general_lot;
    delete compact.result.order;
    applyCollectionTerminalResultToCache(queryClient, compact, seen);
    const enriched = { ...approvedPayload(), enrichmentOnly: true };
    applyCollectionTerminalResultToCache(queryClient, enriched, seen);
    expect(queryClient.cache[0].data).toMatchObject({ totalCount: 1,
      readings: [{ lot_code: 'CLI-001', pcp_batch_name: 'GER-001' }] });
    expect(queryClient.cache[1].data).toMatchObject({ approved: 21, pending: 78,
      active_context: { active_lot_code: 'CLI-001', customer_name: 'Cliente E2E' } });
    expect(queryClient.cache[2].data.approved).toBe(21);
  });

  it('enriquece a leitura antiga sem reverter o lote de uma decisão mais recente', () => {
    const queryClient = createQueryClient([
      [['stageReadings', 'Corte', null, 'cell-corte', null, '1º Turno', '24h', 'all', 50], {
        readings: [], totalCount: 0,
      }],
      [['collection-kpis', 'Corte', 'machine-corte'], {
        approved: 20, pending: 79,
        active_context: { active_pcp_import_batch_id: 'batch-1' },
      }],
    ]);
    const seen = new Set();
    const first = approvedPayload();
    first.event.created_at_client = '2026-09-13T10:00:00Z';
    const compact = { ...first, result: { ...first.result } };
    delete compact.result.lot;
    delete compact.result.general_lot;
    delete compact.result.order;
    applyCollectionTerminalResultToCache(queryClient, compact, seen);

    const second = approvedPayload();
    second.event.client_event_id = second.result.client_event_id = 'event-002';
    second.event.created_at_client = '2026-09-13T10:00:01Z';
    second.result.reading.id = 'reading-002';
    second.result.lot = { id: 'client-2', lot_code: 'CLI-002', pcp_import_batch_id: 'batch-2' };
    second.result.general_lot = { id: 'batch-2', general_lot_code: 'GER-002' };
    applyCollectionTerminalResultToCache(queryClient, second, seen);
    const context = queryClient.cache[1].data.active_context;
    const pendingSince = queryClient.cache[1].data.lot_kpis_pending_since;

    applyCollectionTerminalResultToCache(queryClient, { ...first, enrichmentOnly: true }, seen);
    expect(queryClient.cache[0].data.readings.find((row) => row.client_event_id === 'event-001'))
      .toMatchObject({ lot_code: 'CLI-001', pcp_batch_name: 'GER-001' });
    expect(queryClient.cache[1].data.active_context).toEqual(context);
    expect(queryClient.cache[1].data.lot_kpis_pending_since).toBe(pendingSince);

    // O mesmo recibo continua antigo depois que o servidor reconciliar B e
    // substituir os marcadores locais presentes na fotografia anterior.
    queryClient.cache[1].data = { approved: 5, pending: 10,
      active_context: { active_pcp_import_batch_id: 'batch-2', active_lot_code: 'CLI-002' } };
    applyCollectionTerminalResultToCache(queryClient, { ...first, enrichmentOnly: true }, seen);
    expect(queryClient.cache[1].data).toEqual({ approved: 5, pending: 10,
      active_context: { active_pcp_import_batch_id: 'batch-2', active_lot_code: 'CLI-002' } });
  });

  it('aceita enriquecimento da decisão compacta mais recente sobre um contexto anterior', () => {
    const queryClient = createQueryClient([
      [['collection-kpis', 'Corte', 'machine-corte'], {
        approved: 20, pending: 79,
        active_context: { active_pcp_import_batch_id: 'batch-anterior', source_client_event_id: 'event-anterior' },
        _collection_context_event_id: 'event-anterior',
        _collection_context_event_at: Date.parse('2026-09-13T09:00:00Z'),
      }],
    ]);
    const seen = new Set(['event-anterior']);
    const payload = approvedPayload();
    payload.event.created_at_client = '2026-09-13T10:00:00Z';
    const compact = { ...payload, result: { ...payload.result } };
    delete compact.result.lot;
    delete compact.result.general_lot;
    applyCollectionTerminalResultToCache(queryClient, compact, seen);
    applyCollectionTerminalResultToCache(queryClient, { ...payload, enrichmentOnly: true }, seen);
    expect(queryClient.cache[0].data.active_context).toMatchObject({
      active_pcp_import_batch_id: 'batch-1', active_lot_code: 'CLI-001',
      source_client_event_id: 'event-001',
    });
  });

  it('decisão regular atrasada preserva o contexto e soma somente contadores elegíveis', () => {
    const queryClient = createQueryClient([
      [['collection-kpis', 'Corte', 'machine-corte'], {
        approved: 20, pending: 79,
        active_context: { active_pcp_import_batch_id: 'batch-1', active_lot_code: 'CLI-NOVO' },
        _collection_context_event_id: 'event-novo',
        _collection_context_event_at: Date.parse('2026-09-13T11:00:00Z'),
      }],
      [['operator-shift-kpis', 'operator-corte', '1º Turno'], { approved: 20 }],
    ]);
    const payload = approvedPayload();
    payload.event.created_at_client = '2026-09-13T10:00:00Z';
    applyCollectionTerminalResultToCache(queryClient, payload, new Set());
    expect(queryClient.cache[0].data).toMatchObject({ approved: 21, pending: 78,
      active_context: { active_lot_code: 'CLI-NOVO' } });
    expect(queryClient.cache[1].data.approved).toBe(21);

    payload.event.client_event_id = payload.result.client_event_id = 'event-outro-lote';
    payload.result.lot.pcp_import_batch_id = 'batch-antigo';
    payload.result.general_lot.id = 'batch-antigo';
    applyCollectionTerminalResultToCache(queryClient, payload, new Set());
    expect(queryClient.cache[0].data).toMatchObject({ approved: 21, pending: 78,
      active_context: { active_pcp_import_batch_id: 'batch-1', active_lot_code: 'CLI-NOVO' } });
    expect(queryClient.cache[1].data.approved).toBe(22);
  });

  it('não soma ACK atrasado sobre snapshot que já pode conter o evento confirmado', () => {
    const snapshotCompletedAt = Date.now();
    const queryClient = createQueryClient([
      [['collection-kpis', 'Corte', 'machine-corte'], {
        expected: 100, approved: 21, pending: 78, rejected: 1,
        _collection_snapshot_completed_at: snapshotCompletedAt,
        active_context: { active_pcp_import_batch_id: 'batch-1' },
      }],
      [['operator-shift-kpis', 'operator-corte', '1º Turno'], {
        approved: 21, _collection_snapshot_completed_at: snapshotCompletedAt,
      }],
    ]);
    const payload = approvedPayload();
    payload.event.created_at_client = new Date(snapshotCompletedAt - 1_000).toISOString();
    const seen = new Set();
    applyCollectionTerminalResultToCache(queryClient, payload, seen);
    expect(queryClient.cache[0].data).toMatchObject({ approved: 21, pending: 78, counter_reconciliation_required: true });
    expect(queryClient.cache[1].data.approved).toBe(21);

    // A captura que começou depois do snapshot é inequivocamente nova.
    payload.event.client_event_id = 'event-after-snapshot';
    payload.result.client_event_id = 'event-after-snapshot';
    payload.event.created_at_client = new Date(snapshotCompletedAt + 1_000).toISOString();
    applyCollectionTerminalResultToCache(queryClient, payload, seen);
    expect(queryClient.cache[0].data).toMatchObject({ approved: 22, pending: 77 });
    expect(queryClient.cache[1].data.approved).toBe(22);
  });

  it('usa a identidade do evento já projetado e a leitura canônica para evitar duplicação', () => {
    const queryClient = createQueryClient([
      [['stageReadings', 'Corte', null, 'cell-corte', null, '1º Turno', '24h', 'all', 50], {
        readings: [{ id: 'reading-001', reading_status: 'approved' }], totalCount: 1,
      }],
      [['collection-kpis', 'Corte', 'machine-corte'], {
        approved: 21, pending: 78,
        active_context: { active_pcp_import_batch_id: 'batch-1', source_client_event_id: 'event-001' },
      }],
    ]);
    applyCollectionTerminalResultToCache(queryClient, approvedPayload(), new Set());
    expect(queryClient.cache[0].data.totalCount).toBe(1);
    expect(queryClient.cache[0].data.readings).toHaveLength(1);
    expect(queryClient.cache[0].data.readings[0].client_event_id).toBe('event-001');
    expect(queryClient.cache[1].data).toMatchObject({ approved: 21, pending: 78 });
  });
});

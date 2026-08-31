import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('AC.Prod2 collection async synchronization v8.9.1 contract', () => {
  const syncMigration =
    'supabase/migrations/20260831225902_collection_sync_reconciliation_v8_9.sql';
  const shiftMigration =
    'supabase/migrations/20260831230439_optimize_operator_shift_window_v8_9_1.sql';

  it('mantém inbox assíncrono, worker acelerado e fallback de cinco segundos', () => {
    expect(existsSync(resolve(process.cwd(), syncMigration))).toBe(true);
    const migration = repoFile(syncMigration);

    expect(migration).toContain('idx_coletas_producao_worker_claim_v89');
    expect(migration).toContain('production_collection_events');
    expect(migration).toContain("'concurrency', 8");
    expect(migration).toContain("'max_rounds', 5");
    expect(migration).toContain("'5 seconds'");
    expect(migration).toContain('get_public_collection_sync_release');
    expect(migration).toContain('20260831_acprod_collection_sync_v8_9');
  });

  it('elimina a varredura do catálogo de fusos no KPI de turno', () => {
    expect(existsSync(resolve(process.cwd(), shiftMigration))).toBe(true);
    const migration = repoFile(shiftMigration);

    expect(migration).toContain('resolve_operator_shift_window');
    expect(migration).toContain('EXCEPTION WHEN invalid_parameter_value');
    expect(migration).not.toContain('FROM pg_catalog.pg_timezone_names');
    expect(migration).toContain('collection_sync_shift_window_constant_time');
    expect(migration).toContain('20260831_acprod_collection_sync_v8_9_1');
  });

  it('não confunde ACK recebida com decisão produtiva final', () => {
    const service = repoFile('src/lib/collectionBatchService.js');
    const queue = repoFile('src/lib/collectionMicroBatchQueue.js');

    expect(service).toContain(".from('coletas_producao')");
    expect(service).toContain('.insert(rows)');
    expect(service).toContain("status_sincronizacao: 'recebida'");
    expect(service).toContain('const result = row?.resultado || null');
    expect(queue).toContain("['recebida', 'processando'].includes(serverStatus)");
    expect(queue).toContain('markEventsAccepted');
    expect(queue).toContain("serverStatus === 'sincronizada'");
  });

  it('reconcilia resultado final por Realtime e polling em lote', () => {
    const reconciler = repoFile('src/lib/collectionInboxReconciler.js');

    expect(reconciler).toContain('applyCollectionInboxRows');
    expect(reconciler).toContain('getCollectionEvents');
    expect(reconciler).toContain('pendingRows = new Map()');
    expect(reconciler).toContain("event: 'UPDATE'");
    expect(reconciler).toContain('reconcileAcceptedCollectionEvents');
    expect(reconciler).toContain('POLL_CHUNK_SIZE = 100');
  });

  it('protege a fila local contra corrida e limita seu crescimento', () => {
    const queue = repoFile('src/lib/collectionEventQueue.js');

    expect(queue).toContain('dbTransformMany');
    expect(queue).toContain('uma única transação readwrite');
    expect(queue).toContain('getCollectionEvents');
    expect(queue).toContain('pruneSettledEvents');
    expect(queue).toContain("status: 'accepted'");
    expect(queue).toContain('withoutOperationalSecrets');
    expect(queue).not.toContain('dbPut({ ...event, enqueue_duration_ms: elapsed })');
  });

  it('reduz operações periódicas e coalesce atualização da interface', () => {
    const hook = repoFile('src/hooks/useCollectionQueue.js');
    const queryKeys = repoFile('src/config/queryKeys.js');
    const service = repoFile('src/lib/collectionService.js');

    expect(hook).toContain('(microBatch ? 500 : 15_000)');
    expect(hook).toContain('reconcileIntervalMs = options.reconcileIntervalMs ?? 1000');
    expect(hook).toContain('statsRefreshTimerRef');
    expect(hook).toContain('30_000');
    expect(hook).toContain('pruneSettledEvents');
    expect(hook).toContain('não bloqueia o próximo código');
    expect(queryKeys).toContain('INVALIDATION_WINDOW_MS = 750');
    expect(service).toContain('collectionServiceCore');
    expect(service).toContain('REALTIME_COALESCE_MS = 250');
    expect(service).toContain('get_collection_dashboard_snapshot_v2');
    expect(service).toContain('get_operator_shift_kpis_v2');
  });

  it('entrega o worker Edge Function versionado sem chave no cliente', () => {
    const worker = repoFile(
      'supabase/functions/process-collection-inbox/index.ts',
    );
    const deno = repoFile(
      'supabase/functions/process-collection-inbox/deno.json',
    );

    expect(worker).toContain('claim_collection_inbox');
    expect(worker).toContain('process_collection_inbox_item');
    expect(worker).toContain('verify_collection_worker_cron_secret');
    expect(worker).toContain('mapWithConcurrency');
    expect(worker).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(worker).not.toContain('service_role=');
    expect(deno).toContain('"strict": true');
  });

  it('impede publicação se banco e front não estiverem no v8.9.1', () => {
    const workflow = repoFile('.github/workflows/deploy.yml');

    expect(workflow).toContain(
      'REQUIRED_SYNC_MIGRATION_VERSION: "20260831230439"',
    );
    expect(workflow).toContain(
      'REQUIRED_SYNC_RELEASE_VERSION: "20260831_acprod_collection_sync_v8_9_1"',
    );
    expect(workflow).toContain('get_public_collection_sync_release');
    expect(workflow).toContain('ASYNC_SYNC_RELEASE_OK');
    expect(workflow).toContain('collection_sync_shift_window_constant_time');
    expect(workflow).toContain('collection_sync_fallback_five_seconds');
  });
});

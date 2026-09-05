import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readRepoFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('AC.Prod2 asynchronous collection v9.2.3 contract', () => {
  const migrationPath =
    'supabase/migrations/20260831232032_collection_worker_idle_guard_v9_2.sql';

  it('versiona a cadeia assíncrona incremental presente no ledger de produção', () => {
    const migrationPaths = [
      'supabase/migrations/20260831221753_collection_async_inbox_worker_v8_7.sql',
      'supabase/migrations/20260831223614_collection_async_release_probe_v8_7_1.sql',
      'supabase/migrations/20260831224808_collection_async_payload_dashboard_v8_8.sql',
      'supabase/migrations/20260831224837_collection_async_kpis_worker_v8_8.sql',
      'supabase/migrations/20260831225000_collection_async_sync_v8_8.sql',
      'supabase/migrations/20260831234332_collection_sync_release_v9_2_1.sql',
      'supabase/migrations/20260901025000_collection_runtime_health_v9_2_2.sql',
      'supabase/migrations/20260901032000_collection_runtime_health_security_v9_2_3.sql',
    ];

    migrationPaths.forEach((path) => {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(true);
    });

    const workerBase = readRepoFile(migrationPaths[0]);
    const asyncProbe = readRepoFile(migrationPaths[1]);
    const asyncRelease = readRepoFile(migrationPaths[4]);
    const syncRelease = readRepoFile(migrationPaths[5]);
    const runtimeHealth = readRepoFile(migrationPaths[7]);

    expect(workerBase).toContain('CREATE OR REPLACE FUNCTION public.claim_collection_inbox');
    expect(workerBase).toContain('CREATE OR REPLACE FUNCTION public.process_collection_inbox_item');
    expect(workerBase).toContain('lease_expires_at');
    expect(asyncProbe).toContain('CREATE OR REPLACE FUNCTION public.get_public_collection_async_release');
    expect(asyncRelease).toContain('20260831_acprod_collection_async_sync_v8_8');
    expect(syncRelease).toContain('CREATE OR REPLACE FUNCTION public.get_public_collection_sync_release');
    expect(syncRelease).toContain('20260831_acprod_collection_sync_v9_2_1');
    expect(runtimeHealth).toContain(
      'CREATE OR REPLACE FUNCTION public.get_public_collection_runtime_health',
    );
    expect(runtimeHealth).toContain(
      '20260901_acprod_collection_runtime_health_security_v9_2_3',
    );
  });

  it('recalcula a saúde real sem confiar no snapshot persistido do v8.8', () => {
    const migration = readRepoFile(
      'supabase/migrations/20260901032000_collection_runtime_health_security_v9_2_3.sql',
    );
    const probeDefinition = migration
      .split('CREATE OR REPLACE FUNCTION public.get_public_collection_runtime_health', 2)[1]
      .split('$runtime_health$;', 1)[0];

    expect(probeDefinition).toContain('pg_get_functiondef');
    expect(probeDefinition).toContain('pg_get_triggerdef');
    expect(probeDefinition).toContain('has_function_privilege');
    expect(probeDefinition).toContain('has_table_privilege');
    expect(probeDefinition).toContain('pg_publication_tables');
    expect(probeDefinition).toContain('vault.decrypted_secrets');
    expect(probeDefinition).toContain('cron.job');
    expect(probeDefinition).toContain('pg_index');
    expect(probeDefinition).toContain("'snapshot_used', false");
    expect(probeDefinition).toContain("'health_source', 'runtime_catalog'");
    expect(probeDefinition).toContain("'collection_runtime_worker_timeout_30s'");
    expect(probeDefinition).toContain('timeout_milliseconds := 30000');
    expect(probeDefinition).not.toContain('FROM public.app_schema_releases');
    expect(probeDefinition).not.toContain(
      'SELECT public.get_public_collection_async_release',
    );
    expect(migration).not.toContain(
      'CREATE OR REPLACE FUNCTION public.get_public_collection_async_release',
    );
    expect(migration).not.toContain(
      'CREATE OR REPLACE FUNCTION public.get_public_collection_sync_release',
    );
  });

  it('falha fechado quando policies ou o verificador real do segredo sofrem deriva', () => {
    const migration = readRepoFile(
      'supabase/migrations/20260901032000_collection_runtime_health_security_v9_2_3.sql',
    );
    const probeDefinition = migration
      .split('CREATE OR REPLACE FUNCTION public.get_public_collection_runtime_health', 2)[1]
      .split('$runtime_health$;', 1)[0];

    expect(migration.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
    expect(probeDefinition).toContain("policy.policyname = 'coletas_producao_insert_own'");
    expect(probeDefinition).toContain("policy.policyname = 'coletas_producao_select_own'");
    expect(probeDefinition).toContain('SELECT count(*) = 2');
    expect(probeDefinition).toContain("policy.cmd = 'INSERT'");
    expect(probeDefinition).toContain("policy.cmd = 'SELECT'");
    expect(probeDefinition).toContain("policy.roles = ARRAY['authenticated'::name]");
    expect(probeDefinition).toContain('policy.qual IS NULL');
    expect(probeDefinition).toContain('policy.with_check IS NULL');
    expect(probeDefinition).toContain("= '(auth_user_id=auth.uid())'");
    expect(probeDefinition).toContain('lower(function_row.prosrc)');
    expect(probeDefinition).toContain('definitions.verify_secret_source =');
    expect(probeDefinition).toContain('fromvault.decrypted_secrets');
    expect(probeDefinition).toContain('extensions.digest(secret.decrypted_secret');
    expect(probeDefinition).toContain("''sha256''");
    expect(probeDefinition).toContain('has_function_privilege');
    expect(probeDefinition.toLowerCase()).not.toContain('select true');
    expect(probeDefinition.toLowerCase()).not.toContain('return true');
    expect(migration).not.toContain(
      'CREATE OR REPLACE FUNCTION private.wake_collection_inbox_worker',
    );
  });

  it('mantém o worker v9.2 com timeout pg_net compatível com a duração real', () => {
    const migration = readRepoFile(
      'supabase/migrations/20260901025000_collection_runtime_health_v9_2_2.sql',
    );

    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION private.wake_collection_inbox_worker',
    );
    expect(migration).toContain('timeout_milliseconds := 30000');
    expect(migration).not.toContain('timeout_milliseconds := 2000');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION private.wake_collection_inbox_worker(text, integer)',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION private.wake_collection_inbox_worker(text, integer)',
    );
    expect(migration).toContain('TO postgres, service_role');
  });

  it('mantém o cron apenas como fallback e não chama HTTP com fila vazia', () => {
    expect(existsSync(resolve(process.cwd(), migrationPath))).toBe(true);
    const migration = readRepoFile(migrationPath);

    expect(migration).toContain('IF NOT EXISTS');
    expect(migration).toContain("status_sincronizacao = 'recebida'");
    expect(migration).toContain("status_sincronizacao = 'processando'");
    expect(migration).toContain('RETURN NULL');
    expect(migration).toContain("schedule := '15 seconds'");
    expect(migration).not.toContain('REFRESH MATERIALIZED VIEW');
  });

  it('versiona o worker com claim, concorrência limitada e autenticação interna', () => {
    const worker = readRepoFile(
      'supabase/functions/process-collection-inbox/index.ts',
    );

    expect(worker).toContain('verify_collection_worker_cron_secret');
    expect(worker).toContain('claim_collection_inbox');
    expect(worker).toContain('process_collection_inbox_item');
    expect(worker).toContain('MAX_SAFE_PROCESSING_CONCURRENCY = 2');
    expect(worker).toContain('body.concurrency,');
    expect(worker).toContain('mapWithConcurrency');
    expect(worker).toContain('UNAUTHORIZED_COLLECTION_WORKER');
  });

  it('separa aceitação do INSERT da decisão final do worker', () => {
    const batchService = readRepoFile('src/lib/collectionBatchService.js');
    const queueHook = readRepoFile('src/hooks/useCollectionQueue.js');

    expect(batchService).toContain('COLLECTION_FINALIZATION_TIMEOUT_MS = 15_000');
    expect(batchService).toContain('error.finalizedEnvelopes');
    expect(batchService).toContain('COLLECTION_FINALIZATION_POLL_MAX_MS = 5_000');
    expect(batchService).toContain('getCollectionFinalizationPollDelayMs');
    expect(batchService).toContain('deterministicJitterUnit');
    expect(batchService).not.toContain('Math.min(1_000, Math.round(pollDelayMs * 1.6))');
    expect(batchService).toContain('waitForFinalRows');
    expect(batchService).toContain("new Set(['sincronizada', 'erro'])");
    expect(batchService).toContain('.insert(rows)');
    expect(queueHook).toContain('flushDebounceMs');
    expect(queueHook).toMatch(/\(microBatch \? 1_?000 : 15_?000\)/);
    expect(queueHook).toContain("status: 'pending_database'");
    expect(queueHook).toContain('COLLECTION_STATES.PENDING_DATABASE');
    expect(batchService).toContain("supabase.rpc('ingest_collection_batch_v3'");
  });

  it('impede código numérico de ser comparado com coluna UUID', () => {
    const service = readRepoFile('src/lib/collectionService.js');

    expect(service).toContain('const isUuid = /^[0-9a-f]{8}-');
    expect(service).toContain('...(isUuid ? [`id.eq.${target}`] : [])');
    expect(service).toContain('if (idToSearch)');
    expect(service).toContain('filterConditions.push(`piece_id.eq.${idToSearch}`)');
  });

  it('escuta a criação e a finalização assíncrona e consolida invalidações do dashboard', () => {
    const service = readRepoFile('src/lib/collectionService.js');
    const queryKeys = readRepoFile('src/config/queryKeys.js');
    const page = readRepoFile('src/pages/TraceabilityCollection.jsx');

    expect(service).toContain("event: '*'");
    expect(service).toContain("table: 'production_collection_events'");
    expect(service).toContain('filter = `cell_id=eq.${cellId}`');
    expect(queryKeys).toContain('DEFAULT_INVALIDATION_DELAY_MS = 750');
    expect(queryKeys).toContain('pendingInvalidations = new WeakMap()');
    expect(page).toContain('Leitura recebida e aguardando validação.');
  });
});

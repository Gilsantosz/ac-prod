import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('AC.Prod2 collection async worker v8.7.1 contract', () => {
  const asyncMigrationPath =
    'supabase/migrations/20260831221753_collection_async_inbox_worker_v8_7.sql';
  const releaseMigrationPath =
    'supabase/migrations/20260831223614_collection_async_release_probe_v8_7_1.sql';

  it('desacopla o ACK do processamento produtivo', () => {
    expect(existsSync(resolve(process.cwd(), asyncMigrationPath))).toBe(true);
    const migration = repoFile(asyncMigrationPath);

    expect(migration).toContain('private.coleta_producao_credentials');
    expect(migration).toContain("NEW.status_sincronizacao := 'recebida'");
    expect(migration).toContain('claim_collection_inbox');
    expect(migration).toContain('FOR UPDATE SKIP LOCKED');
    expect(migration).toContain('process_collection_inbox_item');
    expect(migration).toContain('trg_wake_collection_inbox_worker');
    expect(migration).toContain("'run-process-collection-inbox'");
    expect(migration).toContain('ALTER PUBLICATION supabase_realtime');

    const ingressStart = migration.indexOf(
      'CREATE OR REPLACE FUNCTION public.process_coleta_producao_ingress()',
    );
    const ingressEnd = migration.indexOf(
      'CREATE OR REPLACE FUNCTION public.claim_collection_inbox',
    );
    const ingress = migration.slice(ingressStart, ingressEnd);
    expect(ingress).toContain('coleta_producao_credentials');
    expect(ingress).not.toContain('process_production_reading_v2');
  });

  it('valida release assíncrono sem herdar flags síncronas obsoletas', () => {
    expect(existsSync(resolve(process.cwd(), releaseMigrationPath))).toBe(true);
    const release = repoFile(releaseMigrationPath);

    expect(release).toContain('get_public_collection_release()');
    expect(release).not.toContain('get_public_collection_micro_batch_release()');
    expect(release).toContain('collection_async_ingress_is_lightweight');
    expect(release).toContain('collection_async_worker_rpcs');
    expect(release).toContain('collection_async_session_lock_removed');
    expect(release).toContain('collection_async_no_legacy_sync_dependency');
    expect(release).toContain(
      "'20260831_acprod_collection_async_worker_v8_7_1'",
    );
  });

  it('trata o INSERT como ACK durável e aguarda a decisão final', () => {
    const service = repoFile('src/lib/collectionBatchService.js');
    const queue = repoFile('src/lib/collectionEventQueue.js');
    const batchQueue = repoFile('src/lib/collectionMicroBatchQueue.js');

    expect(service).toContain(".from('coletas_producao')");
    expect(service).toContain('.insert(rows)');
    expect(service).toContain('server_accepted');
    expect(service).toContain('fetchProductionCollectionResults');
    expect(service).toContain('COLLECTION_BATCH_MAX_SIZE = 100');
    expect(queue).toContain("status: 'server_pending'");
    expect(queue).toContain('markEventTerminalError');
    expect(queue).toContain("event.status === 'synced'");
    expect(batchQueue).toContain("serverStatus === 'recebida'");
    expect(batchQueue).toContain('markEventServerPending');
  });

  it('reconcilia resultados por Realtime com polling de segurança', () => {
    const hook = repoFile('src/hooks/useCollectionQueue.js');
    const monitor = repoFile('src/lib/collectionInboxMonitor.js');
    const page = repoFile('src/pages/TraceabilityCollection.jsx');

    expect(hook).toContain('subscribeToCollectionInbox');
    expect(hook).toContain('fetchProductionCollectionResults');
    expect(hook).toContain('SERVER_POLL_INTERVAL_MS = 2_000');
    expect(hook).toContain('FLUSH_DEBOUNCE_MS = 120');
    expect(hook).toContain('reconcileServerPending');
    expect(monitor).toContain("event: 'UPDATE'");
    expect(monitor).toContain("table: 'coletas_producao'");
    expect(page).toContain('handleAsyncCollectionResult');
    expect(page).toContain('ACK local/inbox não é aprovação produtiva');
  });

  it('mostra estados distintos ao operador sem chamar ACK de aprovação', () => {
    const panel = repoFile('src/components/entry/CollectionQueuePanel.jsx');

    expect(panel).toContain('Aguardando envio');
    expect(panel).toContain('Enviando ao servidor');
    expect(panel).toContain('No servidor');
    expect(panel).toContain('Processadas');
    expect(panel).toContain('Worker atrasado');
  });

  it('mantém reposição fora do lote produtivo', () => {
    const dispatcher = repoFile('src/lib/collectionEventDispatcher.js');

    expect(dispatcher).toContain('productionBuffer');
    expect(dispatcher).toContain('await flushProductionBuffer()');
    expect(dispatcher).toContain('collectReplacementStageV2');
    expect(dispatcher).toContain('processProductionCollectionBatch');
  });

  it('versiona o worker Supabase concorrente e sem chave no navegador', () => {
    const workerPath = 'supabase/functions/process-collection-inbox/index.ts';
    expect(existsSync(resolve(process.cwd(), workerPath))).toBe(true);
    const worker = repoFile(workerPath);

    expect(worker).toContain('claim_collection_inbox');
    expect(worker).toContain('process_collection_inbox_item');
    expect(worker).toContain('mapWithConcurrency');
    expect(worker).toContain('x-cron-secret');
    expect(worker).toContain('SUPABASE_SERVICE_ROLE_KEY');

    const browserService = repoFile('src/lib/collectionBatchService.js');
    expect(browserService).not.toContain('service_role');
  });

  it('mantém o worker local offline-first para integrações físicas', () => {
    const packageJson = repoFile('edge-worker/package.json');
    const envExample = repoFile('edge-worker/.env.example');
    const config = repoFile('edge-worker/src/config.mjs');
    const worker = repoFile('edge-worker/src/index.mjs');
    const durableQueue = repoFile('edge-worker/src/durableMemoryQueue.mjs');
    const sink = repoFile('edge-worker/src/supabaseBatchSink.mjs');

    expect(packageJson).toContain('"node": ">=22"');
    expect(worker).toContain('queue.prepend(batch)');
    expect(worker).toContain('timingSafeEqual');
    expect(worker).toContain('edge_worker_auth_deferred');
    expect(durableQueue).toContain('#items = []');
    expect(envExample).toContain('EDGE_HOST=127.0.0.1');
    expect(config).toContain('EDGE_INGEST_TOKEN é obrigatório');
    expect(sink).toContain(".from('coletas_producao')");
    expect(sink).not.toContain('service_role');
  });

  it('impede deploy quando o Supabase não estiver no release v8.7.1', () => {
    const workflow = repoFile('.github/workflows/deploy.yml');

    expect(workflow).toContain(
      'REQUIRED_ASYNC_COLLECTION_MIGRATION_VERSION: "20260831223614"',
    );
    expect(workflow).toContain(
      'REQUIRED_ASYNC_COLLECTION_RELEASE_VERSION: "20260831_acprod_collection_async_worker_v8_7_1"',
    );
    expect(workflow).toContain('get_public_collection_async_release');
    expect(workflow).toContain('ASYNC_COLLECTION_RELEASE_OK');
    expect(workflow).toContain('collection_async_ingress_is_lightweight');
    expect(workflow).toContain('collection_async_worker_rpcs');
  });
});

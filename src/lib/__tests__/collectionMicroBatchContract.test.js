import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('AC.Prod2 collection micro-batching v8.6 contract', () => {
  const migrationPath =
    'supabase/migrations/20260831163500_collection_micro_batch_ingress_v8_6.sql';

  it('cria inbox com RLS e reutiliza a RPC transacional existente', () => {
    expect(existsSync(resolve(process.cwd(), migrationPath))).toBe(true);
    const migration = repoFile(migrationPath);

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.coletas_producao');
    expect(migration).toContain('status_sincronizacao');
    expect(migration).toContain('ALTER TABLE public.coletas_producao ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('coletas_producao_insert_own');
    expect(migration).toContain('coletas_producao_select_own');
    expect(migration).toContain('process_production_reading_v2');
    expect(migration).toContain('trg_process_coleta_producao_ingress');
    expect(migration).toContain("v_sqlstate IN ('40001', '40P01'");
    expect(migration).toContain('NEW.payload := v_payload');
    expect(migration).toContain("- 'operatorSessionToken'");
    expect(migration).toContain("- 'operator_session_token'");
  });

  it('envia array por insert e preserva client_event_id para idempotência', () => {
    const service = repoFile('src/lib/collectionBatchService.js');

    expect(service).toContain(".from('coletas_producao')");
    expect(service).toContain('.insert(rows)');
    expect(service).toContain("error.code === '23505'");
    expect(service).toContain('client_event_id');
    expect(service).toContain('operatorSessionToken');
    expect(service).toContain('COLLECTION_BATCH_MAX_SIZE = 100');
  });

  it('escoa a fila a cada cinco segundos sem aguardar o banco em processNow', () => {
    const hook = repoFile('src/hooks/useCollectionQueue.js');
    const queue = repoFile('src/lib/collectionMicroBatchQueue.js');

    expect(hook).toContain('(microBatch ? 5000 : 15000)');
    expect(hook).toContain('dispatchCollectionEventBatch');
    expect(hook).toContain("status: 'queued'");
    expect(hook).toContain('não espera o PostgreSQL');
    expect(hook).toContain('getOperatorSession');
    expect(hook).toContain('operator_session_token');
    expect(queue).toContain('flushCollectionMicroBatchQueue');
    expect(queue).toContain('markEventError');
    expect(queue).toContain('markEventSynced');
  });

  it('mantém reposição fora do lote produtivo', () => {
    const dispatcher = repoFile('src/lib/collectionEventDispatcher.js');

    expect(dispatcher).toContain('productionBuffer');
    expect(dispatcher).toContain('await flushProductionBuffer()');
    expect(dispatcher).toContain('collectReplacementStageV2');
    expect(dispatcher).toContain('processProductionCollectionBatch');
  });

  it('entrega worker offline-first, restrito ao host local e com bulk insert', () => {
    const packageJson = repoFile('edge-worker/package.json');
    const envExample = repoFile('edge-worker/.env.example');
    const config = repoFile('edge-worker/src/config.mjs');
    const worker = repoFile('edge-worker/src/index.mjs');
    const durableQueue = repoFile('edge-worker/src/durableMemoryQueue.mjs');
    const sink = repoFile('edge-worker/src/supabaseBatchSink.mjs');

    expect(packageJson).toContain('"node": ">=22"');
    expect(worker).toContain('setInterval');
    expect(worker).toContain('config.flushIntervalMs');
    expect(worker).toContain('queue.prepend(batch)');
    expect(worker).toContain('timingSafeEqual');
    expect(worker).toContain('edge_worker_auth_deferred');
    expect(worker.indexOf('server.listen')).toBeLessThan(
      worker.lastIndexOf('sink.authenticate()'),
    );
    expect(worker).toContain('transport_only_no_production_mutation');
    expect(durableQueue).toContain('#items = []');
    expect(envExample).toContain('collection-spool.jsonl');
    expect(envExample).toContain('EDGE_HOST=127.0.0.1');
    expect(envExample).toContain('EDGE_INGEST_TOKEN=');
    expect(config).toContain("|| '127.0.0.1'");
    expect(config).toContain('EDGE_INGEST_TOKEN é obrigatório');
    expect(sink).toContain(".from('coletas_producao')");
    expect(sink).toContain('.insert(rows)');
    expect(sink).toContain('await this.authenticate()');
    expect(sink).not.toContain('service_role');
  });

  it('impede deploy quando o Supabase não estiver no release v8.6', () => {
    const workflow = repoFile('.github/workflows/deploy.yml');

    expect(workflow).toContain(
      'REQUIRED_MICRO_BATCH_MIGRATION_VERSION: "20260831163500"',
    );
    expect(workflow).toContain(
      'REQUIRED_MICRO_BATCH_RELEASE_VERSION: "20260831_acprod_collection_micro_batch_v8_6"',
    );
    expect(workflow).toContain('get_public_collection_micro_batch_release');
    expect(workflow).toContain('MICRO_BATCH_RELEASE_OK');
    expect(workflow).toContain('collection_micro_batch_explicit_grants');
  });
});

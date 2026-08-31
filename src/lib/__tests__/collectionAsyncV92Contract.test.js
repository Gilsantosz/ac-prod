import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readRepoFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('AC.Prod2 asynchronous collection v9.2 contract', () => {
  const migrationPath =
    'supabase/migrations/20260831232032_collection_worker_idle_guard_v9_2.sql';

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
    expect(worker).toContain('clampInteger(body.concurrency, 4, 1, 8)');
    expect(worker).toContain('mapWithConcurrency');
    expect(worker).toContain('UNAUTHORIZED_COLLECTION_WORKER');
  });

  it('separa aceitação do INSERT da decisão final do worker', () => {
    const batchService = readRepoFile('src/lib/collectionBatchService.js');
    const queueHook = readRepoFile('src/hooks/useCollectionQueue.js');

    expect(batchService).toContain('COLLECTION_FINALIZATION_TIMEOUT_MS = 25_000');
    expect(batchService).toContain('waitForFinalRows');
    expect(batchService).toContain("new Set(['sincronizada', 'erro'])");
    expect(batchService).toContain('.insert(rows)');
    expect(queueHook).toContain('flushDebounceMs');
    expect(queueHook).toContain('(microBatch ? 1000 : 15000)');
    expect(queueHook).toContain("status: 'queued'");
  });

  it('impede código numérico de ser comparado com coluna UUID', () => {
    const service = readRepoFile('src/lib/collectionService.js');

    expect(service).toContain('const isUuid = /^[0-9a-f]{8}-');
    expect(service).toContain('...(isUuid ? [`id.eq.${target}`] : [])');
    expect(service).toContain('if (idToSearch)');
    expect(service).toContain('filterConditions.push(`piece_id.eq.${idToSearch}`)');
  });

  it('escuta somente o evento final e consolida invalidações do dashboard', () => {
    const service = readRepoFile('src/lib/collectionService.js');
    const queryKeys = readRepoFile('src/config/queryKeys.js');
    const page = readRepoFile('src/pages/TraceabilityCollection.jsx');

    expect(service).toContain("event: 'INSERT'");
    expect(service).toContain("table: 'production_collection_events'");
    expect(queryKeys).toContain('DEFAULT_INVALIDATION_DELAY_MS = 750');
    expect(queryKeys).toContain('pendingInvalidations = new WeakMap()');
    expect(page).toContain('Leitura recebida e aguardando validação.');
  });
});

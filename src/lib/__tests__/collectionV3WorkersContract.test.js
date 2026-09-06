import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKERS = [
  {
    label: 'decision',
    path: 'supabase/functions/process-collection-v3/index.ts',
  },
  {
    label: 'projection',
    path: 'supabase/functions/project-collection-v3/index.ts',
  },
];

function readWorker(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

function roundLoop(source) {
  const start = source.indexOf('for (let round = 0; round < maxRounds; round += 1)');
  const end = source.indexOf('\n    const durationMs', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('Collection Fabric V3 Edge workers contract', () => {
  it.each(WORKERS)('$label worker exists and uses only the service-role environment', ({ path }) => {
    expect(existsSync(resolve(process.cwd(), path))).toBe(true);
    const source = readWorker(path);
    const environmentNames = Array.from(
      source.matchAll(/Deno\.env\.get\("([A-Z0-9_]+)"\)/g),
      (match) => match[1],
    );

    expect(source).toContain('npm:@supabase/supabase-js@2.106.2');
    expect(environmentNames).toEqual([
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]);
    expect(source).not.toContain('SUPABASE_ANON_KEY');
    expect(source).not.toContain('JWT_SECRET');
  });

  it.each(WORKERS)('$label authenticates, claims and processes in one database round-trip', ({ path }) => {
    const source = readWorker(path);
    const loop = roundLoop(source);

    expect(source).toContain('req.headers.get("x-cron-secret")');
    expect(source).toContain('const CYCLE_RPC = "run_collection_worker_cycle_v3"');
    expect(loop).toContain('p_secret: secret');
    expect(loop).toContain('p_lease_owner: requestedLeaseOwner');
    expect(loop).toContain('p_worker_id: workerId');
    expect(loop).toContain('p_limit: limit');
    expect(occurrences(loop, 'await admin.rpc(')).toBe(1);
    expect(source).not.toContain('verify_collection_worker_cron_secret');
    expect(source).not.toContain('claim_collection_batch_v3');
    expect(source).not.toContain('process_collection_batch_v3');
    expect(source).not.toContain('claim_collection_projection_batch_v3');
    expect(source).not.toContain('process_collection_projection_batch_v3');
  });

  it.each(WORKERS)('$label uses a bounded slot and hands off saturated backlogs', ({ path, label }) => {
    const source = readWorker(path);

    expect(source).toContain('const RELEASE_SLOT_RPC = "release_collection_worker_slot_v3"');
    expect(source).toContain('const HANDOFF_RPC = "handoff_collection_worker_v3"');
    expect(source).toContain(`const WORKER_KIND = "${label}"`);
    expect(source).toContain('cycle.lease_retained === true');
    expect(source).toContain('handoffRequired = round === maxRounds - 1');
    expect(source).toContain('} finally {');
    expect(source).toContain('const rpcName = handoffRequired ? HANDOFF_RPC : RELEASE_SLOT_RPC');
    expect(source).toContain('coalesced: true');
  });

  it.each(WORKERS)('$label enforces its measured transaction budget and five short cycles', ({ path, label }) => {
    const source = readWorker(path);
    const loop = roundLoop(source);

    expect(source).toContain('const MIN_BATCH_SIZE = 5');
    const batchSize = label === 'projection' ? 5 : 25;
    expect(source).toContain(`const DEFAULT_BATCH_SIZE = ${batchSize}`);
    expect(source).toContain(`const MAX_BATCH_SIZE = ${batchSize}`);
    expect(source).toContain('const MAX_ROUNDS = 5');
    expect(source).toContain('body.limit,\n    DEFAULT_BATCH_SIZE,\n    MIN_BATCH_SIZE,\n    MAX_BATCH_SIZE');
    expect(source).toContain('body.max_rounds,\n    DEFAULT_MAX_ROUNDS,\n    1,\n    MAX_ROUNDS');
    expect(loop).not.toMatch(/for\s*\([^)]*(item|claim)/i);
    expect(source).not.toContain('Promise.all');
    expect(source).not.toContain('Promise.allSettled');
    expect(source).not.toContain('body.concurrency');
  });

  it.each(WORKERS)('$label exposes only sanitized summaries and error codes', ({ path }) => {
    const source = readWorker(path);
    const outputSection = source.slice(source.indexOf('const summary = {'));

    expect(source).toContain('safeDatabaseCode');
    expect(source).toContain('/^[A-Z0-9_]{1,32}$/');
    expect(source).toContain('error: failure.publicCode');
    expect(source).toContain('database_code: failure.databaseCode');
    expect(source).not.toContain('error.message');
    expect(source).not.toContain('String(error)');
    expect(outputSection).not.toContain('client_event_id');
    expect(outputSection).not.toContain('p_secret');
    expect(outputSection).not.toContain('raw_value');
  });
});

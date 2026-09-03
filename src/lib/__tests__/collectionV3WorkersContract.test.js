import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKERS = [
  {
    label: 'decision',
    path: 'supabase/functions/process-collection-v3/index.ts',
    processRpc: 'process_collection_batch_v3',
  },
  {
    label: 'projection',
    path: 'supabase/functions/project-collection-v3/index.ts',
    processRpc: 'process_collection_projection_batch_v3',
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

  it.each(WORKERS)('$label worker authenticates and begins its lease in one server-side RPC', ({ path }) => {
    const source = readWorker(path);

    expect(source).toContain('req.headers.get("x-cron-secret")');
    expect(source).toContain('const BEGIN_LEASE_RPC = "begin_collection_worker_lease_v3"');
    expect(source).toContain('p_secret: secret');
    expect(source).toContain('UNAUTHORIZED_COLLECTION_');
    expect(source).toContain('MAX_REQUEST_BODY_BYTES = 16_384');
  });

  it.each(WORKERS)('$label worker calls the lease-aware claim and batch processor with the agreed payload', ({
    path,
    processRpc,
  }) => {
    const source = readWorker(path);

    expect(source).toContain('const CLAIM_WITH_LEASE_RPC = "claim_collection_worker_batch_v3"');
    expect(source).toContain(`const PROCESS_RPC = "${processRpc}"`);
    expect(source).toContain('p_worker_id: workerId');
    expect(source).toContain('p_limit: limit');
    expect(source).toContain('p_items: items');
    expect(occurrences(source, 'await admin.rpc(')).toBe(4);
    expect(occurrences(source, 'await admin.rpc(\n        CLAIM_WITH_LEASE_RPC,')).toBe(1);
    expect(occurrences(source, 'await admin.rpc(\n        PROCESS_RPC,')).toBe(1);
  });

  it.each(WORKERS)('$label worker renews its distributed lease and always releases it', ({ path, label }) => {
    const source = readWorker(path);
    const loop = roundLoop(source);

    expect(source).toContain('const BEGIN_LEASE_RPC = "begin_collection_worker_lease_v3"');
    expect(source).toContain('const CLAIM_WITH_LEASE_RPC = "claim_collection_worker_batch_v3"');
    expect(source).toContain('const LEASE_TTL_SECONDS = 120');
    expect(source).toContain('const RELEASE_LEASE_RPC = "release_collection_worker_lease_v3"');
    expect(source).toContain(`p_worker_kind: "${label}"`);
    expect(source).toContain('coalesced: true');
    expect(source).toContain('} finally {');
    expect(source.indexOf('BEGIN_LEASE_RPC')).toBeLessThan(source.indexOf('for (let round'));
    expect(loop.indexOf('CLAIM_WITH_LEASE_RPC')).toBeLessThan(loop.indexOf('PROCESS_RPC'));
    expect(loop).toContain('LEASE_OR_CLAIM_FAILED');
    expect(source.indexOf('} finally {')).toBeLessThan(source.lastIndexOf('RELEASE_LEASE_RPC'));
  });

  it.each(WORKERS)('$label worker enforces 5-25 items and at most five sequential rounds', ({ path }) => {
    const source = readWorker(path);
    const loop = roundLoop(source);

    expect(source).toContain('const MIN_BATCH_SIZE = 5');
    expect(source).toContain('const MAX_BATCH_SIZE = 25');
    expect(source).toContain('const MAX_ROUNDS = 5');
    expect(source).toContain('body.limit,\n    DEFAULT_BATCH_SIZE,\n    MIN_BATCH_SIZE,\n    MAX_BATCH_SIZE');
    expect(source).toContain('body.max_rounds,\n    DEFAULT_MAX_ROUNDS,\n    1,\n    MAX_ROUNDS');
    expect(occurrences(loop, 'await admin.rpc(')).toBe(2);
    expect(loop.indexOf('CLAIM_WITH_LEASE_RPC')).toBeLessThan(loop.indexOf('PROCESS_RPC'));
  });

  it.each(WORKERS)('$label worker sends the claimed array once and never starts per-item concurrency', ({ path }) => {
    const source = readWorker(path);
    const loop = roundLoop(source);

    expect(loop).toContain('const items = claimedItems(claimData)');
    expect(loop).toContain('p_items: items');
    expect(loop).not.toMatch(/for\s*\([^)]*(item|claim)/i);
    expect(source).not.toContain('Promise.all');
    expect(source).not.toContain('Promise.allSettled');
    expect(source).not.toContain('mapWithConcurrency');
    expect(source).not.toContain('body.concurrency');
  });

  it.each(WORKERS)('$label worker exposes only sanitized summaries and error codes', ({ path }) => {
    const source = readWorker(path);
    const outputSection = source.slice(source.indexOf('const summary = {'));

    expect(source).toContain('safeDatabaseCode');
    expect(source).toContain('/^[A-Z0-9_]{1,32}$/');
    expect(source).toContain('error: failure.publicCode');
    expect(source).toContain('database_code: failure.databaseCode');
    expect(source).not.toContain('error.message');
    expect(source).not.toContain('String(error)');
    expect(outputSection).not.toContain('client_event_id');
    expect(outputSection).not.toContain('claimData');
    expect(outputSection).not.toContain('p_secret');
    expect(outputSection).not.toContain('items');
  });
});

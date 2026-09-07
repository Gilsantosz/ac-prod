import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectReplayInput, isolatedEnvironment } from './local-pg17-replay.mjs';

test('remote credentials and inherited PostgreSQL defaults cannot redirect the local replay', () => {
  const env = isolatedEnvironment({ PATH: '/bin', PGHOST: 'remote', PGSERVICE: 'prod', PGPASSFILE: '/secret',
    PGOPTIONS: '-c role=admin', DATABASE_URL: 'secret', SUPABASE_ACCESS_TOKEN: 'secret', LANG: 'C' });
  assert.deepEqual(env, { PATH: '/bin', LANG: 'C' });
});

test('rejects psql escape hatches, production references and shell/network execution', () => {
  for (const sql of ['\\connect remote', '  \\! sh', "COPY x TO PROGRAM 'sh'", "SELECT dblink_connect('remote')",
    "SELECT net.http_post('https://example.com')", '-- uozuzdfvnufsjsonswag']) {
    assert.throws(() => inspectReplayInput('baseline.sql', sql));
  }
});

test('records the exact reviewed SQL bytes and accepts additive schema operations', () => {
  const a = inspectReplayInput('baseline.sql', 'CREATE TABLE public.receipts (id uuid PRIMARY KEY);');
  const b = inspectReplayInput('baseline.sql', 'CREATE TABLE public.receipts (id uuid PRIMARY KEY);\n');
  assert.match(a.sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(a.sha256, b.sha256);
  assert.throws(() => inspectReplayInput('baseline.txt', 'SELECT 1;'));
});

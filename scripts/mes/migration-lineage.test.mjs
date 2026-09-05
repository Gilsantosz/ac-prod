import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectMigrations } from '../audit-migration-lineage.mjs';

test('historical debt is visible, but any edit or deletion of historical bytes blocks CI', () => {
  const baseline = { files: [{ name: '001_old.sql', sha256: 'known' }] };
  const old = { name: '001_old.sql', sha256: 'known', sql: 'SELECT 1;' };
  const unchanged = inspectMigrations([old], baseline);
  assert.equal(unchanged.new_blockers.length, 0);
  assert.equal(unchanged.cold_replay_ready, false);
  assert.ok(inspectMigrations([{ ...old, sha256: 'edited' }], baseline).new_blockers.some(f => f.code === 'HISTORICAL_BYTES_CHANGED'));
  assert.ok(inspectMigrations([], baseline).new_blockers.some(f => f.code === 'HISTORICAL_FILE_MISSING'));
});

test('new prefix collisions, placeholders, destructive SQL and production references fail', () => {
  const files = [
    { name: '20260905000000_a.sql', sha256: 'a', sql: 'SELECT 1;' },
    { name: '20260905000000_b.sql', sha256: 'b', sql: 'TRUNCATE public.facts; -- uozuzdfvnufsjsonswag' },
  ];
  const codes = new Set(inspectMigrations(files).new_blockers.map(f => f.code));
  for (const code of ['DUPLICATE_VERSION', 'NO_SCHEMA_PLACEHOLDER', 'DESTRUCTIVE_SQL_REQUIRES_REVIEW', 'PRODUCTION_REFERENCE']) assert.ok(codes.has(code));
});

test('a unique additive migration does not inherit historical debt', () => {
  const report = inspectMigrations([{ name: '20260905000000_add_receipt.sql', sha256: 'a', sql: 'CREATE TABLE private.receipts (id uuid PRIMARY KEY);' }]);
  assert.equal(report.new_blockers.length, 0);
  assert.equal(report.cold_replay_ready, true);
});

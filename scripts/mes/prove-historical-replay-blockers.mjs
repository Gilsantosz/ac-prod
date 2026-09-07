import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { replay } from './local-pg17-replay.mjs';

// Reproduce known syntax failures from the immutable historical source bytes.
// A successful reproduction is evidence of a BLOCKED historical replay, never GO.
const pgBin = process.argv[2];
if (!pgBin) throw new Error('Provide the absolute PostgreSQL 17 bin directory.');
const root = resolve(import.meta.dirname, '../..');
const directory = mkdtempSync(join(tmpdir(), 'acprod-replay-blockers-'));
const cases = [
  { file: '033_mes_alert_lifecycle.sql', routine: 'resolve_mes_alert',
    prerequisite: 'CREATE TABLE public.alert_logs (id uuid);' },
  { file: '036_customer_cover_multi_lot.sql', routine: 'get_cover_progress', prerequisite: '' },
];
const results = [];
for (const entry of cases) {
  const source = readFileSync(join(root, 'supabase/migrations', entry.file), 'utf8');
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${entry.routine}(`);
  assert.ok(start >= 0, `Historical source no longer contains ${entry.routine}; review the lineage.`);
  const bodyStart = source.indexOf('AS $$', start);
  const end = source.indexOf('$$;', bodyStart + 5);
  assert.ok(bodyStart > start && end > bodyStart, 'Historical function delimiter missing.');
  const literal = source.slice(start, end + 3);
  const fixture = join(directory, entry.file);
  writeFileSync(fixture, `${entry.prerequisite}\n${literal}\n`, { flag: 'wx', mode: 0o600 });
  const result = replay({ pgBin, files: [fixture] });
  assert.equal(result.cluster_stopped, true);
  assert.equal(result.decision, 'NO-GO');
  assert.equal(result.steps[0]?.sqlstate, '42601');
  results.push({ source: `supabase/migrations/${entry.file}`, routine: entry.routine,
    source_line: source.slice(0, start).split('\n').length,
    reproduced_sqlstate: result.steps[0].sqlstate, evidence: result.artifact });
}
process.stdout.write(`${JSON.stringify({ decision: 'HISTORICAL_REPLAY_BLOCKED', results }, null, 2)}\n`);

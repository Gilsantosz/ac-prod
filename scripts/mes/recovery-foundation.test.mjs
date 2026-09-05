import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFoundation } from './build-recovery-foundation.mjs';

const root = resolve(import.meta.dirname, '../..');
const readBundle = (label) => JSON.parse(readFileSync(resolve(root, `docs/audits/2026-09-04-mes-vnext/catalog-${label}-schema-evidence.json`), 'utf8'));

test('reviewed captures reproduce the applied bytes exactly, without claiming atomic capture', () => {
  const production = readBundle('production');
  const staging = readBundle('staging');
  assert.equal(production.atomic, false);
  assert.equal(staging.atomic, false);
  const result = buildFoundation(production, staging);
  assert.equal(result.sql, readFileSync(resolve(root, 'supabase/recovery/staging/20260905003000_collection_schema_foundation.sql'), 'utf8'));
  assert.equal(result.summary.constraints, 125);
});

test('refs and hash labels cannot disguise tampered identities, defaults or SQL', () => {
  for (const mutate of [
    (b) => { b.project_ref = 'wrong'; },
    (b) => { b.atomic = true; },
    (b) => { b.objects[0].catalog_sha256 = 'forged'; },
    (b) => { b.objects.find(o => o.kind === 'relation').identity = 'public.unreviewed'; },
    (b) => { b.objects.find(o => o.kind === 'relation' && o.definition.columns.length).definition.columns[0].default = 'unreviewed()'; },
    (b) => { b.objects.find(o => o.kind === 'routine').definition.definition += '\nSELECT unreviewed();'; },
  ]) {
    const production = readBundle('production');
    mutate(production);
    assert.throws(() => buildFoundation(production, readBundle('staging')), /immutable reviewed capture/);
  }
  const staging = readBundle('staging');
  staging.objects.pop();
  assert.throws(() => buildFoundation(readBundle('production'), staging), /immutable reviewed capture/);
});

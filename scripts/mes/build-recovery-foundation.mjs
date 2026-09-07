import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const key = (object) => `${object.kind}:${object.identity}`;
// Archival reproducer ONLY, not a general catalog-to-migration converter.
// These reviewed multi-page captures are not atomic. Pins detect modification,
// not source authenticity or simultaneous consistency. Deployment still needs
// explicit target verification and a current read-only structural preflight.
const reviewedBundleHashes = Object.freeze({
  uozuzdfvnufsjsonswag: 'd8d04ca20a6c5ef385f1359fe8162893a0797b3ac12d087bf82bed93be0a31ad',
  smnsihksrhzbkhcbdjfu: '6dee10b98ccc4c18dbcd18259dc7c5e40c094942d89495be1d0f6a53c8cfe590',
});
const reviewedSqlHash = 'cedc858cb918a5b300bfbece3f7a15dafaa8b69f3a30154fee18375bf0f543a0';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const additiveRelations = new Set([
  'public.operator_sessions', 'public.operators', 'public.production_collection_events',
  'public.production_entries', 'public.production_lots', 'public.production_pieces',
  'public.production_stage_readings', 'public.promob_import_batches', 'public.occurrences',
]);

export function columnSql(column) {
  let sql = `${quoteIdentifier(column.name)} ${column.type}`;
  if (column.collation) sql += ` COLLATE ${column.collation}`;
  if (column.identity) sql += ` GENERATED ${column.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`;
  else if (column.generated) {
    if (column.generated !== 's' || !column.default) throw new Error('Unsupported generated column.');
    sql += ` GENERATED ALWAYS AS (${column.default}) STORED`;
  } else if (column.default !== null) sql += ` DEFAULT ${column.default}`;
  if (column.not_null) sql += ' NOT NULL';
  return sql;
}

function requireEvidence(bundle, expected) {
  if (sha256(JSON.stringify(bundle)) !== reviewedBundleHashes[expected]) {
    throw new Error('Evidence differs from the immutable reviewed capture; a new recovery requires independent review.');
  }
  if (bundle.schema_version !== 'acprod-catalog-evidence-v3' || bundle.search_path !== '' || bundle.project_ref !== expected) {
    throw new Error('Expected qualified, versioned evidence for the exact project.');
  }
  if (bundle.objects.some(o => o.definition_withheld || !o.definition)) throw new Error('Incomplete catalog evidence.');
  const seen = new Set();
  for (const object of bundle.objects) {
    if (seen.has(key(object))) throw new Error('Duplicate catalog identity.');
    seen.add(key(object));
  }
}

export function buildFoundation(production, staging) {
  requireEvidence(production, 'uozuzdfvnufsjsonswag');
  requireEvidence(staging, 'smnsihksrhzbkhcbdjfu');
  const current = new Map(staging.objects.map(o => [key(o), o]));
  const newTables = production.objects.filter(o => o.kind === 'relation' && o.definition.kind === 'r' && !current.has(key(o)));
  const names = new Set(newTables.map(o => o.identity));
  const additions = [];
  for (const object of production.objects.filter(o => o.kind === 'relation' && additiveRelations.has(o.identity))) {
    const existing = current.get(key(object));
    if (!existing) continue;
    const oldColumns = new Set(existing.definition.columns.map(c => c.name));
    for (const column of object.definition.columns.filter(c => !oldColumns.has(c.name))) {
      if (column.not_null && column.default === null && !column.identity) throw new Error('Required new column lacks a deterministic migration default.');
      additions.push({ relation: object.identity, column });
    }
  }
  const constraints = production.objects.filter(o => o.kind === 'constraint' && names.has(o.definition.relation));
  const uniqueIndexes = production.objects.filter(o => o.kind === 'index' && names.has(o.definition.relation)
    && !o.definition.constraint_owned && /^CREATE UNIQUE INDEX /.test(o.definition.definition));
  const fingerprint = createHash('sha256').update(JSON.stringify({ newTables, additions, constraints, uniqueIndexes })).digest('hex');
  const sql = [
    '-- Staging-only additive recovery foundation. Generated from qualified catalog evidence.',
    '-- No legacy migration is edited, no row is replayed, no worker or trigger is enabled.',
    `-- Source object selection SHA-256: ${fingerprint}`,
    "SET LOCAL lock_timeout = '2s';", "SET LOCAL statement_timeout = '30s';", "SET LOCAL search_path = '';",
    'DO $recovery_preflight$ BEGIN',
    "  IF pg_catalog.to_regclass('public.coletas_producao') IS NOT NULL THEN",
    "    RAISE EXCEPTION 'RECOVERY_TARGET_ALREADY_INITIALIZED' USING ERRCODE = '55000';",
    '  END IF;',
    "  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='capacity_test_runs' AND column_name='synthetic_prefix') THEN",
    "    RAISE EXCEPTION 'RECOVERY_TARGET_NOT_STAGING_LINEAGE' USING ERRCODE = '55000';",
    '  END IF;', 'END $recovery_preflight$;',
    'CREATE SCHEMA IF NOT EXISTS private;',
    'REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;',
  ];
  for (const table of newTables) {
    sql.push(`-- catalog_sha256 ${table.catalog_sha256}`, `CREATE TABLE ${table.identity} (\n  ${table.definition.columns.map(columnSql).join(',\n  ')}\n);`,
      `ALTER TABLE ${table.identity} ENABLE ROW LEVEL SECURITY;`,
      `REVOKE ALL ON TABLE ${table.identity} FROM PUBLIC, anon, authenticated, service_role;`);
  }
  for (const sequence of production.objects.filter(o => o.kind === 'sequence'
    && o.definition.owned_by?.some(owner => names.has(owner.relation)))) {
    sql.push(`REVOKE ALL ON SEQUENCE ${sequence.identity} FROM PUBLIC, anon, authenticated, service_role;`);
  }
  for (const { relation, column } of additions) sql.push(`ALTER TABLE ${relation} ADD COLUMN ${columnSql(column)};`);
  for (const foreign of [false, true]) {
    for (const constraint of constraints.filter(o => (o.definition.kind === 'f') === foreign)) {
      sql.push(`-- catalog_sha256 ${constraint.catalog_sha256}`,
        `ALTER TABLE ${constraint.definition.relation} ADD CONSTRAINT ${quoteIdentifier(constraint.definition.name)} ${constraint.definition.definition};`);
    }
  }
  for (const index of uniqueIndexes) sql.push(`-- catalog_sha256 ${index.catalog_sha256}`, `${index.definition.definition};`);
  if (names.has('private.collection_pipeline_flags')) {
    sql.push("INSERT INTO private.collection_pipeline_flags (flag_name, enabled) VALUES\n  ('collection_pipeline_v3_ingress',false),\n  ('collection_pipeline_v3_worker',false),\n  ('collection_pipeline_v3_projection',false),\n  ('collection_pipeline_v3_broadcast',false);");
  }
  sql.push('CREATE TABLE private.mes_recovery_journal (recovery_key text PRIMARY KEY, target_ref text NOT NULL, selection_sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp());',
    'ALTER TABLE private.mes_recovery_journal ENABLE ROW LEVEL SECURITY;',
    'REVOKE ALL ON TABLE private.mes_recovery_journal FROM PUBLIC, anon, authenticated, service_role;',
    `INSERT INTO private.mes_recovery_journal (recovery_key,target_ref,selection_sha256) VALUES ('collection_foundation_20260905','smnsihksrhzbkhcbdjfu',${literal(fingerprint)});`);
  const generated = sql.join('\n\n') + '\n';
  if (sha256(generated) !== reviewedSqlHash) throw new Error('Generated SQL differs from the immutable applied artifact.');
  if (/uozuzdfvnufsjsonswag|\b(?:TRUNCATE|DROP|DELETE FROM)\b|https?:\/\/[A-Za-z0-9]/i.test(generated)) {
    throw new Error('Recovery output contains a forbidden destructive or cross-environment operation.');
  }
  return { sql: generated, summary: { selection_sha256: fingerprint, new_tables: newTables.map(t => t.identity),
    added_columns: additions.map(a => `${a.relation}.${a.column.name}`), constraints: constraints.length,
    unique_indexes: uniqueIndexes.length, decision: 'FOUNDATION_ONLY_NOT_FULL_SCHEMA_PARITY',
    intentionally_omitted: ['routines', 'triggers', 'policies/grants', 'non-unique indexes', 'views',
      'incompatible existing column changes', 'capacity_test_runs contract', 'extensions/cron/Vault', 'application data'] } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [productionPath, stagingPath, format = 'sql'] = process.argv.slice(2);
  const result = buildFoundation(JSON.parse(readFileSync(productionPath, 'utf8')), JSON.parse(readFileSync(stagingPath, 'utf8')));
  if (!['sql', 'summary'].includes(format)) throw new Error('Expected sql or summary output.');
  process.stdout.write(format === 'sql' ? result.sql : `${JSON.stringify(result.summary, null, 2)}\n`);
}

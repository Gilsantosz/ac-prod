import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function inspectMigrations(files, baseline = { files: [] }) {
  const known = new Map(baseline.files.map(f => [f.name, f.sha256]));
  const current = new Map(files.map(f => [f.name, f]));
  const versions = new Map();
  const findings = [];
  for (const f of files) {
    const historical = known.has(f.name);
    const add = (code, extra = {}) => findings.push({ file: f.name, code, historical, ...extra });
    if (historical && known.get(f.name) !== f.sha256) add('HISTORICAL_BYTES_CHANGED', { critical: true });
    const version = f.name.match(/^(\d+)_/)?.[1];
    if (!/^\d{14}_\w+\.sql$/.test(f.name)) add('NON_TIMESTAMP_NAME');
    if (version) {
      if (versions.has(version)) {
        const other = versions.get(version);
        add('DUPLICATE_VERSION', { other_file: other, critical: !historical || !known.has(other) });
      } else versions.set(version, f.name);
    }
    const withoutComments = f.sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').trim();
    if (/^SELECT\s+1\s*;?$/i.test(withoutComments)) add('NO_SCHEMA_PLACEHOLDER');
    if (/\buozuzdfvnufsjsonswag\b/.test(f.sql)) add('PRODUCTION_REFERENCE');
    // Conservative lint, including routine bodies. This is not a SQL parser or a safety proof.
    if (/^\s*(?:TRUNCATE\b|DROP\s+.+\bCASCADE\b|DELETE\s+FROM\b)/im.test(withoutComments)) add('DESTRUCTIVE_SQL_REQUIRES_REVIEW');
  }
  for (const name of known.keys()) if (!current.has(name)) findings.push({ file: name, code: 'HISTORICAL_FILE_MISSING', historical: true, critical: true });
  return { findings, new_blockers: findings.filter(f => f.critical || !f.historical),
    historical_debt: findings.filter(f => f.historical && !f.critical),
    cold_replay_ready: findings.length === 0 };
}

export function readMigrations(directory) {
  return readdirSync(directory).filter(name => name.endsWith('.sql')).sort().map(name => {
    const sql = readFileSync(join(directory, name), 'utf8');
    return { name, sql, sha256: createHash('sha256').update(sql).digest('hex') };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '..');
  const files = readMigrations(join(root, 'supabase/migrations'));
  const baseline = JSON.parse(readFileSync(join(root, 'supabase/migration-lineage-baseline.json'), 'utf8'));
  const report = inspectMigrations(files, baseline);
  const output = process.argv.includes('--json') ? report : {
    cold_replay_ready: report.cold_replay_ready, new_blockers: report.new_blockers,
    historical_debt_count: report.historical_debt.length,
    historical_debt_by_code: report.historical_debt.reduce((counts, f) => ({ ...counts, [f.code]: (counts[f.code] || 0) + 1 }), {}),
  };
  process.stdout.write(`${JSON.stringify({ baseline_commit: baseline.commit_sha, files: files.length, ...output }, null, 2)}\n`);
  process.exitCode = (process.argv.includes('--strict') ? !report.cold_replay_ready : report.new_blockers.length > 0) ? 1 : 0;
}

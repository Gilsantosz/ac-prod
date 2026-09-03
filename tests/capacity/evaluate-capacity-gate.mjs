import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_CAPACITY_RUNS = Object.freeze({
  smoke: 1,
  idempotency: 1,
  microbatch: 3,
  priority: 3,
  contention_piece: 3,
  contention_cell_lot: 3,
  atomic8: 1,
  nominal: 3,
  burst: 3,
});

const PROFILE_SEQUENCE_WINDOWS = Object.freeze({
  smoke: [[0, 1]],
  nominal: [[0, 18_000]],
  burst: [[1_000_000, 6_000]],
  microbatch: [[2_000_000, 125]],
  priority: [[3_000_000, 125], [4_000_000, 1_200], [5_000_000, 300]],
  idempotency: [[6_000_000, 20]],
  contention_piece: [[7_000_000, 20]],
  contention_cell_lot: [[8_000_000, 50]],
  atomic8: [[9_000_000, 8]],
});

export const REQUIRED_CAPACITY_EVIDENCE = Object.freeze([
  'migration_applied',
  'edge_functions_deployed',
  'health_before',
  'health_after',
  'sql_acceptance_passed',
  'browser_indexeddb_passed',
  'compute_observability_attached',
  'reconciliation_clean',
  'rollback_rehearsed',
  'approvals_recorded',
  'flags_restored_off',
]);

const STRICT_SLOS = Object.freeze([
  ['collection_ingress_ack_ms', 'p(95)', 250],
  ['collection_decision_ms', 'p(95)', 800],
  ['collection_decision_ms', 'p(99)', 2_000],
  ['collection_projection_ms', 'p(95)', 500],
  ['collection_queue_age_ms', 'p(99)', 2_000],
]);

const REQUIRED_THRESHOLD_RESULTS = Object.freeze([
  ['checks', 'rate==1'],
  ['collection_ingress_ack_ms', 'p(95)<250'],
  ['collection_decision_ms', 'p(95)<800'],
  ['collection_decision_ms', 'p(99)<2000'],
  ['collection_projection_ms', 'p(95)<500'],
  ['collection_queue_age_ms', 'p(99)<2000'],
]);

export function inspectSummaryArtifact(summary) {
  const reasons = [];
  if (!summary?.metrics) return { passed: false, reasons: ['summary_missing'] };
  for (const [metricName, expression] of REQUIRED_THRESHOLD_RESULTS) {
    const result = summary.metrics?.[metricName]?.thresholds?.[expression];
    if (result === undefined) reasons.push(`threshold_missing:${metricName}:${expression}`);
  }
  for (const [metricName, metric] of Object.entries(summary.metrics)) {
    for (const [threshold, result] of Object.entries(metric?.thresholds || {})) {
      const passed = typeof result === 'boolean' ? result : result?.ok;
      if (passed !== true) reasons.push(`threshold_breached:${metricName}:${threshold}`);
    }
  }
  for (const [metricName, stat, limit] of STRICT_SLOS) {
    const metric = summary.metrics?.[metricName];
    const value = Number(metric?.values?.[stat] ?? metric?.[stat]);
    if (!Number.isFinite(value)) reasons.push(`slo_missing:${metricName}:${stat}`);
    else if (value >= limit) reasons.push(`slo_failed:${metricName}:${stat}:${value}/${limit}`);
  }
  return { passed: reasons.length === 0, reasons };
}

export function evaluateCapacityGate(manifest, controlRecords) {
  const reasons = [];
  const target = manifest?.target;
  if (!['staging', 'test-production'].includes(target)) reasons.push('target_invalid');
  const evidence = manifest?.evidence || {};
  for (const evidenceName of REQUIRED_CAPACITY_EVIDENCE) {
    if (evidence[evidenceName] !== true) reasons.push(`evidence_missing:${evidenceName}`);
  }

  const runs = Array.isArray(manifest?.runs) ? manifest.runs : [];
  const counts = {};
  const runIds = new Set();
  const sequenceBases = new Set();
  const sequenceRanges = [];
  for (let index = 0; index < runs.length; index += 1) {
    const entry = runs[index] || {};
    const record = controlRecords[index];
    const label = `${entry.profile || 'unknown'}#${index + 1}`;
    counts[entry.profile] = (counts[entry.profile] || 0) + 1;
    if (!record) {
      reasons.push(`control_record_missing:${label}`);
      continue;
    }
    if (record.outcome !== 'completed') reasons.push(`run_not_completed:${label}`);
    if (record.metrics?.profile !== entry.profile) reasons.push(`profile_mismatch:${label}`);
    if (record.metrics?.target !== target) reasons.push(`target_mismatch:${label}`);
    if (record.metrics?.k6_exit_code !== 0 || record.metrics?.k6_signal != null) {
      reasons.push(`k6_not_clean:${label}`);
    }
    if (record.metrics?.thresholds_passed !== true) reasons.push(`threshold_failed:${label}`);
    if (!/^[a-f0-9]{64}$/.test(record.metrics?.summary_sha256 || '')) {
      reasons.push(`summary_hash_missing:${label}`);
    }
    if (record.artifact?.sha256 !== record.metrics?.summary_sha256) {
      reasons.push(`summary_hash_mismatch:${label}`);
    }
    if (record.artifact?.passed !== true) {
      reasons.push(`summary_validation_failed:${label}`);
      for (const artifactReason of record.artifact?.reasons || []) {
        reasons.push(`${artifactReason}:${label}`);
      }
    }
    if (!/^CAPTEST_[0-9]{8}_[0-9]{6}_[A-Z0-9]{8}$/.test(record.run_id || '')
        || runIds.has(record.run_id)) reasons.push(`run_id_not_unique:${label}`);
    runIds.add(record.run_id);
    const sequenceBase = Number(record.metrics?.sequence_base);
    if (!Number.isSafeInteger(sequenceBase) || sequenceBases.has(sequenceBase)) {
      reasons.push(`sequence_base_not_unique:${label}`);
    } else {
      const windows = PROFILE_SEQUENCE_WINDOWS[entry.profile];
      if (!windows) {
        reasons.push(`profile_unexpected:${label}`);
      } else {
        for (const [offset, span] of windows) {
          const range = {
            start: sequenceBase + offset + 1,
            end: sequenceBase + offset + span,
            label,
          };
          if (!Number.isSafeInteger(range.end)) {
            reasons.push(`sequence_range_invalid:${label}`);
          } else {
            const overlap = sequenceRanges.find(
              (candidate) => range.start <= candidate.end && candidate.start <= range.end,
            );
            if (overlap) reasons.push(`sequence_range_overlap:${label}:${overlap.label}`);
            sequenceRanges.push(range);
          }
        }
      }
    }
    sequenceBases.add(sequenceBase);
  }

  for (const [profile, requiredCount] of Object.entries(REQUIRED_CAPACITY_RUNS)) {
    if ((counts[profile] || 0) < requiredCount) {
      reasons.push(`profile_missing:${profile}:${counts[profile] || 0}/${requiredCount}`);
    }
  }
  return {
    decision: reasons.length === 0 ? 'GO' : 'NO-GO',
    reasons,
    evaluated_runs: runs.length,
    required_runs: Object.values(REQUIRED_CAPACITY_RUNS).reduce((total, count) => total + count, 0),
  };
}

async function main() {
  const manifestPath = resolve(process.argv[2] || '');
  if (!process.argv[2]) throw new Error('MANIFEST_PATH_REQUIRED');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const root = dirname(manifestPath);
  const controls = await Promise.all((manifest.runs || []).map(async (entry) => {
    if (!entry?.control_file) return null;
    try {
      const controlPath = resolve(root, entry.control_file);
      const record = JSON.parse(await readFile(controlPath, 'utf8'));
      const summaryPath = resolve(dirname(controlPath), record.metrics?.summary_file || '');
      const summaryRaw = await readFile(summaryPath);
      const summary = JSON.parse(summaryRaw.toString('utf8'));
      record.artifact = {
        sha256: createHash('sha256').update(summaryRaw).digest('hex'),
        ...inspectSummaryArtifact(summary),
      };
      return record;
    } catch {
      return null;
    }
  }));
  const decision = evaluateCapacityGate(manifest, controls);
  process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  if (decision.decision !== 'GO') process.exitCode = 2;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || 'CAPACITY_GATE_FAILED')}\n`);
    process.exitCode = 1;
  });
}

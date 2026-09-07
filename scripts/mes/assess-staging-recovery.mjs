import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const zero = value => Number.isSafeInteger(value) && value === 0;
// Evidence assessment only: does not fetch a database, validate signatures, or
// grant production rollout authority. A trusted capture must accompany the input.
export function assessStagingRecovery(input) {
  const e = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const gates = {
    evidence_version: e.schema_version === 1,
    staging_identity: e.staging_ref === 'smnsihksrhzbkhcbdjfu'
      && e.parent_ref === 'uozuzdfvnufsjsonswag' && e.is_default === false,
    branch_migrations: e.branch_status === 'FUNCTIONS_DEPLOYED' && e.branch_migrations_passed === true,
    foundation_tables: zero(e.foundation?.missing_tables),
    foundation_rls: zero(e.foundation?.rls_disabled),
    foundation_privileges: zero(e.foundation?.unexpected_effective_privileges),
    preserved_identities: zero(e.foundation?.identity_differences),
    flags_disabled: zero(e.flags_enabled),
    migration_drift: zero(e.migration_drift_count),
    structural_health: e.structural_health_pass === true,
    operator_shift_provenance: e.operator_shift_provenance_validated === true,
    physical_restore_drill: e.physical_restore_drill_pass === true,
    no_active_executor: zero(e.active_executors),
    no_idle_transaction: zero(e.idle_in_transaction),
    no_waiting_locks: zero(e.waiting_locks),
  };
  const blocking_reasons = Object.keys(gates).filter(k => !gates[k]);
  return { schema_version: 1, decision: blocking_reasons.length ? 'HOLD_PHASE1' : 'READY_FOR_PHASE2_ONLY',
    gates, blocking_reasons, production_rollout_authorized: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('usage');
    const result = assessStagingRecovery(JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8')));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.decision === 'HOLD_PHASE1' ? 2 : 0;
  } catch {
    process.stderr.write('Expected one readable versioned recovery-evidence JSON file.\n');
    process.exitCode = 1;
  }
}

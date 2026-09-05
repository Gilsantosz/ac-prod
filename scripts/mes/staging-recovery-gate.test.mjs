import assert from 'node:assert/strict';
import test from 'node:test';
import { assessStagingRecovery } from './assess-staging-recovery.mjs';

const complete = () => ({ schema_version: 1, staging_ref: 'smnsihksrhzbkhcbdjfu',
  parent_ref: 'uozuzdfvnufsjsonswag', is_default: false, branch_status: 'FUNCTIONS_DEPLOYED',
  branch_migrations_passed: true,
  foundation: { missing_tables: 0, rls_disabled: 0, unexpected_effective_privileges: 0, identity_differences: 0 },
  flags_enabled: 0, migration_drift_count: 0, structural_health_pass: true,
  operator_shift_provenance_validated: true, physical_restore_drill_pass: true,
  active_executors: 0, idle_in_transaction: 0, waiting_locks: 0 });

test('complete phase-one evidence only permits phase two, never production rollout', () => {
  const result = assessStagingRecovery(complete());
  assert.equal(result.decision, 'READY_FOR_PHASE2_ONLY');
  assert.equal(result.production_rollout_authorized, false);
});

test('missing, unknown or coercible values never convert an incomplete gate to PASS', () => {
  for (const value of [null, undefined, false, [], {}, '']) assert.equal(assessStagingRecovery(value).decision, 'HOLD_PHASE1');
  for (const field of Object.keys(complete())) {
    const e = complete(); delete e[field];
    assert.equal(assessStagingRecovery(e).decision, 'HOLD_PHASE1', field);
  }
  for (const bad of [null, undefined, '0', false, NaN, Infinity, -1, 0.5, 1]) {
    for (const field of ['flags_enabled','migration_drift_count','active_executors','idle_in_transaction','waiting_locks']) {
      assert.equal(assessStagingRecovery({ ...complete(), [field]: bad }).decision, 'HOLD_PHASE1');
    }
    assert.equal(assessStagingRecovery({ ...complete(), foundation: { ...complete().foundation, missing_tables: bad } }).decision, 'HOLD_PHASE1');
  }
});

test('failed branch, prod target, unresolved defaults and missing restore block independently', () => {
  for (const patch of [
    { staging_ref: 'uozuzdfvnufsjsonswag' }, { is_default: true }, { branch_status: 'MIGRATIONS_FAILED' },
    { branch_status: 'UNKNOWN' }, { migration_drift_count: 173 }, { structural_health_pass: 'true' },
    { operator_shift_provenance_validated: false }, { physical_restore_drill_pass: false },
    { foundation: { ...complete().foundation, unexpected_effective_privileges: 1 } },
  ]) assert.equal(assessStagingRecovery({ ...complete(), ...patch }).decision, 'HOLD_PHASE1');
});

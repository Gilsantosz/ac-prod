import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(resolve(
  'supabase/migrations/20260903131718_pr63_capacity_go_no_go_hardening.sql',
), 'utf8');
const recoveryMigration = readFileSync(resolve(
  'supabase/migrations/20260903143000_pr63_capacity_fixture_and_stale_executor_recovery.sql',
), 'utf8');
const seedScript = readFileSync(resolve('tests/capacity/seed-capacity-fixture.mjs'), 'utf8');
const authFixtureScript = readFileSync(resolve('tests/capacity/prepare-auth-fixture.mjs'), 'utf8');
const cleanupFixtureScript = readFileSync(resolve('tests/capacity/cleanup-capacity-fixture.mjs'), 'utf8');

describe('capacity control-plane database contract', () => {
  it('allows only one active run and exposes executor RPCs only to service_role', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS capacity_test_runs_single_active_idx');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.claim_capacity_test_run_v3');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.observe_capacity_test_run_v3');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.finish_capacity_test_run_v3');
    expect(migration).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO service_role;');
  });

  it('uses a locked transition matrix and makes emergency-stop terminal', () => {
    const control = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.control_capacity_test_run'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.inspect_capacity_test_run_v3'),
    );
    expect(control).toContain('FOR UPDATE');
    expect(control).toContain("p_action = 'pause' AND v_row.status = 'running'");
    expect(control).toContain("p_action = 'resume' AND v_row.status = 'paused'");
    expect(control).toContain("THEN 'emergency_stopped'");
    expect(control).toContain("stop_reason = CASE");
    expect(control).toContain('control_revision = control_revision + 1');
  });

  it('binds the audited request limits to the selected versioned profile', () => {
    expect(migration).toContain('CAPACITY_TEST_PROFILE_CONFIG_MISMATCH');
    expect(migration).toContain("v_profile = 'nominal' AND v_devices = 100 AND v_pieces = 18000");
    expect(migration).toContain("v_profile = 'burst' AND v_devices = 100 AND v_pieces = 6000");
  });

  it('renews only an unexpired owned worker lease and records dispatch timing', () => {
    const renew = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.renew_collection_worker_lease_v3'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.begin_collection_worker_lease_v3'),
    );
    expect(renew).toContain('lease_owner = p_lease_owner');
    expect(renew).toContain('expires_at > v_now');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.claim_collection_worker_batch_v3');
    expect(migration).toContain('IF NOT public.renew_collection_worker_lease_v3(');
    expect(migration).toContain('p_worker_kind, p_lease_owner, 120');
    expect(migration).toContain("'wake_enqueued_at', v_wake_enqueued_at");
    expect(migration).toContain('begin_collection_worker_lease_v3');
  });

  it('indexes the creator FK and evaluates auth.uid once in the RLS policy', () => {
    expect(migration).toContain('capacity_test_runs_created_by_idx');
    expect(migration).toContain('profile.id = (SELECT auth.uid())');
  });

  it('seeds the full profile mass and paginates all 18,000 nominal codes', () => {
    expect(seedScript).toContain('seed_capacity_fixture_v4');
    expect(recoveryMigration).toContain("WHEN 'nominal' THEN 18000");
    expect(recoveryMigration).toContain('generate_series(v_base_pieces + 1, v_fixture_pieces)');
    expect(authFixtureScript).toContain('offset=${offset}');
    expect(authFixtureScript).toContain('rows.length !== expectedFixturePieces');
  });

  it('creates every device session and uses real profile-specific contention contexts', () => {
    expect(authFixtureScript).toContain('deviceIndex < requirement.devices');
    expect(authFixtureScript).toContain("profile === 'atomic8'");
    expect(authFixtureScript).toContain('machine = contentionMachines[deviceIndex]');
    expect(recoveryMigration).toContain("WHEN 'contention_cell_lot' THEN 50");
    expect(recoveryMigration).toContain("'capacity_role', 'contention'");
  });

  it('retries only safe preparation calls and can clean an uncheckpointed Auth user', () => {
    expect(authFixtureScript).toContain('{ retrySafe = false }');
    expect(authFixtureScript).toContain('}, serviceKey, { retrySafe: true });');
    expect(cleanupFixtureScript).toContain('process.env.SUPABASE_URL');
    expect(cleanupFixtureScript).toContain('metadata.test_run_id === runId');
    expect(cleanupFixtureScript).toContain("metadata.created_by === 'capacity_test'");
  });

  it('fails a stale executor-owned run instead of reclaiming it concurrently', () => {
    const staleRecovery = recoveryMigration.slice(
      recoveryMigration.indexOf('CREATE OR REPLACE FUNCTION public.fail_stale_capacity_test_run_v3'),
      recoveryMigration.indexOf('REVOKE ALL ON FUNCTION public.fail_stale_capacity_test_run_v3'),
    );
    expect(staleRecovery).toContain('FOR UPDATE');
    expect(staleRecovery).toContain("interval '15 seconds'");
    expect(staleRecovery).toContain("SET status = 'failed'");
    expect(staleRecovery).toContain("stop_reason = 'executor_heartbeat_expired'");
    expect(staleRecovery).not.toContain("SET status = 'running'");
    expect(recoveryMigration).toContain('AND v_row.stop_reason IS NOT NULL');
    expect(recoveryMigration).toContain('THEN v_row.stop_reason');
  });
});

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const acceptancePath =
  'supabase/tests/20260901_collection_fabric_v3_acceptance.sql';
const migrationDirectory = resolve(process.cwd(), 'supabase/migrations');
const acceptance = readFileSync(resolve(process.cwd(), acceptancePath), 'utf8');
const v3MigrationPaths = readdirSync(migrationDirectory)
  .filter((name) => /^2026090112\d{4}_collection_fabric_v3_.*\.sql$/.test(name))
  .sort()
  .map((name) => resolve(migrationDirectory, name));
const migrations = v3MigrationPaths.map((path) => readFileSync(path, 'utf8')).join('\n');

describe('Collection Fabric v3 database acceptance contract', () => {
  it('is a rollback-only SQL acceptance test', () => {
    expect(existsSync(resolve(process.cwd(), acceptancePath))).toBe(true);
    expect(acceptance.trimStart()).toMatch(/^--[\s\S]*?\nBEGIN;/);
    expect(acceptance).toContain("SET LOCAL statement_timeout = '60s'");
    expect(acceptance).toContain("SET LOCAL lock_timeout = '2s'");
    expect(acceptance).not.toMatch(/\bCOMMIT\s*;/i);
    expect(acceptance.trimEnd()).toMatch(
      /ROLLBACK;\s*SELECT 'COLLECTION_FABRIC_V3_ACCEPTANCE_OK' AS result;$/,
    );
  });

  it('pins the exact ingress and decision RPC signatures and the 25-item ceiling', () => {
    [
      'public.get_collection_pipeline_flags_v3()',
      'public.get_collection_runtime_health_v3()',
      'public.ingest_collection_batch_v3(uuid,uuid,jsonb)',
      'public.claim_collection_batch_v3(text,integer)',
      'private.process_collection_batch_v3(text,jsonb)',
      'public.process_collection_batch_v3(text,jsonb)',
      'public.set_collection_pipeline_flag_v3(text,boolean,jsonb)',
    ].forEach((signature) => expect(acceptance).toContain(signature));

    expect(acceptance).toContain('COLLECTION_BATCH_SIZE_INVALID');
    expect(acceptance).toContain('COLLECTION_PROCESSING_BATCH_SIZE_INVALID');
    expect(acceptance).toContain('COLLECTION_PROJECTION_BATCH_SIZE_INVALID');
    expect(acceptance).toContain('generate_series(1, 26)');
    expect(acceptance).toContain('least(coalesce(p_limit, 10), 25)');
    expect(acceptance).toContain('COLLECTION_PIPELINE_V3_INGRESS_DISABLED');
    expect(acceptance).toContain('COLLECTION_PIPELINE_V3_WORKER_DISABLED');
    expect(acceptance).toContain('ENABLE_COLLECTION_V3_INGRESS_BEFORE_WORKER');
    expect(acceptance).toContain('acceptance-v3-missing-worker-flag');
    expect(acceptance).toContain("PERFORM pgmq.send(\n    'collection_live_v3'");
  });

  it('covers durable queue isolation, idempotency, guards, immutable attempts and shards', () => {
    [
      'collection_live_v3',
      'collection_replay_v3',
      'collection_projection_v3',
      'collection_dead_letter_v3',
      "has_schema_privilege('anon', 'pgmq', 'USAGE')",
      "has_schema_privilege('authenticated', 'pgmq', 'USAGE')",
      'duplicate_receipt',
      'idempotent_replay',
      'trg_sync_production_lot_stage_aggregate',
      'trg_sync_realtime_counter_stage_readings',
      'trg_sync_reading_to_event',
      'original_definition_sha256',
      'COLLECTION_ATTEMPT_IDENTITY_IS_IMMUTABLE',
      'COLLECTION_ATTEMPT_IS_IMMUTABLE',
      "has_table_privilege('service_role', 'public.collection_processing_attempts', 'DELETE')",
      "has_table_privilege('service_role', 'public.collection_processing_attempts', 'TRUNCATE')",
      'public.collection_projection_outbox',
      'public.collection_projection_applied',
      'public.production_lot_stage_counter_shards',
      'public.production_lot_stage_counter_totals_v3',
    ].forEach((marker) => expect(acceptance).toContain(marker));
  });

  it('matches every currently materialized RPC to a versioned migration', () => {
    [
      'get_collection_pipeline_flags_v3',
      'get_collection_runtime_health_v3',
      'ingest_collection_batch_v3',
      'claim_collection_batch_v3',
      'private.process_collection_batch_v3',
      'public.process_collection_batch_v3',
      'set_collection_pipeline_flag_v3',
    ].forEach((name) => expect(migrations).toContain(name));

    expect(migrations).toContain('REVOKE ALL ON SCHEMA pgmq FROM PUBLIC, anon, authenticated');
    expect(migrations).toContain('IF NOT coalesce(v_worker_enabled, false) THEN');
    expect(migrations).toContain(
      'REVOKE DELETE, TRUNCATE ON TABLE public.collection_processing_attempts',
    );
    expect(migrations).toContain('collection_projection_trigger_registry');
    expect(migrations).toContain('guard_installed');
  });

  it('keeps PostgreSQL 17 UUID resolution and the v2 claim row contract compatible', () => {
    expect(migrations).not.toMatch(/min\s*\(\s*candidate\.id\s*\)/i);
    expect(migrations).toMatch(
      /array_agg\s*\(\s*candidate\.id\s+order by\s+candidate\.id\s*\)/i,
    );
    expect(migrations).toMatch(
      /claim_collection_inbox[\s\S]*?returns table\s*\(\s*coleta_id uuid/i,
    );
  });

  it('projects authoritative corrections without double-counting approved entries', () => {
    expect(migrations).toContain('projection_revision integer NOT NULL DEFAULT 0');
    expect(migrations).toContain('UNIQUE (client_event_id, projection_revision)');
    expect(migrations).toContain('enqueue_collection_projection_correction_v3');
    expect(migrations).toContain('trg_collection_v3_projection_correction');
    expect(migrations).toContain("'legacy_production_entry_reversal'");
    expect(migrations).toContain("v_item.previous_decision = 'approved'");
    expect(migrations).toContain('Aprovações são contabilizadas pelo trigger de production_entries');
    expect(migrations).toContain("'outbox_id', v_item.outbox_id");
    expect(migrations).toContain("'delta', jsonb_build_object(");
  });

  it('derives worker URLs from the target environment and enforces operational thresholds', () => {
    expect(migrations).not.toContain(
      'https://uozuzdfvnufsjsonswag.supabase.co/functions/v1/process-collection-v3',
    );
    expect(migrations).toContain("current_setting('app.settings.supabase_url', true)");
    expect(migrations).toContain('COLLECTION_V3_DECISION_URL_ENVIRONMENT_MISMATCH');
    expect(migrations).toContain('ingress_p95 <= 250');
    expect(migrations).toContain('processing_p95 <= 800 AND processing_p99 <= 2000');
    expect(migrations).toContain('retry_rate <= 0.01');
  });

  it('activates the projector and Realtime assertions as soon as their migrations exist', () => {
    const projectorContract = [
      'public.claim_collection_projection_batch_v3(text,integer)',
      'private.process_collection_projection_batch_v3(text,jsonb)',
      'public.process_collection_projection_batch_v3(text,jsonb)',
      'public.reconcile_collection_projection_shards_v3(uuid,text)',
    ];
    const realtimePolicies = [
      'collection_v3_device_broadcast_select',
      'collection_v3_cell_broadcast_select',
      'collection_v3_event_broadcast_select',
    ];

    projectorContract.forEach((signature) => expect(acceptance).toContain(signature));
    realtimePolicies.forEach((policy) => expect(acceptance).toContain(policy));

    const projectorMigrationExists = migrations.includes(
      'CREATE OR REPLACE FUNCTION public.claim_collection_projection_batch_v3',
    );
    if (projectorMigrationExists) {
      projectorContract.forEach((signature) => {
        const functionName = signature.slice(0, signature.indexOf('('));
        expect(migrations).toContain(`CREATE OR REPLACE FUNCTION ${functionName}`);
      });
    }

    const realtimeMigrationExists = realtimePolicies.some((policy) =>
      migrations.includes(policy));
    if (realtimeMigrationExists) {
      realtimePolicies.forEach((policy) => expect(migrations).toContain(policy));
      expect(migrations).toContain('ON realtime.messages');
      expect(migrations).toContain('collection:device:');
      expect(migrations).toContain('collection:cell:');
      expect(migrations).toContain('collection:event:');
    }
  });
});

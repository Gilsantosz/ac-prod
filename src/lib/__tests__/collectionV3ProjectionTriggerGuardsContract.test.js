import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath =
  'supabase/migrations/20260901122000_collection_fabric_v3_projection_trigger_guards.sql';
const migration = readFileSync(resolve(process.cwd(), migrationPath), 'utf8');

describe('Collection Fabric v3 projection trigger guards', () => {
  it('captura o contrato real dos três triggers sem inventar seus corpos', () => {
    [
      'trg_sync_production_lot_stage_aggregate',
      'trg_sync_realtime_counter_stage_readings',
      'trg_sync_reading_to_event',
    ].forEach((triggerName) => expect(migration).toContain(`'${triggerName}'`));

    expect(migration).toContain('pg_get_triggerdef(trigger_row.oid, false)');
    expect(migration).toContain("extensions.digest(pg_get_triggerdef(trigger_row.oid, false), 'sha256')");
    expect(migration).toContain('trigger_row.tgfoid::regprocedure AS function_name');
    expect(migration).toContain('original_definition_sha256');
    expect(migration).not.toMatch(/CREATE TRIGGER trg_sync_(production|realtime|reading)/);
  });

  it('preserva metadados do catálogo e divide INSERT UPDATE DELETE com guards próprios', () => {
    expect(migration).toContain('trigger_row.tgtype');
    expect(migration).toContain('trigger_row.tgattr');
    expect(migration).toContain('trigger_row.tgqual');
    expect(migration).toContain('trigger_row.tgargs');
    expect(migration).toContain('pg_get_expr(v_trigger.tgqual, v_trigger.tgrelid, true)');
    expect(migration).toContain('UPDATE OF ');
    expect(migration).toContain("array_append(v_events, 'INSERT')");
    expect(migration).toContain("array_append(v_events, 'UPDATE')");
    expect(migration).toContain("array_append(v_events, 'DELETE')");
    expect(migration).toContain("'coalesce(NEW.pipeline_version, 2) <> 3'");
    expect(migration).toContain(
      "'coalesce(NEW.pipeline_version, OLD.pipeline_version, 2) <> 3'",
    );
    expect(migration).toContain("'coalesce(OLD.pipeline_version, 2) <> 3'");
    expect(migration).toContain('IF v_is_first_event THEN');
    expect(migration).toContain('v_installed_name := v_target_name');
    expect(migration).toContain('quote_literal(v_arg_value)');
  });

  it('recusa formatos que não podem receber um guard row-level seguro', () => {
    expect(migration).toContain('COLLECTION_V3_CONSTRAINT_TRIGGER_UNSUPPORTED');
    expect(migration).toContain('COLLECTION_V3_STATEMENT_TRIGGER_UNSUPPORTED');
    expect(migration).toContain('COLLECTION_V3_TRUNCATE_TRIGGER_UNSUPPORTED');
    expect(migration).toContain('COLLECTION_V3_TRANSITION_TABLE_TRIGGER_UNSUPPORTED');
    expect(migration).toContain('trigger_row.tgconstraint');
    expect(migration).toContain('trigger_row.tgoldtable');
    expect(migration).toContain('trigger_row.tgnewtable');
    expect(migration).toContain('COLLECTION_V3_PROJECTION_TRIGGER_MISSING');
    expect(migration).toContain('CONTINUE;');
  });

  it('é idempotente, detecta drift e restaura somente nomes instalados', () => {
    expect(migration).toContain('v_guard_complete');
    expect(migration).toContain('COLLECTION_V3_ORIGINAL_TRIGGER_DRIFT');
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION private.restore_collection_v3_projection_triggers()',
    );
    expect(migration).toContain('FOREACH v_installed_name IN ARRAY v_registry.installed_trigger_names');
    expect(migration).toContain('EXECUTE v_registry.original_definition');
    expect(migration).toContain("'collection_pipeline_v3_worker'");
    expect(migration).toContain("'collection_pipeline_v3_projection'");
    expect(migration).toContain('SET enabled = false');
    expect(migration).toContain('guard_installed = false');
    expect(migration).not.toContain(
      'DELETE FROM private.collection_projection_trigger_registry',
    );
    expect(migration).not.toContain(
      'TRUNCATE TABLE private.collection_projection_trigger_registry',
    );
  });

  it('não expõe registry nem restore ao browser ou service role', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION private.restore_collection_v3_projection_triggers()',
    );
    expect(migration).toContain('FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain(
      'REVOKE ALL ON TABLE private.collection_projection_trigger_registry',
    );
    expect(migration).toContain('TO postgres');
    expect(migration).not.toContain(
      'GRANT EXECUTE ON FUNCTION private.restore_collection_v3_projection_triggers()\n  TO service_role',
    );
  });
});

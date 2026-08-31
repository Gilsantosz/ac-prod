-- Public, non-sensitive deployment probe used by GitHub Actions.
-- It exposes only the applied release/version and a small set of boolean flags.

INSERT INTO public.app_schema_releases(version,checksum,notes)
VALUES ('20260831_acprod_collection_db_v7','collection-v7-public-release-probe','Marcador fail-closed para comprovação remota da versão do banco antes do deploy do front-end.')
ON CONFLICT(version) DO UPDATE SET checksum=excluded.checksum,notes=excluded.notes;

CREATE OR REPLACE FUNCTION public.get_public_collection_release()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
SELECT jsonb_build_object(
  'ready',to_regprocedure('public.process_production_reading_v2(jsonb)') IS NOT NULL
    AND to_regprocedure('public.resolve_operator_shift_window(uuid,timestamptz)') IS NOT NULL
    AND to_regprocedure('public.recalculate_cell_lot_state(uuid,text,text,uuid,uuid)') IS NOT NULL
    AND to_regclass('public.production_cell_lot_states') IS NOT NULL
    AND to_regclass('public.production_cell_active_contexts') IS NOT NULL,
  'migration_version',coalesce((SELECT migration.version FROM supabase_migrations.schema_migrations migration WHERE migration.name='publish_collection_release_probe_v7' ORDER BY migration.version DESC LIMIT 1),''),
  'release_version','20260831_acprod_collection_db_v7',
  'schema_flags',jsonb_build_object(
    'shift_columns',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='operators' AND column_name='shift_start_time') AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='operators' AND column_name='shift_end_time'),
    'cell_lifecycle',to_regclass('public.production_cell_lot_states') IS NOT NULL,
    'active_context',to_regclass('public.production_cell_active_contexts') IS NOT NULL,
    'reading_v2',to_regprocedure('public.process_production_reading_v2(jsonb)') IS NOT NULL,
    'history_compatibility',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='production_stage_readings' AND column_name='raw_value') AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='production_stage_readings' AND column_name='traceability_code')
  )
);
$$;
REVOKE ALL ON FUNCTION public.get_public_collection_release() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_collection_release() TO anon,authenticated;

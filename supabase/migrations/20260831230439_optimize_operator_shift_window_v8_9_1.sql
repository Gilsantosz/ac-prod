-- AC.Prod2 v8.9.1 — janela de turno em tempo constante.
-- Evita varrer pg_timezone_names em cada atualização do KPI de turno.

CREATE OR REPLACE FUNCTION public.resolve_operator_shift_window(
  p_operator_id uuid,
  p_reference_time timestamptz DEFAULT clock_timestamp()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_op public.operators%ROWTYPE;
  v_tz text;
  v_local_ref timestamp;
  v_local_date date;
  v_local_time time;
  v_work_date date;
  v_start_local timestamp;
  v_end_local timestamp;
  v_inside boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_op
  FROM public.operators
  WHERE id = p_operator_id;

  IF v_op.id IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  v_tz := coalesce(nullif(v_op.timezone, ''), 'America/Sao_Paulo');
  BEGIN
    v_local_ref := p_reference_time AT TIME ZONE v_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'America/Sao_Paulo';
    v_local_ref := p_reference_time AT TIME ZONE v_tz;
  END;

  v_local_date := v_local_ref::date;
  v_local_time := v_local_ref::time;

  IF v_op.shift_start_time < v_op.shift_end_time THEN
    v_work_date := v_local_date;
    v_start_local := v_local_date + v_op.shift_start_time;
    v_end_local := v_local_date + v_op.shift_end_time;
    v_inside := v_local_time >= v_op.shift_start_time
      AND v_local_time < v_op.shift_end_time;
  ELSE
    IF v_local_time >= v_op.shift_start_time THEN
      v_work_date := v_local_date;
      v_start_local := v_local_date + v_op.shift_start_time;
      v_end_local := (v_local_date + 1) + v_op.shift_end_time;
      v_inside := true;
    ELSIF v_local_time < v_op.shift_end_time THEN
      v_work_date := v_local_date - 1;
      v_start_local := (v_local_date - 1) + v_op.shift_start_time;
      v_end_local := v_local_date + v_op.shift_end_time;
      v_inside := true;
    ELSE
      v_work_date := v_local_date;
      v_start_local := v_local_date + v_op.shift_start_time;
      v_end_local := (v_local_date + 1) + v_op.shift_end_time;
      v_inside := false;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'operator_id', v_op.id,
    'shift_name', v_op.shift,
    'shift_start_time', v_op.shift_start_time,
    'shift_end_time', v_op.shift_end_time,
    'timezone', v_tz,
    'shift_work_date', v_work_date,
    'shift_started_at', v_start_local AT TIME ZONE v_tz,
    'shift_ends_at', v_end_local AT TIME ZONE v_tz,
    'is_inside_shift', v_inside
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_collection_sync_release()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, cron, pg_temp
AS $$
  WITH async_base AS (
    SELECT public.get_public_collection_async_release() AS release
  ),
  token_kpi_definition AS (
    SELECT lower(pg_get_functiondef(
      'public.get_operator_shift_kpis_v2(text,timestamptz)'::regprocedure
    )) AS definition
  ),
  uuid_kpi_definition AS (
    SELECT lower(pg_get_functiondef(
      'public.get_operator_shift_kpis_v2(uuid,timestamptz)'::regprocedure
    )) AS definition
  ),
  wake_definition AS (
    SELECT lower(pg_get_functiondef(
      'private.wake_collection_inbox_worker(text,integer)'::regprocedure
    )) AS definition
  ),
  shift_window_definition AS (
    SELECT lower(pg_get_functiondef(
      'public.resolve_operator_shift_window(uuid,timestamptz)'::regprocedure
    )) AS definition
  ),
  flags AS (
    SELECT jsonb_build_object(
      'collection_sync_async_base_ready',
        coalesce((async_base.release ->> 'ready')::boolean, false),
      'collection_sync_operator_kpis_event_ledger',
        (SELECT position('production_collection_events' in definition) > 0
                AND position('production_stage_readings' in definition) = 0
         FROM token_kpi_definition)
        AND
        (SELECT position('production_collection_events' in definition) > 0
                AND position('production_stage_readings' in definition) = 0
         FROM uuid_kpi_definition),
      'collection_sync_operator_covering_index',
        to_regclass('public.idx_collection_events_operator_window_cover_v89')
          IS NOT NULL,
      'collection_sync_manual_stage_index',
        to_regclass('public.idx_manual_production_batch_stage_approved_v89')
          IS NOT NULL,
      'collection_sync_worker_claim_index',
        to_regclass('public.idx_coletas_producao_worker_claim_v89') IS NOT NULL,
      'collection_sync_worker_five_rounds',
        (SELECT position('''max_rounds'', 5' in definition) > 0
         FROM wake_definition),
      'collection_sync_fallback_five_seconds',
        EXISTS (
          SELECT 1
          FROM cron.job
          WHERE jobname = 'run-process-collection-inbox'
            AND active IS TRUE
            AND schedule = '5 seconds'
        ),
      'collection_sync_shift_window_constant_time',
        (SELECT position('pg_timezone_names' in definition) = 0
                AND position('exception when invalid_parameter_value' in definition) > 0
         FROM shift_window_definition)
    ) AS value
    FROM async_base
  )
  SELECT jsonb_build_object(
    'ready', NOT EXISTS (
      SELECT 1
      FROM flags, jsonb_each_text(flags.value) flag
      WHERE flag.value IS DISTINCT FROM 'true'
    ),
    'migration_version', coalesce((
      SELECT migration.version
      FROM supabase_migrations.schema_migrations migration
      WHERE migration.name = 'optimize_operator_shift_window_v8_9_1'
      ORDER BY migration.version DESC
      LIMIT 1
    ), ''),
    'release_version', '20260831_acprod_collection_sync_v8_9_1',
    'schema_flags',
      (async_base.release -> 'schema_flags') || flags.value
  )
  FROM async_base, flags;
$$;

REVOKE ALL ON FUNCTION public.get_public_collection_sync_release()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_collection_sync_release()
  TO anon, authenticated;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260831_acprod_collection_sync_v8_9_1',
  'async-reconciliation-fast-shift-window-no-timezone-catalog-scan',
  'Mantém a reconciliação assíncrona v8.9 e reduz a janela/KPI de turno removendo a varredura do catálogo de fusos a cada atualização.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

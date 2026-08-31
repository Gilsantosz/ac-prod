-- AC.Prod2 v8.9 — reconciliação real do inbox, redução de tempestade e KPIs rápidos.
--
-- O caminho de escrita permanece assíncrono (v8.7). Este release reduz o tempo
-- até a decisão final, otimiza o KPI de turno e publica um marcador fail-closed
-- para impedir front-end incompatível com o banco.

CREATE INDEX IF NOT EXISTS idx_collection_events_operator_window_cover_v89
  ON public.production_collection_events (operator_id, occurred_at DESC)
  INCLUDE (client_event_id, result_status, status);

CREATE INDEX IF NOT EXISTS idx_manual_production_batch_stage_approved_v89
  ON public.manual_production_records (pcp_import_batch_id, stage_code)
  INCLUDE (quantity)
  WHERE traceability_type = 'aggregate_untraceable'
    AND coalesce(status, 'approved') = 'approved';

CREATE INDEX IF NOT EXISTS idx_coletas_producao_worker_claim_v89
  ON public.coletas_producao (
    status_sincronizacao,
    next_attempt_at,
    timestamp_leitura,
    batch_sequence,
    created_at
  )
  WHERE status_sincronizacao IN ('recebida', 'processando');

CREATE OR REPLACE FUNCTION public.get_operator_shift_kpis_v2(
  p_operator_session_token text,
  p_reference_time timestamptz DEFAULT clock_timestamp()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_session public.operator_sessions%ROWTYPE;
  v_window jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_inside boolean;
  v_approved bigint := 0;
  v_rejected bigint := 0;
  v_blocked bigint := 0;
BEGIN
  IF auth.uid() IS NULL OR nullif(btrim(p_operator_session_token), '') IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_SESSION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_session
  FROM public.operator_sessions session
  WHERE session.token_hash = encode(
      extensions.digest(p_operator_session_token, 'sha256'),
      'hex'
    )
    AND session.auth_user_id = auth.uid()
    AND session.ended_at IS NULL
    AND session.revoked_at IS NULL
    AND session.sync_grace_until > clock_timestamp()
  LIMIT 1;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_SESSION_INVALID' USING ERRCODE = '42501';
  END IF;

  v_window := public.resolve_operator_shift_window(
    v_session.operator_id,
    p_reference_time
  );
  v_inside := coalesce((v_window ->> 'is_inside_shift')::boolean, false);
  v_start := (v_window ->> 'shift_started_at')::timestamptz;
  v_end := (v_window ->> 'shift_ends_at')::timestamptz;

  IF v_inside THEN
    SELECT
      count(DISTINCT coalesce(event.client_event_id, event.id::text))
        FILTER (WHERE event.result_status = 'approved'),
      count(DISTINCT coalesce(event.client_event_id, event.id::text))
        FILTER (WHERE event.result_status = 'rejected'),
      count(DISTINCT coalesce(event.client_event_id, event.id::text))
        FILTER (WHERE event.result_status IN ('blocked', 'duplicated'))
    INTO v_approved, v_rejected, v_blocked
    FROM public.production_collection_events event
    WHERE event.operator_id = v_session.operator_id
      AND event.occurred_at >= v_start
      AND event.occurred_at < v_end;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'operator_id', v_session.operator_id,
    'shift_work_date', v_window ->> 'shift_work_date',
    'shift_started_at', v_start,
    'shift_ends_at', v_end,
    'is_inside_shift', v_inside,
    'approved', v_approved,
    'produced_this_shift', v_approved,
    'rejected', v_rejected,
    'blocked', v_blocked,
    'server_time', clock_timestamp()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_operator_shift_kpis_v2(
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
  v_window jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_inside boolean;
  v_approved bigint := 0;
  v_rejected bigint := 0;
  v_blocked bigint := 0;
BEGIN
  IF auth.uid() IS NULL OR p_operator_id IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_SESSION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.operator_sessions session
    WHERE session.operator_id = p_operator_id
      AND session.auth_user_id = auth.uid()
      AND session.ended_at IS NULL
      AND session.revoked_at IS NULL
      AND session.expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'OPERATOR_SESSION_INVALID' USING ERRCODE = '42501';
  END IF;

  v_window := public.resolve_operator_shift_window(p_operator_id, p_reference_time);
  v_inside := coalesce((v_window ->> 'is_inside_shift')::boolean, false);
  v_start := (v_window ->> 'shift_started_at')::timestamptz;
  v_end := (v_window ->> 'shift_ends_at')::timestamptz;

  IF v_inside THEN
    SELECT
      count(DISTINCT coalesce(event.client_event_id, event.id::text))
        FILTER (WHERE event.result_status = 'approved'),
      count(DISTINCT coalesce(event.client_event_id, event.id::text))
        FILTER (WHERE event.result_status = 'rejected'),
      count(DISTINCT coalesce(event.client_event_id, event.id::text))
        FILTER (WHERE event.result_status IN ('blocked', 'duplicated'))
    INTO v_approved, v_rejected, v_blocked
    FROM public.production_collection_events event
    WHERE event.operator_id = p_operator_id
      AND event.occurred_at >= v_start
      AND event.occurred_at < v_end;
  END IF;

  RETURN jsonb_build_object(
    'operator_id', p_operator_id,
    'shift_work_date', v_window ->> 'shift_work_date',
    'shift_started_at', v_start,
    'shift_ends_at', v_end,
    'is_inside_shift', v_inside,
    'approved', v_approved,
    'produced_this_shift', v_approved,
    'rejected', v_rejected,
    'blocked', v_blocked,
    'server_time', clock_timestamp()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_operator_shift_kpis_v2(text, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operator_shift_kpis_v2(text, timestamptz)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_operator_shift_kpis_v2(uuid, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operator_shift_kpis_v2(uuid, timestamptz)
  TO authenticated, service_role;

-- Um wake-up imediato passa a drenar até cinco rodadas. Em uma rajada de 300
-- leituras, o trigger consegue escoar toda a fila sem aguardar o cron fallback.
CREATE OR REPLACE FUNCTION private.wake_collection_inbox_worker(
  p_source text DEFAULT 'database',
  p_limit integer DEFAULT 60
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private, vault, net, pg_temp
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'acprod_collection_worker_url'
  LIMIT 1;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'acprod_collection_worker_secret'
  LIMIT 1;

  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'source', coalesce(nullif(btrim(p_source), ''), 'database'),
      'limit', greatest(1, least(coalesce(p_limit, 60), 100)),
      'concurrency', 8,
      'max_rounds', 5
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    timeout_milliseconds := 2000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION private.wake_collection_inbox_worker(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.notify_collection_inbox_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM new_collection_rows row
    WHERE row.status_sincronizacao = 'recebida'
  ) THEN
    PERFORM private.wake_collection_inbox_worker('insert-trigger', 60);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_collection_inbox_worker()
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'run-process-collection-inbox'
  ) THEN
    PERFORM cron.unschedule('run-process-collection-inbox');
  END IF;

  PERFORM cron.schedule(
    'run-process-collection-inbox',
    '5 seconds',
    $cron$select private.wake_collection_inbox_worker('cron-fallback', 100);$cron$
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
        )
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
      WHERE migration.name = 'collection_sync_reconciliation_v8_9'
      ORDER BY migration.version DESC
      LIMIT 1
    ), ''),
    'release_version', '20260831_acprod_collection_sync_v8_9',
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
  '20260831_acprod_collection_sync_v8_9',
  'frontend-inbox-reconciliation-coalesced-realtime-fast-shift-kpis',
  'Reconciliação separa ACK de decisão final, reduz tempestade de UI/RPC, otimiza KPI de turno pelo ledger de eventos e acelera o wake-up do worker.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

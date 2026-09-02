-- AC.Prod Collection Fabric v3 — isolamento v2/v3, Broadcast privado,
-- wakeups coalescidos, health operacional e gates de rollout.

SET check_function_bodies = on;

-- O fallback v2 continua disponível, mas nunca pode reivindicar um recibo v3.
CREATE OR REPLACE FUNCTION public.claim_collection_inbox(
  p_worker_id text,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  coleta_id uuid,
  client_event_id text,
  auth_user_id uuid,
  tag_lida text,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_worker_id text := coalesce(nullif(btrim(p_worker_id), ''), gen_random_uuid()::text);
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT inbox.id
    FROM public.coletas_producao inbox
    WHERE inbox.pipeline_version = 2
      AND (
        (
          inbox.status_sincronizacao = 'recebida'
          AND inbox.next_attempt_at <= clock_timestamp()
        ) OR (
          inbox.status_sincronizacao = 'processando'
          AND coalesce(inbox.lease_expires_at, '-infinity'::timestamptz)
              <= clock_timestamp()
        )
      )
    ORDER BY inbox.timestamp_leitura, inbox.batch_sequence, inbox.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.coletas_producao inbox
  SET status_sincronizacao = 'processando',
      worker_id = v_worker_id,
      lease_expires_at = clock_timestamp() + interval '45 seconds',
      attempt_count = inbox.attempt_count + 1,
      updated_at = clock_timestamp()
  FROM candidates
  WHERE inbox.id = candidates.id
  RETURNING inbox.id, inbox.client_event_id, inbox.auth_user_id,
            inbox.tag_lida, inbox.attempt_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_collection_inbox(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_collection_inbox(text, integer)
  TO service_role;

-- O wakeup legado também ignora v3; seu trigger pode continuar instalado sem
-- disparar HTTP ocioso quando um micro-lote novo entra.
CREATE OR REPLACE FUNCTION private.wake_collection_inbox_worker(
  p_source text DEFAULT 'database',
  p_limit integer DEFAULT 60
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, vault, net, pg_temp
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_request_id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.coletas_producao inbox
    WHERE inbox.pipeline_version = 2
      AND (
        (
          inbox.status_sincronizacao = 'recebida'
          AND coalesce(inbox.next_attempt_at, '-infinity'::timestamptz)
              <= clock_timestamp()
        ) OR (
          inbox.status_sincronizacao = 'processando'
          AND coalesce(inbox.lease_expires_at, '-infinity'::timestamptz)
              <= clock_timestamp()
        )
      )
  ) THEN
    RETURN NULL;
  END IF;

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
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION private.wake_collection_inbox_worker(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.wake_collection_inbox_worker(text, integer)
  TO postgres, service_role;

-- Broadcast é somente leitura para clientes; publicação continua restrita ao
-- service_role/realtime.send. Uma política por escopo mantém a auditoria clara.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_v3_device_broadcast_select
  ON realtime.messages;
CREATE POLICY collection_v3_device_broadcast_select
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND (SELECT realtime.topic()) LIKE 'collection:device:%'
    AND EXISTS (
      SELECT 1
      FROM public.operator_sessions session
      WHERE session.auth_user_id = (SELECT auth.uid())
        AND session.device_id = split_part((SELECT realtime.topic()), ':', 3)
        AND session.revoked_at IS NULL
        AND coalesce(session.sync_grace_until, session.expires_at) > clock_timestamp()
    )
  );

DROP POLICY IF EXISTS collection_v3_cell_broadcast_select
  ON realtime.messages;
CREATE POLICY collection_v3_cell_broadcast_select
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND (SELECT realtime.topic()) LIKE 'collection:cell:%'
    AND EXISTS (
      SELECT 1
      FROM public.operator_sessions session
      JOIN public.operator_cell_assignments assignment
        ON assignment.operator_id = session.operator_id
       AND assignment.cell_id = session.cell_id
       AND assignment.active IS TRUE
       AND assignment.valid_from <= clock_timestamp()
       AND (
         assignment.valid_until IS NULL
         OR assignment.valid_until >= clock_timestamp()
       )
      WHERE session.auth_user_id = (SELECT auth.uid())
        AND session.cell_id::text = split_part((SELECT realtime.topic()), ':', 3)
        AND session.revoked_at IS NULL
        AND coalesce(session.sync_grace_until, session.expires_at) > clock_timestamp()
    )
  );

DROP POLICY IF EXISTS collection_v3_event_broadcast_select
  ON realtime.messages;
CREATE POLICY collection_v3_event_broadcast_select
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND (SELECT realtime.topic()) LIKE 'collection:event:%'
    AND EXISTS (
      SELECT 1
      FROM public.coletas_producao receipt
      WHERE receipt.auth_user_id = (SELECT auth.uid())
        AND receipt.client_event_id = split_part((SELECT realtime.topic()), ':', 3)
        AND receipt.pipeline_version = 3
    )
  );

REVOKE INSERT, UPDATE, DELETE ON TABLE realtime.messages
  FROM anon, authenticated;

-- Endpoints e segredo são mantidos no Vault. Nenhuma service key é persistida
-- em tabela pública ou enviada ao navegador.
DO $vault$
DECLARE
  v_project_url text := nullif(
    regexp_replace(
      coalesce(current_setting('app.settings.supabase_url', true), ''),
      '/+$',
      ''
    ),
    ''
  );
  v_existing_url text;
BEGIN
  IF v_project_url IS NULL THEN
    SELECT nullif(regexp_replace(decrypted_secret, '/+$', ''), '')
    INTO v_project_url
    FROM vault.decrypted_secrets
    WHERE name IN ('project_url', 'supabase_url')
    ORDER BY CASE name WHEN 'project_url' THEN 0 ELSE 1 END
    LIMIT 1;
  END IF;

  IF v_project_url IS NULL THEN
    SELECT substring(
      decrypted_secret
      FROM '^(https://[a-z0-9-]+[.]supabase[.]co)'
    )
    INTO v_project_url
    FROM vault.decrypted_secrets
    WHERE name = 'acprod_collection_worker_url'
    LIMIT 1;
  END IF;

  IF v_project_url IS NOT NULL
     AND v_project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' THEN
    RAISE EXCEPTION 'COLLECTION_V3_PROJECT_URL_INVALID'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'acprod_collection_v3_decision_url'
  ) AND v_project_url IS NOT NULL THEN
    PERFORM vault.create_secret(
      v_project_url || '/functions/v1/process-collection-v3',
      'acprod_collection_v3_decision_url',
      'Endpoint interno do worker de decisão Collection Fabric v3'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'acprod_collection_v3_projection_url'
  ) AND v_project_url IS NOT NULL THEN
    PERFORM vault.create_secret(
      v_project_url || '/functions/v1/project-collection-v3',
      'acprod_collection_v3_projection_url',
      'Endpoint interno do projetor Collection Fabric v3'
    );
  END IF;

  IF v_project_url IS NULL THEN
    RAISE WARNING 'COLLECTION_V3_PROJECT_URL_UNAVAILABLE: worker flags remain fail-closed';
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_existing_url
  FROM vault.decrypted_secrets
  WHERE name = 'acprod_collection_v3_decision_url'
  LIMIT 1;
  IF v_existing_url IS DISTINCT FROM
     v_project_url || '/functions/v1/process-collection-v3' THEN
    RAISE EXCEPTION 'COLLECTION_V3_DECISION_URL_ENVIRONMENT_MISMATCH'
      USING ERRCODE = '22023';
  END IF;

  SELECT decrypted_secret INTO v_existing_url
  FROM vault.decrypted_secrets
  WHERE name = 'acprod_collection_v3_projection_url'
  LIMIT 1;
  IF v_existing_url IS DISTINCT FROM
     v_project_url || '/functions/v1/project-collection-v3' THEN
    RAISE EXCEPTION 'COLLECTION_V3_PROJECTION_URL_ENVIRONMENT_MISMATCH'
      USING ERRCODE = '22023';
  END IF;
END;
$vault$;

CREATE OR REPLACE FUNCTION private.wake_collection_v3_worker(
  p_worker_kind text,
  p_source text DEFAULT 'database',
  p_limit integer DEFAULT 25
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, vault, net, pgmq, pg_temp
AS $$
DECLARE
  v_url_name text;
  v_queue_name text;
  v_flag_name text;
  v_url text;
  v_secret text;
  v_request_id bigint;
  v_has_work boolean := false;
BEGIN
  IF p_worker_kind = 'decision' THEN
    v_url_name := 'acprod_collection_v3_decision_url';
    v_flag_name := 'collection_pipeline_v3_worker';
    SELECT EXISTS (
      SELECT 1 FROM pgmq.q_collection_live_v3 queue WHERE queue.vt <= clock_timestamp()
      UNION ALL
      SELECT 1 FROM pgmq.q_collection_replay_v3 queue WHERE queue.vt <= clock_timestamp()
    ) INTO v_has_work;
  ELSIF p_worker_kind = 'projection' THEN
    v_url_name := 'acprod_collection_v3_projection_url';
    v_flag_name := 'collection_pipeline_v3_projection';
    SELECT EXISTS (
      SELECT 1
      FROM pgmq.q_collection_projection_v3 queue
      WHERE queue.vt <= clock_timestamp()
    ) INTO v_has_work;
  ELSE
    RAISE EXCEPTION 'COLLECTION_V3_WORKER_KIND_INVALID'
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_has_work OR NOT EXISTS (
    SELECT 1 FROM private.collection_pipeline_flags flag
    WHERE flag.flag_name = v_flag_name AND flag.enabled IS TRUE
  ) THEN
    RETURN NULL;
  END IF;

  -- Uma transação dispara no máximo um HTTP por tipo de worker.
  IF current_setting('acprod.collection_v3_wake_' || p_worker_kind, true) = 'sent' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('acprod.collection_v3_wake_' || p_worker_kind, 'sent', true);

  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = v_url_name LIMIT 1;
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'acprod_collection_worker_secret' LIMIT 1;

  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'source', coalesce(nullif(btrim(p_source), ''), 'database'),
      'limit', greatest(5, least(coalesce(p_limit, 25), 25)),
      'max_rounds', 5
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION private.wake_collection_v3_worker(text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.wake_collection_v3_worker(text, text, integer)
  TO postgres, service_role;

CREATE OR REPLACE FUNCTION private.notify_collection_v3_decision_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
BEGIN
  IF NEW.pipeline_version = 3
     AND NEW.status_sincronizacao = 'recebida'
     AND NEW.queue_message_id IS NOT NULL THEN
    PERFORM private.wake_collection_v3_worker('decision', 'ingress-trigger', 25);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.notify_collection_v3_projection_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $$
BEGIN
  PERFORM private.wake_collection_v3_worker('projection', 'outbox-trigger', 25);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_collection_v3_decision_worker()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.notify_collection_v3_projection_worker()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_wake_collection_v3_decision_worker
  ON public.coletas_producao;
CREATE TRIGGER trg_wake_collection_v3_decision_worker
  AFTER UPDATE OF queue_message_id ON public.coletas_producao
  FOR EACH ROW
  WHEN (OLD.queue_message_id IS NULL AND NEW.queue_message_id IS NOT NULL)
  EXECUTE FUNCTION private.notify_collection_v3_decision_worker();

DROP TRIGGER IF EXISTS trg_wake_collection_v3_projection_worker
  ON public.collection_projection_outbox;
CREATE TRIGGER trg_wake_collection_v3_projection_worker
  AFTER UPDATE OF queue_message_id ON public.collection_projection_outbox
  FOR EACH ROW
  WHEN (OLD.queue_message_id IS NULL AND NEW.queue_message_id IS NOT NULL)
  EXECUTE FUNCTION private.notify_collection_v3_projection_worker();

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-collection-v3-decision') THEN
    PERFORM cron.unschedule('run-collection-v3-decision');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-collection-v3-projection') THEN
    PERFORM cron.unschedule('run-collection-v3-projection');
  END IF;

  PERFORM cron.schedule(
    'run-collection-v3-decision',
    '15 seconds',
    $job$select private.wake_collection_v3_worker('decision', 'cron-fallback', 25);$job$
  );
  PERFORM cron.schedule(
    'run-collection-v3-projection',
    '15 seconds',
    $job$select private.wake_collection_v3_worker('projection', 'cron-fallback', 25);$job$
  );
END;
$cron$;

CREATE OR REPLACE FUNCTION public.get_collection_runtime_health_v3()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pgmq, pg_temp
AS $health$
  WITH flags AS (
    SELECT
      coalesce(bool_or(enabled) FILTER (
        WHERE flag_name = 'collection_pipeline_v3_ingress'
      ), false) AS ingress_enabled,
      coalesce(bool_or(enabled) FILTER (
        WHERE flag_name = 'collection_pipeline_v3_worker'
      ), false) AS worker_enabled,
      coalesce(bool_or(enabled) FILTER (
        WHERE flag_name = 'collection_pipeline_v3_projection'
      ), false) AS projection_enabled,
      coalesce(bool_or(enabled) FILTER (
        WHERE flag_name = 'collection_pipeline_v3_broadcast'
      ), false) AS broadcast_enabled,
      coalesce(jsonb_object_agg(
        flag_name,
        jsonb_build_object(
          'enabled', enabled,
          'rollout_scope', rollout_scope,
          'updated_at', updated_at
        )
      ), '{}'::jsonb) AS value
    FROM private.collection_pipeline_flags
  ), queue_items AS (
    SELECT 'collection_live_v3'::text AS queue_name,
           extract(epoch FROM (clock_timestamp() - queue.enqueued_at))::numeric AS age_seconds
    FROM pgmq.q_collection_live_v3 queue
    UNION ALL
    SELECT 'collection_replay_v3',
           extract(epoch FROM (clock_timestamp() - queue.enqueued_at))::numeric
    FROM pgmq.q_collection_replay_v3 queue
    UNION ALL
    SELECT 'collection_projection_v3',
           extract(epoch FROM (clock_timestamp() - queue.enqueued_at))::numeric
    FROM pgmq.q_collection_projection_v3 queue
  ), decision_queue AS (
    SELECT * FROM queue_items
    WHERE queue_name IN ('collection_live_v3', 'collection_replay_v3')
  ), queue_stats AS (
    SELECT
      count(*)::bigint AS queue_length,
      coalesce(max(age_seconds), 0)::numeric AS oldest_age_seconds,
      coalesce(percentile_cont(0.50) WITHIN GROUP (ORDER BY age_seconds), 0)::numeric AS p50,
      coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY age_seconds), 0)::numeric AS p95,
      coalesce(percentile_cont(0.99) WITHIN GROUP (ORDER BY age_seconds), 0)::numeric AS p99
    FROM decision_queue
  ), projection_queue AS (
    SELECT count(*)::bigint AS queue_length,
           coalesce(max(age_seconds), 0)::numeric AS oldest_age_seconds
    FROM queue_items
    WHERE queue_name = 'collection_projection_v3'
  ), dlq AS (
    SELECT count(*)::bigint AS queue_length
    FROM pgmq.q_collection_dead_letter_v3
  ), receipt_counts AS (
    SELECT
      count(*)::bigint AS total,
      count(*) FILTER (WHERE status_sincronizacao = 'recebida')::bigint AS received,
      count(*) FILTER (WHERE status_sincronizacao = 'processando')::bigint AS processing,
      count(*) FILTER (WHERE status_sincronizacao = 'sincronizada')::bigint AS finalized,
      count(*) FILTER (WHERE status_sincronizacao = 'erro')::bigint AS errors,
      count(*) FILTER (WHERE dead_lettered_at IS NOT NULL)::bigint AS dead_lettered
    FROM public.coletas_producao
    WHERE pipeline_version = 3
      AND received_at_db >= clock_timestamp() - interval '15 minutes'
  ), ingress_stats AS (
    SELECT
      count(*)::bigint AS samples,
      coalesce(percentile_cont(0.50) WITHIN GROUP (
        ORDER BY greatest(0, extract(epoch FROM (received_at_db - captured_at_client)) * 1000)
      ), 0)::numeric AS p50,
      coalesce(percentile_cont(0.95) WITHIN GROUP (
        ORDER BY greatest(0, extract(epoch FROM (received_at_db - captured_at_client)) * 1000)
      ), 0)::numeric AS p95,
      coalesce(percentile_cont(0.99) WITHIN GROUP (
        ORDER BY greatest(0, extract(epoch FROM (received_at_db - captured_at_client)) * 1000)
      ), 0)::numeric AS p99
    FROM public.coletas_producao
    WHERE pipeline_version = 3
      AND received_at_db >= clock_timestamp() - interval '15 minutes'
      AND captured_at_client IS NOT NULL
      AND source_mode = 'live'
  ), processing_stats AS (
    SELECT
      coalesce(percentile_cont(0.50) WITHIN GROUP (ORDER BY processing_duration_ms), 0)::numeric AS p50,
      coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY processing_duration_ms), 0)::numeric AS p95,
      coalesce(percentile_cont(0.99) WITHIN GROUP (ORDER BY processing_duration_ms), 0)::numeric AS p99,
      count(*)::bigint AS attempts,
      count(*) FILTER (WHERE attempt_number > 1)::bigint AS retries,
      count(*) FILTER (WHERE sqlstate = '57014')::bigint AS statement_timeouts,
      count(*) FILTER (WHERE sqlstate = '40P01')::bigint AS deadlocks
    FROM public.collection_processing_attempts
    WHERE processing_started_at >= clock_timestamp() - interval '15 minutes'
  ), projection_stats AS (
    SELECT
      coalesce(percentile_cont(0.50) WITHIN GROUP (ORDER BY projection_lag_ms), 0)::numeric AS p50,
      coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY projection_lag_ms), 0)::numeric AS p95,
      coalesce(percentile_cont(0.99) WITHIN GROUP (ORDER BY projection_lag_ms), 0)::numeric AS p99,
      count(*) FILTER (WHERE projected_at IS NULL AND dead_lettered_at IS NULL)::bigint AS pending
    FROM public.collection_projection_outbox
    WHERE created_at >= clock_timestamp() - interval '15 minutes'
  ), broadcast_stats AS (
    SELECT
      coalesce(percentile_cont(0.50) WITHIN GROUP (
        ORDER BY extract(epoch FROM (broadcasted_at - decision_committed_at)) * 1000
      ), 0)::numeric AS p50,
      coalesce(percentile_cont(0.95) WITHIN GROUP (
        ORDER BY extract(epoch FROM (broadcasted_at - decision_committed_at)) * 1000
      ), 0)::numeric AS p95,
      coalesce(percentile_cont(0.99) WITHIN GROUP (
        ORDER BY extract(epoch FROM (broadcasted_at - decision_committed_at)) * 1000
      ), 0)::numeric AS p99
    FROM public.coletas_producao
    WHERE pipeline_version = 3
      AND broadcasted_at IS NOT NULL
      AND decision_committed_at IS NOT NULL
      AND received_at_db >= clock_timestamp() - interval '15 minutes'
  ), workers AS (
    SELECT
      count(*) FILTER (
        WHERE worker_kind = 'decision'
          AND heartbeat_at >= clock_timestamp() - interval '2 minutes'
          AND finished_at IS NULL
      )::bigint AS active_decision,
      count(*) FILTER (
        WHERE worker_kind = 'projection'
          AND heartbeat_at >= clock_timestamp() - interval '2 minutes'
          AND finished_at IS NULL
      )::bigint AS active_projection
    FROM private.collection_worker_heartbeats
  ), structural AS (
    SELECT
      to_regprocedure('public.ingest_collection_batch_v3(uuid,uuid,jsonb)') IS NOT NULL
      AND to_regprocedure('public.claim_collection_batch_v3(text,integer)') IS NOT NULL
      AND to_regprocedure('public.process_collection_batch_v3(text,jsonb)') IS NOT NULL
      AND to_regprocedure('public.claim_collection_projection_batch_v3(text,integer)') IS NOT NULL
      AND to_regprocedure('public.process_collection_projection_batch_v3(text,jsonb)') IS NOT NULL
      AND to_regprocedure('public.reconcile_collection_projection_shards_v3(uuid,text)') IS NOT NULL
      AND to_regprocedure('private.enqueue_collection_projection_correction_v3()') IS NOT NULL
      AND to_regprocedure('public.switch_cell_active_lot_context(text,text,uuid,uuid,uuid)') IS NOT NULL
      AND to_regprocedure('public.recalculate_cell_lot_state(uuid,text,text,uuid,uuid)') IS NOT NULL
      AND to_regprocedure('public.refresh_collection_lot_state(uuid,uuid)') IS NOT NULL
      AND to_regclass('pgmq.q_collection_live_v3') IS NOT NULL
      AND to_regclass('pgmq.q_collection_replay_v3') IS NOT NULL
      AND to_regclass('pgmq.q_collection_projection_v3') IS NOT NULL
      AND to_regclass('pgmq.q_collection_dead_letter_v3') IS NOT NULL
      AND (
        SELECT count(*) = 3
        FROM private.collection_projection_trigger_registry registry
        WHERE registry.guard_installed IS TRUE
      )
      AND EXISTS (
        SELECT 1
        FROM pg_trigger trigger_row
        WHERE trigger_row.tgrelid = 'public.production_stage_readings'::regclass
          AND trigger_row.tgname = 'trg_collection_v3_projection_correction'
          AND trigger_row.tgenabled <> 'D'
          AND trigger_row.tgisinternal IS FALSE
      )
      AND EXISTS (
        SELECT 1
        FROM pg_trigger trigger_row
        WHERE trigger_row.tgrelid = 'public.production_entries'::regclass
          AND trigger_row.tgname = 'trg_sync_realtime_counter_entries'
          AND trigger_row.tgenabled <> 'D'
          AND trigger_row.tgisinternal IS FALSE
      )
      AND (
        SELECT count(*) = 3
        FROM pg_policies policy
        WHERE policy.schemaname = 'realtime'
          AND policy.tablename = 'messages'
          AND policy.policyname IN (
            'collection_v3_device_broadcast_select',
            'collection_v3_cell_broadcast_select',
            'collection_v3_event_broadcast_select'
          )
      )
      AND (
        SELECT count(*) = 3
        FROM vault.decrypted_secrets secret
        WHERE secret.name IN (
          'acprod_collection_v3_decision_url',
          'acprod_collection_v3_projection_url',
          'acprod_collection_worker_secret'
        )
          AND nullif(btrim(secret.decrypted_secret), '') IS NOT NULL
      ) AS ready
  ), calculated AS (
    SELECT
      structural.ready AS structural_ready,
      dlq.queue_length,
      queue_stats.queue_length AS decision_queue_length,
      queue_stats.oldest_age_seconds,
      queue_stats.p50 AS queue_p50,
      queue_stats.p95 AS queue_p95,
      queue_stats.p99 AS queue_p99,
      projection_queue.queue_length AS projection_queue_length,
      projection_queue.oldest_age_seconds AS projection_oldest_age_seconds,
      receipt_counts.*,
      ingress_stats.samples AS ingress_samples,
      ingress_stats.p50 AS ingress_p50,
      ingress_stats.p95 AS ingress_p95,
      ingress_stats.p99 AS ingress_p99,
      processing_stats.p50 AS processing_p50,
      processing_stats.p95 AS processing_p95,
      processing_stats.p99 AS processing_p99,
      processing_stats.attempts,
      processing_stats.retries,
      processing_stats.statement_timeouts,
      processing_stats.deadlocks,
      projection_stats.p50 AS projection_p50,
      projection_stats.p95 AS projection_p95,
      projection_stats.p99 AS projection_p99,
      projection_stats.pending AS projection_pending,
      broadcast_stats.p50 AS broadcast_p50,
      broadcast_stats.p95 AS broadcast_p95,
      broadcast_stats.p99 AS broadcast_p99,
      workers.active_decision,
      workers.active_projection,
      flags.*,
      CASE WHEN processing_stats.attempts = 0 THEN 0
        ELSE processing_stats.retries::numeric / processing_stats.attempts END AS retry_rate,
      CASE WHEN receipt_counts.total = 0 THEN 0
        ELSE receipt_counts.errors::numeric / receipt_counts.total END AS error_rate
    FROM structural, dlq, queue_stats, projection_queue, receipt_counts,
         ingress_stats, processing_stats, projection_stats, broadcast_stats,
         workers, flags
  )
  SELECT jsonb_build_object(
    'ready',
      structural_ready
      AND queue_length = 0
      AND statement_timeouts = 0
      AND deadlocks = 0
      AND error_rate <= 0.01
      AND (
        NOT worker_enabled
        OR decision_queue_length = 0
        OR active_decision > 0
      )
      AND (
        NOT projection_enabled
        OR projection_queue_length = 0
        OR active_projection > 0
      )
      AND (NOT worker_enabled OR queue_p99 <= 2)
      AND (NOT ingress_enabled OR ingress_samples = 0 OR ingress_p95 <= 250)
      AND (
        NOT worker_enabled
        OR attempts = 0
        OR (processing_p95 <= 800 AND processing_p99 <= 2000)
      )
      AND (NOT worker_enabled OR retry_rate <= 0.01)
      AND (
        NOT projection_enabled
        OR (
          projection_p95 <= 500
          AND projection_oldest_age_seconds <= 2
        )
      ),
    'pipeline_version', 3,
    'window_minutes', 15,
    'counts', jsonb_build_object(
      'received', received,
      'processing', processing,
      'finalized', finalized,
      'error', errors,
      'dead_lettered_receipts', dead_lettered,
      'dlq_messages', queue_length,
      'ingress_samples', ingress_samples,
      'processing_attempts', attempts
    ),
    'queues', jsonb_build_object(
      'decision_length', decision_queue_length,
      'projection_length', projection_queue_length,
      'oldest_message_age_seconds', greatest(oldest_age_seconds, projection_oldest_age_seconds),
      'age_seconds', jsonb_build_object(
        'p50', round(queue_p50, 3),
        'p95', round(queue_p95, 3),
        'p99', round(queue_p99, 3)
      )
    ),
    'latency_ms', jsonb_build_object(
      'ingress', jsonb_build_object(
        'p50', round(ingress_p50, 3), 'p95', round(ingress_p95, 3), 'p99', round(ingress_p99, 3)
      ),
      'processing', jsonb_build_object(
        'p50', round(processing_p50, 3), 'p95', round(processing_p95, 3), 'p99', round(processing_p99, 3)
      ),
      'projection', jsonb_build_object(
        'p50', round(projection_p50, 3), 'p95', round(projection_p95, 3), 'p99', round(projection_p99, 3)
      ),
      'broadcast', jsonb_build_object(
        'p50', round(broadcast_p50, 3), 'p95', round(broadcast_p95, 3), 'p99', round(broadcast_p99, 3)
      )
    ),
    'rates', jsonb_build_object(
      'retry', round(retry_rate, 6),
      'error', round(error_rate, 6)
    ),
    'database_failures', jsonb_build_object(
      'statement_timeouts', statement_timeouts,
      'deadlocks', deadlocks
    ),
    'workers', jsonb_build_object(
      'active_decision', active_decision,
      'active_projection', active_projection
    ),
    'capacity_estimate', NULL,
    'capacity_evidence', 'requires_k6_on_target_compute',
    'structural_ready', structural_ready,
    'flags', value,
    'thresholds', jsonb_build_object(
      'queue_age_p99_seconds', 2,
      'ingress_p95_ms', 250,
      'processing_p95_ms', 800,
      'processing_p99_ms', 2000,
      'projection_p95_ms', 500,
      'projection_queue_oldest_age_seconds', 2,
      'retry_rate', 0.01,
      'error_rate', 0.01,
      'dlq_messages', 0,
      'statement_timeouts', 0,
      'deadlocks', 0
    ),
    'checked_at', clock_timestamp()
  )
  FROM calculated;
$health$;

REVOKE ALL ON FUNCTION public.get_collection_runtime_health_v3()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_collection_runtime_health_v3()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_collection_pipeline_flag_v3(
  p_flag_name text,
  p_enabled boolean,
  p_rollout_scope jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_flag_name text := btrim(coalesce(p_flag_name, ''));
  v_scope jsonb := coalesce(p_rollout_scope, '{}'::jsonb);
  v_guard_count integer;
  v_guard_runtime_ready boolean := false;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF v_flag_name NOT IN (
    'collection_pipeline_v3_ingress',
    'collection_pipeline_v3_worker',
    'collection_pipeline_v3_projection',
    'collection_pipeline_v3_broadcast'
  ) THEN
    RAISE EXCEPTION 'COLLECTION_PIPELINE_FLAG_INVALID'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_scope) <> 'object' THEN
    RAISE EXCEPTION 'COLLECTION_PIPELINE_ROLLOUT_SCOPE_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_guard_count
  FROM private.collection_projection_trigger_registry registry
  WHERE registry.guard_installed IS TRUE;

  SELECT NOT EXISTS (
    SELECT 1
    FROM private.collection_projection_trigger_registry registry
    CROSS JOIN LATERAL unnest(registry.installed_trigger_names)
      AS installed(trigger_name)
    LEFT JOIN pg_trigger trigger_row
      ON trigger_row.tgrelid = registry.relation_name
     AND trigger_row.tgname = installed.trigger_name
     AND trigger_row.tgisinternal IS FALSE
     AND trigger_row.tgenabled <> 'D'
    WHERE registry.guard_installed IS TRUE
      AND trigger_row.oid IS NULL
  ) INTO v_guard_runtime_ready;

  IF p_enabled THEN
    IF v_guard_count <> 3 OR v_guard_runtime_ready IS NOT TRUE THEN
      RAISE EXCEPTION 'COLLECTION_V3_TRIGGER_GUARDS_NOT_READY'
        USING ERRCODE = '55000';
    END IF;

    IF v_flag_name = 'collection_pipeline_v3_ingress'
       AND to_regprocedure('public.ingest_collection_batch_v3(uuid,uuid,jsonb)') IS NULL THEN
      RAISE EXCEPTION 'COLLECTION_V3_INGRESS_NOT_READY'
        USING ERRCODE = '55000';
    END IF;

    IF v_flag_name = 'collection_pipeline_v3_worker' THEN
      IF NOT EXISTS (
        SELECT 1 FROM private.collection_pipeline_flags
        WHERE flag_name = 'collection_pipeline_v3_ingress' AND enabled IS TRUE
      ) OR to_regprocedure('public.process_collection_batch_v3(text,jsonb)') IS NULL THEN
        RAISE EXCEPTION 'ENABLE_COLLECTION_V3_INGRESS_BEFORE_WORKER'
          USING ERRCODE = '55000';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM vault.decrypted_secrets secret
        WHERE secret.name = 'acprod_collection_v3_decision_url'
          AND nullif(btrim(secret.decrypted_secret), '') IS NOT NULL
      ) OR NOT EXISTS (
        SELECT 1
        FROM vault.decrypted_secrets secret
        WHERE secret.name = 'acprod_collection_worker_secret'
          AND nullif(btrim(secret.decrypted_secret), '') IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'COLLECTION_V3_DECISION_WAKEUP_NOT_READY'
          USING ERRCODE = '55000';
      END IF;
    END IF;

    IF v_flag_name = 'collection_pipeline_v3_projection' THEN
      IF NOT EXISTS (
        SELECT 1 FROM private.collection_pipeline_flags
        WHERE flag_name = 'collection_pipeline_v3_worker' AND enabled IS TRUE
      ) OR to_regprocedure('public.process_collection_projection_batch_v3(text,jsonb)') IS NULL THEN
        RAISE EXCEPTION 'ENABLE_COLLECTION_V3_WORKER_BEFORE_PROJECTION'
          USING ERRCODE = '55000';
      END IF;
      IF to_regprocedure('private.enqueue_collection_projection_correction_v3()') IS NULL
         OR to_regprocedure('public.switch_cell_active_lot_context(text,text,uuid,uuid,uuid)') IS NULL
         OR to_regprocedure('public.recalculate_cell_lot_state(uuid,text,text,uuid,uuid)') IS NULL
         OR to_regprocedure('public.refresh_collection_lot_state(uuid,uuid)') IS NULL
         OR NOT EXISTS (
           SELECT 1
           FROM pg_trigger trigger_row
           WHERE trigger_row.tgrelid = 'public.production_stage_readings'::regclass
             AND trigger_row.tgname = 'trg_collection_v3_projection_correction'
             AND trigger_row.tgenabled <> 'D'
             AND trigger_row.tgisinternal IS FALSE
         ) THEN
        RAISE EXCEPTION 'COLLECTION_V3_COMPATIBILITY_PROJECTION_NOT_READY'
          USING ERRCODE = '55000';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM vault.decrypted_secrets secret
        WHERE secret.name = 'acprod_collection_v3_projection_url'
          AND nullif(btrim(secret.decrypted_secret), '') IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'COLLECTION_V3_PROJECTION_WAKEUP_NOT_READY'
          USING ERRCODE = '55000';
      END IF;
    END IF;

    IF v_flag_name = 'collection_pipeline_v3_broadcast' THEN
      IF NOT EXISTS (
        SELECT 1 FROM private.collection_pipeline_flags
        WHERE flag_name = 'collection_pipeline_v3_projection' AND enabled IS TRUE
      ) THEN
        RAISE EXCEPTION 'ENABLE_COLLECTION_V3_PROJECTION_BEFORE_BROADCAST'
          USING ERRCODE = '55000';
      END IF;
      IF NOT EXISTS (
         SELECT 1 FROM pg_policies policy
         WHERE policy.schemaname = 'realtime'
           AND policy.tablename = 'messages'
           AND policy.policyname IN (
             'collection_v3_device_broadcast_select',
             'collection_v3_cell_broadcast_select',
             'collection_v3_event_broadcast_select'
           )
         GROUP BY policy.schemaname, policy.tablename
         HAVING count(*) = 3
       ) THEN
        RAISE EXCEPTION 'COLLECTION_V3_BROADCAST_POLICIES_NOT_READY'
          USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  UPDATE private.collection_pipeline_flags
  SET enabled = coalesce(p_enabled, false),
      rollout_scope = v_scope,
      updated_at = clock_timestamp(),
      updated_by = auth.uid()
  WHERE flag_name = v_flag_name;

  RETURN public.get_collection_pipeline_flags_v3() -> v_flag_name;
END;
$$;

REVOKE ALL ON FUNCTION public.set_collection_pipeline_flag_v3(text, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_collection_pipeline_flag_v3(text, boolean, jsonb)
  TO service_role;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260901_acprod_collection_fabric_v3_release_gate',
  'collection-v3-v2-isolation-private-broadcast-coalesced-wakeup-operational-health-rollout-gates',
  'Isolamento v2/v3, RLS Broadcast por equipamento/célula/evento, wakeups coalescidos, cron de recuperação, health fail-closed e gates ordenados.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

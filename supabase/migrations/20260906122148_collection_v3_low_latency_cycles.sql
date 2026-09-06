-- AC.Prod2 Collection Fabric v3 — workers horizontais, ciclo atômico e SLO por ambiente.
--
-- O lease global anterior serializava todo o pipeline. Sob rajada de 30 eventos/s,
-- decisões internamente rápidas acumulavam fila. Esta migração mantém o lock por
-- peça e a idempotência do ledger, mas limita a concorrência por slots distribuídos.

SET check_function_bodies = on;

-- A resolução atual é case-insensitive. Estes índices evitam varreduras quando o
-- catálogo crescer e cobrem somente as colunas necessárias à resolução do ID.
CREATE INDEX IF NOT EXISTS production_pieces_piece_uid_upper_v3_idx
  ON public.production_pieces (upper(piece_uid)) INCLUDE (id);

CREATE INDEX IF NOT EXISTS production_pieces_traceability_upper_v3_idx
  ON public.production_pieces (upper(traceability_code)) INCLUDE (id)
  WHERE traceability_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS production_tags_value_upper_active_v3_idx
  ON public.production_tags (upper(tag_value)) INCLUDE (piece_id)
  WHERE active IS TRUE AND piece_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS private.collection_worker_slots_v3 (
  worker_kind text NOT NULL,
  slot_number smallint NOT NULL,
  lease_owner text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (worker_kind, slot_number),
  CONSTRAINT collection_worker_slots_v3_kind_check
    CHECK (worker_kind IN ('decision', 'projection')),
  CONSTRAINT collection_worker_slots_v3_number_check
    CHECK (slot_number BETWEEN 1 AND 16),
  CONSTRAINT collection_worker_slots_v3_owner_check
    CHECK (length(btrim(lease_owner)) BETWEEN 1 AND 160)
);

CREATE UNIQUE INDEX IF NOT EXISTS collection_worker_slots_v3_owner_idx
  ON private.collection_worker_slots_v3 (worker_kind, lease_owner);

CREATE INDEX IF NOT EXISTS collection_worker_slots_v3_expiry_idx
  ON private.collection_worker_slots_v3 (worker_kind, expires_at);

REVOKE ALL ON TABLE private.collection_worker_slots_v3
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.try_acquire_collection_worker_slot_v3(
  p_worker_kind text,
  p_lease_owner text,
  p_ttl_seconds integer DEFAULT 45,
  p_max_slots integer DEFAULT 4
)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_owner text := left(btrim(coalesce(p_lease_owner, '')), 160);
  v_max_slots integer := greatest(1, least(coalesce(p_max_slots, 4), 16));
  v_slot smallint;
  v_candidate integer;
BEGIN
  IF p_worker_kind NOT IN ('decision', 'projection') OR v_owner = '' THEN
    RAISE EXCEPTION 'COLLECTION_WORKER_SLOT_INPUT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  -- A mesma invocação apenas renova o slot que já recebeu do wakeup.
  UPDATE private.collection_worker_slots_v3
  SET heartbeat_at = v_now,
      expires_at = v_now + make_interval(
        secs => greatest(15, least(coalesce(p_ttl_seconds, 45), 120))
      ),
      updated_at = v_now
  WHERE worker_kind = p_worker_kind
    AND lease_owner = v_owner
  RETURNING slot_number INTO v_slot;

  IF FOUND THEN
    RETURN v_slot;
  END IF;

  -- UPSERT condicional transforma cada linha em um slot de semáforo distribuído.
  FOR v_candidate IN 1..v_max_slots LOOP
    v_slot := NULL;
    INSERT INTO private.collection_worker_slots_v3 (
      worker_kind, slot_number, lease_owner,
      acquired_at, heartbeat_at, expires_at, updated_at
    ) VALUES (
      p_worker_kind,
      v_candidate,
      v_owner,
      v_now,
      v_now,
      v_now + make_interval(
        secs => greatest(15, least(coalesce(p_ttl_seconds, 45), 120))
      ),
      v_now
    )
    ON CONFLICT (worker_kind, slot_number) DO UPDATE
    SET lease_owner = excluded.lease_owner,
        acquired_at = excluded.acquired_at,
        heartbeat_at = excluded.heartbeat_at,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    WHERE private.collection_worker_slots_v3.expires_at <= v_now
    RETURNING slot_number INTO v_slot;

    IF v_slot IS NOT NULL THEN
      RETURN v_slot;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.release_collection_worker_slot_v3(
  p_worker_kind text,
  p_lease_owner text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  DELETE FROM private.collection_worker_slots_v3
  WHERE worker_kind = p_worker_kind
    AND lease_owner = left(btrim(coalesce(p_lease_owner, '')), 160);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION private.try_acquire_collection_worker_slot_v3(text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.release_collection_worker_slot_v3(text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.run_collection_worker_cycle_v3(
  p_worker_kind text,
  p_secret text,
  p_lease_owner text,
  p_worker_id text,
  p_limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pgmq, pg_temp
AS $$
DECLARE
  v_started_at timestamptz := clock_timestamp();
  v_flag_name text;
  v_default_slots integer;
  v_max_slots integer;
  v_limit integer := greatest(5, least(coalesce(p_limit, 25), 25));
  v_slot smallint;
  v_items jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_claimed integer := 0;
  v_processed integer := 0;
  v_release_when_idle boolean := false;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF NOT public.verify_collection_worker_cron_secret(p_secret) THEN
    RETURN jsonb_build_object('authorized', false);
  END IF;

  IF p_worker_kind = 'decision' THEN
    v_flag_name := 'collection_pipeline_v3_worker';
    v_default_slots := 8;
  ELSIF p_worker_kind = 'projection' THEN
    v_flag_name := 'collection_pipeline_v3_projection';
    v_default_slots := 4;
  ELSE
    RAISE EXCEPTION 'COLLECTION_V3_WORKER_KIND_INVALID' USING ERRCODE = '22023';
  END IF;

  IF nullif(btrim(coalesce(p_worker_id, '')), '') IS NULL
     OR nullif(btrim(coalesce(p_lease_owner, '')), '') IS NULL THEN
    RAISE EXCEPTION 'COLLECTION_WORKER_CYCLE_IDENTITY_REQUIRED'
      USING ERRCODE = '22023';
  END IF;

  SELECT greatest(1, least(coalesce(
    private.try_collection_bigint_v3(flag.rollout_scope ->> 'max_workers'),
    v_default_slots
  ), 16))::integer
  INTO v_max_slots
  FROM private.collection_pipeline_flags flag
  WHERE flag.flag_name = v_flag_name
    AND flag.enabled IS TRUE;

  IF NOT FOUND THEN
    PERFORM private.release_collection_worker_slot_v3(p_worker_kind, p_lease_owner);
    RETURN jsonb_build_object(
      'authorized', true,
      'enabled', false,
      'coalesced', false,
      'claimed', 0,
      'processed', 0,
      'lease_retained', false
    );
  END IF;

  v_slot := private.try_acquire_collection_worker_slot_v3(
    p_worker_kind,
    p_lease_owner,
    45,
    v_max_slots
  );

  IF v_slot IS NULL THEN
    RETURN jsonb_build_object(
      'authorized', true,
      'enabled', true,
      'coalesced', true,
      'claimed', 0,
      'processed', 0,
      'lease_retained', false
    );
  END IF;

  IF p_worker_kind = 'decision' THEN
    v_items := public.claim_collection_batch_v3(p_worker_id, v_limit);
    v_claimed := jsonb_array_length(coalesce(v_items, '[]'::jsonb));
    IF v_claimed > 0 THEN
      v_results := public.process_collection_batch_v3(p_worker_id, v_items);
    END IF;
  ELSE
    v_items := public.claim_collection_projection_batch_v3(p_worker_id, v_limit);
    v_claimed := jsonb_array_length(coalesce(v_items, '[]'::jsonb));
    IF v_claimed > 0 THEN
      v_results := public.process_collection_projection_batch_v3(p_worker_id, v_items);
    END IF;
  END IF;

  v_processed := jsonb_array_length(coalesce(v_results, '[]'::jsonb));
  v_release_when_idle := v_claimed < v_limit;

  IF v_release_when_idle THEN
    PERFORM private.release_collection_worker_slot_v3(p_worker_kind, p_lease_owner);
  END IF;

  RETURN jsonb_build_object(
    'authorized', true,
    'enabled', true,
    'coalesced', false,
    'slot', v_slot,
    'claimed', v_claimed,
    'processed', v_processed,
    'lease_retained', NOT v_release_when_idle,
    'duration_ms', round(
      (extract(epoch FROM (clock_timestamp() - v_started_at)) * 1000)::numeric,
      3
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_collection_worker_cycle_v3(text, text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_collection_worker_cycle_v3(text, text, text, text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.release_collection_worker_slot_v3(
  p_worker_kind text,
  p_lease_owner text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN private.release_collection_worker_slot_v3(p_worker_kind, p_lease_owner);
END;
$$;

REVOKE ALL ON FUNCTION public.release_collection_worker_slot_v3(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_collection_worker_slot_v3(text, text)
  TO service_role;

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
  v_flag_name text;
  v_default_slots integer;
  v_max_slots integer;
  v_url text;
  v_secret text;
  v_request_id bigint;
  v_has_work boolean := false;
  v_lease_owner text := 'wake:' || gen_random_uuid()::text;
  v_slot smallint;
BEGIN
  IF p_worker_kind = 'decision' THEN
    v_url_name := 'acprod_collection_v3_decision_url';
    v_flag_name := 'collection_pipeline_v3_worker';
    v_default_slots := 8;
    SELECT EXISTS (
      SELECT 1 FROM pgmq.q_collection_live_v3 queue WHERE queue.vt <= clock_timestamp()
      UNION ALL
      SELECT 1 FROM pgmq.q_collection_replay_v3 queue WHERE queue.vt <= clock_timestamp()
    ) INTO v_has_work;
  ELSIF p_worker_kind = 'projection' THEN
    v_url_name := 'acprod_collection_v3_projection_url';
    v_flag_name := 'collection_pipeline_v3_projection';
    v_default_slots := 4;
    SELECT EXISTS (
      SELECT 1 FROM pgmq.q_collection_projection_v3 queue
      WHERE queue.vt <= clock_timestamp()
    ) INTO v_has_work;
  ELSE
    RAISE EXCEPTION 'COLLECTION_V3_WORKER_KIND_INVALID' USING ERRCODE = '22023';
  END IF;

  IF NOT v_has_work THEN
    RETURN NULL;
  END IF;

  SELECT greatest(1, least(coalesce(
    private.try_collection_bigint_v3(flag.rollout_scope ->> 'max_workers'),
    v_default_slots
  ), 16))::integer
  INTO v_max_slots
  FROM private.collection_pipeline_flags flag
  WHERE flag.flag_name = v_flag_name
    AND flag.enabled IS TRUE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Um ingresso gera no máximo um HTTP por tipo nesta transação; transações
  -- concorrentes podem ocupar slots distintos até o limite configurado.
  IF current_setting('acprod.collection_v3_wake_' || p_worker_kind, true) = 'sent' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('acprod.collection_v3_wake_' || p_worker_kind, 'sent', true);

  v_slot := private.try_acquire_collection_worker_slot_v3(
    p_worker_kind, v_lease_owner, 45, v_max_slots
  );
  IF v_slot IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = v_url_name LIMIT 1;
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'acprod_collection_worker_secret' LIMIT 1;

  IF v_url IS NULL OR v_secret IS NULL THEN
    PERFORM private.release_collection_worker_slot_v3(p_worker_kind, v_lease_owner);
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'source', coalesce(nullif(btrim(p_source), ''), 'database'),
      'limit', greatest(5, least(coalesce(p_limit, 25), 25)),
      'max_rounds', 5,
      'lease_owner', v_lease_owner,
      'lease_slot', v_slot
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

CREATE OR REPLACE FUNCTION public.handoff_collection_worker_v3(
  p_worker_kind text,
  p_lease_owner text,
  p_limit integer DEFAULT 25
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  PERFORM private.release_collection_worker_slot_v3(p_worker_kind, p_lease_owner);
  RETURN private.wake_collection_v3_worker(
    p_worker_kind, 'edge-continuation', p_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.handoff_collection_worker_v3(text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handoff_collection_worker_v3(text, text, integer)
  TO service_role;

-- Perfis separados impedem que a tolerância de homologação vire, por acidente,
-- o contrato de produção. O perfil production preserva os SLOs originais.
CREATE TABLE IF NOT EXISTS private.collection_slo_profiles_v3 (
  profile_name text PRIMARY KEY,
  active boolean NOT NULL DEFAULT false,
  queue_age_p99_seconds numeric(10,3) NOT NULL,
  ingress_p95_ms numeric(12,3) NOT NULL,
  processing_p95_ms numeric(12,3) NOT NULL,
  processing_p99_ms numeric(12,3) NOT NULL,
  projection_p95_ms numeric(12,3) NOT NULL,
  projection_queue_oldest_age_seconds numeric(10,3) NOT NULL,
  retry_rate numeric(8,6) NOT NULL DEFAULT 0.01,
  error_rate numeric(8,6) NOT NULL DEFAULT 0.01,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT collection_slo_profiles_v3_positive_check CHECK (
    queue_age_p99_seconds > 0
    AND ingress_p95_ms > 0
    AND processing_p95_ms > 0
    AND processing_p99_ms >= processing_p95_ms
    AND projection_p95_ms > 0
    AND projection_queue_oldest_age_seconds > 0
    AND retry_rate BETWEEN 0 AND 1
    AND error_rate BETWEEN 0 AND 1
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS collection_slo_profiles_v3_one_active_idx
  ON private.collection_slo_profiles_v3 (active)
  WHERE active IS TRUE;

REVOKE ALL ON TABLE private.collection_slo_profiles_v3
  FROM PUBLIC, anon, authenticated;

INSERT INTO private.collection_slo_profiles_v3 (
  profile_name, active, queue_age_p99_seconds, ingress_p95_ms,
  processing_p95_ms, processing_p99_ms, projection_p95_ms,
  projection_queue_oldest_age_seconds, retry_rate, error_rate
) VALUES
  ('production', true, 2, 250, 800, 2000, 500, 2, 0.01, 0.01),
  ('test', false, 5, 1500, 1500, 5000, 2000, 5, 0.01, 0.01)
ON CONFLICT (profile_name) DO UPDATE
SET queue_age_p99_seconds = excluded.queue_age_p99_seconds,
    ingress_p95_ms = excluded.ingress_p95_ms,
    processing_p95_ms = excluded.processing_p95_ms,
    processing_p99_ms = excluded.processing_p99_ms,
    projection_p95_ms = excluded.projection_p95_ms,
    projection_queue_oldest_age_seconds = excluded.projection_queue_oldest_age_seconds,
    retry_rate = excluded.retry_rate,
    error_rate = excluded.error_rate,
    updated_at = clock_timestamp();

CREATE OR REPLACE FUNCTION public.set_collection_slo_profile_v3(p_profile_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $$
DECLARE
  v_profile private.collection_slo_profiles_v3%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM private.collection_slo_profiles_v3
    WHERE profile_name = p_profile_name
  ) THEN
    RAISE EXCEPTION 'COLLECTION_SLO_PROFILE_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE private.collection_slo_profiles_v3
  SET active = false, updated_at = clock_timestamp()
  WHERE active IS TRUE;
  UPDATE private.collection_slo_profiles_v3
  SET active = true, updated_at = clock_timestamp()
  WHERE profile_name = p_profile_name
  RETURNING * INTO v_profile;

  RETURN to_jsonb(v_profile);
END;
$$;

REVOKE ALL ON FUNCTION public.set_collection_slo_profile_v3(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_collection_slo_profile_v3(text)
  TO service_role;

-- Preserva a consulta de métricas e troca somente o gate por um perfil tipado.
DO $rename_health$
BEGIN
  IF to_regprocedure('public.get_collection_runtime_health_raw_v3()') IS NULL THEN
    ALTER FUNCTION public.get_collection_runtime_health_v3()
      RENAME TO get_collection_runtime_health_raw_v3;
  END IF;
END;
$rename_health$;

REVOKE ALL ON FUNCTION public.get_collection_runtime_health_raw_v3()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_collection_runtime_health_raw_v3()
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_collection_runtime_health_v3()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_health jsonb := public.get_collection_runtime_health_raw_v3();
  v_slo private.collection_slo_profiles_v3%ROWTYPE;
  v_ingress_enabled boolean;
  v_worker_enabled boolean;
  v_projection_enabled boolean;
  v_ready boolean;
BEGIN
  SELECT * INTO STRICT v_slo
  FROM private.collection_slo_profiles_v3
  WHERE active IS TRUE;

  v_ingress_enabled := coalesce(
    (v_health #>> '{flags,collection_pipeline_v3_ingress,enabled}')::boolean,
    false
  );
  v_worker_enabled := coalesce(
    (v_health #>> '{flags,collection_pipeline_v3_worker,enabled}')::boolean,
    false
  );
  v_projection_enabled := coalesce(
    (v_health #>> '{flags,collection_pipeline_v3_projection,enabled}')::boolean,
    false
  );

  v_ready := coalesce((v_health ->> 'structural_ready')::boolean, false)
    AND to_regprocedure(
      'public.run_collection_worker_cycle_v3(text,text,text,text,integer)'
    ) IS NOT NULL
    AND to_regclass('private.collection_worker_slots_v3') IS NOT NULL
    AND coalesce((v_health #>> '{counts,dlq_messages}')::numeric, 0) = 0
    AND coalesce((v_health #>> '{database_failures,statement_timeouts}')::numeric, 0) = 0
    AND coalesce((v_health #>> '{database_failures,deadlocks}')::numeric, 0) = 0
    AND coalesce((v_health #>> '{rates,error}')::numeric, 0) <= v_slo.error_rate
    AND (
      NOT v_worker_enabled
      OR coalesce((v_health #>> '{queues,decision_length}')::numeric, 0) = 0
      OR coalesce((v_health #>> '{workers,active_decision}')::numeric, 0) > 0
    )
    AND (
      NOT v_projection_enabled
      OR coalesce((v_health #>> '{queues,projection_length}')::numeric, 0) = 0
      OR coalesce((v_health #>> '{workers,active_projection}')::numeric, 0) > 0
    )
    AND (
      NOT v_worker_enabled
      OR coalesce((v_health #>> '{queues,age_seconds,p99}')::numeric, 0)
        <= v_slo.queue_age_p99_seconds
    )
    AND (
      NOT v_ingress_enabled
      OR coalesce((v_health #>> '{counts,ingress_samples}')::numeric, 0) = 0
      OR coalesce((v_health #>> '{latency_ms,ingress,p95}')::numeric, 0)
        <= v_slo.ingress_p95_ms
    )
    AND (
      NOT v_worker_enabled
      OR coalesce((v_health #>> '{counts,processing_attempts}')::numeric, 0) = 0
      OR (
        coalesce((v_health #>> '{latency_ms,processing,p95}')::numeric, 0)
          <= v_slo.processing_p95_ms
        AND coalesce((v_health #>> '{latency_ms,processing,p99}')::numeric, 0)
          <= v_slo.processing_p99_ms
      )
    )
    AND (
      NOT v_worker_enabled
      OR coalesce((v_health #>> '{rates,retry}')::numeric, 0) <= v_slo.retry_rate
    )
    AND (
      NOT v_projection_enabled
      OR (
        coalesce((v_health #>> '{latency_ms,projection,p95}')::numeric, 0)
          <= v_slo.projection_p95_ms
        AND coalesce((v_health #>> '{queues,oldest_message_age_seconds}')::numeric, 0)
          <= greatest(
            v_slo.queue_age_p99_seconds,
            v_slo.projection_queue_oldest_age_seconds
          )
      )
    );

  v_health := jsonb_set(v_health, '{ready}', to_jsonb(v_ready), true);
  v_health := jsonb_set(
    v_health,
    '{thresholds}',
    jsonb_build_object(
      'queue_age_p99_seconds', v_slo.queue_age_p99_seconds,
      'ingress_p95_ms', v_slo.ingress_p95_ms,
      'processing_p95_ms', v_slo.processing_p95_ms,
      'processing_p99_ms', v_slo.processing_p99_ms,
      'projection_p95_ms', v_slo.projection_p95_ms,
      'projection_queue_oldest_age_seconds', v_slo.projection_queue_oldest_age_seconds,
      'retry_rate', v_slo.retry_rate,
      'error_rate', v_slo.error_rate,
      'dlq_messages', 0,
      'statement_timeouts', 0,
      'deadlocks', 0
    ),
    true
  );

  RETURN v_health || jsonb_build_object(
    'slo_profile', v_slo.profile_name,
    'worker_model', 'bounded-horizontal-slots',
    'checked_at', clock_timestamp()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_collection_runtime_health_v3()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_collection_runtime_health_v3()
  TO authenticated, service_role;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260906_acprod_collection_v3_low_latency_cycles',
  'collection-v3-horizontal-slots-atomic-cycle-slo-profiles-indexes-v1',
  'Substitui single-flight global por slots limitados, reduz round-trips dos workers, indexa resolução e separa SLO de teste/produção.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

-- AC.Prod2 — schema drift, projeção e single-flight distribuído dos workers.

SET check_function_bodies = on;

-- ADR: production_entries.updated_at pertence ao contrato original (000_base_app_schema)
-- e é usado pelo projetor para reversões/replays. Restaurar a coluna é mais seguro
-- que remover a atualização, pois preserva o modelo e a rastreabilidade histórica.
ALTER TABLE public.production_entries
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.production_entries
SET updated_at = coalesce(created_at, clock_timestamp())
WHERE updated_at IS NULL;

ALTER TABLE public.production_entries
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

DROP TRIGGER IF EXISTS set_production_entries_updated_at ON public.production_entries;
CREATE TRIGGER set_production_entries_updated_at
BEFORE UPDATE ON public.production_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS private.collection_worker_leases_v3 (
  worker_kind text PRIMARY KEY,
  lease_owner text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT collection_worker_leases_v3_kind_check
    CHECK (worker_kind IN ('decision', 'projection')),
  CONSTRAINT collection_worker_leases_v3_owner_check
    CHECK (length(btrim(lease_owner)) BETWEEN 1 AND 160)
);

REVOKE ALL ON TABLE private.collection_worker_leases_v3
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.try_acquire_collection_worker_lease_v3(
  p_worker_kind text,
  p_lease_owner text,
  p_ttl_seconds integer DEFAULT 45
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_rows integer;
BEGIN
  IF p_worker_kind NOT IN ('decision', 'projection')
     OR nullif(btrim(coalesce(p_lease_owner, '')), '') IS NULL THEN
    RAISE EXCEPTION 'COLLECTION_WORKER_LEASE_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO private.collection_worker_leases_v3 (
    worker_kind, lease_owner, acquired_at, heartbeat_at, expires_at, updated_at
  ) VALUES (
    p_worker_kind,
    left(btrim(p_lease_owner), 160),
    v_now,
    v_now,
    v_now + make_interval(secs => greatest(15, least(coalesce(p_ttl_seconds, 45), 120))),
    v_now
  )
  ON CONFLICT (worker_kind) DO UPDATE
  SET lease_owner = excluded.lease_owner,
      acquired_at = CASE
        WHEN private.collection_worker_leases_v3.lease_owner = excluded.lease_owner
          THEN private.collection_worker_leases_v3.acquired_at
        ELSE excluded.acquired_at
      END,
      heartbeat_at = excluded.heartbeat_at,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  WHERE private.collection_worker_leases_v3.expires_at <= v_now
     OR private.collection_worker_leases_v3.lease_owner = excluded.lease_owner;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION private.try_acquire_collection_worker_lease_v3(text, text, integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.acquire_collection_worker_lease_v3(
  p_worker_kind text,
  p_lease_owner text,
  p_ttl_seconds integer DEFAULT 45
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
  RETURN private.try_acquire_collection_worker_lease_v3(
    p_worker_kind, p_lease_owner, p_ttl_seconds
  );
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_collection_worker_lease_v3(text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_collection_worker_lease_v3(text, text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.release_collection_worker_lease_v3(
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
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  DELETE FROM private.collection_worker_leases_v3
  WHERE worker_kind = p_worker_kind
    AND lease_owner = left(btrim(coalesce(p_lease_owner, '')), 160);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.release_collection_worker_lease_v3(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_collection_worker_lease_v3(text, text)
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
  v_url text;
  v_secret text;
  v_request_id bigint;
  v_has_work boolean := false;
  v_lease_owner text := 'wake:' || gen_random_uuid()::text;
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
      SELECT 1 FROM pgmq.q_collection_projection_v3 queue WHERE queue.vt <= clock_timestamp()
    ) INTO v_has_work;
  ELSE
    RAISE EXCEPTION 'COLLECTION_V3_WORKER_KIND_INVALID' USING ERRCODE = '22023';
  END IF;

  IF NOT v_has_work OR NOT EXISTS (
    SELECT 1 FROM private.collection_pipeline_flags flag
    WHERE flag.flag_name = v_flag_name AND flag.enabled IS TRUE
  ) THEN
    RETURN NULL;
  END IF;

  IF current_setting('acprod.collection_v3_wake_' || p_worker_kind, true) = 'sent' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('acprod.collection_v3_wake_' || p_worker_kind, 'sent', true);

  -- Reserva distribuída antes do HTTP: triggers e cron concorrentes são coalescidos.
  IF NOT private.try_acquire_collection_worker_lease_v3(
    p_worker_kind, v_lease_owner, 45
  ) THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = v_url_name LIMIT 1;
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'acprod_collection_worker_secret' LIMIT 1;

  IF v_url IS NULL OR v_secret IS NULL THEN
    DELETE FROM private.collection_worker_leases_v3
    WHERE worker_kind = p_worker_kind AND lease_owner = v_lease_owner;
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'source', coalesce(nullif(btrim(p_source), ''), 'database'),
      'limit', greatest(5, least(coalesce(p_limit, 25), 25)),
      'max_rounds', 5,
      'lease_owner', v_lease_owner
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

CREATE OR REPLACE FUNCTION public.assert_collection_projection_schema_v3()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(required.column_name ORDER BY required.column_name)
  INTO v_missing
  FROM (VALUES
    ('approval_status'), ('client_event_id'), ('corrected_at'),
    ('corrected_by'), ('correction_reason'), ('created_at'), ('updated_at')
  ) required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute attribute
    WHERE attribute.attrelid = 'public.production_entries'::regclass
      AND attribute.attname = required.column_name
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  );

  IF coalesce(cardinality(v_missing), 0) > 0 THEN
    RAISE EXCEPTION 'COLLECTION_PROJECTION_SCHEMA_MISMATCH: %', array_to_string(v_missing, ',')
      USING ERRCODE = '42703';
  END IF;
  IF to_regprocedure('private.process_collection_projection_batch_v3(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'COLLECTION_PROJECTION_FUNCTION_MISSING' USING ERRCODE = '42883';
  END IF;

  RETURN jsonb_build_object('ok', true, 'checked_at', clock_timestamp());
END;
$$;

REVOKE ALL ON FUNCTION public.assert_collection_projection_schema_v3()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_collection_projection_schema_v3()
  TO authenticated, service_role;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260902_acprod_auth_realtime_projection_capacity_hardening',
  'production-entries-updated-at-worker-lease-schema-contract-v1',
  'Restaura contrato updated_at do projetor e adiciona lease distribuída single-flight para decision/projection.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

-- AC.Prod Collection Fabric v3 — contrato aditivo, telemetria e flags.
-- Todas as flags começam desligadas. Esta migration não roteia nenhum evento ao v3.

SET check_function_bodies = on;

CREATE SCHEMA IF NOT EXISTS private;

ALTER TABLE public.coletas_producao
  ADD COLUMN IF NOT EXISTS pipeline_version smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS device_sequence bigint,
  ADD COLUMN IF NOT EXISTS captured_at_client timestamptz,
  ADD COLUMN IF NOT EXISTS received_at_db timestamptz,
  ADD COLUMN IF NOT EXISTS enqueued_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_committed_at timestamptz,
  ADD COLUMN IF NOT EXISTS projected_at timestamptz,
  ADD COLUMN IF NOT EXISTS broadcasted_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_mode text NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS operator_session_id uuid REFERENCES public.operator_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS operator_id uuid REFERENCES public.operators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cell_id uuid REFERENCES public.cells(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS machine_id uuid REFERENCES public.production_machines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS app_version text,
  ADD COLUMN IF NOT EXISTS final_reason_code text,
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz,
  ADD COLUMN IF NOT EXISTS queue_name text,
  ADD COLUMN IF NOT EXISTS queue_message_id bigint;

UPDATE public.coletas_producao
SET captured_at_client = COALESCE(captured_at_client, timestamp_leitura),
    received_at_db = COALESCE(received_at_db, server_received_at, created_at),
    enqueued_at = COALESCE(enqueued_at, server_received_at, created_at)
WHERE captured_at_client IS NULL
   OR received_at_db IS NULL
   OR enqueued_at IS NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.coletas_producao'::regclass
      AND conname = 'coletas_producao_pipeline_version_check'
  ) THEN
    ALTER TABLE public.coletas_producao
      ADD CONSTRAINT coletas_producao_pipeline_version_check
      CHECK (pipeline_version IN (2, 3)) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.coletas_producao'::regclass
      AND conname = 'coletas_producao_source_mode_check'
  ) THEN
    ALTER TABLE public.coletas_producao
      ADD CONSTRAINT coletas_producao_source_mode_check
      CHECK (source_mode IN ('live', 'offline_replay')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.coletas_producao'::regclass
      AND conname = 'coletas_producao_device_sequence_check'
  ) THEN
    ALTER TABLE public.coletas_producao
      ADD CONSTRAINT coletas_producao_device_sequence_check
      CHECK (device_sequence IS NULL OR device_sequence > 0) NOT VALID;
  END IF;
END;
$constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_coletas_producao_device_sequence
  ON public.coletas_producao (device_id, device_sequence)
  WHERE device_id IS NOT NULL AND device_sequence IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coletas_producao_v3_runtime
  ON public.coletas_producao (
    pipeline_version,
    status_sincronizacao,
    source_mode,
    received_at_db
  )
  WHERE pipeline_version = 3;

CREATE INDEX IF NOT EXISTS idx_coletas_producao_v3_session
  ON public.coletas_producao (operator_session_id, captured_at_client DESC)
  WHERE pipeline_version = 3;

ALTER TABLE public.production_stage_readings
  ADD COLUMN IF NOT EXISTS pipeline_version smallint NOT NULL DEFAULT 2;

ALTER TABLE public.production_collection_events
  ADD COLUMN IF NOT EXISTS pipeline_version smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS decision_committed_at timestamptz,
  ADD COLUMN IF NOT EXISTS projected_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_reason_code text;

COMMENT ON COLUMN public.production_stage_readings.pipeline_version IS
  'Origem do fato. Linhas v3 não executam triggers de projeção síncrona protegidos pelo registry.';

CREATE TABLE IF NOT EXISTS private.collection_pipeline_flags (
  flag_name text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  rollout_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT collection_pipeline_flags_name_check CHECK (flag_name IN (
    'collection_pipeline_v3_ingress',
    'collection_pipeline_v3_worker',
    'collection_pipeline_v3_projection',
    'collection_pipeline_v3_broadcast'
  ))
);

INSERT INTO private.collection_pipeline_flags (flag_name, enabled)
VALUES
  ('collection_pipeline_v3_ingress', false),
  ('collection_pipeline_v3_worker', false),
  ('collection_pipeline_v3_projection', false),
  ('collection_pipeline_v3_broadcast', false)
ON CONFLICT (flag_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS private.collection_projection_trigger_registry (
  trigger_name text PRIMARY KEY,
  relation_name regclass NOT NULL,
  function_name regprocedure NOT NULL,
  original_definition text NOT NULL,
  original_definition_sha256 text NOT NULL,
  installed_trigger_names text[] NOT NULL DEFAULT '{}'::text[],
  guard_installed boolean NOT NULL DEFAULT false,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  restored_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.collection_processing_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_event_id text NOT NULL,
  attempt_number integer NOT NULL,
  worker_id text NOT NULL,
  queue_name text NOT NULL,
  claimed_at timestamptz,
  processing_started_at timestamptz,
  processing_finished_at timestamptz,
  queue_delay_ms numeric(14,3),
  processing_duration_ms numeric(14,3),
  sqlstate text,
  reason_code text,
  retryable boolean NOT NULL DEFAULT false,
  backoff_ms integer,
  lock_wait_ms numeric(14,3),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT collection_processing_attempts_number_check CHECK (attempt_number > 0),
  CONSTRAINT collection_processing_attempts_unique UNIQUE (client_event_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_collection_processing_attempts_recent
  ON public.collection_processing_attempts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_processing_attempts_errors
  ON public.collection_processing_attempts (sqlstate, created_at DESC)
  WHERE sqlstate IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.collection_projection_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_event_id text NOT NULL,
  projection_revision integer NOT NULL DEFAULT 0,
  projection_kind text NOT NULL DEFAULT 'decision',
  previous_decision text,
  reading_id uuid REFERENCES public.production_stage_readings(id) ON DELETE RESTRICT,
  piece_id uuid REFERENCES public.production_pieces(id) ON DELETE RESTRICT,
  lot_id uuid REFERENCES public.production_lots(id) ON DELETE RESTRICT,
  cell_id uuid REFERENCES public.cells(id) ON DELETE SET NULL,
  machine_id uuid REFERENCES public.production_machines(id) ON DELETE SET NULL,
  operator_id uuid REFERENCES public.operators(id) ON DELETE SET NULL,
  shift_id uuid,
  shift_snapshot text,
  step_code text,
  decision text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempt_count integer NOT NULL DEFAULT 0,
  projected_at timestamptz,
  projection_lag_ms numeric(14,3),
  queue_message_id bigint,
  last_error_code text,
  dead_lettered_at timestamptz,
  CONSTRAINT collection_projection_outbox_decision_check CHECK (
    decision IN ('approved', 'rejected', 'blocked', 'duplicated', 'pending_review')
  ),
  CONSTRAINT collection_projection_outbox_previous_decision_check CHECK (
    previous_decision IS NULL OR previous_decision IN (
      'approved', 'rejected', 'blocked', 'duplicated', 'pending_review'
    )
  ),
  CONSTRAINT collection_projection_outbox_revision_check CHECK (projection_revision >= 0),
  CONSTRAINT collection_projection_outbox_kind_check CHECK (
    projection_kind IN ('decision', 'correction')
  ),
  CONSTRAINT collection_projection_outbox_quantity_check CHECK (quantity > 0),
  CONSTRAINT collection_projection_outbox_event_revision_unique
    UNIQUE (client_event_id, projection_revision)
);

CREATE INDEX IF NOT EXISTS idx_collection_projection_outbox_due
  ON public.collection_projection_outbox (available_at, created_at)
  WHERE projected_at IS NULL AND dead_lettered_at IS NULL;

CREATE TABLE IF NOT EXISTS public.collection_projection_applied (
  outbox_id uuid NOT NULL REFERENCES public.collection_projection_outbox(id) ON DELETE RESTRICT,
  projection_type text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  payload_checksum text,
  PRIMARY KEY (outbox_id, projection_type)
);

CREATE TABLE IF NOT EXISTS public.production_lot_stage_counter_shards (
  lot_id uuid NOT NULL REFERENCES public.production_lots(id) ON DELETE RESTRICT,
  step_code text NOT NULL,
  shard_number smallint NOT NULL,
  approved_count bigint NOT NULL DEFAULT 0,
  rejected_count bigint NOT NULL DEFAULT 0,
  blocked_count bigint NOT NULL DEFAULT 0,
  duplicated_count bigint NOT NULL DEFAULT 0,
  pending_review_count bigint NOT NULL DEFAULT 0,
  quantity_total bigint NOT NULL DEFAULT 0,
  state_version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (lot_id, step_code, shard_number),
  CONSTRAINT production_lot_stage_counter_shards_number_check
    CHECK (shard_number >= 0 AND shard_number < 32)
);

CREATE OR REPLACE VIEW public.production_lot_stage_counter_totals_v3
WITH (security_invoker = true)
AS
SELECT
  lot_id,
  step_code,
  sum(approved_count)::bigint AS approved_count,
  sum(rejected_count)::bigint AS rejected_count,
  sum(blocked_count)::bigint AS blocked_count,
  sum(duplicated_count)::bigint AS duplicated_count,
  sum(pending_review_count)::bigint AS pending_review_count,
  sum(quantity_total)::bigint AS quantity_total,
  max(state_version)::bigint AS state_version,
  max(updated_at) AS updated_at
FROM public.production_lot_stage_counter_shards
GROUP BY lot_id, step_code;

CREATE TABLE IF NOT EXISTS private.collection_worker_heartbeats (
  worker_id text PRIMARY KEY,
  worker_kind text NOT NULL,
  invocation_id text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  claimed_count integer NOT NULL DEFAULT 0,
  finalized_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  CONSTRAINT collection_worker_heartbeats_kind_check
    CHECK (worker_kind IN ('decision', 'projection'))
);

ALTER TABLE public.collection_processing_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_projection_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_projection_applied ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_lot_stage_counter_shards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_lot_stage_counter_shards_select
  ON public.production_lot_stage_counter_shards;
CREATE POLICY collection_lot_stage_counter_shards_select
  ON public.production_lot_stage_counter_shards
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON TABLE private.collection_pipeline_flags FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.collection_projection_trigger_registry FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.collection_worker_heartbeats FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.collection_processing_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.collection_projection_outbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.collection_projection_applied FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.production_lot_stage_counter_shards FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.production_lot_stage_counter_totals_v3 FROM PUBLIC, anon;

GRANT SELECT ON TABLE public.production_lot_stage_counter_totals_v3 TO authenticated, service_role;
GRANT SELECT ON TABLE public.production_lot_stage_counter_shards TO authenticated;
GRANT ALL ON TABLE public.collection_processing_attempts TO service_role;
GRANT ALL ON TABLE public.collection_projection_outbox TO service_role;
GRANT ALL ON TABLE public.collection_projection_applied TO service_role;
GRANT ALL ON TABLE public.production_lot_stage_counter_shards TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.collection_processing_attempts_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.get_collection_pipeline_flags_v3()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $$
  SELECT coalesce(
    jsonb_object_agg(flag.flag_name, jsonb_build_object(
      'enabled', flag.enabled,
      'rollout_scope', flag.rollout_scope,
      'updated_at', flag.updated_at
    )),
    '{}'::jsonb
  )
  FROM private.collection_pipeline_flags flag;
$$;

REVOKE ALL ON FUNCTION public.get_collection_pipeline_flags_v3()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_collection_pipeline_flags_v3()
  TO authenticated, service_role;

-- Mantém o ingresso v2 intacto e adiciona somente um bypass leve, autenticado
-- por marcador transacional privado, para linhas criadas pelo RPC batch v3.
CREATE OR REPLACE FUNCTION public.process_coleta_producao_ingress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions, pg_temp
AS $$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_token text;
  v_payload jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATED_EDGE_SESSION_REQUIRED'
      USING ERRCODE = '42501',
            HINT = 'Autentique o equipamento antes de enviar a coleta.';
  END IF;

  IF NEW.auth_user_id IS NOT NULL AND NEW.auth_user_id <> v_auth_user_id THEN
    RAISE EXCEPTION 'COLLECTION_INGRESS_USER_MISMATCH'
      USING ERRCODE = '42501';
  END IF;

  v_payload := coalesce(NEW.payload, '{}'::jsonb);

  IF NEW.pipeline_version = 3 THEN
    IF current_setting('acprod.collection_v3_ingress_batch', true)
       IS DISTINCT FROM NEW.batch_id::text THEN
      RAISE EXCEPTION 'COLLECTION_V3_RPC_REQUIRED'
        USING ERRCODE = '42501',
              HINT = 'Use ingest_collection_batch_v3 para eventos pipeline_version=3.';
    END IF;

    NEW.id := coalesce(NEW.id, gen_random_uuid());
    NEW.auth_user_id := v_auth_user_id;
    NEW.client_event_id := btrim(NEW.client_event_id);
    NEW.tag_lida := btrim(NEW.tag_lida);
    NEW.event_kind := 'production_stage';
    NEW.reader_type := lower(coalesce(nullif(btrim(NEW.reader_type), ''), 'keyboard_barcode'));
    NEW.status_sincronizacao := 'recebida';
    NEW.resultado := NULL;
    NEW.erro := NULL;
    NEW.retryable := false;
    NEW.server_received_at := v_now;
    NEW.received_at_db := v_now;
    NEW.enqueued_at := v_now;
    NEW.processado_em := NULL;
    NEW.processing_duration_ms := NULL;
    NEW.queue_delay_ms := NULL;
    NEW.attempt_count := 0;
    NEW.next_attempt_at := v_now;
    NEW.lease_expires_at := NULL;
    NEW.worker_id := NULL;
    NEW.last_error_code := NULL;
    NEW.last_error_at := NULL;
    NEW.updated_at := v_now;
    NEW.payload := v_payload
      - 'operatorSessionToken'
      - 'operator_session_token'
      - 'session_token'
      - 'jwt'
      - 'access_token';
    RETURN NEW;
  END IF;

  v_token := coalesce(
    nullif(btrim(v_payload ->> 'operatorSessionToken'), ''),
    nullif(btrim(v_payload ->> 'operator_session_token'), ''),
    nullif(btrim(v_payload ->> 'session_token'), '')
  );

  IF v_token IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_SESSION_REQUIRED'
      USING ERRCODE = '42501',
            HINT = 'Faça o login operacional antes de coletar.';
  END IF;

  NEW.id := coalesce(NEW.id, gen_random_uuid());
  NEW.auth_user_id := v_auth_user_id;
  NEW.client_event_id := btrim(NEW.client_event_id);
  NEW.tag_lida := btrim(NEW.tag_lida);
  NEW.event_kind := 'production_stage';
  NEW.reader_type := lower(coalesce(nullif(btrim(NEW.reader_type), ''), 'keyboard_barcode'));
  NEW.status_sincronizacao := 'recebida';
  NEW.resultado := NULL;
  NEW.erro := NULL;
  NEW.retryable := false;
  NEW.server_received_at := v_now;
  NEW.received_at_db := v_now;
  NEW.enqueued_at := v_now;
  NEW.processado_em := NULL;
  NEW.processing_duration_ms := NULL;
  NEW.queue_delay_ms := NULL;
  NEW.attempt_count := 0;
  NEW.next_attempt_at := v_now;
  NEW.lease_expires_at := NULL;
  NEW.worker_id := NULL;
  NEW.last_error_code := NULL;
  NEW.last_error_at := NULL;
  NEW.updated_at := v_now;
  NEW.payload := v_payload
    - 'operatorSessionToken'
    - 'operator_session_token'
    - 'session_token';

  INSERT INTO private.coleta_producao_credentials (
    coleta_id, auth_user_id, session_token, created_at, expires_at
  ) VALUES (
    NEW.id, v_auth_user_id, v_token, v_now, v_now + interval '2 days'
  )
  ON CONFLICT (coleta_id) DO UPDATE
  SET auth_user_id = excluded.auth_user_id,
      session_token = excluded.session_token,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.process_coleta_producao_ingress()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_coleta_producao_ingress()
  TO service_role;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260901_acprod_collection_fabric_v3_foundation',
  'collection-v3-additive-contract-attempt-ledger-outbox-shards-flags',
  'Contrato aditivo v3, telemetria append-only, outbox, shards e flags desligadas por padrão.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

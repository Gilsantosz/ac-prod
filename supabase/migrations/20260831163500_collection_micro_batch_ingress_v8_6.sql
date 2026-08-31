-- AC.Prod2 — coleta desacoplada com micro-batching v8.6.
-- Mantém a captura física fora do caminho crítico, envia lotes de até 100
-- eventos e reutiliza a função transacional já validada da produção.

CREATE TABLE IF NOT EXISTS public.coletas_producao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_event_id text NOT NULL UNIQUE,
  tag_lida text NOT NULL,
  timestamp_leitura timestamptz NOT NULL DEFAULT clock_timestamp(),
  status_sincronizacao text NOT NULL DEFAULT 'recebida',
  event_kind text NOT NULL DEFAULT 'production_stage',
  reader_type text NOT NULL DEFAULT 'keyboard_barcode',
  device_id text,
  batch_id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_sequence integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  resultado jsonb,
  erro text,
  retryable boolean NOT NULL DEFAULT false,
  auth_user_id uuid NOT NULL DEFAULT auth.uid(),
  server_received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  processado_em timestamptz,
  processing_duration_ms numeric(12,3),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT coletas_producao_status_check
    CHECK (status_sincronizacao IN ('recebida', 'processando', 'sincronizada', 'erro')),
  CONSTRAINT coletas_producao_event_kind_check
    CHECK (event_kind = 'production_stage'),
  CONSTRAINT coletas_producao_client_event_id_check
    CHECK (btrim(client_event_id) <> ''),
  CONSTRAINT coletas_producao_tag_lida_check
    CHECK (btrim(tag_lida) <> ''),
  CONSTRAINT coletas_producao_batch_sequence_check
    CHECK (batch_sequence >= 0)
);

COMMENT ON TABLE public.coletas_producao IS
  'Inbox auditável das leituras físicas enviadas em micro-lotes. O gatilho reutiliza process_production_reading_v2 para preservar rota, turno, duplicidade, KPIs e Realtime.';
COMMENT ON COLUMN public.coletas_producao.status_sincronizacao IS
  'Estado do transporte/ingestão: recebida, processando, sincronizada ou erro.';
COMMENT ON COLUMN public.coletas_producao.resultado IS
  'Resultado canônico retornado pela função transacional de coleta.';
COMMENT ON COLUMN public.coletas_producao.client_event_id IS
  'Chave idempotente gerada na borda; impede processamento produtivo duplicado.';

CREATE INDEX IF NOT EXISTS idx_coletas_producao_auth_created
  ON public.coletas_producao (auth_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coletas_producao_status_timestamp
  ON public.coletas_producao (status_sincronizacao, timestamp_leitura);
CREATE INDEX IF NOT EXISTS idx_coletas_producao_batch_sequence
  ON public.coletas_producao (batch_id, batch_sequence);
CREATE INDEX IF NOT EXISTS idx_coletas_producao_tag_timestamp
  ON public.coletas_producao (tag_lida, timestamp_leitura DESC);

ALTER TABLE public.coletas_producao ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.coletas_producao FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.coletas_producao TO authenticated, service_role;

DROP POLICY IF EXISTS coletas_producao_insert_own ON public.coletas_producao;
CREATE POLICY coletas_producao_insert_own
  ON public.coletas_producao
  FOR INSERT
  TO authenticated
  WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS coletas_producao_select_own ON public.coletas_producao;
CREATE POLICY coletas_producao_select_own
  ON public.coletas_producao
  FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.process_coleta_producao_ingress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, realtime, pg_temp
AS $$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_payload jsonb;
  v_result jsonb;
  v_started_at timestamptz := clock_timestamp();
  v_sqlstate text;
  v_error_message text;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATED_EDGE_SESSION_REQUIRED'
      USING ERRCODE = '42501',
            HINT = 'Autentique o worker/dispositivo com um usuário válido; nunca use a chave pública sem sessão.';
  END IF;

  IF NEW.auth_user_id IS NOT NULL AND NEW.auth_user_id <> v_auth_user_id THEN
    RAISE EXCEPTION 'COLLECTION_INGRESS_USER_MISMATCH'
      USING ERRCODE = '42501';
  END IF;

  NEW.auth_user_id := v_auth_user_id;
  NEW.client_event_id := btrim(NEW.client_event_id);
  NEW.tag_lida := btrim(NEW.tag_lida);
  NEW.event_kind := 'production_stage';
  NEW.reader_type := lower(coalesce(nullif(btrim(NEW.reader_type), ''), 'keyboard_barcode'));
  NEW.status_sincronizacao := 'processando';
  NEW.retryable := false;
  NEW.erro := NULL;
  NEW.resultado := NULL;
  NEW.server_received_at := v_started_at;
  NEW.updated_at := v_started_at;

  v_payload := coalesce(NEW.payload, '{}'::jsonb) || jsonb_build_object(
    'client_event_id', NEW.client_event_id,
    'rawValue', NEW.tag_lida,
    'raw_value', NEW.tag_lida,
    'readerType', NEW.reader_type,
    'reader_type', NEW.reader_type,
    'createdAtClient', NEW.timestamp_leitura,
    'created_at_client', NEW.timestamp_leitura,
    'deviceId', NEW.device_id,
    'device_id', NEW.device_id,
    'queued_offline', coalesce((NEW.payload ->> 'queued_offline')::boolean, false),
    'microBatch', true,
    'micro_batch', true,
    'batchId', NEW.batch_id,
    'batch_id', NEW.batch_id,
    'batchSequence', NEW.batch_sequence,
    'batch_sequence', NEW.batch_sequence
  );
  NEW.payload := v_payload;

  BEGIN
    v_result := public.process_production_reading_v2(v_payload);
  EXCEPTION WHEN OTHERS THEN
    v_sqlstate := SQLSTATE;
    v_error_message := SQLERRM;

    -- Falhas transitórias abortam o INSERT inteiro. O worker recebe erro,
    -- recoloca o lote na fila local e tenta novamente com o mesmo client_event_id.
    IF left(v_sqlstate, 2) = '08'
       OR v_sqlstate IN ('40001', '40P01', '55P03', '57014', '57P01', '53300') THEN
      RAISE;
    END IF;

    -- Falhas funcionais/de autorização ficam auditadas sem provocar loop infinito.
    NEW.status_sincronizacao := 'erro';
    NEW.retryable := false;
    NEW.erro := left(v_error_message, 1000);
    NEW.resultado := jsonb_build_object(
      'success', false,
      'status', 'error',
      'reason_code', coalesce(nullif(v_sqlstate, ''), 'COLLECTION_INGRESS_ERROR'),
      'message', left(v_error_message, 1000),
      'client_event_id', NEW.client_event_id,
      'retryable', false
    );
    NEW.processado_em := clock_timestamp();
    NEW.processing_duration_ms :=
      extract(epoch FROM (NEW.processado_em - v_started_at)) * 1000;
    NEW.updated_at := NEW.processado_em;
    RETURN NEW;
  END;

  NEW.resultado := coalesce(v_result, jsonb_build_object(
    'success', false,
    'status', 'error',
    'message', 'O servidor não retornou o resultado da coleta.',
    'client_event_id', NEW.client_event_id
  ));
  NEW.status_sincronizacao := 'sincronizada';
  NEW.retryable := false;
  NEW.processado_em := clock_timestamp();
  NEW.processing_duration_ms :=
    extract(epoch FROM (NEW.processado_em - v_started_at)) * 1000;
  NEW.updated_at := NEW.processado_em;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.process_coleta_producao_ingress()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_coleta_producao_ingress()
  TO service_role;

DROP TRIGGER IF EXISTS trg_process_coleta_producao_ingress
  ON public.coletas_producao;
CREATE TRIGGER trg_process_coleta_producao_ingress
BEFORE INSERT ON public.coletas_producao
FOR EACH ROW
EXECUTE FUNCTION public.process_coleta_producao_ingress();

-- Corrige o gate v8.5: etiquetas internas MANUAL/custom não são códigos físicos
-- coletáveis. RFID continua fora da regra exata de oito dígitos.
CREATE OR REPLACE FUNCTION public.get_public_collection_release()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH manage_definition AS (
    SELECT lower(pg_get_functiondef(to_regprocedure('public.can_manage_replacement_actions()'))) AS definition
  ),
  approval_definition AS (
    SELECT lower(pg_get_functiondef(to_regprocedure('public.approve_piece_replacement(uuid,jsonb)'))) AS definition
  ),
  force_definition AS (
    SELECT lower(pg_get_functiondef(to_regprocedure('public.force_complete_piece_replacement_impl(uuid,text,jsonb)'))) AS definition
  ),
  collection_definition AS (
    SELECT lower(pg_get_functiondef(to_regprocedure('public.process_production_reading_v2(jsonb)'))) AS definition
  ),
  lot_definition AS (
    SELECT lower(pg_get_functiondef(to_regprocedure('public.recalculate_replacement_lot_v2(uuid)'))) AS definition
  ),
  flags AS (
    SELECT jsonb_build_object(
      'shift_columns',
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'operators'
            AND column_name = 'shift_start_time'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'operators'
            AND column_name = 'shift_end_time'
        ),
      'cell_lifecycle', to_regclass('public.production_cell_lot_states') IS NOT NULL,
      'active_context', to_regclass('public.production_cell_active_contexts') IS NOT NULL,
      'reading_v2', to_regprocedure('public.process_production_reading_v2(jsonb)') IS NOT NULL,
      'history_compatibility',
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'production_stage_readings'
            AND column_name = 'raw_value'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'production_stage_readings'
            AND column_name = 'traceability_code'
        ),
      'collection_exact_8_digit_scan',
        to_regprocedure('public.normalize_collection_scan_code(text)') IS NOT NULL
        AND (SELECT position('normalize_collection_scan_code' in definition) > 0 FROM collection_definition)
        AND (SELECT position('invalid_code_length' in definition) > 0 FROM collection_definition)
        AND (SELECT position('expected_code_length' in definition) > 0 FROM collection_definition),
      'collection_active_tags_8_digits', NOT EXISTS (
        SELECT 1
        FROM public.production_tags tag
        WHERE tag.active IS TRUE
          AND (
            nullif(btrim(coalesce(tag.barcode_value, '')), '') IS NOT NULL
            OR nullif(btrim(coalesce(tag.qr_value, '')), '') IS NOT NULL
            OR (
              lower(coalesce(tag.tag_type, '')) IN ('barcode', 'qr', 'qrcode')
              AND lower(coalesce(tag.tag_format, '')) <> 'custom'
            )
          )
          AND coalesce(
            nullif(btrim(coalesce(tag.barcode_value, '')), ''),
            nullif(btrim(coalesce(tag.qr_value, '')), ''),
            btrim(tag.tag_value)
          ) !~ '^[0-9]{8}$'
      ),
      'replacement_quality_role', EXISTS (
        SELECT 1
        FROM pg_constraint constraint_row
        WHERE constraint_row.conrelid = 'public.profiles'::regclass
          AND constraint_row.conname = 'profiles_role_check'
          AND lower(pg_get_constraintdef(constraint_row.oid)) LIKE '%quality_manager%'
      ),
      'replacement_decision_rbac',
        to_regprocedure('public.can_approve_replacements()') IS NOT NULL
        AND to_regprocedure('public.can_force_complete_replacements()') IS NOT NULL,
      'replacement_strict_role_hierarchy',
        (SELECT position('current_profile_can_decide_replacement' in definition) > 0 FROM manage_definition)
        AND (SELECT position('has_permission' in definition) = 0 FROM manage_definition),
      'replacement_station_only_approval',
        (SELECT position('insert into public.production_entries' in definition) = 0 FROM approval_definition)
        AND (SELECT position('insert into public.production_stage_readings' in definition) = 0 FROM approval_definition)
        AND (SELECT position('insert into public.production_collection_events' in definition) = 0 FROM approval_definition)
        AND (SELECT position('status = ''released''' in definition) > 0 FROM approval_definition),
      'replacement_origin_classification',
        (SELECT position('''replacement'', false, v_original.id' in definition) > 0 FROM approval_definition),
      'replacement_force_justification_only',
        (SELECT position('btrim(coalesce(p_reason' in definition) > 0 FROM force_definition)
        AND (SELECT position('v_reason = ''''' in definition) > 0 FROM force_definition)
        AND (SELECT position('password' in definition) = 0 FROM force_definition),
      'replacement_force_adjustment_facts',
        (SELECT position('''manual_adjustment''' in definition) > 0 FROM force_definition)
        AND (SELECT position('''conclusao_forcada_reposicao''' in definition) > 0 FROM force_definition),
      'replacement_force_conflict_safe',
        (SELECT position('on conflict (client_event_id)' in definition) = 0 FROM force_definition)
        AND (SELECT position('on conflict do nothing' in definition) > 0 FROM force_definition),
      'replacement_audit_mirror', EXISTS (
        SELECT 1
        FROM pg_trigger trigger_row
        WHERE trigger_row.tgrelid = 'public.replacement_action_audit_logs'::regclass
          AND trigger_row.tgname = 'trg_mirror_replacement_action_audit_to_system_logs'
          AND trigger_row.tgenabled <> 'D'
      ),
      'replacement_station_queue',
        to_regprocedure('public.get_replacement_station_queue_v3(text,text)') IS NOT NULL,
      'replacement_canonical_lot_close',
        (SELECT position('then ''closed''' in definition) > 0 FROM lot_definition)
        AND (SELECT position('actual_end' in definition) > 0 FROM lot_definition)
    ) AS value
  )
  SELECT jsonb_build_object(
    'ready', NOT EXISTS (
      SELECT 1
      FROM flags, jsonb_each_text(flags.value) flag
      WHERE flag.value IS DISTINCT FROM 'true'
    ),
    'migration_version', '20260831150725',
    'release_version', '20260831_acprod_collection_fast8_v8_5',
    'schema_flags', flags.value
  )
  FROM flags;
$$;

REVOKE ALL ON FUNCTION public.get_public_collection_release()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_collection_release()
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_collection_micro_batch_release()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH base AS (
    SELECT public.get_public_collection_release() AS release
  ),
  trigger_definition AS (
    SELECT lower(pg_get_functiondef(to_regprocedure(
      'public.process_coleta_producao_ingress()'
    ))) AS definition
  ),
  micro_flags AS (
    SELECT jsonb_build_object(
      'collection_micro_batch_ingress_table',
        to_regclass('public.coletas_producao') IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'coletas_producao'
            AND column_name = 'client_event_id'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'coletas_producao'
            AND column_name = 'status_sincronizacao'
        ),
      'collection_micro_batch_trigger', EXISTS (
        SELECT 1
        FROM pg_trigger trigger_row
        WHERE trigger_row.tgrelid = 'public.coletas_producao'::regclass
          AND trigger_row.tgname = 'trg_process_coleta_producao_ingress'
          AND trigger_row.tgenabled <> 'D'
      ),
      'collection_micro_batch_reuses_transactional_rpc',
        (SELECT position('process_production_reading_v2' in definition) > 0
         FROM trigger_definition),
      'collection_micro_batch_retry_contract',
        (SELECT position('raise;' in definition) > 0
         AND position('40001' in definition) > 0
         AND position('40p01' in definition) > 0
         FROM trigger_definition),
      'collection_micro_batch_rls',
        EXISTS (
          SELECT 1
          FROM pg_class table_row
          JOIN pg_namespace schema_row ON schema_row.oid = table_row.relnamespace
          WHERE schema_row.nspname = 'public'
            AND table_row.relname = 'coletas_producao'
            AND table_row.relrowsecurity IS TRUE
        )
        AND EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'coletas_producao'
            AND policyname = 'coletas_producao_insert_own'
        )
        AND EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'coletas_producao'
            AND policyname = 'coletas_producao_select_own'
        ),
      'collection_micro_batch_explicit_grants',
        has_table_privilege('authenticated', 'public.coletas_producao', 'INSERT')
        AND has_table_privilege('authenticated', 'public.coletas_producao', 'SELECT')
        AND NOT has_table_privilege('anon', 'public.coletas_producao', 'INSERT')
        AND NOT has_table_privilege('anon', 'public.coletas_producao', 'SELECT'),
      'collection_manual_tags_excluded_from_fast8_gate',
        coalesce((base.release #>> '{schema_flags,collection_active_tags_8_digits}')::boolean, false)
    ) AS value
    FROM base
  )
  SELECT jsonb_build_object(
    'ready',
      coalesce((base.release ->> 'ready')::boolean, false)
      AND NOT EXISTS (
        SELECT 1
        FROM micro_flags, jsonb_each_text(micro_flags.value) flag
        WHERE flag.value IS DISTINCT FROM 'true'
      ),
    'migration_version', coalesce((
      SELECT migration.version
      FROM supabase_migrations.schema_migrations migration
      WHERE migration.name = 'collection_micro_batch_ingress_v8_6'
      ORDER BY migration.version DESC
      LIMIT 1
    ), ''),
    'release_version', '20260831_acprod_collection_micro_batch_v8_6',
    'schema_flags', (base.release -> 'schema_flags') || micro_flags.value
  )
  FROM base, micro_flags;
$$;

REVOKE ALL ON FUNCTION public.get_public_collection_micro_batch_release()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_collection_micro_batch_release()
  TO anon, authenticated;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260831_acprod_collection_micro_batch_v8_6',
  'micro-batch-edge-inbox-bulk-insert-trigger-existing-transactional-rpc',
  'Inbox coletas_producao com RLS, INSERT em lote, idempotência por client_event_id, requeue em falha transitória e gate corrigido para etiquetas MANUAL/custom.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

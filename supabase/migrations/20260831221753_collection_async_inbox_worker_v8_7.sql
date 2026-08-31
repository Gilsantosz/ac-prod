-- AC.Prod2 v8.7 — inbox assíncrono real para coleta industrial.
-- O INSERT do navegador apenas persiste a leitura e devolve ACK rápido.
-- O processamento produtivo ocorre depois, em transações independentes,
-- despertadas por pg_net/Edge Function e recuperadas por cron.

ALTER TABLE public.coletas_producao
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS queue_delay_ms numeric(12,3);

COMMENT ON TABLE public.coletas_producao IS
  'Inbox assíncrono das leituras físicas. O INSERT confirma somente a persistência; o worker executa a regra produtiva em transação separada.';
COMMENT ON COLUMN public.coletas_producao.attempt_count IS
  'Quantidade de tentativas de processamento no worker assíncrono.';
COMMENT ON COLUMN public.coletas_producao.next_attempt_at IS
  'Próximo instante permitido para nova tentativa após falha transitória.';
COMMENT ON COLUMN public.coletas_producao.lease_expires_at IS
  'Prazo da reserva do item por um worker. Ao expirar, outro worker pode recuperar a leitura.';
COMMENT ON COLUMN public.coletas_producao.queue_delay_ms IS
  'Tempo entre o ACK de persistência e o início do processamento produtivo.';

CREATE INDEX IF NOT EXISTS idx_coletas_producao_worker_due
  ON public.coletas_producao (status_sincronizacao, next_attempt_at, created_at)
  WHERE status_sincronizacao IN ('recebida', 'processando');

CREATE TABLE IF NOT EXISTS private.coleta_producao_credentials (
  coleta_id uuid PRIMARY KEY,
  auth_user_id uuid NOT NULL,
  session_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '2 days'),
  CONSTRAINT coleta_producao_credentials_coleta_fk
    FOREIGN KEY (coleta_id)
    REFERENCES public.coletas_producao(id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);

COMMENT ON TABLE private.coleta_producao_credentials IS
  'Credencial operacional efêmera e não exposta pela Data API, eliminada após a decisão final da coleta.';

REVOKE ALL ON TABLE private.coleta_producao_credentials
  FROM PUBLIC, anon, authenticated, service_role;

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
    coleta_id,
    auth_user_id,
    session_token,
    created_at,
    expires_at
  ) VALUES (
    NEW.id,
    v_auth_user_id,
    v_token,
    v_now,
    v_now + interval '2 days'
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

-- A sessão era bloqueada com FOR UPDATE mesmo sem ser alterada. Em várias
-- leituras do mesmo operador isso serializava todos os workers. Mantemos a
-- validação da sessão, mas removemos apenas esse lock desnecessário.
DO $$
DECLARE
  v_definition text;
  v_rewritten text;
BEGIN
  SELECT pg_get_functiondef(
    'public.process_production_reading_impl_v2(jsonb)'::regprocedure
  ) INTO v_definition;

  IF position('FOR UPDATE OF session' IN v_definition) > 0 THEN
    v_rewritten := regexp_replace(
      v_definition,
      E'\\n[[:space:]]*FOR UPDATE OF session;',
      ';',
      'g'
    );
    EXECUTE v_rewritten;
  END IF;

  IF position(
    'FOR UPDATE OF session'
    IN pg_get_functiondef(
      'public.process_production_reading_impl_v2(jsonb)'::regprocedure
    )
  ) > 0 THEN
    RAISE EXCEPTION 'SESSION_LOCK_REMOVAL_FAILED';
  END IF;
END;
$$;

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
  v_worker_id text := coalesce(
    nullif(btrim(p_worker_id), ''),
    gen_random_uuid()::text
  );
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT inbox.id
    FROM public.coletas_producao inbox
    WHERE (
      inbox.status_sincronizacao = 'recebida'
      AND inbox.next_attempt_at <= clock_timestamp()
    ) OR (
      inbox.status_sincronizacao = 'processando'
      AND coalesce(
        inbox.lease_expires_at,
        '-infinity'::timestamptz
      ) <= clock_timestamp()
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

CREATE OR REPLACE FUNCTION public.process_collection_inbox_item(
  p_coleta_id uuid,
  p_worker_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions, realtime, pg_temp
AS $$
DECLARE
  v_row public.coletas_producao%ROWTYPE;
  v_secret private.coleta_producao_credentials%ROWTYPE;
  v_payload jsonb;
  v_result jsonb;
  v_started_at timestamptz := clock_timestamp();
  v_finished_at timestamptz;
  v_sqlstate text;
  v_message text;
  v_retryable boolean;
  v_delay_seconds numeric;
BEGIN
  SELECT * INTO v_row
  FROM public.coletas_producao inbox
  WHERE inbox.id = p_coleta_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('processed', false, 'reason', 'not_found');
  END IF;

  IF v_row.status_sincronizacao IN ('sincronizada', 'erro') THEN
    RETURN jsonb_build_object(
      'processed', false,
      'reason', 'already_final',
      'status_sincronizacao', v_row.status_sincronizacao,
      'client_event_id', v_row.client_event_id,
      'resultado', v_row.resultado
    );
  END IF;

  IF v_row.status_sincronizacao = 'processando'
     AND v_row.worker_id IS DISTINCT FROM p_worker_id
     AND coalesce(
       v_row.lease_expires_at,
       '-infinity'::timestamptz
     ) > clock_timestamp() THEN
    RETURN jsonb_build_object('processed', false, 'reason', 'leased');
  END IF;

  SELECT * INTO v_secret
  FROM private.coleta_producao_credentials credential
  WHERE credential.coleta_id = v_row.id;

  IF v_secret.coleta_id IS NULL
     OR v_secret.expires_at <= clock_timestamp() THEN
    v_finished_at := clock_timestamp();
    UPDATE public.coletas_producao
    SET status_sincronizacao = 'erro',
        retryable = false,
        erro = 'Credencial operacional ausente ou expirada.',
        last_error_code = 'OPERATOR_SESSION_CREDENTIAL_MISSING',
        last_error_at = v_finished_at,
        resultado = jsonb_build_object(
          'success', false,
          'status', 'error',
          'reason_code', 'OPERATOR_SESSION_CREDENTIAL_MISSING',
          'message', 'Faça novamente o login operacional para reenviar esta leitura.',
          'client_event_id', v_row.client_event_id
        ),
        processado_em = v_finished_at,
        processing_duration_ms = extract(
          epoch from (v_finished_at - v_started_at)
        ) * 1000,
        queue_delay_ms = extract(
          epoch from (v_started_at - v_row.server_received_at)
        ) * 1000,
        lease_expires_at = NULL,
        worker_id = NULL,
        updated_at = v_finished_at
    WHERE id = v_row.id;
    DELETE FROM private.coleta_producao_credentials
    WHERE coleta_id = v_row.id;
    RETURN jsonb_build_object(
      'processed', true,
      'status', 'error',
      'client_event_id', v_row.client_event_id
    );
  END IF;

  UPDATE public.coletas_producao
  SET status_sincronizacao = 'processando',
      worker_id = p_worker_id,
      lease_expires_at = clock_timestamp() + interval '45 seconds',
      updated_at = clock_timestamp()
  WHERE id = v_row.id;

  PERFORM set_config(
    'request.jwt.claim.sub',
    v_row.auth_user_id::text,
    true
  );
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_row.auth_user_id,
      'role', 'authenticated'
    )::text,
    true
  );

  v_payload := coalesce(v_row.payload, '{}'::jsonb) || jsonb_build_object(
    'client_event_id', v_row.client_event_id,
    'rawValue', v_row.tag_lida,
    'raw_value', v_row.tag_lida,
    'readerType', v_row.reader_type,
    'reader_type', v_row.reader_type,
    'createdAtClient', v_row.timestamp_leitura,
    'created_at_client', v_row.timestamp_leitura,
    'deviceId', v_row.device_id,
    'device_id', v_row.device_id,
    'operatorSessionToken', v_secret.session_token,
    'operator_session_token', v_secret.session_token,
    'serverAsyncWorker', true,
    'server_async_worker', true
  );

  BEGIN
    v_result := public.process_production_reading_v2(v_payload);
  EXCEPTION
    WHEN query_canceled THEN
      v_sqlstate := SQLSTATE;
      v_message := SQLERRM;
    WHEN OTHERS THEN
      v_sqlstate := SQLSTATE;
      v_message := SQLERRM;
  END;

  IF v_sqlstate IS NULL THEN
    v_finished_at := clock_timestamp();
    UPDATE public.coletas_producao
    SET status_sincronizacao = 'sincronizada',
        retryable = false,
        resultado = coalesce(
          v_result,
          jsonb_build_object(
            'success', false,
            'status', 'error',
            'reason_code', 'EMPTY_COLLECTION_RESULT',
            'message', 'O processador não retornou um resultado.',
            'client_event_id', v_row.client_event_id
          )
        ),
        erro = NULL,
        last_error_code = NULL,
        last_error_at = NULL,
        processado_em = v_finished_at,
        processing_duration_ms = extract(
          epoch from (v_finished_at - v_started_at)
        ) * 1000,
        queue_delay_ms = extract(
          epoch from (v_started_at - v_row.server_received_at)
        ) * 1000,
        lease_expires_at = NULL,
        worker_id = NULL,
        updated_at = v_finished_at
    WHERE id = v_row.id;
    DELETE FROM private.coleta_producao_credentials
    WHERE coleta_id = v_row.id;
    RETURN jsonb_build_object(
      'processed', true,
      'status', 'sincronizada',
      'client_event_id', v_row.client_event_id,
      'resultado', v_result
    );
  END IF;

  v_retryable := left(v_sqlstate, 2) = '08'
    OR v_sqlstate IN (
      '40001', '40P01', '55P03', '57014', '57P01', '53300'
    );
  v_finished_at := clock_timestamp();

  IF v_retryable AND v_row.attempt_count < 12 THEN
    v_delay_seconds := least(
      60,
      greatest(
        1,
        power(2::numeric, greatest(v_row.attempt_count - 1, 0))
      )
    );
    UPDATE public.coletas_producao
    SET status_sincronizacao = 'recebida',
        retryable = true,
        erro = left(v_message, 1000),
        last_error_code = v_sqlstate,
        last_error_at = v_finished_at,
        next_attempt_at = v_finished_at + make_interval(
          secs => v_delay_seconds::double precision
        ),
        lease_expires_at = NULL,
        worker_id = NULL,
        updated_at = v_finished_at
    WHERE id = v_row.id;
    RETURN jsonb_build_object(
      'processed', false,
      'status', 'retry_scheduled',
      'client_event_id', v_row.client_event_id,
      'reason_code', v_sqlstate,
      'retry_in_seconds', v_delay_seconds
    );
  END IF;

  UPDATE public.coletas_producao
  SET status_sincronizacao = 'erro',
      retryable = false,
      erro = left(v_message, 1000),
      last_error_code = coalesce(
        v_sqlstate,
        'COLLECTION_WORKER_ERROR'
      ),
      last_error_at = v_finished_at,
      resultado = jsonb_build_object(
        'success', false,
        'status', 'error',
        'reason_code', coalesce(v_sqlstate, 'COLLECTION_WORKER_ERROR'),
        'message', left(v_message, 1000),
        'client_event_id', v_row.client_event_id,
        'retryable', false
      ),
      processado_em = v_finished_at,
      processing_duration_ms = extract(
        epoch from (v_finished_at - v_started_at)
      ) * 1000,
      queue_delay_ms = extract(
        epoch from (v_started_at - v_row.server_received_at)
      ) * 1000,
      lease_expires_at = NULL,
      worker_id = NULL,
      updated_at = v_finished_at
  WHERE id = v_row.id;
  DELETE FROM private.coleta_producao_credentials
  WHERE coleta_id = v_row.id;

  RETURN jsonb_build_object(
    'processed', true,
    'status', 'error',
    'client_event_id', v_row.client_event_id,
    'reason_code', coalesce(v_sqlstate, 'COLLECTION_WORKER_ERROR')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_collection_inbox_item(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_collection_inbox_item(uuid, text)
  TO service_role;

-- Credencial e URL do wake-up são mantidas no Vault; nenhuma chave service_role
-- é exposta ao navegador ou gravada no repositório.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'acprod_collection_worker_secret'
  ) THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'acprod_collection_worker_secret',
      'Credencial interna do wake-up do worker de coleta AC.Prod2'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'acprod_collection_worker_url'
  ) THEN
    PERFORM vault.create_secret(
      'https://uozuzdfvnufsjsonswag.supabase.co/functions/v1/process-collection-inbox',
      'acprod_collection_worker_url',
      'Endpoint interno do worker assíncrono de coleta AC.Prod2'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_collection_worker_cron_secret(
  p_secret text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, vault, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets secret
    WHERE secret.name = 'acprod_collection_worker_secret'
      AND extensions.digest(secret.decrypted_secret, 'sha256')
          = extensions.digest(coalesce(p_secret, ''), 'sha256')
  );
$$;

REVOKE ALL ON FUNCTION public.verify_collection_worker_cron_secret(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_collection_worker_cron_secret(text)
  TO service_role;

CREATE OR REPLACE FUNCTION private.wake_collection_inbox_worker(
  p_source text DEFAULT 'database',
  p_limit integer DEFAULT 40
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
      'limit', greatest(1, least(coalesce(p_limit, 40), 100)),
      'concurrency', 8,
      'max_rounds', 3
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
    SELECT 1 FROM new_collection_rows row
    WHERE row.status_sincronizacao = 'recebida'
  ) THEN
    PERFORM private.wake_collection_inbox_worker('insert-trigger', 60);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_collection_inbox_worker()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_wake_collection_inbox_worker
  ON public.coletas_producao;
CREATE TRIGGER trg_wake_collection_inbox_worker
AFTER INSERT ON public.coletas_producao
REFERENCING NEW TABLE AS new_collection_rows
FOR EACH STATEMENT
EXECUTE FUNCTION private.notify_collection_inbox_worker();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'coletas_producao'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.coletas_producao;
  END IF;
END;
$$;

-- Recuperação automática caso o wake-up imediato ou a Edge Function sofram
-- indisponibilidade temporária. O trigger é o caminho normal e imediato.
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
    '10 seconds',
    $cron$select private.wake_collection_inbox_worker('cron-fallback', 100);$cron$
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_collection_async_release()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, vault, cron, pg_temp
AS $$
  WITH base AS (
    SELECT public.get_public_collection_micro_batch_release() AS release
  ),
  ingress_definition AS (
    SELECT lower(pg_get_functiondef(
      'public.process_coleta_producao_ingress()'::regprocedure
    )) AS definition
  ),
  hotpath_definition AS (
    SELECT lower(pg_get_functiondef(
      'public.process_production_reading_impl_v2(jsonb)'::regprocedure
    )) AS definition
  ),
  flags AS (
    SELECT jsonb_build_object(
      'collection_async_inbox_columns',
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'coletas_producao'
            AND column_name = 'attempt_count'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'coletas_producao'
            AND column_name = 'lease_expires_at'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'coletas_producao'
            AND column_name = 'queue_delay_ms'
        ),
      'collection_async_ingress_is_lightweight',
        (SELECT position('coleta_producao_credentials' in definition) > 0
                AND position('process_production_reading_v2' in definition) = 0
         FROM ingress_definition),
      'collection_async_private_credentials',
        to_regclass('private.coleta_producao_credentials') IS NOT NULL
        AND NOT has_table_privilege(
          'authenticated',
          'private.coleta_producao_credentials',
          'SELECT'
        )
        AND NOT has_table_privilege(
          'service_role',
          'private.coleta_producao_credentials',
          'SELECT'
        ),
      'collection_async_worker_rpcs',
        to_regprocedure('public.claim_collection_inbox(text,integer)') IS NOT NULL
        AND to_regprocedure('public.process_collection_inbox_item(uuid,text)') IS NOT NULL
        AND has_function_privilege(
          'service_role',
          'public.claim_collection_inbox(text,integer)',
          'EXECUTE'
        )
        AND has_function_privilege(
          'service_role',
          'public.process_collection_inbox_item(uuid,text)',
          'EXECUTE'
        )
        AND NOT has_function_privilege(
          'authenticated',
          'public.claim_collection_inbox(text,integer)',
          'EXECUTE'
        )
        AND NOT has_function_privilege(
          'authenticated',
          'public.process_collection_inbox_item(uuid,text)',
          'EXECUTE'
        ),
      'collection_async_session_lock_removed',
        (SELECT position('for update of session' in definition) = 0
         FROM hotpath_definition),
      'collection_async_realtime',
        EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime'
            AND schemaname = 'public'
            AND tablename = 'coletas_producao'
        ),
      'collection_async_wakeup_trigger',
        EXISTS (
          SELECT 1 FROM pg_trigger trigger_row
          WHERE trigger_row.tgrelid = 'public.coletas_producao'::regclass
            AND trigger_row.tgname = 'trg_wake_collection_inbox_worker'
            AND trigger_row.tgenabled <> 'D'
        ),
      'collection_async_fallback_cron',
        EXISTS (
          SELECT 1 FROM cron.job
          WHERE jobname = 'run-process-collection-inbox'
            AND active IS TRUE
        ),
      'collection_async_vault_secrets',
        EXISTS (
          SELECT 1 FROM vault.decrypted_secrets
          WHERE name = 'acprod_collection_worker_secret'
        )
        AND EXISTS (
          SELECT 1 FROM vault.decrypted_secrets
          WHERE name = 'acprod_collection_worker_url'
        )
    ) AS value
  )
  SELECT jsonb_build_object(
    'ready',
      coalesce((base.release ->> 'ready')::boolean, false)
      AND NOT EXISTS (
        SELECT 1
        FROM flags, jsonb_each_text(flags.value) flag
        WHERE flag.value IS DISTINCT FROM 'true'
      ),
    'migration_version', coalesce((
      SELECT migration.version
      FROM supabase_migrations.schema_migrations migration
      WHERE migration.name = 'collection_async_inbox_worker_v8_7'
      ORDER BY migration.version DESC
      LIMIT 1
    ), ''),
    'release_version', '20260831_acprod_collection_async_worker_v8_7',
    'schema_flags', (base.release -> 'schema_flags') || flags.value
  )
  FROM base, flags;
$$;

REVOKE ALL ON FUNCTION public.get_public_collection_async_release()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_collection_async_release()
  TO anon, authenticated;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260831_acprod_collection_async_worker_v8_7',
  'async-inbox-edge-worker-skip-locked-realtime-wakeup',
  'ACK de INSERT desacoplado da regra produtiva, worker Edge concorrente, lease/SKIP LOCKED, retry durável, wake-up imediato e fallback cron.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

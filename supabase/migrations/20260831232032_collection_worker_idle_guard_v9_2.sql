-- AC.Prod2 — proteção contra wakeups ociosos do worker assíncrono v9.2.
--
-- O trigger de INSERT continua acordando a Edge Function imediatamente quando
-- uma leitura entra no inbox. O cron permanece apenas como rede de segurança,
-- mas deixa de emitir HTTP quando não existe trabalho pendente ou lease vencido.

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
    WHERE (
      inbox.status_sincronizacao = 'recebida'
      AND coalesce(inbox.next_attempt_at, '-infinity'::timestamptz)
        <= clock_timestamp()
    ) OR (
      inbox.status_sincronizacao = 'processando'
      AND coalesce(inbox.lease_expires_at, '-infinity'::timestamptz)
        <= clock_timestamp()
    )
  ) THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret
  INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'acprod_collection_worker_url'
  LIMIT 1;

  SELECT decrypted_secret
  INTO v_secret
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
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION private.wake_collection_inbox_worker(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.wake_collection_inbox_worker(text, integer)
  TO postgres, service_role;

SELECT cron.alter_job(
  (
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'run-process-collection-inbox'
    LIMIT 1
  ),
  schedule := '15 seconds'
);

UPDATE public.app_schema_releases
SET schema_flags = schema_flags || jsonb_build_object(
      'collection_async_empty_wakeup_guard', true,
      'collection_async_fallback_interval_15s', true
    ),
    checksum = 'async-inbox-worker-v8-8-plus-idle-wakeup-guard-v9-2',
    notes = concat_ws(
      E'\n',
      nullif(notes, ''),
      'v9.2: fallback cron alterado para 15 segundos; wake HTTP é ignorado quando não há itens vencidos ou pendentes.'
    )
WHERE version = '20260831_acprod_collection_async_sync_v8_8';

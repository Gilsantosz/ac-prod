-- AC.Prod2 v8.6 — PCP import timeout resilience.
-- Avoids O(n²) batch progress recalculation while initially attaching
-- imported pieces; commit_pcp_import performs one authoritative refresh
-- at the end of each chunk.

CREATE OR REPLACE FUNCTION public.sync_pcp_batch_progress_from_piece()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF OLD.pcp_import_batch_id IS NULL
     AND NEW.pcp_import_batch_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.pcp_import_batch_id IS DISTINCT FROM NEW.pcp_import_batch_id
     AND OLD.pcp_import_batch_id IS NOT NULL THEN
    PERFORM public.refresh_pcp_batch_progress(OLD.pcp_import_batch_id);
  END IF;

  IF NEW.pcp_import_batch_id IS NOT NULL THEN
    PERFORM public.refresh_pcp_batch_progress(NEW.pcp_import_batch_id);
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.commit_pcp_import(
  uuid, text, text, text, text, text, integer, jsonb, boolean
) SET statement_timeout TO '55s';

INSERT INTO public.app_schema_releases(version, checksum, notes)
VALUES (
  '20260831_pcp_import_timeout_resilience_v8_6',
  'pcp-import-skip-redundant-progress-refresh-function-timeout-55s',
  'Evita recálculo quadrático do progresso na vinculação inicial das peças e permite até 55 s para a RPC de importação PCP.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = EXCLUDED.checksum,
    notes = EXCLUDED.notes,
    applied_at = clock_timestamp();

NOTIFY pgrst, 'reload schema';

-- AC.Prod2 — dashboard read-path optimization v1.
-- Keeps the operational dashboard on the canonical production_entries ledger.
-- Realtime remains authoritative; no materialized view or minute cron is added.

DO $migration$
BEGIN
  IF to_regclass('public.production_entries') IS NULL THEN
    RAISE EXCEPTION 'ACPROD_DASHBOARD_OPTIMIZATION: production_entries is missing';
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS idx_production_entries_dashboard_period
  ON public.production_entries (date DESC, created_at DESC);

COMMENT ON INDEX public.idx_production_entries_dashboard_period IS
  'Supports AC.Prod2 dashboard period scans ordered by date and creation time.';

-- READ-ONLY observation, not a throughput benchmark. Run before/after a bounded
-- interval on the SAME isolated target. No pg_stat_statements_reset, replay,
-- refresh, flags or worker functions are called. No tokens/payloads/query text.
-- Aggregate counts can be reconciled; completed-only percentiles cannot certify
-- latency while any receipts remain unfinalized/unprojected.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '500ms';

WITH recent AS MATERIALIZED (
  SELECT received_at_db, enqueued_at, processing_started_at,
         decision_committed_at, projected_at, dead_lettered_at
  FROM public.coletas_producao
  WHERE pipeline_version = 3 AND received_at_db >= now() - interval '1 hour'
), pending AS (
  SELECT count(*) FILTER (WHERE decision_committed_at IS NULL AND dead_lettered_at IS NULL) AS waiting_decision,
         count(*) FILTER (WHERE decision_committed_at IS NOT NULL AND projected_at IS NULL AND dead_lettered_at IS NULL) AS waiting_projection,
         count(*) FILTER (WHERE dead_lettered_at IS NOT NULL) AS dead_lettered,
         extract(epoch FROM (now() - min(received_at_db) FILTER (WHERE projected_at IS NULL AND dead_lettered_at IS NULL))) AS oldest_unprojected_age_seconds
  FROM public.coletas_producao WHERE pipeline_version = 3
), latency AS (
  SELECT count(*) AS receipts_last_hour,
         count(decision_committed_at) AS decision_samples,
         count(projected_at) AS projection_samples,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM decision_committed_at - received_at_db) * 1000) AS received_to_decision_p95_ms,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM projected_at - decision_committed_at) * 1000) AS decision_to_projection_p95_ms,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM projected_at - received_at_db) * 1000) AS received_to_projection_p95_ms,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM processing_started_at - enqueued_at) * 1000) AS queue_p95_ms
  FROM recent
), outbox AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE projected_at IS NULL AND dead_lettered_at IS NULL) AS pending,
         count(*) FILTER (WHERE projected_at IS NOT NULL) AS projected,
         count(*) FILTER (WHERE dead_lettered_at IS NOT NULL) AS dead_lettered,
         max(attempt_count) FILTER (WHERE projected_at IS NULL) AS max_pending_attempts,
         extract(epoch FROM (now() - min(created_at) FILTER (WHERE projected_at IS NULL AND dead_lettered_at IS NULL))) AS oldest_pending_age_seconds
  FROM public.collection_projection_outbox
), integrity AS (
  SELECT (SELECT count(*) FROM public.production_stage_readings WHERE status='approved') AS approved_readings,
         (SELECT count(*) FROM public.collection_stage_facts) AS fact_rows,
         (SELECT count(*) FROM public.production_stage_readings r WHERE r.status='approved'
          AND NOT EXISTS (SELECT 1 FROM public.collection_stage_facts f WHERE f.reading_id=r.id)) AS approved_without_fact
), by_cell AS (
  SELECT cell_id, count(*) FILTER (WHERE projected_at IS NULL AND dead_lettered_at IS NULL) AS pending,
         min(created_at) FILTER (WHERE projected_at IS NULL AND dead_lettered_at IS NULL) AS oldest_pending_at
  FROM public.collection_projection_outbox GROUP BY cell_id
)
SELECT jsonb_build_object(
  'observed_at', clock_timestamp(),
  'receipt_backlog', (SELECT to_jsonb(pending) FROM pending),
  'latency_completed_only', (SELECT to_jsonb(latency) FROM latency),
  'outbox', (SELECT to_jsonb(outbox) FROM outbox),
  'reading_view_integrity', (SELECT to_jsonb(integrity) FROM integrity),
  'affected_cells', (SELECT coalesce(jsonb_agg(to_jsonb(by_cell)) FILTER (WHERE pending>0),'[]'::jsonb) FROM by_cell),
  'active_waits', (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND wait_event_type='Lock'),
  'capacity_certified', false
) AS observation;
COMMIT;

-- IMPORTANT: collection_stage_facts is a VIEW of approved readings, not proof
-- that the asynchronous outbox, counters, dashboard or Broadcast caught up.
-- After RPC restoration, measure get_collection_dashboard_snapshot_v2 and
-- get_operator_shift_kpis_v2 through a normally authenticated test browser/API.
-- Do not forge an identity or use anon/service_role to imitate operator load.

-- READ ONLY. Supabase pg_stat_statements lives in extensions on this target.
-- Counters are cumulative since last reset, not a p95 distribution. Capture
-- twice and compare deltas in calls/total_exec_time/rows; do not reset shared
-- stats. Only operation labels and numeric counters are returned, never SQL
-- text (which can contain credentials or user values).
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT operation, sum(calls) AS calls, sum(total_exec_time) AS total_exec_ms,
       sum(total_exec_time) / nullif(sum(calls),0) AS weighted_mean_exec_ms,
       max(max_exec_time) AS max_exec_ms, sum(rows) AS rows,
       sum(shared_blks_hit) AS shared_hits, sum(shared_blks_read) AS shared_reads
FROM (
  SELECT CASE
    WHEN query ILIKE '%get_collection_dashboard_snapshot_v%' THEN 'dashboard_snapshot'
    WHEN query ILIKE '%get_operator_shift_kpis_v2%' THEN 'operator_shift_kpis'
    WHEN query ILIKE '%run_collection_worker_cycle_v3%' THEN 'worker_cycle'
    WHEN query ILIKE '%process_collection_projection_batch_v3%' THEN 'projection_batch'
    WHEN query ILIKE '%ingest_collection_batch_v3%' THEN 'ingress_batch'
    WHEN query ILIKE '%get_collection_cell_snapshot%' THEN 'legacy_cell_snapshot'
  END AS operation, calls, total_exec_time, max_exec_time, rows, shared_blks_hit, shared_blks_read
  FROM extensions.pg_stat_statements
  WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
    AND query ~* '^[[:space:]]*(select|with)[[:space:]]'
    AND query NOT ILIKE '%pg_stat_statements%'
) statement_stats
WHERE operation IS NOT NULL
GROUP BY operation ORDER BY total_exec_ms DESC;
COMMIT;

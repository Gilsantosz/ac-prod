-- AC.Prod2 migration-ledger alignment.
-- Version 20260831051513 (support_manual_lot_route_metrics_v5) was applied through the controlled Supabase
-- migration channel and is already recorded in production project uozuzdfvnufsjsonswag.
-- This no-op file keeps the local CLI ledger aligned. The final contract migrations
-- fail closed when any required runtime object is absent.

SELECT 1;

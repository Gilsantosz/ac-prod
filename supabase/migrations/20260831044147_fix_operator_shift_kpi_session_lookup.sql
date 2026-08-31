-- AC.Prod2 migration-ledger alignment.
-- Version 20260831044147 (fix_operator_shift_kpi_session_lookup) was applied through the controlled Supabase
-- migration channel and is already recorded in production project uozuzdfvnufsjsonswag.
-- This no-op file keeps the local CLI ledger aligned. The final contract migrations
-- fail closed when any required runtime object is absent.

SELECT 1;

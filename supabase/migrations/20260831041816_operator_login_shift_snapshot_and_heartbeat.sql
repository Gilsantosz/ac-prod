-- AC.Prod2 migration-ledger alignment.
-- Version 20260831041816 (operator_login_shift_snapshot_and_heartbeat) was applied through the controlled Supabase
-- migration channel and is already recorded in production project uozuzdfvnufsjsonswag.
-- This no-op file keeps the local CLI ledger aligned. The final contract migrations
-- fail closed when any required runtime object is absent.

SELECT 1;

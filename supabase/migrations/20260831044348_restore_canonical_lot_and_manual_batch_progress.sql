-- AC.Prod2 migration-ledger alignment.
-- Version 20260831044348 (restore_canonical_lot_and_manual_batch_progress) was applied through the controlled Supabase
-- migration channel and is already recorded in production project uozuzdfvnufsjsonswag.
-- This no-op file keeps the local CLI ledger aligned. The final contract migrations
-- fail closed when any required runtime object is absent.

SELECT 1;

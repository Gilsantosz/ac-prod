-- AC.Prod2 migration-ledger alignment.
-- Version 20260831045242 (prefer_server_active_machine_context_over_client_cache) was applied through the controlled Supabase
-- migration channel and is already recorded in production project uozuzdfvnufsjsonswag.
-- This no-op file keeps the local CLI ledger aligned. The final contract migrations
-- fail closed when any required runtime object is absent.

SELECT 1;

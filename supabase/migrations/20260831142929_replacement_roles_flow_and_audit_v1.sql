-- AC.Prod2 migration-ledger alignment.
-- Version 20260831142929 (replacement_roles_flow_and_audit_v1) was applied by
-- a concurrent controlled Supabase migration after the v8.2 deploy. Its useful
-- dedicated audit ledger is preserved, while v8.3 restores strict hierarchy,
-- replacement classification and compatibility with the existing History UI.

SELECT 1;

-- AC.Prod2 migration-ledger alignment.
-- Version 20260831135344 (replacement_lot_close_status_v8_1) was applied
-- through the controlled Supabase migration channel. Replacement reconciliation
-- closes production_lots with canonical status `closed`, closed_at and actual_end.

SELECT 1;

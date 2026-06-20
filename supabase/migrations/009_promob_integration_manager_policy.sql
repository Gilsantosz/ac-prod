-- ============================================================
-- AC.Prod — MES Leo Madeiras
-- Migration 009: Alinha permissões da integração Promob
-- Permite que admin e manager configurem integrações Promob,
-- como já validado nas Edge Functions promob-api-sync/import.
-- ============================================================

DROP POLICY IF EXISTS "promob_int_write_admin" ON promob_integrations;
DROP POLICY IF EXISTS "promob_int_write_admin_manager" ON promob_integrations;

CREATE POLICY "promob_int_write_admin_manager" ON promob_integrations
  FOR ALL TO authenticated
  USING (get_my_role() IN ('admin','manager'))
  WITH CHECK (get_my_role() IN ('admin','manager'));

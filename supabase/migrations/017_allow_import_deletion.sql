-- ============================================================
-- AC.Prod — MES Leo Madeiras
-- Migration 017: Permissão de exclusão de OPs e lotes de importação para admin/manager
-- ============================================================

-- 1. Atualizar política de exclusão na tabela production_orders
DROP POLICY IF EXISTS "po_delete_admin" ON production_orders;
CREATE POLICY "po_delete_admin_manager" ON production_orders
  FOR DELETE TO authenticated
  USING (get_my_role() IN ('admin', 'manager'));

-- 2. Criar política de exclusão na tabela promob_import_batches
DROP POLICY IF EXISTS "promob_batches_delete_admin_manager" ON promob_import_batches;
CREATE POLICY "promob_batches_delete_admin_manager" ON promob_import_batches
  FOR DELETE TO authenticated
  USING (get_my_role() IN ('admin', 'manager'));

-- ============================================================
-- Migration 034: Correção das políticas RLS da tabela cells
-- Permite que admin E manager possam criar, editar e excluir células.
-- Antes: apenas 'admin' podia escrever (cells_admin_write).
-- Após: admin e manager podem gerenciar células.
-- ============================================================

-- Remove a policy restritiva existente que limita a escrita apenas a admin
DROP POLICY IF EXISTS "cells_admin_write" ON cells;
DROP POLICY IF EXISTS "cells_write_admin_manager" ON cells;

-- Recria a policy correta: admin e manager podem fazer qualquer operação (ALL)
CREATE POLICY "cells_write_admin_manager" ON cells
  FOR ALL TO authenticated
  USING (get_my_role() IN ('admin', 'manager'))
  WITH CHECK (get_my_role() IN ('admin', 'manager'));

-- Garante que a policy de leitura ainda existe para todos autenticados
DROP POLICY IF EXISTS "cells_authenticated_read" ON cells;
DROP POLICY IF EXISTS "cells_select_auth" ON cells;

CREATE POLICY "cells_select_auth" ON cells
  FOR SELECT TO authenticated
  USING (true);

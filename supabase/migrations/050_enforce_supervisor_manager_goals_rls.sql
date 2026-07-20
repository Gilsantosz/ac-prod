-- ============================================================
-- Migration 050: Garantia de Segurança RLS para Metas Produtivas
-- Permite que APENAS os perfis de admin, manager (gestor) e supervisor
-- possam criar, alterar ou excluir metas produtivas no sistema.
-- Impede qualquer alteração de metas por perfis operacionais ou não autorizados.
-- ============================================================

-- 1. Políticas RLS para production_daily_goals
ALTER TABLE IF EXISTS public.production_daily_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_daily_goals_write ON public.production_daily_goals;
DROP POLICY IF EXISTS production_daily_goals_admin_manager ON public.production_daily_goals;

CREATE POLICY production_daily_goals_write ON public.production_daily_goals
  FOR ALL TO authenticated
  USING (get_my_role() IN ('admin', 'manager', 'supervisor'))
  WITH CHECK (get_my_role() IN ('admin', 'manager', 'supervisor'));

-- 2. Políticas RLS para daily_goals (tabela legada)
ALTER TABLE IF EXISTS public.daily_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_goals_write ON public.daily_goals;
DROP POLICY IF EXISTS daily_goals_admin_manager ON public.daily_goals;

CREATE POLICY daily_goals_write ON public.daily_goals
  FOR ALL TO authenticated
  USING (get_my_role() IN ('admin', 'manager', 'supervisor'))
  WITH CHECK (get_my_role() IN ('admin', 'manager', 'supervisor'));

-- 3. Políticas RLS para monthly_goals
ALTER TABLE IF EXISTS public.monthly_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS monthly_goals_write ON public.monthly_goals;

CREATE POLICY monthly_goals_write ON public.monthly_goals
  FOR ALL TO authenticated
  USING (get_my_role() IN ('admin', 'manager', 'supervisor'))
  WITH CHECK (get_my_role() IN ('admin', 'manager', 'supervisor'));

-- As tabelas-base já possuem RLS de leitura para usuários autenticados.
-- As views passam a obedecer a identidade e as políticas do chamador.

alter view public.production_cell_progress set (security_invoker = true);
alter view public.production_daily_cell_summary set (security_invoker = true);
alter view public.production_daily_unit_summary set (security_invoker = true);
alter view public.v_customer_cover_summary set (security_invoker = true);

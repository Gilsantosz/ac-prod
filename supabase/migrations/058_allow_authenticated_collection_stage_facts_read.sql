-- MIGRATION 058
-- Permite que o fallback autenticado dos KPIs consulte a visão canônica.
-- A visão é SECURITY INVOKER e continua respeitando as políticas RLS das tabelas-base.

REVOKE ALL ON public.collection_stage_facts FROM anon;
GRANT SELECT ON public.collection_stage_facts TO authenticated;

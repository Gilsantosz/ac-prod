-- A view é consumida somente pelo RPC SECURITY DEFINER de snapshot.
-- security_invoker evita que uma consulta direta contorne RLS das tabelas-base.
ALTER VIEW public.collection_stage_facts SET (security_invoker = true);

REVOKE ALL ON public.collection_stage_facts FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

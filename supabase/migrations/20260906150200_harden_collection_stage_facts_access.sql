-- Keep collection facts behind the caller's RLS context and pin search paths
-- for the two legacy helpers reported by the Supabase security advisor.

ALTER VIEW public.collection_stage_facts
  SET (security_invoker = true);

GRANT SELECT ON public.collection_stage_facts
  TO authenticated, service_role;

ALTER FUNCTION public.sync_production_lot_context()
  SET search_path = pg_catalog, public, extensions;

ALTER FUNCTION public.canonical_stage_label(text)
  SET search_path = pg_catalog, public;

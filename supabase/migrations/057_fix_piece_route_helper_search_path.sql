-- MIGRATION 057
-- Fixa explicitamente o search_path da função auxiliar usada pelos KPIs.

CREATE OR REPLACE FUNCTION public.piece_requires_routing_step(
  p_step_code text,
  p_route_steps text[],
  p_requires_cut boolean,
  p_requires_edge boolean,
  p_requires_cnc boolean,
  p_requires_joinery boolean,
  p_requires_separation boolean,
  p_requires_packaging boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN cardinality(COALESCE(p_route_steps, ARRAY[]::text[])) > 0
      THEN p_step_code = ANY(p_route_steps)
    WHEN p_step_code = 'cut' THEN COALESCE(p_requires_cut, true)
    WHEN p_step_code = 'edge' THEN COALESCE(p_requires_edge, false)
    WHEN p_step_code IN ('cnc', 'drill') THEN COALESCE(p_requires_cnc, false)
    WHEN p_step_code = 'joinery' THEN COALESCE(p_requires_joinery, false)
    WHEN p_step_code = 'separation' THEN COALESCE(p_requires_separation, true)
    WHEN p_step_code = 'packaging' THEN COALESCE(p_requires_packaging, true)
    WHEN p_step_code = 'shipping' THEN true
    ELSE false
  END;
$$;

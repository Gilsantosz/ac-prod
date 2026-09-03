-- AC.Prod2 — habilita baixa manual por volume em todas as etapas produtivas.
-- Também publica a política no Supabase Realtime para que alterações administrativas
-- deixem de depender de cache local/reload entre postos de trabalho.

UPDATE public.production_stage_policies
SET manual_quantity_allowed = true,
    updated_at = now()
WHERE stage_code IN ('cut', 'edge', 'drill', 'cnc', 'joinery')
  AND manual_quantity_allowed IS DISTINCT FROM true;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'production_stage_policies'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.production_stage_policies;
  END IF;
END
$migration$;

-- Elimina a ambiguidade entre os RPCs de 5 e 7 argumentos.
-- A implementação acumulativa existente passa a ser a fonte canônica interna;
-- ambos os contratos públicos retornam exatamente o mesmo histórico real.

ALTER FUNCTION public.get_collection_cell_snapshot(
  text,
  uuid,
  text,
  timestamptz,
  timestamptz,
  uuid,
  uuid
) RENAME TO get_collection_cell_snapshot_v2;

CREATE OR REPLACE FUNCTION public.get_collection_cell_snapshot(
  p_cell_name text,
  p_workstation_id uuid DEFAULT NULL,
  p_shift text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_collection_cell_snapshot_v2(
    p_cell_name,
    p_workstation_id,
    p_shift,
    p_date_from,
    p_date_to,
    NULL::uuid,
    NULL::uuid
  );
$$;

-- Sem argumentos padrão: uma chamada de cinco parâmetros nunca mais será
-- confundida pelo PostgREST com esta assinatura de sete parâmetros.
CREATE OR REPLACE FUNCTION public.get_collection_cell_snapshot(
  p_cell_name text,
  p_workstation_id uuid,
  p_shift text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_pcp_import_batch_id uuid,
  p_lot_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_collection_cell_snapshot_v2(
    p_cell_name,
    p_workstation_id,
    p_shift,
    p_date_from,
    p_date_to,
    p_pcp_import_batch_id,
    p_lot_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_collection_cell_snapshot(
  text, uuid, text, timestamptz, timestamptz
) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_collection_cell_snapshot(
  text, uuid, text, timestamptz, timestamptz, uuid, uuid
) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_collection_cell_snapshot_v2(
  text, uuid, text, timestamptz, timestamptz, uuid, uuid
) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

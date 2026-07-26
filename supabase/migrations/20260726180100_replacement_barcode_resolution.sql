BEGIN;

-- O código de barras ativo da reposição passa a ter precedência sobre a peça
-- original reprovada sem apagar o histórico desta peça.
CREATE OR REPLACE FUNCTION public.resolve_piece_by_identifier(p_identifier text)
RETURNS public.production_pieces
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_normalized text := trim(p_identifier);
  v_piece public.production_pieces;
  v_count integer;
BEGIN
  IF v_normalized IS NULL OR v_normalized = '' THEN
    RAISE EXCEPTION 'Identificador vazio' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(DISTINCT t.piece_id)
  INTO v_count
  FROM public.production_tags t
  WHERE upper(t.tag_value) = upper(v_normalized)
    AND t.active IS TRUE
    AND t.piece_id IS NOT NULL;

  IF v_count = 1 THEN
    SELECT t.piece_id
    INTO v_piece.id
    FROM public.production_tags t
    WHERE upper(t.tag_value) = upper(v_normalized)
      AND t.active IS TRUE
      AND t.piece_id IS NOT NULL
    ORDER BY t.updated_at DESC, t.created_at DESC
    LIMIT 1;

    SELECT * INTO v_piece FROM public.production_pieces WHERE id = v_piece.id;
    RETURN v_piece;
  ELSIF v_count > 1 THEN
    RAISE EXCEPTION 'Identificador % ambíguo (múltiplas tags ativas)', p_identifier USING ERRCODE = 'P0004';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.production_pieces p
  WHERE upper(p.piece_uid) = upper(v_normalized)
     OR upper(p.traceability_code) = upper(v_normalized);

  IF v_count = 0 THEN
    SELECT count(*) INTO v_count
    FROM public.production_tags t
    WHERE upper(t.tag_value) = upper(v_normalized)
      AND t.active IS FALSE;

    IF v_count > 0 THEN
      RAISE EXCEPTION 'Identificador % inativo no sistema', p_identifier USING ERRCODE = 'P0003';
    END IF;
    RAISE EXCEPTION 'Peça não localizada para o identificador %', p_identifier USING ERRCODE = 'P0002';
  ELSIF v_count > 1 THEN
    RAISE EXCEPTION 'Identificador % ambíguo (múltiplas peças encontradas)', p_identifier USING ERRCODE = 'P0004';
  END IF;

  SELECT p.id
  INTO v_piece.id
  FROM public.production_pieces p
  WHERE upper(p.piece_uid) = upper(v_normalized)
     OR upper(p.traceability_code) = upper(v_normalized)
  ORDER BY p.updated_at DESC, p.created_at DESC
  LIMIT 1;

  SELECT * INTO v_piece FROM public.production_pieces WHERE id = v_piece.id;
  RETURN v_piece;
END;
$$;

CREATE OR REPLACE FUNCTION public.replacement_cell_matches_step(p_cell_name text, p_step_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_cell_name IS NULL OR p_step_code IS NULL THEN false
    WHEN p_step_code = 'cut' THEN lower(trim(p_cell_name)) = 'corte'
    WHEN p_step_code = 'edge' THEN lower(trim(p_cell_name)) IN ('borda', 'bordo')
    WHEN p_step_code IN ('cnc', 'drill', 'canal', 'maranello', 'portajoias', 'sorrento', 'usi_especial', 'rasgo_freggio')
      THEN lower(trim(p_cell_name)) = 'usinagem'
    WHEN p_step_code = 'joinery' THEN lower(trim(p_cell_name)) = 'marcenaria'
    WHEN p_step_code = 'packaging' THEN lower(trim(p_cell_name)) = 'embalagem'
    WHEN p_step_code = 'shipping' THEN lower(trim(p_cell_name)) = 'expedição'
    ELSE EXISTS (
      SELECT 1
      FROM public.routing_steps rs
      WHERE rs.code = p_step_code
        AND lower(trim(rs.name)) = lower(trim(p_cell_name))
    )
  END;
$$;


COMMIT;

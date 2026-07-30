-- ============================================================
-- AC.Prod MES — Liberação de Impressão de Etiquetas no Registro da Reposição
-- Migration 20260730130000
-- ============================================================

-- Atualizar RPC register_replacement_label_print para permitir impressão imediata em solicitações abertas
CREATE OR REPLACE FUNCTION public.register_replacement_label_print(
  p_replacement_request_id uuid,
  p_reprint_reason text DEFAULT NULL,
  p_reprint_reason_details text DEFAULT NULL,
  p_printer_name text DEFAULT 'Impressora Padrão',
  p_user_name text DEFAULT 'Operador MES',
  p_client_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_order record;
  v_orig_piece record;
  v_repl_piece record;
  v_label record;
  v_trace_code text;
  v_orig_code text;
  v_print_count integer := 0;
  v_is_reprint boolean := false;
  v_print_id uuid;
  v_label_id uuid;
  v_template_id uuid;
BEGIN
  -- 1. Buscar Ordem de Reposição
  SELECT * INTO v_order FROM public.replacement_orders WHERE id = p_replacement_request_id;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ordem de reposição não encontrada.');
  END IF;

  -- 2. Validar se a reposição está cancelada (Bloquear apenas se for cancelada)
  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Etiqueta bloqueada. A ordem de reposição foi CANCELADA.');
  END IF;

  -- 3. Obter Peça Original
  IF v_order.original_piece_id IS NOT NULL THEN
    SELECT * INTO v_orig_piece FROM public.production_pieces WHERE id = v_order.original_piece_id;
  END IF;

  -- 4. Obter Peça Substituta
  IF v_order.replacement_piece_id IS NOT NULL THEN
    SELECT * INTO v_repl_piece FROM public.production_pieces WHERE id = v_order.replacement_piece_id;
  END IF;

  -- Determinar códigos de rastreio e Promob
  v_orig_code := COALESCE(v_orig_piece.promob_barcode, v_orig_piece.piece_code, v_orig_piece.traceability_code, '00000000');
  
  IF v_repl_piece.id IS NOT NULL THEN
    v_trace_code := COALESCE(v_repl_piece.traceability_code, v_repl_piece.piece_uid, v_orig_code || '-REP-R01');
  ELSE
    v_trace_code := v_orig_code || '-REP-R01';
  END IF;

  -- Obter modelo padrão
  SELECT id INTO v_template_id FROM public.label_templates WHERE is_default = true LIMIT 1;

  -- 5. Localizar ou criar registro em replacement_labels
  SELECT * INTO v_label FROM public.replacement_labels WHERE replacement_request_id = p_replacement_request_id;
  
  IF v_label.id IS NULL THEN
    INSERT INTO public.replacement_labels (
      replacement_request_id,
      replacement_piece_id,
      original_piece_id,
      promob_original_code,
      replacement_trace_code,
      template_id,
      print_status,
      current_copy_number,
      last_printed_at
    ) VALUES (
      p_replacement_request_id,
      v_order.replacement_piece_id,
      v_order.original_piece_id,
      v_orig_code,
      v_trace_code,
      v_template_id,
      'printed',
      1,
      now()
    ) RETURNING * INTO v_label;
    
    v_print_count := 1;
    v_is_reprint := false;
  ELSE
    v_print_count := COALESCE(v_label.current_copy_number, 0) + 1;
    v_is_reprint := (v_print_count > 1);

    IF v_is_reprint AND (p_reprint_reason IS NULL OR trim(p_reprint_reason) = '') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Toda reimpressão (2ª via em diante) exige motivo obrigatório.');
    END IF;

    UPDATE public.replacement_labels
    SET current_copy_number = v_print_count,
        print_status = 'printed',
        last_printed_at = now(),
        updated_at = now()
    WHERE id = v_label.id
    RETURNING * INTO v_label;
  END IF;

  -- 6. Registrar a impressão na tabela auditável replacement_label_prints
  INSERT INTO public.replacement_label_prints (
    label_id,
    replacement_request_id,
    replacement_piece_id,
    print_sequence,
    copy_number,
    is_reprint,
    reprint_reason,
    reprint_reason_details,
    printer_name,
    printed_by,
    printed_by_name,
    printed_at,
    client_event_id
  ) VALUES (
    v_label.id,
    p_replacement_request_id,
    v_order.replacement_piece_id,
    v_print_count,
    v_print_count,
    v_is_reprint,
    p_reprint_reason,
    p_reprint_reason_details,
    p_printer_name,
    v_user_id,
    p_user_name,
    now(),
    p_client_event_id
  ) RETURNING id INTO v_print_id;

  RETURN jsonb_build_object(
    'success', true,
    'print_id', v_print_id,
    'label_id', v_label.id,
    'copy_number', v_print_count,
    'is_reprint', v_is_reprint,
    'via_label', CASE WHEN v_print_count = 1 THEN '1ª VIA' ELSE v_print_count || 'ª VIA' END,
    'replacement_trace_code', v_trace_code
  );
END;
$$;

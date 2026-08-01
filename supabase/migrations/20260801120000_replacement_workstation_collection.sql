-- ============================================================
-- AC.Prod — MES Leo Madeiras
-- Migration 20260801120000: Baixa de Peças de Reposição por Célula, Posto e Código de Barras
-- (Com Entrada Automática e Liberação Sem Necessidade de Aprovação Administrativa)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── 1. Evolução de Postos Habilitados (production_machines) ───
ALTER TABLE public.production_machines
  ADD COLUMN IF NOT EXISTS allows_replacement boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allows_normal_production boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allows_rework boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS requires_piece_traceability boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allows_offline_collection boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS shifts text[] NOT NULL DEFAULT '{1,2,3}'::text[];

-- ─── 2. Tabela de Autorizações de Operadores por Posto ─────────
CREATE TABLE IF NOT EXISTS public.workstation_operator_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  machine_id uuid REFERENCES public.production_machines(id) ON DELETE CASCADE,
  cell_id uuid REFERENCES public.cells(id) ON DELETE CASCADE,
  shift text DEFAULT '1',
  authorization_type text NOT NULL DEFAULT 'permanent'
    CHECK (authorization_type IN ('permanent', 'temporary', 'substitute', 'leader', 'supervisor')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  authorized_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  blocked_reason text,
  training_validated boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workstation_operator_auth_op
  ON public.workstation_operator_authorizations(operator_id, is_active);

CREATE INDEX IF NOT EXISTS idx_workstation_operator_auth_machine
  ON public.workstation_operator_authorizations(machine_id, is_active);

-- Ativar RLS
ALTER TABLE public.workstation_operator_authorizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workstation_op_auth_select ON public.workstation_operator_authorizations;
CREATE POLICY workstation_op_auth_select ON public.workstation_operator_authorizations
  FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS workstation_op_auth_write ON public.workstation_operator_authorizations;
CREATE POLICY workstation_op_auth_write ON public.workstation_operator_authorizations
  FOR ALL TO authenticated
  USING (get_my_role() IN ('admin', 'manager', 'supervisor'))
  WITH CHECK (get_my_role() IN ('admin', 'manager', 'supervisor'));

DROP TRIGGER IF EXISTS trg_workstation_operator_auth_updated_at ON public.workstation_operator_authorizations;
CREATE TRIGGER trg_workstation_operator_auth_updated_at
  BEFORE UPDATE ON public.workstation_operator_authorizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── 3. Helper de Normalização de Nomes de Etapas MES ──────────
CREATE OR REPLACE FUNCTION public.canonical_stage_label(p_stage text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_str text := LOWER(TRIM(COALESCE(p_stage, '')));
BEGIN
  IF v_str IN ('cut', 'corte') THEN RETURN 'Corte'; END IF;
  IF v_str IN ('edge', 'borda', 'bordo') THEN RETURN 'Borda'; END IF;
  IF v_str IN ('drill', 'furacao', 'furação') THEN RETURN 'Furação'; END IF;
  IF v_str IN ('cnc', 'usinagem cnc', 'usinagem') THEN RETURN 'Usinagem CNC'; END IF;
  IF v_str IN ('joinery', 'marcenaria') THEN RETURN 'Marcenaria'; END IF;
  IF v_str IN ('separation', 'separacao', 'separação') THEN RETURN 'Separação'; END IF;
  IF v_str IN ('packaging', 'embalagem') THEN RETURN 'Embalagem'; END IF;
  IF v_str IN ('shipping', 'expedicao', 'expedição') THEN RETURN 'Expedição'; END IF;
  IF v_str IN ('created', 'criada') THEN RETURN 'Criada'; END IF;
  IF v_str IN ('completed', 'concluida', 'concluída') THEN RETURN 'Concluída'; END IF;
  RETURN INITCAP(v_str);
END;
$$;

-- ─── 4. RPC Transacional: Baixa Produtiva de Reposição por Célula ───
CREATE OR REPLACE FUNCTION public.collect_replacement_stage(
  p_barcode text,
  p_replacement_order_id uuid DEFAULT NULL,
  p_cell_id uuid DEFAULT NULL,
  p_workstation_id uuid DEFAULT NULL,
  p_machine_id uuid DEFAULT NULL,
  p_operator_id uuid DEFAULT NULL,
  p_shift text DEFAULT NULL,
  p_client_event_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public AS $$
DECLARE
  v_code text := TRIM(COALESCE(p_barcode, ''));
  v_order_id uuid := NULL;
  v_piece public.production_pieces%ROWTYPE;
  v_original_piece public.production_pieces%ROWTYPE;
  v_order public.replacement_orders%ROWTYPE;
  v_machine public.production_machines%ROWTYPE;
  v_operator public.operators%ROWTYPE;
  v_operator_name text := 'Operador MES';
  v_cell_name text := 'Célula de Reposição';
  v_machine_name text := 'Posto de Reposição';
  v_workstation_id uuid := COALESCE(p_workstation_id, p_machine_id);
  v_target_cell_id uuid := p_cell_id;
  v_route text[] := ARRAY['Corte', 'Borda', 'Separação', 'Embalagem'];
  v_completed text[] := ARRAY[]::text[];
  v_next_stage text;
  v_current_workstation_stage text;
  v_is_last_stage boolean := false;
  v_existing_reading_id uuid;
  v_audit_id uuid;
  v_auth_count integer;
  v_step text;
  v_idx integer;
BEGIN
  IF v_code = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'result_status', 'blocked',
      'reason_code', 'EMPTY_BARCODE',
      'message', 'Código de barras não informado.'
    );
  END IF;

  -- 1. Localizar ID da Ordem de Reposição sem FOR UPDATE (Evita erro de FOR UPDATE em outer joins)
  IF p_replacement_order_id IS NOT NULL THEN
    v_order_id := p_replacement_order_id;
  ELSE
    SELECT ro.id INTO v_order_id
    FROM public.replacement_orders ro
    LEFT JOIN public.production_pieces po ON po.id = ro.original_piece_id
    LEFT JOIN public.production_pieces pr ON pr.id = ro.replacement_piece_id
    WHERE po.piece_uid = v_code 
       OR po.traceability_code = v_code 
       OR po.piece_code = v_code
       OR pr.piece_uid = v_code 
       OR pr.traceability_code = v_code 
       OR pr.piece_code = v_code
       OR ro.replacement_code = v_code
       OR ro.original_piece_id::text = v_code
       OR ro.replacement_piece_id::text = v_code
    ORDER BY CASE WHEN ro.status IN ('released', 'in_production', 'approved', 'requested') THEN 1 ELSE 2 END, ro.created_at DESC
    LIMIT 1;
  END IF;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'result_status', 'blocked',
      'reason_code', 'ORDER_NOT_FOUND',
      'message', 'Código não corresponde a nenhuma ordem de reposição válida ou peça cadastrada.'
    );
  END IF;

  -- Travar estritamente a linha da ordem de reposição selecionada
  SELECT * INTO v_order
  FROM public.replacement_orders
  WHERE id = v_order_id FOR UPDATE;

  -- Trava de status da Ordem
  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', false,
      'result_status', 'blocked',
      'reason_code', 'ORDER_CANCELLED',
      'message', 'Ordem de reposição cancelada. Nenhuma leitura é permitida.'
    );
  END IF;

  IF v_order.status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'result_status', 'blocked',
      'reason_code', 'ORDER_ALREADY_COMPLETED',
      'message', 'Reposição já finalizada com sucesso. Nenhuma nova baixa é necessária.'
    );
  END IF;

  -- ENTRADA AUTOMÁTICA: Se a ordem estava aguardando aprovação/liberação administrativa,
  -- a coleta no chão de fábrica libera e inicia a produção AUTOMATICAMENTE!
  IF v_order.status IN ('requested', 'under_review', 'approved', 'released') THEN
    UPDATE public.replacement_orders
    SET status = 'in_production',
        released_at = COALESCE(released_at, now()),
        updated_at = now()
    WHERE id = v_order.id;
    v_order.status := 'in_production';
  END IF;

  -- 2. Carregar Peça Substituta e Peça Original
  IF v_order.replacement_piece_id IS NOT NULL THEN
    SELECT * INTO v_piece
    FROM public.production_pieces
    WHERE id = v_order.replacement_piece_id FOR UPDATE;
  END IF;

  IF v_order.original_piece_id IS NOT NULL THEN
    SELECT * INTO v_original_piece
    FROM public.production_pieces
    WHERE id = v_order.original_piece_id;
  END IF;

  IF v_piece.id IS NULL AND v_original_piece.id IS NOT NULL THEN
    v_piece := v_original_piece;
  END IF;

  -- 3. Validar Posto de Trabalho / Máquina
  IF v_workstation_id IS NOT NULL THEN
    SELECT * INTO v_machine
    FROM public.production_machines
    WHERE id = v_workstation_id LIMIT 1;

    IF v_machine.id IS NOT NULL THEN
      v_machine_name := v_machine.name;
      v_cell_name := COALESCE(v_machine.cell_name, v_cell_name);
      
      IF v_machine.active IS FALSE THEN
        RETURN jsonb_build_object(
          'success', false,
          'result_status', 'blocked',
          'reason_code', 'WORKSTATION_INACTIVE',
          'message', format('O posto de trabalho "%s" está inativo.', v_machine_name)
        );
      END IF;

      IF v_machine.allows_replacement IS FALSE THEN
        RETURN jsonb_build_object(
          'success', false,
          'result_status', 'blocked',
          'reason_code', 'WORKSTATION_NOT_ENABLED',
          'message', format('O posto "%s" não está habilitado para baixas de reposição.', v_machine_name)
        );
      END IF;
    END IF;
  ELSIF p_cell_id IS NOT NULL THEN
    SELECT name INTO v_cell_name FROM public.cells WHERE id = p_cell_id LIMIT 1;
  END IF;

  -- 4. Validar Operador e Autorizaciones
  IF p_operator_id IS NOT NULL THEN
    SELECT * INTO v_operator FROM public.operators WHERE id = p_operator_id LIMIT 1;
    IF v_operator.id IS NOT NULL THEN
      v_operator_name := v_operator.name;

      IF v_operator.active IS FALSE THEN
        RETURN jsonb_build_object(
          'success', false,
          'result_status', 'blocked',
          'reason_code', 'OPERATOR_INACTIVE',
          'message', 'Cadastro do operador está inativo.'
        );
      END IF;

      IF v_machine.id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_auth_count
        FROM public.workstation_operator_authorizations
        WHERE operator_id = v_operator.id 
          AND (machine_id = v_machine.id OR cell_id = v_machine.id)
          AND is_active = true
          AND (valid_until IS NULL OR valid_until > now());

        IF v_auth_count = 0 AND EXISTS (SELECT 1 FROM public.workstation_operator_authorizations WHERE machine_id = v_machine.id AND is_active = true) THEN
          RETURN jsonb_build_object(
            'success', false,
            'result_status', 'blocked',
            'reason_code', 'OPERATOR_UNAUTHORIZED',
            'message', format('O operador "%s" não possui autorização ativa para operar no posto "%s".', v_operator_name, v_machine_name)
          );
        END IF;
      END IF;
    END IF;
  END IF;

  -- 5. Calcular Rota e Próxima Etapa Esperada
  IF v_piece.route_steps IS NOT NULL AND array_length(v_piece.route_steps, 1) > 0 THEN
    v_route := v_piece.route_steps;
  ELSIF v_order.route_steps IS NOT NULL AND array_length(v_order.route_steps, 1) > 0 THEN
    v_route := v_order.route_steps;
  END IF;

  -- Normalizar lista de concluídas
  IF v_piece.completed_steps IS NOT NULL THEN
    FOR i IN 1..array_length(v_piece.completed_steps, 1) LOOP
      v_completed := array_append(v_completed, public.canonical_stage_label(v_piece.completed_steps[i]));
    END LOOP;
  END IF;

  v_current_workstation_stage := public.canonical_stage_label(v_cell_name);

  -- 6. ENTRADA DINÂMICA POR CÉLULA: Se a peça for bipejada em uma célula da rota, 
  -- ela dá entrada e baixa automaticamente nessa célula!
  IF v_current_workstation_stage = ANY(v_completed) THEN
    RETURN jsonb_build_object(
      'success', true,
      'result_status', 'already_completed',
      'reason_code', 'STAGE_ALREADY_COMPLETED',
      'replacement_order_id', v_order.id,
      'completed_stage', v_current_workstation_stage,
      'message', format('Esta peça já recebeu baixa na etapa de %s.', v_current_workstation_stage)
    );
  END IF;

  -- Dar baixa na célula coletada e atualizar concluídas (auto-concluindo etapas anteriores da rota se a reposição iniciou direto nesta célula)
  FOR i IN 1..array_length(v_route, 1) LOOP
    v_step := public.canonical_stage_label(v_route[i]);
    IF NOT (v_step = ANY(v_completed)) THEN
      v_completed := array_append(v_completed, v_step);
    END IF;
    IF LOWER(v_step) = LOWER(v_current_workstation_stage) THEN
      EXIT;
    END IF;
  END LOOP;

  -- Identificar a próxima etapa pendente da rota após a baixa atual
  v_next_stage := NULL;
  FOR i IN 1..array_length(v_route, 1) LOOP
    v_step := public.canonical_stage_label(v_route[i]);
    IF NOT (v_step = ANY(v_completed)) THEN
      v_next_stage := v_step;
      EXIT;
    END IF;
  END LOOP;

  IF v_next_stage IS NULL THEN
    v_is_last_stage := true;
  END IF;

  -- 7. Idempotência por client_event_id
  IF p_client_event_id IS NOT NULL THEN
    SELECT id INTO v_existing_reading_id
    FROM public.production_stage_readings
    WHERE client_event_id = p_client_event_id LIMIT 1;

    IF v_existing_reading_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'result_status', 'approved',
        'reason_code', 'IDEMPOTENT_EVENT',
        'replacement_order_id', v_order.id,
        'completed_stage', v_current_workstation_stage,
        'message', 'Evento já registrado anteriormente com sucesso.'
      );
    END IF;
  END IF;

  -- 8. Registrar Leitura Oficial em production_stage_readings
  INSERT INTO public.production_stage_readings (
    piece_id,
    item_id,
    tag_value,
    step_name,
    cell_name,
    station_name,
    machine_id,
    machine_name,
    operator,
    operator_name_snapshot,
    shift,
    status,
    event_type,
    client_event_id,
    notes,
    created_at
  ) VALUES (
    COALESCE(v_piece.id, v_original_piece.id),
    COALESCE(v_piece.id, v_original_piece.id),
    v_code,
    v_current_workstation_stage,
    v_cell_name,
    COALESCE(v_machine_name, v_cell_name),
    v_machine.id,
    v_machine_name,
    v_operator_name,
    v_operator_name,
    COALESCE(p_shift, '1'),
    'approved',
    'replacement_stage_reading',
    p_client_event_id,
    format('Baixa automática de reposição na célula %s (%s)', v_cell_name, COALESCE(v_order.replacement_code, 'REPOSIÇÃO')),
    now()
  );

  -- 9. Atualizar Peça Substituta, Peça Original e Ordem de Reposição
  IF v_piece.id IS NOT NULL THEN
    UPDATE public.production_pieces
    SET completed_steps = v_completed,
        current_stage = COALESCE(v_next_stage, 'Concluída'),
        status = CASE WHEN v_is_last_stage THEN 'completed' ELSE 'in_production' END,
        updated_at = now()
    WHERE id = v_piece.id;
  END IF;

  IF v_original_piece.id IS NOT NULL AND v_original_piece.id <> COALESCE(v_piece.id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    UPDATE public.production_pieces
    SET completed_steps = v_completed,
        current_stage = COALESCE(v_next_stage, 'Concluída'),
        updated_at = now()
    WHERE id = v_original_piece.id;
  END IF;


  UPDATE public.replacement_orders
  SET status = CASE WHEN v_is_last_stage THEN 'completed' ELSE 'in_production' END,
      current_stage = COALESCE(v_next_stage, 'Concluída'),
      completed_at = CASE WHEN v_is_last_stage THEN now() ELSE completed_at END,
      updated_at = now()
  WHERE id = v_order.id;

  -- 10. Tratar Conclusão Automática da Reposição
  IF v_is_last_stage THEN
    IF v_order.original_piece_id IS NOT NULL THEN
      UPDATE public.production_pieces
      SET status = 'replaced',
          updated_at = now()
      WHERE id = v_order.original_piece_id;
    END IF;

    UPDATE public.quality_nonconformities
    SET status = 'resolved',
        resolved_at = now(),
        updated_at = now()
    WHERE related_replacement_id = v_order.id OR piece_id = v_order.original_piece_id;
  END IF;

  -- 11. Auditoria do Sistema
  INSERT INTO public.audit_logs (
    action,
    entity,
    entity_id,
    details,
    created_at
  ) VALUES (
    CASE WHEN v_is_last_stage THEN 'replacement_stage_completed_final' ELSE 'replacement_stage_completed' END,
    'replacement_orders',
    v_order.id,
    jsonb_build_object(
      'replacement_code', v_order.replacement_code,
      'completed_stage', v_current_workstation_stage,
      'next_stage', v_next_stage,
      'operator', v_operator_name,
      'cell', v_cell_name,
      'machine', v_machine_name,
      'is_final', v_is_last_stage,
      'auto_released', true
    ),
    now()
  );

  -- 12. Resposta Estruturada
  IF v_is_last_stage THEN
    RETURN jsonb_build_object(
      'success', true,
      'result_status', 'approved',
      'replacement_order_id', v_order.id,
      'replacement_piece_id', v_piece.id,
      'completed_stage', v_current_workstation_stage,
      'next_stage', null,
      'order_status', 'completed',
      'replacement_completed', true,
      'message', format('%s concluída com sucesso! Reposição finalizada automaticamente.', v_current_workstation_stage)
    );
  ELSE
    RETURN jsonb_build_object(
      'success', true,
      'result_status', 'approved',
      'replacement_order_id', v_order.id,
      'replacement_piece_id', v_piece.id,
      'completed_stage', v_current_workstation_stage,
      'next_stage', v_next_stage,
      'order_status', 'in_production',
      'replacement_completed', false,
      'message', format('Entrada automática registrada em %s! Próxima etapa: %s.', v_current_workstation_stage, v_next_stage)
    );
  END IF;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'result_status', 'error',
    'reason_code', 'RPC_EXCEPTION',
    'message', format('Falha ao registrar baixa de reposição: %s', SQLERRM)
  );
END;
$$;

-- ─── 5. RPC Admin: Conclusão Forçada Auditada ─────────────────
CREATE OR REPLACE FUNCTION public.force_complete_piece_replacement(
  p_order_id uuid,
  p_reason text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public AS $$
DECLARE
  v_order public.replacement_orders%ROWTYPE;
  v_user_role text;
BEGIN
  v_user_role := public.get_my_role();
  IF v_user_role NOT IN ('admin', 'manager') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Apenas administradores e gestores podem realizar a conclusão forçada de reposições.'
    );
  END IF;

  IF TRIM(COALESCE(p_reason, '')) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'É obrigatório informar a justificativa para a conclusão forçada.'
    );
  END IF;

  SELECT * INTO v_order
  FROM public.replacement_orders
  WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Ordem de reposição não localizada.'
    );
  END IF;

  UPDATE public.replacement_orders
  SET status = 'completed',
      completed_at = now(),
      notes = COALESCE(notes, '') || format(' [Conclusão forçada por %s: %s]', auth.uid(), p_reason),
      updated_at = now()
  WHERE id = v_order.id;

  IF v_order.replacement_piece_id IS NOT NULL THEN
    UPDATE public.production_pieces
    SET status = 'completed',
        current_stage = 'Concluída',
        updated_at = now()
    WHERE id = v_order.replacement_piece_id;
  END IF;

  IF v_order.original_piece_id IS NOT NULL THEN
    UPDATE public.production_pieces
    SET status = 'replaced',
        updated_at = now()
    WHERE id = v_order.original_piece_id;
  END IF;

  INSERT INTO public.audit_logs (
    action,
    entity,
    entity_id,
    details,
    created_at
  ) VALUES (
    'replacement_force_completed',
    'replacement_orders',
    v_order.id,
    jsonb_build_object(
      'replacement_code', v_order.replacement_code,
      'reason', p_reason,
      'forced_by', auth.uid()
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Conclusão forçada registrada com sucesso e auditada.'
  );
END;
$$;

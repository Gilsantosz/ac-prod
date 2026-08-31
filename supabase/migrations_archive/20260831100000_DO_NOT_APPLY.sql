-- ============================================================
-- Migration: 20260831100000_concurrency_batch_lifecycle_operator_shifts.sql
-- 1. Colunas de horário de turno em operators (shift_start_time, shift_end_time)
-- 2. Advisory Lock por peça+etapa na RPC process_production_reading para evitar duplicidades em concorrência multi-dispositivo
-- 3. Verificação atômica de duplicação dentro da transação protegida por lock
-- 4. Atualização de status e recálculo de lote ao concluir última peça da etapa
-- ============================================================

-- 1. Adicionar colunas de turno no operador se não existirem
ALTER TABLE public.operators
  ADD COLUMN IF NOT EXISTS shift_start_time time DEFAULT '06:00:00',
  ADD COLUMN IF NOT EXISTS shift_end_time time DEFAULT '14:00:00';

-- 2. Atualizar admin_upsert_operator para salvar os horários de início e fim do turno
CREATE OR REPLACE FUNCTION public.admin_upsert_operator(
  p_operator_id uuid,
  p_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_operator public.operators%ROWTYPE;
  v_cell_ids uuid[];
  v_machine_ids uuid[];
  v_primary_cell_id uuid;
  v_primary_machine_id uuid;
  v_name text := btrim(COALESCE(p_data ->> 'name', ''));
  v_login text := lower(btrim(COALESCE(p_data ->> 'login_name', '')));
  v_registration text := NULLIF(btrim(COALESCE(p_data ->> 'registration', '')), '');
  v_shift text := NULLIF(btrim(COALESCE(p_data ->> 'shift', '')), '');
  v_shift_start_time time := COALESCE(NULLIF(p_data ->> 'shift_start_time', '')::time, '06:00:00'::time);
  v_shift_end_time time := COALESCE(NULLIF(p_data ->> 'shift_end_time', '')::time, '14:00:00'::time);
  v_active boolean := COALESCE((p_data ->> 'active')::boolean, true);
  v_primary_cell_name text;
  v_invalid_count integer;
BEGIN
  IF NOT public.can_manage_operators() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sem permissão para gerenciar operadores.');
  END IF;

  IF v_name = '' OR v_login = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nome e login são obrigatórios.');
  END IF;

  IF v_login !~ '^[a-z0-9.]+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'O login aceita apenas letras minúsculas, números e pontos.');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT value::uuid), ARRAY[]::uuid[])
  INTO v_cell_ids
  FROM jsonb_array_elements_text(COALESCE(p_data -> 'cell_ids', '[]'::jsonb));

  SELECT COALESCE(array_agg(DISTINCT value::uuid), ARRAY[]::uuid[])
  INTO v_machine_ids
  FROM jsonb_array_elements_text(COALESCE(p_data -> 'machine_ids', '[]'::jsonb));

  v_primary_cell_id := NULLIF(p_data ->> 'primary_cell_id', '')::uuid;
  v_primary_machine_id := NULLIF(p_data ->> 'primary_machine_id', '')::uuid;

  IF cardinality(v_cell_ids) = 0 OR v_primary_cell_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vincule ao menos uma célula e defina a célula principal.');
  END IF;

  IF NOT (v_primary_cell_id = ANY(v_cell_ids)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'A célula principal deve estar entre as células autorizadas.');
  END IF;

  SELECT count(*)
  INTO v_invalid_count
  FROM unnest(v_cell_ids) requested(cell_id)
  LEFT JOIN public.cells cell ON cell.id = requested.cell_id AND cell.active = true
  WHERE cell.id IS NULL;

  IF v_invalid_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Uma ou mais células são inválidas ou estão inativas.');
  END IF;

  SELECT count(*)
  INTO v_invalid_count
  FROM unnest(v_machine_ids) requested(machine_id)
  LEFT JOIN public.production_machines machine ON machine.id = requested.machine_id AND machine.active = true
  LEFT JOIN public.cells cell
    ON lower(btrim(cell.name)) = lower(btrim(machine.cell_name))
   AND cell.id = ANY(v_cell_ids)
  WHERE machine.id IS NULL OR cell.id IS NULL;

  IF v_invalid_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Uma máquina selecionada não pertence às células autorizadas.');
  END IF;

  IF v_primary_machine_id IS NOT NULL AND NOT (v_primary_machine_id = ANY(v_machine_ids)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'A máquina principal deve estar entre as máquinas autorizadas.');
  END IF;

  SELECT name INTO v_primary_cell_name
  FROM public.cells
  WHERE id = v_primary_cell_id;

  IF p_operator_id IS NULL THEN
    IF v_registration IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'A matrícula é obrigatória para um novo operador.');
    END IF;

    INSERT INTO public.operators (
      name,
      role,
      active,
      registration,
      login_name,
      primary_cell,
      cells,
      shift,
      shift_start_time,
      shift_end_time,
      login_enabled,
      primary_cell_id,
      primary_machine_id
    )
    VALUES (
      v_name,
      'operator',
      v_active,
      v_registration,
      v_login,
      v_primary_cell_name,
      ARRAY(SELECT name FROM public.cells WHERE id = ANY(v_cell_ids) ORDER BY name),
      v_shift,
      v_shift_start_time,
      v_shift_end_time,
      true,
      v_primary_cell_id,
      v_primary_machine_id
    )
    RETURNING * INTO v_operator;
  ELSE
    UPDATE public.operators
    SET name = v_name,
        login_name = v_login,
        registration = COALESCE(v_registration, registration),
        primary_cell = v_primary_cell_name,
        cells = ARRAY(SELECT name FROM public.cells WHERE id = ANY(v_cell_ids) ORDER BY name),
        shift = v_shift,
        shift_start_time = v_shift_start_time,
        shift_end_time = v_shift_end_time,
        active = v_active,
        login_enabled = v_active,
        primary_cell_id = v_primary_cell_id,
        primary_machine_id = v_primary_machine_id,
        deactivated_at = CASE WHEN v_active THEN NULL ELSE COALESCE(deactivated_at, now()) END,
        deactivated_by = CASE WHEN v_active THEN NULL ELSE auth.uid() END
    WHERE id = p_operator_id
    RETURNING * INTO v_operator;

    IF v_operator.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Operador não encontrado.');
    END IF;
  END IF;

  UPDATE public.operator_cell_assignments
  SET active = false,
      valid_until = now(),
      is_primary = false,
      updated_at = now()
  WHERE operator_id = v_operator.id
    AND active = true;

  INSERT INTO public.operator_cell_assignments (
    operator_id,
    cell_id,
    is_primary,
    active,
    valid_from,
    valid_until,
    assigned_by
  )
  SELECT
    v_operator.id,
    requested.cell_id,
    requested.cell_id = v_primary_cell_id,
    true,
    now(),
    NULL,
    auth.uid()
  FROM unnest(v_cell_ids) AS requested(cell_id);

  UPDATE public.operator_machine_assignments
  SET active = false,
      valid_until = now(),
      is_primary = false,
      updated_at = now()
  WHERE operator_id = v_operator.id
    AND active = true;

  INSERT INTO public.operator_machine_assignments (
    operator_id,
    machine_id,
    is_primary,
    active,
    valid_from,
    valid_until,
    assigned_by
  )
  SELECT
    v_operator.id,
    requested.machine_id,
    requested.machine_id = v_primary_machine_id,
    true,
    now(),
    NULL,
    auth.uid()
  FROM unnest(v_machine_ids) AS requested(machine_id);

  RETURN jsonb_build_object(
    'success', true,
    'operator', (
      to_jsonb(v_operator)
      - 'registration'
      - 'registration_normalized'
      - 'credential_hash'
    )
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Login ou matrícula já está em uso por outro operador.');
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Um dos vínculos informados possui formato inválido.');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_operator(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_operator(uuid, jsonb) TO authenticated;

-- 3. Atualizar operator_login_v2 para incluir shift_start_time e shift_end_time no retorno
CREATE OR REPLACE FUNCTION public.operator_login_v2(
  p_login_name text,
  p_registration text,
  p_device_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_login text := lower(btrim(coalesce(p_login_name, '')));
  v_registration text := btrim(coalesce(p_registration, ''));
  v_device_id text := btrim(coalesce(p_device_id, ''));
  v_operator public.operators%rowtype;
  v_failed_count integer;
  v_token text;
  v_token_hash text;
  v_session_id uuid;
  v_expires_at timestamptz := clock_timestamp() + interval '8 hours';
  v_cells jsonb;
  v_machines jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason_code', 'AUTH_REQUIRED', 'error', 'Autenticacao do sistema expirada. Entre novamente.');
  END IF;

  IF v_login = '' OR v_registration = '' OR v_device_id = '' THEN
    RETURN jsonb_build_object('success', false, 'reason_code', 'INVALID_CREDENTIALS', 'error', 'Login, matricula e dispositivo sao obrigatorios.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_auth_user_id AND p.active IS DISTINCT FROM false
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason_code', 'AUTH_USER_INACTIVE', 'error', 'Usuario do sistema inativo ou sem perfil operacional.');
  END IF;

  SELECT count(*) INTO v_failed_count
  FROM public.operator_access_attempts attempt
  WHERE attempt.login_name_input = v_login
    AND attempt.success = false
    AND attempt.created_at > clock_timestamp() - interval '10 minutes';

  IF v_failed_count >= 5 THEN
    INSERT INTO public.operator_access_attempts (login_name_input, success, failure_reason, device_id)
    VALUES (v_login, false, 'rate_limit_locked', v_device_id);
    RETURN jsonb_build_object('success', false, 'reason_code', 'LOGIN_RATE_LIMITED', 'error', 'Tentativas excedidas. Aguarde 10 minutos ou solicite o desbloqueio.');
  END IF;

  SELECT operator_row.* INTO v_operator
  FROM public.operators operator_row
  WHERE operator_row.active = true
    AND coalesce(operator_row.login_enabled, true) = true
    AND operator_row.deactivated_at IS NULL
    AND (
      lower(btrim(operator_row.login_name)) = v_login
      OR lower(btrim(operator_row.name)) = v_login
    )
  ORDER BY operator_row.created_at
  LIMIT 1;

  IF v_operator.id IS NULL
     OR v_operator.credential_hash IS NULL
     OR extensions.crypt(v_registration, v_operator.credential_hash) IS DISTINCT FROM v_operator.credential_hash THEN
    IF v_operator.id IS NOT NULL THEN
      UPDATE public.operators
      SET failed_login_count = failed_login_count + 1,
          locked_until = CASE WHEN failed_login_count + 1 >= 5 THEN clock_timestamp() + interval '10 minutes' END
      WHERE id = v_operator.id;
    END IF;
    INSERT INTO public.operator_access_attempts (login_name_input, success, failure_reason, device_id)
    VALUES (v_login, false, 'invalid_credentials', v_device_id);
    RETURN jsonb_build_object('success', false, 'reason_code', 'INVALID_CREDENTIALS', 'error', 'Operador nao encontrado ou credenciais invalidas.');
  END IF;

  IF v_operator.locked_until IS NOT NULL AND v_operator.locked_until > clock_timestamp() THEN
    INSERT INTO public.operator_access_attempts (login_name_input, success, failure_reason, device_id)
    VALUES (v_login, false, 'locked_until_active', v_device_id);
    RETURN jsonb_build_object('success', false, 'reason_code', 'OPERATOR_LOCKED', 'error', 'Conta bloqueada temporariamente.');
  END IF;

  SELECT jsonb_agg(
           jsonb_build_object('id', cell.id, 'name', cell.name, 'is_primary', assignment.is_primary)
           ORDER BY assignment.is_primary DESC, cell.name
         )
  INTO v_cells
  FROM public.operator_cell_assignments assignment
  JOIN public.cells cell ON cell.id = assignment.cell_id AND cell.active = true
  WHERE assignment.operator_id = v_operator.id
    AND assignment.active = true
    AND assignment.valid_from <= clock_timestamp()
    AND (assignment.valid_until IS NULL OR assignment.valid_until > clock_timestamp());

  IF v_cells IS NULL OR jsonb_array_length(v_cells) = 0 THEN
    RETURN jsonb_build_object('success', false, 'reason_code', 'OPERATOR_WITHOUT_CELL', 'error', 'Operador sem celula de trabalho autorizada.');
  END IF;

  SELECT jsonb_agg(
           jsonb_build_object(
             'id', machine.id,
             'name', machine.name,
             'cell_id', cell.id,
             'cell_name', cell.name,
             'is_primary', coalesce(machine_assignment.is_primary, false),
             'allows_replacement', machine.allows_replacement
           )
           ORDER BY coalesce(machine_assignment.is_primary, false) DESC, cell.name, machine.name
         )
  INTO v_machines
  FROM public.production_machines machine
  JOIN public.cells cell ON lower(btrim(cell.name)) = lower(btrim(machine.cell_name))
  JOIN public.operator_cell_assignments cell_assignment
    ON cell_assignment.operator_id = v_operator.id
   AND cell_assignment.cell_id = cell.id
   AND cell_assignment.active = true
   AND cell_assignment.valid_from <= clock_timestamp()
   AND (cell_assignment.valid_until IS NULL OR cell_assignment.valid_until > clock_timestamp())
  LEFT JOIN public.operator_machine_assignments machine_assignment
    ON machine_assignment.operator_id = v_operator.id
   AND machine_assignment.machine_id = machine.id
   AND machine_assignment.active = true
   AND machine_assignment.valid_from <= clock_timestamp()
   AND (machine_assignment.valid_until IS NULL OR machine_assignment.valid_until > clock_timestamp())
  WHERE machine.active = true
    AND (
      machine_assignment.id IS NOT NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.operator_machine_assignments explicit_assignment
        WHERE explicit_assignment.operator_id = v_operator.id
          AND explicit_assignment.active = true
          AND explicit_assignment.valid_from <= clock_timestamp()
          AND (explicit_assignment.valid_until IS NULL OR explicit_assignment.valid_until > clock_timestamp())
      )
    );

  UPDATE public.operator_sessions
  SET ended_at = clock_timestamp(), end_reason = 'operator_switch'
  WHERE auth_user_id = v_auth_user_id
    AND device_id = v_device_id
    AND ended_at IS NULL
    AND revoked_at IS NULL;

  UPDATE public.operators
  SET failed_login_count = 0, locked_until = NULL, last_login_at = clock_timestamp()
  WHERE id = v_operator.id;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  INSERT INTO public.operator_sessions (
    operator_id, auth_user_id, token_hash, device_id, expires_at,
    sync_grace_until, shift_snapshot
  ) VALUES (
    v_operator.id, v_auth_user_id, v_token_hash, v_device_id, v_expires_at,
    v_expires_at + interval '24 hours', v_operator.shift
  ) RETURNING id INTO v_session_id;

  INSERT INTO public.operator_access_attempts (login_name_input, success, device_id)
  VALUES (v_login, true, v_device_id);

  INSERT INTO public.system_audit_logs (
    user_id, user_name, action, entity, entity_id, device_id, session_id, success, metadata
  ) VALUES (
    v_auth_user_id, v_operator.name, 'operator_session_started', 'operator_sessions',
    v_session_id::text, v_device_id, v_session_id::text, true,
    jsonb_build_object('operator_id', v_operator.id, 'shift', v_operator.shift)
  );

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'session_token', v_token,
    'expires_at', v_expires_at,
    'operator', jsonb_build_object(
      'id', v_operator.id,
      'name', v_operator.name,
      'login_name', v_operator.login_name,
      'registration_masked', public.mask_registration(v_operator.registration),
      'shift', v_operator.shift,
      'shift_start_time', v_operator.shift_start_time,
      'shift_end_time', v_operator.shift_end_time,
      'primary_cell_id', v_operator.primary_cell_id,
      'primary_machine_id', v_operator.primary_machine_id,
      'cells', coalesce(v_cells, '[]'::jsonb),
      'machines', coalesce(v_machines, '[]'::jsonb)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.operator_login_v2(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_login_v2(text, text, text) TO authenticated;

-- 4. Redesenhar process_production_reading com lock transacional e defesa contra concorrência
CREATE OR REPLACE FUNCTION public.process_production_reading(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session_token text := NULLIF(TRIM(p_payload->>'operatorSessionToken'), '');
  v_client_event_id text := NULLIF(TRIM(p_payload->>'client_event_id'), '');
  v_tag_value text := UPPER(TRIM(COALESCE(p_payload->>'rawValue', p_payload->>'raw_value', p_payload->>'tagValue', '')));
  v_reader_type text := COALESCE(NULLIF(p_payload->>'readerType', ''), NULLIF(p_payload->>'reader_type', ''), 'keyboard_barcode');
  v_cell text := NULLIF(TRIM(COALESCE(p_payload->>'cellName', p_payload->>'cell_name', '')), '');
  v_station text := NULLIF(TRIM(COALESCE(p_payload->>'stationName', p_payload->>'station_name', '')), '');
  v_step_input text := NULLIF(TRIM(COALESCE(p_payload->>'stepName', p_payload->>'step_name', '')), '');
  v_operator text := NULLIF(TRIM(COALESCE(p_payload->>'operator', '')), '');
  v_shift text := NULLIF(TRIM(COALESCE(p_payload->>'shift', '')), '');
  v_date date := COALESCE(NULLIF(p_payload->>'date', '')::date, current_date);
  v_hour text := COALESCE(NULLIF(p_payload->>'hour', ''), to_char(now(), 'HH24:MI'));
  v_quantity integer := GREATEST(COALESCE(NULLIF(p_payload->>'quantity', '')::integer, 1), 1);
  v_created_at_client timestamptz := COALESCE(
    NULLIF(p_payload->>'createdAtClient', '')::timestamptz,
    NULLIF(p_payload->>'created_at_client', '')::timestamptz,
    now()
  );
  v_device_id text := NULLIF(TRIM(COALESCE(p_payload->>'deviceId', p_payload->>'device_id', '')), '');
  v_enqueue_duration_ms numeric := COALESCE(NULLIF(p_payload->>'enqueue_duration_ms', '')::numeric, 0);

  v_token_hash text;
  v_session public.operator_sessions%ROWTYPE;
  v_op public.operators%ROWTYPE;
  v_event public.production_collection_events%ROWTYPE;
  v_piece public.production_pieces%ROWTYPE;
  v_lot public.production_lots%ROWTYPE;
  v_order public.production_orders%ROWTYPE;
  v_reading public.production_stage_readings%ROWTYPE;
  v_existing_reading public.production_stage_readings%ROWTYPE;
  v_entry_id uuid;
  v_result jsonb;
  v_val_res jsonb;
  v_target_step_code text;
  v_from_stage text;
  v_new_completed_steps text[];
  v_next_step text;
  v_found_next boolean := false;
  v_total_pieces bigint := 0;
  v_completed_pieces bigint := 0;
  v_total_steps bigint := 0;
  v_completed_steps_count bigint := 0;
  v_lot_progress numeric(5,2) := 0;
  v_general_lot_progress_percent numeric(5,2) := 0;
  i integer;
BEGIN
  -- Validar permissão
  IF auth.uid() IS NULL OR public.get_my_role() NOT IN ('admin','manager','supervisor','operator') THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'forbidden',
      'message', 'Usuário sem permissão para coleta produtiva.'
    );
  END IF;

  -- 1. Validar e Derivar dados da Sessão do Operador no Servidor
  IF v_session_token IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'unauthenticated',
      'message', 'Sessão operacional necessária para realizar baixa.'
    );
  END IF;

  v_token_hash := encode(digest(v_session_token, 'sha256'), 'hex');
  
  SELECT * INTO v_session FROM public.operator_sessions
  WHERE token_hash = v_token_hash AND ended_at IS NULL AND revoked_at IS NULL AND expires_at > now();

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'session_expired',
      'message', 'Sessão de operador expirada, inválida ou revogada.'
    );
  END IF;

  SELECT * INTO v_op FROM public.operators WHERE id = v_session.operator_id;

  v_client_event_id := COALESCE(v_client_event_id, gen_random_uuid()::text);
  
  -- Sincronizar dados do payload com a sessão derivada do servidor
  v_cell := v_session.cell_name_snapshot;
  v_station := v_session.station_name_snapshot;
  v_operator := v_op.name;
  v_shift := COALESCE(v_session.shift_snapshot, v_op.shift, '1º Turno');

  -- 2. Claim atômico do evento de coleta
  INSERT INTO public.production_collection_events (
    client_event_id, raw_value, normalized_value, reader_type,
    operator_id, operator_name, registration, cell_name, shift, date, hour,
    status, created_at_client, payload, machine_id, machine_name, station_name,
    device_id, enqueue_duration_ms, sync_started_at, attempt_count, last_attempt_at,
    operator_session_id, cell_id, operator_registration_snapshot, machine_name_snapshot,
    station_name_snapshot, shift_snapshot
  ) VALUES (
    v_client_event_id, v_tag_value, v_tag_value, v_reader_type,
    v_op.id, v_op.name, v_op.registration, v_cell, v_shift, v_date, v_hour,
    'processing', v_created_at_client, p_payload, v_session.machine_id, v_session.machine_name_snapshot, v_session.station_name_snapshot,
    v_device_id, v_enqueue_duration_ms, now(), 1, now(),
    v_session.id, v_session.cell_id, public.mask_registration(v_op.registration), v_session.machine_name_snapshot,
    v_session.station_name_snapshot, v_session.shift_snapshot
  )
  ON CONFLICT (client_event_id) DO NOTHING
  RETURNING * INTO v_event;

  IF NOT FOUND THEN
    SELECT * INTO v_event
    FROM public.production_collection_events
    WHERE client_event_id = v_client_event_id;

    UPDATE public.production_collection_events
    SET attempt_count = attempt_count + 1,
        last_attempt_at = now()
    WHERE id = v_event.id;

    IF v_event.result_payload IS NOT NULL AND v_event.result_payload <> '{}'::jsonb
       AND v_event.status IN ('synced', 'ignored', 'error') THEN
      RETURN v_event.result_payload;
    END IF;

    IF v_event.status = 'synced' THEN
      SELECT * INTO v_reading FROM public.production_stage_readings WHERE id = v_event.reading_id;
      SELECT * INTO v_piece FROM public.production_pieces WHERE id = COALESCE(v_event.piece_id, v_reading.piece_id);
      SELECT * INTO v_lot FROM public.production_lots WHERE id = COALESCE(v_event.lot_id, v_reading.lot_id, v_piece.lot_id);
      SELECT * INTO v_order FROM public.production_orders WHERE id = v_lot.production_order_id;
      
      SELECT progress_percent INTO v_general_lot_progress_percent
      FROM public.promob_import_batches
      WHERE id = v_piece.pcp_import_batch_id;

      v_result := jsonb_build_object(
        'success', true,
        'status', 'approved',
        'alert_level', 'green',
        'message', 'Leitura já processada anteriormente.',
        'lot', to_jsonb(v_lot),
        'order', to_jsonb(v_order),
        'item', to_jsonb(v_piece),
        'reading', to_jsonb(v_reading),
        'lot_progress_percent', v_lot.progress_percent,
        'client_lot_progress', jsonb_build_object(
          'lot_id', v_lot.id,
          'lot_code', v_lot.lot_code,
          'progress_percent', v_lot.progress_percent
        ),
        'general_lot_progress', jsonb_build_object(
          'pcp_import_batch_id', v_piece.pcp_import_batch_id,
          'progress_percent', COALESCE(v_general_lot_progress_percent, 0.0)
        )
      );
      UPDATE public.production_collection_events SET result_payload = v_result WHERE id = v_event.id;
      RETURN v_result;
    END IF;

    IF v_event.status = 'ignored' THEN
      v_result := jsonb_build_object(
        'success', false,
        'status', COALESCE(v_event.result_status, 'ignored'),
        'message', COALESCE(v_event.error_message, 'Evento já processado anteriormente.')
      );
      UPDATE public.production_collection_events SET result_payload = v_result WHERE id = v_event.id;
      RETURN v_result;
    END IF;

    IF v_event.status = 'processing' THEN
      RAISE EXCEPTION 'Evento % ainda está em processamento; tente novamente.', v_client_event_id
        USING ERRCODE = '40001';
    END IF;

    UPDATE public.production_collection_events
    SET status = 'processing',
        payload = p_payload,
        sync_started_at = now(),
        sync_finished_at = NULL,
        error_message = NULL,
        updated_at = now()
    WHERE id = v_event.id
    RETURNING * INTO v_event;
  END IF;

  IF v_tag_value = '' THEN
    v_result := jsonb_build_object(
      'success', false,
      'status', 'invalid',
      'alert_level', 'red',
      'message', 'Informe uma identificação produtiva válida.'
    );
    RETURN public.finish_collection_event(v_event.id, 'ignored', 'invalid', v_result, NULL, NULL, v_result->>'message');
  END IF;

  BEGIN
    v_piece := public.resolve_piece_by_identifier(v_tag_value);
  EXCEPTION WHEN OTHERS THEN
    v_result := jsonb_build_object(
      'success', false,
      'status', 'not_found',
      'alert_level', 'red',
      'message', SQLERRM
    );
    RETURN public.finish_collection_event(v_event.id, 'ignored', 'not_found', v_result, NULL, NULL, SQLERRM);
  END;

  -- 3. Resolver etapa da célula ANTES de qualquer lock/validação
  IF v_step_input IS NOT NULL THEN
    v_target_step_code := v_step_input;
  ELSE
    SELECT code INTO v_target_step_code
    FROM public.routing_steps
    WHERE lower(code) = lower(v_cell)
       OR lower(name) = lower(v_cell)
       OR (v_cell IN ('Borda', 'Bordo') AND code = 'edge')
       OR (v_cell = 'Usinagem' AND code = 'cnc')
       OR (v_cell = 'Furação' AND code = 'drill')
       OR (v_cell = 'Corte' AND code = 'cut')
       OR (v_cell = 'Marcenaria' AND code = 'joinery')
    ORDER BY sequence NULLS LAST
    LIMIT 1;
  END IF;
  v_target_step_code := COALESCE(v_target_step_code, v_piece.current_stage);

  -- 4. ADVISORY LOCK TRANSACIONAL (Crucial para concorrência multi-dispositivo)
  -- Garante que duas requisições simultâneas para a mesma peça + etapa sejam rigorosamente serializadas
  PERFORM pg_advisory_xact_lock(hashtext(v_piece.id::text || ':' || v_target_step_code));

  -- Recarregar a peça com row lock FOR UPDATE após obter o advisory lock
  SELECT * INTO v_piece FROM public.production_pieces WHERE id = v_piece.id FOR UPDATE;
  SELECT * INTO v_lot FROM public.production_lots WHERE id = v_piece.lot_id;
  SELECT * INTO v_order FROM public.production_orders WHERE id = COALESCE(v_piece.production_order_id, v_lot.production_order_id, v_lot.order_id);

  -- Atualizar auditoria de eventos
  UPDATE public.production_collection_events SET
    piece_id = v_piece.id,
    pcp_import_batch_id = v_piece.pcp_import_batch_id,
    lot_id = v_piece.lot_id,
    production_order_id = v_piece.production_order_id,
    lot_code = v_lot.lot_code,
    load_number = v_order.load_number,
    order_number = COALESCE(v_order.order_number, v_order.order_code),
    customer_name = v_order.customer_name,
    environment_name = v_piece.environment,
    piece_code = v_piece.traceability_code,
    operation_name = v_target_step_code,
    updated_at = now()
  WHERE id = v_event.id;

  -- 5. Defesa Atômica contra Duplicata imediata (Concorrência entre computadores diferentes)
  SELECT * INTO v_existing_reading FROM public.production_stage_readings
  WHERE piece_id = v_piece.id 
    AND step_name = v_target_step_code 
    AND status = 'approved'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_reading.id IS NOT NULL OR (v_target_step_code = ANY(COALESCE(v_piece.completed_steps, '{}'::text[]))) THEN
    INSERT INTO public.production_stage_readings (
      client_event_id, tag_value, tag_type, reader_type, station_name, cell_name,
      operator, shift, date, hour, item_id, piece_id, lot_id, production_order_id,
      step_name, quantity, status, event_type, operator_id, machine_id, machine_name,
      lot_code, load_number, order_number, customer_name, environment_name,
      operation_name, piece_code, created_at
    ) VALUES (
      v_client_event_id, v_piece.piece_uid,
      CASE WHEN v_reader_type = 'manual' THEN 'manual' ELSE 'barcode' END,
      v_reader_type, v_station, v_cell,
      v_operator, v_shift, v_date, v_hour, v_piece.legacy_production_lot_item_id, v_piece.id,
      v_piece.lot_id, v_piece.production_order_id, v_target_step_code, v_quantity,
      'duplicated', 'duplicated_scan', v_op.id, v_session.machine_id, v_session.machine_name_snapshot,
      v_lot.lot_code, v_order.load_number, COALESCE(v_order.order_number, v_order.order_code),
      v_order.customer_name, v_piece.environment, v_target_step_code, v_piece.traceability_code, v_created_at_client
    ) RETURNING * INTO v_reading;

    INSERT INTO public.production_events (
      piece_id, traceability_code, production_order_id, lot_id, event_type,
      from_stage, to_stage, cell_name, machine_id, device_id, operator_id,
      event_status, reading_source, barcode_raw_value, notes, legacy_stage_reading_id
    ) VALUES (
      v_piece.id, v_piece.traceability_code, v_piece.production_order_id, v_piece.lot_id, 'block',
      v_piece.current_stage, v_target_step_code, v_cell, v_session.machine_id::text, v_device_id, v_op.id,
      'duplicated', v_reader_type, v_tag_value, 'Tentativa de leitura duplicada bloqueada pelo sistema.', v_reading.id
    );

    v_result := jsonb_build_object(
      'success', false,
      'status', 'duplicated',
      'alert_level', 'yellow',
      'message', 'ENTRADA BLOQUEADA: Esta numeração já foi coletada e aprovada nesta célula em outro terminal.',
      'lot', to_jsonb(v_lot),
      'order', to_jsonb(v_order),
      'item', to_jsonb(v_piece),
      'reading', to_jsonb(v_reading)
    );
    RETURN public.finish_collection_event(v_event.id, 'ignored', 'duplicated', v_result, v_reading.id, NULL, v_result->>'message');
  END IF;

  -- 6. Validar sequenciamento de fluxo da peça
  v_val_res := public.validar_fluxo_da_peca(v_piece.id, v_target_step_code);

  IF NOT COALESCE((v_val_res->>'success')::boolean, false) OR v_val_res->>'status' = 'duplicated' THEN
    IF v_piece.lot_id IS NOT NULL THEN
      INSERT INTO public.production_stage_readings (
        client_event_id, tag_value, tag_type, reader_type, station_name, cell_name,
        operator, shift, date, hour, item_id, piece_id, lot_id, production_order_id,
        step_name, quantity, status, event_type, operator_id, machine_id, machine_name,
        lot_code, load_number, order_number, customer_name, environment_name,
        operation_name, piece_code, created_at
      ) VALUES (
        v_client_event_id, v_piece.piece_uid,
        CASE WHEN v_reader_type = 'manual' THEN 'manual' ELSE 'barcode' END,
        v_reader_type, v_station, v_cell,
        v_operator, v_shift, v_date, v_hour, v_piece.legacy_production_lot_item_id, v_piece.id,
        v_piece.lot_id, v_piece.production_order_id, v_target_step_code, v_quantity,
        CASE WHEN v_val_res->>'status' = 'duplicated' THEN 'duplicated' ELSE 'blocked' END,
        CASE WHEN v_val_res->>'status' = 'duplicated' THEN 'duplicated_scan' ELSE 'wrong_step' END,
        v_op.id, v_session.machine_id, v_session.machine_name_snapshot, v_lot.lot_code, v_order.load_number,
        COALESCE(v_order.order_number, v_order.order_code), v_order.customer_name,
        v_piece.environment, v_target_step_code, v_piece.traceability_code, v_created_at_client
      ) RETURNING * INTO v_reading;
    END IF;

    INSERT INTO public.production_events (
      piece_id, traceability_code, production_order_id, lot_id, event_type,
      from_stage, to_stage, cell_name, machine_id, device_id, operator_id,
      event_status, reading_source, barcode_raw_value, notes, legacy_stage_reading_id
    ) VALUES (
      v_piece.id, v_piece.traceability_code, v_piece.production_order_id, v_piece.lot_id, 'block',
      v_piece.current_stage, v_target_step_code, v_cell, v_session.machine_id::text, v_device_id, v_op.id,
      CASE WHEN v_val_res->>'status' = 'duplicated' THEN 'duplicated' ELSE 'blocked' END,
      v_reader_type, v_tag_value, v_val_res->>'message', v_reading.id
    );

    v_result := jsonb_build_object(
      'success', false,
      'status', COALESCE(v_val_res->>'status', 'blocked'),
      'alert_level', COALESCE(v_val_res->>'alert_level', 'red'),
      'message', COALESCE(v_val_res->>'message', 'Entrada bloqueada.'),
      'lot', to_jsonb(v_lot),
      'order', to_jsonb(v_order),
      'item', to_jsonb(v_piece),
      'reading', CASE WHEN v_reading.id IS NULL THEN NULL ELSE to_jsonb(v_reading) END
    );
    RETURN public.finish_collection_event(v_event.id, 'ignored', v_val_res->>'status', v_result, v_reading.id, NULL, v_result->>'message');
  END IF;

  v_from_stage := v_piece.current_stage;

  -- 7. Registrar Leitura Aprovada
  INSERT INTO public.production_stage_readings (
    client_event_id, tag_value, tag_type, reader_type, station_name, cell_name,
    operator, shift, date, hour, item_id, piece_id, lot_id, production_order_id,
    step_name, quantity, status, event_type, operator_id, machine_id, machine_name,
    lot_code, load_number, order_number, customer_name, environment_name,
    operation_name, piece_code, production_cycle, created_at
  ) VALUES (
    v_client_event_id, v_piece.piece_uid,
    CASE WHEN v_reader_type = 'manual' THEN 'manual' ELSE 'barcode' END,
    v_reader_type, v_station, v_cell,
    v_operator, v_shift, v_date, v_hour, v_piece.legacy_production_lot_item_id, v_piece.id,
    v_piece.lot_id, v_piece.production_order_id, v_target_step_code, v_quantity,
    'approved', 'approved_scan', v_op.id, v_session.machine_id, v_session.machine_name_snapshot,
    v_lot.lot_code, v_order.load_number, COALESCE(v_order.order_number, v_order.order_code),
    v_order.customer_name, v_piece.environment, v_target_step_code,
    v_piece.traceability_code, 1, v_created_at_client
  ) RETURNING * INTO v_reading;

  -- Atualizar etapas completadas
  v_new_completed_steps := COALESCE(v_piece.completed_steps, '{}'::text[]);
  IF NOT (v_target_step_code = ANY(v_new_completed_steps)) THEN
    v_new_completed_steps := array_append(v_new_completed_steps, v_target_step_code);
  END IF;

  -- Calcular próxima etapa
  v_next_step := NULL;
  v_found_next := false;
  IF v_piece.route_steps IS NOT NULL AND array_length(v_piece.route_steps, 1) IS NOT NULL THEN
    FOR i IN 1..array_length(v_piece.route_steps, 1) LOOP
      IF v_found_next THEN
        v_next_step := v_piece.route_steps[i];
        EXIT;
      END IF;
      IF lower(v_piece.route_steps[i]) = lower(v_target_step_code) THEN
        v_found_next := true;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.production_pieces
  SET completed_steps = v_new_completed_steps,
      current_stage = COALESCE(v_next_step, 'Concluída'),
      status = CASE WHEN v_next_step IS NULL THEN 'completed' ELSE 'in_progress' END,
      updated_at = now()
  WHERE id = v_piece.id
  RETURNING * INTO v_piece;

  -- Legado do item
  UPDATE public.production_lot_items
  SET current_step = COALESCE(
        (SELECT name FROM public.routing_steps WHERE code = v_piece.current_stage),
        v_piece.current_stage
      ),
      status = CASE WHEN v_piece.status = 'completed' THEN 'completed' ELSE 'in_progress' END,
      updated_at = now()
  WHERE id = v_piece.legacy_production_lot_item_id;

  -- 8. Recalcular Progresso do Lote do cliente
  SELECT count(*),
         count(*) FILTER (WHERE status IN ('completed','packed','inspected','ready_for_shipping','shipped'))
  INTO v_total_pieces, v_completed_pieces
  FROM public.production_pieces
  WHERE lot_id = v_lot.id AND status NOT IN ('cancelled','replaced');

  SELECT COALESCE(sum(s.required_steps), 0), COALESCE(sum(s.done_steps), 0)
  INTO v_total_steps, v_completed_steps_count
  FROM (
    SELECT cardinality(COALESCE(p.route_steps, '{}'::text[])) AS required_steps,
           cardinality(ARRAY(
             SELECT DISTINCT step
             FROM unnest(COALESCE(p.route_steps, '{}'::text[])) AS step
             WHERE step = ANY(COALESCE(p.completed_steps, '{}'::text[]))
           )) AS done_steps
    FROM public.production_pieces p
    WHERE p.lot_id = v_lot.id AND p.status NOT IN ('cancelled','replaced')
  ) s;

  v_lot_progress := CASE
    WHEN v_total_steps > 0 THEN ROUND((v_completed_steps_count::numeric / v_total_steps::numeric) * 100, 2)
    WHEN v_total_pieces > 0 THEN ROUND((v_completed_pieces::numeric / v_total_pieces::numeric) * 100, 2)
    ELSE 0
  END;

  UPDATE public.production_lots
  SET progress_percent = LEAST(GREATEST(v_lot_progress, 0), 100),
      produced_quantity = v_completed_pieces,
      approved_quantity = v_completed_pieces,
      pending_quantity = GREATEST(v_total_pieces - v_completed_pieces, 0),
      current_stage = v_target_step_code,
      current_step = v_target_step_code,
      current_cell = v_cell,
      current_status = CASE
        WHEN v_total_pieces > 0 AND v_completed_pieces = v_total_pieces THEN 'completed'
        ELSE 'in_progress'
      END,
      status = CASE
        WHEN v_total_pieces > 0 AND v_completed_pieces = v_total_pieces THEN 'waiting_packaging'
        ELSE 'in_progress'
      END,
      actual_start = COALESCE(actual_start, now()),
      updated_at = now()
  WHERE id = v_lot.id
  RETURNING * INTO v_lot;

  UPDATE public.production_orders
  SET status = CASE WHEN status IN ('completed','cancelled') THEN status ELSE 'in_production' END,
      updated_at = now()
  WHERE id = v_order.id;

  -- Recalcular Lote Geral
  PERFORM public.refresh_pcp_batch_progress(v_piece.pcp_import_batch_id);

  -- Log do evento produtivo
  INSERT INTO public.production_events (
    piece_id, traceability_code, production_order_id, lot_id, event_type,
    from_stage, to_stage, cell_name, machine_id, device_id, operator_id,
    event_status, reading_source, barcode_raw_value, legacy_stage_reading_id
  ) VALUES (
    v_piece.id, v_piece.traceability_code, v_piece.production_order_id, v_piece.lot_id,
    'stage_advance', v_from_stage, v_target_step_code, v_cell, v_session.machine_id::text,
    v_device_id, v_op.id, 'accepted', v_reader_type, v_tag_value, v_reading.id
  );

  -- Entrada MES para gráficos gerais
  INSERT INTO public.production_entries (
    date, shift, cell, hour, produced, target, scrap, downtime, operator, notes,
    created_by, client_event_id, operator_id, order_id, production_order_id,
    lot_id, lot_code, load_number, order_number, customer_name, environment_name,
    operation_name, machine_id, machine_name, pcp_import_batch_id
  ) VALUES (
    v_date, COALESCE(v_shift, 'Não informado'), COALESCE(v_cell, 'Não informada'),
    v_hour, v_quantity, 0, 0, 0, v_operator,
    'Coleta MES validada - Peça: ' || v_piece.traceability_code,
    auth.uid(), v_client_event_id, v_op.id, v_order.id, v_order.id,
    v_lot.id, v_lot.lot_code, v_order.load_number,
    COALESCE(v_order.order_number, v_order.order_code), v_order.customer_name,
    v_piece.environment, v_target_step_code, v_session.machine_id, v_session.machine_name_snapshot,
    v_piece.pcp_import_batch_id
  ) RETURNING id INTO v_entry_id;

  SELECT progress_percent INTO v_general_lot_progress_percent
  FROM public.promob_import_batches
  WHERE id = v_piece.pcp_import_batch_id;

  v_result := jsonb_build_object(
    'success', true,
    'status', 'approved',
    'alert_level', 'green',
    'message', 'Baixa de etapa registrada com sucesso!',
    'lot', to_jsonb(v_lot),
    'order', to_jsonb(v_order),
    'item', to_jsonb(v_piece),
    'reading', to_jsonb(v_reading),
    'lot_progress_percent', v_lot.progress_percent,
    'client_lot_progress', jsonb_build_object(
      'lot_id', v_lot.id,
      'lot_code', v_lot.lot_code,
      'total_parts', v_total_pieces,
      'completed_parts', v_completed_pieces,
      'pending_parts', GREATEST(v_total_pieces - v_completed_pieces, 0),
      'total_operations', v_total_steps,
      'completed_operations', v_completed_steps_count,
      'progress_percent', v_lot.progress_percent
    ),
    'general_lot_progress', jsonb_build_object(
      'pcp_import_batch_id', v_piece.pcp_import_batch_id,
      'general_lot_code', (SELECT general_lot_code FROM public.promob_import_batches WHERE id = v_piece.pcp_import_batch_id),
      'total_parts', (SELECT total_parts FROM public.promob_import_batches WHERE id = v_piece.pcp_import_batch_id),
      'completed_parts', (SELECT completed_parts FROM public.promob_import_batches WHERE id = v_piece.pcp_import_batch_id),
      'pending_parts', (SELECT pending_parts FROM public.promob_import_batches WHERE id = v_piece.pcp_import_batch_id),
      'total_operations', (SELECT total_operations FROM public.promob_import_batches WHERE id = v_piece.pcp_import_batch_id),
      'completed_operations', (SELECT completed_operations FROM public.promob_import_batches WHERE id = v_piece.pcp_import_batch_id),
      'progress_percent', COALESCE(v_general_lot_progress_percent, 0.0)
    )
  );

  RETURN public.finish_collection_event(v_event.id, 'synced', 'approved', v_result, v_reading.id, NULL, NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_production_reading(jsonb) TO authenticated, anon;

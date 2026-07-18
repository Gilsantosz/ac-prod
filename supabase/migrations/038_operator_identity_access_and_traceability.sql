-- ============================================================
-- AC.Prod — MES Leo Madeiras
-- Migration 038: Gestão de Operadores, Acesso Operacional e Rastreabilidade por Estação
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── 1. Evolução da Tabela operators ──────────────────────────
ALTER TABLE public.operators
  ADD COLUMN IF NOT EXISTS profile_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS registration_normalized text,
  ADD COLUMN IF NOT EXISTS credential_hash text,
  ADD COLUMN IF NOT EXISTS primary_cell_id uuid REFERENCES public.cells(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS primary_machine_id uuid REFERENCES public.production_machines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Normalização de dados históricos
UPDATE public.operators 
SET registration_normalized = TRIM(registration)
WHERE registration IS NOT NULL AND registration_normalized IS NULL;

UPDATE public.operators
SET credential_hash = crypt(TRIM(registration), gen_salt('bf', 10))
WHERE registration IS NOT NULL AND credential_hash IS NULL;

-- Índices e Unicidade
CREATE UNIQUE INDEX IF NOT EXISTS uq_operators_registration_norm 
  ON public.operators(registration_normalized) 
  WHERE registration_normalized IS NOT NULL;

DROP INDEX IF EXISTS idx_operators_login_name;
CREATE UNIQUE INDEX IF NOT EXISTS uq_operators_login_name_lower 
  ON public.operators(LOWER(login_name));

-- Trigger para normalização de matrículas e geração de hash de credenciais automático
CREATE OR REPLACE FUNCTION public.trg_operators_credential_hash()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.registration IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.registration <> OLD.registration OR NEW.credential_hash IS NULL) THEN
    NEW.registration_normalized := TRIM(NEW.registration);
    NEW.credential_hash := crypt(NEW.registration_normalized, gen_salt('bf', 10));
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_operators_before_insert_update
  BEFORE INSERT OR UPDATE ON public.operators
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_operators_credential_hash();

-- ─── 2. Células e Máquinas Vinculadas ─────────────────────────
CREATE TABLE IF NOT EXISTS public.operator_cell_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  cell_id uuid NOT NULL REFERENCES public.cells(id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_operator_active_cell 
  ON public.operator_cell_assignments(operator_id, cell_id) 
  WHERE active = true;

CREATE TABLE IF NOT EXISTS public.operator_machine_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  machine_id uuid NOT NULL REFERENCES public.production_machines(id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_operator_active_machine 
  ON public.operator_machine_assignments(operator_id, machine_id) 
  WHERE active = true;

-- ─── 3. Sessões Operacionais e Tentativas de Acesso ───────────
CREATE TABLE IF NOT EXISTS public.operator_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  cell_id uuid REFERENCES public.cells(id) ON DELETE SET NULL,
  machine_id uuid REFERENCES public.production_machines(id) ON DELETE SET NULL,
  cell_name_snapshot text,
  machine_name_snapshot text,
  station_name_snapshot text,
  shift_snapshot text,
  device_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  sync_grace_until timestamptz,
  ended_at timestamptz,
  end_reason text,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_operator_sessions_token_hash ON public.operator_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_operator_sessions_active ON public.operator_sessions(operator_id) WHERE ended_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.operator_access_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  login_name_input text,
  success boolean NOT NULL,
  failure_reason text,
  device_id text,
  ip_address text
);

CREATE INDEX IF NOT EXISTS idx_operator_access_attempts_rate_limit 
  ON public.operator_access_attempts(login_name_input, created_at) 
  WHERE success = false;

-- ─── 4. Backfill de Vínculos ──────────────────────────────────
DO $$
DECLARE
  v_op RECORD;
  v_cell_id uuid;
BEGIN
  -- Mapear células antigas do texto para UUIDs e criar assignments
  FOR v_op IN SELECT id, primary_cell, cells FROM public.operators LOOP
    -- Célula Principal
    IF v_op.primary_cell IS NOT NULL AND v_op.primary_cell <> '' THEN
      SELECT id INTO v_cell_id FROM public.cells WHERE LOWER(TRIM(name)) = LOWER(TRIM(v_op.primary_cell)) LIMIT 1;
      IF v_cell_id IS NOT NULL THEN
        UPDATE public.operators SET primary_cell_id = v_cell_id WHERE id = v_op.id;
        
        INSERT INTO public.operator_cell_assignments (operator_id, cell_id, is_primary, active)
        VALUES (v_op.id, v_cell_id, true, true)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;

    -- Células secundárias
    IF v_op.cells IS NOT NULL AND array_length(v_op.cells, 1) > 0 THEN
      FOR i IN 1..array_length(v_op.cells, 1) LOOP
        SELECT id INTO v_cell_id FROM public.cells WHERE LOWER(TRIM(name)) = LOWER(TRIM(v_op.cells[i])) LIMIT 1;
        IF v_cell_id IS NOT NULL THEN
          INSERT INTO public.operator_cell_assignments (operator_id, cell_id, is_primary, active)
          VALUES (v_op.id, v_cell_id, (v_op.primary_cell = v_op.cells[i]), true)
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- ─── 5. Evolução dos Eventos e Rastreabilidade ────────────────
ALTER TABLE public.production_collection_events
  ADD COLUMN IF NOT EXISTS operator_session_id uuid REFERENCES public.operator_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cell_id uuid REFERENCES public.cells(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS operator_registration_snapshot text,
  ADD COLUMN IF NOT EXISTS machine_name_snapshot text,
  ADD COLUMN IF NOT EXISTS station_name_snapshot text,
  ADD COLUMN IF NOT EXISTS shift_snapshot text,
  ADD COLUMN IF NOT EXISTS server_received_at timestamptz DEFAULT now();

-- ─── 6. Funções e RPCs de Segurança ──────────────────────────

-- Helper para mascarar matrícula
CREATE OR REPLACE FUNCTION public.mask_registration(p_reg text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_reg IS NULL THEN RETURN NULL; END IF;
  IF length(p_reg) <= 2 THEN RETURN '**'; END IF;
  RETURN repeat('*', length(p_reg) - 2) || right(p_reg, 2);
END;
$$;

-- RPC de Login Operacional V2
CREATE OR REPLACE FUNCTION public.operator_login_v2(
  p_login_name text,
  p_registration text,
  p_device_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public AS $$
DECLARE
  v_login text := LOWER(TRIM(COALESCE(p_login_name, '')));
  v_reg text := TRIM(COALESCE(p_registration, ''));
  v_op public.operators%ROWTYPE;
  v_failed_count integer;
  v_token text;
  v_token_hash text;
  v_session_id uuid;
  v_expires_at timestamptz := now() + interval '8 hours';
  v_cells_json jsonb;
  v_machines_json jsonb;
BEGIN
  -- Rate limiting: Verifica tentativas consecutivas nas últimas 10 minutos
  SELECT COUNT(*) INTO v_failed_count
  FROM public.operator_access_attempts
  WHERE login_name_input = v_login
    AND success = false
    AND created_at > now() - interval '10 minutes';

  IF v_failed_count >= 5 THEN
    INSERT INTO public.operator_access_attempts (login_name_input, success, failure_reason, device_id)
    VALUES (v_login, false, 'rate_limit_locked', p_device_id);
    
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Tentativas de login excedidas. Temporariamente bloqueado por 10 minutos.'
    );
  END IF;

  -- Localiza operador ativo
  SELECT * INTO v_op FROM public.operators
  WHERE active = true 
    AND (LOWER(TRIM(login_name)) = v_login OR LOWER(TRIM(name)) = v_login)
    AND deactivated_at IS NULL
  LIMIT 1;

  IF v_op.id IS NULL THEN
    INSERT INTO public.operator_access_attempts (login_name_input, success, failure_reason, device_id)
    VALUES (v_login, false, 'operator_not_found_or_inactive', p_device_id);
    
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Operador não encontrado ou credenciais inválidas.'
    );
  END IF;

  -- Verifica se está bloqueado temporariamente
  IF v_op.locked_until IS NOT NULL AND v_op.locked_until > now() THEN
    INSERT INTO public.operator_access_attempts (login_name_input, success, failure_reason, device_id)
    VALUES (v_login, false, 'locked_until_active', p_device_id);

    RETURN jsonb_build_object(
      'success', false,
      'error', 'Conta bloqueada temporariamente. Tente novamente mais tarde.'
    );
  END IF;

  -- Compara matrícula (senha operacional)
  IF crypt(v_reg, v_op.credential_hash) <> v_op.credential_hash THEN
    -- Incrementa tentativas falhas
    UPDATE public.operators 
    SET failed_login_count = failed_login_count + 1,
        locked_until = CASE WHEN failed_login_count + 1 >= 5 THEN now() + interval '10 minutes' ELSE NULL END
    WHERE id = v_op.id;

    INSERT INTO public.operator_access_attempts (login_name_input, success, failure_reason, device_id)
    VALUES (v_login, false, 'invalid_credentials', p_device_id);

    RETURN jsonb_build_object(
      'success', false,
      'error', 'Operador não encontrado ou credenciais inválidas.'
    );
  END IF;

  -- Sucesso: Reseta tentativas
  UPDATE public.operators 
  SET failed_login_count = 0,
      locked_until = NULL,
      last_login_at = now()
  WHERE id = v_op.id;

  -- Gera Token Opaco e Hash SHA256
  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

  -- Salva Sessão
  INSERT INTO public.operator_sessions (
    operator_id, token_hash, device_id, expires_at, shift_snapshot
  ) VALUES (
    v_op.id, v_token_hash, p_device_id, v_expires_at, v_op.shift
  ) RETURNING id INTO v_session_id;

  INSERT INTO public.operator_access_attempts (login_name_input, success, device_id)
  VALUES (v_login, true, p_device_id);

  -- Lista de células autorizadas
  SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'is_primary', ca.is_primary))
  INTO v_cells_json
  FROM public.operator_cell_assignments ca
  JOIN public.cells c ON c.id = ca.cell_id
  WHERE ca.operator_id = v_op.id AND ca.active = true;

  -- Lista de máquinas autorizadas
  SELECT jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'cell_id', m.cell_id, 'is_primary', ma.is_primary))
  INTO v_machines_json
  FROM public.operator_machine_assignments ma
  JOIN public.production_machines m ON m.id = ma.machine_id
  WHERE ma.operator_id = v_op.id AND ma.active = true;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'session_token', v_token,
    'expires_at', v_expires_at,
    'operator', jsonb_build_object(
      'id', v_op.id,
      'name', v_op.name,
      'login_name', v_op.login_name,
      'registration_masked', public.mask_registration(v_op.registration),
      'shift', v_op.shift,
      'primary_cell_id', v_op.primary_cell_id,
      'primary_machine_id', v_op.primary_machine_id,
      'cells', COALESCE(v_cells_json, '[]'::jsonb),
      'machines', COALESCE(v_machines_json, '[]'::jsonb)
    )
  );
END;
$$;

-- Definir contexto da sessão
CREATE OR REPLACE FUNCTION public.set_operator_session_context(
  p_session_token text,
  p_cell_id uuid,
  p_machine_id uuid,
  p_station_name text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public AS $$
DECLARE
  v_token_hash text := encode(digest(p_session_token, 'sha256'), 'hex');
  v_session public.operator_sessions%ROWTYPE;
  v_cell_name text;
  v_machine_name text;
  v_has_cell boolean;
  v_has_machine boolean;
BEGIN
  -- Validar Sessão
  SELECT * INTO v_session FROM public.operator_sessions
  WHERE token_hash = v_token_hash AND ended_at IS NULL AND revoked_at IS NULL AND expires_at > now();

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sessão inválida, expirada ou revogada.');
  END IF;

  -- Validar vínculo com Célula
  SELECT EXISTS(
    SELECT 1 FROM public.operator_cell_assignments
    WHERE operator_id = v_session.operator_id AND cell_id = p_cell_id AND active = true
  ) INTO v_has_cell;

  IF NOT v_has_cell THEN
    RETURN jsonb_build_object('success', false, 'error', 'Célula não vinculada a este operador.');
  END IF;

  -- Validar vínculo com Máquina (se informada)
  IF p_machine_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.operator_machine_assignments
      WHERE operator_id = v_session.operator_id AND machine_id = p_machine_id AND active = true
    ) INTO v_has_machine;

    IF NOT v_has_machine THEN
      RETURN jsonb_build_object('success', false, 'error', 'Máquina não vinculada a este operador.');
    END IF;
  END IF;

  -- Obter Nomes para Snapshot
  SELECT name INTO v_cell_name FROM public.cells WHERE id = p_cell_id;
  IF p_machine_id IS NOT NULL THEN
    SELECT name INTO v_machine_name FROM public.production_machines WHERE id = p_machine_id;
  END IF;

  UPDATE public.operator_sessions SET
    cell_id = p_cell_id,
    machine_id = p_machine_id,
    cell_name_snapshot = v_cell_name,
    machine_name_snapshot = v_machine_name,
    station_name_snapshot = p_station_name,
    last_seen_at = now()
  WHERE id = v_session.id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Heartbeat
CREATE OR REPLACE FUNCTION public.heartbeat_operator_session(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public AS $$
DECLARE
  v_token_hash text := encode(digest(p_session_token, 'sha256'), 'hex');
  v_session_id uuid;
BEGIN
  SELECT id INTO v_session_id FROM public.operator_sessions
  WHERE token_hash = v_token_hash AND ended_at IS NULL AND revoked_at IS NULL AND expires_at > now();

  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sessão expirada ou encerrada.');
  END IF;

  UPDATE public.operator_sessions SET
    last_seen_at = now(),
    expires_at = now() + interval '8 hours'
  WHERE id = v_session_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Logout
CREATE OR REPLACE FUNCTION public.logout_operator_session(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public AS $$
DECLARE
  v_token_hash text := encode(digest(p_session_token, 'sha256'), 'hex');
BEGIN
  UPDATE public.operator_sessions 
  SET ended_at = now(), end_reason = 'user_logout'
  WHERE token_hash = v_token_hash AND ended_at IS NULL;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Revogar Sessão
CREATE OR REPLACE FUNCTION public.revoke_operator_session(p_session_id uuid, p_revoked_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public AS $$
BEGIN
  UPDATE public.operator_sessions 
  SET revoked_at = now(), revoked_by = p_revoked_by, ended_at = now(), end_reason = 'revoked_by_admin'
  WHERE id = p_session_id AND ended_at IS NULL;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─── 7. Redesenho de process_production_reading ────────────────
CREATE OR REPLACE FUNCTION public.process_production_reading(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_token text := NULLIF(TRIM(p_payload->>'operatorSessionToken'), '');
  v_client_event_id text := NULLIF(TRIM(p_payload->>'client_event_id'), '');
  v_tag_value text := UPPER(TRIM(COALESCE(p_payload->>'rawValue', p_payload->>'raw_value', p_payload->>'tagValue', '')));
  v_reader_type text := COALESCE(NULLIF(p_payload->>'readerType', ''), NULLIF(p_payload->>'reader_type', ''), 'keyboard_barcode');
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
  i integer;
BEGIN
  -- Validar permissão de banco comum
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
    v_op.id, v_op.name, v_op.registration, v_session.cell_name_snapshot, v_session.shift_snapshot, v_date, v_hour,
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
      v_result := jsonb_build_object(
        'success', true,
        'status', 'approved',
        'alert_level', 'green',
        'message', 'Leitura já processada anteriormente.',
        'lot', to_jsonb(v_lot),
        'item', to_jsonb(v_piece),
        'reading', to_jsonb(v_reading)
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

  -- Serializa todas as coletas da mesma peça
  SELECT * INTO v_piece FROM public.production_pieces WHERE id = v_piece.id FOR UPDATE;
  SELECT * INTO v_lot FROM public.production_lots WHERE id = v_piece.lot_id;
  SELECT * INTO v_order FROM public.production_orders WHERE id = v_lot.production_order_id;

  -- Vincula lote e ordem no log de auditoria
  UPDATE public.production_collection_events SET
    lot_id = v_lot.id,
    production_order_id = v_order.id,
    piece_id = v_piece.id
  WHERE id = v_event.id;

  -- Validar regras físicas da peça
  IF v_piece.status = 'cancelled' THEN
    v_result := jsonb_build_object(
      'success', false,
      'status', 'cancelled',
      'alert_level', 'red',
      'message', 'Peça pertencente a lote cancelado ou marcado como desativado.'
    );
    RETURN public.finish_collection_event(v_event.id, 'ignored', 'cancelled', v_result, v_piece.id, v_lot.id, v_result->>'message');
  END IF;

  -- Valida a etapa correta baseada no Roteiro/Célula da Sessão
  v_val_res := public.validate_piece_collection_step(
    v_piece.id, 
    v_session.cell_name_snapshot, 
    v_session.station_name_snapshot, 
    v_step_input
  );

  IF NOT (v_val_res->>'isValid')::boolean THEN
    v_result := jsonb_build_object(
      'success', false,
      'status', v_val_res->>'status',
      'alert_level', 'yellow',
      'message', v_val_res->>'reason',
      'expected_step', v_val_res->'expected'
    );
    RETURN public.finish_collection_event(v_event.id, 'ignored', v_val_res->>'status', v_result, v_piece.id, v_lot.id, v_val_res->>'reason');
  END IF;

  v_target_step_code := v_val_res->'expected'->>'step_name';
  v_from_stage := v_piece.current_step;

  -- Evitar duplicar a baixa se já aprovado nesta máquina/sessão
  SELECT * INTO v_reading FROM public.production_stage_readings
  WHERE piece_id = v_piece.id AND step_name = v_target_step_code AND status = 'approved'
  LIMIT 1;

  IF v_reading.id IS NOT NULL THEN
    v_result := jsonb_build_object(
      'success', true,
      'status', 'approved',
      'alert_level', 'green',
      'message', 'Leitura da peça já registrada nesta etapa.',
      'lot', to_jsonb(v_lot),
      'item', to_jsonb(v_piece),
      'reading', to_jsonb(v_reading)
    );
    RETURN public.finish_collection_event(v_event.id, 'synced', 'approved', v_result, v_piece.id, v_lot.id, NULL);
  END IF;

  -- Registrar Baixa
  INSERT INTO public.production_stage_readings (
    piece_id, lot_id, step_name, cell_name, machine_id, operator_id, operator,
    status, read_at, client_event_id, shift, reader_type, quantity
  ) VALUES (
    v_piece.id, v_lot.id, v_target_step_code, v_session.cell_name_snapshot, v_session.machine_id, v_op.id, v_op.name,
    'approved', v_created_at_client, v_client_event_id, v_session.shift_snapshot, v_reader_type, v_quantity
  ) RETURNING * INTO v_reading;

  -- Atualizar peça para a próxima etapa da rota
  v_new_completed_steps := array_append(COALESCE(v_piece.completed_steps, '{}'::text[]), v_target_step_code);
  
  -- Determinar próxima etapa
  FOR i IN 1..array_length(v_piece.route_steps, 1) LOOP
    IF v_piece.route_steps[i] = v_target_step_code THEN
      IF i < array_length(v_piece.route_steps, 1) THEN
        v_next_step := v_piece.route_steps[i+1];
        v_found_next := true;
      END IF;
      EXIT;
    END IF;
  END LOOP;

  UPDATE public.production_pieces SET
    current_step = CASE WHEN v_found_next THEN v_next_step ELSE 'Concluída' END,
    current_cell = CASE WHEN v_found_next THEN (SELECT cell_name FROM public.routing_steps WHERE id = v_piece.id AND step_name = v_next_step) ELSE NULL END,
    status = CASE WHEN v_found_next THEN 'in_progress'::text ELSE 'completed'::text END,
    completed_steps = v_new_completed_steps,
    updated_at = now()
  WHERE id = v_piece.id;

  -- Atualizar progresso do Lote do cliente
  SELECT count(*) INTO v_total_pieces FROM public.production_pieces WHERE lot_id = v_lot.id;
  SELECT count(*) INTO v_completed_pieces FROM public.production_pieces WHERE lot_id = v_lot.id AND status = 'completed';

  v_lot_progress := CASE WHEN v_total_pieces > 0 THEN (v_completed_pieces::numeric / v_total_pieces::numeric) * 100.0 ELSE 0.0 END;

  UPDATE public.production_lots SET
    progress_percent = v_lot_progress,
    status = CASE 
      WHEN v_completed_pieces = v_total_pieces THEN 'waiting_packaging'::text 
      ELSE 'in_progress'::text 
    END,
    updated_at = now()
  WHERE id = v_lot.id;

  -- Lançar Entrada MES
  INSERT INTO public.production_entries (
    date, shift, cell_name, step_name, quantity, operator_id, client_event_id
  ) VALUES (
    v_date, v_session.shift_snapshot, v_session.cell_name_snapshot, v_target_step_code, v_quantity, v_op.id, v_client_event_id
  ) RETURNING id INTO v_entry_id;

  v_result := jsonb_build_object(
    'success', true,
    'status', 'approved',
    'alert_level', 'green',
    'message', 'Baixa de etapa registrada com sucesso!',
    'lot', to_jsonb(v_lot),
    'item', to_jsonb(v_piece),
    'reading', to_jsonb(v_reading)
  );

  RETURN public.finish_collection_event(v_event.id, 'synced', 'approved', v_result, v_piece.id, v_lot.id, NULL);
END;
$$;

-- ─── 8. Políticas RLS de Segurança ────────────────────────────
ALTER TABLE public.operator_cell_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_machine_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_access_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY policy_admin_manage_cell_assignments ON public.operator_cell_assignments
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'manager') OR (SELECT permissions->>'manage_operators' FROM public.profiles WHERE id = auth.uid())::boolean = true);

CREATE POLICY policy_select_own_cell_assignments ON public.operator_cell_assignments
  AS PERMISSIVE FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY policy_admin_manage_machine_assignments ON public.operator_machine_assignments
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'manager') OR (SELECT permissions->>'manage_operators' FROM public.profiles WHERE id = auth.uid())::boolean = true);

CREATE POLICY policy_select_own_machine_assignments ON public.operator_machine_assignments
  AS PERMISSIVE FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY policy_admin_manage_sessions ON public.operator_sessions
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'manager') OR (SELECT permissions->>'manage_operators' FROM public.profiles WHERE id = auth.uid())::boolean = true);

CREATE POLICY policy_operator_own_sessions ON public.operator_sessions
  AS PERMISSIVE FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY policy_admin_access_attempts ON public.operator_access_attempts
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'manager') OR (SELECT permissions->>'manage_operators' FROM public.profiles WHERE id = auth.uid())::boolean = true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.operator_cell_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operator_machine_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operator_sessions TO authenticated;
GRANT SELECT, INSERT ON public.operator_access_attempts TO authenticated, anon;

GRANT EXECUTE ON FUNCTION public.operator_login_v2(text, text, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.set_operator_session_context(text, uuid, uuid, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.heartbeat_operator_session(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.logout_operator_session(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.revoke_operator_session(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mask_registration(text) TO authenticated, anon;

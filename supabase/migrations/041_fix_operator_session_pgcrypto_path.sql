-- ============================================================
-- AC.Prod — MES Leo Madeiras
-- Migration 041: Correção de search_path para funções de sessão operacional do operador
-- ============================================================

-- ─── 1. operator_login_v2 ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.operator_login_v2(
  p_login_name text,
  p_registration text,
  p_device_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER VOLATILE 
SET search_path = public, extensions 
AS $$
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

-- ─── 2. set_operator_session_context ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_operator_session_context(
  p_session_token text,
  p_cell_id uuid,
  p_machine_id uuid,
  p_station_name text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER VOLATILE 
SET search_path = public, extensions 
AS $$
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

-- ─── 3. heartbeat_operator_session ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.heartbeat_operator_session(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER VOLATILE 
SET search_path = public, extensions 
AS $$
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

-- ─── 4. logout_operator_session ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.logout_operator_session(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER VOLATILE 
SET search_path = public, extensions 
AS $$
DECLARE
  v_token_hash text := encode(digest(p_session_token, 'sha256'), 'hex');
BEGIN
  UPDATE public.operator_sessions 
  SET ended_at = now(), end_reason = 'user_logout'
  WHERE token_hash = v_token_hash AND ended_at IS NULL;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─── 5. revoke_operator_session ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_operator_session(p_session_id uuid, p_revoked_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER VOLATILE 
SET search_path = public, extensions 
AS $$
BEGIN
  UPDATE public.operator_sessions 
  SET revoked_at = now(), revoked_by = p_revoked_by, ended_at = now(), end_reason = 'revoked_by_admin'
  WHERE id = p_session_id AND ended_at IS NULL;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.operator_login_v2(text,text,text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.set_operator_session_context(text,uuid,uuid,text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.heartbeat_operator_session(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.logout_operator_session(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.revoke_operator_session(uuid,uuid) TO authenticated, anon;

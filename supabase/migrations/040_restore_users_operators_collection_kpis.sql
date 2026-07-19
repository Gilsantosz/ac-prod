-- ============================================================
-- AC.Prod — restauração de Usuários, Operadores e KPIs da Coleta
-- Corrige o vínculo legado de células, o login operacional, a
-- manutenção atômica de operadores e o snapshot acumulado do lote.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ─── 1. Recuperar vínculos legados sem apagar histórico ──────

INSERT INTO public.operator_cell_assignments (
  operator_id,
  cell_id,
  is_primary,
  active,
  valid_from
)
SELECT DISTINCT
  o.id,
  c.id,
  false,
  true,
  now()
FROM public.operators o
CROSS JOIN LATERAL unnest(COALESCE(o.cells, ARRAY[]::text[])) AS legacy_cell(name)
JOIN public.cells c
  ON lower(btrim(c.name)) = lower(btrim(legacy_cell.name))
WHERE o.active = true
  AND c.active = true
  AND NOT EXISTS (
    SELECT 1
    FROM public.operator_cell_assignments current_assignment
    WHERE current_assignment.operator_id = o.id
      AND current_assignment.cell_id = c.id
      AND current_assignment.active = true
  );

WITH chosen_cell AS (
  SELECT DISTINCT ON (assignment.operator_id)
    assignment.operator_id,
    assignment.cell_id
  FROM public.operator_cell_assignments assignment
  JOIN public.cells cell ON cell.id = assignment.cell_id
  WHERE assignment.active = true
  ORDER BY
    assignment.operator_id,
    assignment.is_primary DESC,
    cell.name,
    assignment.valid_from,
    assignment.id
)
UPDATE public.operators operator
SET primary_cell_id = chosen_cell.cell_id,
    primary_cell = cell.name
FROM chosen_cell
JOIN public.cells cell ON cell.id = chosen_cell.cell_id
WHERE operator.id = chosen_cell.operator_id
  AND operator.primary_cell_id IS NULL;

UPDATE public.operator_cell_assignments assignment
SET is_primary = (assignment.cell_id = operator.primary_cell_id),
    updated_at = now()
FROM public.operators operator
WHERE operator.id = assignment.operator_id
  AND assignment.active = true;

UPDATE public.operators operator
SET cells = linked.cells
FROM (
  SELECT assignment.operator_id, array_agg(cell.name ORDER BY cell.name) AS cells
  FROM public.operator_cell_assignments assignment
  JOIN public.cells cell ON cell.id = assignment.cell_id
  WHERE assignment.active = true
  GROUP BY assignment.operator_id
) linked
WHERE linked.operator_id = operator.id;

-- ─── 2. Permissão e gravação atômica de operadores ───────────

CREATE OR REPLACE FUNCTION public.can_manage_operators()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles profile
    WHERE profile.id = auth.uid()
      AND COALESCE(profile.active, true) = true
      AND (
        profile.role IN ('admin', 'manager')
        OR COALESCE((profile.permissions ->> 'manage_operators')::boolean, false)
        OR COALESCE((profile.permissions ->> 'manage_users')::boolean, false)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_operators() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_operators() TO authenticated;

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

REVOKE ALL ON FUNCTION public.admin_upsert_operator(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_operator(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_unlock_operator(p_operator_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_operators() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sem permissão para desbloquear operadores.');
  END IF;

  UPDATE public.operators
  SET failed_login_count = 0,
      locked_until = NULL
  WHERE id = p_operator_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Operador não encontrado.');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_unlock_operator(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_unlock_operator(uuid) TO authenticated;

-- ─── 3. Login operacional e contexto da estação ──────────────

CREATE OR REPLACE FUNCTION public.operator_login_v2(
  p_login_name text,
  p_registration text,
  p_device_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_login text := lower(btrim(COALESCE(p_login_name, '')));
  v_registration text := btrim(COALESCE(p_registration, ''));
  v_operator public.operators%ROWTYPE;
  v_failed_count integer;
  v_token text;
  v_token_hash text;
  v_session_id uuid;
  v_expires_at timestamptz := now() + interval '8 hours';
  v_cells jsonb;
  v_machines jsonb;
BEGIN
  SELECT count(*) INTO v_failed_count
  FROM public.operator_access_attempts
  WHERE login_name_input = v_login
    AND success = false
    AND created_at > now() - interval '10 minutes';

  IF v_failed_count >= 5 THEN
    INSERT INTO public.operator_access_attempts (login_name_input, success, failure_reason, device_id)
    VALUES (v_login, false, 'rate_limit_locked', p_device_id);
    RETURN jsonb_build_object('success', false, 'error', 'Tentativas excedidas. Aguarde 10 minutos ou solicite o desbloqueio.');
  END IF;

  SELECT * INTO v_operator
  FROM public.operators
  WHERE active = true
    AND COALESCE(login_enabled, true) = true
    AND deactivated_at IS NULL
    AND (lower(btrim(login_name)) = v_login OR lower(btrim(name)) = v_login)
  LIMIT 1;

  IF v_operator.id IS NULL THEN
    INSERT INTO public.operator_access_attempts (login_name_input, success, failure_reason, device_id)
    VALUES (v_login, false, 'operator_not_found_or_inactive', p_device_id);
    RETURN jsonb_build_object('success', false, 'error', 'Operador não encontrado ou credenciais inválidas.');
  END IF;

  IF v_operator.locked_until IS NOT NULL AND v_operator.locked_until > now() THEN
    INSERT INTO public.operator_access_attempts (login_name_input, success, failure_reason, device_id)
    VALUES (v_login, false, 'locked_until_active', p_device_id);
    RETURN jsonb_build_object('success', false, 'error', 'Conta bloqueada temporariamente.');
  END IF;

  IF v_operator.credential_hash IS NULL
     OR crypt(v_registration, v_operator.credential_hash) IS DISTINCT FROM v_operator.credential_hash THEN
    UPDATE public.operators
    SET failed_login_count = failed_login_count + 1,
        locked_until = CASE WHEN failed_login_count + 1 >= 5 THEN now() + interval '10 minutes' ELSE NULL END
    WHERE id = v_operator.id;

    INSERT INTO public.operator_access_attempts (login_name_input, success, failure_reason, device_id)
    VALUES (v_login, false, 'invalid_credentials', p_device_id);
    RETURN jsonb_build_object('success', false, 'error', 'Operador não encontrado ou credenciais inválidas.');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', cell.id,
      'name', cell.name,
      'is_primary', assignment.is_primary
    )
    ORDER BY assignment.is_primary DESC, cell.name
  )
  INTO v_cells
  FROM public.operator_cell_assignments assignment
  JOIN public.cells cell ON cell.id = assignment.cell_id AND cell.active = true
  WHERE assignment.operator_id = v_operator.id
    AND assignment.active = true;

  IF v_cells IS NULL OR jsonb_array_length(v_cells) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Operador sem célula de trabalho vinculada. Solicite o ajuste em Usuários → Operadores.');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', machine.id,
      'name', machine.name,
      'cell_id', cell.id,
      'cell_name', cell.name,
      'is_primary', COALESCE(machine_assignment.is_primary, false)
    )
    ORDER BY COALESCE(machine_assignment.is_primary, false) DESC, cell.name, machine.name
  )
  INTO v_machines
  FROM public.production_machines machine
  JOIN public.cells cell ON lower(btrim(cell.name)) = lower(btrim(machine.cell_name))
  JOIN public.operator_cell_assignments cell_assignment
    ON cell_assignment.operator_id = v_operator.id
   AND cell_assignment.cell_id = cell.id
   AND cell_assignment.active = true
  LEFT JOIN public.operator_machine_assignments machine_assignment
    ON machine_assignment.operator_id = v_operator.id
   AND machine_assignment.machine_id = machine.id
   AND machine_assignment.active = true
  WHERE machine.active = true
    AND (
      machine_assignment.id IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.operator_machine_assignments explicit_assignment
        WHERE explicit_assignment.operator_id = v_operator.id
          AND explicit_assignment.active = true
      )
    );

  UPDATE public.operators
  SET failed_login_count = 0,
      locked_until = NULL,
      last_login_at = now()
  WHERE id = v_operator.id;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

  INSERT INTO public.operator_sessions (
    operator_id,
    token_hash,
    device_id,
    expires_at,
    shift_snapshot
  )
  VALUES (
    v_operator.id,
    v_token_hash,
    p_device_id,
    v_expires_at,
    v_operator.shift
  )
  RETURNING id INTO v_session_id;

  INSERT INTO public.operator_access_attempts (login_name_input, success, device_id)
  VALUES (v_login, true, p_device_id);

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
      'primary_cell_id', v_operator.primary_cell_id,
      'primary_machine_id', v_operator.primary_machine_id,
      'cells', COALESCE(v_cells, '[]'::jsonb),
      'machines', COALESCE(v_machines, '[]'::jsonb)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.operator_login_v2(text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_operator_session_context(
  p_session_token text,
  p_cell_id uuid,
  p_machine_id uuid,
  p_station_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token_hash text := encode(digest(p_session_token, 'sha256'), 'hex');
  v_session public.operator_sessions%ROWTYPE;
  v_cell_name text;
  v_machine_name text;
  v_has_explicit_machine_restriction boolean;
BEGIN
  SELECT * INTO v_session
  FROM public.operator_sessions
  WHERE token_hash = v_token_hash
    AND ended_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now();

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sessão inválida, expirada ou revogada.');
  END IF;

  SELECT cell.name INTO v_cell_name
  FROM public.cells cell
  JOIN public.operator_cell_assignments assignment
    ON assignment.cell_id = cell.id
   AND assignment.operator_id = v_session.operator_id
   AND assignment.active = true
  WHERE cell.id = p_cell_id
    AND cell.active = true;

  IF v_cell_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Célula não vinculada a este operador.');
  END IF;

  IF p_machine_id IS NOT NULL THEN
    SELECT machine.name INTO v_machine_name
    FROM public.production_machines machine
    WHERE machine.id = p_machine_id
      AND machine.active = true
      AND lower(btrim(machine.cell_name)) = lower(btrim(v_cell_name));

    IF v_machine_name IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'A máquina não pertence à célula selecionada.');
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.operator_machine_assignments assignment
      WHERE assignment.operator_id = v_session.operator_id
        AND assignment.active = true
    ) INTO v_has_explicit_machine_restriction;

    IF v_has_explicit_machine_restriction AND NOT EXISTS (
      SELECT 1
      FROM public.operator_machine_assignments assignment
      WHERE assignment.operator_id = v_session.operator_id
        AND assignment.machine_id = p_machine_id
        AND assignment.active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Máquina não vinculada a este operador.');
    END IF;
  END IF;

  UPDATE public.operator_sessions
  SET cell_id = p_cell_id,
      machine_id = p_machine_id,
      cell_name_snapshot = v_cell_name,
      machine_name_snapshot = v_machine_name,
      station_name_snapshot = COALESCE(NULLIF(btrim(p_station_name), ''), 'Coletor Chão de Fábrica'),
      last_seen_at = now()
  WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'success', true,
    'cell_name', v_cell_name,
    'machine_name', v_machine_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_operator_session_context(text, uuid, uuid, text) TO anon, authenticated;

-- ─── 4. Fonte canônica do snapshot dos lotes ativos ──────────

CREATE OR REPLACE VIEW public.collection_stage_facts AS
SELECT
  reading.id AS reading_id,
  reading.piece_id,
  reading.lot_id,
  piece.pcp_import_batch_id,
  reading.step_name AS step_code_canonico,
  reading.quantity,
  reading.status,
  reading.created_at AS read_at,
  reading.cell_name,
  reading.machine_id,
  reading.operator_id,
  reading.operator,
  reading.shift,
  reading.created_at AS created_at_client,
  reading.created_at,
  piece.traceability_code AS piece_code,
  lot.lot_code,
  COALESCE(reading.production_cycle, 1) AS production_cycle
FROM public.production_stage_readings reading
JOIN public.production_pieces piece ON piece.id = reading.piece_id
JOIN public.production_lots lot ON lot.id = reading.lot_id
WHERE reading.status = 'approved';

CREATE OR REPLACE FUNCTION public.get_collection_cell_snapshot(
  p_cell_name text,
  p_workstation_id uuid DEFAULT NULL,
  p_shift text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_pcp_import_batch_id uuid DEFAULT NULL,
  p_lot_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step_code text;
  v_expected bigint := 0;
  v_approved_cumulative bigint := 0;
  v_pending bigint := 0;
  v_rework bigint := 0;
  v_replacement bigint := 0;
  v_active_lots bigint := 0;
  v_active_batches bigint := 0;
  v_shift_total_reads bigint := 0;
  v_shift_approved_events bigint := 0;
  v_shift_unique_completions bigint := 0;
  v_shift_rejected bigint := 0;
  v_shift_blocked bigint := 0;
  v_shift_duplicated bigint := 0;
  v_shift_errors bigint := 0;
  v_active_general_lots jsonb;
BEGIN
  SELECT step.code INTO v_step_code
  FROM public.routing_steps step
  WHERE lower(step.code) = lower(p_cell_name)
     OR lower(step.name) = lower(p_cell_name)
     OR (p_cell_name IN ('Borda', 'Bordo') AND step.code = 'edge')
     OR (p_cell_name = 'Usinagem' AND step.code = 'cnc')
     OR (p_cell_name = 'Furação' AND step.code = 'drill')
     OR (p_cell_name = 'Corte' AND step.code = 'cut')
     OR (p_cell_name = 'Marcenaria' AND step.code = 'joinery')
  ORDER BY step.sequence NULLS LAST
  LIMIT 1;

  v_step_code := COALESCE(v_step_code, lower(p_cell_name));

  SELECT
    count(piece.id),
    count(*) FILTER (
      WHERE piece.status IN ('rework_pending', 'rework_in_progress')
         OR piece.rework_status = 'in_progress'
    ),
    count(*) FILTER (
      WHERE piece.status IN ('replacement_requested', 'replacement_in_production')
         OR piece.replacement_status = 'in_production'
    ),
    count(DISTINCT piece.lot_id),
    count(DISTINCT piece.pcp_import_batch_id)
  INTO v_expected, v_rework, v_replacement, v_active_lots, v_active_batches
  FROM public.production_pieces piece
  JOIN public.production_lots lot ON lot.id = piece.lot_id
  WHERE v_step_code = ANY(COALESCE(piece.route_steps, ARRAY[]::text[]))
    AND piece.status NOT IN ('cancelled', 'replaced', 'shipped')
    AND lot.status NOT IN ('closed', 'shipped', 'cancelled')
    AND (p_pcp_import_batch_id IS NULL OR piece.pcp_import_batch_id = p_pcp_import_batch_id)
    AND (p_lot_id IS NULL OR piece.lot_id = p_lot_id);

  SELECT count(DISTINCT piece.id)
  INTO v_approved_cumulative
  FROM public.production_pieces piece
  JOIN public.production_lots lot ON lot.id = piece.lot_id
  JOIN public.collection_stage_facts fact ON fact.piece_id = piece.id
  WHERE fact.step_code_canonico = v_step_code
    AND piece.status NOT IN ('cancelled', 'replaced', 'shipped')
    AND lot.status NOT IN ('closed', 'shipped', 'cancelled')
    AND (p_pcp_import_batch_id IS NULL OR piece.pcp_import_batch_id = p_pcp_import_batch_id)
    AND (p_lot_id IS NULL OR piece.lot_id = p_lot_id);

  v_pending := GREATEST(v_expected - v_approved_cumulative, 0);

  SELECT
    count(*),
    count(*) FILTER (WHERE event.status = 'synced' AND event.result_status = 'approved'),
    count(*) FILTER (WHERE event.result_status = 'rejected'),
    count(*) FILTER (WHERE event.result_status = 'blocked'),
    count(*) FILTER (WHERE event.result_status = 'duplicated'),
    count(*) FILTER (WHERE event.status = 'error')
  INTO
    v_shift_total_reads,
    v_shift_approved_events,
    v_shift_rejected,
    v_shift_blocked,
    v_shift_duplicated,
    v_shift_errors
  FROM public.production_collection_events event
  WHERE lower(COALESCE(event.cell_name, '')) = lower(p_cell_name)
    AND (p_workstation_id IS NULL OR event.machine_id = p_workstation_id)
    AND (p_shift IS NULL OR event.shift = p_shift)
    AND (p_date_from IS NULL OR COALESCE(event.created_at_client, event.last_attempt_at, event.created_at) >= p_date_from)
    AND (p_date_to IS NULL OR COALESCE(event.created_at_client, event.last_attempt_at, event.created_at) < p_date_to)
    AND (p_pcp_import_batch_id IS NULL OR event.pcp_import_batch_id = p_pcp_import_batch_id)
    AND (p_lot_id IS NULL OR event.lot_id = p_lot_id);

  SELECT count(DISTINCT reading.piece_id)
  INTO v_shift_unique_completions
  FROM public.production_stage_readings reading
  WHERE reading.step_name = v_step_code
    AND reading.status = 'approved'
    AND (p_workstation_id IS NULL OR reading.machine_id = p_workstation_id)
    AND (p_shift IS NULL OR reading.shift = p_shift)
    AND (p_date_from IS NULL OR reading.created_at >= p_date_from)
    AND (p_date_to IS NULL OR reading.created_at < p_date_to)
    AND (
      p_pcp_import_batch_id IS NULL
      OR reading.piece_id IN (
        SELECT piece.id
        FROM public.production_pieces piece
        WHERE piece.pcp_import_batch_id = p_pcp_import_batch_id
      )
    )
    AND (p_lot_id IS NULL OR reading.lot_id = p_lot_id);

  SELECT jsonb_agg(to_jsonb(active_batch))
  INTO v_active_general_lots
  FROM (
    SELECT batch.id, batch.general_lot_code, batch.progress_percent
    FROM public.promob_import_batches batch
    WHERE batch.status <> 'closed'
    ORDER BY batch.created_at DESC
    LIMIT 15
  ) active_batch;

  RETURN jsonb_build_object(
    'total', v_shift_total_reads,
    'approved', v_approved_cumulative,
    'rejected', v_shift_rejected,
    'blocked', v_shift_blocked + v_shift_duplicated,
    'expected', v_expected,
    'pending', v_pending,
    'rework', v_rework,
    'replacement', v_replacement,
    'active_lots', v_active_lots,
    'active_pcp_batches', v_active_batches,
    'step_code', v_step_code,
    'integrity', jsonb_build_object(
      'scope', 'cumulative_active_lots',
      'expected', v_expected,
      'approved', v_approved_cumulative,
      'pending', v_pending,
      'rework', v_rework,
      'replacement', v_replacement
    ),
    'shift_activity', jsonb_build_object(
      'scope', 'current_shift',
      'total_reads', v_shift_total_reads,
      'approved_events', v_shift_approved_events,
      'approved_unique_stage_completions', v_shift_unique_completions,
      'rejected', v_shift_rejected,
      'blocked', v_shift_blocked,
      'duplicated', v_shift_duplicated,
      'errors', v_shift_errors
    ),
    'active_general_lots', COALESCE(v_active_general_lots, '[]'::jsonb)
  );
END;
$$;

GRANT SELECT ON public.collection_stage_facts TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_collection_cell_snapshot(
  text,
  uuid,
  text,
  timestamptz,
  timestamptz,
  uuid,
  uuid
) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

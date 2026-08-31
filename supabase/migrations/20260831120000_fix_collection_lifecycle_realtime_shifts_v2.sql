-- ==============================================================================
-- AC.Prod2 — MES Industrial Leo Madeiras
-- Migration: 20260831120000_fix_collection_lifecycle_realtime_shifts_v2.sql
--
-- ESCOPO:
-- 1. Ciclo de Vida de Lote por Célula (production_cell_lot_states)
-- 2. Contexto Ativo da Célula (production_cell_active_contexts)
-- 3. Horários Customizados de Turno e Timezone por Operador (resolve_operator_shift_window)
-- 4. Concorrência Multi-Dispositivo com Advisory Lock em nível de Peça (process_production_reading_v2)
-- 5. KPIs Canônicos de Lote e Turno (get_collection_dashboard_snapshot_v2 / get_operator_shift_kpis_v2)
-- 6. Encerramento e Troca Atômica de Lotes (recalculate_cell_lot_state / switch_cell_active_lot_context)
-- 7. Reconciliação Não-Destrutiva e Healthcheck de Implantação
-- ==============================================================================

-- ─── 1. TABELAS DE CICLO DE LOTE E CONTEXTO ATIVO DA CÉLULA ───────────────────

CREATE TABLE IF NOT EXISTS public.production_cell_lot_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pcp_import_batch_id uuid REFERENCES public.promob_import_batches(id) ON DELETE SET NULL,
  general_lot_code text,
  lot_id uuid REFERENCES public.production_lots(id) ON DELETE SET NULL,
  lot_code text,
  cell_id uuid REFERENCES public.cells(id) ON DELETE SET NULL,
  cell_name text NOT NULL,
  step_code text NOT NULL,
  machine_id uuid REFERENCES public.production_machines(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('active', 'paused', 'closed', 'cancelled')) DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  paused_at timestamptz,
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_by_operator_id uuid REFERENCES public.operators(id) ON DELETE SET NULL,
  close_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cell_lot_active_machine 
ON public.production_cell_lot_states (lower(btrim(cell_name)), lower(btrim(step_code)), COALESCE(machine_id, '00000000-0000-0000-0000-000000000000'::uuid)) 
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_cell_lot_states_lookup
ON public.production_cell_lot_states (lot_id, cell_name, step_code, status);

CREATE INDEX IF NOT EXISTS idx_cell_lot_states_batch
ON public.production_cell_lot_states (pcp_import_batch_id, status);

-- Tabela de contexto de exibição/coleta ativo da célula
CREATE TABLE IF NOT EXISTS public.production_cell_active_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_id uuid REFERENCES public.cells(id) ON DELETE SET NULL,
  cell_name text NOT NULL,
  machine_id uuid REFERENCES public.production_machines(id) ON DELETE SET NULL,
  step_code text NOT NULL,
  active_lot_id uuid REFERENCES public.production_lots(id) ON DELETE SET NULL,
  active_lot_code text,
  active_pcp_import_batch_id uuid REFERENCES public.promob_import_batches(id) ON DELETE SET NULL,
  active_general_lot_code text,
  state_version bigint NOT NULL DEFAULT 1,
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cell_active_context 
ON public.production_cell_active_contexts (lower(btrim(cell_name)), lower(btrim(step_code)), COALESCE(machine_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Adicionar tabelas de estado ao Realtime
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.production_cell_lot_states;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.production_cell_active_contexts;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$$;

-- RLS para tabelas de estado
ALTER TABLE public.production_cell_lot_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_cell_active_contexts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'production_cell_lot_states' AND policyname = 'production_cell_lot_states_read') THEN
    CREATE POLICY production_cell_lot_states_read ON public.production_cell_lot_states FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'production_cell_active_contexts' AND policyname = 'production_cell_active_contexts_read') THEN
    CREATE POLICY production_cell_active_contexts_read ON public.production_cell_active_contexts FOR SELECT TO authenticated USING (true);
  END IF;
END;
$$;

-- ─── 2. CAMPOS DE TURNO E TIMEZONE EM OPERATORS ───────────────────────────────

ALTER TABLE public.operators
  ADD COLUMN IF NOT EXISTS shift_start_time time NOT NULL DEFAULT '06:00:00',
  ADD COLUMN IF NOT EXISTS shift_end_time time NOT NULL DEFAULT '14:00:00',
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Sao_Paulo';

-- Backfill seguro baseado no nome histórico do turno
UPDATE public.operators
SET shift_start_time = '06:00:00', shift_end_time = '14:00:00'
WHERE shift ILIKE '%1%' AND (shift_start_time IS NULL OR shift_start_time = '06:00:00');

UPDATE public.operators
SET shift_start_time = '14:00:00', shift_end_time = '22:00:00'
WHERE shift ILIKE '%2%' AND shift_start_time = '06:00:00';

UPDATE public.operators
SET shift_start_time = '22:00:00', shift_end_time = '06:00:00'
WHERE shift ILIKE '%3%' AND shift_start_time = '06:00:00';

-- ─── 3. RESOLUÇÃO PURA DE JANELA DE TURNO DO OPERADOR ─────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_operator_shift_window(
  p_operator_id uuid,
  p_reference_time timestamptz DEFAULT clock_timestamp()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_op public.operators%ROWTYPE;
  v_tz text;
  v_local_ref timestamp;
  v_local_date date;
  v_local_time time;
  v_start_time time;
  v_end_time time;
  v_work_date date;
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_start_timestamptz timestamptz;
  v_end_timestamptz timestamptz;
  v_is_inside boolean := false;
BEGIN
  SELECT * INTO v_op FROM public.operators WHERE id = p_operator_id;
  
  v_tz := COALESCE(NULLIF(v_op.timezone, ''), 'America/Sao_Paulo');
  v_start_time := COALESCE(v_op.shift_start_time, '06:00:00'::time);
  v_end_time := COALESCE(v_op.shift_end_time, '14:00:00'::time);

  -- Converter reference_time para horário local
  v_local_ref := (p_reference_time AT TIME ZONE v_tz);
  v_local_date := v_local_ref::date;
  v_local_time := v_local_ref::time;

  IF v_start_time < v_end_time THEN
    -- Turno diurno padrão (ex: 06:00 às 14:00 ou 14:00 às 22:00)
    v_work_date := v_local_date;
    v_start_ts := (v_local_date || ' ' || v_start_time)::timestamp;
    v_end_ts := (v_local_date || ' ' || v_end_time)::timestamp;
    
    IF v_local_time >= v_start_time AND v_local_time < v_end_time THEN
      v_is_inside := true;
    ELSIF v_local_time < v_start_time THEN
      -- Antes do início do turno de hoje: janela de referência é o turno de hoje
      v_is_inside := false;
    ELSE
      -- Após o término do turno de hoje
      v_is_inside := false;
    END IF;
  ELSE
    -- Turno noturno que cruza meia-noite (ex: 22:00 às 06:00)
    IF v_local_time >= v_start_time THEN
      -- Parte da noite (ex: 23:00 no dia X)
      v_work_date := v_local_date;
      v_start_ts := (v_local_date || ' ' || v_start_time)::timestamp;
      v_end_ts := ((v_local_date + interval '1 day')::date || ' ' || v_end_time)::timestamp;
      v_is_inside := true;
    ELSIF v_local_time < v_end_time THEN
      -- Parte da madrugada (ex: 02:00 no dia X+1) -> data de trabalho é o dia anterior
      v_work_date := (v_local_date - interval '1 day')::date;
      v_start_ts := (v_work_date || ' ' || v_start_time)::timestamp;
      v_end_ts := (v_local_date || ' ' || v_end_time)::timestamp;
      v_is_inside := true;
    ELSE
      -- Fora da janela noturna (ex: 12:00)
      v_work_date := v_local_date;
      v_start_ts := (v_local_date || ' ' || v_start_time)::timestamp;
      v_end_ts := ((v_local_date + interval '1 day')::date || ' ' || v_end_time)::timestamp;
      v_is_inside := false;
    END IF;
  END IF;

  v_start_timestamptz := (v_start_ts AT TIME ZONE v_tz);
  v_end_timestamptz := (v_end_ts AT TIME ZONE v_tz);

  RETURN jsonb_build_object(
    'operator_id', p_operator_id,
    'timezone', v_tz,
    'shift_name', COALESCE(v_op.shift, '1º Turno'),
    'shift_start_time', v_start_time,
    'shift_end_time', v_end_time,
    'shift_work_date', v_work_date,
    'shift_started_at', v_start_timestamptz,
    'shift_ends_at', v_end_timestamptz,
    'is_inside_shift', v_is_inside
  );
END;
$$;

-- ─── 4. ADMIN UPSERT OPERATOR COM CAMPOS DE TURNO ─────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_upsert_operator(
  p_operator_id uuid,
  p_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
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
  v_timezone text := COALESCE(NULLIF(p_data ->> 'timezone', ''), 'America/Sao_Paulo');
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

  IF v_shift_start_time = v_shift_end_time THEN
    RETURN jsonb_build_object('success', false, 'error', 'O horário de início do turno não pode ser igual ao de término.');
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

  SELECT name INTO v_primary_cell_name
  FROM public.cells
  WHERE id = v_primary_cell_id;

  IF p_operator_id IS NULL THEN
    IF v_registration IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'A matrícula é obrigatória para um novo operador.');
    END IF;

    INSERT INTO public.operators (
      name, role, active, registration, login_name, primary_cell, cells, shift,
      shift_start_time, shift_end_time, timezone, login_enabled, primary_cell_id, primary_machine_id
    ) VALUES (
      v_name, 'operator', v_active, v_registration, v_login, v_primary_cell_name,
      ARRAY(SELECT name FROM public.cells WHERE id = ANY(v_cell_ids) ORDER BY name),
      v_shift, v_shift_start_time, v_shift_end_time, v_timezone, true, v_primary_cell_id, v_primary_machine_id
    ) RETURNING * INTO v_operator;
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
        timezone = v_timezone,
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
  SET active = false, valid_until = now(), is_primary = false, updated_at = now()
  WHERE operator_id = v_operator.id AND active = true;

  INSERT INTO public.operator_cell_assignments (
    operator_id, cell_id, is_primary, active, valid_from, valid_until, assigned_by
  )
  SELECT v_operator.id, requested.cell_id, requested.cell_id = v_primary_cell_id, true, now(), NULL, auth.uid()
  FROM unnest(v_cell_ids) AS requested(cell_id);

  UPDATE public.operator_machine_assignments
  SET active = false, valid_until = now(), is_primary = false, updated_at = now()
  WHERE operator_id = v_operator.id AND active = true;

  INSERT INTO public.operator_machine_assignments (
    operator_id, machine_id, is_primary, active, valid_from, valid_until, assigned_by
  )
  SELECT v_operator.id, requested.machine_id, requested.machine_id = v_primary_machine_id, true, now(), NULL, auth.uid()
  FROM unnest(v_machine_ids) AS requested(machine_id);

  RETURN jsonb_build_object(
    'success', true,
    'operator', (
      to_jsonb(v_operator) - 'registration' - 'registration_normalized' - 'credential_hash'
    )
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Login ou matrícula já está em uso por outro operador.');
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Formato de dado inválido fornecido.');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_operator(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_operator(uuid, jsonb) TO authenticated;

-- ─── 5. SESSÃO OPERACIONAL COM SNAPSHOT DE JANELA DE TURNO ────────────────────

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
  v_operator public.operators%ROWTYPE;
  v_failed_count integer;
  v_token text;
  v_token_hash text;
  v_session_id uuid;
  v_window jsonb;
  v_expires_at timestamptz := clock_timestamp() + interval '8 hours';
  v_cells jsonb;
  v_machines jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason_code', 'AUTH_REQUIRED', 'error', 'Autenticação do sistema expirada. Entre novamente.');
  END IF;

  IF v_login = '' OR v_registration = '' OR v_device_id = '' THEN
    RETURN jsonb_build_object('success', false, 'reason_code', 'INVALID_CREDENTIALS', 'error', 'Login, matrícula e identificação do dispositivo são obrigatórios.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_auth_user_id AND p.active IS DISTINCT FROM false
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason_code', 'AUTH_USER_INACTIVE', 'error', 'Usuário do sistema inativo ou sem perfil operacional.');
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
    RETURN jsonb_build_object('success', false, 'reason_code', 'INVALID_CREDENTIALS', 'error', 'Operador não encontrado ou credenciais inválidas.');
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
    RETURN jsonb_build_object('success', false, 'reason_code', 'OPERATOR_WITHOUT_CELL', 'error', 'Operador sem célula de trabalho autorizada.');
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
  WHERE machine.active = true;

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

  v_window := public.resolve_operator_shift_window(v_operator.id, clock_timestamp());

  INSERT INTO public.operator_sessions (
    operator_id, auth_user_id, token_hash, device_id, expires_at,
    sync_grace_until, shift_snapshot
  ) VALUES (
    v_operator.id, v_auth_user_id, v_token_hash, v_device_id, v_expires_at,
    v_expires_at + interval '24 hours', v_operator.shift
  ) RETURNING id INTO v_session_id;

  INSERT INTO public.operator_access_attempts (login_name_input, success, device_id)
  VALUES (v_login, true, v_device_id);

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'session_token', v_token,
    'expires_at', v_expires_at,
    'shift_window', v_window,
    'operator', jsonb_build_object(
      'id', v_operator.id,
      'name', v_operator.name,
      'login_name', v_operator.login_name,
      'registration_masked', public.mask_registration(v_operator.registration),
      'shift', v_operator.shift,
      'shift_start_time', v_operator.shift_start_time,
      'shift_end_time', v_operator.shift_end_time,
      'timezone', v_operator.timezone,
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

-- ─── 6. MOTOR TRANSACIONAL DE ENCERRAMENTO E TROCA DE LOTE NA CÉLULA ──────────

CREATE OR REPLACE FUNCTION public.recalculate_cell_lot_state(
  p_lot_id uuid,
  p_cell_name text,
  p_step_code text,
  p_machine_id uuid DEFAULT NULL,
  p_closed_by_operator_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_expected bigint := 0;
  v_effective_approved bigint := 0;
  v_pending bigint := 0;
  v_rejected_current bigint := 0;
  v_rework_open bigint := 0;
  v_replacement_open bigint := 0;
  v_state public.production_cell_lot_states%ROWTYPE;
  v_lot public.production_lots%ROWTYPE;
  v_is_completed boolean := false;
  v_new_version bigint := 1;
BEGIN
  SELECT * INTO v_lot FROM public.production_lots WHERE id = p_lot_id;
  IF v_lot.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lote não encontrado.');
  END IF;

  -- 1. Contagem canônica de peças da etapa
  SELECT
    count(*),
    count(*) FILTER (WHERE p.status = 'rejected' AND p.replacement_status NOT IN ('completed', 'replaced')),
    count(*) FILTER (WHERE p.rework_status = 'in_progress' OR p.status IN ('rework_pending', 'rework_in_progress')),
    count(*) FILTER (WHERE p.replacement_status IN ('requested', 'in_production') OR p.status IN ('replacement_requested', 'replacement_in_production'))
  INTO v_expected, v_rejected_current, v_rework_open, v_replacement_open
  FROM public.production_pieces p
  WHERE p.lot_id = p_lot_id
    AND p_step_code = ANY(COALESCE(p.route_steps, '{}'::text[]))
    AND p.status NOT IN ('cancelled');

  -- 2. Aprovadas efetivas na etapa
  SELECT count(DISTINCT sr.piece_id)
  INTO v_effective_approved
  FROM public.production_stage_readings sr
  JOIN public.production_pieces p ON p.id = sr.piece_id
  WHERE sr.lot_id = p_lot_id
    AND sr.step_name = p_step_code
    AND sr.status = 'approved'
    AND p.status NOT IN ('cancelled');

  v_pending := GREATEST(v_expected - v_effective_approved, 0);

  -- 3. Critérios estritos de encerramento da célula (8 critérios obrigatórios)
  IF v_expected > 0 
     AND v_effective_approved >= v_expected 
     AND v_pending = 0 
     AND v_rejected_current = 0 
     AND v_rework_open = 0 
     AND v_replacement_open = 0 THEN
    v_is_completed := true;
  END IF;

  -- 4. Atualizar / Inserir estado na célula
  SELECT * INTO v_state
  FROM public.production_cell_lot_states
  WHERE lot_id = p_lot_id
    AND lower(btrim(cell_name)) = lower(btrim(p_cell_name))
    AND lower(btrim(step_code)) = lower(btrim(p_step_code))
    AND (p_machine_id IS NULL OR machine_id = p_machine_id OR machine_id IS NULL)
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_state.id IS NOT NULL THEN
    v_new_version := v_state.state_version + 1;
    UPDATE public.production_cell_lot_states
    SET status = CASE WHEN v_is_completed THEN 'closed' ELSE 'active' END,
        closed_at = CASE WHEN v_is_completed THEN COALESCE(closed_at, clock_timestamp()) ELSE NULL END,
        closed_by_operator_id = CASE WHEN v_is_completed THEN COALESCE(closed_by_operator_id, p_closed_by_operator_id) ELSE NULL END,
        close_reason = CASE WHEN v_is_completed THEN 'Todas as peças foram concluídas na célula.' ELSE NULL END,
        state_version = v_new_version,
        updated_at = clock_timestamp()
    WHERE id = v_state.id
    RETURNING * INTO v_state;
  ELSE
    INSERT INTO public.production_cell_lot_states (
      pcp_import_batch_id, general_lot_code, lot_id, lot_code,
      cell_name, step_code, machine_id, status, started_at,
      closed_at, closed_by_operator_id, close_reason, state_version
    ) VALUES (
      v_lot.pcp_import_batch_id, (SELECT general_lot_code FROM public.promob_import_batches WHERE id = v_lot.pcp_import_batch_id),
      v_lot.id, v_lot.lot_code, p_cell_name, p_step_code, p_machine_id,
      CASE WHEN v_is_completed THEN 'closed' ELSE 'active' END,
      clock_timestamp(),
      CASE WHEN v_is_completed THEN clock_timestamp() ELSE NULL END,
      CASE WHEN v_is_completed THEN p_closed_by_operator_id ELSE NULL END,
      CASE WHEN v_is_completed THEN 'Todas as peças foram concluídas na célula.' ELSE NULL END,
      1
    ) RETURNING * INTO v_state;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'is_closed', v_is_completed,
    'expected', v_expected,
    'approved', v_effective_approved,
    'pending', v_pending,
    'rejected_current', v_rejected_current,
    'rework_open', v_rework_open,
    'replacement_open', v_replacement_open,
    'state_version', v_state.state_version,
    'status', v_state.status
  );
END;
$$;

-- Troca segura de contexto ativo da célula ao detectar novo lote geral
CREATE OR REPLACE FUNCTION public.switch_cell_active_lot_context(
  p_cell_name text,
  p_step_code text,
  p_machine_id uuid,
  p_new_lot_id uuid,
  p_new_pcp_import_batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_curr_ctx public.production_cell_active_contexts%ROWTYPE;
  v_lot public.production_lots%ROWTYPE;
  v_batch public.promob_import_batches%ROWTYPE;
  v_new_version bigint := 1;
BEGIN
  SELECT * INTO v_lot FROM public.production_lots WHERE id = p_new_lot_id;
  SELECT * INTO v_batch FROM public.promob_import_batches WHERE id = COALESCE(p_new_pcp_import_batch_id, v_lot.pcp_import_batch_id);

  -- Obter contexto atual da célula
  SELECT * INTO v_curr_ctx
  FROM public.production_cell_active_contexts
  WHERE lower(btrim(cell_name)) = lower(btrim(p_cell_name))
    AND lower(btrim(step_code)) = lower(btrim(p_step_code))
    AND (machine_id = p_machine_id OR (machine_id IS NULL AND p_machine_id IS NULL));

  IF v_curr_ctx.id IS NOT NULL THEN
    v_new_version := v_curr_ctx.state_version + 1;
    UPDATE public.production_cell_active_contexts
    SET active_lot_id = p_new_lot_id,
        active_lot_code = v_lot.lot_code,
        active_pcp_import_batch_id = v_batch.id,
        active_general_lot_code = v_batch.general_lot_code,
        state_version = v_new_version,
        activated_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE id = v_curr_ctx.id
    RETURNING * INTO v_curr_ctx;
  ELSE
    INSERT INTO public.production_cell_active_contexts (
      cell_name, machine_id, step_code, active_lot_id, active_lot_code,
      active_pcp_import_batch_id, active_general_lot_code, state_version, activated_at
    ) VALUES (
      p_cell_name, p_machine_id, p_step_code, p_new_lot_id, v_lot.lot_code,
      v_batch.id, v_batch.general_lot_code, 1, clock_timestamp()
    ) RETURNING * INTO v_curr_ctx;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'state_version', v_curr_ctx.state_version,
    'active_context', to_jsonb(v_curr_ctx)
  );
END;
$$;

-- ─── 7. PROCESS PRODUCTION READING V2 COM LOCK EXCLUSIVO POR PEÇA ──────────────

CREATE OR REPLACE FUNCTION public.process_production_reading_v2(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_session_token text := NULLIF(TRIM(p_payload->>'operatorSessionToken'), '');
  v_client_event_id text := NULLIF(TRIM(p_payload->>'client_event_id'), '');
  v_tag_value text := UPPER(TRIM(COALESCE(p_payload->>'rawValue', p_payload->>'raw_value', p_payload->>'tagValue', '')));
  v_reader_type text := COALESCE(NULLIF(p_payload->>'readerType', ''), NULLIF(p_payload->>'reader_type', ''), 'keyboard_barcode');
  v_cell text;
  v_station text;
  v_step_input text := NULLIF(TRIM(COALESCE(p_payload->>'stepName', p_payload->>'step_name', '')), '');
  v_operator text;
  v_shift text;
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
  v_result jsonb;
  v_target_step_code text;
  v_current_cycle integer := 1;
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
  v_cell_calc jsonb;
  i integer;
BEGIN
  -- Validar permissão
  IF auth.uid() IS NULL OR public.get_my_role() NOT IN ('admin','manager','supervisor','operator') THEN
    RETURN jsonb_build_object('success', false, 'status', 'forbidden', 'message', 'Usuário sem permissão para coleta produtiva.');
  END IF;

  -- 1. Validar e Derivar dados da Sessão do Operador no Servidor
  IF v_session_token IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'unauthenticated', 'message', 'Sessão operacional necessária para realizar baixa.');
  END IF;

  v_token_hash := encode(extensions.digest(v_session_token, 'sha256'), 'hex');
  
  SELECT * INTO v_session FROM public.operator_sessions
  WHERE token_hash = v_token_hash AND ended_at IS NULL AND revoked_at IS NULL AND expires_at > now();

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'session_expired', 'message', 'Sessão de operador expirada, inválida ou revogada.');
  END IF;

  SELECT * INTO v_op FROM public.operators WHERE id = v_session.operator_id;

  v_client_event_id := COALESCE(v_client_event_id, gen_random_uuid()::text);
  
  -- Derivar dados do contexto da sessão do servidor
  v_cell := v_session.cell_name_snapshot;
  v_station := v_session.station_name_snapshot;
  v_operator := v_op.name;
  v_shift := COALESCE(v_session.shift_snapshot, v_op.shift, '1º Turno');

  -- 2. Claim atômico e idempotência via client_event_id
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
    v_device_id, v_enqueue_duration_ms, clock_timestamp(), 1, clock_timestamp(),
    v_session.id, v_session.cell_id, public.mask_registration(v_op.registration), v_session.machine_name_snapshot,
    v_session.station_name_snapshot, v_session.shift_snapshot
  )
  ON CONFLICT (client_event_id) DO NOTHING
  RETURNING * INTO v_event;

  IF NOT FOUND THEN
    SELECT * INTO v_event FROM public.production_collection_events WHERE client_event_id = v_client_event_id;

    UPDATE public.production_collection_events
    SET attempt_count = attempt_count + 1, last_attempt_at = clock_timestamp()
    WHERE id = v_event.id;

    IF v_event.result_payload IS NOT NULL AND v_event.result_payload <> '{}'::jsonb
       AND v_event.status IN ('synced', 'ignored', 'error') THEN
      RETURN v_event.result_payload;
    END IF;

    IF v_event.status = 'processing' AND v_event.sync_started_at > clock_timestamp() - interval '30 seconds' THEN
      RAISE EXCEPTION 'Evento % ainda está em processamento concorrente.', v_client_event_id
        USING ERRCODE = '40001';
    END IF;

    UPDATE public.production_collection_events
    SET status = 'processing', payload = p_payload, sync_started_at = clock_timestamp(), sync_finished_at = NULL, error_message = NULL, updated_at = clock_timestamp()
    WHERE id = v_event.id
    RETURNING * INTO v_event;
  END IF;

  IF v_tag_value = '' THEN
    v_result := jsonb_build_object('success', false, 'status', 'invalid', 'alert_level', 'red', 'message', 'Informe uma identificação produtiva válida.');
    RETURN public.finish_collection_event(v_event.id, 'ignored', 'invalid', v_result, NULL, NULL, v_result->>'message');
  END IF;

  -- 3. Resolver peça pelo identificador
  BEGIN
    v_piece := public.resolve_piece_by_identifier(v_tag_value);
  EXCEPTION WHEN OTHERS THEN
    v_result := jsonb_build_object('success', false, 'status', 'not_found', 'alert_level', 'red', 'message', SQLERRM);
    RETURN public.finish_collection_event(v_event.id, 'ignored', 'not_found', v_result, NULL, NULL, SQLERRM);
  END;

  -- 4. ADVISORY LOCK TRANSACIONAL EM NÍVEL DE PEÇA (Evita concorrência e avanço cruzado)
  PERFORM pg_advisory_xact_lock(hashtextextended('production-piece:' || v_piece.id::text, 0));

  -- Recarregar a peça com lock FOR UPDATE após obter o lock exclusivo
  SELECT * INTO v_piece FROM public.production_pieces WHERE id = v_piece.id FOR UPDATE;
  SELECT * INTO v_lot FROM public.production_lots WHERE id = v_piece.lot_id;
  SELECT * INTO v_order FROM public.production_orders WHERE id = COALESCE(v_piece.production_order_id, v_lot.production_order_id, v_lot.order_id);

  -- Determinar etapa correspondente
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

  v_current_cycle := COALESCE((
    SELECT MAX(production_cycle) FROM public.production_stage_readings WHERE piece_id = v_piece.id
  ), 1);

  -- 5. Defesa Atômica contra Duplicata na mesma etapa e ciclo
  SELECT * INTO v_existing_reading FROM public.production_stage_readings
  WHERE piece_id = v_piece.id 
    AND step_name = v_target_step_code 
    AND production_cycle = v_current_cycle
    AND status = 'approved'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_reading.id IS NOT NULL OR (v_target_step_code = ANY(COALESCE(v_piece.completed_steps, '{}'::text[]))) THEN
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
      'duplicated', 'duplicated_scan', v_op.id, v_session.machine_id, v_session.machine_name_snapshot,
      v_lot.lot_code, v_order.load_number, COALESCE(v_order.order_number, v_order.order_code),
      v_order.customer_name, v_piece.environment, v_target_step_code, v_piece.traceability_code,
      v_current_cycle, v_created_at_client
    ) RETURNING * INTO v_reading;

    v_result := jsonb_build_object(
      'success', false,
      'status', 'blocked',
      'reason_code', 'DUPLICATE_PIECE_STAGE',
      'legacy_status', 'duplicated',
      'alert_level', 'yellow',
      'message', 'ENTRADA BLOQUEADA: Esta numeração já foi coletada e aprovada nesta célula em outro terminal.',
      'lot', to_jsonb(v_lot),
      'order', to_jsonb(v_order),
      'item', to_jsonb(v_piece),
      'reading', to_jsonb(v_reading)
    );
    RETURN public.finish_collection_event(v_event.id, 'ignored', 'duplicated', v_result, v_reading.id, NULL, v_result->>'message');
  END IF;

  v_from_stage := v_piece.current_stage;

  -- 6. Registrar Leitura Aprovada
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
    v_piece.traceability_code, v_current_cycle, v_created_at_client
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
      updated_at = clock_timestamp()
  WHERE id = v_piece.id
  RETURNING * INTO v_piece;

  -- 7. Ativar Contexto e Recalcular Estado do Lote na Célula
  PERFORM public.switch_cell_active_lot_context(v_cell, v_target_step_code, v_session.machine_id, v_lot.id, v_piece.pcp_import_batch_id);
  v_cell_calc := public.recalculate_cell_lot_state(v_lot.id, v_cell, v_target_step_code, v_session.machine_id, v_op.id);

  -- 8. Recalcular Lote Global
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
      current_status = CASE WHEN v_total_pieces > 0 AND v_completed_pieces = v_total_pieces THEN 'completed' ELSE 'in_progress' END,
      status = CASE WHEN v_total_pieces > 0 AND v_completed_pieces = v_total_pieces THEN 'completed' ELSE 'in_progress' END,
      actual_end = CASE WHEN v_total_pieces > 0 AND v_completed_pieces = v_total_pieces THEN COALESCE(actual_end, clock_timestamp()) ELSE NULL END,
      closed_at = CASE WHEN v_total_pieces > 0 AND v_completed_pieces = v_total_pieces THEN COALESCE(closed_at, clock_timestamp()) ELSE NULL END,
      updated_at = clock_timestamp()
  WHERE id = v_lot.id
  RETURNING * INTO v_lot;

  -- Recalcular lote geral PCP
  PERFORM public.refresh_pcp_batch_progress(v_piece.pcp_import_batch_id);

  -- Entrada quantitativa MES
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
  );

  v_result := jsonb_build_object(
    'success', true,
    'status', 'approved',
    'alert_level', 'green',
    'message', 'Baixa de etapa registrada com sucesso!',
    'lot', to_jsonb(v_lot),
    'order', to_jsonb(v_order),
    'item', to_jsonb(v_piece),
    'reading', to_jsonb(v_reading),
    'cell_state', v_cell_calc
  );

  RETURN public.finish_collection_event(v_event.id, 'synced', 'approved', v_result, v_reading.id, NULL, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.process_production_reading_v2(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_production_reading_v2(jsonb) TO authenticated;

-- Manter retrocompatibilidade temporária com process_production_reading
CREATE OR REPLACE FUNCTION public.process_production_reading(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
BEGIN
  RETURN public.process_production_reading_v2(p_payload);
END;
$$;

REVOKE ALL ON FUNCTION public.process_production_reading(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_production_reading(jsonb) TO authenticated;

-- ─── 8. KPIS CANÔNICOS DE DASHBOARD E TURNO ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_collection_dashboard_snapshot_v2(
  p_cell_name text,
  p_workstation_id uuid DEFAULT NULL,
  p_operator_id uuid DEFAULT NULL,
  p_pcp_import_batch_id uuid DEFAULT NULL,
  p_lot_id uuid DEFAULT NULL,
  p_reference_time timestamptz DEFAULT clock_timestamp()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_step_code text;
  v_active_ctx public.production_cell_active_contexts%ROWTYPE;
  v_target_lot_id uuid;
  v_target_batch_id uuid;
  v_expected bigint := 0;
  v_approved bigint := 0;
  v_rejected_current bigint := 0;
  v_pending bigint := 0;
  v_rework_open bigint := 0;
  v_replacement_open bigint := 0;
  v_state_version bigint := 1;
BEGIN
  -- Resolver step_code canônico
  SELECT code INTO v_step_code
  FROM public.routing_steps
  WHERE lower(code) = lower(p_cell_name)
     OR lower(name) = lower(p_cell_name)
     OR (p_cell_name IN ('Borda', 'Bordo') AND code = 'edge')
     OR (p_cell_name = 'Usinagem' AND code = 'cnc')
     OR (p_cell_name = 'Furação' AND code = 'drill')
     OR (p_cell_name = 'Corte' AND code = 'cut')
     OR (p_cell_name = 'Marcenaria' AND code = 'joinery')
  LIMIT 1;
  v_step_code := COALESCE(v_step_code, lower(p_cell_name));

  -- Obter contexto ativo
  SELECT * INTO v_active_ctx
  FROM public.production_cell_active_contexts
  WHERE lower(btrim(cell_name)) = lower(btrim(p_cell_name))
    AND lower(btrim(step_code)) = lower(btrim(v_step_code))
    AND (machine_id = p_workstation_id OR (machine_id IS NULL AND p_workstation_id IS NULL));

  v_target_lot_id := COALESCE(p_lot_id, v_active_ctx.active_lot_id);
  v_target_batch_id := COALESCE(p_pcp_import_batch_id, v_active_ctx.active_pcp_import_batch_id);
  v_state_version := COALESCE(v_active_ctx.state_version, 1);

  IF v_target_lot_id IS NOT NULL OR v_target_batch_id IS NOT NULL THEN
    -- Contagem canônica no universo do lote ativo
    SELECT
      count(*),
      count(*) FILTER (WHERE p.status = 'rejected' AND p.replacement_status NOT IN ('completed', 'replaced')),
      count(*) FILTER (WHERE p.rework_status = 'in_progress' OR p.status IN ('rework_pending', 'rework_in_progress')),
      count(*) FILTER (WHERE p.replacement_status IN ('requested', 'in_production') OR p.status IN ('replacement_requested', 'replacement_in_production'))
    INTO v_expected, v_rejected_current, v_rework_open, v_replacement_open
    FROM public.production_pieces p
    WHERE (v_target_lot_id IS NULL OR p.lot_id = v_target_lot_id)
      AND (v_target_batch_id IS NULL OR p.pcp_import_batch_id = v_target_batch_id)
      AND v_step_code = ANY(COALESCE(p.route_steps, '{}'::text[]))
      AND p.status NOT IN ('cancelled');

    SELECT count(DISTINCT sr.piece_id)
    INTO v_approved
    FROM public.production_stage_readings sr
    JOIN public.production_pieces p ON p.id = sr.piece_id
    WHERE (v_target_lot_id IS NULL OR sr.lot_id = v_target_lot_id)
      AND (v_target_batch_id IS NULL OR p.pcp_import_batch_id = v_target_batch_id)
      AND sr.step_name = v_step_code
      AND sr.status = 'approved'
      AND p.status NOT IN ('cancelled');

    v_pending := GREATEST(v_expected - v_approved, 0);
  END IF;

  RETURN jsonb_build_object(
    'server_time', clock_timestamp(),
    'state_version', v_state_version,
    'active_context', to_jsonb(v_active_ctx),
    'lot_kpis', jsonb_build_object(
      'expected', v_expected,
      'approved', v_approved,
      'rejected', v_rejected_current,
      'pending', v_pending,
      'rework', v_rework_open,
      'replacement', v_replacement_open
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_collection_dashboard_snapshot_v2(text, uuid, uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_collection_dashboard_snapshot_v2(text, uuid, uuid, uuid, uuid, timestamptz) TO authenticated;

-- KPIs do Turno do Operador independentes do Lote
CREATE OR REPLACE FUNCTION public.get_operator_shift_kpis_v2(
  p_operator_id uuid,
  p_reference_time timestamptz DEFAULT clock_timestamp()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_win jsonb;
  v_start_ts timestamptz;
  v_end_ts timestamptz;
  v_approved bigint := 0;
  v_rejected bigint := 0;
  v_blocked bigint := 0;
BEGIN
  v_win := public.resolve_operator_shift_window(p_operator_id, p_reference_time);
  v_start_ts := (v_win->>'shift_started_at')::timestamptz;
  v_end_ts := (v_win->>'shift_ends_at')::timestamptz;

  SELECT
    count(*) FILTER (WHERE status = 'approved'),
    count(*) FILTER (WHERE status = 'rejected'),
    count(*) FILTER (WHERE status IN ('duplicated', 'blocked'))
  INTO v_approved, v_rejected, v_blocked
  FROM public.production_stage_readings
  WHERE operator_id = p_operator_id
    AND created_at >= v_start_ts
    AND created_at < v_end_ts;

  RETURN jsonb_build_object(
    'operator_id', p_operator_id,
    'shift_work_date', v_win->>'shift_work_date',
    'shift_started_at', v_start_ts,
    'shift_ends_at', v_end_ts,
    'approved', v_approved,
    'rejected', v_rejected,
    'blocked', v_blocked,
    'server_time', clock_timestamp()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_operator_shift_kpis_v2(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operator_shift_kpis_v2(uuid, timestamptz) TO authenticated;

-- ─── 9. DRY-RUN E RECONCILIAÇÃO NÃO-DESTRUTIVA ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.reconcile_mes_data_dry_run()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_inconsistent_lots bigint := 0;
  v_unclosed_completed_lots bigint := 0;
  v_missing_shift_operators bigint := 0;
BEGIN
  IF NOT public.can_manage_operators() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permissão negada.');
  END IF;

  SELECT count(*) INTO v_unclosed_completed_lots
  FROM public.production_lots
  WHERE produced_quantity >= planned_quantity
    AND planned_quantity > 0
    AND closed_at IS NULL;

  SELECT count(*) INTO v_missing_shift_operators
  FROM public.operators
  WHERE shift_start_time IS NULL OR shift_end_time IS NULL;

  RETURN jsonb_build_object(
    'success', true,
    'unclosed_completed_lots_count', v_unclosed_completed_lots,
    'missing_shift_operators_count', v_missing_shift_operators,
    'timestamp', clock_timestamp()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_mes_data_dry_run() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_mes_data_dry_run() TO authenticated;

CREATE OR REPLACE FUNCTION public.reconcile_mes_data_execute()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_updated_lots integer := 0;
  v_lot record;
BEGIN
  IF NOT public.can_manage_operators() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permissão negada.');
  END IF;

  FOR v_lot IN
    SELECT id, updated_at
    FROM public.production_lots
    WHERE produced_quantity >= planned_quantity
      AND planned_quantity > 0
      AND closed_at IS NULL
  LOOP
    UPDATE public.production_lots
    SET closed_at = COALESCE(actual_end, v_lot.updated_at, clock_timestamp()),
        status = 'completed',
        current_status = 'completed',
        pending_quantity = 0,
        progress_percent = 100,
        updated_at = clock_timestamp()
    WHERE id = v_lot.id;
    v_updated_lots := v_updated_lots + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'reconciled_lots_count', v_updated_lots,
    'timestamp', clock_timestamp()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_mes_data_execute() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_mes_data_execute() TO authenticated;

-- ─── 10. HEALTHCHECK DE IMPLANTAÇÃO ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_system_deployment_healthcheck()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Acesso negado.');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'version', '20260831120000',
    'has_shift_start_time', EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = 'operators' AND column_name = 'shift_start_time'
    ),
    'has_shift_end_time', EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = 'operators' AND column_name = 'shift_end_time'
    ),
    'has_cell_lot_states', EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'production_cell_lot_states'
    ),
    'has_cell_active_contexts', EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'production_cell_active_contexts'
    ),
    'has_process_reading_v2', EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'process_production_reading_v2'
    ),
    'server_timestamp', clock_timestamp()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_system_deployment_healthcheck() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_system_deployment_healthcheck() TO authenticated;

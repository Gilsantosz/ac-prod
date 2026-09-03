-- PR #63: torna a matriz de capacidade executável de ponta a ponta e permite
-- encerrar, com confirmação administrativa, um run cujo executor perdeu o
-- heartbeat. Um run órfão é sempre falhado; ele nunca é retomado em paralelo.

SET check_function_bodies = on;

CREATE OR REPLACE FUNCTION public.seed_capacity_fixture_v4(
  p_run_id text,
  p_profile text,
  p_registration_seed text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions, pg_temp
AS $$
DECLARE
  v_required_pieces integer;
  v_fixture_pieces integer;
  v_base_pieces integer;
  v_contention_machines integer := 0;
  v_seed_result jsonb;
  v_order_id uuid;
  v_lot_id uuid;
  v_cut_cell_id uuid;
  v_cut_cell_name text;
  v_machine_id uuid;
  v_code_base bigint;
  v_index integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_run_id !~ '^CAPTEST_[0-9]{8}_[0-9]{6}_[A-Z0-9]{8}$'
     OR p_registration_seed !~ '^[0-9]{8,14}$' THEN
    RAISE EXCEPTION 'CAPACITY_FIXTURE_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  v_required_pieces := CASE p_profile
    WHEN 'smoke' THEN 1
    WHEN 'idempotency' THEN 20
    WHEN 'microbatch' THEN 125
    WHEN 'priority' THEN 1625
    WHEN 'contention_piece' THEN 1
    WHEN 'contention_cell_lot' THEN 50
    WHEN 'atomic8' THEN 1
    WHEN 'nominal' THEN 18000
    WHEN 'burst' THEN 6000
    ELSE NULL
  END;
  IF v_required_pieces IS NULL THEN
    RAISE EXCEPTION 'CAPACITY_FIXTURE_PROFILE_INVALID' USING ERRCODE = '22023';
  END IF;

  -- A v3 exige ao menos 100 peças. Perfis menores podem ter massa excedente,
  -- mas perfis maiores recebem exatamente toda a massa exigida pelo gate.
  v_fixture_pieces := greatest(100, v_required_pieces);
  v_base_pieces := least(v_fixture_pieces, 1000);
  SELECT public.seed_capacity_fixture_v3(
    p_run_id,
    v_base_pieces,
    p_registration_seed
  ) INTO v_seed_result;

  SELECT fixture.entity_id INTO v_order_id
  FROM private.capacity_test_fixture_objects fixture
  WHERE fixture.run_id = p_run_id
    AND fixture.entity_kind = 'production_order';
  SELECT fixture.entity_id INTO v_lot_id
  FROM private.capacity_test_fixture_objects fixture
  WHERE fixture.run_id = p_run_id
    AND fixture.entity_kind = 'production_lot';
  IF v_order_id IS NULL OR v_lot_id IS NULL THEN
    RAISE EXCEPTION 'CAPACITY_FIXTURE_BASE_INCOMPLETE' USING ERRCODE = '55000';
  END IF;

  IF v_fixture_pieces > v_base_pieces THEN
    v_code_base := 1000000 + mod(abs(hashtextextended(p_run_id, 0)), 8000000);
    IF EXISTS (
      SELECT 1
      FROM generate_series(v_base_pieces + 1, v_fixture_pieces) serial
      JOIN public.production_pieces piece
        ON piece.traceability_code = lpad((v_code_base + serial)::text, 8, '0')
    ) THEN
      RAISE EXCEPTION 'CAPACITY_FIXTURE_CODE_COLLISION' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.production_pieces (
      piece_uid, traceability_code, production_order_id, lot_id,
      piece_name, description, current_stage, status, source_origin,
      route_steps, completed_steps, lot_code, order_number, customer_name,
      sequence_number, total_in_lot, is_active,
      requires_cut, requires_edge, requires_cnc, requires_joinery,
      requires_separation, requires_packaging
    )
    SELECT
      p_run_id || ':piece:' || serial,
      lpad((v_code_base + serial)::text, 8, '0'),
      v_order_id,
      v_lot_id,
      p_run_id || '_PIECE_' || serial,
      'CAPTEST_ capacity_test ' || p_run_id,
      'created',
      'created',
      'manual',
      ARRAY(
        SELECT route.step_name
        FROM public.production_routes route
        WHERE route.lot_id = v_lot_id
        ORDER BY route.step_order
      ),
      '{}'::text[],
      p_run_id || '_LOT',
      p_run_id,
      p_run_id || '_CUSTOMER',
      serial,
      v_fixture_pieces,
      true,
      true, true, true, true, true, true
    FROM generate_series(v_base_pieces + 1, v_fixture_pieces) serial;

    INSERT INTO private.capacity_test_fixture_objects(
      run_id, entity_kind, entity_id
    )
    SELECT p_run_id, 'production_piece', piece.id
    FROM public.production_pieces piece
    WHERE piece.piece_uid LIKE p_run_id || ':piece:%'
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.production_lots
  SET planned_quantity = v_fixture_pieces,
      updated_at = clock_timestamp()
  WHERE id = v_lot_id;
  UPDATE public.production_pieces piece
  SET total_in_lot = v_fixture_pieces,
      updated_at = clock_timestamp()
  WHERE piece.id IN (
    SELECT fixture.entity_id
    FROM private.capacity_test_fixture_objects fixture
    WHERE fixture.run_id = p_run_id
      AND fixture.entity_kind = 'production_piece'
  );

  SELECT cell.id, cell.name
  INTO v_cut_cell_id, v_cut_cell_name
  FROM private.capacity_test_fixture_objects fixture
  JOIN public.cells cell ON cell.id = fixture.entity_id
  WHERE fixture.run_id = p_run_id
    AND fixture.entity_kind = 'cell_reference'
    AND public.normalize_production_name(fixture.metadata ->> 'name') = 'corte'
  LIMIT 1;
  IF v_cut_cell_id IS NULL THEN
    RAISE EXCEPTION 'CAPACITY_CUT_CELL_NOT_FOUND' USING ERRCODE = '55000';
  END IF;

  -- O cenário atômico usa uma máquina criada para o run, em vez de depender
  -- de nome, ordem ou configuração de uma máquina preexistente do ambiente.
  INSERT INTO public.production_machines (
    name, cell_name, station_name, active, description,
    allows_replacement, allows_normal_production, allows_rework,
    requires_piece_traceability, allows_offline_collection
  ) VALUES (
    left(p_run_id || '_ATOMIC', 120),
    v_cut_cell_name,
    left(p_run_id || '_ATOMIC_STATION', 120),
    true,
    'CAPTEST_ capacity_test atomic ' || p_run_id,
    true, true, true, true, true
  ) RETURNING id INTO v_machine_id;
  INSERT INTO private.capacity_test_fixture_objects(
    run_id, entity_kind, entity_id, metadata
  ) VALUES (
    p_run_id,
    'machine',
    v_machine_id,
    jsonb_build_object('cell', v_cut_cell_name, 'capacity_role', 'atomic')
  );

  INSERT INTO public.operator_cell_assignments(
    operator_id, cell_id, is_primary, active
  )
  SELECT fixture.entity_id, v_cut_cell_id, false, true
  FROM private.capacity_test_fixture_objects fixture
  WHERE fixture.run_id = p_run_id
    AND fixture.entity_kind = 'operator'
    AND (fixture.metadata ->> 'operator_index')::integer IN (1, 2, 3, 4, 5, 6, 7, 9)
    AND NOT EXISTS (
      SELECT 1
      FROM public.operator_cell_assignments assignment
      WHERE assignment.operator_id = fixture.entity_id
        AND assignment.cell_id = v_cut_cell_id
        AND assignment.active IS TRUE
    );
  INSERT INTO public.operator_machine_assignments(
    operator_id, machine_id, is_primary, active
  )
  SELECT fixture.entity_id, v_machine_id, false, true
  FROM private.capacity_test_fixture_objects fixture
  WHERE fixture.run_id = p_run_id
    AND fixture.entity_kind = 'operator'
    AND (fixture.metadata ->> 'operator_index')::integer IN (1, 2, 3, 4, 5, 6, 7, 9)
  ON CONFLICT DO NOTHING;

  v_contention_machines := CASE p_profile
    WHEN 'contention_piece' THEN 20
    WHEN 'contention_cell_lot' THEN 50
    ELSE 0
  END;

  IF v_contention_machines > 0 THEN
    -- Cada sessão de contenção recebe uma máquina real e distinta na mesma
    -- célula/lote. As máquinas são exclusivas do run e o cleanup as desativa.
    FOR v_index IN 1..v_contention_machines LOOP
      INSERT INTO public.production_machines (
        name, cell_name, station_name, active, description,
        allows_replacement, allows_normal_production, allows_rework,
        requires_piece_traceability, allows_offline_collection
      ) VALUES (
        left(p_run_id || '_CONTENTION_' || lpad(v_index::text, 2, '0'), 120),
        v_cut_cell_name,
        left(p_run_id || '_CONTENTION_STATION_' || lpad(v_index::text, 2, '0'), 120),
        true,
        'CAPTEST_ capacity_test contention ' || p_run_id,
        true, true, true, true, true
      ) RETURNING id INTO v_machine_id;

      INSERT INTO private.capacity_test_fixture_objects(
        run_id, entity_kind, entity_id, metadata
      ) VALUES (
        p_run_id,
        'machine',
        v_machine_id,
        jsonb_build_object(
          'cell', v_cut_cell_name,
          'capacity_role', 'contention',
          'contention_index', v_index
        )
      );
    END LOOP;

    INSERT INTO public.operator_cell_assignments(
      operator_id, cell_id, is_primary, active
    )
    SELECT fixture.entity_id, v_cut_cell_id, false, true
    FROM private.capacity_test_fixture_objects fixture
    WHERE fixture.run_id = p_run_id
      AND fixture.entity_kind = 'operator'
      AND NOT EXISTS (
        SELECT 1
        FROM public.operator_cell_assignments assignment
        WHERE assignment.operator_id = fixture.entity_id
          AND assignment.cell_id = v_cut_cell_id
          AND assignment.active IS TRUE
      );

    INSERT INTO public.operator_machine_assignments(
      operator_id, machine_id, is_primary, active
    )
    SELECT operator_fixture.entity_id, machine_fixture.entity_id, false, true
    FROM private.capacity_test_fixture_objects operator_fixture
    CROSS JOIN private.capacity_test_fixture_objects machine_fixture
    WHERE operator_fixture.run_id = p_run_id
      AND operator_fixture.entity_kind = 'operator'
      AND machine_fixture.run_id = p_run_id
      AND machine_fixture.entity_kind = 'machine'
      AND machine_fixture.metadata ->> 'capacity_role' = 'contention'
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_seed_result || jsonb_build_object(
    'profile', p_profile,
    'required_pieces', v_required_pieces,
    'fixture_pieces', v_fixture_pieces,
    'contention_machines', v_contention_machines
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_capacity_fixture_v4(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_capacity_fixture_v4(text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_capacity_fixture_contexts_v4(p_run_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_cut_cell jsonb;
  v_atomic_machine jsonb;
  v_contention_machines jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_run_id !~ '^CAPTEST_[0-9]{8}_[0-9]{6}_[A-Z0-9]{8}$' THEN
    RAISE EXCEPTION 'CAPACITY_RUN_ID_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object('id', cell.id, 'name', cell.name)
  INTO v_cut_cell
  FROM private.capacity_test_fixture_objects fixture
  JOIN public.cells cell ON cell.id = fixture.entity_id
  WHERE fixture.run_id = p_run_id
    AND fixture.entity_kind = 'cell_reference'
    AND public.normalize_production_name(fixture.metadata ->> 'name') = 'corte'
  LIMIT 1;

  SELECT jsonb_build_object('id', machine.id, 'name', machine.name)
  INTO v_atomic_machine
  FROM private.capacity_test_fixture_objects fixture
  JOIN public.production_machines machine ON machine.id = fixture.entity_id
  WHERE fixture.run_id = p_run_id
    AND fixture.entity_kind = 'machine'
    AND fixture.metadata ->> 'capacity_role' = 'atomic'
    AND machine.active IS TRUE
    AND public.normalize_production_name(machine.cell_name) = 'corte'
  ORDER BY machine.created_at, machine.id
  LIMIT 1;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object('id', machine.id, 'name', machine.name)
      ORDER BY (fixture.metadata ->> 'contention_index')::integer
    ),
    '[]'::jsonb
  )
  INTO v_contention_machines
  FROM private.capacity_test_fixture_objects fixture
  JOIN public.production_machines machine ON machine.id = fixture.entity_id
  WHERE fixture.run_id = p_run_id
    AND fixture.entity_kind = 'machine'
    AND fixture.metadata ->> 'capacity_role' = 'contention'
    AND machine.active IS TRUE;

  IF v_cut_cell IS NULL OR v_atomic_machine IS NULL THEN
    RAISE EXCEPTION 'CAPACITY_FIXTURE_CONTEXT_INCOMPLETE' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'cut_cell', v_cut_cell,
    'atomic_machine', v_atomic_machine,
    'contention_machines', v_contention_machines
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_capacity_fixture_contexts_v4(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_capacity_fixture_contexts_v4(text)
  TO service_role;

-- Preserva a causa terminal registrada pelo plano de controle. Se um executor
-- ainda vivo observar que seu heartbeat expirou, ele pode anexar métricas ao
-- finalizar, mas não pode trocar executor_heartbeat_expired por uma causa local.
CREATE OR REPLACE FUNCTION public.finish_capacity_test_run_v3(
  p_run_id text,
  p_executor_id text,
  p_outcome text,
  p_metrics jsonb DEFAULT '{}'::jsonb,
  p_reason text DEFAULT NULL
)
RETURNS public.capacity_test_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_final_status text;
  v_row public.capacity_test_runs;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(coalesce(p_metrics, '{}'::jsonb)) <> 'object'
     OR octet_length(coalesce(p_metrics, '{}'::jsonb)::text) > 65536
     OR length(coalesce(nullif(btrim(p_reason), ''), 'ok')) > 240 THEN
    RAISE EXCEPTION 'CAPACITY_TEST_RESULT_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.capacity_test_runs
  WHERE run_id = p_run_id
    AND executor_id = p_executor_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAPACITY_EXECUTOR_OWNERSHIP_LOST' USING ERRCODE = '55000';
  END IF;

  IF v_row.status IN ('completed', 'failed', 'cancelled', 'emergency_stopped') THEN
    v_final_status := v_row.status;
  ELSIF v_row.status = 'cancel_requested' THEN
    v_final_status := 'cancelled';
  ELSIF p_outcome = 'completed' AND v_row.status = 'running' THEN
    v_final_status := 'completed';
  ELSIF p_outcome IN ('failed', 'cancelled', 'emergency_stopped')
        AND v_row.status IN ('running', 'paused') THEN
    v_final_status := p_outcome;
  ELSE
    RAISE EXCEPTION 'CAPACITY_TEST_FINISH_INVALID' USING ERRCODE = '55000';
  END IF;

  UPDATE public.capacity_test_runs
  SET status = v_final_status,
      metrics = coalesce(p_metrics, '{}'::jsonb),
      stop_reason = CASE
        WHEN v_row.status IN ('completed', 'failed', 'cancelled', 'emergency_stopped')
          AND v_row.stop_reason IS NOT NULL
          THEN v_row.stop_reason
        ELSE coalesce(nullif(left(btrim(p_reason), 240), ''), stop_reason)
      END,
      executor_heartbeat_at = clock_timestamp(),
      finished_at = coalesce(finished_at, clock_timestamp()),
      control_revision = control_revision + 1,
      updated_at = clock_timestamp()
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_capacity_test_run_v3(text, text, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_capacity_test_run_v3(text, text, text, jsonb, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fail_stale_capacity_test_run_v3(
  p_run_id text,
  p_confirmation text
)
RETURNS public.capacity_test_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row public.capacity_test_runs;
  v_stale_before timestamptz := clock_timestamp() - interval '15 seconds';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles profile
    WHERE profile.id = (SELECT auth.uid())
      AND profile.active IS TRUE
      AND profile.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_confirmation IS DISTINCT FROM 'FALHAR EXECUTOR SEM HEARTBEAT' THEN
    RAISE EXCEPTION 'CAPACITY_STALE_EXECUTOR_CONFIRMATION_REQUIRED'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.capacity_test_runs
  WHERE run_id = p_run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAPACITY_TEST_RUN_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status NOT IN ('running', 'paused', 'cancel_requested')
     OR v_row.executor_id IS NULL THEN
    RAISE EXCEPTION 'CAPACITY_TEST_RUN_HAS_NO_ACTIVE_EXECUTOR'
      USING ERRCODE = '55000';
  END IF;
  IF coalesce(
       v_row.executor_heartbeat_at,
       v_row.started_at,
       v_row.created_at
     ) >= v_stale_before THEN
    RAISE EXCEPTION 'CAPACITY_EXECUTOR_HEARTBEAT_NOT_STALE'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.capacity_test_runs
  SET status = 'failed',
      finished_at = clock_timestamp(),
      stop_reason = 'executor_heartbeat_expired',
      control_revision = control_revision + 1,
      updated_at = clock_timestamp()
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_stale_capacity_test_run_v3(text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fail_stale_capacity_test_run_v3(text, text)
  TO authenticated;

INSERT INTO public.app_schema_releases(version, checksum, notes)
VALUES (
  '20260903_pr63_capacity_fixture_stale_executor',
  'profile-fixture-18000-100-devices-stale-heartbeat-v2',
  'Fixture por perfil com 18.000 códigos, contextos de contenção reais e falha administrativa de executor sem heartbeat.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

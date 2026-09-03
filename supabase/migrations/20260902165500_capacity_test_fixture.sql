-- Fixture CAPTEST isolada para caminho real de login operacional e Collection Fabric v3.

SET check_function_bodies = on;

CREATE TABLE IF NOT EXISTS private.capacity_test_fixture_objects (
  run_id text NOT NULL,
  entity_kind text NOT NULL,
  entity_id uuid NOT NULL,
  created_by_test boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (run_id, entity_kind, entity_id)
);

REVOKE ALL ON TABLE private.capacity_test_fixture_objects
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.seed_capacity_fixture_v3(
  p_run_id text,
  p_piece_count integer,
  p_registration_seed text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions, pg_temp
AS $$
DECLARE
  v_order_id uuid;
  v_lot_id uuid;
  v_operator_id uuid;
  v_machine_id uuid;
  v_cell_id uuid;
  v_cell_name text;
  v_stage text;
  v_registration text;
  v_code_base bigint;
  v_index integer;
  v_position integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_run_id !~ '^CAPTEST_[0-9]{8}_[0-9]{6}_[A-Z0-9]{8}$'
     OR p_piece_count NOT BETWEEN 100 AND 1000
     OR p_registration_seed !~ '^[0-9]{8,14}$' THEN
    RAISE EXCEPTION 'CAPACITY_FIXTURE_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.capacity_test_fixture_objects WHERE run_id = p_run_id
  ) THEN
    RAISE EXCEPTION 'CAPACITY_FIXTURE_ALREADY_EXISTS' USING ERRCODE = '23505';
  END IF;

  CREATE TEMP TABLE pg_temp.cap_cells (
    position integer PRIMARY KEY,
    cell_id uuid NOT NULL,
    cell_name text NOT NULL,
    stage text NOT NULL,
    primary_machine_id uuid
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.cap_cells (position, cell_id, cell_name, stage)
  SELECT row_number() OVER (ORDER BY stage_order), cell_id, cell_name, stage
  FROM (
    SELECT cell.id cell_id, cell.name cell_name,
      public.resolve_production_stage_for_cell(cell.id, cell.name) stage,
      CASE public.resolve_production_stage_for_cell(cell.id, cell.name)
        WHEN 'cut' THEN 1 WHEN 'edge' THEN 2 WHEN 'cnc' THEN 3
        WHEN 'drill' THEN 4 WHEN 'joinery' THEN 5
        WHEN 'separation' THEN 6 WHEN 'packaging' THEN 7 ELSE 99
      END stage_order
    FROM public.cells cell
    WHERE cell.active IS TRUE
  ) selected
  WHERE selected.stage IN ('cut','edge','cnc','drill','joinery','separation','packaging')
  ORDER BY stage_order;

  IF (SELECT count(*) FROM pg_temp.cap_cells) <> 7 THEN
    RAISE EXCEPTION 'CAPACITY_FIXTURE_REQUIRES_SEVEN_ROUTE_CELLS' USING ERRCODE = '55000';
  END IF;

  FOR v_cell_id, v_cell_name, v_stage IN
    SELECT cell_id, cell_name, stage FROM pg_temp.cap_cells ORDER BY position
  LOOP
    SELECT machine.id INTO v_machine_id
    FROM public.production_machines machine
    WHERE machine.active IS TRUE
      AND public.normalize_production_name(machine.cell_name) = public.normalize_production_name(v_cell_name)
    ORDER BY machine.created_at, machine.id LIMIT 1;

    IF v_machine_id IS NULL THEN
      INSERT INTO public.production_machines (
        name, cell_name, station_name, active, description,
        allows_replacement, allows_normal_production, allows_rework,
        requires_piece_traceability, allows_offline_collection
      ) VALUES (
        left(p_run_id || '_MACHINE_' || upper(v_stage), 120), v_cell_name,
        left(p_run_id || '_STATION_' || upper(v_stage), 120), true,
        'CAPTEST_ capacity_test ' || p_run_id,
        true, true, true, true, true
      ) RETURNING id INTO v_machine_id;
      INSERT INTO private.capacity_test_fixture_objects(run_id, entity_kind, entity_id, metadata)
      VALUES (p_run_id, 'machine', v_machine_id, jsonb_build_object('cell', v_cell_name));
    ELSE
      INSERT INTO private.capacity_test_fixture_objects(run_id, entity_kind, entity_id, created_by_test, metadata)
      VALUES (p_run_id, 'machine_reference', v_machine_id, false, jsonb_build_object('cell', v_cell_name));
    END IF;

    UPDATE pg_temp.cap_cells SET primary_machine_id = v_machine_id WHERE cell_id = v_cell_id;
    INSERT INTO private.capacity_test_fixture_objects(run_id, entity_kind, entity_id, created_by_test, metadata)
    VALUES (p_run_id, 'cell_reference', v_cell_id, false, jsonb_build_object('name', v_cell_name));
  END LOOP;

  -- Registra também a segunda máquina da célula que possui duas máquinas reais.
  INSERT INTO private.capacity_test_fixture_objects(run_id, entity_kind, entity_id, created_by_test, metadata)
  SELECT p_run_id, 'machine_reference', machine.id, false, jsonb_build_object('cell', machine.cell_name)
  FROM public.production_machines machine
  JOIN pg_temp.cap_cells cell
    ON public.normalize_production_name(machine.cell_name) = public.normalize_production_name(cell.cell_name)
  WHERE machine.active IS TRUE
  ON CONFLICT DO NOTHING;

  FOR v_index IN 1..14 LOOP
    v_position := ((v_index - 1) % 7) + 1;
    SELECT cell_id, cell_name, primary_machine_id
    INTO v_cell_id, v_cell_name, v_machine_id
    FROM pg_temp.cap_cells WHERE position = v_position;
    v_registration := p_registration_seed || lpad(v_index::text, 2, '0');

    INSERT INTO public.operators (
      name, role, active, registration, registration_normalized,
      credential_hash, login_name, primary_cell, cells, shift,
      login_enabled, primary_cell_id, primary_machine_id,
      replacement_enabled, shift_start_time, shift_end_time, timezone
    ) VALUES (
      p_run_id || '_OP_' || lpad(v_index::text, 2, '0'), 'operator', true,
      v_registration, v_registration,
      crypt(v_registration, gen_salt('bf')),
      lower(p_run_id || '_op_' || lpad(v_index::text, 2, '0')),
      v_cell_name, ARRAY[v_cell_name], '1', true, v_cell_id, v_machine_id,
      v_index <= 7, '06:00', '14:00', 'America/Sao_Paulo'
    ) RETURNING id INTO v_operator_id;

    INSERT INTO public.operator_cell_assignments(operator_id, cell_id, is_primary, active)
    VALUES (v_operator_id, v_cell_id, true, true);
    INSERT INTO public.operator_machine_assignments(operator_id, machine_id, is_primary, active)
    VALUES (v_operator_id, v_machine_id, true, true);
    INSERT INTO private.capacity_test_fixture_objects(run_id, entity_kind, entity_id, metadata)
    VALUES (p_run_id, 'operator', v_operator_id, jsonb_build_object(
      'login_name', lower(p_run_id || '_op_' || lpad(v_index::text, 2, '0')),
      'cell_id', v_cell_id,
      'machine_id', v_machine_id,
      'operator_index', v_index,
      'replacement_enabled', v_index <= 7
    ));
  END LOOP;

  -- Cenário atômico: oito operadores possuem uma autorização adicional e
  -- explícita para disputar a mesma peça na primeira etapa (Corte).
  SELECT cell_id, primary_machine_id INTO v_cell_id, v_machine_id
  FROM pg_temp.cap_cells WHERE stage = 'cut';
  INSERT INTO public.operator_cell_assignments(operator_id, cell_id, is_primary, active)
  SELECT fixture.entity_id, v_cell_id, false, true
  FROM private.capacity_test_fixture_objects fixture
  WHERE fixture.run_id = p_run_id AND fixture.entity_kind = 'operator'
    AND (fixture.metadata ->> 'operator_index')::integer <= 8
    AND (fixture.metadata ->> 'cell_id')::uuid <> v_cell_id;
  INSERT INTO public.operator_machine_assignments(operator_id, machine_id, is_primary, active)
  SELECT fixture.entity_id, v_machine_id, false, true
  FROM private.capacity_test_fixture_objects fixture
  WHERE fixture.run_id = p_run_id AND fixture.entity_kind = 'operator'
    AND (fixture.metadata ->> 'operator_index')::integer <= 8
    AND (fixture.metadata ->> 'machine_id')::uuid <> v_machine_id;

  -- Autoriza o 8º contexto simultâneo na segunda máquina da célula multi-máquina.
  SELECT fixture.entity_id,
         (fixture.metadata ->> 'cell_id')::uuid,
         (fixture.metadata ->> 'machine_id')::uuid
  INTO v_operator_id, v_cell_id, v_machine_id
  FROM private.capacity_test_fixture_objects fixture
  WHERE fixture.run_id = p_run_id AND fixture.entity_kind = 'operator'
    AND (fixture.metadata ->> 'operator_index')::integer = 9;
  SELECT machine.id INTO v_machine_id
  FROM public.production_machines machine
  JOIN public.cells cell ON cell.id = v_cell_id
  WHERE machine.active IS TRUE
    AND machine.id <> v_machine_id
    AND public.normalize_production_name(machine.cell_name) = public.normalize_production_name(cell.name)
  ORDER BY machine.created_at, machine.id LIMIT 1;
  IF v_operator_id IS NOT NULL AND v_machine_id IS NOT NULL THEN
    INSERT INTO public.operator_machine_assignments(operator_id, machine_id, is_primary, active)
    VALUES (v_operator_id, v_machine_id, false, true);
  END IF;

  INSERT INTO public.production_orders (
    order_code, customer_name, source, status, notes,
    system_order_number, order_number, customer_legal_name
  ) VALUES (
    p_run_id, p_run_id || '_CUSTOMER', 'manual', 'released',
    'CAPTEST_ capacity_test UTC ' || clock_timestamp()::text,
    p_run_id, p_run_id, p_run_id || '_CUSTOMER'
  ) RETURNING id INTO v_order_id;
  INSERT INTO private.capacity_test_fixture_objects(run_id, entity_kind, entity_id)
  VALUES (p_run_id, 'production_order', v_order_id);

  INSERT INTO public.production_lots (
    order_id, production_order_id, lot_code, status, current_stage,
    planned_quantity, order_number, customer_name, product_code, product_name
  ) VALUES (
    v_order_id, v_order_id, p_run_id || '_LOT', 'planned', 'created',
    p_piece_count, p_run_id, p_run_id || '_CUSTOMER', p_run_id || '_PRODUCT', 'CAPTEST_ Produto'
  ) RETURNING id INTO v_lot_id;
  INSERT INTO private.capacity_test_fixture_objects(run_id, entity_kind, entity_id)
  VALUES (p_run_id, 'production_lot', v_lot_id);

  INSERT INTO public.production_routes(lot_id, step_order, step_name, cell_name, required)
  SELECT v_lot_id, position, stage, cell_name, true FROM pg_temp.cap_cells ORDER BY position;

  v_code_base := 1000000 + mod(abs(hashtextextended(p_run_id, 0)), 8000000);
  IF EXISTS (
    SELECT 1 FROM generate_series(1, p_piece_count) serial
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
    v_order_id, v_lot_id, p_run_id || '_PIECE_' || serial,
    'CAPTEST_ capacity_test ' || p_run_id, 'created', 'created', 'manual',
    ARRAY(SELECT stage FROM pg_temp.cap_cells ORDER BY position), '{}'::text[],
    p_run_id || '_LOT', p_run_id, p_run_id || '_CUSTOMER',
    serial, p_piece_count, true, true, true, true, true, true, true
  FROM generate_series(1, p_piece_count) serial;

  INSERT INTO private.capacity_test_fixture_objects(run_id, entity_kind, entity_id)
  SELECT p_run_id, 'production_piece', piece.id
  FROM public.production_pieces piece WHERE piece.piece_uid LIKE p_run_id || ':piece:%';

  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'operators', 14,
    'cells', (SELECT count(*) FROM pg_temp.cap_cells),
    'machines', (SELECT count(distinct entity_id) FROM private.capacity_test_fixture_objects WHERE run_id=p_run_id AND entity_kind IN ('machine','machine_reference')),
    'pieces', p_piece_count,
    'route', (SELECT jsonb_agg(jsonb_build_object('order',position,'stage',stage,'cell_id',cell_id,'cell_name',cell_name,'machine_id',primary_machine_id) ORDER BY position) FROM pg_temp.cap_cells),
    'code_first', lpad((v_code_base + 1)::text, 8, '0'),
    'code_last', lpad((v_code_base + p_piece_count)::text, 8, '0')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_capacity_fixture_v3(text, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_capacity_fixture_v3(text, integer, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_capacity_fixture_v3(p_run_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_sessions integer;
  v_operators integer;
  v_machines integer;
  v_pieces integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  UPDATE public.operator_sessions session
  SET ended_at = coalesce(ended_at, clock_timestamp()),
      end_reason = coalesce(end_reason, 'capacity_test_cleanup')
  WHERE session.operator_id IN (
    SELECT entity_id FROM private.capacity_test_fixture_objects
    WHERE run_id = p_run_id AND entity_kind = 'operator'
  ) AND session.ended_at IS NULL;
  GET DIAGNOSTICS v_sessions = ROW_COUNT;

  UPDATE public.operators operator_row
  SET active = false, login_enabled = false,
      deactivated_at = coalesce(deactivated_at, clock_timestamp())
  WHERE operator_row.id IN (
    SELECT entity_id FROM private.capacity_test_fixture_objects
    WHERE run_id = p_run_id AND entity_kind = 'operator'
  );
  GET DIAGNOSTICS v_operators = ROW_COUNT;

  UPDATE public.production_machines machine
  SET active = false, updated_at = clock_timestamp()
  WHERE machine.id IN (
    SELECT entity_id FROM private.capacity_test_fixture_objects
    WHERE run_id = p_run_id AND entity_kind = 'machine' AND created_by_test IS TRUE
  );
  GET DIAGNOSTICS v_machines = ROW_COUNT;

  UPDATE public.production_pieces piece
  SET status = 'cancelled', is_active = false, production_status = 'CAPTEST_ARCHIVED', updated_at = clock_timestamp()
  WHERE piece.id IN (
    SELECT entity_id FROM private.capacity_test_fixture_objects
    WHERE run_id = p_run_id AND entity_kind = 'production_piece'
  );
  GET DIAGNOSTICS v_pieces = ROW_COUNT;

  UPDATE public.production_lots SET status='cancelled', updated_at=clock_timestamp()
  WHERE id IN (SELECT entity_id FROM private.capacity_test_fixture_objects WHERE run_id=p_run_id AND entity_kind='production_lot');
  UPDATE public.production_orders SET status='cancelled', updated_at=clock_timestamp()
  WHERE id IN (SELECT entity_id FROM private.capacity_test_fixture_objects WHERE run_id=p_run_id AND entity_kind='production_order');

  RETURN jsonb_build_object('run_id',p_run_id,'sessions_ended',v_sessions,'operators_disabled',v_operators,'machines_disabled',v_machines,'pieces_archived',v_pieces);
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_capacity_fixture_v3(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_capacity_fixture_v3(text)
  TO service_role;

INSERT INTO public.app_schema_releases(version, checksum, notes)
VALUES ('20260902_acprod_capacity_test_fixture','captest-7-cells-8-machines-14-operators-100-1000-pieces-v1','Fixture CAPTEST isolada, credenciais com hash e cleanup sem exclusão de evidência.')
ON CONFLICT (version) DO UPDATE SET checksum=excluded.checksum, notes=excluded.notes;

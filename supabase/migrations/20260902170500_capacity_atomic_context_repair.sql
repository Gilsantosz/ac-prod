-- Garante que os oito perfis selecionados pelo teste de concorrência atômica
-- estejam autorizados na mesma célula/máquina antes da criação das sessões.

CREATE OR REPLACE FUNCTION public.prepare_capacity_atomic_contexts_v3(p_run_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_cell_id uuid;
  v_machine_id uuid;
  v_cells_inserted integer := 0;
  v_machines_inserted integer := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_run_id !~ '^CAPTEST_[0-9]{8}_[0-9]{6}_[A-Z0-9]{8}$' THEN
    RAISE EXCEPTION 'CAPACITY_RUN_ID_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT cell.id
  INTO v_cell_id
  FROM private.capacity_test_fixture_objects fixture
  JOIN public.cells cell ON cell.id = fixture.entity_id
  WHERE fixture.run_id = p_run_id
    AND fixture.entity_kind = 'cell_reference'
    AND public.normalize_production_name(fixture.metadata ->> 'name') = 'corte'
  LIMIT 1;

  SELECT machine.id
  INTO v_machine_id
  FROM private.capacity_test_fixture_objects fixture
  JOIN public.production_machines machine ON machine.id = fixture.entity_id
  WHERE fixture.run_id = p_run_id
    AND fixture.entity_kind IN ('machine', 'machine_reference')
    AND machine.active IS TRUE
    AND public.normalize_production_name(machine.cell_name) = 'corte'
  ORDER BY machine.created_at, machine.id
  LIMIT 1;

  IF v_cell_id IS NULL OR v_machine_id IS NULL THEN
    RAISE EXCEPTION 'CAPACITY_ATOMIC_CONTEXT_NOT_FOUND' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.operator_cell_assignments(operator_id, cell_id, is_primary, active)
  SELECT fixture.entity_id, v_cell_id, false, true
  FROM private.capacity_test_fixture_objects fixture
  WHERE fixture.run_id = p_run_id
    AND fixture.entity_kind = 'operator'
    AND (fixture.metadata ->> 'operator_index')::integer IN (1, 2, 3, 4, 5, 6, 7, 9)
    AND NOT EXISTS (
      SELECT 1 FROM public.operator_cell_assignments assignment
      WHERE assignment.operator_id = fixture.entity_id
        AND assignment.cell_id = v_cell_id
        AND assignment.active IS TRUE
    );
  GET DIAGNOSTICS v_cells_inserted = ROW_COUNT;

  INSERT INTO public.operator_machine_assignments(operator_id, machine_id, is_primary, active)
  SELECT fixture.entity_id, v_machine_id, false, true
  FROM private.capacity_test_fixture_objects fixture
  WHERE fixture.run_id = p_run_id
    AND fixture.entity_kind = 'operator'
    AND (fixture.metadata ->> 'operator_index')::integer IN (1, 2, 3, 4, 5, 6, 7, 9)
    AND NOT EXISTS (
      SELECT 1 FROM public.operator_machine_assignments assignment
      WHERE assignment.operator_id = fixture.entity_id
        AND assignment.machine_id = v_machine_id
        AND assignment.active IS TRUE
    );
  GET DIAGNOSTICS v_machines_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'cell_id', v_cell_id,
    'machine_id', v_machine_id,
    'cell_assignments_inserted', v_cells_inserted,
    'machine_assignments_inserted', v_machines_inserted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_capacity_atomic_contexts_v3(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_capacity_atomic_contexts_v3(text)
  TO service_role;


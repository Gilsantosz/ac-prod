-- Plano de controle auditável para a página administrativa Testes de Capacidade.

SET check_function_bodies = on;

CREATE TABLE IF NOT EXISTS public.capacity_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'requested',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  app_version text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT capacity_test_runs_run_id_check
    CHECK (run_id ~ '^CAPTEST_[0-9]{8}_[0-9]{6}_[A-Z0-9]{8}$'),
  CONSTRAINT capacity_test_runs_status_check
    CHECK (status IN ('requested','running','paused','cancel_requested','emergency_stopped','completed','failed')),
  CONSTRAINT capacity_test_runs_config_object_check CHECK (jsonb_typeof(config) = 'object'),
  CONSTRAINT capacity_test_runs_metrics_object_check CHECK (jsonb_typeof(metrics) = 'object')
);

CREATE INDEX IF NOT EXISTS capacity_test_runs_created_at_idx
  ON public.capacity_test_runs (created_at DESC);

ALTER TABLE public.capacity_test_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS capacity_test_runs_admin_select ON public.capacity_test_runs;
CREATE POLICY capacity_test_runs_admin_select ON public.capacity_test_runs
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.profiles profile
  WHERE profile.id = auth.uid() AND profile.active IS TRUE AND profile.role = 'admin'
));

REVOKE ALL ON TABLE public.capacity_test_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.capacity_test_runs TO authenticated;
GRANT ALL ON TABLE public.capacity_test_runs TO service_role;

CREATE OR REPLACE FUNCTION public.request_capacity_test_run(
  p_run_id text,
  p_config jsonb,
  p_confirmation text
)
RETURNS public.capacity_test_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row public.capacity_test_runs;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles profile
    WHERE profile.id = auth.uid() AND profile.active IS TRUE AND profile.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_confirmation IS DISTINCT FROM 'INICIAR TESTE CONTROLADO' THEN
    RAISE EXCEPTION 'CAPACITY_TEST_CONFIRMATION_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_run_id !~ '^CAPTEST_[0-9]{8}_[0-9]{6}_[A-Z0-9]{8}$'
     OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'CAPACITY_TEST_CONFIG_INVALID' USING ERRCODE = '22023';
  END IF;
  IF coalesce((p_config ->> 'devices')::integer, 0) NOT BETWEEN 1 AND 100
     OR coalesce((p_config ->> 'operators')::integer, 0) NOT BETWEEN 1 AND 14
     OR coalesce((p_config ->> 'pieces')::integer, 0) NOT BETWEEN 1 AND 18000
     OR coalesce((p_config ->> 'duration_minutes')::integer, 0) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'CAPACITY_TEST_LIMIT_EXCEEDED' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.capacity_test_runs (run_id, config, app_version)
  VALUES (p_run_id, p_config, left(p_config ->> 'app_version', 80))
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.request_capacity_test_run(text, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_capacity_test_run(text, jsonb, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.control_capacity_test_run(
  p_run_id text,
  p_action text
)
RETURNS public.capacity_test_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_status text;
  v_row public.capacity_test_runs;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles profile
    WHERE profile.id = auth.uid() AND profile.active IS TRUE AND profile.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;
  v_status := CASE p_action
    WHEN 'pause' THEN 'paused'
    WHEN 'resume' THEN 'requested'
    WHEN 'cancel' THEN 'cancel_requested'
    WHEN 'emergency_stop' THEN 'emergency_stopped'
    ELSE NULL
  END;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'CAPACITY_TEST_ACTION_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE public.capacity_test_runs
  SET status = v_status,
      finished_at = CASE WHEN v_status = 'emergency_stopped' THEN clock_timestamp() ELSE finished_at END,
      updated_at = clock_timestamp()
  WHERE run_id = p_run_id
    AND status NOT IN ('completed', 'failed', 'emergency_stopped')
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_TEST_RUN_NOT_CONTROLLABLE' USING ERRCODE = '55000'; END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.control_capacity_test_run(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.control_capacity_test_run(text, text)
  TO authenticated, service_role;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260902_acprod_capacity_test_control_plane',
  'admin-capacity-runs-confirmation-rls-emergency-stop-v1',
  'Plano de controle auditável, limitado e exclusivo de administradores para ensaios CAPTEST.'
)
ON CONFLICT (version) DO UPDATE SET checksum = excluded.checksum, notes = excluded.notes;

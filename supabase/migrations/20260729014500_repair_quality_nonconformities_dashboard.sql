-- Repara o schema parcial do módulo de Qualidade sem remover dados existentes.
-- A tabela quality_nonconformities já existia quando a migration original usou
-- CREATE TABLE IF NOT EXISTS; por isso algumas colunas e quality_actions não
-- foram criadas no projeto remoto.

BEGIN;

ALTER TABLE public.quality_nonconformities
  ADD COLUMN IF NOT EXISTS detected_at timestamptz,
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deadline timestamptz,
  ADD COLUMN IF NOT EXISTS related_rework_id uuid REFERENCES public.rework_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS six_m_category text DEFAULT 'Método';

UPDATE public.quality_nonconformities
SET
  detected_at = COALESCE(detected_at, created_at, now()),
  opened_at = COALESCE(opened_at, created_at, now());

ALTER TABLE public.quality_nonconformities
  ALTER COLUMN detected_at SET DEFAULT now(),
  ALTER COLUMN detected_at SET NOT NULL,
  ALTER COLUMN opened_at SET DEFAULT now(),
  ALTER COLUMN opened_at SET NOT NULL;

UPDATE public.quality_nonconformities nc
SET
  defect_code = COALESCE(defect.code, nc.defect_code),
  defect_name = COALESCE(defect.name, nc.defect_name, 'Defeito não informado'),
  six_m_category = COALESCE(defect.six_m_category, nc.six_m_category, 'Método')
FROM public.quality_defect_catalog defect
WHERE defect.id = nc.defect_id;

UPDATE public.quality_nonconformities
SET
  defect_name = COALESCE(defect_name, 'Defeito não informado'),
  six_m_category = COALESCE(six_m_category, 'Método');

CREATE TABLE IF NOT EXISTS public.quality_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nonconformity_id uuid NOT NULL REFERENCES public.quality_nonconformities(id) ON DELETE CASCADE,
  action_type text NOT NULL DEFAULT 'corrective'
    CHECK (action_type IN ('containment', 'corrective', 'preventive')),
  what text NOT NULL,
  why text,
  where_location text,
  when_deadline timestamptz,
  who_owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  who_owner_name text,
  how text,
  how_much numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'verified', 'cancelled')),
  evidence_url text,
  result_notes text,
  efficacy_verified boolean NOT NULL DEFAULT false,
  efficacy_verified_at timestamptz,
  efficacy_verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quality_actions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quality_actions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quality_nonconformities TO authenticated;

DROP POLICY IF EXISTS authenticated_access ON public.quality_nonconformities;
DROP POLICY IF EXISTS quality_nonconformities_read ON public.quality_nonconformities;
CREATE POLICY quality_nonconformities_read
  ON public.quality_nonconformities
  FOR SELECT
  TO authenticated
  USING (
    public.has_permission('view_quality')
    OR public.has_permission('manage_quality')
    OR public.get_my_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS quality_nonconformities_write ON public.quality_nonconformities;
DROP POLICY IF EXISTS quality_nonconformities_insert ON public.quality_nonconformities;
CREATE POLICY quality_nonconformities_insert
  ON public.quality_nonconformities
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_permission('manage_quality')
    OR public.get_my_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS quality_nonconformities_update ON public.quality_nonconformities;
CREATE POLICY quality_nonconformities_update
  ON public.quality_nonconformities
  FOR UPDATE
  TO authenticated
  USING (
    public.has_permission('manage_quality')
    OR public.get_my_role() IN ('admin', 'manager')
  )
  WITH CHECK (
    public.has_permission('manage_quality')
    OR public.get_my_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS quality_nonconformities_delete ON public.quality_nonconformities;
CREATE POLICY quality_nonconformities_delete
  ON public.quality_nonconformities
  FOR DELETE
  TO authenticated
  USING (
    public.has_permission('manage_quality')
    OR public.get_my_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS quality_actions_read ON public.quality_actions;
CREATE POLICY quality_actions_read
  ON public.quality_actions
  FOR SELECT
  TO authenticated
  USING (
    public.has_permission('view_quality')
    OR public.has_permission('manage_quality')
    OR public.get_my_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS quality_actions_write ON public.quality_actions;
DROP POLICY IF EXISTS quality_actions_insert ON public.quality_actions;
CREATE POLICY quality_actions_insert
  ON public.quality_actions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_permission('manage_quality')
    OR public.get_my_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS quality_actions_update ON public.quality_actions;
CREATE POLICY quality_actions_update
  ON public.quality_actions
  FOR UPDATE
  TO authenticated
  USING (
    public.has_permission('manage_quality')
    OR public.get_my_role() IN ('admin', 'manager')
  )
  WITH CHECK (
    public.has_permission('manage_quality')
    OR public.get_my_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS quality_actions_delete ON public.quality_actions;
CREATE POLICY quality_actions_delete
  ON public.quality_actions
  FOR DELETE
  TO authenticated
  USING (
    public.has_permission('manage_quality')
    OR public.get_my_role() IN ('admin', 'manager')
  );

CREATE INDEX IF NOT EXISTS idx_quality_actions_nc
  ON public.quality_actions(nonconformity_id);
CREATE INDEX IF NOT EXISTS idx_quality_actions_owner
  ON public.quality_actions(who_owner_id);
CREATE INDEX IF NOT EXISTS idx_quality_actions_deadline
  ON public.quality_actions(when_deadline)
  WHERE status NOT IN ('completed', 'verified', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_nc_detected_at
  ON public.quality_nonconformities(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_nc_six_m_category
  ON public.quality_nonconformities(six_m_category);
CREATE INDEX IF NOT EXISTS idx_nc_status_detected
  ON public.quality_nonconformities(status, detected_at DESC);

ALTER FUNCTION public.register_quality_rejection(jsonb)
  SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.register_quality_rejection(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_quality_rejection(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
